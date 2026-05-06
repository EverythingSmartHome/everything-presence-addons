import type { ZonePolygon } from '../api/types';

export type CeilingSliceAxis = 'x' | 'y';

export interface CeilingSliceConfig {
  enabled: boolean;
  axis: CeilingSliceAxis;
  mirrorLateralAxis: boolean;
  sliceCount: number;
  lateralMinMm: number;
  lateralMaxMm: number;
  lateralBreakpointsMm?: number[];
  lateralRangesMm?: Array<{ min: number; max: number }>;
  exclusionRangesMm?: Array<{ min: number; max: number }>;
  depthMinMm: number;
  depthMaxMm: number;
}

export interface CeilingSliceBand {
  id: string;
  label: string;
  min: number;
  max: number;
}

export type CeilingSliceCoordinateSpace = 'display' | 'device';

export interface CeilingSliceCoverage {
  heightMm?: number;
  horizontalFovDeg?: number;
  verticalFovDeg?: number;
  maxRangeMeters?: number;
}

export const DEFAULT_CEILING_SLICE_CONFIG: CeilingSliceConfig = {
  enabled: true,
  axis: 'x',
  mirrorLateralAxis: true,
  sliceCount: 3,
  lateralMinMm: -2000,
  lateralMaxMm: 2000,
  depthMinMm: -6000,
  depthMaxMm: 6000,
};

export const normalizeCeilingSliceConfig = (
  value: unknown,
  maxRangeMm: number,
  forceMirrorLateralAxis = false,
): CeilingSliceConfig => {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const sliceCountRaw = Number(raw.sliceCount ?? DEFAULT_CEILING_SLICE_CONFIG.sliceCount);
  const lateralMinRaw = Number(raw.lateralMinMm ?? DEFAULT_CEILING_SLICE_CONFIG.lateralMinMm);
  const lateralMaxRaw = Number(raw.lateralMaxMm ?? DEFAULT_CEILING_SLICE_CONFIG.lateralMaxMm);
  const depthMinRaw = Number(raw.depthMinMm ?? -maxRangeMm);
  const depthMaxRaw = Number(raw.depthMaxMm ?? maxRangeMm);

  const lateralMinMm = Number.isFinite(lateralMinRaw) ? lateralMinRaw : DEFAULT_CEILING_SLICE_CONFIG.lateralMinMm;
  const lateralMaxMm = Number.isFinite(lateralMaxRaw) ? lateralMaxRaw : DEFAULT_CEILING_SLICE_CONFIG.lateralMaxMm;
  const depthMinMm = Number.isFinite(depthMinRaw) ? depthMinRaw : -maxRangeMm;
  const depthMaxMm = Number.isFinite(depthMaxRaw) ? depthMaxRaw : maxRangeMm;

  const normalizedMin = Math.min(lateralMinMm, lateralMaxMm - 100);
  const normalizedMax = Math.max(lateralMaxMm, lateralMinMm + 100);
  const sliceCount = Math.min(4, Math.max(2, Number.isFinite(sliceCountRaw) ? Math.round(sliceCountRaw) : 3));
  const lateralBreakpointsMm = Array.isArray(raw.lateralBreakpointsMm)
    ? raw.lateralBreakpointsMm
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > normalizedMin && value < normalizedMax)
        .sort((a, b) => a - b)
        .filter((value, index, values) => index === 0 || Math.abs(value - values[index - 1]) >= 50)
        .slice(0, sliceCount - 1)
    : undefined;
  const lateralRangesMm = Array.isArray(raw.lateralRangesMm)
    ? raw.lateralRangesMm
        .map((range) => {
          const candidate = range && typeof range === 'object' ? range as Record<string, unknown> : {};
          const min = Number(candidate.min);
          const max = Number(candidate.max);
          if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
          return {
            min: Math.min(min, max - 100),
            max: Math.max(max, min + 100),
          };
        })
        .filter((range): range is { min: number; max: number } => range !== null)
        .slice(0, sliceCount)
    : undefined;
  const exclusionRangesMm = Array.isArray(raw.exclusionRangesMm)
    ? raw.exclusionRangesMm
        .map((range) => {
          const candidate = range && typeof range === 'object' ? range as Record<string, unknown> : {};
          const min = Number(candidate.min);
          const max = Number(candidate.max);
          if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
          return {
            min: Math.min(min, max - 100),
            max: Math.max(max, min + 100),
          };
        })
        .filter((range): range is { min: number; max: number } => range !== null)
        .slice(0, 2)
    : undefined;

  return {
    enabled: raw.enabled !== false,
    axis: raw.axis === 'y' ? 'y' : 'x',
    mirrorLateralAxis: forceMirrorLateralAxis
      ? true
      : raw.mirrorLateralAxis !== undefined
        ? Boolean(raw.mirrorLateralAxis)
        : raw.inverted !== undefined
          ? Boolean(raw.inverted)
          : DEFAULT_CEILING_SLICE_CONFIG.mirrorLateralAxis,
    sliceCount,
    lateralMinMm: normalizedMin,
    lateralMaxMm: normalizedMax,
    lateralBreakpointsMm: lateralBreakpointsMm && lateralBreakpointsMm.length === sliceCount - 1
      ? lateralBreakpointsMm
      : undefined,
    lateralRangesMm: lateralRangesMm && lateralRangesMm.length === sliceCount
      ? lateralRangesMm
      : undefined,
    exclusionRangesMm,
    depthMinMm: Math.min(depthMinMm, depthMaxMm - 100),
    depthMaxMm: Math.max(depthMaxMm, depthMinMm + 100),
  };
};

