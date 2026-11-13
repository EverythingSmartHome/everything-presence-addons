import net from 'net';
import { EventEmitter } from 'events';
import { ENTITY_INFO_TYPES, ENTITY_STATE_TYPES, EntityInfo, EntityStateLine, entityId, formatEntityState, parseEntityInfo } from './entityStates';
import { NoiseCipherState, NoiseHandshake } from './noise';
import {
  decodeMessage,
  decodeVarint,
  encodeFixed32Field,
  encodeMessage,
  encodeVarint,
  fieldNumber,
  fieldString,
} from './protobuf';

/**
 * Minimal ESPHome native API client: connect, identify the device, stream logs
 * and (optionally) entity state changes.
 *
 * No automatic reconnects; the caller owns the lifecycle. It never sends the
 * deprecated password ConnectRequest: devices without an API password treat a
 * client as authenticated after HelloRequest (this is also what aioesphomeapi
 * does when no password is given).
 */

export const ESPHOME_API_PORT = 6053;

/** Message type IDs from ESPHome's api.proto. */
export const MessageType = {
  HelloRequest: 1,
  HelloResponse: 2,
  DisconnectRequest: 5,
  DisconnectResponse: 6,
  PingRequest: 7,
  PingResponse: 8,
  DeviceInfoRequest: 9,
  DeviceInfoResponse: 10,
  ListEntitiesRequest: 11,
  ListEntitiesDoneResponse: 19,
  SubscribeStatesRequest: 20,
  SubscribeLogsRequest: 28,
  SubscribeLogsResponse: 29,
  GetTimeRequest: 36,
  GetTimeResponse: 37,
} as const;

/** ESPHome LogLevel enum values. */
export const LOG_LEVELS = ['NONE', 'ERROR', 'WARN', 'INFO', 'CONFIG', 'DEBUG', 'VERBOSE', 'VERY_VERBOSE'] as const;
export type LogLevelName = (typeof LOG_LEVELS)[number];

export const logLevelValue = (name: string): number => {
  const idx = LOG_LEVELS.indexOf(name as LogLevelName);
  return idx >= 0 ? idx : LOG_LEVELS.indexOf('DEBUG');
};

export type ApiErrorCode =
  | 'unreachable'
  | 'timeout'
  | 'encryption_required'
  | 'encryption_not_supported'
  | 'bad_key'
  | 'protocol_error'
  | 'closed';

export class EsphomeApiError extends Error {
  constructor(readonly code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'EsphomeApiError';
  }
}

export interface DeviceIdentity {
  name?: string;
  friendlyName?: string;
  esphomeVersion?: string;
  projectName?: string;
  projectVersion?: string;
  apiVersion?: string;
}

export interface DeviceLogMessage {
  level: number;
  message: string;
}

export type ApiCloseReason = 'user' | 'device_disconnected' | 'socket_closed' | 'timeout' | 'error';

export interface EsphomeApiClientOptions {
  host: string;
  port?: number;
  /** Decoded 32-byte encryption key; omit for plaintext devices. */
  noisePsk?: Buffer | null;
  clientInfo?: string;
  connectTimeoutMs?: number;
  pingIntervalMs?: number;
  /** Test hook. */
  createSocket?: (host: string, port: number) => net.Socket;
}

interface Frame {
  type: number;
  payload: Buffer;
}

type NoiseStage = 'hello' | 'handshake' | 'ready';

export interface EsphomeApiClient {
  on(event: 'log', listener: (log: DeviceLogMessage) => void): this;
  on(event: 'state', listener: (state: EntityStateLine) => void): this;
  on(event: 'close', listener: (info: { reason: ApiCloseReason; error?: EsphomeApiError }) => void): this;
}

export class EsphomeApiClient extends EventEmitter {
  private readonly host: string;
  private readonly port: number;
  private readonly psk: Buffer | null;
  private readonly clientInfo: string;
  private readonly connectTimeoutMs: number;
  private readonly pingIntervalMs: number;
  private readonly createSocket: (host: string, port: number) => net.Socket;

  private socket: net.Socket | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private noise: NoiseHandshake | null = null;
  private noiseStage: NoiseStage = 'hello';
  private sendCipher: NoiseCipherState | null = null;
  private receiveCipher: NoiseCipherState | null = null;
  private ready = false;
  private closed = false;
  private lastRx = 0;
  private pingTimer: NodeJS.Timeout | null = null;
  private waiters = new Map<number, { resolve: (frame: Frame) => void; reject: (err: Error) => void }>();
  private transportReady: { resolve: () => void; reject: (err: Error) => void } | null = null;
  private receivedAnyData = false;
  /** Entities from ListEntities; null until subscribeStates() is called. */
  private entities: Map<string, EntityInfo> | null = null;

