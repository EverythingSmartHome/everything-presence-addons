import React from 'react';
import { RoomConfig, LiveState } from '../api/types';
import { EP1EnvironmentalPanel } from './EP1EnvironmentalPanel';
import { EP1SettingsHelper } from './EP1SettingsHelper';
import { EP1DistanceArc } from './EP1DistanceArc';
import { ZoneCanvas } from './ZoneCanvas';
import {
  EP1ComfortPanel,
  EP1SensorComparisonPanel,
  EP1ActivityLog,
  EP1MiniCharts,
  EP1StatsPanel,
} from './ep1';

interface EP1DashboardProps {
  roomId: string;
  room: RoomConfig;
  liveState: LiveState | null;
  entityUnits?: Record<string, string>;
}

export const EP1Dashboard: React.FC<EP1DashboardProps> = ({ roomId, room, liveState, entityUnits }) => {
  if (!liveState) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-slate-400">Waiting for live data...</div>
      </div>
    );
  }

  // Prepare data for components
  const environmental = {
    temperature: liveState.temperature ?? null,
    humidity: liveState.humidity ?? null,
    illuminance: liveState.illuminance ?? null,
  };

  const config = liveState.config || {
    mode: null,
    distanceMin: null,
    distanceMax: null,
    triggerDistance: null,
    sensitivity: null,
    triggerSensitivity: null,
    offLatency: null,
    onLatency: null,
  };
  const presenceAvailability = liveState.availability?.presence;
  const mmwaveAvailability = liveState.availability?.mmwave;
  const pirAvailability = liveState.availability?.pir;

  const presenceLabel =
    presenceAvailability === 'unavailable'
      ? 'Unavailable'
      : liveState.presence
      ? '✓ Detected'
      : '✗ Clear';
  const mmwaveLabel =
    mmwaveAvailability === 'unavailable'
      ? 'Unavailable'
      : liveState.mmwave
      ? '✓ Active'
      : '✗ Inactive';
  const pirLabel =
    pirAvailability === 'unavailable'
      ? 'Unavailable'
      : liveState.pir
      ? '✓ Motion'
      : '✗ No Motion';

  return (
    <div className="min-h-screen bg-slate-950">
      <div className="mx-auto max-w-7xl px-6 py-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white mb-1">{room.name}</h1>
          <p className="text-sm text-slate-400">Everything Presence One - Live Dashboard</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content - Left Column (spans 2) */}
          <div className="lg:col-span-2 space-y-6">
            {/* Environmental Sensors (with CO2 and Light Context) */}
            <EP1EnvironmentalPanel environmental={environmental} co2={liveState.co2} entityUnits={entityUnits} />

            {/* Canvas with Distance Arc */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
              <h2 className="text-lg font-semibold text-white mb-4">Detection Visualization</h2>

              <ZoneCanvas
                zones={[]}
                onZonesChange={() => {}}
                roomShell={room.roomShell}
                roomShellFillMode={room.roomShellFillMode}
                floorMaterial={room.floorMaterial}
                devicePlacement={room.devicePlacement}
                fieldOfViewDeg={120}
                maxRangeMeters={25}
                furniture={room.furniture}
                height={420}
                renderOverlay={(params) => {
                  if (!room.devicePlacement) return null;

                  return (
                    <EP1DistanceArc
                      distance={liveState.distance}
                      devicePlacement={room.devicePlacement}
                      toCanvas={params.toCanvas}
                      rangeMm={6000}
                      fieldOfViewDeg={120}
                    />
                  );
                }}
              />

              {/* Distance Info */}
              {liveState.distance != null && liveState.distance > 0 && (
                <div className="mt-4 flex items-center gap-4 text-sm">
                  <div>
                    <span className="text-slate-400">Distance:</span>{' '}
                    <span className="text-cyan-400 font-semibold">{liveState.distance.toFixed(2)}m</span>
                  </div>
                  {liveState.speed != null && (
                    <div>
                      <span className="text-slate-400">Speed:</span>{' '}
                      <span className="text-emerald-400 font-semibold">{liveState.speed.toFixed(2)} m/s</span>
                    </div>
                  )}
                  {liveState.energy != null && (
                    <div>
                      <span className="text-slate-400">Energy:</span>{' '}
                      <span className="text-purple-400 font-semibold">{liveState.energy}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Presence Indicators */}
            <div className="grid grid-cols-3 gap-3">
              <div className={`rounded-xl border p-4 ${
                presenceAvailability === 'unavailable'
                  ? 'border-amber-600/50 bg-amber-600/10'
                  : liveState.presence
                  ? 'border-emerald-600/50 bg-emerald-600/10'
                  : 'border-slate-700 bg-slate-800/50'
              }`}>
                <div className="text-xs font-semibold text-slate-400 uppercase mb-1">Occupancy</div>
                <div className={`text-lg font-bold ${
                  presenceAvailability === 'unavailable'
                    ? 'text-amber-300'
                    : liveState.presence
                    ? 'text-emerald-400'
                    : 'text-slate-500'
                }`}>
                  {presenceLabel}
                </div>
              </div>

              <div className={`rounded-xl border p-4 ${
                mmwaveAvailability === 'unavailable'
                  ? 'border-amber-600/50 bg-amber-600/10'
                  : liveState.mmwave
                  ? 'border-blue-600/50 bg-blue-600/10'
                  : 'border-slate-700 bg-slate-800/50'
              }`}>
                <div className="text-xs font-semibold text-slate-400 uppercase mb-1">mmWave</div>
                <div className={`text-lg font-bold ${
                  mmwaveAvailability === 'unavailable'
                    ? 'text-amber-300'
                    : liveState.mmwave
                    ? 'text-blue-400'
                    : 'text-slate-500'
                }`}>
                  {mmwaveLabel}
                </div>
              </div>

              <div className={`rounded-xl border p-4 ${
                pirAvailability === 'unavailable'
                  ? 'border-amber-600/50 bg-amber-600/10'
                  : liveState.pir
                  ? 'border-purple-600/50 bg-purple-600/10'
                  : 'border-slate-700 bg-slate-800/50'
              }`}>
                <div className="text-xs font-semibold text-slate-400 uppercase mb-1">PIR</div>
                <div className={`text-lg font-bold ${
                  pirAvailability === 'unavailable'
                    ? 'text-amber-300'
                    : liveState.pir
                    ? 'text-purple-400'
                    : 'text-slate-500'
                }`}>
                  {pirLabel}
                </div>
              </div>
            </div>

            {/* Mini Charts */}
            <EP1MiniCharts
              temperature={liveState.temperature ?? null}
              presence={liveState.presence ?? false}
              distance={liveState.distance ?? null}
            />

            {/* Activity Log */}
            <EP1ActivityLog
              presence={liveState.presence ?? false}
              mmwave={liveState.mmwave ?? false}
              pir={liveState.pir ?? false}
            />
          </div>

          {/* Sidebar - Right Column */}
          <div className="space-y-6">
            {/* Settings Helper */}
            <EP1SettingsHelper
              room={room}
              config={config}
              onModeChange={(newMode) => {
                // TODO: Implement mode change API call
                console.log('Mode change requested:', newMode);
              }}
            />

            {/* Comfort Index */}
            <EP1ComfortPanel
              temperature={liveState.temperature ?? null}
              humidity={liveState.humidity ?? null}
              entityUnits={entityUnits}
            />

            {/* Sensor Comparison */}
            <EP1SensorComparisonPanel
              presence={liveState.presence ?? false}
              mmwave={liveState.mmwave ?? false}
              pir={liveState.pir ?? false}
            />

            {/* Today's Statistics */}
            <EP1StatsPanel
              deviceId={room.deviceId || roomId}
              presence={liveState.presence ?? false}
              temperature={liveState.temperature ?? null}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
