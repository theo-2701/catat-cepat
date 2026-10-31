/* App-shell service worker: cache-first for this app's own files.
 * Bump VERSION (and APP_VERSION in app.js) on every deploy so phones pick up the new files.
 * Requests to the Apps Script API are cross-origin and never touched here. */
// shortcut: cache-first means a deploy reaches phones only after a VERSION bump, switch to stale-while-revalidate if bumps get forgotten.
const VERSION = '1.3.1';
const PREFIX = 'catat-cepat-shell-';
const CACHE = PREFIX + VERSION;
// Mascot extension and wallet logo files each live in one place; the worker reads the same files as the page.
importScripts('mascot.js', 'wallets.js');
const SHELL = [
  './',
  './index.html',
  './mascot.js',
  './wallets.js',
  ...self.MASCOT.states.map((s) => `./icons/mascot/${s}.${self.MASCOT.ext}`),
  ...Object.values(self.WALLET_STYLES).filter((s) => s.logo).map((s) => `./icons/wallets/${s.logo}`),
  './core.js',
  './app.js',
  './styles.css',
  './mock-api.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const root = new URL('./', self.registration.scope).pathname;
  if (req.mode === 'navigate' && (url.pathname === root || url.pathname === root + 'index.html')) {
    // The app page with any ?query (e.g. ?mock=1) gets the cached shell; other pages like tests.html fall through.
    event.respondWith(caches.match('./index.html').then((hit) => hit || fetch(req)));
    return;
  }

  event.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') {
      const copy = res.clone();
      caches.open(CACHE).then((cache) => cache.put(req, copy));
    }
    return res;
  })());
});
