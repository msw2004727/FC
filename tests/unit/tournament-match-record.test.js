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
  const resultType = completed ? 'finished' : 'scheduled';
  const elements = {
    'tmr-score-home': { value: '2' },
    'tmr-score-away': { value: '1' },
    'tmr-pk-home': null,
    'tmr-pk-away': null,
    'tournament-schedule-overlay': null,
  };
  global.document = {
    getElementById: jest.fn(id => elements[id] || null),
    querySelector: jest.fn(selector => {
      if (selector === 'input[name="tmr-result-type"]:checked') return { value: resultType };
      return null;
    }),
  };
}

describe('tournament match result recording', () => {
  afterEach(() => {
    delete global.document;
    delete global.escapeHTML;
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
    expect(App.showToast).toHaveBeenCalledWith('賽況已儲存');
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
    expect(App.showToast).toHaveBeenCalledWith('賽況已儲存');
  });

  test('substitution search matches selected club roster by jersey number or nickname', () => {
    const { App } = buildApp();
    const elements = {
      'tmr-event-team': { value: 'home' },
      'tmr-event-sub-out-search': { value: '11' },
      'tmr-event-sub-in-search': { value: '小' },
    };
    global.document = {
      getElementById: jest.fn(id => elements[id] || null),
      querySelector: jest.fn(() => null),
    };
    App._tournamentMatchRecordState = { tournamentId: 'ct_test' };
    App._getFriendlyTournamentState = jest.fn(() => ({
      entries: [
        {
          teamId: 'home',
          memberRoster: [
            { uid: 'u1', name: 'AAA', jerseyNumber: '11' },
            { uid: 'u2', name: '小明', jerseyNumber: '9' },
          ],
        },
        {
          teamId: 'away',
          memberRoster: [{ uid: 'u3', name: 'Away Player', jerseyNumber: '11' }],
        },
      ],
    }));
    App._formatFriendlyTournamentRosterMemberName = member => `${member.jerseyNumber}-${member.name}`;

    expect(App._getTournamentSubstitutionPlayerSuggestions('out').map(item => item.label)).toEqual(['11-AAA']);
    expect(App._getTournamentSubstitutionPlayerSuggestions('in').map(item => item.label)).toEqual(['9-小明']);
  });

  test('selected substitution suggestions append to manual textarea without duplicates', () => {
    const { App } = buildApp();
    const textarea = { value: 'Manual Player' };
    const search = { value: '11' };
    const suggestions = { innerHTML: '<button>11-AAA</button>' };
    const elements = {
      'tmr-event-sub-in': textarea,
      'tmr-event-sub-in-search': search,
      'tmr-event-sub-in-suggestions': suggestions,
    };
    global.document = {
      getElementById: jest.fn(id => elements[id] || null),
      querySelector: jest.fn(() => null),
    };

    App._appendTournamentSubstitutionPlayer('in', '11-AAA');
    App._appendTournamentSubstitutionPlayer('in', '11-AAA');

    expect(textarea.value).toBe('Manual Player\n11-AAA');
    expect(search.value).toBe('');
    expect(suggestions.innerHTML).toBe('');
  });

  test('record modal title stacks club names instead of one wrapping line', () => {
    const { App } = buildApp();
    global.escapeHTML = value => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    const elements = {
      'tmr-body': { innerHTML: '' },
      'tmr-actions': { innerHTML: '' },
      'tmr-title': { className: '', innerHTML: '', textContent: '' },
    };
    global.document = {
      getElementById: jest.fn(id => elements[id] || null),
      querySelector: jest.fn(() => null),
      querySelectorAll: jest.fn(() => []),
    };
    App._getTournamentCompetitionConfig = jest.fn(() => ({ walkoverWinScore: 3, walkoverLoseScore: 0 }));
    App._canManageTournamentRecord = jest.fn(() => false);
    App._syncTournamentMatchRecordResultType = jest.fn();
    App._syncTournamentMatchRecordPlayers = jest.fn();
    App._syncTournamentMatchRecordEventFields = jest.fn();
    App._renderTournamentMatchRecordEvents = jest.fn();
    App._tournamentMatchRecordState = {
      tournamentId: 'ct_test',
      homeTeamId: 'home',
      awayTeamId: 'away',
      homeName: 'Home Club',
      awayName: 'Away Club',
      isCup: false,
      events: [],
    };

    App._renderTournamentMatchRecordBody({ id: 'ct_test' }, { status: 'scheduled', scoreHome: null, scoreAway: null });

    expect(elements['tmr-title'].className).toContain('tmr-title');
    expect(elements['tmr-title'].className).toContain('tmr-title-redesigned');
    expect(elements['tmr-title'].innerHTML).toContain('tmr-title-kicker');
    expect(elements['tmr-title'].innerHTML).toContain('tmr-title-matchup');
    expect(elements['tmr-title'].innerHTML).toContain('tmr-title-pill');
    expect(elements['tmr-title'].innerHTML).toContain('Home Club');
    expect(elements['tmr-title'].innerHTML).toContain('Away Club');
  });

  test('match event briefing includes timeline roster staff and referees', () => {
    const { App } = buildApp();
    App._getFriendlyTournamentState = jest.fn(() => ({
      entries: [
        { teamId: 'home', memberRoster: [{ uid: 'u1', name: 'AAA', jerseyNumber: '11' }] },
        { teamId: 'away', memberRoster: [{ uid: 'u2', name: 'BBB', jerseyNumber: '9' }] },
      ],
    }));
    App._formatFriendlyTournamentRosterMemberName = member => `${member.jerseyNumber}-${member.name}`;

    const html = App._buildTournamentMatchBriefingHtml({
      tournamentId: 'ct_test',
      homeTeamId: 'home',
      awayTeamId: 'away',
      homeName: 'Home Club',
      awayName: 'Away Club',
      homeTeam: { coaches: [{ name: 'Coach A' }], leaders: ['Leader A'], captainName: 'Captain A' },
      awayTeam: { coachName: 'Coach B' },
      tournament: { refereeHead: { name: 'Head Ref' }, referees: [{ name: 'Ref A' }] },
      match: { referees: [{ name: 'Match Ref' }], scoreHome: 2, scoreAway: 1 },
      events: [
        { type: 'yellow', teamId: 'home', name: '11-AAA', minute: 12, note: 'late tackle' },
        { type: 'substitution', teamId: 'home', minute: 60, playersOut: ['11-AAA'], playersIn: ['9-BBB'], note: 'fresh legs' },
        { type: 'stoppage_time', minute: 5, note: '+5 announced' },
      ],
    });

    expect(html).toContain('Home Club vs Away Club');
    expect(html).toContain('第 12 分鐘');
    expect(html).toContain('late tackle');
    expect(html).toContain('下場：11-AAA');
    expect(html).toContain('上場：9-BBB');
    expect(html).toContain('+5 announced');
    expect(html).toContain('11-AAA');
    expect(html).toContain('9-BBB');
    expect(html).toContain('Coach A');
    expect(html).toContain('Leader A');
    expect(html).toContain('Head Ref');
    expect(html).toContain('Match Ref');
  });
});
