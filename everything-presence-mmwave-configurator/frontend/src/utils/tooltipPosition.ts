export interface TooltipRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface TooltipPosition {
  left: number;
  top: number;
  placement: 'top' | 'bottom';
}

export function calculateTooltipPosition(
  trigger: TooltipRect,
  tooltip: Pick<TooltipRect, 'width' | 'height'>,
  viewport: { width: number; height: number },
  gap = 8,
  margin = 8,
): TooltipPosition {
  const fitsAbove = trigger.top - tooltip.height - gap >= margin;
  const placement = fitsAbove || trigger.bottom + tooltip.height + gap > viewport.height - margin ? 'top' : 'bottom';
  const desiredLeft = trigger.left + trigger.width / 2 - tooltip.width / 2;
  const left = Math.max(margin, Math.min(desiredLeft, viewport.width - tooltip.width - margin));
  const desiredTop = placement === 'top' ? trigger.top - tooltip.height - gap : trigger.bottom + gap;
  const top = Math.max(margin, Math.min(desiredTop, viewport.height - tooltip.height - margin));
  return { left, top, placement };
}
