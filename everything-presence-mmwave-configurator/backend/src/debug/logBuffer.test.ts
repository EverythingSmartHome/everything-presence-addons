import assert from 'node:assert/strict';
import test from 'node:test';
import { LogBuffer } from './logBuffer';

test('ignores writes until recording starts and keeps entries after stop', () => {
  const buffer = new LogBuffer({ maxEntries: 10, maxBytes: 10_000 });
  buffer.write(JSON.stringify({ msg: 'before' }));
  buffer.start();
  buffer.write(JSON.stringify({ msg: 'during' }));
  buffer.push({ msg: 'pushed' });
  buffer.stop();
  buffer.write(JSON.stringify({ msg: 'after' }));
  assert.deepEqual(buffer.snapshot().entries.map((e) => e.msg), ['during', 'pushed']);
});

test('drops the oldest entries over the entry limit and counts them', () => {
  const buffer = new LogBuffer({ maxEntries: 3, maxBytes: 1_000_000 });
  buffer.start();
  for (let i = 0; i < 2000; i += 1) buffer.push({ i });
  const snapshot = buffer.snapshot();
  assert.deepEqual(snapshot.entries.map((e) => e.i), [1997, 1998, 1999]);
  assert.equal(snapshot.dropped, 1997);
});

test('drops the oldest entries over the byte limit', () => {
  const buffer = new LogBuffer({ maxEntries: 100, maxBytes: 100 });
  buffer.start();
  for (let i = 0; i < 10; i += 1) buffer.push({ msg: 'x'.repeat(20), i });
  const snapshot = buffer.snapshot();
  assert.ok(snapshot.bytes <= 100);
  assert.ok(snapshot.dropped > 0);
  assert.equal(snapshot.entries.at(-1)?.i, 9);
});

test('start clears previous contents; non-JSON lines are kept as messages', () => {
  const buffer = new LogBuffer({ maxEntries: 10, maxBytes: 10_000 });
  buffer.start();
  buffer.push({ msg: 'old' });
  buffer.start();
  buffer.write('plain text\n');
  assert.deepEqual(buffer.snapshot().entries, [{ msg: 'plain text' }]);
  assert.equal(buffer.dropped, 0);
});
