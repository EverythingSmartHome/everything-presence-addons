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
  const normalizeStateValue = (state?: string | null) => (typeof state === 'string' ? state.toLowerCase() : '');
  const isUnavailableState = (state?: string | null) => {
    const normalized = normalizeStateValue(state);
    return normalized === 'unavailable' || normalized === 'unknown';
  };

  router.get('/', async (_req, res) => {
    const devices = await discovery.discover();
    res.json({ devices });
  });

  router.get('/profiles', (_req, res) => {
    res.json({ profiles: profileLoader.listProfiles() });
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
      return res.json({ supported: false, enabled: false });
    }

    const entityMap = profile.entityMap as any;
    const entityTemplate = entityMap?.polygonZonesEnabledEntity;

    // Check if device has device-level mappings (preferred)
    const hasDeviceMapping = deviceMappingStorage.hasMapping(deviceId);

    // Need either entity template or device mapping
    if (!entityTemplate && !hasDeviceMapping) {
      return res.json({ supported: false, enabled: false });
    }

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
      // Try device-level mapping first, then EntityResolver
      let entityId: string | null = null;
      if (hasDeviceMapping) {
        entityId = deviceEntityService.getEntityId(deviceId, 'polygonZonesEnabled');
      }
      if (!entityId) {
        entityId = EntityResolver.resolve(
          entityMappings,
          entityNamePrefix as string,
          'polygonZonesEnabledEntity',
          entityTemplate
        );
      }
      if (!entityId) {
        return res.json({ supported: false, enabled: false });
      }
      logger.info({ entityId, entityNamePrefix, usedDeviceMapping: hasDeviceMapping }, 'Checking polygon mode entity');

      const states = await readTransport.getStates([entityId]);
      const state = states.get(entityId);

      logger.info({
        entityId,
        stateFound: !!state,
        stateValue: state?.state,
        statesMapSize: states.size
      }, 'Polygon mode entity state lookup result');

      // If entity doesn't exist in Home Assistant, polygon zones are not supported
      // (device may not have the required firmware)
      if (!state) {
        logger.info({ entityId }, 'Polygon mode entity not found - feature not available');
        return res.json({ supported: false, enabled: false });
      }

      // Check if enabled (case-insensitive)
      const enabled = state.state?.toLowerCase() === 'on';

      logger.info({ entityId, supported: true, enabled, rawState: state.state }, 'Polygon mode status determined');

      return res.json({ supported: true, enabled, entityId });
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
