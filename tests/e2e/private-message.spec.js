// @ts-check
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installTestHarness, TEST_USERS } = require('./helpers/test-harness');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const ROOT = path.join(__dirname, '../..');
const MY_UID = 'U11111111111111111111111111111111';
const PEER_UID = 'U22222222222222222222222222222222';

async function openHarnessPage(page, options = {}) {
  if (options.viewport) {
    await page.setViewportSize(options.viewport);
  }
  await installTestHarness(page, TEST_USERS.userBasic);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loading-overlay', { state: 'hidden', timeout: 15000 });
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => (
    typeof App !== 'undefined'
    && typeof ScriptLoader !== 'undefined'
    && typeof ApiService !== 'undefined'
    && typeof FirebaseService !== 'undefined'
  ));
}

async function forceLoadModule(page, file) {
  const scriptPath = path.join(ROOT, file);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.addScriptTag({ path: scriptPath });
      return;
    } catch (err) {
      if (!/Execution context was destroyed|Cannot find context/i.test(String(err?.message || err)) || attempt === 2) {
        throw err;
      }
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(250);
    }
  }
}

async function loadPmDialogRuntime(page) {
  await forceLoadModule(page, 'js/modules/message/pm-permission.js');
  await forceLoadModule(page, 'js/modules/message/pm-dialog.js');
  await forceLoadModule(page, 'js/modules/message/pm-dialog-actions.js');
  await expect.poll(async () => page.evaluate(() => (
    typeof App !== 'undefined'
    && typeof App._ensurePmDialog === 'function'
    && typeof App._renderPmDialogMessages === 'function'
    && typeof App._installPmDialogViewportGuard === 'function'
  )), { timeout: 5000 }).toBe(true);

  await page.evaluate(async ({ myUid, peerUid }) => {
    Object.defineProperty(window.navigator, 'platform', { value: 'iPhone', configurable: true });
    Object.defineProperty(window.navigator, 'maxTouchPoints', { value: 5, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });
    const viewportListeners = {};
    Object.defineProperty(window, 'visualViewport', {
      value: {
        height: 520,
        offsetTop: 120,
        addEventListener(name, callback) { viewportListeners[name] = callback; },
        removeEventListener(name) { delete viewportListeners[name]; },
        __emit(name) { viewportListeners[name]?.(); },
      },
      configurable: true,
    });
    ApiService.getCurrentUser = () => ({ uid: myUid, displayName: 'Me' });
    App._requireProtectedActionLogin = () => false;
    App._pmCurrentUid = () => myUid;
    App.showToast = message => { window.__pmToast = message; };

    const cId = App.pmBuildConversationId(myUid, peerUid);
    const behind = document.createElement('button');
    behind.id = 'pm-behind-click-target';
    behind.type = 'button';
    behind.textContent = 'behind';
    behind.style.cssText = 'position:fixed;left:0;top:0;width:120px;height:120px;z-index:1;';
    behind.onclick = () => { window.__pmBehindClicked = true; };
    document.body.appendChild(behind);
    window.__pmBehindClicked = false;

    const overlay = App._ensurePmDialog();
    App._currentPmDialog = { targetUid: peerUid, conversationId: cId, peerName: 'Peer User' };
    overlay.querySelector('.pm-dialog-peer-name').textContent = 'Peer User';
    overlay.querySelector('.pm-dialog-peer-sub').textContent = peerUid;
    overlay.querySelector('.pm-dialog-input').value = '';
    overlay.style.display = 'flex';
    document.body.classList.add('pm-dialog-open');
    App._pmDialogMessages = [{
      id: 'm1',
      messageId: 'm1',
      fromUid: peerUid,
      direction: 'in',
      body: '測試訊息',
      read: false,
      createdAt: new Date().toISOString(),
    }];
    App._renderPmDialogMessages(App._pmDialogMessages);
    App._installPmDialogViewportGuard(overlay);
  }, { myUid: MY_UID, peerUid: PEER_UID });
}

test.describe('Private message runtime', () => {
  test('mobile PM dialog keeps the keyboard layout usable and closes after focus', async ({ page }) => {
    await openHarnessPage(page, { viewport: { width: 390, height: 844 } });
    await loadPmDialogRuntime(page);

    const overlay = page.locator('#pm-dialog-overlay');
    const input = page.locator('#pm-dialog-overlay .pm-dialog-input');
    await expect(overlay).toBeVisible();
    await expect(input).toBeVisible();

    const topLayer = await page.evaluate(() => {
      const el = document.elementFromPoint(8, 8);
      return { id: el?.id || '', className: String(el?.className || '') };
    });
    expect(topLayer.id).not.toBe('pm-behind-click-target');
    expect(await page.evaluate(() => window.__pmBehindClicked)).toBe(false);

    await input.focus();
    await page.evaluate(() => window.visualViewport.__emit('resize'));
    await expect(overlay).toHaveClass(/is-keyboard-open/);
    const heightVar = await overlay.evaluate(el => el.style.getPropertyValue('--pm-vv-height'));
    expect(heightVar).toBe('520px');

    await page.locator('#pm-dialog-overlay .pm-dialog-close').click();
    await expect(overlay).toBeHidden();
    expect(await page.evaluate(() => document.body.classList.contains('pm-dialog-open'))).toBe(false);
  });

  test('desktop PM fresh bubble turns into stale unread reminder and keeps the bell hint visible', async ({ page }) => {
    await openHarnessPage(page, { viewport: { width: 1280, height: 720 } });
    await forceLoadModule(page, 'js/modules/message/pm-permission.js');
    await forceLoadModule(page, 'js/modules/message/pm-listener.js');
    await expect.poll(async () => page.evaluate(() => (
      typeof App !== 'undefined'
      && typeof App._showPmIncomingBubble === 'function'
      && typeof App._handlePmFreshBubbleTimeout === 'function'
    )), { timeout: 5000 }).toBe(true);

    await page.evaluate(async ({ myUid, peerUid }) => {
      App._pmCurrentUid = () => myUid;
      const cId = `pm_${[myUid, peerUid].sort().join('_')}`;
      const freshThread = {
        conversationId: cId,
        peerUid,
        peerName: 'Desktop Peer',
        unreadCount: 1,
        lastMessageId: 'fresh-desktop-message',
        lastMessageAt: new Date().toISOString(),
        lastMessageBody: 'desktop message',
      };
      FirebaseService._cache.pmThreads = [freshThread];
      document.getElementById('notif-btn')?.classList.add('has-pm-unread');
      App._showPmIncomingBubble({ ...freshThread, _pmBubbleMode: 'fresh' });
      App._handlePmFreshBubbleTimeout();
    }, { myUid: MY_UID, peerUid: PEER_UID });

    const bubble = page.locator('#pm-incoming-bubble');
    await expect(bubble).toBeVisible();
    await expect(bubble).toHaveAttribute('data-mode', 'reminder');
    await expect(bubble).toContainText('未讀');
    await expect(page.locator('#pm-notif-hint')).toBeVisible();
  });
});
