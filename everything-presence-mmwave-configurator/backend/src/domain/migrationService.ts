import { deviceMappingStorage, DeviceMapping } from '../config/deviceMappingStorage';
import { storage } from '../config/storage';
import { RoomConfig, EntityMappings, ZoneEntitySet, TargetEntitySet } from './types';
import { logger } from '../logger';

/**
 * Result of a single room migration.
 */
export interface MigrationResult {
  migrated: boolean;
  reason?: string;
  deviceId?: string;
  roomId?: string;
  roomName?: string;
}

/**
 * Summary of migration across all rooms.
 */
export interface MigrationSummary {
  totalRooms: number;
  migratedCount: number;
  skippedCount: number;
  errorCount: number;
  results: MigrationResult[];
}

/**
 * Service for migrating room-level entity mappings to device-level storage.
 */
class MigrationServiceImpl {
  /**
   * Check if a room needs migration.
   */
  needsMigration(room: RoomConfig): boolean {
    return !!(room.entityMappings || room.entityNamePrefix);
  }

  /**
   * Convert room.entityMappings to flat DeviceMapping.mappings format.
   * This flattens nested structures (zones, targets) into a flat key-value map.
   */
  convertRoomMappings(room: RoomConfig): Record<string, string> {
    const mappings: Record<string, string> = {};
    const em = room.entityMappings;

    if (!em) return mappings;

    // Core entities
    if (em.presenceEntity) mappings['presence'] = em.presenceEntity;
    if (em.mmwaveEntity) mappings['mmwave'] = em.mmwaveEntity;
    if (em.pirEntity) mappings['pir'] = em.pirEntity;
    if (em.temperatureEntity) mappings['temperature'] = em.temperatureEntity;
    if (em.humidityEntity) mappings['humidity'] = em.humidityEntity;
    if (em.illuminanceEntity) mappings['illuminance'] = em.illuminanceEntity;
    if (em.co2Entity) mappings['co2'] = em.co2Entity;

    // EP1-specific entities
    if (em.distanceEntity) mappings['distance'] = em.distanceEntity;
    if (em.speedEntity) mappings['speed'] = em.speedEntity;
    if (em.energyEntity) mappings['energy'] = em.energyEntity;
    if (em.targetCountEntity) mappings['targetCount'] = em.targetCountEntity;
    if (em.modeEntity) mappings['mode'] = em.modeEntity;

    // Configuration entities
    if (em.maxDistanceEntity) mappings['maxDistance'] = em.maxDistanceEntity;
    if (em.installationAngleEntity) mappings['installationAngle'] = em.installationAngleEntity;
    if (em.polygonZonesEnabledEntity) mappings['polygonZonesEnabled'] = em.polygonZonesEnabledEntity;
    if (em.trackingTargetCountEntity) mappings['trackingTargetCount'] = em.trackingTargetCountEntity;
    if (em.firmwareUpdateEntity) mappings['firmwareUpdate'] = em.firmwareUpdateEntity;

    // Zone config entities (rectangular)
    this.flattenZoneEntities(mappings, em.zoneConfigEntities, 'zone');
    this.flattenZoneEntities(mappings, em.exclusionZoneConfigEntities, 'exclusion');
    this.flattenZoneEntities(mappings, em.entryZoneConfigEntities, 'entry');

    // Polygon zone entities
    this.flattenPolygonEntities(mappings, em.polygonZoneEntities, 'polygonZone');
    this.flattenPolygonEntities(mappings, em.polygonExclusionEntities, 'polygonExclusion');
    this.flattenPolygonEntities(mappings, em.polygonEntryEntities, 'polygonEntry');

    // Tracking targets
    this.flattenTrackingTargets(mappings, em.trackingTargets);

    // Settings entities (already flat)
    if (em.settingsEntities) {
      for (const [key, value] of Object.entries(em.settingsEntities)) {
        if (typeof value === 'string') {
          mappings[key] = value;
        }
      }
    }

    return mappings;
  }

  /**
   * Flatten zone coordinate entities into mappings.
   */
  private flattenZoneEntities(
    mappings: Record<string, string>,
    zones: Record<string, ZoneEntitySet | undefined> | undefined,
    prefix: 'zone' | 'exclusion' | 'entry'
  ): void {
    if (!zones) return;

    // Map zone keys to indices (zone1->1, exclusion2->2, entry1->1)
    const keyToIndex: Record<string, number> = {
      zone1: 1, zone2: 2, zone3: 3, zone4: 4,
      exclusion1: 1, exclusion2: 2,
      entry1: 1, entry2: 2,
    };

    for (const [zoneKey, zoneSet] of Object.entries(zones)) {
      if (!zoneSet) continue;

      const index = keyToIndex[zoneKey] ?? (parseInt(zoneKey.replace(/\D/g, ''), 10) || 1);

      if (zoneSet.beginX) mappings[`${prefix}${index}BeginX`] = zoneSet.beginX;
      if (zoneSet.endX) mappings[`${prefix}${index}EndX`] = zoneSet.endX;
      if (zoneSet.beginY) mappings[`${prefix}${index}BeginY`] = zoneSet.beginY;
      if (zoneSet.endY) mappings[`${prefix}${index}EndY`] = zoneSet.endY;
      if (zoneSet.offDelay) mappings[`${prefix}${index}OffDelay`] = zoneSet.offDelay;
    }
  }

