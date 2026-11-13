import { Router } from 'express';
import { DeviceApiStorage, isValidHost } from '../config/deviceApiStorage';
import { decodeNoisePsk } from '../esphome/noise';

/**
 * GET/PUT /api/devices/:deviceId/api-connection
 *
 * Manual host override and API encryption key for the live log viewer.
 * The key is write-only: responses only say whether one is saved.
 */
export const createDeviceApiConnectionRouter = (storage: DeviceApiStorage): Router => {
  const router = Router();

  const view = (deviceId: string) => {
    const saved = storage.get(deviceId);
    return {
      host: saved.host ?? null,
      hostSource: saved.hostSource ?? null,
      hasKey: Boolean(saved.noisePsk),
    };
  };

  router.get('/:deviceId/api-connection', (req, res) => {
    res.json(view(req.params.deviceId));
  });

  router.put('/:deviceId/api-connection', (req, res) => {
    const { deviceId } = req.params;
    const body = (req.body ?? {}) as { manualHost?: unknown; encryptionKey?: unknown };

    if (body.manualHost !== undefined) {
      if (body.manualHost === null || body.manualHost === '') {
        storage.setManualHost(deviceId, null);
      } else if (typeof body.manualHost === 'string' && isValidHost(body.manualHost)) {
        storage.setManualHost(deviceId, body.manualHost);
      } else {
        res.status(400).json({ message: 'Enter a hostname or IP address (without http:// or a port).' });
        return;
      }
    }

    if (body.encryptionKey !== undefined) {
      if (body.encryptionKey === null || body.encryptionKey === '') {
        storage.setNoisePsk(deviceId, null);
      } else if (typeof body.encryptionKey === 'string' && decodeNoisePsk(body.encryptionKey)) {
        storage.setNoisePsk(deviceId, body.encryptionKey);
      } else {
        res.status(400).json({ message: 'The encryption key must be the 44-character base64 key from the device YAML.' });
        return;
      }
    }

    res.json(view(deviceId));
  });

  return router;
};
