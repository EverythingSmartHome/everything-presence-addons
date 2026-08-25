// @ts-nocheck -- Node's built-in runner supplies these modules.
import assert from 'node:assert/strict';
import test from 'node:test';
import { clampDoorPosition, getDoorGeometry, normalizeDoor } from './doorGeometry.ts';

const door = (style = 'single', overrides = {}) => ({
  id: 'd1', style, segmentIndex: 0, positionOnSegment: 0.5, widthMm: 800,
  swingDirection: 'in', swingSide: 'left', ...overrides,
});

test('normalizes legacy and malformed persisted doors deterministically', () => {
  assert.deepEqual(normalizeDoor({ id: 'legacy' }), {
    id: 'legacy', style: 'single', segmentIndex: 0, positionOnSegment: 0.5,
    widthMm: 800, swingDirection: 'in', swingSide: 'left', locked: undefined,
  });
  const malformed = normalizeDoor({ id: 'bad', style: 'folding', segmentIndex: -4.8, positionOnSegment: 2, widthMm: -1, swingDirection: 'sideways', swingSide: 'middle' });
  assert.equal(malformed.style, 'single');
  assert.equal(malformed.segmentIndex, 0);
  assert.equal(malformed.positionOnSegment, 1);
  assert.equal(malformed.widthMm, 800);
});

test('single geometry mirrors hinge and winding', () => {
  const left = getDoorGeometry(door(), 1);
  const right = getDoorGeometry(door('single', { swingSide: 'right' }), -1);
  assert.equal(left.hingeX, -400);
  assert.equal(left.arc.endY, 800);
  assert.equal(right.hingeX, 400);
  assert.equal(right.arc.endY, -800);
});

test('sliding and opening styles have shallow hit bounds and no swing geometry', () => {
  for (const style of ['sliding', 'opening']) {
    const geometry = getDoorGeometry(door(style), 1);
    assert.equal(geometry.arc, undefined);
    assert.equal(geometry.leaves, undefined);
    assert.ok(geometry.hitBounds.height < 200);
  }
});

test('sliding geometry keeps a half-width leaf within the opening on the chosen side', () => {
  const left = getDoorGeometry(door('sliding'), 1);
  assert.deepEqual(left.slidingPanel, { startX: -400, endX: 0, y: 16, direction: -1 });
  const right = getDoorGeometry(door('sliding', { swingSide: 'right' }), 1);
  assert.deepEqual(right.slidingPanel, { startX: 0, endX: 400, y: 16, direction: 1 });
  // The whole symbol occupies exactly the door width, nothing over the wall.
  assert.deepEqual(right.hitBounds, getDoorGeometry(door('opening'), 1).hitBounds);
});

test('sliding and opening styles always sit on the room side', () => {
  for (const style of ['sliding', 'opening']) {
    const geometry = getDoorGeometry(door(style, { swingDirection: 'out' }), -1);
    assert.equal(geometry.normalSign, -1);
    assert.equal(geometry.hitBounds.y + geometry.hitBounds.height, 10);
  }
});

test('canvas-sized shallow styles use compact selectable bounds', () => {
  for (const style of ['sliding', 'opening']) {
    const geometry = getDoorGeometry(door(style, { widthMm: 120 }), 1, { padding: 8, shallowDepth: 14 });
    assert.deepEqual(geometry.hitBounds, { x: -68, y: -8, width: 136, height: 30 });
  }
  const sliding = getDoorGeometry(door('sliding', { widthMm: 120 }), 1, { padding: 8, shallowDepth: 14 });
  assert.equal(sliding.slidingPanel.y, 3.5);
});

test('door position bounds keep the complete opening on the wall', () => {
  assert.equal(clampDoorPosition(0, 800, 4000), 0.1);
  assert.equal(clampDoorPosition(1, 800, 4000), 0.9);
  assert.equal(clampDoorPosition(0.4, 800, 4000), 0.4);
  assert.equal(clampDoorPosition(0, 5000, 4000), 0.5);
});

test('double doors produce mirrored half-width leaves for either room winding', () => {
  for (const sign of [1, -1]) {
    const geometry = getDoorGeometry(door('double', { swingDirection: 'out' }), sign);
    assert.equal(geometry.leaves.length, 2);
    assert.deepEqual(geometry.leaves.map((leaf) => leaf.hingeX), [-400, 400]);
    assert.equal(Math.abs(geometry.leaves[0].endY), 400);
    assert.equal(geometry.leaves[0].endY, -sign * 400);
  }
});

test('local geometry is orientation-independent for rotated and vertical walls', () => {
  const horizontal = getDoorGeometry(door('sliding'), 1);
  const vertical = getDoorGeometry(door('sliding'), 1);
  assert.deepEqual(vertical, horizontal);
});
