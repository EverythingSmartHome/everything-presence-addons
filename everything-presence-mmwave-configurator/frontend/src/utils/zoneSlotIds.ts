type ZoneType = 'regular' | 'exclusion' | 'entry';

const ID_PREFIX: Record<ZoneType, string> = {
  regular: 'Zone',
  exclusion: 'Exclusion',
  entry: 'Entry',
};

/** Device slot encoded in a zone id ("Entry 2" -> 2), or null. Mirrors the backend's zoneSlotFromId. */
export const zoneSlotFromId = (id: string): number | null => {
  const match = String(id ?? '').trim().match(/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
};

/**
 * Id for a new zone of the given type, using the lowest slot number no
 * existing zone of that type uses. Zones read back from a device keep their
 * slot ids ("Zone 2" when slot 1 is empty), so counting zones would collide.
 */
export const nextZoneId = (zones: ReadonlyArray<{ id: string; type: string }>, type: ZoneType): string => {
  const used = new Set(
    zones
      .filter((zone) => zone.type === type)
      .map((zone) => zoneSlotFromId(zone.id))
      .filter((slot): slot is number => slot !== null),
  );
  let slot = 1;
  while (used.has(slot)) slot += 1;
  return `${ID_PREFIX[type]} ${slot}`;
};
