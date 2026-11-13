import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// Storage modules read DATA_DIR at import time, so load the server lazily.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'debug-routes-'));
process.env.FRONTEND_DIST = path.join(process.env.DATA_DIR, 'no-frontend');

/* eslint-disable @typescript-eslint/no-var-requires */
const { createServer } = require('../server') as typeof import('../server');
const { debugSession } = require('../debug/debugSession') as typeof import('../debug/debugSession');
const { serverLogBuffer } = require('../logger') as typeof import('../logger');

const config = {
  port: 0,
  ha: { mode: 'standalone' as const, baseUrl: 'http://127.0.0.1:1/api', token: 'route-test-token-value' },
  frontendDist: process.env.FRONTEND_DIST,
  firmware: { lanPort: 0, cacheDir: process.env.DATA_DIR, maxVersionsPerDevice: 1 },
};

const withServer = async (fn: (base: string) => Promise<void>) => {
  const server = http.createServer(createServer(config));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    debugSession.stop('user');
    debugSession.dispose();
    await new Promise((resolve) => server.close(resolve));
  }
};

const bigEntries = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ ts: new Date().toISOString(), level: 'info', kind: 'console', msg: `entry ${i} ${'x'.repeat(1000)}` }));

test('client-logs accepts bodies above the global 100 KB limit; other routes do not', async () => {
  await withServer(async (base) => {
    const { sessionId } = (await (await fetch(`${base}/api/debug/start`, { method: 'POST' })).json()) as { sessionId: string };
    const payload = JSON.stringify({ sessionId, entries: bigEntries(300), dropped: 0 });
    assert.ok(payload.length > 200 * 1024);

    const accepted = await fetch(`${base}/api/debug/client-logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });
    assert.equal(accepted.status, 200);
    assert.equal(((await accepted.json()) as { accepted: number }).accepted, 300);

    const rejected = await fetch(`${base}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });
    assert.ok(rejected.status >= 400, `expected rejection, got ${rejected.status}`);
  });
});

test('status and client-logs requests are excluded from request auto-logging', async () => {
  await withServer(async (base) => {
    await fetch(`${base}/api/debug/start`, { method: 'POST' });
    await fetch(`${base}/api/debug/status`);
    await fetch(`${base}/api/debug/client-logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: [] }),
    });
    await fetch(`${base}/api/health`);

    const urls = serverLogBuffer
      .snapshot()
      .entries.filter((e) => e.msg === 'request completed')
      .map((e) => (e.req as { url: string }).url);
    assert.ok(urls.includes('/api/health'));
    assert.ok(!urls.some((u) => u.startsWith('/api/debug/status') || u.startsWith('/api/debug/client-logs')));
  });
});

test('bundle downloads as a redacted JSON attachment without the HA token', async () => {
  await withServer(async (base) => {
    await fetch(`${base}/api/debug/start`, { method: 'POST' });
    const res = await fetch(`${base}/api/debug/bundle`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition') ?? '', /attachment; filename="zone-configurator-debug-.*\.json"/);
    const text = await res.text();
    assert.equal(text.includes(config.ha.token), false);
    const bundle = JSON.parse(text);
    assert.equal(bundle.session.active, true);
    assert.ok(Array.isArray(bundle.errors));
  });
});
