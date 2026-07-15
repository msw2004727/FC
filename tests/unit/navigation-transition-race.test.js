/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const navigationSource = fs.readFileSync(
  path.join(ROOT, 'js/core/navigation.js'),
  'utf8'
);
const appSource = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const teamDetailSource = fs.readFileSync(
  path.join(ROOT, 'js/modules/team/team-detail.js'),
  'utf8'
);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function setupPages(activePage = 'page-current') {
  document.body.innerHTML = [
    'page-current',
    'page-old',
    'page-new',
    'page-home',
    'page-teams',
    'page-team-detail',
  ].map(pageId => (
    `<section id="${pageId}" class="page${pageId === activePage ? ' active' : ''}"></section>`
  )).join('');
  window.history.replaceState(null, '', '/#' + activePage);
}

function installNavigation(overrides = {}) {
  global.AUTH_REQUIRED_PAGES = [];
  global.PAGE_STRATEGY = {};
  global.PAGE_DATA_CONTRACT = {};
  global.PERFORMANCE_FLAGS = { fastShellNavigation: true };
  global.PERFORMANCE_LIMITS = {};
  global.LineAuth = {
    isLoggedIn: () => true,
    isPendingLogin: () => false,
    hasLiffSession: () => false,
  };
  global.ApiService = {
    getCurrentUser: () => null,
    getTeam: () => null,
    getTournament: () => null,
  };
  global.PageLoader = { ensurePage: jest.fn(async () => {}) };
  global.ScriptLoader = { ensureForPage: jest.fn(async () => {}) };
  global.FirebaseService = {
    ensureCollectionsForPage: jest.fn(async () => []),
    finalizePageScopedRealtimeForPage: jest.fn(),
    schedulePageScopedRealtimeForPage: jest.fn(),
  };
  global._withSportHubTimeout = promise => promise;
  global.requestAnimationFrame = callback => {
    callback();
    return 1;
  };

  global.App = {
    currentPage: 'page-current',
    pageHistory: [],
    _pageTransitionSeq: 0,
    _routeTransitionPendingSeq: 0,
    _routeTransitionPending: false,
    _cloudReady: true,
    _cloudReadyPromise: null,
    _instantDeepLinkMode: false,
    _pageLockUntil: 0,
    _userTouchedAt: 0,
    _isCurrentUserRestricted: () => false,
    _canAccessPage: () => true,
    _setRouteUrl: jest.fn(),
    _syncBottomTabForPage: jest.fn(),
    _clearTournamentDetailRouteParam: jest.fn(),
    _renderPageContent: jest.fn(),
    _resetPageScroll: jest.fn(),
    _cleanupBeforePageSwitch: jest.fn(),
    _maybeRunDeferredSwReload: jest.fn(),
    showToast: jest.fn(),
  };

  eval(navigationSource);
  Object.assign(global.App, {
    _setRouteUrl: jest.fn(),
    _syncBottomTabForPage: jest.fn(),
    _clearTournamentDetailRouteParam: jest.fn(),
    _renderPageContent: jest.fn(),
    _resetPageScroll: jest.fn(),
    _cleanupBeforePageSwitch: jest.fn(),
  }, overrides);

  global.App._showPageFreshFirst = jest.fn(async function (pageId, transitionSeq, options = {}) {
    if (transitionSeq !== this._pageTransitionSeq) {
      return { ok: false, reason: 'stale_transition' };
    }
    const target = this._activatePage(pageId, {
      ...options,
      render: false,
      resetScroll: false,
    });
    return target
      ? { ok: true, pageId }
      : { ok: false, reason: 'missing_target' };
  });
  return global.App;
}

function extractPopstateHandler(App, timeoutStub = () => 0) {
  const marker = "window.addEventListener('popstate', async (event) => {";
  const start = appSource.indexOf(marker);
  const bodyStart = start + marker.length;
  const end = appSource.indexOf('\n    });\n  } catch (e) {}', bodyStart);
  if (start < 0 || end < 0) throw new Error('Unable to extract popstate handler');
  const body = appSource.slice(bodyStart, end);
  // Execute the real handler body without running the full application boot.
  const factory = new Function(
    'App',
    'window',
    'history',
    'setTimeout',
    `return async function popstateHandler(event) {${body}\n};`
  );
  return factory(App, window, window.history, timeoutStub);
}

