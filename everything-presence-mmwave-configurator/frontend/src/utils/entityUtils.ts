import { EntityMappings } from '../api/types';

/**
 * Extract entity name prefix from a known entity mapping.
 * e.g., "binary_sensor.everything_presence_lite_285460_occupancy" -> "everything_presence_lite_285460"
 */
export const extractPrefixFromEntity = (entityId: string, knownSuffix: string): string | null => {
  // Remove domain prefix (e.g., "binary_sensor.")
  const withoutDomain = entityId.replace(/^[^.]+\./, '');
  // Remove known suffix to get the device prefix
  if (withoutDomain.endsWith(knownSuffix)) {
    return withoutDomain.slice(0, -knownSuffix.length);
  }
  return null;
};

/**
 * Derive entity prefix from entityMappings by looking at known entities.
 * This is more reliable than entityNamePrefix which may be corrupted.
 *
 * Use this instead of room.entityNamePrefix when constructing entity IDs
 * to avoid issues with corrupted prefix values.
 */
export const deriveEntityPrefix = (mappings: EntityMappings | undefined): string | null => {
  if (!mappings) return null;

  // Try to extract from presenceEntity (most reliable - always present)
  if (mappings.presenceEntity) {
    const prefix = extractPrefixFromEntity(mappings.presenceEntity, '_occupancy');
    if (prefix) return prefix;
  }

  // Try maxDistanceEntity
  if (mappings.maxDistanceEntity) {
    const prefix = extractPrefixFromEntity(mappings.maxDistanceEntity, '_max_distance');
    if (prefix) return prefix;
  }

  // Try installationAngleEntity
  if (mappings.installationAngleEntity) {
    const prefix = extractPrefixFromEntity(mappings.installationAngleEntity, '_installation_angle');
    if (prefix) return prefix;
  }

  // Try trackingTargetCountEntity
  if (mappings.trackingTargetCountEntity) {
    const prefix = extractPrefixFromEntity(mappings.trackingTargetCountEntity, '_zone_1_target_count');
    if (prefix) return prefix;
  }

  // Try polygonZonesEnabledEntity
  if (mappings.polygonZonesEnabledEntity) {
    const prefix = extractPrefixFromEntity(mappings.polygonZonesEnabledEntity, '_polygon_zones');
    if (prefix) return prefix;
  }

  return null;
};

/**
 * Get the effective entity prefix for a room.
 * First tries to derive from entityMappings, then falls back to entityNamePrefix.
 */
export const getEffectiveEntityPrefix = (
  entityMappings: EntityMappings | undefined,
  entityNamePrefix: string | undefined
): string | null => {
  const derived = deriveEntityPrefix(entityMappings);
  return derived || entityNamePrefix || null;
};
