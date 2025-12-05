import { IHaWriteClient } from './writeClient';
import { ZoneRect, ZonePolygon, EntityMappings } from '../domain/types';
import { polygonToText } from '../domain/polygonUtils';
import { EntityResolver } from '../domain/entityResolver';
import { deviceEntityService } from '../domain/deviceEntityService';
import { logger } from '../logger';

interface ZoneEntityConfig {
  beginX?: string | null;
  endX?: string | null;
  beginY?: string | null;
  endY?: string | null;
  offDelay?: string | null;
}

interface ZoneEntityMap {
  [zoneKey: string]: ZoneEntityConfig;
}

export class ZoneWriter {
  private readonly writeClient: IHaWriteClient;

  constructor(writeClient: IHaWriteClient) {
    this.writeClient = writeClient;
  }

  /**
   * Execute tasks sequentially with retry logic and delays.
   * This prevents overwhelming ESPHome devices, especially when targets are being tracked.
   */
  private async executeTasksSequentially(
    tasks: Array<{ execute: () => Promise<unknown>; description: string }>,
    options: { delayMs?: number; maxRetries?: number } = {}
  ): Promise<void> {
    const { delayMs = 50, maxRetries = 2 } = options;

    for (const task of tasks) {
      let lastError: Error | null = null;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          await task.execute();
          lastError = null;
          break;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          if (attempt < maxRetries) {
            logger.warn({ description: task.description, attempt: attempt + 1, maxRetries }, 'Task failed, retrying...');
            // Exponential backoff: 100ms, 200ms, 400ms...
            await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, attempt)));
          }
        }
      }

      if (lastError) {
        logger.error({ description: task.description, error: lastError.message }, 'Task failed after retries');
        throw lastError;
      }

      // Small delay between successful tasks to prevent overwhelming the device
      if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  /**
   * Extract zone index from zone ID (e.g., "Zone 3" -> 3, "Entry 1" -> 1)
   */
  private extractZoneIndex(id: string): number {
    const match = id.match(/\d+$/);
    return match ? parseInt(match[0], 10) : 0;
  }

  /**
   * Write polygon zones to device text entities.
   * @param entityMap - Profile entity template map
   * @param zones - Zones to write
   * @param entityNamePrefix - Legacy entity name prefix (for fallback)
   * @param entityMappings - Discovered entity mappings (preferred, optional)
   * @param deviceId - Device ID for device-level mapping lookup (preferred, optional)
   */
  async applyPolygonZones(
    entityMap: any,
    zones: ZonePolygon[],
    entityNamePrefix: string,
    entityMappings?: EntityMappings,
    deviceId?: string
  ): Promise<void> {
    const tasks: Array<{ execute: () => Promise<unknown>; description: string }> = [];

    logger.debug({ entityNamePrefix, deviceId, zoneCount: zones.length, hasMappings: !!entityMappings }, 'Applying polygon zones');

    const regularZones = zones.filter(z => z.type === 'regular');
    const exclusionZones = zones.filter(z => z.type === 'exclusion');
    const entryZones = zones.filter(z => z.type === 'entry');

    // Helper to resolve polygon entity
    const resolvePolygon = (type: 'polygon' | 'polygonExclusion' | 'polygonEntry', index: number, groupKey: 'polygonZoneEntities' | 'polygonExclusionEntities' | 'polygonEntryEntities', key: string, template?: string): string | null => {
      if (deviceId) {
        const entityId = deviceEntityService.getPolygonZoneEntity(deviceId, type, index);
        if (entityId) return entityId;
      }
      return EntityResolver.resolvePolygonZoneEntity(entityMappings, entityNamePrefix, groupKey, key, template);
    };

    // Regular polygon zones
    if (entityMap.polygonZoneEntities || deviceId) {
      const polyMap = entityMap.polygonZoneEntities || {};
      regularZones.forEach((zone, idx) => {
        const key = `zone${idx + 1}`;
        const entityId = resolvePolygon('polygon', idx + 1, 'polygonZoneEntities', key, polyMap[key]);
        if (entityId) {
          const textValue = polygonToText(zone.vertices);
          logger.debug({ entityId, vertices: zone.vertices.length }, 'Setting polygon zone');
          tasks.push({
            execute: () => this.writeClient.setTextEntity(entityId, textValue),
            description: `polygon zone ${idx + 1}`,
          });
        }
      });

      // Clear unused slots
      const maxZones = Math.max(Object.keys(polyMap).length, 4);
      for (let i = regularZones.length; i < maxZones; i++) {
        const key = `zone${i + 1}`;
        const entityId = resolvePolygon('polygon', i + 1, 'polygonZoneEntities', key, polyMap[key]);
        if (entityId) {
          tasks.push({
            execute: () => this.writeClient.setTextEntity(entityId, ''),
            description: `clear polygon zone ${i + 1}`,
          });
        }
      }
    }

    // Exclusion polygon zones
    if (entityMap.polygonExclusionEntities || deviceId) {
      const polyMap = entityMap.polygonExclusionEntities || {};
      exclusionZones.forEach((zone, idx) => {
        const key = `exclusion${idx + 1}`;
        const entityId = resolvePolygon('polygonExclusion', idx + 1, 'polygonExclusionEntities', key, polyMap[key]);
        if (entityId) {
          const textValue = polygonToText(zone.vertices);
          logger.debug({ entityId, vertices: zone.vertices.length }, 'Setting exclusion polygon');
          tasks.push({
            execute: () => this.writeClient.setTextEntity(entityId, textValue),
            description: `exclusion polygon ${idx + 1}`,
          });
        }
      });

      const maxExclusions = Math.max(Object.keys(polyMap).length, 2);
      for (let i = exclusionZones.length; i < maxExclusions; i++) {
        const key = `exclusion${i + 1}`;
        const entityId = resolvePolygon('polygonExclusion', i + 1, 'polygonExclusionEntities', key, polyMap[key]);
        if (entityId) {
          tasks.push({
            execute: () => this.writeClient.setTextEntity(entityId, ''),
            description: `clear exclusion polygon ${i + 1}`,
          });
        }
      }
    }

    // Entry polygon zones
    if (entityMap.polygonEntryEntities || deviceId) {
      const polyMap = entityMap.polygonEntryEntities || {};
      entryZones.forEach((zone, idx) => {
        const key = `entry${idx + 1}`;
        const entityId = resolvePolygon('polygonEntry', idx + 1, 'polygonEntryEntities', key, polyMap[key]);
        if (entityId) {
          const textValue = polygonToText(zone.vertices);
          logger.debug({ entityId, vertices: zone.vertices.length }, 'Setting entry polygon');
          tasks.push({
            execute: () => this.writeClient.setTextEntity(entityId, textValue),
            description: `entry polygon ${idx + 1}`,
          });
        }
      });

      const maxEntries = Math.max(Object.keys(polyMap).length, 2);
      for (let i = entryZones.length; i < maxEntries; i++) {
        const key = `entry${i + 1}`;
        const entityId = resolvePolygon('polygonEntry', i + 1, 'polygonEntryEntities', key, polyMap[key]);
        if (entityId) {
          tasks.push({
            execute: () => this.writeClient.setTextEntity(entityId, ''),
            description: `clear entry polygon ${i + 1}`,
          });
        }
      }
    }

    logger.info({ taskCount: tasks.length }, 'Executing polygon zone updates sequentially');
    await this.executeTasksSequentially(tasks);
  }

  /**
   * Toggle polygon zone mode on the device.
   * @param entityMap - Profile entity template map
   * @param entityNamePrefix - Legacy entity name prefix (for fallback)
   * @param enabled - Whether to enable or disable polygon mode
   * @param entityMappings - Discovered entity mappings (preferred, optional)
   * @param deviceId - Device ID for device-level mapping lookup (preferred, optional)
   */
  async setPolygonMode(
    entityMap: any,
    entityNamePrefix: string,
    enabled: boolean,
    entityMappings?: EntityMappings,
    deviceId?: string
  ): Promise<void> {
    const entityTemplate = entityMap?.polygonZonesEnabledEntity;
    if (!entityTemplate && !entityMappings?.polygonZonesEnabledEntity && !deviceId) {
      logger.debug('No polygon mode entity configured');
      return;
    }

    // Try device-level mapping first
    let entityId: string | null = null;
    if (deviceId) {
      entityId = deviceEntityService.getEntityId(deviceId, 'polygonZonesEnabled');
    }
    if (!entityId) {
      entityId = EntityResolver.resolve(
        entityMappings,
        entityNamePrefix,
        'polygonZonesEnabledEntity',
        entityTemplate
      );
    }

    if (!entityId) {
      logger.debug('Could not resolve polygon mode entity');
      return;
    }

    logger.info({ entityId, enabled, usedDeviceMapping: !!deviceId }, 'Setting polygon mode');
    await this.writeClient.setSwitchEntity(entityId, enabled);
  }

  /**
   * Write rectangular zones to device number entities.
   * Zones are matched by their ID (e.g., "Zone 3" writes to zone3 entities).
   * Unused zone slots are cleared by setting coordinates to 0.
   * @param zoneMap - Profile entity template map
   * @param zones - Zones to write
   * @param entityNamePrefix - Legacy entity name prefix (for fallback)
   * @param entityMappings - Discovered entity mappings (preferred, optional)
   * @param deviceId - Device ID for device-level mapping lookup (preferred, optional)
   */
  async applyZones(
    zoneMap: any,
    zones: ZoneRect[],
    entityNamePrefix: string,
    entityMappings?: EntityMappings,
    deviceId?: string
  ): Promise<void> {
    const tasks: Promise<unknown>[] = [];

    logger.debug({ entityNamePrefix, deviceId, zoneCount: zones.length, hasMappings: !!entityMappings }, 'Applying rectangular zones');

    const regularZones = zones.filter(z => z.type === 'regular');
    const exclusionZones = zones.filter(z => z.type === 'exclusion');
    const entryZones = zones.filter(z => z.type === 'entry');

    // Debug: Log all zones being written with their types and coordinates
    logger.info({
      regularZones: regularZones.map(z => ({ id: z.id, type: z.type, x: z.x, y: z.y, width: z.width, height: z.height })),
      exclusionZones: exclusionZones.map(z => ({ id: z.id, type: z.type, x: z.x, y: z.y, width: z.width, height: z.height })),
      entryZones: entryZones.map(z => ({ id: z.id, type: z.type, x: z.x, y: z.y, width: z.width, height: z.height })),
    }, 'Zone write: zones grouped by type');

    // Helper to resolve zone entity set
    const resolveZone = (type: 'regular' | 'exclusion' | 'entry', index: number, groupKey: 'zoneConfigEntities' | 'exclusionZoneConfigEntities' | 'entryZoneConfigEntities', key: string, mapping?: any) => {
      if (deviceId) {
        const zoneSet = deviceEntityService.getZoneEntitySet(deviceId, type, index);
        if (zoneSet) return zoneSet;
      }
      return EntityResolver.resolveZoneEntitySet(entityMappings, entityNamePrefix, groupKey, key, mapping);
    };

    // Regular zones - write active zones and clear unused slots
    if (zoneMap.zoneConfigEntities || deviceId) {
      const regularMap = zoneMap.zoneConfigEntities || {};
      const maxZones = Math.max(Object.keys(regularMap).length, 4);

      for (let i = 1; i <= maxZones; i++) {
        const key = `zone${i}`;
        const mapping = regularMap[key];
        if (!mapping && !deviceId) continue;

        const zoneEntitySet = resolveZone('regular', i, 'zoneConfigEntities', key, mapping);
        if (!zoneEntitySet) continue;

        // Find zone by its ID index (e.g., "Zone 3" matches slot 3)
        const zone = regularZones.find(z => this.extractZoneIndex(z.id) === i);
        const updates: Array<{ entity: string; value: number }> = [];

        if (zone) {
          // Write zone coordinates
          logger.info({
            zoneType: 'regular',
            slot: i,
            zoneId: zone.id,
            zoneTypeField: zone.type,
            coords: { x: zone.x, y: zone.y, width: zone.width, height: zone.height },
            entities: { beginX: zoneEntitySet.beginX, endX: zoneEntitySet.endX, beginY: zoneEntitySet.beginY, endY: zoneEntitySet.endY },
          }, 'Zone write: writing regular zone to slot');
          if (zoneEntitySet.beginX) updates.push({ entity: zoneEntitySet.beginX, value: zone.x });
          if (zoneEntitySet.endX) updates.push({ entity: zoneEntitySet.endX, value: zone.x + zone.width });
          if (zoneEntitySet.beginY) updates.push({ entity: zoneEntitySet.beginY, value: zone.y });
          if (zoneEntitySet.endY) updates.push({ entity: zoneEntitySet.endY, value: zone.y + zone.height });
          if (zoneEntitySet.offDelay) updates.push({ entity: zoneEntitySet.offDelay, value: 15 });
        } else {
          // Clear unused zone slot by setting all coordinates to 0
          if (zoneEntitySet.beginX) updates.push({ entity: zoneEntitySet.beginX, value: 0 });
          if (zoneEntitySet.endX) updates.push({ entity: zoneEntitySet.endX, value: 0 });
          if (zoneEntitySet.beginY) updates.push({ entity: zoneEntitySet.beginY, value: 0 });
          if (zoneEntitySet.endY) updates.push({ entity: zoneEntitySet.endY, value: 0 });
        }

        updates.forEach(({ entity, value }) => {
          tasks.push(this.writeClient.setNumberEntity(entity, value));
        });
      }
    }

    // Exclusion zones - write active zones and clear unused slots
    if (zoneMap.exclusionZoneConfigEntities || deviceId) {
      const exclusionMap = zoneMap.exclusionZoneConfigEntities || {};
      const maxExclusions = Math.max(Object.keys(exclusionMap).length, 2);

      for (let i = 1; i <= maxExclusions; i++) {
        const key = `exclusion${i}`;
        const mapping = exclusionMap[key];
        if (!mapping && !deviceId) continue;

        const zoneEntitySet = resolveZone('exclusion', i, 'exclusionZoneConfigEntities', key, mapping);
        if (!zoneEntitySet) continue;

        // Find zone by its ID index
        const zone = exclusionZones.find(z => this.extractZoneIndex(z.id) === i);
        const updates: Array<{ entity: string; value: number }> = [];

        if (zone) {
          if (zoneEntitySet.beginX) updates.push({ entity: zoneEntitySet.beginX, value: zone.x });
          if (zoneEntitySet.endX) updates.push({ entity: zoneEntitySet.endX, value: zone.x + zone.width });
          if (zoneEntitySet.beginY) updates.push({ entity: zoneEntitySet.beginY, value: zone.y });
          if (zoneEntitySet.endY) updates.push({ entity: zoneEntitySet.endY, value: zone.y + zone.height });
        } else {
          // Clear unused exclusion zone slot
          if (zoneEntitySet.beginX) updates.push({ entity: zoneEntitySet.beginX, value: 0 });
          if (zoneEntitySet.endX) updates.push({ entity: zoneEntitySet.endX, value: 0 });
          if (zoneEntitySet.beginY) updates.push({ entity: zoneEntitySet.beginY, value: 0 });
          if (zoneEntitySet.endY) updates.push({ entity: zoneEntitySet.endY, value: 0 });
        }

        updates.forEach(({ entity, value }) => {
          tasks.push(this.writeClient.setNumberEntity(entity, value));
        });
      }
    }

    // Entry zones - write active zones and clear unused slots
    if (zoneMap.entryZoneConfigEntities || deviceId) {
      const entryMap = zoneMap.entryZoneConfigEntities || {};
      const maxEntries = Math.max(Object.keys(entryMap).length, 2);

      for (let i = 1; i <= maxEntries; i++) {
        const key = `entry${i}`;
        const mapping = entryMap[key];
        if (!mapping && !deviceId) continue;

        const zoneEntitySet = resolveZone('entry', i, 'entryZoneConfigEntities', key, mapping);
        if (!zoneEntitySet) continue;

        // Find zone by its ID index
        const zone = entryZones.find(z => this.extractZoneIndex(z.id) === i);
        const updates: Array<{ entity: string; value: number }> = [];

        if (zone) {
          logger.info({
            zoneType: 'entry',
            slot: i,
            zoneId: zone.id,
            zoneTypeField: zone.type,
            coords: { x: zone.x, y: zone.y, width: zone.width, height: zone.height },
            entities: { beginX: zoneEntitySet.beginX, endX: zoneEntitySet.endX, beginY: zoneEntitySet.beginY, endY: zoneEntitySet.endY },
          }, 'Zone write: writing entry zone to slot');
          if (zoneEntitySet.beginX) updates.push({ entity: zoneEntitySet.beginX, value: zone.x });
          if (zoneEntitySet.endX) updates.push({ entity: zoneEntitySet.endX, value: zone.x + zone.width });
          if (zoneEntitySet.beginY) updates.push({ entity: zoneEntitySet.beginY, value: zone.y });
          if (zoneEntitySet.endY) updates.push({ entity: zoneEntitySet.endY, value: zone.y + zone.height });
        } else {
          // Clear unused entry zone slot
          if (zoneEntitySet.beginX) updates.push({ entity: zoneEntitySet.beginX, value: 0 });
          if (zoneEntitySet.endX) updates.push({ entity: zoneEntitySet.endX, value: 0 });
          if (zoneEntitySet.beginY) updates.push({ entity: zoneEntitySet.beginY, value: 0 });
          if (zoneEntitySet.endY) updates.push({ entity: zoneEntitySet.endY, value: 0 });
        }

        updates.forEach(({ entity, value }) => {
          tasks.push(this.writeClient.setNumberEntity(entity, value));
        });
      }
    }

    logger.info({ taskCount: tasks.length }, 'Executing zone updates');
    await Promise.all(tasks);
  }
}
