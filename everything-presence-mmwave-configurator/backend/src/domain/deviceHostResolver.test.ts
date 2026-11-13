import assert from 'node:assert/strict';
import test from 'node:test';
import type { DeviceRegistryEntry } from '../ha/readTransport';
import { DeviceHostResolver, extractHostFromDiagnostics } from './deviceHostResolver';

const device = (id: string, configEntries: string[]): DeviceRegistryEntry => ({
  id,
  name: id,
  name_by_user: null,
  manufacturer: 'Everything Smart Technology',
  model: 'Everything Presence Lite',
  sw_version: '1.3.0 (ESPHome 2025.11.0)',
  hw_version: null,
  serial_number: null,
  area_id: null,
  disabled_by: null,
  config_entries: configEntries,
  identifiers: [],
});

/** Shape of HA's ESPHome config entry diagnostics (noise_psk redacted by HA). */
const esphomeDiagnostics = (host: string) => ({
  home_assistant: { version: '2026.11.0' },
  integration_manifest: { domain: 'esphome' },
  data: {
    config: {
      entry_id: 'entry1',
      domain: 'esphome',
      data: { host, port: 6053, password: '', noise_psk: '**REDACTED**', device_name: 'everything-presence-lite-abc123' },
    },
    storage_data: {},
  },
});

const fakeFetch = (routes: Record<string, unknown>) => {
  const calls: string[] = [];
  const fetchImpl = async (url: string) => {
    calls.push(url.replace('http://supervisor/core/api', ''));
    const path = url.replace('http://supervisor/core/api', '');
    if (!(path in routes)) return new Response('not found', { status: 404 });
    const body = routes[path];
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { calls, fetchImpl };
};

const resolver = (devices: DeviceRegistryEntry[], fetchImpl: (url: string) => Promise<Response>) =>
  new DeviceHostResolver({
    baseUrl: 'http://supervisor/core/api',
    token: 'tok',
    listDevices: async () => devices,
    fetchImpl,
  });

test('single config entry: one diagnostics request returns the host', async () => {
  const f = fakeFetch({ '/diagnostics/config_entry/entry1': esphomeDiagnostics('192.168.1.50') });
  const result = await resolver([device('dev1', ['entry1'])], f.fetchImpl).lookup('dev1');
  assert.deepEqual(result, { ok: true, host: '192.168.1.50' });
  assert.deepEqual(f.calls, ['/diagnostics/config_entry/entry1']);
});

test('several config entries: picks the ESPHome one', async () => {
  const f = fakeFetch({
    '/config/config_entries/entry?domain=esphome': [{ entry_id: 'entry2', domain: 'esphome' }],
    '/diagnostics/config_entry/entry2': esphomeDiagnostics('epl.local'),
  });
  const result = await resolver([device('dev1', ['entry1', 'entry2'])], f.fetchImpl).lookup('dev1');
  assert.deepEqual(result, { ok: true, host: 'epl.local' });
  assert.ok(!f.calls.includes('/diagnostics/config_entry/entry1'));
});

test('unknown device and missing entries are reported', async () => {
  const f = fakeFetch({});
  assert.deepEqual(await resolver([], f.fetchImpl).lookup('dev1'), { ok: false, reason: 'device_not_found' });
  assert.deepEqual(await resolver([device('dev1', [])], f.fetchImpl).lookup('dev1'), {
    ok: false,
    reason: 'no_esphome_entry',
  });
});

test('diagnostics HTTP error is reported', async () => {
  const f = fakeFetch({ '/diagnostics/config_entry/entry1': new Response('forbidden', { status: 401 }) });
  assert.deepEqual(await resolver([device('dev1', ['entry1'])], f.fetchImpl).lookup('dev1'), {
    ok: false,
    reason: 'diagnostics_unavailable',
    detail: 'HTTP 401',
  });
});

test('extractHostFromDiagnostics rejects junk', () => {
  assert.equal(extractHostFromDiagnostics(esphomeDiagnostics('10.0.0.1')), '10.0.0.1');
  assert.equal(extractHostFromDiagnostics(esphomeDiagnostics('http://evil/')), null);
  assert.equal(extractHostFromDiagnostics({ data: {} }), null);
  assert.equal(extractHostFromDiagnostics(null), null);
});
