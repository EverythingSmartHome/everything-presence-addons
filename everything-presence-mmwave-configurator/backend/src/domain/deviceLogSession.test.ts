import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { DeviceApiConnection } from '../config/deviceApiStorage';
import { ApiErrorCode, DeviceIdentity, EsphomeApiError } from '../esphome/apiClient';
import type { HostLookupResult } from './deviceHostResolver';
import { DeviceLogSession, LogClientLike, SessionMessage } from './deviceLogSession';

/** Fake client whose connect outcome depends on the host. */
class FakeClient extends EventEmitter implements LogClientLike {
  subscribed: Array<[number, boolean]> = [];
  closed = false;
  constructor(readonly host: string, private readonly outcome: DeviceIdentity | ApiErrorCode) {
    super();
  }
  async connect(): Promise<DeviceIdentity> {
    if (typeof this.outcome === 'string') throw new EsphomeApiError(this.outcome, `${this.outcome} at ${this.host}`);
    return this.outcome;
  }
  subscribeLogs(level: number, dumpConfig: boolean) {
    this.subscribed.push([level, dumpConfig]);
  }
  statesSubscribed = false;
  async subscribeStates() {
    this.statesSubscribed = true;
  }
  close() {
    this.closed = true;
  }
}

const EPL: DeviceIdentity = { name: 'everything-presence-lite-abc123', esphomeVersion: '2025.11.0' };

const setup = (opts: {
  saved?: DeviceApiConnection;
  lookup?: HostLookupResult;
  hosts?: Record<string, DeviceIdentity | ApiErrorCode>;
  expected?: string;
}) => {
  let saved: DeviceApiConnection = { ...(opts.saved ?? {}) };
  const lookups: string[] = [];
  const connects: string[] = [];
  const clients: FakeClient[] = [];
  const messages: SessionMessage[] = [];
  const session = new DeviceLogSession(
    'dev1',
    {
      storage: {
        get: () => ({ ...saved }),
        saveResolvedHost: (_id, host) => {
          if (saved.hostSource !== 'manual') saved = { ...saved, host, hostSource: 'ha' };
        },
      },
      lookupHost: async (id) => {
        lookups.push(id);
        return opts.lookup ?? { ok: false, reason: 'no_esphome_entry' };
      },
      expectedNodeName: () => opts.expected,
      createClient: ({ host }) => {
        connects.push(host);
        const client = new FakeClient(host, opts.hosts?.[host] ?? 'unreachable');
        clients.push(client);
        return client;
      },
    },
    (m) => messages.push(m),
  );
  return { session, lookups, connects, clients, messages, saved: () => saved };
};

const last = (messages: SessionMessage[]) => messages[messages.length - 1];

test('saved host that works: Home Assistant is not asked', async () => {
  const t = setup({ saved: { host: '10.0.0.5', hostSource: 'ha' }, hosts: { '10.0.0.5': EPL } });
  await t.session.start();
  assert.equal(t.lookups.length, 0);
  assert.deepEqual(t.connects, ['10.0.0.5']);
  assert.equal(last(t.messages).type, 'status');
  assert.equal((last(t.messages) as { state: string }).state, 'connected');
  assert.deepEqual(t.clients[0].subscribed, [[5, true]]); // DEBUG + config dump
});

test('no saved host: asks Home Assistant once, saves the host, connects', async () => {
  const t = setup({ lookup: { ok: true, host: '10.0.0.5' }, hosts: { '10.0.0.5': EPL } });
  await t.session.start();
  assert.equal(t.lookups.length, 1);
  assert.deepEqual(t.saved(), { host: '10.0.0.5', hostSource: 'ha' });
  assert.equal((last(t.messages) as { state: string }).state, 'connected');

  // A second viewer later uses the saved host without asking again.
  const again = setup({ saved: t.saved(), hosts: { '10.0.0.5': EPL } });
  await again.session.start();
  assert.equal(again.lookups.length, 0);
});

test('no saved host and lookup fails: asks for a manual host', async () => {
  const t = setup({ lookup: { ok: false, reason: 'diagnostics_unavailable' } });
  await t.session.start();
  assert.equal(t.lookups.length, 1);
  assert.equal(t.connects.length, 0);
  assert.deepEqual({ ...last(t.messages), message: '' }, { type: 'error', code: 'no_host', needs: 'host', message: '' });
});

