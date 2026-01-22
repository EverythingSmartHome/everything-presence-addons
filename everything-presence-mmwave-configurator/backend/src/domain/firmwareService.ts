import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from '../logger';
import { firmwareStorage, CachedFirmwareEntry } from '../config/firmwareStorage';
import { deviceMappingStorage } from '../config/deviceMappingStorage';
import { FirmwareConfig } from '../config';
import type { IHaWriteClient } from '../ha/writeClient';
import type { IHaReadTransport, EntityState } from '../ha/readTransport';
import { deviceEntityService } from './deviceEntityService';
import type { ResolvedService } from './deviceEntityService';
import {
  DeviceConfig,
  FirmwareIndex,
  FirmwareVariant,
  FirmwareValidation,
  ValidationIssue,
  AvailableUpdate,
  DEFAULT_FIRMWARE_INDEX_URLS,
} from '../types/firmware';

/**
 * ESPHome HTTP Request Update manifest format
 * See: https://esphome.io/components/update/http_request.html
 */
export interface ESPHomeManifest {
  name: string;
  version: string;
  home_assistant_domain?: string;
  new_install_skip_erase?: boolean;
  builds: Array<{
    chipFamily: string;
    ota?: {
      path: string;
      md5?: string;
    };
    parts: Array<{
      path: string;
      offset: number;
    }>;
  }>;
  // Optional fields for changelog/release notes
  releaseUrl?: string;
  releaseSummary?: string;
}

export interface PreparedFirmware {
  deviceId: string;
  token: string;
  version: string;
  localManifestUrl: string;
  releaseSummary?: string;
  releaseUrl?: string;
}

export interface FirmwareServiceDependencies {
  config: FirmwareConfig;
  writeClient?: IHaWriteClient;
  readTransport?: IHaReadTransport;
}

/**
 * Cached firmware index entry
 */
interface CachedIndex {
  data: FirmwareIndex;
  fetchedAt: number;
}

// Cache TTL for firmware indexes (1 hour)
const INDEX_CACHE_TTL = 60 * 60 * 1000;

/**
 * Get the local network IP address
 * Attempts to find a non-loopback IPv4 address
 */
const isDockerEnv = (): boolean => {
  try {
    return fs.existsSync('/.dockerenv') || fs.existsSync('/.dockerinit');
  } catch {
    return false;
  }
};

const isLikelyDockerInterface = (name: string): boolean =>
  name === 'lo' ||
  name.startsWith('docker') ||
  name.startsWith('br-') ||
  name.startsWith('veth') ||
  name.startsWith('tun') ||
  name.startsWith('wg');

const getLocalIpAddress = (): string | null => {
  const interfaces = os.networkInterfaces();
  const preferred: string[] = [];
  const fallback: string[] = [];

  for (const name of Object.keys(interfaces)) {
    const netInterface = interfaces[name];
    if (!netInterface) continue;

    for (const info of netInterface) {
      // Skip loopback and non-IPv4
      if (info.family === 'IPv4' && !info.internal) {
        if (isLikelyDockerInterface(name)) {
          fallback.push(info.address);
        } else {
          preferred.push(info.address);
        }
      }
    }
  }

  return preferred[0] ?? fallback[0] ?? null;
};

export class FirmwareService {
  private readonly config: FirmwareConfig;
  private readonly writeClient?: IHaWriteClient;
  private readonly readTransport?: IHaReadTransport;
  private indexCache: Map<string, CachedIndex> = new Map();

  constructor(deps: FirmwareServiceDependencies) {
    this.config = deps.config;
    this.writeClient = deps.writeClient;
    this.readTransport = deps.readTransport;
  }

  async resolveService(deviceId: string, serviceKey: string): Promise<ResolvedService | null> {
    if (!this.readTransport) {
      return deviceEntityService.getService(deviceId, serviceKey);
    }

    try {
      const services = await this.readTransport.getServicesForTarget({ device_id: [deviceId] });
      if (services.length > 0) {
        const resolved = deviceEntityService.resolveServiceFromList(deviceId, serviceKey, services);
        if (resolved) {
          return resolved;
        }
      }
    } catch (error) {
      logger.warn(
        { deviceId, serviceKey, error: error instanceof Error ? error.message : 'Unknown error' },
        'Failed to resolve service via target services'
      );
    }

    await this.ensureDeviceNodeName(deviceId);
    await this.ensureOriginalObjectIds(deviceId);
    return deviceEntityService.getService(deviceId, serviceKey);
  }

