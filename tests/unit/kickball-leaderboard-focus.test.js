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
    LEADERBOARD_PERIOD_LABELS: { daily: 'Daily' },
    LEADERBOARD_TOP_SIZE: 10,
    getTaipeiDateBucket: () => 'daily_2026-04-30',
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
});
