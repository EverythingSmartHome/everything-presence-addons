import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WebSocket } from 'ws';
import { DeviceApiStorage } from '../config/deviceApiStorage';
import { EsphomeApiClient, MessageType } from '../esphome/apiClient';
import { startFakeDevice } from '../esphome/fakeDevice.testutil';
import type { DeviceLogSessionDeps } from '../domain/deviceLogSession';
import type { HostLookupResult } from '../domain/deviceHostResolver';
import { createDeviceLogsWebSocketServer, DEVICE_LOGS_WS_PATH, parseClientMessage } from './deviceLogsWs';
import { attachWebSocketRoutes } from './wsUpgrade';

/**
 * End to end: browser WebSocket → /api/device-logs/ws → EsphomeApiClient →
 * fake encrypted device. Checks logs flow through, and that closing the
 * viewer disconnects from the device.
 */
test('viewer receives device logs; closing the viewer disconnects the device', async () => {
  const key = crypto.randomBytes(32);
  const device = await startFakeDevice({ psk: key });
  const storage = new DeviceApiStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'device-logs-ws-')));
  storage.saveResolvedHost('dev1', '127.0.0.1');
  storage.setNoisePsk('dev1', key.toString('base64'));
  let lookups = 0;

  const server = http.createServer();
  const wss = createDeviceLogsWebSocketServer({
    storage,
    lookupHost: async () => {
      lookups += 1;
      return { ok: false, reason: 'no_esphome_entry' };
    },
    expectedNodeName: () => 'everything_presence_lite_abc123',
    createClient: ({ host, noisePsk }) => new EsphomeApiClient({ host, port: device.port, noisePsk }),
  });
  attachWebSocketRoutes(server, { [DEVICE_LOGS_WS_PATH]: wss });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;

  try {
    const received: Array<Record<string, unknown>> = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}${DEVICE_LOGS_WS_PATH}`);
    const gotLog = new Promise<void>((resolve, reject) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        received.push(msg);
        if (msg.type === 'status' && msg.state === 'connected') {
          device.sendLog(5, '\x1b[0;36m[D][ld2450:88]: Target 1 x=120 y=900\x1b[0m');
        }
        if (msg.type === 'error') reject(new Error(msg.message));
        if (msg.type === 'log') resolve();
      });
    });
    ws.on('open', () => ws.send(JSON.stringify({ type: 'start', deviceId: 'dev1' })));
    await gotLog;

    const states = received.filter((m) => m.type === 'status').map((m) => m.state);
    assert.deepEqual(states, ['connecting', 'connected']);
    const connected = received.find((m) => m.state === 'connected') as { encrypted: boolean; device: { name: string } };
    assert.equal(connected.encrypted, true);
    assert.equal(connected.device.name, 'everything-presence-lite-abc123');
    const log = received.find((m) => m.type === 'log')!;
    assert.deepEqual({ level: log.level, tag: log.tag, msg: log.msg }, {
      level: 'DEBUG',
      tag: 'ld2450',
      msg: 'Target 1 x=120 y=900',
    });
    assert.equal(lookups, 0);

    ws.close();
    await device.waitFor(MessageType.DisconnectRequest);
  } finally {
    for (const client of wss.clients) client.terminate();
    wss.close();
    server.closeAllConnections();
    server.close();
    await device.close();
  }
});

test('parseClientMessage accepts only JSON objects', () => {
  for (const bad of ['null', '[]', '[1]', '5', '"start"', 'true', 'not json', '']) {
    assert.equal(parseClientMessage(bad), null, bad);
  }
  assert.deepEqual(parseClientMessage('{"type":"stop"}'), { type: 'stop' });
});

/** One HTTP server with the logs route; `lookupHost` is supplied by the test. */
const startLogsServer = async (lookupHost: DeviceLogSessionDeps['lookupHost']) => {
  const storage = new DeviceApiStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'device-logs-ws-')));
  const server = http.createServer();
  const wss = createDeviceLogsWebSocketServer({
    storage,
    lookupHost,
    expectedNodeName: () => undefined,
    createClient: ({ host, noisePsk }) => new EsphomeApiClient({ host, noisePsk, connectTimeoutMs: 200 }),
  });
  attachWebSocketRoutes(server, { [DEVICE_LOGS_WS_PATH]: wss });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  const open = async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${DEVICE_LOGS_WS_PATH}`);
    const received: Array<Record<string, unknown>> = [];
    ws.on('message', (d) => received.push(JSON.parse(d.toString())));
    await new Promise((r) => ws.once('open', r));
    return { ws, received };
  };
  const close = () => {
    for (const client of wss.clients) client.terminate();
    wss.close();
    server.closeAllConnections();
    server.close();
  };
  return { open, close };
};

const waitUntil = async (check: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 5));
  }
};

test('malformed messages are ignored and do not affect this or other connections', async () => {
  // A throw inside the 'message' listener is an uncaught exception that would
  // take down the whole add-on; record any so the test fails on them.
  const uncaught: Error[] = [];
  const onUncaught = (e: Error) => uncaught.push(e);
  process.on('uncaughtException', onUncaught);
  const srv = await startLogsServer(async () => ({ ok: false, reason: 'no_esphome_entry' }));
  try {
    const a = await srv.open();
    const b = await srv.open();
    for (const bad of ['null', '[]', '42', '"x"', 'true', '{bad json', '{"type":null}', '{"type":"start"}']) {
      a.ws.send(bad);
    }
    // Both connections still work afterwards.
    a.ws.send(JSON.stringify({ type: 'start', deviceId: 'devA' }));
    b.ws.send(JSON.stringify({ type: 'start', deviceId: 'devB' }));
    await waitUntil(() => a.received.some((m) => m.code === 'no_host') && b.received.some((m) => m.code === 'no_host'));
    // The only error before that was the missing deviceId on '{"type":"start"}'.
    assert.deepEqual(
      a.received.filter((m) => m.type === 'error').map((m) => m.code),
      ['protocol_error', 'no_host'],
    );
    assert.equal(a.ws.readyState, WebSocket.OPEN);
    assert.equal(b.ws.readyState, WebSocket.OPEN);
    assert.deepEqual(uncaught.map((e) => e.message), []);
  } finally {
    process.off('uncaughtException', onUncaught);
    srv.close();
  }
});

test('restarting during the HA lookup: the replaced session sends nothing more', async () => {
  const lookups: Array<(r: HostLookupResult) => void> = [];
  const srv = await startLogsServer(
    () => new Promise<HostLookupResult>((resolve) => lookups.push(resolve)),
  );
  try {
    const { ws, received } = await srv.open();
    ws.send(JSON.stringify({ type: 'start', deviceId: 'first' }));
    await waitUntil(() => lookups.length === 1);
    ws.send(JSON.stringify({ type: 'start', deviceId: 'second' }));
    await waitUntil(() => lookups.length === 2);

    lookups[0]({ ok: false, reason: 'device_not_found' }); // late reply for the replaced session
    lookups[1]({ ok: false, reason: 'no_esphome_entry' });
    await waitUntil(() => received.some((m) => m.type === 'error'));
    await new Promise((r) => setTimeout(r, 50));

    const errors = received.filter((m) => m.type === 'error');
    assert.equal(errors.length, 1);
    assert.match(String(errors[0].message), /no_esphome_entry/);
  } finally {
    srv.close();
  }
});
