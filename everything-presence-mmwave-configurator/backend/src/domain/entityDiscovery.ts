import type { IHaReadTransport } from '../ha/readTransport';
import type { EntityRegistryEntry } from '../ha/types';
import type { DeviceProfileLoader } from './deviceProfiles';
import type { EntityMappings, ZoneEntitySet, TargetEntitySet } from './types';
import { logger } from '../logger';

/**
 * Confidence level for entity matching.
 */
export type MatchConfidence = 'exact' | 'suffix' | 'name' | 'none';

/**
 * Result of matching a single entity template.
 */
export interface EntityMatchResult {
  templateKey: string;              // Key from device profile (e.g., "presenceEntity")
  templatePattern: string | null;   // Original template (e.g., "binary_sensor.${name}_occupancy")
  matchedEntityId: string | null;   // Actual entity ID found, or null
  matchConfidence: MatchConfidence;
  isOptional: boolean;              // Whether this entity is optional
  candidates: string[];             // Other possible matches for manual selection
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
  deviceEntities: EntityRegistryEntry[];  // All entities for this device
}

/**
 * Service for discovering and matching entities for a device.
 */
export class EntityDiscoveryService {
  constructor(
    private readonly readTransport: IHaReadTransport,
    private readonly profileLoader: DeviceProfileLoader
  ) {}

  /**
   * Get all entities belonging to a specific device.
   */
  async getDeviceEntities(deviceId: string): Promise<EntityRegistryEntry[]> {
    const entityRegistry = await this.readTransport.listEntityRegistry();
    return entityRegistry.filter((e) => e.device_id === deviceId);
  }

