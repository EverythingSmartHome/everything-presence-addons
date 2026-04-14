import type { DevicePlacement, DeviceProfile } from '../api/types';

export interface CoverageFov {
  horizontalFovDeg: number;
  verticalFovDeg: number;
  maxRangeMeters: number;
  presetId?: string;
  label?: string;
  source: 'override' | 'preset';
}

export const resolveCoverageFov = (
  profile: DeviceProfile | null | undefined,
  placement?: DevicePlacement | null
): CoverageFov | null => {
  const presetIdFromPlacement = typeof placement?.coveragePresetId === 'string' && placement.coveragePresetId.trim()
    ? placement.coveragePresetId.trim()
    : undefined;
  const overrideH = placement?.horizontalFovDeg;
  const overrideV = placement?.verticalFovDeg;
  if ((presetIdFromPlacement === 'custom' || (!presetIdFromPlacement && Number.isFinite(overrideH) && Number.isFinite(overrideV)))
    && Number.isFinite(overrideH) && Number.isFinite(overrideV)) {
    const maxRangeMeters = profile?.limits?.maxRangeMeters;
    return {
      horizontalFovDeg: Number(overrideH),
      verticalFovDeg: Number(overrideV),
      maxRangeMeters: Number.isFinite(maxRangeMeters) ? Number(maxRangeMeters) : 6,
      presetId: 'custom',
      source: 'override',
    };
  }

  const presets = profile?.coverage?.presets;
  if (!presets || Object.keys(presets).length === 0) return null;

  const defaultId = profile?.coverage?.defaultPresetId;
  const presetId = presetIdFromPlacement && presetIdFromPlacement !== 'custom' && presets[presetIdFromPlacement]
    ? presetIdFromPlacement
    : (defaultId && presets[defaultId] ? defaultId : Object.keys(presets)[0]);
  const preset = presets[presetId];
  if (!preset) return null;

  return {
    horizontalFovDeg: preset.horizontalFovDeg,
    verticalFovDeg: preset.verticalFovDeg,
    maxRangeMeters: preset.maxRangeMeters,
    presetId,
    label: preset.label,
    source: 'preset',
  };
};

export const resolveTrackingCoverageFov = (
  profile: DeviceProfile | null | undefined,
): CoverageFov | null => {
  const presets = profile?.coverage?.presets;
  if (!presets || Object.keys(presets).length === 0) return null;

  const defaultId = profile?.coverage?.defaultPresetId;
  const presetId = defaultId && presets[defaultId] ? defaultId : Object.keys(presets)[0];
  const preset = presets[presetId];
  if (!preset) return null;

  return {
    horizontalFovDeg: preset.horizontalFovDeg,
    verticalFovDeg: preset.verticalFovDeg,
    maxRangeMeters: preset.maxRangeMeters,
    presetId,
    label: preset.label,
    source: 'preset',
  };
};
