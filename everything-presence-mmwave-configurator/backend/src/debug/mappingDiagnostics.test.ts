import assert from 'node:assert/strict';
import test from 'node:test';
import type { DeviceMapping } from '../config/deviceMappingStorage';
import type { EntityRegistryEntry } from '../ha/types';
import { diagnoseMappings } from './mappingDiagnostics';

const reg = (entity_id: string, extra: Partial<EntityRegistryEntry> = {}): EntityRegistryEntry => ({
  entity_id,
  name: null,
  platform: 'esphome',
  device_id: 'dev1',
  disabled_by: null,
  hidden_by: null,
  ...extra,
});

const state = (entity_id: string, value: string) => ({
  entity_id,
  state: value,
  attributes: {},
  last_changed: '',
  last_updated: '',
});

const mapping: DeviceMapping = {
  deviceId: 'dev1',
  profileId: 'everything_presence_lite',
  deviceName: 'Lounge EPL',
  discoveredAt: '2026-01-01T00:00:00Z',
  lastUpdated: '2026-01-01T00:00:00Z',
  confirmedByUser: true,
  autoMatchedCount: 5,
  manuallyMappedCount: 0,
  mappings: {
    presenceEntity: 'binary_sensor.lounge_occupancy',
    presence: 'binary_sensor.lounge_occupancy',
    targetCountEntity: 'sensor.old_target_count',
    distanceEntity: 'sensor.lounge_distance',
    modeEntity: 'select.other_mode',
    illuminanceEntity: 'sensor.lounge_lux',
    temperatureEntity: 'sensor.lounge_temp',
    humidityEntity: 'sensor.lounge_humidity',
  },
  unmappedEntities: [],
  entityUniqueIds: { 'sensor.old_target_count': 'aabbccddeeff-sensor-target_count' },
};

test('classifies ok, renamed, missing, wrong device, disabled and unavailable entities', () => {
  const result = diagnoseMappings({
    mappings: [mapping],
    registry: [
      reg('binary_sensor.lounge_occupancy'),
      reg('sensor.new_target_count', { unique_id: 'aabbccddeeff-sensor-target_count' }),
      reg('select.other_mode', { device_id: 'dev2' }),
      reg('sensor.lounge_lux', { disabled_by: 'user' }),
      reg('sensor.lounge_temp'),
      reg('sensor.lounge_humidity'),
    ],
    states: [
      state('binary_sensor.lounge_occupancy', 'on'),
      state('sensor.lounge_temp', 'unavailable'),
    ],
    devices: [],
    getMissingRequired: () => ['co2Entity'],
  });

  const byKey = Object.fromEntries(result.devices[0].entities.map((e) => [e.key, e]));
  assert.equal(byKey.presenceEntity.status, 'ok');
  assert.equal(byKey.presenceEntity.state, 'on');
  assert.equal(byKey.presence, undefined, 'alias duplicates are collapsed');
  assert.equal(byKey.targetCountEntity.status, 'renamed');
  assert.equal(byKey.targetCountEntity.currentEntityId, 'sensor.new_target_count');
  assert.equal(byKey.distanceEntity.status, 'missing');
  assert.equal(byKey.modeEntity.status, 'wrong_device');
  assert.equal(byKey.modeEntity.actualDeviceId, 'dev2');
  assert.equal(byKey.illuminanceEntity.status, 'disabled');
  assert.equal(byKey.temperatureEntity.status, 'unavailable');
  assert.equal(byKey.humidityEntity.status, 'unavailable', 'no state at all counts as unavailable');

  const device = result.devices[0];
  assert.equal(device.deviceFound, false);
  assert.deepEqual(device.missingRequiredKeys, ['co2Entity']);
  assert.deepEqual(device.summary, { ok: 1, renamed: 1, missing: 1, wrong_device: 1, disabled: 1, unavailable: 2 });
  assert.equal(result.problemCount, 6 + 1 + 1);
});

test('without states, availability is not assessed', () => {
  const result = diagnoseMappings({
    mappings: [{ ...mapping, mappings: { presenceEntity: 'binary_sensor.lounge_occupancy' } }],
    registry: [reg('binary_sensor.lounge_occupancy')],
  });
  assert.equal(result.statesChecked, false);
  assert.equal(result.devices[0].entities[0].status, 'ok');
  assert.equal(result.devices[0].deviceFound, null);
});

test('never copies states of network identity entities', () => {
  const result = diagnoseMappings({
    mappings: [{ ...mapping, mappings: { wifiEntity: 'sensor.lounge_ssid' } }],
    registry: [reg('sensor.lounge_ssid')],
    states: [state('sensor.lounge_ssid', 'HomeWifi')],
  });
  assert.equal(result.devices[0].entities[0].state, undefined);
});