test('saved host unreachable, HA reports a new host: saves it and retries once', async () => {
  const t = setup({
    saved: { host: '10.0.0.5', hostSource: 'ha' },
    lookup: { ok: true, host: '10.0.0.9' },
    hosts: { '10.0.0.5': 'unreachable', '10.0.0.9': EPL },
  });
  await t.session.start();
  assert.equal(t.lookups.length, 1);
  assert.deepEqual(t.connects, ['10.0.0.5', '10.0.0.9']);
  assert.equal(t.saved().host, '10.0.0.9');
  assert.equal((last(t.messages) as { state: string }).state, 'connected');
});

test('saved host unreachable, HA reports the same host: one lookup, no retry', async () => {
  const t = setup({
    saved: { host: '10.0.0.5', hostSource: 'ha' },
    lookup: { ok: true, host: '10.0.0.5' },
    hosts: { '10.0.0.5': 'unreachable' },
  });
  await t.session.start();
  assert.equal(t.lookups.length, 1);
  assert.deepEqual(t.connects, ['10.0.0.5']);
  assert.equal(last(t.messages).type, 'error');
  assert.equal((last(t.messages) as { code: string }).code, 'unreachable');
});

test('new host also fails: still only one lookup', async () => {
  const t = setup({
    saved: { host: '10.0.0.5', hostSource: 'ha' },
    lookup: { ok: true, host: '10.0.0.9' },
    hosts: { '10.0.0.5': 'timeout', '10.0.0.9': 'unreachable' },
  });
  await t.session.start();
  assert.equal(t.lookups.length, 1);
  assert.deepEqual(t.connects, ['10.0.0.5', '10.0.0.9']);
  assert.equal((last(t.messages) as { code: string }).code, 'unreachable');
});

test('manual host is never re-resolved', async () => {
  const t = setup({ saved: { host: 'epl.local', hostSource: 'manual' }, lookup: { ok: true, host: '10.0.0.9' } });
  await t.session.start();
  assert.equal(t.lookups.length, 0);
  assert.deepEqual(t.connects, ['epl.local']);
  assert.equal((last(t.messages) as { code: string }).code, 'unreachable');
});

test('encryption errors do not trigger a lookup', async () => {
  const t = setup({ saved: { host: '10.0.0.5', hostSource: 'ha' }, hosts: { '10.0.0.5': 'encryption_required' } });
  await t.session.start();
  assert.equal(t.lookups.length, 0);
  assert.deepEqual({ ...last(t.messages), message: '' }, {
    type: 'error',
    code: 'encryption_required',
    needs: 'key',
    message: '',
  });
});

test('reused IP (different device name) re-resolves once', async () => {
  const t = setup({
    saved: { host: '10.0.0.5', hostSource: 'ha' },
    expected: 'everything_presence_lite_abc123', // underscores, as in HA service names
    lookup: { ok: true, host: '10.0.0.9' },
    hosts: { '10.0.0.5': { name: 'kitchen-plug' }, '10.0.0.9': EPL },
  });
  await t.session.start();
  assert.equal(t.lookups.length, 1);
  assert.equal(t.clients[0].closed, true);
  assert.equal((last(t.messages) as { state: string }).state, 'connected');
});

test('invalid saved key is reported without connecting', async () => {
  const t = setup({ saved: { host: '10.0.0.5', hostSource: 'ha', noisePsk: 'not-a-key' } });
  await t.session.start();
  assert.equal(t.connects.length, 0);
  assert.equal((last(t.messages) as { code: string }).code, 'invalid_key');
});

test('valid saved key is passed to the client', async () => {
  const key = crypto.randomBytes(32).toString('base64');
  let received: Buffer | null = null;
  const session = new DeviceLogSession(
    'dev1',
    {
      storage: { get: () => ({ host: 'h', hostSource: 'ha', noisePsk: key }), saveResolvedHost: () => undefined },
      lookupHost: async () => ({ ok: false, reason: 'no_esphome_entry' }),
      expectedNodeName: () => undefined,
      createClient: ({ host, noisePsk }) => {
        received = noisePsk;
        return new FakeClient(host, EPL);
      },
    },
    () => undefined,
  );
  await session.start();
  assert.equal(received!.toString('base64'), key);
});

