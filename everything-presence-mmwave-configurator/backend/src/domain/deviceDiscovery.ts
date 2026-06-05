import type { IHaReadTransport } from '../ha/readTransport';
import { logger } from '../logger';
import {
  deriveEntityPrefixFromRegistryEntries,
  extractEsphomeNodeName,
  filterEverythingPresenceDevices,
  normalizeManufacturer,
} from './everythingPresenceDevices';

export interface DiscoveredDevice {
  id: string;
  name: string;
  manufacturer?: string;
  model?: string;
  entityNamePrefix?: string; // e.g., "bedroom_ep_lite" from "binary_sensor.bedroom_ep_lite_occupancy"
  firmwareVersion?: string; // Software/firmware version from device registry (e.g., "1.3.2")
  areaName?: string; // Home Assistant area name (e.g., "Living Room")
}

export class DeviceDiscoveryService {
  private readonly readTransport: IHaReadTransport;

  constructor(readTransport: IHaReadTransport) {
    this.readTransport = readTransport;
  }

  private async getEntityNamePrefixForDevice(deviceId: string): Promise<string | undefined> {
    try {
      const devices = await this.readTransport.listDevices();
      const device = filterEverythingPresenceDevices(devices).find((entry) => entry.id === deviceId);
      if (device) {
        const esphomePrefix = extractEsphomeNodeName(device);
        if (esphomePrefix) {
          return esphomePrefix;
        }
      }

      const entityRegistry = await this.readTransport.listEntityRegistry();
      const deviceEntities = entityRegistry.filter((entry) => entry.device_id === deviceId);
      const registryPrefix = deriveEntityPrefixFromRegistryEntries(deviceEntities);
      if (registryPrefix) {
        return registryPrefix;
      }
    } catch (error) {
      logger.warn({ error: (error as Error).message, deviceId }, 'Failed to get entity prefix for device');
    }
    return undefined;
  }

  async discover(): Promise<DiscoveredDevice[]> {
    // Fetch devices and areas in parallel
    const [devices, areas] = await Promise.all([
      this.readTransport.listDevices(),
      this.readTransport.listAreaRegistry().catch((err) => {
        logger.warn({ err }, 'Failed to fetch area registry, continuing without area info');
        return [];
      }),
    ]);

    if (!Array.isArray(devices)) {
      logger.warn('Unexpected devices payload from HA');
      return [];
    }

    // Build area_id -> name map for quick lookup
    const areaMap = new Map<string, string>();
    for (const area of areas) {
      if (area.area_id && area.name) {
        areaMap.set(area.area_id, area.name);
      }
    }

    const filteredDevices = filterEverythingPresenceDevices(
      devices
      .map((d: any) => ({
        id: d.id as string,
        name: (d.name_by_user as string) || (d.name as string) || 'Unnamed device',
        manufacturer: normalizeManufacturer(d.manufacturer) || undefined,
        model: d.model as string | undefined,
        firmwareVersion: d.sw_version as string | undefined,
        areaId: d.area_id as string | undefined,
      }))
    );

    // Enrich with entity name prefix and area name
    const enrichedDevices = await Promise.all(
      filteredDevices.map(async (device) => {
        const { areaId, ...rest } = device;
        return {
          ...rest,
          entityNamePrefix: await this.getEntityNamePrefixForDevice(device.id),
          areaName: areaId ? areaMap.get(areaId) : undefined,
        };
      })
    );

    return enrichedDevices;
  }
}
