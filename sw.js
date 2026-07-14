/* ================================================
   SportHub — Service Worker
   Strategy:
     - HTML          → network-first
     - versioned JS/CSS → cache-first
     - Firebase Storage 圖片 → stale-while-revalidate（獨立快取）
   ================================================ */

const CACHE_NAME       = 'sporthub-0.20260714d';
const PRECACHE_VERSION = CACHE_NAME.replace('sporthub-', '');
const IMAGE_CACHE_NAME = 'sporthub-images-v2';
const MAX_IMAGE_CACHE  = 300;
const MAX_IMAGE_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const IMAGE_CACHE_TRIM_INTERVAL = 20;

function withPrecacheVersion(asset) {
  const separator = asset.includes('?') ? '&' : '?';
  return `${asset}${separator}v=${encodeURIComponent(PRECACHE_VERSION)}`;
}

const STATIC_ASSETS = [
  './',
  './index.html',
  withPrecacheVersion('./css/base.css'),
  withPrecacheVersion('./css/layout.css'),
  withPrecacheVersion('./css/home.css'),
  withPrecacheVersion('./js/i18n.js'),
  withPrecacheVersion('./js/config.js'),
  withPrecacheVersion('./js/core/history-route-flags.js'),
  withPrecacheVersion('./js/core/history-route-adapter.js'),
  withPrecacheVersion('./js/core/page-loader.js'),
  withPrecacheVersion('./js/core/navigation.js'),
  withPrecacheVersion('./js/core/theme.js'),
  withPrecacheVersion('./js/core/script-loader.js'),
  withPrecacheVersion('./pages/home.html'),
  withPrecacheVersion('./pages/modals.html'),
  './img/Instagram-Logo--Streamline-Plump-Gradient.png',
  './img/Thread-Block-Logo--Streamline-Ultimate.png',
  './img/Artificial-Intelligence-Brain--Streamline-Plump-Gradient.png',
  './img/1more.png',
  './img/chat.png',
];

const SPA_LIST_PATHS = new Set(['/activities', '/teams', '/tournaments', '/profile']);
const SPA_DETAIL_ROOTS = new Set(['events', 'teams', 'tournaments']);
const SPA_SAFE_SEGMENT_RE = /^[A-Za-z0-9_-]{3,80}$/;
const VERSIONED_STATIC_RE = /\.(?:css|js|png|jpe?g|webp|gif|svg|ico|woff2?)$/i;

function stripTrailingSlash(pathname) {
  if (!pathname || pathname === '/') return '/';
  return pathname.replace(/\/+$/, '') || '/';
}

function isSpaNavigationPath(pathname) {
  const path = stripTrailingSlash(pathname);
  if (SPA_LIST_PATHS.has(path)) return true;
  const segments = path.split('/').filter(Boolean);
  if (
    segments.length === 6
    && segments[0] === 'teams'
    && segments[2] === 'courses'
    && segments[4] === 'lessons'
  ) {
    return [segments[1], segments[3], segments[5]].every((segment) => {
      if (/%2f|%5c/i.test(segment)) return false;
      try {
        const decoded = decodeURIComponent(segment);
        return SPA_SAFE_SEGMENT_RE.test(decoded) && !decoded.includes('/') && !decoded.includes('\\');
      } catch (_) {
        return false;
      }
    });
  }
  if (segments.length !== 2 || !SPA_DETAIL_ROOTS.has(segments[0])) return false;
  if (/%2f|%5c/i.test(segments[1])) return false;
  try {
    const decoded = decodeURIComponent(segments[1]);
    return SPA_SAFE_SEGMENT_RE.test(decoded) && !decoded.includes('/') && !decoded.includes('\\');
  } catch (_) {
    return false;
  }
}

function getIndexCacheRequest(url) {
  return new Request(new URL('/index.html', url.origin).toString());
}

function isVersionedStaticRequest(url) {
  return url.origin === location.origin
    && url.searchParams.has('v')
    && VERSIONED_STATIC_RE.test(url.pathname);
}

// ─── 圖片快取工具函式 ───

/**
 * 將圖片存入 IMAGE_CACHE，附上時間戳記，並清除超量舊項目
 */
let imageCacheWritesSinceTrim = 0;

async function trimImageCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_IMAGE_CACHE) return;
  const toDelete = keys.slice(0, keys.length - MAX_IMAGE_CACHE);
  await Promise.all(toDelete.map(request => cache.delete(request)));
}

async function storeImageInCache(cache, request, response) {
  try {
    if (!response?.body) return;
    const headers = new Headers(response.headers);
    headers.set('sw-cached-at', Date.now().toString());
    const cachedResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
    await cache.put(request, cachedResponse);

    imageCacheWritesSinceTrim += 1;
    if (imageCacheWritesSinceTrim >= IMAGE_CACHE_TRIM_INTERVAL) {
      imageCacheWritesSinceTrim = 0;
      await trimImageCache(cache);
    }
  } catch (_) {
    // Image caching is best-effort; the network response remains usable.
  }
}

