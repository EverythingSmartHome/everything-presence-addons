import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { fetchDevices, fetchProfiles, ingressAware } from '../api/client';
import { fetchRooms, updateRoom } from '../api/rooms';
import type { RoomUpdatePayload } from '../api/rooms';
import { RoomCanvas } from '../components/RoomCanvas';
import { DiscoveredDevice, DeviceProfile, RoomConfig, LiveState, FurnitureInstance, FurnitureType, Door, DevicePlacement } from '../api/types';
import { useWallDrawing } from '../hooks/useWallDrawing';
import { FurnitureLibrary } from '../components/FurnitureLibrary';
import { FurnitureEditor } from '../components/FurnitureEditor';
import { DoorEditor } from '../components/DoorEditor';
import { FLOOR_MATERIALS } from '../components/FloorMaterials';
import {
  CanvasBottomToolbar,
  CanvasMobileSheet,
  CanvasToolbarButton,
  CanvasTopBar,
} from '../components/CanvasLayout';
import { DisplaySettingsControls } from '../components/DisplaySettingsControls';
import { BasicRoomShapesPicker, resizeBasicRoomShapeWall, type BasicRoomShapeSelection } from '../components/BasicRoomShapesPicker';
import type { RoomShapePoint } from '../utils/roomShapes';
import { clampDoorPosition } from '../utils/doorGeometry';
import { useDisplaySettings } from '../hooks/useDisplaySettings';
import { useIsMobileCanvas } from '../hooks/useMediaQuery';
import { getInstallationAngleSuggestion } from '../utils/rotationSuggestion';
import { useDeviceMappings } from '../contexts/DeviceMappingsContext';
import { getDeviceIconUrl } from '../utils/deviceIcon';
import { resolveCoverageFov } from '../utils/coverage';
import { formatLengthLabel } from '../utils/lengthLabels';
import { formatSnapPresetLabel } from '../utils/snapLabels';
import {
  getCeilingSliceLineDepth,
  getCeilingSlicePosition,
  normalizeCeilingSliceConfig,
} from '../utils/ceilingSlices';
import { resolveLoadedRoomSelection } from '../utils/roomSelection';
import {
  applyDevicePlacementUpdate,
  areAllItemsLocked,
  areAllSegmentsLocked,
  countLockedObjects,
  getLockedSegments,
  isDevicePositionLocked,
  isSegmentLocked,
  isShellLocked,
  isVertexLocked,
  normalizeLockedSegments,
  remapDoorsForPointRemoval,
  remapDoorsForSplit,
  remapLockedSegmentsForPointRemoval,
  remapLockedSegmentsForSplit,
  resolveLockedUpdate,
  setItemsLocked,
  setShellLocked,
  toggleSegmentLock,
} from '../utils/lockState';
import { stableStringify } from '../utils/stableStringify';
import {
  ROOM_HISTORY_LIMIT,
  applyRoomSnapshot,
  canRedoRoomHistory,
  canUndoRoomHistory,
  createRoomHistory,
  pushRoomHistory,
  redoRoomHistory,
  roomSnapshotSignature,
  snapshotRoom,
  undoRoomHistory,
  type RoomHistory,
} from '../utils/roomHistory';
import {
  ROTATION_STEP_DEG,
  canRotateRoomSnapshot,
  describeRotationScope,
  normalizeSignedAngle,
  rotatePointsKeepingBoundsCenter,
  rotateRoomSnapshot,
  type RotationScope,
} from '../utils/roomRotation';

