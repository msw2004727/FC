/**
 * @jest-environment jsdom
 */

/**
 * Event Detail Button Rendering — DOM tests
 *
 * Tests the signup button state rendering logic from event-detail.js
 * in a jsdom environment. Verifies that the correct button is rendered
 * based on registration state, loading state, and event status.
 *
 * These tests focus on the regsLoading / isSignedUp / isOnWaitlist
 * decision tree that determines which button the user sees.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '../..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function loadEventDetailModule({ currentUser = null, canEdit = false } = {}) {
  const app = {
    _canEditOwnActivityBasic: jest.fn(() => canEdit),
    _canEditExternalActivity: jest.fn(() => canEdit),
  };
  vm.runInNewContext(readProjectFile('js/modules/event/event-detail.js'), {
    App: app,
    ApiService: { getCurrentUser: jest.fn(() => currentUser) },
    TYPE_CONFIG: { friendly: { label: '友誼賽' }, external: { label: '外部活動' } },
    escapeHTML: (value) => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;'),
    Object,
    console,
  });
  return app;
}

function loadEventDetailCompanionModule({
  event,
  currentUser = { uid: 'u1', displayName: 'Owner', gender: 'male' },
  companions = [{ id: 'c1', name: 'Buddy', gender: 'male' }],
  registerResult = null,
  useServerRegistration = false,
  cloudData = null,
} = {}) {
  const app = {
    _cloudReady: true,
    _requireProfileComplete: jest.fn(() => false),
    _syncEventEffectiveStatus: jest.fn(e => e),
    _isEventVisibleToUser: jest.fn(() => true),
    _canEventGenderParticipantSignup: jest.fn(() => true),
    _closeCompanionSelectModal: jest.fn(),
    _syncEventSignupScrollLock: jest.fn(),
    _releaseEventSignupScrollLock: jest.fn(),
    invalidateHomeNextActivityCache: jest.fn(),
    showToast: jest.fn(),
    showEventDetail: jest.fn(),
  };
  const ApiService = {
    getEvent: jest.fn(() => event),
    getCurrentUser: jest.fn(() => currentUser),
    getCompanions: jest.fn(() => companions),
    markEventMutationPending: jest.fn(() => 73),
    markEventMutationServerConfirmed: jest.fn(),
    markEventMutationError: jest.fn(),
    _writeErrorLog: jest.fn(),
    registerEventWithCompanions: jest.fn(() => Promise.resolve(registerResult || {
      confirmed: 1,
      waitlisted: 0,
      registrations: [{
        eventId: event.id,
        userId: currentUser.uid,
        participantType: 'companion',
        companionId: 'c1',
        companionName: 'Buddy',
        status: 'confirmed',
        id: 'reg_public_1',
        _docId: 'reg_doc_1',
      }],
    })),
  };
  const FirebaseService = {
    _cache: { registrations: [], events: [event] },
    _withSubcollectionMetadata: jest.fn((record, collectionName, eventDocIdOrPath) => ({
      ...record,
      _sourceKind: 'subcollection',
      _sourceCollection: collectionName,
      _parentPath: `events/${eventDocIdOrPath}`,
      _path: `events/${eventDocIdOrPath}/${collectionName}/${record._docId || record.id}`,
    })),
    _upsertCanonicalCacheRecord: jest.fn((name, record) => {
      FirebaseService._cache[name] = FirebaseService._cache[name] || [];
      FirebaseService._cache[name].push(record);
      return record;
    }),
    _saveToLS: jest.fn(),
  };
  const callable = jest.fn(() => Promise.resolve({
    data: cloudData || {
      confirmed: 1,
      waitlisted: 0,
      registrations: [{
        docId: 'reg_cf_doc_1',
        id: 'reg_cf_public_1',
        userId: currentUser.uid,
        participantType: 'companion',
        status: 'confirmed',
      }],
      event: {
        current: 1,
        realCurrent: 1,
        waitlist: 0,
        participants: ['Buddy'],
        waitlistNames: [],
        participantsWithUid: [{ uid: currentUser.uid, name: 'Buddy' }],
        waitlistWithUid: [],
        status: 'open',
      },
    },
  }));
  const ensureFirebaseFunctionsSdk = jest.fn(() => Promise.resolve({
    httpsCallable: jest.fn(() => callable),
  }));
  vm.runInNewContext(readProjectFile('js/modules/event/event-detail-companion.js'), {
    App: app,
    ApiService,
    FirebaseService,
    ensureFirebaseFunctionsSdk,
    shouldUseServerRegistrationForSignup: jest.fn(() => useServerRegistration),
    shouldUseServerRegistration: jest.fn(() => useServerRegistration),
    document,
    window,
    Object,
    console,
    setTimeout,
    clearTimeout,
    Promise,
    Date,
    Math,
    escapeHTML: (value) => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;'),
  }, {
    filename: 'js/modules/event/event-detail-companion.js',
  });
  return { app, ApiService, FirebaseService, ensureFirebaseFunctionsSdk, callable };
}

function loadEventManageAttendanceModule() {
  const app = {};
  vm.runInNewContext(readProjectFile('js/modules/event/event-manage-attendance.js'), {
    App: app,
    Object,
    console,
    setTimeout,
    clearTimeout,
    escapeHTML: (value) => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;'),
  });
  return app;
}

function loadEventDetailAndAttendanceModule() {
  const app = {};
  const context = {
    App: app,
    ApiService: {
      getCurrentUser: jest.fn(() => null),
      getEvent: jest.fn(() => null),
      getRegistrationsByEvent: jest.fn(() => []),
      getAttendanceRecords: jest.fn(() => []),
    },
    TYPE_CONFIG: { friendly: { label: 'friendly' }, external: { label: 'external' } },
    shouldUseActivityDetailOptimization: jest.fn(() => true),
    document,
    window,
    performance,
    requestAnimationFrame: cb => cb(),
    Object,
    console,
    setTimeout,
    clearTimeout,
    escapeHTML: (value) => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;'),
  };
  vm.runInNewContext(readProjectFile('js/modules/event/event-detail.js'), context, {
    filename: 'js/modules/event/event-detail.js',
  });
  vm.runInNewContext(readProjectFile('js/modules/event/event-manage-attendance.js'), context, {
    filename: 'js/modules/event/event-manage-attendance.js',
  });
  return { app, context };
}

function loadEventManageWaitlistModule(context) {
  const app = context.App || {};
  vm.runInNewContext(readProjectFile('js/modules/event/event-manage-waitlist.js'), {
    App: app,
    ApiService: context.ApiService,
    FirebaseService: context.FirebaseService,
    db: context.db,
    Object,
    console,
    setTimeout,
    clearTimeout,
    escapeHTML: (value) => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;'),
  });
  return app;
}

function createRosterMutationContext({ event, registrations, activityRecords, batch }) {
  const nameOf = (reg) => reg.participantType === 'companion'
    ? (reg.companionName || reg.userName)
    : reg.userName;
  const rebuildOccupancy = (_event, activeRegs) => {
    const confirmed = activeRegs.filter(r => r.status === 'confirmed');
    const waitlisted = activeRegs.filter(r => r.status === 'waitlisted');
    return {
      current: confirmed.length,
      realCurrent: confirmed.length,
      waitlist: waitlisted.length,
      participants: confirmed.map(nameOf).filter(Boolean),
      waitlistNames: waitlisted.map(nameOf).filter(Boolean),
      participantsWithUid: confirmed.map(r => ({ uid: r.userId, name: nameOf(r) })).filter(x => x.uid && x.name),
      waitlistWithUid: waitlisted.map(r => ({ uid: r.userId, name: nameOf(r) })).filter(x => x.uid && x.name),
      teamReservationSummaries: _event.teamReservationSummaries || [],
      status: confirmed.length >= (_event.max || 0) ? 'full' : 'open',
    };
  };
  const ApiService = {
    getEvent: jest.fn(() => event),
    getRegistrationsByEvent: jest.fn((eventId) => registrations
      .filter(r => r.eventId === eventId && r.status !== 'cancelled' && r.status !== 'removed')
      .map(r => ({ ...r }))),
    _src: jest.fn((key) => {
      if (key === 'registrations') return registrations;
      if (key === 'activityRecords') return activityRecords;
      return [];
    }),
    fetchRegistrationsIfMissing: jest.fn(() => Promise.resolve()),
    _writeOpLog: jest.fn(),
    markEventMutationPending: jest.fn(() => 41),
    markEventMutationServerConfirmed: jest.fn(),
    markEventMutationError: jest.fn(),
  };
  const FirebaseService = {
    _cache: { registrations, activityRecords, events: [event] },
    _rebuildOccupancy: jest.fn(rebuildOccupancy),
    _getEventDocIdAsync: jest.fn(() => Promise.resolve(event._docId)),
    _saveToLS: jest.fn(),
  };
  const collection = jest.fn(() => ({
    doc: jest.fn((id) => ({
      id,
      collection: jest.fn(() => ({
        doc: jest.fn((childId) => ({ id: childId })),
      })),
    })),
  }));
  const db = {
    batch: jest.fn(() => batch),
    collection,
  };
  const App = {
    currentPage: 'page-activity-detail',
    _currentDetailEventId: event.id,
    _canOperateEventSite: jest.fn(() => true),
    _canRemoveConfirmedParticipant: jest.fn(() => true),
    _ensureActivityRecordsReady: jest.fn(() => Promise.resolve(true)),
    _getRegistrationParticipantName: nameOf,
    appConfirm: jest.fn(() => Promise.resolve(true)),
    showToast: jest.fn(),
    _sendNotifFromTemplate: jest.fn(),
    _patchDetailCount: jest.fn(),
    _refreshSignupButton: jest.fn(),
  };
  return { App, ApiService, FirebaseService, db };
}

// ===========================================================================
// Extracted logic: button state decision (event-detail.js:295-350)
// ===========================================================================

/**
 * Determines the signup button state.
 * Returns: { type, disabled, text }
 */
