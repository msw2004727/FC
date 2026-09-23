/** @jest-environment jsdom */

const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.resolve(__dirname, '../../app.js'), 'utf8');
const pageLoaderSource = fs.readFileSync(path.resolve(__dirname, '../../js/core/page-loader.js'), 'utf8');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function extractAppMethod(name) {
  const startMatch = new RegExp(`\\n  (?:async\\s+)?${name}\\s*\\(`).exec(appSource);
  if (!startMatch) throw new Error(`Unable to find App method: ${name}`);
  const start = startMatch.index + 1;
  const endMarker = '\n  },';
  const end = appSource.indexOf(endMarker, start);
  if (end < 0) throw new Error(`Unable to parse App method: ${name}`);
  return new Function(`return ({\n${appSource.slice(start, end + endMarker.length)}\n}).${name};`)();
}

function createApp(overrides = {}) {
  const app = {
    currentPage: 'page-home',
    _userIntendedPage: null,
    _cloudReady: false,
    _getPendingDeepLink: jest.fn(() => null),
    _resolveRouteIntent: jest.fn(() => ({ pageId: 'page-home' })),
    _scheduleHomeDeferredRender: jest.fn(),
    renderHomeCritical: jest.fn(() => {
      const entry = document.getElementById('home-sport-entry');
      if (entry) entry.innerHTML = '<button class="home-sport-chip-more">查看更多</button>';
    }),
    showToast: jest.fn(),
    ...overrides,
  };
  app._isHomeContentReady = extractAppMethod('_isHomeContentReady');
  app._markHomeContentReady = extractAppMethod('_markHomeContentReady');
  app._shouldRetryHomeContent = extractAppMethod('_shouldRetryHomeContent');
  app._renderHomeWhenReady = extractAppMethod('_renderHomeWhenReady');
  app._onHomeFragmentLoaded = extractAppMethod('_onHomeFragmentLoaded');
  return app;
}

function createLoader(app, homeTextPromise) {
  const fetchImpl = jest.fn(async url => {
    const file = String(url).match(/pages\/([^?]+)\.html/)?.[1];
    if (file === 'home') {
      return { ok: true, status: 200, text: () => homeTextPromise };
    }
    return { ok: true, status: 200, text: async () => '<div id="test-modal"></div>' };
  });
  const factory = new Function(
    'document', 'window', 'location', 'sessionStorage', 'fetch',
    'AbortController', 'CACHE_VERSION', 'App',
    `${pageLoaderSource}; return PageLoader;`,
  );
  const loader = factory(
    document, window, window.location, sessionStorage, fetchImpl,
    AbortController, 'test-version', app,
  );
  return { loader, fetchImpl };
}

async function flushMicrotasks() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

describe('late home fragment recovery', () => {
  beforeEach(() => {
    document.body.innerHTML = '<main id="main-content"></main><div id="modal-container"></div>';
    sessionStorage.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
    delete global.PageLoader;
    delete global.LineAuth;
  });

  test('home arriving after the 10-second boot render window still gains visible content', async () => {
    jest.useFakeTimers();
    const homeText = deferred();
    const app = createApp();
    const { loader } = createLoader(app, homeText.promise);

    const boot = loader.loadAll();
    await flushMicrotasks();
    jest.advanceTimersByTime(12000);
    expect(document.getElementById('page-home')).toBeNull();
    expect(app.renderHomeCritical).not.toHaveBeenCalled();

    homeText.resolve('<section class="page active" id="page-home"><div id="home-sport-entry"></div></section>');
    await boot;

    expect(document.querySelector('#home-sport-entry .home-sport-chip-more')).not.toBeNull();
    expect(app.renderHomeCritical).toHaveBeenCalledTimes(1);
    expect(app._isHomeContentReady()).toBe(true);
  });

  test('a late home fragment does not render over a different active route', async () => {
    document.getElementById('main-content').innerHTML = '<section class="page active" id="page-activities"></section>';
    const homeText = deferred();
    const app = createApp({
      currentPage: 'page-activities',
      _userIntendedPage: 'page-activities',
      _resolveRouteIntent: jest.fn(() => ({ pageId: 'page-activities' })),
    });
    const { loader } = createLoader(app, homeText.promise);
    const boot = loader.loadAll();

    homeText.resolve('<section class="page active" id="page-home"><div id="home-sport-entry"></div></section>');
    await boot;

    expect(app.renderHomeCritical).not.toHaveBeenCalled();
    expect(document.getElementById('page-activities').classList.contains('active')).toBe(true);
    expect(document.getElementById('page-home').classList.contains('active')).toBe(false);
  });

  test('deep-link fallback re-renders the current home once its fragment arrives', async () => {
    const homeText = deferred();
    let pending = { type: 'event', id: 'test-event' };
    const app = createApp({
      _pageTransitionSeq: 1,
      _pendingDeepLinkTransitionSeq: 1,
      _getPendingDeepLink: jest.fn(() => pending),
      _isPageTransitionCurrent: jest.fn(seq => seq === app._pageTransitionSeq),
      _cancelSupersededPendingDeepLink: jest.fn(() => false),
      _stopDeepLinkGuard: jest.fn(),
      _clearPendingDeepLink: jest.fn(() => { pending = null; }),
      _clearDeepLinkQueryParams: jest.fn(),
      _hideDeepLinkOverlay: jest.fn(),
      _maybeRunDeferredSwReload: jest.fn(),
      _claimPageTransition: jest.fn(pageId => {
        app._userIntendedPage = pageId;
        return ++app._pageTransitionSeq;
      }),
      showPage: jest.fn(),
    });
    app._completeDeepLinkFallback = extractAppMethod('_completeDeepLinkFallback');
    const { loader } = createLoader(app, homeText.promise);
    global.PageLoader = loader;
    global.LineAuth = { isLoggedIn: () => false };

    const boot = loader.loadAll();
    app._completeDeepLinkFallback('timeout', 'page-home');
    await flushMicrotasks();
    expect(app.showPage).not.toHaveBeenCalled();
    expect(app.renderHomeCritical).not.toHaveBeenCalled();

    homeText.resolve('<section class="page active" id="page-home"><div id="home-sport-entry"></div></section>');
    await boot;
    await flushMicrotasks();

    expect(document.querySelector('#home-sport-entry .home-sport-chip-more')).not.toBeNull();
    expect(app._isHomeContentReady()).toBe(true);
    expect(app.showPage).not.toHaveBeenCalled();
  });

  test('cloud readiness alone cannot mark an empty homepage complete', () => {
    document.getElementById('main-content').innerHTML = '<section class="page active" id="page-home"><div id="home-sport-entry"></div></section>';
    const app = createApp({ _cloudReady: true });

    expect(app._isHomeContentReady()).toBe(false);
    app.renderHomeCritical();
    expect(app._isHomeContentReady()).toBe(true);
  });
});
