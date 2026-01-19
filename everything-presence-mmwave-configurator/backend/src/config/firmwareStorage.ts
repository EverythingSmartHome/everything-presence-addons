import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { logger } from '../logger';

// Use the same base directory as other storage, with a fw_cache subdirectory
const DATA_DIR = process.env.DATA_DIR ?? '/config/everything-presence-zone-configurator';
const FIRMWARE_CACHE_DIR = process.env.FIRMWARE_CACHE_DIR ?? path.join(DATA_DIR, 'fw_cache');
const CACHE_INDEX_FILE = path.join(FIRMWARE_CACHE_DIR, 'cache-index.json');
const SETTINGS_FILE = path.join(FIRMWARE_CACHE_DIR, 'firmware-settings.json');

export interface CachedFirmwareEntry {
  deviceId: string;
  token: string;
  version: string;
  manifestPath: string;
  binaryPaths: string[];
  originalManifestUrl: string;
  cachedAt: number;
}

export interface FirmwareCacheIndex {
  entries: CachedFirmwareEntry[];
}

export interface FirmwareSettings {
  lanIpOverride?: string;
  firmwareBaseUrl?: string;
  firmwareIndexUrls?: string[];
  cacheKeepCount?: number;
}

const ensureCacheDir = (subDir?: string): string => {
  const dir = subDir ? path.join(FIRMWARE_CACHE_DIR, subDir) : FIRMWARE_CACHE_DIR;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
};

const readCacheIndex = (): FirmwareCacheIndex => {
  ensureCacheDir();
  if (!fs.existsSync(CACHE_INDEX_FILE)) {
    return { entries: [] };
  }
  try {
    const raw = fs.readFileSync(CACHE_INDEX_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      entries: Array.isArray(parsed?.entries) ? parsed.entries : [],
    };
  } catch (error) {
    logger.warn({ error }, 'Failed to read firmware cache index; returning empty');
    return { entries: [] };
  }
};

const writeCacheIndex = (index: FirmwareCacheIndex): void => {
  ensureCacheDir();
  fs.writeFileSync(CACHE_INDEX_FILE, JSON.stringify(index, null, 2));
};

const readSettings = (): FirmwareSettings => {
  ensureCacheDir();
  if (!fs.existsSync(SETTINGS_FILE)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
    return JSON.parse(raw) as FirmwareSettings;
  } catch (error) {
    logger.warn({ error }, 'Failed to read firmware settings; returning empty');
    return {};
  }
};

const writeSettings = (settings: FirmwareSettings): void => {
  ensureCacheDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
};

/**
 * Recursively delete a directory and its contents
 */
const deleteDirectory = (dirPath: string): void => {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
};

