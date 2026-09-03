// @ts-nocheck -- Node's built-in runner supplies these modules; frontend production types stay dependency-free.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_ZONE_LIMITS,
  getZoneCapabilities,
  resolveZoneLimits,
  roomSupportsZoneEditing,
  supportsZoneEditing,
} from './zoneCapabilities.ts';

// Mirrors config/device-profiles/*.json
const ep1 = {
  id: 'everything_presence_one',
  capabilities: { tracking: false, zones: false, exclusionZones: false, entryZones: false },
  limits: { maxZones: 0, maxExclusionZones: 0, maxEntryZones: 0, maxRangeMeters: 25 },
};

const epLite = {
  id: 'everything_presence_lite',
  capabilities: { tracking: true, zones: true, exclusionZones: true, entryZones: true },
  limits: { maxZones: 4, maxExclusionZones: 2, maxEntryZones: 2 },
};

const epPro = {
  id: 'everything_presence_pro',
  capabilities: { tracking: true, zones: true, exclusionZones: true, entryZones: false },
  limits: { maxZones: 4, maxExclusionZones: 2, maxEntryZones: 0 },
};

test('EP1 has no zone slots of any kind', () => {
  assert.deepEqual(resolveZoneLimits(ep1), {
    maxZones: 0,
    maxExclusionZones: 0,
    maxEntryZones: 0,
  });
  assert.equal(supportsZoneEditing(ep1), false);
});

test('a profile that declares no zone support gets no slots even if its limits are missing', () => {
  // The EP1 profile shipped without maxExclusionZones/maxEntryZones; the
  // capability flags alone must be enough to keep both at zero.
  const withoutLimits = { ...ep1, limits: { maxZones: 0, maxRangeMeters: 25 } };
  assert.deepEqual(resolveZoneLimits(withoutLimits), {
    maxZones: 0,
    maxExclusionZones: 0,
    maxEntryZones: 0,
  });
  assert.equal(supportsZoneEditing(withoutLimits), false);
});

test('zones: false also rules out exclusion and entry zones', () => {
  const onlyZonesFlag = { id: 'x', capabilities: { zones: false }, limits: {} };
  assert.deepEqual(resolveZoneLimits(onlyZonesFlag), {
    maxZones: 0,
    maxExclusionZones: 0,
    maxEntryZones: 0,
  });
  assert.equal(supportsZoneEditing(onlyZonesFlag), false);
});

test('EP Lite keeps all four regular and two of each special zone', () => {
  assert.deepEqual(resolveZoneLimits(epLite), {
    maxZones: 4,
    maxExclusionZones: 2,
    maxEntryZones: 2,
  });
  assert.equal(supportsZoneEditing(epLite), true);
});

test('EP Pro supports zones and exclusions but no entry zones', () => {
  assert.deepEqual(resolveZoneLimits(epPro), {
    maxZones: 4,
    maxExclusionZones: 2,
    maxEntryZones: 0,
  });
  assert.equal(supportsZoneEditing(epPro), true);
});

test('a capability of false beats a non-zero limit', () => {
  const contradictory = {
    id: 'x',
    capabilities: { zones: true, entryZones: false },
    limits: { maxZones: 4, maxEntryZones: 2 },
  };
  assert.equal(resolveZoneLimits(contradictory).maxEntryZones, 0);
});

test('a profile that says nothing falls back to the legacy defaults', () => {
  assert.deepEqual(resolveZoneLimits({ id: 'x' }), DEFAULT_ZONE_LIMITS);
  assert.equal(supportsZoneEditing({ id: 'x' }), true);
});

test('an unknown profile is not blocked', () => {
  assert.equal(supportsZoneEditing(null), true);
  assert.equal(supportsZoneEditing(undefined), true);
});

test('a malformed capabilities block is ignored rather than trusted', () => {
  assert.deepEqual(getZoneCapabilities({ capabilities: 'nonsense' }), {});
  assert.deepEqual(resolveZoneLimits({ capabilities: 'nonsense' }), DEFAULT_ZONE_LIMITS);
});

test('negative and fractional limits are normalised', () => {
  const odd = { id: 'x', capabilities: { zones: true }, limits: { maxZones: 2.7, maxExclusionZones: -3 } };
  const limits = resolveZoneLimits(odd);
  assert.equal(limits.maxZones, 2);
  // A negative value is not a usable count, so the default applies.
  assert.equal(limits.maxExclusionZones, DEFAULT_ZONE_LIMITS.maxExclusionZones);
});

test('a room is judged by the profile it points at', () => {
  const profiles = [ep1, epLite];
  assert.equal(roomSupportsZoneEditing({ profileId: 'everything_presence_one' }, profiles), false);
  assert.equal(roomSupportsZoneEditing({ profileId: 'everything_presence_lite' }, profiles), true);
  // A room with no profile, or one whose profile has not loaded, stays allowed.
  assert.equal(roomSupportsZoneEditing({ profileId: null }, profiles), true);
  assert.equal(roomSupportsZoneEditing({ profileId: 'not_loaded_yet' }, profiles), true);
  assert.equal(roomSupportsZoneEditing(null, profiles), true);
});
