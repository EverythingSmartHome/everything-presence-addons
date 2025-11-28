import type { IHaReadTransport } from '../ha/readTransport';
import { logger } from '../logger';

export interface DiscoveredDevice {
  id: string;
  name: string;
  manufacturer?: string;
  model?: string;
  entityNamePrefix?: string; // e.g., "bedroom_ep_lite" from "binary_sensor.bedroom_ep_lite_occupancy"
  firmwareVersion?: string; // Software/firmware version from device registry (e.g., "1.3.2")
}

export class DeviceDiscoveryService {
  private readonly readTransport: IHaReadTransport;
  private readonly manufacturerFilters = [
    'EverythingSmartTechnology',        // EP Lite format (no spaces)
    'Everything Smart Technology',      // EP1 format (with spaces)
  ];

  constructor(readTransport: IHaReadTransport) {
    this.readTransport = readTransport;
  }

  private async getEntityNamePrefixForDevice(deviceId: string): Promise<string | undefined> {
    try {
      // Get entity registry to find entities for this device
      const entityRegistry = await this.readTransport.listEntityRegistry();

      // Filter entities belonging to this device
      const deviceEntities = entityRegistry.filter((e) => e.device_id === deviceId);

      // Prefer finding occupancy or presence sensor first, as it's most reliable
      let deviceEntity = deviceEntities.find((e) =>
        e.entity_id?.includes('_occupancy') || e.entity_id?.includes('_presence')
      );

      // Fallback to any binary_sensor or sensor
      if (!deviceEntity) {
        deviceEntity = deviceEntities.find((e) =>
          e.entity_id?.startsWith('binary_sensor.') || e.entity_id?.startsWith('sensor.')
        );
      }

      // Last resort: use first entity
      if (!deviceEntity) {
        deviceEntity = deviceEntities[0];
      }

      if (deviceEntity?.entity_id) {
        // Extract prefix from entity_id like "binary_sensor.everything_presence_lite_f1c114_occupancy"
        // Result should be: "everything_presence_lite_f1c114"
        const entityId = deviceEntity.entity_id as string;

        // Remove domain prefix (everything before the first dot)
        const withoutDomain = entityId.replace(/^[^.]+\./, '');

        // Remove common suffixes to get the base device name
        // This handles ESPHome entity naming patterns
        const prefix = withoutDomain.replace(
          /_occupancy$|_presence$|_zone_\d+_target_count$|_target_count$|_mmwave.*$|_pir.*$|_light.*$|_illuminance.*$|_temperature.*$|_humidity.*$|_firmware.*$|_esp32_status_led$|_esp32_led$|_status_led$|_led$|_wifi_signal$|_uptime$|_restart$|_safe_mode$|_ip_address$|_connected_ssid$|_mac_address$|_dns_address$|_bluetooth_proxy.*$|_target_\d+.*$/,
          ''
        );

        return prefix;
      }
    } catch (error) {
      logger.warn({ error: (error as Error).message, deviceId }, 'Failed to get entity prefix for device');
    }
    return undefined;
  }

  async discover(): Promise<DiscoveredDevice[]> {
    const devices = await this.readTransport.listDevices();

    if (!Array.isArray(devices)) {
      logger.warn('Unexpected devices payload from HA');
      return [];
    }

    const filteredDevices = devices
      .map((d: any) => ({
        id: d.id as string,
        name: (d.name_by_user as string) || (d.name as string) || 'Unnamed device',
        manufacturer: (d.manufacturer as string | undefined)?.trim(),
        model: d.model as string | undefined,
        firmwareVersion: d.sw_version as string | undefined,
      }))
      .filter((d) => {
        const manufacturer = (d.manufacturer ?? '').toLowerCase();
        return this.manufacturerFilters.some(filter => manufacturer === filter.toLowerCase());
      });

    // Enrich with entity name prefix
    const enrichedDevices = await Promise.all(
      filteredDevices.map(async (device) => ({
        ...device,
        entityNamePrefix: await this.getEntityNamePrefixForDevice(device.id),
      }))
    );

    return enrichedDevices;
  }
}
