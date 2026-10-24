// Service worker: makes the game installable and keeps the page shell available offline.
// Network first, so a new deploy is picked up on the next load; the cache is only a fallback.
const CACHE = 'crazyarcade-shell-v1';
const SHELL = ['/crazyarcade/', '/crazyarcade/index.html', '/crazyarcade/js/app.js', '/crazyarcade/css/style.css', '/site.webmanifest', '/icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || !SHELL.includes(url.pathname)) return;
  event.respondWith(fetch(event.request)
    .then((response) => {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      return response;
    })
    .catch(() => caches.match(event.request)));
});
