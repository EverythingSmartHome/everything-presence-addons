import React from 'react';
import { getCO2Level } from './ep1Utils';

interface EP1CO2PanelProps {
  co2: number | null;
}

export const EP1CO2Panel: React.FC<EP1CO2PanelProps> = ({ co2 }) => {
  if (co2 === null) {
    return null; // Don't render if CO2 sensor not available
  }

  const level = getCO2Level(co2);

  // Calculate gauge percentage (0-3000 ppm range)
  const gaugePercent = Math.min(100, (co2 / 3000) * 100);

  return (
    <div className={`rounded-xl border ${level.borderColor} ${level.bgColor} p-4`}>
      <div className="flex items-center gap-2 mb-2">
        <div className="text-2xl">🌬️</div>
        <div className="text-xs font-semibold text-slate-200/70 uppercase tracking-wide">CO2</div>
      </div>

      {/* Value and Label */}
      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-3xl font-bold text-slate-100">{Math.round(co2)}</span>
        <span className="text-sm text-slate-400">ppm</span>
      </div>

      {/* Gauge Bar */}
      <div className="relative h-2 bg-slate-700/50 rounded-full overflow-hidden mb-2">
        <div
          className={`absolute left-0 top-0 h-full rounded-full transition-all duration-500 ${
            co2 < 800
              ? 'bg-emerald-500'
              : co2 < 1000
              ? 'bg-yellow-500'
              : co2 < 2000
              ? 'bg-orange-500'
              : 'bg-red-500'
          }`}
          style={{ width: `${gaugePercent}%` }}
        />
        {/* Threshold markers */}
        <div className="absolute top-0 h-full w-px bg-slate-600" style={{ left: '26.7%' }} title="800 ppm" />
        <div className="absolute top-0 h-full w-px bg-slate-600" style={{ left: '33.3%' }} title="1000 ppm" />
        <div className="absolute top-0 h-full w-px bg-slate-600" style={{ left: '66.7%' }} title="2000 ppm" />
      </div>

      {/* Status Label */}
      <div className="flex items-center justify-between">
        <span className={`text-sm font-semibold ${level.color}`}>{level.label}</span>
        <span className="text-xs text-slate-500">{level.description}</span>
      </div>
    </div>
  );
};
