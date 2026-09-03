export interface DeviceMarkerSettings {
  deviceMarkerStyle: 'icon' | 'node';
  deviceMarkerScale: number;
  deviceMarkerOpacity: number;
}

export const MARKER_SCALE_MIN = 0.25;
export const MARKER_SCALE_MAX = 2;

const clampFinite = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

export const normalizeDeviceMarkerSettings = (value: unknown): DeviceMarkerSettings => {
  const settings = value && typeof value === 'object' ? value as Partial<DeviceMarkerSettings> : {};
  return {
    deviceMarkerStyle: settings.deviceMarkerStyle === 'node' ? 'node' : 'icon',
    deviceMarkerScale: clampFinite(settings.deviceMarkerScale, 0.5, MARKER_SCALE_MIN, MARKER_SCALE_MAX),
    deviceMarkerOpacity: Math.round(clampFinite(settings.deviceMarkerOpacity, 1, 0.1, 1) * 10) / 10,
  };
};
