import React from 'react';
import { MARKER_SCALE_MAX, MARKER_SCALE_MIN } from '../utils/deviceMarkerSettings';

interface DisplayAppearanceControlsProps {
  showDeviceMarker: boolean;
  deviceMarkerStyle: 'icon' | 'node';
  setDeviceMarkerStyle: (value: 'icon' | 'node') => void;
  deviceMarkerScale: number;
  setDeviceMarkerScale: (value: number) => void;
  deviceMarkerOpacity: number;
  setDeviceMarkerOpacity: (value: number) => void;
  targetMarkerScale: number;
  setTargetMarkerScale: (value: number) => void;
  showZoneLabels: boolean;
  setShowZoneLabels: (value: boolean) => void;
  zoneLabelScale: number;
  setZoneLabelScale: (value: number) => void;
}

export const DisplayAppearanceControls: React.FC<DisplayAppearanceControlsProps> = ({
  showDeviceMarker,
  deviceMarkerStyle,
  setDeviceMarkerStyle,
  deviceMarkerScale,
  setDeviceMarkerScale,
  deviceMarkerOpacity,
  setDeviceMarkerOpacity,
  targetMarkerScale,
  setTargetMarkerScale,
  showZoneLabels,
  setShowZoneLabels,
  zoneLabelScale,
  setZoneLabelScale,
}) => (
  <div className="space-y-3">
    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Appearance</div>

    <label className={`block text-sm ${showDeviceMarker ? 'text-slate-200' : 'text-slate-500'}`}>
      <span className="mb-1 block">Device marker style</span>
      <select value={deviceMarkerStyle} onChange={(event) => setDeviceMarkerStyle(event.target.value as 'icon' | 'node')} disabled={!showDeviceMarker} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 disabled:opacity-40">
        <option value="icon">Product icon</option>
        <option value="node">Translucent node</option>
      </select>
    </label>

    <label className={`block text-sm ${showDeviceMarker ? 'text-slate-200' : 'text-slate-500'}`}>
      <span className="mb-1 flex items-center justify-between gap-3"><span>Device marker size</span><span className="text-xs text-slate-400">{Math.round(deviceMarkerScale * 100)}%</span></span>
      <input type="range" min={MARKER_SCALE_MIN} max={MARKER_SCALE_MAX} step={0.05} value={deviceMarkerScale} onChange={(event) => setDeviceMarkerScale(Number(event.target.value))} disabled={!showDeviceMarker} className="w-full disabled:opacity-40" />
    </label>

    <label className={`block text-sm ${showDeviceMarker ? 'text-slate-200' : 'text-slate-500'}`}>
      <span className="mb-1 flex items-center justify-between gap-3"><span>Device marker opacity</span><span className="text-xs text-slate-400">{Math.round(deviceMarkerOpacity * 100)}%</span></span>
      <input type="range" min={0.1} max={1} step={0.1} value={deviceMarkerOpacity} onChange={(event) => setDeviceMarkerOpacity(Number(event.target.value))} disabled={!showDeviceMarker} className="w-full disabled:opacity-40" />
    </label>

    <label className="block text-sm text-slate-200">
      <span className="mb-1 flex items-center justify-between gap-3">
        <span>Tracking marker size</span>
        <span className="text-xs text-slate-400">{Math.round(targetMarkerScale * 100)}%</span>
      </span>
      <input
        type="range"
        min={MARKER_SCALE_MIN}
        max={MARKER_SCALE_MAX}
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
        min={MARKER_SCALE_MIN}
        max={MARKER_SCALE_MAX}
        step={0.05}
        value={zoneLabelScale}
        onChange={(event) => setZoneLabelScale(Number(event.target.value))}
        disabled={!showZoneLabels}
        className="w-full disabled:opacity-40"
      />
    </label>
  </div>
);
