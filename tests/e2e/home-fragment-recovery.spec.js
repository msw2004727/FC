// @ts-check
const { test, expect } = require('@playwright/test');
const { installTestHarness, TEST_USERS } = require('./helpers/test-harness');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const SITE_ORIGIN = new URL(BASE_URL).origin;

test.use({ serviceWorkers: 'block' });

async function prepareLocalHome(page) {
  await installTestHarness(page, TEST_USERS.userBasic);

  // Keep this browser test independent of live Firebase, LINE, and the
  // deployment-time public snapshot embedded in index.html.
  await page.route('**/*', route => {
    const request = route.request();
    if (new URL(request.url()).origin === SITE_ORIGIN) return route.continue();
    if (request.resourceType() === 'script') {
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
    }
    if (request.resourceType() === 'stylesheet') {
      return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.route(url => url.origin === SITE_ORIGIN && (url.pathname === '/' || url.pathname === '/index.html'), async route => {
    const response = await route.fetch();
    let html = await response.text();
    const fixtureData = {
      'boot-banners-data': [{ id: 'e2e-home-banner', status: 'active', gradient: 'var(--bg-elevated)', title: 'E2E Home Banner' }],
      'boot-home-summary-data': {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        complete: true,
        counts: { activities: 2, teams: 0, tournaments: 0 },
        activityViews: { total: 4, label: 'views' },
        sportCounts: [{ sportTag: 'football', count: 2 }],
      },
      'boot-public-lists-data': { schemaVersion: 1, events: [], teams: [], tournaments: [] },
    };
    for (const [id, data] of Object.entries(fixtureData)) {
      const marker = new RegExp(`<script id="${id}"[^>]*>[\\s\\S]*?<\\/script>`);
      if (!marker.test(html)) throw new Error(`Missing ${id} fixture insertion point`);
      html = html.replace(marker, `<script id="${id}" type="application/json" data-ts="${Date.now() + 1000}">${JSON.stringify(data)}</script>`);
    }
    await route.fulfill({ response, contentType: 'text/html; charset=utf-8', body: html });
  });
}

function countDocumentRequests(page) {
  let count = 0;
  page.on('request', request => {
    if (request.isNavigationRequest() && request.resourceType() === 'document') count += 1;
  });
  return () => count;
}

async function expectRenderedHome(page) {
  await expect(page.locator('#page-home.active')).toBeVisible();
  await expect(page.locator('#banner-track .banner-slide:not(.skeleton-slide)')).toBeVisible();
  await expect(page.locator('#home-sport-entry .home-sport-chip[data-home-sport="football"]')).toBeVisible();
}

test('renders a home fragment arriving after the 10-second boot wait without reloading', async ({ page }) => {
  test.setTimeout(45000);
  await prepareLocalHome(page);
  let homeRequests = 0;
  await page.route('**/pages/home.html?v=*', async route => {
    homeRequests += 1;
    await new Promise(resolve => setTimeout(resolve, 12000));
    await route.continue();
  });
  const documentRequests = countDocumentRequests(page);

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(10500);
  await expect(page.locator('#page-home')).toHaveCount(0);

  await expectRenderedHome(page);
  expect(homeRequests).toBe(1);
  expect(documentRequests()).toBe(1);
});

test('retries a failed home fragment from the visible home button without reloading', async ({ page }) => {
  await prepareLocalHome(page);
  let homeRequests = 0;
  await page.route('**/pages/home.html?v=*', route => {
    homeRequests += 1;
    if (homeRequests === 1) {
      return route.fulfill({ status: 503, contentType: 'text/html', body: '' });
    }
    return route.continue();
  });
  const documentRequests = countDocumentRequests(page);

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  const retry = page.getByRole('button', { name: '重試載入首頁' });
  await expect(retry).toBeVisible({ timeout: 15000 });
  await retry.click();

  await expectRenderedHome(page);
  expect(homeRequests).toBe(2);
  expect(documentRequests()).toBe(1);
  await expect(retry).toHaveCount(0);
});

test('a late home fragment does not replace an active deep-link page', async ({ page }) => {
  test.setTimeout(45000);
  await prepareLocalHome(page);
  await page.route('**/pages/home.html?v=*', async route => {
    await new Promise(resolve => setTimeout(resolve, 12000));
    await route.continue();
  });

  await page.goto(`${BASE_URL}/#page-activities`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#page-activities.active')).toBeVisible({ timeout: 20000 });
  await expect.poll(() => page.evaluate(() => PageLoader._loaded.home === true), { timeout: 20000 }).toBe(true);
  await expect(page.locator('#page-activities.active')).toBeVisible();
  await expect(page.locator('#page-home')).not.toBeVisible();
});
