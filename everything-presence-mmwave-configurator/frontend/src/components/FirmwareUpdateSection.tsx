import React, { useState, useEffect, useRef } from 'react';
import {
  fetchDevices,
  fetchFirmwareSettings,
  updateFirmwareSettings,
  prepareFirmware,
  triggerFirmwareUpdate,
  fetchFirmwareCache,
  fetchProfiles,
  deleteFirmwareCacheEntry,
  getDeviceConfig,
  getAvailableUpdates,
  autoPrepare,
  fetchFirmwareUpdateStatus,
  ingressAware,
} from '../api/client';
import {
  DiscoveredDevice,
  CachedFirmwareEntry,
  FirmwareUpdateStatus,
  DeviceConfig,
  AvailableUpdate,
  FirmwareValidation,
  FirmwareUpdateEntityStatus,
  DeviceProfile,
} from '../api/types';
import { useDeviceMappings } from '../contexts/DeviceMappingsContext';

interface FirmwareUpdateSectionProps {
  onError: (error: string) => void;
  onSuccess: (message: string) => void;
}

export const FirmwareUpdateSection: React.FC<FirmwareUpdateSectionProps> = ({
  onError,
  onSuccess,
}) => {
  const buildConfigUnavailableMessage =
    'Device build config not available. Firmware updates are disabled to prevent mismatched installs.';
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  // Devices state
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [profiles, setProfiles] = useState<DeviceProfile[]>([]);

  // Settings state
  const [lanIpOverride, setLanIpOverride] = useState('');
  const [autoDetectedIp, setAutoDetectedIp] = useState('');
  const [lanPort, setLanPort] = useState(38080);
  const [cacheKeepCount, setCacheKeepCount] = useState(3);

  // Auto-detection state
  const [deviceConfig, setDeviceConfig] = useState<DeviceConfig | null>(null);
  const [availableUpdates, setAvailableUpdates] = useState<AvailableUpdate[]>([]);
  const [selectedUpdate, setSelectedUpdate] = useState<AvailableUpdate | null>(null);
  const [validation, setValidation] = useState<FirmwareValidation | null>(null);

  // Update state
  const [updateStatus, setUpdateStatus] = useState<FirmwareUpdateStatus>('idle');
  const [preparedToken, setPreparedToken] = useState<string | null>(null);
  const [preparedVersion, setPreparedVersion] = useState<string | null>(null);
  const [updateEntityStatus, setUpdateEntityStatus] = useState<FirmwareUpdateEntityStatus | null>(null);
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);
  const [updateMonitorMessage, setUpdateMonitorMessage] = useState<string | null>(null);
  const [monitoringUpdate, setMonitoringUpdate] = useState(false);
  const [availabilityEntityId, setAvailabilityEntityId] = useState<string | null>(null);
  const [availabilityState, setAvailabilityState] = useState<string | null>(null);
  const [rebootConfirmed, setRebootConfirmed] = useState(false);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [showBuildDetails, setShowBuildDetails] = useState(false);
  const updateMonitorRef = useRef({
    attempts: 0,
    seenStart: false,
    seenInProgress: false,
    seenRebootDown: false,
    seenRebootUp: false,
    rebootStartAt: null as number | null,
  });

  const { getMapping } = useDeviceMappings();

  // Manual mode state
  const [showManualMode, setShowManualMode] = useState(false);
  const [manifestUrl, setManifestUrl] = useState('');

  // Cache state
  const [cachedEntries, setCachedEntries] = useState<CachedFirmwareEntry[]>([]);
  const [showCache, setShowCache] = useState(false);

  // Settings visibility
  const [showSettings, setShowSettings] = useState(false);

  // Loading states
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingCacheSettings, setSavingCacheSettings] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);

  // Load initial data
  useEffect(() => {
    const load = async () => {
      try {
        const [devicesRes, settingsRes, cacheRes, profilesRes] = await Promise.all([
          fetchDevices(),
          fetchFirmwareSettings(),
          fetchFirmwareCache(),
          fetchProfiles().catch(() => ({ profiles: [] })),
        ]);

        // Filter to only EP devices
        const epDevices = devicesRes.devices.filter(
          (d) =>
            d.manufacturer?.toLowerCase().includes('everything') ||
            d.model?.toLowerCase().includes('presence')
        );
        setDevices(epDevices);
        setProfiles(profilesRes.profiles ?? []);

        // Set settings
        setLanIpOverride(settingsRes.settings.lanIpOverride || '');
        setAutoDetectedIp(settingsRes.autoDetectedIp);
        setLanPort(settingsRes.lanPort);
        setCacheKeepCount(settingsRes.settings.cacheKeepCount ?? 3);

        // Set cache
        setCachedEntries(cacheRes.entries);
      } catch (err) {
        onErrorRef.current(
          err instanceof Error ? err.message : 'Failed to load firmware settings'
        );
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // Reset state when device changes
  const handleDeviceChange = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    setDeviceConfig(null);
    setAvailableUpdates([]);
    setSelectedUpdate(null);
    setValidation(null);
    setUpdateStatus('idle');
    setPreparedToken(null);
    setPreparedVersion(null);
    setUpdateEntityStatus(null);
    setUpdateProgress(null);
    setUpdateMonitorMessage(null);
    setMonitoringUpdate(false);
    setAvailabilityEntityId(null);
    setAvailabilityState(null);
    setRebootConfirmed(false);
    setUpdateModalOpen(false);
    setShowBuildDetails(false);
    updateMonitorRef.current = {
      attempts: 0,
      seenStart: false,
      seenInProgress: false,
      seenRebootDown: false,
      seenRebootUp: false,
      rebootStartAt: null,
    };
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      const res = await updateFirmwareSettings({
        lanIpOverride: lanIpOverride || undefined,
      });
      setAutoDetectedIp(res.autoDetectedIp);
      onSuccess('Firmware settings saved');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleCheckForUpdates = async () => {
    const device = devices.find((d) => d.id === selectedDeviceId);
    if (!device) {
      onError('Please select a device');
      return;
    }

    if (!device.model || !device.firmwareVersion) {
      onError('Device is missing required information (model or firmware version)');
      return;
    }

    setCheckingUpdates(true);
    setUpdateStatus('checking');
    setUpdateModalOpen(true);
    setDeviceConfig(null);
    setAvailableUpdates([]);
    setSelectedUpdate(null);

    try {
      // Get device config via get_build_flags service call
      const configRes = await getDeviceConfig(
        device.model,
        device.firmwareVersion,
        device.id
      );
      setDeviceConfig(configRes.config);

      if (configRes.config.configSource !== 'entities') {
        onError(buildConfigUnavailableMessage);
        setUpdateStatus('idle');
        return;
      }

      // Get available updates
      const updatesRes = await getAvailableUpdates(
        device.model,
        device.firmwareVersion,
        device.id
      );
      setAvailableUpdates(updatesRes.updates);

      if (updatesRes.hasUpdates) {
        onSuccess(`Found ${updatesRes.updates.length} available update(s)`);
      } else {
        onSuccess('Device is up to date');
      }
      setUpdateStatus('idle');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to check for updates');
      setUpdateStatus('error');
    } finally {
      setCheckingUpdates(false);
    }
  };

  const handleManualPrepare = async () => {
    if (!selectedDeviceId) {
      onError('Please select a device');
      return;
    }

    if (!manifestUrl) {
      onError('Please enter a firmware manifest URL');
      return;
    }

    const device = devices.find((d) => d.id === selectedDeviceId);
    if (!device || !device.model || !device.firmwareVersion) {
      onError('Device information incomplete');
      return;
    }

    try {
      let config = deviceConfig;
      if (!config || config.configSource !== 'entities') {
        const configRes = await getDeviceConfig(
          device.model,
          device.firmwareVersion,
          device.id
        );
        config = configRes.config;
        setDeviceConfig(configRes.config);
      }

      if (config.configSource !== 'entities') {
        onError(buildConfigUnavailableMessage);
        return;
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to read device build config');
      return;
    }

    try {
      setUpdateModalOpen(true);
      setUpdateStatus('preparing');
      setPreparedToken(null);
      setPreparedVersion(null);

      setUpdateStatus('downloading');
      const prepareRes = await prepareFirmware(selectedDeviceId, manifestUrl, {
        deviceModel: device.model,
        firmwareVersion: device.firmwareVersion,
      });

      setPreparedToken(prepareRes.token);
      setPreparedVersion(prepareRes.version);
      setUpdateStatus('ready');

      // Refresh cache list
      const cacheRes = await fetchFirmwareCache();
      setCachedEntries(cacheRes.entries);

      onSuccess(`Firmware v${prepareRes.version} prepared. Local URL: ${prepareRes.localManifestUrl}`);
    } catch (err) {
      setUpdateStatus('error');
      onError(err instanceof Error ? err.message : 'Failed to prepare firmware');
    }
  };

  const triggerUpdateOnDevice = async (token: string) => {
    if (!selectedDeviceId) {
      onError('No device selected');
      return;
    }

    const device = devices.find((d) => d.id === selectedDeviceId);
    if (!device) {
      onError('Device not found');
      return;
    }

    const mapping = await getMapping(selectedDeviceId);
    if (!mapping) {
      onError('Device mapping not found. Run entity discovery to enable update tracking.');
      return;
    }

    const availabilityKeys = [
      'presenceEntity',
      'presence',
      'mmwaveEntity',
      'mmwave',
      'pirEntity',
      'pir',
      'co2Entity',
      'co2',
      'temperatureEntity',
      'temperature',
      'humidityEntity',
      'humidity',
      'illuminanceEntity',
      'illuminance',
    ];
    const availabilityId = availabilityKeys
      .map((key) => mapping.mappings[key])
      .find((value) => typeof value === 'string' && value.trim().length > 0) || null;
    setAvailabilityEntityId(availabilityId);

    setUpdateStatus('updating');
    setUpdateProgress(null);
    setUpdateEntityStatus(null);
    setUpdateMonitorMessage('Starting firmware update...');
    setRebootConfirmed(false);
    updateMonitorRef.current = {
      attempts: 0,
      seenStart: false,
      seenInProgress: false,
      seenRebootDown: false,
      seenRebootUp: false,
      rebootStartAt: null,
    };
    await triggerFirmwareUpdate(selectedDeviceId, token);

    setMonitoringUpdate(true);
    onSuccess('Firmware update started. Monitoring progress...');
  };

  const handleSaveCacheSettings = async () => {
    if (!Number.isFinite(cacheKeepCount) || cacheKeepCount < 1) {
      onError('Cache keep count must be at least 1');
      return;
    }

    setSavingCacheSettings(true);
    try {
      const res = await updateFirmwareSettings({
        cacheKeepCount,
      });
      setCacheKeepCount(res.settings.cacheKeepCount ?? cacheKeepCount);
      onSuccess('Cache retention updated');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save cache settings');
    } finally {
      setSavingCacheSettings(false);
    }
  };

  const handleAutoInstall = async () => {
    const device = devices.find((d) => d.id === selectedDeviceId);
    if (!device || !device.model || !device.firmwareVersion) {
      onError('Device information incomplete');
      return;
    }

    if (deviceConfig?.configSource !== 'entities') {
      onError(buildConfigUnavailableMessage);
      return;
    }

    try {
      setUpdateModalOpen(true);
      setUpdateStatus('preparing');
      setPreparedToken(null);
      setPreparedVersion(null);
      setValidation(null);

      setUpdateStatus('downloading');
      const res = await autoPrepare(
        device.model,
        device.firmwareVersion,
        device.id
      );

      setPreparedToken(res.prepared.token);
      setPreparedVersion(res.newVersion);
      setValidation(res.validation);
      setUpdateStatus('ready');

      const cacheRes = await fetchFirmwareCache();
      setCachedEntries(cacheRes.entries);

      await triggerUpdateOnDevice(res.prepared.token);
    } catch (err) {
      setUpdateStatus('error');
      onError(err instanceof Error ? err.message : 'Failed to install firmware');
    }
  };

  const handleTriggerUpdate = async () => {
    if (!preparedToken) {
      onError('No prepared firmware available');
      return;
    }

    try {
      setUpdateModalOpen(true);
      await triggerUpdateOnDevice(preparedToken);
    } catch (err) {
      setUpdateStatus('error');
      onError(err instanceof Error ? err.message : 'Failed to trigger update');
    }
  };

  const handleInstallCachedEntry = async (entry: CachedFirmwareEntry) => {
    if (!selectedDeviceId || selectedDeviceId !== entry.deviceId) {
      onError('Select the matching device before installing cached firmware.');
      return;
    }

    const device = devices.find((d) => d.id === selectedDeviceId);
    if (!device || !device.model || !device.firmwareVersion) {
      onError('Device information incomplete');
      return;
    }

    try {
      let config = deviceConfig;
      if (!config || config.configSource !== 'entities') {
        const configRes = await getDeviceConfig(
          device.model,
          device.firmwareVersion,
          device.id
        );
        config = configRes.config;
        setDeviceConfig(configRes.config);
      }

      if (config.configSource !== 'entities') {
        onError(buildConfigUnavailableMessage);
        return;
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to read device build config');
      return;
    }

    try {
      setPreparedToken(entry.token);
      setPreparedVersion(entry.version);
      setUpdateModalOpen(true);
      await triggerUpdateOnDevice(entry.token);
    } catch (err) {
      setUpdateStatus('error');
      onError(err instanceof Error ? err.message : 'Failed to trigger cached firmware update');
    }
  };

  const handleDeleteCacheEntry = async (deviceId: string, token: string) => {
    if (!confirm('Delete this cached firmware?')) return;

    try {
      await deleteFirmwareCacheEntry(deviceId, token);
      setCachedEntries((prev) =>
        prev.filter((e) => !(e.deviceId === deviceId && e.token === token))
      );
      onSuccess('Cache entry deleted');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to delete cache entry');
    }
  };

  const selectedDevice = devices.find((d) => d.id === selectedDeviceId);
  const effectiveLanIp = lanIpOverride || autoDetectedIp;
  const updatesBlocked = deviceConfig?.configSource === 'inferred';
  const updatesBlockedMessage = buildConfigUnavailableMessage;
  const modalLocked = ['checking', 'preparing', 'downloading', 'updating'].includes(updateStatus);
  const showFirmwareModal = updateModalOpen || updateStatus === 'updating';
  const canInstall =
    updateStatus === 'ready' && preparedToken && deviceConfig?.configSource === 'entities';
  const configStatus = !selectedDeviceId
    ? 'No device selected'
    : deviceConfig
    ? deviceConfig.configSource === 'entities'
      ? 'Config verified'
      : 'Config unavailable'
    : 'Config not checked';
  const configStatusClass = !selectedDeviceId
    ? 'border-slate-600/60 bg-slate-800/60 text-slate-400'
    : deviceConfig?.configSource === 'entities'
    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
    : 'border-amber-500/40 bg-amber-500/10 text-amber-200';
  const updateInstalledVersion =
    typeof updateEntityStatus?.attributes?.installed_version === 'string'
      ? updateEntityStatus.attributes.installed_version
      : null;

  const parseProgress = (attributes: Record<string, unknown>): number | null => {
    const raw =
      attributes.progress ??
      attributes.percentage ??
      attributes.update_percentage ??
      attributes.update_progress ??
      attributes.percent;

    if (typeof raw === 'number') {
      return raw <= 1 ? Math.round(raw * 100) : Math.round(raw);
    }

    if (typeof raw === 'string') {
      const match = raw.match(/(\d+(\.\d+)?)/);
      if (match) {
        const value = Number.parseFloat(match[1]);
        return value <= 1 ? Math.round(value * 100) : Math.round(value);
      }
    }

    return null;
  };

  const isInProgress = (attributes: Record<string, unknown>): boolean => {
    const raw = attributes.in_progress;
    if (typeof raw === 'boolean') {
      return raw;
    }
    if (typeof raw === 'string') {
      return raw.toLowerCase() === 'true';
    }
    return false;
  };

  const normalizeState = (state: string | null | undefined) =>
    typeof state === 'string' ? state.toLowerCase() : '';

  const isUnavailableState = (state: string | null | undefined) => {
    const normalized = normalizeState(state);
    return normalized === 'unavailable' || normalized === 'unknown';
  };

  const fetchEntityState = async (entityId: string) => {
    const res = await fetch(ingressAware(`api/live/ha/states/${entityId}`));
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as { state: string; attributes: Record<string, unknown> };
  };

  useEffect(() => {
    if (!monitoringUpdate || !selectedDeviceId) {
      return;
    }

    let cancelled = false;
    const maxAttempts = 240;
    const pollIntervalMs = 3000;
    const rebootTimeoutMs = 120000;

    const poll = async () => {
      updateMonitorRef.current.attempts += 1;
      try {
        const status = await fetchFirmwareUpdateStatus(selectedDeviceId);
        if (cancelled) {
          return;
        }

        setUpdateEntityStatus(status);
        const attributes = status.attributes || {};
        const progress = parseProgress(attributes);
        const updateState = normalizeState(status.state);
        const inProgress = isInProgress(attributes) || updateState === 'installing' || updateState === 'updating';
        const installedVersion = typeof attributes.installed_version === 'string'
          ? attributes.installed_version
          : null;
        const hasStartSignal = inProgress || (progress !== null && progress > 0);

        if (progress !== null) {
          setUpdateProgress(progress);
        }

        if (hasStartSignal) {
          updateMonitorRef.current.seenStart = true;
        }

        if (inProgress) {
          updateMonitorRef.current.seenInProgress = true;
        }

        const installCompleteSignal =
          updateMonitorRef.current.seenStart &&
          !inProgress &&
          (progress === null || progress >= 100 || updateState === 'off' || updateState === 'idle');

        if (availabilityEntityId) {
          const availability = await fetchEntityState(availabilityEntityId);
          const availabilityValue = availability?.state ?? null;
          setAvailabilityState(availabilityValue);
          const isUnavailable = isUnavailableState(availabilityValue);
          if (installCompleteSignal && !updateMonitorRef.current.rebootStartAt) {
            updateMonitorRef.current.rebootStartAt = Date.now();
          }
          if (isUnavailable) {
            if (!updateMonitorRef.current.seenRebootDown) {
              updateMonitorRef.current.rebootStartAt = Date.now();
            }
            updateMonitorRef.current.seenRebootDown = true;
          }
          if (updateMonitorRef.current.seenRebootDown && !isUnavailable) {
            updateMonitorRef.current.seenRebootUp = true;
            setRebootConfirmed(true);
          }
          const rebootStartAt = updateMonitorRef.current.rebootStartAt;
          if (rebootStartAt && !updateMonitorRef.current.seenRebootUp) {
            if (Date.now() - rebootStartAt > rebootTimeoutMs) {
              setMonitoringUpdate(false);
              setUpdateStatus('error');
              onError('Timed out waiting for device to come back online. Check Home Assistant for status.');
              return;
            }
          }
        }

        const hasRebooted = updateMonitorRef.current.seenRebootDown && updateMonitorRef.current.seenRebootUp;

        if (updateMonitorRef.current.seenStart) {
          if (availabilityEntityId) {
            if (hasRebooted && installCompleteSignal) {
              if (preparedVersion && installedVersion && installedVersion !== preparedVersion) {
                setMonitoringUpdate(false);
                setUpdateStatus('error');
                onError(`Update finished but device reports v${installedVersion}. Expected v${preparedVersion}.`);
                return;
              }
              setRebootConfirmed(true);
              setMonitoringUpdate(false);
              setUpdateStatus('complete');
              onSuccess(
                `Firmware updated${installedVersion ? ` to v${installedVersion}` : ''}. Device rebooted and is back online.`
              );
              return;
            }
          } else if (installCompleteSignal) {
            if (preparedVersion && installedVersion && installedVersion !== preparedVersion) {
              setMonitoringUpdate(false);
              setUpdateStatus('error');
              onError(`Update finished but device reports v${installedVersion}. Expected v${preparedVersion}.`);
              return;
            }
            setRebootConfirmed(false);
            setMonitoringUpdate(false);
            setUpdateStatus('complete');
            onSuccess(
              `Firmware updated${installedVersion ? ` to v${installedVersion}` : ''}. Device may reboot briefly.`
            );
            return;
          }
        }

        if (!updateMonitorRef.current.seenStart) {
          setUpdateMonitorMessage('Waiting for update to begin...');
        } else if (inProgress) {
          setUpdateMonitorMessage('Installing firmware...');
        } else if (availabilityEntityId) {
          if (!updateMonitorRef.current.seenRebootDown) {
            setUpdateMonitorMessage('Waiting for device reboot...');
          } else if (!updateMonitorRef.current.seenRebootUp) {
            setUpdateMonitorMessage('Device rebooting...');
          } else {
            setUpdateMonitorMessage('Verifying update...');
          }
        } else {
          setUpdateMonitorMessage('Finalizing update...');
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
        const message = err instanceof Error ? err.message : '';
        if (message.includes('ENTITY_NOT_FOUND') || message.includes('MAPPING_NOT_FOUND')) {
          setMonitoringUpdate(false);
          setUpdateMonitorMessage('Update entity not mapped. Run entity discovery to enable progress tracking.');
          return;
        }
        if (message.includes('404')) {
          setMonitoringUpdate(false);
          setUpdateMonitorMessage('Update status unavailable. Check Home Assistant for progress.');
          return;
        }
      }

      if (updateMonitorRef.current.attempts >= maxAttempts) {
        setMonitoringUpdate(false);
        setUpdateStatus('error');
        onError('Timed out waiting for firmware update status. Check Home Assistant for progress.');
      }
    };

    poll();
    const interval = setInterval(poll, pollIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [monitoringUpdate, selectedDeviceId, preparedVersion, availabilityEntityId, onError, onSuccess]);

  // Format device config for display
  const formatDeviceConfig = (config: DeviceConfig) => {
    const features: string[] = [];
    if (config.bluetooth_enabled) features.push('BLE');
    if (config.co2_enabled) features.push('CO2');
    if (config.ethernet_enabled) features.push('Ethernet');
    return features.length > 0 ? features.join(', ') : 'None';
  };

  const normalizeValue = (value?: string) => value?.trim().toLowerCase() ?? '';

  const getDeviceProfile = (device: DiscoveredDevice): DeviceProfile | null => {
    if (!profiles.length) return null;
    const model = normalizeValue(device.model);
    const name = normalizeValue(device.name);
    const manufacturer = normalizeValue(device.manufacturer);
    const matchKey = model || name;
    const byModel = profiles.find((profile) => {
      const profileModel = normalizeValue((profile as DeviceProfile & { model?: string }).model);
      const profileLabel = normalizeValue(profile.label);
      const profileManufacturer = normalizeValue(profile.manufacturer);
      const modelMatch = profileModel && profileModel === matchKey;
      const labelMatch = profileLabel && profileLabel === matchKey;
      const manufacturerMatch =
        !manufacturer || !profileManufacturer || profileManufacturer === manufacturer;
      return (modelMatch || labelMatch) && manufacturerMatch;
    });
    if (byModel) return byModel;
    if (matchKey) {
      const matchId = profiles.find((profile) => {
        const profileId = normalizeValue(profile.id).replace(/_/g, ' ');
        return profileId && matchKey.includes(profileId);
      });
      return matchId ?? null;
    }
    return null;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-700 border-t-cyan-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {showFirmwareModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center">
          <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" />
          <div className="relative z-10 w-full max-w-lg mx-4 rounded-2xl border border-slate-700/50 bg-slate-900/95 shadow-2xl">
            <div className="flex items-start justify-between px-6 pt-6">
              <div>
                <div className="text-lg font-semibold text-white">Firmware Update</div>
                <div className="text-xs text-slate-400">
                  {selectedDevice
                    ? `${selectedDevice.name}${selectedDevice.firmwareVersion ? ` | v${selectedDevice.firmwareVersion}` : ''}`
                    : 'Select a device to begin'}
                </div>
              </div>
              {!modalLocked && (
                <button
                  type="button"
                  onClick={() => setUpdateModalOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700/60 text-slate-400 transition hover:border-slate-600 hover:text-slate-200"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            <div className="p-6 pt-4 space-y-4">
              {updateStatus === 'checking' && (
                <div className="flex items-center gap-3 rounded-xl border border-cyan-500/40 bg-cyan-500/10 p-4 text-sm text-cyan-100">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-cyan-300 border-t-transparent" />
                  Checking for the latest firmware and reading device configuration...
                </div>
              )}

              {updateStatus === 'preparing' && (
                <div className="flex items-center gap-3 rounded-xl border border-cyan-500/40 bg-cyan-500/10 p-4 text-sm text-cyan-100">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-cyan-300 border-t-transparent" />
                  Preparing firmware for this device...
                </div>
              )}

              {updateStatus === 'downloading' && (
                <div className="flex items-center gap-3 rounded-xl border border-cyan-500/40 bg-cyan-500/10 p-4 text-sm text-cyan-100">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-cyan-300 border-t-transparent" />
                  Downloading firmware from the remote server...
                </div>
              )}

              {updateStatus === 'updating' && (
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="relative h-14 w-14">
                      <div className="absolute inset-0 rounded-full border-4 border-cyan-500/20 animate-ping" />
                      <div className="absolute inset-0 rounded-full border-4 border-cyan-400 border-t-transparent animate-spin" />
                      <div className="absolute inset-2 rounded-full bg-cyan-500/10 animate-pulse" />
                    </div>
                    <div>
                      <div className="text-base font-semibold text-cyan-100">Installing firmware</div>
                      <div className="text-xs text-slate-400">
                        {updateMonitorMessage || 'Working on it...'}
                      </div>
                    </div>
                  </div>
                  {updateProgress !== null ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-cyan-100">
                        <span>Progress</span>
                        <span>{updateProgress}%</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-slate-700/70 overflow-hidden">
                        <div
                          className="h-2 rounded-full bg-cyan-400 transition-all duration-500"
                          style={{ width: `${Math.min(100, Math.max(0, updateProgress))}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400">Waiting for update progress...</div>
                  )}
                  {updateEntityStatus && (
                    <div className="text-xs text-slate-400">
                      Update entity: {updateEntityStatus.state}
                      {updateInstalledVersion ? ` | Installed: ${updateInstalledVersion}` : ''}
                    </div>
                  )}
                  <div className="text-[11px] text-slate-500">
                    This can take a few minutes. If the device stays offline for 2 minutes, we will stop waiting.
                    Keep this window open while the update completes.
                  </div>
                </div>
              )}

              {updateStatus === 'ready' && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-100">
                    Firmware {preparedVersion ? `v${preparedVersion}` : 'update'} is ready to install.
                  </div>
                  {validation && validation.warnings.length > 0 && (
                    <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-4">
                      <h4 className="mb-2 text-sm font-semibold text-amber-200">Warnings</h4>
                      <ul className="space-y-1 text-xs text-amber-200">
                        {validation.warnings.map((issue, index) => (
                          <li key={index}>{issue.message}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {canInstall && (
                    <button
                      onClick={handleTriggerUpdate}
                      className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500"
                    >
                      Install on Device
                    </button>
                  )}
                </div>
              )}

              {updateStatus === 'complete' && (
                <div className="space-y-4">
                  <div className="flex items-start gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-100">
                    <div className="relative mt-0.5 flex h-10 w-10 items-center justify-center rounded-full border border-emerald-400/50 bg-emerald-500/20">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/30" />
                      <svg
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                        className="relative h-5 w-5 text-emerald-200"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-emerald-100">
                        Firmware update successful
                      </div>
                      <div className="text-xs text-emerald-100/90">
                        Firmware updated{updateInstalledVersion ? ` to v${updateInstalledVersion}` : preparedVersion ? ` to v${preparedVersion}` : ''}.{' '}
                        {rebootConfirmed ? 'Device rebooted and is back online.' : 'Device may reboot briefly.'}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setUpdateModalOpen(false)}
                    className="w-full rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-slate-700"
                  >
                    Close
                  </button>
                </div>
              )}

              {updateStatus === 'error' && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-rose-500/50 bg-rose-500/10 p-4 text-sm text-rose-100">
                    Update failed. Check the error message above or Home Assistant for details.
                  </div>
                  <button
                    type="button"
                    onClick={() => setUpdateModalOpen(false)}
                    className="w-full rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-slate-700"
                  >
                    Close
                  </button>
                </div>
              )}

              {updateStatus === 'idle' && updateModalOpen && (
                <div className="space-y-4">
                  {!deviceConfig && (
                    <div className="rounded-xl border border-slate-700/60 bg-slate-800/40 p-4 text-sm text-slate-300">
                      Ready to check for updates.
                    </div>
                  )}

                  {deviceConfig?.configSource === 'inferred' && (
                    <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-4">
                      <h4 className="mb-2 text-sm font-semibold text-amber-200">Build Configuration Unavailable</h4>
                      <p className="mb-3 text-xs text-amber-200">
                        This device did not return its build configuration via the get_build_flags service.
                        To avoid installing incompatible firmware, updates are disabled.
                      </p>
                      <p className="mb-3 text-xs text-amber-200">
                        Flash the latest firmware via USB to enable over-the-air updates in this add-on.
                      </p>
                      <a
                        href="https://docs.everythingsmart.io"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-500"
                      >
                        View Flashing Instructions
                      </a>
                    </div>
                  )}

                  {deviceConfig?.configSource === 'entities' && availableUpdates.length > 0 && (
                    <div className="space-y-3">
                      {availableUpdates.map((update, index) => (
                        <div
                          key={index}
                          className={`rounded-xl border p-3 cursor-pointer transition ${
                            selectedUpdate === update
                              ? 'border-emerald-400 bg-emerald-500/20'
                              : 'border-slate-600/50 bg-slate-800/30 hover:border-emerald-500/50'
                          }`}
                          onClick={() => setSelectedUpdate(update)}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="text-sm font-semibold text-emerald-300">
                                v{update.newVersion}
                              </span>
                              <span className="ml-2 text-xs text-slate-400">
                                ({update.channel})
                              </span>
                            </div>
                            <span className="text-xs text-slate-500">
                              from v{update.currentVersion}
                            </span>
                          </div>
                          {update.releaseNotes && (
                            <p className="mt-1 text-xs text-slate-400">{update.releaseNotes}</p>
                          )}
                          {update.migration && (
                            <div className="mt-2 rounded border border-amber-500/50 bg-amber-500/10 p-2 text-xs text-amber-200">
                              <strong>Migration Required:</strong> {update.migration.description}
                              {update.migration.backupRequired && (
                                <span className="ml-1 text-amber-400">(Backup recommended)</span>
                              )}
                            </div>
                          )}
                        </div>
                      ))}

                      <button
                        onClick={handleAutoInstall}
                        disabled={
                          updateStatus === 'preparing' ||
                          updateStatus === 'downloading' ||
                          updateStatus === 'updating'
                        }
                        className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Install Latest Update
                      </button>
                    </div>
                  )}

                  {deviceConfig?.configSource === 'entities' && availableUpdates.length === 0 && (
                    <div className="rounded-xl border border-slate-700/60 bg-slate-800/40 p-4 text-center">
                      <div className="text-sm text-slate-300">Your device is running the latest firmware.</div>
                      <div className="mt-3">
                        <button
                          onClick={handleAutoInstall}
                          disabled={
                            updateStatus === 'preparing' ||
                            updateStatus === 'downloading' ||
                            updateStatus === 'updating'
                          }
                          className="rounded-lg border border-slate-600 bg-slate-700 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Reinstall Latest Firmware
                        </button>
                      </div>
                    </div>
                  )}

                  {validation && validation.warnings.length > 0 && (
                    <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-4">
                      <h4 className="mb-2 text-sm font-semibold text-amber-200">Warnings</h4>
                      <ul className="space-y-1 text-xs text-amber-200">
                        {validation.warnings.map((issue, index) => (
                          <li key={index}>{issue.message}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-700/60 bg-gradient-to-br from-slate-900/90 via-slate-900/70 to-slate-800/50 p-6 shadow-lg">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Firmware Update</h2>
            <p className="text-xs text-slate-400">
              Safely update your device using its build configuration and the local proxy.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            {selectedDevice && (
              <span className="rounded-full border border-slate-700/70 bg-slate-800/60 px-3 py-1 text-slate-300">
                {selectedDevice.name}
              </span>
            )}
            <span className={`rounded-full border px-3 py-1 ${configStatusClass}`}>
              {configStatus}
            </span>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-700/60 bg-slate-900/50 p-5 shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-sm font-semibold text-cyan-200">
              1
            </span>
            <div>
              <h3 className="text-sm font-semibold text-slate-200">Select device</h3>
              <p className="text-xs text-slate-500">Pick a device, then check for updates in the modal.</p>
            </div>
          </div>
        </div>

        <div className="mt-4">
          {devices.length === 0 ? (
            <div className="rounded-lg border border-slate-700/60 bg-slate-800/40 p-4 text-sm text-slate-400">
              No Everything Presence devices found yet.
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {devices.map((device) => {
                const profile = getDeviceProfile(device);
                const iconUrl = profile?.iconUrl;
                const isSelected = device.id === selectedDeviceId;

                return (
                  <button
                    type="button"
                    key={device.id}
                    onClick={() => handleDeviceChange(device.id)}
                    className={`group w-full rounded-xl border p-4 text-left transition ${
                      isSelected
                        ? 'border-cyan-400/70 bg-cyan-500/10 shadow-[0_0_0_1px_rgba(34,211,238,0.35)]'
                        : 'border-slate-700/60 bg-slate-800/40 hover:border-cyan-500/40 hover:bg-slate-800/70'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-slate-700/60 bg-slate-900/60">
                        {iconUrl ? (
                          <img
                            src={iconUrl}
                            alt={`${device.name} icon`}
                            className="h-10 w-10 object-contain"
                            loading="lazy"
                          />
                        ) : (
                          <span className="text-[10px] font-semibold text-slate-400">EP</span>
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-slate-100">{device.name}</span>
                          {isSelected && (
                            <span className="rounded-full border border-cyan-400/60 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-100">
                              Selected
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-400">
                          {device.model || profile?.label || 'Unknown model'}
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500">
                          {device.firmwareVersion ? `v${device.firmwareVersion}` : 'Firmware unknown'}
                          {device.areaName ? ` | ${device.areaName}` : ''}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            onClick={handleCheckForUpdates}
            disabled={!selectedDeviceId || checkingUpdates}
            className="w-full rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {checkingUpdates ? (
              <span className="flex items-center justify-center gap-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Checking for updates...
              </span>
            ) : (
              'Check for Updates'
            )}
          </button>
          {selectedDevice && (
            <div className="text-[11px] text-slate-500">
              {selectedDevice.firmwareVersion
                ? `Current firmware v${selectedDevice.firmwareVersion}`
                : 'Firmware version unknown'}
            </div>
          )}
        </div>

        {deviceConfig && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setShowBuildDetails((prev) => !prev)}
              className="flex w-full items-center justify-between text-sm font-semibold text-slate-200"
            >
              <span>Build configuration</span>
              <span className="text-slate-400">{showBuildDetails ? '-' : '+'}</span>
            </button>

            {showBuildDetails && (
              <div className="mt-3 rounded-xl border border-slate-700/60 bg-slate-900/40 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                    Build Configuration
                  </div>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] ${
                      deviceConfig.configSource === 'entities'
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                        : 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                    }`}
                  >
                    {deviceConfig.configSource === 'entities' ? 'Reported by device' : 'Inferred'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-slate-400">
                  <div>
                    <span className="text-slate-500">Model:</span>{' '}
                    <span className="text-slate-300">{deviceConfig.model}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Channel:</span>{' '}
                    <span className="text-slate-300">{deviceConfig.firmware_channel}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Features:</span>{' '}
                    <span className="text-slate-300">{formatDeviceConfig(deviceConfig)}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Sensor:</span>{' '}
                    <span className="text-slate-300">{deviceConfig.sensor_variant || 'Default'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Board Rev:</span>{' '}
                    <span className="text-slate-300">{deviceConfig.board_revision}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Network:</span>{' '}
                    <span className="text-slate-300">{deviceConfig.ethernet_enabled ? 'Ethernet' : 'WiFi'}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-700/60 bg-slate-900/50 p-5 shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">Advanced options</h3>
            <p className="text-xs text-slate-500">Manual manifest, LAN proxy, and cache controls.</p>
          </div>
        </div>

        <div className="mt-4 divide-y divide-slate-700/60">
          <div className="py-4">
            <button
              onClick={() => setShowManualMode(!showManualMode)}
              className="flex w-full items-center justify-between text-sm font-semibold text-slate-200"
            >
              <span>Manual Firmware URL</span>
              <span className="text-slate-400">{showManualMode ? '-' : '+'}</span>
            </button>

            {showManualMode && (
              <div className="mt-3 space-y-3">
                {updatesBlocked && (
                  <div className="rounded border border-amber-500/50 bg-amber-500/10 p-2 text-xs text-amber-200">
                    {updatesBlockedMessage}
                  </div>
                )}
                <div>
                  <label className="mb-1 block text-xs text-slate-400">
                    Firmware Manifest URL
                  </label>
                  <input
                    type="text"
                    value={manifestUrl}
                    onChange={(e) => setManifestUrl(e.target.value)}
                    placeholder="https://example.com/firmware/manifest.json"
                    disabled={updatesBlocked}
                    className="w-full rounded border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Enter the full URL to the firmware manifest.json file
                  </p>
                </div>
                <button
                  onClick={handleManualPrepare}
                  disabled={
                    !selectedDeviceId ||
                    !manifestUrl ||
                    updatesBlocked ||
                    updateStatus === 'preparing' ||
                    updateStatus === 'downloading' ||
                    updateStatus === 'updating'
                  }
                  className="w-full rounded-lg bg-slate-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {updateStatus === 'preparing' || updateStatus === 'downloading'
                    ? 'Preparing...'
                    : 'Download and Prepare Manual Firmware'}
                </button>
              </div>
            )}
          </div>

          <div className="py-4">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="flex w-full items-center justify-between text-sm font-semibold text-slate-200"
            >
              <span>LAN Configuration</span>
              <span className="text-slate-400">{showSettings ? '-' : '+'}</span>
            </button>

            {showSettings && (
              <div className="mt-3 space-y-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-400">
                    Auto-detected LAN IP
                  </label>
                  <div className="rounded border border-slate-600 bg-slate-700/50 px-3 py-2 text-sm text-slate-300">
                    {autoDetectedIp || 'Could not detect'}
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">
                    LAN IP Override (optional)
                  </label>
                  <input
                    type="text"
                    value={lanIpOverride}
                    onChange={(e) => setLanIpOverride(e.target.value)}
                    placeholder="e.g., 192.168.1.100"
                    className="w-full rounded border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">
                    Firmware Server URL (devices will download from here)
                  </label>
                  <div className="rounded border border-slate-600 bg-slate-700/50 px-3 py-2 text-sm text-cyan-400">
                    http://{effectiveLanIp}:{lanPort}
                  </div>
                </div>
                <button
                  onClick={handleSaveSettings}
                  disabled={savingSettings}
                  className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:opacity-50"
                >
                  {savingSettings ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            )}
          </div>

          <div className="py-4">
            <button
              onClick={() => setShowCache(!showCache)}
              className="flex w-full items-center justify-between text-sm font-semibold text-slate-200"
            >
              <span>Cached Firmware ({cachedEntries.length})</span>
              <span className="text-slate-400">{showCache ? '-' : '+'}</span>
            </button>

            {showCache && (
              <div className="mt-3 space-y-3">
                {cachedEntries.length === 0 ? (
                  <div className="py-4 text-center text-sm text-slate-500">
                    No cached firmware
                  </div>
                ) : (
                  cachedEntries.map((entry) => {
                    const device = devices.find((d) => d.id === entry.deviceId);
                    const isMatchingDevice = selectedDeviceId === entry.deviceId;
                    const installDisabled =
                      !isMatchingDevice ||
                      updateStatus === 'preparing' ||
                      updateStatus === 'downloading' ||
                      updateStatus === 'updating';
                    return (
                      <div
                        key={`${entry.deviceId}-${entry.token}`}
                        className="flex items-center justify-between rounded border border-slate-700/50 bg-slate-800/40 p-3"
                      >
                        <div className="text-xs">
                          <div className="font-semibold text-slate-200">
                            {device?.name || entry.deviceId}
                          </div>
                          <div className="text-slate-400">
                            Version: {entry.version} | Files: {entry.binaryCount}
                          </div>
                          <div className="text-slate-500">
                            Cached: {new Date(entry.cachedAt).toLocaleString()}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleInstallCachedEntry(entry)}
                            disabled={installDisabled}
                            className="rounded bg-cyan-600/20 px-2 py-1 text-xs text-cyan-200 transition hover:bg-cyan-600/30 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isMatchingDevice ? 'Install' : 'Select device'}
                          </button>
                          <button
                            onClick={() => handleDeleteCacheEntry(entry.deviceId, entry.token)}
                            className="rounded bg-rose-600/20 px-2 py-1 text-xs text-rose-300 transition hover:bg-rose-600/30"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}

                <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-3">
                  <label className="mb-1 block text-xs text-slate-400">
                    Versions to keep per device
                  </label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={cacheKeepCount}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      setCacheKeepCount(Number.isFinite(value) && value > 0 ? value : 1);
                    }}
                    className="w-full rounded border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Keeps the most recent distinct firmware versions per device.
                  </p>
                  <button
                    onClick={handleSaveCacheSettings}
                    disabled={savingCacheSettings}
                    className="mt-2 rounded-lg bg-cyan-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-cyan-500 disabled:opacity-50"
                  >
                    {savingCacheSettings ? 'Saving...' : 'Save Cache Settings'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-slate-700/40 bg-slate-800/30 p-3 text-xs text-slate-500">
          <p className="mb-2">
            <strong>How it works:</strong> Use "Check for Updates" to read the device build config and match
            compatible firmware.
          </p>
          <p>
            <strong>Manual mode:</strong> If auto-detection fails, provide a manifest URL to prepare firmware
            directly.
          </p>
        </div>
      </div>
    </div>
  );
};
