/**
 * Device slot number encoded in a zone id: the trailing integer
 * ("Zone 3" -> 3, "Entry 2" -> 2, "Exclusion 10" -> 10).
 * Returns null when the id does not end in a number.
 */
export function zoneSlotFromId(id: string): number | null {
  if (typeof id !== 'string') return null;
  const match = id.trim().match(/(\d+)$/);
  if (!match) return null;
  const slot = parseInt(match[1], 10);
  return Number.isSafeInteger(slot) ? slot : null;
}
