/**
 * User Admin module unit tests — extracted pure functions.
 *
 * Source files:
 *   js/modules/user-admin/user-admin-corrections.js
 *   js/modules/user-admin/user-admin-roles.js
 */

// ---------------------------------------------------------------------------
// Extracted from user-admin-corrections.js:8-15
// _getUserCorrectionPrimaryLabel — finds first non-empty display label
// ---------------------------------------------------------------------------
function _getUserCorrectionPrimaryLabel(user) {
  const candidates = [user?.name, user?.displayName, user?.uid, user?.lineUserId];
  for (const value of candidates) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '未命名用戶';
}

// ---------------------------------------------------------------------------
// Extracted from user-admin-corrections.js:16-20
// _getUserCorrectionIdentityText — primary label with UID suffix
// ---------------------------------------------------------------------------
function _getUserCorrectionIdentityText(user) {
  const primaryLabel = _getUserCorrectionPrimaryLabel(user);
  const uid = String(user?.uid || '').trim();
  return uid && primaryLabel !== uid ? `${primaryLabel}（${uid}）` : primaryLabel;
}

// ---------------------------------------------------------------------------
// Extracted from user-admin-corrections.js:96-108
// _formatCorrectionTime — handles various date formats
// ---------------------------------------------------------------------------
function _formatCorrectionTime(value) {
  if (!value) return '—';
  const raw = typeof value?.toDate === 'function' ? value.toDate() : value;
  const date = raw instanceof Date ? raw : new Date(raw);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Extracted from user-admin-roles.js:58-60
// _isLockedPermissionRole — checks if role permissions are locked
// ---------------------------------------------------------------------------
function _isLockedPermissionRole(roleKey) {
  return roleKey === 'super_admin' || roleKey === 'user';
}

// ---------------------------------------------------------------------------
// Extracted from user-admin-roles.js:62-70
// _getLockedPermissionRoleHint — returns lock hint message
// ---------------------------------------------------------------------------
function _getLockedPermissionRoleHint(roleKey) {
  if (roleKey === 'super_admin') {
    return '總管層級固定擁有全部權限，所有開關已鎖定，避免誤關閉。';
  }
  if (roleKey === 'user') {
    return '一般用戶固定沒有任何後台功能權限，所有開關已鎖定，避免誤開啟。';
  }
  return '';
}

// ===========================================================================
// TESTS
// ===========================================================================

describe('_getUserCorrectionPrimaryLabel (user-admin-corrections.js:8-15)', () => {
  test('name is first priority', () => {
    expect(_getUserCorrectionPrimaryLabel({ name: 'Alice', displayName: 'Bob', uid: 'u1' }))
      .toBe('Alice');
  });

  test('falls back to displayName', () => {
    expect(_getUserCorrectionPrimaryLabel({ displayName: 'Bob', uid: 'u1' }))
      .toBe('Bob');
  });

  test('falls back to uid', () => {
    expect(_getUserCorrectionPrimaryLabel({ uid: 'u1' }))
      .toBe('u1');
  });

  test('falls back to lineUserId', () => {
    expect(_getUserCorrectionPrimaryLabel({ lineUserId: 'line123' }))
      .toBe('line123');
  });

  test('no fields → default label', () => {
    expect(_getUserCorrectionPrimaryLabel({})).toBe('未命名用戶');
  });

  test('null user → default label', () => {
    expect(_getUserCorrectionPrimaryLabel(null)).toBe('未命名用戶');
  });

  test('blank strings skipped', () => {
    expect(_getUserCorrectionPrimaryLabel({ name: '', displayName: '  ', uid: 'u1' }))
      .toBe('u1');
  });
});

describe('_getUserCorrectionIdentityText (user-admin-corrections.js:16-20)', () => {
  test('name + uid → name（uid）', () => {
    expect(_getUserCorrectionIdentityText({ name: 'Alice', uid: 'u1' }))
      .toBe('Alice（u1）');
  });

  test('uid only → uid (no brackets)', () => {
    expect(_getUserCorrectionIdentityText({ uid: 'u1' }))
      .toBe('u1');
  });

  test('no uid → just label', () => {
    expect(_getUserCorrectionIdentityText({ name: 'Alice' }))
      .toBe('Alice');
  });

  test('null user → default', () => {
    expect(_getUserCorrectionIdentityText(null)).toBe('未命名用戶');
  });
});

describe('_formatCorrectionTime (user-admin-corrections.js:96-108)', () => {
  test('null → —', () => {
    expect(_formatCorrectionTime(null)).toBe('—');
  });

  test('undefined → —', () => {
    expect(_formatCorrectionTime(undefined)).toBe('—');
  });

  test('Date object → formatted string', () => {
    const d = new Date(2026, 2, 17, 14, 30);
    const result = _formatCorrectionTime(d);
    // zh-TW locale format may vary; just check it's not '—'
    expect(result).not.toBe('—');
    expect(result).toContain('2026');
  });

  test('Firestore Timestamp-like → formatted', () => {
    const fakeTimestamp = {
      toDate: () => new Date(2026, 2, 17, 14, 30),
    };
    const result = _formatCorrectionTime(fakeTimestamp);
    expect(result).not.toBe('—');
    expect(result).toContain('2026');
  });

  test('ISO string → formatted', () => {
    const result = _formatCorrectionTime('2026-03-17T14:30:00');
    expect(result).not.toBe('—');
    expect(result).toContain('2026');
  });

  test('invalid string → —', () => {
    expect(_formatCorrectionTime('not-a-date')).toBe('—');
  });
});

describe('_isLockedPermissionRole (user-admin-roles.js:58-60)', () => {
  test('super_admin → true', () => {
    expect(_isLockedPermissionRole('super_admin')).toBe(true);
  });

  test('user → true', () => {
    expect(_isLockedPermissionRole('user')).toBe(true);
  });

  test('admin → false', () => {
    expect(_isLockedPermissionRole('admin')).toBe(false);
  });

  test('coach → false', () => {
    expect(_isLockedPermissionRole('coach')).toBe(false);
  });

  test('captain → false', () => {
    expect(_isLockedPermissionRole('captain')).toBe(false);
  });

  test('null → false', () => {
    expect(_isLockedPermissionRole(null)).toBe(false);
  });
});

describe('_getLockedPermissionRoleHint (user-admin-roles.js:62-70)', () => {
  test('super_admin → hint about all permissions locked', () => {
    const hint = _getLockedPermissionRoleHint('super_admin');
    expect(hint).toContain('總管');
    expect(hint).toContain('鎖定');
  });

  test('user → hint about no permissions', () => {
    const hint = _getLockedPermissionRoleHint('user');
    expect(hint).toContain('一般用戶');
    expect(hint).toContain('鎖定');
  });

  test('other roles → empty string', () => {
    expect(_getLockedPermissionRoleHint('admin')).toBe('');
    expect(_getLockedPermissionRoleHint('coach')).toBe('');
  });
});
