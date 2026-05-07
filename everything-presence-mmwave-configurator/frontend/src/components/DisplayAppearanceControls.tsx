import React from 'react';

interface DisplayAppearanceControlsProps {
  targetMarkerScale: number;
  setTargetMarkerScale: (value: number) => void;
  showZoneLabels: boolean;
  setShowZoneLabels: (value: boolean) => void;
  zoneLabelScale: number;
  setZoneLabelScale: (value: number) => void;
}

export const DisplayAppearanceControls: React.FC<DisplayAppearanceControlsProps> = ({
  targetMarkerScale,
  setTargetMarkerScale,
  showZoneLabels,
  setShowZoneLabels,
  zoneLabelScale,
  setZoneLabelScale,
}) => (
  <div className="space-y-3">
    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Appearance</div>

    <label className="block text-sm text-slate-200">
      <span className="mb-1 flex items-center justify-between gap-3">
        <span>Tracking marker size</span>
        <span className="text-xs text-slate-400">{Math.round(targetMarkerScale * 100)}%</span>
      </span>
      <input
        type="range"
        min={0.5}
        max={1.75}
        step={0.05}
        value={targetMarkerScale}
        onChange={(event) => setTargetMarkerScale(Number(event.target.value))}
        className="w-full"
      />
    </label>

    <label className="flex min-h-[40px] cursor-pointer items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-800/50 px-3 text-sm text-slate-200">
      <span>Zone labels</span>
      <input
        type="checkbox"
        checked={showZoneLabels}
        onChange={(event) => setShowZoneLabels(event.target.checked)}
        className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
      />
    </label>

    <label className={`block text-sm ${showZoneLabels ? 'text-slate-200' : 'text-slate-500'}`}>
      <span className="mb-1 flex items-center justify-between gap-3">
        <span>Zone label size</span>
        <span className="text-xs text-slate-400">{Math.round(zoneLabelScale * 100)}%</span>
      </span>
      <input
        type="range"
        min={0.5}
        max={1.75}
        step={0.05}
        value={zoneLabelScale}
        onChange={(event) => setZoneLabelScale(Number(event.target.value))}
        disabled={!showZoneLabels}
        className="w-full disabled:opacity-40"
      />
    </label>
  </div>
);
