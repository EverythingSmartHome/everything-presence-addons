// @ts-nocheck -- Node's built-in runner supplies these modules; frontend production types stay dependency-free.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDeviceLinkUpdate,
  describeDeviceLinkMismatch,
  fitZonesToProfile,
  getRoomDeviceStatus,
  isPlannedRoom,
  planDeviceLink,
  plannedModelLabel,
  resetModelSpecificPlacement,
  roomOptionLabel,
} from './plannedRoom.ts';

// Mirrors config/device-profiles/*.json
const ep1 = {
  id: 'everything_presence_one',
  label: 'Everything Presence One',
  capabilities: { tracking: false, zones: false, exclusionZones: false, entryZones: false },
  limits: { maxZones: 0, maxExclusionZones: 0, maxEntryZones: 0 },
};
const epl = {
  id: 'everything_presence_lite',
  label: 'Everything Presence Lite',
  capabilities: { tracking: true, zones: true, entryZones: true },
  limits: { maxZones: 4, maxExclusionZones: 2, maxEntryZones: 2 },
};
const epp = {
  id: 'everything_presence_pro',
  label: 'Everything Presence Pro',
  capabilities: { tracking: true, zones: true, entryZones: true },
  limits: { maxZones: 4, maxExclusionZones: 1, maxEntryZones: 1 },
};
const profiles = [ep1, epl, epp];

const zone = (id, type = 'regular') => ({ id, type, x: 0, y: 0, width: 100, height: 100 });

test('room device status: linked, planned, unconfigured', () => {
  assert.equal(getRoomDeviceStatus({ deviceId: 'd1', profileId: epl.id }), 'linked');
  assert.equal(getRoomDeviceStatus({ deviceId: 'd1' }), 'linked');
  assert.equal(getRoomDeviceStatus({ profileId: epl.id }), 'planned');
  assert.equal(getRoomDeviceStatus({ deviceId: '', profileId: epl.id }), 'planned');
  assert.equal(getRoomDeviceStatus({}), 'unconfigured');
  assert.equal(getRoomDeviceStatus({ profileId: '  ' }), 'unconfigured');
  assert.equal(getRoomDeviceStatus(null), 'unconfigured');
  assert.equal(isPlannedRoom({ profileId: epl.id }), true);
  assert.equal(isPlannedRoom({ deviceId: 'd1', profileId: epl.id }), false);
});

test('room option labels mark planned rooms with their model', () => {
  assert.equal(roomOptionLabel({ name: 'Office', profileId: epl.id }, profiles), 'Office (Planned · Everything Presence Lite)');
  assert.equal(roomOptionLabel({ name: 'Office', deviceId: 'd1', profileId: epl.id }, profiles), 'Office');
  assert.equal(roomOptionLabel({ name: 'Office' }, profiles), 'Office');
  assert.equal(plannedModelLabel({ profileId: 'unknown_model' }, profiles), 'unknown_model');
});

test('resetModelSpecificPlacement clears preset, FOV overrides and pitch', () => {
  const placement = {
    x: 10, y: 20, rotationDeg: 45, heightMm: 2400, locked: true,
    mountType: 'wall', pitchDeg: 12, coveragePresetId: 'wide', horizontalFovDeg: 90, verticalFovDeg: 60,
  };
  assert.deepEqual(resetModelSpecificPlacement(placement, epl), {
    x: 10, y: 20, rotationDeg: 45, heightMm: 2400, locked: true, mountType: 'wall',
  });
});

test('resetModelSpecificPlacement drops ceiling mounting for non-EPP models only', () => {
  const ceiling = { x: 0, y: 0, mountType: 'ceiling', pitchDeg: 90 };
  assert.deepEqual(resetModelSpecificPlacement(ceiling, epl), { x: 0, y: 0 });
  assert.deepEqual(resetModelSpecificPlacement(ceiling, ep1), { x: 0, y: 0 });
  assert.deepEqual(resetModelSpecificPlacement(ceiling, epp), { x: 0, y: 0, mountType: 'ceiling' });
  assert.equal(resetModelSpecificPlacement(undefined, epl), undefined);
});

test('resetModelSpecificPlacement does not mutate its input', () => {
  const placement = { x: 1, y: 2, pitchDeg: 5 };
  resetModelSpecificPlacement(placement, epl);
  assert.equal(placement.pitchDeg, 5);
});

