import assert from 'node:assert/strict';
import test from 'node:test';
import type { DeviceProfile } from './deviceProfiles';
import { DEFAULT_ZONE_LIMITS, normalizeDeviceProfile, resolveZoneLimits } from './deviceProfiles';

const makeProfile = (overrides: Partial<DeviceProfile>): DeviceProfile => ({
  id: 'test-profile',
  label: 'Test Profile',
  manufacturer: 'Test',
  capabilities: {},
  limits: {},
  entityMap: {},
  ...overrides,
});

// Mirrors config/device-profiles/everything_presence_one.json
const ep1 = makeProfile({
  id: 'everything_presence_one',
  capabilities: { tracking: false, zones: false, exclusionZones: false, entryZones: false },
  limits: { maxZones: 0, maxExclusionZones: 0, maxEntryZones: 0, maxRangeMeters: 25 },
});

test('a profile with no zone support has no slots of any kind', () => {
  assert.deepEqual(resolveZoneLimits(ep1), {
    maxZones: 0,
    maxExclusionZones: 0,
    maxEntryZones: 0,
  });
});

test('missing exclusion and entry limits do not become two when zones are unsupported', () => {
  const withoutLimits = makeProfile({
    capabilities: { zones: false },
    limits: { maxZones: 0, maxRangeMeters: 25 },
  });
  assert.deepEqual(resolveZoneLimits(withoutLimits), {
    maxZones: 0,
    maxExclusionZones: 0,
    maxEntryZones: 0,
  });
});

test('a profile that says nothing keeps the legacy defaults', () => {
  assert.deepEqual(resolveZoneLimits(makeProfile({})), DEFAULT_ZONE_LIMITS);
});

test('a capability of false overrides a non-zero limit', () => {
  const contradictory = makeProfile({
    capabilities: { zones: true, entryZones: false },
    limits: { maxZones: 4, maxEntryZones: 2 },
  });
  assert.equal(resolveZoneLimits(contradictory).maxEntryZones, 0);
});

test('loading a profile fills in every zone limit', () => {
  const normalized = normalizeDeviceProfile(
    makeProfile({
      capabilities: { zones: true, exclusionZones: true, entryZones: false },
      limits: { maxRangeMeters: 6 },
    })
  );
  assert.equal(normalized.limits.maxZones, DEFAULT_ZONE_LIMITS.maxZones);
  assert.equal(normalized.limits.maxExclusionZones, DEFAULT_ZONE_LIMITS.maxExclusionZones);
  assert.equal(normalized.limits.maxEntryZones, 0);
  // Unrelated limits survive normalisation.
  assert.equal(normalized.limits.maxRangeMeters, 6);
});

test('normalising leaves an already-consistent profile alone', () => {
  const normalized = normalizeDeviceProfile(ep1);
  assert.deepEqual(normalized.limits, {
    maxZones: 0,
    maxExclusionZones: 0,
    maxEntryZones: 0,
    maxRangeMeters: 25,
  });
});
