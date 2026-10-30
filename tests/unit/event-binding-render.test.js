/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { parse } = require('@babel/parser');

const ROOT = path.join(__dirname, '../..');
const VALUES = ["');window.__x=1;('", "O'Brien \\' \" &amp;\n\u2028</script>"];

function load(file, api = {}, setup) {
  const app = {};
  const context = vm.createContext({
    App: app, ApiService: api, document, window, console,
    setTimeout, clearTimeout, localStorage, performance, I18N: { t: key => key }, t: key => key,
  });
  for (const name of ['js/config.js', 'js/modules/' + file]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, name), 'utf8'), context, { filename: name });
  }
  if (setup) setup(context);
  return app;
}

function mount(html) {
  document.body.innerHTML = html;
}

function activate(app, selector, method, expected, type = 'click') {
  const element = document.querySelector(selector);
  expect(element).not.toBeNull();
  const source = element.getAttribute('on' + type);
  expect(typeof source).toBe('string');
  const methods = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && node.callee.object.name === 'App') methods.push(node.callee.property.name);
    Object.values(node).forEach(child => Array.isArray(child) ? child.forEach(visit) : child && typeof child.type === 'string' && visit(child));
  }
  visit(parse(source));
  expect(methods).toEqual([method]);
  const call = jest.fn();
  app[method] = call;
  const execute = new Function('App', 'window', 'event', 'document', source);
  const count = document.querySelectorAll('*').length;
  delete window.__x;
  const event = new Event(type);
  Object.defineProperty(event, 'target', { value: element });
  execute.call(element, app, window, event, document);
  expect(call).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledWith(...expected(element));
  expect(window.__x).toBeUndefined();
  call.mockClear();
  element['on' + type] = function (event) { return execute.call(this, app, window, event, document); };
  if (type === 'click') element.click();
  else element.dispatchEvent(new Event(type));
  expect(call).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledWith(...expected(element));
  expect(window.__x).toBeUndefined();
  expect(document.querySelectorAll('*').length).toBe(count);
}

afterEach(() => { document.body.innerHTML = ''; delete window.__x; });

describe.each(VALUES)('事件繫結強化：模組資料 %p', value => {
  test('event-detail：報名與候補名單', () => {
    const record = { id: 'event-1', participantsWithUid: [{ uid: value, name: value }], waitlistWithUid: [{ uid: value, name: value }] };
    const app = load('event/event-detail.js', { getEvent: () => record });
    app._isActivityDetailAttendanceOnDemandEnabled = () => false;
    mount('<div id="roster"></div><div id="waitlist"></div>');
    app._renderGuestAttendanceTable('event-1', 'roster', { forceFullAttendance: true });
    app._renderGuestWaitlistSection('event-1', 'waitlist');
    expect(document.getElementById('roster').textContent).toContain(value);
    activate(app, '#roster .user-capsule', 'showUserProfile', () => [value, { uid: value }]);
    activate(app, '#waitlist .user-capsule', 'showUserProfile', () => [value, { uid: value }]);
  });

  test('event-comments：留言作者與回覆', () => {
    const app = load('event/event-comments.js');
    const comment = { id: value, authorName: value, authorUid: value, body: value, replies: [{ id: value, body: value, authorName: value }], likers: [] };
    mount(app._renderEventCommentCard({ id: value }, comment, { closed: false, canManage: true }));
    activate(app, '.event-comment-author', 'showUserProfile', () => [value, { uid: value, allowGuest: true }]);
    activate(app, '.event-comment-reply-like', '_toggleEventCommentReplyLike', () => [value, value, value]);
  });

  test('event-detail-signup：俱樂部確認', () => {
    const app = load('event/event-detail-signup.js');
    app.openTeamReservationSignupChoiceModal(value, [{ teamId: value, teamName: value }]);
    expect(document.querySelector('.team-reservation-choice-name').textContent).toBe(value);
    activate(app, '#team-reservation-signup-choice-confirm-btn', 'confirmTeamReservationSignupChoice', () => [value, 'signup']);
  });

  test('event-manage-attendance：團隊報名名單', async () => {
    const app = load('event/event-manage-attendance.js', {
      getEvent: () => ({ id: value, title: value, max: 5 }),
      getRegistrationsByEvent: () => [],
    });
    Object.assign(app, {
      _canPatchAttendanceTable: () => ({ ok: true }),
      _canOperateEventSite: () => true,
      _buildConfirmedParticipantSummary: () => ({ people: [{ isTeamHeader: true, teamReservationTeamId: value, teamReservationTeamName: value }] }),
      _isCurrentUserTeamStaff: () => true,
      _bindAttendanceCheckboxLink: jest.fn(), _bindBadgeRowSnapBack: jest.fn(), _markBadgeRowOverflow: jest.fn(),
    });
    mount('<div id="roster"></div>');
    await app._doRenderAttendanceTable(value, 'roster', 0, { skipFetch: true, publicRosterOnly: true });
    expect(document.querySelector('.team-reservation-section-name').textContent).toBe(value);
    activate(app, '.team-reservation-adjust-btn', 'openTeamReservationModal', () => [value, value]);
  });

  test('event-manage：主辦人篩選', () => {
    const app = load('event/event-manage.js', { getEvents: () => [{ creator: value }] });
    mount('<input id="my-activity-creator-input"><div id="my-activity-creator-dropdown"></div>');
    document.querySelector('input').value = value.slice(0, 2);
    app.searchCreatorFilter();
    expect(document.querySelector('.ce-delegate-item-name').textContent).toBe(value);
    activate(app, '.ce-delegate-item', '_selectCreatorFilter', () => [value]);
  });

  test('event-team-split：批次操作', () => {
    const app = load('event/event-team-split.js');
    app._canManageTeamSplit = () => true;
    mount(app._tsRenderBatchButtons({ id: value, title: value, teamSplit: { enabled: true } }));
    activate(app, '.batch-btn', '_tsBatchRandom', () => [value]);
  });

  test('team-detail-render：活動卡', () => {
    const app = load('team/team-detail-render.js');
    mount(app._renderTeamEventCard({ id: value, title: value }));
    expect(document.querySelector('.tl-event-title').textContent).toBe(value);
    activate(app, '.tl-event-row', 'openTeamEventDetailFromCard', element => [value, element]);
  });

  test('team-list-render：俱樂部管理列表', () => {
    const app = load('team/team-list-render.js', { getTeams: () => [{ id: value, name: value, active: true }] });
    Object.assign(app, { _refreshTeamCreateButtons: jest.fn(), hasPermission: () => true, _sortTeams: items => items });
    mount('<div id="team-manage-list"></div>');
    app.renderTeamManage();
    expect(document.querySelector('.team-manage-title-main').textContent).toBe(value);
    activate(app, '.event-card', 'showTeamDetail', () => [value]);
  });

  test('message-render：收件匣', () => {
    const app = load('message/message-render.js', { getMessages: () => [{ id: value, title: value }] });
    Object.assign(app, { _isMessageUnread: () => true, updateNotifBadge: jest.fn(), updateStorageBar: jest.fn() });
    mount('<div id="message-list"></div>');
    app.renderMessageList();
    expect(document.querySelector('.msg-title').textContent).toBe(value);
    activate(app, '.msg-card', 'readMessage', element => [element, value]);
  });

  test('message-admin-list：管理列表', () => {
    const app = load('message/message-admin-list.js', { getAdminMessages: () => [{ id: value, title: value, status: 'sent' }] });
    mount('<div id="msg-manage-list"></div>');
    app.renderMsgManage();
    expect(document.querySelector('.msg-manage-title').textContent).toBe(value);
    activate(app, '.primary-btn', 'viewMsgDetail', () => [value]);
  });

  test('profile-card：個人卡片', () => {
    const app = load('profile/profile-card.js', { getCurrentUser: () => ({ uid: value, displayName: value }) });
    app._generateQrCode = jest.fn();
    mount('<div id="uid-qr-modal"></div><div id="uid-qr-content"></div>');
    app.showUidQrCode();
    expect(document.getElementById('uid-qr-content').textContent).toContain(value);
    activate(app, '#uid-qr-content button', '_copyUidToClipboard', () => [value]);
  });

  test('profile-data-history：同行者列表', () => {
    const app = load('profile/profile-data-history.js', { getCompanions: () => [{ id: value, name: value }] });
    mount('<div id="companions-inner-list"></div>');
    app.renderCompanions();
    expect(document.body.textContent).toContain(value);
    activate(app, '.outline-btn', 'openCompanionModal', () => [value]);
  });

  test('profile-data-render：所屬俱樂部', () => {
    const app = load('profile/profile-data-render.js', { getTeams: () => [{ id: value, name: value }] });
    mount(app._getUserTeamHtml({ uid: 'user-1', displayName: value, teamId: value }));
    expect(document.querySelector('.uc-team-link').textContent).toBe(value);
    activate(app, '.uc-team-link', 'showTeamDetail', () => [value]);
  });
});


