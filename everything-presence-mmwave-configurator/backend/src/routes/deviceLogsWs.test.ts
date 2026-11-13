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
import { createDeviceLogsWebSocketServer, DEVICE_LOGS_WS_PATH } from './deviceLogsWs';
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
