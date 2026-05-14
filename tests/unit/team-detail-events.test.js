const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('team detail club activity section', () => {
  function loadTeamDetailRender(app, events = [], options = {}) {
    const adminUsers = options.adminUsers || [];
    const teams = options.teams || {};
    const attendanceRecords = options.attendanceRecords || [];
    const tournaments = options.tournaments || [];
    const context = {
      App: app,
      ApiService: {
        getCurrentUser: () => ({ uid: 'viewer' }),
        getEvents: () => events,
        getTeam: (id) => teams[id] || { id: 'teamA', feed: [] },
        getTournaments: () => tournaments,
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
      document: options.document || {
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

  function loadEventCreate(app, documentOverride, extraContext = {}) {
    const context = {
      App: app,
      ApiService: {},
      document: documentOverride || {
        getElementById: () => null,
      },
      console,
      Object,
      Date,
      Math,
      Number,
      String,
      Array,
      Set,
      Map,
      setTimeout,
      generateId: () => 'ce_test',
      getSportKeySafe: (value) => String(value || '').trim(),
      GRADIENT_MAP: { play: '#3b82f6', friendly: '#10b981' },
      ...extraContext,
    };
    const source = fs.readFileSync(
      path.join(__dirname, '../../js/modules/event/event-create.js'),
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

  test('shows club activity create button only when viewer can create activities and is club staff', () => {
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
    loadTeamDetailRender(allowedApp, [event], {
      teams: { teamA: { id: 'teamA', captainUid: 'viewer' } },
    });

    const allowedHtml = allowedApp._renderTeamEvents('teamA');
    expect(allowedHtml).toContain('\u65b0\u589e\u6d3b\u52d5');
    expect(allowedHtml).toContain("App.openTeamDetailCreateEvent('teamA')");

    const nonStaffApp = makeApp([event]);
    nonStaffApp._canCreateActivityByPermission = () => true;
    loadTeamDetailRender(nonStaffApp, [event], {
      teams: { teamA: { id: 'teamA', captainUid: 'other-user' } },
    });

    const nonStaffHtml = nonStaffApp._renderTeamEvents('teamA');
    expect(nonStaffHtml).not.toContain('\u65b0\u589e\u6d3b\u52d5');
    expect(nonStaffHtml).not.toContain('openTeamDetailCreateEvent');

    const deniedApp = makeApp([]);
    deniedApp._canCreateActivityByPermission = () => false;
    loadTeamDetailRender(deniedApp, [], {
      teams: { teamA: { id: 'teamA', captainUid: 'viewer' } },
    });

    const deniedHtml = deniedApp._renderTeamEvents('teamA');
    expect(deniedHtml).not.toContain('\u65b0\u589e\u6d3b\u52d5');
    expect(deniedHtml).not.toContain('openTeamDetailCreateEvent');
  });

  test('renders club tournaments that are hosted by or joined by the club', () => {
    const app = makeApp([]);
    const tournaments = [
      { id: 'tour-host', name: '主辦盃', hostTeamId: 'teamA', registeredTeams: ['teamA'], maxTeams: 4, type: '友誼賽', regStart: '2099-01-02', image: 'https://cdn.test/tour-host.jpg' },
      { id: 'tour-join', name: '參賽盃', hostTeamId: 'teamB', registeredTeams: ['teamA'], maxTeams: 4, type: '友誼賽', regStart: '2099-01-01' },
      { id: 'tour-ended', name: '已結束盃', hostTeamId: 'teamA', registeredTeams: ['teamA'], maxTeams: 4, ended: true, regStart: '2020-01-01' },
      { id: 'tour-other', name: '其他盃', hostTeamId: 'teamB', registeredTeams: ['teamC'], maxTeams: 4, type: '友誼賽', regStart: '2099-01-03' },
    ];
    loadTeamDetailRender(app, [], { tournaments });

    const html = app._renderTeamTournaments('teamA');

    expect(html).toContain('id="team-tournaments-section"');
    expect(html).toContain('俱樂部賽事');
    expect(html).toContain('td-team-tournament-tabs');
    expect(html).toContain('td-team-tournament-title-row');
    expect(html).toContain('td-team-tournament-thumb');
    expect(html).toContain('https://cdn.test/tour-host.jpg');
    expect(html.indexOf('td-team-tournament-status')).toBeLessThan(html.indexOf('td-team-tournament-thumb'));
    expect(html).toContain('參賽中');
    expect(html).toContain('已結束');
    expect(html).toContain('主辦盃');
    expect(html).toContain('參賽盃');
    expect(html).not.toContain("App.openTeamDetailTournament('tour-ended')");
    expect(html).not.toContain('其他盃');
    expect(html).toContain("App.openTeamDetailTournament('tour-host')");

    app._teamTournamentTabByTeam = { teamA: 'ended' };
    const endedHtml = app._renderTeamTournaments('teamA');
    expect(endedHtml).toContain("App.openTeamDetailTournament('tour-ended')");
    expect(endedHtml).not.toContain("App.openTeamDetailTournament('tour-host')");
  });

  test('orders course, activity, tournament, record, and member sections in the unified detail layout', () => {
    const app = makeApp([]);
    loadTeamDetailRender(app, []);
    Object.assign(app, {
      _buildTeamInfoCard: () => '<section>info</section>',
      _buildTeamBioCard: () => '<section>bio</section>',
      _buildTeamRecordCard: () => '<section>record</section>',
      _buildTeamMembersCard: () => '<section>members</section>',
      _renderTeamEvents: () => '<section>club events</section>',
      _renderTeamTournaments: () => '<section>club tournaments</section>',
    });

    const html = app._buildTeamDetailBodyHtml(
      { id: 'teamA', captain: '', coaches: [], teachingEnabled: true },
      false,
      false,
      { keys: new Set(), names: new Set() },
      0,
      0
    );

    const recordBodyIndex = html.lastIndexOf('team-record-history-section');
    expect(html.indexOf('edu-detail-section')).toBeLessThan(html.indexOf('club events'));
    expect(html.indexOf('club events')).toBeLessThan(html.indexOf('club tournaments'));
    expect(html.indexOf('club tournaments')).toBeLessThan(recordBodyIndex);
    expect(recordBodyIndex).toBeLessThan(html.indexOf('<section>members</section>'));
    expect(html).not.toContain('team-feed-section');
    expect(html).not.toContain('team-history-section');
    expect(html).toContain('td-floating-top-btn');
  });

  test('renders course section for every club type', () => {
    const app = makeApp([]);
    loadTeamDetailRender(app, []);

    expect(app._buildTeamEducationSection({ id: 'teamA', type: 'general' })).toContain('id="edu-detail-section"');
    expect(app._buildTeamEducationSection({ id: 'teamB', type: 'education' })).toContain('id="edu-detail-section"');
    expect(app._buildTeamEducationSection({ id: 'teamA' })).toContain('俱樂部課程');
    expect(app._buildTeamEducationSection({ id: 'teamA' })).toContain('data-edutab="student"');
    expect(app._buildTeamEducationSection({ id: 'teamA' })).toContain('待審核');
    expect(app._buildTeamEducationSection({ id: 'teamA' })).not.toContain('我的');
    expect(app._buildTeamEducationSection({ id: 'teamA' })).not.toContain('班級');
  });

  test('teaching tag controls course and student section visibility', () => {
    const app = makeApp([]);
    loadTeamDetailRender(app, []);
    Object.assign(app, {
      _buildTeamEducationSection: () => '<section id="edu-detail-section">courses</section>',
      _buildTeamInfoCard: () => '',
      _buildTeamBioCard: () => '',
      _buildTeamRecordCard: () => '',
      _buildTeamMembersCard: () => '<section id="team-members-section"></section>',
      _renderTeamEvents: () => '',
      _renderTeamTournaments: () => '<section id="team-tournaments-section"></section>',
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
      _buildTeamMembersCard: () => '',
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
    expect(html).toContain('team-tournaments-section');
    expect(html).not.toContain('team-feed-section');
    expect(html).toContain('team-members-section');
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
      _buildTeamMembersCard: () => '<section id="team-members-section">members</section>',
      _renderTeamEvents: () => '<section id="team-events-section">club events</section>',
      _renderTeamTournaments: () => '<section id="team-tournaments-section">club tournaments</section>',
    });

    const team = {
      id: 'teamA',
      captain: '',
      coaches: [],
      detailVisibility: {
        courses: false,
        matches: false,
        members: false,
        record: false,
      },
    };
    const html = app._buildTeamDetailBodyHtml(team, false, false, { keys: new Set(), names: new Set() }, 0, 0);
    const nav = app._buildTeamDetailSectionNav(team);

    expect(html).toContain('team-events-section');
    expect(html).not.toContain('edu-detail-section');
    expect(html).not.toContain('team-feed-section');
    expect(html).not.toContain('team-history-section');
    expect(html).not.toContain('team-tournaments-section');
    expect(html).not.toContain('team-members-section');
    expect(html).not.toContain('team-record-section');
    expect(nav).toContain('team-events-section');
    expect(nav).not.toContain('edu-detail-section');
    expect(nav).not.toContain('team-tournaments-section');
    expect(nav).not.toContain('team-members-section');
    expect(nav).not.toContain('team-record-section');
  });

  test('team detail action bar renders secondary buttons and keeps primary action in header', () => {
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
    expect((html.match(/<button/g) || []).length).toBe(3);
    expect(html).not.toContain('teamDetail.leaveTeam');
    expect(html).not.toContain('teamDetail.applyJoin');
    expect(html).toContain('teamDetail.contactCaptain');
    expect(html).toContain('teamDetail.inviteQR');
    expect(html).not.toContain('td-action-toggle');
    expect(html).not.toContain('toggleMemberInvite');

    const primary = app._buildTeamDetailPrimaryAction({ id: 'teamA' });
    expect(primary).toContain('退出');
  });

  test('team settings modal owns member invite switch with redesigned controls', () => {
    const app = {
      _getTeamDetailVisibility: () => ({ events: true, courses: true, matches: true, info: true, bio: true, record: true, members: true }),
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

  test('club activity create button opens custom event form with current club preselected and sport defaulted', async () => {
    const teamOnly = { checked: false };
    const teamSelect = { innerHTML: '', multiple: false };
    const sportInput = { value: '' };
    const app = {
      _requireProtectedActionLogin: () => false,
      _canCreateActivityByPermission: () => true,
      _canCreateBasicActivity: () => true,
      _openCreateCustomEventModal: jest.fn(),
      _initSportTagPicker: jest.fn((sportTag) => {
        sportInput.value = sportTag;
      }),
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
        if (id === 'ce-sport-tag') return sportInput;
        return null;
      },
    }, {
      ApiService: {
        getCurrentUser: () => ({ uid: 'viewer' }),
        getTeam: () => ({ id: 'teamA', name: 'Club A', sportTag: 'basketball', captainUid: 'viewer' }),
      },
      getSportKeySafe: (value) => String(value || '').trim(),
    });

    await app.openTeamDetailCreateEvent('teamA');

    expect(app._openCreateCustomEventModal).toHaveBeenCalled();
    expect(teamOnly.checked).toBe(true);
    expect(teamSelect.presetIds).toEqual(['teamA']);
    expect(teamSelect.presetNames).toEqual(['Club A']);
    expect(teamSelect.selectedIds).toEqual(['teamA']);
    expect(app._initSportTagPicker).toHaveBeenCalledWith('basketball');
    expect(sportInput.value).toBe('basketball');
  });

  test('club activity create entry blocks non-staff even with activity create permission', async () => {
    const app = {
      _requireProtectedActionLogin: () => false,
      _canCreateActivityByPermission: () => true,
      _canCreateBasicActivity: () => true,
      _openCreateCustomEventModal: jest.fn(),
      showToast: jest.fn(),
    };
    loadTeamDetailCore(app, null, {
      ApiService: {
        getCurrentUser: () => ({ uid: 'viewer' }),
        getTeam: () => ({ id: 'teamA', name: 'Club A', captainUid: 'captain_uid' }),
      },
    });

    await app.openTeamDetailCreateEvent('teamA');

    expect(app._openCreateCustomEventModal).not.toHaveBeenCalled();
    expect(app.showToast).toHaveBeenCalledWith('\u53ea\u6709\u4ff1\u6a02\u90e8\u8077\u54e1\u53ef\u4ee5\u65b0\u589e\u4ff1\u6a02\u90e8\u6d3b\u52d5');
  });

  test('refreshes current club detail after a club activity is saved', async () => {
    const app = {
      currentPage: 'page-team-detail',
    };
    loadTeamDetailCore(app);
    app._teamDetailId = 'teamA';
    app.currentPage = 'page-team-detail';
    app.showTeamDetail = jest.fn().mockResolvedValue({ ok: true });

    await expect(app._refreshTeamDetailAfterEventSave(['teamA'])).resolves.toBe(true);
    expect(app.showTeamDetail).toHaveBeenCalledWith('teamA', { skipPageHistory: true, bypassPageLock: true });

    app.showTeamDetail.mockClear();
    await expect(app._refreshTeamDetailAfterEventSave(['teamB'])).resolves.toBe(false);
    expect(app.showTeamDetail).not.toHaveBeenCalled();
  });

  test('creating a team-only activity asks the club detail page to refresh', async () => {
    const elements = {
      'ce-title': { value: 'Club Event' },
      'ce-type': { value: 'play' },
      'ce-location': { value: 'Club Pitch' },
      'ce-date': { value: '2099-01-01' },
      'ce-time-start': { value: '14:00' },
      'ce-time-end': { value: '16:00' },
      'ce-fee-enabled': { checked: false },
      'ce-fee': { value: '0' },
      'ce-max': { value: '20' },
      'ce-waitlist': { value: '0' },
      'ce-min-age': { value: '0' },
      'ce-notes': { value: '' },
      'ce-sport-tag': { value: 'basketball' },
      'ce-gender-restriction-enabled': { checked: false },
      'ce-private-event': { checked: false },
      'ce-image': { value: '' },
      'ce-team-only': { checked: true },
      'ce-team-select': { options: [], selectedIndex: 0 },
      'ce-upload-preview': {
        querySelector: () => null,
        classList: { remove: jest.fn() },
        innerHTML: '',
      },
    };
    const createEvent = jest.fn().mockResolvedValue();
    const app = {
      _editEventId: null,
      _eventSubmitInFlight: false,
      _delegates: [],
      _canCreateBasicActivity: () => true,
      _requireProfileComplete: () => false,
      _setCreateEventSubmitting: jest.fn(),
      _getEventRegOpenTimeValue: () => '',
      _getAllowedGenderValue: () => '',
      _tsGetFormData: () => null,
      _getEventSocialLinksFormData: () => ({ enabled: false, links: [] }),
      _regionGetFormData: () => ({ regionEnabled: false, region: '', cities: [] }),
      _canUseActivityAddons: () => true,
      hasPermission: () => true,
      _getEventCreatorTeam: () => ({ teamId: 'teamA', teamName: 'Club A' }),
      _resolveTeamOnlySelection: () => [{ id: 'teamA', name: 'Club A' }],
      _getEventCreatorName: () => 'Creator',
      _getEventCreatorUid: () => 'creator_uid',
      _resolveEventCoverImage: jest.fn().mockResolvedValue('cover-url'),
      _isMultiDateMode: () => false,
      _saveInputHistory: jest.fn(),
      _saveRecentDelegates: jest.fn(),
      _grantAutoExp: jest.fn(),
      _refreshTeamDetailAfterEventSave: jest.fn().mockResolvedValue(true),
      renderActivityList: jest.fn(),
      renderHotEvents: jest.fn(),
      renderMyActivities: jest.fn(),
      closeModal: jest.fn(),
      showToast: jest.fn(),
      _setEventFeeFormState: jest.fn(),
      _setEventRegOpenTimeValue: jest.fn(),
      _renderDelegateTags: jest.fn(),
      _updateDelegateInput: jest.fn(),
      _updateTeamOnlyLabel: jest.fn(),
      _setGenderRestrictionState: jest.fn(),
      _setPrivateEventState: jest.fn(),
      _setEventSocialLinksFormData: jest.fn(),
      _resetMultiDates: jest.fn(),
      _initSportTagPicker: jest.fn(),
    };
    loadEventCreate(app, {
      getElementById: (id) => elements[id] || null,
    }, {
      ApiService: {
        createEvent,
        getCurrentUser: () => ({ uid: 'creator_uid' }),
        _writeOpLog: jest.fn(),
      },
    });
    app._resolveEventCoverImage = jest.fn().mockResolvedValue('cover-url');

    await app.handleCreateEvent();

    expect(createEvent).toHaveBeenCalledWith(expect.objectContaining({
      teamOnly: true,
      creatorTeamId: 'teamA',
      creatorTeamIds: ['teamA'],
      creatorTeamNames: ['Club A'],
      sportTag: 'basketball',
    }));
    expect(app._refreshTeamDetailAfterEventSave).toHaveBeenCalledWith(['teamA']);
  });

  test('team member list merges players, staff, and students into compact tabs', () => {
    const app = makeApp([]);
    const team = {
      id: 'teamA',
      teachingEnabled: true,
      captainUid: 'captain',
      leaderUids: ['leader'],
      coachUids: ['coach'],
      students: [
        { id: 'stu-child', name: 'Child', enrollStatus: 'active', courseAttendanceCount: 2, createdAt: '2026/04/20' },
        { id: 'stu-amy', name: 'Amy', selfUid: 'member', enrollStatus: 'active' },
        { id: 'stu-pending', name: 'Pending Kid', enrollStatus: 'pending' },
      ],
      history: [{ id: 'match1', participants: [{ uid: 'member' }] }],
    };
    const users = [
      { uid: 'member', name: 'Amy', role: 'user', teamId: 'teamA', activityAttendanceCount: 4, teamJoinedAt: '2026-05-01' },
      { uid: 'captain', name: 'Captain', role: 'captain' },
      { uid: 'leader', name: 'Leader', role: 'coach' },
      { uid: 'coach', name: 'Coach', role: 'coach' },
      { uid: 'U196b342b78abcdefabcdefabcdefabcd', role: 'venue_owner', teamId: 'teamA' },
    ];
    loadTeamDetailRender(app, [], { adminUsers: users, teams: { teamA: team } });
    Object.assign(app, {
      _isUserInTeam: (u, id) => u.teamId === id,
    });

    const roster = app._getTeamDetailRoster(team);
    const staffIdentity = { keys: new Set(), names: new Set() };
    const html = app._buildTeamMembersCard(team, false, false, staffIdentity);

    expect(app._getTeamDetailMemberCount(team)).toBe(6);
    expect(roster.some(row => row.name === 'Amy' && row.label === 'ALL')).toBe(true);
    expect(roster.some(row => row.name === 'Amy' && row.joinTime === '2026/05/01')).toBe(true);
    expect(roster.some(row => row.name === 'Child' && row.joinTime === '2026/04/20')).toBe(true);
    expect(roster.some(row => row.name === 'Child' && row.label === '學員' && row.isExternalStudent)).toBe(true);
    expect(roster.some(row => row.name === 'Pending Kid' && row.label === '待審核' && row.isPendingStudent)).toBe(true);
    expect(roster.some(row => row.uid === 'U196b342b78abcdefabcdefabcdefabcd' && row.name === '未設定暱稱')).toBe(true);
    expect(html).toContain('td-member-tabs');
    expect(html).toContain('td-member-table');
    expect(html).toContain('td-member-table-activity');
    expect(html).toContain('td-member-num');
    expect(html).toContain('td-member-name-pill');
    expect(html).toContain('td-member-name-pill uc-user');
    expect(html).toContain('td-member-name-pill uc-captain');
    expect(html).toContain('td-member-name-pill uc-coach');
    expect(html).toContain('td-member-name-pill uc-venue_owner');
    expect(html).toContain('td-member-name-pill external-student');
    expect(html).toContain('App.switchTeamMemberTab(\'teamA\',\'activity\')');
    expect(html).toContain('App.switchTeamMemberTab(\'teamA\',\'course\')');
    expect(html).toContain('App.switchTeamMemberTab(\'teamA\',\'match\')');
    app._teamMemberTabByTeam = { teamA: 'course' };
    const noTeachingHtml = app._buildTeamMembersCard({ ...team, teachingEnabled: false }, false, false, staffIdentity);
    expect(noTeachingHtml).toContain('App.switchTeamMemberTab(\'teamA\',\'activity\')');
    expect(noTeachingHtml).not.toContain('App.switchTeamMemberTab(\'teamA\',\'course\')');
    expect(noTeachingHtml).toContain('App.switchTeamMemberTab(\'teamA\',\'match\')');
    expect(noTeachingHtml).toContain('td-member-table-activity');
    expect(noTeachingHtml).not.toContain('td-member-table-course');
    expect(html).toContain('missing-name');
    expect(html).toContain('未設定暱稱');
    expect(html).not.toContain('td-member-label-pill label-all');
    expect(app._getTeamDetailMemberPrimaryTag({ roles: new Set(['\u6559\u7df4', '\u9818\u968a', '\u7403\u7d93']), isMember: true }).label).toBe('\u7403\u7d93');
    expect(app._getTeamDetailMemberPrimaryTag({ roles: new Set(['\u6559\u7df4', '\u9818\u968a']), isMember: true }).label).toBe('\u9818\u968a');
    expect(app._getTeamDetailMemberPrimaryTag({ roles: new Set(), isMember: true, isStudent: true }).label).toBe('\u968a\u54e1');
    expect(app._getTeamDetailMemberPrimaryTag({ roles: new Set(), isStudent: true }).label).toBe('\u5b78\u54e1');
    expect(html).toContain('td-member-label-pill label-student');
    expect(html).toContain('td-member-label-pill label-pending');
    expect(html).toContain('td-member-label-pill tag-role role-manager');
    expect(html).toContain('td-member-label-pill tag-role role-leader');
    expect(html).toContain('td-member-label-pill tag-role role-coach');
    expect(html).not.toContain('App.toggleProfileSection');

    const manageHtml = app._buildTeamMembersCard(team, true, false, staffIdentity);
    const activityEditHtml = app._buildTeamMembersCard(team, true, true, staffIdentity);
    app._teamMemberTabByTeam = { teamA: 'course' };
    const courseHtml = app._buildTeamMembersCard(team, true, false, staffIdentity);
    app._teamMemberTabByTeam = { teamA: 'match' };
    const matchHtml = app._buildTeamMembersCard(team, true, false, staffIdentity);
    const editHtml = app._buildTeamMembersCard(team, true, true, staffIdentity);
    expect(manageHtml).toContain('\u6210\u54e1\u7ba1\u7406');
    expect(manageHtml).toContain('td-member-note-edit-btn');
    expect(manageHtml).toContain('App.editTeamMemberNote');
    expect(courseHtml).toContain('td-member-note-edit-btn');
    expect(courseHtml).toContain('App.editTeamMemberNote');
    expect(activityEditHtml).toContain('App.removeTeamRosterRow');
    expect((activityEditHtml.match(/td-member-remove-btn/g) || []).length).toBe(7);
    expect(matchHtml).toContain('td-member-match-edit-btn');
    expect(matchHtml).not.toContain('is-editing');
    expect(editHtml).toContain('\u5254\u9664');
    expect(editHtml).toContain('td-member-table-match is-editing');
    expect(editHtml).toContain('td-member-match-edit-btn');
    expect(editHtml).toContain('<td class="td-member-action-cell">');
    expect(editHtml).toContain('App.removeTeamRosterRow');
    expect((editHtml.match(/td-member-remove-btn/g) || []).length).toBe(7);
    expect(app._isTeamDetailRemovableMemberRow(team, roster.find(row => row.name === 'Amy'), staffIdentity)).toBe(true);
    expect(app._getTeamDetailRemovalKind(team, roster.find(row => row.name === 'Child'), staffIdentity)).toBe('student');
    expect(app._getTeamDetailRemovalKind(team, roster.find(row => row.name === 'Pending Kid'), staffIdentity)).toBe('student');
    expect(app._isTeamDetailRemovableMemberRow(team, roster.find(row => row.name === 'Coach'), staffIdentity)).toBe(false);
    expect(app._getTeamDetailRemovalKind(team, roster.find(row => row.name === 'Coach'), staffIdentity)).toBe('staff');
    expect(app._getTeamDetailRemovalKind(team, roster.find(row => row.name === 'Leader'), staffIdentity)).toBe('staff');
    expect(app._getTeamDetailRemovalKind(team, roster.find(row => row.name === 'Captain'), staffIdentity)).toBe('protected');
  });

  test('team member name pill respects stealth admin role', () => {
    const app = makeApp([]);
    loadTeamDetailRender(app, []);
    app._stealthRole = jest.fn((name, role, user) => {
      if ((role === 'admin' || role === 'super_admin') && user?.stealth === true) return 'user';
      return role;
    });

    const stealthRow = { name: 'Hidden Admin', user: { uid: 'admin-1', role: 'super_admin', stealth: true } };
    const visibleRow = { name: 'Visible Admin', user: { uid: 'admin-2', role: 'admin', stealth: false } };

    expect(app._getTeamDetailMemberUserRoleClass(stealthRow)).toBe('uc-user');
    expect(app._getTeamDetailMemberUserRoleClass(visibleRow)).toBe('uc-admin');
    expect(app._getTeamDetailMemberNameClass(stealthRow)).toContain('td-member-name-pill uc-user');
    expect(app._stealthRole).toHaveBeenCalledWith('Hidden Admin', 'super_admin', stealthRow.user);

    app._stealthRole = undefined;
    expect(app._getTeamDetailMemberUserRoleClass(stealthRow)).toBe('uc-user');
  });

  test('team member edit mode re-renders cached card without reloading roster data', async () => {
    const refreshCard = jest.fn().mockReturnValue(true);
    const reloadMembers = jest.fn().mockResolvedValue();
    const app = {
      _teamMemberEditModeByTeam: {},
      _canManageTeamMembers: () => true,
      _refreshTeamMembersCardFromCache: refreshCard,
      _refreshTeamDetailMembers: reloadMembers,
      showToast: jest.fn(),
    };

    loadTeamDetailCore(app, null, {
      ApiService: {
        getTeam: () => ({ id: 'teamA' }),
      },
    });

    await app.toggleTeamMemberEditMode('teamA');

    expect(app._teamMemberEditModeByTeam.teamA).toBe(true);
    expect(refreshCard).toHaveBeenCalledWith('teamA');
    expect(reloadMembers).not.toHaveBeenCalled();
  });

  test('team detail avatar uses explicit avatar before cover fallback and shows editor for permitted users', () => {
    const app = makeApp([]);
    loadTeamDetailRender(app, []);
    Object.assign(app, {
      _canEditTeamByRoleOrCaptain: () => true,
      _getTeamImageUrl: (team, type) => team?.imageVariants?.[type] || '',
    });

    const avatarHtml = app._buildTeamDetailLogoHtml({
      id: 'teamA',
      name: 'Club A',
      avatarUrl: 'https://cdn.example/avatar.webp',
      imageVariants: { cover: 'https://cdn.example/cover.webp' },
    });
    const fallbackTeam = {
      id: 'teamB',
      name: 'Club B',
      imageVariants: { cover: 'https://cdn.example/cover-b.webp', card: 'https://cdn.example/card-b.webp' },
    };

    expect(avatarHtml).toContain('https://cdn.example/avatar.webp');
    expect(avatarHtml).not.toContain('https://cdn.example/cover.webp');
    expect(avatarHtml).toContain('App.openTeamAvatarUpload(this)');
    expect(app._getTeamDetailAvatarUrl(fallbackTeam)).toBe('https://cdn.example/cover-b.webp');
  });

  test('team avatar upload stores a Storage URL in avatarUrl and refreshes detail', async () => {
    const team = { id: 'teamA', _docId: 'teamA', name: 'Club A' };
    const updateTeamAwait = jest.fn().mockImplementation(async (_teamId, updates) => {
      Object.assign(team, updates);
      return team;
    });
    const uploadImage = jest.fn().mockResolvedValue('https://cdn.example/uploaded-avatar.webp');
    const app = {
      _teamDetailId: 'teamA',
      _canEditTeamByRoleOrCaptain: () => true,
      _withButtonLoading: async (_btn, _text, fn) => fn(),
      renderTeamList: jest.fn(),
      renderTeamManage: jest.fn(),
      renderAdminTeams: jest.fn(),
      showTeamDetail: jest.fn().mockResolvedValue({ ok: true }),
      showToast: jest.fn(),
    };
    loadTeamDetailCore(app, null, {
      ApiService: {
        getTeam: () => team,
        updateTeamAwait,
        _writeErrorLog: jest.fn(),
      },
      FirebaseService: {
        _ensureAuth: jest.fn().mockResolvedValue(true),
        _uploadImage: uploadImage,
      },
    });
    app._readTeamAvatarFileAsDataUrl = jest.fn().mockResolvedValue('data:image/png;base64,avatar');
    app.showImageCropper = jest.fn((_src, opts) => opts.onConfirm('data:image/webp;base64,cropped-avatar'));
    app.showTeamDetail = jest.fn().mockResolvedValue({ ok: true });

    await app._uploadTeamAvatarFile({ disabled: false }, team, { type: 'image/png', size: 1024, name: 'avatar.png' });

    expect(app.showImageCropper).toHaveBeenCalledWith('data:image/png;base64,avatar', expect.objectContaining({
      aspectRatio: 1,
      outputWidth: 900,
      outputHeight: 900,
      targetLabel: '\u4ff1\u6a02\u90e8\u982d\u50cf',
    }));
    expect(uploadImage).toHaveBeenCalledWith('data:image/webp;base64,cropped-avatar', 'teams/teamA_avatar');
    expect(updateTeamAwait).toHaveBeenCalledWith('teamA', { avatarUrl: 'https://cdn.example/uploaded-avatar.webp' });
    expect(team.avatarUrl).toBe('https://cdn.example/uploaded-avatar.webp');
    expect(app.showTeamDetail).toHaveBeenCalledWith('teamA', { skipPageHistory: true, bypassPageLock: true });
    expect(app.showToast).toHaveBeenCalledWith('\u4ff1\u6a02\u90e8\u982d\u50cf\u5df2\u66f4\u65b0');
  });

  test('team member removal row accepts teamIds fallback and routes staff rows separately', () => {
    const app = makeApp([]);
    loadTeamDetailRender(app, []);
    const team = { id: 'teamA' };
    const staffIdentity = { keys: new Set(), names: new Set() };

    expect(app._isTeamDetailRemovableMemberRow(team, {
      uid: 'member',
      isMember: true,
      roles: new Set(),
      user: { uid: 'member', teamIds: ['teamA'] },
    }, staffIdentity)).toBe(true);
    expect(app._isTeamDetailRemovableMemberRow(team, {
      uid: 'coach',
      isMember: true,
      roles: new Set(['教練']),
      user: { uid: 'coach' },
    }, staffIdentity)).toBe(false);
    expect(app._getTeamDetailRemovalKind(team, {
      uid: 'coach',
      isMember: true,
      roles: new Set(['\u6559\u7df4']),
      user: { uid: 'coach' },
    }, staffIdentity)).toBe('staff');
    expect(app._getTeamDetailRemovalKind(team, {
      uid: 'captain',
      isMember: true,
      roles: new Set(['\u7403\u7d93']),
      user: { uid: 'captain' },
    }, staffIdentity)).toBe('protected');
  });

  test('team roster removal deactivates removable student rows from member management', async () => {
    const updateEduStudent = jest.fn().mockResolvedValue();
    const opLog = jest.fn();
    const student = { id: 'stu-child', name: 'Child', enrollStatus: 'active' };
    const row = {
      key: 'student:stu-child',
      studentId: 'stu-child',
      name: 'Child',
      student,
      isStudent: true,
      roles: new Set(),
    };
    const app = {};
    loadTeamDetailCore(app, null, {
      ApiService: {
        getTeam: () => ({ id: 'teamA', name: 'Club A' }),
        _writeOpLog: opLog,
      },
      FirebaseService: {
        updateEduStudent,
      },
    });
    Object.assign(app, {
      _canManageTeamMembers: () => true,
      _findTeamDetailRosterRow: () => row,
      _getTeamStaffIdentity: () => ({ keys: new Set(), names: new Set() }),
      _getTeamDetailRemovalKind: () => 'student',
      appConfirm: jest.fn().mockResolvedValue(true),
      _withButtonLoading: async (_btn, _text, fn) => fn(),
      _eduStudentsCache: { teamA: [student] },
      _updateGroupMemberCounts: jest.fn(),
      _refreshTeamMembersCardFromCache: jest.fn().mockReturnValue(true),
      _refreshTeamDetailMembers: jest.fn().mockResolvedValue(),
      showToast: jest.fn(),
    });

    await app.removeTeamRosterRow(null, 'teamA', 'student:stu-child');

    expect(updateEduStudent).toHaveBeenCalledWith('teamA', 'stu-child', { enrollStatus: 'inactive' });
    expect(student.enrollStatus).toBe('inactive');
    expect(app._updateGroupMemberCounts).toHaveBeenCalledWith('teamA');
    expect(app._refreshTeamMembersCardFromCache).toHaveBeenCalledWith('teamA');
    expect(app._refreshTeamDetailMembers).not.toHaveBeenCalled();
    expect(opLog).toHaveBeenCalledWith('team_student_remove', expect.any(String), expect.stringContaining('Child'));
  });

  test('team roster removal removes staff role fields and user membership together', async () => {
    const updateUser = jest.fn().mockResolvedValue();
    const updateTeamAwait = jest.fn().mockImplementation(async (_teamId, updates) => {
      Object.assign(team, updates);
      return team;
    });
    const opLog = jest.fn();
    const team = {
      id: 'teamA',
      name: 'Club A',
      coachUids: ['coach', 'coach2'],
      coaches: ['Coach', 'Coach 2'],
      coachNames: ['Coach', 'Coach 2'],
      members: 2,
    };
    const user = {
      uid: 'coach',
      _docId: 'user-doc',
      name: 'Coach',
      teamId: 'teamA',
      teamIds: ['teamA', 'teamB'],
    };
    const row = {
      key: 'uid:coach',
      uid: 'coach',
      name: 'Coach',
      user,
      isMember: true,
      roles: new Set(['\u6559\u7df4']),
    };
    const app = {};
    loadTeamDetailCore(app, null, {
      ApiService: {
        getTeam: (id) => id === 'teamA' ? team : { id: 'teamB', name: 'Club B' },
        getAdminUsers: () => [user],
        updateTeamAwait,
        _writeOpLog: opLog,
      },
      FirebaseService: {
        _ensureAuth: jest.fn().mockResolvedValue(true),
        updateUser,
      },
    });
    Object.assign(app, {
      _canManageTeamMembers: () => true,
      _findTeamDetailRosterRow: () => row,
      _getTeamStaffIdentity: () => ({ keys: new Set(), names: new Set() }),
      _getTeamDetailRemovalKind: () => 'staff',
      _isUserInTeam: (u, id) => Array.isArray(u.teamIds) && u.teamIds.includes(id),
      _calcTeamMemberCountByTeam: jest.fn().mockReturnValue(1),
      appConfirm: jest.fn().mockResolvedValue(true),
      _withButtonLoading: async (_btn, _text, fn) => fn(),
      _refreshTeamMembersCardFromCache: jest.fn().mockReturnValue(true),
      _refreshTeamDetailMembers: jest.fn().mockResolvedValue(),
      showToast: jest.fn(),
    });

    await app.removeTeamRosterRow(null, 'teamA', 'uid:coach');

    expect(updateUser).toHaveBeenCalledWith('user-doc', {
      teamId: 'teamB',
      teamName: 'Club B',
      teamIds: ['teamB'],
      teamNames: ['Club B'],
    });
    expect(updateTeamAwait).toHaveBeenCalledWith('teamA', expect.objectContaining({
      coachUids: ['coach2'],
      coaches: ['Coach 2'],
      coachNames: ['Coach 2'],
      members: 1,
    }));
    expect(team.coachUids).toEqual(['coach2']);
    expect(user.teamIds).toEqual(['teamB']);
    expect(app._refreshTeamMembersCardFromCache).toHaveBeenCalledWith('teamA');
    expect(opLog).toHaveBeenCalledWith('team_staff_remove', expect.any(String), expect.stringContaining('Coach'));
  });

  test('team roster removal explains why captain or manager rows are protected', async () => {
    const row = {
      key: 'uid:captain',
      uid: 'captain',
      name: 'Captain',
      user: { uid: 'captain', _docId: 'captain-doc' },
      isMember: true,
      roles: new Set(['\u7403\u7d93']),
    };
    const app = {};
    loadTeamDetailCore(app, null, {
      ApiService: {
        getTeam: () => ({ id: 'teamA', name: 'Club A' }),
      },
      FirebaseService: {},
    });
    Object.assign(app, {
      _canManageTeamMembers: () => true,
      _findTeamDetailRosterRow: () => row,
      _getTeamStaffIdentity: () => ({ keys: new Set(), names: new Set() }),
      _getTeamDetailRemovalKind: () => 'protected',
      showToast: jest.fn(),
    });

    await app.removeTeamRosterRow(null, 'teamA', 'uid:captain');

    expect(app.showToast).toHaveBeenCalledWith(expect.stringContaining('\u7403\u7d93/\u968a\u9577'));
    expect(app.showToast).toHaveBeenCalledWith(expect.stringContaining('\u4ff1\u6a02\u90e8\u8a2d\u5b9a'));
  });

  test('team member match data edit writes scoped user match fields', async () => {
    const updateUser = jest.fn().mockResolvedValue();
    const opLog = jest.fn();
    const user = {
      uid: 'member',
      _docId: 'user-doc',
      teamMatchData: { teamA: { jerseyNumber: '9', position: 'FW', notes: 'old' } },
    };
    const row = {
      key: 'uid:member',
      uid: 'member',
      name: 'Amy',
      user,
      roles: new Set(),
    };
    const team = { id: 'teamA', name: 'Club A' };
    const app = {
      _getTeamDetailRoster: () => [row],
      _canManageTeamMembers: () => true,
      _isTeamDetailMatchDataEditableRow: () => true,
      _getTeamDetailMemberMatchData: () => ({ jerseyNumber: '9', position: 'FW', notes: 'old' }),
      _promptTeamMemberMatchData: jest.fn().mockResolvedValue({ jerseyNumber: '10', position: 'ST', notes: 'starter' }),
      _refreshTeamDetailMembers: jest.fn().mockResolvedValue(),
      _withButtonLoading: async (_btn, _text, fn) => fn(),
      showToast: jest.fn(),
    };
    loadTeamDetailCore(app, null, {
      ApiService: {
        getTeam: () => team,
        _writeOpLog: opLog,
      },
      FirebaseService: {
        updateUser,
      },
    });
    app._promptTeamMemberMatchData = jest.fn().mockResolvedValue({
      jerseyNumber: '10',
      position: 'ST',
      notes: 'starter',
    });
    app._refreshTeamDetailMembers = jest.fn().mockResolvedValue();

    await app.editTeamMemberMatchData(null, 'teamA', 'uid:member');

    expect(updateUser).toHaveBeenCalledWith('user-doc', {
      teamMatchData: {
        teamA: expect.objectContaining({
          jerseyNumber: '10',
          position: 'ST',
          notes: 'starter',
          updatedAt: expect.any(String),
        }),
      },
    });
    expect(user.teamMatchData.teamA.jerseyNumber).toBe('10');
    expect(app._refreshTeamDetailMembers).toHaveBeenCalledWith('teamA');
    expect(opLog).toHaveBeenCalledWith(
      'team_member_match_data_update',
      expect.any(String),
      expect.stringContaining('Amy')
    );
  });

  test('team member note edit writes scoped activity and course notes', async () => {
    const updateUser = jest.fn().mockResolvedValue();
    const updateEduStudent = jest.fn().mockResolvedValue();
    const opLog = jest.fn();
    const user = {
      uid: 'member',
      _docId: 'user-doc',
      teamActivityData: { teamA: { notes: 'old activity' } },
    };
    const student = {
      id: 'stu-child',
      teamCourseData: { teamA: { notes: 'old course' } },
    };
    const userRow = {
      key: 'uid:member',
      uid: 'member',
      name: 'Amy',
      user,
      roles: new Set(),
    };
    const studentRow = {
      key: 'student:stu-child',
      studentId: 'stu-child',
      name: 'Child',
      student,
      roles: new Set(),
    };
    const team = { id: 'teamA', name: 'Club A' };
    const app = {
      _getTeamDetailRoster: () => [userRow, studentRow],
      _canManageTeamMembers: () => true,
      _isTeamDetailMemberNoteEditableRow: () => true,
      _getTeamDetailMemberActivityData: () => ({ notes: 'old activity' }),
      _getTeamDetailMemberCourseData: () => ({ notes: 'old course' }),
      _promptTeamMemberNoteData: jest.fn()
        .mockResolvedValueOnce({ notes: 'new activity' })
        .mockResolvedValueOnce({ notes: 'new course' }),
      _refreshTeamDetailMembers: jest.fn().mockResolvedValue(),
      _withButtonLoading: async (_btn, _text, fn) => fn(),
      _eduStudentsCache: { teamA: [student] },
      showToast: jest.fn(),
    };
    loadTeamDetailCore(app, null, {
      ApiService: {
        getTeam: () => team,
        _writeOpLog: opLog,
      },
      FirebaseService: {
        updateUser,
        updateEduStudent,
      },
    });
    app._promptTeamMemberNoteData = jest.fn()
      .mockResolvedValueOnce({ notes: 'new activity' })
      .mockResolvedValueOnce({ notes: 'new course' });
    app._refreshTeamMembersCardFromCache = jest.fn().mockReturnValue(true);
    app._refreshTeamDetailMembers = jest.fn().mockResolvedValue();

    await app.editTeamMemberNote(null, 'teamA', 'uid:member', 'activity');
    await app.editTeamMemberNote(null, 'teamA', 'student:stu-child', 'course');

    expect(updateUser).toHaveBeenCalledWith('user-doc', {
      teamActivityData: {
        teamA: expect.objectContaining({
          notes: 'new activity',
          updatedAt: expect.any(String),
        }),
      },
    });
    expect(updateEduStudent).toHaveBeenCalledWith('teamA', 'stu-child', {
      teamCourseData: {
        teamA: expect.objectContaining({
          notes: 'new course',
          updatedAt: expect.any(String),
        }),
      },
    });
    expect(user.teamActivityData.teamA.notes).toBe('new activity');
    expect(student.teamCourseData.teamA.notes).toBe('new course');
    expect(app._refreshTeamMembersCardFromCache).toHaveBeenCalledWith('teamA');
    expect(app._refreshTeamDetailMembers).not.toHaveBeenCalled();
    expect(opLog).toHaveBeenCalledWith(
      'team_member_activity_note_update',
      expect.any(String),
      expect.stringContaining('Amy')
    );
    expect(opLog).toHaveBeenCalledWith(
      'team_member_course_note_update',
      expect.any(String),
      expect.stringContaining('Child')
    );
  });

  test('refreshes shared member card from current student cache', () => {
    const target = { outerHTML: '<section id="team-members-section">old</section>' };
    const app = makeApp([]);
    const team = { id: 'teamA', feed: [] };
    loadTeamDetailRender(app, [], {
      teams: { teamA: team },
      adminUsers: [],
      document: {
        getElementById: (id) => (id === 'team-members-section' ? target : null),
      },
    });
    Object.assign(app, {
      _canManageTeamMembers: () => false,
      _getTeamStaffIdentity: () => ({ keys: new Set(), names: new Set() }),
      getEduStudents: () => [{ id: 'stu-1', name: '小麥', enrollStatus: 'active' }],
    });

    const refreshed = app._refreshTeamMembersCardFromCache('teamA');

    expect(refreshed).toBe(true);
    expect(target.outerHTML).toContain('小麥');
    expect(target.outerHTML).toContain('td-member-label-pill label-student');
  });

  test('team record card renders compact equal cells without match history', () => {
    const app = makeApp([]);
    loadTeamDetailRender(app, []);

    const html = app._buildTeamRecordCard({ wins: 2, draws: 1, losses: 1 }, 4, 50);
    const combined = app._buildTeamRecordHistorySection({ wins: 2, draws: 1, losses: 1, history: [] }, 4, 50);

    expect(html).toContain('td-record-grid');
    expect(html).toContain('td-record-stat');
    expect(html).toContain('td-record-total');
    expect(html).toContain('td-record-win');
    expect(html).toContain('td-record-rate');
    expect(html).not.toContain('td-history-list-compact');
    expect(html).not.toContain('td-history-row-compact');
    expect(combined).toContain('td-record-history-grid');
    expect(combined).toContain('team-record-history-section');
    expect(combined).not.toContain('team-history-section');
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
