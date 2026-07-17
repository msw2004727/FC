/* ================================================
   SportHub — Service Worker
   Strategy:
     - HTML          → network-first
     - versioned JS/CSS → cache-first
     - Firebase Storage 圖片 → stale-while-revalidate（獨立快取）
   ================================================ */

const CACHE_NAME       = 'sporthub-0.20260717';
const PRECACHE_VERSION = CACHE_NAME.replace('sporthub-', '');
const IMAGE_CACHE_NAME = 'sporthub-images-v2';
const RUNTIME_CACHE_NAME_RE = /^sporthub-\d+\.\d{8}[a-z0-9._-]*$/i;
const RETAIN_PREVIOUS_RUNTIME_CACHES = 2;
const MAX_IMAGE_CACHE  = 300;
const MAX_IMAGE_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const IMAGE_CACHE_TRIM_INTERVAL = 20;

function isLegacyRuntimeCacheName(name) {
  return typeof name === 'string'
    && RUNTIME_CACHE_NAME_RE.test(name)
    && name !== CACHE_NAME
    && name !== IMAGE_CACHE_NAME;
}

function selectObsoleteRuntimeCaches(cacheNames, retainCount = RETAIN_PREVIOUS_RUNTIME_CACHES) {
  const legacy = (Array.isArray(cacheNames) ? cacheNames : [])
    .filter(isLegacyRuntimeCacheName)
    .sort()
    .reverse();
  return legacy.slice(Math.max(0, Number(retainCount) || 0));
}

async function cleanupLegacyRuntimeCaches(maxAttempts = 2, retainCount = RETAIN_PREVIOUS_RUNTIME_CACHES) {
  let stale = [];
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    stale = selectObsoleteRuntimeCaches(await caches.keys(), retainCount);
    if (stale.length === 0) return [];
    await Promise.allSettled(stale.map(name => caches.delete(name)));
  }
  stale = selectObsoleteRuntimeCaches(await caches.keys(), retainCount);
  if (stale.length > 0) {
    console.warn('[SW] Obsolete runtime caches remain:', stale.join(', '));
  }
  return stale;
}

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
const VERSIONED_PAGE_FRAGMENT_RE = /^\/pages\/[A-Za-z0-9_-]+\.html$/i;
const APP_ASSET_VERSION_RE = /^0\.\d{8}[a-z]*$/;

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

function isVersionedPageFragmentRequest(url) {
  return url.origin === location.origin
    && url.searchParams.has('v')
    && VERSIONED_PAGE_FRAGMENT_RE.test(url.pathname);
}

function isForeignAppVersionRequest(url) {
  const requestedVersion = String(url.searchParams.get('v') || '');
  const isAppCodeAsset = isVersionedStaticRequest(url)
    && /\.(?:css|js)$/i.test(url.pathname);
  return (isAppCodeAsset || isVersionedPageFragmentRequest(url))
    && APP_ASSET_VERSION_RE.test(requestedVersion)
    && requestedVersion !== PRECACHE_VERSION;
}

function createAppVersionMissResponse() {
  return new Response('', {
    status: 409,
    statusText: 'App version cache miss',
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'X-SportHub-Version-Miss': '1',
    },
  });
}

function getRequestedRuntimeCacheName(url) {
  const requestedVersion = String(url.searchParams.get('v') || '');
  return APP_ASSET_VERSION_RE.test(requestedVersion)
    ? `sporthub-${requestedVersion}`
    : '';
}

async function matchRequestedRuntimeCache(request, url) {
  const cacheName = getRequestedRuntimeCacheName(url);
  if (!cacheName) return undefined;
  const cacheNames = await caches.keys();
  if (!cacheNames.includes(cacheName)) return undefined;
  return caches.open(cacheName).then((cache) => cache.match(request));
}

async function matchRuntimeCachesNewestFirst(request, options = {}) {
  const cacheNames = await caches.keys();
  const orderedNames = [
    CACHE_NAME,
    ...cacheNames.filter(isLegacyRuntimeCacheName).sort().reverse(),
  ];
  for (const cacheName of orderedNames) {
    if (!cacheNames.includes(cacheName)) continue;
    const cached = await caches.open(cacheName).then((cache) => cache.match(request, options));
    if (cached) return cached;
  }
  return undefined;
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
  const cleanupReady = cleanupLegacyRuntimeCaches().catch((err) => {
    console.warn('[SW] legacy cache cleanup failed:', err?.message || err);
    return [];
  });

  event.waitUntil(
    Promise.all([
      navigationPreloadReady.catch((err) => {
        console.warn('[SW] navigation preload enable failed:', err?.message || err);
      }),
      cleanupReady.then(() => self.clients.claim()),
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
  if (event.request.mode !== 'navigate' && isVersionedPageFragmentRequest(url)) {
    if (isForeignAppVersionRequest(url)) {
      event.respondWith((async () => {
        const cached = await matchRequestedRuntimeCache(event.request, url);
        return cached || createAppVersionMissResponse();
      })());
      return;
    }
    const fragmentNetwork = fetch(event.request).then((response) => {
      const cacheWrite = response && response.status === 200
        ? caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()))
        : Promise.resolve();
      return { response, cacheWrite };
    });
    const fragmentResponse = fragmentNetwork
      .then(({ response }) => response)
      .catch(async () => {
        const cached = await caches.open(CACHE_NAME).then((cache) => cache.match(event.request));
        return cached || createAppVersionMissResponse();
      });
    event.respondWith(fragmentResponse);
    event.waitUntil(fragmentNetwork.then(({ cacheWrite }) => cacheWrite).catch(() => {}));
    return;
  }

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
        const cached = await matchRuntimeCachesNewestFirst(
          cacheRequest,
          { ignoreSearch: !normalizeToIndex },
        );
        if (cached) return cached;
        return matchRuntimeCachesNewestFirst(event.request, { ignoreSearch: true });
      }
    })());
    return;
  }

  // ── 4. 同源有版號資源（?v=）：Cache-first ──
  if (url.origin === location.origin) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {

        const foreignAppVersion = isForeignAppVersionRequest(url);
        const cached = foreignAppVersion
          ? await matchRequestedRuntimeCache(event.request, url)
          : await cache.match(event.request);
        if (cached) return cached;

        if (foreignAppVersion) {
          return createAppVersionMissResponse();
        }

        try {
          const response = await fetch(event.request);
          if (response && response.status === 200) {
            await cache.put(event.request, response.clone());
          }
          return response;
        } catch (err) {
          const requestedVersion = String(url.searchParams.get('v') || '');
          const isCurrentAppCode = isVersionedStaticRequest(url)
            && /\.(?:css|js)$/i.test(url.pathname)
            && requestedVersion === PRECACHE_VERSION;
          if (isCurrentAppCode) return createAppVersionMissResponse();
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
