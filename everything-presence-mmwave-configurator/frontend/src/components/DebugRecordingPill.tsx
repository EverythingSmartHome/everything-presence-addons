import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { getDebugCaptureState, stopDebugCapture, subscribeDebugCapture } from '../debug/debugCapture';
import { formatRemaining } from '../utils/debugCaptureUtils';

/** Global indicator shown on every page while a debug session is recording. */
export const DebugRecordingPill: React.FC = () => {
  const capture = useSyncExternalStore(subscribeDebugCapture, getDebugCaptureState);
  const [now, setNow] = useState(() => Date.now());
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    if (!capture.active) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [capture.active]);

  if (!capture.active) return null;

  const remaining = capture.expiresAt ? Date.parse(capture.expiresAt) - now : 0;

  const handleStop = async () => {
    setStopping(true);
    try {
      await stopDebugCapture();
    } catch {
      // The pill stays visible; the status poll will reconcile.
    } finally {
      setStopping(false);
    }
  };

  return (
    <div
      role="status"
      className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-full border border-rose-500/60 bg-slate-900/95 px-4 py-2 text-sm text-rose-100 shadow-lg"
    >
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
      </span>
      <span>
        Recording debug session
        {remaining > 0 && <span className="ml-1 text-rose-200/70">· {formatRemaining(remaining)} left</span>}
      </span>
      <button
        type="button"
        onClick={handleStop}
        disabled={stopping}
        className="rounded-full border border-rose-500/60 bg-rose-600/20 px-3 py-0.5 text-xs font-semibold text-rose-100 transition-all hover:bg-rose-600/40 disabled:opacity-50"
      >
        {stopping ? 'Stopping…' : 'Stop'}
      </button>
    </div>
  );
};
