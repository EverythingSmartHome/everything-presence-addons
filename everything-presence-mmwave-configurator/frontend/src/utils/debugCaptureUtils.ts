// Pure helpers for browser-side debug capture (kept DOM-free so they can be unit tested).

export type ClientLogLevel = 'debug' | 'info' | 'warn' | 'error';
export type ClientLogKind = 'console' | 'error' | 'unhandledrejection' | 'fetch' | 'websocket' | 'navigation' | 'marker';

export interface ClientLogEntry {
  ts: string;
  level: ClientLogLevel;
  kind: ClientLogKind;
  msg: string;
  method?: string;
  url?: string;
  status?: number;
  durationMs?: number;
  body?: string;
  stack?: string;
  event?: string;
  page?: string;
}

/** Browser-side buffer size; the oldest entries are dropped beyond this. */
export const MAX_CLIENT_BUFFER = 2000;
/** Largest error response body kept for a failed request. */
export const MAX_ERROR_BODY_CHARS = 2048;
export const MAX_MESSAGE_CHARS = 4000;
/** Entries sent per upload. */
export const UPLOAD_BATCH_SIZE = 250;

/** True for requests to the debug API itself, which are never recorded. */
export const isDebugEndpoint = (url: string): boolean => /(^|\/)api\/debug(\/|\?|#|$)/.test(url);

/** Remove the query string and fragment (they may carry tokens or entity data). */
export const stripQuery = (url: string): string => {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
};

export const truncate = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max)}…[truncated ${value.length - max} chars]` : value;

const describeError = (error: Error): string => `${error.name}: ${error.message}`;

export const REDACTED = '[REDACTED]';
const SECRET_KEY = /(token|passw|secret|auth|cookie|api[_-]?key|apikey|psk|credential|private[_-]?key)/i;
const SSID_KEY = /ssid/i;

/** Credential-like keys whose values are replaced before anything is recorded. */
export const isSecretKey = (key: string): boolean => SECRET_KEY.test(key);
/** Wi-Fi network name keys (ssid, bssid, wifi_ssid…) which are dropped entirely. */
export const isDroppedKey = (key: string): boolean => SSID_KEY.test(key);

/**
 * Apply the key rules to an object property during serialisation. The server
 * redacts every bundle again; this keeps obvious secrets out of the upload.
 */
const redactProperty = (key: string, value: unknown): unknown => {
  if (key === '') return value;
  if (isDroppedKey(key)) return undefined;
  if (isSecretKey(key) && value !== null && value !== undefined && typeof value !== 'boolean') return REDACTED;
  return value;
};

/** Safely render one console argument as text (handles Errors and cycles). */
export const formatValue = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return describeError(value);
  if (value === undefined) return 'undefined';
  if (typeof value === 'function') return `[function ${value.name || 'anonymous'}]`;
  if (typeof value !== 'object' || value === null) return String(value);
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (key, raw: unknown) => {
      const inner = redactProperty(key, raw);
      if (inner instanceof Error) return describeError(inner);
      if (inner && typeof inner === 'object') {
        if (seen.has(inner)) return '[Circular]';
        seen.add(inner);
      }
      return inner;
    }) ?? String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
};

/**
 * Prepare a failed response body for recording: JSON bodies are parsed and
 * re-serialised with the key rules applied; other text is kept as is (the
 * server's text redaction still applies). The result is bounded.
 */
export const sanitizeBodyText = (body: string, max: number): string => {
  const trimmed = body.trim();
  if (/^[[{]/.test(trimmed) && /[\]}]$/.test(trimmed)) {
    try {
      return truncate(formatValue(JSON.parse(trimmed)), max);
    } catch {
      // Not JSON after all.
    }
  }
  return truncate(body, max);
};

/**
 * Upload everything still queued: waits for an upload already in flight, then
 * keeps flushing until the queue is empty or two rounds make no progress.
 * `flushOnce` must return the in-flight upload's promise while one is running.
 */
export const drainPending = async (
  flushOnce: () => Promise<void>,
  pending: () => number,
  maxRounds = 20,
): Promise<void> => {
  let stalled = 0;
  // Always run at least once so an in-flight upload is awaited even when nothing is queued.
  for (let round = 0; round < maxRounds; round += 1) {
    const before = pending();
    await flushOnce();
    if (pending() === 0) return;
    stalled = pending() >= before ? stalled + 1 : 0;
    if (stalled >= 2) return;
  }
};

/** Turn console arguments into a bounded message plus the first Error stack. */
export const formatConsoleArgs = (args: unknown[]): { msg: string; stack?: string } => {
  const msg = truncate(args.map(formatValue).join(' '), MAX_MESSAGE_CHARS);
  const error = args.find((arg): arg is Error => arg instanceof Error);
  return error?.stack ? { msg, stack: truncate(error.stack, MAX_MESSAGE_CHARS) } : { msg };
};

/** Fixed-capacity FIFO that drops (and counts) the oldest entries when full. */
export class BoundedQueue<T> {
  private items: T[] = [];
  private droppedCount = 0;
  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = Math.max(1, capacity);
  }

  get size(): number {
    return this.items.length;
  }

  /** Total entries dropped since the last reset. */
  get dropped(): number {
    return this.droppedCount;
  }

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.capacity) {
      const overflow = this.items.length - this.capacity;
      this.items.splice(0, overflow);
      this.droppedCount += overflow;
    }
  }

  /** Remove and return up to `max` of the oldest entries. */
  take(max: number = Number.POSITIVE_INFINITY): T[] {
    return this.items.splice(0, Math.min(max, this.items.length));
  }

  /** Count entries as lost (e.g. a failed upload). */
  markDropped(count: number): void {
    this.droppedCount += Math.max(0, count);
  }

  reset(): void {
    this.items = [];
    this.droppedCount = 0;
  }
}

/** Format remaining milliseconds as m:ss. */
export const formatRemaining = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

/** Read the filename from a Content-Disposition header, if present. */
export const filenameFromDisposition = (header: string | null, fallback: string): string => {
  const match = header?.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? fallback;
};