  /**
   * Flatten polygon zone entities into mappings.
   */
  private flattenPolygonEntities(
    mappings: Record<string, string>,
    polygons: Record<string, string | undefined> | undefined,
    prefix: 'polygonZone' | 'polygonExclusion' | 'polygonEntry'
  ): void {
    if (!polygons) return;

    const keyToIndex: Record<string, number> = {
      zone1: 1, zone2: 2, zone3: 3, zone4: 4,
      exclusion1: 1, exclusion2: 2,
      entry1: 1, entry2: 2,
    };

    for (const [key, entityId] of Object.entries(polygons)) {
      if (!entityId) continue;

      const index = keyToIndex[key] ?? (parseInt(key.replace(/\D/g, ''), 10) || 1);
      mappings[`${prefix}${index}`] = entityId;
    }
  }

  /**
   * Flatten tracking target entities into mappings.
   */
  private flattenTrackingTargets(
    mappings: Record<string, string>,
    targets: Record<string, TargetEntitySet | undefined> | undefined
  ): void {
    if (!targets) return;

    for (const [targetKey, targetSet] of Object.entries(targets)) {
      if (!targetSet) continue;

      const index = parseInt(targetKey.replace(/\D/g, ''), 10) || 1;

      if (targetSet.x) mappings[`target${index}X`] = targetSet.x;
      if (targetSet.y) mappings[`target${index}Y`] = targetSet.y;
      if (targetSet.speed) mappings[`target${index}Speed`] = targetSet.speed;
      if (targetSet.distance) mappings[`target${index}Distance`] = targetSet.distance;
      if (targetSet.angle) mappings[`target${index}Angle`] = targetSet.angle;
      if (targetSet.resolution) mappings[`target${index}Resolution`] = targetSet.resolution;
      if (targetSet.active) mappings[`target${index}Active`] = targetSet.active;
    }
  }

  /**
   * Migrate a room's entity mappings to device-level storage.
   * Only overwrites existing mapping if the new one is better quality.
   */
  async migrateRoomToDeviceMapping(room: RoomConfig): Promise<MigrationResult> {
    // Validate room has required data
    if (!room.deviceId) {
      return { migrated: false, reason: 'no_device_id', roomId: room.id, roomName: room.name };
    }

    if (!room.entityMappings && !room.entityNamePrefix) {
      return { migrated: false, reason: 'no_mappings', roomId: room.id, roomName: room.name };
    }

    const deviceId = room.deviceId;
    const existingMapping = deviceMappingStorage.getMapping(deviceId);

    // If mapping already exists, compare quality more carefully
    if (existingMapping) {
      const existingScore = existingMapping.autoMatchedCount ?? 0;
      const newScore = room.entityMappings?.autoMatchedCount ?? 0;
      const existingMappingCount = Object.keys(existingMapping.mappings).length;
      const newMappingCount = Object.keys(this.convertRoomMappings(room)).length;
      const existingDate = new Date(existingMapping.lastUpdated || existingMapping.discoveredAt).getTime();
      const newDate = new Date(room.entityMappings?.discoveredAt ?? 0).getTime();
      const existingConfirmed = existingMapping.confirmedByUser ?? false;

      // Never overwrite user-confirmed mappings with auto-migrated data
      if (existingConfirmed) {
        logger.info(
          { deviceId, roomId: room.id },
          'Device mapping was confirmed by user, skipping migration'
        );
        return {
          migrated: false,
          reason: 'user_confirmed',
          deviceId,
          roomId: room.id,
          roomName: room.name,
        };
      }

      // Compare quality: prefer higher score, then more mappings, then newer date
      const existingBetter =
        existingScore > newScore ||
        (existingScore === newScore && existingMappingCount >= newMappingCount) ||
        (existingScore === newScore && existingMappingCount === newMappingCount && existingDate >= newDate);

      if (existingBetter) {
        logger.info(
          { deviceId, roomId: room.id, existingScore, newScore, existingMappingCount, newMappingCount },
          'Device mapping already exists with equal/better quality, skipping'
        );
        return {
          migrated: false,
          reason: 'existing_better',
          deviceId,
          roomId: room.id,
          roomName: room.name,
        };
      }

      logger.info(
        { deviceId, roomId: room.id, existingScore, newScore, existingMappingCount, newMappingCount },
        'Overwriting device mapping with better quality from room'
      );
    }

    // Convert room mappings to flat format
    const flatMappings = this.convertRoomMappings(room);

    // Build DeviceMapping object
    const deviceMapping: DeviceMapping = {
      deviceId,
      profileId: room.profileId || 'unknown',
      deviceName: room.name || 'Unknown Device',
      discoveredAt: room.entityMappings?.discoveredAt || new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      confirmedByUser: true, // Assuming existing mappings were confirmed
      autoMatchedCount: room.entityMappings?.autoMatchedCount ?? Object.keys(flatMappings).length,
      manuallyMappedCount: room.entityMappings?.manuallyMappedCount ?? 0,
      mappings: flatMappings,
      unmappedEntities: [],
    };

    // Save to device storage
    await deviceMappingStorage.saveMapping(deviceMapping);

    logger.info(
      { deviceId, roomId: room.id, mappingCount: Object.keys(flatMappings).length },
      'Successfully migrated room entity mappings to device storage'
    );

    return {
      migrated: true,
      deviceId,
      roomId: room.id,
      roomName: room.name,
    };
  }

