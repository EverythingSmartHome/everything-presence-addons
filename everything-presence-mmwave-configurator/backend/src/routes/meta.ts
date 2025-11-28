import { Router } from 'express';
import { AppConfig, redactedHaConfig } from '../config';
import type { TransportStatus } from '../server';

export const createMetaRouter = (config: AppConfig, transportStatus?: TransportStatus): Router => {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      mode: config.ha.mode,
      readTransport: transportStatus?.readTransport ?? 'unknown',
      timestamp: new Date().toISOString(),
    });
  });

  router.get('/config', (_req, res) => {
    res.json({
      port: config.port,
      mode: config.ha.mode,
      readTransport: transportStatus?.readTransport ?? 'unknown',
      writeTransport: transportStatus?.writeTransport ?? 'rest',
      transportStatus: transportStatus
        ? {
            websocket: transportStatus.wsAvailable ? 'available' : 'unavailable',
            rest: transportStatus.restAvailable ? 'available' : 'unavailable',
          }
        : undefined,
      ha: redactedHaConfig(config.ha),
    });
  });

  return router;
};
