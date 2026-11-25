import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';
const server = await createServer({ logLevel: 'silent', server: { middlewareMode: true } });
after(() => server.close());
const { wifiPowerUnavailableReason, verifyFirmwareInstall } = await server.ssrLoadModule('/src/utils/firmwarePower.ts');

const config = { model: 'everything-presence-one', firmware_channel: 'stable',
  configSource: 'entities', board_revision: '1.6', sensor_variant: 'sen0609',
  ethernet_enabled: false, bluetooth_enabled: true, co2_enabled: false };

test('support eligibility accepts legacy flags and rejects every unsupported hardware case', () => {
  assert.equal(wifiPowerUnavailableReason(config), null);
  assert.equal(wifiPowerUnavailableReason({ ...config, board_revision: '1.3', sensor_variant: 'sen0395' }), null);
  for (const patch of [{ configSource: 'inferred' }, { model: 'everything-presence-lite' },
    { firmware_channel: 'beta' }, { firmware_channel: 'smartthings' }, { ethernet_enabled: true },
    { board_revision: '9.9' }, { sensor_variant: '' }, { board_revision: '1.3' }]) {
    assert.ok(wifiPowerUnavailableReason({ ...config, ...patch }));
  }
});

test('same-version pre-flash status cannot complete; profile verification has a bounded failure', () => {
  const input = { ready: false, expectedVersion: '1.2.17', installedVersion: '1.2.17',
    expectedPower: 'wifi11', config, elapsedMs: 0 };
  const low = { ...config, firmware_channel: 'stable-wifi11' };
  assert.equal(verifyFirmwareInstall({ ...input, config: low }).verified, false);
  assert.equal(verifyFirmwareInstall({ ...input, ready: true }).error, undefined);
  assert.match(verifyFirmwareInstall({ ...input, ready: true, elapsedMs: 30000 }).error, /standard/);
  assert.match(verifyFirmwareInstall({ ...input, ready: true, elapsedMs: 30000, config: null }).error, /unavailable build flags/);
  assert.match(verifyFirmwareInstall({ ...input, ready: true, installedVersion: '1.2.16' }).error, /Expected v1.2.17/);
  assert.equal(verifyFirmwareInstall({ ...input, ready: true, config: low }).verified, true);
  assert.equal(verifyFirmwareInstall({ ...input, ready: true, expectedPower: 'standard' }).verified, true);
  assert.match(verifyFirmwareInstall({ ...input, ready: true, config: low, installedVersion: null, elapsedMs: 30000 }).error, /unknown version/);
});


test('install requests send power consent only when explicitly supplied and display readable API errors', async t => {
  const originalWindow = globalThis.window;
  globalThis.window = { location: { pathname: '/' } };
  t.after(() => { globalThis.window = originalWindow; });
  const { triggerFirmwareUpdate } = await server.ssrLoadModule('/src/api/client.ts');
  let body;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    body = JSON.parse(options.body);
    return new Response(JSON.stringify({ error: 'Use the support option to change power profiles.' }), { status: 409 });
  });
  await assert.rejects(triggerFirmwareUpdate('ep1', 'cached'), /409: Use the support option/);
  assert.deepEqual(body, { token: 'cached' });
  await assert.rejects(triggerFirmwareUpdate('ep1', 'cached', 'wifi11'), /409: Use the support option/);
  assert.deepEqual(body, { token: 'cached', wifiPowerProfile: 'wifi11' });
});
