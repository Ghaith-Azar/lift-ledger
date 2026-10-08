import { Router } from 'express';
import {
  publicKey,
  pushConfigured,
  reminderSettings,
  saveSubscription,
  removeSubscription,
  setSetting,
  sendTestReminder,
} from '../push.js';
import { bad } from '../validate.js';

export const pushRouter = Router();

pushRouter.get('/push/public-key', (req, res) => {
  res.json({ publicKey: pushConfigured ? publicKey : null });
});

pushRouter.get('/push/settings', async (req, res) => {
  res.json(await reminderSettings());
});

pushRouter.patch('/push/settings', async (req, res) => {
  if (req.body?.enabled !== undefined) {
    await setSetting('weight_reminder_enabled', req.body.enabled ? '1' : '0');
  }
  if (req.body?.day !== undefined) {
    const d = Number(req.body.day);
    if (!Number.isInteger(d) || d < 0 || d > 6) throw bad('day must be 0 (Sunday) to 6 (Saturday)');
    await setSetting('weight_reminder_day', d);
  }
  if (req.body?.hour !== undefined) {
    const hr = Number(req.body.hour);
    if (!Number.isInteger(hr) || hr < 0 || hr > 23) throw bad('hour must be 0-23');
    await setSetting('weight_reminder_hour', hr);
  }
  res.json(await reminderSettings());
});

pushRouter.post('/push/subscribe', async (req, res) => {
  const sub = req.body;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) throw bad('Invalid push subscription');
  await saveSubscription(sub);
  res.status(201).json(await reminderSettings());
});

pushRouter.post('/push/unsubscribe', async (req, res) => {
  await removeSubscription(req.body?.endpoint);
  res.json(await reminderSettings());
});

pushRouter.post('/push/test', async (req, res) => {
  if (!pushConfigured) throw bad('Push is not configured on this server yet');
  res.json(await sendTestReminder());
});
