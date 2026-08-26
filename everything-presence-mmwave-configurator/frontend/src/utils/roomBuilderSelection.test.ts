// @ts-nocheck -- Node's built-in runner supplies these modules; frontend production types stay dependency-free.
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDeleteKeyTarget, resolveSelectionState } from './roomBuilderSelection.ts';

test('selecting furniture clears the door and wall selections', () => {
  assert.deepEqual(resolveSelectionState({ kind: 'furniture', id: 'sofa-1' }), {
    selectedFurnitureId: 'sofa-1',
    selectedDoorId: null,
    selectedSegment: null,
  });
});

test('selecting a door clears the furniture and wall selections', () => {
  assert.deepEqual(resolveSelectionState({ kind: 'door', id: 'door-1' }), {
    selectedFurnitureId: null,
    selectedDoorId: 'door-1',
    selectedSegment: null,
  });
});

test('selecting a wall segment clears the furniture and door selections', () => {
  assert.deepEqual(resolveSelectionState({ kind: 'segment', index: 0 }), {
    selectedFurnitureId: null,
    selectedDoorId: null,
    selectedSegment: 0,
  });
});

test('clearing the selection empties all three states', () => {
  assert.deepEqual(resolveSelectionState({ kind: 'none' }), {
    selectedFurnitureId: null,
    selectedDoorId: null,
    selectedSegment: null,
  });
});

test('Del deletes the selected furniture, not a wall point', () => {
  // Regression: adding furniture left an earlier wall selection in place, so Del
  // fell through to the wall branch and removed a room corner instead.
  assert.equal(
    resolveDeleteKeyTarget({
      selectedFurnitureId: 'sofa-1',
      selectedSegment: 2,
      hasRoomOutline: true,
    }),
    'furniture',
  );
});

test('Del deletes selected furniture even in a room with no outline', () => {
  assert.equal(
    resolveDeleteKeyTarget({ selectedFurnitureId: 'sofa-1', hasRoomOutline: false }),
    'furniture',
  );
});

test('Del deletes the selected door when no furniture is selected', () => {
  assert.equal(
    resolveDeleteKeyTarget({ selectedDoorId: 'door-1', selectedSegment: 1, hasRoomOutline: true }),
    'door',
  );
});

test('Del still deletes the selected wall point when nothing else is selected', () => {
  assert.equal(resolveDeleteKeyTarget({ selectedSegment: 0, hasRoomOutline: true }), 'wallPoint');
});

test('Del removes the last placed point while drawing', () => {
  assert.equal(
    resolveDeleteKeyTarget({ selectedSegment: null, isDrawingWall: true, hasRoomOutline: true }),
    'lastDrawnPoint',
  );
});

test('a live selection outranks the drawing tool', () => {
  assert.equal(
    resolveDeleteKeyTarget({ selectedFurnitureId: 'sofa-1', isDrawingWall: true, hasRoomOutline: true }),
    'furniture',
  );
});

test('Del does nothing with an empty selection', () => {
  assert.equal(resolveDeleteKeyTarget({ hasRoomOutline: true }), null);
});

test('Del does nothing on wall state when the room has no outline', () => {
  assert.equal(resolveDeleteKeyTarget({ selectedSegment: 0, isDrawingWall: true, hasRoomOutline: false }), null);
});
