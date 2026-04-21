/**
 * Super admin 隱身模式 — unit tests
 *
 * Extracted from: js/modules/profile/profile-core.js (_stealthRole)
 *
 * 重點驗證：
 *   - 短路優化：非管理角色直接返回（不查 user）
 *   - 三個查找路徑：user 物件 / uid 字串 / fallback by name
 *   - 目標用戶 stealth=true 且為 admin/super_admin → 'user'
 *   - 目標用戶 stealth=false/undefined → 保持原 role
 *   - 邊界：空值、無效 uid、找不到用戶
 */

// ─── 從 profile-core.js 抽取 _stealthRole ───
// 輸入 userOrUid 可能是：
//   1. undefined/null → fallback by name
//   2. object → 直接讀 stealth
//   3. string → 當作 uid，用 findByUid 查找
function _stealthRole(name, role, userOrUid, {
  findUserByUid = () => null,
  findUserByName = () => null,
} = {}) {
  // 短路：非管理角色不需要判斷 stealth
  if (role !== 'admin' && role !== 'super_admin') return role;
  // 已傳入 user 物件 → 直接讀
  if (userOrUid && typeof userOrUid === 'object') {
    return userOrUid.stealth === true ? 'user' : role;
  }
  // 傳入 uid 字串 → O(1) 查找
  if (typeof userOrUid === 'string' && userOrUid) {
    const user = findUserByUid(userOrUid);
    return user?.stealth === true ? 'user' : role;
  }
  // fallback：用 name 查找
  const user = findUserByName(name);
  return user?.stealth === true ? 'user' : role;
}

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════

describe('_stealthRole — 短路優化（非管理角色）', () => {
  test('user 角色直接返回，不觸發查找', () => {
    let findCalled = 0;
    const findUserByUid = () => { findCalled++; return null; };
    expect(_stealthRole('小明', 'user', 'uid123', { findUserByUid })).toBe('user');
    expect(findCalled).toBe(0);
  });

  test('coach 角色直接返回', () => {
    expect(_stealthRole('教練', 'coach')).toBe('coach');
  });

  test('captain 角色直接返回', () => {
    expect(_stealthRole('幹部', 'captain')).toBe('captain');
  });

  test('venue_owner 角色直接返回', () => {
    expect(_stealthRole('場地主', 'venue_owner')).toBe('venue_owner');
  });
});

describe('_stealthRole — 傳入 user 物件', () => {
  test('admin 且 stealth=true → 隱身為 user', () => {
    expect(_stealthRole('管理員', 'admin', { stealth: true })).toBe('user');
  });

  test('super_admin 且 stealth=true → 隱身為 user', () => {
    expect(_stealthRole('總管', 'super_admin', { stealth: true })).toBe('user');
  });

  test('admin 但 stealth=false → 保持 admin', () => {
    expect(_stealthRole('管理員', 'admin', { stealth: false })).toBe('admin');
  });

  test('admin 但 stealth=undefined → 保持 admin', () => {
    expect(_stealthRole('管理員', 'admin', {})).toBe('admin');
  });

  test('stealth 必須嚴格等於 true', () => {
    expect(_stealthRole('管理員', 'admin', { stealth: 'true' })).toBe('admin'); // 字串不算
    expect(_stealthRole('管理員', 'admin', { stealth: 1 })).toBe('admin');      // 數字不算
  });
});

describe('_stealthRole — 傳入 uid 字串', () => {
  const stealthyAdmin = { uid: 'admin-1', stealth: true };
  const normalAdmin = { uid: 'admin-2', stealth: false };

  test('uid 查到隱身管理員 → user', () => {
    const findUserByUid = (uid) => uid === 'admin-1' ? stealthyAdmin : null;
    expect(_stealthRole('anyname', 'admin', 'admin-1', { findUserByUid })).toBe('user');
  });

  test('uid 查到非隱身管理員 → 保持 admin', () => {
    const findUserByUid = (uid) => uid === 'admin-2' ? normalAdmin : null;
    expect(_stealthRole('anyname', 'admin', 'admin-2', { findUserByUid })).toBe('admin');
  });

  test('uid 查無資料 → 保持原 role', () => {
    const findUserByUid = () => null;
    expect(_stealthRole('anyname', 'admin', 'ghost-uid', { findUserByUid })).toBe('admin');
  });
});

describe('_stealthRole — fallback by name', () => {
  const stealthyAdmin = { uid: 'admin-1', stealth: true };

  test('無 uid → 用 name 查找', () => {
    const findUserByName = (name) => name === '總管' ? stealthyAdmin : null;
    expect(_stealthRole('總管', 'super_admin', null, { findUserByName })).toBe('user');
  });

  test('uid 為空字串 → fallback to name', () => {
    const findUserByName = (name) => name === '總管' ? stealthyAdmin : null;
    expect(_stealthRole('總管', 'super_admin', '', { findUserByName })).toBe('user');
  });

  test('name + uid 都查不到 → 保持原 role', () => {
    expect(_stealthRole('ghost', 'admin')).toBe('admin');
  });

  test('非管理 role 不走 fallback 查找', () => {
    let findCalled = 0;
    const findUserByName = () => { findCalled++; return null; };
    expect(_stealthRole('小明', 'user', null, { findUserByName })).toBe('user');
    expect(findCalled).toBe(0);
  });
});

describe('_stealthRole — 優先順序驗證', () => {
  test('user 物件優先於 uid 字串', () => {
    const findUserByUid = () => ({ stealth: false }); // 若被呼叫會回傳 false
    const objUser = { stealth: true };
    expect(_stealthRole('x', 'admin', objUser, { findUserByUid })).toBe('user');
  });

  test('uid 字串優先於 name 查找', () => {
    const findUserByUid = () => ({ stealth: true });
    const findUserByName = () => ({ stealth: false });
    expect(_stealthRole('x', 'admin', 'some-uid', { findUserByUid, findUserByName })).toBe('user');
  });
});

describe('_stealthRole — 場景整合', () => {
  test('場景：其他用戶看隱身中的 super_admin → 灰色 user', () => {
    const stealthyAdmin = { uid: 'admin-1', stealth: true };
    const findUserByUid = (uid) => uid === 'admin-1' ? stealthyAdmin : null;
    // 其他用戶看 super_admin 的膠囊
    expect(_stealthRole('總管大名', 'super_admin', 'admin-1', { findUserByUid })).toBe('user');
  });

  test('場景：super_admin 自己看自己（未隱身）→ 紅色 super_admin', () => {
    const self = { uid: 'admin-1', stealth: false };
    expect(_stealthRole('自己', 'super_admin', self)).toBe('super_admin');
  });

  test('場景：super_admin 自己看自己（已隱身）→ 灰色 user', () => {
    const self = { uid: 'admin-1', stealth: true };
    expect(_stealthRole('自己', 'super_admin', self)).toBe('user');
  });

  test('場景：報名名單 100 人中 1 個 admin，短路讓其他 99 次不查 user', () => {
    let findCalled = 0;
    const findUserByUid = () => { findCalled++; return null; };
    const findUserByName = () => { findCalled++; return null; };
    // 99 個 user 角色
    for (let i = 0; i < 99; i++) {
      _stealthRole(`user${i}`, 'user', `uid${i}`, { findUserByUid, findUserByName });
    }
    expect(findCalled).toBe(0); // 短路優化生效
  });
});
