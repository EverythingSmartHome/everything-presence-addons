/**
 * Firmware version utilities for EPL devices
 */

// Minimum firmware version required for advanced features (entry zones, assumed presence, polygon zones)
export const MIN_FIRMWARE_FOR_ADVANCED_FEATURES = '1.3.2';

// Firmware versions where rectangular zones are removed per device model
export const ZONE_MIGRATION_VERSION_BY_MODEL: Record<string, string> = {
  'everything-presence-lite': '1.5.0',
  'everything-presence-pro': '1.2.0',
};

const normalizeModelName = (model?: string | null): string => {
  const value = model?.toLowerCase() ?? '';
  if (value.includes('lite')) return 'everything-presence-lite';
  if (value.includes('pro')) return 'everything-presence-pro';
  if (value.includes('one')) return 'everything-presence-one';
  return value;
};

/**
 * Parse a semantic version string into its components
 * @param version Version string like "1.3.2" or "1.3.1-beta"
 * @returns Object with major, minor, patch numbers or null if invalid
 */
export function parseVersion(version: string | undefined | null): { major: number; minor: number; patch: number } | null {
  if (!version) return null;

  // Remove any prefix like "v", "V", "version " etc.
  let cleanVersion = version.trim().replace(/^[vV](?:ersion\s*)?/, '');

  // Remove any suffix like "-beta", "-rc1", or trailing build info
  cleanVersion = cleanVersion.split('-')[0].split(' ')[0].split('(')[0].trim();

  // Match semantic version pattern (with optional minor/patch for formats like "1.3")
  const match = cleanVersion.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  if (!match) return null;

  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2] || '0', 10),
    patch: parseInt(match[3] || '0', 10),
  };
}

/**
 * Compare two version strings
 * @param version1 First version string
 * @param version2 Second version string
 * @returns -1 if v1 < v2, 0 if equal, 1 if v1 > v2, or null if either version is invalid
 */
export function compareVersions(version1: string | undefined | null, version2: string | undefined | null): number | null {
  const v1 = parseVersion(version1);
  const v2 = parseVersion(version2);

  if (!v1 || !v2) return null;

  if (v1.major !== v2.major) return v1.major > v2.major ? 1 : -1;
  if (v1.minor !== v2.minor) return v1.minor > v2.minor ? 1 : -1;
  if (v1.patch !== v2.patch) return v1.patch > v2.patch ? 1 : -1;

  return 0;
}

/**
 * Get the firmware version where rectangular zones are removed for a device model.
 */
export function getZoneMigrationThreshold(model?: string | null): string | null {
  const normalized = normalizeModelName(model);
  return ZONE_MIGRATION_VERSION_BY_MODEL[normalized] ?? null;
}

/**
 * Check if a firmware update crosses the rectangular -> polygon-only threshold.
 * Returns null if versions are unknown or invalid.
 */
export function requiresZoneMigration(
  currentVersion: string | undefined | null,
  targetVersion: string | undefined | null,
  model?: string | null
): boolean | null {
  const threshold = getZoneMigrationThreshold(model);
  if (!threshold) return false;
  const currentCompare = compareVersions(currentVersion, threshold);
  const targetCompare = compareVersions(targetVersion, threshold);
  if (currentCompare === null || targetCompare === null) return null;
  return currentCompare < 0 && targetCompare >= 0;
}

/**
 * Check if a firmware version meets the minimum requirement
 * @param firmwareVersion The device's firmware version
 * @param minVersion The minimum required version (defaults to MIN_FIRMWARE_FOR_ADVANCED_FEATURES)
 * @returns true if firmware meets requirement, false if not, null if version is unknown
 */
export function meetsMinimumFirmware(
  firmwareVersion: string | undefined | null,
  minVersion: string = MIN_FIRMWARE_FOR_ADVANCED_FEATURES
): boolean | null {
  const comparison = compareVersions(firmwareVersion, minVersion);
  if (comparison === null) return null;
  return comparison >= 0;
}

/**
 * Check if EPL device supports entry zones (requires firmware >= 1.3.2)
 */
export function supportsEntryZones(firmwareVersion: string | undefined | null): boolean | null {
  return meetsMinimumFirmware(firmwareVersion, MIN_FIRMWARE_FOR_ADVANCED_FEATURES);
}

/**
 * Check if EPL device supports assumed presence (requires firmware >= 1.3.2)
 */
export function supportsAssumedPresence(firmwareVersion: string | undefined | null): boolean | null {
  return meetsMinimumFirmware(firmwareVersion, MIN_FIRMWARE_FOR_ADVANCED_FEATURES);
}

/**
 * Check if EPL device supports polygon zones (requires firmware >= 1.3.2)
 */
export function supportsPolygonZones(firmwareVersion: string | undefined | null): boolean | null {
  return meetsMinimumFirmware(firmwareVersion, MIN_FIRMWARE_FOR_ADVANCED_FEATURES);
}

/**
 * Get a user-friendly message about firmware requirements
 */
export function getFirmwareWarningMessage(feature: 'entryZones' | 'assumedPresence' | 'polygonZones', currentVersion?: string): string {
  const featureNames: Record<string, string> = {
    entryZones: 'Entry/Exit Zones',
    assumedPresence: 'Assumed Presence',
    polygonZones: 'Polygon Zones',
  };

  const featureName = featureNames[feature] || feature;
  const versionInfo = currentVersion ? ` (current: ${currentVersion})` : '';

  return `${featureName} requires firmware version ${MIN_FIRMWARE_FOR_ADVANCED_FEATURES} or higher${versionInfo}. Please update your device firmware.`;
}
