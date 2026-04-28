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
    delete global.document;
    delete global.TOURNAMENT_STATUS;
  });

  test('register action passes clicked button for loading feedback', () => {
    const area = { innerHTML: '' };
    global.document = { getElementById: id => (id === 'td-register-area' ? area : null) };
    global.TOURNAMENT_STATUS = { PREPARING: 'preparing', REG_CLOSED: 'closed' };
    global.ApiService = {
      getCurrentUser: () => ({ uid: 'guest_cap', role: 'user' }),
    };
    global.App = {
      renderRegisterButton: jest.fn(),
      renderTournamentTab: jest.fn(),
      _isFriendlyTournamentRecord: jest.fn(() => true),
      _getFriendlyTournamentState: jest.fn(() => ({ tournament: { id: 'ct_test' }, applications: [], entries: [] })),
      _getFriendlyTournamentApplyContext: jest.fn(() => ({
        availableTeams: [{ id: 'tm_guest', name: 'Guest Team' }],
        pendingTeams: [],
        approvedTeams: [],
        rejectedTeams: [],
      })),
      _getFriendlyTournamentTeamLimit: jest.fn(() => 4),
      getTournamentStatus: jest.fn(() => 'open'),
      isTournamentEnded: jest.fn(() => false),
    };
    require('../../js/modules/tournament/tournament-friendly-detail-view.js');

    global.App.renderRegisterButton({ id: 'ct_test' });

    expect(area.innerHTML).toContain("return App.registerTournament('ct_test', this)");
    expect(area.innerHTML).toContain('參加賽事');
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

  test('renders applicant-side withdraw action for approved team officers', () => {
    global.ApiService = {
      getCurrentUser: () => ({ uid: 'guest_cap', role: 'user' }),
      getTeam: () => ({ id: 'tm_guest', captainUid: 'guest_cap' }),
    };
    global.App._canManageTournamentRecord = jest.fn(() => false);
    global.App._isTournamentTeamOfficerForTeam = jest.fn((team, user) => team.captainUid === user.uid);
    require('../../js/modules/tournament/tournament-friendly-detail-view.js');

    const html = global.App._renderFriendlyTournamentTeamsTab({
      tournament: { id: 'ct_test', hostTeamId: 'tm_host' },
      entries: [
        { teamId: 'tm_host', teamName: 'Host Team', entryStatus: 'host', memberRoster: [] },
        { teamId: 'tm_guest', teamName: 'Guest Team', entryStatus: 'approved', memberRoster: [] },
      ],
      applications: [],
    });

    expect(html).toContain('tfd-entry-withdraw-btn');
    expect(html).toContain('退出賽事');
    expect(html).toContain("return App.withdrawFriendlyTournamentTeam('ct_test','tm_guest', this)");
    expect(html).not.toContain('tfd-entry-remove-btn');
  });

  test('renders applicant-side withdraw action for pending applications', () => {
    global.ApiService = {
      getCurrentUser: () => ({ uid: 'guest_cap', role: 'user' }),
      getTeam: () => ({ id: 'tm_guest', captainUid: 'guest_cap' }),
    };
    global.App._canManageTournamentRecord = jest.fn(() => false);
    global.App._getFriendlyTournamentVisibleApplications = jest.fn(() => [
      { id: 'ta_tm_guest', teamId: 'tm_guest', teamName: 'Guest Team', status: 'pending', requestedByName: 'Captain' },
    ]);
    global.App._isTournamentTeamOfficerForTeam = jest.fn((team, user) => team.captainUid === user.uid);
    require('../../js/modules/tournament/tournament-friendly-detail-view.js');

    const html = global.App._renderFriendlyTournamentTeamsTab({
      tournament: { id: 'ct_test', hostTeamId: 'tm_host' },
      entries: [{ teamId: 'tm_host', teamName: 'Host Team', entryStatus: 'host', memberRoster: [] }],
      applications: [{ id: 'ta_tm_guest', teamId: 'tm_guest', teamName: 'Guest Team', status: 'pending' }],
    });

    expect(html).toContain('撤回申請');
    expect(html).toContain("return App.withdrawFriendlyTournamentTeam('ct_test','tm_guest', this)");
    expect(html).not.toContain('tfd-review-actions');
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

  test('uses button loading while withdrawing own approved entry', async () => {
    const actionButton = { textContent: '退出賽事', dataset: {}, style: {}, disabled: false, isConnected: true };
    const tournament = { id: 'ct_test', hostTeamId: 'tm_host' };
    const entry = { teamId: 'tm_guest', teamName: 'Guest Team', entryStatus: 'approved' };

    global.ApiService = {
      getCurrentUser: () => ({ uid: 'guest_cap', role: 'user' }),
      getTeam: () => ({ id: 'tm_guest', captainUid: 'guest_cap', name: 'Guest Team' }),
      withdrawFriendlyTournamentTeamAtomic: jest.fn(() => Promise.resolve({ status: 'withdrawn' })),
    };
    global.App = {
      _loadFriendlyTournamentDetailState: jest.fn()
        .mockResolvedValueOnce({ tournament, entries: [entry], applications: [] })
        .mockResolvedValueOnce({ tournament, entries: [], applications: [] }),
      _isFriendlyTournamentRecord: jest.fn(() => true),
      _isTournamentGlobalAdmin: jest.fn(() => false),
      _isTournamentTeamOfficerForTeam: jest.fn((team, user) => team.captainUid === user.uid),
      isTournamentEnded: jest.fn(() => false),
      appConfirm: jest.fn(() => Promise.resolve(true)),
      renderRegisterButton: jest.fn(),
      renderTournamentTab: jest.fn(),
      showToast: jest.fn(),
      _showTournamentActionError: jest.fn(),
      _withButtonLoading: jest.fn((btn, text, asyncFn) => asyncFn()),
    };

    require('../../js/modules/tournament/tournament-friendly-withdraw.js');
    await global.App.withdrawFriendlyTournamentTeam('ct_test', 'tm_guest', actionButton);

    expect(global.App._withButtonLoading).toHaveBeenCalledWith(actionButton, '退出中...', expect.any(Function));
    expect(global.ApiService.withdrawFriendlyTournamentTeamAtomic).toHaveBeenCalledWith('ct_test', 'tm_guest');
    expect(global.App.renderTournamentTab).toHaveBeenCalledWith('teams');
  });

  test('does not let rejected applications be converted into withdrawals', async () => {
    const tournament = { id: 'ct_test', hostTeamId: 'tm_host' };
    const application = { teamId: 'tm_guest', teamName: 'Guest Team', status: 'rejected' };

    global.ApiService = {
      getCurrentUser: () => ({ uid: 'guest_cap', role: 'user' }),
      getTeam: () => ({ id: 'tm_guest', captainUid: 'guest_cap', name: 'Guest Team' }),
      withdrawFriendlyTournamentTeamAtomic: jest.fn(),
    };
    global.App = {
      _loadFriendlyTournamentDetailState: jest.fn().mockResolvedValue({ tournament, entries: [], applications: [application] }),
      _isFriendlyTournamentRecord: jest.fn(() => true),
      _isTournamentGlobalAdmin: jest.fn(() => false),
      _isTournamentTeamOfficerForTeam: jest.fn((team, user) => team.captainUid === user.uid),
      isTournamentEnded: jest.fn(() => false),
      appConfirm: jest.fn(),
      showToast: jest.fn(),
      _showTournamentActionError: jest.fn(),
    };

    require('../../js/modules/tournament/tournament-friendly-withdraw.js');
    await global.App.withdrawFriendlyTournamentTeam('ct_test', 'tm_guest');

    expect(global.App.showToast).toHaveBeenCalledWith('目前沒有可撤回或退出的參賽狀態。');
    expect(global.App.appConfirm).not.toHaveBeenCalled();
    expect(global.ApiService.withdrawFriendlyTournamentTeamAtomic).not.toHaveBeenCalled();
  });
});
