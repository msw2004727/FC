const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(
  path.join(__dirname, '../../js/modules/home-game-rank-preview.js'),
  'utf8'
);

function loadRankPreview({ apiService = {}, users = [] } = {}) {
  const dom = new JSDOM(`<!doctype html>
    <button class="home-game-card">
      <div id="home-game-rank-shot"></div>
    </button>
    <button class="home-game-card">
      <div id="home-game-rank-kick"></div>
    </button>
  `);
  const App = {};
  const context = vm.createContext({
    App,
    ApiService: apiService,
    FirebaseService: { _cache: { users } },
    document: dom.window.document,
    window: {
      requestIdleCallback: (callback) => callback(),
    },
    setTimeout,
    console,
  });
  vm.runInContext(source, context, { filename: 'js/modules/home-game-rank-preview.js' });
  return { App, dom };
}

describe('home game rank preview', () => {
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
    expect(preview.closest('.home-game-card')?.classList.contains('has-rank-preview')).toBe(true);
  });
});
