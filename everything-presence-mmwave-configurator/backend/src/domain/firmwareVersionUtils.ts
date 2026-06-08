export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

const EPL_POLYGON_ONLY_VERSION = '1.5.0';

export function parseVersion(version: string | undefined | null): ParsedVersion | null {
  if (!version) return null;

  const cleaned = version.trim().replace(/^[vV](?:ersion\s*)?/, '').split('-')[0].split(' ')[0].trim();
  const match = cleaned.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  if (!match) return null;

  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2] ?? '0', 10),
    patch: parseInt(match[3] ?? '0', 10),
  };
}

export function compareVersions(
  left: string | undefined | null,
  right: string | undefined | null
): number | null {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;

  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;
  return 0;
}

function normalizeModel(model?: string | null): string {
  return model?.toLowerCase().trim() ?? '';
}

export function isEverythingPresenceLite(profileId?: string | null, model?: string | null): boolean {
  if (profileId === 'everything_presence_lite') return true;
  const normalized = normalizeModel(model);
  return normalized.includes('everything presence lite') || normalized.includes('everything-presence-lite');
}

export function isEplPolygonOnlyDevice(args: {
  profileId?: string | null;
  firmwareVersion?: string | null;
  model?: string | null;
}): boolean {
  if (!isEverythingPresenceLite(args.profileId, args.model)) {
    return false;
  }

  const comparison = compareVersions(args.firmwareVersion, EPL_POLYGON_ONLY_VERSION);
  return comparison !== null && comparison >= 0;
}

