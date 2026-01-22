import { ingressAware } from './client';

export interface ServicesResponse {
  services: string[];
  domain: string;
  message?: string;
}

export interface ServiceMappingsUpdateResponse {
  mapping: {
    deviceId: string;
    serviceMappings?: Record<string, string>;
    serviceConfirmedByUser?: boolean;
  };
}

/**
 * Fetch all services for a given domain registered in Home Assistant.
 * @param domain - Service domain (e.g., "esphome", "light", "switch"). Defaults to "esphome".
 * @param pattern - Optional glob pattern to filter service names (e.g., "*_get_build_flags")
 * @returns Array of fully qualified service names
 */
export const getServices = async (domain: string = 'esphome', pattern?: string): Promise<string[]> => {
  const params = new URLSearchParams();
  params.set('domain', domain);
  if (pattern) {
    params.set('pattern', pattern);
  }

  const url = ingressAware(`api/device-mappings/services?${params.toString()}`);
  const res = await fetch(url);

  if (!res.ok) {
    console.error('Failed to fetch services:', res.status);
    return [];
  }

  const data = (await res.json()) as ServicesResponse;
  return data.services;
};

/**
 * Convenience function to fetch ESPHome services.
 * Optionally filter by glob pattern (e.g., "*_get_build_flags").
 */
export const getEsphomeServices = async (pattern?: string): Promise<string[]> => {
  return getServices('esphome', pattern);
};

/**
 * Update service mappings for a device.
 * Setting confirmed=true will protect these mappings from being overwritten during re-sync.
 */
export const updateServiceMappings = async (
  deviceId: string,
  serviceMappings: Record<string, string>,
  confirmed: boolean = true
): Promise<boolean> => {
  const url = ingressAware(`api/device-mappings/${deviceId}/service-mappings`);
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serviceMappings, confirmed }),
  });

  return res.ok;
};
