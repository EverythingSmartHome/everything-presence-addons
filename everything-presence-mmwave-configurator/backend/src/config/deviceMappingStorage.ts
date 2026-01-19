import fs from 'fs';
import path from 'path';
import { logger } from '../logger';
import { normalizeMappingKeys } from '../domain/mappingUtils';

/**
 * Device entity mapping - stores resolved entity IDs for a specific device.
 * This is the single source of truth for entity resolution.
 */
export interface DeviceMapping {
  /** Home Assistant device registry ID */
  deviceId: string;
  /** Device profile ID (e.g., "everything_presence_lite") */
  profileId: string;
  /** Human-readable device name */
  deviceName: string;
  /** ESPHome node name (service prefix), if available */
  esphomeNodeName?: string;
  /** ISO timestamp when entities were discovered */
  discoveredAt: string;
  /** ISO timestamp when mapping was last updated */
  lastUpdated: string;
  /** Whether user confirmed the mappings during discovery */
  confirmedByUser: boolean;
  /** Count of entities that were auto-matched during discovery */
  autoMatchedCount: number;
  /** Count of entities that user manually mapped */
  manuallyMappedCount: number;
  /** Entity key to entity ID mappings (e.g., "presence" -> "binary_sensor.device_occupancy") */
  mappings: Record<string, string>;
  /** Entity IDs that exist on device but weren't matched to profile */
  unmappedEntities: string[];
  /** Entity original object ids keyed by entity ID */
  entityOriginalObjectIds?: Record<string, string>;
  /** Entity unique ids keyed by entity ID */
  entityUniqueIds?: Record<string, string>;
  /** Unit of measurement for specific entities (e.g., "target1X" -> "in" or "mm") */
  entityUnits?: Record<string, string>;
  /** Zone labels keyed by zone ID (e.g., "Zone 1" -> "Bed", "Exclusion 2" -> "Window") */
  zoneLabels?: Record<string, string>;
  /** Device firmware version (e.g., "1.4.1") - parsed from sw_version */
  firmwareVersion?: string;
  /** ESPHome version the device is running (e.g., "2025.11.2") - parsed from sw_version */
  esphomeVersion?: string;
  /** Raw sw_version string from Home Assistant (e.g., "1.4.1 (ESPHome 2025.11.2)") */
  rawSwVersion?: string;
  /** Schema version from device profile at time of last sync (e.g., "1.0") */
  profileSchemaVersion?: string;
}

/**
 * Parse a firmware version string like "1.4.1 (ESPHome 2025.11.2)" into components.
 * Returns null values if parsing fails - this should not break anything.
 */
export function parseFirmwareVersion(rawVersion: string | null | undefined): {
  firmwareVersion: string | undefined;
  esphomeVersion: string | undefined;
} {
  if (!rawVersion) {
    return { firmwareVersion: undefined, esphomeVersion: undefined };
  }

  // Try to match pattern like "1.4.1 (ESPHome 2025.11.2)"
  const match = rawVersion.match(/^([\d.]+)\s*\(ESPHome\s+([\d.]+)\)$/i);
  if (match) {
    return {
      firmwareVersion: match[1],
      esphomeVersion: match[2],
    };
  }

  // Fallback: If no ESPHome part, try to extract just version number
  const versionMatch = rawVersion.match(/^([\d.]+)/);
  if (versionMatch) {
    return {
      firmwareVersion: versionMatch[1],
      esphomeVersion: undefined,
    };
  }

  // Can't parse - return the raw value as firmware version
  return {
    firmwareVersion: rawVersion,
    esphomeVersion: undefined,
  };
}

// Use same base path as other storage
const DATA_DIR = process.env.DATA_DIR ?? '/config/everything-presence-zone-configurator';
const DEVICES_DIR = path.join(DATA_DIR, 'devices');

/**
 * Storage class for device entity mappings.
 * Each device has its own JSON file in the devices directory.
 */
class DeviceMappingStorageImpl {
  private locks = new Map<string, Promise<void>>();

  /**
   * Get the file path for a device mapping.
   */
  private getFilePath(deviceId: string): string {
    return path.join(DEVICES_DIR, `${deviceId}.json`);
  }

  /**
   * Ensure the devices directory exists.
   */
  private ensureDirectoryExists(): void {
    if (!fs.existsSync(DEVICES_DIR)) {
      fs.mkdirSync(DEVICES_DIR, { recursive: true });
      logger.info({ dir: DEVICES_DIR }, 'Created devices directory');
    }
  }

