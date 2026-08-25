// @ts-nocheck -- Node's built-in runner supplies these modules; frontend production types stay dependency-free.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canRotateRoomSnapshot,
  getPointsBoundsCenter,
  getRotationPivot,
  normalizeFurnitureAngle,
  normalizeSignedAngle,
  normalizeUnsignedAngle,
  rotatePoint,
  rotatePointsKeepingBoundsCenter,
  rotateRoomSnapshot,
} from './roomRotation.ts';

const rect = (width, length) => [
  { x: -width / 2, y: -length / 2 },
  { x: width / 2, y: -length / 2 },
  { x: width / 2, y: length / 2 },
  { x: -width / 2, y: length / 2 },
];

const makeSnapshot = (overrides = {}) => ({
  roomShell: { points: rect(4000, 2000) },
  roomShellFillMode: 'solid',
  floorMaterial: 'wood',
  devicePlacement: { x: 0, y: -1000, rotationDeg: 90, mountType: 'wall' },
  furniture: [
    { id: 'f1', typeId: 'bed-double', x: 1000, y: 500, width: 1400, depth: 2000, height: 500, rotationDeg: 30, aspectRatioLocked: false },
  ],
  doors: [{ id: 'd1', segmentIndex: 2, positionOnSegment: 0.4, widthMm: 800, swingDirection: 'in', swingSide: 'left' }],
  ...overrides,
});

/** The device -> room mapping every screen duplicates, for the rigidity check below. */
const deviceToRoom = (placement, installationAngleDeg, point) => {
  const rad = (((placement.rotationDeg ?? 0) + installationAngleDeg) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: point.x * cos - point.y * sin + placement.x,
    y: point.x * sin + point.y * cos + placement.y,
  };
};

/**
 * Tolerance is always explicit: the util rounds every coordinate to 0.001 mm,
 * so anything compared against an unrounded reference has to allow at least
 * that, and a silent default would hide which comparison needed the slack.
 */
const closeTo = (actual, expected, tolerance) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );

test('normalizeSignedAngle folds into (-180, 180] to match the device slider', () => {
  assert.equal(normalizeSignedAngle(0), 0);
  assert.equal(normalizeSignedAngle(90), 90);
  assert.equal(normalizeSignedAngle(270), -90);
  assert.equal(normalizeSignedAngle(-270), 90);
  assert.equal(normalizeSignedAngle(180), 180);
  assert.equal(normalizeSignedAngle(-180), 180);
  assert.equal(normalizeSignedAngle(540), 180);
  assert.equal(normalizeSignedAngle(Number.NaN), 0);
});

test('normalizeFurnitureAngle folds into [0, 360)', () => {
  assert.equal(normalizeFurnitureAngle(0), 0);
  assert.equal(normalizeFurnitureAngle(360), 0);
  assert.equal(normalizeFurnitureAngle(-90), 270);
  assert.equal(normalizeFurnitureAngle(450), 90);
  assert.equal(normalizeFurnitureAngle(Number.NaN), 0);
});

test('normalizeUnsignedAngle is the [0, 360) fold the Wizard slider needs', () => {
  // The Wizard's device rotation slider is 0..359, so a signed heading coming
  // out of a rotation has to be folded before it reaches that control.
  assert.equal(normalizeUnsignedAngle(-90), 270);
  assert.equal(normalizeUnsignedAngle(-180), 180);
  assert.equal(normalizeUnsignedAngle(180), 180);
  assert.equal(normalizeUnsignedAngle(0), 0);
  assert.equal(normalizeUnsignedAngle(Number.NaN), 0);
  // The furniture normaliser is the same fold under a domain-specific name.
  assert.equal(normalizeUnsignedAngle, normalizeFurnitureAngle);
});

test('a quarter turn is exact, so four of them are the identity', () => {
  assert.deepEqual(rotatePoint({ x: 1000, y: 0 }, 90), { x: 0, y: 1000 });
  assert.deepEqual(rotatePoint({ x: 1000, y: 0 }, -90), { x: 0, y: -1000 });
  assert.deepEqual(rotatePoint({ x: 1000, y: 250 }, 180), { x: -1000, y: -250 });

  let point = { x: 1234.5, y: -678.25 };
  for (let i = 0; i < 4; i += 1) point = rotatePoint(point, 90);
  assert.deepEqual(point, { x: 1234.5, y: -678.25 });
});

