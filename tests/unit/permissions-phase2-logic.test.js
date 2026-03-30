/**
 * Phase 2: hasPermission() Logic — Full Permission Matrix Tests
 *
 * Verifies the complete 6-role x all-permission-code matrix:
 *  - Default permissions per role are correct
 *  - Inherent permissions cannot be removed
 *  - super_admin has all enabled permissions
 *  - user has no permissions
 *  - Permission granting/revoking works correctly
 *  - Disabled codes are never granted
 */

const {
  BUILTIN_ROLE_KEYS,
  ROLE_LEVEL_MAP,
  INHERENT_ROLE_PERMISSIONS,
  DISABLED_PERMISSION_CODES,
  ENTRY_PERMISSION_CODES,
  SUB_PERMISSION_CODES,
  ALL_PERMISSION_CODES,
  DRAWER_PAGE_ENTRIES,
  isPermissionCodeEnabled,
  sanitizePermissionCodeList,
  getInherentRolePermissions,
  getDefaultRolePermissions,
  getRolePermissions,
  hasPermission,
  canAccessDrawerItem,
} = require('./permissions-fixtures');

// =========================================================================
// 1. getDefaultRolePermissions — baseline for each role
// =========================================================================

describe('getDefaultRolePermissions', () => {
  test('user gets empty array', () => {
    expect(getDefaultRolePermissions('user')).toEqual([]);
  });

  test('coach gets activity + tournament entry', () => {
    const perms = getDefaultRolePermissions('coach');
    expect(perms).toContain('activity.manage.entry');
    expect(perms).toContain('admin.tournaments.entry');
  });

  test('admin gets all admin-level entry codes + team/event extras', () => {
    const perms = getDefaultRolePermissions('admin');
    // Must have all drawer entries where minRole <= admin
    DRAWER_PAGE_ENTRIES.forEach(entry => {
      if (entry.permissionCode && (ROLE_LEVEL_MAP[entry.minRole] || 0) <= ROLE_LEVEL_MAP.admin) {
        expect(perms).toContain(entry.permissionCode);
      }
    });
    expect(perms).toContain('team.create');
    expect(perms).toContain('team.manage_all');
    expect(perms).toContain('event.edit_all');
  });

  test('admin does NOT get super_admin-only entries by default', () => {
    const perms = getDefaultRolePermissions('admin');
    DRAWER_PAGE_ENTRIES.forEach(entry => {
      if (entry.permissionCode && entry.minRole === 'super_admin') {
        expect(perms).not.toContain(entry.permissionCode);
      }
    });
  });

  test('super_admin gets all entry codes', () => {
    const perms = getDefaultRolePermissions('super_admin');
    DRAWER_PAGE_ENTRIES.forEach(entry => {
      if (entry.permissionCode) {
        expect(perms).toContain(entry.permissionCode);
      }
    });
  });

  test('returns null for unknown role keys', () => {
    expect(getDefaultRolePermissions('custom_123')).toBeNull();
    expect(getDefaultRolePermissions('unknown')).toBeNull();
  });

  test('each role level has >= previous level permissions', () => {
    for (let i = 1; i < BUILTIN_ROLE_KEYS.length; i++) {
      const prevPerms = getDefaultRolePermissions(BUILTIN_ROLE_KEYS[i - 1]) || [];
      const currPerms = getDefaultRolePermissions(BUILTIN_ROLE_KEYS[i]) || [];
      prevPerms.forEach(code => {
        expect(currPerms).toContain(code);
      });
    }
  });
});

// =========================================================================
// 2. Inherent permissions
// =========================================================================

describe('inherent permissions', () => {
  test('coach/captain/venue_owner have activity + tournament inherent', () => {
    ['coach', 'captain', 'venue_owner'].forEach(role => {
      const inherent = getInherentRolePermissions(role);
      expect(inherent).toContain('activity.manage.entry');
      expect(inherent).toContain('admin.tournaments.entry');
    });
  });

  test('user/admin/super_admin have no inherent permissions', () => {
    ['user', 'admin', 'super_admin'].forEach(role => {
      expect(getInherentRolePermissions(role)).toEqual([]);
    });
  });

  test('inherent permissions survive even with empty stored permissions', () => {
    ['coach', 'captain', 'venue_owner'].forEach(role => {
      const perms = getRolePermissions(role, []);
      expect(perms).toContain('activity.manage.entry');
      expect(perms).toContain('admin.tournaments.entry');
    });
  });
});

