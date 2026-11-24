import type { RoomConfig, ZonePolygon, ZoneRect } from '../api/types';

/**
 * Zones planned before a device was linked.
 *
 * When a device is linked to a room that already has zones, the room is
 * flagged with `metadata.pendingZonePush`. While the flag is set the editors
 * must not replace the stored zones with the device's (or with nothing, when
 * reading the device fails): the user chooses whether to send the planned
 * zones to the device or to use the zones already on it, and either choice
 * clears the flag.
 */

type RoomLike = Pick<RoomConfig, 'metadata'> | null | undefined;

export const hasPendingZonePush = (room: RoomLike): boolean => room?.metadata?.pendingZonePush === true;

/**
 * The zone-overwrite guard: true when loading zones from the device must leave
 * the room's stored zones alone.
 */
export const shouldSkipDeviceZoneOverwrite = (room: RoomLike): boolean => hasPendingZonePush(room);

/** A copy of the room metadata without the pending-push flag. */
export const clearPendingZonePushMetadata = (
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> => {
  const { pendingZonePush: _pending, ...rest } = metadata ?? {};
  return rest;
};

export interface ZonePushWarning {
  entityId?: string;
  description: string;
  error: string;
}

export interface ZonePushResult {
  ok: boolean;
  warnings?: ZonePushWarning[];
}

/**
 * Warnings the backend adds for zones the device profile cannot hold
 * ("Skipped <type> zone <id>"): those zones never reached the device.
 */
const SKIPPED_ZONE_WARNING = /^Skipped\b/i;

/**
 * A skip warning names the zone it dropped. It counts against the planned
 * zones when it names one of them - or names none we can recognise, in which
 * case the flag errs on the side of staying.
 */
const isSkippedZoneWarning = (warning: ZonePushWarning, sentZones: ReadonlyArray<{ id: string }>): boolean => {
  const description = warning.description ?? '';
  if (!SKIPPED_ZONE_WARNING.test(description)) return false;
  const namesSentZone = sentZones.some((zone) => description.endsWith(` ${zone.id}`));
  const namesAnyZone = /\d+$/.test(description.trim());
  return namesSentZone || !namesAnyZone || sentZones.length === 0;
};

/**
 * Decide, after sending planned zones to a device, whether the pending flag
 * may be cleared. The zone endpoints answer 200 even when entity writes fail,
 * so the outcome is judged on the body: the write must report `ok: true` and
 * none of the sent zones may have been skipped. Anything else - `ok: false`, a
 * skipped zone, a thrown error or no result at all - keeps the flag so the
 * user can retry.
 */
export const shouldClearPendingAfterPush = (
  outcome: ZonePushResult | Error | null | undefined,
  sentZones: ReadonlyArray<{ id: string }>,
): boolean => {
  if (!outcome || outcome instanceof Error || typeof outcome !== 'object') return false;
  if (outcome.ok !== true) return false;
  return !(outcome.warnings ?? []).some((warning) => isSkippedZoneWarning(warning, sentZones));
};

/** A readable summary of why a push did not fully succeed. */
export const describeZonePushProblems = (
  outcome: ZonePushResult | Error | null | undefined,
): string => {
  if (outcome instanceof Error) return `Sending zones to the device failed: ${outcome.message}`;
  if (!outcome) return 'Sending zones to the device failed.';
  const details = (outcome.warnings ?? [])
    .slice(0, 3)
    .map((warning) => [warning.entityId ?? warning.description, warning.error].filter(Boolean).join(': '))
    .join('; ');
  const more = (outcome.warnings?.length ?? 0) > 3 ? ` (+${(outcome.warnings?.length ?? 0) - 3} more)` : '';
  return `Not all planned zones reached the device, so they are still marked as pending. ${details}${more}`.trim();
};

/** A rectangle zone as a 4-vertex polygon, for polygon-only firmware. */
export const rectToPolygon = (zone: ZoneRect): ZonePolygon => ({
  id: zone.id,
  type: zone.type,
  vertices: [
    { x: zone.x, y: zone.y },
    { x: zone.x + zone.width, y: zone.y },
    { x: zone.x + zone.width, y: zone.y + zone.height },
    { x: zone.x, y: zone.y + zone.height },
  ],
  enabled: zone.enabled,
  label: zone.label,
});

/** The planned zones in the shape the device expects. */
export const plannedZonesForDevice = (
  zones: ZoneRect[],
  polygonOnly: boolean,
): { kind: 'polygon'; zones: ZonePolygon[] } | { kind: 'rect'; zones: ZoneRect[] } => {
  const enabled = zones.filter((zone) => zone.enabled !== false);
  return polygonOnly
    ? { kind: 'polygon', zones: enabled.map(rectToPolygon) }
    : { kind: 'rect', zones: enabled };
};
