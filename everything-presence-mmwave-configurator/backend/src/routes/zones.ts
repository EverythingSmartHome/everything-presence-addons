import { Router } from 'express';
import { RoomConfig, ZoneRect } from '../domain/types';

export const createZonesRouter = (): Router => {
  const router = Router();

  router.post('/validate', (req, res) => {
    const zones = (req.body?.zones as ZoneRect[]) ?? [];
    const overlap = new Set<string>();

    for (let i = 0; i < zones.length; i += 1) {
      for (let j = i + 1; j < zones.length; j += 1) {
        const a = zones[i];
        const b = zones[j];
        const intersect =
          a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
        if (intersect) {
          overlap.add(`${a.id}|${b.id}`);
        }
      }
    }

    if (overlap.size > 0) {
      return res.status(400).json({ message: 'Zones overlap', overlaps: Array.from(overlap) });
    }

    return res.json({ ok: true });
  });

  return router;
};
