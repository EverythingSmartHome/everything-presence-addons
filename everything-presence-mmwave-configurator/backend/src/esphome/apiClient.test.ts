import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import net from 'node:net';
import test from 'node:test';
import { DeviceLogMessage, EsphomeApiClient, EsphomeApiError, MessageType } from './apiClient';
import { startFakeDevice } from './fakeDevice.testutil';

const nextLog = (client: EsphomeApiClient) =>
  new Promise<DeviceLogMessage>((resolve) => client.once('log', resolve));

const expectError = async (promise: Promise<unknown>, code: string) => {
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof EsphomeApiError, `expected EsphomeApiError, got ${String(err)}`);
    assert.equal(err.code, code);
    return true;
  });
};

for (const mode of ['plaintext', 'encrypted'] as const) {
  test(`${mode}: connects, identifies the device and streams logs`, async () => {
    const psk = mode === 'encrypted' ? crypto.randomBytes(32) : undefined;
    const device = await startFakeDevice({ psk });
    const client = new EsphomeApiClient({ host: '127.0.0.1', port: device.port, noisePsk: psk });
    try {
      const info = await client.connect();
      assert.equal(info.name, 'everything-presence-lite-abc123');
      assert.equal(info.esphomeVersion, '2025.11.0');
      assert.equal(info.projectVersion, '1.3.0');
      assert.equal(info.friendlyName, 'Everything Presence Lite ABC');
      assert.equal(info.apiVersion, '1.10');
      // No password ConnectRequest (type 3) is ever sent.
      assert.deepEqual(device.received, [MessageType.HelloRequest, MessageType.DeviceInfoRequest]);

      client.subscribeLogs(5, true);
      await device.waitFor(MessageType.SubscribeLogsRequest);
      assert.deepEqual(device.subscriptions, [{ level: 5, dumpConfig: true }]);

      const log = nextLog(client);
      device.sendLog(5, '\x1b[0;36m[D][ld2450:123]: Target 1 moved\x1b[0m');
      assert.deepEqual(await log, { level: 5, message: '\x1b[0;36m[D][ld2450:123]: Target 1 moved\x1b[0m' });

      // Re-subscribing changes the level on the same connection.
      client.subscribeLogs(3, false);
      await new Promise((r) => setTimeout(r, 50));
      assert.deepEqual(device.subscriptions[1], { level: 3, dumpConfig: false });
    } finally {
      client.close();
      await device.close();
    }
  });
}

test('plaintext client against an encrypted device reports encryption_required', async () => {
  const device = await startFakeDevice({ psk: crypto.randomBytes(32) });
  const client = new EsphomeApiClient({ host: '127.0.0.1', port: device.port });
  try {
    await expectError(client.connect(), 'encryption_required');
  } finally {
    await device.close();
  }
});

test('wrong key reports bad_key', async () => {
  const device = await startFakeDevice({ psk: crypto.randomBytes(32) });
  const client = new EsphomeApiClient({ host: '127.0.0.1', port: device.port, noisePsk: crypto.randomBytes(32) });
  try {
    await expectError(client.connect(), 'bad_key');
  } finally {
    await device.close();
  }
});

test('key against a plaintext device reports encryption_not_supported', async () => {
  const device = await startFakeDevice();
  const client = new EsphomeApiClient({ host: '127.0.0.1', port: device.port, noisePsk: crypto.randomBytes(32) });
  try {
    await expectError(client.connect(), 'encryption_not_supported');
  } finally {
    await device.close();
  }
});

test('closed port reports unreachable', async () => {
  const server = net.createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((r) => server.close(() => r()));
  const client = new EsphomeApiClient({ host: '127.0.0.1', port });
  await expectError(client.connect(), 'unreachable');
});

test('silent device times out', async () => {
  const server = net.createServer(() => undefined);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as net.AddressInfo).port;
  const client = new EsphomeApiClient({ host: '127.0.0.1', port, connectTimeoutMs: 200 });
  try {
    await expectError(client.connect(), 'timeout');
  } finally {
    server.close();
  }
});

test('device-initiated disconnect emits close with device_disconnected', async () => {
  const device = await startFakeDevice();
  const client = new EsphomeApiClient({ host: '127.0.0.1', port: device.port });
  try {
    await client.connect();
    client.subscribeLogs(5, false);
    await device.waitFor(MessageType.SubscribeLogsRequest);
    const closed = new Promise<{ reason: string }>((resolve) => client.once('close', resolve));
    device.requestDisconnect();
    assert.equal((await closed).reason, 'device_disconnected');
  } finally {
    await device.close();
  }
});

test('close() sends DisconnectRequest', async () => {
  const key = crypto.randomBytes(32);
  const dev = await startFakeDevice({ psk: key });
  const client = new EsphomeApiClient({ host: '127.0.0.1', port: dev.port, noisePsk: key });
  try {
    await client.connect();
    client.close();
    await dev.waitFor(MessageType.DisconnectRequest);
  } finally {
    await dev.close();
  }
});

test('handles frames delivered one byte at a time', async () => {
  // A proxy that delivers the device's bytes one byte per chunk.
  const key = crypto.randomBytes(32);
  const dev = await startFakeDevice({ psk: key });
  const proxy = net.createServer((client) => {
    const upstream = net.connect(dev.port, '127.0.0.1');
    client.pipe(upstream);
    upstream.on('data', async (chunk: Buffer) => {
      upstream.pause();
      for (const byte of chunk) {
        client.write(Buffer.from([byte]));
        await new Promise((r) => setImmediate(r));
      }
      upstream.resume();
    });
    client.on('error', () => undefined);
    upstream.on('error', () => undefined);
    client.on('close', () => upstream.destroy());
  });
  await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
  const port = (proxy.address() as net.AddressInfo).port;
  const client = new EsphomeApiClient({ host: '127.0.0.1', port, noisePsk: key });
  try {
    const info = await client.connect();
    assert.equal(info.name, 'everything-presence-lite-abc123');
    client.subscribeLogs(5, false);
    await dev.waitFor(MessageType.SubscribeLogsRequest);
    const lines: string[] = [];
    const got = new Promise<void>((resolve) =>
      client.on('log', (l) => {
        lines.push(l.message);
        if (lines.length === 3) resolve();
      }),
    );
    dev.sendLog(5, 'one');
    dev.sendLog(5, 'two');
    dev.sendLog(5, 'three');
    await got;
    assert.deepEqual(lines, ['one', 'two', 'three']);
  } finally {
    client.close();
    proxy.close();
    await dev.close();
  }
});
