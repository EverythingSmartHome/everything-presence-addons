import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  downloadDebugBundle,
  fetchDebugStatus,
  fetchMappingDiagnostics,
  type DebugStatus,
  type MappingDiagnosticsResponse,
} from '../api/debug';
import {
  getDebugCaptureState,
  startDebugCapture,
  stopDebugCapture,
  subscribeDebugCapture,
} from '../debug/debugCapture';
import { formatRemaining } from '../utils/debugCaptureUtils';

const STATUS_LABELS: Record<string, string> = {
  renamed: 'renamed',
  missing: 'missing',
  wrong_device: 'on another device',
  disabled: 'disabled',
  unavailable: 'unavailable',
};

const stopReasonText = (status: DebugStatus): string => {
  switch (status.stopReason) {
    case 'timeout':
      return 'stopped automatically after 30 minutes';
    case 'restart':
      return 'stopped because the add-on restarted';
    case 'user':
      return 'stopped';
    default:
      return '';
  }
};

/** Settings card: start/stop a debug session, check mappings and export a debug bundle. */
export const TroubleshootingCard: React.FC = () => {
  const capture = useSyncExternalStore(subscribeDebugCapture, getDebugCaptureState);
  const [status, setStatus] = useState<DebugStatus | null>(null);
  const [busy, setBusy] = useState<'start' | 'stop' | 'download' | 'diagnostics' | null>(null);
  const [includeNetworkDetails, setIncludeNetworkDetails] = useState(false);
  const [diagnostics, setDiagnostics] = useState<MappingDiagnosticsResponse | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await fetchDebugStatus());
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Failed to load debug status' });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, capture.active]);

  useEffect(() => {
    if (!capture.active) return undefined;
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [capture.active, refresh]);

  const run = async (kind: NonNullable<typeof busy>, action: () => Promise<void>) => {
    setBusy(kind);
    setMessage(null);
    try {
      await action();
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Request failed' });
    } finally {
      setBusy(null);
    }
  };

  const handleStart = () =>
    run('start', async () => {
      setStatus(await startDebugCapture());
    });

  const handleStop = () =>
    run('stop', async () => {
      setStatus(await stopDebugCapture());
      setMessage({ kind: 'success', text: 'Debug session stopped. Download the debug bundle to share it.' });
    });

  const handleDownload = () =>
    run('download', async () => {
      const filename = await downloadDebugBundle(includeNetworkDetails);
      setMessage({ kind: 'success', text: `Saved ${filename}` });
    });

  const handleDiagnostics = () =>
    run('diagnostics', async () => {
      setDiagnostics(await fetchMappingDiagnostics());
    });

  const active = capture.active || Boolean(status?.active);
  const remainingMs = status?.expiresAt ? Date.parse(status.expiresAt) - Date.now() : 0;
  const problemDevices = diagnostics?.diagnostics.devices.filter(
    (d) => d.entities.some((e) => e.status !== 'ok') || d.missingRequiredKeys.length > 0 || d.deviceFound === false,
  );

  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-900/50 p-4 sm:p-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-white">Debug mode</h2>
          <p className="text-sm text-slate-400">
            Record server and browser logs while you reproduce a problem, then download one file to attach to a
            GitHub issue, Discord post or email.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:flex">
          {active ? (
            <button
              onClick={handleStop}
              disabled={busy !== null}
              className="min-w-0 rounded-lg border border-rose-600/50 bg-rose-600/10 px-4 py-2 text-sm font-semibold text-rose-100 transition-all hover:bg-rose-600/20 disabled:opacity-50"
            >
              {busy === 'stop' ? 'Stopping...' : 'Stop recording'}
            </button>
          ) : (
            <button
              onClick={handleStart}
              disabled={busy !== null}
              className="min-w-0 rounded-lg border border-blue-600/50 bg-blue-600/10 px-4 py-2 text-sm font-semibold text-blue-100 transition-all hover:bg-blue-600/20 disabled:opacity-50"
            >
              {busy === 'start' ? 'Starting...' : 'Start debug session'}
            </button>
          )}
        </div>
      </div>

      <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-slate-300">
        <li>Start a debug session (it stops automatically after 30 minutes).</li>
        <li>Reproduce the problem in this browser.</li>
        <li>Stop the session and download the debug bundle.</li>
      </ol>

      <div className="mb-4 rounded-lg border border-slate-700/60 bg-slate-800/40 p-3 text-xs text-slate-300">
        {status ? (
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <span>
              <span className="text-slate-500">State </span>
              {active ? (
                <span className="text-rose-300">Recording{remainingMs > 0 ? ` · ${formatRemaining(remainingMs)} left` : ''}</span>
              ) : status.stoppedAt ? (
                <span>Not recording ({stopReasonText(status)})</span>
              ) : (
                <span>Not recording</span>
              )}
            </span>
            <span>
              <span className="text-slate-500">Server log entries </span>
              {status.server.entries}
              {status.server.dropped > 0 ? ` (${status.server.dropped} oldest dropped)` : ''}
            </span>
            <span>
              <span className="text-slate-500">Browser log entries </span>
              {status.client.entries}
              {status.client.dropped > 0 ? ` (${status.client.dropped} dropped)` : ''}
            </span>
            {status.restarts > 0 && (
              <span className="text-amber-300">Resumed after {status.restarts} add-on restart(s); earlier logs were lost.</span>
            )}
          </div>
        ) : (
          <span className="text-slate-500">Loading debug status...</span>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={includeNetworkDetails}
            onChange={(e) => setIncludeNetworkDetails(e.target.checked)}
            className="h-4 w-4 rounded border-slate-600 bg-slate-700"
          />
          Include IP addresses (private sharing only)
        </label>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <button
            onClick={handleDiagnostics}
            disabled={busy !== null}
            className="min-w-0 rounded-lg border border-slate-600/60 bg-slate-700/30 px-4 py-2 text-sm font-semibold text-slate-100 transition-all hover:bg-slate-700/60 disabled:opacity-50"
          >
            {busy === 'diagnostics' ? 'Checking...' : 'Check entity mappings'}
          </button>
          <button
            onClick={handleDownload}
            disabled={busy !== null}
            className="min-w-0 rounded-lg border border-emerald-600/50 bg-emerald-600/10 px-4 py-2 text-sm font-semibold text-emerald-100 transition-all hover:bg-emerald-600/20 disabled:opacity-50"
          >
            {busy === 'download' ? 'Preparing...' : 'Download debug bundle'}
          </button>
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Tokens, passwords, Wi-Fi names and MAC addresses are always removed. IP addresses are replaced with
        placeholders unless the box above is ticked. The bundle includes your rooms, settings and entity mappings.
      </p>

      {message && (
        <div
          className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
            message.kind === 'error'
              ? 'border-rose-600/50 bg-rose-600/10 text-rose-100'
              : 'border-emerald-600/50 bg-emerald-600/10 text-emerald-100'
          }`}
        >
          {message.text}
        </div>
      )}

      {diagnostics && (
        <div className="mt-4 space-y-2 text-sm">
          {!diagnostics.diagnostics.registryAvailable ? (
            <p className="text-amber-300">Could not read the Home Assistant entity registry, so mappings were not checked.</p>
          ) : problemDevices && problemDevices.length > 0 ? (
            problemDevices.map((device) => (
              <div key={device.deviceId} className="rounded-lg border border-amber-600/40 bg-amber-600/5 p-3">
                <div className="font-semibold text-amber-100">{device.deviceName || device.deviceId}</div>
                {device.deviceFound === false && (
                  <div className="text-xs text-amber-200">Device no longer exists in Home Assistant.</div>
                )}
                {device.missingRequiredKeys.length > 0 && (
                  <div className="text-xs text-amber-200">Required but unmapped: {device.missingRequiredKeys.join(', ')}</div>
                )}
                <ul className="mt-1 space-y-0.5 text-xs text-slate-300">
                  {device.entities
                    .filter((e) => e.status !== 'ok')
                    .map((e) => (
                      <li key={e.key}>
                        <span className="text-slate-400">{e.key}</span>: {e.entityId} is {STATUS_LABELS[e.status] ?? e.status}
                        {e.currentEntityId ? ` (now ${e.currentEntityId})` : ''}
                      </li>
                    ))}
                </ul>
              </div>
            ))
          ) : (
            <p className="text-emerald-300">
              All {diagnostics.diagnostics.deviceCount} mapped device(s) look healthy.
            </p>
          )}
          {diagnostics.errors.length > 0 && (
            <p className="text-xs text-slate-500">
              Some checks were skipped: {diagnostics.errors.map((e) => e.section).join(', ')}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
