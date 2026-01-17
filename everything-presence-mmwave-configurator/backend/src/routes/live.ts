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

      const normalizeState = (state?: string | null) => (typeof state === 'string' ? state.toLowerCase() : null);
      const isUnavailableState = (state?: string | null) => {
        if (state === null || state === undefined) return true;
        const normalized = normalizeState(state);
        return normalized === 'unavailable' || normalized === 'unknown';
      };

      const markAvailability = (key: string, state: { state: string } | null) => {
        if (!state) return;
        if (!liveState.availability) {
          liveState.availability = {};
        }
        liveState.availability[key] = isUnavailableState(state.state) ? 'unavailable' : 'ok';
      };

      const parseNumberState = (state: { state: string } | null): number | null => {
        if (!state || isUnavailableState(state.state)) return null;
        const value = parseFloat(state.state);
        return Number.isFinite(value) ? value : null;
      };

      const parseIntState = (state: { state: string } | null): number | null => {
        if (!state || isUnavailableState(state.state)) return null;
        const value = parseInt(state.state, 10);
        return Number.isFinite(value) ? value : null;
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
        if (presenceState) {
          markAvailability('presence', presenceState);
          if (!isUnavailableState(presenceState.state)) {
            liveState.presence = presenceState.state === 'on';
          }
        }
      }

      if (entityMap.mmwaveEntity) {
        const mmwaveState = await getEntityState('mmwaveEntity', entityMap.mmwaveEntity);
        if (mmwaveState) {
          markAvailability('mmwave', mmwaveState);
          if (!isUnavailableState(mmwaveState.state)) {
            liveState.mmwave = mmwaveState.state === 'on';
          }
        }
      }

      if (capabilities?.sensors?.pir && entityMap.pirEntity) {
        const pirState = await getEntityState('pirEntity', entityMap.pirEntity);
        if (pirState) {
          markAvailability('pir', pirState);
          if (!isUnavailableState(pirState.state)) {
            liveState.pir = pirState.state === 'on';
          }
        }
      }

      // Environmental sensors (EP1)
      if (capabilities?.sensors?.temperature && entityMap.temperatureEntity) {
        const tempState = await getEntityState('temperatureEntity', entityMap.temperatureEntity);
        markAvailability('temperature', tempState);
        liveState.temperature = parseNumberState(tempState);
      }

      if (capabilities?.sensors?.humidity && entityMap.humidityEntity) {
        const humidityState = await getEntityState('humidityEntity', entityMap.humidityEntity);
        markAvailability('humidity', humidityState);
        liveState.humidity = parseNumberState(humidityState);
      }

      if (capabilities?.sensors?.illuminance && entityMap.illuminanceEntity) {
        const illuminanceState = await getEntityState('illuminanceEntity', entityMap.illuminanceEntity);
        markAvailability('illuminance', illuminanceState);
        liveState.illuminance = parseNumberState(illuminanceState);
      }

      // Distance tracking (EP1)
      if (capabilities?.distanceOnlyTracking && entityMap.distanceEntity) {
        const distanceState = await getEntityState('distanceEntity', entityMap.distanceEntity);
        markAvailability('distance', distanceState);
        liveState.distance = parseNumberState(distanceState);

        // Additional distance mode data
        if (entityMap.speedEntity) {
          const speedState = await getEntityState('speedEntity', entityMap.speedEntity);
          markAvailability('speed', speedState);
          liveState.speed = parseNumberState(speedState);
        }

        if (entityMap.energyEntity) {
          const energyState = await getEntityState('energyEntity', entityMap.energyEntity);
          markAvailability('energy', energyState);
          liveState.energy = parseIntState(energyState);
        }

        if (entityMap.targetCountEntity) {
          const targetCountState = await getEntityState('targetCountEntity', entityMap.targetCountEntity);
          markAvailability('targetCount', targetCountState);
          const count = parseIntState(targetCountState);
          liveState.targetCount = count ?? 0;
        }
      }

      // Target count for EP Lite
      if (capabilities?.tracking && entityMap.trackingTargetCountEntity) {
        const targetCountState = await getEntityState('trackingTargetCountEntity', entityMap.trackingTargetCountEntity);
        markAvailability('targetCount', targetCountState);
        const count = parseIntState(targetCountState);
        liveState.targetCount = count ?? 0;
      }

      // Fetch initial target positions for EP Lite (tracking devices)
      if (capabilities?.tracking) {
        const targets: any[] = [];

        // Helper to convert imperial units to mm
        const convertToMm = (value: number, unit: string | undefined): number => {
          if (!unit) return value;
          const unitLower = unit.toLowerCase();
          // Convert inches to mm (1 inch = 25.4 mm)
          if (unitLower === 'in' || unitLower === 'inch' || unitLower === 'inches' || unitLower === '"') {
            return value * 25.4;
          }
          // Convert feet to mm (1 foot = 304.8 mm)
          if (unitLower === 'ft' || unitLower === 'foot' || unitLower === 'feet' || unitLower === "'") {
            return value * 304.8;
          }
          // Convert cm to mm
          if (unitLower === 'cm') {
            return value * 10;
          }
          // Convert m to mm
          if (unitLower === 'm') {
            return value * 1000;
          }
          return value;
        };

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

          // Fetch coordinates with unit conversion
          const xState = await getTargetState(i, 'x');
          if (xState && !isUnavailableState(xState.state)) {
            let x = parseFloat(xState.state);
            if (!isNaN(x)) {
              // Convert to mm if unit is imperial
              x = convertToMm(x, xState.attributes?.unit_of_measurement as string | undefined);
              target.x = x;
            }
          }

          const yState = await getTargetState(i, 'y');
          if (yState && !isUnavailableState(yState.state)) {
            let y = parseFloat(yState.state);
            if (!isNaN(y)) {
              // Convert to mm if unit is imperial
              y = convertToMm(y, yState.attributes?.unit_of_measurement as string | undefined);
              target.y = y;
            }
          }

          // Fetch additional target data with unit conversion for distance
          const distanceState = await getTargetState(i, 'distance');
          if (distanceState && !isUnavailableState(distanceState.state)) {
            let distance = parseFloat(distanceState.state);
            if (!isNaN(distance)) {
              distance = convertToMm(distance, distanceState.attributes?.unit_of_measurement as string | undefined);
              target.distance = distance;
            }
          }

          const speedState = await getTargetState(i, 'speed');
          if (speedState && !isUnavailableState(speedState.state)) {
            target.speed = parseFloat(speedState.state);
            if (isNaN(target.speed)) target.speed = null;
          }

          const angleState = await getTargetState(i, 'angle');
          if (angleState && !isUnavailableState(angleState.state)) {
            target.angle = parseFloat(angleState.state);
            if (isNaN(target.angle)) target.angle = null;
          }

          const resolutionState = await getTargetState(i, 'resolution');
          if (resolutionState && !isUnavailableState(resolutionState.state)) {
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
        markAvailability('distanceMax', maxDistanceState);
        config.distanceMax = parseNumberState(maxDistanceState);
        liveState.config = config;
      }

      // Installation angle for EPL (tracking devices)
      if (capabilities?.tracking && entityMap.installationAngleEntity) {
        const config: any = liveState.config || {};
        const installationAngleState = await getEntityState('installationAngleEntity', entityMap.installationAngleEntity);
        markAvailability('installationAngle', installationAngleState);
        const angle = parseNumberState(installationAngleState);
        config.installationAngle = angle ?? 0;
        liveState.config = config;
      }

      // Configuration entities (EP1)
      if (capabilities?.distanceOnlyTracking) {
        const config: any = {};

        if (entityMap.modeEntity) {
          const modeState = await getEntityState('modeEntity', entityMap.modeEntity);
          markAvailability('mode', modeState);
          config.mode = modeState && !isUnavailableState(modeState.state) ? modeState.state : null;
        }

        if (entityMap.distanceMinEntity) {
          const minState = await getEntityState('distanceMinEntity', entityMap.distanceMinEntity);
          markAvailability('distanceMin', minState);
          config.distanceMin = parseNumberState(minState);
        }

        if (entityMap.distanceMaxEntity) {
          const maxState = await getEntityState('distanceMaxEntity', entityMap.distanceMaxEntity);
          markAvailability('distanceMax', maxState);
          config.distanceMax = parseNumberState(maxState);
        }

        if (entityMap.triggerDistanceEntity) {
          const triggerState = await getEntityState('triggerDistanceEntity', entityMap.triggerDistanceEntity);
          markAvailability('triggerDistance', triggerState);
          config.triggerDistance = parseNumberState(triggerState);
        }

        if (entityMap.sensitivityEntity) {
          const sensState = await getEntityState('sensitivityEntity', entityMap.sensitivityEntity);
          markAvailability('sensitivity', sensState);
          config.sensitivity = parseIntState(sensState);
        }

        if (entityMap.triggerSensitivityEntity) {
          const triggerSensState = await getEntityState('triggerSensitivityEntity', entityMap.triggerSensitivityEntity);
          markAvailability('triggerSensitivity', triggerSensState);
          config.triggerSensitivity = parseIntState(triggerSensState);
        }

        if (entityMap.offLatencyEntity) {
          const offLatencyState = await getEntityState('offLatencyEntity', entityMap.offLatencyEntity);
          markAvailability('offLatency', offLatencyState);
          config.offLatency = parseIntState(offLatencyState);
        }

        if (entityMap.onLatencyEntity) {
          const onLatencyState = await getEntityState('onLatencyEntity', entityMap.onLatencyEntity);
          markAvailability('onLatency', onLatencyState);
          config.onLatency = parseIntState(onLatencyState);
        }

        if (entityMap.thresholdFactorEntity) {
          const thresholdState = await getEntityState('thresholdFactorEntity', entityMap.thresholdFactorEntity);
          markAvailability('thresholdFactor', thresholdState);
          config.thresholdFactor = parseIntState(thresholdState);
        }

        if (entityMap.microMotionEntity) {
          const microMotionState = await getEntityState('microMotionEntity', entityMap.microMotionEntity);
          markAvailability('microMotion', microMotionState);
          if (microMotionState && !isUnavailableState(microMotionState.state)) {
            config.microMotionEnabled = microMotionState.state === 'on';
          }
        }

        if (entityMap.updateRateEntity) {
          const updateRateState = await getEntityState('updateRateEntity', entityMap.updateRateEntity);
          markAvailability('updateRate', updateRateState);
          config.updateRate = updateRateState && !isUnavailableState(updateRateState.state) ? updateRateState.state : null;
        }

        liveState.config = config;
      }

      // Fetch assumed presence status for EPL (tracking devices with entry/exit feature) - use profile templates
      const entities = profile.entities as Record<string, { template?: string }> | undefined;
      if (capabilities?.tracking && entities) {
        // Use device profile templates for assumed_present entities
        const assumedPresentTemplate = entities.assumedPresent?.template;
        const assumedPresentRemainingTemplate = entities.assumedPresentRemaining?.template;

        if (assumedPresentTemplate) {
          const state = await getEntityState('assumedPresent', assumedPresentTemplate);
          if (state && !isUnavailableState(state.state)) {
            liveState.assumedPresent = state.state === 'on';
          }
        }

        if (assumedPresentRemainingTemplate) {
          const state = await getEntityState('assumedPresentRemaining', assumedPresentRemainingTemplate);
          if (state && !isUnavailableState(state.state)) {
            const value = parseFloat(state.state);
            if (!isNaN(value)) {
              liveState.assumedPresentRemaining = value;
            }
          }
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