  /**
   * Discover and match entities for a device against a profile.
   */
  async discoverEntities(deviceId: string, profileId: string): Promise<DiscoveryResult> {
    logger.info({ deviceId, profileId }, 'Starting entity discovery');

    const profile = this.profileLoader.getProfileById(profileId);
    if (!profile) {
      throw new Error(`Profile not found: ${profileId}`);
    }

    // Get all entities for this device
    const deviceEntities = await this.getDeviceEntities(deviceId);
    logger.info({ deviceId, entityCount: deviceEntities.length }, 'Found device entities');

    if (deviceEntities.length === 0) {
      logger.warn({ deviceId }, 'No entities found for device');
      return {
        deviceId,
        profileId,
        allMatched: false,
        matchedCount: 0,
        unmatchedCount: 0,
        optionalMissingCount: 0,
        results: [],
        suggestedMappings: {
          discoveredAt: new Date().toISOString(),
          autoMatchedCount: 0,
          manuallyMappedCount: 0,
        },
        deviceEntities,
      };
    }

    // Group entities by domain for faster lookup
    const entitiesByDomain = this.groupEntitiesByDomain(deviceEntities);

    // Get the entity map from the profile
    const entityMap = profile.entityMap as Record<string, unknown>;
    const capabilities = profile.capabilities as Record<string, unknown>;

    // Match all entities
    const results: EntityMatchResult[] = [];
    const suggestedMappings: Partial<EntityMappings> = {
      discoveredAt: new Date().toISOString(),
      autoMatchedCount: 0,
      manuallyMappedCount: 0,
    };

    // Define optional entity keys - these are add-on sensors that not all devices have
    const optionalEntityKeys = new Set([
      'co2Entity',           // CO2 sensor add-on
      'pirEntity',           // PIR sensor (not on all models)
      'vocEntity',           // VOC sensor add-on
      'pm25Entity',          // PM2.5 sensor add-on
      'pressureEntity',      // Pressure sensor add-on
      'lightEntity',         // Some models don't have light sensor
    ]);

    // Process flat entity mappings (presenceEntity, temperatureEntity, etc.)
    for (const [key, template] of Object.entries(entityMap)) {
      if (typeof template === 'string') {
        const isOptional = optionalEntityKeys.has(key);
        const result = this.matchTemplate(key, template, deviceEntities, entitiesByDomain, isOptional);
        results.push(result);
        if (result.matchedEntityId) {
          (suggestedMappings as Record<string, unknown>)[key] = result.matchedEntityId;
        }
      }
    }

    // Process zone config entities (zoneConfigEntities, exclusionZoneConfigEntities, etc.)
    if (entityMap.zoneConfigEntities && typeof entityMap.zoneConfigEntities === 'object') {
      suggestedMappings.zoneConfigEntities = {};
      const zoneConfig = entityMap.zoneConfigEntities as Record<string, Record<string, string>>;
      for (const [zoneKey, zoneEntities] of Object.entries(zoneConfig)) {
        const zoneSet = this.matchZoneEntitySet(`zoneConfigEntities.${zoneKey}`, zoneEntities, deviceEntities, entitiesByDomain, results);
        if (zoneSet) {
          (suggestedMappings.zoneConfigEntities as Record<string, ZoneEntitySet>)[zoneKey] = zoneSet;
        }
      }
    }

    // Process exclusion zone entities
    if (entityMap.exclusionZoneConfigEntities && typeof entityMap.exclusionZoneConfigEntities === 'object') {
      suggestedMappings.exclusionZoneConfigEntities = {};
      const exclusionConfig = entityMap.exclusionZoneConfigEntities as Record<string, Record<string, string>>;
      for (const [zoneKey, zoneEntities] of Object.entries(exclusionConfig)) {
        const zoneSet = this.matchZoneEntitySet(`exclusionZoneConfigEntities.${zoneKey}`, zoneEntities, deviceEntities, entitiesByDomain, results);
        if (zoneSet) {
          (suggestedMappings.exclusionZoneConfigEntities as Record<string, ZoneEntitySet>)[zoneKey] = zoneSet;
        }
      }
    }

    // Process entry zone entities
    if (entityMap.entryZoneConfigEntities && typeof entityMap.entryZoneConfigEntities === 'object') {
      suggestedMappings.entryZoneConfigEntities = {};
      const entryConfig = entityMap.entryZoneConfigEntities as Record<string, Record<string, string>>;
      for (const [zoneKey, zoneEntities] of Object.entries(entryConfig)) {
        const zoneSet = this.matchZoneEntitySet(`entryZoneConfigEntities.${zoneKey}`, zoneEntities, deviceEntities, entitiesByDomain, results);
        if (zoneSet) {
          (suggestedMappings.entryZoneConfigEntities as Record<string, ZoneEntitySet>)[zoneKey] = zoneSet;
        }
      }
    }

    // Process polygon zone entities
    if (entityMap.polygonZoneEntities && typeof entityMap.polygonZoneEntities === 'object') {
      suggestedMappings.polygonZoneEntities = {};
      const polygonConfig = entityMap.polygonZoneEntities as Record<string, string>;
      for (const [zoneKey, template] of Object.entries(polygonConfig)) {
        const result = this.matchTemplate(`polygonZoneEntities.${zoneKey}`, template, deviceEntities, entitiesByDomain, true);
        results.push(result);
        if (result.matchedEntityId) {
          (suggestedMappings.polygonZoneEntities as Record<string, string>)[zoneKey] = result.matchedEntityId;
        }
      }
    }

    // Process polygon exclusion entities
    if (entityMap.polygonExclusionEntities && typeof entityMap.polygonExclusionEntities === 'object') {
      suggestedMappings.polygonExclusionEntities = {};
      const polygonConfig = entityMap.polygonExclusionEntities as Record<string, string>;
      for (const [zoneKey, template] of Object.entries(polygonConfig)) {
        const result = this.matchTemplate(`polygonExclusionEntities.${zoneKey}`, template, deviceEntities, entitiesByDomain, true);
        results.push(result);
        if (result.matchedEntityId) {
          (suggestedMappings.polygonExclusionEntities as Record<string, string>)[zoneKey] = result.matchedEntityId;
        }
      }
    }

    // Process polygon entry entities
    if (entityMap.polygonEntryEntities && typeof entityMap.polygonEntryEntities === 'object') {
      suggestedMappings.polygonEntryEntities = {};
      const polygonConfig = entityMap.polygonEntryEntities as Record<string, string>;
      for (const [zoneKey, template] of Object.entries(polygonConfig)) {
        const result = this.matchTemplate(`polygonEntryEntities.${zoneKey}`, template, deviceEntities, entitiesByDomain, true);
        results.push(result);
        if (result.matchedEntityId) {
          (suggestedMappings.polygonEntryEntities as Record<string, string>)[zoneKey] = result.matchedEntityId;
        }
      }
    }

    // Add tracking target entities if tracking is supported
    if (capabilities?.tracking) {
      suggestedMappings.trackingTargets = {};
      for (let i = 1; i <= 3; i++) {
        const targetSet = this.matchTrackingTargetEntities(`target${i}`, i, deviceEntities, entitiesByDomain, results);
        if (targetSet) {
          (suggestedMappings.trackingTargets as Record<string, TargetEntitySet>)[`target${i}`] = targetSet;
        }
      }
    }

    // Calculate statistics
    const matchedCount = results.filter((r) => r.matchedEntityId !== null).length;
    const unmatchedRequired = results.filter((r) => r.matchedEntityId === null && !r.isOptional).length;
    const optionalMissing = results.filter((r) => r.matchedEntityId === null && r.isOptional).length;

    suggestedMappings.autoMatchedCount = matchedCount;

    const discoveryResult: DiscoveryResult = {
      deviceId,
      profileId,
      allMatched: unmatchedRequired === 0,
      matchedCount,
      unmatchedCount: unmatchedRequired,
      optionalMissingCount: optionalMissing,
      results,
      suggestedMappings,
      deviceEntities,
    };

    logger.info(
      {
        deviceId,
        profileId,
        matchedCount,
        unmatchedCount: unmatchedRequired,
        optionalMissing,
        allMatched: discoveryResult.allMatched,
      },
      'Entity discovery complete'
    );

    return discoveryResult;
  }