export const firmwareStorage = {
  /**
   * Generate a unique token for URL security
   */
  generateToken: (): string => crypto.randomBytes(16).toString('hex'),

  /**
   * Get the cache directory path for a device/token combination
   */
  getCacheDir: (deviceId: string, token: string): string => {
    return path.join(FIRMWARE_CACHE_DIR, deviceId, token);
  },

  /**
   * Ensure the cache directory exists for a device/token
   */
  ensureDeviceCacheDir: (deviceId: string, token: string): string => {
    const dir = path.join(FIRMWARE_CACHE_DIR, deviceId, token);
    ensureCacheDir(path.join(deviceId, token));
    return dir;
  },

  /**
   * Save a cache entry to the index
   */
  saveCacheEntry: (entry: CachedFirmwareEntry): void => {
    const index = readCacheIndex();
    const duplicateEntries = index.entries.filter(
      (e) => e.deviceId === entry.deviceId && e.version === entry.version && e.token !== entry.token
    );
    const tokensToDelete = new Set(duplicateEntries.map((e) => e.token));

    for (const duplicate of duplicateEntries) {
      const cacheDir = path.join(FIRMWARE_CACHE_DIR, duplicate.deviceId, duplicate.token);
      try {
        deleteDirectory(cacheDir);
        logger.info(
          { deviceId: duplicate.deviceId, token: duplicate.token, version: duplicate.version },
          'Deleted duplicate firmware cache entry'
        );
      } catch (error) {
        logger.warn({ error, cacheDir }, 'Failed to delete duplicate firmware cache directory');
      }
    }

    // Remove any existing entry with same device/token or duplicate version
    index.entries = index.entries.filter(
      (e) =>
        !(e.deviceId === entry.deviceId && e.token === entry.token) &&
        !(e.deviceId === entry.deviceId && tokensToDelete.has(e.token))
    );
    index.entries.push(entry);
    writeCacheIndex(index);
  },

  /**
   * Get a cache entry by device ID and token
   */
  getCacheEntry: (deviceId: string, token: string): CachedFirmwareEntry | null => {
    const index = readCacheIndex();
    return index.entries.find((e) => e.deviceId === deviceId && e.token === token) ?? null;
  },

  /**
   * Get all cache entries for a device
   */
  getDeviceEntries: (deviceId: string): CachedFirmwareEntry[] => {
    const index = readCacheIndex();
    return index.entries
      .filter((e) => e.deviceId === deviceId)
      .sort((a, b) => b.cachedAt - a.cachedAt); // Most recent first
  },

  /**
   * Get all cache entries
   */
  getAllEntries: (): CachedFirmwareEntry[] => {
    const index = readCacheIndex();
    return index.entries.sort((a, b) => b.cachedAt - a.cachedAt);
  },

  /**
   * Clean up old versions for a device, keeping only the most recent N versions
   */
  cleanupOldVersions: (deviceId: string, keepCount: number = 3): void => {
    const index = readCacheIndex();
    const effectiveKeepCount = Number.isFinite(keepCount) && keepCount > 0 ? Math.floor(keepCount) : 1;
    const deviceEntries = index.entries
      .filter((e) => e.deviceId === deviceId)
      .sort((a, b) => b.cachedAt - a.cachedAt); // Most recent first

    const entriesToDelete: CachedFirmwareEntry[] = [];
    const uniqueEntries: CachedFirmwareEntry[] = [];
    const seenVersions = new Set<string>();

    for (const entry of deviceEntries) {
      if (seenVersions.has(entry.version)) {
        entriesToDelete.push(entry);
        continue;
      }
      seenVersions.add(entry.version);
      uniqueEntries.push(entry);
    }

    if (uniqueEntries.length > effectiveKeepCount) {
      entriesToDelete.push(...uniqueEntries.slice(effectiveKeepCount));
    }

    if (entriesToDelete.length === 0) {
      return;
    }

    const tokensToDelete = new Set(entriesToDelete.map((e) => e.token));

    // Delete the directories for old entries
    for (const entry of entriesToDelete) {
      const cacheDir = path.join(FIRMWARE_CACHE_DIR, entry.deviceId, entry.token);
      try {
        deleteDirectory(cacheDir);
        logger.info({ deviceId: entry.deviceId, token: entry.token, version: entry.version }, 'Deleted old firmware cache entry');
      } catch (error) {
        logger.warn({ error, cacheDir }, 'Failed to delete firmware cache directory');
      }
    }

    // Update the index to remove deleted entries
    index.entries = index.entries.filter(
      (e) => !(e.deviceId === deviceId && tokensToDelete.has(e.token))
    );
    writeCacheIndex(index);
  },

  /**
   * Delete a specific cache entry
   */
  deleteCacheEntry: (deviceId: string, token: string): boolean => {
    const index = readCacheIndex();
    const entry = index.entries.find((e) => e.deviceId === deviceId && e.token === token);

    if (!entry) {
      return false;
    }

    // Delete the directory
    const cacheDir = path.join(FIRMWARE_CACHE_DIR, deviceId, token);
    try {
      deleteDirectory(cacheDir);
    } catch (error) {
      logger.warn({ error, cacheDir }, 'Failed to delete firmware cache directory');
    }

    // Update the index
    index.entries = index.entries.filter(
      (e) => !(e.deviceId === deviceId && e.token === token)
    );
    writeCacheIndex(index);
    return true;
  },

  /**
   * Get firmware settings
   */
  getSettings: (): FirmwareSettings => readSettings(),

  /**
   * Save firmware settings (merge with existing)
   */
  saveSettings: (settings: Partial<FirmwareSettings>): FirmwareSettings => {
    const current = readSettings();
    const merged = { ...current, ...settings };
    writeSettings(merged);
    return merged;
  },

  /**
   * Get the base cache directory path
   */
  getBaseCacheDir: (): string => FIRMWARE_CACHE_DIR,
};