/**
 * Returns whether a cached image exceeded its freshness window.
 */
function isImageExpired(cachedResponse) {
  const cachedAt = cachedResponse.headers.get('sw-cached-at');
  if (!cachedAt) return true;
  return Date.now() - parseInt(cachedAt) > MAX_IMAGE_AGE_MS;
}

// ─── Install ───
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        STATIC_ASSETS.map(asset =>
          cache.add(asset).catch(err => {
            console.warn('[SW] Failed to cache:', asset, err.message);
          })
        )
      );
    })
  );
  self.skipWaiting();
});

// ─── Activate：清除舊快取（保留 IMAGE_CACHE_NAME）───
self.addEventListener('activate', (event) => {
  const navigationPreloadReady = self.registration.navigationPreload?.enable?.() ?? Promise.resolve();

  event.waitUntil(
    Promise.all([
      navigationPreloadReady.catch((err) => {
        console.warn('[SW] navigation preload enable failed:', err?.message || err);
      }),
      caches.keys().then((keys) => {
        return Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME && key !== IMAGE_CACHE_NAME)
            .map((key) => caches.delete(key))
        );
      }).then(() => self.clients.claim()),
      caches.open(IMAGE_CACHE_NAME).then(cache => trimImageCache(cache)),
    ])
  );
});

// ─── Fetch 攔截 ───
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 只處理 GET
  if (event.request.method !== 'GET') return;

  if (url.origin === location.origin && url.pathname === '/runtime-config.json') {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).catch(() =>
        new Response('{}', {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store, max-age=0',
          },
        })
      )
    );
    return;
  }

  // ── 1. Firebase Storage 圖片：Stale-While-Revalidate ──
  if (url.hostname === 'firebasestorage.googleapis.com') {
    let imageCacheUpdate = Promise.resolve();
    const imageResponse = caches.open(IMAGE_CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request);
      const isValid = cached && !isImageExpired(cached);

      // Return the network response without waiting for the streaming cache write.
      const networkFetch = fetch(event.request)
        .then((response) => {
          const cacheWrite = response && response.status === 200
            ? storeImageInCache(cache, event.request, response.clone())
            : Promise.resolve();
          return { response, cacheWrite };
        })
        .catch(() => ({ response: null, cacheWrite: Promise.resolve() }));
      imageCacheUpdate = networkFetch
        .then(({ cacheWrite }) => cacheWrite)
        .catch(() => {});

      if (isValid) return cached;

      // 無快取或已過期：等網路，失敗時回退舊快取
      const { response } = await networkFetch;
      return response || cached;
    });
    event.respondWith(imageResponse);
    event.waitUntil(imageResponse.then(() => imageCacheUpdate).catch(() => {}));
    return;
  }

  // ── 2. 其他 Firebase / CDN：Network-first（不快取）──
  if (
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('gstatic.com') ||
    url.hostname.includes('line-scdn.net') ||
    url.hostname.includes('unpkg.com') ||
    url.hostname.includes('cdn.jsdelivr.net')
  ) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // ── 3. HTML：Network-first（確保 index.html 不卡舊版）──
  if (event.request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    const normalizeToIndex = event.request.mode === 'navigate' && isSpaNavigationPath(url.pathname);
    const cacheRequest = normalizeToIndex ? getIndexCacheRequest(url) : event.request;
    event.respondWith((async () => {
      try {
        const preloaded = event.request.mode === 'navigate' && event.preloadResponse
          ? await event.preloadResponse.catch(() => null)
          : null;
        const response = preloaded || await fetch(event.request);
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(cacheRequest, clone));
        }
        return response;
      } catch (err) {
        const cached = await caches.match(cacheRequest, { ignoreSearch: !normalizeToIndex });
        if (cached) return cached;
        if (normalizeToIndex) return caches.match(getIndexCacheRequest(url));
        return caches.match(event.request, { ignoreSearch: true });
      }
    })());
    return;
  }

  // ── 4. 同源有版號資源（?v=）：Cache-first ──
  if (url.origin === location.origin) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;

        try {
          const response = await fetch(event.request);
          if (response && response.status === 200) {
            await cache.put(event.request, response.clone());
          }
          return response;
        } catch (err) {
          if (isVersionedStaticRequest(url)) {
            const fallbackUrl = new URL(url.pathname, url.origin).toString();
            const fallback = await cache.match(fallbackUrl) || await caches.match(fallbackUrl);
            if (fallback) return fallback;
          }
          throw err;
        }
      })
    );
  }
});
/* deploy trigger 2026-05-11 phase 5.5 sitemap */
/* sitemap deploy trigger v2 2026-05-11 */
