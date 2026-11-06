// T-090k：A 編輯表單對自建俱樂部（createdVia === 'user_capability'）的職員前置檢查，
// 對應 firestore.rules isUserCreatedStaffChangeSafe（新增職員本人除外、一次一位、排在名單最後、須為本隊成員）。
// 成員資格只當 Rules 拒絕時的提示（adminUsers 快取可能過期），不在前端擋。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');

function loadApp({ adminUsers = [], currentUser = { uid: 'owner', role: 'user' }, permissions = [] } = {}) {
  const app = { hasPermission: code => permissions.includes(code) };
  const context = {
    App: app,
    ApiService: {
      getCurrentUser: () => currentUser,
      getAdminUsers: () => adminUsers,
    },
    console, Object, Array, String, Set, Map,
  };
  [
    'js/modules/team/team-list-helpers.js',
    'js/modules/team/team-form.js',
  ].forEach(file => {
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context);
  });
  return app;
}

const TEAM = { id: 'tm_1', _docId: 'tm_1', createdVia: 'user_capability', captainUid: 'owner', coachUids: ['c1'], leaderUids: [] };
const BASE = { oldCoachUids: ['c1'], oldLeaderUids: [], newCoachUids: ['c1'], realLeaderUids: [] };
const USERS = [
  // 本人在 adminUsers 裡且不是本隊成員：用來證明「本人除外」的檢查確實生效
  { uid: 'owner', teamIds: ['tm_other'] },
  { uid: 'm1', teamIds: ['tm_1'] },
  { uid: 'm2', teamIds: ['tm_1'] },
  { uid: 'outsider', teamIds: ['tm_other'] },
];
const NONE = { block: '', failHint: '' };
const ONE_AT_A_TIME = '一次只能新增一位';
const AT_TAIL = '排在名單最後';
const MEMBER_HINT = '須先是本隊成員';

describe('T-090k 自建俱樂部職員前置檢查', () => {
  const app = loadApp({ adminUsers: USERS });
  const check = (vals, team = TEAM) => ({ ...app._checkUserCreatedTeamStaff(team, { ...BASE, ...vals }) });

  test('非自建俱樂部不檢查', () => {
    expect(check({ newCoachUids: ['c1', 'outsider', 'm1'] }, { ...TEAM, createdVia: undefined })).toEqual(NONE);
  });

  test('沒有新增職員、或只新增本人時通過，也沒有失敗提示', () => {
    expect(check({})).toEqual(NONE);
    expect(check({ newCoachUids: [] })).toEqual(NONE);
    // 本人不是本隊成員，但 Rules 對本人不設限，所以不擋也不提示
    expect(check({ newCoachUids: ['c1', 'owner'] })).toEqual(NONE);
    expect(check({ newCoachUids: ['owner', 'c1'], realLeaderUids: ['owner'] })).toEqual(NONE);
  });

  test('新增一位、排在最後時不擋，只備好成員資格提示', () => {
    const coach = check({ newCoachUids: ['c1', 'm1'] });
    expect(coach.block).toBe('');
    expect(coach.failHint).toContain(MEMBER_HINT);
    expect(check({ realLeaderUids: ['m1'] }).block).toBe('');
  });

  test('一次新增兩位時擋下（本人加上另一位仍算一位）', () => {
    expect(check({ newCoachUids: ['c1', 'm1', 'm2'] }).block).toContain(ONE_AT_A_TIME);
    expect(check({ newCoachUids: ['c1', 'm1'], realLeaderUids: ['m2'] }).block).toContain(ONE_AT_A_TIME);
    expect(check({ newCoachUids: ['c1', 'owner', 'm1'] }).block).toBe('');
  });

  test('新增的職員不在名單最後時擋下', () => {
    expect(check({ newCoachUids: ['m1', 'c1'] }).block).toContain(AT_TAIL);
  });

  test('快取顯示非成員或查不到時都不擋（交給 Rules）', () => {
    expect(check({ newCoachUids: ['c1', 'outsider'] }).block).toBe('');
    expect(check({ newCoachUids: ['c1', 'unknown'] }).block).toBe('');
  });

  test('可管理全部俱樂部者（super_admin／team.manage_all）跳過檢查', () => {
    const vals = { ...BASE, newCoachUids: ['c1', 'm1', 'm2'] };
    const superApp = loadApp({ adminUsers: USERS, currentUser: { uid: 'sa', role: 'super_admin' } });
    expect({ ...superApp._checkUserCreatedTeamStaff(TEAM, vals) }).toEqual(NONE);
    const managerApp = loadApp({ adminUsers: USERS, permissions: ['team.manage_all'] });
    expect({ ...managerApp._checkUserCreatedTeamStaff(TEAM, vals) }).toEqual(NONE);
  });
});
