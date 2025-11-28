import React from 'react';

interface Point {
  x: number;
  y: number;
}

interface EP1DistanceArcProps {
  distance: number | null | undefined; // Distance in meters
  devicePlacement: { x: number; y: number; rotationDeg?: number };
  toCanvas: (point: { x: number; y: number }) => { x: number; y: number };
  rangeMm: number;
  fieldOfViewDeg?: number;
  color?: string;
  fillOpacity?: number;
  strokeOpacity?: number;
  showLabel?: boolean;
  labelText?: string;
  showPulse?: boolean;
  roomShellPoints?: Point[];
  clipToWalls?: boolean;
}

// Line-segment intersection helper (same as RoomCanvas)
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

export const EP1DistanceArc: React.FC<EP1DistanceArcProps> = ({
  distance,
  devicePlacement,
  toCanvas,
  rangeMm,
  fieldOfViewDeg = 120,
  color = '#06b6d4',
  fillOpacity = 0.15,
  strokeOpacity = 0.6,
  showLabel = true,
  labelText,
  showPulse = false,
  roomShellPoints = [],
  clipToWalls = false,
}) => {
  // If no distance detected, don't render anything
  if (distance == null || distance <= 0) {
    return null;
  }

  // Convert distance from meters to millimeters
  const distanceMm = distance * 1000;

  // Device rotation: Add 90 degrees so that 0 degrees points down (Y+) instead of right (X+)
  // This matches the global orientation used by the radar overlay
  const rotationRad = (((devicePlacement.rotationDeg ?? 0) + 90) * Math.PI) / 180;
  const halfFov = (fieldOfViewDeg * Math.PI) / 360;

  // Calculate arc angles in world coordinates
  const a1 = rotationRad - halfFov;
  const a2 = rotationRad + halfFov;

  // Build arc points in WORLD coordinates (just like the radar overlay does)
  const deviceWorld = { x: devicePlacement.x, y: devicePlacement.y };

  const arcPoints: Point[] = [deviceWorld]; // Start at device

  // Sample points along the arc
  const arcSteps = 32;
  const angleStep = ((fieldOfViewDeg * Math.PI) / 180) / arcSteps;

  if (clipToWalls && roomShellPoints.length >= 3) {
    // Wall clipping mode - same as green radar overlay
    const minClipDistance = 10; // Minimum 10mm to avoid clipping at device position

    for (let i = 0; i <= arcSteps; i++) {
      const angle = a1 + i * angleStep;
      const rayEnd: Point = {
        x: deviceWorld.x + Math.cos(angle) * distanceMm,
        y: deviceWorld.y + Math.sin(angle) * distanceMm,
      };

      let clippedPoint = rayEnd;
      let minDist = Infinity;

      for (let j = 0; j < roomShellPoints.length; j++) {
        const wallStart = roomShellPoints[j];
        const wallEnd = roomShellPoints[(j + 1) % roomShellPoints.length];
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

      arcPoints.push(clippedPoint);
    }
  } else {
    // No wall clipping - draw proper arc
    for (let i = 0; i <= arcSteps; i++) {
      const angle = a1 + i * angleStep;
      const arcPoint: Point = {
        x: deviceWorld.x + Math.cos(angle) * distanceMm,
        y: deviceWorld.y + Math.sin(angle) * distanceMm,
      };
      arcPoints.push(arcPoint);
    }
  }

  // Convert ALL points to canvas coordinates at once
  const arcPath = arcPoints.map(toCanvas);
  const pathData = arcPath.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z';

  // Label position (at the center of the arc, along device direction)
  const labelWorldPos = {
    x: deviceWorld.x + (distanceMm * 0.7) * Math.cos(rotationRad),
    y: deviceWorld.y + (distanceMm * 0.7) * Math.sin(rotationRad),
  };
  const labelCanvasPos = toCanvas(labelWorldPos);

  // Pulse indicator position (at the arc edge, along device direction)
  const pulseWorldPos = {
    x: deviceWorld.x + distanceMm * Math.cos(rotationRad),
    y: deviceWorld.y + distanceMm * Math.sin(rotationRad),
  };
  const pulseCanvasPos = toCanvas(pulseWorldPos);

  const displayLabel = labelText ?? `${distance.toFixed(2)}m`;

  // Determine background color from main color (darken it)
  const getLabelBgColor = (hexColor: string) => {
    const r = parseInt(hexColor.slice(1, 3), 16);
    const g = parseInt(hexColor.slice(3, 5), 16);
    const b = parseInt(hexColor.slice(5, 7), 16);
    return `rgb(${Math.floor(r * 0.7)}, ${Math.floor(g * 0.7)}, ${Math.floor(b * 0.7)})`;
  };

  return (
    <g className="ep1-distance-arc">
      {/* Detection arc - filled pie slice */}
      <path
        d={pathData}
        fill={color}
        fillOpacity={fillOpacity}
        stroke={color}
        strokeWidth="2"
        strokeOpacity={strokeOpacity}
        vectorEffect="non-scaling-stroke"
        style={{ pointerEvents: 'none' }}
        className="transition-all duration-300"
      />

      {/* Distance label with background */}
      {showLabel && (
        <g transform={`translate(${labelCanvasPos.x}, ${labelCanvasPos.y})`}>
          {/* Label background */}
          <rect
            x="-30"
            y="-12"
            width="60"
            height="24"
            rx="4"
            fill={getLabelBgColor(color)}
            fillOpacity="0.9"
          />
          {/* Label text */}
          <text
            x="0"
            y="0"
            textAnchor="middle"
            dominantBaseline="central"
            fill="white"
            fontSize="13"
            fontWeight="600"
            className="select-none"
          >
            {displayLabel}
          </text>
        </g>
      )}

      {/* Pulsing indicator at arc edge */}
      {showPulse && (
        <circle
          cx={pulseCanvasPos.x}
          cy={pulseCanvasPos.y}
          r="6"
          fill={color}
          fillOpacity="0.8"
        >
          <animate
            attributeName="r"
            values="4;8;4"
            dur="2s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="fill-opacity"
            values="0.8;0.3;0.8"
            dur="2s"
            repeatCount="indefinite"
          />
        </circle>
      )}
    </g>
  );
};
