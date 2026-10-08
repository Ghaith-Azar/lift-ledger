// Caches the app shell (HTML/CSS/JS) so Lift Ledger still opens with no
// signal in the gym. Set-logging itself works offline too, but through a
// separate mechanism (see offlineSets.js) — this file is purely about
// getting the app to load at all.
//
// Bump CACHE below whenever the shell file list changes, so old clients
// pick up the new list instead of serving a stale cache forever.
const CACHE = 'lift-ledger-shell-v2';

const SHELL = [
  '/',
  '/css/styles.css',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/vendor/chart.js/chart.umd.js',
  '/js/main.js',
  '/js/api.js',
  '/js/state.js',
  '/js/util.js',
  '/js/charts.js',
  '/js/offlineSets.js',
  '/js/push.js',
  '/js/exerciseLibrary.js',
  '/js/views/shared.js',
  '/js/views/home.js',
  '/js/views/history.js',
  '/js/views/progress.js',
  '/js/views/split.js',
  '/js/views/workout.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Weekly weigh-in reminders (see src/push.js for when/why these get sent).
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data?.text() };
  }
  const title = data.title || 'Lift Ledger';
  const options = {
    body: data.body || "It's been a week — log your weight?",
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    data: { url: data.url || '/#/progress' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/#/progress';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) {
          if ('navigate' in client) client.navigate(url).catch(() => {});
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // mutations are never cached or replayed here

  const url = new URL(request.url);

  if (url.pathname.startsWith('/api/')) {
    // Reads: prefer the network (so data is always fresh when online), but
    // fall back to the last cached response when there is none.
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // App shell: serve the cached copy immediately so the app opens instantly
  // offline, and refresh the cache in the background for next time.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          caches.open(CACHE).then((c) => c.put(request, res.clone()));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
