import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { CLIENT_LOG_BUFFER_LIMITS, LogBuffer, LogEntry } from './logBuffer';
import { logger, logLevelController, serverLogBuffer } from '../logger';

export const DEBUG_SESSION_MAX_DURATION_MS = 30 * 60 * 1000;
const SESSION_FILE_NAME = 'debug-session.json';
const MAX_CLIENT_STRING = 4096;
const MAX_CLIENT_BATCH = 500;

export type DebugStopReason = 'user' | 'timeout' | 'restart';

/** Session metadata persisted to DATA_DIR/debug-session.json (never logs). */
export interface DebugSessionMeta {
  id: string;
  active: boolean;
  startedAt: string;
  expiresAt: string;
  stoppedAt?: string;
  stopReason?: DebugStopReason;
  restarts: number;
}

export interface DebugSessionStatus {
  active: boolean;
  sessionId: string | null;
  startedAt: string | null;
  expiresAt: string | null;
  stoppedAt: string | null;
  stopReason: DebugStopReason | null;
  remainingMs: number;
  restarts: number;
  maxDurationMs: number;
  logLevel: string;
  server: { entries: number; dropped: number; bytes: number };
  client: { entries: number; dropped: number };
}

export interface DebugSessionDeps {
  dataDir: string;
  serverBuffer: LogBuffer;
  clientBuffer?: LogBuffer;
  /** Raise/restore the runtime log level. */
  setDebugLevel: (active: boolean) => void;
  getLogLevel: () => string;
  /** Emit an informational log line (also lands in the buffer while recording). */
  log?: (msg: string, data?: Record<string, unknown>) => void;
  now?: () => number;
  maxDurationMs?: number;
}

const truncate = (value: unknown, max = MAX_CLIENT_STRING): string | undefined => {
  if (value === undefined || value === null) return undefined;
  const str = typeof value === 'string' ? value : String(value);
  return str.length > max ? `${str.slice(0, max)}…[truncated]` : str;
};

/**
 * Normalise one uploaded client log entry; anything not matching the
 * expected shape is reduced to bounded strings.
 */
export const sanitizeClientEntry = (raw: unknown): LogEntry | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const entry: LogEntry = {
    ts: typeof input.ts === 'string' ? truncate(input.ts, 64) : typeof input.ts === 'number' ? new Date(input.ts).toISOString() : undefined,
    level: truncate(input.level, 16) ?? 'info',
    kind: truncate(input.kind, 32) ?? 'console',
    msg: truncate(input.msg) ?? '',
  };
  for (const key of ['method', 'url', 'page', 'stack', 'body', 'event'] as const) {
    const value = truncate(input[key]);
    if (value !== undefined) entry[key] = value;
  }
  for (const key of ['status', 'durationMs'] as const) {
    if (typeof input[key] === 'number' && Number.isFinite(input[key])) entry[key] = input[key];
  }
  return entry;
};

export class DebugSessionService {
  private readonly file: string;
  private readonly serverBuffer: LogBuffer;
  private readonly clientBuffer: LogBuffer;
  private readonly now: () => number;
  private readonly maxDurationMs: number;
  private meta: DebugSessionMeta | null = null;
  private timer: NodeJS.Timeout | null = null;
  private clientDroppedReported = 0;

  constructor(private readonly deps: DebugSessionDeps) {
    this.file = path.join(deps.dataDir, SESSION_FILE_NAME);
    this.serverBuffer = deps.serverBuffer;
    this.clientBuffer = deps.clientBuffer ?? new LogBuffer(CLIENT_LOG_BUFFER_LIMITS);
    this.now = deps.now ?? Date.now;
    this.maxDurationMs = deps.maxDurationMs ?? DEBUG_SESSION_MAX_DURATION_MS;
  }

  /**
   * Restore state after a restart: a session younger than the maximum
   * duration resumes (with a marker entry; earlier logs were in memory only),
   * otherwise it is recorded as stopped because of the restart.
   */
  init(): void {
    const stored = this.readMeta();
    if (!stored) return;
    this.meta = stored;
    if (!stored.active) return;

    const startedAt = Date.parse(stored.startedAt);
    const age = this.now() - startedAt;
    if (Number.isFinite(startedAt) && age >= 0 && age < this.maxDurationMs) {
      this.meta = { ...stored, restarts: (stored.restarts ?? 0) + 1 };
      this.serverBuffer.start();
      this.clientBuffer.start();
      this.clientDroppedReported = 0;
      this.deps.setDebugLevel(true);
      this.marker('restart', 'Debug session resumed after add-on restart; logs before the restart are not available');
      this.schedule(startedAt + this.maxDurationMs - this.now());
      this.writeMeta();
    } else {
      this.meta = { ...stored, active: false, stoppedAt: new Date(this.now()).toISOString(), stopReason: 'restart' };
      this.writeMeta();
    }
  }

