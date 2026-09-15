import type { RoomSnapshot } from './roomHistory';
// Explicit extension so Node's built-in test runner can resolve it too: this is
// a value import, so unlike the type-only one above it survives type-stripping.
import { getPointsBoundsCenter, type RotationPoint } from './roomRotation.ts';

/**
 * Putting a whole floor plan back on the origin.
 *
 * An outline drawn by hand is anchored wherever the user first clicked, so a
 * to-scale room can end up metres away from (0,0). Everything the app anchors on
 * the origin then reads as noise: the grid's axis lines, the cursor read-out,
 * the `{x: 0, y: 0}` pan resets, the spawn point for new furniture and the
 * device "Center" button. Re-centring the plan is the repair.
 *
 * This is a pure translation, and the argument for why one is safe is the same
 * one `roomRotation` makes for a rotation. Room geometry lives in one mm-based,
 * y-down world space: `roomShell.points`, `FurnitureInstance.x/y` and
 * `devicePlacement.x/y`. Zones, live targets and the heatmap are stored in
 * DEVICE-relative mm and are mapped into room space by every screen as
 * `rotate(devicePlacement.rotationDeg + installationAngle)` then translate by
 * the device position. Adding a constant offset to the device position while
 * leaving `rotationDeg` alone makes that mapping rigid:
 *
 *   deviceToRoom_new(p) = deviceToRoom_old(p) + offset   for every device-frame p
 *
 * so translating the shell, the device and the furniture by the same offset
 * moves zones, targets, heat pixels and the FOV cone with the walls on every
 * screen, with no change to any of those call sites.
 *
 * Deliberately left alone, because each already follows for free:
 *
 * - `doors` are wall-relative (`segmentIndex` + `positionOnSegment`).
 * - `roomShell.lockedSegments` are wall indices, and point order is preserved.
 * - `zones` and the heatmap are device-relative mm (see the rigidity note above).
 * - `metadata.ceilingSliceConfig` is device-relative mm, so translating it would
 *   actively corrupt a ceiling-mount setup.
 *
 * Locks are ignored for the same reason `rotateRoomSnapshot` ignores them: a
 * plan-level transform that skipped pinned walls or pinned furniture would
 * produce a geometrically corrupt room. The whole plan moves, and Undo is one
 * keystroke away.
 *
 * Everything here is pure and dependency-free (like `roomShapes` / `lockState`)
 * so it can be unit-tested under Node's built-in runner.
 */

/**
 * How far off the origin a room may sit and still count as centred.
 *
 * Coordinates are rounded to 0.001 mm, and the bounding-box centre of an
 * odd-numbered span lands on a half-mm, so an exact-zero test would report a
 * freshly centred room as off-centre. Half a millimetre is far below anything
 * visible at any zoom the canvas offers, and keeping the test loose is what
 * makes re-centring idempotent: a second Save must not spend an undo step
 * moving the room by a rounding error.
 */
export const CENTERING_TOLERANCE_MM = 0.5;

/** mm are stored as floats; trim the noise a translation introduces without losing real half-mm values. */
const MM_PRECISION = 1000;

const roundMm = (value: number): number =>
  Number.isFinite(value) ? Math.round(value * MM_PRECISION) / MM_PRECISION : 0;

/** True when there is an outline worth centring. */
export const canCenterRoomSnapshot = (
  snapshot: Pick<RoomSnapshot, 'roomShell'> | null | undefined,
): boolean => (snapshot?.roomShell?.points?.length ?? 0) > 0;

/**
 * The translation that would put the outline's bounding-box centre on (0,0).
 *
 * Bounds rather than centroid, via `roomRotation.getPointsBoundsCenter`, so
 * "the centre of the room" has exactly one definition across the app - the same
 * one the rotation pivot and `roomShapes.centerByBounds` already use.
 *
 * Returns `null` when there is no outline: without walls there is no room to
 * centre, and translating a lone device marker onto the origin would silently
 * move the sensor away from where the user put it.
 */
