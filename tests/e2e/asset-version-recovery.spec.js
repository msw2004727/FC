// @ts-check
const { test, expect } = require('@playwright/test');
const { installTestHarness, TEST_USERS } = require('./helpers/test-harness');
const fs = require('fs');
const http = require('http');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const SITE_ORIGIN = new URL(BASE_URL).origin;

test.use({ serviceWorkers: 'block' });

async function keepRequestsLocal(page, origin = SITE_ORIGIN) {
  await page.route('**/*', route => {
    const request = route.request();
    if (new URL(request.url()).origin === origin) return route.continue();
    if (request.resourceType() === 'script') {
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
    }
    if (request.resourceType() === 'stylesheet') {
      return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

async function startUpgradeServer() {
  const root = process.cwd();
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const version = index.match(/var V='(0\.\d{8}[a-z]*)'/)?.[1];
  if (!version) throw new Error('index asset version missing');
  let upgraded = false;
  let upgradedScriptRequests = 0;
  const makeWorker = (workerVersion, installDelayMs) => `
    const VERSION = ${JSON.stringify(workerVersion)};
    self.addEventListener('install', event => {
      event.waitUntil(new Promise(resolve => setTimeout(resolve, ${installDelayMs}))
        .then(() => self.skipWaiting()));
    });
    self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
    ${workerVersion === '0.20000101' ? '' : `
      self.addEventListener('message', event => {
        if (event.data?.type === 'SPORTHUB_GET_VERSION') {
          event.ports?.[0]?.postMessage({ type: 'SPORTHUB_VERSION', version: VERSION });
        }
      });
    `}
    self.addEventListener('fetch', event => {
      if (VERSION === '0.20000101' && new URL(event.request.url).pathname === '/pages/team.html') {
        event.respondWith(new Response('', {
          status: 409,
          headers: { 'X-SportHub-Version-Miss': '1' },
        }));
      }
    });
  `;
  const oldWorker = makeWorker('0.20000101', 0);
  const newWorker = makeWorker(version, 2800);
  const contentTypes = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
  };
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname;
    if (pathname === '/sw.js') {
      if (upgraded) upgradedScriptRequests += 1;
      response.writeHead(200, {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end(upgraded ? newWorker : oldWorker);
      return;
    }
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404);
      response.end('Not Found');
      return;
    }
    response.writeHead(200, {
      'content-type': contentTypes[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    fs.createReadStream(file).pipe(response);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    get upgradedScriptRequests() { return upgradedScriptRequests; },
    upgrade() { upgraded = true; },
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections?.();
    }),
  };
}

async function openHome(page) {
  await keepRequestsLocal(page);
  await installTestHarness(page, TEST_USERS.userBasic);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (
    typeof App !== 'undefined'
    && typeof PageLoader !== 'undefined'
    && typeof App.showPage === 'function'
    && document.getElementById('bottom-tabs')?.dataset.navigationBound === '1'
  ));
  await expect(page.locator('#top-bar')).toBeVisible();
  await page.evaluate(() => {
    // Keep the recovery test focused on cache handoff, not mocked auth prompts.
    App._isSafeToAutoReload = () => ({ safe: true });
  });
}

async function requestTeamsPage(page) {
  // Mocked LIFF data may show a relogin prompt over the mobile tab bar.
  await page.evaluate(() => document.querySelector('.bot-tab[data-page="page-teams"]')?.click());
}

function interceptTeamVersionMiss(page, shouldMiss) {
  let misses = 0;
  return {
    async install() {
      await page.route('**/pages/team.html?v=*', route => {
        if (shouldMiss()) {
          misses += 1;
          return route.fulfill({
            status: 409,
            contentType: 'text/html',
            headers: { 'X-SportHub-Version-Miss': '1' },
            body: '',
          });
        }
        return route.continue();
      });
    },
    get misses() { return misses; },
  };
}

test('version miss waits for the matching service worker controller before reloading', async ({ page }) => {
  await openHome(page);

  await page.evaluate(() => {
    const sw = new EventTarget();
    const oldController = {
      postMessage(message, ports) {
        if (message?.type === 'SPORTHUB_GET_VERSION') {
          ports?.[0]?.postMessage({ type: 'SPORTHUB_VERSION', version: '0.20000101' });
        }
      },
    };
    const newController = {
      postMessage(message, ports) {
        if (message?.type === 'SPORTHUB_GET_VERSION') {
          ports?.[0]?.postMessage({
            type: 'SPORTHUB_VERSION',
            version: window.getSportHubAssetVersion(),
          });
        }
      },
    };
    sw.controller = oldController;
    sw.getRegistrations = async () => [{ update: async () => { window.__e2eUpdateCalls += 1; } }];
    window.__e2eUpdateCalls = 0;
    window.__e2ePromoteSw = () => {
      sw.controller = newController;
      sw.dispatchEvent(new Event('controllerchange'));
    };
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: sw });
  });

  let documentRequests = 0;
  page.on('request', request => {
    if (request.resourceType() === 'document') documentRequests += 1;
  });
  let promoted = false;
  const team = interceptTeamVersionMiss(page, () => !promoted);
  await team.install();
  await requestTeamsPage(page);
  await expect.poll(() => team.misses).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.__e2eUpdateCalls)).toBeGreaterThan(0);

  // The old 1.5-second update timeout reloaded before the new worker claimed the page.
  await page.waitForTimeout(2200);
  expect(documentRequests).toBe(0);
  expect(await page.evaluate(() => navigator.serviceWorker.controller === undefined)).toBe(false);

  promoted = true;
  await page.evaluate(() => window.__e2ePromoteSw());
  await expect.poll(() => documentRequests, { timeout: 10000 }).toBe(1);
  await expect(page.locator('#top-bar')).toBeVisible();
  await expect(page.locator('#_recovery_btn')).toHaveCount(0);
});

