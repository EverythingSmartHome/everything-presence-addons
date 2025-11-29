import type { IHaReadTransport } from './readTransport';
import { ZoneRect, ZonePolygon, EntityMappings } from '../domain/types';
import { textToPolygon } from '../domain/polygonUtils';
import { EntityResolver } from '../domain/entityResolver';
import { logger } from '../logger';

export class ZoneReader {
  private readonly readTransport: IHaReadTransport;

  constructor(readTransport: IHaReadTransport) {
    this.readTransport = readTransport;
  }

  /**
   * Read polygon zones from text entities.
   * @param entityMap - Profile entity template map
   * @param entityNamePrefix - Legacy entity name prefix (for fallback)
   * @param entityMappings - Discovered entity mappings (preferred, optional)
   */
  async readPolygonZones(
    entityMap: any,
    entityNamePrefix: string,
    entityMappings?: EntityMappings
  ): Promise<ZonePolygon[]> {
    logger.debug({ entityNamePrefix, hasPolygonZoneEntities: !!entityMap.polygonZoneEntities, hasMappings: !!entityMappings }, 'Starting polygon zone read');
    const zones: ZonePolygon[] = [];

    // Regular polygon zones
    if (entityMap.polygonZoneEntities) {
      const polyMap = entityMap.polygonZoneEntities;
      for (let i = 1; i <= 4; i++) {
        const key = `zone${i}`;
        const entityId = EntityResolver.resolvePolygonZoneEntity(
          entityMappings,
          entityNamePrefix,
          'polygonZoneEntities',
          key,
          polyMap[key]
        );
        logger.debug({ key, entityId }, 'Checking polygon zone entity');
        if (!entityId) continue;

        try {
          const state = await this.readTransport.getState(entityId);
          logger.debug({ key, entityId, state: state?.state, hasState: !!state }, 'Polygon zone entity state');
          if (!state || !state.state || state.state === '') continue;

          const vertices = textToPolygon(state.state);
          if (vertices.length < 3) continue;

          zones.push({
            id: `Zone ${i}`,
            type: 'regular',
            vertices,
            enabled: true,
          });
        } catch (error) {
          logger.warn({ key, error }, 'Failed to read polygon zone');
          continue;
        }
      }
    }

    // Exclusion polygon zones
    if (entityMap.polygonExclusionEntities) {
      const polyMap = entityMap.polygonExclusionEntities;
      for (let i = 1; i <= 2; i++) {
        const key = `exclusion${i}`;
        const entityId = EntityResolver.resolvePolygonZoneEntity(
          entityMappings,
          entityNamePrefix,
          'polygonExclusionEntities',
          key,
          polyMap[key]
        );
        if (!entityId) continue;

        try {
          const state = await this.readTransport.getState(entityId);
          if (!state || !state.state || state.state === '') continue;

          const vertices = textToPolygon(state.state);
          if (vertices.length < 3) continue;

          zones.push({
            id: `Exclusion ${i}`,
            type: 'exclusion',
            vertices,
            enabled: true,
          });
        } catch (error) {
          logger.warn({ key, error }, 'Failed to read exclusion polygon');
          continue;
        }
      }
    }

    // Entry polygon zones
    if (entityMap.polygonEntryEntities) {
      const polyMap = entityMap.polygonEntryEntities;
      for (let i = 1; i <= 2; i++) {
        const key = `entry${i}`;
        const entityId = EntityResolver.resolvePolygonZoneEntity(
          entityMappings,
          entityNamePrefix,
          'polygonEntryEntities',
          key,
          polyMap[key]
        );
        if (!entityId) continue;

        try {
          const state = await this.readTransport.getState(entityId);
          if (!state || !state.state || state.state === '') continue;

          const vertices = textToPolygon(state.state);
          if (vertices.length < 3) continue;

          zones.push({
            id: `Entry ${i}`,
            type: 'entry',
            vertices,
            enabled: true,
          });
        } catch (error) {
          logger.warn({ key, error }, 'Failed to read entry polygon');
          continue;
        }
      }
    }

    logger.debug({ count: zones.length }, 'Read polygon zones from device');
    return zones;
  }

