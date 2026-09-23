const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(
  path.join(__dirname, '../../js/modules/home-game-rank-preview.js'),
  'utf8'
);
const homeShortcutSource = fs.readFileSync(
  path.join(__dirname, '../../js/modules/event/event-list-home.js'),
  'utf8'
);
const apiSource = fs.readFileSync(
  path.join(__dirname, '../../js/api-service.js'),
  'utf8'
);
const homeMarkupSource = fs.readFileSync(
  path.join(__dirname, '../../pages/home.html'),
  'utf8'
);

function loadRankPreview({ apiService = {}, users = [], auth = { currentUser: null }, lazy = false } = {}) {
  const dom = new JSDOM(`<!doctype html>
    <section id="page-home">
      <hr class="home-divider">
      <div class="home-heading"></div>
      <button class="home-game-card" id="home-game-card-shot" style="display:none"></button>
      <button id="home-game-rank-load-shot" style="display:none" aria-controls="home-game-rank-shot" aria-expanded="false">查看本月排行</button>
      <div class="home-game-rank-preview" id="home-game-rank-shot" role="region" aria-label="蓄力射門本月排行" hidden></div>
      <button class="home-game-card" id="home-game-card-kick" style="display:none"></button>
      <button id="home-game-rank-load-kick" style="display:none" aria-controls="home-game-rank-kick" aria-expanded="false">查看本月排行</button>
      <div class="home-game-rank-preview" id="home-game-rank-kick" role="region" aria-label="開球王本月排行" hidden></div>
    </section>
  `);
  const App = { currentPage: 'page-home' };
  const services = {
    getGameConfigs: () => [{ gameKey: 'shot-game' }, { gameKey: 'kick-game' }],
    isHomeGameVisible: () => true,
    ...apiService,
  };
  const context = vm.createContext({
    App,
    auth,
    ApiService: services,
    FirebaseService: { _cache: { users } },
    HOME_GAME_PRESETS: [{ gameKey: 'shot-game' }, { gameKey: 'kick-game' }],
    document: dom.window.document,
    window: dom.window,
    setTimeout,
    console,
  });
  let moduleLoaded = false;
  const loadModule = () => {
    if (moduleLoaded) return;
    vm.runInContext(source, context, { filename: 'js/modules/home-game-rank-preview.js' });
    moduleLoaded = true;
  };
  const scriptLoader = { ensureGroup: jest.fn(async group => {
    if (group !== 'homeGameRank') throw new Error('Unexpected script group');
    loadModule();
  }) };
  context.ScriptLoader = scriptLoader;
  vm.runInContext(homeShortcutSource, context, { filename: 'js/modules/event/event-list-home.js' });
  if (!lazy) loadModule();
  return { App, dom, services, scriptLoader, loadModule };
}

