import React, { useEffect, useRef } from 'react';

interface DataPoint {
  value: number;
  timestamp: number;
}

interface EP1MiniChartsProps {
  temperature: number | null;
  presence: boolean;
  distance: number | null;
  maxPoints?: number;
}

// Simple sparkline SVG component
const Sparkline: React.FC<{
  data: number[];
  color: string;
  height?: number;
  showArea?: boolean;
}> = ({ data, color, height = 32, showArea = true }) => {
  if (data.length < 2) {
    return (
      <div className="h-8 flex items-center justify-center text-[10px] text-slate-600">
        Collecting data...
      </div>
    );
  }

  const width = 200;
  const padding = 2;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data.map((value, index) => {
    const x = padding + (index / (data.length - 1)) * (width - padding * 2);
    const y = height - padding - ((value - min) / range) * (height - padding * 2);
    return `${x},${y}`;
  });

  const pathD = `M ${points.join(' L ')}`;
  const areaD = `M ${padding},${height - padding} L ${pathD.slice(2)} L ${width - padding},${height - padding} Z`;

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      {showArea && (
        <path d={areaD} fill={color} fillOpacity="0.1" />
      )}
      <path d={pathD} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* Current value dot */}
      <circle
        cx={width - padding}
        cy={height - padding - ((data[data.length - 1] - min) / range) * (height - padding * 2)}
        r="3"
        fill={color}
      />
    </svg>
  );
};

// Presence timeline (binary on/off blocks)
const PresenceTimeline: React.FC<{ data: boolean[]; height?: number }> = ({ data, height = 24 }) => {
  if (data.length < 2) {
    return (
      <div className="h-6 flex items-center justify-center text-[10px] text-slate-600">
        Collecting data...
      </div>
    );
  }

  const width = 200;

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      {data.map((present, index) => {
        const blockWidth = width / data.length;
        return (
          <rect
            key={index}
            x={index * blockWidth}
            y={2}
            width={blockWidth}
            height={height - 4}
            fill={present ? '#10b981' : '#334155'}
            rx={1}
          />
        );
      })}
    </svg>
  );
};

export const EP1MiniCharts: React.FC<EP1MiniChartsProps> = ({
  temperature,
  presence,
  distance,
  maxPoints = 60,
}) => {
  const [collapsed, setCollapsed] = React.useState(false);

  // Store history in refs to persist across renders
  const tempHistory = useRef<DataPoint[]>([]);
  const presenceHistory = useRef<boolean[]>([]);
  const distanceHistory = useRef<DataPoint[]>([]);
  const lastUpdate = useRef<number>(0);

  // Update trigger for re-render
  const [, forceUpdate] = React.useState(0);

  useEffect(() => {
    const now = Date.now();

    // Only update once per second to avoid too many data points
    if (now - lastUpdate.current < 1000) return;
    lastUpdate.current = now;

    // Add temperature
    if (temperature !== null) {
      tempHistory.current.push({ value: temperature, timestamp: now });
      if (tempHistory.current.length > maxPoints) {
        tempHistory.current.shift();
      }
    }

    // Add presence
    presenceHistory.current.push(presence);
    if (presenceHistory.current.length > maxPoints) {
      presenceHistory.current.shift();
    }

    // Add distance
    if (distance !== null && distance > 0) {
      distanceHistory.current.push({ value: distance, timestamp: now });
      if (distanceHistory.current.length > maxPoints) {
        distanceHistory.current.shift();
      }
    }

    forceUpdate((n) => n + 1);
  }, [temperature, presence, distance, maxPoints]);

  // Extract values for sparklines
  const tempValues = tempHistory.current.map((p) => p.value);
  const distanceValues = distanceHistory.current.map((p) => p.value);

  // Calculate min/max for display
  const tempMin = tempValues.length > 0 ? Math.min(...tempValues).toFixed(1) : '--';
  const tempMax = tempValues.length > 0 ? Math.max(...tempValues).toFixed(1) : '--';
  const distMin = distanceValues.length > 0 ? Math.min(...distanceValues).toFixed(2) : '--';
  const distMax = distanceValues.length > 0 ? Math.max(...distanceValues).toFixed(2) : '--';

  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-4">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between text-sm font-semibold text-slate-200 hover:text-white transition-colors"
      >
        <span>Recent Trends</span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500 font-normal">Last {maxPoints}s</span>
          <span className={`text-slate-500 transition-transform ${collapsed ? '' : 'rotate-180'}`}>▲</span>
        </div>
      </button>

      {!collapsed && (
        <>
      <div className="space-y-4 mt-3">
        {/* Temperature Chart */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1.5">
              <span className="text-sm">🌡️</span>
              <span className="text-xs text-slate-400">Temperature</span>
            </div>
            <div className="text-[10px] text-slate-500">
              {tempMin}° - {tempMax}°C
            </div>
          </div>
          <div className="bg-slate-800/50 rounded-lg p-2">
            <Sparkline data={tempValues} color="#f97316" height={32} />
          </div>
        </div>

        {/* Presence Timeline */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1.5">
              <span className="text-sm">👤</span>
              <span className="text-xs text-slate-400">Presence</span>
            </div>
            <div className="flex items-center gap-2 text-[10px]">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-emerald-500"></span>
                <span className="text-slate-500">Present</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-slate-600"></span>
                <span className="text-slate-500">Clear</span>
              </span>
            </div>
          </div>
          <div className="bg-slate-800/50 rounded-lg p-2">
            <PresenceTimeline data={presenceHistory.current} height={24} />
          </div>
        </div>

        {/* Distance Chart (if available) */}
        {distanceValues.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <span className="text-sm">📏</span>
                <span className="text-xs text-slate-400">Distance</span>
              </div>
              <div className="text-[10px] text-slate-500">
                {distMin} - {distMax}m
              </div>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-2">
              <Sparkline data={distanceValues} color="#06b6d4" height={32} />
            </div>
          </div>
        )}
      </div>

      {/* Data info */}
      <div className="mt-3 pt-2 border-t border-slate-700/50 text-[10px] text-slate-500 text-center">
        {tempHistory.current.length} temperature samples •{' '}
        {presenceHistory.current.length} presence samples
      </div>
        </>
      )}
    </div>
  );
};