function determineButtonState({
  isGuestView = false,
  isDemo = false,
  firstSnapshotReceived = false,
  retryCount = 0,
  isSignedUp = false,
  isOnWaitlist = false,
  isEnded = false,
  isUpcoming = false,
  isMainFull = false,
  teamOnlyBlocked = false,
  genderBlocked = false,
}) {
  // Fix A + Fix 1: regsLoading condition
  const regsLoading = !isGuestView && !isDemo
    && !firstSnapshotReceived
    && retryCount < 3;

  if (isGuestView) {
    return { type: 'guest', disabled: false, text: '立即報名' };
  }
  if (regsLoading) {
    return { type: 'loading', disabled: true, text: '載入中…' };
  }
  if (isEnded) {
    return { type: 'ended', disabled: true, text: '已結束' };
  }
  if (isOnWaitlist) {
    return { type: 'cancelWaitlist', disabled: false, text: '取消候補' };
  }
  if (isSignedUp) {
    return { type: 'cancelSignup', disabled: false, text: '取消報名' };
  }
  if (isUpcoming) {
    return { type: 'upcoming', disabled: true, text: '報名尚未開放' };
  }
  if (teamOnlyBlocked) {
    return { type: 'teamOnly', disabled: true, text: '球隊限定' };
  }
  if (genderBlocked) {
    return { type: 'genderBlocked', disabled: true, text: '性別限定' };
  }
  if (isMainFull) {
    return { type: 'waitlist', disabled: false, text: '報名候補' };
  }
  return { type: 'signup', disabled: false, text: '立即報名' };
}

// ===========================================================================
// TESTS
// ===========================================================================

describe('Button state: regsLoading (Fix A + Fix 1)', () => {
  test('shows loading when snapshot not received and retries < 3', () => {
    const state = determineButtonState({
      firstSnapshotReceived: false,
      retryCount: 0,
    });
    expect(state.type).toBe('loading');
    expect(state.disabled).toBe(true);
    expect(state.text).toBe('載入中…');
  });

  test('shows loading at retry count 2 (still < 3)', () => {
    const state = determineButtonState({
      firstSnapshotReceived: false,
      retryCount: 2,
    });
    expect(state.type).toBe('loading');
  });

  test('stops loading at retry count 3 (Fix 1 escape hatch)', () => {
    const state = determineButtonState({
      firstSnapshotReceived: false,
      retryCount: 3,
    });
    expect(state.type).toBe('signup'); // falls through to default
    expect(state.disabled).toBe(false);
  });

  test('not loading when snapshot received (Fix A)', () => {
    const state = determineButtonState({
      firstSnapshotReceived: true,
      retryCount: 0,
    });
    expect(state.type).toBe('signup');
  });

  test('guest view never shows loading', () => {
    const state = determineButtonState({
      isGuestView: true,
      firstSnapshotReceived: false,
      retryCount: 0,
    });
    expect(state.type).toBe('guest');
  });

  test('demo mode never shows loading', () => {
    const state = determineButtonState({
      isDemo: true,
      firstSnapshotReceived: false,
      retryCount: 0,
    });
    expect(state.type).toBe('signup');
  });
});

describe('Button state: registration status', () => {
  const base = { firstSnapshotReceived: true };

  test('signed up → cancel button', () => {
    const state = determineButtonState({ ...base, isSignedUp: true });
    expect(state.type).toBe('cancelSignup');
    expect(state.text).toBe('取消報名');
  });

  test('on waitlist → cancel waitlist button', () => {
    const state = determineButtonState({ ...base, isSignedUp: true, isOnWaitlist: true });
    expect(state.type).toBe('cancelWaitlist');
    expect(state.text).toBe('取消候補');
  });

  test('not signed up + full → waitlist button', () => {
    const state = determineButtonState({ ...base, isMainFull: true });
    expect(state.type).toBe('waitlist');
    expect(state.text).toBe('報名候補');
  });

  test('not signed up + open → signup button', () => {
    const state = determineButtonState({ ...base });
    expect(state.type).toBe('signup');
    expect(state.text).toBe('立即報名');
  });
});

describe('Button state: event lifecycle', () => {
  const base = { firstSnapshotReceived: true };

  test('ended event → disabled ended button', () => {
    const state = determineButtonState({ ...base, isEnded: true });
    expect(state.type).toBe('ended');
    expect(state.disabled).toBe(true);
  });

  test('upcoming event → disabled upcoming button', () => {
    const state = determineButtonState({ ...base, isUpcoming: true });
    expect(state.type).toBe('upcoming');
    expect(state.disabled).toBe(true);
  });
});

describe('Button state: restrictions', () => {
  const base = { firstSnapshotReceived: true };

  test('team-only blocked → disabled team-only button', () => {
    const state = determineButtonState({ ...base, teamOnlyBlocked: true });
    expect(state.type).toBe('teamOnly');
    expect(state.disabled).toBe(true);
  });

  test('gender blocked → disabled gender button', () => {
    const state = determineButtonState({ ...base, genderBlocked: true });
    expect(state.type).toBe('genderBlocked');
    expect(state.disabled).toBe(true);
  });
});

describe('Button state: priority order', () => {
  const base = { firstSnapshotReceived: true };

  test('ended takes priority over signed up', () => {
    const state = determineButtonState({ ...base, isEnded: true, isSignedUp: true });
    expect(state.type).toBe('ended');
  });

  test('signed up takes priority over upcoming after early bird signup', () => {
    const state = determineButtonState({ ...base, isUpcoming: true, isSignedUp: true });
    expect(state.type).toBe('cancelSignup');
  });

  test('waitlist takes priority over signup status', () => {
    const state = determineButtonState({ ...base, isSignedUp: true, isOnWaitlist: true });
    expect(state.type).toBe('cancelWaitlist');
  });

  test('loading takes priority over everything (except guest/demo)', () => {
    const state = determineButtonState({
      firstSnapshotReceived: false,
      retryCount: 0,
      isSignedUp: true,
      isEnded: true,
    });
    expect(state.type).toBe('loading');
  });
});

describe('DOM rendering smoke test', () => {
  test('jsdom environment is active', () => {
    expect(typeof document).toBe('object');
    expect(typeof document.createElement).toBe('function');
  });

  test('can create and query button elements', () => {
    const container = document.createElement('div');
    container.innerHTML = '<button disabled>載入中…</button>';
    document.body.appendChild(container);

    const btn = container.querySelector('button');
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe('載入中…');

    document.body.removeChild(container);
  });
});

describe('Activity detail cover edit button permissions', () => {
  test('hides the cover edit button when the user is not logged in', () => {
    const app = loadEventDetailModule({ currentUser: null, canEdit: true });

    expect(app._renderEventDetailEditButton({ id: 'event-1', type: 'friendly' })).toBe('');
  });

  test('hides the cover edit button when edit permission is not explicitly granted', () => {
    const app = loadEventDetailModule({ currentUser: { uid: 'U1' }, canEdit: false });

    expect(app._renderEventDetailEditButton({ id: 'event-1', type: 'friendly' })).toBe('');
  });

  test('renders the cover edit button only for logged-in users with edit permission', () => {
    const app = loadEventDetailModule({ currentUser: { uid: 'U1' }, canEdit: true });
    const html = app._renderEventDetailEditButton({ id: 'event-1', type: 'friendly' });

    expect(html).toContain('detail-cover-edit-btn');
    expect(html).toContain('detail-cover-edit-icon');
    expect(html).toContain('活動編輯');
  });
});

