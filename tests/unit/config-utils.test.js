/**
 * Config utility unit tests — Phase 2
 * Extracted from js/config.js
 *
 * The project uses Object.assign(App, {...}) (not ES modules), so each
 * function body is copied here as a standalone testable function.
 * A comment above each function notes the source file and line range.
 */

// =========================================================================
// Constants needed by functions (copied from js/config.js)
// =========================================================================

// --- Sport config (lines 526-568) ---
const EVENT_SPORT_OPTIONS = [
  { key: 'football', label: '\u8db3\u7403' },
  { key: 'basketball', label: '\u7c43\u7403' },
  { key: 'dodgeball', label: '\u7f8e\u5f0f\u8eb2\u907f\u7403' },
  { key: 'restaurant', label: '\u9910\u5ef3(\u89c0\u8cfd)' },
  { key: 'baseball_softball', label: '\u68d2\u58d8\u7403' },
  { key: 'volleyball', label: '\u6392\u7403' },
  { key: 'table_tennis', label: '\u684c\u7403' },
  { key: 'tennis', label: '\u7db2\u7403' },
  { key: 'badminton', label: '\u7fbd\u7403' },
  { key: 'hiking', label: '\u767b\u5c71' },
  { key: 'running', label: '\u6162\u8dd1' },
  { key: 'cycling', label: '\u55ae\u8eca' },
  { key: 'motorcycle', label: '\u91cd\u6a5f' },
  { key: 'skateboard', label: '\u6ed1\u677f' },
  { key: 'dance', label: '\u821e\u8e48' },
  { key: 'yoga', label: '\u7c84\u4f3d' },
  { key: 'martial_arts', label: '\u6b66\u8853' },
  { key: 'pickleball', label: '\u5339\u514b\u7403' },
];

const SPORT_ICON_EMOJI = {
  football: '\u26bd',
  basketball: '\ud83c\udfc0',
  baseball_softball: '\u26be',
  volleyball: '\ud83c\udfd0',
  table_tennis: '\ud83c\udfd3',
  tennis: '\ud83c\udfbe',
  badminton: '\ud83c\udff8',
  hiking: '\ud83e\udde2',
  running: '\ud83c\udfc3',
  cycling: '\ud83d\udeb4',
  motorcycle: '\ud83c\udfcd\ufe0f',
  skateboard: '\ud83d\udef9',
  dance: '\ud83d\udc83',
  yoga: '\ud83e\uddd8',
  martial_arts: '\ud83e\udd4b',
  restaurant: '\ud83c\udf7d\ufe0f',
  pickleball: '\ud83c\udfd3',
  dodgeball: '\ud83e\udd3e',
};

const EVENT_SPORT_MAP = EVENT_SPORT_OPTIONS.reduce((acc, item) => {
  acc[item.key] = item;
  return acc;
}, Object.create(null));

// --- Role config (lines 356-367) ---
const BUILTIN_ROLE_KEYS = ['user', 'coach', 'captain', 'venue_owner', 'admin', 'super_admin'];

const _BASE_ROLE_LEVEL_MAP = { user:0, coach:1, captain:2, venue_owner:3, admin:4, super_admin:5 };

// --- Permission config (lines 697-744, 669-695, 712-735) ---
const DISABLED_PERMISSION_CODES = new Set(['admin.roles.entry']);

