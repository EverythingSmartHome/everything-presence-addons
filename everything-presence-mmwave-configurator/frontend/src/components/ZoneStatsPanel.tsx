import React from 'react';
import { HeatmapResponse } from '../api/types';
import { HeatmapLegend } from './HeatmapLegend';

interface ZoneStatsPanelProps {
  data: HeatmapResponse | null;
  visible: boolean;
}

export const ZoneStatsPanel: React.FC<ZoneStatsPanelProps> = ({ data, visible }) => {
  if (!visible || !data?.zoneStats || data.zoneStats.length === 0) {
    return null;
  }

  const { zoneStats, stats } = data;

  // Sort by percentage descending
  const sortedStats = [...zoneStats].sort((a, b) => b.percentage - a.percentage);

  // Format time range
  const formatTimeRange = () => {
    const start = new Date(stats.timeRange.start);
    const end = new Date(stats.timeRange.end);
    const hours = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60));

    if (hours < 24) {
      return `Last ${hours} hour${hours !== 1 ? 's' : ''}`;
    }
    const days = Math.round(hours / 24);
    return `Last ${days} day${days !== 1 ? 's' : ''}`;
  };

  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur p-4 text-sm text-slate-200 shadow-xl">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">🔥</span>
          <span className="font-semibold text-white">Zone Occupancy</span>
        </div>
        <span className="text-xs text-slate-400">{formatTimeRange()}</span>
      </div>

      {/* Color Legend */}
      <div className="mb-3 flex justify-center">
        <HeatmapLegend visible={true} />
      </div>

      {!stats.dataAvailable ? (
        <div className="text-xs text-slate-400 text-center py-2">
          No history data available
        </div>
      ) : (
        <>
          <div className="space-y-2.5">
            {sortedStats.map((stat, idx) => {
              const isNoZone = stat.zoneId === '__no_zone__';

              // Use gray for "No Zone", colored gradient for regular zones
              const barColor = isNoZone
                ? 'bg-gradient-to-r from-slate-500 to-slate-400'
                : stat.percentage > 50
                ? 'bg-gradient-to-r from-orange-500 to-red-500'
                : stat.percentage > 25
                ? 'bg-gradient-to-r from-yellow-500 to-orange-500'
                : 'bg-gradient-to-r from-blue-500 to-cyan-500';

              return (
                <div key={`${stat.zoneId}-${idx}`}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span
                      className={`truncate max-w-[120px] ${isNoZone ? 'text-slate-400 italic' : 'text-slate-300'}`}
                      title={stat.zoneName}
                    >
                      {stat.zoneName}
                    </span>
                    <span className="text-slate-400 font-mono">
                      {stat.percentage.toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${barColor} rounded-full transition-all duration-500`}
                      style={{ width: `${Math.min(100, stat.percentage)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-3 pt-3 border-t border-slate-700/50 flex items-center justify-between text-[10px] text-slate-500">
            <span>{stats.totalSamples.toLocaleString()} samples</span>
            <span>Peak: {stats.maxCount.toLocaleString()}</span>
          </div>
        </>
      )}
    </div>
  );
};
