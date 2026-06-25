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
    delete global.FirebaseService;
  });

  test('register action passes clicked button for loading feedback', () => {
    const area = { innerHTML: '' };
    global.document = { getElementById: id => (id === 'td-register-area' ? area : null) };
    global.TOURNAMENT_STATUS = { PREPARING: 'preparing', REG_OPEN: 'open', REG_CLOSED: 'closed' };
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
    expect(area.innerHTML).toContain('signup-glow-wrap tfd-apply-glow-wrap');
    expect(area.innerHTML).toContain('signup-glow-border');
    expect(area.innerHTML).toContain('<span class="mini-text">報名中</span>');
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

  test('previously removed or rejected clubs stay selectable with a warning label', () => {
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
        availableTeams: [
          {
            id: 'tm_removed',
            name: 'Removed Club',
            hasPriorRejectedApplication: true,
            priorApplicationStatus: 'removed',
          },
        ],
        pendingTeams: [],
        approvedTeams: [],
        rejectedTeams: [],
      })),
      _getFriendlyTournamentTeamLimit: jest.fn(() => 4),
      _isTournamentGlobalAdmin: jest.fn(() => false),
      getTournamentStatus: jest.fn(() => 'open'),
      isTournamentEnded: jest.fn(() => false),
    };
    require('../../js/modules/tournament/tournament-friendly-detail-view.js');

    global.App.renderRegisterButton({ id: 'ct_test' });

    expect(area.innerHTML).toContain('tfd-team-select-reapply');
    expect(area.innerHTML).toContain('tfd-apply-option-reapply');
    expect(area.innerHTML).toContain('Removed Club');
    expect(area.innerHTML).not.toContain('Removed Club（已被拒絕過）');
    expect(area.innerHTML).toContain('<span>已被拒絕過</span>');
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

  test('defaults to an available managed club when status clubs are also listed', () => {
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

    global.App.renderRegisterButton({ id: 'ct_test' });

    expect(area.innerHTML).toContain('value="tm_free" selected');
    expect(area.innerHTML).toContain('data-friendly-team-action-status="available"');
    expect(area.innerHTML).toContain("return App.registerTournament('ct_test', this)");
    expect(area.innerHTML).not.toContain('tfd-status-btn');
  });
  test('keeps available register action from being replaced by roster hints', () => {
    const actionMain = {
      dataset: { friendlyTeamActionStatus: '' },
      innerHTML: '',
      querySelector: jest.fn(selector => (selector === '#td-apply-team-select' ? {} : null)),
    };
    const card = {
      dataset: { friendlyTeamActionStatus: '' },
      querySelector: jest.fn(selector => (selector === '.tfd-action-grid' ? {} : null)),
    };
    const area = {
      querySelector: jest.fn(selector => {
        if (selector === '.tfd-action-card') return card;
        if (selector === '.tfd-action-main') return actionMain;
        return null;
      }),
    };
    global.document = { getElementById: id => (id === 'td-register-area' ? area : null) };
    global.TOURNAMENT_STATUS = { REG_OPEN: 'open' };
    global.App = {
      renderRegisterButton: jest.fn(() => {
        card.dataset.friendlyTeamActionStatus = 'available';
        actionMain.dataset.friendlyTeamActionStatus = 'available';
        actionMain.innerHTML = '<select id="td-apply-team-select"></select><button>參加賽事</button>';
      }),
      _isFriendlyTournamentRecord: jest.fn(() => true),
    };
    require('../../js/modules/tournament/tournament-friendly-roster.js');

    global.App.renderRegisterButton({ id: 'ct_test', teamEntries: [] });

    expect(actionMain.innerHTML).toContain('參加賽事');
    expect(actionMain.innerHTML).not.toContain('等待負責人先加入');
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
    expect(area.innerHTML).toContain('tfd-status-btn');
    expect(area.innerHTML).toContain("App.showToast('審核中請耐心等待')");
    expect(area.innerHTML).toContain('俱樂部審核中');
    expect(area.innerHTML).toContain('撤回申請');
    expect(area.innerHTML).toContain("return App.withdrawFriendlyTournamentTeam('ct_test','tm_pending', this)");
    expect(area.innerHTML).not.toContain("return App.registerTournament('ct_test', this)");
    expect(area.innerHTML).not.toContain('disabled>俱樂部審核中</button>');
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
    expect(area.innerHTML).toContain('tfd-action-grid-three');
    expect(area.innerHTML).toContain("return App.shareTournament('ct_test', this)");
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

  test('renders roster join action for a player on an approved team row', () => {
    global.ApiService = {
      getCurrentUser: () => ({ uid: 'player_uid', role: 'user', teamIds: ['tm_guest'] }),
      getTeam: () => ({ id: 'tm_guest' }),
    };
    global.TOURNAMENT_STATUS = { REG_OPEN: 'open' };
    global.App._canManageTournamentRecord = jest.fn(() => false);
    global.App._getUserTeamIds = jest.fn(user => user?.teamIds || []);
    global.App._isTournamentTeamOfficerForTeam = jest.fn(() => false);
    global.App.getTournamentStatus = jest.fn(() => 'open');
    require('../../js/modules/tournament/tournament-friendly-detail-view.js');

    const html = global.App._renderFriendlyTournamentTeamsTab({
      tournament: { id: 'ct_test', hostTeamId: 'tm_host' },
      entries: [
        { teamId: 'tm_guest', teamName: 'Guest Team', entryStatus: 'approved', memberRoster: [] },
      ],
      applications: [],
    });

    expect(html).toContain('tfd-roster-join-btn');
    expect(html).toContain("return App.joinFriendlyTournamentRoster('ct_test','tm_guest', this)");
  });

  test('keeps cold roster rows in loading state until member subcollections hydrate', () => {
    global.ApiService = {
      getCurrentUser: () => ({ uid: 'player_uid', role: 'user', teamIds: ['tm_guest'] }),
      getTeam: () => ({ id: 'tm_guest' }),
    };
    global.TOURNAMENT_STATUS = { REG_OPEN: 'open' };
    global.App._canManageTournamentRecord = jest.fn(() => false);
    global.App._getUserTeamIds = jest.fn(user => user?.teamIds || []);
    global.App._isTournamentTeamOfficerForTeam = jest.fn(() => false);
    global.App.getTournamentStatus = jest.fn(() => 'open');
    require('../../js/modules/tournament/tournament-friendly-detail-view.js');

    const html = global.App._renderFriendlyTournamentTeamsTab({
      tournament: { id: 'ct_test', hostTeamId: 'tm_host' },
      rosterHydrated: false,
      entries: [
        { teamId: 'tm_guest', teamName: 'Guest Team', entryStatus: 'approved', memberRoster: [] },
      ],
      applications: [],
    });

    expect(html).toContain('tfd-roster-loading-btn');
    expect(html).toContain('球員 -');
    expect(html).toContain('載入中');
    expect(html).not.toContain('tfd-roster-join-btn');
    expect(html).not.toContain('joinFriendlyTournamentRoster');
  });

  test('teams tab schedules roster hydration after the first cold render', () => {
    const container = { innerHTML: '' };
    global.document = { getElementById: id => (id === 'tournament-content' ? container : null) };
    global.ApiService = {
      getCurrentUser: () => ({ uid: 'player_uid', role: 'user', teamIds: ['tm_guest'] }),
      getTeam: () => ({ id: 'tm_guest' }),
      getFriendlyTournamentRecord: () => ({ id: 'ct_test', hostTeamId: 'tm_host' }),
      getTournament: jest.fn(),
    };
    global.TOURNAMENT_STATUS = { REG_OPEN: 'open' };
    global.App = {
      currentTournament: 'ct_test',
      renderRegisterButton: jest.fn(),
      renderTournamentTab: jest.fn(),
      _isFriendlyTournamentRecord: jest.fn(() => true),
      _getFriendlyTournamentState: jest.fn(() => ({
        tournament: { id: 'ct_test', hostTeamId: 'tm_host' },
        rosterHydrated: false,
        applications: [],
        entries: [{ teamId: 'tm_guest', teamName: 'Guest Team', entryStatus: 'approved', memberRoster: [] }],
      })),
      _canManageTournamentRecord: jest.fn(() => false),
      _isTournamentGlobalAdmin: jest.fn(() => false),
      _getFriendlyTournamentTeamLimit: jest.fn(() => 4),
      _getFriendlyTournamentVisibleApplications: jest.fn(() => []),
      _getFriendlyTournamentRegisteredTeamIdsFromEntries: jest.fn(entries => entries.map(entry => entry.teamId)),
      _getUserTeamIds: jest.fn(user => user?.teamIds || []),
      _isTournamentTeamOfficerForTeam: jest.fn(() => false),
      getTournamentStatus: jest.fn(() => 'open'),
      _ensureFriendlyTournamentRosterHydratedForRender: jest.fn(),
    };
    require('../../js/modules/tournament/tournament-friendly-detail-view.js');

    global.App.renderTournamentTab('teams');

    expect(container.innerHTML).toContain('tfd-roster-loading-btn');
    expect(global.App._ensureFriendlyTournamentRosterHydratedForRender).toHaveBeenCalledWith('ct_test');
  });

  test('roster hydration marks detail state ready and merges member subcollections', async () => {
    const state = {
      tournament: { id: 'ct_test', hostTeamId: 'tm_host' },
      rosterHydrated: false,
      applications: [],
      entries: [{ teamId: 'tm_guest', teamName: 'Guest Team', entryStatus: 'approved', memberRoster: [] }],
    };
    global.ApiService = {
      getCurrentUser: () => ({ uid: 'player_uid', role: 'user' }),
      listTournamentEntryMembers: jest.fn().mockResolvedValue([{ uid: 'player_uid', name: 'Player' }]),
    };
    global.App = {
      showTournamentDetail: jest.fn(),
      renderRegisterButton: jest.fn(),
      _friendlyTournamentDetailStateById: {},
      _getFriendlyTournamentState: jest.fn(() => state),
      _isFriendlyTournamentRecord: jest.fn(() => true),
      _buildFriendlyTournamentRosterMemberRecord: member => ({
        uid: String(member.uid || ''),
        name: String(member.name || ''),
        jerseyNumber: String(member.jerseyNumber || ''),
        joinedAt: member.joinedAt || null,
      }),
      _buildFriendlyTournamentEntryRecord: entry => ({
        ...entry,
        memberRoster: (entry.memberRoster || []).map(member => ({
          uid: String(member.uid || ''),
          name: String(member.name || ''),
          jerseyNumber: String(member.jerseyNumber || ''),
          joinedAt: member.joinedAt || null,
        })),
      }),
      _buildFriendlyTournamentRecord: tournament => ({ ...tournament }),
      _syncFriendlyTournamentCacheRecord: jest.fn(),
    };
    require('../../js/modules/tournament/tournament-friendly-roster.js');

    const nextState = await global.App._hydrateFriendlyTournamentRosterState('ct_test');

    expect(nextState.rosterHydrated).toBe(true);
    expect(nextState.entries[0].memberRoster).toEqual([{ uid: 'player_uid', name: 'Player', jerseyNumber: '', joinedAt: null }]);
    expect(global.App._friendlyTournamentDetailStateById.ct_test).toBe(nextState);
  });

  test('keeps roster action on team rows even for tournament managers who belong to that team', () => {
    global.ApiService = {
      getCurrentUser: () => ({ uid: 'manager_uid', role: 'user', teamIds: ['tm_guest'] }),
      getTeam: () => ({ id: 'tm_guest' }),
    };
    global.TOURNAMENT_STATUS = { REG_OPEN: 'open' };
    global.App._canManageTournamentRecord = jest.fn(() => true);
    global.App._getUserTeamIds = jest.fn(user => user?.teamIds || []);
    global.App._isTournamentTeamOfficerForTeam = jest.fn(() => true);
    global.App.getTournamentStatus = jest.fn(() => 'open');
    require('../../js/modules/tournament/tournament-friendly-detail-view.js');

    const html = global.App._renderFriendlyTournamentTeamsTab({
      tournament: { id: 'ct_test', hostTeamId: 'tm_host' },
      entries: [
        { teamId: 'tm_guest', teamName: 'Guest Team', entryStatus: 'approved', memberRoster: [] },
      ],
      applications: [],
    });

    expect(html).toContain('tfd-roster-join-btn');
    expect(html).toContain('tfd-entry-remove-btn');
    expect(html).toContain("return App.joinFriendlyTournamentRoster('ct_test','tm_guest', this)");
  });

  test('team officers open roster management from their friendly tournament club card', () => {
    global.ApiService = {
      getCurrentUser: () => ({ uid: 'manager_uid', role: 'user', teamIds: ['tm_guest'] }),
      getTeam: teamId => ({ id: teamId, captainUid: 'manager_uid', members: 12 }),
    };
    global.TOURNAMENT_STATUS = { REG_OPEN: 'open' };
    global.App._canManageTournamentRecord = jest.fn(() => false);
    global.App._getUserTeamIds = jest.fn(user => user?.teamIds || []);
    global.App._isTournamentTeamOfficerForTeam = jest.fn((team, user) => team?.captainUid === user?.uid);
    global.App._displayNameOrUidFallback = jest.fn((name, uid, fallback) => name || uid || fallback);
    global.App.getTournamentStatus = jest.fn(() => 'open');
    require('../../js/modules/tournament/tournament-friendly-detail-view.js');

    const html = global.App._renderFriendlyTournamentTeamsTab({
      tournament: { id: 'ct_test', hostTeamId: 'tm_host' },
      rosterHydrated: true,
      entries: [
        {
          teamId: 'tm_guest',
          teamName: 'Guest Team',
          entryStatus: 'approved',
          memberRoster: [{ uid: 'player_uid', name: 'AAA', jerseyNumber: '11' }],
        },
      ],
      applications: [],
    });

    expect(html).toContain('球員 1/12');
    expect(html).toContain('tfd-roster-list-btn');
    expect(html).toContain('管理名單');
    expect(html).toContain("return App.openFriendlyTournamentRosterList('ct_test','tm_guest')");
    expect(html).not.toContain('11-AAA');
    expect(html).not.toContain('tfd-jersey-btn');
  });

  test('non-officers only see roster list entry from friendly tournament club cards', () => {
    global.ApiService = {
      getCurrentUser: () => ({ uid: 'viewer_uid', role: 'user', teamIds: [] }),
      getTeam: teamId => ({ id: teamId, captainUid: 'manager_uid', members: 12 }),
    };
    global.TOURNAMENT_STATUS = { REG_OPEN: 'open' };
    global.App._canManageTournamentRecord = jest.fn(() => false);
    global.App._getUserTeamIds = jest.fn(user => user?.teamIds || []);
    global.App._isTournamentTeamOfficerForTeam = jest.fn(() => false);
    global.App._displayNameOrUidFallback = jest.fn((name, uid, fallback) => name || uid || fallback);
    global.App.getTournamentStatus = jest.fn(() => 'open');
    require('../../js/modules/tournament/tournament-friendly-detail-view.js');

    const html = global.App._renderFriendlyTournamentTeamsTab({
      tournament: { id: 'ct_test', hostTeamId: 'tm_host' },
      rosterHydrated: true,
      entries: [
        {
          teamId: 'tm_guest',
          teamName: 'Guest Team',
          entryStatus: 'approved',
          memberRoster: [{ uid: 'player_uid', name: 'AAA', jerseyNumber: '11' }],
        },
      ],
      applications: [],
    });

    expect(html).toContain('球員 1/12');
    expect(html).toContain('球員名單');
    expect(html).not.toContain('tfd-jersey-btn');
    expect(html).not.toContain('promptFriendlyTournamentMemberJersey');
  });

  test('roster list modal shows roster fields and officer edit controls', () => {
    const body = { innerHTML: '' };
    const title = { textContent: '' };
    const state = {
      entries: [
        {
          teamId: 'tm_guest',
          teamName: 'Guest Team',
          memberRoster: [{ uid: 'player_uid', name: 'AAA', jerseyNumber: '11', position: 'FW', note: 'captain' }],
        },
      ],
    };
    global.document = {
      getElementById: jest.fn(id => ({ 'friendly-roster-list-body': body, 'friendly-roster-list-title': title }[id] || null)),
    };
    global.ApiService = {
      getCurrentUser: () => ({ uid: 'manager_uid' }),
      getTeam: () => ({ id: 'tm_guest', captainUid: 'manager_uid', members: 12 }),
    };
    global.App._getFriendlyTournamentState = jest.fn(() => state);
    global.App._isTournamentTeamOfficerForTeam = jest.fn((team, user) => team?.captainUid === user?.uid);
    global.App._displayNameOrUidFallback = jest.fn((name, uid, fallback) => name || uid || fallback);
    require('../../js/modules/tournament/tournament-friendly-detail-view.js');

    global.App._friendlyTournamentRosterListState = { tournamentId: 'ct_test', teamId: 'tm_guest', editingUid: null };
    global.App._renderFriendlyTournamentRosterListModal();

    expect(title.textContent).toBe('Guest Team 參賽球員名單');
    expect(body.innerHTML).toContain('參賽 / 俱樂部球員：1/12');
    expect(body.innerHTML).toContain('11');
    expect(body.innerHTML).toContain('AAA');
    expect(body.innerHTML).toContain('FW');
    expect(body.innerHTML).toContain('captain');
    expect(body.innerHTML).toContain('editFriendlyTournamentRosterMember');
    expect(body.innerHTML).toContain('deleteFriendlyTournamentRosterMember');
  });

  test('saving roster member profile persists jersey position and note', async () => {
    const state = {
      entries: [
        {
          teamId: 'tm_guest',
          teamName: 'Guest Team',
          memberRoster: [{ uid: 'player_uid', name: 'AAA', jerseyNumber: '11', position: '', note: '' }],
        },
      ],
    };
    const inputs = {
      'tfd-roster-jersey-player_uid': { value: '07' },
      'tfd-roster-position-player_uid': { value: '前鋒' },
      'tfd-roster-note-player_uid': { value: '左腳' },
      'friendly-roster-list-body': { innerHTML: '' },
      'friendly-roster-list-title': { textContent: '' },
    };
    global.document = { getElementById: jest.fn(id => inputs[id] || null) };
    global.ApiService = {
      getCurrentUser: () => ({ uid: 'manager_uid' }),
      getTeam: () => ({ id: 'tm_guest', captainUid: 'manager_uid' }),
      updateTournamentEntryMemberProfile: jest.fn().mockResolvedValue(),
    };
    global.App._getFriendlyTournamentState = jest.fn(() => state);
    global.App._hydrateFriendlyTournamentRosterState = jest.fn().mockResolvedValue(state);
    global.App._refreshFriendlyTournamentRosterUi = jest.fn();
    global.App._isTournamentTeamOfficerForTeam = jest.fn((team, user) => team?.captainUid === user?.uid);
    global.App.showToast = jest.fn();
    global.App._showTournamentActionError = jest.fn();
    require('../../js/modules/tournament/tournament-friendly-detail-view.js');
    global.App._friendlyTournamentRosterListState = { tournamentId: 'ct_test', teamId: 'tm_guest', editingUid: 'player_uid' };

    await global.App.saveFriendlyTournamentRosterMemberProfile('ct_test', 'tm_guest', 'player_uid');

    expect(global.ApiService.updateTournamentEntryMemberProfile).toHaveBeenCalledWith('ct_test', 'tm_guest', 'player_uid', expect.objectContaining({
      jerseyNumber: '07',
      position: '前鋒',
      note: '左腳',
    }));
    expect(global.App._refreshFriendlyTournamentRosterUi).toHaveBeenCalledWith('ct_test');
  });

  test('deleting roster member asks confirmation before removal', async () => {
    const state = {
      entries: [
        {
          teamId: 'tm_guest',
          teamName: 'Guest Team',
          memberRoster: [{ uid: 'player_uid', name: 'AAA', jerseyNumber: '11' }],
        },
      ],
    };
    global.document = {
      getElementById: jest.fn(id => ({ 'friendly-roster-list-body': { innerHTML: '' }, 'friendly-roster-list-title': { textContent: '' } }[id] || null)),
    };
    global.ApiService = {
      getCurrentUser: () => ({ uid: 'manager_uid' }),
      getTeam: () => ({ id: 'tm_guest', captainUid: 'manager_uid' }),
      removeTournamentEntryMember: jest.fn().mockResolvedValue(),
    };
    global.App._getFriendlyTournamentState = jest.fn(() => state);
    global.App._hydrateFriendlyTournamentRosterState = jest.fn().mockResolvedValue(state);
    global.App._refreshFriendlyTournamentRosterUi = jest.fn();
    global.App._isTournamentTeamOfficerForTeam = jest.fn((team, user) => team?.captainUid === user?.uid);
    global.App._displayNameOrUidFallback = jest.fn((name, uid, fallback) => name || uid || fallback);
    global.App.appConfirm = jest.fn().mockResolvedValue(true);
    global.App.showToast = jest.fn();
    global.App._showTournamentActionError = jest.fn();
    require('../../js/modules/tournament/tournament-friendly-detail-view.js');
    global.App._friendlyTournamentRosterListState = { tournamentId: 'ct_test', teamId: 'tm_guest', editingUid: null };

    await global.App.deleteFriendlyTournamentRosterMember('ct_test', 'tm_guest', 'player_uid');

    expect(global.App.appConfirm).toHaveBeenCalledWith(expect.stringContaining('確認後無法還原'));
    expect(global.ApiService.removeTournamentEntryMember).toHaveBeenCalledWith('ct_test', 'tm_guest', 'player_uid');
    expect(global.App._refreshFriendlyTournamentRosterUi).toHaveBeenCalledWith('ct_test');
  });

  test('promptFriendlyTournamentMemberJersey saves a sanitized jersey number', async () => {
    const state = {
      tournament: { id: 'ct_test', hostTeamId: 'tm_host' },
      entries: [
        {
          teamId: 'tm_guest',
          teamName: 'Guest Team',
          memberRoster: [{ uid: 'player_uid', name: 'AAA', jerseyNumber: '' }],
        },
      ],
    };
    global.ApiService = {
      getCurrentUser: () => ({ uid: 'manager_uid', role: 'user' }),
      getTeam: teamId => ({ id: teamId, captainUid: 'manager_uid' }),
      updateTournamentEntryMemberJersey: jest.fn().mockResolvedValue(),
    };
    global.window = global.window || {};
    global.window.prompt = jest.fn(() => '07');
    global.App._hydrateFriendlyTournamentRosterState = jest.fn().mockResolvedValue(state);
    global.App._refreshFriendlyTournamentRosterUi = jest.fn();
    global.App._isTournamentTeamOfficerForTeam = jest.fn((team, user) => team?.captainUid === user?.uid);
    global.App.showToast = jest.fn();
    global.App._showTournamentActionError = jest.fn();
    require('../../js/modules/tournament/tournament-friendly-detail-view.js');

    await global.App.promptFriendlyTournamentMemberJersey('ct_test', 'tm_guest', 'player_uid');

    expect(global.ApiService.updateTournamentEntryMemberJersey).toHaveBeenCalledWith('ct_test', 'tm_guest', 'player_uid', '07');
    expect(global.App._refreshFriendlyTournamentRosterUi).toHaveBeenCalledWith('ct_test');
    expect(global.App.showToast).toHaveBeenCalled();
  });

  test('keeps roster join visible but blocked when player already joined another team', () => {
    global.ApiService = {
      getCurrentUser: () => ({ uid: 'player_uid', role: 'user', teamIds: ['tm_alpha', 'tm_beta'] }),
      getTeam: teamId => ({ id: teamId }),
    };
    global.TOURNAMENT_STATUS = { REG_OPEN: 'open' };
    global.App._canManageTournamentRecord = jest.fn(() => false);
    global.App._getUserTeamIds = jest.fn(user => user?.teamIds || []);
    global.App._isTournamentTeamOfficerForTeam = jest.fn(() => false);
    global.App.getTournamentStatus = jest.fn(() => 'open');
    require('../../js/modules/tournament/tournament-friendly-detail-view.js');

    const html = global.App._renderFriendlyTournamentTeamsTab({
      tournament: { id: 'ct_test', hostTeamId: 'tm_host' },
      entries: [
        {
          teamId: 'tm_alpha',
          teamName: 'Alpha Team',
          entryStatus: 'approved',
          memberRoster: [{ uid: 'player_uid', name: 'Player' }],
        },
        { teamId: 'tm_beta', teamName: 'Beta Team', entryStatus: 'approved', memberRoster: [] },
      ],
      applications: [],
    });

    expect(html).toContain('tfd-roster-leave-btn');
    expect(html).toContain('tfd-roster-blocked-btn');
    expect(html).toContain('你已有參賽隊伍');
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
    expect(html).toContain('<div class="tfd-team-status">審核中(僅自己與主辦能見)</div>');
    expect(html).not.toContain('僅主辦方與申請方可見');
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

  test('admin apply context is limited to joined and officer clubs, not all loaded clubs', () => {
    const tournament = { id: 'ct_test', hostTeamId: 'tm_host', sportTag: 'football' };
    const adminUser = { uid: 'admin_uid', role: 'admin', teamIds: ['tm_alpha', 'tm_beta', 'tm_approved'] };
    const teams = [
      { id: 'tm_host', name: 'Host', sportTag: 'football' },
      { id: 'tm_alpha', name: 'Alpha Club', sportTag: 'football' },
      { id: 'tm_beta', name: 'Beta Club', sportTag: 'football' },
      { id: 'tm_approved', name: 'Approved Club', sportTag: 'football' },
      { id: 'tm_admin_officer', name: 'Admin Officer Club', ownerUid: 'admin_uid', sportTag: 'football' },
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
      _getFriendlyResponsibleTeams: jest.fn(() => [teams[4]]),
      _getUserTeamIds: jest.fn(user => user?.teamIds || []),
    };
    require('../../js/modules/tournament/tournament-friendly-apply-state.js');

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

    expect(ctx.availableTeams.map(team => team.id)).toEqual(['tm_admin_officer', 'tm_alpha']);
    expect(ctx.pendingTeams.map(team => team.teamId)).toEqual(['tm_beta']);
    expect(ctx.approvedTeams.map(team => team.teamId)).toEqual(['tm_approved']);
    expect(ctx.approvedTeams.map(team => team.teamId)).not.toContain('tm_host');
    expect(ctx.pendingTeams.map(team => team.teamId)).not.toContain('tm_stranger');
    expect(ctx.approvedTeams.map(team => team.teamId)).not.toContain('tm_stranger_approved');
  });

  test('apply context sorts managed clubs by team officer role and excludes coaches', () => {
    const user = { uid: 'staff_uid', role: 'user' };
    const teams = [
      { id: 'tm_leader', name: 'Leader Club', leaderUids: ['staff_uid'], sportTag: 'football' },
      { id: 'tm_coach', name: 'Coach Club', coachUids: ['staff_uid'], sportTag: 'football' },
      { id: 'tm_captain', name: 'Captain Club', captainUid: 'staff_uid', sportTag: 'football' },
      { id: 'tm_owner', name: 'Owner Club', ownerUid: 'staff_uid', sportTag: 'football' },
      { id: 'tm_creator', name: 'Creator Club', creatorUid: 'staff_uid', sportTag: 'football' },
    ];
    const isOfficer = (team, item) => {
      const uid = item?.uid;
      return team?.captainUid === uid
        || team?.creatorUid === uid
        || team?.ownerUid === uid
        || team?.leaderUid === uid
        || (Array.isArray(team?.leaderUids) && team.leaderUids.includes(uid));
    };
    global.ApiService = {
      getCurrentUser: () => user,
      getTeams: () => teams,
      getTeam: teamId => teams.find(team => team.id === teamId) || null,
    };
    global.App = {
      _isTournamentGlobalAdmin: jest.fn(() => false),
      _getFriendlyResponsibleTeams: jest.fn(item => teams.filter(team => isOfficer(team, item))),
      _getUserTeamIds: jest.fn(() => []),
      _isTournamentTeamOfficerForTeam: jest.fn(isOfficer),
    };
    require('../../js/modules/tournament/tournament-friendly-apply-state.js');

    const ctx = global.App._getFriendlyTournamentApplyContext({
      id: 'ct_test',
      hostTeamId: 'tm_host',
      sportTag: 'football',
    }, { applications: [], entries: [] }, user);

    expect(global.App._getFriendlyTournamentTeamOfficerRoleLevel(teams[0], user)).toBe(2);
    expect(global.App._getFriendlyTournamentTeamOfficerRoleLevel(teams[1], user)).toBe(0);
    expect(global.App._getFriendlyTournamentTeamOfficerRoleLevel(teams[2], user)).toBe(3);
    expect(ctx.availableTeams.map(team => team.id)).toEqual(['tm_captain', 'tm_owner', 'tm_creator', 'tm_leader']);
    expect(ctx.availableTeams.map(team => team.id)).not.toContain('tm_coach');
  });
  test('non-admin apply context uses hydrated joined officer clubs when teams list is cold', () => {
    const user = { uid: 'cap_uid', role: 'user', teamIds: ['tm_joined'] };
    const joinedTeam = { id: 'tm_joined', name: 'Joined Club', captainUid: 'cap_uid', sportTag: 'football' };
    global.ApiService = {
      getCurrentUser: () => user,
      getTeams: () => [],
      getTeam: teamId => (teamId === 'tm_joined' ? joinedTeam : null),
    };
    global.App = {
      _isTournamentGlobalAdmin: jest.fn(() => false),
      _getFriendlyResponsibleTeams: jest.fn(() => []),
      _getUserTeamIds: jest.fn(item => item?.teamIds || []),
      _isTournamentTeamOfficerForTeam: jest.fn((team, item) => team?.captainUid === item?.uid),
    };
    require('../../js/modules/tournament/tournament-friendly-apply-state.js');

    const ctx = global.App._getFriendlyTournamentApplyContext({
      id: 'ct_test',
      hostTeamId: 'tm_host',
      sportTag: 'football',
    }, { applications: [], entries: [] }, user);

    expect(ctx.availableTeams.map(team => team.id)).toEqual(['tm_joined']);
    expect(global.App._getFriendlyResponsibleTeams).toHaveBeenCalled();
  });

  test('apply context keeps different-sport clubs visible but disabled', () => {
    const user = { uid: 'cap_uid', role: 'user' };
    const teams = [
      { id: 'tm_football', name: 'Football Club', captainUid: 'cap_uid', sportTag: 'football' },
      { id: 'tm_basket', name: 'Basket Club', captainUid: 'cap_uid', sportTag: 'basketball' },
      { id: 'tm_unknown', name: 'No Sport Club', captainUid: 'cap_uid' },
    ];
    global.ApiService = {
      getCurrentUser: () => user,
      getTeams: () => teams,
      getTeam: teamId => teams.find(team => team.id === teamId) || null,
    };
    global.App = {
      _isTournamentGlobalAdmin: jest.fn(() => false),
      _getFriendlyResponsibleTeams: jest.fn(() => teams),
      _getUserTeamIds: jest.fn(() => []),
      _isTournamentTeamOfficerForTeam: jest.fn((team, item) => team?.captainUid === item?.uid),
    };
    require('../../js/modules/tournament/tournament-friendly-apply-state.js');

    const ctx = global.App._getFriendlyTournamentApplyContext({
      id: 'ct_test',
      hostTeamId: 'tm_host',
      sportTag: 'football',
    }, { applications: [], entries: [] }, user);

    expect(ctx.availableTeams.map(team => team.id)).toEqual(['tm_football']);
    expect(ctx.blockedTeams.map(team => team.id)).toEqual(['tm_basket', 'tm_unknown']);

    global.App.renderRegisterButton = jest.fn();
    global.App.renderTournamentTab = jest.fn();
    require('../../js/modules/tournament/tournament-friendly-detail-view.js');
    const actionTeams = global.App._getFriendlyTournamentActionTeams(ctx);
    const blocked = actionTeams.filter(team => team.status === 'sport-mismatch');
    expect(blocked).toHaveLength(2);
    expect(blocked.every(team => team.disabled)).toBe(true);
    expect(global.App._buildFriendlyTournamentActionTeamSelector('ct_test', actionTeams, 'tm_basket'))
      .toContain('disabled');
    expect(global.App._buildFriendlyTournamentActionTeamSelector('ct_test', actionTeams, 'tm_basket'))
      .toContain('非本類賽事運動');
  });

  test('non-admin apply context treats approved officer entry as own status without user teamIds', () => {
    const user = { uid: 'cap_uid', role: 'user' };
    const officerTeam = { id: 'tm_approved', name: 'Approved Club', captainUid: 'cap_uid', sportTag: 'football' };
    global.ApiService = {
      getCurrentUser: () => user,
      getTeams: () => [officerTeam],
      getTeam: teamId => (teamId === 'tm_approved' ? officerTeam : null),
    };
    global.App = {
      _isTournamentGlobalAdmin: jest.fn(() => false),
      _getFriendlyResponsibleTeams: jest.fn(() => [officerTeam]),
      _getUserTeamIds: jest.fn(() => []),
      _isTournamentTeamOfficerForTeam: jest.fn((team, item) => team?.captainUid === item?.uid),
    };
    require('../../js/modules/tournament/tournament-friendly-apply-state.js');

    const ctx = global.App._getFriendlyTournamentApplyContext({
      id: 'ct_test',
      hostTeamId: 'tm_host',
      sportTag: 'football',
    }, {
      applications: [],
      entries: [{ teamId: 'tm_approved', teamName: 'Approved Club', entryStatus: 'approved' }],
    }, user);

    expect(ctx.availableTeams.map(team => team.id)).toEqual([]);
    expect(ctx.approvedTeams.map(team => team.teamId)).toEqual(['tm_approved']);
  });

  test('removed and rejected application docs do not block eligible teams from re-applying', () => {
    const user = { uid: 'cap_uid', role: 'user' };
    const teams = [
      { id: 'tm_removed', name: 'Removed Club', captainUid: 'cap_uid', sportTag: 'football' },
      { id: 'tm_rejected', name: 'Rejected Club', captainUid: 'cap_uid', sportTag: 'football' },
    ];
    global.ApiService = {
      getCurrentUser: () => user,
      getTeams: () => teams,
      getTeam: teamId => teams.find(team => team.id === teamId) || null,
    };
    global.App = {
      _isTournamentGlobalAdmin: jest.fn(() => false),
      _getFriendlyResponsibleTeams: jest.fn(() => teams),
      _getUserTeamIds: jest.fn(() => []),
      _isTournamentTeamOfficerForTeam: jest.fn((team, item) => team?.captainUid === item?.uid),
    };
    require('../../js/modules/tournament/tournament-friendly-apply-state.js');

    const ctx = global.App._getFriendlyTournamentApplyContext({
      id: 'ct_test',
      hostTeamId: 'tm_host',
      sportTag: 'football',
    }, {
      applications: [
        { teamId: 'tm_removed', teamName: 'Removed Club', status: 'removed' },
        { teamId: 'tm_rejected', teamName: 'Rejected Club', status: 'rejected' },
      ],
      entries: [],
    }, user);

    expect(ctx.availableTeams.map(team => team.id)).toEqual(['tm_removed', 'tm_rejected']);
    expect(ctx.availableTeams.every(team => team.hasPriorRejectedApplication)).toBe(true);
  });

  test('deduplicates rejected application aliases into one re-applyable club option', () => {
    const user = { uid: 'cap_uid', role: 'user', teamIds: ['legacy_doc'] };
    const team = {
      id: 'tm_current',
      _docId: 'legacy_doc',
      name: '台中星期二足球俱樂部',
      captainUid: 'cap_uid',
      sportTag: 'football',
    };
    global.ApiService = {
      getCurrentUser: () => user,
      getTeams: () => [team],
      getTeam: teamId => (teamId === 'tm_current' || teamId === 'legacy_doc' ? team : null),
    };
    global.App = {
      _isTournamentGlobalAdmin: jest.fn(() => false),
      _getFriendlyResponsibleTeams: jest.fn(() => [team]),
      _getUserTeamIds: jest.fn(item => item?.teamIds || []),
      _isTournamentTeamOfficerForTeam: jest.fn((item, currentUser) => item?.captainUid === currentUser?.uid),
    };
    require('../../js/modules/tournament/tournament-friendly-apply-state.js');

    const ctx = global.App._getFriendlyTournamentApplyContext({
      id: 'ct_test',
      hostTeamId: 'tm_host',
      sportTag: 'football',
    }, {
      applications: [
        {
          id: 'ta_legacy_doc',
          teamId: 'legacy_doc',
          teamName: '台中星期二足球俱樂部',
          status: 'rejected',
        },
      ],
      entries: [],
    }, user);

    expect(ctx.availableTeams).toHaveLength(1);
    expect(ctx.availableTeams[0].id).toBe('legacy_doc');
    expect(ctx.availableTeams[0].canonicalTeamId).toBe('tm_current');
    expect(ctx.availableTeams[0].hasPriorRejectedApplication).toBe(true);
    expect(ctx.rejectedTeams).toHaveLength(0);

    global.App.renderRegisterButton = jest.fn();
    global.App.renderTournamentTab = jest.fn();
    require('../../js/modules/tournament/tournament-friendly-detail-view.js');
    const actionTeams = global.App._getFriendlyTournamentActionTeams({
      availableTeams: ctx.availableTeams,
      pendingTeams: [],
      approvedTeams: [],
      rejectedTeams: [{ teamId: 'legacy_doc', canonicalTeamId: 'tm_current', teamName: '台中星期二足球俱樂部', status: 'rejected' }],
    });
    expect(actionTeams).toHaveLength(1);
    expect(actionTeams[0].status).toBe('available');
  });

  test('loads joined team docs for non-admin apply selector on cold detail refresh', async () => {
    const user = { uid: 'cap_uid', role: 'user', teamIds: ['tm_joined'] };
    const loadedTeams = {};
    global.ApiService = {
      getCurrentUser: () => user,
      getTeams: () => Object.values(loadedTeams),
      getTeam: teamId => loadedTeams[teamId] || null,
      getTeamAsync: jest.fn(async teamId => {
        loadedTeams[teamId] = { id: teamId, name: 'Joined Club', captainUid: 'cap_uid' };
        return loadedTeams[teamId];
      }),
    };
    global.App = {
      _isTournamentGlobalAdmin: jest.fn(() => false),
      _getFriendlyResponsibleTeams: jest.fn(item =>
        Object.values(loadedTeams).filter(team => team.captainUid === item?.uid)
      ),
      _getUserTeamIds: jest.fn(item => item?.teamIds || []),
      _isTournamentTeamOfficerForTeam: jest.fn((team, item) => team?.captainUid === item?.uid),
    };
    require('../../js/modules/tournament/tournament-friendly-apply-state.js');

    const teams = await global.App._ensureFriendlyTournamentApplyTeamsLoaded(user);

    expect(global.ApiService.getTeamAsync).toHaveBeenCalledWith('tm_joined');
    expect(teams.map(team => team.id)).toEqual(['tm_joined']);
  });

  test('loads team collection for admin apply selector even when joined clubs are already cached', async () => {
    const user = { uid: 'admin_uid', role: 'super_admin', teamIds: ['tm_joined'] };
    let teamsCache = [{ id: 'tm_joined', name: 'Joined Club' }];
    global.ApiService = {
      getCurrentUser: () => user,
      getTeams: () => teamsCache,
      getTeam: teamId => teamsCache.find(team => team.id === teamId) || null,
    };
    global.FirebaseService = {
      ensureStaticCollectionsLoaded: jest.fn(async () => {
        teamsCache = [
          { id: 'tm_joined', name: 'Joined Club' },
          { id: 'tm_officer', name: 'Officer Club', ownerUid: 'admin_uid' },
        ];
        return ['teams'];
      }),
    };
    global.App = {
      _isTournamentGlobalAdmin: jest.fn(() => true),
      _getFriendlyResponsibleTeams: jest.fn(item =>
        teamsCache.filter(team => team.ownerUid === item?.uid)
      ),
      _getUserTeamIds: jest.fn(item => item?.teamIds || []),
      _isTournamentTeamOfficerForTeam: jest.fn((team, item) => team?.ownerUid === item?.uid),
    };
    require('../../js/modules/tournament/tournament-friendly-apply-state.js');

    const teams = await global.App._ensureFriendlyTournamentApplyTeamsLoaded(user);

    expect(global.FirebaseService.ensureStaticCollectionsLoaded).toHaveBeenCalledWith(['teams']);
    expect(teams.map(team => team.id)).toEqual(['tm_officer', 'tm_joined']);
  });

  test('forces a teams refresh when cold cache has no eligible apply teams', async () => {
    const user = { uid: 'cap_uid', role: 'user' };
    let teamsCache = [];
    global.ApiService = {
      getCurrentUser: () => user,
      getTeams: () => teamsCache,
      getTeam: teamId => teamsCache.find(team => team.id === teamId) || null,
    };
    global.FirebaseService = {
      ensureStaticCollectionsLoaded: jest.fn(async () => []),
      refreshCollectionsForPage: jest.fn(async () => {
        teamsCache = [{ id: 'tm_staff', name: 'Staff Club', captainUid: 'cap_uid' }];
        return ['teams'];
      }),
    };
    global.App = {
      _isTournamentGlobalAdmin: jest.fn(() => false),
      _getFriendlyResponsibleTeams: jest.fn(item =>
        teamsCache.filter(team => team.captainUid === item?.uid)
      ),
      _getUserTeamIds: jest.fn(() => []),
      _isTournamentTeamOfficerForTeam: jest.fn((team, item) => team?.captainUid === item?.uid),
    };
    require('../../js/modules/tournament/tournament-friendly-apply-state.js');

    const teams = await global.App._ensureFriendlyTournamentApplyTeamsLoaded(user);

    expect(global.FirebaseService.ensureStaticCollectionsLoaded).toHaveBeenCalledWith(['teams']);
    expect(global.FirebaseService.refreshCollectionsForPage).toHaveBeenCalledWith('page-teams');
    expect(teams.map(team => team.id)).toEqual(['tm_staff']);
  });

  test('renders own approved club status and selector after cold detail refresh', () => {
    const user = { uid: 'guest_cap', role: 'user' };
    const team = { id: 'tm_approved', name: 'Approved Team', captainUid: 'guest_cap', sportTag: 'football' };
    const area = { innerHTML: '' };
    global.document = { getElementById: id => (id === 'td-register-area' ? area : null) };
    global.TOURNAMENT_STATUS = { PREPARING: 'preparing', REG_OPEN: 'open', REG_CLOSED: 'closed' };
    global.ApiService = {
      getCurrentUser: () => user,
      getTeams: () => [team],
      getTeam: teamId => (teamId === 'tm_approved' ? team : null),
    };
    global.App = {
      renderRegisterButton: jest.fn(),
      renderTournamentTab: jest.fn(),
      _isFriendlyTournamentRecord: jest.fn(() => true),
      _getFriendlyTournamentState: jest.fn(() => ({
        tournament: { id: 'ct_test', hostTeamId: 'tm_host', sportTag: 'football' },
        applications: [],
        entries: [{ teamId: 'tm_approved', teamName: 'Approved Team', entryStatus: 'approved' }],
      })),
      _getFriendlyTournamentTeamLimit: jest.fn(() => 4),
      _isTournamentGlobalAdmin: jest.fn(() => false),
      _getFriendlyResponsibleTeams: jest.fn(() => [team]),
      _getUserTeamIds: jest.fn(() => []),
      _isTournamentTeamOfficerForTeam: jest.fn((item, currentUser) => item?.captainUid === currentUser?.uid),
      getTournamentStatus: jest.fn(() => 'open'),
      isTournamentEnded: jest.fn(() => false),
    };
    require('../../js/modules/tournament/tournament-friendly-apply-state.js');
    require('../../js/modules/tournament/tournament-friendly-detail-view.js');

    global.App.renderRegisterButton({ id: 'ct_test', hostTeamId: 'tm_host', sportTag: 'football' });

    expect(area.innerHTML).toContain('id="td-apply-team-select"');
    expect(area.innerHTML).toContain('value="tm_approved" selected');
    expect(area.innerHTML).toContain('data-friendly-team-action-status="approved"');
    expect(area.innerHTML).toContain('俱樂部已通過審核');
    expect(area.innerHTML).not.toContain('joinFriendlyTournamentRoster');
    expect(area.innerHTML).toContain("return App.withdrawFriendlyTournamentTeam('ct_test','tm_approved', this)");
    expect(area.innerHTML).not.toContain("return App.registerTournament('ct_test', this)");
  });

  test('renders a friendly detail loading shell before async state resolves', () => {
    const nodes = {
      'td-img-placeholder': { innerHTML: '', textContent: '', style: {} },
      'td-title': { innerHTML: '' },
      'td-register-area': { innerHTML: '' },
      'td-info-section': { innerHTML: '' },
      'tournament-content': { innerHTML: '' },
    };
    const tabs = [
      { dataset: { ttab: 'info' }, classList: { toggle: jest.fn() } },
      { dataset: { ttab: 'teams' }, classList: { toggle: jest.fn() } },
    ];
    global.document = {
      getElementById: id => nodes[id] || null,
      querySelectorAll: selector => (selector === '#td-tabs .tab' ? tabs : []),
    };
    global.App = {
      showTournamentDetail: jest.fn(),
      renderRegisterButton: jest.fn(),
      registerTournament: jest.fn(),
      renderTournamentTab: jest.fn(),
      isTournamentFavorited: jest.fn(() => false),
      _favHeartHtml: jest.fn(() => '<button class="fav">fav</button>'),
    };
    require('../../js/modules/tournament/tournament-friendly-detail.js');

    global.App._renderFriendlyTournamentDetailLoadingShell({ id: 'ct_test', name: 'Test Cup' });

    expect(nodes['td-title'].innerHTML).toContain('Test Cup');
    expect(nodes['td-title'].innerHTML).toContain('class="fav"');
    expect(nodes['td-register-area'].innerHTML).toContain('skel-progress-bar');
    expect(nodes['td-info-section'].innerHTML).toContain('tfd-info-skeleton');
    expect(nodes['tournament-content'].innerHTML).toContain('tfd-tab-loading');
    expect(tabs[0].classList.toggle).toHaveBeenCalledWith('active', false);
    expect(tabs[1].classList.toggle).toHaveBeenCalledWith('active', true);
  });

  test('merges friendly tournament realtime entries and members into current detail state', () => {
    global.ApiService = {
      getCurrentUser: () => ({ uid: 'host_uid', role: 'user' }),
      getTeam: () => null,
      getTournament: () => ({ id: 'ct_live', hostTeamId: 'tm_host' }),
      getFriendlyTournamentRecord: () => null,
    };
    global.App = {
      _friendlyTournamentDetailStateById: {
        ct_live: {
          tournament: { id: 'ct_live', hostTeamId: 'tm_host' },
          applications: [],
          entries: [],
          matches: [],
        },
      },
      _buildFriendlyTournamentApplicationRecord: item => ({
        id: item.id || item._docId || item.teamId,
        teamId: item.teamId || '',
        teamName: item.teamName || '',
        status: item.status || 'pending',
        appliedAt: item.appliedAt || '',
      }),
      _buildFriendlyTournamentEntryRecord: item => ({
        teamId: item.teamId || '',
        teamName: item.teamName || '',
        entryStatus: item.entryStatus || 'approved',
        countsTowardLimit: item.countsTowardLimit !== false,
        approvedAt: item.approvedAt || '',
        memberRoster: Array.isArray(item.memberRoster) ? item.memberRoster : [],
      }),
      _buildFriendlyTournamentRosterMemberRecord: item => ({ uid: item.uid || '', name: item.name || '', joinedAt: item.joinedAt || '' }),
      _buildFriendlyTournamentRecord: item => ({ ...item }),
      _buildTournamentMatchRecord: item => ({ id: item.id || item._docId || '', ...item }),
      _getFriendlyTournamentRegisteredTeamIdsFromEntries: entries => entries.map(entry => entry.teamId).filter(Boolean),
      _isTournamentHostParticipating: () => true,
      _canManageTournamentRecord: jest.fn(() => true),
      _isTournamentViewerInTeam: jest.fn(() => true),
      _getFriendlyTournamentState(id) { return this._friendlyTournamentDetailStateById[id] || null; },
      _syncFriendlyTournamentCacheRecord: jest.fn(),
    };
    require('../../js/modules/tournament/tournament-friendly-state.js');

    global.App._friendlyTournamentDetailRealtime = {
      tournamentId: 'ct_live',
      tournament: { id: 'ct_live', hostTeamId: 'tm_host' },
      applicationsById: new Map([['ta_tm_guest', { id: 'ta_tm_guest', teamId: 'tm_guest', teamName: 'Guest', status: 'pending' }]]),
      entriesByTeam: new Map([['tm_guest', { teamId: 'tm_guest', teamName: 'Guest', entryStatus: 'approved' }]]),
      membersByTeam: new Map([['tm_guest', [{ uid: 'player_uid', name: 'Player' }]]]),
      expectedMemberTeamIds: new Set(['tm_guest']),
      applicationsReady: true,
      entriesReady: true,
      unsubs: [],
      memberUnsubs: {},
    };

    const state = global.App._composeFriendlyTournamentRealtimeState('ct_live');

    expect(state.applications).toEqual([expect.objectContaining({ id: 'ta_tm_guest', teamId: 'tm_guest' })]);
    expect(state.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ teamId: 'tm_host', entryStatus: 'host' }),
      expect.objectContaining({ teamId: 'tm_guest', memberRoster: [expect.objectContaining({ uid: 'player_uid' })] }),
    ]));
    expect(state.rosterHydrated).toBe(true);
    expect(global.App._getFriendlyTournamentVisibleApplications(state)).toEqual([]); // stale approved entry application is hidden
    expect(global.App._friendlyTournamentDetailStateById.ct_live).toBe(state);
  });

  test('friendly tournament realtime starts subcollection listeners and cleans them up', async () => {
    const callbacks = { members: {} };
    const unsubs = {
      tournament: jest.fn(),
      applications: jest.fn(),
      entries: jest.fn(),
      matches: jest.fn(),
      memberGuest: jest.fn(),
    };
    const makeDoc = (id, data, exists = true) => ({ id, exists, data: () => data });
    const tournamentRef = {
      onSnapshot: jest.fn((next) => { callbacks.tournament = next; return unsubs.tournament; }),
      collection: jest.fn(name => {
        if (name === 'applications') {
          return {
            onSnapshot: jest.fn((next) => { callbacks.applications = next; return unsubs.applications; }),
          };
        }
        if (name === 'entries') {
          return {
            onSnapshot: jest.fn((next) => { callbacks.entries = next; return unsubs.entries; }),
            doc: teamId => ({
              collection: sub => ({
                onSnapshot: jest.fn((next) => {
                  callbacks.members[teamId] = next;
                  return unsubs.memberGuest;
                }),
              }),
            }),
          };
        }
        if (name === 'matches') {
          return {
            onSnapshot: jest.fn((next) => { callbacks.matches = next; return unsubs.matches; }),
          };
        }
        throw new Error('unexpected collection ' + name);
      }),
    };
    global.FirebaseService = { _getTournamentDocRefById: jest.fn(() => Promise.resolve(tournamentRef)) };
    global.ApiService = {
      getCurrentUser: () => ({ uid: 'host_uid', role: 'user' }),
      getTeam: () => null,
      getTournament: () => ({ id: 'ct_live', hostTeamId: 'tm_host' }),
      getFriendlyTournamentRecord: () => null,
    };
    global.App = {
      _friendlyTournamentDetailStateById: {},
      _canManageTournamentRecord: jest.fn(() => true),
      _getFriendlyTournamentUserActionTeamIds: jest.fn(() => []),
      _buildFriendlyTournamentApplicationRecord: item => ({ id: item.id || item._docId || item.teamId, teamId: item.teamId || '', status: item.status || 'pending' }),
      _buildFriendlyTournamentEntryRecord: item => ({ teamId: item.teamId || '', teamName: item.teamName || '', entryStatus: item.entryStatus || 'approved', memberRoster: Array.isArray(item.memberRoster) ? item.memberRoster : [] }),
      _buildFriendlyTournamentRosterMemberRecord: item => ({ uid: item.uid || '', name: item.name || '' }),
      _buildFriendlyTournamentRecord: item => ({ ...item }),
      _buildTournamentMatchRecord: item => ({ id: item.id || item._docId || '', ...item }),
      _getFriendlyTournamentRegisteredTeamIdsFromEntries: entries => entries.map(entry => entry.teamId).filter(Boolean),
      _isTournamentHostParticipating: () => true,
      _getFriendlyTournamentState(id) { return this._friendlyTournamentDetailStateById[id] || null; },
      _syncFriendlyTournamentCacheRecord: jest.fn(),
    };
    require('../../js/modules/tournament/tournament-friendly-state.js');
    const originalCompose = global.App._composeFriendlyTournamentRealtimeState;
    global.App._scheduleFriendlyTournamentRealtimeRender = jest.fn(function(id) {
      return originalCompose.call(this, id);
    });

    await global.App._startFriendlyTournamentDetailRealtime('ct_live', { tournament: { id: 'ct_live', hostTeamId: 'tm_host' }, applications: [], entries: [] });
    callbacks.tournament(makeDoc('ct_live_doc', { id: 'ct_live', hostTeamId: 'tm_host' }));
    callbacks.applications({ docs: [makeDoc('ta_tm_guest', { teamId: 'tm_guest', status: 'pending' })] });
    callbacks.entries({ docs: [makeDoc('tm_guest', { teamName: 'Guest', entryStatus: 'approved' })] });
    callbacks.matches({ docs: [makeDoc('m1', { stage: 'friendly', homeTeamId: 'tm_host', awayTeamId: 'tm_guest' })] });
    callbacks.members.tm_guest({ docs: [makeDoc('player_uid', { name: 'Player' })] });

    const state = global.App._getFriendlyTournamentState('ct_live');
    expect(state.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ teamId: 'tm_guest', memberRoster: [expect.objectContaining({ uid: 'player_uid' })] }),
    ]));
    expect(state.matches).toEqual([expect.objectContaining({ id: 'm1', stage: 'friendly' })]);
    expect(global.App._scheduleFriendlyTournamentRealtimeRender).toHaveBeenCalled();

    global.App._stopFriendlyTournamentDetailRealtime('ct_live');
    expect(unsubs.tournament).toHaveBeenCalled();
    expect(unsubs.applications).toHaveBeenCalled();
    expect(unsubs.entries).toHaveBeenCalled();
    expect(unsubs.matches).toHaveBeenCalled();
    expect(unsubs.memberGuest).toHaveBeenCalled();
    expect(global.App._friendlyTournamentDetailRealtime).toBeNull();
  });

});