test('a regenerated basic shape can be put back at its current orientation', () => {
  // resizeBasicRoomShapeWall always hands back an axis-aligned, bounds-centred
  // outline, so this is what keeps a rotated room rotated after a wall edit.
  const shape = rect(4000, 2000);
  const turned = rotatePointsKeepingBoundsCenter(shape, 90);
  assert.deepEqual(turned, [
    { x: 1000, y: -2000 },
    { x: 1000, y: 2000 },
    { x: -1000, y: 2000 },
    { x: -1000, y: -2000 },
  ]);
  // Point order is preserved, so wall indices still address the same parametric
  // segment they came from.
  assert.equal(turned.length, shape.length);
  assert.deepEqual(getPointsBoundsCenter(turned), { x: 0, y: 0 });
});

test('putting a shape back at its orientation keeps its bounds centre put', () => {
  // A quarter turn already preserves the bounding-box centre; an arbitrary angle
  // does not, so the helper re-centres.
  const offset = rect(4000, 2000).map((point) => ({ x: point.x + 5000, y: point.y - 3000 }));
  for (const angle of [90, 180, -90, 37.5, -12]) {
    const turned = rotatePointsKeepingBoundsCenter(offset, angle);
    const center = getPointsBoundsCenter(turned);
    closeTo(center.x, 5000, 0.01);
    closeTo(center.y, -3000, 0.01);
  }
});

test('putting a shape back at zero degrees is a no-op copy', () => {
  const shape = rect(3000, 3000);
  const same = rotatePointsKeepingBoundsCenter(shape, 0);
  assert.deepEqual(same, shape);
  assert.notEqual(same, shape, 'returns a copy, never the caller\'s array');
  assert.deepEqual(rotatePointsKeepingBoundsCenter([], 90), []);
  assert.deepEqual(rotatePointsKeepingBoundsCenter(null, 90), []);
});

test('rotation happens about the given pivot', () => {
  assert.deepEqual(rotatePoint({ x: 2000, y: 1000 }, 90, { x: 1000, y: 1000 }), { x: 1000, y: 2000 });
});

test('bounds centre is used as the default pivot, device position for roomOnly', () => {
  assert.deepEqual(getPointsBoundsCenter(rect(4000, 2000)), { x: 0, y: 0 });
  assert.equal(getPointsBoundsCenter([]), null);
  assert.equal(getPointsBoundsCenter(null), null);

  const snapshot = makeSnapshot();
  assert.deepEqual(getRotationPivot(snapshot, 'layout'), { x: 0, y: 0 });
  assert.deepEqual(getRotationPivot(snapshot, 'roomOnly'), { x: 0, y: -1000 });
  // No sensor placed yet: roomOnly has nothing to pivot on, so it falls back.
  assert.deepEqual(
    getRotationPivot(makeSnapshot({ devicePlacement: undefined }), 'roomOnly'),
    { x: 0, y: 0 },
  );
});

test('layout scope turns the outline and keeps point order (so walls and doors keep their indices)', () => {
  const before = makeSnapshot();
  const after = rotateRoomSnapshot(before, 90, 'layout');

  assert.deepEqual(after.roomShell.points, [
    { x: 1000, y: -2000 },
    { x: 1000, y: 2000 },
    { x: -1000, y: 2000 },
    { x: -1000, y: -2000 },
  ]);
  assert.deepEqual(after.doors, before.doors);
  assert.notEqual(after.doors, before.doors, 'doors are copied, not shared with the source snapshot');
  assert.deepEqual(before.roomShell.points, rect(4000, 2000), 'input snapshot is not mutated');
});

test('layout scope moves the sensor and adds the same angle to its heading', () => {
  const after = rotateRoomSnapshot(makeSnapshot(), 90, 'layout');
  assert.deepEqual(
    { x: after.devicePlacement.x, y: after.devicePlacement.y },
    { x: 1000, y: 0 },
  );
  assert.equal(after.devicePlacement.rotationDeg, 180);
  assert.equal(after.devicePlacement.mountType, 'wall', 'unrelated placement fields survive');
});

test('layout scope is rigid: every device-frame point maps to the rotated room point', () => {
  // Zones, live targets and the heatmap are all device-frame, so if this holds
  // they follow the walls on every screen with no extra code.
  const before = makeSnapshot();
  const angle = 90;
  const after = rotateRoomSnapshot(before, angle, 'layout');
  const pivot = getRotationPivot(before, 'layout');

  for (const installationAngle of [0, -45, 17.5, 45]) {
    for (const probe of [{ x: 0, y: 0 }, { x: 1500, y: 3000 }, { x: -2200, y: 800 }]) {
      const expected = rotatePoint(deviceToRoom(before.devicePlacement, installationAngle, probe), angle, pivot);
      const actual = deviceToRoom(after.devicePlacement, installationAngle, probe);
      // Tolerance is the util's own mm rounding, not float noise.
      closeTo(actual.x, expected.x, 0.01);
      closeTo(actual.y, expected.y, 0.01);
    }
  }
});

