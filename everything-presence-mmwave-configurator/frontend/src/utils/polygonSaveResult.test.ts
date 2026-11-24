// @ts-nocheck -- Node's built-in runner supplies these modules; frontend production types stay dependency-free.
import assert from 'node:assert/strict';
import test from 'node:test';
import { describePolygonSaveFailure } from './polygonSaveResult.ts';

test('lists unmapped zones and tells the user to re-sync or map them', () => {
  const message = describePolygonSaveFailure([
    { description: 'Zone 1 could not be saved: no Polygon Zone 1 entity is mapped for this device', error: 'ENTITY_NOT_MAPPED' },
    { description: 'Zone 2 could not be saved: no Polygon Zone 2 entity is mapped for this device', error: 'ENTITY_NOT_MAPPED' },
  ]);
  assert.match(message, /Zone 1 could not be saved: no Polygon Zone 1 entity is mapped/);
  assert.match(message, /Zone 2 could not be saved/);
  assert.match(message, /Re-sync the device entities/);
  assert.match(message, /device settings/);
});

test('includes the error for write failures and omits the mapping hint', () => {
  const message = describePolygonSaveFailure([
    { entityId: 'text.z1', description: 'polygon zone 1', error: 'Request timed out' },
  ]);
  assert.match(message, /polygon zone 1 \(Request timed out\)/);
  assert.doesNotMatch(message, /Re-sync/);
});

test('caps the list and counts the rest', () => {
  const warnings = Array.from({ length: 6 }, (_, i) => ({
    description: `Zone ${i + 1} could not be saved: no Polygon Zone ${i + 1} entity is mapped for this device`,
    error: 'ENTITY_NOT_MAPPED',
  }));
  const message = describePolygonSaveFailure(warnings);
  assert.match(message, /Zone 4 could not be saved/);
  assert.doesNotMatch(message, /Zone 5 could not be saved/);
  assert.match(message, /\(\+2 more\)/);
});

test('lists unsaved zones before write failures and advisory warnings', () => {
  const advisory = Array.from({ length: 4 }, (_, i) => ({
    entityId: `text.adv_${i}`,
    description: `Zone ${i + 1} entity is unavailable`,
    error: 'unavailable',
  }));
  const message = describePolygonSaveFailure([
    ...advisory,
    { entityId: 'text.x1', description: 'exclusion polygon 1', error: 'Request timed out' },
    { description: 'Zone 3 could not be saved: no Polygon Zone 3 entity is mapped for this device', error: 'ENTITY_NOT_MAPPED' },
    { entityId: 'text.z4', description: 'Zone 4 could not be saved: the polygon needs at least 3 distinct points', error: 'INVALID_POLYGON' },
  ]);
  const notMapped = message.indexOf('Zone 3 could not be saved');
  const invalid = message.indexOf('Zone 4 could not be saved');
  const writeFailure = message.indexOf('exclusion polygon 1 (Request timed out)');
  const firstAdvisory = message.indexOf('Zone 1 entity is unavailable');
  assert.ok(notMapped >= 0 && invalid > notMapped, 'unsaved zones come first, in original order');
  assert.ok(writeFailure > invalid, 'write failures follow unsaved zones');
  assert.ok(firstAdvisory > writeFailure, 'advisory warnings come last');
  assert.doesNotMatch(message, /Zone 2 entity is unavailable/);
  assert.match(message, /\(\+3 more\)/);
});

test('falls back to a generic message without warnings', () => {
  assert.equal(describePolygonSaveFailure(undefined), 'Polygon zones were not saved to the device.');
});
