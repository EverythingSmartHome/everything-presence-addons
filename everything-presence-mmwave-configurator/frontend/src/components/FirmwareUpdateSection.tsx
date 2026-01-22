import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  fetchFirmwareMigrationState,
  saveFirmwareMigrationState,
  clearFirmwareMigrationState,
  fetchDeviceReadiness,
  ingressAware,
  fetchZoneBackups,
  createZoneBackup,
  restoreZoneBackup,
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
  ZoneBackup,
  ZoneRect,
  ZonePolygon,
} from '../api/types';
import { useDeviceMappings } from '../contexts/DeviceMappingsContext';
import { DeviceMapping, discoverAndSaveMapping } from '../api/deviceMappings';
import { fetchPolygonZonesFromDevice } from '../api/zones';
import { compareVersions, getZoneMigrationThreshold, requiresZoneMigration } from '../utils/firmware';
import polygonMigrationGraphic from '../assets/polygon-migration.png';

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
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => {
    onErrorRef.current = onError;
    onSuccessRef.current = onSuccess;
  }, [onError, onSuccess]);

  const migrationDebugEnabled =
    typeof window !== 'undefined' && window.localStorage.getItem('ep_debug_migration') === '1';
  const debugMigration = useCallback(
    (message: string, payload?: unknown) => {
      if (!migrationDebugEnabled) return;
      // eslint-disable-next-line no-console
      console.log(`[EP migration] ${message}`, payload ?? '');
    },
    [migrationDebugEnabled],
  );

  // Devices state
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [profiles, setProfiles] = useState<DeviceProfile[]>([]);

  // Zone backup state (for migration flow)
  const [zoneBackups, setZoneBackups] = useState<ZoneBackup[]>([]);
  const [backupMapping, setBackupMapping] = useState<DeviceMapping | null>(null);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const [restoreWarnings, setRestoreWarnings] = useState<Array<{ entityId?: string; description: string; error: string }> | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [lastBackupId, setLastBackupId] = useState<string | null>(null);
  const [migrationPhase, setMigrationPhase] = useState<'idle' | 'prompt' | 'backing_up' | 'installing' | 'resync_wait' | 'resyncing' | 'restoring' | 'verifying' | 'complete' | 'error'>('idle');
  const [migrationBackupId, setMigrationBackupId] = useState<string | null>(null);
  const [migrationError, setMigrationError] = useState<string | null>(null);
  const [migrationErrorStep, setMigrationErrorStep] = useState<'backup' | 'install' | 'resync' | 'restore' | 'verify' | null>(null);
  const [migrationVerificationStatus, setMigrationVerificationStatus] = useState<'idle' | 'running' | 'success' | 'warning' | 'error'>('idle');
  const [migrationVerificationMessage, setMigrationVerificationMessage] = useState<string | null>(null);
  const [resyncStepMessage, setResyncStepMessage] = useState<string | null>(null);
  const migrationStepStartRef = useRef<Record<string, number>>({});
  const { getMapping, refreshMapping } = useDeviceMappings();

  const ensureMappedService = useCallback(
    async (
      deviceId: string,
      serviceKey: 'getBuildFlags' | 'setUpdateManifest',
      label: string,
    ): Promise<DeviceMapping | null> => {
      const mapping = backupMapping ?? (await getMapping(deviceId));
      const mapped = mapping?.serviceMappings?.[serviceKey];
      if (!mapped) {
        onErrorRef.current(
          `${label} service not mapped. Run re-sync entities and confirm firmware services.`,
        );
        return null;
      }
      return mapping ?? null;
    },
    [backupMapping, getMapping],
  );

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
  const isMountedRef = useRef(true);
  const migrationDeviceIdRef = useRef<string>('');
  const resyncInFlightRef = useRef(false);
  const resyncWaitResolveRef = useRef<(() => void) | null>(null);
  const resyncWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startResyncFlowRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const MIN_STEP_MS = 1200;
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const markStepStart = (key: string) => {
    migrationStepStartRef.current[key] = Date.now();
  };
  const ensureMinStepDuration = async (key: string, minMs: number = MIN_STEP_MS) => {
    const start = migrationStepStartRef.current[key];
    if (!start) return;
    const elapsed = Date.now() - start;
    if (elapsed < minMs) {
      await sleep(minMs - elapsed);
    }
  };
  const withTimeout = async <T,>(promise: Promise<T>, ms: number, message: string): Promise<T> => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(message)), ms);
    });
    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  };

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

  useEffect(() => {
    if (!selectedDeviceId) {
      setZoneBackups([]);
      setBackupMapping(null);
      setLastBackupId(null);
      return;
    }

    let cancelled = false;
    const loadBackups = async () => {
      try {
        const [backupsRes, mapping] = await Promise.all([
          fetchZoneBackups(selectedDeviceId),
          getMapping(selectedDeviceId),
        ]);
        if (cancelled) return;
        setZoneBackups(backupsRes.backups ?? []);
        setBackupMapping(mapping);
      } catch (err) {
        if (cancelled) return;
        onErrorRef.current(
          err instanceof Error ? err.message : 'Failed to load zone backups'
        );
      }
    };

    loadBackups();

    return () => {
      cancelled = true;
    };
  }, [selectedDeviceId, getMapping]);

  // Reset state when device changes
  const handleDeviceChange = (deviceId: string) => {
    debugMigration('handleDeviceChange', { deviceId });
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
    setZoneBackups([]);
    setBackupMapping(null);
    setCreatingBackup(false);
    setRestoringBackup(false);
    setRestoreWarnings(null);
    setRestoreError(null);
    setLastBackupId(null);
    setMigrationPhase('idle');
    setMigrationBackupId(null);
    setMigrationError(null);
    setMigrationErrorStep(null);
    setMigrationVerificationStatus('idle');
    setMigrationVerificationMessage(null);
    updateMonitorRef.current = {
      attempts: 0,
      seenStart: false,
      seenInProgress: false,
      seenRebootDown: false,
      seenRebootUp: false,
      rebootStartAt: null,
    };
    migrationDeviceIdRef.current = deviceId;
    try {
      window.sessionStorage.setItem('ep_migration_device_id', deviceId);
    } catch {
      // ignore
    }
  };

  const isPersistableMigrationPhase = (
    phase: typeof migrationPhase,
  ): phase is Exclude<typeof migrationPhase, 'idle' | 'prompt'> => phase !== 'idle' && phase !== 'prompt';

  // Resume an in-progress migration after a UI reload.
  useEffect(() => {
    if (!selectedDeviceId) {
      return;
    }

    let cancelled = false;
    fetchFirmwareMigrationState(selectedDeviceId)
      .then(({ state }) => {
        if (cancelled || !state) return;
        if (migrationPhase !== 'idle') return;
        if (!['backing_up', 'installing', 'resync_wait', 'resyncing', 'restoring', 'verifying'].includes(state.phase)) {
          return;
        }

        migrationDeviceIdRef.current = state.deviceId;
        if (state.backupId) {
          setMigrationBackupId(state.backupId);
        }
        if (state.preparedVersion) {
          setPreparedVersion((prev) => prev ?? state.preparedVersion);
        }

        setUpdateModalOpen(true);
        setMigrationPhase(state.phase);
        if (state.phase === 'installing') {
          setUpdateStatus((prev) => (prev === 'idle' ? 'updating' : prev));
          setMonitoringUpdate(true);
        }
      })
      .catch(() => null);

    return () => {
      cancelled = true;
    };
  }, [selectedDeviceId, migrationPhase]);

  // Persist migration progress to backend so the flow survives reloads.
  useEffect(() => {
    const deviceId = migrationDeviceIdRef.current || selectedDeviceId;
    if (!deviceId) return;

    if (!isPersistableMigrationPhase(migrationPhase)) {
      clearFirmwareMigrationState(deviceId).catch(() => null);
      return;
    }

    saveFirmwareMigrationState(deviceId, {
      phase: migrationPhase,
      backupId: migrationBackupId ?? null,
      preparedVersion: preparedVersion ?? null,
      lastError: migrationError ?? null,
    }).catch(() => null);
  }, [migrationPhase, migrationBackupId, migrationError, preparedVersion, selectedDeviceId]);

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
      const mapping = await ensureMappedService(device.id, 'getBuildFlags', 'Build flags');
      if (!mapping) {
        setUpdateStatus('idle');
        return;
      }

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
    resetMigrationFlow();
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
      const mapping = await ensureMappedService(selectedDeviceId, 'getBuildFlags', 'Build flags');
      if (!mapping) {
        return;
      }

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
    if (!mapping.serviceMappings?.setUpdateManifest) {
      onError('Update manifest service not mapped. Run re-sync entities and confirm firmware services.');
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
    resetMigrationFlow();
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

      const migrationInfo = getZoneMigrationInfo(
        device.firmwareVersion,
        res.newVersion,
        device.model,
        null
      );
      if (migrationInfo?.required) {
        promptMigration();
        return;
      }

      await triggerUpdateOnDevice(res.prepared.token);
    } catch (err) {
      setUpdateStatus('error');
      onError(err instanceof Error ? err.message : 'Failed to install firmware');
    }
  };

  const handleTriggerUpdate = async () => {
    resetMigrationFlow();
    if (!preparedToken) {
      onError('No prepared firmware available');
      return;
    }

    try {
      setUpdateModalOpen(true);
      if (preparedMigration?.required) {
        promptMigration();
        return;
      }
      await triggerUpdateOnDevice(preparedToken);
    } catch (err) {
      setUpdateStatus('error');
      onError(err instanceof Error ? err.message : 'Failed to trigger update');
    }
  };

  const handleInstallCachedEntry = async (entry: CachedFirmwareEntry) => {
    resetMigrationFlow();
    if (!selectedDeviceId || selectedDeviceId !== entry.deviceId) {
      onError('Select the matching device before installing cached firmware.');
      return;
    }

    const device = devices.find((d) => d.id === selectedDeviceId);
    if (!device || !device.model || !device.firmwareVersion) {
      onError('Device information incomplete');
      return;
    }

    const mapping = await ensureMappedService(selectedDeviceId, 'getBuildFlags', 'Build flags');
    if (!mapping) {
      return;
    }

    let config = deviceConfig;
    try {
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

    const migrationGate = getZoneMigrationInfo(
      backupMapping?.firmwareVersion ?? backupMapping?.rawSwVersion ?? device.firmwareVersion,
      entry.version,
      config?.model ?? device.model,
      null
    );
    if (migrationGate?.required) {
      setPreparedToken(entry.token);
      setPreparedVersion(entry.version);
      setUpdateStatus('ready');
      setUpdateModalOpen(true);
      promptMigration();
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

  const resolveBackupContext = useCallback(async () => {
    if (!selectedDeviceId) {
      onErrorRef.current('Please select a device');
      return null;
    }

    const device = devices.find((d) => d.id === selectedDeviceId);
    if (!device) {
      onErrorRef.current('Device not found');
      return null;
    }

    const mapping = backupMapping ?? (await getMapping(selectedDeviceId));
    const profileId = mapping?.profileId ?? getDeviceProfile(device)?.id ?? '';
    const entityNamePrefix = device.entityNamePrefix || undefined;

    if (!profileId) {
      onErrorRef.current('Device profile not found. Run entity discovery to sync the device.');
      return null;
    }

    if (!mapping && !entityNamePrefix) {
      onErrorRef.current('Entity name prefix missing. Run entity discovery or link the device to a room.');
      return null;
    }

    return { device, profileId, entityNamePrefix };
  }, [selectedDeviceId, devices, backupMapping, getMapping]);

  const handleCreateZoneBackup = async (): Promise<ZoneBackup | null> => {
    const context = await resolveBackupContext();
    if (!context) return null;

    setCreatingBackup(true);
    setRestoreWarnings(null);
    setRestoreError(null);
    try {
      const result = await createZoneBackup({
        deviceId: context.device.id,
        profileId: context.profileId,
        entityNamePrefix: context.entityNamePrefix,
      });
      setZoneBackups((prev) => {
        const next = [result.backup, ...prev.filter((b) => b.id !== result.backup.id)];
        next.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        return next;
      });
      setLastBackupId(result.backup.id);
      onSuccess('Zone backup created.');
      return result.backup;
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to create zone backup');
      return null;
    } finally {
      setCreatingBackup(false);
    }
  };

  const handleRestoreZoneBackup = useCallback(async (backupId: string): Promise<boolean> => {
    const context = await resolveBackupContext();
    if (!context) return false;

    setRestoringBackup(true);
    setRestoreWarnings(null);
    setRestoreError(null);
    try {
      const res = await restoreZoneBackup(backupId, {
        deviceId: context.device.id,
        profileId: context.profileId,
        entityNamePrefix: context.entityNamePrefix,
      });
      if (res.warnings && res.warnings.length > 0) {
        setRestoreWarnings(res.warnings);
        onSuccessRef.current('Zones restored with warnings. Review the details below.');
      } else {
        onSuccessRef.current('Zones restored as polygons.');
      }
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to restore zone backup';
      setRestoreError(message);
      onErrorRef.current(message);
      return false;
    } finally {
      setRestoringBackup(false);
    }
  }, [resolveBackupContext]);

  const getZoneMigrationInfo = (
    currentVersion: string | undefined,
    targetVersion: string | undefined,
    model?: string | null,
    migration?: AvailableUpdate['migration'] | null
  ): { required: boolean; backupRequired: boolean; description: string; threshold?: string } | null => {
    if (migration?.id === 'rectangular-to-polygon-zones') {
      return {
        required: true,
        backupRequired: migration.backupRequired ?? true,
        description: migration.description || 'Rectangular zones are replaced with polygon zones.',
      };
    }

    const threshold = getZoneMigrationThreshold(model ?? undefined);
    const required = requiresZoneMigration(currentVersion, targetVersion, model ?? undefined);
    if (!threshold || required !== true) {
      return null;
    }

    return {
      required: true,
      backupRequired: true,
      description: `Rectangular zones are removed in v${threshold}.`,
      threshold,
    };
  };

  const parseZoneIndex = (id: string): number => {
    const match = id.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  };

  const sortZonesByIndex = (zones: ZoneRect[]): ZoneRect[] =>
    [...zones].sort((a, b) => parseZoneIndex(a.id) - parseZoneIndex(b.id));

  const isValidRect = (zone: ZoneRect): boolean =>
    Number.isFinite(zone.width) && Number.isFinite(zone.height) && zone.width > 0 && zone.height > 0;

  const rectToPolygon = (rect: ZoneRect): ZonePolygon => ({
    id: rect.id,
    type: rect.type,
    vertices: [
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.width, y: rect.y },
      { x: rect.x + rect.width, y: rect.y + rect.height },
      { x: rect.x, y: rect.y + rect.height },
    ],
    enabled: rect.enabled,
    label: rect.label,
  });

  const normalizeVertices = (vertices: ZonePolygon['vertices']) =>
    vertices.map((v) => ({ x: Math.round(v.x), y: Math.round(v.y) }));

  const verticesMatch = (expected: ZonePolygon['vertices'], actual: ZonePolygon['vertices']): boolean => {
    if (expected.length !== actual.length) return false;
    const normalizedExpected = normalizeVertices(expected);
    const normalizedActual = normalizeVertices(actual);
    for (let i = 0; i < normalizedExpected.length; i += 1) {
      if (Math.abs(normalizedExpected[i].x - normalizedActual[i].x) > 1) return false;
      if (Math.abs(normalizedExpected[i].y - normalizedActual[i].y) > 1) return false;
    }
    return true;
  };

  const buildExpectedPolygons = (backup: ZoneBackup, limits: DeviceProfile['limits'] | undefined): ZonePolygon[] => {
    const maxZones = limits?.maxZones ?? 4;
    const maxExclusion = limits?.maxExclusionZones ?? 2;
    const maxEntry = limits?.maxEntryZones ?? 2;

    const regularZones = sortZonesByIndex(
      backup.zones.filter((zone) => zone.type === 'regular' && isValidRect(zone))
    ).slice(0, maxZones);
    const exclusionZones = sortZonesByIndex(
      backup.zones.filter((zone) => zone.type === 'exclusion' && isValidRect(zone))
    ).slice(0, maxExclusion);
    const entryZones = sortZonesByIndex(
      backup.zones.filter((zone) => zone.type === 'entry' && isValidRect(zone))
    ).slice(0, maxEntry);

    return [
      // IMPORTANT: restore writes zones sequentially into slot 1..N regardless of original slot index.
      // If a backup has gaps (e.g. Exclusion 2 only), it will be restored into Exclusion 1.
      // Verification must mirror that behavior to avoid false warnings.
      ...regularZones.map((zone, idx) => ({ ...rectToPolygon(zone), id: `Zone ${idx + 1}` })),
      ...exclusionZones.map((zone, idx) => ({ ...rectToPolygon(zone), id: `Exclusion ${idx + 1}` })),
      ...entryZones.map((zone, idx) => ({ ...rectToPolygon(zone), id: `Entry ${idx + 1}` })),
    ];
  };

  function resetMigrationFlow(): void {
    const deviceId = migrationDeviceIdRef.current || selectedDeviceId;
    setMigrationPhase('idle');
    setMigrationBackupId(null);
    setMigrationError(null);
    setMigrationErrorStep(null);
    setMigrationVerificationStatus('idle');
    setMigrationVerificationMessage(null);
    setRestoreWarnings(null);
    setRestoreError(null);
    migrationDeviceIdRef.current = '';
    try {
      window.sessionStorage.removeItem('ep_migration_device_id');
    } catch {
      // ignore
    }
    if (deviceId) {
      clearFirmwareMigrationState(deviceId).catch(() => null);
    }
  }

  function promptMigration(): void {
    setMigrationBackupId(null);
    setMigrationError(null);
    setMigrationPhase('prompt');
  }

  function cancelMigration(): void {
    resetMigrationFlow();
  }

  const verifyPolygonRestore = useCallback(async (backupId: string): Promise<{ status: 'success' | 'warning' | 'error'; message: string }> => {
    const backup = zoneBackups.find((item) => item.id === backupId) ?? null;
    if (!backup) {
      return { status: 'error', message: 'Backup not found for verification.' };
    }

    const context = await resolveBackupContext();
    if (!context) {
      return { status: 'error', message: 'Zone verification skipped: missing device context.' };
    }

    const profile = profiles.find((item) => item.id === context.profileId) ?? null;
    const expectedPolygons = buildExpectedPolygons(backup, profile?.limits);
    if (expectedPolygons.length === 0) {
      return { status: 'success', message: 'No zones to verify.' };
    }

    try {
      const devicePolygons = await fetchPolygonZonesFromDevice(
        context.device.id,
        context.profileId,
        context.entityNamePrefix
      );

      const actualByKey = new Map<string, ZonePolygon>();
      for (const zone of devicePolygons) {
        actualByKey.set(`${zone.type}:${zone.id}`, zone);
      }

      let mismatches = 0;
      for (const expected of expectedPolygons) {
        const actual = actualByKey.get(`${expected.type}:${expected.id}`);
        if (!actual || !verticesMatch(expected.vertices, actual.vertices)) {
          mismatches += 1;
        }
      }

      if (mismatches > 0) {
        return {
          status: 'warning',
          message: `${mismatches} polygon zone${mismatches > 1 ? 's' : ''} did not match the backup.`,
        };
      }

      return { status: 'success', message: 'Polygon zones verified.' };
    } catch (error) {
      return {
        status: 'error',
        message: error instanceof Error ? error.message : 'Failed to verify polygon zones.',
      };
    }
  }, [zoneBackups, resolveBackupContext, profiles]);

  async function confirmMigrationAndInstall(): Promise<void> {
    if (!preparedToken) {
      onError('No prepared firmware available');
      return;
    }
    if (!selectedDeviceId) {
      onError('Please select a device');
      return;
    }

    migrationDeviceIdRef.current = selectedDeviceId;
    try {
      window.sessionStorage.setItem('ep_migration_device_id', selectedDeviceId);
    } catch {
      // ignore
    }
    debugMigration('confirmMigrationAndInstall', {
      selectedDeviceId,
      preparedVersion,
      preparedTokenPresent: Boolean(preparedToken),
    });

    setMigrationError(null);
    setMigrationErrorStep(null);
    setMigrationVerificationStatus('idle');
    setMigrationVerificationMessage(null);
    markStepStart('backup');
    setMigrationPhase('backing_up');
    const backup = await handleCreateZoneBackup();
    if (!backup) {
      setMigrationPhase('error');
      setMigrationError('Failed to create zone backup.');
      setMigrationErrorStep('backup');
      return;
    }

    await ensureMinStepDuration('backup');
    setMigrationBackupId(backup.id);
    markStepStart('install');
    setMigrationPhase('installing');
    try {
      await triggerUpdateOnDevice(preparedToken);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to trigger update';
      setMigrationPhase('error');
      setMigrationError(message);
      setMigrationErrorStep('install');
      onError(message);
    }
  }

  const selectedDevice = devices.find((d) => d.id === selectedDeviceId);
  const currentFirmwareVersion =
    backupMapping?.firmwareVersion ??
    backupMapping?.rawSwVersion ??
    selectedDevice?.firmwareVersion ??
    selectedUpdate?.currentVersion;
  const sortedBackups = [...zoneBackups].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const latestBackup = sortedBackups[0] ?? null;
  const effectiveLanIp = lanIpOverride || autoDetectedIp;
  const updatesBlocked = deviceConfig?.configSource === 'inferred';
  const updatesBlockedMessage = buildConfigUnavailableMessage;
  const migrationInProgress = ['backing_up', 'installing', 'resync_wait', 'resyncing', 'restoring', 'verifying'].includes(migrationPhase);
  const migrationPromptOpen = migrationPhase === 'prompt';
  const modalLocked = ['checking', 'preparing', 'downloading', 'updating'].includes(updateStatus) || migrationInProgress;
  const showFirmwareModal = updateModalOpen || updateStatus === 'updating' || migrationInProgress;
  const canInstall =
    updateStatus === 'ready' &&
    preparedToken &&
    deviceConfig?.configSource === 'entities' &&
    !migrationPromptOpen &&
    !migrationInProgress &&
    migrationPhase !== 'error';
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
  const latestUpdate = availableUpdates.reduce<AvailableUpdate | null>((latest, update) => {
    if (!latest) return update;
    const comparison = compareVersions(update.newVersion, latest.newVersion);
    if (comparison === null) return latest;
    return comparison > 0 ? update : latest;
  }, null);
  const latestUpdateMigration = latestUpdate
    ? getZoneMigrationInfo(
        latestUpdate.currentVersion,
        latestUpdate.newVersion,
        deviceConfig?.model ?? selectedDevice?.model ?? undefined,
        latestUpdate.migration
      )
    : null;
  const preparedMigration = preparedVersion
    ? getZoneMigrationInfo(
        currentFirmwareVersion,
        preparedVersion,
        deviceConfig?.model ?? selectedDevice?.model ?? undefined,
        selectedUpdate?.migration ?? null
      )
    : null;
  const restoreBackupId = migrationBackupId ?? lastBackupId ?? latestBackup?.id ?? null;
  const migrationPromptTargetVersion =
    preparedVersion ?? selectedUpdate?.newVersion ?? latestUpdate?.newVersion ?? null;
  const migrationPromptText = `The version you are upgrading to${migrationPromptTargetVersion ? ` (v${migrationPromptTargetVersion})` : ''} removes rectangular zones in favour of polygon zones. During the upgrade, we will back up your current rectangular zones, update the device, and convert them to polygon zones for a seamless experience. If you are ready to proceed with this upgrade, please proceed.`;
  const migrationStepOrder = ['backup', 'install', 'resync', 'restore', 'verify'] as const;
  type MigrationStepKey = (typeof migrationStepOrder)[number];
  const activeStep: MigrationStepKey | null = (() => {
    if (migrationPhase === 'backing_up') return 'backup';
    if (migrationPhase === 'installing') return 'install';
    if (migrationPhase === 'resync_wait' || migrationPhase === 'resyncing') return 'resync';
    if (migrationPhase === 'restoring') return 'restore';
    if (migrationPhase === 'verifying') return 'verify';
    return null;
  })();
  const activeStepIndex = activeStep ? migrationStepOrder.indexOf(activeStep) : -1;
  const errorStepIndex = migrationErrorStep ? migrationStepOrder.indexOf(migrationErrorStep) : -1;
  const getMigrationStepStatus = (step: MigrationStepKey): 'pending' | 'active' | 'done' | 'error' | 'warning' => {
    if (migrationErrorStep === step) return 'error';
    if (step === 'verify' && migrationVerificationStatus === 'warning') return 'warning';
    if (activeStep === step) return 'active';
    if (migrationPhase === 'complete') return 'done';
    if (migrationPhase === 'error') {
      return migrationErrorStep && migrationStepOrder.indexOf(step) < errorStepIndex ? 'done' : 'pending';
    }
    if (activeStepIndex >= 0 && migrationStepOrder.indexOf(step) < activeStepIndex) return 'done';
    return 'pending';
  };
  const migrationSteps = [
    { key: 'backup' as MigrationStepKey, label: 'Backup zones' },
    { key: 'install' as MigrationStepKey, label: 'Install update' },
    { key: 'resync' as MigrationStepKey, label: 'Re-sync entities' },
    { key: 'restore' as MigrationStepKey, label: 'Restore zones' },
    { key: 'verify' as MigrationStepKey, label: 'Verify zones' },
  ].map((step) => ({
    ...step,
    status: getMigrationStepStatus(step.key),
  }));
  const showMigrationSteps = migrationPhase !== 'idle' && migrationPhase !== 'prompt';
  const getMigrationStepDetail = (step: MigrationStepKey, status: 'pending' | 'active' | 'done' | 'error' | 'warning'): string | null => {
    if (status === 'pending') return null;
    if (status === 'error') return migrationError ?? 'Step failed.';
    if (status === 'warning' && step === 'verify') {
      return migrationVerificationMessage ?? 'Some zones did not match.';
    }
    if (status === 'done') {
      if (step === 'backup') return 'Backup saved.';
      if (step === 'install') return 'Firmware updated.';
      if (step === 'resync') return 'Entities refreshed.';
      if (step === 'restore') return 'Zones restored.';
      if (step === 'verify') return migrationVerificationMessage ?? 'Verification complete.';
    }
    if (step === 'backup') return 'Saving current zones...';
    if (step === 'install') return updateMonitorMessage || 'Installing firmware...';
    if (step === 'resync') {
      if (migrationPhase === 'resync_wait') {
        return resyncStepMessage ?? 'Letting the device settle after reboot...';
      }
      return resyncStepMessage ?? 'Refreshing entity map...';
    }
    if (step === 'restore') return 'Applying polygon zones...';
    if (step === 'verify') return 'Checking restored polygons...';
    return null;
  };
  const migrationStepTone = {
    pending: {
      dot: 'bg-slate-700 border border-slate-600',
      line: 'bg-slate-700/70',
      text: 'text-slate-400',
      detail: 'text-slate-500',
    },
    active: {
      dot: 'bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.35)]',
      line: 'bg-cyan-400/70 animate-pulse',
      text: 'text-cyan-100',
      detail: 'text-cyan-200',
    },
    done: {
      dot: 'bg-emerald-400',
      line: 'bg-emerald-400/70',
      text: 'text-emerald-100',
      detail: 'text-emerald-200',
    },
    warning: {
      dot: 'bg-amber-400',
      line: 'bg-amber-400/70 animate-pulse',
      text: 'text-amber-100',
      detail: 'text-amber-200',
    },
    error: {
      dot: 'bg-rose-500',
      line: 'bg-rose-500/70',
      text: 'text-rose-100',
      detail: 'text-rose-200',
    },
  } as const;
  const handleForceResync = () => {
    debugMigration('handleForceResync', {
      selectedDeviceId,
      migrationDeviceId: migrationDeviceIdRef.current,
      migrationPhase,
      updateStatus,
    });
    if (resyncWaitResolveRef.current) {
      resyncWaitResolveRef.current();
      return;
    }
    if (startResyncFlowRef.current) {
      startResyncFlowRef.current();
      return;
    }
    startResyncFlow();
  };
  const migrationStepsPanel = showMigrationSteps ? (
    <div className="rounded-xl border border-slate-700/60 bg-slate-900/60 p-4 text-xs text-slate-200">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
          Migration progress
        </div>
        {migrationPhase === 'complete' && (
          <span className="text-[11px] font-semibold text-emerald-200">Complete</span>
        )}
      </div>
      <div className="mt-4 space-y-3">
        {migrationSteps.map((step, index) => {
          const detail = getMigrationStepDetail(step.key, step.status);
          const tone = migrationStepTone[step.status];
          const isActive = step.status === 'active';
          const isLast = index === migrationSteps.length - 1;
          return (
            <div key={step.key} className="flex items-start gap-3">
              <div className="relative flex flex-col items-center">
                <div className={`relative h-3 w-3 rounded-full ${tone.dot} transition-colors duration-300`}>
                  {isActive && (
                    <span className="absolute inset-0 rounded-full bg-cyan-400/40 animate-ping" />
                  )}
                </div>
                {!isLast && (
                  <div className={`mt-1 h-8 w-px ${tone.line} transition-colors duration-300`} />
                )}
              </div>
              <div className="flex-1">
                <div className={`text-sm font-semibold ${tone.text}`}>{step.label}</div>
                {detail && <div className={`mt-1 text-xs ${tone.detail}`}>{detail}</div>}
                {step.key === 'resync' && migrationPhase === 'resync_wait' && (
                  <button
                    type="button"
                    onClick={handleForceResync}
                    className="mt-2 rounded-lg border border-cyan-400/40 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-semibold text-cyan-100 transition hover:bg-cyan-500/20"
                  >
                    Start re-sync now
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {migrationPhase === 'error' && (
        <div className="mt-4 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-100">
          <div className="text-sm font-semibold text-rose-100">Migration paused</div>
          <div className="mt-1 text-xs text-rose-200">
            {migrationError || 'The migration could not finish automatically.'}
          </div>
          {migrationErrorStep === 'resync' && (
            <button
              type="button"
              onClick={() => {
                setMigrationError(null);
                setMigrationErrorStep(null);
                setMigrationVerificationStatus('idle');
                setMigrationVerificationMessage(null);
                setMigrationPhase('resync_wait');
              }}
              className="mt-3 rounded-lg bg-rose-600/20 px-3 py-1.5 text-xs font-semibold text-rose-100 transition hover:bg-rose-600/30"
            >
              Retry re-sync
            </button>
          )}
          {restoreBackupId && (migrationErrorStep === 'restore' || migrationErrorStep === 'verify') && (
            <button
              type="button"
              onClick={async () => {
                setMigrationError(null);
                setMigrationErrorStep(null);
                setMigrationVerificationStatus('idle');
                setMigrationVerificationMessage(null);

                markStepStart('restore');
                setMigrationPhase('restoring');
                const restored = await handleRestoreZoneBackup(restoreBackupId);
                if (!isMountedRef.current) {
                  return;
                }
                if (!restored) {
                  setMigrationPhase('error');
                  setMigrationError('Zone restore failed. Try restoring again from Zone Backups.');
                  setMigrationErrorStep('restore');
                  return;
                }

                await ensureMinStepDuration('restore');
                if (!isMountedRef.current) {
                  return;
                }

                markStepStart('verify');
                setMigrationPhase('verifying');
                setMigrationVerificationStatus('running');
                setMigrationVerificationMessage(null);
                const verification = await verifyPolygonRestore(restoreBackupId);
                if (!isMountedRef.current) {
                  return;
                }

                await ensureMinStepDuration('verify');
                if (!isMountedRef.current) {
                  return;
                }

                setMigrationVerificationStatus(verification.status);
                setMigrationVerificationMessage(verification.message);

                if (verification.status === 'error') {
                  setMigrationPhase('error');
                  setMigrationError(verification.message);
                  setMigrationErrorStep('verify');
                  return;
                }

                setMigrationPhase('complete');
              }}
              disabled={restoringBackup}
              className="mt-3 rounded-lg bg-rose-600/20 px-3 py-1.5 text-xs font-semibold text-rose-100 transition hover:bg-rose-600/30 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {restoringBackup ? 'Restoring...' : 'Try Restore Again'}
            </button>
          )}
        </div>
      )}
      {migrationPhase === 'complete' && migrationVerificationStatus === 'warning' && (
        <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-100">
          <div className="text-sm font-semibold text-amber-100">Review recommended</div>
          <div className="mt-1 text-xs text-amber-200">
            {migrationVerificationMessage ?? 'Some zones did not match the backup.'}
          </div>
        </div>
      )}
      {restoreWarnings && restoreWarnings.length > 0 && (
        <ul className="mt-4 space-y-1 text-[11px] text-slate-300">
          {restoreWarnings.map((warning, index) => (
            <li key={`${warning.error}-${index}`}>
              {warning.description} ({warning.error})
            </li>
          ))}
        </ul>
      )}
      {restoreError && <div className="mt-3 text-[11px] text-rose-200">{restoreError}</div>}
    </div>
  ) : null;

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
        const installedVersionMatches =
          !!preparedVersion && !!installedVersion && installedVersion === preparedVersion;
        const hasStartSignal =
          inProgress || (progress !== null && progress > 0) || installedVersionMatches;

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
              setUpdateMonitorMessage('Update complete.');
              setMonitoringUpdate(false);
              setUpdateStatus('complete');
              onSuccess(
                `Firmware updated${installedVersion ? ` to v${installedVersion}` : ''}. Device rebooted and is back online.`
              );
              debugMigration('install complete -> resync_wait', {
                selectedDeviceId,
                migrationDeviceId: migrationDeviceIdRef.current,
              });
              setMigrationPhase((prev) => (prev === 'installing' ? 'resync_wait' : prev));
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
            setUpdateMonitorMessage('Update complete.');
            setMonitoringUpdate(false);
            setUpdateStatus('complete');
            onSuccess(
              `Firmware updated${installedVersion ? ` to v${installedVersion}` : ''}. Device may reboot briefly.`
            );
            debugMigration('install complete -> resync_wait', {
              selectedDeviceId,
              migrationDeviceId: migrationDeviceIdRef.current,
            });
            setMigrationPhase((prev) => (prev === 'installing' ? 'resync_wait' : prev));
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
  }, [monitoringUpdate, selectedDeviceId, preparedVersion, availabilityEntityId, onError, onSuccess, debugMigration]);

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

  const startResyncFlow = useCallback(async () => {
    if (resyncInFlightRef.current) {
      return;
    }
    resyncInFlightRef.current = true;
    try {
      let storedDeviceId: string | null = null;
      try {
        storedDeviceId = window.sessionStorage.getItem('ep_migration_device_id');
      } catch {
        storedDeviceId = null;
      }
      const deviceId = migrationDeviceIdRef.current || selectedDeviceId || storedDeviceId || '';
      if (!migrationDeviceIdRef.current && deviceId) {
        migrationDeviceIdRef.current = deviceId;
      }

      if (!isMountedRef.current) {
        return;
      }
      if (!deviceId) {
        setMigrationPhase('error');
        setMigrationError('No device selected for entity re-sync.');
        setMigrationErrorStep('resync');
        return;
      }

      const device = devices.find((d) => d.id === deviceId);
      if (!device) {
        setMigrationPhase('error');
        setMigrationError('Device not found after update.');
        setMigrationErrorStep('resync');
        return;
      }

      const profileId = backupMapping?.profileId ?? getDeviceProfile(device)?.id ?? '';
      const deviceName =
        backupMapping?.deviceName ??
        device.name ??
        device.entityNamePrefix ??
        device.model ??
        'Device';

      if (!profileId) {
        setMigrationPhase('error');
        setMigrationError('Entity re-sync skipped: device profile not found.');
        setMigrationErrorStep('resync');
        return;
      }

      markStepStart('resync');
      setMigrationPhase('resyncing');
      debugMigration('startResyncFlow: calling discoverAndSaveMapping', {
        deviceId,
        profileId,
        deviceName,
      });
      const result = await withTimeout(
        discoverAndSaveMapping(deviceId, profileId, deviceName),
        45000,
        'Entity re-sync timed out. Make sure the device is online and try again.'
      );
      if (!isMountedRef.current) {
        return;
      }

      if (!result?.mapping) {
        setMigrationPhase('error');
        setMigrationError('Entity re-sync failed. Run entity discovery to update mappings.');
        setMigrationErrorStep('resync');
        return;
      }

      setBackupMapping(result.mapping);
      await refreshMapping(deviceId);
      await ensureMinStepDuration('resync');
      if (!isMountedRef.current) {
        return;
      }

      // Before restoring zones, wait for polygon entities to become available after the update.
      const entityNamePrefix =
        device.entityNamePrefix ?? result.mapping?.esphomeNodeName ?? backupMapping?.esphomeNodeName ?? null;
      if (entityNamePrefix) {
        const backupId = migrationBackupId ?? lastBackupId ?? latestBackup?.id ?? null;
        const backup = backupId ? zoneBackups.find((item) => item.id === backupId) ?? null : null;
        const profile = profiles.find((item) => item.id === profileId) ?? null;
        const expected = backup ? buildExpectedPolygons(backup, profile?.limits) : [];
        const regularCount = expected.filter((zone) => zone.type === 'regular').length;
        const exclusionCount = expected.filter((zone) => zone.type === 'exclusion').length;
        const entryCount = expected.filter((zone) => zone.type === 'entry').length;
        const waitStart = Date.now();
        // eslint-disable-next-line no-constant-condition
        while (true) {
          if (!isMountedRef.current) {
            return;
          }
          const elapsed = Date.now() - waitStart;
          if (elapsed > 90_000) {
            setMigrationPhase('error');
            setMigrationError('Timed out waiting for polygon zone entities to become available after reboot.');
            setMigrationErrorStep('restore');
            return;
          }

          try {
            const readiness = await fetchDeviceReadiness(deviceId, {
              require: 'polygon',
              profileId,
              entityNamePrefix,
              regularCount,
              exclusionCount,
              entryCount,
            });
            if (!isMountedRef.current) {
              return;
            }
            const checked = readiness.checkedEntityIds?.length ?? 0;
            const available = readiness.availableEntityCount ?? 0;
            if (readiness.ready) {
              setResyncStepMessage(null);
              break;
            }
            setResyncStepMessage(`Waiting for polygon entities (${available}/${checked})...`);
          } catch (error) {
            setResyncStepMessage('Waiting for polygon entities...');
          }

          await sleep(1500);
        }
      }

      const backupId = migrationBackupId ?? lastBackupId ?? latestBackup?.id ?? null;
      if (!backupId) {
        setMigrationPhase('error');
        setMigrationError('Zone backup not found. Create a new backup and restore manually.');
        setMigrationErrorStep('restore');
        return;
      }

      markStepStart('restore');
      setMigrationPhase('restoring');
      const restored = await handleRestoreZoneBackup(backupId);
      if (!isMountedRef.current) {
        return;
      }

      if (!restored) {
        setMigrationPhase('error');
        setMigrationError('Zone restore failed. Try restoring again from Zone Backups.');
        setMigrationErrorStep('restore');
        return;
      }

      await ensureMinStepDuration('restore');

      markStepStart('verify');
      setMigrationPhase('verifying');
      setMigrationVerificationStatus('running');
      setMigrationVerificationMessage(null);
      const verification = await verifyPolygonRestore(backupId);
      if (!isMountedRef.current) {
        return;
      }

      await ensureMinStepDuration('verify');
      if (!isMountedRef.current) {
        return;
      }
      setMigrationVerificationStatus(verification.status);
      setMigrationVerificationMessage(verification.message);

      if (verification.status === 'error') {
        setMigrationPhase('error');
        setMigrationError(verification.message);
        setMigrationErrorStep('verify');
        return;
      }

      setMigrationPhase('complete');
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }
      const message = error instanceof Error ? error.message : 'Entity re-sync failed.';
      setMigrationPhase('error');
      setMigrationError(message);
      setMigrationErrorStep('resync');
    } finally {
      resyncInFlightRef.current = false;
    }
  }, [
    backupMapping?.deviceName,
    backupMapping?.profileId,
    devices,
    handleRestoreZoneBackup,
    lastBackupId,
    latestBackup?.id,
    migrationBackupId,
    profiles,
    refreshMapping,
    selectedDeviceId,
    zoneBackups,
    verifyPolygonRestore,
  ]);

  // Keep ref updated so transition effect can use latest without re-running
  useEffect(() => {
    startResyncFlowRef.current = startResyncFlow;
  }, [startResyncFlow]);

  useEffect(() => {
    if (migrationPhase !== 'resync_wait') {
      if (resyncWaitTimerRef.current) {
        clearTimeout(resyncWaitTimerRef.current);
        resyncWaitTimerRef.current = null;
      }
      resyncWaitResolveRef.current = null;
      setResyncStepMessage(null);
      return;
    }

    const deviceId = migrationDeviceIdRef.current || selectedDeviceId;
    const startAt = Date.now();
    let cancelled = false;

    const triggerResync = () => {
      const trigger = startResyncFlowRef.current;
      if (trigger) {
        trigger();
      } else {
        startResyncFlow();
      }
    };

    resyncWaitResolveRef.current = () => {
      if (resyncWaitTimerRef.current) {
        clearTimeout(resyncWaitTimerRef.current);
        resyncWaitTimerRef.current = null;
      }
      resyncWaitResolveRef.current = null;
      setResyncStepMessage('Starting entity re-sync...');
      triggerResync();
    };

    const poll = async () => {
      if (cancelled || !isMountedRef.current) {
        return;
      }
      if (!deviceId) {
        setMigrationPhase('error');
        setMigrationError('No device selected for entity re-sync.');
        setMigrationErrorStep('resync');
        return;
      }

      const elapsedMs = Date.now() - startAt;
      if (elapsedMs > 2 * 60 * 1000) {
        setMigrationPhase('error');
        setMigrationError('Timed out waiting for device entities to become available after reboot.');
        setMigrationErrorStep('resync');
        return;
      }

      try {
        const readiness = await fetchDeviceReadiness(deviceId, { require: 'discover' });
        if (cancelled || !isMountedRef.current) {
          return;
        }

        const checked = readiness.checkedEntityIds?.length ?? 0;
        const available = readiness.availableEntityCount ?? 0;
        setResyncStepMessage(
          readiness.ready
            ? 'Starting entity re-sync...'
            : `Waiting for device entities (${available}/${checked})...`,
        );

        if (readiness.ready) {
          resyncWaitResolveRef.current = null;
          triggerResync();
          return;
        }
      } catch {
        setResyncStepMessage('Waiting for device entities...');
      }

      resyncWaitTimerRef.current = setTimeout(poll, 1500);
    };

    poll();

    return () => {
      cancelled = true;
      if (resyncWaitTimerRef.current) {
        clearTimeout(resyncWaitTimerRef.current);
        resyncWaitTimerRef.current = null;
      }
      resyncWaitResolveRef.current = null;
      setResyncStepMessage(null);
    };
  }, [migrationPhase]);

  useEffect(() => {
    if (updateStatus !== 'complete' || migrationPhase !== 'installing') {
      return;
    }
    // Immediately proceed to resync - the install step is complete
    if (startResyncFlowRef.current) {
      startResyncFlowRef.current();
    }
  }, [updateStatus, migrationPhase]);

  useEffect(() => {
    if (updateStatus !== 'error') {
      return;
    }
    if (migrationPhase !== 'idle' && migrationPhase !== 'prompt' && migrationPhase !== 'error') {
      setMigrationPhase('error');
      setMigrationError('Firmware update failed before zone migration could complete.');
      if (migrationPhase === 'installing') {
        setMigrationErrorStep('install');
      }
    }
  }, [updateStatus, migrationPhase]);

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

              {migrationInProgress && (
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="relative h-14 w-14">
                      <div className="absolute inset-0 rounded-full border-4 border-cyan-500/20 animate-ping" />
                      <div className="absolute inset-0 rounded-full border-4 border-cyan-400 border-t-transparent animate-spin" />
                      <div className="absolute inset-2 rounded-full bg-cyan-500/10 animate-pulse" />
                    </div>
                    <div>
                      <div className="text-base font-semibold text-cyan-100">
                        {activeStep
                          ? migrationSteps.find((step) => step.key === activeStep)?.label ?? 'Working...'
                          : 'Working...'}
                      </div>
                      <div className="text-xs text-slate-400">
                        {activeStep ? getMigrationStepDetail(activeStep, 'active') || 'Working on it...' : 'Working on it...'}
                      </div>
                    </div>
                  </div>
                  {updateStatus === 'updating' && updateProgress !== null ? (
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
                  ) : updateStatus === 'updating' ? (
                    <div className="text-xs text-slate-400">Waiting for update progress...</div>
                  ) : null}
                  {updateStatus === 'updating' && updateEntityStatus && (
                    <div className="text-xs text-slate-400">
                      Update entity: {updateEntityStatus.state}
                      {updateInstalledVersion ? ` | Installed: ${updateInstalledVersion}` : ''}
                    </div>
                  )}
                  {activeStep === 'install' && (
                    <div className="text-[11px] text-slate-500">
                      This can take a few minutes. If the device stays offline for 2 minutes, we will stop waiting.
                      Keep this window open while the update completes.
                    </div>
                  )}
                  {migrationStepsPanel}
                </div>
              )}

              {updateStatus === 'updating' && !migrationInProgress && (
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
                  {migrationStepsPanel}
                </div>
              )}

              {updateStatus === 'ready' && !migrationInProgress && (
                <div className="space-y-4">
                  {!migrationPromptOpen && (
                    <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-100">
                      Firmware {preparedVersion ? `v${preparedVersion}` : 'update'} is ready to install.
                    </div>
                  )}
                  {migrationPromptOpen && (
                    <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-4 text-xs text-amber-100">
                      <div className="text-sm font-semibold text-amber-100">
                        Polygon migration required
                      </div>
                      <p className="mt-1 text-amber-200">
                        {migrationPromptText}
                      </p>
                      <div className="mt-3 rounded-lg border border-amber-500/30 bg-slate-900/40 p-3">
                        <img
                          src={polygonMigrationGraphic}
                          alt="Polygon migration preview"
                          className="h-24 w-full object-contain"
                        />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          onClick={confirmMigrationAndInstall}
                          disabled={creatingBackup || migrationPhase === 'backing_up'}
                          className="rounded-lg bg-amber-500/30 px-3 py-1.5 text-xs font-semibold text-amber-50 transition hover:bg-amber-500/40 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {creatingBackup || migrationPhase === 'backing_up' ? 'Starting...' : 'Continue and Migrate'}
                        </button>
                        <button
                          onClick={() => {
                            cancelMigration();
                            setUpdateModalOpen(false);
                          }}
                          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-100 transition hover:bg-amber-500/20"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                  {migrationStepsPanel}
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
                    <div className="space-y-2">
                      <button
                        onClick={handleTriggerUpdate}
                        className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Install on Device
                      </button>
                    </div>
                  )}
                </div>
              )}

              {updateStatus === 'complete' && !migrationInProgress && (
                <div className="space-y-4">
                  {!showMigrationSteps && (
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
                  )}
                  {migrationStepsPanel}
                  <button
                    type="button"
                    onClick={() => {
                      resetMigrationFlow();
                      setUpdateModalOpen(false);
                    }}
                    disabled={migrationInProgress}
                    className="w-full rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-slate-700"
                  >
                    Close
                  </button>
                </div>
              )}

              {updateStatus === 'error' && (
                <div className="space-y-4">
                  {migrationStepsPanel}
                  <div className="rounded-xl border border-rose-500/50 bg-rose-500/10 p-4 text-sm text-rose-100">
                    Update failed. Check the error message above or Home Assistant for details.
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      resetMigrationFlow();
                      setUpdateModalOpen(false);
                    }}
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
                      {latestUpdateMigration && (
                        <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-3 text-xs text-amber-200">
                          <div className="text-sm font-semibold text-amber-100">
                            Polygon migration required
                          </div>
                          <p className="mt-1">
                            {latestUpdateMigration.description} The installer will back up and restore your zones automatically.
                          </p>
                        </div>
                      )}
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
                          {(() => {
                            const migrationInfo = getZoneMigrationInfo(
                              update.currentVersion,
                              update.newVersion,
                              deviceConfig?.model ?? selectedDevice?.model ?? undefined,
                              update.migration
                            );
                            if (!migrationInfo) return null;
                            return (
                              <div className="mt-2 rounded border border-amber-500/50 bg-amber-500/10 p-2 text-xs text-amber-200">
                                <strong>Migration Required:</strong> {migrationInfo.description}
                                {migrationInfo.backupRequired && (
                                  <span className="ml-1 text-amber-400">(Auto migrate)</span>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      ))}

                      <button
                        onClick={handleAutoInstall}
                        disabled={
                          updateStatus === 'preparing' ||
                          updateStatus === 'downloading' ||
                          updateStatus === 'updating' ||
                          migrationInProgress
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
                            updateStatus === 'updating' ||
                            migrationInProgress
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
