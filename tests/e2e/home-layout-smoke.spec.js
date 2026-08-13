// @ts-check
const { test, expect } = require('@playwright/test');
const { installTestHarness, TEST_USERS } = require('./helpers/test-harness');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const TRANSPARENT_GIF = 'data:image/gif;base64,R0lGODlhAQABAIABAP///wAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

function captureUnexpectedBrowserErrors(page) {
  const pageErrors = [];
  const consoleErrors = [];
  const cloudRequests = [];
  page.on('pageerror', error => pageErrors.push(error.stack || error.message));
  page.on('request', request => {
    const url = request.url();
    if (/^https:\/\/(?:www\.gstatic\.com\/firebasejs\/|[^/]+\.cloudfunctions\.net\/|firestore\.googleapis\.com\/|identitytoolkit\.googleapis\.com\/|securetoken\.googleapis\.com\/)/.test(url)) {
      cloudRequests.push(url);
    }
  });
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    const location = message.location();
    const expectedOfflineResourceError = [
      'Failed to load resource: Could not connect to server',
      'Failed to load resource: net::ERR_NETWORK_ACCESS_DENIED',
    ].includes(text)
      && /^(https:\/\/(?:firebasestorage\.googleapis\.com\/|www\.gstatic\.com\/firebasejs\/))/.test(location.url);
    const expectedPreconnectDnsError = location.url === ''
      && /^Failed to preconnect to https:\/\/line-scdn\.net\/\. Error: Error resolving [“"]line-scdn\.net[”"]: No address associated with hostname$/.test(text);
    if (!expectedOfflineResourceError && !expectedPreconnectDnsError) {
      consoleErrors.push({ text, location });
    }
  });
  return { pageErrors, consoleErrors, cloudRequests };
}

function expectNoUnexpectedBrowserErrors(errors) {
  expect(errors.pageErrors).toEqual([]);
  expect(errors.consoleErrors).toEqual([]);
  expect(errors.cloudRequests).toEqual([]);
}

async function installDisabledServiceWorkerStub(page) {
  await page.addInitScript(() => {
    const serviceWorker = Object.freeze({
      addEventListener() {},
      getRegistrations: async () => [],
      register: async () => ({}),
    });
    try {
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: false,
        value: serviceWorker,
      });
    } catch (_) {}
  });
}

async function installGuestLiffBoot(page) {
  await page.addInitScript(() => {
    const forceGuest = value => {
      if (!value || (typeof value !== 'object' && typeof value !== 'function')) return value;
      try {
        Object.defineProperty(value, 'isLoggedIn', {
          configurable: true,
          writable: true,
          value: () => false,
        });
      } catch (_) {
        try { value.isLoggedIn = () => false; } catch (_) {}
      }
      return value;
    };
    const descriptor = Object.getOwnPropertyDescriptor(window, 'liff');
    let currentLiff = forceGuest(window.liff);
    if (!descriptor || descriptor.configurable) {
      Object.defineProperty(window, 'liff', {
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
        get: () => forceGuest(currentLiff),
        set: value => { currentLiff = forceGuest(value); },
      });
    }
    document.addEventListener('DOMContentLoaded', () => {
      if (typeof App !== 'undefined') {
        App._cloudBootScheduled = false;
        App._cloudReady = true;
        App._cloudReadyPromise = Promise.resolve(true);
      }
      if (typeof FirebaseService !== 'undefined') {
        FirebaseService.ensureCollectionsForPage = async () => [];
        FirebaseService.ensureFullUsersReadyForPage = async () => [];
        FirebaseService.schedulePageScopedRealtimeForPage = () => {};
        FirebaseService.finalizePageScopedRealtimeForPage = () => {};
      }
    }, { once: true });
  });
}

