// Bumped from v1 so activate() drops caches written before API responses
// were filtered (they may hold private, logged-in-only data); from v2 so it
// drops the hashed chunks every deploy had piled up in it (see below).
const CACHE_NAME = 'realm-keeper-v3';

// The build's own files (JS, CSS, fonts, images) are kept apart, one cache per
// build: their names change with every deploy, so in one cache the chunks of
// every build ever visited would pile up for good. A build is known by its
// entry script's hash (/assets/index-<hash>.js in index.html), read from each
// page loaded from the network. The current build and the one before are
// kept (a tab still open on the old one may yet load one of its chunks);
// older ones are dropped as a new one is seen.
const BUILD_CACHE_PREFIX = 'realm-keeper-build-';
const BUILDS_KEPT = 2;
const META_CACHE = 'realm-keeper-meta';
const BUILDS_KEY = '/__realm-keeper-builds';
const ENTRY_SCRIPT = /\/assets\/index-([\w-]+)\.js/;
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

// The builds seen, oldest first (kept in Cache Storage: a worker's own
// variables don't outlive it being stopped between events).
async function readBuilds() {
  const cache = await caches.open(META_CACHE);
  const stored = await cache.match(BUILDS_KEY);
  return stored ? stored.json() : [];
}

async function writeBuilds(builds) {
  const cache = await caches.open(META_CACHE);
  await cache.put(BUILDS_KEY, new Response(JSON.stringify(builds), { headers: { 'Content-Type': 'application/json' } }));
}

// One update at a time: two pages loading at once must not race.
let buildsQueue = Promise.resolve();

function noteBuild(html) {
  const match = ENTRY_SCRIPT.exec(html);
  if (!match) return buildsQueue;
  const build = match[1];
  buildsQueue = buildsQueue.then(async () => {
    const builds = await readBuilds();
    if (builds[builds.length - 1] === build) return;
    const kept = [...builds.filter((b) => b !== build), build].slice(-BUILDS_KEPT);
    await writeBuilds(kept);
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith(BUILD_CACHE_PREFIX) && !kept.includes(name.slice(BUILD_CACHE_PREFIX.length)))
        .map((name) => caches.delete(name))
    );
  }).catch(() => {});
  return buildsQueue;
}

// Where a build file goes: the cache of the latest build seen ("unknown"
// before any is, which goes as soon as one is).
async function buildCacheName() {
  await buildsQueue;
  const builds = await readBuilds().catch(() => []);
  return BUILD_CACHE_PREFIX + (builds.length ? builds[builds.length - 1] : 'unknown');
}

function cacheStaticAsset(request, response) {
  return buildCacheName().then((name) => caches.open(name)).then((cache) => cache.put(request, response));
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
          .filter((cacheName) => cacheName !== CACHE_NAME && cacheName !== META_CACHE && !cacheName.startsWith(BUILD_CACHE_PREFIX))
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
              cacheStaticAsset(request, networkResponse.clone());
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
          cacheStaticAsset(request, response.clone());

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
            // A page from the network says which build is live now.
            if (request.mode === 'navigate') {
              const noted = response.clone().text().then(noteBuild).catch(() => {});
              try {
                event.waitUntil(noted);
              } catch {
                // Too late to extend the event: it still runs, just unguarded.
              }
            }
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
