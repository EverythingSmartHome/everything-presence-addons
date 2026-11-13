import { HaAuthConfig } from '../ha/types';
import { haFetch } from '../ha/haHttp';
import { logger } from '../logger';
import { Point, Zone, isZonePolygon, EntityMappings } from './types';
import { EntityResolver } from './entityResolver';
import { deviceEntityService } from './deviceEntityService';
import { deviceMappingStorage } from '../config/deviceMappingStorage';

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

interface TargetEntityInfo {
  targetIndex: number;
  xEntity: string | null;
  yEntity: string | null;
  activeEntity?: string | null;
}

interface HaHistoryState {
  entity_id?: string;
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
   * @param entityNamePrefix - Legacy entity name prefix (for fallback)
   * @param hours - Number of hours of history to fetch (max 168)
   * @param resolution - Grid cell size in mm (100-1000)
   * @param zones - Optional zones for zone stats
   * @param entityMappings - Legacy entity mappings (for fallback)
   * @param deviceId - Device ID for device-level mapping lookup (preferred)
   */
  async generateHeatmap(
    entityNamePrefix: string | undefined,
    hours: number,
    resolution: number,
    zones?: Zone[],
    entityMappings?: EntityMappings,
    deviceId?: string
  ): Promise<HeatmapResponse> {
    const maxHours = 168; // 7 days max
    const clampedHours = Math.min(hours, maxHours);
    const clampedResolution = Math.max(100, Math.min(1000, resolution)); // 100mm to 1000mm cells

    // Build entity list for targets 1-3 using device mappings first, then EntityResolver fallback
    const { entities, targetInfo } = this.getTrackingEntities(entityNamePrefix, entityMappings, deviceId);

    // Fetch history from HA
    const history = await this.fetchHistory(entities, clampedHours);

    // Reconstruct chronological target state using resolved entity mappings
    const points = this.correlateCoordinates(history, targetInfo);

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
   * Uses device mappings first, then EntityResolver for legacy fallback.
   * Returns both the entity list and target info for correlation.
   */
  private getTrackingEntities(entityNamePrefix: string | undefined, entityMappings?: EntityMappings, deviceId?: string): { entities: string[]; targetInfo: TargetEntityInfo[] } {
    const entities: string[] = [];
    const targetInfo: TargetEntityInfo[] = [];
    const hasDeviceMapping = deviceId ? deviceMappingStorage.hasMapping(deviceId) : false;

    for (let i = 1; i <= 3; i++) {
      let xEntity: string | null = null;
      let yEntity: string | null = null;
      let activeEntity: string | null = null;

      // Try device-level mapping first (preferred)
      if (hasDeviceMapping && deviceId) {
        const targetSet = deviceEntityService.getTargetEntities(deviceId, i);
        if (targetSet) {
          xEntity = targetSet.x || null;
          yEntity = targetSet.y || null;
          activeEntity = targetSet.active || null;
        }
      }

      // Fallback to legacy EntityResolver
      if (!xEntity) {
        xEntity = EntityResolver.resolveTargetEntity(entityMappings, entityNamePrefix, i, 'x');
      }
      if (!yEntity) {
        yEntity = EntityResolver.resolveTargetEntity(entityMappings, entityNamePrefix, i, 'y');
      }

      if (!activeEntity) {
        activeEntity = EntityResolver.resolveTargetEntity(entityMappings, entityNamePrefix, i, 'active');
      }
      if (activeEntity) entities.push(activeEntity);
      if (xEntity) entities.push(xEntity);
      if (yEntity) entities.push(yEntity);

      // Track the mapping for correlation
      if (xEntity || yEntity) {
        targetInfo.push({ targetIndex: i, xEntity, yEntity, activeEntity });
      }
    }
    return { entities, targetInfo };
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

    const response = await haFetch(url.toString(), {
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
   * State-change sampling, not time-weighted occupancy: emit at most one point per
   * target/timestamp after applying simultaneous updates. Never look ahead.
   * HA minimal_response omits entity_id after the first entry in each series.
   * Initial history states seed the axes like subsequent state changes. Activation
   * can emit a newly valid state when coordinates arrived before activity.
   * Distinct timestamps remain distinct samples: history has no physical frame ID
   * with which to safely merge asynchronous axis updates or reset transitions.
   */
  private correlateCoordinates(history: HaHistoryState[][], targetInfo: TargetEntityInfo[]): HistoryPoint[] {
    const points: HistoryPoint[] = [];
    for (const target of targetInfo) {
      const find = (id: string | null | undefined) => id
        ? history.find(series => series[0]?.entity_id === id) : undefined;
      const xHistory = find(target.xEntity);
      const yHistory = find(target.yEntity);
      const activeHistory = find(target.activeEntity);
      if (!xHistory || !yHistory) continue;
      type Update = { axis: 'x' | 'y' | 'active'; state: string };
      const events = new Map<number, Update[]>();
      const add = (states: HaHistoryState[], axis: Update['axis']) => {
        for (const state of states) {
          const timestamp = Date.parse(state.last_changed);
          if (!Number.isFinite(timestamp)) continue;
          const updates = events.get(timestamp) || [];
          updates.push({ axis, state: state.state });
          events.set(timestamp, updates);
        }
      };
      add(xHistory, 'x');
      add(yHistory, 'y');
      if (activeHistory) add(activeHistory, 'active');
      let x: number | undefined;
      let y: number | undefined;
      // Initial coordinate states can precede the first activity state.
      let activity: 'pending' | 'on' | 'off' | 'unknown' = activeHistory?.length ? 'pending' : 'on';
      for (const [timestamp, updates] of [...events].sort(([a], [b]) => a - b)) {
        // Last entry wins for duplicate updates to an entity at one timestamp.
        const state = new Map(updates.map(update => [update.axis, update.state]));
        const previousActivity = activity;
        if (state.has('active')) {
          const value = state.get('active');
          activity = value === 'on' || value === 'off' ? value : 'unknown';
          if (activity === 'off' && previousActivity !== 'off') {
            // Discard pre-disappearance positions, but preserve known zero axes:
            // change-only firmware need not publish them again on return.
            if (x !== 0) x = undefined;
            if (y !== 0) y = undefined;
          }
        }
        const numeric = (value: string) => value.trim() === '' ? NaN : Number(value);
        const invalid = (['x', 'y'] as const).some(axis =>
          state.has(axis) && !Number.isFinite(numeric(state.get(axis)!)));
        if (activity === 'unknown' || invalid) {
          // Unknown/unavailable is not a numeric reset. Break both axes' continuity.
          x = y = undefined;
          continue;
        }
        const previousX = x;
        const previousY = y;
        if (state.has('x')) x = numeric(state.get('x')!);
        if (state.has('y')) y = numeric(state.get('y')!);
        // Keep numeric inactive/reset state for change-only recovery, but never
        // sample it while inactive or at the LD2450 origin sentinel. Activation
        // may sample coordinates published before activity, without looking ahead.
        if (activity !== 'on' || (x === 0 && y === 0)) continue;
        if (x !== undefined && y !== undefined &&
            (x !== previousX || y !== previousY || previousActivity !== 'on')) {
          points.push({ x, y, timestamp: new Date(timestamp), targetIndex: target.targetIndex });
        }
      }
    }
    points.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime() || a.targetIndex - b.targetIndex);
    logger.debug({ pointCount: points.length }, 'Reconstructed coordinate pairs');
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
