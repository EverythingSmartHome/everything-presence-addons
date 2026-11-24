export interface PolygonSaveWarning {
  entityId?: string;
  description: string;
  error: string;
}

const MAX_LISTED = 4;

/**
 * Build the error shown when a polygon zone save returns ok: false,
 * listing the zones that were not written to the device.
 */
export function describePolygonSaveFailure(warnings: PolygonSaveWarning[] | undefined): string {
  const items = warnings ?? [];
  if (items.length === 0) {
    return 'Polygon zones were not saved to the device.';
  }

  const listed = items.slice(0, MAX_LISTED).map((warning) => {
    const description = warning.description.trim().replace(/\.$/, '');
    if (warning.error === 'ENTITY_NOT_MAPPED' || warning.error === 'INVALID_POLYGON') {
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
