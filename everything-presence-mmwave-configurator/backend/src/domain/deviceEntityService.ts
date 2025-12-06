import { deviceMappingStorage, DeviceMapping } from '../config/deviceMappingStorage';
import { DeviceProfileLoader, DeviceProfile, EntityDefinition, EntityCategory } from './deviceProfiles';
import { ZoneEntitySet, TargetEntitySet } from './types';
import { logger } from '../logger';

// Re-export EntityDefinition for consumers
export type { EntityDefinition };

export interface ResolvedEntity {
  key: string;
  entityId: string;
  definition?: EntityDefinition;
}

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
}

export interface SettingsGroup {
  group: string;
  settings: SettingEntity[];
}

/**
 * Service for resolving device entities.
 * Uses device mapping storage (new) with fallback to legacy entityMap resolution.
 */
class DeviceEntityServiceImpl {
  private profileLoader: DeviceProfileLoader | null = null;
  private legacyFallbackWarned = new Set<string>();

  /**
   * Set the profile loader. Called during app initialization.
   */
  setProfileLoader(loader: DeviceProfileLoader): void {
    this.profileLoader = loader;
  }

  /**
   * Get the device mapping for a device.
   */
  getMapping(deviceId: string): DeviceMapping | null {
    return deviceMappingStorage.getMapping(deviceId);
  }

  /**
   * Get a specific entity ID by key.
   * Returns null if not found.
   */
  getEntityId(deviceId: string, entityKey: string): string | null {
    const mapping = deviceMappingStorage.getMapping(deviceId);
    if (mapping?.mappings[entityKey]) {
      return mapping.mappings[entityKey];
    }
    return null;
  }

  /**
   * Get all entities by category.
   */
  getEntitiesByCategory(
    deviceId: string,
    category: EntityCategory
  ): ResolvedEntity[] {
    const mapping = deviceMappingStorage.getMapping(deviceId);
    if (!mapping) return [];

    const profile = this.getProfile(mapping.profileId);
    if (!profile) return [];

    // If profile has new "entities" format, use it
    if (profile.entities) {
      const results: ResolvedEntity[] = [];
      for (const [key, def] of Object.entries(profile.entities as Record<string, EntityDefinition>)) {
        if (def.category === category && mapping.mappings[key]) {
          results.push({
            key,
            entityId: mapping.mappings[key],
            definition: def,
          });
        }
      }
      return results;
    }

    // Fallback: infer from mapping keys based on naming patterns
    const results: ResolvedEntity[] = [];
    for (const [key, entityId] of Object.entries(mapping.mappings)) {
      const inferredCategory = this.inferCategoryFromKey(key);
      if (inferredCategory === category) {
        results.push({ key, entityId });
      }
    }
    return results;
  }

  /**
   * Infer entity category from key name (for legacy entityMap format).
   */
  private inferCategoryFromKey(key: string): EntityCategory | null {
    const lower = key.toLowerCase();

    // Tracking patterns
    if (lower.includes('target') && (lower.includes('x') || lower.includes('y') || lower.includes('speed') ||
        lower.includes('angle') || lower.includes('distance') || lower.includes('resolution') || lower.includes('active'))) {
      return 'tracking';
    }

    // Zone patterns
    if (lower.includes('zone') && (lower.includes('begin') || lower.includes('end') || lower.includes('polygon'))) {
      return 'zone';
    }
    if (lower.includes('exclusion') || lower.includes('entry') || lower.includes('mask')) {
      return 'zone';
    }

    // Sensor patterns
    if (lower.includes('occupancy') || lower.includes('presence') || lower.includes('temperature') ||
        lower.includes('humidity') || lower.includes('illuminance') || lower.includes('co2') ||
        lower.includes('pir') || lower.includes('mmwave') || lower.includes('light')) {
      if (!lower.includes('delay') && !lower.includes('distance') && !lower.includes('angle')) {
        return 'sensor';
      }
    }

    // Settings patterns
    if (lower.includes('distance') || lower.includes('delay') || lower.includes('angle') ||
        lower.includes('timeout') || lower.includes('speed') || lower.includes('behaviour') ||
        lower.includes('threshold') || lower.includes('mounting') || lower.includes('enabled') ||
        lower.includes('reset')) {
      return 'setting';
    }

    return null;
  }

