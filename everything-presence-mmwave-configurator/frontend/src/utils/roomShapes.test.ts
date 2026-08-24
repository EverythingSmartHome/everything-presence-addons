// @ts-nocheck -- Node's built-in runner supplies these modules; frontend production types stay dependency-free.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createLShapePoints, createRectanglePoints } from './roomShapes.ts';

const bounds = (points) => ({
  minX: Math.min(...points.map((point) => point.x)),
  maxX: Math.max(...points.map((point) => point.x)),
  minY: Math.min(...points.map((point) => point.y)),
  maxY: Math.max(...points.map((point) => point.y)),
});

test('rectangle is consistently ordered and centered for odd dimensions', () => {
  const points = createRectanglePoints({ width: 4001, length: 3001 });
  assert.deepEqual(points, [
    { x: -2000.5, y: -1500.5 }, { x: 2000.5, y: -1500.5 },
    { x: 2000.5, y: 1500.5 }, { x: -2000.5, y: 1500.5 },
  ]);
});

test('L-shape is centered, orthogonal, and concave', () => {
  const points = createLShapePoints({ width: 5000, length: 4000, cutoutWidth: 2000, cutoutLength: 1500 });
  assert.deepEqual(bounds(points), { minX: -2500, maxX: 2500, minY: -2000, maxY: 2000 });
  assert.equal(points.length, 6);
  assert.deepEqual(points[3], { x: 500, y: 500 });
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    assert.ok(point.x === next.x || point.y === next.y);
  });
});

test('accepts small positive boundary values', () => {
  assert.equal(createRectanglePoints({ width: Number.MIN_VALUE, length: 1 }).length, 4);
  assert.equal(createLShapePoints({ width: 2, length: 2, cutoutWidth: 1, cutoutLength: 1 }).length, 6);
});

test('rejects invalid dimensions and oversized cutouts', () => {
  for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => createRectanglePoints({ width: invalid, length: 1 }));
  }
  assert.throws(() => createLShapePoints({ width: 4, length: 4, cutoutWidth: 4, cutoutLength: 1 }));
  assert.throws(() => createLShapePoints({ width: 4, length: 4, cutoutWidth: 1, cutoutLength: 5 }));
});
