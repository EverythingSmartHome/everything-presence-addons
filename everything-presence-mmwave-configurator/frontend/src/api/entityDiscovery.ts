import { ingressAware } from './client';
import { EntityMappings } from './types';
import { DeviceMapping } from './deviceMappings';

/**
 * Entity registry entry from Home Assistant.
 */
export interface EntityRegistryEntry {
  entity_id: string;
  name: string | null;
  platform: string;
  device_id: string | null;
  disabled_by: 'user' | 'integration' | 'config_entry' | null;
  hidden_by: string | null;
}

/**
 * Confidence level for entity matching.
 */
export type MatchConfidence = 'exact' | 'suffix' | 'name' | 'none';

/**
 * Result of matching a single entity template.
 */
export interface EntityMatchResult {
  templateKey: string;
  templatePattern: string | null;
  matchedEntityId: string | null;
  matchConfidence: MatchConfidence;
  isOptional: boolean;
  candidates: string[];
}

/**
 * Full discovery result for a device.
 */
export interface DiscoveryResult {
  deviceId: string;
  profileId: string;
  allMatched: boolean;
  matchedCount: number;
  unmatchedCount: number;
  optionalMissingCount: number;
  results: EntityMatchResult[];
  suggestedMappings: Partial<EntityMappings>;
  deviceEntities: EntityRegistryEntry[];
}

/**
 * Validation error for entity mapping.
 */
export interface ValidationError {
  key: string;
  entityId: string;
  error: string;
}

/**
 * Validation result for entity mappings.
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Discover and auto-match entities for a device against a profile.
 */
export const discoverEntities = async (
  deviceId: string,
  profileId: string
): Promise<DiscoveryResult> => {
  const params = new URLSearchParams({ profileId });
  const res = await fetch(
    ingressAware(`api/devices/${deviceId}/discover-entities?${params}`)
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discovery failed: ${res.status} ${res.statusText} - ${text}`);
  }

  return res.json();
};

/**
 * Get all entities belonging to a device.
 */
export const getDeviceEntities = async (
  deviceId: string
): Promise<{ entities: EntityRegistryEntry[] }> => {
  const res = await fetch(ingressAware(`api/devices/${deviceId}/entities`));

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get entities: ${res.status} ${res.statusText} - ${text}`);
  }

  return res.json();
};

/**
 * Validate that a set of entity mappings are accessible.
 */
export const validateMappings = async (
  deviceId: string,
  mappings: Partial<EntityMappings>
): Promise<ValidationResult> => {
  const res = await fetch(
    ingressAware(`api/devices/${deviceId}/validate-mappings`),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mappings }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Validation failed: ${res.status} ${res.statusText} - ${text}`);
  }

  return res.json();
};

/**
 * Discover entities and save to device mapping storage.
 * This is the primary method to wire frontend discovery to device mappings.
 */
export interface DiscoverAndSaveResult {
  mapping: DeviceMapping;
  discovery: DiscoveryResult;
}

export const discoverAndSaveEntities = async (
  deviceId: string,
  profileId: string,
  deviceName: string
): Promise<DiscoverAndSaveResult> => {
  const res = await fetch(
    ingressAware(`api/devices/${deviceId}/discover-and-save`),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId, deviceName }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discover and save failed: ${res.status} ${res.statusText} - ${text}`);
  }

  return res.json();
};

/**
 * Group entity match results by category for display.
 */
export const groupMatchResultsByCategory = (
  results: EntityMatchResult[]
): Record<string, EntityMatchResult[]> => {
  const groups: Record<string, EntityMatchResult[]> = {
    'Presence Sensors': [],
    'Environmental Sensors': [],
    'Distance/Tracking': [],
    'Configuration': [],
    'Zone 1': [],
    'Zone 2': [],
    'Zone 3': [],
    'Zone 4': [],
    'Exclusion Zones': [],
    'Entry Zones': [],
    'Polygon Zones': [],
    'Tracking Targets': [],
    'Other': [],
  };

  for (const result of results) {
    const key = result.templateKey;

    if (key.includes('presence') || key.includes('mmwave') || key.includes('pir') || key === 'presenceEntity' || key === 'mmwaveEntity' || key === 'pirEntity') {
      groups['Presence Sensors'].push(result);
    } else if (key.includes('temperature') || key.includes('humidity') || key.includes('illuminance') || key.includes('co2')) {
      groups['Environmental Sensors'].push(result);
    } else if (key.includes('distance') || key.includes('speed') || key.includes('energy') || key.includes('targetCount')) {
      groups['Distance/Tracking'].push(result);
    } else if (key.includes('zoneConfigEntities.zone1')) {
      groups['Zone 1'].push(result);
    } else if (key.includes('zoneConfigEntities.zone2')) {
      groups['Zone 2'].push(result);
    } else if (key.includes('zoneConfigEntities.zone3')) {
      groups['Zone 3'].push(result);
    } else if (key.includes('zoneConfigEntities.zone4')) {
      groups['Zone 4'].push(result);
    } else if (key.includes('exclusion')) {
      groups['Exclusion Zones'].push(result);
    } else if (key.includes('entry')) {
      groups['Entry Zones'].push(result);
    } else if (key.includes('polygon')) {
      groups['Polygon Zones'].push(result);
    } else if (key.includes('trackingTargets')) {
      groups['Tracking Targets'].push(result);
    } else if (key.includes('max') || key.includes('installation') || key.includes('mode') || key.includes('Enabled')) {
      groups['Configuration'].push(result);
    } else {
      groups['Other'].push(result);
    }
  }

  // Remove empty groups
  for (const key of Object.keys(groups)) {
    if (groups[key].length === 0) {
      delete groups[key];
    }
  }

  return groups;
};

/**
 * Get a human-readable label for a template key.
 */
export const getTemplateKeyLabel = (templateKey: string): string => {
  // Handle nested keys like "zoneConfigEntities.zone1.beginX"
  const parts = templateKey.split('.');
  const lastPart = parts[parts.length - 1];

  const labels: Record<string, string> = {
    presenceEntity: 'Occupancy',
    mmwaveEntity: 'mmWave',
    pirEntity: 'PIR',
    temperatureEntity: 'Temperature',
    humidityEntity: 'Humidity',
    illuminanceEntity: 'Illuminance',
    co2Entity: 'CO2',
    distanceEntity: 'Distance',
    speedEntity: 'Speed',
    energyEntity: 'Energy',
    targetCountEntity: 'Target Count',
    modeEntity: 'Mode',
    maxDistanceEntity: 'Max Distance',
    installationAngleEntity: 'Installation Angle',
    polygonZonesEnabledEntity: 'Polygon Zones Switch',
    trackingTargetCountEntity: 'Tracking Target Count',
    beginX: 'Begin X',
    endX: 'End X',
    beginY: 'Begin Y',
    endY: 'End Y',
    offDelay: 'Off Delay',
    x: 'X Position',
    y: 'Y Position',
    speed: 'Speed',
    resolution: 'Resolution',
    angle: 'Angle',
    distance: 'Distance',
    active: 'Active',
  };

  return labels[lastPart] || lastPart.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
};
