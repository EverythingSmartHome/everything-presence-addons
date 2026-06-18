import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import {
  fetchDevices,
  fetchProfiles,
  fetchZoneAvailability,
  fetchZoneBackups,
  ingressAware,
  restoreZoneBackup,
} from '../api/client';
import { fetchRooms, updateRoom } from '../api/rooms';
import { ZoneCanvas } from '../components/ZoneCanvas';
import {
  pushZonesToDevice,
  fetchZonesFromDevice,
  fetchPolygonModeStatus,
  setPolygonMode,
  fetchPolygonZonesFromDevice,
  pushPolygonZonesToDevice,
  PolygonModeStatus,
} from '../api/zones';
import { validateZones } from '../api/validate';
import { getZoneLabels, saveZoneLabels } from '../api/deviceMappings';
import {
  DiscoveredDevice,
  DeviceProfile,
  RoomConfig,
  ZoneRect,
  ZonePolygon,
  LiveState,
  ZoneAvailability,
  ZoneBackup,
} from '../api/types';
import {
  CanvasBottomToolbar,
  CanvasMobileSheet,
  CanvasToolbarButton,
  CanvasTopBar,
} from '../components/CanvasLayout';
import { DisplaySettingsControls } from '../components/DisplaySettingsControls';
import { useDisplaySettings } from '../hooks/useDisplaySettings';
import { useIsMobileCanvas } from '../hooks/useMediaQuery';
import { useDeviceMapping, useDeviceMappings } from '../contexts/DeviceMappingsContext';
import { getDeviceIconUrl } from '../utils/deviceIcon';
import { resolveCoverageFov, resolveTrackingCoverageFov } from '../utils/coverage';
import { usesPolygonOnlyZones } from '../utils/firmware';
import { resolveEntityPrefix } from '../utils/entityUtils';
import {
  buildCeilingExclusionZones,
  buildCeilingSliceZones,
  CeilingSliceConfig,
  getCeilingSliceBands,
  getCeilingSliceLineDepth,
  getCeilingSlicePosition,
  normalizeCeilingSliceConfig,
} from '../utils/ceilingSlices';

interface ZoneEditorPageProps {
  onBack?: () => void;
  onNavigate?: (view: 'wizard' | 'zoneEditor' | 'roomBuilder' | 'settings' | 'liveDashboard') => void;
  initialRoomId?: string | null;
  initialProfileId?: string | null;
  onWizardZonesReady?: () => void;
  liveState?: LiveState | null;
  targetPositions?: Array<{
    id: number;
    x: number;
    y: number;
    distance: number | null;
    speed: number | null;
    angle: number | null;
  }>;
  onRoomChange?: (roomId: string | null, profileId: string | null) => void;
}

type MobileZoneSheet = 'navigation' | 'zoom' | null;

