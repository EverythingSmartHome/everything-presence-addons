import { DiscoveredDevice, DeviceProfile, ZoneAvailabilityResponse, CustomFloorMaterial, CustomFurnitureType, HeatmapResponse } from './types';
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
  entityNamePrefix: string
): Promise<ZoneAvailabilityResponse> => {
  const params = new URLSearchParams({ profileId, entityNamePrefix });
  const res = await fetch(ingressAware(`api/devices/${deviceId}/zone-availability?${params}`));
  return handle<ZoneAvailabilityResponse>(res);
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
  resolution: number = 400
): Promise<HeatmapResponse> => {
  const params = new URLSearchParams({
    profileId,
    entityNamePrefix,
    hours: hours.toString(),
    resolution: resolution.toString(),
  });
  const res = await fetch(ingressAware(`api/devices/${deviceId}/heatmap?${params}`));
  return handle<HeatmapResponse>(res);
};
