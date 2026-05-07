import React from 'react';
import { DisplayAppearanceControls } from './DisplayAppearanceControls';

export interface DisplayToggleOption {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  note?: React.ReactNode;
}

interface DisplaySettingsControlsProps {
  overlayOptions?: DisplayToggleOption[];
  roomOptions?: DisplayToggleOption[];
  appearance: {
    targetMarkerScale: number;
    setTargetMarkerScale: (value: number) => void;
    showZoneLabels: boolean;
    setShowZoneLabels: (value: boolean) => void;
    zoneLabelScale: number;
    setZoneLabelScale: (value: number) => void;
  };
  extraSections?: React.ReactNode;
  footer?: React.ReactNode;
}

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="space-y-2">
    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</div>
    {children}
  </div>
);

const ToggleRow: React.FC<{ option: DisplayToggleOption }> = ({ option }) => (
  <label className="flex min-h-[40px] cursor-pointer items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-800/50 px-3 text-sm text-slate-200 transition-colors hover:bg-slate-800/70">
    <span className="min-w-0">
      <span className="font-medium">{option.label}</span>
      {option.note && <span className="ml-2 text-xs text-slate-500">{option.note}</span>}
    </span>
    <input
      type="checkbox"
      checked={option.checked}
      disabled={option.disabled}
      onChange={(event) => option.onChange(event.target.checked)}
      className="h-4 w-4 shrink-0 rounded border-slate-600 bg-slate-800 text-aqua-500 focus:ring-aqua-500 focus:ring-offset-0 disabled:opacity-40"
    />
  </label>
);

export const DisplaySettingsControls: React.FC<DisplaySettingsControlsProps> = ({
  overlayOptions = [],
  roomOptions = [],
  appearance,
  extraSections,
  footer,
}) => (
  <div className="space-y-4 text-sm text-slate-200">
    {overlayOptions.length > 0 && (
      <Section title="Overlays">
        {overlayOptions.map((option) => (
          <ToggleRow key={option.label} option={option} />
        ))}
      </Section>
    )}

    {roomOptions.length > 0 && (
      <Section title="Room Elements">
        {roomOptions.map((option) => (
          <ToggleRow key={option.label} option={option} />
        ))}
      </Section>
    )}

    {extraSections}

    <div className="border-t border-slate-700/70 pt-3">
      <DisplayAppearanceControls {...appearance} />
    </div>

    {footer && <div className="border-t border-slate-700/70 pt-3">{footer}</div>}
  </div>
);
