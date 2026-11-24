import { IHaWriteClient } from './writeClient';
import { ZoneRect, ZonePolygon, EntityMappings } from '../domain/types';
import { isValidPolygon, polygonToText } from '../domain/polygonUtils';
import { EntityResolver } from '../domain/entityResolver';
import { deviceEntityService } from '../domain/deviceEntityService';
import { logger } from '../logger';
import { zoneSlotFromId } from '../domain/zoneSlots';

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

interface ZoneWriteTask {
  execute: () => Promise<unknown>;
  description: string;
  entityId?: string;
}

export interface ZoneWriteFailure {
  entityId?: string;
  description: string;
  error: string;
}

export interface ZoneWriteResult {
  ok: boolean;
  failures: ZoneWriteFailure[];
}

type PolygonEntityType = 'polygon' | 'polygonExclusion' | 'polygonEntry';
type PolygonGroupKey = 'polygonZoneEntities' | 'polygonExclusionEntities' | 'polygonEntryEntities';

/**
 * Polygon zone groups in write order. Slot labels match the entity names users
 * see in device settings (e.g. "Polygon Zone 1").
 */
const POLYGON_GROUPS: ReadonlyArray<{
  zoneType: ZonePolygon['type'];
  entityType: PolygonEntityType;
  groupKey: PolygonGroupKey;
  keyPrefix: string;
  minSlots: number;
  slotLabel: string;
  taskLabel: string;
}> = [
  { zoneType: 'regular', entityType: 'polygon', groupKey: 'polygonZoneEntities', keyPrefix: 'zone', minSlots: 4, slotLabel: 'Polygon Zone', taskLabel: 'polygon zone' },
  { zoneType: 'exclusion', entityType: 'polygonExclusion', groupKey: 'polygonExclusionEntities', keyPrefix: 'exclusion', minSlots: 2, slotLabel: 'Polygon Exclusion', taskLabel: 'exclusion polygon' },
  { zoneType: 'entry', entityType: 'polygonEntry', groupKey: 'polygonEntryEntities', keyPrefix: 'entry', minSlots: 2, slotLabel: 'Polygon Entry', taskLabel: 'entry polygon' },
];

export class ZoneWriter {
  private readonly writeClient: IHaWriteClient;

  constructor(writeClient: IHaWriteClient) {
    this.writeClient = writeClient;
  }

  /**
   * Execute tasks sequentially with retry logic and delays.
   * This helps with opening too many requests to HA all at once
   */
  private async executeTasksSequentially(
    tasks: ZoneWriteTask[],
    options: { delayMs?: number; maxRetries?: number; continueOnError?: boolean } = {}
  ): Promise<ZoneWriteFailure[]> {
    const { delayMs = 50, maxRetries = 2, continueOnError = true } = options;
    const failures: ZoneWriteFailure[] = [];

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
        failures.push({
          entityId: task.entityId,
          description: task.description,
          error: lastError.message,
        });
        if (!continueOnError) {
          throw lastError;
        }
      }

