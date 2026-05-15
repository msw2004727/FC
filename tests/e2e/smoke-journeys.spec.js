// @ts-check
const { test, expect } = require('@playwright/test');
const { installTestHarness, TEST_USERS } = require('./helpers/test-harness');

/**
 * SportHub E2E — 新功能 smoke journeys（Phase 4）
 *
 * 補 example.spec.js 以外的新功能驗證：
 *   - 儀表板鑽取彈窗（2026-04-20 新增的 8 張卡片）
 *   - 多分頁警告 modal（2026-04-17 新增）
 *   - 深淺主題切換
 *   - 活動詳情頁 deep link
 *
 * Prerequisites:
 *   npx playwright install chromium
 *   npx serve . -l 3000
 *
 * Run:
 *   npx playwright test tests/e2e/smoke-journeys.spec.js
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

/** Mock Firebase / LIFF / LINE 以允許離線測試 */
async function mockBackend(page, user = TEST_USERS.userBasic) {
  await installTestHarness(page, user);
}

async function openAdminDashboard(page) {
  await mockBackend(page, TEST_USERS.admin);
  await page.goto(`${BASE_URL}#page-admin-dashboard`);
  await page.waitForSelector('#loading-overlay', { state: 'hidden', timeout: 15000 });
  await page.waitForFunction(() => (
    typeof App !== 'undefined'
    && typeof ScriptLoader !== 'undefined'
    && typeof FirebaseService !== 'undefined'
  ));
  const result = await page.evaluate(async () => {
    const user = window.__E2E_TEST_HARNESS__?.currentUser;
    if (!FirebaseService._cache) FirebaseService._cache = {};
    if (user) FirebaseService._cache.currentUser = user;
    FirebaseService._cache.rolePermissions = {
      admin: { permissions: ['admin.dashboard.entry'] },
      super_admin: { permissions: ['admin.dashboard.entry', 'admin.roles.entry'] },
    };
    if (user?.role) {
      App.currentRole = user.role;
    }
    await ScriptLoader.ensureForPage?.('page-admin-dashboard');
    document.querySelectorAll('.page').forEach(pageEl => pageEl.classList.remove('active'));
    const target = document.getElementById('page-admin-dashboard');
    if (!target) return { ok: false, reason: 'missing_dashboard_page' };
    target.classList.add('active');
    App.currentPage = 'page-admin-dashboard';
    App.renderDashboard?.();
    return {
      ok: target.classList.contains('active'),
      cards: document.querySelectorAll('.dash-card[data-drill-key]').length,
    };
  });
  expect(result.ok, `admin dashboard harness failed: ${JSON.stringify(result)}`).toBe(true);
  await expect(page.locator('#page-admin-dashboard')).toBeVisible({ timeout: 10000 });
}

// ═══════════════════════════════════════════════════════════════════
// Journey 1: 儀表板鑽取彈窗（Phase 1+2 新增）
// ═══════════════════════════════════════════════════════════════════

test.describe('Dashboard Drilldown', () => {
  test('儀表板卡片帶 data-drill-key 屬性', async ({ page }) => {
    await openAdminDashboard(page);

    // 檢查卡片有 data-drill-key（新功能）
    const cards = page.locator('.dash-card[data-drill-key]');
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
  });

  test('儀表板 refresh bar 包含時間區間下拉', async ({ page }) => {
    await openAdminDashboard(page);

    const select = page.locator('#dash-months-range');
    await expect(select).toBeVisible();
    const values = await select.locator('option').evaluateAll(options => options.map(option => option.value));
    expect(values).toEqual(expect.arrayContaining(['1', '3', '6', '12']));
  });

  test('說明按鈕（?）存在於 refresh bar', async ({ page }) => {
    await openAdminDashboard(page);

    const infoBtn = page.locator('.dash-refresh-bar .dash-info-btn');
    await expect(infoBtn.first()).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Journey 2: 多分頁警告（2026-04-17 新增）
// ═══════════════════════════════════════════════════════════════════

test.describe('Multi-Tab Guard', () => {
  test('multi-tab-guard.js 載入成功', async ({ page }) => {
    await mockBackend(page);
    await page.goto(BASE_URL);

    await expect.poll(async () => {
      try {
        return await page.evaluate(() => (
          typeof App !== 'undefined' && typeof App.initMultiTabGuard === 'function'
        ));
      } catch (_) {
        return false;
      }
    }, { timeout: 10000 }).toBe(true);
  });

  test('BroadcastChannel 不支援時靜默降級（不 throw）', async ({ page }) => {
    await mockBackend(page);
    // Prevent BroadcastChannel
    await page.addInitScript(() => {
      Object.defineProperty(window, 'BroadcastChannel', { value: undefined, writable: true });
    });
    await page.goto(BASE_URL);
    await page.waitForTimeout(2000);

    // 確認頁面仍然載入（沒因為缺 BC 而 crash）
    await expect(page.locator('body')).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Journey 3: 深淺主題切換
// ═══════════════════════════════════════════════════════════════════

test.describe('Theme', () => {
  test('預設主題屬性存在', async ({ page }) => {
    await mockBackend(page);
    await page.goto(BASE_URL);
    await page.waitForTimeout(1000);

    // 檢查 html 標籤有 data-theme 屬性（light 或 dark）
    const theme = await page.evaluate(() => {
      return document.documentElement.getAttribute('data-theme');
    });
    expect(['light', 'dark']).toContain(theme);
  });

  test('CSS 變數能正確讀取（--accent 等）', async ({ page }) => {
    await mockBackend(page);
    await page.goto(BASE_URL);
    await page.waitForTimeout(1000);

    const accentColor = await page.evaluate(() => {
      return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    });
    // 應該有某個顏色值
    expect(accentColor.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Journey 4: 活動詳情 deep link
// ═══════════════════════════════════════════════════════════════════

test.describe('Deep Link — Activity Detail', () => {
  test('?event=xxx 會觸發 deep link 機制', async ({ page }) => {
    await mockBackend(page);
    await page.goto(`${BASE_URL}?event=ce_test_123`);
    await page.waitForTimeout(2000);

    // URL 被保留（不會被重定向洗掉）
    expect(page.url()).toContain('event=ce_test_123');
  });

  test('#page-activity-detail hash 路由', async ({ page }) => {
    await mockBackend(page);
    await page.goto(`${BASE_URL}#page-activity-detail`);
    await page.waitForTimeout(2000);

    // Hash 應被保留，避免 deep-link fallback 把原始入口洗掉
    expect(page.url()).toContain('#page-activity-detail');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Journey 5: 個人資料卡片（2026-04-20 新增三按鈕）
// ═══════════════════════════════════════════════════════════════════

test.describe('User Card', () => {
  test('page-user-card 有 detail-view-count-wrap（瀏覽數 pill）', async ({ page }) => {
    await mockBackend(page);
    await page.goto(`${BASE_URL}#page-activity-detail`);
    await page.waitForTimeout(2000);

    await expect(page.locator('#detail-view-count-wrap')).toBeAttached({ timeout: 10000 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Journey 6: Service Worker + 快取版本
// ═══════════════════════════════════════════════════════════════════

test.describe('Service Worker', () => {
  test('sw.js 可訪問', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}/sw.js`);
    expect(response.status()).toBe(200);
    const text = await response.text();
    // 應包含 CACHE_NAME 定義
    expect(text).toContain('CACHE_NAME');
    expect(text).toContain('sporthub-');
  });
});
