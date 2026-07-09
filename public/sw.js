// Offline shell for the PWA. Design goals, in priority order:
//  1. never trap the user on a stale build (this is why the cache name is
//     versioned and every activate purges all older caches)
//  2. instant loads when online is unchanged
//  3. still open when briefly offline
//
// Navigation and data are network-first so a fresh deploy always wins; only
// immutable hashed build assets are cache-first (safe: their URL changes every
// build, so a cache hit is always the right file). Bump CACHE on any change to
// this file to force a clean sweep of previous caches.
const CACHE = 'ottos-wx-v3'

self.addEventListener('install', (e) => {
  // take over as soon as possible; don't pre-seed the shell so we can never
  // serve a stale index.html from install time
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return

  // navigation: always try the network, fall back to a cached copy only offline
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put('./', copy))
          return res
        })
        .catch(() => caches.match('./')),
    )
    return
  }

  // score/settings data: network-first so fresh numbers win, cache as backup
  if (url.pathname.includes('/data/')) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(e.request, copy))
          return res
        })
        .catch(() => caches.match(e.request)),
    )
    return
  }

  // hashed build assets + icons: cache-first is safe because the filename
  // changes whenever the content does
  if (url.pathname.includes('/assets/') || url.pathname.endsWith('.png') || url.pathname.endsWith('.webmanifest')) {
    e.respondWith(
      caches.match(e.request).then(
        (hit) =>
          hit ||
          fetch(e.request).then((res) => {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(e.request, copy))
            return res
          }),
      ),
    )
  }
})
