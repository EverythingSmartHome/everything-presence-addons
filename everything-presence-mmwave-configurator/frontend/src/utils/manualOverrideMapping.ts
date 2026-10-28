/**
 * Helpers that apply manual entity overrides from the discovery dialog onto
 * the mapping structures that get saved, so a manual choice always wins over
 * the auto-matched entity for the same field.
 *
 * Discovery template keys come in two shapes:
 * - flat profile keys, which are also the stored device-mapping keys
 *   (e.g. "presence", "maxDistance", "zone1BeginX", "target1X", "polygonZone1");
 * - nested legacy keys (e.g. "settingsEntities.maxDistance",
 *   "zoneConfigEntities.zone1.beginX", "trackingTargets.target1.x").
 */

const capitalize = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);
const lowerFirst = (value: string): string => value.charAt(0).toLowerCase() + value.slice(1);

/**
 * Irregular alias pairs kept in sync by the backend (`normalizeMappingKeys`).
 * Regular "<key>" / "<key>Entity" pairs are handled generically.
 */
const IRREGULAR_ALIAS_PAIRS: Array<[string, string]> = [
  ['mmwaveMode', 'modeEntity'],
  ['mmwaveDistanceMin', 'distanceMinEntity'],
  ['mmwaveDistanceMax', 'distanceMaxEntity'],
  ['mmwaveTriggerDistance', 'triggerDistanceEntity'],
  ['mmwaveSensitivity', 'sensitivityEntity'],
  ['mmwaveTriggerSensitivity', 'triggerSensitivityEntity'],
  ['mmwaveOnLatency', 'onLatencyEntity'],
  ['mmwaveOffLatency', 'offLatencyEntity'],
  ['mmwaveThresholdFactor', 'thresholdFactorEntity'],
];

/**
 * Convert a discovery template key into the flat key used in the stored device mapping.
 * Returns null for nested keys of an unknown group.
 */
export function templateKeyToStorageKey(templateKey: string): string | null {
  const parts = templateKey.split('.');
  if (parts.length === 1) return templateKey;

  const [group, sub, prop] = parts;
  switch (group) {
    case 'settingsEntities':
      return parts.length === 2 ? sub : null;
    case 'zoneConfigEntities':
    case 'exclusionZoneConfigEntities':
    case 'exclusionZoneEntities':
    case 'entryZoneConfigEntities':
    case 'trackingTargets':
      return parts.length === 3 ? `${sub}${capitalize(prop)}` : null;
    case 'polygonZoneEntities':
      return parts.length === 2 ? `polygonZone${sub.replace(/^zone/, '')}` : null;
    case 'polygonExclusionEntities':
      return parts.length === 2 ? `polygonExclusion${sub.replace(/^exclusion/, '')}` : null;
    case 'polygonEntryEntities':
      return parts.length === 2 ? `polygonEntry${sub.replace(/^entry/, '')}` : null;
    default:
      return null;
  }
}

/**
 * Keys that refer to the same entity as `key` in a flat device mapping.
 */
export function aliasKeysFor(key: string): string[] {
  const aliases = new Set<string>();
  if (key.endsWith('Entity')) {
    aliases.add(key.replace(/Entity$/, ''));
  } else {
    aliases.add(`${key}Entity`);
  }
  for (const [alias, canonical] of IRREGULAR_ALIAS_PAIRS) {
    if (key === alias) aliases.add(canonical);
    if (key === canonical) aliases.add(alias);
  }
  aliases.delete(key);
  return [...aliases];
}

/**
 * Keys to look up in a stored flat mapping for a given template key, in priority order.
 */
export function storedLookupKeys(templateKey: string): string[] {
  const keys: string[] = [];
  const add = (k: string | null) => {
    if (k && !keys.includes(k)) keys.push(k);
  };
  add(templateKey);
  const storageKey = templateKeyToStorageKey(templateKey);
  add(storageKey);
  if (storageKey) {
    for (const alias of aliasKeysFor(storageKey)) add(alias);
  }
  return keys;
}

/**
 * Apply manual overrides to a flat device mapping (the stored format).
 * Overrides are written last, so they win over auto-matched values, and any
 * alias key already present is updated too so the two never disagree.
 * Empty overrides (cleared selections) are ignored.
 */
