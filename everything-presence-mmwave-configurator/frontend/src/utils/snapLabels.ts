export const formatSnapPresetLabel = (
  snapMm: number,
  units: 'metric' | 'imperial'
): string => {
  if (snapMm === 0) return 'Off';
  if (units === 'metric') return `${snapMm}mm`;

  const inches = snapMm / 25.4;
  const roundedInches = Math.round(inches);

  if (Math.abs(inches - roundedInches) < 0.2) {
    return `${roundedInches} in`;
  }

  return `${inches.toFixed(1)} in`;
};
