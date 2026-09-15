// @ts-nocheck -- Node's built-in runner supplies these modules; frontend production types stay dependency-free.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyDevicePlacementUpdate,
  areAllItemsLocked,
  areAllSegmentsLocked,
  countLockedObjects,
  isDevicePositionLocked,
  getLockedSegments,
  isSegmentLocked,
  isShellLocked,
  isVertexLocked,
  normalizeLockedSegments,
  remapDoorsForPointRemoval,
  remapDoorsForSplit,
  remapLockedSegmentsForPointRemoval,
  remapLockedSegmentsForSplit,
  remapSegmentIndexForPointRemoval,
  resolveLockedUpdate,
  setItemsLocked,
  setShellLocked,
  toggleSegmentLock,
} from './lockState.ts';

const square = () => ({
  points: [
    { x: 0, y: 0 },
    { x: 1000, y: 0 },
    { x: 1000, y: 1000 },
    { x: 0, y: 1000 },
  ],
});

test('an outline with no lock fields is entirely unlocked', () => {
  const shell = square();
  assert.equal(isShellLocked(shell), false);
  assert.equal(isSegmentLocked(shell, 0), false);
  assert.equal(isVertexLocked(shell, 0, 4), false);
  assert.deepEqual(getLockedSegments(shell, 4), []);
  assert.equal(areAllSegmentsLocked(shell), false);
  assert.equal(countLockedObjects({ roomShell: shell }), 0);
});

test('locking the whole outline locks every wall', () => {
  const shell = setShellLocked(square(), true);
  assert.equal(isShellLocked(shell), true);
  assert.deepEqual(getLockedSegments(shell, 4), [0, 1, 2, 3]);
  assert.equal(isSegmentLocked(shell, 2), true);
  assert.equal(areAllSegmentsLocked(shell), true);

  const unlocked = setShellLocked(shell, false);
  assert.equal(unlocked.locked, undefined);
  assert.deepEqual(getLockedSegments(unlocked, 4), []);
});

test('toggling one wall off an outline-wide lock keeps the rest pinned', () => {
  const shell = toggleSegmentLock(setShellLocked(square(), true), 1);
  assert.equal(shell.locked, undefined);
  assert.deepEqual(shell.lockedSegments, [0, 2, 3]);
  assert.equal(isSegmentLocked(shell, 1), false);
  assert.equal(isSegmentLocked(shell, 3), true);
});

test('locking every wall one at a time collapses back to the outline lock', () => {
  let shell = square();
  for (const index of [0, 1, 2, 3]) shell = toggleSegmentLock(shell, index);
  assert.equal(shell.locked, true);
  assert.equal(shell.lockedSegments, undefined);
  assert.equal(areAllSegmentsLocked(shell), true);
});

test('a corner is locked when either wall it joins is locked', () => {
  const shell = { ...square(), lockedSegments: [1] };
  // Wall 1 spans corners 1 -> 2, so both of those are pinned.
  assert.equal(isVertexLocked(shell, 1, 4), true);
  assert.equal(isVertexLocked(shell, 2, 4), true);
  assert.equal(isVertexLocked(shell, 0, 4), false);
  assert.equal(isVertexLocked(shell, 3, 4), false);
});

test('out-of-range and duplicate wall indices are dropped', () => {
  assert.deepEqual(normalizeLockedSegments([3, 3, 0, -1, 9, 1.5], 4), [0, 3]);
  assert.deepEqual(normalizeLockedSegments(undefined, 4), []);
  assert.deepEqual(normalizeLockedSegments([0], 0), []);
});

test('splitting a wall shifts later locks up and keeps both halves locked', () => {
  // Walls 0 and 2 locked; wall 0 is split into 0 and 1.
  assert.deepEqual(remapLockedSegmentsForSplit([0, 2], 0), [0, 1, 3]);
  // A split after the locked wall leaves it where it was.
  assert.deepEqual(remapLockedSegmentsForSplit([0], 2), [0]);
  assert.deepEqual(remapLockedSegmentsForSplit(undefined, 1), []);
});

test('splitting a wall moves the doors on it onto the right half', () => {
  const doors = [
    { id: 'before', segmentIndex: 0, positionOnSegment: 0.2, widthMm: 800 },
    { id: 'on-split', segmentIndex: 1, positionOnSegment: 0.25, widthMm: 800 },
    { id: 'later', segmentIndex: 3, positionOnSegment: 0.5, widthMm: 800 },
  ];
  const next = remapDoorsForSplit(doors, 1, 0.5);

  assert.deepEqual(next[0], doors[0]); // untouched: earlier wall
  // Halfway split, door at 25% of the old wall -> 50% of the first half.
  assert.equal(next[1].segmentIndex, 1);
  assert.equal(next[1].positionOnSegment, 0.5);
  // Everything after the split shifts up one wall.
  assert.equal(next[2].segmentIndex, 4);
});

test('a door past the split point moves onto the second half', () => {
  const doors = [{ id: 'd', segmentIndex: 0, positionOnSegment: 0.75, widthMm: 800 }];
  const [door] = remapDoorsForSplit(doors, 0, 0.5);
  assert.equal(door.segmentIndex, 1);
  assert.equal(door.positionOnSegment, 0.5);
});

