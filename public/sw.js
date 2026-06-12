/**
 * FilmSnaps Service Worker — v3
 *
 * Dual purpose:
 *   1. uBlock Origin-style network filtering (blocks ad/tracker domains)
 *   2. PWA offline caching (app shell + navigation)
 *
 * HOW IT WORKS:
 *   - Installs → caches app shell (CSS, JS, fonts, icons) for offline use
 *   - Fetches → serves from cache first for static assets, network for pages
 *   - Ad blocking intercepts requests from provider embed iframes
 */

const SW_VERSION = 3;
const CACHE_NAME = 'filmsnaps-cache-v' + SW_VERSION;
const STATIC_ASSETS = [
  '/icon.svg',
  '/placeholder.jpg',
];

// ═════════════════════════════════════════════════════════════════
// BLOCKED DOMAINS — only full domain names, no generic substrings
// ═════════════════════════════════════════════════════════════════

const BLOCKED_HOSTS = [
  // ── Injected ad networks (confirmed in provider HTML) ──
  'cdn4ads.com',
  'jnbhi.com',
  '5gvci.com',
  'xwskxrfsvcooqt.com',
  'grrebjfkmoddeh.com',

  // ── Analytics injected by providers ──
  'cejpa.com',

  // ── Known ad / popunder networks ──
  'popads.net',
  'popcash.net',
  'popunder.net',
  'adsterra.com',
  'propellerads.com',
  'trafficfactory.biz',
  'adnxs.com',
  'rubiconproject.com',
  'criteo.com',
  'criteo.net',
  'outbrain.com',
  'taboola.com',
  'revcontent.com',

  // ── Crypto miners ──
  'coinhive.com',
  'coinimp.com',
  'webminepool.com',

  // ── Google ad/track (not provider CDNs) ──
  'googletagmanager.com',
  'google-analytics.com',
  'googleadservices.com',
  'googleads.g.doubleclick.net',
  'stats.g.doubleclick.net',
  'pagead2.googlesyndication.com',

  // ── DoubleClick ──
  'ad.doubleclick.net',

  // ── Facebook / Meta tracking ──
  'connect.facebook.net',
  'pixel.facebook.com',
  'an.facebook.com',

  // ── Third-party analytics ──
  'hotjar.com',
  'fullstory.com',
  'logrocket.com',
  'mouseflow.com',
  'clarity.ms',
  'mixpanel.com',
  'amplitude.com',
  'segment.io',
  'rudderstack.com',

  // ── Cloudflare tracking ──
  'cloudflareinsights.com',
  'cloudflare-beacon.com',
];

// ═════════════════════════════════════════════════════════════════
// URL CHECK — blocks if hostname matches BLOCKED_HOSTS
// ═════════════════════════════════════════════════════════════════

function shouldBlock(url) {
  // Never block our own domain
  if (url.startsWith(self.location.origin)) {
    return false;
  }

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    for (let i = 0; i < BLOCKED_HOSTS.length; i++) {
      const blocked = BLOCKED_HOSTS[i];
      if (hostname === blocked || hostname.endsWith('.' + blocked)) {
        return true;
      }
    }
  } catch (e) {
    return false;
  }

  return false;
}

// ═════════════════════════════════════════════════════════════════
// INSTALL — cache static assets for offline use
// ═════════════════════════════════════════════════════════════════

self.addEventListener('install', (event) => {
  console.log('[SW] Install v' + SW_VERSION);
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] Cache addAll partial failure:', err);
      });
    }),
  );
});

// ═════════════════════════════════════════════════════════════════
// ACTIVATE — clean old caches
// ═════════════════════════════════════════════════════════════════

self.addEventListener('activate', (event) => {
  console.log('[SW] Activate v' + SW_VERSION);

  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      );
    }).then(() => clients.claim()),
  );
});

// ═════════════════════════════════════════════════════════════════
// FETCH — cache-first for static assets, network-first for pages
// ═════════════════════════════════════════════════════════════════

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // ── Ad blocking (applies to provider subrequests) ──
  if (shouldBlock(request.url)) {
    console.log('[SW] Blocked:', request.url);
    event.respondWith(
      new Response(null, {
        status: 204,
        statusText: 'Blocked by FilmSnaps Filter',
      }),
    );
    return;
  }

  // ── Only handle GET requests from our origin ──
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // ── Static assets: cache-first ──
  if (
    request.destination === 'style' ||
    request.destination === 'script' ||
    request.destination === 'font' ||
    request.destination === 'image' ||
    url.pathname.match(/\.(css|js|json|woff2?|ttf|eot|svg|png|jpg|ico)$/)
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      }),
    );
    return;
  }

  // ── Navigation / pages: network-first, fallback to cache ──
  if (request.destination === 'document' || request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          // Offline — return cached HTML if available
          return caches.match(request).then(
            (cached) => cached || new Response('Offline', { status: 503 }),
          );
        }),
    );
    return;
  }

  // ── API calls: network-only (never cache player proxied responses) ──
  if (url.pathname.startsWith('/api/')) {
    return;
  }
});
