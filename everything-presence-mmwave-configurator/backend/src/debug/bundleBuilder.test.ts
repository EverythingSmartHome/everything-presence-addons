import assert from 'node:assert/strict';
import test from 'node:test';
import type { DeviceMapping } from '../config/deviceMappingStorage';
import type { AppSettings, RoomConfig } from '../domain/types';
import { buildDebugBundle, DebugBundleSources } from './bundleBuilder';
import type { DebugSessionStatus } from './debugSession';

const FAKE_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJmYWtlLXRva2VuIn0.c2lnbmF0dXJlLWZha2UtdG9rZW4';
const PLAIN_TOKEN = 'plain-long-lived-token-value-123';
const MAC = 'A4:CF:12:34:56:78';
const MAC_BARE = 'a4cf12345678';
const SSID = 'MyHomeNetwork5G';
const IP = '192.168.50.23';

const mapping: DeviceMapping = {
  deviceId: 'dev1',
  profileId: 'everything_presence_lite',
  deviceName: 'Lounge EPL',
  discoveredAt: '2026-01-01T00:00:00Z',
  lastUpdated: '2026-01-01T00:00:00Z',
  confirmedByUser: true,
  autoMatchedCount: 1,
  manuallyMappedCount: 0,
  mappings: { presenceEntity: 'binary_sensor.old_occupancy' },
  unmappedEntities: ['sensor.lounge_wifi_ssid'],
  entityUniqueIds: { 'binary_sensor.old_occupancy': `${MAC_BARE}-binary_sensor-occupancy` },
};

const status: DebugSessionStatus = {
  active: false,
  sessionId: 's1',
  startedAt: null,
  expiresAt: null,
  stoppedAt: null,
  stopReason: null,
  remainingMs: 0,
  restarts: 0,
  maxDurationMs: 1,
  logLevel: 'info',
  server: { entries: 0, dropped: 0, bytes: 0 },
  client: { entries: 0, dropped: 0 },
};

const sources = (overrides: Partial<DebugBundleSources> = {}): DebugBundleSources => ({
  appVersion: '2.2.6',
  haMode: 'standalone',
  readTransport: {
    isConnected: true,
    listEntityRegistry: async () => [
      {
        entity_id: 'binary_sensor.new_occupancy',
        name: null,
        platform: 'esphome',
        device_id: 'dev1',
        disabled_by: null,
        hidden_by: null,
        unique_id: `${MAC_BARE}-binary_sensor-occupancy`,
      },
    ],
    getAllStates: async () => [
      { entity_id: 'sensor.lounge_wifi_ssid', state: SSID, attributes: {}, last_changed: '', last_updated: '' },
    ],
    listDevices: async () => {
      throw new Error('device registry unavailable');
    },
  },
  listMappings: () => [mapping],
  listRooms: () => [{ id: 'room-1', name: 'Lounge', zones: [], deviceId: 'dev1' } as unknown as RoomConfig],
  getSettings: () => ({ wizardCompleted: true, wizardStep: 'done' } as AppSettings),
  sessionStatus: () => status,
  serverLogs: () => ({
    entries: [
      { level: 50, msg: `HA call failed with Authorization: Bearer ${PLAIN_TOKEN}`, req: { headers: { authorization: `Bearer ${FAKE_TOKEN}` } } },
      { level: 30, msg: `Device ${MAC} connected from ${IP}`, wifi: { ssid: SSID } },
      { level: 20, msg: `token in text ${FAKE_TOKEN}` },
    ],
    dropped: 2,
    bytes: 100,
    maxEntries: 10,
    maxBytes: 100,
  }),
  clientLogs: () => ({ entries: [{ msg: `GET http://${IP}:8123/api/states` }], dropped: 0, bytes: 1, maxEntries: 1, maxBytes: 1 }),
  getHaVersion: async () => '2026.11.0',
  knownSecrets: [PLAIN_TOKEN],
  ...overrides,
});

test('bundle never contains secrets, MACs or SSIDs, and masks IPs by default', async () => {
  const bundle = await buildDebugBundle(sources());
  const json = JSON.stringify(bundle);
  assert.equal(json.includes(FAKE_TOKEN), false, 'JWT token leaked');
  assert.equal(json.includes(PLAIN_TOKEN), false, 'plain token leaked');
  assert.equal(json.toLowerCase().includes(MAC.toLowerCase()), false, 'MAC leaked');
  assert.equal(json.toLowerCase().includes(MAC_BARE), false, 'bare MAC leaked');
  assert.equal(json.includes(SSID), false, 'SSID leaked');
  assert.equal(json.includes(IP), false, 'IP leaked without includeNetworkDetails');
  assert.ok(json.includes('mac#1'));
  assert.ok(json.includes('ip#1'));
});

test('IPs appear only with includeNetworkDetails; secrets still removed', async () => {
  const bundle = await buildDebugBundle(sources(), { includeNetworkDetails: true });
  const json = JSON.stringify(bundle);
  assert.ok(json.includes(IP));
  assert.equal(json.includes(FAKE_TOKEN), false);
  assert.equal(json.includes(PLAIN_TOKEN), false);
  assert.equal(json.toLowerCase().includes(MAC.toLowerCase()), false);
  assert.equal(json.includes(SSID), false);
});

