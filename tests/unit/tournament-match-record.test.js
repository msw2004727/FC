const fs = require('fs');
const path = require('path');

function loadModule(relPath, globals) {
  const code = fs.readFileSync(path.resolve(__dirname, '..', '..', relPath), 'utf8');
  const fn = new Function(...Object.keys(globals), code);
  fn(...Object.values(globals));
}

function buildApp() {
  const App = {};
  const ApiService = {
    getCurrentUser: () => ({ uid: 'recorder_uid', displayName: 'Recorder' }),
    updateTournamentMatchAwait: jest.fn().mockResolvedValue(),
    _writeOpLog: jest.fn(),
  };
  loadModule('js/modules/tournament/tournament-match-record.js', { App, ApiService });
  App.closeTournamentMatchRecordModal = jest.fn();
  App._refreshTournamentCompetitionMatches = jest.fn().mockResolvedValue();
  App.showToast = jest.fn();
  App.appConfirm = jest.fn().mockResolvedValue(true);
  return { App, ApiService };
}

function renderScoreForm({ completed = false } = {}) {
  const elements = {
    'tmr-result-completed': { checked: completed },
    'tmr-score-home': { value: '2' },
    'tmr-score-away': { value: '1' },
    'tmr-pk-home': null,
    'tmr-pk-away': null,
    'tournament-schedule-overlay': null,
  };
  global.document = {
    getElementById: jest.fn(id => elements[id] || null),
    querySelector: jest.fn(selector => {
      if (selector === 'input[name="tmr-result-type"]:checked') return { value: 'finished' };
      return null;
    }),
  };
}

describe('tournament match result recording', () => {
  afterEach(() => {
    delete global.document;
  });

  test('saving without completion switch stores a draft scheduled score', async () => {
    const { App, ApiService } = buildApp();
    App._tournamentMatchRecordState = {
      tournamentId: 'ct_test',
      matchId: 'm1',
      homeTeamId: 'home',
      awayTeamId: 'away',
      isCup: false,
      events: [{ type: 'yellow', teamId: 'home', uid: 'u1', name: 'Player', minute: 12, note: 'reason' }],
    };
    renderScoreForm({ completed: false });

    await App.saveTournamentMatchResult();

    expect(ApiService.updateTournamentMatchAwait).toHaveBeenCalledWith('ct_test', 'm1', expect.objectContaining({
      status: 'scheduled',
      scoreHome: 2,
      scoreAway: 1,
      events: App._tournamentMatchRecordState.events,
    }));
    expect(App.showToast).toHaveBeenCalledWith('比賽結果已暫存');
  });

  test('saving with completion switch marks the match finished', async () => {
    const { App, ApiService } = buildApp();
    App._tournamentMatchRecordState = {
      tournamentId: 'ct_test',
      matchId: 'm1',
      homeTeamId: 'home',
      awayTeamId: 'away',
      isCup: false,
      events: [],
    };
    renderScoreForm({ completed: true });

    await App.saveTournamentMatchResult();

    expect(ApiService.updateTournamentMatchAwait).toHaveBeenCalledWith('ct_test', 'm1', expect.objectContaining({
      status: 'finished',
      scoreHome: 2,
      scoreAway: 1,
    }));
    expect(App.showToast).toHaveBeenCalledWith('比賽已完賽並儲存');
  });
});
