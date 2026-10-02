/* Foliant service worker — offline-first.
   Strategy:
   - Install: precache the app shell (all local assets).
   - Fetch:   cache-first for same-origin GETs; network fallback + runtime cache.
   - Navigations: network-first, fall back to the cached shell (offline support).
   Version bump (CACHE name) forces old caches out on the next load. */
const CACHE = 'foliant-v14';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'styles/base.css', 'styles/home.css', 'styles/reader.css', 'styles/content.css',
  'styles/cards.css', 'styles/highlights.css', 'styles/sheets.css',  'styles/search.css', 'styles/nav.css', 'styles/library.css',
  'js/config.js', 'js/utils.js', 'js/parse.js', 'js/structure.js', 'js/render.js',
  'js/cards.js', 'js/ui.js', 'js/nav.js', 'js/search.js', 'js/library.js', 'js/highlights.js', 'js/review.js', 'js/figures.js', 'js/main.js', 'js/iap.js',
  'vendor/pdfjs/pdf.min.js', 'vendor/pdfjs/pdf.worker.min.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put('./', copy));
        return res;
      }).catch(() => caches.match('./').then(r => r || caches.match('index.html')))
    );
    return;
  }
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }))
  );
});
