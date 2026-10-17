// Service worker cache policy.
//
// Commerce is deliberately fail-safe: API traffic is left entirely to the browser,
// while the few commerce resources that must also bypass the browser HTTP cache are
// network-only. Cache Storage is reserved for URLs carrying a content hash.

const CACHE_PREFIX = 'teddywarner-';
const CACHE_NAME = 'teddywarner-static-v2';
const CONTENT_HASH = /^[a-f0-9]{8,64}$/i;
const HASHED_FILENAME = /(?:^|[._-])[a-f0-9]{8,64}\.[a-z0-9]+$/i;
const COMMERCE_CLIENT_PATHS = new Set([
  '/assets/js/store.js',
  '/assets/js/store-data.js'
]);

function isApiRequest(url) {
  return url.pathname === '/api' || url.pathname.startsWith('/api/');
}

function isRouteOrChild(pathname, route) {
  return pathname === route || pathname.startsWith(route + '/');
}

function hasContentHash(url) {
  const queryHash = url.searchParams.get('h');
  if (queryHash && CONTENT_HASH.test(queryHash)) {
    return true;
  }

  const filename = url.pathname.slice(url.pathname.lastIndexOf('/') + 1);
  return HASHED_FILENAME.test(filename);
}

function isCommerceNetworkOnly(url) {
  return url.pathname === '/store-catalog.json' ||
    isRouteOrChild(url.pathname, '/store') ||
    (COMMERCE_CLIENT_PATHS.has(url.pathname) && !hasContentHash(url));
}

function isHashedStaticAsset(url) {
  const staticPath = url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/stylesheets/') ||
    url.pathname.startsWith('/javascripts/');
  return staticPath && hasContentHash(url);
}

self.addEventListener('install', event => {
  // There is intentionally no precache list: the previous list contained mutable,
  // unhashed HTML/CSS/JS URLs. Hashed assets are populated on demand instead.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(cacheNames => Promise.all(
        cacheNames
          .filter(cacheName => cacheName.startsWith(CACHE_PREFIX) && cacheName !== CACHE_NAME)
          .map(cacheName => caches.delete(cacheName))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // Do not call respondWith for APIs. This prevents the worker from reading,
  // writing, or replaying an API response even when a stale entry still exists.
  if (isApiRequest(url)) {
    return;
  }

  // Store pages, checkout/confirmation state, the trusted catalog, and an
  // unversioned commerce client never fall back to Cache Storage or the HTTP cache.
  if (isCommerceNetworkOnly(url)) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  // Cache-first is safe only when the URL changes with the file contents. The
  // MkDocs cache_bust hook gives store.js an eight-character SHA-1 `h` value;
  // conventional hash-in-filename assets are supported too.
  if (!isHashedStaticAsset(url)) {
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      cache.match(request).then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(request).then(response => {
          if (response.status !== 200) {
            return response;
          }

          return cache.put(request, response.clone())
            .catch(() => undefined)
            .then(() => response);
        });
      })
    )
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
