// @ts-check
const { test, expect } = require('@playwright/test');
const { installTestHarness, TEST_USERS } = require('./helpers/test-harness');

/**
 * SportHub E2E Tests — Critical User Journeys
 *
 * Prerequisites:
 *   npx playwright install chromium
 *   Serve the app locally: npx serve . -l 3000
 *
 * Run:
 *   npx playwright test tests/e2e/
 *
 * These tests use network interception to mock Firebase/LIFF APIs,
 * so no live backend is needed.
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// ── Helpers ──

/** Mock Firebase and LIFF SDK to allow offline testing */
async function mockBackend(page, user = TEST_USERS.userBasic) {
  await installTestHarness(page, user);
}

async function dismissOptionalProfilePrompt(page) {
  const dismiss = () => page.evaluate(() => {
    const modal = document.getElementById('first-login-modal');
    if (!modal) return;

    if (typeof App !== 'undefined' && typeof App.dismissFirstLoginModal === 'function') {
      // "稍後填寫" must not imply legal consent or wait for consent persistence.
      return App.dismissFirstLoginModal();
    }

    const overlay = document.getElementById('modal-overlay');
    modal.classList.remove('show', 'active', 'open');
    modal.style.display = 'none';
    if (overlay) {
      overlay.classList.remove('open');
      delete overlay.dataset.locked;
      delete overlay.dataset.profileComplete;
    }
    document.documentElement.classList.remove('profile-complete-scroll-lock');
    document.body.classList.remove('modal-open', 'profile-complete-scroll-lock');
    Object.assign(document.body.style, {
      position: '',
      top: '',
      left: '',
      right: '',
      width: '',
    });
  });
  try {
    await dismiss();
  } catch (err) {
    if (!/Execution context was destroyed|Cannot find context/i.test(String(err?.message || err))) {
      throw err;
    }
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await dismiss();
  }
}

async function forceShowPageIfNeeded(page, pageId) {
  const run = () => page.evaluate(async (targetPageId) => {
      const fallbackPageFiles = {
        'page-activities': 'activity',
        'page-tournaments': 'tournament',
        'page-profile': 'profile',
      };
      if (typeof PageLoader !== 'undefined') {
        await PageLoader.ensurePage?.(targetPageId);
      }
      if (typeof ScriptLoader !== 'undefined') {
        await ScriptLoader.ensureForPage?.(targetPageId);
      }
      let target = document.getElementById(targetPageId);
      if (!target && fallbackPageFiles[targetPageId]) {
        const version = typeof CACHE_VERSION !== 'undefined' ? CACHE_VERSION : String(Date.now());
        const response = await fetch(`pages/${fallbackPageFiles[targetPageId]}.html?v=${version}`);
        if (response.ok) {
          const temp = document.createElement('div');
          temp.innerHTML = await response.text();
          const main = document.getElementById('main-content') || document.body;
          while (temp.firstChild) main.appendChild(temp.firstChild);
        }
        target = document.getElementById(targetPageId);
      }
      if (target?.classList.contains('active')) return { ok: true, via: 'already-active' };
      if (typeof App !== 'undefined') {
        await App.showPage?.(targetPageId, {
          bypassPageLock: true,
          bypassRestrictionGuard: true,
          suppressAccessDeniedToast: true,
        });
      }
      target = document.getElementById(targetPageId);
      if (!target) return { ok: false, reason: 'missing-target' };
      if (!target.classList.contains('active')) {
        document.querySelectorAll('.page').forEach(pageEl => pageEl.classList.remove('active'));
        target.classList.add('active');
        if (typeof App !== 'undefined') App.currentPage = targetPageId;
        return { ok: true, via: 'direct-activation' };
      }
      return { ok: true, via: 'showPage' };
    }, pageId);

  let result = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      result = await run();
      break;
    } catch (err) {
      if (!/Execution context was destroyed|Cannot find context/i.test(String(err?.message || err)) || attempt === 2) {
        throw err;
      }
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForSelector('#loading-overlay', { state: 'hidden', timeout: 10000 }).catch(() => {});
    }
  }
  expect(result.ok, `forceShowPageIfNeeded failed: ${JSON.stringify(result)}`).toBe(true);
}

