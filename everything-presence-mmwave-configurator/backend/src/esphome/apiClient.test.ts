import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import net from 'node:net';
import test from 'node:test';
import { DeviceLogMessage, EsphomeApiClient, EsphomeApiError, MAX_FRAME_PAYLOAD, MessageType } from './apiClient';
import { startFakeDevice } from './fakeDevice.testutil';
import { decodeVarint, encodeMessage, encodeVarint } from './protobuf';

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

// ───────────── raw plaintext device: frame limits and liveness ─────────────

const plainFrame = (type: number, payload: Buffer) =>
  Buffer.concat([Buffer.from([0x00]), encodeVarint(payload.length), encodeVarint(type), payload]);
const logFrame = (text: string) => plainFrame(MessageType.SubscribeLogsResponse, encodeMessage([[1, 5], [3, text]]));

/**
 * A plaintext device that answers Hello and DeviceInfo, then hands the socket
 * to `afterSetup` so a test can send arbitrary bytes.
 */
const startRawDevice = async (afterSetup: (sock: net.Socket) => void) => {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((sock) => {
    sockets.add(sock);
    sock.on('error', () => undefined);
    let buf = Buffer.alloc(0);
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const len = decodeVarint(buf, 1);
        if (!len) return;
        const type = decodeVarint(buf, 1 + len.length);
        if (!type) return;
        const start = 1 + len.length + type.length;
        if (buf.length < start + len.value) return;
        buf = buf.subarray(start + len.value);
        if (type.value === MessageType.HelloRequest) {
          sock.write(plainFrame(MessageType.HelloResponse, encodeMessage([[1, 1], [2, 10]])));
        } else if (type.value === MessageType.DeviceInfoRequest) {
          sock.write(plainFrame(MessageType.DeviceInfoResponse, encodeMessage([[2, 'raw-device']])));
        } else if (type.value === MessageType.SubscribeLogsRequest) {
          afterSetup(sock);
        }
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: (server.address() as net.AddressInfo).port,
    close: () => {
      for (const s of sockets) s.destroy();
      return new Promise<void>((r) => server.close(() => r()));
    },
  };
};

const nextClose = (client: EsphomeApiClient) =>
  new Promise<{ reason: string; error?: EsphomeApiError }>((resolve) => client.once('close', resolve));

test('oversized plaintext length is rejected at once, before the payload arrives', async () => {
  const dev = await startRawDevice((sock) => {
    // Header only: claims a 100 MB payload that never comes.
    sock.write(Buffer.concat([Buffer.from([0x00]), encodeVarint(100 * 1024 * 1024), encodeVarint(29)]));
  });
  const client = new EsphomeApiClient({ host: '127.0.0.1', port: dev.port });
  try {
    await client.connect();
    const closed = nextClose(client);
    client.subscribeLogs(5, false);
    const { reason, error } = await closed;
    assert.equal(reason, 'error');
    assert.equal(error?.code, 'protocol_error');
  } finally {
    client.close();
    await dev.close();
  }
});

test('length varint beyond the safe range is rejected', async () => {
  const dev = await startRawDevice((sock) => {
    sock.write(Buffer.from([0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01, 29]));
  });
  const client = new EsphomeApiClient({ host: '127.0.0.1', port: dev.port });
  try {
    await client.connect();
    const closed = nextClose(client);
    client.subscribeLogs(5, false);
    assert.equal((await closed).error?.code, 'protocol_error');
  } finally {
    client.close();
    await dev.close();
  }
});

test('a frame at the size limit is accepted', async () => {
  const text = 'x'.repeat(MAX_FRAME_PAYLOAD - 8);
  const dev = await startRawDevice((sock) => sock.write(logFrame(text)));
  const client = new EsphomeApiClient({ host: '127.0.0.1', port: dev.port });
  try {
    await client.connect();
    const log = nextLog(client);
    client.subscribeLogs(5, false);
    assert.equal((await log).message.length, text.length);
  } finally {
    client.close();
    await dev.close();
  }
});

test('plaintext: several frames in one chunk, and one frame split across chunks', async () => {
  const dev = await startRawDevice((sock) => {
    sock.write(Buffer.concat([logFrame('one'), logFrame('two'), logFrame('three')]));
    const split = logFrame('four');
    sock.write(split.subarray(0, 2));
    setTimeout(() => sock.write(split.subarray(2, 5)), 10);
    setTimeout(() => sock.write(split.subarray(5)), 20);
  });
  const client = new EsphomeApiClient({ host: '127.0.0.1', port: dev.port });
  try {
    await client.connect();
    const lines: string[] = [];
    const got = new Promise<void>((resolve) =>
      client.on('log', (l) => {
        lines.push(l.message);
        if (lines.length === 4) resolve();
      }),
    );
    client.subscribeLogs(5, false);
    await got;
    assert.deepEqual(lines, ['one', 'two', 'three', 'four']);
  } finally {
    client.close();
    await dev.close();
  }
});

test('a trickle of incomplete data does not hold off the idle timeout', async () => {
  let timer: NodeJS.Timeout | null = null;
  const dev = await startRawDevice((sock) => {
    // Header for a 1000-byte frame, then one byte every 10 ms: never completes within the test.
    sock.write(Buffer.concat([Buffer.from([0x00]), encodeVarint(1000), encodeVarint(29)]));
    timer = setInterval(() => sock.write(Buffer.from([0x41])), 10);
  });
  const client = new EsphomeApiClient({ host: '127.0.0.1', port: dev.port, pingIntervalMs: 50 });
  try {
    await client.connect();
    const closed = nextClose(client);
    client.subscribeLogs(5, false);
    const started = Date.now();
    assert.equal((await closed).reason, 'timeout');
    assert.ok(Date.now() - started < 1000);
  } finally {
    if (timer) clearInterval(timer);
    client.close();
    await dev.close();
  }
});

test('no events after close(), even if the device keeps sending', async () => {
  let deviceSock: net.Socket | null = null;
  const dev = await startRawDevice((sock) => {
    deviceSock = sock;
  });
  const client = new EsphomeApiClient({ host: '127.0.0.1', port: dev.port });
  try {
    await client.connect();
    client.subscribeLogs(5, false);
    while (!deviceSock) await new Promise((r) => setTimeout(r, 5));
    const logs: string[] = [];
    client.on('log', (l) => logs.push(l.message));
    client.close();
    (deviceSock as net.Socket).write(logFrame('late'));
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(logs, []);
  } finally {
    await dev.close();
  }
});