const DRAWER_MENUS = [
  { icon: '', label: '\u500b\u4eba\u6578\u64da', page: 'page-personal-dashboard', minRole: 'user', locked: true },
  { icon: '', label: '\u4e8c\u624b\u5546\u54c1\u5340', page: 'page-shop', minRole: 'user', locked: true },
  { icon: '', label: '\u6392\u884c\u699c', action: 'coming-soon', minRole: 'user', locked: true },
  { icon: '', label: '\u5206\u4eab\u7db2\u9801', action: 'share', minRole: 'user' },
  { divider: true },
  { icon: '', label: '\u6d3b\u52d5\u7ba1\u7406', page: 'page-my-activities', minRole: 'coach', permissionCode: 'activity.manage.entry' },
  { icon: '', label: '\u8cfd\u4e8b\u7ba1\u7406', page: 'page-admin-tournaments', minRole: 'coach', permissionCode: 'admin.tournaments.entry' },
  { divider: true, minRole: 'admin' },
  { sectionLabel: '\u5f8c\u53f0\u7ba1\u7406', minRole: 'admin' },
  { icon: '', label: '\u5c0f\u904a\u6232\u7ba1\u7406', page: 'page-admin-games', minRole: 'admin', permissionCode: 'admin.games.entry' },
  { icon: '', label: '\u7528\u6236\u7ba1\u7406', page: 'page-admin-users', minRole: 'admin', permissionCode: 'admin.users.entry' },
  { icon: '', label: '\u5ee3\u544a\u7ba1\u7406', page: 'page-admin-banners', minRole: 'admin', permissionCode: 'admin.banners.entry' },
  { icon: '', label: '\u4e8c\u624b\u5546\u54c1\u7ba1\u7406', page: 'page-admin-shop', minRole: 'admin', permissionCode: 'admin.shop.entry' },
  { icon: '', label: '\u7ad9\u5167\u4fe1\u7ba1\u7406', page: 'page-admin-messages', minRole: 'admin', permissionCode: 'admin.messages.entry' },
  { icon: '', label: '\u7403\u968a\u7ba1\u7406', page: 'page-admin-teams', minRole: 'admin', permissionCode: 'admin.teams.entry' },
  { icon: '', label: '\u6578\u64da\u5100\u8868\u677f', page: 'page-admin-dashboard', minRole: 'super_admin', permissionCode: 'admin.dashboard.entry' },
  { icon: '', label: '\u4f48\u666f\u4e3b\u984c', page: 'page-admin-themes', minRole: 'super_admin', permissionCode: 'admin.themes.entry' },
  { icon: '', label: '\u624b\u52d5 EXP \u7ba1\u7406', page: 'page-admin-exp', minRole: 'super_admin', permissionCode: 'admin.exp.entry' },
  { icon: '', label: '\u81ea\u52d5 EXP \u7ba1\u7406', page: 'page-admin-auto-exp', minRole: 'super_admin', permissionCode: 'admin.auto_exp.entry' },
  { icon: '', label: '\u63a8\u64ad\u901a\u77e5\u8a2d\u5b9a', page: 'page-admin-notif', minRole: 'super_admin', permissionCode: 'admin.notif.entry' },
  { icon: '', label: '\u7cfb\u7d71\u516c\u544a\u7ba1\u7406', page: 'page-admin-announcements', minRole: 'super_admin', permissionCode: 'admin.announcements.entry' },
  { icon: '', label: '\u6210\u5c31/\u5fbd\u7ae0\u7ba1\u7406', page: 'page-admin-achievements', minRole: 'super_admin', permissionCode: 'admin.achievements.entry' },
  { icon: '', label: '\u6b0a\u9650\u7ba1\u7406', page: 'page-admin-roles', minRole: 'super_admin' },
  { icon: '', label: '\u65e5\u8a8c\u4e2d\u5fc3', page: 'page-admin-logs', minRole: 'super_admin', permissionCode: 'admin.logs.entry' },
  { icon: '', label: '\u7528\u6236\u88dc\u6b63\u7ba1\u7406', page: 'page-admin-repair', minRole: 'admin', permissionCode: 'admin.repair.entry', highlight: 'red' },
  { icon: '', label: '\u7121\u6548\u8cc7\u6599\u67e5\u8a62', page: 'page-admin-inactive', minRole: 'super_admin', permissionCode: 'admin.inactive.entry' },
];

const ADMIN_PAGE_EXTRA_PERMISSION_ITEMS = {
  'page-admin-users': [
    { code: 'admin.users.edit_profile', name: 'Edit Profile' },
    { code: 'admin.users.change_role', name: 'Change Role' },
    { code: 'admin.users.restrict', name: 'Restrict' },
  ],
  'page-my-activities': [
    { code: 'event.edit_all', name: 'Edit All Events' },
  ],
  'page-admin-teams': [
    { code: 'team.create', name: 'Create Team' },
    { code: 'team.manage_all', name: 'Manage All Teams' },
  ],
  'page-admin-repair': [
    { code: 'admin.repair.team_join_repair', name: 'Team Join Repair' },
    { code: 'admin.repair.no_show_adjust', name: 'No Show Adjust' },
    { code: 'admin.repair.data_sync', name: 'Data Sync' },
  ],
  'page-admin-logs': [
    { code: 'admin.logs.error_read', name: 'Error Log Read' },
    { code: 'admin.logs.error_delete', name: 'Error Log Delete' },
    { code: 'admin.logs.audit_read', name: 'Audit Log Read' },
  ],
  'page-admin-notif': [
    { code: 'admin.notif.toggle', name: 'Toggle Notifications' },
  ],
};

const INHERENT_ROLE_PERMISSIONS = Object.freeze({
  coach:       ['activity.manage.entry', 'admin.tournaments.entry'],
  captain:     ['activity.manage.entry', 'admin.tournaments.entry', 'team.manage.entry'],
  venue_owner: ['activity.manage.entry', 'admin.tournaments.entry', 'team.manage.entry'],
});

// =========================================================================
// Extracted functions
// =========================================================================

