import { useState, useCallback } from 'react';
import { Point } from '../components/RoomCanvas';

interface UseWallDrawingOptions {
  snapGridMm: number;
  onPointsChange: (points: Point[]) => void;
  currentPoints: Point[];
}

export function useWallDrawing({ snapGridMm, onPointsChange, currentPoints }: UseWallDrawingOptions) {
  const [isDrawingWall, setIsDrawingWall] = useState(false);
  const [pendingStart, setPendingStart] = useState<Point | null>(null);
  const [previewPoint, setPreviewPoint] = useState<Point | null>(null);

  // Snap helpers
  const snapPointToGrid = useCallback(
    (pt: Point) => {
      if (!snapGridMm || snapGridMm <= 0) return pt;
      const step = snapGridMm;
      return {
        x: Math.round(pt.x / step) * step,
        y: Math.round(pt.y / step) * step,
      };
    },
    [snapGridMm]
  );

  const snapToExisting = useCallback(
    (pt: Point, threshold = 300) => {
      const candidates = currentPoints;
      let best = pt;
      let bestDist = threshold;
      candidates.forEach((p) => {
        const d = Math.hypot(p.x - pt.x, p.y - pt.y);
        if (d < bestDist) {
          best = p;
          bestDist = d;
        }
      });
      return best;
    },
    [currentPoints]
  );

  const snapDirection = useCallback((start: Point, end: Point) => {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (dx === 0 && dy === 0) return end;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    // horizontal vs vertical vs 45
    if (absDx * 2 < absDy) {
      return { x: start.x, y: end.y };
    }
    if (absDy * 2 < absDx) {
      return { x: end.x, y: start.y };
    }
    const signX = dx >= 0 ? 1 : -1;
    const signY = dy >= 0 ? 1 : -1;
    const mag = Math.max(absDx, absDy);
    return { x: start.x + signX * mag, y: start.y + signY * mag };
  }, []);

  const handleCanvasClick = useCallback(
    (pt: Point) => {
      if (!isDrawingWall) return;

      const gridAligned = snapPointToGrid(pt);
      const snapped = snapToExisting(gridAligned);

      // First click: set pending start
      if (!pendingStart) {
        setPendingStart(snapped);
        return;
      }

      // Second click: apply direction constraint and add segment
      const constrained = snapDirection(pendingStart, snapped);
      const endPoint = snapToExisting(constrained);

      const current = currentPoints;
      const first = current[0];
      const closeThreshold = 250; // mm
      const isClosing = !!first && Math.hypot(endPoint.x - first.x, endPoint.y - first.y) < closeThreshold;

      if (isClosing && current.length >= 2) {
        // Close the loop without adding a duplicate point
        setIsDrawingWall(false);
        setPendingStart(null);
        setPreviewPoint(null);
        return;
      }

      let newPoints = [...current];

      // Add the first point if this is the very first segment
      if (newPoints.length === 0) {
        newPoints.push(pendingStart);
      }

      // Add the endpoint
      newPoints = [...newPoints, endPoint];
      onPointsChange(newPoints);

      // Set the endpoint as the new start for the next segment
      setPendingStart(endPoint);
    },
    [isDrawingWall, pendingStart, currentPoints, snapPointToGrid, snapToExisting, snapDirection, onPointsChange]
  );

  const handleCanvasMove = useCallback(
    (pt: Point) => {
      if (!isDrawingWall || !pendingStart) {
        setPreviewPoint(null);
        return;
      }
      // Apply same snapping to preview
      const gridAligned = snapPointToGrid(pt);
      const constrained = snapDirection(pendingStart, gridAligned);
      const snapped = snapToExisting(constrained);
      setPreviewPoint(snapped);
    },
    [isDrawingWall, pendingStart, snapPointToGrid, snapDirection, snapToExisting]
  );

  const startDrawing = useCallback(() => {
    setIsDrawingWall(true);
    setPendingStart(null);
    setPreviewPoint(null);
  }, []);

  const stopDrawing = useCallback(() => {
    setIsDrawingWall(false);
    setPendingStart(null);
    setPreviewPoint(null);
  }, []);

  const removeLastPoint = useCallback(() => {
    if (currentPoints.length > 0) {
      const newPoints = currentPoints.slice(0, -1);
      onPointsChange(newPoints);
    }
  }, [currentPoints, onPointsChange]);

  return {
    isDrawingWall,
    pendingStart,
    previewPoint,
    handleCanvasClick,
    handleCanvasMove,
    startDrawing,
    stopDrawing,
    removeLastPoint,
    setIsDrawingWall,
  };
}
