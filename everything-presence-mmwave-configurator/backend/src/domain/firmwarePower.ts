import type { DeviceConfig, FirmwareRequirements } from '../types/firmware';

export type WifiPowerProfile = 'standard' | 'wifi11';

// Released firmware/indexes predate this field. The separate channel also
// protects reduced-power devices from automatic updates by older clients.
export function wifiPowerProfile(config: Pick<FirmwareRequirements, 'firmware_channel' | 'wifi_power_profile'>): string {
  return config.wifi_power_profile ?? (config.firmware_channel === 'stable-wifi11' ? 'wifi11' : 'standard');
}

export function withWifiPowerProfile(config: DeviceConfig, profile: unknown): DeviceConfig {
  if (profile !== 'standard' && profile !== 'wifi11') {
    throw new Error('Wi-Fi power profile must be standard or wifi11');
  }
  if (config.configSource !== 'entities' || config.model !== 'everything-presence-one' ||
      config.ethernet_enabled || !['stable', 'stable-wifi11'].includes(config.firmware_channel) ||
      !['1.3', '1.5', '1.6'].includes(config.board_revision) ||
      !['sen0395', 'sen0609'].includes(config.sensor_variant) ||
      (config.board_revision === '1.3' && config.sensor_variant !== 'sen0395')) {
    throw new Error('Wi-Fi power switching requires a stable EP1 with its board and sensor configuration reported by the device. Use the USB installer for older firmware.');
  }
  return { ...config, wifi_power_profile: profile,
    firmware_channel: profile === 'wifi11' ? 'stable-wifi11' : 'stable' };
}
