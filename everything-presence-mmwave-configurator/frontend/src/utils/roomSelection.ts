/**
 * Shared rule for "which room should a page show once its rooms have loaded?".
 *
 * The page owns the selection while it is open: a fetch that resolves after the
 * user already picked a room from the header dropdown must not yank them back to
 * the room the parent handed in as `initialRoomId`. Only when the current
 * selection is missing (first load) or no longer exists on the server do we fall
 * back to the incoming room, and then to the first room available.
 */
export interface SelectableRoom {
  id: string;
}

export const resolveLoadedRoomSelection = <T extends SelectableRoom>(
  rooms: T[],
  initialRoomId?: string | null,
  currentRoomId?: string | null,
): T | null => {
  const current = currentRoomId ? rooms.find((room) => room.id === currentRoomId) : undefined;
  if (current) return current;

  const initial = initialRoomId ? rooms.find((room) => room.id === initialRoomId) : undefined;
  if (initial) return initial;

  return rooms[0] ?? null;
};