test('logs are parsed and forwarded; device close is reported', async () => {
  const t = setup({ saved: { host: '10.0.0.5', hostSource: 'ha' }, hosts: { '10.0.0.5': EPL } });
  await t.session.start();
  t.clients[0].emit('log', { level: 2, message: '\x1b[0;33m[W][wifi:120]: Signal weak\x1b[0m' });
  const log = last(t.messages) as { type: string; level: string; tag: string; msg: string };
  assert.deepEqual({ type: log.type, level: log.level, tag: log.tag, msg: log.msg }, {
    type: 'log',
    level: 'WARN',
    tag: 'wifi',
    msg: 'Signal weak',
  });
  t.clients[0].emit('close', { reason: 'device_disconnected' });
  assert.equal((last(t.messages) as { state: string; reason: string }).reason, 'device_disconnected');
});

test('stop closes the device connection and suppresses further messages', async () => {
  const t = setup({ saved: { host: '10.0.0.5', hostSource: 'ha' }, hosts: { '10.0.0.5': EPL } });
  await t.session.start();
  const count = t.messages.length;
  t.session.stop();
  assert.equal(t.clients[0].closed, true);
  t.clients[0].emit('close', { reason: 'user' });
  assert.equal(t.messages.length, count);
});

test('setLevel re-subscribes without a config dump', async () => {
  const t = setup({ saved: { host: '10.0.0.5', hostSource: 'ha' }, hosts: { '10.0.0.5': EPL } });
  await t.session.start();
  t.session.setLevel('VERBOSE');
  assert.deepEqual(t.clients[0].subscribed, [[5, true], [6, false]]);
});

test('state lines: first state per entity skipped, later changes emitted as STATE', async () => {
  const t = setup({ saved: { host: '10.0.0.5', hostSource: 'ha' }, hosts: { '10.0.0.5': EPL } });
  await t.session.start();
  const client = t.clients[0];
  client.emit('state', { kind: 'sensor', id: 'sensor:0:1', text: "'Remaining' >> 1716 s" }); // replay
  client.emit('state', { kind: 'sensor', id: 'sensor:0:2', text: null }); // replay, missing state
  client.emit('state', { kind: 'sensor', id: 'sensor:0:1', text: "'Remaining' >> 1715 s" });
  client.emit('state', { kind: 'sensor', id: 'sensor:0:2', text: "'Other' >> 3" });
  const logs = t.messages.filter((m) => m.type === 'log').map((m) => m.type === 'log' && [m.level, m.tag, m.msg]);
  assert.deepEqual(logs, [
    ['STATE', 'sensor', "'Remaining' >> 1715 s"],
    ['STATE', 'sensor', "'Other' >> 3"],
  ]);
  assert.equal(client.statesSubscribed, true);
});

const logLevels = (messages: SessionMessage[]) =>
  messages.filter((m) => m.type === 'log').map((m) => (m.type === 'log' ? `${m.level}:${m.msg}` : ''));

test('state lines stop while the firmware sends VERBOSE logs, and resume when the level is lowered', async () => {
  const t = setup({ saved: { host: '10.0.0.5', hostSource: 'ha' }, hosts: { '10.0.0.5': EPL } });
  await t.session.start();
  const client = t.clients[0];
  client.emit('state', { kind: 'sensor', id: 'sensor:0:1', text: 'replay' });

  t.session.setLevel('VERBOSE');
  client.emit('log', { level: 6, message: "[V][sensor:125]: 'Remaining' >> 1715 s" });
  client.emit('state', { kind: 'sensor', id: 'sensor:0:1', text: 'duplicate' });

  t.session.setLevel('DEBUG');
  // A VERBOSE line still in flight from before the change must not switch states off again.
  client.emit('log', { level: 6, message: "[V][sensor:125]: 'Remaining' >> 1714 s" });
  client.emit('state', { kind: 'sensor', id: 'sensor:0:1', text: 'resumed' });

  assert.deepEqual(logLevels(t.messages), [
    "VERBOSE:'Remaining' >> 1715 s",
    "VERBOSE:'Remaining' >> 1714 s",
    'STATE:resumed',
  ]);
});

