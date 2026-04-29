describe('tournament delete navigation', () => {
  beforeEach(() => {
    jest.resetModules();
    global.ApiService = {
      getTournament: jest.fn(() => ({ id: 'ct_dead', name: 'Deleted Tournament' })),
      deleteTournamentAwait: jest.fn(() => Promise.resolve()),
      _writeOpLog: jest.fn(),
    };
    global.App = {
      currentPage: 'page-tournament-detail',
      currentTournament: 'ct_dead',
      _tournamentDetailRequestSeq: 1,
      _friendlyTournamentDetailSeq: 1,
      _friendlyTournamentDetailStateById: {
        ct_dead: { tournament: { id: 'ct_dead' } },
      },
      _getTournamentRouteParam: jest.fn(() => 'ct_dead'),
      _clearTournamentDetailRouteParam: jest.fn(),
      _isTournamentGlobalAdmin: jest.fn(() => true),
      appConfirm: jest.fn(() => Promise.resolve(true)),
      renderTournamentTimeline: jest.fn(),
      renderOngoingTournaments: jest.fn(),
      renderTournamentManage: jest.fn(),
      showPage: jest.fn(() => Promise.resolve({ ok: true })),
      showToast: jest.fn(),
    };
  });

  afterEach(() => {
    delete global.ApiService;
    delete global.App;
  });

  test('redirects from deleted detail page to tournament list while bypassing page lock', async () => {
    require('../../js/modules/tournament/tournament-manage.js');
    global.App.renderTournamentManage = jest.fn();

    await global.App.handleDeleteTournament('ct_dead');

    expect(global.ApiService.deleteTournamentAwait).toHaveBeenCalledWith('ct_dead');
    expect(global.App._clearTournamentDetailRouteParam).toHaveBeenCalled();
    expect(global.App.showPage).toHaveBeenCalledWith('page-tournaments', {
      bypassPageLock: true,
      resetHistory: true,
    });
    expect(global.App.currentTournament).toBeNull();
    expect(global.App._friendlyTournamentDetailStateById.ct_dead).toBeUndefined();
    expect(global.App._tournamentDetailRequestSeq).toBeGreaterThan(1);
    expect(global.App._friendlyTournamentDetailSeq).toBeGreaterThan(1);
  });

  test('does not redirect when deleting from a non-detail management page', async () => {
    global.App.currentPage = 'page-admin-tournaments';
    global.App.currentTournament = null;
    global.App._getTournamentRouteParam = jest.fn(() => '');
    require('../../js/modules/tournament/tournament-manage.js');
    global.App.renderTournamentManage = jest.fn();

    await global.App.handleDeleteTournament('ct_dead');

    expect(global.ApiService.deleteTournamentAwait).toHaveBeenCalledWith('ct_dead');
    expect(global.App.showPage).not.toHaveBeenCalled();
    expect(global.App._clearTournamentDetailRouteParam).not.toHaveBeenCalled();
  });
});
