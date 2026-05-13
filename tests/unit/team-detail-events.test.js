const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('team detail club activity section', () => {
  function loadTeamDetailRender(app, events = [], options = {}) {
    const adminUsers = options.adminUsers || [];
    const teams = options.teams || {};
    const attendanceRecords = options.attendanceRecords || [];
    const context = {
      App: app,
      ApiService: {
        getCurrentUser: () => ({ uid: 'viewer' }),
        getEvents: () => events,
        getTeam: (id) => teams[id] || { id: 'teamA', feed: [] },
        getAdminUsers: () => adminUsers,
        getAttendanceRecords: () => attendanceRecords,
      },
      FirebaseService: { _cache: {} },
      TYPE_CONFIG: {
        friendly: { label: '友誼賽' },
        play: { label: '踢球' },
      },
      STATUS_CONFIG: {
        open: { label: '報名中', css: 'open' },
        full: { label: '已額滿', css: 'full' },
        upcoming: { label: '即將開放', css: 'upcoming' },
        ended: { label: '已結束', css: 'ended' },
        cancelled: { label: '已取消', css: 'cancelled' },
      },
      I18N: { t: (key) => key },
      document: {
        getElementById: () => null,
      },
      requestAnimationFrame: (fn) => fn(),
      setTimeout,
      console,
      Object,
      Date,
      Math,
      Number,
      String,
      Array,
      Set,
      Map,
      escapeHTML: (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;'),
    };
    const source = fs.readFileSync(
      path.join(__dirname, '../../js/modules/team/team-detail-render.js'),
      'utf8'
    );
    vm.runInNewContext(source, context);
  }

  function loadTeamDetailCore(app, documentOverride, extraContext = {}) {
    const context = {
      App: app,
      ApiService: {},
      I18N: { t: (key) => key },
      document: documentOverride || {
        getElementById: () => null,
      },
      window: {},
      console,
      Object,
      Date,
      Math,
      Number,
      String,
      Array,
      Set,
      escapeHTML: (value) => String(value ?? ''),
      ...extraContext,
    };
    const source = fs.readFileSync(
      path.join(__dirname, '../../js/modules/team/team-detail.js'),
      'utf8'
    );
    vm.runInNewContext(source, context);
  }

  function parseEventDate(dateStr) {
    const [datePart, timePart = '0:0'] = String(dateStr || '').split(' ');
    const [y, m, d] = datePart.split('/').map(Number);
    const [hh, mm] = timePart.split('~')[0].split(':').map(Number);
    if (!Number.isFinite(y)) return null;
    return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0);
  }

  function makeApp(events) {
    return {
      _getVisibleEvents: () => events,
      _parseEventStartDate: parseEventDate,
      _parseEventEndDate: parseEventDate,
      _getEventLimitedTeamIds(e) {
        const ids = [];
        if (Array.isArray(e.creatorTeamIds)) ids.push(...e.creatorTeamIds.map(String));
        if (e.creatorTeamId) ids.push(String(e.creatorTeamId));
        return Array.from(new Set(ids));
      },
      _getEventParticipantStats(e) {
        return {
          confirmedCount: Number(e.current || 0),
          waitlistCount: Number(e.waitlist || 0),
          maxCount: Number(e.max || 0),
        };
      },
      _getEventEffectiveStatus: (e) => e.status || 'open',
      _renderEventSportIcon: () => '<span class="tl-event-sport-corner"></span>',
      _favHeartHtml: () => '',
      isEventFavorited: () => false,
      _hasEventGenderRestriction: () => false,
      _isEventVisibleToUser: (e) => e.id !== 'blocked',
      _canManageEvent: () => false,
      _canCreateActivityByPermission: () => false,
      _isTeamMember: () => false,
    };
  }

  test('renders only future team-only events for the club and limits the first view to 10', () => {
    const clubEvents = Array.from({ length: 12 }, (_, idx) => ({
      id: `e${String(idx + 1).padStart(2, '0')}`,
      title: `Club Event ${idx + 1}`,
      teamOnly: true,
      creatorTeamIds: ['teamA'],
      type: 'friendly',
      status: 'open',
      date: `2099/01/${String(idx + 1).padStart(2, '0')} 19:00`,
      location: '朝馬',
      current: idx,
      max: 20,
      waitlist: 0,
    }));
    const events = [
      ...clubEvents,
      { id: 'other', title: 'Other Team', teamOnly: true, creatorTeamIds: ['teamB'], status: 'open', date: '2099/01/01 19:00' },
      { id: 'past', title: 'Past Event', teamOnly: true, creatorTeamIds: ['teamA'], status: 'open', date: '2000/01/01 19:00' },
      { id: 'ended', title: 'Ended Event', teamOnly: true, creatorTeamIds: ['teamA'], status: 'ended', date: '2099/01/02 19:00' },
      { id: 'blocked', title: 'Blocked Event', teamOnly: true, creatorTeamIds: ['teamA'], status: 'open', date: '2099/01/03 19:00' },
    ];
    const app = makeApp(events);
    loadTeamDetailRender(app, events);

    const html = app._renderTeamEvents('teamA');

    expect(html).toContain('俱樂部活動');
    expect(html).toContain('(12)');
    expect((html.match(/tl-event-row/g) || []).length).toBe(10);
    expect(html).toContain('查看更多');
    expect(html).toContain('還有 2 筆');
    expect(html).toContain("openTeamEventDetailFromCard('e01'");
    expect(html).not.toContain('Other Team');
    expect(html).not.toContain('Past Event');
    expect(html).not.toContain('Ended Event');
    expect(html).not.toContain('Blocked Event');
  });

  test('shows club activity create button only when viewer can create activities', () => {
    const event = {
      id: 'e01',
      title: 'Club Event',
      teamOnly: true,
      creatorTeamIds: ['teamA'],
      status: 'open',
      date: '2099/01/01 19:00',
      max: 20,
    };
    const allowedApp = makeApp([event]);
    allowedApp._canCreateActivityByPermission = () => true;
    loadTeamDetailRender(allowedApp, [event]);

    const allowedHtml = allowedApp._renderTeamEvents('teamA');
    expect(allowedHtml).toContain('\u65b0\u589e\u6d3b\u52d5');
    expect(allowedHtml).toContain("App.openTeamDetailCreateEvent('teamA')");

    const deniedApp = makeApp([]);
    deniedApp._canCreateActivityByPermission = () => false;
    loadTeamDetailRender(deniedApp, []);

    const deniedHtml = deniedApp._renderTeamEvents('teamA');
    expect(deniedHtml).not.toContain('\u65b0\u589e\u6d3b\u52d5');
    expect(deniedHtml).not.toContain('openTeamDetailCreateEvent');
  });

  test('places club activity before the team feed section in the unified detail layout', () => {
    const app = makeApp([]);
    loadTeamDetailRender(app, []);
    Object.assign(app, {
      _buildTeamInfoCard: () => '<section>info</section>',
      _buildTeamBioCard: () => '<section>bio</section>',
      _buildTeamRecordCard: () => '<section>record</section>',
      _buildTeamHistoryCard: () => '<section>history</section>',
      _buildTeamMembersCard: () => '<section>members</section>',
      _renderTeamFeed: () => '<section>feed</section>',
      _renderTeamEvents: () => '<section>club events</section>',
    });

    const html = app._buildTeamDetailBodyHtml(
      { id: 'teamA', captain: '', coaches: [] },
      false,
      false,
      { keys: new Set(), names: new Set() },
      0,
      0
    );

    expect(html.indexOf('<div id="team-feed-section">')).toBeGreaterThan(-1);
    expect(html.indexOf('club events')).toBeLessThan(html.indexOf('<div id="team-feed-section">'));
  });

  test('renders course section for every club type', () => {
    const app = makeApp([]);
    loadTeamDetailRender(app, []);

    expect(app._buildTeamEducationSection({ id: 'teamA', type: 'general' })).toContain('id="edu-detail-section"');
    expect(app._buildTeamEducationSection({ id: 'teamB', type: 'education' })).toContain('id="edu-detail-section"');
  });

  test('teaching tag controls course and student section visibility', () => {
    const app = makeApp([]);
    loadTeamDetailRender(app, []);
    Object.assign(app, {
      _buildTeamEducationSection: () => '<section id="edu-detail-section">courses</section>',
      _buildTeamInfoCard: () => '',
      _buildTeamBioCard: () => '',
      _buildTeamRecordCard: () => '',
      _buildTeamHistoryCard: () => '',
      _buildTeamMembersCard: () => '',
      _renderTeamFeed: () => '',
      _renderTeamEvents: () => '',
    });

    const disabledHtml = app._buildTeamDetailBodyHtml(
      { id: 'teamA', captain: '', coaches: [], teachingEnabled: false },
      false,
      false,
      { keys: new Set(), names: new Set() },
      0,
      0
    );
    const disabledNav = app._buildTeamDetailSectionNav({ id: 'teamA', teachingEnabled: false });
    expect(disabledHtml).not.toContain('edu-detail-section');
    expect(disabledNav).not.toContain('edu-detail-section');

    const enabledHtml = app._buildTeamDetailBodyHtml(
      { id: 'teamA', captain: '', coaches: [], teachingEnabled: true },
      false,
      false,
      { keys: new Set(), names: new Set() },
      0,
      0
    );
    expect(enabledHtml).toContain('edu-detail-section');
  });

  test('detail tabs are independent from simplified dashboard stats', () => {
    const app = makeApp([]);
    loadTeamDetailRender(app, []);
    Object.assign(app, {
      _buildTeamInfoCard: () => '',
      _buildTeamBioCard: () => '',
      _buildTeamRecordCard: () => '',
      _buildTeamHistoryCard: () => '',
      _buildTeamMembersCard: () => '',
      _renderTeamFeed: () => '',
      _renderTeamEvents: () => '',
    });

    const html = app._buildTeamDetailBodyHtml(
      { id: 'teamA', name: 'Team A', captain: '', coaches: [], teachingEnabled: true },
      false,
      false,
      { keys: new Set(), names: new Set() },
      0,
      0
    );

    expect(html).toContain('td-section-nav-panel');
    expect(html).toContain('td-overview-grid');
    expect(html).toContain('td-floating-top-btn');
    expect(html).not.toContain('td-overview-icon');
    expect(html.indexOf('td-section-nav-panel')).toBeLessThan(html.indexOf('td-overview-grid'));
  });

  test('detail visibility settings hide selected containers and nav targets', () => {
    const app = makeApp([]);
    loadTeamDetailRender(app, []);
    Object.assign(app, {
      _buildTeamInfoCard: () => '<section id="team-info-section">info</section>',
      _buildTeamBioCard: () => '<section id="team-bio-section">bio</section>',
      _buildTeamRecordCard: () => '<section id="team-record-section">record</section>',
      _buildTeamHistoryCard: () => '<section id="team-history-section">history</section>',
      _buildTeamMembersCard: () => '<section id="team-members-section">members</section>',
      _renderTeamFeed: () => '<section>feed</section>',
      _renderTeamEvents: () => '<section id="team-events-section">club events</section>',
    });

    const team = {
      id: 'teamA',
      captain: '',
      coaches: [],
      detailVisibility: {
        courses: false,
        feed: false,
        members: false,
        record: false,
      },
    };
    const html = app._buildTeamDetailBodyHtml(team, false, false, { keys: new Set(), names: new Set() }, 0, 0);
    const nav = app._buildTeamDetailSectionNav(team);

    expect(html).toContain('team-events-section');
    expect(html).not.toContain('edu-detail-section');
    expect(html).not.toContain('team-feed-section');
    expect(html).not.toContain('team-members-section');
    expect(html).not.toContain('team-record-section');
    expect(nav).toContain('team-events-section');
    expect(nav).not.toContain('edu-detail-section');
    expect(nav).not.toContain('team-members-section');
    expect(nav).not.toContain('team-record-section');
  });

  test('team detail action bar renders one equal-width row without invite toggle', () => {
    const app = makeApp([]);
    Object.assign(app, {
      _isTeamMember: () => true,
    });
    loadTeamDetailRender(app, []);

    const html = app._buildTeamDetailActionBar({
      id: 'teamA',
      captain: 'Captain',
      coaches: [],
      allowMemberInvite: true,
    });

    expect(html).toContain('td-action-grid');
    expect((html.match(/<button/g) || []).length).toBe(4);
    expect(html).toContain('teamDetail.leaveTeam');
    expect(html).toContain('teamDetail.contactCaptain');
    expect(html).toContain('teamDetail.inviteQR');
    expect(html).not.toContain('td-action-toggle');
    expect(html).not.toContain('toggleMemberInvite');
  });

  test('team settings modal owns member invite switch with redesigned controls', () => {
    const app = {
      _getTeamDetailVisibility: () => ({ events: true, courses: true, feed: true, info: true, bio: true, record: true, history: true, members: true }),
      _isTeamTeachingTagged: () => false,
    };
    const body = { innerHTML: '' };
    loadTeamDetailCore(app, {
      getElementById: (id) => (id === 'team-detail-settings-body' ? body : null),
    });

    app._renderTeamDetailSettingsBody({ id: 'teamA', allowMemberInvite: false });

    expect(body.innerHTML).toContain('td-settings-switch');
    expect(body.innerHTML).toContain('App.toggleTeamMemberInviteSetting(this.checked, this)');
    expect(body.innerHTML).toContain('teamDetail.memberCanInvite');
    expect(body.innerHTML).not.toContain('toggle-switch');
    expect(body.innerHTML).not.toContain('toggleMemberInvite');
  });

  test('team detail view count records once per device and updates teams viewCount', () => {
    const updates = [];
    const localValues = new Map();
    const app = {};
    const firestoreFn = () => ({
      collection: (name) => ({
        doc: (id) => ({
          update: (payload) => {
            updates.push({ name, id, payload });
            return Promise.resolve();
          },
        }),
      }),
    });
    firestoreFn.FieldValue = { increment: (value) => ({ increment: value }) };
    loadTeamDetailCore(app, undefined, {
      localStorage: {
        getItem: (key) => localValues.get(key) || null,
        setItem: (key, value) => localValues.set(key, value),
      },
      firebase: {
        firestore: firestoreFn,
      },
    });
    app._recordTeamDetailView({ id: 'teamA', _docId: 'docA', viewCount: 3 });
    app._recordTeamDetailView({ id: 'teamA', _docId: 'docA', viewCount: 4 });

    expect(localValues.get('team_view_teamA')).toBe('1');
    expect(updates).toHaveLength(1);
    expect(updates[0].name).toBe('teams');
    expect(updates[0].id).toBe('docA');
  });

  test('club activity create button opens custom event form with current club preselected', async () => {
    const teamOnly = { checked: false };
    const teamSelect = { innerHTML: '', multiple: false };
    const app = {
      _requireProtectedActionLogin: () => false,
      _canCreateActivityByPermission: () => true,
      _canCreateBasicActivity: () => true,
      _openCreateCustomEventModal: jest.fn(),
      _populateTeamSelect: jest.fn((select, ids, names) => {
        select.presetIds = ids;
        select.presetNames = names;
      }),
      _setTeamSelectValues: jest.fn((select, ids) => {
        select.selectedIds = ids;
      }),
      _updateTeamOnlyLabel: jest.fn(),
      showToast: jest.fn(),
    };
    loadTeamDetailCore(app, {
      getElementById: (id) => {
        if (id === 'ce-team-only') return teamOnly;
        if (id === 'ce-team-select') return teamSelect;
        return null;
      },
    });

    await app.openTeamDetailCreateEvent('teamA');

    expect(app._openCreateCustomEventModal).toHaveBeenCalled();
    expect(teamOnly.checked).toBe(true);
    expect(teamSelect.presetIds).toEqual(['teamA']);
    expect(teamSelect.selectedIds).toEqual(['teamA']);
  });

  test('team feed publish button passes itself for loading feedback', () => {
    const app = makeApp([]);
    Object.assign(app, {
      _isTeamMember: () => true,
      _teamFeedPage: {},
      _FEED_PAGE_SIZE: 20,
      getTeamFeed: () => [],
    });
    loadTeamDetailRender(app, []);

    const html = app._renderTeamFeed('teamA');

    expect(html).toContain("App.submitTeamPost('teamA', this)");
  });

  test('team member list merges players, staff, and students into compact tabs', () => {
    const app = makeApp([]);
    const team = {
      id: 'teamA',
      captainUid: 'captain',
      leaderUids: ['leader'],
      coachUids: ['coach'],
      students: [
        { id: 'stu-child', name: 'Child', enrollStatus: 'active', courseAttendanceCount: 2 },
        { id: 'stu-amy', name: 'Amy', selfUid: 'member', enrollStatus: 'active' },
      ],
      history: [{ id: 'match1', participants: [{ uid: 'member' }] }],
    };
    const users = [
      { uid: 'member', name: 'Amy', teamId: 'teamA', activityAttendanceCount: 4 },
      { uid: 'captain', name: 'Captain' },
      { uid: 'leader', name: 'Leader' },
      { uid: 'coach', name: 'Coach' },
      { uid: 'U196b342b78abcdefabcdefabcdefabcd', teamId: 'teamA' },
    ];
    loadTeamDetailRender(app, [], { adminUsers: users, teams: { teamA: team } });
    Object.assign(app, {
      _isUserInTeam: (u, id) => u.teamId === id,
    });

    const roster = app._getTeamDetailRoster(team);
    const html = app._buildTeamMembersCard(team, false, false, { keys: new Set(), names: new Set() });

    expect(app._getTeamDetailMemberCount(team)).toBe(6);
    expect(roster.some(row => row.name === 'Amy' && row.label === 'ALL')).toBe(true);
    expect(roster.some(row => row.name === 'Child' && row.label === '學員' && row.isExternalStudent)).toBe(true);
    expect(roster.some(row => row.uid === 'U196b342b78abcdefabcdefabcdefabcd' && row.name === '未設定暱稱')).toBe(true);
    expect(html).toContain('td-member-tabs');
    expect(html).toContain('td-member-table');
    expect(html).toContain('missing-name');
    expect(html).toContain('未設定暱稱');
    expect(html).toContain('td-member-label-pill label-all');
    expect(html).toContain('td-member-label-pill label-student');
    expect(html).toContain('td-member-role-pill role-manager');
    expect(html).toContain('td-member-role-pill role-leader');
    expect(html).toContain('td-member-role-pill role-coach');
    expect(html).not.toContain('App.toggleProfileSection');
  });

  test('team record and history cards render compact real cards without reserved copy', () => {
    const app = makeApp([]);
    loadTeamDetailRender(app, []);

    const html = app._buildTeamRecordCard({ wins: 2, draws: 1, losses: 1 }, 4, 50)
      + app._buildTeamHistoryCard({ history: [{ id: 'm1', title: '友誼賽', score: '2:1', date: '2026/05/01' }] });

    expect(html).toContain('td-record-grid');
    expect(html).toContain('td-record-stat');
    expect(html).toContain('td-history-list-compact');
    expect(html).toContain('td-history-row-compact');
    expect(html).not.toContain('資料位置已預留');
    expect(html).not.toContain('位置已預留');
    expect(html).not.toContain('profile-collapse-toggle');
    expect(html).not.toContain('App.toggleProfileSection');
  });

  test('team info displays compact inline facts and gives coach card two slots', () => {
    const app = makeApp([]);
    loadTeamDetailRender(app, []);
    Object.assign(app, {
      _userTag: (name, role) => '<span class="' + role + '">' + name + '</span>',
      _teamLeaderTag: (name) => '<span class="leader">' + name + '</span>',
    });

    const html = app._buildTeamInfoCard({
      id: 'teamA',
      captain: 'Captain',
      leaders: ['Leader'],
      coaches: ['Coach A', 'Coach B'],
      sportTag: 'football',
      region: '台中市',
      nationality: '台灣',
      founded: '2026',
    });

    expect(html).toContain('td-info-inline-row');
    expect(html).toContain('td-info-inline-item');
    expect(html).toContain('td-info-coach-card');
    expect(html).not.toContain('teamDetail.memberCount');
  });

  test('team detail cards no longer depend on profile collapse handlers', () => {
    const app = makeApp([]);
    loadTeamDetailRender(app, []);
    Object.assign(app, {
      _isRegularTeamMember: () => true,
    });

    const html = [
      app._buildTeamHistoryCard({ history: [] }),
      app._buildTeamMembersCard(
        { id: 'teamA' },
        false,
        false,
        { keys: new Set(), names: new Set() }
      ),
    ].join('');

    expect(html).not.toContain('profile-collapse-toggle');
    expect(html).not.toContain('App.toggleTeamDetailSection');
    expect(html).not.toContain('App.toggleProfileSection');
  });

  test('team detail owns its collapse behavior without loading profile modules', () => {
    const app = {};
    loadTeamDetailCore(app);
    let isOpen = false;
    const content = { style: { display: 'none' } };
    const label = {
      nextElementSibling: content,
      classList: {
        toggle: () => {
          isOpen = !isOpen;
          return isOpen;
        },
      },
    };

    app.toggleTeamDetailSection(label);
    expect(content.style.display).toBe('');

    app.toggleTeamDetailSection(label);
    expect(content.style.display).toBe('none');
  });
});
