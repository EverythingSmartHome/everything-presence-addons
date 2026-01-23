import React, { useMemo, useRef, useState } from 'react';
import { FurnitureInstance, Door } from '../api/types';
import { getFurnitureIcon } from '../furniture/icons';
import { getFurnitureColors } from '../furniture/colors';
import { FloorMaterialDefs, getFloorFill } from './FloorMaterials';
import { useThemeContext } from '../contexts/ThemeContext';

export interface Point {
  x: number;
  y: number;
}

export interface DevicePlacement {
  x: number;
  y: number;
  rotationDeg?: number;
}

interface RoomCanvasProps {
  points: Point[];
  onChange: (points: Point[]) => void;
  onAddPoint?: (point: Point) => void;
  onCanvasClick?: (point: Point) => void;
  onCanvasMove?: (point: Point) => void;
  onCanvasRelease?: () => void;
  rangeMm?: number;
  gridSpacingMm?: number;
  height?: number | string;
  snapGridMm?: number;
  displayUnits?: 'metric' | 'imperial';
  zoom?: number;
  devicePlacement?: DevicePlacement;
  onDeviceChange?: (placement: DevicePlacement) => void;
  fieldOfViewDeg?: number;
  maxRangeMeters?: number;
  deviceIconUrl?: string;
  clipRadarToWalls?: boolean;
  showRadar?: boolean;
  panOffsetMm?: { x: number; y: number };
  onPanChange?: (offset: { x: number; y: number }) => void;
  onDragStateChange?: (isDragging: boolean) => void;
  previewFrom?: Point | null;
  previewTo?: Point | null;
  onSegmentHover?: (index: number | null) => void;
  onSegmentSelect?: (index: number | null) => void;
  hoveredSegment?: number | null;
  selectedSegment?: number | null;
  onSegmentDragStart?: (index: number, start: Point) => void;
  onEndpointDragStart?: (segment: number, endpoint: 'start' | 'end', start: Point) => void;
  renderOverlay?: (ctx: {
    toCanvas: (p: Point) => { x: number; y: number };
    fromCanvas: (x: number, y: number) => Point;
    toWorldFromEvent: (e: React.MouseEvent<SVGSVGElement | SVGElement, MouseEvent>) => Point | null;
    svgRef: React.RefObject<SVGSVGElement>;
    rangeMm: number;
    roomShellPoints: Point[];
    devicePlacement: DevicePlacement | undefined;
    fieldOfViewDeg: number;
    /** Device element to render (when deviceInteractive is false) - render at desired z-order */
    deviceElement?: React.ReactNode;
  }) => React.ReactNode;
  lockShell?: boolean;
  furniture?: FurnitureInstance[];
  selectedFurnitureId?: string | null;
  onFurnitureSelect?: (id: string | null) => void;
  onFurnitureChange?: (furniture: FurnitureInstance) => void;
  doors?: Door[];
  selectedDoorId?: string | null;
  onDoorSelect?: (id: string | null) => void;
  onDoorChange?: (door: Door) => void;
  isDoorPlacementMode?: boolean;
  onWallSegmentClick?: (segmentIndex: number, positionOnSegment: number) => void;
  onDoorDragStart?: (doorId: string, x: number, y: number) => void;
  onDoorDragMove?: (x: number, y: number) => void;
  onDoorDragEnd?: () => void;
  roomShellFillMode?: 'overlay' | 'material';
  floorMaterial?: string;
  // Visibility toggles
  showWalls?: boolean;
  showFurniture?: boolean;
  showDoors?: boolean;
  showDevice?: boolean;
  // When false, device icon won't capture mouse events (allows interacting with zones behind it)
  deviceInteractive?: boolean;
}

const CANVAS_SIZE = 700;
const HALF = CANVAS_SIZE / 2;
const toCanvas = (v: number, range: number) => (v / range) * CANVAS_SIZE;
const fromCanvas = (v: number, range: number) => (v / CANVAS_SIZE) * range;

const getSvgPoint = (
  e: React.MouseEvent<SVGSVGElement, MouseEvent>,
  svgEl: SVGSVGElement | null,
): { x: number; y: number } | null => {
  if (!svgEl) return null;
  const pt = svgEl.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const ctm = svgEl.getScreenCTM();
  if (!ctm) return null;
  const transformed = pt.matrixTransform(ctm.inverse());
  return { x: transformed.x, y: transformed.y };
};

// Point-in-polygon test using ray casting algorithm
const isPointInPolygon = (point: Point, polygon: Point[]): boolean => {
  if (polygon.length < 3) return true; // No polygon yet, allow placement anywhere

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersect = ((yi > point.y) !== (yj > point.y)) &&
      (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
};

// Find the closest point on a line segment to a given point
const closestPointOnSegment = (point: Point, segStart: Point, segEnd: Point): Point => {
  const dx = segEnd.x - segStart.x;
  const dy = segEnd.y - segStart.y;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) return segStart; // Segment is a point

  // Project point onto the line, clamping to segment bounds
  const t = Math.max(0, Math.min(1, ((point.x - segStart.x) * dx + (point.y - segStart.y) * dy) / lengthSq));

  return {
    x: segStart.x + t * dx,
    y: segStart.y + t * dy,
  };
};

// Get the four corners of a rotated rectangle (furniture)
const getFurnitureCorners = (
  center: Point,
  width: number,
  depth: number,
  rotationDeg: number
): Point[] => {
  const halfW = width / 2;
  const halfD = depth / 2;
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // Local corner offsets (before rotation)
  const localCorners = [
    { x: -halfW, y: -halfD }, // top-left
    { x: halfW, y: -halfD },  // top-right
    { x: halfW, y: halfD },   // bottom-right
    { x: -halfW, y: halfD },  // bottom-left
  ];

  // Rotate and translate to world coordinates
  return localCorners.map((corner) => ({
    x: center.x + corner.x * cos - corner.y * sin,
    y: center.y + corner.x * sin + corner.y * cos,
  }));
};

// Find the closest point on the polygon boundary
const findClosestPointOnPolygon = (point: Point, polygon: Point[]): Point => {
  let closestPoint = polygon[0];
  let minDistSq = Infinity;

  for (let i = 0; i < polygon.length; i++) {
    const segStart = polygon[i];
    const segEnd = polygon[(i + 1) % polygon.length];
    const closest = closestPointOnSegment(point, segStart, segEnd);

    const distSq = (closest.x - point.x) ** 2 + (closest.y - point.y) ** 2;
    if (distSq < minDistSq) {
      minDistSq = distSq;
      closestPoint = closest;
    }
  }

  return closestPoint;
};

