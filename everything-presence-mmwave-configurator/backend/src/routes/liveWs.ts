import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { logger } from '../logger';
import type { IHaReadTransport, EntityState } from '../ha/readTransport';
import type { DeviceProfileLoader } from '../domain/deviceProfiles';
import type { EntityMappings } from '../domain/types';
import { EntityResolver } from '../domain/entityResolver';
import { deviceEntityService } from '../domain/deviceEntityService';
import { deviceMappingStorage } from '../config/deviceMappingStorage';

interface LiveClientSubscription {
  ws: WebSocket;
  deviceId: string;
  profileId: string;
  entityIds: Set<string>;
  entityKeysById: Map<string, string>;
  subscriptionId: string;
}

export function createLiveWebSocketServer(
  httpServer: Server,
  readTransport: IHaReadTransport,
  profileLoader: DeviceProfileLoader,
): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: '/api/live/ws' });
  const clients: Map<WebSocket, LiveClientSubscription> = new Map();

  wss.on('connection', (ws: WebSocket) => {
    logger.info('Live tracking WebSocket client connected');

    ws.on('message', async (data: string) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === 'subscribe') {
          const { deviceId, profileId, entityMappings } = message;

          if (!deviceId || !profileId) {
            ws.send(JSON.stringify({ type: 'error', error: 'deviceId and profileId required' }));
            return;
          }

          const profile = profileLoader.getProfileById(profileId);
          if (!profile) {
            ws.send(JSON.stringify({ type: 'error', error: 'Profile not found' }));
            return;
          }

          // Parse entityMappings if provided (could be string or object)
          let parsedMappings: EntityMappings | undefined;
          if (entityMappings) {
            if (typeof entityMappings === 'string') {
              try {
                parsedMappings = JSON.parse(entityMappings);
              } catch {
                logger.warn('Invalid entityMappings JSON in WebSocket message');
              }
            } else {
              parsedMappings = entityMappings as EntityMappings;
            }
          }

          const hasDeviceMapping = deviceMappingStorage.hasMapping(deviceId);
          const hasMappings = hasDeviceMapping || !!parsedMappings;
          if (!hasMappings) {
            ws.send(JSON.stringify({
              type: 'error',
              code: 'MAPPING_NOT_FOUND',
              message: 'No entity mappings found for this device. Run entity discovery to auto-match entities.',
              deviceId,
            }));
            return;
          }

          // Build list of entity IDs to monitor using EntityResolver
          const entityIds = new Set<string>();
          const entityKeysById = new Map<string, string>();
          const entityMap = profile.entityMap as any;

          // Helper to resolve entity ID - tries device mapping first, then room-stored mappings.
          const addEntity = (mappingKey: string, pattern: string | null | undefined) => {
            let entityId: string | null = null;
            // Try device-level mapping first
            if (hasDeviceMapping) {
              entityId = deviceEntityService.getEntityId(deviceId, mappingKey);
            }
            if (!entityId) {
              entityId = EntityResolver.resolve(parsedMappings, undefined, mappingKey, pattern);
            }
            if (entityId) {
              entityIds.add(entityId);
              entityKeysById.set(entityId, mappingKey);
            }
          };

          const addMappedEntity = (mappingKey: string) => {
            let entityId: string | null = null;
            if (hasDeviceMapping) {
              entityId = deviceEntityService.getEntityId(deviceId, mappingKey);
            } else {
              const mapped = (parsedMappings as Record<string, unknown> | undefined)?.[mappingKey];
              entityId = typeof mapped === 'string' ? mapped : null;
            }
            if (entityId) {
              entityIds.add(entityId);
              entityKeysById.set(entityId, mappingKey);
            }
          };

          // Add all relevant entities (using mapping key + template)
          addEntity('presenceEntity', entityMap.presenceEntity);
          addEntity('mmwaveEntity', entityMap.mmwaveEntity);
          addEntity('pirEntity', entityMap.pirEntity);
          addEntity('temperatureEntity', entityMap.temperatureEntity);
          addEntity('humidityEntity', entityMap.humidityEntity);
          addEntity('illuminanceEntity', entityMap.illuminanceEntity);
          addEntity('lightEntity', entityMap.lightEntity);
          addEntity('co2Entity', entityMap.co2Entity);

          // Distance tracking entities (EP1)
          addEntity('distanceEntity', entityMap.distanceEntity);
          addEntity('speedEntity', entityMap.speedEntity);
          addEntity('energyEntity', entityMap.energyEntity);
          addEntity('targetCountEntity', entityMap.targetCountEntity);
          addEntity('modeEntity', entityMap.modeEntity);

          // EP Lite tracking
          addEntity('trackingTargetCountEntity', entityMap.trackingTargetCountEntity);
          addEntity('trackingTargetsEntity', entityMap.trackingTargetsEntity);
          addEntity('maxDistanceEntity', entityMap.maxDistanceEntity);
          addEntity('installationAngleEntity', entityMap.installationAngleEntity);
          addEntity('upsideDownMountingEntity', entityMap.upsideDownMountingEntity);

          // EP1 config entities for distance overlays
          addEntity('distanceMaxEntity', entityMap.distanceMaxEntity);
          addEntity('triggerDistanceEntity', entityMap.triggerDistanceEntity);

          // Add zone-specific target count entities (for EP Lite zones 2, 3, 4)
          if (entityMap.zoneConfigEntities) {
            const zones = entityMap.zoneConfigEntities as Record<string, any>;
            Object.keys(zones).forEach((zoneKey) => {
              const zone = zones[zoneKey];
              if (zone.targetCountEntity) {
                // Use mapping key like "zoneConfigEntities.zone1.targetCountEntity"
                addEntity(`zoneConfigEntities.${zoneKey}.targetCountEntity`, zone.targetCountEntity);
              }
            });
          }

          // Zone target counts and occupancy - use device profile templates (supports EPL and EPP)
          const capabilities = profile.capabilities as any;
          const entities = profile.entities as Record<string, { template?: string }> | undefined;
          if (capabilities?.zones && entities) {
            for (let i = 1; i <= 4; i++) {
              // Use device profile templates for correct entity patterns per device type
              const zoneTargetCountKey = `zone${i}TargetCount`;
              const zoneOccupancyKey = `zone${i}Occupancy`;
              const targetCountTemplate = entities[zoneTargetCountKey]?.template;
              const occupancyTemplate = entities[zoneOccupancyKey]?.template;
              if (targetCountTemplate) {
                addEntity(zoneTargetCountKey, targetCountTemplate);
              }
              if (occupancyTemplate) {
                addMappedEntity(zoneOccupancyKey);
              }
            }
          }

          // Subscribe to target position entities (target_1, target_2, target_3).
          for (let i = 1; i <= 3; i++) {
            const targetProps: Array<'x' | 'y' | 'distance' | 'speed' | 'angle' | 'resolution' | 'active'> =
              ['x', 'y', 'distance', 'speed', 'angle', 'resolution', 'active'];

            // Try to get all target entities from device mapping first
            let targetSet = null;
            if (hasDeviceMapping) {
              targetSet = deviceEntityService.getTargetEntities(deviceId, i);
            }

            for (const prop of targetProps) {
              let entityId: string | null = null;
              // Try device mapping first
              if (targetSet && targetSet[prop]) {
                entityId = targetSet[prop] as string;
              }
              if (!entityId) {
                entityId = EntityResolver.resolveTargetEntity(parsedMappings, undefined, i, prop);
              }
              if (entityId) {
                entityIds.add(entityId);
              }
            }
          }

          // Subscribe to assumed presence entities (entry/exit feature) - use profile templates
          if (entities?.assumedPresent?.template) {
            addEntity('assumedPresent', entities.assumedPresent.template);
          }
          if (entities?.assumedPresentRemaining?.template) {
            addEntity('assumedPresentRemaining', entities.assumedPresentRemaining.template);
          }

          const existingSubscription = clients.get(ws);
          if (existingSubscription?.subscriptionId) {
            readTransport.unsubscribe(existingSubscription.subscriptionId);
          }

          const subscriptionId = `${deviceId}-${Date.now()}`;
          const stateSubscriptionId = readTransport.subscribeToStateChanges(
            Array.from(entityIds),
            (entityId: string, newState: EntityState | null, _oldState: EntityState | null) => {
              if (!entityId || !newState || ws.readyState !== WebSocket.OPEN) return;

              const entityKey = entityKeysById.get(entityId);
              try {
                ws.send(
                  JSON.stringify({
                    type: 'state_update',
                    entityKey,
                    entityId,
                    state: newState.state,
                    attributes: newState.attributes,
                    timestamp: Date.now(),
                  }),
                );
              } catch (err) {
                logger.error({ err, entityId, deviceId }, 'Failed to send state update to client');
              }
            },
          );

          clients.set(ws, {
            ws,
            deviceId,
            profileId,
            entityIds,
            entityKeysById,
            subscriptionId: stateSubscriptionId || subscriptionId,
          });

          logger.info(
            { deviceId, profileId, entityCount: entityIds.size },
            'Client subscribed to live tracking'
          );

          // Send initial states using read transport bulk query
          try {
            const entityIdArray = Array.from(entityIds);
            const initialStates = await readTransport.getStates(entityIdArray);

            // Send subscription confirmation with initial states
            const initialStateData: Record<string, { state: string; attributes: Record<string, unknown> }> = {};
            initialStates.forEach((state, entityId) => {
              initialStateData[entityId] = {
                state: state.state,
                attributes: state.attributes,
              };
            });

            ws.send(
              JSON.stringify({
                type: 'subscribed',
                deviceId,
                profileId,
                entities: entityIdArray,
                initialStates: initialStateData,
                hasMappings,
              }),
            );
          } catch (err) {
            logger.error({ err }, 'Failed to send initial states');
            // Still send subscription confirmation even if initial states fail
            ws.send(
              JSON.stringify({
                type: 'subscribed',
                deviceId,
                profileId,
                entities: Array.from(entityIds),
                hasMappings,
              }),
            );
          }
        } else if (message.type === 'unsubscribe') {
          const subscription = clients.get(ws);
          if (subscription?.subscriptionId) {
            readTransport.unsubscribe(subscription.subscriptionId);
          }
          clients.delete(ws);
          logger.info('Client unsubscribed from live tracking');
        }
      } catch (err) {
        logger.error({ err }, 'Failed to process WebSocket message');
        ws.send(JSON.stringify({ type: 'error', error: 'Invalid message format' }));
      }
    });

    ws.on('close', () => {
      const subscription = clients.get(ws);
      if (subscription?.subscriptionId) {
        readTransport.unsubscribe(subscription.subscriptionId);
      }
      clients.delete(ws);
      logger.info('Live tracking WebSocket client disconnected');
    });

    ws.on('error', (err) => {
      logger.error({ err }, 'WebSocket client error');
      const subscription = clients.get(ws);
      if (subscription?.subscriptionId) {
        readTransport.unsubscribe(subscription.subscriptionId);
      }
      clients.delete(ws);
    });
  });

  return wss;
}
