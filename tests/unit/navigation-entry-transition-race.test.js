/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

function readSource(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function installModule(file, options = {}) {
  global.App = {
    currentPage: 'page-current',
    _pageTransitionSeq: 0,
    _activePageTransitionSeq: 0,
    _userIntendedPage: 'page-current',
    _claimPageTransition(pageId, routeOptions = {}) {
      const inherited = Number(routeOptions._navigationTransitionSeq);
      const transitionSeq = Number.isSafeInteger(inherited) && inherited > 0
        ? inherited
        : ++this._pageTransitionSeq;
      if (transitionSeq === this._pageTransitionSeq && pageId && !routeOptions.fromBootFlush) {
        this._userIntendedPage = pageId;
      }
      return transitionSeq;
    },
    _isPageTransitionCurrent(transitionSeq) {
      return transitionSeq === this._pageTransitionSeq;
    },
    _abortStalePageTransition: jest.fn((source, pageId, transitionSeq) => ({
      ok: false,
      reason: 'stale_transition',
      source,
      pageId,
      transitionSeq,
    })),
    showPage: jest.fn(async pageId => ({ ok: true, pageId })),
    showToast: jest.fn(),
    _requireLogin: () => false,
    _requireProtectedActionLogin: () => false,
    ...options.before,
  };
  global.ApiService = {
    getCurrentUser: () => null,
    ...options.api,
  };
  global.FirebaseService = {
    ensureAuthReadyForWrite: jest.fn(() => Promise.resolve()),
    ...options.firebase,
  };
  global.PageLoader = {
    ensurePage: jest.fn(() => Promise.resolve()),
    ...options.pageLoader,
  };
  global.ScriptLoader = {
    ensureForPage: jest.fn(() => Promise.resolve()),
    ...options.scriptLoader,
  };
  global.LineAuth = {
    isLoggedIn: () => true,
    ...options.lineAuth,
  };
  global.ROLES = { user: {} };
  global.escapeHTML = value => String(value == null ? '' : value);

  eval(readSource(file));
  Object.assign(global.App, options.after || {});
  return global.App;
}

describe('async route entry transition guards', () => {
  afterEach(() => {
    delete global.App;
    delete global.ApiService;
    delete global.FirebaseService;
    delete global.PageLoader;
    delete global.ScriptLoader;
    delete global.LineAuth;
    delete global.ROLES;
    delete global.escapeHTML;
    delete global.requestAnimationFrame;
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  test('real page-switch cleanup releases activity entry ownership and stale team-card flight', () => {
    const cancelActivityCreateEntry = jest.fn();
    const cancelActivityCreateCompatEntry = jest.fn();
    const invalidateTeamCardOpenFlight = jest.fn();
    const stopEduTeamsListener = jest.fn();
    const App = installModule('js/core/navigation.js', {
      before: {
        currentPage: 'page-teams',
        _cancelActivityCreateEntry: cancelActivityCreateEntry,
        _cancelActivityCreateCompatEntry: cancelActivityCreateCompatEntry,
        _invalidateTeamCardOpenFlight: invalidateTeamCardOpenFlight,
        _stopEduTeamsListener: stopEduTeamsListener,
      },
    });

    App._cleanupBeforePageSwitch('page-home');

    expect(cancelActivityCreateEntry).toHaveBeenCalledWith('page-switch');
    expect(cancelActivityCreateCompatEntry).toHaveBeenCalledWith('page-switch');
    expect(invalidateTeamCardOpenFlight).toHaveBeenCalledWith('leave-team-list');
    expect(stopEduTeamsListener).toHaveBeenCalledTimes(1);
  });

  test('event detail does not activate its shell after a newer navigation', async () => {
    const scriptsReady = deferred();
    const event = { id: 'ce_test', type: 'play', title: 'Test event' };
    const App = installModule('js/modules/event/event-detail.js', {
      api: { getEvent: () => event },
      scriptLoader: { ensureForPage: jest.fn(() => scriptsReady.promise) },
      after: {
        _isGuestEventDetailView: () => true,
        _showFastEventDetailShellNow: jest.fn(() => true),
        _warmEventDetailFreshData: jest.fn(),
        _resetDetailAttendanceOnDemandForFreshEntry: jest.fn(),
      },
    });

    const detailPromise = App.showEventDetail(event.id, { allowGuest: true });
    await Promise.resolve();
    App._pageTransitionSeq += 1;
    App.currentPage = 'page-new';
    scriptsReady.resolve();
    await detailPromise;

    expect(App._showFastEventDetailShellNow).not.toHaveBeenCalled();
  });

  test('event detail stops before scripts when HTML finishes after newer navigation', async () => {
    const pageReady = deferred();
    const event = { id: 'ce_html', type: 'play', title: 'HTML event' };
    const App = installModule('js/modules/event/event-detail.js', {
      api: { getEvent: () => event },
      pageLoader: { ensurePage: jest.fn(() => pageReady.promise) },
      after: {
        _isGuestEventDetailView: () => true,
        _resetDetailAttendanceOnDemandForFreshEntry: jest.fn(),
      },
    });

    const detailPromise = App.showEventDetail(event.id, { allowGuest: true });
    await Promise.resolve();
    App._pageTransitionSeq += 1;
    App.currentPage = 'page-new';
    pageReady.resolve();
    const result = await detailPromise;

    expect(result).toMatchObject({ ok: false, reason: 'stale_transition' });
    expect(ScriptLoader.ensureForPage).not.toHaveBeenCalled();
  });

  test('same event refresh cannot reclaim a transition after the user starts leaving', async () => {
    const event = { id: 'ce_refresh', type: 'play', title: 'Refresh event' };
    const App = installModule('js/modules/event/event-detail.js', {
      api: { getEvent: () => event },
      after: {
        _isGuestEventDetailView: () => true,
        _showFastEventDetailShellNow: jest.fn(() => false),
        _resetDetailAttendanceOnDemandForFreshEntry: jest.fn(),
      },
    });
    App.currentPage = 'page-activity-detail';
    App._currentDetailEventId = event.id;
    App._activePageTransitionSeq = 4;
    App._pageTransitionSeq = 5;

    const result = await App.showEventDetail(event.id, { allowGuest: true });

    expect(result).toMatchObject({ ok: false, reason: 'stale_transition' });
    expect(PageLoader.ensurePage).not.toHaveBeenCalled();
    expect(ScriptLoader.ensureForPage).not.toHaveBeenCalled();
  });

  test('same team refresh cannot cancel a newer pending navigation', async () => {
    const team = { id: 'tm_refresh', name: 'Refresh team' };
    const App = installModule('js/modules/team/team-detail.js', {
      api: {
        getTeam: () => team,
        getTeamAsync: jest.fn(),
      },
      after: {
        _getTeamDetailNodes: jest.fn(() => null),
      },
    });
    App.currentPage = 'page-team-detail';
    App._teamDetailId = team.id;
    App._activePageTransitionSeq = 7;
    App._pageTransitionSeq = 8;

    const result = await App.showTeamDetail(team.id, { allowGuest: true });

    expect(result).toMatchObject({ ok: false, reason: 'stale_transition' });
    expect(PageLoader.ensurePage).not.toHaveBeenCalled();
    expect(ScriptLoader.ensureForPage).not.toHaveBeenCalled();
  });

  test('new team module exposes its loaded handler when old navigation has no stable mapping', async () => {
    const oldNavigationGateway = jest.fn(async () => ({ ok: false, reason: 'old-gateway' }));
    const App = installModule('js/modules/team/team-detail.js', {
      before: {
        showTeamDetail: oldNavigationGateway,
      },
    });
    const loadedHandler = jest.fn(async (teamId, options) => ({
      ok: true,
      teamId,
      options,
    }));
    App._showTeamDetailLoaded = loadedHandler;

    const result = await App.showTeamDetail('tm_mixed', { allowGuest: true });

    expect(result).toMatchObject({ ok: true, teamId: 'tm_mixed' });
    expect(loadedHandler).toHaveBeenCalledWith('tm_mixed', { allowGuest: true });
    expect(oldNavigationGateway).not.toHaveBeenCalled();
  });

  test('team detail stops before scripts when HTML finishes after newer navigation', async () => {
    const pageReady = deferred();
    const team = { id: 'tm_html', name: 'HTML team' };
    const App = installModule('js/modules/team/team-detail.js', {
      api: {
        getTeam: () => team,
        getTeamAsync: jest.fn(),
      },
      pageLoader: { ensurePage: jest.fn(() => pageReady.promise) },
      after: { _getTeamDetailNodes: jest.fn(() => null) },
    });

    const detailPromise = App.showTeamDetail(team.id, { allowGuest: true });
    await Promise.resolve();
    App._pageTransitionSeq += 1;
    App.currentPage = 'page-new';
    pageReady.resolve();
    const result = await detailPromise;

    expect(result).toMatchObject({ ok: false, reason: 'stale_transition' });
    expect(ScriptLoader.ensureForPage).not.toHaveBeenCalled();
  });

  test('team detail stops after a cold record fetch when a newer navigation wins', async () => {
    const teamReady = deferred();
    const team = { id: 'tm_test', name: 'Test team' };
    let cachedTeam = null;
    const App = installModule('js/modules/team/team-detail.js', {
      api: {
        getTeam: () => cachedTeam,
        getTeamAsync: jest.fn(() => teamReady.promise),
      },
      after: {
        _getTeamDetailNodes: jest.fn(() => null),
      },
    });

    const detailPromise = App.showTeamDetail(team.id, { allowGuest: true });
    await Promise.resolve();
    App._pageTransitionSeq += 1;
    App.currentPage = 'page-new';
    cachedTeam = team;
    teamReady.resolve(team);
    const result = await detailPromise;

    expect(result).toMatchObject({ ok: false, reason: 'stale_transition' });
    expect(PageLoader.ensurePage).not.toHaveBeenCalled();
    expect(App.showPage).not.toHaveBeenCalled();
  });

  test('regular tournament detail does not show after a newer navigation', async () => {
    const tournamentReady = deferred();
    const tournament = { id: 'ct_test', name: 'Test tournament' };
    const App = installModule('js/modules/tournament/tournament-detail.js', {
      api: {
        getTournament: () => null,
        getTournamentAsync: jest.fn(() => tournamentReady.promise),
      },
    });

    const detailPromise = App.showTournamentDetail(tournament.id, { allowGuest: true });
    await Promise.resolve();
    App._pageTransitionSeq += 1;
    App.currentPage = 'page-new';
    tournamentReady.resolve(tournament);
    const result = await detailPromise;

    expect(result).toMatchObject({ ok: false, reason: 'stale_transition' });
    expect(App.showPage).not.toHaveBeenCalled();
  });

  test('friendly tournament detail stops after its cold record fetch', async () => {
    const tournamentReady = deferred();
    const tournament = { id: 'ct_friendly', name: 'Friendly', format: 'friendly' };
    const legacyShow = jest.fn(async () => ({ ok: true }));
    const App = installModule('js/modules/tournament/tournament-friendly-detail.js', {
      before: {
        showTournamentDetail: legacyShow,
        renderRegisterButton: jest.fn(),
        registerTournament: jest.fn(),
        renderTournamentTab: jest.fn(),
      },
      api: {
        getTournament: () => null,
        getTournamentAsync: jest.fn(() => tournamentReady.promise),
        getCurrentUser: () => null,
      },
      after: {
        _isFriendlyTournamentRecord: () => true,
        _stopFriendlyTournamentDetailRealtime: jest.fn(),
        _ensureFriendlyTournamentApplyTeamsLoaded: jest.fn(async () => {}),
        _loadFriendlyTournamentDetailState: jest.fn(async () => ({ tournament })),
      },
    });

    const detailPromise = App.showTournamentDetail(tournament.id, { allowGuest: true });
    await Promise.resolve();
    App._pageTransitionSeq += 1;
    App.currentPage = 'page-new';
    tournamentReady.resolve(tournament);
    const result = await detailPromise;

    expect(result).toMatchObject({ ok: false, reason: 'stale_transition' });
    expect(App.showPage).not.toHaveBeenCalled();
    expect(legacyShow).not.toHaveBeenCalled();
  });

  test('friendly tournament does not chain state loading or prewrite id after leaving', async () => {
    const pageReady = deferred();
    const teamsReady = deferred();
    const tournament = { id: 'ct_chain', name: 'Chain tournament', format: 'friendly' };
    const legacyShow = jest.fn(async () => ({ ok: true }));
    const App = installModule('js/modules/tournament/tournament-friendly-detail.js', {
      before: {
        showTournamentDetail: legacyShow,
        renderRegisterButton: jest.fn(),
        registerTournament: jest.fn(),
        renderTournamentTab: jest.fn(),
      },
      api: {
        getTournament: () => tournament,
        getCurrentUser: () => null,
      },
      after: {
        showPage: jest.fn(() => pageReady.promise),
        _isFriendlyTournamentRecord: () => true,
        _stopFriendlyTournamentDetailRealtime: jest.fn(),
        _ensureFriendlyTournamentApplyTeamsLoaded: jest.fn(() => teamsReady.promise),
        _loadFriendlyTournamentDetailState: jest.fn(async () => ({ tournament })),
      },
    });

    const detailPromise = App.showTournamentDetail(tournament.id, { allowGuest: true });
    await Promise.resolve();
    expect(App.currentTournament).not.toBe(tournament.id);

    App._pageTransitionSeq += 1;
    App.currentPage = 'page-new';
    teamsReady.resolve();
    await Promise.resolve();
    pageReady.resolve({ ok: true });
    const result = await detailPromise;

    expect(result).toMatchObject({ ok: false, reason: 'stale_transition' });
    expect(App._loadFriendlyTournamentDetailState).not.toHaveBeenCalled();
    expect(App.currentTournament).not.toBe(tournament.id);
  });

  test('friendly tournament roster hydration cannot refresh an obsolete detail route', async () => {
    const rosterReady = deferred();
    const tournament = { id: 'ct_roster', name: 'Roster tournament', format: 'friendly' };
    const App = installModule('js/modules/tournament/tournament-friendly-roster.js', {
      before: {
        currentPage: 'page-tournament-detail',
        currentTournament: tournament.id,
        _pageTransitionSeq: 9,
        _activePageTransitionSeq: 9,
        showTournamentDetail: jest.fn(async () => ({ ok: true, pageId: 'page-tournament-detail' })),
        renderRegisterButton: jest.fn(),
      },
      api: {
        getFriendlyTournamentRecord: () => tournament,
        getTournament: () => tournament,
      },
      after: {
        _getFriendlyTournamentState: jest.fn(() => ({ tournament })),
        _isFriendlyTournamentRecord: jest.fn(() => true),
        _hydrateFriendlyTournamentRosterState: jest.fn(() => rosterReady.promise),
        _refreshFriendlyTournamentRosterUi: jest.fn(),
      },
    });

    const detailPromise = App.showTournamentDetail(tournament.id, { allowGuest: true });
    await Promise.resolve();
    App._pageTransitionSeq = 10;
    rosterReady.resolve({ tournament, rosterHydrated: true });
    const result = await detailPromise;

    expect(result).toMatchObject({ ok: false, reason: 'stale_transition' });
    expect(App._refreshFriendlyTournamentRosterUi).not.toHaveBeenCalled();
  });

  test('user profile does not show its loading page after a newer navigation', async () => {
    const scriptsReady = deferred();
    const App = installModule('js/modules/profile/profile-core.js', {
      scriptLoader: { ensureForPage: jest.fn(() => scriptsReady.promise) },
      lineAuth: { isLoggedIn: () => false },
      after: {
        _findUserByUid: () => null,
        _findUserByName: () => null,
        _renderUserProfileLoading: jest.fn(),
      },
    });

    const profilePromise = App.showUserProfile('Test user', {
      allowGuest: true,
      uid: 'U_test_user',
    });
    await Promise.resolve();
    App._pageTransitionSeq += 1;
    App.currentPage = 'page-new';
    scriptsReady.resolve();
    const result = await profilePromise;

    expect(result).toMatchObject({ ok: false, reason: 'stale_transition' });
    expect(App._renderUserProfileLoading).not.toHaveBeenCalled();
    expect(App.showPage).not.toHaveBeenCalled();
  });

  test('user profile auth wait cannot show stale fallback UI after leaving', async () => {
    const authReady = deferred();
    const authStarted = deferred();
    const App = installModule('js/modules/profile/profile-core.js', {
      before: {
        showPage: jest.fn(async function showPage(pageId) {
          this.currentPage = pageId;
          return { ok: true, pageId };
        }),
      },
      lineAuth: { isLoggedIn: () => false },
      after: {
        _findUserByUid: () => null,
        _findUserByName: () => null,
        _renderUserProfileLoading: jest.fn(),
        _renderUserProfileUnavailable: jest.fn(),
        _waitForUserProfileFirestoreAuth: jest.fn(() => {
          authStarted.resolve();
          return authReady.promise;
        }),
      },
    });

    const profilePromise = App.showUserProfile('Test user', {
      allowGuest: true,
      uid: 'U_test_user',
    });
    await authStarted.promise;
    App._pageTransitionSeq += 1;
    App.currentPage = 'page-new';
    authReady.resolve(false);
    const result = await profilePromise;

    expect(result).toMatchObject({ ok: false, reason: 'stale_transition' });
    expect(App._renderUserProfileUnavailable).not.toHaveBeenCalled();
    expect(App.showToast).not.toHaveBeenCalled();
  });

  test('education calendar does not show after student mapping completes late', async () => {
    const studentsReady = deferred();
    const App = installModule('js/modules/education/edu-calendar-core.js', {
      api: { getCurrentUser: () => ({ uid: 'U_test' }) },
      after: {
        _loadEduStudents: jest.fn(() => studentsReady.promise),
      },
    });

    const calendarPromise = App.showEduCalendar('tm_test');
    await Promise.resolve();
    App._pageTransitionSeq += 1;
    App.currentPage = 'page-new';
    studentsReady.resolve([
      { id: 'student-1', enrollStatus: 'active', selfUid: 'U_test' },
    ]);
    const result = await calendarPromise;

    expect(result).toMatchObject({ ok: false, reason: 'stale_transition' });
    expect(App.showPage).not.toHaveBeenCalled();
  });

  test('fast event shell does not claim detail ownership when activation fails', () => {
    document.body.innerHTML = '<section id="page-activity-detail"></section>';
    const renderFastShell = jest.fn();
    const App = installModule('js/modules/event/event-detail.js', {
      after: {
        _getPerformanceFlag: () => true,
        _renderFastEventDetailShell: renderFastShell,
        _cleanupBeforePageSwitch: jest.fn(),
        _pushPageHistory: jest.fn(),
        _activatePage: jest.fn(() => false),
      },
    });
    App._currentDetailEventId = 'ce_previous';

    const result = App._showFastEventDetailShellNow('ce_pending');

    expect(result).toBe(false);
    expect(renderFastShell).not.toHaveBeenCalled();
    expect(App._currentDetailEventId).toBe('ce_previous');
  });

  test('event detail keeps previous ownership while target page activation is pending', async () => {
    document.body.innerHTML = '<h1 id="event-title"></h1><div id="event-body"></div>';
    global.requestAnimationFrame = callback => callback();
    const pageReady = deferred();
    const showStarted = deferred();
    const event = {
      id: 'ce_pending',
      type: 'play',
      title: 'Pending event',
      location: '',
      date: '',
      status: 'open',
      max: 10,
      current: 0,
      participants: [],
      participantsWithUid: [],
      delegates: [],
    };
    const previousRecord = { id: 'ce_previous' };
    const App = installModule('js/modules/event/event-detail.js', {
      api: { getEvent: () => event },
      firebase: { _registrationsFirstSnapshotReceived: true },
      after: {
        showPage: jest.fn(() => {
          showStarted.resolve();
          return pageReady.promise;
        }),
        _isGuestEventDetailView: () => true,
        _showFastEventDetailShellNow: jest.fn(() => false),
        _resetDetailAttendanceOnDemandForFreshEntry: jest.fn(),
        _syncEventEffectiveStatus: value => value,
        _getEventDetailNodes: () => ({
          title: document.getElementById('event-title'),
          image: null,
          body: document.getElementById('event-body'),
        }),
        _renderEventPublicToggle: jest.fn(),
        _renderEventRefreshButton: jest.fn(),
        _renderEventLogButton: jest.fn(),
        _favHeartHtml: () => '',
        _calcCountdown: () => '',
        _getEventActualConfirmedCount: () => 0,
        _buildGuestEventPeople: () => [],
        _getWaitlistFallbackNames: () => [],
        _getEventParticipantStats: () => ({ isCapacityFull: false, reservedRemainingCount: 0 }),
        _getEventGenderSignupState: () => ({ restricted: false, canSignup: true, requiresLogin: false, reason: '' }),
        _getEventAgeSignupState: () => ({ restricted: false, canSignup: true, requiresLogin: false, reason: '' }),
        _buildGuestEventSignupButton: () => '',
        _hasEventGenderRestriction: () => false,
        _isEventFeeEnabled: () => false,
        _getEventFeeAmount: () => 0,
        _renderHeatPrediction: () => '',
        _createEventDetailRenderToken: () => 'render-token',
        _isActivityDetailAttendanceOnDemandEnabled: () => false,
        _buildEventHostRowHtml: () => '',
        _markEventDetailContainerOwner: jest.fn(),
        _renderGuestAttendanceTable: jest.fn(),
        _renderGuestWaitlistSection: jest.fn(),
      },
    });
    App._currentDetailEventId = previousRecord.id;
    App._currentDetailEventRecord = previousRecord;
    App._currentDetailIsGuestView = false;

    const detailPromise = App.showEventDetail(event.id, { allowGuest: true });
    await Promise.race([
      showStarted.promise,
      detailPromise.then(result => { throw new Error('Event detail exited before showPage: ' + JSON.stringify(result)); }),
    ]);

    expect(App._currentDetailEventId).toBe(previousRecord.id);
    expect(App._currentDetailEventRecord).toBe(previousRecord);
    expect(App._currentDetailIsGuestView).toBe(false);

    App._pageTransitionSeq += 1;
    App.currentPage = 'page-new';
    pageReady.resolve({ ok: true });
    const result = await detailPromise;

    expect(result).toMatchObject({ ok: false, reason: 'stale_transition' });
    expect(App._currentDetailEventId).toBe(previousRecord.id);
    expect(App._currentDetailEventRecord).toBe(previousRecord);
    expect(App._currentDetailIsGuestView).toBe(false);
  });

  test('team detail keeps previous ownership while target page activation is pending', async () => {
    document.body.innerHTML = '<h1 id="team-title"></h1><div id="team-name-en"></div><div id="team-image"></div><div id="team-body"></div>';
    const pageReady = deferred();
    const showStarted = deferred();
    const team = { id: 'tm_pending', name: 'Pending team', teamExp: 0, wins: 0, draws: 0, losses: 0 };
    const App = installModule('js/modules/team/team-detail.js', {
      api: {
        getTeam: () => team,
        getTeamAsync: jest.fn(),
      },
      after: {
        showPage: jest.fn(() => {
          showStarted.resolve();
          return pageReady.promise;
        }),
        _teamMemberEditModeByTeam: {},
        _recordTeamDetailView: jest.fn(),
        _getTeamDetailNodes: () => ({
          title: document.getElementById('team-title'),
          nameEn: document.getElementById('team-name-en'),
          image: document.getElementById('team-image'),
          body: document.getElementById('team-body'),
        }),
        _refreshTeamDetailEditButton: jest.fn(),
        _canManageTeamMembers: () => false,
        _getTeamStaffIdentity: () => ({ keys: new Set(), names: new Set() }),
        _getTeamRank: () => ({ color: '', rank: '' }),
        _buildTeamDetailBodyHtml: () => '',
        _setTeamDetailV2ShellActive: jest.fn(),
        _isTeamDetailSectionVisible: () => true,
        _initEduClubDetailSection: jest.fn(),
        _syncTeamDetailV2RuntimeAfterBodyRender: jest.fn(),
        _cleanupTeamDetailV2Runtime: jest.fn(),
      },
    });
    App._teamDetailId = 'tm_previous';

    const detailPromise = App.showTeamDetail(team.id, { allowGuest: true });
    await Promise.race([
      showStarted.promise,
      detailPromise.then(result => { throw new Error('Team detail exited before showPage: ' + JSON.stringify(result)); }),
    ]);

    expect(App._teamDetailId).toBe('tm_previous');
    expect(App._initEduClubDetailSection).not.toHaveBeenCalled();

    App._pageTransitionSeq += 1;
    App.currentPage = 'page-new';
    pageReady.resolve({ ok: true });
    const result = await detailPromise;

    expect(result).toMatchObject({ ok: false, reason: 'stale_transition' });
    expect(App._teamDetailId).toBe('tm_previous');
    expect(App._initEduClubDetailSection).not.toHaveBeenCalled();
  });

  test('event write completion cannot reopen detail after a newer navigation starts', async () => {
    document.body.innerHTML = '<input id="detail-event-public-toggle" type="checkbox" checked>';
    const updateReady = deferred();
    const event = { id: 'ce_write', isPublic: false };
    const App = installModule('js/modules/event/event-detail.js', {
      api: { getEvent: () => event },
      firebase: { updateEvent: jest.fn(() => updateReady.promise) },
      after: {
        currentPage: 'page-activity-detail',
        _currentDetailEventId: event.id,
        _pageTransitionSeq: 1,
        _activePageTransitionSeq: 1,
        _canToggleEventPublic: () => true,
        showEventDetail: jest.fn(async () => ({ ok: true })),
        renderActivityList: jest.fn(),
        renderHotEvents: jest.fn(),
        renderMyActivities: jest.fn(),
      },
    });

    const writePromise = App.toggleEventPublicFromDetail();
    await Promise.resolve();
    expect(FirebaseService.updateEvent).toHaveBeenCalledWith(event.id, { isPublic: true });

    App._claimPageTransition('page-new');
    App.currentPage = 'page-new';
    updateReady.resolve();
    await writePromise;

    expect(App.showEventDetail).not.toHaveBeenCalled();
  });

  test('team upload completion cannot reopen detail after a newer navigation starts', async () => {
    const updateReady = deferred();
    const updateStarted = deferred();
    const team = { id: 'tm_upload', name: 'Upload team' };
    const App = installModule('js/modules/team/team-detail.js', {
      api: {
        updateTeamAwait: jest.fn(() => {
          updateStarted.resolve();
          return updateReady.promise;
        }),
      },
      firebase: {
        _ensureAuth: jest.fn(async () => true),
        _uploadImage: jest.fn(async () => 'https://cdn.example/avatar.webp'),
      },
      after: {
        currentPage: 'page-team-detail',
        _teamDetailId: team.id,
        _pageTransitionSeq: 1,
        _activePageTransitionSeq: 1,
        _prepareTeamAvatarDataUrl: jest.fn(async () => 'data:image/webp;base64,avatar'),
        showTeamDetail: jest.fn(async () => ({ ok: true })),
        renderTeamList: jest.fn(),
        renderTeamManage: jest.fn(),
        renderAdminTeams: jest.fn(),
      },
    });

    const uploadPromise = App._uploadTeamAvatarFile(null, team, { type: 'image/png', size: 1024 });
    await updateStarted.promise;
    App._claimPageTransition('page-new');
    App.currentPage = 'page-new';
    updateReady.resolve(team);
    await uploadPromise;

    expect(App.showTeamDetail).not.toHaveBeenCalled();
    expect(team.avatarUrl).toBe('https://cdn.example/avatar.webp');
  });

  test('course lesson roster cannot render after a newer navigation starts', async () => {
    document.body.innerHTML = '<h1 id="edu-course-lessons-title"></h1><div id="edu-course-lessons-page"></div>';
    const lessonStateReady = deferred();
    const rosterReady = deferred();
    let App;
    App = installModule('js/modules/education/edu-course-lessons.js', {
      firebase: {
        listEduCoursePublicRoster: jest.fn(() => rosterReady.promise),
      },
      after: {
        showPage: jest.fn(async (pageId, options = {}) => {
          App.currentPage = pageId;
          App._activePageTransitionSeq = Number(options?._navigationTransitionSeq) || App._pageTransitionSeq;
          return { ok: true, pageId };
        }),
        _loadEduCourseLessonsState: jest.fn(() => lessonStateReady.promise),
        _renderCourseLessonsLoading: textValue => '<div>' + textValue + '</div>',
        isEduClubStaff: () => false,
      },
    });

    const rosterPromise = App.showCourseLessonRoster('teamA', 'planA', 'sessionA');
    while (FirebaseService.listEduCoursePublicRoster.mock.calls.length === 0) {
      await Promise.resolve();
    }
    App._claimPageTransition('page-home');
    App.currentPage = 'page-home';
    lessonStateReady.resolve({ plan: { id: 'planA', planType: 'session' }, sessions: [] });
    rosterReady.resolve({
      rosterPublic: true,
      session: { id: 'sessionA', title: 'Fresh Session' },
      students: [{ studentId: 'studentA', displayName: 'Fresh Student' }],
    });

    const result = await rosterPromise;

    expect(result).toMatchObject({ ok: false, reason: 'stale_transition' });
    expect(App._abortStalePageTransition).toHaveBeenCalled();
    expect(App.currentPage).toBe('page-home');
    expect(document.getElementById('edu-course-lessons-page').innerHTML).not.toContain('Fresh Student');
  });

  test('same course lesson roster refresh cannot reclaim a newer pending navigation', async () => {
    const App = installModule('js/modules/education/edu-course-lessons.js', {
      firebase: {
        listEduCoursePublicRoster: jest.fn(),
      },
      after: {
        currentPage: 'page-edu-course-lessons',
        _eduCourseLessonsContext: { teamId: 'teamA', planId: 'planA', sessionId: 'sessionA', mode: 'roster' },
        _activePageTransitionSeq: 7,
        _pageTransitionSeq: 8,
      },
    });

    const result = await App.showCourseLessonRoster('teamA', 'planA', 'sessionA', { forceRefresh: true });

    expect(result).toMatchObject({ ok: false, reason: 'stale_transition', transitionSeq: 7 });
    expect(App.showPage).not.toHaveBeenCalled();
    expect(FirebaseService.listEduCoursePublicRoster).not.toHaveBeenCalled();
  });

  test('education detail initializes only after the team page owns the transition', async () => {
    document.body.innerHTML = '<h1 id="team-title"></h1><div id="team-name-en"></div><div id="team-image"></div><div id="team-body"></div>';
    const team = { id: 'tm_edu', name: 'Education team', teamExp: 0, wins: 0, draws: 0, losses: 0 };
    let App;
    App = installModule('js/modules/team/team-detail.js', {
      api: {
        getTeam: () => team,
        getTeamAsync: jest.fn(),
      },
      after: {
        showPage: jest.fn(async pageId => {
          App.currentPage = pageId;
          App._activePageTransitionSeq = App._pageTransitionSeq;
          return { ok: true, pageId };
        }),
        _teamMemberEditModeByTeam: {},
        _recordTeamDetailView: jest.fn(),
        _getTeamDetailNodes: () => ({
          title: document.getElementById('team-title'),
          nameEn: document.getElementById('team-name-en'),
          image: document.getElementById('team-image'),
          body: document.getElementById('team-body'),
        }),
        _refreshTeamDetailEditButton: jest.fn(),
        _canManageTeamMembers: () => false,
        _getTeamStaffIdentity: () => ({ keys: new Set(), names: new Set() }),
        _getTeamRank: () => ({ color: '', rank: '' }),
        _buildTeamDetailBodyHtml: () => '<section id="edu-detail-section"><div id="edu-detail-tab-content"></div></section>',
        _setTeamDetailV2ShellActive: jest.fn(),
        _isTeamDetailSectionVisible: () => true,
        _initEduClubDetailSection: jest.fn(),
        _renderEduTabContent: jest.fn(),
        _syncTeamDetailV2RuntimeAfterBodyRender: jest.fn(),
        _cleanupTeamDetailV2Runtime: jest.fn(),
      },
    });

    const result = await App.showTeamDetail(team.id, { allowGuest: true });

    expect(result).toMatchObject({ ok: true, reason: 'ok' });
    expect(App._teamDetailId).toBe(team.id);
    expect(App._initEduClubDetailSection).toHaveBeenCalledWith(team.id);
  });

  test('team detail resolves while deferred education scripts are still loading', async () => {
    document.body.innerHTML = '<h1 id="team-title"></h1><div id="team-name-en"></div><div id="team-image"></div><div id="team-body"></div>';
    const team = { id: 'tm_deferred', name: 'Deferred team', teamExp: 0, wins: 0, draws: 0, losses: 0 };
    const educationReady = deferred();
    const ensureGroup = jest.fn(() => educationReady.promise);
    let App;
    App = installModule('js/modules/team/team-detail.js', {
      api: {
        getTeam: () => team,
        getTeamAsync: jest.fn(),
      },
      scriptLoader: { ensureGroup },
      after: {
        showPage: jest.fn(async pageId => {
          App.currentPage = pageId;
          App._activePageTransitionSeq = App._pageTransitionSeq;
          return { ok: true, pageId };
        }),
        _teamMemberEditModeByTeam: {},
        _recordTeamDetailView: jest.fn(),
        _getTeamDetailNodes: () => ({
          title: document.getElementById('team-title'),
          nameEn: document.getElementById('team-name-en'),
          image: document.getElementById('team-image'),
          body: document.getElementById('team-body'),
        }),
        _refreshTeamDetailEditButton: jest.fn(),
        _canManageTeamMembers: () => false,
        _getTeamStaffIdentity: () => ({ keys: new Set(), names: new Set() }),
        _getTeamRank: () => ({ color: '', rank: '' }),
        _buildTeamDetailBodyHtml: () => '<section id="edu-detail-section"><div class="reg-loading">課程功能載入中</div></section>',
        _setTeamDetailV2ShellActive: jest.fn(),
        _isTeamDetailSectionVisible: () => true,
        _syncTeamDetailV2RuntimeAfterBodyRender: jest.fn(),
        _cleanupTeamDetailV2Runtime: jest.fn(),
      },
    });

    const result = await App.showTeamDetail(team.id, { allowGuest: true });

    expect(result).toMatchObject({ ok: true, reason: 'ok' });
    expect(App.currentPage).toBe('page-team-detail');
    expect(ensureGroup).toHaveBeenCalledWith('education');
    expect(document.querySelector('#edu-detail-section .reg-loading')).not.toBeNull();
  });
});
