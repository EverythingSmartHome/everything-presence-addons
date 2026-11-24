import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeRoom, parseDevicePlacement, parseZone } from './roomNormalization';

test('a planned room (profileId, no deviceId) round-trips', () => {
  const room = normalizeRoom({ id: 'r1', name: 'Office', profileId: 'everything_presence_lite' });
  assert.equal(room.profileId, 'everything_presence_lite');
  assert.equal(room.deviceId, undefined);

  const again = normalizeRoom(JSON.parse(JSON.stringify(room)), 'r1');
  assert.equal(again.profileId, 'everything_presence_lite');
  assert.equal(again.deviceId, undefined);
  assert.equal(again.id, 'r1');
});

test('blank device and profile ids are stored as undefined', () => {
  const room = normalizeRoom({ name: 'X', deviceId: '', profileId: '   ' });
  assert.equal(room.deviceId, undefined);
  assert.equal(room.profileId, undefined);
});

test('an unlink payload clears deviceId but keeps a profileId that was not sent blank', () => {
  const existing = normalizeRoom({ id: 'r1', name: 'Office', deviceId: 'dev-1', profileId: 'everything_presence_pro' });
  const merged = { ...existing, deviceId: '', entityNamePrefix: '' };
  const room = normalizeRoom(merged, 'r1');
  assert.equal(room.deviceId, undefined);
  assert.equal(room.profileId, 'everything_presence_pro');
});

test('metadata passes through, including pendingZonePush', () => {
  const room = normalizeRoom({ name: 'X', metadata: { pendingZonePush: true, other: 1 } });
  assert.deepEqual(room.metadata, { pendingZonePush: true, other: 1 });
});

test('missing metadata becomes an empty object', () => {
  assert.deepEqual(normalizeRoom({ name: 'X' }).metadata, {});
});

test('a shallow PUT merge that only sets the device keeps geometry, zones and placement', () => {
  const existing = normalizeRoom({
    id: 'r1',
    name: 'Office',
    profileId: 'everything_presence_lite',
    roomShell: { points: [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 3000 }] },
    devicePlacement: { x: 100, y: 200, rotationDeg: 45 },
    zones: [{ id: 'z1', type: 'regular', x: 1, y: 2, width: 300, height: 400 }],
    furniture: [{ id: 'f1', typeId: 'bed', x: 1, y: 1, width: 10, depth: 10, height: 10, rotationDeg: 0 }],
    doors: [{ id: 'd1', segmentIndex: 1, positionOnSegment: 0.5, widthMm: 800 }],
  });
  const body = { deviceId: 'dev-1', metadata: { pendingZonePush: true } };
  const room = normalizeRoom({ ...existing, ...body }, 'r1');

  assert.equal(room.deviceId, 'dev-1');
  assert.equal(room.profileId, 'everything_presence_lite');
  assert.deepEqual(room.roomShell, existing.roomShell);
  assert.deepEqual(room.devicePlacement, existing.devicePlacement);
  assert.deepEqual(room.zones, existing.zones);
  assert.deepEqual(room.furniture, existing.furniture);
  assert.deepEqual(room.doors, existing.doors);
  assert.equal(room.metadata?.pendingZonePush, true);
});

test('parseZone falls back to regular type and the provided id', () => {
  const zone = parseZone({ type: 'bogus', x: '5', width: 10 }, 'zone-1');
  assert.equal(zone.id, 'zone-1');
  assert.equal(zone.type, 'regular');
  assert.equal(zone.x, 5);
  assert.equal(zone.height, 0);
});

test('parseDevicePlacement rejects non-finite coordinates', () => {
  assert.equal(parseDevicePlacement({ x: 'abc', y: 1 }), undefined);
  assert.equal(parseDevicePlacement(undefined), undefined);
});