describe('Team reservation button loading contract', () => {
  test('activity detail hydrates teams before rendering staff-only team signup actions', () => {
    const detailSource = readProjectFile('js/modules/event/event-detail.js');
    const signupSource = readProjectFile('js/modules/event/event-detail-signup.js');
    const helperSource = readProjectFile('js/modules/event/event-list-helpers.js');
    const configSource = readProjectFile('js/config.js');
    const firebaseSource = readProjectFile('js/firebase-service.js');

    expect(detailSource).toContain('_ensureTeamReservationStaffTeamsLoaded');
    expect(signupSource).toContain('_getTeamReservationCandidateTeamIds');
    expect(signupSource).toContain('FirebaseService.fetchTeamIfMissing');
    expect(signupSource).toContain("FirebaseService.ensureStaticCollectionsLoaded(['teams'])");
    expect(helperSource).toContain('t._docId');
    expect(configSource).toContain("'page-activity-detail':    { required: ['events'], optional: ['teams', 'registrations'");
    expect(firebaseSource).toContain("'page-activity-detail':   ['events', 'teams', 'registrations'");
  });

  test('activity detail shows the fast shell before heavier team and roster hydration', () => {
    const detailSource = readProjectFile('js/modules/event/event-detail.js');
    const shellCall = detailSource.indexOf('_showFastEventDetailShellNow?.(id, options)');
    const staffHydrate = detailSource.indexOf('const _staffTeamsHydratePromise');
    const rosterRender = detailSource.indexOf('const renderAttendance = this._renderDetailAttendanceTable');

    expect(shellCall).toBeGreaterThan(-1);
    expect(staffHydrate).toBeGreaterThan(-1);
    expect(rosterRender).toBeGreaterThan(-1);
    expect(shellCall).toBeLessThan(staffHydrate);
    expect(shellCall).toBeLessThan(rosterRender);
    expect(detailSource).toContain('_warmEventDetailFreshData?.(id)');
    expect(detailSource).not.toContain('await this._ensureTeamReservationStaffTeamsLoaded()');
    expect(detailSource).toContain('_staffTeamsHydratePromise.then');
  });

  test('activity detail roster non-blocking path is explicit detail-only opt-in', () => {
    const detailSource = readProjectFile('js/modules/event/event-detail.js');

    expect(detailSource).toContain('_renderDetailAttendanceTable(eventId, options = {})');
    expect(detailSource).toContain("mode: 'detail'");
    expect(detailSource).toContain("_shouldUseActivityDetailOptimization('nonBlockingRender')");
    expect(detailSource).not.toContain("await this._renderAttendanceTable(id, 'detail-attendance-table')");
  });

  test('activity detail keeps signup actions loading until team staff identity resolves', () => {
    const detailSource = readProjectFile('js/modules/event/event-detail.js');
    const signupSource = readProjectFile('js/modules/event/event-detail-signup.js');

    expect(detailSource).toContain('_teamReservationStaffTeamsHydrateState');
    expect(detailSource).toContain('_eventSignupRegistrationHydrateState');
    expect(detailSource).toContain('const registrationIdentityLoading = !isGuestView');
    expect(detailSource).toContain('const signupActionsLoading = regsLoading || registrationIdentityLoading || teamReservationIdentityLoading');
    expect(detailSource).toContain('this._isTeamReservationStaffTeamsHydratingForEvent(id)');
    expect(detailSource).toContain('!signupActionsLoading && !isSignedUp');
    expect(signupSource).toContain('_shouldHoldSignupActionsForEventRegistrations');
    expect(signupSource).toContain('_ensureEventSignupRegistrationStateLoaded');
    expect(signupSource).toContain('_fetchedRegistrationServerIds');
    expect(signupSource).toContain('_registrationsServerSnapshotReceived');
    expect(signupSource).toContain('_shouldHoldSignupActionsForTeamReservationStaffHydrate');
    expect(signupSource).toContain('_isTeamReservationStaffTeamsHydratingForEvent(eventId)');
    expect(signupSource).toContain('_buildEventSignupLoadingButton');
    expect(signupSource).toContain('_buildEventSignupSyncIssueButton');
    expect(signupSource).toContain('_markEventSignupRegistrationHydrateIssue');
    expect(signupSource).toContain('opts.registrationIdentityLoading');
    expect(signupSource).toContain('opts.teamReservationIdentityLoading');
    expect(signupSource).toContain('this._ensureEventSignupRegistrationStateLoaded(e) === true');
  });

  test('activity detail roster loading has timeout fallback and manual force refresh', () => {
    const detailSource = readProjectFile('js/modules/event/event-detail.js');
    const attendanceSource = readProjectFile('js/modules/event/event-manage-attendance.js');

    expect(attendanceSource).toContain('_attendanceTableFetchTimeoutMs');
    expect(attendanceSource).toContain('_renderAttendanceLoadIssue');
    expect(attendanceSource).toContain('_scheduleAttendanceTableLatePatch');
    expect(attendanceSource).toContain('ApiService.fetchRegistrationsIfMissing(eventId, fetchOptions)');
    expect(attendanceSource).toContain('ApiService.fetchAttendanceIfMissing(eventId, fetchOptions)');
    expect(detailSource).toContain('_forceRefreshEventDetailRosterData');
    expect(detailSource).toContain('fetchRegistrationsIfMissing(eventId, {');
    expect(detailSource).toContain('fetchAttendanceIfMissing(eventId, {');
    expect(detailSource).toContain('force: true');
    expect(detailSource).toContain('await this._forceRefreshEventDetailRosterData?.(id);');
  });

  test('activity list ships and preserves an initial loading bar until events finish loading', () => {
    const activityPage = readProjectFile('pages/activity.html');
    const timelineSource = readProjectFile('js/modules/event/event-list-timeline.js');
    const activityCss = readProjectFile('css/activity.css');

    expect(activityPage).toContain('data-activity-loading="initial"');
    expect(activityPage).toContain('activity-list-loading-bar');
    expect(timelineSource).toContain('_isActivityListInitialLoading');
    expect(timelineSource).toContain('_renderActivityListLoading(container)');
    expect(activityCss).toContain('.activity-list-loading-bar');
  });

  test('activity detail keeps a below-button loading state until detail sections hydrate', () => {
    const detailSource = readProjectFile('js/modules/event/event-detail.js');
    const activityCss = readProjectFile('css/activity.css');

    expect(detailSource).toContain('_renderEventDetailBelowFoldLoadingHtml');
    expect(detailSource).toContain('data-detail-info-loading="true"');
    expect(detailSource).toContain('_preservedAttHtml || this._renderEventDetailBelowFoldLoadingHtml()');
    expect(detailSource.indexOf('id="detail-comments-container"'))
      .toBeGreaterThan(detailSource.indexOf('id="detail-waitlist-container"'));
    expect(detailSource).toContain('<div class="detail-section-title">\\u7559\\u8a00</div>');
    expect(activityCss).toContain('.event-detail-belowfold-loading');
    expect(activityCss).toContain('.event-detail-belowfold-loading .activity-list-loading-bar');
  });

  test('roster management owns waitlist edit controls and instant roster refresh', () => {
    const detailSource = readProjectFile('js/modules/event/event-detail.js');
    const waitlistSource = readProjectFile('js/modules/event/event-manage-waitlist.js');
    const attendanceSource = readProjectFile('js/modules/event/event-manage-attendance.js');
    const confirmSource = readProjectFile('js/modules/event/event-manage-confirm.js');

    expect(waitlistSource).toContain('_isRosterManagementEditing(eventId)');
    expect(waitlistSource).toContain('_renderRosterTables(eventId, options = {})');
    expect(waitlistSource).toContain('_renderRosterTables?.(eventId, { skipFetch: true })');
    expect(waitlistSource).toContain("const editBtnHtml = '';");
    expect(detailSource).toContain("const editBtnHtml = '';");
    expect(attendanceSource).toContain("_finishRosterManagement('${escapeHTML(eventId)}')");
    expect(confirmSource).toContain('this._renderWaitlistContainers?.(eventId);');
    expect(confirmSource).toContain('async _finishRosterManagement(eventId)');
  });

  test('manual waitlist promotion mutates live registration cache before local roster render', async () => {
    const event = {
      id: 'evt-live',
      _docId: 'evtDoc',
      title: 'Live roster',
      max: 2,
      current: 1,
      waitlist: 1,
      teamReservationSummaries: [],
    };
    const registrations = [
      {
        eventId: event.id,
        userId: 'u-confirmed',
        userName: 'Confirmed',
        participantType: 'self',
        status: 'confirmed',
        _docId: 'reg-confirmed',
        _path: 'events/evtDoc/registrations/reg-confirmed',
        registeredAt: '2026-01-01T00:00:00.000Z',
      },
      {
        eventId: event.id,
        userId: 'u-waitlisted',
        userName: 'Waitlisted',
        participantType: 'self',
        status: 'waitlisted',
        _docId: 'reg-waitlisted',
        _path: 'events/evtDoc/registrations/reg-waitlisted',
        registeredAt: '2026-01-02T00:00:00.000Z',
      },
    ];
    const activityRecords = [
      { eventId: event.id, uid: 'u-waitlisted', status: 'waitlisted', _docId: 'ar-waitlisted' },
    ];
    const batch = { update: jest.fn(), commit: jest.fn(() => Promise.resolve()) };
    const context = createRosterMutationContext({ event, registrations, activityRecords, batch });
    const app = loadEventManageWaitlistModule(context);
    app._renderRosterTables = jest.fn();

    await app._forcePromoteWaitlist(event.id, 'u-waitlisted');

    expect(registrations.find(r => r.userId === 'u-waitlisted').status).toBe('confirmed');
    expect(activityRecords[0].status).toBe('registered');
    expect(event.current).toBe(2);
    expect(event.waitlist).toBe(0);
    expect(app._renderRosterTables).toHaveBeenCalledWith(event.id, { skipFetch: true });
    expect(context.ApiService.markEventMutationPending).toHaveBeenCalledWith(event.id, expect.objectContaining({
      mutationType: 'waitlist-promote',
      source: 'firestore-batch',
      affectedRegistrationIds: ['reg-waitlisted'],
    }));
    expect(context.ApiService.markEventMutationServerConfirmed).toHaveBeenCalledWith(event.id, 41, expect.objectContaining({
      mutationType: 'waitlist-promote',
      source: 'firestore-batch',
    }));
    expect(batch.commit).toHaveBeenCalledTimes(1);
  });

  test('manual confirmed demotion mutates live registration cache before local roster render', async () => {
    const event = {
      id: 'evt-live',
      _docId: 'evtDoc',
      title: 'Live roster',
      max: 2,
      current: 2,
      waitlist: 0,
      teamReservationSummaries: [],
    };
    const registrations = [
      {
        eventId: event.id,
        userId: 'u-demote',
        userName: 'Demote',
        participantType: 'self',
        status: 'confirmed',
        _docId: 'reg-demote',
        _path: 'events/evtDoc/registrations/reg-demote',
        registeredAt: '2026-01-01T00:00:00.000Z',
      },
      {
        eventId: event.id,
        userId: 'u-keep',
        userName: 'Keep',
        participantType: 'self',
        status: 'confirmed',
        _docId: 'reg-keep',
        _path: 'events/evtDoc/registrations/reg-keep',
        registeredAt: '2026-01-02T00:00:00.000Z',
      },
    ];
    const activityRecords = [
      { eventId: event.id, uid: 'u-demote', status: 'registered', _docId: 'ar-demote' },
    ];
    const batch = { update: jest.fn(), commit: jest.fn(() => Promise.resolve()) };
    const context = createRosterMutationContext({ event, registrations, activityRecords, batch });
    const app = loadEventManageWaitlistModule(context);
    app._renderRosterTables = jest.fn();

    await app._forceDemoteToWaitlist(event.id, 'u-demote', 'Demote', false);

    expect(registrations.find(r => r.userId === 'u-demote').status).toBe('waitlisted');
    expect(registrations.find(r => r.userId === 'u-keep').status).toBe('confirmed');
    expect(activityRecords[0].status).toBe('waitlisted');
    expect(event.current).toBe(1);
    expect(event.waitlist).toBe(1);
    expect(app._renderRosterTables).toHaveBeenCalledWith(event.id, { skipFetch: true });
    expect(context.ApiService.markEventMutationPending).toHaveBeenCalledWith(event.id, expect.objectContaining({
      mutationType: 'waitlist-demote',
      source: 'firestore-batch',
      affectedRegistrationIds: ['reg-demote'],
    }));
    expect(context.ApiService.markEventMutationServerConfirmed).toHaveBeenCalledWith(event.id, 41, expect.objectContaining({
      mutationType: 'waitlist-demote',
      source: 'firestore-batch',
    }));
    expect(batch.commit).toHaveBeenCalledTimes(1);
  });

  test('team reservation modal does not close from backdrop clicks', () => {
    const signupSource = readProjectFile('js/modules/event/event-detail-signup.js');

    expect(signupSource).not.toContain("if(event.target===this)App.closeTeamReservationModal()");
    expect(signupSource).toContain("modal.removeAttribute('onclick')");
    expect(signupSource).toContain('class="team-reservation-close" onclick="App.closeTeamReservationModal()"');
    expect(signupSource).toContain('class="outline-btn" onclick="App.closeTeamReservationModal()"');
  });

  test('signup success releases modal scroll lock after companion or reservation flows', () => {
    const signupSource = readProjectFile('js/modules/event/event-detail-signup.js');
    const companionSource = readProjectFile('js/modules/event/event-detail-companion.js');
    const activityCss = readProjectFile('css/activity.css');

    expect(signupSource).toContain('_isEventSignupModalOpen()');
    expect(signupSource).toContain('_syncEventSignupScrollLock()');
    expect(signupSource).toContain('_releaseEventSignupScrollLock()');
    expect(signupSource).toContain("document.body.classList.remove('modal-open')");
    expect(signupSource).toContain("document.body.style.overflow = ''");
    expect(signupSource).toContain("'#companion-cancel-overlay'");
    expect(signupSource).toContain("modal.style?.display === 'none'");
    expect(signupSource).toContain('this._releaseEventSignupScrollLock?.();');
    expect(companionSource).toContain('this._syncEventSignupScrollLock?.();');
    const companionToggleSource = companionSource.slice(companionSource.lastIndexOf('async _confirmCompanionRegisterUnlocked'));
    expect(companionToggleSource).toContain('this._releaseEventSignupScrollLock?.();');
    expect(companionToggleSource).toContain('finally');
    expect(companionToggleSource).toContain('this._syncEventSignupScrollLock?.();');
    expect(activityCss).toContain('.ln-prompt-overlay');
    expect(activityCss).toContain('overflow-y: auto');
    expect(activityCss).toContain('-webkit-overflow-scrolling: touch');
  });

  test('fallback companion toggle-register confirms mutation with affected registration ids', async () => {
    document.body.innerHTML = `
      <div id="companion-select-list">
        <input type="checkbox" name="cs-participant" checked data-registered="0" data-companion-id="c1" data-name="Buddy">
      </div>
    `;
    const event = { id: 'evt-companion', _docId: 'eventDocCompanion', status: 'open', max: 10, current: 0 };
    const { app, ApiService } = loadEventDetailCompanionModule({ event });

    await app._confirmCompanionRegisterUnlocked({}, event.id);

    expect(ApiService.registerEventWithCompanions).toHaveBeenCalledWith(event.id, [{
      type: 'companion',
      companionId: 'c1',
      companionName: 'Buddy',
    }], expect.any(Object));
    expect(ApiService.markEventMutationServerConfirmed).toHaveBeenCalledWith(event.id, 73, expect.objectContaining({
      mutationType: 'companion-toggle-register',
      source: 'firestore-fallback',
      affectedRegistrationIds: expect.arrayContaining(['reg_doc_1', 'reg_public_1']),
    }));
  });

  test('callable companion toggle-register upserts returned registrations and confirms affected ids', async () => {
    document.body.innerHTML = `
      <div id="companion-select-list">
        <input type="checkbox" name="cs-participant" checked data-registered="0" data-companion-id="c1" data-name="Buddy">
      </div>
    `;
    const event = { id: 'evt-companion-cf', _docId: 'eventDocCompanionCf', status: 'open', max: 10, current: 0 };
    const { app, ApiService, FirebaseService } = loadEventDetailCompanionModule({
      event,
      useServerRegistration: true,
    });

    await app._confirmCompanionRegisterUnlocked({}, event.id);

    expect(FirebaseService._upsertCanonicalCacheRecord).toHaveBeenCalledWith(
      'registrations',
      expect.objectContaining({
        eventId: event.id,
        _docId: 'reg_cf_doc_1',
        id: 'reg_cf_public_1',
        participantType: 'companion',
        companionId: 'c1',
        companionName: 'Buddy',
        _sourceKind: 'subcollection',
      }),
      expect.objectContaining({ requireSubcollection: false })
    );
    expect(ApiService.markEventMutationServerConfirmed).toHaveBeenCalledWith(event.id, 73, expect.objectContaining({
      mutationType: 'companion-toggle-register',
      source: 'callable',
      affectedRegistrationIds: expect.arrayContaining(['reg_cf_doc_1', 'reg_cf_public_1']),
    }));
  });

  test('personal signup busy state only disables primary signup buttons', () => {
    const signupSource = readProjectFile('js/modules/event/event-detail-signup.js');
    const handleSignupSource = signupSource.slice(
      signupSource.indexOf('async handleSignup'),
      signupSource.indexOf('async handleCancelSignup')
    );

    expect(handleSignupSource).toContain("document.querySelectorAll('.detail-action-primary button')");
    expect(handleSignupSource).not.toContain("document.querySelectorAll('#detail-body button')");
  });

  test('personal signup asks for a club when multiple team reservations match', () => {
    const signupSource = readProjectFile('js/modules/event/event-detail-signup.js');
    const companionSource = readProjectFile('js/modules/event/event-detail-companion.js');
    const crudSource = readProjectFile('js/firebase-crud.js');
    const functionsSource = readProjectFile('functions/index.js');

    expect(signupSource).toContain('_resolveTeamReservationSignupChoice');
    expect(signupSource).toContain('choices.length === 1');
    expect(signupSource).toContain('team-reservation-signup-choice-modal');
    expect(signupSource).toContain('team-reservation-choice-card');
    expect(signupSource).toContain('selectTeamReservationSignupChoice');
    expect(signupSource).toContain('.team-reservation-choice-card.is-selected');
    expect(signupSource).not.toContain('name="team-reservation-signup-choice"');
    expect(signupSource).toContain('preferredTeamReservationTeamId');
    expect(companionSource).toContain('openTeamReservationSignupChoiceModal?.(eventId, reservationChoice.choices, \'companion\')');
    expect(crudSource).toContain('TEAM_RESERVATION_TEAM_DENIED');
    expect(functionsSource).toContain('safePreferredTeamReservationTeamId');
  });

  test('team reservation members keep a signup CTA even when projected capacity is full', () => {
    const detailSource = readProjectFile('js/modules/event/event-detail.js');
    const signupSource = readProjectFile('js/modules/event/event-detail-signup.js');

    expect(signupSource).toContain('_hasAvailableTeamReservationSignup');
    expect(detailSource).toContain('isMainFull && hasTeamReservationSignup');
    expect(signupSource).toContain('isMainFull && hasTeamReservationSignup');
    expect(detailSource).not.toContain('預留報名');
    expect(signupSource).not.toContain('預留報名');
    expect(detailSource).toContain('立即報名');
    expect(signupSource).toContain('立即報名');
  });

  test('team reservation header keeps the club marker while member rows stay plain', () => {
    const attendanceSource = readProjectFile('js/modules/event/event-manage-attendance.js');
    const noShowSource = readProjectFile('js/modules/event/event-manage-noshow.js');
    const activityCss = readProjectFile('css/activity.css');

    expect(noShowSource).toContain('isTeamGeneralSeparator');
    expect(noShowSource).toContain("name: '一般報名'");
    expect(noShowSource).toContain('!p.isTeamGeneralSeparator');
    expect(attendanceSource).toContain('_getTeamReservationMarkerImage');
    expect(attendanceSource).not.toContain('class="team-seat-club-marker"');
    expect(attendanceSource).not.toContain('class="team-seat-club-marker-img"');
    expect(attendanceSource).toContain('team-reservation-header-cell');
    expect(attendanceSource).toContain('team-reservation-section-title');
    expect(attendanceSource).toContain('team-reservation-section-avatar');
    expect(attendanceSource).toContain('team-reservation-section-avatar-img');
    expect(attendanceSource).toContain('team-reservation-section-name');
    expect(attendanceSource).toContain('team-reservation-summary');
    expect(attendanceSource).toContain('佔位:');
    expect(attendanceSource).toContain('已使用:');
    expect(attendanceSource).toContain('剩餘:');
    expect(attendanceSource).not.toContain('原團隊佔位：');
    expect(attendanceSource).toContain('team-reservation-member-row');
    expect(attendanceSource).toContain('team-reservation-general-row');
    expect(attendanceSource).toContain('team-reservation-placeholder-row');
    expect(attendanceSource).toContain('team-reservation-placeholder-name');
    expect(attendanceSource).toContain('const canPickTeam = _tsEnabled && !tableEditing && this._canManageTeamSplit?.(e) === true');
    expect(attendanceSource).toContain('const _canRenderTeamPicker = !!(_tsTeams && p.regDocId');
    expect(attendanceSource).toContain('canPickTeam: canPickTeam && !!p.regDocId');
    expect(attendanceSource).toContain('p.hasSelfReg || _canRenderTeamPicker');
    expect(attendanceSource).toContain('loading="lazy"');
    expect(attendanceSource).not.toContain("document.createTextNode('🚩')");
    expect(attendanceSource).not.toContain('background:#f8fbff');
    expect(attendanceSource).not.toContain('background:#eff6ff');
    expect(attendanceSource).not.toContain('teamSeatFlag');
    expect(attendanceSource).not.toContain('team-seat-flag-icon');
    expect(attendanceSource).not.toContain('<svg class="team-seat-flag-icon"');
    expect(activityCss).not.toContain('.team-seat-club-marker');
    expect(activityCss).not.toContain('.team-seat-club-marker-img');
    expect(activityCss).toContain('.team-reservation-section-title');
    expect(activityCss).toContain('.team-reservation-section-avatar');
    expect(activityCss).toContain('.team-reservation-section-avatar-img');
    expect(activityCss).toContain('.team-reservation-section-name');
    expect(activityCss).toContain('flex-wrap: nowrap');
    expect(activityCss).toContain('text-overflow: ellipsis');
    expect(activityCss).toContain('.team-reservation-member-row');
    expect(activityCss).toContain('.team-reservation-general-divider');
    expect(activityCss).toContain('border-left: 3px solid #2563eb');
    expect(activityCss).toContain('height: 1.35rem');
    expect(activityCss).toContain('object-fit: cover');
    expect(activityCss).toContain('[data-theme="dark"] .team-reservation-header-cell');
    expect(activityCss).toContain('[data-theme="dark"] .team-reservation-section-title');
    expect(activityCss).toContain('[data-theme="dark"] .team-reservation-member-row');
    expect(activityCss).toContain('[data-theme="dark"] .team-reservation-placeholder-row');
    expect(activityCss).toContain('[data-theme="dark"] .team-reservation-placeholder-name');
  });
});