  constructor(options: EsphomeApiClientOptions) {
    super();
    this.host = options.host;
    this.port = options.port ?? ESPHOME_API_PORT;
    this.psk = options.noisePsk ?? null;
    this.clientInfo = options.clientInfo ?? 'Everything Presence Zone Configurator';
    this.connectTimeoutMs = options.connectTimeoutMs ?? 10_000;
    this.pingIntervalMs = options.pingIntervalMs ?? 20_000;
    this.createSocket = options.createSocket ?? ((host, port) => net.connect({ host, port }));
  }

  get isEncrypted(): boolean {
    return this.psk !== null;
  }

  /**
   * Open the connection, complete the (optional) Noise handshake, exchange
   * Hello and read DeviceInfo. Rejects with EsphomeApiError on any failure.
   */
  async connect(): Promise<DeviceIdentity> {
    if (this.socket) throw new Error('EsphomeApiClient.connect() called twice');

    const deadline = setTimeout(() => {
      this.fail(new EsphomeApiError('timeout', `No response from ${this.host}:${this.port} within ${Math.round(this.connectTimeoutMs / 1000)}s`));
    }, this.connectTimeoutMs);

    try {
      await this.openTransport();
      const hello = await this.request(
        MessageType.HelloRequest,
        encodeMessage([
          [1, this.clientInfo],
          [2, 1],
          [3, 10],
        ]),
        MessageType.HelloResponse,
      );
      const helloFields = decodeMessage(hello.payload);
      const apiMajor = fieldNumber(helloFields, 1) ?? 0;
      const apiMinor = fieldNumber(helloFields, 2) ?? 0;

      const info = await this.request(MessageType.DeviceInfoRequest, Buffer.alloc(0), MessageType.DeviceInfoResponse);
      const f = decodeMessage(info.payload);
      this.ready = true;
      this.startPing();
      return {
        name: fieldString(f, 2) ?? fieldString(helloFields, 4),
        esphomeVersion: fieldString(f, 4),
        projectName: fieldString(f, 8),
        projectVersion: fieldString(f, 9),
        friendlyName: fieldString(f, 13),
        apiVersion: `${apiMajor}.${apiMinor}`,
      };
    } catch (error) {
      const apiError =
        error instanceof EsphomeApiError ? error : new EsphomeApiError('protocol_error', (error as Error).message);
      this.fail(apiError);
      throw apiError;
    } finally {
      clearTimeout(deadline);
    }
  }

  /** Start (or change the level of) the log subscription. */
  subscribeLogs(level: number, dumpConfig: boolean): void {
    if (!this.ready) throw new Error('Not connected');
    this.send(MessageType.SubscribeLogsRequest, encodeMessage([
      [1, level],
      [2, dumpConfig],
    ]));
  }

  /**
   * List the device's entities, then subscribe to their state changes
   * ('state' events). The device replays every current state first.
   */
  async subscribeStates(): Promise<void> {
    if (!this.ready) throw new Error('Not connected');
    this.entities = new Map();
    await this.request(MessageType.ListEntitiesRequest, Buffer.alloc(0), MessageType.ListEntitiesDoneResponse);
    this.send(MessageType.SubscribeStatesRequest, Buffer.alloc(0));
  }

  /** Politely disconnect. Safe to call more than once. */
  close(reason: ApiCloseReason = 'user'): void {
    if (this.closed) return;
    if (this.ready && this.socket && !this.socket.destroyed) {
      try {
        this.send(MessageType.DisconnectRequest, Buffer.alloc(0));
      } catch {
        // ignore; we're closing anyway
      }
    }
    this.finish(reason);
  }

  // ───────────────────────────── transport ─────────────────────────────

