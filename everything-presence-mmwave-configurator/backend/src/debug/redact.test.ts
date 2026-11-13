import assert from 'node:assert/strict';
import test from 'node:test';
import { createRedactor, REDACTED, redactDeep } from './redact';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';

test('removes secret-named keys regardless of value type', () => {
  const out = redactDeep({
    token: 'abc',
    ha: { accessToken: 'x', password: 'p', apiKey: 'k', wifi_psk: 'w', cookie: 'c' },
    headers: { authorization: 'Bearer zzz' },
    authRequired: true,
  });
  assert.equal(out.token, REDACTED);
  assert.deepEqual(out.ha, { accessToken: REDACTED, password: REDACTED, apiKey: REDACTED, wifi_psk: REDACTED, cookie: REDACTED });
  assert.equal(out.headers.authorization, REDACTED);
  assert.equal(out.authRequired, true);
});

test('scrubs Bearer credentials, JWTs and query tokens inside free text', () => {
  const out = redactDeep({ msg: `call failed: Bearer abc.def-123 then ${JWT} at /api/x?access_token=secret123&y=1` });
  assert.ok(!out.msg.includes('abc.def-123'));
  assert.ok(!out.msg.includes(JWT));
  assert.ok(!out.msg.includes('secret123'));
  assert.match(out.msg, /Bearer \[REDACTED\]/);
  assert.match(out.msg, /&y=1/);
});

test('scrubs explicitly known secret values anywhere', () => {
  const out = redactDeep({ note: 'value=supersecretvalue!' }, { knownSecrets: ['supersecretvalue'] });
  assert.equal(out.note, `value=${REDACTED}!`);
});

test('MACs become stable placeholders across colon and bare 12-hex forms', () => {
  const redactor = createRedactor();
  const out = redactor.redact({
    a: 'device AA:BB:CC:DD:EE:01 online',
    unique_id: 'aabbccddee01-sensor-target_1_x',
    b: 'other 11-22-33-44-55-6f',
  });
  assert.equal(out.a, 'device mac#1 online');
  assert.equal(out.unique_id, 'mac#1-sensor-target_1_x');
  assert.equal(out.b, 'other mac#2');
});

test('does not mangle UUIDs, HA device ids or version strings', () => {
  const value = {
    roomId: '3f2b8c1e-4d5a-4b6c-9e7f-a1b2c3d4e5f6',
    deviceId: '0123456789abcdef0123456789abcdef',
    sw: '1.4.1 (ESPHome 2025.11.2)',
    time: '12:30:45',
  };
  assert.deepEqual(redactDeep(value), value);
});

test('IPs are masked unless includeNetworkDetails is set; MACs stay masked', () => {
  const input = { url: 'http://192.168.1.20:8123', remote: '::ffff:10.0.0.5', v6: 'fe80::1ff:fe23:4567:890a', mac: 'AA:BB:CC:DD:EE:FF' };
  const masked = redactDeep(input);
  assert.equal(masked.url, 'http://ip#1:8123');
  assert.ok(!masked.remote.includes('10.0.0.5'));
  assert.ok(!masked.v6.includes('fe80'));
  const open = redactDeep(input, { includeNetworkDetails: true });
  assert.equal(open.url, input.url);
  assert.equal(open.v6, input.v6);
  assert.equal(open.mac, 'mac#1');
});

test('drops SSID/BSSID fields and states of SSID entities', () => {
  const out = redactDeep({
    ssid: 'HomeWifi',
    wifi: { bssid: 'x', wifi_ssid: 'HomeWifi' },
    states: [{ entity_id: 'sensor.ep_ssid', state: 'HomeWifi', attributes: { friendly_name: 'SSID' } }],
  }) as any;
  assert.equal(JSON.stringify(out).includes('HomeWifi'), false);
  assert.deepEqual(out.states[0], { entity_id: 'sensor.ep_ssid' });
});

const SECRET_VALUES = ['hunter2pass', 'tok-abc-123', 'key-xyz-789', 'HomeWifiNet', 'de:ad:be:ef:00:11', 'BssidValue9'];

test('removes credential and SSID values from text in every common shape', () => {
  const texts = [
    // console object stringified in the browser
    '{"password":"hunter2pass","token":"tok-abc-123","api_key":"key-xyz-789","ssid":"HomeWifiNet","bssid":"BssidValue9","ok":1}',
    // failed response body embedded in a message
    'POST /api/x 500 {"detail":{"password":"hunter2pass","token":"tok-abc-123"},"api_key":"key-xyz-789","ssid":"HomeWifiNet","bssid":"BssidValue9"}',
    // error message / stack with assignments
    'Error: login failed password=hunter2pass token: tok-abc-123 api_key=key-xyz-789 ssid="HomeWifiNet" bssid: BssidValue9\n    at callService (writeClient.ts:10:5)',
    // JS-object style with single quotes and escaped JSON inside JSON
    "{ password: 'hunter2pass', 'token': 'tok-abc-123' } body=\"{\\\"api_key\\\":\\\"key-xyz-789\\\",\\\"ssid\\\":\\\"HomeWifiNet\\\",\\\"bssid\\\":\\\"BssidValue9\\\"}\"",
  ];
  for (const text of texts) {
    const out = redactDeep({ msg: text }).msg;
    for (const secret of SECRET_VALUES) {
      assert.equal(out.includes(secret), false, `${secret} leaked from: ${out}`);
    }
    assert.ok(out.includes(REDACTED));
  }
});