// Constrain furniture to stay entirely inside a polygon
// Accounts for furniture width, depth, and rotation
const constrainFurnitureToPolygon = (
  center: Point,
  width: number,
  depth: number,
  rotationDeg: number,
  polygon: Point[]
): Point => {
  if (polygon.length < 3) return center; // No valid polygon, allow anywhere

  // Iteratively push the furniture inside until all corners are valid
  let constrainedCenter = { ...center };
  const maxIterations = 10;
  const margin = 5; // Small margin to keep furniture slightly inside walls

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const corners = getFurnitureCorners(constrainedCenter, width, depth, rotationDeg);

    // Find the corner that's most outside the polygon
    let maxPushX = 0;
    let maxPushY = 0;
    let anyOutside = false;

    for (const corner of corners) {
      if (!isPointInPolygon(corner, polygon)) {
        anyOutside = true;
        const closestOnBoundary = findClosestPointOnPolygon(corner, polygon);

        // Calculate the push vector (from corner to closest valid point, plus margin toward center)
        const polygonCenterX = polygon.reduce((sum, p) => sum + p.x, 0) / polygon.length;
        const polygonCenterY = polygon.reduce((sum, p) => sum + p.y, 0) / polygon.length;

        // Vector from corner to closest boundary point
        let pushX = closestOnBoundary.x - corner.x;
        let pushY = closestOnBoundary.y - corner.y;

        // Add a small push toward polygon center for margin
        const toCenterX = polygonCenterX - closestOnBoundary.x;
        const toCenterY = polygonCenterY - closestOnBoundary.y;
        const toCenterLen = Math.sqrt(toCenterX ** 2 + toCenterY ** 2);

        if (toCenterLen > 0) {
          pushX += (toCenterX / toCenterLen) * margin;
          pushY += (toCenterY / toCenterLen) * margin;
        }

        // Use the push that moves us the most (to handle multiple corners outside)
        if (Math.abs(pushX) > Math.abs(maxPushX)) maxPushX = pushX;
        if (Math.abs(pushY) > Math.abs(maxPushY)) maxPushY = pushY;
      }
    }

    if (!anyOutside) {
      break; // All corners are inside, we're done
    }

    // Apply the push to the center
    constrainedCenter = {
      x: constrainedCenter.x + maxPushX,
      y: constrainedCenter.y + maxPushY,
    };
  }

  return constrainedCenter;
};

// Simple point constraint (for backwards compatibility and cases without furniture dimensions)
const constrainPointToPolygon = (point: Point, polygon: Point[]): Point => {
  if (polygon.length < 3) return point;

  if (isPointInPolygon(point, polygon)) {
    return point;
  }

  const closest = findClosestPointOnPolygon(point, polygon);

  // Move slightly inside
  const centerX = polygon.reduce((sum, p) => sum + p.x, 0) / polygon.length;
  const centerY = polygon.reduce((sum, p) => sum + p.y, 0) / polygon.length;
  const toCenter = { x: centerX - closest.x, y: centerY - closest.y };
  const len = Math.sqrt(toCenter.x ** 2 + toCenter.y ** 2);

  if (len > 0) {
    return {
      x: closest.x + (toCenter.x / len) * 10,
      y: closest.y + (toCenter.y / len) * 10,
    };
  }

  return closest;
};

// Line segment intersection helper
const lineIntersection = (
  p1: Point, p2: Point, p3: Point, p4: Point
): Point | null => {
  const x1 = p1.x, y1 = p1.y;
  const x2 = p2.x, y2 = p2.y;
  const x3 = p3.x, y3 = p3.y;
  const x4 = p4.x, y4 = p4.y;

  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-10) return null; // Parallel or coincident

  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;

  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return {
      x: x1 + t * (x2 - x1),
      y: y1 + t * (y2 - y1),
    };
  }
  return null;
};

