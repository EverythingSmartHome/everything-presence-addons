import React from 'react';
import { ZoneRect } from '../api/types';

interface ZoneEditorProps {
  zone: ZoneRect;
  onChange: (zone: ZoneRect) => void;
  onDelete?: (id: string) => void;
}

const zoneTypes: ZoneRect['type'][] = ['regular', 'exclusion', 'entry'];

export const ZoneEditor: React.FC<ZoneEditorProps> = ({ zone, onChange, onDelete }) => {
  const update = (patch: Partial<ZoneRect>) => onChange({ ...zone, ...patch });

  return (
    <div className="space-y-2 rounded-lg border border-slate-700/50 bg-slate-900/60 p-3">
      <div className="flex items-center justify-between text-sm text-slate-200">
        <span>{zone.id}</span>
        <select
          className="rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-xs text-slate-200 focus:border-aqua-500 focus:ring-1 focus:ring-aqua-500/50 focus:outline-none"
          value={zone.type}
          onChange={(e) => update({ type: e.target.value as ZoneRect['type'] })}
        >
          {zoneTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <label className="flex items-center gap-2 text-xs text-slate-300">
        <span className="w-10">Label</span>
        <input
          type="text"
          placeholder="e.g. Bed, Chair, Desk..."
          className="w-full rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-xs text-white placeholder-slate-500 focus:border-aqua-500 focus:ring-1 focus:ring-aqua-500/50 focus:outline-none"
          value={zone.label ?? ''}
          onChange={(e) => update({ label: e.target.value || undefined })}
        />
      </label>
      <div className="grid grid-cols-2 gap-2 text-xs text-slate-300">
        <label className="flex items-center gap-2">
          <span className="w-10">X</span>
          <input
            type="number"
            className="w-full rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-xs text-white focus:border-aqua-500 focus:ring-1 focus:ring-aqua-500/50 focus:outline-none"
            value={zone.x}
            onChange={(e) => update({ x: Number(e.target.value) })}
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="w-10">Y</span>
          <input
            type="number"
            className="w-full rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-xs text-white focus:border-aqua-500 focus:ring-1 focus:ring-aqua-500/50 focus:outline-none"
            value={zone.y}
            onChange={(e) => update({ y: Number(e.target.value) })}
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="w-10">W</span>
          <input
            type="number"
            className="w-full rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-xs text-white focus:border-aqua-500 focus:ring-1 focus:ring-aqua-500/50 focus:outline-none"
            value={zone.width}
            onChange={(e) => update({ width: Number(e.target.value) })}
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="w-10">H</span>
          <input
            type="number"
            className="w-full rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-xs text-white focus:border-aqua-500 focus:ring-1 focus:ring-aqua-500/50 focus:outline-none"
            value={zone.height}
            onChange={(e) => update({ height: Number(e.target.value) })}
          />
        </label>
      </div>
      {onDelete && (
        <button
          className="w-full rounded-md border border-rose-500/70 px-2 py-1 text-xs font-semibold text-rose-100 transition hover:bg-rose-500/10"
          onClick={() => onDelete(zone.id)}
        >
          Delete Zone
        </button>
      )}
    </div>
  );
};
