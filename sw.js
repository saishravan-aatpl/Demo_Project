// Service worker: a small background script the browser keeps for this site.
// It saves a copy of the app's files so the app opens instantly and works offline.
//
// Strategy: "network first". Always try to fetch the latest version; if there is
// no internet, fall back to the saved copy. Bump CACHE_VERSION when files change.

const CACHE_VERSION = 'dashboard-v19';
const APP_FILES = [
  './',
  'index.html',
  'styles.css',
  'config.js',
  'vendor/supabase-js-2.117.3.js',
  'merge.js',
  'lock.js',
  'menu.js',
  'drag.js',
  'app.js',
  'sync.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/favicon.svg',
  'icons/favicon-32.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  // cache: 'reload' = fetch fresh from the server, not from the browser's own short-term cache.
  event.waitUntil(caches.open(CACHE_VERSION).then(cache => cache.addAll(APP_FILES.map(url => new Request(url, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_VERSION).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  // Only handle our own files; let everything else (e.g. future sync server) go straight to the network.
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  // cache: 'no-cache' = always ask the server whether the file changed (a quick check;
  // unchanged files aren't downloaded again). Without it the browser may reuse a copy
  // for up to 10 minutes, so a fresh update wouldn't show on reload.
  event.respondWith(
    fetch(request, { cache: 'no-cache' })
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE_VERSION).then(cache => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true })
        .then(cached => cached || caches.match('index.html')))
  );
});
