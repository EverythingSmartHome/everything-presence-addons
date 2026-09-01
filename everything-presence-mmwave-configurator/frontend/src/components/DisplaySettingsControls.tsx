import React from 'react';
import { DisplayAppearanceControls } from './DisplayAppearanceControls';
import { HelpTooltip } from './HelpTooltip';

export interface DisplayToggleOption {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  note?: React.ReactNode;
  description?: React.ReactNode;
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

const DEFAULT_DESCRIPTIONS: Record<string, string> = {
  'Max distance': 'Shows the configured maximum sensing distance around the device.',
  'Trigger distance': 'Shows the distance at which the device begins reporting presence.',
  'Device coverage': 'Shows the sensor coverage area using its current position and orientation.',
  'Aligned direction': 'Shows the direction used to align the sensor with the room.',
  'Movement trails': 'Shows the recent path of each tracked target.',
  'Smooth tracking': 'Animates target movement between sensor updates.',
  'Clip radar to walls': 'Hides coverage outside the room walls.',
  Walls: 'Shows or hides room walls on the canvas.',
  Furniture: 'Shows or hides furniture on the canvas.',
  Doors: 'Shows or hides doors and their opening arcs on the canvas.',
  Zones: 'Shows or hides configured presence zones on the canvas.',
  'Device icon': 'Shows or hides the sensor position and orientation marker.',
  Targets: 'Shows or hides live tracked target markers.',
};

const ToggleRow: React.FC<{ option: DisplayToggleOption }> = ({ option }) => {
  const descriptionId = React.useId();
  const description = option.description ?? DEFAULT_DESCRIPTIONS[option.label];
  return <label className="flex min-h-[40px] cursor-pointer items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-800/50 px-3 text-sm text-slate-200 transition-colors hover:bg-slate-800/70">
    <span className="min-w-0">
      <span className="inline-flex items-center gap-1 font-medium">{option.label}{description && <HelpTooltip id={descriptionId}>{description}</HelpTooltip>}</span>
      {option.note && <span className="ml-2 text-xs text-slate-500">{option.note}</span>}
    </span>
    <input
      type="checkbox"
      checked={option.checked}
      disabled={option.disabled}
      onChange={(event) => option.onChange(event.target.checked)}
      aria-describedby={description ? descriptionId : undefined}
      className="h-4 w-4 shrink-0 rounded border-slate-600 bg-slate-800 text-aqua-500 focus:ring-aqua-500 focus:ring-offset-0 disabled:opacity-40"
    />
  </label>;
};

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
