import React from 'react';
import { calculateDewPoint, calculateHeatIndex, getComfortLevel } from './ep1Utils';

interface EP1ComfortPanelProps {
  temperature: number | null;
  humidity: number | null;
}

export const EP1ComfortPanel: React.FC<EP1ComfortPanelProps> = ({ temperature, humidity }) => {
  if (temperature === null || humidity === null) {
    return (
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-4">
        <div className="text-sm font-semibold text-slate-400 mb-2">Comfort Index</div>
        <div className="text-xs text-slate-500">Waiting for sensor data...</div>
      </div>
    );
  }

  const comfort = getComfortLevel(temperature, humidity);
  const dewPoint = calculateDewPoint(temperature, humidity);
  const heatIndex = calculateHeatIndex(temperature, humidity);

  return (
    <div className={`rounded-xl border ${comfort.borderColor} ${comfort.bgColor} p-4`}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-slate-200">Comfort Index</div>
        <div className="text-2xl">{comfort.emoji}</div>
      </div>

      {/* Main Comfort Level */}
      <div className={`text-xl font-bold ${comfort.color} mb-3`}>{comfort.label}</div>

      {/* Details Grid */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        {/* Dew Point */}
        <div className="bg-slate-800/40 rounded-lg p-2">
          <div className="text-xs text-slate-500 mb-0.5">Dew Point</div>
          <div className="text-slate-200 font-medium">{dewPoint}°C</div>
        </div>

        {/* Feels Like (Heat Index) */}
        <div className="bg-slate-800/40 rounded-lg p-2">
          <div className="text-xs text-slate-500 mb-0.5">Feels Like</div>
          <div className="text-slate-200 font-medium">
            {heatIndex !== null ? `${heatIndex}°C` : `${temperature}°C`}
          </div>
        </div>
      </div>

      {/* Comfort Zone Visualization */}
      <div className="mt-3 pt-3 border-t border-slate-700/50">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-slate-500">Temperature Zone</span>
        </div>
        <div className="relative h-3 bg-slate-700/50 rounded-full overflow-hidden">
          {/* Gradient background showing zones */}
          <div className="absolute inset-0 flex">
            <div className="flex-1 bg-cyan-500/40" title="Cold (<18°C)" />
            <div className="flex-1 bg-blue-500/40" title="Cool (18-20°C)" />
            <div className="flex-1 bg-emerald-500/40" title="Optimal (20-24°C)" />
            <div className="flex-1 bg-amber-500/40" title="Warm (24-26°C)" />
            <div className="flex-1 bg-red-500/40" title="Hot (>26°C)" />
          </div>
          {/* Current position marker */}
          <div
            className="absolute top-0 h-full w-1 bg-white rounded-full shadow-lg transition-all duration-300"
            style={{
              left: `${Math.max(0, Math.min(100, ((temperature - 14) / 16) * 100))}%`,
            }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-slate-500 mt-1">
          <span>14°C</span>
          <span>30°C</span>
        </div>
      </div>

      {/* Humidity Zone */}
      <div className="mt-2">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-slate-500">Humidity Zone</span>
        </div>
        <div className="relative h-3 bg-slate-700/50 rounded-full overflow-hidden">
          <div className="absolute inset-0 flex">
            <div className="w-[30%] bg-amber-500/40" title="Dry (<30%)" />
            <div className="w-[10%] bg-blue-500/30" title="Low (30-40%)" />
            <div className="w-[20%] bg-emerald-500/40" title="Optimal (40-60%)" />
            <div className="w-[10%] bg-blue-500/30" title="High (60-70%)" />
            <div className="w-[30%] bg-blue-500/40" title="Humid (>70%)" />
          </div>
          <div
            className="absolute top-0 h-full w-1 bg-white rounded-full shadow-lg transition-all duration-300"
            style={{
              left: `${Math.max(0, Math.min(100, humidity))}%`,
            }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-slate-500 mt-1">
          <span>0%</span>
          <span>100%</span>
        </div>
      </div>
    </div>
  );
};
