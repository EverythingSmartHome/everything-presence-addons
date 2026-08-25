import type { RoomConfig } from '../api/types';
// Explicit extension so Node's built-in test runner can resolve it too.
import { stableStringify } from './stableStringify.ts';

/**
 * Session-only undo/redo for the Room Builder.
 *
 * The stack lives in component state (a ref in RoomBuilderPage), so it dies on
 * unmount or reload and never reaches the backend. Only the parts of a room the
 * builder can edit are snapshotted - zones, entity mappings and metadata are
 * owned by other screens and must survive an undo untouched.
 */

/** Bounded so a long editing session cannot grow memory without limit. */
export const ROOM_HISTORY_LIMIT = 50;

export type RoomSnapshot = Pick<
  RoomConfig,
  'roomShell' | 'roomShellFillMode' | 'floorMaterial' | 'devicePlacement' | 'furniture' | 'doors'
>;

export interface RoomHistoryEntry {
  snapshot: RoomSnapshot;
  /**
   * Identifies the gesture that produced the edit (a furniture drag, a slider
   * sweep, ...). Consecutive commits sharing a key collapse into this entry so
   * one gesture is one undo step, not one step per pointer-move event.
   */
  coalesceKey?: string | null;
}

export interface RoomHistory {
  past: RoomHistoryEntry[];
  future: RoomHistoryEntry[];
}

export const createRoomHistory = (): RoomHistory => ({ past: [], future: [] });

/** Copy the editable subset of a room, deeply enough that later edits cannot mutate it. */
export const snapshotRoom = (room: RoomConfig): RoomSnapshot => ({
  roomShell: room.roomShell
    ? {
      ...room.roomShell,
      points: (room.roomShell.points ?? []).map((point) => ({ ...point })),
      // Locked wall indices are an array too, so copy it or an undo would hand
      // back the very array a later edit is about to rewrite.
      ...(room.roomShell.lockedSegments ? { lockedSegments: [...room.roomShell.lockedSegments] } : {}),
    }
    : room.roomShell,
  roomShellFillMode: room.roomShellFillMode,
  floorMaterial: room.floorMaterial,
  devicePlacement: room.devicePlacement ? { ...room.devicePlacement } : room.devicePlacement,
  furniture: room.furniture ? room.furniture.map((item) => ({ ...item })) : room.furniture,
  doors: room.doors ? room.doors.map((door) => ({ ...door })) : room.doors,
});

/** Put a snapshot back on a room, leaving every non-builder field as it is now. */
export const applyRoomSnapshot = (room: RoomConfig, snapshot: RoomSnapshot): RoomConfig => ({
  ...room,
  ...snapshotRoom({ ...room, ...snapshot }),
});

export const roomSnapshotSignature = (snapshot: RoomSnapshot): string => stableStringify(snapshot);

export const snapshotsEqual = (a: RoomSnapshot, b: RoomSnapshot): boolean =>
  roomSnapshotSignature(a) === roomSnapshotSignature(b);

export interface PushRoomHistoryOptions {
  /** Gesture key for the edit being committed, if any. */
  coalesceKey?: string | null;
  /** Gesture key that is still in progress (cleared on pointer-up / blur). */
  activeCoalesceKey?: string | null;
  limit?: number;
}

/**
 * Record `snapshot` (the state *before* the edit) as the next undo step.
 * Redo is dropped, because the timeline just branched.
 */
export function pushRoomHistory(
  history: RoomHistory,
  snapshot: RoomSnapshot,
  options: PushRoomHistoryOptions = {},
): RoomHistory {
  const { coalesceKey = null, activeCoalesceKey = null, limit = ROOM_HISTORY_LIMIT } = options;

  // Mid-gesture: the first snapshot of the gesture is the one worth keeping.
  if (coalesceKey && coalesceKey === activeCoalesceKey && history.past.length > 0) {
    return { past: history.past, future: [] };
  }

  const past = [...history.past, { snapshot, coalesceKey }];
  return {
    past: past.length > limit ? past.slice(past.length - limit) : past,
    future: [],
  };
}

export interface RoomHistoryStep {
  history: RoomHistory;
  snapshot: RoomSnapshot;
}

/** Pop the last undo step, pushing `current` onto the redo stack. */
export function undoRoomHistory(history: RoomHistory, current: RoomSnapshot): RoomHistoryStep | null {
  if (!history.past.length) return null;
  const entry = history.past[history.past.length - 1];
  return {
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, { snapshot: current }],
    },
    snapshot: entry.snapshot,
  };
}

/** Pop the last redo step, pushing `current` back onto the undo stack. */
export function redoRoomHistory(history: RoomHistory, current: RoomSnapshot): RoomHistoryStep | null {
  if (!history.future.length) return null;
  const entry = history.future[history.future.length - 1];
  return {
    history: {
      past: [...history.past, { snapshot: current }],
      future: history.future.slice(0, -1),
    },
    snapshot: entry.snapshot,
  };
}

export const canUndoRoomHistory = (history: RoomHistory | undefined | null): boolean =>
  !!history?.past.length;

export const canRedoRoomHistory = (history: RoomHistory | undefined | null): boolean =>
  !!history?.future.length;
