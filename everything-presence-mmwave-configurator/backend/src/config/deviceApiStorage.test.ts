import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DeviceApiStorage, isValidHost } from './deviceApiStorage';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'device-api-'));

test('resolved host is saved but never overrides a manual host', () => {
  const storage = new DeviceApiStorage(tmp());
  storage.saveResolvedHost('d1', '10.0.0.5');
  assert.equal(storage.get('d1').host, '10.0.0.5');
  assert.equal(storage.get('d1').hostSource, 'ha');

  storage.setManualHost('d1', 'epl.local');
  storage.saveResolvedHost('d1', '10.0.0.9');
  assert.equal(storage.get('d1').host, 'epl.local');
  assert.equal(storage.get('d1').hostSource, 'manual');

  storage.setManualHost('d1', null);
  assert.equal(storage.get('d1').host, undefined);
});

test('key can be set and cleared; empty records are removed', () => {
  const dir = tmp();
  const storage = new DeviceApiStorage(dir);
  storage.setNoisePsk('d1', 'a'.repeat(43) + '=');
  assert.ok(storage.get('d1').noisePsk);
  storage.setNoisePsk('d1', null);
  assert.deepEqual(storage.get('d1'), {});
  const file = JSON.parse(fs.readFileSync(path.join(dir, 'device-api-connections.json'), 'utf-8'));
  assert.deepEqual(file.devices, {});
});

test('host validation', () => {
  for (const ok of ['10.0.0.5', 'everything-presence-lite-abc123.local', 'epl', 'fe80::1', 'fe80::1%eth0']) {
    assert.ok(isValidHost(ok), ok);
  }
  for (const bad of ['', 'http://10.0.0.5', '10.0.0.5:6053x', 'a b', 'host/path']) {
    assert.ok(!isValidHost(bad), bad);
  }
});
