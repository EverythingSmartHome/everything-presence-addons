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
