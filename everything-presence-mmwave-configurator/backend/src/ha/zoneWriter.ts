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
    const tasks: Promise<unknown>[] = [];

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
          tasks.push(this.writeClient.setTextEntity(entityId, textValue));
        }
      });

      // Clear unused slots
      const maxZones = Math.max(Object.keys(polyMap).length, 4);
      for (let i = regularZones.length; i < maxZones; i++) {
        const key = `zone${i + 1}`;
        const entityId = resolvePolygon('polygon', i + 1, 'polygonZoneEntities', key, polyMap[key]);
        if (entityId) {
          tasks.push(this.writeClient.setTextEntity(entityId, ''));
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
          tasks.push(this.writeClient.setTextEntity(entityId, textValue));
        }
      });

      const maxExclusions = Math.max(Object.keys(polyMap).length, 2);
      for (let i = exclusionZones.length; i < maxExclusions; i++) {
        const key = `exclusion${i + 1}`;
        const entityId = resolvePolygon('polygonExclusion', i + 1, 'polygonExclusionEntities', key, polyMap[key]);
        if (entityId) {
          tasks.push(this.writeClient.setTextEntity(entityId, ''));
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
          tasks.push(this.writeClient.setTextEntity(entityId, textValue));
        }
      });

      const maxEntries = Math.max(Object.keys(polyMap).length, 2);
      for (let i = entryZones.length; i < maxEntries; i++) {
        const key = `entry${i + 1}`;
        const entityId = resolvePolygon('polygonEntry', i + 1, 'polygonEntryEntities', key, polyMap[key]);
        if (entityId) {
          tasks.push(this.writeClient.setTextEntity(entityId, ''));
        }
      }
    }

    logger.info({ taskCount: tasks.length }, 'Executing polygon zone updates');
    await Promise.all(tasks);
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

    // Helper to resolve zone entity set
    const resolveZone = (type: 'regular' | 'exclusion' | 'entry', index: number, groupKey: 'zoneConfigEntities' | 'exclusionZoneConfigEntities' | 'entryZoneConfigEntities', key: string, mapping?: any) => {
      if (deviceId) {
        const zoneSet = deviceEntityService.getZoneEntitySet(deviceId, type, index);
        if (zoneSet) return zoneSet;
      }
      return EntityResolver.resolveZoneEntitySet(entityMappings, entityNamePrefix, groupKey, key, mapping);
    };

    // Regular zones
    if (zoneMap.zoneConfigEntities || deviceId) {
      const regularMap = zoneMap.zoneConfigEntities || {};
      regularZones.forEach((zone, idx) => {
        const key = `zone${idx + 1}`;
        const mapping = regularMap[key];
        if (!mapping && !deviceId) return;

        const zoneEntitySet = resolveZone('regular', idx + 1, 'zoneConfigEntities', key, mapping);
        if (!zoneEntitySet) return;

        const updates: Array<{ entity: string; value: number }> = [];
        if (zoneEntitySet.beginX) updates.push({ entity: zoneEntitySet.beginX, value: zone.x });
        if (zoneEntitySet.endX) updates.push({ entity: zoneEntitySet.endX, value: zone.x + zone.width });
        if (zoneEntitySet.beginY) updates.push({ entity: zoneEntitySet.beginY, value: zone.y });
        if (zoneEntitySet.endY) updates.push({ entity: zoneEntitySet.endY, value: zone.y + zone.height });
        if (zoneEntitySet.offDelay) updates.push({ entity: zoneEntitySet.offDelay, value: 15 });

        updates.forEach(({ entity, value }) => {
          tasks.push(this.writeClient.setNumberEntity(entity, value));
        });
      });
    }

    // Exclusion zones
    if (zoneMap.exclusionZoneConfigEntities || deviceId) {
      const exclusionMap = zoneMap.exclusionZoneConfigEntities || {};
      exclusionZones.forEach((zone, idx) => {
        const key = `exclusion${idx + 1}`;
        const mapping = exclusionMap[key];
        if (!mapping && !deviceId) return;

        const zoneEntitySet = resolveZone('exclusion', idx + 1, 'exclusionZoneConfigEntities', key, mapping);
        if (!zoneEntitySet) return;

        const updates: Array<{ entity: string; value: number }> = [];
        if (zoneEntitySet.beginX) updates.push({ entity: zoneEntitySet.beginX, value: zone.x });
        if (zoneEntitySet.endX) updates.push({ entity: zoneEntitySet.endX, value: zone.x + zone.width });
        if (zoneEntitySet.beginY) updates.push({ entity: zoneEntitySet.beginY, value: zone.y });
        if (zoneEntitySet.endY) updates.push({ entity: zoneEntitySet.endY, value: zone.y + zone.height });

        updates.forEach(({ entity, value }) => {
          tasks.push(this.writeClient.setNumberEntity(entity, value));
        });
      });
    }

    // Entry zones
    if (zoneMap.entryZoneConfigEntities || deviceId) {
      const entryMap = zoneMap.entryZoneConfigEntities || {};
      entryZones.forEach((zone, idx) => {
        const key = `entry${idx + 1}`;
        const mapping = entryMap[key];
        if (!mapping && !deviceId) return;

        const zoneEntitySet = resolveZone('entry', idx + 1, 'entryZoneConfigEntities', key, mapping);
        if (!zoneEntitySet) return;

        const updates: Array<{ entity: string; value: number }> = [];
        if (zoneEntitySet.beginX) updates.push({ entity: zoneEntitySet.beginX, value: zone.x });
        if (zoneEntitySet.endX) updates.push({ entity: zoneEntitySet.endX, value: zone.x + zone.width });
        if (zoneEntitySet.beginY) updates.push({ entity: zoneEntitySet.beginY, value: zone.y });
        if (zoneEntitySet.endY) updates.push({ entity: zoneEntitySet.endY, value: zone.y + zone.height });

        updates.forEach(({ entity, value }) => {
          tasks.push(this.writeClient.setNumberEntity(entity, value));
        });
      });
    }

    logger.info({ taskCount: tasks.length }, 'Executing zone updates');
    await Promise.all(tasks);
  }
}
