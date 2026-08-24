import React from 'react';
import { createLShapePoints, createRectanglePoints, type RoomShapePoint } from '../utils/roomShapes';

export type BasicRoomShapeKind = 'rectangle' | 'l-shape';

export interface BasicRoomShapeSelection {
  kind: BasicRoomShapeKind;
  width: number;
  length: number;
  cutoutWidth: number;
  cutoutLength: number;
}

interface BasicRoomShapesPickerProps {
  units: 'metric' | 'imperial';
  onApply: (points: RoomShapePoint[], selection: BasicRoomShapeSelection) => void;
  onDrawOwn: () => void;
  onCancel?: () => void;
}

const pointsForSelection = (selection: BasicRoomShapeSelection) => selection.kind === 'rectangle'
  ? createRectanglePoints(selection)
  : createLShapePoints(selection);

export const resizeBasicRoomShapeWall = (
  selection: BasicRoomShapeSelection,
  segmentIndex: number,
  length: number,
): { points: RoomShapePoint[]; selection: BasicRoomShapeSelection } => {
  const next = { ...selection };
  if (selection.kind === 'rectangle') {
    if (segmentIndex === 0 || segmentIndex === 2) next.width = length;
    else next.length = length;
  } else {
    if (segmentIndex === 0) next.width = length;
    else if (segmentIndex === 1) next.length = length + selection.cutoutLength;
    else if (segmentIndex === 2) next.cutoutWidth = length;
    else if (segmentIndex === 3) next.cutoutLength = length;
    else if (segmentIndex === 4) next.width = length + selection.cutoutWidth;
    else next.length = length;
  }
  return { selection: next, points: pointsForSelection(next) };
};

const ShapeDiagram = ({ shape }: { shape: BasicRoomShapeKind }) => (
  <svg viewBox="0 0 160 110" className="h-28 w-full" role="img" aria-label={`${shape === 'rectangle' ? 'Rectangle' : 'L-shaped room'} preview`}>
    <path d={shape === 'rectangle' ? 'M 25 20 H 135 V 90 H 25 Z' : 'M 20 15 H 140 V 65 H 90 V 95 H 20 Z'} fill="rgba(34,211,238,.12)" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" className="text-aqua-400" />
  </svg>
);

export const BasicRoomShapesPicker: React.FC<BasicRoomShapesPickerProps> = ({ units, onApply, onDrawOwn, onCancel }) => {
  const scale = units === 'metric' ? 1000 : 304.8;
  const choose = (kind: BasicRoomShapeKind) => {
    const selection: BasicRoomShapeSelection = {
      kind,
      width: 4 * scale,
      length: 4 * scale,
      cutoutWidth: 1.5 * scale,
      cutoutLength: 1.5 * scale,
    };
    onApply(pointsForSelection(selection), selection);
  };
  return (
    <div className="w-full max-w-3xl rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl sm:p-7">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div><h2 className="text-xl font-bold text-white">Choose your room shape</h2><p className="mt-1 text-sm text-slate-400">Choose a shape to place it on the canvas, then adjust its wall dimensions there.</p></div>
        {onCancel && <button type="button" onClick={onCancel} className="text-sm text-slate-400 hover:text-white">Close</button>}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {(['rectangle', 'l-shape'] as BasicRoomShapeKind[]).map((shape) => (
          <button key={shape} type="button" onClick={() => choose(shape)} className="rounded-xl border border-slate-700 bg-slate-800/60 p-3 text-left transition hover:border-aqua-500 hover:bg-aqua-500/10">
            <ShapeDiagram shape={shape} />
            <span className="font-semibold text-white">{shape === 'rectangle' ? 'Rectangle' : 'L-shaped room'}</span>
            <span className="mt-1 block text-xs text-slate-400">{shape === 'rectangle' ? 'Four straight sides.' : 'A room with one corner cut out.'}</span>
          </button>
        ))}
        <button type="button" onClick={onDrawOwn} className="rounded-xl border border-slate-700 bg-slate-800/60 p-5 text-left hover:border-slate-500">
          <div className="mb-4 text-4xl">✏️</div><span className="font-semibold text-white">Draw my own</span><span className="mt-2 block text-xs text-slate-400">Place and move each corner yourself.</span>
        </button>
      </div>
    </div>
  );
};
