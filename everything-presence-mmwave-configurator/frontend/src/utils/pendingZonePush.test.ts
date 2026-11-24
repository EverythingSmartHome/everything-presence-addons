// @ts-nocheck -- Node's built-in runner supplies these modules; frontend production types stay dependency-free.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearPendingZonePushMetadata,
  describeZonePushProblems,
  shouldClearPendingAfterPush,
  hasPendingZonePush,
  plannedZonesForDevice,
  rectToPolygon,
  shouldSkipDeviceZoneOverwrite,
} from './pendingZonePush.ts';

test('the zone-overwrite guard only fires while the pending flag is set', () => {
  assert.equal(shouldSkipDeviceZoneOverwrite({ metadata: { pendingZonePush: true } }), true);
  assert.equal(shouldSkipDeviceZoneOverwrite({ metadata: { pendingZonePush: false } }), false);
  assert.equal(shouldSkipDeviceZoneOverwrite({ metadata: { pendingZonePush: 'true' } }), false);
  assert.equal(shouldSkipDeviceZoneOverwrite({ metadata: {} }), false);
  assert.equal(shouldSkipDeviceZoneOverwrite({}), false);
  assert.equal(shouldSkipDeviceZoneOverwrite(null), false);
  assert.equal(hasPendingZonePush({ metadata: { pendingZonePush: true } }), true);
});

test('clearing the flag keeps the rest of the metadata', () => {
  assert.deepEqual(
    clearPendingZonePushMetadata({ pendingZonePush: true, ceilingSliceConfig: { a: 1 } }),
    { ceilingSliceConfig: { a: 1 } },
  );
  assert.deepEqual(clearPendingZonePushMetadata(undefined), {});
});

test('rectToPolygon makes a clockwise 4-vertex polygon with the same id, type and label', () => {
  assert.deepEqual(
    rectToPolygon({ id: 'Zone 1', type: 'regular', x: 10, y: 20, width: 100, height: 50, enabled: true, label: 'Bed' }),
    {
      id: 'Zone 1',
      type: 'regular',
      vertices: [{ x: 10, y: 20 }, { x: 110, y: 20 }, { x: 110, y: 70 }, { x: 10, y: 70 }],
      enabled: true,
      label: 'Bed',
    },
  );
});

const sent = [
  { id: 'Zone 1', type: 'regular', x: 0, y: 0, width: 10, height: 10 },
  { id: 'Entry 1', type: 'entry', x: 0, y: 0, width: 10, height: 10 },
];

test('a push that reports ok clears the pending flag', () => {
  assert.equal(shouldClearPendingAfterPush({ ok: true }, sent), true);
  assert.equal(shouldClearPendingAfterPush({ ok: true, warnings: [] }, sent), true);
});

test('a push that reports ok: false keeps the pending flag', () => {
  assert.equal(
    shouldClearPendingAfterPush({ ok: false, warnings: [{ entityId: 'number.zone_1_begin_x', description: 'Zone 1 begin X', error: 'timeout' }] }, sent),
    false,
  );
  assert.equal(shouldClearPendingAfterPush({ ok: false }, sent), false);
});

test('ok with a skipped planned zone keeps the pending flag', () => {
  const result = {
    ok: true,
    warnings: [{ description: 'Skipped entry zone Entry 1', error: 'This device profile does not support this zone type' }],
  };
  assert.equal(shouldClearPendingAfterPush(result, sent), false);
});

test('ok with a non-skip warning still clears', () => {
  const result = { ok: true, warnings: [{ entityId: 'text.zone_1', description: 'Zone 1 entity is unavailable', error: 'unavailable' }] };
  assert.equal(shouldClearPendingAfterPush(result, sent), true);
});

test('a thrown error or missing result keeps the pending flag', () => {
  assert.equal(shouldClearPendingAfterPush(new Error('500 Internal Server Error'), sent), false);
  assert.equal(shouldClearPendingAfterPush(null, sent), false);
  assert.equal(shouldClearPendingAfterPush(undefined, sent), false);
});

test('push problems are described for the user', () => {
  assert.match(describeZonePushProblems(new Error('boom')), /boom/);
  assert.match(
    describeZonePushProblems({ ok: false, warnings: [{ entityId: 'number.x', description: 'd', error: 'timeout' }] }),
    /number\.x: timeout/,
  );
});

test('plannedZonesForDevice converts for polygon-only firmware and skips disabled zones', () => {
  const zones = [
    { id: 'Zone 1', type: 'regular', x: 0, y: 0, width: 10, height: 10 },
    { id: 'Zone 2', type: 'regular', x: 0, y: 0, width: 10, height: 10, enabled: false },
  ];
  const rect = plannedZonesForDevice(zones, false);
  assert.equal(rect.kind, 'rect');
  assert.deepEqual(rect.zones.map((z) => z.id), ['Zone 1']);
  const poly = plannedZonesForDevice(zones, true);
  assert.equal(poly.kind, 'polygon');
  assert.equal(poly.zones.length, 1);
  assert.equal(poly.zones[0].vertices.length, 4);
});
