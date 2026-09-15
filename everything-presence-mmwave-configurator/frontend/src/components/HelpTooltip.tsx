import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { calculateTooltipPosition, type TooltipPosition } from '../utils/tooltipPosition';

interface HelpTooltipProps {
  children: React.ReactNode;
  id?: string;
  label?: string;
}

export const HelpTooltip: React.FC<HelpTooltipProps> = ({ children, id, label = 'More information' }) => {
  const generatedId = useId();
  const tooltipId = id ?? `help-${generatedId.replace(/:/g, '')}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition>();

  const reposition = useCallback(() => {
    if (!triggerRef.current || !tooltipRef.current) return;
    const trigger = triggerRef.current.getBoundingClientRect();
    const tooltip = tooltipRef.current.getBoundingClientRect();
    setPosition(calculateTooltipPosition(trigger, tooltip, { width: window.innerWidth, height: window.innerHeight }));
  }, []);

  useLayoutEffect(() => {
    if (open) reposition();
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!triggerRef.current?.contains(event.target as Node) && !tooltipRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', keydown);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', keydown);
    };
  }, [open, reposition]);

  return (
    <span className="inline-flex shrink-0" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-describedby={tooltipId}
        aria-expanded={open}
        onClick={(event) => { event.preventDefault(); event.stopPropagation(); setOpen((value) => !value); }}
        onFocus={() => setOpen(true)}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-slate-400 hover:bg-slate-700 hover:text-slate-100 focus:outline-none focus:ring-2 focus:ring-aqua-500"
      >
        <span aria-hidden="true">?</span>
      </button>
      {createPortal(
        <div
          ref={tooltipRef}
          id={tooltipId}
          role="tooltip"
          style={open ? { left: position?.left ?? -9999, top: position?.top ?? -9999 } : undefined}
          className={open
            ? 'fixed z-[100] max-w-[min(18rem,calc(100vw-1rem))] rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-left text-xs font-normal leading-relaxed text-slate-100 shadow-xl'
            : 'sr-only'}
        >
          {children}
        </div>,
        document.body,
      )}
    </span>
  );
};
