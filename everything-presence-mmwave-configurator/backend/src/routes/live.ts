import { Router } from 'express';
import { logger } from '../logger';
import type { IHaReadTransport } from '../ha/readTransport';
import type { IHaWriteClient } from '../ha/writeClient';
import type { DeviceProfileLoader } from '../domain/deviceProfiles';

export function createLiveRouter(
  readTransport: IHaReadTransport,
  writeClient: IHaWriteClient,
  profileLoader: DeviceProfileLoader
): Router {
  const router = Router();

  /**
   * GET /api/live/:deviceId/state
   * Get current live state for a device (presence, distance, target count, etc.)
   * Query params: profileId (required), entityNamePrefix (optional, will use deviceId as fallback)
   */
  router.get('/:deviceId/state', async (req, res) => {
    try {
      const { deviceId } = req.params;
      const { profileId, entityNamePrefix } = req.query;

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

      const liveState: any = {
        deviceId,
        profileId: profile.id,
        timestamp: Date.now(),
      };

      // Helper to get entity state by pattern
      const getEntityState = async (pattern: string | null) => {
        if (!pattern) return null;
        try {
          const entityId = pattern.replace('${name}', deviceName);
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
        const presenceState = await getEntityState(entityMap.presenceEntity);
        liveState.presence = presenceState?.state === 'on';
      }

      if (entityMap.mmwaveEntity) {
        const mmwaveState = await getEntityState(entityMap.mmwaveEntity);
        liveState.mmwave = mmwaveState?.state === 'on';
      }

      if (capabilities?.sensors?.pir && entityMap.pirEntity) {
        const pirState = await getEntityState(entityMap.pirEntity);
        liveState.pir = pirState?.state === 'on';
      }

      // Environmental sensors (EP1)
      if (capabilities?.sensors?.temperature && entityMap.temperatureEntity) {
        const tempState = await getEntityState(entityMap.temperatureEntity);
        liveState.temperature = tempState ? parseFloat(tempState.state) : null;
      }

      if (capabilities?.sensors?.humidity && entityMap.humidityEntity) {
        const humidityState = await getEntityState(entityMap.humidityEntity);
        liveState.humidity = humidityState ? parseFloat(humidityState.state) : null;
      }

      if (capabilities?.sensors?.illuminance && entityMap.illuminanceEntity) {
        const illuminanceState = await getEntityState(entityMap.illuminanceEntity);
        liveState.illuminance = illuminanceState ? parseFloat(illuminanceState.state) : null;
      }

      // Distance tracking (EP1)
      if (capabilities?.distanceOnlyTracking && entityMap.distanceEntity) {
        const distanceState = await getEntityState(entityMap.distanceEntity);
        liveState.distance = distanceState ? parseFloat(distanceState.state) : null;

        // Additional distance mode data
        if (entityMap.speedEntity) {
          const speedState = await getEntityState(entityMap.speedEntity);
          liveState.speed = speedState ? parseFloat(speedState.state) : null;
        }

        if (entityMap.energyEntity) {
          const energyState = await getEntityState(entityMap.energyEntity);
          liveState.energy = energyState ? parseInt(energyState.state, 10) : null;
        }

        if (entityMap.targetCountEntity) {
          const targetCountState = await getEntityState(entityMap.targetCountEntity);
          liveState.targetCount = targetCountState ? parseInt(targetCountState.state, 10) : 0;
        }
      }

      // Target count for EP Lite
      if (capabilities?.tracking && entityMap.trackingTargetCountEntity) {
        const targetCountState = await getEntityState(entityMap.trackingTargetCountEntity);
        liveState.targetCount = targetCountState ? parseInt(targetCountState.state, 10) : 0;
      }

      // Fetch initial target positions for EP Lite (tracking devices)
      if (capabilities?.tracking) {
        const targets: any[] = [];

        // Fetch up to 3 targets
        for (let i = 1; i <= 3; i++) {
          const target: any = { id: i, x: null, y: null };

          // Fetch active status
          try {
            const activeEntityId = `binary_sensor.${deviceName}_target_${i}_active`;
            const activeState = await readTransport.getState(activeEntityId);
            target.active = activeState?.state === 'on';
          } catch (err) {
            // Entity might not exist
          }

          // Fetch coordinates
          try {
            const xEntityId = `sensor.${deviceName}_target_${i}_x`;
            const xState = await readTransport.getState(xEntityId);
            if (xState && xState.state !== 'unavailable' && xState.state !== 'unknown') {
              target.x = parseFloat(xState.state);
              if (isNaN(target.x)) target.x = null;
            }
          } catch (err) {
            // Entity might not exist
          }

          try {
            const yEntityId = `sensor.${deviceName}_target_${i}_y`;
            const yState = await readTransport.getState(yEntityId);
            if (yState && yState.state !== 'unavailable' && yState.state !== 'unknown') {
              target.y = parseFloat(yState.state);
              if (isNaN(target.y)) target.y = null;
            }
          } catch (err) {
            // Entity might not exist
          }

          // Fetch additional target data
          try {
            const distanceEntityId = `sensor.${deviceName}_target_${i}_distance`;
            const distanceState = await readTransport.getState(distanceEntityId);
            if (distanceState && distanceState.state !== 'unavailable' && distanceState.state !== 'unknown') {
              target.distance = parseFloat(distanceState.state);
              if (isNaN(target.distance)) target.distance = null;
            }
          } catch (err) {
            // Entity might not exist
          }

          try {
            const speedEntityId = `sensor.${deviceName}_target_${i}_speed`;
            const speedState = await readTransport.getState(speedEntityId);
            if (speedState && speedState.state !== 'unavailable' && speedState.state !== 'unknown') {
              target.speed = parseFloat(speedState.state);
              if (isNaN(target.speed)) target.speed = null;
            }
          } catch (err) {
            // Entity might not exist
          }

          try {
            const angleEntityId = `sensor.${deviceName}_target_${i}_angle`;
            const angleState = await readTransport.getState(angleEntityId);
            if (angleState && angleState.state !== 'unavailable' && angleState.state !== 'unknown') {
              target.angle = parseFloat(angleState.state);
              if (isNaN(target.angle)) target.angle = null;
            }
          } catch (err) {
            // Entity might not exist
          }

          try {
            const resolutionEntityId = `sensor.${deviceName}_target_${i}_resolution`;
            const resolutionState = await readTransport.getState(resolutionEntityId);
            if (resolutionState && resolutionState.state !== 'unavailable' && resolutionState.state !== 'unknown') {
              target.resolution = parseFloat(resolutionState.state);
              if (isNaN(target.resolution)) target.resolution = null;
            }
          } catch (err) {
            // Entity might not exist
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
        const maxDistanceState = await getEntityState(entityMap.maxDistanceEntity);
        config.distanceMax = maxDistanceState ? parseFloat(maxDistanceState.state) : null;
        liveState.config = config;
      }

      // Installation angle for EPL (tracking devices)
      if (capabilities?.tracking && entityMap.installationAngleEntity) {
        const config: any = liveState.config || {};
        const installationAngleState = await getEntityState(entityMap.installationAngleEntity);
        config.installationAngle = installationAngleState ? parseFloat(installationAngleState.state) : 0;
        liveState.config = config;
      }

      // Configuration entities (EP1)
      if (capabilities?.distanceOnlyTracking) {
        const config: any = {};

        if (entityMap.modeEntity) {
          const modeState = await getEntityState(entityMap.modeEntity);
          config.mode = modeState?.state || null;
        }

        if (entityMap.distanceMinEntity) {
          const minState = await getEntityState(entityMap.distanceMinEntity);
          config.distanceMin = minState ? parseFloat(minState.state) : null;
        }

        if (entityMap.distanceMaxEntity) {
          const maxState = await getEntityState(entityMap.distanceMaxEntity);
          config.distanceMax = maxState ? parseFloat(maxState.state) : null;
        }

        if (entityMap.triggerDistanceEntity) {
          const triggerState = await getEntityState(entityMap.triggerDistanceEntity);
          config.triggerDistance = triggerState ? parseFloat(triggerState.state) : null;
        }

        if (entityMap.sensitivityEntity) {
          const sensState = await getEntityState(entityMap.sensitivityEntity);
          config.sensitivity = sensState ? parseInt(sensState.state, 10) : null;
        }

        if (entityMap.triggerSensitivityEntity) {
          const triggerSensState = await getEntityState(entityMap.triggerSensitivityEntity);
          config.triggerSensitivity = triggerSensState ? parseInt(triggerSensState.state, 10) : null;
        }

        if (entityMap.offLatencyEntity) {
          const offLatencyState = await getEntityState(entityMap.offLatencyEntity);
          config.offLatency = offLatencyState ? parseInt(offLatencyState.state, 10) : null;
        }

        if (entityMap.onLatencyEntity) {
          const onLatencyState = await getEntityState(entityMap.onLatencyEntity);
          config.onLatency = onLatencyState ? parseInt(onLatencyState.state, 10) : null;
        }

        if (entityMap.thresholdFactorEntity) {
          const thresholdState = await getEntityState(entityMap.thresholdFactorEntity);
          config.thresholdFactor = thresholdState ? parseInt(thresholdState.state, 10) : null;
        }

        if (entityMap.microMotionEntity) {
          const microMotionState = await getEntityState(entityMap.microMotionEntity);
          config.microMotionEnabled = microMotionState?.state === 'on';
        }

        if (entityMap.updateRateEntity) {
          const updateRateState = await getEntityState(entityMap.updateRateEntity);
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
