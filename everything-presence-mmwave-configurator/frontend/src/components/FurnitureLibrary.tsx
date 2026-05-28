import React, { useEffect, useId, useRef, useState } from 'react';
import { FurnitureType } from '../api/types';
import { getAllFurnitureByCategory, getFurnitureCategories } from '../furniture/catalog';
import { getFurnitureIcon } from '../furniture/icons';
import { useCustomAssets } from '../hooks/useCustomAssets';
import { CustomFurniturePreview, getCustomFurnitureType } from '../furniture/customVisual';

interface FurnitureLibraryProps {
  onSelect: (furnitureType: FurnitureType) => void;
  onClose: () => void;
}

export const FurnitureLibrary: React.FC<FurnitureLibraryProps> = ({ onSelect, onClose }) => {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const { customFurniture } = useCustomAssets();
  const categories = getFurnitureCategories();
  const furniture = getAllFurnitureByCategory(selectedCategory, customFurniture);

  useEffect(() => {
    const closeTimer = window.setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(closeTimer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/60 backdrop-blur-sm md:items-center"
      onClick={onClose}
      onWheelCapture={(e) => e.stopPropagation()}
    >
      <div
        className="relative flex h-[88dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl border-t border-slate-700 bg-slate-900 shadow-2xl mobile-safe-bottom md:mx-4 md:h-[85vh] md:rounded-2xl md:border"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3 md:px-6 md:py-4">
          <h2 id={titleId} className="truncate text-lg font-semibold text-white">Furniture Library</h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-aqua-400"
            aria-label="Close furniture library"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex gap-2 overflow-x-auto border-b border-slate-700 px-4 py-3 md:flex-wrap md:px-6 md:py-4">
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelectedCategory(cat.id)}
              aria-pressed={selectedCategory === cat.id}
              className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-aqua-400 ${
                selectedCategory === cat.id
                  ? 'border border-aqua-600/50 bg-aqua-600/20 text-aqua-400'
                  : 'bg-slate-800/50 text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 md:gap-4">
            {furniture.map((item) => {
              const Icon = getFurnitureIcon(item.id);
              const customType = getCustomFurnitureType(customFurniture, item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(item)}
                  className="group flex min-h-[128px] flex-col items-center gap-3 rounded-xl border border-slate-700 bg-slate-800/50 p-3 transition-all hover:border-aqua-600/50 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-aqua-400 active:scale-95 md:p-4"
                >
                  <div className="flex h-14 w-14 items-center justify-center text-slate-300 transition-colors group-hover:text-aqua-400 md:h-16 md:w-16">
                    {Icon ? (
                      <Icon className="h-full w-full" />
                    ) : customType ? (
                      <CustomFurniturePreview furniture={customType} className="h-full w-full" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center rounded-lg bg-slate-700 text-xs font-semibold text-slate-300">
                        Item
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 text-center">
                    <div className="text-sm font-medium text-white transition-colors group-hover:text-aqua-400">
                      {item.label}
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      {(item.defaultWidth / 1000).toFixed(1)}m x {(item.defaultDepth / 1000).toFixed(1)}m
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

        <div className="border-t border-slate-700 px-4 py-3 text-center text-xs text-slate-400 md:px-6 md:py-4">
          Select any furniture item to add it to your room
        </div>
      </div>
    </div>
  );
};
