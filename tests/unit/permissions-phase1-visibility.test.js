/**
 * Phase 1: data-min-role Removal — Visibility & Access Tests
 *
 * Verifies that every page currently using data-min-role has a proper
 * permission-based fallback in DRAWER_MENUS, or is intentionally kept
 * as role-only (documented in ROLE_ONLY_PAGES).
 *
 * After Phase 1:
 *  - Pages in DRAWER_MENUS must be accessible via permissionCode only
 *  - Role-only pages (admin-roles, audit-logs, etc.) must stay guarded
 *  - HTML files must not contain stale data-min-role on migrated pages
 */

const fs = require('fs');
const path = require('path');

const {
  BUILTIN_ROLE_KEYS,
  ROLE_LEVEL_MAP,
  DRAWER_PAGE_ENTRIES,
  DATA_MIN_ROLE_PAGES,
  ROLE_ONLY_PAGES,
  DATA_MIN_ROLE_DIVS,
  getDefaultRolePermissions,
  getRolePermissions,
  hasPermission,
  canAccessPage,
} = require('./permissions-fixtures');

// =========================================================================
// 1. Every data-min-role page has a documented fallback strategy
// =========================================================================

describe('Phase 1 prerequisite: all data-min-role pages have fallback', () => {
  DATA_MIN_ROLE_PAGES.forEach(({ page, minRole }) => {
    const drawerEntry = DRAWER_PAGE_ENTRIES.find(e => e.page === page);
    const isRoleOnly = ROLE_ONLY_PAGES.includes(page);

    test(`${page} (${minRole}) — has permissionCode or is documented role-only`, () => {
      if (isRoleOnly) {
        // Documented as intentionally role-guarded — OK to keep data-min-role
        expect(ROLE_ONLY_PAGES).toContain(page);
      } else {
        // Must have a DRAWER_MENUS entry with permissionCode
        expect(drawerEntry).toBeDefined();
        expect(drawerEntry.permissionCode).toBeTruthy();
      }
    });
  });
});

// =========================================================================
// 2. Drawer-based pages: permissionCode gates access correctly
// =========================================================================

describe('Phase 1 core: drawer pages controlled by permissionCode', () => {
  const drawerPagesWithPerm = DRAWER_PAGE_ENTRIES.filter(e => e.permissionCode);

  drawerPagesWithPerm.forEach(({ page, permissionCode }) => {
    describe(`${page} (${permissionCode})`, () => {
      BUILTIN_ROLE_KEYS.forEach(role => {
        test(`${role} — access matches hasPermission result`, () => {
          const defaults = getDefaultRolePermissions(role);
          const canAccess = canAccessPage(page, role, defaults, null);
          const hasPerm = hasPermission(role, defaults, permissionCode);
          expect(canAccess).toBe(hasPerm);
        });
      });
    });
  });
});

// =========================================================================
// 3. Role-only pages: only accessible at or above minRole level
// =========================================================================

describe('Phase 1 core: role-only pages stay role-guarded', () => {
  const roleOnlyEntries = DATA_MIN_ROLE_PAGES.filter(p => ROLE_ONLY_PAGES.includes(p.page));

  roleOnlyEntries.forEach(({ page, minRole }) => {
    describe(`${page} (role-only, min=${minRole})`, () => {
      BUILTIN_ROLE_KEYS.forEach(role => {
        test(`${role} — access=${(ROLE_LEVEL_MAP[role] || 0) >= (ROLE_LEVEL_MAP[minRole] || 0)}`, () => {
          const expected = (ROLE_LEVEL_MAP[role] || 0) >= (ROLE_LEVEL_MAP[minRole] || 0);
          // For role-only pages, canAccessPage falls through to data-min-role
          const result = canAccessPage(page, role, null, minRole);
          expect(result).toBe(expected);
        });
      });
    });
  });
});

// =========================================================================
// 4. User role: cannot access ANY admin page
// =========================================================================

describe('Phase 1 safety: user role has zero admin access', () => {
  DATA_MIN_ROLE_PAGES.forEach(({ page }) => {
    test(`user cannot access ${page}`, () => {
      const userPerms = getDefaultRolePermissions('user');
      const minRole = DATA_MIN_ROLE_PAGES.find(p => p.page === page)?.minRole;
      const result = canAccessPage(page, 'user', userPerms, minRole);
      expect(result).toBe(false);
    });
  });
});

// =========================================================================
// 5. Super admin: can access ALL pages
// =========================================================================

describe('Phase 1 safety: super_admin can access all pages', () => {
  DATA_MIN_ROLE_PAGES.forEach(({ page, minRole }) => {
    test(`super_admin can access ${page}`, () => {
      const saPerms = getDefaultRolePermissions('super_admin');
      const result = canAccessPage(page, 'super_admin', saPerms, minRole);
      expect(result).toBe(true);
    });
  });
});

// =========================================================================
// 6. HTML file scan: after Phase 1, migrated pages have no data-min-role
//    (This test is intended to run AFTER Phase 1 implementation)
// =========================================================================

describe('Phase 1 post-check: HTML files (run after implementation)', () => {
  const pagesDir = path.resolve(__dirname, '../../pages');

  // Pages that should still have data-min-role after Phase 1
  const allowedDataMinRole = new Set(ROLE_ONLY_PAGES);
  // Also allow non-page divs
  DATA_MIN_ROLE_DIVS.forEach(d => allowedDataMinRole.add(d.selector));

  test('pages directory exists', () => {
    expect(fs.existsSync(pagesDir)).toBe(true);
  });

  // Build a set of page IDs that should NOT have data-min-role after Phase 1
  const migratedPages = DATA_MIN_ROLE_PAGES
    .filter(p => !ROLE_ONLY_PAGES.includes(p.page))
    .map(p => p.page);

  test('migrated page IDs are documented', () => {
    expect(migratedPages.length).toBeGreaterThan(0);
  });

  // Phase 1 implemented — verify migrated pages no longer have data-min-role
  test('no data-min-role on migrated page elements', () => {
    const htmlFiles = fs.readdirSync(pagesDir).filter(f => f.endsWith('.html'));
    const violations = [];
    htmlFiles.forEach(file => {
      const content = fs.readFileSync(path.join(pagesDir, file), 'utf8');
      migratedPages.forEach(pageId => {
        const pattern = new RegExp(`id="${pageId}"[^>]*data-min-role`);
        if (pattern.test(content)) {
          violations.push(`${file}: ${pageId} still has data-min-role`);
        }
      });
    });
    expect(violations).toEqual([]);
  });
});

// =========================================================================
// 7. Regression: disabled permission codes are never granted
// =========================================================================

describe('Phase 1 safety: disabled permission codes', () => {
  BUILTIN_ROLE_KEYS.forEach(role => {
    test(`${role} never has admin.roles.entry (disabled)`, () => {
      const perms = getRolePermissions(role, getDefaultRolePermissions(role));
      expect(perms).not.toContain('admin.roles.entry');
    });
  });
});
