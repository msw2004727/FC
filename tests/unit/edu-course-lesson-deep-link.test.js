const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function extractMethod(source, name, nextName) {
  const startCandidates = [`  ${name}(`, `  async ${name}(`]
    .map(signature => source.indexOf(signature))
    .filter(index => index >= 0);
  const start = startCandidates.length ? Math.min(...startCandidates) : -1;
  const endCandidates = [`\n  ${nextName}(`, `\n  async ${nextName}(`]
    .map(signature => source.indexOf(signature, start + 1))
    .filter(index => index >= 0);
  const end = endCandidates.length ? Math.min(...endCandidates) : -1;
  if (start < 0 || end < 0) throw new Error(`Unable to extract ${name}`);
  return source.slice(start, end).trimEnd();
}

function installRouteWriter(app, runtime) {
  const source = read('app.js');
  const preserve = extractMethod(source, '_shouldPreserveEduCourseLessonRouteUrl', '_setRouteUrl');
  const writer = extractMethod(source, '_setRouteUrl', '_isBootHistoryShellPage');
  // eslint-disable-next-line no-new-func
  return new Function('App', 'window', 'history', 'location', 'URL', `
    Object.assign(App, {
      ${preserve}
      ${writer}
    });
    return App;
  `)(app, runtime.window, runtime.history, runtime.location, URL);
}

function installNavigationMethod(app, runtime, name, nextName) {
  const method = extractMethod(read('js/core/navigation.js'), name, nextName);
  // eslint-disable-next-line no-new-func
  return new Function('App', 'window', 'history', 'location', 'document', 'PageLoader', `
    Object.assign(App, { ${method} });
    return App;
  `)(app, runtime.window, runtime.history, runtime.location, runtime.document, runtime.PageLoader);
}

function installHistoryRouteReader(app, runtime) {
  const method = extractMethod(
    read('app.js'),
    '_readCurrentHistoryRoute',
    '_hasLegacyRouteSignal'
  );
  // eslint-disable-next-line no-new-func
  return new Function('App', 'window', `
    Object.assign(App, { ${method} });
    return App;
  `)(app, runtime.window);
}

function createRuntime(href) {
  const parsed = new URL(href);
  const location = {
    href,
    pathname: parsed.pathname,
    search: parsed.search,
    hash: parsed.hash,
    hostname: parsed.hostname,
  };
  const history = {
    state: { source: 'sportshub', pageId: 'page-team-detail', id: 'teamA' },
    pushState: jest.fn(),
    replaceState: jest.fn(),
  };
  const window = {
    location,
    history,
    HistoryRouteAdapter: require('../../js/core/history-route-adapter.js'),
  };
  const pageNode = { classList: { add: jest.fn(), remove: jest.fn() } };
  const document = {
    getElementById: jest.fn(() => pageNode),
    querySelectorAll: jest.fn(() => []),
  };
  return {
    location,
    history,
    window,
    document,
    PageLoader: { ensurePage: jest.fn(async () => true) },
  };
}

function createApp(runtime) {
  const app = {
    _getHistoryRouteFlags: () => ({ writeDetailPaths: true, writeListPaths: true }),
    _shouldDisableHistoryPathWrite: () => false,
    _getExplicitDetailRouteId: route => String(route?.id || ''),
    _getDetailRoutePath: (pageId, id) => pageId === 'page-team-detail' ? `/teams/${id}` : '',
    _getListRoutePath: () => '',
    _isSafeHistoryRouteSegment: value => /^[A-Za-z0-9_-]{3,80}$/.test(String(value || '')),
    _readCurrentHistoryRoute() {
      return runtime.window.HistoryRouteAdapter.parseHistoryRoute(new URL(runtime.location.href).pathname);
    },
    _isCurrentHistoryRouteForPage: () => false,
    _hasLegacyRouteSignal: () => false,
  };
  return installRouteWriter(app, runtime);
}

function createRosterBackApp(runtime, pageHistory) {
  const app = createApp(runtime);
  app._shouldDisableHistoryPathWrite = () => true;
  Object.assign(app, {
    currentPage: 'page-edu-course-lessons',
    pageHistory: [...pageHistory],
    _teamDetailId: 'teamA',
    _eduCourseLessonsContext: {
      mode: 'roster',
      teamId: 'teamA',
      planId: 'planA',
      sessionId: 'sessionA',
    },
    _isCurrentUserRestricted: () => false,
    _claimPageTransition: () => 8,
    _isPageTransitionCurrent: seq => seq === 8,
    _cleanupBeforePageSwitch: jest.fn(),
    _restoreTeamDetailV2ShellIfPresent: jest.fn(),
    _syncBottomTabForPage: jest.fn(),
    _clearTournamentDetailRouteParam: jest.fn(),
    _renderPageContent: jest.fn(),
    _resetPageScroll: jest.fn(),
  });
  installNavigationMethod(app, runtime, 'goBack', 'bindDrawer');
  return app;
}

