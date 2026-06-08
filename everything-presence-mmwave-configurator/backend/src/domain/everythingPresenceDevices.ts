import type { DeviceRegistryEntry } from '../ha/readTransport';
import type { EntityRegistryEntry } from '../ha/types';

const MANUFACTURER_FILTERS = [
  'EverythingSmartTechnology',
  'Everything Smart Technology',
];

export const normalizeManufacturer = (value: unknown): string => {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '')).join(', ').trim();
  }
  if (value == null) {
    return '';
  }
  return String(value).trim();
};

export const isEverythingPresenceManufacturer = (manufacturer: unknown): boolean => {
  const normalized = normalizeManufacturer(manufacturer).toLowerCase();
  return MANUFACTURER_FILTERS.some((filter) => normalized === filter.toLowerCase());
};

export const filterEverythingPresenceDevices = <T extends { manufacturer?: unknown }>(devices: T[]): T[] =>
  devices.filter((device) => isEverythingPresenceManufacturer(device.manufacturer));

export const slugifyDeviceName = (name: string | null | undefined): string | undefined => {
  if (!name) return undefined;
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || undefined;
};

export const extractEsphomeNodeName = (device: DeviceRegistryEntry): string | undefined => {
  for (const [domain, identifier] of device.identifiers ?? []) {
    if (typeof domain === 'string' && typeof identifier === 'string' && domain.toLowerCase() === 'esphome') {
      return identifier;
    }
  }
  return undefined;
};

const ENTITY_SUFFIX_REGEX = new RegExp(
  [
    '_exclusion_zone_\\d+_start_[xy]$',
    '_exclusion_zone_\\d+_end_[xy]$',
    '_exclusion_zone_\\d+_target_count$',
    '_zone_\\d+_start_[xy]$',
    '_zone_\\d+_timeout$',
    '_zone_\\d+_presence$',
    '_tracking_detection_range$',
    '_tracking_presence_timeout$',
    '_tracking_sensor_angle$',
    '_tracking_update_rate$',
    '_target_tracking_detail$',
    '_target_update_rate$',
    '_auto_clear_stuck_targets$',
    '_stuck_target_timeout$',
    '_tracking_presence$',
    '_mmwave_presence$',
    '_tracking_sensor_firmware$',
    '_tracking_configuration_mode$',
    '_ld2450_bluetooth$',
    '_relay_output$',
    '_relay_trigger_mode$',
    '_led_mode$',
    '_led_brightness$',
    '_occupancy_timeout$',
    '_motion_timeout$',
    '_temperature_calibration$',
    '_humidity_calibration$',
    '_illuminance_calibration$',
    '_zone_\\d+_occupancy_off_delay$',
    '_zone_\\d+_target_count$',
    '_zone_\\d+_occupancy$',
    '_zone_\\d+_begin_[xy]$',
    '_zone_\\d+_end_[xy]$',
    '_zone_\\d+_off_delay$',
    '_entry_zone_\\d+_begin_[xy]$',
    '_entry_zone_\\d+_end_[xy]$',
    '_occupancy_mask_\\d+_begin_[xy]$',
    '_occupancy_mask_\\d+_end_[xy]$',
    '_polygon_zone_\\d+$',
    '_polygon_exclusion_\\d+$',
    '_polygon_entry_\\d+$',
    '_target_\\d+_[a-z]+$',
    '_target_\\d+.*$',
    '_target_count$',
    '_max_distance$',
    '_occupancy_off_delay$',
    '_installation_angle$',
    '_upside_down_mounting$',
    '_update_speed$',
    '_tracking_behaviour$',
    '_entry_exit_enabled$',
    '_exit_threshold_pct$',
    '_assume_present_timeout$',
    '_stale_target_reset_timeout$',
    '_stale_target_reset$',
    '_polygon_zones$',
    '_mmwave_mode$',
    '_mmwave_minimum_distance$',
    '_mmwave_max_distance$',
    '_mmwave_trigger_distance$',
    '_mmwave_sustain_sensitivity$',
    '_mmwave_trigger_sensitivity$',
    '_mmwave_threshold_factor$',
    '_mmwave_on_latency$',
    '_mmwave_off_latency$',
    '_occupancy_off_latency$',
    '_pir_off_latency$',
    '_pir_on_latency$',
    '_temperature_offset$',
    '_humidity_offset$',
    '_illuminance_offset$',
    '_micro_motion_detection$',
    '_mmwave_led$',
    '_distance_speed_update_rate$',
    '_occupancy$',
    '_presence$',
    '_mmwave.*$',
    '_pir.*$',
    '_light.*$',
    '_illuminance.*$',
    '_temperature.*$',
    '_humidity.*$',
    '_co2$',
    '_firmware.*$',
    '_esp32_status_led$',
    '_esp32_led$',
    '_status_led$',
    '_led$',
    '_wifi_signal$',
    '_uptime$',
    '_restart$',
    '_safe_mode$',
    '_ip_address$',
    '_connected_ssid$',
    '_mac_address$',
    '_dns_address$',
    '_bluetooth_proxy.*$',
  ].join('|')
);

export const extractEntityPrefixFromEntityId = (entityId: string): string | undefined => {
  const withoutDomain = entityId.replace(/^[^.]+\./, '');
  const prefix = withoutDomain.replace(ENTITY_SUFFIX_REGEX, '');
  // Only trust the result when a known suffix was actually stripped. Otherwise the
  // entity is not a recognised one (e.g. a button like `_apply_update`) and its full
  // object_id must not be returned as a prefix.
  if (prefix && prefix !== withoutDomain) {
    return prefix;
  }
  return undefined;
};

const deriveEntityPrefixFromCommonPrefix = (
  deviceEntities: EntityRegistryEntry[]
): string | undefined => {
  const objectIds = deviceEntities
    .map((entry) => entry.entity_id)
    .filter((id): id is string => Boolean(id))
    .map((id) => id.replace(/^[^.]+\./, ''));
  if (objectIds.length === 0) {
    return undefined;
  }
  let common = objectIds[0];
  for (const id of objectIds.slice(1)) {
    let i = 0;
    while (i < common.length && i < id.length && common[i] === id[i]) {
      i++;
    }
    common = common.slice(0, i);
    if (!common) {
      break;
    }
  }
  const trimmed = common.replace(/_+$/, '');
  return trimmed || undefined;
};

export const deriveEntityPrefixFromRegistryEntries = (
  deviceEntities: EntityRegistryEntry[]
): string | undefined => {
  // Prefer the presence/occupancy sensor, matched on an END-ANCHORED suffix.
  // The product name "everything_presence_lite" contains the substring "_presence",
  // so a loose includes() check spuriously matches every entity (including buttons)
  // and derives a garbage prefix from whichever entity happens to be first.
  const objectId = (entityId: string | undefined): string => (entityId ?? '').replace(/^[^.]+\./, '');
  let deviceEntity = deviceEntities.find((entry) => /_(occupancy|presence)$/.test(objectId(entry.entity_id)));

  if (!deviceEntity) {
    deviceEntity = deviceEntities.find(
      (entry) => entry.entity_id?.startsWith('binary_sensor.') || entry.entity_id?.startsWith('sensor.')
    );
  }

  if (deviceEntity?.entity_id) {
    const prefix = extractEntityPrefixFromEntityId(deviceEntity.entity_id);
    if (prefix) {
      return prefix;
    }
  }

  // Robust fallback: the longest common object_id prefix across all device entities.
  // Immune to unknown/new entity suffixes that ENTITY_SUFFIX_REGEX does not cover.
  return deriveEntityPrefixFromCommonPrefix(deviceEntities);
};
