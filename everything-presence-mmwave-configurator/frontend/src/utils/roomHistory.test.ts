// @ts-nocheck -- Node's built-in runner supplies these modules; frontend production types stay dependency-free.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ROOM_HISTORY_LIMIT,
  applyRoomSnapshot,
  createRoomHistory,
  pushRoomHistory,
  redoRoomHistory,
  snapshotRoom,
  snapshotsEqual,
  undoRoomHistory,
} from './roomHistory.ts';

const room = () => ({
  id: 'room-1',
  name: 'Lounge',
  units: 'metric',
  zones: [{ id: 'zone-1', name: 'Zone 1', x: 0, y: 0, width: 100, height: 100 }],
  entityMappings: { installationAngleEntity: 'number.angle' },
  roomShell: { points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }] },
  furniture: [{ id: 'f1', typeId: 'sofa', x: 0, y: 0, width: 1000, depth: 500, height: 400, rotationDeg: 0 }],
  doors: [{ id: 'd1', segmentIndex: 0, positionOnSegment: 0.5, widthMm: 800 }],
  devicePlacement: { x: 0, y: 0, rotationDeg: 0 },
});

test('snapshots only the room-builder subset and deep copies it', () => {
  const original = room();
  const snapshot = snapshotRoom(original);

  assert.deepEqual(Object.keys(snapshot).sort(), [
    'devicePlacement',
    'doors',
    'floorMaterial',
    'furniture',
    'roomShell',
    'roomShellFillMode',
  ]);

  original.roomShell.points[0].x = 999;
  original.furniture[0].x = 999;
  assert.equal(snapshot.roomShell.points[0].x, 0);
  assert.equal(snapshot.furniture[0].x, 0);
});

test('lock state is snapshotted and deep copied', () => {
  const original = room();
  original.roomShell.lockedSegments = [0, 2];
  original.furniture[0].locked = true;
  original.doors[0].locked = true;

  const snapshot = snapshotRoom(original);

  // Rewriting the live outline's locked walls must not reach into the snapshot.
  original.roomShell.lockedSegments[0] = 9;
  original.furniture[0].locked = false;
  assert.deepEqual(snapshot.roomShell.lockedSegments, [0, 2]);
  assert.equal(snapshot.furniture[0].locked, true);
  assert.equal(snapshot.doors[0].locked, true);
});

test('locking a wall is an undoable change', () => {
  const before = snapshotRoom(room());
  const locked = room();
  locked.roomShell.lockedSegments = [1];
  const after = snapshotRoom(locked);

  assert.equal(snapshotsEqual(before, after), false);

  const history = pushRoomHistory(createRoomHistory(), before);
  const undone = undoRoomHistory(history, after);
  assert.ok(undone);
  assert.equal(undone.snapshot.roomShell.lockedSegments, undefined);
});

test('applying a snapshot restores the outline without touching zones', () => {
  const before = snapshotRoom(room());
  const edited = { ...room(), roomShell: { points: [] }, zones: [] };
  const restored = applyRoomSnapshot(edited, before);

  assert.deepEqual(restored.roomShell.points.length, 3);
  assert.deepEqual(restored.zones, []); // zones stay as the caller had them
  assert.equal(restored.id, 'room-1');
});

test('undo returns the previous snapshot and redo returns the newer one', () => {
  const first = snapshotRoom(room());
  const second = snapshotRoom({ ...room(), doors: [] });

  const history = pushRoomHistory(createRoomHistory(), first);
  const undone = undoRoomHistory(history, second);
  assert.ok(undone);
  assert.equal(undone.snapshot.doors.length, 1);

  const redone = redoRoomHistory(undone.history, undone.snapshot);
  assert.ok(redone);
  assert.equal(redone.snapshot.doors.length, 0);
  assert.equal(redone.history.future.length, 0);
});

test('undo and redo are no-ops on empty stacks', () => {
  const current = snapshotRoom(room());
  assert.equal(undoRoomHistory(createRoomHistory(), current), null);
  assert.equal(redoRoomHistory(createRoomHistory(), current), null);
});

test('a gesture that fires many times collapses into one undo step', () => {
  const base = snapshotRoom(room());
  let history = createRoomHistory();
  for (let step = 0; step < 200; step += 1) {
    history = pushRoomHistory(history, snapshotRoom({ ...room(), furniture: [{ ...room().furniture[0], x: step }] }), {
      coalesceKey: 'furniture:f1',
      activeCoalesceKey: history.past.length ? 'furniture:f1' : null,
    });
  }
  assert.equal(history.past.length, 1);
  assert.equal(history.past[0].snapshot.furniture[0].x, 0);

  // Pointer-up clears the active key, so the next drag is its own step.
  history = pushRoomHistory(history, base, { coalesceKey: 'furniture:f1', activeCoalesceKey: null });
  assert.equal(history.past.length, 2);
});

test('pushing a new edit drops the redo stack', () => {
  const snapshot = snapshotRoom(room());
  const history = { past: [{ snapshot }], future: [{ snapshot }] };
  assert.equal(pushRoomHistory(history, snapshot).future.length, 0);
  assert.equal(
    pushRoomHistory(history, snapshot, { coalesceKey: 'k', activeCoalesceKey: 'k' }).future.length,
    0,
  );
});

test('history depth stays bounded, dropping the oldest steps', () => {
  let history = createRoomHistory();
  for (let step = 0; step < ROOM_HISTORY_LIMIT + 25; step += 1) {
    history = pushRoomHistory(history, snapshotRoom({ ...room(), roomShellFillMode: `mode-${step}` }));
  }
  assert.equal(history.past.length, ROOM_HISTORY_LIMIT);
  assert.equal(history.past[0].snapshot.roomShellFillMode, 'mode-25');
});

test('snapshot equality ignores key order', () => {
  const a = snapshotRoom(room());
  const b = { ...a };
  assert.equal(snapshotsEqual(a, b), true);
  assert.equal(snapshotsEqual(a, snapshotRoom({ ...room(), doors: [] })), false);
});