describe('course lesson deep-link navigation contract', () => {
  const canonical = 'https://toosterx.com/teams/teamA/courses/planA/lessons/sessionA?courseTab=active';

  test('boot route reader accepts a single lesson prefix only on LINE hosts', () => {
    const miniRuntime = createRuntime(
      'https://miniapp.line.me/demo/teams/teamA/courses/planA/lessons/sessionA?courseTab=active'
    );
    const miniApp = installHistoryRouteReader({
      _getHistoryRouteFlags: () => ({ parseRead: true, usersPathEnabled: false }),
    }, miniRuntime);
    const webRuntime = createRuntime(
      'https://toosterx.com/demo/teams/teamA/courses/planA/lessons/sessionA?courseTab=active'
    );
    const webApp = installHistoryRouteReader({
      _getHistoryRouteFlags: () => ({ parseRead: true, usersPathEnabled: false }),
    }, webRuntime);

    expect(miniApp._readCurrentHistoryRoute()).toMatchObject({
      kind: 'teamDetail',
      pageId: 'page-team-detail',
      id: 'teamA',
      coursePlanId: 'planA',
      lessonId: 'sessionA',
    });
    expect(webApp._readCurrentHistoryRoute()).toBeNull();
  });

  test('detail URL writer preserves canonical and legacy roster intents until the education module consumes them', () => {
    const canonicalRuntime = createRuntime(canonical);
    const canonicalApp = createApp(canonicalRuntime);

    expect(canonicalApp._setRouteUrl({ pageId: 'page-team-detail', id: 'teamA' })).toBe(true);
    expect(canonicalRuntime.history.pushState).not.toHaveBeenCalled();
    expect(canonicalRuntime.history.replaceState).not.toHaveBeenCalled();

    const legacyRuntime = createRuntime('https://toosterx.com/teams/teamA?teamTab=courses&course=planA&courseView=roster&lesson=sessionA');
    const legacyApp = createApp(legacyRuntime);
    expect(legacyApp._setRouteUrl({ pageId: 'page-team-detail', id: 'teamA' })).toBe(true);
    expect(legacyRuntime.history.pushState).not.toHaveBeenCalled();
    expect(legacyRuntime.history.replaceState).not.toHaveBeenCalled();
  });

  test('cold direct entry fills route state without replacing the lesson URL twice', () => {
    const runtime = createRuntime(canonical);
    runtime.history.state = null;
    const app = createApp(runtime);

    expect(app._setRouteUrl({ pageId: 'page-team-detail', id: 'teamA' })).toBe(true);
    expect(runtime.history.replaceState).toHaveBeenCalledWith(
      { source: 'sportshub', pageId: 'page-team-detail', id: 'teamA' },
      '',
      '/teams/teamA/courses/planA/lessons/sessionA?courseTab=active',
    );

    runtime.history.state = { source: 'sportshub', pageId: 'page-team-detail', id: 'teamA' };
    expect(app._setRouteUrl({ pageId: 'page-team-detail', id: 'teamA' })).toBe(true);
    expect(runtime.history.replaceState).toHaveBeenCalledTimes(1);
    expect(runtime.history.pushState).not.toHaveBeenCalled();
  });

  test('explicit parent collapse works with LIFF path writes disabled and keeps its Mini App prefix', () => {
    const runtime = createRuntime(
      'https://miniapp.line.me/demo/teams/teamA/courses/planA/lessons/sessionA?courseTab=active'
    );
    const app = createApp(runtime);
    app._shouldDisableHistoryPathWrite = () => true;

    expect(app._setRouteUrl(
      { pageId: 'page-team-detail', id: 'teamA' },
      { mode: 'replace', collapseNestedRoute: true }
    )).toBe(true);
    expect(runtime.history.replaceState).toHaveBeenCalledWith(
      { source: 'sportshub', pageId: 'page-team-detail', id: 'teamA' },
      '',
      '/demo/teams/teamA',
    );
  });

  test('detail URL writer rejects extra and unsafe Mini App prefixes', () => {
    const invalidUrls = [
      'https://miniapp.line.me/a/b/teams/teamA/courses/planA/lessons/sessionA?courseTab=active',
      'https://miniapp.line.me/demo%2Fextra/teams/teamA/courses/planA/lessons/sessionA?courseTab=active',
      'https://miniapp.line.me/demo%5Cextra/teams/teamA/courses/planA/lessons/sessionA?courseTab=active',
    ];

    invalidUrls.forEach((href) => {
      const runtime = createRuntime(href);
      const app = createApp(runtime);
      const url = new URL(href);

      expect(app._shouldPreserveEduCourseLessonRouteUrl('page-team-detail', 'teamA', url)).toBe(false);
      expect(app._getEduCourseLessonParentRoutePath('teamA', url)).toBe('');
    });
  });

  test('fast detail shell keeps the lesson URL and hands the canonical intent to the roster', async () => {
    const runtime = createRuntime(canonical);
    const app = createApp(runtime);
    Object.assign(app, {
      currentPage: 'page-home',
      _teamDetailId: 'teamA',
      _eduCoursePlanTabByTeam: {},
      _pageTransitionSeq: 7,
      _getPerformanceFlag: () => true,
      _claimPageTransition: () => 7,
      _isPageTransitionCurrent: seq => seq === 7,
      _awaitRouteStep: promise => promise,
      _cleanupBeforePageSwitch: jest.fn(),
      _pushPageHistory: jest.fn(),
      _activatePage(pageId) {
        app.currentPage = pageId;
        app._activePageTransitionSeq = 7;
        return true;
      },
      _renderFastDetailShell: jest.fn(),
      showCourseLessonRoster: jest.fn(async () => ({ ok: true })),
    });
    installNavigationMethod(app, runtime, '_showDetailRouteShell', '_renderShellImage');

    const shell = await app._showDetailRouteShell('page-team-detail', 'showTeamDetail', ['teamA', {}]);
    expect(shell).toMatchObject({ ok: true, shellFirst: true, id: 'teamA' });
    expect(runtime.history.pushState).not.toHaveBeenCalled();
    expect(runtime.history.replaceState).not.toHaveBeenCalled();

    const context = {
      App: app,
      ApiService: {},
      document: { querySelectorAll: jest.fn(() => []) },
      window: runtime.window,
      setTimeout: fn => { fn(); return 0; },
      escapeHTML: value => String(value || ''),
      console,
      Promise,
      Date,
      Number,
      String,
      Set,
      Object,
      Array,
      URL,
      URLSearchParams,
    };
    vm.runInNewContext(read('js/modules/education/edu-course-plan-render.js'), context, {
      filename: 'edu-course-plan-render.js',
    });

    const intent = app._primeEduCoursePlanShareIntent('teamA', {
      skipPageHistory: true,
      suppressHashSync: true,
      _navigationTransitionSeq: 7,
    });
    expect(intent).toMatchObject({ planId: 'planA', lessonId: 'sessionA', openRoster: true });
    expect(app._setRouteUrl({ pageId: 'page-team-detail', id: 'teamA' })).toBe(true);
    expect(runtime.history.pushState).not.toHaveBeenCalled();
    expect(runtime.history.replaceState).not.toHaveBeenCalled();

    expect(app._applyEduCoursePlanShareFocus('teamA')).toBe(true);
    await new Promise(resolve => setImmediate(resolve));

    expect(app.showCourseLessonRoster).toHaveBeenCalledWith('teamA', 'planA', 'sessionA', {
      _navigationTransitionSeq: 7,
      bypassPageLock: true,
      preserveRouteUrl: true,
      skipPageHistory: true,
      suppressHashSync: true,
    });
    expect(runtime.history.replaceState).not.toHaveBeenCalled();
  });

  test.each([
    ['empty', []],
    ['stale', ['page-profile']],
  ])('header back uses the roster parent with %s page history', async (_label, pageHistory) => {
    const runtime = createRuntime(canonical + '#page-team-detail');
    const app = createRosterBackApp(runtime, pageHistory);

    await app.goBack();

    expect(runtime.history.replaceState).toHaveBeenCalledWith(
      { source: 'sportshub', pageId: 'page-team-detail', id: 'teamA' },
      '',
      '/teams/teamA',
    );
    expect(app.currentPage).toBe('page-team-detail');
  });
});
