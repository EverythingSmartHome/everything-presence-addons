import { Point, ZonePolygon, ZoneRect } from './types';

/**
 * Convert vertices to firmware text format: "x1:y1;x2:y2;..." (mm)
 */
export function polygonToText(vertices: Point[]): string {
  if (!vertices || vertices.length === 0) {
    return '';
  }
  return vertices
    .map(v => `${Math.round(v.x)}:${Math.round(v.y)}`)
    .join(';');
}

/**
 * Parse firmware text format into vertices. Returns [] for invalid input.
 */
export function textToPolygon(text: string): Point[] {
  if (!text || text.trim() === '') {
    return [];
  }

  const vertices: Point[] = [];
  const pairs = text.split(';');

  for (const pair of pairs) {
    const match = pair.match(/^(-?\d+):(-?\d+)$/);
    if (match) {
      vertices.push({
        x: parseInt(match[1], 10),
        y: parseInt(match[2], 10),
      });
    }
  }

  return vertices;
}

/**
 * Convert rectangle zone to polygon zone.
 */
export function rectToPolygon(rect: ZoneRect): ZonePolygon {
  const { id, type, x, y, width, height, enabled, label } = rect;

  const vertices: Point[] = [
    { x: x, y: y },
    { x: x + width, y: y },
    { x: x + width, y: y + height },
    { x: x, y: y + height },
  ];

  return {
    id,
    type,
    vertices,
    enabled,
    label,
  };
}

/**
 * Convert polygon zone to rectangle (bounding box).
 */
export function polygonToRect(polygon: ZonePolygon): ZoneRect {
  const { id, type, vertices, enabled, label } = polygon;

  if (vertices.length === 0) {
    return { id, type, x: 0, y: 0, width: 0, height: 0, enabled, label };
  }

  const xs = vertices.map(v => v.x);
  const ys = vertices.map(v => v.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    id,
    type,
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    enabled,
    label,
  };
}

/**
 * Check polygon has at least 3 distinct vertices.
 */
export function isValidPolygon(vertices: Point[]): boolean {
  if (vertices.length < 3) {
    return false;
  }
  const uniquePoints = new Set(vertices.map(v => `${v.x},${v.y}`));
  return uniquePoints.size >= 3;
}

/**
 * Calculate polygon area using shoelace formula.
 */
export function polygonArea(vertices: Point[]): number {
  if (vertices.length < 3) return 0;

  let area = 0;
  const n = vertices.length;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += vertices[i].x * vertices[j].y;
    area -= vertices[j].x * vertices[i].y;
  }

  return Math.abs(area) / 2;
}

/**
 * Calculate polygon centroid.
 */
export function polygonCentroid(vertices: Point[]): Point {
  if (vertices.length === 0) {
    return { x: 0, y: 0 };
  }

  const sumX = vertices.reduce((sum, v) => sum + v.x, 0);
  const sumY = vertices.reduce((sum, v) => sum + v.y, 0);

  return {
    x: sumX / vertices.length,
    y: sumY / vertices.length,
  };
}
