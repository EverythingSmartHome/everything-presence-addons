import type { DeviceMapping } from '../config/deviceMappingStorage';
import type { EntityRegistryEntry } from '../ha/types';
import type { DeviceRegistryEntry, EntityState } from '../ha/readTransport';
import { canonicalKeyPairs } from '../domain/mappingUtils';

/**
 * Pure diagnosis of stored device entity mappings against the Home Assistant
 * entity registry and current states. Performs no I/O and no logging so it can
 * run on demand (bundle export) without side effects.
 */

export type MappedEntityStatus = 'ok' | 'renamed' | 'missing' | 'wrong_device' | 'disabled' | 'unavailable';

export interface MappedEntityDiagnosis {
  key: string;
  entityId: string;
  status: MappedEntityStatus;
  /** For `renamed`: the entity ID the registry now uses for the stored unique_id. */
  currentEntityId?: string;
  /** For `wrong_device`: the device the registry assigns the entity to. */
  actualDeviceId?: string | null;
  disabledBy?: string | null;
  state?: string;
}

export interface DeviceMappingDiagnosis {
  deviceId: string;
  deviceName: string;
  profileId: string;
  /** null when the device registry could not be read. */
  deviceFound: boolean | null;
  deviceDisabledBy?: string | null;
  confirmedByUser: boolean;
  lastUpdated: string;
  firmwareVersion?: string;
  missingRequiredKeys: string[];
  summary: Record<MappedEntityStatus, number>;
  entities: MappedEntityDiagnosis[];
}

export interface MappingDiagnosticsInput {
  mappings: DeviceMapping[];
  registry: EntityRegistryEntry[];
  /** Current states; when omitted, availability is not assessed. */
  states?: EntityState[] | null;
  devices?: DeviceRegistryEntry[] | null;
  getMissingRequired?: (deviceId: string) => string[];
}

export interface MappingDiagnosticsResult {
  deviceCount: number;
  problemCount: number;
  statesChecked: boolean;
  devices: DeviceMappingDiagnosis[];
}

// States of these entities can hold network identity (SSID, MAC, IP); never copy them.
const SENSITIVE_STATE_ENTITY = /(b?ssid|mac_address|ip_address|_mac\b|_ip\b)/i;

const aliasToCanonical = new Map(canonicalKeyPairs.map(([alias, canonical]) => [alias, canonical]));

const emptySummary = (): Record<MappedEntityStatus, number> => ({
  ok: 0,
  renamed: 0,
  missing: 0,
  wrong_device: 0,
  disabled: 0,
  unavailable: 0,
});

export const diagnoseMappings = (input: MappingDiagnosticsInput): MappingDiagnosticsResult => {
  const registryById = new Map<string, EntityRegistryEntry>();
  const registryByUniqueId = new Map<string, EntityRegistryEntry[]>();
  for (const entry of input.registry) {
    registryById.set(entry.entity_id, entry);
    if (entry.unique_id) {
      const list = registryByUniqueId.get(entry.unique_id) ?? [];
      list.push(entry);
      registryByUniqueId.set(entry.unique_id, list);
    }
  }

  const statesChecked = Array.isArray(input.states);
  const stateById = new Map<string, EntityState>();
  for (const state of input.states ?? []) {
    stateById.set(state.entity_id, state);
  }
  const devicesChecked = Array.isArray(input.devices);
  const deviceById = new Map<string, DeviceRegistryEntry>((input.devices ?? []).map((d) => [d.id, d]));

  const diagnoseEntity = (mapping: DeviceMapping, key: string, entityId: string): MappedEntityDiagnosis => {
    const reg = registryById.get(entityId);
    if (!reg) {
      const uniqueId = mapping.entityUniqueIds?.[entityId];
      const candidates = uniqueId ? registryByUniqueId.get(uniqueId) ?? [] : [];
      const match = candidates.find((c) => c.device_id === mapping.deviceId) ?? candidates[0];
      if (match) {
        return { key, entityId, status: 'renamed', currentEntityId: match.entity_id };
      }
      return { key, entityId, status: 'missing' };
    }
    if (reg.device_id && reg.device_id !== mapping.deviceId) {
      return { key, entityId, status: 'wrong_device', actualDeviceId: reg.device_id };
    }
    if (reg.disabled_by) {
      return { key, entityId, status: 'disabled', disabledBy: reg.disabled_by };
    }
    if (!statesChecked) {
      return { key, entityId, status: 'ok' };
    }
    const state = stateById.get(entityId);
    const stateValue = state && !SENSITIVE_STATE_ENTITY.test(entityId) ? state.state : undefined;
    if (!state || state.state === 'unavailable') {
      return { key, entityId, status: 'unavailable', ...(stateValue !== undefined ? { state: stateValue } : {}) };
    }
    return { key, entityId, status: 'ok', ...(stateValue !== undefined ? { state: stateValue } : {}) };
  };

  const devices = input.mappings.map((mapping): DeviceMappingDiagnosis => {
    const entries = Object.entries(mapping.mappings ?? {}).filter(([key, value]) => {
      if (typeof value !== 'string' || !value) return false;
      // normalizeMappingKeys mirrors canonical keys into legacy aliases; report each mapping once.
      const canonical = aliasToCanonical.get(key);
      return !(canonical && canonical !== key && mapping.mappings[canonical] === value);
    });

    const entities = entries
      .map(([key, entityId]) => diagnoseEntity(mapping, key, entityId))
      .sort((a, b) => a.key.localeCompare(b.key));
    const summary = emptySummary();
    for (const entity of entities) summary[entity.status] += 1;

    let missingRequiredKeys: string[] = [];
    try {
      missingRequiredKeys = input.getMissingRequired?.(mapping.deviceId) ?? [];
    } catch {
      missingRequiredKeys = [];
    }

    const device = deviceById.get(mapping.deviceId);
    return {
      deviceId: mapping.deviceId,
      deviceName: mapping.deviceName,
      profileId: mapping.profileId,
      deviceFound: devicesChecked ? Boolean(device) : null,
      ...(device ? { deviceDisabledBy: device.disabled_by } : {}),
      confirmedByUser: Boolean(mapping.confirmedByUser),
      lastUpdated: mapping.lastUpdated,
      ...(mapping.firmwareVersion ? { firmwareVersion: mapping.firmwareVersion } : {}),
      missingRequiredKeys,
      summary,
      entities,
    };
  });

  const problemCount = devices.reduce(
    (total, d) =>
      total +
      (d.entities.length - d.summary.ok) +
      d.missingRequiredKeys.length +
      (d.deviceFound === false ? 1 : 0),
    0,
  );

  return { deviceCount: devices.length, problemCount, statesChecked, devices };
};