describe('Attendance table debounce contract', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    document.body.innerHTML = '';
  });

  test('resolves superseded callers after the latest debounced render completes', async () => {
    jest.useFakeTimers();
    const app = loadEventManageAttendanceModule();
    app._doRenderAttendanceTable = jest.fn(async (eventId, containerId) => `${eventId}:${containerId}`);

    const first = app._renderAttendanceTable('old-event', 'detail-attendance-table');
    const second = app._renderAttendanceTable('new-event', 'detail-attendance-table');
    const firstDone = jest.fn();
    const secondDone = jest.fn();
    first.then(firstDone);
    second.then(secondDone);

    await jest.advanceTimersByTimeAsync(100);
    await Promise.resolve();

    expect(app._doRenderAttendanceTable).toHaveBeenCalledTimes(1);
    expect(app._doRenderAttendanceTable).toHaveBeenCalledWith('new-event', 'detail-attendance-table', 0, {});
    expect(firstDone).toHaveBeenCalledWith('new-event:detail-attendance-table');
    expect(secondDone).toHaveBeenCalledWith('new-event:detail-attendance-table');
  });

  test('renders skipFetch callers immediately without debounce', async () => {
    jest.useFakeTimers();
    const app = loadEventManageAttendanceModule();
    app._doRenderAttendanceTable = jest.fn(async (eventId, containerId) => `${eventId}:${containerId}`);

    const result = await app._renderAttendanceTable('event-1', 'detail-attendance-table', { skipFetch: true });

    expect(app._doRenderAttendanceTable).toHaveBeenCalledTimes(1);
    expect(app._doRenderAttendanceTable).toHaveBeenCalledWith('event-1', 'detail-attendance-table', 0, { skipFetch: true });
    expect(result).toBe('event-1:detail-attendance-table');
    expect(jest.getTimerCount()).toBe(0);
  });

  test('resolves callers when the debounced render throws', async () => {
    jest.useFakeTimers();
    const app = loadEventManageAttendanceModule();
    const err = new Error('boom');
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    app._doRenderAttendanceTable = jest.fn(async () => { throw err; });

    let result;
    const promise = app._renderAttendanceTable('event-1', 'detail-attendance-table');
    promise.then(value => { result = value; });

    await jest.advanceTimersByTimeAsync(100);
    await promise;

    expect(result).toMatchObject({ ok: false, reason: 'error', error: err });
    expect(errorSpy).toHaveBeenCalledWith('[AttendanceTable] render failed:', err);
  });
});

