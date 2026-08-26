/**
 * The Room Builder can only ever have one thing selected: a piece of furniture,
 * a door, or a wall segment. Every entry point that changes the selection has to
 * clear the other two, otherwise an invisible leftover selection survives and
 * keyboard actions get routed to the wrong object - which is exactly how
 * "select furniture, press Del" ended up removing a wall corner: adding
 * furniture never cleared the wall segment picked earlier.
 */
export type BuilderSelection =
  | { kind: 'none' }
  | { kind: 'furniture'; id: string }
  | { kind: 'door'; id: string }
  | { kind: 'segment'; index: number };

export interface BuilderSelectionState {
  selectedFurnitureId: string | null;
  selectedDoorId: string | null;
  selectedSegment: number | null;
}

/** The one place that decides what "X is selected" means for all three states. */
export const resolveSelectionState = (selection: BuilderSelection): BuilderSelectionState => ({
  selectedFurnitureId: selection.kind === 'furniture' ? selection.id : null,
  selectedDoorId: selection.kind === 'door' ? selection.id : null,
  selectedSegment: selection.kind === 'segment' ? selection.index : null,
});

/**
 * What Del/Backspace acts on. `null` means "leave the key alone" - the page must
 * not call preventDefault, so the browser keeps its own meaning for the key.
 */
export type DeleteKeyTarget = 'furniture' | 'door' | 'wallPoint' | 'lastDrawnPoint' | null;

export interface DeleteKeyContext {
  selectedFurnitureId?: string | null;
  selectedDoorId?: string | null;
  selectedSegment?: number | null;
  /** True while the wall-drawing tool is active. */
  isDrawingWall?: boolean;
  /** True once the room has an outline with at least one point. */
  hasRoomOutline?: boolean;
}

/**
 * Precedence for Del, in the order the visible panels imply: whatever the user
 * just selected wins, and the wall-level meanings (documented as "delete the
 * last placed point") only apply when nothing else is selected.
 */
export const resolveDeleteKeyTarget = (context: DeleteKeyContext): DeleteKeyTarget => {
  if (context.selectedFurnitureId) return 'furniture';
  if (context.selectedDoorId) return 'door';
  // Wall-level deletes need an outline; furniture in a room without one must
  // still be deletable by key, so this guard sits below, not above.
  if (!context.hasRoomOutline) return null;
  if (context.selectedSegment !== null && context.selectedSegment !== undefined) return 'wallPoint';
  if (context.isDrawingWall) return 'lastDrawnPoint';
  return null;
};
