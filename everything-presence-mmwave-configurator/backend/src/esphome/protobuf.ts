/**
 * Minimal protobuf encoding for the handful of ESPHome native API messages the
 * log viewer needs. Only varint (0), 64-bit (1, skipped), length-delimited (2)
 * and 32-bit (5) wire types are supported, which covers every field we read.
 */

export type ProtoField = number | boolean | string | Buffer;

/** Encode an unsigned integer (≤ 2^53) as a protobuf varint. */
export const encodeVarint = (value: number): Buffer => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`Cannot encode ${value} as an unsigned varint`);
  }
  const bytes: number[] = [];
  let remaining = value;
  while (remaining >= 0x80) {
    bytes.push((remaining % 0x80) | 0x80);
    remaining = Math.floor(remaining / 0x80);
  }
  bytes.push(remaining);
  return Buffer.from(bytes);
};

/**
 * Decode a varint at `offset`. Returns null when the buffer ends before the
 * varint does (more data needed).
 */
export const decodeVarint = (buf: Buffer, offset = 0): { value: number; length: number } | null => {
  let value = 0;
  let multiplier = 1;
  for (let i = 0; i < 10; i += 1) {
    if (offset + i >= buf.length) return null;
    const byte = buf[offset + i];
    value += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) {
      return { value, length: i + 1 };
    }
    multiplier *= 0x80;
  }
  throw new Error('Malformed varint (more than 10 bytes)');
};

/**
 * Encode a message from `[fieldNumber, value]` pairs. Numbers and booleans are
 * varints; strings and Buffers are length-delimited. Default values (0, false,
 * '') are omitted, as proto3 does.
 */
export const encodeMessage = (fields: Array<[number, ProtoField | undefined]>): Buffer => {
  const parts: Buffer[] = [];
  for (const [fieldNumber, value] of fields) {
    if (value === undefined) continue;
    if (typeof value === 'number' || typeof value === 'boolean') {
      const n = typeof value === 'boolean' ? (value ? 1 : 0) : value;
      if (n === 0) continue;
      parts.push(encodeVarint(fieldNumber * 8 + 0), encodeVarint(n));
    } else {
      const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
      if (bytes.length === 0) continue;
      parts.push(encodeVarint(fieldNumber * 8 + 2), encodeVarint(bytes.length), bytes);
    }
  }
  return Buffer.concat(parts);
};

/** Encode a single fixed32 field (wire type 5). */
export const encodeFixed32Field = (fieldNumber: number, value: number): Buffer => {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value >>> 0, 0);
  return Buffer.concat([encodeVarint(fieldNumber * 8 + 5), out]);
};

/**
 * Decode a message into a map of field number → last value seen. Varints and
 * fixed32 become numbers, length-delimited fields stay as Buffers, fixed64 is
 * skipped. Throws on truncated input.
 */
export const decodeMessage = (buf: Buffer): Map<number, number | Buffer> => {
  const fields = new Map<number, number | Buffer>();
  let offset = 0;
  while (offset < buf.length) {
    const key = decodeVarint(buf, offset);
    if (!key) throw new Error('Truncated protobuf field key');
    offset += key.length;
    const fieldNumber = Math.floor(key.value / 8);
    const wireType = key.value % 8;
    switch (wireType) {
      case 0: {
        const v = decodeVarint(buf, offset);
        if (!v) throw new Error('Truncated protobuf varint');
        offset += v.length;
        fields.set(fieldNumber, v.value);
        break;
      }
      case 1:
        if (offset + 8 > buf.length) throw new Error('Truncated protobuf fixed64');
        offset += 8;
        break;
      case 2: {
        const len = decodeVarint(buf, offset);
        if (!len) throw new Error('Truncated protobuf length');
        offset += len.length;
        if (offset + len.value > buf.length) throw new Error('Truncated protobuf bytes');
        fields.set(fieldNumber, buf.subarray(offset, offset + len.value));
        offset += len.value;
        break;
      }
      case 5:
        if (offset + 4 > buf.length) throw new Error('Truncated protobuf fixed32');
        fields.set(fieldNumber, buf.readUInt32LE(offset));
        offset += 4;
        break;
      default:
        throw new Error(`Unsupported protobuf wire type ${wireType}`);
    }
  }
  return fields;
};

export const fieldString = (fields: Map<number, number | Buffer>, n: number): string | undefined => {
  const v = fields.get(n);
  return Buffer.isBuffer(v) ? v.toString('utf8') : undefined;
};

export const fieldNumber = (fields: Map<number, number | Buffer>, n: number): number | undefined => {
  const v = fields.get(n);
  return typeof v === 'number' ? v : undefined;
};