describe.each(VALUES)('事件繫結強化：第二輪資料 %p', value => {
  test.each([true, false])('event-comments：回覆狀態 %p', replyLocked => {
    const app = load('event/event-comments.js');
    mount(app._renderEventCommentCard({ id: value }, {
      id: value, authorName: value, authorUid: value, body: value, replies: [], likers: [], replyLocked,
    }, { closed: false, canManage: true }));
    activate(app, '.event-comment-mini-btn', '_setEventCommentReplyLocked', () => [value, value, !replyLocked]);
  });

  test.each([true, false])('event-manage-attendance：人員狀態 %p', async isCompanion => {
    const app = load('event/event-manage-attendance.js', {
      getEvent: () => ({ id: value, title: value, max: 5 }), getRegistrationsByEvent: () => [],
    });
    Object.assign(app, {
      _attendanceEditingEventId: value, _canPatchAttendanceTable: () => ({ ok: true }),
      _canOperateEventSite: () => true, _canRemoveConfirmedParticipant: () => true,
      _buildConfirmedParticipantSummary: () => ({ people: [{ uid: value, name: value, displayName: value, isCompanion, regDocId: value, courseLinkedRegistration: true }] }),
      _bindAttendanceCheckboxLink: jest.fn(), _bindBadgeRowSnapBack: jest.fn(), _markBadgeRowOverflow: jest.fn(),
    });
    mount('<div id="roster"></div>');
    await app._doRenderAttendanceTable(value, 'roster', 0, { skipFetch: true, publicRosterOnly: true });
    activate(app, 'tbody tr td:first-child button', '_removeParticipant', () => [value, value, value, isCompanion, value]);
    if (!isCompanion) activate(app, 'tbody tr td:nth-child(2) button', '_forceDemoteToWaitlist', () => [value, value, value, false, value]);
  });

  test.each([true, false])('event-detail-signup：團隊操作 %p', active => {
    const app = load('event/event-detail-signup.js');
    app._getTeamReservationStaffTeams = () => [{ id: value }];
    app._isTeamReservationCourseManaged = () => false;
    app._getTeamReservationSummary = () => active ? { reservedSlots: 2 } : null;
    mount(app._renderTeamReservationActionButton({ id: value }));
    activate(app, '.event-signup-team-button', 'openTeamReservationModal', () => active ? [value, value] : [value]);
  });

  test('event-host-list：主辦人圖片及文字', () => {
    const app = load('event/event-host-list.js');
    app._hostListData = [
      { name: value, uid: value, avatar: 'https://example.test/photo.png' },
      { name: value, uid: value, avatar: '' },
    ];
    mount('<div id="host-list-body"></div>');
    app._renderHostList();
    activate(app, 'img.hl-avatar', 'showUserProfile', () => [value, { uid: value }]);
    activate(app, '.hl-avatar-fallback', 'showUserProfile', () => [value, { uid: value }]);
  });

  test('event-team-split：選隊資料', () => {
    const app = load('event/event-team-split.js', { getRegistrationsByEvent: () => [] });
    app._tsJerseySvg = () => '';
    mount(app._tsRenderTeamSelectUI({ id: value, teamSplit: { enabled: true, mode: 'self-select', teams: [{ key: value, name: value }] } }));
    expect(document.querySelector('.team-select-name').textContent).toBe(value);
    activate(app, '.team-select-card', '_tsSelectTeam', () => [value]);
  });

  test.each([true, false])('profile-core：球衣資料 %p', assigned => {
    const app = load('profile/profile-core.js', { getUserRole: () => 'user' });
    app._findUserByName = () => null;
    app._bindProfileCoreEvents = jest.fn();
    const options = { regDocId: value, eventId: value, canPickTeam: true, showEmptyJersey: true };
    if (assigned) Object.assign(options, { teamKey: 'a', teams: [{ key: 'a', name: value }] });
    mount(app._userTag(value, 'user', options));
    expect(document.body.textContent).toContain(value);
    activate(app, '.uc-jersey-tap', '_tsToggleJerseyPicker', () => [expect.any(Event), value, value]);
  });

  test('profile-core：無效識別資料', () => {
    const app = load('profile/profile-core.js');
    mount(app._buildUserCardActionPanel(value));
    activate(app, '.uc-action-btn-pm', 'showToast', () => ['無法開啟私訊']);
  });

  test.each(['renderActivityRecords', 'renderUserCardRecords'])('leaderboard：分頁 %s', callback => {
    const app = load('leaderboard.js');
    mount(app._renderRecordListHtml(Array.from({ length: 30 }, () => ({ name: value, status: 'completed' })), 2, callback, value));
    expect(document.querySelector('.mini-activity-name').textContent).toBe(value);
    activate(app, 'button:first-of-type', callback, () => [value, 1]);
    activate(app, 'button:last-of-type', callback, () => [value, 3]);
  });

  test.each(['Event', 'Tournament'])('favorites：收藏按鈕 %s', type => {
    const app = load('favorites.js');
    mount(app._favHeartHtml(false, type, value));
    expect(document.querySelector('button').dataset.favId).toBe(value);
    activate(app, '.fav-heart', 'toggleFavorite' + type, () => [value]);
  });

  test.each(['event', 'tournament'])('favorites：收藏清單 %s', type => {
    const app = load('favorites.js', { getTournaments: () => [{ id: value, name: value }] });
    app._getSanitizedFavorites = () => ({ events: type === 'event' ? [value] : [], tournaments: type === 'tournament' ? [value] : [] });
    app._getFavoriteVisibleEventMap = () => new Map([[value, { title: value }]]);
    app._getFavoriteEventBadge = app._tournStatusCss = () => ({ css: '', label: '' });
    mount('<div id="profile-favorites-card"></div><div id="profile-favorites-list"></div>');
    app.renderProfileFavorites();
    expect(document.querySelector('.fav-item-name').textContent).toBe(value);
    activate(app, '.fav-item-name', type === 'event' ? 'showEventDetail' : '_openTournamentDetail', () => [value]);
    activate(app, '.fav-remove-btn', type === 'event' ? 'toggleFavoriteEvent' : 'toggleFavoriteTournament', () => [value]);
  });

  test('role：側欄目的頁', () => {
    const app = load('role.js', {}, context => {
      context.fixtureMenu = { page: value, label: '測試', minRole: 'user' };
      vm.runInContext('DRAWER_MENUS.splice(0, DRAWER_MENUS.length, fixtureMenu)', context);
    });
    app._canAccessDrawerItem = () => true;
    mount('<div id="drawer-menu"></div>');
    app.renderDrawerMenu();
    activate(app, '.drawer-item', 'openDrawerPage', () => [value]);
  });

  test('team-detail：領隊與欄位開關', () => {
    const app = load('team/team-detail.js');
    mount(app._teamLeaderTag(value) + app._buildTeamDetailSettingsSwitch(true, value, value));
    expect(document.querySelector('.user-capsule').textContent).toBe(value);
    activate(app, '.user-capsule', 'showUserProfile', () => [value]);
    activate(app, 'input', 'toggleTeamDetailVisibility', element => [value, element.checked, element], 'change');
  });

  test('team-detail-render：俱樂部分享', () => {
    const app = load('team/team-detail-render.js');
    app._isTeamMember = () => false;
    mount(app._buildTeamDetailActionBar({ id: value, captain: value }));
    activate(app, 'button[onclick*="shareTeam"]', 'shareTeam', () => [value]);
  });

  test('team-detail-v2-actions：課程資料', () => {
    const app = load('team/team-detail-v2-actions.js');
    mount('<div id="course-modal"><div class="td-v2-course-modal-body"></div></div>');
    app._teamDetailV2Runtime = { teamId: value, modal: document.getElementById('course-modal') };
    app.getEduCoursePlans = () => [{ id: value, name: value, allowSignup: true }];
    expect(app.openTeamDetailV2CourseModal(value)).toBe(true);
    expect(document.querySelector('h3').textContent).toBe(value);
    activate(app, '.td-v2-modal-foot button', 'applyCourseEnrollment', element => [value, value, element]);
  });

  test('team-detail-v2-panels：新增課程入口', () => {
    const app = load('team/team-detail-v2-panels.js');
    app.isEduClubStaff = () => true;
    app._getTeamDetailV2RecruitText = () => value;
    app._buildTeamEducationSection = () => '';
    mount(app._buildTeamDetailV2CoursesPanel({ id: value, name: value }));
    expect(document.body.textContent).toContain(value);
    activate(app, '.td-v2-course-add-btn', 'showEduCoursePlanForm', () => [value]);
  });
});

