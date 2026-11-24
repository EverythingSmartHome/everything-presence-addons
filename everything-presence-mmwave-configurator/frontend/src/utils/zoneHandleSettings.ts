export const ZONE_HANDLE_MIN = 6;
export const ZONE_HANDLE_MAX = 14;
export const ZONE_HANDLE_DEFAULT = 8;

export const normalizeZoneHandleSize = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(ZONE_HANDLE_MAX, Math.max(ZONE_HANDLE_MIN, value))
    : ZONE_HANDLE_DEFAULT;

// xMidYMid meet fits the square viewBox to the shorter viewport side.
export const zoneHandleUnit = (zoom: number, width: number, height: number): number => {
  const effectiveZoom = Math.min(5, Math.max(0.1, Number.isFinite(zoom) ? zoom : 1));
  const side = Math.min(width, height);
  return 700 / effectiveZoom / (Number.isFinite(side) && side > 0 ? side : 700);
};
