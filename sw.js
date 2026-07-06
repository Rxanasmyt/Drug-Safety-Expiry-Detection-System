/* PharmaCare Service Worker — offline shell + asset cache */
const CACHE = 'pharmacare-v2';
const SHELL = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/firebase-config.js',
  '/js/app.js',
  '/manifest.json',
  '/icons/icon.svg',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('push', e => {
  let data = {};
  try { data = e.data?.json() ?? {}; } catch(_) {}
  const title = data.title || 'PharmaCare — แจ้งเตือนยา';
  const body  = data.body  || 'มียาใกล้หมดอายุหรือหมดอายุแล้ว กรุณาตรวจสอบ';
  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icons/icon.svg',
      badge: '/icons/icon.svg',
      tag: 'pharmacare-alert',
      requireInteraction: !!data.critical,
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.startsWith(self.registration.scope));
      return existing ? existing.focus() : clients.openWindow(url);
    })
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Firebase & Google APIs → network only
  if (url.hostname.includes('firebase') || url.hostname.includes('googleapis')) return;

  // Network-first: this app ships fixes frequently, so a returning user must
  // get the current index.html/app.js/styles.css whenever they have
  // connectivity. Cache is only a fallback for genuinely offline use — the
  // previous "cache-first" strategy (return cached || fresh) served a
  // possibly months-old app.js forever, since the cache is never invalidated
  // just because the server's files changed.
  e.respondWith(
    fetch(e.request).then(res => {
      if (res && res.status === 200 && res.type === 'basic') {
        caches.open(CACHE).then(c => c.put(e.request, res.clone()));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
