import type { DeviceProfileLimits } from '../api/types';

/**
 * Zone capabilities, resolved from a device profile.
 *
 * A profile describes what a device can do twice over: `capabilities` says
 * whether a feature exists at all, `limits` says how many slots it has. The two
 * must agree, and where they disagree the capability wins - a device that
 * cannot detect zones has no zone slots, whatever the limits block happens to
 * say.
 *
 * The defaults below only apply when a profile says *nothing* about a zone
 * type: neither a capability flag nor a limit. That is the legacy
 * EP Lite shape (4 zones / 2 exclusion / 2 entry). A profile that declares
 * `zones: false` - the Everything Presence One - resolves to zero slots of
 * every kind, so the Zone Editor has nothing to offer and every "+ Zone"
 * button is disabled.
 */

export interface ZoneCapabilityFlags {
  tracking?: boolean;
  zones?: boolean;
  exclusionZones?: boolean;
  entryZones?: boolean;
  polygonZones?: boolean;
  distanceOnlyTracking?: boolean;
}

export interface ResolvedZoneLimits {
  maxZones: number;
  maxExclusionZones: number;
  maxEntryZones: number;
}

/** Slot counts assumed when a profile declares neither capability nor limit. */
export const DEFAULT_ZONE_LIMITS: ResolvedZoneLimits = {
  maxZones: 4,
  maxExclusionZones: 2,
  maxEntryZones: 2,
};

/** The part of a `DeviceProfile` these helpers need; keeps them usable on partial data. */
type ProfileLike = { id?: string; capabilities?: unknown; limits?: DeviceProfileLimits } | null | undefined;

/** Read the capability block off a profile without trusting its shape. */
export const getZoneCapabilities = (profile: ProfileLike): ZoneCapabilityFlags => {
  const capabilities = profile?.capabilities;
  if (!capabilities || typeof capabilities !== 'object') return {};
  return capabilities as ZoneCapabilityFlags;
};

const resolveLimit = (value: unknown, supported: boolean | undefined, fallback: number): number => {
  // An unsupported feature has no slots, even if the limits block says otherwise.
  if (supported === false) return 0;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  return fallback;
};

/**
 * How many zones of each type this profile allows.
 *
 * Missing limits fall back to the defaults *unless* the matching capability is
 * `false`, in which case the answer is zero. Exclusion and entry zones also
 * inherit a `zones: false` capability: a device with no zone detection cannot
 * have exclusion or entry zones either.
 */
export const resolveZoneLimits = (profile: ProfileLike): ResolvedZoneLimits => {
  const capabilities = getZoneCapabilities(profile);
  const limits = profile?.limits ?? {};
  return {
    maxZones: resolveLimit(limits.maxZones, capabilities.zones, DEFAULT_ZONE_LIMITS.maxZones),
    maxExclusionZones: resolveLimit(
      limits.maxExclusionZones,
      capabilities.exclusionZones ?? capabilities.zones,
      DEFAULT_ZONE_LIMITS.maxExclusionZones,
    ),
    maxEntryZones: resolveLimit(
      limits.maxEntryZones,
      capabilities.entryZones ?? capabilities.zones,
      DEFAULT_ZONE_LIMITS.maxEntryZones,
    ),
  };
};

/**
 * True when the Zone Editor has anything to offer for this profile.
 *
 * An unknown profile (still loading, or a room with no profile yet) is treated
 * as capable so the editor is never hidden by a slow request; the concrete
 * checks above still block every individual zone type.
 */
export const supportsZoneEditing = (profile: ProfileLike): boolean => {
  if (!profile) return true;
  if (getZoneCapabilities(profile).zones === false) return false;
  const limits = resolveZoneLimits(profile);
  return limits.maxZones > 0 || limits.maxExclusionZones > 0 || limits.maxEntryZones > 0;
};

/** Resolve a room's profile and ask whether its device supports zone editing. */
export const roomSupportsZoneEditing = (
  room: { profileId?: string | null } | null | undefined,
  profiles: ProfileLike[],
): boolean => {
  if (!room?.profileId) return true;
  const profile = profiles.find((candidate) => candidate?.id === room.profileId) ?? null;
  // An unknown profile id cannot be shown to be incapable, so allow it.
  return supportsZoneEditing(profile);
};
