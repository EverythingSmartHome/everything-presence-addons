import React, { useMemo } from 'react';
import { HourlyBreakdown } from '../api/types';

interface HourlyActivityChartProps {
  data: HourlyBreakdown[] | undefined;
  visible: boolean;
}

export const HourlyActivityChart: React.FC<HourlyActivityChartProps> = ({ data, visible }) => {
  if (!visible || !data || data.length === 0) {
    return null;
  }

  // Find max percentage for scaling
  const maxPercentage = useMemo(() => {
    return Math.max(...data.map(d => d.percentage), 1);
  }, [data]);

  // Format hour for display (e.g., "12am", "3pm")
  const formatHour = (hour: number): string => {
    if (hour === 0) return '12a';
    if (hour === 12) return '12p';
    if (hour < 12) return `${hour}a`;
    return `${hour - 12}p`;
  };

  // Get color based on percentage (matches heatmap gradient)
  const getBarColor = (percentage: number): string => {
    const t = percentage / maxPercentage;
    if (t < 0.33) {
      return 'bg-gradient-to-t from-green-600 to-green-400';
    } else if (t < 0.66) {
      return 'bg-gradient-to-t from-yellow-600 to-yellow-400';
    } else {
      return 'bg-gradient-to-t from-orange-600 to-red-400';
    }
  };

  // Find peak hours
  const sortedByActivity = [...data].sort((a, b) => b.percentage - a.percentage);
  const peakHour = sortedByActivity[0];
  const quietHour = sortedByActivity[sortedByActivity.length - 1];

  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur p-4 text-sm text-slate-200 shadow-xl">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">📊</span>
          <span className="font-semibold text-white">Hourly Activity</span>
        </div>
      </div>

      {/* Bar chart */}
      <div className="flex items-end justify-between h-20 gap-0.5 mb-2">
        {data.map((hourData) => {
          const height = maxPercentage > 0 ? (hourData.percentage / maxPercentage) * 100 : 0;
          const barColor = getBarColor(hourData.percentage);
          const isPeak = hourData.hour === peakHour.hour && hourData.percentage > 0;

          return (
            <div
              key={hourData.hour}
              className="flex-1 flex flex-col items-center justify-end h-full group relative"
            >
              {/* Tooltip on hover */}
              <div className="absolute bottom-full mb-1 hidden group-hover:block z-10">
                <div className="bg-slate-800 text-xs text-slate-200 px-2 py-1 rounded shadow-lg whitespace-nowrap">
                  <div className="font-semibold">{formatHour(hourData.hour)}</div>
                  <div>{hourData.percentage.toFixed(1)}%</div>
                  <div className="text-slate-400">{hourData.count.toLocaleString()} samples</div>
                </div>
              </div>

              {/* Bar */}
              <div
                className={`w-full rounded-t transition-all duration-300 ${barColor} ${isPeak ? 'ring-1 ring-white/40' : ''}`}
                style={{ height: `${Math.max(height, 2)}%`, minHeight: hourData.count > 0 ? '2px' : '0' }}
              />
            </div>
          );
        })}
      </div>

      {/* Hour labels (show every 3 hours) */}
      <div className="flex justify-between text-[9px] text-slate-500 px-0.5">
        {[0, 3, 6, 9, 12, 15, 18, 21].map((hour) => (
          <span key={hour} className="w-6 text-center">
            {formatHour(hour)}
          </span>
        ))}
      </div>

      {/* Summary stats */}
      <div className="mt-3 pt-3 border-t border-slate-700/50 flex items-center justify-between text-[10px]">
        <div className="text-slate-400">
          <span className="text-orange-400">▲</span> Peak: {formatHour(peakHour.hour)} ({peakHour.percentage.toFixed(1)}%)
        </div>
        <div className="text-slate-400">
          <span className="text-blue-400">▼</span> Quiet: {formatHour(quietHour.hour)} ({quietHour.percentage.toFixed(1)}%)
        </div>
      </div>
    </div>
  );
};
