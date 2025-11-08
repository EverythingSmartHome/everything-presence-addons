// Rect geometry helpers in millimeters

export function normalizeRect({ x1, y1, x2, y2 }) {
  const nx1 = Math.min(x1, x2);
  const ny1 = Math.min(y1, y2);
  const nx2 = Math.max(x1, x2);
  const ny2 = Math.max(y1, y2);
  return { x1: nx1, y1: ny1, x2: nx2, y2: ny2 };
}

export function rectCorners(r) {
  const { x1, y1, x2, y2 } = normalizeRect(r);
  return {
    topLeft: { x: x1, y: y1 },
    topRight: { x: x2, y: y1 },
    bottomLeft: { x: x1, y: y2 },
    bottomRight: { x: x2, y: y2 },
  };
}

export function containsPoint(r, x, y) {
  const { x1, y1, x2, y2 } = normalizeRect(r);
  return x >= x1 && x <= x2 && y >= y1 && y <= y2;
}

export function snapToGrid(value, gridMm = 10) {
  if (!gridMm) return Math.round(value);
  return Math.round(value / gridMm) * gridMm;
}

// Hit test corner in pixel-space; accepts converter mm->px so this can be reused
export function hitTestCorner(r, corner, px, py, mmToPx, radiusPx = 10) {
  const c = rectCorners(r)[corner];
  if (!c) return false;
  const cx = mmToPx.x(c.x);
  const cy = mmToPx.y(c.y);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= radiusPx * radiusPx;
}

export function hitTestRect(r, px, py, mmToPx, paddingPx = 0) {
  const { x1, y1, x2, y2 } = normalizeRect(r);
  const x1px = mmToPx.x(x1) - paddingPx;
  const y1px = mmToPx.y(y1) - paddingPx;
  const x2px = mmToPx.x(x2) + paddingPx;
  const y2px = mmToPx.y(y2) + paddingPx;
  return px >= x1px && px <= x2px && py >= y1px && py <= y2px;
}

