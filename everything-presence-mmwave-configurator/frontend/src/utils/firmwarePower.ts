import type { DeviceConfig } from '../api/types';

export function wifiPowerUnavailableReason(config: DeviceConfig): string | null {
  if (config.configSource !== 'entities') return 'This firmware cannot report its hardware configuration. Use the USB installer and select your board and sensor.';
  if (config.model !== 'everything-presence-one') return 'Power switching is available for EP1 only.';
  if (!['stable', 'stable-wifi11'].includes(config.firmware_channel)) return 'Power switching is available for stable EP1 firmware only.';
  if (config.ethernet_enabled) return 'Power switching is available for Wi-Fi devices only.';
  if (!['1.3', '1.5', '1.6'].includes(config.board_revision)) return 'This board revision does not have a supported power-switching build.';
  if (!['sen0395', 'sen0609'].includes(config.sensor_variant) || (config.board_revision === '1.3' && config.sensor_variant !== 'sen0395')) return 'This board and sensor combination does not have a supported power-switching build.';
  return null;
}

export function verifyFirmwareInstall(input: {
  ready: boolean; expectedVersion: string | null; installedVersion: string | null;
  expectedPower: 'standard' | 'wifi11'; config: DeviceConfig | null; elapsedMs: number;
}): { verified: boolean; error?: string } {
  if (!input.ready) return { verified: false };
  if (input.expectedVersion && input.installedVersion && input.expectedVersion !== input.installedVersion) {
    return { verified: false, error: `Update finished but device reports v${input.installedVersion}. Expected v${input.expectedVersion}.` };
  }
  const config = input.config;
  const observed = config?.wifi_power_profile ?? (config?.firmware_channel === 'stable-wifi11' ? 'wifi11' : 'standard');
  const matched = config?.configSource === 'entities' && observed === input.expectedPower &&
    config.firmware_channel === (input.expectedPower === 'wifi11' ? 'stable-wifi11' : 'stable');
  if (matched && input.installedVersion === input.expectedVersion && !!input.installedVersion) return { verified: true };
  if (input.elapsedMs >= 30000) {
    const reported = config?.configSource === 'entities' ? `${observed} (${config.firmware_channel})` : 'unavailable build flags';
    return { verified: false, error: `Could not verify firmware after installation. Expected v${input.expectedVersion} / ${input.expectedPower}; device reports ${input.installedVersion || 'unknown version'} / ${reported}. Refresh device information before retrying.` };
  }
  return { verified: false };
}
