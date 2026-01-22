import { RoomConfig, ZoneRect, ZonePolygon, EntityMappings } from './types';
import { ingressAware } from './client';

const handle = async <T>(res: Response): Promise<T> => {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return (await res.json()) as T;
};

// ==================== RECTANGLE ZONE ENDPOINTS ====================

export const fetchZonesFromDevice = async (
  deviceId: string,
  profileId: string,
  entityNamePrefix: string,
  entityMappings?: EntityMappings
): Promise<ZoneRect[]> => {
  const params = new URLSearchParams({ profileId, entityNamePrefix });
  if (entityMappings) {
    params.set('entityMappings', JSON.stringify(entityMappings));
  }
  const res = await fetch(ingressAware(`api/devices/${deviceId}/zones?${params}`));
  const data = await handle<{ zones: ZoneRect[] }>(res);
  return data.zones;
};

export const pushZonesToDevice = async (
  deviceId: string,
  profileId: string,
  zones: RoomConfig['zones'],
  entityNamePrefix: string,
  entityMappings?: EntityMappings
): Promise<{ ok: boolean; warnings?: Array<{ entityId?: string; description: string; error: string }> }> => {
  const res = await fetch(ingressAware(`api/devices/${deviceId}/zones`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId, zones, entityNamePrefix, entityMappings }),
  });
  return handle<{ ok: boolean; warnings?: Array<{ entityId?: string; description: string; error: string }> }>(res);
};

// ==================== POLYGON ZONE ENDPOINTS ====================

export interface PolygonModeStatus {
  supported: boolean;
  enabled: boolean;
  entityId?: string;
  controllable?: boolean;
}

/**
 * Get polygon mode status for a device.
 */
export const fetchPolygonModeStatus = async (
  deviceId: string,
  profileId: string,
  entityNamePrefix: string,
  entityMappings?: EntityMappings
): Promise<PolygonModeStatus> => {
  const params = new URLSearchParams({ profileId, entityNamePrefix });
  if (entityMappings) {
    params.set('entityMappings', JSON.stringify(entityMappings));
  }
  const res = await fetch(ingressAware(`api/devices/${deviceId}/polygon-mode?${params}`));
  return handle<PolygonModeStatus>(res);
};

/**
 * Enable or disable polygon mode on a device.
 */
export const setPolygonMode = async (
  deviceId: string,
  profileId: string,
  entityNamePrefix: string,
  enabled: boolean,
  entityMappings?: EntityMappings
): Promise<{ ok: boolean; enabled: boolean }> => {
  const res = await fetch(ingressAware(`api/devices/${deviceId}/polygon-mode`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId, entityNamePrefix, enabled, entityMappings }),
  });
  return handle<{ ok: boolean; enabled: boolean }>(res);
};

/**
 * Fetch polygon zones from device text entities.
 */
export const fetchPolygonZonesFromDevice = async (
  deviceId: string,
  profileId: string,
  entityNamePrefix: string,
  entityMappings?: EntityMappings
): Promise<ZonePolygon[]> => {
  const params = new URLSearchParams({ profileId, entityNamePrefix });
  if (entityMappings) {
    params.set('entityMappings', JSON.stringify(entityMappings));
  }
  const res = await fetch(ingressAware(`api/devices/${deviceId}/polygon-zones?${params}`));
  const data = await handle<{ zones: ZonePolygon[] }>(res);
  return data.zones;
};

/**
 * Push polygon zones to device text entities.
 */
export const pushPolygonZonesToDevice = async (
  deviceId: string,
  profileId: string,
  zones: ZonePolygon[],
  entityNamePrefix: string,
  entityMappings?: EntityMappings
): Promise<{ ok: boolean; warnings?: Array<{ entityId?: string; description: string; error: string }> }> => {
  const res = await fetch(ingressAware(`api/devices/${deviceId}/polygon-zones`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId, zones, entityNamePrefix, entityMappings }),
  });
  return handle<{ ok: boolean; warnings?: Array<{ entityId?: string; description: string; error: string }> }>(res);
};
