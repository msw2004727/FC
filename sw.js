/* ================================================
   SportHub — Service Worker
   Strategy:
     - HTML          → network-first
     - versioned JS/CSS → cache-first
     - Firebase Storage 圖片 → stale-while-revalidate（獨立快取）
   ================================================ */

const CACHE_NAME       = 'sporthub-0.20260610j';
const IMAGE_CACHE_NAME = 'sporthub-images-v2';
const MAX_IMAGE_CACHE  = 150;                         // 最多快取 150 張圖片
const MAX_IMAGE_AGE_MS = 7 * 24 * 60 * 60 * 1000;    // 7 天過期

const STATIC_ASSETS = [
  './',
  './index.html',
  './css/base.css',
  './css/layout.css',
  './css/home.css',
  './css/activity.css',
  './css/team.css',
  './css/team-detail-v2.css',
  './css/profile.css',
  './css/message.css',
  './css/tournament.css',
  './css/shop.css',
  './css/scan.css',
  './css/admin.css',
  './css/calendar.css',
  './css/calendar-sport-counts.css',
  './css/admin-seo.css',
  './css/game.css',
  './css/image-cropper.css',
  './css/education.css',
  './css/permission-audit.css',
  './js/config.js',
  './js/i18n.js',
  './js/core/history-route-flags.js',
  './js/core/history-route-adapter.js',
  './js/core/page-loader.js',
  './js/core/navigation.js',
  './js/core/theme.js',
  './js/core/script-loader.js',
  // boot page HTML fragments — 回訪時從 SW cache 秒取
  './pages/home.html',
  './pages/activity.html',
  './pages/team.html',
  './pages/message.html',
  './pages/profile.html',
  './pages/modals.html',
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
async function storeImageInCache(cache, request, response) {
  try {
    const body = await response.clone().arrayBuffer();
    const headers = new Headers(response.headers);
    headers.set('sw-cached-at', Date.now().toString());
    const cachedResponse = new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
    await cache.put(request, cachedResponse);

    // 超過上限時刪除最舊的
    const keys = await cache.keys();
    if (keys.length > MAX_IMAGE_CACHE) {
      const toDelete = keys.slice(0, keys.length - MAX_IMAGE_CACHE);
      await Promise.all(toDelete.map(k => cache.delete(k)));
    }
  } catch (e) {
    // 儲存失敗不影響主流程
  }
}

/**
 * 判斷快取的圖片是否已超過有效期
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
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key !== IMAGE_CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
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
    event.respondWith(
      caches.open(IMAGE_CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);
        const isValid = cached && !isImageExpired(cached);

        // 背景 fetch：更新快取用（不等待）
        const networkFetch = fetch(event.request)
          .then(async (response) => {
            if (response && response.status === 200) {
              storeImageInCache(cache, event.request, response.clone());
            }
            return response;
          })
          .catch(() => null);

        if (isValid) {
          // 快取有效：立即回傳，背景悄悄更新
          event.waitUntil(networkFetch);
          return cached;
        }

        // 無快取或已過期：等網路，失敗時回退舊快取
        const networkResponse = await networkFetch;
        return networkResponse || cached;
      })
    );
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
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(cacheRequest, clone));
        }
        return response;
      }).catch(async () => {
        const cached = await caches.match(cacheRequest, { ignoreSearch: !normalizeToIndex });
        if (cached) return cached;
        if (normalizeToIndex) return caches.match(getIndexCacheRequest(url));
        return caches.match(event.request, { ignoreSearch: true });
      })
    );
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