describe('friendly tournament schedule tab rendering', () => {
  beforeEach(() => {
    jest.resetModules();
    global.escapeHTML = value => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  });

  afterEach(() => {
    delete global.App;
    delete global.ApiService;
    delete global.escapeHTML;
    delete global.document;
  });

  test('renders compact Google-style friendly schedule cards', () => {
    const container = { innerHTML: '' };
    const tournament = { id: 'tf_schedule', mode: 'friendly' };
    const state = {
      tournament,
      entries: [
        { teamId: 'tm_a', teamName: 'Alpha Club', teamImage: 'https://cdn.example/a.png' },
        { teamId: 'tm_b', teamName: 'Beta Club', teamImage: 'https://cdn.example/b.png' },
      ],
      matches: [
        {
          id: 'm1',
          stage: 'friendly',
          round: 1,
          slot: 0,
          status: 'finished',
          homeTeamId: 'tm_a',
          awayTeamId: 'tm_b',
          scoreHome: 2,
          scoreAway: 1,
          scheduledAt: '2026-06-24T10:00:00.000Z',
          venue: 'Court A',
          events: [
            { type: 'goal', teamId: 'tm_a', name: 'Ace', minute: 12 },
            { type: 'yellow', teamId: 'tm_b', name: 'Marker', minute: 44, note: 'late tackle' },
          ],
        },
      ],
    };
    global.document = { getElementById: id => (id === 'tournament-content' ? container : null) };
    global.ApiService = {
      getCurrentUser: () => ({ uid: 'manager' }),
      getFriendlyTournamentRecord: () => tournament,
      getTournament: () => tournament,
    };
    global.App = {
      renderTournamentTab: jest.fn(),
      _isFriendlyTournamentRecord: jest.fn(() => true),
      _getFriendlyTournamentState: jest.fn(() => state),
      _isTournamentGlobalAdmin: jest.fn(() => false),
      _canManageTournamentRecord: jest.fn(() => true),
      _canRecordTournamentMatch: jest.fn(() => false),
      _buildTournamentMatchesBySlot: jest.fn(() => ({})),
      _getTournamentTeamNameMap: jest.fn(() => ({ tm_a: 'Alpha Club', tm_b: 'Beta Club' })),
      _getTournamentTeamLogoMap: jest.fn(() => ({ tm_a: 'https://cdn.example/a.png', tm_b: 'https://cdn.example/b.png' })),
      _getTournamentModeLabel: jest.fn(() => 'Friendly'),
      _renderTournamentMatchSideLabel(match, side, _matchesBySlot, nameById) {
        const teamId = side === 'home' ? match.homeTeamId : match.awayTeamId;
        return { teamId, label: nameById[teamId] || teamId };
      },
      _getTournamentRoundLabel: jest.fn(match => `Round ${match.round}`),
    };
    require('../../js/modules/tournament/tournament-friendly-detail-view.js');

    global.App.renderTournamentTab('schedule');

    expect(container.innerHTML).toContain('tfg-schedule');
    expect(container.innerHTML).toContain('tfg-match-card tfg-match-finished');
    expect(container.innerHTML).toContain('tfg-score-lines');
    expect(container.innerHTML).toContain('tfg-match-state');
    expect(container.innerHTML).toContain('>結束<');
    expect(container.innerHTML).toContain('Alpha Club');
    expect(container.innerHTML).toContain('Beta Club');
    expect(container.innerHTML).toContain('<b>2</b>');
    expect(container.innerHTML).toContain('Court A');
    expect(container.innerHTML).toContain('tfg-match-location');
    expect(container.innerHTML).toContain('tfg-match-time');
    expect(container.innerHTML).toContain('2026/06/24');
    expect(container.innerHTML).toContain('tfg-match-events');
    expect(container.innerHTML).toContain('tfg-match-event-card');
    expect(container.innerHTML).toContain('tfg-match-event-copy');
    expect(container.innerHTML).toContain('進球');
    expect(container.innerHTML).toContain('Ace');
    expect(container.innerHTML).toContain('tfg-manage-btn');
    expect(container.innerHTML).toContain('tfg-live-slot is-empty');
    expect(container.innerHTML).toContain('data-live-state="empty"');
    expect(container.innerHTML).toContain('tfg-live-label');
    expect(container.innerHTML).not.toMatch(/<div class="tfg-match-state">\s*<span>[^<]+<\/span>\s*<small>/);
  });

  test('renders embedded live frame in friendly schedule cards when live url exists', () => {
    const tournament = { id: 'tf_live_schedule', mode: 'friendly' };
    const state = {
      tournament,
      entries: [],
      matches: [
        {
          id: 'm_live',
          stage: 'friendly',
          round: 1,
          slot: 0,
          status: 'scheduled',
          homeTeamId: 'tm_a',
          awayTeamId: 'tm_b',
          scoreHome: 0,
          scoreAway: 0,
          liveUrl: 'https://www.youtube.com/watch?v=abc123',
          scheduledAt: '2026-06-24T10:00:00.000Z',
        },
      ],
    };
    global.ApiService = { getCurrentUser: () => ({ uid: 'manager' }) };
    global.App = {
      renderTournamentTab: jest.fn(),
      _getTournamentModeLabel: jest.fn(() => 'Friendly'),
      _isTournamentGlobalAdmin: jest.fn(() => false),
      _canManageTournamentRecord: jest.fn(() => false),
      _canRecordTournamentMatch: jest.fn(() => false),
      _buildTournamentMatchesBySlot: jest.fn(() => ({})),
      _getTournamentTeamNameMap: jest.fn(() => ({ tm_a: 'Alpha Club', tm_b: 'Beta Club' })),
      _getTournamentTeamLogoMap: jest.fn(() => ({})),
      _renderTournamentMatchSideLabel(match, side, _matchesBySlot, nameById) {
        const teamId = side === 'home' ? match.homeTeamId : match.awayTeamId;
        return { teamId, label: nameById[teamId] || teamId };
      },
      _getTournamentRoundLabel: jest.fn(match => `Round ${match.round}`),
      _renderTournamentLiveFrameHtml: jest.fn(() => '<div class="tc-match-live-box compact"><iframe class="tc-match-live-frame" src="https://www.youtube.com/embed/abc123?autoplay=0"></iframe></div>'),
    };
    require('../../js/modules/tournament/tournament-friendly-detail-view.js');

    const html = global.App._renderFriendlyTournamentScheduleHtml(state);

    expect(global.App._renderTournamentLiveFrameHtml).toHaveBeenCalledWith(
      expect.objectContaining({ liveUrl: 'https://www.youtube.com/watch?v=abc123' }),
      expect.objectContaining({ compact: true, autoplay: false }),
    );
    expect(html).toContain('tfg-live-slot has-live');
    expect(html).toContain('tc-match-live-frame');
    expect(html).toContain('autoplay=0');
    expect(html).not.toContain('tfg-live-label');
  });

  test('uses the single mode label in the schedule heading', () => {
    const tournament = { id: 'tf_single_schedule', mode: 'single' };
    global.ApiService = { getCurrentUser: () => ({ uid: 'manager' }) };
    global.App = {
      renderTournamentTab: jest.fn(),
      _getTournamentModeLabel: jest.fn(() => 'Single Mode'),
      _isTournamentGlobalAdmin: jest.fn(() => false),
      _canManageTournamentRecord: jest.fn(() => false),
    };
    require('../../js/modules/tournament/tournament-friendly-detail-view.js');

    const html = global.App._renderFriendlyTournamentScheduleHtml({ tournament, entries: [], matches: [] });

    expect(html).toContain('Single Mode');
  });
});
