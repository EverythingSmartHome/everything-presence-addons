/**
 * Paint order for the room canvas.
 *
 * Everything the canvas draws lives in one `<svg>`, and SVG has no `z-index`:
 * a later sibling always paints over an earlier one, and always wins
 * hit-testing against it. The order of the blocks in `components/RoomCanvas`
 * is therefore a contract rather than an accident, so each block tags its
 * group with `canvasLayerProps(...)` and they are emitted bottom to top in the
 * order declared here.
 *
 * The rule that matters is the last one: interactive editing handles - wall
 * corner nodes, wall segment endpoint handles, furniture resize/rotate grips -
 * are drawn after every object they sit on. A handle buried under a sofa is
 * not merely invisible, it is unclickable, because the furniture's transparent
 * hit rect swallows the press that should have grabbed the corner.
 */

/** Canvas layers, bottom to top. */
export const CANVAS_LAYER_ORDER = ['floor', 'shell', 'doors', 'furniture', 'device', 'handles'] as const;

export type CanvasLayerId = (typeof CANVAS_LAYER_ORDER)[number];

/** The topmost layer: interactive editing handles, painted above everything else. */
export const HANDLES_LAYER: CanvasLayerId = 'handles';

/**
 * Where a layer sits in the paint order, lowest first. Unknown names rank
 * below the handles, so a layer nobody listed here can never bury a control.
 */
export const canvasLayerRank = (layer: string): number => {
  const index = (CANVAS_LAYER_ORDER as readonly string[]).indexOf(layer);
  if (index >= 0) return index;
  return CANVAS_LAYER_ORDER.indexOf(HANDLES_LAYER) - 0.5;
};

/**
 * Marks an SVG group as belonging to a canvas layer. The attribute documents
 * the intended paint order in the DOM (and lets a test assert it), while the
 * `CanvasLayerId` type keeps the names honest.
 */
export const canvasLayerProps = (layer: CanvasLayerId): { 'data-canvas-layer': CanvasLayerId } => ({
  'data-canvas-layer': layer,
});
