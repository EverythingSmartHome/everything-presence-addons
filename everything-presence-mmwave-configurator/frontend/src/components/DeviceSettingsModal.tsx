import React, { useState, useEffect, useRef } from 'react';
import { LiveState, RoomConfig } from '../api/types';
import { ingressAware } from '../api/client';

interface DeviceSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  room: RoomConfig;
  liveState: LiveState | null;
  isEP1: boolean;
}

interface SettingConfig {
  key: string;
  entitySuffix: string;
  label: string;
  type: 'number' | 'select' | 'switch';
  domain?: 'number' | 'select' | 'switch' | 'light';
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: string[];
  group: string;
  description?: string;
}

interface SettingState {
  value: string | number | boolean;
  entityId: string;
  loading: boolean;
}

// EPL Settings Configuration
const eplSettings: SettingConfig[] = [
  // Detection
  { key: 'maxDistance', entitySuffix: 'max_distance', label: 'Max Distance', type: 'number', min: 0, max: 600, step: 1, unit: 'cm', group: 'Detection' },
  { key: 'occupancyOffDelay', entitySuffix: 'occupancy_off_delay', label: 'Occupancy Off Delay', type: 'number', min: 0, max: 600, step: 1, unit: 's', group: 'Detection' },
  // Zone delays
  { key: 'zone1OffDelay', entitySuffix: 'zone_1_occupancy_off_delay', label: 'Zone 1', type: 'number', min: 0, max: 600, step: 1, unit: 's', group: 'Zone Off Delays' },
  { key: 'zone2OffDelay', entitySuffix: 'zone_2_occupancy_off_delay', label: 'Zone 2', type: 'number', min: 0, max: 600, step: 1, unit: 's', group: 'Zone Off Delays' },
  { key: 'zone3OffDelay', entitySuffix: 'zone_3_occupancy_off_delay', label: 'Zone 3', type: 'number', min: 0, max: 600, step: 1, unit: 's', group: 'Zone Off Delays' },
  { key: 'zone4OffDelay', entitySuffix: 'zone_4_occupancy_off_delay', label: 'Zone 4', type: 'number', min: 0, max: 600, step: 1, unit: 's', group: 'Zone Off Delays' },
  // Installation
  { key: 'installationAngle', entitySuffix: 'installation_angle', label: 'Installation Angle', type: 'number', min: -45, max: 45, step: 1, unit: '°', group: 'Installation', description: 'Compensates for horizontal mounting angle (yaw). Use when the device is mounted at an angle but you want to draw zones straight. The coordinate system is rotated so zones align with the room.' },
  { key: 'upsideDownMounting', entitySuffix: 'upside_down_mounting', label: 'Upside Down Mounting', type: 'switch', group: 'Installation', description: 'Enable if the device is mounted upside down (e.g., on a ceiling).' },
  // Tracking
  { key: 'updateSpeed', entitySuffix: 'update_speed', label: 'Update Speed', type: 'select', options: ['Faster (0.1s)', 'Fast (0.2s)', 'Normal (0.3s)', 'Slow (0.4s)', 'Slower (0.5s)'], group: 'Tracking' },
  { key: 'trackingBehaviour', entitySuffix: 'tracking_behaviour', label: 'Tracking Behaviour', type: 'select', options: ['None', 'Targets Position', 'Above + Zone count', 'Above + Targets active', 'Above + Distance and Angle', 'Above + Speed and Resolution'], group: 'Tracking' },
  // Entry/Exit
  { key: 'entryExitEnabled', entitySuffix: 'entry_exit_enabled', label: 'Enabled', type: 'switch', group: 'Entry/Exit Detection' },
  { key: 'exitThresholdPct', entitySuffix: 'exit_threshold_pct', label: 'Exit Threshold', type: 'number', min: 0, max: 100, step: 1, unit: '%', group: 'Entry/Exit Detection' },
  { key: 'assumePresentTimeout', entitySuffix: 'assume_present_timeout', label: 'Assume Present Timeout', type: 'number', min: 0, max: 600, step: 1, unit: 's', group: 'Entry/Exit Detection' },
  // Advanced
  { key: 'staleTargetReset', entitySuffix: 'stale_target_reset', label: 'Stale Target Reset', type: 'switch', group: 'Advanced' },
  { key: 'staleTargetResetTimeout', entitySuffix: 'stale_target_reset_timeout', label: 'Reset Timeout', type: 'number', min: 1, max: 60, step: 1, unit: 's', group: 'Advanced' },
];