  /**
   * Group entities by their domain (e.g., "binary_sensor", "sensor", "number").
   */
  private groupEntitiesByDomain(entities: EntityRegistryEntry[]): Map<string, EntityRegistryEntry[]> {
    const byDomain = new Map<string, EntityRegistryEntry[]>();

    for (const entity of entities) {
      const domain = entity.entity_id.split('.')[0];
      if (!byDomain.has(domain)) {
        byDomain.set(domain, []);
      }
      byDomain.get(domain)!.push(entity);
    }

    return byDomain;
  }

  /**
   * Extract the expected suffix from a template.
   * e.g., "binary_sensor.${name}_occupancy" -> "_occupancy"
   */
  private extractSuffix(template: string): { domain: string; suffix: string } | null {
    const match = template.match(/^([a-z_]+)\.\$\{name\}(.*)$/);
    if (!match) return null;
    return { domain: match[1], suffix: match[2] };
  }

  /**
   * Match a single template against available entities.
   */
  private matchTemplate(
    templateKey: string,
    template: string,
    allEntities: EntityRegistryEntry[],
    entitiesByDomain: Map<string, EntityRegistryEntry[]>,
    isOptional = false
  ): EntityMatchResult {
    const result: EntityMatchResult = {
      templateKey,
      templatePattern: template,
      matchedEntityId: null,
      matchConfidence: 'none',
      isOptional,
      candidates: [],
    };

    const parsed = this.extractSuffix(template);
    if (!parsed) {
      logger.warn({ templateKey, template }, 'Could not parse template pattern');
      return result;
    }

    const { domain, suffix } = parsed;
    const domainEntities = entitiesByDomain.get(domain) || [];

    // Strategy 1: Exact suffix match
    for (const entity of domainEntities) {
      if (entity.entity_id.endsWith(suffix)) {
        result.matchedEntityId = entity.entity_id;
        result.matchConfidence = 'exact';
        logger.debug({ templateKey, matched: entity.entity_id, confidence: 'exact' }, 'Entity matched');
        break;
      }
    }

    // Strategy 2: Match by entity name (display name from ESPHome)
    if (!result.matchedEntityId) {
      // Extract expected name from suffix (e.g., "_occupancy" -> "occupancy" or "Occupancy")
      const expectedName = suffix.replace(/^_/, '').replace(/_/g, ' ');
      for (const entity of domainEntities) {
        if (entity.name && entity.name.toLowerCase() === expectedName.toLowerCase()) {
          result.matchedEntityId = entity.entity_id;
          result.matchConfidence = 'name';
          logger.debug({ templateKey, matched: entity.entity_id, confidence: 'name' }, 'Entity matched by name');
          break;
        }
      }
    }

    // Strategy 3: Partial suffix match (entity ends with part of the suffix)
    if (!result.matchedEntityId && suffix.length > 3) {
      // Try matching just the last part of the suffix
      const suffixParts = suffix.split('_').filter(Boolean);
      const lastPart = suffixParts[suffixParts.length - 1];
      if (lastPart && lastPart.length > 2) {
        for (const entity of domainEntities) {
          if (entity.entity_id.endsWith(`_${lastPart}`)) {
            result.matchedEntityId = entity.entity_id;
            result.matchConfidence = 'suffix';
            logger.debug({ templateKey, matched: entity.entity_id, confidence: 'suffix' }, 'Entity matched by partial suffix');
            break;
          }
        }
      }
    }

    // Collect candidates for manual mapping (all entities in the same domain)
    result.candidates = domainEntities
      .map((e) => e.entity_id)
      .filter((id) => id !== result.matchedEntityId)
      .slice(0, 20); // Limit to 20 candidates

    return result;
  }

  /**
   * Match a set of zone coordinate entities.
   */
  private matchZoneEntitySet(
    keyPrefix: string,
    templates: Record<string, string>,
    allEntities: EntityRegistryEntry[],
    entitiesByDomain: Map<string, EntityRegistryEntry[]>,
    results: EntityMatchResult[]
  ): ZoneEntitySet | null {
    const zoneSet: Partial<ZoneEntitySet> = {};
    let hasAny = false;

    for (const [coordKey, template] of Object.entries(templates)) {
      if (typeof template !== 'string') continue;
      const result = this.matchTemplate(`${keyPrefix}.${coordKey}`, template, allEntities, entitiesByDomain);
      results.push(result);
      if (result.matchedEntityId) {
        (zoneSet as Record<string, string>)[coordKey] = result.matchedEntityId;
        hasAny = true;
      }
    }

    // Only return if we have the required coordinate entities
    if (hasAny && zoneSet.beginX && zoneSet.endX && zoneSet.beginY && zoneSet.endY) {
      return zoneSet as ZoneEntitySet;
    }

    return null;
  }

