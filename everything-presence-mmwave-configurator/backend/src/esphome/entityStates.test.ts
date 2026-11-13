import assert from 'node:assert/strict';
import test from 'node:test';
import { EsphomeApiClient, MessageType } from './apiClient';
import { EntityInfo, EntityStateLine, entityId, formatEntityState, parseEntityInfo } from './entityStates';
import { startFakeDevice } from './fakeDevice.testutil';
import { encodeFixed32Field, encodeMessage, encodeVarint } from './protobuf';

const floatField = (field: number, value: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeFloatLE(value, 0);
  return encodeFixed32Field(field, b.readUInt32LE(0));
};

/** ListEntitiesSensorResponse: object_id=1, key=2 (fixed32), name=3, unit=6, accuracy_decimals=7. */
const sensorInfo = (key: number, name: string, unit: string, decimals: number) =>
  Buffer.concat([encodeMessage([[1, 'x']]), encodeFixed32Field(2, key), encodeMessage([[3, name], [6, unit], [7, decimals]])]);
const sensorState = (key: number, value: number, missing = false) =>
  Buffer.concat([encodeFixed32Field(1, key), floatField(2, value), encodeMessage([[3, missing]])]);
const simpleInfo = (key: number, name: string) =>
  Buffer.concat([encodeMessage([[1, 'x']]), encodeFixed32Field(2, key), encodeMessage([[3, name]])]);
const state = (key: number, fields: Array<[number, string | number | boolean]>) =>
  Buffer.concat([encodeFixed32Field(1, key), encodeMessage(fields)]);

const registry = (...infos: Array<EntityInfo | null>) => {
  const map = new Map<string, EntityInfo>();
  for (const i of infos) if (i) map.set(entityId(i.kind, i.deviceId, i.key), i);
  return (id: string) => map.get(id);
};

test('formats each entity kind like `esphome logs`', () => {
  const lookup = registry(
    parseEntityInfo(16, sensorInfo(1, 'Assumed Present Remaining', 's', 0)),
    parseEntityInfo(16, sensorInfo(2, 'Illuminance', 'lx', 1)),
    parseEntityInfo(12, simpleInfo(3, 'Occupancy')),
    parseEntityInfo(18, simpleInfo(4, 'Zone 1 Target')),
    parseEntityInfo(17, simpleInfo(5, 'Bluetooth')),
    parseEntityInfo(49, simpleInfo(6, 'Max Distance')),
    parseEntityInfo(52, simpleInfo(7, 'Mode')),
  );
  const text = (type: number, payload: Buffer) => formatEntityState(type, payload, lookup)?.text;

  assert.equal(text(25, sensorState(1, 1715)), "'Assumed Present Remaining' >> 1715 s");
  assert.equal(text(25, sensorState(2, 20.4)), "'Illuminance' >> 20.4 lx");
  assert.equal(text(21, state(3, [[2, true]])), "'Occupancy' >> ON");
  assert.equal(text(21, state(3, [[2, false]])), "'Occupancy' >> OFF");
  assert.equal(text(27, state(4, [[2, 'Present']])), "'Zone 1 Target' >> 'Present'");
  assert.equal(text(26, state(5, [[2, true]])), "'Bluetooth' >> ON");
  assert.equal(text(50, Buffer.concat([encodeFixed32Field(1, 6), floatField(2, 6)])), "'Max Distance' >> 6.00");
  assert.equal(text(53, state(7, [[2, 'Normal']])), "'Mode' >> Normal");
});

test('missing state gives no text; unknown entity is named "?"; other messages are ignored', () => {
  const lookup = registry(parseEntityInfo(16, sensorInfo(1, 'Temp', '°C', 1)));
  assert.deepEqual(formatEntityState(25, sensorState(1, 0, true), lookup), { kind: 'sensor', id: 'sensor:0:1', text: null });
  assert.equal(formatEntityState(25, sensorState(99, 1.5), lookup)?.text, "'?' >> 1.5");
  assert.equal(formatEntityState(29, Buffer.alloc(0), lookup), null);
  assert.equal(parseEntityInfo(15, simpleInfo(1, 'Light')), null);
});

test('negative accuracy_decimals (int32 varint) is treated as 0', () => {
  const negative = Buffer.concat([
    encodeMessage([[1, 'x']]),
    encodeFixed32Field(2, 1),
    encodeMessage([[3, 'Signal'], [6, 'dBm']]),
    encodeVarint(7 * 8),
    Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]), // -1
  ]);
  const info = parseEntityInfo(16, negative);
  assert.equal(info?.accuracyDecimals, 0);
  assert.equal(formatEntityState(25, sensorState(1, -61.4), registry(info))?.text, "'Signal' >> -61 dBm");
});

test('client lists entities, subscribes to states and emits named state lines', async () => {
  const device = await startFakeDevice({
    entities: [{ type: 16, payload: sensorInfo(1, 'Assumed Present Remaining', 's', 0) }],
    initialStates: [{ type: 25, payload: sensorState(1, 1716) }],
  });
  const client = new EsphomeApiClient({ host: '127.0.0.1', port: device.port });
  try {
    await client.connect();
    const states: EntityStateLine[] = [];
    client.on('state', (s) => states.push(s));
    client.subscribeLogs(5, false);
    await client.subscribeStates();
    await device.waitFor(MessageType.SubscribeStatesRequest); // replay is sent before this resolves
    await new Promise<void>((resolve) => {
      client.on('state', () => states.length === 2 && resolve());
      device.sendMessage(25, sensorState(1, 1715));
    });
    assert.deepEqual(
      states.map((s) => s.text),
      ["'Assumed Present Remaining' >> 1716 s", "'Assumed Present Remaining' >> 1715 s"],
    );
  } finally {
    client.close();
    await device.close();
  }
});
