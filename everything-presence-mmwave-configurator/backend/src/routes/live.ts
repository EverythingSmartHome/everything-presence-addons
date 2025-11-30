import { Router } from 'express';
import { logger } from '../logger';
import type { IHaReadTransport } from '../ha/readTransport';
import type { IHaWriteClient } from '../ha/writeClient';
import type { DeviceProfileLoader } from '../domain/deviceProfiles';
import type { EntityMappings } from '../domain/types';
import { EntityResolver } from '../domain/entityResolver';
import { deviceEntityService } from '../domain/deviceEntityService';
import { deviceMappingStorage } from '../config/deviceMappingStorage';

export function createLiveRouter(
  readTransport: IHaReadTransport,
  writeClient: IHaWriteClient,
  profileLoader: DeviceProfileLoader
): Router {
  const router = Router();

  /**
   * GET /api/live/:deviceId/state
   * Get current live state for a device (presence, distance, target count, etc.)
   * Query params: profileId (required), entityNamePrefix (optional), entityMappings (optional JSON)
   */
  router.get('/:deviceId/state', async (req, res) => {
    try {
      const { deviceId } = req.params;
      const { profileId, entityNamePrefix, entityMappings: entityMappingsJson } = req.query;

      if (!deviceId) {
        return res.status(400).json({ error: 'deviceId required' });
      }

      const profile = profileId ? profileLoader.getProfileById(profileId as string) : null;
      if (!profile) {
        return res.status(404).json({ error: 'Profile not found' });
      }

      // Use entityNamePrefix if provided, otherwise try to extract from deviceId
      const deviceName = (entityNamePrefix as string) ||
        deviceId.replace(/^(sensor|binary_sensor|number)\./, '').replace(/_occupancy$|_mmwave_target_distance$/, '');

      if (!deviceName) {
        return res.status(400).json({ error: 'Could not determine entity name prefix' });
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

      // Check if device has device-level mappings (preferred)
      const hasDeviceMapping = deviceMappingStorage.hasMapping(deviceId);
      const hasMappings = hasDeviceMapping || !!entityMappings;

      // Log warning if no mappings found
      if (!hasMappings) {
        logger.warn({ deviceId, profileId }, 'No device mappings found - entity resolution may fail');
      }

      const liveState: any = {
        deviceId,
        profileId: profile.id,
        timestamp: Date.now(),
        hasMappings, // Signal to frontend whether mappings are available
      };

      // Helper to get entity state by pattern - tries device mapping first, then legacy
      const getEntityState = async (mappingKey: string, template: string | null) => {
        // Try device-level mapping first (preferred)
        let entityId: string | null = null;
        if (hasDeviceMapping) {
          entityId = deviceEntityService.getEntityId(deviceId, mappingKey);
        }
        // Fallback to legacy resolution
        if (!entityId) {
          entityId = EntityResolver.resolve(entityMappings, deviceName, mappingKey, template);
        }
        if (!entityId) return null;
        try {
          const state = await readTransport.getState(entityId);
          return state;
        } catch (err) {
          // Entity might not exist
          return null;
        }
      };

      const entityMap = profile.entityMap as any;

      const capabilities = profile.capabilities as any;

      // Presence states
      if (entityMap.presenceEntity) {
        const presenceState = await getEntityState('presenceEntity', entityMap.presenceEntity);
        liveState.presence = presenceState?.state === 'on';
      }

      if (entityMap.mmwaveEntity) {
        const mmwaveState = await getEntityState('mmwaveEntity', entityMap.mmwaveEntity);
        liveState.mmwave = mmwaveState?.state === 'on';
      }

      if (capabilities?.sensors?.pir && entityMap.pirEntity) {
        const pirState = await getEntityState('pirEntity', entityMap.pirEntity);
        liveState.pir = pirState?.state === 'on';
      }

      // Environmental sensors (EP1)
      if (capabilities?.sensors?.temperature && entityMap.temperatureEntity) {
        const tempState = await getEntityState('temperatureEntity', entityMap.temperatureEntity);
        liveState.temperature = tempState ? parseFloat(tempState.state) : null;
      }

      if (capabilities?.sensors?.humidity && entityMap.humidityEntity) {
        const humidityState = await getEntityState('humidityEntity', entityMap.humidityEntity);
        liveState.humidity = humidityState ? parseFloat(humidityState.state) : null;
      }

      if (capabilities?.sensors?.illuminance && entityMap.illuminanceEntity) {
        const illuminanceState = await getEntityState('illuminanceEntity', entityMap.illuminanceEntity);
        liveState.illuminance = illuminanceState ? parseFloat(illuminanceState.state) : null;
      }

      // Distance tracking (EP1)
      if (capabilities?.distanceOnlyTracking && entityMap.distanceEntity) {
        const distanceState = await getEntityState('distanceEntity', entityMap.distanceEntity);
        liveState.distance = distanceState ? parseFloat(distanceState.state) : null;

        // Additional distance mode data
        if (entityMap.speedEntity) {
          const speedState = await getEntityState('speedEntity', entityMap.speedEntity);
          liveState.speed = speedState ? parseFloat(speedState.state) : null;
        }

        if (entityMap.energyEntity) {
          const energyState = await getEntityState('energyEntity', entityMap.energyEntity);
          liveState.energy = energyState ? parseInt(energyState.state, 10) : null;
        }

        if (entityMap.targetCountEntity) {
          const targetCountState = await getEntityState('targetCountEntity', entityMap.targetCountEntity);
          liveState.targetCount = targetCountState ? parseInt(targetCountState.state, 10) : 0;
        }
      }

      // Target count for EP Lite
      if (capabilities?.tracking && entityMap.trackingTargetCountEntity) {
        const targetCountState = await getEntityState('trackingTargetCountEntity', entityMap.trackingTargetCountEntity);
        liveState.targetCount = targetCountState ? parseInt(targetCountState.state, 10) : 0;
      }

      // Fetch initial target positions for EP Lite (tracking devices)
      if (capabilities?.tracking) {
        const targets: any[] = [];

        // Helper to get target entity state - tries device mapping first, then legacy
        const getTargetState = async (targetNum: number, property: 'x' | 'y' | 'speed' | 'resolution' | 'angle' | 'distance' | 'active') => {
          let entityId: string | null = null;
          // Try device-level mapping first
          if (hasDeviceMapping) {
            const targetSet = deviceEntityService.getTargetEntities(deviceId, targetNum);
            if (targetSet && targetSet[property]) {
              entityId = targetSet[property] as string;
            }
          }
          // Fallback to legacy resolution
          if (!entityId) {
            entityId = EntityResolver.resolveTargetEntity(entityMappings, deviceName, targetNum, property);
          }
          if (!entityId) return null;
          try {
            const state = await readTransport.getState(entityId);
            return state;
          } catch (err) {
            return null;
          }
        };

        // Fetch up to 3 targets
        for (let i = 1; i <= 3; i++) {
          const target: any = { id: i, x: null, y: null };

          // Fetch active status
          const activeState = await getTargetState(i, 'active');
          if (activeState) {
            target.active = activeState.state === 'on';
          }

          // Fetch coordinates
          const xState = await getTargetState(i, 'x');
          if (xState && xState.state !== 'unavailable' && xState.state !== 'unknown') {
            target.x = parseFloat(xState.state);
            if (isNaN(target.x)) target.x = null;
          }

          const yState = await getTargetState(i, 'y');
          if (yState && yState.state !== 'unavailable' && yState.state !== 'unknown') {
            target.y = parseFloat(yState.state);
            if (isNaN(target.y)) target.y = null;
          }

          // Fetch additional target data
          const distanceState = await getTargetState(i, 'distance');
          if (distanceState && distanceState.state !== 'unavailable' && distanceState.state !== 'unknown') {
            target.distance = parseFloat(distanceState.state);
            if (isNaN(target.distance)) target.distance = null;
          }

          const speedState = await getTargetState(i, 'speed');
          if (speedState && speedState.state !== 'unavailable' && speedState.state !== 'unknown') {
            target.speed = parseFloat(speedState.state);
            if (isNaN(target.speed)) target.speed = null;
          }

          const angleState = await getTargetState(i, 'angle');
          if (angleState && angleState.state !== 'unavailable' && angleState.state !== 'unknown') {
            target.angle = parseFloat(angleState.state);
            if (isNaN(target.angle)) target.angle = null;
          }

          const resolutionState = await getTargetState(i, 'resolution');
          if (resolutionState && resolutionState.state !== 'unavailable' && resolutionState.state !== 'unknown') {
            target.resolution = parseFloat(resolutionState.state);
            if (isNaN(target.resolution)) target.resolution = null;
          }

          // Only add target if it has any data (active status or coordinates)
          if (target.active !== undefined || target.x !== null || target.y !== null) {
            targets.push(target);
          }
        }

        if (targets.length > 0) {
          liveState.targets = targets;
        }
      }

      // Max distance for EPL (tracking devices)
      if (capabilities?.tracking && entityMap.maxDistanceEntity) {
        const config: any = liveState.config || {};
        const maxDistanceState = await getEntityState('maxDistanceEntity', entityMap.maxDistanceEntity);
        config.distanceMax = maxDistanceState ? parseFloat(maxDistanceState.state) : null;
        liveState.config = config;
      }

      // Installation angle for EPL (tracking devices)
      if (capabilities?.tracking && entityMap.installationAngleEntity) {
        const config: any = liveState.config || {};
        const installationAngleState = await getEntityState('installationAngleEntity', entityMap.installationAngleEntity);
        config.installationAngle = installationAngleState ? parseFloat(installationAngleState.state) : 0;
        liveState.config = config;
      }

      // Configuration entities (EP1)
      if (capabilities?.distanceOnlyTracking) {
        const config: any = {};

        if (entityMap.modeEntity) {
          const modeState = await getEntityState('modeEntity', entityMap.modeEntity);
          config.mode = modeState?.state || null;
        }

        if (entityMap.distanceMinEntity) {
          const minState = await getEntityState('distanceMinEntity', entityMap.distanceMinEntity);
          config.distanceMin = minState ? parseFloat(minState.state) : null;
        }

        if (entityMap.distanceMaxEntity) {
          const maxState = await getEntityState('distanceMaxEntity', entityMap.distanceMaxEntity);
          config.distanceMax = maxState ? parseFloat(maxState.state) : null;
        }

        if (entityMap.triggerDistanceEntity) {
          const triggerState = await getEntityState('triggerDistanceEntity', entityMap.triggerDistanceEntity);
          config.triggerDistance = triggerState ? parseFloat(triggerState.state) : null;
        }

        if (entityMap.sensitivityEntity) {
          const sensState = await getEntityState('sensitivityEntity', entityMap.sensitivityEntity);
          config.sensitivity = sensState ? parseInt(sensState.state, 10) : null;
        }

        if (entityMap.triggerSensitivityEntity) {
          const triggerSensState = await getEntityState('triggerSensitivityEntity', entityMap.triggerSensitivityEntity);
          config.triggerSensitivity = triggerSensState ? parseInt(triggerSensState.state, 10) : null;
        }

        if (entityMap.offLatencyEntity) {
          const offLatencyState = await getEntityState('offLatencyEntity', entityMap.offLatencyEntity);
          config.offLatency = offLatencyState ? parseInt(offLatencyState.state, 10) : null;
        }

        if (entityMap.onLatencyEntity) {
          const onLatencyState = await getEntityState('onLatencyEntity', entityMap.onLatencyEntity);
          config.onLatency = onLatencyState ? parseInt(onLatencyState.state, 10) : null;
        }

        if (entityMap.thresholdFactorEntity) {
          const thresholdState = await getEntityState('thresholdFactorEntity', entityMap.thresholdFactorEntity);
          config.thresholdFactor = thresholdState ? parseInt(thresholdState.state, 10) : null;
        }

        if (entityMap.microMotionEntity) {
          const microMotionState = await getEntityState('microMotionEntity', entityMap.microMotionEntity);
          config.microMotionEnabled = microMotionState?.state === 'on';
        }

        if (entityMap.updateRateEntity) {
          const updateRateState = await getEntityState('updateRateEntity', entityMap.updateRateEntity);
          config.updateRate = updateRateState?.state || null;
        }

        liveState.config = config;
      }

      // Fetch assumed presence status for EPL (tracking devices with entry/exit feature)
      if (capabilities?.tracking) {
        try {
          const assumedPresentEntityId = `binary_sensor.${deviceName}_assumed_present`;
          const assumedPresentState = await readTransport.getState(assumedPresentEntityId);
          if (assumedPresentState && assumedPresentState.state !== 'unavailable' && assumedPresentState.state !== 'unknown') {
            liveState.assumedPresent = assumedPresentState.state === 'on';
          }
        } catch (err) {
          // Entity might not exist
        }

        try {
          const assumedPresentRemainingEntityId = `sensor.${deviceName}_assumed_present_remaining`;
          const assumedPresentRemainingState = await readTransport.getState(assumedPresentRemainingEntityId);
          if (assumedPresentRemainingState && assumedPresentRemainingState.state !== 'unavailable' && assumedPresentRemainingState.state !== 'unknown') {
            const value = parseFloat(assumedPresentRemainingState.state);
            if (!isNaN(value)) {
              liveState.assumedPresentRemaining = value;
            }
          }
        } catch (err) {
          // Entity might not exist
        }
      }

      res.json({ state: liveState });
    } catch (err) {
      logger.error({ err }, 'Failed to get live state');
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  /**
   * POST /api/live/:deviceId/entity
   * Update a device entity value (e.g., change mode, set distance)
   * Body: { entityId: string, value: string | number | boolean }
   */
  router.post('/:deviceId/entity', async (req, res) => {
    try {
      const { deviceId } = req.params;
      const { entityId, value } = req.body;

      if (!deviceId || !entityId || value === undefined) {
        return res.status(400).json({ error: 'deviceId, entityId, and value are required' });
      }

      logger.info({ deviceId, entityId, value }, 'Updating device entity');

      // Determine the service to call based on entity type
      const [domain] = entityId.split('.');

      // Use write client convenience methods based on domain
      switch (domain) {
        case 'select':
          await writeClient.setSelectEntity(entityId, value as string);
          break;
        case 'number':
          await writeClient.setNumberEntity(entityId, value as number);
          break;
        case 'switch':
          await writeClient.setSwitchEntity(entityId, value as boolean);
          break;
        case 'input_boolean':
          await writeClient.setInputBooleanEntity(entityId, value as boolean);
          break;
        default:
          return res.status(400).json({ error: `Unsupported entity domain: ${domain}` });
      }

      res.json({ success: true });
    } catch (err) {
      logger.error({ err }, 'Failed to update entity');
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  /**
   * GET /api/live/ha/states/:entityId
   * Get current state of a specific HA entity
   * Uses wildcard to capture full entity_id (e.g., number.device_max_distance)
   */
  router.get('/ha/states/:entityId(*)', async (req, res) => {
    try {
      const { entityId } = req.params;

      if (!entityId) {
        return res.status(400).json({ error: 'entityId required' });
      }

      const state = await readTransport.getState(entityId);

      if (!state) {
        return res.status(404).json({ error: 'Entity not found' });
      }

      res.json(state);
    } catch (err) {
      logger.error({ err }, 'Failed to get entity state');
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  return router;
}
