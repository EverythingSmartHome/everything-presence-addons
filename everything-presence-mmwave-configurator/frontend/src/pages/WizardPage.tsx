import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { DiscoveredDevice, DeviceProfile, RoomConfig, ZoneRect, ZonePolygon, FurnitureInstance, FurnitureType, Door, EntityMappings } from '../api/types';
import { RoomCanvas, Point, DevicePlacement } from '../components/RoomCanvas';
import { ZoneCanvas } from '../components/ZoneCanvas';
import { ZoneEditor } from '../components/ZoneEditor';
import { FurnitureLibrary } from '../components/FurnitureLibrary';
import { FurnitureEditor } from '../components/FurnitureEditor';
import { DoorEditor } from '../components/DoorEditor';
import { ThemeSwitcher } from '../components/ThemeSwitcher';
import { EntityDiscovery } from '../components/EntityDiscovery';
import { updateRoom } from '../api/rooms';
import { useWallDrawing } from '../hooks/useWallDrawing';
import { pushZonesToDevice, fetchZonesFromDevice, fetchPolygonModeStatus, setPolygonMode, fetchPolygonZonesFromDevice, pushPolygonZonesToDevice, PolygonModeStatus } from '../api/zones';
import { fetchZoneAvailability, ingressAware } from '../api/client';
import { useDeviceMappings } from '../contexts/DeviceMappingsContext';
import { getEffectiveEntityPrefix } from '../utils/entityUtils';
import { getInstallationAngleSuggestion } from '../utils/rotationSuggestion';

interface WizardPageProps {
  devices: DiscoveredDevice[];
  profiles: DeviceProfile[];
  rooms: RoomConfig[];
  selectedDeviceId?: string | null;
  selectedProfileId?: string | null;
  onBack?: () => void;
  onCreateRoom: (name: string, deviceId: string | null, profileId: string | null, entityMappings?: EntityMappings) => Promise<RoomConfig>;
  onSelectRoom: (roomId: string | null, profileId?: string | null) => void;
  onGoRoomBuilder: (roomId: string | null, profileId?: string | null) => void;
  onGoZoneEditor: (roomId: string | null, profileId?: string | null) => void;
  onComplete: () => void;
  onRoomUpdate?: (room: RoomConfig) => void;
  initialStep?: string;
  onStepChange?: (key: StepKey) => void;
  outlineDone: boolean;
  placementDone: boolean;
  zonesReady: boolean;
  setOutlineDone: (val: boolean) => void;
  setPlacementDone: (val: boolean) => void;
  setZonesReady: (val: boolean) => void;
}

type StepKey =
  | 'device'
  | 'entityDiscovery'
  | 'roomChoice'
  | 'roomDetails'
  | 'outline'
  | 'doors'
  | 'furniture'
  | 'placement'
  | 'zones'
  | 'finish';

