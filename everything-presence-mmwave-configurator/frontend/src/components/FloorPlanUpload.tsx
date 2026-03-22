import React, { useState, useRef, useCallback } from 'react';

export interface BackgroundImageData {
  dataUrl: string;
  scaleMmPerPx: number;
  offsetX: number;
  offsetY: number;
  opacity: number;
  rotationDeg: number;
}

interface FloorPlanUploadProps {
  onApply: (data: BackgroundImageData) => void;
  onClose: () => void;
  existing?: BackgroundImageData | null;
}

export const FloorPlanUpload: React.FC<FloorPlanUploadProps> = ({ onApply, onClose, existing }) => {
  const [dataUrl, setDataUrl] = useState<string | null>(existing?.dataUrl ?? null);
  const [fileName, setFileName] = useState<string | null>(existing ? 'Current image' : null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [scaleMmPerPx, setScaleMmPerPx] = useState(existing?.scaleMmPerPx ?? 10);
  const [opacity, setOpacity] = useState(existing?.opacity ?? 0.3);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((f: File) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(f.type)) {
      setError('Please upload a JPEG, PNG, WebP, or GIF image');
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      setError('File size must be under 10MB');
      return;
    }
    setError(null);
    setFileName(f.name);
    setFileSize(f.size);

    const reader = new FileReader();
    reader.onload = (e) => setDataUrl(e.target?.result as string);
    reader.readAsDataURL(f);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const handleApply = () => {
    if (!dataUrl) return;
    onApply({
      dataUrl,
      scaleMmPerPx,
      offsetX: existing?.offsetX ?? 0,
      offsetY: existing?.offsetY ?? 0,
      opacity,
      rotationDeg: existing?.rotationDeg ?? 0,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg mx-4 rounded-2xl border border-slate-700/50 bg-slate-900 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700/50 px-6 py-4">
          <h2 className="text-lg font-bold text-white">Import Floor Plan</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* File Upload */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              Floor Plan Image
            </label>
            <div
              className={`relative rounded-xl border-2 border-dashed transition-colors cursor-pointer ${
                dragOver
                  ? 'border-aqua-500 bg-aqua-500/10'
                  : dataUrl
                    ? 'border-emerald-600/50 bg-emerald-600/5'
                    : 'border-slate-600 hover:border-slate-500 bg-slate-800/50'
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />

              {dataUrl ? (
                <div className="p-4">
                  <img
                    src={dataUrl}
                    alt="Floor plan preview"
                    className="w-full max-h-48 object-contain rounded-lg mb-3"
                  />
                  <div className="text-center">
                    <p className="text-sm font-medium text-emerald-300">{fileName}</p>
                    {fileSize && <p className="text-xs text-slate-500 mt-0.5">{(fileSize / 1024).toFixed(0)} KB</p>}
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center">
                  <svg className="mx-auto w-10 h-10 text-slate-500 mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                  <p className="text-sm text-slate-300">
                    Drop your floor plan here or <span className="text-aqua-400 font-medium">browse</span>
                  </p>
                  <p className="text-xs text-slate-500 mt-1">JPEG, PNG, WebP, or GIF (max 10MB)</p>
                </div>
              )}
            </div>
          </div>

          {/* Scale */}
          {dataUrl && (
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                Scale (mm per pixel)
              </label>
              <input
                type="range"
                min={1}
                max={50}
                step={0.5}
                value={scaleMmPerPx}
                onChange={(e) => setScaleMmPerPx(Number(e.target.value))}
                className="w-full accent-aqua-500"
              />
              <div className="flex justify-between text-xs text-slate-500 mt-1">
                <span>Zoomed in</span>
                <span className="text-aqua-300 font-medium">{scaleMmPerPx} mm/px</span>
                <span>Zoomed out</span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Adjust so the image matches the grid. You can fine-tune this on the canvas later.
              </p>
            </div>
          )}

          {/* Opacity */}
          {dataUrl && (
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                Opacity
              </label>
              <input
                type="range"
                min={0.1}
                max={0.8}
                step={0.05}
                value={opacity}
                onChange={(e) => setOpacity(Number(e.target.value))}
                className="w-full accent-aqua-500"
              />
              <div className="flex justify-between text-xs text-slate-500 mt-1">
                <span>Faint</span>
                <span className="text-aqua-300 font-medium">{Math.round(opacity * 100)}%</span>
                <span>Solid</span>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="rounded-xl border border-rose-600/30 bg-rose-600/10 px-4 py-3 text-sm text-rose-300">
              {error}
            </div>
          )}

          {/* Info */}
          {dataUrl && (
            <div className="rounded-xl border border-slate-700/30 bg-slate-800/50 px-4 py-3 text-xs text-slate-400">
              The image will appear as a background on the canvas. Trace over it by clicking to add wall points.
              You can drag the image and adjust scale/opacity on the canvas.
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 rounded-xl border border-slate-600 px-4 py-2.5 text-sm font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={!dataUrl}
              className="flex-1 rounded-xl bg-gradient-to-r from-aqua-600 to-aqua-500 px-4 py-2.5 text-sm font-bold text-white shadow-lg hover:shadow-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
            >
              Apply to Canvas
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
