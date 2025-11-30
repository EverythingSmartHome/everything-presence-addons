import { Router } from 'express';
import { deviceMappingStorage, DeviceMapping } from '../config/deviceMappingStorage';
import { deviceEntityService } from '../domain/deviceEntityService';
import { migrationService } from '../domain/migrationService';
import { logger } from '../logger';
import type { IHaReadTransport } from '../ha/readTransport';

export interface DeviceMappingsRouterDependencies {
  readTransport?: IHaReadTransport;
}

/**
 * Router for device entity mapping endpoints.
 * These endpoints manage the device-level entity mappings (the new preferred approach).
 */
export const createDeviceMappingsRouter = (deps?: DeviceMappingsRouterDependencies): Router => {
  const router = Router();
  const readTransport = deps?.readTransport;

  /**
   * GET /api/device-mappings
   * List all device mappings.
   */
  router.get('/', (_req, res) => {
    try {
      const mappings = deviceMappingStorage.listMappings();
      return res.json({ mappings });
    } catch (error) {
      logger.error({ error }, 'Failed to list device mappings');
      return res.status(500).json({ message: 'Failed to list device mappings' });
    }
  });

  /**
   * GET /api/device-mappings/:deviceId
   * Get a specific device's entity mappings.
   */
  router.get('/:deviceId', (req, res) => {
    const { deviceId } = req.params;

    try {
      const mapping = deviceMappingStorage.getMapping(deviceId);
      if (!mapping) {
        return res.status(404).json({
          message: 'Device mapping not found',
          code: 'MAPPING_NOT_FOUND',
        });
      }
      return res.json({ mapping });
    } catch (error) {
      logger.error({ error, deviceId }, 'Failed to get device mapping');
      return res.status(500).json({ message: 'Failed to get device mapping' });
    }
  });

  /**
   * PUT /api/device-mappings/:deviceId
   * Update a device's entity mappings.
   * Used for manual corrections or re-discovery results.
   */
  router.put('/:deviceId', async (req, res) => {
    const { deviceId } = req.params;
    const mappingData = req.body as Partial<DeviceMapping>;

    if (!mappingData) {
      return res.status(400).json({ message: 'Request body is required' });
    }

    try {
      // Get existing mapping if it exists
      const existing = deviceMappingStorage.getMapping(deviceId);

      // Fetch entity units if readTransport is available and mappings are provided
      let entityUnits: Record<string, string> = mappingData.entityUnits ?? existing?.entityUnits ?? {};

      // If we have new mappings and readTransport is available, fetch units for coordinate entities
      if (mappingData.mappings && readTransport && Object.keys(entityUnits).length === 0) {
        entityUnits = await fetchEntityUnits(mappingData.mappings, readTransport);
      }

      // Build the mapping object
      const mapping: DeviceMapping = {
        deviceId,
        profileId: mappingData.profileId ?? existing?.profileId ?? 'unknown',
        deviceName: mappingData.deviceName ?? existing?.deviceName ?? 'Unknown Device',
        discoveredAt: existing?.discoveredAt ?? new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        confirmedByUser: mappingData.confirmedByUser ?? existing?.confirmedByUser ?? true,
        autoMatchedCount: mappingData.autoMatchedCount ?? existing?.autoMatchedCount ?? 0,
        manuallyMappedCount: mappingData.manuallyMappedCount ?? existing?.manuallyMappedCount ?? 0,
        mappings: mappingData.mappings ?? existing?.mappings ?? {},
        unmappedEntities: mappingData.unmappedEntities ?? existing?.unmappedEntities ?? [],
        entityUnits,
      };

      await deviceMappingStorage.saveMapping(mapping);

      logger.info({ deviceId, mappingCount: Object.keys(mapping.mappings).length, entityUnits }, 'Device mapping updated');

      return res.json({ mapping });
    } catch (error) {
      logger.error({ error, deviceId }, 'Failed to update device mapping');
      return res.status(500).json({ message: 'Failed to update device mapping' });
    }
  });

  /**
   * DELETE /api/device-mappings/:deviceId
   * Delete a device's entity mappings.
   */
  router.delete('/:deviceId', (req, res) => {
    const { deviceId } = req.params;

    try {
      const deleted = deviceMappingStorage.deleteMapping(deviceId);
      if (!deleted) {
        return res.status(404).json({ message: 'Device mapping not found' });
      }

      logger.info({ deviceId }, 'Device mapping deleted');
      return res.json({ deleted: true });
    } catch (error) {
      logger.error({ error, deviceId }, 'Failed to delete device mapping');
      return res.status(500).json({ message: 'Failed to delete device mapping' });
    }
  });

  /**
   * GET /api/device-mappings/:deviceId/entities
   * Get entities for a device, optionally filtered by category.
   */
  router.get('/:deviceId/entities', (req, res) => {
    const { deviceId } = req.params;
    const { category } = req.query;

    try {
      if (!deviceMappingStorage.hasMapping(deviceId)) {
        return res.status(404).json({
          message: 'Device mapping not found',
          code: 'MAPPING_NOT_FOUND',
        });
      }

      if (category && ['sensor', 'setting', 'zone', 'tracking'].includes(category as string)) {
        const entities = deviceEntityService.getEntitiesByCategory(
          deviceId,
          category as 'sensor' | 'setting' | 'zone' | 'tracking'
        );
        return res.json({ entities, category });
      }

      // Return all mapped entities
      const mapping = deviceMappingStorage.getMapping(deviceId);
      return res.json({ entities: mapping?.mappings ?? {} });
    } catch (error) {
      logger.error({ error, deviceId, category }, 'Failed to get device entities');
      return res.status(500).json({ message: 'Failed to get device entities' });
    }
  });

  /**
   * GET /api/device-mappings/:deviceId/settings
   * Get settings entities grouped for UI display.
   */
  router.get('/:deviceId/settings', (req, res) => {
    const { deviceId } = req.params;

    try {
      if (!deviceMappingStorage.hasMapping(deviceId)) {
        return res.status(404).json({
          message: 'Device mapping not found',
          code: 'MAPPING_NOT_FOUND',
        });
      }

      const groups = deviceEntityService.getSettingsGrouped(deviceId);
      return res.json({ groups });
    } catch (error) {
      logger.error({ error, deviceId }, 'Failed to get device settings');
      return res.status(500).json({ message: 'Failed to get device settings' });
    }
  });

  /**
   * GET /api/device-mappings/:deviceId/entity/:entityKey
   * Get a specific entity ID by key.
   */
  router.get('/:deviceId/entity/:entityKey', (req, res) => {
    const { deviceId, entityKey } = req.params;

    try {
      const entityId = deviceEntityService.getEntityId(deviceId, entityKey);
      if (!entityId) {
        return res.status(404).json({
          message: 'Entity not found',
          code: 'ENTITY_NOT_FOUND',
          deviceId,
          entityKey,
        });
      }

      return res.json({ entityId, entityKey });
    } catch (error) {
      logger.error({ error, deviceId, entityKey }, 'Failed to get entity');
      return res.status(500).json({ message: 'Failed to get entity' });
    }
  });

  /**
   * GET /api/device-mappings/:deviceId/validation
   * Check if a device has valid mappings and what's missing.
   */
  router.get('/:deviceId/validation', (req, res) => {
    const { deviceId } = req.params;

    try {
      const hasValid = deviceEntityService.hasValidMappings(deviceId);
      const missing = deviceEntityService.getMissingEntities(deviceId);
      const mapping = deviceMappingStorage.getMapping(deviceId);

      return res.json({
        hasMapping: !!mapping,
        hasValidMappings: hasValid,
        missingEntities: missing,
        mappedCount: mapping ? Object.keys(mapping.mappings).length : 0,
        confirmedByUser: mapping?.confirmedByUser ?? false,
      });
    } catch (error) {
      logger.error({ error, deviceId }, 'Failed to validate device mapping');
      return res.status(500).json({ message: 'Failed to validate device mapping' });
    }
  });

  /**
   * POST /api/device-mappings/migrate
   * Trigger migration of all room entity mappings to device-level storage.
   */
  router.post('/migrate', async (_req, res) => {
    try {
      const summary = await migrationService.migrateAllOnStartup();
      return res.json({ summary });
    } catch (error) {
      logger.error({ error }, 'Failed to run migration');
      return res.status(500).json({ message: 'Failed to run migration' });
    }
  });

  /**
   * GET /api/device-mappings/migrate/dry-run
   * Preview what would be migrated without actually doing it.
   */
  router.get('/migrate/dry-run', async (_req, res) => {
    try {
      const summary = await migrationService.dryRunMigration();
      return res.json({ summary });
    } catch (error) {
      logger.error({ error }, 'Failed to run migration dry-run');
      return res.status(500).json({ message: 'Failed to run migration dry-run' });
    }
  });

  return router;
};

