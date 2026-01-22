import {
  DiscoveredDevice,
  DeviceProfile,
  ZoneAvailabilityResponse,
  CustomFloorMaterial,
  CustomFurnitureType,
  HeatmapResponse,
  EntityMappings,
  FirmwareSettingsResponse,
  FirmwareSettings,
  PreparedFirmwareResponse,
  FirmwareUpdateResponse,
  CachedFirmwareEntry,
  FirmwareIndexResponse,
  DeviceConfigResponse,
  AvailableUpdatesResponse,
  FirmwareValidationResponse,
  AutoPrepareResponse,
  DeviceConfig,
  FirmwareUpdateEntityStatus,
  ZoneBackup,
  FirmwareMigrationPhase,
  FirmwareMigrationStateResponse,
  DeviceReadinessResponse,
} from './types';
import { AppSettings } from './types';

const handle = async <T>(res: Response): Promise<T> => {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return (await res.json()) as T;
};

export const ingressAware = (path: string): string => {
  const base = window.location.pathname.endsWith('/')
    ? window.location.pathname
    : `${window.location.pathname}/`;
  return `${base}${path.replace(/^\/+/, '')}`;
};

export const fetchDevices = async () => {
  const res = await fetch(ingressAware('api/devices'));
  return handle<{ devices: DiscoveredDevice[] }>(res);
};

export const fetchProfiles = async () => {
  const res = await fetch(ingressAware('api/devices/profiles'));
  return handle<{ profiles: DeviceProfile[] }>(res);
};

export const fetchSettings = async () => {
  const res = await fetch(ingressAware('api/settings'));
  return handle<{ settings: AppSettings }>(res);
};

export const updateSettings = async (settings: Partial<AppSettings>) => {
  const res = await fetch(ingressAware('api/settings'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  return handle<{ settings: AppSettings }>(res);
};

export const updateDeviceEntity = async (deviceId: string, entityId: string, value: string | number | boolean) => {
  const res = await fetch(ingressAware(`api/live/${deviceId}/entity`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entityId, value }),
  });
  return handle<{ success: boolean }>(res);
};

export const fetchZoneAvailability = async (
  deviceId: string,
  profileId: string,
  entityNamePrefix: string,
  entityMappings?: EntityMappings
): Promise<ZoneAvailabilityResponse> => {
  const params = new URLSearchParams({ profileId, entityNamePrefix });
  if (entityMappings) {
    params.set('entityMappings', JSON.stringify(entityMappings));
  }
  const res = await fetch(ingressAware(`api/devices/${deviceId}/zone-availability?${params}`));
  return handle<ZoneAvailabilityResponse>(res);
};

// ==================== ZONE BACKUPS ====================

export const fetchZoneBackups = async (
  deviceId?: string
): Promise<{ backups: ZoneBackup[] }> => {
  const query = deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : '';
  const res = await fetch(ingressAware(`api/zone-backups${query}`));
  return handle<{ backups: ZoneBackup[] }>(res);
};

export const fetchZoneBackup = async (backupId: string): Promise<{ backup: ZoneBackup }> => {
  const res = await fetch(ingressAware(`api/zone-backups/${backupId}`));
  return handle<{ backup: ZoneBackup }>(res);
};

