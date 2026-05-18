/**
 * User Admin module unit tests — extracted pure functions.
 *
 * Source files:
 *   js/modules/user-admin/user-admin-corrections.js
 *   js/modules/user-admin/user-admin-roles.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const readProjectFile = relPath => fs.readFileSync(path.join(ROOT, relPath), 'utf8');

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

// ---------------------------------------------------------------------------
// Extracted from user-admin-list.js identity/diff helpers.
// User admin actions must target immutable-ish ids before mutable display names.
// ---------------------------------------------------------------------------
function _findAdminUserByKeyForTest(users, userKey) {
  const key = String(userKey || '').trim();
  if (!key) return null;
  return users.find(u => String(u?._docId || '').trim() === key)
    || users.find(u => String(u?.uid || '').trim() === key)
    || users.find(u => String(u?.lineUserId || '').trim() === key)
    || users.find(u => String(u?.name || '').trim() === key)
    || null;
}

function _setUpdateIfChangedForTest(updates, user, field, nextValue) {
  const oldValue = user?.[field];
  const oldText = oldValue == null ? '' : String(oldValue);
  const nextText = nextValue == null ? '' : String(nextValue);
  if (oldText !== nextText) {
    updates[field] = nextValue;
  }
}

describe('user admin identity helpers (user-admin-list.js)', () => {
  const users = [
    { _docId: 'doc-1', uid: 'uid-1', lineUserId: 'line-1', name: 'Same Name' },
    { _docId: 'doc-2', uid: 'uid-2', lineUserId: 'line-2', name: 'Same Name' },
  ];

  test('prefers doc id over duplicate display names', () => {
    expect(_findAdminUserByKeyForTest(users, 'doc-2')).toBe(users[1]);
  });

  test('resolves uid and lineUserId before display name fallback', () => {
    expect(_findAdminUserByKeyForTest(users, 'uid-2')).toBe(users[1]);
    expect(_findAdminUserByKeyForTest(users, 'line-1')).toBe(users[0]);
  });

  test('keeps legacy display-name lookup as last fallback', () => {
    expect(_findAdminUserByKeyForTest(users, 'Same Name')).toBe(users[0]);
  });
});

describe('user admin edit diff helpers (user-admin-list.js)', () => {
  test('does not write blank defaults over missing profile fields', () => {
    const updates = {};
    _setUpdateIfChangedForTest(updates, {}, 'region', '');
    _setUpdateIfChangedForTest(updates, {}, 'gender', '');
    expect(updates).toEqual({});
  });

  test('allows explicit birthday clearing when an old value exists', () => {
    const updates = {};
    _setUpdateIfChangedForTest(updates, { birthday: '2026/05/12' }, 'birthday', null);
    expect(updates).toEqual({ birthday: null });
  });

  test('preserves existing region values when unchanged', () => {
    const updates = {};
    _setUpdateIfChangedForTest(updates, { region: '台中市' }, 'region', '台中市');
    expect(updates).toEqual({});
  });
});

describe('user admin email field wiring', () => {
  test('renders, edits, searches, and sends email through admin user management', () => {
    const pageHtml = readProjectFile('pages/admin-users.html');
    const listSource = readProjectFile('js/modules/user-admin/user-admin-list.js');
    const crudSource = readProjectFile('js/firebase-crud.js');

    expect(pageHtml).toContain('id="ue-email"');
    expect(listSource).toContain("'ue-email'");
    expect(listSource).toContain("const email = String(u?.email || '').toLowerCase();");
    expect(listSource).toContain("document.getElementById('ue-email').value = user.email || '';");
    expect(listSource).toContain("this._setUpdateIfChanged(updates, oldUser, 'email', email || null);");
    expect(crudSource).toContain("['region', 'gender', 'birthday', 'sports', 'phone', 'email']");
  });
});
