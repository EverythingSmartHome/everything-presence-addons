import type { EntityMappings, RoomConfig, ZoneEntitySet } from './types';
import { logger } from '../logger';

/**
 * Utility for resolving entity IDs from stored mappings or template patterns.
 * Provides backward compatibility during migration from entityNamePrefix to entityMappings.
 */
export class EntityResolver {
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
   */
  static createResolver(room: RoomConfig) {
    const { entityMappings, entityNamePrefix } = room;

    return {
      resolve: (mappingKey: string, template: string | null | undefined) =>
        EntityResolver.resolve(entityMappings, entityNamePrefix, mappingKey, template),

      resolveZone: (
        groupKey: 'zoneConfigEntities' | 'exclusionZoneConfigEntities' | 'entryZoneConfigEntities',
        zoneKey: string,
        templateGroup: Record<string, string> | undefined
      ) =>
        EntityResolver.resolveZoneEntitySet(entityMappings, entityNamePrefix, groupKey, zoneKey, templateGroup),

      resolvePolygon: (
        groupKey: 'polygonZoneEntities' | 'polygonExclusionEntities' | 'polygonEntryEntities',
        zoneKey: string,
        template: string | undefined
      ) =>
        EntityResolver.resolvePolygonZoneEntity(entityMappings, entityNamePrefix, groupKey, zoneKey, template),

      resolveTarget: (targetNum: number, property: 'x' | 'y' | 'speed' | 'resolution' | 'angle' | 'distance' | 'active') =>
        EntityResolver.resolveTargetEntity(entityMappings, entityNamePrefix, targetNum, property),

      hasMappings: () => EntityResolver.hasMappings(room),
    };
  }
}
