/* PWA service worker — registers only when hosted (http/https), skipped on file:// */
if('serviceWorker' in navigator && location.protocol.indexOf('http') === 0){
  window.addEventListener('load', function(){
    navigator.serviceWorker.register('sw.js').catch(function(){});
  });
}