  private openTransport(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.transportReady = { resolve, reject };
      const socket = this.createSocket(this.host, this.port);
      this.socket = socket;
      socket.setNoDelay(true);

      socket.on('connect', () => {
        this.lastRx = Date.now();
        if (this.psk) {
          this.noise = new NoiseHandshake('initiator', this.psk);
          this.noiseStage = 'hello';
          // Empty client hello followed by the first handshake message, sent together
          // (as aioesphomeapi does).
          const handshake = Buffer.concat([Buffer.from([0x00]), this.noise.writeMessage()]);
          socket.write(Buffer.concat([this.noiseFrame(Buffer.alloc(0)), this.noiseFrame(handshake)]));
        } else {
          this.resolveTransport();
        }
      });

      socket.on('data', (chunk: Buffer) => this.onData(chunk));

      socket.on('error', (err: NodeJS.ErrnoException) => {
        const unreachable = ['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'];
        const code: ApiErrorCode = err.code && unreachable.includes(err.code) ? 'unreachable' : 'closed';
        this.fail(new EsphomeApiError(code, `${err.code ?? 'Socket error'} connecting to ${this.host}:${this.port}`));
      });

      socket.on('close', () => {
        if (this.closed) return;
        if (!this.ready) {
          this.fail(this.closedDuringSetupError());
        } else {
          this.finish('socket_closed');
        }
      });
    });
  }

  private closedDuringSetupError(): EsphomeApiError {
    if (this.psk && this.noiseStage !== 'ready') {
      return new EsphomeApiError(
        'encryption_not_supported',
        'The device closed the connection during the encrypted handshake. It may not use an encryption key.',
      );
    }
    if (!this.psk && !this.receivedAnyData) {
      return new EsphomeApiError(
        'encryption_required',
        'The device closed the connection without answering. It may require an encryption key.',
      );
    }
    return new EsphomeApiError('closed', 'The device closed the connection.');
  }

  private resolveTransport(): void {
    this.transportReady?.resolve();
    this.transportReady = null;
  }

  private onData(chunk: Buffer): void {
    this.receivedAnyData = true;
    this.lastRx = Date.now();
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    try {
      for (;;) {
        const frame = this.psk ? this.readNoiseFrame() : this.readPlaintextFrame();
        if (!frame) break;
        this.dispatch(frame);
        if (this.closed) break;
      }
    } catch (error) {
      this.fail(error instanceof EsphomeApiError ? error : new EsphomeApiError('protocol_error', (error as Error).message));
    }
  }

  private readPlaintextFrame(): Frame | null {
    if (this.buffer.length === 0) return null;
    const indicator = this.buffer[0];
    if (indicator === 0x01) {
      throw new EsphomeApiError('encryption_required', 'This device uses API encryption. Enter its encryption key to connect.');
    }
    if (indicator !== 0x00) {
      throw new EsphomeApiError('protocol_error', `Unexpected frame indicator 0x${indicator.toString(16)}`);
    }
    const len = decodeVarint(this.buffer, 1);
    if (!len) return null;
    const type = decodeVarint(this.buffer, 1 + len.length);
    if (!type) return null;
    const start = 1 + len.length + type.length;
    if (this.buffer.length < start + len.value) return null;
    const payload = Buffer.from(this.buffer.subarray(start, start + len.value));
    this.buffer = this.buffer.subarray(start + len.value);
    return { type: type.value, payload };
  }

  /** Returns a decoded API frame, or null when more data is needed. Handles handshake frames internally. */
  private readNoiseFrame(): Frame | null {
    for (;;) {
      if (this.buffer.length < 3) return null;
      const indicator = this.buffer[0];
      if (indicator === 0x00) {
        throw new EsphomeApiError(
          'encryption_not_supported',
          'This device does not use API encryption. Remove the saved encryption key and try again.',
        );
      }
      if (indicator !== 0x01) {
        throw new EsphomeApiError('protocol_error', `Unexpected frame indicator 0x${indicator.toString(16)}`);
      }
      const size = (this.buffer[1] << 8) | this.buffer[2];
      if (this.buffer.length < 3 + size) return null;
      const body = Buffer.from(this.buffer.subarray(3, 3 + size));
      this.buffer = this.buffer.subarray(3 + size);

      if (this.noiseStage === 'hello') {
        if (body.length < 1 || body[0] !== 0x01) {
          throw new EsphomeApiError('protocol_error', `Device selected unsupported encryption protocol ${body[0]}`);
        }
        this.noiseStage = 'handshake';
        continue;
      }
      if (this.noiseStage === 'handshake') {
        if (body.length < 1) throw new EsphomeApiError('protocol_error', 'Empty handshake frame');
        if (body[0] !== 0x00) {
          const reason = body.subarray(1).toString('utf8') || 'handshake rejected';
          throw new EsphomeApiError('bad_key', `The device rejected the encryption key (${reason}).`);
        }
        try {
          this.noise!.readMessage(body.subarray(1));
        } catch {
          throw new EsphomeApiError('bad_key', 'The encryption key does not match this device.');
        }
        const { send, receive } = this.noise!.split();
        this.sendCipher = send;
        this.receiveCipher = receive;
        this.noiseStage = 'ready';
        this.resolveTransport();
        continue;
      }
      const plain = this.receiveCipher!.decrypt(body);
      if (plain.length < 4) throw new EsphomeApiError('protocol_error', 'Encrypted frame too short');
      const type = plain.readUInt16BE(0);
      const len = plain.readUInt16BE(2);
      return { type, payload: Buffer.from(plain.subarray(4, 4 + len)) };
    }
  }

  private dispatch(frame: Frame): void {
    switch (frame.type) {
      case MessageType.PingRequest:
        this.send(MessageType.PingResponse, Buffer.alloc(0));
        return;
      case MessageType.GetTimeRequest:
        this.send(MessageType.GetTimeResponse, encodeFixed32Field(1, Math.floor(Date.now() / 1000)));
        return;
      case MessageType.DisconnectRequest:
        try {
          this.send(MessageType.DisconnectResponse, Buffer.alloc(0));
        } catch {
          // ignore
        }
        this.finish('device_disconnected');
        return;
      case MessageType.SubscribeLogsResponse: {
        const f = decodeMessage(frame.payload);
        const message = f.get(3);
        this.emit('log', {
          level: fieldNumber(f, 1) ?? 0,
          message: Buffer.isBuffer(message) ? message.toString('utf8') : '',
        } satisfies DeviceLogMessage);
        return;
      }
      default: {
        if (this.entities && (ENTITY_INFO_TYPES[frame.type] || ENTITY_STATE_TYPES[frame.type])) {
          this.handleEntityFrame(frame);
          return;
        }
        const waiter = this.waiters.get(frame.type);
        if (waiter) {
          this.waiters.delete(frame.type);
          waiter.resolve(frame);
        }
        // Anything else (e.g. PingResponse) is ignored; receiving it already refreshed lastRx.
      }
    }
  }

  /** Entity info/state frames. A malformed one is skipped rather than dropping the log stream. */
  private handleEntityFrame(frame: Frame): void {
    const entities = this.entities!;
    try {
      const info = parseEntityInfo(frame.type, frame.payload);
      if (info) {
        entities.set(entityId(info.kind, info.deviceId, info.key), info);
        return;
      }
      const state = formatEntityState(frame.type, frame.payload, (id) => entities.get(id));
      if (state) this.emit('state', state);
    } catch {
      // ignore
    }
  }

  private noiseFrame(body: Buffer): Buffer {
    if (body.length > 0xffff) throw new Error('Noise frame too large');
    return Buffer.concat([Buffer.from([0x01, (body.length >> 8) & 0xff, body.length & 0xff]), body]);
  }

  private send(type: number, payload: Buffer): void {
    if (!this.socket || this.socket.destroyed) throw new EsphomeApiError('closed', 'Not connected');
    if (this.psk) {
      const header = Buffer.alloc(4);
      header.writeUInt16BE(type, 0);
      header.writeUInt16BE(payload.length, 2);
      this.socket.write(this.noiseFrame(this.sendCipher!.encrypt(Buffer.concat([header, payload]))));
    } else {
      this.socket.write(Buffer.concat([Buffer.from([0x00]), encodeVarint(payload.length), encodeVarint(type), payload]));
    }
  }

  private request(type: number, payload: Buffer, responseType: number): Promise<Frame> {
    return new Promise<Frame>((resolve, reject) => {
      this.waiters.set(responseType, { resolve, reject });
      try {
        this.send(type, payload);
      } catch (error) {
        this.waiters.delete(responseType);
        reject(error);
      }
    });
  }

  private startPing(): void {
    this.pingTimer = setInterval(() => {
      if (Date.now() - this.lastRx > this.pingIntervalMs * 3) {
        this.finish('timeout');
        return;
      }
      try {
        this.send(MessageType.PingRequest, Buffer.alloc(0));
      } catch {
        this.finish('socket_closed');
      }
    }, this.pingIntervalMs);
    this.pingTimer.unref?.();
  }

  /** Failure before or after setup: reject pending work and close. */
  private fail(error: EsphomeApiError): void {
    if (this.closed) return;
    this.transportReady?.reject(error);
    this.transportReady = null;
    for (const waiter of this.waiters.values()) waiter.reject(error);
    this.waiters.clear();
    this.finish('error', error);
  }

  private finish(reason: ApiCloseReason, error?: EsphomeApiError): void {
    if (this.closed) return;
    this.closed = true;
    const wasReady = this.ready;
    this.ready = false;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    const pending = error ?? new EsphomeApiError('closed', 'Connection closed');
    this.transportReady?.reject(pending);
    this.transportReady = null;
    for (const waiter of this.waiters.values()) waiter.reject(pending);
    this.waiters.clear();
    const socket = this.socket;
    if (socket && !socket.destroyed) {
      socket.end();
      setTimeout(() => socket.destroy(), 500).unref?.();
    }
    if (wasReady || error) {
      this.emit('close', { reason, error });
    }
  }
}
