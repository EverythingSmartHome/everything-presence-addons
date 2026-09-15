import React from 'react';
import { ZoneRect } from '../api/types';
import { HelpTooltip } from './HelpTooltip';

interface ZoneEditorProps {
  zone: ZoneRect;
  onChange: (zone: ZoneRect) => void;
  onDelete?: (id: string) => void;
  /**
   * Zone types the device supports. Omit to offer all three. A type the device
   * cannot hold is never offered, so a zone cannot be retyped into one.
   */
  allowedTypes?: ZoneRect['type'][];
}

const zoneTypes: ZoneRect['type'][] = ['regular', 'exclusion', 'entry'];

export const ZoneEditor: React.FC<ZoneEditorProps> = ({ zone, onChange, onDelete, allowedTypes }) => {
  const update = (patch: Partial<ZoneRect>) => onChange({ ...zone, ...patch });
  const helpId = (field: string) => `zone-${zone.id.replace(/[^a-zA-Z0-9_-]/g, '-')}-${field}-help`;
  // The zone's current type stays selectable even when unsupported, so existing
  // configuration is shown honestly rather than silently retyped.
  const selectableTypes = allowedTypes?.length
    ? zoneTypes.filter((type) => allowedTypes.includes(type) || type === zone.type)
    : zoneTypes;

  return (
    <div className="space-y-2 rounded-lg border border-slate-700/50 bg-slate-900/60 p-3">
      <div className="flex items-center justify-between text-sm text-slate-200">
        <span className="inline-flex items-center gap-1">{zone.id}<HelpTooltip id={helpId('type')}>Controls how presence inside this zone is interpreted: regular, exclusion, or entry.</HelpTooltip></span>
        <select
          aria-label={`${zone.id} type`}
          aria-describedby={helpId('type')}
          className="rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-xs text-slate-200 focus:border-aqua-500 focus:ring-1 focus:ring-aqua-500/50 focus:outline-none"
          value={zone.type}
          onChange={(e) => update({ type: e.target.value as ZoneRect['type'] })}
        >
          {selectableTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <label className="flex items-center gap-2 text-xs text-slate-300">
        <span className="inline-flex w-10 items-center gap-1">Label<HelpTooltip id={helpId('label')}>Sets the zone's friendly name on the canvas and in Home Assistant.</HelpTooltip></span>
        <input
          aria-describedby={helpId('label')}
          type="text"
          placeholder="e.g. Bed, Chair, Desk..."
          className="w-full rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-xs text-white placeholder-slate-500 focus:border-aqua-500 focus:ring-1 focus:ring-aqua-500/50 focus:outline-none"
          value={zone.label ?? ''}
          onChange={(e) => update({ label: e.target.value || undefined })}
        />
      </label>
      <div className="grid grid-cols-2 gap-2 text-xs text-slate-300">
        <label className="flex items-center gap-2">
          <span className="inline-flex w-10 items-center gap-1">X<HelpTooltip id={helpId('x')}>Horizontal position in the device coordinate units.</HelpTooltip></span>
          <input
            aria-describedby={helpId('x')}
            type="number"
            className="w-full rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-xs text-white focus:border-aqua-500 focus:ring-1 focus:ring-aqua-500/50 focus:outline-none"
            value={zone.x}
            onChange={(e) => update({ x: Number(e.target.value) })}
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="inline-flex w-10 items-center gap-1">Y<HelpTooltip id={helpId('y')}>Vertical position in the device coordinate units.</HelpTooltip></span>
          <input
            aria-describedby={helpId('y')}
            type="number"
            className="w-full rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-xs text-white focus:border-aqua-500 focus:ring-1 focus:ring-aqua-500/50 focus:outline-none"
            value={zone.y}
            onChange={(e) => update({ y: Number(e.target.value) })}
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="inline-flex w-10 items-center gap-1">W<HelpTooltip id={helpId('width')}>Zone width in the device coordinate units.</HelpTooltip></span>
          <input
            aria-describedby={helpId('width')}
            type="number"
            className="w-full rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-xs text-white focus:border-aqua-500 focus:ring-1 focus:ring-aqua-500/50 focus:outline-none"
            value={zone.width}
            onChange={(e) => update({ width: Number(e.target.value) })}
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="inline-flex w-10 items-center gap-1">H<HelpTooltip id={helpId('height')}>Zone height in the device coordinate units.</HelpTooltip></span>
          <input
            aria-describedby={helpId('height')}
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
