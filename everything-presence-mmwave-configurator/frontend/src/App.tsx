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

                // Map entity_id to state field
                // Check for zone occupancy first (more specific pattern)
                if (message.entityId.match(/zone_(\d+)_occupancy/)) {
                  const match = message.entityId.match(/zone_(\d+)_occupancy/);
                  if (match) {
                    const zoneNum = parseInt(match[1], 10);
                    if (!updated.zoneOccupancy) {
                      updated.zoneOccupancy = {};
                    }
                    const key = `zone${zoneNum}` as 'zone1' | 'zone2' | 'zone3' | 'zone4';
                    updated.zoneOccupancy[key] = message.state === 'on';
                  }
                } else if (message.entityId.includes('occupancy')) {
                  // Main presence occupancy (not zone-specific)
                  updated.presence = message.state === 'on';
                } else if (message.entityId.includes('target_distance') || message.entityId.includes('mmwave_target_distance')) {
                  updated.distance = parseFloat(message.state) || null;
                } else if (message.entityId.includes('target_speed') || message.entityId.includes('mmwave_target_speed')) {
                  updated.speed = parseFloat(message.state) || null;
                } else if (message.entityId.includes('target_energy') || message.entityId.includes('mmwave_target_energy')) {
                  updated.energy = parseInt(message.state, 10) || null;
                } else if (message.entityId.includes('target_count')) {
                  updated.targetCount = parseInt(message.state, 10) || 0;
                } else if (message.entityId.includes('_mmwave') && !message.entityId.includes('_target') && !message.entityId.includes('_mode') && !message.entityId.includes('_distance') && !message.entityId.includes('_sensitivity') && !message.entityId.includes('_latency') && !message.entityId.includes('_threshold')) {
                  updated.mmwave = message.state === 'on';
                } else if (message.entityId.includes('_pir')) {
                  updated.pir = message.state === 'on';
                } else if (message.entityId.includes('_temperature')) {
                  updated.temperature = parseFloat(message.state) || null;
                } else if (message.entityId.includes('_humidity')) {
                  updated.humidity = parseFloat(message.state) || null;
                } else if (message.entityId.includes('_illuminance')) {
                  updated.illuminance = parseFloat(message.state) || null;
                } else if (message.entityId.endsWith('_co2')) {
                  updated.co2 = parseFloat(message.state) || null;
                }

                // Handle EP1 config entities
                else if (message.entityId.includes('mmwave_mode')) {
                  if (!updated.config) updated.config = {} as any;
                  updated.config.mode = message.state as any;
                } else if (message.entityId.includes('distance_min')) {
                  if (!updated.config) updated.config = {} as any;
                  updated.config.distanceMin = parseFloat(message.state) || null;
                } else if (message.entityId.includes('max_distance')) {
                  if (!updated.config) updated.config = {} as any;
                  updated.config.distanceMax = parseFloat(message.state) || null;
                } else if (message.entityId.includes('trigger_distance')) {
                  if (!updated.config) updated.config = {} as any;
                  updated.config.triggerDistance = parseFloat(message.state) || null;
                }
                // Handle EPL max distance entity (number.${name}_distance)
                else if (message.entityId.match(/number\.\w+_distance$/) && !message.entityId.includes('target') && !message.entityId.includes('trigger')) {
                  if (!updated.config) updated.config = {} as any;
                  updated.config.distanceMax = parseFloat(message.state) || null;
                } else if (message.entityId.includes('sustain_sensitivity')) {
                  if (!updated.config) updated.config = {} as any;
                  updated.config.sensitivity = parseInt(message.state, 10) || null;
                } else if (message.entityId.includes('trigger_sensitivity')) {
                  if (!updated.config) updated.config = {} as any;
                  updated.config.triggerSensitivity = parseInt(message.state, 10) || null;
                } else if (message.entityId.includes('off_latency')) {
                  if (!updated.config) updated.config = {} as any;
                  updated.config.offLatency = parseInt(message.state, 10) || null;
                } else if (message.entityId.includes('on_latency')) {
                  if (!updated.config) updated.config = {} as any;
                  updated.config.onLatency = parseInt(message.state, 10) || null;
                } else if (message.entityId.includes('threshold_factor')) {
                  if (!updated.config) updated.config = {} as any;
                  updated.config.thresholdFactor = parseInt(message.state, 10) || null;
                } else if (message.entityId.includes('micro_motion')) {
                  if (!updated.config) updated.config = {} as any;
                  updated.config.microMotionEnabled = message.state === 'on';
                } else if (message.entityId.includes('update_rate')) {
                  if (!updated.config) updated.config = {} as any;
                  updated.config.updateRate = message.state || null;
                }

                // Handle EPL target tracking entities
                else if (message.entityId.match(/target_(\d+)_(x|y|distance|speed|angle|resolution)/)) {
                  // Parse target position entities (e.g., sensor.ep1_target_1_x)
                  const match = message.entityId.match(/target_(\d+)_(x|y|distance|speed|angle|resolution)/);
                  if (match) {
                    const targetId = parseInt(match[1], 10);
                    const field = match[2] as 'x' | 'y' | 'distance' | 'speed' | 'angle' | 'resolution';

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
                      target[field] = value;
                    } else {
                      target[field] = null;
                    }
                  }
                }

                // Handle EPL target active status (binary_sensor.${name}_target_${i}_active)
                else if (message.entityId.match(/target_(\d+)_active/)) {
                  const match = message.entityId.match(/target_(\d+)_active/);
                  if (match) {
                    const targetId = parseInt(match[1], 10);

                    if (!updated.targets) {
                      updated.targets = [];
                    }

                    let target = updated.targets.find(t => t.id === targetId);
                    if (!target) {
                      target = { id: targetId, x: null, y: null };
                      updated.targets.push(target);
                    }

                    target.active = message.state === 'on';
                  }
                }

                // Handle assumed presence status (entry/exit feature)
                else if (message.entityId.includes('assumed_present_remaining')) {
                  const value = parseFloat(message.state);
                  updated.assumedPresentRemaining = !isNaN(value) ? value : undefined;
                } else if (message.entityId.includes('assumed_present')) {
                  updated.assumedPresent = message.state === 'on';
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
  const deviceToRoom = React.useCallback((deviceX: number, deviceY: number) => {
    if (!selectedRoom?.devicePlacement) {
      return { x: deviceX, y: deviceY };
    }

    const { x, y, rotationDeg } = selectedRoom.devicePlacement;
    const angleRad = ((rotationDeg ?? 0) * Math.PI) / 180;
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);

    const rotatedX = deviceX * cos - deviceY * sin;
    const rotatedY = deviceX * sin + deviceY * cos;

    return {
      x: rotatedX + x,
      y: rotatedY + y,
    };
  }, [selectedRoom]);

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
      <div className="min-h-screen bg-slate-950 text-slate-100">
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
          />
        )}
        </main>
      </div>
    </DeviceMappingsProvider>
  );
}

export default App;
