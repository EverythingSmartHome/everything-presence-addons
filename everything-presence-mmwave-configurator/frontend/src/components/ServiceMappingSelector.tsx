import React, { useState, useEffect } from 'react';
import { getEsphomeServices, updateServiceMappings } from '../api/serviceDiscovery';
import type { DeviceMapping } from '../api/deviceMappings';

interface ServiceMappingSelectorProps {
  deviceId: string;
  mapping: DeviceMapping;
  discoveredServices?: Record<string, string>;
  onUpdated: () => void;
}

/**
 * Component for manually selecting ESPHome service mappings when auto-discovery fails.
 * Displays a dropdown filtered to _get_build_flags services with confirmation status.
 */
export const ServiceMappingSelector: React.FC<ServiceMappingSelectorProps> = ({
  deviceId,
  mapping,
  discoveredServices,
  onUpdated,
}) => {
  const serviceDefinitions = [
    {
      key: 'getBuildFlags',
      label: 'Build Flags Service',
      pattern: '*_get_build_flags',
      emptyMessage: 'No _get_build_flags services found. Firmware checks may not be available.',
    },
    {
      key: 'setUpdateManifest',
      label: 'Update Manifest Service',
      pattern: '*_set_update_manifest',
      emptyMessage: 'No _set_update_manifest services found. Firmware updates may not be available.',
    },
  ] as const;

  const [servicesByKey, setServicesByKey] = useState<Record<string, string[]>>({});
  const [loadingByKey, setLoadingByKey] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [errorByKey, setErrorByKey] = useState<Record<string, string | null>>({});
  const [selectedByKey, setSelectedByKey] = useState<Record<string, string>>({});
  const [editingByKey, setEditingByKey] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const nextSelected: Record<string, string> = {};
    const nextEditing: Record<string, boolean> = {};

    for (const def of serviceDefinitions) {
      const current = mapping.serviceMappings?.[def.key] ?? discoveredServices?.[def.key] ?? '';
      nextSelected[def.key] = current;
      nextEditing[def.key] = !current;
    }

    setSelectedByKey(nextSelected);
    setEditingByKey((prev) => {
      if (Object.keys(prev).length === 0) return nextEditing;
      const merged: Record<string, boolean> = {};
      for (const def of serviceDefinitions) {
        merged[def.key] = prev[def.key] ?? nextEditing[def.key];
      }
      return merged;
    });
  }, [
    mapping.serviceMappings?.getBuildFlags,
    mapping.serviceMappings?.setUpdateManifest,
    discoveredServices?.getBuildFlags,
    discoveredServices?.setUpdateManifest,
  ]);

  useEffect(() => {
    let cancelled = false;
    const loadServices = async () => {
      const nextLoading: Record<string, boolean> = {};
      const nextErrors: Record<string, string | null> = {};
      for (const def of serviceDefinitions) {
        nextLoading[def.key] = true;
        nextErrors[def.key] = null;
      }
      setLoadingByKey(nextLoading);
      setErrorByKey(nextErrors);

      await Promise.all(
        serviceDefinitions.map(async (def) => {
          try {
            const result = await getEsphomeServices(def.pattern);
            if (!cancelled) {
              setServicesByKey((prev) => ({ ...prev, [def.key]: result }));
            }
          } catch (err) {
            if (!cancelled) {
              setErrorByKey((prev) => ({
                ...prev,
                [def.key]: err instanceof Error ? err.message : 'Failed to load services',
              }));
            }
          } finally {
            if (!cancelled) {
              setLoadingByKey((prev) => ({ ...prev, [def.key]: false }));
            }
          }
        })
      );
    };

    loadServices();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async (serviceKey: string) => {
    const selected = selectedByKey[serviceKey];
    if (!selected) return;
    setSaving(true);
    setErrorByKey((prev) => ({ ...prev, [serviceKey]: null }));

    try {
      const success = await updateServiceMappings(
        deviceId,
        {
          ...mapping.serviceMappings,
          [serviceKey]: selected,
        },
        true
      );

      if (success) {
        onUpdated();
        setEditingByKey((prev) => ({ ...prev, [serviceKey]: false }));
      } else {
        setErrorByKey((prev) => ({ ...prev, [serviceKey]: 'Failed to save service mapping' }));
      }
    } catch (err) {
      setErrorByKey((prev) => ({
        ...prev,
        [serviceKey]: err instanceof Error ? err.message : 'Failed to save',
      }));
    } finally {
      setSaving(false);
    }
  };

  const isConfirmed = mapping.serviceConfirmedByUser;

  return (
    <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="text-sm font-medium text-slate-200">Firmware Service Mapping</span>
        </div>
        {isConfirmed && (
          <span className="text-xs px-2 py-0.5 bg-green-500/20 text-green-400 rounded border border-green-500/30">
            Confirmed
          </span>
        )}
      </div>

      <p className="text-xs text-slate-400 mb-3">
        If firmware checks fail due to device renaming, select the correct service below.
      </p>

      {serviceDefinitions.map((def, index) => {
        const storedCurrent = mapping.serviceMappings?.[def.key];
        const discovered = discoveredServices?.[def.key];
        const current = storedCurrent ?? discovered ?? '';
        const isAuto = !storedCurrent && !!discovered;
        const isEditing = editingByKey[def.key] ?? !current;
        const selected = selectedByKey[def.key] ?? '';
        const services = servicesByKey[def.key] ?? [];
        const loading = loadingByKey[def.key] ?? false;
        const error = errorByKey[def.key];
        const hasChanged = selected !== (current || '');
        const serviceOptions =
          selected && !services.includes(selected) ? [selected, ...services] : services;

        return (
          <div key={def.key} className={index === 0 ? '' : 'mt-4'}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-slate-300">{def.label}</div>
              {isAuto && (
                <span className="text-[10px] px-2 py-0.5 bg-emerald-500/20 text-emerald-300 rounded border border-emerald-500/30">
                  Auto-matched
                </span>
              )}
            </div>

            {loading ? (
              <div className="flex items-center gap-2 py-2">
                <div className="w-4 h-4 border-2 border-aqua-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-slate-400">Loading available services...</span>
              </div>
            ) : (
              <>
                {!isEditing && current ? (
                  <div className="flex items-center gap-2">
                    <span
                      className="flex-1 text-xs text-slate-400 font-mono break-all"
                      title={current}
                    >
                      {current}
                    </span>
                    <button
                      onClick={() => setEditingByKey((prev) => ({ ...prev, [def.key]: true }))}
                      className="text-xs text-slate-500 hover:text-slate-300"
                      type="button"
                    >
                      Edit
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <select
                      value={selected}
                      onChange={(e) =>
                        setSelectedByKey((prev) => ({ ...prev, [def.key]: e.target.value }))
                      }
                      disabled={saving}
                      className="flex-1 text-sm bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-200 focus:border-aqua-500 focus:outline-none disabled:opacity-50"
                    >
                      <option value="">Select service...</option>
                      {serviceOptions.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>

                    <button
                      onClick={() => handleSave(def.key)}
                      disabled={!selected || saving || !hasChanged}
                      className="px-4 py-2 bg-aqua-500 hover:bg-aqua-400 text-slate-900 rounded font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                )}

                {error && (
                  <p className="text-xs text-amber-400 mt-2 flex items-center gap-1">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                        clipRule="evenodd"
                      />
                    </svg>
                    {error}
                  </p>
                )}

                {!loading && services.length === 0 && !error && (
                  <p className="text-xs text-slate-500 mt-2">{def.emptyMessage}</p>
                )}

                {!current && !loading && (
                  <p className="text-xs text-amber-300 mt-2">
                    Could not auto-discover this service. Please select it above.
                  </p>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
};
