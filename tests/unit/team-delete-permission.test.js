/**
 * _canDeleteTeam — 刪除鈕與 removeTeam 共用的判斷，對齊 Callable deleteTeam
 * （functions/team-deletion.js：isFrontendTeamDeleter ∧ isCoachPlusAccess）：
 *   super_admin ∨ ((擁有者 ∨ team.manage_all) ∧ (教練以上 ∨ admin.repair.team_join_repair))
 *
 * 已知限制（顧問裁定接受，不在本次處理）：
 *   1. Callable 只比對 uid；前端擁有者判斷另認 _docId（第二身分不參與擁有權）。
 *   2. Callable 的權限碼在 rolePermissions/{role} 缺文件時不套預設權限；前端會套預設（正式三個角色文件都存在）。
 *   3. Callable 的角色等級表不含自訂角色；前端 ROLE_LEVEL_MAP 會解析自訂角色（正式 customRoles 為 0，日後與 T-079a 一起開卡）。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
const ROLE_LEVEL_MAP = { user: 0, coach: 1, captain: 2, venue_owner: 3, admin: 4, super_admin: 5 };

function loadHelpers({ role, perms = [] }) {
  const app = { hasPermission: code => perms.includes(code) };
  const context = {
    App: app,
    ApiService: { getCurrentUser: () => ({ uid: 'me', _docId: 'me', role }) },
    ROLE_LEVEL_MAP,
    console,
    Object,
    Array,
    String,
  };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/modules/team/team-list-helpers.js'), 'utf8'), context);
  return app;
}

const ownTeam = { id: 'tm_own', captainUid: 'me' };
const otherTeam = { id: 'tm_other', captainUid: 'someone' };

describe('_canDeleteTeam（對齊 Callable deleteTeam）', () => {
  test('user 擁有者看不到刪除鈕', () => {
    expect(loadHelpers({ role: 'user' })._canDeleteTeam(ownTeam)).toBe(false);
  });

  test('coach 擁有者看得到；coach 非擁有者看不到', () => {
    const app = loadHelpers({ role: 'coach' });
    expect(app._canDeleteTeam(ownTeam)).toBe(true);
    expect(app._canDeleteTeam(otherTeam)).toBe(false);
  });

  test('教練以上且有 team.manage_all 看得到他隊；user 只有 team.manage_all 授權看不到', () => {
    expect(loadHelpers({ role: 'admin', perms: ['team.manage_all'] })._canDeleteTeam(otherTeam)).toBe(true);
    expect(loadHelpers({ role: 'user', perms: ['team.manage_all'] })._canDeleteTeam(otherTeam)).toBe(false);
  });

  test('admin.repair.team_join_repair 可抵教練以上：user 擁有者看得到；非擁有者只有此權限看不到', () => {
    const app = loadHelpers({ role: 'user', perms: ['admin.repair.team_join_repair'] });
    expect(app._canDeleteTeam(ownTeam)).toBe(true);
    expect(app._canDeleteTeam(otherTeam)).toBe(false);
  });

  test('super_admin 一律看得到', () => {
    expect(loadHelpers({ role: 'super_admin' })._canDeleteTeam(otherTeam)).toBe(true);
  });
});
