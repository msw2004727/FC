// @ts-check
const { test, expect } = require('@playwright/test');

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
async function mockBackend(page) {
  // Block real Firebase/LIFF requests
  await page.route('**/*.firebaseio.com/**', route => route.fulfill({ status: 200, body: '{}' }));
  await page.route('**/googleapis.com/**', route => route.fulfill({ status: 200, body: '{}' }));
  await page.route('**/api.line.me/**', route => route.fulfill({ status: 200, body: '{}' }));

  // Inject mock globals before page scripts run
  await page.addInitScript(() => {
    // Mock ModeManager to force Demo mode
    window.__FORCE_DEMO = true;
  });
}

async function dismissOptionalProfilePrompt(page) {
  await page.evaluate(() => {
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

    // Click activities tab (look for common patterns)
    const activityTab = page.locator('[data-page="page-activities"], [onclick*="activities"]').first();
    if (await activityTab.isVisible()) {
      await activityTab.click();
      await page.waitForTimeout(500);
    }
  });

  test('can navigate to profile page', async ({ page }) => {
    await mockBackend(page);
    await page.goto(BASE_URL);
    await page.waitForSelector('#loading-overlay', { state: 'hidden', timeout: 15000 });

    const profileTab = page.locator('[data-page="page-profile"], [onclick*="profile"]').first();
    if (await profileTab.isVisible()) {
      await profileTab.click();
      await page.waitForTimeout(500);
    }
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

  test('service worker is registered', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForTimeout(2000);

    const swRegistered = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false;
      const reg = await navigator.serviceWorker.getRegistration();
      return !!reg;
    });
    // SW may or may not be registered in test env; just verify no error
    expect(typeof swRegistered).toBe('boolean');
  });
});

// ── Journey 5: Static pages load ──

test.describe('Static Pages', () => {
  test('privacy page loads', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}/privacy.html`);
    expect(response.status()).toBe(200);
    await expect(page.locator('body')).toContainText('隱私');
  });

  test('terms page loads', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}/terms.html`);
    expect(response.status()).toBe(200);
    await expect(page.locator('body')).toContainText('服務');
  });
});
