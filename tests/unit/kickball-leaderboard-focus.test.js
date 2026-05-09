const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..', '..');

function createFirebaseStub() {
  const get = jest.fn(() => Promise.resolve({ docs: [] }));
  return {
    firestore: () => ({
      collection: () => ({
        doc: () => ({
          collection: () => ({
            orderBy: () => ({
              limit: () => ({ get }),
            }),
          }),
        }),
      }),
    }),
  };
}

function createHelpersStub() {
  return {
    LEADERBOARD_PERIOD_LABELS: { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' },
    LEADERBOARD_TOP_SIZE: 10,
    getTaipeiDateBucket: period => `${period || 'daily'}_bucket`,
    normalizeRow: () => ({}),
    isAnonymousRow: () => false,
    dedupeRows: rows => rows,
    getCurrentAuthUid: () => '',
    compareRows: () => 0,
    formatDuration: () => '00:00',
  };
}

function createDom() {
  return new JSDOM(`<!doctype html>
    <main id="page-kick-game">
      <button id="kg-leaderboard-btn-inner" class="kg-lb-btn" type="button">Open</button>
      <div id="kick-game-container"></div>
      <div id="kg-leaderboard-modal" class="kg-lb-overlay" aria-hidden="true">
        <section class="kg-lb-dialog" role="dialog" aria-modal="true" aria-labelledby="kg-leaderboard-title">
          <button id="kg-leaderboard-close" class="kg-lb-close-btn" type="button">Close</button>
          <p id="kg-leaderboard-range"></p>
          <button type="button" class="kg-lb-tab is-active" data-lb-period="daily" role="tab" aria-selected="true">Daily</button>
          <button type="button" class="kg-lb-tab" data-lb-period="monthly" role="tab" aria-selected="false">Monthly</button>
          <div id="kg-lb-prev-month-row" class="kg-lb-prev-month-row" style="display:none">
            <button id="kg-lb-prev-month-btn" type="button" class="kg-lb-prev-month-btn">&#8592; 上月回顧</button>
          </div>
          <table><tbody id="kg-leaderboard-body"></tbody></table>
          <div id="kg-leaderboard-player-row" class="kg-lb-player-row is-hidden"></div>
        </section>
      </div>
    </main>`);
}

function loadLeaderboard(document) {
  const sandbox = {
    window: { _KickballHelpers: createHelpersStub() },
    document,
    console,
    firebase: createFirebaseStub(),
  };
  const code = fs.readFileSync(path.join(ROOT, 'js/modules/kickball/kickball-leaderboard.js'), 'utf8');
  vm.runInNewContext(code, sandbox, { filename: 'js/modules/kickball/kickball-leaderboard.js' });
  return sandbox.window._KickballLeaderboard;
}

describe('kickball leaderboard focus management', () => {
  test('source exposes previous month review assets for monthly leaderboard', () => {
    const page = fs.readFileSync(path.join(ROOT, 'pages/kickball.html'), 'utf8');
    const css = fs.readFileSync(path.join(ROOT, 'css/game.css'), 'utf8');
    const helperSource = fs.readFileSync(path.join(ROOT, 'js/modules/kickball/kickball-helpers.js'), 'utf8');
    const pageSource = fs.readFileSync(path.join(ROOT, 'js/modules/kickball/kickball-game-page.js'), 'utf8');

    expect(page).toContain('id="kg-lb-prev-month-row"');
    expect(page).toContain('id="kg-lb-prev-month-btn"');
    expect(css).toContain('#page-kick-game .kg-lb-prev-month-btn');
    expect(helperSource).toContain("period === 'monthly-prev'");
    expect(pageSource).toContain("LB.lbShowingPrevMonth ? 'monthly' : 'monthly-prev'");
  });

  test('restores focus outside modal before hiding leaderboard', async () => {
    const dom = createDom();
    const document = dom.window.document;
    const leaderboard = loadLeaderboard(document);
    const opener = document.getElementById('kg-leaderboard-btn-inner');
    const close = document.getElementById('kg-leaderboard-close');
    const modal = document.getElementById('kg-leaderboard-modal');

    opener.focus();
    expect(document.activeElement).toBe(opener);

    leaderboard.openLeaderboard('daily');
    expect(modal.getAttribute('aria-hidden')).toBe('false');
    expect(document.activeElement).toBe(close);

    leaderboard.closeLeaderboard();
    expect(modal.getAttribute('aria-hidden')).toBe('true');
    expect(modal.contains(document.activeElement)).toBe(false);
    expect(document.activeElement).toBe(opener);

    await Promise.resolve();
  });

  test('monthly leaderboard can toggle previous month review', async () => {
    const dom = createDom();
    const document = dom.window.document;
    const leaderboard = loadLeaderboard(document);
    const row = document.getElementById('kg-lb-prev-month-row');
    const btn = document.getElementById('kg-lb-prev-month-btn');
    const range = document.getElementById('kg-leaderboard-range');
    const monthlyTab = document.querySelector('[data-lb-period="monthly"]');

    leaderboard.renderLeaderboard('monthly');
    expect(row.style.display).toBe('');
    expect(btn.textContent).toBe('\u2190 \u4E0A\u6708\u56DE\u9867');
    expect(monthlyTab.classList.contains('is-active')).toBe(true);
    expect(leaderboard.lbShowingPrevMonth).toBe(false);

    leaderboard.renderLeaderboard('monthly-prev');
    expect(row.style.display).toBe('');
    expect(btn.textContent).toBe('\u56DE\u5230\u672C\u6708');
    expect(range.textContent).toContain('\u4E0A\u6708\u6392\u884C\u524D 10 \u540D');
    expect(monthlyTab.classList.contains('is-active')).toBe(true);
    expect(leaderboard.lbShowingPrevMonth).toBe(true);

    leaderboard.renderLeaderboard('daily');
    expect(row.style.display).toBe('none');
    expect(leaderboard.lbShowingPrevMonth).toBe(false);

    await Promise.resolve();
  });
});
