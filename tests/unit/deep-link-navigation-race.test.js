const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.resolve(__dirname, '../../app.js'), 'utf8');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function extractAppMethod(methodName) {
  const escapedName = methodName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`\\n  (?:async\\s+)?${escapedName}\\s*\\(`).exec(appSource);
  if (!match) throw new Error(`Unable to find App method: ${methodName}`);
  const start = match.index + 1;
  const methodEndMarker = '\n  },';
  const end = appSource.indexOf(methodEndMarker, start);
  if (end < 0) throw new Error(`Unable to parse App method: ${methodName}`);
  const methodSource = appSource.slice(start, end + methodEndMarker.length);
  return new Function(`return ({\n${methodSource}\n}).${methodName};`)();
}

function installDeepLinkApp(pendingRef, overrides = {}) {
  const App = {
    _pageTransitionSeq: 0,
    _pendingDeepLinkTransitionSeq: 0,
    _pendingDeepLinkOpenKey: '',
    _pendingDeepLinkOpenPromise: null,
    _claimPageTransition(pageId, options = {}) {
      const inherited = Number(options._navigationTransitionSeq);
      const transitionSeq = Number.isSafeInteger(inherited) && inherited > 0
        ? inherited
        : ++this._pageTransitionSeq;
      if (transitionSeq === this._pageTransitionSeq) this._userIntendedPage = pageId;
      return transitionSeq;
    },
    _isPageTransitionCurrent(transitionSeq) {
      return transitionSeq === this._pageTransitionSeq;
    },
    _getPendingDeepLink: jest.fn(() => pendingRef.current),
    _showDeepLinkOverlay: jest.fn(),
    _stopDeepLinkGuard: jest.fn(),
    _clearPendingDeepLink: jest.fn(() => { pendingRef.current = null; }),
    _clearDeepLinkQueryParams: jest.fn(),
    _hideDeepLinkOverlay: jest.fn(),
    _recordNavigationDiagnostic: jest.fn(),
    showToast: jest.fn(),
    ...overrides,
  };
  App._startDeepLinkGuard = extractAppMethod('_startDeepLinkGuard');
  App._cancelSupersededPendingDeepLink = extractAppMethod('_cancelSupersededPendingDeepLink');
  App._completeDeepLinkFallback = extractAppMethod('_completeDeepLinkFallback');
  App._tryInstantEventDeepLink = extractAppMethod('_tryInstantEventDeepLink');
  App._tryOpenPendingDeepLink = extractAppMethod('_tryOpenPendingDeepLink');
  App._shouldSkipBootRouteForNewerIntent = extractAppMethod('_shouldSkipBootRouteForNewerIntent');
  App._clearPendingProtectedBootRoute = extractAppMethod('_clearPendingProtectedBootRoute');
  App._flushPendingProtectedBootRoute = extractAppMethod('_flushPendingProtectedBootRoute');
  return App;
}