function extractPageshowHandler(App) {
  const marker = "window.addEventListener('pageshow', (event) => {";
  const start = appSource.indexOf(marker);
  const bodyStart = start + marker.length;
  const end = appSource.indexOf('\n    });\n  } catch (e) {}', bodyStart);
  if (start < 0 || end < 0) throw new Error('Unable to extract pageshow handler');
  const body = appSource.slice(bodyStart, end);
  const factory = new Function(
    'App',
    'document',
    `return function pageshowHandler(event) {${body}\n};`
  );
  return factory(App, document);
}

describe('global navigation transition races', () => {
  beforeEach(() => {
    setupPages();
  });

  afterEach(() => {
    delete global.App;
    delete global.AUTH_REQUIRED_PAGES;
    delete global.PAGE_STRATEGY;
    delete global.PAGE_DATA_CONTRACT;
    delete global.PERFORMANCE_FLAGS;
    delete global.PERFORMANCE_LIMITS;
    delete global.LineAuth;
    delete global.ApiService;
    delete global.PageLoader;
    delete global.ScriptLoader;
    delete global.FirebaseService;
    delete global._withSportHubTimeout;
    jest.restoreAllMocks();
  });

  test('verified continuation bypasses detail page lock while ordinary async navigation stays blocked', async () => {
    const App = installNavigation();

    const detailResult = await App.showPage('page-team-detail');
    expect(detailResult).toMatchObject({ ok: true, pageId: 'page-team-detail' });
    expect(App._pageLockUntil).toBeGreaterThan(Date.now());

    const blockedResult = await App.showPage('page-new');
    expect(blockedResult).toMatchObject({ ok: false, reason: 'page_locked' });
    expect(App.currentPage).toBe('page-team-detail');

    const continuationResult = await App.showPage('page-new', {
      _navigationTransitionSeq: App._pageTransitionSeq,
      bypassPageLock: true,
    });
    expect(continuationResult).toMatchObject({ ok: true, pageId: 'page-new' });
    expect(App.currentPage).toBe('page-new');
  });

  test('a delayed goBack cannot overwrite a newer page request', async () => {
    const collectionsReady = deferred();
    const App = installNavigation();
    App.pageHistory = ['page-old'];
    FirebaseService.ensureCollectionsForPage.mockReturnValueOnce(collectionsReady.promise);

    const backPromise = App.goBack();
    await Promise.resolve();
    await App.showPage('page-new');

    collectionsReady.resolve([]);
    await backPromise;

    expect(App.currentPage).toBe('page-new');
    expect(document.getElementById('page-new').classList.contains('active')).toBe(true);
    expect(document.getElementById('page-old').classList.contains('active')).toBe(false);
    expect(App.pageHistory).toEqual(['page-old']);
  });

  test('a superseded guarded route stops immediately after cloud readiness', async () => {
    const cloudReady = deferred();
    const canAccessPage = jest.fn(() => true);
    const App = installNavigation({
      ensureCloudReady: jest.fn(() => cloudReady.promise),
      _pageNeedsCloud: pageId => pageId === 'page-old',
      _canAccessPage: canAccessPage,
    });
    global.AUTH_REQUIRED_PAGES = ['page-old'];

    const oldRoutePromise = App.showPage('page-old');
    await Promise.resolve();
    expect(App.ensureCloudReady).toHaveBeenCalled();

    App._claimPageTransition('page-new');
    cloudReady.resolve(true);
    const result = await oldRoutePromise;

    expect(result).toMatchObject({ ok: false, reason: 'stale_transition' });
    expect(canAccessPage).not.toHaveBeenCalled();
    expect(App.currentPage).toBe('page-current');
  });

  test('superseded page readiness stops before scripts and collection loading', async () => {
    const pageReady = deferred();
    const App = installNavigation();
    App._pageTransitionSeq = 1;
    PageLoader.ensurePage.mockReturnValueOnce(pageReady.promise);

    const readinessPromise = App._ensurePageEntryReady('page-old', 1);
    await Promise.resolve();
    App._claimPageTransition('page-new');
    pageReady.resolve();
    const result = await readinessPromise;

    expect(result).toMatchObject({ ok: false, reason: 'stale_transition' });
    expect(ScriptLoader.ensureForPage).not.toHaveBeenCalled();
    expect(FirebaseService.ensureCollectionsForPage).not.toHaveBeenCalled();
  });

  test('a delayed stale-first route cannot activate or mutate history after a newer route', async () => {
    const scriptsReady = deferred();
    const App = installNavigation();
    App._pageTransitionSeq = 1;
    ScriptLoader.ensureForPage.mockReturnValueOnce(scriptsReady.promise);

    const stalePromise = App._showPageStale('page-old', 1, {});
    await Promise.resolve();
    await App.showPage('page-new');

    scriptsReady.resolve();
    const result = await stalePromise;

    expect(result).toMatchObject({ ok: false, reason: 'stale_transition' });
    expect(App.currentPage).toBe('page-new');
    expect(App.pageHistory).toEqual([]);
  });

  test('a lazy detail gateway does not call the loaded handler after the user leaves', async () => {
    const entryStarted = deferred();
    const entryReady = deferred();
    const App = installNavigation();
    App._showDetailRouteShell = jest.fn(async () => {
      App._activatePage('page-team-detail', {
        render: false,
        resetScroll: false,
        suppressHashSync: true,
      });
      return { ok: true, pageId: 'page-team-detail', shellFirst: true };
    });
    App._ensurePageEntryReady = jest.fn(() => {
      entryStarted.resolve();
      return entryReady.promise;
    });

    const routePromise = App.showTeamDetail('tm_test');
    await entryStarted.promise;
    App._userTouchedAt = Date.now();
    await App.showPage('page-new');

    const loadedHandler = jest.fn(async () => {
      App.currentPage = 'page-team-detail';
      return { ok: true };
    });
    App._showTeamDetailLoaded = loadedHandler;
    entryReady.resolve();
    const result = await routePromise;

    expect(result).toMatchObject({ ok: false, reason: 'stale_transition' });
    expect(loadedHandler).not.toHaveBeenCalled();
    expect(App.currentPage).toBe('page-new');
  });

  test('new navigation captures an old team module handler from the public slot', async () => {
    const App = installNavigation();
    const gateway = App.showTeamDetail;
    const oldLoadedHandler = jest.fn(async (teamId, options) => ({
      ok: true,
      teamId,
      options,
    }));
    App._showDetailRouteShell = jest.fn(async () => ({
      ok: true,
      pageId: 'page-team-detail',
      shellFirst: true,
    }));
    App._ensurePageEntryReady = jest.fn(async () => {
      App.showTeamDetail = oldLoadedHandler;
      return { ok: true };
    });

    const result = await App.showTeamDetail('team-old', { allowGuest: true });

    expect(result).toMatchObject({ ok: true, teamId: 'team-old' });
    expect(oldLoadedHandler).toHaveBeenCalledWith(
      'team-old',
      expect.objectContaining({
        allowGuest: true,
        bypassPageLock: true,
        skipPageHistory: true,
        _navigationTransitionSeq: expect.any(Number),
      })
    );
    expect(App._showTeamDetailLoaded).toBe(oldLoadedHandler);
    expect(App.showTeamDetail).toBe(gateway);
  });

  test('new navigation and new team module keep the public gateway stable', async () => {
    const App = installNavigation();
    const gateway = App.showTeamDetail;

    eval(teamDetailSource);

    expect(App.showTeamDetail).toBe(gateway);
    expect(App._showTeamDetailLoaded).toEqual(expect.any(Function));

    const newLoadedHandler = jest.fn(async teamId => ({ ok: true, teamId }));
    App._showTeamDetailLoaded = newLoadedHandler;
    App._showDetailRouteShell = jest.fn(async () => ({
      ok: true,
      pageId: 'page-team-detail',
      shellFirst: true,
    }));
    App._ensurePageEntryReady = jest.fn(async () => ({ ok: true }));

    await expect(
      App.showTeamDetail('team-new', { allowGuest: true })
    ).resolves.toMatchObject({ ok: true, teamId: 'team-new' });
    expect(newLoadedHandler).toHaveBeenCalledTimes(1);
    expect(App.showTeamDetail).toBe(gateway);
  });

  test('a stale Team A rejection cannot overwrite a newer Team B on the same detail page', async () => {
    const teamAReady = deferred();
    const teamAStarted = deferred();
    const App = installNavigation();
    App._showDetailRouteShell = jest.fn(async () => ({
      ok: true,
      pageId: 'page-team-detail',
      shellFirst: true,
    }));
    App._ensurePageEntryReady = jest.fn(async () => ({ ok: true }));
    App._renderLazyRouteFailure = jest.fn();
    App._showTeamDetailLoaded = jest.fn((teamId) => {
      if (teamId === 'teamA') {
        teamAStarted.resolve();
        return teamAReady.promise;
      }
      App.currentPage = 'page-team-detail';
      App._teamDetailId = teamId;
      return Promise.resolve({ ok: true, teamId });
    });

    const teamAPromise = App.showTeamDetail('teamA', { allowGuest: true });
    await teamAStarted.promise;
    const teamBResult = await App.showTeamDetail('teamB', { allowGuest: true });
    teamAReady.reject(new Error('stale Team A failed'));
    const teamAResult = await teamAPromise;

    expect(teamBResult).toMatchObject({ ok: true, teamId: 'teamB' });
    expect(teamAResult).toMatchObject({ ok: false, reason: 'stale_transition' });
    expect(App.currentPage).toBe('page-team-detail');
    expect(App._teamDetailId).toBe('teamB');
    expect(App._renderLazyRouteFailure).not.toHaveBeenCalled();
    expect(App.showToast).not.toHaveBeenCalled();
  });

  test('a stale PWA sentinel handler cannot re-push history over a newer route', async () => {
    const routeReady = deferred();
    const pushSpy = jest.spyOn(window.history, 'pushState');
    const App = {
      _popstateRequestSeq: 0,
      _pageTransitionSeq: 0,
      _getHistoryRouteFlags: () => ({ popstateTakeover: true }),
      _claimPageTransition(pageId, options = {}) {
        const inherited = Number(options._navigationTransitionSeq);
        return Number.isSafeInteger(inherited) && inherited > 0
          ? inherited
          : ++this._pageTransitionSeq;
      },
      _isPageTransitionCurrent(transitionSeq) {
        return transitionSeq === this._pageTransitionSeq;
      },
      showPage: jest.fn(() => routeReady.promise),
    };
    const handler = extractPopstateHandler(App);
    const handlerPromise = handler({
      state: {
        source: 'sportshub',
        sentinel: true,
        fallbackPageId: 'page-home',
      },
    });
    await Promise.resolve();
    expect(App.showPage).toHaveBeenCalledTimes(1);

    App._pageTransitionSeq += 1;
    routeReady.resolve({ ok: true, pageId: 'page-home' });
    await handlerPromise;

    expect(pushSpy).not.toHaveBeenCalled();
  });

  test('navigation diagnostics stay bounded and tolerate unavailable session storage', () => {
    const App = installNavigation();
    delete window.__toosterxNavigationDiagnostics;

    for (let index = 0; index < 25; index += 1) {
      App._recordNavigationDiagnostic(`kind-${index}`, {
        source: 'unit-test',
        pageId: 'page-new',
        userId: 'must-not-be-recorded',
      });
    }

    const diagnostics = window.__toosterxNavigationDiagnostics;
    expect(diagnostics).toHaveLength(20);
    expect(diagnostics[0].kind).toBe('kind-5');
    expect(diagnostics.at(-1).kind).toBe('kind-24');
    expect(diagnostics.at(-1).userId).toBeUndefined();

    const storageSpy = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => { throw new Error('storage unavailable'); });
    expect(() => App._recordNavigationDiagnostic('storage-failure')).not.toThrow();
    expect(window.__toosterxNavigationDiagnostics.at(-1).kind).toBe('storage-failure');
    storageSpy.mockRestore();
    delete window.__toosterxNavigationDiagnostics;
    sessionStorage.removeItem('_navigationDiagnostics');
  });

  test('BFCache pageshow only reconciles the restored page without navigating again', () => {
    setupPages('page-new');
    const App = {
      currentPage: 'page-old',
      _pageTransitionSeq: 7,
      _activePageTransitionSeq: 7,
      _userIntendedPage: 'page-old',
      _syncBottomTabForPage: jest.fn(),
      _recordNavigationDiagnostic: jest.fn(),
      _claimPageTransition: jest.fn(function claimPageTransition(pageId) {
        this._pageTransitionSeq += 1;
        this._userIntendedPage = pageId;
        return this._pageTransitionSeq;
      }),
    };
    const handler = extractPageshowHandler(App);

    handler({ persisted: false });
    expect(App._userIntendedPage).toBe('page-old');
    expect(App._syncBottomTabForPage).not.toHaveBeenCalled();
    expect(App._recordNavigationDiagnostic).not.toHaveBeenCalled();

    handler({ persisted: true });
    expect(App._claimPageTransition).toHaveBeenCalledWith('page-new');
    expect(App._pageTransitionSeq).toBe(8);
    expect(App._activePageTransitionSeq).toBe(8);
    expect(App._userIntendedPage).toBe('page-new');
    expect(App._syncBottomTabForPage).toHaveBeenCalledWith('page-new');
    expect(App._recordNavigationDiagnostic).toHaveBeenCalledWith(
      'pageshow-bfcache',
      expect.objectContaining({ pageId: 'page-new', persisted: true })
    );
  });

  test('persisted pageshow clears pending feedback on the restored team list', () => {
    setupPages('page-teams');
    document.getElementById('page-teams').innerHTML = '<div id="team-list"></div>';
    const teamList = document.getElementById('team-list');
    const App = {
      currentPage: 'page-teams',
      _pageTransitionSeq: 4,
      _activePageTransitionSeq: 4,
      _invalidateTeamCardOpenFlight: jest.fn(),
      _clearTeamCardPendings: jest.fn(),
      _syncBottomTabForPage: jest.fn(),
      _recordNavigationDiagnostic: jest.fn(),
      _claimPageTransition: jest.fn(function claimPageTransition() {
        this._pageTransitionSeq += 1;
        return this._pageTransitionSeq;
      }),
    };
    const handler = extractPageshowHandler(App);

    handler({ persisted: false });
    expect(App._invalidateTeamCardOpenFlight).not.toHaveBeenCalled();
    expect(App._clearTeamCardPendings).not.toHaveBeenCalled();

    handler({ persisted: true });
    expect(App._invalidateTeamCardOpenFlight).toHaveBeenCalledWith('bfcache-restore');
    expect(App._clearTeamCardPendings).toHaveBeenCalledTimes(1);
    expect(App._clearTeamCardPendings).toHaveBeenCalledWith(teamList);
  });

  test('persisted pageshow cancels an orphaned activity-create entry', () => {
    setupPages('page-activities');
    const App = {
      currentPage: 'page-activities',
      _pageTransitionSeq: 3,
      _activePageTransitionSeq: 3,
      _cancelActivityCreateEntry: jest.fn(),
      _cancelActivityCreateCompatEntry: jest.fn(),
      _syncBottomTabForPage: jest.fn(),
      _recordNavigationDiagnostic: jest.fn(),
      _claimPageTransition: jest.fn(function claimPageTransition() {
        this._pageTransitionSeq += 1;
        return this._pageTransitionSeq;
      }),
    };
    const handler = extractPageshowHandler(App);

    handler({ persisted: false });
    expect(App._cancelActivityCreateEntry).not.toHaveBeenCalled();
    expect(App._cancelActivityCreateCompatEntry).not.toHaveBeenCalled();

    handler({ persisted: true });
    expect(App._cancelActivityCreateEntry).toHaveBeenCalledWith('bfcache-restore');
    expect(App._cancelActivityCreateCompatEntry).toHaveBeenCalledWith('bfcache-restore');
  });
});
