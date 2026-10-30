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
  test.each(['invite', 'overlay'])('team-detail：固定開關 %s', action => {
    const app = load('team/team-detail.js');
    mount(app._buildTeamDetailSettingsSwitch(false, action, '測試'));
    activate(app, 'input', action === 'invite' ? 'toggleTeamMemberInviteSetting' : 'toggleTeamThemeOverlay', element => [false, element], 'change');
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
