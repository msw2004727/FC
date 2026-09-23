// @ts-check
const { test, expect } = require('@playwright/test');
const { installTestHarness, TEST_USERS } = require('./helpers/test-harness');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const SITE_ORIGIN = new URL(BASE_URL).origin;

test.use({ serviceWorkers: 'block' });

async function keepRequestsLocal(page) {
  await page.route('**/*', route => {
    const request = route.request();
    if (new URL(request.url()).origin === SITE_ORIGIN) return route.continue();
    const resourceType = request.resourceType();
    if (resourceType === 'script') {
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
    }
    if (resourceType === 'stylesheet') {
      return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

test('failed critical stylesheet shows a full-screen retry instead of raw profile form', async ({ page }) => {
  await keepRequestsLocal(page);
  await page.goto(new URL('/privacy.html', BASE_URL).href);
  await page.evaluate(() => {
    localStorage.setItem('sporthub_theme', 'dark');
    sessionStorage.setItem('_sporthubAssetRecovery', JSON.stringify({ attempts: 2, at: Date.now() }));
  });
  await page.route('**/css/base.css?v=*', route => route.fulfill({
    status: 409,
    contentType: 'text/css',
    headers: { 'X-SportHub-Version-Miss': '1' },
    body: '',
  }));

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  const guard = page.locator('#critical-css-guard');
  await expect(guard).toBeVisible();
  await expect(page.locator('#critical-css-retry')).toBeVisible();
  await expect(page.locator('#top-bar')).toBeHidden();
  await expect(page.locator('#first-login-modal')).toBeHidden();
  const geometry = await guard.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      background: getComputedStyle(element).backgroundColor,
      theme: document.documentElement.dataset.theme,
    };
  });
  expect(geometry).toMatchObject({
    x: 0,
    y: 0,
    width: geometry.viewportWidth,
    height: geometry.viewportHeight,
    theme: 'dark',
  });
  expect(geometry.background).not.toBe('rgba(0, 0, 0, 0)');
});

test('offline critical stylesheet failure keeps the update screen and retry accessible', async ({ page }) => {
  await keepRequestsLocal(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
  });
  await page.route('**/css/layout.css?v=*', route => route.fulfill({
    status: 404,
    contentType: 'text/css',
    body: '',
  }));

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  await expect(page.locator('#critical-css-guard')).toBeVisible();
  await expect(page.locator('#critical-css-retry')).toBeVisible();
  await expect(page.locator('#top-bar')).toBeHidden();
  await expect(page.locator('#critical-css-message')).toContainText('目前離線');
});

test('successful critical styles reveal the normal shell', async ({ page }) => {
  await keepRequestsLocal(page);
  await installTestHarness(page, TEST_USERS.userBasic);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  await expect.poll(() => page.evaluate(() => (
    !document.documentElement.classList.contains('boot-css-pending')
  )), { timeout: 15000 }).toBe(true);
  await expect(page.locator('#critical-css-guard')).toBeHidden();
  await expect(page.locator('#top-bar')).toBeVisible();
  await page.waitForFunction(() => typeof App !== 'undefined' && typeof App.renderBannerCarousel === 'function');
  await page.evaluate(() => App.renderBannerCarousel({ autoplay: false }));
  await expect(page.locator('#critical-css-guard .banner-fixed-content')).toHaveCount(0);
  const shell = await page.evaluate(() => ({
    topBarPosition: getComputedStyle(document.getElementById('top-bar')).position,
    logoHeight: document.getElementById('top-logo-img').getBoundingClientRect().height,
  }));
  expect(shell.topBarPosition).toBe('fixed');
  expect(shell.logoHeight).toBeLessThan(70);
});

test('manual CSS retry reloads from a completed deep-link page', async ({ page }) => {
  await keepRequestsLocal(page);
  await page.goto(new URL('/privacy.html', BASE_URL).href);
  await page.evaluate(() => sessionStorage.setItem('_sporthubAssetRecovery', JSON.stringify({ attempts: 2, at: Date.now() })));
  await page.route('**/css/base.css?v=*', route => route.fulfill({
    status: 404,
    contentType: 'text/css',
    body: '',
  }));
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof App !== 'undefined' && typeof App._isSafeToAutoReload === 'function');
  const initialSafety = await page.evaluate(() => {
    window._sporthubAssetRecoveryManualRequired = false;
    window._appInitializing = false;
    window._contentReady = true;
    App.currentPage = 'page-activity-detail';
    window.showSportHubAssetRecoveryButton('樣式載入失敗，點我重試');
    return App._isSafeToAutoReload({ ignoreSwPending: true, ignoreBootPending: true });
  });
  expect(initialSafety.reason).toBe('unsafe-page');
  await expect(page.locator('#critical-css-retry')).toBeVisible();

  const reloaded = page.waitForEvent('framenavigated', { timeout: 10000 });
  await page.locator('#critical-css-retry').click();
  await reloaded;
  await expect(page.locator('#critical-css-guard')).toBeVisible();
});

test('blocked modal requires explicit second retry and keeps the guard usable', async ({ page }) => {
  await keepRequestsLocal(page);
  await page.goto(new URL('/privacy.html', BASE_URL).href);
  await page.evaluate(() => sessionStorage.setItem('_sporthubAssetRecovery', JSON.stringify({ attempts: 2, at: Date.now() })));
  await page.route('**/css/base.css?v=*', route => route.fulfill({
    status: 404,
    contentType: 'text/css',
    body: '',
  }));
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof App !== 'undefined' && typeof App._isSafeToAutoReload === 'function');
  const initialSafety = await page.evaluate(() => {
    window._sporthubAssetRecoveryManualRequired = false;
    window._appInitializing = false;
    window._contentReady = true;
    App.currentPage = 'page-activity-detail';
    const modal = document.createElement('div');
    modal.className = 'modal open';
    document.body.appendChild(modal);
    window.showSportHubAssetRecoveryButton('樣式載入失敗，點我重試');
    return App._isSafeToAutoReload({ ignoreSwPending: true, ignoreBootPending: true, ignorePageSafety: true });
  });
  expect(initialSafety.reason).toBe('modal-open');
  await page.locator('#critical-css-retry').click();
  await expect(page.locator('#critical-css-message')).toContainText('目前操作尚未完成');
  await expect(page.locator('#critical-css-retry')).toHaveText('確定中斷並重新載入');
  await expect(page.locator('#critical-css-retry')).toBeEnabled();

  const reloaded = page.waitForEvent('framenavigated', { timeout: 10000 });
  await page.locator('#critical-css-retry').click();
  await reloaded;
  await expect(page.locator('#critical-css-guard')).toBeVisible();
});
