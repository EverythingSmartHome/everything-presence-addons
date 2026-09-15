export interface RoomShapePoint {
  x: number;
  y: number;
}

export interface RectangleDimensions {
  width: number;
  length: number;
}

export interface LShapeDimensions extends RectangleDimensions {
  cutoutWidth: number;
  cutoutLength: number;
}

const assertPositiveFinite = (name: string, value: number) => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
};

const centerByBounds = (points: RoomShapePoint[]): RoomShapePoint[] => {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  return points.map((point) => ({ x: point.x - centerX, y: point.y - centerY }));
};

export const createRectanglePoints = ({ width, length }: RectangleDimensions): RoomShapePoint[] => {
  assertPositiveFinite('Width', width);
  assertPositiveFinite('Length', length);
  return centerByBounds([
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: length },
    { x: 0, y: length },
  ]);
};

export const createLShapePoints = ({
  width,
  length,
  cutoutWidth,
  cutoutLength,
}: LShapeDimensions): RoomShapePoint[] => {
  assertPositiveFinite('Overall width', width);
  assertPositiveFinite('Overall length', length);
  assertPositiveFinite('Cutout width', cutoutWidth);
  assertPositiveFinite('Cutout length', cutoutLength);
  if (cutoutWidth >= width) throw new Error('Cutout width must be smaller than the overall width.');
  if (cutoutLength >= length) throw new Error('Cutout length must be smaller than the overall length.');
  return centerByBounds([
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: length - cutoutLength },
    { x: width - cutoutWidth, y: length - cutoutLength },
    { x: width - cutoutWidth, y: length },
    { x: 0, y: length },
  ]);
};
