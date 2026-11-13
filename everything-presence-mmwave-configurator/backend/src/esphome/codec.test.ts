import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { decodeNoisePsk, NoiseHandshake } from './noise';
import { decodeMessage, decodeVarint, encodeFixed32Field, encodeMessage, encodeVarint } from './protobuf';
import { parseLogLine } from './logLine';

test('varint round trip', () => {
  for (const n of [0, 1, 127, 128, 300, 16384, 2 ** 31, 2 ** 40]) {
    assert.equal(decodeVarint(encodeVarint(n))!.value, n);
  }
  assert.equal(decodeVarint(Buffer.from([0x80])), null); // truncated
});

test('message encode/decode', () => {
  const buf = Buffer.concat([
    encodeMessage([[1, 'hello'], [2, 1], [3, 10], [4, false], [5, Buffer.from([1, 2])]]),
    encodeFixed32Field(6, 1700000000),
  ]);
  const f = decodeMessage(buf);
  assert.equal((f.get(1) as Buffer).toString(), 'hello');
  assert.equal(f.get(2), 1);
  assert.equal(f.get(3), 10);
  assert.equal(f.has(4), false); // default omitted
  assert.deepEqual(f.get(5), Buffer.from([1, 2]));
  assert.equal(f.get(6), 1700000000);
  assert.throws(() => decodeMessage(Buffer.from([0x0a, 0x05, 0x61])));
});

test('noise handshake: both sides derive matching transport keys', () => {
  const psk = crypto.randomBytes(32);
  const initiator = new NoiseHandshake('initiator', psk);
  const responder = new NoiseHandshake('responder', psk);
  responder.readMessage(initiator.writeMessage());
  initiator.readMessage(responder.writeMessage());
  const a = initiator.split();
  const b = responder.split();
  for (let i = 0; i < 3; i += 1) {
    assert.equal(b.receive.decrypt(a.send.encrypt(Buffer.from(`c${i}`))).toString(), `c${i}`);
    assert.equal(a.receive.decrypt(b.send.encrypt(Buffer.from(`s${i}`))).toString(), `s${i}`);
  }
});

test('noise handshake fails with a different key', () => {
  const initiator = new NoiseHandshake('initiator', crypto.randomBytes(32));
  const responder = new NoiseHandshake('responder', crypto.randomBytes(32));
  assert.throws(() => responder.readMessage(initiator.writeMessage()));
});

test('decodeNoisePsk accepts only 32-byte base64 keys', () => {
  assert.ok(decodeNoisePsk(crypto.randomBytes(32).toString('base64')));
  assert.equal(decodeNoisePsk(crypto.randomBytes(16).toString('base64')), null);
  assert.equal(decodeNoisePsk('not base64!'), null);
});

test('log line parsing', () => {
  assert.deepEqual(parseLogLine(5, '\x1b[0;36m[D][ld2450:123]: Target 1 moved\x1b[0m'), {
    level: 'DEBUG',
    tag: 'ld2450',
    msg: 'Target 1 moved',
  });
  assert.deepEqual(parseLogLine(4, '[C][wifi]:   SSID: [redacted]'), { level: 'CONFIG', tag: 'wifi', msg: '  SSID: [redacted]' });
  assert.deepEqual(parseLogLine(7, '[VV][api.service:42]: x'), { level: 'VERY_VERBOSE', tag: 'api.service', msg: 'x' });
  assert.deepEqual(parseLogLine(1, 'free text'), { level: 'ERROR', tag: null, msg: 'free text' });
});