// =========================================================================
// 3. getRolePermissions — combined resolution
// =========================================================================

describe('getRolePermissions', () => {
  test('user always returns empty', () => {
    expect(getRolePermissions('user', ['admin.users.entry'])).toEqual([]);
  });

  test('super_admin gets ALL enabled permission codes', () => {
    const perms = getRolePermissions('super_admin', []);
    ALL_PERMISSION_CODES.forEach(code => {
      if (isPermissionCodeEnabled(code)) {
        expect(perms).toContain(code);
      }
    });
  });

  test('super_admin does NOT get disabled codes', () => {
    const perms = getRolePermissions('super_admin', []);
    DISABLED_PERMISSION_CODES.forEach(code => {
      expect(perms).not.toContain(code);
    });
  });

  test('stored permissions are included for normal roles', () => {
    const stored = ['admin.users.entry', 'admin.banners.entry'];
    const perms = getRolePermissions('coach', stored);
    stored.forEach(code => {
      expect(perms).toContain(code);
    });
  });

  test('no duplicates in result', () => {
    const stored = ['activity.manage.entry', 'activity.manage.entry'];
    const perms = getRolePermissions('coach', stored);
    const unique = new Set(perms);
    expect(perms.length).toBe(unique.size);
  });
});

// =========================================================================
// 4. hasPermission — full matrix (6 roles x all codes)
// =========================================================================

describe('hasPermission — full matrix with defaults', () => {
  BUILTIN_ROLE_KEYS.forEach(role => {
    describe(`role: ${role}`, () => {
      const defaults = getDefaultRolePermissions(role);

      ALL_PERMISSION_CODES.forEach(code => {
        if (!isPermissionCodeEnabled(code)) return;

        test(`${code}`, () => {
          const result = hasPermission(role, defaults, code);
          const resolved = getRolePermissions(role, defaults);
          expect(result).toBe(resolved.includes(code));
        });
      });
    });
  });
});

// =========================================================================
// 5. hasPermission — custom permission granting scenarios
// =========================================================================

describe('hasPermission — custom permission granting', () => {
  test('coach with admin.users.entry granted can access user management', () => {
    const customPerms = ['activity.manage.entry', 'admin.tournaments.entry', 'admin.users.entry'];
    expect(hasPermission('coach', customPerms, 'admin.users.entry')).toBe(true);
  });

  test('coach without admin.users.entry cannot access user management', () => {
    const defaultPerms = getDefaultRolePermissions('coach');
    expect(hasPermission('coach', defaultPerms, 'admin.users.entry')).toBe(false);
  });

  test('admin with extra sub-permissions gets them', () => {
    const adminDefaults = getDefaultRolePermissions('admin');
    const withExtra = [...adminDefaults, 'admin.logs.error_read', 'admin.logs.audit_read'];
    expect(hasPermission('admin', withExtra, 'admin.logs.error_read')).toBe(true);
    expect(hasPermission('admin', withExtra, 'admin.logs.audit_read')).toBe(true);
  });

  test('revoking a non-inherent permission works for normal roles', () => {
    // Admin without team.create
    const adminPermsNoTeamCreate = getDefaultRolePermissions('admin').filter(c => c !== 'team.create');
    expect(hasPermission('admin', adminPermsNoTeamCreate, 'team.create')).toBe(false);
  });

  test('revoking an inherent permission has no effect for coach/captain/venue_owner', () => {
    // Coach with empty stored — still has inherent
    expect(hasPermission('coach', [], 'activity.manage.entry')).toBe(true);
    expect(hasPermission('captain', [], 'admin.tournaments.entry')).toBe(true);
    expect(hasPermission('venue_owner', [], 'activity.manage.entry')).toBe(true);
  });
});

// =========================================================================
// 6. canAccessDrawerItem — drawer visibility logic
// =========================================================================

