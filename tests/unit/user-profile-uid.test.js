/**
 * @jest-environment jsdom
 *
 * Tests for showUserProfile UID-first lookup + _userTag uid option
 */

const fs = require('fs');
const path = require('path');

const profileCoreSource = fs.readFileSync(path.join(__dirname, '../../js/modules/profile/profile-core.js'), 'utf8');

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
  return users.find(u => u.uid === uid || u.lineUserId === uid || u._docId === uid || u.docId === uid) || null;
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/profile/profile-core.js — _findUserByName
// Name-based fallback lookup
// ---------------------------------------------------------------------------
function _findUserByName(name, users) {
  return users.find(u => u.name === name || u.displayName === name) || null;
}

// ---------------------------------------------------------------------------
// Combined lookup logic (mirrors showUserProfile internal logic)
// ---------------------------------------------------------------------------
function resolveUser(name, uidHint, users) {
  return _findUserByUid(uidHint, users) || _findUserByName(name, users);
}

function resolveDisplayName(name, user, uidHint, isSelf = false, currentIdentity = null) {
  return isSelf && currentIdentity?.displayName
    ? currentIdentity.displayName
    : (name || user?.displayName || user?.name || uidHint || '');
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
// Load the actual profile-core implementation for DOM event behavior
let profileApp;

beforeAll(() => {
  global.App = {};
  global.ApiService = {
    getAdminUsers: () => mockUsers,
    getUserRole: () => 'user',
  };
  global.ROLES = { user: { label: '一般用戶' } };
  global.escapeHTML = escapeHTML;
  jest.isolateModules(() => {
    require('../../js/modules/profile/profile-core.js');
  });
  profileApp = global.App;
  profileApp.showUserProfile = jest.fn();
  profileApp._bindProfileCoreEvents();
});

beforeEach(() => {
  document.body.innerHTML = '';
  profileApp.showUserProfile.mockClear();
  delete window.__profilePwned;
});

afterAll(() => {
  delete window.__profilePwned;
  delete global.App;
  delete global.ApiService;
  delete global.ROLES;
  delete global.escapeHTML;
});

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

    test('finds user by Firestore doc id fallback', () => {
      const users = [{ _docId: 'doc_123', uid: '', lineUserId: '', name: 'Doc User' }];
      const result = _findUserByUid('doc_123', users);
      expect(result).not.toBeNull();
      expect(result.name).toBe('Doc User');
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

    test('falls back to displayName when name is not populated', () => {
      const users = [{ uid: 'U_display_001', name: '', displayName: 'Display Only' }];
      const result = resolveUser('Display Only', null, users);
      expect(result).not.toBeNull();
      expect(result.uid).toBe('U_display_001');
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

  describe('displayName fallback for UID-only profile navigation', () => {
    test('uses user displayName when popstate provides only uid', () => {
      const user = resolveUser(null, 'U_charlie_003', mockUsers);
      expect(resolveDisplayName(null, user, 'U_charlie_003')).toBe('小華');
    });

    test('falls back to uid when neither name nor user display fields exist', () => {
      expect(resolveDisplayName(null, null, 'U_missing_999')).toBe('U_missing_999');
    });

    test('current identity displayName still wins for self profile', () => {
      const user = resolveUser('小明', 'U_alice_001', mockUsers);
      expect(resolveDisplayName('小明', user, 'U_alice_001', true, { displayName: '分身名稱' })).toBe('分身名稱');
    });
  });

  describe('_userTag profile navigation event binding', () => {
    test('stores the exact name and UID in data attributes and keeps normal click behavior', () => {
      document.body.innerHTML = profileApp._userTag('小明', 'user', { uid: 'U_alice_001' });
      const capsule = document.querySelector('.user-capsule');

      expect(capsule.getAttribute('onclick')).toBeNull();
      expect(capsule.dataset.profileName).toBe('小明');
      expect(capsule.dataset.profileUid).toBe('U_alice_001');

      capsule.click();
      expect(profileApp.showUserProfile).toHaveBeenCalledWith('小明', { uid: 'U_alice_001' });
    });

    test('does not turn a malicious display name into executable onclick code', () => {
      const maliciousName = "');window.__profilePwned=true;//";
      document.body.innerHTML = profileApp._userTag(maliciousName, 'user');
      const capsule = document.querySelector('.user-capsule');

      expect(capsule.getAttribute('onclick')).toBeNull();
      expect(capsule.dataset.profileName).toBe(maliciousName);
      expect(capsule.textContent).toContain(maliciousName);

      capsule.click();
      expect(window.__profilePwned).toBeUndefined();
      expect(profileApp.showUserProfile).toHaveBeenCalledWith(maliciousName);
    });
  });

  describe('profile card retry and share event binding', () => {
    test('retry keeps the exact malicious display name as data and preserves UID navigation options', () => {
      const maliciousName = "');window.__profilePwned=true;//";
      const uid = `U${'a'.repeat(32)}`;
      document.body.innerHTML = '<div id="user-card-full"></div>';

      profileApp._renderUserProfileUnavailable(maliciousName, uid);
      const retryButton = document.querySelector('.uc-card-retry-btn');

      expect(retryButton.getAttribute('onclick')).toBeNull();
      expect(retryButton.dataset.profileRetryName).toBe(maliciousName);
      expect(retryButton.dataset.profileRetryUid).toBe(uid);

      retryButton.click();
      expect(window.__profilePwned).toBeUndefined();
      expect(profileApp.showUserProfile).toHaveBeenCalledWith(maliciousName, {
        uid,
        bypassPageLock: true,
        skipPageHistory: true,
      });
    });

    test('share markup has no inline display-name handler and delegated click passes the exact name', () => {
      const maliciousName = "');window.__profilePwned=true;//";
      const shareUserCard = jest.fn();
      profileApp._shareUserCard = shareUserCard;
      document.body.innerHTML = `<button type="button" data-profile-share-name="${escapeHTML(maliciousName)}"><svg></svg></button>`;
      const shareButton = document.querySelector('[data-profile-share-name]');

      expect(profileCoreSource).toContain('data-profile-share-name="${escapeHTML(displayName)}"');
      expect(profileCoreSource).not.toContain('onclick="App._shareUserCard(\'${escapeHTML(displayName)}\')"');
      expect(shareButton.getAttribute('onclick')).toBeNull();

      shareButton.querySelector('svg').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(window.__profilePwned).toBeUndefined();
      expect(shareUserCard).toHaveBeenCalledWith(maliciousName);
    });
  });

  describe('backward compatibility', () => {
    test('name-only lookup still works (no UID hint)', () => {
      const result = resolveUser('小華', undefined, mockUsers);
      expect(result).not.toBeNull();
      expect(result.uid).toBe('U_charlie_003');
    });

    test('_userTag without options still opens the profile by name', () => {
      document.body.innerHTML = profileApp._userTag('小明', 'user');
      document.querySelector('.user-capsule').click();
      expect(profileApp.showUserProfile).toHaveBeenCalledWith('小明');
    });
  });
});