test('a VERBOSE line while subscribed at DEBUG does not switch states off', async () => {
  const t = setup({ saved: { host: '10.0.0.5', hostSource: 'ha' }, hosts: { '10.0.0.5': EPL } });
  await t.session.start();
  const client = t.clients[0];
  client.emit('state', { kind: 'sensor', id: 'sensor:0:1', text: 'replay' });
  client.emit('log', { level: 6, message: 'late verbose' });
  client.emit('state', { kind: 'sensor', id: 'sensor:0:1', text: 'shown' });
  assert.deepEqual(logLevels(t.messages), ['VERBOSE:late verbose', 'STATE:shown']);
});

test('hidden states are not sent; showing them again shows changes from then on', async () => {
  const t = setup({ saved: { host: '10.0.0.5', hostSource: 'ha' }, hosts: { '10.0.0.5': EPL } });
  await t.session.start();
  const client = t.clients[0];
  t.session.setShowStates(false);
  client.emit('state', { kind: 'sensor', id: 'sensor:0:1', text: 'replay' }); // still marks the entity as seen
  client.emit('state', { kind: 'sensor', id: 'sensor:0:1', text: 'hidden' });
  t.session.setShowStates(true);
  client.emit('state', { kind: 'sensor', id: 'sensor:0:1', text: 'visible' });
  assert.deepEqual(logLevels(t.messages), ['STATE:visible']);
});

// ───────────── stop during setup ─────────────

const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

/** Client whose connect() waits until the test releases it. */
class GatedClient extends FakeClient {
  readonly gate = deferred<void>();
  /** The real client rejects connect() once closed; false simulates a reply racing the close. */
  failIfClosed = true;
  closeCalls = 0;
  close() {
    this.closeCalls += 1;
    super.close();
  }
  async connect(): Promise<DeviceIdentity> {
    await this.gate.promise;
    if (this.failIfClosed && this.closed) throw new EsphomeApiError('closed', 'Connection closed');
    return EPL;
  }
}

test('stop during the HA lookup: no connection is made and nothing more is emitted', async () => {
  const lookup = deferred<HostLookupResult>();
  const messages: SessionMessage[] = [];
  let connects = 0;
  const session = new DeviceLogSession(
    'dev1',
    {
      storage: { get: () => ({}), saveResolvedHost: () => undefined },
      lookupHost: () => lookup.promise,
      expectedNodeName: () => undefined,
      createClient: ({ host }) => {
        connects += 1;
        return new FakeClient(host, EPL);
      },
    },
    (m) => messages.push(m),
  );
  const running = session.start();
  session.stop();
  lookup.resolve({ ok: true, host: '10.0.0.5' });
  await running;
  assert.equal(connects, 0);
  assert.deepEqual(messages, [{ type: 'status', state: 'resolving' }]);
});

for (const outcome of ['connect succeeds', 'connect fails'] as const) {
  test(`stop while connecting (${outcome}): client closed, no further messages`, async () => {
    const messages: SessionMessage[] = [];
    let client: GatedClient | null = null;
    const session = new DeviceLogSession(
      'dev1',
      {
        storage: { get: () => ({ host: '10.0.0.5', hostSource: 'ha' }), saveResolvedHost: () => undefined },
        lookupHost: async () => ({ ok: true, host: '10.0.0.9' }),
        expectedNodeName: () => undefined,
        createClient: ({ host }) => {
          client = new GatedClient(host, EPL);
          return client;
        },
      },
      (m) => messages.push(m),
    );
    const running = session.start();
    session.stop();
    const c = client as unknown as GatedClient;
    c.failIfClosed = outcome === 'connect fails';
    c.gate.resolve();
    await running;
    assert.equal(c.closed, true);
    assert.equal(c.closeCalls, outcome === 'connect fails' ? 1 : 2);
    assert.equal(c.subscribed.length, 0);
    assert.deepEqual(
      messages.map((m) => (m.type === 'status' ? m.state : m.type)),
      ['connecting'],
    );
  });
}

test('log and state events after stop are not emitted', async () => {
  const t = setup({ saved: { host: '10.0.0.5', hostSource: 'ha' }, hosts: { '10.0.0.5': EPL } });
  await t.session.start();
  const client = t.clients[0];
  client.emit('state', { kind: 'sensor', id: 'sensor:0:1', text: 'replay' });
  t.session.stop();
  const before = t.messages.length;
  client.emit('log', { level: 5, message: '[D][x]: late' });
  client.emit('state', { kind: 'sensor', id: 'sensor:0:1', text: 'late' });
  assert.equal(t.messages.length, before);
});
