/* ================================================
   SportHub — Service Worker
   Strategy: network-first for HTML, cache-first for versioned assets
   ================================================ */

const CACHE_NAME = 'sporthub-20260212zs';
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

// Install: pre-cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {
        // Ignore individual failures in pre-cache
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches（不再 force-reload，由 controllerchange 事件處理）
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch strategy
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Network-first for Firebase, external APIs, and CDNs
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

  // Network-first for HTML (確保 index.html 不會卡舊版)
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

  // Cache-first for same-origin versioned assets (?v= 已帶版號)
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
