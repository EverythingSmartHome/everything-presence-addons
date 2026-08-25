import type { Door } from '../api/types';

export const DOOR_STYLES = ['single', 'sliding', 'opening', 'double'] as const;
export type DoorStyle = (typeof DOOR_STYLES)[number];

/** Normalize untrusted persisted data without discarding legacy hinge choices. */
export const normalizeDoor = (value: Partial<Door> & { id: string }): Door => ({
  id: value.id,
  style: DOOR_STYLES.includes(value.style as DoorStyle) ? value.style as DoorStyle : 'single',
  segmentIndex: Number.isFinite(value.segmentIndex) ? Math.max(0, Math.trunc(value.segmentIndex!)) : 0,
  positionOnSegment: Number.isFinite(value.positionOnSegment)
    ? Math.min(1, Math.max(0, value.positionOnSegment!)) : 0.5,
  widthMm: Number.isFinite(value.widthMm) && value.widthMm! > 0 ? value.widthMm! : 800,
  swingDirection: value.swingDirection === 'out' ? 'out' : 'in',
  swingSide: value.swingSide === 'right' ? 'right' : 'left',
  locked: value.locked === undefined ? undefined : Boolean(value.locked),
});

export interface DoorGeometry {
  style: DoorStyle;
  halfWidth: number;
  normalSign: 1 | -1;
  hitBounds: { x: number; y: number; width: number; height: number };
  hingeX?: number;
  panelEnd?: { x: number; y: number };
  arc?: { startX: number; startY: number; endX: number; endY: number; radius: number; sweep: 0 | 1 };
  leaves?: Array<{ hingeX: number; endX: number; endY: number; sweep: 0 | 1 }>;
  slidingPanel?: { startX: number; endX: number; y: number; direction: -1 | 1 };
}

/** Keep the complete opening on its wall instead of allowing its centre to reach a corner. */
export const clampDoorPosition = (position: number, width: number, segmentLength: number): number => {
  if (!Number.isFinite(segmentLength) || segmentLength <= 0) return 0.5;
  const halfRatio = Math.max(0, width) / segmentLength / 2;
  if (halfRatio >= 0.5) return 0.5;
  return Math.min(1 - halfRatio, Math.max(halfRatio, position));
};

/** Local SVG geometry: the wall runs left-to-right through y=0. */
export const getDoorGeometry = (
  doorValue: Door,
  inwardNormalSign: number,
  options: { padding?: number; shallowDepth?: number } = {},
): DoorGeometry => {
  const door = normalizeDoor(doorValue);
  const halfWidth = door.widthMm / 2;
  const swingSign: 1 | -1 = (door.swingDirection === 'in' ? inwardNormalSign : -inwardNormalSign) >= 0 ? 1 : -1;
  // Sliding leaves and cased openings have no swing, so they always sit on the room side.
  const normalSign: 1 | -1 = door.style === 'sliding' || door.style === 'opening'
    ? (inwardNormalSign >= 0 ? 1 : -1)
    : swingSign;
  const padding = options.padding ?? 10;
  const depth = door.style === 'single'
    ? door.widthMm
    : door.style === 'double'
      ? halfWidth
      : options.shallowDepth ?? Math.max(24, door.widthMm * 0.08);
  const base: DoorGeometry = {
    style: door.style,
    halfWidth,
    normalSign,
    hitBounds: {
      x: -halfWidth - padding,
      y: normalSign > 0 ? -padding : -depth - padding,
      width: door.widthMm + padding * 2,
      height: depth + padding * 2,
    },
  };
  if (door.style === 'single') {
    const hingeX = door.swingSide === 'right' ? halfWidth : -halfWidth;
    const startX = -hingeX;
    const endY = normalSign * door.widthMm;
    return { ...base, hingeX, panelEnd: { x: hingeX, y: endY }, arc: { startX, startY: 0, endX: hingeX, endY, radius: door.widthMm, sweep: (startX - hingeX) * endY > 0 ? 1 : 0 } };
  }
  if (door.style === 'double') {
    const endY = normalSign * halfWidth;
    return { ...base, leaves: [
      { hingeX: -halfWidth, endX: -halfWidth, endY, sweep: normalSign > 0 ? 0 : 1 },
      { hingeX: halfWidth, endX: halfWidth, endY, sweep: normalSign > 0 ? 1 : 0 },
    ] };
  }
  if (door.style === 'sliding') {
    // A patio-style slider that lives entirely within its opening: the leaf is half
    // the opening wide and, like hinged leaves, is drawn in its open position - slid
    // across the half on the side it slides toward, hugging the wall a quarter of the
    // shallow depth into the room. The other half is the travel path.
    const direction: 1 | -1 = door.swingSide === 'right' ? 1 : -1;
    const startX = direction > 0 ? 0 : -halfWidth;
    return { ...base, slidingPanel: { startX, endX: startX + halfWidth, y: normalSign * depth / 4, direction } };
  }
  return base;
};