export const WizardPage: React.FC<WizardPageProps> = ({
  devices,
  profiles,
  rooms,
  selectedDeviceId = null,
  selectedProfileId = null,
  onBack,
  onCreateRoom,
  onSelectRoom,
  onGoRoomBuilder,
  onGoZoneEditor,
  onComplete,
  onRoomUpdate,
  initialStep = 'device',
  onStepChange,
  outlineDone,
  placementDone,
  zonesReady,
  setOutlineDone,
  setPlacementDone,
  setZonesReady,
}) => {
  const [deviceId, setDeviceId] = useState<string | null>(selectedDeviceId ?? null);
  const [profileId, setProfileId] = useState<string | null>(selectedProfileId ?? null);
  const [roomId, setRoomId] = useState<string | null>(rooms[0]?.id ?? null);
  const [roomPath, setRoomPath] = useState<'new' | 'existing' | 'skip' | null>(null);
  const [newRoomName, setNewRoomName] = useState('');
  const [units, setUnits] = useState<'metric' | 'imperial'>('metric');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pushingZones, setPushingZones] = useState(false);
  const [pushSuccess, setPushSuccess] = useState(false);

  // Entity discovery mappings (discovered after device selection)
  const [discoveredMappings, setDiscoveredMappings] = useState<EntityMappings | null>(null);

  // Canvas controls for embedded room drawing
  const [canvasZoom, setCanvasZoom] = useState(1.1);
  const [canvasSnap, setCanvasSnap] = useState(100);
  const [canvasPan, setCanvasPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Zone selection for embedded zone drawing
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);

  // Radar overlay clipping toggle
  const [clipRadarToWalls, setClipRadarToWalls] = useState(true);

  // Cursor position tracking
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);

  // Zone list panel visibility
  const [showZoneList, setShowZoneList] = useState(false);

  // Furniture and door state
  const [selectedFurnitureId, setSelectedFurnitureId] = useState<string | null>(null);
  const [showFurnitureLibrary, setShowFurnitureLibrary] = useState(false);
  const [selectedDoorId, setSelectedDoorId] = useState<string | null>(null);
  const [isDoorPlacementMode, setIsDoorPlacementMode] = useState(false);
  const [doorDrag, setDoorDrag] = useState<{
    doorId: string;
    startX: number;
    startY: number;
    originalPosition: number;
  } | null>(null);
  const [showRotationSuggestion, setShowRotationSuggestion] = useState(false);
  const [rotationSuggestion, setRotationSuggestion] = useState<{ suggestedAngle: number; targetAxis: number } | null>(null);
  const [applyingInstallationAngle, setApplyingInstallationAngle] = useState(false);
  const [rotationSuggestionError, setRotationSuggestionError] = useState<string | null>(null);
  const lastRotationSuggestionRef = useRef<number | null>(null);

  // Track which rooms have had zones loaded to prevent redundant fetches
  const zonesLoadedRef = useRef<Set<string>>(new Set());

  // Track when zone loading is complete for the current room (used to delay auto-enable Zone 1)
  const [zonesLoadingComplete, setZonesLoadingComplete] = useState<string | null>(null);

  const selectedRoom = useMemo(() => rooms.find((r) => r.id === roomId) ?? null, [rooms, roomId]);

  const handleRoomOutlineChange = useCallback(async (points: Point[]) => {
    if (!selectedRoom) return;
    const updatedRoom: RoomConfig = { ...selectedRoom, roomShell: { points } };
    // Optimistic update
    onRoomUpdate?.(updatedRoom);
    try {
      await updateRoom(selectedRoom.id, updatedRoom);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update room outline');
      // Revert on error
      onRoomUpdate?.(selectedRoom);
    }
  }, [selectedRoom, onRoomUpdate]);

  // Wall drawing hook
  const {
    isDrawingWall,
    pendingStart,
    previewPoint,
    handleCanvasClick: wallDrawingClick,
    handleCanvasMove: wallDrawingMove,
    setIsDrawingWall,
    stopDrawing,
    removeLastPoint,
  } = useWallDrawing({
    snapGridMm: canvasSnap,
    onPointsChange: handleRoomOutlineChange,
    currentPoints: selectedRoom?.roomShell?.points ?? [],
  });

  // Auto-select profile when device changes
  const selectedDevice = useMemo(() => devices.find((d) => d.id === deviceId) ?? null, [devices, deviceId]);

  // Define currentProfile before steps (to avoid initialization error)
  const currentProfile = useMemo(
    () => profiles.find((p) => p.id === (selectedRoom?.profileId ?? profileId ?? undefined)) ?? null,
    [profiles, profileId, selectedRoom?.profileId],
  );

  const isEplDevice = useMemo(() => {
    const caps = currentProfile?.capabilities as { tracking?: boolean; distanceOnlyTracking?: boolean } | undefined;
    return Boolean(caps?.tracking) && !caps?.distanceOnlyTracking;
  }, [currentProfile]);

  const resolveInstallationAngleEntityId = useCallback(() => {
    if (!selectedRoom) return null;
    const mappingEntity = selectedRoom.entityMappings?.installationAngleEntity;
    if (mappingEntity) return mappingEntity;

    const devicePrefix = selectedRoom.entityNamePrefix ?? selectedDevice?.entityNamePrefix;
    const prefix = getEffectiveEntityPrefix(selectedRoom.entityMappings, devicePrefix);
    if (!prefix) return null;
    return `number.${prefix}_installation_angle`;
  }, [selectedRoom, selectedDevice]);

  const handleRotationSuggestion = useCallback(
    (rotationDeg: number) => {
      if (!selectedRoom || !isEplDevice) return;
      const suggestion = getInstallationAngleSuggestion(rotationDeg, selectedRoom.roomShell?.points);
      if (!suggestion) return;
      if (lastRotationSuggestionRef.current === rotationDeg) return;

      const entityId = resolveInstallationAngleEntityId();
      if (!entityId) return;

      setRotationSuggestion({ suggestedAngle: suggestion.suggestedAngle, targetAxis: suggestion.targetAxis });
      setRotationSuggestionError(null);
      setShowRotationSuggestion(true);
      lastRotationSuggestionRef.current = rotationDeg;
    },
    [selectedRoom, isEplDevice, resolveInstallationAngleEntityId]
  );

  const applyInstallationAngleSuggestion = useCallback(async () => {
    if (!selectedRoom?.deviceId || !rotationSuggestion) return;
    const entityId = resolveInstallationAngleEntityId();
    if (!entityId) {
      setRotationSuggestionError('Installation angle entity could not be resolved for this device.');
      return;
    }

    setApplyingInstallationAngle(true);
    setRotationSuggestionError(null);
    try {
      const response = await fetch(ingressAware(`api/live/${selectedRoom.deviceId}/entity`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityId,
          value: rotationSuggestion.suggestedAngle,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update installation angle');
      }

      setShowRotationSuggestion(false);
    } catch (err) {
      setRotationSuggestionError('Failed to update installation angle.');
    } finally {
      setApplyingInstallationAngle(false);
    }
  }, [selectedRoom?.deviceId, rotationSuggestion, resolveInstallationAngleEntityId]);

  // Device mappings context - used to check if device has valid entity mappings
  const { hasValidMappings } = useDeviceMappings();
  const deviceHasValidMappings = selectedRoom?.deviceId ? hasValidMappings(selectedRoom.deviceId) : false;
  const isZeroSuggestion = rotationSuggestion?.suggestedAngle === 0;

  // State for feature availability (based on entity existence, not firmware version)
  const [entryZonesAvailable, setEntryZonesAvailable] = useState<boolean | null>(null);
  const [polygonZonesAvailable, setPolygonZonesAvailable] = useState<boolean | null>(null);

  // Polygon mode state
  const [polygonModeStatus, setPolygonModeStatus] = useState<PolygonModeStatus>({ supported: false, enabled: false });
  const [polygonZones, setPolygonZones] = useState<ZonePolygon[]>([]);
  const [showPolygonPrompt, setShowPolygonPrompt] = useState(false);
  const [togglingPolygonMode, setTogglingPolygonMode] = useState(false);
  // Track if we've already shown the polygon prompt for this room (prevents re-showing after dismiss)
  const polygonPromptShownRef = useRef<Set<string>>(new Set());

  // Reset polygon mode state when room/device changes
  useEffect(() => {
    setPolygonModeStatus({ supported: false, enabled: false });
    setPolygonZones([]);
    setShowPolygonPrompt(false);
    // Clear the prompt shown tracking so it can show again for the new room
    polygonPromptShownRef.current.clear();
  }, [selectedRoom?.id, selectedRoom?.deviceId]);

  // Fetch zone availability to check if advanced features are available
  useEffect(() => {
    const loadFeatureAvailability = async () => {
      const currentDeviceId = selectedRoom?.deviceId ?? deviceId;
      const currentProfileId = selectedRoom?.profileId ?? profileId;

      if (!currentDeviceId || !currentProfileId) {
        setEntryZonesAvailable(null);
        setPolygonZonesAvailable(null);
        return;
      }

      let entityNamePrefix = selectedRoom?.entityNamePrefix;
      if (!entityNamePrefix) {
        const device = devices.find(d => d.id === currentDeviceId);
        entityNamePrefix = device?.entityNamePrefix;
      }

      if (!entityNamePrefix) {
        setEntryZonesAvailable(null);
        setPolygonZonesAvailable(null);
        return;
      }

      try {
        // Skip entityMappings if device has valid mappings stored
        const entityMappingsToUse = deviceHasValidMappings ? undefined : selectedRoom?.entityMappings;
        const response = await fetchZoneAvailability(currentDeviceId, currentProfileId, entityNamePrefix, entityMappingsToUse);
        setEntryZonesAvailable(response.entryZonesAvailable);
        setPolygonZonesAvailable(response.polygonZonesAvailable);
      } catch {
        setEntryZonesAvailable(null);
        setPolygonZonesAvailable(null);
      }
    };

    loadFeatureAvailability();
  }, [selectedRoom?.deviceId, selectedRoom?.profileId, selectedRoom?.entityNamePrefix, selectedRoom?.entityMappings, deviceId, profileId, devices, deviceHasValidMappings]);

  // Dynamic steps based on room path
  const steps: StepKey[] = useMemo(() => {
    const base: StepKey[] = ['device', 'entityDiscovery', 'roomChoice'];

    // Check if current profile supports zones
    const supportsZones = currentProfile?.capabilities?.zones !== false;

    if (roomPath === 'skip') {
      // Skip room setup: device → entityDiscovery → roomChoice → (zones if supported) → finish
      return supportsZones ? [...base, 'zones', 'finish'] : [...base, 'finish'];
    }

    if (roomPath === 'existing') {
      // Use existing room: device → entityDiscovery → roomChoice → roomDetails → placement → (zones if supported) → finish
      return supportsZones
        ? [...base, 'roomDetails', 'placement', 'zones', 'finish']
        : [...base, 'roomDetails', 'placement', 'finish'];
    }

    // New room (default): device → entityDiscovery → roomChoice → roomDetails → outline → doors → furniture → placement → (zones if supported) → finish
    return supportsZones
      ? [...base, 'roomDetails', 'outline', 'doors', 'furniture', 'placement', 'zones', 'finish']
      : [...base, 'roomDetails', 'outline', 'doors', 'furniture', 'placement', 'finish'];
  }, [roomPath, currentProfile]);

  const [stepIndex, setStepIndex] = useState<number>(() => {
    // Initialize with default 'new' room path steps for initialStep lookup
    const defaultSteps: StepKey[] = ['device', 'entityDiscovery', 'roomChoice', 'roomDetails', 'outline', 'doors', 'furniture', 'placement', 'zones', 'finish'];
    const idx = defaultSteps.indexOf(initialStep as StepKey);
    return idx >= 0 ? idx : 0;
  });

  const currentStep = steps[stepIndex] ?? 'device';
  const isRoomMode = roomPath !== 'skip';

  // Generate all possible zone slots based on profile limits
  const allPossibleZones = useMemo(() => {
    if (!currentProfile) return [];
    const limits = currentProfile.limits;
    const zones: ZoneRect[] = [];

    // Regular zones
    for (let i = 1; i <= (limits.maxZones ?? 4); i++) {
      zones.push({
        id: `Zone ${i}`,
        type: 'regular',
        x: -500,
        y: -500,
        width: 1000,
        height: 1000,
        enabled: false,
      });
    }

    // Exclusion zones
    for (let i = 1; i <= (limits.maxExclusionZones ?? 2); i++) {
      zones.push({
        id: `Exclusion ${i}`,
        type: 'exclusion',
        x: -500,
        y: -500,
        width: 1000,
        height: 1000,
        enabled: false,
      });
    }

    // Entry zones
    for (let i = 1; i <= (limits.maxEntryZones ?? 2); i++) {
      zones.push({
        id: `Entry ${i}`,
        type: 'entry',
        x: -500,
        y: -500,
        width: 1000,
        height: 1000,
        enabled: false,
      });
    }

    return zones;
  }, [currentProfile]);

  // Merge device zones with all possible zones
  const displayZones = useMemo(() => {
    if (!selectedRoom) return allPossibleZones;

    const deviceZones = selectedRoom.zones ?? [];
    const merged = [...allPossibleZones];

    // Match device zones to slots by type and index
    deviceZones.forEach((deviceZone) => {
      const slot = merged.find(z => z.id === deviceZone.id && z.type === deviceZone.type);
      if (slot) {
        Object.assign(slot, { ...deviceZone, enabled: true });
      }
    });

    return merged;
  }, [selectedRoom, allPossibleZones]);

  // Only enabled zones should show on canvas
  const enabledZones = useMemo(() => {
    return displayZones.filter(z => z.enabled);
  }, [displayZones]);

  const handleDevicePlacementChange = useCallback(async (placement: DevicePlacement) => {
    if (!selectedRoom) return;
    const updatedRoom: RoomConfig = { ...selectedRoom, devicePlacement: placement };
    // Optimistic update
    onRoomUpdate?.(updatedRoom);
    try {
      await updateRoom(selectedRoom.id, updatedRoom);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update device placement');
      // Revert on error
      onRoomUpdate?.(selectedRoom);
    }
  }, [selectedRoom, onRoomUpdate]);

  // Generate UUID helper
  const generateId = useCallback(() => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }, []);

  // Furniture handlers
  const handleAddFurniture = useCallback(async (furnitureType: FurnitureType) => {
    if (!selectedRoom) return;
    const newFurniture: FurnitureInstance = {
      id: generateId(),
      typeId: furnitureType.id,
      x: 0,
      y: 0,
      width: furnitureType.defaultWidth,
      depth: furnitureType.defaultDepth,
      height: furnitureType.defaultHeight ?? 800,
      rotationDeg: 0,
      aspectRatioLocked: true,
    };
    const updatedRoom: RoomConfig = {
      ...selectedRoom,
      furniture: [...(selectedRoom.furniture ?? []), newFurniture],
    };
    onRoomUpdate?.(updatedRoom);
    try {
      await updateRoom(selectedRoom.id, updatedRoom);
      setSelectedFurnitureId(newFurniture.id);
      setShowFurnitureLibrary(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add furniture');
      onRoomUpdate?.(selectedRoom);
    }
  }, [selectedRoom, onRoomUpdate, generateId]);

  const handleFurnitureChange = useCallback(async (updatedFurniture: FurnitureInstance) => {
    if (!selectedRoom) return;
    const updatedRoom: RoomConfig = {
      ...selectedRoom,
      furniture: (selectedRoom.furniture ?? []).map((f) => (f.id === updatedFurniture.id ? updatedFurniture : f)),
    };
    onRoomUpdate?.(updatedRoom);
    try {
      await updateRoom(selectedRoom.id, updatedRoom);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update furniture');
      onRoomUpdate?.(selectedRoom);
    }
  }, [selectedRoom, onRoomUpdate]);

  const handleFurnitureDelete = useCallback(async () => {
    if (!selectedRoom || !selectedFurnitureId) return;
    const updatedRoom: RoomConfig = {
      ...selectedRoom,
      furniture: (selectedRoom.furniture ?? []).filter((f) => f.id !== selectedFurnitureId),
    };
    onRoomUpdate?.(updatedRoom);
    try {
      await updateRoom(selectedRoom.id, updatedRoom);
      setSelectedFurnitureId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete furniture');
      onRoomUpdate?.(selectedRoom);
    }
  }, [selectedRoom, selectedFurnitureId, onRoomUpdate]);

  const selectedFurniture = useMemo(
    () => selectedRoom?.furniture?.find((f) => f.id === selectedFurnitureId) ?? null,
    [selectedRoom?.furniture, selectedFurnitureId]
  );

  // Door handlers
  const handleAddDoor = useCallback(() => {
    if (!selectedRoom?.roomShell?.points || selectedRoom.roomShell.points.length < 3) return;
    if (isDoorPlacementMode) {
      setIsDoorPlacementMode(false);
      return;
    }
    setIsDoorPlacementMode(true);
    setSelectedDoorId(null);
  }, [selectedRoom, isDoorPlacementMode]);

  const handleWallSegmentClick = useCallback(async (segmentIndex: number, positionOnSegment: number) => {
    if (!isDoorPlacementMode || !selectedRoom) return;
    const newDoor: Door = {
      id: generateId(),
      segmentIndex,
      positionOnSegment,
      widthMm: 850,
      swingDirection: 'in',
      swingSide: 'left',
    };
    const updatedRoom: RoomConfig = {
      ...selectedRoom,
      doors: [...(selectedRoom.doors ?? []), newDoor],
    };
    onRoomUpdate?.(updatedRoom);
    try {
      await updateRoom(selectedRoom.id, updatedRoom);
      setSelectedDoorId(newDoor.id);
      setIsDoorPlacementMode(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add door');
      onRoomUpdate?.(selectedRoom);
    }
  }, [isDoorPlacementMode, selectedRoom, onRoomUpdate, generateId]);

  const handleDoorChange = useCallback(async (updatedDoor: Door) => {
    if (!selectedRoom) return;
    const updatedRoom: RoomConfig = {
      ...selectedRoom,
      doors: (selectedRoom.doors ?? []).map((d) => (d.id === updatedDoor.id ? updatedDoor : d)),
    };
    onRoomUpdate?.(updatedRoom);
    try {
      await updateRoom(selectedRoom.id, updatedRoom);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update door');
      onRoomUpdate?.(selectedRoom);
    }
  }, [selectedRoom, onRoomUpdate]);

  const handleDoorDelete = useCallback(async () => {
    if (!selectedRoom || !selectedDoorId) return;
    const updatedRoom: RoomConfig = {
      ...selectedRoom,
      doors: (selectedRoom.doors ?? []).filter((d) => d.id !== selectedDoorId),
    };
    onRoomUpdate?.(updatedRoom);
    try {
      await updateRoom(selectedRoom.id, updatedRoom);
      setSelectedDoorId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete door');
      onRoomUpdate?.(selectedRoom);
    }
  }, [selectedRoom, selectedDoorId, onRoomUpdate]);

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
    const segmentVec = { x: segmentEnd.x - segmentStart.x, y: segmentEnd.y - segmentStart.y };
    const segmentLen = Math.sqrt(segmentVec.x * segmentVec.x + segmentVec.y * segmentVec.y);
    if (segmentLen === 0) return;

    const pointVec = { x: x - segmentStart.x, y: y - segmentStart.y };
    const projection = (pointVec.x * segmentVec.x + pointVec.y * segmentVec.y) / (segmentLen * segmentLen);
    const newPosition = Math.max(0, Math.min(1, projection));

    handleDoorChange({ ...door, positionOnSegment: newPosition });
  }, [doorDrag, selectedRoom, handleDoorChange]);

  const handleDoorDragEnd = useCallback(() => {
    setDoorDrag(null);
  }, []);

  const selectedDoor = useMemo(
    () => selectedRoom?.doors?.find((d) => d.id === selectedDoorId) ?? null,
    [selectedRoom?.doors, selectedDoorId]
  );

  // Close the wall loop and finish drawing
  const handleCloseLoop = useCallback(() => {
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
        handleRoomOutlineChange(next);
      }
    }
    stopDrawing();

    // Auto-center the room outline in the grid
    if (pts.length >= 3) {
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      setCanvasPan({ x: centerX, y: centerY });
    }
  }, [selectedRoom, stopDrawing, handleRoomOutlineChange]);

  // Clear all points
  const handleClear = useCallback(() => {
    if (!selectedRoom) return;
    handleRoomOutlineChange([]);
    stopDrawing();
  }, [selectedRoom, handleRoomOutlineChange, stopDrawing]);

  // Auto-enable drawing mode when on outline step
  useEffect(() => {
    if (currentStep === 'outline') {
      setIsDrawingWall(true);
    }
  }, [currentStep, setIsDrawingWall]);

  // Keyboard shortcuts for outline step
  useEffect(() => {
    if (currentStep !== 'outline') return;

    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const tag = target.tagName.toLowerCase();
      const isEditable =
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
  }, [currentStep, isDrawingWall, selectedRoom?.roomShell?.points, stopDrawing, setIsDrawingWall, removeLastPoint, handleCloseLoop]);

  // Auto-initialize device placement to room center when entering placement step
  useEffect(() => {
    if (currentStep === 'placement' && selectedRoom && !selectedRoom.devicePlacement) {
      const points = selectedRoom.roomShell?.points;
      if (points && points.length >= 3) {
        // Calculate center of room outline
        const xs = points.map((p) => p.x);
        const ys = points.map((p) => p.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        // Initialize device at center of room
        handleDevicePlacementChange({
          x: centerX,
          y: centerY,
          rotationDeg: 0,
        });
      }
    }
  }, [currentStep, selectedRoom, handleDevicePlacementChange]);

  // Auto-initialize device placement for skip room mode (generic radar)
  useEffect(() => {
    if (currentStep === 'zones' && roomPath === 'skip' && selectedRoom && !selectedRoom.devicePlacement) {
      // Calculate offset to center device + FOV together
      const maxRangeMeters = currentProfile?.limits?.maxRangeMeters ?? 6;
      const maxRangeMm = maxRangeMeters * 1000;
      const offsetY = -maxRangeMm / 2; // Negative Y shifts upward

      // Place device offset upward so FOV extends down, centering the whole view
      handleDevicePlacementChange({
        x: 0,
        y: offsetY,
        rotationDeg: 90,
      });
    }
  }, [currentStep, roomPath, selectedRoom, currentProfile, handleDevicePlacementChange]);

  // Load zones from device when entering zones step
  useEffect(() => {
    const loadZonesFromDevice = async () => {
      if (currentStep !== 'zones' || !selectedRoom?.deviceId || !selectedRoom?.profileId) {
        return;
      }

      // Only load zones if the room's device matches the wizard's selected device
      if (deviceId && selectedRoom.deviceId !== deviceId) {
        return;
      }

      // Get entityNamePrefix from room or fall back to device
      let entityNamePrefix = selectedRoom.entityNamePrefix;
      if (!entityNamePrefix) {
        const device = devices.find(d => d.id === selectedRoom.deviceId);
        entityNamePrefix = device?.entityNamePrefix;
      }

      if (!entityNamePrefix) {
        console.warn('Cannot load zones: entityNamePrefix not found for room or device');
        // Still mark as complete so polygon mode check can proceed
        const roomKey = `${selectedRoom.id}:${selectedRoom.deviceId}:${selectedRoom.profileId}`;
        setZonesLoadingComplete(roomKey);
        return;
      }

      // Skip if we've already loaded zones for this room
      const roomKey = `${selectedRoom.id}:${selectedRoom.deviceId}:${selectedRoom.profileId}`;
      if (zonesLoadedRef.current.has(roomKey)) {
        // Already loaded - just mark as complete
        setZonesLoadingComplete(roomKey);
        return;
      }

      // Mark as loaded to prevent redundant fetches
      zonesLoadedRef.current.add(roomKey);

      try {
        // Skip entityMappings if device has valid mappings stored
        const entityMappingsToUse = deviceHasValidMappings ? undefined : selectedRoom.entityMappings;
        // fetchZonesFromDevice returns ZoneRect[] directly, not { zones: ZoneRect[] }
        const fetchedZones = await fetchZonesFromDevice(
          selectedRoom.deviceId,
          selectedRoom.profileId,
          entityNamePrefix,
          entityMappingsToUse
        ) || [];
        const updatedRoom: RoomConfig = { ...selectedRoom, zones: fetchedZones };
        await updateRoom(selectedRoom.id, updatedRoom);
        // Defer parent state update to avoid setState during render warning
        setTimeout(() => {
          onRoomUpdate?.(updatedRoom);
          setZonesLoadingComplete(roomKey);
        }, 0);
      } catch (err) {
        // Clear zones on error to prevent showing stale zones
        const updatedRoom: RoomConfig = { ...selectedRoom, zones: [] };
        await updateRoom(selectedRoom.id, updatedRoom);
        // Defer parent state update to avoid setState during render warning
        setTimeout(() => {
          onRoomUpdate?.(updatedRoom);
          setZonesLoadingComplete(roomKey);
        }, 0);
      }
    };

    loadZonesFromDevice();
  }, [currentStep, selectedRoom?.id, selectedRoom?.deviceId, selectedRoom?.profileId, selectedRoom?.entityNamePrefix, selectedRoom?.entityMappings, deviceId, devices, onRoomUpdate, deviceHasValidMappings]);

  // Fetch polygon mode status when entering zones step
  // This runs AFTER zones have been loaded to ensure room is fully initialized
  useEffect(() => {
    const loadPolygonModeStatus = async () => {
      if (currentStep !== 'zones' || !selectedRoom?.deviceId || !selectedRoom?.profileId) {
        return;
      }

      // Wait for zones to be loaded before checking polygon mode
      // This ensures the room is fully initialized
      const roomKey = `${selectedRoom.id}:${selectedRoom.deviceId}:${selectedRoom.profileId}`;
      if (zonesLoadingComplete !== roomKey) {
        return;
      }

      let entityNamePrefix = selectedRoom.entityNamePrefix;
      if (!entityNamePrefix) {
        const device = devices.find(d => d.id === selectedRoom.deviceId);
        entityNamePrefix = device?.entityNamePrefix;
      }

      if (!entityNamePrefix) {
        setPolygonModeStatus({ supported: false, enabled: false });
        return;
      }

      try {
        // Skip entityMappings if device has valid mappings stored
        const entityMappingsToUse = deviceHasValidMappings ? undefined : selectedRoom.entityMappings;
        const status = await fetchPolygonModeStatus(
          selectedRoom.deviceId,
          selectedRoom.profileId,
          entityNamePrefix,
          entityMappingsToUse
        );
        setPolygonModeStatus(status);

        // If polygon mode is enabled, fetch polygon zones
        if (status.enabled) {
          const zones = await fetchPolygonZonesFromDevice(
            selectedRoom.deviceId,
            selectedRoom.profileId,
            entityNamePrefix,
            entityMappingsToUse
          );
          setPolygonZones(zones);
        } else if (status.supported) {
          // Polygon mode switch exists but is off - show prompt to enable
          const promptKey = `${selectedRoom.id}:${selectedRoom.deviceId}:prompt`;
          if (!polygonPromptShownRef.current.has(promptKey)) {
            polygonPromptShownRef.current.add(promptKey);
            setShowPolygonPrompt(true);
          }
        }
        // Note: If status.supported is false but polygonZonesAvailable is true,
        // the static banner will show (handled in render). This can happen if
        // the polygon mode switch entity doesn't exist but polygon zone text
        // entities do exist.
      } catch (err) {
        console.error('Failed to fetch polygon mode status:', err);
        setPolygonModeStatus({ supported: false, enabled: false });
      }
    };

    loadPolygonModeStatus();
  }, [currentStep, selectedRoom?.id, selectedRoom?.deviceId, selectedRoom?.profileId, selectedRoom?.entityNamePrefix, selectedRoom?.entityMappings, devices, zonesLoadingComplete, deviceHasValidMappings]);

  // Track if we've auto-enabled Zone 1 for this room to avoid re-enabling if user manually disables
  const autoEnabledZoneRef = useRef<Set<string>>(new Set());

  // Auto-enable Zone 1 when entering zones step with no enabled zones
  // Only runs AFTER zones have been loaded from the device and only for rectangle mode
  useEffect(() => {
    if (currentStep !== 'zones') return;
    if (!selectedRoom) return;

    // Don't auto-enable in polygon mode
    if (polygonModeStatus.enabled) return;

    // Wait for zones to be loaded from device before auto-enabling
    const roomKey = `${selectedRoom.id}:${selectedRoom.deviceId}:${selectedRoom.profileId}`;
    if (zonesLoadingComplete !== roomKey) return;

    // If device has zones, don't auto-enable - respect the existing configuration
    if (enabledZones.length > 0) return;

    // Check if we've already auto-enabled for this room
    if (autoEnabledZoneRef.current.has(roomKey)) return;

    // Find Zone 1 (first regular zone)
    const zone1 = displayZones.find(z => z.id === 'Zone 1' && z.type === 'regular');
    if (!zone1) return;

    // Mark as auto-enabled to prevent re-triggering
    autoEnabledZoneRef.current.add(roomKey);

    // Enable Zone 1 (no delay needed since we wait for loading to complete)
    enableZoneSlot('Zone 1');
  }, [currentStep, selectedRoom, enabledZones.length, displayZones, zonesLoadingComplete, polygonModeStatus.enabled]);

  // Auto-zoom to fit all zones
  const handleAutoZoom = useCallback(() => {
    const zones = enabledZones;
    if (!zones.length) {
      setCanvasZoom(1.1);
      setCanvasPan({ x: 0, y: 0 });
      return;
    }
    const xs = zones.flatMap((z) => [z.x, z.x + z.width]);
    const ys = zones.flatMap((z) => [z.y, z.y + z.height]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const pad = 500;
    const width = Math.max(100, maxX - minX + pad * 2);
    const height = Math.max(100, maxY - minY + pad * 2);
    const maxDim = Math.max(width, height);
    const targetZoom = Math.min(5, Math.max(0.1, (0.8 * 15000) / maxDim));
    setCanvasZoom(targetZoom);
    setCanvasPan({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
  }, [enabledZones]);

  // Track navigation direction for slide animations
  const [slideDirection, setSlideDirection] = useState<'forward' | 'backward'>('forward');

  const canNext =
    (currentStep === 'device' && !!deviceId) ||
    (currentStep === 'entityDiscovery' && !!discoveredMappings) ||
    (currentStep === 'roomChoice' && !!roomPath) ||
    (currentStep === 'roomDetails'
      ? roomPath === 'existing'
        ? !!roomId
        : roomPath === 'skip'
        ? true
        : !!newRoomName.trim()
      : true) ||
    (currentStep === 'outline'
      ? roomPath === 'skip' || (selectedRoom?.roomShell?.points?.length ?? 0) >= 3
      : true) ||
    (currentStep === 'placement'
      ? roomPath === 'skip' || selectedRoom?.devicePlacement?.x !== undefined
      : true) ||
    (currentStep === 'zones'
      ? roomPath === 'skip' || (selectedRoom?.zones?.length ?? 0) > 0
      : true) ||
    currentStep === 'finish';

  const jumpTo = (key: StepKey) => {
    const idx = steps.indexOf(key);
    if (idx >= 0) {
      setStepIndex(idx);
      onStepChange?.(key);
    }
  };

  const nextStep = () => {
    if (!canNext) return;
    setError(null);
    setSlideDirection('forward');
    setStepIndex((prev) => {
      const next = Math.min(steps.length - 1, prev + 1);
      onStepChange?.(steps[next]);
      return next;
    });
  };

  const prevStep = () => {
    setError(null);
    setSlideDirection('backward');
    setStepIndex((prev) => {
      const next = Math.max(0, prev - 1);
      onStepChange?.(steps[next]);
      return next;
    });
  };

  const handleCreateRoom = async () => {
    if (!newRoomName.trim()) {
      setError('Room name is required');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      // Don't pass entityMappings - device mapping was already saved by EntityDiscovery
      // The backend will use device mapping as source of truth
      const room = await onCreateRoom(newRoomName.trim(), deviceId, profileId, undefined);
      setRoomId(room.id);
      onSelectRoom(room.id, room.profileId ?? profileId ?? null);
      setNewRoomName('');
      setStepIndex(steps.indexOf('outline'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create room');
    } finally {
      setCreating(false);
    }
  };

  const handleEntityDiscoveryComplete = (mappings: EntityMappings) => {
    setDiscoveredMappings(mappings);
    nextStep();
  };

  const handleEntityDiscoveryCancel = () => {
    // Go back to device selection
    prevStep();
  };

  const handleZonesChange = async (zones: ZoneRect[]) => {
    if (!selectedRoom) return;
    const updatedRoom: RoomConfig = { ...selectedRoom, zones };
    // Optimistic update
    onRoomUpdate?.(updatedRoom);
    try {
      await updateRoom(selectedRoom.id, updatedRoom);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update zones');
      // Revert on error
      onRoomUpdate?.(selectedRoom);
    }
  };

  const enableZoneSlot = (slotId: string) => {
    const slot = displayZones.find(z => z.id === slotId);
    if (!slot || slot.enabled) return;

    // Calculate room center from outline points (if available)
    // Fall back to (0, 0) which is the device position
    let centerX = 0;
    let centerY = 0;
    const outlinePoints = selectedRoom?.roomShell?.points;
    if (outlinePoints && outlinePoints.length > 0) {
      centerX = outlinePoints.reduce((sum: number, p: { x: number; y: number }) => sum + p.x, 0) / outlinePoints.length;
      centerY = outlinePoints.reduce((sum: number, p: { x: number; y: number }) => sum + p.y, 0) / outlinePoints.length;
    }

    // Position zone so its center is at the room center
    const enabledSlot = {
      ...slot,
      enabled: true,
      x: centerX - slot.width / 2,
      y: centerY - slot.height / 2,
    };

    const newZones = [...displayZones.filter(z => z.enabled), enabledSlot];
    handleZonesChange(newZones);
    setSelectedZoneId(slotId);
  };

  const disableZoneSlot = (slotId: string) => {
    const newZones = displayZones.filter(z => z.id !== slotId || !z.enabled);
    handleZonesChange(newZones.filter(z => z.enabled));
    if (selectedZoneId === slotId) {
      const remaining = newZones.filter(z => z.enabled);
      setSelectedZoneId(remaining[0]?.id ?? null);
    }
  };

  // Get first available zone slot of a specific type
  const getNextAvailableSlot = (type: 'regular' | 'exclusion' | 'entry') => {
    return displayZones.find(z => z.type === type && !z.enabled);
  };

  const handlePushZones = async () => {
    // Determine which zones to push based on polygon mode
    const zonesToPush = polygonModeStatus.enabled ? polygonZones : selectedRoom?.zones;

    if (!deviceId || !profileId || !zonesToPush || zonesToPush.length === 0) {
      setError('Cannot push zones: missing device, profile, or zones');
      return;
    }

    // Get entityNamePrefix from room or device
    let entityNamePrefix = selectedRoom?.entityNamePrefix;
    if (!entityNamePrefix) {
      const device = devices.find(d => d.id === deviceId);
      entityNamePrefix = device?.entityNamePrefix;
    }

    if (!entityNamePrefix) {
      setError('Cannot push zones: device entity name prefix not found');
      return;
    }

    setPushingZones(true);
    setError(null);
    setPushSuccess(false);
    try {
      // Skip entityMappings if device has valid mappings stored
      const entityMappingsToUse = deviceHasValidMappings ? undefined : selectedRoom?.entityMappings;
      if (polygonModeStatus.enabled) {
        // Push polygon zones to device
        await pushPolygonZonesToDevice(deviceId, profileId, polygonZones, entityNamePrefix, entityMappingsToUse);
      } else {
        // Push rectangular zones to device (device is source of truth)
        await pushZonesToDevice(deviceId, profileId, selectedRoom!.zones, entityNamePrefix, entityMappingsToUse);
        // Also update add-on storage to mirror device state
        await updateRoom(selectedRoom!.id, { zones: selectedRoom!.zones });
      }
      setPushSuccess(true);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to push zones to device');
      setPushSuccess(false);
    } finally {
      setPushingZones(false);
    }
  };

  // Handle polygon zones change
  const handlePolygonZonesChange = async (zones: ZonePolygon[]) => {
    setPolygonZones(zones);
    // Note: Polygon zones are primarily stored on the device, not in our room config
    // The push to device happens when user clicks "Push Zones to Device"
  };

  // Enable polygon mode and convert existing zones
  const handleEnablePolygonMode = async () => {
    if (!selectedRoom?.deviceId || !selectedRoom?.profileId) return;

    let entityNamePrefix = selectedRoom.entityNamePrefix;
    if (!entityNamePrefix) {
      const device = devices.find(d => d.id === selectedRoom.deviceId);
      entityNamePrefix = device?.entityNamePrefix;
    }

    if (!entityNamePrefix) {
      setError('Cannot enable polygon mode: device entity name prefix not found');
      return;
    }

    setTogglingPolygonMode(true);
    setError(null);

    try {
      // Skip entityMappings if device has valid mappings stored
      const entityMappingsToUse = deviceHasValidMappings ? undefined : selectedRoom.entityMappings;
      // Enable polygon mode on the device
      await setPolygonMode(
        selectedRoom.deviceId,
        selectedRoom.profileId,
        entityNamePrefix,
        true,
        entityMappingsToUse
      );

      // Convert existing rectangular zones to polygon zones (4-vertex rectangles)
      const convertedZones: ZonePolygon[] = enabledZones.map(zone => ({
        id: zone.id,
        type: zone.type,
        vertices: [
          { x: zone.x, y: zone.y },
          { x: zone.x + zone.width, y: zone.y },
          { x: zone.x + zone.width, y: zone.y + zone.height },
          { x: zone.x, y: zone.y + zone.height },
        ],
        enabled: zone.enabled,
        label: zone.label,
      }));

      // Push converted zones to device
      if (convertedZones.length > 0) {
        await pushPolygonZonesToDevice(
          selectedRoom.deviceId,
          selectedRoom.profileId,
          convertedZones,
          entityNamePrefix,
          entityMappingsToUse
        );
      }

      // Update local state
      setPolygonModeStatus({ supported: true, enabled: true });
      setPolygonZones(convertedZones);
      setShowPolygonPrompt(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enable polygon mode');
    } finally {
      setTogglingPolygonMode(false);
    }
  };

  // Keep using rectangular zones
  const handleKeepRectangularZones = () => {
    setShowPolygonPrompt(false);
    // User chose to stay with rectangular zones, nothing else to do
  };

  // Animation classes based on navigation direction
  const slideAnimationClass =
    slideDirection === 'forward'
      ? 'animate-in slide-in-from-right-4 fade-in duration-500'
      : 'animate-in slide-in-from-left-4 fade-in duration-500';

  const Summary = () => (
    <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-200">
      <div className="flex flex-col gap-1">
        <div>
          <span className="text-slate-400">Device:</span>{' '}
          <span className="text-white">
            {deviceId ? devices.find((d) => d.id === deviceId)?.name ?? deviceId : 'Not selected'}
          </span>
        </div>
        <div>
          <span className="text-slate-400">Profile:</span>{' '}
          <span className="text-white">{currentProfile ? currentProfile.label : profileId ?? 'Not selected'}</span>
        </div>
        <div>
          <span className="text-slate-400">Room:</span>{' '}
          <span className="text-white">{selectedRoom ? selectedRoom.name : roomId ?? 'Not selected'}</span>
        </div>
        <div>
          <span className="text-slate-400">Mode:</span>{' '}
          <span className="text-white">{isRoomMode ? 'Room' : 'Generic (no room shell)'}</span>
        </div>
      </div>
    </div>
  );

  // Check if current step is a canvas step (full-page mode)
  const isCanvasStep = currentStep === 'outline' || currentStep === 'doors' || currentStep === 'furniture' || currentStep === 'placement' || currentStep === 'zones';

  // Welcome popup state for canvas steps
  const [showWelcomePopup, setShowWelcomePopup] = useState(false);

  // Show welcome popup when entering canvas steps
  useEffect(() => {
    if (isCanvasStep) {
      setShowWelcomePopup(true);
    }
  }, [currentStep]);

  // If canvas step, render full-page canvas mode
  if (isCanvasStep) {
    const getStepInfo = () => {
      if (currentStep === 'outline') return { title: 'Draw Room Outline', description: 'Click on the canvas to add wall corners. You need at least 3 points to form a room outline.', icon: '🏠' };
      if (currentStep === 'doors') return { title: 'Add Doors', description: 'Click "Add Door" then click on a wall to place a door. You can adjust its position and swing direction.', icon: '🚪' };
      if (currentStep === 'furniture') return { title: 'Add Furniture', description: 'Click "Add Furniture" to open the library. Select items to place in your room. Drag to position and resize as needed.', icon: '🪑' };
      if (currentStep === 'placement') return { title: 'Place Your Device', description: 'Drag the device marker to position it in your room. Use the rotation slider to orient it correctly.', icon: '📡' };
      if (currentStep === 'zones') {
        const baseDesc = 'Click "Show Zone Slots" to enable detection zones. Drag zones to position them and use the corner handles to resize.';
        const polygonInfo = polygonZonesAvailable
          ? ' Your device supports polygon zones for more precise detection areas - configure these in the Live Tracking page.'
          : '';
        return { title: 'Define Detection Zones', description: baseDesc + polygonInfo, icon: '📐' };
      }
      return { title: '', description: '', icon: '' };
    };

    const stepInfo = getStepInfo();

    return (
      <div className="fixed inset-0 bg-slate-950 overflow-hidden">
        {/* Welcome Popup */}
        {showWelcomePopup && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="max-w-md rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-900 to-slate-800 p-8 shadow-2xl animate-in zoom-in-95 duration-300">
              <div className="text-center space-y-4">
                <div className="text-6xl">{stepInfo.icon}</div>
                <h2 className="text-2xl font-bold text-white">{stepInfo.title}</h2>
                <p className="text-sm text-slate-300">{stepInfo.description}</p>
                <button
                  onClick={() => setShowWelcomePopup(false)}
                  className="w-full rounded-xl bg-gradient-to-r from-aqua-600 to-aqua-500 px-6 py-3 font-bold text-white shadow-lg hover:shadow-xl transition-all active:scale-95"
                >
                  Let's Go!
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Installation Angle Suggestion Modal */}
        {showRotationSuggestion && rotationSuggestion && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center">
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setShowRotationSuggestion(false)}
            />
            <div className="relative z-10 w-full max-w-md mx-4 rounded-2xl border border-slate-700/50 bg-slate-900/95 backdrop-blur shadow-2xl animate-in zoom-in-95 fade-in duration-200">
              <div className="p-6">
                <div className="flex justify-center mb-4">
                  <div className="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center">
                    <span className="text-xl">!</span>
                  </div>
                </div>
                <h3 className="text-xl font-bold text-white text-center mb-2">
                  Align zones to your walls?
                </h3>
                <p className="text-sm text-slate-300 text-center mb-4">
                  Based on your room outline, we can set the Installation Angle so zones stay square to the walls.
                </p>
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-center text-amber-200 text-sm font-semibold mb-4">
                  Suggested Installation Angle: {rotationSuggestion.suggestedAngle > 0 ? "+" : ""}{rotationSuggestion.suggestedAngle} deg
                </div>
                {isZeroSuggestion && !rotationSuggestionError && (
                  <div className="mb-4 text-sm text-slate-300 text-center">
                    Rotation already aligns with your walls. Installation angle can stay at 0.
                  </div>
                )}
                {rotationSuggestionError && (
                  <div className="mb-4 text-sm text-rose-300 text-center">
                    {rotationSuggestionError}
                  </div>
                )}
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowRotationSuggestion(false)}
                    className="flex-1 rounded-xl border border-slate-600 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-200 transition-all hover:bg-slate-700 active:scale-95"
                  >
                    Not now
                  </button>
                  <button
                    onClick={applyInstallationAngleSuggestion}
                    disabled={applyingInstallationAngle}
                    className="flex-1 rounded-xl bg-gradient-to-r from-amber-600 to-amber-500 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-amber-500/30 transition-all hover:shadow-xl hover:shadow-amber-500/40 disabled:opacity-50 active:scale-95"
                  >
                    {applyingInstallationAngle ? 'Applying...' : 'Apply'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Floating Navigation Controls */}
        <div className="absolute top-6 left-6 z-40 flex items-center gap-3">
          <button
            onClick={prevStep}
            disabled={stepIndex === 0}
            className="group rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur px-4 py-2.5 text-sm font-semibold text-slate-100 shadow-lg transition-all hover:border-slate-600 hover:bg-slate-800 hover:shadow-xl disabled:opacity-40 active:scale-95"
          >
            <span className="inline-block transition-transform group-hover:-translate-x-0.5">←</span> Back
          </button>
          <div className="rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur px-4 py-2.5 text-sm font-semibold text-slate-300 shadow-lg">
            Step {stepIndex + 1} of {steps.length}
          </div>
        </div>

        {/* Floating Exit & Restart Buttons (top right) */}
        <div className="absolute top-6 right-6 z-40 flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="group rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur px-4 py-2.5 text-sm font-semibold text-slate-100 shadow-lg transition-all hover:border-aqua-500/50 hover:bg-slate-800 hover:shadow-xl active:scale-95"
            >
              <span className="inline-block transition-transform group-hover:-translate-x-0.5">←</span> Dashboard
            </button>
          )}
          <button
            onClick={() => {
              setStepIndex(0);
              setError(null);
              onStepChange?.('device');
            }}
            className="group rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur px-4 py-2.5 text-sm font-semibold text-slate-100 shadow-lg transition-all hover:border-rose-500/50 hover:bg-slate-800 hover:shadow-xl active:scale-95"
          >
            <span className="inline-block transition-transform group-hover:rotate-180 duration-300">↻</span> Restart
          </button>
        </div>

        {/* Canvas Content */}
        <div
          className="h-full w-full"
          onWheelCapture={(e) => {
            // Check if the event target is within a scrollable container (like zone list panel)
            // If so, let the native scroll happen instead of zooming
            let target = e.target as HTMLElement | null;
            while (target && target !== e.currentTarget) {
              const style = window.getComputedStyle(target);
              const overflowY = style.overflowY;
              if (overflowY === 'auto' || overflowY === 'scroll') {
                // Target is in a scrollable container, don't zoom
                return;
              }
              target = target.parentElement;
            }

            if (e.cancelable) e.preventDefault();
            e.stopPropagation();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            setCanvasZoom((z) => Math.min(5, Math.max(0.1, z + delta)));
          }}
        >
          {currentStep === 'outline' && (
            <RoomCanvas
              points={selectedRoom?.roomShell?.points ?? []}
              onChange={handleRoomOutlineChange}
              onCanvasClick={wallDrawingClick}
              onCanvasMove={wallDrawingMove}
              previewFrom={pendingStart}
              previewTo={pendingStart && previewPoint ? previewPoint : null}
              rangeMm={15000}
              snapGridMm={canvasSnap}
              height="100%"
              zoom={canvasZoom}
              panOffsetMm={canvasPan}
              onPanChange={setCanvasPan}
              displayUnits={units}
            />
          )}

          {currentStep === 'doors' && (
            <RoomCanvas
              points={selectedRoom?.roomShell?.points ?? []}
              onChange={() => {}}
              lockShell={true}
              rangeMm={15000}
              snapGridMm={canvasSnap}
              height="100%"
              zoom={canvasZoom}
              panOffsetMm={canvasPan}
              onPanChange={setCanvasPan}
              displayUnits={units}
              doors={selectedRoom?.doors ?? []}
              selectedDoorId={selectedDoorId}
              onDoorSelect={setSelectedDoorId}
              onDoorChange={handleDoorChange}
              isDoorPlacementMode={isDoorPlacementMode}
              onWallSegmentClick={handleWallSegmentClick}
              onDoorDragStart={handleDoorDragStart}
              onDoorDragMove={handleDoorDragMove}
              onDoorDragEnd={handleDoorDragEnd}
              showDoors={true}
            />
          )}

          {currentStep === 'furniture' && (
            <RoomCanvas
              points={selectedRoom?.roomShell?.points ?? []}
              onChange={() => {}}
              lockShell={true}
              rangeMm={15000}
              snapGridMm={canvasSnap}
              height="100%"
              zoom={canvasZoom}
              panOffsetMm={canvasPan}
              onPanChange={setCanvasPan}
              displayUnits={units}
              doors={selectedRoom?.doors ?? []}
              showDoors={true}
              furniture={selectedRoom?.furniture ?? []}
              selectedFurnitureId={selectedFurnitureId}
              onFurnitureSelect={(id) => {
                setSelectedFurnitureId(id);
                setShowFurnitureLibrary(false);
              }}
              onFurnitureChange={handleFurnitureChange}
              showFurniture={true}
            />
          )}

          {currentStep === 'placement' && (
            <RoomCanvas
              points={selectedRoom?.roomShell?.points ?? []}
              onChange={() => {}}
              lockShell={true}
              devicePlacement={
                selectedRoom?.devicePlacement ?? {
                  x: 0,
                  y: 0,
                  rotationDeg: 0,
                }
              }
              onDeviceChange={handleDevicePlacementChange}
              fieldOfViewDeg={currentProfile?.limits?.fieldOfViewDegrees}
              maxRangeMeters={currentProfile?.limits?.maxRangeMeters}
              deviceIconUrl={currentProfile?.iconUrl}
              clipRadarToWalls={clipRadarToWalls}
              rangeMm={15000}
              snapGridMm={canvasSnap}
              height="100%"
              zoom={canvasZoom}
              panOffsetMm={canvasPan}
              onPanChange={setCanvasPan}
              displayUnits={units}
              furniture={selectedRoom?.furniture ?? []}
              showFurniture={true}
              doors={selectedRoom?.doors ?? []}
              showDoors={true}
            />
          )}

          {currentStep === 'zones' && (
            <div
              className="h-full w-full overflow-hidden overscroll-contain touch-none"
              onWheelCapture={(e) => {
                // Check if the event target is within a scrollable container
                let target = e.target as HTMLElement | null;
                while (target && target !== e.currentTarget) {
                  const style = window.getComputedStyle(target);
                  const overflowY = style.overflowY;
                  if (overflowY === 'auto' || overflowY === 'scroll') {
                    return;
                  }
                  target = target.parentElement;
                }

                if (e.cancelable) e.preventDefault();
                if ((e.nativeEvent as any)?.cancelable) {
                  (e.nativeEvent as any).preventDefault();
                }
                e.stopPropagation();
                const delta = e.deltaY > 0 ? -0.1 : 0.1;
                setCanvasZoom((z) => Math.min(5, Math.max(0.1, z + delta)));
              }}
            >
              <ZoneCanvas
                zones={enabledZones}
                onZonesChange={(updatedZones) => {
                  // When zones change on canvas, update only the enabled ones
                  const newDisplayZones = displayZones.map(z => {
                    const updated = updatedZones.find(u => u.id === z.id);
                    return updated ? { ...updated, enabled: true } : z;
                  });
                  handleZonesChange(newDisplayZones.filter(z => z.enabled));
                }}
                polygonMode={polygonModeStatus.enabled}
                polygonZones={polygonZones}
                onPolygonZonesChange={handlePolygonZonesChange}
                selectedId={selectedZoneId}
                onSelect={setSelectedZoneId}
                roomShell={isRoomMode ? selectedRoom?.roomShell : undefined}
                devicePlacement={selectedRoom?.devicePlacement} // Always show device placement, even in skip mode
                fieldOfViewDeg={currentProfile?.limits?.fieldOfViewDegrees}
                maxRangeMeters={currentProfile?.limits?.maxRangeMeters}
                deviceIconUrl={currentProfile?.iconUrl}
                rangeMm={15000}
                snapGridMm={canvasSnap}
                height="100%"
                zoom={canvasZoom}
                panOffsetMm={canvasPan}
                onPanChange={setCanvasPan}
                onCanvasMove={(pt) => setCursorPos(pt)}
                clipRadarToWalls={clipRadarToWalls}
                furniture={selectedRoom?.furniture}
                doors={selectedRoom?.doors}
              />
            </div>
          )}

          {/* Floating Zoom Controls (bottom right) */}
          <div className="absolute bottom-6 right-6 z-40 flex flex-col gap-2">
            <button
              onClick={() => setCanvasZoom((z) => Math.min(5, z + 0.2))}
              className="rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur px-4 py-2.5 text-sm font-semibold text-slate-100 shadow-lg transition-all hover:border-slate-600 hover:bg-slate-800 hover:shadow-xl active:scale-95"
            >
              Zoom +
            </button>
            <button
              onClick={() => setCanvasZoom((z) => Math.max(0.1, z - 0.2))}
              className="rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur px-4 py-2.5 text-sm font-semibold text-slate-100 shadow-lg transition-all hover:border-slate-600 hover:bg-slate-800 hover:shadow-xl active:scale-95"
            >
              Zoom -
            </button>
            <button
              onClick={() => {
                setCanvasZoom(1);
                setCanvasPan({ x: 0, y: 0 });
              }}
              className="rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur px-4 py-2.5 text-sm font-semibold text-slate-100 shadow-lg transition-all hover:border-slate-600 hover:bg-slate-800 hover:shadow-xl active:scale-95"
            >
              Reset
            </button>
            {currentStep === 'zones' && (
              <button
                onClick={handleAutoZoom}
                className="rounded-xl border border-aqua-600/50 bg-aqua-600/10 backdrop-blur px-4 py-2.5 text-sm font-semibold text-aqua-100 shadow-lg transition-all hover:bg-aqua-600/20 hover:shadow-xl active:scale-95"
              >
                Auto Zoom
              </button>
            )}
          </div>

          {/* Floating Snap Controls (bottom left) */}
          <div className="absolute bottom-6 left-6 z-40 flex flex-col gap-2 rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur px-4 py-3 shadow-xl">
            <span className="text-xs text-slate-400 font-medium">Snap Grid</span>
            <div className="flex flex-wrap gap-2">
              {[0, 50, 100, 200].map((v) => (
                <button
                  key={v}
                  onClick={() => setCanvasSnap(v)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all active:scale-95 ${
                    canvasSnap === v
                      ? 'border-aqua-500 bg-aqua-500/20 text-aqua-100 shadow-lg shadow-aqua-500/20'
                      : 'border-slate-700 bg-slate-800/50 text-slate-200 hover:border-slate-600'
                  }`}
                >
                  {v === 0 ? 'Off' : `${v}mm`}
                </button>
              ))}
            </div>
            {currentStep === 'zones' && (
              <div className="mt-1 text-[10px] text-slate-400">
                Cursor: X {cursorPos ? (cursorPos.x / 1000).toFixed(2) : '--'}m, Y{' '}
                {cursorPos ? (cursorPos.y / 1000).toFixed(2) : '--'}m
              </div>
            )}
          </div>

          {/* Wall Drawing Controls (outline step only) */}
          {currentStep === 'outline' && (
            <div className="absolute top-24 left-6 z-40 flex flex-col gap-2">
              <button
                className={`rounded-xl border px-4 py-2.5 text-sm font-semibold shadow-lg transition-all active:scale-95 ${
                  isDrawingWall
                    ? 'border-rose-600/50 bg-rose-600/10 text-rose-100 hover:bg-rose-600/20'
                    : 'border-aqua-600/50 bg-aqua-600/10 text-aqua-100 hover:bg-aqua-600/20'
                }`}
                onClick={() => setIsDrawingWall((prev) => !prev)}
              >
                {isDrawingWall ? '✕ Stop (Esc)' : '✏️ Add wall (A)'}
              </button>
              <button
                className="rounded-xl border border-emerald-600/50 bg-emerald-600/10 px-4 py-2.5 text-sm font-semibold text-emerald-100 shadow-lg transition-all hover:bg-emerald-600/20 disabled:opacity-40 active:scale-95"
                onClick={handleCloseLoop}
                disabled={!selectedRoom || (selectedRoom.roomShell?.points?.length ?? 0) < 2}
              >
                ✓ Finish (Enter)
              </button>
              <button
                className="rounded-xl border border-amber-600/50 bg-amber-600/10 px-4 py-2.5 text-sm font-semibold text-amber-100 shadow-lg transition-all hover:bg-amber-600/20 disabled:opacity-40 active:scale-95"
                onClick={removeLastPoint}
                disabled={!selectedRoom || !(selectedRoom.roomShell?.points?.length)}
              >
                ↶ Undo (Del)
              </button>
              <button
                className="rounded-xl border border-rose-600/50 bg-rose-600/10 px-4 py-2.5 text-sm font-semibold text-rose-100 shadow-lg transition-all hover:bg-rose-600/20 disabled:opacity-40 active:scale-95"
                onClick={handleClear}
                disabled={!selectedRoom}
              >
                🗑️ Clear
              </button>
            </div>
          )}

          {/* Door Controls (doors step only) */}
          {currentStep === 'doors' && (
            <div className="absolute top-24 left-6 z-40 flex flex-col gap-2">
              <button
                className={`rounded-xl border px-4 py-2.5 text-sm font-semibold shadow-lg transition-all active:scale-95 ${
                  isDoorPlacementMode
                    ? 'border-rose-600/50 bg-rose-600/10 text-rose-100 hover:bg-rose-600/20'
                    : 'border-aqua-600/50 bg-aqua-600/10 text-aqua-100 hover:bg-aqua-600/20'
                }`}
                onClick={handleAddDoor}
                disabled={!selectedRoom || !selectedRoom.roomShell?.points || selectedRoom.roomShell.points.length < 3}
              >
                {isDoorPlacementMode ? '✕ Cancel' : '🚪 Add Door'}
              </button>
              {isDoorPlacementMode && (
                <div className="rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur px-4 py-3 text-xs text-slate-300 shadow-lg">
                  Click on a wall to place a door
                </div>
              )}
              {(selectedRoom?.doors?.length ?? 0) > 0 && (
                <div className="rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur px-4 py-3 text-xs text-slate-300 shadow-lg">
                  {selectedRoom?.doors?.length} door{(selectedRoom?.doors?.length ?? 0) !== 1 ? 's' : ''} placed
                </div>
              )}
            </div>
          )}

          {/* Furniture Controls (furniture step only) */}
          {currentStep === 'furniture' && (
            <div className="absolute top-24 left-6 z-40 flex flex-col gap-2">
              <button
                className={`rounded-xl border px-4 py-2.5 text-sm font-semibold shadow-lg transition-all active:scale-95 ${
                  showFurnitureLibrary
                    ? 'border-purple-600/50 bg-purple-600/20 text-purple-100'
                    : 'border-aqua-600/50 bg-aqua-600/10 text-aqua-100 hover:bg-aqua-600/20'
                }`}
                onClick={() => {
                  setShowFurnitureLibrary((v) => !v);
                  setSelectedFurnitureId(null);
                }}
                disabled={!selectedRoom}
              >
                🪑 Add Furniture
              </button>
              {(selectedRoom?.furniture?.length ?? 0) > 0 && (
                <div className="rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur px-4 py-3 text-xs text-slate-300 shadow-lg">
                  {selectedRoom?.furniture?.length} item{(selectedRoom?.furniture?.length ?? 0) !== 1 ? 's' : ''} placed
                </div>
              )}
            </div>
          )}

          {/* Zone List Toggle Button (zones step only) */}
          {currentStep === 'zones' && (
            <div className="absolute top-24 left-6 z-40 space-y-3">
              <button
                className={`rounded-xl border backdrop-blur px-6 py-3 text-sm font-semibold shadow-lg transition-all hover:shadow-xl active:scale-95 ${
                  polygonModeStatus.enabled
                    ? 'border-violet-600/50 bg-violet-600/10 text-violet-100 hover:bg-violet-600/20'
                    : 'border-aqua-600/50 bg-aqua-600/10 text-aqua-100 hover:bg-aqua-600/20'
                }`}
                onClick={() => setShowZoneList(!showZoneList)}
              >
                {showZoneList ? '✕ Hide' : '☰ Show'} {polygonModeStatus.enabled ? `Polygon Zones (${polygonZones.length})` : `Zone Slots (${enabledZones.length}/${displayZones.length})`}
              </button>

              {/* Polygon mode prompt - show when supported but not enabled */}
              {showPolygonPrompt && !polygonModeStatus.enabled && (
                <div className="max-w-sm rounded-xl border border-violet-500/50 bg-slate-900/95 backdrop-blur p-4 shadow-xl">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-violet-500/20 flex items-center justify-center">
                      <svg className="w-4 h-4 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-semibold text-violet-200">Enable Polygon Zones?</h4>
                      <p className="text-xs text-slate-400 mt-1 mb-3">
                        Your device supports polygon zones for more precise detection. Enable now?
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={handleEnablePolygonMode}
                          disabled={togglingPolygonMode}
                          className="rounded-lg bg-violet-600 hover:bg-violet-500 px-3 py-1.5 text-xs font-semibold text-white transition-all disabled:opacity-50"
                        >
                          {togglingPolygonMode ? 'Enabling...' : 'Yes, Enable'}
                        </button>
                        <button
                          onClick={handleKeepRectangularZones}
                          disabled={togglingPolygonMode}
                          className="rounded-lg border border-slate-600 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 transition-all disabled:opacity-50"
                        >
                          No Thanks
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Polygon mode active indicator */}
              {polygonModeStatus.enabled && (
                <div className="max-w-sm rounded-xl border border-emerald-500/30 bg-slate-900/95 backdrop-blur p-3 shadow-lg">
                  <div className="flex items-center gap-2 text-xs text-emerald-300">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="font-semibold">Polygon Mode Active</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Rotation Control (placement step only) */}
          {currentStep === 'placement' && selectedRoom?.devicePlacement && (
            <div className="absolute top-24 left-6 z-40 space-y-3">
              <div className="rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur p-4 shadow-lg">
                <label className="flex items-center gap-3 text-xs text-slate-200">
                  <span className="font-semibold text-slate-300">Rotation:</span>
                  <input
                    type="range"
                    min="0"
                    max="359"
                    value={selectedRoom.devicePlacement.rotationDeg ?? 0}
                    onChange={(e) => {
                      handleDevicePlacementChange({
                        ...selectedRoom.devicePlacement!,
                        rotationDeg: parseInt(e.target.value),
                      });
                    }}
                    onMouseUp={(e) => {
                      handleRotationSuggestion(Number((e.currentTarget as HTMLInputElement).value) || 0);
                    }}
                    onTouchEnd={(e) => {
                      handleRotationSuggestion(Number((e.currentTarget as HTMLInputElement).value) || 0);
                    }}
                    className="flex-1"
                  />
                  <span className="w-12 text-right font-mono font-semibold">{selectedRoom.devicePlacement.rotationDeg ?? 0}°</span>
                </label>
              </div>
              <div className="rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur p-3 shadow-lg">
                <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={clipRadarToWalls}
                    onChange={(e) => setClipRadarToWalls(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-700 bg-slate-800 text-aqua-500"
                  />
                  <span className="font-semibold">Clip radar to walls</span>
                </label>
              </div>
            </div>
          )}

          {/* Floating Next Button (bottom center) */}
          {canNext && (
            <button
              onClick={nextStep}
              className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 group rounded-xl bg-gradient-to-r from-aqua-600 to-aqua-500 px-8 py-3 text-sm font-bold text-white shadow-xl shadow-aqua-500/30 transition-all hover:shadow-2xl hover:shadow-aqua-500/40 active:scale-95"
            >
              <span className="flex items-center gap-2">
                Next <span className="inline-block transition-transform group-hover:translate-x-1">→</span>
              </span>
            </button>
          )}

          {/* Floating Zone List Panel (zones step only - slides in from right) */}
          {currentStep === 'zones' && showZoneList && (
            <div className="absolute top-0 right-0 bottom-0 z-50 w-96 border-l border-slate-700 bg-slate-900/95 backdrop-blur shadow-2xl animate-in slide-in-from-right-4 fade-in overflow-y-auto">
              <div className="sticky top-0 z-10 border-b border-slate-700 bg-slate-900/90 backdrop-blur p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-white">
                    {polygonModeStatus.enabled ? 'Polygon Zones' : 'Zone Slots'}
                  </h3>
                  <button
                    onClick={() => setShowZoneList(false)}
                    className="rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-1.5 text-sm text-slate-200 transition-colors hover:border-slate-600 hover:bg-slate-700"
                  >
                    ✕ Close
                  </button>
                </div>
                <div className="mt-2 text-xs text-slate-400">
                  {polygonModeStatus.enabled
                    ? `${polygonZones.length} polygon zones configured`
                    : `${enabledZones.length} of ${displayZones.length} slots active`
                  }
                </div>
              </div>
              <div className="p-4 space-y-3">
                {polygonModeStatus.enabled ? (
                  // Polygon zones list
                  polygonZones.length === 0 ? (
                    <div className="text-sm text-slate-400 py-4 text-center">
                      <p>No polygon zones configured.</p>
                      <p className="text-xs mt-2">Draw zones directly on the canvas by clicking to add vertices.</p>
                    </div>
                  ) : (
                    polygonZones.map((zone) => (
                      <div
                        key={zone.id}
                        onClick={() => setSelectedZoneId(zone.id)}
                        className={`rounded-lg border p-3 transition-all cursor-pointer ${
                          selectedZoneId === zone.id
                            ? 'border-violet-500 bg-violet-500/20 ring-1 ring-violet-500'
                            : zone.type === 'regular'
                            ? 'border-aqua-600/50 bg-aqua-600/10 hover:border-aqua-500'
                            : zone.type === 'exclusion'
                            ? 'border-rose-600/50 bg-rose-600/10 hover:border-rose-500'
                            : 'border-amber-600/50 bg-amber-600/10 hover:border-amber-500'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-bold text-white">{zone.id}</span>
                          <span className="text-xs text-slate-400">{zone.vertices.length} vertices</span>
                        </div>
                        <div className="text-xs text-slate-500 mt-1">
                          Type: {zone.type}
                        </div>
                      </div>
                    ))
                  )
                ) : (
                  // Rectangular zones list
                  displayZones.map((zone) => (
                    <div
                      key={zone.id}
                      className={`rounded-lg border ${
                        zone.enabled
                          ? zone.type === 'regular'
                            ? 'border-aqua-600/50 bg-aqua-600/10'
                            : zone.type === 'exclusion'
                            ? 'border-rose-600/50 bg-rose-600/10'
                            : 'border-amber-600/50 bg-amber-600/10'
                          : 'border-slate-700 bg-slate-800/30'
                      } p-3 transition-all`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-bold ${zone.enabled ? 'text-white' : 'text-slate-400'}`}>
                            {zone.id}
                            {zone.type === 'entry' && entryZonesAvailable === false && ' ⚠️'}
                          </span>
                          {!zone.enabled && (
                            <span className="text-xs text-slate-500">(Disabled)</span>
                          )}
                        </div>
                        <button
                          onClick={() => {
                            // Block enabling entry zones if firmware doesn't support it
                            if (!zone.enabled && zone.type === 'entry' && entryZonesAvailable === false) return;
                            if (zone.enabled) {
                              disableZoneSlot(zone.id);
                            } else {
                              enableZoneSlot(zone.id);
                            }
                          }}
                          disabled={!zone.enabled && zone.type === 'entry' && entryZonesAvailable === false}
                          className={`rounded-lg px-3 py-1 text-xs font-semibold transition-all ${
                            zone.enabled
                              ? 'border border-slate-600 bg-slate-700 text-slate-200 hover:bg-slate-600'
                              : !zone.enabled && zone.type === 'entry' && entryZonesAvailable === false
                              ? 'border border-amber-600 bg-amber-600/20 text-amber-100 opacity-60 cursor-not-allowed'
                              : 'border border-emerald-600 bg-emerald-600/20 text-emerald-100 hover:bg-emerald-600/30'
                          }`}
                          title={zone.type === 'entry' && entryZonesAvailable === false
                            ? 'Entry Zones require a firmware update. Please update your device firmware to use this feature.'
                            : undefined}
                        >
                          {zone.enabled ? 'Disable' : 'Enable'}
                        </button>
                      </div>
                      {zone.enabled && (
                        <ZoneEditor
                          key={zone.id}
                          zone={zone}
                          onChange={(updated) => {
                            const newDisplayZones = displayZones.map((z) =>
                              z.id === updated.id ? { ...updated, enabled: true } : z
                            );
                            handleZonesChange(newDisplayZones.filter(z => z.enabled));
                          }}
                          onDelete={(id) => {
                            const newZones = displayZones.filter(z => z.id !== id || !z.enabled);
                            handleZonesChange(newZones.filter(z => z.enabled));
                            if (selectedZoneId === id) {
                              const remaining = newZones.filter(z => z.enabled);
                              setSelectedZoneId(remaining[0]?.id ?? null);
                            }
                          }}
                        />
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Door Editor Panel (doors step only - slides in from right) */}
          {currentStep === 'doors' && selectedDoor && (
            <DoorEditor
              door={selectedDoor}
              onChange={handleDoorChange}
              onDelete={() => handleDoorDelete(selectedDoor.id)}
              onClose={() => setSelectedDoorId(null)}
              maxSegmentIndex={Math.max(0, (selectedRoom?.roomShell?.points?.length ?? 1) - 1)}
            />
          )}

          {/* Furniture Library Panel (furniture step only) */}
          {currentStep === 'furniture' && showFurnitureLibrary && (
            <FurnitureLibrary
              onSelect={handleAddFurniture}
              onClose={() => setShowFurnitureLibrary(false)}
            />
          )}

          {/* Furniture Editor Panel (furniture step only) */}
          {currentStep === 'furniture' && selectedFurniture && (
            <FurnitureEditor
              furniture={selectedFurniture}
              onChange={handleFurnitureChange}
              onDelete={() => handleFurnitureDelete(selectedFurniture.id)}
              onClose={() => setSelectedFurnitureId(null)}
            />
          )}
        </div>
      </div>
    );
  }

  // Regular wizard layout for non-canvas steps
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header with glassmorphic effect */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-800/50 bg-gradient-to-br from-slate-900/90 to-slate-900/70 p-6 backdrop-blur-xl shadow-2xl">
        <div className="absolute inset-0 bg-gradient-to-br from-aqua-500/5 to-transparent" />
        <div className="relative flex items-center justify-between">
          <div>
            <h2 className="font-display text-3xl font-bold text-white tracking-tight">Setup Wizard</h2>
            <p className="mt-1 text-sm text-slate-400">Configure your device in just a few steps</p>
          </div>
          <div className="flex items-center gap-3">
            <ThemeSwitcher compact />
            {onBack && (
              <button
                className="group rounded-xl border border-slate-700/50 bg-slate-800/50 px-4 py-2.5 text-sm font-semibold text-slate-100 backdrop-blur transition-all hover:border-aqua-500/50 hover:bg-slate-800 hover:shadow-lg hover:shadow-aqua-500/10 active:scale-95"
                onClick={onBack}
              >
                <span className="inline-block transition-transform group-hover:-translate-x-0.5">←</span> Dashboard
              </button>
            )}
            <button
              className="group rounded-xl border border-slate-700/50 bg-slate-800/50 px-4 py-2.5 text-sm font-semibold text-slate-100 backdrop-blur transition-all hover:border-rose-500/50 hover:bg-slate-800 hover:shadow-lg hover:shadow-rose-500/10 active:scale-95"
              onClick={() => {
                setStepIndex(0);
                setError(null);
                onStepChange?.('device');
              }}
            >
              <span className="inline-block transition-transform group-hover:rotate-180 duration-300">↻</span> Restart
            </button>
          </div>
        </div>
      </div>

      {/* Progress bar with navigation */}
      <div className="rounded-xl border border-slate-800/50 bg-slate-900/50 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-sm font-semibold text-slate-300">
              Step {stepIndex + 1} of {steps.length}
            </div>
            <div className="text-xs text-slate-500">•</div>
            <div className="text-xs text-slate-400">
              {currentStep === 'device' && 'Select device'}
              {currentStep === 'entityDiscovery' && 'Discover entities'}
              {currentStep === 'roomChoice' && 'Choose room path'}
              {currentStep === 'roomDetails' && 'Bind/create room'}
              {currentStep === 'outline' && 'Draw outline'}
              {currentStep === 'doors' && 'Add doors'}
              {currentStep === 'furniture' && 'Place furniture'}
              {currentStep === 'placement' && 'Place device'}
              {currentStep === 'zones' && 'Define zones'}
              {currentStep === 'finish' && 'Finish'}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              className="group rounded-xl border border-slate-700/50 bg-slate-800/50 px-4 py-2 text-sm font-semibold text-slate-100 transition-all hover:border-slate-600 hover:bg-slate-800 hover:shadow-lg disabled:opacity-40 disabled:hover:scale-100 active:scale-95"
              onClick={prevStep}
              disabled={stepIndex === 0}
            >
              <span className="inline-block transition-transform group-hover:-translate-x-0.5">←</span> Back
            </button>
            {currentStep !== 'finish' && currentStep !== 'device' && currentStep !== 'roomChoice' && currentStep !== 'roomDetails' && (
              <button
                className="group relative overflow-hidden rounded-xl bg-gradient-to-r from-aqua-600 to-aqua-500 px-5 py-2 text-sm font-bold text-white shadow-lg shadow-aqua-500/30 transition-all hover:shadow-xl hover:shadow-aqua-500/40 disabled:opacity-50 disabled:hover:scale-100 disabled:hover:shadow-lg active:scale-95"
                onClick={nextStep}
                disabled={!canNext}
              >
                <span className="relative z-10 flex items-center gap-2">
                  Next <span className="inline-block transition-transform group-hover:translate-x-0.5">→</span>
                </span>
                {!canNext && (
                  <div className="absolute inset-0 bg-gradient-to-r from-slate-800/50 to-slate-700/50" />
                )}
              </button>
            )}
          </div>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full bg-gradient-to-r from-aqua-500 to-emerald-500 transition-all duration-500 ease-out"
            style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Error message with slide-in animation */}
      {error && (
        <div className="animate-in slide-in-from-top-2 fade-in duration-300 rounded-xl border border-rose-500/50 bg-gradient-to-br from-rose-500/10 to-rose-500/5 p-4 text-rose-100 shadow-lg shadow-rose-500/10">
          <div className="flex items-start gap-3">
            <span className="text-xl">⚠️</span>
            <div>
              <div className="font-semibold">Error</div>
              <div className="text-sm">{error}</div>
            </div>
          </div>
        </div>
      )}

      {/* Device selection step */}
      {currentStep === 'device' && (
        <div className={`${slideAnimationClass} rounded-2xl border border-slate-800/50 bg-gradient-to-br from-slate-900/90 to-slate-900/70 p-6 backdrop-blur-xl shadow-xl`}>
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xl">📡</span>
              <h3 className="text-lg font-bold text-white">Select your device</h3>
            </div>
            <p className="text-sm text-slate-400">
              Which Everything Presence device do you want to setup?
            </p>
          </div>
          {devices.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <span className="text-4xl mb-3">🔍</span>
              <p className="text-sm">No devices discovered yet.</p>
              <p className="text-xs mt-1">Make sure your device is powered on and connected to the network.</p>
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            {devices.map((d) => {
              const isAssigned = rooms.some((r) => r.deviceId === d.id);
              const assignedRoom = rooms.find((r) => r.deviceId === d.id);

              return (
                <div
                  key={d.id}
                  title={isAssigned ? `Already assigned to room "${assignedRoom?.name}"` : ''}
                  className={`group rounded-xl border px-4 py-3 transition-all duration-200 ${
                    deviceId === d.id
                      ? 'border-aqua-500 bg-aqua-500/10 shadow-lg shadow-aqua-500/20 scale-102'
                      : isAssigned
                      ? 'border-slate-800 bg-slate-900/30 opacity-50 cursor-not-allowed'
                      : 'border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900/80 hover:scale-102 cursor-pointer'
                  }`}
                  onClick={() => {
                    if (isAssigned) return;
                    setDeviceId(d.id);
                    if (d.model) {
                      // Try to match profile by model field (exact match with HA's device.model)
                      const match = profiles.find((p) => (p as any).model === d.model);
                      if (match) setProfileId(match.id);
                    }
                    // Auto-advance after brief delay for visual feedback
                    setTimeout(() => nextStep(), 600);
                  }}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-white flex items-center gap-2">
                        {d.name}
                        {deviceId === d.id && <span className="text-xs">✓</span>}
                        {isAssigned && <span className="text-xs text-slate-500">🔒</span>}
                      </div>
                      <div className="text-xs text-slate-400 mt-1">
                        {d.model ?? 'Unknown model'}
                        {d.firmwareVersion && <span className="text-slate-500"> • v{d.firmwareVersion}</span>}
                      </div>
                      {d.areaName && (
                        <div className="text-xs text-slate-500 mt-0.5">
                          HA Area: {d.areaName}
                        </div>
                      )}
                      {isAssigned && (
                        <div className="text-xs text-amber-500/80 mt-0.5">
                          Already configured in "{assignedRoom?.name}"
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Entity Discovery step */}
      {currentStep === 'entityDiscovery' && deviceId && profileId && (
        <div className={`${slideAnimationClass} h-full`}>
          <EntityDiscovery
            deviceId={deviceId}
            profileId={profileId}
            deviceName={selectedDevice?.name ?? 'Unknown Device'}
            onComplete={handleEntityDiscoveryComplete}
            onCancel={handleEntityDiscoveryCancel}
            onBack={prevStep}
          />
        </div>
      )}

      {/* Room choice step */}
      {currentStep === 'roomChoice' && (
        <div className={`${slideAnimationClass} rounded-2xl border border-slate-800/50 bg-gradient-to-br from-slate-900/90 to-slate-900/70 p-6 backdrop-blur-xl shadow-xl`}>
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xl">🏠</span>
              <h3 className="text-lg font-bold text-white">Room setup</h3>
            </div>
            <p className="text-sm text-slate-400">Create a new room, use an existing one, or skip room setup (generic radar).</p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div
              className={`group cursor-pointer rounded-xl border p-5 transition-all duration-200 ${
                roomPath === 'new'
                  ? 'border-aqua-500 bg-aqua-500/10 shadow-lg shadow-aqua-500/20 scale-105'
                  : 'border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900/80 hover:scale-102'
              }`}
              onClick={() => {
                setRoomPath('new');
                setTimeout(() => nextStep(), 600);
              }}
            >
              <div className="text-center">
                <div className="text-3xl mb-3">✨</div>
                <div className="text-sm font-bold text-white mb-2">New room</div>
                <div className="text-xs text-slate-400">Name it, pick units, and draw the outline.</div>
                {roomPath === 'new' && (
                  <div className="mt-3 inline-flex items-center gap-1 rounded-full bg-aqua-500/20 px-3 py-1 text-xs font-semibold text-aqua-100">
                    ✓ Selected
                  </div>
                )}
              </div>
            </div>
            <div
              className={`group cursor-pointer rounded-xl border p-5 transition-all duration-200 ${
                roomPath === 'existing'
                  ? 'border-aqua-500 bg-aqua-500/10 shadow-lg shadow-aqua-500/20 scale-105'
                  : 'border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900/80 hover:scale-102'
              }`}
              onClick={() => {
                setRoomPath('existing');
                setTimeout(() => nextStep(), 600);
              }}
            >
              <div className="text-center">
                <div className="text-3xl mb-3">📁</div>
                <div className="text-sm font-bold text-white mb-2">Use existing</div>
                <div className="text-xs text-slate-400">Select a room already created.</div>
                {roomPath === 'existing' && (
                  <div className="mt-3 inline-flex items-center gap-1 rounded-full bg-aqua-500/20 px-3 py-1 text-xs font-semibold text-aqua-100">
                    ✓ Selected
                  </div>
                )}
              </div>
            </div>
            <div
              className={`group cursor-pointer rounded-xl border p-5 transition-all duration-200 ${
                roomPath === 'skip'
                  ? 'border-aqua-500 bg-aqua-500/10 shadow-lg shadow-aqua-500/20 scale-105'
                  : 'border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900/80 hover:scale-102'
              }`}
              onClick={async () => {
                setRoomPath('skip');
                // Create a generic room for skip mode with device placement
                try {
                  // Create room with device placement already set
                  const room = await onCreateRoom('Generic Radar', deviceId, profileId);

                  // Calculate offset to center device + FOV together
                  // For 90° rotation (pointing down), shift device up by half the max range
                  const maxRangeMeters = currentProfile?.limits?.maxRangeMeters ?? 6;
                  const maxRangeMm = maxRangeMeters * 1000;
                  const offsetY = -maxRangeMm / 2; // Negative Y shifts upward (device moves up, FOV extends down)

                  // Immediately update with device placement before advancing
                  const updatedRoomData: RoomConfig = {
                    ...room,
                    devicePlacement: {
                      x: 0,
                      y: offsetY,
                      rotationDeg: 90,
                    },
                  };

                  // Save to backend
                  await updateRoom(room.id, updatedRoomData);

                  // Update parent state
                  onRoomUpdate(updatedRoomData);

                  // Set local room ID (this will cause selectedRoom to update on next render)
                  setRoomId(room.id);
                  onSelectRoom(room.id, room.profileId ?? profileId ?? null);

                  // Wait a bit longer for state to propagate before advancing
                  setTimeout(() => nextStep(), 800);
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Failed to create generic room');
                }
              }}
            >
              <div className="text-center">
                <div className="text-3xl mb-3">⚡</div>
                <div className="text-sm font-bold text-white mb-2">Skip room</div>
                <div className="text-xs text-slate-400">Go straight to a generic radar and zone drawing.</div>
                {roomPath === 'skip' && (
                  <div className="mt-3 inline-flex items-center gap-1 rounded-full bg-aqua-500/20 px-3 py-1 text-xs font-semibold text-aqua-100">
                    ✓ Selected
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {currentStep === 'roomDetails' && roomPath !== 'skip' && (
        <div className={`${slideAnimationClass} rounded-2xl border border-slate-800/50 bg-gradient-to-br from-slate-900/90 to-slate-900/70 p-6 backdrop-blur-xl shadow-xl space-y-4`}>
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xl">{roomPath === 'new' ? '✨' : '📁'}</span>
              <h3 className="text-lg font-bold text-white">{roomPath === 'new' ? 'Create a new room' : 'Select a room'}</h3>
            </div>
            <p className="text-sm text-slate-400">
              {roomPath === 'new' ? 'Name your room and select units. You\'ll draw the outline next.' : 'Choose an existing room to configure with your device.'}
            </p>
          </div>
          {roomPath === 'existing' && (
            <div className="grid gap-3 md:grid-cols-3">
              {rooms.map((room) => {
                const hasDevice = room.deviceId !== undefined && room.deviceId !== null;
                const assignedDevice = hasDevice ? devices.find((d) => d.id === room.deviceId) : null;

                return (
                  <div
                    key={room.id}
                    title={hasDevice ? `Already has device "${assignedDevice?.name ?? room.deviceId}"` : ''}
                    className={`group rounded-xl border px-4 py-3 transition-all duration-200 ${
                      roomId === room.id
                        ? 'border-aqua-500 bg-aqua-500/10 shadow-lg shadow-aqua-500/20 scale-102'
                        : hasDevice
                        ? 'border-slate-800 bg-slate-900/30 opacity-50 cursor-not-allowed'
                        : 'border-slate-800 bg-slate-900/60 cursor-pointer hover:border-slate-700 hover:bg-slate-900/80 hover:scale-102'
                    }`}
                    onClick={() => {
                      if (hasDevice) return;
                      setRoomId(room.id);
                      if (room.profileId) setProfileId(room.profileId);
                      onSelectRoom(room.id, room.profileId ?? profileId ?? null);
                      // Auto-advance to next step after brief delay for visual feedback
                      setTimeout(() => {
                        nextStep();
                      }, 600);
                    }}
                  >
                    <div className="text-sm font-semibold text-white flex items-center gap-2">
                      {room.name}
                      {roomId === room.id && <span className="text-xs text-aqua-400">✓</span>}
                      {hasDevice && <span className="text-xs text-slate-500">🔒</span>}
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      {room.profileId ? `Profile: ${room.profileId}` : 'No profile'}
                      {hasDevice && <span className="text-xs text-slate-500 ml-2">• Device: {assignedDevice?.name ?? room.deviceId}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {roomPath === 'new' && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Room Name</label>
                <input
                  className="w-full rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-3 text-sm text-white placeholder-slate-500 focus:border-aqua-500 focus:outline-none focus:ring-1 focus:ring-aqua-500/50 transition-all"
                  placeholder="e.g. Living Room, Kitchen, Bedroom..."
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Units</label>
                <div className="flex items-center gap-2">
                  <button
                    className={`flex-1 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all ${
                      units === 'metric'
                        ? 'border-aqua-500 bg-aqua-500/10 text-aqua-100 shadow-lg shadow-aqua-500/10'
                        : 'border-slate-700 bg-slate-800/50 text-slate-300 hover:border-slate-600 hover:bg-slate-800'
                    }`}
                    onClick={() => setUnits('metric')}
                  >
                    Metric (m)
                  </button>
                  <button
                    className={`flex-1 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all ${
                      units === 'imperial'
                        ? 'border-aqua-500 bg-aqua-500/10 text-aqua-100 shadow-lg shadow-aqua-500/10'
                        : 'border-slate-700 bg-slate-800/50 text-slate-300 hover:border-slate-600 hover:bg-slate-800'
                    }`}
                    onClick={() => setUnits('imperial')}
                  >
                    Imperial (ft)
                  </button>
                </div>
              </div>
              <button
                className="w-full rounded-xl bg-gradient-to-r from-aqua-600 to-aqua-500 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-aqua-500/30 transition-all hover:shadow-xl hover:shadow-aqua-500/40 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
                onClick={handleCreateRoom}
                disabled={creating || !newRoomName.trim()}
              >
                {creating ? 'Creating...' : 'Create Room & Continue'}
              </button>
            </div>
          )}
        </div>
      )}

      {currentStep === 'roomDetails' && roomPath === 'skip' && (
        <div className={`${slideAnimationClass} rounded-2xl border border-slate-800/50 bg-gradient-to-br from-slate-900/90 to-slate-900/70 p-6 backdrop-blur-xl shadow-xl`}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xl">⚡</span>
            <h3 className="text-lg font-bold text-white">Quick Setup Mode</h3>
          </div>
          <p className="text-sm text-slate-400">
            Generic radar selected. Room outline and device placement will be skipped. You can still configure detection zones on the next step.
          </p>
        </div>
      )}

      {currentStep === 'outline' && roomPath !== 'skip' && (
        <div className={`${slideAnimationClass} space-y-4`}>
          <div className="rounded-2xl border border-slate-800/50 bg-gradient-to-br from-slate-900/90 to-slate-900/70 p-6 backdrop-blur-xl shadow-xl">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xl">✏️</span>
              <h3 className="text-lg font-bold text-white">Draw room outline</h3>
            </div>
            <p className="text-sm text-slate-400">
              Click on the canvas to add wall corners. You need at least 3 points to form a room outline.
            </p>
          </div>

          <div
            className="relative -mx-[calc((100vw-min(1152px,100vw))/2+1.5rem)] border-y border-slate-800 bg-slate-950/70 overflow-hidden"
            style={{ height: 'calc(100vh - 380px)', minHeight: '500px' }}
            onWheelCapture={(e) => {
              if (e.cancelable) e.preventDefault();
              e.stopPropagation();
              const delta = e.deltaY > 0 ? -0.1 : 0.1;
              setCanvasZoom((z) => Math.min(5, Math.max(0.1, z + delta)));
            }}
          >
            <RoomCanvas
              points={selectedRoom?.roomShell?.points ?? []}
              onChange={handleRoomOutlineChange}
              onCanvasClick={wallDrawingClick}
              onCanvasMove={wallDrawingMove}
              previewFrom={pendingStart}
              previewTo={pendingStart && previewPoint ? previewPoint : null}
              rangeMm={15000}
              snapGridMm={canvasSnap}
              height="100%"
              zoom={canvasZoom}
              panOffsetMm={canvasPan}
              onPanChange={setCanvasPan}
              displayUnits={units}
            />

            {/* Zoom controls */}
            <div className="pointer-events-auto absolute top-3 right-3 flex flex-col gap-1.5">
              <button
                className="rounded-lg border border-slate-700/50 bg-slate-900/90 backdrop-blur px-3 py-2 text-xs font-semibold text-slate-100 shadow-lg transition-all hover:border-aqua-500 hover:bg-slate-800 active:scale-95"
                onClick={() => setCanvasZoom((z) => Math.min(5, z + 0.2))}
              >
                Zoom +
              </button>
              <button
                className="rounded-lg border border-slate-700/50 bg-slate-900/90 backdrop-blur px-3 py-2 text-xs font-semibold text-slate-100 shadow-lg transition-all hover:border-aqua-500 hover:bg-slate-800 active:scale-95"
                onClick={() => setCanvasZoom((z) => Math.max(0.1, z - 0.2))}
              >
                Zoom -
              </button>
              <button
                className="rounded-lg border border-slate-700/50 bg-slate-900/90 backdrop-blur px-3 py-2 text-xs font-semibold text-slate-100 shadow-lg transition-all hover:border-aqua-500 hover:bg-slate-800 active:scale-95"
                onClick={() => {
                  setCanvasZoom(1);
                  setCanvasPan({ x: 0, y: 0 });
                }}
              >
                Reset
              </button>
            </div>

            {/* Snap controls */}
            <div className="pointer-events-auto absolute bottom-3 left-3 right-3 flex flex-wrap items-center gap-3 rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur px-4 py-3 text-xs shadow-lg">
              <span className="text-slate-400 font-medium">Snap:</span>
              {[0, 50, 100, 200].map((v) => (
                <button
                  key={v}
                  className={`rounded-lg border px-3 py-1.5 font-semibold transition-all active:scale-95 ${
                    canvasSnap === v
                      ? 'border-aqua-500 bg-aqua-500/10 text-aqua-100'
                      : 'border-slate-700 text-slate-300 hover:border-slate-600 hover:bg-slate-800'
                  }`}
                  onClick={() => setCanvasSnap(v)}
                >
                  {v === 0 ? 'Off' : `${v}mm`}
                </button>
              ))}
              <span className="ml-auto text-slate-500">Click to add points • Right-drag to pan • Wheel to zoom</span>
            </div>
          </div>

          {selectedRoom?.roomShell && (selectedRoom.roomShell.points?.length ?? 0) > 0 && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 text-sm text-slate-300 flex items-center gap-2">
              <span className="text-aqua-400">✓</span>
              Room outline: {selectedRoom.roomShell.points.length} points drawn
              {(selectedRoom.roomShell.points?.length ?? 0) < 3 && <span className="text-amber-400 ml-2">(need at least 3)</span>}
            </div>
          )}
        </div>
      )}

      {currentStep === 'placement' && roomPath !== 'skip' && (
        <div className={`${slideAnimationClass} space-y-4`}>
          <div className="rounded-2xl border border-slate-800/50 bg-gradient-to-br from-slate-900/90 to-slate-900/70 p-6 backdrop-blur-xl shadow-xl">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xl">📍</span>
              <h3 className="text-lg font-bold text-white">Place your device</h3>
            </div>
            <p className="text-sm text-slate-400">
              Drag the device marker to position it in your room. Use the slider to rotate the device. The green overlay shows the device's coverage area.
            </p>
          </div>

          <div
            className="relative -mx-[calc((100vw-min(1152px,100vw))/2+1.5rem)] border-y border-slate-800 bg-slate-950/70 overflow-hidden"
            style={{ height: 'calc(100vh - 380px)', minHeight: '500px' }}
            onWheelCapture={(e) => {
              if (e.cancelable) e.preventDefault();
              e.stopPropagation();
              const delta = e.deltaY > 0 ? -0.1 : 0.1;
              setCanvasZoom((z) => Math.min(5, Math.max(0.1, z + delta)));
            }}
          >
            <RoomCanvas
              points={selectedRoom?.roomShell?.points ?? []}
              onChange={() => {}}
              lockShell={true}
              devicePlacement={
                selectedRoom?.devicePlacement ?? {
                  x: 0,
                  y: 0,
                  rotationDeg: 0,
                }
              }
              onDeviceChange={handleDevicePlacementChange}
              fieldOfViewDeg={currentProfile?.limits?.fieldOfViewDegrees}
              maxRangeMeters={currentProfile?.limits?.maxRangeMeters}
              deviceIconUrl={currentProfile?.iconUrl}
              clipRadarToWalls={clipRadarToWalls}
              rangeMm={15000}
              snapGridMm={canvasSnap}
              height="100%"
              zoom={canvasZoom}
              panOffsetMm={canvasPan}
              onPanChange={setCanvasPan}
              displayUnits={units}
            />

            {/* Zoom controls */}
            <div className="pointer-events-auto absolute top-3 right-3 flex flex-col gap-1.5">
              <button
                className="rounded-lg border border-slate-700/50 bg-slate-900/90 backdrop-blur px-3 py-2 text-xs font-semibold text-slate-100 shadow-lg transition-all hover:border-aqua-500 hover:bg-slate-800 active:scale-95"
                onClick={() => setCanvasZoom((z) => Math.min(5, z + 0.2))}
              >
                Zoom +
              </button>
              <button
                className="rounded-lg border border-slate-700/50 bg-slate-900/90 backdrop-blur px-3 py-2 text-xs font-semibold text-slate-100 shadow-lg transition-all hover:border-aqua-500 hover:bg-slate-800 active:scale-95"
                onClick={() => setCanvasZoom((z) => Math.max(0.1, z - 0.2))}
              >
                Zoom -
              </button>
              <button
                className="rounded-lg border border-slate-700/50 bg-slate-900/90 backdrop-blur px-3 py-2 text-xs font-semibold text-slate-100 shadow-lg transition-all hover:border-aqua-500 hover:bg-slate-800 active:scale-95"
                onClick={() => {
                  setCanvasZoom(1);
                  setCanvasPan({ x: 0, y: 0 });
                }}
              >
                Reset
              </button>
            </div>

            {/* Snap controls */}
            <div className="pointer-events-auto absolute bottom-3 left-3 right-3 flex flex-wrap items-center gap-3 rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur px-4 py-3 text-xs shadow-lg">
              <span className="text-slate-400 font-medium">Snap:</span>
              {[0, 50, 100, 200].map((v) => (
                <button
                  key={v}
                  className={`rounded-lg border px-3 py-1.5 font-semibold transition-all active:scale-95 ${
                    canvasSnap === v
                      ? 'border-aqua-500 bg-aqua-500/10 text-aqua-100'
                      : 'border-slate-700 text-slate-300 hover:border-slate-600 hover:bg-slate-800'
                  }`}
                  onClick={() => setCanvasSnap(v)}
                >
                  {v === 0 ? 'Off' : `${v}mm`}
                </button>
              ))}
              <span className="ml-auto text-slate-500">Drag device • Right-drag to pan • Wheel to zoom</span>
            </div>
          </div>

          {/* Rotation slider */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <label className="flex items-center gap-4 text-sm text-slate-300">
              <span className="whitespace-nowrap font-medium">Rotation:</span>
              <input
                type="range"
                min={-180}
                max={180}
                step={1}
                value={selectedRoom?.devicePlacement?.rotationDeg ?? 0}
                onChange={(e) => {
                  const rotationDeg = Number(e.target.value) || 0;
                  handleDevicePlacementChange({
                    ...(selectedRoom?.devicePlacement ?? { x: 0, y: 0 }),
                    rotationDeg,
                  });
                }}
                onMouseUp={(e) => {
                  handleRotationSuggestion(Number((e.currentTarget as HTMLInputElement).value) || 0);
                }}
                onTouchEnd={(e) => {
                  handleRotationSuggestion(Number((e.currentTarget as HTMLInputElement).value) || 0);
                }}
                className="flex-1"
              />
              <span className="w-14 text-right font-mono font-semibold text-aqua-400">{selectedRoom?.devicePlacement?.rotationDeg ?? 0}°</span>
            </label>
          </div>

          {/* Radar clipping toggle */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <label className="flex items-center gap-3 text-sm text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={clipRadarToWalls}
                onChange={(e) => setClipRadarToWalls(e.target.checked)}
                className="h-4 w-4 rounded border-slate-700 bg-slate-800 text-aqua-500 focus:ring-aqua-500"
              />
              <span className="font-medium">Clip radar overlay to walls</span>
              <span className="ml-auto text-slate-500 text-xs">(radar stops at walls when enabled)</span>
            </label>
          </div>

          {/* Position display */}
          {selectedRoom?.devicePlacement && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 text-sm text-slate-300 flex items-center gap-2">
              <span className="text-aqua-400">✓</span>
              Device placed at ({(selectedRoom.devicePlacement.x / 1000).toFixed(2)}m,{' '}
              {(selectedRoom.devicePlacement.y / 1000).toFixed(2)}m), rotation:{' '}
              {selectedRoom.devicePlacement.rotationDeg ?? 0}°
            </div>
          )}
        </div>
      )}

      {currentStep === 'zones' && (
        <div className={`${slideAnimationClass} space-y-4`}>
          <div className="rounded-2xl border border-slate-800/50 bg-gradient-to-br from-slate-900/90 to-slate-900/70 p-6 backdrop-blur-xl shadow-xl">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xl">🎯</span>
              <h3 className="text-lg font-bold text-white">Configure detection zones</h3>
            </div>
            <p className="text-sm text-slate-400">
              {isRoomMode
                ? 'Drag zones to position them over areas you want to monitor. Furniture and doors are shown for reference. Enable additional zones below if needed.'
                : 'Drag zones to position them in your detection area. Enable additional zone slots below if needed (zones are optional in skip mode).'}
            </p>
          </div>

          {/* Polygon mode status/prompt */}
          {polygonModeStatus.enabled && (
            <div className="rounded-xl border border-emerald-500/30 bg-gradient-to-r from-emerald-500/10 to-green-500/10 p-4">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                  <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-semibold text-emerald-200">Polygon Mode Active</h4>
                  <p className="text-xs text-slate-400 mt-1">
                    You're using polygon zones for precise detection areas. Drag vertices to reshape zones, or click on edges to add new vertices.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Polygon mode prompt when supported but not enabled */}
          {showPolygonPrompt && !polygonModeStatus.enabled && (
            <div className="rounded-xl border border-violet-500/50 bg-gradient-to-r from-violet-500/15 to-purple-500/15 p-4">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-violet-500/20 flex items-center justify-center">
                  <svg className="w-5 h-5 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-semibold text-violet-200">Enable Polygon Zones?</h4>
                  <p className="text-xs text-slate-400 mt-1 mb-3">
                    Your device supports polygon zones for more precise detection areas. Would you like to enable polygon mode? Your existing zones will be converted to polygons.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={handleEnablePolygonMode}
                      disabled={togglingPolygonMode}
                      className="rounded-lg bg-violet-600 hover:bg-violet-500 px-4 py-1.5 text-xs font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {togglingPolygonMode ? 'Enabling...' : 'Yes, Enable Polygon Mode'}
                    </button>
                    <button
                      onClick={handleKeepRectangularZones}
                      disabled={togglingPolygonMode}
                      className="rounded-lg border border-slate-600 bg-slate-800 hover:bg-slate-700 px-4 py-1.5 text-xs font-semibold text-slate-200 transition-all disabled:opacity-50"
                    >
                      No, Keep Rectangular Zones
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Static banner when polygon zones available but user dismissed prompt */}
          {polygonZonesAvailable === true && !polygonModeStatus.enabled && !showPolygonPrompt && (
            <div className="rounded-xl border border-slate-700/50 bg-slate-900/50 p-3">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <svg className="w-4 h-4 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>Polygon zones are available for this device. You can enable them in the Live Tracking page.</span>
              </div>
            </div>
          )}

          {/* Zone slots list - show polygon zones when polygon mode is enabled */}
          {polygonModeStatus.enabled ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-3 max-h-48 overflow-y-auto">
              <div className="text-xs font-semibold text-slate-300 mb-2">
                Polygon Zones ({polygonZones.length} configured)
              </div>
              {polygonZones.length === 0 ? (
                <div className="text-xs text-slate-400 py-2">
                  No polygon zones configured. Draw zones directly on the canvas by clicking to add vertices.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {polygonZones.map((zone) => (
                    <div
                      key={zone.id}
                      onClick={() => setSelectedZoneId(zone.id)}
                      className={`flex items-center justify-between rounded-md border px-2.5 py-1.5 text-xs transition-all cursor-pointer ${
                        selectedZoneId === zone.id
                          ? 'border-violet-500 bg-violet-500/20 text-white ring-1 ring-violet-500'
                          : zone.type === 'regular'
                          ? 'border-aqua-600/50 bg-aqua-600/10 text-white hover:border-aqua-500'
                          : zone.type === 'exclusion'
                          ? 'border-rose-600/50 bg-rose-600/10 text-white hover:border-rose-500'
                          : 'border-amber-600/50 bg-amber-600/10 text-white hover:border-amber-500'
                      }`}
                    >
                      <span className="font-semibold">{zone.id}</span>
                      <span className="text-slate-400">{zone.vertices.length} vertices</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-3 max-h-48 overflow-y-auto">
              <div className="text-xs font-semibold text-slate-300 mb-2">
                Zone Slots ({enabledZones.length}/{displayZones.length} active)
              </div>
              <div className="space-y-1.5">
                {displayZones.map((zone) => (
                  <div
                    key={zone.id}
                    className={`flex items-center justify-between rounded-md border px-2.5 py-1.5 text-xs transition-all ${
                      zone.enabled
                        ? zone.type === 'regular'
                          ? 'border-aqua-600/50 bg-aqua-600/10 text-white'
                          : zone.type === 'exclusion'
                          ? 'border-rose-600/50 bg-rose-600/10 text-white'
                          : 'border-amber-600/50 bg-amber-600/10 text-white'
                        : 'border-slate-700 bg-slate-900/30 text-slate-400'
                    }`}
                  >
                    <span className="font-semibold">
                      {zone.id}
                      {zone.type === 'entry' && entryZonesAvailable === false && ' ⚠️'}
                    </span>
                    <button
                      onClick={() => {
                        // Block enabling entry zones if firmware doesn't support it
                        if (!zone.enabled && zone.type === 'entry' && entryZonesAvailable === false) return;
                        if (zone.enabled) {
                          disableZoneSlot(zone.id);
                        } else {
                          enableZoneSlot(zone.id);
                        }
                      }}
                      disabled={!zone.enabled && zone.type === 'entry' && entryZonesAvailable === false}
                      className={`rounded px-2 py-0.5 font-semibold transition-all ${
                        zone.enabled
                          ? 'border border-slate-600 bg-slate-700 text-slate-200 hover:bg-slate-600'
                          : !zone.enabled && zone.type === 'entry' && entryZonesAvailable === false
                          ? 'border border-amber-600 bg-amber-600/20 text-amber-100 opacity-60 cursor-not-allowed'
                          : 'border border-emerald-600 bg-emerald-600/20 text-emerald-100 hover:bg-emerald-600/30'
                      }`}
                      title={zone.type === 'entry' && entryZonesAvailable === false
                        ? 'Entry Zones require a firmware update. Please update your device firmware to use this feature.'
                        : undefined}
                    >
                      {zone.enabled ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Embedded ZoneCanvas */}
          <div
            className="relative -mx-[calc((100vw-min(1152px,100vw))/2+1.5rem)] border-y border-slate-800 bg-slate-950/70 overflow-hidden"
            style={{ height: 'calc(100vh - 420px)', minHeight: '500px' }}
            onWheelCapture={(e) => {
              if (e.cancelable) e.preventDefault();
              e.stopPropagation();
              const delta = e.deltaY > 0 ? -0.1 : 0.1;
              setCanvasZoom((z) => Math.min(5, Math.max(0.1, z + delta)));
            }}
          >
            <ZoneCanvas
              zones={enabledZones}
              onZonesChange={(updatedZones) => {
                // When zones change on canvas, update only the enabled ones
                const newDisplayZones = displayZones.map(z => {
                  const updated = updatedZones.find(u => u.id === z.id);
                  return updated ? { ...updated, enabled: true } : z;
                });
                handleZonesChange(newDisplayZones.filter(z => z.enabled));
              }}
              polygonMode={polygonModeStatus.enabled}
              polygonZones={polygonZones}
              onPolygonZonesChange={handlePolygonZonesChange}
              selectedId={selectedZoneId}
              onSelect={setSelectedZoneId}
              roomShell={isRoomMode ? selectedRoom?.roomShell : undefined}
              devicePlacement={isRoomMode ? selectedRoom?.devicePlacement : undefined}
              fieldOfViewDeg={currentProfile?.limits?.fieldOfViewDegrees}
              maxRangeMeters={currentProfile?.limits?.maxRangeMeters}
              deviceIconUrl={currentProfile?.iconUrl}
              rangeMm={15000}
              snapGridMm={canvasSnap}
              height="100%"
              zoom={canvasZoom}
              panOffsetMm={canvasPan}
              onPanChange={setCanvasPan}
              furniture={selectedRoom?.furniture}
              doors={selectedRoom?.doors}
            />

            {/* Zoom controls */}
            <div className="pointer-events-auto absolute top-3 right-3 flex flex-col gap-1.5">
              <button
                className="rounded-lg border border-slate-700/50 bg-slate-900/90 backdrop-blur px-3 py-2 text-xs font-semibold text-slate-100 shadow-lg transition-all hover:border-aqua-500 hover:bg-slate-800 active:scale-95"
                onClick={() => setCanvasZoom((z) => Math.min(5, z + 0.2))}
              >
                Zoom +
              </button>
              <button
                className="rounded-lg border border-slate-700/50 bg-slate-900/90 backdrop-blur px-3 py-2 text-xs font-semibold text-slate-100 shadow-lg transition-all hover:border-aqua-500 hover:bg-slate-800 active:scale-95"
                onClick={() => setCanvasZoom((z) => Math.max(0.1, z - 0.2))}
              >
                Zoom -
              </button>
              <button
                className="rounded-lg border border-slate-700/50 bg-slate-900/90 backdrop-blur px-3 py-2 text-xs font-semibold text-slate-100 shadow-lg transition-all hover:border-aqua-500 hover:bg-slate-800 active:scale-95"
                onClick={() => {
                  setCanvasZoom(1);
                  setCanvasPan({ x: 0, y: 0 });
                }}
              >
                Reset
              </button>
            </div>

            {/* Snap controls */}
            <div className="pointer-events-auto absolute bottom-3 left-3 right-3 flex flex-wrap items-center gap-3 rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur px-4 py-3 text-xs shadow-lg">
              <span className="text-slate-400 font-medium">Snap:</span>
              {[0, 50, 100, 200].map((v) => (
                <button
                  key={v}
                  className={`rounded-lg border px-3 py-1.5 font-semibold transition-all active:scale-95 ${
                    canvasSnap === v
                      ? 'border-aqua-500 bg-aqua-500/10 text-aqua-100'
                      : 'border-slate-700 text-slate-300 hover:border-slate-600 hover:bg-slate-800'
                  }`}
                  onClick={() => setCanvasSnap(v)}
                >
                  {v === 0 ? 'Off' : `${v}mm`}
                </button>
              ))}
              <span className="ml-auto text-slate-500">Right-drag to pan • Wheel to zoom</span>
            </div>
          </div>

          {/* Zone count display */}
          {(selectedRoom?.zones?.length ?? 0) > 0 && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 text-sm text-slate-300 flex items-center gap-2">
              <span className="text-aqua-400">✓</span>
              Zones defined: {selectedRoom?.zones?.length ?? 0}
            </div>
          )}
        </div>
      )}

      {currentStep === 'finish' && (
        <div className={`${slideAnimationClass} space-y-6`}>
          <div className="rounded-2xl border border-slate-800/50 bg-gradient-to-br from-slate-900/90 to-slate-900/70 p-8 backdrop-blur-xl shadow-xl text-center">
            <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-gradient-to-br from-emerald-500/20 to-aqua-500/20 border-2 border-emerald-500/30 mb-6 animate-in zoom-in-95 duration-500">
              <span className="text-6xl">✓</span>
            </div>
            <h3 className="text-3xl font-bold text-white mb-3">Setup Complete!</h3>
            <p className="text-base text-slate-400 max-w-lg mx-auto">
              Your device and zones have been configured successfully. Review your configuration below.
            </p>
          </div>

          {/* Configuration Summary */}
          <div className="rounded-2xl border border-slate-800/50 bg-gradient-to-br from-slate-900/90 to-slate-900/70 p-6 backdrop-blur-xl shadow-xl">
            <h4 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <span>📋</span> Configuration Summary
            </h4>

            <div className="space-y-4">
              {/* Device Info */}
              <div className="rounded-xl border border-slate-800/50 bg-slate-900/50 p-4">
                <div className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wide">Device</div>
                <div className="text-sm text-white font-semibold">
                  {deviceId ? devices.find((d) => d.id === deviceId)?.name ?? deviceId : 'Not selected'}
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  {currentProfile ? currentProfile.label : profileId ?? 'No profile'}
                </div>
              </div>

              {/* Room Info */}
              <div className="rounded-xl border border-slate-800/50 bg-slate-900/50 p-4">
                <div className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wide">Room Configuration</div>
                <div className="text-sm text-white font-semibold">
                  {selectedRoom ? selectedRoom.name : 'Generic Radar (No Room)'}
                </div>
                <div className="grid grid-cols-2 gap-3 mt-3 text-xs">
                  <div>
                    <span className="text-slate-400">Mode:</span>{' '}
                    <span className="text-slate-200">{isRoomMode ? 'Room' : 'Generic'}</span>
                  </div>
                  {isRoomMode && selectedRoom?.roomShell && (
                    <div>
                      <span className="text-slate-400">Outline:</span>{' '}
                      <span className="text-slate-200">{selectedRoom.roomShell.points?.length ?? 0} points</span>
                    </div>
                  )}
                  {isRoomMode && selectedRoom?.devicePlacement && (
                    <>
                      <div>
                        <span className="text-slate-400">Position:</span>{' '}
                        <span className="text-slate-200">
                          ({(selectedRoom.devicePlacement.x / 1000).toFixed(2)}m, {(selectedRoom.devicePlacement.y / 1000).toFixed(2)}m)
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400">Rotation:</span>{' '}
                        <span className="text-slate-200">{selectedRoom.devicePlacement.rotationDeg ?? 0}°</span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Zones Info */}
              <div className="rounded-xl border border-slate-800/50 bg-slate-900/50 p-4">
                <div className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wide">Detection Zones</div>
                <div className="text-sm text-white font-semibold mb-2">
                  {(selectedRoom?.zones?.length ?? 0) > 0
                    ? `${selectedRoom?.zones?.length} zone${selectedRoom?.zones?.length === 1 ? '' : 's'} defined`
                    : 'No zones defined'}
                </div>
                {(selectedRoom?.zones?.length ?? 0) > 0 && (
                  <div className="space-y-1.5 mt-3">
                    {selectedRoom?.zones?.map((zone, idx) => (
                      <div key={zone.id} className="flex items-center justify-between text-xs bg-slate-900/60 rounded-lg px-3 py-2 border border-slate-800/30">
                        <div className="flex items-center gap-2">
                          <div className={`w-3 h-3 rounded ${
                            zone.type === 'regular' ? 'bg-aqua-500' :
                            zone.type === 'exclusion' ? 'bg-rose-500' :
                            'bg-amber-500'
                          }`} />
                          <span className="text-slate-200 font-medium">
                            Zone {idx + 1}
                          </span>
                          <span className="text-slate-400">•</span>
                          <span className="text-slate-400 capitalize">{zone.type}</span>
                        </div>
                        <span className="text-slate-500">
                          {(zone.width / 1000).toFixed(2)}m × {(zone.height / 1000).toFixed(2)}m
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Push Zones to Device */}
          {deviceId && profileId && (selectedRoom?.zones?.length ?? 0) > 0 && (
            <div className="rounded-2xl border border-slate-800/50 bg-gradient-to-br from-slate-900/90 to-slate-900/70 p-6 backdrop-blur-xl shadow-xl">
              <h4 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
                <span>📡</span> Push Zones to Device
              </h4>
              <p className="text-sm text-slate-400 mb-4">
                Send your configured zones directly to your device. This will update the device's active zone configuration.
              </p>

              {pushSuccess && (
                <div className="mb-4 rounded-xl border border-emerald-500/50 bg-emerald-500/10 p-4 text-emerald-100 animate-in slide-in-from-top-2 fade-in duration-300">
                  <div className="flex items-start gap-3">
                    <span className="text-xl">✓</span>
                    <div>
                      <div className="font-semibold">Zones Pushed Successfully!</div>
                      <div className="text-sm text-emerald-200 mt-1">Your device has been updated with the new zone configuration.</div>
                    </div>
                  </div>
                </div>
              )}

              <button
                onClick={handlePushZones}
                disabled={pushingZones || pushSuccess}
                className="w-full rounded-xl bg-gradient-to-r from-aqua-600 to-aqua-500 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-aqua-500/30 transition-all hover:shadow-xl hover:shadow-aqua-500/40 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
              >
                {pushingZones ? 'Pushing Zones...' : pushSuccess ? 'Zones Pushed ✓' : 'Push Zones to Device'}
              </button>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              className="flex-1 rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur px-6 py-3 text-sm font-semibold text-slate-100 shadow-lg transition-all hover:border-slate-600 hover:bg-slate-800 hover:shadow-xl active:scale-95"
              onClick={() => {
                onGoZoneEditor(selectedRoom?.id ?? null, selectedRoom?.profileId ?? profileId ?? null);
              }}
            >
              Continue to Zone Editor
            </button>
            <button
              className="flex-1 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-500/30 transition-all hover:shadow-xl hover:shadow-emerald-500/40 active:scale-95"
              onClick={() => {
                setZonesReady(true);
                onComplete();
              }}
            >
              Finish & Go to Dashboard
            </button>
          </div>

          {/* Additional Info */}
          <div className="rounded-xl border border-slate-800/50 bg-slate-900/50 p-4 text-center">
            <p className="text-xs text-slate-400">
              💡 You can always edit your room configuration, zones, and device placement from the Dashboard, Zone Editor, or Room Builder pages.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

