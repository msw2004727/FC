/**
 * Tests for showUserProfile UID-first lookup + _userTag uid option
 */

// Mock dependencies
const mockUsers = [
  { uid: 'U_alice_001', lineUserId: 'U_alice_001', name: '小明', displayName: '小明', role: 'user', exp: 100, pictureUrl: 'https://example.com/alice.jpg' },
  { uid: 'U_bob_002', lineUserId: 'U_bob_002', name: '小明', displayName: '小明', role: 'coach', exp: 500, pictureUrl: 'https://example.com/bob.jpg' },
  { uid: 'U_charlie_003', lineUserId: 'U_charlie_003', name: '小華', displayName: '小華', role: 'admin', exp: 1000, pictureUrl: '' },
];

// ---------------------------------------------------------------------------
// Extracted from js/modules/profile/profile-core.js — _findUserByUid
// UID-first lookup for user profile
// ---------------------------------------------------------------------------
function _findUserByUid(uid, users) {
  if (!uid) return null;
  return users.find(u => u.uid === uid || u.lineUserId === uid) || null;
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/profile/profile-core.js — _findUserByName
// Name-based fallback lookup
// ---------------------------------------------------------------------------
function _findUserByName(name, users) {
  return users.find(u => u.name === name) || null;
}

// ---------------------------------------------------------------------------
// Combined lookup logic (mirrors showUserProfile internal logic)
// ---------------------------------------------------------------------------
function resolveUser(name, uidHint, users) {
  return _findUserByUid(uidHint, users) || _findUserByName(name, users);
}

// ---------------------------------------------------------------------------
// Extracted from js/config.js:444-452 — escapeHTML
// ---------------------------------------------------------------------------
function escapeHTML(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Simplified _userTag onclick generation (mirrors profile-core.js logic)
// ---------------------------------------------------------------------------
function generateOnclick(name, options) {
  const _uid = options && options.uid ? options.uid : '';
  return _uid
    ? `App.showUserProfile('${escapeHTML(name)}',{uid:'${escapeHTML(_uid)}'})`
    : `App.showUserProfile('${escapeHTML(name)}')`;
}

describe('UID-first User Profile Lookup', () => {

  describe('_findUserByUid', () => {
    test('finds user by uid', () => {
      const result = _findUserByUid('U_alice_001', mockUsers);
      expect(result).not.toBeNull();
      expect(result.uid).toBe('U_alice_001');
    });

    test('finds user by lineUserId', () => {
      const result = _findUserByUid('U_bob_002', mockUsers);
      expect(result).not.toBeNull();
      expect(result.uid).toBe('U_bob_002');
    });

    test('returns null for non-existent uid', () => {
      expect(_findUserByUid('U_nonexistent', mockUsers)).toBeNull();
    });

    test('returns null for empty uid', () => {
      expect(_findUserByUid('', mockUsers)).toBeNull();
    });

    test('returns null for null uid', () => {
      expect(_findUserByUid(null, mockUsers)).toBeNull();
    });

    test('returns null for undefined uid', () => {
      expect(_findUserByUid(undefined, mockUsers)).toBeNull();
    });
  });

  describe('resolveUser (UID-first + name fallback)', () => {
    test('UID takes priority over name for same-name users', () => {
      // 兩個用戶都叫「小明」，用 UID 區分
      const alice = resolveUser('小明', 'U_alice_001', mockUsers);
      const bob = resolveUser('小明', 'U_bob_002', mockUsers);
      expect(alice.uid).toBe('U_alice_001');
      expect(bob.uid).toBe('U_bob_002');
      expect(alice.role).toBe('user');
      expect(bob.role).toBe('coach');
    });

    test('falls back to name when UID is not provided', () => {
      const result = resolveUser('小明', null, mockUsers);
      expect(result).not.toBeNull();
      expect(result.name).toBe('小明');
      // 回傳第一個匹配的（name lookup 的限制）
    });

    test('falls back to name when UID does not match', () => {
      const result = resolveUser('小華', 'U_nonexistent', mockUsers);
      expect(result).not.toBeNull();
      expect(result.name).toBe('小華');
      expect(result.uid).toBe('U_charlie_003');
    });

    test('returns null when neither UID nor name matches', () => {
      const result = resolveUser('不存在的人', 'U_nonexistent', mockUsers);
      expect(result).toBeNull();
    });

    test('UID lookup works even when name is empty', () => {
      const result = resolveUser('', 'U_charlie_003', mockUsers);
      expect(result).not.toBeNull();
      expect(result.uid).toBe('U_charlie_003');
    });
  });

  describe('_userTag onclick generation with uid option', () => {
    test('generates onclick with UID when options.uid is provided', () => {
      const onclick = generateOnclick('小明', { uid: 'U_alice_001' });
      expect(onclick).toContain('U_alice_001');
      expect(onclick).toContain('{uid:');
      expect(onclick).toBe("App.showUserProfile('小明',{uid:'U_alice_001'})");
    });

    test('generates onclick without UID when options.uid is empty', () => {
      const onclick = generateOnclick('小明', { uid: '' });
      expect(onclick).toBe("App.showUserProfile('小明')");
      expect(onclick).not.toContain('{uid:');
    });

    test('generates onclick without UID when options is empty', () => {
      const onclick = generateOnclick('小明', {});
      expect(onclick).toBe("App.showUserProfile('小明')");
    });

    test('generates onclick without UID when options is null', () => {
      const onclick = generateOnclick('小明', null);
      expect(onclick).toBe("App.showUserProfile('小明')");
    });

    test('escapes special characters in name', () => {
      const onclick = generateOnclick("O'Brien", { uid: 'U_test' });
      expect(onclick).toContain('O&#39;Brien');
      expect(onclick).not.toContain("O'Brien");
    });

    test('escapes special characters in UID', () => {
      const onclick = generateOnclick('Test', { uid: "uid'inject" });
      expect(onclick).toContain('uid&#39;inject');
    });
  });

  describe('backward compatibility', () => {
    test('name-only lookup still works (no UID hint)', () => {
      const result = resolveUser('小華', undefined, mockUsers);
      expect(result).not.toBeNull();
      expect(result.uid).toBe('U_charlie_003');
    });

    test('_userTag without options still generates valid onclick', () => {
      const onclick = generateOnclick('小明', undefined);
      expect(onclick).toBe("App.showUserProfile('小明')");
    });
  });
});
