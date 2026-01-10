import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { fetchDevices, fetchProfiles, fetchZoneAvailability, ingressAware } from '../api/client';
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
import { DiscoveredDevice, DeviceProfile, RoomConfig, ZoneRect, ZonePolygon, LiveState, ZoneAvailability } from '../api/types';
import { useDisplaySettings } from '../hooks/useDisplaySettings';
import { useDeviceMappings } from '../contexts/DeviceMappingsContext';

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

export const ZoneEditorPage: React.FC<ZoneEditorPageProps> = ({
  onBack,
  onNavigate,
  initialRoomId,
  initialProfileId,
  onWizardZonesReady,
  liveState: propLiveState,
  targetPositions: propTargetPositions = []
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
  // Polygon mode state
  const [polygonModeStatus, setPolygonModeStatus] = useState<PolygonModeStatus>({ supported: false, enabled: false });
  const [polygonZones, setPolygonZones] = useState<ZonePolygon[]>([]);
  const [togglingPolygonMode, setTogglingPolygonMode] = useState(false);
  const [showModeChangeConfirm, setShowModeChangeConfirm] = useState(false);
  // Zone labels from device mapping (stored separately from zone coordinates)
  const [deviceZoneLabels, setDeviceZoneLabels] = useState<Record<string, string>>({});
  // Display settings (persisted to localStorage)
  const {
    showWalls, setShowWalls,
    showFurniture, setShowFurniture,
    showDoors, setShowDoors,
    showZones, setShowZones,
    showDeviceIcon, setShowDeviceIcon,
    showTargets, setShowTargets,
    clipRadarToWalls,
  } = useDisplaySettings();
  const liveState = propLiveState;
  const installationAngle =
    typeof liveState?.config?.installationAngle === 'number' ? liveState.config.installationAngle : 0;
  const loadedRoomRef = useRef<string | null>(null);
  const previousRoomIdRef = useRef<string | null>(null);

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

  // Device mappings context - used to check if device has valid entity mappings
  const { hasValidMappings, clearCache } = useDeviceMappings();
  const deviceHasValidMappings = selectedRoom?.deviceId ? hasValidMappings(selectedRoom.deviceId) : false;

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

    const deviceZones = selectedRoom.zones ?? [];

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
  }, [selectedRoom, allPossibleZones, deviceZoneLabels]);

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

  const getZoneStatus = (zone: ZoneRect): 'enabled' | 'disabled' | 'unavailable' | 'unknown' => {
    const key = getAvailabilityKey(zone.id, zone.type);
    const availability = zoneAvailability[key];
    return availability?.status ?? 'unknown';
  };

  const getPolygonStatus = (zoneId: string): 'enabled' | 'disabled' | 'unavailable' | 'unknown' => {
    const availability = polygonAvailability[zoneId];
    return availability?.status ?? 'unknown';
  };

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

      // Try to get entityNamePrefix from the room, or look it up from devices
      let entityNamePrefix = selectedRoom.entityNamePrefix;
      if (!entityNamePrefix) {
        const device = devices.find(d => d.id === selectedRoom.deviceId);
        entityNamePrefix = device?.entityNamePrefix;
      }

      if (!entityNamePrefix) {
        return;
      }

      try {
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
  }, [selectedRoom?.id, selectedRoom?.deviceId, selectedRoom?.profileId, selectedRoom?.entityNamePrefix, selectedRoom?.entityMappings, devices, deviceHasValidMappings]);

  // Fetch zone availability from entity registry
  useEffect(() => {
    const loadZoneAvailability = async () => {
      if (!selectedRoom?.deviceId || !selectedRoom?.profileId) {
        setZoneAvailability({});
        setPolygonZonesAvailable(null);
        setEntryZonesAvailable(null);
        return;
      }

      let entityNamePrefix = selectedRoom.entityNamePrefix;
      if (!entityNamePrefix) {
        const device = devices.find(d => d.id === selectedRoom.deviceId);
        entityNamePrefix = device?.entityNamePrefix;
      }

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
        setPolygonModeStatus({ supported: false, enabled: false });
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
      } catch (err) {
        setPolygonModeStatus({ supported: false, enabled: false });
      }
    };

    loadPolygonModeStatus();
  }, [selectedRoom?.id, selectedRoom?.deviceId, selectedRoom?.profileId, selectedRoom?.entityNamePrefix, selectedRoom?.entityMappings, devices, deviceHasValidMappings]);

  // Fetch polygon zones when polygon mode is enabled
  useEffect(() => {
    const loadPolygonZones = async () => {
      if (!polygonModeStatus.enabled || !selectedRoom?.deviceId || !selectedRoom?.profileId) {
        setPolygonZones([]);
        return;
      }

      let entityNamePrefix = selectedRoom.entityNamePrefix;
      if (!entityNamePrefix) {
        const device = devices.find(d => d.id === selectedRoom.deviceId);
        entityNamePrefix = device?.entityNamePrefix;
      }

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
    setPolygonZones(nextZones);
    if (nextZones.length && !selectedZoneId) {
      setSelectedZoneId(nextZones[0].id);
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

    let entityNamePrefix = selectedRoom.entityNamePrefix;
    if (!entityNamePrefix) {
      const device = devices.find(d => d.id === selectedRoom.deviceId);
      entityNamePrefix = device?.entityNamePrefix;
    }

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

    // Check if zones are outside max range
    const maxRangeMeters = selectedProfile?.limits?.maxRangeMeters ?? 6;
    const maxRangeMm = maxRangeMeters * 1000;

    const rectZones = (selectedRoom.zones ?? []).filter(zone => isZoneAvailable(zone));
    const outOfRangeZones = getOutOfRangeZones(
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

      // Get entityNamePrefix from room or device
      let entityNamePrefix = selectedRoom.entityNamePrefix;
      if (!entityNamePrefix) {
        const device = devices.find(d => d.id === selectedRoom.deviceId);
        entityNamePrefix = device?.entityNamePrefix;
      }

      if (selectedRoom.deviceId && effectiveProfile && entityNamePrefix) {
        // Skip entityMappings if device has valid mappings stored
        const entityMappingsToUse = deviceHasValidMappings ? undefined : selectedRoom.entityMappings;
        if (polygonModeStatus.enabled) {
          // Save polygon zones
          const result = await pushPolygonZonesToDevice(
            selectedRoom.deviceId,
            effectiveProfile,
            polygonZones,
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
          for (const zone of polygonZones) {
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
      <div className="absolute top-6 right-6 z-40">
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
            polygonZones={polygonZones}
            onPolygonZonesChange={handlePolygonZonesChange}
            polygonMode={polygonModeStatus.enabled}
            selectedId={selectedZoneId}
            onSelect={(id) => setSelectedZoneId(id)}
            rangeMm={rangeMm}
            snapGridMm={snapGridMm}
            height="100%"
            zoom={zoom}
            panOffsetMm={panOffsetMm}
            onPanChange={(next) => setPanOffsetMm(next)}
            onCanvasMove={(pt) => setCursorPos(pt)}
            roomShell={selectedRoom.roomShell}
            roomShellFillMode={selectedRoom.roomShellFillMode}
            floorMaterial={selectedRoom.floorMaterial}
            furniture={selectedRoom.furniture ?? []}
            doors={selectedRoom.doors ?? []}
            zoneLabels={deviceZoneLabels}
            devicePlacement={selectedRoom.devicePlacement}
            installationAngle={installationAngle}
            fieldOfViewDeg={selectedProfile?.limits?.fieldOfViewDegrees}
            maxRangeMeters={selectedProfile?.limits?.maxRangeMeters}
            deviceIconUrl={selectedProfile?.iconUrl}
            clipRadarToWalls={clipRadarToWalls}
            showWalls={showWalls}
            showFurniture={showFurniture}
            showDoors={showDoors}
            showZones={showZones}
            showDevice={showDeviceIcon}
            onDragStateChange={setIsDraggingZone}
            renderOverlay={({ toCanvas }) => {
              // Define colors for each target (up to 3 targets)
              const targetColors = [
                { fill: '#3b82f6', fillOpacity: 'rgba(59, 130, 246, 0.2)', name: 'Blue' },      // Target 1 - Blue
                { fill: '#10b981', fillOpacity: 'rgba(16, 185, 129, 0.2)', name: 'Green' },     // Target 2 - Green
                { fill: '#f59e0b', fillOpacity: 'rgba(245, 158, 11, 0.2)', name: 'Amber' },     // Target 3 - Amber
              ];

              // Render live target positions
              if (showTargets && targetPositions.length > 0) {
                return (
                  <g>
                    {targetPositions.map((target) => {
                      const canvasPos = toCanvas({ x: target.x, y: target.y });
                      const cx = canvasPos.x;
                      const cy = canvasPos.y;
                      const colorIndex = (target.id - 1) % targetColors.length;
                      const color = targetColors[colorIndex];

                      return (
                        <g key={target.id}>
                          {/* Outer pulsing circle */}
                          <circle
                            cx={cx}
                            cy={cy}
                            r={25}
                            fill={color.fillOpacity}
                            stroke={color.fill}
                            strokeWidth={2}
                            className="animate-pulse"
                          />
                          {/* Inner solid dot */}
                          <circle
                            cx={cx}
                            cy={cy}
                            r={10}
                            fill={color.fill}
                            stroke="white"
                            strokeWidth={2}
                          />
                          {/* Target ID label */}
                          <text
                            x={cx}
                            y={cy - 35}
                            textAnchor="middle"
                            fill="white"
                            fontSize="12"
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
          <div className="absolute top-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur px-4 py-2.5 text-sm text-slate-200 shadow-xl">
            <span className="text-slate-400 font-medium">Room:</span>
            <select
              className="rounded-lg border border-slate-700 bg-slate-800/70 px-3 py-1.5 text-slate-100 transition-colors focus:border-aqua-500 focus:ring-1 focus:ring-aqua-500/50 focus:outline-none font-medium"
              value={selectedRoomId ?? ''}
              onChange={(e) => {
                const id = e.target.value || null;
                setSelectedRoomId(id);
                const room = rooms.find((r) => r.id === id);
                setSelectedZoneId(room?.zones?.[0]?.id ?? null);
                if (room?.profileId) setSelectedProfileId(room.profileId);
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
          <div className="absolute top-24 left-6 z-40 flex flex-col gap-2">
            <button
              className="rounded-xl border border-aqua-600/50 bg-aqua-600/10 backdrop-blur px-6 py-3 text-sm font-semibold text-aqua-100 shadow-lg transition-all hover:bg-aqua-600/20 hover:shadow-xl active:scale-95"
              onClick={() => setShowZoneList(!showZoneList)}
            >
              {showZoneList ? '✕ Hide' : '☰ Show'} Zone Slots ({polygonModeStatus.enabled ? polygonZones.length : enabledZones.length}/{displayZones.length})
            </button>

            {/* Polygon Mode Toggle (only show if supported by profile AND device has the entities) */}
            {polygonModeStatus.supported && (
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
                    {polygonModeStatus.enabled ? '⬡ Polygon Mode' : '▢ Rectangle Mode'}
                    {!polygonModeStatus.enabled && polygonZonesAvailable === false && ' ⚠️'}
                  </>
                )}
              </button>
            )}

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
            <div className="absolute bottom-6 right-6 z-50 mb-[280px] w-64">
              <div className="rounded-xl border border-slate-700/50 bg-slate-900/95 backdrop-blur p-4 shadow-xl">
                <div className="text-sm font-semibold text-slate-100 mb-3">Display Settings</div>
                <div className="space-y-2.5">
                  {/* Room Element Visibility */}
                  <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Room Elements</div>
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
                      checked={showZones}
                      onChange={(e) => setShowZones(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
                    />
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded bg-blue-500/50 border border-blue-400"></span>
                      Zones
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
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-200 hover:text-white transition-colors">
                    <input
                      type="checkbox"
                      checked={showTargets}
                      onChange={(e) => setShowTargets(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-0"
                    />
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded-full bg-cyan-500"></span>
                      Targets
                    </span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* Floating Snap Controls (bottom left) */}
          <div className="absolute bottom-6 left-6 z-40 flex flex-col gap-2 rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur px-4 py-3 shadow-xl">
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
            <div className="absolute top-0 right-0 bottom-0 z-50 w-96 border-l border-slate-700 bg-slate-900/95 backdrop-blur shadow-2xl animate-in slide-in-from-right-4 fade-in duration-200 overflow-y-auto">
              <div className="sticky top-0 z-10 border-b border-slate-700 bg-slate-900/90 backdrop-blur p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-white">
                    {polygonModeStatus.enabled ? '⬡ Polygon Zones' : 'Zone Slots'}
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
                    ? `${polygonZones.length} of ${displayZones.length} slots configured`
                    : `${enabledZones.length} of ${displayZones.length} slots active`
                  }
                </div>
              </div>

              {/* Polygon Mode Zone List */}
              {polygonModeStatus.enabled ? (
                <div className="p-4 space-y-3">
                  {/* Add Zone Buttons */}
                  <div className="flex flex-wrap gap-2 pb-3 border-b border-slate-700/50">
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
                  </div>

                  {/* Polygon Zone List */}
                  {polygonZones.length === 0 ? (
                    <div className="text-center py-8 text-slate-400 text-sm">
                      No polygon zones configured.<br />
                      Use the buttons above to add zones.
                    </div>
                  ) : (
                    polygonZones.map((polygon) => {
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
        </div>
      )}
    </div>
  );
};
