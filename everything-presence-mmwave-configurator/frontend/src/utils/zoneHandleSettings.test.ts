// @ts-nocheck -- Node built-in test modules.
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeZoneHandleSize, zoneHandleUnit } from './zoneHandleSettings.ts';

test('legacy and malformed preferences default; finite values are bounded', () => {
  for (const value of [undefined, null, '12', NaN, Infinity, {}, false]) {
    assert.equal(normalizeZoneHandleSize(value), 8);
  }
  assert.equal(normalizeZoneHandleSize(-3), 6);
  assert.equal(normalizeZoneHandleSize(100), 14);
});

test('JSON persisted preference survives reload normalization', () => {
  const stored = JSON.stringify({ zoneHandleSize: normalizeZoneHandleSize(12) });
  assert.equal(normalizeZoneHandleSize(JSON.parse(stored).zoneHandleSize), 12);
  assert.equal(normalizeZoneHandleSize(JSON.parse('{}').zoneHandleSize), 8);
});

test('screen radius stays constant across zoom and rectangular viewports', () => {
  for (const [width, height] of [[1724, 700], [360, 520], [700, 700]]) {
    for (const zoom of [0.1, 0.5, 1, 2, 5]) {
      const pixelsPerUnit = Math.min(width, height) / (700 / zoom);
      assert.ok(Math.abs(8 * zoneHandleUnit(zoom, width, height) * pixelsPerUnit - 8) < 1e-9);
    }
  }
  assert.equal(zoneHandleUnit(100, 700, 700), 0.2);
  assert.equal(zoneHandleUnit(NaN, 700, 700), 1);
});
