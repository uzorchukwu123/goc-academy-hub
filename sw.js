/* G.O.C Academy Hub — service worker.
   Caches the app shell so the hub opens offline. Bump CACHE on every release,
   otherwise returning students keep the old files. */
const CACHE = 'goc-v35';
const ASSETS = [
  './index.html',
  './css/styles.css',
  './js/goc-core.js',
  './js/api.js',
  './js/app.js',
  './js/pwa.js',
  './js/vendor/pdfjs/pdf.min.mjs',
  './js/vendor/pdfjs/pdf.worker.min.mjs',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', e => e.waitUntil(
  caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
));

self.addEventListener('activate', e => e.waitUntil(
  caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
));

/* Cache-first for the shell. Anything not cached falls through to the network,
   so future API calls are never served a stale response from here. */
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