export const getCeilingCoverageHalfExtents = (
  coverage: CeilingSliceCoverage | null | undefined,
  fallbackMaxRangeMm: number,
): { halfWidthMm: number; halfDepthMm: number } => {
  const heightMm = Number(coverage?.heightMm);
  const horizontalFovDeg = Number(coverage?.horizontalFovDeg);
  const verticalFovDeg = Number(coverage?.verticalFovDeg);
  const maxRangeMm = Number.isFinite(Number(coverage?.maxRangeMeters))
    ? Number(coverage?.maxRangeMeters) * 1000
    : fallbackMaxRangeMm;

  if (!Number.isFinite(heightMm) || heightMm <= 0 ||
      !Number.isFinite(horizontalFovDeg) || horizontalFovDeg <= 0 ||
      !Number.isFinite(verticalFovDeg) || verticalFovDeg <= 0) {
    return { halfWidthMm: fallbackMaxRangeMm, halfDepthMm: fallbackMaxRangeMm };
  }

  return {
    halfWidthMm: Math.min(heightMm * Math.tan((horizontalFovDeg / 2) * Math.PI / 180), maxRangeMm),
    halfDepthMm: Math.min(heightMm * Math.tan((verticalFovDeg / 2) * Math.PI / 180), maxRangeMm),
  };
};

export const getCeilingSliceLineDepth = (
  lateral: number,
  config: CeilingSliceConfig,
  coverage: CeilingSliceCoverage | null | undefined,
  fallbackMaxRangeMm: number,
): { min: number; max: number } | null => {
  const { halfWidthMm, halfDepthMm } = getCeilingCoverageHalfExtents(coverage, fallbackMaxRangeMm);
  const lateralRadius = config.axis === 'x' ? halfWidthMm : halfDepthMm;
  const depthRadius = config.axis === 'x' ? halfDepthMm : halfWidthMm;
  if (!Number.isFinite(lateralRadius) || !Number.isFinite(depthRadius) || lateralRadius <= 0 || depthRadius <= 0) {
    return { min: config.depthMinMm, max: config.depthMaxMm };
  }

  const normalized = Math.abs(lateral) / lateralRadius;
  if (normalized > 1) return null;
  const halfDepth = depthRadius * Math.sqrt(Math.max(0, 1 - normalized * normalized));
  return {
    min: Math.max(config.depthMinMm, -halfDepth),
    max: Math.min(config.depthMaxMm, halfDepth),
  };
};

export const getCeilingSliceBands = (config: CeilingSliceConfig): CeilingSliceBand[] => {
  const count = Math.min(4, Math.max(2, config.sliceCount));
  const equalWidth = (config.lateralMaxMm - config.lateralMinMm) / count;
  const boundaries = config.lateralBreakpointsMm && config.lateralBreakpointsMm.length === count - 1
    ? [config.lateralMinMm, ...config.lateralBreakpointsMm, config.lateralMaxMm]
    : Array.from({ length: count + 1 }, (_, index) => (
        index === count ? config.lateralMaxMm : config.lateralMinMm + equalWidth * index
      ));
  const labels = count === 2
    ? ['Left', 'Right']
    : count === 3
      ? ['Left', 'Center', 'Right']
      : ['Far Left', 'Left Center', 'Right Center', 'Far Right'];

  return Array.from({ length: count }, (_, index) => {
    const customRange = config.lateralRangesMm?.[index];
    return {
      id: `Zone ${index + 1}`,
      label: labels[index] ?? `Slice ${index + 1}`,
      min: customRange?.min ?? boundaries[index],
      max: customRange?.max ?? boundaries[index + 1],
    };
  });
};

const toDeviceLateral = (value: number, config: CeilingSliceConfig): number => (
  config.mirrorLateralAxis ? -value : value
);

export const buildCeilingSliceZones = (
  config: CeilingSliceConfig,
  existingLabels: Record<string, string> = {},
  coordinateSpace: CeilingSliceCoordinateSpace = 'device',
  useExistingLabels = true,
  coverage?: CeilingSliceCoverage | null,
  fallbackMaxRangeMm = Math.max(Math.abs(config.depthMinMm), Math.abs(config.depthMaxMm)),
): ZonePolygon[] => {
  const bands = getCeilingSliceBands(config);
  return buildCeilingRangeZones(
    config,
    bands.map((band) => ({ ...band, type: 'regular' as const })),
    existingLabels,
    coordinateSpace,
    useExistingLabels,
    coverage,
    fallbackMaxRangeMm,
  );
};

