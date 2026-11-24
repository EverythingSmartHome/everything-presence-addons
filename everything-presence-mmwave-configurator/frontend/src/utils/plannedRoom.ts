import type { DevicePlacement, DeviceProfile, RoomConfig, ZoneRect } from '../api/types';
import { resolveZoneLimits } from './zoneCapabilities.ts';

/**
 * Planned rooms.
 *
 * A room can be set up before the sensor that will watch it exists: it records
 * the *model* it is planned for (`profileId`) but has no `deviceId`. Everything
 * that only needs the model - the coverage cone, zone slot counts, the device
 * icon - works off the profile; everything that needs a real device (live
 * state, settings, heatmap, pushing zones) is switched off until one is linked.
 */

export type RoomDeviceStatus = 'linked' | 'planned' | 'unconfigured';

type RoomLike = Pick<RoomConfig, 'deviceId' | 'profileId'> | null | undefined;
type ProfileLike = Pick<DeviceProfile, 'id' | 'label'> & Partial<Pick<DeviceProfile, 'capabilities' | 'limits'>>;

const hasText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/** `linked` has a device, `planned` has only a model, `unconfigured` has neither. */
export const getRoomDeviceStatus = (room: RoomLike): RoomDeviceStatus => {
  if (hasText(room?.deviceId)) return 'linked';
  if (hasText(room?.profileId)) return 'planned';
  return 'unconfigured';
};

export const isPlannedRoom = (room: RoomLike): boolean => getRoomDeviceStatus(room) === 'planned';

/** The model a room is planned for, as a readable label. */
export const plannedModelLabel = (
  room: RoomLike,
  profiles: ReadonlyArray<Pick<DeviceProfile, 'id' | 'label'>>,
): string | null => {
  const profileId = room?.profileId;
  if (!hasText(profileId)) return null;
  return profiles.find((profile) => profile.id === profileId)?.label ?? profileId;
};

/** Text for a room in a room picker: planned rooms say so, and for which model. */
export const roomOptionLabel = (
  room: Pick<RoomConfig, 'name' | 'deviceId' | 'profileId'>,
  profiles: ReadonlyArray<Pick<DeviceProfile, 'id' | 'label'>>,
): string => {
  if (!isPlannedRoom(room)) return room.name;
  return `${room.name} (Planned · ${plannedModelLabel(room, profiles)})`;
};

export const EPP_PROFILE_ID = 'everything_presence_pro';

/**
 * Drop the parts of a placement that only make sense for the model they were
 * set for: the coverage preset, the FOV overrides and the pitch. Ceiling mounts
 * are only supported by the Everything Presence Pro, so for any other model the
 * mount type falls back to the default (wall). Position, rotation, height and
 * the lock are kept - the sensor is still in the same place.
 */
export const resetModelSpecificPlacement = (
  placement: DevicePlacement | undefined,
  newProfile: Pick<DeviceProfile, 'id'> | null | undefined,
): DevicePlacement | undefined => {
  if (!placement) return placement;
  const {
    coveragePresetId: _coveragePresetId,
    horizontalFovDeg: _horizontalFovDeg,
    verticalFovDeg: _verticalFovDeg,
    pitchDeg: _pitchDeg,
    mountType,
    ...rest
  } = placement;
  const keepCeiling = mountType === 'ceiling' && newProfile?.id === EPP_PROFILE_ID;
  const next: DevicePlacement = { ...rest };
  if (mountType === 'wall' || keepCeiling) {
    next.mountType = mountType;
  }
  return next;
};

const zoneSlotNumber = (zone: ZoneRect): number | null => {
  const match = zone.id.match(/(\d+)/);
  return match ? Number(match[1]) : null;
};

/** Split zones into those a profile has slots for and those it cannot hold. */
export const fitZonesToProfile = (
  zones: ZoneRect[],
  profile: Partial<Pick<DeviceProfile, 'id' | 'capabilities' | 'limits'>> | null | undefined,
): { kept: ZoneRect[]; dropped: ZoneRect[] } => {
  const limits = resolveZoneLimits(profile as Parameters<typeof resolveZoneLimits>[0]);
  const maxFor = (type: ZoneRect['type']) =>
    type === 'exclusion' ? limits.maxExclusionZones : type === 'entry' ? limits.maxEntryZones : limits.maxZones;
  const seen: Record<ZoneRect['type'], number> = { regular: 0, exclusion: 0, entry: 0 };
  const kept: ZoneRect[] = [];
  const dropped: ZoneRect[] = [];
  for (const zone of zones) {
    const max = maxFor(zone.type);
    const slot = zoneSlotNumber(zone) ?? seen[zone.type] + 1;
    seen[zone.type] += 1;
    if (slot >= 1 && slot <= max) {
      kept.push(zone);
    } else {
      dropped.push(zone);
    }
  }
  return { kept, dropped };
};

