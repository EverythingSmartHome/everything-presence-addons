import React, { useEffect, useState, useMemo } from 'react';
import { fetchDevices, fetchProfiles, fetchSettings, updateSettings, ingressAware } from './api/client';
import { createRoom, fetchRooms } from './api/rooms';
import { DiscoveredDevice, RoomConfig, LiveState, EntityMappings } from './api/types';
import { ZoneEditorPage } from './pages/ZoneEditorPage';
import { RoomBuilderPage } from './pages/RoomBuilderPage';
import { WizardPage } from './pages/WizardPage';
import { LiveTrackingPage } from './pages/LiveTrackingPage';
import { SettingsPage } from './pages/SettingsPage';
import { DeviceMappingsProvider } from './contexts/DeviceMappingsContext';

const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="glass-card p-6">
    <div className="mb-3 text-sm font-semibold text-aqua-500">{title}</div>
    <div className="space-y-2 text-slate-200">{children}</div>
  </div>
);

function App() {
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [profiles, setProfiles] = useState<{ id: string; label: string }[]>([]);
  const [rooms, setRooms] = useState<RoomConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomDeviceId, setNewRoomDeviceId] = useState<string | undefined>(undefined);
  const [savingRoom, setSavingRoom] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [wizardCompleted, setWizardCompleted] = useState<boolean>(false);
  const [wizardStep, setWizardStep] = useState<string>('device');
  const [wizardOutlineDone, setWizardOutlineDone] = useState<boolean>(false);
  const [wizardPlacementDone, setWizardPlacementDone] = useState<boolean>(false);
  const [wizardZonesReady, setWizardZonesReady] = useState<boolean>(false);
  const [view, setView] = useState<'dashboard' | 'wizard' | 'zoneEditor' | 'roomBuilder' | 'liveTracking' | 'settings'>('dashboard');
  const [liveState, setLiveState] = useState<LiveState | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const [deviceRes, profileRes, roomsRes, settingsRes] = await Promise.all([
          fetchDevices(),
          fetchProfiles(),
          fetchRooms(),
          fetchSettings(),
        ]);
        setDevices(deviceRes.devices);
        setProfiles(profileRes.profiles);
        setRooms(roomsRes.rooms);
        setWizardCompleted(settingsRes.settings.wizardCompleted);
        setWizardStep(settingsRes.settings.wizardStep ?? 'device');
        setWizardOutlineDone(Boolean(settingsRes.settings.outlineDone));
        setWizardPlacementDone(Boolean(settingsRes.settings.placementDone));
        setWizardZonesReady(Boolean(settingsRes.settings.zonesReady));
        const defaultRoomId =
          typeof settingsRes.settings.defaultRoomId === 'string' ? settingsRes.settings.defaultRoomId : null;
        if (!selectedRoomId && defaultRoomId) {
          const defaultRoom = roomsRes.rooms.find((room) => room.id === defaultRoomId);
          if (defaultRoom) {
            setSelectedRoomId(defaultRoomId);
            if (defaultRoom.profileId) {
              setSelectedProfileId(defaultRoom.profileId);
            }
          } else {
            updateSettings({ defaultRoomId: null }).catch(() => null);
          }
        }
        // Auto-launch wizard only on first run (when not yet completed AND no rooms exist)
        // If rooms exist, assume wizard was completed in a previous version
        if (!settingsRes.settings.wizardCompleted && roomsRes.rooms.length === 0) {
          setView('wizard');
        } else if (!settingsRes.settings.wizardCompleted && roomsRes.rooms.length > 0) {
          // Mark wizard as completed if rooms exist but flag wasn't set
          updateSettings({ wizardCompleted: true }).catch(() => null);
          setWizardCompleted(true);
        }
        if (!selectedProfileId && profileRes.profiles.length > 0) {
          setSelectedProfileId(profileRes.profiles[0].id);
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

  // Memoize selected room and profile to create stable references
  const selectedRoom = useMemo(
    () => rooms.find((r) => r.id === selectedRoomId),
    [rooms, selectedRoomId]
  );
  const selectedProfile = useMemo(
    () => profiles.find((p) => p.id === selectedProfileId),
    [profiles, selectedProfileId]
  );

  // WebSocket connection for real-time state updates (global)
  useEffect(() => {
    if (!selectedRoom || !selectedRoom.deviceId || !selectedProfile) {
      setLiveState(null);
      return;
    }

    // Construct WebSocket URL using ingress-aware path
    const httpPath = ingressAware('api/live/ws');
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}${httpPath}`;

    let ws: WebSocket | null = null;
    let reconnectTimeout: NodeJS.Timeout | null = null;
    let shouldReconnect = true;

    const connect = () => {
      if (!shouldReconnect) {
        return;
      }
      try {
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          setError(null);
          // Subscribe to device state changes
          ws?.send(
            JSON.stringify({
              type: 'subscribe',
              deviceId: selectedRoom.deviceId,
              profileId: selectedProfile.id,
              entityNamePrefix: selectedRoom.entityNamePrefix,
              entityMappings: selectedRoom.entityMappings,
            }),
          );
        };

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);

            if (message.type === 'warning' && message.code === 'MAPPING_NOT_FOUND') {
              // Device has no entity mappings - user should run entity discovery
              console.warn('MAPPING_NOT_FOUND:', message.message);
              // Set error to prompt user to configure entity mappings
              setError('Entity mappings not found. Please run entity discovery in the wizard to configure this device.');
            } else if (message.type === 'subscribed') {
              // Check if mappings are available
              if (message.hasMappings === false) {
                console.warn('Device subscribed but no mappings available');
              }
              // Fetch initial state via REST as fallback
              const entityParam = selectedRoom.entityNamePrefix ? `&entityNamePrefix=${selectedRoom.entityNamePrefix}` : '';
              const mappingsParam = selectedRoom.entityMappings ? `&entityMappings=${encodeURIComponent(JSON.stringify(selectedRoom.entityMappings))}` : '';
              const restUrl = ingressAware(`api/live/${selectedRoom.deviceId}/state?profileId=${selectedProfile.id}${entityParam}${mappingsParam}`);
              fetch(restUrl)
                .then((res) => res.json())
                .then((data) => setLiveState(data.state))
                .catch(() => null);
            } else if (message.type === 'state_update') {
              // Update live state with new entity value
              setLiveState((prev) => {
                if (!prev) return prev;

                const updated = { ...prev, timestamp: message.timestamp };
                const normalizedState = typeof message.state === 'string' ? message.state.toLowerCase() : '';
                const isUnavailable = normalizedState === 'unavailable' || normalizedState === 'unknown';
                const setAvailability = (key: string) => {
                  if (!updated.availability) {
                    updated.availability = {};
                  }
                  updated.availability[key] = isUnavailable ? 'unavailable' : 'ok';
                };
                const parseNumberValue = (): number | null => {
                  if (isUnavailable) return null;
                  const value = parseFloat(message.state);
                  return Number.isFinite(value) ? value : null;
                };
                const parseIntValue = (): number | null => {
                  if (isUnavailable) return null;
                  const value = parseInt(message.state, 10);
                  return Number.isFinite(value) ? value : null;
                };

                // Helper to check if entity matches a mapping or falls back to pattern
                const mappings = selectedRoom.entityMappings;
                const matchesEntity = (mappedEntity: string | undefined, ...fallbackPatterns: string[]): boolean => {
                  if (mappedEntity) {
                    return message.entityId === mappedEntity;
                  }
                  // Only use fallback patterns for legacy rooms without mappings
                  if (!mappings) {
                    return fallbackPatterns.some(pattern => message.entityId.includes(pattern));
                  }
                  return false;
                };

                // Helper to check zone occupancy entities from mappings
                const checkZoneOccupancy = (): { matched: boolean; zoneNum?: number } => {
                  // Check mapped zone occupancy entities first
                  if (mappings?.trackingTargets) {
                    // Zone occupancy entities aren't in trackingTargets, check settingsEntities or dedicated zone mappings
                  }
                  // For now, check each zone individually - these would be in a zoneOccupancyEntities mapping
                  // Fall back to pattern matching for legacy rooms
                  if (!mappings) {
                    const match = message.entityId.match(/zone_(\d+)_(occupancy|presence)/);
                    if (match) {
                      return { matched: true, zoneNum: parseInt(match[1], 10) };
                    }
                  }
                  return { matched: false };
                };

                // Helper to check target tracking entities from mappings
                const checkTargetEntity = (): { matched: boolean; targetId?: number; field?: string } => {
                  if (mappings?.trackingTargets) {
                    const targets = mappings.trackingTargets;
                    for (const [key, targetSet] of Object.entries(targets)) {
                      if (!targetSet) continue;
                      const targetNum = parseInt(key.replace('target', ''), 10);
                      if (targetSet.x && message.entityId === targetSet.x) return { matched: true, targetId: targetNum, field: 'x' };
                      if (targetSet.y && message.entityId === targetSet.y) return { matched: true, targetId: targetNum, field: 'y' };
                      if (targetSet.speed && message.entityId === targetSet.speed) return { matched: true, targetId: targetNum, field: 'speed' };
                      if (targetSet.distance && message.entityId === targetSet.distance) return { matched: true, targetId: targetNum, field: 'distance' };
                      if (targetSet.angle && message.entityId === targetSet.angle) return { matched: true, targetId: targetNum, field: 'angle' };
                      if (targetSet.resolution && message.entityId === targetSet.resolution) return { matched: true, targetId: targetNum, field: 'resolution' };
                      if (targetSet.active && message.entityId === targetSet.active) return { matched: true, targetId: targetNum, field: 'active' };
                    }
                  }
                  // Fallback to pattern matching for legacy rooms
                  if (!mappings) {
                    const match = message.entityId.match(/target_(\d+)_(x|y|distance|speed|angle|resolution|active)/);
                    if (match) {
                      return { matched: true, targetId: parseInt(match[1], 10), field: match[2] };
                    }
                  }
                  return { matched: false };
                };

                // Map entity_id to state field using entity mappings
                const zoneCheck = checkZoneOccupancy();
                if (zoneCheck.matched && zoneCheck.zoneNum) {
                  if (!updated.zoneOccupancy) {
                    updated.zoneOccupancy = {};
                  }
                  const key = `zone${zoneCheck.zoneNum}` as 'zone1' | 'zone2' | 'zone3' | 'zone4';
                  updated.zoneOccupancy[key] = message.state === 'on';
                } else if (matchesEntity(mappings?.presenceEntity, 'occupancy')) {
                  setAvailability('presence');
                  if (!isUnavailable) {
                    updated.presence = message.state === 'on';
                  }
                } else if (matchesEntity(mappings?.distanceEntity, 'target_distance', 'mmwave_target_distance')) {
                  setAvailability('distance');
                  updated.distance = parseNumberValue();
                } else if (matchesEntity(mappings?.speedEntity, 'target_speed', 'mmwave_target_speed')) {
                  setAvailability('speed');
                  updated.speed = parseNumberValue();
                } else if (matchesEntity(mappings?.energyEntity, 'target_energy', 'mmwave_target_energy')) {
                  setAvailability('energy');
                  updated.energy = parseIntValue();
                } else if (matchesEntity(mappings?.targetCountEntity, 'target_count')) {
                  setAvailability('targetCount');
                  updated.targetCount = parseIntValue() ?? 0;
                } else if (matchesEntity(mappings?.mmwaveEntity, '_mmwave')) {
                  // mmWave binary sensor - only match if it's actually the mmwave sensor entity
                  if (!mappings?.mmwaveEntity || message.entityId === mappings.mmwaveEntity) {
                    setAvailability('mmwave');
                    if (!isUnavailable) {
                      updated.mmwave = message.state === 'on';
                    }
                  }
                } else if (matchesEntity(mappings?.pirEntity, '_pir')) {
                  setAvailability('pir');
                  if (!isUnavailable) {
                    updated.pir = message.state === 'on';
                  }
                } else if (matchesEntity(mappings?.temperatureEntity, '_temperature')) {
                  setAvailability('temperature');
                  updated.temperature = parseNumberValue();
                } else if (matchesEntity(mappings?.humidityEntity, '_humidity')) {
                  setAvailability('humidity');
                  updated.humidity = parseNumberValue();
                } else if (matchesEntity(mappings?.illuminanceEntity, '_illuminance')) {
                  setAvailability('illuminance');
                  updated.illuminance = parseNumberValue();
                } else if (matchesEntity(mappings?.co2Entity, '_co2')) {
                  setAvailability('co2');
                  updated.co2 = parseNumberValue();
                }

                // Handle config entities
                else if (matchesEntity(mappings?.modeEntity, 'mmwave_mode')) {
                  if (!updated.config) updated.config = {} as any;
                  setAvailability('mode');
                  if (!isUnavailable) {
                    updated.config!.mode = message.state as any;
                  }
                } else if (matchesEntity(mappings?.maxDistanceEntity, 'max_distance', 'tracking_detection_range')) {
                  if (!updated.config) updated.config = {} as any;
                  setAvailability('distanceMax');
                  updated.config!.distanceMax = parseNumberValue();
                } else if (matchesEntity(mappings?.installationAngleEntity, 'installation_angle', 'tracking_sensor_angle')) {
                  if (!updated.config) updated.config = {} as any;
                  setAvailability('installationAngle');
                  updated.config!.installationAngle = parseNumberValue() ?? undefined;
                }
                // Settings entities that may not have dedicated mappings yet - use settingsEntities
                else if (matchesEntity(mappings?.settingsEntities?.mmwaveDistanceMin, 'distance_min', 'mmwave_minimum_distance')) {
                  if (!updated.config) updated.config = {} as any;
                  setAvailability('distanceMin');
                  updated.config!.distanceMin = parseNumberValue();
                } else if (matchesEntity(mappings?.settingsEntities?.mmwaveTriggerDistance, 'trigger_distance')) {
                  if (!updated.config) updated.config = {} as any;
                  setAvailability('triggerDistance');
                  updated.config!.triggerDistance = parseNumberValue();
                } else if (matchesEntity(mappings?.settingsEntities?.mmwaveSensitivity, 'sustain_sensitivity')) {
                  if (!updated.config) updated.config = {} as any;
                  setAvailability('sensitivity');
                  updated.config!.sensitivity = parseIntValue();
                } else if (matchesEntity(mappings?.settingsEntities?.mmwaveTriggerSensitivity, 'trigger_sensitivity')) {
                  if (!updated.config) updated.config = {} as any;
                  setAvailability('triggerSensitivity');
                  updated.config!.triggerSensitivity = parseIntValue();
                } else if (matchesEntity(mappings?.settingsEntities?.mmwaveOffLatency, 'off_latency')) {
                  if (!updated.config) updated.config = {} as any;
                  setAvailability('offLatency');
                  updated.config!.offLatency = parseIntValue();
                } else if (matchesEntity(mappings?.settingsEntities?.mmwaveOnLatency, 'on_latency')) {
                  if (!updated.config) updated.config = {} as any;
                  setAvailability('onLatency');
                  updated.config!.onLatency = parseIntValue();
                } else if (matchesEntity(mappings?.settingsEntities?.mmwaveThresholdFactor, 'threshold_factor')) {
                  if (!updated.config) updated.config = {} as any;
                  setAvailability('thresholdFactor');
                  updated.config!.thresholdFactor = parseIntValue();
                } else if (matchesEntity(mappings?.settingsEntities?.microMotion, 'micro_motion')) {
                  if (!updated.config) updated.config = {} as any;
                  setAvailability('microMotion');
                  if (!isUnavailable) {
                    updated.config!.microMotionEnabled = message.state === 'on';
                  }
                } else if (matchesEntity(mappings?.settingsEntities?.updateRate, 'update_rate')) {
                  if (!updated.config) updated.config = {} as any;
                  setAvailability('updateRate');
                  if (!isUnavailable) {
                    updated.config!.updateRate = message.state || null;
                  }
                }

                // Handle target tracking entities using mappings
                else {
                  const targetCheck = checkTargetEntity();
                  if (targetCheck.matched && targetCheck.targetId && targetCheck.field) {
                    const { targetId, field } = targetCheck;

                    if (field === 'active') {
                      if (!updated.targets) {
                        updated.targets = [];
                      }
                      let target = updated.targets.find(t => t.id === targetId);
                      if (!target) {
                        target = { id: targetId, x: null, y: null };
                        updated.targets.push(target);
                      }
                      target.active = message.state === 'on';
                    } else {
                      // Initialize targets array if needed
                      if (!updated.targets) {
                        updated.targets = [];
                      }

                      // Find or create target
                      let target = updated.targets.find(t => t.id === targetId);
                      if (!target) {
                        target = { id: targetId, x: null, y: null };
                        updated.targets.push(target);
                      }

                      // Update field with unit conversion for coordinates/distances
                      let value = parseFloat(message.state);
                      if (!isNaN(value)) {
                        // Convert imperial units to mm if needed (for x, y, distance fields)
                        if ((field === 'x' || field === 'y' || field === 'distance') && message.attributes?.unit_of_measurement) {
                          const unit = message.attributes.unit_of_measurement as string;
                          const unitLower = unit.toLowerCase();
                          // Convert inches to mm (1 inch = 25.4 mm)
                          if (unitLower === 'in' || unitLower === 'inch' || unitLower === 'inches' || unitLower === '"') {
                            value = value * 25.4;
                          }
                          // Convert feet to mm (1 foot = 304.8 mm)
                          else if (unitLower === 'ft' || unitLower === 'foot' || unitLower === 'feet' || unitLower === "'") {
                            value = value * 304.8;
                          }
                          // Convert cm to mm
                          else if (unitLower === 'cm') {
                            value = value * 10;
                          }
                          // Convert m to mm
                          else if (unitLower === 'm') {
                            value = value * 1000;
                          }
                        }
                        (target as any)[field] = value;
                      } else {
                        (target as any)[field] = null;
                      }
                    }
                  }
                  // Handle assumed presence status (entry/exit feature)
                  else if (matchesEntity(mappings?.assumedPresentRemainingEntity, 'assumed_present_remaining')) {
                    const value = parseFloat(message.state);
                    updated.assumedPresentRemaining = !isNaN(value) ? value : undefined;
                  } else if (matchesEntity(mappings?.assumedPresentEntity, 'assumed_present')) {
                    updated.assumedPresent = message.state === 'on';
                  }
                }

                return updated;
              });
            } else if (message.type === 'error') {
              console.error('WebSocket error:', message.error);
              setError(message.error);
            }
          } catch (err) {
            console.error('Failed to parse WebSocket message:', err);
          }
        };

        ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          setError('WebSocket connection error. Falling back to REST polling...');
        };

        ws.onclose = () => {
          ws = null;
          if (shouldReconnect) {
            reconnectTimeout = setTimeout(connect, 3000);
          }
        };
      } catch (err) {
        console.error('Failed to create WebSocket:', err);
        setError('Failed to establish WebSocket connection');
        // Fallback to REST polling
        if (shouldReconnect) {
          reconnectTimeout = setTimeout(connect, 3000);
        }
      }
    };

    connect();

    return () => {
      shouldReconnect = false;
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      if (ws) {
        ws.close();
      }
    };
    // Depend on memoized room/profile objects - only changes when the actual objects change
  }, [selectedRoom, selectedProfile]);

  // Transform device-relative coordinates to room coordinates
  const installationAngle =
    typeof liveState?.config?.installationAngle === 'number' ? liveState.config.installationAngle : 0;

  const deviceToRoom = React.useCallback((deviceX: number, deviceY: number) => {
    if (!selectedRoom?.devicePlacement) {
      return { x: deviceX, y: deviceY };
    }

    const { x, y, rotationDeg } = selectedRoom.devicePlacement;
    const effectiveRotationDeg = (rotationDeg ?? 0) + installationAngle;
    const angleRad = (effectiveRotationDeg * Math.PI) / 180;
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);

    const rotatedX = deviceX * cos - deviceY * sin;
    const rotatedY = deviceX * sin + deviceY * cos;

    return {
      x: rotatedX + x,
      y: rotatedY + y,
    };
  }, [selectedRoom, installationAngle]);

  // Compute target positions in room coordinates
  const targetPositions = useMemo(() => {
    if (!liveState?.targets) return [];
    return liveState.targets
      .filter((t) => {
        // Skip if explicitly marked as inactive
        if (t.active === false) return false;
        // Skip if coordinates are null
        if (t.x === null || t.y === null) return false;
        // Skip if coordinates are (0,0) UNLESS explicitly marked as active
        // (0,0 usually means no detection, but if active=true, show it anyway)
        if (t.x === 0 && t.y === 0 && t.active !== true) return false;
        return true;
      })
      .map((t) => {
        const roomPos = deviceToRoom(t.x!, t.y!);
        return {
          id: t.id,
          x: roomPos.x,
          y: roomPos.y,
          distance: t.distance ?? null,
          speed: t.speed ?? null,
          angle: t.angle ?? null,
        };
      });
  }, [liveState, deviceToRoom]);

  const handleCreateRoom = async () => {
    if (!newRoomName.trim()) {
      setError('Room name is required');
      return;
    }
    try {
      setSavingRoom(true);
      // Find the selected device to get its entityNamePrefix
      const selectedDevice = newRoomDeviceId ? devices.find(d => d.id === newRoomDeviceId) : undefined;
      const result = await createRoom({
        name: newRoomName.trim(),
        deviceId: newRoomDeviceId || undefined,
        entityNamePrefix: selectedDevice?.entityNamePrefix,
        profileId: selectedProfileId || undefined,
        units: 'metric',
        zones: [],
      });
      setRooms((prev) => [...prev, result.room]);
      setSelectedRoomId(result.room.id);
      setNewRoomName('');
      setNewRoomDeviceId(undefined);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create room');
    } finally {
      setSavingRoom(false);
    }
  };

  const dashboard = (
    <LiveTrackingPage
      onNavigate={(view) => {
        // Reset wizard step when navigating to Add Device
        if (view === 'wizard') {
          setWizardStep('device');
          updateSettings({ wizardStep: 'device' }).catch(() => null);
        }
        setView(view);
      }}
      initialRoomId={selectedRoomId}
      initialProfileId={selectedProfileId}
      liveState={liveState}
      targetPositions={targetPositions}
      onRoomChange={(roomId, profileId) => {
        setSelectedRoomId(roomId);
        setSelectedProfileId(profileId);
      }}
    />
  );

  return (
    <DeviceMappingsProvider>
      <div className="min-h-screen bg-slate-950 text-slate-100 p-4">
        <main>
          {view === 'dashboard' && dashboard}
        {view === 'wizard' && (
          <WizardPage
            devices={devices}
            profiles={profiles}
            rooms={rooms}
            selectedDeviceId={newRoomDeviceId}
            selectedProfileId={selectedProfileId}
            onBack={() => {
              // Reset wizard when going back
              setWizardStep('device');
              updateSettings({ wizardStep: 'device' }).catch(() => null);
              setView('dashboard');
            }}
            onCreateRoom={async (name, deviceId, profileId, entityMappings) => {
              // Find the selected device to get its entityNamePrefix (legacy fallback)
              const selectedDevice = deviceId ? devices.find(d => d.id === deviceId) : undefined;
              const result = await createRoom({
                name,
                deviceId: deviceId || undefined,
                entityNamePrefix: selectedDevice?.entityNamePrefix,
                entityMappings: entityMappings,
                profileId: profileId || undefined,
                units: 'metric',
                zones: [],
              });
              setRooms((prev) => [...prev, result.room]);
              return result.room;
            }}
            onSelectRoom={(roomId, profileId) => {
              setSelectedRoomId(roomId);
              if (profileId) setSelectedProfileId(profileId);
            }}
            onRoomUpdate={(updatedRoom) => {
              setRooms((prev) => prev.map((r) => (r.id === updatedRoom.id ? updatedRoom : r)));
            }}
            onComplete={() => {
              updateSettings({ wizardCompleted: true }).catch(() => null);
              setWizardCompleted(true);
              setWizardStep('finish');
              setView('dashboard');
            }}
            initialStep={wizardStep}
            onStepChange={(key) => {
              setWizardStep(key);
              updateSettings({ wizardStep: key }).catch(() => null);
            }}
            outlineDone={wizardOutlineDone}
            placementDone={wizardPlacementDone}
            zonesReady={wizardZonesReady}
            setOutlineDone={(val) => {
              setWizardOutlineDone(val);
              updateSettings({ outlineDone: val }).catch(() => null);
            }}
            setPlacementDone={(val) => {
              setWizardPlacementDone(val);
              updateSettings({ placementDone: val }).catch(() => null);
            }}
            setZonesReady={(val) => {
              setWizardZonesReady(val);
              updateSettings({ zonesReady: val }).catch(() => null);
            }}
            liveState={liveState}
            targetPositions={targetPositions}
          />
        )}
        {view === 'zoneEditor' && (
          <ZoneEditorPage
            onNavigate={(targetView) => {
              if (targetView === 'wizard') {
                setWizardStep('device');
                updateSettings({ wizardStep: 'device' }).catch(() => null);
              }
              // Map 'liveDashboard' to 'dashboard' for the main live tracking view
              const mappedView = targetView === 'liveDashboard' ? 'dashboard' : targetView;
              setView(mappedView);
            }}
            initialRoomId={selectedRoomId}
            initialProfileId={selectedProfileId}
            onWizardZonesReady={() => {
              setWizardZonesReady(true);
              setWizardStep('finish');
              updateSettings({ zonesReady: true, wizardStep: 'finish' }).catch(() => null);
            }}
            liveState={liveState}
            targetPositions={targetPositions}
            onRoomChange={(roomId, profileId) => {
              setSelectedRoomId(roomId);
              setSelectedProfileId(profileId);
            }}
          />
        )}
        {view === 'roomBuilder' && (
          <RoomBuilderPage
            onNavigate={(targetView) => {
              if (targetView === 'wizard') {
                setWizardStep('device');
                updateSettings({ wizardStep: 'device' }).catch(() => null);
              }
              // Map 'liveDashboard' to 'dashboard' for the main live tracking view
              const mappedView = targetView === 'liveDashboard' ? 'dashboard' : targetView;
              setView(mappedView);
            }}
            initialRoomId={selectedRoomId}
            initialProfileId={selectedProfileId}
            onWizardProgress={(p) => {
              if (p.outlineDone) {
                setWizardOutlineDone(true);
                setWizardStep('placement');
                updateSettings({ outlineDone: true, wizardStep: 'placement' }).catch(() => null);
              }
              if (p.placementDone) {
                setWizardPlacementDone(true);
                setWizardStep('zones');
                updateSettings({ placementDone: true, wizardStep: 'zones' }).catch(() => null);
              }
            }}
            liveState={liveState}
            targetPositions={targetPositions}
          />
        )}
        {view === 'liveTracking' && (
          <LiveTrackingPage
            onNavigate={(view) => {
              // Reset wizard step when navigating to Add Device
              if (view === 'wizard') {
                setWizardStep('device');
                updateSettings({ wizardStep: 'device' }).catch(() => null);
              }
              setView(view);
            }}
            initialRoomId={selectedRoomId}
            initialProfileId={selectedProfileId}
            liveState={liveState}
            targetPositions={targetPositions}
            onRoomChange={(roomId, profileId) => {
              setSelectedRoomId(roomId);
              setSelectedProfileId(profileId);
            }}
          />
        )}
        {view === 'settings' && (
          <SettingsPage
            onBack={() => setView('dashboard')}
            onRoomDeleted={(roomId) => {
              setRooms((prev) => prev.filter((r) => r.id !== roomId));
              if (selectedRoomId === roomId) {
                setSelectedRoomId(null);
              }
            }}
            onRoomUpdated={(room) => {
              setRooms((prev) => prev.map((r) => (r.id === room.id ? room : r)));
            }}
          />
        )}
        </main>
      </div>
    </DeviceMappingsProvider>
  );
}

export default App;
