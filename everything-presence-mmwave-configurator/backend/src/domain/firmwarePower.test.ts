import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { firmwareStorage, CachedFirmwareEntry } from '../config/firmwareStorage';
import assert from 'node:assert/strict';
import test from 'node:test';
import { withWifiPowerProfile, wifiPowerProfile } from './firmwarePower';
import { FirmwareService } from './firmwareService';
import type { DeviceConfig, FirmwareIndex, FirmwareVariant } from '../types/firmware';
import type { FirmwareConfig } from '../config';

const current: DeviceConfig = {
  model: 'everything-presence-one', ethernet_enabled: false, co2_enabled: true,
  bluetooth_enabled: true, board_revision: '1.6', sensor_variant: 'sen0609',
  firmware_channel: 'stable', configSource: 'entities',
};
const reduced = withWifiPowerProfile(current, 'wifi11');
const variant = (config: DeviceConfig): FirmwareVariant => ({
  id: config.firmware_channel, manifestUrl: `${config.firmware_channel}-manifest.json`, requirements: config,
});
const index: FirmwareIndex = {
  schemaVersion: '1.0', generatedAt: '', product: { id: current.model, displayName: 'EP1', latestVersion: '1.2.18' },
  migrations: [], firmwares: [current, reduced].map(config => ({
    version: '1.2.18', channel: config.firmware_channel as 'stable' | 'stable-wifi11',
    releaseDate: '', releaseNotes: '', variants: [variant(config)],
  })),
};
const service = () => new FirmwareService({ config: {} as FirmwareConfig });

test('released firmware without a power flag can opt in without changing hardware flags', () => {
  assert.equal(wifiPowerProfile(current), 'standard');
  assert.deepEqual(reduced, { ...current, firmware_channel: 'stable-wifi11', wifi_power_profile: 'wifi11' });
  assert.deepEqual(withWifiPowerProfile(reduced, 'standard'), { ...current, wifi_power_profile: 'standard' });
});

test('power switching refuses inferred hardware, unsupported devices/channels, and invalid input', () => {
  for (const config of [
    { ...current, configSource: 'inferred' as const },
    { ...current, model: 'everything-presence-lite' as const },
    { ...current, firmware_channel: 'beta' as const },
    { ...current, sensor_variant: '' },
    { ...current, ethernet_enabled: true },
    { ...current, board_revision: '9.9' },
    { ...current, firmware_channel: 'smartthings' as const },
    { ...current, board_revision: '1.3' },
  ]) assert.throws(() => withWifiPowerProfile(config, 'wifi11'));
  for (const input of [11, null, '', 'standard-wifi11', {}]) {
    assert.throws(() => withWifiPowerProfile(current, input));
  }
});

test('automatic updates and reinstall keep both profiles separate', async () => {
  const svc = service();
  svc.fetchAllFirmwareIndexes = async () => [index];
  for (const config of [current, reduced]) {
    assert.equal(svc.findMatchingFirmware(config, [index])?.id, config.firmware_channel);
    const updates = await svc.getAvailableUpdates(config, '1.2.17');
    assert.equal(updates.length, 1);
    assert.equal(updates[0].variant.id, config.firmware_channel);
  }
  assert.equal(svc.findMatchingFirmware(reduced, [{ ...index, firmwares: [index.firmwares[0]] }]), null);
});

test('profile matching rejects contradictory metadata rather than choosing the first variant', () => {
  const wrong = variant({ ...current, wifi_power_profile: 'wifi11' });
  const mixed = { ...index, firmwares: [{ ...index.firmwares[0], variants: [wrong, variant(current)] }] };
  assert.equal(service().findMatchingFirmware(current, [mixed])?.requirements.wifi_power_profile, undefined);
  assert.equal(service().validateFirmwareCompatibility(current, variant(reduced)).valid, false);
  assert.equal(service().validateFirmwareCompatibility(reduced, variant(reduced)).valid, true);
});

test('existing clients filtering by channel cannot cross power profiles', () => {
  // This is the matching rule used before Wi-Fi profile support existed.
  const oldClientCandidates = index.firmwares.filter(fw => fw.channel === reduced.firmware_channel);
  assert.equal(oldClientCandidates.length, 1);
  assert.equal(oldClientCandidates[0].variants[0].id, 'stable-wifi11');
  assert.equal(index.firmwares.filter(fw => fw.channel === 'stable').flatMap(fw => fw.variants).length, 1);
});


test('manifest lookup uses its owning index and rejects uncatalogued URLs', async t => {
  const svc = service();
  t.mock.method(firmwareStorage, 'getSettings', () => ({ firmwareIndexUrls: ['https://example.com/lite/firmware-index.json', 'https://example.com/ep1/firmware-index.json'] }));
  t.mock.method(svc, 'fetchFirmwareIndex', async (url: string) => url.includes('/ep1/') ? index : { ...index, product: { ...index.product, id: 'everything-presence-lite' }, firmwares: [] });
  assert.equal(await svc.resolveVariantManifestUrl(variant(reduced), current.model), 'https://example.com/ep1/stable-wifi11-manifest.json');
  assert.equal((await svc.findVariantByManifestUrl('https://example.com/ep1/stable-wifi11-manifest.json'))?.id, 'stable-wifi11');
  assert.equal(await svc.findVariantByManifestUrl('https://example.com/unknown.json'), null);
});


test('preparation stores catalog requirements alongside the downloaded manifest version', async t => {
  const svc = service();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'firmware-power-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  t.mock.method(firmwareStorage, 'ensureDeviceCacheDir', () => directory);
  t.mock.method(firmwareStorage, 'getSettings', () => ({}));
  t.mock.method(firmwareStorage, 'cleanupOldVersions', () => {});
  let stored: any;
  t.mock.method(firmwareStorage, 'saveCacheEntry', (entry: CachedFirmwareEntry) => { stored = entry; });
  t.mock.method(svc, 'getLanIp', () => '127.0.0.1');
  t.mock.method(svc, 'fetchRemoteManifest', async () => ({ name: 'EP1', version: '1.2.17', builds: [{ chipFamily: 'ESP32', parts: [] }] }));
  const metadata = variant(reduced);
  const prepared = await svc.prepareFirmwareForDevice('ep1', 'https://example.com/manifest.json', metadata);
  assert.equal(prepared.version, '1.2.17');
  assert.equal(stored.version, prepared.version);
  assert.deepEqual(stored.variant, metadata);
  assert.equal(stored.variant.requirements.wifi_power_profile, 'wifi11');
});
