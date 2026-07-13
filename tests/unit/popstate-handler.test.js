/**
 * @jest-environment jsdom
 *
 * Phase 6 contract tests for popstate handler + helpers.
 * Covers D6, D10-D14, plus Codex 第十五輪/十六輪 cross-helper consistency.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

// 載入 HistoryRouteAdapter 到 window(它是 IIFE,自動掛 window.HistoryRouteAdapter)
require(path.join(ROOT, 'js', 'core', 'history-route-adapter.js'));

function extractAppMethods(source, names) {
  const out = {};
  for (const name of names) {
    const reSimple = new RegExp(`(?:^|\\n)  ${name}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n  \\},`);
    const reField = new RegExp(`(?:^|\\n)  ${name}:\\s*[^,\\n]+,`);
    const m = source.match(reSimple) || source.match(reField);
    if (!m) throw new Error(`Could not extract Phase 6 helper: ${name}`);
    out[name] = m[0].trim().replace(/,$/, '');
  }
  return out;
}

function installApp(stubs = {}) {
  const appSource = readProjectFile('app.js');
  const methodNames = [
    '_popstateRequestSeq',
    '_bootSentinelPushed',
    '_validatePageId',
    '_parseLegacyQueryRoute',
    '_resolveRouteIntent',
    '_buildCurrentRouteState',
    '_shouldInstallSentinel',
    '_maybePushBootSentinel',
  ];
  const extracted = extractAppMethods(appSource, methodNames);
  // 把抽出的成員以 string 形式組合進 Object.assign,讓 Jest 拿到真正 app.js 邏輯
  const body = `
    Object.assign(App, {
      ${extracted._popstateRequestSeq},
      ${extracted._bootSentinelPushed},
      ${extracted._validatePageId},
      ${extracted._parseLegacyQueryRoute},
      ${extracted._resolveRouteIntent},
      ${extracted._buildCurrentRouteState},
      ${extracted._shouldInstallSentinel},
      ${extracted._maybePushBootSentinel},
    });
    return App;
  `;
  const App = {
    _isSafeHistoryRouteSegment(id) {
      const value = String(id || '').trim();
      if (!value || value === '.' || value === '..') return false;
      if (value.indexOf('/') !== -1 || value.indexOf('\\') !== -1) return false;
      return /^[A-Za-z0-9_-]{3,80}$/.test(value);
    },
    _getHistoryRouteFlags: stubs._getHistoryRouteFlags || (() => ({
      popstateTakeover: true,
      liffPathDisable: true,
      usersPathEnabled: false,
    })),
  };
  // eslint-disable-next-line no-new-func
  const factory = new Function('App', 'window', 'history', 'document', 'PageLoader', body);
  return factory(App, window, window.history, document, stubs.PageLoader);
}

function setupDom() {
  document.body.innerHTML = `
    <div id="page-home" class="page"></div>
    <div id="page-activities" class="page"></div>
    <div id="page-teams" class="page"></div>
    <div id="page-tournaments" class="page"></div>
    <div id="page-activity-detail" class="page"></div>
    <div id="page-team-detail" class="page"></div>
    <div id="page-tournament-detail" class="page"></div>
  `;
}

function setLocation(pathname, search = '', hash = '') {
  window.history.replaceState(null, '', pathname + search + hash);
}

beforeEach(() => {
  setupDom();
  setLocation('/');
});

describe('Phase 6 — _validatePageId (D13)', () => {
  test('returns null for empty / unknown ids', () => {
    const App = installApp();
    expect(App._validatePageId('')).toBeNull();
    expect(App._validatePageId(null)).toBeNull();
    expect(App._validatePageId('unknown-page')).toBeNull();
    expect(App._validatePageId('section')).toBeNull();
  });

  test('returns pageId when SPA page element exists', () => {
    const App = installApp();
    expect(App._validatePageId('page-activity-detail')).toBe('page-activity-detail');
    expect(App._validatePageId('page-home')).toBe('page-home');
  });

  test('returns pageId when PageLoader registers it', () => {
    const stubs = { PageLoader: { _pageFileMap: { 'page-admin-foo': 'pages/admin-foo.html' } } };
    const App = installApp(stubs);
    expect(App._validatePageId('page-admin-foo')).toBe('page-admin-foo');
  });
});

describe('Phase 6 — _parseLegacyQueryRoute (D13 第十四輪)', () => {
  test('parses ?event= / ?team= / ?tournament= / ?profile=', () => {
    const App = installApp();
    expect(App._parseLegacyQueryRoute('?event=ce_1777808740886_abcdef'))
      .toEqual({ pageId: 'page-activity-detail', id: 'ce_1777808740886_abcdef' });
    expect(App._parseLegacyQueryRoute('?team=tm_test_123'))
      .toEqual({ pageId: 'page-team-detail', id: 'tm_test_123' });
    expect(App._parseLegacyQueryRoute('?tournament=ct_test_456'))
      .toEqual({ pageId: 'page-tournament-detail', id: 'ct_test_456' });
    expect(App._parseLegacyQueryRoute('?profile=Uabcdef0123456789abcdef0123456789'))
      .toEqual({ pageId: 'page-user-card', id: 'Uabcdef0123456789abcdef0123456789' });
  });

  test('rejects unsafe ids', () => {
    const App = installApp();
    expect(App._parseLegacyQueryRoute('?event=../etc')).toBeNull();
    expect(App._parseLegacyQueryRoute('?event=a/b')).toBeNull();
    expect(App._parseLegacyQueryRoute('?event=ab')).toBeNull();    // 太短
    expect(App._parseLegacyQueryRoute('?event=')).toBeNull();
  });

  test('event > team > tournament > profile 優先順序(§5.1)', () => {
    const App = installApp();
    const r = App._parseLegacyQueryRoute('?event=ce_a&team=tm_b');
    expect(r.pageId).toBe('page-activity-detail');
    expect(r.id).toBe('ce_a');
  });

  test('return null when no legacy query', () => {
    const App = installApp();
    expect(App._parseLegacyQueryRoute('')).toBeNull();
    expect(App._parseLegacyQueryRoute('?rid=abc')).toBeNull();
  });
});

describe('Phase 6 — _resolveRouteIntent (Codex 第十五輪 共用 helper)', () => {
  test('state 優先(source guard 通過且非 sentinel)', () => {
    const App = installApp();
    const r = App._resolveRouteIntent({
      state: { source: 'sportshub', pageId: 'page-activity-detail', id: 'ce_x' },
    });
    expect(r).toEqual({ pageId: 'page-activity-detail', id: 'ce_x' });
  });

  test('sentinel state 不被當成 page intent', () => {
    const App = installApp();
    setLocation('/', '?event=ce_legacy');
    const r = App._resolveRouteIntent({
      state: { source: 'sportshub', sentinel: true, fallbackPageId: 'page-home' },
    });
    // sentinel 不算 page state → 走 fallback chain → 解到 legacy query
    expect(r.pageId).toBe('page-activity-detail');
    expect(r.id).toBe('ce_legacy');
  });

  test('legacy query 優先於 clean path(§5.1 一致)', () => {
    const App = installApp();
    setLocation('/events/ce_a', '?event=ce_b');
    const r = App._resolveRouteIntent({ state: null });
    expect(r.pageId).toBe('page-activity-detail');
    expect(r.id).toBe('ce_b'); // §5.1 legacy 先於 clean path
  });

  test('clean path:state=null + URL=/events/ce_test', () => {
    const App = installApp();
    setLocation('/events/ce_test_123');
    const r = App._resolveRouteIntent({ state: null });
    expect(r.pageId).toBe('page-activity-detail');
    expect(r.id).toBe('ce_test_123');
  });

  test('Mini App prefixed lesson path resolves only on an approved LINE host', () => {
    const App = installApp();
    const path = '/demo/teams/teamA/courses/planA/lessons/sessionA';
    const miniAppResult = App._resolveRouteIntent({
      state: null,
      loc: new URL('https://miniapp.line.me' + path),
    });
    const webResult = App._resolveRouteIntent({
      state: null,
      loc: new URL('https://toosterx.com' + path),
    });

    expect(miniAppResult).toEqual({ pageId: 'page-team-detail', id: 'teamA' });
    expect(webResult).toEqual({ pageId: 'page-home', id: null });
  });

  test('hash fallback:state=null + URL=/#page-teams', () => {
    const App = installApp();
    setLocation('/', '', '#page-teams');
    const r = App._resolveRouteIntent({ state: null });
    expect(r.pageId).toBe('page-teams');
    expect(r.id).toBeNull();
  });

  test('未驗證的 hash 不被誤判為 pageId(避免 #section 錨點)', () => {
    const App = installApp();
    setLocation('/', '', '#section');
    const r = App._resolveRouteIntent({ state: null });
    expect(r.pageId).toBe('page-home');
  });

  test('source 非 sportshub 時不信任 state(source guard)', () => {
    const App = installApp();
    setLocation('/events/ce_real');
    const r = App._resolveRouteIntent({
      state: { source: 'third-party-lib', pageId: 'page-fake' },
    });
    expect(r.pageId).toBe('page-activity-detail');
    expect(r.id).toBe('ce_real');
  });

  test('skipState=true 跳過 state 那層', () => {
    const App = installApp();
    setLocation('/events/ce_url');
    const r = App._resolveRouteIntent({
      state: { source: 'sportshub', pageId: 'page-teams', id: null },
      skipState: true,
    });
    expect(r.pageId).toBe('page-activity-detail');
    expect(r.id).toBe('ce_url');
  });

  test('終極 fallback 是 page-home', () => {
    const App = installApp();
    setLocation('/', '', '');
    const r = App._resolveRouteIntent({ state: null });
    expect(r).toEqual({ pageId: 'page-home', id: null });
  });
});

describe('Phase 6 — _buildCurrentRouteState (D11)', () => {
  test('LIFF /?event=abc state=null 場景能還原 detail id(Codex 第十五輪驗收)', () => {
    const App = installApp();
    setLocation('/', '?event=ce_test_123', '#page-activity-detail');
    window.history.replaceState(null, '', window.location.href);
    const r = App._buildCurrentRouteState();
    expect(r).toMatchObject({
      source: 'sportshub',
      pageId: 'page-activity-detail',
      id: 'ce_test_123',
    });
  });

  test('clean path /events/ce_test 也能還原 id', () => {
    const App = installApp();
    setLocation('/events/ce_clean_path');
    window.history.replaceState(null, '', window.location.href);
    const r = App._buildCurrentRouteState();
    expect(r).toMatchObject({
      source: 'sportshub',
      pageId: 'page-activity-detail',
      id: 'ce_clean_path',
    });
  });

  test('已有 sportshub state(非 sentinel)直接沿用', () => {
    const App = installApp();
    window.history.replaceState(
      { source: 'sportshub', pageId: 'page-team-detail', id: 'tm_xyz' },
      ''
    );
    const r = App._buildCurrentRouteState();
    expect(r).toEqual({ source: 'sportshub', pageId: 'page-team-detail', id: 'tm_xyz' });
  });

  test('sentinel state 不沿用,改 fallback chain', () => {
    const App = installApp();
    setLocation('/events/ce_under_sentinel');
    window.history.replaceState(
      { source: 'sportshub', sentinel: true, fallbackPageId: 'page-home' },
      ''
    );
    const r = App._buildCurrentRouteState();
    // sentinel 不算 page state,fallback 抓 clean path
    expect(r.pageId).toBe('page-activity-detail');
    expect(r.id).toBe('ce_under_sentinel');
  });
});

describe('Phase 6 — _shouldInstallSentinel (D11 觸發條件)', () => {
  afterEach(() => {
    delete window.liff;
  });

  test('不在 LIFF / PWA 時 return false(一般瀏覽器尊重原生返回)', () => {
    const App = installApp();
    expect(App._shouldInstallSentinel()).toBe(false);
  });

  test('LIFF in client 時 return true', () => {
    window.liff = { isInClient: () => true };
    const App = installApp();
    expect(App._shouldInstallSentinel()).toBe(true);
  });

  test('PWA standalone 時 return true', () => {
    const App = installApp();
    const origMatch = window.matchMedia;
    window.matchMedia = (q) => ({ matches: q === '(display-mode: standalone)' });
    try {
      expect(App._shouldInstallSentinel()).toBe(true);
    } finally {
      window.matchMedia = origMatch;
    }
  });
});

describe('Phase 6 — _maybePushBootSentinel (D11 雙寫策略)', () => {
  afterEach(() => {
    delete window.liff;
  });

  test('非 LIFF / PWA 環境不安裝 sentinel', () => {
    const App = installApp();
    setLocation('/events/ce_x');
    const beforeLength = window.history.length;
    App._maybePushBootSentinel();
    expect(App._bootSentinelPushed).toBe(false);
    expect(window.history.length).toBe(beforeLength);
  });

  test('LIFF 環境執行雙寫:E0 變 sentinel + E1 帶當前 page state', () => {
    window.liff = { isInClient: () => true };
    const App = installApp();
    setLocation('/events/ce_first_visit');
    window.history.replaceState(null, '', window.location.href);

    App._maybePushBootSentinel();

    expect(App._bootSentinelPushed).toBe(true);
    // 此時 active entry(E1)應該是當前頁 state,URL 是原 URL
    expect(window.history.state).toMatchObject({
      source: 'sportshub',
      pageId: 'page-activity-detail',
      id: 'ce_first_visit',
    });
    expect(window.location.pathname).toBe('/events/ce_first_visit');
  });

  test('popstateTakeover=false 時不安裝', () => {
    window.liff = { isInClient: () => true };
    const App = installApp({
      _getHistoryRouteFlags: () => ({ popstateTakeover: false }),
    });
    setLocation('/events/ce_x');
    App._maybePushBootSentinel();
    expect(App._bootSentinelPushed).toBe(false);
  });

  test('連續呼叫只裝一次(防重複 push)', () => {
    window.liff = { isInClient: () => true };
    const App = installApp();
    setLocation('/events/ce_x');
    App._maybePushBootSentinel();
    const lenAfterFirst = window.history.length;
    App._maybePushBootSentinel();
    expect(window.history.length).toBe(lenAfterFirst);
  });
});

describe('Phase 6 — popstate handler source-level contract', () => {
  test('app.js popstate handler 帶 4 個必要 option,sentinel + fallback branch 對齊', () => {
    const appSource = readProjectFile('app.js');
    // popstate handler 內 sentinel branch 必含 skipPageHistory + suppressHashSync(Codex 第十六輪)
    const handlerMatch = appSource.match(
      /addEventListener\('popstate'[\s\S]+?if \(stateValid && event\.state\.sentinel === true\)[\s\S]+?await App\.showPage\(fallback,\s*\{[\s\S]+?\}\);/
    );
    expect(handlerMatch).toBeTruthy();
    expect(handlerMatch[0]).toMatch(/bypassPageLock:\s*true/);
    expect(handlerMatch[0]).toMatch(/skipPageHistory:\s*true/);
    expect(handlerMatch[0]).toMatch(/suppressHashSync:\s*true/);

    // popstate handler 內 detail / list / home 分支必含 skipPageHistory + suppressHashSync
    expect(appSource).toMatch(/showEventDetail\(targetId,\s*detailOptions\)/);
    expect(appSource).toMatch(/showTeamDetail\(targetId,\s*detailOptions\)/);
    expect(appSource).toMatch(/showTournamentDetail\(targetId,\s*detailOptions\)/);
    expect(appSource).toMatch(/targetPageId === 'page-user-card' && targetId/);
    expect(appSource).toMatch(/showUserProfile\?\.\(targetName,\s*\{\s*\.\.\.detailOptions,\s*uid:\s*targetId\s*\}\)/);
  });

  test('runtime source does not write null History API state', () => {
    const runtimeFiles = [
      'app.js',
      'index.html',
      'js/core/navigation.js',
      'js/modules/shot-game/shot-game-lab-page.js',
    ];

    for (const file of runtimeFiles) {
      const source = readProjectFile(file);
      expect(source).not.toMatch(/history\.(?:replaceState|pushState)\(null/);
    }
  });

  test('hashchange listener 開頭含 _suppressNextHashchange 攔截 (D10)', () => {
    const appSource = readProjectFile('app.js');
    expect(appSource).toMatch(
      /addEventListener\('hashchange'[\s\S]+?if \(window\._suppressNextHashchange\)/
    );
  });

  test('_pushPageHistory 支援 skipPageHistory option (Commit A-2)', () => {
    const navSource = readProjectFile('js/core/navigation.js');
    expect(navSource).toMatch(/_pushPageHistory[\s\S]+?if \(options\.skipPageHistory\) return/);
  });

  test('goBack 用 replace 模式 (Commit A-1)', () => {
    const navSource = readProjectFile('js/core/navigation.js');
    expect(navSource).toMatch(/const routeTarget = returningToTeamDetail[\s\S]*?\? \{ pageId: prev, id: this\._teamDetailId \}[\s\S]*?: prev/);
    expect(navSource).toMatch(/this\._setRouteUrl\(routeTarget,\s*\{\s*mode:\s*'replace',\s*collapseNestedRoute:\s*returningToTeamDetail,/);
  });

  test('_setRouteUrl hash fallback 帶完整 state (Commit A-3)', () => {
    const appSource = readProjectFile('app.js');
    expect(appSource).toMatch(/stateForHashWrite = detailId\s*\?\s*\{\s*source:\s*'sportshub'/);
  });

  test('_syncTournamentDetailRoute fallback 帶完整 state (Commit A-3)', () => {
    const appSource = readProjectFile('app.js');
    expect(appSource).toMatch(
      /_syncTournamentDetailRoute[\s\S]+?const state = \{ source: 'sportshub', pageId: 'page-tournament-detail', id \}/
    );
  });

  test('history-route-flags.js popstateTakeover=true (Commit C)', () => {
    const flagsSource = readProjectFile('js/core/history-route-flags.js');
    expect(flagsSource).toMatch(/popstateTakeover:\s*true/);
  });

  test('detail handler 透傳 bypassPageLock + skipPageHistory (Commit A-2)', () => {
    const eventDetail = readProjectFile('js/modules/event/event-detail.js');
    const teamDetail = readProjectFile('js/modules/team/team-detail.js');
    const tournamentDetail = readProjectFile('js/modules/tournament/tournament-detail.js');
    const friendlyTournament = readProjectFile('js/modules/tournament/tournament-friendly-detail.js');

    for (const src of [eventDetail, teamDetail, tournamentDetail, friendlyTournament]) {
      expect(src).toMatch(/bypassPageLock:\s*options\?\.bypassPageLock/);
      expect(src).toMatch(/skipPageHistory:\s*options\?\.skipPageHistory/);
    }
  });
});

describe('Phase 6 — sentinel 不污染 App.pageHistory (Codex 第十六輪)', () => {
  test('source-level:popstate handler sentinel branch 帶 skipPageHistory: true', () => {
    const appSource = readProjectFile('app.js');
    // Find sentinel branch + assert showPage 帶 skipPageHistory
    const sentinelBranch = appSource.match(
      /if \(stateValid && event\.state\.sentinel === true\)[\s\S]+?await App\.showPage\(fallback,\s*\{[\s\S]+?\}\)/
    );
    expect(sentinelBranch).toBeTruthy();
    expect(sentinelBranch[0]).toMatch(/skipPageHistory:\s*true/);
  });
});
