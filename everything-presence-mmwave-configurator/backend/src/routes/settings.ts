import { Router } from 'express';
import { storage } from '../config/storage';

export const createSettingsRouter = (): Router => {
  const router = Router();

  router.get('/', (_req, res) => {
    const settings = storage.getSettings();
    res.json({ settings });
  });

  router.put('/', (req, res) => {
    const next = storage.saveSettings({
      wizardCompleted:
        typeof req.body?.wizardCompleted === 'boolean' ? req.body.wizardCompleted : undefined,
      wizardStep: typeof req.body?.wizardStep === 'string' ? req.body.wizardStep : undefined,
      outlineDone: typeof req.body?.outlineDone === 'boolean' ? req.body.outlineDone : undefined,
      placementDone: typeof req.body?.placementDone === 'boolean' ? req.body.placementDone : undefined,
      zonesReady: typeof req.body?.zonesReady === 'boolean' ? req.body.zonesReady : undefined,
    });
    res.json({ settings: next });
  });

  return router;
};
