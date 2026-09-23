// Bumped from v1 so activate() drops caches written before API responses
// were filtered (they may hold private, logged-in-only data).
const CACHE_NAME = 'realm-keeper-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json'
];

// Helper: Check if URL is a static asset (JS, CSS, images)
// API-served files (asset library images) are excluded: they're behind login,
// so they go through the API branch and its Cache-Control check instead.
function isStaticAsset(url) {
  if (isApiRequest(url)) return false;
  return /\.(js|css|woff2|woff|ttf|eot|svg|png|jpg|jpeg|webp|gif)(\?|$)/i.test(url);
}

// Helper: Check if URL is an API call
function isApiRequest(url) {
  return url.includes('/api/');
}

// Helper: Whether an API response may be kept in Cache Storage. That cache
// outlives the session (logout doesn't touch it) and is served back whenever
// the network fails, so anything the backend marks no-store/private — login
// state, raw notes for the editor, the player — must never land in it.
function isCacheableApiResponse(response) {
  if (!response || response.status !== 200) return false;
  const cacheControl = response.headers.get('Cache-Control') || '';
  return !/no-store|private/i.test(cacheControl);
}

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
// Note: deliberately does NOT call self.clients.claim() — claiming control of
// already-open/loading pages races with their in-flight initial API requests
// (the browser can't hand an in-progress fetch to a SW that just took over),
// which was turning those requests into fabricated "offline" 503 responses.
// The new worker takes control starting from the next navigation instead.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((cacheName) => cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      );
    })
  );
});

// Fetch event - granular caching strategies
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Strategy 1: Cache-first for static assets (JS, CSS, images, fonts)
  // Serve from cache if available, update cache in background
  if (isStaticAsset(request.url)) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          // Fetch in background to update cache
          fetch(request).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, responseToCache);
              });
            }
          }).catch(() => {
            // Network failed, cached version is fine
          });
          return cachedResponse;
        }

        // Not in cache, fetch from network
        return fetch(request).then((response) => {
          if (!response || response.status !== 200) {
            return response;
          }

          // Cache successful responses
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });

          return response;
        });
      })
    );
  }

  // Strategy 2: Network-first for API calls with cache fallback
  // Try network first, fallback to cache if network fails
  else if (isApiRequest(request.url)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Only cache successful, shareable responses
          if (isCacheableApiResponse(response)) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return response;
        })
        .catch(() => {
          // Network failed, try cache
          return caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // No cache available, return error response
            return new Response(
              JSON.stringify({ error: 'Offline - no cached data available' }),
              {
                status: 503,
                headers: { 'Content-Type': 'application/json' }
              }
            );
          });
        })
    );
  }

  // Strategy 3: Network-first for HTML and other requests
  else {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Clone and cache successful responses
          if (response && response.status === 200) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return response;
        })
        .catch(() => {
          // If network fails, try cache
          return caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // Return offline page for navigation requests
            if (request.mode === 'navigate') {
              return caches.match('/');
            }
            return new Response('Offline', { status: 503 });
          });
        })
    );
  }
});