describe('boot and deep-link navigation intent races', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    global.LineAuth = { isLoggedIn: () => true };
  });

  afterEach(() => {
    jest.useRealTimers();
    delete global.LineAuth;
    delete global.ApiService;
    delete global.FirebaseService;
    delete global.PageLoader;
    delete global.ScriptLoader;
    delete global._withSportHubTimeout;
    delete global.window;
    delete global.history;
    jest.restoreAllMocks();
  });

  test('a slow deep-link record fetch cannot start detail navigation after newer intent', async () => {
    const teamReady = deferred();
    const pendingRef = { current: { type: 'team', id: 'tm_slow' } };
    global.ApiService = { getTeam: jest.fn(() => null) };
    global.FirebaseService = {
      fetchTeamIfMissing: jest.fn(() => teamReady.promise),
    };
    const App = installDeepLinkApp(pendingRef, {
      showTeamDetail: jest.fn(),
    });

    App._startDeepLinkGuard();
    expect(App._pendingDeepLinkTransitionSeq).toBe(1);

    const openPromise = App._tryOpenPendingDeepLink();
    await Promise.resolve();
    expect(FirebaseService.fetchTeamIfMissing).toHaveBeenCalledWith('tm_slow');

    App._claimPageTransition('page-new');
    teamReady.resolve({ id: 'tm_slow', name: 'Slow team' });
    const result = await openPromise;

    expect(result).toBe(true);
    expect(App.showTeamDetail).not.toHaveBeenCalled();
    expect(App._clearPendingDeepLink).toHaveBeenCalled();
    expect(App._recordNavigationDiagnostic).toHaveBeenCalledWith(
      'stale-transition',
      expect.objectContaining({ source: 'pending-team-record', expectedSeq: 1 })
    );
  });

  test('instant REST event stops before HTML loading after newer intent', async () => {
    const eventReady = deferred();
    const pendingRef = { current: { type: 'event', id: 'ce_instant' } };
    global.PageLoader = { ensurePage: jest.fn(async () => {}) };
    global.FirebaseService = { _cache: { events: [] } };
    const App = installDeepLinkApp(pendingRef, {
      _deepLinkRestFetch: eventReady.promise,
      showEventDetail: jest.fn(),
    });

    App._startDeepLinkGuard();
    const instantPromise = App._tryInstantEventDeepLink();
    await Promise.resolve();
    App._claimPageTransition('page-new');
    eventReady.resolve({ id: 'ce_instant', title: 'Instant event' });
    const result = await instantPromise;

    expect(result).toBe(false);
    expect(PageLoader.ensurePage).not.toHaveBeenCalled();
    expect(App.showEventDetail).not.toHaveBeenCalled();
    expect(App._pageTransitionSeq).toBe(2);
  });

  test('instant REST event cannot reclaim navigation after HTML finishes late', async () => {
    const pageReady = deferred();
    const pendingRef = { current: { type: 'event', id: 'ce_instant' } };
    global.PageLoader = { ensurePage: jest.fn(() => pageReady.promise) };
    global.FirebaseService = { _cache: { events: [] } };
    const App = installDeepLinkApp(pendingRef, {
      _deepLinkRestFetch: Promise.resolve({ id: 'ce_instant', title: 'Instant event' }),
      showEventDetail: jest.fn(),
    });

    App._startDeepLinkGuard();
    const instantPromise = App._tryInstantEventDeepLink();
    await Promise.resolve();
    await Promise.resolve();
    expect(PageLoader.ensurePage).toHaveBeenCalledWith('page-activity-detail');

    App._claimPageTransition('page-new');
    pageReady.resolve();
    const result = await instantPromise;

    expect(result).toBe(false);
    expect(App.showEventDetail).not.toHaveBeenCalled();
    expect(App._pageTransitionSeq).toBe(2);
  });

  test('same-page deep-link fallback still invalidates in-flight detail work', () => {
    const pendingRef = { current: { type: 'event', id: 'ce_timeout' } };
    const App = installDeepLinkApp(pendingRef);
    App.currentPage = 'page-home';
    App.showPage = jest.fn();

    App._startDeepLinkGuard();
    const detailTransitionSeq = App._pendingDeepLinkTransitionSeq;
    App._completeDeepLinkFallback('timeout', 'page-home');

    expect(detailTransitionSeq).toBe(1);
    expect(App.showPage).not.toHaveBeenCalled();
    expect(App._pageTransitionSeq).toBe(2);
    expect(App._userIntendedPage).toBe('page-home');
    expect(App._pendingDeepLinkTransitionSeq).toBe(0);
  });

  test('different-page deep-link fallback reuses its claimed transition', () => {
    const pendingRef = { current: { type: 'event', id: 'ce_timeout' } };
    const App = installDeepLinkApp(pendingRef);
    App.currentPage = 'page-home';
    App.showPage = jest.fn();

    App._startDeepLinkGuard();
    App._completeDeepLinkFallback('timeout', 'page-activities');

    expect(App.showPage).toHaveBeenCalledWith(
      'page-activities',
      { _navigationTransitionSeq: 2 }
    );
    expect(App._pageTransitionSeq).toBe(2);
    expect(App._userIntendedPage).toBe('page-activities');
    expect(App._pendingDeepLinkTransitionSeq).toBe(0);
  });

  test('late boot routing is skipped when a newer page intent exists', () => {
    const shouldSkip = extractAppMethod('_shouldSkipBootRouteForNewerIntent');
    expect(shouldSkip.call({ _userIntendedPage: 'page-teams' }, 'page-activities')).toBe(true);
    expect(shouldSkip.call({ _userIntendedPage: 'page-activities' }, 'page-activities')).toBe(false);
    expect(shouldSkip.call({ _userIntendedPage: null, currentPage: 'page-home' }, 'page-activities')).toBe(false);
    expect(shouldSkip.call({ _userIntendedPage: 'page-home', currentPage: 'page-home' }, 'page-activities')).toBe(true);
    expect(appSource).toContain('App._shouldSkipBootRouteForNewerIntent?.(bootPageId)');
  });

  test('protected boot restore treats an explicit home intent as newer', async () => {
    const cloudReady = deferred();
    const pendingRef = { current: null };
    global.FirebaseService = {};
    global._withSportHubTimeout = promise => promise;
    const App = installDeepLinkApp(pendingRef, {
      currentPage: 'page-home',
      _userIntendedPage: null,
      _pendingProtectedBootRoute: { pageId: 'page-admin-users' },
      _pendingProtectedBootRoutePromise: null,
      _pageNeedsCloud: () => true,
      ensureCloudReady: jest.fn(() => cloudReady.promise),
      _routeCloudTimeoutMs: 15000,
      showPage: jest.fn(async () => ({ ok: true })),
      _replaceRouteHash: jest.fn(),
    });

    const restorePromise = App._flushPendingProtectedBootRoute();
    await Promise.resolve();
    expect(App.ensureCloudReady).toHaveBeenCalled();
    App._claimPageTransition('page-home');
    cloudReady.resolve(true);
    const result = await restorePromise;

    expect(result).toBe(false);
    expect(App.showPage).not.toHaveBeenCalled();
    expect(App._pendingProtectedBootRoute).toBeNull();
  });

  test('protected boot restore keeps the default initial home neutral', async () => {
    const pendingRef = { current: null };
    global.FirebaseService = {};
    global._withSportHubTimeout = promise => promise;
    const App = installDeepLinkApp(pendingRef, {
      currentPage: 'page-home',
      _userIntendedPage: null,
      _pendingProtectedBootRoute: { pageId: 'page-admin-users' },
      _pendingProtectedBootRoutePromise: null,
      _pageNeedsCloud: () => false,
      showPage: jest.fn(async () => ({ ok: true })),
      _replaceRouteHash: jest.fn(),
    });

    const result = await App._flushPendingProtectedBootRoute({ skipEnsureCloudReady: true });

    expect(result).toBe(true);
    expect(App.showPage).toHaveBeenCalledWith('page-admin-users', expect.objectContaining({ fromBootFlush: true }));
  });

  test('stale deep-link cleanup preserves the newer route history state', () => {
    const pendingRef = { current: { type: 'event', id: 'ce_old' } };
    const currentState = { source: 'sportshub', pageId: 'page-new', id: 'ce_new' };
    global.window = {
      location: { href: 'https://toosterx.com/events/new?event=ce_old#page-new' },
    };
    global.history = {
      state: currentState,
      replaceState: jest.fn(),
    };
    const App = installDeepLinkApp(pendingRef, {
      currentPage: 'page-old',
      _buildRouteStateForCurrentPage: jest.fn(() => ({ source: 'sportshub', pageId: 'page-old' })),
    });
    App._clearDeepLinkQueryParams = extractAppMethod('_clearDeepLinkQueryParams');

    App._startDeepLinkGuard();
    App._claimPageTransition('page-new');
    const cancelled = App._cancelSupersededPendingDeepLink('test-stale-cleanup');

    expect(cancelled).toBe(true);
    expect(history.replaceState).toHaveBeenCalledWith(
      currentState,
      '',
      '/events/new#page-new'
    );
    expect(App._buildRouteStateForCurrentPage).not.toHaveBeenCalled();
  });
  test('instant SDK refresh reuses the event detail transition that scheduled it', () => {
    const start = appSource.indexOf("if (this._instantDeepLinkEventId && this.currentPage === 'page-activity-detail'");
    const end = appSource.indexOf("console.log('[DeepLink] SDK background refresh complete", start);
    const block = appSource.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(block).toContain('const sdkEventTransitionSeq = Number(this._activePageTransitionSeq);');
    expect(block).toContain('this._isPageTransitionCurrent?.(sdkEventTransitionSeq) === true');
    expect(block).toContain('await this._refreshCurrentEventDetail(sdkEventId, sdkEventTransitionSeq');
    expect(block).not.toContain('await this.showEventDetail(sdkEventId');
  });

});