test.describe('LINE-like in-app browser without Service Worker', () => {
  test.use({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1 Line/14.20.0',
  });

  test('recovers a transient page fragment failure without a Service Worker API', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await openHome(page);
    expect(await page.evaluate(() => navigator.serviceWorker)).toBeUndefined();

    let documentRequests = 0;
    page.on('request', request => {
      if (request.resourceType() === 'document') documentRequests += 1;
    });
    const team = interceptTeamVersionMiss(page, () => team.misses === 0);
    await team.install();
    await requestTeamsPage(page);

    await expect.poll(() => team.misses).toBe(1);
    await expect.poll(() => documentRequests, { timeout: 10000 }).toBe(1);
    await expect(page.locator('#top-bar')).toBeVisible();
    await expect(page.locator('#_recovery_btn')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });
});

test.describe('real Service Worker upgrade', () => {
  test.use({ serviceWorkers: 'allow' });

  test('delayed install does not reload while an old controller still owns the page', async ({ page }) => {
    const server = await startUpgradeServer();
    try {
      await keepRequestsLocal(page, server.origin);
      await page.goto(server.origin, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => (
        navigator.serviceWorker?.controller
        && typeof PageLoader !== 'undefined'
        && typeof window.recoverSportHubScriptFailure === 'function'
      ), undefined, { timeout: 15000 });
      await page.evaluate(() => {
        window._appInitializing = false;
        window._contentReady = true;
        if (typeof App !== 'undefined') App._isSafeToAutoReload = () => ({ safe: true });
      });

      let documentRequests = 0;
      page.on('request', request => {
        if (request.resourceType() === 'document') documentRequests += 1;
      });
      const oldStatus = await page.evaluate(() => (
        fetch(`pages/team.html?v=${window.getSportHubAssetVersion()}`).then(response => response.status)
      ));
      expect(oldStatus).toBe(409);
      server.upgrade();
      const failedFragment = await page.evaluate(() => PageLoader._fetchPageFragment('team'));
      expect(failedFragment).toBe('');
      await expect.poll(() => server.upgradedScriptRequests).toBeGreaterThan(0);

      // The replacement worker deliberately remains installing for 2.8 seconds.
      await page.waitForTimeout(2200);
      expect(documentRequests).toBe(0);
      await expect.poll(() => documentRequests, { timeout: 12000 }).toBe(1);
      await expect(page.locator('#top-bar')).toBeVisible();
      await expect(page.locator('#_recovery_btn')).toHaveCount(0);
      const newStatus = await page.evaluate(() => (
        fetch(`pages/team.html?v=${window.getSportHubAssetVersion()}`).then(response => response.status)
      ));
      expect(newStatus).toBe(200);
    } finally {
      await server.close();
    }
  });
});