/**
 * Fetch unit_of_measurement from Home Assistant for tracking coordinate entities.
 * This is needed to handle imperial unit conversion (inches -> mm).
 */
async function fetchEntityUnits(
  flatMappings: Record<string, string>,
  readTransport: IHaReadTransport
): Promise<Record<string, string>> {
  const entityUnits: Record<string, string> = {};

  // Keys that represent coordinate/distance measurements needing unit conversion
  const coordinateKeys = [
    'target1X', 'target1Y', 'target2X', 'target2Y', 'target3X', 'target3Y',
    'target1Distance', 'target2Distance', 'target3Distance',
    'distance', 'maxDistance',
  ];

  const entityIdsToFetch: Array<{ key: string; entityId: string }> = [];

  for (const key of coordinateKeys) {
    const entityId = flatMappings[key];
    if (entityId) {
      entityIdsToFetch.push({ key, entityId });
    }
  }

  if (entityIdsToFetch.length === 0) {
    return entityUnits;
  }

  try {
    // Batch fetch all entity states
    const states = await readTransport.getStates(entityIdsToFetch.map(e => e.entityId));

    for (const { key, entityId } of entityIdsToFetch) {
      const state = states.get(entityId);
      if (state?.attributes?.unit_of_measurement) {
        const unit = state.attributes.unit_of_measurement as string;
        entityUnits[key] = unit;
        logger.debug({ key, entityId, unit }, 'Captured entity unit of measurement');
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to fetch entity units - proceeding without unit metadata');
  }

  return entityUnits;
}
