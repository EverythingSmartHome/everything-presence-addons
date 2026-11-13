import net from 'node:net';
import { MessageType } from './apiClient';
import { NoiseCipherState, NoiseHandshake } from './noise';
import { decodeMessage, decodeVarint, encodeMessage, encodeVarint } from './protobuf';

/**
 * A fake ESPHome device speaking the native API over a real TCP socket, in
 * plaintext or Noise mode, for apiClient tests. Mirrors the device behaviour
 * the client relies on (including how a mismatched mode is answered).
 */

export interface FakeDeviceOptions {
  /** When set, the device requires encryption with this key. */
  psk?: Buffer;
  name?: string;
  /** Messages sent in reply to ListEntitiesRequest (before ListEntitiesDone). */
  entities?: Array<{ type: number; payload: Buffer }>;
  /** Messages sent in reply to SubscribeStatesRequest (the current-state replay). */
  initialStates?: Array<{ type: number; payload: Buffer }>;
}

export interface FakeDevice {
  port: number;
  /** Message types received from the client, in order. */
  received: number[];
  subscriptions: Array<{ level: number; dumpConfig: boolean }>;
  sendLog(level: number, text: string): void;
  /** Send any message to the subscribed client. */
  sendMessage(type: number, payload: Buffer): void;
  /** Send a DisconnectRequest (as a rebooting device does). */
  requestDisconnect(): void;
  /** Wait until the client has sent a message of `type`. */
  waitFor(type: number): Promise<void>;
  close(): Promise<void>;
}

const noiseFrame = (body: Buffer) => Buffer.concat([Buffer.from([0x01, body.length >> 8, body.length & 0xff]), body]);

export const startFakeDevice = async (options: FakeDeviceOptions = {}): Promise<FakeDevice> => {
  const name = options.name ?? 'everything-presence-lite-abc123';
  const received: number[] = [];
  const subscriptions: Array<{ level: number; dumpConfig: boolean }> = [];
  const waiters: Array<{ type: number; resolve: () => void }> = [];
  const sockets = new Set<net.Socket>();
  let sendToClient: ((type: number, payload: Buffer) => void) | null = null;

  const server = net.createServer((sock) => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
    sock.on('error', () => undefined);
    let buf = Buffer.alloc(0);
    let stage: 'hello' | 'handshake' | 'ready' = 'hello';
    const hs = options.psk ? new NoiseHandshake('responder', options.psk) : null;
    let tx: NoiseCipherState | null = null;
    let rx: NoiseCipherState | null = null;

    const send = (type: number, payload: Buffer) => {
      if (options.psk) {
        const header = Buffer.alloc(4);
        header.writeUInt16BE(type, 0);
        header.writeUInt16BE(payload.length, 2);
        sock.write(noiseFrame(tx!.encrypt(Buffer.concat([header, payload]))));
      } else {
        sock.write(Buffer.concat([Buffer.from([0]), encodeVarint(payload.length), encodeVarint(type), payload]));
      }
    };

    const handle = (type: number, payload: Buffer) => {
      received.push(type);
      for (const w of waiters.filter((x) => x.type === type)) w.resolve();
      switch (type) {
        case MessageType.HelloRequest:
          send(MessageType.HelloResponse, encodeMessage([[1, 1], [2, 10], [3, 'fake 2025.11.0'], [4, name]]));
          break;
        case MessageType.DeviceInfoRequest:
          send(
            MessageType.DeviceInfoResponse,
            encodeMessage([
              [2, name],
              [4, '2025.11.0'],
              [8, 'EverythingSmartHome.Everything Presence Lite'],
              [9, '1.3.0'],
              [13, 'Everything Presence Lite ABC'],
            ]),
          );
          break;
        case MessageType.SubscribeLogsRequest: {
          const f = decodeMessage(payload);
          subscriptions.push({ level: (f.get(1) as number) ?? 0, dumpConfig: f.get(2) === 1 });
          sendToClient = send;
          break;
        }
        case MessageType.ListEntitiesRequest:
          for (const m of options.entities ?? []) send(m.type, m.payload);
          send(MessageType.ListEntitiesDoneResponse, Buffer.alloc(0));
          break;
        case MessageType.SubscribeStatesRequest:
          for (const m of options.initialStates ?? []) send(m.type, m.payload);
          break;
        case MessageType.PingRequest:
          send(MessageType.PingResponse, Buffer.alloc(0));
          break;
        case MessageType.DisconnectRequest:
          send(MessageType.DisconnectResponse, Buffer.alloc(0));
          sock.end();
          break;
        default:
      }
    };

    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        if (options.psk) {
          if (buf.length === 0) return;
          if (buf[0] !== 0x01) {
            // Plaintext client talking to an encrypted device.
            sock.end(noiseFrame(Buffer.concat([Buffer.from([0x01]), Buffer.from('Bad indicator byte')])));
            return;
          }
          if (buf.length < 3) return;
          const size = (buf[1] << 8) | buf[2];
          if (buf.length < 3 + size) return;
          const body = buf.subarray(3, 3 + size);
          buf = buf.subarray(3 + size);
          if (stage === 'hello') {
            stage = 'handshake';
            continue;
          }
          if (stage === 'handshake') {
            const serverHello = noiseFrame(Buffer.concat([Buffer.from([0x01]), Buffer.from(`${name}\0`)]));
            try {
              hs!.readMessage(body.subarray(1));
            } catch {
              sock.end(Buffer.concat([serverHello, noiseFrame(Buffer.concat([Buffer.from([0x01]), Buffer.from('Handshake MAC failure')]))]));
              return;
            }
            const reply = hs!.writeMessage();
            ({ send: tx, receive: rx } = hs!.split());
            stage = 'ready';
            sock.write(Buffer.concat([serverHello, noiseFrame(Buffer.concat([Buffer.from([0x00]), reply]))]));
            continue;
          }
          const plain = rx!.decrypt(body);
          handle(plain.readUInt16BE(0), plain.subarray(4, 4 + plain.readUInt16BE(2)));
        } else {
          if (buf.length === 0) return;
          if (buf[0] !== 0x00) {
            // Encrypted client talking to a plaintext device: it just drops the connection.
            sock.destroy();
            return;
          }
          const len = decodeVarint(buf, 1);
          if (!len) return;
          const type = decodeVarint(buf, 1 + len.length);
          if (!type) return;
          const start = 1 + len.length + type.length;
          if (buf.length < start + len.value) return;
          const payload = buf.subarray(start, start + len.value);
          buf = buf.subarray(start + len.value);
          handle(type.value, payload);
        }
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;

  return {
    port,
    received,
    subscriptions,
    sendLog(level, text) {
      sendToClient?.(MessageType.SubscribeLogsResponse, encodeMessage([[1, level], [3, Buffer.from(text)]]));
    },
    sendMessage(type, payload) {
      sendToClient?.(type, payload);
    },
    requestDisconnect() {
      sendToClient?.(MessageType.DisconnectRequest, Buffer.alloc(0));
    },
    waitFor(type) {
      if (received.includes(type)) return Promise.resolve();
      return new Promise((resolve) => waiters.push({ type, resolve }));
    },
    close() {
      for (const s of sockets) s.destroy();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
};
