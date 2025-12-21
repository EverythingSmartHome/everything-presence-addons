import { Router } from 'express';
import { storage } from '../config/storage';

export const createSettingsRouter = (): Router => {
  const router = Router();

  router.get('/', (_req, res) => {
    const settings = storage.getSettings();
    res.json({ settings });
  });

  router.put('/', (req, res) => {
    const nextSettings: Record<string, unknown> = {};
    if (typeof req.body?.wizardCompleted === 'boolean') {
      nextSettings.wizardCompleted = req.body.wizardCompleted;
    }
    if (typeof req.body?.wizardStep === 'string') {
      nextSettings.wizardStep = req.body.wizardStep;
    }
    if (typeof req.body?.outlineDone === 'boolean') {
      nextSettings.outlineDone = req.body.outlineDone;
    }
    if (typeof req.body?.placementDone === 'boolean') {
      nextSettings.placementDone = req.body.placementDone;
    }
    if (typeof req.body?.zonesReady === 'boolean') {
      nextSettings.zonesReady = req.body.zonesReady;
    }
    if (typeof req.body?.defaultRoomId === 'string') {
      nextSettings.defaultRoomId = req.body.defaultRoomId;
    } else if (req.body?.defaultRoomId === null) {
      nextSettings.defaultRoomId = null;
    }
    const next = storage.saveSettings(nextSettings);
    res.json({ settings: next });
  });

  return router;
};
