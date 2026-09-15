import type { RoomSnapshot } from './roomHistory';

/**
 * Rotating a whole floor plan.
 *
 * Room geometry lives in one mm-based, y-down world space: `roomShell.points`,
 * `FurnitureInstance.x/y/rotationDeg` and `devicePlacement.x/y/rotationDeg`.
 * Doors are wall-relative (`segmentIndex` + `positionOnSegment`) and locked wall
 * indices are just wall numbers, so both follow the outline for free as long as
 * point order and winding are preserved - which a rotation always does.
 *
 * Zones, live targets and the heatmap are stored in DEVICE-relative mm and are
 * mapped into room space by every screen as
 * `rotate(devicePlacement.rotationDeg + installationAngle)` then translate by the
 * device position. Rotating the device's position about the pivot AND adding the
 * same angle to `devicePlacement.rotationDeg` makes that mapping rigid:
 *
 *   deviceToRoom_new(p) = R_pivot(deviceToRoom_old(p))   for every device-frame p
 *
 * so in the `'layout'` scope zones, targets, heat pixels and the FOV cone rotate
 * with the walls on every screen with no change to any of those call sites.
 *
 * The two scopes are deliberately different repairs:
 *
 * - `'layout'` rotates the drawing *and* the sensor: a rigid reorientation, the
 *   room is simply drawn the other way up and nothing about how the sensor maps
 *   onto it changes.
 * - `'roomOnly'` rotates the drawing around a fixed sensor: the fix for "the
 *   sensor is detecting things 90 degrees off what I drew". The device-side
 *   Installation Angle cannot repair that on its own because it is capped at
 *   +/-45 degrees.
 *
 * Everything here is pure and dependency-free (like `roomShapes` / `lockState`)
 * so it can be unit-tested under Node's built-in runner.
 */

export type RotationScope = 'layout' | 'roomOnly';

/** The quarter turn the toolbar buttons and keyboard shortcuts apply. */
export const ROTATION_STEP_DEG = 90;

export interface RotationPoint {
  x: number;
  y: number;
}

/** mm are stored as floats; trim the noise a rotation introduces without losing real half-mm values. */
const MM_PRECISION = 1000;

const roundMm = (value: number): number =>
  Number.isFinite(value) ? Math.round(value * MM_PRECISION) / MM_PRECISION : 0;

/**
 * Fold an angle into (-180, 180], matching the device rotation slider's range so
 * a rotated placement still lands inside the control that edits it.
 */
export const normalizeSignedAngle = (angle: number): number => {
  if (!Number.isFinite(angle)) return 0;
  // [0, 360) first, so a half turn lands on +180 rather than -180: the two are
  // the same heading and the slider's documented bound is the positive one.
  const positive = ((angle % 360) + 360) % 360;
  return roundMm(positive > 180 ? positive - 360 : positive);
};

/**
 * Fold an angle into [0, 360).
 *
 * The app has two conventions for a heading and they are both in use: the Room
 * Builder's device slider spans -180..180, the Wizard's spans 0..359. A value
 * outside a slider's range leaves its thumb pinned at one end, so a caller
 * rewriting a heading has to fold it the way the control that edits it expects.
 */
export const normalizeUnsignedAngle = (angle: number): number => {
  if (!Number.isFinite(angle)) return 0;
  return roundMm(((angle % 360) + 360) % 360);
};

/** Fold an angle into [0, 360), matching `FurnitureInstance.rotationDeg`'s documented range. */
export const normalizeFurnitureAngle = normalizeUnsignedAngle;

/**
 * cos/sin for a rotation, exact on quarter turns.
 *
 * `Math.cos(Math.PI / 2)` is 6.1e-17, not 0, so four scripted 90 degree turns
 * would drift the outline instead of landing back exactly where it started.
 * Quarter turns are the common case, so give them exact integers.
 */
const rotationMatrix = (angleDeg: number): { cos: number; sin: number } => {
  const normalized = ((angleDeg % 360) + 360) % 360;
  if (normalized === 0) return { cos: 1, sin: 0 };
  if (normalized === 90) return { cos: 0, sin: 1 };
  if (normalized === 180) return { cos: -1, sin: 0 };
  if (normalized === 270) return { cos: 0, sin: -1 };
  const rad = (normalized * Math.PI) / 180;
  return { cos: Math.cos(rad), sin: Math.sin(rad) };
};

/**
 * Rotate `point` about `pivot`, using the same y-down matrix as every other
 * transform in the app (`x * cos - y * sin`, `x * sin + y * cos`), so a positive
 * angle reads as clockwise on screen.
 */
export const rotatePoint = (
  point: RotationPoint,
  angleDeg: number,
  pivot: RotationPoint = { x: 0, y: 0 },
): RotationPoint => {
  const { cos, sin } = rotationMatrix(angleDeg);
  const dx = point.x - pivot.x;
  const dy = point.y - pivot.y;
  return {
    x: roundMm(pivot.x + dx * cos - dy * sin),
    y: roundMm(pivot.y + dx * sin + dy * cos),
  };
};

/**
 * Centre of the outline's bounding box.
 *
 * Bounds rather than centroid, to match `roomShapes.centerByBounds`: it is what
 * the basic shapes are already built around, so a rectangle drawn from the shape
 * picker rotates in place instead of creeping.
 */
export const getPointsBoundsCenter = (
  points: readonly RotationPoint[] | null | undefined,
): RotationPoint | null => {
  if (!points?.length) return null;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) continue;
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { x: roundMm((minX + maxX) / 2), y: roundMm((minY + maxY) / 2) };
};

