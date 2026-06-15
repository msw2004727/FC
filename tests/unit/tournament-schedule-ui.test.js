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

function buildScheduleApp(apiOverrides = {}) {
  const App = {};
  const ApiService = apiOverrides;
  loadModule('js/modules/tournament/tournament-schedule-manage.js', { App, ApiService, escapeHTML });
  return App;
}

describe('tournament bracket UI', () => {
  test('keeps timestamp-like match times parseable when normalizing records', () => {
    const App = buildCompetitionApp();
    const timestampLike = {
      toMillis: () => new Date('2026-06-13T02:00:00.000Z').getTime(),
      toDate: () => new Date('2026-06-13T02:00:00.000Z'),
    };

    const record = App._buildTournamentMatchRecord({
      id: 'm1',
      stage: 'cup',
      scheduledAt: timestampLike,
    });

    expect(record.scheduledAt).toBe(timestampLike);
  });

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

  test('renders draft score as live update without resolving a winner before completion', () => {
    const App = buildCompetitionApp();
    const match = App._buildTournamentMatchRecord({
      id: 'm_draft',
      stage: 'league',
      status: 'scheduled',
      homeTeamId: 'a',
      awayTeamId: 'b',
      scoreHome: 2,
      scoreAway: 1,
      events: [{ type: 'stoppage_time', minute: 45, note: '+3' }],
    });
    const html = App._renderTournamentMatchRowHtml(
      { id: 'ct_test' },
      match,
      {},
      { a: 'Alpha', b: 'Beta' },
      { canRecord: false }
    );

    expect(App._getTournamentMatchWinnerTeamId(match)).toBe('');
    expect(html).toContain('tc-match-live');
    expect(html).toContain('tc-match-status-live');
    expect(html).toContain('2 : 1');
    expect(html).not.toContain('tc-winner');
  });

  test('renders scrollable schedule summary with teams, time, and score', () => {
    const App = buildCompetitionApp();
    const matches = [
      App._buildTournamentMatchRecord({
        id: 'm1',
        stage: 'league',
        round: 1,
        slot: 0,
        status: 'finished',
        homeTeamId: 'de',
        awayTeamId: 'cw',
        scoreHome: 7,
        scoreAway: 1,
        scheduledAt: '2026-06-13T10:30',
        venue: 'Main',
      }),
    ];
    const html = App._renderTournamentCompetitionScheduleHtml({
      tournament: { id: 'ct_test', friendlyConfig: { mode: 'league' } },
      entries: [
        { teamId: 'de', teamName: '德國' },
        { teamId: 'cw', teamName: '庫拉索' },
      ],
      matches,
    });

    expect(html).toContain('tc-schedule-summary-list');
    expect(html).toContain('tc-summary-match tc-summary-match-finished');
    expect(html).toContain('賽程摘要列');
    expect(html).toContain('德國');
    expect(html).toContain('庫拉索');
    expect(html).toContain('2026/06/13 10:30');
    expect(html).toContain('<b>7</b>');
    expect(html).toContain('<b>1</b>');
  });

  test('closes the schedule manager after bulk save succeeds', async () => {
    const ApiService = {
      batchUpdateTournamentMatchesMetaAwait: jest.fn().mockResolvedValue([]),
    };
    const App = buildScheduleApp(ApiService);
    App._collectTournamentScheduleMetaUpdates = jest.fn(() => [
      { id: 'm1', updates: { scheduledAt: '2026-06-13T02:00:00.000Z' } },
    ]);
    App._refreshTournamentCompetitionMatches = jest.fn().mockResolvedValue();
    App._closeTournamentScheduleManager = jest.fn();
    App.showToast = jest.fn();

    await App.saveAllTournamentMatchMeta('t1');

    expect(ApiService.batchUpdateTournamentMatchesMetaAwait).toHaveBeenCalledWith('t1', [
      { id: 'm1', updates: { scheduledAt: '2026-06-13T02:00:00.000Z' } },
    ]);
    expect(App._refreshTournamentCompetitionMatches).toHaveBeenCalledWith('t1');
    expect(App._closeTournamentScheduleManager).toHaveBeenCalledTimes(1);
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
