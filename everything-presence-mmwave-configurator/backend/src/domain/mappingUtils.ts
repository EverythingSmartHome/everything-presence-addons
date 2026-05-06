/**
 * Canonical mapping key pairs: [alias, canonical].
 * Canonical form is the second entry (usually the Entity-suffixed key).
 */
export const canonicalKeyPairs: Array<[string, string]> = [
  ['presence', 'presenceEntity'],
  ['mmwave', 'mmwaveEntity'],
  ['pir', 'pirEntity'],
  ['temperature', 'temperatureEntity'],
  ['humidity', 'humidityEntity'],
  ['illuminance', 'illuminanceEntity'],
  ['co2', 'co2Entity'],
  ['distance', 'distanceEntity'],
  ['speed', 'speedEntity'],
  ['energy', 'energyEntity'],
  ['targetCount', 'targetCountEntity'],
  ['mode', 'modeEntity'],
  ['mmwaveMode', 'modeEntity'],
  ['maxDistance', 'maxDistanceEntity'],
  ['mmwaveDistanceMin', 'distanceMinEntity'],
  ['mmwaveDistanceMax', 'distanceMaxEntity'],
  ['mmwaveTriggerDistance', 'triggerDistanceEntity'],
  ['mmwaveSensitivity', 'sensitivityEntity'],
  ['mmwaveTriggerSensitivity', 'triggerSensitivityEntity'],
  ['mmwaveOnLatency', 'onLatencyEntity'],
  ['mmwaveOffLatency', 'offLatencyEntity'],
  ['mmwaveThresholdFactor', 'thresholdFactorEntity'],
  ['microMotion', 'microMotionEntity'],
  ['updateRate', 'updateRateEntity'],
  ['firmwareUpdate', 'firmwareUpdateEntity'],
  ['installationAngle', 'installationAngleEntity'],
  ['polygonZonesEnabled', 'polygonZonesEnabledEntity'],
  ['zone1OccupancyEntity', 'zone1Occupancy'],
  ['zone2OccupancyEntity', 'zone2Occupancy'],
  ['zone3OccupancyEntity', 'zone3Occupancy'],
  ['zone4OccupancyEntity', 'zone4Occupancy'],
  ['zone1TargetCountEntity', 'zone1TargetCount'],
  ['zone2TargetCountEntity', 'zone2TargetCount'],
  ['zone3TargetCountEntity', 'zone3TargetCount'],
  ['zone4TargetCountEntity', 'zone4TargetCount'],
];

export const canonicalKeys = canonicalKeyPairs.map(([, canonical]) => canonical);

/**
 * Normalize mapping keys to ensure compatibility across legacy/new callers.
 * Ensures canonical keys are present while preserving aliases for backward compatibility.
 */
export function normalizeMappingKeys(mappings: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = { ...mappings };

  for (const [aliasKey, canonicalKey] of canonicalKeyPairs) {
    const aliasVal = mappings[aliasKey];
    const canonicalVal = mappings[canonicalKey];

    if (aliasVal && !normalized[canonicalKey]) {
      normalized[canonicalKey] = aliasVal;
    }
    if (canonicalVal && !normalized[aliasKey]) {
      normalized[aliasKey] = canonicalVal;
    }
  }

  return normalized;
}
