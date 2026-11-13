import { ingressAware } from '../api/client';
import {
  fetchDebugStatus,
  startDebugSessionRequest,
  stopDebugSessionRequest,
  type DebugStatus,
} from '../api/debug';
import {
  BoundedQueue,
  drainPending,
  formatConsoleArgs,
  sanitizeBodyText,
  formatValue,
  isDebugEndpoint,
  MAX_CLIENT_BUFFER,
  MAX_ERROR_BODY_CHARS,
  MAX_MESSAGE_CHARS,
  stripQuery,
  truncate,
  UPLOAD_BATCH_SIZE,
  type ClientLogEntry,
  type ClientLogLevel,
} from '../utils/debugCaptureUtils';

/**
 * Browser-side debug capture. Installed once; every hook is a pass-through
 * no-op unless a debug session is active. Requests to /api/debug/* are never
 * recorded, query strings are stripped, only failed responses keep a body
 * (≤2 KB), and WebSocket activity is limited to open/close/error/reconnect.
 */

export interface DebugCaptureState {
  active: boolean;
  sessionId: string | null;
  expiresAt: string | null;
}

type Listener = (state: DebugCaptureState) => void;
type ConsoleMethod = 'debug' | 'info' | 'log' | 'warn' | 'error';

const FLUSH_INTERVAL_MS = 5000;
const STATUS_POLL_MS = 30_000;
const CONSOLE_LEVELS: Record<ConsoleMethod, ClientLogLevel> = {
  debug: 'debug',
  info: 'info',
  log: 'info',
  warn: 'warn',
  error: 'error',
};

let state: DebugCaptureState = { active: false, sessionId: null, expiresAt: null };
const listeners = new Set<Listener>();
const queue = new BoundedQueue<ClientLogEntry>(MAX_CLIENT_BUFFER);

let installed = false;
let originalFetch: typeof window.fetch | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let inFlight: Promise<void> | null = null;
let recording = false; // re-entrancy guard (console calls made while recording)

const nowIso = () => new Date().toISOString();

const setState = (next: DebugCaptureState) => {
  state = next;
  for (const listener of listeners) listener(state);
};

const record = (entry: Omit<ClientLogEntry, 'ts'>) => {
  if (!state.active || recording) return;
  recording = true;
  try {
    queue.push({ ts: nowIso(), ...entry });
  } finally {
    recording = false;
  }
};

const requestUrl = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
};

const capturedFetch: typeof window.fetch = async (input, init) => {
  const realFetch = originalFetch!;
  if (!state.active) return realFetch(input, init);
  const url = requestUrl(input);
  if (isDebugEndpoint(url)) return realFetch(input, init);

  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const safeUrl = stripQuery(url);
  const started = performance.now();
  try {
    const res = await realFetch(input, init);
    const durationMs = Math.round(performance.now() - started);
    if (res.ok) {
      record({ level: 'info', kind: 'fetch', msg: `${method} ${safeUrl} ${res.status}`, method, url: safeUrl, status: res.status, durationMs });
    } else {
      // Read the error body from a clone without delaying the caller.
      res
        .clone()
        .text()
        .catch(() => '')
        .then((body) => {
          record({
            level: 'warn',
            kind: 'fetch',
            msg: `${method} ${safeUrl} ${res.status}`,
            method,
            url: safeUrl,
            status: res.status,
            durationMs,
            body: sanitizeBodyText(body, MAX_ERROR_BODY_CHARS),
          });
        });
    }
    return res;
  } catch (error) {
    record({
      level: 'error',
      kind: 'fetch',
      msg: `${method} ${safeUrl} failed: ${formatValue(error)}`,
      method,
      url: safeUrl,
      durationMs: Math.round(performance.now() - started),
    });
    throw error;
  }
};

const wrapConsole = () => {
  for (const method of Object.keys(CONSOLE_LEVELS) as ConsoleMethod[]) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      original(...args);
      if (!state.active) return;
      const { msg, stack } = formatConsoleArgs(args);
      record({ level: CONSOLE_LEVELS[method], kind: 'console', msg, ...(stack ? { stack } : {}) });
    };
  }
};

const onWindowError = (event: ErrorEvent) => {
  if (!state.active) return;
  const location = event.filename ? ` (${stripQuery(event.filename)}:${event.lineno}:${event.colno})` : '';
  record({
    level: 'error',
    kind: 'error',
    msg: truncate(`${event.message}${location}`, MAX_MESSAGE_CHARS),
    ...(event.error instanceof Error && event.error.stack ? { stack: truncate(event.error.stack, MAX_MESSAGE_CHARS) } : {}),
  });
};

const onUnhandledRejection = (event: PromiseRejectionEvent) => {
  if (!state.active) return;
  const reason = event.reason;
  record({
    level: 'error',
    kind: 'unhandledrejection',
    msg: truncate(`Unhandled rejection: ${formatValue(reason)}`, MAX_MESSAGE_CHARS),
    ...(reason instanceof Error && reason.stack ? { stack: truncate(reason.stack, MAX_MESSAGE_CHARS) } : {}),
  });
};

