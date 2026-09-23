// @ts-nocheck -- Node's built-in runner supplies these modules; frontend production types stay dependency-free.
import assert from 'node:assert/strict';
import test from 'node:test';
import { seedManualOverrides } from './manualOverrides.ts';

const deviceEntityIds = new Set([
  'binary_sensor.living_room_presence',
  'binary_sensor.ep_pro_occupancy',
  'binary_sensor.ep_pro_mmwave',
  'number.ep_pro_max_distance',
]);

test('seeds a saved manual choice for a key that no longer auto-matches', () => {
  const overrides = seedManualOverrides(
    [{ templateKey: 'presence', matchedEntityId: null }],
    { presence: 'binary_sensor.living_room_presence' },
    deviceEntityIds,
  );
  assert.deepEqual(overrides, { presence: 'binary_sensor.living_room_presence' });
});

test('reads saved values stored under the legacy Entity-suffixed key', () => {
  const overrides = seedManualOverrides(
    [{ templateKey: 'mmwave', matchedEntityId: null }],
    { mmwaveEntity: 'binary_sensor.ep_pro_mmwave' },
    deviceEntityIds,
  );
  assert.deepEqual(overrides, { mmwave: 'binary_sensor.ep_pro_mmwave' });
});

test('reads saved values stored without the Entity suffix', () => {
  const overrides = seedManualOverrides(
    [{ templateKey: 'presenceEntity', matchedEntityId: null }],
    { presence: 'binary_sensor.living_room_presence' },
    deviceEntityIds,
  );
  assert.deepEqual(overrides, { presenceEntity: 'binary_sensor.living_room_presence' });
});

test('prefers the direct key over legacy key variants', () => {
  const overrides = seedManualOverrides(
    [{ templateKey: 'presence', matchedEntityId: 'binary_sensor.ep_pro_occupancy' }],
    {
      presence: 'binary_sensor.living_room_presence',
      presenceEntity: 'binary_sensor.ep_pro_occupancy',
    },
    deviceEntityIds,
  );
  assert.deepEqual(overrides, { presence: 'binary_sensor.living_room_presence' });
});

test('skips saved values identical to the fresh auto-match', () => {
  const overrides = seedManualOverrides(
    [
      { templateKey: 'presence', matchedEntityId: 'binary_sensor.ep_pro_occupancy' },
      { templateKey: 'maxDistance', matchedEntityId: 'number.ep_pro_max_distance' },
    ],
    {
      presenceEntity: 'binary_sensor.ep_pro_occupancy',
      maxDistance: 'number.ep_pro_max_distance',
    },
    deviceEntityIds,
  );
  assert.deepEqual(overrides, {});
});

test('skips saved entities that no longer belong to the device', () => {
  const overrides = seedManualOverrides(
    [
      { templateKey: 'presence', matchedEntityId: 'binary_sensor.ep_pro_occupancy' },
      { templateKey: 'mmwave', matchedEntityId: null },
    ],
    {
      presenceEntity: 'binary_sensor.old_name_occupancy',
      mmwave: 'binary_sensor.old_name_mmwave',
    },
    deviceEntityIds,
  );
  assert.deepEqual(overrides, {});
});

test('returns no overrides for keys without a saved value', () => {
  const overrides = seedManualOverrides(
    [{ templateKey: 'presence', matchedEntityId: null }],
    {},
    deviceEntityIds,
  );
  assert.deepEqual(overrides, {});
});