describe('Activity detail late patch guard', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    document.body.innerHTML = '';
  });

  test('accepts only the current page, event, request sequence, and render token', () => {
    const { app } = loadEventDetailAndAttendanceModule();
    document.body.innerHTML = '<div id="detail-attendance-table"></div>';
    app.currentPage = 'page-activity-detail';
    app._currentDetailEventId = 'event-1';
    app._eventDetailRequestSeq = 7;
    app._markEventDetailContainerOwner('detail-attendance-table', 'event-1', 7, 'rt-1', 'attendance');

    expect(app._isCurrentEventDetailPatch('event-1', 7, {
      containerId: 'detail-attendance-table',
      renderToken: 'rt-1',
    })).toMatchObject({ ok: true, reason: 'ok' });

    expect(app._isCurrentEventDetailPatch('event-2', 7, {
      containerId: 'detail-attendance-table',
      renderToken: 'rt-1',
    })).toMatchObject({ ok: false, reason: 'stale-event' });

    expect(app._isCurrentEventDetailPatch('event-1', 6, {
      containerId: 'detail-attendance-table',
      renderToken: 'rt-1',
    })).toMatchObject({ ok: false, reason: 'stale-seq' });

    expect(app._isCurrentEventDetailPatch('event-1', 7, {
      containerId: 'detail-attendance-table',
      renderToken: 'rt-old',
    })).toMatchObject({ ok: false, reason: 'stale-render-token' });

    app.currentPage = 'page-home';
    expect(app._isCurrentEventDetailPatch('event-1', 7, {
      containerId: 'detail-attendance-table',
      renderToken: 'rt-1',
    })).toMatchObject({ ok: false, reason: 'stale-page' });
  });

  test('detail attendance render refuses stale container writes', async () => {
    const { app } = loadEventDetailAndAttendanceModule();
    document.body.innerHTML = '<div id="detail-attendance-table">keep</div>';
    app.currentPage = 'page-activity-detail';
    app._currentDetailEventId = 'event-current';
    app._eventDetailRequestSeq = 2;
    app._markEventDetailContainerOwner('detail-attendance-table', 'event-current', 2, 'rt-current', 'attendance');

    const result = await app._doRenderAttendanceTable('event-old', 'detail-attendance-table', 0, {
      mode: 'detail',
      requestSeq: 1,
      renderToken: 'rt-old',
    });

    expect(result).toMatchObject({ ok: false, reason: 'stale-event' });
    expect(document.getElementById('detail-attendance-table').innerHTML).toBe('keep');
  });

  test('detail roster split renders server registrations without waiting for attendance records', async () => {
    const { app, context } = loadEventDetailAndAttendanceModule();
    document.body.innerHTML = '<div id="detail-attendance-table"></div>';
    app.currentPage = 'page-activity-detail';
    app._currentDetailEventId = 'event-1';
    app._eventDetailRequestSeq = 1;
    app._markEventDetailContainerOwner('detail-attendance-table', 'event-1', 1, 'rt-1', 'attendance');
    app._canOperateEventSite = jest.fn(() => false);
    app._buildConfirmedParticipantSummary = jest.fn(() => ({
      count: regs.length,
      people: regs.map(reg => ({
        uid: reg.uid,
        name: reg.name,
        displayName: reg.name,
        hasSelfReg: false,
        displayBadges: [],
      })),
    }));

    let regs = [];
    context.ApiService.getEvent = jest.fn(() => ({ id: 'event-1', current: 1, max: 8 }));
    context.ApiService.getRegistrationsByEvent = jest.fn(() => regs);
    context.ApiService.getAttendanceRecords = jest.fn(() => []);
    context.ApiService.fetchRegistrationsIfMissing = jest.fn(async () => {
      regs = [{ uid: 'u1', userId: 'u1', name: 'Server User', status: 'confirmed' }];
      return { ok: true, source: 'server' };
    });
    context.ApiService.fetchAttendanceIfMissing = jest.fn(() => new Promise(() => {}));

    await app._doRenderAttendanceTable('event-1', 'detail-attendance-table', 0, {
      mode: 'detail',
      requestSeq: 1,
      renderToken: 'rt-1',
    });

    expect(context.ApiService.fetchRegistrationsIfMissing).toHaveBeenCalledTimes(1);
    expect(context.ApiService.fetchAttendanceIfMissing).toHaveBeenCalledTimes(1);
    expect(document.getElementById('detail-attendance-table').textContent).toContain('Server User');
  });

  test('attendance records background patch respects the current render token', async () => {
    const { app, context } = loadEventDetailAndAttendanceModule();
    document.body.innerHTML = '<div id="detail-attendance-table">current</div>';
    app.currentPage = 'page-activity-detail';
    app._currentDetailEventId = 'event-1';
    app._eventDetailRequestSeq = 1;
    app._markEventDetailContainerOwner('detail-attendance-table', 'event-1', 1, 'rt-current', 'attendance');
    let resolveAttendance;
    context.ApiService.fetchAttendanceIfMissing = jest.fn(() => new Promise(resolve => {
      resolveAttendance = resolve;
    }));
    const renderSpy = jest.spyOn(app, '_renderAttendanceTable');

    const patchPromise = app._scheduleDetailAttendanceRecordsPatch('event-1', 'detail-attendance-table', {}, {
      mode: 'detail',
      requestSeq: 1,
      renderToken: 'rt-old',
    });
    resolveAttendance({ ok: true });
    const result = await patchPromise;

    expect(result).toMatchObject({ ok: false, reason: 'stale-render-token' });
    expect(renderSpy).not.toHaveBeenCalled();
    expect(document.getElementById('detail-attendance-table').innerHTML).toBe('current');
  });

  test('attendance late retry fallback keeps the original render token', async () => {
    jest.useFakeTimers();
    const { app, context } = loadEventDetailAndAttendanceModule();
    document.body.innerHTML = '<div id="detail-attendance-table">current</div>';
    app.currentPage = 'page-activity-detail';
    app._currentDetailEventId = 'event-1';
    app._eventDetailRequestSeq = 1;
    app._markEventDetailContainerOwner('detail-attendance-table', 'event-1', 1, 'rt-current', 'attendance');
    context.ApiService.getEvent = jest.fn(() => ({ id: 'event-1', current: 1, max: 8 }));
    context.ApiService.getRegistrationsByEvent = jest.fn(() => [{ eventId: 'event-1', status: 'confirmed' }]);
    const renderSpy = jest.spyOn(app, '_renderAttendanceTable');

    app._scheduleAttendanceTableLatePatch('event-1', 'detail-attendance-table', {
      mode: 'detail',
      requestSeq: 1,
      renderToken: 'rt-old',
    });
    await jest.advanceTimersByTimeAsync(1800);

    expect(renderSpy).not.toHaveBeenCalled();
    expect(document.getElementById('detail-attendance-table').innerHTML).toBe('current');
  });

  test('detail waitlist and unregistered patches refuse stale render tokens', () => {
    const { app, context } = loadEventDetailAndAttendanceModule();
    document.body.innerHTML = '<div id="detail-waitlist-container">waitlist-current</div><div id="detail-unreg-table">unreg-current</div>';
    app.currentPage = 'page-activity-detail';
    app._currentDetailEventId = 'event-1';
    app._eventDetailRequestSeq = 1;
    app._markEventDetailContainerOwner('detail-waitlist-container', 'event-1', 1, 'rt-current', 'waitlist');
    app._markEventDetailContainerOwner('detail-unreg-table', 'event-1', 1, 'rt-current', 'unregistered');
    context.ApiService.getEvent = jest.fn(() => ({ id: 'event-1', current: 1, waitlist: 1 }));

    const waitlistResult = app._renderGroupedWaitlistSection('event-1', 'detail-waitlist-container', {
      mode: 'detail',
      requestSeq: 1,
      renderToken: 'rt-old',
    });
    const unregResult = app._renderUnregTable('event-1', 'detail-unreg-table', {
      mode: 'detail',
      requestSeq: 1,
      renderToken: 'rt-old',
    });

    expect(waitlistResult).toMatchObject({ ok: false, reason: 'stale-render-token' });
    expect(unregResult).toMatchObject({ ok: false, reason: 'stale-render-token' });
    expect(document.getElementById('detail-waitlist-container').innerHTML).toBe('waitlist-current');
    expect(document.getElementById('detail-unreg-table').innerHTML).toBe('unreg-current');
  });

  test('detail signup action and count patches refuse stale render tokens', () => {
    const { app, context } = loadEventDetailAndAttendanceModule();
    vm.runInNewContext(readProjectFile('js/modules/event/event-detail-signup.js'), context, {
      filename: 'js/modules/event/event-detail-signup.js',
    });
    document.body.innerHTML = `
      <div id="detail-body"><div class="detail-grid"><div class="detail-row"><span class="detail-label">\u4EBA\u6578</span>old-count</div></div></div>
      <div id="detail-action-primary" class="detail-action-primary">old-action</div>`;
    app.currentPage = 'page-activity-detail';
    app._currentDetailEventId = 'event-1';
    app._eventDetailRequestSeq = 1;
    app._markEventDetailContainerOwner('detail-body', 'event-1', 1, 'rt-current', 'body');
    app._markEventDetailContainerOwner('detail-action-primary', 'event-1', 1, 'rt-current', 'actions');
    context.ApiService.getEvent = jest.fn(() => ({ id: 'event-1', current: 2, max: 8, waitlist: 0, status: 'open' }));

    const actionResult = app._refreshSignupButton('event-1', {
      requestSeq: 1,
      renderToken: 'rt-old',
    });
    const countResult = app._patchDetailCount('event-1', {
      requestSeq: 1,
      renderToken: 'rt-old',
    });

    expect(actionResult).toMatchObject({ ok: false, reason: 'stale-render-token' });
    expect(countResult).toMatchObject({ ok: false, reason: 'stale-render-token' });
    expect(document.getElementById('detail-action-primary').innerHTML).toBe('old-action');
    expect(document.getElementById('detail-body').textContent).toContain('old-count');
  });

  test('latePatchGuard flag off explicitly bypasses detail late patch guards', () => {
    const { app, context } = loadEventDetailAndAttendanceModule();
    vm.runInNewContext(readProjectFile('js/modules/event/event-detail-signup.js'), context, {
      filename: 'js/modules/event/event-detail-signup.js',
    });
    context.shouldUseActivityDetailOptimization = jest.fn(flag => flag === 'latePatchGuard' ? false : true);
    document.body.innerHTML = `
      <div id="detail-body"><div class="detail-grid"><div class="detail-row"><span class="detail-label">\u4EBA\u6578</span>old-count</div></div></div>
      <div id="detail-action-primary" class="detail-action-primary">old-action</div>
      <div id="detail-attendance-table">attendance-current</div>
      <div id="detail-unreg-section"><div id="detail-unreg-table">unreg-current</div></div>
      <div id="detail-waitlist-container">waitlist-current</div>`;
    app.currentPage = 'page-activity-detail';
    app._currentDetailEventId = 'event-1';
    app._eventDetailRequestSeq = 1;
    app._markEventDetailContainerOwner('detail-body', 'event-1', 1, 'rt-current', 'body');
    app._markEventDetailContainerOwner('detail-action-primary', 'event-1', 1, 'rt-current', 'actions');
    app._markEventDetailContainerOwner('detail-attendance-table', 'event-1', 1, 'rt-current', 'attendance');
    app._markEventDetailContainerOwner('detail-unreg-table', 'event-1', 1, 'rt-current', 'unregistered');
    app._markEventDetailContainerOwner('detail-waitlist-container', 'event-1', 1, 'rt-current', 'waitlist');
    context.ApiService.getEvent = jest.fn(() => ({ id: 'event-1', current: 2, max: 8, waitlist: 0, status: 'open', waitlistNames: [] }));
    context.ApiService.getRegistrationsByEvent = jest.fn(() => []);
    context.ApiService.getAttendanceRecords = jest.fn(() => []);
    app._isUserSignedUp = jest.fn(() => false);
    app._isUserOnWaitlist = jest.fn(() => false);
    app._getEventGenderSignupState = jest.fn(() => ({ restricted: false, canSignup: true, requiresLogin: false, reason: '' }));
    app._canSignupTeamOnlyEvent = jest.fn(() => true);
    app._buildConfirmedParticipantSummary = jest.fn(() => ({ count: 2 }));

    const attendanceGuard = app._canPatchAttendanceTable('event-1', 'detail-attendance-table', document.getElementById('detail-attendance-table'), {
      mode: 'detail',
      requestSeq: 1,
      renderToken: 'rt-old',
    });
    const waitlistResult = app._renderGroupedWaitlistSection('event-1', 'detail-waitlist-container', {
      mode: 'detail',
      requestSeq: 1,
      renderToken: 'rt-old',
    });
    app._renderUnregTable('event-1', 'detail-unreg-table', {
      mode: 'detail',
      requestSeq: 1,
      renderToken: 'rt-old',
    });
    app._refreshSignupButton('event-1', {
      requestSeq: 1,
      renderToken: 'rt-old',
    });
    app._patchDetailCount('event-1', {
      requestSeq: 1,
      renderToken: 'rt-old',
    });

    expect(attendanceGuard).toMatchObject({ ok: true, reason: 'ok' });
    expect(waitlistResult).toMatchObject({ ok: true, reason: 'ok' });
    expect(document.getElementById('detail-waitlist-container').innerHTML).toBe('');
    expect(document.getElementById('detail-unreg-table').innerHTML).toBe('');
    expect(document.getElementById('detail-action-primary').textContent).toContain('立即報名');
    expect(document.getElementById('detail-body').textContent).toContain('已報 2/8');
  });

  test('manual refresh patch updates mutable detail fields without full page rerender', () => {
    const { app, context } = loadEventDetailAndAttendanceModule();
    document.body.innerHTML = `
      <div id="detail-title">Old title</div>
      <div id="detail-public-toggle-wrap"></div>
      <div id="detail-img-placeholder"></div>
      <div id="detail-body">
        <div class="detail-row detail-row-wide" data-detail-field="location"><span class="detail-label">\u5730\u9EDE</span>Old place</div>
        <div class="detail-row detail-row-wide" data-detail-field="date"><span class="detail-label">\u6642\u9593</span>Old date</div>
        <div class="detail-row detail-row-wide" data-detail-field="registration-open"><span class="detail-label">\u958B\u653E\u5831\u540D</span>old open</div>
        <div class="detail-grid"><div class="detail-row"><span class="detail-label">\u8CBB\u7528</span>old fee</div><div class="detail-row"><span class="detail-label">\u4EBA\u6578</span>old-count</div></div>
        <div class="detail-row detail-row-wide detail-host-row" data-detail-field="host"><span class="detail-label">\u4E3B\u8FA6</span>old host</div>
        <div class="detail-row detail-row-wide" data-detail-field="contact"><span class="detail-label">\u806F\u7E6B</span>old contact</div>
        <div class="detail-section" data-detail-field="notes"><div class="detail-section-title">old notes</div><p>old notes body</p></div>
        <div class="detail-action-zone"><div id="detail-action-primary"></div></div>
        <div id="detail-attendance-table"></div>
        <div id="detail-unreg-table"></div>
        <div id="detail-waitlist-container"></div>
      </div>`;
    app.currentPage = 'page-activity-detail';
    app._currentDetailEventId = 'event-1';
    app._eventDetailRequestSeq = 7;
    app._markEventDetailContainerOwner('detail-body', 'event-1', 7, 'rt-1', 'body');
    app._renderEventDetailCover = jest.fn(() => '<img alt="cover">');
    app._renderEventPublicToggle = jest.fn();
    app._renderEventRefreshButton = jest.fn();
    app._renderEventLogButton = jest.fn();
    app._favHeartHtml = jest.fn(() => '');
    app.isEventFavorited = jest.fn(() => false);
    app._userTag = jest.fn((name) => `<span>${name}</span>`);
    app._calcCountdown = jest.fn(() => '5 天');
    app._buildConfirmedParticipantSummary = jest.fn(() => ({ count: 4 }));
    app._getEventWaitlistDisplayCount = jest.fn(() => 1);
    app._isEventFeeEnabled = jest.fn(() => true);
    app._getEventFeeAmount = jest.fn(() => 300);
    app._patchDetailTables = jest.fn();
    app._patchDetailCount = jest.fn();
    app._refreshSignupButton = jest.fn();
    app.showEventDetail = jest.fn();
    context.ApiService.getEvent = jest.fn(() => null);

    const result = app._patchCurrentEventDetailInfoFromRecord({
      id: 'event-1',
      title: 'Fresh title',
      location: 'Fresh field',
      date: '2026/06/01 19:00',
      regOpenTime: '2026-05-30T10:00:00+08:00',
      status: 'open',
      max: 12,
      fee: 300,
      creator: 'Fresh Host',
      creatorUid: 'host-1',
      contact: 'Line: @fresh',
      notes: 'Fresh notes',
    }, {
      requestSeq: 7,
      renderToken: 'rt-1',
    });

    const text = document.getElementById('detail-body').textContent;
    expect(result).toMatchObject({ ok: true, reason: 'ok' });
    expect(document.getElementById('detail-title').textContent).toContain('Fresh title');
    expect(text).toContain('Fresh field');
    expect(text).toContain('2026/06/01 19:00');
    expect(text).toContain('開放報名');
    expect(text).toContain('NT$300');
    expect(text).toContain('Line: @fresh');
    expect(text).toContain('注意事項');
    expect(text).toContain('Fresh notes');
    expect(app.showEventDetail).not.toHaveBeenCalled();

    const detailSource = readProjectFile('js/modules/event/event-detail.js');
    const patchSource = detailSource.slice(
      detailSource.indexOf('_patchCurrentEventDetailInfoFromRecord'),
      detailSource.indexOf('_showFastEventDetailShellNow')
    );
    expect(patchSource).not.toContain('\u761c\u51bd');
    expect(patchSource).not.toContain('${escapeHTML(e.location || \'\')} ??');
    expect(patchSource).toContain('\\u6CE8\\u610F\\u4E8B\\u9805');
  });

  test('manual refresh reads the event doc from server and patches locally', async () => {
    const { app, context } = loadEventDetailAndAttendanceModule();
    document.body.innerHTML = '<button class="event-detail-refresh-btn"></button>';
    app._currentDetailEventId = 'event-1';
    app._eventDetailRequestSeq = 3;
    app._forceRefreshEventDetailRosterData = jest.fn(() => Promise.resolve([]));
    app._patchCurrentEventDetailInfoFromRecord = jest.fn(() => ({ ok: true, reason: 'ok' }));
    app._updateRouteMetaTags = jest.fn();
    app._markPageSnapshotReady = jest.fn();
    app.showEventDetail = jest.fn();
    context.ApiService.getEvent = jest.fn(() => ({ id: 'event-1', _docId: 'event-doc-1' }));
    context.ApiService.markEventDocRefreshing = jest.fn();
    context.ApiService.markEventDocServerFresh = jest.fn();
    const get = jest.fn(() => Promise.resolve({
      exists: true,
      id: 'event-doc-1',
      data: () => ({ id: 'event-1', title: 'Fresh title' }),
    }));
    context.FirebaseService = {
      _upsertCollectionDoc: jest.fn((_collection, record) => record),
    };
    context.db = {
      collection: jest.fn(() => ({
        doc: jest.fn(() => ({ get })),
        where: jest.fn(),
      })),
    };

    const result = await app._refreshEventDetail();

    expect(result).toMatchObject({ ok: true, reason: 'ok' });
    expect(get).toHaveBeenCalledWith({ source: 'server' });
    expect(context.ApiService.markEventDocServerFresh).toHaveBeenCalledWith('event-1', expect.objectContaining({
      source: 'server',
      docId: 'event-doc-1',
      fromCache: false,
    }));
    expect(app._forceRefreshEventDetailRosterData).toHaveBeenCalledWith('event-1');
    expect(app._patchCurrentEventDetailInfoFromRecord).toHaveBeenCalledWith(expect.objectContaining({
      id: 'event-1',
      title: 'Fresh title',
    }), expect.objectContaining({
      requestSeq: 3,
    }));
    expect(app.showEventDetail).not.toHaveBeenCalled();
  });

  test('manual refresh does not mark route ready when server doc is missing or patch is stale', async () => {
    const { app } = loadEventDetailAndAttendanceModule();
    document.body.innerHTML = '<button class="event-detail-refresh-btn"></button>';
    app._currentDetailEventId = 'event-1';
    app._eventDetailRequestSeq = 3;
    app._fetchEventDetailDocFromServer = jest.fn(() => Promise.resolve(null));
    app._forceRefreshEventDetailRosterData = jest.fn();
    app._patchCurrentEventDetailInfoFromRecord = jest.fn();
    app._updateRouteMetaTags = jest.fn();
    app._markPageSnapshotReady = jest.fn();
    app.showToast = jest.fn();

    const missingResult = await app._refreshEventDetail();

    expect(missingResult).toMatchObject({ ok: false, reason: 'event-doc-not-found' });
    expect(app._forceRefreshEventDetailRosterData).not.toHaveBeenCalled();
    expect(app._patchCurrentEventDetailInfoFromRecord).not.toHaveBeenCalled();
    expect(app._updateRouteMetaTags).not.toHaveBeenCalled();
    expect(app._markPageSnapshotReady).not.toHaveBeenCalled();

    app._fetchEventDetailDocFromServer = jest.fn(() => Promise.resolve({ id: 'event-1', title: 'Fresh title' }));
    app._forceRefreshEventDetailRosterData = jest.fn(() => Promise.resolve([]));
    app._patchCurrentEventDetailInfoFromRecord = jest.fn(() => ({ ok: false, reason: 'stale-render-token' }));

    const staleResult = await app._refreshEventDetail();

    expect(staleResult).toMatchObject({ ok: false, reason: 'stale-render-token' });
    expect(app._updateRouteMetaTags).not.toHaveBeenCalled();
    expect(app._markPageSnapshotReady).not.toHaveBeenCalled();
  });

  test('commentsNonBlocking flag off keeps comments in the awaited route-ready path', () => {
    const detailSource = readProjectFile('js/modules/event/event-detail.js');
    expect(detailSource).toContain('const commentsRender = this._renderDetailComments(id, {');
    expect(detailSource).toContain("!this._shouldUseActivityDetailOptimization('commentsNonBlocking')");
    expect(detailSource).toContain('await commentsRender;');
    expect(detailSource.indexOf('await commentsRender;'))
      .toBeLessThan(detailSource.indexOf("this._setRouteUrl?.({ pageId: 'page-activity-detail', id }"));
  });

  test('comments on-demand loader failure is isolated to the comments container', async () => {
    const { app, context } = loadEventDetailAndAttendanceModule();
    document.body.innerHTML = '<div id="detail-comments-container">loading</div><div id="detail-attendance-table">roster</div>';
    app.currentPage = 'page-activity-detail';
    app._currentDetailEventId = 'event-1';
    app._eventDetailRequestSeq = 1;
    app._markEventDetailContainerOwner('detail-comments-container', 'event-1', 1, 'rt-1', 'comments');
    context.getActivityDetailOptimizationFlags = jest.fn(() => ({ commentsLoadMode: 'on-demand' }));
    context.ScriptLoader = {
      ensureGroup: jest.fn(() => Promise.reject(new Error('chunk fail'))),
    };
    app._renderEventCommentsLoadIssue = jest.fn(() => {
      document.getElementById('detail-comments-container').textContent = 'failed comments';
    });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await app._renderDetailComments('event-1', {
      requestSeq: 1,
      renderToken: 'rt-1',
    });
    await Promise.resolve();

    expect(context.ScriptLoader.ensureGroup).toHaveBeenCalledWith('activityComments');
    expect(app._renderEventCommentsLoadIssue).toHaveBeenCalledWith('event-1', { final: true });
    expect(document.getElementById('detail-comments-container').textContent).toBe('failed comments');
    expect(document.getElementById('detail-attendance-table').textContent).toBe('roster');
    errorSpy.mockRestore();
  });
});