test('roomOnly scope leaves the sensor completely alone and pivots on it', () => {
  const before = makeSnapshot();
  const after = rotateRoomSnapshot(before, 90, 'roomOnly');

  assert.deepEqual(after.devicePlacement, before.devicePlacement);
  // Pivot is the sensor at (0, -1000): the wall it is mounted on swings with it,
  // which is the same result as the layout rotation shifted by pivot - R(pivot).
  assert.deepEqual(after.roomShell.points, [
    { x: 0, y: -3000 },
    { x: 0, y: 1000 },
    { x: -2000, y: 1000 },
    { x: -2000, y: -3000 },
  ]);
});

test('furniture is carried round and re-aimed by the same angle', () => {
  const after = rotateRoomSnapshot(makeSnapshot(), 90, 'layout');
  const item = after.furniture[0];
  assert.deepEqual({ x: item.x, y: item.y }, { x: -500, y: 1000 });
  assert.equal(item.rotationDeg, 120);
  assert.equal(item.width, 1400, 'dimensions are untouched');

  const backAgain = rotateRoomSnapshot(after, -90, 'layout');
  assert.deepEqual(
    { x: backAgain.furniture[0].x, y: backAgain.furniture[0].y },
    { x: 1000, y: 500 },
  );
  assert.equal(backAgain.furniture[0].rotationDeg, 30);
});

test('furniture rotation stays inside [0, 360)', () => {
  const snapshot = makeSnapshot();
  snapshot.furniture[0].rotationDeg = 300;
  assert.equal(rotateRoomSnapshot(snapshot, 90, 'layout').furniture[0].rotationDeg, 30);
});

test('rotation moves pinned objects too, and preserves the locks themselves', () => {
  const before = makeSnapshot();
  before.roomShell.locked = true;
  before.roomShell.lockedSegments = [1, 2];
  before.furniture[0].locked = true;
  before.doors[0].locked = true;
  before.devicePlacement.locked = true;

  const after = rotateRoomSnapshot(before, 90, 'layout');
  assert.equal(after.roomShell.locked, true);
  assert.deepEqual(after.roomShell.lockedSegments, [1, 2]);
  assert.notEqual(after.roomShell.lockedSegments, before.roomShell.lockedSegments);
  assert.equal(after.furniture[0].locked, true);
  assert.equal(after.doors[0].locked, true);
  assert.equal(after.devicePlacement.locked, true);
  // A pinned device still moves in layout scope: skipping it would desynchronise
  // every zone from the walls.
  assert.deepEqual({ x: after.devicePlacement.x, y: after.devicePlacement.y }, { x: 1000, y: 0 });
  assert.notDeepEqual(after.roomShell.points, before.roomShell.points);
});

test('no-op rotations and empty rooms are returned untouched', () => {
  const snapshot = makeSnapshot();
  assert.equal(rotateRoomSnapshot(snapshot, 0, 'layout'), snapshot);
  assert.equal(rotateRoomSnapshot(snapshot, 360, 'layout'), snapshot);

  const empty = makeSnapshot({ roomShell: { points: [] } });
  assert.equal(canRotateRoomSnapshot(empty), false);
  assert.equal(canRotateRoomSnapshot(snapshot), true);
  assert.equal(rotateRoomSnapshot(empty, 90, 'layout'), empty);
});

test('rooms without furniture, doors or a sensor rotate without inventing fields', () => {
  const bare = { roomShell: { points: rect(3000, 3000) } };
  const after = rotateRoomSnapshot(bare, 90, 'layout');
  assert.equal(after.furniture, undefined);
  assert.equal(after.doors, undefined);
  assert.equal(after.devicePlacement, undefined);
  assert.equal(after.roomShell.points.length, 4);
});

test('an arbitrary angle round-trips within mm rounding', () => {
  const before = makeSnapshot();
  const there = rotateRoomSnapshot(before, 37.5, 'layout');
  const back = rotateRoomSnapshot(there, -37.5, 'layout');
  back.roomShell.points.forEach((point, index) => {
    closeTo(point.x, before.roomShell.points[index].x, 0.01);
    closeTo(point.y, before.roomShell.points[index].y, 0.01);
  });
  closeTo(back.devicePlacement.rotationDeg, 90, 0.01);
});
