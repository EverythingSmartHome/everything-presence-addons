import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { FirmwareService } from '../domain/firmwareService';
import { createFirmwareRouter } from './firmware';
import { firmwareStorage } from '../config/firmwareStorage';
import type { DeviceConfig, FirmwareIndex } from '../types/firmware';
import type { FirmwareConfig } from '../config';
import type { IHaWriteClient } from '../ha/writeClient';

test('support prepare chooses the requested power profile using legacy build flags, without flashing', async t => {
  let device: DeviceConfig = { model: 'everything-presence-one', ethernet_enabled: false,
    co2_enabled: false, bluetooth_enabled: true, board_revision: '1.6', sensor_variant: 'sen0609',
    firmware_channel: 'stable', configSource: 'entities' };
  let downloaded = '';
  let preparedVersion = '1.2.17';
  const index: FirmwareIndex = { schemaVersion: '1.0', generatedAt: '',
    product: { id: device.model, displayName: 'EP1', latestVersion: '1.2.17' }, migrations: [],
    firmwares: ['stable', 'stable-wifi11'].map(channel => ({ version: '1.2.17', channel: channel as 'stable' | 'stable-wifi11',
      releaseDate: '', releaseNotes: '', variants: [{ id: channel, manifestUrl: `${channel}-manifest.json`,
        requirements: { ...device, firmware_channel: channel, wifi_power_profile: channel === 'stable' ? 'standard' : 'wifi11' } }],
    })),
  };
  t.mock.method(FirmwareService.prototype, 'getDeviceConfig', async () => device);
  t.mock.method(FirmwareService.prototype, 'fetchAllFirmwareIndexes', async () => [index]);
  t.mock.method(firmwareStorage, 'getSettings', () => ({}));
  t.mock.method(FirmwareService.prototype, 'resolveVariantManifestUrl', async (variant: { manifestUrl: string }) => `https://example.com/${variant.manifestUrl}`);
  t.mock.method(FirmwareService.prototype, 'prepareFirmwareForDevice', async (deviceId: string, url: string, variant: { requirements: { firmware_channel: string } }) => {
    assert.equal(variant.requirements.firmware_channel, url.includes('wifi11') ? 'stable-wifi11' : 'stable');
    downloaded = url;
    return { deviceId, token: 'prepared-only', version: preparedVersion, localManifestUrl: 'http://localhost/test.json' };
  });
  const app = express(); app.use(express.json());
  app.use('/api/firmware', createFirmwareRouter({ config: {} as FirmwareConfig, writeClient: {} as IHaWriteClient }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/firmware/auto-prepare`;
  const request = (extra = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceModel: 'Everything Presence One', currentVersion: '1.2.17', deviceId: 'ep1-test', ...extra }) });

  let response = await request({ wifiPowerProfile: 'wifi11' });
  assert.equal(response.status, 200);
  assert.match(downloaded, /stable-wifi11-manifest.json$/);
  assert.equal((await response.json() as any).newVersion, '1.2.17'); // Same-version switches must work.
  response = await request(); assert.equal(response.status, 200);
  assert.match(downloaded, /\/stable-manifest.json$/);
  device = { ...device, firmware_channel: 'stable-wifi11', wifi_power_profile: 'wifi11' };
  response = await request(); assert.equal(response.status, 200);
  assert.match(downloaded, /stable-wifi11-manifest.json$/);
  response = await request({ wifiPowerProfile: 'standard' }); assert.equal(response.status, 200);
  assert.match(downloaded, /\/stable-manifest.json$/);
  response = await request({ wifiPowerProfile: 'invalid' }); assert.equal(response.status, 400);
  index.product.latestVersion = '9.0.0';
  index.migrations = [{ id: 'rectangular-to-polygon-zones', fromVersion: '<2.0.0', toVersion: '>=2.0.0', description: 'Test migration', backupRequired: true, handler: 'test' }];
  response = await request();
  assert.equal((await response.json() as any).migration, undefined, 'a newer product release must not trigger migration for an older prepared manifest');
  preparedVersion = '2.0.0';
  index.product.latestVersion = '1.2.17';
  response = await request();
  assert.equal((await response.json() as any).migration.id, 'rectangular-to-polygon-zones', 'migration follows the downloaded manifest version');
  device = { ...device, configSource: 'inferred' };
  response = await request({ wifiPowerProfile: 'wifi11' }); assert.equal(response.status, 409);
});


test('every install revalidates cached metadata and requires explicit power-switch consent', async t => {
  const standard: DeviceConfig = { model: 'everything-presence-one', ethernet_enabled: false,
    co2_enabled: false, bluetooth_enabled: true, board_revision: '1.6', sensor_variant: 'sen0609',
    firmware_channel: 'stable', configSource: 'entities' };
  const low = { ...standard, firmware_channel: 'stable-wifi11' as const, wifi_power_profile: 'wifi11' as const };
  const variant = (config: DeviceConfig) => ({ id: config.firmware_channel, manifestUrl: 'manifest.json', requirements: config });
  let device = standard;
  let entry: any = { deviceId: 'ep1', token: 'cached', version: '1.2.17', variant: variant(low) };
  let triggered = 0;
  let reads = 0;
  let prepared = 0;
  t.mock.method(FirmwareService.prototype, 'getDeviceConfig', async () => { reads++; return device; });
  t.mock.method(firmwareStorage, 'getCacheEntry', () => entry);
  t.mock.method(FirmwareService.prototype, 'resolveService', async () => ({ domain: 'esphome', service: 'update' }));
  t.mock.method(FirmwareService.prototype, 'getLanIp', () => '127.0.0.1');
  t.mock.method(FirmwareService.prototype, 'triggerDeviceUpdate', async () => { triggered++; });
  t.mock.method(FirmwareService.prototype, 'findVariantByManifestUrl', async () => entry?.variant ?? null);
  t.mock.method(FirmwareService.prototype, 'prepareFirmwareForDevice', async () => { prepared++; return { version: '1.2.17' }; });
  const app = express(); app.use(express.json());
  app.use(createFirmwareRouter({ config: { lanPort: 38080 } as FirmwareConfig, writeClient: {} as IHaWriteClient }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: object) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const install = (extra = {}) => post('/update/ep1', { token: 'cached', ...extra });
  const blocked = async (extra = {}, status = 409) => {
    const before = triggered;
    assert.equal((await install(extra)).status, status);
    assert.equal(triggered, before, 'rejected requests must not reach the device');
  };
  await blocked(); // Cached cross-profile install / retry without confirmation.
  assert.equal(reads, 1);
  assert.equal((await install({ wifiPowerProfile: 'wifi11' })).status, 200);
  await blocked(); // Prior consent is not retained by the token.
  await blocked({ wifiPowerProfile: 'invalid' }, 400);
  await blocked({ wifiPowerProfile: 'standard' }); // Consent must describe the actual artifact.
  device = low;
  assert.equal((await install()).status, 200); // Same profile.
  entry = { ...entry, variant: variant(standard) };
  await blocked();
  assert.equal((await install({ wifiPowerProfile: 'standard' })).status, 200);
  device = { ...standard, configSource: 'inferred' };
  await blocked();
  device = { ...standard, ethernet_enabled: true };
  await blocked();
  await blocked({ wifiPowerProfile: 'standard' }, 400);
  device = standard;
  entry = { ...entry, variant: variant({ ...standard, sensor_variant: 'sen0395' }) };
  await blocked();
  entry = { ...entry, variant: variant({ ...low, bluetooth_enabled: false }) };
  await blocked({ wifiPowerProfile: 'wifi11' }); // Support switches preserve other flags.
  entry = { ...entry, variant: undefined };
  await blocked(); // Legacy cache cannot be assumed standard.
  entry = null;
  await blocked({}, 404);
  const body = { deviceId: 'ep1', deviceModel: 'Everything Presence One', firmwareVersion: '1.2.17', manifestUrl: 'https://example.com/manifest.json' };
  assert.equal((await post('/prepare', body)).status, 409); // Uncatalogued manifest.
  entry = { variant: variant(low) };
  assert.equal((await post('/prepare', body)).status, 409); // Manual profile bypass.
  assert.equal(prepared, 0);
  entry = { variant: variant(standard) };
  assert.equal((await post('/prepare', body)).status, 200);
  assert.equal(prepared, 1);
});
