// @ts-nocheck -- Node's built-in runner supplies these modules; frontend production types stay dependency-free.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_CEILING_HEIGHT_MM,
  mountPlacementUpdate,
  outlineCenter,
  plannedMountPlacement,
  resolveCoverageOverlays,
  shouldShowCoverageCone,
  supportedMountTypes,
} from './plannedPlacement.ts';

const epp = { id: 'everything_presence_pro', iconUrlCeiling: './icons/devices/everything_presence_pro_ceiling.png' };
const epl = { id: 'everything_presence_lite' };
const ep1 = { id: 'everything_presence_one' };

test('only the EP Pro offers a ceiling mount', () => {
  assert.deepEqual(supportedMountTypes(epp), ['wall', 'ceiling']);
  assert.deepEqual(supportedMountTypes({ id: 'everything_presence_pro' }), ['wall', 'ceiling']);
  assert.deepEqual(supportedMountTypes(epl), ['wall']);
  assert.deepEqual(supportedMountTypes(ep1), ['wall']);
  assert.deepEqual(supportedMountTypes(null), ['wall']);
});

test('mount updates match the Room Builder defaults', () => {
  assert.deepEqual(mountPlacementUpdate('ceiling'), { mountType: 'ceiling', pitchDeg: 90, heightMm: DEFAULT_CEILING_HEIGHT_MM });
  assert.deepEqual(mountPlacementUpdate('ceiling', 2700), { mountType: 'ceiling', pitchDeg: 90, heightMm: 2700 });
  assert.deepEqual(mountPlacementUpdate('ceiling', 0), { mountType: 'ceiling', pitchDeg: 90, heightMm: DEFAULT_CEILING_HEIGHT_MM });
  assert.deepEqual(mountPlacementUpdate('wall'), { mountType: 'wall' });
});

test('a new planned placement starts at the room centre with the chosen mount', () => {
  const outline = [{ x: -2000, y: -1000 }, { x: 2000, y: -1000 }, { x: 2000, y: 3000 }, { x: -2000, y: 3000 }];
  assert.deepEqual(outlineCenter(outline), { x: 0, y: 1000 });
  assert.deepEqual(outlineCenter([]), { x: 0, y: 0 });
  assert.deepEqual(plannedMountPlacement(undefined, outline, 'ceiling', 2600), {
    x: 0, y: 1000, rotationDeg: 0, mountType: 'ceiling', pitchDeg: 90, heightMm: 2600,
  });
  assert.deepEqual(plannedMountPlacement(undefined, outline, 'wall'), { x: 0, y: 1000, rotationDeg: 0, mountType: 'wall' });
});

test('an existing planned position is kept when the mount changes', () => {
  const placed = { x: 500, y: 600, rotationDeg: 45 };
  assert.deepEqual(plannedMountPlacement(placed, [], 'wall'), { x: 500, y: 600, rotationDeg: 45, mountType: 'wall' });
});

test('planned wall-mounted rooms always show the cone, whatever the display setting', () => {
  for (const profileId of ['everything_presence_pro', 'everything_presence_lite', 'everything_presence_one']) {
    assert.equal(shouldShowCoverageCone({ profileId, devicePlacement: { x: 0, y: 0 } }, false), true);
    assert.equal(shouldShowCoverageCone({ profileId, devicePlacement: { x: 0, y: 0, mountType: 'wall' } }, false), true);
    assert.equal(shouldShowCoverageCone({ profileId }, false), true);
  }
});

test('a planned ceiling mount uses the footprint instead of the cone', () => {
  assert.equal(
    shouldShowCoverageCone({ profileId: 'everything_presence_pro', devicePlacement: { x: 0, y: 0, mountType: 'ceiling' } }, true),
    false,
  );
});

test('planned EPP on the ceiling: footprint on, wall cone off', () => {
  const room = { profileId: 'everything_presence_pro', devicePlacement: { x: 0, y: 0, mountType: 'ceiling', heightMm: 2400 } };
  assert.deepEqual(resolveCoverageOverlays(room, false), { cone: false, footprint: true });
  assert.deepEqual(resolveCoverageOverlays(room, true), { cone: false, footprint: true });
});

test('coverage overlays for wall mounts and linked rooms', () => {
  assert.deepEqual(resolveCoverageOverlays({ profileId: 'everything_presence_pro', devicePlacement: { x: 0, y: 0, mountType: 'wall' } }, false), { cone: true, footprint: false });
  const linkedWall = { deviceId: 'd', profileId: 'everything_presence_lite', devicePlacement: { x: 0, y: 0 } };
  assert.deepEqual(resolveCoverageOverlays(linkedWall, false), { cone: false, footprint: false });
  assert.deepEqual(resolveCoverageOverlays(linkedWall, true), { cone: true, footprint: false });
  const linkedCeiling = { deviceId: 'd', profileId: 'everything_presence_pro', devicePlacement: { x: 0, y: 0, mountType: 'ceiling' } };
  assert.deepEqual(resolveCoverageOverlays(linkedCeiling, true), { cone: false, footprint: true });
});

test('linked rooms follow the display setting', () => {
  const linked = { deviceId: 'dev-1', profileId: 'everything_presence_lite', devicePlacement: { x: 0, y: 0 } };
  assert.equal(shouldShowCoverageCone(linked, false), false);
  assert.equal(shouldShowCoverageCone(linked, true), true);
  assert.equal(shouldShowCoverageCone({}, true), true);
});
