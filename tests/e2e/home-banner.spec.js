// @ts-check
const { test, expect } = require('@playwright/test');
const { installTestHarness, TEST_USERS } = require('./helpers/test-harness');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const IMAGE_1 = 'data:image/gif;base64,R0lGODlhAQABAIABAP///wAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
const IMAGE_2 = IMAGE_1;

async function openHome(page) {
  await installTestHarness(page, TEST_USERS.userBasic);
  await page.goto(BASE_URL);
  await page.waitForSelector('#loading-overlay', { state: 'hidden', timeout: 15000 });
  await page.waitForFunction(() => (
    typeof App !== 'undefined'
    && typeof ApiService !== 'undefined'
    && typeof FirebaseService !== 'undefined'
    && typeof App.renderBannerCarousel === 'function'
  ));
}

async function seedBanners(page) {
  await page.evaluate(({ image1, image2 }) => {
    if (!FirebaseService._cache) FirebaseService._cache = {};
    FirebaseService._cache.banners = [
      {
        id: 'e2e-ban-1',
        _docId: 'e2e-ban-1',
        status: 'active',
        image: image1,
        slot: 1,
        title: 'Phase 8 fixed title',
        subtitle: 'Phase 8 fixed subtitle',
      },
      {
        id: 'e2e-ban-2',
        _docId: 'e2e-ban-2',
        status: 'active',
        image: image2,
        slot: 2,
        title: 'Second slide title',
        subtitle: 'Second slide subtitle',
      },
    ];
    App._bannerRenderFingerprint = '';
    App.renderBannerCarousel({ autoplay: false });
  }, { image1: IMAGE_1, image2: IMAGE_2 });
}

test.describe('home banner phase 8', () => {
  test('keeps CTA overlay fixed while carousel slides change', async ({ page }) => {
    await openHome(page);
    await seedBanners(page);

    const fixed = page.locator('.banner-fixed-content');
    await expect(fixed).toBeVisible();
    await expect(fixed.locator('h2')).toContainText('Phase 8 fixed title');
    await expect(page.locator('.banner-slide .banner-content')).toHaveCount(0);
    await expect(page.locator('.banner-dot')).toHaveCount(2);

    await page.evaluate(() => App.goToBanner(1));

    await expect(page.locator('.banner-dot').nth(1)).toHaveClass(/active/);
    await expect(fixed.locator('h2')).toContainText('Phase 8 fixed title');
    await expect(fixed.locator('h2')).not.toContainText('Second slide title');
  });

  test('find activity modal applies selected filters to activity page', async ({ page }) => {
    await openHome(page);
    await seedBanners(page);

    await page.locator('.banner-find-btn').click();
    await expect(page.locator('#home-activity-search-overlay')).toHaveClass(/open/);

    const regionValue = await page.locator('#home-search-region option').nth(1).getAttribute('value');
    await page.locator('#home-search-region').selectOption(regionValue || '');
    await page.locator('#home-search-sport').selectOption('football');
    await page.locator('#home-search-type').selectOption('watch');
    await page.locator('.home-activity-search-submit').click();

    await expect(page.locator('#page-activities')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#home-activity-search-overlay')).not.toHaveClass(/open/);

    const state = await page.evaluate(() => ({
      activeSport: App._activeSport,
      storedSport: localStorage.getItem('sporthub_active_sport'),
      storedRegion: localStorage.getItem('toosterx_home_activity_region'),
      activityType: document.getElementById('activity-filter-type')?.value || '',
      activityKeyword: document.getElementById('activity-filter-keyword')?.value || '',
    }));

    expect(state.activeSport).toBe('football');
    expect(state.storedSport).toBe('football');
    expect(state.storedRegion).toBe(regionValue);
    expect(state.activityType).toBe('watch');
    expect(state.activityKeyword).toBe('');
  });
});
