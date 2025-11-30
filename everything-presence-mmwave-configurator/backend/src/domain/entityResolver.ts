import type { EntityMappings, RoomConfig, ZoneEntitySet } from './types';
import { logger } from '../logger';
import { deviceMappingStorage } from '../config/deviceMappingStorage';
import { deviceEntityService } from './deviceEntityService';

// Track devices for which we've already logged deprecation warnings
const deprecationWarned = new Set<string>();

/**
 * Utility for resolving entity IDs from stored mappings or template patterns.
 * Provides backward compatibility during migration from entityNamePrefix to entityMappings.
 *
 * PREFERRED: Use deviceEntityService for new code. This class is maintained for
 * backward compatibility during migration.
 */
export class EntityResolver {
  /**
   * Resolve an entity ID directly from device-level storage.
   * This is the preferred method for new code.
   *
   * @param deviceId - Home Assistant device ID
   * @param entityKey - Key in the device mappings (e.g., "presence", "maxDistance")
   * @returns Resolved entity ID or null if not found
   */
  static resolveFromDevice(deviceId: string, entityKey: string): string | null {
    return deviceEntityService.getEntityId(deviceId, entityKey);
  }

  /**
   * Check if a device has mappings in device-level storage.
   */
  static hasDeviceMappings(deviceId: string): boolean {
    return deviceMappingStorage.hasMapping(deviceId);
  }

  /**
   * Check if a room has entity mappings configured.
   */
  static hasMappings(room: RoomConfig): boolean {
    return !!room.entityMappings && Object.keys(room.entityMappings).length > 3; // More than just metadata
  }

  /**
   * Resolve an entity ID from mappings, with fallback to template resolution.
   *
   * @param mappings - Stored entity mappings (preferred)
   * @param entityNamePrefix - Legacy prefix for template resolution (fallback)
   * @param mappingKey - Key in the mappings object (e.g., "presenceEntity")
   * @param template - Template pattern for fallback (e.g., "binary_sensor.${name}_occupancy")
   * @returns Resolved entity ID or null if not found
   */
  static resolve(
    mappings: EntityMappings | undefined,
    entityNamePrefix: string | undefined,
    mappingKey: string,
    template: string | null | undefined
  ): string | null {
    // First, try to get from stored mappings
    if (mappings) {
      const stored = (mappings as Record<string, unknown>)[mappingKey];
      if (typeof stored === 'string') {
        return stored;
      }
    }

    // Fallback to template resolution
    if (template && entityNamePrefix) {
      return template.replace('${name}', entityNamePrefix);
    }

    return null;
  }

  /**
   * Resolve a zone entity set from mappings or templates.
   *
   * @param mappings - Stored entity mappings
   * @param entityNamePrefix - Legacy prefix
   * @param mappingGroupKey - Key for the zone group (e.g., "zoneConfigEntities")
   * @param zoneKey - Key for the specific zone (e.g., "zone1")
   * @param templateGroup - Template group from device profile
   * @returns Resolved zone entity set or null
   */
  static resolveZoneEntitySet(
    mappings: EntityMappings | undefined,
    entityNamePrefix: string | undefined,
    mappingGroupKey: 'zoneConfigEntities' | 'exclusionZoneConfigEntities' | 'entryZoneConfigEntities',
    zoneKey: string,
    templateGroup: Record<string, string> | undefined
  ): ZoneEntitySet | null {
    // Try stored mappings first
    if (mappings) {
      const group = mappings[mappingGroupKey];
      if (group && typeof group === 'object') {
        const zoneSet = (group as Record<string, ZoneEntitySet>)[zoneKey];
        if (zoneSet && zoneSet.beginX && zoneSet.endX && zoneSet.beginY && zoneSet.endY) {
          return zoneSet;
        }
      }
    }

    // Fallback to template resolution
    if (templateGroup && entityNamePrefix) {
      const beginX = templateGroup.beginX?.replace('${name}', entityNamePrefix);
      const endX = templateGroup.endX?.replace('${name}', entityNamePrefix);
      const beginY = templateGroup.beginY?.replace('${name}', entityNamePrefix);
      const endY = templateGroup.endY?.replace('${name}', entityNamePrefix);

      if (beginX && endX && beginY && endY) {
        return {
          beginX,
          endX,
          beginY,
          endY,
          offDelay: templateGroup.offDelay?.replace('${name}', entityNamePrefix),
        };
      }
    }

    return null;
  }

