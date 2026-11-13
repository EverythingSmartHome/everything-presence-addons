import { decodeMessage, fieldNumber, fieldString } from './protobuf';

/**
 * Entity state changes rendered as log lines, the way `esphome logs` (via
 * aioesphomeapi's state_log_formatter) shows them: `[S][sensor]: 'Name' >> 12.3 lx`.
 *
 * Recent ESPHome firmware logs state publishes at VERBOSE only, so a DEBUG
 * log subscription no longer shows them; the dashboard fills the gap from the
 * state subscription. Field numbers are from ESPHome's api.proto.
 */

export type EntityKind = 'sensor' | 'binary_sensor' | 'text_sensor' | 'switch' | 'number' | 'select';

/** ListEntities*Response message type → entity kind (others are ignored). */
export const ENTITY_INFO_TYPES: Record<number, EntityKind> = {
  12: 'binary_sensor',
  16: 'sensor',
  17: 'switch',
  18: 'text_sensor',
  49: 'number',
  52: 'select',
};

/** *StateResponse message type → entity kind. */
export const ENTITY_STATE_TYPES: Record<number, EntityKind> = {
  21: 'binary_sensor',
  25: 'sensor',
  26: 'switch',
  27: 'text_sensor',
  50: 'number',
  53: 'select',
};

/** device_id field number in each ListEntities*Response. */
const INFO_DEVICE_ID_FIELD: Record<EntityKind, number> = {
  binary_sensor: 10,
  sensor: 14,
  switch: 10,
  text_sensor: 9,
  number: 14,
  select: 9,
};

/** device_id field number in each *StateResponse. */
const STATE_DEVICE_ID_FIELD: Record<EntityKind, number> = {
  binary_sensor: 4,
  sensor: 4,
  switch: 3,
  text_sensor: 4,
  number: 4,
  select: 4,
};

/** Kinds whose state message has a `missing_state` flag (field 3). */
const HAS_MISSING_STATE: ReadonlySet<EntityKind> = new Set(['binary_sensor', 'sensor', 'text_sensor', 'number', 'select']);

export interface EntityInfo {
  kind: EntityKind;
  key: number;
  deviceId: number;
  name: string;
  unit?: string;
  accuracyDecimals?: number;
}

export interface EntityStateLine {
  kind: EntityKind;
  /** Identifies the entity across messages: kind, sub-device and key. */
  id: string;
  /** Log text without the `[S][tag]: ` prefix, or null when there is nothing to show. */
  text: string | null;
}

export const entityId = (kind: EntityKind, deviceId: number, key: number): string => `${kind}:${deviceId}:${key}`;

const float32 = (bits: number | undefined): number => {
  if (bits === undefined) return 0;
  const b = Buffer.alloc(4);
  b.writeUInt32LE(bits >>> 0, 0);
  return b.readFloatLE(0);
};

/** Python-style fixed-point formatting (`nan`/`inf` for non-finite values). */
const fixed = (value: number, decimals: number): string => {
  if (Number.isNaN(value)) return 'nan';
  if (!Number.isFinite(value)) return value > 0 ? 'inf' : '-inf';
  return value.toFixed(decimals);
};

/** int32 sent as a varint: negatives arrive as large unsigned values. */
const int32 = (value: number | undefined): number | undefined => {
  if (value === undefined) return undefined;
  return value > 0x7fffffff ? value - 2 ** 64 : value;
};

export const parseEntityInfo = (messageType: number, payload: Buffer): EntityInfo | null => {
  const kind = ENTITY_INFO_TYPES[messageType];
  if (!kind) return null;
  const f = decodeMessage(payload);
  const key = fieldNumber(f, 2);
  if (key === undefined) return null;
  const info: EntityInfo = {
    kind,
    key,
    deviceId: fieldNumber(f, INFO_DEVICE_ID_FIELD[kind]) ?? 0,
    name: fieldString(f, 3) ?? fieldString(f, 1) ?? '?',
  };
  if (kind === 'sensor') {
    info.unit = fieldString(f, 6);
    info.accuracyDecimals = Math.max(0, Math.min(10, int32(fieldNumber(f, 7)) ?? 0));
  } else if (kind === 'number') {
    info.unit = fieldString(f, 11);
  }
  return info;
};

const onOff = (v: number | undefined) => (v ? 'ON' : 'OFF');

/**
 * Decode a state message and format it. `info` may be undefined when the
 * entity was not in the ListEntities reply (the name is then shown as `?`).
 */
export const formatEntityState = (
  messageType: number,
  payload: Buffer,
  lookup: (id: string) => EntityInfo | undefined,
): EntityStateLine | null => {
  const kind = ENTITY_STATE_TYPES[messageType];
  if (!kind) return null;
  const f = decodeMessage(payload);
  const key = fieldNumber(f, 1) ?? 0;
  const id = entityId(kind, fieldNumber(f, STATE_DEVICE_ID_FIELD[kind]) ?? 0, key);
  if (HAS_MISSING_STATE.has(kind) && fieldNumber(f, 3)) return { kind, id, text: null };

  const info = lookup(id);
  const name = `'${info?.name ?? '?'}'`;
  let value: string;
  switch (kind) {
    case 'sensor': {
      const state = float32(fieldNumber(f, 2));
      value = info
        ? `${fixed(state, info.accuracyDecimals ?? 0)} ${info.unit ?? ''}`.trimEnd()
        : String(state);
      break;
    }
    case 'number':
      value = `${fixed(float32(fieldNumber(f, 2)), 2)}`;
      break;
    case 'binary_sensor':
    case 'switch':
      value = onOff(fieldNumber(f, 2));
      break;
    case 'text_sensor':
      value = `'${fieldString(f, 2) ?? ''}'`;
      break;
    case 'select':
      value = fieldString(f, 2) ?? '';
      break;
  }
  return { kind, id, text: `${name} >> ${value}` };
};
