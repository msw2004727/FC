// @ts-check
const { test, expect } = require('@playwright/test');
const { installTestHarness, TEST_USERS } = require('./helpers/test-harness');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const TRANSPARENT_GIF = 'data:image/gif;base64,R0lGODlhAQABAIABAP///wAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

async function openSeededHome(page) {
  await installTestHarness(page, TEST_USERS.userBasic);
  await page.goto(BASE_URL);
  await page.waitForSelector('#loading-overlay', { state: 'hidden', timeout: 15000 });
  await page.waitForFunction(() => (
    typeof App !== 'undefined'
    && typeof FirebaseService !== 'undefined'
    && typeof App.renderBannerCarousel === 'function'
    && typeof App.renderHomeDashboard === 'function'
  ));
  await page.evaluate((image) => {
    if (!FirebaseService._cache) FirebaseService._cache = {};
    FirebaseService._cache.banners = [
      { id: 'smoke-ban-1', status: 'active', image, slot: 1, title: 'Smoke banner', subtitle: 'Smoke subtitle' },
      { id: 'smoke-ban-2', status: 'active', image, slot: 2, title: 'Smoke banner 2', subtitle: 'Smoke subtitle 2' },
      { id: 'watch-party-bg', _docId: 'watch-party-bg', type: 'watchParty', slot: 'watch-party-bg', status: 'active', title: 'Watch party', image, linkType: 'activities' },
      { id: 'home-info', _docId: 'home-info', type: 'homeInfo', slot: 'home-info', status: 'active' },
    ];
    App._bannerRenderFingerprint = '';
    App._homeSummary = {
      counts: { activities: 22, teams: 7, tournaments: 0 },
      activityViews: { total: 1238, label: 'views' },
      sportCounts: [{ sportTag: 'football', count: 17 }, { sportTag: 'pickleball', count: 2 }],
    };
    App.renderBannerCarousel({ autoplay: false });
    App.renderHomeDashboard();
  }, TRANSPARENT_GIF);
}

test.describe('phase 9 home layout smoke', () => {
  test('main home containers stay inside the viewport and screenshot is non-empty', async ({ page }) => {
    await openSeededHome(page);

    await expect(page.locator('.banner-fixed-content')).toBeVisible();
    await expect(page.locator('.banner-find-btn')).toBeVisible();
    await expect(page.locator('.banner-create-event-btn')).toBeVisible();

    const screenshot = await page.screenshot({ fullPage: false });
    expect(screenshot.length).toBeGreaterThan(1000);

    const overflow = await page.evaluate(() => {
      const selectors = [
        '.banner-carousel',
        '.banner-fixed-content',
        '.home-hero-actions',
        '#announce-marquee-wrap',
        '#home-next-activity',
        '#home-sport-entry',
        '.home-info-dashboard-section',
        '.home-watch-party-card',
      ];
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      return selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)).map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const visible = style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        return {
          selector,
          visible,
          left: rect.left,
          right: rect.right,
          width: rect.width,
          viewportWidth,
          overflows: visible && (rect.left < -1 || rect.right > viewportWidth + 1),
        };
      })).filter(item => item.visible && item.overflows);
    });

    expect(overflow).toEqual([]);
  });

  test('home create CTA opens the activity create sheet on mobile chromium', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'mobile-only CTA coverage');
    await openSeededHome(page);

    await page.evaluate(() => {
      const user = window.__E2E_TEST_HARNESS__?.currentUser;
      if (!FirebaseService._cache) FirebaseService._cache = {};
      FirebaseService._cache.currentUser = user;
      FirebaseService._cache.roleActivityCapabilities = {
        user: { capabilities: ['user.activity.basic_create', 'user.activity.own_manage_entry'] },
      };
      App.currentRole = 'user';
      App.hasPermission = code => code === 'event.create';
      App._hasActivityManageEntry = () => true;
      App._ensureActivityRoleCapabilitiesReady = async () => ['roleActivityCapabilities'];
      App._refreshActivityCreateButton?.();
      document.querySelectorAll('.home-create-event-btn').forEach(button => {
        button.style.display = 'inline-flex';
      });
    });

    const createButton = page.locator('.home-hero-actions .home-create-event-btn');
    await expect(createButton).toBeVisible();
    await createButton.click();

    await expect(page.locator('#create-event-type-sheet')).toBeVisible({ timeout: 10000 });
    await page.locator('#cets-custom').click();
    await expect(page.locator('#create-event-modal')).toBeVisible({ timeout: 10000 });
  });
});