  start(): DebugSessionStatus {
    if (this.meta?.active) {
      return this.status();
    }
    const now = this.now();
    this.meta = {
      id: uuidv4(),
      active: true,
      startedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.maxDurationMs).toISOString(),
      restarts: 0,
    };
    this.serverBuffer.start();
    this.clientBuffer.start();
    this.clientDroppedReported = 0;
    this.deps.setDebugLevel(true);
    this.marker('start', 'Debug session started');
    this.schedule(this.maxDurationMs);
    this.writeMeta();
    return this.status();
  }

  stop(reason: DebugStopReason = 'user'): DebugSessionStatus {
    if (!this.meta?.active) {
      return this.status();
    }
    this.marker('stop', `Debug session stopped (${reason})`);
    this.clearTimer();
    this.deps.setDebugLevel(false);
    this.serverBuffer.stop();
    this.clientBuffer.stop();
    this.meta = { ...this.meta, active: false, stoppedAt: new Date(this.now()).toISOString(), stopReason: reason };
    this.writeMeta();
    return this.status();
  }

  get isActive(): boolean {
    return Boolean(this.meta?.active);
  }

  /** Store a batch of client log entries; ignored unless a session is active. */
  addClientLogs(sessionId: unknown, entries: unknown, clientDropped?: unknown): { accepted: number; active: boolean } {
    if (!this.meta?.active || (typeof sessionId === 'string' && sessionId && sessionId !== this.meta.id)) {
      return { accepted: 0, active: Boolean(this.meta?.active) };
    }
    let accepted = 0;
    if (Array.isArray(entries)) {
      for (const raw of entries.slice(-MAX_CLIENT_BATCH)) {
        const entry = sanitizeClientEntry(raw);
        if (entry) {
          this.clientBuffer.push(entry);
          accepted += 1;
        }
      }
    }
    if (typeof clientDropped === 'number' && clientDropped > this.clientDroppedReported) {
      this.clientBuffer.push({
        ts: new Date(this.now()).toISOString(),
        level: 'warn',
        kind: 'marker',
        msg: `Browser dropped ${clientDropped - this.clientDroppedReported} log entries (client buffer full)`,
      });
      this.clientDroppedReported = clientDropped;
    }
    return { accepted, active: true };
  }

  status(): DebugSessionStatus {
    const meta = this.meta;
    const expires = meta ? Date.parse(meta.expiresAt) : NaN;
    return {
      active: Boolean(meta?.active),
      sessionId: meta?.id ?? null,
      startedAt: meta?.startedAt ?? null,
      expiresAt: meta?.expiresAt ?? null,
      stoppedAt: meta?.stoppedAt ?? null,
      stopReason: meta?.stopReason ?? null,
      remainingMs: meta?.active && Number.isFinite(expires) ? Math.max(0, expires - this.now()) : 0,
      restarts: meta?.restarts ?? 0,
      maxDurationMs: this.maxDurationMs,
      logLevel: this.deps.getLogLevel(),
      server: { entries: this.serverBuffer.size, dropped: this.serverBuffer.dropped, bytes: this.serverBuffer.bytes },
      client: { entries: this.clientBuffer.size, dropped: this.clientBuffer.dropped + this.clientDroppedReported },
    };
  }

  serverLogs() {
    return this.serverBuffer.snapshot();
  }

  clientLogs() {
    const snapshot = this.clientBuffer.snapshot();
    return { ...snapshot, browserDropped: this.clientDroppedReported };
  }

  /** Stop timers (used by tests and shutdown). */
  dispose(): void {
    this.clearTimer();
  }

  private marker(event: string, msg: string): void {
    const ts = new Date(this.now()).toISOString();
    this.deps.log?.(msg, { debugSession: this.meta?.id, debugEvent: event });
    this.clientBuffer.push({ ts, level: 'info', kind: 'marker', msg });
  }

  private schedule(delayMs: number): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.stop('timeout');
    }, Math.max(0, delayMs));
    this.timer.unref?.();
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private readMeta(): DebugSessionMeta | null {
    try {
      if (!fs.existsSync(this.file)) return null;
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf-8'));
      if (parsed && typeof parsed === 'object' && typeof parsed.id === 'string' && typeof parsed.startedAt === 'string') {
        return {
          id: parsed.id,
          active: Boolean(parsed.active),
          startedAt: parsed.startedAt,
          expiresAt: typeof parsed.expiresAt === 'string' ? parsed.expiresAt : parsed.startedAt,
          stoppedAt: typeof parsed.stoppedAt === 'string' ? parsed.stoppedAt : undefined,
          stopReason: parsed.stopReason,
          restarts: typeof parsed.restarts === 'number' ? parsed.restarts : 0,
        };
      }
    } catch (error) {
      this.deps.log?.('Failed to read debug session metadata; ignoring', { error });
    }
    return null;
  }

  private writeMeta(): void {
    if (!this.meta) return;
    try {
      fs.mkdirSync(this.deps.dataDir, { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.meta, null, 2));
    } catch (error) {
      this.deps.log?.('Failed to persist debug session metadata', { error });
    }
  }
}

const DEFAULT_DATA_DIR = '/config/everything-presence-zone-configurator';

/** Process-wide debug session bound to the application logger. */
export const debugSession = new DebugSessionService({
  dataDir: process.env.DATA_DIR ?? DEFAULT_DATA_DIR,
  serverBuffer: serverLogBuffer,
  setDebugLevel: (active) => logLevelController.setDebug(active),
  getLogLevel: () => logLevelController.level,
  log: (msg, data) => logger.info(data ?? {}, msg),
});
