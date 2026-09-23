import type { EntityMatchResult } from '../api/entityDiscovery';

/**
 * Build the manual overrides to pre-fill when entity discovery re-runs for a
 * device that already has a saved mapping, so entities the user picked on an
 * earlier sync survive a re-sync.
 *
 * A saved entity is only carried over when it differs from the fresh
 * auto-match (an identical value needs no override) and still belongs to the
 * device (a stale ID would replace a correct auto-match and fail validation).
 */
export const seedManualOverrides = (
  results: Pick<EntityMatchResult, 'templateKey' | 'matchedEntityId'>[],
  savedMappings: Record<string, string>,
  deviceEntityIds: ReadonlySet<string>
): Record<string, string> => {
  const overrides: Record<string, string> = {};
  for (const match of results) {
    const key = match.templateKey;
    const direct = savedMappings[key];
    const withEntitySuffix = savedMappings[`${key}Entity`];
    const withoutEntitySuffix = key.endsWith('Entity') ? savedMappings[key.replace(/Entity$/, '')] : undefined;
    const chosen = direct || withEntitySuffix || withoutEntitySuffix;
    if (chosen && chosen !== match.matchedEntityId && deviceEntityIds.has(chosen)) {
      overrides[key] = chosen;
    }
  }
  return overrides;
};
