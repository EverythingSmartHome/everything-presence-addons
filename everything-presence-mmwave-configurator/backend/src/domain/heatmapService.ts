import { HaAuthConfig } from '../ha/types';
import { logger } from '../logger';
import { Point, Zone, isZonePolygon, EntityMappings } from './types';
import { EntityResolver } from './entityResolver';

/**
 * Grid cell for heatmap visualization.
 */
interface HeatmapCell {
  x: number;
  y: number;
  count: number;
  intensity: number;
}

/**
 * Statistics about a zone's occupancy.
 */
interface ZoneStat {
  zoneId: string;
  zoneName: string;
  sampleCount: number;
  percentage: number;
}

/**
 * Hourly activity breakdown (0-23 hours).
 */
interface HourlyBreakdown {
  hour: number; // 0-23
  count: number;
  percentage: number; // Percentage of total samples in this hour
}

/**
 * Average position across all samples.
 */
interface AveragePosition {
  x: number;
  y: number;
}

/**
 * Response from heatmap generation.
 */
export interface HeatmapResponse {
  resolution: number;
  bounds: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };
  cells: HeatmapCell[];
  stats: {
    totalSamples: number;
    maxCount: number;
    timeRange: {
      start: string;
      end: string;
    };
    dataAvailable: boolean;
  };
  zoneStats?: ZoneStat[];
  hourlyBreakdown?: HourlyBreakdown[];
  averagePosition?: AveragePosition;
}

interface HistoryPoint {
  x: number;
  y: number;
  timestamp: Date;
  targetIndex: number;
}

interface HaHistoryState {
  entity_id: string;
  state: string;
  last_changed: string;
}

export class HeatmapService {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(config: HaAuthConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    if (!this.baseUrl.endsWith('/api')) {
      this.baseUrl = this.baseUrl + '/api';
    }
    this.token = config.token;
  }

  /**
   * Generate heatmap data from HA history.
   */
  async generateHeatmap(
    entityNamePrefix: string,
    hours: number,
    resolution: number,
    zones?: Zone[],
    entityMappings?: EntityMappings
  ): Promise<HeatmapResponse> {
    const maxHours = 168; // 7 days max
    const clampedHours = Math.min(hours, maxHours);
    const clampedResolution = Math.max(100, Math.min(1000, resolution)); // 100mm to 1000mm cells

    // Build entity list for targets 1-3 using EntityResolver
    const entities = this.getTrackingEntities(entityNamePrefix, entityMappings);

    // Fetch history from HA
    const history = await this.fetchHistory(entities, clampedHours);

    // Correlate X/Y pairs by timestamp
    const points = this.correlateCoordinates(history);

    if (points.length === 0) {
      return this.emptyResponse(clampedResolution, clampedHours);
    }

    // Bucket into grid cells
    const { cells, bounds, maxCount } = this.bucketPoints(points, clampedResolution);

    // Calculate zone stats if zones exist
    const zoneStats = zones && zones.length > 0
      ? this.calculateZoneStats(points, zones)
      : undefined;

    // Calculate hourly breakdown
    const hourlyBreakdown = this.calculateHourlyBreakdown(points);

    // Calculate average position
    const averagePosition = this.calculateAveragePosition(points);

    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - clampedHours * 60 * 60 * 1000);

