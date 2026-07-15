const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '../..');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function loadTeamCardModule(showTeamDetail) {
  const dom = new JSDOM(
    '<!doctype html><body><div id="team-list">'
      + '<div class="tc-card" data-team-id="teamA">'
      + '<div class="tc-card-media"></div></div></div></body>',
    { url: 'https://toosterx.test/teams' }
  );
  const App = {
    showTeamDetail,
    showToast: jest.fn(),
    currentPage: 'page-teams',
    _pageTransitionSeq: 4,
    _activePageTransitionSeq: 4,
  };
  const testConsole = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const context = vm.createContext({
    window: dom.window,
    document: dom.window.document,
    App,
    ApiService: {},
    I18N: { t: key => key },
    escapeHTML: value => String(value == null ? '' : value),
    console: testConsole,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Date,
    Promise,
    Array,
  });
  context.globalThis = context;
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'js/modules/team/team-list-render.js'), 'utf8'),
    context,
    { filename: 'team-list-render.js' }
  );
  return {
    App,
    card: dom.window.document.querySelector('.tc-card'),
    container: dom.window.document.getElementById('team-list'),
    testConsole,
  };
}

describe('team card navigation feedback', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('a hung route shows delayed feedback and duplicate clicks share one flight', async () => {
    jest.useFakeTimers();
    let resolveRoute;
    const routePromise = new Promise(resolve => { resolveRoute = resolve; });
    const showTeamDetail = jest.fn(() => routePromise);
    const { App, card } = loadTeamCardModule(showTeamDetail);

    const first = App.openTeamDetailFromCard(card, 'teamA');
    await jest.advanceTimersByTimeAsync(149);
    expect(card.classList.contains('is-pending')).toBe(false);

    await jest.advanceTimersByTimeAsync(1);
    expect(card.classList.contains('is-pending')).toBe(true);
    expect(card.getAttribute('aria-busy')).toBe('true');
    expect(card.querySelector('.tc-loading-panel')).not.toBeNull();

    const second = App.openTeamDetailFromCard(card, 'teamA');
    expect(showTeamDetail).toHaveBeenCalledTimes(1);
    resolveRoute({ ok: true });

    await expect(first).resolves.toEqual({ ok: true });
    await expect(second).resolves.toEqual({ ok: true });
    expect(card.classList.contains('is-pending')).toBe(false);
    expect(card.hasAttribute('aria-busy')).toBe(false);
    expect(card.querySelector('.tc-loading-panel')).toBeNull();
    expect(App._teamCardOpenFlight).toBeNull();
  });

  test('route rejection shows a retryable toast and removes every functional lock', async () => {
    jest.useFakeTimers();
    const failure = new Error('route failed');
    const { App, card, testConsole } = loadTeamCardModule(jest.fn(() => Promise.reject(failure)));

    const opening = App.openTeamDetailFromCard(card, 'teamA');
    await expect(opening).resolves.toMatchObject({
      ok: false,
      reason: 'route-error',
      error: failure,
    });

    expect(App.showToast).toHaveBeenCalledWith('俱樂部頁面載入失敗，請稍後再試');
    expect(testConsole.error).toHaveBeenCalledWith(
      '[TeamCard] detail navigation failed:',
      failure,
    );
    expect(card.classList.contains('is-pending')).toBe(false);
    expect(card.hasAttribute('aria-busy')).toBe(false);
    expect(card.hasAttribute('data-team-loading-token')).toBe(false);
    expect(card.querySelector('.tc-loading-bar')).toBeNull();
    expect(card.querySelector('.tc-loading-panel')).toBeNull();
    expect(App._teamCardLoadingState).toBeNull();
    expect(App._teamCardOpenFlight).toBeNull();
  });

  test('leaving and returning detaches a stale same-team flight without letting its finally clear the retry', async () => {
    jest.useFakeTimers();
    const oldRoute = deferred();
    const newRoute = deferred();
    const showTeamDetail = jest.fn()
      .mockImplementationOnce(() => oldRoute.promise)
      .mockImplementationOnce(() => newRoute.promise);
    const { App, card } = loadTeamCardModule(showTeamDetail);

    const oldOpening = App.openTeamDetailFromCard(card, 'teamA');
    await Promise.resolve();
    expect(showTeamDetail).toHaveBeenCalledTimes(1);
    const oldToken = App._teamCardOpenFlight.token;

    expect(App._invalidateTeamCardOpenFlight('leave-team-list')).toBe(true);
    const newOpening = App.openTeamDetailFromCard(card, 'teamA');
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(150);

    expect(showTeamDetail).toHaveBeenCalledTimes(2);
    const newFlight = App._teamCardOpenFlight;
    expect(newFlight.token).not.toBe(oldToken);
    expect(card.dataset.teamLoadingToken).toBe(String(newFlight.token));
    expect(card.classList.contains('is-pending')).toBe(true);

    oldRoute.resolve({ ok: false, reason: 'stale_transition' });
    await expect(oldOpening).resolves.toMatchObject({ reason: 'stale_transition' });
    expect(App._teamCardOpenFlight).toBe(newFlight);
    expect(card.dataset.teamLoadingToken).toBe(String(newFlight.token));
    expect(card.classList.contains('is-pending')).toBe(true);

    newRoute.resolve({ ok: true });
    await expect(newOpening).resolves.toEqual({ ok: true });
    expect(App._teamCardOpenFlight).toBeNull();
    expect(card.classList.contains('is-pending')).toBe(false);
    expect(card.hasAttribute('aria-busy')).toBe(false);
  });

  test('a newer navigation transition prevents stale same-team single-flight reuse', async () => {
    const oldRoute = deferred();
    const newRoute = deferred();
    const showTeamDetail = jest.fn()
      .mockImplementationOnce(() => oldRoute.promise)
      .mockImplementationOnce(() => newRoute.promise);
    const { App, card } = loadTeamCardModule(showTeamDetail);

    const oldOpening = App.openTeamDetailFromCard(card, 'teamA');
    await Promise.resolve();
    App._pageTransitionSeq = 5;
    const newOpening = App.openTeamDetailFromCard(card, 'teamA');
    await Promise.resolve();

    expect(showTeamDetail).toHaveBeenCalledTimes(2);
    oldRoute.resolve({ ok: false, reason: 'stale_transition' });
    newRoute.resolve({ ok: true });
    await expect(oldOpening).resolves.toMatchObject({ reason: 'stale_transition' });
    await expect(newOpening).resolves.toEqual({ ok: true });
  });

  test('an old token cannot clear a newer click on the same card', () => {
    jest.useFakeTimers();
    const { App, card } = loadTeamCardModule(jest.fn());

    App._markTeamCardPending(card, 'teamA', { token: 1, immediate: true });
    App._markTeamCardPending(card, 'teamA', { token: 2, immediate: true });

    expect(App._clearTeamCardPending(card, 1)).toBe(false);
    expect(card.dataset.teamLoadingToken).toBe('2');
    expect(card.classList.contains('is-pending')).toBe(true);

    expect(App._clearTeamCardPending(card, 2)).toBe(true);
    expect(card.classList.contains('is-pending')).toBe(false);
  });

  test('list reuse cleanup removes stale bfcache feedback immediately', () => {
    jest.useFakeTimers();
    const { App, card, container } = loadTeamCardModule(jest.fn());
    App._markTeamCardPending(card, 'teamA', { token: 1, immediate: true });

    App._clearTeamCardPendings(container);

    expect(card.classList.contains('is-pending')).toBe(false);
    expect(card.hasAttribute('aria-busy')).toBe(false);
    expect(card.querySelector('.tc-loading-panel')).toBeNull();
    expect(App._teamCardLoadingState).toBeNull();
  });
});
