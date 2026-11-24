import type { DevicePlacement, DeviceProfile, RoomConfig } from '../api/types';
import { EPP_PROFILE_ID, isPlannedRoom } from './plannedRoom.ts';

/**
 * Placement helpers shared by the wizard's plan mode and the Room Builder.
 */

export type MountType = NonNullable<DevicePlacement['mountType']>;

/** Ceiling height the Room Builder assumes when a sensor is moved to the ceiling. */
export const DEFAULT_CEILING_HEIGHT_MM = 2400;

/**
 * Mount types a model can be planned with. Only the Everything Presence Pro
 * has a ceiling mount (and a ceiling icon); every other model is wall-only.
 */
export const supportedMountTypes = (
  profile: Pick<DeviceProfile, 'id'> & Partial<Pick<DeviceProfile, 'iconUrlCeiling'>> | null | undefined,
): MountType[] => {
  if (!profile) return ['wall'];
  return profile.id === EPP_PROFILE_ID || Boolean(profile.iconUrlCeiling) ? ['wall', 'ceiling'] : ['wall'];
};

/**
 * The placement fields a mount change sets - the same defaults the Room
 * Builder's Mount control applies: ceiling points straight down from 2.4 m
 * unless a height is given; wall only switches the mount type.
 */
export const mountPlacementUpdate = (mount: MountType, heightMm?: number): Partial<DevicePlacement> => (
  mount === 'ceiling'
    ? {
      mountType: 'ceiling',
      pitchDeg: 90,
      heightMm: Number.isFinite(heightMm) && Number(heightMm) > 0 ? Number(heightMm) : DEFAULT_CEILING_HEIGHT_MM,
    }
    : { mountType: 'wall' }
);

/** Centre of an outline's bounding box, or the origin without one. */
export const outlineCenter = (points: ReadonlyArray<{ x: number; y: number }> | undefined): { x: number; y: number } => {
  if (!points || points.length === 0) return { x: 0, y: 0 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
};

/**
 * The starting placement for a planned device once its mount is chosen: an
 * existing position is kept, otherwise the sensor starts at the room centre.
 */
export const plannedMountPlacement = (
  existing: DevicePlacement | undefined,
  outline: ReadonlyArray<{ x: number; y: number }> | undefined,
  mount: MountType,
  heightMm?: number,
): DevicePlacement => {
  const base: DevicePlacement = existing ?? { ...outlineCenter(outline), rotationDeg: 0 };
  return { ...base, ...mountPlacementUpdate(mount, heightMm) };
};

/**
 * Whether the wall-mount coverage cone is drawn. A planned room always shows
 * it - seeing where a sensor you don't own yet would point is the point of
 * planning - unless the sensor is on the ceiling, where the height-coverage
 * footprint is drawn instead. Linked rooms follow the display setting.
 */
export const shouldShowCoverageCone = (
  room: Pick<RoomConfig, 'deviceId' | 'profileId' | 'devicePlacement'> | null | undefined,
  showDeviceRadar: boolean,
): boolean => {
  if (isPlannedRoom(room)) return room?.devicePlacement?.mountType !== 'ceiling';
  return showDeviceRadar;
};

/**
 * Which coverage overlays a canvas draws, as the Room Builder does it: a
 * ceiling mount draws its floor footprint and never the wall cone; a wall
 * mount draws the cone when `shouldShowCoverageCone` allows it.
 */
export const resolveCoverageOverlays = (
  room: Pick<RoomConfig, 'deviceId' | 'profileId' | 'devicePlacement'> | null | undefined,
  showDeviceRadar: boolean,
): { cone: boolean; footprint: boolean } => {
  const ceiling = room?.devicePlacement?.mountType === 'ceiling';
  return {
    cone: !ceiling && shouldShowCoverageCone(room, showDeviceRadar),
    footprint: ceiling,
  };
};
