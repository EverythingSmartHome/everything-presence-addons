// @ts-nocheck -- Node's built-in runner supplies these modules; frontend production types stay dependency-free.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aliasKeysFor,
  applyOverridesToFlatMappings,
  applyOverridesToNestedMappings,
  storedLookupKeys,
  templateKeyToStorageKey,
} from './manualOverrideMapping.ts';

test('templateKeyToStorageKey maps flat and nested template keys to stored keys', () => {
  assert.equal(templateKeyToStorageKey('presence'), 'presence');
  assert.equal(templateKeyToStorageKey('zone1BeginX'), 'zone1BeginX');
  assert.equal(templateKeyToStorageKey('settingsEntities.maxDistance'), 'maxDistance');
  assert.equal(templateKeyToStorageKey('zoneConfigEntities.zone2.beginX'), 'zone2BeginX');
  assert.equal(templateKeyToStorageKey('exclusionZoneConfigEntities.exclusion1.endY'), 'exclusion1EndY');
  assert.equal(templateKeyToStorageKey('entryZoneConfigEntities.entry1.endX'), 'entry1EndX');
  assert.equal(templateKeyToStorageKey('trackingTargets.target1.x'), 'target1X');
  assert.equal(templateKeyToStorageKey('polygonZoneEntities.zone3'), 'polygonZone3');
  assert.equal(templateKeyToStorageKey('polygonExclusionEntities.exclusion1'), 'polygonExclusion1');
  assert.equal(templateKeyToStorageKey('polygonEntryEntities.entry2'), 'polygonEntry2');
  assert.equal(templateKeyToStorageKey('unknownGroup.a.b'), null);
});

test('aliasKeysFor returns Entity-suffix and irregular aliases', () => {
  assert.deepEqual(aliasKeysFor('presence'), ['presenceEntity']);
  assert.deepEqual(aliasKeysFor('presenceEntity'), ['presence']);
  assert.ok(aliasKeysFor('distanceMinEntity').includes('mmwaveDistanceMin'));
});

test('storedLookupKeys covers template key, stored key and aliases', () => {
  assert.deepEqual(storedLookupKeys('presence'), ['presence', 'presenceEntity']);
  assert.deepEqual(storedLookupKeys('settingsEntities.maxDistance'), [
    'settingsEntities.maxDistance',
    'maxDistance',
    'maxDistanceEntity',
  ]);
});

test('flat: two overrides both win over auto-matched values (settings + zone + sensor alias)', () => {
  // Flat mapping as built from auto-matched suggestions
  const flat = {
    presenceEntity: 'binary_sensor.auto_occupancy',
    maxDistance: 'number.auto_max_distance',
    zone1BeginX: 'number.auto_zone_1_begin_x',
  };
  const result = applyOverridesToFlatMappings(flat, {
    presence: 'binary_sensor.prasenzmelder_esszimmer',
    maxDistance: 'number.manual_max_distance',
    zone1BeginX: 'number.manual_zone_1_begin_x',
  });
  assert.equal(result.presence, 'binary_sensor.prasenzmelder_esszimmer');
  assert.equal(result.presenceEntity, 'binary_sensor.prasenzmelder_esszimmer');
  assert.equal(result.maxDistance, 'number.manual_max_distance');
  assert.equal(result.zone1BeginX, 'number.manual_zone_1_begin_x');
});

test('flat: nested template keys are written to their stored key; empty overrides ignored', () => {
  const flat = { maxDistance: 'number.auto', target1X: 'sensor.auto_x' };
  const result = applyOverridesToFlatMappings(flat, {
    'settingsEntities.maxDistance': 'number.manual',
    'trackingTargets.target1.x': 'sensor.manual_x',
    'zoneConfigEntities.zone1.beginX': '',
  });
  assert.deepEqual(result, { maxDistance: 'number.manual', target1X: 'sensor.manual_x' });
  // Input is not mutated
  assert.equal(flat.maxDistance, 'number.auto');
});

test('nested: flat profile overrides replace every representation of the field', () => {
  const mappings = {
    presenceEntity: 'binary_sensor.auto_occupancy',
    settingsEntities: { maxDistance: 'number.auto_max' },
    zoneConfigEntities: { zone1: { beginX: 'number.auto_bx', endX: 'number.auto_ex' } },
    trackingTargets: { target1: { x: 'sensor.auto_x' } },
    polygonZoneEntities: {},
  };
  applyOverridesToNestedMappings(mappings, {
    presence: 'binary_sensor.manual',
    maxDistance: 'number.manual_max',
    zone1BeginX: 'number.manual_bx',
    target1X: 'sensor.manual_x',
    polygonZone2: 'text.manual_polygon_2',
  });
  assert.equal(mappings.presence, 'binary_sensor.manual');
  assert.equal(mappings.presenceEntity, 'binary_sensor.manual');
  assert.equal(mappings.settingsEntities.maxDistance, 'number.manual_max');
  assert.equal(mappings.zoneConfigEntities.zone1.beginX, 'number.manual_bx');
  assert.equal(mappings.zoneConfigEntities.zone1.endX, 'number.auto_ex');
  assert.equal(mappings.trackingTargets.target1.x, 'sensor.manual_x');
  assert.equal(mappings.polygonZoneEntities.zone2, 'text.manual_polygon_2');
});

test('nested: unrelated flat keys are not added to settingsEntities', () => {
  const mappings = { settingsEntities: {} };
  applyOverridesToNestedMappings(mappings, { presence: 'binary_sensor.manual' });
  assert.deepEqual(mappings.settingsEntities, {});
  assert.equal(mappings.presence, 'binary_sensor.manual');
});

test('nested: legacy dotted keys are placed into their group', () => {
  const mappings = {};
  applyOverridesToNestedMappings(mappings, {
    'zoneConfigEntities.zone1.beginX': 'number.bx',
    'polygonZoneEntities.zone1': 'text.poly1',
  });
  assert.deepEqual(mappings, {
    zoneConfigEntities: { zone1: { beginX: 'number.bx' } },
    polygonZoneEntities: { zone1: 'text.poly1' },
  });
});
