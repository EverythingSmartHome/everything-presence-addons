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
  t.mock.method(FirmwareService.prototype, 'prepareFirmwareForDevice', async (deviceId: string, url: string) => {
    downloaded = url;
    return { deviceId, token: 'prepared-only', version: '1.2.17', localManifestUrl: 'http://localhost/test.json' };
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
  device = { ...device, configSource: 'inferred' };
  response = await request({ wifiPowerProfile: 'wifi11' }); assert.equal(response.status, 409);
});
