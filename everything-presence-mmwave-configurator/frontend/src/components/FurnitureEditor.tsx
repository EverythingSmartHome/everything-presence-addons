import React from 'react';
import { FurnitureInstance } from '../api/types';
import { getFurnitureType } from '../furniture/catalog';
import { getFurnitureIcon } from '../furniture/icons';

interface FurnitureEditorProps {
  furniture: FurnitureInstance;
  onChange: (furniture: FurnitureInstance) => void;
  onDelete: () => void;
  onClose?: () => void;
}

export const FurnitureEditor: React.FC<FurnitureEditorProps> = ({
  furniture,
  onChange,
  onDelete,
  onClose,
}) => {
  const furnitureType = getFurnitureType(furniture.typeId);
  const Icon = getFurnitureIcon(furniture.typeId);

  const handleChange = (updates: Partial<FurnitureInstance>) => {
    onChange({ ...furniture, ...updates });
  };

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-80 bg-slate-900/95 backdrop-blur border-l border-slate-700 shadow-2xl flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
        <div className="flex items-center gap-3">
          {Icon && (
            <div className="w-8 h-8 text-aqua-400">
              <Icon className="w-full h-full" />
            </div>
          )}
          <h2 className="text-lg font-semibold text-white">{furnitureType?.label || 'Furniture'}</h2>
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
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
        {/* Position */}
        <div>
          <label className="block text-sm font-semibold text-slate-300 mb-3">Position</label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">X (m)</label>
              <input
                type="number"
                value={(furniture.x / 1000).toFixed(2)}
                onChange={(e) => handleChange({ x: parseFloat(e.target.value) * 1000 })}
                step="0.1"
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:border-aqua-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Y (m)</label>
              <input
                type="number"
                value={(furniture.y / 1000).toFixed(2)}
                onChange={(e) => handleChange({ y: parseFloat(e.target.value) * 1000 })}
                step="0.1"
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:border-aqua-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Size */}
        <div>
          <label className="block text-sm font-semibold text-slate-300 mb-3">Size</label>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Width (m)</label>
              <input
                type="number"
                value={(furniture.width / 1000).toFixed(2)}
                onChange={(e) => {
                  const newWidth = parseFloat(e.target.value) * 1000;
                  if (furniture.aspectRatioLocked && furnitureType) {
                    const aspectRatio = furnitureType.defaultWidth / furnitureType.defaultDepth;
                    handleChange({ width: newWidth, depth: newWidth / aspectRatio });
                  } else {
                    handleChange({ width: newWidth });
                  }
                }}
                step="0.1"
                min="0.1"
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:border-aqua-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Depth (m)</label>
              <input
                type="number"
                value={(furniture.depth / 1000).toFixed(2)}
                onChange={(e) => {
                  const newDepth = parseFloat(e.target.value) * 1000;
                  if (furniture.aspectRatioLocked && furnitureType) {
                    const aspectRatio = furnitureType.defaultWidth / furnitureType.defaultDepth;
                    handleChange({ depth: newDepth, width: newDepth * aspectRatio });
                  } else {
                    handleChange({ depth: newDepth });
                  }
                }}
                step="0.1"
                min="0.1"
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:border-aqua-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Height (m) - Info only</label>
              <input
                type="number"
                value={(furniture.height / 1000).toFixed(2)}
                disabled
                className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-slate-400 cursor-not-allowed"
              />
            </div>
          </div>

          {/* Aspect Ratio Lock */}
          <label className="flex items-center gap-2 mt-3 cursor-pointer">
            <input
              type="checkbox"
              checked={furniture.aspectRatioLocked}
              onChange={(e) => handleChange({ aspectRatioLocked: e.target.checked })}
              className="w-4 h-4 rounded border-slate-700 bg-slate-800 text-aqua-600 focus:ring-aqua-500 focus:ring-offset-slate-900"
            />
            <span className="text-sm text-slate-300">Lock aspect ratio</span>
          </label>
        </div>

        {/* Rotation */}
        <div>
          <label className="block text-sm font-semibold text-slate-300 mb-3">
            Rotation: {Math.round(furniture.rotationDeg)}°
          </label>
          <input
            type="range"
            min="0"
            max="360"
            value={furniture.rotationDeg}
            onChange={(e) => handleChange({ rotationDeg: parseFloat(e.target.value) })}
            className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-aqua-600"
          />
          <div className="flex justify-between text-xs text-slate-400 mt-1">
            <span>0°</span>
            <span>90°</span>
            <span>180°</span>
            <span>270°</span>
            <span>360°</span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="px-6 py-4 border-t border-slate-700 space-y-2">
        <button
          onClick={onDelete}
          className="w-full px-4 py-2.5 rounded-lg bg-rose-600/10 border border-rose-600/50 text-rose-100 font-semibold hover:bg-rose-600/20 transition-all active:scale-95"
        >
          Delete Furniture
        </button>
      </div>
    </div>
  );
};