// EP1 Settings Configuration
const ep1Settings: SettingConfig[] = [
  // mmWave Detection
  { key: 'mmwaveMode', entitySuffix: 'mmwave_mode', label: 'mmWave Mode', type: 'select', options: ['Presence Detection', 'Distance and Speed'], group: 'mmWave Detection' },
  { key: 'mmwaveDistanceMin', entitySuffix: 'mmwave_minimum_distance', label: 'Min Distance', type: 'number', min: 0.6, max: 25, step: 0.1, unit: 'm', group: 'mmWave Detection' },
  { key: 'mmwaveDistanceMax', entitySuffix: 'mmwave_max_distance', label: 'Max Distance', type: 'number', min: 0, max: 25, step: 0.1, unit: 'm', group: 'mmWave Detection' },
  { key: 'mmwaveTriggerDistance', entitySuffix: 'mmwave_trigger_distance', label: 'Trigger Distance', type: 'number', min: 0, max: 25, step: 0.1, unit: 'm', group: 'mmWave Detection' },
  // Sensitivity
  { key: 'mmwaveSensitivity', entitySuffix: 'mmwave_sustain_sensitivity', label: 'Sustain Sensitivity', type: 'number', min: 0, max: 9, step: 1, unit: '', group: 'Sensitivity' },
  { key: 'mmwaveTriggerSensitivity', entitySuffix: 'mmwave_trigger_sensitivity', label: 'Trigger Sensitivity', type: 'number', min: 0, max: 9, step: 1, unit: '', group: 'Sensitivity' },
  { key: 'mmwaveThresholdFactor', entitySuffix: 'mmwave_threshold_factor', label: 'Threshold Factor', type: 'number', min: 1, max: 20, step: 1, unit: '', group: 'Sensitivity' },
  // Latency
  { key: 'mmwaveOnLatency', entitySuffix: 'mmwave_on_latency', label: 'mmWave On Latency', type: 'number', min: 0, max: 2, step: 0.25, unit: 's', group: 'Latency' },
  { key: 'mmwaveOffLatency', entitySuffix: 'mmwave_off_latency', label: 'mmWave Off Latency', type: 'number', min: 1, max: 600, step: 5, unit: 's', group: 'Latency' },
  { key: 'occupancyOffLatency', entitySuffix: 'occupancy_off_latency', label: 'Occupancy Off Latency', type: 'number', min: 1, max: 600, step: 5, unit: 's', group: 'Latency' },
  { key: 'pirOffLatency', entitySuffix: 'pir_off_latency', label: 'PIR Off Latency', type: 'number', min: 1, max: 120, step: 1, unit: 's', group: 'Latency' },
  { key: 'pirOnLatency', entitySuffix: 'pir_on_latency', label: 'PIR On Latency', type: 'number', min: 0, max: 1, step: 0.1, unit: 's', group: 'Latency' },
  // Sensor Offsets
  { key: 'temperatureOffset', entitySuffix: 'temperature_offset', label: 'Temperature Offset', type: 'number', min: -20, max: 20, step: 0.1, unit: '°C', group: 'Sensor Offsets' },
  { key: 'humidityOffset', entitySuffix: 'humidity_offset', label: 'Humidity Offset', type: 'number', min: -50, max: 50, step: 0.1, unit: '%', group: 'Sensor Offsets' },
  { key: 'illuminanceOffset', entitySuffix: 'illuminance_offset', label: 'Illuminance Offset', type: 'number', min: -50, max: 50, step: 1, unit: 'lx', group: 'Sensor Offsets' },
  // Switches
  { key: 'microMotion', entitySuffix: 'micro_motion_detection', label: 'Micro-motion Detection', type: 'switch', group: 'Features' },
  { key: 'mmwaveLed', entitySuffix: 'mmwave_led', label: 'mmWave LED', type: 'switch', domain: 'light', group: 'Features' },
  // Update Rate
  { key: 'updateRate', entitySuffix: 'distance_speed_update_rate', label: 'Update Rate', type: 'select', options: ['0.3s', '0.4s', '0.5s'], group: 'Features' },
];

// Number input component with local state (updates on blur/enter)
const NumberInput: React.FC<{
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  onSave: (value: number) => void;
}> = ({ value, min, max, step, unit, disabled, onSave }) => {
  const [localValue, setLocalValue] = useState(String(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLocalValue(String(value));
  }, [value]);

  const handleSave = () => {
    const numValue = parseFloat(localValue);
    if (!isNaN(numValue) && numValue !== value) {
      onSave(numValue);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="number"
        value={localValue}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            handleSave();
            inputRef.current?.blur();
          }
        }}
        disabled={disabled}
        className="w-24 px-2 py-1.5 text-sm text-right bg-slate-800 border border-slate-600 rounded-lg focus:border-aqua-500 focus:outline-none focus:ring-1 focus:ring-aqua-500/50 disabled:opacity-50 transition-colors"
      />
      {unit && <span className="text-xs text-slate-500 w-8">{unit}</span>}
    </div>
  );
};