  /**
   * Migrate all rooms on startup.
   * This is idempotent - safe to run multiple times.
   */
  async migrateAllOnStartup(): Promise<MigrationSummary> {
    const rooms = storage.listRooms();
    const results: MigrationResult[] = [];
    let migratedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    logger.info({ roomCount: rooms.length }, 'Starting entity mapping migration check');

    for (const room of rooms) {
      if (!this.needsMigration(room)) {
        skippedCount++;
        continue;
      }

      try {
        const result = await this.migrateRoomToDeviceMapping(room);
        results.push(result);

        if (result.migrated) {
          migratedCount++;
        } else {
          skippedCount++;
        }
      } catch (error) {
        errorCount++;
        results.push({
          migrated: false,
          reason: `error: ${(error as Error).message}`,
          roomId: room.id,
          roomName: room.name,
        });
        logger.error(
          { error: (error as Error).message, roomId: room.id },
          'Failed to migrate room entity mappings'
        );
      }
    }

    const summary: MigrationSummary = {
      totalRooms: rooms.length,
      migratedCount,
      skippedCount,
      errorCount,
      results,
    };

    logger.info(
      { ...summary, results: undefined },
      'Entity mapping migration complete'
    );

    return summary;
  }

  /**
   * Dry run migration - returns what would be migrated without actually doing it.
   */
  async dryRunMigration(): Promise<MigrationSummary> {
    const rooms = storage.listRooms();
    const results: MigrationResult[] = [];
    let wouldMigrateCount = 0;
    let wouldSkipCount = 0;

    for (const room of rooms) {
      if (!this.needsMigration(room)) {
        wouldSkipCount++;
        results.push({
          migrated: false,
          reason: 'no_migration_needed',
          roomId: room.id,
          roomName: room.name,
        });
        continue;
      }

      if (!room.deviceId) {
        wouldSkipCount++;
        results.push({
          migrated: false,
          reason: 'no_device_id',
          roomId: room.id,
          roomName: room.name,
        });
        continue;
      }

      const existingMapping = deviceMappingStorage.getMapping(room.deviceId);
      if (existingMapping) {
        const existingScore = existingMapping.autoMatchedCount ?? 0;
        const newScore = room.entityMappings?.autoMatchedCount ?? 0;
        const existingMappingCount = Object.keys(existingMapping.mappings).length;
        const newMappingCount = Object.keys(this.convertRoomMappings(room)).length;
        const existingDate = new Date(existingMapping.lastUpdated || existingMapping.discoveredAt).getTime();
        const newDate = new Date(room.entityMappings?.discoveredAt ?? 0).getTime();
        const existingConfirmed = existingMapping.confirmedByUser ?? false;

        // Never overwrite user-confirmed mappings
        if (existingConfirmed) {
          wouldSkipCount++;
          results.push({
            migrated: false,
            reason: 'user_confirmed',
            deviceId: room.deviceId,
            roomId: room.id,
            roomName: room.name,
          });
          continue;
        }

        // Compare quality: prefer higher score, then more mappings, then newer date
        const existingBetter =
          existingScore > newScore ||
          (existingScore === newScore && existingMappingCount >= newMappingCount) ||
          (existingScore === newScore && existingMappingCount === newMappingCount && existingDate >= newDate);

        if (existingBetter) {
          wouldSkipCount++;
          results.push({
            migrated: false,
            reason: 'existing_better',
            deviceId: room.deviceId,
            roomId: room.id,
            roomName: room.name,
          });
          continue;
        }
      }

      wouldMigrateCount++;
      results.push({
        migrated: true,
        reason: 'would_migrate',
        deviceId: room.deviceId,
        roomId: room.id,
        roomName: room.name,
      });
    }

    return {
      totalRooms: rooms.length,
      migratedCount: wouldMigrateCount,
      skippedCount: wouldSkipCount,
      errorCount: 0,
      results,
    };
  }
}

// Export singleton instance
export const migrationService = new MigrationServiceImpl();
