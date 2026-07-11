/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

const navigationSource = fs.readFileSync(
  path.join(__dirname, '../../js/core/navigation.js'),
  'utf8'
);

function flushAsyncClick() {
  return Promise.resolve().then(() => Promise.resolve());
}

function createApp(showPage) {
  global.AUTH_REQUIRED_PAGES = [];
  global.App = {
    currentPage: 'page-home',
    pageHistory: ['page-detail'],
    _isCurrentUserRestricted: () => false,
    _requireProtectedActionLogin: () => false,
    showPage,
    showToast: jest.fn(),
  };
  eval(navigationSource);
  global.App.showPage = showPage;
  return global.App;
}

describe('bottom navigation reliability', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <nav id="bottom-tabs">
        <button class="bot-tab" data-page="page-tournaments">Tournaments</button>
        <button class="bot-tab" data-page="page-teams">Teams</button>
        <button class="bot-tab active" data-page="page-home">Home</button>
        <button class="bot-tab" data-page="page-activities">Activities</button>
        <button class="bot-tab" data-page="page-profile">Profile</button>
      </nav>
    `;
  });

  afterEach(() => {
    delete global.App;
    delete global.AUTH_REQUIRED_PAGES;
    jest.restoreAllMocks();
  });

  test('bindNavigation is idempotent and one click triggers one route request', async () => {
    const showPage = jest.fn(async () => ({ ok: true, pageId: 'page-teams' }));
    const app = createApp(showPage);

    app.bindNavigation();
    app.bindNavigation();
    document.querySelector('[data-page="page-teams"]').click();
    await flushAsyncClick();

    expect(showPage).toHaveBeenCalledTimes(1);
    expect(showPage).toHaveBeenCalledWith('page-teams');
    expect(document.getElementById('bottom-tabs').dataset.navigationBound).toBe('1');
  });

  test('all five bottom tabs share the reliable route handler', async () => {
    const showPage = jest.fn(async (pageId) => ({ ok: true, pageId }));
    const app = createApp(showPage);
    const pages = ['page-tournaments', 'page-teams', 'page-home', 'page-activities', 'page-profile'];

    app.bindNavigation();
    for (const pageId of pages) {
      document.querySelector(`[data-page="${pageId}"]`).click();
      await flushAsyncClick();
    }

    expect(showPage.mock.calls.map(([pageId]) => pageId)).toEqual(pages);
  });

  test('failed route keeps the current active tab and reports a missing target', async () => {
    const app = createApp(jest.fn(async () => ({ ok: false, reason: 'missing_target' })));

    app.bindNavigation();
    document.querySelector('[data-page="page-teams"]').click();
    await flushAsyncClick();

    expect(document.querySelector('[data-page="page-home"]').classList.contains('active')).toBe(true);
    expect(document.querySelector('[data-page="page-teams"]').classList.contains('active')).toBe(false);
    expect(app.showToast).toHaveBeenCalledWith('\u9801\u9762\u8f09\u5165\u5931\u6557\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66');
  });

  test('unexpected route rejection is caught and leaves navigation usable', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const showPage = jest
      .fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce({ ok: true, pageId: 'page-teams' });
    const app = createApp(showPage);
    app.bindNavigation();
    const teamsTab = document.querySelector('[data-page="page-teams"]');

    teamsTab.click();
    await flushAsyncClick();
    teamsTab.click();
    await flushAsyncClick();

    expect(showPage).toHaveBeenCalledTimes(2);
    expect(app.showToast).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      '[Navigation] bottom tab failed for page-teams:',
      expect.any(Error)
    );
  });

  test('guard exceptions are caught without disabling the next click', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const showPage = jest.fn(async () => ({ ok: true, pageId: 'page-teams' }));
    const app = createApp(showPage);
    app._isCurrentUserRestricted = jest
      .fn()
      .mockImplementationOnce(() => { throw new Error('guard failure'); })
      .mockReturnValue(false);
    app.bindNavigation();
    const teamsTab = document.querySelector('[data-page="page-teams"]');

    teamsTab.click();
    await flushAsyncClick();
    teamsTab.click();
    await flushAsyncClick();

    expect(showPage).toHaveBeenCalledTimes(1);
    expect(app.showToast).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      '[Navigation] bottom tab failed for page-teams:',
      expect.any(Error)
    );
  });
});

describe('App.init navigation ordering contract', () => {
  test('bottom navigation binds before other core UI initializers', () => {
    const appSource = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8');
    const initStart = appSource.indexOf('  init() {');
    const nonCoreStart = appSource.indexOf('// \u2500\u2500 \u975e\u6838\u5fc3\u6a21\u7d44', initStart);
    const initCore = appSource.slice(initStart, nonCoreStart);

    expect(initStart).toBeGreaterThan(-1);
    expect(nonCoreStart).toBeGreaterThan(initStart);
    expect(initCore.indexOf('this.bindNavigation();')).toBeLessThan(
      initCore.indexOf('this.bindSportPicker();')
    );
    expect(initCore.indexOf('this.bindNavigation();')).toBeLessThan(
      initCore.indexOf("this._initSyncBar")
    );
  });
});
