import fs from 'fs';
import path from 'path';
import { logger } from '../logger';

export interface DeviceProfileLimits {
  maxZones?: number;
  maxExclusionZones?: number;
  maxEntryZones?: number;
  maxTargets?: number;
  maxRangeMeters?: number;
  fieldOfViewDegrees?: number;
}

/** The capability flags that decide whether a zone type exists at all. */
export interface ZoneCapabilityFlags {
  zones?: boolean;
  exclusionZones?: boolean;
  entryZones?: boolean;
  polygonZones?: boolean;
}

export interface ResolvedZoneLimits {
  maxZones: number;
  maxExclusionZones: number;
  maxEntryZones: number;
}

/**
 * Slot counts assumed when a profile says nothing at all about a zone type -
 * the legacy Everything Presence Lite shape.
 *
 * These apply only in the absence of both a capability flag and a limit. A
 * profile that declares `zones: false` resolves to zero slots of every kind,
 * so a missing limit can never be read as "two".
 */
export const DEFAULT_ZONE_LIMITS: ResolvedZoneLimits = {
  maxZones: 4,
  maxExclusionZones: 2,
  maxEntryZones: 2,
};

const readZoneCapabilities = (capabilities: unknown): ZoneCapabilityFlags => {
  if (!capabilities || typeof capabilities !== 'object') return {};
  return capabilities as ZoneCapabilityFlags;
};

const resolveLimit = (value: unknown, supported: boolean | undefined, fallback: number): number => {
  // The capability is authoritative: an unsupported feature has no slots,
  // whatever the limits block claims.
  if (supported === false) return 0;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  return fallback;
};

/**
 * How many zones of each type a profile allows.
 *
 * Exclusion and entry zones inherit a `zones: false` capability, so a
 * distance-only sensor cannot acquire them by omitting a limit.
 */
export const resolveZoneLimits = (
  profile: Pick<DeviceProfile, 'capabilities' | 'limits'> | null | undefined
): ResolvedZoneLimits => {
  const capabilities = readZoneCapabilities(profile?.capabilities);
  const limits = profile?.limits ?? {};
  return {
    maxZones: resolveLimit(limits.maxZones, capabilities.zones, DEFAULT_ZONE_LIMITS.maxZones),
    maxExclusionZones: resolveLimit(
      limits.maxExclusionZones,
      capabilities.exclusionZones ?? capabilities.zones,
      DEFAULT_ZONE_LIMITS.maxExclusionZones
    ),
    maxEntryZones: resolveLimit(
      limits.maxEntryZones,
      capabilities.entryZones ?? capabilities.zones,
      DEFAULT_ZONE_LIMITS.maxEntryZones
    ),
  };
};

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
export type ControlType = 'number' | 'switch' | 'select' | 'light' | 'text' | 'button';

export interface ServiceDefinition {
  domain: string;
  template: string;
}

/**
 * Entity definition in the device profile.
 * Provides full metadata for each entity type.
 */
export interface EntityDefinition {
  /** Template pattern with ${name} placeholder */
  template: string;
  /** Category for grouping and dynamic loading */
  category: EntityCategory;
  /** Whether this entity is required */
  required: boolean;

  // Sensor-specific fields
  /** Subcategory for sensors (presence, environment, zoneOccupancy, zoneTargetCount) */
  subcategory?: string;

  // Setting-specific fields
  /** Group name for UI organization */
  group?: string;
  /** Display label */
  label?: string;
  /** Control type for UI rendering */
  controlType?: ControlType;
  /** Minimum value for number controls */
  min?: number;
  /** Maximum value for number controls */
  max?: number;
  /** Step value for number controls */
  step?: number;
  /** Unit of measurement */
  unit?: string;
  /** Description/help text */
  description?: string;
  /** Options for select controls */
  options?: string[];

  // Zone-specific fields
  /** Zone type (regular, exclusion, entry, polygon, etc.) */
  zoneType?: ZoneType;
  /** Zone index (1-4 for zones, 1-2 for exclusion/entry) */
  zoneIndex?: number;
  /** Coordinate type (beginX, endX, beginY, endY) */
  coord?: string;

  // Tracking-specific fields
  /** Target index (1, 2, 3) */
  targetIndex?: number;
  /** Property name (x, y, speed, distance, angle, resolution, active) */
  property?: string;
}

export interface DeviceProfile {
  id: string;
  /** Schema version - bump when entities/features change to trigger resync prompts */
  schemaVersion?: string;
  label: string;
  manufacturer: string;
  capabilities: unknown;
  limits: DeviceProfileLimits;
  /** New categorized entity definitions */
  entities?: Record<string, EntityDefinition>;
  /** Service definitions for device actions */
  services?: Record<string, ServiceDefinition>;
  /** Legacy entity map (for backward compatibility) */
  entityMap: Record<string, unknown>;
  iconUrl?: string;
  iconUrlCeiling?: string;
  coverage?: {
    presets: Record<string, { label: string; horizontalFovDeg: number; verticalFovDeg: number; maxRangeMeters: number }>;
    secondarySensors?: Record<string, { label: string; horizontalFovDeg: number; verticalFovDeg: number; maxRangeMeters: number }>;
    defaultPresetId?: string;
  };
}

/**
 * Fill in a profile's zone limits once, at load time, so no consumer has to
 * guess a default for a missing key. A profile whose limits contradict its
 * capabilities is corrected here and logged, since that is a packaging mistake
 * rather than a runtime condition.
 */
export const normalizeDeviceProfile = (profile: DeviceProfile): DeviceProfile => {
  const resolved = resolveZoneLimits(profile);
  const declared = profile.limits ?? {};

  for (const key of ['maxZones', 'maxExclusionZones', 'maxEntryZones'] as const) {
    const declaredValue = declared[key];
    if (typeof declaredValue === 'number' && declaredValue !== resolved[key]) {
      logger.warn(
        { profile: profile.id, limit: key, declared: declaredValue, applied: resolved[key] },
        'Device profile limit contradicts its capabilities; using the capability'
      );
    }
  }

  return {
    ...profile,
    limits: { ...declared, ...resolved },
  };
};

export class DeviceProfileLoader {
  private readonly dir: string;

  constructor(dir: string, fallbackDir?: string) {
    this.dir = fs.existsSync(dir) ? dir : fallbackDir ?? dir;
  }

  listProfiles(): DeviceProfile[] {
    if (!fs.existsSync(this.dir)) {
      logger.warn({ dir: this.dir }, 'Device profiles directory missing');
      return [];
    }

    const files = fs.readdirSync(this.dir).filter((f) => f.endsWith('.json'));

    return files.flatMap((file) => {
      const fullPath = path.join(this.dir, file);
      try {
        const raw = fs.readFileSync(fullPath, 'utf-8');
        const parsed = JSON.parse(raw) as DeviceProfile;
        return [normalizeDeviceProfile(parsed)];
      } catch (error) {
        logger.warn({ file: fullPath, error }, 'Failed to parse device profile');
        return [];
      }
    });
  }

  getProfileById(id: string): DeviceProfile | undefined {
    return this.listProfiles().find((p) => p.id === id);
  }
}