test('diagnoses mappings before redaction (rename detected via unique_id)', async () => {
  const bundle = (await buildDebugBundle(sources())) as any;
  const entity = bundle.diagnostics.devices[0].entities[0];
  assert.equal(entity.status, 'renamed');
  assert.equal(entity.currentEntityId, 'binary_sensor.new_occupancy');
  assert.equal(bundle.homeAssistant.version, '2026.11.0');
  assert.equal(bundle.rooms[0].name, 'Lounge');
  assert.equal(bundle.settings.wizardCompleted, true);
  assert.equal(bundle.serverLogs.dropped, 2);
});

test('credentials and SSIDs inside console messages, response bodies and errors never reach the bundle', async () => {
  const values = ['pw-Secret-1', 'tok-Secret-2', 'key-Secret-3', 'SsidSecret4', 'BssidSecret5'];
  const [password, token, apiKey, ssid, bssid] = values;
  const bundle = await buildDebugBundle(
    sources({
      serverLogs: () => ({
        entries: [
          {
            level: 50,
            msg: 'Service call failed',
            error: {
              type: 'Error',
              message: `HA returned 400: {"password":"${password}","token":"${token}","api_key":"${apiKey}","ssid":"${ssid}","bssid":"${bssid}"}`,
              stack: `Error: password=${password} token=${token} api_key=${apiKey} ssid=${ssid} bssid=${bssid}\n    at HaWriteClient.callService`,
            },
          },
        ],
        dropped: 0,
        bytes: 1,
        maxEntries: 1,
        maxBytes: 1,
      }),
      clientLogs: () => ({
        entries: [
          {
            kind: 'console',
            msg: `Saving {"password":"${password}","token":"${token}","api_key":"${apiKey}","ssid":"${ssid}","bssid":"${bssid}"}`,
          },
          {
            kind: 'fetch',
            msg: 'POST /api/x 500',
            body: `{"error":{"password":"${password}","token":"${token}"},"api_key":"${apiKey}","ssid":"${ssid}","bssid":"${bssid}"}`,
          },
        ],
        dropped: 0,
        bytes: 1,
        maxEntries: 1,
        maxBytes: 1,
      }),
    }),
  );
  const json = JSON.stringify(bundle);
  for (const value of values) {
    assert.equal(json.includes(value), false, `${value} leaked`);
  }
});

test('escaped, nested and truncated secrets never reach the bundle', async () => {
  // Values chosen so that no 4-character fragment occurs naturally elsewhere in the bundle.
  const secrets = ['QzxEscWq4242', 'QzxNstWq7777', 'QzxCutWq9999'];
  const nested = JSON.stringify({ body: JSON.stringify({ detail: JSON.stringify({ password: secrets[1] }) }) });
  const truncatedConsole = `${'y'.repeat(3980)} {"password":"${secrets[2]}`.slice(0, 4000) + '…[truncated 50 chars]';
  const bundle = await buildDebugBundle(
    sources({
      serverLogs: () => ({
        entries: [
          { level: 50, msg: `Login failed password="pre\\"${secrets[0]}" retrying` },
          { level: 50, msg: `HA error ${JSON.stringify(nested)}` },
        ],
        dropped: 0,
        bytes: 1,
        maxEntries: 1,
        maxBytes: 1,
      }),
      clientLogs: () => ({
        entries: [{ kind: 'console', msg: truncatedConsole }, { kind: 'console', msg: 'listed 102030405060-sensor-x' }],
        dropped: 0,
        bytes: 1,
        maxEntries: 1,
        maxBytes: 1,
      }),
    }),
  );
  const json = JSON.stringify(bundle);
  for (const secret of secrets) {
    for (let i = 0; i + 4 <= secret.length; i += 1) {
      const fragment = secret.slice(i, i + 4);
      const at = json.indexOf(fragment);
      assert.equal(at, -1, `fragment "${fragment}" of ${secret} leaked: …${json.slice(Math.max(0, at - 80), at + 20)}`);
    }
  }
  assert.equal(json.includes('102030405060'), false);
});

test('all-digit MACs in stored unique_ids are masked', async () => {
  const bundle = await buildDebugBundle(
    sources({
      listMappings: () => [
        { ...mapping, entityUniqueIds: { 'binary_sensor.old_occupancy': '102030405060-binary_sensor-occupancy' } },
      ],
    }),
  );
  assert.equal(JSON.stringify(bundle).includes('102030405060'), false);
});

test('section failures are listed in errors[] and the rest of the bundle is built', async () => {
  const bundle = (await buildDebugBundle(
    sources({
      listRooms: () => {
        throw new Error('rooms.json unreadable');
      },
      getHaVersion: async () => {
        throw new Error('HA config unavailable');
      },
    }),
  )) as any;
  const sections = bundle.errors.map((e: any) => e.section);
  assert.ok(sections.includes('rooms'));
  assert.ok(sections.includes('homeAssistant.version'));
  assert.ok(sections.includes('diagnostics.deviceRegistry'));
  assert.equal(bundle.rooms, null);
  assert.equal(bundle.homeAssistant.version, null);
  assert.ok(Array.isArray(bundle.deviceMappings));
});

test('without a Home Assistant connection the bundle still builds', async () => {
  const bundle = (await buildDebugBundle(sources({ readTransport: undefined, getHaVersion: undefined }))) as any;
  assert.equal(bundle.diagnostics.registryAvailable, false);
  assert.equal(bundle.homeAssistant.version, null);
});
