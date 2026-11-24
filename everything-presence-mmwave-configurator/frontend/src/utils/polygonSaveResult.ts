export interface PolygonSaveWarning {
  entityId?: string;
  description: string;
  error: string;
}

const MAX_LISTED = 4;

/** Zones the backend could not write at all (no mapped entity, invalid shape). */
const UNSAVED_ZONE_ERRORS = new Set(['ENTITY_NOT_MAPPED', 'INVALID_POLYGON']);

/**
 * Advisory warnings: pre-write entity checks from the polygon-zones route
 * ("<zone> entity is disabled" / "state is missing" / "is unavailable") and
 * restore notes such as unrestored labels. They don't by themselves mean a
 * zone was lost, so they are listed last.
 */
const isAdvisoryWarning = (warning: PolygonSaveWarning): boolean =>
  warning.error === 'MAPPING_NOT_FOUND' ||
  /\bentity (is disabled|state is missing|is unavailable)$/.test(warning.description.trim());

/** 0 = zone not saved, 1 = write failure (or other drop), 2 = advisory. */
const warningRank = (warning: PolygonSaveWarning): number => {
  if (UNSAVED_ZONE_ERRORS.has(warning.error)) return 0;
  if (isAdvisoryWarning(warning)) return 2;
  return 1;
};

/**
 * Build the error shown when a polygon zone save returns ok: false,
 * listing the zones that were not written to the device. Unsaved zones are
 * listed first, then write failures, then advisory warnings, so the zones that
 * were actually lost are never hidden behind "+N more".
 */
export function describePolygonSaveFailure(warnings: PolygonSaveWarning[] | undefined): string {
  const items = (warnings ?? [])
    .map((warning, index) => ({ warning, index, rank: warningRank(warning) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ warning }) => warning);
  if (items.length === 0) {
    return 'Polygon zones were not saved to the device.';
  }

  const listed = items.slice(0, MAX_LISTED).map((warning) => {
    const description = warning.description.trim().replace(/\.$/, '');
    if (UNSAVED_ZONE_ERRORS.has(warning.error)) {
      return description;
    }
    return warning.error ? `${description} (${warning.error})` : description;
  });
  const remaining = items.length - listed.length;
  const more = remaining > 0 ? ` (+${remaining} more)` : '';

  const hint = items.some((warning) => warning.error === 'ENTITY_NOT_MAPPED')
    ? 'Re-sync the device entities, or map the missing polygon zone entities manually in device settings, then save again.'
    : 'Check the device entities in Home Assistant, then save again.';

  return `Not all zones were saved to the device. ${listed.join('. ')}${more}. ${hint}`;
}
