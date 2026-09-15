// @ts-nocheck -- Node's built-in runner supplies these modules; frontend production types stay dependency-free.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CENTERING_TOLERANCE_MM,
  canCenterRoomSnapshot,
  centerRoomSnapshot,
  getRoomCenteringOffset,
  isRoomCentered,
  translateRoomSnapshot,
} from './roomCentering.ts';
import { getPointsBoundsCenter, rotateRoomSnapshot } from './roomRotation.ts';

/** A rectangle of `width` x `length`, with its bounding-box centre at `center`. */
const rectAt = (width, length, center = { x: 0, y: 0 }) => [
  { x: center.x - width / 2, y: center.y - length / 2 },
  { x: center.x + width / 2, y: center.y - length / 2 },
  { x: center.x + width / 2, y: center.y + length / 2 },
  { x: center.x - width / 2, y: center.y + length / 2 },
];

const makeSnapshot = (overrides = {}) => ({
  roomShell: { points: rectAt(4000, 2000, { x: 10000, y: -7000 }) },
  roomShellFillMode: 'solid',
  floorMaterial: 'wood',
  devicePlacement: { x: 10000, y: -8000, rotationDeg: 90, mountType: 'wall' },
  furniture: [
    { id: 'f1', typeId: 'bed-double', x: 11000, y: -6500, width: 1400, depth: 2000, height: 500, rotationDeg: 30, aspectRatioLocked: false },
  ],
  doors: [{ id: 'd1', style: 'double', segmentIndex: 2, positionOnSegment: 0.4, widthMm: 1600, swingDirection: 'out', swingSide: 'right' }],
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

test('getRoomCenteringOffset is the negated bounds centre', () => {
  const snapshot = makeSnapshot();
  assert.deepEqual(getRoomCenteringOffset(snapshot), { x: -10000, y: 7000 });
});

test('getRoomCenteringOffset uses the same centre definition as the rotation pivot', () => {
  // One definition of "the centre of the room" across the app: if these ever
  // diverge, a re-centre and a rotation would disagree about where the room is.
  const snapshot = makeSnapshot({ roomShell: { points: [
    { x: 1000, y: 2000 },
    { x: 5000, y: 2500 },
    { x: 4000, y: 9000 },
  ] } });
  const center = getPointsBoundsCenter(snapshot.roomShell.points);
  assert.deepEqual(getRoomCenteringOffset(snapshot), { x: -center.x, y: -center.y });
});

test('getRoomCenteringOffset returns null without an outline', () => {
  // No walls means no room to centre; translating a lone device marker onto the
  // origin would silently move the sensor away from where the user put it.
  assert.equal(getRoomCenteringOffset(makeSnapshot({ roomShell: undefined })), null);
  assert.equal(getRoomCenteringOffset(makeSnapshot({ roomShell: { points: [] } })), null);
  assert.equal(getRoomCenteringOffset(null), null);
  assert.equal(getRoomCenteringOffset(undefined), null);
});

test('canCenterRoomSnapshot needs at least one outline point', () => {
  assert.equal(canCenterRoomSnapshot(makeSnapshot()), true);
  assert.equal(canCenterRoomSnapshot(makeSnapshot({ roomShell: { points: [] } })), false);
  assert.equal(canCenterRoomSnapshot(makeSnapshot({ roomShell: undefined })), false);
  assert.equal(canCenterRoomSnapshot(null), false);
});

test('centerRoomSnapshot puts the outline bounds centre on the origin', () => {
  const centered = centerRoomSnapshot(makeSnapshot());
  const center = getPointsBoundsCenter(centered.roomShell.points);
  closeTo(center.x, 0, CENTERING_TOLERANCE_MM);
  closeTo(center.y, 0, CENTERING_TOLERANCE_MM);
  assert.deepEqual(centered.roomShell.points, rectAt(4000, 2000));
});

test('centerRoomSnapshot moves the sensor and furniture by the same offset', () => {
  const snapshot = makeSnapshot();
  const centered = centerRoomSnapshot(snapshot);

  // Device and furniture keep their positions *relative to the walls*.
  assert.deepEqual(
    { x: centered.devicePlacement.x, y: centered.devicePlacement.y },
    { x: 0, y: -1000 },
  );
  assert.deepEqual({ x: centered.furniture[0].x, y: centered.furniture[0].y }, { x: 1000, y: 500 });

  // A translation is not a rotation: no heading may change.
  assert.equal(centered.devicePlacement.rotationDeg, snapshot.devicePlacement.rotationDeg);
  assert.equal(centered.furniture[0].rotationDeg, snapshot.furniture[0].rotationDeg);
});

test('centering is rigid: device-frame points land exactly offset in room space', () => {
  // The load-bearing claim. Zones, live targets, the heatmap and the FOV cone
  // are all device-relative mm mapped through `deviceToRoom`; if this holds,
  // every one of them follows the walls with no change at those call sites.
  const snapshot = makeSnapshot();
  const centered = centerRoomSnapshot(snapshot);
  const offset = getRoomCenteringOffset(snapshot);
  const installationAngleDeg = 17;

  for (const probe of [{ x: 0, y: 0 }, { x: 1500, y: -2200 }, { x: -900, y: 3400 }]) {
    const before = deviceToRoom(snapshot.devicePlacement, installationAngleDeg, probe);
    const after = deviceToRoom(centered.devicePlacement, installationAngleDeg, probe);
    closeTo(after.x - before.x, offset.x, 0.001);
    closeTo(after.y - before.y, offset.y, 0.001);
  }
});

test('centerRoomSnapshot leaves doors, locks and non-geometry fields alone', () => {
  const snapshot = makeSnapshot({
    roomShell: { points: rectAt(4000, 2000, { x: 10000, y: -7000 }), locked: true, lockedSegments: [1, 3] },
  });
  const centered = centerRoomSnapshot(snapshot);

  // Doors are wall-relative, so they ride along untouched.
  assert.deepEqual(centered.doors, snapshot.doors);
  // ...but as copies, so a later edit cannot reach back through the snapshot.
  assert.notEqual(centered.doors, snapshot.doors);
  assert.notEqual(centered.doors[0], snapshot.doors[0]);

  // Wall indices survive because point order does.
  assert.deepEqual(centered.roomShell.lockedSegments, [1, 3]);
  assert.notEqual(centered.roomShell.lockedSegments, snapshot.roomShell.lockedSegments);
  assert.equal(centered.roomShell.locked, true);

  assert.equal(centered.roomShellFillMode, 'solid');
  assert.equal(centered.floorMaterial, 'wood');
});

test('centerRoomSnapshot never mutates its input', () => {
  const snapshot = makeSnapshot();
  const before = JSON.stringify(snapshot);
  centerRoomSnapshot(snapshot);
  assert.equal(JSON.stringify(snapshot), before);
});

test('centerRoomSnapshot is a no-op on an already-centred room', () => {
  // Identity, not just equality: the caller tests `result === snapshot` to
  // decide whether anything happened, so a repeat Save spends no undo step.
  const snapshot = makeSnapshot({
    roomShell: { points: rectAt(4000, 2000) },
    devicePlacement: { x: 0, y: -1000, rotationDeg: 90, mountType: 'wall' },
  });
  assert.equal(centerRoomSnapshot(snapshot), snapshot);
});

test('centerRoomSnapshot is idempotent', () => {
  const once = centerRoomSnapshot(makeSnapshot());
  assert.equal(centerRoomSnapshot(once), once);
});

test('centerRoomSnapshot is a no-op without an outline', () => {
  const snapshot = makeSnapshot({ roomShell: { points: [] } });
  assert.equal(centerRoomSnapshot(snapshot), snapshot);
});

test('centerRoomSnapshot handles a room with no device or furniture', () => {
  const snapshot = {
    roomShell: { points: rectAt(4000, 2000, { x: 3000, y: 3000 }) },
    roomShellFillMode: 'overlay',
    floorMaterial: 'none',
    devicePlacement: undefined,
    furniture: undefined,
    doors: undefined,
  };
  const centered = centerRoomSnapshot(snapshot);
  assert.deepEqual(getPointsBoundsCenter(centered.roomShell.points), { x: 0, y: 0 });
  assert.equal(centered.devicePlacement, undefined);
  assert.equal(centered.furniture, undefined);
  assert.equal(centered.doors, undefined);
});

test('centerRoomSnapshot centres an odd-span outline within tolerance', () => {
  // An odd number of millimetres puts the bounds centre on a half-mm, so this
  // is the shape most likely to leave a residue behind - and the second call
  // below is the guard that a repeat Save still spends no undo step.
  const snapshot = makeSnapshot({ roomShell: { points: [
    { x: 0, y: 0 },
    { x: 4001, y: 0 },
    { x: 4001, y: 2001 },
    { x: 0, y: 2001 },
  ] } });
  const centered = centerRoomSnapshot(snapshot);
  const center = getPointsBoundsCenter(centered.roomShell.points);
  closeTo(center.x, 0, CENTERING_TOLERANCE_MM);
  closeTo(center.y, 0, CENTERING_TOLERANCE_MM);
  assert.equal(isRoomCentered(centered), true);
  // ...and having absorbed it, it must not try again.
  assert.equal(centerRoomSnapshot(centered), centered);
});

test('isRoomCentered reports the origin case and respects its tolerance', () => {
  assert.equal(isRoomCentered(makeSnapshot()), false);
  assert.equal(isRoomCentered(centerRoomSnapshot(makeSnapshot())), true);

  const nudged = makeSnapshot({ roomShell: { points: rectAt(4000, 2000, { x: 100, y: 0 }) } });
  assert.equal(isRoomCentered(nudged), false);
  assert.equal(isRoomCentered(nudged, 200), true);

  // No outline: nothing to move, so the buttons that read this stay disabled.
  assert.equal(isRoomCentered(makeSnapshot({ roomShell: { points: [] } })), true);
  assert.equal(isRoomCentered(null), true);
});

test('translateRoomSnapshot applies an arbitrary offset and is identity on zero', () => {
  const snapshot = makeSnapshot({
    roomShell: { points: rectAt(4000, 2000) },
    devicePlacement: { x: 0, y: -1000, rotationDeg: 90, mountType: 'wall' },
  });
  const moved = translateRoomSnapshot(snapshot, { x: 250, y: -125.5 });
  assert.deepEqual(getPointsBoundsCenter(moved.roomShell.points), { x: 250, y: -125.5 });
  assert.deepEqual({ x: moved.devicePlacement.x, y: moved.devicePlacement.y }, { x: 250, y: -1125.5 });

  assert.equal(translateRoomSnapshot(snapshot, { x: 0, y: 0 }), snapshot);
  assert.equal(translateRoomSnapshot(snapshot, null), snapshot);
  assert.equal(translateRoomSnapshot(snapshot, undefined), snapshot);
  // A non-finite component must not poison a coordinate.
  assert.equal(translateRoomSnapshot(snapshot, { x: Number.NaN, y: Number.NaN }), snapshot);
});

test('centring and rotating stay orthogonal and commute about the origin', () => {
  // The two transforms are deliberately separate repairs. Centring first then
  // rotating must land in the same place as rotating first then centring,
  // because a centred room's rotation pivot IS the origin.
  const snapshot = makeSnapshot();
  const a = rotateRoomSnapshot(centerRoomSnapshot(snapshot), 90, 'layout');
  const b = centerRoomSnapshot(rotateRoomSnapshot(snapshot, 90, 'layout'));

  a.roomShell.points.forEach((point, i) => {
    closeTo(point.x, b.roomShell.points[i].x, 0.001);
    closeTo(point.y, b.roomShell.points[i].y, 0.001);
  });
  closeTo(a.devicePlacement.x, b.devicePlacement.x, 0.001);
  closeTo(a.devicePlacement.y, b.devicePlacement.y, 0.001);
  assert.equal(a.devicePlacement.rotationDeg, b.devicePlacement.rotationDeg);
});
