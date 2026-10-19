// @ts-nocheck -- Node's built-in runner; production code stays dependency-free.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCeilingEntryZones,
  buildCeilingExclusionZones,
  buildCeilingSliceZones,
  getCeilingSlicePosition,
  normalizeCeilingSliceConfig,
  usesCeilingSlices,
} from './ceilingSlices.ts';

const bounds = (zone, axis) => [Math.min(...zone.vertices.map(v => v[axis])), Math.max(...zone.vertices.map(v => v[axis]))];
const entry2 = {
  id: 'Entry 2', type: 'entry', enabled: true,
  vertices: [{ x: -1800, y: 500 }, { x: -800, y: 500 }, { x: -800, y: 1000 }, { x: -1800, y: 1000 }],
};

test('Lite and Pro select the same ceiling mode, without enabling it for wall mounts or EP1', () => {
  for (const profile of ['everything_presence_lite', 'everything_presence_pro']) {
    assert.equal(usesCeilingSlices(profile, 'ceiling'), true);
    assert.equal(usesCeilingSlices(profile, 'wall'), false);
  }
  assert.equal(usesCeilingSlices('everything_presence_one', 'ceiling'), false);
  assert.equal(usesCeilingSlices(undefined, 'ceiling'), false);
});

test('entry slices pair mirrored display positions with native bounds and full depth', () => {
  const config = normalizeCeilingSliceConfig({ entryRangesMm: [{ slot: 1, min: 800, max: 1800 }] }, 6000, true);
  const [display] = buildCeilingEntryZones(config, { 'Entry 1': 'Door' }, 'display');
  const [device] = buildCeilingEntryZones(config);
  assert.deepEqual(bounds(display, 'x'), [800, 1800]);
  assert.deepEqual(bounds(device, 'x'), [-1800, -800]);
  assert.deepEqual(bounds(device, 'y'), [-6000, 6000]);
  assert.equal(display.label, 'Door');
  assert.equal(device.type, 'entry');
  const lateral = getCeilingSlicePosition({ x: -1200, y: 3100 }, config);
  assert.ok(lateral > 800 && lateral < 1800);
  assert.ok(-1200 > bounds(device, 'x')[0] && -1200 < bounds(device, 'x')[1]);
});

test('existing entry slots are imported without renumbering or changing native lateral bounds', () => {
  const before = structuredClone(entry2);
  const config = normalizeCeilingSliceConfig({}, 6000, true, [entry2]);
  assert.deepEqual(config.entryRangesMm, [{ slot: 2, min: 800, max: 1800 }]);
  const [saved] = buildCeilingEntryZones(config);
  assert.equal(saved.id, 'Entry 2');
  assert.deepEqual(bounds(saved, 'x'), bounds(entry2, 'x'));
  assert.deepEqual(entry2, before);
});

test('explicit deletion or saved ranges override device import', () => {
  assert.deepEqual(buildCeilingEntryZones(normalizeCeilingSliceConfig({ entryRangesMm: [] }, 6000, true, [entry2])), []);
  const config = normalizeCeilingSliceConfig({ entryRangesMm: [{ slot: 1, min: -500, max: 500 }] }, 6000, true, [entry2]);
  assert.deepEqual(buildCeilingEntryZones(config).map(zone => zone.id), ['Entry 1']);
});

test('entry normalization rejects invalid or duplicate slots and non-finite ranges', () => {
  const config = normalizeCeilingSliceConfig({ entryRangesMm: [
    { slot: 0, min: 0, max: 100 }, { slot: 3, min: 0, max: 100 },
    { slot: 1, min: NaN, max: 100 }, { slot: 2, min: 1000, max: 500 },
    { slot: 2, min: 0, max: 100 },
  ] }, 6000);
  assert.deepEqual(config.entryRangesMm, [{ slot: 2, min: 400, max: 1100 }]);
});

test('Y-axis import and unmirrored mode use the same existing slice convention', () => {
  for (const mirrorLateralAxis of [false, true]) {
    const config = normalizeCeilingSliceConfig({ axis: 'y', mirrorLateralAxis }, 6000, false, [entry2]);
    const [saved] = buildCeilingEntryZones(config);
    assert.deepEqual(bounds(saved, 'y'), bounds(entry2, 'y'));
    assert.deepEqual(bounds(saved, 'x'), [-6000, 6000]);
  }
});

test('adding entry slices leaves existing regular and exclusion generation unchanged', () => {
  const raw = { sliceCount: 2, exclusionRangesMm: [{ min: -500, max: 500 }] };
  const before = normalizeCeilingSliceConfig(raw, 6000, true);
  const after = normalizeCeilingSliceConfig({ ...raw, entryRangesMm: [{ slot: 1, min: 800, max: 1800 }] }, 6000, true);
  for (const space of ['display', 'device']) {
    assert.deepEqual(buildCeilingSliceZones(after, {}, space), buildCeilingSliceZones(before, {}, space));
    assert.deepEqual(buildCeilingExclusionZones(after, {}, space), buildCeilingExclusionZones(before, {}, space));
  }
});
