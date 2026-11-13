import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { WebSocket, WebSocketServer } from 'ws';
import { attachWebSocketRoutes } from './wsUpgrade';

/** Resolve with the first message (listener attached before the socket opens). */
const firstMessage = (url: string) =>
  new Promise<string>((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('message', (d) => {
      resolve(d.toString());
      ws.close();
    });
    ws.once('error', reject);
  });

test('two WebSocket servers share one HTTP server, routed by path', async () => {
  const server = http.createServer();
  const a = new WebSocketServer({ noServer: true });
  const b = new WebSocketServer({ noServer: true });
  a.on('connection', (ws) => ws.send('a'));
  b.on('connection', (ws) => ws.send('b'));
  attachWebSocketRoutes(server, { '/api/live/ws': a, '/api/device-logs/ws': b });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  try {
    assert.equal(await firstMessage(`ws://127.0.0.1:${port}/api/live/ws`), 'a');
    assert.equal(await firstMessage(`ws://127.0.0.1:${port}/api/device-logs/ws?x=1`), 'b');
    await assert.rejects(firstMessage(`ws://127.0.0.1:${port}/nope`), /404/);
  } finally {
    for (const ws of [...a.clients, ...b.clients]) ws.terminate();
    a.close();
    b.close();
    server.closeAllConnections();
    server.close();
  }
});
