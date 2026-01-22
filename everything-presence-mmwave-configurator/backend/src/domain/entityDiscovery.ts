import type { IHaReadTransport } from '../ha/readTransport';
import type { EntityRegistryEntry } from '../ha/types';
import type { DeviceRegistryEntry } from '../ha/readTransport';
import type { DeviceProfileLoader } from './deviceProfiles';
import type { EntityMappings, ZoneEntitySet, TargetEntitySet } from './types';
import { deviceMappingStorage, DeviceMapping, parseFirmwareVersion } from '../config/deviceMappingStorage';
import { logger } from '../logger';
import { telemetry } from '../logger/telemetry';
import { normalizeMappingKeys } from './mappingUtils';

/**
 * Entity definition from profile.entities with template for discovery.
 */
interface EntityDefinitionWithTemplate {
  template: string;
  category: 'sensor' | 'setting' | 'zone' | 'tracking';
  required: boolean;
  subcategory?: string;
  group?: string;
  label?: string;
  controlType?: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  description?: string;
  options?: string[];
  zoneType?: string;
  zoneIndex?: number;
  coord?: string;
  targetIndex?: number;
  property?: string;
}

/**
 * Confidence level for entity matching.
 * 'conflict' means multiple candidates scored equally and requires user review.
 */
export type MatchConfidence = 'exact' | 'suffix' | 'name' | 'conflict' | 'none';

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
  /** Auto-discovered ESPHome services (if any), e.g. getBuildFlags */
  serviceMappings?: Record<string, string>;
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
   * Prefers profile.entities metadata when available, falls back to legacy entityMap.
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

    // Attempt ESPHome service discovery in parallel with entity discovery.
    // This mirrors the entity auto-match flow: try to find services now,
    // but don't persist until the user saves.
    let serviceMappings: Record<string, string> | undefined;
    try {
      const existingMapping = deviceMappingStorage.getMapping(deviceId);
      let esphomeNodeName = existingMapping?.esphomeNodeName;
      if (!esphomeNodeName) {
        try {
          const devices = await this.readTransport.listDevices();
          const device = devices.find(d => d.id === deviceId);
          if (device) {
            esphomeNodeName = this.extractEsphomeNodeName(device);
          }
        } catch (err) {
          logger.warn({ err, deviceId }, 'Failed to fetch device info for service discovery, continuing without it');
        }
      }

      const discoveredBuildFlags = await this.discoverServiceBySuffix(
        deviceId,
        esphomeNodeName,
        '_get_build_flags',
        'getBuildFlags'
      );
      const discoveredUpdateManifest = await this.discoverServiceBySuffix(
        deviceId,
        esphomeNodeName,
        '_set_update_manifest',
        'setUpdateManifest'
      );

      if (discoveredBuildFlags || discoveredUpdateManifest) {
        serviceMappings = {
          ...(discoveredBuildFlags ? { getBuildFlags: discoveredBuildFlags } : {}),
          ...(discoveredUpdateManifest ? { setUpdateManifest: discoveredUpdateManifest } : {}),
        };
      }
    } catch (err) {
      logger.warn({ err, deviceId }, 'Service discovery failed during entity discovery');
    }

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
        serviceMappings,
      };
    }

    // Group entities by domain for faster lookup
    const entitiesByDomain = this.groupEntitiesByDomain(deviceEntities);

    // Check for new entities metadata format
    const profileEntities = (profile as unknown as Record<string, unknown>).entities as Record<string, EntityDefinitionWithTemplate> | undefined;
    const entityMap = (profile as unknown as Record<string, unknown>).entityMap as Record<string, unknown>;
    const capabilities = profile.capabilities as Record<string, unknown>;

    // Match all entities
    const results: EntityMatchResult[] = [];
    const suggestedMappings: Partial<EntityMappings> = {
      discoveredAt: new Date().toISOString(),
      autoMatchedCount: 0,
      manuallyMappedCount: 0,
    };

    // Use profile.entities metadata when available (preferred)
    if (profileEntities) {
      logger.info({ deviceId, profileId }, 'Using profile.entities metadata for discovery');
      this.discoverUsingEntitiesMetadata(
        profileEntities,
        deviceEntities,
        entitiesByDomain,
        results,
        suggestedMappings
      );
    } else {
      // Fallback to legacy entityMap
      logger.info({ deviceId, profileId }, 'Using legacy entityMap for discovery');
      this.discoverUsingLegacyEntityMap(
        entityMap,
        capabilities,
        deviceEntities,
        entitiesByDomain,
        results,
        suggestedMappings
      );
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
      serviceMappings,
    };

    if (unmatchedRequired > 0) {
      logger.info(
        {
          deviceId,
          profileId,
          unmatchedRequired,
          unmatchedKeys: results
            .filter((r) => r.matchedEntityId === null && !r.isOptional)
            .map((r) => r.templateKey)
            .slice(0, 10),
        },
        'Entity discovery finished with unmatched required entities'
      );
    }

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
   * Determine if an entity_id looks like a zone/entry/exclusion/mask entity.
   */
  private isZoneLikeEntity(entityId: string): boolean {
    return /_(zone|entry_zone|occupancy_mask|exclusion|entry)_/i.test(entityId);
  }

  /**
   * Determine if a template represents a base presence/mmwave/pir style entity (i.e., not a zone/entry/polygon variant).
   */
  private isBasePresenceTemplate(templateKey: string, template: string): boolean {
    const keyLower = templateKey.toLowerCase();
    const tplLower = template.toLowerCase();
    const looksLikePresence = keyLower.includes('presence') || keyLower.includes('mmwave') || keyLower.includes('pir') || tplLower.includes('_occupancy');
    const looksLikeZone = tplLower.includes('_zone_') || tplLower.includes('_entry_zone_') || tplLower.includes('_polygon_') || tplLower.includes('_occupancy_mask_');
    return looksLikePresence && !looksLikeZone;
  }

  /**
   * Match a single template against available entities with conflict detection and ranking.
   */
  private matchTemplate(
    templateKey: string,
    template: string,
    allEntities: EntityRegistryEntry[],
    entitiesByDomain: Map<string, EntityRegistryEntry[]>,
    isOptional = false,
    options?: { zoneType?: 'regular' | 'entry' | 'exclusion' }
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

    const basePresenceTemplate = this.isBasePresenceTemplate(templateKey, template);
    const expectedName = suffix.replace(/^_/, '').replace(/_/g, ' ');
    const suffixParts = suffix.split('_').filter(Boolean);
    const lastPart = suffixParts[suffixParts.length - 1] || '';

    const isDisabled = (e: EntityRegistryEntry) => !!(e as any)?.disabled_by;

    const isRegularZoneTemplate = options?.zoneType === 'regular';
    const isEntryZoneTemplate = options?.zoneType === 'entry';
    const isExclusionZoneTemplate = options?.zoneType === 'exclusion';

    const computeScore = (entity: EntityRegistryEntry): { score: number; confidence: MatchConfidence } => {
      const entityIdLower = entity.entity_id.toLowerCase();

      // Filter by zone type to avoid cross-matching entry/regular/exclusion
      // EPL uses occupancy_mask_ for exclusion zones, EPP uses exclusion_zone_
      if (isRegularZoneTemplate && (entityIdLower.includes('entry_zone_') || entityIdLower.includes('occupancy_mask_') || entityIdLower.includes('exclusion_zone_'))) {
        return { score: -1, confidence: 'none' };
      }
      if (isEntryZoneTemplate && !entityIdLower.includes('entry_zone_')) {
        return { score: -1, confidence: 'none' };
      }
      if (isExclusionZoneTemplate && !(entityIdLower.includes('occupancy_mask_') || entityIdLower.includes('exclusion_zone_'))) {
        return { score: -1, confidence: 'none' };
      }

      // Exclude zone-like entities for base presence-style templates
      if (basePresenceTemplate && this.isZoneLikeEntity(entity.entity_id)) {
        return { score: -1, confidence: 'none' };
      }

      if (entity.entity_id.endsWith(suffix)) {
        return { score: 3, confidence: 'exact' };
      }
      if (entity.name && expectedName && entity.name.toLowerCase() === expectedName.toLowerCase()) {
        return { score: 2, confidence: 'name' };
      }
      if (lastPart && lastPart.length > 2 && entity.entity_id.endsWith(`_${lastPart}`)) {
        return { score: 1, confidence: 'suffix' };
      }
      return { score: 0, confidence: 'none' };
    };

    // Auto-match prefers enabled entities, but allows disabled exact matches when they are the best fit.
    const scoredForAuto = domainEntities.map((entity) => {
      const { score, confidence } = computeScore(entity);
      return {
        entity,
        score,
        confidence,
        disabled: isDisabled(entity),
      };
    });

    const positiveScores = scoredForAuto.filter((s) => s.score > 0);
    let topScoreForLog: number | null = null;
    if (positiveScores.length > 0) {
      const bestScore = Math.max(...positiveScores.map((s) => s.score));
      topScoreForLog = bestScore;
      const topMatches = positiveScores.filter((s) => s.score === bestScore);
      const enabledTop = topMatches.filter((s) => !s.disabled);
      const candidates = enabledTop.length > 0 ? enabledTop : topMatches;

      if (candidates.length === 1) {
        const best = candidates[0];
        result.matchedEntityId = best.entity.entity_id;
        result.matchConfidence = best.confidence;
        logger.debug(
          { templateKey, matched: best.entity.entity_id, confidence: best.confidence },
          'Entity matched'
        );
      } else {
        // Conflict: multiple equally good candidates, require user review
        result.matchConfidence = 'conflict';
        const conflictCandidates = candidates.map((m) => m.entity.entity_id);
        logger.debug(
          { templateKey, candidates: conflictCandidates },
          'Multiple candidates matched equally; marking for review'
        );
        telemetry.conflict(templateKey, conflictCandidates);
      }
    }

    // Collect ranked candidates for manual mapping (all domain entities, even if disabled)
    const scoredCandidates = domainEntities.map((entity) => {
      const { score } = computeScore(entity);
      const disabled = isDisabled(entity);
      const zonePenalty = this.isZoneLikeEntity(entity.entity_id);
      return { id: entity.entity_id, score, disabled, zonePenalty };
    });

    scoredCandidates.sort((a, b) => {
      // Higher score first
      if (b.score !== a.score) return b.score - a.score;
      // Prefer non-zone over zone-like
      if (a.zonePenalty !== b.zonePenalty) return Number(a.zonePenalty) - Number(b.zonePenalty);
      // Prefer enabled over disabled
      if (a.disabled !== b.disabled) return Number(a.disabled) - Number(b.disabled);
      // Stable lexical fallback
      return a.id.localeCompare(b.id);
    });

    const candidateSummary = scoredCandidates.slice(0, 5).map((c) => ({
      id: c.id,
      score: c.score,
      disabled: c.disabled,
      zoneLike: c.zonePenalty,
    }));
    logger.info({ templateKey, domain, candidates: candidateSummary }, 'Entity match candidate ranking');

    result.candidates = scoredCandidates
      .map((c) => c.id)
      .filter((id) => id !== result.matchedEntityId);

    if (result.matchConfidence === 'conflict') {
      logger.info(
        {
          templateKey,
          domain,
          topScore: topScoreForLog ?? 0,
          conflictCandidates: scoredCandidates.slice(0, 5).map((c) => c.id),
        },
        'Entity match conflict detected'
      );
    }
    if (!result.matchedEntityId && scoredCandidates.length > 0) {
      logger.info(
        {
          templateKey,
          domain,
          topCandidates: scoredCandidates.slice(0, 3),
        },
        'No match selected; showing top candidates for review'
      );
    }

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

    const zoneTypeHint =
      keyPrefix.includes('zoneConfigEntities') ? 'regular'
        : keyPrefix.includes('entryZoneConfigEntities') ? 'entry'
          : keyPrefix.includes('exclusionZoneConfigEntities') ? 'exclusion'
            : undefined;

    for (const [coordKey, template] of Object.entries(templates)) {
      if (typeof template !== 'string') continue;
      const result = this.matchTemplate(
        `${keyPrefix}.${coordKey}`,
        template,
        allEntities,
        entitiesByDomain,
        false,
        { zoneType: zoneTypeHint as 'regular' | 'entry' | 'exclusion' | undefined }
      );
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
   * Discover entities using profile.entities metadata (new format).
   * Each entity definition has a template, category, and required flag.
   */
  private discoverUsingEntitiesMetadata(
    profileEntities: Record<string, EntityDefinitionWithTemplate>,
    deviceEntities: EntityRegistryEntry[],
    entitiesByDomain: Map<string, EntityRegistryEntry[]>,
    results: EntityMatchResult[],
    suggestedMappings: Partial<EntityMappings>
  ): void {
    // Initialize nested structures for zone/tracking entities
    suggestedMappings.zoneConfigEntities = {};
    suggestedMappings.exclusionZoneConfigEntities = {};
    suggestedMappings.entryZoneConfigEntities = {};
    suggestedMappings.polygonZoneEntities = {};
    suggestedMappings.polygonExclusionEntities = {};
    suggestedMappings.polygonEntryEntities = {};
    suggestedMappings.trackingTargets = {};
    suggestedMappings.settingsEntities = {};

    for (const [entityKey, def] of Object.entries(profileEntities)) {
      if (!def.template) continue;

      const isOptional = !def.required;
      const result = this.matchTemplate(
        entityKey,
        def.template,
        deviceEntities,
        entitiesByDomain,
        isOptional,
        { zoneType: (def.zoneType as 'regular' | 'entry' | 'exclusion' | undefined) }
      );
      results.push(result);

      if (result.matchedEntityId) {
        // Place entity in correct location based on category and metadata
        this.placeMatchedEntity(entityKey, result.matchedEntityId, def, suggestedMappings);
      }
    }
  }

  /**
   * Place a matched entity into the correct location in suggestedMappings.
   * Uses entity definition metadata (category, zoneType, zoneIndex, etc.)
   */
  private placeMatchedEntity(
    entityKey: string,
    entityId: string,
    def: EntityDefinitionWithTemplate,
    suggestedMappings: Partial<EntityMappings>
  ): void {
    const category = def.category;

    if (category === 'sensor') {
      // Core sensors go at the root with Entity suffix for legacy compatibility
      const legacyKey = entityKey.endsWith('Entity') ? entityKey : `${entityKey}Entity`;
      (suggestedMappings as Record<string, unknown>)[legacyKey] = entityId;
    } else if (category === 'setting') {
      // Settings go into settingsEntities
      if (suggestedMappings.settingsEntities) {
        suggestedMappings.settingsEntities[entityKey] = entityId;
      }
    } else if (category === 'zone') {
      // Zone entities - use zoneType and zoneIndex to determine placement
      this.placeZoneEntity(entityKey, entityId, def, suggestedMappings);
    } else if (category === 'tracking') {
      // Tracking targets - use targetIndex and property
      this.placeTrackingEntity(entityKey, entityId, def, suggestedMappings);
    }
  }

  /**
   * Place a zone entity into the correct nested structure.
   */
  private placeZoneEntity(
    entityKey: string,
    entityId: string,
    def: EntityDefinitionWithTemplate,
    suggestedMappings: Partial<EntityMappings>
  ): void {
    const zoneType = def.zoneType;
    const zoneIndex = def.zoneIndex ?? 1;
    const coord = def.coord;

    // Cast to Record for dynamic key access
    const zoneConfig = suggestedMappings.zoneConfigEntities as Record<string, ZoneEntitySet | undefined>;
    const exclusionConfig = suggestedMappings.exclusionZoneConfigEntities as Record<string, ZoneEntitySet | undefined>;
    const entryConfig = suggestedMappings.entryZoneConfigEntities as Record<string, ZoneEntitySet | undefined>;
    const polygonZones = suggestedMappings.polygonZoneEntities as Record<string, string | undefined>;
    const polygonExclusions = suggestedMappings.polygonExclusionEntities as Record<string, string | undefined>;
    const polygonEntries = suggestedMappings.polygonEntryEntities as Record<string, string | undefined>;

    if (zoneType === 'regular' && coord) {
      const zoneKey = `zone${zoneIndex}`;
      if (!zoneConfig[zoneKey]) {
        zoneConfig[zoneKey] = {} as ZoneEntitySet;
      }
      (zoneConfig[zoneKey] as unknown as Record<string, string>)[coord] = entityId;
    } else if (zoneType === 'exclusion' && coord) {
      const zoneKey = `exclusion${zoneIndex}`;
      if (!exclusionConfig[zoneKey]) {
        exclusionConfig[zoneKey] = {} as ZoneEntitySet;
      }
      (exclusionConfig[zoneKey] as unknown as Record<string, string>)[coord] = entityId;
    } else if (zoneType === 'entry' && coord) {
      const zoneKey = `entry${zoneIndex}`;
      if (!entryConfig[zoneKey]) {
        entryConfig[zoneKey] = {} as ZoneEntitySet;
      }
      (entryConfig[zoneKey] as unknown as Record<string, string>)[coord] = entityId;
    } else if (zoneType === 'polygon') {
      polygonZones[`zone${zoneIndex}`] = entityId;
    } else if (zoneType === 'polygonExclusion') {
      polygonExclusions[`exclusion${zoneIndex}`] = entityId;
    } else if (zoneType === 'polygonEntry') {
      polygonEntries[`entry${zoneIndex}`] = entityId;
    }
  }

  /**
   * Place a tracking entity into the correct nested structure.
   */
  private placeTrackingEntity(
    entityKey: string,
    entityId: string,
    def: EntityDefinitionWithTemplate,
    suggestedMappings: Partial<EntityMappings>
  ): void {
    const targetIndex = def.targetIndex ?? 1;
    const property = def.property;

    if (!property) return;

    // Cast to Record for dynamic key access
    const trackingTargets = suggestedMappings.trackingTargets as Record<string, TargetEntitySet | undefined>;
    const targetKey = `target${targetIndex}`;

    if (!trackingTargets[targetKey]) {
      trackingTargets[targetKey] = {} as TargetEntitySet;
    }
    (trackingTargets[targetKey] as unknown as Record<string, string>)[property] = entityId;
  }

  /**
   * Discover entities using legacy entityMap format.
   * This is the fallback for profiles without the new entities metadata.
   */
  private discoverUsingLegacyEntityMap(
    entityMap: Record<string, unknown>,
    capabilities: Record<string, unknown> | undefined,
    deviceEntities: EntityRegistryEntry[],
    entitiesByDomain: Map<string, EntityRegistryEntry[]>,
    results: EntityMatchResult[],
    suggestedMappings: Partial<EntityMappings>
  ): void {
    // Define optional entity keys - these are add-on sensors that not all devices have
    const optionalEntityKeys = new Set([
      'co2Entity', 'pirEntity', 'vocEntity', 'pm25Entity', 'pressureEntity', 'lightEntity',
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

    // Process zone config entities
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

    // Process settings entities
    if (entityMap.settingsEntities && typeof entityMap.settingsEntities === 'object') {
      suggestedMappings.settingsEntities = {};
      const settingsConfig = entityMap.settingsEntities as Record<string, string>;
      for (const [settingKey, template] of Object.entries(settingsConfig)) {
        if (typeof template === 'string') {
          const result = this.matchTemplate(`settingsEntities.${settingKey}`, template, deviceEntities, entitiesByDomain, true);
          results.push(result);
          if (result.matchedEntityId) {
            (suggestedMappings.settingsEntities as Record<string, string>)[settingKey] = result.matchedEntityId;
          }
        }
      }
    }
  }

  /**
   * Validate that a set of entity mappings are accessible in Home Assistant.
   */
  async validateMappings(
    mappings: Partial<EntityMappings>,
    deviceId?: string
  ): Promise<{ valid: boolean; errors: Array<{ key: string; entityId: string; error: string }> }> {
    const errors: Array<{ key: string; entityId: string; error: string }> = [];

    let registryById: Map<string, EntityRegistryEntry> = new Map();
    try {
      const registry = await this.readTransport.listEntityRegistry();
      registryById = new Map(registry.map((e) => [e.entity_id, e]));
    } catch (err) {
      logger.warn({ err }, 'Failed to fetch entity registry for validation');
    }

    const checkEntity = async (key: string, entityId: string) => {
      const registryEntry = registryById.get(entityId);

      if (!registryEntry) {
        errors.push({ key, entityId, error: 'Entity not found in registry' });
        return;
      }

      if (deviceId && registryEntry.device_id && registryEntry.device_id !== deviceId) {
        errors.push({ key, entityId, error: 'Entity belongs to a different device' });
        return;
      }

      if ((registryEntry as any).disabled_by) {
        // Allow disabled entities so mappings can be saved before enabling in HA.
        return;
      }

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
      'trackingTargetCountEntity', 'firmwareUpdateEntity', 'assumedPresentEntity', 'assumedPresentRemainingEntity',
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

    if (errors.length > 0) {
      telemetry.validationFail(deviceId, errors);
    } else {
      telemetry.validationSuccess(deviceId);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Discover entities and save to device mapping storage.
   * This is the primary method for wiring discovery to the device mapping store.
   */
  async discoverAndSave(
    deviceId: string,
    profileId: string,
    deviceName: string
  ): Promise<{ mapping: DeviceMapping; discovery: DiscoveryResult }> {
    logger.info({ deviceId, profileId, deviceName }, 'Running discoverAndSave');

    // Run discovery
    const discovery = await this.discoverEntities(deviceId, profileId);

    // Get profile schema version for resync detection
    const profile = this.profileLoader.getProfileById(profileId);
    const profileSchemaVersion = profile?.schemaVersion;

    // Convert suggestedMappings (nested EntityMappings) to flat format
    const flatMappings = normalizeMappingKeys(this.convertToFlatMappings(discovery.suggestedMappings));

    const entityOriginalObjectIds = this.mapOriginalObjectIds(
      flatMappings,
      discovery.deviceEntities
    );
    const entityUniqueIds = this.mapUniqueIds(
      flatMappings,
      discovery.deviceEntities
    );

    // Fetch unit_of_measurement for tracking entities (x/y coordinates)
    const entityUnits = await this.fetchEntityUnits(flatMappings);

    // Fetch device info to get firmware version
    let rawSwVersion: string | undefined;
    let firmwareVersion: string | undefined;
    let esphomeVersion: string | undefined;
    let esphomeNodeName: string | undefined;
    try {
      const devices = await this.readTransport.listDevices();
      const device = devices.find(d => d.id === deviceId);
      if (device?.sw_version) {
        rawSwVersion = device.sw_version;
        const parsed = parseFirmwareVersion(device.sw_version);
        firmwareVersion = parsed.firmwareVersion;
        esphomeVersion = parsed.esphomeVersion;
      logger.debug({ deviceId, rawSwVersion, firmwareVersion, esphomeVersion }, 'Parsed firmware version');
      }
      if (device) {
        esphomeNodeName = this.extractEsphomeNodeName(device);
      }
    } catch (err) {
      logger.warn({ err, deviceId }, 'Failed to fetch device firmware version, continuing without it');
    }

    // Auto-discover ESPHome service mappings (e.g., getBuildFlags, setUpdateManifest)
    let serviceMappings: Record<string, string> | undefined;
    const discoveredBuildFlags = await this.discoverServiceBySuffix(
      deviceId,
      esphomeNodeName,
      '_get_build_flags',
      'getBuildFlags'
    );
    const discoveredUpdateManifest = await this.discoverServiceBySuffix(
      deviceId,
      esphomeNodeName,
      '_set_update_manifest',
      'setUpdateManifest'
    );

    if (discoveredBuildFlags || discoveredUpdateManifest) {
      serviceMappings = {
        ...(discoveredBuildFlags ? { getBuildFlags: discoveredBuildFlags } : {}),
        ...(discoveredUpdateManifest ? { setUpdateManifest: discoveredUpdateManifest } : {}),
      };
    }

    // Build DeviceMapping object
    const mapping: DeviceMapping = {
      deviceId,
      profileId,
      deviceName,
      esphomeNodeName,
      discoveredAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      confirmedByUser: false, // Not yet confirmed by user
      autoMatchedCount: discovery.matchedCount,
      manuallyMappedCount: 0,
      mappings: flatMappings,
      unmappedEntities: discovery.results
        .filter(r => r.matchedEntityId === null && !r.isOptional)
        .map(r => r.templateKey),
      entityOriginalObjectIds: Object.keys(entityOriginalObjectIds).length > 0 ? entityOriginalObjectIds : undefined,
      entityUniqueIds: Object.keys(entityUniqueIds).length > 0 ? entityUniqueIds : undefined,
      entityUnits,
      firmwareVersion,
      esphomeVersion,
      rawSwVersion,
      profileSchemaVersion,
      serviceMappings,
    };

    // Save to device storage
    await deviceMappingStorage.saveMapping(mapping);
    logger.info(
      {
        deviceId,
        profileId,
        autoMatchedCount: mapping.autoMatchedCount,
        manualCount: mapping.manuallyMappedCount,
        unmatched: mapping.unmappedEntities.slice(0, 5),
      },
      'Device mapping saved after discovery'
    );

    logger.info(
      { deviceId, mappingCount: Object.keys(flatMappings).length, matchedCount: discovery.matchedCount, entityUnits },
      'Discovery complete and saved to device storage'
    );

    return { mapping, discovery };
  }

  /**
   * Fetch unit_of_measurement from Home Assistant for all mapped entities.
   * This captures units for any entity that has one (sensors, number inputs, etc.)
   * to support imperial/metric display throughout the UI.
   */
  private async fetchEntityUnits(flatMappings: Record<string, string>): Promise<Record<string, string>> {
    const entityUnits: Record<string, string> = {};

    // Build list of all unique entity IDs to fetch
    const entityIdsToFetch: Array<{ key: string; entityId: string }> = [];
    const seenEntityIds = new Set<string>();

    for (const [key, entityId] of Object.entries(flatMappings)) {
      if (entityId && !seenEntityIds.has(entityId)) {
        entityIdsToFetch.push({ key, entityId });
        seenEntityIds.add(entityId);
      }
    }

    if (entityIdsToFetch.length === 0) {
      return entityUnits;
    }

    try {
      // Batch fetch all entity states
      const states = await this.readTransport.getStates(entityIdsToFetch.map(e => e.entityId));

      for (const { key, entityId } of entityIdsToFetch) {
        const state = states.get(entityId);
        if (state?.attributes?.unit_of_measurement) {
          const unit = state.attributes.unit_of_measurement as string;
          entityUnits[key] = unit;
          logger.debug({ key, entityId, unit }, 'Captured entity unit of measurement');
        }
      }

      logger.info({ count: Object.keys(entityUnits).length, total: entityIdsToFetch.length }, 'Fetched entity units');
    } catch (err) {
      logger.warn({ err }, 'Failed to fetch entity units - proceeding without unit metadata');
    }

    return entityUnits;
  }

  private mapOriginalObjectIds(
    flatMappings: Record<string, string>,
    deviceEntities: EntityRegistryEntry[]
  ): Record<string, string> {
    const originalObjectIds: Record<string, string> = {};
    const registryById = new Map(deviceEntities.map((entity) => [entity.entity_id, entity]));

    for (const entityId of Object.values(flatMappings)) {
      if (!entityId) continue;
      const entry = registryById.get(entityId);
      const originalObjectId = entry?.original_object_id;
      if (originalObjectId) {
        originalObjectIds[entityId] = originalObjectId;
      }
    }

    return originalObjectIds;
  }

  private mapUniqueIds(
    flatMappings: Record<string, string>,
    deviceEntities: EntityRegistryEntry[]
  ): Record<string, string> {
    const uniqueIds: Record<string, string> = {};
    const registryById = new Map(deviceEntities.map((entity) => [entity.entity_id, entity]));

    for (const entityId of Object.values(flatMappings)) {
      if (!entityId) continue;
      const entry = registryById.get(entityId);
      const uniqueId = entry?.unique_id;
      if (uniqueId) {
        uniqueIds[entityId] = uniqueId;
      }
    }

    return uniqueIds;
  }

  private extractEsphomeNodeName(device: DeviceRegistryEntry): string | undefined {
    for (const [domain, identifier] of device.identifiers ?? []) {
      if (typeof domain === 'string' && typeof identifier === 'string' && domain.toLowerCase() === 'esphome') {
        return identifier;
      }
    }
    return this.slugifyDeviceName(device.name);
  }

  private slugifyDeviceName(name: string | null | undefined): string | undefined {
    if (!name) return undefined;
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return slug || undefined;
  }

  /**
   * Convert nested EntityMappings to flat Record<string, string> format.
   * This is the same logic used in migration but exposed for discovery.
   */
  private convertToFlatMappings(em: Partial<EntityMappings>): Record<string, string> {
    const mappings: Record<string, string> = {};

    if (!em) return mappings;

    // Core entities - strip 'Entity' suffix for flat key
    if (em.presenceEntity) mappings['presence'] = em.presenceEntity;
    if (em.mmwaveEntity) mappings['mmwave'] = em.mmwaveEntity;
    if (em.pirEntity) mappings['pir'] = em.pirEntity;
    if (em.temperatureEntity) mappings['temperature'] = em.temperatureEntity;
    if (em.humidityEntity) mappings['humidity'] = em.humidityEntity;
    if (em.illuminanceEntity) mappings['illuminance'] = em.illuminanceEntity;
    if (em.co2Entity) mappings['co2'] = em.co2Entity;

    // EP1-specific entities
    if (em.distanceEntity) mappings['distance'] = em.distanceEntity;
    if (em.speedEntity) mappings['speed'] = em.speedEntity;
    if (em.energyEntity) mappings['energy'] = em.energyEntity;
    if (em.targetCountEntity) mappings['targetCount'] = em.targetCountEntity;
    if (em.modeEntity) mappings['mode'] = em.modeEntity;

    // Configuration entities
    if (em.maxDistanceEntity) mappings['maxDistance'] = em.maxDistanceEntity;
    if (em.installationAngleEntity) mappings['installationAngle'] = em.installationAngleEntity;
    if (em.polygonZonesEnabledEntity) mappings['polygonZonesEnabled'] = em.polygonZonesEnabledEntity;
    if (em.trackingTargetCountEntity) mappings['trackingTargetCount'] = em.trackingTargetCountEntity;
    if (em.firmwareUpdateEntity) mappings['firmwareUpdate'] = em.firmwareUpdateEntity;

    // Entry/Exit feature entities
    if (em.assumedPresentEntity) mappings['assumedPresent'] = em.assumedPresentEntity;
    if (em.assumedPresentRemainingEntity) mappings['assumedPresentRemaining'] = em.assumedPresentRemainingEntity;

    // Zone config entities (rectangular)
    this.flattenZoneEntitiesToFlat(mappings, em.zoneConfigEntities, 'zone');
    this.flattenZoneEntitiesToFlat(mappings, em.exclusionZoneConfigEntities, 'exclusion');
    this.flattenZoneEntitiesToFlat(mappings, em.entryZoneConfigEntities, 'entry');

    // Polygon zone entities
    this.flattenPolygonEntitiesToFlat(mappings, em.polygonZoneEntities, 'polygonZone');
    this.flattenPolygonEntitiesToFlat(mappings, em.polygonExclusionEntities, 'polygonExclusion');
    this.flattenPolygonEntitiesToFlat(mappings, em.polygonEntryEntities, 'polygonEntry');

    // Tracking targets
    this.flattenTrackingTargetsToFlat(mappings, em.trackingTargets);

    // Settings entities (already flat in EntityMappings)
    if (em.settingsEntities) {
      for (const [key, value] of Object.entries(em.settingsEntities)) {
        if (typeof value === 'string') {
          mappings[key] = value;
        }
      }
    }

    return mappings;
  }

  /**
   * Flatten zone coordinate entities into flat mappings.
   */
  private flattenZoneEntitiesToFlat(
    mappings: Record<string, string>,
    zones: Record<string, ZoneEntitySet | undefined> | undefined,
    prefix: 'zone' | 'exclusion' | 'entry'
  ): void {
    if (!zones) return;

    const keyToIndex: Record<string, number> = {
      zone1: 1, zone2: 2, zone3: 3, zone4: 4,
      exclusion1: 1, exclusion2: 2,
      entry1: 1, entry2: 2,
    };

    for (const [zoneKey, zoneSet] of Object.entries(zones)) {
      if (!zoneSet) continue;

      const index = keyToIndex[zoneKey] ?? (parseInt(zoneKey.replace(/\D/g, ''), 10) || 1);

      if (zoneSet.beginX) mappings[`${prefix}${index}BeginX`] = zoneSet.beginX;
      if (zoneSet.endX) mappings[`${prefix}${index}EndX`] = zoneSet.endX;
      if (zoneSet.beginY) mappings[`${prefix}${index}BeginY`] = zoneSet.beginY;
      if (zoneSet.endY) mappings[`${prefix}${index}EndY`] = zoneSet.endY;
      if (zoneSet.offDelay) mappings[`${prefix}${index}OffDelay`] = zoneSet.offDelay;
    }
  }

  /**
   * Flatten polygon zone entities into flat mappings.
   */
  private flattenPolygonEntitiesToFlat(
    mappings: Record<string, string>,
    polygons: Record<string, string | undefined> | undefined,
    prefix: 'polygonZone' | 'polygonExclusion' | 'polygonEntry'
  ): void {
    if (!polygons) return;

    const keyToIndex: Record<string, number> = {
      zone1: 1, zone2: 2, zone3: 3, zone4: 4,
      exclusion1: 1, exclusion2: 2,
      entry1: 1, entry2: 2,
    };

    for (const [key, entityId] of Object.entries(polygons)) {
      if (!entityId) continue;

      const index = keyToIndex[key] ?? (parseInt(key.replace(/\D/g, ''), 10) || 1);
      mappings[`${prefix}${index}`] = entityId;
    }
  }

  /**
   * Flatten tracking target entities into flat mappings.
   */
  private flattenTrackingTargetsToFlat(
    mappings: Record<string, string>,
    targets: Record<string, TargetEntitySet | undefined> | undefined
  ): void {
    if (!targets) return;

    for (const [targetKey, targetSet] of Object.entries(targets)) {
      if (!targetSet) continue;

      const index = parseInt(targetKey.replace(/\D/g, ''), 10) || 1;

      if (targetSet.x) mappings[`target${index}X`] = targetSet.x;
      if (targetSet.y) mappings[`target${index}Y`] = targetSet.y;
      if (targetSet.speed) mappings[`target${index}Speed`] = targetSet.speed;
      if (targetSet.distance) mappings[`target${index}Distance`] = targetSet.distance;
      if (targetSet.angle) mappings[`target${index}Angle`] = targetSet.angle;
      if (targetSet.resolution) mappings[`target${index}Resolution`] = targetSet.resolution;
      if (targetSet.active) mappings[`target${index}Active`] = targetSet.active;
    }
  }

  /**
   * Discover an ESPHome service for a device by suffix.
   * Uses two methods:
   * 1. Query getServicesForTarget for device-specific services
   * 2. Construct expected service name from esphomeNodeName and verify it exists
   */
  private async discoverServiceBySuffix(
    deviceId: string,
    esphomeNodeName: string | undefined,
    suffix: string,
    logLabel: string
  ): Promise<string | null> {
    let discoveredService: string | undefined;

    // Method 1: Try getServicesForTarget (works for some devices)
    try {
      const services = await this.readTransport.getServicesForTarget({ device_id: [deviceId] });
      logger.info(
        { deviceId, servicesCount: services.length, services: services.slice(0, 10) },
        'Service discovery Method 1: getServicesForTarget result'
      );
      discoveredService = services.find((s) => s.endsWith(suffix));
      if (discoveredService) {
        logger.info(
          { deviceId, service: discoveredService, logLabel },
          'Found service via getServicesForTarget'
        );
        return discoveredService;
      } else {
        logger.info(
          { deviceId, logLabel },
          'Method 1: No matching service found in getServicesForTarget result'
        );
      }
    } catch (err) {
      logger.warn({ err, deviceId }, 'getServicesForTarget failed (non-fatal)');
    }

    // Method 2: If Method 1 failed and we have esphomeNodeName, construct expected name and verify it exists
    if (esphomeNodeName) {
      try {
        const expectedService = `esphome.${esphomeNodeName}${suffix}`;
        logger.info(
          { deviceId, esphomeNodeName, expectedService, logLabel },
          'Service discovery Method 2: trying esphomeNodeName construction'
        );
        const allEsphomeServices = await this.readTransport.getServicesByDomain('esphome');
        logger.info(
          {
            deviceId,
            totalServices: allEsphomeServices.length,
            matchingServices: allEsphomeServices.filter((s) => s.endsWith(suffix)),
            logLabel,
          },
          'Service discovery Method 2: matching ESPHome services'
        );
        if (allEsphomeServices.includes(expectedService)) {
          logger.info(
            { deviceId, service: expectedService, logLabel },
            'Found service via esphomeNodeName construction'
          );
          return expectedService;
        } else {
          logger.info(
            {
              deviceId,
              expectedService,
              available: allEsphomeServices.filter((s) => s.endsWith(suffix)),
              logLabel,
            },
            'Method 2: Expected service not found in available services'
          );
        }
      } catch (err) {
        logger.warn({ err, deviceId }, 'getServicesByDomain fallback failed (non-fatal)');
      }
    } else {
      logger.warn({ deviceId, logLabel }, 'Service discovery Method 2 skipped: no esphomeNodeName available');
    }

    logger.warn({ deviceId, esphomeNodeName, logLabel }, 'Service discovery: failed to find service');
    return null;
  }
}
