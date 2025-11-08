// Geometry scaling helpers (millimeters <-> canvas px)
// Keep scale derived from canvas width (0.08 px/mm when 960px wide for 12000mm span)

const DEFAULTS = {
  halfWidthMm: 6000, // X spans -6000..+6000 mm
};

// getCtx should return an object like { scale:number, offsetY:number, halfWidthMm?:number }
export function createScaler(getCtx) {
  return {
    scaleX(valueMm) {
      const { scale, halfWidthMm = DEFAULTS.halfWidthMm } = getCtx();
      return (valueMm + halfWidthMm) * scale;
    },
    unscaleX(px) {
      const { scale, halfWidthMm = DEFAULTS.halfWidthMm } = getCtx();
      return px / scale - halfWidthMm;
    },
    scaleY(valueMm) {
      const { scale, offsetY = 0 } = getCtx();
      return (valueMm + offsetY) * scale;
    },
    unscaleY(px) {
      const { scale, offsetY = 0 } = getCtx();
      return px / scale - offsetY;
    },
  };
}

