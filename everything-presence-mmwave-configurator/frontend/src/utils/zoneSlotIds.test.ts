// @ts-nocheck -- Node's built-in runner supplies these modules; frontend production types stay dependency-free.
import assert from 'node:assert/strict';
import test from 'node:test';
import { nextZoneId, zoneSlotFromId } from './zoneSlotIds.ts';

test('zoneSlotFromId reads the trailing number', () => {
  assert.equal(zoneSlotFromId('Entry 2'), 2);
  assert.equal(zoneSlotFromId('Zone'), null);
});

test('nextZoneId picks the first free slot per type', () => {
  assert.equal(nextZoneId([], 'regular'), 'Zone 1');
  assert.equal(
    nextZoneId([{ id: 'Zone 1', type: 'regular' }, { id: 'Zone 2', type: 'regular' }], 'regular'),
    'Zone 3',
  );
  // Read-back with slot 1 empty must not produce a second "Zone 2".
  assert.equal(nextZoneId([{ id: 'Zone 2', type: 'regular' }], 'regular'), 'Zone 1');
  assert.equal(
    nextZoneId([{ id: 'Zone 1', type: 'regular' }, { id: 'Entry 1', type: 'entry' }], 'entry'),
    'Entry 2',
  );
  assert.equal(nextZoneId([{ id: 'Zone 1', type: 'regular' }], 'exclusion'), 'Exclusion 1');
});
