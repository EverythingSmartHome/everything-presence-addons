import type React from 'react';
import type { Door } from '../api/types';

interface DoorStyleIconProps {
  style: Door['style'];
  className?: string;
}

/**
 * Plan-view door symbols for the style picker. Every icon shares the same wall
 * (a gap between x=14 and x=34 on y=8) so the four options read as variations
 * of one thing rather than four unrelated pictures. Drawn in currentColor so
 * the selected/unselected button states tint them automatically.
 */
export const DoorStyleIcon: React.FC<DoorStyleIconProps> = ({ style, className }) => (
  <svg viewBox="0 0 48 32" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
    {/* Wall either side of the opening */}
    <path d="M 2 8 H 14 M 34 8 H 46" strokeWidth={3} />

    {style === 'single' && <>
      <path d="M 34 8 A 20 20 0 0 1 14 28" strokeWidth={1.5} strokeDasharray="2.5 2.5" opacity={0.7} />
      <path d="M 14 8 V 28" strokeWidth={2.5} />
      <circle cx={14} cy={8} r={2} fill="currentColor" stroke="none" />
    </>}

    {style === 'double' && <>
      <path d="M 24 8 A 10 10 0 0 1 14 18 M 24 8 A 10 10 0 0 0 34 18" strokeWidth={1.5} strokeDasharray="2.5 2.5" opacity={0.7} />
      <path d="M 14 8 V 18 M 34 8 V 18" strokeWidth={2.5} />
      <circle cx={14} cy={8} r={2} fill="currentColor" stroke="none" />
      <circle cx={34} cy={8} r={2} fill="currentColor" stroke="none" />
    </>}

    {style === 'sliding' && <>
      {/* Bypass panels: one hugs the wall, the other sits a step into the room and slides across it. */}
      <path d="M 12 13 H 26" strokeWidth={3} />
      <path d="M 22 18 H 36" strokeWidth={3} />
      <path d="M 18 26 H 32 M 28.5 22.5 L 32 26 L 28.5 29.5" strokeWidth={1.75} opacity={0.85} />
    </>}

    {style === 'opening' && <>
      {/* Cased opening: jambs plus the dashed header line used on floor plans. */}
      <path d="M 14 8 H 34" strokeWidth={1.5} strokeDasharray="2.5 2.5" opacity={0.7} />
      <path d="M 14 3.5 V 12.5 M 34 3.5 V 12.5" strokeWidth={3} />
    </>}
  </svg>
);
