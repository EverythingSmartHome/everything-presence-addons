import { Router } from 'express';
import { FirmwareService } from '../domain/firmwareService';
import { firmwareStorage } from '../config/firmwareStorage';
import { logger } from '../logger';
import type { IHaWriteClient } from '../ha/writeClient';
import type { IHaReadTransport } from '../ha/readTransport';
import type { FirmwareConfig } from '../config';
import { DEFAULT_FIRMWARE_INDEX_URLS } from '../types/firmware';
import { deviceEntityService } from '../domain/deviceEntityService';

export interface FirmwareRouterDependencies {
  config: FirmwareConfig;
  writeClient: IHaWriteClient;
  readTransport?: IHaReadTransport;
}

export const createFirmwareRouter = (deps: FirmwareRouterDependencies): Router => {
  const router = Router();
  const firmwareService = new FirmwareService({
    config: deps.config,
    writeClient: deps.writeClient,
    readTransport: deps.readTransport,
  });

  /**
   * GET /api/firmware/settings
   * Get firmware update settings and auto-detected LAN IP
   */
  router.get('/settings', (_req, res) => {
    try {
      const settings = firmwareStorage.getSettings();
      const autoDetectedIp = firmwareService.getLanIp();
      const lanPort = deps.config.lanPort;
      const effectiveCacheKeepCount =
        typeof settings.cacheKeepCount === 'number' && settings.cacheKeepCount > 0
          ? Math.floor(settings.cacheKeepCount)
          : deps.config.maxVersionsPerDevice;

      res.json({
        settings: {
          ...settings,
          cacheKeepCount: effectiveCacheKeepCount,
        },
        autoDetectedIp,
        lanPort,
        // Computed URL that devices will use
        firmwareServerUrl: `http://${autoDetectedIp}:${lanPort}`,
        // Default firmware index URLs (for reference)
        defaultIndexUrls: DEFAULT_FIRMWARE_INDEX_URLS,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get firmware settings');
      res.status(500).json({ error: 'Failed to get firmware settings' });
    }
  });

  /**
   * PUT /api/firmware/settings
   * Update firmware settings (LAN IP override, firmware base URL, index URLs)
   */
  router.put('/settings', (req, res) => {
    try {
      const updates: Record<string, unknown> = {};

      if (typeof req.body?.lanIpOverride === 'string') {
        updates.lanIpOverride = req.body.lanIpOverride || undefined; // Empty string = clear
      } else if (req.body?.lanIpOverride === null) {
        updates.lanIpOverride = undefined;
      }

      if (typeof req.body?.firmwareBaseUrl === 'string') {
        updates.firmwareBaseUrl = req.body.firmwareBaseUrl || undefined;
      } else if (req.body?.firmwareBaseUrl === null) {
        updates.firmwareBaseUrl = undefined;
      }

      // Handle firmwareIndexUrls
      if (Array.isArray(req.body?.firmwareIndexUrls)) {
        const urls = req.body.firmwareIndexUrls.filter(
          (url: unknown) => typeof url === 'string' && url.trim()
        );
        updates.firmwareIndexUrls = urls.length > 0 ? urls : undefined;
      } else if (req.body?.firmwareIndexUrls === null) {
        updates.firmwareIndexUrls = undefined;
      }

      if (typeof req.body?.cacheKeepCount === 'number') {
        const normalized = Math.floor(req.body.cacheKeepCount);
        updates.cacheKeepCount = normalized > 0 ? normalized : undefined;
      } else if (typeof req.body?.cacheKeepCount === 'string') {
        const parsed = Number(req.body.cacheKeepCount);
        if (Number.isFinite(parsed)) {
          const normalized = Math.floor(parsed);
          updates.cacheKeepCount = normalized > 0 ? normalized : undefined;
        }
      } else if (req.body?.cacheKeepCount === null) {
        updates.cacheKeepCount = undefined;
      }

      const settings = firmwareStorage.saveSettings(updates);
      const autoDetectedIp = firmwareService.getLanIp();
      const effectiveCacheKeepCount =
        typeof settings.cacheKeepCount === 'number' && settings.cacheKeepCount > 0
          ? Math.floor(settings.cacheKeepCount)
          : deps.config.maxVersionsPerDevice;

      // Clear index cache when URLs change
      if ('firmwareIndexUrls' in updates) {
        firmwareService.clearIndexCache();
      }

      res.json({
        settings: {
          ...settings,
          cacheKeepCount: effectiveCacheKeepCount,
        },
        autoDetectedIp,
        lanPort: deps.config.lanPort,
        firmwareServerUrl: `http://${autoDetectedIp}:${deps.config.lanPort}`,
        defaultIndexUrls: DEFAULT_FIRMWARE_INDEX_URLS,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to update firmware settings');
      res.status(500).json({ error: 'Failed to update firmware settings' });
    }
  });

  /**
   * POST /api/firmware/prepare
   * Download and cache firmware for a device
   * Body: { deviceId: string, manifestUrl: string }
   */
  router.post('/prepare', async (req, res) => {
    try {
      const { deviceId, manifestUrl, deviceModel, firmwareVersion } = req.body;

      if (!deviceId || typeof deviceId !== 'string') {
        return res.status(400).json({ error: 'deviceId is required' });
      }

      if (!manifestUrl || typeof manifestUrl !== 'string') {
        return res.status(400).json({ error: 'manifestUrl is required' });
      }

      if (!deviceModel || typeof deviceModel !== 'string') {
        return res.status(400).json({ error: 'deviceModel is required' });
      }

      if (!firmwareVersion || typeof firmwareVersion !== 'string') {
        return res.status(400).json({ error: 'firmwareVersion is required' });
      }

      // Validate URL format
      try {
        new URL(manifestUrl);
      } catch {
        return res.status(400).json({ error: 'Invalid manifestUrl format' });
      }

      const deviceConfig = await firmwareService.getDeviceConfig(
        deviceModel,
        firmwareVersion,
        deviceId
      );

      if (deviceConfig.configSource !== 'entities') {
        return res.status(409).json({
          error: 'Device build config not available. Firmware updates are disabled to prevent mismatched installs.',
          deviceConfig,
        });
      }

      logger.info({ deviceId, manifestUrl }, 'Preparing firmware');

      const result = await firmwareService.prepareFirmwareForDevice(deviceId, manifestUrl);

      res.json({
        success: true,
        deviceId: result.deviceId,
        token: result.token,
        version: result.version,
        localManifestUrl: result.localManifestUrl,
        releaseSummary: result.releaseSummary,
        releaseUrl: result.releaseUrl,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to prepare firmware');
      res.status(500).json({
        error: 'Failed to prepare firmware',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/firmware/update/:deviceId
   * Trigger a device to update using the prepared firmware
   * Body: { token: string }
   */
  router.post('/update/:deviceId', async (req, res) => {
    try {
      const { deviceId } = req.params;
      const { token } = req.body;

      if (!token || typeof token !== 'string') {
        return res.status(400).json({ error: 'token is required' });
      }

      // Verify the cache entry exists
      const entry = firmwareStorage.getCacheEntry(deviceId, token);
      if (!entry) {
        return res.status(404).json({ error: 'Firmware cache entry not found' });
      }

      const updateService = deviceEntityService.getService(deviceId, 'setUpdateManifest');
      if (!updateService) {
        return res.status(409).json({
          error: 'Firmware update service not mapped. Run entity discovery to sync device entities.',
          code: 'SERVICE_NOT_MAPPED',
          serviceKey: 'setUpdateManifest',
        });
      }

      const lanIp = firmwareService.getLanIp();
      const localManifestUrl = `http://${lanIp}:${deps.config.lanPort}/fw/${deviceId}/${token}/manifest.json`;

      logger.info({ deviceId, token, localManifestUrl }, 'Triggering device update');

      // Call the ESPHome service to set manifest URL and trigger update
      await firmwareService.triggerDeviceUpdate(deviceId, localManifestUrl);

      res.json({
        success: true,
        deviceId,
        localManifestUrl,
        version: entry.version,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to trigger device update');
      res.status(500).json({
        error: 'Failed to trigger device update',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/firmware/update-status/:deviceId
   * Get the update entity state for a device
   */
  router.get('/update-status/:deviceId', async (req, res) => {
    try {
      if (!deps.readTransport) {
        return res.status(503).json({ error: 'Read transport not available' });
      }

      const { deviceId } = req.params;
      const mapping = deviceEntityService.getMapping(deviceId);
      if (!mapping) {
        return res.status(404).json({
          error: 'Device mapping not found',
          code: 'MAPPING_NOT_FOUND',
        });
      }

      const updateEntityId = deviceEntityService.getEntityId(deviceId, 'firmwareUpdateEntity');
      if (!updateEntityId) {
        return res.status(404).json({
          error: 'Firmware update entity not mapped',
          code: 'ENTITY_NOT_FOUND',
          entityKey: 'firmwareUpdateEntity',
        });
      }

      const state = await deps.readTransport.getState(updateEntityId);
      if (!state) {
        return res.status(503).json({ error: 'Update entity state unavailable' });
      }

      res.json({
        entityId: updateEntityId,
        name: null,
        state: state.state,
        attributes: state.attributes,
        lastChanged: state.last_changed,
        lastUpdated: state.last_updated,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to fetch update entity status');
      res.status(500).json({ error: 'Failed to fetch update status' });
    }
  });

  /**
   * GET /api/firmware/cache
   * List all cached firmware entries
   */
  router.get('/cache', (_req, res) => {
    try {
      const entries = firmwareService.getCachedFirmware();
      res.json({
        entries: entries.map((e) => ({
          deviceId: e.deviceId,
          token: e.token,
          version: e.version,
          originalManifestUrl: e.originalManifestUrl,
          cachedAt: e.cachedAt,
          binaryCount: e.binaryPaths.length,
        })),
      });
    } catch (error) {
      logger.error({ error }, 'Failed to list firmware cache');
      res.status(500).json({ error: 'Failed to list firmware cache' });
    }
  });

  /**
   * GET /api/firmware/cache/:deviceId
   * List cached firmware for a specific device
   */
  router.get('/cache/:deviceId', (req, res) => {
    try {
      const { deviceId } = req.params;
      const entries = firmwareService.getDeviceCachedFirmware(deviceId);
      res.json({
        deviceId,
        entries: entries.map((e) => ({
          token: e.token,
          version: e.version,
          originalManifestUrl: e.originalManifestUrl,
          cachedAt: e.cachedAt,
          binaryCount: e.binaryPaths.length,
        })),
      });
    } catch (error) {
      logger.error({ error }, 'Failed to list device firmware cache');
      res.status(500).json({ error: 'Failed to list device firmware cache' });
    }
  });

  /**
   * DELETE /api/firmware/cache/:deviceId/:token
   * Delete a specific cached firmware entry
   */
  router.delete('/cache/:deviceId/:token', (req, res) => {
    try {
      const { deviceId, token } = req.params;
      const deleted = firmwareService.deleteCachedFirmware(deviceId, token);

      if (!deleted) {
        return res.status(404).json({ error: 'Cache entry not found' });
      }

      res.json({ success: true, deviceId, token });
    } catch (error) {
      logger.error({ error }, 'Failed to delete firmware cache entry');
      res.status(500).json({ error: 'Failed to delete firmware cache entry' });
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // Auto-Update System Endpoints
  // ─────────────────────────────────────────────────────────────────

  /**
   * GET /api/firmware/index
   * Fetch all firmware indexes from configured URLs
   */
  router.get('/index', async (_req, res) => {
    try {
      const indexes = await firmwareService.fetchAllFirmwareIndexes();
      res.json({
        indexes,
        count: indexes.length,
        fetchedAt: new Date().toISOString(),
      });
    } catch (error) {
      logger.error({ error }, 'Failed to fetch firmware indexes');
      res.status(500).json({ error: 'Failed to fetch firmware indexes' });
    }
  });

  /**
   * POST /api/firmware/index/refresh
   * Clear the firmware index cache and refetch
   */
  router.post('/index/refresh', async (_req, res) => {
    try {
      firmwareService.clearIndexCache();
      const indexes = await firmwareService.fetchAllFirmwareIndexes();
      res.json({
        indexes,
        count: indexes.length,
        fetchedAt: new Date().toISOString(),
      });
    } catch (error) {
      logger.error({ error }, 'Failed to refresh firmware indexes');
      res.status(500).json({ error: 'Failed to refresh firmware indexes' });
    }
  });

  /**
   * POST /api/firmware/device-config
   * Get device configuration by reading firmware info entities
   * Body: { deviceModel: string, firmwareVersion: string, deviceId: string }
   */
  router.post('/device-config', async (req, res) => {
    try {
      const { deviceModel, firmwareVersion, deviceId } = req.body;

      if (!deviceModel || typeof deviceModel !== 'string') {
        return res.status(400).json({ error: 'deviceModel is required' });
      }

      if (!firmwareVersion || typeof firmwareVersion !== 'string') {
        return res.status(400).json({ error: 'firmwareVersion is required' });
      }

      if (!deviceId || typeof deviceId !== 'string') {
        return res.status(400).json({ error: 'deviceId is required' });
      }

      const config = await firmwareService.getDeviceConfig(deviceModel, firmwareVersion, deviceId);
      res.json({ config });
    } catch (error) {
      logger.error({ error }, 'Failed to get device config');
      res.status(500).json({
        error: 'Failed to get device config',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/firmware/available
   * Get available firmware updates for a device
   * Body: { deviceModel: string, currentVersion: string, deviceId: string }
   */
  router.post('/available', async (req, res) => {
    try {
      const { deviceModel, currentVersion, deviceId } = req.body;

      if (!deviceModel || typeof deviceModel !== 'string') {
        return res.status(400).json({ error: 'deviceModel is required' });
      }

      if (!currentVersion || typeof currentVersion !== 'string') {
        return res.status(400).json({ error: 'currentVersion is required' });
      }

      if (!deviceId || typeof deviceId !== 'string') {
        return res.status(400).json({ error: 'deviceId is required' });
      }

      const deviceConfig = await firmwareService.getDeviceConfig(deviceModel, currentVersion, deviceId);

      if (deviceConfig.configSource !== 'entities') {
        return res.status(409).json({
          error: 'Device build config not available. Firmware updates are disabled to prevent mismatched installs.',
          deviceConfig,
        });
      }

      const updates = await firmwareService.getAvailableUpdates(deviceConfig, currentVersion);
      res.json({
        updates,
        hasUpdates: updates.length > 0,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get available updates');
      res.status(500).json({
        error: 'Failed to get available updates',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/firmware/validate
   * Validate firmware compatibility with a device
   * Body: { deviceConfig: DeviceConfig, firmwareVariantId: string, productId: string }
   */
  router.post('/validate', async (req, res) => {
    try {
      const { deviceConfig, firmwareVariantId, productId } = req.body;

      if (!deviceConfig || typeof deviceConfig !== 'object') {
        return res.status(400).json({ error: 'deviceConfig is required' });
      }

      if (!firmwareVariantId || typeof firmwareVariantId !== 'string') {
        return res.status(400).json({ error: 'firmwareVariantId is required' });
      }

      if (!productId || typeof productId !== 'string') {
        return res.status(400).json({ error: 'productId is required' });
      }

      // Fetch indexes to find the variant
      const indexes = await firmwareService.fetchAllFirmwareIndexes();
      const productIndex = indexes.find((idx) => idx.product.id === productId);

      if (!productIndex) {
        return res.status(404).json({ error: `Product index not found for ${productId}` });
      }

      // Find the variant in any firmware release
      let firmwareVariant = null;
      for (const firmware of productIndex.firmwares) {
        const variant = firmware.variants.find((v) => v.id === firmwareVariantId);
        if (variant) {
          firmwareVariant = variant;
          break;
        }
      }

      if (!firmwareVariant) {
        return res.status(404).json({ error: `Firmware variant ${firmwareVariantId} not found` });
      }

      const validation = firmwareService.validateFirmwareCompatibility(deviceConfig, firmwareVariant);
      res.json({ validation });
    } catch (error) {
      logger.error({ error }, 'Failed to validate firmware');
      res.status(500).json({
        error: 'Failed to validate firmware',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/firmware/auto-prepare
   * Auto-detect device config, find matching firmware, and prepare for update
   * Body: { deviceModel: string, currentVersion: string, deviceId: string }
   */
  router.post('/auto-prepare', async (req, res) => {
    try {
      const { deviceModel, currentVersion, deviceId } = req.body;

      if (!deviceModel || typeof deviceModel !== 'string') {
        return res.status(400).json({ error: 'deviceModel is required' });
      }

      if (!currentVersion || typeof currentVersion !== 'string') {
        return res.status(400).json({ error: 'currentVersion is required' });
      }

      if (!deviceId || typeof deviceId !== 'string') {
        return res.status(400).json({ error: 'deviceId is required' });
      }

      // Get device config
      const deviceConfig = await firmwareService.getDeviceConfig(deviceModel, currentVersion, deviceId);

      if (deviceConfig.configSource !== 'entities') {
        return res.status(409).json({
          error: 'Device build config not available. Firmware updates are disabled to prevent mismatched installs.',
          deviceConfig,
        });
      }

      // Fetch indexes and find matching firmware
      const indexes = await firmwareService.fetchAllFirmwareIndexes();
      const matchingVariant = firmwareService.findMatchingFirmware(deviceConfig, indexes);

      if (!matchingVariant) {
        return res.status(404).json({
          error: 'No matching firmware found',
          deviceConfig,
        });
      }

      // Find the product index to get the base URL
      const productIndex = indexes.find((idx) => idx.product.id === deviceConfig.model);
      if (!productIndex) {
        return res.status(404).json({ error: 'Product index not found' });
      }

      // Construct the full manifest URL
      // The manifestUrl in variant is relative, so we need to build the full URL
      const settings = firmwareStorage.getSettings();
      const baseUrl = settings.firmwareIndexUrls?.[0]?.replace('/firmware-index.json', '') ||
                     DEFAULT_FIRMWARE_INDEX_URLS[deviceConfig.model]?.replace('/firmware-index.json', '');

      if (!baseUrl) {
        return res.status(500).json({ error: 'Could not determine firmware base URL' });
      }

      const fullManifestUrl = `${baseUrl}/${matchingVariant.manifestUrl}`;

      // Validate compatibility
      const validation = firmwareService.validateFirmwareCompatibility(deviceConfig, matchingVariant);

      if (!validation.valid) {
        return res.status(400).json({
          error: 'Firmware compatibility check failed',
          validation,
          deviceConfig,
          matchingVariant,
        });
      }

      // Prepare the firmware
      const prepared = await firmwareService.prepareFirmwareForDevice(deviceId, fullManifestUrl);

      res.json({
        success: true,
        deviceConfig,
        matchingVariant,
        validation,
        prepared,
        newVersion: productIndex.product.latestVersion,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to auto-prepare firmware');
      res.status(500).json({
        error: 'Failed to auto-prepare firmware',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  return router;
};