describe('home game rank preview', () => {
  test('actual home markup exposes each rank region outside the game navigation button', () => {
    const document = new JSDOM(homeMarkupSource).window.document;
    for (const suffix of ['shot', 'kick']) {
      const card = document.getElementById(`home-game-card-${suffix}`);
      const trigger = document.getElementById(`home-game-rank-load-${suffix}`);
      const region = document.getElementById(`home-game-rank-${suffix}`);
      expect(card).not.toBeNull();
      expect(trigger.getAttribute('aria-controls')).toBe(region.id);
      expect(region.closest('button')).toBeNull();
      expect(region.getAttribute('role')).toBe('region');
      expect(region.getAttribute('aria-label')).toContain('本月排行');
      expect(region.getAttribute('aria-live')).toBe('polite');
      expect(card.nextElementSibling).toBe(trigger);
      expect(trigger.nextElementSibling).toBe(region);
    }
  });

  test('loads the rank module only after the first button click', async () => {
    const shotQuery = jest.fn().mockResolvedValue([{ uid: 'shot-1', bestScore: 100 }]);
    const { App, dom, scriptLoader } = loadRankPreview({
      lazy: true,
      apiService: { getShotGameLeaderboard: shotQuery },
    });
    App.renderHomeGameShortcut();
    App.renderHomeGameShortcut();
    expect(App._homeGameRankPreviewSeq).toBeUndefined();
    expect(scriptLoader.ensureGroup).not.toHaveBeenCalled();
    expect(shotQuery).not.toHaveBeenCalled();

    const result = await App.loadHomeGameRankPreview('shot-game');
    expect(result.ok).toBe(true);
    expect(scriptLoader.ensureGroup).toHaveBeenCalledTimes(1);
    expect(scriptLoader.ensureGroup).toHaveBeenCalledWith('homeGameRank');
    expect(shotQuery).toHaveBeenCalledTimes(1);
    expect(dom.window.document.getElementById('home-game-rank-shot').textContent).toContain('100');
    expect(dom.window.document.getElementById('home-game-rank-shot').querySelector('[role="listitem"]')).not.toBeNull();
    expect(dom.window.document.getElementById('home-game-rank-load-shot').getAttribute('aria-expanded')).toBe('true');
  });

  test('prevents duplicate taps while the rank module downloads', async () => {
    let resolveGroup;
    const shotQuery = jest.fn().mockResolvedValue([{ uid: 'shot-1', bestScore: 100 }]);
    const { App, scriptLoader, loadModule } = loadRankPreview({
      lazy: true,
      apiService: { getShotGameLeaderboard: shotQuery },
    });
    scriptLoader.ensureGroup.mockImplementation(() => new Promise(resolve => {
      resolveGroup = () => { loadModule(); resolve(); };
    }));
    App.renderHomeGameShortcut();

    const pending = App.loadHomeGameRankPreview('shot-game');
    const preview = App._getHomeGameRankPreviewParts('shot-game').preview;
    expect(preview.hidden).toBe(false);
    expect(preview.textContent).toBe('本月排行載入中…');
    expect(preview.getAttribute('aria-busy')).toBe('true');
    expect((await App.loadHomeGameRankPreview('shot-game')).ok).toBe(false);
    expect(scriptLoader.ensureGroup).toHaveBeenCalledTimes(1);
    resolveGroup();
    expect((await pending).ok).toBe(true);
    expect(shotQuery).toHaveBeenCalledTimes(1);
  });

  test('keeps a retry button when the lazy rank script fails to load', async () => {
    const shotQuery = jest.fn().mockResolvedValue([]);
    const { App, dom, scriptLoader, loadModule } = loadRankPreview({
      lazy: true,
      apiService: { getShotGameLeaderboard: shotQuery },
    });
    scriptLoader.ensureGroup
      .mockRejectedValueOnce(new Error('script offline'))
      .mockImplementation(async () => loadModule());
    App.renderHomeGameShortcut();

    const failed = await App.loadHomeGameRankPreview('shot-game');
    const button = dom.window.document.getElementById('home-game-rank-load-shot');
    expect(failed.reason).toBe('error');
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('重試載入本月排行');
    expect(shotQuery).not.toHaveBeenCalled();

    const retried = await App.loadHomeGameRankPreview('shot-game');
    expect(retried.ok).toBe(true);
    expect(scriptLoader.ensureGroup).toHaveBeenCalledTimes(2);
    expect(shotQuery).toHaveBeenCalledTimes(1);
  });

  test('does not start a rank query after leaving home during module download', async () => {
    let resolveGroup;
    const shotQuery = jest.fn().mockResolvedValue([]);
    const { App, dom, scriptLoader, loadModule } = loadRankPreview({
      lazy: true,
      apiService: { getShotGameLeaderboard: shotQuery },
    });
    scriptLoader.ensureGroup.mockImplementation(() => new Promise(resolve => {
      resolveGroup = () => { loadModule(); resolve(); };
    }));
    App.renderHomeGameShortcut();
    const pending = App.loadHomeGameRankPreview('shot-game');
    App._cancelHomeGameRankPreview();
    App.currentPage = 'page-game';
    resolveGroup();

    expect((await pending).reason).toBe('stale');
    expect(shotQuery).not.toHaveBeenCalled();
    expect(dom.window.document.getElementById('home-game-rank-shot').hidden).toBe(true);
    expect(dom.window.document.getElementById('home-game-rank-load-shot').getAttribute('aria-expanded')).toBe('false');
  });

  test('renders current month, top four rows, avatar, nickname, and score', () => {
    const { App, dom } = loadRankPreview();
    const meta = App._getHomeGameRankMonthMeta(new Date('2026-05-06T00:00:00.000Z').getTime());
    const rows = App._normalizeHomeGameRankRows('shot-game', [
      { uid: 'u5', displayName: 'Fifth', bestScore: 100 },
      { uid: 'u1', displayName: 'First', bestScore: 500, pictureUrl: 'https://cdn.test/u1.jpg' },
      { uid: 'u2', displayName: 'Second', bestScore: 400 },
      { uid: 'u3', displayName: 'Third', bestScore: 300 },
      { uid: 'u4', displayName: 'Fourth', bestScore: 200 },
    ]);

    App._renderHomeGameRankPreview('shot-game', rows, meta);

    const preview = dom.window.document.getElementById('home-game-rank-shot');
    expect(preview.querySelector('.home-game-rank-month')?.textContent).toContain('2026');
    expect(preview.querySelector('.home-game-rank-top')?.textContent).toBe('TOP4');
    expect(Array.from(preview.querySelectorAll('.home-game-rank-name')).map(el => el.textContent))
      .toEqual(['First', 'Second', 'Third', 'Fourth']);
    expect(Array.from(preview.querySelectorAll('.home-game-rank-score')).map(el => el.textContent))
      .toEqual(['500', '400', '300', '200']);
    expect(preview.textContent).not.toContain('Fifth');
    expect(preview.querySelector('.home-game-rank-avatar')?.tagName).toBe('IMG');
    expect(preview.querySelector('[role="list"] [role="listitem"]')).not.toBeNull();
  });

  test('normalizes kick-game distance scores and ignores zero or invalid rows', () => {
    const { App } = loadRankPreview();

    const rows = App._normalizeHomeGameRankRows('kick-game', [
      { uid: 'u1', displayName: 'A', bestDistance: 88.88 },
      { uid: 'u2', displayName: 'B', distance: 120.2 },
      { uid: 'u3', displayName: 'C', score: 0 },
      { uid: 'u4', displayName: 'D', score: 'bad' },
    ]);

    expect(rows.map(row => row.displayName)).toEqual(['B', 'A']);
    expect(rows.map(row => row.scoreText)).toEqual(['120m', '88.9m']);
  });

  test('renders an empty monthly fallback without expanding into fake rank pills', () => {
    const { App, dom } = loadRankPreview();
    const meta = App._getHomeGameRankMonthMeta(new Date('2026-05-06T00:00:00.000Z').getTime());

    App._renderHomeGameRankPreview('kick-game', [], meta);

    const preview = dom.window.document.getElementById('home-game-rank-kick');
    expect(preview.querySelector('.home-game-rank-empty')?.textContent).toContain('2026');
    expect(preview.querySelectorAll('.home-game-rank-pill')).toHaveLength(0);
    expect(preview.closest('button')).toBeNull();
  });

  test('does not query either leaderboard until its separate button is selected', async () => {
    const shotQuery = jest.fn().mockResolvedValue([{ uid: 'shot-1', displayName: '射手', bestScore: 100 }]);
    const kickQuery = jest.fn().mockResolvedValue([{ uid: 'kick-1', displayName: '開球者', bestDistance: 80 }]);
    const { App, dom } = loadRankPreview({
      apiService: { getShotGameLeaderboard: shotQuery, getKickGameLeaderboard: kickQuery },
    });

    App.renderHomeGameShortcut();
    App.renderHomeGameShortcut();
    expect(shotQuery).not.toHaveBeenCalled();
    expect(kickQuery).not.toHaveBeenCalled();
    expect(dom.window.document.getElementById('home-game-rank-load-shot').style.display).toBe('');
    expect(dom.window.document.getElementById('home-game-rank-shot').hidden).toBe(true);

    const result = await App.loadHomeGameRankPreview('shot-game');
    expect(result.ok).toBe(true);
    expect(shotQuery).toHaveBeenCalledTimes(1);
    expect(shotQuery).toHaveBeenCalledWith(expect.objectContaining({
      period: 'monthly', limit: 4, throwOnError: true,
    }));
    expect(kickQuery).not.toHaveBeenCalled();
    expect(dom.window.document.getElementById('home-game-rank-shot').textContent).toContain('射手');
    expect(dom.window.document.getElementById('home-game-rank-load-shot').textContent).toBe('更新本月排行');
    App.renderHomeGameShortcut();
    expect(shotQuery).toHaveBeenCalledTimes(1);
  });

  test('keeps the two monthly rank requests independent and prevents duplicate clicks', async () => {
    let resolveShot;
    const shotQuery = jest.fn(() => new Promise(resolve => { resolveShot = resolve; }));
    const kickQuery = jest.fn().mockResolvedValue([{ uid: 'kick-1', bestDistance: 90 }]);
    const { App, dom } = loadRankPreview({
      apiService: { getShotGameLeaderboard: shotQuery, getKickGameLeaderboard: kickQuery },
    });
    App.renderHomeGameShortcut();

    const shotPending = App.loadHomeGameRankPreview('shot-game');
    expect(dom.window.document.getElementById('home-game-rank-load-shot').disabled).toBe(true);
    expect(dom.window.document.getElementById('home-game-rank-shot').textContent).toBe('本月排行載入中…');
    const duplicate = await App.loadHomeGameRankPreview('shot-game');
    expect(duplicate.ok).toBe(false);
    await App.loadHomeGameRankPreview('kick-game');
    expect(kickQuery).toHaveBeenCalledTimes(1);
    expect(shotQuery).toHaveBeenCalledTimes(1);

    resolveShot([{ uid: 'shot-1', bestScore: 120 }]);
    await shotPending;
    expect(dom.window.document.getElementById('home-game-rank-shot').textContent).toContain('120');
    expect(dom.window.document.getElementById('home-game-rank-kick').textContent).toContain('90m');
  });

  test('shows a retry control for a failed query, distinct from an empty leaderboard', async () => {
    const shotQuery = jest.fn()
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce([]);
    const { App, dom } = loadRankPreview({ apiService: { getShotGameLeaderboard: shotQuery } });
    App.renderHomeGameShortcut();

    const failed = await App.loadHomeGameRankPreview('shot-game');
    const preview = dom.window.document.getElementById('home-game-rank-shot');
    const button = dom.window.document.getElementById('home-game-rank-load-shot');
    expect(failed.reason).toBe('error');
    expect(preview.textContent).toContain('請重試');
    expect(button.textContent).toBe('重試載入本月排行');
    expect(button.disabled).toBe(false);

    const retried = await App.loadHomeGameRankPreview('shot-game');
    expect(retried.ok).toBe(true);
    expect(shotQuery).toHaveBeenCalledTimes(2);
    expect(preview.textContent).toContain('等你上榜');
    expect(preview.textContent).not.toContain('請重試');
  });

  test('discards a pending result when a game is hidden or the homepage is left', async () => {
    let resolveShot;
    let shotVisible = true;
    const shotQuery = jest.fn(() => new Promise(resolve => { resolveShot = resolve; }));
    const { App, dom } = loadRankPreview({
      apiService: {
        getShotGameLeaderboard: shotQuery,
        isHomeGameVisible: gameKey => gameKey !== 'shot-game' || shotVisible,
      },
    });
    App.renderHomeGameShortcut();
    const pending = App.loadHomeGameRankPreview('shot-game');
    shotVisible = false;
    App.renderHomeGameShortcut();
    resolveShot([{ uid: 'shot-1', bestScore: 500 }]);
    expect((await pending).reason).toBe('stale');
    expect(dom.window.document.getElementById('home-game-rank-shot').hidden).toBe(true);
    expect(dom.window.document.getElementById('home-game-rank-load-shot').style.display).toBe('none');

    shotVisible = true;
    App.renderHomeGameShortcut();
    const secondPending = App.loadHomeGameRankPreview('shot-game');
    App._cancelHomeGameRankPreview();
    App.currentPage = 'page-game';
    resolveShot([{ uid: 'shot-1', bestScore: 600 }]);
    expect((await secondPending).reason).toBe('stale');
    expect(dom.window.document.getElementById('home-game-rank-shot').hidden).toBe(true);
  });

  test('does not display a previous month if the month changes during a request', async () => {
    let resolveShot;
    let month = '2026-09';
    const shotQuery = jest.fn(() => new Promise(resolve => { resolveShot = resolve; }));
    const { App, dom } = loadRankPreview({ apiService: { getShotGameLeaderboard: shotQuery } });
    App._getHomeGameRankMonthMeta = () => ({ bucket: `monthly_${month}`, label: `${month}月榜` });
    App.renderHomeGameShortcut();

    const pending = App.loadHomeGameRankPreview('shot-game');
    month = '2026-10';
    resolveShot([{ uid: 'shot-1', bestScore: 500 }]);
    expect((await pending).reason).toBe('stale');
    expect(dom.window.document.getElementById('home-game-rank-shot').hidden).toBe(true);
    expect(dom.window.document.getElementById('home-game-rank-load-shot').disabled).toBe(false);
  });

  test('does not apply a result from the previous login session', async () => {
    let resolveShot;
    const auth = { currentUser: { uid: 'user-a' } };
    const shotQuery = jest.fn(() => new Promise(resolve => { resolveShot = resolve; }));
    const { App, dom } = loadRankPreview({
      auth,
      apiService: { getShotGameLeaderboard: shotQuery },
    });
    App.renderHomeGameShortcut();

    const pending = App.loadHomeGameRankPreview('shot-game');
    auth.currentUser = null;
    resolveShot([{ uid: 'shot-1', bestScore: 500 }]);
    expect((await pending).reason).toBe('stale');
    expect(dom.window.document.getElementById('home-game-rank-shot').hidden).toBe(true);
    expect(dom.window.document.getElementById('home-game-rank-load-shot').disabled).toBe(false);
  });

  test('preserves the leaderboard API default empty-on-error contract, with opt-in rejection', async () => {
    const read = jest.fn().mockRejectedValue(new Error('offline'));
    const db = {
      collection: () => ({
        doc: () => ({
          collection: () => ({
            orderBy: () => ({ limit: () => ({ get: read }) }),
          }),
        }),
      }),
    };
    const context = vm.createContext({ db, console: { warn: jest.fn() } });
    vm.runInContext(`${apiSource}\nthis.ApiService = ApiService;`, context);

    await expect(context.ApiService.getShotGameLeaderboard({ bucket: 'monthly_test' })).resolves.toEqual([]);
    await expect(context.ApiService.getShotGameLeaderboard({ bucket: 'monthly_test', throwOnError: true }))
      .rejects.toThrow('offline');
    await expect(context.ApiService.getKickGameLeaderboard({ bucket: 'monthly_test' })).resolves.toEqual([]);
    await expect(context.ApiService.getKickGameLeaderboard({ bucket: 'monthly_test', throwOnError: true }))
      .rejects.toThrow('offline');
    expect(read).toHaveBeenCalledTimes(4);
  });

  test('keeps both leaderboard APIs cached after a successful read', async () => {
    const shotRead = jest.fn().mockResolvedValue({ docs: [{ id: 's1', data: () => ({ bestScore: 30 }) }] });
    const kickRead = jest.fn().mockResolvedValue({ docs: [{ id: 'k1', data: () => ({ bestDistance: 40 }) }] });
    const db = {
      collection: name => ({
        doc: () => ({
          collection: () => ({
            orderBy: () => ({ limit: () => ({ get: name === 'shotGameRankings' ? shotRead : kickRead }) }),
          }),
        }),
      }),
    };
    const context = vm.createContext({ db, console: { warn: jest.fn() } });
    vm.runInContext(`${apiSource}\nthis.ApiService = ApiService;`, context);

    const shotFirst = await context.ApiService.getShotGameLeaderboard({ bucket: 'monthly_test', limit: 4 });
    const shotCached = await context.ApiService.getShotGameLeaderboard({ bucket: 'monthly_test', limit: 4, throwOnError: true });
    const kickFirst = await context.ApiService.getKickGameLeaderboard({ bucket: 'monthly_test', limit: 4 });
    const kickCached = await context.ApiService.getKickGameLeaderboard({ bucket: 'monthly_test', limit: 4, throwOnError: true });
    expect(shotFirst).toEqual(shotCached);
    expect(kickFirst).toEqual(kickCached);
    expect(shotRead).toHaveBeenCalledTimes(1);
    expect(kickRead).toHaveBeenCalledTimes(1);
  });
});