  /**
   * Get zone entity set for a specific zone type and index.
   * Uses entities metadata when available, falls back to key patterns.
   * Returns null if any required coordinate is missing.
   */
  getZoneEntitySet(
    deviceId: string,
    zoneType: 'regular' | 'exclusion' | 'entry',
    zoneIndex: number
  ): ZoneEntitySet | null {
    const mapping = deviceMappingStorage.getMapping(deviceId);
    if (!mapping) return null;

    const profile = this.getProfile(mapping.profileId);
    if (!profile) return null;

    const result: Partial<ZoneEntitySet> = {};

    // Prefer using entities metadata if available
    if (profile.entities) {
      const entities = profile.entities as Record<string, EntityDefinition>;

      for (const [key, def] of Object.entries(entities)) {
        if (def.category === 'zone' && def.zoneType === zoneType && def.zoneIndex === zoneIndex) {
          const entityId = mapping.mappings[key];
          if (entityId && def.coord) {
            const coord = def.coord as keyof ZoneEntitySet;
            result[coord] = entityId;
          }
        }
      }

      // Also look for off delay in settings
      const offDelayKey = `zone${zoneIndex}OffDelay`;
      if (mapping.mappings[offDelayKey]) {
        result.offDelay = mapping.mappings[offDelayKey];
      }
    } else {
      // Fallback: try to find entities by key patterns
      const keyPatterns = this.getZoneKeyPatterns(zoneType, zoneIndex);

      for (const coord of ['beginX', 'endX', 'beginY', 'endY'] as const) {
        const directKey = keyPatterns[coord];
        if (directKey && mapping.mappings[directKey]) {
          result[coord] = mapping.mappings[directKey];
        }
      }

      if (keyPatterns.offDelay && mapping.mappings[keyPatterns.offDelay]) {
        result.offDelay = mapping.mappings[keyPatterns.offDelay];
      }
    }

    // Validate required coords
    if (!result.beginX || !result.endX || !result.beginY || !result.endY) {
      logger.debug(
        { deviceId, zoneType, zoneIndex, result },
        'Zone missing required coordinates'
      );
      return null;
    }

    return result as ZoneEntitySet;
  }

  /**
   * Get zone key patterns for building keys (fallback for legacy profiles).
   */
  private getZoneKeyPatterns(
    zoneType: 'regular' | 'exclusion' | 'entry',
    zoneIndex: number
  ): Record<string, string> {
    if (zoneType === 'regular') {
      return {
        beginX: `zone${zoneIndex}BeginX`,
        endX: `zone${zoneIndex}EndX`,
        beginY: `zone${zoneIndex}BeginY`,
        endY: `zone${zoneIndex}EndY`,
        offDelay: `zone${zoneIndex}OffDelay`,
      };
    } else if (zoneType === 'exclusion') {
      return {
        beginX: `exclusion${zoneIndex}BeginX`,
        endX: `exclusion${zoneIndex}EndX`,
        beginY: `exclusion${zoneIndex}BeginY`,
        endY: `exclusion${zoneIndex}EndY`,
      };
    } else {
      return {
        beginX: `entry${zoneIndex}BeginX`,
        endX: `entry${zoneIndex}EndX`,
        beginY: `entry${zoneIndex}BeginY`,
        endY: `entry${zoneIndex}EndY`,
      };
    }
  }

