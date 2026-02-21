/* ================================================
   SportHub ??Service Worker
   Strategy:
     - HTML          ??network-first
     - versioned JS/CSS ??cache-first
     - Firebase Storage ?–ç? ??stale-while-revalidateï¼ˆç¨ç«‹å¿«?–ï?
   ================================================ */

const CACHE_NAME       = 'sporthub-20260221e';
const IMAGE_CACHE_NAME = 'sporthub-images-v1';
const MAX_IMAGE_CACHE  = 150;                         // ?€å¤šå¿«??150 å¼µå???const MAX_IMAGE_AGE_MS = 7 * 24 * 60 * 60 * 1000;    // 7 å¤©é???

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

// ?€?€?€ ?–ç?å¿«å?å·¥å…·?½å? ?€?€?€

/**
 * å°‡å??‡å???IMAGE_CACHEï¼Œé?ä¸Šæ??“æˆ³è¨˜ï?ä¸¦æ??¤è??è??…ç›®
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

    // è¶…é?ä¸Šé??‚åˆª?¤æ??Šç?
    const keys = await cache.keys();
    if (keys.length > MAX_IMAGE_CACHE) {
      const toDelete = keys.slice(0, keys.length - MAX_IMAGE_CACHE);
      await Promise.all(toDelete.map(k => cache.delete(k)));
    }
  } catch (e) {
    // ?²å?å¤±æ?ä¸å½±?¿ä¸»æµç?
  }
}

/**
 * ?¤æ–·å¿«å??„å??‡æ˜¯?¦å·²è¶…é??‰æ???
 */
function isImageExpired(cachedResponse) {
  const cachedAt = cachedResponse.headers.get('sw-cached-at');
  if (!cachedAt) return true;
  return Date.now() - parseInt(cachedAt) > MAX_IMAGE_AGE_MS;
}

// ?€?€?€ Install ?€?€?€
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {});
    })
  );
  self.skipWaiting();
});

// ?€?€?€ Activateï¼šæ??¤è?å¿«å?ï¼ˆä???IMAGE_CACHE_NAMEï¼‰â??€?€
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

// ?€?€?€ Fetch ?”æˆª ?€?€?€
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // ?ªè???GET
  if (event.request.method !== 'GET') return;

  // ?€?€ 1. Firebase Storage ?–ç?ï¼šStale-While-Revalidate ?€?€
  if (url.hostname === 'firebasestorage.googleapis.com') {
    event.respondWith(
      caches.open(IMAGE_CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);
        const isValid = cached && !isImageExpired(cached);

        // ?Œæ™¯ fetchï¼šæ›´?°å¿«?–ç”¨ï¼ˆä?ç­‰å?ï¼?
        const networkFetch = fetch(event.request)
          .then(async (response) => {
            if (response && response.status === 200) {
              storeImageInCache(cache, event.request, response.clone());
            }
            return response;
          })
          .catch(() => null);

        if (isValid) {
          // å¿«å??‰æ?ï¼šç??³å??³ï??Œæ™¯?„æ??´æ–°
          event.waitUntil(networkFetch);
          return cached;
        }

        // ?¡å¿«?–æ?å·²é??Ÿï?ç­‰ç¶²è·¯ï?å¤±æ??‚å??€?Šå¿«??
        const networkResponse = await networkFetch;
        return networkResponse || cached;
      })
    );
    return;
  }

  // ?€?€ 2. ?¶ä? Firebase / CDNï¼šNetwork-firstï¼ˆä?å¿«å?ï¼‰â??€
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

  // ?€?€ 3. HTMLï¼šNetwork-firstï¼ˆç¢ºä¿?index.html ä¸å¡?Šç?ï¼‰â??€
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

  // ?€?€ 4. ?Œæ??‰ç??Ÿè?æºï??v=ï¼‰ï?Cache-first ?€?€
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
