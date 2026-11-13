import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEVICE_LOG_LEVELS,
  type DeviceIdentity,
  type DeviceLogLevel,
  type DeviceLogServerMessage,
  deviceLogsWsUrl,
  fetchDeviceApiConnection,
  updateDeviceApiConnection,
} from '../api/deviceLogs';

/**
 * Live device log viewer. The device connection exists only while this modal
 * is open: opening it starts a session, closing it (or the tab) ends it.
 * Lines live only in this component's memory, capped at MAX_LINES.
 */

const MAX_LINES = 5000;

interface LogLine {
  id: number;
  ts: string;
  level: string;
  tag: string | null;
  msg: string;
}

type ConnState =
  | { kind: 'idle' }
  | { kind: 'resolving' }
  | { kind: 'connecting'; host: string; encrypted: boolean }
  | { kind: 'connected'; host: string; hostSource: 'ha' | 'manual' | null; encrypted: boolean; device: DeviceIdentity }
  | { kind: 'closed'; message: string }
  | { kind: 'error'; code: string; message: string; needs?: 'host' | 'key' | 'remove_key' };

const LEVEL_CLASSES: Record<string, string> = {
  ERROR: 'text-rose-400',
  WARN: 'text-amber-300',
  INFO: 'text-emerald-300',
  CONFIG: 'text-fuchsia-300',
  DEBUG: 'text-sky-300',
  VERBOSE: 'text-slate-400',
  VERY_VERBOSE: 'text-slate-500',
  STATE: 'text-teal-300',
};

const LEVEL_LETTER: Record<string, string> = {
  ERROR: 'E',
  WARN: 'W',
  INFO: 'I',
  CONFIG: 'C',
  DEBUG: 'D',
  VERBOSE: 'V',
  VERY_VERBOSE: 'VV',
  STATE: 'S',
};

