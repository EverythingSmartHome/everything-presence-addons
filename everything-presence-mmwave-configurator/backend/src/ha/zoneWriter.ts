import { IHaWriteClient } from './writeClient';
import { ZoneRect, ZonePolygon } from '../domain/types';
import { polygonToText } from '../domain/polygonUtils';
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
   */
  async applyPolygonZones(
    entityMap: any,
    zones: ZonePolygon[],
    entityNamePrefix: string
  ): Promise<void> {
    const tasks: Promise<unknown>[] = [];

    const resolveEntity = (template: string | null | undefined): string | null => {
      if (!template) return null;
      return template.replace('${name}', entityNamePrefix);
    };

    logger.debug({ entityNamePrefix, zoneCount: zones.length }, 'Applying polygon zones');

    const regularZones = zones.filter(z => z.type === 'regular');
    const exclusionZones = zones.filter(z => z.type === 'exclusion');
    const entryZones = zones.filter(z => z.type === 'entry');

    // Regular polygon zones
    if (entityMap.polygonZoneEntities) {
      const polyMap = entityMap.polygonZoneEntities;
      regularZones.forEach((zone, idx) => {
        const key = `zone${idx + 1}`;
        const entityId = resolveEntity(polyMap[key]);
        if (entityId) {
          const textValue = polygonToText(zone.vertices);
          logger.debug({ entityId, vertices: zone.vertices.length }, 'Setting polygon zone');
          tasks.push(this.writeClient.setTextEntity(entityId, textValue));
        }
      });

      // Clear unused slots
      const maxZones = Object.keys(polyMap).length;
      for (let i = regularZones.length; i < maxZones; i++) {
        const entityId = resolveEntity(polyMap[`zone${i + 1}`]);
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
        const entityId = resolveEntity(polyMap[key]);
        if (entityId) {
          const textValue = polygonToText(zone.vertices);
          logger.debug({ entityId, vertices: zone.vertices.length }, 'Setting exclusion polygon');
          tasks.push(this.writeClient.setTextEntity(entityId, textValue));
        }
      });

      const maxExclusions = Object.keys(polyMap).length;
      for (let i = exclusionZones.length; i < maxExclusions; i++) {
        const entityId = resolveEntity(polyMap[`exclusion${i + 1}`]);
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
        const entityId = resolveEntity(polyMap[key]);
        if (entityId) {
          const textValue = polygonToText(zone.vertices);
          logger.debug({ entityId, vertices: zone.vertices.length }, 'Setting entry polygon');
          tasks.push(this.writeClient.setTextEntity(entityId, textValue));
        }
      });

      const maxEntries = Object.keys(polyMap).length;
      for (let i = entryZones.length; i < maxEntries; i++) {
        const entityId = resolveEntity(polyMap[`entry${i + 1}`]);
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
   */
  async setPolygonMode(entityMap: any, entityNamePrefix: string, enabled: boolean): Promise<void> {
    const entityTemplate = entityMap.polygonZonesEnabledEntity;
    if (!entityTemplate) {
      logger.debug('No polygon mode entity configured');
      return;
    }

    const entityId = entityTemplate.replace('${name}', entityNamePrefix);
    logger.info({ entityId, enabled }, 'Setting polygon mode');
    await this.writeClient.setSwitchEntity(entityId, enabled);
  }

  /**
   * Write rectangular zones to device number entities.
   */
  async applyZones(zoneMap: any, zones: ZoneRect[], entityNamePrefix: string): Promise<void> {
    const tasks: Promise<unknown>[] = [];

    const resolveEntity = (template: string | null | undefined): string | null => {
      if (!template) return null;
      return template.replace('${name}', entityNamePrefix);
    };

    logger.debug({ entityNamePrefix, zoneCount: zones.length }, 'Applying rectangular zones');

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

        const updates: Array<{ entity: string; value: number }> = [];
        const beginX = resolveEntity(mapping.beginX);
        const endX = resolveEntity(mapping.endX);
        const beginY = resolveEntity(mapping.beginY);
        const endY = resolveEntity(mapping.endY);
        const offDelay = resolveEntity(mapping.offDelay);

        if (beginX) updates.push({ entity: beginX, value: zone.x });
        if (endX) updates.push({ entity: endX, value: zone.x + zone.width });
        if (beginY) updates.push({ entity: beginY, value: zone.y });
        if (endY) updates.push({ entity: endY, value: zone.y + zone.height });
        if (offDelay) updates.push({ entity: offDelay, value: 15 });

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

        const updates: Array<{ entity: string; value: number }> = [];
        const beginX = resolveEntity(mapping.beginX);
        const endX = resolveEntity(mapping.endX);
        const beginY = resolveEntity(mapping.beginY);
        const endY = resolveEntity(mapping.endY);

        if (beginX) updates.push({ entity: beginX, value: zone.x });
        if (endX) updates.push({ entity: endX, value: zone.x + zone.width });
        if (beginY) updates.push({ entity: beginY, value: zone.y });
        if (endY) updates.push({ entity: endY, value: zone.y + zone.height });

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

        const updates: Array<{ entity: string; value: number }> = [];
        const beginX = resolveEntity(mapping.beginX);
        const endX = resolveEntity(mapping.endX);
        const beginY = resolveEntity(mapping.beginY);
        const endY = resolveEntity(mapping.endY);

        if (beginX) updates.push({ entity: beginX, value: zone.x });
        if (endX) updates.push({ entity: endX, value: zone.x + zone.width });
        if (beginY) updates.push({ entity: beginY, value: zone.y });
        if (endY) updates.push({ entity: endY, value: zone.y + zone.height });

        updates.forEach(({ entity, value }) => {
          tasks.push(this.writeClient.setNumberEntity(entity, value));
        });
      });
    }

    logger.info({ taskCount: tasks.length }, 'Executing zone updates');
    await Promise.all(tasks);
  }
}
