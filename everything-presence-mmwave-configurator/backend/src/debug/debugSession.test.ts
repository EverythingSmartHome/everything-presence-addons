import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DebugSessionService, DEBUG_SESSION_MAX_DURATION_MS, sanitizeClientEntry } from './debugSession';
import { LogBuffer } from './logBuffer';

const setup = (startMs = Date.parse('2026-01-01T12:00:00Z')) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'debug-session-'));
  let now = startMs;
  const levels: boolean[] = [];
  const serverBuffer = new LogBuffer({ maxEntries: 100, maxBytes: 100_000 });
  const make = () =>
    new DebugSessionService({
      dataDir,
      serverBuffer,
      setDebugLevel: (active) => levels.push(active),
      getLogLevel: () => (levels.at(-1) ? 'debug' : 'info'),
      log: (msg) => serverBuffer.push({ msg }),
      now: () => now,
    });
  return {
    dataDir,
    levels,
    serverBuffer,
    make,
    advance: (ms: number) => {
      now += ms;
    },
    readFile: () => JSON.parse(fs.readFileSync(path.join(dataDir, 'debug-session.json'), 'utf-8')),
  };
};

test('start raises the level, persists metadata and records markers; stop restores', () => {
  const env = setup();
  const session = env.make();
  const started = session.start();
  assert.equal(started.active, true);
  assert.equal(started.remainingMs, DEBUG_SESSION_MAX_DURATION_MS);
  assert.deepEqual(env.levels, [true]);
  assert.equal(env.readFile().active, true);

  const stopped = session.stop('user');
  session.dispose();
  assert.equal(stopped.active, false);
  assert.equal(stopped.stopReason, 'user');
  assert.deepEqual(env.levels, [true, false]);
  assert.equal(env.readFile().active, false);
  const msgs = session.serverLogs().entries.map((e) => e.msg);
  assert.deepEqual(msgs, ['Debug session started', 'Debug session stopped (user)']);
});

test('client logs are accepted only while active and for the current session', () => {
  const env = setup();
  const session = env.make();
  assert.deepEqual(session.addClientLogs(undefined, [{ msg: 'x' }]), { accepted: 0, active: false });
  const { sessionId } = session.start();
  assert.equal(session.addClientLogs('other', [{ msg: 'x' }]).accepted, 0);
  assert.equal(session.addClientLogs(sessionId, [{ msg: 'a' }, 'bad', { msg: 'b', level: 'error' }], 3).accepted, 2);
  const entries = session.clientLogs().entries;
  assert.ok(entries.some((e) => e.msg === 'b' && e.level === 'error'));
  assert.ok(entries.some((e) => String(e.msg).includes('dropped 3')));
  assert.equal(session.status().client.dropped, 3);
  session.dispose();
});

test('a session under 30 minutes resumes after restart with a marker', () => {
  const env = setup();
  const first = env.make();
  const { sessionId } = first.start();
  first.dispose();
  env.advance(10 * 60 * 1000);

  env.serverBuffer.clear();
  const second = env.make();
  second.init();
  const status = second.status();
  assert.equal(status.active, true);
  assert.equal(status.sessionId, sessionId);
  assert.equal(status.restarts, 1);
  assert.equal(status.remainingMs, 20 * 60 * 1000);
  assert.ok(second.serverLogs().entries.some((e) => String(e.msg).includes('resumed after add-on restart')));
  second.dispose();
});

test('an expired active session is marked stopped with reason restart', () => {
  const env = setup();
  const first = env.make();
  first.start();
  first.dispose();
  env.advance(DEBUG_SESSION_MAX_DURATION_MS + 1);

  const second = env.make();
  second.init();
  assert.equal(second.status().active, false);
  assert.equal(second.status().stopReason, 'restart');
  assert.equal(env.readFile().stopReason, 'restart');
  second.dispose();
});

test('auto-stops after the maximum duration', async () => {
  const env = setup();
  const session = new DebugSessionService({
    dataDir: env.dataDir,
    serverBuffer: env.serverBuffer,
    setDebugLevel: () => undefined,
    getLogLevel: () => 'info',
    maxDurationMs: 20,
  });
  session.start();
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(session.status().active, false);
  assert.equal(session.status().stopReason, 'timeout');
});

test('sanitizeClientEntry bounds strings and drops unknown fields', () => {
  const entry = sanitizeClientEntry({ msg: 'x'.repeat(10_000), level: 'warn', kind: 'fetch', status: 500, evil: { a: 1 } })!;
  assert.ok(String(entry.msg).length < 4200);
  assert.equal(entry.status, 500);
  assert.equal((entry as any).evil, undefined);
  assert.equal(sanitizeClientEntry(null), null);
});