  private async ensureDeviceNodeName(deviceId: string): Promise<void> {
    if (!this.readTransport) return;

    const mapping = deviceEntityService.getMapping(deviceId);
    if (!mapping || mapping.esphomeNodeName) return;

    try {
      const devices = await this.readTransport.listDevices();
      const device = devices.find((entry) => entry.id === deviceId);
      if (!device) return;

      let esphomeNodeName: string | undefined;
      for (const [domain, identifier] of device.identifiers ?? []) {
        if (typeof domain === 'string' && typeof identifier === 'string' && domain.toLowerCase() === 'esphome') {
          esphomeNodeName = identifier;
          break;
        }
      }

      if (!esphomeNodeName) {
        esphomeNodeName = this.slugifyDeviceName(device.name);
      }

      if (!esphomeNodeName) {
        logger.warn(
          { deviceId, name: device.name, nameByUser: device.name_by_user, identifiers: device.identifiers },
          'ESPHome node name not found in device identifiers'
        );
        return;
      }

      mapping.esphomeNodeName = esphomeNodeName;
      await deviceMappingStorage.saveMapping(mapping);
      logger.info({ deviceId, esphomeNodeName }, 'Stored ESPHome node name for service resolution');
    } catch (error) {
      logger.warn(
        { deviceId, error: error instanceof Error ? error.message : 'Unknown error' },
        'Failed to store ESPHome node name'
      );
    }
  }

  private slugifyDeviceName(name: string | null | undefined): string | undefined {
    if (!name) return undefined;
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return slug || undefined;
  }

  private async ensureOriginalObjectIds(deviceId: string): Promise<void> {
    if (!this.readTransport) return;

    const mapping = deviceEntityService.getMapping(deviceId);
    if (!mapping) return;

    if (mapping.entityOriginalObjectIds && Object.keys(mapping.entityOriginalObjectIds).length > 0 &&
      mapping.entityUniqueIds && Object.keys(mapping.entityUniqueIds).length > 0) {
      return;
    }

    try {
      const registry = await this.readTransport.listEntityRegistry();
      const registryById = new Map(registry.map((entry) => [entry.entity_id, entry]));
      const originalObjectIds: Record<string, string> = {};
      const uniqueIds: Record<string, string> = {};

      for (const entityId of Object.values(mapping.mappings)) {
        if (!entityId) continue;
        const entry = registryById.get(entityId);
        const originalObjectId = entry?.original_object_id;
        if (originalObjectId) {
          originalObjectIds[entityId] = originalObjectId;
        }
        const uniqueId = entry?.unique_id;
        if (uniqueId) {
          uniqueIds[entityId] = uniqueId;
        }
      }

      if (Object.keys(originalObjectIds).length === 0 && Object.keys(uniqueIds).length === 0) {
        return;
      }

      if (Object.keys(originalObjectIds).length > 0) {
        mapping.entityOriginalObjectIds = originalObjectIds;
      }
      if (Object.keys(uniqueIds).length > 0) {
        mapping.entityUniqueIds = uniqueIds;
      }
      await deviceMappingStorage.saveMapping(mapping);
      logger.info(
        { deviceId, originalCount: Object.keys(originalObjectIds).length, uniqueCount: Object.keys(uniqueIds).length },
        'Stored entity registry ids for service resolution'
      );
    } catch (error) {
      logger.warn(
        { deviceId, error: error instanceof Error ? error.message : 'Unknown error' },
        'Failed to store entity registry ids'
      );
    }
  }

