/**
 * Firmware-related type definitions for the auto-update system
 */

/**
 * How the device configuration was determined
 * - 'entities': Read from device firmware entities (reliable)
 * - 'inferred': Guessed from device model/version (unreliable, device needs firmware update first)
 */
export type ConfigSource = 'entities' | 'inferred';

/**
 * Device configuration as reported by firmware
 * Maps to the device_config substitution in ESPHome YAML files
 */
export interface DeviceConfig {
  model: 'everything-presence-one' | 'everything-presence-lite' | 'everything-presence-pro';
  ethernet_enabled: boolean;
  co2_enabled: boolean;
  bluetooth_enabled: boolean;
  board_revision: string;
  sensor_variant: string;
  firmware_channel: 'stable' | 'beta' | 'smartthings';
  /** How the config was determined - 'entities' means read from device, 'inferred' means guessed */
  configSource: ConfigSource;
}

/**
 * Firmware variant requirements - must match device config for installation
 */
export interface FirmwareRequirements {
  model: string;
  ethernet_enabled: boolean;
  co2_enabled: boolean;
  bluetooth_enabled: boolean;
  board_revision: string;
  sensor_variant: string;
  firmware_channel: string;
}

/**
 * A specific firmware variant (e.g., EPL with CO2 and BLE)
 */
export interface FirmwareVariant {
  id: string;
  manifestUrl: string;
  requirements: FirmwareRequirements;
}

/**
 * A firmware release containing multiple variants
 */
export interface FirmwareRelease {
  version: string;
  channel: 'stable' | 'beta';
  releaseDate: string;
  releaseNotes: string;
  minPreviousVersion?: string;
  variants: FirmwareVariant[];
}

/**
 * Migration definition for handling breaking changes
 */
export interface FirmwareMigration {
  id: string;
  fromVersion: string;  // semver range like "<2.0.0"
  toVersion: string;    // semver range like ">=2.0.0"
  description: string;
  backupRequired: boolean;
  handler: string;  // Handler function name
}

/**
 * Product information in firmware index
 */
export interface FirmwareProduct {
  id: string;
  displayName: string;
  latestVersion: string;
}

/**
 * Firmware index for a single product (fetched from GitHub Pages)
 */
export interface FirmwareIndex {
  schemaVersion: string;
  generatedAt: string;
  product: FirmwareProduct;
  firmwares: FirmwareRelease[];
  migrations: FirmwareMigration[];
}

/**
 * Available update for a device
 */
export interface AvailableUpdate {
  currentVersion: string;
  newVersion: string;
  channel: string;
  releaseNotes: string;
  variant: FirmwareVariant;
  migration?: FirmwareMigration;
}

/**
 * Result of firmware compatibility validation
 */
export interface FirmwareValidation {
  valid: boolean;
  hardBlocks: ValidationIssue[];  // Cannot proceed
  warnings: ValidationIssue[];    // Can proceed with confirmation
}

/**
 * A single validation issue
 */
export interface ValidationIssue {
  field: string;
  deviceValue: unknown;
  firmwareValue: unknown;
  message: string;
  severity: 'hard_block' | 'warning';
}

/**
 * Default firmware index URLs for each product
 */
export const DEFAULT_FIRMWARE_INDEX_URLS: Record<string, string> = {
  'everything-presence-one': 'https://everythingsmarthome.github.io/everything-presence-one/firmware-index.json',
  'everything-presence-lite': 'https://everythingsmarthome.github.io/everything-presence-lite/firmware-index.json',
  'everything-presence-pro': 'https://everythingsmarthome.github.io/everything-presence-pro/firmware-index.json',
};
