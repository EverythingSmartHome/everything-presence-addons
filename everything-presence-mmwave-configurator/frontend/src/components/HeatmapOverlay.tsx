import React, { useMemo } from 'react';
import { HeatmapResponse, DevicePlacement } from '../api/types';

interface HeatmapOverlayProps {
  data: HeatmapResponse | null;
  visible: boolean;
  toCanvas: (point: { x: number; y: number }) => { x: number; y: number };
  devicePlacement?: DevicePlacement | null;
  intensityThreshold?: number; // 0-1, cells below this won't be shown
  roomShellPoints?: Array<{ x: number; y: number }> | null; // Canvas coordinates for room boundary
  clipToRoom?: boolean;
  showAveragePosition?: boolean;
}

// Color gradient from cool to hot (skipping low intensities for cleaner look)
const getHeatColor = (intensity: number, threshold: number): { fill: string; opacity: number } | null => {
  // Don't show cells below threshold
  if (intensity < threshold) {
    return null;
  }

  // Remap intensity from threshold-1 to 0-1 for color calculation
  const t = threshold < 1 ? (intensity - threshold) / (1 - threshold) : 1;

  // Color stops: green -> yellow -> orange -> red (skip blue for cleaner look)
  let r: number, g: number, b: number;

  if (t < 0.33) {
    // Green to yellow
    const local = t / 0.33;
    r = Math.round(34 + (250 - 34) * local);
    g = Math.round(197 + (204 - 197) * local);
    b = Math.round(94 - (94 - 21) * local);
  } else if (t < 0.66) {
    // Yellow to orange
    const local = (t - 0.33) / 0.33;
    r = Math.round(250 - (250 - 249) * local);
    g = Math.round(204 - (204 - 115) * local);
    b = Math.round(21 - (21 - 22) * local);
  } else {
    // Orange to red
    const local = (t - 0.66) / 0.34;
    r = Math.round(249 - (249 - 239) * local);
    g = Math.round(115 - (115 - 68) * local);
    b = Math.round(22 + (68 - 22) * local);
  }

  // Opacity scales with intensity (more visible for hotter spots)
  // Lower base opacity for cleaner look
  const opacity = 0.25 + t * 0.55;

  return {
    fill: `rgb(${r}, ${g}, ${b})`,
    opacity,
  };
};

export const HeatmapOverlay: React.FC<HeatmapOverlayProps> = ({ data, visible, toCanvas, devicePlacement, intensityThreshold = 0.15, roomShellPoints, clipToRoom = true, showAveragePosition = true }) => {
  // Transform device-relative coordinates to room coordinates
  const deviceToRoom = useMemo(() => {
    if (!devicePlacement) {
      return (deviceX: number, deviceY: number) => ({ x: deviceX, y: deviceY });
    }

    const { x, y, rotationDeg } = devicePlacement;
    const angleRad = ((rotationDeg ?? 0) * Math.PI) / 180;
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);

    return (deviceX: number, deviceY: number) => {
      const rotatedX = deviceX * cos - deviceY * sin;
      const rotatedY = deviceX * sin + deviceY * cos;
      return {
        x: rotatedX + x,
        y: rotatedY + y,
      };
    };
  }, [devicePlacement]);

  // Calculate average position in canvas coordinates
  const avgPositionCanvas = useMemo(() => {
    if (!showAveragePosition || !data?.averagePosition) {
      return null;
    }
    // Transform from device coordinates to room coordinates, then to canvas
    const roomPos = deviceToRoom(data.averagePosition.x, data.averagePosition.y);
    return toCanvas(roomPos);
  }, [showAveragePosition, data?.averagePosition, deviceToRoom, toCanvas]);

  if (!visible || !data || data.cells.length === 0) {
    return null;
  }

  // Calculate base radius from resolution (half the cell size, converted to canvas)
  // We use 1.5x multiplier to make circles overlap nicely for a smoother heatmap look
  const sampleCell = toCanvas({ x: 0, y: 0 });
  const sampleCellOffset = toCanvas({ x: data.resolution, y: 0 });
  const baseRadius = Math.abs(sampleCellOffset.x - sampleCell.x) * 0.75;

  // Generate clip path from room shell points
  const clipPathId = 'heatmap-room-clip';
  const shouldClip = clipToRoom && roomShellPoints && roomShellPoints.length >= 3;
  const clipPathD = shouldClip
    ? `M ${roomShellPoints.map(p => `${p.x},${p.y}`).join(' L ')} Z`
    : '';

  return (
    <g className="heatmap-overlay" style={{ pointerEvents: 'none' }}>
      {/* SVG definitions for filter and clip path */}
      <defs>
        <filter id="heatmap-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        {shouldClip && (
          <clipPath id={clipPathId}>
            <path d={clipPathD} />
          </clipPath>
        )}
      </defs>

      {/* Heatmap cells - clipped to room if enabled */}
      <g clipPath={shouldClip ? `url(#${clipPathId})` : undefined}>
        {data.cells.map((cell, idx) => {
        // Get color and opacity based on intensity (returns null for low intensity)
        const heatColor = getHeatColor(cell.intensity, intensityThreshold);
        if (!heatColor) return null;

        // Transform device coordinates to room coordinates (use center of cell)
        const centerX = cell.x + data.resolution / 2;
        const centerY = cell.y + data.resolution / 2;
        const roomCenter = deviceToRoom(centerX, centerY);

        // Convert room coordinates to canvas coordinates
        const canvasCenter = toCanvas(roomCenter);

        const { fill, opacity } = heatColor;

        // Scale radius based on intensity (hotter spots are slightly larger)
        const radius = baseRadius * (0.8 + cell.intensity * 0.4);

        return (
          <circle
            key={idx}
            cx={canvasCenter.x}
            cy={canvasCenter.y}
            r={radius}
            fill={fill}
            opacity={opacity}
            filter="url(#heatmap-glow)"
          />
        );
        })}
      </g>

      {/* Average position marker - crosshair style */}
      {avgPositionCanvas && (
        <g className="average-position-marker">
          {/* Outer ring */}
          <circle
            cx={avgPositionCanvas.x}
            cy={avgPositionCanvas.y}
            r={12}
            fill="none"
            stroke="white"
            strokeWidth={2}
            opacity={0.9}
          />
          {/* Inner dot */}
          <circle
            cx={avgPositionCanvas.x}
            cy={avgPositionCanvas.y}
            r={4}
            fill="white"
            opacity={0.9}
          />
          {/* Crosshair lines */}
          <line
            x1={avgPositionCanvas.x - 18}
            y1={avgPositionCanvas.y}
            x2={avgPositionCanvas.x - 8}
            y2={avgPositionCanvas.y}
            stroke="white"
            strokeWidth={2}
            opacity={0.7}
          />
          <line
            x1={avgPositionCanvas.x + 8}
            y1={avgPositionCanvas.y}
            x2={avgPositionCanvas.x + 18}
            y2={avgPositionCanvas.y}
            stroke="white"
            strokeWidth={2}
            opacity={0.7}
          />
          <line
            x1={avgPositionCanvas.x}
            y1={avgPositionCanvas.y - 18}
            x2={avgPositionCanvas.x}
            y2={avgPositionCanvas.y - 8}
            stroke="white"
            strokeWidth={2}
            opacity={0.7}
          />
          <line
            x1={avgPositionCanvas.x}
            y1={avgPositionCanvas.y + 8}
            x2={avgPositionCanvas.x}
            y2={avgPositionCanvas.y + 18}
            stroke="white"
            strokeWidth={2}
            opacity={0.7}
          />
        </g>
      )}
    </g>
  );
};
