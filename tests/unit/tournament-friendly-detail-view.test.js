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

  test('admin register area shows a club selector for joined available clubs', () => {
    const area = { innerHTML: '' };
    global.document = { getElementById: id => (id === 'td-register-area' ? area : null) };
    global.TOURNAMENT_STATUS = { PREPARING: 'preparing', REG_CLOSED: 'closed' };
    global.ApiService = {
      getCurrentUser: () => ({ uid: 'admin_uid', role: 'admin' }),
    };
    global.App = {
      renderRegisterButton: jest.fn(),
      renderTournamentTab: jest.fn(),
      _isFriendlyTournamentRecord: jest.fn(() => true),
      _getFriendlyTournamentState: jest.fn(() => ({ tournament: { id: 'ct_test' }, applications: [], entries: [] })),
      _getFriendlyTournamentApplyContext: jest.fn(() => ({
        availableTeams: [
          { id: 'tm_alpha', name: 'Alpha Club' },
          { id: 'tm_beta', name: 'Beta Club' },
        ],
        pendingTeams: [],
        approvedTeams: [],
        rejectedTeams: [],
      })),
      _getFriendlyTournamentTeamLimit: jest.fn(() => 4),
      _isTournamentGlobalAdmin: jest.fn(user => user?.role === 'admin'),
      getTournamentStatus: jest.fn(() => 'open'),
      isTournamentEnded: jest.fn(() => false),
    };
    require('../../js/modules/tournament/tournament-friendly-detail-view.js');

    global.App.renderRegisterButton({ id: 'ct_test' });

    expect(area.innerHTML).toContain('id="td-apply-team-select"');
    expect(area.innerHTML).toContain('Alpha Club');
    expect(area.innerHTML).toContain('Beta Club');
    expect(area.innerHTML).toContain("return App.registerTournament('ct_test', this)");
  });

  test('keeps join action when the selected club is still available', () => {
    const area = { innerHTML: '' };
    global.document = { getElementById: id => (id === 'td-register-area' ? area : null) };
    global.TOURNAMENT_STATUS = { PREPARING: 'preparing', REG_CLOSED: 'closed' };
    global.ApiService = {
      getCurrentUser: () => ({ uid: 'guest_cap', role: 'user' }),
      getTeam: id => ({ id, captainUid: 'guest_cap' }),
    };
    global.App = {
      renderRegisterButton: jest.fn(),
      renderTournamentTab: jest.fn(),
      _isFriendlyTournamentRecord: jest.fn(() => true),
      _getFriendlyTournamentState: jest.fn(() => ({ tournament: { id: 'ct_test' }, applications: [], entries: [] })),
      _getFriendlyTournamentApplyContext: jest.fn(() => ({
        availableTeams: [{ id: 'tm_free', name: 'Free Team' }],
        pendingTeams: [{ teamId: 'tm_pending', teamName: 'Pending Team', status: 'pending' }],
        approvedTeams: [],
        rejectedTeams: [],
      })),
      _getFriendlyTournamentTeamLimit: jest.fn(() => 4),
      _isTournamentGlobalAdmin: jest.fn(() => false),
      _isTournamentTeamOfficerForTeam: jest.fn((team, user) => team.captainUid === user.uid),
      getTournamentStatus: jest.fn(() => 'open'),
      isTournamentEnded: jest.fn(() => false),
    };
    require('../../js/modules/tournament/tournament-friendly-detail-view.js');
    global.App._friendlyTournamentSelectedActionTeamById.ct_test = 'tm_free';

    global.App.renderRegisterButton({ id: 'ct_test' });

    expect(area.innerHTML).toContain('value="tm_free" selected');
    expect(area.innerHTML).toContain('參加賽事');
    expect(area.innerHTML).not.toContain('俱樂部審核中</button>');
  });

  test('shows pending state for the selected club after application is submitted', () => {
    const area = { innerHTML: '' };
    global.document = { getElementById: id => (id === 'td-register-area' ? area : null) };
    global.TOURNAMENT_STATUS = { PREPARING: 'preparing', REG_CLOSED: 'closed' };
    global.ApiService = {
      getCurrentUser: () => ({ uid: 'guest_cap', role: 'user' }),
      getTeam: id => ({ id, captainUid: 'guest_cap' }),
    };
    global.App = {
      renderRegisterButton: jest.fn(),
      renderTournamentTab: jest.fn(),
      _isFriendlyTournamentRecord: jest.fn(() => true),
      _getFriendlyTournamentState: jest.fn(() => ({ tournament: { id: 'ct_test' }, applications: [], entries: [] })),
      _getFriendlyTournamentApplyContext: jest.fn(() => ({
        availableTeams: [{ id: 'tm_free', name: 'Free Team' }],
        pendingTeams: [{ teamId: 'tm_pending', teamName: 'Pending Team', status: 'pending' }],
        approvedTeams: [],
        rejectedTeams: [],
      })),
      _getFriendlyTournamentTeamLimit: jest.fn(() => 4),
      _isTournamentGlobalAdmin: jest.fn(() => false),
      _isTournamentTeamOfficerForTeam: jest.fn((team, user) => team.captainUid === user.uid),
      getTournamentStatus: jest.fn(() => 'open'),
      isTournamentEnded: jest.fn(() => false),
    };
    require('../../js/modules/tournament/tournament-friendly-detail-view.js');
    global.App._friendlyTournamentSelectedActionTeamById.ct_test = 'tm_pending';

    global.App.renderRegisterButton({ id: 'ct_test' });

    expect(area.innerHTML).toContain('value="tm_pending" selected');
    expect(area.innerHTML).toContain('俱樂部審核中');
    expect(area.innerHTML).toContain('撤回申請');
    expect(area.innerHTML).toContain("return App.withdrawFriendlyTournamentTeam('ct_test','tm_pending', this)");
    expect(area.innerHTML).not.toContain("return App.registerTournament('ct_test', this)");
  });

  test('shows approved state and cancel registration for the selected approved club', () => {
    const area = { innerHTML: '' };
    global.document = { getElementById: id => (id === 'td-register-area' ? area : null) };
    global.TOURNAMENT_STATUS = { PREPARING: 'preparing', REG_CLOSED: 'closed' };
    global.ApiService = {
      getCurrentUser: () => ({ uid: 'guest_cap', role: 'user' }),
      getTeam: id => ({ id, captainUid: 'guest_cap' }),
    };
    global.App = {
      renderRegisterButton: jest.fn(),
      renderTournamentTab: jest.fn(),
      _isFriendlyTournamentRecord: jest.fn(() => true),
      _getFriendlyTournamentState: jest.fn(() => ({ tournament: { id: 'ct_test' }, applications: [], entries: [] })),
      _getFriendlyTournamentApplyContext: jest.fn(() => ({
        availableTeams: [{ id: 'tm_free', name: 'Free Team' }],
        pendingTeams: [],
        approvedTeams: [{ teamId: 'tm_approved', teamName: 'Approved Team', entryStatus: 'approved' }],
        rejectedTeams: [],
      })),
      _getFriendlyTournamentTeamLimit: jest.fn(() => 4),
      _isTournamentGlobalAdmin: jest.fn(() => false),
      _isTournamentTeamOfficerForTeam: jest.fn((team, user) => team.captainUid === user.uid),
      getTournamentStatus: jest.fn(() => 'open'),
      isTournamentEnded: jest.fn(() => false),
    };
    require('../../js/modules/tournament/tournament-friendly-detail-view.js');
    global.App._friendlyTournamentSelectedActionTeamById.ct_test = 'tm_approved';

    global.App.renderRegisterButton({ id: 'ct_test' });

    expect(area.innerHTML).toContain('value="tm_approved" selected');
    expect(area.innerHTML).toContain('俱樂部已通過審核');
    expect(area.innerHTML).toContain('取消報名');
    expect(area.innerHTML).toContain("return App.withdrawFriendlyTournamentTeam('ct_test','tm_approved', this)");
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

  test('review action buttons pass clicked button for loading feedback', () => {
    global.App._getFriendlyTournamentVisibleApplications = jest.fn(() => [
      { id: 'ta_tm_guest', teamId: 'tm_guest', teamName: 'Guest Team', status: 'pending', requestedByName: 'Captain' },
    ]);
    require('../../js/modules/tournament/tournament-friendly-detail-view.js');

    const html = global.App._renderFriendlyTournamentTeamsTab({
      tournament: { id: 'ct_test', hostTeamId: 'tm_host' },
      entries: [{ teamId: 'tm_host', teamName: 'Host Team', entryStatus: 'host', memberRoster: [] }],
      applications: [{ id: 'ta_tm_guest', teamId: 'tm_guest', teamName: 'Guest Team', status: 'pending' }],
    });

    expect(html).toContain("return App.reviewFriendlyTournamentApplication('ct_test','ta_tm_guest','approve', this)");
    expect(html).toContain("return App.reviewFriendlyTournamentApplication('ct_test','ta_tm_guest','reject', this)");
  });

  test('review action shows loading and blocks duplicate decisions for the same application', async () => {
    const actionButton = { textContent: '確認', dataset: {}, style: {}, disabled: false, isConnected: true };
    const otherButton = { textContent: '拒絕', dataset: {}, style: {}, disabled: false, isConnected: true };
    const tournament = { id: 'ct_test', hostTeamId: 'tm_host' };
    const application = { id: 'ta_tm_guest', teamId: 'tm_guest', teamName: 'Guest Team', status: 'pending' };
    let resolveReview;
    const reviewPromise = new Promise(resolve => { resolveReview = () => resolve({ ok: true }); });

    global.ApiService = {
      getCurrentUser: () => ({ uid: 'host_uid', role: 'user' }),
      reviewFriendlyTournamentApplicationAtomic: jest.fn(() => reviewPromise),
    };
    global.App = {
      showTournamentDetail: jest.fn(),
      renderRegisterButton: jest.fn(),
      registerTournament: jest.fn(),
      renderTournamentTab: jest.fn(),
      _loadFriendlyTournamentDetailState: jest.fn().mockResolvedValue({ tournament, entries: [], applications: [application] }),
      _isTournamentGlobalAdmin: jest.fn(() => false),
      _canManageTournamentRecord: jest.fn(() => true),
      appConfirm: jest.fn(),
      showToast: jest.fn(),
      _showTournamentActionError: jest.fn(),
    };

    require('../../js/modules/tournament/tournament-friendly-detail.js');
    const first = global.App.reviewFriendlyTournamentApplication('ct_test', 'ta_tm_guest', 'approve', actionButton);
    await global.App.reviewFriendlyTournamentApplication('ct_test', 'ta_tm_guest', 'reject', otherButton);
    await Promise.resolve();

    expect(actionButton.disabled).toBe(true);
    expect(actionButton.textContent).toBe('確認中...');
    expect(actionButton.dataset.btnLoading).toBe('1');
    expect(otherButton.disabled).toBe(false);
    expect(global.ApiService.reviewFriendlyTournamentApplicationAtomic).toHaveBeenCalledTimes(1);
    expect(global.ApiService.reviewFriendlyTournamentApplicationAtomic).toHaveBeenCalledWith('ct_test', 'ta_tm_guest', 'approve');

    resolveReview();
    await first;

    expect(actionButton.disabled).toBe(false);
    expect(actionButton.textContent).toBe('確認');
    expect(actionButton.dataset.btnLoading).toBe('');
    expect(global.App.renderTournamentTab).toHaveBeenCalledWith('teams');
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

  test('admin apply context is limited to joined clubs, not all loaded clubs', () => {
    const tournament = { id: 'ct_test', hostTeamId: 'tm_host', sportTag: 'football' };
    const adminUser = { uid: 'admin_uid', role: 'admin', teamIds: ['tm_alpha', 'tm_beta', 'tm_approved'] };
    const teams = [
      { id: 'tm_host', name: 'Host', sportTag: 'football' },
      { id: 'tm_alpha', name: 'Alpha Club', sportTag: 'football' },
      { id: 'tm_beta', name: 'Beta Club', sportTag: 'football' },
      { id: 'tm_approved', name: 'Approved Club', sportTag: 'football' },
      { id: 'tm_stranger', name: 'Stranger Club', sportTag: 'football' },
      { id: 'tm_stranger_approved', name: 'Stranger Approved Club', sportTag: 'football' },
      { id: 'tm_basket', name: 'Basket Club', sportTag: 'basketball' },
    ];
    global.ApiService = {
      getCurrentUser: () => adminUser,
      getTeams: () => teams,
      getTeam: teamId => teams.find(team => team.id === teamId) || null,
    };
    global.App = {
      _isTournamentGlobalAdmin: jest.fn(user => user?.role === 'admin' || user?.role === 'super_admin'),
      _getFriendlyResponsibleTeams: jest.fn(() => []),
      _getUserTeamIds: jest.fn(user => user?.teamIds || []),
    };
    require('../../js/modules/tournament/tournament-friendly-state.js');

    const ctx = global.App._getFriendlyTournamentApplyContext(tournament, {
      tournament,
      applications: [
        { id: 'ta_tm_beta', teamId: 'tm_beta', teamName: 'Beta Club', status: 'pending' },
        { id: 'ta_tm_stranger', teamId: 'tm_stranger', teamName: 'Stranger Club', status: 'pending' },
      ],
      entries: [
        { teamId: 'tm_host', teamName: 'Host', entryStatus: 'host' },
        { teamId: 'tm_approved', teamName: 'Approved Club', entryStatus: 'approved' },
        { teamId: 'tm_stranger_approved', teamName: 'Stranger Approved Club', entryStatus: 'approved' },
      ],
    }, adminUser);

    expect(ctx.availableTeams.map(team => team.id)).toEqual(['tm_alpha']);
    expect(ctx.pendingTeams.map(team => team.teamId)).toEqual(['tm_beta']);
    expect(ctx.approvedTeams.map(team => team.teamId)).toEqual(['tm_approved']);
    expect(ctx.approvedTeams.map(team => team.teamId)).not.toContain('tm_host');
    expect(ctx.pendingTeams.map(team => team.teamId)).not.toContain('tm_stranger');
    expect(ctx.approvedTeams.map(team => team.teamId)).not.toContain('tm_stranger_approved');
  });
});
