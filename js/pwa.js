/* PWA service worker — TEMPORARILY DISABLED for debugging a stale-cache
   issue on mobile. This also actively unregisters any service worker
   already installed from a previous visit and clears its cache, so a
   phone that's been stuck on old files stops being stuck. Re-enable by
   restoring the registration call once caching is no longer a suspect. */
if('serviceWorker' in navigator){
  navigator.serviceWorker.getRegistrations().then(function(regs){
    regs.forEach(function(r){ r.unregister(); });
  }).catch(function(){});
  if(window.caches && caches.keys){
    caches.keys().then(function(keys){
      keys.forEach(function(k){ caches.delete(k); });
    }).catch(function(){});
  }
}