const uploadUrl = () => ingressAware('api/debug/client-logs');

const uploadBatch = async (realFetch: typeof window.fetch, sessionId: string): Promise<void> => {
  const entries = queue.take(UPLOAD_BATCH_SIZE);
  try {
    const res = await realFetch(uploadUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, entries, dropped: queue.dropped }),
    });
    if (res.ok) {
      const body = (await res.json()) as { active?: boolean };
      if (body.active === false) deactivate();
    } else {
      queue.markDropped(entries.length);
    }
  } catch {
    queue.markDropped(entries.length);
  }
};

/** Upload one batch; while an upload is in flight, returns that upload's promise. */
const flush = (): Promise<void> => {
  if (inFlight) return inFlight;
  if (!originalFetch || !state.sessionId) return Promise.resolve();
  if (queue.size === 0 && queue.dropped === 0) return Promise.resolve();
  inFlight = uploadBatch(originalFetch, state.sessionId).finally(() => {
    inFlight = null;
  });
  return inFlight;
};

const scheduledFlush = async () => {
  await flush();
  if (state.active && queue.size >= UPLOAD_BATCH_SIZE) await flush();
};

const flushWithBeacon = () => {
  if (!state.active || !state.sessionId || queue.size === 0 || typeof navigator.sendBeacon !== 'function') return;
  const entries = queue.take(UPLOAD_BATCH_SIZE);
  const payload = JSON.stringify({ sessionId: state.sessionId, entries, dropped: queue.dropped });
  if (!navigator.sendBeacon(uploadUrl(), new Blob([payload], { type: 'application/json' }))) {
    queue.markDropped(entries.length);
  }
};

const syncStatus = async () => {
  try {
    const status = await fetchDebugStatus();
    if (!status.active) deactivate();
  } catch {
    // Backend unreachable; keep capturing and retry on the next poll.
  }
};

const activate = (status: DebugStatus) => {
  if (!status.active || !status.sessionId) return;
  const isNewSession = status.sessionId !== state.sessionId;
  if (isNewSession) queue.reset();
  setState({ active: true, sessionId: status.sessionId, expiresAt: status.expiresAt });
  if (!flushTimer) flushTimer = setInterval(() => void scheduledFlush(), FLUSH_INTERVAL_MS);
  if (!pollTimer) pollTimer = setInterval(() => void syncStatus(), STATUS_POLL_MS);
  if (isNewSession) {
    record({ level: 'info', kind: 'marker', msg: 'Browser capture started', page: stripQuery(window.location.pathname) });
    record({ level: 'info', kind: 'marker', msg: `User agent: ${navigator.userAgent}; viewport ${window.innerWidth}x${window.innerHeight}` });
  }
};

const deactivate = () => {
  if (flushTimer) clearInterval(flushTimer);
  if (pollTimer) clearInterval(pollTimer);
  flushTimer = null;
  pollTimer = null;
  queue.reset();
  if (state.active) setState({ active: false, sessionId: null, expiresAt: null });
};

/** Install the (inactive) hooks once; safe to call repeatedly. */
export const installDebugCapture = () => {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  originalFetch = window.fetch.bind(window);
  window.fetch = capturedFetch;
  wrapConsole();
  window.addEventListener('error', onWindowError);
  window.addEventListener('unhandledrejection', onUnhandledRejection);
  window.addEventListener('pagehide', flushWithBeacon);
};

/** Resume capture after a page load if the server session is still active. */
export const resumeDebugCaptureIfActive = async () => {
  try {
    const status = await fetchDebugStatus();
    if (status.active) {
      activate(status);
      record({ level: 'info', kind: 'marker', msg: 'Page loaded; browser capture resumed' });
    }
  } catch {
    // Debug API unavailable (e.g. older backend); stay inactive.
  }
};

export const startDebugCapture = async (): Promise<DebugStatus> => {
  const status = await startDebugSessionRequest();
  activate(status);
  return status;
};

export const stopDebugCapture = async (): Promise<DebugStatus> => {
  if (state.active) {
    record({ level: 'info', kind: 'marker', msg: 'Browser capture stopping' });
    // Wait for any upload in flight, then upload what is still buffered,
    // before the server stops accepting client logs.
    await drainPending(flush, () => queue.size);
  }
  const status = await stopDebugSessionRequest();
  deactivate();
  return status;
};

/** Record a WebSocket lifecycle event (open/close/error/reconnect only). */
export const recordWebSocketEvent = (event: 'open' | 'close' | 'error' | 'reconnect', detail?: string) => {
  if (!state.active) return;
  record({
    level: event === 'error' ? 'warn' : 'info',
    kind: 'websocket',
    event,
    msg: `WebSocket ${event}${detail ? `: ${truncate(detail, 500)}` : ''}`,
  });
};

/** Record an in-app navigation (view change). */
export const recordNavigation = (view: string) => {
  if (!state.active) return;
  record({ level: 'info', kind: 'navigation', msg: `View: ${view}` });
};

export const getDebugCaptureState = (): DebugCaptureState => state;

export const subscribeDebugCapture = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