  /**
   * Match tracking target entities by index.
   */
  private matchTrackingTargetEntities(
    keyPrefix: string,
    targetNum: number,
    allEntities: EntityRegistryEntry[],
    entitiesByDomain: Map<string, EntityRegistryEntry[]>,
    results: EntityMatchResult[]
  ): TargetEntitySet | null {
    const targetSet: Partial<TargetEntitySet> = {};

    // Define expected patterns for tracking targets
    const patterns: Record<keyof TargetEntitySet, string> = {
      x: `sensor.\${name}_target_${targetNum}_x`,
      y: `sensor.\${name}_target_${targetNum}_y`,
      speed: `sensor.\${name}_target_${targetNum}_speed`,
      resolution: `sensor.\${name}_target_${targetNum}_resolution`,
      angle: `sensor.\${name}_target_${targetNum}_angle`,
      distance: `sensor.\${name}_target_${targetNum}_distance`,
      active: `binary_sensor.\${name}_target_${targetNum}_active`,
    };

    for (const [propKey, template] of Object.entries(patterns)) {
      const result = this.matchTemplate(`trackingTargets.${keyPrefix}.${propKey}`, template, allEntities, entitiesByDomain, true);
      results.push(result);
      if (result.matchedEntityId) {
        (targetSet as Record<string, string>)[propKey] = result.matchedEntityId;
      }
    }

    // At minimum we need x and y for a valid target
    if (targetSet.x && targetSet.y) {
      return targetSet as TargetEntitySet;
    }

    return null;
  }

  /**
   * Validate that a set of entity mappings are accessible in Home Assistant.
   */
  async validateMappings(
    mappings: Partial<EntityMappings>
  ): Promise<{ valid: boolean; errors: Array<{ key: string; entityId: string; error: string }> }> {
    const errors: Array<{ key: string; entityId: string; error: string }> = [];

    const checkEntity = async (key: string, entityId: string) => {
      try {
        const state = await this.readTransport.getState(entityId);
        if (!state) {
          errors.push({ key, entityId, error: 'Entity not found' });
        }
      } catch (err) {
        errors.push({ key, entityId, error: (err as Error).message });
      }
    };

    const tasks: Promise<void>[] = [];

    // Check flat entity mappings
    const flatKeys = [
      'presenceEntity', 'mmwaveEntity', 'pirEntity', 'temperatureEntity',
      'humidityEntity', 'illuminanceEntity', 'co2Entity', 'distanceEntity',
      'speedEntity', 'energyEntity', 'targetCountEntity', 'modeEntity',
      'maxDistanceEntity', 'installationAngleEntity', 'polygonZonesEnabledEntity',
      'trackingTargetCountEntity',
    ];

    for (const key of flatKeys) {
      const entityId = (mappings as Record<string, unknown>)[key];
      if (typeof entityId === 'string') {
        tasks.push(checkEntity(key, entityId));
      }
    }

    // Check zone entities
    const zoneGroups = ['zoneConfigEntities', 'exclusionZoneConfigEntities', 'entryZoneConfigEntities'];
    for (const groupKey of zoneGroups) {
      const group = (mappings as Record<string, unknown>)[groupKey];
      if (group && typeof group === 'object') {
        for (const [zoneKey, zoneSet] of Object.entries(group as Record<string, unknown>)) {
          if (zoneSet && typeof zoneSet === 'object') {
            for (const [coordKey, entityId] of Object.entries(zoneSet as Record<string, unknown>)) {
              if (typeof entityId === 'string') {
                tasks.push(checkEntity(`${groupKey}.${zoneKey}.${coordKey}`, entityId));
              }
            }
          }
        }
      }
    }

    // Check polygon zone entities
    const polygonGroups = ['polygonZoneEntities', 'polygonExclusionEntities', 'polygonEntryEntities'];
    for (const groupKey of polygonGroups) {
      const group = (mappings as Record<string, unknown>)[groupKey];
      if (group && typeof group === 'object') {
        for (const [zoneKey, entityId] of Object.entries(group as Record<string, unknown>)) {
          if (typeof entityId === 'string') {
            tasks.push(checkEntity(`${groupKey}.${zoneKey}`, entityId));
          }
        }
      }
    }

    await Promise.all(tasks);

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