describe('事件繫結強化：分支邊界', () => {
  test.each([NaN, Infinity])('leaderboard：非有限頁碼 %p', page => {
    const app = load('leaderboard.js');
    mount(app._renderRecordListHtml(Array(30).fill({ name: '測試' }), page, 'renderActivityRecords', 'all'));
    expect(document.querySelectorAll('button')).toHaveLength(2);
    expect([...document.querySelectorAll('button')].every(button => !button.hasAttribute('onclick'))).toBe(true);
  });
  test('leaderboard：未知目的方法', () => {
    const app = load('leaderboard.js');
    mount(app._renderRecordListHtml(Array(30).fill({ name: VALUES[0] }), 2, VALUES[0], VALUES[0]));
    expect(document.querySelectorAll('button')).toHaveLength(2);
    expect(document.querySelector('[onclick]')).toBeNull();
  });
  test('profile-core：有效識別資料', () => {
    const uid = 'U' + 'a'.repeat(32);
    const app = load('profile/profile-core.js');
    mount(app._buildUserCardActionPanel(uid));
    activate(app, '.uc-action-btn-pm', 'openPmDialog', () => [uid]);
  });
  test.each([0, 1])('team-detail：固定開關 %s', action => {
    const app = load('team/team-detail.js');
    mount(app._buildTeamDetailSettingsSwitch(false, action, '測試'));
    activate(app, 'input', action === 0 ? 'toggleTeamMemberInviteSetting' : 'toggleTeamThemeOverlay', element => [false, element], 'change');
  });
  test('favorites：未知類型', () => {
    const app = load('favorites.js');
    mount(app._favHeartHtml(false, VALUES[0], VALUES[0]));
    expect(document.querySelector('button').hasAttribute('onclick')).toBe(false);
  });
});


describe.each(VALUES)('事件繫結強化：組裝分支 %p', value => {
  test('team-list-render：管理開關與顏色', () => {
    const app = load('team/team-list-render.js');
    mount(app._renderTeamAttentionEffectControls({ id: value, name: value }, true));
    activate(app, 'input[type="checkbox"]', 'toggleTeamAttentionEffect', element => [value, element.checked, element], 'change');
    activate(app, 'input[type="color"]', 'changeTeamAttentionEffectColor', element => [value, element.value, element], 'change');
  });

  test.each(['match', 'course', 'activity'])('team-detail-render：成員編輯 %s', tab => {
    const app = load('team/team-detail-render.js');
    app._getTeamDetailMemberMatchData = () => ({});
    app._isTeamDetailMatchDataEditableRow = app._isTeamDetailMemberNoteEditableRow = () => true;
    mount(app._buildTeamMemberRowEditButton({ id: value }, { key: value }, tab, true));
    activate(app, 'button', tab === 'match' ? 'editTeamMemberMatchData' : 'editTeamMemberNote', element => tab === 'match' ? [element, value, value] : [element, value, value, tab]);
  });

  test('profile-core：活動與徽章載入入口', async () => {
    const app = load('profile/profile-core.js', {}, context => {
      context.ScriptLoader = { ensureForPage: async () => {} };
    });
    Object.assign(app, {
      _claimPageTransition: () => 1, _isPageTransitionCurrent: () => true,
      _findUserByUid: () => ({ uid: value, displayName: value, role: 'user' }),
      _getAvatarCandidateUrls: () => [], _buildAvatarImageMarkup: () => '', _getUserTeamHtml: () => '',
      _buildTitleDisplayHtml: () => '', _buildSocialLinksHtml: () => '',
      _bindProfileCoreEvents: jest.fn(), _bindAvatarFallbacks: jest.fn(),
      showPage: async () => { app.currentPage = 'page-user-card'; },
    });
    mount('<div id="user-card-full"></div>');
    await app.showUserProfile(value, { uid: value, allowGuest: true });
    expect(document.querySelectorAll('.uc-blur-overlay')).toHaveLength(2);
    const overlays = [...document.querySelectorAll('.uc-blur-overlay')];
    overlays.forEach((element, index) => { element.id = 'overlay-' + index; });
    activate(app, '#overlay-0', '_loadUserCardUncovered', () => [value]);
    activate(app, '#overlay-1', '_loadUserCardUncovered', () => [value]);
  });

  test.each(['normal', 'external', 'invalid'])('event-manage：活動卡 %s', type => {
    const url = 'https://example.test/a?x=1&y=2';
    const record = { id: value, title: value, creator: value, status: 'open', type: type === 'normal' ? 'play' : 'external', externalUrl: type === 'invalid' ? value : url };
    const app = load('event/event-manage.js', { getEvents: () => [record], getUserRole: () => 'user' }, context => {
      vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/modules/ad-manage/banner.js'), 'utf8'), context);
    });
    Object.assign(app, {
      _autoEndExpiredEvents: jest.fn(), _ensureManageHistoryEventsLoaded: jest.fn(), hasPermission: () => true,
      _sortMyActivitiesByNearestTime: items => items, _getMyActivityVisibleLimit: () => 10, _hasMoreManageHistoryEvents: () => false,
      _canManageEvent: () => false, _renderEventSportIcon: () => '', _userTag: () => '', _bindSwipeTabs: jest.fn(),
    });
    mount('<div id="my-activity-list"></div>');
    app.renderMyActivities('all');
    expect(document.querySelector('.msg-manage-title').textContent).toBe(value);
    if (type === 'normal') activate(app, '.msg-manage-card', 'showEventDetail', () => [value]);
    else if (type === 'invalid') expect(document.querySelector('.msg-manage-card').hasAttribute('onclick')).toBe(false);
    else {
      const open = jest.spyOn(window, 'open').mockImplementation(() => null);
      try {
        const card = document.querySelector('.msg-manage-card');
        const execute = new Function('window', 'event', card.getAttribute('onclick'));
        card.onclick = function (event) { execute.call(this, window, event); };
        card.click();
        expect(open).toHaveBeenCalledTimes(1);
        expect(open).toHaveBeenCalledWith(url, '_blank');
        expect(window.__x).toBeUndefined();
      } finally { open.mockRestore(); }
    }
  });
});

