/**
 * T-090c（舊站 A 前端）：一般 user 前台活動能力「建立俱樂部」（user.activity.team_create）、
 * 自建俱樂部（createdVia === 'user_capability'）不自動升降級、俱樂部通知帶 teamId／applicantUid。
 * 修正前應失敗：能力清單沒有新碼（未知代碼檢查會報警告、權限管理不顯示新列）；
 * 自建俱樂部儲存仍呼叫 promoteUserByUid；通知 lineOptions 與 Callable payload 沒有關聯鍵。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const TEAM_CREATE = 'user.activity.team_create';
const ROLE_LEVELS = {
  user: 0, coach: 1, captain: 2, venue_owner: 3, admin: 4, super_admin: 5,
};

// 從 js/config.js 切出能力清單與三個 helper 原樣執行（不載入整支 config.js）
function loadCapabilityCatalog() {
  const source = read('js/config.js');
  const catalogStart = source.indexOf('const ROLE_ACTIVITY_CAPABILITY_CATALOG_VERSION');
  const catalogEnd = source.indexOf('const PROFILE_FEATURE_PERMISSION_CATEGORY');
  const helpersStart = source.indexOf('function getRoleActivityCapabilityCodes()');
  const helpersEnd = source.indexOf('const ADMIN_PAGE_EXTRA_PERMISSION_ITEMS');
  expect(catalogStart).toBeGreaterThan(-1);
  expect(catalogEnd).toBeGreaterThan(catalogStart);
  expect(helpersStart).toBeGreaterThan(catalogEnd);
  expect(helpersEnd).toBeGreaterThan(helpersStart);
  const context = { result: null };
  vm.createContext(context);
  vm.runInContext(
    source.slice(catalogStart, catalogEnd)
      + source.slice(helpersStart, helpersEnd)
      + '\nresult = { ROLE_ACTIVITY_CAPABILITY_CATALOG_VERSION, ROLE_ACTIVITY_CAPABILITY_ITEMS,'
      + ' getRoleActivityCapabilityCodes, sanitizeRoleActivityCapabilities, getDefaultRoleActivityCapabilities };',
    context,
  );
  return context.result;
}

function runModule(rel, context) {
  vm.createContext(context);
  vm.runInContext(read(rel), context, { filename: rel });
  return context;
}

describe('T-090c 能力碼 user.activity.team_create', () => {
  test('能力清單含建立俱樂部、預設開、白名單保留、catalog 版號不變', () => {
    const cat = loadCapabilityCatalog();
    const item = cat.ROLE_ACTIVITY_CAPABILITY_ITEMS.find(entry => entry.code === TEAM_CREATE);
    expect(item).toBeTruthy();
    expect(item.name).toBe('建立俱樂部');
    expect(item.defaultEnabled).toBe(true);
    expect(cat.getRoleActivityCapabilityCodes()).toContain(TEAM_CREATE);
    expect(cat.sanitizeRoleActivityCapabilities([TEAM_CREATE, 'user.activity.unknown'])).toEqual([TEAM_CREATE]);
    // 文件不存在時的預設（前端與 Rules／Functions 同為開）
    expect(cat.getDefaultRoleActivityCapabilities('user')).toContain(TEAM_CREATE);
    expect(cat.getDefaultRoleActivityCapabilities('user')).not.toContain('user.activity.addons_use');
    expect(cat.getDefaultRoleActivityCapabilities('coach')).toEqual([]);
    // 版號不 bump：舊程式的 _seedRoleData 不會因版號不同反覆改寫文件（R-CAP-008）
    expect(cat.ROLE_ACTIVITY_CAPABILITY_CATALOG_VERSION).toBe('20260505a');
    // 明確存成 [] 仍是全關（R-CAP-003）
    expect(cat.sanitizeRoleActivityCapabilities([])).toEqual([]);
  });

  test('權限稽核的未知代碼檢查認得新碼', () => {
    const cat = loadCapabilityCatalog();
    const App = {};
    runModule('js/modules/user-admin/permission-audit/permission-audit.js', {
      App,
      console,
      getRoleActivityCapabilityCodes: cat.getRoleActivityCapabilityCodes,
      FirebaseService: {
        _cache: {
          roleActivityCapabilities: {
            user: ['user.activity.basic_create', TEAM_CREATE, 'user.activity.unknown'],
          },
        },
      },
    });
    const issues = App._auditUserActivityCapabilities();
    expect(issues.map(issue => issue.detail)).toEqual(['user.activity.unknown']);
  });

  test('權限管理「一般 user 前台活動能力」自動顯示新列與說明', () => {
    const cat = loadCapabilityCatalog();
    const App = { _permSelectedRole: 'user', currentRole: 'super_admin' };
    const appended = [];
    runModule('js/modules/user-admin/user-admin-roles.js', {
      App,
      console,
      ROLE_LEVEL_MAP: ROLE_LEVELS,
      ROLE_ACTIVITY_CAPABILITY_ITEMS: cat.ROLE_ACTIVITY_CAPABILITY_ITEMS,
      escapeHTML: value => String(value),
      escapeJsAttr: value => String(value),
      ApiService: { getRoleActivityCapabilities: () => [TEAM_CREATE] },
      FirebaseService: { _cache: {} },
      document: {
        createElement: () => ({ addEventListener() {}, remove() {} }),
        body: { appendChild: node => appended.push(node) },
      },
    });
    App._permSelectedRole = 'user';
    App.currentRole = 'super_admin';
    const html = App._renderUserActivityCapabilitySection();
    expect(html).toContain(`App.toggleUserActivityCapability('${TEAM_CREATE}')`);
    expect(html).toContain('建立俱樂部');

    App._showUserActivityCapabilityInfo(TEAM_CREATE);
    expect(appended).toHaveLength(1);
    expect(appended[0].innerHTML).toContain('建立俱樂部');
  });
});

function loadTeamFormRoles({ teams = {}, promoteResult = null } = {}) {
  const App = {};
  const promoteUserByUid = jest.fn(async () => promoteResult);
  const users = [
    { uid: 'U-captain', name: 'Captain' },
    { uid: 'U-coach', name: 'Coach' },
    { uid: 'U-leader', name: 'Leader' },
  ];
  runModule('js/modules/team/team-form-roles.js', {
    App,
    console,
    ROLE_LEVEL_MAP: ROLE_LEVELS,
    ROLES: { user: { label: 'User' }, coach: { label: 'Coach' }, captain: { label: 'Captain' } },
    ApiService: {
      getUserDirectory: () => users,
      getAdminUsers: () => [],
      getTeam: id => teams[id] || null,
      promoteUserByUid,
      _writeOpLog: jest.fn(),
    },
  });
  const deliver = jest.fn();
  const sendTemplate = jest.fn();
  Object.assign(App, { _deliverMessageWithLinePush: deliver, _sendNotifFromTemplate: sendTemplate });
  return { App, promoteUserByUid, deliver, sendTemplate };
}

const SAVE_CONTEXT = {
  editId: 'tm_1', teamId: 'tm_1', oldCaptainUid: 'U-old-captain',
  oldCoachUids: ['U-old-coach'], oldLeaderUids: [],
  realLeaderUids: ['U-leader'], newCoachUids: ['U-coach'],
  captainUid: 'U-captain', coachUids: ['U-coach'],
};

describe('T-090c 俱樂部儲存後的角色同步', () => {
  test('自建俱樂部（createdVia=user_capability）不呼叫自動升降級，職位通知仍帶 teamId', async () => {
    const { App, promoteUserByUid, deliver, sendTemplate } = loadTeamFormRoles({
      teams: { tm_1: { id: 'tm_1', _docId: 'tm_1', createdVia: 'user_capability' } },
    });
    await expect(App._applyTeamRoleChangesAfterSave({ ...SAVE_CONTEXT }, 'Club'))
      .resolves.toEqual({ ok: true, failed: 0 });
    expect(promoteUserByUid).not.toHaveBeenCalled();
    expect(sendTemplate).not.toHaveBeenCalled();
    const sources = deliver.mock.calls.map(call => call[7].lineOptions);
    expect(sources).toEqual([
      { source: 'team_role_assignment:captain', teamId: 'tm_1' },
      { source: 'team_role_assignment:leader', teamId: 'tm_1' },
      { source: 'team_role_assignment:coach', teamId: 'tm_1' },
    ]);
  });

  test('一般俱樂部照舊自動升降級，身份變更通知帶 teamId 與指派角色', async () => {
    const { App, promoteUserByUid, sendTemplate } = loadTeamFormRoles({
      teams: { tm_1: { id: 'tm_1', _docId: 'tm_1' } },
      promoteResult: { oldRole: 'user', newRole: 'coach' },
    });
    await App._applyTeamRoleChangesAfterSave({ ...SAVE_CONTEXT }, 'Club');
    expect(new Set(promoteUserByUid.mock.calls.map(call => call[0]))).toEqual(new Set([
      'U-captain', 'U-leader', 'U-coach', 'U-old-captain', 'U-old-coach',
    ]));
    const byUid = Object.fromEntries(sendTemplate.mock.calls.map(call => [call[2], call[6]]));
    expect(byUid['U-captain']).toEqual({ lineOptions: { teamId: 'tm_1', assignmentRole: 'captain' } });
    expect(byUid['U-leader']).toEqual({ lineOptions: { teamId: 'tm_1', assignmentRole: 'leader' } });
    expect(byUid['U-coach']).toEqual({ lineOptions: { teamId: 'tm_1', assignmentRole: 'coach' } });
    sendTemplate.mock.calls.forEach(call => expect(call[0]).toBe('role_upgrade'));
  });
});

describe('T-090c 俱樂部詳情層級調整', () => {
  function loadTeamDetail(team) {
    const App = {};
    const recalc = jest.fn(() => ({ uid: 'U-member', oldRole: 'user', newRole: 'coach', userName: 'Member' }));
    runModule('js/modules/team/team-detail.js', {
      App,
      console,
      ApiService: {
        getTeam: () => team,
        updateTeamAwait: jest.fn(async () => undefined),
        getAdminUsers: () => [],
        _recalcUserRole: recalc,
        _writeOpLog: jest.fn(),
        _writeErrorLog: jest.fn(),
      },
    });
    const row = { uid: 'U-member', name: 'Member', user: { uid: 'U-member', name: 'Member' } };
    const target = {
      key: 'coach', label: '教練', roleName: '教練', level: 1,
      lineSource: 'team_role_assignment:coach', actionText: '晉升',
    };
    const deliver = jest.fn();
    const applyRoleChange = jest.fn();
    Object.assign(App, {
      _canQuickPromoteTeamMember: () => true,
      _findTeamDetailRosterRow: () => row,
      _getTeamMemberRoleActionTarget: () => ({ ...target, direction: 'promote' }),
      _buildTeamRoleLevelUpdates: () => ({ coachUids: ['U-member'] }),
      _confirmTeamMemberRoleLevelChange: async () => true,
      _refreshTeamMembersCardFromCache: () => true,
      _deliverMessageWithLinePush: deliver,
      _applyRoleChange: applyRoleChange,
      showToast: jest.fn(),
    });
    return { App, recalc, deliver, applyRoleChange };
  }

  test('自建俱樂部晉升成員不呼叫角色重算，通知帶 teamId', async () => {
    const { App, recalc, deliver, applyRoleChange } = loadTeamDetail({
      id: 'tm_9', _docId: 'tm_9', name: 'Club', createdVia: 'user_capability',
    });
    await App.changeTeamMemberRoleLevel(null, 'tm_9', 'U-member', 'promote');
    expect(recalc).not.toHaveBeenCalled();
    expect(applyRoleChange).not.toHaveBeenCalled();
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver.mock.calls[0][7]).toEqual({
      lineOptions: { source: 'team_role_assignment:coach', teamId: 'tm_9' },
    });
  });

  test('一般俱樂部照舊重算角色，身份變更通知帶 teamId 與指派角色', async () => {
    const { App, recalc, applyRoleChange } = loadTeamDetail({ id: 'tm_8', _docId: 'tm_8', name: 'Club' });
    await App.changeTeamMemberRoleLevel(null, 'tm_8', 'U-member', 'promote');
    expect(recalc).toHaveBeenCalledWith('U-member', 'tm_8');
    expect(applyRoleChange.mock.calls[0][1]).toEqual({ teamId: 'tm_8', assignmentRole: 'coach' });
  });

  test('_applyRoleChange 把 teamId／assignmentRole 交給 role_upgrade 通知；未帶時維持舊呼叫', () => {
    const App = {};
    runModule('js/modules/team/team-list-helpers.js', {
      App,
      console,
      ROLE_LEVEL_MAP: ROLE_LEVELS,
      ROLES: { user: { label: 'User' }, coach: { label: 'Coach' } },
      ApiService: { _writeOpLog: jest.fn() },
    });
    const sendTemplate = jest.fn();
    App._sendNotifFromTemplate = sendTemplate;
    const result = { uid: 'U-1', oldRole: 'user', newRole: 'coach', userName: 'One' };
    App._applyRoleChange(result, { teamId: 'tm_1', assignmentRole: 'coach' });
    App._applyRoleChange(result);
    expect(sendTemplate.mock.calls[0][6]).toEqual({ lineOptions: { teamId: 'tm_1', assignmentRole: 'coach' } });
    expect(sendTemplate.mock.calls[1][6]).toEqual({ lineOptions: {} });
  });
});

describe('T-090c 入隊審核通知', () => {
  function loadJoinAction({ applicant, messages }) {
    const App = {};
    const team = { id: 'tm_5', _docId: 'tm_5', name: 'Club', captainUid: 'U-cap' };
    runModule('js/modules/message/message-actions-team.js', {
      App,
      console,
      ApiService: {
        getMessages: () => messages,
        getTeamAsync: async () => team,
        getTeam: () => team,
        getCurrentUser: () => ({ uid: 'U-cap', displayName: 'Cap', role: 'user' }),
        getAdminUsers: () => (applicant ? [applicant] : []),
        updateTeam: jest.fn(),
        updateMessage: jest.fn(),
        writeAuditLog: jest.fn(async () => undefined),
        _writeOpLog: jest.fn(),
        _writeErrorLog: jest.fn(),
      },
      document: { getElementById: () => ({ style: {} }) },
    });
    const deliver = jest.fn();
    Object.assign(App, {
      hasPermission: () => true,
      showToast: jest.fn(),
      renderMessageList: jest.fn(),
      _evaluateAchievements: jest.fn(),
      _calcTeamMemberCount: () => 1,
      _deliverMessageWithLinePush: deliver,
    });
    return { App, deliver };
  }

  const baseMeta = { teamId: 'tm_5', teamName: 'Club', applicantUid: 'U-app', applicantName: 'App', groupId: 'tjr_1' };

  test('拒絕與廣播通知帶 teamId／applicantUid', async () => {
    const messages = [
      { id: 'm1', actionType: 'team_join_request', actionStatus: 'pending', targetUid: 'U-cap', meta: { ...baseMeta } },
      { id: 'm2', actionType: 'team_join_request', actionStatus: 'pending', targetUid: 'U-coach', meta: { ...baseMeta } },
    ];
    const { App, deliver } = loadJoinAction({ messages });
    await App.handleTeamJoinAction('m1', 'reject');
    const lineOptions = deliver.mock.calls.map(call => call[7].lineOptions);
    expect(lineOptions).toEqual([
      { source: 'team_join_review:reject', teamId: 'tm_5', applicantUid: 'U-app' },
      { source: 'team_join_review:broadcast:reject', teamId: 'tm_5', applicantUid: 'U-app' },
    ]);
  });

  test('核准通知帶 teamId／applicantUid', async () => {
    const messages = [
      { id: 'm1', actionType: 'team_join_request', actionStatus: 'pending', targetUid: 'U-cap', meta: { ...baseMeta, groupId: '' } },
    ];
    const { App, deliver } = loadJoinAction({ applicant: { uid: 'U-app', name: 'App' }, messages });
    await App.handleTeamJoinAction('m1', 'approve');
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver.mock.calls[0][4]).toBe('U-app');
    expect(deliver.mock.calls[0][7].lineOptions).toEqual({
      source: 'team_join_review:approve', teamId: 'tm_5', applicantUid: 'U-app',
    });
  });
});

describe('T-090c LINE 推播 Callable payload', () => {
  test('關聯鍵放在 enqueuePrivilegedLineNotification 頂層，其他選項不外送', async () => {
    const App = {};
    const callable = jest.fn(async () => ({ data: { queued: true, queueId: 'q1' } }));
    const httpsCallable = jest.fn(() => callable);
    runModule('js/modules/message/message-line-push.js', {
      App,
      console: { ...console, log: jest.fn() },
      ensureFirebaseFunctionsSdk: async () => ({ httpsCallable }),
    });
    await App._enqueuePrivilegedLinePush('U-app', 'system', 'T', 'B', {
      source: 'team_join_review:approve',
      dedupeKey: 'd1',
      teamId: ' tm_5 ',
      applicantUid: 'U-app',
      assignmentRole: '',
      lineTitle: 'ignored',
    });
    expect(httpsCallable).toHaveBeenCalledWith('enqueuePrivilegedLineNotification');
    expect(callable).toHaveBeenCalledWith({
      uid: 'U-app',
      category: 'system',
      title: 'T',
      body: 'B',
      source: 'team_join_review:approve',
      dedupeKey: 'd1',
      teamId: 'tm_5',
      applicantUid: 'U-app',
    });
  });
});