  /**
   * Resolve a polygon zone entity from mappings or templates.
   */
  static resolvePolygonZoneEntity(
    mappings: EntityMappings | undefined,
    entityNamePrefix: string | undefined,
    mappingGroupKey: 'polygonZoneEntities' | 'polygonExclusionEntities' | 'polygonEntryEntities',
    zoneKey: string,
    template: string | undefined
  ): string | null {
    // Try stored mappings first
    if (mappings) {
      const group = mappings[mappingGroupKey];
      if (group && typeof group === 'object') {
        const entityId = (group as Record<string, string>)[zoneKey];
        if (typeof entityId === 'string') {
          return entityId;
        }
      }
    }

    // Fallback to template resolution
    if (template && entityNamePrefix) {
      return template.replace('${name}', entityNamePrefix);
    }

    return null;
  }

  /**
   * Resolve a tracking target entity.
   */
  static resolveTargetEntity(
    mappings: EntityMappings | undefined,
    entityNamePrefix: string | undefined,
    targetNum: number,
    property: 'x' | 'y' | 'speed' | 'resolution' | 'angle' | 'distance' | 'active'
  ): string | null {
    const targetKey = `target${targetNum}`;

    // Try stored mappings first
    if (mappings?.trackingTargets) {
      const target = (mappings.trackingTargets as Record<string, Record<string, string>>)[targetKey];
      if (target && typeof target[property] === 'string') {
        return target[property];
      }
    }

    // Fallback to template resolution
    if (entityNamePrefix) {
      const domain = property === 'active' ? 'binary_sensor' : 'sensor';
      return `${domain}.${entityNamePrefix}_target_${targetNum}_${property}`;
    }

    return null;
  }

  /**
   * Get the effective entity prefix from mappings or legacy field.
   * Useful for operations that still need a prefix (e.g., logging, debugging).
   */
  static getEffectivePrefix(room: RoomConfig): string | undefined {
    // If we have mappings, try to extract a prefix from one of the entities
    if (room.entityMappings?.presenceEntity) {
      const match = room.entityMappings.presenceEntity.match(/^[^.]+\.(.+)_occupancy$/);
      if (match) return match[1];
    }

    // Fall back to legacy field
    return room.entityNamePrefix;
  }

  /**
   * Check if mappings need re-discovery (e.g., missing critical entities).
   */
  static needsRediscovery(
    mappings: EntityMappings | undefined,
    requiredKeys: string[]
  ): { needed: boolean; missingKeys: string[] } {
    if (!mappings) {
      return { needed: true, missingKeys: requiredKeys };
    }

    const missingKeys: string[] = [];
    for (const key of requiredKeys) {
      const value = (mappings as Record<string, unknown>)[key];
      if (!value || (typeof value !== 'string' && typeof value !== 'object')) {
        missingKeys.push(key);
      }
    }

    return {
      needed: missingKeys.length > 0,
      missingKeys,
    };
  }