export const createZoneBackup = async (payload: {
  deviceId: string;
  profileId: string;
  entityNamePrefix?: string;
  entityMappings?: EntityMappings;
}): Promise<{ backup: ZoneBackup }> => {
  const res = await fetch(ingressAware('api/zone-backups'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handle<{ backup: ZoneBackup }>(res);
};

export const restoreZoneBackup = async (
  backupId: string,
  payload: {
    deviceId?: string;
    profileId?: string;
    entityNamePrefix?: string;
    entityMappings?: EntityMappings;
  }
): Promise<{ ok: boolean; warnings?: Array<{ entityId?: string; description: string; error: string }> }> => {
  const res = await fetch(ingressAware(`api/zone-backups/${backupId}/restore`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handle<{ ok: boolean; warnings?: Array<{ entityId?: string; description: string; error: string }> }>(res);
};

export const deleteZoneBackup = async (
  backupId: string
): Promise<{ deleted: boolean }> => {
  const res = await fetch(ingressAware(`api/zone-backups/${backupId}`), {
    method: 'DELETE',
  });
  return handle<{ deleted: boolean }>(res);
};

export const importZoneBackups = async (
  payload: unknown
): Promise<{ backups: ZoneBackup[]; imported: number }> => {
  const res = await fetch(ingressAware('api/zone-backups/import'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handle<{ backups: ZoneBackup[]; imported: number }>(res);
};

// ==================== CUSTOM FLOOR MATERIALS ====================

export const fetchCustomFloors = async () => {
  const res = await fetch(ingressAware('api/custom-assets/floors'));
  return handle<{ floors: CustomFloorMaterial[] }>(res);
};

export const createCustomFloor = async (floor: Omit<CustomFloorMaterial, 'id' | 'createdAt'>) => {
  const res = await fetch(ingressAware('api/custom-assets/floors'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(floor),
  });
  return handle<{ floor: CustomFloorMaterial }>(res);
};

export const updateCustomFloor = async (id: string, floor: Partial<Omit<CustomFloorMaterial, 'id' | 'createdAt'>>) => {
  const res = await fetch(ingressAware(`api/custom-assets/floors/${id}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(floor),
  });
  return handle<{ floor: CustomFloorMaterial }>(res);
};

export const deleteCustomFloor = async (id: string) => {
  const res = await fetch(ingressAware(`api/custom-assets/floors/${id}`), {
    method: 'DELETE',
  });
  return handle<{ success: boolean }>(res);
};

// ==================== CUSTOM FURNITURE TYPES ====================

export const fetchCustomFurniture = async () => {
  const res = await fetch(ingressAware('api/custom-assets/furniture'));
  return handle<{ furniture: CustomFurnitureType[] }>(res);
};

export const createCustomFurniture = async (furniture: Omit<CustomFurnitureType, 'id' | 'createdAt'>) => {
  const res = await fetch(ingressAware('api/custom-assets/furniture'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(furniture),
  });
  return handle<{ furniture: CustomFurnitureType }>(res);
};

export const updateCustomFurniture = async (id: string, furniture: Partial<Omit<CustomFurnitureType, 'id' | 'createdAt'>>) => {
  const res = await fetch(ingressAware(`api/custom-assets/furniture/${id}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(furniture),
  });
  return handle<{ furniture: CustomFurnitureType }>(res);
};

export const deleteCustomFurniture = async (id: string) => {
  const res = await fetch(ingressAware(`api/custom-assets/furniture/${id}`), {
    method: 'DELETE',
  });
  return handle<{ success: boolean }>(res);
};

// ==================== HEATMAP ====================

export const fetchHeatmap = async (
  deviceId: string,
  profileId: string,
  entityNamePrefix: string,
  hours: number = 24,
  resolution: number = 400,
  entityMappings?: EntityMappings
): Promise<HeatmapResponse> => {
  const params = new URLSearchParams({
    profileId,
    entityNamePrefix,
    hours: hours.toString(),
    resolution: resolution.toString(),
  });
  if (entityMappings) {
    params.set('entityMappings', JSON.stringify(entityMappings));
  }
  const res = await fetch(ingressAware(`api/devices/${deviceId}/heatmap?${params}`));
  return handle<HeatmapResponse>(res);
};

// ==================== FIRMWARE UPDATE ====================

export const fetchFirmwareSettings = async (): Promise<FirmwareSettingsResponse> => {
  const res = await fetch(ingressAware('api/firmware/settings'));
  return handle<FirmwareSettingsResponse>(res);
};

export const updateFirmwareSettings = async (
  settings: Partial<FirmwareSettings>
): Promise<FirmwareSettingsResponse> => {
  const res = await fetch(ingressAware('api/firmware/settings'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  return handle<FirmwareSettingsResponse>(res);
};

export const prepareFirmware = async (
  deviceId: string,
  manifestUrl: string,
  deviceInfo: { deviceModel: string; firmwareVersion: string }
): Promise<PreparedFirmwareResponse> => {
  const res = await fetch(ingressAware('api/firmware/prepare'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceId,
      manifestUrl,
      deviceModel: deviceInfo.deviceModel,
      firmwareVersion: deviceInfo.firmwareVersion,
    }),
  });
  return handle<PreparedFirmwareResponse>(res);
};

export const triggerFirmwareUpdate = async (
  deviceId: string,
  token: string
): Promise<FirmwareUpdateResponse> => {
  const res = await fetch(ingressAware(`api/firmware/update/${deviceId}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  return handle<FirmwareUpdateResponse>(res);
};

export const fetchFirmwareCache = async (): Promise<{ entries: CachedFirmwareEntry[] }> => {
  const res = await fetch(ingressAware('api/firmware/cache'));
  return handle<{ entries: CachedFirmwareEntry[] }>(res);
};

export const fetchDeviceFirmwareCache = async (
  deviceId: string
): Promise<{ deviceId: string; entries: CachedFirmwareEntry[] }> => {
  const res = await fetch(ingressAware(`api/firmware/cache/${deviceId}`));
  return handle<{ deviceId: string; entries: CachedFirmwareEntry[] }>(res);
};

export const deleteFirmwareCacheEntry = async (
  deviceId: string,
  token: string
): Promise<{ success: boolean }> => {
  const res = await fetch(ingressAware(`api/firmware/cache/${deviceId}/${token}`), {
    method: 'DELETE',
  });
  return handle<{ success: boolean }>(res);
};

export const fetchFirmwareUpdateStatus = async (
  deviceId: string
): Promise<FirmwareUpdateEntityStatus> => {
  const res = await fetch(ingressAware(`api/firmware/update-status/${deviceId}`));
  return handle<FirmwareUpdateEntityStatus>(res);
};

export const fetchFirmwareMigrationState = async (deviceId: string): Promise<FirmwareMigrationStateResponse> => {
  const res = await fetch(ingressAware(`api/firmware/migration/${deviceId}`));
  return handle<FirmwareMigrationStateResponse>(res);
};

export const saveFirmwareMigrationState = async (
  deviceId: string,
  payload: {
    phase: FirmwareMigrationPhase;
    backupId?: string | null;
    preparedVersion?: string | null;
    lastError?: string | null;
  },
): Promise<FirmwareMigrationStateResponse> => {
  const res = await fetch(ingressAware(`api/firmware/migration/${deviceId}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handle<FirmwareMigrationStateResponse>(res);
};

export const clearFirmwareMigrationState = async (deviceId: string): Promise<{ ok: boolean }> => {
  const res = await fetch(ingressAware(`api/firmware/migration/${deviceId}`), {
    method: 'DELETE',
  });
  return handle<{ ok: boolean }>(res);
};

export const fetchDeviceReadiness = async (
  deviceId: string,
  params: {
    require?: 'discover' | 'polygon';
    profileId?: string;
    entityNamePrefix?: string;
    regularCount?: number;
    exclusionCount?: number;
    entryCount?: number;
  } = {},
): Promise<DeviceReadinessResponse> => {
  const query = new URLSearchParams();
  if (params.require) query.set('require', params.require);
  if (params.profileId) query.set('profileId', params.profileId);
  if (params.entityNamePrefix) query.set('entityNamePrefix', params.entityNamePrefix);
  if (typeof params.regularCount === 'number') query.set('regularCount', String(params.regularCount));
  if (typeof params.exclusionCount === 'number') query.set('exclusionCount', String(params.exclusionCount));
  if (typeof params.entryCount === 'number') query.set('entryCount', String(params.entryCount));
  if (typeof window !== 'undefined' && window.localStorage?.getItem('ep_debug_migration') === '1') {
    query.set('debug', '1');
  }
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const res = await fetch(ingressAware(`api/devices/${deviceId}/readiness${suffix}`));
  return handle<DeviceReadinessResponse>(res);
};

// ==================== AUTO-UPDATE SYSTEM ====================

export const fetchFirmwareIndex = async (): Promise<FirmwareIndexResponse> => {
  const res = await fetch(ingressAware('api/firmware/index'));
  return handle<FirmwareIndexResponse>(res);
};

export const refreshFirmwareIndex = async (): Promise<FirmwareIndexResponse> => {
  const res = await fetch(ingressAware('api/firmware/index/refresh'), {
    method: 'POST',
  });
  return handle<FirmwareIndexResponse>(res);
};

export const getDeviceConfig = async (
  deviceModel: string,
  firmwareVersion: string,
  deviceId: string
): Promise<DeviceConfigResponse> => {
  const res = await fetch(ingressAware('api/firmware/device-config'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceModel, firmwareVersion, deviceId }),
  });
  return handle<DeviceConfigResponse>(res);
};

export const getAvailableUpdates = async (
  deviceModel: string,
  currentVersion: string,
  deviceId: string
): Promise<AvailableUpdatesResponse> => {
  const res = await fetch(ingressAware('api/firmware/available'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceModel, currentVersion, deviceId }),
  });
  return handle<AvailableUpdatesResponse>(res);
};

export const validateFirmware = async (
  deviceConfig: DeviceConfig,
  firmwareVariantId: string,
  productId: string
): Promise<FirmwareValidationResponse> => {
  const res = await fetch(ingressAware('api/firmware/validate'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceConfig, firmwareVariantId, productId }),
  });
  return handle<FirmwareValidationResponse>(res);
};

export const autoPrepare = async (
  deviceModel: string,
  currentVersion: string,
  deviceId: string
): Promise<AutoPrepareResponse> => {
  const res = await fetch(ingressAware('api/firmware/auto-prepare'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceModel, currentVersion, deviceId }),
  });
  return handle<AutoPrepareResponse>(res);
};