export const getRoomCenteringOffset = (
  snapshot: Pick<RoomSnapshot, 'roomShell'> | null | undefined,
): RotationPoint | null => {
  const center = getPointsBoundsCenter(snapshot?.roomShell?.points);
  if (!center) return null;
  return { x: roundMm(-center.x), y: roundMm(-center.y) };
};

/**
 * Is the plan already sitting on the origin?
 *
 * Used to disable the manual button and to skip the automatic re-centre, so
 * neither ever burns an undo step on a no-op. A room with no outline reports
 * `true`: there is nothing to move, which is the answer both callers want.
 */
export const isRoomCentered = (
  snapshot: Pick<RoomSnapshot, 'roomShell'> | null | undefined,
  toleranceMm: number = CENTERING_TOLERANCE_MM,
): boolean => {
  const offset = getRoomCenteringOffset(snapshot);
  if (!offset) return true;
  const tolerance = Number.isFinite(toleranceMm) ? Math.abs(toleranceMm) : CENTERING_TOLERANCE_MM;
  return Math.abs(offset.x) <= tolerance && Math.abs(offset.y) <= tolerance;
};

/**
 * Slide an editable room snapshot by `offset`.
 *
 * Returns a new snapshot (never mutates), suitable for handing straight to the
 * Room Builder's `commitRoom` so the whole move is one undoable step. Returns
 * the snapshot unchanged when the offset is zero, so callers can cheaply test
 * `translated === snapshot` for "nothing happened", exactly as they already do
 * with `rotateRoomSnapshot`.
 */
export const translateRoomSnapshot = (
  snapshot: RoomSnapshot,
  offset: RotationPoint | null | undefined,
): RoomSnapshot => {
  // A non-finite component must not poison a coordinate: treat it as no move
  // on that axis rather than writing NaN into the geometry.
  const dx = offset && Number.isFinite(offset.x) ? offset.x : 0;
  const dy = offset && Number.isFinite(offset.y) ? offset.y : 0;
  if (dx === 0 && dy === 0) return snapshot;

  const shell = snapshot.roomShell;

  return {
    ...snapshot,
    roomShell: shell
      ? {
        ...shell,
        // Point order (and therefore winding, wall indices and door anchors) is
        // preserved, so `lockedSegments` and `doors` need no remapping.
        points: (shell.points ?? []).map((point) => ({
          x: roundMm(point.x + dx),
          y: roundMm(point.y + dy),
        })),
        ...(shell.lockedSegments ? { lockedSegments: [...shell.lockedSegments] } : {}),
      }
      : shell,
    devicePlacement: snapshot.devicePlacement
      ? {
        ...snapshot.devicePlacement,
        x: roundMm(snapshot.devicePlacement.x + dx),
        y: roundMm(snapshot.devicePlacement.y + dy),
        // `rotationDeg` is deliberately untouched: it is what keeps zones,
        // targets and the heatmap glued to the walls through the move.
      }
      : snapshot.devicePlacement,
    furniture: snapshot.furniture
      ? snapshot.furniture.map((item) => ({
        ...item,
        x: roundMm(item.x + dx),
        y: roundMm(item.y + dy),
        // A translation changes no headings, so `rotationDeg` stays as it is.
      }))
      : snapshot.furniture,
    // Doors are stored against the wall they sit on, so they come along for the
    // ride untouched.
    doors: snapshot.doors ? snapshot.doors.map((door) => ({ ...door })) : snapshot.doors,
  };
};

/**
 * Put the outline's bounding-box centre on (0,0), moving the sensor and the
 * furniture with it.
 *
 * Returns the snapshot unchanged when there is no outline or when the plan is
 * already centred to within `CENTERING_TOLERANCE_MM`, so it is safe to call on
 * every save.
 */
export const centerRoomSnapshot = (snapshot: RoomSnapshot): RoomSnapshot => {
  if (!canCenterRoomSnapshot(snapshot) || isRoomCentered(snapshot)) return snapshot;
  return translateRoomSnapshot(snapshot, getRoomCenteringOffset(snapshot));
};
