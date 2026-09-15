import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateTooltipPosition } from './tooltipPosition.ts';

const trigger = { left: 100, top: 100, right: 120, bottom: 120, width: 20, height: 20 };
const tooltip = { width: 80, height: 40 };
const viewport = { width: 320, height: 240 };

test('prefers the top placement when it fits', () => {
  assert.deepEqual(calculateTooltipPosition(trigger, tooltip, viewport), { left: 70, top: 52, placement: 'top' });
});

test('flips below when there is no room above', () => {
  const result = calculateTooltipPosition({ ...trigger, top: 10, bottom: 30 }, tooltip, viewport);
  assert.equal(result.placement, 'bottom');
  assert.equal(result.top, 38);
});

test('clamps the tooltip inside both horizontal viewport edges', () => {
  assert.equal(calculateTooltipPosition({ ...trigger, left: 0, width: 10 }, tooltip, viewport).left, 8);
  assert.equal(calculateTooltipPosition({ ...trigger, left: 310, width: 10 }, tooltip, viewport).left, 232);
});

test('uses current geometry so callers can recompute after scroll or resize', () => {
  const moved = calculateTooltipPosition({ ...trigger, top: 20, bottom: 40 }, tooltip, { width: 200, height: 160 });
  assert.deepEqual(moved, { left: 70, top: 48, placement: 'bottom' });
});