  /**
   * Create a resolver function for a specific room.
   * Useful for repeated resolution in loops.
   *
   * UPDATED: Now tries device-level mappings first, then falls back to room.entityMappings.
   * Uses getEffectivePrefix to derive the most reliable prefix from mappings.
   */
  static createResolver(room: RoomConfig) {
    const { entityMappings, deviceId } = room;
    // Use effective prefix derived from mappings (more reliable than potentially corrupted entityNamePrefix)
    const effectivePrefix = EntityResolver.getEffectivePrefix(room);

    // Check if device has mappings in device-level storage (preferred)
    const hasDeviceMapping = deviceId ? deviceMappingStorage.hasMapping(deviceId) : false;

    // Log deprecation warning once per device when falling back to room mappings
    if (!hasDeviceMapping && entityMappings && deviceId && !deprecationWarned.has(deviceId)) {
      logger.warn(
        { deviceId, roomId: room.id },
        'Using deprecated room.entityMappings - device needs migration to device-level storage'
      );
      deprecationWarned.add(deviceId);
    }

    return {
      /**
       * Resolve an entity by mapping key.
       * Tries device-level mapping first, then room.entityMappings, then template.
       */
      resolve: (mappingKey: string, template: string | null | undefined): string | null => {
        // Try device-level mapping first (preferred)
        if (hasDeviceMapping && deviceId) {
          const deviceResult = deviceEntityService.getEntityId(deviceId, mappingKey);
          if (deviceResult) return deviceResult;
        }

        // Fall back to room.entityMappings (deprecated)
        return EntityResolver.resolve(entityMappings, effectivePrefix, mappingKey, template);
      },

      /**
       * Resolve zone coordinate entities.
       * Tries device-level mapping first for zone entity sets.
       */
      resolveZone: (
        groupKey: 'zoneConfigEntities' | 'exclusionZoneConfigEntities' | 'entryZoneConfigEntities',
        zoneKey: string,
        templateGroup: Record<string, string> | undefined
      ) => {
        // Try device-level mapping first
        if (hasDeviceMapping && deviceId) {
          const zoneType = groupKey === 'zoneConfigEntities' ? 'regular'
            : groupKey === 'exclusionZoneConfigEntities' ? 'exclusion' : 'entry';
          const zoneIndex = parseInt(zoneKey.replace(/\D/g, ''), 10) || 1;
          const deviceResult = deviceEntityService.getZoneEntitySet(deviceId, zoneType, zoneIndex);
          if (deviceResult) return deviceResult;
        }

        // Fall back to room.entityMappings
        return EntityResolver.resolveZoneEntitySet(entityMappings, effectivePrefix, groupKey, zoneKey, templateGroup);
      },

      /**
       * Resolve polygon zone entity.
       * Tries device-level mapping first.
       */
      resolvePolygon: (
        groupKey: 'polygonZoneEntities' | 'polygonExclusionEntities' | 'polygonEntryEntities',
        zoneKey: string,
        template: string | undefined
      ) => {
        // Try device-level mapping first
        if (hasDeviceMapping && deviceId) {
          const zoneType = groupKey === 'polygonZoneEntities' ? 'polygon'
            : groupKey === 'polygonExclusionEntities' ? 'polygonExclusion' : 'polygonEntry';
          const zoneIndex = parseInt(zoneKey.replace(/\D/g, ''), 10) || 1;
          const deviceResult = deviceEntityService.getPolygonZoneEntity(deviceId, zoneType, zoneIndex);
          if (deviceResult) return deviceResult;
        }

        // Fall back to room.entityMappings
        return EntityResolver.resolvePolygonZoneEntity(entityMappings, effectivePrefix, groupKey, zoneKey, template);
      },

      /**
       * Resolve tracking target entity.
       * Tries device-level mapping first.
       */
      resolveTarget: (targetNum: number, property: 'x' | 'y' | 'speed' | 'resolution' | 'angle' | 'distance' | 'active') => {
        // Try device-level mapping first
        if (hasDeviceMapping && deviceId) {
          const targetSet = deviceEntityService.getTargetEntities(deviceId, targetNum);
          if (targetSet && targetSet[property]) {
            return targetSet[property] as string;
          }
        }

        // Fall back to room.entityMappings
        return EntityResolver.resolveTargetEntity(entityMappings, effectivePrefix, targetNum, property);
      },

      /**
       * Check if room has any entity mappings (device or room level).
       */
      hasMappings: () => hasDeviceMapping || EntityResolver.hasMappings(room),

      /**
       * Check if device has device-level mappings (preferred).
       */
      hasDeviceMappings: () => hasDeviceMapping,

      /**
       * Get the effective entity prefix.
       */
      getPrefix: () => effectivePrefix,

      /**
       * Get the device ID for this room.
       */
      getDeviceId: () => deviceId,
    };
  }

  /**
   * Clear the deprecation warning cache (for testing).
   */
  static clearDeprecationWarnings(): void {
    deprecationWarned.clear();
  }
}
