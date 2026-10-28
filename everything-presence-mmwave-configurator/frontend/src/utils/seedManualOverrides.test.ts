// @ts-nocheck -- Node's built-in runner supplies these modules; frontend production types stay dependency-free.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildResyncOverrides, countManualOverrides, seedManualOverrides } from './seedManualOverrides.ts';

const deviceEntities = [
  'binary_sensor.prasenzmelder_esszimmer',
  'binary_sensor.epl_mmwave',
  'sensor.epl_temperature',
];

test('returns no overrides when there is no stored mapping', () => {
  assert.deepEqual(seedManualOverrides([{ templateKey: 'presenceEntity', matchedEntityId: null }], null, deviceEntities), {});
});

test('seeds a stored manual mapping for an unmatched key (flat key without Entity suffix)', () => {
  const overrides = seedManualOverrides(
    [{ templateKey: 'presenceEntity', matchedEntityId: null }],
    { presence: 'binary_sensor.prasenzmelder_esszimmer' },
    deviceEntities,
  );
  assert.deepEqual(overrides, { presenceEntity: 'binary_sensor.prasenzmelder_esszimmer' });
});

test('seeds stored keys stored with or without the Entity suffix', () => {
  const overrides = seedManualOverrides(
    [
      { templateKey: 'presenceEntity', matchedEntityId: null },
      { templateKey: 'mmwave', matchedEntityId: null },
    ],
    { presenceEntity: 'binary_sensor.prasenzmelder_esszimmer', mmwaveEntity: 'binary_sensor.epl_mmwave' },
    deviceEntities,
  );
  assert.deepEqual(overrides, {
    presenceEntity: 'binary_sensor.prasenzmelder_esszimmer',
    mmwave: 'binary_sensor.epl_mmwave',
  });
});

test('does not seed keys whose stored entity equals the auto-match', () => {
  const overrides = seedManualOverrides(
    [{ templateKey: 'temperatureEntity', matchedEntityId: 'sensor.epl_temperature' }],
    { temperature: 'sensor.epl_temperature' },
    deviceEntities,
  );
  assert.deepEqual(overrides, {});
});

test('seeds keys whose stored entity differs from the auto-match', () => {
  const overrides = seedManualOverrides(
    [{ templateKey: 'mmwaveEntity', matchedEntityId: 'binary_sensor.other' }],
    { mmwave: 'binary_sensor.epl_mmwave' },
    deviceEntities,
  );
  assert.deepEqual(overrides, { mmwaveEntity: 'binary_sensor.epl_mmwave' });
});

test('skips stored entities that no longer exist on the device', () => {
  const overrides = seedManualOverrides(
    [{ templateKey: 'presenceEntity', matchedEntityId: null }],
    { presence: 'binary_sensor.deleted_entity' },
    deviceEntities,
  );
  assert.deepEqual(overrides, {});
});

const presenceUnmatched = [
  { templateKey: 'presenceEntity', matchedEntityId: null },
  { templateKey: 'mmwaveEntity', matchedEntityId: 'binary_sensor.epl_mmwave' },
];

test('re-sync keeps previously saved manual mappings', () => {
  const overrides = buildResyncOverrides(
    presenceUnmatched,
    { presence: 'binary_sensor.prasenzmelder_esszimmer' },
    {},
    deviceEntities,
  );
  assert.deepEqual(overrides, { presenceEntity: 'binary_sensor.prasenzmelder_esszimmer' });
});

test('re-sync keeps unsaved selections made in the current session', () => {
  const overrides = buildResyncOverrides(
    presenceUnmatched,
    null,
    { presenceEntity: 'binary_sensor.prasenzmelder_esszimmer' },
    deviceEntities,
  );
  assert.deepEqual(overrides, { presenceEntity: 'binary_sensor.prasenzmelder_esszimmer' });
});

test('session selections take precedence over saved mappings, including cleared fields', () => {
  const overrides = buildResyncOverrides(
    presenceUnmatched,
    { presence: 'binary_sensor.prasenzmelder_esszimmer', mmwave: 'sensor.epl_temperature' },
    { presenceEntity: 'binary_sensor.epl_mmwave', mmwaveEntity: '' },
    deviceEntities,
  );
  assert.deepEqual(overrides, { presenceEntity: 'binary_sensor.epl_mmwave', mmwaveEntity: '' });
});

test('re-sync drops session selections for removed entities or unknown keys', () => {
  const overrides = buildResyncOverrides(
    presenceUnmatched,
    null,
    { presenceEntity: 'binary_sensor.deleted_entity', unknownKey: 'binary_sensor.epl_mmwave' },
    deviceEntities,
  );
  assert.deepEqual(overrides, {});
});

test('clearManual discards saved and session manual mappings', () => {
  const overrides = buildResyncOverrides(
    presenceUnmatched,
    { presence: 'binary_sensor.prasenzmelder_esszimmer' },
    { mmwaveEntity: 'sensor.epl_temperature' },
    deviceEntities,
    true,
  );
  assert.deepEqual(overrides, {});
});

test('countManualOverrides ignores cleared selections', () => {
  assert.equal(countManualOverrides({ a: 'sensor.x', b: '', c: 'sensor.y' }), 2);
});
