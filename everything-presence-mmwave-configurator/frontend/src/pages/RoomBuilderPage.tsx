import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchDevices, fetchProfiles } from '../api/client';
import { fetchRooms, updateRoom } from '../api/rooms';
import { RoomCanvas } from '../components/RoomCanvas';
import { DiscoveredDevice, DeviceProfile, RoomConfig, LiveState, FurnitureInstance, FurnitureType, Door } from '../api/types';
import { useWallDrawing } from '../hooks/useWallDrawing';
import { FurnitureLibrary } from '../components/FurnitureLibrary';
import { FurnitureEditor } from '../components/FurnitureEditor';
import { DoorEditor } from '../components/DoorEditor';
import { FLOOR_MATERIALS } from '../components/FloorMaterials';
import { useDisplaySettings } from '../hooks/useDisplaySettings';

interface RoomBuilderPageProps {
  onBack?: () => void;
  onNavigate?: (view: 'wizard' | 'zoneEditor' | 'roomBuilder' | 'settings' | 'liveDashboard') => void;
  initialRoomId?: string | null;
  initialProfileId?: string | null;
  onWizardProgress?: (progress: { outlineDone?: boolean; placementDone?: boolean }) => void;
  liveState?: LiveState | null;
  targetPositions?: Array<{
    id: number;
    x: number;
    y: number;
    distance: number | null;
    speed: number | null;
    angle: number | null;
  }>;
}

const clampNumber = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

