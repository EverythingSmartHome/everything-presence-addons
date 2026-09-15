// @ts-nocheck -- Node's built-in runner supplies these modules; frontend production types stay dependency-free.
import assert from 'node:assert/strict';
import test from 'node:test';
import { MIN_POLYGON_VERTICES, canDeleteVertex, deleteVertex } from './polygonVertices.ts';

const square = [
  { x: 0, y: 0 },
  { x: 1000, y: 0 },
  { x: 1000, y: 1000 },
  { x: 0, y: 1000 },
];

test('minimum vertex count matches the backend polygon rule', () => {
  assert.equal(MIN_POLYGON_VERTICES, 3);
});

test('deletes a vertex above the minimum without mutating the input', () => {
  const next = deleteVertex(square, 1);
  assert.deepEqual(next, [
    { x: 0, y: 0 },
    { x: 1000, y: 1000 },
    { x: 0, y: 1000 },
  ]);
  assert.equal(square.length, 4);
  assert.notEqual(next, square);
});

test('refuses to delete at or below the minimum vertex count', () => {
  const triangle = square.slice(0, 3);
  for (let index = 0; index < triangle.length; index += 1) {
    assert.equal(canDeleteVertex(triangle, index), false);
    assert.equal(deleteVertex(triangle, index), triangle);
  }
});

test('refuses deletions that would leave fewer than three distinct points', () => {
  const degenerate = [
    { x: 0, y: 0 },
    { x: 1000, y: 0 },
    { x: 1000, y: 0 },
    { x: 0, y: 1000 },
  ];
  assert.equal(canDeleteVertex(degenerate, 3), false);
  assert.equal(deleteVertex(degenerate, 3), degenerate);
  // Removing one half of the duplicate pair still leaves three distinct points.
  assert.equal(canDeleteVertex(degenerate, 2), true);
  assert.equal(deleteVertex(degenerate, 2).length, 3);
});

test('rejects out-of-range and non-integer indexes', () => {
  for (const invalid of [-1, 4, 1.5, Number.NaN]) {
    assert.equal(canDeleteVertex(square, invalid), false);
    assert.equal(deleteVertex(square, invalid), square);
  }
});

test('tolerates missing vertex lists', () => {
  assert.equal(canDeleteVertex(undefined, 0), false);
  assert.equal(canDeleteVertex(null, 0), false);
  assert.equal(canDeleteVertex([], 0), false);
});