test('deleting a corner merges its two walls', () => {
  // Square, remove corner 2: walls 1 and 2 merge into wall 1.
  assert.equal(remapSegmentIndexForPointRemoval(0, 2, 4), 0);
  assert.equal(remapSegmentIndexForPointRemoval(1, 2, 4), 1);
  assert.equal(remapSegmentIndexForPointRemoval(2, 2, 4), 1);
  assert.equal(remapSegmentIndexForPointRemoval(3, 2, 4), 2);
});

test('deleting corner 0 merges the closing wall with the first one', () => {
  // Removing corner 0 merges walls 3 and 0 into the new last wall, 2.
  assert.equal(remapSegmentIndexForPointRemoval(3, 0, 4), 2);
  assert.equal(remapSegmentIndexForPointRemoval(0, 0, 4), 2);
  assert.equal(remapSegmentIndexForPointRemoval(1, 0, 4), 0);
  assert.equal(remapSegmentIndexForPointRemoval(2, 0, 4), 1);
});

test('locks and doors follow a deleted corner', () => {
  assert.deepEqual(remapLockedSegmentsForPointRemoval([0, 3], 2, 4), [0, 2]);
  // Both walls either side of the removed corner were locked - they merge into one.
  assert.deepEqual(remapLockedSegmentsForPointRemoval([1, 2], 2, 4), [1]);
  // A two-point outline cannot survive another deletion, so nothing is carried over.
  assert.deepEqual(remapLockedSegmentsForPointRemoval([0], 1, 2), []);

  const doors = [
    { id: 'a', segmentIndex: 3, positionOnSegment: 0.5, widthMm: 800 },
    { id: 'b', segmentIndex: 0, positionOnSegment: 0.5, widthMm: 800 },
  ];
  const next = remapDoorsForPointRemoval(doors, 2, 4);
  assert.equal(next[0].segmentIndex, 2);
  assert.equal(next[1], doors[1]); // unchanged doors are passed straight through
});

test('a locked item accepts nothing but being unlocked', () => {
  const locked = { id: 'f1', x: 0, locked: true };

  // A drag or slider event on a locked item is dropped entirely.
  assert.equal(resolveLockedUpdate(locked, { ...locked, x: 500 }), null);
  // Unlocking is the one edit that gets through, and only the unlock applies.
  assert.deepEqual(resolveLockedUpdate(locked, { ...locked, x: 500, locked: false }), {
    id: 'f1',
    x: 0,
    locked: false,
  });
  // Unlocked items are handed straight back.
  const free = { id: 'f2', x: 0 };
  const moved = { id: 'f2', x: 500 };
  assert.equal(resolveLockedUpdate(free, moved), moved);
  assert.equal(resolveLockedUpdate(undefined, moved), moved);
});

test('a locked device keeps its position but stays rotatable', () => {
  const placement = { x: 1000, y: 2000, rotationDeg: 0, locked: true };
  assert.equal(isDevicePositionLocked(placement), true);
  assert.equal(isDevicePositionLocked({ x: 0, y: 0 }), false);

  // A drag or an X/Y field cannot move it.
  const moved = applyDevicePlacementUpdate(placement, { x: 5, y: 5 });
  assert.equal(moved.x, 1000);
  assert.equal(moved.y, 2000);

  // Rotation, mounting and coverage all still apply.
  const aimed = applyDevicePlacementUpdate(placement, { rotationDeg: 45 });
  assert.equal(aimed.rotationDeg, 45);
  assert.equal(aimed.x, 1000);
  const mounted = applyDevicePlacementUpdate(placement, { mountType: 'ceiling', heightMm: 2400 });
  assert.equal(mounted.mountType, 'ceiling');
  assert.equal(mounted.heightMm, 2400);
  assert.equal(mounted.y, 2000);
});

test('unlocking a device in the same update lets it move again', () => {
  const placement = { x: 1000, y: 2000, locked: true };
  const unlockedInPlace = applyDevicePlacementUpdate(placement, { locked: false });
  assert.equal(unlockedInPlace.locked, false);
  assert.equal(unlockedInPlace.x, 1000);

  const unlockedAndMoved = applyDevicePlacementUpdate(placement, { locked: false, x: 5, y: 5 });
  assert.equal(unlockedAndMoved.x, 5);
  assert.equal(unlockedAndMoved.y, 5);
});

test('an unlocked device accepts position updates as before', () => {
  const placement = { x: 0, y: 0, rotationDeg: 0 };
  const moved = applyDevicePlacementUpdate(placement, { x: 300, y: -400 });
  assert.equal(moved.x, 300);
  assert.equal(moved.y, -400);
});

test('bulk locking marks every item and reports it', () => {
  const items = [{ id: 'a' }, { id: 'b', locked: true }];
  assert.equal(areAllItemsLocked(items), false);

  const locked = setItemsLocked(items, true);
  assert.equal(areAllItemsLocked(locked), true);
  assert.notEqual(locked[0], items[0]); // copies, never mutates

  const unlocked = setItemsLocked(locked, false);
  assert.equal(unlocked.every((item) => item.locked === undefined), true);
  assert.equal(areAllItemsLocked(unlocked), false);
  assert.equal(areAllItemsLocked([]), false);
});

test('counts every pinned object in a room', () => {
  const room = {
    roomShell: { ...square(), lockedSegments: [0, 2] },
    furniture: [{ id: 'f1', locked: true }, { id: 'f2' }],
    doors: [{ id: 'd1', locked: true }],
  };
  assert.equal(countLockedObjects(room), 4);
  assert.equal(countLockedObjects(null), 0);
});
