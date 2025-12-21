interface RoomPoint {
  x: number;
  y: number;
}

const normalizeAngle = (angle: number): number => {
  let normalized = ((angle % 360) + 360) % 360;
  if (normalized > 180) normalized -= 360;
  return normalized;
};

const normalizeAxisAngle = (angle: number): number => {
  let normalized = ((angle % 180) + 180) % 180;
  return normalized;
};

const clamp = (value: number, min: number, max: number): number => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const axisAlignmentError = (axis: number, angle: number): number => {
  const axisNorm = normalizeAxisAngle(axis);
  const angleNorm = normalizeAxisAngle(angle);
  let diff = Math.abs(axisNorm - angleNorm);
  if (diff > 90) diff = 180 - diff;
  return diff;
};

const getDominantWallAngle = (points: RoomPoint[] | undefined | null): number | null => {
  if (!points || points.length < 2) return null;

  let bestLength = 0;
  let bestAngle: number | null = null;

  for (let i = 0; i < points.length; i += 1) {
    const start = points[i];
    const end = points[(i + 1) % points.length];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (!Number.isFinite(length) || length <= 0) continue;

    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    const axisAngle = normalizeAxisAngle(angle);
    if (length > bestLength) {
      bestLength = length;
      bestAngle = axisAngle;
    }
  }

  return bestAngle;
};

export const getInstallationAngleSuggestion = (
  rotationDeg: number,
  roomPoints: RoomPoint[] | undefined | null
): { suggestedAngle: number; targetAxis: number; dominantAngle: number } | null => {
  const dominantAngle = getDominantWallAngle(roomPoints);
  if (dominantAngle === null) return null;

  const rotation = normalizeAngle(rotationDeg);
  const candidateAxes = [dominantAngle, dominantAngle + 90];
  let bestDelta: number | null = null;
  let bestAxis: number | null = null;
  let bestError: number | null = null;

  candidateAxes.forEach((axis) => {
    const delta = normalizeAngle(axis - rotation);
    const deltaAlt = normalizeAngle(axis + 180 - rotation);
    const desiredDelta = Math.abs(delta) <= Math.abs(deltaAlt) ? delta : deltaAlt;
    const clampedDelta = clamp(desiredDelta, -45, 45);
    const effectiveRotation = normalizeAngle(rotation + clampedDelta);
    const error = axisAlignmentError(axis, effectiveRotation);
    const isBetter =
      bestError === null ||
      error < bestError ||
      (error === bestError && bestDelta !== null && Math.abs(clampedDelta) < Math.abs(bestDelta)) ||
      (error === bestError &&
        bestDelta !== null &&
        Math.abs(clampedDelta) === Math.abs(bestDelta) &&
        bestAxis !== null &&
        normalizeAxisAngle(axis) < normalizeAxisAngle(bestAxis));

    if (isBetter) {
      bestDelta = clampedDelta;
      bestAxis = axis;
      bestError = error;
    }
  });

  if (bestDelta === null || bestAxis === null) return null;

  const suggestedAngle = Math.round(bestDelta);

  const targetAxis = ((bestAxis % 360) + 360) % 360;
  return { suggestedAngle, targetAxis, dominantAngle };
};