test('事件繫結強化：球衣圖示只呈現既有資料', () => {
  const app = load('event/event-team-split.js');
  mount(app._tsJerseySvg('#ffffff', null, 'A', { onclick: VALUES[0] }));
  expect(document.querySelector('svg').hasAttribute('onclick')).toBe(false);
});


describe.each(VALUES)('事件繫結強化：報名分支 %p', value => {
  test.each(['signed', 'waiting', 'full', 'open', 'gender', 'age'])('event-detail-signup：狀態 %s', state => {
    const record = { id: value, title: value, status: 'open', max: 1, current: state === 'full' ? 1 : 0 };
    const app = load('event/event-detail-signup.js', { getEvent: () => record });
    Object.assign(app, {
      _ensureEventSignupRegistrationStateLoaded: () => false, _isTeamReservationStaffTeamsHydratingForEvent: () => false,
      _isEventSignupRegistrationHydrateIssue: () => false, _hasAvailableTeamReservationSignup: () => false,
      _isUserSignedUp: () => state === 'signed' || state === 'waiting', _isUserOnWaitlist: () => state === 'waiting',
      _getEventGenderSignupState: () => ({ restricted: state === 'gender', canSignup: false }),
      _getEventGenderRestrictionMessage: () => value,
      _getEventAgeSignupState: () => ({ restricted: state === 'age', canSignup: false }),
      _isEventAgeSignupStateSyncing: () => false, _composeEventSignupActions: (_record, html) => html,
    });
    mount('<div id="detail-action-primary"></div>');
    app._refreshSignupButton(value);
    const method = state === 'signed' || state === 'waiting' ? 'handleCancelSignup'
      : state === 'gender' ? '_handleGenderRestrictedClick' : state === 'age' ? '_handleEventAgeRestrictionClick' : 'handleSignup';
    activate(app, '#detail-action-primary button', method, () => [value]);
  });
});

test('事件繫結強化：額滿分隊保持提示', () => {
  jest.useFakeTimers();
  try {
    const app = load('event/event-team-split.js', { getRegistrationsByEvent: () => [{ status: 'confirmed', teamKey: 'a' }] });
    app._tsJerseySvg = () => '';
    mount(app._tsRenderTeamSelectUI({ id: 'event-1', max: 1, teamSplit: { enabled: true, mode: 'self-select', balanceCap: true, teams: [{ key: 'a' }] } }));
    app._tsSelectTeam = jest.fn();
    const element = document.querySelector('.team-select-card');
    const execute = new Function('setTimeout', element.getAttribute('onclick'));
    element.onclick = function () { execute.call(this, setTimeout); };
    element.click();
    expect(element.classList.contains('shake')).toBe(true);
    jest.advanceTimersByTime(300);
    expect(element.classList.contains('shake')).toBe(false);
    expect(app._tsSelectTeam).not.toHaveBeenCalled();
  } finally { jest.useRealTimers(); }
});

describe.each(VALUES)('事件繫結強化：第三輪原值 %p', value => {
  test.each([true, false])('早鳥報名原值往返：訪客 %p', isGuestView => {
    const app = load('event/event-detail-signup.js', { getCurrentUser: () => ({ exp: 100 }) });
    for (const identity of [{ id: value, _docId: 'unused' }, { _docId: value }]) {
      const record = { ...identity, earlyBirdEnabled: true, earlyBirdCost: 10, regOpenTime: new Date(Date.now() + 86400000).toISOString() };
      mount(app._buildEventEarlyBirdSignupHtml(record, { isGuestView }));
      activate(app, '.event-early-bird-btn', isGuestView ? 'requestProtectedEventAction' : 'handleSignup',
        () => isGuestView ? ['eventSignup', value] : [value, { earlyBird: true }]);
    }
  });

  test('俱樂部賽事卡原值往返', () => {
    const app = load('team/team-detail-render.js');
    for (const identity of [{ id: value, _docId: 'unused' }, { _docId: value }]) {
      mount(app._renderTeamTournamentCard({ ...identity, name: value }));
      expect(document.querySelector('.td-team-tournament-title-row strong').textContent).toBe(value);
      activate(app, '.td-team-tournament-card', 'openTeamDetailTournament', () => [value]);
    }
  });
});

test('事件繫結強化：資料 key 與保留字同名仍操作欄位', () => {
  const app = load('team/team-detail.js');
  for (const key of ['invite', 'overlay', '0', '1']) {
    mount(app._buildTeamDetailSettingsSwitch(true, key, '測試'));
    app.toggleTeamMemberInviteSetting = jest.fn();
    app.toggleTeamThemeOverlay = jest.fn();
    activate(app, 'input', 'toggleTeamDetailVisibility', element => [key, true, element], 'change');
    expect(app.toggleTeamMemberInviteSetting).not.toHaveBeenCalled();
    expect(app.toggleTeamThemeOverlay).not.toHaveBeenCalled();
  }
});


// 事件繫結強化：第二包使用真實模組與 config，封閉渲染入口另取原始產出片段。
function loadBindingB(files, api = {}, initial = {}, globals = {}) {
  const app = { renderRegisterButton: () => {}, ...initial };
  const context = vm.createContext({
    App: app, ApiService: api, document, window, console, setTimeout, clearTimeout,
    localStorage, performance, I18N: { t: key => key }, t: key => key, ...globals,
  });
  const names = ['js/config.js', ...(files.some(f => f.startsWith('tournament/'))
    ? ['js/modules/tournament/tournament-core.js'] : []), ...files.map(f => 'js/modules/' + f)];
  names.forEach(name => vm.runInContext(fs.readFileSync(path.join(ROOT, name), 'utf8'), context, { filename: name }));
  Object.assign(context, globals);
  return app;
}

