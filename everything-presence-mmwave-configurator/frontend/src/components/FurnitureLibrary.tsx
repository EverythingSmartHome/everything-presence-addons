import React, { useState } from 'react';
import { FurnitureType } from '../api/types';
import { getFurnitureCategories, getFurnitureByCategory } from '../furniture/catalog';
import { getFurnitureIcon } from '../furniture/icons';

interface FurnitureLibraryProps {
  onSelect: (furnitureType: FurnitureType) => void;
  onClose: () => void;
}

export const FurnitureLibrary: React.FC<FurnitureLibraryProps> = ({ onSelect, onClose }) => {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const categories = getFurnitureCategories();
  const furniture = getFurnitureByCategory(selectedCategory);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      onWheelCapture={(e) => e.stopPropagation()}
    >
      <div
        className="relative w-full max-w-4xl h-[85vh] mx-4 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold text-white">Furniture Library</h2>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Category Tabs */}
        <div className="flex flex-wrap gap-2 px-6 py-4 border-b border-slate-700">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                selectedCategory === cat.id
                  ? 'bg-aqua-600/20 text-aqua-400 border border-aqua-600/50'
                  : 'bg-slate-800/50 text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Furniture Grid */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {furniture.map((item) => {
              const Icon = getFurnitureIcon(item.id);
              return (
                <button
                  key={item.id}
                  onClick={() => onSelect(item)}
                  className="group flex flex-col items-center gap-3 p-4 rounded-xl border border-slate-700 bg-slate-800/50 hover:bg-slate-800 hover:border-aqua-600/50 transition-all active:scale-95"
                >
                  {/* Icon */}
                  <div className="w-16 h-16 flex items-center justify-center text-slate-300 group-hover:text-aqua-400 transition-colors">
                    {Icon ? (
                      <Icon className="w-full h-full" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-slate-700 rounded-lg">
                        <span className="text-2xl">📦</span>
                      </div>
                    )}
                  </div>

                  {/* Label */}
                  <div className="text-center">
                    <div className="text-sm font-medium text-white group-hover:text-aqua-400 transition-colors">
                      {item.label}
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      {(item.defaultWidth / 1000).toFixed(1)}m × {(item.defaultDepth / 1000).toFixed(1)}m
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {furniture.length === 0 && (
            <div className="flex items-center justify-center py-12 text-slate-400">
              No furniture in this category
            </div>
          )}
        </div>

        {/* Footer Info */}
        <div className="px-6 py-4 border-t border-slate-700 text-xs text-slate-400 text-center">
          Click any furniture item to add it to your room
        </div>
      </div>
    </div>
  );
};
