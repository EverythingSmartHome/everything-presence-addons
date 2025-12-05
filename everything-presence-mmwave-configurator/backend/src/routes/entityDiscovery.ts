import { Router } from 'express';
import { EntityDiscoveryService } from '../domain/entityDiscovery';
import type { DeviceProfileLoader } from '../domain/deviceProfiles';
import type { IHaReadTransport } from '../ha/readTransport';
import type { EntityMappings } from '../domain/types';
import { logger } from '../logger';

export interface EntityDiscoveryRouterDependencies {
  readTransport: IHaReadTransport;
  profileLoader: DeviceProfileLoader;
}

export const createEntityDiscoveryRouter = (deps: EntityDiscoveryRouterDependencies): Router => {
  const router = Router();
  const { readTransport, profileLoader } = deps;
  const discoveryService = new EntityDiscoveryService(readTransport, profileLoader);

  /**
   * GET /api/devices/:deviceId/discover-entities
   * Discover and auto-match entities for a device against a profile.
   *
   * Query params:
   *   - profileId (required): The device profile to match against
   *
   * Response: DiscoveryResult
   */
  router.get('/:deviceId/discover-entities', async (req, res) => {
    const { deviceId } = req.params;
    const { profileId } = req.query;

    if (!deviceId) {
      return res.status(400).json({ error: 'deviceId is required' });
    }

    if (!profileId || typeof profileId !== 'string') {
      return res.status(400).json({ error: 'profileId query parameter is required' });
    }

    try {
      const result = await discoveryService.discoverEntities(deviceId, profileId);
      return res.json(result);
    } catch (error) {
      logger.error({ error, deviceId, profileId }, 'Entity discovery failed');
      return res.status(500).json({
        error: 'Entity discovery failed',
        message: (error as Error).message,
      });
    }
  });

  /**
   * GET /api/devices/:deviceId/entities
   * Get all entities belonging to a device.
   * Useful for manual entity mapping UI.
   *
   * Response: { entities: EntityRegistryEntry[] }
   */
  router.get('/:deviceId/entities', async (req, res) => {
    const { deviceId } = req.params;

    if (!deviceId) {
      return res.status(400).json({ error: 'deviceId is required' });
    }

    try {
      const entities = await discoveryService.getDeviceEntities(deviceId);
      return res.json({ entities });
    } catch (error) {
      logger.error({ error, deviceId }, 'Failed to get device entities');
      return res.status(500).json({
        error: 'Failed to get device entities',
        message: (error as Error).message,
      });
    }
  });

  /**
   * POST /api/devices/:deviceId/validate-mappings
   * Validate that a set of entity mappings are all accessible in Home Assistant.
   *
   * Body: { mappings: Partial<EntityMappings> }
   * Response: { valid: boolean, errors: { key: string, entityId: string, error: string }[] }
   */
  router.post('/:deviceId/validate-mappings', async (req, res) => {
    const { deviceId } = req.params;
    const { mappings } = req.body;

    if (!deviceId) {
      return res.status(400).json({ error: 'deviceId is required' });
    }

    if (!mappings || typeof mappings !== 'object') {
      return res.status(400).json({ error: 'mappings object is required in request body' });
    }

    try {
      const result = await discoveryService.validateMappings(mappings as Partial<EntityMappings>, deviceId);
      return res.json(result);
    } catch (error) {
      logger.error({ error, deviceId }, 'Mapping validation failed');
      return res.status(500).json({
        error: 'Mapping validation failed',
        message: (error as Error).message,
      });
    }
  });

  /**
   * POST /api/devices/:deviceId/discover-and-save
   * Discover entities for a device and save the mapping to device storage.
   * This wires entity discovery to the device mapping store.
   *
   * Body: { profileId: string, deviceName: string }
   * Response: { mapping: DeviceMapping, discovery: DiscoveryResult }
   */
  router.post('/:deviceId/discover-and-save', async (req, res) => {
    const { deviceId } = req.params;
    const { profileId, deviceName } = req.body;

    if (!deviceId) {
      return res.status(400).json({ error: 'deviceId is required' });
    }

    if (!profileId || typeof profileId !== 'string') {
      return res.status(400).json({ error: 'profileId is required in request body' });
    }

    if (!deviceName || typeof deviceName !== 'string') {
      return res.status(400).json({ error: 'deviceName is required in request body' });
    }

    try {
      const result = await discoveryService.discoverAndSave(deviceId, profileId, deviceName);
      return res.json(result);
    } catch (error) {
      logger.error({ error, deviceId, profileId }, 'Discover and save failed');
      return res.status(500).json({
        error: 'Discover and save failed',
        message: (error as Error).message,
      });
    }
  });

  return router;
};