function activateBindingB(app, selector, method, expected, type = 'click', owner = 'App', stop) {
  const element = document.querySelector(selector);
  expect(element).not.toBeNull();
  const source = element.getAttribute('on' + type);
  const calls = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression'
      && node.callee.object.name === owner) calls.push(node.callee.property.name);
    Object.values(node).forEach(child => Array.isArray(child) ? child.forEach(visit)
      : child && typeof child.type === 'string' && visit(child));
  }
  visit(parse(source, { allowReturnOutsideFunction: true }));
  expect(calls).toEqual([method]);
  const target = owner === 'App' ? app : window;
  const previous = target[method];
  const call = jest.fn();
  target[method] = call;
  const execute = new Function('App', 'window', 'event', source);
  const count = document.querySelectorAll('*').length;
  delete window.__x;
  try {
    for (const native of [false, true]) {
      call.mockClear();
      const event = type === 'keydown' ? new KeyboardEvent(type, { key: 'Enter' }) : new Event(type);
      const propagation = jest.spyOn(event, 'stopPropagation');
      if (native) {
        element['on' + type] = function (e) { return execute.call(this, app, window, e); };
        if (type === 'click') element.click();
        else element.dispatchEvent(event);
      } else {
        execute.call(element, app, window, event);
        if (stop !== undefined) expect(propagation).toHaveBeenCalledTimes(stop ? 1 : 0);
      }
      expect(call).toHaveBeenCalledTimes(1);
      expect(call).toHaveBeenCalledWith(...expected(element));
      expect(window.__x).toBeUndefined();
      expect(document.querySelectorAll('*').length).toBe(count);
    }
  } finally {
    target[method] = previous;
    element['on' + type] = null;
  }
}

// 封閉作用域或分頁排程入口：讀取真正模板的屬性與運算式，解碼後解析並觸發。
function renderBindingAttributeB(file, needle, bindings, occurrence = 0) {
  const source = fs.readFileSync(path.join(ROOT, 'js/modules/' + file), 'utf8');
  const candidates = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'TemplateLiteral') {
      const text = node.quasis.map((q, i) => q.value.cooked
        + (node.expressions[i] ? '\0' + i + '\0' : '')).join('');
      for (const match of text.matchAll(/\b(on\w+)\s*=\s*"([^"]*)"/g)) {
        if (match[2].includes(needle)) candidates.push({ node, name: match[1], text: match[2] });
      }
    }
    Object.values(node).forEach(child => Array.isArray(child) ? child.forEach(visit)
      : child && typeof child.type === 'string' && visit(child));
  }
  visit(parse(source));
  expect(candidates.length).toBeGreaterThan(occurrence);
  const found = candidates[occurrence];
  const context = vm.createContext({ window, ...bindings });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8'), context);
  const attribute = found.text.replace(/\0(\d+)\0/g, (_, index) => {
    const expression = found.node.expressions[Number(index)];
    return vm.runInContext(source.slice(expression.start, expression.end), context);
  });
  mount('<button id="binding-fragment" ' + found.name + '="' + attribute + '"></button>');
}