// ---------------------------------------------------------------------------
// Extracted from js/config.js:444-452 — escapeHTML
// Escapes &, <, >, ", ' for XSS prevention
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
// Extracted from js/config.js:454-456 — generateId
// Creates unique IDs with optional prefix
// ---------------------------------------------------------------------------
function generateId(prefix) {
  return (prefix || '') + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

// ---------------------------------------------------------------------------
// Extracted from js/config.js:411-414 — getSportKeySafe
// Validates sport key exists in EVENT_SPORT_MAP
// ---------------------------------------------------------------------------
function getSportKeySafe(key) {
  const raw = String(key || '').trim();
  return EVENT_SPORT_MAP[raw] ? raw : '';
}

// ---------------------------------------------------------------------------
// Extracted from js/config.js:416-419 — getSportLabelByKey
// Gets label for sport key, defaults to football
// ---------------------------------------------------------------------------
function getSportLabelByKey(key) {
  const safeKey = getSportKeySafe(key) || 'football';
  return EVENT_SPORT_MAP[safeKey]?.label || '\u8db3\u7403';
}

// ---------------------------------------------------------------------------
// Extracted from js/config.js:421-426 — getSportIconSvg
// Gets emoji HTML span for sport key
// ---------------------------------------------------------------------------
function getSportIconSvg(key, className = '') {
  const safeKey = getSportKeySafe(key) || 'football';
  const emoji = SPORT_ICON_EMOJI[safeKey] || SPORT_ICON_EMOJI.football;
  const klass = className ? ` ${className}` : '';
  return `<span class="sport-emoji${klass}" aria-hidden="true">${emoji}</span>`;
}

// ---------------------------------------------------------------------------
// Extracted from js/config.js:559-563 — isPermissionCodeEnabled
// Checks if permission code is active (not in disabled set)
// ---------------------------------------------------------------------------
function isPermissionCodeEnabled(code) {
  return typeof code === 'string'
    && !!code
    && !DISABLED_PERMISSION_CODES.has(code);
}

// ---------------------------------------------------------------------------
// Extracted from js/config.js:565-569 — sanitizePermissionCodeList
// Removes duplicates & disabled codes from a list
// ---------------------------------------------------------------------------
function sanitizePermissionCodeList(codes) {
  return Array.from(new Set(
    (Array.isArray(codes) ? codes : []).filter(code => isPermissionCodeEnabled(code))
  ));
}

// ---------------------------------------------------------------------------
// Extracted from js/config.js:631-633 — getInherentRolePermissions
// Gets non-removable permissions for a role
// ---------------------------------------------------------------------------
function getInherentRolePermissions(roleKey) {
  return INHERENT_ROLE_PERMISSIONS[roleKey] || [];
}

// ---------------------------------------------------------------------------
// Extracted from js/config.js:635-648 — getAdminDrawerPermissionDefinitions
// Internal helper: builds permission definitions from drawer menus
// ---------------------------------------------------------------------------
function getAdminDrawerPermissionDefinitions() {
  return DRAWER_MENUS
    .filter(item => item && item.page && isPermissionCodeEnabled(item.permissionCode))
    .map(item => ({
      page: item.page,
      label: item.label,
      minRole: item.minRole || 'user',
      entryCode: item.permissionCode,
      items: [
        { code: item.permissionCode, name: '\u986f\u793a\u5165\u53e3' },
        ...(ADMIN_PAGE_EXTRA_PERMISSION_ITEMS[item.page] || []),
      ],
    }));
}

// ---------------------------------------------------------------------------
// Extracted from js/config.js:650-652 — getAdminDrawerPermissionCodes
// Extracts all admin permission entry codes from drawer menus
// ---------------------------------------------------------------------------
function getAdminDrawerPermissionCodes() {
  return getAdminDrawerPermissionDefinitions().map(item => item.entryCode);
}

// ---------------------------------------------------------------------------
// Extracted from js/config.js:654-657 — getAdminPagePermissionCode
// Maps page ID to its permission code
// ---------------------------------------------------------------------------
function getAdminPagePermissionCode(pageId) {
  const def = getAdminDrawerPermissionDefinitions().find(item => item.page === pageId);
  return def ? def.entryCode : '';
}

// ---------------------------------------------------------------------------
// Extracted from js/config.js:659-694 — getMergedPermissionCatalog
// Merges built-in + remote permission categories
// ---------------------------------------------------------------------------
function getMergedPermissionCatalog(remoteCategories = []) {
  const result = [];
  const assignedCodes = new Set();
  const builtInCategories = getAdminDrawerPermissionDefinitions().map(def => ({
    cat: def.label,
    items: def.items.map(item => ({ ...item })),
  }));

  builtInCategories.forEach(category => {
    category.items.forEach(item => assignedCodes.add(item.code));
    result.push(category);
  });

  (remoteCategories || []).forEach(category => {
    const items = Array.isArray(category?.items)
      ? category.items.filter(item =>
        item
        && isPermissionCodeEnabled(item.code)
        && !assignedCodes.has(item.code)
      )
      : [];
    if (!items.length) return;
    items.forEach(item => assignedCodes.add(item.code));
    const existingCategory = result.find(entry => entry.cat === category.cat);
    if (existingCategory) {
      existingCategory.items.push(...items.map(item => ({ ...item })));
      return;
    }
    result.push({
      ...category,
      items: items.map(item => ({ ...item })),
    });
  });

  return result;
}

// ---------------------------------------------------------------------------
// Extracted from js/config.js:696-701 — getAllPermissionCodes
// Flattens all permission codes from merged catalog
// ---------------------------------------------------------------------------
function getAllPermissionCodes(remoteCategories = []) {
  return getMergedPermissionCatalog(remoteCategories)
    .flatMap(category => Array.isArray(category?.items) ? category.items : [])
    .map(item => item.code)
    .filter(code => isPermissionCodeEnabled(code));
}

// ---------------------------------------------------------------------------
// Extracted from js/config.js:703-724 — getDefaultRolePermissions
// Default permissions by role. Uses _BASE_ROLE_LEVEL_MAP directly since
// runtime custom role system is not available in test context.
// ---------------------------------------------------------------------------
function getRuntimeRoleLevel(roleKey) {
  if (!roleKey) return 0;
  return _BASE_ROLE_LEVEL_MAP[roleKey] ?? 0;
}

function getDefaultRolePermissions(roleKey) {
  if (!BUILTIN_ROLE_KEYS.includes(roleKey)) return null;
  if (roleKey === 'user') return [];

  const roleLevel = getRuntimeRoleLevel(roleKey);
  const defaults = [];
  getAdminDrawerPermissionDefinitions().forEach(def => {
    if (roleLevel >= getRuntimeRoleLevel(def.minRole)) {
      defaults.push(def.entryCode);
    }
  });

  if (roleLevel >= getRuntimeRoleLevel('admin')) {
    defaults.push('team.create', 'team.manage_all', 'event.edit_all');
  }

  if (roleLevel >= getRuntimeRoleLevel('super_admin')) {
    defaults.push('admin.notif.toggle');
  }

  return Array.from(new Set(defaults));
}

// ---------------------------------------------------------------------------
// Extracted from js/config.js:235-244 — _normalizeRuntimeCustomRoles
// Normalizes custom role definitions
// ---------------------------------------------------------------------------
function _normalizeRuntimeCustomRoles(customRoles) {
  return (customRoles || [])
    .filter(role => role && typeof role.key === 'string' && role.key.trim())
    .map(role => ({
      key: role.key,
      label: role.label || role.key,
      color: role.color || '#6366f1',
      afterRole: role.afterRole || 'captain',
    }));
}


// =========================================================================
// Tests
// =========================================================================

// --- Group 1: HTML/String Utilities ---

describe('escapeHTML', () => {
  test('returns empty string for null', () => {
    expect(escapeHTML(null)).toBe('');
  });

  test('returns empty string for undefined', () => {
    expect(escapeHTML(undefined)).toBe('');
  });

  test('returns empty string for empty string', () => {
    expect(escapeHTML('')).toBe('');
  });

  test('passes through normal strings unchanged', () => {
    expect(escapeHTML('hello world')).toBe('hello world');
  });

  test('escapes ampersand', () => {
    expect(escapeHTML('a&b')).toBe('a&amp;b');
  });

  test('escapes less-than', () => {
    expect(escapeHTML('a<b')).toBe('a&lt;b');
  });

  test('escapes greater-than', () => {
    expect(escapeHTML('a>b')).toBe('a&gt;b');
  });

  test('escapes double quote', () => {
    expect(escapeHTML('a"b')).toBe('a&quot;b');
  });

  test('escapes single quote', () => {
    expect(escapeHTML("a'b")).toBe('a&#39;b');
  });

  test('escapes all HTML special chars together', () => {
    expect(escapeHTML('<script>alert("xss")</script>'))
      .toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  test('handles already-escaped content (double escaping)', () => {
    expect(escapeHTML('&amp;')).toBe('&amp;amp;');
    expect(escapeHTML('&lt;')).toBe('&amp;lt;');
  });

  test('converts number to string and returns it', () => {
    expect(escapeHTML(123)).toBe('123');
    expect(escapeHTML(0)).toBe('0');
  });

  test('converts boolean to string', () => {
    expect(escapeHTML(true)).toBe('true');
    expect(escapeHTML(false)).toBe('false');
  });

  test('handles mixed content with HTML tags and entities', () => {
    expect(escapeHTML('Hello <b>World</b> & "Friends"'))
      .toBe('Hello &lt;b&gt;World&lt;/b&gt; &amp; &quot;Friends&quot;');
  });

  test('handles string with only special characters', () => {
    expect(escapeHTML('<>&"\'')).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});

describe('generateId', () => {
  test('generates ID with prefix', () => {
    const id = generateId('evt_');
    expect(id).toMatch(/^evt_\d+_[a-z0-9]+$/);
  });

  test('generates ID without prefix', () => {
    const id = generateId();
    expect(id).toMatch(/^\d+_[a-z0-9]+$/);
  });

  test('generates ID with empty string prefix', () => {
    const id = generateId('');
    expect(id).toMatch(/^\d+_[a-z0-9]+$/);
  });

  test('generates ID with null prefix (treated as empty)', () => {
    const id = generateId(null);
    expect(id).toMatch(/^\d+_[a-z0-9]+$/);
  });

  test('generates unique values on successive calls', () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      ids.add(generateId('test_'));
    }
    expect(ids.size).toBeGreaterThanOrEqual(95);
  });

  test('includes timestamp component', () => {
    const before = Date.now();
    const id = generateId('');
    const after = Date.now();
    const timestamp = parseInt(id.split('_')[0], 10);
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });
});

// --- Group 2: Sport Config Lookup ---

describe('Sport Config Lookup', () => {
  describe('getSportKeySafe', () => {
    test('returns valid key for known sport', () => {
      expect(getSportKeySafe('football')).toBe('football');
      expect(getSportKeySafe('basketball')).toBe('basketball');
      expect(getSportKeySafe('badminton')).toBe('badminton');
    });

    test('returns empty string for invalid key', () => {
      expect(getSportKeySafe('invalid')).toBe('');
      expect(getSportKeySafe('cricket')).toBe('');
    });

    test('returns empty string for null/undefined', () => {
      expect(getSportKeySafe(null)).toBe('');
      expect(getSportKeySafe(undefined)).toBe('');
    });

    test('returns empty string for empty string', () => {
      expect(getSportKeySafe('')).toBe('');
    });

    test('trims whitespace', () => {
      expect(getSportKeySafe('  football  ')).toBe('football');
    });

    test('handles numeric input', () => {
      expect(getSportKeySafe(123)).toBe('');
    });
  });

  describe('getSportLabelByKey', () => {
    test('returns correct label for valid key', () => {
      expect(getSportLabelByKey('football')).toBe('\u8db3\u7403');
      expect(getSportLabelByKey('basketball')).toBe('\u7c43\u7403');
      expect(getSportLabelByKey('pickleball')).toBe('\u5339\u514b\u7403');
    });

    test('returns football label as default for invalid key', () => {
      expect(getSportLabelByKey('invalid')).toBe('\u8db3\u7403');
      expect(getSportLabelByKey('')).toBe('\u8db3\u7403');
    });

    test('returns football label for null/undefined', () => {
      expect(getSportLabelByKey(null)).toBe('\u8db3\u7403');
      expect(getSportLabelByKey(undefined)).toBe('\u8db3\u7403');
    });
  });

  describe('getSportIconSvg', () => {
    test('returns emoji span for valid key', () => {
      const result = getSportIconSvg('football');
      expect(result).toBe('<span class="sport-emoji" aria-hidden="true">\u26bd</span>');
    });

    test('includes className when provided', () => {
      const result = getSportIconSvg('basketball', 'large');
      expect(result).toBe('<span class="sport-emoji large" aria-hidden="true">\ud83c\udfc0</span>');
    });

    test('defaults to football emoji for invalid key', () => {
      const result = getSportIconSvg('invalid');
      expect(result).toContain('\u26bd');
      expect(result).toContain('sport-emoji');
    });

    test('defaults to football emoji for null/undefined', () => {
      const result = getSportIconSvg(null);
      expect(result).toContain('\u26bd');
    });

    test('no extra space in class when className is empty', () => {
      const result = getSportIconSvg('football', '');
      expect(result).toBe('<span class="sport-emoji" aria-hidden="true">\u26bd</span>');
    });

    test('returns correct emoji for each sport', () => {
      expect(getSportIconSvg('tennis')).toContain('\ud83c\udfbe');
      expect(getSportIconSvg('yoga')).toContain('\ud83e\uddd8');
    });
  });
});

// --- Group 3: Permission System ---

describe('Permission System', () => {
  describe('isPermissionCodeEnabled', () => {
    test('returns true for valid enabled code', () => {
      expect(isPermissionCodeEnabled('admin.users.entry')).toBe(true);
      expect(isPermissionCodeEnabled('activity.manage.entry')).toBe(true);
    });

    test('returns false for disabled code', () => {
      expect(isPermissionCodeEnabled('admin.roles.entry')).toBe(false);
    });

    test('returns false for empty string', () => {
      expect(isPermissionCodeEnabled('')).toBe(false);
    });

    test('returns false for non-string types', () => {
      expect(isPermissionCodeEnabled(null)).toBe(false);
      expect(isPermissionCodeEnabled(undefined)).toBe(false);
      expect(isPermissionCodeEnabled(123)).toBe(false);
      expect(isPermissionCodeEnabled(true)).toBe(false);
      expect(isPermissionCodeEnabled({})).toBe(false);
    });
  });

  describe('sanitizePermissionCodeList', () => {
    test('removes duplicates', () => {
      const result = sanitizePermissionCodeList([
        'admin.users.entry',
        'admin.users.entry',
        'admin.shop.entry',
      ]);
      expect(result).toEqual(['admin.users.entry', 'admin.shop.entry']);
    });

    test('removes disabled codes', () => {
      const result = sanitizePermissionCodeList([
        'admin.users.entry',
        'admin.roles.entry',
        'admin.shop.entry',
      ]);
      expect(result).toEqual(['admin.users.entry', 'admin.shop.entry']);
      expect(result).not.toContain('admin.roles.entry');
    });

    test('returns empty array for non-array input', () => {
      expect(sanitizePermissionCodeList(null)).toEqual([]);
      expect(sanitizePermissionCodeList(undefined)).toEqual([]);
      expect(sanitizePermissionCodeList('string')).toEqual([]);
      expect(sanitizePermissionCodeList(123)).toEqual([]);
    });

    test('returns empty array for empty array', () => {
      expect(sanitizePermissionCodeList([])).toEqual([]);
    });

    test('filters out non-string items', () => {
      const result = sanitizePermissionCodeList([
        'admin.users.entry',
        null,
        123,
        '',
        'admin.shop.entry',
      ]);
      expect(result).toEqual(['admin.users.entry', 'admin.shop.entry']);
    });
  });

  describe('getInherentRolePermissions', () => {
    test('returns permissions for coach', () => {
      const perms = getInherentRolePermissions('coach');
      expect(perms).toEqual(['activity.manage.entry', 'admin.tournaments.entry']);
    });

    test('returns permissions for captain', () => {
      const perms = getInherentRolePermissions('captain');
      expect(perms).toEqual(['activity.manage.entry', 'admin.tournaments.entry', 'team.manage.entry']);
    });

    test('returns permissions for venue_owner', () => {
      const perms = getInherentRolePermissions('venue_owner');
      expect(perms).toEqual(['activity.manage.entry', 'admin.tournaments.entry', 'team.manage.entry']);
    });

    test('returns empty array for user role', () => {
      expect(getInherentRolePermissions('user')).toEqual([]);
    });

    test('returns empty array for admin role', () => {
      expect(getInherentRolePermissions('admin')).toEqual([]);
    });

    test('returns empty array for super_admin role', () => {
      expect(getInherentRolePermissions('super_admin')).toEqual([]);
    });

    test('returns empty array for unknown role', () => {
      expect(getInherentRolePermissions('unknown')).toEqual([]);
      expect(getInherentRolePermissions('')).toEqual([]);
      expect(getInherentRolePermissions(null)).toEqual([]);
    });
  });

  describe('getAdminDrawerPermissionCodes', () => {
    test('returns array of permission codes', () => {
      const codes = getAdminDrawerPermissionCodes();
      expect(Array.isArray(codes)).toBe(true);
      expect(codes.length).toBeGreaterThan(0);
    });

    test('includes known permission codes', () => {
      const codes = getAdminDrawerPermissionCodes();
      expect(codes).toContain('activity.manage.entry');
      expect(codes).toContain('admin.users.entry');
      expect(codes).toContain('admin.dashboard.entry');
      expect(codes).toContain('admin.notif.entry');
    });

    test('does not include disabled permission codes', () => {
      const codes = getAdminDrawerPermissionCodes();
      expect(codes).not.toContain('admin.roles.entry');
    });

    test('all returned codes are non-empty strings', () => {
      const codes = getAdminDrawerPermissionCodes();
      codes.forEach(code => {
        expect(typeof code).toBe('string');
        expect(code.length).toBeGreaterThan(0);
      });
    });
  });

  describe('getAdminPagePermissionCode', () => {
    test('returns permission code for known admin page', () => {
      expect(getAdminPagePermissionCode('page-admin-users')).toBe('admin.users.entry');
      expect(getAdminPagePermissionCode('page-admin-dashboard')).toBe('admin.dashboard.entry');
      expect(getAdminPagePermissionCode('page-my-activities')).toBe('activity.manage.entry');
      expect(getAdminPagePermissionCode('page-admin-notif')).toBe('admin.notif.entry');
    });

    test('returns empty string for page without permission', () => {
      expect(getAdminPagePermissionCode('page-home')).toBe('');
      expect(getAdminPagePermissionCode('page-shop')).toBe('');
    });

    test('returns empty string for unknown page', () => {
      expect(getAdminPagePermissionCode('page-nonexistent')).toBe('');
      expect(getAdminPagePermissionCode('')).toBe('');
    });

    test('returns empty string for disabled permission page (roles)', () => {
      expect(getAdminPagePermissionCode('page-admin-roles')).toBe('');
    });
  });

  describe('getMergedPermissionCatalog', () => {
    test('returns built-in categories when no remote', () => {
      const catalog = getMergedPermissionCatalog();
      expect(Array.isArray(catalog)).toBe(true);
      expect(catalog.length).toBeGreaterThan(0);
      catalog.forEach(cat => {
        expect(cat).toHaveProperty('cat');
        expect(cat).toHaveProperty('items');
        expect(Array.isArray(cat.items)).toBe(true);
      });
    });

    test('includes extra permission items for pages that have them', () => {
      const catalog = getMergedPermissionCatalog();
      const userCat = catalog.find(c => c.items.some(i => i.code === 'admin.users.entry'));
      expect(userCat).toBeDefined();
      const codes = userCat.items.map(i => i.code);
      expect(codes).toContain('admin.users.entry');
      expect(codes).toContain('admin.users.edit_profile');
      expect(codes).toContain('admin.users.change_role');
    });

    test('includes notification toggle sub-permission under notification page', () => {
      const catalog = getMergedPermissionCatalog();
      const notifCat = catalog.find(c => c.items.some(i => i.code === 'admin.notif.entry'));
      expect(notifCat).toBeDefined();
      const codes = notifCat.items.map(i => i.code);
      expect(codes).toContain('admin.notif.entry');
      expect(codes).toContain('admin.notif.toggle');
    });

    test('merges remote categories without duplicating built-in codes', () => {
      const remote = [
        {
          cat: 'Custom',
          items: [
            { code: 'custom.feature1', name: 'Feature 1' },
            { code: 'admin.users.entry', name: 'Duplicate' },
          ],
        },
      ];
      const catalog = getMergedPermissionCatalog(remote);
      const customCat = catalog.find(c => c.cat === 'Custom');
      expect(customCat).toBeDefined();
      expect(customCat.items).toHaveLength(1);
      expect(customCat.items[0].code).toBe('custom.feature1');
    });

    test('merges into existing category if cat name matches', () => {
      const builtInCatalog = getMergedPermissionCatalog();
      const firstCatName = builtInCatalog[0].cat;
      const remote = [
        {
          cat: firstCatName,
          items: [{ code: 'custom.merged', name: 'Merged Item' }],
        },
      ];
      const catalog = getMergedPermissionCatalog(remote);
      const matchingCat = catalog.find(c => c.cat === firstCatName);
      expect(matchingCat.items.some(i => i.code === 'custom.merged')).toBe(true);
    });

    test('filters out disabled codes from remote', () => {
      const remote = [
        {
          cat: 'Remote',
          items: [
            { code: 'admin.roles.entry', name: 'Disabled' },
          ],
        },
      ];
      const catalog = getMergedPermissionCatalog(remote);
      const remoteCat = catalog.find(c => c.cat === 'Remote');
      expect(remoteCat).toBeUndefined();
    });

    test('handles null remoteCategories', () => {
      const catalog = getMergedPermissionCatalog(null);
      expect(Array.isArray(catalog)).toBe(true);
      expect(catalog.length).toBeGreaterThan(0);
    });

    test('handles empty remote categories', () => {
      const catalog = getMergedPermissionCatalog([]);
      expect(Array.isArray(catalog)).toBe(true);
      expect(catalog.length).toBeGreaterThan(0);
    });
  });

  describe('getAllPermissionCodes', () => {
    test('returns flat array of all permission codes', () => {
      const codes = getAllPermissionCodes();
      expect(Array.isArray(codes)).toBe(true);
      expect(codes.length).toBeGreaterThan(0);
      codes.forEach(code => {
        expect(typeof code).toBe('string');
        expect(code.length).toBeGreaterThan(0);
      });
    });

    test('includes both entry and extra permission codes', () => {
      const codes = getAllPermissionCodes();
      expect(codes).toContain('admin.users.entry');
      expect(codes).toContain('admin.users.edit_profile');
      expect(codes).toContain('team.create');
      expect(codes).toContain('admin.notif.entry');
      expect(codes).toContain('admin.notif.toggle');
    });

    test('does not include disabled codes', () => {
      const codes = getAllPermissionCodes();
      expect(codes).not.toContain('admin.roles.entry');
    });

    test('includes remote codes when provided', () => {
      const remote = [
        { cat: 'Extra', items: [{ code: 'extra.custom', name: 'Custom' }] },
      ];
      const codes = getAllPermissionCodes(remote);
      expect(codes).toContain('extra.custom');
    });
  });

  describe('getDefaultRolePermissions', () => {
    test('returns null for non-builtin role', () => {
      expect(getDefaultRolePermissions('custom_role')).toBeNull();
      expect(getDefaultRolePermissions('invalid')).toBeNull();
    });

    test('returns empty array for user role', () => {
      expect(getDefaultRolePermissions('user')).toEqual([]);
    });

    test('returns permissions for coach (level 1)', () => {
      const perms = getDefaultRolePermissions('coach');
      expect(Array.isArray(perms)).toBe(true);
      expect(perms).toContain('activity.manage.entry');
      expect(perms).toContain('admin.tournaments.entry');
    });

    test('returns more permissions for admin than coach', () => {
      const coachPerms = getDefaultRolePermissions('coach');
      const adminPerms = getDefaultRolePermissions('admin');
      expect(adminPerms.length).toBeGreaterThan(coachPerms.length);
    });

    test('admin gets team.create and team.manage_all', () => {
      const perms = getDefaultRolePermissions('admin');
      expect(perms).toContain('team.create');
      expect(perms).toContain('team.manage_all');
      expect(perms).toContain('event.edit_all');
    });

    test('super_admin gets all drawer permission codes', () => {
      const perms = getDefaultRolePermissions('super_admin');
      expect(Array.isArray(perms)).toBe(true);
      const allDrawerCodes = getAdminDrawerPermissionCodes();
      allDrawerCodes.forEach(code => {
        expect(perms).toContain(code);
      });
    });

    test('super_admin gets admin.notif.toggle by default', () => {
      const perms = getDefaultRolePermissions('super_admin');
      expect(perms).toContain('admin.notif.toggle');
    });

    test('returns no duplicates', () => {
      const perms = getDefaultRolePermissions('super_admin');
      const unique = [...new Set(perms)];
      expect(perms.length).toBe(unique.length);
    });

    test('coach does not get admin-level permissions', () => {
      const perms = getDefaultRolePermissions('coach');
      expect(perms).not.toContain('team.create');
      expect(perms).not.toContain('team.manage_all');
      expect(perms).not.toContain('admin.users.entry');
    });

    test('admin does not get notification settings permissions by default', () => {
      const perms = getDefaultRolePermissions('admin');
      expect(perms).not.toContain('admin.notif.entry');
      expect(perms).not.toContain('admin.notif.toggle');
    });
  });
});

// --- Group 4: Custom Role Normalization ---

describe('_normalizeRuntimeCustomRoles', () => {
  test('normalizes valid custom roles', () => {
    const input = [
      { key: 'trainer', label: 'Trainer', color: '#ff0000', afterRole: 'coach' },
    ];
    const result = _normalizeRuntimeCustomRoles(input);
    expect(result).toEqual([
      { key: 'trainer', label: 'Trainer', color: '#ff0000', afterRole: 'coach' },
    ]);
  });

  test('applies defaults for missing optional fields', () => {
    const input = [{ key: 'helper' }];
    const result = _normalizeRuntimeCustomRoles(input);
    expect(result).toEqual([
      { key: 'helper', label: 'helper', color: '#6366f1', afterRole: 'captain' },
    ]);
  });

  test('returns empty array for null/undefined input', () => {
    expect(_normalizeRuntimeCustomRoles(null)).toEqual([]);
    expect(_normalizeRuntimeCustomRoles(undefined)).toEqual([]);
  });

  test('returns empty array for empty array', () => {
    expect(_normalizeRuntimeCustomRoles([])).toEqual([]);
  });

  test('filters out entries without key', () => {
    const input = [
      { key: 'valid' },
      { label: 'no-key' },
      null,
      undefined,
      { key: '' },
      { key: '  ' },
    ];
    const result = _normalizeRuntimeCustomRoles(input);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('valid');
  });

  test('filters out entries where key is not a string', () => {
    const input = [
      { key: 123 },
      { key: true },
      { key: {} },
      { key: 'valid_key' },
    ];
    const result = _normalizeRuntimeCustomRoles(input);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('valid_key');
  });

  test('handles multiple valid roles', () => {
    const input = [
      { key: 'role_a', label: 'Role A', color: '#aaa', afterRole: 'user' },
      { key: 'role_b', label: 'Role B' },
    ];
    const result = _normalizeRuntimeCustomRoles(input);
    expect(result).toHaveLength(2);
    expect(result[0].afterRole).toBe('user');
    expect(result[1].afterRole).toBe('captain');
    expect(result[1].color).toBe('#6366f1');
  });

  test('preserves key as label when label is empty string', () => {
    const input = [{ key: 'myRole', label: '' }];
    const result = _normalizeRuntimeCustomRoles(input);
    expect(result[0].label).toBe('myRole');
  });
});

// --- Group 5: Cross-system sync checks ---

describe('INHERENT_ROLE_PERMISSIONS cross-system sync (CLAUDE.md mandatory)', () => {
  const fs = require('fs');
  const path = require('path');
  const PROJECT_ROOT = path.resolve(__dirname, '../..');

  /**
   * Extract the INHERENT_ROLE_PERMISSIONS object literal from a source file.
   * Returns a normalized JSON string for comparison.
   */
  function extractInherentRolePermissions(filePath) {
    const fullPath = path.join(PROJECT_ROOT, filePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Source file not found: ${fullPath}`);
    }
    const content = fs.readFileSync(fullPath, 'utf-8');

    // Match the Object.freeze({...}) block after INHERENT_ROLE_PERMISSIONS
    const pattern = /INHERENT_ROLE_PERMISSIONS\s*=\s*Object\.freeze\(\s*(\{[\s\S]*?\})\s*\)/;
    const match = content.match(pattern);
    if (!match) {
      throw new Error(`INHERENT_ROLE_PERMISSIONS not found in ${filePath}`);
    }

    // Normalize the object literal:
    // - Replace single quotes with double quotes
    // - Remove trailing commas before }
    // - Normalize whitespace
    let objStr = match[1]
      .replace(/'/g, '"')
      .replace(/,\s*\}/g, '}')
      .replace(/,\s*\]/g, ']')
      .replace(/\s+/g, ' ')
      .trim();

    // Parse and re-stringify for canonical form
    // Use Function constructor to safely evaluate the JS object literal
    // eslint-disable-next-line no-new-func
    const obj = (new Function('return (' + objStr + ')'))();
    return JSON.stringify(obj, Object.keys(obj).sort(), 2);
  }

  test('js/config.js and functions/index.js have identical INHERENT_ROLE_PERMISSIONS', () => {
    const configPerms = extractInherentRolePermissions('js/config.js');
    const functionsPerms = extractInherentRolePermissions('functions/index.js');

    if (configPerms !== functionsPerms) {
      throw new Error(
        'INHERENT_ROLE_PERMISSIONS is out of sync between js/config.js and functions/index.js!\n' +
        'Per CLAUDE.md rules, these must be identical.\n\n' +
        'js/config.js:\n' + configPerms + '\n\n' +
        'functions/index.js:\n' + functionsPerms
      );
    }

    expect(configPerms).toBe(functionsPerms);
  });

  test('test file copy matches js/config.js definition', () => {
    // Compare the INHERENT_ROLE_PERMISSIONS defined at the top of this test file
    // with what is in the actual source
    const configPerms = extractInherentRolePermissions('js/config.js');
    const testCopy = JSON.stringify(INHERENT_ROLE_PERMISSIONS, Object.keys(INHERENT_ROLE_PERMISSIONS).sort(), 2);

    // Parse the config version for comparison (it was stringified with sorted keys)
    const configObj = JSON.parse(configPerms);
    const testObj = JSON.parse(testCopy);

    expect(testObj).toEqual(configObj);
  });
});
