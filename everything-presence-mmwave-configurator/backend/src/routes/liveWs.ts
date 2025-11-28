import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { logger } from '../logger';
import type { IHaReadTransport, EntityState } from '../ha/readTransport';
import type { DeviceProfileLoader } from '../domain/deviceProfiles';

interface LiveClientSubscription {
  ws: WebSocket;
  deviceId: string;
  profileId: string;
  entityIds: Set<string>;
  subscriptionId: string;
}

export function createLiveWebSocketServer(
  httpServer: Server,
  readTransport: IHaReadTransport,
  profileLoader: DeviceProfileLoader,
): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: '/api/live/ws' });
  const clients: Map<WebSocket, LiveClientSubscription> = new Map();

  // Subscribe to HA state changes
  readTransport.subscribeToStateChanges(
    [], // Empty = subscribe to all entities
    (entityId: string, newState: EntityState | null, _oldState: EntityState | null) => {
      if (!entityId || !newState) return;

      // Broadcast to clients subscribed to this entity
      clients.forEach((subscription, clientWs) => {
        if (subscription.entityIds.has(entityId) && clientWs.readyState === WebSocket.OPEN) {
          try {
            clientWs.send(
              JSON.stringify({
                type: 'state_update',
                entityId,
                state: newState.state,
                attributes: newState.attributes,
                timestamp: Date.now(),
              }),
            );
          } catch (err) {
            logger.error({ err, entityId }, 'Failed to send state update to client');
          }
        }
      });
    }
  );

  wss.on('connection', (ws: WebSocket) => {
    logger.info('Live tracking WebSocket client connected');

    ws.on('message', async (data: string) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === 'subscribe') {
          const { deviceId, profileId, entityNamePrefix } = message;

          if (!deviceId || !profileId) {
            ws.send(JSON.stringify({ type: 'error', error: 'deviceId and profileId required' }));
            return;
          }

          const profile = profileLoader.getProfileById(profileId);
          if (!profile) {
            ws.send(JSON.stringify({ type: 'error', error: 'Profile not found' }));
            return;
          }

          // Use entityNamePrefix if provided, otherwise try to extract from deviceId
          const deviceName = entityNamePrefix ||
            deviceId
              .replace(/^(sensor|binary_sensor|number)\./, '')
              .replace(/_occupancy$|_mmwave_target_distance$/, '');

          if (!deviceName) {
            ws.send(JSON.stringify({ type: 'error', error: 'Could not determine entity name prefix' }));
            return;
          }

          // Build list of entity IDs to monitor
          const entityIds = new Set<string>();
          const entityMap = profile.entityMap as any;

          const addEntity = (pattern: string | null | undefined) => {
            if (pattern) {
              const entityId = pattern.replace('${name}', deviceName);
              entityIds.add(entityId);
            }
          };

          // Add all relevant entities
          addEntity(entityMap.presenceEntity);
          addEntity(entityMap.mmwaveEntity);
          addEntity(entityMap.pirEntity);
          addEntity(entityMap.temperatureEntity);
          addEntity(entityMap.humidityEntity);
          addEntity(entityMap.illuminanceEntity);
          addEntity(entityMap.lightEntity);
          addEntity(entityMap.co2Entity);

          // Distance tracking entities (EP1)
          addEntity(entityMap.distanceEntity);
          addEntity(entityMap.speedEntity);
          addEntity(entityMap.energyEntity);
          addEntity(entityMap.targetCountEntity);
          addEntity(entityMap.modeEntity);

          // EP Lite tracking
          addEntity(entityMap.trackingTargetCountEntity);
          addEntity(entityMap.trackingTargetsEntity);
          addEntity(entityMap.maxDistanceEntity);
          addEntity(entityMap.installationAngleEntity);

          // EP1 config entities for distance overlays
          addEntity(entityMap.distanceMaxEntity);
          addEntity(entityMap.triggerDistanceEntity);

          // Add zone-specific target count entities (for EP Lite zones 2, 3, 4)
          if (entityMap.zoneConfigEntities) {
            const zones = entityMap.zoneConfigEntities as Record<string, any>;
            Object.keys(zones).forEach((zoneKey) => {
              const zone = zones[zoneKey];
              if (zone.targetCountEntity) {
                addEntity(zone.targetCountEntity);
              }
            });
          }

          // Zone target counts (EP Lite)
          const capabilities = profile.capabilities as any;
          if (capabilities?.zones) {
            for (let i = 1; i <= 4; i++) {
              addEntity(`sensor.\${name}_zone_${i}_target_count`);
              addEntity(`binary_sensor.\${name}_zone_${i}_occupancy`);
            }
          }

          // Subscribe to target position entities (target_1, target_2, target_3)
          for (let i = 1; i <= 3; i++) {
            addEntity(`sensor.\${name}_target_${i}_x`);
            addEntity(`sensor.\${name}_target_${i}_y`);
            addEntity(`sensor.\${name}_target_${i}_distance`);
            addEntity(`sensor.\${name}_target_${i}_speed`);
            addEntity(`sensor.\${name}_target_${i}_angle`);
            addEntity(`sensor.\${name}_target_${i}_resolution`);
            addEntity(`binary_sensor.\${name}_target_${i}_active`);
          }

          // Subscribe to assumed presence entities (entry/exit feature)
          addEntity(`binary_sensor.\${name}_assumed_present`);
          addEntity(`sensor.\${name}_assumed_present_remaining`);

          // Store subscription
          const subscriptionId = `${deviceId}-${Date.now()}`;
          clients.set(ws, {
            ws,
            deviceId,
            profileId,
            entityIds,
            subscriptionId,
          });

          logger.info({ deviceId, profileId, entityCount: entityIds.size }, 'Client subscribed to live tracking');

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
              }),
            );
          }
        } else if (message.type === 'unsubscribe') {
          clients.delete(ws);
          logger.info('Client unsubscribed from live tracking');
        }
      } catch (err) {
        logger.error({ err }, 'Failed to process WebSocket message');
        ws.send(JSON.stringify({ type: 'error', error: 'Invalid message format' }));
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      logger.info('Live tracking WebSocket client disconnected');
    });

    ws.on('error', (err) => {
      logger.error({ err }, 'WebSocket client error');
      clients.delete(ws);
    });
  });

  return wss;
}
