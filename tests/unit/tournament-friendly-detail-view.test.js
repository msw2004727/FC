describe('friendly tournament teams tab actions', () => {
  beforeEach(() => {
    jest.resetModules();
    global.escapeHTML = value => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    global.ApiService = {
      getCurrentUser: () => ({ uid: 'host_uid', role: 'user' }),
    };
    global.App = {
      renderRegisterButton: jest.fn(),
      renderTournamentTab: jest.fn(),
      _isTournamentGlobalAdmin: jest.fn(() => false),
      _canManageTournamentRecord: jest.fn(() => true),
      _getFriendlyTournamentTeamLimit: jest.fn(() => 4),
      _getFriendlyTournamentVisibleApplications: jest.fn(() => []),
    };
  });

  afterEach(() => {
    delete global.App;
    delete global.ApiService;
    delete global.escapeHTML;
  });

  test('renders a right-side remove action for approved non-host entries only', () => {
    require('../../js/modules/tournament/tournament-friendly-detail-view.js');

    const html = global.App._renderFriendlyTournamentTeamsTab({
      tournament: { id: 'ct_test', hostTeamId: 'tm_host' },
      entries: [
        { teamId: 'tm_host', teamName: 'Host Team', entryStatus: 'host', memberRoster: [] },
        { teamId: 'tm_guest', teamName: 'Guest Team', entryStatus: 'approved', memberRoster: [] },
      ],
      applications: [],
    });

    expect(html).toContain('tfd-team-action');
    expect(html).toContain('tfd-entry-remove-btn');
    expect(html).toContain("return App.removeFriendlyTournamentEntry('ct_test','tm_guest', this)");
    expect(html.match(/tfd-entry-remove-btn/g)).toHaveLength(1);
  });

  test('uses button loading while removing an approved entry', async () => {
    const actionButton = { textContent: '剔除', dataset: {}, style: {}, disabled: false, isConnected: true };
    const tournament = { id: 'ct_test', hostTeamId: 'tm_host' };
    const entry = { teamId: 'tm_guest', teamName: 'Guest Team', entryStatus: 'approved' };

    global.ApiService = {
      getCurrentUser: () => ({ uid: 'host_uid', role: 'user' }),
      removeFriendlyTournamentEntryAtomic: jest.fn(() => Promise.resolve({ ok: true })),
    };
    global.App = {
      showTournamentDetail: jest.fn(),
      renderRegisterButton: jest.fn(),
      registerTournament: jest.fn(),
      renderTournamentTab: jest.fn(),
      _loadFriendlyTournamentDetailState: jest.fn()
        .mockResolvedValueOnce({ tournament, entries: [entry], applications: [] })
        .mockResolvedValueOnce({ tournament, entries: [], applications: [] }),
      _isTournamentGlobalAdmin: jest.fn(() => false),
      _canManageTournamentRecord: jest.fn(() => true),
      appConfirm: jest.fn(() => Promise.resolve(true)),
      showToast: jest.fn(),
      _showTournamentActionError: jest.fn(),
      _withButtonLoading: jest.fn((btn, text, asyncFn) => asyncFn()),
    };

    require('../../js/modules/tournament/tournament-friendly-detail.js');
    await global.App.removeFriendlyTournamentEntry('ct_test', 'tm_guest', actionButton);

    expect(global.App._withButtonLoading).toHaveBeenCalledWith(actionButton, '剔除中...', expect.any(Function));
    expect(global.ApiService.removeFriendlyTournamentEntryAtomic).toHaveBeenCalledWith('ct_test', 'tm_guest');
    expect(global.App.renderTournamentTab).toHaveBeenCalledWith('teams');
  });
});