export const RoomCanvas: React.FC<RoomCanvasProps> = ({
  points,
  onChange,
  onAddPoint,
  onCanvasClick,
  onCanvasMove,
  onCanvasRelease,
  rangeMm = 6000,
  gridSpacingMm = 1000,
  height = 520,
  snapGridMm = 0,
  displayUnits = 'metric',
  zoom = 1,
  devicePlacement,
  onDeviceChange,
  fieldOfViewDeg = 120,
  maxRangeMeters = 6,
  deviceIconUrl,
  clipRadarToWalls = false,
  showRadar = true,
  panOffsetMm = { x: 0, y: 0 },
  onPanChange,
  onDragStateChange,
  previewFrom = null,
  previewTo = null,
  onSegmentHover,
  onSegmentSelect,
  hoveredSegment,
  selectedSegment,
  onSegmentDragStart,
  onEndpointDragStart,
  renderOverlay,
  lockShell = false,
  furniture = [],
  selectedFurnitureId,
  onFurnitureSelect,
  onFurnitureChange,
  doors = [],
  selectedDoorId,
  onDoorSelect,
  onDoorChange,
  isDoorPlacementMode,
  onWallSegmentClick,
  onDoorDragStart,
  onDoorDragMove,
  onDoorDragEnd,
  roomShellFillMode = 'overlay',
  floorMaterial = 'none',
  showWalls = true,
  showFurniture = true,
  showDoors = true,
  showDevice = true,
  deviceInteractive = true,
}) => {
  const safePoints = Array.isArray(points) ? points : [];
  const safePlacement: DevicePlacement = {
    x: Number.isFinite(devicePlacement?.x) ? (devicePlacement as DevicePlacement).x : 0,
    y: Number.isFinite(devicePlacement?.y) ? (devicePlacement as DevicePlacement).y : 0,
    rotationDeg: Number.isFinite(devicePlacement?.rotationDeg) ? devicePlacement?.rotationDeg : 0,
  };

  // Theme-aware colors for canvas
  const { isDark } = useThemeContext();
  const canvasColors = useMemo(() => ({
    background: isDark ? '#0f172a' : '#f8fafc',
    gridAxis: isDark ? '#334155' : '#94a3b8',
    gridLine: isDark ? '#1e293b' : '#cbd5e1',
    outsideRoom: isDark ? '#0f172acc' : '#e2e8f0cc',
  }), [isDark]);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragDevice, setDragDevice] = useState<boolean>(false);
  const [panDrag, setPanDrag] = useState<{ start: Point; base: { x: number; y: number } } | null>(null);
  const [furnitureDrag, setFurnitureDrag] = useState<{ id: string; start: Point; basePos: Point; currentPos?: Point } | null>(null);
  const [furnitureResize, setFurnitureResize] = useState<{
    id: string;
    corner: 'nw' | 'ne' | 'sw' | 'se';
    start: Point;
    baseSize: { width: number; depth: number };
    basePos: Point;
    currentSize?: { width: number; depth: number };
    currentPos?: Point;
  } | null>(null);
  const [furnitureRotate, setFurnitureRotate] = useState<{
    id: string;
    start: Point;
    centerPos: Point;
    baseRotation: number;
    currentRotation?: number;
  } | null>(null);
  const suppressClickRef = useRef<boolean>(false);

  const effectiveRangeMm = Number.isFinite(rangeMm) && rangeMm > 0 ? rangeMm : 6000;
  const effectiveGrid = Number.isFinite(gridSpacingMm) && gridSpacingMm > 0 ? gridSpacingMm : 1000;
  const effectiveFov = Number.isFinite(fieldOfViewDeg) ? fieldOfViewDeg : 120;
  const effectiveMaxRange = Number.isFinite(maxRangeMeters) ? maxRangeMeters : 6;
  const effectiveSnap = Number.isFinite(snapGridMm) && snapGridMm > 0 ? snapGridMm : 0;
  const effectiveZoom = Math.min(5, Math.max(0.1, Number.isFinite(zoom) ? zoom : 1));
  const viewSize = CANVAS_SIZE / effectiveZoom;
  const viewMin = (CANVAS_SIZE - viewSize) / 2;

  const toCanvasCoord = (p: Point) => ({
    x: HALF + toCanvas(p.x - panOffsetMm.x, effectiveRangeMm),
    y: HALF + toCanvas(p.y - panOffsetMm.y, effectiveRangeMm),
  });
  const fromCanvasCoord = (cx: number, cy: number) => ({
    x: fromCanvas(cx, effectiveRangeMm) + panOffsetMm.x,
    y: fromCanvas(cy, effectiveRangeMm) + panOffsetMm.y,
  });
  const fromCanvasWithOffset = (cx: number, cy: number, offset: { x: number; y: number }) => ({
    x: fromCanvas(cx, effectiveRangeMm) + offset.x,
    y: fromCanvas(cy, effectiveRangeMm) + offset.y,
  });

  const toWorldFromEvent = (e: React.MouseEvent<SVGSVGElement | SVGElement, MouseEvent>) => {
    const svgPoint = getSvgPoint(e as any, svgRef.current);
    if (!svgPoint) return null;
    const cx = svgPoint.x - HALF;
    const cy = svgPoint.y - HALF;
    return fromCanvasCoord(cx, cy);
  };

  const snapPoint = (pt: Point) => {
    if (!effectiveSnap) return pt;
    const step = effectiveSnap;
    return {
      x: Math.round(pt.x / step) * step,
      y: Math.round(pt.y / step) * step,
    };
  };

  const formatLength = (mm: number) => {
    if (displayUnits === 'imperial') {
      const ft = mm / 304.8;
      return `${ft.toFixed(2)} ft`;
    }
    return `${(mm / 1000).toFixed(2)} m`;
  };

  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement, MouseEvent>) => {
    if (e.button !== 0) return;
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    const svgPoint = getSvgPoint(e, svgRef.current);
    if (!svgPoint) return;
    const cx = svgPoint.x - HALF;
    const cy = svgPoint.y - HALF;
    const point = fromCanvasCoord(cx, cy);
    onAddPoint?.(point);
    onCanvasClick?.(point);
  };

  const handleDragStart = (idx: number) => (e: React.MouseEvent<SVGCircleElement, MouseEvent>) => {
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
    suppressClickRef.current = true;
    setDragIdx(idx);
    onDragStateChange?.(true);
  };
  const handleMouseUp = () => {
    // Finalize furniture drag
    if (furnitureDrag && onFurnitureChange) {
      const furnitureItem = furniture.find((f) => f.id === furnitureDrag.id);
      if (furnitureItem) {
        // Use currentPos if it exists (was dragged), otherwise use basePos (just clicked)
        const finalPos = furnitureDrag.currentPos || furnitureDrag.basePos;
        onFurnitureChange({
          ...furnitureItem,
          x: finalPos.x,
          y: finalPos.y,
        });
      }
      setFurnitureDrag(null);
    }

    // Finalize furniture resize
    if (furnitureResize && onFurnitureChange) {
      const furnitureItem = furniture.find((f) => f.id === furnitureResize.id);
      if (furnitureItem) {
        const finalSize = furnitureResize.currentSize || furnitureResize.baseSize;
        const finalPos = furnitureResize.currentPos || furnitureResize.basePos;
        onFurnitureChange({
          ...furnitureItem,
          width: finalSize.width,
          depth: finalSize.depth,
          x: finalPos.x,
          y: finalPos.y,
        });
      }
      setFurnitureResize(null);
    }

    // Finalize furniture rotation
    if (furnitureRotate && onFurnitureChange) {
      const furnitureItem = furniture.find((f) => f.id === furnitureRotate.id);
      if (furnitureItem) {
        const finalRotation = furnitureRotate.currentRotation !== undefined ? furnitureRotate.currentRotation : furnitureRotate.baseRotation;

        // After rotation, check if furniture corners go outside and adjust position if needed
        const constrainedPos = constrainFurnitureToPolygon(
          { x: furnitureItem.x, y: furnitureItem.y },
          furnitureItem.width,
          furnitureItem.depth,
          finalRotation,
          safePoints
        );

        onFurnitureChange({
          ...furnitureItem,
          rotationDeg: finalRotation,
          x: constrainedPos.x,
          y: constrainedPos.y,
        });
      }
      setFurnitureRotate(null);
    }

    setDragIdx(null);
    setDragDevice(false);
    setPanDrag(null);
    onDragStateChange?.(false);
    onCanvasRelease?.();
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement, MouseEvent>) => {
    const svgPoint = getSvgPoint(e, svgRef.current);
        if (!svgPoint) return;
        const cx = svgPoint.x - HALF;
        const cy = svgPoint.y - HALF;
        const pt = fromCanvasCoord(cx, cy);
        onCanvasMove?.(pt);

    if (panDrag && onPanChange) {
      // use the base offset captured at drag start to avoid feedback/judder
      const world = fromCanvasWithOffset(cx, cy, panDrag.base);
      const dx = world.x - panDrag.start.x;
      const dy = world.y - panDrag.start.y;
      onPanChange({ x: panDrag.base.x - dx, y: panDrag.base.y - dy });
      return;
    }

    // Handle furniture dragging
    if (furnitureDrag && onFurnitureChange) {
      suppressClickRef.current = true;
      const furnitureItem = furniture.find((f) => f.id === furnitureDrag.id);
      if (!furnitureItem) return;

      const dx = pt.x - furnitureDrag.start.x;
      const dy = pt.y - furnitureDrag.start.y;
      const newPos = {
        x: furnitureDrag.basePos.x + dx,
        y: furnitureDrag.basePos.y + dy,
      };
      const snapped = snapPoint(newPos);

      // Constrain furniture to stay entirely within room walls (accounting for size and rotation)
      const constrained = constrainFurnitureToPolygon(
        snapped,
        furnitureItem.width,
        furnitureItem.depth,
        furnitureItem.rotationDeg,
        safePoints
      );

      // Update the drag state with new position (keep basePos constant!)
      setFurnitureDrag({ ...furnitureDrag, currentPos: constrained });
      return;
    }

    // Handle furniture resizing
    if (furnitureResize && onFurnitureChange) {
      suppressClickRef.current = true;
      const furnitureItem = furniture.find((f) => f.id === furnitureResize.id);
      if (!furnitureItem) return;

      const dx = pt.x - furnitureResize.start.x;
      const dy = pt.y - furnitureResize.start.y;

      let newWidth = furnitureResize.baseSize.width;
      let newDepth = furnitureResize.baseSize.depth;
      let newX = furnitureResize.basePos.x;
      let newY = furnitureResize.basePos.y;

      // Calculate new size based on corner being dragged
      switch (furnitureResize.corner) {
        case 'se': // Bottom-right: increase width/depth with positive dx/dy
          newWidth = Math.max(100, furnitureResize.baseSize.width + dx);
          newDepth = Math.max(100, furnitureResize.baseSize.depth + dy);
          break;
        case 'sw': // Bottom-left: decrease width with positive dx, increase depth with positive dy
          newWidth = Math.max(100, furnitureResize.baseSize.width - dx);
          newDepth = Math.max(100, furnitureResize.baseSize.depth + dy);
          newX = furnitureResize.basePos.x + dx / 2;
          break;
        case 'ne': // Top-right: increase width, decrease depth
          newWidth = Math.max(100, furnitureResize.baseSize.width + dx);
          newDepth = Math.max(100, furnitureResize.baseSize.depth - dy);
          newY = furnitureResize.basePos.y + dy / 2;
          break;
        case 'nw': // Top-left: decrease both
          newWidth = Math.max(100, furnitureResize.baseSize.width - dx);
          newDepth = Math.max(100, furnitureResize.baseSize.depth - dy);
          newX = furnitureResize.basePos.x + dx / 2;
          newY = furnitureResize.basePos.y + dy / 2;
          break;
      }

      // Apply aspect ratio lock if enabled
      if (furnitureItem.aspectRatioLocked && furnitureResize.baseSize.depth > 0) {
        const aspectRatio = furnitureResize.baseSize.width / furnitureResize.baseSize.depth;
        newDepth = newWidth / aspectRatio;

        // Adjust position based on corner to keep opposite corner fixed
        if (furnitureResize.corner === 'sw' || furnitureResize.corner === 'nw') {
          const widthChange = newWidth - furnitureResize.baseSize.width;
          newX = furnitureResize.basePos.x - widthChange / 2;
        }
        if (furnitureResize.corner === 'ne' || furnitureResize.corner === 'nw') {
          const depthChange = newDepth - furnitureResize.baseSize.depth;
          newY = furnitureResize.basePos.y - depthChange / 2;
        }
      }

      // Constrain the furniture to stay entirely within room walls (using new dimensions)
      const constrainedPos = constrainFurnitureToPolygon(
        { x: newX, y: newY },
        newWidth,
        newDepth,
        furnitureItem.rotationDeg,
        safePoints
      );

      setFurnitureResize({
        ...furnitureResize,
        currentSize: { width: newWidth, depth: newDepth },
        currentPos: constrainedPos,
      });
      return;
    }

    // Handle furniture rotation
    if (furnitureRotate) {
      suppressClickRef.current = true;
      // Calculate angle from center to current mouse position
      const dx = pt.x - furnitureRotate.centerPos.x;
      const dy = pt.y - furnitureRotate.centerPos.y;
      const angleRad = Math.atan2(dx, -dy); // -dy because canvas Y increases downward
      let angleDeg = (angleRad * 180) / Math.PI;

      // Normalize to 0-360
      if (angleDeg < 0) angleDeg += 360;

      // Snap to 15 degree increments if shift key is held (we don't have access to shift key here, so always snap to 15)
      angleDeg = Math.round(angleDeg / 15) * 15;

      setFurnitureRotate({
        ...furnitureRotate,
        currentRotation: angleDeg,
      });
      return;
    }

    if (dragIdx === null && !dragDevice) return;
    if (dragIdx !== null) {
      const next = [...safePoints];
      next[dragIdx] = snapPoint(pt);
      onChange(next);
    } else if (dragDevice && onDeviceChange) {
      const snapped = snapPoint(pt);
      // Only allow device placement inside the room outline
      if (isPointInPolygon(snapped, safePoints)) {
        onDeviceChange({
          ...safePlacement,
          ...snapped,
        });
      }
    }
  };

  return (
    <div className="w-full h-full">
      <svg
        ref={svgRef}
        width="100%"
        viewBox={`${viewMin} ${viewMin} ${viewSize} ${viewSize}`}
        height={height}
        className="bg-slate-900"
        onClick={handleSvgClick}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onMouseOver={(e) => {
        if (!safePoints.length || lockShell) return;
        const svgPoint = getSvgPoint(e as any, svgRef.current);
        if (!svgPoint) return;
          const cx = svgPoint.x - HALF;
          const cy = svgPoint.y - HALF;
          const world = { x: fromCanvas(cx, effectiveRangeMm), y: fromCanvas(cy, effectiveRangeMm) };
          let best: number | null = null;
          let bestDist = 250; // mm
          safePoints.forEach((p, idx) => {
            const next = safePoints[(idx + 1) % safePoints.length];
            const dx = next.x - p.x;
            const dy = next.y - p.y;
            const len2 = dx * dx + dy * dy || 1;
            const t = Math.max(0, Math.min(1, ((world.x - p.x) * dx + (world.y - p.y) * dy) / len2));
            const projX = p.x + t * dx;
            const projY = p.y + t * dy;
            const dist = Math.hypot(world.x - projX, world.y - projY);
            if (dist < bestDist) {
              bestDist = dist;
              best = idx;
            }
          });
          onSegmentHover?.(best);
        }}
        onMouseOut={() => onSegmentHover?.(null)}
        onMouseDown={(e) => {
          if ((e as any).button === 2) {
            // right-drag to pan
            const svgPoint = getSvgPoint(e as any, svgRef.current);
            if (!svgPoint || !onPanChange) return;
            e.preventDefault();
            const world = fromCanvasWithOffset(svgPoint.x - HALF, svgPoint.y - HALF, panOffsetMm);
            setPanDrag({ start: world, base: panOffsetMm });
            onDragStateChange?.(true);
            suppressClickRef.current = true;
            return;
          }
          if ((e as any).button !== 0 || !safePoints.length) return;
          if (lockShell) return;
          const svgPoint = getSvgPoint(e as any, svgRef.current);
          if (!svgPoint) return;
          const cx = svgPoint.x - HALF;
          const cy = svgPoint.y - HALF;
          const world = fromCanvasCoord(cx, cy);
          let best: number | null = null;
          let bestDist = 250;
          safePoints.forEach((p, idx) => {
            const next = safePoints[(idx + 1) % safePoints.length];
            const dx = next.x - p.x;
            const dy = next.y - p.y;
            const len2 = dx * dx + dy * dy || 1;
            const t = Math.max(0, Math.min(1, ((world.x - p.x) * dx + (world.y - p.y) * dy) / len2));
            const projX = p.x + t * dx;
            const projY = p.y + t * dy;
            const dist = Math.hypot(world.x - projX, world.y - projY);
            if (dist < bestDist) {
              bestDist = dist;
              best = idx;
            }
          });
          onSegmentSelect?.(best);
          if (best !== null && onSegmentDragStart) {
            onSegmentDragStart(best, world);
            suppressClickRef.current = true;
            onDragStateChange?.(true);
          }
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          <FloorMaterialDefs />
        </defs>
        <rect x={0} y={0} width={CANVAS_SIZE} height={CANVAS_SIZE} fill={canvasColors.background} />
        {(() => {
          const lines = [];
          // Adjust grid span based on zoom level to ensure grid lines are visible when zooming out
          // When zooming out (effectiveZoom < 1), we need MORE grid coverage, not less
          // Multiply by 4 to ensure adequate coverage even at very low zoom levels
          const span = (effectiveRangeMm * 4) / Math.min(effectiveZoom, 1);
          for (let mm = -span; mm <= span; mm += effectiveGrid) {
            const posX = HALF + toCanvas(mm - panOffsetMm.x, effectiveRangeMm);
            const posY = HALF + toCanvas(mm - panOffsetMm.y, effectiveRangeMm);
            const isAxis = mm === 0;
            // Extend grid lines beyond canvas to fill viewport when zoomed out
            // Scale extension based on zoom level - more extension when zoomed out
            const lineExtend = CANVAS_SIZE * 10 / Math.min(effectiveZoom, 1);
            lines.push(
              <line
                key={`v-${mm}`}
                x1={posX}
                y1={-lineExtend}
                x2={posX}
                y2={CANVAS_SIZE + lineExtend}
                stroke={isAxis ? canvasColors.gridAxis : canvasColors.gridLine}
                strokeWidth={isAxis ? 2 : 1}
                opacity={isAxis ? 0.8 : 0.4}
                vectorEffect="non-scaling-stroke"
              />,
            );
            lines.push(
              <line
                key={`h-${mm}`}
                x1={-lineExtend}
                y1={posY}
                x2={CANVAS_SIZE + lineExtend}
                y2={posY}
                stroke={isAxis ? canvasColors.gridAxis : canvasColors.gridLine}
                strokeWidth={isAxis ? 2 : 1}
                opacity={isAxis ? 0.8 : 0.4}
                vectorEffect="non-scaling-stroke"
              />,
            );
          }
          return lines;
        })()}
        {safePoints.length > 0 && (
          <>
            {showWalls && (() => {
              const path = safePoints
                .map(
                  (p, idx) =>
                    `${idx === 0 ? 'M' : 'L'} ${toCanvasCoord(p).x} ${toCanvasCoord(p).y}`,
                )
                .join(' ');
              const closedPath = `${path} Z`;
              const { fill, opacity } = getFloorFill(roomShellFillMode, floorMaterial);
              return <path d={closedPath} fill={fill} fillOpacity={opacity} stroke="#22d3ee" strokeWidth={2} vectorEffect="non-scaling-stroke" />;
            })()}
            {!lockShell &&
              safePoints.map((p, idx) => {
                const { x: cx, y: cy } = toCanvasCoord(p);
                return (
                  <g key={`pt-${idx}`}>
                    <circle
                      cx={cx}
                      cy={cy}
                      r={8}
                      fill="#0ea5e9"
                      stroke="#e0f2fe"
                      strokeWidth={2}
                      onMouseDown={handleDragStart(idx)}
                    />
                  </g>
                );
              })}
            {!lockShell &&
              safePoints.map((p, idx) => {
                const next = safePoints[(idx + 1) % safePoints.length];
                const { x: x1, y: y1 } = toCanvasCoord(p);
                const { x: x2, y: y2 } = toCanvasCoord(next);
                const isHovered = hoveredSegment === idx;
                const isSelected = selectedSegment === idx;
                if (!isHovered && !isSelected) return null;
                const midX = (x1 + x2) / 2;
                const midY = (y1 + y2) / 2;
                const lenLabel = formatLength(Math.hypot(next.x - p.x, next.y - p.y));
                return (
                  <g key={`seg-${idx}`}>
                    <line
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke={isSelected ? '#f97316' : '#a855f7'}
                      strokeWidth={isSelected ? 4 : 3}
                      strokeOpacity={0.7}
                      vectorEffect="non-scaling-stroke"
                    />
                    <rect
                      x={midX - 24}
                      y={midY - 16}
                      width={48}
                      height={16}
                      rx={4}
                      fill={canvasColors.outsideRoom}
                      stroke={isDark ? '#94a3b877' : '#64748b77'}
                    />
                    <text x={midX} y={midY - 4} fill={isDark ? '#e2e8f0' : '#1e293b'} fontSize="11" textAnchor="middle">
                      {lenLabel}
                    </text>
                  </g>
                );
              })}
            {/* Clickable wall segments for door placement */}
            {isDoorPlacementMode &&
              safePoints.map((p, idx) => {
                const next = safePoints[(idx + 1) % safePoints.length];
                const { x: x1, y: y1 } = toCanvasCoord(p);
                const { x: x2, y: y2 } = toCanvasCoord(next);
                return (
                  <line
                    key={`door-placement-${idx}`}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke="transparent"
                    strokeWidth={20}
                    style={{ cursor: 'crosshair', pointerEvents: 'stroke' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      const svgPoint = getSvgPoint(e as any, svgRef.current);
                      if (!svgPoint) return;
                      const cx = svgPoint.x - HALF;
                      const cy = svgPoint.y - HALF;
                      const clickWorld = fromCanvasCoord(cx, cy);

                      // Calculate position along segment (0-1)
                      const dx = next.x - p.x;
                      const dy = next.y - p.y;
                      const segmentLength = Math.hypot(dx, dy);
                      if (segmentLength < 1) return;

                      const toClickX = clickWorld.x - p.x;
                      const toClickY = clickWorld.y - p.y;
                      const projection = (toClickX * dx + toClickY * dy) / (segmentLength * segmentLength);
                      const positionOnSegment = Math.max(0, Math.min(1, projection));

                      onWallSegmentClick?.(idx, positionOnSegment);
                    }}
                  />
                );
              })}
            {!lockShell &&
              selectedSegment !== null &&
              (() => {
                const p = safePoints[selectedSegment];
                const next = safePoints[(selectedSegment + 1) % safePoints.length];
                if (!p || !next) return null;
                const { x: x1, y: y1 } = toCanvasCoord(p);
                const { x: x2, y: y2 } = toCanvasCoord(next);
                return (
                  <>
                    <rect
                      x={x1 - 6}
                      y={y1 - 6}
                      width={12}
                      height={12}
                      fill="#0ea5e9"
                      stroke="#e0f2fe"
                      strokeWidth={2}
                      rx={2}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        if (e.cancelable) e.preventDefault();
                        if (onEndpointDragStart) {
                          const world = toWorldFromEvent(e as any) ?? { x: p.x, y: p.y };
                          onEndpointDragStart(selectedSegment, 'start', world);
                          suppressClickRef.current = true;
                          onDragStateChange?.(true);
                        }
                      }}
                    />
                    <rect
                      x={x2 - 6}
                      y={y2 - 6}
                      width={12}
                      height={12}
                      fill="#0ea5e9"
                      stroke="#e0f2fe"
                      strokeWidth={2}
                      rx={2}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        if (e.cancelable) e.preventDefault();
                        if (onEndpointDragStart) {
                          const world = toWorldFromEvent(e as any) ?? { x: next.x, y: next.y };
                          onEndpointDragStart(selectedSegment, 'end', world);
                          suppressClickRef.current = true;
                          onDragStateChange?.(true);
                        }
                      }}
                    />
                  </>
                );
              })()}
          </>
        )}
        {previewFrom && (
          (() => {
            const { x: fx, y: fy } = toCanvasCoord(previewFrom);
            if (!previewTo) {
              return <circle cx={fx} cy={fy} r={5} fill="#a855f7" stroke="#c084fc" strokeWidth={2} />;
            }
            const { x: tx, y: ty } = toCanvasCoord(previewTo);
            const midX = (fx + tx) / 2;
            const midY = (fy + ty) / 2;
            const lenMm = Math.hypot(previewTo.x - previewFrom.x, previewTo.y - previewFrom.y);
            const lenLabel = formatLength(lenMm);
            return (
              <g>
                <line
                  x1={fx}
                  y1={fy}
                  x2={tx}
                  y2={ty}
                  stroke="#a855f7"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  vectorEffect="non-scaling-stroke"
                />
                <circle cx={fx} cy={fy} r={4} fill="#a855f7" />
                <circle cx={tx} cy={ty} r={4} fill="#a855f7" />
                <text x={midX + 6} y={midY - 6} fill="#c084fc" fontSize="11" pointerEvents="none">
                  {lenLabel}
                </text>
              </g>
            );
          })()
        )}

        {/* Render doors */}
        {showDoors && doors.map((door) => {
          // Get the wall segment this door is on
          if (door.segmentIndex < 0 || door.segmentIndex >= safePoints.length) return null;

          const segmentStart = safePoints[door.segmentIndex];
          const segmentEnd = safePoints[(door.segmentIndex + 1) % safePoints.length];
          if (!segmentStart || !segmentEnd) return null;

          // Calculate door position along the segment
          const doorX = segmentStart.x + (segmentEnd.x - segmentStart.x) * door.positionOnSegment;
          const doorY = segmentStart.y + (segmentEnd.y - segmentStart.y) * door.positionOnSegment;

          // Calculate segment angle
          const dx = segmentEnd.x - segmentStart.x;
          const dy = segmentEnd.y - segmentStart.y;
          const segmentAngle = Math.atan2(dy, dx) * (180 / Math.PI);

          // Convert to canvas coordinates
          const canvasDoorPos = toCanvasCoord({ x: doorX, y: doorY });
          const canvasDoorWidth = toCanvas(door.widthMm, effectiveRangeMm);
          // Make swing radius same as door width in world coordinates (so it's proportional)
          const swingRadius = canvasDoorWidth;

          const isSelected = selectedDoorId === door.id;

          // Calculate hinge position and swing direction
          const hingeOffset = door.swingSide === 'right' ? canvasDoorWidth / 2 : -canvasDoorWidth / 2;

          // Calculate arc for a 90-degree door swing
          // The arc traces the path of the door's free end (opposite from hinge)

          // Negative Y is "into the room" (up in SVG coords), positive Y is "out" (down)
          const arcDirection = door.swingDirection === 'in' ? -1 : 1;

          // The arc goes from closed position (along wall) to open position (perpendicular)
          // Start: FREE end of door when closed (opposite from hinge, along x-axis)
          const arcStartX = door.swingSide === 'left' ? canvasDoorWidth / 2 : -canvasDoorWidth / 2;
          const arcStartY = 0;

          // End: FREE end of door when fully open (perpendicular to wall)
          // The free end moves in the arc direction by the door width distance
          const arcEndX = hingeOffset;
          const arcEndY = arcDirection * canvasDoorWidth;

          // Determine which arc to draw (0 = short 90° arc, 1 = long arc)
          const largeArcFlag = 0;

          // Sweep flag: 1 = clockwise, 0 = counterclockwise (in SVG coords where Y increases downward)
          // For a concave arc (curving toward the hinge/center):
          // - Left hinge, swinging in (negative Y): sweep counterclockwise (0)
          // - Left hinge, swinging out (positive Y): sweep clockwise (1)
          // - Right hinge, swinging in (negative Y): sweep clockwise (1)
          // - Right hinge, swinging out (positive Y): sweep counterclockwise (0)
          const sweepFlag = (door.swingSide === 'left' && door.swingDirection === 'in') ||
                            (door.swingSide === 'right' && door.swingDirection === 'out') ? 0 : 1;

          return (
            <g key={door.id}>
              {/* Door group with transform */}
              <g transform={`translate(${canvasDoorPos.x}, ${canvasDoorPos.y}) rotate(${segmentAngle})`}>
                {/* Selection highlight (when selected) */}
                {isSelected && (
                  <rect
                    x={-canvasDoorWidth / 2 - 10}
                    y={Math.min(-15, arcEndY - 15)}
                    width={canvasDoorWidth + 20}
                    height={Math.abs(arcEndY) + 30}
                    fill="rgba(6, 182, 212, 0.1)"
                    stroke="#06b6d4"
                    strokeWidth={2}
                    strokeDasharray="4 4"
                    rx={4}
                    style={{ pointerEvents: 'none' }}
                  />
                )}

                {/* Invisible clickable area for easier selection */}
                <rect
                  x={-canvasDoorWidth / 2 - 10}
                  y={Math.min(-15, arcEndY - 15)}
                  width={canvasDoorWidth + 20}
                  height={Math.abs(arcEndY) + 30}
                  fill="transparent"
                  style={{ cursor: isSelected ? 'grab' : 'pointer' }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    suppressClickRef.current = false;

                    // Select the door
                    onDoorSelect?.(door.id);

                    // Start dragging if selected
                    if (isSelected) {
                      onDoorDragStart?.(door.id, doorX, doorY);
                      onDragStateChange?.(true);
                    }
                  }}
                />

                {/* Door frame/opening (perpendicular to wall) - white/light color to stand out */}
                <line
                  x1={-canvasDoorWidth / 2}
                  y1={0}
                  x2={canvasDoorWidth / 2}
                  y2={0}
                  stroke={isSelected ? '#06b6d4' : '#ffffff'}
                  strokeWidth={isSelected ? 4 : 3}
                  vectorEffect="non-scaling-stroke"
                  style={{ cursor: 'pointer', pointerEvents: 'none' }}
                />

                {/* Door swing arc - 90 degree arc showing door swing path */}
                {door.swingDirection && (
                  <path
                    d={`M ${arcStartX} ${arcStartY} A ${swingRadius} ${swingRadius} 0 ${largeArcFlag} ${sweepFlag} ${arcEndX} ${arcEndY}`}
                    stroke={isSelected ? '#06b6d4' : '#000000'}
                    strokeWidth={2}
                    fill="none"
                    strokeDasharray="6 4"
                    vectorEffect="non-scaling-stroke"
                    style={{ pointerEvents: 'none' }}
                  />
                )}

                {/* Door panel - wooden brown color, showing closed position */}
                <line
                  x1={hingeOffset}
                  y1={0}
                  x2={hingeOffset}
                  y2={arcEndY}
                  stroke={isSelected ? '#06b6d4' : '#8b5a3c'}
                  strokeWidth={4}
                  vectorEffect="non-scaling-stroke"
                  style={{ pointerEvents: 'none' }}
                />

                {/* Hinge indicator - metallic look */}
                <circle
                  cx={hingeOffset}
                  cy={0}
                  r={4}
                  fill={isSelected ? '#06b6d4' : '#71717a'}
                  stroke={isSelected ? '#0891b2' : '#52525b'}
                  strokeWidth={1}
                  style={{ pointerEvents: 'none' }}
                />
              </g>
            </g>
          );
        })}

        {/* Render furniture */}
        {showFurniture && furniture.map((item) => {
          // Use dragging position if this furniture is being dragged
          const isDragging = furnitureDrag?.id === item.id;
          const isResizing = furnitureResize?.id === item.id;
          const isRotating = furnitureRotate?.id === item.id;

          // Determine display position, size, and rotation
          let displayPos = { x: item.x, y: item.y };
          let displayWidth = item.width;
          let displayDepth = item.depth;
          let displayRotation = item.rotationDeg;

          if (isDragging && furnitureDrag) {
            displayPos = furnitureDrag.currentPos || furnitureDrag.basePos;
          } else if (isResizing && furnitureResize) {
            displayPos = furnitureResize.currentPos || furnitureResize.basePos;
            const size = furnitureResize.currentSize || furnitureResize.baseSize;
            displayWidth = size.width;
            displayDepth = size.depth;
          } else if (isRotating && furnitureRotate) {
            displayRotation = furnitureRotate.currentRotation !== undefined ? furnitureRotate.currentRotation : furnitureRotate.baseRotation;
          }

          const displayX = displayPos.x;
          const displayY = displayPos.y;

          const canvasPos = toCanvasCoord({ x: displayX, y: displayY });
          const canvasWidth = toCanvas(displayWidth, effectiveRangeMm);
          const canvasHeight = toCanvas(displayDepth, effectiveRangeMm);
          const isSelected = selectedFurnitureId === item.id;
          const Icon = getFurnitureIcon(item.typeId);
          const colors = getFurnitureColors(item.typeId, isSelected);

          return (
            <g key={item.id}>
              {/* Main furniture group with transform */}
              <g transform={`translate(${canvasPos.x}, ${canvasPos.y}) rotate(${displayRotation})`}>
                {/* Furniture icon - render directly as SVG to fill bounds */}
                {Icon && (
                  <svg
                    x={-canvasWidth / 2}
                    y={-canvasHeight / 2}
                    width={canvasWidth}
                    height={canvasHeight}
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    style={{ overflow: 'visible', pointerEvents: 'none' }}
                  >
                    <Icon />
                  </svg>
                )}
                {/* Clickable interaction rectangle - positioned over furniture */}
                <rect
                  x={-canvasWidth / 2}
                  y={-canvasHeight / 2}
                  width={canvasWidth}
                  height={canvasHeight}
                  fill="transparent"
                  stroke={isSelected ? '#0ea5e9' : 'transparent'}
                  strokeWidth={isSelected ? 2 : 0}
                  strokeDasharray={isSelected ? '4 2' : undefined}
                  rx={3}
                  style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    const worldPos = toWorldFromEvent(e as any);
                    if (!worldPos) return;
                    suppressClickRef.current = false;
                    setFurnitureDrag({ id: item.id, start: worldPos, basePos: { x: item.x, y: item.y } });
                    onDragStateChange?.(true);
                    onFurnitureSelect?.(item.id);
                  }}
                />
              </g>

              {/* Resize handles (only when selected and not dragging/rotating) */}
              {isSelected && !isDragging && !isResizing && !isRotating && (() => {
                const handleSize = 8;
                const handles: Array<{ corner: 'nw' | 'ne' | 'sw' | 'se'; x: number; y: number; cursor: string }> = [
                  { corner: 'nw', x: -canvasWidth / 2, y: -canvasHeight / 2, cursor: 'nwse-resize' },
                  { corner: 'ne', x: canvasWidth / 2, y: -canvasHeight / 2, cursor: 'nesw-resize' },
                  { corner: 'sw', x: -canvasWidth / 2, y: canvasHeight / 2, cursor: 'nesw-resize' },
                  { corner: 'se', x: canvasWidth / 2, y: canvasHeight / 2, cursor: 'nwse-resize' },
                ];

                return (
                  <>
                    {handles.map((handle) => (
                      <rect
                        key={handle.corner}
                        x={handle.x - handleSize / 2}
                        y={handle.y - handleSize / 2}
                        width={handleSize}
                        height={handleSize}
                        fill="#0ea5e9"
                        stroke="#ffffff"
                        strokeWidth={1.5}
                        rx={1}
                        transform={`translate(${canvasPos.x}, ${canvasPos.y}) rotate(${displayRotation})`}
                        style={{ transformOrigin: '0 0', cursor: handle.cursor }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          const worldPos = toWorldFromEvent(e as any);
                          if (!worldPos) return;
                          suppressClickRef.current = false;
                          setFurnitureResize({
                            id: item.id,
                            corner: handle.corner,
                            start: worldPos,
                            baseSize: { width: item.width, depth: item.depth },
                            basePos: { x: item.x, y: item.y },
                          });
                          onDragStateChange?.(true);
                        }}
                      />
                    ))}
                    {/* Rotation handle (at top center) */}
                    <g transform={`translate(${canvasPos.x}, ${canvasPos.y}) rotate(${displayRotation})`}>
                      {/* Line connecting to rotation handle */}
                      <line
                        x1={0}
                        y1={-canvasHeight / 2}
                        x2={0}
                        y2={-canvasHeight / 2 - 20}
                        stroke="#a855f7"
                        strokeWidth={2}
                        strokeDasharray="3 3"
                      />
                      {/* Rotation handle circle */}
                      <circle
                        cx={0}
                        cy={-canvasHeight / 2 - 20}
                        r={6}
                        fill="#a855f7"
                        stroke="#ffffff"
                        strokeWidth={1.5}
                        style={{ cursor: 'grab' }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          const worldPos = toWorldFromEvent(e as any);
                          if (!worldPos) return;
                          suppressClickRef.current = false;
                          setFurnitureRotate({
                            id: item.id,
                            start: worldPos,
                            centerPos: { x: item.x, y: item.y },
                            baseRotation: item.rotationDeg,
                          });
                          onDragStateChange?.(true);
                        }}
                      />
                    </g>
                  </>
                );
              })()}
            </g>
          );
        })}

        {/* Build device element for non-interactive mode (Zone Editor) - passed to renderOverlay for z-order control */}
        {renderOverlay?.({
          toCanvas: toCanvasCoord,
          fromCanvas: fromCanvasCoord,
          toWorldFromEvent,
          svgRef,
          rangeMm: effectiveRangeMm,
          roomShellPoints: safePoints,
          devicePlacement: safePlacement,
          fieldOfViewDeg: effectiveFov,
          deviceElement: (!deviceInteractive && showDevice && devicePlacement && safePlacement) ? (() => {
            const { x: px, y: py } = toCanvasCoord(safePlacement);
            // Add 90 degrees so that 0 degrees points down (Y+) instead of right (X+)
            const rotationRad = (((safePlacement.rotationDeg ?? 0) + 90) * Math.PI) / 180;
            const halfFov = (effectiveFov * Math.PI) / 360;
            const range = effectiveMaxRange * 1000;

            // Calculate radar coverage points
            const deviceWorld = { x: safePlacement.x, y: safePlacement.y };
            const a1 = rotationRad - halfFov;
            const a2 = rotationRad + halfFov;

            // World coordinates for radar edges
            const edge1World = {
              x: deviceWorld.x + Math.cos(a1) * range,
              y: deviceWorld.y + Math.sin(a1) * range,
            };
            const edge2World = {
              x: deviceWorld.x + Math.cos(a2) * range,
              y: deviceWorld.y + Math.sin(a2) * range,
            };

            // Build radar polygon with wall clipping
            let radarPoints: Point[] = [deviceWorld];

            if (clipRadarToWalls && safePoints.length >= 3) {
              const minClipDistance = 10; // Minimum 10mm to avoid clipping at device position

              // Clip radar edge 1 against walls
              let clippedEdge1 = edge1World;
              let minDist1 = Infinity;

              for (let i = 0; i < safePoints.length; i++) {
                const wallStart = safePoints[i];
                const wallEnd = safePoints[(i + 1) % safePoints.length];
                const intersection = lineIntersection(deviceWorld, edge1World, wallStart, wallEnd);

                if (intersection) {
                  const dist = Math.hypot(intersection.x - deviceWorld.x, intersection.y - deviceWorld.y);
                  // Only clip if the intersection is beyond minimum distance from device
                  if (dist > minClipDistance && dist < minDist1) {
                    minDist1 = dist;
                    clippedEdge1 = intersection;
                  }
                }
              }

              // Clip radar edge 2 against walls
              let clippedEdge2 = edge2World;
              let minDist2 = Infinity;

              for (let i = 0; i < safePoints.length; i++) {
                const wallStart = safePoints[i];
                const wallEnd = safePoints[(i + 1) % safePoints.length];
                const intersection = lineIntersection(deviceWorld, edge2World, wallStart, wallEnd);

                if (intersection) {
                  const dist = Math.hypot(intersection.x - deviceWorld.x, intersection.y - deviceWorld.y);
                  // Only clip if the intersection is beyond minimum distance from device
                  if (dist > minClipDistance && dist < minDist2) {
                    minDist2 = dist;
                    clippedEdge2 = intersection;
                  }
                }
              }

              // Sample points along the arc to check for wall intersections
              const arcSteps = 32;
              const angleStep = (effectiveFov * Math.PI / 180) / arcSteps;

              for (let i = 0; i <= arcSteps; i++) {
                const angle = a1 + i * angleStep;
                const rayEnd = {
                  x: deviceWorld.x + Math.cos(angle) * range,
                  y: deviceWorld.y + Math.sin(angle) * range,
                };

                let clippedPoint = rayEnd;
                let minDist = Infinity;

                for (let j = 0; j < safePoints.length; j++) {
                  const wallStart = safePoints[j];
                  const wallEnd = safePoints[(j + 1) % safePoints.length];
                  const intersection = lineIntersection(deviceWorld, rayEnd, wallStart, wallEnd);

                  if (intersection) {
                    const dist = Math.hypot(intersection.x - deviceWorld.x, intersection.y - deviceWorld.y);
                    // Only clip if the intersection is beyond minimum distance from device
                    if (dist > minClipDistance && dist < minDist) {
                      minDist = dist;
                      clippedPoint = intersection;
                    }
                  }
                }

                radarPoints.push(clippedPoint);
              }
            } else {
              // No wall clipping - draw proper arc
              const arcSteps = 32;
              const angleStep = (effectiveFov * Math.PI / 180) / arcSteps;

              for (let i = 0; i <= arcSteps; i++) {
                const angle = a1 + i * angleStep;
                const arcPoint = {
                  x: deviceWorld.x + Math.cos(angle) * range,
                  y: deviceWorld.y + Math.sin(angle) * range,
                };
                radarPoints.push(arcPoint);
              }
            }

            // Convert to canvas coordinates
            const radarPath = radarPoints.map(toCanvasCoord);
            const pathData = radarPath.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z';

            const iconSize = 36;

            return (
              <g style={{ pointerEvents: 'none' }}>
                {/* Radar coverage overlay - visible but non-blocking with pointerEvents: 'none' */}
                {showRadar && (
                  <path
                    d={pathData}
                    fill="#22c55e22"
                    stroke="#22c55e"
                    strokeWidth={1.5}
                    vectorEffect="non-scaling-stroke"
                    style={{ pointerEvents: 'none' }}
                  />
                )}

                {/* Device icon or fallback */}
                {deviceIconUrl ? (
                  <image
                    href={deviceIconUrl}
                    x={px - iconSize / 2}
                    y={py - iconSize / 2}
                    width={iconSize}
                    height={iconSize}
                    style={{ cursor: 'default', pointerEvents: 'none' }}
                  />
                ) : (
                  <>
                    {/* Fallback: circle with direction indicator */}
                    <circle
                      cx={px}
                      cy={py}
                      r={12}
                      fill="#3b82f6"
                      stroke="#1d4ed8"
                      strokeWidth={2}
                      style={{ cursor: 'default', pointerEvents: 'none' }}
                    />
                    <line
                      x1={px}
                      y1={py}
                      x2={px + Math.cos(rotationRad) * 18}
                      y2={py + Math.sin(rotationRad) * 18}
                      stroke="#ffffff"
                      strokeWidth={3}
                      strokeLinecap="round"
                      style={{ pointerEvents: 'none' }}
                    />
                  </>
                )}
              </g>
            );
          })() : undefined,
        })}

        {/* Device rendering - when interactive (Room Builder), render AFTER overlay so device can be dragged */}
        {deviceInteractive && showDevice && devicePlacement && safePlacement && (
          (() => {
            const { x: px, y: py } = toCanvasCoord(safePlacement);
            // Add 90 degrees so that 0 degrees points down (Y+) instead of right (X+)
            const rotationRad = (((safePlacement.rotationDeg ?? 0) + 90) * Math.PI) / 180;
            const halfFov = (effectiveFov * Math.PI) / 360;
            const range = effectiveMaxRange * 1000;

            // Calculate radar coverage points
            const deviceWorld = { x: safePlacement.x, y: safePlacement.y };
            const a1 = rotationRad - halfFov;
            const a2 = rotationRad + halfFov;

            // World coordinates for radar edges
            const edge1World = {
              x: deviceWorld.x + Math.cos(a1) * range,
              y: deviceWorld.y + Math.sin(a1) * range,
            };
            const edge2World = {
              x: deviceWorld.x + Math.cos(a2) * range,
              y: deviceWorld.y + Math.sin(a2) * range,
            };

            // Build radar polygon with wall clipping
            let radarPoints: Point[] = [deviceWorld];

            if (clipRadarToWalls && safePoints.length >= 3) {
              const minClipDistance = 10;

              let clippedEdge1 = edge1World;
              let minDist1 = Infinity;

              for (let i = 0; i < safePoints.length; i++) {
                const wallStart = safePoints[i];
                const wallEnd = safePoints[(i + 1) % safePoints.length];
                const intersection = lineIntersection(deviceWorld, edge1World, wallStart, wallEnd);

                if (intersection) {
                  const dist = Math.hypot(intersection.x - deviceWorld.x, intersection.y - deviceWorld.y);
                  if (dist > minClipDistance && dist < minDist1) {
                    minDist1 = dist;
                    clippedEdge1 = intersection;
                  }
                }
              }

              let clippedEdge2 = edge2World;
              let minDist2 = Infinity;

              for (let i = 0; i < safePoints.length; i++) {
                const wallStart = safePoints[i];
                const wallEnd = safePoints[(i + 1) % safePoints.length];
                const intersection = lineIntersection(deviceWorld, edge2World, wallStart, wallEnd);

                if (intersection) {
                  const dist = Math.hypot(intersection.x - deviceWorld.x, intersection.y - deviceWorld.y);
                  if (dist > minClipDistance && dist < minDist2) {
                    minDist2 = dist;
                    clippedEdge2 = intersection;
                  }
                }
              }

              const arcSteps = 32;
              const angleStep = (effectiveFov * Math.PI / 180) / arcSteps;

              for (let i = 0; i <= arcSteps; i++) {
                const angle = a1 + i * angleStep;
                const rayEnd = {
                  x: deviceWorld.x + Math.cos(angle) * range,
                  y: deviceWorld.y + Math.sin(angle) * range,
                };

                let clippedPoint = rayEnd;
                let minDist = Infinity;

                for (let j = 0; j < safePoints.length; j++) {
                  const wallStart = safePoints[j];
                  const wallEnd = safePoints[(j + 1) % safePoints.length];
                  const intersection = lineIntersection(deviceWorld, rayEnd, wallStart, wallEnd);

                  if (intersection) {
                    const dist = Math.hypot(intersection.x - deviceWorld.x, intersection.y - deviceWorld.y);
                    if (dist > minClipDistance && dist < minDist) {
                      minDist = dist;
                      clippedPoint = intersection;
                    }
                  }
                }

                radarPoints.push(clippedPoint);
              }
            } else {
              const arcSteps = 32;
              for (let i = 0; i <= arcSteps; i++) {
                const angle = a1 + (i / arcSteps) * (a2 - a1);
                const arcPoint = {
                  x: deviceWorld.x + Math.cos(angle) * range,
                  y: deviceWorld.y + Math.sin(angle) * range,
                };
                radarPoints.push(arcPoint);
              }
            }

            const radarPath = radarPoints.map(toCanvasCoord);
            const pathData = radarPath.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z';

            const iconSize = 36;

            return (
              <g>
                {showRadar && (
                  <path
                    d={pathData}
                    fill="#22c55e22"
                    stroke="#22c55e"
                    strokeWidth={1.5}
                    vectorEffect="non-scaling-stroke"
                    style={{ pointerEvents: 'none' }}
                  />
                )}

                {deviceIconUrl ? (
                  <image
                    href={deviceIconUrl}
                    x={px - iconSize / 2}
                    y={py - iconSize / 2}
                    width={iconSize}
                    height={iconSize}
                    style={{ cursor: 'grab', pointerEvents: 'all' }}
                    onMouseDown={() => {
                      setDragDevice(true);
                      onDragStateChange?.(true);
                    }}
                  />
                ) : (
                  <>
                    <circle
                      cx={px}
                      cy={py}
                      r={12}
                      fill="#3b82f6"
                      stroke="#1d4ed8"
                      strokeWidth={2}
                      onMouseDown={() => {
                        setDragDevice(true);
                        onDragStateChange?.(true);
                      }}
                      style={{ cursor: 'grab' }}
                    />
                    <line
                      x1={px}
                      y1={py}
                      x2={px + Math.cos(rotationRad) * 18}
                      y2={py + Math.sin(rotationRad) * 18}
                      stroke="#ffffff"
                      strokeWidth={3}
                      strokeLinecap="round"
                    />
                  </>
                )}
              </g>
            );
          })()
        )}
      </svg>
    </div>
  );
};