      // Small delay between successful tasks to prevent overwhelming the device
      if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    return failures;
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
    entityNamePrefix: string | undefined,
    entityMappings?: EntityMappings,
    deviceId?: string
  ): Promise<ZoneWriteResult> {
    const tasks: ZoneWriteTask[] = [];
    // User zones that could not be written at all (no mapped entity or invalid shape).
    // These fail the save; otherwise the zone silently disappears from the device.
    const skippedFailures: ZoneWriteFailure[] = [];

    logger.debug({ entityNamePrefix, deviceId, zoneCount: zones.length, hasMappings: !!entityMappings }, 'Applying polygon zones');

    // Helper to resolve polygon entity
    const resolvePolygon = (type: PolygonEntityType, index: number, groupKey: PolygonGroupKey, key: string, template?: string): string | null => {
      if (deviceId) {
        const entityId = deviceEntityService.getPolygonZoneEntity(deviceId, type, index);
        if (entityId) return entityId;
      }
      return EntityResolver.resolvePolygonZoneEntity(entityMappings, entityNamePrefix, groupKey, key, template);
    };

    for (const group of POLYGON_GROUPS) {
      const typedZones = zones.filter(z => z.type === group.zoneType);
      const hasGroup = Boolean(entityMap?.[group.groupKey]) || Boolean(deviceId);
      const polyMap: Record<string, string> = entityMap?.[group.groupKey] || {};
      const maxSlots = Math.max(Object.keys(polyMap).length, group.minSlots);
      const claimedSlots = new Set<number>();

      // Write user zones. Each zone goes to the slot named by its id ("Entry 2" -> entry slot 2).
      typedZones.forEach((zone) => {
        const slot = zoneSlotFromId(zone.id);
        if (slot === null) {
          logger.warn({ zoneId: zone.id, type: zone.type }, 'Polygon zone id has no slot number; zone not saved');
          skippedFailures.push({
            description: `${zone.id} could not be saved: the zone id has no ${group.slotLabel} slot number`,
            error: 'INVALID_ZONE_ID',
          });
          return;
        }
        if (slot < 1 || slot > maxSlots) {
          logger.warn({ zoneId: zone.id, slot, maxSlots }, `${group.slotLabel} slot out of range; zone not saved`);
          skippedFailures.push({
            description: slot < 1
              ? `${zone.id} could not be saved: ${group.slotLabel} slots are numbered 1 to ${maxSlots}`
              : `${zone.id} could not be saved: this device has only ${maxSlots} ${group.slotLabel} slots`,
            error: 'ZONE_SLOT_OUT_OF_RANGE',
          });
          return;
        }
        if (claimedSlots.has(slot)) {
          logger.warn({ zoneId: zone.id, slot }, `Another zone already uses ${group.slotLabel} ${slot}; zone not saved`);
          skippedFailures.push({
            description: `${zone.id} could not be saved: another zone already uses ${group.slotLabel} ${slot}`,
            error: 'DUPLICATE_ZONE_SLOT',
          });
          return;
        }
        claimedSlots.add(slot);

        const key = `${group.keyPrefix}${slot}`;
        const entityId = hasGroup ? resolvePolygon(group.entityType, slot, group.groupKey, key, polyMap[key]) : null;
        if (!entityId) {
          logger.warn({ zoneId: zone.id, slot, deviceId }, `No ${group.slotLabel} ${slot} entity is mapped; zone not saved`);
          skippedFailures.push({
            description: `${zone.id} could not be saved: no ${group.slotLabel} ${slot} entity is mapped for this device`,
            error: 'ENTITY_NOT_MAPPED',
          });
          return;
        }
        if (!isValidPolygon(zone.vertices)) {
          logger.warn({ entityId, zoneId: zone.id, vertices: zone.vertices.length }, `Skipping ${group.taskLabel} with fewer than 3 distinct vertices`);
          skippedFailures.push({
            entityId,
            description: `${zone.id} could not be saved: the polygon needs at least 3 distinct points`,
            error: 'INVALID_POLYGON',
          });
          return;
        }
        const textValue = polygonToText(zone.vertices);
        logger.debug({ entityId, vertices: zone.vertices.length }, `Setting ${group.taskLabel}`);
        tasks.push({
          execute: () => this.writeClient.setTextEntity(entityId, textValue),
          description: `${group.taskLabel} ${slot}`,
          entityId,
        });
      });

      if (!hasGroup) continue;

      // Clear slots no user zone claimed. Unresolved slots are skipped silently: there is nothing to clear.
      for (let slot = 1; slot <= maxSlots; slot++) {
        if (claimedSlots.has(slot)) continue;
        const key = `${group.keyPrefix}${slot}`;
        const entityId = resolvePolygon(group.entityType, slot, group.groupKey, key, polyMap[key]);
        if (entityId) {
          tasks.push({
            execute: () => this.writeClient.setTextEntity(entityId, ''),
            description: `clear ${group.taskLabel} ${slot}`,
            entityId,
          });
        }
      }
    }

    logger.info({ taskCount: tasks.length, skippedZones: skippedFailures.length }, 'Executing polygon zone updates sequentially');
    const failures = [...skippedFailures, ...(await this.executeTasksSequentially(tasks))];
    return { ok: failures.length === 0, failures };
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
    entityNamePrefix: string | undefined,
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
    entityNamePrefix: string | undefined,
    entityMappings?: EntityMappings,
    deviceId?: string
  ): Promise<ZoneWriteResult> {
    const tasks: ZoneWriteTask[] = [];

    logger.debug({ entityNamePrefix, deviceId, zoneCount: zones.length, hasMappings: !!entityMappings }, 'Applying rectangular zones');

    const regularZones = zones.filter(z => z.type === 'regular');
    const exclusionZones = zones.filter(z => z.type === 'exclusion');
    const entryZones = zones.filter(z => z.type === 'entry');

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
          if (zoneEntitySet.beginX) updates.push({ entity: zoneEntitySet.beginX, value: zone.x });
          if (zoneEntitySet.endX) updates.push({ entity: zoneEntitySet.endX, value: zone.x + zone.width });
          if (zoneEntitySet.beginY) updates.push({ entity: zoneEntitySet.beginY, value: zone.y });
          if (zoneEntitySet.endY) updates.push({ entity: zoneEntitySet.endY, value: zone.y + zone.height });
          if (zoneEntitySet.offDelay && typeof zone.timeout === 'number') {
            updates.push({ entity: zoneEntitySet.offDelay, value: zone.timeout });
          }
        } else {
          // Clear unused zone slot by setting all coordinates to 0
          if (zoneEntitySet.beginX) updates.push({ entity: zoneEntitySet.beginX, value: 0 });
          if (zoneEntitySet.endX) updates.push({ entity: zoneEntitySet.endX, value: 0 });
          if (zoneEntitySet.beginY) updates.push({ entity: zoneEntitySet.beginY, value: 0 });
          if (zoneEntitySet.endY) updates.push({ entity: zoneEntitySet.endY, value: 0 });
        }

        updates.forEach(({ entity, value }) => {
          tasks.push({
            execute: () => this.writeClient.setNumberEntity(entity, value),
            description: `regular zone ${i} ${entity}`,
            entityId: entity,
          });
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
          tasks.push({
            execute: () => this.writeClient.setNumberEntity(entity, value),
            description: `exclusion zone ${i} ${entity}`,
            entityId: entity,
          });
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
          tasks.push({
            execute: () => this.writeClient.setNumberEntity(entity, value),
            description: `entry zone ${i} ${entity}`,
            entityId: entity,
          });
        });
      }
    }

    logger.info({ taskCount: tasks.length }, 'Executing zone updates');
    const results = await Promise.allSettled(tasks.map((task) => task.execute()));
    const failures: ZoneWriteFailure[] = [];
    results.forEach((result, idx) => {
      if (result.status === 'rejected') {
        const error = result.reason instanceof Error ? result.reason.message : String(result.reason);
        failures.push({
          entityId: tasks[idx].entityId,
          description: tasks[idx].description,
          error,
        });
      }
    });

    return { ok: failures.length === 0, failures };
  }
}
