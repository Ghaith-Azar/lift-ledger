import { Router } from 'express';
import { resetAll } from '../db.js';
import { bad } from '../validate.js';

export const adminRouter = Router();

// Requires the exact phrase, not just a boolean, so a stray retry or a
// buggy client can't trigger this by accident. Already sits behind the
// same password-protected session as everything else in /api.
const CONFIRM_PHRASE = 'DELETE ALL DATA';

adminRouter.post('/danger/reset-all-data', async (req, res) => {
  if (req.body?.confirm !== CONFIRM_PHRASE) {
    throw bad(`Send { "confirm": "${CONFIRM_PHRASE}" } to confirm this can't be undone`);
  }
  await resetAll();
  res.json({ ok: true });
});