export const RoomBuilderPage: React.FC<RoomBuilderPageProps> = ({
  onBack,
  onNavigate,
  initialRoomId,
  initialProfileId,
  onWizardProgress,
}) => {
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [profiles, setProfiles] = useState<DeviceProfile[]>([]);
  const [rooms, setRooms] = useState<RoomConfig[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [rangeMm, setRangeMm] = useState(15000);
  const [widthMm, setWidthMm] = useState(4000);
  const [heightMm, setHeightMm] = useState(4000);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoveredSegment, setHoveredSegment] = useState<number | null>(null);
  const [selectedSegment, setSelectedSegment] = useState<number | null>(null);
  const [segmentDragIndex, setSegmentDragIndex] = useState<number | null>(null);
  const [segmentDragStart, setSegmentDragStart] = useState<{ x: number; y: number } | null>(null);
  const [segmentDragBase, setSegmentDragBase] = useState<{ x: number; y: number }[] | null>(null);
  const [endpointDrag, setEndpointDrag] = useState<{
    segment: number;
    endpoint: 'start' | 'end';
    start: { x: number; y: number };
    base: { x: number; y: number }[];
  } | null>(null);
  const [snapGridMm, setSnapGridMm] = useState(100); // 0.1m default snap
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [cursorDelta, setCursorDelta] = useState<{ dx: number; dy: number; len: number } | null>(null);
  const [displayUnits, setDisplayUnits] = useState<'metric' | 'imperial'>('metric');
  const [zoom, setZoom] = useState(1.1);
  const [showSettings, setShowSettings] = useState(false);
  const [showNavMenu, setShowNavMenu] = useState(false);
  // Display settings (persisted to localStorage)
  const {
    showWalls, setShowWalls,
    showFurniture, setShowFurniture,
    showDoors, setShowDoors,
    showDeviceIcon, setShowDeviceIcon,
    clipRadarToWalls,
  } = useDisplaySettings();
  const [panOffsetMm, setPanOffsetMm] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [showFurnitureLibrary, setShowFurnitureLibrary] = useState(false);
  const [selectedFurnitureId, setSelectedFurnitureId] = useState<string | null>(null);
  const [selectedDoorId, setSelectedDoorId] = useState<string | null>(null);
  const [isDoorPlacementMode, setIsDoorPlacementMode] = useState(false);
  const [doorDrag, setDoorDrag] = useState<{
    doorId: string;
    startX: number;
    startY: number;
    originalPosition: number;
  } | null>(null);
  const CANVAS_SIZE = 700;
  const HALF = CANVAS_SIZE / 2;
  const toCanvas = (v: number, range: number) => (v / range) * CANVAS_SIZE;

  const selectedRoom = useMemo(
    () => (selectedRoomId ? rooms.find((r) => r.id === selectedRoomId) ?? null : null),
    [rooms, selectedRoomId],
  );

  const selectedProfile = useMemo(
    () => profiles.find((p) => p.id === (selectedRoom?.profileId ?? selectedProfileId)) ?? null,
    [profiles, selectedProfileId, selectedRoom?.profileId],
  );

  const selectedFurniture = useMemo(
    () => (selectedFurnitureId ? selectedRoom?.furniture?.find((f) => f.id === selectedFurnitureId) ?? null : null),
    [selectedFurnitureId, selectedRoom?.furniture],
  );

  const selectedDoor = useMemo(
    () => (selectedDoorId ? selectedRoom?.doors?.find((d) => d.id === selectedDoorId) ?? null : null),
    [selectedDoorId, selectedRoom?.doors],
  );

  const handlePointsChange = useCallback((nextPoints: { x: number; y: number }[]) => {
    if (!selectedRoom) return;
    const updated: RoomConfig = { ...selectedRoom, roomShell: { points: nextPoints } };
    setRooms((prev) => prev.map((r) => (r.id === selectedRoom.id ? updated : r)));
  }, [selectedRoom]);

  const handleAddFurniture = useCallback((furnitureType: FurnitureType) => {
    if (!selectedRoom) return;
    // Generate a simple UUID fallback for older browsers
    const generateId = () => {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
      }
      // Fallback: simple UUID v4 implementation
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    };

    const newFurniture: FurnitureInstance = {
      id: generateId(),
      typeId: furnitureType.id,
      x: 0,
      y: 0,
      width: furnitureType.defaultWidth,
      depth: furnitureType.defaultDepth,
      height: furnitureType.defaultHeight,
      rotationDeg: 0,
      aspectRatioLocked: true,
    };
    const updated: RoomConfig = {
      ...selectedRoom,
      furniture: [...(selectedRoom.furniture ?? []), newFurniture],
    };
    setRooms((prev) => prev.map((r) => (r.id === selectedRoom.id ? updated : r)));
    setSelectedFurnitureId(newFurniture.id);
    setShowFurnitureLibrary(false);
  }, [selectedRoom]);

  const handleFurnitureChange = useCallback((updatedFurniture: FurnitureInstance) => {
    if (!selectedRoom) return;
    const updated: RoomConfig = {
      ...selectedRoom,
      furniture: (selectedRoom.furniture ?? []).map((f) => (f.id === updatedFurniture.id ? updatedFurniture : f)),
    };
    setRooms((prev) => prev.map((r) => (r.id === selectedRoom.id ? updated : r)));
  }, [selectedRoom]);

  const handleFurnitureDelete = useCallback(() => {
    if (!selectedRoom || !selectedFurnitureId) return;
    const updated: RoomConfig = {
      ...selectedRoom,
      furniture: (selectedRoom.furniture ?? []).filter((f) => f.id !== selectedFurnitureId),
    };
    setRooms((prev) => prev.map((r) => (r.id === selectedRoom.id ? updated : r)));
    setSelectedFurnitureId(null);
  }, [selectedRoom, selectedFurnitureId]);

  const handleAddDoor = useCallback(() => {
    if (!selectedRoom) return;
    if (!selectedRoom.roomShell?.points || selectedRoom.roomShell.points.length < 3) {
      alert('Please draw a room outline first');
      return;
    }
    // Toggle door placement mode
    setIsDoorPlacementMode((prev) => !prev);
    if (!isDoorPlacementMode) {
      // Entering placement mode - deselect everything
      setSelectedDoorId(null);
      setSelectedFurnitureId(null);
      setSelectedSegment(null);
    }
  }, [selectedRoom, isDoorPlacementMode]);

  const handleDoorChange = useCallback((updatedDoor: Door) => {
    if (!selectedRoom) return;
    const updated: RoomConfig = {
      ...selectedRoom,
      doors: (selectedRoom.doors ?? []).map((d) => (d.id === updatedDoor.id ? updatedDoor : d)),
    };
    setRooms((prev) => prev.map((r) => (r.id === selectedRoom.id ? updated : r)));
  }, [selectedRoom]);

  const handleDoorDelete = useCallback(() => {
    if (!selectedRoom || !selectedDoorId) return;
    const updated: RoomConfig = {
      ...selectedRoom,
      doors: (selectedRoom.doors ?? []).filter((d) => d.id !== selectedDoorId),
    };
    setRooms((prev) => prev.map((r) => (r.id === selectedRoom.id ? updated : r)));
    setSelectedDoorId(null);
  }, [selectedRoom, selectedDoorId]);

  // Helper to generate UUID
  const generateId = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // Fallback: simple UUID v4 implementation
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };

  const handleWallSegmentClick = useCallback((segmentIndex: number, positionOnSegment: number) => {
    if (!selectedRoom || !isDoorPlacementMode) return;

    const newDoor: Door = {
      id: generateId(),
      segmentIndex,
      positionOnSegment,
      widthMm: 800, // Standard door width
      swingDirection: 'in',
      swingSide: 'left',
    };
    const updated: RoomConfig = {
      ...selectedRoom,
      doors: [...(selectedRoom.doors ?? []), newDoor],
    };
    setRooms((prev) => prev.map((r) => (r.id === selectedRoom.id ? updated : r)));
    setSelectedDoorId(newDoor.id);
    setIsDoorPlacementMode(false); // Exit placement mode after placing
  }, [selectedRoom, isDoorPlacementMode]);

  const handleDoorDragStart = useCallback((doorId: string, x: number, y: number) => {
    const door = selectedRoom?.doors?.find((d) => d.id === doorId);
    if (!door) return;
    setDoorDrag({
      doorId,
      startX: x,
      startY: y,
      originalPosition: door.positionOnSegment,
    });
  }, [selectedRoom]);

  const handleDoorDragMove = useCallback((x: number, y: number) => {
    if (!doorDrag || !selectedRoom) return;

    const door = selectedRoom.doors?.find((d) => d.id === doorDrag.doorId);
    if (!door || !selectedRoom.roomShell?.points) return;

    const pts = selectedRoom.roomShell.points;
    if (door.segmentIndex < 0 || door.segmentIndex >= pts.length) return;

    const segmentStart = pts[door.segmentIndex];
    const segmentEnd = pts[(door.segmentIndex + 1) % pts.length];
    if (!segmentStart || !segmentEnd) return;

    // Calculate the projection of the cursor onto the wall segment
    const segmentDx = segmentEnd.x - segmentStart.x;
    const segmentDy = segmentEnd.y - segmentStart.y;
    const segmentLength = Math.hypot(segmentDx, segmentDy);

    if (segmentLength < 1) return;

    // Vector from segment start to cursor
    const toCursorX = x - segmentStart.x;
    const toCursorY = y - segmentStart.y;

    // Project cursor onto segment
    const projection = (toCursorX * segmentDx + toCursorY * segmentDy) / (segmentLength * segmentLength);

    // Clamp to [0, 1]
    const newPosition = Math.max(0, Math.min(1, projection));

    handleDoorChange({ ...door, positionOnSegment: newPosition });
  }, [doorDrag, selectedRoom, handleDoorChange]);

  const handleDoorDragEnd = useCallback(() => {
    setDoorDrag(null);
  }, []);

  // Door validation helpers
  const validateDoor = useCallback((door: Door, allDoors: Door[], roomShell?: RoomShell): {
    overlaps: boolean;
    nearCorner: boolean;
    tooWide: boolean;
    overlapWith?: string[];
  } => {
    if (!roomShell?.points || roomShell.points.length < 3) {
      return { overlaps: false, nearCorner: false, tooWide: false };
    }

    const pts = roomShell.points;
    if (door.segmentIndex < 0 || door.segmentIndex >= pts.length) {
      return { overlaps: false, nearCorner: false, tooWide: false };
    }

    const segmentStart = pts[door.segmentIndex];
    const segmentEnd = pts[(door.segmentIndex + 1) % pts.length];
    if (!segmentStart || !segmentEnd) {
      return { overlaps: false, nearCorner: false, tooWide: false };
    }

    const segmentLength = Math.hypot(segmentEnd.x - segmentStart.x, segmentEnd.y - segmentStart.y);

    // Check if door is too wide for segment
    const doorWidthRatio = door.widthMm / segmentLength;
    const tooWide = doorWidthRatio > 0.9; // Door takes up more than 90% of wall

    // Check if door is near corner (within 10% of segment ends)
    const nearCorner = door.positionOnSegment < 0.1 || door.positionOnSegment > 0.9;

    // Check for overlaps with other doors on same segment
    const doorsOnSameSegment = allDoors.filter(
      (d) => d.id !== door.id && d.segmentIndex === door.segmentIndex
    );

    const overlapWith: string[] = [];
    let overlaps = false;

    for (const otherDoor of doorsOnSameSegment) {
      // Calculate the span of each door along the segment (0-1)
      const halfWidth1 = (door.widthMm / segmentLength) / 2;
      const halfWidth2 = (otherDoor.widthMm / segmentLength) / 2;

      const start1 = door.positionOnSegment - halfWidth1;
      const end1 = door.positionOnSegment + halfWidth1;
      const start2 = otherDoor.positionOnSegment - halfWidth2;
      const end2 = otherDoor.positionOnSegment + halfWidth2;

      // Check if ranges overlap
      if (!(end1 < start2 || end2 < start1)) {
        overlaps = true;
        overlapWith.push(otherDoor.id);
      }
    }

    return { overlaps, nearCorner, tooWide, overlapWith };
  }, []);

  const doorValidation = useMemo(() => {
    if (!selectedDoor || !selectedRoom) return null;
    return validateDoor(selectedDoor, selectedRoom.doors ?? [], selectedRoom.roomShell);
  }, [selectedDoor, selectedRoom, validateDoor]);

  // Wall drawing hook
  const {
    isDrawingWall,
    pendingStart,
    previewPoint,
    handleCanvasClick: wallDrawingClick,
    handleCanvasMove: wallDrawingMove,
    startDrawing,
    stopDrawing,
    removeLastPoint,
    setIsDrawingWall,
  } = useWallDrawing({
    snapGridMm,
    onPointsChange: handlePointsChange,
    currentPoints: selectedRoom?.roomShell?.points ?? [],
  });

  useEffect(() => {
    const load = async () => {
      try {
        const [deviceRes, profileRes, roomRes] = await Promise.all([fetchDevices(), fetchProfiles(), fetchRooms()]);
        setDevices(deviceRes.devices);
        setProfiles(profileRes.profiles);
        setRooms(roomRes.rooms);

        const initialRoom =
          (initialRoomId && roomRes.rooms.find((r) => r.id === initialRoomId)) || roomRes.rooms[0] || null;
        if (initialRoom) {
          setSelectedRoomId(initialRoom.id);
          if (initialRoom.profileId) setSelectedProfileId(initialRoom.profileId);
        }
        if (!initialRoom?.profileId && !selectedProfileId && profileRes.profiles.length > 0) {
          setSelectedProfileId(initialProfileId ?? profileRes.profiles[0].id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      }
    };
    load();
  }, [initialProfileId, initialRoomId, selectedProfileId]);

  useEffect(() => {
    // reset pan when switching rooms
    setPanOffsetMm({ x: 0, y: 0 });
  }, [selectedRoomId]);

  useEffect(() => {
    if (!selectedRoom?.roomShell?.points?.length) return;
    const pts = selectedRoom.roomShell.points;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    if (Number.isFinite(width)) setWidthMm(Math.round(width));
    if (Number.isFinite(height)) setHeightMm(Math.round(height));
  }, [selectedRoom?.roomShell?.points]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isEditable =
        target?.isContentEditable ||
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        tag === 'button';
      if (isEditable) return;

      if (e.key === 'Escape') {
        stopDrawing();
        return;
      }
      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        setIsDrawingWall((prev) => !prev);
        return;
      }
      if (e.key === 'Enter') {
        if (isDrawingWall) {
          e.preventDefault();
          handleCloseLoop();
        }
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (selectedRoom?.roomShell?.points?.length) {
          e.preventDefault();
          removeLastPoint();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isDrawingWall, selectedRoom?.roomShell?.points, stopDrawing, setIsDrawingWall, removeLastPoint]);

  const handleAddPoint = (p: { x: number; y: number }) => {
    if (!selectedRoom) return;
    const nextPoints = [...(selectedRoom.roomShell?.points ?? []), p];
    handlePointsChange(nextPoints);
  };

  const handleSetRectangle = () => {
    if (!selectedRoom) return;
    const w = clampNumber(widthMm, 500, 20000);
    const h = clampNumber(heightMm, 500, 20000);
    const pts = [
      { x: -w / 2, y: -h / 2 },
      { x: w / 2, y: -h / 2 },
      { x: w / 2, y: h / 2 },
      { x: -w / 2, y: h / 2 },
    ];
    handlePointsChange(pts);
  };

  const handleClear = () => {
    if (!selectedRoom) return;
    handlePointsChange([]);
    stopDrawing();
  };

  const handleCloseLoop = () => {
    if (!selectedRoom?.roomShell?.points || selectedRoom.roomShell.points.length < 2) {
      stopDrawing();
      return;
    }
    const pts = selectedRoom.roomShell.points;
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (first && last) {
      const d = Math.hypot(first.x - last.x, first.y - last.y);
      if (d < 250) {
        const next = [...pts];
        next[next.length - 1] = first;
        handlePointsChange(next);
      }
    }
    // We render closed polygons; no need to duplicate the first point.
    stopDrawing();

    // Auto-center the room outline in the grid
    if (pts.length >= 3) {
      // Calculate the bounding box center
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;

      // Set pan offset to center the outline (negate the center to move it to origin)
      setPanOffsetMm({ x: centerX, y: centerY });
    }
  };


  const snapDelta = (dx: number, dy: number) => {
    if (dx === 0 && dy === 0) return { dx, dy };
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    if (absDx * 2 < absDy) {
      return { dx: 0, dy };
    }
    if (absDy * 2 < absDx) {
      return { dx, dy: 0 };
    }
    const signX = dx >= 0 ? 1 : -1;
    const signY = dy >= 0 ? 1 : -1;
    const mag = Math.max(absDx, absDy);
    return { dx: signX * mag, dy: signY * mag };
  };

  const segmentMidpointPercent = useMemo(() => {
    if (selectedSegment === null || !selectedRoom?.roomShell?.points?.length) return null;
    const pts = selectedRoom.roomShell.points;
    const a = pts[selectedSegment];
    const b = pts[(selectedSegment + 1) % pts.length];
    if (!a || !b) return null;
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const range = rangeMm || 6000;
    const viewX = HALF + toCanvas(midX, range);
    const viewY = HALF + toCanvas(midY, range);
    return { left: (viewX / CANVAS_SIZE) * 100, top: (viewY / CANVAS_SIZE) * 100 };
  }, [selectedSegment, selectedRoom?.roomShell?.points, rangeMm]);

  const adjustSegmentLength = (meters: number) => {
    if (selectedSegment === null || !selectedRoom?.roomShell?.points) return;
    const pts = selectedRoom.roomShell.points;
    if (pts.length < 2) return;
    const start = pts[selectedSegment];
    const end = pts[(selectedSegment + 1) % pts.length];
    if (!start || !end) return;
    const currentLen = Math.hypot(end.x - start.x, end.y - start.y) || 1;
    const desired = Math.max(0.1, meters) * 1000;
    const scale = desired / currentLen;
    const dx = (end.x - start.x) * scale;
    const dy = (end.y - start.y) * scale;
    const newEnd = { x: start.x + dx, y: start.y + dy };
    const nextPoints = [...pts];
    nextPoints[(selectedSegment + 1) % pts.length] = newEnd;
    handlePointsChange(nextPoints);
  };

  const nudgeSegmentLength = (deltaMeters: number) => {
    if (selectedSegment === null || !selectedRoom?.roomShell?.points) return;
    const pts = selectedRoom.roomShell.points;
    if (pts.length < 2) return;
    const start = pts[selectedSegment];
    const end = pts[(selectedSegment + 1) % pts.length];
    if (!start || !end) return;
    const currentLen = Math.hypot(end.x - start.x, end.y - start.y) || 1;
    const desired = Math.max(0.1, currentLen / 1000 + deltaMeters);
    adjustSegmentLength(desired);
  };

  const offsetSegmentNormal = (meters: number) => {
    if (selectedSegment === null || !selectedRoom?.roomShell?.points) return;
    const pts = selectedRoom.roomShell.points;
    if (pts.length < 2) return;
    const aIdx = selectedSegment;
    const bIdx = (selectedSegment + 1) % pts.length;
    const a = pts[aIdx];
    const b = pts[bIdx];
    if (!a || !b) return;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * (meters * 1000);
    const ny = (dx / len) * (meters * 1000);
    const next = pts.map((p) => ({ ...p }));
    next[aIdx] = { x: a.x + nx, y: a.y + ny };
    next[bIdx] = { x: b.x + nx, y: b.y + ny };
    handlePointsChange(next);
  };

  const handleCanvasClick = (pt: { x: number; y: number }) => {
    // If drawing, use the wall drawing hook's handler
    if (isDrawingWall) {
      wallDrawingClick(pt);
      return;
    }
    // If not drawing, treat as deselect interaction
    setSelectedSegment(null);
    setHoveredSegment(null);
  };

  const snapPointToGrid = (pt: { x: number; y: number }) => {
    if (!snapGridMm || snapGridMm <= 0) return pt;
    const step = snapGridMm;
    return {
      x: Math.round(pt.x / step) * step,
      y: Math.round(pt.y / step) * step,
    };
  };

  const handleCanvasMove = (pt: { x: number; y: number }) => {
    setCursorPos(pt);
    if (pendingStart) {
      const dx = pt.x - pendingStart.x;
      const dy = pt.y - pendingStart.y;
      setCursorDelta({ dx, dy, len: Math.hypot(dx, dy) });
    } else {
      setCursorDelta(null);
    }

    // Handle door dragging
    if (doorDrag) {
      handleDoorDragMove(pt.x, pt.y);
      return;
    }

    if (endpointDrag && selectedRoom) {
      let dx = pt.x - endpointDrag.start.x;
      let dy = pt.y - endpointDrag.start.y;
      ({ dx, dy } = snapDelta(dx, dy));
      const next = endpointDrag.base.map((p) => ({ x: p.x, y: p.y }));
      if (!next.length) return;
      const targetIdx =
        endpointDrag.endpoint === 'start' ? endpointDrag.segment : (endpointDrag.segment + 1) % next.length;
      const snappedTarget = snapPointToGrid({
        x: endpointDrag.base[targetIdx].x + dx,
        y: endpointDrag.base[targetIdx].y + dy,
      });
      // apply snapped delta relative to base so shape stays consistent
      const adjDx = snappedTarget.x - endpointDrag.base[targetIdx].x;
      const adjDy = snappedTarget.y - endpointDrag.base[targetIdx].y;
      next[targetIdx] = { x: endpointDrag.base[targetIdx].x + adjDx, y: endpointDrag.base[targetIdx].y + adjDy };
      handlePointsChange(next);
      return;
    }

    // If dragging a segment, move both endpoints together.
    if (segmentDragIndex !== null && segmentDragStart && segmentDragBase && selectedRoom) {
      let dx = pt.x - segmentDragStart.x;
      let dy = pt.y - segmentDragStart.y;
      ({ dx, dy } = snapDelta(dx, dy));
      const next = segmentDragBase.map((p) => ({ x: p.x, y: p.y }));
      const aIdx = segmentDragIndex;
      const bIdx = (segmentDragIndex + 1) % next.length;
      const snappedA = snapPointToGrid({ x: segmentDragBase[aIdx].x + dx, y: segmentDragBase[aIdx].y + dy });
      const snappedB = snapPointToGrid({ x: segmentDragBase[bIdx].x + dx, y: segmentDragBase[bIdx].y + dy });
      next[aIdx] = snappedA;
      next[bIdx] = snappedB;
      handlePointsChange(next);
      return;
    }

    // If drawing walls, use the hook's handler
    if (isDrawingWall) {
      wallDrawingMove(pt);
    }
  };

  const handleSaveRoom = async () => {
    if (!selectedRoom) return;
    setSaving(true);
    try {
      const result = await updateRoom(selectedRoom.id, selectedRoom);
      setRooms((prev) => prev.map((r) => (r.id === selectedRoom.id ? result.room : r)));
      onWizardProgress?.({ outlineDone: true, placementDone: true });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save room');
    } finally {
      setSaving(false);
    }
  };

  const handleAutoZoom = useCallback(() => {
    if (!selectedRoom?.roomShell?.points?.length) {
      setZoom(1);
      setPanOffsetMm({ x: 0, y: 0 });
      return;
    }
    const pts = selectedRoom.roomShell.points;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const pad = 500; // mm margin
    const width = Math.max(100, maxX - minX + pad * 2);
    const height = Math.max(100, maxY - minY + pad * 2);
    const maxDim = Math.max(width, height);
    // zoom formula: target canvas coverage ~80%
    const targetZoom = Math.min(5, Math.max(0.1, (0.8 * rangeMm) / maxDim));
    setZoom(targetZoom);
    setPanOffsetMm({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
  }, [selectedRoom, rangeMm]);

  // Auto-zoom when room loads
  useEffect(() => {
    if (selectedRoom?.roomShell?.points?.length) {
      handleAutoZoom();
    }
  }, [selectedRoom?.id, handleAutoZoom]);

  return (
    <div className="fixed inset-0 bg-slate-950 overflow-hidden">
      {/* Error Toast */}
      {error && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-50 max-w-lg rounded-xl border border-rose-500/50 bg-rose-500/10 backdrop-blur px-6 py-3 text-rose-100 shadow-xl animate-in slide-in-from-top-4 fade-in">
          {error}
        </div>
      )}

      {/* Navigation (top left) */}
      {onBack && !onNavigate && (
        <button
          onClick={onBack}
          className="absolute top-6 left-6 z-40 group rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur px-4 py-2.5 text-sm font-semibold text-slate-100 shadow-lg transition-all hover:border-slate-600 hover:bg-slate-800 hover:shadow-xl active:scale-95"
        >
          <span className="inline-block transition-transform group-hover:-translate-x-0.5">←</span> Back
        </button>
      )}

      {onNavigate && (
        <div className={`absolute top-6 left-6 ${showNavMenu ? 'z-[60]' : 'z-40'}`}>
          <button
            onClick={() => setShowNavMenu(!showNavMenu)}
            className="group rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur px-4 py-2.5 text-sm font-semibold text-slate-100 shadow-lg transition-all hover:border-slate-600 hover:bg-slate-800 hover:shadow-xl active:scale-95"
          >
            <span className="inline-block transition-transform group-hover:rotate-90">☰</span> Menu
          </button>

          {showNavMenu && (
            <>
              {/* Backdrop to close menu */}
              <div
                className="fixed inset-0 z-30"
                onClick={() => setShowNavMenu(false)}
              />

              {/* Menu dropdown */}
              <div className="absolute top-14 left-0 z-50 min-w-[200px] rounded-xl border border-slate-700/50 bg-slate-900/95 backdrop-blur shadow-2xl overflow-hidden">
                <div className="p-2 space-y-1">
                  <button
                    onClick={() => {
                      onNavigate('liveDashboard');
                      setShowNavMenu(false);
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm font-medium text-slate-100 rounded-lg transition-all hover:bg-aqua-600/20 hover:text-aqua-400 active:scale-95"
                  >
                    📡 Live Dashboard
                  </button>
                  <button
                    onClick={() => {
                      onNavigate('wizard');
                      setShowNavMenu(false);
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm font-medium text-slate-100 rounded-lg transition-all hover:bg-aqua-600/20 hover:text-aqua-400 active:scale-95"
                  >
                    ➕ Add Device
                  </button>
                  <button
                    onClick={() => {
                      onNavigate('zoneEditor');
                      setShowNavMenu(false);
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm font-medium text-slate-100 rounded-lg transition-all hover:bg-aqua-600/20 hover:text-aqua-400 active:scale-95"
                  >
                    📐 Zone Editor
                  </button>
                  <button
                    onClick={() => {
                      onNavigate('settings');
                      setShowNavMenu(false);
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm font-medium text-slate-100 rounded-lg transition-all hover:bg-aqua-600/20 hover:text-aqua-400 active:scale-95"
                  >
                    ⚙️ Settings
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Floating Save Button (top right) */}
      <button
        onClick={handleSaveRoom}
        disabled={saving}
        className="absolute top-6 right-6 z-40 rounded-xl bg-gradient-to-r from-aqua-600 to-aqua-500 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-aqua-500/30 transition-all hover:shadow-xl hover:shadow-aqua-500/40 disabled:opacity-50 active:scale-95"
      >
        {saving ? 'Saving...' : 'Save Room'}
      </button>

      {/* Canvas Content - Full Page */}
      {!selectedRoom && (
        <div className="flex h-full w-full items-center justify-center">
          <div className="max-w-md rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-900 to-slate-800 p-8 shadow-2xl">
            <div className="text-center space-y-4">
              <div className="text-6xl">🏗️</div>
              <h2 className="text-2xl font-bold text-white">No Room Selected</h2>
              <p className="text-sm text-slate-300">Select a room from the controls to start drawing walls.</p>
            </div>
          </div>
        </div>
      )}

      {selectedRoom && (
        <div
          className="h-full w-full overflow-hidden overscroll-contain touch-none"
          onWheelCapture={(e) => {
            if (e.cancelable) e.preventDefault();
            if ((e.nativeEvent as any)?.cancelable) {
              (e.nativeEvent as any).preventDefault();
            }
            e.stopPropagation();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            setZoom((z) => Math.min(5, Math.max(0.1, z + delta)));
          }}
        >
                <RoomCanvas
                  points={selectedRoom.roomShell?.points ?? []}
                  onChange={handlePointsChange}
                  onAddPoint={undefined}
                  onCanvasClick={handleCanvasClick}
                  onCanvasMove={handleCanvasMove}
                  onCanvasRelease={() => {
                    setSegmentDragIndex(null);
                    setSegmentDragStart(null);
                    setSegmentDragBase(null);
                    setEndpointDrag(null);
                    setCursorPos(null);
                    setCursorDelta(null);
                    handleDoorDragEnd();
                  }}
                  rangeMm={rangeMm}
                  gridSpacingMm={1000}
                  snapGridMm={snapGridMm}
                  zoom={zoom}
                  panOffsetMm={panOffsetMm}
                  onPanChange={(next) => setPanOffsetMm(next)}
                  displayUnits={displayUnits}
                  devicePlacement={
                    selectedRoom.devicePlacement ?? {
                      x: 0,
                      y: 0,
                      rotationDeg: 0,
                    }
                  }
                  onDeviceChange={(placement) => {
                    if (!selectedRoom) return;
                    const nextRoom: RoomConfig = { ...selectedRoom, devicePlacement: placement };
                    setRooms((prev) => prev.map((r) => (r.id === selectedRoom.id ? nextRoom : r)));
                  }}
                  fieldOfViewDeg={selectedProfile?.limits?.fieldOfViewDegrees}
                  maxRangeMeters={selectedProfile?.limits?.maxRangeMeters}
                  deviceIconUrl={selectedProfile?.iconUrl}
                  clipRadarToWalls={clipRadarToWalls}
                  previewFrom={pendingStart}
                  previewTo={pendingStart && previewPoint ? previewPoint : null}
                  hoveredSegment={hoveredSegment}
                  selectedSegment={selectedSegment}
                  onSegmentHover={(idx) => setHoveredSegment(idx)}
                  onSegmentSelect={(idx) => {
                    setSelectedSegment(idx);
                    setSegmentDragIndex(null);
                    setSegmentDragStart(null);
                    setSegmentDragBase(null);
                    setEndpointDrag(null);
                  }}
                  onSegmentDragStart={(idx, start) => {
                    const pts = selectedRoom?.roomShell?.points ?? [];
                    if (!pts.length) return;
                    setSegmentDragIndex(idx);
                    setSegmentDragStart(start);
                    setSegmentDragBase(pts);
                    setEndpointDrag(null);
                  }}
                  onEndpointDragStart={(segment, endpoint, start) => {
                    const pts = selectedRoom?.roomShell?.points ?? [];
                    if (!pts.length) return;
                    setEndpointDrag({ segment, endpoint, start, base: pts });
                    setSegmentDragIndex(null);
                    setSegmentDragStart(null);
                    setSegmentDragBase(null);
                  }}
                  height="100%"
                  furniture={selectedRoom.furniture ?? []}
                  selectedFurnitureId={selectedFurnitureId}
                  onFurnitureSelect={(id) => {
                    setSelectedFurnitureId(id);
                    setShowFurnitureLibrary(false);
                  }}
                  onFurnitureChange={handleFurnitureChange}
                  doors={selectedRoom.doors ?? []}
                  selectedDoorId={selectedDoorId}
                  onDoorSelect={setSelectedDoorId}
                  onDoorChange={handleDoorChange}
                  isDoorPlacementMode={isDoorPlacementMode}
                  onWallSegmentClick={handleWallSegmentClick}
                  onDoorDragStart={handleDoorDragStart}
                  onDoorDragMove={handleDoorDragMove}
                  onDoorDragEnd={handleDoorDragEnd}
                  roomShellFillMode={selectedRoom.roomShellFillMode}
                  floorMaterial={selectedRoom.floorMaterial}
                  showWalls={showWalls}
                  showFurniture={showFurniture}
                  showDoors={showDoors}
                  showDevice={showDeviceIcon}
                />
          {/* Floating Room Selector (top center) */}
          <div className="absolute top-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur px-4 py-2.5 text-sm text-slate-200 shadow-xl">
            <span className="text-slate-400 font-medium">Room:</span>
            <select
              className="rounded-lg border border-slate-700 bg-slate-800/70 px-3 py-1.5 text-slate-100 transition-colors focus:border-aqua-500 focus:ring-1 focus:ring-aqua-500/50 focus:outline-none font-medium"
              value={selectedRoomId ?? ''}
              onChange={(e) => {
                const roomId = e.target.value || null;
                setSelectedRoomId(roomId);
                const room = rooms.find((r) => r.id === roomId);
                if (room?.profileId) setSelectedProfileId(room.profileId);
              }}
            >
              <option value="">Select room</option>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </select>
          </div>

          {/* Drawing Controls (left side) */}
          <div className="absolute top-24 left-6 z-40 rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur p-3 shadow-xl">
            <div className="flex flex-col gap-2 text-sm">
              <button
                className={`rounded-xl border px-4 py-2.5 font-semibold shadow-lg transition-all active:scale-95 ${
                  isDrawingWall
                    ? 'border-aqua-600/50 bg-aqua-600/20 text-aqua-100 hover:bg-aqua-600/30'
                    : 'border-slate-700/50 bg-slate-800/50 text-slate-200 hover:border-slate-600'
                }`}
                onClick={() => setIsDrawingWall((prev) => !prev)}
              >
                {isDrawingWall ? '✕ Stop (Esc)' : '✏️ Add wall (A)'}
              </button>
              <button
                className="rounded-xl border border-emerald-600/50 bg-emerald-600/10 px-4 py-2.5 font-semibold text-emerald-100 shadow-lg transition-all hover:bg-emerald-600/20 disabled:opacity-40 active:scale-95"
                onClick={handleCloseLoop}
                disabled={!selectedRoom || (selectedRoom.roomShell?.points?.length ?? 0) < 2}
              >
                ✓ Finish (Enter)
              </button>
              <button
                className="rounded-xl border border-amber-600/50 bg-amber-600/10 px-4 py-2.5 font-semibold text-amber-100 shadow-lg transition-all hover:bg-amber-600/20 disabled:opacity-40 active:scale-95"
                onClick={removeLastPoint}
                disabled={!selectedRoom || !(selectedRoom.roomShell?.points?.length)}
              >
                ↶ Undo (Del)
              </button>
              <button
                className="rounded-xl border border-rose-600/50 bg-rose-600/10 px-4 py-2.5 font-semibold text-rose-100 shadow-lg transition-all hover:bg-rose-600/20 disabled:opacity-40 active:scale-95"
                onClick={handleClear}
                disabled={!selectedRoom}
              >
                🗑️ Clear
              </button>

              {/* Furniture Button */}
              <div className="border-t border-slate-700/50 my-2"></div>
              <button
                className={`rounded-xl border px-4 py-2.5 font-semibold shadow-lg transition-all active:scale-95 ${
                  showFurnitureLibrary
                    ? 'border-purple-600/50 bg-purple-600/20 text-purple-100'
                    : 'border-slate-700/50 bg-slate-800/50 text-slate-200 hover:border-slate-600'
                }`}
                onClick={() => {
                  setShowFurnitureLibrary((v) => !v);
                  setSelectedFurnitureId(null); // Close furniture settings when opening library
                }}
                disabled={!selectedRoom}
              >
                🪑 Add Furniture
              </button>

              <button
                className={`rounded-xl border px-4 py-2.5 font-semibold shadow-lg transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${
                  isDoorPlacementMode
                    ? 'border-aqua-600/50 bg-aqua-600/20 text-aqua-100 hover:bg-aqua-600/30'
                    : 'border-slate-700/50 bg-slate-800/50 text-slate-200 hover:border-slate-600'
                }`}
                onClick={handleAddDoor}
                disabled={!selectedRoom || !selectedRoom.roomShell?.points || selectedRoom.roomShell.points.length < 3}
              >
                {isDoorPlacementMode ? '✕ Cancel' : '🚪 Add Door'}
              </button>

              <button
                className={`rounded-xl border px-4 py-2.5 font-semibold shadow-lg transition-all active:scale-95 ${
                  showSettings
                    ? 'border-aqua-600/50 bg-aqua-600/20 text-aqua-100'
                    : 'border-slate-700/50 bg-slate-800/50 text-slate-200 hover:border-slate-600'
                }`}
                onClick={() => setShowSettings((v) => !v)}
              >
                ⚙️ Settings
              </button>
            </div>
          </div>

          {/* Floating Zoom Controls (bottom right) */}
          <div className="absolute bottom-6 right-6 z-40 flex flex-col gap-2">
            <button
              className="rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur px-4 py-2.5 text-sm font-semibold text-slate-100 shadow-lg transition-all hover:border-slate-600 hover:bg-slate-800 hover:shadow-xl active:scale-95"
              onClick={() => setZoom((z) => Math.min(5, z + 0.1))}
            >
              Zoom +
            </button>
            <button
              className="rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur px-4 py-2.5 text-sm font-semibold text-slate-100 shadow-lg transition-all hover:border-slate-600 hover:bg-slate-800 hover:shadow-xl active:scale-95"
              onClick={() => setZoom((z) => Math.max(0.1, z - 0.1))}
            >
              Zoom -
            </button>
            <button
              className="rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur px-4 py-2.5 text-sm font-semibold text-slate-100 shadow-lg transition-all hover:border-slate-600 hover:bg-slate-800 hover:shadow-xl active:scale-95"
              onClick={() => setZoom(1)}
            >
              Reset
            </button>
            <button
              className="rounded-xl border border-aqua-600/50 bg-aqua-600/10 backdrop-blur px-4 py-2.5 text-sm font-semibold text-aqua-100 shadow-lg transition-all hover:bg-aqua-600/20 hover:shadow-xl active:scale-95"
              onClick={handleAutoZoom}
            >
              Auto Zoom
            </button>
          </div>

          {/* Settings Panel */}
          {showSettings && (
            <div className="absolute top-24 right-6 z-50 w-96 max-w-full rounded-xl border border-slate-700/50 bg-slate-900/95 backdrop-blur p-4 text-sm text-slate-100 shadow-2xl space-y-3 animate-in slide-in-from-right-4 fade-in duration-200">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-100">Settings</span>
                        <button
                          className="rounded-md border border-slate-700 px-2 py-1 hover:border-aqua-500"
                          onClick={() => setShowSettings(false)}
                        >
                          Close
                        </button>
                      </div>

                      <div className="space-y-1">
                        <div className="font-semibold text-slate-200">Canvas</div>
                        <label className="flex items-center gap-2">
                          <span className="w-16">Snap (mm)</span>
                          <input
                            type="number"
                            className="w-20 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-slate-100 focus:border-aqua-500 focus:ring-1 focus:ring-aqua-500/50 focus:outline-none"
                            value={snapGridMm}
                            onChange={(e) => setSnapGridMm(Math.max(0, Number(e.target.value) || 0))}
                            min={0}
                            step={50}
                          />
                          <span className="text-slate-400">0=off</span>
                        </label>
                        <div className="flex flex-wrap gap-1">
                          {[0, 50, 100, 200].map((v) => (
                            <button
                              key={v}
                              className={`rounded-md border px-2 py-1 ${
                                snapGridMm === v ? 'border-aqua-500 text-aqua-100' : 'border-slate-700 text-slate-200'
                              }`}
                              onClick={() => setSnapGridMm(v)}
                            >
                              {v === 0 ? 'Off' : `${v}mm`}
                            </button>
                          ))}
                        </div>
                        <div className="flex gap-1">
                          <button
                            className={`rounded-md border px-2 py-1 ${
                              displayUnits === 'metric' ? 'border-aqua-500 text-aqua-100' : 'border-slate-700 text-slate-200'
                            }`}
                            onClick={() => setDisplayUnits('metric')}
                          >
                            Metric
                          </button>
                          <button
                            className={`rounded-md border px-2 py-1 ${
                              displayUnits === 'imperial' ? 'border-aqua-500 text-aqua-100' : 'border-slate-700 text-slate-200'
                            }`}
                            onClick={() => setDisplayUnits('imperial')}
                          >
                            Imperial
                          </button>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="font-semibold text-slate-200">Device placement</div>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="flex items-center gap-2">
                            <span className="w-6">X</span>
                            <input
                              type="number"
                              className="w-full rounded-md border border-slate-700 bg-slate-800/70 px-2 py-1 text-slate-100 focus:border-aqua-500 focus:ring-1 focus:ring-aqua-500/50 focus:outline-none"
                              value={selectedRoom?.devicePlacement?.x ?? 0}
                              onChange={(e) => {
                                if (!selectedRoom) return;
                                const placement = { ...(selectedRoom.devicePlacement ?? { x: 0, y: 0, rotationDeg: 0 }) };
                                placement.x = Number(e.target.value) || 0;
                                const nextRoom: RoomConfig = { ...selectedRoom, devicePlacement: placement };
                                setRooms((prev) => prev.map((r) => (r.id === selectedRoom.id ? nextRoom : r)));
                              }}
                            />
                          </label>
                          <label className="flex items-center gap-2">
                            <span className="w-6">Y</span>
                            <input
                              type="number"
                              className="w-full rounded-md border border-slate-700 bg-slate-800/70 px-2 py-1 text-slate-100 focus:border-aqua-500 focus:ring-1 focus:ring-aqua-500/50 focus:outline-none"
                              value={selectedRoom?.devicePlacement?.y ?? 0}
                              onChange={(e) => {
                                if (!selectedRoom) return;
                                const placement = { ...(selectedRoom.devicePlacement ?? { x: 0, y: 0, rotationDeg: 0 }) };
                                placement.y = Number(e.target.value) || 0;
                                const nextRoom: RoomConfig = { ...selectedRoom, devicePlacement: placement };
                                setRooms((prev) => prev.map((r) => (r.id === selectedRoom.id ? nextRoom : r)));
                              }}
                            />
                          </label>
                        </div>
                        <label className="flex items-center gap-2">
                          <span className="w-14">Rotation</span>
                          <input
                            type="range"
                            min={-180}
                            max={180}
                            step={1}
                            value={selectedRoom?.devicePlacement?.rotationDeg ?? 0}
                            onChange={(e) => {
                              if (!selectedRoom) return;
                              const placement = { ...(selectedRoom.devicePlacement ?? { x: 0, y: 0, rotationDeg: 0 }) };
                              placement.rotationDeg = Number(e.target.value) || 0;
                              const nextRoom: RoomConfig = { ...selectedRoom, devicePlacement: placement };
                              setRooms((prev) => prev.map((r) => (r.id === selectedRoom.id ? nextRoom : r)));
                            }}
                            className="w-full"
                          />
                          <span>{selectedRoom?.devicePlacement?.rotationDeg ?? 0}</span>
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            className="rounded-md border border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-100 transition hover:border-aqua-500"
                            onClick={() => {
                              if (!selectedRoom) return;
                              const nextRoom: RoomConfig = {
                                ...selectedRoom,
                                devicePlacement: { ...(selectedRoom.devicePlacement ?? {}), x: 0, y: 0 },
                              };
                              setRooms((prev) => prev.map((r) => (r.id === selectedRoom.id ? nextRoom : r)));
                            }}
                            disabled={!selectedRoom}
                          >
                            Center
                          </button>
                          <button
                            className="rounded-md border border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-100 transition hover:border-aqua-500"
                            onClick={() => {
                              if (!selectedRoom) return;
                              const nextRoom: RoomConfig = {
                                ...selectedRoom,
                                devicePlacement: { ...(selectedRoom.devicePlacement ?? {}), rotationDeg: 0 },
                              };
                              setRooms((prev) => prev.map((r) => (r.id === selectedRoom.id ? nextRoom : r)));
                            }}
                            disabled={!selectedRoom}
                          >
                            Reset rot
                          </button>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="font-semibold text-slate-200">Floor Material</div>
                        <label className="flex items-center gap-2">
                          <span className="w-16">Fill Mode</span>
                          <select
                            className="w-full rounded-md border border-slate-700 bg-slate-800/70 px-2 py-1 text-slate-100 focus:border-aqua-500 focus:ring-1 focus:ring-aqua-500/50 focus:outline-none"
                            value={selectedRoom?.roomShellFillMode ?? 'overlay'}
                            onChange={(e) => {
                              if (!selectedRoom) return;
                              const nextRoom: RoomConfig = { ...selectedRoom, roomShellFillMode: e.target.value as 'overlay' | 'material' };
                              setRooms((prev) => prev.map((r) => (r.id === selectedRoom.id ? nextRoom : r)));
                            }}
                          >
                            <option value="overlay">Blue Overlay</option>
                            <option value="material">Floor Material</option>
                          </select>
                        </label>
                        {selectedRoom?.roomShellFillMode === 'material' && (
                          <label className="flex items-center gap-2">
                            <span className="w-16">Material</span>
                            <select
                              className="w-full rounded-md border border-slate-700 bg-slate-800/70 px-2 py-1 text-slate-100 focus:border-aqua-500 focus:ring-1 focus:ring-aqua-500/50 focus:outline-none"
                              value={selectedRoom?.floorMaterial ?? 'none'}
                              onChange={(e) => {
                                if (!selectedRoom) return;
                                const nextRoom: RoomConfig = { ...selectedRoom, floorMaterial: e.target.value as any };
                                setRooms((prev) => prev.map((r) => (r.id === selectedRoom.id ? nextRoom : r)));
                              }}
                            >
                              {Object.entries(FLOOR_MATERIALS).map(([key, material]) => (
                                <option key={key} value={key}>
                                  {material.emoji} {material.label}
                                </option>
                              ))}
                              <option value="none">⬜ None (transparent)</option>
                            </select>
                          </label>
                        )}
                      </div>

                      {/* Room Element Visibility */}
                      <div className="space-y-2">
                        <div className="font-semibold text-slate-200">Room Elements</div>
                        <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-200 hover:text-white transition-colors">
                          <input
                            type="checkbox"
                            checked={showWalls}
                            onChange={(e) => setShowWalls(e.target.checked)}
                            className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-0"
                          />
                          <span className="flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded border border-cyan-400 bg-cyan-500/30"></span>
                            Walls
                          </span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-200 hover:text-white transition-colors">
                          <input
                            type="checkbox"
                            checked={showFurniture}
                            onChange={(e) => setShowFurniture(e.target.checked)}
                            className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-amber-500 focus:ring-amber-500 focus:ring-offset-0"
                          />
                          <span className="flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded bg-amber-600"></span>
                            Furniture
                          </span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-200 hover:text-white transition-colors">
                          <input
                            type="checkbox"
                            checked={showDoors}
                            onChange={(e) => setShowDoors(e.target.checked)}
                            className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-orange-500 focus:ring-orange-500 focus:ring-offset-0"
                          />
                          <span className="flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded bg-orange-700"></span>
                            Doors
                          </span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-200 hover:text-white transition-colors">
                          <input
                            type="checkbox"
                            checked={showDeviceIcon}
                            onChange={(e) => setShowDeviceIcon(e.target.checked)}
                            className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-green-500 focus:ring-green-500 focus:ring-offset-0"
                          />
                          <span className="flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded-full bg-green-500"></span>
                            Device Icon
                          </span>
                        </label>
                      </div>
                    </div>
                  )}

          {/* Floating Info Bar (bottom left) */}
          <div className="absolute bottom-6 left-6 z-40 rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur px-4 py-3 shadow-xl max-w-xl">
            <div className="flex flex-col gap-2 text-xs text-slate-200">
              <div className="flex items-center gap-4">
                <span className="text-slate-400 font-medium">Cursor:</span>
                <span>
                  X {cursorPos ? (cursorPos.x / (displayUnits === 'imperial' ? 304.8 : 1000)).toFixed(2) : '--'}{' '}
                  {displayUnits === 'imperial' ? 'ft' : 'm'}, Y{' '}
                  {cursorPos ? (cursorPos.y / (displayUnits === 'imperial' ? 304.8 : 1000)).toFixed(2) : '--'}{' '}
                  {displayUnits === 'imperial' ? 'ft' : 'm'}
                </span>
                {cursorDelta && (
                  <span className="text-aqua-200">
                    Δ {cursorDelta.dx.toFixed(0)} / {cursorDelta.dy.toFixed(0)} mm (
                    {displayUnits === 'imperial'
                      ? (cursorDelta.len / 304.8).toFixed(2)
                      : (cursorDelta.len / 1000).toFixed(2)}{' '}
                    {displayUnits === 'imperial' ? 'ft' : 'm'})
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-slate-400 font-medium">Snap:</span>
                {[0, 50, 100, 200].map((v) => (
                  <button
                    key={v}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition-all active:scale-95 ${
                      snapGridMm === v
                        ? 'border-aqua-500 bg-aqua-500/20 text-aqua-100 shadow-lg shadow-aqua-500/20'
                        : 'border-slate-700 bg-slate-800/50 text-slate-200 hover:border-slate-600'
                    }`}
                    onClick={() => setSnapGridMm(v)}
                  >
                    {v === 0 ? 'Off' : `${v}mm`}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-slate-400 font-medium">Units:</span>
                <button
                  className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition-all active:scale-95 ${
                    displayUnits === 'metric'
                      ? 'border-aqua-500 bg-aqua-500/20 text-aqua-100'
                      : 'border-slate-700 bg-slate-800/50 text-slate-200 hover:border-slate-600'
                  }`}
                  onClick={() => setDisplayUnits('metric')}
                >
                  Metric
                </button>
                <button
                  className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition-all active:scale-95 ${
                    displayUnits === 'imperial'
                      ? 'border-aqua-500 bg-aqua-500/20 text-aqua-100'
                      : 'border-slate-700 bg-slate-800/50 text-slate-200 hover:border-slate-600'
                  }`}
                  onClick={() => setDisplayUnits('imperial')}
                >
                  Imperial
                </button>
              </div>
              <div className="text-[10px] text-slate-500">
                Tips: A to draw, Enter to finish, Esc to cancel, Del to undo
              </div>
            </div>
          </div>
                {selectedSegment !== null && segmentMidpointPercent && (
                  <div
                    className="pointer-events-auto absolute z-10"
                    style={{
                      left: `${segmentMidpointPercent.left}%`,
                      top: `${segmentMidpointPercent.top}%`,
                      transform: 'translate(-50%, -120%)',
                    }}
                  >
                    <div className="rounded-lg border border-slate-800 bg-slate-900/90 p-2 shadow-xl">
                      <div className="flex items-center gap-2 text-xs text-slate-200">
                        {(() => {
                          const pts = selectedRoom.roomShell?.points ?? [];
                          const a = pts[selectedSegment];
                          const b = pts[(selectedSegment + 1) % pts.length];
                          const lenMeters = a && b ? Math.hypot(b.x - a.x, b.y - a.y) / 1000 : 0;
                          const lengthUnit = displayUnits === 'imperial' ? 'ft' : 'm';
                          const lengthValue = displayUnits === 'imperial' ? lenMeters * 3.28084 : lenMeters;
                          const nudgeStepMeters = displayUnits === 'imperial' ? 0.1 * 0.3048 : 0.05; // 0.1ft or 0.05m
                          const nudgeLabel = displayUnits === 'imperial' ? '0.10 ft' : '0.05 m';
                          const offsetStepMeters = 0.1; // keep physical 0.1m, just display units
                          const offsetLabel =
                            displayUnits === 'imperial'
                              ? `${(offsetStepMeters * 3.28084).toFixed(2)} ft`
                              : `${offsetStepMeters.toFixed(2)} m`;
                          return (
                            <>
                              <span>Length ({lengthUnit})</span>
                              <input
                                type="number"
                                className="w-20 rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-xs text-white focus:border-aqua-500 focus:ring-1 focus:ring-aqua-500/50 focus:outline-none"
                                value={lengthValue.toFixed(2)}
                                onChange={(e) => {
                                  const raw = Number(e.target.value);
                                  const meters = displayUnits === 'imperial' ? raw * 0.3048 : raw;
                                  adjustSegmentLength(Math.max(0.1, meters));
                                }}
                              />
                              <button
                                className="rounded-md border border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-100 hover:border-aqua-400"
                                onClick={() => nudgeSegmentLength(-nudgeStepMeters)}
                              >
                                -{nudgeLabel}
                              </button>
                              <button
                                className="rounded-md border border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-100 hover:border-aqua-400"
                                onClick={() => nudgeSegmentLength(nudgeStepMeters)}
                              >
                                +{nudgeLabel}
                              </button>
                              <button
                                className="rounded-md border border-slate-700 px-2 py-1 text-xs font-semibold text-slate-100 hover:border-amber-400"
                                onClick={() => {
                                  setSelectedSegment(null);
                                  setHoveredSegment(null);
                                }}
                              >
                                Close
                              </button>
                              <button
                                className="rounded-md border border-rose-500/70 px-2 py-1 text-xs font-semibold text-rose-100 hover:bg-rose-500/10"
                                onClick={() => {
                                  const ptsDelete = selectedRoom.roomShell?.points ?? [];
                                  if (ptsDelete.length <= 2) return;
                                  const removeIdx = (selectedSegment + 1) % ptsDelete.length;
                                  const nextDelete = ptsDelete.filter((_, idx) => idx !== removeIdx);
                                  handlePointsChange(nextDelete);
                                  setSelectedSegment(null);
                                  setHoveredSegment(null);
                                }}
                              >
                                Delete
                              </button>
                              <div className="flex items-center gap-2 pt-1 text-xs text-slate-200">
                                <span>Offset</span>
                                <button
                                  className="rounded-md border border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-100 hover:border-amber-400"
                                  onClick={() => offsetSegmentNormal(-offsetStepMeters)}
                                >
                                  -{offsetLabel}
                                </button>
                                <button
                                  className="rounded-md border border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-100 hover:border-amber-400"
                                  onClick={() => offsetSegmentNormal(offsetStepMeters)}
                                >
                                  +{offsetLabel}
                                </button>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                )}

          {/* Furniture Library Panel */}
          {showFurnitureLibrary && (
            <FurnitureLibrary
              onSelect={handleAddFurniture}
              onClose={() => setShowFurnitureLibrary(false)}
            />
          )}

          {/* Furniture Editor Panel */}
          {selectedFurniture && (
            <FurnitureEditor
              furniture={selectedFurniture}
              onChange={handleFurnitureChange}
              onDelete={handleFurnitureDelete}
              onClose={() => setSelectedFurnitureId(null)}
            />
          )}

          {/* Door Editor Panel */}
          {selectedDoor && (
            <DoorEditor
              door={selectedDoor}
              onChange={handleDoorChange}
              onDelete={handleDoorDelete}
              onClose={() => setSelectedDoorId(null)}
              maxSegmentIndex={(selectedRoom?.roomShell?.points?.length ?? 1) - 1}
              validation={doorValidation}
            />
          )}
        </div>
      )}
    </div>
  );
};


