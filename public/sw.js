importScripts('/scram/scramjet.all.js');
const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  // Only proxied pages use Scramjet. Login and the workspace use normal requests.
  if (new URL(event.request.url).pathname.startsWith('/service/')) {
    event.respondWith((async () => {
      await scramjet.loadConfig();
      return scramjet.route(event) ? scramjet.fetch(event) : fetch(event.request);
    })());
  }
});