describe.each(VALUES)('事件繫結強化：第二包原值 %p', value => {
  afterEach(() => {
    delete window.App;
    delete window.HomeNextActivityUtils;
    document.body.classList.remove('modal-open');
  });

  test('tournament-friendly-detail-view：名單、背號、編輯與取消的原值', () => {
    const app = loadBindingB(['tournament/tournament-friendly-detail-view.js']);
    const entry = { teamId: value, teamName: value };
    const member = { uid: value, name: value };
    mount(app._renderFriendlyTournamentRosterMemberChip(value, entry, member, true));
    expect(document.querySelector('.tfd-member-name').textContent).toBe(value);
    activateBindingB(app, 'button', 'promptFriendlyTournamentMemberJersey', el => [value, value, value, el]);
    for (const editing of [false, true]) {
      mount(app._renderFriendlyTournamentRosterListRow(value, entry, member, true, editing));
      expect(document.querySelector('.tfd-roster-name-pill').textContent).toBe(value);
      activateBindingB(app, '.outline-btn, .primary-btn', editing ? 'saveFriendlyTournamentRosterMemberProfile' : 'editFriendlyTournamentRosterMember',
        el => editing ? [value, value, value, el] : [value, value, value]);
      if (!editing) activateBindingB(app, '.tfd-roster-delete-btn', 'deleteFriendlyTournamentRosterMember', el => [value, value, value, el]);
    }
    app._isSameFriendlyTournamentEntry = () => true;
    for (const stop of [false, true]) {
      mount(app._buildFriendlyTournamentRosterActionButton(value, entry, {}, '報名中', { stopPropagation: stop }));
      activateBindingB(app, 'button', 'joinFriendlyTournamentRoster', el => [value, value, el], 'click', 'App', stop);
      mount(app._buildFriendlyTournamentRosterActionButton(value, entry, { primary: entry }, '報名中', { stopPropagation: stop }));
      activateBindingB(app, 'button', 'cancelFriendlyTournamentRoster', el => [value, el], 'click', 'App', stop);
      app._isSameFriendlyTournamentEntry = () => false;
      mount(app._buildFriendlyTournamentRosterActionButton(value, entry, { primary: entry }, '報名中', { stopPropagation: stop }));
      activateBindingB(app, 'button', 'showToast', () => ['你已有參賽隊伍'], 'click', 'App', stop);
      app._isSameFriendlyTournamentEntry = () => true;
    }
    mount(app._buildFriendlyTournamentActionTeamSelector(value, [{ id: value, name: value }], value));
    expect(document.querySelector('option').textContent).toBe(value);
    activateBindingB(app, 'select', '_handleFriendlyTournamentActionTeamChange', () => [value, value], 'change');
  });

  test('tournament-detail-competition：隊伍名、比賽卡與鍵盤操作', () => {
    const app = loadBindingB(['tournament/tournament-detail-competition.js']);
    Object.assign(app, {
      _renderTournamentMatchSideLabel: () => ({ teamId: value, label: value }),
      _getTournamentMatchWinnerTeamId: () => '',
      _renderTournamentMatchEventsSummaryHtml: () => '',
      _renderTournamentLiveFrameHtml: () => '',
    });
    mount(app._renderTournamentMatchRowHtml({ id: value }, { id: value, status: 'scheduled' }, {}, {}, { canRecord: true }));
    expect(document.querySelector('.tc-match-team-name').textContent).toBe(value);
    activateBindingB(app, '.tc-record-btn', 'openTournamentMatchRecordModal', () => [value, value]);
    activateBindingB(app, 'article', 'openTournamentMatchDetailModal', () => [value, value]);
    activateBindingB(app, 'article', 'openTournamentMatchDetailModal', () => [value, value], 'keydown');
  });

  test('tournament-detail：工具列與報名', () => {
    const record = { id: value, status: '報名中' };
    const api = { getCurrentUser: () => ({ uid: 'u' }), getTeams: () => [{ id: 'team', captainUid: 'u' }], getMessages: () => [] };
    const app = loadBindingB(['tournament/tournament-detail.js'], api);
    mount('<div id="toolbar"></div><div id="td-register-area"></div>');
    Object.assign(app, {
      _ensureTournamentDetailTabsLayout: () => ({ toolbar: document.getElementById('toolbar') }),
      _canManageTournamentRecord: () => true, _canDeleteTournamentGlobal: () => true,
    });
    app._renderTournamentDetailToolbar(record);
    activateBindingB(app, '.td-edit-btn', 'openEditTournamentSafe', () => [value]);
    activateBindingB(app, '.td-schedule-btn', 'openTournamentScheduleManager', () => [value]);
    activateBindingB(app, '.td-delete-btn', 'openDeleteTournamentSafe', el => [value, el]);
    app.renderRegisterButton(record);
    activateBindingB(app, '#td-register-area button', 'registerTournament', () => [value]);
  });

  test('tournament-friendly-roster：加入、退出與多隊選擇', () => {
    const app = loadBindingB(['tournament/tournament-friendly-roster.js']);
    const entry = { teamId: value, teamName: value };
    Object.assign(app, { _isFriendlyTournamentRecord: () => true, _getFriendlyTournamentApprovedUserEntries: () => [entry] });
    for (const mode of ['join', 'cancel', 'pick']) {
      mount('<div id="td-register-area"><div class="tfd-action-card"><div class="tfd-action-main"></div></div></div>');
      app._getFriendlyTournamentRosterMembership = () => ({ primary: mode === 'cancel' ? entry : null });
      app._getFriendlyTournamentJoinableEntries = () => mode === 'pick' ? [entry, entry] : [entry];
      app.renderRegisterButton({ id: value, status: '報名中' });
      const method = { join: 'joinFriendlyTournamentRoster', cancel: 'cancelFriendlyTournamentRoster', pick: 'openFriendlyTournamentRosterPicker' }[mode];
      activateBindingB(app, 'button', method, el => mode === 'join' ? [value, value, el] : mode === 'cancel' ? [value, el] : [value]);
      if (mode !== 'pick') expect(document.querySelector('.tfd-action-note').textContent).toContain(value);
    }
  });

  test('tournament-manage-form：場地索引與日期原值', () => {
    const app = loadBindingB(['tournament/tournament-manage-form.js']);
    mount('<div id="venues"></div><div id="tf-match-dates-wrap"></div>');
    document.getElementById('venues').id = value + '-venue-tags';
    app._tournamentFormState.venues = [value];
    app._tournamentFormState.matchDates = [value];
    app._renderVenueTags(value);
    expect(document.querySelector('a').textContent).toContain(value);
    activateBindingB(app, '[onclick]', 'removeTournamentVenue', () => [value, 0]);
    app._renderMatchDateTags('tf');
    activateBindingB(app, '#tf-match-dates-wrap [onclick]', 'removeMatchDate', () => [value]);
  });

  test('tournament-manage：管理分支與地區原值', () => {
    const record = { id: value, name: value, status: '報名中' };
    const app = loadBindingB(['tournament/tournament-manage.js'], { getTournaments: () => [record] }, {},
      { filterTwRegions: () => [value] });
    Object.assign(app, {
      _refreshTournamentCenterCreateButton: () => {}, _isTournamentGlobalAdmin: () => true,
      _canReopenTournamentGlobal: () => true, _canDeleteTournamentGlobal: () => true,
    });
    for (const ended of [false, true]) {
      mount('<div id="tournament-manage-list"></div><div id="tf-region-suggest"></div>');
      record.ended = ended;
      app._tmActiveTab = ended ? 'ended' : 'active';
      app.renderTournamentManage();
      expect(document.querySelector('.tl-event-title').textContent).toBe(value);
      activateBindingB(app, '[onclick^="App.showTournamentDetail"]', 'showTournamentDetail', () => [value]);
      activateBindingB(app, '[onclick^="App.handleDeleteTournament"]', 'handleDeleteTournament', el => [value, el]);
      activateBindingB(app, ended ? '[onclick^="App.handleReopenTournament"]' : '[onclick^="App.openEditTournamentSafe"]',
        ended ? 'handleReopenTournament' : 'openEditTournamentSafe', () => [value]);
      app._renderTournamentRegionSuggest(value);
      activateBindingB(app, '.team-user-suggest-item', '_selectTournamentRegion', () => [value], 'mousedown');
    }
  });

  test('tournament-match-record：換人名單、使用者名稱與紀錄移除', () => {
    const app = loadBindingB(['tournament/tournament-match-record.js', 'tournament/tournament-friendly-detail-view.js']);
    mount('<select id="tmr-event-team"></select><div id="tmr-event-sub-out-suggestions"></div><div id="tmr-events-list"></div>');
    const option = document.createElement('option');
    option.value = value;
    document.querySelector('select').appendChild(option);
    app._tournamentMatchRecordState = { tournamentId: value, homeTeamId: value, homeName: value, events: [{ type: 'goal', teamId: value, name: value }] };
    app._getFriendlyTournamentState = () => ({ entries: [{ teamId: value, memberRoster: [{ uid: value, name: value }] }] });
    app._renderTournamentSubstitutionSearch('out');
    expect(document.querySelector('.tmr-sub-suggestion').textContent).toBe(value);
    activateBindingB(app, '.tmr-sub-suggestion', '_appendTournamentSubstitutionPlayer', () => ['out', value]);
    app._renderTournamentMatchRecordEvents();
    expect(document.querySelector('.tmr-event-copy strong').textContent).toContain(value);
    expect(document.querySelector('.tmr-event-copy small').textContent).toBe(value);
    activateBindingB(app, '.tc-event-remove', '_removeTournamentMatchRecordEvent', () => [0]);
  });

  test('tournament-render：首頁賽事名稱與識別值', () => {
    const app = loadBindingB(['tournament/tournament-render.js'], { getTournaments: () => [{ id: value, name: value, teams: 2 }] });
    mount('<div id="ongoing-tournaments"></div>');
    app.renderOngoingTournaments();
    expect(document.querySelector('.h-card-title').textContent).toBe(value);
    activateBindingB(app, '.h-card', '_openTournamentDetail', () => [value]);
  });

  test('tournament-schedule-manage：產生、儲存與刪除的原值', () => {
    const app = loadBindingB(['tournament/tournament-schedule-manage.js']);
    const state = { tournament: { id: value }, matches: [{ id: value, stage: 'friendly', status: 'scheduled' }] };
    Object.assign(app, {
      _tournamentScheduleManagerState: { tournamentId: value }, _getFriendlyTournamentState: () => state,
      _buildTournamentMatchesBySlot: () => ({}), _getTournamentTeamNameMap: () => ({}),
      _renderTournamentMatchSideLabel: () => ({ label: value }), _getTournamentRoundLabel: () => '1',
      _normalizeTournamentMatchRepeatCount: count => Number(count) || 1,
    });
    mount('<div id="tournament-schedule-summary"></div><div id="tournament-schedule-actions"></div><div id="tournament-schedule-list"></div>');
    app._renderTournamentScheduleManager();
    expect(document.querySelector('.tc-manage-title span').textContent).toBe(value);
    activateBindingB(app, '.tc-schedule-generate-btn', 'generateTournamentSchedule', el => [value, el]);
    activateBindingB(app, '.tc-save-all-btn', 'saveAllTournamentMatchMeta', el => [value, el]);
    activateBindingB(app, '.tc-manage-delete', 'deleteTournamentScheduleMatch', el => [value, value, el]);
  });
});


