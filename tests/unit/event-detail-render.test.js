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
    const rosterRender = detailSource.indexOf("await this._renderAttendanceTable(id, 'detail-attendance-table')");

    expect(shellCall).toBeGreaterThan(-1);
    expect(staffHydrate).toBeGreaterThan(-1);
    expect(rosterRender).toBeGreaterThan(-1);
    expect(shellCall).toBeLessThan(staffHydrate);
    expect(shellCall).toBeLessThan(rosterRender);
    expect(detailSource).toContain('_warmEventDetailFreshData?.(id)');
    expect(detailSource).not.toContain('await this._ensureTeamReservationStaffTeamsLoaded()');
    expect(detailSource).toContain('_staffTeamsHydratePromise.then');
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
    expect(detailSource).toContain('團隊預留報名');
    expect(signupSource).toContain('團隊預留報名');
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
    expect(app._doRenderAttendanceTable).toHaveBeenCalledWith('new-event', 'detail-attendance-table', 0);
    expect(firstDone).toHaveBeenCalledWith('new-event:detail-attendance-table');
    expect(secondDone).toHaveBeenCalledWith('new-event:detail-attendance-table');
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
