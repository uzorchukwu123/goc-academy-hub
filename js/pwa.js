/* PWA service worker registration.
   Registers sw.js so the app shell is cached and the hub opens offline.
   Skipped when the page is opened straight from a file (file://), where
   service workers are not allowed. Bump CACHE in sw.js on every release
   so returning students pick up new files instead of a stale cache. */
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js').catch(function () {});
  });
}