export const DeviceSettingsModal: React.FC<DeviceSettingsModalProps> = ({
  isOpen,
  onClose,
  room,
  liveState,
  isEP1,
}) => {
  const [settings, setSettings] = useState<Record<string, SettingState>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const entityPrefix = room.entityNamePrefix || '';
  const settingsConfig = isEP1 ? ep1Settings : eplSettings;

  // Fetch current settings from HA
  useEffect(() => {
    if (!isOpen || !entityPrefix) return;

    const fetchSettings = async () => {
      setLoading(true);
      setError(null);

      const newSettings: Record<string, SettingState> = {};

      for (const setting of settingsConfig) {
        const domain = setting.domain || (setting.type === 'switch' ? 'switch' : setting.type === 'select' ? 'select' : 'number');
        const entityId = `${domain}.${entityPrefix}_${setting.entitySuffix}`;

        try {
          const response = await fetch(ingressAware(`api/live/ha/states/${entityId}`));
          if (response.ok) {
            const data = await response.json();
            let value: string | number | boolean = data.state;

            if (setting.type === 'number') {
              value = parseFloat(data.state) || 0;
            } else if (setting.type === 'switch') {
              value = data.state === 'on';
            }

            newSettings[setting.key] = {
              value,
              entityId,
              loading: false,
            };
          }
        } catch {
          // Entity might not exist, skip it
        }
      }

      setSettings(newSettings);
      setLoading(false);
    };

    fetchSettings();
  }, [isOpen, entityPrefix, settingsConfig]);

  const updateSetting = async (key: string, newValue: string | number | boolean) => {
    const setting = settings[key];
    if (!setting || !room.deviceId) return;

    setSettings((prev) => ({
      ...prev,
      [key]: { ...prev[key], loading: true },
    }));

    try {
      const url = ingressAware(`api/live/${room.deviceId}/entity`);
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityId: setting.entityId,
          value: newValue,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update setting');
      }

      setSettings((prev) => ({
        ...prev,
        [key]: { ...prev[key], value: newValue, loading: false },
      }));
      setError(null);
    } catch (err) {
      setError(`Failed to update setting`);
      setSettings((prev) => ({
        ...prev,
        [key]: { ...prev[key], loading: false },
      }));
    }
  };

  if (!isOpen) return null;

  // Group settings by their group property
  const groupedSettings = settingsConfig.reduce((acc, config) => {
    if (!acc[config.group]) {
      acc[config.group] = [];
    }
    acc[config.group].push(config);
    return acc;
  }, {} as Record<string, SettingConfig[]>);

  const renderSetting = (config: SettingConfig) => {
    const setting = settings[config.key];
    if (!setting) return null;

    return (
      <div key={config.key} className="py-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-300">{config.label}</span>
          <div className="flex items-center gap-2">
          {config.type === 'number' && (
            <NumberInput
              value={setting.value as number}
              min={config.min}
              max={config.max}
              step={config.step}
              unit={config.unit}
              disabled={setting.loading}
              onSave={(val) => updateSetting(config.key, val)}
            />
          )}

          {config.type === 'switch' && (
            <button
              onClick={() => updateSetting(config.key, !(setting.value as boolean))}
              disabled={setting.loading}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                setting.value ? 'bg-aqua-500' : 'bg-slate-600'
              } ${setting.loading ? 'opacity-50' : ''}`}
            >
              <div
                className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                  setting.value ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          )}

          {config.type === 'select' && config.options && (
            <select
              value={setting.value as string}
              onChange={(e) => updateSetting(config.key, e.target.value)}
              disabled={setting.loading}
              className="px-2 py-1.5 text-sm bg-slate-800/70 border border-slate-700 rounded-lg focus:border-aqua-500 focus:ring-1 focus:ring-aqua-500/50 focus:outline-none disabled:opacity-50 max-w-[160px]"
            >
              {config.options.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          )}

          {setting.loading && (
            <div className="w-4 h-4 border-2 border-aqua-500 border-t-transparent rounded-full animate-spin" />
          )}
          </div>
        </div>
        {config.description && (
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">{config.description}</p>
        )}
      </div>
    );
  };

  const renderGroup = (groupName: string, configs: SettingConfig[]) => {
    const renderedSettings = configs.map(renderSetting).filter(Boolean);
    if (renderedSettings.length === 0) return null;

    return (
      <div key={groupName} className="mb-5">
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 pb-1 border-b border-slate-700">
          {groupName}
        </h4>
        <div className="space-y-1">{renderedSettings}</div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <div>
            <h3 className="text-lg font-semibold text-white">Device Settings</h3>
            <p className="text-xs text-slate-400 mt-0.5">{room.name} • {isEP1 ? 'EP1' : 'EP Lite'}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-4 overflow-y-auto max-h-[calc(85vh-120px)]">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="flex items-center gap-3 text-slate-400 text-sm">
                <div className="w-5 h-5 border-2 border-aqua-500 border-t-transparent rounded-full animate-spin" />
                Loading settings...
              </div>
            </div>
          ) : Object.keys(settings).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="text-slate-400 text-sm mb-2">No settings found</div>
              <div className="text-slate-500 text-xs">Device may not be available or entity names may differ</div>
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-4 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-xs">
                  {error}
                </div>
              )}

              {Object.entries(groupedSettings).map(([groupName, configs]) =>
                renderGroup(groupName, configs)
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-700 bg-slate-900/50">
          <p className="text-[10px] text-slate-500 text-center">
            Changes apply immediately • Press Enter or click away to save
          </p>
        </div>
      </div>
    </div>
  );
};