  /**
   * Get a device mapping by device ID.
   * Returns null if not found or if validation fails.
   */
  getMapping(deviceId: string): DeviceMapping | null {
    this.ensureDirectoryExists();

    const filePath = this.getFilePath(deviceId);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const mapping = JSON.parse(raw) as DeviceMapping;

      // Validate deviceId matches filename to detect corruption
      if (mapping.deviceId !== deviceId) {
        logger.error(
          { deviceId, fileDeviceId: mapping.deviceId, filePath },
          'Device mapping file has mismatched deviceId - possible corruption'
        );
        return null;
      }

      mapping.mappings = normalizeMappingKeys(mapping.mappings);
      return mapping;
    } catch (error) {
      logger.warn(
        { error: (error as Error).message, deviceId, filePath },
        'Failed to read device mapping file'
      );
      return null;
    }
  }

  /**
   * Save a device mapping with atomic write and mutex locking.
   * Ensures concurrent writes to the same device are serialized.
   */
  async saveMapping(mapping: DeviceMapping): Promise<void> {
    this.ensureDirectoryExists();

    const deviceId = mapping.deviceId;

    // Wait for any pending write to complete
    const pendingLock = this.locks.get(deviceId);
    if (pendingLock) {
      await pendingLock;
    }

    // Create new lock for this write
    const writePromise = this.atomicWrite(deviceId, mapping);
    this.locks.set(deviceId, writePromise);

    try {
      await writePromise;
    } finally {
      this.locks.delete(deviceId);
    }
  }

  /**
   * Perform an atomic write operation.
   * Writes to a temp file first, then renames for atomicity.
   * Falls back to direct write with fsync if rename fails.
   */
  private async atomicWrite(deviceId: string, mapping: DeviceMapping): Promise<void> {
    const filePath = this.getFilePath(deviceId);
    // Keep temp file in same directory for atomic rename compatibility
    const tempPath = path.join(DEVICES_DIR, `.${deviceId}.tmp`);

    // Update lastUpdated timestamp
    mapping.lastUpdated = new Date().toISOString();

    const content = JSON.stringify(mapping, null, 2);

    try {
      // Write to temp file
      fs.writeFileSync(tempPath, content, 'utf-8');

      // Atomic rename
      fs.renameSync(tempPath, filePath);

      logger.debug({ deviceId }, 'Device mapping saved successfully');
    } catch (renameErr) {
      // Fallback: direct write with fsync for systems where rename fails
      logger.warn(
        { deviceId, error: (renameErr as Error).message },
        'Atomic rename failed, using direct write with fsync'
      );

      const fd = fs.openSync(filePath, 'w');
      try {
        fs.writeSync(fd, content);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    } finally {
      // Clean up temp file if it exists
      try {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Delete a device mapping.
   * Returns true if deleted, false if not found.
   */
  deleteMapping(deviceId: string): boolean {
    const filePath = this.getFilePath(deviceId);

    if (!fs.existsSync(filePath)) {
      return false;
    }

    try {
      fs.unlinkSync(filePath);
      logger.info({ deviceId }, 'Device mapping deleted');
      return true;
    } catch (error) {
      logger.error(
        { error: (error as Error).message, deviceId },
        'Failed to delete device mapping'
      );
      return false;
    }
  }

  /**
   * List all device mappings.
   */
  listMappings(): DeviceMapping[] {
    this.ensureDirectoryExists();

    try {
      const files = fs.readdirSync(DEVICES_DIR);
      const mappings: DeviceMapping[] = [];

      for (const file of files) {
        // Skip temp files and non-JSON files
        if (file.startsWith('.') || !file.endsWith('.json')) {
          continue;
        }

        // Extract deviceId from filename
        const deviceId = file.slice(0, -5); // Remove .json
        const mapping = this.getMapping(deviceId);

        if (mapping) {
          mappings.push(mapping);
        }
      }

      return mappings;
    } catch (error) {
      logger.warn(
        { error: (error as Error).message },
        'Failed to list device mappings'
      );
      return [];
    }
  }

  /**
   * Check if a device has mappings.
   */
  hasMapping(deviceId: string): boolean {
    return fs.existsSync(this.getFilePath(deviceId));
  }

  /**
   * Get the devices directory path (for debugging/testing).
   */
  getDevicesDirectory(): string {
    return DEVICES_DIR;
  }
}

// Export singleton instance
export const deviceMappingStorage = new DeviceMappingStorageImpl();
