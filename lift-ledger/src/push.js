import webpush from 'web-push';
import { all, get, run, batch } from './db.js';
import { weekStart } from './analytics.js';

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const SUBJECT = process.env.VAPID_SUBJECT || '';

export const pushConfigured = Boolean(PUBLIC_KEY && PRIVATE_KEY && SUBJECT);
export const publicKey = PUBLIC_KEY;

if (pushConfigured) {
  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
}

// ---------- Settings (tiny key/value store) ----------

const DEFAULTS = {
  weight_reminder_enabled: '1',
  weight_reminder_day: '1', // 0 = Sunday .. 6 = Saturday (matches Date#getUTCDay)
  weight_reminder_hour: '8', // 0-23, UTC
};

async function getSetting(key) {
  const row = await get('SELECT value FROM app_settings WHERE key = ?', [key]);
  return row ? row.value : DEFAULTS[key];
}

export async function setSetting(key, value) {
  await run(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [key, String(value)]
  );
}

export async function reminderSettings() {
  const count = await get('SELECT COUNT(*) AS n FROM push_subscriptions');
  return {
    configured: pushConfigured,
    enabled: (await getSetting('weight_reminder_enabled')) === '1',
    day: Number(await getSetting('weight_reminder_day')),
    hour: Number(await getSetting('weight_reminder_hour')),
    subscription_count: count.n,
  };
}

// ---------- Subscriptions ----------

export async function saveSubscription(sub) {
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    throw new Error('Invalid push subscription');
  }
  await run(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES (?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`,
    [sub.endpoint, sub.keys.p256dh, sub.keys.auth]
  );
}

export async function removeSubscription(endpoint) {
  if (endpoint) await run('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
}

// ---------- Sending ----------

async function sendToAll(payload) {
  if (!pushConfigured) return { sent: 0, total: 0 };
  const subs = await all('SELECT * FROM push_subscriptions');
  let sent = 0;
  const dead = [];
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload)
      );
      sent++;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        dead.push(s.id); // the push service says this subscription no longer exists
      } else {
        console.warn('Push send failed:', err.message);
      }
    }
  }
  if (dead.length) {
    await batch(dead.map((id) => ({ sql: 'DELETE FROM push_subscriptions WHERE id = ?', args: [id] })));
  }
  return { sent, total: subs.length, pruned: dead.length };
}

export async function sendTestReminder() {
  return sendToAll({ title: 'Lift Ledger (test)', body: 'Push notifications are working.', url: '/#/progress' });
}

/**
 * Run on a schedule (both an in-process timer and an optional external
 * cron hit call this). Sends at most once per day, only on the configured
 * day/hour (UTC), and only if nothing has been logged yet this week —
 * no point reminding you to do something you already did.
 */
export async function checkAndSendReminder() {
  if (!pushConfigured) return { attempted: false, reason: 'not configured' };
  const settings = await reminderSettings();
  if (!settings.enabled) return { attempted: false, reason: 'disabled' };
  if (!settings.subscription_count) return { attempted: false, reason: 'no subscriptions' };

  const now = new Date();
  if (now.getUTCDay() !== settings.day) return { attempted: false, reason: 'not the configured day' };
  if (now.getUTCHours() < settings.hour) return { attempted: false, reason: 'before the configured hour' };

  const today = now.toISOString().slice(0, 10);
  const lastSent = await getSetting('weight_reminder_last_sent');
  if (lastSent === today) return { attempted: false, reason: 'already sent today' };

  const monday = weekStart(today);
  const already = await get('SELECT 1 FROM bodyweight_logs WHERE archived = 0 AND date >= ? LIMIT 1', [monday]);

  // Either way, today is "handled" — don't re-check every 30 minutes for the rest of the day.
  await setSetting('weight_reminder_last_sent', today);
  if (already) return { attempted: false, reason: 'already logged this week' };

  const result = await sendToAll({ title: 'Lift Ledger', body: "It's been a week — log your weight?", url: '/#/progress' });
  return { attempted: true, ...result };
}

export function startScheduler() {
  if (!pushConfigured) return;
  const INTERVAL = 30 * 60 * 1000;
  setInterval(() => {
    checkAndSendReminder().catch((err) => console.warn('Weight reminder check failed:', err.message));
  }, INTERVAL);
  // Also check once shortly after boot, in case the server was asleep right at the scheduled time.
  checkAndSendReminder().catch(() => {});
}