describe('Activity detail host contact and companion action labels', () => {
  test('renders host contact with event context and renames companion signup action', () => {
    const detailSource = readProjectFile('js/modules/event/event-detail.js');
    const profileCardSource = readProjectFile('js/modules/profile/profile-card.js');

    expect(detailSource).toContain('contactEventOrganizer(${escapeHTML(JSON.stringify({ eventId: e.id');
    expect(detailSource).toContain('companion-signup-toolbar-action');
    expect(detailSource).toContain('\\u5BEB\\u5165\\u4E2D');
    expect(detailSource).toContain('\\u5E6B\\u5925\\u4F34\\u5831\\u540D');
    expect(detailSource).not.toContain('\\u540C\\u884C\\u5831\\u540D');
    expect(profileCardSource).toContain('_normalizeLineContactUrl');
    expect(profileCardSource).toContain('ApiService.getEvent(eventId)');
    expect(profileCardSource).toContain("window.open(lineUrl, 'sporthub_line')");
    expect(profileCardSource).toContain("allowGuest: true");
  });

  test('companion signup and mixed cancel flows expose precise busy and warning states', () => {
    const companionSource = readProjectFile('js/modules/event/event-detail-companion.js');
    const activeOpenSource = companionSource.slice(companionSource.lastIndexOf('_openCompanionSelectModal'));
    const activityCss = readProjectFile('css/activity.css');

    expect(activeOpenSource).toContain("confirmBtn.textContent = '\\u78BA\\u8A8D'");
    expect(activeOpenSource).not.toContain('\\u78ba\\u8a8d\\u8abf\\u6574');
    expect(companionSource).toContain('_startCompanionSignupToolbarGlow');
    expect(companionSource).toContain('_startCancelSignupActionGlow');
    expect(companionSource).toContain('_updateCompanionCancelWarn');
    expect(companionSource).toContain('\\u6CE8\\u610F\\uFF1A\\u78BA\\u8A8D\\u53D6\\u6D88\\u5F8C\\u5C07\\u6703\\u53D6\\u6D88');
    expect(companionSource).toContain('onchange="App._updateCompanionCancelWarn()"');
    expect(activityCss).toContain('.detail-action-toolbar .signup-glow-wrap');
  });
});

describe('Activity edit save refresh', () => {
  test('event edit save re-renders the current activity detail page', () => {
    const createSource = readProjectFile('js/modules/event/event-create.js');

    expect(createSource).toContain("this.currentPage === 'page-activity-detail'");
    expect(createSource).toContain('this._currentDetailEventId === editedId');
    expect(createSource).toContain('await this.showEventDetail(editedId)');
    expect(createSource).toContain("post-edit detail refresh failed");
  });
});
