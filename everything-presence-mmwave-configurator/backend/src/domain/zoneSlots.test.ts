import assert from 'node:assert/strict';
import test from 'node:test';
import { zoneSlotFromId } from './zoneSlots';

test('returns the trailing integer of a zone id', () => {
  assert.equal(zoneSlotFromId('Zone 3'), 3);
  assert.equal(zoneSlotFromId('Entry 2'), 2);
  assert.equal(zoneSlotFromId('Exclusion 10'), 10);
  assert.equal(zoneSlotFromId(' Zone 4 '), 4);
  assert.equal(zoneSlotFromId('Zone 0'), 0);
});

test('returns null when the id does not end in a number', () => {
  assert.equal(zoneSlotFromId('Zone'), null);
  assert.equal(zoneSlotFromId('Zone 2a'), null);
  assert.equal(zoneSlotFromId(''), null);
});
