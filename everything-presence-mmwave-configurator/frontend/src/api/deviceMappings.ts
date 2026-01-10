import { ingressAware } from './client';

/**
 * Entity category for classification and dynamic loading.
 */
export type EntityCategory = 'sensor' | 'setting' | 'zone' | 'tracking';

/**
 * Zone type for zone entities.
 */
export type ZoneType = 'regular' | 'exclusion' | 'entry' | 'polygon' | 'polygonExclusion' | 'polygonEntry';

/**
 * Control type for settings entities.
 */
export type ControlType = 'number' | 'switch' | 'select' | 'light' | 'text';

/**
 * Entity definition from device profile.
 */
export interface EntityDefinition {
  template: string;
  category: EntityCategory;
  required: boolean;
  subcategory?: string;
  group?: string;
  label?: string;
  controlType?: ControlType;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  description?: string;
  options?: string[];
  zoneType?: ZoneType;
  zoneIndex?: number;
  coord?: string;
  targetIndex?: number;
  property?: string;
}

/**
 * Device mapping stored per-device.
 */
export interface DeviceMapping {
  deviceId: string;
  profileId: string;
  deviceName: string;
  discoveredAt: string;
  lastUpdated: string;
  confirmedByUser: boolean;
  autoMatchedCount: number;
  manuallyMappedCount: number;
  mappings: Record<string, string>;
  unmappedEntities: string[];
  /** Unit of measurement for specific entities (e.g., "target1X" -> "in" or "mm") */
  entityUnits?: Record<string, string>;
  /** Device firmware version (e.g., "1.4.1") - parsed from sw_version */
  firmwareVersion?: string;
  /** ESPHome version the device is running (e.g., "2025.11.2") - parsed from sw_version */
  esphomeVersion?: string;
  /** Raw sw_version string from Home Assistant (e.g., "1.4.1 (ESPHome 2025.11.2)") */
  rawSwVersion?: string;
  /** Schema version from device profile at time of last sync (e.g., "1.0") */
  profileSchemaVersion?: string;
  /** Zone labels keyed by zone ID (e.g., "Zone 1" -> "Bed", "Exclusion 2" -> "Window") */
  zoneLabels?: Record<string, string>;
}

/**
 * Resolved entity with its definition.
 */
export interface ResolvedEntity {
  key: string;
  entityId: string;
  definition?: EntityDefinition;
}

/**
 * Setting entity for UI rendering.
 */
export interface SettingEntity {
  key: string;
  entityId: string;
  label?: string;
  controlType?: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: string[];
  description?: string;
  disabledBy?: 'user' | 'integration' | 'config_entry' | null;
  hiddenBy?: string | null;
  status?: 'enabled' | 'disabled' | 'unavailable' | 'unknown';
}

/**
 * Settings grouped by category.
 */
export interface SettingsGroup {
  group: string;
  settings: SettingEntity[];
}

/**
 * Migration result from room to device mappings.
 */
export interface MigrationResult {
  migrated: boolean;
  reason?: string;
  deviceId?: string;
}

// ─────────────────────────────────────────────────────────────────
// API Response Types
// ─────────────────────────────────────────────────────────────────

interface DeviceMappingResponse {
  mapping: DeviceMapping;
}

interface DeviceMappingsListResponse {
  mappings: DeviceMapping[];
}

interface SettingsGroupedResponse {
  groups: SettingsGroup[];
}

interface EntitiesByCategoryResponse {
  entities: ResolvedEntity[];
}

interface MigrationResponse {
  results: MigrationResult[];
  migratedCount: number;
  skippedCount: number;
  errorCount: number;
}

// ─────────────────────────────────────────────────────────────────
// API Functions
// ─────────────────────────────────────────────────────────────────

const handle = async <T>(res: Response): Promise<T> => {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return (await res.json()) as T;
};

/**
 * Fetch device mapping for a specific device.
 * Returns null if no mapping exists.
 */
export const getDeviceMapping = async (deviceId: string): Promise<DeviceMapping | null> => {
  try {
    const res = await fetch(ingressAware(`api/device-mappings/${deviceId}`));
    if (res.status === 404) {
      return null;
    }
    const data = await handle<DeviceMappingResponse>(res);
    return data.mapping;
  } catch (error) {
    console.error('Failed to fetch device mapping:', error);
    return null;
  }
};

/**
 * Fetch all device mappings.
 */
export const getAllDeviceMappings = async (): Promise<DeviceMapping[]> => {
  try {
    const res = await fetch(ingressAware('api/device-mappings'));
    const data = await handle<DeviceMappingsListResponse>(res);
    return data.mappings;
  } catch (error) {
    console.error('Failed to fetch device mappings:', error);
    return [];
  }
};

/**
 * Get settings for a device, grouped by category.
 */
