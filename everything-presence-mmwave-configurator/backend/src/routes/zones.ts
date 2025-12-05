import { Router } from 'express';
import { ZoneRect } from '../domain/types';

export const createZonesRouter = (): Router => {
  const router = Router();

  router.post('/validate', (req, res) => {
    const zones = (req.body?.zones as ZoneRect[]) ?? [];
    return res.json({ ok: true });
  });

  return router;
};
