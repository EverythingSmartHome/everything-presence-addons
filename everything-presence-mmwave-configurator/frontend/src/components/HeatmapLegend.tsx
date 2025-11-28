import React from 'react';

interface HeatmapLegendProps {
  visible: boolean;
}

export const HeatmapLegend: React.FC<HeatmapLegendProps> = ({ visible }) => {
  if (!visible) return null;

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-slate-800/50 border border-slate-700/30">
      <span className="text-[10px] text-slate-400">Low</span>
      <div
        className="h-2 w-20 rounded-full"
        style={{
          background: 'linear-gradient(to right, rgb(34, 197, 94), rgb(250, 204, 21), rgb(249, 115, 22), rgb(239, 68, 68))'
        }}
      />
      <span className="text-[10px] text-slate-400">High</span>
    </div>
  );
};