    return {
      resolution: clampedResolution,
      bounds,
      cells,
      stats: {
        totalSamples: points.length,
        maxCount,
        timeRange: {
          start: startTime.toISOString(),
          end: endTime.toISOString(),
        },
        dataAvailable: true,
      },
      zoneStats,
      hourlyBreakdown,
      averagePosition,
    };
  }

  /**
   * Get entity IDs for target tracking (x,y coordinates for targets 1-3).
   * Uses EntityResolver to check stored mappings first, with template fallback.
   */
  private getTrackingEntities(entityNamePrefix: string, entityMappings?: EntityMappings): string[] {
    const entities: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const xEntity = EntityResolver.resolveTargetEntity(entityMappings, entityNamePrefix, i, 'x');
      const yEntity = EntityResolver.resolveTargetEntity(entityMappings, entityNamePrefix, i, 'y');
      if (xEntity) entities.push(xEntity);
      if (yEntity) entities.push(yEntity);
    }
    return entities;
  }

  /**
   * Fetch history from HA's history API.
   */
  private async fetchHistory(entityIds: string[], hours: number): Promise<HaHistoryState[][]> {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - hours * 60 * 60 * 1000);

    const url = new URL(`${this.baseUrl}/history/period/${startTime.toISOString()}`);
    url.searchParams.set('filter_entity_id', entityIds.join(','));
    url.searchParams.set('end_time', endTime.toISOString());
    url.searchParams.set('minimal_response', 'true');
    url.searchParams.set('significant_changes_only', 'false');

    logger.debug({ url: url.toString(), entityCount: entityIds.length }, 'Fetching HA history');

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      logger.error({ status: response.status, error: text }, 'Failed to fetch HA history');
      throw new Error(`Failed to fetch history: ${response.status}`);
    }

    const data = await response.json() as HaHistoryState[][];
    logger.debug({ entityCount: data.length }, 'Fetched HA history');
    return data;
  }

  /**
   * Correlate X/Y coordinates by timestamp.
   * X and Y are stored as separate entities, so we match by timestamp within 1s tolerance.
   */
  private correlateCoordinates(history: HaHistoryState[][]): HistoryPoint[] {
    const points: HistoryPoint[] = [];

    for (let targetIdx = 1; targetIdx <= 3; targetIdx++) {
      const xHistory = history.find(h => h[0]?.entity_id?.includes(`target_${targetIdx}_x`));
      const yHistory = history.find(h => h[0]?.entity_id?.includes(`target_${targetIdx}_y`));

      if (!xHistory || !yHistory) continue;

      // Create time-indexed map for Y values
      const yMap = new Map<number, number>();
      for (const yState of yHistory) {
        const yTime = new Date(yState.last_changed).getTime();
        const yVal = parseFloat(yState.state);
        if (!isNaN(yVal)) {
          // Round to nearest second for matching
          const roundedTime = Math.round(yTime / 1000) * 1000;
          yMap.set(roundedTime, yVal);
        }
      }

      // Match X values to Y values
      for (const xState of xHistory) {
        const xVal = parseFloat(xState.state);
        if (isNaN(xVal)) continue;

        const xTime = new Date(xState.last_changed).getTime();
        const roundedTime = Math.round(xTime / 1000) * 1000;

        // Look for Y within 1 second tolerance
        let yVal = yMap.get(roundedTime);
        if (yVal === undefined) {
          yVal = yMap.get(roundedTime - 1000);
        }
        if (yVal === undefined) {
          yVal = yMap.get(roundedTime + 1000);
        }

        if (yVal !== undefined) {
          points.push({
            x: xVal,
            y: yVal,
            timestamp: new Date(xState.last_changed),
            targetIndex: targetIdx,
          });
        }
      }
    }

    logger.debug({ pointCount: points.length }, 'Correlated coordinate pairs');
    return points;
  }

  /**
   * Bucket points into grid cells and calculate intensities.
   */
  private bucketPoints(points: HistoryPoint[], resolution: number): {
    cells: HeatmapCell[];
    bounds: { minX: number; maxX: number; minY: number; maxY: number };
    maxCount: number;
  } {
    const grid = new Map<string, number>();
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (const point of points) {
      const cellX = Math.floor(point.x / resolution) * resolution;
      const cellY = Math.floor(point.y / resolution) * resolution;
      const key = `${cellX},${cellY}`;

      grid.set(key, (grid.get(key) || 0) + 1);

      minX = Math.min(minX, cellX);
      maxX = Math.max(maxX, cellX + resolution);
      minY = Math.min(minY, cellY);
      maxY = Math.max(maxY, cellY + resolution);
    }

    const maxCount = Math.max(...grid.values());

    const cells = Array.from(grid.entries()).map(([key, count]) => {
      const [x, y] = key.split(',').map(Number);
      return {
        x,
        y,
        count,
        intensity: count / maxCount,
      };
    });

    return {
      cells,
      bounds: { minX, maxX, minY, maxY },
      maxCount,
    };
  }

  /**
   * Calculate how many samples fall within each zone.
   * Also calculates "No Zone" - points not in any defined zone.
   */
  private calculateZoneStats(points: HistoryPoint[], zones: Zone[]): ZoneStat[] {
    const stats: ZoneStat[] = [];

    // Track points that are in at least one zone
    const pointsInAnyZone = new Set<number>();

    for (const zone of zones) {
      const inZone: number[] = [];
      points.forEach((p, idx) => {
        if (this.pointInZone(p, zone)) {
          inZone.push(idx);
          pointsInAnyZone.add(idx);
        }
      });

      stats.push({
        zoneId: zone.id,
        zoneName: zone.label || zone.id,
        sampleCount: inZone.length,
        percentage: points.length > 0 ? (inZone.length / points.length) * 100 : 0,
      });
    }

    // Calculate "No Zone" stat - points not in any zone
    const noZoneCount = points.length - pointsInAnyZone.size;
    stats.push({
      zoneId: '__no_zone__',
      zoneName: 'No Zone',
      sampleCount: noZoneCount,
      percentage: points.length > 0 ? (noZoneCount / points.length) * 100 : 0,
    });

    return stats;
  }

  /**
   * Check if a point is inside a zone (supports both rect and polygon).
   */
  private pointInZone(point: HistoryPoint, zone: Zone): boolean {
    if (isZonePolygon(zone)) {
      return this.pointInPolygon(point, zone.vertices);
    }
    // Rectangle
    return (
      point.x >= zone.x &&
      point.x <= zone.x + zone.width &&
      point.y >= zone.y &&
      point.y <= zone.y + zone.height
    );
  }

  /**
   * Ray casting algorithm for point-in-polygon test.
   */
  private pointInPolygon(point: { x: number; y: number }, vertices: Point[]): boolean {
    if (vertices.length < 3) return false;

    let inside = false;
    const n = vertices.length;

    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = vertices[i].x, yi = vertices[i].y;
      const xj = vertices[j].x, yj = vertices[j].y;

      if (((yi > point.y) !== (yj > point.y)) &&
          (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }

    return inside;
  }

  /**
   * Calculate activity breakdown by hour of day (0-23).
   */
  private calculateHourlyBreakdown(points: HistoryPoint[]): HourlyBreakdown[] {
    // Initialize counts for all 24 hours
    const hourlyCounts = new Array(24).fill(0);

    for (const point of points) {
      const hour = point.timestamp.getHours();
      hourlyCounts[hour]++;
    }

    const totalSamples = points.length;

    return hourlyCounts.map((count, hour) => ({
      hour,
      count,
      percentage: totalSamples > 0 ? (count / totalSamples) * 100 : 0,
    }));
  }

  /**
   * Calculate the average (centroid) position of all samples.
   */
  private calculateAveragePosition(points: HistoryPoint[]): AveragePosition | undefined {
    if (points.length === 0) {
      return undefined;
    }

    let sumX = 0;
    let sumY = 0;

    for (const point of points) {
      sumX += point.x;
      sumY += point.y;
    }

    return {
      x: sumX / points.length,
      y: sumY / points.length,
    };
  }

  /**
   * Return empty response when no data is available.
   */
  private emptyResponse(resolution: number, hours: number): HeatmapResponse {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - hours * 60 * 60 * 1000);

    return {
      resolution,
      bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
      cells: [],
      stats: {
        totalSamples: 0,
        maxCount: 0,
        timeRange: {
          start: startTime.toISOString(),
          end: endTime.toISOString(),
        },
        dataAvailable: false,
      },
    };
  }
}
