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
            <button
              onClick={() => handleChange({ swingDirection: 'in' })}
              className={`px-4 py-2 rounded-lg border transition-all ${
                door.swingDirection === 'in'
                  ? 'border-aqua-500 bg-aqua-500/20 text-aqua-100'
                  : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-600'
              }`}
            >
              Inward
            </button>
            <button
              onClick={() => handleChange({ swingDirection: 'out' })}
              className={`px-4 py-2 rounded-lg border transition-all ${
                door.swingDirection === 'out'
                  ? 'border-aqua-500 bg-aqua-500/20 text-aqua-100'
                  : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-600'
              }`}
            >
              Outward
            </button>
          </div>
          <p className="text-xs text-slate-400 mt-1">Direction door swings relative to room</p>
        </div>

        {/* Hinge Side */}
        <div>
          <label className="block text-sm font-semibold text-slate-300 mb-3">Hinge Side</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => handleChange({ swingSide: 'left' })}
              className={`px-4 py-2 rounded-lg border transition-all ${
                door.swingSide === 'left'
                  ? 'border-aqua-500 bg-aqua-500/20 text-aqua-100'
                  : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-600'
              }`}
            >
              Left
            </button>
            <button
              onClick={() => handleChange({ swingSide: 'right' })}
              className={`px-4 py-2 rounded-lg border transition-all ${
                door.swingSide === 'right'
                  ? 'border-aqua-500 bg-aqua-500/20 text-aqua-100'
                  : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-600'
              }`}
            >
              Right
            </button>
          </div>
          <p className="text-xs text-slate-400 mt-1">Which side the hinge is on</p>
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
