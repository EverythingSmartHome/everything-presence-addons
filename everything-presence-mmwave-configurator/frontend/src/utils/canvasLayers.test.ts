// @ts-nocheck -- Node's built-in runner supplies these modules.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CANVAS_LAYER_ORDER, HANDLES_LAYER, canvasLayerProps, canvasLayerRank } from './canvasLayers.ts';

test('handles are the top layer and unknown layers rank below them', () => {
  assert.equal(CANVAS_LAYER_ORDER[CANVAS_LAYER_ORDER.length - 1], HANDLES_LAYER);
  assert.ok(canvasLayerRank('furniture') < canvasLayerRank(HANDLES_LAYER));
  assert.ok(canvasLayerRank('doors') < canvasLayerRank('furniture'));
  assert.ok(canvasLayerRank('device') < canvasLayerRank(HANDLES_LAYER));
  // A layer nobody listed still cannot bury a control.
  assert.ok(canvasLayerRank('zones-somebody-added-later') < canvasLayerRank(HANDLES_LAYER));
});

test('canvasLayerProps tags a group with its layer', () => {
  assert.deepEqual(canvasLayerProps('handles'), { 'data-canvas-layer': 'handles' });
});

/**
 * The room canvas is one flat `<svg>`, so paint order is source order: a block
 * emitted after the wall handles both covers them and steals their clicks.
 * This guards the ordering that regressed when furniture ended up drawn over
 * the draggable wall corner nodes.
 */
test('RoomCanvas emits its layers in paint order, handles last', () => {
  const source = readFileSync(new URL('../components/RoomCanvas.tsx', import.meta.url), 'utf8');
  const layers = [...source.matchAll(/canvasLayerProps\('([a-z-]+)'\)/g)].map((match) => match[1]);

  assert.ok(layers.includes('furniture'), 'furniture layer should be tagged');
  assert.ok(layers.includes('doors'), 'doors layer should be tagged');
  assert.equal(layers.filter((layer) => layer === HANDLES_LAYER).length, 1, 'handles should be a single layer');
  assert.equal(layers[layers.length - 1], HANDLES_LAYER, 'handles must be the last layer emitted');

  for (const layer of layers) {
    assert.ok(CANVAS_LAYER_ORDER.includes(layer), `unknown canvas layer: ${layer}`);
  }
  const ranks = layers.map(canvasLayerRank);
  for (let i = 1; i < ranks.length; i++) {
    assert.ok(ranks[i] >= ranks[i - 1], `layer "${layers[i]}" is drawn after "${layers[i - 1]}"`);
  }
});