  /**
   * Get polygon zone entity ID.
   * Uses entities metadata when available, falls back to key patterns.
   */
  getPolygonZoneEntity(
    deviceId: string,
    zoneType: 'polygon' | 'polygonExclusion' | 'polygonEntry',
    zoneIndex: number
  ): string | null {
    const mapping = deviceMappingStorage.getMapping(deviceId);
    if (!mapping) return null;

    const profile = this.getProfile(mapping.profileId);

    // Prefer using entities metadata if available
    if (profile?.entities) {
      const entities = profile.entities as Record<string, EntityDefinition>;

      for (const [key, def] of Object.entries(entities)) {
        if (def.category === 'zone' && def.zoneType === zoneType && def.zoneIndex === zoneIndex) {
          return mapping.mappings[key] || null;
        }
      }
    }

    // Fallback: build key based on zone type
    let key: string;
    if (zoneType === 'polygon') {
      key = `polygonZone${zoneIndex}`;
    } else if (zoneType === 'polygonExclusion') {
      key = `polygonExclusion${zoneIndex}`;
    } else {
      key = `polygonEntry${zoneIndex}`;
    }

    return mapping.mappings[key] || null;
  }

  /**
   * Get target entity set for a specific target index.
   * Uses entities metadata when available, falls back to key patterns.
   * Returns null if x or y are missing (required).
   */
  getTargetEntities(deviceId: string, targetIndex: number): TargetEntitySet | null {
    const mapping = deviceMappingStorage.getMapping(deviceId);
    if (!mapping) return null;

    const profile = this.getProfile(mapping.profileId);
    const result: Partial<TargetEntitySet> = {};

    // Prefer using entities metadata if available
    if (profile?.entities) {
      const entities = profile.entities as Record<string, EntityDefinition>;

      for (const [key, def] of Object.entries(entities)) {
        if (def.category === 'tracking' && def.targetIndex === targetIndex && def.property) {
          const entityId = mapping.mappings[key];
          if (entityId) {
            const prop = def.property as keyof TargetEntitySet;
            result[prop] = entityId;
          }
        }
      }
    } else {
      // Fallback: build target entity keys
      const properties = ['x', 'y', 'speed', 'distance', 'angle', 'resolution', 'active'] as const;

      for (const prop of properties) {
        const key = `target${targetIndex}${prop.charAt(0).toUpperCase()}${prop.slice(1)}`;
        // Also try lowercase version
        const altKey = `target${targetIndex}_${prop}`;

        if (mapping.mappings[key]) {
          result[prop] = mapping.mappings[key];
        } else if (mapping.mappings[altKey]) {
          result[prop] = mapping.mappings[altKey];
        }
      }
    }

    // x and y are required
    if (!result.x || !result.y) {
      logger.debug(
        { deviceId, targetIndex, result },
        'Target missing required x/y coordinates'
      );
      return null;
    }

    return result as TargetEntitySet;
  }

  /**
   * Get all tracking targets that have valid mappings.
   */
  getAllTargets(deviceId: string): TargetEntitySet[] {
    const mapping = deviceMappingStorage.getMapping(deviceId);
    if (!mapping) return [];

    const profile = this.getProfile(mapping.profileId);
    const maxTargets = profile?.limits?.maxTargets ?? 3;

    const targets: TargetEntitySet[] = [];
    for (let i = 1; i <= maxTargets; i++) {
      const target = this.getTargetEntities(deviceId, i);
      if (target) {
        targets.push(target);
      }
    }

    return targets;
  }