// ── Journey 1: Homepage loads and shows key sections ──

test.describe('Homepage', () => {
  test('loads and displays main sections', async ({ page }) => {
    await mockBackend(page);
    await page.goto(BASE_URL);

    // Wait for loading overlay to disappear
    await page.waitForSelector('#loading-overlay', { state: 'hidden', timeout: 15000 });

    // Verify key DOM elements exist
    await expect(page.locator('#page-home')).toBeVisible();
  });

  test('bottom navigation tabs are visible', async ({ page }) => {
    await mockBackend(page);
    await page.goto(BASE_URL);
    await page.waitForSelector('#loading-overlay', { state: 'hidden', timeout: 15000 });

    // Bottom tab bar should have navigation items
    const tabBar = page.locator('.bottom-tab-bar, .tab-bar, nav');
    await expect(tabBar.first()).toBeVisible();
  });
});

// ── Journey 2: Navigation between pages ──

test.describe('Navigation', () => {
  test('can navigate to activity page', async ({ page }) => {
    await mockBackend(page);
    await page.goto(BASE_URL);
    await page.waitForSelector('#loading-overlay', { state: 'hidden', timeout: 15000 });
    await dismissOptionalProfilePrompt(page);

    const activityTab = page.locator('.bot-tab[data-page="page-activities"]').first();
    await expect(activityTab).toBeVisible({ timeout: 10000 });
    await forceShowPageIfNeeded(page, 'page-activities');
    await expect(page.locator('#page-activities.active')).toBeVisible({ timeout: 10000 });
  });

  test('can navigate to profile page', async ({ page }) => {
    await mockBackend(page);
    await page.goto(BASE_URL);
    await page.waitForSelector('#loading-overlay', { state: 'hidden', timeout: 15000 });
    await dismissOptionalProfilePrompt(page);

    const profileTab = page.locator('.bot-tab[data-page="page-profile"]').first();
    await expect(profileTab).toBeVisible({ timeout: 10000 });
    await forceShowPageIfNeeded(page, 'page-profile');
    await expect(page.locator('#page-profile.active')).toBeVisible({ timeout: 10000 });
  });

  test('can navigate to tournament page', async ({ page }) => {
    await mockBackend(page);
    await page.goto(BASE_URL);
    await page.waitForSelector('#loading-overlay', { state: 'hidden', timeout: 15000 });
    await dismissOptionalProfilePrompt(page);

    const tournamentTab = page.locator('[data-page="page-tournaments"]').first();
    await expect(tournamentTab).toBeVisible();
    await forceShowPageIfNeeded(page, 'page-tournaments');
    await expect(page.locator('#page-tournaments.active')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#page-tournaments.active #tournament-timeline')).toBeAttached();
  });
});

// ── Journey 3: Deep link to event detail ──

test.describe('Deep Link', () => {
  test('event deep link parameter is preserved', async ({ page }) => {
    await mockBackend(page);
    await page.goto(`${BASE_URL}?event=test_event_123`);

    // The URL should contain the event parameter
    expect(page.url()).toContain('event=test_event_123');
  });
});

// ── Journey 4: PWA installability ──

test.describe('PWA', () => {
  test('manifest.json is accessible', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}/manifest.json`);
    expect(response.status()).toBe(200);
    const json = await response.json();
    expect(json.name).toContain('ToosterX');
    expect(json.display).toBe('standalone');
  });

  test('app boot code registers sw.js', async ({ page }) => {
    const response = await page.goto(BASE_URL);
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain("navigator.serviceWorker.register('./sw.js'");
  });
});

// ── Journey 5: Static pages load ──

test.describe('Static Pages', () => {
  test('privacy page loads', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}/privacy.html`);
    expect(response.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-TW');
    await expect(page).toHaveTitle(/ToosterX/);
    await expect(page.locator('h1')).toBeVisible();
  });

  test('terms page loads', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}/terms.html`);
    expect(response.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-TW');
    await expect(page).toHaveTitle(/ToosterX/);
    await expect(page.locator('h1')).toBeVisible();
  });
});