export const ZoneEditorPage: React.FC<ZoneEditorPageProps> = ({
  onBack,
  onNavigate,
  initialRoomId,
  initialProfileId,
  onWizardZonesReady,
  liveState: propLiveState,
  targetPositions: propTargetPositions = [],
  onRoomChange,
}) => {
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [profiles, setProfiles] = useState<DeviceProfile[]>([]);
  const [rooms, setRooms] = useState<RoomConfig[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [rangeMm, setRangeMm] = useState(15000);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [snapGridMm, setSnapGridMm] = useState(100);
  const [zoom, setZoom] = useState(1.1);
  const [panOffsetMm, setPanOffsetMm] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [showZoneList, setShowZoneList] = useState(false);
  const [zoneAvailability, setZoneAvailability] = useState<ZoneAvailability>({});
  const [polygonAvailability, setPolygonAvailability] = useState<ZoneAvailability>({});
  const [polygonZonesAvailable, setPolygonZonesAvailable] = useState<boolean | null>(null);
  const [entryZonesAvailable, setEntryZonesAvailable] = useState<boolean | null>(null);
  const [isDraggingZone, setIsDraggingZone] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showNavMenu, setShowNavMenu] = useState(false);
  const [activeMobileSheet, setActiveMobileSheet] = useState<MobileZoneSheet>(null);
  // Polygon mode state
  const [polygonModeStatus, setPolygonModeStatus] = useState<PolygonModeStatus>({
    supported: false,
    enabled: false,
    controllable: false,
  });
  const [polygonZones, setPolygonZones] = useState<ZonePolygon[]>([]);
  const [togglingPolygonMode, setTogglingPolygonMode] = useState(false);
  const [showModeChangeConfirm, setShowModeChangeConfirm] = useState(false);
  const [recoveringPolygonZones, setRecoveringPolygonZones] = useState(false);
  const [latestZoneBackup, setLatestZoneBackup] = useState<ZoneBackup | null>(null);
  const [loadingLatestZoneBackup, setLoadingLatestZoneBackup] = useState(false);
  // Zone labels from device mapping (stored separately from zone coordinates)
  const [deviceZoneLabels, setDeviceZoneLabels] = useState<Record<string, string>>({});
  const [roomLiveState, setRoomLiveState] = useState<LiveState | null>(null);
  // Display settings (persisted to localStorage)
  const {
    showWalls, setShowWalls,
    showFurniture, setShowFurniture,
    showDoors, setShowDoors,
    showZones, setShowZones,
    showDeviceIcon, setShowDeviceIcon,
    showDeviceRadar, setShowDeviceRadar,
    showTargets, setShowTargets,
    targetMarkerScale, setTargetMarkerScale,
    showZoneLabels, setShowZoneLabels,
    zoneLabelScale, setZoneLabelScale,
    clipRadarToWalls, setClipRadarToWalls,
  } = useDisplaySettings();
  const isMobileCanvas = useIsMobileCanvas();
  const loadedRoomRef = useRef<string | null>(null);
  const previousRoomIdRef = useRef<string | null>(null);
  const pendingCeilingSliceConfigRef = useRef<CeilingSliceConfig | null>(null);
  const ceilingSliceSaveSeqRef = useRef(0);

  const selectedRoom = useMemo(
    () => (selectedRoomId ? rooms.find((r) => r.id === selectedRoomId) ?? null : null),
    [rooms, selectedRoomId],
  );

  const selectedProfile = useMemo(
    () => profiles.find((p) => p.id === (selectedRoom?.profileId ?? selectedProfileId)) ?? null,
    [profiles, selectedRoom?.profileId, selectedProfileId],
  );

  // Get the selected device for firmware version checking
  const selectedDevice = useMemo(
    () => selectedRoom?.deviceId ? devices.find((d) => d.id === selectedRoom.deviceId) ?? null : null,
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
  const trackingCoverageFov = useMemo(
    () => resolveTrackingCoverageFov(selectedProfile),
    [selectedProfile],
  );
  const polygonOnlyZones = useMemo(() => (
    usesPolygonOnlyZones(
      selectedDevice?.firmwareVersion ?? null,
      selectedDevice?.model ?? selectedProfile?.label ?? null,
    ) === true
  ), [selectedDevice?.firmwareVersion, selectedDevice?.model, selectedProfile?.label]);
  const effectiveCoverageMaxRangeMeters = coverageFov?.maxRangeMeters ?? selectedProfile?.limits?.maxRangeMeters;
  const trackingMaxRangeMeters = trackingCoverageFov?.maxRangeMeters ?? selectedProfile?.limits?.maxRangeMeters;
  const trackingFieldOfViewDeg = trackingCoverageFov?.horizontalFovDeg ?? selectedProfile?.limits?.fieldOfViewDegrees;
  const trackingMaxRangeMm = (trackingMaxRangeMeters ?? 6) * 1000;
  const isCeilingSliceMode =
    selectedProfile?.id === 'everything_presence_pro' &&
    selectedRoom?.devicePlacement?.mountType === 'ceiling';
  const heightCoverageConfig = useMemo(() => {
    if (!selectedRoom?.devicePlacement || !isCeilingSliceMode) return null;
    if (!coverageFov) return null;
    const heightMm = selectedRoom.devicePlacement.heightMm;
    const pitchDeg = Number.isFinite(selectedRoom.devicePlacement.pitchDeg)
      ? Number(selectedRoom.devicePlacement.pitchDeg)
      : 90;
    if (!Number.isFinite(heightMm) || !Number.isFinite(pitchDeg)) return null;
    return {
      enabled: true,
      heightMm: Number(heightMm),
      pitchDeg,
      horizontalFovDeg: coverageFov.horizontalFovDeg,
      verticalFovDeg: coverageFov.verticalFovDeg,
      maxRangeMeters: coverageFov.maxRangeMeters,
    };
  }, [coverageFov, selectedRoom?.devicePlacement, isCeilingSliceMode]);
  const ceilingSliceConfig = useMemo(
    () => normalizeCeilingSliceConfig(selectedRoom?.metadata?.ceilingSliceConfig, trackingMaxRangeMm, true),
    [selectedRoom?.metadata?.ceilingSliceConfig, trackingMaxRangeMm],
  );
  const ceilingSliceDisplayZones = useMemo(
    () => buildCeilingSliceZones(
      ceilingSliceConfig,
      deviceZoneLabels,
      'display',
      true,
      heightCoverageConfig,
      trackingMaxRangeMm,
    ),
    [ceilingSliceConfig, deviceZoneLabels, heightCoverageConfig, trackingMaxRangeMm],
  );
  const ceilingExclusionDisplayZones = useMemo(
    () => buildCeilingExclusionZones(
      ceilingSliceConfig,
      deviceZoneLabels,
      'display',
      true,
      heightCoverageConfig,
      trackingMaxRangeMm,
    ),
    [ceilingSliceConfig, deviceZoneLabels, heightCoverageConfig, trackingMaxRangeMm],
  );
  const ceilingSliceDeviceZones = useMemo(
    () => buildCeilingSliceZones(ceilingSliceConfig, deviceZoneLabels, 'device'),
    [ceilingSliceConfig, deviceZoneLabels],
  );
  const ceilingExclusionDeviceZones = useMemo(
    () => buildCeilingExclusionZones(ceilingSliceConfig, deviceZoneLabels, 'device'),
    [ceilingSliceConfig, deviceZoneLabels],
  );
  const activePolygonZones = isCeilingSliceMode ? [...ceilingSliceDisplayZones, ...ceilingExclusionDisplayZones] : polygonZones;
  const savedRectangularZones = useMemo(
    () => (selectedRoom?.zones ?? []).filter((zone) => zone.enabled !== false),
    [selectedRoom?.zones],
  );
  const hasSavedRectangularRecovery = savedRectangularZones.length > 0;
  const hasBackupRecovery = latestZoneBackup !== null;

  // Device mappings context - used to check if device has valid entity mappings
  const { hasValidMappings, clearCache, getMapping } = useDeviceMappings();
  const { mapping: selectedDeviceMapping } = useDeviceMapping(selectedRoom?.deviceId);
  const deviceHasValidMappings = selectedRoom?.deviceId ? hasValidMappings(selectedRoom.deviceId) : false;
  const hasPropLiveStateForRoom = Boolean(
    propLiveState && selectedRoom?.deviceId && propLiveState.deviceId === selectedRoom.deviceId
  );
  const liveState = hasPropLiveStateForRoom ? propLiveState : roomLiveState;
  const installationAngle =
    typeof liveState?.config?.installationAngle === 'number' ? liveState.config.installationAngle : 0;

  // Generate all possible zone slots based on profile limits
  const allPossibleZones = useMemo(() => {
    if (!selectedProfile) return [];
    const limits = selectedProfile.limits;
    const zones: ZoneRect[] = [];

    // Regular zones
    for (let i = 1; i <= (limits.maxZones ?? 4); i++) {
      zones.push({
        id: `Zone ${i}`,
        type: 'regular',
        x: 0,
        y: 0,
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
        x: 0,
        y: 0,
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
        x: 0,
        y: 0,
        width: 1000,
        height: 1000,
        enabled: false,
      });
    }

    return zones;
  }, [selectedProfile]);

  // Merge device zones with all possible zones, applying labels from device mapping
  const displayZones = useMemo(() => {
    if (!selectedRoom) return allPossibleZones;

    const deviceZones = polygonOnlyZones ? [] : selectedRoom.zones ?? [];

    // Create new objects to avoid mutating allPossibleZones
    return allPossibleZones.map(slot => {
      const deviceZone = deviceZones.find(z => z.id === slot.id && z.type === slot.type);
      if (deviceZone) {
        // Apply label from device mapping (stored separately from coordinates)
        const label = deviceZoneLabels[slot.id] ?? deviceZone.label;
        return { ...slot, ...deviceZone, label, enabled: true };
      }
      // Return a fresh copy with enabled: false to ensure clean state
      return { ...slot, enabled: false };
    });
  }, [selectedRoom, allPossibleZones, deviceZoneLabels, polygonOnlyZones]);

  // Only enabled zones should show on canvas
  const enabledZones = useMemo(() => {
    return displayZones.filter(z => z.enabled);
  }, [displayZones]);

  // Helper to convert zone ID (e.g., "Zone 1") to availability key (e.g., "zone1")
  const getAvailabilityKey = (zoneId: string, zoneType: string): string => {
    const match = zoneId.match(/(\d+)/);
    const num = match ? match[1] : '1';
    if (zoneType === 'regular') return `zone${num}`;
    if (zoneType === 'exclusion') return `exclusion${num}`;
    if (zoneType === 'entry') return `entry${num}`;
    return zoneId.toLowerCase().replace(/\s+/g, '');
  };

  // Check if a zone slot is available (not disabled in HA)
  const isZoneAvailable = (zone: ZoneRect): boolean => {
    const key = getAvailabilityKey(zone.id, zone.type);
    const availability = zoneAvailability[key];
    // If no availability info, assume available
    if (!availability) return true;
    if (availability.status === 'disabled' || availability.status === 'unavailable') return false;
    return true;
  };

  useEffect(() => {
    if (hasPropLiveStateForRoom) {
      setRoomLiveState(propLiveState);
    }
  }, [hasPropLiveStateForRoom, propLiveState]);

  useEffect(() => {
    if (!selectedRoom?.deviceId || !selectedRoom.profileId) {
      setRoomLiveState(null);
      return;
    }

    if (hasPropLiveStateForRoom) {
      return;
    }

    let cancelled = false;

    const loadLiveState = async () => {
      try {
        const entityParam = selectedRoom.entityNamePrefix
          ? `&entityNamePrefix=${encodeURIComponent(selectedRoom.entityNamePrefix)}`
          : '';
        const mappingsParam = selectedRoom.entityMappings
          ? `&entityMappings=${encodeURIComponent(JSON.stringify(selectedRoom.entityMappings))}`
          : '';
        const res = await fetch(
          ingressAware(
            `api/live/${selectedRoom.deviceId}/state?profileId=${selectedRoom.profileId}${entityParam}${mappingsParam}`
          )
        );
        if (!res.ok) {
          throw new Error('Failed to load live state');
        }
        const data = await res.json() as { state?: LiveState };
        if (!cancelled) {
          setRoomLiveState(data.state ?? null);
        }
      } catch {
        if (!cancelled) {
          setRoomLiveState(null);
        }
      }
    };

    loadLiveState();

    return () => {
      cancelled = true;
    };
  }, [
    hasPropLiveStateForRoom,
    selectedRoom?.deviceId,
    selectedRoom?.entityMappings,
    selectedRoom?.entityNamePrefix,
    selectedRoom?.profileId,
  ]);

  const getZoneStatus = (zone: ZoneRect): 'enabled' | 'disabled' | 'unavailable' | 'unknown' => {
    const key = getAvailabilityKey(zone.id, zone.type);
    const availability = zoneAvailability[key];
    return availability?.status ?? 'unknown';
  };

  const getPolygonStatus = (zoneId: string): 'enabled' | 'disabled' | 'unavailable' | 'unknown' => {
    const availability = polygonAvailability[zoneId];
    return availability?.status ?? 'unknown';
  };

  const polygonModeControllable = polygonModeStatus.controllable !== false;

  useEffect(() => {
    if (!warning) return;
    const timer = setTimeout(() => setWarning(null), 6000);
    return () => clearTimeout(timer);
  }, [warning]);

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
          setSelectedZoneId(initialRoom.zones?.[0]?.id ?? null);
          if (initialRoom.profileId) setSelectedProfileId(initialRoom.profileId);
        }

        if (!initialRoom && !selectedRoomId && roomRes.rooms.length > 0) {
          setSelectedRoomId(roomRes.rooms[0].id);
          setSelectedZoneId(roomRes.rooms[0].zones?.[0]?.id ?? null);
        }

        if (!initialRoom?.profileId && !selectedProfileId && profileRes.profiles.length > 0) {
          setSelectedProfileId(initialProfileId ?? profileRes.profiles[0].id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      }
    };
    load();
    // Note: selectedRoomId and selectedProfileId intentionally excluded - this is initialization only.
  }, [initialProfileId, initialRoomId]);

  useEffect(() => {
    // Only run when room ID actually changes (not on every render)
    if (selectedRoom?.id !== previousRoomIdRef.current) {
      previousRoomIdRef.current = selectedRoom?.id ?? null;

      // Auto-select first zone when switching rooms
      if (selectedRoom && selectedRoom.zones?.length) {
        setSelectedZoneId(selectedRoom.zones[0].id);
      } else {
        setSelectedZoneId(null);
      }

      // Reset pan offset when room changes
      setPanOffsetMm({ x: 0, y: 0 });
    }
  }, [selectedRoom?.id]);

  // Load zone labels from device mapping when device changes
  useEffect(() => {
    const loadDeviceZoneLabels = async () => {
      if (!selectedRoom?.deviceId) {
        setDeviceZoneLabels({});
        return;
      }

      try {
        const labels = await getZoneLabels(selectedRoom.deviceId);
        setDeviceZoneLabels(labels);
      } catch (err) {
        // Silently fail - labels are optional
        setDeviceZoneLabels({});
      }
    };

    loadDeviceZoneLabels();
  }, [selectedRoom?.deviceId]);

  // Fetch existing zones from device when room is loaded
  useEffect(() => {
    const loadZonesFromDevice = async () => {
      if (!selectedRoom || !selectedRoom.deviceId || !selectedRoom.profileId) {
        return;
      }

      // Skip if we've already loaded zones for this room
      if (loadedRoomRef.current === selectedRoom.id) {
        return;
      }

      loadedRoomRef.current = selectedRoom.id;

      const entityNamePrefix = resolveEntityPrefix({
        entityMappings: selectedRoom.entityMappings,
        entityNamePrefix: selectedRoom.entityNamePrefix,
        mappingPrefix: selectedDeviceMapping?.esphomeNodeName,
        devicePrefix: selectedDevice?.entityNamePrefix,
      });

      if (!entityNamePrefix) {
        return;
      }

      try {
        if (polygonOnlyZones) {
          return;
        }
        // Skip entityMappings if device has valid mappings stored (device mapping is source of truth)
        const entityMappingsToUse = deviceHasValidMappings ? undefined : selectedRoom.entityMappings;
        const deviceZones = await fetchZonesFromDevice(
          selectedRoom.deviceId,
          selectedRoom.profileId,
          entityNamePrefix,
          entityMappingsToUse
        );

        // Device zones contain coordinates only - labels are stored separately in device mapping
        // No need to merge labels here, they're loaded from device mapping via getZoneLabels

        // Always sync device zones to local storage (device is source of truth for coordinates)
        const updatedRoom = { ...selectedRoom, zones: deviceZones };

        // Update local state
        setRooms((prev) => prev.map((r) =>
          r.id === selectedRoom.id ? updatedRoom : r
        ));

        // Persist to add-on storage to keep it in sync with device (coordinates only, labels in device mapping)
        await updateRoom(selectedRoom.id, { zones: deviceZones });

        // Only set selection if no zone is currently selected
        if (deviceZones.length > 0 && !selectedZoneId) {
          setSelectedZoneId(deviceZones[0].id);
        }
      } catch (err) {
        // Silently fail - it's okay if device has no zones configured
      }
    };

    loadZonesFromDevice();
  }, [selectedRoom?.id, selectedRoom?.deviceId, selectedRoom?.profileId, selectedRoom?.entityNamePrefix, selectedRoom?.entityMappings, devices, deviceHasValidMappings, polygonOnlyZones]);

  // Fetch zone availability from entity registry
  useEffect(() => {
    const loadZoneAvailability = async () => {
      if (!selectedRoom?.deviceId || !selectedRoom?.profileId) {
        setZoneAvailability({});
        setPolygonZonesAvailable(null);
        setEntryZonesAvailable(null);
        return;
      }

      const entityNamePrefix = resolveEntityPrefix({
        entityMappings: selectedRoom.entityMappings,
        entityNamePrefix: selectedRoom.entityNamePrefix,
        mappingPrefix: selectedDeviceMapping?.esphomeNodeName,
        devicePrefix: selectedDevice?.entityNamePrefix,
      });

      if (!entityNamePrefix) {
        setZoneAvailability({});
        setPolygonZonesAvailable(null);
        setEntryZonesAvailable(null);
        return;
      }

      try {
        // Skip entityMappings if device has valid mappings stored
        const entityMappingsToUse = deviceHasValidMappings ? undefined : selectedRoom.entityMappings;
        const response = await fetchZoneAvailability(
          selectedRoom.deviceId,
          selectedRoom.profileId,
          entityNamePrefix,
          entityMappingsToUse
        );
        setZoneAvailability(response.availability);
        setPolygonAvailability(response.polygonAvailability ?? {});
        setPolygonZonesAvailable(response.polygonZonesAvailable);
        setEntryZonesAvailable(response.entryZonesAvailable);
      } catch (err) {
        // Silently fail - availability info is optional
        setZoneAvailability({});
        setPolygonAvailability({});
        setPolygonZonesAvailable(null);
        setEntryZonesAvailable(null);
      }
    };

    loadZoneAvailability();
  }, [selectedRoom?.id, selectedRoom?.deviceId, selectedRoom?.profileId, selectedRoom?.entityNamePrefix, selectedRoom?.entityMappings, devices, deviceHasValidMappings]);

  // Fetch polygon mode status when room changes
  useEffect(() => {
    const loadPolygonModeStatus = async () => {
      if (!selectedRoom?.deviceId || !selectedRoom?.profileId) {
        setPolygonModeStatus({ supported: false, enabled: false, controllable: false });
        return;
      }

      const entityNamePrefix = resolveEntityPrefix({
        entityMappings: selectedRoom.entityMappings,
        entityNamePrefix: selectedRoom.entityNamePrefix,
        mappingPrefix: selectedDeviceMapping?.esphomeNodeName,
        devicePrefix: selectedDevice?.entityNamePrefix,
      });

      if (!entityNamePrefix) {
        setPolygonModeStatus({ supported: false, enabled: false, controllable: false });
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
        // Polygon-only firmware has no rectangle mode: never let a stale mode toggle
        // (e.g. a ghost switch entity left behind by the firmware update) push the
        // editor into rectangle mode, where all zone slots are hidden.
        if (polygonOnlyZones && (!status.enabled || !status.supported)) {
          setPolygonModeStatus({ supported: true, enabled: true, controllable: false });
        } else {
          setPolygonModeStatus(status);
        }
      } catch (err) {
        if (polygonOnlyZones) {
          setPolygonModeStatus({ supported: true, enabled: true, controllable: false });
        } else {
          setPolygonModeStatus({ supported: false, enabled: false, controllable: false });
        }
      }
    };

    loadPolygonModeStatus();
  }, [selectedRoom?.id, selectedRoom?.deviceId, selectedRoom?.profileId, selectedRoom?.entityNamePrefix, selectedRoom?.entityMappings, devices, deviceHasValidMappings, polygonOnlyZones]);

  // Fetch polygon zones when polygon mode is enabled
  useEffect(() => {
    const loadPolygonZones = async () => {
      if (!polygonModeStatus.enabled || !selectedRoom?.deviceId || !selectedRoom?.profileId) {
        setPolygonZones([]);
        return;
      }

      const entityNamePrefix = resolveEntityPrefix({
        entityMappings: selectedRoom.entityMappings,
        entityNamePrefix: selectedRoom.entityNamePrefix,
        mappingPrefix: selectedDeviceMapping?.esphomeNodeName,
        devicePrefix: selectedDevice?.entityNamePrefix,
      });

      if (!entityNamePrefix) {
        setPolygonZones([]);
        return;
      }

      try {
        // Skip entityMappings if device has valid mappings stored
        const entityMappingsToUse = deviceHasValidMappings ? undefined : selectedRoom.entityMappings;
        const zones = await fetchPolygonZonesFromDevice(
          selectedRoom.deviceId,
          selectedRoom.profileId,
          entityNamePrefix,
          entityMappingsToUse
        );
        setPolygonZones(zones);
      } catch (err) {
        setPolygonZones([]);
      }
    };

    loadPolygonZones();
  }, [polygonModeStatus.enabled, selectedRoom?.id, selectedRoom?.deviceId, selectedRoom?.profileId, selectedRoom?.entityNamePrefix, selectedRoom?.entityMappings, devices, deviceHasValidMappings]);

  // Transform device-relative coordinates to room coordinates (keeping for reference, but not used since we get props)
  const deviceToRoom = (deviceX: number, deviceY: number) => {
    if (!selectedRoom?.devicePlacement) {
      return { x: deviceX, y: deviceY };
    }

    const { x, y, rotationDeg } = selectedRoom.devicePlacement;
    // Use device rotation as-is (device coordinates have 0° = right)
    const angleRad = ((rotationDeg ?? 0) * Math.PI) / 180;
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);

    // Rotate around origin
    const rotatedX = deviceX * cos - deviceY * sin;
    const rotatedY = deviceX * sin + deviceY * cos;

    // Translate by device position
    return {
      x: rotatedX + x,
      y: rotatedY + y,
    };
  };

  // Use target positions from props
  const targetPositions = propTargetPositions;

  const handleZonesChange = (nextZones: ZoneRect[]) => {
    if (!selectedRoom) return;
    setRooms((prev) => prev.map((r) => (r.id === selectedRoom.id ? { ...r, zones: nextZones } : r)));
    if (nextZones.length && !selectedZoneId) {
      setSelectedZoneId(nextZones[0].id);
    }

    // Update local label state for immediate UI feedback (persisted on save)
    const newLabels: Record<string, string> = {};
    for (const zone of nextZones) {
      if (zone.label) {
        newLabels[zone.id] = zone.label;
      }
    }
    setDeviceZoneLabels(newLabels);
  };

  const handlePolygonZonesChange = (nextZones: ZonePolygon[]) => {
    if (isCeilingSliceMode) {
      const getPolygonLateralRange = (zone: ZonePolygon) => {
        const values = zone.vertices
          .map((vertex) => ceilingSliceConfig.axis === 'x' ? vertex.x : vertex.y)
          .filter((value) => Number.isFinite(value));
        if (!values.length) return null;
        const min = Math.min(...values);
        const max = Math.max(...values);
        return { min: Math.min(min, max - 100), max: Math.max(max, min + 100) };
      };

      const existingRanges = getCeilingSliceBands(ceilingSliceConfig)
        .slice(0, ceilingSliceConfig.sliceCount)
        .map((band) => ({ min: band.min, max: band.max }));
      const lateralRangesMm = [...existingRanges];

      for (const zone of nextZones.filter((zone) => zone.type === 'regular')) {
        const index = Number(zone.id.match(/\d+/)?.[0] ?? '0') - 1;
        const range = getPolygonLateralRange(zone);
        if (index >= 0 && index < lateralRangesMm.length && range) {
          lateralRangesMm[index] = range;
        }
      }

      const existingExclusions = ceilingSliceConfig.exclusionRangesMm ?? [];
      const exclusionRangesMm = [...existingExclusions];
      for (const zone of nextZones.filter((zone) => zone.type === 'exclusion')) {
        const index = Number(zone.id.match(/\d+/)?.[0] ?? '0') - 1;
        const range = getPolygonLateralRange(zone);
        if (index >= 0 && range) {
          exclusionRangesMm[index] = range;
        }
      }

      updateCeilingSliceConfig({
        lateralMinMm: Math.min(...lateralRangesMm.map((range) => range.min)),
        lateralMaxMm: Math.max(...lateralRangesMm.map((range) => range.max)),
        lateralBreakpointsMm: undefined,
        lateralRangesMm,
        exclusionRangesMm: exclusionRangesMm.slice(0, selectedProfile?.limits.maxExclusionZones ?? 2),
      }, { persist: false });
      return;
    }
    setPolygonZones(nextZones);
    if (nextZones.length && !selectedZoneId) {
      setSelectedZoneId(nextZones[0].id);
    }
  };

  const resolveZoneRestoreContext = useCallback(async () => {
    if (!selectedRoom?.deviceId) return null;

    const mapping = await getMapping(selectedRoom.deviceId);
    const profileId = selectedRoom.profileId || mapping?.profileId || null;
    const entityNamePrefix = resolveEntityPrefix({
      entityMappings: selectedRoom.entityMappings,
      entityNamePrefix: selectedRoom.entityNamePrefix,
      mappingPrefix: mapping?.esphomeNodeName,
      devicePrefix: selectedDevice?.entityNamePrefix,
    });

    if (!profileId) {
      setError('Device profile not found. Run entity discovery to sync the device.');
      return null;
    }

    if (!entityNamePrefix && !mapping) {
      setError('Entity name prefix is missing. Link the device to a room or re-sync entities.');
      return null;
    }

    return {
      deviceId: selectedRoom.deviceId,
      profileId,
      entityNamePrefix,
      entityMappings: deviceHasValidMappings ? undefined : selectedRoom.entityMappings,
    };
  }, [
    deviceHasValidMappings,
    devices,
    getMapping,
    selectedRoom?.deviceId,
    selectedRoom?.entityMappings,
    selectedRoom?.entityNamePrefix,
    selectedRoom?.profileId,
  ]);

  const handleRecoverPolygonZones = useCallback(async () => {
    const context = await resolveZoneRestoreContext();
    if (!context) {
      return;
    }

    if (savedRectangularZones.length === 0) {
      setError('No saved rectangular zones are available to recover');
      return;
    }

    setRecoveringPolygonZones(true);
    setError(null);

    try {
      const convertedZones: ZonePolygon[] = savedRectangularZones.map((zone) => ({
        id: zone.id,
        type: zone.type,
        vertices: [
          { x: zone.x, y: zone.y },
          { x: zone.x + zone.width, y: zone.y },
          { x: zone.x + zone.width, y: zone.y + zone.height },
          { x: zone.x, y: zone.y + zone.height },
        ],
        enabled: zone.enabled,
        label: deviceZoneLabels[zone.id] ?? zone.label,
      }));

      const result = await pushPolygonZonesToDevice(
        context.deviceId,
        context.profileId,
        convertedZones,
        context.entityNamePrefix ?? undefined,
        context.entityMappings,
      );

      if (!result.ok) {
        const sample = result.warnings?.[0];
        throw new Error(sample ? `Recovery partially failed: ${sample.error}` : 'Failed to recover polygon zones');
      }

      setPolygonZones(convertedZones);
      setPolygonModeStatus((current) => ({ ...current, supported: true, enabled: true }));
      setWarning(`Recovered ${convertedZones.length} polygon zone${convertedZones.length === 1 ? '' : 's'} from saved rectangular data.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to recover polygon zones');
    } finally {
      setRecoveringPolygonZones(false);
    }
  }, [deviceZoneLabels, resolveZoneRestoreContext, savedRectangularZones]);

  const handleRestoreLatestZoneBackup = useCallback(async () => {
    if (!latestZoneBackup) {
      setError('No zone backup is available to restore');
      return;
    }

    const context = await resolveZoneRestoreContext();
    if (!context) {
      return;
    }

    setRecoveringPolygonZones(true);
    setError(null);

    try {
      const result = await restoreZoneBackup(latestZoneBackup.id, {
        deviceId: context.deviceId,
        profileId: context.profileId,
        entityNamePrefix: context.entityNamePrefix ?? undefined,
        entityMappings: context.entityMappings,
      });

      if (!result.ok) {
        throw new Error('Restore completed with errors. Check warnings and try again.');
      }

      const restoredZones = await fetchPolygonZonesFromDevice(
        context.deviceId,
        context.profileId,
        context.entityNamePrefix ?? undefined,
        context.entityMappings,
      );
      setPolygonZones(restoredZones);
      setPolygonModeStatus((current) => ({ ...current, supported: true, enabled: true }));
      clearCache(context.deviceId);
      const labels = await getZoneLabels(context.deviceId);
      setDeviceZoneLabels(labels);

      if (result.warnings && result.warnings.length > 0) {
        setWarning(`Restored latest backup with ${result.warnings.length} warning(s).`);
      } else {
        setWarning('Restored latest backup as polygon zones.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore latest zone backup');
    } finally {
      setRecoveringPolygonZones(false);
    }
  }, [clearCache, latestZoneBackup, resolveZoneRestoreContext]);

  useEffect(() => {
    const shouldCheckBackups =
      Boolean(selectedRoom?.deviceId) &&
      polygonOnlyZones &&
      polygonModeStatus.enabled &&
      polygonZones.length === 0;

    if (!shouldCheckBackups || !selectedRoom?.deviceId) {
      setLatestZoneBackup(null);
      setLoadingLatestZoneBackup(false);
      return;
    }

    let cancelled = false;
    setLoadingLatestZoneBackup(true);

    void fetchZoneBackups(selectedRoom.deviceId)
      .then(({ backups }) => {
        if (cancelled) return;
        const latest = [...(backups ?? [])]
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] ?? null;
        setLatestZoneBackup(latest);
      })
      .catch(() => {
        if (!cancelled) {
          setLatestZoneBackup(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingLatestZoneBackup(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [polygonModeStatus.enabled, polygonOnlyZones, polygonZones.length, selectedRoom?.deviceId]);

  const persistCeilingSliceConfig = useCallback(async (config: CeilingSliceConfig | null = pendingCeilingSliceConfigRef.current) => {
    if (!selectedRoom || !config) return;
    pendingCeilingSliceConfigRef.current = null;
    const saveSeq = ++ceilingSliceSaveSeqRef.current;
    const metadata = {
      ...(selectedRoom.metadata ?? {}),
      ceilingSliceConfig: config,
    };

    try {
      const result = await updateRoom(selectedRoom.id, { metadata });
      if (saveSeq === ceilingSliceSaveSeqRef.current) {
        setRooms((prev) => prev.map((room) => (room.id === selectedRoom.id ? result.room : room)));
      }
    } catch (err) {
      pendingCeilingSliceConfigRef.current = config;
      setError(err instanceof Error ? err.message : 'Failed to update ceiling slice settings');
    }
  }, [selectedRoom]);

  const updateCeilingSliceConfig = (
    updates: Partial<CeilingSliceConfig>,
    options: { persist?: boolean } = {},
  ) => {
    if (!selectedRoom) return;
    const nextConfig = normalizeCeilingSliceConfig(
      { ...ceilingSliceConfig, ...updates },
      trackingMaxRangeMm,
      true,
    );
    const nextRoom: RoomConfig = {
      ...selectedRoom,
      metadata: {
        ...(selectedRoom.metadata ?? {}),
        ceilingSliceConfig: nextConfig,
      },
    };
    setRooms((prev) => prev.map((room) => (room.id === selectedRoom.id ? nextRoom : room)));
    if (options.persist === false) {
      pendingCeilingSliceConfigRef.current = nextConfig;
    } else {
      void persistCeilingSliceConfig(nextConfig);
    }
  };

  const handleZoneCanvasDragStateChange = (dragging: boolean) => {
    setIsDraggingZone(dragging);
    if (!dragging && isCeilingSliceMode) {
      void persistCeilingSliceConfig();
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
    const remainingZones = displayZones.filter(z => z.enabled && z.id !== slotId);
    handleZonesChange(remainingZones);
    if (selectedZoneId === slotId) {
      setSelectedZoneId(remainingZones[0]?.id ?? null);
    }
  };

  const handleTogglePolygonMode = async () => {
    if (!selectedRoom?.deviceId || !selectedRoom?.profileId) return;

    const entityNamePrefix = resolveEntityPrefix({
      entityMappings: selectedRoom.entityMappings,
      entityNamePrefix: selectedRoom.entityNamePrefix,
      mappingPrefix: selectedDeviceMapping?.esphomeNodeName,
      devicePrefix: selectedDevice?.entityNamePrefix,
    });

    if (!entityNamePrefix) return;

    setTogglingPolygonMode(true);
    try {
      // Skip entityMappings if device has valid mappings stored
      const entityMappingsToUse = deviceHasValidMappings ? undefined : selectedRoom.entityMappings;
      const newEnabled = !polygonModeStatus.enabled;
      await setPolygonMode(
        selectedRoom.deviceId,
        selectedRoom.profileId,
        entityNamePrefix,
        newEnabled,
        entityMappingsToUse
      );
      setPolygonModeStatus({ ...polygonModeStatus, enabled: newEnabled });

      // Clear zones state when switching modes
      if (newEnabled) {
        // Switching to polygon mode - fetch polygon zones
        const zones = await fetchPolygonZonesFromDevice(
          selectedRoom.deviceId,
          selectedRoom.profileId,
          entityNamePrefix,
          entityMappingsToUse
        );
        setPolygonZones(zones);
      } else {
        // Switching to rectangle mode - clear polygon zones
        setPolygonZones([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle polygon mode');
    } finally {
      setTogglingPolygonMode(false);
    }
  };

  /**
   * Check if any zones are outside the device's max detection range.
   * Returns an array of zone labels that are out of range.
   */
  const getOutOfRangeZones = useCallback((
    rectZones: ZoneRect[],
    polyZones: ZonePolygon[],
    maxRangeMm: number,
    isPolygonMode: boolean
  ): string[] => {
    const outOfRange: string[] = [];

    if (isPolygonMode) {
      // Check polygon zones
      polyZones.forEach((zone, idx) => {
        const isOutOfRange = zone.vertices.some(v => {
          const distance = Math.sqrt(v.x * v.x + v.y * v.y);
          return distance > maxRangeMm;
        });
        if (isOutOfRange) {
          const typeLabel = zone.type === 'regular' ? 'Zone' : zone.type === 'exclusion' ? 'Exclusion' : 'Entry';
          outOfRange.push(`${typeLabel} ${idx + 1}`);
        }
      });
    } else {
      // Check rectangle zones
      rectZones.forEach((zone, idx) => {
        // Check all four corners of the rectangle
        const corners = [
          { x: zone.x, y: zone.y },
          { x: zone.x + zone.width, y: zone.y },
          { x: zone.x, y: zone.y + zone.height },
          { x: zone.x + zone.width, y: zone.y + zone.height },
        ];
        const isOutOfRange = corners.some(c => {
          const distance = Math.sqrt(c.x * c.x + c.y * c.y);
          return distance > maxRangeMm;
        });
        if (isOutOfRange) {
          const typeLabel = zone.type === 'regular' ? 'Zone' : zone.type === 'exclusion' ? 'Exclusion' : 'Entry';
          const zoneNum = rectZones.filter(z => z.type === zone.type).indexOf(zone) + 1;
          outOfRange.push(`${typeLabel} ${zoneNum}`);
        }
      });
    }

    return outOfRange;
  }, []);

  const handleSaveZones = async () => {
    if (!selectedRoom) return;
    if (isCeilingSliceMode && !polygonModeStatus.enabled) {
      setError('Ceiling slice zones require polygon mode. Enable polygon mode before saving slices to the device.');
      return;
    }

    // Check if zones are outside max range
    const maxRangeMeters = trackingMaxRangeMeters ?? 6;
    const maxRangeMm = maxRangeMeters * 1000;

    const rectZones = (selectedRoom.zones ?? []).filter(zone => isZoneAvailable(zone));
    const zonesToWrite = isCeilingSliceMode ? [...ceilingSliceDeviceZones, ...ceilingExclusionDeviceZones] : polygonZones;
    const outOfRangeZones = isCeilingSliceMode
      ? []
      : getOutOfRangeZones(
          rectZones,
          polygonZones,
          maxRangeMm,
          polygonModeStatus.enabled
        );

    if (outOfRangeZones.length > 0) {
      setError(
        `The following zones extend beyond the device's max detection range (${maxRangeMeters}m): ${outOfRangeZones.join(', ')}. ` +
        `Please move or resize these zones to be within the detection area shown by the overlay.`
      );
      return;
    }

    setSaving(true);
    setWarning(null);
    try {
      const effectiveProfile = selectedRoom.profileId ?? selectedProfileId;

      const entityNamePrefix = resolveEntityPrefix({
        entityMappings: selectedRoom.entityMappings,
        entityNamePrefix: selectedRoom.entityNamePrefix,
        mappingPrefix: selectedDeviceMapping?.esphomeNodeName,
        devicePrefix: selectedDevice?.entityNamePrefix,
      });

      if (selectedRoom.deviceId && effectiveProfile && entityNamePrefix) {
        // Skip entityMappings if device has valid mappings stored
        const entityMappingsToUse = deviceHasValidMappings ? undefined : selectedRoom.entityMappings;
        if (polygonModeStatus.enabled) {
          // Save polygon zones
          const result = await pushPolygonZonesToDevice(
            selectedRoom.deviceId,
            effectiveProfile,
            zonesToWrite,
            entityNamePrefix,
            entityMappingsToUse
          );
          const warningMessages: string[] = [];
          if (result.warnings && result.warnings.length > 0) {
            const sample = result.warnings
              .map((warning) => warning.entityId ?? warning.description)
              .filter(Boolean)
              .slice(0, 3)
              .join(', ');
            warningMessages.push(
              `Saved, but ${result.warnings.length} entity update(s) failed. ${sample ? `(${sample})` : ''}`.trim()
            );
          }

          const disabledPolygonZones = polygonZones
            .map((zone) => ({ id: zone.id, status: getPolygonStatus(zone.id) }))
            .filter((zone) => zone.status === 'disabled' || zone.status === 'unavailable');

          if (disabledPolygonZones.length > 0) {
            const sample = disabledPolygonZones
              .slice(0, 3)
              .map((zone) => `${zone.id} (${zone.status})`)
              .join(', ');
            warningMessages.push(
              `Some polygon zones could not be written because their entities are disabled or unavailable. ${sample ? `(${sample})` : ''}`.trim()
            );
          }

          if (warningMessages.length > 0) {
            setWarning(warningMessages.join(' '));
          }
        } else {
          // Save rectangle zones
          // Filter out zones whose entities are disabled in Home Assistant
          const availableZones = (selectedRoom.zones ?? []).filter(zone => isZoneAvailable(zone));
          const skippedZones = (selectedRoom.zones ?? [])
            .map((zone) => ({ id: zone.id, status: getZoneStatus(zone) }))
            .filter((zone) => zone.status === 'disabled' || zone.status === 'unavailable');

          // Validate zones
          await validateZones(availableZones);

          // Push zones to device (device is source of truth)
          const result = await pushZonesToDevice(selectedRoom.deviceId, effectiveProfile, availableZones, entityNamePrefix, entityMappingsToUse);
          const warningMessages: string[] = [];
          if (result.warnings && result.warnings.length > 0) {
            const sample = result.warnings
              .map((warning) => warning.entityId ?? warning.description)
              .filter(Boolean)
              .slice(0, 3)
              .join(', ');
            warningMessages.push(
              `Saved, but ${result.warnings.length} entity update(s) failed. ${sample ? `(${sample})` : ''}`.trim()
            );
          }
          if (skippedZones.length > 0) {
            const sample = skippedZones
              .slice(0, 3)
              .map((zone) => `${zone.id} (${zone.status})`)
              .join(', ');
            warningMessages.push(
              `Some zones were skipped because their entities are disabled or unavailable. ${sample ? `(${sample})` : ''}`.trim()
            );
          }
          if (warningMessages.length > 0) {
            setWarning(warningMessages.join(' '));
          }
        }
      }

      // Save to add-on storage (rectangle zones only - polygon zones are device-only)
      if (!polygonModeStatus.enabled) {
        const result = await updateRoom(selectedRoom.id, selectedRoom);
        setRooms((prev) => prev.map((r) => (r.id === selectedRoom.id ? result.room : r)));
      }

      // Save zone labels to device mapping (for both rectangle and polygon zones)
      if (selectedRoom.deviceId) {
        const labelsToSave: Record<string, string> = {};
        if (polygonModeStatus.enabled) {
          // Polygon zones - get labels from polygonZones state and deviceZoneLabels
          for (const zone of zonesToWrite) {
            const label = deviceZoneLabels[zone.id] || zone.label;
            if (label) {
              labelsToSave[zone.id] = label;
            }
          }
        } else {
          // Rectangle zones - get labels from room zones
          for (const zone of selectedRoom.zones ?? []) {
            if (zone.label) {
              labelsToSave[zone.id] = zone.label;
            }
          }
        }
        const savedLabels = await saveZoneLabels(selectedRoom.deviceId, labelsToSave);
        if (savedLabels) {
          setDeviceZoneLabels(savedLabels);
          // Invalidate the device mapping cache so other pages get fresh labels
          clearCache(selectedRoom.deviceId);
        }
      }

      onWizardZonesReady?.();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save zones');
    } finally {
      setSaving(false);
    }
  };

  // Use a ref to access current room data in handleAutoZoom without causing re-renders
  const selectedRoomRef = useRef(selectedRoom);
  selectedRoomRef.current = selectedRoom;

  const handleAutoZoom = useCallback(() => {
    const room = selectedRoomRef.current;
    const zones = room?.zones ?? [];
    const roomShellPts = room?.roomShell?.points ?? [];

    // If we have a room shell, use it for centering (like LiveTrackingPage)
    if (roomShellPts.length > 0) {
      const xs = roomShellPts.map((p) => p.x);
      const ys = roomShellPts.map((p) => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const pad = 500;
      const width = Math.max(100, maxX - minX + pad * 2);
      const height = Math.max(100, maxY - minY + pad * 2);
      const maxDim = Math.max(width, height);
      const targetZoom = Math.min(5, Math.max(0.1, (0.8 * rangeMm) / maxDim));
      setZoom(targetZoom);
      setPanOffsetMm({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
      return;
    }

    // Fallback to zones if no room shell
    if (!zones.length) {
      setZoom(1.1);
      setPanOffsetMm({ x: 0, y: 0 });
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
    const targetZoom = Math.min(5, Math.max(0.1, (0.8 * rangeMm) / maxDim));
    setZoom(targetZoom);
    setPanOffsetMm({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
  }, [rangeMm]);

  // Auto-zoom when room loads (only when room ID changes, not on zone edits)
  useEffect(() => {
    const room = selectedRoomRef.current;
    if (room?.zones?.length || room?.roomShell?.points?.length) {
      handleAutoZoom();
    }
  }, [selectedRoom?.id, handleAutoZoom]);

  useEffect(() => {
    if (!isMobileCanvas) {
      setActiveMobileSheet(null);
    }
  }, [isMobileCanvas]);

  const handleRoomSelection = useCallback((roomId: string | null) => {
    setSelectedRoomId(roomId);
    const room = rooms.find((candidate) => candidate.id === roomId);
    setSelectedZoneId(room?.zones?.[0]?.id ?? null);
    if (room?.profileId) setSelectedProfileId(room.profileId);
    onRoomChange?.(roomId, room?.profileId ?? selectedProfileId);
  }, [onRoomChange, rooms, selectedProfileId]);

  const toggleMobileZoneList = () => {
    setShowSettings(false);
    setActiveMobileSheet(null);
    setShowZoneList((current) => !current);
  };

  const toggleMobileDisplaySettings = () => {
    setShowZoneList(false);
    setActiveMobileSheet(null);
    setShowSettings((current) => !current);
  };

  const toggleMobileZoomSheet = () => {
    setShowZoneList(false);
    setShowSettings(false);
    setActiveMobileSheet((current) => current === 'zoom' ? null : 'zoom');
  };

  return (
    <div className="fixed inset-0 bg-slate-950 overflow-hidden">
      {/* Error Toast */}
      {error && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-50 max-w-lg rounded-xl border border-rose-500/50 bg-rose-500/10 backdrop-blur px-6 py-3 text-rose-100 shadow-xl animate-in slide-in-from-top-4 fade-in">
          {error}
        </div>
      )}
      {warning && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 max-w-lg rounded-xl border border-amber-500/50 bg-amber-500/10 backdrop-blur px-6 py-3 text-amber-100 shadow-xl animate-in slide-in-from-top-4 fade-in">
          {warning}
        </div>
      )}
      {polygonModeStatus.enabled && polygonZones.length === 0 && (hasSavedRectangularRecovery || hasBackupRecovery || loadingLatestZoneBackup) && (
        <div className="absolute top-36 left-1/2 -translate-x-1/2 z-50 w-[min(42rem,calc(100vw-2rem))] rounded-2xl border border-sky-500/40 bg-slate-900/90 px-5 py-4 text-slate-100 shadow-2xl backdrop-blur">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm font-semibold text-sky-300">Polygon Recovery Available</div>
              <div className="mt-1 text-sm text-slate-300">
                {hasSavedRectangularRecovery ? (
                  <>This device is using polygon-only zones, but room storage still has {savedRectangularZones.length} saved rectangular zone{savedRectangularZones.length === 1 ? '' : 's'}. Recover them to the device as polygons.</>
                ) : hasBackupRecovery ? (
                  <>This device is using polygon-only zones and room storage no longer has the old rectangles. Restore the latest saved zone backup to repopulate polygon zones.</>
                ) : (
                  <>Checking for saved zone backups that can be restored to this polygon-only device.</>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {hasSavedRectangularRecovery && (
                <button
                  onClick={() => { void handleRecoverPolygonZones(); }}
                  disabled={recoveringPolygonZones}
                  className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {recoveringPolygonZones ? 'Recovering...' : 'Recover Room Zones'}
                </button>
              )}
              {hasBackupRecovery && (
                <button
                  onClick={() => { void handleRestoreLatestZoneBackup(); }}
                  disabled={recoveringPolygonZones}
                  className="rounded-xl border border-sky-400/50 bg-slate-800 px-4 py-2 text-sm font-semibold text-sky-100 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {recoveringPolygonZones ? 'Restoring...' : 'Restore Latest Backup'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mode Change Confirmation Modal */}
      {showModeChangeConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowModeChangeConfirm(false)}
          />
          {/* Modal */}
          <div className="relative z-10 w-full max-w-md mx-4 rounded-2xl border border-slate-700/50 bg-slate-900/95 backdrop-blur shadow-2xl animate-in zoom-in-95 fade-in duration-200">
            <div className="p-6">
              {/* Icon */}
              <div className="flex justify-center mb-4">
                <div className="w-14 h-14 rounded-full bg-amber-500/20 flex items-center justify-center">
                  <span className="text-2xl">⚠️</span>
                </div>
              </div>
              {/* Title */}
              <h3 className="text-xl font-bold text-white text-center mb-2">
                Switch Zone Mode?
              </h3>
              {/* Message */}
              <p className="text-sm text-slate-300 text-center mb-6">
                {polygonModeStatus.enabled ? (
                  <>
                    You are about to switch from <span className="text-violet-400 font-semibold">Polygon Mode</span> to <span className="text-slate-100 font-semibold">Rectangle Mode</span>.
                    <br /><br />
                    Your polygon zones will remain saved on the device, but rectangle zones will be used for detection.
                  </>
                ) : (
                  <>
                    You are about to switch from <span className="text-slate-100 font-semibold">Rectangle Mode</span> to <span className="text-violet-400 font-semibold">Polygon Mode</span>.
                    <br /><br />
                    Your rectangle zones will remain saved on the device, but polygon zones will be used for detection.
                  </>
                )}
              </p>
              {/* Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={() => setShowModeChangeConfirm(false)}
                  className="flex-1 rounded-xl border border-slate-600 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-200 transition-all hover:bg-slate-700 active:scale-95"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setShowModeChangeConfirm(false);
                    handleTogglePolygonMode();
                  }}
                  disabled={togglingPolygonMode}
                  className="flex-1 rounded-xl bg-gradient-to-r from-amber-600 to-amber-500 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-amber-500/30 transition-all hover:shadow-xl hover:shadow-amber-500/40 disabled:opacity-50 active:scale-95"
                >
                  {togglingPolygonMode ? 'Switching...' : 'Switch Mode'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="md:hidden">
        <CanvasTopBar
          left={onBack && !onNavigate ? (
            <button
              type="button"
              onClick={onBack}
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
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </select>
          ) : 'Zone Editor'}
          right={(
            <button
              type="button"
              onClick={handleSaveZones}
              disabled={saving || !selectedRoom}
              className="min-h-[40px] rounded-lg bg-aqua-600 px-3 text-xs font-bold text-white shadow-lg shadow-aqua-500/20 disabled:opacity-50"
            >
              {saving ? 'Saving' : 'Save'}
            </button>
          )}
        />
      </div>

      {/* Navigation (top left) */}
      {onBack && !onNavigate && (
        <button
          onClick={onBack}
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
                      onNavigate('roomBuilder');
                      setShowNavMenu(false);
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm font-medium text-slate-100 rounded-lg transition-all hover:bg-aqua-600/20 hover:text-aqua-400 active:scale-95"
                  >
                    🏠 Room Builder
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

      {/* Floating Action Button (top right) */}
      <div className="absolute top-6 right-6 z-40 hidden flex-col items-end gap-2 md:flex">
        <button
          onClick={handleSaveZones}
          disabled={saving}
          className="rounded-xl bg-gradient-to-r from-aqua-600 to-aqua-500 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-aqua-500/30 transition-all hover:shadow-xl hover:shadow-aqua-500/40 disabled:opacity-50 active:scale-95 flex items-center gap-2"
        >
          {saving && (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          )}
          {saving ? 'Saving Zones...' : 'Save Zones'}
        </button>
        {onNavigate && (
          <button
            onClick={() => onNavigate('settings')}
            className="rounded-xl border border-slate-700/60 bg-slate-900/90 px-4 py-2 text-xs font-semibold text-slate-200 shadow-lg transition-all hover:border-slate-600 hover:bg-slate-800 active:scale-95"
          >
            Zone Backups
          </button>
        )}
      </div>

      {/* Canvas Content - Full Page */}
      {!selectedRoom && (
        <div className="flex h-full w-full items-center justify-center">
          <div className="max-w-md rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-900 to-slate-800 p-8 shadow-2xl">
            <div className="text-center space-y-4">
              <div className="text-6xl">📂</div>
              <h2 className="text-2xl font-bold text-white">No Room Selected</h2>
              <p className="text-sm text-slate-300">Select a room from the dropdown to start editing zones.</p>
            </div>
          </div>
        </div>
      )}

      {selectedRoom && (
        <div
          className="h-full w-full overflow-hidden overscroll-contain touch-none"
          onWheelCapture={(e) => {
            // Check if the event target is within a scrollable container (like zone slots panel)
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
            if ((e.nativeEvent as any)?.cancelable) {
              (e.nativeEvent as any).preventDefault();
            }
            e.stopPropagation();
            // Don't zoom while dragging zones (prevents trackpad scroll-while-drag issues)
            if (isDraggingZone) return;
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            setZoom((z) => Math.min(5, Math.max(0.1, z + delta)));
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
            // Polygon zones support
            polygonZones={activePolygonZones}
            onPolygonZonesChange={handlePolygonZonesChange}
            polygonMode={polygonModeStatus.enabled}
            polygonLateralOnlyAxis={isCeilingSliceMode ? ceilingSliceConfig.axis : undefined}
            selectedId={selectedZoneId}
            onSelect={(id) => setSelectedZoneId(id)}
            rangeMm={rangeMm}
            snapGridMm={snapGridMm}
            height="100%"
            zoom={zoom}
            panOffsetMm={panOffsetMm}
            onPanChange={(next) => setPanOffsetMm(next)}
            onZoomChange={setZoom}
            touchPanEnabled={!isDraggingZone}
            onCanvasMove={(pt) => setCursorPos(pt)}
            roomShell={selectedRoom.roomShell}
            roomShellFillMode={selectedRoom.roomShellFillMode}
            floorMaterial={selectedRoom.floorMaterial}
            furniture={selectedRoom.furniture ?? []}
            doors={selectedRoom.doors ?? []}
            zoneLabels={deviceZoneLabels}
            devicePlacement={selectedRoom.devicePlacement}
            installationAngle={installationAngle}
            fieldOfViewDeg={trackingFieldOfViewDeg}
            maxRangeMeters={trackingMaxRangeMeters}
            deviceIconUrl={deviceIconUrl}
            clipRadarToWalls={clipRadarToWalls}
            heightCoverage={heightCoverageConfig ?? undefined}
            showRadar={showDeviceRadar}
            showWalls={showWalls}
            showFurniture={showFurniture}
            showDoors={showDoors}
            showZones={showZones}
            showZoneLabels={showZoneLabels}
            zoneLabelScale={zoneLabelScale}
            showDevice={showDeviceIcon}
            onDragStateChange={handleZoneCanvasDragStateChange}
            renderOverlay={({ toCanvas }) => {
              // Define colors for each target (up to 3 targets)
              const targetColors = [
                { fill: '#3b82f6', fillOpacity: 'rgba(59, 130, 246, 0.2)', name: 'Blue' },      // Target 1 - Blue
                { fill: '#10b981', fillOpacity: 'rgba(16, 185, 129, 0.2)', name: 'Green' },     // Target 2 - Green
                { fill: '#f59e0b', fillOpacity: 'rgba(245, 158, 11, 0.2)', name: 'Amber' },     // Target 3 - Amber
              ];

              // Render live target positions (pointer-events: none so they don't block zone interaction)
              if (showTargets && isCeilingSliceMode && liveState?.targets && liveState.targets.length > 0) {
                return (
                  <g style={{ pointerEvents: 'none' }}>
                    {liveState.targets.map((target) => {
                      if (target.x === null || target.y === null) return null;
                      if (target.x === 0 && target.y === 0 && target.active !== true) return null;
                      const lateral = getCeilingSlicePosition(target, ceilingSliceConfig);
                      if (lateral === null) return null;
                      const endpoints = ceilingSliceConfig.axis === 'x'
                        ? (() => {
                            const depth = getCeilingSliceLineDepth(lateral, ceilingSliceConfig, heightCoverageConfig, trackingMaxRangeMm);
                            return depth ? [
                              deviceToRoom(lateral, depth.min),
                              deviceToRoom(lateral, depth.max),
                            ] : null;
                          })()
                        : (() => {
                            const depth = getCeilingSliceLineDepth(lateral, ceilingSliceConfig, heightCoverageConfig, trackingMaxRangeMm);
                            return depth ? [
                              deviceToRoom(depth.min, lateral),
                              deviceToRoom(depth.max, lateral),
                            ] : null;
                          })();
                      if (!endpoints) return null;
                      const start = toCanvas(endpoints[0]);
                      const end = toCanvas(endpoints[1]);
                      const labelPoint = toCanvas(deviceToRoom(
                        ceilingSliceConfig.axis === 'x' ? lateral : 0,
                        ceilingSliceConfig.axis === 'x' ? 0 : lateral,
                      ));
                      const colorIndex = (target.id - 1) % targetColors.length;
                      const color = targetColors[colorIndex];

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
                            stroke={color.fill}
                            strokeWidth={4 * targetMarkerScale}
                            strokeLinecap="round"
                            opacity={0.95}
                            strokeDasharray="10 7"
                          />
                          <circle
                            cx={labelPoint.x}
                            cy={labelPoint.y}
                            r={8 * targetMarkerScale}
                            fill={color.fill}
                            stroke="white"
                            strokeWidth={2 * targetMarkerScale}
                          />
                          <text
                            x={labelPoint.x}
                            y={labelPoint.y - (14 * targetMarkerScale)}
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

              if (showTargets && targetPositions.length > 0) {
                return (
                  <g style={{ pointerEvents: 'none' }}>
                    {targetPositions.map((target) => {
                      const colorIndex = (target.id - 1) % targetColors.length;
                      const color = targetColors[colorIndex];
                      const canvasPos = toCanvas({ x: target.x, y: target.y });

                      return (
                        <g key={target.id}>
                          <circle
                            cx={canvasPos.x}
                            cy={canvasPos.y}
                            r={12 * targetMarkerScale}
                            fill={color.fill}
                            fillOpacity={0.3}
                            stroke={color.fill}
                            strokeWidth={2 * targetMarkerScale}
                          />
                          <circle
                            cx={canvasPos.x}
                            cy={canvasPos.y}
                            r={5 * targetMarkerScale}
                            fill={color.fill}
                            stroke="white"
                            strokeWidth={2 * targetMarkerScale}
                          />
                          <text
                            x={canvasPos.x}
                            y={canvasPos.y - (18 * targetMarkerScale)}
                            textAnchor="middle"
                            fill="white"
                            fontSize={12 * targetMarkerScale}
                            fontWeight="bold"
                            className="pointer-events-none"
                          >
                            T{target.id}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                );
              }

              return null;
            }}
          />

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
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>

          {/* Zone List Toggle Button (left side) */}
          <div className="absolute top-24 left-6 z-40 hidden flex-col gap-2 md:flex">
            <button
              className="rounded-xl border border-aqua-600/50 bg-aqua-600/10 backdrop-blur px-6 py-3 text-sm font-semibold text-aqua-100 shadow-lg transition-all hover:bg-aqua-600/20 hover:shadow-xl active:scale-95"
              onClick={() => setShowZoneList(!showZoneList)}
            >
              {showZoneList ? '✕ Hide' : '☰ Show'} Zone Slots ({polygonModeStatus.enabled ? activePolygonZones.length : enabledZones.length}/{displayZones.length})
            </button>

            {/* Polygon Mode Toggle (only show if supported by profile AND device has the entities) */}
            {polygonModeStatus.supported && polygonModeControllable && (
              <button
                className={`rounded-xl border backdrop-blur px-6 py-3 text-sm font-semibold shadow-lg transition-all hover:shadow-xl active:scale-95 ${
                  polygonModeStatus.enabled
                    ? 'border-violet-500/50 bg-violet-600/20 text-violet-100'
                    : polygonZonesAvailable === false
                    ? 'border-amber-500/50 bg-amber-600/20 text-amber-100 cursor-not-allowed opacity-60'
                    : 'border-slate-600/50 bg-slate-800/50 text-slate-200 hover:bg-slate-700/50'
                }`}
                onClick={() => {
                  // Block switching to polygon mode if device doesn't support it
                  if (!polygonModeStatus.enabled && polygonZonesAvailable === false) return;
                  setShowModeChangeConfirm(true);
                }}
                disabled={togglingPolygonMode || (!polygonModeStatus.enabled && polygonZonesAvailable === false)}
                title={!polygonModeStatus.enabled && polygonZonesAvailable === false
                  ? 'Polygon Zones require a firmware update. Please update your device firmware to use this feature.'
                  : undefined}
              >
                {togglingPolygonMode ? 'Switching...' : (
                  <>
                    {polygonModeStatus.enabled ? (isCeilingSliceMode ? 'Ceiling Slice Mode' : '⬡ Polygon Mode') : '▢ Rectangle Mode'}
                    {!polygonModeStatus.enabled && polygonZonesAvailable === false && ' ⚠️'}
                  </>
                )}
              </button>
            )}
            {polygonModeStatus.supported && !polygonModeControllable && (
              <div className="rounded-xl border border-violet-500/40 bg-violet-600/10 px-6 py-3 text-sm font-semibold text-violet-100 shadow-lg">
                Polygon mode active
              </div>
            )}

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
              onClick={() => {
                setZoom(1.1);
                setPanOffsetMm({ x: 0, y: 0 });
              }}
            >
              Reset
            </button>
            <button
              className="rounded-xl border border-aqua-600/50 bg-aqua-600/10 backdrop-blur px-4 py-2.5 text-sm font-semibold text-aqua-100 shadow-lg transition-all hover:bg-aqua-600/20 hover:shadow-xl active:scale-95"
              onClick={handleAutoZoom}
            >
              Auto Zoom
            </button>
            <button
              className={`rounded-xl border backdrop-blur px-4 py-2.5 text-sm font-semibold shadow-lg transition-all hover:shadow-xl active:scale-95 ${
                showSettings
                  ? 'border-slate-500 bg-slate-700/90 text-slate-100'
                  : 'border-slate-700/50 bg-slate-900/90 text-slate-100 hover:border-slate-600 hover:bg-slate-800'
              }`}
              onClick={() => setShowSettings((v) => !v)}
            >
              🎨 Display
            </button>
          </div>

          {/* Settings Panel (appears above zoom controls when toggled) */}
          {showSettings && (
            <div className="absolute bottom-0 left-0 right-0 z-[80] max-h-[82dvh] overflow-y-auto rounded-t-2xl border-t border-slate-700 bg-slate-900/95 p-4 shadow-2xl mobile-safe-bottom md:bottom-6 md:left-auto md:right-6 md:mb-[280px] md:max-h-none md:w-64 md:rounded-xl md:border md:border-slate-700/50 md:bg-transparent md:p-0 md:shadow-none">
              <div className="rounded-xl border border-slate-700/50 bg-slate-900/95 backdrop-blur p-4 shadow-xl">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-100">Display Settings</div>
                  <button
                    type="button"
                    onClick={() => setShowSettings(false)}
                    className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 md:hidden"
                  >
                    Close
                  </button>
                </div>
                <DisplaySettingsControls
                  overlayOptions={[
                    { label: 'Device coverage', checked: showDeviceRadar, onChange: setShowDeviceRadar },
                    { label: 'Clip radar to walls', checked: clipRadarToWalls, onChange: setClipRadarToWalls },
                  ]}
                  roomOptions={[
                    { label: 'Walls', checked: showWalls, onChange: setShowWalls },
                    { label: 'Furniture', checked: showFurniture, onChange: setShowFurniture },
                    { label: 'Doors', checked: showDoors, onChange: setShowDoors },
                    { label: 'Zones', checked: showZones, onChange: setShowZones },
                    { label: 'Device icon', checked: showDeviceIcon, onChange: setShowDeviceIcon },
                    { label: 'Targets', checked: showTargets, onChange: setShowTargets },
                  ]}
                  appearance={{
                    targetMarkerScale,
                    setTargetMarkerScale,
                    showZoneLabels,
                    setShowZoneLabels,
                    zoneLabelScale,
                    setZoneLabelScale,
                  }}
                />
              </div>
            </div>
          )}

          {/* Floating Snap Controls (bottom left) */}
          <div className="absolute bottom-6 left-6 z-40 hidden flex-col gap-2 rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur px-4 py-3 shadow-xl md:flex">
            <span className="text-xs text-slate-400 font-medium">Snap Grid</span>
            <div className="flex flex-wrap gap-2">
              {[0, 50, 100, 200].map((v) => (
                <button
                  key={v}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all active:scale-95 ${
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
            <div className="mt-1 text-[10px] text-slate-400">
              Cursor: X {cursorPos ? (cursorPos.x / 1000).toFixed(2) : '--'}m, Y{' '}
              {cursorPos ? (cursorPos.y / 1000).toFixed(2) : '--'}m
            </div>
          </div>

          {/* Floating Zone List Panel (slides in from right) */}
          {showZoneList && (
            <div className="absolute bottom-0 left-0 right-0 z-[80] max-h-[82dvh] overflow-y-auto rounded-t-2xl border-t border-slate-700 bg-slate-900/95 shadow-2xl mobile-safe-bottom mobile-sheet-panel md:top-0 md:bottom-0 md:left-auto md:w-96 md:max-h-none md:rounded-none md:border-l md:border-t-0 md:backdrop-blur md:animate-in md:slide-in-from-right-4 md:fade-in md:duration-200">
              <div className="sticky top-0 z-10 border-b border-slate-700 bg-slate-900/95 backdrop-blur p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-white">
                    {polygonModeStatus.enabled ? (isCeilingSliceMode ? 'Ceiling Slices' : '⬡ Polygon Zones') : 'Zone Slots'}
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
                    ? `${activePolygonZones.length} of ${displayZones.length} slots configured`
                    : `${enabledZones.length} of ${displayZones.length} slots active`
                  }
                </div>
              </div>

              {/* Polygon Mode Zone List */}
              {polygonModeStatus.enabled ? (
                <div className="p-4 space-y-3">
                  {isCeilingSliceMode && (
                    <div className="rounded-lg border border-cyan-500/40 bg-cyan-600/10 p-3 text-sm text-cyan-100">
                      <div className="mb-2 font-semibold">Ceiling Slice Mode</div>
                      <div className="mb-3 text-xs text-cyan-100/80">
                        Targets are shown as clipped lateral lines. Drag slice edges to adjust left/right boundaries.
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="text-xs">
                          <span className="mb-1 block text-cyan-100/80">Reliable axis</span>
                          <select
                            className="w-full rounded-md border border-cyan-700 bg-slate-900 px-2 py-1 text-cyan-50"
                            value={ceilingSliceConfig.axis}
                            onChange={(e) => {
                              void updateCeilingSliceConfig({ axis: e.target.value === 'y' ? 'y' : 'x' });
                            }}
                          >
                            <option value="x">X axis</option>
                            <option value="y">Y axis</option>
                          </select>
                        </label>
                        <label className="text-xs">
                          <span className="mb-1 block text-cyan-100/80">Slices</span>
                          <select
                            className="w-full rounded-md border border-cyan-700 bg-slate-900 px-2 py-1 text-cyan-50"
                            value={ceilingSliceConfig.sliceCount}
                            onChange={(e) => {
                              void updateCeilingSliceConfig({
                                sliceCount: Number(e.target.value) || 3,
                                lateralBreakpointsMm: undefined,
                                lateralRangesMm: undefined,
                              });
                            }}
                          >
                            <option value={2}>2</option>
                            <option value={3}>3</option>
                            <option value={4}>4</option>
                          </select>
                        </label>
                        <label className="text-xs">
                          <span className="mb-1 block text-cyan-100/80">Min</span>
                          <input
                            type="number"
                            step={100}
                            className="w-full rounded-md border border-cyan-700 bg-slate-900 px-2 py-1 text-cyan-50"
                            value={ceilingSliceConfig.lateralMinMm}
                            onChange={(e) => {
                              void updateCeilingSliceConfig({ lateralMinMm: Number(e.target.value) || 0 });
                            }}
                          />
                        </label>
                        <label className="text-xs">
                          <span className="mb-1 block text-cyan-100/80">Max</span>
                          <input
                            type="number"
                            step={100}
                            className="w-full rounded-md border border-cyan-700 bg-slate-900 px-2 py-1 text-cyan-50"
                            value={ceilingSliceConfig.lateralMaxMm}
                            onChange={(e) => {
                              void updateCeilingSliceConfig({ lateralMaxMm: Number(e.target.value) || 0 });
                            }}
                          />
                        </label>
                      </div>
                      <div className="mt-2 text-xs text-cyan-100/80">
                        Ceiling mount left/right mirroring is applied automatically.
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const existing = ceilingSliceConfig.exclusionRangesMm ?? [];
                          const maxExclusions = selectedProfile?.limits.maxExclusionZones ?? 2;
                          if (existing.length >= maxExclusions) return;
                          const width = Math.max(300, (ceilingSliceConfig.lateralMaxMm - ceilingSliceConfig.lateralMinMm) / 8);
                          const center = 0;
                          void updateCeilingSliceConfig({
                            exclusionRangesMm: [
                              ...existing,
                              { min: center - width / 2, max: center + width / 2 },
                            ],
                          });
                        }}
                        disabled={(ceilingSliceConfig.exclusionRangesMm?.length ?? 0) >= (selectedProfile?.limits.maxExclusionZones ?? 2)}
                        className="mt-3 w-full rounded-md border border-rose-500/50 bg-rose-600/20 px-3 py-2 text-xs font-semibold text-rose-100 transition-all hover:bg-rose-600/30 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        + Exclusion ({ceilingSliceConfig.exclusionRangesMm?.length ?? 0}/{selectedProfile?.limits.maxExclusionZones ?? 2})
                      </button>
                    </div>
                  )}
                  {/* Add Zone Buttons */}
                  {!isCeilingSliceMode && <div className="flex flex-wrap gap-2 pb-3 border-b border-slate-700/50">
                    <button
                      onClick={() => {
                        const regularCount = polygonZones.filter(z => z.type === 'regular').length;
                        if (regularCount >= (selectedProfile?.limits.maxZones ?? 4)) return;
                        const newZone: ZonePolygon = {
                          id: `Zone ${regularCount + 1}`,
                          type: 'regular',
                          vertices: [{ x: 0, y: 1000 }, { x: 1000, y: 1000 }, { x: 500, y: 0 }],
                          enabled: true,
                        };
                        setPolygonZones([...polygonZones, newZone]);
                        setSelectedZoneId(newZone.id);
                      }}
                      disabled={polygonZones.filter(z => z.type === 'regular').length >= (selectedProfile?.limits.maxZones ?? 4)}
                      className="flex-1 rounded-lg border border-blue-500/50 bg-blue-600/20 px-3 py-2 text-xs font-semibold text-blue-100 transition-all hover:bg-blue-600/30 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      + Zone ({polygonZones.filter(z => z.type === 'regular').length}/{selectedProfile?.limits.maxZones ?? 4})
                    </button>
                    <button
                      onClick={() => {
                        const exclusionCount = polygonZones.filter(z => z.type === 'exclusion').length;
                        if (exclusionCount >= (selectedProfile?.limits.maxExclusionZones ?? 2)) return;
                        const newZone: ZonePolygon = {
                          id: `Exclusion ${exclusionCount + 1}`,
                          type: 'exclusion',
                          vertices: [{ x: -500, y: 500 }, { x: 500, y: 500 }, { x: 0, y: -500 }],
                          enabled: true,
                        };
                        setPolygonZones([...polygonZones, newZone]);
                        setSelectedZoneId(newZone.id);
                      }}
                      disabled={polygonZones.filter(z => z.type === 'exclusion').length >= (selectedProfile?.limits.maxExclusionZones ?? 2)}
                      className="flex-1 rounded-lg border border-rose-500/50 bg-rose-600/20 px-3 py-2 text-xs font-semibold text-rose-100 transition-all hover:bg-rose-600/30 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      + Exclusion ({polygonZones.filter(z => z.type === 'exclusion').length}/{selectedProfile?.limits.maxExclusionZones ?? 2})
                    </button>
                    <button
                      onClick={() => {
                        const entryCount = polygonZones.filter(z => z.type === 'entry').length;
                        if (entryCount >= (selectedProfile?.limits.maxEntryZones ?? 2)) return;
                        const newZone: ZonePolygon = {
                          id: `Entry ${entryCount + 1}`,
                          type: 'entry',
                          vertices: [{ x: 1500, y: 500 }, { x: 2500, y: 500 }, { x: 2000, y: -500 }],
                          enabled: true,
                        };
                        setPolygonZones([...polygonZones, newZone]);
                        setSelectedZoneId(newZone.id);
                      }}
                      disabled={polygonZones.filter(z => z.type === 'entry').length >= (selectedProfile?.limits.maxEntryZones ?? 2)}
                      className="flex-1 rounded-lg border border-emerald-500/50 bg-emerald-600/20 px-3 py-2 text-xs font-semibold text-emerald-100 transition-all hover:bg-emerald-600/30 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      + Entry ({polygonZones.filter(z => z.type === 'entry').length}/{selectedProfile?.limits.maxEntryZones ?? 2})
                    </button>
                  </div>}

                  {/* Polygon Zone List */}
                  {activePolygonZones.length === 0 ? (
                    <div className="text-center py-8 text-slate-400 text-sm">
                      No polygon zones configured.<br />
                      Use the buttons above to add zones.
                    </div>
                  ) : (
                    activePolygonZones.map((polygon) => {
                      const isSelected = selectedZoneId === polygon.id;
                      const polygonStatus = getPolygonStatus(polygon.id);
                      return (
                        <div
                          key={polygon.id}
                          onClick={() => setSelectedZoneId(polygon.id)}
                          className={`rounded-lg border p-3 transition-all cursor-pointer ${
                            polygon.type === 'regular'
                              ? isSelected ? 'border-blue-500 bg-blue-600/20' : 'border-blue-600/50 bg-blue-600/10 hover:bg-blue-600/15'
                              : polygon.type === 'exclusion'
                              ? isSelected ? 'border-rose-500 bg-rose-600/20' : 'border-rose-600/50 bg-rose-600/10 hover:bg-rose-600/15'
                              : isSelected ? 'border-emerald-500 bg-emerald-600/20' : 'border-emerald-600/50 bg-emerald-600/10 hover:bg-emerald-600/15'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className={`text-sm font-bold ${
                                polygon.type === 'regular' ? 'text-blue-100' :
                                polygon.type === 'exclusion' ? 'text-rose-100' : 'text-emerald-100'
                              }`}>
                                {deviceZoneLabels[polygon.id] || polygon.label || polygon.id}
                              </span>
                              {(deviceZoneLabels[polygon.id] || polygon.label) && (
                                <span className="text-xs text-slate-500">({polygon.id})</span>
                              )}
                              {polygonStatus === 'disabled' && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-200">
                                  Disabled
                                </span>
                              )}
                              {polygonStatus === 'unavailable' && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-200">
                                  Unavailable
                                </span>
                              )}
                              <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                                polygon.type === 'regular' ? 'bg-blue-500/30 text-blue-200' :
                                polygon.type === 'exclusion' ? 'bg-rose-500/30 text-rose-200' : 'bg-emerald-500/30 text-emerald-200'
                              }`}>
                                {polygon.vertices.length} vertices
                              </span>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isCeilingSliceMode && polygon.type === 'exclusion') {
                                  const index = Number(polygon.id.replace(/\D/g, '')) - 1;
                                  const nextExclusions = (ceilingSliceConfig.exclusionRangesMm ?? [])
                                    .filter((_, exclusionIndex) => exclusionIndex !== index);
                                  void updateCeilingSliceConfig({ exclusionRangesMm: nextExclusions });
                                  setSelectedZoneId(activePolygonZones[0]?.id ?? null);
                                  return;
                                }
                                const newZones = polygonZones.filter(z => z.id !== polygon.id);
                                // Renumber zones of the same type
                                let regularIdx = 1, exclusionIdx = 1, entryIdx = 1;
                                const renumbered = newZones.map(z => {
                                  if (z.type === 'regular') return { ...z, id: `Zone ${regularIdx++}` };
                                  if (z.type === 'exclusion') return { ...z, id: `Exclusion ${exclusionIdx++}` };
                                  return { ...z, id: `Entry ${entryIdx++}` };
                                });
                                setPolygonZones(renumbered);
                                if (selectedZoneId === polygon.id) {
                                  setSelectedZoneId(renumbered[0]?.id ?? null);
                                }
                              }}
                              className="rounded-lg border border-slate-600 bg-slate-700/50 px-2 py-1 text-xs text-slate-300 transition-all hover:bg-rose-600/30 hover:border-rose-500 hover:text-rose-200"
                              style={{ display: isCeilingSliceMode && polygon.type !== 'exclusion' ? 'none' : undefined }}
                            >
                              Delete
                            </button>
                          </div>
                          {/* Zone Name Input */}
                          <div className="mb-2">
                            <input
                              type="text"
                              placeholder="Zone name (e.g. Bed, Desk...)"
                              className={`w-full rounded-md border px-2 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none ${
                                polygon.type === 'regular'
                                  ? 'border-blue-600/50 bg-blue-950/50 focus:border-blue-400'
                                  : polygon.type === 'exclusion'
                                  ? 'border-rose-600/50 bg-rose-950/50 focus:border-rose-400'
                                  : 'border-emerald-600/50 bg-emerald-950/50 focus:border-emerald-400'
                              }`}
                              value={deviceZoneLabels[polygon.id] ?? polygon.label ?? ''}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => {
                                const newLabel = e.target.value || undefined;
                                // Update both local polygon state and deviceZoneLabels
                                const updated = { ...polygon, label: newLabel };
                                setPolygonZones(polygonZones.map(z => z.id === polygon.id ? updated : z));
                                setDeviceZoneLabels(prev => {
                                  const next = { ...prev };
                                  if (newLabel) {
                                    next[polygon.id] = newLabel;
                                  } else {
                                    delete next[polygon.id];
                                  }
                                  return next;
                                });
                              }}
                            />
                          </div>
                          {/* Vertex info */}
                          <div className="text-[10px] text-slate-400 font-mono">
                            {polygon.vertices.slice(0, 3).map((v, i) => (
                              <span key={i}>({(v.x / 1000).toFixed(1)}, {(v.y / 1000).toFixed(1)}){i < Math.min(polygon.vertices.length - 1, 2) ? ' → ' : ''}</span>
                            ))}
                            {polygon.vertices.length > 3 && <span> +{polygon.vertices.length - 3} more</span>}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              ) : (
                /* Rectangle Mode Zone List - Matching Polygon UI Style */
                <div className="p-4 space-y-3">
                  {/* Add Zone Buttons */}
                  <div className="flex flex-wrap gap-2 pb-3 border-b border-slate-700/50">
                    {(() => {
                      const regularSlots = displayZones.filter(z => z.type === 'regular' && isZoneAvailable(z));
                      const enabledRegular = regularSlots.filter(z => z.enabled).length;
                      const nextRegularSlot = regularSlots.find(z => !z.enabled);
                      return (
                        <button
                          onClick={() => nextRegularSlot && enableZoneSlot(nextRegularSlot.id)}
                          disabled={!nextRegularSlot}
                          className="flex-1 rounded-lg border border-blue-500/50 bg-blue-600/20 px-3 py-2 text-xs font-semibold text-blue-100 transition-all hover:bg-blue-600/30 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          + Zone ({enabledRegular}/{regularSlots.length})
                        </button>
                      );
                    })()}
                    {(() => {
                      const exclusionSlots = displayZones.filter(z => z.type === 'exclusion' && isZoneAvailable(z));
                      const enabledExclusion = exclusionSlots.filter(z => z.enabled).length;
                      const nextExclusionSlot = exclusionSlots.find(z => !z.enabled);
                      return (
                        <button
                          onClick={() => nextExclusionSlot && enableZoneSlot(nextExclusionSlot.id)}
                          disabled={!nextExclusionSlot}
                          className="flex-1 rounded-lg border border-rose-500/50 bg-rose-600/20 px-3 py-2 text-xs font-semibold text-rose-100 transition-all hover:bg-rose-600/30 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          + Exclusion ({enabledExclusion}/{exclusionSlots.length})
                        </button>
                      );
                    })()}
                    {(() => {
                      const entrySlots = displayZones.filter(z => z.type === 'entry' && isZoneAvailable(z));
                      const enabledEntry = entrySlots.filter(z => z.enabled).length;
                      const nextEntrySlot = entrySlots.find(z => !z.enabled);
                      return (
                        <button
                          onClick={() => nextEntrySlot && enableZoneSlot(nextEntrySlot.id)}
                          disabled={!nextEntrySlot}
                          className="flex-1 rounded-lg border border-emerald-500/50 bg-emerald-600/20 px-3 py-2 text-xs font-semibold text-emerald-100 transition-all hover:bg-emerald-600/30 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          + Entry ({enabledEntry}/{entrySlots.length})
                        </button>
                      );
                    })()}
                  </div>

                  {/* Rectangle Zone List - Only show enabled zones */}
                  {enabledZones.length === 0 ? (
                    <div className="text-center py-8 text-slate-400 text-sm">
                      No zones configured.<br />
                      Use the buttons above to add zones.
                    </div>
                  ) : (
                    enabledZones.map((zone) => {
                      const isSelected = selectedZoneId === zone.id;
                      const status = getZoneStatus(zone);
                      return (
                        <div
                          key={zone.id}
                          onClick={() => setSelectedZoneId(zone.id)}
                          className={`rounded-lg border p-3 transition-all cursor-pointer ${
                            zone.type === 'regular'
                              ? isSelected ? 'border-blue-500 bg-blue-600/20' : 'border-blue-600/50 bg-blue-600/10 hover:bg-blue-600/15'
                              : zone.type === 'exclusion'
                              ? isSelected ? 'border-rose-500 bg-rose-600/20' : 'border-rose-600/50 bg-rose-600/10 hover:bg-rose-600/15'
                              : isSelected ? 'border-emerald-500 bg-emerald-600/20' : 'border-emerald-600/50 bg-emerald-600/10 hover:bg-emerald-600/15'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className={`text-sm font-bold ${
                                zone.type === 'regular' ? 'text-blue-100' :
                                zone.type === 'exclusion' ? 'text-rose-100' : 'text-emerald-100'
                              }`}>
                                {zone.label || zone.id}
                              </span>
                              {zone.label && (
                                <span className="text-xs text-slate-500">({zone.id})</span>
                              )}
                              {status === 'disabled' && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-200">
                                  Disabled
                                </span>
                              )}
                              {status === 'unavailable' && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-200">
                                  Unavailable
                                </span>
                              )}
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                disableZoneSlot(zone.id);
                              }}
                              className="rounded-lg border border-slate-600 bg-slate-700/50 px-2 py-1 text-xs text-slate-300 transition-all hover:bg-rose-600/30 hover:border-rose-500 hover:text-rose-200"
                            >
                              Delete
                            </button>
                          </div>
                          {/* Zone Name Input */}
                          <div className="mb-2">
                            <input
                              type="text"
                              placeholder="Zone name (e.g. Bed, Desk...)"
                              className={`w-full rounded-md border px-2 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none ${
                                zone.type === 'regular'
                                  ? 'border-blue-600/50 bg-blue-950/50 focus:border-blue-400'
                                  : zone.type === 'exclusion'
                                  ? 'border-rose-600/50 bg-rose-950/50 focus:border-rose-400'
                                  : 'border-emerald-600/50 bg-emerald-950/50 focus:border-emerald-400'
                              }`}
                              value={zone.label ?? ''}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => {
                                const updated = { ...zone, label: e.target.value || undefined };
                                const newDisplayZones = displayZones.map((z) =>
                                  z.id === updated.id ? { ...updated, enabled: true } : z
                                );
                                handleZonesChange(newDisplayZones.filter(z => z.enabled));
                              }}
                            />
                          </div>
                          {/* Coordinate info */}
                          <div className="text-[10px] text-slate-400 font-mono">
                            x: {(zone.x / 1000).toFixed(2)}m, y: {(zone.y / 1000).toFixed(2)}m, w: {(zone.width / 1000).toFixed(2)}m, h: {(zone.height / 1000).toFixed(2)}m
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          )}

          <div className="md:hidden">
            <CanvasBottomToolbar>
              <CanvasToolbarButton
                label="Zones"
                active={showZoneList}
                badge={polygonModeStatus.enabled ? activePolygonZones.length : enabledZones.length}
                onClick={toggleMobileZoneList}
              />
              {polygonModeStatus.supported && polygonModeControllable && (
                <CanvasToolbarButton
                  label="Mode"
                  badge={polygonModeStatus.enabled ? (isCeilingSliceMode ? 'Slices' : 'Poly') : 'Rect'}
                  active={polygonModeStatus.enabled}
                  disabled={togglingPolygonMode || (!polygonModeStatus.enabled && polygonZonesAvailable === false)}
                  onClick={() => {
                    if (!polygonModeStatus.enabled && polygonZonesAvailable === false) return;
                    setShowModeChangeConfirm(true);
                  }}
                />
              )}
              <CanvasToolbarButton
                label="Display"
                active={showSettings}
                onClick={toggleMobileDisplaySettings}
              />
              <CanvasToolbarButton
                label="Zoom"
                active={activeMobileSheet === 'zoom'}
                onClick={toggleMobileZoomSheet}
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
                  onNavigate('liveDashboard');
                  setActiveMobileSheet(null);
                }}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-left text-sm font-semibold text-slate-100"
              >
                Live Dashboard
              </button>
              <button
                type="button"
                onClick={() => {
                  onNavigate('wizard');
                  setActiveMobileSheet(null);
                }}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-left text-sm font-semibold text-slate-100"
              >
                Add Device
              </button>
              <button
                type="button"
                onClick={() => {
                  onNavigate('roomBuilder');
                  setActiveMobileSheet(null);
                }}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-left text-sm font-semibold text-slate-100"
              >
                Room Builder
              </button>
              <button
                type="button"
                onClick={() => {
                  onNavigate('settings');
                  setActiveMobileSheet(null);
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
        open={activeMobileSheet === 'zoom'}
        title="Zoom & Snap"
        onClose={() => setActiveMobileSheet(null)}
      >
        <div className="space-y-4 text-sm text-slate-200">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 font-semibold"
              onClick={() => setZoom((z) => Math.min(5, z + 0.1))}
            >
              Zoom In
            </button>
            <button
              type="button"
              className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 font-semibold"
              onClick={() => setZoom((z) => Math.max(0.1, z - 0.1))}
            >
              Zoom Out
            </button>
            <button
              type="button"
              className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 font-semibold"
              onClick={() => {
                setZoom(1.1);
                setPanOffsetMm({ x: 0, y: 0 });
              }}
            >
              Reset
            </button>
            <button
              type="button"
              className="rounded-lg border border-aqua-600/60 bg-aqua-600/20 px-4 py-3 font-semibold text-aqua-100"
              onClick={handleAutoZoom}
            >
              Auto Fit
            </button>
          </div>
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Snap Grid</div>
            <div className="grid grid-cols-4 gap-2">
              {[0, 50, 100, 200].map((value) => (
                <button
                  key={value}
                  type="button"
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
          <div className="rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2 text-xs text-slate-400">
            Cursor: X {cursorPos ? (cursorPos.x / 1000).toFixed(2) : '--'}m, Y {cursorPos ? (cursorPos.y / 1000).toFixed(2) : '--'}m
          </div>
        </div>
      </CanvasMobileSheet>
    </div>
  );
};
