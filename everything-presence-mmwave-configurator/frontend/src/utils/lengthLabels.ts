export const formatLengthLabel = (
  mm: number,
  units: 'metric' | 'imperial'
): string => {
  if (units === 'metric') {
    return `${(mm / 1000).toFixed(2)} m`;
  }

  const totalInches = Math.round(mm / 25.4);
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;

  if (feet <= 0) {
    return `${inches} in`;
  }

  if (inches === 0) {
    return `${feet} ft`;
  }

  return `${feet} ft ${inches} in`;
};

export const parseLengthInput = (
  rawValue: string,
  units: 'metric' | 'imperial'
): number | null => {
  const trimmed = rawValue.trim();
  if (!trimmed) return null;

  if (units === 'metric') {
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed * 1000 : null;
  }

  const decimalFeet = Number(trimmed);
  if (Number.isFinite(decimalFeet)) {
    return decimalFeet * 304.8;
  }

  const normalized = trimmed
    .toLowerCase()
    .replace(/feet|foot/g, 'ft')
    .replace(/inches|inch/g, 'in');

  const feetMatch = normalized.match(/(-?\d+(?:\.\d+)?)\s*(?:ft|')/);
  const inchesMatch = normalized.match(/(-?\d+(?:\.\d+)?)\s*(?:in|")/);

  if (!feetMatch && !inchesMatch) {
    return null;
  }

  const feet = feetMatch ? Number(feetMatch[1]) : 0;
  const inches = inchesMatch ? Number(inchesMatch[1]) : 0;

  if (!Number.isFinite(feet) || !Number.isFinite(inches)) {
    return null;
  }

  return (feet * 12 + inches) * 25.4;
};
