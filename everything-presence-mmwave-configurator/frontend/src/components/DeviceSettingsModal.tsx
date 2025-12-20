import React, { useState, useEffect, useRef } from 'react';
import { LiveState, RoomConfig } from '../api/types';
import { ingressAware } from '../api/client';
import { useDeviceSettings } from '../contexts/DeviceMappingsContext';
import { SettingsGroup, SettingEntity } from '../api/deviceMappings';

interface DeviceSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  room: RoomConfig;
  liveState: LiveState | null;
  isEP1: boolean;
}

interface SettingState {
  value: string | number | boolean | null;
  entityId: string;
  loading: boolean;
  status: 'enabled' | 'disabled' | 'unavailable' | 'unknown';
  disabledBy?: string | null;
  hiddenBy?: string | null;
}

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
  const [settingValues, setSettingValues] = useState<Record<string, SettingState>>({});
  const [fetchingValues, setFetchingValues] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Use the new device mappings context to get settings dynamically
  const { settings: settingsGroups, loading: settingsLoading, error: settingsError } = useDeviceSettings(room.deviceId);

  // Fetch current values from HA when settings are loaded
  useEffect(() => {
    if (!isOpen || settingsLoading || !settingsGroups.length) return;

    const fetchSettingValues = async () => {
      setFetchingValues(true);
      setError(null);

      const newSettings: Record<string, SettingState> = {};
      const failedEntities: string[] = [];

      // Flatten all settings from all groups
      const allSettings = settingsGroups.flatMap(group => group.settings);
      const settingsToFetch = allSettings.filter((setting) => setting.status !== 'disabled');

      for (const setting of allSettings) {
        const status = setting.status ?? 'unknown';
        newSettings[setting.key] = {
          value: null,
          entityId: setting.entityId,
          loading: status === 'enabled' || status === 'unavailable' || status === 'unknown',
          status,
          disabledBy: setting.disabledBy ?? null,
          hiddenBy: setting.hiddenBy ?? null,
        };
      }

      // Fetch all settings in parallel for better performance
      const fetchPromises = settingsToFetch.map(async (setting) => {
        if (!setting.entityId) return null;

        try {
          const response = await fetch(ingressAware(`api/live/ha/states/${setting.entityId}`));

          if (response.ok) {
            const data = await response.json();
            let value: string | number | boolean = data.state;
            let status: SettingState['status'] = 'enabled';
            const normalizedState = typeof data.state === 'string' ? data.state.toLowerCase() : '';

            if (normalizedState === 'unavailable' || normalizedState === 'unknown') {
              status = 'unavailable';
              value = null;
            }

            // Convert based on control type
            if (status === 'enabled' && setting.controlType === 'number') {
              value = parseFloat(data.state) || 0;
            } else if (status === 'enabled' && (setting.controlType === 'switch' || setting.controlType === 'light')) {
              value = data.state === 'on';
            }

            return {
              key: setting.key,
              state: {
                value,
                entityId: setting.entityId,
                loading: false,
                status,
                disabledBy: setting.disabledBy ?? null,
                hiddenBy: setting.hiddenBy ?? null,
              },
            };
          } else if (response.status === 404) {
            failedEntities.push(setting.entityId);
            return null;
          } else {
            console.warn(`[DeviceSettings] Failed to fetch ${setting.entityId}: ${response.status}`);
            failedEntities.push(setting.entityId);
            return null;
          }
        } catch (err) {
          console.warn(`[DeviceSettings] Error fetching ${setting.entityId}:`, err);
          failedEntities.push(setting.entityId);
          return null;
        }
      });

      const results = await Promise.all(fetchPromises);

      for (const result of results) {
        if (result) {
          newSettings[result.key] = result.state;
        }
      }

      for (const setting of allSettings) {
        const state = newSettings[setting.key];
        if (state && state.loading) {
          state.loading = false;
        }
      }

      if (failedEntities.length > 0 && process.env.NODE_ENV === 'development') {
        console.log('[DeviceSettings] Failed to fetch entities:', failedEntities);
      }

      setSettingValues(newSettings);
      setFetchingValues(false);
    };

    fetchSettingValues();
  }, [isOpen, settingsLoading, settingsGroups]);

  const updateSetting = async (key: string, newValue: string | number | boolean) => {
    const settingState = settingValues[key];
    if (!settingState || !room.deviceId) return;

    setSettingValues((prev) => ({
      ...prev,
      [key]: { ...prev[key], loading: true },
    }));

    try {
      const url = ingressAware(`api/live/${room.deviceId}/entity`);
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityId: settingState.entityId,
          value: newValue,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update setting');
      }

      setSettingValues((prev) => ({
        ...prev,
        [key]: { ...prev[key], value: newValue, loading: false },
      }));
      setError(null);
    } catch (err) {
      setError(`Failed to update setting`);
      setSettingValues((prev) => ({
        ...prev,
        [key]: { ...prev[key], loading: false },
      }));
    }
  };

  if (!isOpen) return null;

  const loading = settingsLoading || fetchingValues;

  const renderSetting = (setting: SettingEntity) => {
    const state = settingValues[setting.key];
    if (!state) return null;
    const status = state.status;
    const canEdit = status === 'enabled';

    return (
      <div key={setting.key} className="py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-300">{setting.label || setting.key}</span>
            {status === 'disabled' && (
              <span className="text-[10px] text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded">
                Disabled
              </span>
            )}
            {status === 'unavailable' && (
              <span className="text-[10px] text-sky-300 bg-sky-500/10 px-2 py-0.5 rounded">
                Unavailable
              </span>
            )}
            {setting.hiddenBy && status === 'enabled' && (
              <span className="text-[10px] text-slate-400 bg-slate-700/40 px-2 py-0.5 rounded">
                Hidden
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
          {setting.controlType === 'number' && canEdit && typeof state.value === 'number' && (
            <NumberInput
              value={state.value as number}
              min={setting.min}
              max={setting.max}
              step={setting.step}
              unit={setting.unit}
              disabled={state.loading}
              onSave={(val) => updateSetting(setting.key, val)}
            />
          )}

          {(setting.controlType === 'switch' || setting.controlType === 'light') && canEdit && typeof state.value === 'boolean' && (
            <button
              onClick={() => updateSetting(setting.key, !(state.value as boolean))}
              disabled={state.loading}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                state.value ? 'bg-aqua-500' : 'bg-slate-600'
              } ${state.loading ? 'opacity-50' : ''}`}
            >
              <div
                className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                  state.value ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          )}

          {setting.controlType === 'select' && setting.options && canEdit && typeof state.value === 'string' && (
            <select
              value={(state.value ?? '') as string}
              onChange={(e) => updateSetting(setting.key, e.target.value)}
              disabled={state.loading}
              className="px-2 py-1.5 text-sm bg-slate-800/70 border border-slate-700 rounded-lg focus:border-aqua-500 focus:ring-1 focus:ring-aqua-500/50 focus:outline-none disabled:opacity-50 max-w-[160px]"
            >
              {setting.options.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          )}

          {canEdit && !state.loading && state.value === null && (
            <span className="text-xs text-slate-500 italic">Value unavailable</span>
          )}

          {!canEdit && (
            <span className="text-xs text-slate-500 italic">
              {status === 'disabled'
                ? `Disabled${state.disabledBy ? ` (${state.disabledBy})` : ''}`
                : status === 'unavailable'
                ? 'Unavailable'
                : 'Status unknown'}
            </span>
          )}

          {state.loading && (
            <div className="w-4 h-4 border-2 border-aqua-500 border-t-transparent rounded-full animate-spin" />
          )}
          </div>
        </div>
        {setting.description && (
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">{setting.description}</p>
        )}
      </div>
    );
  };

  const renderGroup = (group: SettingsGroup) => {
    const renderedSettings = group.settings.map(renderSetting).filter(Boolean);
    if (renderedSettings.length === 0) return null;

    return (
      <div key={group.group} className="mb-5">
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 pb-1 border-b border-slate-700">
          {group.group}
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
          ) : settingsError ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="text-red-400 text-sm mb-2">Failed to load settings</div>
              <div className="text-slate-500 text-xs">{settingsError}</div>
            </div>
          ) : settingsGroups.length === 0 || Object.keys(settingValues).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="text-slate-400 text-sm mb-2">No settings found</div>
              <div className="text-slate-500 text-xs">Device may not have mappings or settings configured</div>
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-4 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-xs">
                  {error}
                </div>
              )}

              {settingsGroups.map(group => renderGroup(group))}
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
