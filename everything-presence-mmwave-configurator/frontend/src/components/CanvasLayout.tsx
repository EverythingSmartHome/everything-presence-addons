import React from 'react';

const joinClasses = (...classes: Array<string | false | null | undefined>) => (
  classes.filter(Boolean).join(' ')
);

interface CanvasPageShellProps {
  children: React.ReactNode;
  className?: string;
}

export const CanvasPageShell: React.FC<CanvasPageShellProps> = ({ children, className }) => (
  <div className={joinClasses('fixed inset-0 overflow-hidden bg-slate-950 text-slate-100', className)}>
    {children}
  </div>
);

interface CanvasTopBarProps {
  left?: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}

export const CanvasTopBar: React.FC<CanvasTopBarProps> = ({
  left,
  title,
  subtitle,
  right,
  className,
}) => (
  <div
    className={joinClasses(
      'pointer-events-auto absolute left-0 right-0 top-0 z-50 flex min-h-[56px] items-center gap-3 border-b border-slate-700/60 bg-slate-950/95 px-3 py-2 shadow-xl backdrop-blur mobile-safe-top',
      className,
    )}
  >
    {left && <div className="flex shrink-0 items-center gap-2">{left}</div>}
    <div className="min-w-0 flex-1">
      {title && <div className="truncate text-sm font-bold text-white">{title}</div>}
      {subtitle && <div className="truncate text-xs text-slate-400">{subtitle}</div>}
    </div>
    {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
  </div>
);

interface CanvasBottomToolbarProps {
  children: React.ReactNode;
  className?: string;
}

export const CanvasBottomToolbar: React.FC<CanvasBottomToolbarProps> = ({ children, className }) => (
  <div
    className={joinClasses(
      'pointer-events-auto absolute bottom-0 left-0 right-0 z-50 border-t border-slate-700/60 bg-slate-950/95 px-3 py-2 shadow-2xl backdrop-blur mobile-safe-bottom',
      className,
    )}
  >
    <div className="flex items-center justify-around gap-2">
      {children}
    </div>
  </div>
);

interface CanvasToolbarButtonProps {
  label: string;
  icon?: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  badge?: React.ReactNode;
  onClick?: () => void;
  className?: string;
}

export const CanvasToolbarButton: React.FC<CanvasToolbarButtonProps> = ({
  label,
  icon,
  active = false,
  disabled = false,
  badge,
  onClick,
  className,
}) => (
  <button
    type="button"
    aria-pressed={active}
    disabled={disabled}
    onClick={onClick}
    className={joinClasses(
      'relative flex min-h-[44px] min-w-[56px] flex-1 flex-col items-center justify-center gap-0.5 rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-40',
      active
        ? 'border-aqua-500 bg-aqua-500/20 text-aqua-100 shadow-lg shadow-aqua-500/10'
        : 'border-slate-700/70 bg-slate-900/80 text-slate-200 hover:border-slate-600 hover:bg-slate-800',
      className,
    )}
  >
    {icon && <span className="text-base leading-none">{icon}</span>}
    <span className="max-w-full truncate leading-tight">{label}</span>
    {badge && (
      <span className="absolute -right-1 -top-1 rounded-full bg-aqua-500 px-1.5 py-0.5 text-[9px] font-bold leading-none text-slate-950">
        {badge}
      </span>
    )}
  </button>
);

interface CanvasMobileSheetProps {
  open: boolean;
  title: React.ReactNode;
  children: React.ReactNode;
  onClose: () => void;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export const CanvasMobileSheet: React.FC<CanvasMobileSheetProps> = ({
  open,
  title,
  description,
  children,
  footer,
  onClose,
  className,
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] md:hidden">
      <button
        type="button"
        aria-label="Close panel"
        className="mobile-sheet-backdrop absolute inset-0 bg-black/45"
        onClick={onClose}
      />
      <section
        className={joinClasses(
          'mobile-sheet-panel absolute bottom-0 left-0 right-0 max-h-[82dvh] overflow-hidden rounded-t-2xl border-t border-slate-700 bg-slate-900 shadow-2xl mobile-safe-bottom',
          className,
        )}
        role="dialog"
        aria-modal="true"
      >
        <div className="sticky top-0 z-10 border-b border-slate-700/70 bg-slate-900/95 px-4 py-3 backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-base font-bold text-white">{title}</h2>
              {description && <div className="mt-0.5 text-xs text-slate-400">{description}</div>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="min-h-[36px] rounded-lg border border-slate-700 bg-slate-800 px-3 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-700"
            >
              Close
            </button>
          </div>
        </div>
        <div className="max-h-[calc(82dvh-68px)] overflow-y-auto px-4 py-3">
          {children}
        </div>
        {footer && (
          <div className="border-t border-slate-700/70 bg-slate-900/95 px-4 py-3">
            {footer}
          </div>
        )}
      </section>
    </div>
  );
};

interface CanvasFloatingPanelProps {
  children: React.ReactNode;
  className?: string;
}

export const CanvasFloatingPanel: React.FC<CanvasFloatingPanelProps> = ({ children, className }) => (
  <div
    className={joinClasses(
      'rounded-xl border border-slate-700/50 bg-slate-900/90 shadow-xl backdrop-blur',
      className,
    )}
  >
    {children}
  </div>
);
