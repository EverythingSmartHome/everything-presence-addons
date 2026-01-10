import React, { useState } from 'react';
import { ZoneRect, ZonePolygon, Point, FurnitureInstance, Door, isZonePolygon } from '../api/types';
import { RoomCanvas } from './RoomCanvas';
import { DevicePlacement, Point as RoomPoint } from './RoomCanvas';
import { getFurnitureIcon } from '../furniture/icons';
import { getFurnitureColors } from '../furniture/colors';

interface ZoneCanvasProps {
  zones: ZoneRect[];
  onZonesChange: (zones: ZoneRect[]) => void;
  // Polygon zones support
  polygonZones?: ZonePolygon[];
  onPolygonZonesChange?: (zones: ZonePolygon[]) => void;
  polygonMode?: boolean; // Whether we're in polygon editing mode
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  rangeMm?: number;
  snapGridMm?: number;
  height?: number | string;
  zoom?: number;
  panOffsetMm?: { x: number; y: number };
  onPanChange?: (offset: { x: number; y: number }) => void;
  onCanvasMove?: (point: { x: number; y: number }) => void;
  roomShell?: { points: RoomPoint[] };
  roomShellFillMode?: 'overlay' | 'material';
  floorMaterial?: 'wood-oak' | 'wood-walnut' | 'wood-cherry' | 'wood-ash' | 'wood-mahogany' | 'wood-herringbone' | 'carpet-beige' | 'carpet-gray' | 'carpet-charcoal' | 'carpet-navy' | 'carpet-burgundy' | 'tile-white' | 'tile-gray' | 'tile-terracotta' | 'marble-white' | 'marble-black' | 'slate' | 'concrete' | 'vinyl-light' | 'none';
  devicePlacement?: DevicePlacement;
  installationAngle?: number;
  fieldOfViewDeg?: number;
  maxRangeMeters?: number;
  deviceIconUrl?: string;
  clipRadarToWalls?: boolean;
  showRadar?: boolean;
  furniture?: FurnitureInstance[];
  selectedFurnitureId?: string | null;
  onFurnitureSelect?: (id: string | null) => void;
  doors?: Door[];
  onDragStateChange?: (isDragging: boolean) => void;
  // Zone labels from device mapping (overrides zone.label)
  zoneLabels?: Record<string, string>;
  // Visibility toggles
  showWalls?: boolean;
  showFurniture?: boolean;
  showDoors?: boolean;
  showZones?: boolean;
  showDevice?: boolean;
  renderOverlay?: (params: {
    toCanvas: (point: { x: number; y: number }) => { x: number; y: number };
    fromCanvas: (point: { x: number; y: number }) => { x: number; y: number };
    toWorldFromEvent: (e: React.MouseEvent<SVGElement>) => { x: number; y: number } | null;
    svgRef: React.RefObject<SVGSVGElement>;
    rangeMm: number;
  }) => React.ReactNode;
}