/**
 * Turn a shape about its own bounding-box centre, keeping that centre put.
 *
 * This exists for the basic room shapes. `BasicRoomShapeSelection` is purely
 * parametric - a kind plus a few lengths - so `resizeBasicRoomShapeWall`
 * regenerates an axis-aligned outline every time a wall length is edited. If the
 * plan has since been rotated, applying those points raw would silently snap the
 * room back to square. Re-applying the accumulated angle here is what lets shape
 * mode (and with it the wall dimension labels) survive a rotation.
 *
 * Point order is preserved, so wall indices still line up with the parametric
 * segment they came from.
 */
export const rotatePointsKeepingBoundsCenter = (
  points: readonly RotationPoint[] | null | undefined,
  angleDeg: number,
): RotationPoint[] => {
  const source = (points ?? []).map((point) => ({ x: point.x, y: point.y }));
  const angle = normalizeSignedAngle(angleDeg);
  const center = getPointsBoundsCenter(source);
  if (!center || angle === 0) return source;

  const rotated = source.map((point) => rotatePoint(point, angle, center));
  // A quarter turn keeps a bounding box centred on the same point, but an
  // arbitrary angle does not, so put the centre back where it was.
  const movedCenter = getPointsBoundsCenter(rotated);
  if (!movedCenter) return rotated;
  const dx = center.x - movedCenter.x;
  const dy = center.y - movedCenter.y;
  if (dx === 0 && dy === 0) return rotated;
  return rotated.map((point) => ({ x: roundMm(point.x + dx), y: roundMm(point.y + dy) }));
};

/**
 * Where the plan turns.
 *
 * `'roomOnly'` pivots on the sensor, which is what keeps a wall-mounted sensor on
 * its own wall as that wall swings round; everything else pivots on the room's
 * bounding-box centre so the plan stays roughly where it was on screen.
 */
export const getRotationPivot = (
  snapshot: Pick<RoomSnapshot, 'roomShell' | 'devicePlacement'> | null | undefined,
  scope: RotationScope,
): RotationPoint | null => {
  const device = snapshot?.devicePlacement;
  if (
    scope === 'roomOnly' &&
    device &&
    Number.isFinite(device.x) &&
    Number.isFinite(device.y)
  ) {
    return { x: device.x, y: device.y };
  }
  return getPointsBoundsCenter(snapshot?.roomShell?.points);
};

/** True when there is geometry worth rotating. */
export const canRotateRoomSnapshot = (
  snapshot: Pick<RoomSnapshot, 'roomShell'> | null | undefined,
): boolean => (snapshot?.roomShell?.points?.length ?? 0) > 0;

export interface RotateRoomSnapshotOptions {
  /** Overrides the scope's default pivot. Used by nothing yet; kept for callers that want a corner. */
  pivot?: RotationPoint | null;
}

/**
 * Turn an editable room snapshot by `angleDeg`.
 *
 * Returns a new snapshot (never mutates), suitable for handing straight to the
 * Room Builder's `commitRoom` so the whole rotation is one undoable step.
 * Locks are deliberately ignored: a plan-level rotation that skipped pinned
 * walls or pinned furniture would produce a geometrically corrupt room, so the
 * UI warns about pinned objects instead and the transform moves everything.
 */
export const rotateRoomSnapshot = (
  snapshot: RoomSnapshot,
  angleDeg: number,
  scope: RotationScope = 'layout',
  options: RotateRoomSnapshotOptions = {},
): RoomSnapshot => {
  const angle = normalizeSignedAngle(angleDeg);
  const pivot = options.pivot ?? getRotationPivot(snapshot, scope);
  if (!pivot || angle === 0 || !canRotateRoomSnapshot(snapshot)) return snapshot;

  const shell = snapshot.roomShell;
  const rotateDevice = scope === 'layout';

  return {
    ...snapshot,
    roomShell: shell
      ? {
        ...shell,
        // Point order (and therefore winding, wall indices and door anchors) is
        // preserved, so `lockedSegments` and `doors` need no remapping.
        points: (shell.points ?? []).map((point) => rotatePoint(point, angle, pivot)),
        ...(shell.lockedSegments ? { lockedSegments: [...shell.lockedSegments] } : {}),
      }
      : shell,
    devicePlacement:
      snapshot.devicePlacement && rotateDevice
        ? {
          ...snapshot.devicePlacement,
          ...rotatePoint(
            { x: snapshot.devicePlacement.x, y: snapshot.devicePlacement.y },
            angle,
            pivot,
          ),
          // Adding the same angle to the mount heading is what keeps zones,
          // targets and the heatmap glued to the walls.
          rotationDeg: normalizeSignedAngle((snapshot.devicePlacement.rotationDeg ?? 0) + angle),
        }
        : snapshot.devicePlacement,
    furniture: snapshot.furniture
      ? snapshot.furniture.map((item) => ({
        ...item,
        ...rotatePoint({ x: item.x, y: item.y }, angle, pivot),
        rotationDeg: normalizeFurnitureAngle((item.rotationDeg ?? 0) + angle),
      }))
      : snapshot.furniture,
    // Doors are stored against the wall they sit on, so they come along for the
    // ride untouched.
    doors: snapshot.doors ? snapshot.doors.map((door) => ({ ...door })) : snapshot.doors,
  };
};

/** Human label for the scope, shared by the toolbar tooltips and the settings panel. */
export const describeRotationScope = (scope: RotationScope): string =>
  scope === 'roomOnly' ? 'Keep sensor aiming' : 'Rotate everything';
