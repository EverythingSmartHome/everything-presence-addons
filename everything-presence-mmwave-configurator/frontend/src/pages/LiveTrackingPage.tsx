import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { DiscoveredDevice, DeviceProfile, RoomConfig, LiveState, ZonePolygon } from '../api/types';
import { fetchDevices, fetchProfiles, ingressAware } from '../api/client';
import { fetchRooms, updateRoom } from '../api/rooms';
import { fetchZonesFromDevice, fetchPolygonModeStatus, fetchPolygonZonesFromDevice, PolygonModeStatus } from '../api/zones';
import { ZoneCanvas } from '../components/ZoneCanvas';
import { EP1DistanceArc } from '../components/EP1DistanceArc';
import {
  EP1SensorComparisonPanel,
  EP1ActivityLog,
  EP1MiniCharts,
  EP1StatsPanel,
} from '../components/ep1';
import { DeviceSettingsModal } from '../components/DeviceSettingsModal';
import { HeatmapOverlay } from '../components/HeatmapOverlay';
import { ZoneStatsPanel } from '../components/ZoneStatsPanel';
import { HourlyActivityChart } from '../components/HourlyActivityChart';
import { ThemeSwitcher } from '../components/ThemeSwitcher';
import { useDisplaySettings } from '../hooks/useDisplaySettings';
import { useHeatmap } from '../hooks/useHeatmap';

// Recording mode trail point
interface RecordedPoint {
  x: number;
  y: number;
  targetId: number;
  timestamp: number;
}