export const ZoneCanvas: React.FC<ZoneCanvasProps> = ({
  zones,
  onZonesChange,
  polygonZones = [],
  onPolygonZonesChange,
  polygonMode = false,
  selectedId,
  onSelect,
  rangeMm = 6000,
  snapGridMm = 0,
  height = 520,
  zoom = 1,
  panOffsetMm = { x: 0, y: 0 },
  onPanChange,
  onCanvasMove,
  roomShell,
  roomShellFillMode,
  floorMaterial,
  devicePlacement,
  installationAngle,
  fieldOfViewDeg,
  maxRangeMeters,
  deviceIconUrl,
  clipRadarToWalls,
  showRadar,
  furniture = [],
  selectedFurnitureId,
  onFurnitureSelect,
  doors = [],
  onDragStateChange,
  zoneLabels,
  showWalls = true,
  showFurniture = true,
  showDoors = true,
  showZones = true,
  showDevice = true,
  renderOverlay,
}) => {
  // Rectangle zone dragging state
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const [resizingHandle, setResizingHandle] = useState<{ zoneId: string; handle: string } | null>(null);
  const [resizeStart, setResizeStart] = useState<{ zone: ZoneRect; mouseX: number; mouseY: number } | null>(null);

  // Polygon zone dragging state
  const [draggingPolygonId, setDraggingPolygonId] = useState<string | null>(null);
  const [polygonDragOffset, setPolygonDragOffset] = useState<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const [draggingVertex, setDraggingVertex] = useState<{ zoneId: string; vertexIndex: number } | null>(null);

  const effectiveRotationDeg =
    devicePlacement ? (devicePlacement.rotationDeg ?? 0) + (installationAngle ?? 0) : 0;

  // Transform device-relative coordinates to room coordinates
  const deviceToRoom = (deviceX: number, deviceY: number): { x: number; y: number } => {
    if (!devicePlacement) {
      return { x: deviceX, y: deviceY };
    }

    // Apply installation angle offset to match firmware coordinate rotation
    const angleRad = effectiveRotationDeg * (Math.PI / 180);
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);

    // Rotate around origin
    const rotatedX = deviceX * cos - deviceY * sin;
    const rotatedY = deviceX * sin + deviceY * cos;

    // Translate by device position
    return {
      x: rotatedX + devicePlacement.x,
      y: rotatedY + devicePlacement.y,
    };
  };

  // Transform room coordinates back to device-relative coordinates
  const roomToDevice = (roomX: number, roomY: number): { x: number; y: number } => {
    if (!devicePlacement) {
      return { x: roomX, y: roomY };
    }

    // Translate by inverse of device position
    const translatedX = roomX - devicePlacement.x;
    const translatedY = roomY - devicePlacement.y;

    // Rotate by inverse angle (no offset needed)
    const angleRad = -effectiveRotationDeg * (Math.PI / 180);
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);

    return {
      x: translatedX * cos - translatedY * sin,
      y: translatedX * sin + translatedY * cos,
    };
  };

  return (
    <RoomCanvas
      points={roomShell?.points ?? []}
      onChange={() => {}}
      roomShellFillMode={roomShellFillMode}
      floorMaterial={floorMaterial}
      onCanvasMove={(pt) => {
        onCanvasMove?.(pt);

        // Handle resizing
        if (resizingHandle && resizeStart) {
          const idx = zones.findIndex((z) => z.id === resizingHandle.zoneId);
          if (idx === -1) return;

          const zone = { ...zones[idx] };
          const handle = resizingHandle.handle;

          // Convert current mouse position to device coordinates
          const devicePt = roomToDevice(pt.x, pt.y);
          const startDevicePt = roomToDevice(resizeStart.mouseX, resizeStart.mouseY);
          const deltaX = devicePt.x - startDevicePt.x;
          const deltaY = devicePt.y - startDevicePt.y;

          // Apply handle-specific resize logic
          const originalZone = resizeStart.zone;
          if (handle.includes('w')) {
            // Moving west edge
            zone.x = originalZone.x + deltaX;
            zone.width = originalZone.width - deltaX;
          }
          if (handle.includes('e')) {
            // Moving east edge
            zone.width = originalZone.width + deltaX;
          }
          if (handle.includes('n')) {
            // Moving north edge
            zone.y = originalZone.y + deltaY;
            zone.height = originalZone.height - deltaY;
          }
          if (handle.includes('s')) {
            // Moving south edge
            zone.height = originalZone.height + deltaY;
          }

          // Ensure minimum size
          if (zone.width < 100) zone.width = 100;
          if (zone.height < 100) zone.height = 100;

          // Apply snapping
          if (snapGridMm && snapGridMm > 0) {
            const step = snapGridMm;
            zone.x = Math.round(zone.x / step) * step;
            zone.y = Math.round(zone.y / step) * step;
            zone.width = Math.round(zone.width / step) * step;
            zone.height = Math.round(zone.height / step) * step;
          }

          const next = [...zones];
          next[idx] = zone;
          onZonesChange(next);
          return;
        }

        // Handle moving rectangle zones
        if (draggingId) {
          const idx = zones.findIndex((z) => z.id === draggingId);
          if (idx === -1) return;
          const zone = { ...zones[idx] };

          // Convert room coordinates back to device-relative coordinates
          const deviceCoords = roomToDevice(pt.x - dragOffset.dx, pt.y - dragOffset.dy);
          zone.x = deviceCoords.x;
          zone.y = deviceCoords.y;

          if (snapGridMm && snapGridMm > 0) {
            const step = snapGridMm;
            zone.x = Math.round(zone.x / step) * step;
            zone.y = Math.round(zone.y / step) * step;
          }
          const next = [...zones];
          next[idx] = zone;
          onZonesChange(next);
          return;
        }

        // Handle polygon vertex dragging
        if (draggingVertex && onPolygonZonesChange) {
          const idx = polygonZones.findIndex((z) => z.id === draggingVertex.zoneId);
          if (idx === -1) return;

          const polygon = { ...polygonZones[idx] };
          const vertices = [...polygon.vertices];

          // Convert room coordinates back to device-relative coordinates
          const deviceCoords = roomToDevice(pt.x, pt.y);
          let newX = deviceCoords.x;
          let newY = deviceCoords.y;

          if (snapGridMm && snapGridMm > 0) {
            const step = snapGridMm;
            newX = Math.round(newX / step) * step;
            newY = Math.round(newY / step) * step;
          }

          vertices[draggingVertex.vertexIndex] = { x: newX, y: newY };
          polygon.vertices = vertices;

          const next = [...polygonZones];
          next[idx] = polygon;
          onPolygonZonesChange(next);
          return;
        }

        // Handle moving entire polygon
        if (draggingPolygonId && onPolygonZonesChange) {
          const idx = polygonZones.findIndex((z) => z.id === draggingPolygonId);
          if (idx === -1) return;

          const polygon = { ...polygonZones[idx] };
          const deviceCoords = roomToDevice(pt.x - polygonDragOffset.dx, pt.y - polygonDragOffset.dy);

          // Calculate centroid of polygon to compute delta
          const centroid = polygon.vertices.reduce(
            (acc, v) => ({ x: acc.x + v.x / polygon.vertices.length, y: acc.y + v.y / polygon.vertices.length }),
            { x: 0, y: 0 }
          );

          let deltaX = deviceCoords.x - centroid.x;
          let deltaY = deviceCoords.y - centroid.y;

          if (snapGridMm && snapGridMm > 0) {
            const step = snapGridMm;
            deltaX = Math.round(deltaX / step) * step;
            deltaY = Math.round(deltaY / step) * step;
          }

          // Move all vertices
          polygon.vertices = polygon.vertices.map((v) => ({
            x: v.x + deltaX,
            y: v.y + deltaY,
          }));

          const next = [...polygonZones];
          next[idx] = polygon;
          onPolygonZonesChange(next);
          return;
        }
      }}
      onCanvasRelease={() => {
        if (draggingId || resizingHandle || draggingVertex || draggingPolygonId) {
          onDragStateChange?.(false);
        }
        setDraggingId(null);
        setResizingHandle(null);
        setResizeStart(null);
        setDraggingVertex(null);
        setDraggingPolygonId(null);
      }}
      onCanvasClick={() => onSelect?.(null)}
      rangeMm={rangeMm}
      snapGridMm={snapGridMm}
      height={height}
      zoom={zoom}
      panOffsetMm={panOffsetMm}
      onPanChange={onPanChange}
      devicePlacement={devicePlacement}
      fieldOfViewDeg={fieldOfViewDeg}
      maxRangeMeters={maxRangeMeters}
      deviceIconUrl={deviceIconUrl}
      clipRadarToWalls={clipRadarToWalls}
      showRadar={showRadar}
      doors={doors}
      showWalls={showWalls}
      showFurniture={false}
      showDoors={showDoors}
      showDevice={showDevice}
      deviceInteractive={false}
      lockShell
      renderOverlay={(params) => {
        const { toCanvas, toWorldFromEvent } = params;

        // Render furniture (before zones, so zones appear on top)
        const furnitureElements = showFurniture ? furniture.map((item) => {
          const canvasPos = toCanvas({ x: item.x, y: item.y });
          const canvasWidth = (item.width / rangeMm) * 700;
          const canvasHeight = (item.depth / rangeMm) * 700;
          const isSelected = selectedFurnitureId === item.id;
          const Icon = getFurnitureIcon(item.typeId);
          const colors = getFurnitureColors(item.typeId, isSelected);

          return (
            <g key={item.id} transform={`translate(${canvasPos.x}, ${canvasPos.y}) rotate(${item.rotationDeg})`}>
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
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                  e.stopPropagation();
                  onFurnitureSelect?.(item.id);
                }}
              />
            </g>
          );
        }) : [];

        // Render zones
        const zoneElements = showZones ? zones.map((zone) => {
          // Transform zone top-left corner to room coordinates
          const roomTopLeft = deviceToRoom(zone.x, zone.y);
          const canvasTopLeft = toCanvas(roomTopLeft);

          // Calculate canvas width/height WITHOUT rotation
          // Convert the zone dimensions directly to canvas scale
          const deviceOrigin = toCanvas(deviceToRoom(0, 0));
          const deviceRight = toCanvas(deviceToRoom(zone.width, 0));
          const deviceDown = toCanvas(deviceToRoom(0, zone.height));

          const canvasWidth = Math.hypot(deviceRight.x - deviceOrigin.x, deviceRight.y - deviceOrigin.y);
          const canvasHeight = Math.hypot(deviceDown.x - deviceOrigin.x, deviceDown.y - deviceOrigin.y);

          // Get device rotation for SVG transform
          const rotationDeg = devicePlacement ? effectiveRotationDeg : 0;

          const isSelected = selectedId === zone.id;

          // Zone colors: different colors for each regular zone, fixed colors for special types
          let color: string;
          if (zone.type === 'exclusion') {
            color = '#f43f5e'; // Rose/Red for exclusion
          } else if (zone.type === 'entry') {
            color = '#10b981'; // Green for entry
          } else {
            // Regular zones: assign different colors based on zone ID
            const regularZoneColors = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#06b6d4'];
            const regularZones = zones.filter(z => z.type === 'regular');
            const zoneIndex = regularZones.findIndex(z => z.id === zone.id);
            color = regularZoneColors[zoneIndex % regularZoneColors.length];
          }

          // Resize handles (only for selected zone)
          const handles = isSelected ? [
            { name: 'nw', x: 0, y: 0, cursor: 'nwse-resize' },
            { name: 'ne', x: canvasWidth, y: 0, cursor: 'nesw-resize' },
            { name: 'sw', x: 0, y: canvasHeight, cursor: 'nesw-resize' },
            { name: 'se', x: canvasWidth, y: canvasHeight, cursor: 'nwse-resize' },
            { name: 'n', x: canvasWidth / 2, y: 0, cursor: 'ns-resize' },
            { name: 's', x: canvasWidth / 2, y: canvasHeight, cursor: 'ns-resize' },
            { name: 'w', x: 0, y: canvasHeight / 2, cursor: 'ew-resize' },
            { name: 'e', x: canvasWidth, y: canvasHeight / 2, cursor: 'ew-resize' },
          ] : [];

          return (
            <g key={zone.id}>
              <rect
                x={0}
                y={0}
                width={canvasWidth}
                height={canvasHeight}
                fill={`${color}33`}
                stroke={color}
                strokeWidth={isSelected ? 3 : 1}
                rx={6}
                transform={`translate(${canvasTopLeft.x}, ${canvasTopLeft.y}) rotate(${rotationDeg})`}
                style={{ transformOrigin: '0 0', cursor: draggingId === zone.id ? 'move' : 'pointer' }}
                onClick={(e) => {
                  e.stopPropagation(); // Prevent canvas click from deselecting
                }}
                onMouseDown={(e) => {
                  if ((e as any).button !== 0) return; // only left click selects/drags
                  e.stopPropagation();
                  const world = toWorldFromEvent(e);
                  if (!world) return;
                  setDraggingId(zone.id);
                  onDragStateChange?.(true);
                  // Calculate offset in room coordinates
                  setDragOffset({ dx: world.x - roomTopLeft.x, dy: world.y - roomTopLeft.y });
                  onSelect?.(zone.id);
                }}
              />
              {/* Zone label with better visibility */}
              <text
                x={canvasWidth / 2}
                y={20}
                fill="white"
                fontSize="13"
                fontWeight="600"
                textAnchor="middle"
                pointerEvents="none"
                transform={`translate(${canvasTopLeft.x}, ${canvasTopLeft.y}) rotate(${rotationDeg})`}
                style={{
                  filter: 'drop-shadow(0 1px 2px rgb(0 0 0 / 0.8))',
                  textShadow: '0 1px 3px rgba(0,0,0,0.8)'
                }}
              >
                {zoneLabels?.[zone.id] || zone.label || zone.id}
              </text>
              {/* Resize handles */}
              {handles.map((handle) => (
                <circle
                  key={handle.name}
                  cx={handle.x}
                  cy={handle.y}
                  r={6}
                  fill="white"
                  stroke={color}
                  strokeWidth={2}
                  transform={`translate(${canvasTopLeft.x}, ${canvasTopLeft.y}) rotate(${rotationDeg})`}
                  style={{
                    transformOrigin: '0 0',
                    cursor: handle.cursor,
                  }}
                  onClick={(e) => {
                    e.stopPropagation(); // Prevent canvas click from deselecting
                  }}
                  onMouseDown={(e) => {
                    if ((e as any).button !== 0) return;
                    e.stopPropagation();
                    const world = toWorldFromEvent(e);
                    if (!world) return;
                    setResizingHandle({ zoneId: zone.id, handle: handle.name });
                    setResizeStart({ zone: { ...zone }, mouseX: world.x, mouseY: world.y });
                    onDragStateChange?.(true);
                    onSelect?.(zone.id);
                  }}
                />
              ))}
            </g>
          );
        }) : [];

        // Render polygon zones
        const polygonZoneElements = (showZones && polygonMode) ? polygonZones.map((polygon) => {
          // Convert all vertices from device coordinates to room coordinates to canvas coordinates
          const canvasVertices = polygon.vertices.map((v) => {
            const roomPt = deviceToRoom(v.x, v.y);
            return toCanvas(roomPt);
          });

          if (canvasVertices.length < 3) return null;

          // Create SVG polygon points string
          const pointsStr = canvasVertices.map((v) => `${v.x},${v.y}`).join(' ');

          const isSelected = selectedId === polygon.id;

          // Zone colors based on type
          let color: string;
          if (polygon.type === 'exclusion') {
            color = '#f43f5e'; // Rose/Red for exclusion
          } else if (polygon.type === 'entry') {
            color = '#10b981'; // Green for entry
          } else {
            // Regular zones: assign different colors based on zone ID
            const regularZoneColors = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#06b6d4'];
            const regularPolygons = polygonZones.filter(z => z.type === 'regular');
            const zoneIndex = regularPolygons.findIndex(z => z.id === polygon.id);
            color = regularZoneColors[zoneIndex % regularZoneColors.length];
          }

          // Calculate centroid for label positioning
          const centroid = canvasVertices.reduce(
            (acc, v) => ({ x: acc.x + v.x / canvasVertices.length, y: acc.y + v.y / canvasVertices.length }),
            { x: 0, y: 0 }
          );

          // Calculate centroid in device coordinates for drag offset
          const deviceCentroid = polygon.vertices.reduce(
            (acc, v) => ({ x: acc.x + v.x / polygon.vertices.length, y: acc.y + v.y / polygon.vertices.length }),
            { x: 0, y: 0 }
          );
          const roomCentroid = deviceToRoom(deviceCentroid.x, deviceCentroid.y);

          return (
            <g key={polygon.id}>
              {/* Polygon fill and outline */}
              <polygon
                points={pointsStr}
                fill={`${color}33`}
                stroke={color}
                strokeWidth={isSelected ? 3 : 1}
                style={{ cursor: draggingPolygonId === polygon.id ? 'move' : 'pointer' }}
                onClick={(e) => {
                  e.stopPropagation();
                }}
                onMouseDown={(e) => {
                  if ((e as any).button !== 0) return;
                  e.stopPropagation();
                  const world = toWorldFromEvent(e);
                  if (!world) return;
                  setDraggingPolygonId(polygon.id);
                  onDragStateChange?.(true);
                  setPolygonDragOffset({ dx: world.x - roomCentroid.x, dy: world.y - roomCentroid.y });
                  onSelect?.(polygon.id);
                }}
              />
              {/* Zone label */}
              <text
                x={centroid.x}
                y={centroid.y}
                fill="white"
                fontSize="13"
                fontWeight="600"
                textAnchor="middle"
                dominantBaseline="middle"
                pointerEvents="none"
                style={{
                  filter: 'drop-shadow(0 1px 2px rgb(0 0 0 / 0.8))',
                  textShadow: '0 1px 3px rgba(0,0,0,0.8)'
                }}
              >
                {zoneLabels?.[polygon.id] || polygon.label || polygon.id}
              </text>
              {/* Vertex handles (only when selected) */}
              {isSelected && canvasVertices.map((v, idx) => (
                <circle
                  key={`vertex-${idx}`}
                  cx={v.x}
                  cy={v.y}
                  r={7}
                  fill="white"
                  stroke={color}
                  strokeWidth={2}
                  style={{ cursor: 'move' }}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                  onMouseDown={(e) => {
                    if ((e as any).button !== 0) return;
                    e.stopPropagation();
                    setDraggingVertex({ zoneId: polygon.id, vertexIndex: idx });
                    onDragStateChange?.(true);
                    onSelect?.(polygon.id);
                  }}
                />
              ))}
              {/* Edge midpoints for adding vertices (only when selected) */}
              {isSelected && canvasVertices.map((v, idx) => {
                const nextIdx = (idx + 1) % canvasVertices.length;
                const nextV = canvasVertices[nextIdx];
                const midX = (v.x + nextV.x) / 2;
                const midY = (v.y + nextV.y) / 2;

                return (
                  <circle
                    key={`midpoint-${idx}`}
                    cx={midX}
                    cy={midY}
                    r={5}
                    fill={color}
                    fillOpacity={0.5}
                    stroke="white"
                    strokeWidth={1}
                    style={{ cursor: 'crosshair' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!onPolygonZonesChange) return;

                      // Calculate midpoint in device coordinates
                      const v1 = polygon.vertices[idx];
                      const v2 = polygon.vertices[nextIdx];
                      const newVertex = {
                        x: (v1.x + v2.x) / 2,
                        y: (v1.y + v2.y) / 2,
                      };

                      // Insert new vertex after idx
                      const newVertices = [...polygon.vertices];
                      newVertices.splice(idx + 1, 0, newVertex);

                      const updatedPolygon = { ...polygon, vertices: newVertices };
                      const next = polygonZones.map(p => p.id === polygon.id ? updatedPolygon : p);
                      onPolygonZonesChange(next);
                    }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                    }}
                  />
                );
              })}
            </g>
          );
        }).filter(Boolean) : [];

        // Render custom overlay if provided (rendered BEFORE zones so zones are on top)
        const customOverlay = renderOverlay ? renderOverlay(params) : null;

        // Extract device element from params (passed by RoomCanvas when deviceInteractive=false)
        const deviceElement = (params as any).deviceElement;

        return (
          <>
            {furnitureElements}
            {/* Device element rendered after furniture but before targets/zones (non-interactive mode) */}
            {deviceElement}
            {/* Custom overlay (targets, etc.) rendered before zones so zones are interactable */}
            {customOverlay}
            {/* Show rectangle zones when NOT in polygon mode, polygon zones when in polygon mode */}
            {!polygonMode && zoneElements}
            {polygonMode && polygonZoneElements}
          </>
        );
      }}
    />
  );
};
