import assert from 'node:assert/strict';
import test from 'node:test';
import pino from 'pino';
import { buildLogger, debugLevelFor, logger, LogLevelController, logSerializers, serverLogBuffer } from './logger';

const memoryStream = () => {
  const lines: Array<Record<string, any>> = [];
  return { lines, write: (line: string) => lines.push(JSON.parse(line)) };
};

test('without the serializer an Error under `error` loses its message (pino default)', () => {
  const out = memoryStream();
  pino({ level: 'info' }, out).error({ error: new Error('x') }, 'failed');
  assert.equal(out.lines[0].error?.message, undefined);
});

test('`error` and `err` keys serialize message and stack', () => {
  const out = memoryStream();
  const log = pino({ level: 'info', serializers: logSerializers }, out);
  log.error({ error: new Error('boom') }, 'failed');
  log.error({ err: new Error('bang') }, 'failed');
  assert.equal(out.lines[0].error.message, 'boom');
  assert.match(out.lines[0].error.stack, /Error: boom/);
  assert.equal(out.lines[1].err.message, 'bang');
});

test('the application logger serializes `{ error }` into the debug buffer', () => {
  serverLogBuffer.start();
  try {
    logger.warn({ error: new Error('app-boom') }, 'app failure');
    const entry = serverLogBuffer.snapshot().entries.find((e) => e.msg === 'app failure') as any;
    assert.ok(entry);
    assert.equal(entry.error.message, 'app-boom');
    assert.match(entry.error.stack, /app-boom/);
  } finally {
    serverLogBuffer.stop();
    serverLogBuffer.clear();
  }
});

test('raising the level sends debug to the buffer while stdout stays at the base level', () => {
  const stdout = memoryStream();
  const buffer = memoryStream();
  const log = buildLogger({ baseLevel: 'info', stdout, buffer });
  const child = log.child({ component: 'http' });
  const controller = new LogLevelController(log, 'info');
  controller.register(child);

  log.debug('hidden');
  controller.setDebug(true);
  log.debug('root-debug');
  child.debug('child-debug');
  log.info('info-line');
  controller.setDebug(false);
  log.debug('hidden-again');
  child.debug('hidden-child');

  assert.deepEqual(buffer.lines.map((l) => l.msg), ['root-debug', 'child-debug', 'info-line']);
  assert.deepEqual(stdout.lines.map((l) => l.msg), ['info-line']);
  assert.equal(log.level, 'info');
  assert.equal(child.level, 'info');
});

test('debugLevelFor keeps a more verbose base level', () => {
  assert.equal(debugLevelFor('info'), 'debug');
  assert.equal(debugLevelFor('warn'), 'debug');
  assert.equal(debugLevelFor('trace'), 'trace');
  assert.equal(debugLevelFor('debug'), 'debug');
});
