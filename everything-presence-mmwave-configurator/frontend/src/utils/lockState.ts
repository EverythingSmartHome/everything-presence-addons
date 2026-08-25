import type { DevicePlacement, Door, FurnitureInstance, RoomShell } from '../api/types';

/**
 * Per-object locking for the Room Builder.
 *
 * A locked object is pinned: it cannot be selected, dragged or edited, so
 * working next to it never picks it up by accident. Locks live on the room
 * config (`RoomShell.locked` / `RoomShell.lockedSegments`, `FurnitureInstance.locked`,
 * `Door.locked`), so they survive a reload and are visible to every screen that
 * renders a room.
 *
 * Walls have no identity of their own: segment `i` spans
 * `points[i] -> points[(i + 1) % points.length]`, exactly like `Door.segmentIndex`.
 * Splitting a wall or deleting a corner therefore renumbers every later segment,
 * which is what the remap helpers below exist for.
 */

/** Anything that carries a lock flag. */
export interface Lockable {
  locked?: boolean;
}

/** True when the whole outline is pinned. */
export const isShellLocked = (shell: RoomShell | null | undefined): boolean => !!shell?.locked;

/** Wall indices that are valid for an outline of `pointCount` points, de-duplicated and ordered. */
export const normalizeLockedSegments = (
  segments: readonly number[] | null | undefined,
  pointCount: number,
): number[] => {
  if (!Array.isArray(segments) || pointCount <= 0) return [];
  const seen = new Set<number>();
  for (const value of segments) {
    if (Number.isInteger(value) && value >= 0 && value < pointCount) seen.add(value);
  }
  return [...seen].sort((a, b) => a - b);
};

/** Every wall index that is currently pinned, whether individually or via the whole-outline lock. */
export const getLockedSegments = (
  shell: RoomShell | null | undefined,
  pointCount: number,
): number[] => {
  if (pointCount <= 0) return [];
  if (isShellLocked(shell)) return Array.from({ length: pointCount }, (_, i) => i);
  return normalizeLockedSegments(shell?.lockedSegments, pointCount);
};

export const isSegmentLocked = (
  shell: RoomShell | null | undefined,
  index: number | null | undefined,
): boolean => {
  if (index === null || index === undefined) return false;
  if (isShellLocked(shell)) return true;
  return (shell?.lockedSegments ?? []).includes(index);
};

/**
 * A corner belongs to two walls; dragging it moves both, so it is locked as
 * soon as either neighbour is.
 */
export const isVertexLocked = (
  shell: RoomShell | null | undefined,
  index: number,
  pointCount: number,
): boolean => {
  if (pointCount <= 0) return false;
  if (isShellLocked(shell)) return true;
  const previous = (index - 1 + pointCount) % pointCount;
  return isSegmentLocked(shell, index) || isSegmentLocked(shell, previous);
};

/** Flip the lock on one wall, leaving the rest of the outline untouched. */
export const toggleSegmentLock = (shell: RoomShell, index: number): RoomShell => {
  const pointCount = shell.points?.length ?? 0;
  const current = new Set(getLockedSegments(shell, pointCount));
  if (current.has(index)) {
    current.delete(index);
  } else {
    current.add(index);
  }
  const lockedSegments = normalizeLockedSegments([...current], pointCount);
  const everyWall = pointCount > 0 && lockedSegments.length === pointCount;
  return {
    ...shell,
    // Unlocking one wall has to drop the whole-outline lock, otherwise the
    // per-wall list below would be shadowed by it.
    locked: everyWall ? true : undefined,
    lockedSegments: lockedSegments.length && !everyWall ? lockedSegments : undefined,
  };
};

/** Lock or unlock the outline as a whole ("the room"). */
export const setShellLocked = (shell: RoomShell, locked: boolean): RoomShell => ({
  ...shell,
  locked: locked ? true : undefined,
  lockedSegments: undefined,
});

/** True when every wall of the outline is pinned. */
export const areAllSegmentsLocked = (shell: RoomShell | null | undefined): boolean => {
  const pointCount = shell?.points?.length ?? 0;
  if (pointCount === 0) return false;
  return getLockedSegments(shell, pointCount).length === pointCount;
};

/**
 * Re-index locked walls after `insertPointOnSegment` splits segment `segmentIndex`
 * by inserting a corner at `segmentIndex + 1`. Walls after the split shift up by
 * one; the split wall stays locked on both halves.
 */
export const remapLockedSegmentsForSplit = (
  segments: readonly number[] | null | undefined,
  segmentIndex: number,
): number[] => {
  const next = new Set<number>();
  for (const value of segments ?? []) {
    if (value < segmentIndex) next.add(value);
    else if (value === segmentIndex) {
      next.add(segmentIndex);
      next.add(segmentIndex + 1);
    } else next.add(value + 1);
  }
  return [...next].sort((a, b) => a - b);
};

