import { Router } from 'express';
import { ZoneRect } from '../domain/types';

export const createZonesRouter = (): Router => {
  const router = Router();

  router.post('/validate', (req, res) => {
    const zones = (req.body?.zones as ZoneRect[]) ?? [];

    // Note: Overlapping zones are allowed, so we don't return an error for overlaps
    // This validation endpoint is kept for potential future validations

    return res.json({ ok: true });
  });

  return router;
};