describe('canAccessDrawerItem', () => {
  test('dividers and section labels always accessible', () => {
    expect(canAccessDrawerItem({ divider: true }, 'user', [])).toBe(true);
    expect(canAccessDrawerItem({ sectionLabel: 'test' }, 'user', [])).toBe(true);
    expect(canAccessDrawerItem(null, 'user', [])).toBe(true);
  });

  test('items with permissionCode use permission check (ignore minRole)', () => {
    const item = { page: 'page-admin-users', minRole: 'admin', permissionCode: 'admin.users.entry' };
    // Coach with the permission granted
    expect(canAccessDrawerItem(item, 'coach', ['admin.users.entry'])).toBe(true);
    // Coach without the permission
    expect(canAccessDrawerItem(item, 'coach', [])).toBe(false);
  });

  test('items without permissionCode fall back to minRole level check', () => {
    const item = { page: 'page-admin-roles', minRole: 'super_admin' };
    expect(canAccessDrawerItem(item, 'admin', [])).toBe(false);
    expect(canAccessDrawerItem(item, 'super_admin', [])).toBe(true);
  });

  test('user items (minRole=user, no permissionCode) accessible by all', () => {
    const item = { page: 'page-personal-dashboard', minRole: 'user' };
    BUILTIN_ROLE_KEYS.forEach(role => {
      expect(canAccessDrawerItem(item, role, [])).toBe(true);
    });
  });
});

// =========================================================================
// 7. Disabled permission codes
// =========================================================================

describe('disabled permission codes', () => {
  test('admin.roles.entry is disabled', () => {
    expect(isPermissionCodeEnabled('admin.roles.entry')).toBe(false);
  });

  test('all other entry codes are enabled', () => {
    ENTRY_PERMISSION_CODES.forEach(code => {
      if (code === 'admin.roles.entry') return;
      expect(isPermissionCodeEnabled(code)).toBe(true);
    });
  });

  test('sanitizePermissionCodeList removes disabled codes', () => {
    const input = ['admin.users.entry', 'admin.roles.entry', 'event.create'];
    const result = sanitizePermissionCodeList(input);
    expect(result).toContain('admin.users.entry');
    expect(result).toContain('event.create');
    expect(result).not.toContain('admin.roles.entry');
  });

  test('sanitizePermissionCodeList deduplicates', () => {
    const input = ['event.create', 'event.create', 'event.create'];
    expect(sanitizePermissionCodeList(input)).toEqual(['event.create']);
  });

  test('sanitizePermissionCodeList handles non-array input', () => {
    expect(sanitizePermissionCodeList(null)).toEqual([]);
    expect(sanitizePermissionCodeList(undefined)).toEqual([]);
    expect(sanitizePermissionCodeList('string')).toEqual([]);
  });
});

// =========================================================================
// 8. Edge cases
// =========================================================================

describe('edge cases', () => {
  test('hasPermission with null/undefined code returns false', () => {
    expect(hasPermission('admin', [], null)).toBe(false);
    expect(hasPermission('admin', [], undefined)).toBe(false);
    expect(hasPermission('admin', [], '')).toBe(false);
  });

  test('empty string role treated as user (level 0)', () => {
    const perms = getRolePermissions('', []);
    expect(perms).toEqual([]);
  });

  test('all permission codes are non-empty strings', () => {
    ALL_PERMISSION_CODES.forEach(code => {
      expect(typeof code).toBe('string');
      expect(code.length).toBeGreaterThan(0);
      expect(code).not.toMatch(/\s/);
    });
  });

  test('no permission code appears in both entry and sub lists', () => {
    const overlap = ENTRY_PERMISSION_CODES.filter(c => SUB_PERMISSION_CODES.includes(c));
    expect(overlap).toEqual([]);
  });

  test('BUILTIN_ROLE_KEYS is sorted by level ascending', () => {
    for (let i = 1; i < BUILTIN_ROLE_KEYS.length; i++) {
      const prevLevel = ROLE_LEVEL_MAP[BUILTIN_ROLE_KEYS[i - 1]];
      const currLevel = ROLE_LEVEL_MAP[BUILTIN_ROLE_KEYS[i]];
      expect(currLevel).toBeGreaterThan(prevLevel);
    }
  });
});
