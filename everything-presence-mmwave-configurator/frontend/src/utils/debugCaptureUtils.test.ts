// @ts-nocheck -- Node's built-in runner supplies these modules; frontend production types stay dependency-free.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BoundedQueue,
  drainPending,
  filenameFromDisposition,
  isDroppedKey,
  isSecretKey,
  sanitizeBodyText,
  formatConsoleArgs,
  formatRemaining,
  formatValue,
  isDebugEndpoint,
  MAX_MESSAGE_CHARS,
  stripQuery,
  truncate,
} from './debugCaptureUtils.ts';

test('recognises debug API requests, including under an ingress prefix', () => {
  assert.equal(isDebugEndpoint('/api/debug/status'), true);
  assert.equal(isDebugEndpoint('/api/hassio_ingress/abc/api/debug/client-logs'), true);
  assert.equal(isDebugEndpoint('api/debug/bundle?includeNetworkDetails=1'), true);
  assert.equal(isDebugEndpoint('/api/devices'), false);
  assert.equal(isDebugEndpoint('/api/debugger'), false);
});

test('strips query strings and fragments', () => {
  assert.equal(stripQuery('/api/live/dev/state?profileId=x&entityMappings=%7B%7D'), '/api/live/dev/state');
  assert.equal(stripQuery('http://host/a#frag'), 'http://host/a');
  assert.equal(stripQuery('/plain'), '/plain');
});

test('truncate bounds long strings', () => {
  assert.equal(truncate('abc', 5), 'abc');
  assert.match(truncate('x'.repeat(3000), 2048), /^x{2048}…\[truncated 952 chars\]$/);
});

test('formats console arguments including errors and circular objects', () => {
  const circular: any = { a: 1 };
  circular.self = circular;
  assert.equal(formatValue(circular), '{"a":1,"self":"[Circular]"}');
  const err = new Error('boom');
  const formatted = formatConsoleArgs(['Failed:', err, 42]);
  assert.equal(formatted.msg, 'Failed: Error: boom 42');
  assert.match(formatted.stack, /boom/);
  assert.ok(formatConsoleArgs(['y'.repeat(MAX_MESSAGE_CHARS * 2)]).msg.length < MAX_MESSAGE_CHARS + 50);
});

const LEAKS = ['pw-1', 'tok-2', 'key-3', 'MyWifi', 'aa-bssid'];

test('console objects have secret keys replaced and SSIDs dropped before stringifying', () => {
  const { msg } = formatConsoleArgs([
    'Saving',
    { password: 'pw-1', nested: { token: 'tok-2', api_key: 'key-3' }, ssid: 'MyWifi', bssid: 'aa-bssid', authRequired: true, room: 'Lounge' },
  ]);
  for (const leak of LEAKS) assert.equal(msg.includes(leak), false, `${leak} leaked: ${msg}`);
  assert.match(msg, /"password":"\[REDACTED\]"/);
  assert.match(msg, /"authRequired":true/);
  assert.match(msg, /"room":"Lounge"/);
  assert.equal(isSecretKey('accessToken'), true);
  assert.equal(isDroppedKey('wifi_ssid'), true);
});

test('JSON response bodies are cleaned; other text is kept and bounded', () => {
  const body = sanitizeBodyText('{"error":{"password":"pw-1","token":"tok-2"},"api_key":"key-3","ssid":"MyWifi","bssid":"aa-bssid"}', 2048);
  for (const leak of LEAKS) assert.equal(body.includes(leak), false, `${leak} leaked: ${body}`);
  assert.equal(sanitizeBodyText('Internal Server Error', 2048), 'Internal Server Error');
  assert.ok(sanitizeBodyText('x'.repeat(5000), 2048).length < 2100);
});

test('drainPending waits for an in-flight upload, then uploads what remains', async () => {
  const queue = [1, 2, 3, 4, 5];
  const uploaded: number[][] = [];
  let inFlight: Promise<void> | null = null;
  const flushOnce = (): Promise<void> => {
    if (inFlight) return inFlight;
    if (queue.length === 0) return Promise.resolve();
    const batch = queue.splice(0, 2);
    inFlight = new Promise<void>((resolve) => setTimeout(resolve, 5)).then(() => {
      uploaded.push(batch);
      inFlight = null;
    });
    return inFlight;
  };
  void flushOnce(); // an upload already running when Stop is pressed
  queue.push(6);
  await drainPending(flushOnce, () => queue.length);
  assert.equal(queue.length, 0);
  assert.deepEqual(uploaded.flat(), [1, 2, 3, 4, 5, 6]);
});

test('drainPending awaits an in-flight upload even when nothing else is queued', async () => {
  let done = false;
  const pendingUpload = new Promise<void>((resolve) => setTimeout(resolve, 5)).then(() => {
    done = true;
  });
  await drainPending(() => (done ? Promise.resolve() : pendingUpload), () => 0);
  assert.equal(done, true);
});

test('drainPending stops when uploads make no progress', async () => {
  let calls = 0;
  await drainPending(async () => {
    calls += 1;
  }, () => 3);
  assert.equal(calls, 2);
});

test('bounded queue drops and counts the oldest entries', () => {
  const queue = new BoundedQueue<number>(3);
  for (let i = 0; i < 5; i += 1) queue.push(i);
  assert.equal(queue.dropped, 2);
  assert.deepEqual(queue.take(2), [2, 3]);
  assert.deepEqual(queue.take(), [4]);
  queue.markDropped(4);
  assert.equal(queue.dropped, 6);
  queue.reset();
  assert.equal(queue.dropped, 0);
  assert.equal(queue.size, 0);
});

test('formats remaining time and parses download filenames', () => {
  assert.equal(formatRemaining(30 * 60 * 1000), '30:00');
  assert.equal(formatRemaining(61_500), '1:02');
  assert.equal(formatRemaining(-5), '0:00');
  assert.equal(filenameFromDisposition('attachment; filename="debug.json"', 'x.json'), 'debug.json');
  assert.equal(filenameFromDisposition(null, 'x.json'), 'x.json');
});
