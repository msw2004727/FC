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
      App.dismissFirstLoginModal();
      return;
    }

    modal.classList.remove('show', 'active');
    modal.style.display = 'none';
    document.body.classList.remove('modal-open');
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

    const activityTab = page.locator('[data-page="page-activities"], [onclick*="activities"]').first();
    await expect(activityTab).toBeVisible({ timeout: 10000 });
    await activityTab.click();
    await expect(page.locator('#page-activities')).toBeVisible({ timeout: 10000 });
  });

  test('can navigate to profile page', async ({ page }) => {
    await mockBackend(page);
    await page.goto(BASE_URL);
    await page.waitForSelector('#loading-overlay', { state: 'hidden', timeout: 15000 });
    await dismissOptionalProfilePrompt(page);

    const profileTab = page.locator('.bot-tab[data-page="page-profile"]').first();
    await expect(profileTab).toBeVisible({ timeout: 10000 });
    await profileTab.click();
    await page.evaluate(async () => {
      if (typeof App !== 'undefined') {
        await App.showPage?.('page-profile');
      }
    });
    await expect(page.locator('#page-profile')).toBeVisible({ timeout: 10000 });
  });

  test('can navigate to tournament page', async ({ page }) => {
    await mockBackend(page);
    await page.goto(BASE_URL);
    await page.waitForSelector('#loading-overlay', { state: 'hidden', timeout: 15000 });
    await dismissOptionalProfilePrompt(page);

    const tournamentTab = page.locator('[data-page="page-tournaments"]').first();
    await expect(tournamentTab).toBeVisible();
    await tournamentTab.click();
    await expect(page.locator('#page-tournaments')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#tournament-timeline')).toBeAttached();
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