  /**
   * Get the LAN IP address to use for firmware URLs
   * Uses override if set, otherwise auto-detects
   */
  getLanIp(): string {
    // Check for override in config (from env var)
    if (this.config.lanIpOverride) {
      return this.config.lanIpOverride;
    }

    // Check for override in settings (user-configured)
    const settings = firmwareStorage.getSettings();
    if (settings.lanIpOverride) {
      return settings.lanIpOverride;
    }

    // Auto-detect
    const detected = getLocalIpAddress();
    if (detected) {
      if (isDockerEnv()) {
        logger.warn(
          { detectedIp: detected },
          'Detected Docker environment; auto-detected LAN IP may be container address. Set LAN IP override or FIRMWARE_LAN_IP if devices cannot reach this IP.'
        );
      }
      return detected;
    }

    // Fallback to localhost (won't work for devices, but better than nothing)
    logger.warn('Could not auto-detect LAN IP address, using localhost');
    return '127.0.0.1';
  }

  /**
   * Fetch the remote manifest from HTTPS
   */
  async fetchRemoteManifest(manifestUrl: string): Promise<ESPHomeManifest> {
    logger.info({ url: manifestUrl }, 'Fetching remote manifest');

    const response = await fetch(manifestUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch manifest: ${response.status} ${response.statusText}`);
    }

    const manifest = await response.json() as ESPHomeManifest;

    if (!manifest.name || !manifest.version || !manifest.builds) {
      throw new Error('Invalid manifest format: missing required fields');
    }

    logger.info({ name: manifest.name, version: manifest.version }, 'Fetched manifest');
    return manifest;
  }

  /**
   * Download a binary file to the specified path
   */
  async downloadBinary(url: string, destPath: string): Promise<void> {
    logger.info({ url, destPath }, 'Downloading binary');

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download binary: ${response.status} ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    fs.writeFileSync(destPath, Buffer.from(buffer));

    const stats = fs.statSync(destPath);
    logger.info({ destPath, size: stats.size }, 'Downloaded binary');
  }

  /**
   * Rewrite manifest paths to use relative filenames
   * Since manifest and binaries are served from the same directory,
   * relative paths work and avoid IP detection issues
   */
  rewriteManifest(manifest: ESPHomeManifest): ESPHomeManifest {
    const rewritten: ESPHomeManifest = {
      ...manifest,
      builds: manifest.builds.map((build) => ({
        ...build,
        // Rewrite OTA path if present
        ota: build.ota
          ? {
              ...build.ota,
              path: path.basename(build.ota.path),
            }
          : undefined,
        // Rewrite parts paths
        parts: build.parts.map((part) => ({
          ...part,
          // Use just the filename - relative to the manifest location
          path: path.basename(part.path),
        })),
      })),
    };

    return rewritten;
  }

  /**
   * Prepare firmware for a device by downloading and caching it locally
   */
  async prepareFirmwareForDevice(
    deviceId: string,
    manifestUrl: string
  ): Promise<PreparedFirmware> {
    const token = firmwareStorage.generateToken();
    const cacheDir = firmwareStorage.ensureDeviceCacheDir(deviceId, token);
    const lanIp = this.getLanIp();
    const localBaseUrl = `http://${lanIp}:${this.config.lanPort}/fw/${deviceId}/${token}`;

    logger.info({ deviceId, token, manifestUrl, localBaseUrl }, 'Preparing firmware');

    try {
      // 1. Fetch the remote manifest
      const manifest = await this.fetchRemoteManifest(manifestUrl);

      // 2. Determine the base URL for binary downloads
      const manifestUrlObj = new URL(manifestUrl);
      const manifestDir = manifestUrlObj.href.substring(0, manifestUrlObj.href.lastIndexOf('/'));

      // 3. Download all binary files (parts and OTA)
      const binaryPaths: string[] = [];
      for (const build of manifest.builds) {
        // Download OTA binary if present
        if (build.ota) {
          const otaUrl = build.ota.path.startsWith('http')
            ? build.ota.path
            : `${manifestDir}/${build.ota.path}`;

          const otaFilename = path.basename(build.ota.path);
          const localOtaPath = path.join(cacheDir, otaFilename);

          await this.downloadBinary(otaUrl, localOtaPath);
          binaryPaths.push(localOtaPath);
        }

        // Download parts binaries
        for (const part of build.parts) {
          // Resolve the binary URL (could be relative or absolute)
          const binaryUrl = part.path.startsWith('http')
            ? part.path
            : `${manifestDir}/${part.path}`;

          const binaryFilename = path.basename(part.path);
          const localBinaryPath = path.join(cacheDir, binaryFilename);

          await this.downloadBinary(binaryUrl, localBinaryPath);
          binaryPaths.push(localBinaryPath);
        }
      }

      // 4. Rewrite manifest to use relative paths
      const rewrittenManifest = this.rewriteManifest(manifest);

      // 5. Save the rewritten manifest
      const manifestPath = path.join(cacheDir, 'manifest.json');
      fs.writeFileSync(manifestPath, JSON.stringify(rewrittenManifest, null, 2));

      // 6. Save cache entry
      const entry: CachedFirmwareEntry = {
        deviceId,
        token,
        version: manifest.version,
        manifestPath,
        binaryPaths,
        originalManifestUrl: manifestUrl,
        cachedAt: Date.now(),
      };
      firmwareStorage.saveCacheEntry(entry);

      // 7. Cleanup old versions (keep last N distinct versions)
      const settings = firmwareStorage.getSettings();
      const keepCount = typeof settings.cacheKeepCount === 'number' && settings.cacheKeepCount > 0
        ? Math.floor(settings.cacheKeepCount)
        : this.config.maxVersionsPerDevice;
      firmwareStorage.cleanupOldVersions(deviceId, keepCount);

      const localManifestUrl = `${localBaseUrl}/manifest.json`;

      logger.info(
        { deviceId, token, version: manifest.version, localManifestUrl },
        'Firmware prepared successfully'
      );

      return {
        deviceId,
        token,
        version: manifest.version,
        localManifestUrl,
        releaseSummary: manifest.releaseSummary,
        releaseUrl: manifest.releaseUrl,
      };
    } catch (error) {
      // Clean up on failure
      try {
        firmwareStorage.deleteCacheEntry(deviceId, token);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  /**
   * Trigger a device to update using the ESPHome set_update_manifest service
   * This calls the custom ESPHome service that sets the URL and triggers the update
   */
  async triggerDeviceUpdate(
    deviceId: string,
    localManifestUrl: string
  ): Promise<void> {
    if (!this.writeClient) {
      throw new Error('Write client not available');
    }

    const service = await this.resolveService(deviceId, 'setUpdateManifest');
    if (!service) {
      throw new Error('Update manifest service not mapped');
    }

    logger.info({ deviceId, localManifestUrl, service: service.service }, 'Triggering device update via ESPHome service');

    try {
      // Call the ESPHome service: esphome.<device_name>_set_update_manifest
      // This service sets the manifest URL and triggers the update
      await this.writeClient.callService(service.domain, service.service, {
        url: localManifestUrl,
      });

      logger.info({ deviceId, service: service.service }, 'Update triggered successfully');
    } catch (error) {
      logger.error({ error, deviceId, service: service.service }, 'Failed to trigger update');
      throw error;
    }
  }

  /**
   * Set the update manifest URL on a device via a text entity
   * This is used when the device has a configurable manifest URL
   */
  async setDeviceManifestUrl(
    textEntityId: string,
    manifestUrl: string
  ): Promise<void> {
    if (!this.writeClient) {
      throw new Error('Write client not available');
    }

    logger.info({ textEntityId, manifestUrl }, 'Setting device manifest URL');

    await this.writeClient.setTextEntity(textEntityId, manifestUrl);

    logger.info({ textEntityId }, 'Manifest URL set successfully');
  }

  /**
   * Press a button entity to trigger firmware update
   */
  async pressUpdateButton(buttonEntityId: string): Promise<void> {
    if (!this.writeClient) {
      throw new Error('Write client not available');
    }

    logger.info({ buttonEntityId }, 'Pressing update button');

    await this.writeClient.callService('button', 'press', {
      entity_id: buttonEntityId,
    });

    logger.info({ buttonEntityId }, 'Update button pressed');
  }

  /**
   * Get all cached firmware entries
   */
  getCachedFirmware(): CachedFirmwareEntry[] {
    return firmwareStorage.getAllEntries();
  }

  /**
   * Get cached firmware for a specific device
   */
  getDeviceCachedFirmware(deviceId: string): CachedFirmwareEntry[] {
    return firmwareStorage.getDeviceEntries(deviceId);
  }

  /**
   * Delete a cached firmware entry
   */
  deleteCachedFirmware(deviceId: string, token: string): boolean {
    return firmwareStorage.deleteCacheEntry(deviceId, token);
  }

  // ─────────────────────────────────────────────────────────────────
  // Auto-Update System Methods
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get device configuration by calling the get_build_flags ESPHome service.
   * This service returns the device's build configuration directly.
   *
   * Returns configSource='inferred' if the service doesn't exist (device needs firmware update first)
   */
  async getDeviceConfig(
    deviceModel: string,
    firmwareVersion: string,
    deviceId: string
  ): Promise<DeviceConfig> {
    if (!this.writeClient) {
      throw new Error('Write client not available');
    }

    const service = await this.resolveService(deviceId, 'getBuildFlags');
    const namePrefix = deviceEntityService.getDeviceNamePrefix(deviceId) ?? '';
    logger.info({ deviceId, deviceModel }, 'Getting device config via get_build_flags service');

    // Determine model from device info (fallback)
    const inferredModel = this.inferModelFromDeviceInfo(deviceModel);

    try {
      if (!service) {
        throw new Error('Build flags service not mapped');
      }

      const response = await this.writeClient.callService(
        service.domain,
        service.service,
        {},
        { returnResponse: true }
      );

      logger.info({ response, responseType: typeof response }, 'get_build_flags service response');

      // Parse the response - it could be in different formats depending on HA version
      let configData: Record<string, unknown> | null = null;

      if (response && typeof response === 'object') {
        // Check if response is an array (HA returns array of state changes for some services)
        if (Array.isArray(response)) {
          // If it's an array with service_response, extract it
          // Some HA versions nest the response
          if (response.length > 0 && typeof response[0] === 'object') {
            configData = response[0] as Record<string, unknown>;
          }
        } else {
          // Direct object response - check for nested service_response or use directly
          const respObj = response as Record<string, unknown>;
          if (respObj.service_response && typeof respObj.service_response === 'object') {
            configData = respObj.service_response as Record<string, unknown>;
          } else if (respObj.response && typeof respObj.response === 'object') {
            configData = respObj.response as Record<string, unknown>;
          } else if ('ethernet_enabled' in respObj || 'model' in respObj) {
            // Direct response with config fields
            configData = respObj;
          }
        }
      }

      if (configData && ('ethernet_enabled' in configData || 'model' in configData || 'co2_enabled' in configData)) {
        const config: DeviceConfig = {
          model: (configData.model as DeviceConfig['model']) || inferredModel,
          ethernet_enabled: Boolean(configData.ethernet_enabled),
          co2_enabled: Boolean(configData.co2_enabled),
          bluetooth_enabled: Boolean(configData.bluetooth_enabled),
          board_revision: String(configData.board_revision || ''),
          sensor_variant: String(configData.sensor_variant || ''),
          firmware_channel: (configData.firmware_channel as DeviceConfig['firmware_channel']) || 'stable',
          configSource: 'entities',
        };

        logger.info({ config }, 'Device config retrieved from get_build_flags service');
        return config;
      }

      logger.warn({ response }, 'get_build_flags returned unexpected format, falling back to inference');
    } catch (error) {
      // Service call failed - device likely has old firmware without this service
      logger.info(
        { deviceId, error: error instanceof Error ? error.message : 'Unknown error' },
        'get_build_flags service not available, falling back to inference'
      );
    }

    // Fallback to inferred config for devices without the service
    const config: DeviceConfig = {
      model: inferredModel,
      ethernet_enabled: false,
      co2_enabled: false,
      bluetooth_enabled: false,
      board_revision: this.inferBoardRevision(inferredModel, firmwareVersion),
      sensor_variant: this.inferSensorVariant(inferredModel, namePrefix),
      firmware_channel: this.inferFirmwareChannel(firmwareVersion),
      configSource: 'inferred',
    };

    logger.info({ config }, 'Device config inferred (service not available or returned unexpected format)');
    return config;
  }

  /**
   * Infer model from Home Assistant device model string
   */
  private inferModelFromDeviceInfo(deviceModel: string): DeviceConfig['model'] {
    const lower = deviceModel.toLowerCase();
    if (lower.includes('pro')) {
      return 'everything-presence-pro';
    }
    if (lower.includes('lite')) {
      return 'everything-presence-lite';
    }
    // Default to EP1 for "Everything Presence One" or similar
    return 'everything-presence-one';
  }

  /**
   * Infer board revision from model and firmware version
   * This is a best-effort guess - ideally firmware should expose this
   */
  private inferBoardRevision(model: DeviceConfig['model'], firmwareVersion: string): string {
    // Default revisions by model
    switch (model) {
      case 'everything-presence-lite':
        return '1.2';
      case 'everything-presence-pro':
        return '1.8';
      case 'everything-presence-one':
        // EP1 has multiple revisions, default to 1.5
        return '1.5';
      default:
        return '1.0';
    }
  }

  /**
   * Infer sensor variant from model and entity patterns
   */
  private inferSensorVariant(model: DeviceConfig['model'], entityPrefix: string): string {
    switch (model) {
      case 'everything-presence-lite':
        // Default LD2450, check entity prefix for alternatives
        if (entityPrefix.includes('sen0609')) return 'sen0609';
        if (entityPrefix.includes('sen0395')) return 'sen0395';
        if (entityPrefix.includes('ld2410')) return 'ld2410';
        if (entityPrefix.includes('mr24hpc1')) return 'mr24hpc1';
        return ''; // Default LD2450
      case 'everything-presence-pro':
        return 'ld2450+sen0609';
      case 'everything-presence-one':
        // Check for SEN0609 vs legacy SEN0395
        if (entityPrefix.includes('sen0609')) return 'sen0609';
        return 'sen0395'; // Legacy default
      default:
        return '';
    }
  }

  /**
   * Infer firmware channel from version string
   */
  private inferFirmwareChannel(version: string): DeviceConfig['firmware_channel'] {
    if (version.toLowerCase().includes('beta')) {
      return 'beta';
    }
    return 'stable';
  }

  /**
   * Fetch a firmware index from a URL with caching
   */
  async fetchFirmwareIndex(url: string): Promise<FirmwareIndex | null> {
    // Check cache first
    const cached = this.indexCache.get(url);
    if (cached && Date.now() - cached.fetchedAt < INDEX_CACHE_TTL) {
      logger.debug({ url }, 'Using cached firmware index');
      return cached.data;
    }

    try {
      logger.info({ url }, 'Fetching firmware index');
      const response = await fetch(url);

      if (!response.ok) {
        logger.warn({ url, status: response.status }, 'Failed to fetch firmware index');
        return null;
      }

      const index = await response.json() as FirmwareIndex;

      // Validate basic structure
      if (!index.schemaVersion || !index.product || !index.firmwares) {
        logger.warn({ url }, 'Invalid firmware index format');
        return null;
      }

      // Cache the result
      this.indexCache.set(url, {
        data: index,
        fetchedAt: Date.now(),
      });

      logger.info({ url, product: index.product.id, version: index.product.latestVersion }, 'Fetched firmware index');
      return index;
    } catch (error) {
      logger.error({ error, url }, 'Error fetching firmware index');
      return null;
    }
  }

  /**
   * Fetch all firmware indexes from configured URLs
   */
  async fetchAllFirmwareIndexes(): Promise<FirmwareIndex[]> {
    // Get custom URLs from settings, or use defaults
    const settings = firmwareStorage.getSettings();
    const urls = settings.firmwareIndexUrls || Object.values(DEFAULT_FIRMWARE_INDEX_URLS);

    const results = await Promise.all(
      urls.map((url) => this.fetchFirmwareIndex(url))
    );

    return results.filter((index): index is FirmwareIndex => index !== null);
  }

  /**
   * Find matching firmware variant for a device config
   */
  findMatchingFirmware(
    deviceConfig: DeviceConfig,
    indexes: FirmwareIndex[]
  ): FirmwareVariant | null {
    // Find the product index matching device model
    const productIndex = indexes.find(
      (idx) => idx.product.id === deviceConfig.model
    );

    if (!productIndex) {
      logger.warn({ model: deviceConfig.model }, 'No firmware index found for model');
      return null;
    }

    // Find firmware matching device's channel
    const channelFirmwares = productIndex.firmwares.filter(
      (fw) => fw.channel === deviceConfig.firmware_channel
    );

    if (channelFirmwares.length === 0) {
      logger.warn({ model: deviceConfig.model, channel: deviceConfig.firmware_channel }, 'No firmware found for channel');
      return null;
    }

    // Get latest version for this channel
    const latestFirmware = channelFirmwares.sort((a, b) =>
      this.compareVersions(b.version, a.version)
    )[0];

    // Find variant matching ALL device config fields
    const matchingVariant = latestFirmware.variants.find((variant) => {
      const req = variant.requirements;
      return (
        req.model === deviceConfig.model &&
        req.ethernet_enabled === deviceConfig.ethernet_enabled &&
        req.co2_enabled === deviceConfig.co2_enabled &&
        req.bluetooth_enabled === deviceConfig.bluetooth_enabled &&
        req.board_revision === deviceConfig.board_revision &&
        req.sensor_variant === deviceConfig.sensor_variant &&
        req.firmware_channel === deviceConfig.firmware_channel
      );
    });

    if (!matchingVariant) {
      logger.warn({ deviceConfig }, 'No matching firmware variant found');
    }

    return matchingVariant || null;
  }

  /**
   * Compare semantic version strings
   * Returns: negative if a < b, positive if a > b, 0 if equal
   */
  private compareVersions(a: string, b: string): number {
    const parseVersion = (v: string) => {
      const parts = v.replace(/^v/, '').split(/[-+]/)[0].split('.');
      return parts.map((p) => parseInt(p, 10) || 0);
    };

    const aParts = parseVersion(a);
    const bParts = parseVersion(b);
    const len = Math.max(aParts.length, bParts.length);

    for (let i = 0; i < len; i++) {
      const aVal = aParts[i] || 0;
      const bVal = bParts[i] || 0;
      if (aVal !== bVal) {
        return aVal - bVal;
      }
    }

    return 0;
  }

  /**
   * Check if a version satisfies a simple comparator range (e.g., "<1.5.0", ">=1.2.0").
   */
  private matchesVersionRange(version: string, range: string): boolean {
    if (!version || !range) return false;
    const trimmed = range.trim();
    const match = trimmed.match(/^(<=|>=|<|>|=)?\s*v?(\d+(?:\.\d+){0,2})/);
    if (!match) return false;

    const op = match[1] || '=';
    const target = match[2];
    const comparison = this.compareVersions(version, target);

    switch (op) {
      case '<':
        return comparison < 0;
      case '<=':
        return comparison <= 0;
      case '>':
        return comparison > 0;
      case '>=':
        return comparison >= 0;
      default:
        return comparison === 0;
    }
  }

  /**
   * Validate firmware compatibility with device config
   */
  validateFirmwareCompatibility(
    deviceConfig: DeviceConfig,
    firmwareVariant: FirmwareVariant
  ): FirmwareValidation {
    const hardBlocks: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    const req = firmwareVariant.requirements;

    // Hard blocks - will break the device
    if (req.model !== deviceConfig.model) {
      hardBlocks.push({
        field: 'model',
        deviceValue: deviceConfig.model,
        firmwareValue: req.model,
        message: `Cannot install ${req.model} firmware on ${deviceConfig.model} device`,
        severity: 'hard_block',
      });
    }

    if (req.ethernet_enabled !== deviceConfig.ethernet_enabled) {
      hardBlocks.push({
        field: 'ethernet_enabled',
        deviceValue: deviceConfig.ethernet_enabled,
        firmwareValue: req.ethernet_enabled,
        message: `Network type mismatch: device is ${deviceConfig.ethernet_enabled ? 'Ethernet' : 'WiFi'}, firmware is for ${req.ethernet_enabled ? 'Ethernet' : 'WiFi'}. This could cause connectivity loss.`,
        severity: 'hard_block',
      });
    }

    if (req.sensor_variant !== deviceConfig.sensor_variant) {
      hardBlocks.push({
        field: 'sensor_variant',
        deviceValue: deviceConfig.sensor_variant,
        firmwareValue: req.sensor_variant,
        message: `Sensor mismatch: device has ${deviceConfig.sensor_variant || 'default'} sensor, firmware is for ${req.sensor_variant || 'default'}`,
        severity: 'hard_block',
      });
    }

    // Soft warnings - may cause issues but device will work
    if (req.co2_enabled !== deviceConfig.co2_enabled) {
      warnings.push({
        field: 'co2_enabled',
        deviceValue: deviceConfig.co2_enabled,
        firmwareValue: req.co2_enabled,
        message: `CO2 module mismatch: device has CO2 ${deviceConfig.co2_enabled ? 'enabled' : 'disabled'}, firmware has CO2 ${req.co2_enabled ? 'enabled' : 'disabled'}`,
        severity: 'warning',
      });
    }

    if (req.bluetooth_enabled !== deviceConfig.bluetooth_enabled) {
      warnings.push({
        field: 'bluetooth_enabled',
        deviceValue: deviceConfig.bluetooth_enabled,
        firmwareValue: req.bluetooth_enabled,
        message: `Bluetooth mismatch: device has BLE ${deviceConfig.bluetooth_enabled ? 'enabled' : 'disabled'}, firmware has BLE ${req.bluetooth_enabled ? 'enabled' : 'disabled'}`,
        severity: 'warning',
      });
    }

    if (req.board_revision !== deviceConfig.board_revision) {
      warnings.push({
        field: 'board_revision',
        deviceValue: deviceConfig.board_revision,
        firmwareValue: req.board_revision,
        message: `Board revision mismatch: device is rev ${deviceConfig.board_revision}, firmware is for rev ${req.board_revision}`,
        severity: 'warning',
      });
    }

    return {
      valid: hardBlocks.length === 0,
      hardBlocks,
      warnings,
    };
  }

  /**
   * Get available updates for a device
   */
  async getAvailableUpdates(
    deviceConfig: DeviceConfig,
    currentVersion: string
  ): Promise<AvailableUpdate[]> {
    const indexes = await this.fetchAllFirmwareIndexes();

    if (indexes.length === 0) {
      logger.warn('No firmware indexes available');
      return [];
    }

    // Find product index
    const productIndex = indexes.find((idx) => idx.product.id === deviceConfig.model);
    if (!productIndex) {
      return [];
    }

    const updates: AvailableUpdate[] = [];

    // Check each firmware release for matching variants
    for (const firmware of productIndex.firmwares) {
      // Only show firmware matching current channel
      if (firmware.channel !== deviceConfig.firmware_channel) {
        continue;
      }

      // Check if this is a newer version
      if (this.compareVersions(firmware.version, currentVersion) <= 0) {
        continue;
      }

      // Find matching variant
      const variant = firmware.variants.find((v) => {
        const req = v.requirements;
        return (
          req.model === deviceConfig.model &&
          req.ethernet_enabled === deviceConfig.ethernet_enabled &&
          req.co2_enabled === deviceConfig.co2_enabled &&
          req.bluetooth_enabled === deviceConfig.bluetooth_enabled &&
          req.board_revision === deviceConfig.board_revision &&
          req.sensor_variant === deviceConfig.sensor_variant
        );
      });

      if (variant) {
        // Check for migrations
        const migration = productIndex.migrations.find((m) => {
          if (m.id !== 'rectangular-to-polygon-zones') return false;
          return this.matchesVersionRange(currentVersion, m.fromVersion) &&
            this.matchesVersionRange(firmware.version, m.toVersion);
        });

        updates.push({
          currentVersion,
          newVersion: firmware.version,
          channel: firmware.channel,
          releaseNotes: firmware.releaseNotes,
          variant,
          migration,
        });
      }
    }

    return updates;
  }

  /**
   * Clear the firmware index cache
   */
  clearIndexCache(): void {
    this.indexCache.clear();
    logger.info('Firmware index cache cleared');
  }
}