export interface DeviceLinkPlan {
  /** The room was planned for a different model than the device being linked. */
  modelMismatch: boolean;
  plannedProfileId: string | null;
  /** Profile the room ends up with. */
  profileId: string | null;
  devicePlacement: DevicePlacement | undefined;
  zones: ZoneRect[];
  droppedZones: ZoneRect[];
  /** The room keeps zones that have not been sent to the device yet. */
  pendingZonePush: boolean;
}

/**
 * Work out what linking a device to a room changes.
 *
 * Same model (or no planned model): nothing but the device changes. A
 * different model switches the room to the device's model, resets the
 * model-specific placement settings and drops zones the new model has no slot
 * for. Either way, zones that are left are flagged for the user to send to the
 * device (or replace with the device's own) instead of being overwritten.
 */
export const planDeviceLink = (
  room: Pick<RoomConfig, 'profileId' | 'devicePlacement' | 'zones'>,
  deviceProfileId: string | null | undefined,
  profiles: ReadonlyArray<ProfileLike>,
): DeviceLinkPlan => {
  const plannedProfileId = hasText(room.profileId) ? room.profileId : null;
  const targetProfileId = hasText(deviceProfileId) ? deviceProfileId : null;
  const zones = room.zones ?? [];
  const modelMismatch = Boolean(plannedProfileId && targetProfileId && plannedProfileId !== targetProfileId);

  if (!modelMismatch || !targetProfileId) {
    return {
      modelMismatch: false,
      plannedProfileId,
      profileId: targetProfileId ?? plannedProfileId,
      devicePlacement: room.devicePlacement,
      zones,
      droppedZones: [],
      pendingZonePush: zones.length > 0,
    };
  }

  const newProfile = profiles.find((profile) => profile.id === targetProfileId) ?? { id: targetProfileId };
  const { kept, dropped } = fitZonesToProfile(zones, newProfile);
  return {
    modelMismatch: true,
    plannedProfileId,
    profileId: targetProfileId,
    devicePlacement: resetModelSpecificPlacement(room.devicePlacement, newProfile),
    zones: kept,
    droppedZones: dropped,
    pendingZonePush: kept.length > 0,
  };
};

/** The warning shown before a mismatched link is applied. */
export const describeDeviceLinkMismatch = (
  plan: DeviceLinkPlan,
  profiles: ReadonlyArray<Pick<DeviceProfile, 'id' | 'label'>>,
): string => {
  const labelFor = (id: string | null) => (id ? profiles.find((p) => p.id === id)?.label ?? id : 'Unknown');
  const lines = [
    `This room was planned for ${labelFor(plan.plannedProfileId)}, but this device is ${labelFor(plan.profileId)}.`,
    `Linking switches the room to ${labelFor(plan.profileId)} and resets the coverage preset, field-of-view overrides, pitch and (if not supported) ceiling mounting.`,
  ];
  if (plan.droppedZones.length > 0) {
    lines.push(`These zones don't fit the new model and will be removed: ${plan.droppedZones.map((zone) => zone.label ? `${zone.id} (${zone.label})` : zone.id).join(', ')}.`);
  }
  lines.push('Continue?');
  return lines.join('\n\n');
};

/** The room fields to save when a device is linked according to `plan`. */
export const buildDeviceLinkUpdate = (
  room: Pick<RoomConfig, 'metadata'>,
  deviceId: string,
  plan: DeviceLinkPlan,
): Partial<RoomConfig> => {
  const { pendingZonePush: _previous, ...metadata } = room.metadata ?? {};
  const update: Partial<RoomConfig> = {
    deviceId,
    profileId: plan.profileId ?? undefined,
    zones: plan.zones,
    metadata: plan.pendingZonePush ? { ...metadata, pendingZonePush: true } : metadata,
  };
  if (plan.devicePlacement) {
    update.devicePlacement = plan.devicePlacement;
  }
  return update;
};
