import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import { AppConfig, redactedHaConfig } from '../config';
import type { TransportStatus } from '../server';

const readAppVersion = (): string => {
  const candidates = [
    path.resolve(process.cwd(), 'config.yaml'),
    path.resolve(process.cwd(), '../config.yaml'),
    path.resolve(__dirname, '../../../config.yaml'),
  ];

  for (const candidate of candidates) {
    try {
      const raw = fs.readFileSync(candidate, 'utf8');
      const match = raw.match(/^version:\s*([^\r\n]+)/m);
      if (match?.[1]) {
        return match[1].trim();
      }
    } catch {
      // Try the next likely location.
    }
  }

  return 'unknown';
};

export const createMetaRouter = (config: AppConfig, transportStatus?: TransportStatus): Router => {
  const router = Router();
  const appVersion = readAppVersion();

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      appVersion,
      mode: config.ha.mode,
      readTransport: transportStatus?.readTransport ?? 'unknown',
      timestamp: new Date().toISOString(),
    });
  });

  router.get('/config', (_req, res) => {
    res.json({
      appVersion,
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