  /**
   * Get all settings entities grouped by group name.
   */
  getSettingsGrouped(deviceId: string): SettingsGroup[] {
    const mapping = deviceMappingStorage.getMapping(deviceId);
    if (!mapping) return [];

    const profile = this.getProfile(mapping.profileId);
    if (!profile) return [];

    const groups: Record<string, SettingEntity[]> = {};

    // If profile has new "entities" format with metadata
    if (profile.entities) {
      for (const [key, def] of Object.entries(profile.entities as Record<string, EntityDefinition>)) {
        if (def.category === 'setting' && mapping.mappings[key]) {
          const group = def.group || 'General';
          if (!groups[group]) {
            groups[group] = [];
          }
          // Use entityUnits from device mapping if available, otherwise fall back to profile unit
          const unit = mapping.entityUnits?.[key] || def.unit;
          groups[group].push({
            key,
            entityId: mapping.mappings[key],
            label: def.label,
            controlType: def.controlType,
            min: def.min,
            max: def.max,
            step: def.step,
            unit,
            options: def.options,
            description: def.description,
          });
        }
      }
    } else {
      // Fallback: extract from legacy entityMap.settingsEntities
      const entityMap = profile.entityMap as Record<string, unknown>;
      const settingsEntities = entityMap?.settingsEntities as Record<string, string> | undefined;

      if (settingsEntities) {
        const group = 'Settings';
        groups[group] = [];
        for (const [key, template] of Object.entries(settingsEntities)) {
          if (mapping.mappings[key]) {
            groups[group].push({
              key,
              entityId: mapping.mappings[key],
              label: this.formatKeyAsLabel(key),
            });
          }
        }
      }
    }

    // Convert to array sorted by group name
    return Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([group, settings]) => ({ group, settings }));
  }

  /**
   * Format a camelCase key as a human-readable label.
   */
  private formatKeyAsLabel(key: string): string {
    return key
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (str) => str.toUpperCase())
      .trim();
  }

  /**
   * Check if a device has valid mappings.
   */
  hasValidMappings(deviceId: string): boolean {
    const mapping = deviceMappingStorage.getMapping(deviceId);
    if (!mapping) return false;

    // Must have at least the presence entity
    return !!mapping.mappings.presence || !!mapping.mappings.presenceEntity;
  }

  /**
   * Get the unit of measurement for a specific entity key.
   * Returns null if no unit is stored.
   */
  getEntityUnit(deviceId: string, entityKey: string): string | null {
    const mapping = deviceMappingStorage.getMapping(deviceId);
    return mapping?.entityUnits?.[entityKey] || null;
  }

  /**
   * Get all stored entity units for a device.
   */
  getEntityUnits(deviceId: string): Record<string, string> {
    const mapping = deviceMappingStorage.getMapping(deviceId);
    return mapping?.entityUnits || {};
  }

  /**
   * Get list of entity keys that are missing mappings.
   */
  getMissingEntities(deviceId: string): string[] {
    const mapping = deviceMappingStorage.getMapping(deviceId);
    if (!mapping) return ['ALL'];

    const profile = this.getProfile(mapping.profileId);
    if (!profile) return [];

    const missing: string[] = [];

    // Check new format
    if (profile.entities) {
      for (const [key, def] of Object.entries(profile.entities as Record<string, EntityDefinition>)) {
        if (def.required && !mapping.mappings[key]) {
          missing.push(key);
        }
      }
    }

    return missing;
  }

  /**
   * Get profile by ID.
   */
  getProfile(profileId: string): (DeviceProfile & { entities?: Record<string, EntityDefinition> }) | null {
    if (!this.profileLoader) {
      logger.warn('DeviceEntityService: ProfileLoader not set');
      return null;
    }
    return this.profileLoader.getProfileById(profileId) as DeviceProfile & { entities?: Record<string, EntityDefinition> } | undefined ?? null;
  }

  /**
   * Resolve an entity with fallback to legacy room mappings.
   * Logs a rate-limited warning when using legacy fallback.
   */
  resolveWithFallback(
    deviceId: string,
    entityKey: string,
    legacyMappings?: Record<string, unknown>
  ): string | null {
    // Try device mapping first (preferred)
    const deviceMapping = deviceMappingStorage.getMapping(deviceId);
    if (deviceMapping?.mappings[entityKey]) {
      return deviceMapping.mappings[entityKey];
    }

    // Legacy fallback with rate-limited warning
    if (legacyMappings) {
      if (!this.legacyFallbackWarned.has(deviceId)) {
        logger.warn(
          { deviceId, entityKey },
          'Using legacy room mappings - device needs migration'
        );
        this.legacyFallbackWarned.add(deviceId);
      }

      // Try to find in legacy mappings
      const value = legacyMappings[entityKey];
      if (typeof value === 'string') {
        return value;
      }
    }

    return null;
  }

  /**
   * Clear the legacy fallback warning cache (for testing).
   */
  clearFallbackWarnings(): void {
    this.legacyFallbackWarned.clear();
  }
}

// Export singleton instance
export const deviceEntityService = new DeviceEntityServiceImpl();

// Re-export types
export type { DeviceMapping };
