import assert from 'node:assert/strict';
import test from 'node:test';
import type { EntityRegistryEntry } from '../ha/types';
import type { IHaReadTransport } from '../ha/readTransport';
import type { DeviceProfileLoader } from './deviceProfiles';
import { EntityDiscoveryService, type EntityMatchResult } from './entityDiscovery';

type MatchTemplateFn = (
  templateKey: string,
  template: string,
  allEntities: EntityRegistryEntry[],
  entitiesByDomain: Map<string, EntityRegistryEntry[]>,
  isOptional?: boolean,
  options?: { zoneType?: 'regular' | 'entry' | 'exclusion' }
) => EntityMatchResult;

const entity = (overrides: Partial<EntityRegistryEntry> & { entity_id: string }): EntityRegistryEntry => ({
  name: null,
  platform: 'esphome',
  device_id: 'device-id',
  disabled_by: null,
  hidden_by: null,
  ...overrides,
});

const match = (
  templateKey: string,
  template: string,
  entities: EntityRegistryEntry[],
  options?: { zoneType?: 'regular' | 'entry' | 'exclusion' }
): EntityMatchResult => {
  const service = new EntityDiscoveryService({} as IHaReadTransport, {} as DeviceProfileLoader);
  const byDomain = new Map<string, EntityRegistryEntry[]>();
  for (const e of entities) {
    const domain = e.entity_id.split('.')[0];
    byDomain.set(domain, [...(byDomain.get(domain) ?? []), e]);
  }
  const matchTemplate = (service as unknown as { matchTemplate: MatchTemplateFn }).matchTemplate.bind(service);
  return matchTemplate(templateKey, template, entities, byDomain, false, options);
};

test('matches a renamed entity via registry original_object_id', () => {
  const result = match('presence', 'binary_sensor.${name}_occupancy', [
    entity({
      entity_id: 'binary_sensor.prasenzmelder_esszimmer',
      original_object_id: 'everything_presence_lite_abc123_occupancy',
    }),
    entity({
      entity_id: 'binary_sensor.everything_presence_lite_abc123_pir',
      original_object_id: 'everything_presence_lite_abc123_pir',
    }),
  ]);

  assert.equal(result.matchedEntityId, 'binary_sensor.prasenzmelder_esszimmer');
  assert.equal(result.matchConfidence, 'exact');
});

test('original_object_id match outranks an unrelated entity_id suffix match', () => {
  const result = match('presence', 'binary_sensor.${name}_occupancy', [
    entity({
      entity_id: 'binary_sensor.prasenzmelder_esszimmer',
      original_object_id: 'everything_presence_lite_abc123_occupancy',
    }),
    entity({
      entity_id: 'binary_sensor.kitchen_occupancy',
      original_object_id: 'everything_presence_lite_abc123_mmwave',
    }),
  ]);

  assert.equal(result.matchedEntityId, 'binary_sensor.prasenzmelder_esszimmer');
});

test('falls back to unique_id suffix when original_object_id is absent', () => {
  const result = match('presence', 'binary_sensor.${name}_occupancy', [
    entity({
      entity_id: 'binary_sensor.prasenzmelder_esszimmer',
      unique_id: 'aabbccddeeff_occupancy',
    }),
  ]);

  assert.equal(result.matchedEntityId, 'binary_sensor.prasenzmelder_esszimmer');
  assert.equal(result.matchConfidence, 'exact');
});

test('renamed zone entities are excluded from base presence templates via original_object_id', () => {
  const result = match('presence', 'binary_sensor.${name}_occupancy', [
    entity({
      entity_id: 'binary_sensor.esszimmer_tisch',
      original_object_id: 'everything_presence_lite_abc123_zone_1_occupancy',
    }),
    entity({
      entity_id: 'binary_sensor.prasenzmelder_esszimmer',
      original_object_id: 'everything_presence_lite_abc123_occupancy',
    }),
  ]);

  assert.equal(result.matchedEntityId, 'binary_sensor.prasenzmelder_esszimmer');
});

test('entities without registry ids still match on entity_id suffix', () => {
  const result = match('presence', 'binary_sensor.${name}_occupancy', [
    entity({ entity_id: 'binary_sensor.everything_presence_lite_abc123_occupancy' }),
  ]);

  assert.equal(result.matchedEntityId, 'binary_sensor.everything_presence_lite_abc123_occupancy');
  assert.equal(result.matchConfidence, 'exact');
});
