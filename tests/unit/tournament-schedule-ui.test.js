const fs = require('fs');
const path = require('path');

function loadModule(relPath, globals) {
  const code = fs.readFileSync(path.resolve(__dirname, '..', '..', relPath), 'utf8');
  const fn = new Function(...Object.keys(globals), code);
  fn(...Object.values(globals));
}

function escapeHTML(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildCompetitionApp() {
  const App = { renderTournamentTab: jest.fn() };
  const ApiService = { getCurrentUser: () => null };
  loadModule('js/modules/tournament/tournament-competition.js', { App, ApiService });
  loadModule('js/modules/tournament/tournament-detail-competition.js', { App, ApiService, escapeHTML });
  return App;
}

function buildScheduleApp() {
  const App = {};
  const ApiService = {};
  loadModule('js/modules/tournament/tournament-schedule-manage.js', { App, ApiService, escapeHTML });
  return App;
}

describe('tournament bracket UI', () => {
  test('renders every repeated cup game instead of collapsing the series', () => {
    const App = buildCompetitionApp();
    const matches = App._generateCupBracket(['a', 'b'], { matchRepeatCount: 4 })
      .map(match => App._buildTournamentMatchRecord(match));
    const matchesBySlot = App._buildTournamentMatchesBySlot(matches);
    const html = App._renderTournamentBracketHtml(
      matches,
      matchesBySlot,
      { a: 'Alpha', b: 'Beta' },
      App._getTournamentBracketSize(matches)
    );

    expect((html.match(/class="bracket-match /g) || [])).toHaveLength(4);
    expect(html).toContain('data-series-game="4"');
    expect(html).toContain('第 4/4 場');
  });
});

describe('tournament schedule manager bulk save', () => {
  const makeRow = ({ id, time, venue, refs = [] }) => ({
    dataset: { matchId: id },
    querySelector(selector) {
      if (selector === '.tc-manage-time') return { value: time };
      if (selector === '.tc-manage-venue') return { value: venue };
      return null;
    },
    querySelectorAll(selector) {
      if (selector !== '.tc-ref-check input:checked') return [];
      return refs.map(ref => ({ dataset: { refUid: ref.uid, refName: ref.name } }));
    },
  });

  test('collects all visible match meta fields in one payload', () => {
    const App = buildScheduleApp();
    App._normalizeTournamentDateTimeValue = value => `normalized:${value}`;
    const originalDocument = global.document;
    global.document = {
      querySelectorAll: jest.fn(() => [
        makeRow({ id: 'm1', time: '2026-06-13T10:00', venue: 'A 場', refs: [{ uid: 'r1', name: 'Ref 1' }] }),
        makeRow({ id: 'm2', time: '2026-06-13T11:00', venue: 'B 場', refs: [{ uid: 'r2', name: 'Ref 2' }] }),
      ]),
    };

    try {
      const updates = App._collectTournamentScheduleMetaUpdates();
      expect(updates).toHaveLength(2);
      expect(updates[0]).toEqual({
        id: 'm1',
        updates: {
          scheduledAt: 'normalized:2026-06-13T10:00',
          venue: 'A 場',
          referees: [{ uid: 'r1', name: 'Ref 1' }],
          refereeUids: ['r1'],
        },
      });
      expect(updates[1].updates.scheduledAt).toBe('normalized:2026-06-13T11:00');
      expect(updates[1].updates.venue).toBe('B 場');
    } finally {
      global.document = originalDocument;
    }
  });
});
