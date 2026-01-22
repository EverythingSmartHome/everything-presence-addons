import { Router } from 'express';
import { DeviceDiscoveryService } from '../domain/deviceDiscovery';
import { DeviceProfileLoader } from '../domain/deviceProfiles';
import type { IHaReadTransport } from '../ha/readTransport';
import type { IHaWriteClient } from '../ha/writeClient';
import { ZoneWriter } from '../ha/zoneWriter';
import { ZoneReader } from '../ha/zoneReader';
import { RoomConfig, ZonePolygon, EntityMappings } from '../domain/types';
import { EntityResolver } from '../domain/entityResolver';
import { deviceEntityService } from '../domain/deviceEntityService';
import { deviceMappingStorage } from '../config/deviceMappingStorage';
import { logger } from '../logger';

export interface DevicesRouterDependencies {
  readTransport: IHaReadTransport;
  writeClient: IHaWriteClient;
  profileLoader: DeviceProfileLoader;
}

export const createDevicesRouter = (deps: DevicesRouterDependencies): Router => {
  const router = Router();
  const { readTransport, writeClient, profileLoader } = deps;

  const discovery = new DeviceDiscoveryService(readTransport);
  const zoneWriter = new ZoneWriter(writeClient);
  const zoneReader = new ZoneReader(readTransport);
  const readinessLogThrottle = new Map<string, number>();
  const normalizeStateValue = (state?: string | null) => (typeof state === 'string' ? state.toLowerCase() : '');
  const isUnavailableState = (state?: string | null) => {
    const normalized = normalizeStateValue(state);
    return normalized === 'unavailable' || normalized === 'unknown';
  };
  const isReadinessUnavailableState = (state?: string | null) => {
    const normalized = normalizeStateValue(state);
    // Treat "unknown" as available for readiness purposes; it's common immediately after reboot.
    return normalized === 'unavailable';
  };

  router.get('/', async (_req, res) => {
    const devices = await discovery.discover();
    res.json({ devices });
  });

  router.get('/profiles', (_req, res) => {
    res.json({ profiles: profileLoader.listProfiles() });
  });

  /**
   * GET /api/devices/:deviceId/readiness
   * Simple readiness probe to gate post-update flows (entity re-sync / polygon restore).
   *
   * Query:
   * - require=discover|polygon (default: discover)
   * - profileId (required for require=polygon)
   * - entityNamePrefix (required for require=polygon)
   */
  router.get('/:deviceId/readiness', async (req, res) => {
    const { deviceId } = req.params;
    const requireMode = typeof req.query?.require === 'string' ? req.query.require : 'discover';
    const profileId = typeof req.query?.profileId === 'string' ? req.query.profileId : null;
    const entityNamePrefix =
      typeof req.query?.entityNamePrefix === 'string' ? req.query.entityNamePrefix : null;
    const parseCount = (value: unknown): number | null => {
      if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
      if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return Math.max(0, Math.floor(parsed));
      }
      return null;
    };
    const requestedRegularCount = parseCount(req.query?.regularCount);
    const requestedExclusionCount = parseCount(req.query?.exclusionCount);
    const requestedEntryCount = parseCount(req.query?.entryCount);
    const requireStateParam = typeof req.query?.requireState === 'string' ? req.query.requireState : null;
    const requireState = requireStateParam === '1' || requireStateParam === 'true';
    const debugParam = typeof req.query?.debug === 'string' ? req.query.debug : null;
    const debug = debugParam === '1' || debugParam === 'true';

    try {
      const entityRegistry = await readTransport.listEntityRegistry();
      const registryById = new Map(entityRegistry.map((entry) => [entry.entity_id, entry]));
      const registryByObjectId = new Map<string, string[]>();
      for (const entry of entityRegistry) {
        const [, objectId] = entry.entity_id.split('.', 2);
        if (!objectId) continue;
        const list = registryByObjectId.get(objectId) ?? [];
        list.push(entry.entity_id);
        registryByObjectId.set(objectId, list);
      }
      const deviceEntries = entityRegistry.filter((entry) => entry.device_id === deviceId);
      const enabledDeviceEntries = deviceEntries.filter((entry) => !entry.disabled_by);
      const deviceEntriesById = new Map(deviceEntries.map((entry) => [entry.entity_id, entry]));
      const mapping = deviceMappingStorage.getMapping(deviceId);
      const hasDeviceMapping = Boolean(mapping);

      let requiredEntityIds: string[] = [];
      if (requireMode === 'polygon') {
        // In migration flows, device mapping must be the source of truth for entity IDs.
        // Template substitution using entityNamePrefix is not reliable (entity object_id prefix can differ).
        if (!mapping) {
          return res.status(409).json({
            message: 'Device mapping not found. Run entity re-sync to create mappings.',
            code: 'MAPPING_NOT_FOUND',
          });
        }

        const effectiveProfileId = profileId ?? mapping.profileId;
        if (profileId && profileId !== mapping.profileId) {
          logger.warn(
            { deviceId, requested: profileId, mapped: mapping.profileId },
            '[EP migration] readiness: profileId mismatch; using mapped profileId'
          );
        }

        const profile = profileLoader.getProfileById(effectiveProfileId);
        if (!profile) {
          return res.status(404).json({ message: 'Profile not found' });
        }

        const limits = profile.limits ?? {};
        const maxZones = limits.maxZones ?? 4;
        const maxExclusion = limits.maxExclusionZones ?? 2;
        const maxEntry = limits.maxEntryZones ?? 2;
        const requiredZones = Math.min(requestedRegularCount ?? maxZones, maxZones);
        const requiredExclusions = Math.min(requestedExclusionCount ?? maxExclusion, maxExclusion);
        const requiredEntries = Math.min(requestedEntryCount ?? maxEntry, maxEntry);

        // Use device mapping only.
        const mappedPolygonIds: string[] = [];
        const missingMappedKeys: string[] = [];
        for (let i = 1; i <= requiredZones; i++) {
          const entityId = deviceEntityService.getPolygonZoneEntity(deviceId, 'polygon', i);
          if (entityId) mappedPolygonIds.push(entityId);
          else missingMappedKeys.push(`polygonZone${i}`);
        }
        for (let i = 1; i <= requiredExclusions; i++) {
          const entityId = deviceEntityService.getPolygonZoneEntity(deviceId, 'polygonExclusion', i);
          if (entityId) mappedPolygonIds.push(entityId);
          else missingMappedKeys.push(`polygonExclusion${i}`);
        }
        for (let i = 1; i <= requiredEntries; i++) {
          const entityId = deviceEntityService.getPolygonZoneEntity(deviceId, 'polygonEntry', i);
          if (entityId) mappedPolygonIds.push(entityId);
          else missingMappedKeys.push(`polygonEntry${i}`);
        }

        if (missingMappedKeys.length > 0) {
          return res.status(409).json({
            message: 'Device mapping is missing required polygon entities. Re-sync entities and try again.',
            code: 'MAPPING_INCOMPLETE',
            missingMappedKeys,
          });
        }

        requiredEntityIds = mappedPolygonIds;
      }

      const checkedEntityIds =
        requiredEntityIds.length > 0
          ? requiredEntityIds
          : enabledDeviceEntries.slice(0, 12).map((entry) => entry.entity_id);

      const activeTransport = (readTransport as unknown as { activeTransport?: string }).activeTransport ?? null;

      if (checkedEntityIds.length === 0) {
        return res.json({
          ready: false,
          require: requireMode,
          deviceEntityCount: deviceEntries.length,
          enabledEntityCount: enabledDeviceEntries.length,
          checkedEntityIds,
          availableEntityCount: 0,
          unavailableEntityIds: [] as string[],
          missingEntityIds: [] as string[],
          disabledEntityIds: [] as string[],
          requiredEntityIds,
          missingRegistryEntityIds: requiredEntityIds,
          missingStateEntityIds: [] as string[],
          message: 'No entities found for device yet.',
        });
      }

      const missingRegistryEntityIds =
        requireMode === 'polygon'
          ? requiredEntityIds.filter((id) => !registryById.get(id))
          : requiredEntityIds.filter((id) => !deviceEntriesById.get(id));

       // States are expensive to fetch (both WS and REST transports fetch all states and filter).
       // For polygon readiness, we usually only need the entity registry. If the registry looks incomplete,
       // fall back to states to avoid false negatives from registry latency during startup.
       const shouldFetchStates = requireMode !== 'polygon' || requireState || missingRegistryEntityIds.length > 0;
       let states: Map<string, { state: string }> = new Map();
       if (shouldFetchStates) {
         try {
           states = (await readTransport.getStates(checkedEntityIds)) as Map<string, { state: string }>;
         } catch (error) {
           logger.warn({ error, deviceId }, 'Failed to fetch states for readiness probe');
         }
       }

       // In polygon mode:
       // - Default readiness should not require a state (entities may exist + be writable while state is "unknown").
       // - Consider an entity "present" if it exists in registry OR in states (startup can be racy).
       const missingStateEntityIds =
         requireMode === 'polygon'
           ? (shouldFetchStates ? checkedEntityIds.filter((id) => Boolean(registryById.get(id)) && !states.get(id)) : ([] as string[]))
           : checkedEntityIds.filter((id) => Boolean(deviceEntriesById.get(id)) && !states.get(id));

       const missingEntityIds =
         requireMode === 'polygon'
           ? requiredEntityIds.filter((id) => !registryById.get(id) && !states.get(id))
           : checkedEntityIds.filter((id) => !states.get(id));

       const unavailableEntityIds =
         requireMode === 'polygon'
           ? checkedEntityIds.filter((id) => {
               const state = states.get(id);
               if (!state) return false;
               return isReadinessUnavailableState(state.state);
             })
           : checkedEntityIds.filter((id) => {
               const state = states.get(id);
               if (!state) return true;
               return isReadinessUnavailableState(state.state);
             });
       const disabledEntityIds =
         requireMode === 'polygon'
           ? checkedEntityIds.filter((id) => Boolean(registryById.get(id)?.disabled_by))
           : checkedEntityIds.filter((id) => Boolean(deviceEntriesById.get(id)?.disabled_by));
       const missingSet = new Set(missingEntityIds);
       const unavailableSet = new Set(unavailableEntityIds);
       const disabledSet = new Set(disabledEntityIds);
       const availableEntityCount =
         requireMode === 'polygon'
           ? checkedEntityIds.filter((id) => !missingSet.has(id) && !unavailableSet.has(id) && !disabledSet.has(id)).length
           : checkedEntityIds.length - unavailableEntityIds.length;

       const ready =
         requireMode === 'polygon'
           ? disabledEntityIds.length === 0 &&
             (requireState
               ? missingRegistryEntityIds.length === 0 &&
                 missingStateEntityIds.length === 0 &&
                 unavailableEntityIds.length === 0
               : missingEntityIds.length === 0)
           : availableEntityCount > 0;

       const expectedObjectIds = checkedEntityIds.map((id) => id.split('.', 2)[1]).filter(Boolean);
       const registryObjectIdMatches = expectedObjectIds
         .map((objectId) => ({ objectId, entityIds: registryByObjectId.get(objectId) ?? [] }))
         .filter((match) => match.entityIds.length > 0);

        const registryPrefixPolygonCandidates =
          requireMode === 'polygon' && entityNamePrefix
            ? entityRegistry
                .map((entry) => entry.entity_id)
                .filter((id) => id.includes(entityNamePrefix) && id.includes('polygon'))
                .slice(0, 30)
            : [];
        const devicePolygonCandidates =
          requireMode === 'polygon'
            ? deviceEntries
                .map((entry) => entry.entity_id)
                .filter((id) => id.includes('polygon'))
                .slice(0, 30)
            : [];

       const stuckPolygonReadiness =
         requireMode === 'polygon' &&
         checkedEntityIds.length > 0 &&
         missingEntityIds.length === checkedEntityIds.length &&
         missingRegistryEntityIds.length === requiredEntityIds.length &&
         states.size === 0;

       if (stuckPolygonReadiness) {
         const throttleKey = `${deviceId}:${entityNamePrefix ?? ''}:${profileId ?? ''}`;
         const last = readinessLogThrottle.get(throttleKey) ?? 0;
         if (Date.now() - last > 10_000) {
           readinessLogThrottle.set(throttleKey, Date.now());
           logger.info(
             {
               deviceId,
               profileId,
               entityNamePrefix,
               checkedEntityIds,
               missingEntityIds,
               missingRegistryEntityIds,
               activeTransport,
                shouldFetchStates,
                statesReturned: states.size,
                registryPrefixPolygonCandidates,
                devicePolygonCandidates,
                registryObjectIdMatches,
                note:
                  'Polygon readiness is failing because HA read transport cannot see expected entities in registry or states. Candidates/matches may reveal ID/domain mismatch.',
              },
              '[EP migration] readiness: stuck (polygon)'
            );
         }
       }

        const debugInfo = {
          activeTransport,
          shouldFetchStates,
          statesReturned: states.size,
          registryPrefixPolygonCandidates,
          devicePolygonCandidates,
          registryObjectIdMatches,
          hasDeviceMapping,
          mappingProfileId: mapping?.profileId ?? null,
          perEntity: checkedEntityIds.map((id) => {
            const registryEntry = registryById.get(id);
            const stateEntry = states.get(id);
            const stateValue = stateEntry?.state ?? null;
           const normalized = normalizeStateValue(stateValue);
           const stateStatus: 'missing' | 'unavailable' | 'unknown' | 'available' =
             stateValue == null ? 'missing' : normalized === 'unavailable' ? 'unavailable' : normalized === 'unknown' ? 'unknown' : 'available';
           return {
             entityId: id,
             inRegistry: Boolean(registryEntry),
             registryDeviceId: registryEntry?.device_id ?? null,
             disabledBy: registryEntry?.disabled_by ?? null,
             inStates: Boolean(stateEntry),
             stateStatus,
             statePreview:
               debug && typeof stateValue === 'string' ? (stateValue.length > 80 ? `${stateValue.slice(0, 80)}…` : stateValue) : null,
           };
          }),
        };

        return res.json({
          ready,
          require: requireMode,
          deviceEntityCount: deviceEntries.length,
         enabledEntityCount: enabledDeviceEntries.length,
         requiredEntityIds,
         checkedEntityIds,
         availableEntityCount,
         unavailableEntityIds,
         missingEntityIds,
         disabledEntityIds,
         missingRegistryEntityIds,
         missingStateEntityIds,
         requireState,
         debugInfo,
       });
    } catch (error) {
      logger.error({ error, deviceId }, 'Readiness probe failed');
      return res.status(500).json({ message: 'Readiness probe failed' });
    }
  });

  router.get('/:deviceId/zone-availability', async (req, res) => {
    const { deviceId } = req.params;
    const { profileId, entityNamePrefix, entityMappings: entityMappingsJson } = req.query;

    if (!profileId || !entityNamePrefix) {
      return res.status(400).json({ message: 'profileId and entityNamePrefix are required' });
    }

    const profile = profileLoader.getProfileById(profileId as string);
    if (!profile) {
      return res.status(404).json({ message: 'Profile not found' });
    }

    const zoneMap = profile.entityMap as any;
    if (!zoneMap) {
      return res.status(400).json({ message: 'Profile does not define zones' });
    }

    // Parse entityMappings if provided (JSON string in query param)
    let entityMappings: EntityMappings | undefined;
    if (entityMappingsJson && typeof entityMappingsJson === 'string') {
      try {
        entityMappings = JSON.parse(entityMappingsJson);
      } catch {
        logger.warn('Invalid entityMappings JSON in zone-availability query');
      }
    }

    // Check if device has device-level mappings (preferred)
    const hasDeviceMapping = deviceMappingStorage.hasMapping(deviceId);

    try {
      const entityRegistry = await readTransport.listEntityRegistry();
      const prefix = entityNamePrefix as string;

      const availability: Record<string, { enabled: boolean; disabledBy: string | null; status: 'enabled' | 'disabled' | 'unavailable' | 'unknown' }> = {};
      const polygonAvailability: Record<string, { enabled: boolean; disabledBy: string | null; status: 'enabled' | 'disabled' | 'unavailable' | 'unknown' }> = {};
      const registryById = new Map(entityRegistry.map((entry) => [entry.entity_id, entry]));
      const zoneEntitiesByKey = new Map<string, string[]>();
      const polygonEntitiesByKey = new Map<string, string[]>();

      // Helper to resolve zone entity set - tries device mapping first, then legacy
      const resolveZoneSet = (type: 'regular' | 'exclusion' | 'entry', index: number, groupKey: 'zoneConfigEntities' | 'exclusionZoneConfigEntities' | 'entryZoneConfigEntities', key: string, mapping?: Record<string, string>) => {
        if (hasDeviceMapping) {
          const zoneSet = deviceEntityService.getZoneEntitySet(deviceId, type, index);
          if (zoneSet) return zoneSet;
        }
        return EntityResolver.resolveZoneEntitySet(entityMappings, prefix, groupKey, key, mapping);
      };

      // Helper to extract zone index from key like "zone1" or "entry2"
      const getZoneIndex = (key: string): number => {
        const match = key.match(/(\d+)$/);
        return match ? parseInt(match[1], 10) : 1;
      };

      // Check regular zones
      if (zoneMap.zoneConfigEntities || hasDeviceMapping) {
        const zoneKeys = Object.keys(zoneMap.zoneConfigEntities || {});
        for (const zoneKey of zoneKeys) {
          const zoneEntities = (zoneMap.zoneConfigEntities?.[zoneKey] || {}) as Record<string, string>;
          const zoneSet = resolveZoneSet('regular', getZoneIndex(zoneKey), 'zoneConfigEntities', zoneKey, zoneEntities);
          if (zoneSet?.beginX && zoneSet.endX && zoneSet.beginY && zoneSet.endY) {
            const entityIds = [zoneSet.beginX, zoneSet.endX, zoneSet.beginY, zoneSet.endY];
            zoneEntitiesByKey.set(zoneKey, entityIds);
          }
        }
      }

      // Check exclusion zones
      if (zoneMap.exclusionZoneConfigEntities || hasDeviceMapping) {
        const zoneKeys = Object.keys(zoneMap.exclusionZoneConfigEntities || {});
        for (const zoneKey of zoneKeys) {
          const zoneEntities = (zoneMap.exclusionZoneConfigEntities?.[zoneKey] || {}) as Record<string, string>;
          const zoneSet = resolveZoneSet('exclusion', getZoneIndex(zoneKey), 'exclusionZoneConfigEntities', zoneKey, zoneEntities);
          if (zoneSet?.beginX && zoneSet.endX && zoneSet.beginY && zoneSet.endY) {
            const entityIds = [zoneSet.beginX, zoneSet.endX, zoneSet.beginY, zoneSet.endY];
            zoneEntitiesByKey.set(zoneKey, entityIds);
          }
        }
      }

      // Check entry zones
      if (zoneMap.entryZoneConfigEntities || hasDeviceMapping) {
        const zoneKeys = Object.keys(zoneMap.entryZoneConfigEntities || {});
        for (const zoneKey of zoneKeys) {
          const zoneEntities = (zoneMap.entryZoneConfigEntities?.[zoneKey] || {}) as Record<string, string>;
          const zoneSet = resolveZoneSet('entry', getZoneIndex(zoneKey), 'entryZoneConfigEntities', zoneKey, zoneEntities);
          if (zoneSet?.beginX && zoneSet.endX && zoneSet.beginY && zoneSet.endY) {
            const entityIds = [zoneSet.beginX, zoneSet.endX, zoneSet.beginY, zoneSet.endY];
            zoneEntitiesByKey.set(zoneKey, entityIds);
          }
        }
      }

      const resolvePolygonEntity = (
        type: 'polygon' | 'polygonExclusion' | 'polygonEntry',
        groupKey: 'polygonZoneEntities' | 'polygonExclusionEntities' | 'polygonEntryEntities',
        key: string,
        template?: string
      ): string | null => {
        const indexMatch = key.match(/(\d+)/);
        const index = indexMatch ? parseInt(indexMatch[1], 10) : 1;
        if (hasDeviceMapping) {
          const entityId = deviceEntityService.getPolygonZoneEntity(deviceId, type, index);
          if (entityId) return entityId;
        }
        return EntityResolver.resolvePolygonZoneEntity(entityMappings, prefix, groupKey, key, template);
      };

      const addPolygonAvailability = (
        type: 'polygon' | 'polygonExclusion' | 'polygonEntry',
        groupKey: 'polygonZoneEntities' | 'polygonExclusionEntities' | 'polygonEntryEntities',
        labelPrefix: 'Zone' | 'Exclusion' | 'Entry',
        maxCount: number
      ) => {
        const map = (zoneMap as Record<string, unknown>)[groupKey] as Record<string, string> | undefined;
        const keys = map && Object.keys(map).length > 0
          ? Object.keys(map)
          : Array.from({ length: maxCount }, (_, i) => `${labelPrefix.toLowerCase()}${i + 1}`);

        for (const key of keys) {
          const entityId = resolvePolygonEntity(type, groupKey, key, map?.[key]);
          if (!entityId) continue;
          const indexMatch = key.match(/(\d+)/);
          const index = indexMatch ? parseInt(indexMatch[1], 10) : 1;
          const label = `${labelPrefix} ${index}`;
          polygonEntitiesByKey.set(label, [entityId]);
        }
      };

      addPolygonAvailability('polygon', 'polygonZoneEntities', 'Zone', profile.limits?.maxZones ?? 4);
      addPolygonAvailability('polygonExclusion', 'polygonExclusionEntities', 'Exclusion', profile.limits?.maxExclusionZones ?? 2);
      addPolygonAvailability('polygonEntry', 'polygonEntryEntities', 'Entry', profile.limits?.maxEntryZones ?? 2);

      const zoneEntityIds = Array.from(
        new Set([
          ...Array.from(zoneEntitiesByKey.values()).flat(),
          ...Array.from(polygonEntitiesByKey.values()).flat(),
        ])
      );
      let stateMap = new Map<string, { state: string }>();
      if (zoneEntityIds.length > 0) {
        try {
          const states = await readTransport.getStates(zoneEntityIds);
          stateMap = states as Map<string, { state: string }>;
        } catch (error) {
          logger.warn({ error }, 'Failed to fetch zone entity states for availability checks');
        }
      }

      const buildAvailability = (entityIds: string[]) => {
        const registryEntries = entityIds.map((id) => registryById.get(id)).filter(Boolean);
        const disabledEntry = registryEntries.find((entry) => entry?.disabled_by);
        const disabledBy = disabledEntry?.disabled_by ?? null;

        let status: 'enabled' | 'disabled' | 'unavailable' | 'unknown' = 'unknown';
        if (disabledBy) {
          status = 'disabled';
        } else if (stateMap.size > 0) {
          const states = entityIds.map((id) => stateMap.get(id)).filter(Boolean);
          if (states.length !== entityIds.length) {
            status = 'unknown';
          } else if (states.some((state) => isUnavailableState(state?.state))) {
            status = 'unavailable';
          } else {
            status = 'enabled';
          }
        }

        return {
          enabled: status === 'enabled',
          disabledBy,
          status,
        };
      };

      for (const [zoneKey, entityIds] of zoneEntitiesByKey.entries()) {
        availability[zoneKey] = buildAvailability(entityIds);
      }

      for (const [zoneKey, entityIds] of polygonEntitiesByKey.entries()) {
        polygonAvailability[zoneKey] = buildAvailability(entityIds);
      }

      // Check if advanced features are available by checking if their entities exist
      // This is more reliable than checking firmware version
      let polygonZonesAvailable = false;
      let entryZonesAvailable = false;

      // Check polygon zone 1 entity existence - try device mapping first
      let polygonZone1Entity: string | null = null;
      if (hasDeviceMapping) {
        polygonZone1Entity = deviceEntityService.getPolygonZoneEntity(deviceId, 'polygon', 1);
      }
      if (!polygonZone1Entity && zoneMap.polygonZoneEntities?.zone1) {
        polygonZone1Entity = EntityResolver.resolvePolygonZoneEntity(
          entityMappings,
          prefix,
          'polygonZoneEntities',
          'zone1',
          zoneMap.polygonZoneEntities.zone1
        );
      }
      if (polygonZone1Entity) {
        const polygonEntry = entityRegistry.find((e) => e.entity_id === polygonZone1Entity);
        polygonZonesAvailable = !!polygonEntry;
      }

      // Check entry zone 1 entity existence - try device mapping first
      let entryZone1BeginX: string | null = null;
      if (hasDeviceMapping) {
        const entryZoneSet = deviceEntityService.getZoneEntitySet(deviceId, 'entry', 1);
        entryZone1BeginX = entryZoneSet?.beginX || null;
      }
      if (!entryZone1BeginX && zoneMap.entryZoneConfigEntities?.entry1) {
        const entryEntities = zoneMap.entryZoneConfigEntities.entry1 as Record<string, string>;
        const entryZoneSet = EntityResolver.resolveZoneEntitySet(
          entityMappings,
          prefix,
          'entryZoneConfigEntities',
          'entry1',
          entryEntities
        );
        entryZone1BeginX = entryZoneSet?.beginX || null;
      }
      if (entryZone1BeginX) {
        const entryEntry = entityRegistry.find((e) => e.entity_id === entryZone1BeginX);
        entryZonesAvailable = !!entryEntry;
      }

      return res.json({ availability, polygonAvailability, polygonZonesAvailable, entryZonesAvailable });
    } catch (error) {
      logger.error({ error }, 'Failed to check zone availability');
      return res.status(500).json({ message: 'Failed to check zone availability' });
    }
  });

  router.get('/:deviceId/zones', async (req, res) => {
    const { deviceId } = req.params;
    const { profileId, entityNamePrefix, entityMappings: entityMappingsJson } = req.query;

    if (!profileId || !entityNamePrefix) {
      return res.status(400).json({ message: 'profileId and entityNamePrefix are required' });
    }

    const profile = profileLoader.getProfileById(profileId as string);
    if (!profile) {
      return res.status(404).json({ message: 'Profile not found' });
    }

    const zoneMap = profile.entityMap as any;
    if (!zoneMap) {
      return res.status(400).json({ message: 'Profile does not define zones' });
    }

    // Parse entityMappings if provided (JSON string in query param)
    let entityMappings: EntityMappings | undefined;
    if (entityMappingsJson && typeof entityMappingsJson === 'string') {
      try {
        entityMappings = JSON.parse(entityMappingsJson);
      } catch {
        logger.warn('Invalid entityMappings JSON in query');
      }
    }

    try {
      const zones = await zoneReader.readZones(zoneMap, entityNamePrefix as string, entityMappings, deviceId);
      return res.json({ zones });
    } catch (error) {
      logger.error({ error }, 'Failed to read zones');
      return res.status(500).json({ message: 'Failed to read zones' });
    }
  });

  router.post('/:deviceId/zones', async (req, res) => {
    const { deviceId } = req.params;
    const profileId = (req.body?.profileId as string | undefined) ?? (req.body?.profile_id as string | undefined);
    const entityNamePrefix = (req.body?.entityNamePrefix as string | undefined) ?? (req.body?.entity_name_prefix as string | undefined);
    const zones = (req.body?.zones as RoomConfig['zones']) ?? [];
    const entityMappings = req.body?.entityMappings as EntityMappings | undefined;

    if (!profileId) {
      return res.status(400).json({ message: 'profileId is required' });
    }
    if (!entityNamePrefix) {
      return res.status(400).json({ message: 'entityNamePrefix is required' });
    }
    const profile = profileLoader.getProfileById(profileId);
    if (!profile) {
      return res.status(404).json({ message: 'Profile not found' });
    }

    const zoneMap = profile.entityMap as any;
    if (!zoneMap) {
      return res.status(400).json({ message: 'Profile does not define zones' });
    }

    try {
      const result = await zoneWriter.applyZones(zoneMap, zones, entityNamePrefix, entityMappings, deviceId);
      return res.json({ ok: result.ok, warnings: result.failures });
    } catch (error) {
      logger.error({ error }, 'Failed to apply zones');
      return res.status(500).json({ message: 'Failed to apply zones' });
    }
  });

  // ==================== POLYGON ZONE ENDPOINTS ====================

  /**
   * Get polygon mode status for a device.
   */
  router.get('/:deviceId/polygon-mode', async (req, res) => {
    const { deviceId } = req.params;
    const { profileId, entityNamePrefix, entityMappings: entityMappingsJson } = req.query;

    if (!profileId || !entityNamePrefix) {
      return res.status(400).json({ message: 'profileId and entityNamePrefix are required' });
    }

    const profile = profileLoader.getProfileById(profileId as string);
    if (!profile) {
      return res.status(404).json({ message: 'Profile not found' });
    }

    const capabilities = profile.capabilities as any;
    if (!capabilities?.polygonZones) {
      return res.json({ supported: false, enabled: false, controllable: false });
    }

    const entityMap = profile.entityMap as any;
    const entityTemplate = entityMap?.polygonZonesEnabledEntity;

    // Check if device has device-level mappings (preferred)
    const hasDeviceMapping = deviceMappingStorage.hasMapping(deviceId);

    // Parse entityMappings if provided (JSON string in query param)
    let entityMappings: EntityMappings | undefined;
    if (entityMappingsJson && typeof entityMappingsJson === 'string') {
      try {
        entityMappings = JSON.parse(entityMappingsJson);
      } catch {
        logger.warn('Invalid entityMappings JSON in polygon-mode query');
      }
    }

    try {
      // Try device-level mapping first, then EntityResolver for the switch
      let switchEntityId: string | null = null;
      if (hasDeviceMapping) {
        switchEntityId = deviceEntityService.getEntityId(deviceId, 'polygonZonesEnabled');
      }
      if (!switchEntityId) {
        switchEntityId = EntityResolver.resolve(
          entityMappings,
          entityNamePrefix as string,
          'polygonZonesEnabledEntity',
          entityTemplate
        );
      }

      if (!switchEntityId) {
        // No toggle entity: check for polygon zone entities (polygon-only firmware)
        let polygonZoneEntity: string | null = null;
        if (hasDeviceMapping) {
          polygonZoneEntity = deviceEntityService.getPolygonZoneEntity(deviceId, 'polygon', 1);
        }
        if (!polygonZoneEntity && entityMap?.polygonZoneEntities?.zone1) {
          polygonZoneEntity = EntityResolver.resolvePolygonZoneEntity(
            entityMappings,
            entityNamePrefix as string,
            'polygonZoneEntities',
            'zone1',
            entityMap.polygonZoneEntities.zone1
          );
        }
        if (!polygonZoneEntity) {
          return res.json({ supported: false, enabled: false, controllable: false });
        }

        const states = await readTransport.getStates([polygonZoneEntity]);
        const state = states.get(polygonZoneEntity);
        if (!state) {
          return res.json({ supported: false, enabled: false, controllable: false });
        }

        return res.json({ supported: true, enabled: true, controllable: false });
      }

      logger.info({ entityId: switchEntityId, entityNamePrefix, usedDeviceMapping: hasDeviceMapping }, 'Checking polygon mode entity');

      const states = await readTransport.getStates([switchEntityId]);
      const state = states.get(switchEntityId);

      logger.info({
        entityId: switchEntityId,
        stateFound: !!state,
        stateValue: state?.state,
        statesMapSize: states.size
      }, 'Polygon mode entity state lookup result');

      // If entity doesn't exist in Home Assistant, polygon zones are not supported
      if (!state) {
        logger.info({ entityId: switchEntityId }, 'Polygon mode entity not found - feature not available');
        return res.json({ supported: false, enabled: false, controllable: true });
      }

      // Check if enabled (case-insensitive)
      const enabled = state.state?.toLowerCase() === 'on';

      logger.info({ entityId: switchEntityId, supported: true, enabled, rawState: state.state }, 'Polygon mode status determined');

      return res.json({ supported: true, enabled, entityId: switchEntityId, controllable: true });
    } catch (error) {
      logger.error({ error }, 'Failed to get polygon mode status');
      return res.status(500).json({ message: 'Failed to get polygon mode status' });
    }
  });

  /**
   * Set polygon mode for a device.
   */
  router.post('/:deviceId/polygon-mode', async (req, res) => {
    const { deviceId } = req.params;
    const profileId = req.body?.profileId as string | undefined;
    const entityNamePrefix = req.body?.entityNamePrefix as string | undefined;
    const enabled = req.body?.enabled as boolean | undefined;
    const entityMappings = req.body?.entityMappings as EntityMappings | undefined;

    if (!profileId || !entityNamePrefix || enabled === undefined) {
      return res.status(400).json({ message: 'profileId, entityNamePrefix, and enabled are required' });
    }

    const profile = profileLoader.getProfileById(profileId);
    if (!profile) {
      return res.status(404).json({ message: 'Profile not found' });
    }

    const entityMap = profile.entityMap as any;

    try {
      await zoneWriter.setPolygonMode(entityMap, entityNamePrefix, enabled, entityMappings, deviceId);
      return res.json({ ok: true, enabled });
    } catch (error) {
      logger.error({ error }, 'Failed to set polygon mode');
      return res.status(500).json({ message: 'Failed to set polygon mode' });
    }
  });

  /**
   * Get polygon zones from device text entities.
   */
  router.get('/:deviceId/polygon-zones', async (req, res) => {
    const { deviceId } = req.params;
    const { profileId, entityNamePrefix, entityMappings: entityMappingsJson } = req.query;

    if (!profileId || !entityNamePrefix) {
      return res.status(400).json({ message: 'profileId and entityNamePrefix are required' });
    }

    const profile = profileLoader.getProfileById(profileId as string);
    if (!profile) {
      return res.status(404).json({ message: 'Profile not found' });
    }

    const entityMap = profile.entityMap as any;

    // Parse entityMappings if provided (JSON string in query param)
    let entityMappings: EntityMappings | undefined;
    if (entityMappingsJson && typeof entityMappingsJson === 'string') {
      try {
        entityMappings = JSON.parse(entityMappingsJson);
      } catch {
        logger.warn('Invalid entityMappings JSON in query');
      }
    }

    try {
      const zones = await zoneReader.readPolygonZones(entityMap, entityNamePrefix as string, entityMappings, deviceId);
      return res.json({ zones });
    } catch (error) {
      logger.error({ error }, 'Failed to read polygon zones');
      return res.status(500).json({ message: 'Failed to read polygon zones' });
    }
  });

  /**
   * Apply polygon zones to device text entities.
   */
  router.post('/:deviceId/polygon-zones', async (req, res) => {
    const { deviceId } = req.params;
    const profileId = req.body?.profileId as string | undefined;
    const entityNamePrefix = req.body?.entityNamePrefix as string | undefined;
    const zones = req.body?.zones as ZonePolygon[] | undefined;
    const entityMappings = req.body?.entityMappings as EntityMappings | undefined;

    if (!profileId || !entityNamePrefix) {
      return res.status(400).json({ message: 'profileId and entityNamePrefix are required' });
    }

    const profile = profileLoader.getProfileById(profileId);
    if (!profile) {
      return res.status(404).json({ message: 'Profile not found' });
    }

    const entityMap = profile.entityMap as any;

    try {
      const warnings: Array<{ entityId?: string; description: string; error: string }> = [];

      const resolvePolygonEntity = (
        type: 'polygon' | 'polygonExclusion' | 'polygonEntry',
        key: string,
        template?: string
      ): string | null => {
        const indexMatch = key.match(/(\d+)/);
        const index = indexMatch ? parseInt(indexMatch[1], 10) : 1;
        const hasDeviceMapping = deviceMappingStorage.hasMapping(deviceId);
        if (hasDeviceMapping) {
          const entityId = deviceEntityService.getPolygonZoneEntity(deviceId, type, index);
          if (entityId) return entityId;
        }
        const groupKey =
          type === 'polygon' ? 'polygonZoneEntities'
            : type === 'polygonExclusion' ? 'polygonExclusionEntities'
              : 'polygonEntryEntities';
        return EntityResolver.resolvePolygonZoneEntity(entityMappings, entityNamePrefix, groupKey, key, template);
      };

      const polygonMap = entityMap?.polygonZoneEntities as Record<string, string> | undefined;
      const polygonExclusionMap = entityMap?.polygonExclusionEntities as Record<string, string> | undefined;
      const polygonEntryMap = entityMap?.polygonEntryEntities as Record<string, string> | undefined;

      const resolvedEntities = (zones ?? []).map((zone) => {
        let key = '';
        let template: string | undefined;
        let type: 'polygon' | 'polygonExclusion' | 'polygonEntry' = 'polygon';
        const indexMatch = zone.id.match(/(\d+)/);
        const index = indexMatch ? parseInt(indexMatch[1], 10) : 1;

        if (zone.type === 'exclusion') {
          key = `exclusion${index}`;
          type = 'polygonExclusion';
          template = polygonExclusionMap?.[key];
        } else if (zone.type === 'entry') {
          key = `entry${index}`;
          type = 'polygonEntry';
          template = polygonEntryMap?.[key];
        } else {
          key = `zone${index}`;
          type = 'polygon';
          template = polygonMap?.[key];
        }

        const entityId = resolvePolygonEntity(type, key, template);
        return { zoneId: zone.id, entityId };
      });

      const entityIds = resolvedEntities.map((entry) => entry.entityId).filter(Boolean) as string[];

      if (entityIds.length > 0) {
        let registryById = new Map<string, { disabled_by: string | null }>();
        try {
          const registry = await readTransport.listEntityRegistry();
          registryById = new Map(registry.map((entry) => [entry.entity_id, { disabled_by: entry.disabled_by ?? null }]));
        } catch (error) {
          logger.warn({ error }, 'Failed to load entity registry for polygon zone checks');
        }

        let statesById = new Map<string, { state: string }>();
        try {
          const states = await readTransport.getStates(entityIds);
          statesById = states as Map<string, { state: string }>;
        } catch (error) {
          logger.warn({ error }, 'Failed to load entity states for polygon zone checks');
        }

        for (const entry of resolvedEntities) {
          if (!entry.entityId) {
            warnings.push({
              description: `${entry.zoneId} entity could not be resolved`,
              error: 'Entity not resolved',
            });
            continue;
          }

          const registryEntry = registryById.get(entry.entityId);
          if (registryEntry?.disabled_by) {
            warnings.push({
              entityId: entry.entityId,
              description: `${entry.zoneId} entity is disabled`,
              error: `disabled_by:${registryEntry.disabled_by}`,
            });
            continue;
          }

          const state = statesById.get(entry.entityId);
          if (!state) {
            warnings.push({
              entityId: entry.entityId,
              description: `${entry.zoneId} entity state is missing`,
              error: 'state_missing',
            });
            continue;
          }

          if (isUnavailableState(state.state)) {
            warnings.push({
              entityId: entry.entityId,
              description: `${entry.zoneId} entity is unavailable`,
              error: state.state,
            });
          }
        }
      }

      const result = await zoneWriter.applyPolygonZones(entityMap, zones ?? [], entityNamePrefix, entityMappings, deviceId);
      const combinedWarnings = [...warnings, ...result.failures];
      return res.json({ ok: result.ok, warnings: combinedWarnings });
    } catch (error) {
      logger.error({ error }, 'Failed to apply polygon zones');
      return res.status(500).json({ message: 'Failed to apply polygon zones' });
    }
  });

  return router;
};