interface LiveTrackingPageProps {
  onBack?: () => void;
  onNavigate?: (view: 'wizard' | 'zoneEditor' | 'roomBuilder' | 'settings' | 'liveDashboard') => void;
  initialRoomId?: string | null;
  initialProfileId?: string | null;
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

export const LiveTrackingPage: React.FC<LiveTrackingPageProps> = ({
  onBack,
  onNavigate,
  initialRoomId,
  initialProfileId,
  liveState: propLiveState,
  targetPositions: propTargetPositions = [],
  onRoomChange
}) => {
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [profiles, setProfiles] = useState<DeviceProfile[]>([]);
  const [rooms, setRooms] = useState<RoomConfig[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(initialRoomId ?? null);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(initialProfileId ?? null);
  const liveState = propLiveState;
  const [showNavMenu, setShowNavMenu] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rangeMm, setRangeMm] = useState(15000);
  const [snapGridMm, setSnapGridMm] = useState(100);
  const [zoom, setZoom] = useState(1.1);
  const [panOffsetMm, setPanOffsetMm] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [showMaxDistanceOverlay, setShowMaxDistanceOverlay] = useState(true);
  const [showTriggerDistanceOverlay, setShowTriggerDistanceOverlay] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [smoothTracking, setSmoothTracking] = useState(true);
  const [showTrails, setShowTrails] = useState(false);
  const [trailHistory, setTrailHistory] = useState<Map<number, Array<{ x: number; y: number; timestamp: number }>>>(new Map());
  const [animatedPositions, setAnimatedPositions] = useState<Map<number, { x: number; y: number }>>(new Map());
  // Recording mode state - permanent trail capture
  const [isRecording, setIsRecording] = useState(false);
  const [recordedTrail, setRecordedTrail] = useState<RecordedPoint[]>([]);
  const [showDetailedTracking, setShowDetailedTracking] = useState(false);
  const [showDeviceSettings, setShowDeviceSettings] = useState(false);
  const [showRecommendations, setShowRecommendations] = useState(false);
  // Polygon mode state
  const [polygonModeStatus, setPolygonModeStatus] = useState<PolygonModeStatus>({ supported: false, enabled: false });
  const [polygonZones, setPolygonZones] = useState<ZonePolygon[]>([]);
  // Display settings (persisted to localStorage) - includes heatmap settings
  const {
    showWalls, setShowWalls,
    showFurniture, setShowFurniture,
    showDoors, setShowDoors,
    showZones, setShowZones,
    showDeviceIcon, setShowDeviceIcon,
    showDeviceRadar, setShowDeviceRadar,
    clipRadarToWalls, setClipRadarToWalls,
    heatmapEnabled, setHeatmapEnabled,
    heatmapHours, setHeatmapHours,
    heatmapThreshold, setHeatmapThreshold,
  } = useDisplaySettings();

  const selectedRoom = useMemo(
    () => (selectedRoomId ? rooms.find((r) => r.id === selectedRoomId) ?? null : null),
    [rooms, selectedRoomId],
  );

  const selectedProfile = useMemo(
    () => profiles.find((p) => p.id === (selectedRoom?.profileId ?? selectedProfileId)) ?? null,
    [profiles, selectedRoom, selectedProfileId],
  );

  // Check if the selected room is using EP1
  const isEP1 = selectedRoom?.profileId === 'everything_presence_one';

  // Check if device supports tracking (EP Lite only for heatmap)
  const supportsHeatmap = selectedProfile?.capabilities &&
    (selectedProfile.capabilities as { tracking?: boolean }).tracking === true && !isEP1;

  // Derive entityNamePrefix for heatmap
  const entityNamePrefix = useMemo(() => {
    if (selectedRoom?.entityNamePrefix) return selectedRoom.entityNamePrefix;
    const device = devices.find(d => d.id === selectedRoom?.deviceId);
    return device?.entityNamePrefix ?? null;
  }, [selectedRoom, devices]);

  // Heatmap data
  const { data: heatmapData, loading: heatmapLoading, refresh: refreshHeatmap } = useHeatmap({
    deviceId: selectedRoom?.deviceId ?? null,
    profileId: selectedRoom?.profileId ?? null,
    entityNamePrefix,
    entityMappings: selectedRoom?.entityMappings,
    hours: heatmapHours,
    enabled: heatmapEnabled && !!supportsHeatmap,
  });

  useEffect(() => {
    const load = async () => {
      try {
        const [devicesRes, profilesRes, roomsRes] = await Promise.all([
          fetchDevices(),
          fetchProfiles(),
          fetchRooms(),
        ]);
        setDevices(devicesRes.devices);
        setProfiles(profilesRes.profiles);
        setRooms(roomsRes.rooms);

        let roomId = selectedRoomId;
        let profileId = selectedProfileId;

        if (!roomId && roomsRes.rooms.length > 0) {
          roomId = roomsRes.rooms[0].id;
          setSelectedRoomId(roomId);
        }
        if (!profileId && profilesRes.profiles.length > 0) {
          profileId = profilesRes.profiles[0].id;
          setSelectedProfileId(profileId);
        }

        // Notify parent of initial selection
        if (roomId || profileId) {
          onRoomChange?.(roomId, profileId);
        }

        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // Update trail history when target positions change
  useEffect(() => {
    if (!showTrails) {
      return;
    }

    const targets = propTargetPositions ?? [];
    if (targets.length === 0) {
      return;
    }

    const now = Date.now();
    const maxTrailAge = 5000; // Keep trails for 5 seconds
    const maxTrailPoints = 20; // Maximum number of points per trail

    setTrailHistory((prev) => {
      const updated = new Map(prev);

      // Add new positions for each target
      targets.forEach((target) => {
        const existingTrail = updated.get(target.id) || [];
        const newPoint = { x: target.x, y: target.y, timestamp: now };

        // Add new point and filter out old points
        const updatedTrail = [...existingTrail, newPoint]
          .filter((point) => now - point.timestamp < maxTrailAge)
          .slice(-maxTrailPoints);

        updated.set(target.id, updatedTrail);
      });

      // Remove trails for targets that no longer exist
      const currentTargetIds = new Set(targets.map((t) => t.id));
      for (const targetId of updated.keys()) {
        if (!currentTargetIds.has(targetId)) {
          updated.delete(targetId);
        }
      }

      return updated;
    });
  }, [propTargetPositions, showTrails]);

  // Recording mode - capture permanent trail while recording
  useEffect(() => {
    if (!isRecording) {
      return;
    }

    const targets = propTargetPositions ?? [];
    if (targets.length === 0) {
      return;
    }

    const now = Date.now();
    const minDistanceMm = 50; // Only record if moved at least 50mm from last point

    setRecordedTrail((prev) => {
      const newPoints: RecordedPoint[] = [];

      targets.forEach((target) => {
        // Find the last recorded point for this target
        const lastPoint = prev.slice().reverse().find((p) => p.targetId === target.id);

        // Only add if moved enough distance (reduces noise and storage)
        if (!lastPoint) {
          newPoints.push({ x: target.x, y: target.y, targetId: target.id, timestamp: now });
        } else {
          const dx = target.x - lastPoint.x;
          const dy = target.y - lastPoint.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance >= minDistanceMm) {
            newPoints.push({ x: target.x, y: target.y, targetId: target.id, timestamp: now });
          }
        }
      });

      return newPoints.length > 0 ? [...prev, ...newPoints] : prev;
    });
  }, [propTargetPositions, isRecording]);

  // Smooth tracking animation with requestAnimationFrame
  useEffect(() => {
    const targets = propTargetPositions ?? [];

    if (!smoothTracking) {
      // If smooth tracking is disabled, just use actual positions
      const directPositions = new Map<number, { x: number; y: number }>();
      targets.forEach((target) => {
        directPositions.set(target.id, { x: target.x, y: target.y });
      });
      setAnimatedPositions(directPositions);
      return;
    }

    let animationFrameId: number;

    const animate = () => {
      setAnimatedPositions((prev) => {
        const updated = new Map(prev);
        const smoothingFactor = 0.15; // Higher = snappier (0-1)

        targets.forEach((target) => {
          const current = updated.get(target.id);

          if (!current) {
            // First time seeing this target - initialize at actual position
            updated.set(target.id, { x: target.x, y: target.y });
          } else {
            // Interpolate smoothly toward target position
            const dx = target.x - current.x;
            const dy = target.y - current.y;

            updated.set(target.id, {
              x: current.x + dx * smoothingFactor,
              y: current.y + dy * smoothingFactor,
            });
          }
        });

        // Remove targets that no longer exist
        const currentTargetIds = new Set(targets.map((t) => t.id));
        for (const targetId of updated.keys()) {
          if (!currentTargetIds.has(targetId)) {
            updated.delete(targetId);
          }
        }

        return updated;
      });

      animationFrameId = requestAnimationFrame(animate);
    };

    animationFrameId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [propTargetPositions, smoothTracking]);

  // Fetch existing zones from device when room is loaded
  useEffect(() => {
    const loadZonesFromDevice = async () => {
      if (!selectedRoom || !selectedRoom.deviceId || !selectedRoom.profileId) {
        return;
      }

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
        const deviceZones = await fetchZonesFromDevice(
          selectedRoom.deviceId,
          selectedRoom.profileId,
          entityNamePrefix,
          selectedRoom.entityMappings
        );

        // Always sync device zones to local storage (device is source of truth)
        const updatedRoom = { ...selectedRoom, zones: deviceZones };

        // Update local state
        setRooms((prev) => prev.map((r) =>
          r.id === selectedRoom.id ? updatedRoom : r
        ));

        // Persist to add-on storage to keep it in sync with device
        await updateRoom(selectedRoom.id, { zones: deviceZones });
      } catch (err) {
        // Silently fail - it's okay if device has no zones configured
      }
    };

    loadZonesFromDevice();
  }, [selectedRoom?.id, selectedRoom?.deviceId, selectedRoom?.profileId, selectedRoom?.entityNamePrefix, selectedRoom?.entityMappings, devices]);

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
        const status = await fetchPolygonModeStatus(
          selectedRoom.deviceId,
          selectedRoom.profileId,
          entityNamePrefix,
          selectedRoom.entityMappings
        );
        setPolygonModeStatus(status);
      } catch (err) {
        setPolygonModeStatus({ supported: false, enabled: false });
      }
    };

    loadPolygonModeStatus();
  }, [selectedRoom?.id, selectedRoom?.deviceId, selectedRoom?.profileId, selectedRoom?.entityNamePrefix, selectedRoom?.entityMappings, devices]);

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
        const zones = await fetchPolygonZonesFromDevice(
          selectedRoom.deviceId,
          selectedRoom.profileId,
          entityNamePrefix,
          selectedRoom.entityMappings
        );
        setPolygonZones(zones);
      } catch (err) {
        setPolygonZones([]);
      }
    };

    loadPolygonZones();
  }, [polygonModeStatus.enabled, selectedRoom?.id, selectedRoom?.deviceId, selectedRoom?.profileId, selectedRoom?.entityNamePrefix, selectedRoom?.entityMappings, devices]);

  const handleAutoZoom = useCallback(() => {
    if (!selectedRoom || !selectedRoom.roomShell || !selectedRoom.roomShell.points.length) {
      setZoom(1.1);
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
    const pad = 500;
    const width = Math.max(100, maxX - minX + pad * 2);
    const height = Math.max(100, maxY - minY + pad * 2);
    const maxDim = Math.max(width, height);
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

  // Calculate distance indicator position (for EP One)
  const distanceIndicatorPos = useMemo(() => {
    if (!liveState || liveState.distance === null || liveState.distance === undefined) {
      return null;
    }
    if (!selectedRoom?.devicePlacement) {
      return null;
    }

    // Convert distance (in meters) to mm
    const distanceMm = liveState.distance * 1000;

    // Calculate position based on device rotation
    const { x, y, rotationDeg } = selectedRoom.devicePlacement;
    const angleRad = (rotationDeg * Math.PI) / 180;

    return {
      x: x + distanceMm * Math.sin(angleRad),
      y: y + distanceMm * Math.cos(angleRad),
    };
  }, [liveState, selectedRoom]);

  // Use target positions from props (type assertion needed because of default [] value)
  const targetPositions = (propTargetPositions || []) as Array<{
    id: number;
    x: number;
    y: number;
    distance: number | null;
    speed: number | null;
    angle: number | null;
  }>;

  return (
    <div className="fixed inset-0 bg-slate-950 overflow-hidden">
      {/* Error Toast */}
      {error && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-50 max-w-lg rounded-xl border border-rose-500/50 bg-rose-500/10 backdrop-blur px-6 py-3 text-rose-100 shadow-xl animate-in slide-in-from-top-4 fade-in">
          {error}
        </div>
      )}

      {/* Entity Sync Nudge Banner - shown for rooms with device but no entity mappings */}
      {/* Positioned below the Room selector dropdown (top-20) */}
      {selectedRoom && selectedRoom.deviceId && !selectedRoom.entityMappings && onNavigate && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 max-w-xl rounded-xl border border-yellow-500/50 bg-yellow-500/10 backdrop-blur px-5 py-2.5 shadow-xl animate-in slide-in-from-top-4 fade-in">
          <div className="flex items-center gap-3">
            <span className="text-yellow-400">⚠</span>
            <p className="text-xs text-yellow-100">
              Entity mappings not configured.{' '}
              <button
                onClick={() => onNavigate('settings')}
                className="underline hover:text-yellow-50 font-medium"
              >
                Re-sync in Settings
              </button>
            </p>
          </div>
        </div>
      )}

      {/* Navigation (top left) */}
      {onBack && (
        <button
          onClick={onBack}
          className="absolute top-6 left-6 z-40 group rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur px-4 py-2.5 text-sm font-semibold text-slate-100 shadow-lg transition-all hover:border-slate-600 hover:bg-slate-800 hover:shadow-xl active:scale-95"
        >
          <span className="inline-block transition-transform group-hover:-translate-x-0.5">←</span> Back
        </button>
      )}

      {!onBack && onNavigate && (
        <div className="absolute top-6 left-6 z-40">
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
                      onNavigate('wizard');
                      setShowNavMenu(false);
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm font-medium text-slate-100 rounded-lg transition-all hover:bg-aqua-600/20 hover:text-aqua-400 active:scale-95"
                  >
                    ➕ Add Device
                  </button>
                  <button
                    onClick={() => {
                      if (!isEP1) {
                        onNavigate('zoneEditor');
                        setShowNavMenu(false);
                      }
                    }}
                    disabled={isEP1}
                    className={`w-full text-left px-4 py-2.5 text-sm font-medium rounded-lg transition-all ${
                      isEP1
                        ? 'text-slate-500 cursor-not-allowed'
                        : 'text-slate-100 hover:bg-aqua-600/20 hover:text-aqua-400 active:scale-95'
                    }`}
                    title={isEP1 ? 'Zone editor is not available for EP1 (distance-only tracking)' : ''}
                  >
                    📐 Zone Editor {isEP1 && '(Not Available)'}
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

      {/* Canvas Content - Full Page */}
      {loading && (
        <div className="flex h-full w-full items-center justify-center">
          <div className="max-w-md rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-900 to-slate-800 p-8 shadow-2xl">
            <div className="text-center space-y-4">
              <div className="text-6xl animate-pulse">📡</div>
              <h2 className="text-2xl font-bold text-white">Loading...</h2>
            </div>
          </div>
        </div>
      )}

      {!loading && !selectedRoom && (
        <div className="flex h-full w-full items-center justify-center">
          <div className="max-w-md rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-900 to-slate-800 p-8 shadow-2xl">
            <div className="text-center space-y-4">
              <div className="text-6xl">📂</div>
              <h2 className="text-2xl font-bold text-white">No Room Selected</h2>
              <p className="text-sm text-slate-300">Select a room to view live tracking data.</p>
            </div>
          </div>
        </div>
      )}

      {!loading && selectedRoom && (
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
          <ZoneCanvas
            zones={selectedRoom.zones ?? []}
            onZonesChange={() => {}}
            // Polygon zones support - show polygon zones when polygon mode is enabled
            polygonZones={polygonZones}
            onPolygonZonesChange={() => {}}
            polygonMode={polygonModeStatus.enabled}
            selectedId={null}
            onSelect={() => {}}
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
            devicePlacement={selectedRoom.devicePlacement}
            fieldOfViewDeg={selectedProfile?.limits?.fieldOfViewDegrees}
            maxRangeMeters={selectedProfile?.limits?.maxRangeMeters}
            deviceIconUrl={selectedProfile?.iconUrl}
            clipRadarToWalls={clipRadarToWalls}
            showRadar={showDeviceRadar}
            furniture={selectedRoom.furniture ?? []}
            doors={selectedRoom.doors ?? []}
            showWalls={showWalls}
            showFurniture={showFurniture}
            showDoors={showDoors}
            showZones={showZones}
            showDevice={showDeviceIcon}
            renderOverlay={({ toCanvas, roomShellPoints, devicePlacement: devicePlacementFromCanvas, fieldOfViewDeg }) => {
              // Heatmap overlay (renders behind everything else)
              // Pass devicePlacement to transform device-relative coordinates to room coordinates
              const heatmapOverlay = (
                <HeatmapOverlay data={heatmapData} visible={heatmapEnabled} toCanvas={toCanvas} devicePlacement={selectedRoom?.devicePlacement} intensityThreshold={heatmapThreshold} roomShellPoints={roomShellPoints} />
              );

              // Define colors for each target (up to 3 targets)
              const targetColors = [
                { fill: '#3b82f6', fillOpacity: 'rgba(59, 130, 246, 0.2)', name: 'Blue' },      // Target 1 - Blue
                { fill: '#10b981', fillOpacity: 'rgba(16, 185, 129, 0.2)', name: 'Green' },     // Target 2 - Green
                { fill: '#f59e0b', fillOpacity: 'rgba(245, 158, 11, 0.2)', name: 'Amber' },     // Target 3 - Amber
              ];

              // Render recorded trail (permanent path while recording)
              const recordedTrailOverlay = recordedTrail.length > 0 ? (
                <g className="recorded-trail">
                  {/* Group points by target and render paths */}
                  {[1, 2, 3].map((targetId) => {
                    const points = recordedTrail.filter((p) => p.targetId === targetId);
                    if (points.length < 2) return null;

                    const colorIndex = (targetId - 1) % targetColors.length;
                    const color = targetColors[colorIndex];

                    // Convert to canvas coordinates
                    const canvasPoints = points.map((p) => toCanvas({ x: p.x, y: p.y }));
                    const pathD = canvasPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ');

                    return (
                      <g key={`recorded-${targetId}`}>
                        {/* Main path line */}
                        <path
                          d={pathD}
                          fill="none"
                          stroke={color.fill}
                          strokeWidth={3}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          opacity={0.7}
                        />
                        {/* Path dots at each recorded point */}
                        {canvasPoints.map((p, idx) => (
                          <circle
                            key={idx}
                            cx={p.x}
                            cy={p.y}
                            r={4}
                            fill={color.fill}
                            opacity={0.5}
                          />
                        ))}
                        {/* Start marker */}
                        <circle
                          cx={canvasPoints[0].x}
                          cy={canvasPoints[0].y}
                          r={8}
                          fill="none"
                          stroke={color.fill}
                          strokeWidth={2}
                          opacity={0.9}
                        />
                        <text
                          x={canvasPoints[0].x + 12}
                          y={canvasPoints[0].y + 4}
                          fontSize={10}
                          fill={color.fill}
                          fontWeight="bold"
                        >
                          START
                        </text>
                      </g>
                    );
                  })}
                </g>
              ) : null;

              // Render live target positions (EP Lite with tracking)
              const targetElements = targetPositions.length > 0 ? (
                <g>
                  {/* Render trails first (so they appear behind targets) */}
                  {showTrails && targetPositions.map((target) => {
                    const trail = trailHistory.get(target.id) || [];
                    if (trail.length < 2) return null;

                    const colorIndex = (target.id - 1) % targetColors.length;
                    const color = targetColors[colorIndex];

                    // Convert trail points to canvas coordinates
                    const canvasTrail = trail.map((point) => toCanvas({ x: point.x, y: point.y }));

                    // Create path string for polyline
                    const pathPoints = canvasTrail.map((p) => `${p.x},${p.y}`).join(' ');

                    const now = Date.now();
                    return (
                      <g key={`trail-${target.id}`}>
                        {/* Draw individual circles with fading opacity */}
                        {canvasTrail.map((point, idx) => {
                          const age = now - trail[idx].timestamp;
                          const opacity = Math.max(0.1, 1 - age / 5000); // Fade over 5 seconds
                          const radius = 3 + (1 - age / 5000) * 2; // Size decreases with age
                          return (
                            <circle
                              key={idx}
                              cx={point.x}
                              cy={point.y}
                              r={radius}
                              fill={color.fill}
                              opacity={opacity * 0.6}
                            />
                          );
                        })}
                        {/* Draw connecting line */}
                        <polyline
                          points={pathPoints}
                          fill="none"
                          stroke={color.fill}
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          opacity={0.3}
                        />
                      </g>
                    );
                  })}

                  {/* Render target markers */}
                  {targetPositions.map((target) => {
                    // Use animated positions if smooth tracking is enabled
                    const animatedPos = animatedPositions.get(target.id);
                    const renderPos = animatedPos || { x: target.x, y: target.y };

                    const canvasPos = toCanvas(renderPos);
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
              ) : null;

              // Render distance arcs for EP One (distance-only devices)
              if (selectedProfile?.capabilities?.distanceOnlyTracking && selectedRoom?.devicePlacement) {
                const maxDistanceMeters = liveState?.config?.distanceMax ?? 25;
                const triggerDistanceMeters = liveState?.config?.triggerDistance ?? null;

                return (
                  <g>
                    {/* Max Distance Arc (blue) */}
                    {showMaxDistanceOverlay && (
                      <EP1DistanceArc
                        distance={maxDistanceMeters}
                        devicePlacement={selectedRoom.devicePlacement}
                        toCanvas={toCanvas}
                        rangeMm={rangeMm}
                        fieldOfViewDeg={120}
                        color="#3b82f6"
                        fillOpacity={0.08}
                        strokeOpacity={0.3}
                        showLabel={true}
                        labelText={`Max: ${maxDistanceMeters}m`}
                        roomShellPoints={roomShellPoints}
                        clipToWalls={clipRadarToWalls}
                      />
                    )}

                    {/* Trigger Distance Arc (amber) */}
                    {showTriggerDistanceOverlay && triggerDistanceMeters && triggerDistanceMeters > 0 && (
                      <EP1DistanceArc
                        distance={triggerDistanceMeters}
                        devicePlacement={selectedRoom.devicePlacement}
                        toCanvas={toCanvas}
                        rangeMm={rangeMm}
                        fieldOfViewDeg={120}
                        color="#f59e0b"
                        fillOpacity={0.10}
                        strokeOpacity={0.4}
                        showLabel={true}
                        labelText={`Trigger: ${triggerDistanceMeters}m`}
                        roomShellPoints={roomShellPoints}
                        clipToWalls={clipRadarToWalls}
                      />
                    )}

                    {/* Current Distance Indicator (cyan) */}
                    {liveState?.distance != null && liveState.distance > 0 && (
                      <EP1DistanceArc
                        distance={liveState.distance}
                        devicePlacement={selectedRoom.devicePlacement}
                        toCanvas={toCanvas}
                        rangeMm={rangeMm}
                        fieldOfViewDeg={120}
                        color="#06b6d4"
                        fillOpacity={0.15}
                        strokeOpacity={0.6}
                        showLabel={true}
                        labelText={`${liveState.distance.toFixed(2)}m`}
                        showPulse={true}
                        roomShellPoints={roomShellPoints}
                        clipToWalls={clipRadarToWalls}
                      />
                    )}
                  </g>
                );
              }

              // Render distance arcs for EPL (tracking devices)
              if (selectedProfile?.capabilities?.tracking && !selectedProfile?.capabilities?.distanceOnlyTracking && selectedRoom?.devicePlacement) {
                const maxDistanceMeters = liveState?.config?.distanceMax;
                const installationAngle = liveState?.config?.installationAngle ?? 0;

                // EPL configurable max distance (from number.${name}_distance entity)
                return (
                  <g>
                    {/* Heatmap (renders behind everything) */}
                    {heatmapOverlay}

                    {/* Recorded trail (permanent path) */}
                    {recordedTrailOverlay}

                    {/* Targets (if any) */}
                    {targetElements}

                    {/* Max Distance Arc */}
                    {showMaxDistanceOverlay && maxDistanceMeters != null && maxDistanceMeters > 0 && (
                      <EP1DistanceArc
                        distance={maxDistanceMeters / 100} // Convert cm to meters
                        devicePlacement={selectedRoom.devicePlacement}
                        toCanvas={toCanvas}
                        rangeMm={rangeMm}
                        fieldOfViewDeg={selectedProfile.limits?.fieldOfViewDegrees ?? 120}
                        color="#3b82f6"
                        fillOpacity={0.08}
                        strokeOpacity={0.3}
                        showLabel={true}
                        labelText={`Max: ${(maxDistanceMeters / 100).toFixed(2)}m`}
                        roomShellPoints={roomShellPoints}
                        clipToWalls={clipRadarToWalls}
                      />
                    )}

                    {/* Installation Angle Indicator - shows physical sensor direction */}
                    {installationAngle !== 0 && (() => {
                      const devicePos = toCanvas({ x: selectedRoom.devicePlacement.x, y: selectedRoom.devicePlacement.y });
                      // Device rotation + 90 (so 0° points down/forward) + installation angle offset
                      const physicalAngleRad = ((selectedRoom.devicePlacement.rotationDeg ?? 0) + 90 + installationAngle) * Math.PI / 180;
                      const lineLength = 80; // pixels
                      const endX = devicePos.x + Math.cos(physicalAngleRad) * lineLength;
                      const endY = devicePos.y + Math.sin(physicalAngleRad) * lineLength;

                      // Arrow head
                      const arrowSize = 8;
                      const arrowAngle1 = physicalAngleRad + Math.PI * 0.85;
                      const arrowAngle2 = physicalAngleRad - Math.PI * 0.85;
                      const arrow1X = endX + Math.cos(arrowAngle1) * arrowSize;
                      const arrow1Y = endY + Math.sin(arrowAngle1) * arrowSize;
                      const arrow2X = endX + Math.cos(arrowAngle2) * arrowSize;
                      const arrow2Y = endY + Math.sin(arrowAngle2) * arrowSize;

                      return (
                        <g style={{ pointerEvents: 'none' }}>
                          {/* Dashed line showing physical direction */}
                          <line
                            x1={devicePos.x}
                            y1={devicePos.y}
                            x2={endX}
                            y2={endY}
                            stroke="#f59e0b"
                            strokeWidth={2}
                            strokeDasharray="6,4"
                            opacity={0.8}
                          />
                          {/* Arrow head */}
                          <path
                            d={`M ${endX} ${endY} L ${arrow1X} ${arrow1Y} L ${arrow2X} ${arrow2Y} Z`}
                            fill="#f59e0b"
                            opacity={0.8}
                          />
                          {/* Label */}
                          <text
                            x={endX + 12}
                            y={endY + 4}
                            fontSize={11}
                            fill="#f59e0b"
                            fontWeight="600"
                          >
                            Physical ({installationAngle > 0 ? '+' : ''}{installationAngle}°)
                          </text>
                        </g>
                      );
                    })()}
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
                const newProfileId = room?.profileId ?? selectedProfileId;
                if (room?.profileId) setSelectedProfileId(room.profileId);
                onRoomChange?.(id, newProfileId);
              }}
            >
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>

          {/* Live State Info Panel (or EP1 Info Stack) */}
          <div className="absolute top-24 right-6 z-40 w-72 max-w-full flex flex-col gap-3">
            {/* Main Status Panel */}
            <div className="rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur p-4 text-sm text-slate-200 shadow-xl">
              <div className="flex items-center gap-2 mb-3">
                <div className={`w-3 h-3 rounded-full ${liveState?.presence ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'}`} />
                <span className="font-semibold text-white">{isEP1 ? 'EP1 Status' : 'Live Tracking'}</span>
              </div>

              {liveState && (
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-700/50">
                  <span className="text-slate-400">Presence:</span>
                  <span className={liveState.presence ? 'text-emerald-400' : 'text-slate-400'}>
                    {liveState.presence ? 'Detected' : 'Not detected'}
                  </span>
                </div>

                {liveState.distance !== null && liveState.distance !== undefined && (
                  <div className="flex justify-between py-1 border-b border-slate-700/50">
                    <span className="text-slate-400">Distance:</span>
                    <span className="text-aqua-400">{liveState.distance.toFixed(2)}m</span>
                  </div>
                )}

                {!isEP1 && (
                  <div className="flex justify-between py-1 border-b border-slate-700/50">
                    <span className="text-slate-400">Targets:</span>
                    <span className="text-aqua-400">{targetPositions.length}</span>
                  </div>
                )}

                {!isEP1 && polygonModeStatus.supported && (
                  <div className="flex justify-between py-1 border-b border-slate-700/50">
                    <span className="text-slate-400">Zone Mode:</span>
                    <span className={polygonModeStatus.enabled ? 'text-violet-400' : 'text-slate-300'}>
                      {polygonModeStatus.enabled ? '⬡ Polygon' : '▢ Rectangle'}
                    </span>
                  </div>
                )}

                {!isEP1 && liveState.config?.installationAngle !== undefined && liveState.config.installationAngle !== 0 && (
                  <div className="flex justify-between py-1 border-b border-slate-700/50">
                    <span className="text-slate-400">Install Angle:</span>
                    <span className="text-amber-400">{liveState.config.installationAngle}°</span>
                  </div>
                )}

                {/* Assumed Present indicator - show in main status for EPL */}
                {!isEP1 && liveState.assumedPresent !== undefined && (
                  <div className="flex justify-between py-1 border-b border-slate-700/50">
                    <span className="text-slate-400">Assumed Present:</span>
                    <span className={liveState.assumedPresent ? 'text-amber-400 font-medium' : 'text-slate-500'}>
                      {liveState.assumedPresent
                        ? `Active${liveState.assumedPresentRemaining !== undefined ? ` (${Math.round(liveState.assumedPresentRemaining)}s)` : ''}`
                        : 'Inactive'}
                    </span>
                  </div>
                )}

                {isEP1 && liveState.mmwave !== undefined && (
                  <div className="flex justify-between py-1 border-b border-slate-700/50">
                    <span className="text-slate-400">mmWave:</span>
                    <span className={liveState.mmwave ? 'text-emerald-400' : 'text-slate-400'}>
                      {liveState.mmwave ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                )}

                {liveState.pir !== undefined && (
                  <div className="flex justify-between py-1 border-b border-slate-700/50">
                    <span className="text-slate-400">PIR:</span>
                    <span className={liveState.pir ? 'text-emerald-400' : 'text-slate-400'}>
                      {liveState.pir ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                )}

                {liveState.illuminance !== null && liveState.illuminance !== undefined && (
                  <div className="flex justify-between py-1 border-b border-slate-700/50">
                    <span className="text-slate-400">Light:</span>
                    <span className="text-slate-200">{liveState.illuminance.toFixed(1)} lx</span>
                  </div>
                )}

                {liveState.temperature !== null && liveState.temperature !== undefined && (
                  <div className="flex justify-between py-1 border-b border-slate-700/50">
                    <span className="text-slate-400">Temperature:</span>
                    <span className="text-slate-200">{liveState.temperature.toFixed(1)}°C</span>
                  </div>
                )}

                {liveState.co2 !== null && liveState.co2 !== undefined && (
                  <div className="flex justify-between py-1 border-b border-slate-700/50">
                    <span className="text-slate-400">CO₂:</span>
                    <span className={
                      liveState.co2 < 800 ? 'text-emerald-400' :
                      liveState.co2 < 1000 ? 'text-lime-400' :
                      liveState.co2 < 1500 ? 'text-amber-400' :
                      liveState.co2 < 2000 ? 'text-orange-400' :
                      'text-rose-400'
                    }>
                      {Math.round(liveState.co2)} ppm
                    </span>
                  </div>
                )}

                {/* Legend - only for EPL (zones and targets) */}
                {!isEP1 && (
                  <div className="mt-3 pt-3 border-t border-slate-700/50 space-y-2">
                    {/* Targets */}
                    <div className="flex items-center gap-3">
                      {[
                        { id: 1, color: '#3b82f6', name: 'Target 1' },
                        { id: 2, color: '#10b981', name: 'Target 2' },
                        { id: 3, color: '#f59e0b', name: 'Target 3' },
                      ].map(target => (
                        <div key={target.id} className="flex items-center gap-1.5 text-xs">
                          <div
                            className="w-3 h-3 rounded-full border border-white/50"
                            style={{ backgroundColor: target.color }}
                          />
                          <span className="text-slate-200">{target.name}</span>
                        </div>
                      ))}
                    </div>

                    {/* Regular Zones - show colors for zones in current room */}
                    {/* Show polygon zones when polygon mode is enabled, otherwise show rectangle zones */}
                    {polygonModeStatus.enabled ? (
                      // Polygon zones legend
                      polygonZones.filter(z => z.type === 'regular').length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 text-[11px]">
                          {(() => {
                            const regularZoneColors = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#06b6d4'];
                            const regularZones = polygonZones.filter(z => z.type === 'regular');

                            return regularZones.map((zone, index) => (
                              <div key={zone.id} className="flex items-center gap-1.5">
                                <div
                                  className="w-3 h-3 rounded border border-white/50"
                                  style={{ backgroundColor: regularZoneColors[index % regularZoneColors.length] }}
                                />
                                <span className="text-slate-300">{zone.label || zone.id}</span>
                              </div>
                            ));
                          })()}
                        </div>
                      )
                    ) : (
                      // Rectangle zones legend
                      selectedRoom?.zones && selectedRoom.zones.filter(z => z.type === 'regular').length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 text-[11px]">
                          {(() => {
                            const regularZoneColors = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#06b6d4'];
                            const regularZones = selectedRoom.zones.filter(z => z.type === 'regular');

                            return regularZones.map((zone, index) => (
                              <div key={zone.id} className="flex items-center gap-1.5">
                                <div
                                  className="w-3 h-3 rounded border border-white/50"
                                  style={{ backgroundColor: regularZoneColors[index % regularZoneColors.length] }}
                                />
                                <span className="text-slate-300">{zone.label || zone.id}</span>
                              </div>
                            ));
                          })()}
                        </div>
                      )
                    )}

                    {/* Zone Types */}
                    <div className="flex items-center gap-3 text-[11px]">
                      <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded border border-white/50" style={{ backgroundColor: '#10b981' }} />
                        <span className="text-slate-300">Entry</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded border border-white/50" style={{ backgroundColor: '#f43f5e' }} />
                        <span className="text-slate-300">Exclusion</span>
                      </div>
                    </div>
                  </div>
                )}

                <div className="mt-3 pt-2 border-t border-slate-700/50 flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">
                    Last updated: {new Date(liveState.timestamp).toLocaleTimeString()}
                  </span>
                  {/* Toggle button for detailed tracking (EPL only) */}
                  {!isEP1 && (
                    <button
                      onClick={() => setShowDetailedTracking(!showDetailedTracking)}
                      className="w-5 h-5 flex items-center justify-center rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-400 hover:text-slate-200 transition-colors text-xs font-bold"
                      title={showDetailedTracking ? 'Hide detailed tracking' : 'Show detailed tracking'}
                    >
                      {showDetailedTracking ? '−' : '+'}
                    </button>
                  )}
                </div>

                {/* Expandable Detailed Tracking Panel (EPL only) */}
                {!isEP1 && showDetailedTracking && (
                  <div className="mt-3 pt-3 border-t border-slate-700/50 space-y-3">
                    {/* Target Details */}
                    <div>
                      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Target Details</div>
                      <div className="space-y-2">
                        {[1, 2, 3].map((targetId) => {
                          const target = liveState?.targets?.find((t: { id: number }) => t.id === targetId);
                          const isActive = target?.active || (target?.x !== null && target?.x !== undefined && target.x !== 0);
                          const targetColors = ['#3b82f6', '#10b981', '#f59e0b'];

                          return (
                            <div key={targetId} className="bg-slate-800/50 rounded-lg p-2">
                              <div className="flex items-center gap-2 mb-1.5">
                                <div
                                  className="w-2.5 h-2.5 rounded-full"
                                  style={{ backgroundColor: isActive ? targetColors[targetId - 1] : '#475569' }}
                                />
                                <span className={`text-[11px] font-medium ${isActive ? 'text-slate-200' : 'text-slate-500'}`}>
                                  Target {targetId}
                                </span>
                                <span className={`text-[9px] px-1.5 py-0.5 rounded ${isActive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-500'}`}>
                                  {isActive ? 'ACTIVE' : 'INACTIVE'}
                                </span>
                              </div>
                              {isActive && target && (
                                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
                                  <div className="flex justify-between">
                                    <span className="text-slate-500">X:</span>
                                    <span className="text-slate-300 font-mono">{target.x?.toFixed(0) ?? '—'} mm</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-slate-500">Y:</span>
                                    <span className="text-slate-300 font-mono">{target.y?.toFixed(0) ?? '—'} mm</span>
                                  </div>
                                  {target.distance !== null && target.distance !== undefined && (
                                    <div className="flex justify-between">
                                      <span className="text-slate-500">Dist:</span>
                                      <span className="text-slate-300 font-mono">{target.distance.toFixed(0)} mm</span>
                                    </div>
                                  )}
                                  {target.speed !== null && target.speed !== undefined && (
                                    <div className="flex justify-between">
                                      <span className="text-slate-500">Speed:</span>
                                      <span className="text-slate-300 font-mono">{target.speed.toFixed(2)} m/s</span>
                                    </div>
                                  )}
                                  {target.angle !== null && target.angle !== undefined && (
                                    <div className="flex justify-between">
                                      <span className="text-slate-500">Angle:</span>
                                      <span className="text-slate-300 font-mono">{target.angle.toFixed(0)}°</span>
                                    </div>
                                  )}
                                  {target.resolution !== null && target.resolution !== undefined && (
                                    <div className="flex justify-between">
                                      <span className="text-slate-500">Res:</span>
                                      <span className="text-slate-300 font-mono">{target.resolution.toFixed(0)} mm</span>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Zone Occupancy */}
                    <div>
                      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Zone Occupancy</div>
                      <div className="grid grid-cols-2 gap-2">
                        {[1, 2, 3, 4].map((zoneNum) => {
                          const zoneKey = `zone${zoneNum}` as 'zone1' | 'zone2' | 'zone3' | 'zone4';
                          const isOccupied = liveState?.zoneOccupancy?.[zoneKey] ?? false;
                          const regularZoneColors = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b'];
                          // Find the matching zone to get its label
                          const matchingZone = selectedRoom?.zones?.find(z => z.id === `Zone ${zoneNum}` || z.id === `zone${zoneNum}` || z.id === `zone_${zoneNum}`);
                          const zoneLabel = matchingZone?.label || `Zone ${zoneNum}`;

                          return (
                            <div
                              key={zoneNum}
                              className={`flex items-center gap-2 px-2 py-1.5 rounded-lg ${
                                isOccupied ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-slate-800/50 border border-slate-700/30'
                              }`}
                            >
                              <div
                                className="w-3 h-3 rounded"
                                style={{ backgroundColor: regularZoneColors[zoneNum - 1], opacity: isOccupied ? 1 : 0.3 }}
                              />
                              <span className={`text-[11px] ${isOccupied ? 'text-emerald-400 font-medium' : 'text-slate-500'}`}>
                                {zoneLabel}
                              </span>
                              <span className={`ml-auto text-[9px] ${isOccupied ? 'text-emerald-400' : 'text-slate-600'}`}>
                                {isOccupied ? '●' : '○'}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Assumed Presence Status (Entry/Exit feature) */}
                    {liveState?.assumedPresent !== undefined && (
                      <div>
                        <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Entry/Exit Status</div>
                        <div className={`flex items-center justify-between px-3 py-2 rounded-lg ${
                          liveState.assumedPresent
                            ? 'bg-amber-500/10 border border-amber-500/30'
                            : 'bg-slate-800/50 border border-slate-700/30'
                        }`}>
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${
                              liveState.assumedPresent ? 'bg-amber-400 animate-pulse' : 'bg-slate-600'
                            }`} />
                            <span className={`text-[11px] ${
                              liveState.assumedPresent ? 'text-amber-300 font-medium' : 'text-slate-500'
                            }`}>
                              Assumed Present
                            </span>
                          </div>
                          {liveState.assumedPresent && liveState.assumedPresentRemaining !== undefined && (
                            <span className="text-[11px] text-amber-400 font-mono">
                              {Math.round(liveState.assumedPresentRemaining)}s
                            </span>
                          )}
                          {!liveState.assumedPresent && (
                            <span className="text-[10px] text-slate-600">Inactive</span>
                          )}
                        </div>
                        <div className="text-[9px] text-slate-500 mt-1">
                          {liveState.assumedPresent
                            ? 'Holding presence after target disappeared'
                            : 'No assumed presence active'}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              )}

              {!liveState && (
                <div className="text-xs text-slate-400">
                  Waiting for live data...
                </div>
              )}
            </div>

            {/* CO2 Air Quality Panel - shown when CO2 sensor is available */}
            {liveState?.co2 !== null && liveState?.co2 !== undefined && (
              <div className="rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur p-4 text-sm text-slate-200 shadow-xl">
                <div className="flex items-center gap-2 mb-3">
                  <div className={`w-3 h-3 rounded-full ${
                    liveState.co2 < 800 ? 'bg-emerald-500' :
                    liveState.co2 < 1000 ? 'bg-lime-500' :
                    liveState.co2 < 1500 ? 'bg-amber-500' :
                    liveState.co2 < 2000 ? 'bg-orange-500' :
                    'bg-rose-500'
                  }`} />
                  <span className="font-semibold text-white">CO₂ Air Quality</span>
                </div>

                <div className="space-y-3">
                  {/* Large CO2 reading */}
                  <div className="text-center py-2">
                    <div className={`text-3xl font-bold ${
                      liveState.co2 < 800 ? 'text-emerald-400' :
                      liveState.co2 < 1000 ? 'text-lime-400' :
                      liveState.co2 < 1500 ? 'text-amber-400' :
                      liveState.co2 < 2000 ? 'text-orange-400' :
                      'text-rose-400'
                    }`}>
                      {Math.round(liveState.co2)}
                      <span className="text-base font-normal text-slate-400 ml-1">ppm</span>
                    </div>
                    <div className={`text-xs font-medium mt-1 ${
                      liveState.co2 < 800 ? 'text-emerald-300' :
                      liveState.co2 < 1000 ? 'text-lime-300' :
                      liveState.co2 < 1500 ? 'text-amber-300' :
                      liveState.co2 < 2000 ? 'text-orange-300' :
                      'text-rose-300'
                    }`}>
                      {liveState.co2 < 800 ? 'Excellent' :
                       liveState.co2 < 1000 ? 'Good' :
                       liveState.co2 < 1500 ? 'Fair' :
                       liveState.co2 < 2000 ? 'Poor' :
                       'Very Poor'}
                    </div>
                  </div>

                  {/* Air quality scale */}
                  <div className="h-2 rounded-full bg-gradient-to-r from-emerald-500 via-amber-500 to-rose-500 relative">
                    <div
                      className="absolute w-3 h-3 bg-white rounded-full border-2 border-slate-900 shadow-lg transform -translate-y-1/4"
                      style={{
                        left: `${Math.min(100, Math.max(0, (liveState.co2 - 400) / 20))}%`,
                      }}
                    />
                  </div>
                  <div className="flex justify-between text-[9px] text-slate-500">
                    <span>400</span>
                    <span>1200</span>
                    <span>2000+</span>
                  </div>

                  {/* Helpful tips based on level */}
                  <div className="pt-2 border-t border-slate-700/50">
                    <div className="text-[10px] text-slate-400">
                      {liveState.co2 < 800 ?
                        'Fresh air quality - optimal for concentration and wellbeing.' :
                       liveState.co2 < 1000 ?
                        'Good air quality - typical for well-ventilated spaces.' :
                       liveState.co2 < 1500 ?
                        'Consider ventilation - may cause slight drowsiness in sensitive individuals.' :
                       liveState.co2 < 2000 ?
                        'Open windows or doors - prolonged exposure may reduce concentration.' :
                        'Ventilate immediately - poor air quality affecting health and cognition.'}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* EP1 Sensor Comparison Panel */}
            {isEP1 && liveState && (
              <EP1SensorComparisonPanel
                presence={liveState.presence ?? false}
                mmwave={liveState.mmwave ?? false}
                pir={liveState.pir ?? false}
              />
            )}

            {/* EP1 Mini Charts */}
            {isEP1 && liveState && (
              <EP1MiniCharts
                temperature={liveState.temperature ?? null}
                presence={liveState.presence ?? false}
                distance={liveState.distance ?? null}
              />
            )}

            {/* EP1 Activity Log */}
            {isEP1 && liveState && (
              <EP1ActivityLog
                presence={liveState.presence ?? false}
                mmwave={liveState.mmwave ?? false}
                pir={liveState.pir ?? false}
              />
            )}

            {/* EP1 Statistics Panel */}
            {isEP1 && selectedRoom && liveState && (
              <EP1StatsPanel
                deviceId={selectedRoom.deviceId || selectedRoomId || 'unknown'}
                presence={liveState.presence ?? false}
                temperature={liveState.temperature ?? null}
              />
            )}

            {/* Heatmap Zone Stats Panel (EPL only) */}
            {heatmapEnabled && heatmapData?.zoneStats && heatmapData.zoneStats.length > 0 && (
              <ZoneStatsPanel data={heatmapData} visible={heatmapEnabled} />
            )}

            {/* Hourly Activity Chart (EPL only) */}
            {heatmapEnabled && heatmapData?.hourlyBreakdown && (
              <HourlyActivityChart data={heatmapData.hourlyBreakdown} visible={heatmapEnabled} />
            )}
          </div>


          {/* Settings Panel (appears when toggled) */}
          {showSettings && (
            <div className="absolute bottom-6 right-6 z-50 w-64">
              <div className="rounded-xl border border-slate-700/50 bg-slate-900/95 backdrop-blur p-4 shadow-xl">
                <div className="text-sm font-semibold text-slate-100 mb-3">Display Settings</div>
                <div className="space-y-2.5">
                  {/* Canvas Settings Group */}
                  <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Canvas Overlays</div>

                  {/* Max Distance - common to both */}
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-200 hover:text-white transition-colors">
                    <input
                      type="checkbox"
                      checked={showMaxDistanceOverlay}
                      onChange={(e) => setShowMaxDistanceOverlay(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
                    />
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded-full bg-blue-500"></span>
                      Max Distance
                    </span>
                  </label>

                  {/* Trigger Distance - EP1 only */}
                  {isEP1 && (
                    <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-200 hover:text-white transition-colors">
                      <input
                        type="checkbox"
                        checked={showTriggerDistanceOverlay}
                        onChange={(e) => setShowTriggerDistanceOverlay(e.target.checked)}
                        className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-amber-500 focus:ring-amber-500 focus:ring-offset-0"
                      />
                      <span className="flex items-center gap-1.5">
                        <span className="w-3 h-3 rounded-full bg-amber-500"></span>
                        Trigger Distance
                      </span>
                    </label>
                  )}

                  {/* Device Max - common to both */}
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-200 hover:text-white transition-colors">
                    <input
                      type="checkbox"
                      checked={showDeviceRadar}
                      onChange={(e) => setShowDeviceRadar(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-0"
                    />
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded-full bg-emerald-500"></span>
                      Device Max ({String(selectedProfile?.limits?.maxRangeMeters ?? 25)}m)
                    </span>
                  </label>

                  {/* Movement Trails - EPL only */}
                  {!isEP1 && (
                    <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-200 hover:text-white transition-colors">
                      <input
                        type="checkbox"
                        checked={showTrails}
                        onChange={(e) => setShowTrails(e.target.checked)}
                        className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-pink-500 focus:ring-pink-500 focus:ring-offset-0"
                      />
                      <span className="flex items-center gap-1.5">
                        <span className="w-3 h-3 rounded-full bg-pink-500"></span>
                        Movement Trails
                      </span>
                    </label>
                  )}

                  {/* Clip radar to walls - common to both */}
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-200 hover:text-white transition-colors">
                    <input
                      type="checkbox"
                      checked={clipRadarToWalls}
                      onChange={(e) => setClipRadarToWalls(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-slate-500 focus:ring-slate-500 focus:ring-offset-0"
                    />
                    <span className="flex items-center gap-1.5 text-slate-300">
                      Clip radar overlay to walls
                    </span>
                  </label>

                  {/* Smooth Tracking - EPL only */}
                  {!isEP1 && (
                    <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-200 hover:text-white transition-colors">
                      <input
                        type="checkbox"
                        checked={smoothTracking}
                        onChange={(e) => setSmoothTracking(e.target.checked)}
                        className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-purple-500 focus:ring-purple-500 focus:ring-offset-0"
                      />
                      <span className="flex items-center gap-1.5">
                        <span className="w-3 h-3 rounded-full bg-purple-500"></span>
                        Smooth Tracking
                      </span>
                    </label>
                  )}

                  {/* Heatmap Section - separate group, EPL only */}
                  {supportsHeatmap && (
                    <div className="mt-3 pt-3 border-t border-slate-700/50">
                      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Heatmap</div>
                      <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-200 hover:text-white transition-colors">
                        <input
                          type="checkbox"
                          checked={heatmapEnabled}
                          onChange={(e) => setHeatmapEnabled(e.target.checked)}
                          className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-red-500 focus:ring-red-500 focus:ring-offset-0"
                        />
                        <span className="flex items-center gap-1.5">
                          <span className="w-3 h-3 rounded-full bg-gradient-to-r from-blue-500 via-yellow-500 to-red-500"></span>
                          Show Heatmap {heatmapLoading && '(loading...)'}
                        </span>
                      </label>
                      {heatmapEnabled && (
                        <div className="mt-2 ml-6 space-y-2">
                          <div className="flex gap-2">
                            <select
                              value={heatmapHours}
                              onChange={(e) => setHeatmapHours(Number(e.target.value))}
                              className="flex-1 rounded-lg border border-slate-700 bg-slate-800/70 px-2 py-1 text-xs text-slate-100 focus:border-red-500 focus:ring-1 focus:ring-red-500/50 focus:outline-none"
                            >
                              <option value={1}>Last 1 hour</option>
                              <option value={6}>Last 6 hours</option>
                              <option value={24}>Last 24 hours</option>
                              <option value={72}>Last 3 days</option>
                              <option value={168}>Last 7 days</option>
                            </select>
                            <button
                              onClick={() => refreshHeatmap()}
                              disabled={heatmapLoading}
                              className="px-2 py-1 rounded-lg border border-slate-700 bg-slate-800/70 text-xs text-slate-300 hover:bg-slate-700 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                              title="Refresh heatmap data"
                            >
                              {heatmapLoading ? '...' : '↻'}
                            </button>
                          </div>
                          <div>
                            <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                              <span>Threshold</span>
                              <span>{Math.round(heatmapThreshold * 100)}%</span>
                            </div>
                            <input
                              type="range"
                              min="0"
                              max="50"
                              value={heatmapThreshold * 100}
                              onChange={(e) => setHeatmapThreshold(Number(e.target.value) / 100)}
                              className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-red-500"
                            />
                            <div className="flex justify-between text-[9px] text-slate-500 mt-0.5">
                              <span>More detail</span>
                              <span>Less noise</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Room Element Visibility */}
                  <div className="mt-3 pt-3 border-t border-slate-700/50">
                    <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Room Elements</div>
                    <div className="space-y-2">
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
                      {!isEP1 && (
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
                      )}
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

                  {/* Theme Switcher */}
                  <div className="mt-3 pt-3 border-t border-slate-700/50">
                    <ThemeSwitcher />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* EP1 Recommendations Popup */}
          {showRecommendations && isEP1 && selectedRoom && liveState && (
            <div className="absolute bottom-6 right-6 z-50 w-80">
              <div className="rounded-xl border border-slate-700/50 bg-slate-900/95 backdrop-blur p-4 shadow-xl">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-semibold text-slate-100">💡 Settings Recommendations</div>
                  <button
                    onClick={() => setShowRecommendations(false)}
                    className="text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    ✕
                  </button>
                </div>

                {/* Room Metrics */}
                {selectedRoom.roomShell && selectedRoom.roomShell.points.length >= 3 && (() => {
                  const points = selectedRoom.roomShell.points;
                  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                  points.forEach((p: { x: number; y: number }) => {
                    minX = Math.min(minX, p.x);
                    maxX = Math.max(maxX, p.x);
                    minY = Math.min(minY, p.y);
                    maxY = Math.max(maxY, p.y);
                  });
                  const widthM = (maxX - minX) / 1000;
                  const heightM = (maxY - minY) / 1000;
                  const diagonalM = Math.sqrt(widthM ** 2 + heightM ** 2);

                  // Calculate optimal settings
                  const optMaxDistance = Math.min(Math.ceil(diagonalM * 1.1), 25);
                  const optTriggerDistance = Math.round(optMaxDistance * 0.75 * 10) / 10;
                  const area = widthM * heightM;
                  const optSensitivity = area > 20 ? 6 : 7;

                  const config = liveState.config || {};

                  return (
                    <div className="space-y-3">
                      <div className="text-xs text-slate-400 bg-slate-800/50 rounded-lg px-3 py-2">
                        Room: {widthM.toFixed(1)}m × {heightM.toFixed(1)}m (diagonal: {diagonalM.toFixed(1)}m)
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <div className="text-slate-400 text-xs mb-1">Max Distance</div>
                          <div className="flex items-baseline gap-2">
                            <span className="text-slate-100 font-semibold">{config.distanceMax ?? '--'}m</span>
                            {config.distanceMax !== optMaxDistance && (
                              <span className="text-emerald-400 text-xs">→ {optMaxDistance}m</span>
                            )}
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-400 text-xs mb-1">Trigger Distance</div>
                          <div className="flex items-baseline gap-2">
                            <span className="text-slate-100 font-semibold">{config.triggerDistance ?? '--'}m</span>
                            {config.triggerDistance !== optTriggerDistance && (
                              <span className="text-emerald-400 text-xs">→ {optTriggerDistance}m</span>
                            )}
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-400 text-xs mb-1">Sensitivity</div>
                          <div className="flex items-baseline gap-2">
                            <span className="text-slate-100 font-semibold">{config.sensitivity ?? '--'}</span>
                            {config.sensitivity !== optSensitivity && (
                              <span className="text-emerald-400 text-xs">→ {optSensitivity}</span>
                            )}
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-400 text-xs mb-1">Off Latency</div>
                          <div className="text-slate-100 font-semibold">{config.offLatency ?? '--'}s</div>
                        </div>
                      </div>

                      {/* Tips */}
                      <div className="pt-3 border-t border-slate-700/50">
                        <div className="text-xs font-semibold text-slate-300 mb-2">Tips</div>
                        <ul className="space-y-1 text-xs text-slate-400">
                          {diagonalM > 8 && (
                            <li className="pl-3 relative before:content-['•'] before:absolute before:left-0">
                              Large room - consider increasing sensitivity for better coverage
                            </li>
                          )}
                          {diagonalM < 4 && (
                            <li className="pl-3 relative before:content-['•'] before:absolute before:left-0">
                              Small room - lower sensitivity may reduce false positives
                            </li>
                          )}
                          {config.mode === 'Presence Detection' && (
                            <li className="pl-3 relative before:content-['•'] before:absolute before:left-0">
                              Presence mode is optimized for battery life and simple occupancy
                            </li>
                          )}
                          {config.mode === 'Distance and Speed' && (
                            <li className="pl-3 relative before:content-['•'] before:absolute before:left-0">
                              Distance & Speed mode provides target distance but uses more power
                            </li>
                          )}
                        </ul>
                      </div>
                    </div>
                  );
                })()}

                {/* No room shell warning */}
                {(!selectedRoom.roomShell || selectedRoom.roomShell.points.length < 3) && (
                  <div className="text-sm text-amber-200 bg-amber-600/10 border border-amber-600/30 rounded-lg px-3 py-2">
                    Draw your room layout to get personalized settings recommendations
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Floating Controls (bottom left, above snap) */}
          <div className={`absolute ${isEP1 ? 'bottom-32' : 'bottom-56'} left-6 z-40 flex flex-col gap-2 rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur px-3 py-3 shadow-xl`}>
            <div className="flex flex-wrap gap-1.5">
              <button
                className="rounded-lg border border-slate-700/50 bg-slate-800/50 px-3 py-1.5 text-xs font-semibold text-slate-100 transition-all hover:border-slate-600 hover:bg-slate-700 active:scale-95"
                onClick={() => setZoom((z) => Math.min(5, z + 0.1))}
                title="Zoom In"
              >
                +
              </button>
              <button
                className="rounded-lg border border-slate-700/50 bg-slate-800/50 px-3 py-1.5 text-xs font-semibold text-slate-100 transition-all hover:border-slate-600 hover:bg-slate-700 active:scale-95"
                onClick={() => setZoom((z) => Math.max(0.1, z - 0.1))}
                title="Zoom Out"
              >
                −
              </button>
              <button
                className="rounded-lg border border-slate-700/50 bg-slate-800/50 px-3 py-1.5 text-xs font-semibold text-slate-100 transition-all hover:border-slate-600 hover:bg-slate-700 active:scale-95"
                onClick={() => {
                  setZoom(1.1);
                  setPanOffsetMm({ x: 0, y: 0 });
                }}
                title="Reset View"
              >
                Reset
              </button>
              <button
                className="rounded-lg border border-aqua-600/50 bg-aqua-600/10 px-3 py-1.5 text-xs font-semibold text-aqua-100 transition-all hover:bg-aqua-600/20 active:scale-95"
                onClick={handleAutoZoom}
                title="Auto Zoom to Fit"
              >
                Auto
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all active:scale-95 ${
                  showSettings
                    ? 'border-slate-500 bg-slate-600/90 text-slate-100'
                    : 'border-slate-700/50 bg-slate-800/50 text-slate-100 hover:border-slate-600 hover:bg-slate-700'
                }`}
                onClick={() => setShowSettings((v) => !v)}
                title="Display Settings"
              >
                🎨 Display
              </button>
              {selectedRoom && (
                <button
                  className="rounded-lg border border-slate-700/50 bg-slate-800/50 px-3 py-1.5 text-xs font-semibold text-slate-100 transition-all hover:border-slate-600 hover:bg-slate-700 active:scale-95"
                  onClick={() => setShowDeviceSettings(true)}
                  title="Device Settings"
                >
                  🔧 Device
                </button>
              )}
              {isEP1 && selectedRoom && (
                <button
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all active:scale-95 ${
                    showRecommendations
                      ? 'border-emerald-500 bg-emerald-600/20 text-emerald-100'
                      : 'border-slate-700/50 bg-slate-800/50 text-slate-100 hover:border-slate-600 hover:bg-slate-700'
                  }`}
                  onClick={() => setShowRecommendations((v) => !v)}
                  title="Settings Recommendations"
                >
                  💡 Tips
                </button>
              )}
            </div>
          </div>

          {/* Recording Controls (bottom left, above snap) - EPL only */}
          {!isEP1 && (
            <div className="absolute bottom-32 left-6 z-40 rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur px-4 py-3 shadow-xl">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    if (isRecording) {
                      setIsRecording(false);
                    } else {
                      setRecordedTrail([]); // Clear on start
                      setIsRecording(true);
                    }
                  }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm transition-all active:scale-95 ${
                    isRecording
                      ? 'bg-red-500/20 border border-red-500/50 text-red-300 hover:bg-red-500/30'
                      : 'bg-slate-800/50 border border-slate-700 text-slate-200 hover:bg-slate-700 hover:border-slate-600'
                  }`}
                >
                  <span className={`w-3 h-3 rounded-full ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-slate-500'}`} />
                  {isRecording ? 'Stop Recording' : 'Record Path'}
                </button>
                {recordedTrail.length > 0 && (
                  <button
                    onClick={() => setRecordedTrail([])}
                    className="px-3 py-2 rounded-lg border border-slate-700 bg-slate-800/50 text-slate-300 text-sm hover:bg-slate-700 hover:text-white transition-all active:scale-95"
                    title="Clear recorded path"
                  >
                    Clear
                  </button>
                )}
              </div>
              {(isRecording || recordedTrail.length > 0) && (
                <div className="mt-2 text-[10px] text-slate-400 flex items-center gap-2">
                  <span>{recordedTrail.length} points recorded</span>
                  {isRecording && <span className="text-red-400">● Recording...</span>}
                </div>
              )}
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
        </div>
      )}

      {/* Device Settings Modal */}
      {selectedRoom && (
        <DeviceSettingsModal
          isOpen={showDeviceSettings}
          onClose={() => setShowDeviceSettings(false)}
          room={selectedRoom}
          liveState={liveState ?? null}
          isEP1={isEP1}
        />
      )}
    </div>
  );
};
