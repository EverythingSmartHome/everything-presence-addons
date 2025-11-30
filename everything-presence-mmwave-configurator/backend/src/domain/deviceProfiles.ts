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
  label: string;
  manufacturer: string;
  capabilities: unknown;
  limits: DeviceProfileLimits;
  /** New categorized entity definitions */
  entities?: Record<string, EntityDefinition>;
  /** Legacy entity map (for backward compatibility) */
  entityMap: Record<string, unknown>;
  iconUrl?: string;
}

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
        return [parsed];
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
