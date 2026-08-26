import assert from 'node:assert/strict';
import test from 'node:test';
import type { DeviceMapping } from '../config/deviceMappingStorage';
import type { DeviceProfile } from './deviceProfiles';
import { getZoneEntityNames } from './zoneEntityNaming';

const mapping: DeviceMapping = {
  deviceId: 'device-id',
  profileId: 'test-profile',
  deviceName: 'Test Device',
  discoveredAt: '2026-01-01T00:00:00.000Z',
  lastUpdated: '2026-01-01T00:00:00.000Z',
  confirmedByUser: true,
  autoMatchedCount: 0,
  manuallyMappedCount: 0,
  mappings: {
    zone1BeginX: 'number.device_zone_1_begin_x',
    zone1OffDelay: 'number.device_zone_1_timeout',
    zone1Occupancy: 'binary_sensor.device_zone_1_occupancy',
    zone1TargetCount: 'sensor.device_zone_1_target_count',
    polygonZone1: 'text.device_polygon_zone_1',
    exclusion1BeginX: 'number.device_exclusion_1_begin_x',
  },
  unmappedEntities: [],
};

const profile: DeviceProfile = {
  id: 'test-profile',
  label: 'Test Profile',
  manufacturer: 'Test',
  capabilities: {},
  limits: {},
  entityMap: {},
  entities: {
    zone1BeginX: { template: '', category: 'zone', required: false, zoneType: 'regular', zoneIndex: 1, coord: 'beginX' },
    zone1OffDelay: { template: '', category: 'setting', required: false, zoneIndex: 1, label: 'Zone 1 Off Delay' },
    zone1Occupancy: { template: '', category: 'sensor', required: false, zoneIndex: 1, subcategory: 'zoneOccupancy' },
    zone1TargetCount: { template: '', category: 'sensor', required: false, zoneIndex: 1, subcategory: 'zoneTargetCount' },
    polygonZone1: { template: '', category: 'zone', required: false, zoneType: 'polygon', zoneIndex: 1 },
    exclusion1BeginX: { template: '', category: 'zone', required: false, zoneType: 'exclusion', zoneIndex: 1, coord: 'beginX' },
  },
};

test('names every mapped regular and polygon entity deterministically', () => {
  assert.deepEqual(getZoneEntityNames(mapping, profile, 'Zone 1', 'Desk'), [
    { entityId: 'number.device_zone_1_begin_x', name: 'Desk Begin X' },
    { entityId: 'number.device_zone_1_timeout', name: 'Desk Timeout' },
    { entityId: 'binary_sensor.device_zone_1_occupancy', name: 'Desk Occupancy' },
    { entityId: 'sensor.device_zone_1_target_count', name: 'Desk Target Count' },
    { entityId: 'text.device_polygon_zone_1', name: 'Desk Polygon' },
  ]);
});

test('supports exclusion zones and clears registry overrides for removed labels', () => {
  assert.deepEqual(getZoneEntityNames(mapping, profile, 'Exclusion 1', ''), [
    { entityId: 'number.device_exclusion_1_begin_x', name: null },
  ]);
});