const formatTime = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleTimeString([], { hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0')}`;
};

const formatLine = (l: LogLine) => `${formatTime(l.ts)} [${LEVEL_LETTER[l.level] ?? l.level}]${l.tag ? `[${l.tag}]` : ''}: ${l.msg}`;

interface DeviceLogsModalProps {
  isOpen: boolean;
  onClose: () => void;
  deviceId: string;
  deviceLabel: string;
}

export const DeviceLogsModal: React.FC<DeviceLogsModalProps> = ({ isOpen, onClose, deviceId, deviceLabel }) => {
  const [conn, setConn] = useState<ConnState>({ kind: 'idle' });
  const [lines, setLines] = useState<LogLine[]>([]);
  const [level, setLevel] = useState<DeviceLogLevel>('DEBUG');
  const [filter, setFilter] = useState('');
  const [paused, setPaused] = useState(false);
  const [showStates, setShowStates] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [dropped, setDropped] = useState(0);
  const [session, setSession] = useState(0); // bump to reconnect

  const wsRef = useRef<WebSocket | null>(null);
  const pendingRef = useRef<LogLine[]>([]);
  const pausedRef = useRef(paused);
  const levelRef = useRef(level);
  const showStatesRef = useRef(showStates);
  const nextId = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  pausedRef.current = paused;
  levelRef.current = level;
  showStatesRef.current = showStates;

  // Batch incoming lines into one state update per animation frame.
  const flushScheduled = useRef(false);
  const scheduleFlush = useCallback(() => {
    if (flushScheduled.current) return;
    flushScheduled.current = true;
    requestAnimationFrame(() => {
      flushScheduled.current = false;
      if (pausedRef.current || pendingRef.current.length === 0) return;
      const batch = pendingRef.current;
      pendingRef.current = [];
      setLines((prev) => {
        const next = prev.concat(batch);
        return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
      });
    });
  }, []);

  useEffect(() => {
    if (!paused) scheduleFlush();
  }, [paused, scheduleFlush]);

  // One device session per open modal (and per explicit reconnect).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `session` is bumped by Reconnect to restart this effect.
  useEffect(() => {
    if (!isOpen) return undefined;
    setConn({ kind: 'resolving' });
    setDropped(0);
    const ws = new WebSocket(deviceLogsWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'start', deviceId, level: levelRef.current, states: showStatesRef.current }));
    };
    ws.onmessage = (event) => {
      let msg: DeviceLogServerMessage;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      switch (msg.type) {
        case 'log':
          pendingRef.current.push({ id: nextId.current++, ts: msg.ts, level: msg.level, tag: msg.tag, msg: msg.msg });
          if (pendingRef.current.length > MAX_LINES) pendingRef.current.splice(0, pendingRef.current.length - MAX_LINES);
          scheduleFlush();
          break;
        case 'dropped':
          setDropped((d) => d + msg.count);
          break;
        case 'error':
          setConn({ kind: 'error', code: msg.code, message: msg.message, needs: msg.needs });
          break;
        case 'status':
          if (msg.state === 'resolving') setConn({ kind: 'resolving' });
          else if (msg.state === 'connecting') setConn({ kind: 'connecting', host: msg.host, encrypted: msg.encrypted });
          else if (msg.state === 'connected')
            setConn({
              kind: 'connected',
              host: msg.host,
              hostSource: msg.hostSource,
              encrypted: msg.encrypted,
              device: msg.device,
            });
          else if (msg.state === 'closed' && msg.reason !== 'stopped') setConn({ kind: 'closed', message: msg.message });
          break;
        default:
      }
    };
    ws.onclose = () => {
      setConn((c) =>
        c.kind === 'connected' || c.kind === 'connecting' || c.kind === 'resolving'
          ? { kind: 'closed', message: 'Lost connection to the add-on.' }
          : c,
      );
    };

    return () => {
      ws.onclose = null;
      ws.onmessage = null;
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'stop' }));
      ws.close();
      wsRef.current = null;
    };
  }, [isOpen, deviceId, session, scheduleFlush]);

  // Clear everything when the modal closes; nothing is kept.
  useEffect(() => {
    if (!isOpen) {
      setLines([]);
      pendingRef.current = [];
      setConn({ kind: 'idle' });
    }
  }, [isOpen]);

  const changeLevel = (next: DeviceLogLevel) => {
    setLevel(next);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'set_level', level: next }));
    }
  };

  // Hiding STATE lines also stops the add-on sending them, so they don't use up
  // the line limit; lines already shown are hidden by the filter below.
  const changeShowStates = (next: boolean) => {
    setShowStates(next);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'set_states', show: next }));
    }
  };

  // Also drop lines queued while paused, or they would reappear on Resume.
  const clear = () => {
    pendingRef.current = [];
    setLines([]);
  };

  const reconnect = () => setSession((s) => s + 1);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q && showStates) return lines;
    return lines.filter(
      (l) =>
        (showStates || l.level !== 'STATE') &&
        (!q || l.msg.toLowerCase().includes(q) || (l.tag ?? '').toLowerCase().includes(q)),
    );
  }, [lines, filter, showStates]);
  const isFiltered = filter.trim() !== '' || !showStates;

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll after every change to the visible lines.
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [visible, autoScroll]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (atBottom !== autoScroll) setAutoScroll(atBottom);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(visible.map(formatLine).join('\n'));
    } catch {
      // Clipboard may be unavailable inside the HA iframe; download still works.
    }
  };

  const download = () => {
    const header = [
      `# ${deviceLabel}`,
      conn.kind === 'connected' && conn.device.esphomeVersion ? `# ESPHome ${conn.device.esphomeVersion}` : null,
      conn.kind === 'connected' && conn.device.projectVersion ? `# Firmware ${conn.device.projectVersion}` : null,
      `# Saved ${new Date().toISOString()}`,
    ]
      .filter(Boolean)
      .join('\n');
    const blob = new Blob([`${header}\n${visible.map(formatLine).join('\n')}\n`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(conn.kind === 'connected' && conn.device.name) || 'device'}-logs-${new Date()
      .toISOString()
      .replace(/\..+/, '')
      .replace(/[:T]/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-2 sm:p-4">
      <div className="flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-700 px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-white">Device Logs</h3>
            <p className="mt-0.5 truncate text-xs text-slate-400">
              {deviceLabel}
              {conn.kind === 'connected' && (
                <>
                  {' • '}
                  {conn.host}
                  {conn.device.esphomeVersion && ` • ESPHome ${conn.device.esphomeVersion}`}
                  {conn.device.projectVersion && ` • Firmware ${conn.device.projectVersion}`}
                  {conn.encrypted && ' • 🔒'}
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusPill conn={conn} />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
            >
              <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-5 py-2.5 text-xs">
          <label className="flex items-center gap-1.5 text-slate-400">
            Level
            <select
              value={level}
              onChange={(e) => changeLevel(e.target.value as DeviceLogLevel)}
              className="rounded-lg border border-slate-600 bg-slate-800 px-2 py-1 text-slate-100 focus:border-aqua-500 focus:outline-none"
            >
              {DEVICE_LOG_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l.replace('_', ' ')}
                </option>
              ))}
            </select>
          </label>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter text or tag…"
            className="min-w-[10rem] flex-1 rounded-lg border border-slate-600 bg-slate-800 px-2 py-1 text-slate-100 placeholder:text-slate-500 focus:border-aqua-500 focus:outline-none"
          />
          <label
            className="flex items-center gap-1.5 text-slate-400"
            title="Entity state changes ([S] lines), as the ESPHome dashboard shows them"
          >
            <input
              type="checkbox"
              checked={showStates}
              onChange={(e) => changeShowStates(e.target.checked)}
              className="accent-aqua-500"
            />
            States
          </label>
          <ToolbarButton onClick={() => setPaused((p) => !p)} active={paused}>
            {paused ? `Resume${pendingRef.current.length ? ` (${pendingRef.current.length})` : ''}` : 'Pause'}
          </ToolbarButton>
          <ToolbarButton onClick={clear}>Clear</ToolbarButton>
          <ToolbarButton onClick={copy} disabled={visible.length === 0}>
            Copy
          </ToolbarButton>
          <ToolbarButton onClick={download} disabled={visible.length === 0}>
            Download
          </ToolbarButton>
          {(conn.kind === 'closed' || conn.kind === 'error') && (
            <ToolbarButton onClick={reconnect} primary>
              Reconnect
            </ToolbarButton>
          )}
        </div>

        {conn.kind === 'error' && (
          <ConnectionProblem deviceId={deviceId} conn={conn} onRetry={reconnect} />
        )}
        {conn.kind === 'closed' && (
          <div className="border-b border-slate-800 bg-slate-800/40 px-5 py-2 text-xs text-slate-300">{conn.message}</div>
        )}
        {dropped > 0 && (
          <div className="border-b border-slate-800 bg-amber-500/10 px-5 py-1.5 text-xs text-amber-200">
            {dropped} lines were skipped because the browser could not keep up.
          </div>
        )}

        {/* Log body */}
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="flex-1 overflow-auto bg-slate-950 px-4 py-3 font-mono text-[12px] leading-5"
        >
          {visible.length === 0 ? (
            <EmptyState conn={conn} level={level} hasFilter={isFiltered && lines.length > 0} />
          ) : (
            visible.map((l) => (
              <div key={l.id} className="whitespace-pre-wrap break-words">
                <span className="text-slate-600">{formatTime(l.ts)} </span>
                <span className={LEVEL_CLASSES[l.level] ?? 'text-slate-300'}>
                  [{LEVEL_LETTER[l.level] ?? l.level}]{l.tag && `[${l.tag}]`}:
                </span>{' '}
                <span className={l.level === 'ERROR' || l.level === 'WARN' ? LEVEL_CLASSES[l.level] : 'text-slate-200'}>
                  {l.msg}
                </span>
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-800 px-5 py-2 text-[11px] text-slate-500">
          <span>
            {lines.length} lines{lines.length >= MAX_LINES ? ` (oldest removed above ${MAX_LINES})` : ''}
            {isFiltered && ` • ${visible.length} shown`}
          </span>
          {!autoScroll && (
            <button type="button" className="text-aqua-400 hover:text-aqua-300" onClick={() => setAutoScroll(true)}>
              Jump to latest ↓
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const ToolbarButton: React.FC<{
  onClick: () => void;
  active?: boolean;
  primary?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}> = ({ onClick, active, primary, disabled, children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`rounded-lg border px-2.5 py-1 font-semibold transition-all active:scale-95 disabled:opacity-40 ${
      primary
        ? 'border-aqua-500 bg-aqua-600/20 text-aqua-100 hover:bg-aqua-600/30'
        : active
          ? 'border-amber-500 bg-amber-600/20 text-amber-100'
          : 'border-slate-700/50 bg-slate-800/50 text-slate-100 hover:border-slate-600 hover:bg-slate-700'
    }`}
  >
    {children}
  </button>
);

const StatusPill: React.FC<{ conn: ConnState }> = ({ conn }) => {
  const map: Record<ConnState['kind'], [string, string]> = {
    idle: ['Idle', 'bg-slate-700/50 text-slate-300'],
    resolving: ['Finding device…', 'bg-sky-500/10 text-sky-300'],
    connecting: ['Connecting…', 'bg-sky-500/10 text-sky-300'],
    connected: ['Live', 'bg-emerald-500/15 text-emerald-300'],
    closed: ['Disconnected', 'bg-slate-700/50 text-slate-300'],
    error: ['Not connected', 'bg-rose-500/15 text-rose-300'],
  };
  const [label, cls] = map[conn.kind];
  return (
    <span className={`flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
      {conn.kind === 'connected' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />}
      {label}
    </span>
  );
};

const EmptyState: React.FC<{ conn: ConnState; level: DeviceLogLevel; hasFilter: boolean }> = ({ conn, level, hasFilter }) => {
  if (hasFilter) return <p className="text-slate-500">No lines match the filter.</p>;
  if (conn.kind === 'connected') {
    return (
      <div className="space-y-1 text-slate-500">
        <p>Connected. Waiting for log output at {level.replace('_', ' ')} level…</p>
        <p>
          If nothing appears, the device firmware may be built to log errors only. Lines below the level set in the
          firmware are not sent.
        </p>
      </div>
    );
  }
  if (conn.kind === 'resolving' || conn.kind === 'connecting') return <p className="text-slate-500">Connecting to the device…</p>;
  return null;
};

/** Inline fix-up for connection errors: manual host and/or encryption key. */
const ConnectionProblem: React.FC<{
  deviceId: string;
  conn: Extract<ConnState, { kind: 'error' }>;
  onRetry: () => void;
}> = ({ deviceId, conn, onRetry }) => {
  const [host, setHost] = useState('');
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ host: string | null; hostSource: string | null; hasKey: boolean } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-read saved settings whenever the error changes.
  useEffect(() => {
    fetchDeviceApiConnection(deviceId)
      .then((v) => {
        setSaved(v);
        if (v.hostSource === 'manual' && v.host) setHost(v.host);
      })
      .catch(() => setSaved(null));
  }, [deviceId, conn.code]);

  const save = async (update: { manualHost?: string | null; encryptionKey?: string | null }) => {
    setSaving(true);
    setFormError(null);
    try {
      await updateDeviceApiConnection(deviceId, update);
      setKey('');
      onRetry();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    'flex-1 min-w-[12rem] rounded-lg border border-slate-600 bg-slate-800 px-2 py-1 text-slate-100 placeholder:text-slate-500 focus:border-aqua-500 focus:outline-none';

  return (
    <div className="space-y-2 border-b border-slate-800 bg-rose-500/5 px-5 py-3 text-xs">
      <p className="text-rose-200">{conn.message}</p>

      {conn.needs === 'key' && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save({ encryptionKey: key });
          }}
        >
          <input
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="API encryption key (from the device YAML: api → encryption → key)"
            className={inputCls}
          />
          <ToolbarButton onClick={() => void save({ encryptionKey: key })} primary disabled={saving || !key.trim()}>
            Save key & connect
          </ToolbarButton>
        </form>
      )}

      {conn.needs === 'remove_key' && (
        <ToolbarButton onClick={() => void save({ encryptionKey: null })} primary disabled={saving}>
          Remove saved key & connect
        </ToolbarButton>
      )}

      {conn.needs === 'host' && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save({ manualHost: host });
          }}
        >
          <input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="Device IP address or hostname, e.g. 192.168.1.50"
            className={inputCls}
          />
          <ToolbarButton onClick={() => void save({ manualHost: host })} primary disabled={saving || !host.trim()}>
            Use this address
          </ToolbarButton>
          {saved?.hostSource === 'manual' && (
            <ToolbarButton onClick={() => void save({ manualHost: null })} disabled={saving}>
              Use Home Assistant's address
            </ToolbarButton>
          )}
        </form>
      )}

      {saved?.hasKey && conn.needs !== 'remove_key' && conn.needs !== 'key' && (
        <p className="text-slate-400">An encryption key is saved for this device.</p>
      )}
      {formError && <p className="text-rose-300">{formError}</p>}
    </div>
  );
};
