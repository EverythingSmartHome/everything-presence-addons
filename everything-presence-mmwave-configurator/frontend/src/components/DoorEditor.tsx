import React from 'react';
import { Door } from '../api/types';

interface DoorEditorProps {
  door: Door;
  onChange: (door: Door) => void;
  onDelete: () => void;
  onClose?: () => void;
  maxSegmentIndex: number; // Number of wall segments - 1
  validation?: {
    overlaps: boolean;
    nearCorner: boolean;
    tooWide: boolean;
    overlapWith?: string[];
  } | null;
}

export const DoorEditor: React.FC<DoorEditorProps> = ({
  door,
  onChange,
  onDelete,
  onClose,
  maxSegmentIndex,
  validation,
}) => {
  const handleChange = (updates: Partial<Door>) => {
    onChange({ ...door, ...updates });
  };

  const hasWarnings = validation && (validation.overlaps || validation.nearCorner || validation.tooWide);
  const swingDirectionOptions: Array<{
    value: Door['swingDirection'];
    label: string;
    description: string;
  }> = [
    {
      value: 'in',
      label: 'Into room',
      description: 'Door opens into the selected room',
    },
    {
      value: 'out',
      label: 'Out of room',
      description: 'Door opens away from the selected room',
    },
  ];
  const hingeSideOptions: Array<{
    value: Door['swingSide'];
    label: string;
    description: string;
  }> = [
    {
      value: 'left',
      label: 'Left',
      description: 'Hinge is on the left side of the doorway',
    },
    {
      value: 'right',
      label: 'Right',
      description: 'Hinge is on the right side of the doorway',
    },
  ];

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-80 bg-slate-900/95 backdrop-blur border-l border-slate-700 shadow-2xl flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 text-aqua-400 flex items-center justify-center text-2xl">
            🚪
          </div>
          <h2 className="text-lg font-semibold text-white">Door</h2>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Content */}
      <div
        className="flex-1 overflow-y-auto px-6 py-4 space-y-6"
        onWheelCapture={(e) => e.stopPropagation()}
      >
        {/* Validation Warnings */}
        {hasWarnings && (
          <div className="space-y-2">
            {validation?.overlaps && (
              <div className="bg-yellow-900/30 border border-yellow-600/50 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <span className="text-yellow-400 text-lg mt-0.5">⚠️</span>
                  <div>
                    <p className="text-sm font-semibold text-yellow-200">Door Overlap</p>
                    <p className="text-xs text-yellow-300 mt-1">
                      This door overlaps with another door on the same wall. Reposition to avoid overlap.
                    </p>
                  </div>
                </div>
              </div>
            )}
            {validation?.nearCorner && (
              <div className="bg-yellow-900/30 border border-yellow-600/50 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <span className="text-yellow-400 text-lg mt-0.5">⚠️</span>
                  <div>
                    <p className="text-sm font-semibold text-yellow-200">Near Corner</p>
                    <p className="text-xs text-yellow-300 mt-1">
                      Door is very close to a corner. Consider moving it toward the center of the wall.
                    </p>
                  </div>
                </div>
              </div>
            )}
            {validation?.tooWide && (
              <div className="bg-red-900/30 border border-red-600/50 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <span className="text-red-400 text-lg mt-0.5">🚫</span>
                  <div>
                    <p className="text-sm font-semibold text-red-200">Door Too Wide</p>
                    <p className="text-xs text-red-300 mt-1">
                      Door width exceeds 90% of the wall length. Reduce door width or choose a longer wall.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Wall Segment */}
        <div>
          <label className="block text-sm font-semibold text-slate-300 mb-3">Wall Segment</label>
          <select
            value={door.segmentIndex}
            onChange={(e) => handleChange({ segmentIndex: parseInt(e.target.value, 10) })}
            className="w-full px-3 py-2 bg-slate-800/70 border border-slate-700 rounded-lg text-white focus:border-aqua-500 focus:ring-1 focus:ring-aqua-500/50 focus:outline-none"
          >
            {Array.from({ length: maxSegmentIndex + 1 }, (_, i) => (
              <option key={i} value={i}>
                Wall {i + 1}
              </option>
            ))}
          </select>
          <p className="text-xs text-slate-400 mt-1">Select which wall this door is on</p>
        </div>

        {/* Position Along Wall */}
        <div>
          <label className="block text-sm font-semibold text-slate-300 mb-3">
            Position Along Wall
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={door.positionOnSegment}
            onChange={(e) => handleChange({ positionOnSegment: parseFloat(e.target.value) })}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-slate-400 mt-1">
            <span>Start</span>
            <span>{(door.positionOnSegment * 100).toFixed(0)}%</span>
            <span>End</span>
          </div>
          <p className="text-xs text-slate-400 mt-1">Slide to position door along the wall</p>
        </div>

        {/* Door Width */}
        <div>
          <label className="block text-sm font-semibold text-slate-300 mb-3">Door Width</label>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Width (mm)</label>
            <input
              type="number"
              value={door.widthMm}
              onChange={(e) => handleChange({ widthMm: parseFloat(e.target.value) })}
              step="10"
              min="600"
              max="1200"
              className="w-full px-3 py-2 bg-slate-800/70 border border-slate-700 rounded-lg text-white focus:border-aqua-500 focus:ring-1 focus:ring-aqua-500/50 focus:outline-none"
            />
          </div>
          <p className="text-xs text-slate-400 mt-1">Standard door: 800-900mm</p>
        </div>

        {/* Swing Direction */}
        <div>
          <label className="block text-sm font-semibold text-slate-300 mb-3">Swing Direction</label>
          <div className="grid grid-cols-2 gap-3">
            {swingDirectionOptions.map((option) => {
              const isIn = option.value === 'in';
              const panelY = isIn ? 32 : 8;
              const sweep = isIn ? 1 : 0;
              return (
                <button
                  key={option.value}
                  onClick={() => handleChange({ swingDirection: option.value })}
                  className={`rounded-lg border p-3 transition-all ${
                    door.swingDirection === option.value
                      ? 'border-aqua-500 bg-aqua-500/20 text-aqua-100'
                      : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-600'
                  }`}
                  aria-label={option.description}
                  title={option.description}
                >
                  <div className="flex flex-col items-center gap-2">
                    <svg className="h-12 w-12" fill="none" viewBox="0 0 48 48" aria-hidden="true">
                      <rect x="3" y="21" width="42" height="24" fill="currentColor" opacity="0.1" rx="2" />
                      <line x1="3" y1="20" x2="18" y2="20" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" />
                      <line x1="30" y1="20" x2="45" y2="20" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" />
                      <path
                        d={`M30 20 A12 12 0 0 ${sweep} 18 ${panelY}`}
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeOpacity="0.6"
                        strokeDasharray="3 2"
                        strokeLinecap="round"
                      />
                      <line x1="18" y1="20" x2="18" y2={panelY} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                      <circle cx="18" cy="20" r="2" fill="currentColor" />
                    </svg>
                    <span className="text-sm font-medium">{option.label}</span>
                  </div>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-slate-400 mt-1">Shaded side is the room. Door swing matches the canvas.</p>
        </div>

        {/* Hinge Side */}
        <div>
          <label className="block text-sm font-semibold text-slate-300 mb-3">Hinge Side</label>
          <div className="grid grid-cols-2 gap-3">
            {hingeSideOptions.map((option) => {
              const isLeft = option.value === 'left';
              const hingeX = isLeft ? 18 : 30;
              const freeEndClosedX = isLeft ? 30 : 18;
              const sweep = isLeft ? 1 : 0;
              return (
                <button
                  key={option.value}
                  onClick={() => handleChange({ swingSide: option.value })}
                  className={`rounded-lg border p-3 transition-all ${
                    door.swingSide === option.value
                      ? 'border-aqua-500 bg-aqua-500/20 text-aqua-100'
                      : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-600'
                  }`}
                  aria-label={option.description}
                  title={option.description}
                >
                  <div className="flex flex-col items-center gap-2">
                    <svg className="h-12 w-12" fill="none" viewBox="0 0 48 48" aria-hidden="true">
                      <rect x="3" y="21" width="42" height="24" fill="currentColor" opacity="0.1" rx="2" />
                      <line x1="3" y1="20" x2="18" y2="20" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" />
                      <line x1="30" y1="20" x2="45" y2="20" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" />
                      <path
                        d={`M${freeEndClosedX} 20 A12 12 0 0 ${sweep} ${hingeX} 32`}
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeOpacity="0.6"
                        strokeDasharray="3 2"
                        strokeLinecap="round"
                      />
                      <line x1={hingeX} y1="20" x2={hingeX} y2="32" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                      <circle cx={hingeX} cy="20" r="2" fill="currentColor" />
                    </svg>
                    <span className="text-sm font-medium">{option.label}</span>
                  </div>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-slate-400 mt-1">Dot marks the hinge; the panel and arc swing from that side.</p>
        </div>
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-slate-700">
        <button
          onClick={onDelete}
          className="w-full px-4 py-2.5 bg-red-600/20 hover:bg-red-600/30 border border-red-600/50 rounded-lg text-red-200 font-semibold transition-colors"
        >
          Delete Door
        </button>
      </div>
    </div>
  );
};
