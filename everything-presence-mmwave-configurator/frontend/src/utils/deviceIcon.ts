import type { DevicePlacement, DeviceProfile } from '../api/types';

export const getDeviceIconUrl = (
  profile: DeviceProfile | null | undefined,
  placement?: DevicePlacement | null
): string | undefined => {
  if (!profile) return undefined;
  if (placement?.mountType === 'ceiling' && profile.iconUrlCeiling) {
    return profile.iconUrlCeiling;
  }
  return profile.iconUrl;
};