test('keeps the rest of a cleaned message and its JSON structure', () => {
  const out = redactDeep({ body: '{"message":"Invalid credentials","password":"p1"}' }).body;
  assert.deepEqual(JSON.parse(out), { message: 'Invalid credentials', password: REDACTED });
  assert.equal(redactDeep({ msg: 'Saved room Lounge (3 zones)' }).msg, 'Saved room Lounge (3 zones)');
});

test('masks all-digit MACs in ESPHome unique_ids and MAC-named keys, consistently', () => {
  const redactor = createRedactor();
  const out = redactor.redact({
    entityUniqueIds: { 'binary_sensor.occupancy': '102030405060-binary_sensor-occupancy', 'sensor.x': 'esphome-102030405060' },
    unique_id: '102030405060_sensor_target',
    mac: '102030405060',
    macAddress: '10:20:30:40:50:60',
    text: 'listed 102030405060-sensor-occupancy',
  });
  assert.equal(out.entityUniqueIds['binary_sensor.occupancy'], 'mac#1-binary_sensor-occupancy');
  assert.equal(out.entityUniqueIds['sensor.x'], 'esphome-mac#1');
  assert.equal(out.unique_id, 'mac#1_sensor_target');
  assert.equal(out.mac, 'mac#1');
  assert.equal(out.macAddress, 'mac#1');
  assert.equal(out.text, 'listed mac#1-sensor-occupancy');
});

test('masks a digit-only unique_id MAC embedded in a log message, matching the colon form', () => {
  const redactor = createRedactor();
  const out = redactor.redact({
    a: 'device 10:20:30:40:50:60 online',
    msg: 'Entity listed 102030405060-sensor-x not found; also (102030405060_sensor_y)',
  });
  assert.equal(out.a, 'device mac#1 online');
  assert.equal(out.msg, 'Entity listed mac#1-sensor-x not found; also (mac#1_sensor_y)');
  assert.equal(redactor.stats.macs, 1);
});

test('does not treat UUID tails or unrelated 12-digit numbers as MACs', () => {
  const value = {
    uuidTail: '3f2b8c1e-4d5a-4b6c-9e7f-102030405060-x',
    msg: 'processed 123456789012 records',
    word: 'abc123456789012-x',
  };
  assert.deepEqual(redactDeep(value), value);
});

const assertNoFragment = (out: string, secret: string) => {
  // No 4+ character piece of the secret may survive.
  for (let i = 0; i + 4 <= secret.length; i += 1) {
    const fragment = secret.slice(i, i + 4);
    assert.equal(out.includes(fragment), false, `fragment "${fragment}" of ${secret} leaked: ${out}`);
  }
};

test('escaped quotes inside a plain assignment value do not end redaction early', () => {
  const out = redactDeep({ msg: 'login password="prefix\\"SECRETSUFFIX" user=bob' }).msg;
  assertNoFragment(out, 'prefixSECRETSUFFIX');
  assert.match(out, /user=bob/);
  const single = redactDeep({ msg: "token='abc\\'QWERTYUIOP' next" }).msg;
  assertNoFragment(single, 'QWERTYUIOP');
});

test('nested escaping (JSON in a string in JSON) is redacted', () => {
  const nested = JSON.stringify({ outer: JSON.stringify({ inner: JSON.stringify({ password: 'NestedPw77' }) }) });
  for (const msg of [`Request failed: ${nested}`, `Request failed: ${JSON.stringify(nested)}`]) {
    assertNoFragment(redactDeep({ msg }).msg, 'NestedPw77');
  }
});

test('values cut mid-secret (unterminated quotes) are redacted to the end of the line', () => {
  const secret = 'QzxTrkWqPv999xyz';
  const cases = [
    `${'x'.repeat(3990)} {"password":"${secret}`.slice(0, 4000 + 8) + '…[truncated 120 chars]',
    `body {"api_key": "${secret.slice(0, 12)}`,
    `wrapped {\\"token\\":\\"${secret}`,
    `password="${secret}\nnext line stays`,
    `ssid: '${secret}`,
  ];
  for (const msg of cases) {
    const out = redactDeep({ msg }).msg;
    assertNoFragment(out, secret.slice(0, 12));
    assert.ok(out.includes(REDACTED), out.slice(-80));
  }
  assert.match(redactDeep({ msg: `password="${secret}\nnext line stays` }).msg, /\nnext line stays$/);
});

test('leaves plain 12-digit numbers elsewhere unchanged', () => {
  const value = { count: '123456789012', note: 'order 123456789012 shipped', n: 123456789012, roomId: 'room-123456789012' };
  assert.deepEqual(redactDeep(value), value);
});

test('handles circular references without throwing', () => {
  const a: any = { name: 'a' };
  a.self = a;
  assert.equal(redactDeep(a).self, '[Circular]');
});