describe.each(VALUES)('事件繫結強化：第二包其餘模組 %p', value => {
  afterEach(() => {
    delete window.App;
    delete window.HomeNextActivityUtils;
    document.body.classList.remove('modal-open');
  });

  test('announcement：公告跑馬燈與管理操作原值', () => {
    const record = { id: value, title: value, content: value, status: 'active' };
    const app = loadBindingB(['announcement.js'], { getActiveAnnouncements: () => [record], getAnnouncements: () => [record] },
      { _userTag: name => String(name) });
    mount('<div id="announce-marquee-wrap"><div id="announce-marquee-track"></div></div><div id="announcement-manage-list"></div>');
    app.renderAnnouncement();
    expect(document.querySelector('.announce-marquee-item').textContent).toContain(value);
    activateBindingB(app, '.announce-marquee-item', 'showAnnDetail', () => [value]);
    app.renderAnnouncementManage();
    for (const method of ['editAnnouncementItem', 'toggleAnnouncementStatus', 'deleteAnnouncementItem']) {
      activateBindingB(app, '[onclick^="App.' + method + '"]', method, () => [value]);
    }
  });

  test('data-sync：查詢保留原按鈕事件與前後區域優先序', () => {
    const app = loadBindingB(['data-sync.js']);
    mount('<div id="repair-pane-data-sync"><div class="form-card"></div>'
      + '<div class="form-card" id="local"><button onclick="App.runDataSyncOp(\'teamMembers\')"></button></div></div>'
      + '<div class="form-card" id="external"><button onclick="App._scanUserRegions()"></button></div>'
      + '<div class="form-card" id="duplicate"><button onclick="App.runDataSyncOp(\'teamMembers\')"></button></div>');
    document.querySelectorAll('button').forEach(button => { button.textContent = value; });
    app._setupDataSyncToolLayout({ dataSync: true });
    expect(document.getElementById('local').parentElement.id).toBe('data-sync-daily-tools');
    expect(document.getElementById('duplicate').parentElement).toBe(document.body);
    expect(document.getElementById('external').parentElement.tagName).toBe('DETAILS');
    expect(document.querySelector('#local button').textContent).toBe(value);
    activateBindingB(app, '#local button', 'runDataSyncOp', () => ['teamMembers']);
    activateBindingB(app, '#external button', '_scanUserRegions', () => []);
  });

  test('game-log-viewer：名稱渲染與數字索引', () => {
    const app = loadBindingB(['game-log-viewer.js']);
    mount('<input id="game-log-search"><div id="game-log-results"></div>');
    document.querySelector('input').value = value.slice(0, 1);
    app._gameLogProfiles = [{ displayName: value, skin: value, level: 1 }];
    app._filterGameLog();
    expect(document.querySelector('[data-no-translate]').textContent).toContain(value);
    activateBindingB(app, '[onclick]', 'viewGameLog', () => [0]);
  });

  test('game-manage：顯示開關原值', () => {
    const app = loadBindingB(['game-manage.js']);
    app._getHomeGameManageItems = () => [{ id: value, name: value }];
    mount('<div id="game-manage-list"></div>');
    app.renderGameManage();
    activateBindingB(app, 'input', 'toggleHomeGameVisibility', () => [value, true], 'change');
  });

  test('home-dashboard：封閉入口產出字串解碼後解析', () => {
    const app = {};
    renderBindingAttributeB('home-dashboard.js', 'App.selectHomeSport', { item: { key: value } }, 1);
    activateBindingB(app, 'button', 'selectHomeSport', () => [value]);
    renderBindingAttributeB('home-dashboard.js', 'App.showPage', { page: value });
    activateBindingB(app, 'button', 'showPage', () => [value]);
  });

  test('home-next-activity：活動原文與圖片錯誤事件', async () => {
    const app = loadBindingB(['home-next-activity.js'], { getCurrentUser: () => ({ uid: 'fixture-user' }) });
    mount('<div id="home-next-activity"></div>');
    app._homeNextActivityCache = { uid: 'fixture-user', loadedAt: Date.now(),
      next: { event: { id: value, title: value, location: value, date: '2099/01/01 10:00~12:00', status: 'open' } } };
    await app.renderHomeNextActivity();
    expect(document.querySelector('h4').textContent).toBe(value);
    const img = document.querySelector('img');
    const source = img.getAttribute('onerror');
    const tree = parse(source);
    expect(tree.program.body).toHaveLength(2);
    const execute = new Function(source);
    const received = [];
    execute.call({ onerror: () => {}, set src(v) { received.push(v); } });
    expect(received).toEqual(['LOGO/Nocoverimage%20set.png']);
    const count = document.querySelectorAll('*').length;
    delete window.__x;
    img.onerror = execute;
    img.dispatchEvent(new Event('error'));
    expect(img.getAttribute('src')).toBe('LOGO/Nocoverimage%20set.png');
    expect(img.onerror).toBeNull();
    expect(document.querySelectorAll('*').length).toBe(count);
    expect(window.__x).toBeUndefined();
    app.openHomeNextActivityDetail = jest.fn();
    document.querySelector('[data-home-next-action="detail"]').click();
    expect(app.openHomeNextActivityDetail).toHaveBeenCalledWith(value);
  });

  test('error-log：診斷原值與分頁數字', () => {
    const app = loadBindingB(['error-log.js']);
    Object.assign(app, { _parseErrorContext: () => '', _getErrorPage: () => '',
      _getErrorDisplayCode: () => '', _renderErrorDetailRow: () => '' });
    mount(app._renderErrorLogDetails({ errorMessage: value }, value));
    activateBindingB(app, 'button', 'copyErrorLogDiagnostic', () => [value]);
    for (const method of ['_errorLogGoPage', '_userPromptLogGoPage']) {
      renderBindingAttributeB('error-log.js', 'App.' + method, { safePage: 2 });
      activateBindingB(app, 'button', method, () => [1]);
    }
  });

  test('error-log-insights：群組內容與數字索引', () => {
    const app = loadBindingB(['error-log-insights.js']);
    mount(app._renderErrorLogGroup({ page: value, users: new Set(), versions: new Set(),
      severity: { className: 'info', label: value }, codeLabel: value, logs: [{}], message: value }, 2));
    expect(document.querySelector('.error-log-message').textContent).toBe(value);
    activateBindingB(app, 'button', 'copyErrorLogDiagnosticGroup', () => [2]);
  });

  test('event-map：活動卡片原值與半徑', () => {
    const app = loadBindingB(['event/event-map.js']);
    app._renderActivityMapSportIcon = () => '';
    for (const identity of [{ id: value }, { _docId: value }]) {
      mount(app._renderActivityMapFallbackCard({ ...identity, title: value, location: value }));
      expect(document.querySelector('.activity-map-card-title').textContent).toBe(value);
      activateBindingB(app, 'button', 'openActivityMapEvent', () => [value]);
    }
    renderBindingAttributeB('event/event-map.js', 'App.setActivityMapRadius', { radius: 5 });
    activateBindingB(app, 'button', 'setActivityMapRadius', () => [5]);
  });

  test('event-detail-companion：同行者現行入口與舊模板原值', () => {
    const app = loadBindingB(['event/event-detail-companion.js'], {
      getEvent: () => ({ id: value, title: value, max: 5, current: 0 }),
      getCompanions: () => [{ id: value, name: value }], getMyRegistrationsByEvent: () => [],
    });
    mount('<div id="companion-select-overlay"><div id="companion-select-list"></div></div>');
    app._updateCompanionSelectSummary = jest.fn();
    app._openCompanionSelectModal(value);
    expect(document.querySelector('.companion-toggle-name').textContent).toBe(value);
    activateBindingB(app, 'input', '_updateCompanionSelectSummary', () => [value], 'change');
    for (const occurrence of [0, 1, 2]) {
      renderBindingAttributeB('event/event-detail-companion.js', 'App._updateCompanionSelectSummary', { eventId: value }, occurrence);
      activateBindingB(app, 'button', '_updateCompanionSelectSummary', () => [value], 'change');
    }
  });

  test('event-manage-waitlist：一般與課程候補原值', () => {
    for (const course of [false, true]) {
      const reg = { id: value, userId: value, userName: value, status: 'waitlisted', participantType: 'self',
        ...(course ? { courseLinkSource: 'eduCourseLesson' } : {}) };
      const app = loadBindingB(['event/event-manage-waitlist.js'], {
        getEvent: () => ({ id: value }), getRegistrationsByEvent: () => [reg],
      });
      Object.assign(app, { _getWaitlistFallbackNames: () => [], _isRosterManagementEditing: () => true,
        _userTag: () => '' });
      mount('<div id="waitlist"></div>');
      app._renderWaitlistSection(value, 'waitlist');
      activateBindingB(app, 'button', '_forcePromoteWaitlist', () => [value, value, course ? value : '']);
    }
  });

  test.each([
    ['event/event-create-template.js', 'ce-template-selector', '_getEventTemplates', '_renderTemplateSelector', '_loadEventTemplate', '_deleteEventTemplate'],
    ['event/event-create-external.js', 'cee-template-selector', '_getExternalEventTemplates', '_renderExternalTemplateSelector', '_loadExternalEventTemplate', '_deleteExternalEventTemplate'],
  ])('%s：範本名稱及讀取刪除原值', (file, id, getter, render, open, remove) => {
    const app = loadBindingB([file]);
    app[getter] = () => [{ id: value, name: value }];
    app._getEventTemplatesFromLocal = () => [];
    mount('<div id="' + id + '"></div>');
    app[render]();
    expect(document.getElementById(id).textContent).toContain(value);
    activateBindingB(app, '[onclick^="App."]', open, () => [value]);
    activateBindingB(app, '[onclick^="event."]', remove, () => [value]);
  });

  test.each([
    ['event/event-create-options.js', '_eventSocialLinksDraft', '_getEventSocialLinksNodes', '_renderEventSocialLinksFormRows', '_removeEventSocialLinkInput'],
    ['team/team-contact-links.js', '_teamContactLinksDraft', '_getTeamContactLinksNodes', '_renderTeamContactLinksFormRows', '_removeTeamContactLinkInput'],
  ])('%s：社群欄位內容與移除索引', (file, draft, nodes, render, remove) => {
    const app = loadBindingB([file]);
    mount('<div id="links"></div>');
    app[draft] = [{ url: value }, { url: value }];
    app[nodes] = () => ({ list: document.getElementById('links') });
    app[render]();
    expect(document.querySelector('input').getAttribute('value')).toBe(value);
    activateBindingB(app, 'button', remove, () => [0]);
  });

  test.each([
    ['event/event-list-timeline.js', 'App.openTimelineEventDetail', 'openTimelineEventDetail'],
    ['event/event-list.js', 'App.openHomeEventDetailFromCard', 'openHomeEventDetailFromCard'],
  ])('%s：分頁產出字串解碼後解析', (file, needle, method) => {
    renderBindingAttributeB(file, needle, { e: { id: value } });
    activateBindingB({}, 'button', method, el => [value, el]);
  });

  test('team-form-search：未連結領隊與教練名稱', () => {
    const app = loadBindingB(['team/team-form-search.js'], { getUserDirectory: () => [] });
    app._teamFormState = { leaders: [], coaches: [] };
    app._ensureTeamFormUnresolvedStaffNames = () => ({ leaders: [value], coaches: [value] });
    mount('<div id="ct-leaders-tags"></div><div id="ct-coach-tags"></div>');
    for (const [role, render, id] of [['leaders', '_renderLeaderTags', 'ct-leaders-tags'], ['coaches', '_renderCoachTags', 'ct-coach-tags']]) {
      app[render]();
      expect(document.getElementById(id).textContent).toContain(value);
      activateBindingB(app, '#' + id + ' [onclick]', '_removeUnresolvedTeamStaffName', () => [role, 0]);
    }
  });

  test('dashboard-participant-share：分享網址原值', () => {
    const app = loadBindingB(['dashboard/dashboard-participant-share.js']);
    app._formatParticipantQueryShareDateTime = () => '';
    mount(app._renderDashboardParticipantShareNotice({ shareUrl: value }));
    expect(document.querySelector('.dash-query-share-link').textContent).toBe(value);
    activateBindingB(app, '[onclick^="window.open"]', 'open', () => [value, 'sporthub_report', 'noopener'], 'click', 'window');
  });
});


