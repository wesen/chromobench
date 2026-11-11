// Chromobench studio service worker (guide §5.5). Hand-written instead of vite-plugin-pwa:
// - the app shell and everything else same-origin: network first, cache fallback, so the studio
//   starts offline after one online visit and the Vite dev server is never served stale code;
// - data packs (/packs/…, content-hashed URLs, CHB-004): cache first, they never go stale.
// A build may list hashed assets to precache in /precache.json.
const CACHE = 'chromobench-shell-v1';
const PACKS = 'chromobench-packs-v1';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(['/', '/manifest.webmanifest', '/icon.svg']).catch(() => undefined);
    try {
      const r = await fetch('/precache.json');
      if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) await cache.addAll(await r.json());
    } catch {
      // dev server: no precache list
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE && k !== PACKS) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/packs/')) {
    event.respondWith((async () => {
      const cache = await caches.open(PACKS);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) await cache.put(req, res.clone());
      return res;
    })());
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') await cache.put(req, res.clone());
      return res;
    } catch (e) {
      const hit = (await cache.match(req)) ?? (req.mode === 'navigate' ? await cache.match('/') : undefined);
      if (hit) return hit;
      throw e;
    }
  })());
});
