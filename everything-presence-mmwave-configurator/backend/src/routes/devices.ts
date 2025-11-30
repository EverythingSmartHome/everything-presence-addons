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

      const availability: Record<string, { enabled: boolean; disabledBy: string | null }> = {};

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
          if (zoneSet?.beginX) {
            const registryEntry = entityRegistry.find((e) => e.entity_id === zoneSet.beginX);
            availability[zoneKey] = {
              enabled: !registryEntry?.disabled_by,
              disabledBy: registryEntry?.disabled_by ?? null,
            };
          }
        }
      }

      // Check exclusion zones
      if (zoneMap.exclusionZoneConfigEntities || hasDeviceMapping) {
        const zoneKeys = Object.keys(zoneMap.exclusionZoneConfigEntities || {});
        for (const zoneKey of zoneKeys) {
          const zoneEntities = (zoneMap.exclusionZoneConfigEntities?.[zoneKey] || {}) as Record<string, string>;
          const zoneSet = resolveZoneSet('exclusion', getZoneIndex(zoneKey), 'exclusionZoneConfigEntities', zoneKey, zoneEntities);
          if (zoneSet?.beginX) {
            const registryEntry = entityRegistry.find((e) => e.entity_id === zoneSet.beginX);
            availability[zoneKey] = {
              enabled: !registryEntry?.disabled_by,
              disabledBy: registryEntry?.disabled_by ?? null,
            };
          }
        }
      }

      // Check entry zones
      if (zoneMap.entryZoneConfigEntities || hasDeviceMapping) {
        const zoneKeys = Object.keys(zoneMap.entryZoneConfigEntities || {});
        for (const zoneKey of zoneKeys) {
          const zoneEntities = (zoneMap.entryZoneConfigEntities?.[zoneKey] || {}) as Record<string, string>;
          const zoneSet = resolveZoneSet('entry', getZoneIndex(zoneKey), 'entryZoneConfigEntities', zoneKey, zoneEntities);
          if (zoneSet?.beginX) {
            const registryEntry = entityRegistry.find((e) => e.entity_id === zoneSet.beginX);
            availability[zoneKey] = {
              enabled: !registryEntry?.disabled_by,
              disabledBy: registryEntry?.disabled_by ?? null,
            };
          }
        }
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

      return res.json({ availability, polygonZonesAvailable, entryZonesAvailable });
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
      await zoneWriter.applyZones(zoneMap, zones, entityNamePrefix, entityMappings, deviceId);
      return res.json({ ok: true });
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
      await zoneWriter.applyPolygonZones(entityMap, zones ?? [], entityNamePrefix, entityMappings, deviceId);
      return res.json({ ok: true });
    } catch (error) {
      logger.error({ error }, 'Failed to apply polygon zones');
      return res.status(500).json({ message: 'Failed to apply polygon zones' });
    }
  });

  return router;
};