async function openSeededHome(page) {
  await installTestHarness(page, TEST_USERS.userBasic);
  await installGuestLiffBoot(page);
  await installDisabledServiceWorkerStub(page);
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({
    status: 200,
    contentType: 'text/css',
    body: '',
  }));
  await page.goto(BASE_URL);
  await page.waitForSelector('#loading-overlay', { state: 'hidden', timeout: 15000 });
  await page.waitForFunction(() => (
    typeof App !== 'undefined'
    && typeof FirebaseService !== 'undefined'
    && typeof App.renderBannerCarousel === 'function'
    && typeof App.renderHomeDashboard === 'function'
    && typeof window.liff?.isLoggedIn === 'function'
    && window.liff.isLoggedIn() === false
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

async function enableActivityCreate(page) {
  const authState = await page.evaluate(() => {
    const user = window.__E2E_TEST_HARNESS__?.currentUser;
    if (typeof LineAuth !== 'undefined') {
      LineAuth._ready = true;
      LineAuth.isLoggedIn = () => true;
      LineAuth.isPendingLogin = () => false;
      LineAuth._profile = {
        userId: user.uid,
        displayName: user.displayName,
        pictureUrl: user.pictureUrl || '',
      };
      LineAuth.getProfile = () => LineAuth._profile;
    }
    if (!FirebaseService._cache) FirebaseService._cache = {};
    FirebaseService._cache.currentUser = user;
    FirebaseService._cache.events = [];
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
    return {
      highLevelLoggedIn: LineAuth.isLoggedIn(),
      lowLevelLoggedIn: window.liff.isLoggedIn(),
      hasLiffSession: LineAuth.hasLiffSession(),
      accessToken: LineAuth.getAccessToken(),
      currentUid: FirebaseService._cache.currentUser?.uid || '',
      expectedUid: user.uid,
    };
  });
  expect(authState).toEqual({
    highLevelLoggedIn: true,
    lowLevelLoggedIn: false,
    hasLiffSession: false,
    accessToken: null,
    currentUid: TEST_USERS.userBasic.uid,
    expectedUid: TEST_USERS.userBasic.uid,
  });
}

async function openActivityCreateModal(page, { viaHomeCta = true } = {}) {
  if (viaHomeCta) {
    const createButton = page.locator('.home-hero-actions .home-create-event-btn');
    await expect(createButton).toBeVisible();
    await createButton.click();
    await expect(page.locator('#create-event-type-sheet')).toBeVisible({ timeout: 10000 });
    await page.locator('#cets-custom').click();
  } else {
    await page.evaluate(async () => {
      await PageLoader.ensurePage('page-activities');
      App.showModal('create-event-modal');
    });
  }
  await expect(page.locator('#create-event-modal')).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(350);
}

async function readCreateModalGeometry(page) {
  return page.evaluate(() => {
    const modal = document.getElementById('create-event-modal');
    const header = modal.querySelector(':scope > .modal-header');
    const body = modal.querySelector(':scope > .modal-body');
    const actions = modal.querySelector(':scope > .modal-actions');
    const modalRect = modal.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      modal: { top: modalRect.top, bottom: modalRect.bottom, width: modalRect.width, height: modalRect.height },
      header: { top: headerRect.top, bottom: headerRect.bottom },
      body: {
        top: bodyRect.top,
        bottom: bodyRect.bottom,
        clientHeight: body.clientHeight,
        scrollHeight: body.scrollHeight,
        overflowY: getComputedStyle(body).overflowY,
      },
      actions: { top: actionsRect.top, bottom: actionsRect.bottom },
      shellOverflow: getComputedStyle(modal).overflow,
      htmlLocked: document.documentElement.classList.contains('create-event-modal-open'),
      bodyLocked: document.body.classList.contains('create-event-modal-open'),
    };
  });
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

  test('home create CTA opens the activity create sheet on mobile browsers', async ({ page }, testInfo) => {
    const mobileProjects = new Set(['chromium-mobile', 'webkit-mobile']);
    test.skip(!mobileProjects.has(testInfo.project.name), 'mobile-only CTA coverage');
    await page.setViewportSize({ width: 390, height: 844 });
    const browserErrors = captureUnexpectedBrowserErrors(page);
    await openSeededHome(page);
    await enableActivityCreate(page);
    await openActivityCreateModal(page);
    await page.waitForFunction(() => {
      const rect = document.getElementById('create-event-modal').getBoundingClientRect();
      return Math.abs(rect.top) <= 1
        && Math.abs(rect.bottom - window.innerHeight) <= 1
        && Math.abs(rect.width - window.innerWidth) <= 1;
    });

    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      const geometry = await readCreateModalGeometry(page);
      expect(Math.abs(geometry.modal.top)).toBeLessThanOrEqual(1);
      expect(Math.abs(geometry.modal.bottom - geometry.viewport.height)).toBeLessThanOrEqual(1);
      expect(Math.abs(geometry.modal.width - geometry.viewport.width)).toBeLessThanOrEqual(1);
      expect(geometry.header.top).toBeGreaterThanOrEqual(-1);
      expect(geometry.body.top).toBeGreaterThanOrEqual(geometry.header.bottom - 1);
      expect(geometry.actions.top).toBeGreaterThanOrEqual(geometry.body.bottom - 1);
      expect(Math.abs(geometry.actions.bottom - geometry.viewport.height)).toBeLessThanOrEqual(1);
      expect(geometry.shellOverflow).toBe('hidden');
      expect(geometry.body.overflowY).toBe('auto');
      expect(geometry.body.scrollHeight).toBeGreaterThan(geometry.body.clientHeight);
      expect(geometry.htmlLocked).toBe(true);
      expect(geometry.bodyLocked).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath('activity-create-mobile-dark.png'), fullPage: false });

    const actionsBeforeScroll = await page.locator('#create-event-modal > .modal-actions').boundingBox();
    await page.locator('#create-event-modal > .modal-body').evaluate(element => {
      element.scrollTop = element.scrollHeight;
    });
    const actionsAfterScroll = await page.locator('#create-event-modal > .modal-actions').boundingBox();
    expect(Math.abs(actionsAfterScroll.y - actionsBeforeScroll.y)).toBeLessThanOrEqual(1);

    if (testInfo.project.name === 'chromium-mobile') {
      const scrollBeforeWheel = await page.evaluate(() => window.scrollY);
      const headerBox = await page.locator('#create-event-modal > .modal-header').boundingBox();
      await page.mouse.move(headerBox.x + headerBox.width / 2, headerBox.y + headerBox.height / 2);
      await page.mouse.wheel(0, 500);
      expect(await page.evaluate(() => window.scrollY)).toBe(scrollBeforeWheel);
    }

    const touchResults = await page.evaluate(() => {
      const overlayEvent = new Event('touchmove', { bubbles: true, cancelable: true });
      const bodyEvent = new Event('touchmove', { bubbles: true, cancelable: true });
      document.getElementById('modal-overlay').dispatchEvent(overlayEvent);
      document.querySelector('#create-event-modal > .modal-body').dispatchEvent(bodyEvent);
      return { overlayPrevented: overlayEvent.defaultPrevented, bodyPrevented: bodyEvent.defaultPrevented };
    });
    expect(touchResults).toEqual({ overlayPrevented: true, bodyPrevented: false });

    await page.locator('#create-event-modal > .modal-header .modal-close').click();
    await expect(page.locator('#create-event-modal')).not.toHaveClass(/\bopen\b/);
    await page.waitForFunction(() => (
      document.getElementById('create-event-modal').getBoundingClientRect().top >= window.innerHeight - 1
    ));
    const unlocked = await page.evaluate(() => ({
      htmlLocked: document.documentElement.classList.contains('create-event-modal-open'),
      bodyLocked: document.body.classList.contains('create-event-modal-open'),
      bodyPosition: document.body.style.position,
      modalTop: document.getElementById('create-event-modal').getBoundingClientRect().top,
      viewportHeight: window.innerHeight,
    }));
    expect(unlocked).toEqual(expect.objectContaining({
      htmlLocked: false,
      bodyLocked: false,
      bodyPosition: '',
    }));
    expect(unlocked.modalTop).toBeGreaterThanOrEqual(unlocked.viewportHeight - 1);
    expectNoUnexpectedBrowserErrors(browserErrors);
  });

  test('create modal navigation cleanup works for route switches and browser back', async ({ page }, testInfo) => {
    const mobileProjects = new Set(['chromium-mobile', 'webkit-mobile']);
    test.skip(!mobileProjects.has(testInfo.project.name), 'mobile Chromium/WebKit navigation coverage');
    await page.setViewportSize({ width: 390, height: 844 });
    const browserErrors = captureUnexpectedBrowserErrors(page);
    await openSeededHome(page);
    await enableActivityCreate(page);
    await openActivityCreateModal(page);

    const blocked = await page.evaluate(async () => {
      App._eventSubmitInFlight = true;
      const startingPage = App.currentPage;
      const result = await App.showPage('page-teams', { bypassPageLock: true });
      return {
        result,
        startingPage,
        currentPage: App.currentPage,
        modalOpen: document.getElementById('create-event-modal').classList.contains('open'),
        overlayOpen: document.getElementById('modal-overlay').classList.contains('open'),
        bodyLocked: document.body.classList.contains('create-event-modal-open'),
      };
    });
    expect(blocked).toEqual(expect.objectContaining({
      result: { ok: false, reason: 'event_create_submitting' },
      startingPage: 'page-activities',
      currentPage: 'page-activities',
      modalOpen: true,
      overlayOpen: true,
      bodyLocked: true,
    }));

    const switched = await page.evaluate(async () => {
      App._eventSubmitInFlight = false;
      const result = await App.showPage('page-teams', { bypassPageLock: true });
      const overlay = document.getElementById('modal-overlay');
      return {
        result,
        currentPage: App.currentPage,
        modalOpen: document.getElementById('create-event-modal').classList.contains('open'),
        overlayOpen: overlay.classList.contains('open'),
        overlayPointerEvents: getComputedStyle(overlay).pointerEvents,
        htmlLocked: document.documentElement.classList.contains('create-event-modal-open'),
        bodyLocked: document.body.classList.contains('create-event-modal-open'),
        bodyPosition: document.body.style.position,
      };
    });
    expect(switched).toEqual(expect.objectContaining({
      result: expect.objectContaining({ ok: true, pageId: 'page-teams' }),
      currentPage: 'page-teams',
      modalOpen: false,
      overlayOpen: false,
      overlayPointerEvents: 'none',
      htmlLocked: false,
      bodyLocked: false,
      bodyPosition: '',
    }));

    const capturedScroll = await page.evaluate(() => {
      const spacer = document.createElement('div');
      spacer.style.height = '1800px';
      spacer.dataset.e2eScrollSpacer = '1';
      document.body.appendChild(spacer);
      window.scrollTo(0, 180);
      const scrollY = window.scrollY;
      const nativeScrollTo = window.scrollTo.bind(window);
      window.__e2eScrollCalls = [];
      window.scrollTo = (x, y) => {
        window.__e2eScrollCalls.push([Number(x) || 0, Number(y) || 0]);
        nativeScrollTo(x, y);
      };
      App.showModal('create-event-modal');
      return scrollY;
    });
    await expect(page.locator('#create-event-modal')).toHaveClass(/\bopen\b/);

    await page.evaluate(() => history.back());
    await page.waitForFunction(() => App.currentPage === 'page-activities');
    const returned = await page.evaluate(() => {
      const overlay = document.getElementById('modal-overlay');
      return {
        modalOpen: document.getElementById('create-event-modal').classList.contains('open'),
        overlayOpen: overlay.classList.contains('open'),
        overlayPointerEvents: getComputedStyle(overlay).pointerEvents,
        htmlLocked: document.documentElement.classList.contains('create-event-modal-open'),
        bodyLocked: document.body.classList.contains('create-event-modal-open'),
        bodyPosition: document.body.style.position,
        scrollCalls: window.__e2eScrollCalls,
      };
    });
    expect(returned).toEqual(expect.objectContaining({
      modalOpen: false,
      overlayOpen: false,
      overlayPointerEvents: 'none',
      htmlLocked: false,
      bodyLocked: false,
      bodyPosition: '',
    }));
    expect(returned.scrollCalls).toContainEqual([0, capturedScroll]);
    expectNoUnexpectedBrowserErrors(browserErrors);
  });

  test('activity create modal keeps desktop bottom-sheet geometry and honors the 640px boundary', async ({ page }, testInfo) => {
    const boundaryProjects = new Set(['chromium-desktop', 'webkit-mobile']);
    test.skip(!boundaryProjects.has(testInfo.project.name), 'desktop and WebKit breakpoint coverage');
    const browserErrors = captureUnexpectedBrowserErrors(page);
    await openSeededHome(page);
    await enableActivityCreate(page);
    await openActivityCreateModal(page, { viaHomeCta: false });

    if (testInfo.project.name === 'chromium-desktop') {
      for (const theme of ['light', 'dark']) {
        await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
        const geometry = await readCreateModalGeometry(page);
        expect(geometry.modal.top).toBeGreaterThan(0);
        expect(Math.abs(geometry.modal.bottom - geometry.viewport.height)).toBeLessThanOrEqual(1);
        expect(geometry.modal.height).toBeLessThanOrEqual(geometry.viewport.height * 0.8 + 1);
        expect(geometry.modal.width).toBeLessThanOrEqual(640);
      }
    }

    await page.evaluate(() => App.closeModal());
    await page.setViewportSize({ width: 640, height: 720 });
    await page.evaluate(() => App.showModal('create-event-modal'));
    await page.waitForTimeout(350);
    let geometry = await readCreateModalGeometry(page);
    expect(Math.abs(geometry.modal.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.modal.bottom - geometry.viewport.height)).toBeLessThanOrEqual(1);

    await page.evaluate(() => App.closeModal());
    await page.setViewportSize({ width: 641, height: 720 });
    await page.evaluate(() => App.showModal('create-event-modal'));
    await page.waitForTimeout(350);
    geometry = await readCreateModalGeometry(page);
    expect(geometry.modal.top).toBeGreaterThan(0);
    expect(Math.abs(geometry.modal.bottom - geometry.viewport.height)).toBeLessThanOrEqual(1);
    expect(geometry.modal.height).toBeLessThanOrEqual(geometry.viewport.height * 0.8 + 1);
    expectNoUnexpectedBrowserErrors(browserErrors);
  });
});
