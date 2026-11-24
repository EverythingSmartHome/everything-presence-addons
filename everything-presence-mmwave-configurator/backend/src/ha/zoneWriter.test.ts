import assert from 'node:assert/strict';
import test from 'node:test';
import { ZoneWriter } from './zoneWriter';
import type { IHaWriteClient } from './writeClient';
import type { EntityMappings, ZonePolygon } from '../domain/types';

const square = [
  { x: 0, y: 0 },
  { x: 1000, y: 0 },
  { x: 1000, y: 1000 },
  { x: 0, y: 1000 },
];

const makeWriter = () => {
  const writes: Array<{ entityId: string; value: string }> = [];
  const client = {
    setTextEntity: async (entityId: string, value: string) => {
      writes.push({ entityId, value });
    },
  } as unknown as IHaWriteClient;
  return { writer: new ZoneWriter(client), writes };
};

const zone = (id: string, type: ZonePolygon['type'], vertices = square): ZonePolygon => ({ id, type, vertices });

// Profile-style entity map with templates; no prefix is passed, so only explicit mappings resolve.
const entityMap = {
  polygonZoneEntities: { zone1: 't', zone2: 't', zone3: 't', zone4: 't' },
  polygonExclusionEntities: { exclusion1: 't', exclusion2: 't' },
  polygonEntryEntities: { entry1: 't', entry2: 't' },
};

test('unresolved regular zones fail the save while mapped clear slots are still cleared', async () => {
  const { writer, writes } = makeWriter();
  // Mirrors issue #431: polygon zones 1-3 unmapped, zone 4 mapped.
  const mappings = {
    polygonZoneEntities: { zone4: 'text.ep_polygon_zone_4' },
    polygonExclusionEntities: { exclusion2: 'text.ep_polygon_exclusion_2' },
    polygonEntryEntities: { entry1: 'text.ep_polygon_entry_1', entry2: 'text.ep_polygon_entry_2' },
  } as unknown as EntityMappings;

  const result = await writer.applyPolygonZones(entityMap, [zone('Zone 1', 'regular'), zone('Zone 2', 'regular')], undefined, mappings);

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.failures.map((f) => [f.error, f.description]),
    [
      ['ENTITY_NOT_MAPPED', 'Zone 1 could not be saved: no Polygon Zone 1 entity is mapped for this device'],
      ['ENTITY_NOT_MAPPED', 'Zone 2 could not be saved: no Polygon Zone 2 entity is mapped for this device'],
    ]
  );
  assert.deepEqual(
    writes.map((w) => [w.entityId, w.value]),
    [
      ['text.ep_polygon_zone_4', ''],
      ['text.ep_polygon_exclusion_2', ''],
      ['text.ep_polygon_entry_1', ''],
      ['text.ep_polygon_entry_2', ''],
    ]
  );
});

test('resolved zones are written and unresolved exclusion/entry zones are reported by slot position', async () => {
  const { writer, writes } = makeWriter();
  const mappings = {
    polygonZoneEntities: { zone1: 'text.z1', zone2: 'text.z2' },
    polygonExclusionEntities: {},
    polygonEntryEntities: { entry1: 'text.e1' },
  } as unknown as EntityMappings;

  const result = await writer.applyPolygonZones(
    entityMap,
    [
      zone('Zone 1', 'regular'),
      zone('Exclusion 1', 'exclusion'),
      zone('Entry 1', 'entry'),
      zone('Entry 2', 'entry'),
    ],
    undefined,
    mappings
  );

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.failures.map((f) => f.description),
    [
      'Exclusion 1 could not be saved: no Polygon Exclusion 1 entity is mapped for this device',
      'Entry 2 could not be saved: no Polygon Entry 2 entity is mapped for this device',
    ]
  );
  assert.deepEqual(
    writes.map((w) => [w.entityId, w.value === '' ? 'clear' : 'write']),
    [
      ['text.z1', 'write'],
      ['text.z2', 'clear'],
      ['text.e1', 'write'],
    ]
  );
});

test('invalid polygons are reported instead of silently skipped', async () => {
  const { writer, writes } = makeWriter();
  const mappings = { polygonZoneEntities: { zone1: 'text.z1' } } as unknown as EntityMappings;
  const line = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 0 }];

  const result = await writer.applyPolygonZones(entityMap, [zone('Zone 1', 'regular', line)], undefined, mappings);

  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].error, 'INVALID_POLYGON');
  assert.equal(result.failures[0].entityId, 'text.z1');
  assert.equal(writes.length, 0);
});

test('fully mapped save succeeds with writes and clears unchanged', async () => {
  const { writer, writes } = makeWriter();
  const mappings = {
    polygonZoneEntities: { zone1: 'text.z1', zone2: 'text.z2' },
    polygonExclusionEntities: { exclusion1: 'text.x1' },
    polygonEntryEntities: {},
  } as unknown as EntityMappings;

  const result = await writer.applyPolygonZones(entityMap, [zone('Zone 1', 'regular')], undefined, mappings);

  assert.deepEqual(result, { ok: true, failures: [] });
  assert.deepEqual(
    writes.map((w) => [w.entityId, w.value === '' ? 'clear' : 'write']),
    [
      ['text.z1', 'write'],
      ['text.z2', 'clear'],
      ['text.x1', 'clear'],
    ]
  );
});
