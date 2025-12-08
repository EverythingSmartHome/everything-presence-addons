import { Router } from 'express';
import { HeatmapService } from '../domain/heatmapService';
import { DeviceProfileLoader } from '../domain/deviceProfiles';
import { ZoneReader } from '../ha/zoneReader';
import type { IHaReadTransport } from '../ha/readTransport';
import type { HaAuthConfig } from '../ha/types';
import type { EntityMappings } from '../domain/types';
import { logger } from '../logger';

export interface HeatmapRouterDependencies {
  haConfig: HaAuthConfig;
  readTransport: IHaReadTransport;
  profileLoader: DeviceProfileLoader;
}

export const createHeatmapRouter = (deps: HeatmapRouterDependencies): Router => {
  const router = Router();
  const { haConfig, readTransport, profileLoader } = deps;

  const heatmapService = new HeatmapService(haConfig);
  const zoneReader = new ZoneReader(readTransport);

  /**
   * GET /api/devices/:deviceId/heatmap
   * Generate heatmap data from HA history.
   */
  router.get('/:deviceId/heatmap', async (req, res) => {
    const { profileId, entityNamePrefix, hours, resolution, entityMappings: entityMappingsJson } = req.query;

    if (!profileId || !entityNamePrefix) {
      return res.status(400).json({ message: 'profileId and entityNamePrefix are required' });
    }

    const profile = profileLoader.getProfileById(profileId as string);
    if (!profile) {
      return res.status(404).json({ message: 'Profile not found' });
    }

    // Check device supports tracking
    const capabilities = profile.capabilities as { tracking?: boolean };
    if (!capabilities?.tracking) {
      return res.status(400).json({ message: 'Device does not support tracking' });
    }

    const hoursNum = Math.min(168, Math.max(1, parseInt(hours as string) || 24));
    const resolutionNum = Math.max(100, Math.min(1000, parseInt(resolution as string) || 400));

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
      // Get deviceId from route params
      const { deviceId } = req.params;

      // Get current zones for zone stats calculation
      const entityMap = profile.entityMap as Record<string, unknown>;
      let zones;
      try {
        const polygonZones = await zoneReader.readPolygonZones(entityMap, entityNamePrefix as string, entityMappings, deviceId);
        const rectZones = await zoneReader.readZones(entityMap, entityNamePrefix as string, entityMappings, deviceId);
        // Deduplicate zones by ID (prefer polygon zones if both exist)
        const zoneMap = new Map<string, typeof polygonZones[0] | typeof rectZones[0]>();
        for (const zone of rectZones) {
          zoneMap.set(zone.id, zone);
        }
        for (const zone of polygonZones) {
          zoneMap.set(zone.id, zone); // Overwrites rect zone if same ID
        }
        zones = Array.from(zoneMap.values());
      } catch {
        // Zones are optional for heatmap
        zones = undefined;
      }

      const heatmap = await heatmapService.generateHeatmap(
        entityNamePrefix as string,
        hoursNum,
        resolutionNum,
        zones,
        entityMappings,
        deviceId
      );

      return res.json(heatmap);
    } catch (error) {
      logger.error({ error }, 'Failed to generate heatmap');
      return res.status(500).json({ message: 'Failed to generate heatmap' });
    }
  });

  return router;
};
