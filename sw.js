/* ================================================
   SportHub — Service Worker
   Strategy:
     - HTML          → network-first
     - versioned JS/CSS → cache-first
     - Firebase Storage 圖片 → stale-while-revalidate（獨立快取）
   ================================================ */

const CACHE_NAME       = 'sporthub-20260222h';
const IMAGE_CACHE_NAME = 'sporthub-images-v1';
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
  './css/profile.css',
  './css/message.css',
  './css/tournament.css',
  './css/shop.css',
  './css/scan.css',
  './css/admin.css',
  './js/config.js',
  './js/i18n.js',
  './app.js',
  './js/core/page-loader.js',
  './js/core/navigation.js',
  './js/core/theme.js',
  './js/core/mode.js',
  './js/core/script-loader.js',
];

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
      return cache.addAll(STATIC_ASSETS).catch(() => {});
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
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // ── 4. 同源有版號資源（?v=）：Cache-first ──
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
  }
});
