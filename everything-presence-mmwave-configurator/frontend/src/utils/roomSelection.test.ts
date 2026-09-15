// @ts-nocheck -- Node's built-in runner supplies these modules; frontend production types stay dependency-free.
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveLoadedRoomSelection } from './roomSelection.ts';

const rooms = [
  { id: 'room-1', profileId: 'profile-a' },
  { id: 'room-2', profileId: 'profile-b' },
  { id: 'room-3', profileId: 'profile-a' },
];

test('falls back to the incoming room on first load', () => {
  assert.equal(resolveLoadedRoomSelection(rooms, 'room-2', null)?.id, 'room-2');
});

test('falls back to the first room when nothing is selected or handed in', () => {
  assert.equal(resolveLoadedRoomSelection(rooms, null, null)?.id, 'room-1');
});

test('keeps the room the user picked even when the parent still points elsewhere', () => {
  // Regression: the builder used to re-select `initialRoomId` whenever its load
  // effect re-ran, so picking a room whose profile differed snapped straight back.
  assert.equal(resolveLoadedRoomSelection(rooms, 'room-1', 'room-2')?.id, 'room-2');
});

test('ignores a stale selection that no longer exists on the server', () => {
  assert.equal(resolveLoadedRoomSelection(rooms, 'room-3', 'deleted-room')?.id, 'room-3');
});

test('ignores an unknown incoming room', () => {
  assert.equal(resolveLoadedRoomSelection(rooms, 'deleted-room', null)?.id, 'room-1');
});

test('returns null when there are no rooms', () => {
  assert.equal(resolveLoadedRoomSelection([], 'room-1', 'room-2'), null);
});
