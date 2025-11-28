import React, { useEffect, useRef, useState } from 'react';
import { DailyStats, createEmptyStats, getStatsKey, getTodayDateString } from './ep1Utils';

interface EP1StatsPanelProps {
  deviceId: string;
  presence: boolean;
  temperature: number | null;
}

export const EP1StatsPanel: React.FC<EP1StatsPanelProps> = ({
  deviceId,
  presence,
  temperature,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const [stats, setStats] = useState<DailyStats | null>(null);
  const lastUpdateTime = useRef<number>(Date.now());
  const wasPresent = useRef<boolean>(presence);

  // Load stats from localStorage on mount
  useEffect(() => {
    const today = getTodayDateString();
    const key = getStatsKey(deviceId, today);
    const stored = localStorage.getItem(key);

    if (stored) {
      try {
        const parsed = JSON.parse(stored) as DailyStats;
        // Check if it's from today
        if (parsed.date === today) {
          setStats(parsed);
        } else {
          // New day, create fresh stats
          setStats(createEmptyStats(deviceId, today));
        }
      } catch {
        setStats(createEmptyStats(deviceId, today));
      }
    } else {
      setStats(createEmptyStats(deviceId, today));
    }
  }, [deviceId]);

  // Update stats on each render
  useEffect(() => {
    if (!stats) return;

    const now = Date.now();
    const elapsed = (now - lastUpdateTime.current) / 1000; // seconds

    // Only update every second
    if (elapsed < 1) return;

    const today = getTodayDateString();

    // Check for day change
    if (stats.date !== today) {
      const newStats = createEmptyStats(deviceId, today);
      setStats(newStats);
      localStorage.setItem(getStatsKey(deviceId, today), JSON.stringify(newStats));
      lastUpdateTime.current = now;
      return;
    }

    // Update stats
    const newStats = { ...stats };
    newStats.totalSeconds += elapsed;

    // Track occupancy time
    if (presence) {
      newStats.occupancySeconds += elapsed;
    }

    // Track presence change events
    if (presence !== wasPresent.current) {
      if (presence) {
        newStats.detectionEvents += 1;
      }
      wasPresent.current = presence;
    }

    // Track temperature
    if (temperature !== null) {
      newStats.tempSum += temperature;
      newStats.tempCount += 1;
      if (newStats.tempMin === null || temperature < newStats.tempMin) {
        newStats.tempMin = temperature;
      }
      if (newStats.tempMax === null || temperature > newStats.tempMax) {
        newStats.tempMax = temperature;
      }
    }

    newStats.lastUpdate = now;
    lastUpdateTime.current = now;

    setStats(newStats);

    // Save to localStorage every 10 seconds
    if (Math.floor(newStats.totalSeconds) % 10 === 0) {
      localStorage.setItem(getStatsKey(deviceId, today), JSON.stringify(newStats));
    }
  }, [deviceId, presence, temperature, stats]);

  // Save on unmount
  useEffect(() => {
    return () => {
      if (stats) {
        localStorage.setItem(getStatsKey(deviceId, stats.date), JSON.stringify(stats));
      }
    };
  }, [deviceId, stats]);

  if (!stats) {
    return (
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-4">
        <div className="text-sm font-semibold text-slate-200 mb-2">Today's Statistics</div>
        <div className="text-xs text-slate-500">Loading stats...</div>
      </div>
    );
  }

  // Calculate derived values
  const occupancyPercent = stats.totalSeconds > 0
    ? Math.round((stats.occupancySeconds / stats.totalSeconds) * 100)
    : 0;
  const avgTemp = stats.tempCount > 0
    ? (stats.tempSum / stats.tempCount).toFixed(1)
    : '--';
  const trackingDuration = formatTrackingDuration(stats.totalSeconds);

  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-4">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between text-sm font-semibold text-slate-200 hover:text-white transition-colors"
      >
        <span>Today's Statistics</span>
        <div className="flex items-center gap-2">
          <span
            onClick={(e) => {
              e.stopPropagation();
              const today = getTodayDateString();
              const newStats = createEmptyStats(deviceId, today);
              setStats(newStats);
              localStorage.setItem(getStatsKey(deviceId, today), JSON.stringify(newStats));
            }}
            className="text-[10px] text-slate-500 hover:text-slate-400 transition-colors font-normal"
            title="Reset today's stats"
          >
            Reset
          </span>
          <span className={`text-slate-500 transition-transform ${collapsed ? '' : 'rotate-180'}`}>▲</span>
        </div>
      </button>

      {!collapsed && (
        <>
      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3 mt-3">
        {/* Occupancy Percentage */}
        <div className="bg-slate-800/50 rounded-lg p-3">
          <div className="text-[10px] text-slate-500 mb-1">Occupancy</div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold text-emerald-400">{occupancyPercent}</span>
            <span className="text-sm text-slate-500">%</span>
          </div>
          <div className="mt-2 h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all duration-500"
              style={{ width: `${occupancyPercent}%` }}
            />
          </div>
        </div>

        {/* Detection Events */}
        <div className="bg-slate-800/50 rounded-lg p-3">
          <div className="text-[10px] text-slate-500 mb-1">Detection Events</div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold text-blue-400">{stats.detectionEvents}</span>
            <span className="text-xs text-slate-500">times</span>
          </div>
          <div className="text-[10px] text-slate-500 mt-2">
            Presence triggered today
          </div>
        </div>

        {/* Average Temperature */}
        <div className="bg-slate-800/50 rounded-lg p-3">
          <div className="text-[10px] text-slate-500 mb-1">Avg Temperature</div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold text-orange-400">{avgTemp}</span>
            <span className="text-sm text-slate-500">°C</span>
          </div>
          <div className="text-[10px] text-slate-500 mt-2">
            {stats.tempMin !== null && stats.tempMax !== null
              ? `${stats.tempMin.toFixed(1)}° - ${stats.tempMax.toFixed(1)}°`
              : 'Min - Max'}
          </div>
        </div>

        {/* Tracking Duration */}
        <div className="bg-slate-800/50 rounded-lg p-3">
          <div className="text-[10px] text-slate-500 mb-1">Tracking Time</div>
          <div className="text-lg font-bold text-slate-300">{trackingDuration}</div>
          <div className="text-[10px] text-slate-500 mt-2">
            Since page loaded
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-3 pt-2 border-t border-slate-700/50 text-[10px] text-slate-500 text-center">
        Stats for {new Date().toLocaleDateString()} • Stored locally
      </div>
        </>
      )}
    </div>
  );
};

function formatTrackingDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  } else if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    return `${mins}m`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  }
}