interface RoomBuilderPageProps {
  onBack?: () => void;
  onNavigate?: (view: 'wizard' | 'zoneEditor' | 'roomBuilder' | 'settings' | 'liveDashboard') => void;
  initialRoomId?: string | null;
  initialProfileId?: string | null;
  onRoomChange?: (roomId: string | null, profileId: string | null) => void;
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

type MobileRoomBuilderSheet = 'navigation' | 'tools' | 'zoom' | null;
type RoomBuilderSettingsTab = 'canvas' | 'device' | 'display' | 'floor' | 'layout';
type RoomBuilderView = 'wizard' | 'zoneEditor' | 'roomBuilder' | 'settings' | 'liveDashboard';
type PendingLeave = { type: 'navigate'; view: RoomBuilderView } | { type: 'back' };

const roomSignature = (room: RoomConfig | null | undefined): string => (room ? stableStringify(room) : '');

/** Keep in step with the `room-rotate-spin` keyframes in index.css. */
const ROOM_ROTATION_SPIN_MS = 420;

// One user gesture should be one undo step. Continuous input (dragging
// furniture, sweeping a slider, dragging a wall) fires a change per pointer
// move, so those commits share a key and collapse onto the first snapshot until
// the gesture ends.
type CommitRoomOptions = { coalesceKey?: string };

/**
 * A points edit normally carries the outline's locks through untouched.
 * `lockedSegments` and `doors` are only passed by the two edits that renumber
 * walls (splitting one, deleting a corner), which have to remap them.
 */
type PointsChangeOptions = CommitRoomOptions & {
  lockedSegments?: number[];
  doors?: Door[];
};

export const RoomBuilderPage: React.FC<RoomBuilderPageProps> = ({
  onBack,
  onNavigate,
  initialRoomId,
  initialProfileId,
  onRoomChange,
  onWizardProgress,
  liveState,
  targetPositions,
}) => {
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [profiles, setProfiles] = useState<DeviceProfile[]>([]);
  const [rooms, setRooms] = useState<RoomConfig[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [rangeMm, setRangeMm] = useState(15000);
  const [showBasicShapes, setShowBasicShapes] = useState(false);
  const [activeBasicShape, setActiveBasicShape] = useState<BasicRoomShapeSelection | null>(null);
  /**
   * How far the basic shape has been turned since it was placed.
   *
   * The shape itself is parametric and always regenerates axis-aligned, so this
   * is what a wall-length edit re-applies to keep a rotated room rotated instead
   * of snapping it back to square.
   */
  const [basicShapeRotationDeg, setBasicShapeRotationDeg] = useState(0);
  // Leaving shape mode - by any route, including an undo - retires the angle
  // with it, so a shape placed later never inherits the last one's orientation.
  useEffect(() => {
    if (!activeBasicShape) setBasicShapeRotationDeg(0);
  }, [activeBasicShape]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Last state each room was known to have on the server; the baseline for
  // "do I have unsaved changes?" and for discarding them again.
  const [savedRooms, setSavedRooms] = useState<Record<string, RoomConfig>>({});
  const [pendingLeave, setPendingLeave] = useState<PendingLeave | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearedPoints, setClearedPoints] = useState<{ x: number; y: number }[] | null>(null);
  const [hoveredSegment, setHoveredSegment] = useState<number | null>(null);
  const [selectedSegment, setSelectedSegment] = useState<number | null>(null);
  const [wallLengthInput, setWallLengthInput] = useState('');
  const [wallLengthFeetInput, setWallLengthFeetInput] = useState('');
  const [wallLengthInchesInput, setWallLengthInchesInput] = useState('');
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
  const [angleSnapEnabled, setAngleSnapEnabled] = useState(false);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [cursorDelta, setCursorDelta] = useState<{ dx: number; dy: number; len: number } | null>(null);
  const [zoom, setZoom] = useState(1.1);
  const [isCanvasDragging, setIsCanvasDragging] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<RoomBuilderSettingsTab>('display');
  const [showNavMenu, setShowNavMenu] = useState(false);
  const [activeMobileSheet, setActiveMobileSheet] = useState<MobileRoomBuilderSheet>(null);
  /**
   * Which way a floor-plan rotation is meant to be read. 'layout' turns the plan
   * and the sensor together (a pure reorientation); 'roomOnly' turns the drawing
   * around a fixed sensor, which is the repair for "the sensor detects things 90
   * degrees off what I drew".
   */
  const [rotationScope, setRotationScope] = useState<RotationScope>('layout');
  /** Free-text angle for the Layout panel's "Custom" rotation. */
  const [customRotationInput, setCustomRotationInput] = useState('45');
  /** Drives the one-shot spin the canvas plays after a rotation is committed. */
  const [rotationSpin, setRotationSpin] = useState<{ fromDeg: number; id: number } | null>(null);
  const rotationSpinIdRef = useRef(0);
  const rotationSpinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rotationSpinFrameRef = useRef<number | null>(null);
  // Display settings (persisted to localStorage)
  const {
    showWalls, setShowWalls,
    showFurniture, setShowFurniture,
    showDoors, setShowDoors,
    showDeviceIcon, setShowDeviceIcon,
    showDeviceRadar, setShowDeviceRadar,
    showTargets, setShowTargets,
    targetMarkerScale, setTargetMarkerScale,
    showZoneLabels, setShowZoneLabels,
    zoneLabelScale, setZoneLabelScale,
    clipRadarToWalls, setClipRadarToWalls,
    units: displayUnits, setUnits: setDisplayUnits,
  } = useDisplaySettings();
  const isMobileCanvas = useIsMobileCanvas();
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
  const [showRotationSuggestion, setShowRotationSuggestion] = useState(false);
  const [rotationSuggestion, setRotationSuggestion] = useState<{ suggestedAngle: number; targetAxis: number } | null>(null);
  const [applyingInstallationAngle, setApplyingInstallationAngle] = useState(false);
  const [rotationSuggestionError, setRotationSuggestionError] = useState<string | null>(null);
  const [wallEditorDragOffset, setWallEditorDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [wallEditorDragging, setWallEditorDragging] = useState(false);
  const [canvasViewportSize, setCanvasViewportSize] = useState({ width: 0, height: 0 });
  // Session-only undo/redo, one stack per room. Held in a ref so a drag does not
  // re-render per snapshot; `historyAvailability` mirrors just what the buttons
  // need. Nothing here is persisted, so it dies with the page.
  const historyRef = useRef<Map<string, RoomHistory>>(new Map());
  const activeCoalesceKeyRef = useRef<string | null>(null);
  const [historyAvailability, setHistoryAvailability] = useState({ canUndo: false, canRedo: false });
  const lastRotationSuggestionRef = useRef<number | null>(null);
  const wallEditorDragPointerRef = useRef<number | null>(null);
  const wallEditorDragStartRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const canvasViewportRef = useRef<HTMLDivElement | null>(null);
  // Mirrors of the current selection, so the one-shot loader can consult them
  // without depending on (and therefore re-running off) its own state.
  const selectedRoomIdRef = useRef(selectedRoomId);
  const selectedProfileIdRef = useRef(selectedProfileId);
  selectedRoomIdRef.current = selectedRoomId;
  selectedProfileIdRef.current = selectedProfileId;
  // Last `initialRoomId` we acted on, so the sync effect below can tell an actual
  // prop change from a re-render.
  const lastInitialRoomIdRef = useRef<string | null>(initialRoomId ?? null);
  const CANVAS_SIZE = 700;
  const HALF = CANVAS_SIZE / 2;
  const WALL_EDITOR_WIDTH = 280;
  const WALL_EDITOR_HEIGHT = 170;
  const WALL_EDITOR_MARGIN = 20;
  const toCanvas = (v: number, range: number) => (v / range) * CANVAS_SIZE;

  const selectedRoom = useMemo(
    () => (selectedRoomId ? rooms.find((r) => r.id === selectedRoomId) ?? null : null),
    [rooms, selectedRoomId],
  );

  const syncHistoryAvailability = useCallback((roomId: string | null) => {
    const history = roomId ? historyRef.current.get(roomId) : null;
    const next = { canUndo: canUndoRoomHistory(history), canRedo: canRedoRoomHistory(history) };
    setHistoryAvailability((prev) =>
      prev.canUndo === next.canUndo && prev.canRedo === next.canRedo ? prev : next,
    );
  }, []);

  // A gesture ends on pointer-up or when focus leaves the control being used;
  // the next edit then starts a fresh undo step.
  const endHistoryGesture = useCallback(() => {
    activeCoalesceKeyRef.current = null;
  }, []);

  useEffect(() => {
    const handler = () => endHistoryGesture();
    window.addEventListener('pointerup', handler);
    window.addEventListener('pointercancel', handler);
    window.addEventListener('focusout', handler);
    return () => {
      window.removeEventListener('pointerup', handler);
      window.removeEventListener('pointercancel', handler);
      window.removeEventListener('focusout', handler);
    };
  }, [endHistoryGesture]);

  /**
   * The single write path for room edits made in the builder. Every edit
   * records the pre-edit state so Undo can put it back, then applies the new
   * room. Loading and saving deliberately bypass this: neither is a user edit.
   */
  const commitRoom = useCallback(
    (nextRoom: RoomConfig, options?: CommitRoomOptions) => {
      const previous = selectedRoom;
      if (!previous || previous.id !== nextRoom.id) return;

      const previousSnapshot = snapshotRoom(previous);
      const coalesceKey = options?.coalesceKey ?? null;
      // Events that change nothing (a slider re-emitting its current value)
      // must not consume an undo step.
      if (roomSnapshotSignature(previousSnapshot) !== roomSnapshotSignature(snapshotRoom(nextRoom))) {
        const history = historyRef.current.get(previous.id) ?? createRoomHistory();
        historyRef.current.set(
          previous.id,
          pushRoomHistory(history, previousSnapshot, {
            coalesceKey,
            activeCoalesceKey: activeCoalesceKeyRef.current,
            limit: ROOM_HISTORY_LIMIT,
          }),
        );
        activeCoalesceKeyRef.current = coalesceKey;
        syncHistoryAvailability(previous.id);
      }

      setRooms((prev) => prev.map((r) => (r.id === previous.id ? nextRoom : r)));
    },
    [selectedRoom, syncHistoryAvailability],
  );

  const selectedProfile = useMemo(
    () => profiles.find((p) => p.id === (selectedRoom?.profileId ?? selectedProfileId)) ?? null,
    [profiles, selectedProfileId, selectedRoom?.profileId],
  );

  const selectedDevice = useMemo(
    () => (selectedRoom?.deviceId ? devices.find((d) => d.id === selectedRoom.deviceId) ?? null : null),
    [devices, selectedRoom?.deviceId],
  );

  const deviceIconUrl = useMemo(
    () => getDeviceIconUrl(selectedProfile, selectedRoom?.devicePlacement),
    [selectedProfile, selectedRoom?.devicePlacement],
  );

  const coverageFov = useMemo(
    () => resolveCoverageFov(selectedProfile, selectedRoom?.devicePlacement),
    [selectedProfile, selectedRoom?.devicePlacement],
  );
  const effectiveCoverageMaxRangeMeters = coverageFov?.maxRangeMeters ?? selectedProfile?.limits?.maxRangeMeters;

  const isCeilingMount = selectedRoom?.devicePlacement?.mountType === 'ceiling';
  const isCeilingSliceMode =
    selectedProfile?.id === 'everything_presence_pro' &&
    selectedRoom?.devicePlacement?.mountType === 'ceiling';
  const trackingMaxRangeMm = (selectedProfile?.limits?.maxRangeMeters ?? 6) * 1000;
  const ceilingSliceConfig = useMemo(
    () => normalizeCeilingSliceConfig(selectedRoom?.metadata?.ceilingSliceConfig, trackingMaxRangeMm, true),
    [selectedRoom?.metadata?.ceilingSliceConfig, trackingMaxRangeMm],
  );

  const heightCoverageConfig = useMemo(() => {
    if (!selectedRoom?.devicePlacement || !isCeilingMount) return null;
    if (!coverageFov) return null;
    const heightMm = selectedRoom.devicePlacement.heightMm;
    const pitchDeg = Number.isFinite(selectedRoom.devicePlacement.pitchDeg)
      ? Number(selectedRoom.devicePlacement.pitchDeg)
      : (selectedRoom.devicePlacement.mountType === 'ceiling' ? 90 : 0);
    if (!Number.isFinite(heightMm) || !Number.isFinite(pitchDeg)) return null;
    return {
      enabled: true,
      heightMm: Number(heightMm),
      pitchDeg: Number(pitchDeg),
      horizontalFovDeg: coverageFov.horizontalFovDeg,
      verticalFovDeg: coverageFov.verticalFovDeg,
      maxRangeMeters: coverageFov.maxRangeMeters,
    };
  }, [coverageFov, selectedRoom?.devicePlacement, isCeilingMount]);

  const updateDevicePlacement = useCallback((updates: Partial<DevicePlacement>) => {
    if (!selectedRoom) return;
    const base: DevicePlacement = selectedRoom.devicePlacement ?? { x: 0, y: 0, rotationDeg: 0 };
    // A locked device keeps its coordinates; rotation, mounting and coverage
    // all still apply, so aiming the sensor is unaffected.
    const nextPlacement: DevicePlacement = applyDevicePlacementUpdate(base, updates);
    const nextRoom: RoomConfig = { ...selectedRoom, devicePlacement: nextPlacement };
    commitRoom(nextRoom, { coalesceKey: 'device:placement' });
  }, [commitRoom, selectedRoom]);

  const coveragePresets = selectedProfile?.coverage?.presets ?? null;
  const coveragePresetId = useMemo(() => {
    if (!coveragePresets) return null;
    const persistedPresetId = selectedRoom?.devicePlacement?.coveragePresetId;
    if (persistedPresetId === 'custom') return 'custom';
    if (persistedPresetId && coveragePresets[persistedPresetId]) return persistedPresetId;
    const h = selectedRoom?.devicePlacement?.horizontalFovDeg;
    const v = selectedRoom?.devicePlacement?.verticalFovDeg;
    if (Number.isFinite(h) && Number.isFinite(v)) {
      const match = Object.entries(coveragePresets).find(([, preset]) =>
        Math.abs(preset.horizontalFovDeg - Number(h)) < 0.5 &&
        Math.abs(preset.verticalFovDeg - Number(v)) < 0.5
      );
      return match ? match[0] : 'custom';
      }
      return 'default';
  }, [coveragePresets, selectedRoom?.devicePlacement]);

  const displayHeightMeters = Number.isFinite(selectedRoom?.devicePlacement?.heightMm)
    ? Number(((selectedRoom?.devicePlacement?.heightMm ?? 0) / 1000).toFixed(1))
    : '';

  const selectedFurniture = useMemo(
    () => (selectedFurnitureId ? selectedRoom?.furniture?.find((f) => f.id === selectedFurnitureId) ?? null : null),
    [selectedFurnitureId, selectedRoom?.furniture],
  );

  const selectedDoor = useMemo(
    () => (selectedDoorId ? selectedRoom?.doors?.find((d) => d.id === selectedDoorId) ?? null : null),
    [selectedDoorId, selectedRoom?.doors],
  );

  const currentInstallationAngle =
    typeof liveState?.config?.installationAngle === 'number' ? liveState.config.installationAngle : null;
  const deviceLocalToRoom = useCallback((deviceX: number, deviceY: number) => {
    if (!selectedRoom?.devicePlacement) {
      return { x: deviceX, y: deviceY };
    }
    const { x, y, rotationDeg } = selectedRoom.devicePlacement;
    const angleRad = (((rotationDeg ?? 0) + (currentInstallationAngle ?? 0)) * Math.PI) / 180;
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);
    // Orientation (upside-down mounting) is normalised on-device by the firmware,
    // so Target X is already in the correct frame here — do not re-flip it.
    const localX = deviceX;
    return {
      x: localX * cos - deviceY * sin + x,
      y: localX * sin + deviceY * cos + y,
    };
  }, [currentInstallationAngle, selectedRoom?.devicePlacement]);

  const isEplDevice = useMemo(() => {
    const caps = selectedProfile?.capabilities as { tracking?: boolean; distanceOnlyTracking?: boolean } | undefined;
    return Boolean(caps?.tracking) && !caps?.distanceOnlyTracking;
  }, [selectedProfile]);

  // Device mappings context for entity resolution
  const { getEntityId } = useDeviceMappings();

  const resolveInstallationAngleEntityId = useCallback(() => {
    if (!selectedRoom) return null;

    // First try device mappings (new system - supports EPP and EPL)
    if (selectedRoom.deviceId) {
      const entityFromMapping = getEntityId(selectedRoom.deviceId, 'installationAngle');
      if (entityFromMapping) return entityFromMapping;
    }

    // Fall back to legacy room-level mapping
    const mappingEntity = selectedRoom.entityMappings?.installationAngleEntity;
    if (mappingEntity) return mappingEntity;

    // No mapping found - return null (user should run entity discovery)
    return null;
  }, [selectedRoom, getEntityId]);

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
    [selectedRoom, isEplDevice, currentInstallationAngle, resolveInstallationAngleEntityId]
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

      window.dispatchEvent(
        new CustomEvent('ep:refresh-live-state', {
          detail: { deviceId: selectedRoom.deviceId },
        })
      );
      setShowRotationSuggestion(false);
    } catch (err) {
      setRotationSuggestionError('Failed to update installation angle.');
    } finally {
      setApplyingInstallationAngle(false);
    }
  }, [selectedRoom?.deviceId, rotationSuggestion, resolveInstallationAngleEntityId]);

  const handlePointsChange = useCallback((nextPoints: { x: number; y: number }[], options?: PointsChangeOptions) => {
    if (!selectedRoom) return;
    const previousShell = selectedRoom.roomShell;
    // Locks are part of the outline, so rebuilding `roomShell` here has to carry
    // them over or every wall edit would silently unlock the room.
    const lockedSegments = normalizeLockedSegments(
      options?.lockedSegments ?? previousShell?.lockedSegments,
      nextPoints.length,
    );
    const updated: RoomConfig = {
      ...selectedRoom,
      roomShell: {
        ...previousShell,
        points: nextPoints,
        locked: previousShell?.locked ? true : undefined,
        lockedSegments: lockedSegments.length ? lockedSegments : undefined,
      },
      ...(options?.doors?.length ? { doors: options.doors } : {}),
    };
    commitRoom(updated, options);
  }, [commitRoom, selectedRoom]);

  // ── Object locking ────────────────────────────────────────────────────────
  // A locked object is pinned: the canvas drops it from hit-testing so it can no
  // longer be selected or dragged by accident, and the mutation handlers below
  // refuse every edit except the one that unlocks it again.
  const activeShell = selectedRoom?.roomShell;
  const shellPointCount = activeShell?.points?.length ?? 0;
  const lockedWallSegments = useMemo(
    () => getLockedSegments(activeShell, shellPointCount),
    [activeShell, shellPointCount],
  );
  const wholeRoomLocked = isShellLocked(activeShell);
  const allWallsLocked = areAllSegmentsLocked(activeShell);
  const allFurnitureLocked = areAllItemsLocked(selectedRoom?.furniture);
  const allDoorsLocked = areAllItemsLocked(selectedRoom?.doors);
  const selectedSegmentLocked = isSegmentLocked(activeShell, selectedSegment);
  const devicePositionLocked = isDevicePositionLocked(selectedRoom?.devicePlacement);
  const lockedObjectCount = countLockedObjects(selectedRoom) + (devicePositionLocked ? 1 : 0);

  /**
   * Locking never closes the object's editor panel: the panel is where the lock
   * was turned on, so it has to stay put as the way to turn it off again. Its
   * controls go inert instead, and the canvas stops hit-testing the object.
   */
  const handleSegmentLockToggle = useCallback((index: number) => {
    const shell = selectedRoom?.roomShell;
    if (!selectedRoom || !shell?.points?.length) return;
    commitRoom({ ...selectedRoom, roomShell: toggleSegmentLock(shell, index) });
    setHoveredSegment(null);
  }, [commitRoom, selectedRoom]);

  const handleShellLockChange = useCallback((locked: boolean) => {
    const shell = selectedRoom?.roomShell;
    if (!selectedRoom || !shell?.points?.length) return;
    commitRoom({ ...selectedRoom, roomShell: setShellLocked(shell, locked) });
    setHoveredSegment(null);
  }, [commitRoom, selectedRoom]);

  const handleFurnitureLockToggle = useCallback((id: string) => {
    if (!selectedRoom) return;
    const existing = (selectedRoom.furniture ?? []).find((f) => f.id === id);
    if (!existing) return;
    const locked = !existing.locked;
    commitRoom({
      ...selectedRoom,
      furniture: (selectedRoom.furniture ?? []).map((f) =>
        (f.id === id ? { ...f, locked: locked ? true : undefined } : f)),
    });
  }, [commitRoom, selectedRoom]);

  const handleDoorLockToggle = useCallback((id: string) => {
    if (!selectedRoom) return;
    const existing = (selectedRoom.doors ?? []).find((d) => d.id === id);
    if (!existing) return;
    const locked = !existing.locked;
    commitRoom({
      ...selectedRoom,
      doors: (selectedRoom.doors ?? []).map((d) => (d.id === id ? { ...d, locked: locked ? true : undefined } : d)),
    });
  }, [commitRoom, selectedRoom]);

  const handleLockAllFurniture = useCallback((locked: boolean) => {
    if (!selectedRoom?.furniture?.length) return;
    commitRoom({ ...selectedRoom, furniture: setItemsLocked(selectedRoom.furniture, locked) });
  }, [commitRoom, selectedRoom]);

  const handleLockAllDoors = useCallback((locked: boolean) => {
    if (!selectedRoom?.doors?.length) return;
    commitRoom({ ...selectedRoom, doors: setItemsLocked(selectedRoom.doors, locked) });
  }, [commitRoom, selectedRoom]);

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
    commitRoom(updated);
    setSelectedFurnitureId(newFurniture.id);
    setShowFurnitureLibrary(false);
    setActiveMobileSheet(null);
  }, [commitRoom, selectedRoom]);

  const handleFurnitureChange = useCallback((updatedFurniture: FurnitureInstance) => {
    if (!selectedRoom) return;
    // Canvas gating alone is not enough: the editor panel writes here too, as
    // does any drag still in flight. A locked item accepts nothing but unlocking.
    const existing = (selectedRoom.furniture ?? []).find((f) => f.id === updatedFurniture.id);
    const nextFurniture = resolveLockedUpdate(existing, updatedFurniture);
    if (!nextFurniture) return;
    const updated: RoomConfig = {
      ...selectedRoom,
      furniture: (selectedRoom.furniture ?? []).map((f) => (f.id === updatedFurniture.id ? nextFurniture : f)),
    };
    // Dragging, resizing, rotating and the sliders all land here per input
    // event - one key per item keeps a whole gesture at one undo step.
    commitRoom(updated, { coalesceKey: `furniture:${updatedFurniture.id}` });
  }, [commitRoom, selectedRoom]);

  const handleFurnitureDelete = useCallback(() => {
    if (!selectedRoom || !selectedFurnitureId) return;
    // Pinned means pinned: unlock it first.
    if ((selectedRoom.furniture ?? []).some((f) => f.id === selectedFurnitureId && f.locked)) return;
    const updated: RoomConfig = {
      ...selectedRoom,
      furniture: (selectedRoom.furniture ?? []).filter((f) => f.id !== selectedFurnitureId),
    };
    commitRoom(updated);
    setSelectedFurnitureId(null);
  }, [commitRoom, selectedRoom, selectedFurnitureId]);

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
    // Door drags are routed through the host, so the canvas gate alone would
    // still leave a locked door movable. A locked door accepts only unlocking.
    const existing = (selectedRoom.doors ?? []).find((d) => d.id === updatedDoor.id);
    const unlockedDoor = resolveLockedUpdate(existing, updatedDoor);
    if (!unlockedDoor) return;
    const points = selectedRoom.roomShell?.points ?? [];
    const start = points[unlockedDoor.segmentIndex];
    const end = points[(unlockedDoor.segmentIndex + 1) % points.length];
    const nextDoor = start && end ? {
      ...unlockedDoor,
      positionOnSegment: clampDoorPosition(
        unlockedDoor.positionOnSegment,
        unlockedDoor.widthMm,
        Math.hypot(end.x - start.x, end.y - start.y),
      ),
    } : unlockedDoor;
    const updated: RoomConfig = {
      ...selectedRoom,
      doors: (selectedRoom.doors ?? []).map((d) => (d.id === updatedDoor.id ? nextDoor : d)),
    };
    // Sliding a door along a wall fires per pointer move; coalesce per door.
    commitRoom(updated, { coalesceKey: `door:${updatedDoor.id}` });
  }, [commitRoom, selectedRoom]);

  const handleDoorDelete = useCallback(() => {
    if (!selectedRoom || !selectedDoorId) return;
    // Pinned means pinned: unlock it first.
    if ((selectedRoom.doors ?? []).some((d) => d.id === selectedDoorId && d.locked)) return;
    const updated: RoomConfig = {
      ...selectedRoom,
      doors: (selectedRoom.doors ?? []).filter((d) => d.id !== selectedDoorId),
    };
    commitRoom(updated);
    setSelectedDoorId(null);
  }, [commitRoom, selectedRoom, selectedDoorId]);

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
    if (isSegmentLocked(selectedRoom.roomShell, segmentIndex)) return;

    const points = selectedRoom.roomShell?.points ?? [];
    const start = points[segmentIndex];
    const end = points[(segmentIndex + 1) % points.length];
    const boundedPosition = start && end
      ? clampDoorPosition(positionOnSegment, 800, Math.hypot(end.x - start.x, end.y - start.y))
      : positionOnSegment;

    const newDoor: Door = {
      id: generateId(),
      style: 'single',
      segmentIndex,
      positionOnSegment: boundedPosition,
      widthMm: 800, // Standard door width
      swingDirection: 'in',
      swingSide: 'left',
    };
    const updated: RoomConfig = {
      ...selectedRoom,
      doors: [...(selectedRoom.doors ?? []), newDoor],
    };
    commitRoom(updated);
    setSelectedDoorId(newDoor.id);
    setIsDoorPlacementMode(false); // Exit placement mode after placing
  }, [commitRoom, selectedRoom, isDoorPlacementMode]);

  const handleDoorDragStart = useCallback((doorId: string, x: number, y: number) => {
    const door = selectedRoom?.doors?.find((d) => d.id === doorId);
    if (!door || door.locked) return;
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
    if (!door || door.locked || !selectedRoom.roomShell?.points) return;

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

  const desktopEditorOpen = !!selectedDoor || !!selectedFurniture;

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
    setPendingStart,
  } = useWallDrawing({
    snapGridMm,
    onPointsChange: handlePointsChange,
    currentPoints: selectedRoom?.roomShell?.points ?? [],
  });

  /**
   * Undo/redo restores the whole builder state of the room, so it reverses any
   * edit - a deleted door or furniture item comes back, not just wall points.
   */
  const stepHistory = useCallback(
    (direction: 'undo' | 'redo') => {
      const room = selectedRoom;
      if (!room) return;
      const history = historyRef.current.get(room.id);
      if (!history) return;

      const current = snapshotRoom(room);
      const step = direction === 'undo' ? undoRoomHistory(history, current) : redoRoomHistory(history, current);
      if (!step) return;

      historyRef.current.set(room.id, step.history);
      endHistoryGesture();
      const restored = applyRoomSnapshot(room, step.snapshot);
      setRooms((prev) => prev.map((r) => (r.id === room.id ? restored : r)));
      syncHistoryAvailability(room.id);

      // Drop any transient interaction that may now point at something that no
      // longer exists (or exists again at a different index).
      const points = restored.roomShell?.points ?? [];
      setSelectedSegment((prev) => (prev !== null && prev >= points.length ? null : prev));
      setHoveredSegment(null);
      setSegmentDragIndex(null);
      setSegmentDragStart(null);
      setSegmentDragBase(null);
      setEndpointDrag(null);
      setDoorDrag(null);
      setIsDoorPlacementMode(false);
      setActiveBasicShape(null);
      setSelectedFurnitureId((prev) => (prev && !(restored.furniture ?? []).some((f) => f.id === prev) ? null : prev));
      setSelectedDoorId((prev) => (prev && !(restored.doors ?? []).some((d) => d.id === prev) ? null : prev));
      if (isDrawingWall) {
        setPendingStart(points.length ? points[points.length - 1] : null);
      }
    },
    [endHistoryGesture, isDrawingWall, selectedRoom, setPendingStart, syncHistoryAvailability],
  );

  const handleUndo = useCallback(() => stepHistory('undo'), [stepHistory]);
  const handleRedo = useCallback(() => stepHistory('redo'), [stepHistory]);
  const canUndo = historyAvailability.canUndo && !!selectedRoom;
  const canRedo = historyAvailability.canRedo && !!selectedRoom;

  const canRotateLayout = !!selectedRoom && (selectedRoom.roomShell?.points?.length ?? 0) > 0;

  /**
   * Play the one-shot spin: the geometry is already committed, so the canvas
   * starts back at the orientation the plan *had* and turns into its new one.
   * The animation is restarted by clearing it for a frame first, otherwise a
   * second press inside the same ROOM_ROTATION_SPIN_MS would leave the class in
   * place and silently skip the animation.
   */
  const playRotationSpin = useCallback((appliedAngleDeg: number) => {
    if (rotationSpinTimerRef.current) clearTimeout(rotationSpinTimerRef.current);
    if (rotationSpinFrameRef.current !== null) cancelAnimationFrame(rotationSpinFrameRef.current);
    rotationSpinFrameRef.current = null;
    setRotationSpin(null);

    // With reduced motion the CSS animation is `none`, so animationend never
    // fires and the plan would only sit there un-interactive. Skip the spin
    // entirely instead: the geometry is already committed either way.
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    const id = (rotationSpinIdRef.current += 1);
    const start = () => {
      rotationSpinFrameRef.current = null;
      setRotationSpin({ fromDeg: -appliedAngleDeg, id });
      // Belt and braces alongside onAnimationEnd, which can be missed if the
      // canvas is re-mounted or the tab is backgrounded mid-animation.
      rotationSpinTimerRef.current = setTimeout(() => {
        setRotationSpin((current) => (current?.id === id ? null : current));
      }, ROOM_ROTATION_SPIN_MS + 120);
    };
    // One frame with the class removed, so pressing rotate twice in quick
    // succession restarts the animation instead of silently skipping it.
    if (typeof requestAnimationFrame === 'function') {
      rotationSpinFrameRef.current = requestAnimationFrame(start);
    } else {
      start();
    }
  }, []);

  useEffect(() => () => {
    if (rotationSpinTimerRef.current) clearTimeout(rotationSpinTimerRef.current);
    if (rotationSpinFrameRef.current !== null) cancelAnimationFrame(rotationSpinFrameRef.current);
  }, []);

  /**
   * Turn the whole floor plan. Wall outline, doors, furniture and (in 'layout'
   * scope) the sensor all move together through `commitRoom`, so a rotation is a
   * single undoable step that persists with the normal room save.
   *
   * Locks are deliberately overridden: rotating some objects but not others
   * would tear the plan apart, so pinned walls, furniture, doors and even a
   * position-locked sensor all come along. The Layout panel says so, and Undo is
   * one keystroke away.
   */
  const rotateLayout = useCallback(
    (angleDeg: number, scope: RotationScope) => {
      const room = selectedRoom;
      if (!room) return;
      const snapshot = snapshotRoom(room);
      if (!canRotateRoomSnapshot(snapshot)) return;

      const angle = normalizeSignedAngle(angleDeg);
      const rotated = rotateRoomSnapshot(snapshot, angle, scope);
      if (rotated === snapshot) return;

      // A rotation is never part of a drag gesture, so it always opens a fresh
      // undo step rather than collapsing into the previous one.
      endHistoryGesture();
      commitRoom(applyRoomSnapshot(room, rotated));

      // Wall indices and door anchors survive a rotation, but every transient
      // interaction is now pointing at coordinates that have just moved.
      stopDrawing();
      setSelectedSegment(null);
      setHoveredSegment(null);
      setSegmentDragIndex(null);
      setSegmentDragStart(null);
      setSegmentDragBase(null);
      setEndpointDrag(null);
      setDoorDrag(null);
      setIsDoorPlacementMode(false);
      // Basic-shape mode survives a rotation: dropping it here would take the
      // wall dimension labels with it and there is no way to get them back short
      // of replacing the outline. Remember the angle instead, so a later
      // wall-length edit regenerates the shape at its current orientation.
      setBasicShapeRotationDeg((prev) => normalizeSignedAngle(prev + angle));
      setCursorPos(null);
      setCursorDelta(null);
      // The suggested installation angle was computed against the old walls.
      setShowRotationSuggestion(false);
      lastRotationSuggestionRef.current = null;

      playRotationSpin(angle);
    },
    [commitRoom, endHistoryGesture, playRotationSpin, selectedRoom, stopDrawing],
  );

  const rotateLayoutBy = useCallback(
    (angleDeg: number) => rotateLayout(angleDeg, rotationScope),
    [rotateLayout, rotationScope],
  );

  useEffect(() => {
    const load = async () => {
      try {
        const [deviceRes, profileRes, roomRes] = await Promise.all([fetchDevices(), fetchProfiles(), fetchRooms()]);
        setDevices(deviceRes.devices);
        setProfiles(profileRes.profiles);
        setRooms(roomRes.rooms);
        setSavedRooms(Object.fromEntries(roomRes.rooms.map((room) => [room.id, room])));

        // A room the user already picked wins over the incoming prop - the fetch
        // can resolve after they used the header dropdown.
        const initialRoom = resolveLoadedRoomSelection(roomRes.rooms, initialRoomId, selectedRoomIdRef.current);
        let profileId = initialRoom?.profileId ?? selectedProfileIdRef.current ?? null;
        if (!profileId && profileRes.profiles.length > 0) {
          profileId = initialProfileId ?? profileRes.profiles[0].id;
        }

        if (initialRoom) setSelectedRoomId(initialRoom.id);
        if (profileId) setSelectedProfileId(profileId);
        // Tell the app what we landed on, so `initialRoomId` tracks the builder
        // instead of pulling it somewhere else later.
        if (initialRoom || profileId) {
          onRoomChange?.(initialRoom?.id ?? selectedRoomIdRef.current ?? null, profileId);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      }
    };
    load();
    // Initialisation only: this effect writes `rooms`/`savedRooms` and the
    // selection, so depending on any of them would refetch mid-edit and snap the
    // user back to `initialRoomId`. External room changes are handled by the
    // sync effect below.
  }, []);

  useEffect(() => {
    // Follow the parent only when it actually points somewhere new, and without
    // refetching: the builder owns the selection while it is open, so a prop
    // that simply lags behind must never override the user's own pick.
    const nextRoomId = initialRoomId ?? null;
    if (!rooms.length) return; // wait for the load; the prop is handled there
    const changed = nextRoomId !== lastInitialRoomIdRef.current;
    lastInitialRoomIdRef.current = nextRoomId;
    if (!changed || !nextRoomId || nextRoomId === selectedRoomId) return;
    const room = rooms.find((r) => r.id === nextRoomId);
    if (!room) return;
    setSelectedRoomId(room.id);
    if (room.profileId) setSelectedProfileId(room.profileId);
  }, [initialRoomId, rooms, selectedRoomId]);

  useEffect(() => {
    // reset pan when switching rooms
    setPanOffsetMm({ x: 0, y: 0 });
    setClearedPoints(null);
    setShowClearConfirm(false);
    setActiveBasicShape(null);
    // Each room keeps its own stack for the session, so switching back to a room
    // keeps its undo history.
    endHistoryGesture();
    syncHistoryAvailability(selectedRoomId);
  }, [endHistoryGesture, selectedRoomId, syncHistoryAvailability]);

  const handleAddPoint = (p: { x: number; y: number }) => {
    if (!selectedRoom) return;
    const nextPoints = [...(selectedRoom.roomShell?.points ?? []), p];
    handlePointsChange(nextPoints);
  };

  const handleApplyBasicShape = (points: RoomShapePoint[], selection: BasicRoomShapeSelection) => {
    if (!selectedRoom) return;
    // Replacing the outline would take locked walls with it.
    if (lockedWallSegments.length) {
      window.alert('Some walls are locked. Unlock them before replacing the room shape.');
      return;
    }
    if (selectedRoom.roomShell?.points?.length && !window.confirm(
      'Replace the current walls? Manual wall adjustments and doors attached to those walls will be removed.'
    )) return;
    const nextRoom: RoomConfig = { ...selectedRoom, roomShell: { points }, doors: [] };
    commitRoom(nextRoom);
    stopDrawing();
    setIsDoorPlacementMode(false);
    setSelectedSegment(null);
    setSegmentDragIndex(null);
    setSegmentDragStart(null);
    setSegmentDragBase(null);
    setEndpointDrag(null);
    setDoorDrag(null);
    setSelectedDoorId(null);
    setActiveBasicShape(selection);
    // Swapping one shape straight for another never passes through "no shape",
    // so the effect above cannot clear this - a freshly placed shape is
    // axis-aligned again.
    setBasicShapeRotationDeg(0);
    setShowBasicShapes(false);
    setActiveMobileSheet(null);
    const maxDimension = Math.max(
      Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x)),
      Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y)),
    );
    setZoom(Math.min(5, Math.max(0.1, (0.8 * rangeMm) / Math.max(100, maxDimension + 1000))));
    setPanOffsetMm({ x: 0, y: 0 });
  };

  const handleClear = () => {
    if (!selectedRoom) return;
    if (!selectedRoom.roomShell?.points?.length) {
      stopDrawing();
      return;
    }
    // Clearing removes every wall at once, including any that are pinned.
    if (lockedWallSegments.length) {
      window.alert('Some walls are locked. Unlock them before clearing the room outline.');
      return;
    }
    // Ask first even though Undo can now bring them back within this session.
    setShowClearConfirm(true);
  };

  const confirmClear = () => {
    if (!selectedRoom) {
      setShowClearConfirm(false);
      return;
    }
    setClearedPoints(selectedRoom.roomShell?.points ?? null);
    handlePointsChange([]);
    setActiveBasicShape(null);
    stopDrawing();
    setShowClearConfirm(false);
  };

  const restoreClearedPoints = () => {
    if (!clearedPoints?.length) return;
    handlePointsChange(clearedPoints);
    setClearedPoints(null);
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

  const deleteSelectedWallPoint = useCallback(() => {
    const ptsDelete = selectedRoom?.roomShell?.points ?? [];
    if (selectedSegment === null || ptsDelete.length <= 2) return;
    if (isSegmentLocked(selectedRoom?.roomShell, selectedSegment)) return;

    const removeIdx = (selectedSegment + 1) % ptsDelete.length;
    // Removing a corner merges the two walls that meet at it, so the other one
    // has to be unlocked too before this is allowed.
    if (isSegmentLocked(selectedRoom?.roomShell, removeIdx)) return;
    const nextDelete = ptsDelete.filter((_, idx) => idx !== removeIdx);
    // Every later wall is renumbered; locks and doors are anchored by index and
    // have to follow, or they end up attached to the wrong wall.
    handlePointsChange(nextDelete, {
      lockedSegments: remapLockedSegmentsForPointRemoval(
        selectedRoom?.roomShell?.lockedSegments,
        removeIdx,
        ptsDelete.length,
      ),
      doors: remapDoorsForPointRemoval(selectedRoom?.doors, removeIdx, ptsDelete.length),
    });
    setSelectedSegment(null);
    setHoveredSegment(null);
  }, [handlePointsChange, selectedRoom?.doors, selectedRoom?.roomShell, selectedSegment]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isTextEntry =
        target?.isContentEditable ||
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select';
      const isEditable = isTextEntry || tag === 'button';

      // Undo/redo stay available right after clicking a toolbar button, so they
      // are handled before the "focus is on a control" bail-out. Text fields
      // keep the browser's own undo.
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === 'z' || key === 'y') {
          if (isTextEntry) return;
          e.preventDefault();
          if (key === 'y' || e.shiftKey) {
            handleRedo();
          } else {
            handleUndo();
          }
          return;
        }
      }

      // Rotate follows undo/redo above rather than the bail-out below: the
      // toolbar buttons advertise "(R)", and pressing it right after clicking
      // one has to work even though focus is still on that button. Text fields
      // keep their own letter.
      if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (isTextEntry) return;
        if (!canRotateLayout) return;
        e.preventDefault();
        rotateLayoutBy(e.shiftKey ? -ROTATION_STEP_DEG : ROTATION_STEP_DEG);
        return;
      }

      if (isEditable) return;

      if (e.key === 'Escape') {
        stopDrawing();
        return;
      }
      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        if (activeBasicShape) {
          setActiveBasicShape(null);
          setIsDrawingWall(true);
        } else {
          setIsDrawingWall((prev) => !prev);
        }
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
        if (!selectedRoom?.roomShell?.points?.length) return;
        // Del is a point-level delete, never a general undo: it removes the
        // selected wall point, or the point just drawn while drawing is active.
        if (selectedSegment !== null) {
          e.preventDefault();
          deleteSelectedWallPoint();
          return;
        }
        if (isDrawingWall) {
          e.preventDefault();
          removeLastPoint();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    canRotateLayout,
    deleteSelectedWallPoint,
    handleCloseLoop,
    handleRedo,
    handleUndo,
    isDrawingWall,
    activeBasicShape,
    removeLastPoint,
    rotateLayoutBy,
    selectedRoom?.roomShell?.points,
    selectedSegment,
    setIsDrawingWall,
    stopDrawing,
  ]);


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

  const adjustSegmentLength = (meters: number) => {
    if (selectedSegment === null || !selectedRoom?.roomShell?.points) return;
    if (isSegmentLocked(selectedRoom.roomShell, selectedSegment)) return;
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
    if (isSegmentLocked(selectedRoom.roomShell, selectedSegment)) return;
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

  useEffect(() => {
    if (selectedSegment === null || !selectedRoom?.roomShell?.points?.length) {
      setWallLengthInput('');
      setWallLengthFeetInput('');
      setWallLengthInchesInput('');
      return;
    }

    const pts = selectedRoom.roomShell.points;
    const start = pts[selectedSegment];
    const end = pts[(selectedSegment + 1) % pts.length];
    if (!start || !end) {
      setWallLengthInput('');
      setWallLengthFeetInput('');
      setWallLengthInchesInput('');
      return;
    }

    const lengthMm = Math.hypot(end.x - start.x, end.y - start.y);
    if (displayUnits === 'imperial') {
      const totalInches = Math.round(lengthMm / 25.4);
      const feet = Math.floor(totalInches / 12);
      const inches = totalInches % 12;
      setWallLengthFeetInput(String(feet));
      setWallLengthInchesInput(String(inches));
      setWallLengthInput('');
    } else {
      setWallLengthInput((lengthMm / 1000).toFixed(2));
      setWallLengthFeetInput('');
      setWallLengthInchesInput('');
    }
  }, [displayUnits, selectedRoom?.roomShell?.points, selectedSegment]);

  const commitSelectedSegmentLength = (rawValue: string) => {
    if (displayUnits === 'imperial') {
      return;
    }

    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) return;
    adjustSegmentLength(Math.max(0.1, parsed));
  };

  const commitSelectedSegmentImperialLength = (feetRaw: string, inchesRaw: string) => {
    const feet = feetRaw.trim() === '' ? 0 : Number(feetRaw);
    const inches = inchesRaw.trim() === '' ? 0 : Number(inchesRaw);
    if (!Number.isFinite(feet) || !Number.isFinite(inches)) return;

    const totalInches = feet * 12 + inches;
    const meters = (totalInches * 25.4) / 1000;
    adjustSegmentLength(Math.max(0.1, meters));
  };

  const segmentEditorPosition = useMemo(() => {
    if (selectedSegment === null || !selectedRoom?.roomShell?.points?.length) return null;

    const pts = selectedRoom.roomShell.points;
    const start = pts[selectedSegment];
    const end = pts[(selectedSegment + 1) % pts.length];
    if (!start || !end) return null;

    const range = rangeMm || 6000;
    const startCanvasX = HALF + toCanvas(start.x, range);
    const startCanvasY = HALF + toCanvas(start.y, range);
    const endCanvasX = HALF + toCanvas(end.x, range);
    const endCanvasY = HALF + toCanvas(end.y, range);
    const midX = (startCanvasX + endCanvasX) / 2;
    const midY = (startCanvasY + endCanvasY) / 2;
    const dx = endCanvasX - startCanvasX;
    const dy = endCanvasY - startCanvasY;
    const length = Math.hypot(dx, dy) || 1;
    const normalX = -dy / length;
    const normalY = dx / length;

    const scaleX = canvasViewportSize.width > 0 ? canvasViewportSize.width / CANVAS_SIZE : 1;
    const scaleY = canvasViewportSize.height > 0 ? canvasViewportSize.height / CANVAS_SIZE : 1;
    const preferredX = (midX + normalX * 110) * scaleX - WALL_EDITOR_WIDTH / 2;
    const preferredY = (midY + normalY * 110) * scaleY - WALL_EDITOR_HEIGHT / 2;
    const maxLeft = Math.max(WALL_EDITOR_MARGIN, canvasViewportSize.width - WALL_EDITOR_WIDTH - WALL_EDITOR_MARGIN);
    const maxTop = Math.max(WALL_EDITOR_MARGIN, canvasViewportSize.height - WALL_EDITOR_HEIGHT - WALL_EDITOR_MARGIN);
    const clampedLeft = Math.min(maxLeft, Math.max(WALL_EDITOR_MARGIN, preferredX + wallEditorDragOffset.x));
    const clampedTop = Math.min(maxTop, Math.max(WALL_EDITOR_MARGIN, preferredY + wallEditorDragOffset.y));

    return { left: clampedLeft, top: clampedTop };
  }, [canvasViewportSize.height, canvasViewportSize.width, selectedRoom?.roomShell?.points, selectedSegment, rangeMm, wallEditorDragOffset]);

  useEffect(() => {
    setWallEditorDragOffset({ x: 0, y: 0 });
    setWallEditorDragging(false);
    wallEditorDragPointerRef.current = null;
    wallEditorDragStartRef.current = null;
  }, [selectedSegment]);

  useEffect(() => {
    const element = canvasViewportRef.current;
    if (!element) return;

    const updateSize = () => {
      setCanvasViewportSize({
        width: element.clientWidth,
        height: element.clientHeight,
      });
    };

    updateSize();

    const observer = new ResizeObserver(() => updateSize());
    observer.observe(element);
    return () => observer.disconnect();
  }, [selectedRoom?.id]);

  const handleWallEditorDragPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (segmentEditorPosition === null) return;
    wallEditorDragPointerRef.current = e.pointerId;
    wallEditorDragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      offsetX: wallEditorDragOffset.x,
      offsetY: wallEditorDragOffset.y,
    };
    setWallEditorDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const handleWallEditorDragPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (wallEditorDragPointerRef.current !== e.pointerId || wallEditorDragStartRef.current === null) return;
    const start = wallEditorDragStartRef.current;
    setWallEditorDragOffset({
      x: start.offsetX + (e.clientX - start.x),
      y: start.offsetY + (e.clientY - start.y),
    });
  };

  const handleWallEditorDragPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (wallEditorDragPointerRef.current !== e.pointerId) return;
    wallEditorDragPointerRef.current = null;
    wallEditorDragStartRef.current = null;
    setWallEditorDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
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

  const snapPointToGrid = useCallback((pt: { x: number; y: number }) => {
    if (!snapGridMm || snapGridMm <= 0) return pt;
    const step = snapGridMm;
    return {
      x: Math.round(pt.x / step) * step,
      y: Math.round(pt.y / step) * step,
    };
  }, [snapGridMm]);

  const insertPointOnSegment = useCallback((segmentIndex: number, point?: { x: number; y: number }) => {
    if (!selectedRoom?.roomShell?.points) return;
    if (isDrawingWall || isDoorPlacementMode) return;
    if (isSegmentLocked(selectedRoom.roomShell, segmentIndex)) return;
    const pts = selectedRoom.roomShell.points;
    if (pts.length < 2) return;
    const a = pts[segmentIndex];
    const b = pts[(segmentIndex + 1) % pts.length];
    if (!a || !b) return;
    const rawPoint = point ?? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const snapped = snapPointToGrid(rawPoint);
    const minDist = Math.min(
      Math.hypot(snapped.x - a.x, snapped.y - a.y),
      Math.hypot(snapped.x - b.x, snapped.y - b.y),
    );
    if (minDist < 50) return;
    const insertIndex = segmentIndex === pts.length - 1 ? pts.length : segmentIndex + 1;
    const next = [...pts];
    next.splice(insertIndex, 0, snapped);
    // Splitting shifts every later wall index up by one, so the index-anchored
    // locks and doors have to be carried across with it.
    const segmentLength = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const splitRatio = Math.hypot(snapped.x - a.x, snapped.y - a.y) / segmentLength;
    handlePointsChange(next, {
      lockedSegments: remapLockedSegmentsForSplit(selectedRoom.roomShell.lockedSegments, segmentIndex),
      doors: remapDoorsForSplit(selectedRoom.doors, segmentIndex, splitRatio),
    });
    setSelectedSegment(segmentIndex);
  }, [selectedRoom, isDrawingWall, isDoorPlacementMode, snapPointToGrid, handlePointsChange]);

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
      if (angleSnapEnabled) {
        ({ dx, dy } = snapDelta(dx, dy));
      }
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
      handlePointsChange(next, { coalesceKey: `points:endpoint-drag:${endpointDrag.segment}:${endpointDrag.endpoint}` });
      return;
    }

    // If dragging a segment, move both endpoints together.
    if (segmentDragIndex !== null && segmentDragStart && segmentDragBase && selectedRoom) {
      let dx = pt.x - segmentDragStart.x;
      let dy = pt.y - segmentDragStart.y;
      if (angleSnapEnabled) {
        ({ dx, dy } = snapDelta(dx, dy));
      }
      const next = segmentDragBase.map((p) => ({ x: p.x, y: p.y }));
      const aIdx = segmentDragIndex;
      const bIdx = (segmentDragIndex + 1) % next.length;
      const snappedA = snapPointToGrid({ x: segmentDragBase[aIdx].x + dx, y: segmentDragBase[aIdx].y + dy });
      const snappedB = snapPointToGrid({ x: segmentDragBase[bIdx].x + dx, y: segmentDragBase[bIdx].y + dy });
      next[aIdx] = snappedA;
      next[bIdx] = snappedB;
      handlePointsChange(next, { coalesceKey: `points:segment-drag:${segmentDragIndex}` });
      return;
    }

    // If drawing walls, use the hook's handler
    if (isDrawingWall) {
      wallDrawingMove(pt);
    }
  };

  const hasUnsavedChanges = useMemo(() => {
    if (!selectedRoom) return false;
    const saved = savedRooms[selectedRoom.id];
    if (!saved) return false;
    return roomSignature(saved) !== roomSignature(selectedRoom);
  }, [savedRooms, selectedRoom]);

  const handleSaveRoom = useCallback(async (): Promise<boolean> => {
    if (!selectedRoom) return false;
    setSaving(true);
    try {
      // The backend only removes a stored outline on an explicit `roomShell: null`,
      // so an intentional save of an emptied room has to say so.
      const payload: RoomUpdatePayload = {
        ...selectedRoom,
        roomShell: selectedRoom.roomShell?.points?.length ? selectedRoom.roomShell : null,
      };
      const result = await updateRoom(selectedRoom.id, payload);
      setRooms((prev) => prev.map((r) => (r.id === selectedRoom.id ? result.room : r)));
      setSavedRooms((prev) => ({ ...prev, [result.room.id]: result.room }));
      onWizardProgress?.({ outlineDone: true, placementDone: true });
      setError(null);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save room');
      return false;
    } finally {
      setSaving(false);
    }
  }, [onWizardProgress, selectedRoom]);

  const leave = useCallback(
    (target: PendingLeave) => {
      if (target.type === 'back') {
        onBack?.();
        return;
      }
      onNavigate?.(target.view);
    },
    [onBack, onNavigate]
  );

  // Leaving the Room Builder never writes silently: unsaved edits (including
  // deleted walls) prompt for Save / Discard / Cancel first.
  const requestLeave = useCallback(
    (target: PendingLeave) => {
      if (target.type === 'navigate' && !onNavigate) return;
      if (target.type === 'back' && !onBack) return;
      if (selectedRoom && hasUnsavedChanges) {
        setPendingLeave(target);
        return;
      }
      leave(target);
    },
    [hasUnsavedChanges, leave, onBack, onNavigate, selectedRoom]
  );

  const navigateTo = useCallback(
    (view: RoomBuilderView) => requestLeave({ type: 'navigate', view }),
    [requestLeave]
  );

  const handlePendingSaveAndLeave = useCallback(async () => {
    const target = pendingLeave;
    if (!target) return;
    const saved = await handleSaveRoom();
    if (!saved) return; // keep the prompt open; the error toast explains why
    setPendingLeave(null);
    leave(target);
  }, [handleSaveRoom, leave, pendingLeave]);

  const handlePendingDiscardAndLeave = useCallback(() => {
    const target = pendingLeave;
    if (!target) return;
    if (selectedRoom) {
      const saved = savedRooms[selectedRoom.id];
      if (saved) {
        setRooms((prev) => prev.map((r) => (r.id === saved.id ? saved : r)));
      }
      // Discarded edits must not be reachable through Undo afterwards.
      historyRef.current.delete(selectedRoom.id);
      endHistoryGesture();
      syncHistoryAvailability(selectedRoom.id);
    }
    setClearedPoints(null);
    setPendingLeave(null);
    leave(target);
  }, [endHistoryGesture, leave, pendingLeave, savedRooms, selectedRoom, syncHistoryAvailability]);

  // Reloading or closing the tab also discards unsaved room edits - warn first.
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges]);

  const handleAutoZoom = useCallback((room: RoomConfig | null) => {
    if (!room?.roomShell?.points?.length) {
      setZoom(1);
      setPanOffsetMm({ x: 0, y: 0 });
      return;
    }
    const pts = room.roomShell.points;
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
  }, [rangeMm]);

  // Auto-zoom when room loads
  useEffect(() => {
    if (!selectedRoom) return;
    if (selectedRoom.roomShell?.points?.length) {
      handleAutoZoom(selectedRoom);
      return;
    }
    setZoom(1);
    setPanOffsetMm({ x: 0, y: 0 });
  }, [selectedRoom?.id, handleAutoZoom]);

  useEffect(() => {
    if (!isMobileCanvas) {
      setActiveMobileSheet(null);
    }
  }, [isMobileCanvas]);

  const handleRoomSelection = useCallback((roomId: string | null) => {
    setSelectedRoomId(roomId);
    const room = rooms.find((candidate) => candidate.id === roomId);
    if (room?.profileId) setSelectedProfileId(room.profileId);
    // Keep the rest of the app on the same room, so `initialRoomId` cannot pull
    // the builder back and the choice survives navigating away and back.
    onRoomChange?.(roomId, room?.profileId ?? selectedProfileId);
  }, [onRoomChange, rooms, selectedProfileId]);

  const toggleMobileToolsSheet = () => {
    setShowSettings(false);
    setActiveMobileSheet((current) => current === 'tools' ? null : 'tools');
  };

  const toggleMobileSettingsSheet = () => {
    setActiveMobileSheet(null);
    setShowSettings((current) => !current);
  };

  const toggleMobileZoomSheet = () => {
    setShowSettings(false);
    setActiveMobileSheet((current) => current === 'zoom' ? null : 'zoom');
  };

  const isSuggestionApplied =
    currentInstallationAngle !== null &&
    rotationSuggestion &&
    rotationSuggestion.suggestedAngle === currentInstallationAngle;
  const isZeroSuggestion = rotationSuggestion?.suggestedAngle === 0;

  return (
    <div className="fixed inset-0 bg-slate-950 overflow-hidden">
      {/* Error Toast */}
      {error && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-50 max-w-lg rounded-xl border border-rose-500/50 bg-rose-500/10 backdrop-blur px-6 py-3 text-rose-100 shadow-xl animate-in slide-in-from-top-4 fade-in">
          {error}
        </div>
      )}

      {showBasicShapes && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm">
          <BasicRoomShapesPicker
            units={displayUnits}
            onApply={handleApplyBasicShape}
            onDrawOwn={() => {
              setShowBasicShapes(false);
              setActiveBasicShape(null);
              setIsDoorPlacementMode(false);
              setIsDrawingWall(true);
            }}
            onCancel={() => setShowBasicShapes(false)}
          />
        </div>
      )}

      {/* Installation Angle Suggestion Modal */}
      {showRotationSuggestion && rotationSuggestion && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowRotationSuggestion(false)}
          />
          {/* Modal */}
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
              {isZeroSuggestion && !rotationSuggestionError && !isSuggestionApplied && (
                <div className="mb-4 text-sm text-slate-300 text-center">
                  Rotation already aligns with your walls. Installation angle can stay at 0.
                </div>
              )}
              {isSuggestionApplied && !rotationSuggestionError && (
                <div className="mb-4 text-sm text-emerald-300 text-center">
                  Installation angle is already set to this value.
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
                  disabled={applyingInstallationAngle || isSuggestionApplied}
                  className="flex-1 rounded-xl bg-gradient-to-r from-amber-600 to-amber-500 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-amber-500/30 transition-all hover:shadow-xl hover:shadow-amber-500/40 disabled:opacity-50 active:scale-95"
                >
                  {isSuggestionApplied ? 'Already set' : applyingInstallationAngle ? 'Applying...' : 'Apply'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Unsaved changes prompt - shown instead of silently saving when leaving */}
      {pendingLeave && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setPendingLeave(null)} />
          <div className="relative z-10 w-full max-w-md mx-4 rounded-2xl border border-slate-700/50 bg-slate-900/95 backdrop-blur shadow-2xl animate-in zoom-in-95 fade-in duration-200">
            <div className="p-6">
              <h3 className="text-xl font-bold text-white text-center mb-2">Unsaved changes</h3>
              <p className="text-sm text-slate-300 text-center mb-5">
                This room has changes that have not been saved yet. Save them before leaving, or discard them and keep
                the last saved version of the room.
              </p>
              <div className="flex flex-col gap-2">
                <button
                  onClick={handlePendingSaveAndLeave}
                  disabled={saving}
                  className="w-full rounded-xl bg-gradient-to-r from-aqua-600 to-aqua-500 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-aqua-500/30 transition-all hover:shadow-xl disabled:opacity-50 active:scale-95"
                >
                  {saving ? 'Saving...' : 'Save and leave'}
                </button>
                <button
                  onClick={handlePendingDiscardAndLeave}
                  disabled={saving}
                  className="w-full rounded-xl border border-rose-600/50 bg-rose-600/10 px-4 py-2.5 text-sm font-semibold text-rose-100 transition-all hover:bg-rose-600/20 disabled:opacity-50 active:scale-95"
                >
                  Discard changes
                </button>
                <button
                  onClick={() => setPendingLeave(null)}
                  disabled={saving}
                  className="w-full rounded-xl border border-slate-600 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-200 transition-all hover:bg-slate-700 disabled:opacity-50 active:scale-95"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Clear walls confirmation */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowClearConfirm(false)} />
          <div className="relative z-10 w-full max-w-md mx-4 rounded-2xl border border-slate-700/50 bg-slate-900/95 backdrop-blur shadow-2xl animate-in zoom-in-95 fade-in duration-200">
            <div className="p-6">
              <div className="flex justify-center mb-4">
                <div className="w-12 h-12 rounded-full bg-rose-500/20 flex items-center justify-center">
                  <span className="text-xl">🗑️</span>
                </div>
              </div>
              <h3 className="text-xl font-bold text-white text-center mb-2">Delete all walls?</h3>
              <p className="text-sm text-slate-300 text-center mb-5">
                This removes the entire outline of {selectedRoom?.name ?? 'this room'}. Undo (Ctrl/Cmd+Z) can bring it
                back while you stay on this page - after a reload, only the saved version on disk can.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowClearConfirm(false)}
                  className="flex-1 rounded-xl border border-slate-600 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-200 transition-all hover:bg-slate-700 active:scale-95"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmClear}
                  className="flex-1 rounded-xl bg-gradient-to-r from-rose-600 to-rose-500 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-rose-500/30 transition-all hover:shadow-xl active:scale-95"
                >
                  Delete walls
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* In-session recovery for a cleared outline */}
      {clearedPoints?.length && !(selectedRoom?.roomShell?.points?.length) ? (
        <div className="absolute bottom-24 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-amber-500/40 bg-slate-900/95 px-4 py-3 text-sm text-amber-100 shadow-2xl backdrop-blur md:bottom-6">
          <span>Walls cleared. Nothing is saved until you press Save Room.</span>
          <button
            type="button"
            onClick={restoreClearedPoints}
            className="rounded-lg border border-amber-500/50 bg-amber-500/20 px-3 py-1.5 text-xs font-bold text-amber-100 transition-all hover:bg-amber-500/30 active:scale-95"
          >
            Restore walls
          </button>
          <button
            type="button"
            onClick={() => setClearedPoints(null)}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 transition-all hover:bg-slate-800 active:scale-95"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="md:hidden">
        <CanvasTopBar
          left={onBack && !onNavigate ? (
            <button
              type="button"
              onClick={() => requestLeave({ type: 'back' })}
              className="min-h-[40px] rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm font-semibold text-slate-100"
            >
              Back
            </button>
          ) : onNavigate ? (
            <button
              type="button"
              onClick={() => setActiveMobileSheet('navigation')}
              className="min-h-[40px] rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm font-semibold text-slate-100"
            >
              Menu
            </button>
          ) : null}
          title={rooms.length > 0 ? (
            <select
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm font-semibold text-slate-100 focus:border-aqua-500 focus:outline-none focus:ring-1 focus:ring-aqua-500/50"
              value={selectedRoomId ?? ''}
              onChange={(event) => handleRoomSelection(event.target.value || null)}
            >
              <option value="">Select room</option>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </select>
          ) : 'Room Builder'}
          right={(
            <button
              type="button"
              onClick={handleSaveRoom}
              disabled={saving || !selectedRoom}
              className="min-h-[40px] rounded-lg bg-aqua-600 px-3 text-xs font-bold text-white shadow-lg shadow-aqua-500/20 disabled:opacity-50"
            >
              {saving ? 'Saving' : hasUnsavedChanges ? 'Save •' : 'Save'}
            </button>
          )}
        />
      </div>

      {/* Navigation (top left) */}
      {onBack && !onNavigate && (
        <button
          onClick={() => requestLeave({ type: 'back' })}
          className="absolute top-6 left-6 z-40 hidden group rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur px-4 py-2.5 text-sm font-semibold text-slate-100 shadow-lg transition-all hover:border-slate-600 hover:bg-slate-800 hover:shadow-xl active:scale-95 md:block"
        >
          <span className="inline-block transition-transform group-hover:-translate-x-0.5">←</span> Back
        </button>
      )}

      {onNavigate && (
        <div className={`absolute top-6 left-6 hidden md:block ${showNavMenu ? 'z-[60]' : 'z-40'}`}>
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
                      setShowNavMenu(false);
                      navigateTo('liveDashboard');
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm font-medium text-slate-100 rounded-lg transition-all hover:bg-aqua-600/20 hover:text-aqua-400 active:scale-95"
                  >
                    📡 Live Dashboard
                  </button>
                  <button
                    onClick={() => {
                      setShowNavMenu(false);
                      navigateTo('wizard');
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm font-medium text-slate-100 rounded-lg transition-all hover:bg-aqua-600/20 hover:text-aqua-400 active:scale-95"
                  >
                    ➕ Add Device
                  </button>
                  <button
                    onClick={() => {
                      setShowNavMenu(false);
                      navigateTo('zoneEditor');
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm font-medium text-slate-100 rounded-lg transition-all hover:bg-aqua-600/20 hover:text-aqua-400 active:scale-95"
                  >
                    📐 Zone Editor
                  </button>
                  <button
                    onClick={() => {
                      setShowNavMenu(false);
                      navigateTo('settings');
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
        className={`absolute top-6 z-40 hidden rounded-xl bg-gradient-to-r from-aqua-600 to-aqua-500 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-aqua-500/30 transition-all hover:shadow-xl hover:shadow-aqua-500/40 disabled:opacity-50 active:scale-95 md:block ${desktopEditorOpen ? 'right-[22rem]' : 'right-6'}`}
      >
        {saving ? 'Saving...' : hasUnsavedChanges ? 'Save Room •' : 'Save Room'}
      </button>
      {hasUnsavedChanges && !saving && (
        <div
          className={`pointer-events-none absolute top-[4.25rem] z-40 hidden rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-200 backdrop-blur md:block ${
            desktopEditorOpen ? 'right-[22rem]' : 'right-6'
          }`}
        >
          Unsaved changes
        </div>
      )}

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
          ref={canvasViewportRef}
          className="relative h-full w-full overflow-hidden overscroll-contain touch-none"
          onWheelCapture={(e) => {
            if (isCanvasDragging) return;
            if (e.cancelable) e.preventDefault();
            if ((e.nativeEvent as any)?.cancelable) {
              (e.nativeEvent as any).preventDefault();
            }
            e.stopPropagation();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            setZoom((z) => Math.min(5, Math.max(0.1, z + delta)));
          }}
        >
                {/*
                  Rotation spin: the geometry is already rotated by the time this
                  renders, so the wrapper starts the canvas back at the old
                  orientation and turns it into place. `getScreenCTM` keeps
                  pointer maths honest through the transform, but interacting
                  with a moving plan is never what anyone means, so the wrapper
                  swallows pointer events for the duration.
                */}
                <div
                  className={`h-full w-full ${rotationSpin ? 'room-rotate-spin pointer-events-none' : ''}`}
                  style={
                    rotationSpin
                      ? ({ '--room-rotate-from': `${rotationSpin.fromDeg}deg` } as React.CSSProperties)
                      : undefined
                  }
                  onAnimationEnd={(e) => {
                    // Animation events bubble, so ignore anything the canvas itself animates.
                    if (e.target !== e.currentTarget) return;
                    setRotationSpin((current) => (current?.id === rotationSpin?.id ? null : current));
                  }}
                >
                <RoomCanvas
                  points={selectedRoom.roomShell?.points ?? []}
                  // The canvas emits this while a corner point is being dragged.
                  onChange={(nextPoints) => handlePointsChange(nextPoints, { coalesceKey: 'points:vertex-drag' })}
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
                    setIsCanvasDragging(false);
                    endHistoryGesture();
                  }}
                  onDragStateChange={setIsCanvasDragging}
                  lockShell={!!activeBasicShape}
                  lockedSegments={lockedWallSegments}
                  // Padlocks are an editing affordance, so only the builder shows them.
                  showLockIndicators
                  showAllWallLengthLabels={!!activeBasicShape}
                  onWallLengthChange={activeBasicShape ? (segmentIndex, lengthMm) => {
                    try {
                      const resized = resizeBasicRoomShapeWall(activeBasicShape, segmentIndex, lengthMm);
                      // The shape regenerates axis-aligned, so put back however
                      // far the plan has been rotated since it was placed.
                      const points = rotatePointsKeepingBoundsCenter(resized.points, basicShapeRotationDeg);
                      setActiveBasicShape(resized.selection);
                      handlePointsChange(points);
                      setPanOffsetMm({ x: 0, y: 0 });
                      const maxDimension = Math.max(
                        Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x)),
                        Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y)),
                      );
                      setZoom(Math.min(5, Math.max(0.1, (0.8 * rangeMm) / Math.max(100, maxDimension + 1000))));
                    } catch { /* Invalid dimensions leave the last valid centered outline unchanged. */ }
                  } : undefined}
                  rangeMm={rangeMm}
                  gridSpacingMm={1000}
                  snapGridMm={snapGridMm}
                  zoom={zoom}
                  panOffsetMm={panOffsetMm}
                  onPanChange={(next) => setPanOffsetMm(next)}
                  onZoomChange={setZoom}
                  touchPanEnabled={!isDrawingWall && !isDoorPlacementMode}
                  displayUnits={displayUnits}
                  devicePlacement={
                    selectedRoom.devicePlacement ?? {
                      x: 0,
                      y: 0,
                      rotationDeg: 0,
                    }
                  }
                  onDeviceChange={(placement) => updateDevicePlacement(placement)}
                  // Clicking the device without moving it is a selection: open its
                  // settings, the same way clicking furniture opens the furniture panel.
                  onDeviceClick={() => {
                    setSelectedFurnitureId(null);
                    setSelectedDoorId(null);
                    setSelectedSegment(null);
                    setHoveredSegment(null);
                    setShowFurnitureLibrary(false);
                    setActiveMobileSheet(null);
                    setSettingsTab('device');
                    setShowSettings(true);
                  }}
                  fieldOfViewDeg={coverageFov?.horizontalFovDeg ?? selectedProfile?.limits?.fieldOfViewDegrees}
                  maxRangeMeters={effectiveCoverageMaxRangeMeters}
                  deviceIconUrl={deviceIconUrl}
                  clipRadarToWalls={clipRadarToWalls}
                  heightCoverage={heightCoverageConfig ?? undefined}
                  showRadar={showDeviceRadar && !isCeilingMount}
                  previewFrom={pendingStart}
                  previewTo={pendingStart && previewPoint ? previewPoint : null}
                  hoveredSegment={hoveredSegment}
                  selectedSegment={selectedSegment}
                  onSegmentHover={(idx) => setHoveredSegment(idx)}
                  onSegmentSelect={(idx) => {
                    setSelectedSegment(idx);
                    setSelectedDoorId(null);
                    setSelectedFurnitureId(null);
                    setSegmentDragIndex(null);
                    setSegmentDragStart(null);
                    setSegmentDragBase(null);
                    setEndpointDrag(null);
                  }}
                  onSegmentDragStart={(idx, start) => {
                    const pts = selectedRoom?.roomShell?.points ?? [];
                    if (!pts.length) return;
                    // Dragging a wall moves both of its corners, and with them
                    // the neighbouring walls - refuse if any of that is locked.
                    if (
                      isSegmentLocked(selectedRoom?.roomShell, idx) ||
                      isVertexLocked(selectedRoom?.roomShell, idx, pts.length) ||
                      isVertexLocked(selectedRoom?.roomShell, (idx + 1) % pts.length, pts.length)
                    ) return;
                    setSegmentDragIndex(idx);
                    setSegmentDragStart(start);
                    setSegmentDragBase(pts);
                    setEndpointDrag(null);
                  }}
                  onEndpointDragStart={(segment, endpoint, start) => {
                    const pts = selectedRoom?.roomShell?.points ?? [];
                    if (!pts.length) return;
                    const cornerIdx = endpoint === 'start' ? segment : (segment + 1) % pts.length;
                    // The corner is shared with the neighbouring wall.
                    if (isVertexLocked(selectedRoom?.roomShell, cornerIdx, pts.length)) return;
                    setEndpointDrag({ segment, endpoint, start, base: pts });
                    setSegmentDragIndex(null);
                    setSegmentDragStart(null);
                    setSegmentDragBase(null);
                  }}
                  onSegmentInsert={
                    !isDrawingWall && !isDoorPlacementMode
                      ? (segmentIndex, point) => {
                        insertPointOnSegment(segmentIndex, point);
                      }
                      : undefined
                  }
                  height="100%"
                  furniture={selectedRoom.furniture ?? []}
                  selectedFurnitureId={selectedFurnitureId}
                  onFurnitureSelect={(id) => {
                    setSelectedFurnitureId(id);
                    setSelectedDoorId(null);
                    setSelectedSegment(null);
                    setShowFurnitureLibrary(false);
                  }}
                  onFurnitureChange={handleFurnitureChange}
                  doors={selectedRoom.doors ?? []}
                  selectedDoorId={selectedDoorId}
                  onDoorSelect={(id) => {
                    setSelectedDoorId(id);
                    setSelectedFurnitureId(null);
                    setSelectedSegment(null);
                  }}
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
                  renderOverlay={({ toCanvas }) => {
                    if (!showTargets) return null;

                    const targetColors = [
                      { fill: '#3b82f6', fillOpacity: 'rgba(59, 130, 246, 0.2)' },
                      { fill: '#10b981', fillOpacity: 'rgba(16, 185, 129, 0.2)' },
                      { fill: '#f59e0b', fillOpacity: 'rgba(245, 158, 11, 0.2)' },
                    ];

                    if (isCeilingSliceMode && liveState?.targets?.length) {
                      return (
                        <g style={{ pointerEvents: 'none' }}>
                          {liveState.targets.map((target, idx) => {
                            if (target.x === null || target.y === null) return null;
                            if (target.x === 0 && target.y === 0 && target.active !== true) return null;
                            const lateral = getCeilingSlicePosition(target, ceilingSliceConfig);
                            if (lateral === null) return null;
                            const depth = getCeilingSliceLineDepth(lateral, ceilingSliceConfig, heightCoverageConfig, trackingMaxRangeMm);
                            if (!depth) return null;
                            const endpoints = ceilingSliceConfig.axis === 'x'
                              ? [
                                  deviceLocalToRoom(lateral, depth.min),
                                  deviceLocalToRoom(lateral, depth.max),
                                ]
                              : [
                                  deviceLocalToRoom(depth.min, lateral),
                                  deviceLocalToRoom(depth.max, lateral),
                                ];
                            const start = toCanvas(endpoints[0]);
                            const end = toCanvas(endpoints[1]);
                            const label = toCanvas(deviceLocalToRoom(
                              ceilingSliceConfig.axis === 'x' ? lateral : 0,
                              ceilingSliceConfig.axis === 'x' ? 0 : lateral,
                            ));
                            const colors = targetColors[idx % targetColors.length];
                            return (
                              <g key={target.id}>
                                <line
                                  x1={start.x}
                                  y1={start.y}
                                  x2={end.x}
                                  y2={end.y}
                                  stroke="rgba(15, 23, 42, 0.85)"
                                  strokeWidth={8 * targetMarkerScale}
                                  strokeLinecap="round"
                                  opacity={0.9}
                                />
                                <line
                                  x1={start.x}
                                  y1={start.y}
                                  x2={end.x}
                                  y2={end.y}
                                  stroke={colors.fill}
                                  strokeWidth={4 * targetMarkerScale}
                                  strokeLinecap="round"
                                  opacity={0.95}
                                  strokeDasharray="10 7"
                                />
                                <circle
                                  cx={label.x}
                                  cy={label.y}
                                  r={8 * targetMarkerScale}
                                  fill={colors.fill}
                                  stroke="white"
                                  strokeWidth={2 * targetMarkerScale}
                                />
                                <text
                                  x={label.x}
                                  y={label.y - (14 * targetMarkerScale)}
                                  textAnchor="middle"
                                  fill="white"
                                  fontSize={12 * targetMarkerScale}
                                  fontWeight="bold"
                                  className="pointer-events-none"
                                  style={{ filter: 'drop-shadow(0 1px 2px rgb(0 0 0 / 0.9))' }}
                                >
                                  T{target.id}
                                </text>
                              </g>
                            );
                          })}
                        </g>
                      );
                    }

                    if (!targetPositions?.length) return null;

                    return (
                      <g style={{ pointerEvents: 'none' }}>
                        {targetPositions.map((target, idx) => {
                          const pos = toCanvas({ x: target.x, y: target.y });
                          const colors = targetColors[idx % targetColors.length];
                          return (
                            <g key={target.id}>
                              {/* Outer pulsing circle */}
                              <circle
                                cx={pos.x}
                                cy={pos.y}
                                r={25 * targetMarkerScale}
                                fill={colors.fillOpacity}
                                stroke={colors.fill}
                                strokeWidth={1.5 * targetMarkerScale}
                              />
                              {/* Inner solid dot */}
                              <circle
                                cx={pos.x}
                                cy={pos.y}
                                r={10 * targetMarkerScale}
                                fill={colors.fill}
                              />
                              {/* Label */}
                              <text
                                x={pos.x}
                                y={pos.y - (35 * targetMarkerScale)}
                                fill={colors.fill}
                                fontSize={12 * targetMarkerScale}
                                fontWeight="600"
                                textAnchor="middle"
                              >
                                T{target.id}
                              </text>
                            </g>
                          );
                        })}
                      </g>
                    );
                  }}
                />
                </div>
          {/* Floating Room Selector (top center) */}
          <div className="absolute top-6 left-1/2 z-40 hidden -translate-x-1/2 items-center gap-2 rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur px-4 py-2.5 text-sm text-slate-200 shadow-xl md:flex">
            <span className="text-slate-400 font-medium">Room:</span>
            <select
              className="rounded-lg border border-slate-700 bg-slate-800/70 px-3 py-1.5 text-slate-100 transition-colors focus:border-aqua-500 focus:ring-1 focus:ring-aqua-500/50 focus:outline-none font-medium"
              value={selectedRoomId ?? ''}
              onChange={(e) => {
                handleRoomSelection(e.target.value || null);
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
          <div className="absolute top-24 left-6 z-40 hidden rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur p-3 shadow-xl md:block">
            <div className="flex flex-col gap-2 text-sm">
              <button
                className="rounded-xl border border-aqua-600/50 bg-aqua-600/10 px-4 py-2.5 font-semibold text-aqua-100 shadow-lg transition-all hover:bg-aqua-600/20"
                onClick={() => setShowBasicShapes(true)}
                disabled={!selectedRoom}
              >
                ▭ Basic Shapes
              </button>
              <button
                className={`rounded-xl border px-4 py-2.5 font-semibold shadow-lg transition-all active:scale-95 ${
                  isDrawingWall
                    ? 'border-aqua-600/50 bg-aqua-600/20 text-aqua-100 hover:bg-aqua-600/30'
                    : 'border-slate-700/50 bg-slate-800/50 text-slate-200 hover:border-slate-600'
                }`}
                onClick={() => {
                  if (activeBasicShape) setActiveBasicShape(null);
                  setIsDrawingWall((prev) => activeBasicShape ? true : !prev);
                }}
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
              <div className="grid grid-cols-2 gap-2">
                <button
                  className="rounded-xl border border-amber-600/50 bg-amber-600/10 px-3 py-2.5 font-semibold text-amber-100 shadow-lg transition-all hover:bg-amber-600/20 disabled:opacity-40 active:scale-95"
                  onClick={handleUndo}
                  disabled={!canUndo}
                  title="Undo the last change (Ctrl/Cmd+Z)"
                >
                  ↶ Undo
                </button>
                <button
                  className="rounded-xl border border-amber-600/50 bg-amber-600/10 px-3 py-2.5 font-semibold text-amber-100 shadow-lg transition-all hover:bg-amber-600/20 disabled:opacity-40 active:scale-95"
                  onClick={handleRedo}
                  disabled={!canRedo}
                  title="Redo (Ctrl/Cmd+Shift+Z)"
                >
                  ↷ Redo
                </button>
              </div>
              {/*
                Rotate sits directly under Undo/Redo: it is the same kind of
                whole-plan action, and having Undo right above it is the point.
              */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  className="rounded-xl border border-sky-600/50 bg-sky-600/10 px-3 py-2.5 font-semibold text-sky-100 shadow-lg transition-all hover:bg-sky-600/20 disabled:opacity-40 active:scale-95"
                  onClick={() => rotateLayoutBy(-ROTATION_STEP_DEG)}
                  disabled={!canRotateLayout}
                  title={`Rotate the floor plan 90° anti-clockwise (Shift+R) — ${describeRotationScope(rotationScope)}`}
                >
                  ↺ 90°
                </button>
                <button
                  className="rounded-xl border border-sky-600/50 bg-sky-600/10 px-3 py-2.5 font-semibold text-sky-100 shadow-lg transition-all hover:bg-sky-600/20 disabled:opacity-40 active:scale-95"
                  onClick={() => rotateLayoutBy(ROTATION_STEP_DEG)}
                  disabled={!canRotateLayout}
                  title={`Rotate the floor plan 90° clockwise (R) — ${describeRotationScope(rotationScope)}`}
                >
                  ↻ 90°
                </button>
              </div>
              <button
                type="button"
                className="-mt-1 rounded-lg px-1 text-left text-[11px] font-medium text-slate-400 transition hover:text-sky-200"
                onClick={() => {
                  setSettingsTab('layout');
                  setShowSettings(true);
                }}
                title="Choose what a rotation moves"
              >
                Rotating: {describeRotationScope(rotationScope)} · change
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

            </div>
          </div>

          {/* Floating Zoom Controls (bottom right) */}
          <div className="absolute bottom-6 right-6 z-40 hidden flex-col gap-2 md:flex">
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
              onClick={() => handleAutoZoom(selectedRoom)}
            >
              Auto Zoom
            </button>
            <button
              className={`rounded-xl border backdrop-blur px-4 py-2.5 text-sm font-semibold shadow-lg transition-all hover:shadow-xl active:scale-95 ${
                showSettings
                  ? 'border-aqua-600/50 bg-aqua-600/20 text-aqua-100'
                  : 'border-slate-700/50 bg-slate-900/90 text-slate-100 hover:border-slate-600 hover:bg-slate-800'
              }`}
              onClick={() => setShowSettings((v) => !v)}
            >
              Settings
            </button>
          </div>

          {/* Settings Panel */}
          {showSettings && (
            <div className="absolute bottom-0 left-0 right-0 z-[80] max-h-[82dvh] overflow-y-auto rounded-t-2xl border-t border-slate-700 bg-slate-900/95 p-4 text-sm text-slate-100 shadow-2xl mobile-safe-bottom mobile-sheet-panel md:top-24 md:bottom-auto md:left-auto md:right-6 md:w-96 md:max-h-[calc(100vh-8rem)] md:max-w-full md:rounded-xl md:border md:border-slate-700/50 md:backdrop-blur md:animate-in md:slide-in-from-right-4 md:fade-in md:duration-200">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-100">Settings</span>
                        <button
                          className="rounded-md border border-slate-700 px-2 py-1 hover:border-aqua-500"
                          onClick={() => setShowSettings(false)}
                        >
                          Close
                        </button>
                      </div>

                      <div className="grid grid-cols-5 gap-1 rounded-lg border border-slate-700/60 bg-slate-950/50 p-1">
                        {[
                          ['display', 'Display'],
                          ['device', 'Device'],
                          ['layout', 'Layout'],
                          ['canvas', 'Canvas'],
                          ['floor', 'Floor'],
                        ].map(([tab, label]) => (
                          <button
                            key={tab}
                            type="button"
                            onClick={() => setSettingsTab(tab as RoomBuilderSettingsTab)}
                            className={`rounded-md px-2 py-1.5 text-xs font-semibold transition ${
                              settingsTab === tab
                                ? 'bg-aqua-600/20 text-aqua-100'
                                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>

                      {settingsTab === 'layout' && (
                      <div className="space-y-1">
                        <div className="font-semibold text-slate-200">Rotate floor plan</div>
                        <p className="text-[11px] leading-relaxed text-slate-400">
                          Turns the whole plan — walls, doors and furniture — in one undoable step.
                          Use this instead of redrawing a room that came out the wrong way round.
                        </p>

                        <div className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          What moves
                        </div>
                        <div className="space-y-1">
                          {([
                            {
                              scope: 'layout' as RotationScope,
                              detail: 'Turns the plan and the sensor together. Zones, targets and the heatmap stay exactly where they are on the walls — pick this to simply view the room the other way up.',
                            },
                            {
                              scope: 'roomOnly' as RotationScope,
                              detail: 'Leaves the sensor exactly where it is and swings the drawing around it. Pick this when the sensor reports targets at the wrong angle for the room you drew.',
                            },
                          ]).map(({ scope, detail }) => (
                            <button
                              key={scope}
                              type="button"
                              aria-pressed={rotationScope === scope}
                              onClick={() => setRotationScope(scope)}
                              className={`w-full rounded-md border px-2 py-1.5 text-left transition ${
                                rotationScope === scope
                                  ? 'border-aqua-500 bg-aqua-600/10 text-aqua-100'
                                  : 'border-slate-700 text-slate-200 hover:border-slate-600'
                              }`}
                            >
                              <div className="text-xs font-semibold">{describeRotationScope(scope)}</div>
                              <div className="text-[11px] leading-relaxed text-slate-400">{detail}</div>
                            </button>
                          ))}
                        </div>

                        <div className="pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Turn
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <button
                            type="button"
                            className="rounded-md border border-slate-700 px-2 py-1.5 text-[11px] font-semibold text-slate-100 transition hover:border-aqua-500 disabled:opacity-40"
                            onClick={() => rotateLayoutBy(-ROTATION_STEP_DEG)}
                            disabled={!canRotateLayout}
                            title="Shift+R"
                          >
                            ↺ 90°
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-slate-700 px-2 py-1.5 text-[11px] font-semibold text-slate-100 transition hover:border-aqua-500 disabled:opacity-40"
                            onClick={() => rotateLayoutBy(ROTATION_STEP_DEG)}
                            disabled={!canRotateLayout}
                            title="R"
                          >
                            ↻ 90°
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-slate-700 px-2 py-1.5 text-[11px] font-semibold text-slate-100 transition hover:border-aqua-500 disabled:opacity-40"
                            onClick={() => rotateLayoutBy(180)}
                            disabled={!canRotateLayout}
                            title="Turn the plan end to end"
                          >
                            ↻ 180°
                          </button>
                        </div>

                        <div className="flex items-center gap-2 pt-2">
                          <label className="flex items-center gap-2">
                            <span className="w-14 text-xs">Custom</span>
                            <input
                              type="number"
                              className="w-20 rounded-md border border-slate-700 bg-slate-800/70 px-2 py-1 text-slate-100 focus:border-aqua-500 focus:ring-1 focus:ring-aqua-500/50 focus:outline-none"
                              value={customRotationInput}
                              onChange={(e) => setCustomRotationInput(e.target.value)}
                              step={1}
                              min={-180}
                              max={180}
                            />
                            <span className="text-slate-400">deg</span>
                          </label>
                          <button
                            type="button"
                            className="ml-auto rounded-md border border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-100 transition hover:border-aqua-500 disabled:opacity-40"
                            onClick={() => {
                              const angle = Number(customRotationInput);
                              if (!Number.isFinite(angle) || normalizeSignedAngle(angle) === 0) return;
                              rotateLayoutBy(angle);
                            }}
                            disabled={
                              !canRotateLayout ||
                              // `Number('')` is 0, so a blank field would look applicable.
                              customRotationInput.trim() === '' ||
                              !Number.isFinite(Number(customRotationInput)) ||
                              normalizeSignedAngle(Number(customRotationInput)) === 0
                            }
                          >
                            Apply
                          </button>
                        </div>

                        {lockedObjectCount > 0 && (
                          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] leading-relaxed text-amber-200">
                            {lockedObjectCount} pinned {lockedObjectCount === 1 ? 'object' : 'objects'} will be
                            rotated. Press Undo (Ctrl/Cmd+Z) to revert changes.
                          </div>
                        )}
                        {!canRotateLayout && (
                          <div className="text-[11px] text-slate-400">Draw a wall outline first.</div>
                        )}
                      </div>
                      )}

                      {settingsTab === 'canvas' && (
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
                              {formatSnapPresetLabel(v, displayUnits)}
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
                      )}

                      {settingsTab === 'device' && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-semibold text-slate-200">Device placement</div>
                          <button
                            type="button"
                            aria-pressed={devicePositionLocked}
                            title={devicePositionLocked
                              ? 'Unlock the device position'
                              : 'Lock the device position. Rotation stays adjustable.'}
                            onClick={() => updateDevicePlacement({ locked: !devicePositionLocked })}
                            className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition ${
                              devicePositionLocked
                                ? 'border-amber-400/70 bg-amber-500/10 text-amber-100'
                                : 'border-slate-700 text-slate-200 hover:border-amber-400'
                            }`}
                          >
                            {devicePositionLocked ? '🔒 Position locked' : '🔓 Lock position'}
                          </button>
                        </div>
                        {devicePositionLocked && (
                          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200">
                            Position is locked — the device cannot be dragged on the canvas. Rotation,
                            mounting and coverage are still adjustable.
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-2">
                          <label className="flex items-center gap-2">
                            <span className="w-6">X</span>
                            <input
                              type="number"
                              disabled={devicePositionLocked}
                              className="w-full rounded-md border border-slate-700 bg-slate-800/70 px-2 py-1 text-slate-100 focus:border-aqua-500 focus:ring-1 focus:ring-aqua-500/50 focus:outline-none disabled:opacity-40"
                              value={selectedRoom?.devicePlacement?.x ?? 0}
                              onChange={(e) => {
                                updateDevicePlacement({ x: Number(e.target.value) || 0 });
                              }}
                            />
                          </label>
                          <label className="flex items-center gap-2">
                            <span className="w-6">Y</span>
                            <input
                              type="number"
                              disabled={devicePositionLocked}
                              className="w-full rounded-md border border-slate-700 bg-slate-800/70 px-2 py-1 text-slate-100 focus:border-aqua-500 focus:ring-1 focus:ring-aqua-500/50 focus:outline-none disabled:opacity-40"
                              value={selectedRoom?.devicePlacement?.y ?? 0}
                              onChange={(e) => {
                                updateDevicePlacement({ y: Number(e.target.value) || 0 });
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
                              updateDevicePlacement({ rotationDeg: Number(e.target.value) || 0 });
                            }}
                            onMouseUp={(e) => {
                              handleRotationSuggestion(Number((e.currentTarget as HTMLInputElement).value) || 0);
                            }}
                            onTouchEnd={(e) => {
                              handleRotationSuggestion(Number((e.currentTarget as HTMLInputElement).value) || 0);
                            }}
                            className="w-full"
                          />
                          <span>{selectedRoom?.devicePlacement?.rotationDeg ?? 0}</span>
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            className="rounded-md border border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-100 transition hover:border-aqua-500"
                            onClick={() => {
                              updateDevicePlacement({ x: 0, y: 0 });
                            }}
                            disabled={!selectedRoom || devicePositionLocked}
                            title={devicePositionLocked ? 'Unlock the device position first' : undefined}
                          >
                            Center
                          </button>
                          <button
                            className="rounded-md border border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-100 transition hover:border-aqua-500"
                            onClick={() => {
                              updateDevicePlacement({ rotationDeg: 0 });
                            }}
                            disabled={!selectedRoom}
                          >
                            Reset rot
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="flex items-center gap-2">
                            <span className="w-14">Mount</span>
                            <select
                              className="w-full rounded-md border border-slate-700 bg-slate-800/70 px-2 py-1 text-slate-100 focus:border-aqua-500 focus:ring-1 focus:ring-aqua-500/50 focus:outline-none"
                              value={selectedRoom?.devicePlacement?.mountType ?? 'wall'}
                              onChange={(e) => {
                                const value = e.target.value === 'ceiling' ? 'ceiling' : 'wall';
                                updateDevicePlacement(
                                  value === 'ceiling'
                                    ? { mountType: value, pitchDeg: 90, heightMm: 2400 }
                                    : { mountType: value }
                                );
                              }}
                            >
                              <option value="wall">Wall</option>
                              <option value="ceiling">Ceiling</option>
                            </select>
                          </label>
                          <label className="flex items-center gap-2">
                            <span className="w-14">Height</span>
                            <input
                              type="number"
                              min={0}
                              step={0.1}
                              className="w-full rounded-md border border-slate-700 bg-slate-800/70 px-2 py-1 text-slate-100 focus:border-aqua-500 focus:ring-1 focus:ring-aqua-500/50 focus:outline-none"
                              value={displayHeightMeters}
                              onChange={(e) => {
                                const raw = e.target.value;
                                if (raw === '') {
                                  updateDevicePlacement({ heightMm: undefined });
                                } else {
                                  updateDevicePlacement({ heightMm: Math.round((Number(raw) || 0) * 1000) });
                                }
                              }}
                              placeholder="m"
                            />
                            <span className="text-xs text-slate-400">m</span>
                          </label>
                        </div>
                        <label className="flex items-center gap-2">
                          <span className="w-14">Pitch</span>
                          <input
                            type="number"
                            min={0}
                            max={90}
                            className="w-full rounded-md border border-slate-700 bg-slate-800/70 px-2 py-1 text-slate-100 focus:border-aqua-500 focus:ring-1 focus:ring-aqua-500/50 focus:outline-none"
                            value={isCeilingMount ? 90 : (selectedRoom?.devicePlacement?.pitchDeg ?? '')}
                            disabled={isCeilingMount}
                            onChange={(e) => {
                              if (isCeilingMount) return;
                              const raw = e.target.value;
                              if (raw === '') {
                                updateDevicePlacement({ pitchDeg: undefined });
                              } else {
                                updateDevicePlacement({ pitchDeg: Number(raw) || 0 });
                              }
                            }}
                            placeholder="deg"
                          />
                          <span className="text-xs text-slate-400">
                            {isCeilingMount ? 'Locked to 90 degrees for ceiling mount' : '0 degrees = horizontal, 90 degrees = down'}
                          </span>
                        </label>
                        <div className="space-y-2">
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Overlay Sensor</div>
                          {coveragePresets ? (
                            <>
                              <label className="flex items-center gap-2">
                                <span className="w-14">Sensor</span>
                                <select
                                  className="w-full rounded-md border border-slate-700 bg-slate-800/70 px-2 py-1 text-slate-100 focus:border-aqua-500 focus:ring-1 focus:ring-aqua-500/50 focus:outline-none"
                                  value={coveragePresetId ?? 'default'}
                                  onChange={(e) => {
                                  const value = e.target.value;
                                  if (value === 'default') {
                                    updateDevicePlacement({
                                      coveragePresetId: undefined,
                                      horizontalFovDeg: undefined,
                                      verticalFovDeg: undefined,
                                    });
                                    return;
                                  }
                                  if (value === 'custom') {
                                    const defaultId = selectedProfile?.coverage?.defaultPresetId;
                                    const fallbackPreset = (defaultId && coveragePresets[defaultId]) ?
                                      coveragePresets[defaultId] :
                                      coveragePresets[Object.keys(coveragePresets)[0]];
                                    updateDevicePlacement({
                                      coveragePresetId: 'custom',
                                      horizontalFovDeg: selectedRoom?.devicePlacement?.horizontalFovDeg ?? fallbackPreset?.horizontalFovDeg ?? 120,
                                      verticalFovDeg: selectedRoom?.devicePlacement?.verticalFovDeg ?? fallbackPreset?.verticalFovDeg ?? 70,
                                    });
                                    return;
                                  }
                                  const preset = coveragePresets[value];
                                  if (preset) {
                                    updateDevicePlacement({
                                      coveragePresetId: value,
                                      horizontalFovDeg: preset.horizontalFovDeg,
                                      verticalFovDeg: preset.verticalFovDeg,
                                    });
                                  }
                                  }}
                                >
                                  <option value="default">
                                    Default {selectedProfile?.coverage?.defaultPresetId && coveragePresets[selectedProfile.coverage.defaultPresetId]
                                      ? `(${coveragePresets[selectedProfile.coverage.defaultPresetId].label})`
                                      : ''}
                                  </option>
                                  {Object.entries(coveragePresets).map(([id, preset]) => (
                                    <option key={id} value={id}>
                                      {preset.label} ({preset.horizontalFovDeg} deg x {preset.verticalFovDeg} deg)
                                    </option>
                                  ))}
                                  <option value="custom">Custom</option>
                                </select>
                              </label>
                              <div className="text-xs text-slate-400">
                                Changes the visual overlay only. Zone limits still follow the tracking sensor.
                              </div>
                            </>
                          ) : null}
                          {(!coveragePresets || coveragePresetId === 'custom') && (
                            <div className="grid grid-cols-2 gap-2">
                              <label className="flex items-center gap-2">
                                <span className="w-14">Horiz</span>
                                <input
                                  type="number"
                                  min={1}
                                  max={180}
                                  className="w-full rounded-md border border-slate-700 bg-slate-800/70 px-2 py-1 text-slate-100 focus:border-aqua-500 focus:ring-1 focus:ring-aqua-500/50 focus:outline-none"
                                  value={selectedRoom?.devicePlacement?.horizontalFovDeg ?? ''}
                                  onChange={(e) => {
                                    const raw = e.target.value;
                              if (raw === '') {
                                updateDevicePlacement({ coveragePresetId: 'custom', horizontalFovDeg: undefined });
                              } else {
                                updateDevicePlacement({ coveragePresetId: 'custom', horizontalFovDeg: Number(raw) || 0 });
                              }
                                  }}
                                  placeholder="deg"
                                />
                              </label>
                              <label className="flex items-center gap-2">
                                <span className="w-14">Vert</span>
                                <input
                                  type="number"
                                  min={1}
                                  max={180}
                                  className="w-full rounded-md border border-slate-700 bg-slate-800/70 px-2 py-1 text-slate-100 focus:border-aqua-500 focus:ring-1 focus:ring-aqua-500/50 focus:outline-none"
                                  value={selectedRoom?.devicePlacement?.verticalFovDeg ?? ''}
                                  onChange={(e) => {
                                    const raw = e.target.value;
                              if (raw === '') {
                                updateDevicePlacement({ coveragePresetId: 'custom', verticalFovDeg: undefined });
                              } else {
                                updateDevicePlacement({ coveragePresetId: 'custom', verticalFovDeg: Number(raw) || 0 });
                              }
                                  }}
                                  placeholder="deg"
                                />
                              </label>
                            </div>
                          )}
                        </div>
                      </div>
                      )}

                      {settingsTab === 'floor' && (
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
                              commitRoom(nextRoom);
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
                                commitRoom(nextRoom);
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
                      )}

                      {settingsTab === 'display' && (
                      <DisplaySettingsControls
                        overlayOptions={[
                          { label: 'Device coverage', checked: showDeviceRadar, onChange: setShowDeviceRadar },
                          { label: 'Clip radar to walls', checked: clipRadarToWalls, onChange: setClipRadarToWalls },
                        ]}
                        roomOptions={[
                          { label: 'Walls', checked: showWalls, onChange: setShowWalls },
                          { label: 'Furniture', checked: showFurniture, onChange: setShowFurniture },
                          { label: 'Doors', checked: showDoors, onChange: setShowDoors },
                          { label: 'Device icon', checked: showDeviceIcon, onChange: setShowDeviceIcon },
                          { label: 'Targets', checked: showTargets, onChange: setShowTargets, note: !liveState?.deviceId ? 'No device' : undefined },
                        ]}
                        appearance={{
                          targetMarkerScale,
                          setTargetMarkerScale,
                          showZoneLabels,
                          setShowZoneLabels,
                          zoneLabelScale,
                          setZoneLabelScale,
                        }}
                        extraSections={
                          <div className="space-y-2 border-t border-slate-700/70 pt-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Locking</div>
                              {lockedObjectCount > 0 && (
                                <span className="rounded-full border border-amber-400/50 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
                                  {lockedObjectCount} locked
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] leading-snug text-slate-500">
                              A locked object can still be clicked to open its panel, but nothing moves it.
                              Unlock it with the padlock in that panel.
                            </p>
                            <button
                              type="button"
                              disabled={shellPointCount === 0}
                              aria-pressed={allWallsLocked}
                              onClick={() => handleShellLockChange(!allWallsLocked)}
                              className={`w-full rounded-lg border px-3 py-2 text-left text-sm font-medium transition disabled:opacity-40 ${
                                allWallsLocked
                                  ? 'border-amber-400/70 bg-amber-500/10 text-amber-100'
                                  : 'border-slate-700 bg-slate-800/50 text-slate-200 hover:bg-slate-800/70'
                              }`}
                            >
                              {allWallsLocked ? '🔓 Unlock all walls' : '🔒 Lock all walls'}
                            </button>
                            <button
                              type="button"
                              disabled={!selectedRoom?.furniture?.length}
                              aria-pressed={allFurnitureLocked}
                              onClick={() => handleLockAllFurniture(!allFurnitureLocked)}
                              className={`w-full rounded-lg border px-3 py-2 text-left text-sm font-medium transition disabled:opacity-40 ${
                                allFurnitureLocked
                                  ? 'border-amber-400/70 bg-amber-500/10 text-amber-100'
                                  : 'border-slate-700 bg-slate-800/50 text-slate-200 hover:bg-slate-800/70'
                              }`}
                            >
                              {allFurnitureLocked ? '🔓 Unlock all furniture' : '🔒 Lock all furniture'}
                            </button>
                            <button
                              type="button"
                              disabled={!selectedRoom?.doors?.length}
                              aria-pressed={allDoorsLocked}
                              onClick={() => handleLockAllDoors(!allDoorsLocked)}
                              className={`w-full rounded-lg border px-3 py-2 text-left text-sm font-medium transition disabled:opacity-40 ${
                                allDoorsLocked
                                  ? 'border-amber-400/70 bg-amber-500/10 text-amber-100'
                                  : 'border-slate-700 bg-slate-800/50 text-slate-200 hover:bg-slate-800/70'
                              }`}
                            >
                              {allDoorsLocked ? '🔓 Unlock all doors' : '🔒 Lock all doors'}
                            </button>
                            <button
                              type="button"
                              aria-pressed={devicePositionLocked}
                              title="Locks where the device sits. Rotation stays adjustable."
                              onClick={() => updateDevicePlacement({ locked: !devicePositionLocked })}
                              className={`w-full rounded-lg border px-3 py-2 text-left text-sm font-medium transition disabled:opacity-40 ${
                                devicePositionLocked
                                  ? 'border-amber-400/70 bg-amber-500/10 text-amber-100'
                                  : 'border-slate-700 bg-slate-800/50 text-slate-200 hover:bg-slate-800/70'
                              }`}
                            >
                              {devicePositionLocked ? '🔓 Unlock device position' : '🔒 Lock device position'}
                              <span className="ml-1 text-[11px] text-slate-500">(rotation stays free)</span>
                            </button>
                          </div>
                        }
                      />
                      )}
                    </div>
                  )}

          {/* Floating Info Bar (bottom left) */}
          <div className="absolute bottom-6 left-6 z-40 hidden rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur px-4 py-3 shadow-xl max-w-xl md:block">
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
                    {formatSnapPresetLabel(v, displayUnits)}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-slate-400 font-medium">Wall Snap Angle:</span>
                <button
                  className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition-all active:scale-95 ${
                    angleSnapEnabled
                      ? 'border-aqua-500 bg-aqua-500/20 text-aqua-100 shadow-lg shadow-aqua-500/20'
                      : 'border-slate-700 bg-slate-800/50 text-slate-200 hover:border-slate-600'
                  }`}
                  onClick={() => setAngleSnapEnabled(true)}
                >
                  45 deg
                </button>
                <button
                  className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition-all active:scale-95 ${
                    !angleSnapEnabled
                      ? 'border-aqua-500 bg-aqua-500/20 text-aqua-100 shadow-lg shadow-aqua-500/20'
                      : 'border-slate-700 bg-slate-800/50 text-slate-200 hover:border-slate-600'
                  }`}
                  onClick={() => setAngleSnapEnabled(false)}
                >
                  Free
                </button>
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
                Tips: Click a wall to edit it, Shift+Click a wall to split it, A to draw, Enter to finish, Esc to cancel, Ctrl/Cmd+Z to undo (Shift to redo), Del to remove the point just drawn or the selected wall point
              </div>
            </div>
          </div>
                {selectedSegment !== null && (() => {
                  const pts = selectedRoom.roomShell?.points ?? [];
                  const a = pts[selectedSegment];
                  const b = pts[(selectedSegment + 1) % pts.length];
                  if (!a || !b) return null;

                  const selectedLengthMm = Math.hypot(b.x - a.x, b.y - a.y);
                  const selectedLengthLabel = formatLengthLabel(selectedLengthMm, displayUnits);
                  const lengthUnit = displayUnits === 'imperial' ? 'ft' : 'm';
                  const nudgeStepMeters = displayUnits === 'imperial' ? 0.1 * 0.3048 : 0.05;
                  const nudgeLabel = displayUnits === 'imperial' ? '0.10 ft' : '0.05 m';
                  const offsetStepMeters = 0.1;
                  const offsetLabel =
                    displayUnits === 'imperial'
                      ? `${(offsetStepMeters * 3.28084).toFixed(2)} ft`
                      : `${offsetStepMeters.toFixed(2)} m`;

                  return (
                    <>
                      <div
                        className="absolute z-[90] hidden md:block"
                        style={{
                          left: segmentEditorPosition?.left ?? WALL_EDITOR_MARGIN,
                          top: segmentEditorPosition?.top ?? WALL_EDITOR_MARGIN,
                          width: WALL_EDITOR_WIDTH,
                        }}
                      >
                        <div className={`rounded-xl border border-slate-800 bg-slate-900/95 shadow-2xl backdrop-blur ${wallEditorDragging ? 'select-none' : ''}`}>
                        <div className="flex items-center justify-between border-b border-slate-700 px-3 py-2">
                          <div>
                            <h2 className="text-sm font-semibold text-white">Wall</h2>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              className={`rounded-md p-1 transition-colors ${selectedSegmentLocked ? 'text-amber-400 hover:text-amber-300' : 'text-slate-500 hover:text-amber-300'}`}
                              aria-label={selectedSegmentLocked ? 'Unlock this wall' : 'Lock this wall'}
                              aria-pressed={selectedSegmentLocked}
                              title={selectedSegmentLocked ? 'Unlock this wall' : 'Lock this wall so it cannot be selected or moved'}
                              onClick={() => handleSegmentLockToggle(selectedSegment)}
                            >
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d={selectedSegmentLocked
                                    ? 'M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75M6.75 10.5h10.5a2.25 2.25 0 012.25 2.25v6a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 18.75v-6a2.25 2.25 0 012.25-2.25z'
                                    : 'M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 10.5h10.5a2.25 2.25 0 012.25 2.25v6a2.25 2.25 0 01-2.25 2.25H3.75A2.25 2.25 0 011.5 18.75v-6a2.25 2.25 0 012.25-2.25z'}
                                />
                              </svg>
                            </button>
                            <button
                              type="button"
                              className={`rounded-md p-1 text-slate-500 transition-colors hover:text-slate-200 ${wallEditorDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                              aria-label="Move wall editor"
                              title="Move"
                              onPointerDown={handleWallEditorDragPointerDown}
                              onPointerMove={handleWallEditorDragPointerMove}
                              onPointerUp={handleWallEditorDragPointerUp}
                              onPointerCancel={handleWallEditorDragPointerUp}
                            >
                              <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                                <circle cx="5" cy="4" r="1.1" />
                                <circle cx="8" cy="4" r="1.1" />
                                <circle cx="11" cy="4" r="1.1" />
                                <circle cx="5" cy="8" r="1.1" />
                                <circle cx="8" cy="8" r="1.1" />
                                <circle cx="11" cy="8" r="1.1" />
                              </svg>
                            </button>
                            <button
                              onClick={() => {
                                setSelectedSegment(null);
                                setHoveredSegment(null);
                              }}
                              className="text-slate-400 transition-colors hover:text-white"
                              aria-label="Close"
                            >
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        </div>
                        {selectedSegmentLocked && (
                          <div className="border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                            <span className="font-semibold">Locked.</span> This wall is pinned, so it cannot be
                            moved, split or deleted. Use the padlock above to unlock it first.
                          </div>
                        )}
                        <div
                          className={`space-y-3 px-3 py-3 ${selectedSegmentLocked ? 'pointer-events-none opacity-50' : ''}`}
                          aria-disabled={selectedSegmentLocked || undefined}
                          onWheelCapture={(e) => e.stopPropagation()}
                        >
                          <div>
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <label className="block text-[11px] font-semibold text-slate-300">Length ({lengthUnit})</label>
                              {displayUnits === 'imperial' && (
                                <span className="text-[11px] text-slate-400">{selectedLengthLabel}</span>
                              )}
                            </div>
                            <div className="flex gap-2">
                              {displayUnits === 'imperial' ? (
                                <>
                                  <div className="min-w-0 flex-1">
                                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">ft</label>
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      className="w-full rounded-lg border border-slate-700 bg-slate-800/70 px-2.5 py-2 text-sm text-white focus:border-aqua-500 focus:outline-none"
                                      value={wallLengthFeetInput}
                                      onChange={(e) => setWallLengthFeetInput(e.target.value)}
                                      onBlur={() => commitSelectedSegmentImperialLength(wallLengthFeetInput, wallLengthInchesInput)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          e.currentTarget.blur();
                                        }
                                      }}
                                    />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">in</label>
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      className="w-full rounded-lg border border-slate-700 bg-slate-800/70 px-2.5 py-2 text-sm text-white focus:border-aqua-500 focus:outline-none"
                                      value={wallLengthInchesInput}
                                      onChange={(e) => setWallLengthInchesInput(e.target.value)}
                                      onBlur={() => commitSelectedSegmentImperialLength(wallLengthFeetInput, wallLengthInchesInput)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          e.currentTarget.blur();
                                        }
                                      }}
                                    />
                                  </div>
                                </>
                              ) : (
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-800/70 px-2.5 py-2 text-sm text-white focus:border-aqua-500 focus:outline-none"
                                  value={wallLengthInput}
                                  onChange={(e) => setWallLengthInput(e.target.value)}
                                  onBlur={(e) => commitSelectedSegmentLength(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.currentTarget.blur();
                                    }
                                  }}
                                />
                              )}
                              <button
                                className="rounded-lg border border-slate-700 px-2.5 py-2 text-[11px] font-semibold text-slate-100 transition hover:border-aqua-400"
                                onClick={() => nudgeSegmentLength(-nudgeStepMeters)}
                              >
                                -{nudgeLabel}
                              </button>
                              <button
                                className="rounded-lg border border-slate-700 px-2.5 py-2 text-[11px] font-semibold text-slate-100 transition hover:border-aqua-400"
                                onClick={() => nudgeSegmentLength(nudgeStepMeters)}
                              >
                                +{nudgeLabel}
                              </button>
                            </div>
                          </div>
                          <div>
                            <div className="mb-1 text-[11px] font-semibold text-slate-300">Offset</div>
                            <div className="grid grid-cols-2 gap-2">
                              <button
                                className="rounded-lg border border-slate-700 px-2.5 py-2 text-[11px] font-semibold text-slate-100 transition hover:border-amber-400"
                                onClick={() => offsetSegmentNormal(-offsetStepMeters)}
                              >
                                -{offsetLabel}
                              </button>
                              <button
                                className="rounded-lg border border-slate-700 px-2.5 py-2 text-[11px] font-semibold text-slate-100 transition hover:border-amber-400"
                                onClick={() => offsetSegmentNormal(offsetStepMeters)}
                              >
                                +{offsetLabel}
                              </button>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              className="rounded-lg border border-emerald-500/70 px-2.5 py-2 text-[11px] font-semibold text-emerald-100 transition hover:bg-emerald-500/10"
                              onClick={() => insertPointOnSegment(selectedSegment)}
                            >
                              Split wall
                            </button>
                            <button
                              className="rounded-lg border border-rose-500/70 px-2.5 py-2 text-[11px] font-semibold text-rose-100 transition hover:bg-rose-500/10"
                              onClick={deleteSelectedWallPoint}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                        {/* Outside the body above, so it stays usable while this wall is locked. */}
                        <div className="border-t border-slate-800 px-3 py-2">
                          <button
                            className={`w-full rounded-lg border px-2.5 py-2 text-[11px] font-semibold transition ${
                              wholeRoomLocked
                                ? 'border-amber-400 bg-amber-500/10 text-amber-100'
                                : 'border-slate-700 text-slate-100 hover:border-amber-400'
                            }`}
                            aria-pressed={wholeRoomLocked}
                            onClick={() => handleShellLockChange(!wholeRoomLocked)}
                          >
                            {wholeRoomLocked ? '🔓 Unlock whole room' : '🔒 Lock whole room'}
                          </button>
                        </div>
                      </div>
                      </div>

                      <div className="absolute bottom-0 left-0 right-0 z-[80] max-h-[82dvh] overflow-y-auto rounded-t-2xl border-t border-slate-700 bg-slate-900/95 p-4 text-sm text-slate-100 shadow-2xl mobile-safe-bottom md:hidden">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-semibold text-slate-100">Wall</div>
                            <div className="text-xs text-slate-400">
                              {selectedSegmentLocked
                                ? 'Locked — unlock it below before editing.'
                                : 'Edit the selected wall segment.'}
                            </div>
                          </div>
                          <button
                            className="rounded-md border border-slate-700 px-2 py-1 hover:border-aqua-500"
                            onClick={() => {
                              setSelectedSegment(null);
                              setHoveredSegment(null);
                            }}
                          >
                            Close
                          </button>
                        </div>
                        <div className="mt-4 space-y-2">
                          <button
                            className={`w-full rounded-lg border px-3 py-2 text-sm font-semibold ${
                              selectedSegmentLocked ? 'border-amber-400 bg-amber-500/10 text-amber-100' : 'border-slate-700 text-slate-100'
                            }`}
                            aria-pressed={selectedSegmentLocked}
                            onClick={() => handleSegmentLockToggle(selectedSegment)}
                          >
                            {selectedSegmentLocked ? '🔓 Unlock this wall' : '🔒 Lock this wall'}
                          </button>
                          <button
                            className={`w-full rounded-lg border px-3 py-2 text-sm font-semibold ${
                              wholeRoomLocked ? 'border-amber-400 bg-amber-500/10 text-amber-100' : 'border-slate-700 text-slate-100'
                            }`}
                            aria-pressed={wholeRoomLocked}
                            onClick={() => handleShellLockChange(!wholeRoomLocked)}
                          >
                            {wholeRoomLocked ? '🔓 Unlock whole room' : '🔒 Lock whole room'}
                          </button>
                        </div>
                        <div
                          className={`mt-4 space-y-4 ${selectedSegmentLocked ? 'pointer-events-none opacity-50' : ''}`}
                          aria-disabled={selectedSegmentLocked || undefined}
                        >
                          <div>
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <label className="block text-sm font-semibold text-slate-300">Length ({lengthUnit})</label>
                              {displayUnits === 'imperial' && (
                                <span className="text-xs text-slate-400">{selectedLengthLabel}</span>
                              )}
                            </div>
                            {displayUnits === 'imperial' ? (
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="mb-1 block text-[11px] font-semibold text-slate-500">Feet</label>
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    className="w-full rounded-lg border border-slate-700 bg-slate-800/70 px-3 py-2 text-white focus:border-aqua-500 focus:outline-none"
                                    value={wallLengthFeetInput}
                                    onChange={(e) => setWallLengthFeetInput(e.target.value)}
                                    onBlur={() => commitSelectedSegmentImperialLength(wallLengthFeetInput, wallLengthInchesInput)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.currentTarget.blur();
                                      }
                                    }}
                                  />
                                </div>
                                <div>
                                  <label className="mb-1 block text-[11px] font-semibold text-slate-500">Inches</label>
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    className="w-full rounded-lg border border-slate-700 bg-slate-800/70 px-3 py-2 text-white focus:border-aqua-500 focus:outline-none"
                                    value={wallLengthInchesInput}
                                    onChange={(e) => setWallLengthInchesInput(e.target.value)}
                                    onBlur={() => commitSelectedSegmentImperialLength(wallLengthFeetInput, wallLengthInchesInput)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.currentTarget.blur();
                                      }
                                    }}
                                  />
                                </div>
                              </div>
                            ) : (
                              <input
                                type="text"
                                inputMode="decimal"
                                className="w-full rounded-lg border border-slate-700 bg-slate-800/70 px-3 py-2 text-white focus:border-aqua-500 focus:outline-none"
                                value={wallLengthInput}
                                onChange={(e) => setWallLengthInput(e.target.value)}
                                onBlur={(e) => commitSelectedSegmentLength(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.currentTarget.blur();
                                  }
                                }}
                              />
                            )}
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-100"
                              onClick={() => nudgeSegmentLength(-nudgeStepMeters)}
                            >
                              -{nudgeLabel}
                            </button>
                            <button
                              className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-100"
                              onClick={() => nudgeSegmentLength(nudgeStepMeters)}
                            >
                              +{nudgeLabel}
                            </button>
                            <button
                              className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-100"
                              onClick={() => offsetSegmentNormal(-offsetStepMeters)}
                            >
                              -{offsetLabel}
                            </button>
                            <button
                              className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-100"
                              onClick={() => offsetSegmentNormal(offsetStepMeters)}
                            >
                              +{offsetLabel}
                            </button>
                          </div>
                          <button
                            className="w-full rounded-lg border border-emerald-500/70 px-3 py-2 text-sm font-semibold text-emerald-100"
                            onClick={() => insertPointOnSegment(selectedSegment)}
                          >
                            Split wall
                          </button>
                          <button
                            className="w-full rounded-lg border border-rose-500/70 px-3 py-2 text-sm font-semibold text-rose-100"
                            onClick={deleteSelectedWallPoint}
                          >
                            Delete wall point
                          </button>
                        </div>
                      </div>
                    </>
                  );
                })()}

          {/* Furniture Editor Panel */}
          {selectedFurniture && (
            <div className="hidden md:block">
              <FurnitureEditor
                furniture={selectedFurniture}
                onChange={handleFurnitureChange}
                onDelete={handleFurnitureDelete}
                onClose={() => setSelectedFurnitureId(null)}
                onToggleLock={() => handleFurnitureLockToggle(selectedFurniture.id)}
              />
            </div>
          )}

          {/* Door Editor Panel */}
          {selectedDoor && (
            <DoorEditor
              door={selectedDoor}
              onChange={handleDoorChange}
              onDelete={handleDoorDelete}
              onClose={() => setSelectedDoorId(null)}
              onToggleLock={() => handleDoorLockToggle(selectedDoor.id)}
              maxSegmentIndex={(selectedRoom?.roomShell?.points?.length ?? 1) - 1}
              validation={doorValidation}
            />
          )}

          <div className="md:hidden">
            <CanvasBottomToolbar>
              <CanvasToolbarButton
                label="Tools"
                active={activeMobileSheet === 'tools'}
                onClick={toggleMobileToolsSheet}
              />
              <CanvasToolbarButton
                label="Settings"
                active={showSettings}
                onClick={toggleMobileSettingsSheet}
              />
              <CanvasToolbarButton
                label="Zoom"
                active={activeMobileSheet === 'zoom'}
                onClick={toggleMobileZoomSheet}
              />
              <CanvasToolbarButton
                label="Furniture"
                active={showFurnitureLibrary}
                onClick={() => {
                  setActiveMobileSheet(null);
                  setShowSettings(false);
                  setShowFurnitureLibrary((current) => !current);
                  setSelectedFurnitureId(null);
                }}
              />
            </CanvasBottomToolbar>
          </div>
        </div>
      )}

      <CanvasMobileSheet
        open={activeMobileSheet === 'navigation'}
        title="Menu"
        onClose={() => setActiveMobileSheet(null)}
      >
        <div className="space-y-2">
          {onNavigate && (
            <>
              <button
                type="button"
                onClick={() => {
                  setActiveMobileSheet(null);
                  navigateTo('liveDashboard');
                }}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-left text-sm font-semibold text-slate-100"
              >
                Live Dashboard
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveMobileSheet(null);
                  navigateTo('wizard');
                }}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-left text-sm font-semibold text-slate-100"
              >
                Add Device
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveMobileSheet(null);
                  navigateTo('zoneEditor');
                }}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-left text-sm font-semibold text-slate-100"
              >
                Zone Editor
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveMobileSheet(null);
                  navigateTo('settings');
                }}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-left text-sm font-semibold text-slate-100"
              >
                Settings
              </button>
            </>
          )}
        </div>
      </CanvasMobileSheet>

      <CanvasMobileSheet
        open={activeMobileSheet === 'tools'}
        title="Tools"
        description={selectedRoom?.name}
        onClose={() => setActiveMobileSheet(null)}
      >
        <div className="grid grid-cols-2 gap-2 text-sm">
          <button
            type="button"
            className="col-span-2 rounded-lg border border-aqua-600/60 bg-aqua-600/20 px-3 py-3 font-semibold text-aqua-100 disabled:opacity-40"
            onClick={() => setShowBasicShapes(true)}
            disabled={!selectedRoom}
          >
            Basic Shapes
          </button>
          <button
            type="button"
            className={`rounded-lg border px-3 py-3 font-semibold ${
              isDrawingWall
                ? 'border-aqua-500 bg-aqua-500/20 text-aqua-100'
                : 'border-slate-700 bg-slate-800 text-slate-100'
            }`}
            onClick={() => {
              if (activeBasicShape) setActiveBasicShape(null);
              setIsDrawingWall((prev) => activeBasicShape ? true : !prev);
            }}
          >
            {isDrawingWall ? 'Stop Drawing' : 'Add Wall'}
          </button>
          <button
            type="button"
            className="rounded-lg border border-emerald-600/60 bg-emerald-600/20 px-3 py-3 font-semibold text-emerald-100 disabled:opacity-40"
            onClick={handleCloseLoop}
            disabled={!selectedRoom || (selectedRoom.roomShell?.points?.length ?? 0) < 2}
          >
            Finish
          </button>
          <button
            type="button"
            className="rounded-lg border border-amber-600/60 bg-amber-600/20 px-3 py-3 font-semibold text-amber-100 disabled:opacity-40"
            onClick={handleUndo}
            disabled={!canUndo}
          >
            Undo
          </button>
          <button
            type="button"
            className="rounded-lg border border-amber-600/60 bg-amber-600/20 px-3 py-3 font-semibold text-amber-100 disabled:opacity-40"
            onClick={handleRedo}
            disabled={!canRedo}
          >
            Redo
          </button>
          <button
            type="button"
            className="rounded-lg border border-sky-600/60 bg-sky-600/20 px-3 py-3 font-semibold text-sky-100 disabled:opacity-40"
            onClick={() => rotateLayoutBy(-ROTATION_STEP_DEG)}
            disabled={!canRotateLayout}
          >
            ↺ Rotate 90°
          </button>
          <button
            type="button"
            className="rounded-lg border border-sky-600/60 bg-sky-600/20 px-3 py-3 font-semibold text-sky-100 disabled:opacity-40"
            onClick={() => rotateLayoutBy(ROTATION_STEP_DEG)}
            disabled={!canRotateLayout}
          >
            ↻ Rotate 90°
          </button>
          <button
            type="button"
            className="col-span-2 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-left text-xs font-medium text-slate-300"
            onClick={() => {
              setActiveMobileSheet(null);
              setSettingsTab('layout');
              setShowSettings(true);
            }}
          >
            Rotating: <span className="font-semibold text-sky-200">{describeRotationScope(rotationScope)}</span> · change
          </button>
          <button
            type="button"
            className="rounded-lg border border-rose-600/60 bg-rose-600/20 px-3 py-3 font-semibold text-rose-100 disabled:opacity-40"
            onClick={handleClear}
            disabled={!selectedRoom}
          >
            Clear
          </button>
          <button
            type="button"
            className={`rounded-lg border px-3 py-3 font-semibold ${
              isDoorPlacementMode
                ? 'border-aqua-500 bg-aqua-500/20 text-aqua-100'
                : 'border-slate-700 bg-slate-800 text-slate-100'
            } disabled:opacity-40`}
            onClick={handleAddDoor}
            disabled={!selectedRoom || !selectedRoom.roomShell?.points || selectedRoom.roomShell.points.length < 3}
          >
            {isDoorPlacementMode ? 'Cancel Door' : 'Add Door'}
          </button>
          <button
            type="button"
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-3 font-semibold text-slate-100"
            onClick={() => {
              setActiveMobileSheet(null);
              setShowFurnitureLibrary(true);
              setSelectedFurnitureId(null);
            }}
            disabled={!selectedRoom}
          >
            Furniture
          </button>
        </div>
        {selectedFurniture && (
          <div className="mt-4 space-y-3 rounded-lg border border-purple-600/40 bg-purple-600/10 p-3 text-sm text-slate-200">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-white">Selected furniture</div>
                <div className="text-xs text-slate-400">{selectedFurniture.typeId}</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-pressed={!!selectedFurniture.locked}
                  className={`rounded-md border px-3 py-2 text-xs font-semibold ${
                    selectedFurniture.locked
                      ? 'border-amber-400/70 bg-amber-500/10 text-amber-100'
                      : 'border-slate-700 text-slate-100'
                  }`}
                  onClick={() => handleFurnitureLockToggle(selectedFurniture.id)}
                >
                  {selectedFurniture.locked ? '🔓 Unlock' : '🔒 Lock'}
                </button>
                <button
                  type="button"
                  className="rounded-md border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-100"
                  onClick={() => setSelectedFurnitureId(null)}
                >
                  Deselect
                </button>
              </div>
            </div>
            {selectedFurniture.locked && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                <span className="font-semibold">Locked.</span> Unlock it above before moving or resizing it.
              </div>
            )}
            <div
              className={`space-y-3 ${selectedFurniture.locked ? 'pointer-events-none opacity-50' : ''}`}
              aria-disabled={selectedFurniture.locked || undefined}
            >
            <label className="block">
              <span className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-400">
                <span>Rotation</span>
                <span className="font-mono text-aqua-300">{Math.round(selectedFurniture.rotationDeg ?? 0)} deg</span>
              </span>
              <input
                type="range"
                min="0"
                max="359"
                value={selectedFurniture.rotationDeg ?? 0}
                onChange={(e) => handleFurnitureChange({ ...selectedFurniture, rotationDeg: Number(e.target.value) })}
                className="w-full"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs font-semibold text-slate-400">
                Width (m)
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={(selectedFurniture.width / 1000).toFixed(2)}
                  onChange={(e) => {
                    const width = Number(e.target.value) * 1000;
                    if (Number.isFinite(width) && width > 0) {
                      handleFurnitureChange({ ...selectedFurniture, width });
                    }
                  }}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-slate-100"
                />
              </label>
              <label className="block text-xs font-semibold text-slate-400">
                Depth (m)
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={(selectedFurniture.depth / 1000).toFixed(2)}
                  onChange={(e) => {
                    const depth = Number(e.target.value) * 1000;
                    if (Number.isFinite(depth) && depth > 0) {
                      handleFurnitureChange({ ...selectedFurniture, depth });
                    }
                  }}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-slate-100"
                />
              </label>
            </div>
            <button
              type="button"
              className="w-full rounded-lg border border-rose-600/60 bg-rose-600/20 px-3 py-3 font-semibold text-rose-100"
              onClick={handleFurnitureDelete}
            >
              Delete Furniture
            </button>
            </div>
          </div>
        )}
      </CanvasMobileSheet>

      <CanvasMobileSheet
        open={activeMobileSheet === 'zoom'}
        title="Zoom & Snap"
        onClose={() => setActiveMobileSheet(null)}
      >
        <div className="space-y-4 text-sm text-slate-200">
          <div className="grid grid-cols-2 gap-2">
            <button className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 font-semibold" onClick={() => setZoom((z) => Math.min(5, z + 0.1))}>Zoom In</button>
            <button className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 font-semibold" onClick={() => setZoom((z) => Math.max(0.1, z - 0.1))}>Zoom Out</button>
            <button className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 font-semibold" onClick={() => setZoom(1)}>Reset</button>
            <button className="rounded-lg border border-aqua-600/60 bg-aqua-600/20 px-4 py-3 font-semibold text-aqua-100" onClick={() => handleAutoZoom(selectedRoom)}>Auto Fit</button>
          </div>
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Snap Grid</div>
            <div className="grid grid-cols-4 gap-2">
              {[0, 50, 100, 200].map((value) => (
                <button
                  key={value}
                  onClick={() => setSnapGridMm(value)}
                  className={`rounded-lg border px-2 py-2 text-xs font-semibold ${
                    snapGridMm === value
                      ? 'border-aqua-500 bg-aqua-500/20 text-aqua-100'
                      : 'border-slate-700 bg-slate-800 text-slate-200'
                  }`}
                >
                  {value === 0 ? 'Off' : `${value}mm`}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              className={`rounded-lg border px-3 py-2 text-xs font-semibold ${
                angleSnapEnabled ? 'border-aqua-500 bg-aqua-500/20 text-aqua-100' : 'border-slate-700 bg-slate-800 text-slate-200'
              }`}
              onClick={() => setAngleSnapEnabled(true)}
            >
              45 deg
            </button>
            <button
              className={`rounded-lg border px-3 py-2 text-xs font-semibold ${
                !angleSnapEnabled ? 'border-aqua-500 bg-aqua-500/20 text-aqua-100' : 'border-slate-700 bg-slate-800 text-slate-200'
              }`}
              onClick={() => setAngleSnapEnabled(false)}
            >
              Free angle
            </button>
          </div>
          <div className="rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2 text-xs text-slate-400">
            Cursor: X {cursorPos ? (cursorPos.x / (displayUnits === 'imperial' ? 304.8 : 1000)).toFixed(2) : '--'} {displayUnits === 'imperial' ? 'ft' : 'm'}, Y {cursorPos ? (cursorPos.y / (displayUnits === 'imperial' ? 304.8 : 1000)).toFixed(2) : '--'} {displayUnits === 'imperial' ? 'ft' : 'm'}
          </div>
        </div>
      </CanvasMobileSheet>

      {/* Furniture Library Modal - outside canvas wrapper to prevent scroll interference */}
      {showFurnitureLibrary && (
        <FurnitureLibrary
          onSelect={handleAddFurniture}
          onClose={() => setShowFurnitureLibrary(false)}
        />
      )}
    </div>
  );
};
