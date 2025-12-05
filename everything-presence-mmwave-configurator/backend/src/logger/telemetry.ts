import { logger } from '../logger';

export const telemetry = {
  conflict(templateKey: string, candidates: string[]) {
    logger.info({ templateKey, candidates }, 'Entity match conflict detected');
  },
  validationFail(deviceId: string | undefined, errors: Array<{ key: string; entityId: string; error: string }>) {
    logger.warn({ deviceId, errorCount: errors.length, sample: errors.slice(0, 5) }, 'Mapping validation failed');
  },
  validationSuccess(deviceId: string | undefined) {
    logger.debug({ deviceId }, 'Mapping validation succeeded');
  },
  overwriteAttempt(deviceId: string | undefined, key: string, from: string | undefined, to: string | undefined) {
    logger.info({ deviceId, key, from, to }, 'Mapping overwrite attempt');
  },
};
