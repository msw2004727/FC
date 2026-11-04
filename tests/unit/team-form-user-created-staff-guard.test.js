// T-090k：A 編輯表單對自建俱樂部（createdVia === 'user_capability'）的職員前置檢查，
// 對應 firestore.rules isUserCreatedStaffChangeSafe（新增職員本人除外、一次一位、排在名單最後、須為本隊成員）。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');

function loadApp(adminUsers) {
  const app = {};
  const context = {
    App: app,
    ApiService: {
      getCurrentUser: () => ({ uid: 'owner' }),
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
  { uid: 'm1', teamIds: ['tm_1'] },
  { uid: 'm2', teamIds: ['tm_1'] },
  { uid: 'outsider', teamIds: ['tm_other'] },
];

describe('T-090k 自建俱樂部職員前置檢查', () => {
  const app = loadApp(USERS);
  const check = (vals, team = TEAM) => app._getUserCreatedTeamStaffBlockMessage(team, { ...BASE, ...vals });

  test('非自建俱樂部不檢查', () => {
    expect(check({ newCoachUids: ['c1', 'outsider', 'm1'] }, { ...TEAM, createdVia: undefined })).toBe('');
  });

  test('沒有新增職員、或只新增本人時通過', () => {
    expect(check({})).toBe('');
    expect(check({ newCoachUids: ['c1', 'owner'] })).toBe('');
    expect(check({ newCoachUids: [] })).toBe('');
  });

  test('新增一位本隊成員、排在最後時通過', () => {
    expect(check({ newCoachUids: ['c1', 'm1'] })).toBe('');
    expect(check({ realLeaderUids: ['m1'] })).toBe('');
  });

  test('一次新增兩位時擋下', () => {
    expect(check({ newCoachUids: ['c1', 'm1', 'm2'] })).not.toBe('');
    expect(check({ newCoachUids: ['c1', 'm1'], realLeaderUids: ['m2'] })).not.toBe('');
  });

  test('新增的職員不在名單最後時擋下', () => {
    expect(check({ newCoachUids: ['m1', 'c1'] })).not.toBe('');
  });

  test('新增的職員不是本隊成員時擋下；查不到資料時交給 Rules', () => {
    expect(check({ newCoachUids: ['c1', 'outsider'] })).not.toBe('');
    expect(check({ newCoachUids: ['c1', 'unknown'] })).toBe('');
  });
});