test('fitZonesToProfile keeps only zones the profile has slots for', () => {
  const zones = [zone('Zone 1'), zone('Zone 4'), zone('Exclusion 1', 'exclusion'), zone('Exclusion 2', 'exclusion'), zone('Entry 2', 'entry')];
  const onEpp = fitZonesToProfile(zones, epp);
  assert.deepEqual(onEpp.kept.map((z) => z.id), ['Zone 1', 'Zone 4', 'Exclusion 1']);
  assert.deepEqual(onEpp.dropped.map((z) => z.id), ['Exclusion 2', 'Entry 2']);
  const onEp1 = fitZonesToProfile(zones, ep1);
  assert.equal(onEp1.kept.length, 0);
  assert.equal(onEp1.dropped.length, zones.length);
});

test('planDeviceLink with the planned model keeps everything and flags zones for push', () => {
  const room = { profileId: epl.id, devicePlacement: { x: 1, y: 2, pitchDeg: 3 }, zones: [zone('Zone 1')] };
  const plan = planDeviceLink(room, epl.id, profiles);
  assert.equal(plan.modelMismatch, false);
  assert.equal(plan.profileId, epl.id);
  assert.deepEqual(plan.devicePlacement, room.devicePlacement);
  assert.deepEqual(plan.zones, room.zones);
  assert.deepEqual(plan.droppedZones, []);
  assert.equal(plan.pendingZonePush, true);
});

test('planDeviceLink on a room with no zones does not flag a push', () => {
  const plan = planDeviceLink({ profileId: epl.id, zones: [] }, epl.id, profiles);
  assert.equal(plan.pendingZonePush, false);
});

test('planDeviceLink with no planned model or unknown device model is not a mismatch', () => {
  assert.equal(planDeviceLink({ zones: [] }, epl.id, profiles).modelMismatch, false);
  assert.equal(planDeviceLink({ zones: [] }, epl.id, profiles).profileId, epl.id);
  const unknownDevice = planDeviceLink({ profileId: epl.id, zones: [] }, null, profiles);
  assert.equal(unknownDevice.modelMismatch, false);
  assert.equal(unknownDevice.profileId, epl.id);
});

test('planDeviceLink with a different model switches model, resets placement and drops zones', () => {
  const room = {
    profileId: epp.id,
    devicePlacement: { x: 5, y: 6, mountType: 'ceiling', pitchDeg: 90, coveragePresetId: 'ceiling' },
    zones: [zone('Zone 1'), zone('Exclusion 1', 'exclusion')],
  };
  const plan = planDeviceLink(room, ep1.id, profiles);
  assert.equal(plan.modelMismatch, true);
  assert.equal(plan.plannedProfileId, epp.id);
  assert.equal(plan.profileId, ep1.id);
  assert.deepEqual(plan.devicePlacement, { x: 5, y: 6 });
  assert.deepEqual(plan.zones, []);
  assert.deepEqual(plan.droppedZones.map((z) => z.id), ['Zone 1', 'Exclusion 1']);
  assert.equal(plan.pendingZonePush, false);
  const message = describeDeviceLinkMismatch(plan, profiles);
  assert.match(message, /Everything Presence Pro/);
  assert.match(message, /Everything Presence One/);
  assert.match(message, /Zone 1, Exclusion 1/);
});

test('buildDeviceLinkUpdate sets or clears the pending flag and keeps other metadata', () => {
  const room = { metadata: { ceilingSliceConfig: { a: 1 }, pendingZonePush: true } };
  const withZones = buildDeviceLinkUpdate(room, 'dev-1', { profileId: epl.id, zones: [zone('Zone 1')], pendingZonePush: true, devicePlacement: { x: 1, y: 1 } });
  assert.equal(withZones.deviceId, 'dev-1');
  assert.equal(withZones.profileId, epl.id);
  assert.deepEqual(withZones.metadata, { ceilingSliceConfig: { a: 1 }, pendingZonePush: true });
  assert.deepEqual(withZones.devicePlacement, { x: 1, y: 1 });

  const noZones = buildDeviceLinkUpdate(room, 'dev-1', { profileId: epl.id, zones: [], pendingZonePush: false, devicePlacement: undefined });
  assert.deepEqual(noZones.metadata, { ceilingSliceConfig: { a: 1 } });
  assert.equal('devicePlacement' in noZones, false);
});