export function applyOverridesToFlatMappings(
  flatMappings: Record<string, string>,
  overrides: Record<string, string>,
): Record<string, string> {
  const result = { ...flatMappings };
  for (const [templateKey, entityId] of Object.entries(overrides)) {
    if (!entityId) continue;
    const storageKey = templateKeyToStorageKey(templateKey);
    if (!storageKey) continue;
    result[storageKey] = entityId;
    for (const alias of aliasKeysFor(storageKey)) {
      if (alias in result) {
        result[alias] = entityId;
      }
    }
  }
  return result;
}

type NestedRecord = Record<string, unknown>;

const ensureObject = (parent: NestedRecord, key: string): NestedRecord => {
  const existing = parent[key];
  if (existing && typeof existing === 'object') return existing as NestedRecord;
  const created: NestedRecord = {};
  parent[key] = created;
  return created;
};

/**
 * Nested locations (in the EntityMappings structure) that hold the entity for a flat profile key.
 */
interface NestedPath {
  path: string[];
  /** When false, the leaf is only replaced if it already holds an entity. */
  createLeaf: boolean;
}

function nestedPathsForFlatKey(key: string): NestedPath[] {
  const paths: NestedPath[] = [];

  const zone = key.match(/^(zone|exclusion|entry)(\d+)(BeginX|EndX|BeginY|EndY)$/);
  if (zone) {
    const [, type, index, coord] = zone;
    const group =
      type === 'zone' ? 'zoneConfigEntities' : type === 'exclusion' ? 'exclusionZoneConfigEntities' : 'entryZoneConfigEntities';
    paths.push({ path: [group, `${type}${index}`, lowerFirst(coord)], createLeaf: true });
  }

  const polygon = key.match(/^polygon(Zone|Exclusion|Entry)(\d+)$/);
  if (polygon) {
    const [, type, index] = polygon;
    paths.push({ path: [`polygon${type}Entities`, `${lowerFirst(type)}${index}`], createLeaf: true });
  }

  const target = key.match(/^target(\d+)([A-Z][A-Za-z]*)$/);
  if (target) {
    const [, index, prop] = target;
    paths.push({ path: ['trackingTargets', `target${index}`, lowerFirst(prop)], createLeaf: true });
  }

  // The settings group always exists, so only replace a setting that is already there.
  paths.push({ path: ['settingsEntities', key], createLeaf: false });
  return paths;
}

/**
 * Apply manual overrides to the nested EntityMappings structure that is passed to
 * the room / wizard. Overrides replace the auto-matched value wherever the same
 * field is represented, so the nested and flat forms stay consistent.
 * Empty overrides (cleared selections) are ignored.
 */
export function applyOverridesToNestedMappings<T extends object>(mappings: T, overrides: Record<string, string>): T {
  const root = mappings as unknown as NestedRecord;

  for (const [templateKey, entityId] of Object.entries(overrides)) {
    if (!entityId) continue;
    const parts = templateKey.split('.');

    if (parts.length === 2) {
      ensureObject(root, parts[0])[parts[1]] = entityId;
      continue;
    }
    if (parts.length === 3) {
      ensureObject(ensureObject(root, parts[0]), parts[1])[parts[2]] = entityId;
      continue;
    }
    if (parts.length !== 1) continue;

    // Flat key: set it at the root (as before) and replace any existing representation
    // of the same field so the auto-matched entity cannot win later.
    root[templateKey] = entityId;
    for (const alias of aliasKeysFor(templateKey)) {
      if (typeof root[alias] === 'string') {
        root[alias] = entityId;
      }
    }
    for (const { path, createLeaf } of nestedPathsForFlatKey(templateKey)) {
      let node: unknown = root;
      for (const segment of path.slice(0, -1)) {
        node = node && typeof node === 'object' ? (node as NestedRecord)[segment] : undefined;
      }
      if (!node || typeof node !== 'object') continue;
      const parent = node as NestedRecord;
      const leaf = path[path.length - 1];
      if (createLeaf || typeof parent[leaf] === 'string') {
        parent[leaf] = entityId;
      }
    }
  }

  return mappings;
}
