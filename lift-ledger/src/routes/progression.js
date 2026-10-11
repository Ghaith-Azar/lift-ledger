import { Router } from 'express';
import { getProgressionSettings, saveProgressionSettings } from '../progression.js';

export const progressionRouter = Router();

progressionRouter.get('/progression/settings', async (req, res) => {
  res.json(await getProgressionSettings());
});

progressionRouter.patch('/progression/settings', async (req, res) => {
  res.json(await saveProgressionSettings(req.body || {}));
});
