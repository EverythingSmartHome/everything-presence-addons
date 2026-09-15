import type { DeviceMapping } from '../config/deviceMappingStorage';
import type { DeviceProfile, EntityDefinition, ZoneType } from './deviceProfiles';
import type { IHaReadTransport } from '../ha/readTransport';

export interface ZoneRenameWarning {
  zoneId: string;
  entityId?: string;
  message: string;
}

export interface ZoneRenameResult {
  renamed: number;
  warnings: ZoneRenameWarning[];
}

const zoneTypesForId = (zoneId: string): { index: number; types: ZoneType[] } | null => {
  const match = zoneId.trim().match(/^(?:(Polygon)\s+)?(Zone|Exclusion|Entry)\s+(\d+)$/i);
  if (!match) return null;
  const index = Number(match[3]);
  const polygon = !!match[1];
  const family = match[2].toLowerCase();
  if (family === 'zone') return { index, types: polygon ? ['polygon'] : ['regular', 'polygon'] };
  if (family === 'exclusion') return { index, types: polygon ? ['polygonExclusion'] : ['exclusion', 'polygonExclusion'] };
  return { index, types: polygon ? ['polygonEntry'] : ['entry', 'polygonEntry'] };
};

const belongsToZone = (definition: EntityDefinition, types: ZoneType[], index: number): boolean => {
  if (definition.zoneIndex !== index) return false;
  if (definition.zoneType) return types.includes(definition.zoneType);
  // Occupancy/count sensors and per-zone timeout settings describe regular zones.
  return types.includes('regular') && (
    definition.subcategory === 'zoneOccupancy' ||
    definition.subcategory === 'zoneTargetCount' ||
    (definition.category === 'setting' && !!definition.label)
  );
};

const words = (value: string) => value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ')
  .replace(/\b\w/g, letter => letter.toUpperCase());

export const suffixForZoneEntity = (key: string, definition: EntityDefinition): string => {
  if (definition.coord) return words(definition.coord);
  if (definition.subcategory === 'zoneOccupancy') return 'Occupancy';
  if (definition.subcategory === 'zoneTargetCount') return 'Target Count';
  if (definition.zoneType?.startsWith('polygon')) return 'Polygon';
  if (/offDelay|timeout/i.test(key) || /off delay|timeout/i.test(definition.label ?? '')) return 'Timeout';
  return definition.label?.replace(/^(?:Zone|Exclusion|Entry)\s+\d+\s*/i, '').trim() || words(key);
};

export const getZoneEntityNames = (
  mapping: DeviceMapping,
  profile: DeviceProfile,
  zoneId: string,
  label: string
): Array<{ entityId: string; name: string | null }> => {
  const zone = zoneTypesForId(zoneId);
  if (!zone || !profile.entities) return [];
  const byEntity = new Map<string, string | null>();
  for (const [key, definition] of Object.entries(profile.entities)) {
    if (!belongsToZone(definition, zone.types, zone.index)) continue;
    const entityId = mapping.mappings[key];
    if (entityId) byEntity.set(entityId, label ? `${label} ${suffixForZoneEntity(key, definition)}` : null);
  }
  return Array.from(byEntity, ([entityId, name]) => ({ entityId, name }));
};

export const synchronizeZoneEntityNames = async (
  transport: IHaReadTransport,
  mapping: DeviceMapping,
  profile: DeviceProfile,
  labels: Record<string, string>
): Promise<ZoneRenameResult> => {
  const warnings: ZoneRenameWarning[] = [];
  let renamed = 0;
  const seen = new Set<string>();
  for (const [zoneId, label] of Object.entries(labels)) {
    for (const update of getZoneEntityNames(mapping, profile, zoneId, label)) {
      if (seen.has(update.entityId)) continue;
      seen.add(update.entityId);
      try {
        await transport.updateEntityRegistryName(update.entityId, update.name);
        renamed++;
      } catch (error) {
        warnings.push({ zoneId, entityId: update.entityId, message: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  return { renamed, warnings };
};
