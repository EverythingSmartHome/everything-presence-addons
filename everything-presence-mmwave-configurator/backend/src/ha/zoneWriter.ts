import { IHaWriteClient } from './writeClient';
import { ZoneRect, ZonePolygon, EntityMappings } from '../domain/types';
import { polygonToText } from '../domain/polygonUtils';
import { EntityResolver } from '../domain/entityResolver';
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
   */
  async applyPolygonZones(
    entityMap: any,
    zones: ZonePolygon[],
    entityNamePrefix: string,
    entityMappings?: EntityMappings
  ): Promise<void> {
    const tasks: Promise<unknown>[] = [];

    logger.debug({ entityNamePrefix, zoneCount: zones.length, hasMappings: !!entityMappings }, 'Applying polygon zones');

    const regularZones = zones.filter(z => z.type === 'regular');
    const exclusionZones = zones.filter(z => z.type === 'exclusion');
    const entryZones = zones.filter(z => z.type === 'entry');

    // Regular polygon zones
    if (entityMap.polygonZoneEntities) {
      const polyMap = entityMap.polygonZoneEntities;
      regularZones.forEach((zone, idx) => {
        const key = `zone${idx + 1}`;
        const entityId = EntityResolver.resolvePolygonZoneEntity(
          entityMappings,
          entityNamePrefix,
          'polygonZoneEntities',
          key,
          polyMap[key]
        );
        if (entityId) {
          const textValue = polygonToText(zone.vertices);
          logger.debug({ entityId, vertices: zone.vertices.length }, 'Setting polygon zone');
          tasks.push(this.writeClient.setTextEntity(entityId, textValue));
        }
      });

      // Clear unused slots
      const maxZones = Object.keys(polyMap).length;
      for (let i = regularZones.length; i < maxZones; i++) {
        const key = `zone${i + 1}`;
        const entityId = EntityResolver.resolvePolygonZoneEntity(
          entityMappings,
          entityNamePrefix,
          'polygonZoneEntities',
          key,
          polyMap[key]
        );
        if (entityId) {
          tasks.push(this.writeClient.setTextEntity(entityId, ''));
        }
      }
    }

    // Exclusion polygon zones
    if (entityMap.polygonExclusionEntities) {
      const polyMap = entityMap.polygonExclusionEntities;
      exclusionZones.forEach((zone, idx) => {
        const key = `exclusion${idx + 1}`;
        const entityId = EntityResolver.resolvePolygonZoneEntity(
          entityMappings,
          entityNamePrefix,
          'polygonExclusionEntities',
          key,
          polyMap[key]
        );
        if (entityId) {
          const textValue = polygonToText(zone.vertices);
          logger.debug({ entityId, vertices: zone.vertices.length }, 'Setting exclusion polygon');
          tasks.push(this.writeClient.setTextEntity(entityId, textValue));
        }
      });

      const maxExclusions = Object.keys(polyMap).length;
      for (let i = exclusionZones.length; i < maxExclusions; i++) {
        const key = `exclusion${i + 1}`;
        const entityId = EntityResolver.resolvePolygonZoneEntity(
          entityMappings,
          entityNamePrefix,
          'polygonExclusionEntities',
          key,
          polyMap[key]
        );
        if (entityId) {
          tasks.push(this.writeClient.setTextEntity(entityId, ''));
        }
      }
    }

    // Entry polygon zones
    if (entityMap.polygonEntryEntities) {
      const polyMap = entityMap.polygonEntryEntities;
      entryZones.forEach((zone, idx) => {
        const key = `entry${idx + 1}`;
        const entityId = EntityResolver.resolvePolygonZoneEntity(
          entityMappings,
          entityNamePrefix,
          'polygonEntryEntities',
          key,
          polyMap[key]
        );
        if (entityId) {
          const textValue = polygonToText(zone.vertices);
          logger.debug({ entityId, vertices: zone.vertices.length }, 'Setting entry polygon');
          tasks.push(this.writeClient.setTextEntity(entityId, textValue));
        }
      });

      const maxEntries = Object.keys(polyMap).length;
      for (let i = entryZones.length; i < maxEntries; i++) {
        const key = `entry${i + 1}`;
        const entityId = EntityResolver.resolvePolygonZoneEntity(
          entityMappings,
          entityNamePrefix,
          'polygonEntryEntities',
          key,
          polyMap[key]
        );
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
   */
  async setPolygonMode(
    entityMap: any,
    entityNamePrefix: string,
    enabled: boolean,
    entityMappings?: EntityMappings
  ): Promise<void> {
    const entityTemplate = entityMap.polygonZonesEnabledEntity;
    if (!entityTemplate && !entityMappings?.polygonZonesEnabledEntity) {
      logger.debug('No polygon mode entity configured');
      return;
    }

    const entityId = EntityResolver.resolve(
      entityMappings,
      entityNamePrefix,
      'polygonZonesEnabledEntity',
      entityTemplate
    );

    if (!entityId) {
      logger.debug('Could not resolve polygon mode entity');
      return;
    }

    logger.info({ entityId, enabled }, 'Setting polygon mode');
    await this.writeClient.setSwitchEntity(entityId, enabled);
  }

  /**
   * Write rectangular zones to device number entities.
   * @param zoneMap - Profile entity template map
   * @param zones - Zones to write
   * @param entityNamePrefix - Legacy entity name prefix (for fallback)
   * @param entityMappings - Discovered entity mappings (preferred, optional)
   */
  async applyZones(
    zoneMap: any,
    zones: ZoneRect[],
    entityNamePrefix: string,
    entityMappings?: EntityMappings
  ): Promise<void> {
    const tasks: Promise<unknown>[] = [];

    logger.debug({ entityNamePrefix, zoneCount: zones.length, hasMappings: !!entityMappings }, 'Applying rectangular zones');

    const regularZones = zones.filter(z => z.type === 'regular');
    const exclusionZones = zones.filter(z => z.type === 'exclusion');
    const entryZones = zones.filter(z => z.type === 'entry');

    // Regular zones
    if (zoneMap.zoneConfigEntities) {
      const regularMap = zoneMap.zoneConfigEntities;
      regularZones.forEach((zone, idx) => {
        const key = `zone${idx + 1}`;
        const mapping = regularMap[key];
        if (!mapping) return;

        const zoneEntitySet = EntityResolver.resolveZoneEntitySet(
          entityMappings,
          entityNamePrefix,
          'zoneConfigEntities',
          key,
          mapping
        );
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
    if (zoneMap.exclusionZoneConfigEntities) {
      const exclusionMap = zoneMap.exclusionZoneConfigEntities;
      exclusionZones.forEach((zone, idx) => {
        const key = `exclusion${idx + 1}`;
        const mapping = exclusionMap[key];
        if (!mapping) return;

        const zoneEntitySet = EntityResolver.resolveZoneEntitySet(
          entityMappings,
          entityNamePrefix,
          'exclusionZoneConfigEntities',
          key,
          mapping
        );
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
    if (zoneMap.entryZoneConfigEntities) {
      const entryMap = zoneMap.entryZoneConfigEntities;
      entryZones.forEach((zone, idx) => {
        const key = `entry${idx + 1}`;
        const mapping = entryMap[key];
        if (!mapping) return;

        const zoneEntitySet = EntityResolver.resolveZoneEntitySet(
          entityMappings,
          entityNamePrefix,
          'entryZoneConfigEntities',
          key,
          mapping
        );
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
