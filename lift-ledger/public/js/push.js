// Thin wrapper around the browser's Push API. Everything here is about the
// subscription handshake; what happens once a push arrives is in sw.js, and
// when/why one gets sent at all is server-side (src/push.js).

import { api } from './api.js';

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** The subscription for this browser, or null if there isn't one. */
export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/**
 * Asks for notification permission (must be called from a user gesture,
 * e.g. a button's onClick) and registers the subscription with the server.
 * Throws with a message suitable for showing directly in a toast.
 */
export async function subscribeToPush() {
  if (!pushSupported()) throw new Error("This browser doesn't support push notifications");

  const { publicKey } = await api.get('/api/push/public-key');
  if (!publicKey) throw new Error('Push notifications are not set up on this server yet');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notifications were not allowed — check your browser or system settings');
  }

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await withTimeout(
      reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }),
      15000,
      'Timed out reaching the push service — check your connection and try again'
    );
  }
  await api.post('/api/push/subscribe', sub.toJSON());
  return sub;
}

export async function unsubscribeFromPush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await api.post('/api/push/unsubscribe', { endpoint: sub.endpoint });
  await sub.unsubscribe();
}
