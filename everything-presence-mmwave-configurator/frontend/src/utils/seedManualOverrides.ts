import { storedLookupKeys } from './manualOverrideMapping.ts';

/**
 * Build the initial manual overrides for the entity discovery dialog from a
 * previously saved device mapping, so user-chosen entities survive re-sync.
 *
 * Only keys where the stored entity differs from the auto-match (or where nothing
 * was auto-matched) are seeded, so the same entity is not counted twice as both
 * auto-matched and manually mapped. Stored entities that no longer exist on the
 * device are skipped.
 */
export interface SeedableMatchResult {
  templateKey: string;
  matchedEntityId: string | null;
}

export function seedManualOverrides(
  results: SeedableMatchResult[],
  storedMappings: Record<string, string> | null | undefined,
  deviceEntityIds: Iterable<string>,
): Record<string, string> {
  const overrides: Record<string, string> = {};
  if (!storedMappings) return overrides;

  const available = new Set(deviceEntityIds);

  for (const match of results) {
    const key = match.templateKey;
    let chosen: string | undefined;
    for (const lookupKey of storedLookupKeys(key)) {
      if (storedMappings[lookupKey]) {
        chosen = storedMappings[lookupKey];
        break;
      }
    }

    if (!chosen) continue;
    if (chosen === match.matchedEntityId) continue;
    if (!available.has(chosen)) continue;

    overrides[key] = chosen;
  }

  return overrides;
}

/**
 * Build the overrides to use after a re-sync, so a re-sync never overwrites
 * entities the user has mapped manually.
 *
 * - Previously saved manual choices are seeded via `seedManualOverrides`.
 * - Selections made in the current (unsaved) dialog session take precedence,
 *   including an explicit empty selection (the user cleared the field).
 * - Session selections pointing at entities that no longer exist on the device
 *   are dropped.
 * - When `clearManual` is true, all of the above is discarded and only the
 *   automatic matches are used.
 */
export function buildResyncOverrides(
  results: SeedableMatchResult[],
  storedMappings: Record<string, string> | null | undefined,
  sessionOverrides: Record<string, string> | null | undefined,
  deviceEntityIds: Iterable<string>,
  clearManual = false,
): Record<string, string> {
  if (clearManual) return {};

  const available = new Set(deviceEntityIds);
  const overrides = seedManualOverrides(results, storedMappings, available);
  const knownKeys = new Set(results.map((r) => r.templateKey));

  for (const [key, entityId] of Object.entries(sessionOverrides ?? {})) {
    if (!knownKeys.has(key)) continue;
    if (entityId && !available.has(entityId)) continue;
    overrides[key] = entityId;
  }

  return overrides;
}

/**
 * Count overrides that actually map an entity (ignores cleared selections).
 */
export function countManualOverrides(overrides: Record<string, string>): number {
  return Object.values(overrides).filter(Boolean).length;
}