  /**
   * Read rectangular zones from number entities.
   * @param zoneMap - Profile entity template map
   * @param entityNamePrefix - Legacy entity name prefix (for fallback)
   * @param entityMappings - Discovered entity mappings (preferred, optional)
   */
  async readZones(
    zoneMap: any,
    entityNamePrefix: string,
    entityMappings?: EntityMappings
  ): Promise<ZoneRect[]> {
    const zones: ZoneRect[] = [];

    const regularZoneMap = zoneMap.zoneConfigEntities || zoneMap;
    for (let i = 1; i <= 4; i++) {
      const key = `zone${i}`;
      const mapping = regularZoneMap[key];
      if (!mapping) continue;

      try {
        // Use EntityResolver to get entities (mappings first, then template fallback)
        const zoneEntitySet = EntityResolver.resolveZoneEntitySet(
          entityMappings,
          entityNamePrefix,
          'zoneConfigEntities',
          key,
          mapping
        );

        if (!zoneEntitySet) continue;
        const { beginX: beginXEntity, endX: endXEntity, beginY: beginYEntity, endY: endYEntity } = zoneEntitySet;

        const [beginXState, endXState, beginYState, endYState] = await Promise.all([
          this.readTransport.getState(beginXEntity),
          this.readTransport.getState(endXEntity),
          this.readTransport.getState(beginYEntity),
          this.readTransport.getState(endYEntity),
        ]);

        if (!beginXState || !endXState || !beginYState || !endYState) continue;

        const beginX = parseFloat(beginXState.state);
        const endX = parseFloat(endXState.state);
        const beginY = parseFloat(beginYState.state);
        const endY = parseFloat(endYState.state);

        // Skip unconfigured zones (all zeros)
        if (beginX === 0 && endX === 0 && beginY === 0 && endY === 0) continue;

        const x = Math.min(beginX, endX);
        const y = Math.min(beginY, endY);
        const width = Math.abs(endX - beginX);
        const height = Math.abs(endY - beginY);

        // Skip zones with no area
        if (width === 0 || height === 0) continue;

        zones.push({
          id: `Zone ${i}`,
          type: 'regular',
          x,
          y,
          width,
          height,
        });
      } catch (error) {
        logger.warn({ key, error }, 'Failed to read zone');
        continue;
      }
    }

    // Exclusion zones (occupancy masks)
    if (zoneMap.exclusionZoneConfigEntities) {
      const exclusionMap = zoneMap.exclusionZoneConfigEntities;
      for (let i = 1; i <= 2; i++) {
        const key = `exclusion${i}`;
        const mapping = exclusionMap[key];
        if (!mapping) continue;

        try {
          const zoneEntitySet = EntityResolver.resolveZoneEntitySet(
            entityMappings,
            entityNamePrefix,
            'exclusionZoneConfigEntities',
            key,
            mapping
          );

          if (!zoneEntitySet) continue;
          const { beginX: beginXEntity, endX: endXEntity, beginY: beginYEntity, endY: endYEntity } = zoneEntitySet;

          const [beginXState, endXState, beginYState, endYState] = await Promise.all([
            this.readTransport.getState(beginXEntity),
            this.readTransport.getState(endXEntity),
            this.readTransport.getState(beginYEntity),
            this.readTransport.getState(endYEntity),
          ]);

          if (!beginXState || !endXState || !beginYState || !endYState) continue;

          const beginX = parseFloat(beginXState.state);
          const endX = parseFloat(endXState.state);
          const beginY = parseFloat(beginYState.state);
          const endY = parseFloat(endYState.state);

          if (beginX === 0 && endX === 0 && beginY === 0 && endY === 0) continue;

          const x = Math.min(beginX, endX);
          const y = Math.min(beginY, endY);
          const width = Math.abs(endX - beginX);
          const height = Math.abs(endY - beginY);

          if (width === 0 || height === 0) continue;

          zones.push({
            id: `Exclusion ${i}`,
            type: 'exclusion',
            x,
            y,
            width,
            height,
          });
        } catch {
          continue;
        }
      }
    }

    // Entry zones
    if (zoneMap.entryZoneConfigEntities) {
      const entryMap = zoneMap.entryZoneConfigEntities;
      for (let i = 1; i <= 2; i++) {
        const key = `entry${i}`;
        const mapping = entryMap[key];
        if (!mapping) continue;

        try {
          const zoneEntitySet = EntityResolver.resolveZoneEntitySet(
            entityMappings,
            entityNamePrefix,
            'entryZoneConfigEntities',
            key,
            mapping
          );

          if (!zoneEntitySet) continue;
          const { beginX: beginXEntity, endX: endXEntity, beginY: beginYEntity, endY: endYEntity } = zoneEntitySet;

          const [beginXState, endXState, beginYState, endYState] = await Promise.all([
            this.readTransport.getState(beginXEntity),
            this.readTransport.getState(endXEntity),
            this.readTransport.getState(beginYEntity),
            this.readTransport.getState(endYEntity),
          ]);

          if (!beginXState || !endXState || !beginYState || !endYState) continue;

          const beginX = parseFloat(beginXState.state);
          const endX = parseFloat(endXState.state);
          const beginY = parseFloat(beginYState.state);
          const endY = parseFloat(endYState.state);

          if (beginX === 0 && endX === 0 && beginY === 0 && endY === 0) continue;

          const x = Math.min(beginX, endX);
          const y = Math.min(beginY, endY);
          const width = Math.abs(endX - beginX);
          const height = Math.abs(endY - beginY);

          if (width === 0 || height === 0) continue;

          zones.push({
            id: `Entry ${i}`,
            type: 'entry',
            x,
            y,
            width,
            height,
          });
        } catch {
          continue;
        }
      }
    }

    logger.debug({ count: zones.length }, 'Read rectangular zones from device');
    return zones;
  }
}