/**
 * Where old wall `index` ends up once the corner at `removedIndex` is deleted
 * from an outline of `pointCount` points. The two walls either side of the
 * removed corner merge into one.
 */
export const remapSegmentIndexForPointRemoval = (
  index: number,
  removedIndex: number,
  pointCount: number,
): number => {
  const merged = removedIndex === 0 ? pointCount - 2 : removedIndex - 1;
  if (index === removedIndex) return merged;
  return index > removedIndex ? index - 1 : index;
};

/** Re-index locked walls after the corner at `removedIndex` is deleted. */
export const remapLockedSegmentsForPointRemoval = (
  segments: readonly number[] | null | undefined,
  removedIndex: number,
  pointCount: number,
): number[] => {
  if (pointCount <= 2) return [];
  const next = new Set<number>();
  for (const value of segments ?? []) {
    const mapped = remapSegmentIndexForPointRemoval(value, removedIndex, pointCount);
    if (mapped >= 0 && mapped < pointCount - 1) next.add(mapped);
  }
  return [...next].sort((a, b) => a - b);
};

/**
 * Doors are anchored to the same wall indices, so a split or a corner deletion
 * silently moves them onto the wrong wall unless they are remapped too.
 *
 * `splitRatio` is where along the wall the new corner landed (0..1): doors
 * before it stay on the first half, doors after it move to the second, and both
 * keep their real-world position by rescaling `positionOnSegment`.
 */
export const remapDoorsForSplit = (
  doors: readonly Door[] | null | undefined,
  segmentIndex: number,
  splitRatio: number,
): Door[] => {
  const ratio = Number.isFinite(splitRatio) ? Math.min(1, Math.max(0, splitRatio)) : 0.5;
  return (doors ?? []).map((door) => {
    if (door.segmentIndex < segmentIndex) return door;
    if (door.segmentIndex > segmentIndex) return { ...door, segmentIndex: door.segmentIndex + 1 };
    if (ratio <= 0 || ratio >= 1) return door;
    if (door.positionOnSegment <= ratio) {
      return { ...door, positionOnSegment: door.positionOnSegment / ratio };
    }
    return {
      ...door,
      segmentIndex: segmentIndex + 1,
      positionOnSegment: (door.positionOnSegment - ratio) / (1 - ratio),
    };
  });
};

/** Re-index doors after the corner at `removedIndex` is deleted. */
export const remapDoorsForPointRemoval = (
  doors: readonly Door[] | null | undefined,
  removedIndex: number,
  pointCount: number,
): Door[] =>
  (doors ?? []).map((door) => {
    const mapped = remapSegmentIndexForPointRemoval(door.segmentIndex, removedIndex, pointCount);
    return mapped === door.segmentIndex ? door : { ...door, segmentIndex: mapped };
  });

/**
 * What a locked item is allowed to accept. Locked means locked: the only edit
 * that gets through is the one that unlocks it again, and that edit applies
 * nothing but the unlock.
 */
export const resolveLockedUpdate = <T extends Lockable>(
  previous: T | undefined | null,
  next: T,
): T | null => {
  if (!previous?.locked) return next;
  // Spreading a generic widens its type, so the cast keeps the caller's shape.
  return next.locked === false ? ({ ...previous, locked: false } as T) : null;
};

/**
 * The device lock is a position-only lock: a mounted sensor's coordinates are
 * what must not be nudged, while re-aiming it is the routine adjustment. So an
 * update to a locked device drops `x`/`y` and lets everything else through.
 */
export const isDevicePositionLocked = (placement: DevicePlacement | null | undefined): boolean =>
  !!placement?.locked;

export const applyDevicePlacementUpdate = (
  previous: DevicePlacement,
  updates: Partial<DevicePlacement>,
): DevicePlacement => {
  // An explicit unlock in the same update wins, so unlocking and moving at once
  // is still possible from the settings panel.
  const stillLocked = updates.locked !== undefined ? !!updates.locked : !!previous.locked;
  const next = { ...previous, ...updates };
  // Everything else applies; only the coordinates are put back.
  return stillLocked ? { ...next, x: previous.x, y: previous.y } : next;
};

export const areAllItemsLocked = (items: readonly Lockable[] | null | undefined): boolean =>
  !!items?.length && items.every((item) => !!item.locked);

export const setItemsLocked = <T extends Lockable>(
  items: readonly T[] | null | undefined,
  locked: boolean,
): T[] => (items ?? []).map((item) => ({ ...item, locked: locked ? true : undefined } as T));

/** How many objects in the room are currently pinned. */
export const countLockedObjects = (room: {
  roomShell?: RoomShell;
  furniture?: FurnitureInstance[];
  doors?: Door[];
} | null | undefined): number => {
  if (!room) return 0;
  const pointCount = room.roomShell?.points?.length ?? 0;
  return (
    getLockedSegments(room.roomShell, pointCount).length +
    (room.furniture ?? []).filter((item) => item.locked).length +
    (room.doors ?? []).filter((door) => door.locked).length
  );
};
