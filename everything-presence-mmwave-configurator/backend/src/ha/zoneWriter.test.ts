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

test('resolved zones are written and unresolved exclusion/entry zones are reported by slot', async () => {
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

const allMapped = {
  polygonZoneEntities: { zone1: 'text.z1', zone2: 'text.z2', zone3: 'text.z3', zone4: 'text.z4' },
  polygonExclusionEntities: { exclusion1: 'text.x1', exclusion2: 'text.x2' },
  polygonEntryEntities: { entry1: 'text.e1', entry2: 'text.e2' },
} as unknown as EntityMappings;

const entryWrites = (writes: Array<{ entityId: string; value: string }>) =>
  writes
    .filter((w) => w.entityId.startsWith('text.e'))
    .map((w) => [w.entityId, w.value === '' ? 'clear' : 'write']);

test('a zone is written to the slot named by its id and unclaimed slots are cleared', async () => {
  const { writer, writes } = makeWriter();

  const result = await writer.applyPolygonZones(entityMap, [zone('Entry 2', 'entry')], undefined, allMapped);

  assert.deepEqual(result, { ok: true, failures: [] });
  assert.deepEqual(entryWrites(writes), [
    ['text.e2', 'write'],
    ['text.e1', 'clear'],
  ]);
});

test('zones listed out of order are each written to their own slot', async () => {
  const { writer, writes } = makeWriter();
  const larger = [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 2000 }];

  const result = await writer.applyPolygonZones(
    entityMap,
    [zone('Entry 2', 'entry', larger), zone('Entry 1', 'entry')],
    undefined,
    allMapped
  );

  assert.deepEqual(result, { ok: true, failures: [] });
  assert.equal(writes.find((w) => w.entityId === 'text.e1')?.value, '0:0;1000:0;1000:1000;0:1000');
  assert.equal(writes.find((w) => w.entityId === 'text.e2')?.value, '0:0;2000:0;2000:2000');
  assert.equal(writes.filter((w) => w.entityId.startsWith('text.e')).length, 2, 'no entry slot is cleared');
});

test('duplicate, out-of-range and unnumbered ids are reported and not written', async () => {
  const { writer, writes } = makeWriter();

  const result = await writer.applyPolygonZones(
    entityMap,
    [
      zone('Zone 1', 'regular'),
      zone('Zone 1', 'regular'),
      zone('Entry 5', 'entry'),
      zone('Exclusion', 'exclusion'),
    ],
    undefined,
    allMapped
  );

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.failures.map((f) => [f.error, f.description]),
    [
      ['DUPLICATE_ZONE_SLOT', 'Zone 1 could not be saved: another zone already uses Polygon Zone 1'],
      ['INVALID_ZONE_ID', 'Exclusion could not be saved: the zone id has no Polygon Exclusion slot number'],
      ['ZONE_SLOT_OUT_OF_RANGE', 'Entry 5 could not be saved: this device has only 2 Polygon Entry slots'],
    ]
  );
  // Only the first Zone 1 is written; every other slot is cleared.
  assert.deepEqual(
    writes.filter((w) => w.value !== '').map((w) => w.entityId),
    ['text.z1']
  );
  assert.deepEqual(
    writes.filter((w) => w.value === '').map((w) => w.entityId),
    ['text.z2', 'text.z3', 'text.z4', 'text.x1', 'text.x2', 'text.e1', 'text.e2']
  );
});

test('ENTITY_NOT_MAPPED names the slot from the zone id', async () => {
  const { writer } = makeWriter();
  const mappings = { polygonZoneEntities: { zone1: 'text.z1' } } as unknown as EntityMappings;

  const result = await writer.applyPolygonZones(entityMap, [zone('Zone 3', 'regular')], undefined, mappings);

  assert.equal(result.ok, false);
  assert.deepEqual(result.failures.map((f) => f.description), [
    'Zone 3 could not be saved: no Polygon Zone 3 entity is mapped for this device',
  ]);
});