describe.each(VALUES)('事件繫結強化：第二包隊伍與申請人 %p', value => {
  test('tournament-friendly-detail-view：已核准、待審與撤回分支', () => {
    const app = loadBindingB(['tournament/tournament-friendly-detail-view.js']);
    const application = { id: value, teamId: value, teamName: value, requestedByName: value, status: 'pending' };
    const state = { tournament: { id: value, status: '報名中' },
      entries: [{ teamId: value, teamName: value, entryStatus: 'approved', memberRoster: [] }] };
    Object.assign(app, {
      _getFriendlyTournamentVisibleApplications: () => [application],
      _isFriendlyTournamentViewerTeamOfficer: () => true,
      _isFriendlyTournamentViewerOnEntryTeam: () => false,
      _getFriendlyTournamentRosterSummaryText: () => '0 / 1',
    });
    for (const manage of [true, false]) {
      app._canManageTournamentRecord = () => manage;
      mount(app._renderFriendlyTournamentTeamsTab(state));
      expect(document.querySelector('.tfd-team-name').textContent).toBe(value);
      expect(document.querySelector('.tfd-team-row-pending .tfd-team-name').textContent).toBe(value);
      expect(document.querySelector('.tfd-team-row-pending .tfd-empty-text').textContent).toBe(value);
      activateBindingB(app, '.tfd-roster-list-btn', 'openFriendlyTournamentRosterList', () => [value, value]);
      if (manage) {
        activateBindingB(app, '.tfd-entry-remove-btn', 'removeFriendlyTournamentEntry', el => [value, value, el]);
        activateBindingB(app, '.tfd-review-actions .primary-btn', 'reviewFriendlyTournamentApplication', el => [value, value, 'approve', el]);
        activateBindingB(app, '.tfd-review-actions .outline-btn', 'reviewFriendlyTournamentApplication', el => [value, value, 'reject', el]);
      } else {
        activateBindingB(app, '.tfd-entry-withdraw-btn', 'withdrawFriendlyTournamentTeam', el => [value, value, el]);
        activateBindingB(app, '.tfd-team-row-pending .tfd-entry-withdraw-btn', 'withdrawFriendlyTournamentTeam', el => [value, value, el]);
      }
    }
  });
});