export const getDeviceSettings = async (deviceId: string): Promise<SettingsGroup[]> => {
  try {
    const res = await fetch(ingressAware(`api/device-mappings/${deviceId}/settings`));
    if (res.status === 404) {
      return [];
    }
    const data = await handle<SettingsGroupedResponse>(res);
    return data.groups;
  } catch (error) {
    console.error('Failed to fetch device settings:', error);
    return [];
  }
};

/**
 * Get a single entity ID by key from device mappings.
 */
export const getDeviceEntity = async (deviceId: string, entityKey: string): Promise<string | null> => {
  const mapping = await getDeviceMapping(deviceId);
  if (!mapping) {
    return null;
  }
  return mapping.mappings[entityKey] || null;
};

/**
 * Get entities by category from device mappings.
 */
export const getEntitiesByCategory = async (
  deviceId: string,
  category: EntityCategory
): Promise<ResolvedEntity[]> => {
  try {
    const res = await fetch(ingressAware(`api/device-mappings/${deviceId}/entities?category=${category}`));
    if (res.status === 404) {
      return [];
    }
    const data = await handle<EntitiesByCategoryResponse>(res);
    return data.entities;
  } catch (error) {
    console.error('Failed to fetch entities by category:', error);
    return [];
  }
};

/**
 * Save/update a device mapping.
 * Sends mapping properties at root level (not wrapped in { mapping }).
 */
export const saveDeviceMapping = async (mapping: DeviceMapping): Promise<DeviceMapping | null> => {
  try {
    const res = await fetch(ingressAware(`api/device-mappings/${mapping.deviceId}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      // Send mapping properties at root level, not wrapped
      body: JSON.stringify(mapping),
    });
    const data = await handle<DeviceMappingResponse>(res);
    return data.mapping;
  } catch (error) {
    console.error('Failed to save device mapping:', error);
    return null;
  }
};

/**
 * Discover entities for a device and save the mapping to device storage.
 * This is the primary method to wire discovery to device mapping store.
 */
export const discoverAndSaveMapping = async (
  deviceId: string,
  profileId: string,
  deviceName: string
): Promise<{ mapping: DeviceMapping; discovery: unknown } | null> => {
  try {
    const res = await fetch(ingressAware(`api/devices/${deviceId}/discover-and-save`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId, deviceName }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status} ${res.statusText}: ${text}`);
    }
    return (await res.json()) as { mapping: DeviceMapping; discovery: unknown };
  } catch (error) {
    console.error('Failed to discover and save mapping:', error);
    return null;
  }
};

/**
 * Trigger migration of all rooms to device mappings.
 */
export const triggerMigration = async (): Promise<MigrationResponse | null> => {
  try {
    const res = await fetch(ingressAware('api/device-mappings/migrate'), {
      method: 'POST',
    });
    const data = await handle<MigrationResponse>(res);
    return data;
  } catch (error) {
    console.error('Failed to trigger migration:', error);
    return null;
  }
};

/**
 * Get dry-run migration preview (what would be migrated).
 */
export const getMigrationPreview = async (): Promise<MigrationResponse | null> => {
  try {
    const res = await fetch(ingressAware('api/device-mappings/migrate/dry-run'));
    const data = await handle<MigrationResponse>(res);
    return data;
  } catch (error) {
    console.error('Failed to get migration preview:', error);
    return null;
  }
};

/**
 * Check if a device has mappings stored.
 * Note: Callers should compare profileSchemaVersion with profile.schemaVersion
 * to determine if resync is needed.
 */
export const hasValidMappings = async (deviceId: string): Promise<boolean> => {
  const mapping = await getDeviceMapping(deviceId);
  return mapping !== null;
};

/**
 * Get zone labels for a device.
 * Returns empty object if device has no mapping or no labels.
 */
export const getZoneLabels = async (deviceId: string): Promise<Record<string, string>> => {
  try {
    const res = await fetch(ingressAware(`api/device-mappings/${deviceId}/zone-labels`));
    if (res.status === 404) {
      return {};
    }
    const data = await handle<{ zoneLabels: Record<string, string> }>(res);
    return data.zoneLabels;
  } catch (error) {
    console.error('Failed to fetch zone labels:', error);
    return {};
  }
};

/**
 * Save zone labels for a device.
 * Labels are stored in the device mapping, separate from zone coordinates.
 */
export const saveZoneLabels = async (
  deviceId: string,
  zoneLabels: Record<string, string>
): Promise<Record<string, string> | null> => {
  try {
    const res = await fetch(ingressAware(`api/device-mappings/${deviceId}/zone-labels`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zoneLabels }),
    });
    if (res.status === 404) {
      console.warn('Device mapping not found - cannot save zone labels');
      return null;
    }
    const data = await handle<{ zoneLabels: Record<string, string> }>(res);
    return data.zoneLabels;
  } catch (error) {
    console.error('Failed to save zone labels:', error);
    return null;
  }
};