export const buildCeilingExclusionZones = (
  config: CeilingSliceConfig,
  existingLabels: Record<string, string> = {},
  coordinateSpace: CeilingSliceCoordinateSpace = 'device',
  useExistingLabels = true,
  coverage?: CeilingSliceCoverage | null,
  fallbackMaxRangeMm = Math.max(Math.abs(config.depthMinMm), Math.abs(config.depthMaxMm)),
): ZonePolygon[] => {
  const ranges = config.exclusionRangesMm ?? [];
  return buildCeilingRangeZones(
    config,
    ranges.map((range, index) => ({
      id: `Exclusion ${index + 1}`,
      label: `Exclusion ${index + 1}`,
      min: range.min,
      max: range.max,
      type: 'exclusion' as const,
    })),
    existingLabels,
    coordinateSpace,
    useExistingLabels,
    coverage,
    fallbackMaxRangeMm,
  );
};

const buildCeilingRangeZones = (
  config: CeilingSliceConfig,
  bands: Array<CeilingSliceBand & { type: 'regular' | 'exclusion' }>,
  existingLabels: Record<string, string>,
  coordinateSpace: CeilingSliceCoordinateSpace,
  useExistingLabels: boolean,
  coverage: CeilingSliceCoverage | null | undefined,
  fallbackMaxRangeMm: number,
): ZonePolygon[] => {
  return bands.map((band) => {
    const lateralA = coordinateSpace === 'device' ? toDeviceLateral(band.min, config) : band.min;
    const lateralB = coordinateSpace === 'device' ? toDeviceLateral(band.max, config) : band.max;
    let displayLateralA = lateralA;
    let displayLateralB = lateralB;

    if (coordinateSpace === 'display' && coverage) {
      const { halfWidthMm, halfDepthMm } = getCeilingCoverageHalfExtents(coverage, fallbackMaxRangeMm);
      const lateralRadius = config.axis === 'x' ? halfWidthMm : halfDepthMm;
      if (Number.isFinite(lateralRadius) && lateralRadius > 0) {
        const rangeMin = Math.min(lateralA, lateralB);
        const rangeMax = Math.max(lateralA, lateralB);
        const clippedMin = Math.max(rangeMin, -lateralRadius);
        const clippedMax = Math.min(rangeMax, lateralRadius);

        if (clippedMax - clippedMin < 1) {
          return null;
        }

        if (lateralA <= lateralB) {
          displayLateralA = clippedMin;
          displayLateralB = clippedMax;
        } else {
          displayLateralA = clippedMax;
          displayLateralB = clippedMin;
        }
      }
    }

    const lateralMin = coordinateSpace === 'display' ? displayLateralA : Math.min(lateralA, lateralB);
    const lateralMax = coordinateSpace === 'display' ? displayLateralB : Math.max(lateralA, lateralB);
    const boundaryA = Math.min(displayLateralA, displayLateralB);
    const boundaryB = Math.max(displayLateralA, displayLateralB);
    const depthAtMin = coordinateSpace === 'display' && coverage
      ? getCeilingSliceLineDepth(boundaryA, config, coverage, fallbackMaxRangeMm)
      : null;
    const depthAtMax = coordinateSpace === 'display' && coverage
      ? getCeilingSliceLineDepth(boundaryB, config, coverage, fallbackMaxRangeMm)
      : null;
    const minDepthMin = depthAtMin?.min ?? config.depthMinMm;
    const minDepthMax = depthAtMin?.max ?? config.depthMaxMm;
    const maxDepthMin = depthAtMax?.min ?? config.depthMinMm;
    const maxDepthMax = depthAtMax?.max ?? config.depthMaxMm;

    const vertices = config.axis === 'x'
      ? [
          { x: lateralMin, y: minDepthMin },
          { x: lateralMax, y: maxDepthMin },
          { x: lateralMax, y: maxDepthMax },
          { x: lateralMin, y: minDepthMax },
        ]
      : [
          { x: minDepthMin, y: lateralMin },
          { x: maxDepthMin, y: lateralMax },
          { x: maxDepthMax, y: lateralMax },
          { x: minDepthMax, y: lateralMin },
        ];

    return {
      id: band.id,
      type: band.type,
      vertices,
      enabled: true,
      label: useExistingLabels ? existingLabels[band.id] || band.label : band.label,
    };
  }).filter((zone): zone is ZonePolygon => zone !== null);
};

export const getCeilingSlicePosition = (
  target: { x: number | null; y: number | null },
  config: CeilingSliceConfig,
): number | null => {
  const value = config.axis === 'x' ? target.x : target.y;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return config.mirrorLateralAxis ? -value : value;
};
