/**
 * Permission System Test Fixtures
 * Shared constants and extracted functions for Phase 1 & Phase 2 permission tests.
 *
 * Data extracted from:
 *   js/config.js  (roles, permissions, drawer menus, inherent, defaults)
 *   js/modules/role.js  (hasPermission, canAccessPage, canAccessDrawerItem)
 */

// =========================================================================
// Constants (from js/config.js)
// =========================================================================

const BUILTIN_ROLE_KEYS = ['user', 'coach', 'captain', 'venue_owner', 'admin', 'super_admin'];

const ROLE_LEVEL_MAP = { user: 0, coach: 1, captain: 2, venue_owner: 3, admin: 4, super_admin: 5 };

const INHERENT_ROLE_PERMISSIONS = Object.freeze({
  coach:       ['activity.manage.entry', 'admin.tournaments.entry'],
  captain:     ['activity.manage.entry', 'admin.tournaments.entry'],
  venue_owner: ['activity.manage.entry', 'admin.tournaments.entry'],
});

const DISABLED_PERMISSION_CODES = new Set(['admin.roles.entry']);

// All entry permission codes from DRAWER_MENUS (js/config.js:514-541)
const ENTRY_PERMISSION_CODES = [
  'activity.manage.entry',
  'admin.tournaments.entry',
  'admin.games.entry',
  'admin.users.entry',
  'admin.banners.entry',
  'admin.shop.entry',
  'admin.messages.entry',
  'admin.teams.entry',
  'admin.dashboard.entry',
  'admin.themes.entry',
  'admin.exp.entry',
  'admin.auto_exp.entry',
  'admin.announcements.entry',
  'admin.achievements.entry',
  'admin.logs.entry',
  'admin.repair.entry',
  'admin.inactive.entry',
];

// All sub-permission codes from ADMIN_PAGE_EXTRA_PERMISSION_ITEMS (js/config.js:558-603)
const SUB_PERMISSION_CODES = [
  'event.create', 'event.edit_self', 'event.edit_all',
  'event.delete_self', 'event.delete', 'event.publish',
  'event.scan', 'event.manual_checkin', 'event.view_registrations',
  'admin.tournaments.create', 'admin.tournaments.manage_all', 'admin.tournaments.review',
  'team.create', 'team.manage_all', 'team.manage_self',
  'team.review_join', 'team.assign_coach', 'team.create_event', 'team.toggle_event_visibility',
  'admin.users.edit_profile', 'admin.users.change_role', 'admin.users.restrict',
  'admin.messages.compose', 'admin.messages.delete',
  'admin.repair.team_join_repair', 'admin.repair.no_show_adjust', 'admin.repair.data_sync',
  'admin.logs.error_read', 'admin.logs.error_delete', 'admin.logs.audit_read',
];

const ALL_PERMISSION_CODES = [...ENTRY_PERMISSION_CODES, ...SUB_PERMISSION_CODES];

// DRAWER_MENUS — page entries only (js/config.js:514-541)
const DRAWER_PAGE_ENTRIES = [
  { page: 'page-my-activities',        minRole: 'coach',       permissionCode: 'activity.manage.entry' },
  { page: 'page-admin-tournaments',    minRole: 'coach',       permissionCode: 'admin.tournaments.entry' },
  { page: 'page-admin-games',          minRole: 'admin',       permissionCode: 'admin.games.entry' },
  { page: 'page-admin-users',          minRole: 'admin',       permissionCode: 'admin.users.entry' },
  { page: 'page-admin-banners',        minRole: 'admin',       permissionCode: 'admin.banners.entry' },
  { page: 'page-admin-shop',           minRole: 'admin',       permissionCode: 'admin.shop.entry' },
  { page: 'page-admin-messages',       minRole: 'admin',       permissionCode: 'admin.messages.entry' },
  { page: 'page-admin-teams',          minRole: 'admin',       permissionCode: 'admin.teams.entry' },
  { page: 'page-admin-dashboard',      minRole: 'super_admin', permissionCode: 'admin.dashboard.entry' },
  { page: 'page-admin-themes',         minRole: 'super_admin', permissionCode: 'admin.themes.entry' },
  { page: 'page-admin-exp',            minRole: 'super_admin', permissionCode: 'admin.exp.entry' },
  { page: 'page-admin-auto-exp',       minRole: 'super_admin', permissionCode: 'admin.auto_exp.entry' },
  { page: 'page-admin-announcements',  minRole: 'super_admin', permissionCode: 'admin.announcements.entry' },
  { page: 'page-admin-achievements',   minRole: 'super_admin', permissionCode: 'admin.achievements.entry' },
  { page: 'page-admin-logs',           minRole: 'super_admin', permissionCode: 'admin.logs.entry' },
  { page: 'page-admin-repair',         minRole: 'admin',       permissionCode: 'admin.repair.entry' },
  { page: 'page-admin-inactive',       minRole: 'super_admin', permissionCode: 'admin.inactive.entry' },
  // No permissionCode — should stay role-guarded:
  { page: 'page-admin-roles',          minRole: 'super_admin', permissionCode: undefined },
];

// Pages with data-min-role in HTML (from pages/*.html grep)
const DATA_MIN_ROLE_PAGES = [
  { page: 'page-my-activities',       minRole: 'coach',       file: 'activity.html' },
  { page: 'page-admin-tournaments',   minRole: 'coach',       file: 'admin-content.html' },
  { page: 'page-admin-banners',       minRole: 'admin',       file: 'admin-content.html' },
  { page: 'page-admin-shop',          minRole: 'admin',       file: 'admin-content.html' },
  { page: 'page-admin-teams',         minRole: 'admin',       file: 'admin-content.html' },
  { page: 'page-admin-messages',      minRole: 'admin',       file: 'admin-content.html' },
  { page: 'page-admin-users',         minRole: 'admin',       file: 'admin-users.html' },
  { page: 'page-admin-exp',           minRole: 'super_admin', file: 'admin-users.html' },
  { page: 'page-admin-auto-exp',      minRole: 'super_admin', file: 'admin-auto-exp.html' },
  { page: 'page-admin-dashboard',     minRole: 'super_admin', file: 'admin-dashboard.html' },
  { page: 'page-admin-achievements',  minRole: 'super_admin', file: 'admin-system.html' },
  { page: 'page-admin-games',         minRole: 'admin',       file: 'admin-system.html' },
  { page: 'page-admin-themes',        minRole: 'super_admin', file: 'admin-system.html' },
  { page: 'page-admin-announcements', minRole: 'super_admin', file: 'admin-system.html' },
  { page: 'page-admin-roles',         minRole: 'super_admin', file: 'admin-system.html' },
  { page: 'page-admin-inactive',      minRole: 'super_admin', file: 'admin-system.html' },
  { page: 'page-admin-logs',          minRole: 'super_admin', file: 'admin-system.html' },
  { page: 'page-admin-audit-logs',    minRole: 'super_admin', file: 'admin-system.html' },
  { page: 'page-admin-error-logs',    minRole: 'super_admin', file: 'admin-system.html' },
  { page: 'page-admin-repair',        minRole: 'admin',       file: 'admin-system.html' },
  { page: 'page-scan',                minRole: 'coach',       file: 'scan.html' },
  { page: 'page-team-manage',         minRole: 'captain',     file: 'team.html' },
];

// Pages that MUST keep role-guarded (no permissionCode, or intentionally disabled)
const ROLE_ONLY_PAGES = [
  'page-admin-roles',       // permissionCode disabled in DISABLED_PERMISSION_CODES
  'page-admin-audit-logs',  // not in DRAWER_MENUS (sub-page of logs)
  'page-admin-error-logs',  // not in DRAWER_MENUS (sub-page of logs)
  'page-scan',              // not in DRAWER_MENUS (launched from deep link, has JS fallback)
  'page-team-manage',       // not in DRAWER_MENUS (launched from team detail)
];

// Non-page elements with data-min-role (visibility-only, not access control)
const DATA_MIN_ROLE_DIVS = [
  { selector: 'activity.html div.my-section', minRole: 'coach' },
  { selector: 'team.html div.my-section',     minRole: 'captain' },
];

// =========================================================================
// Extracted functions
// =========================================================================

// ---------------------------------------------------------------------------
// from js/config.js:544-556 — sanitizePermissionCodeList, isPermissionCodeEnabled
// ---------------------------------------------------------------------------
function isPermissionCodeEnabled(code) {
  return typeof code === 'string'
    && !!code
    && !DISABLED_PERMISSION_CODES.has(code);
}

function sanitizePermissionCodeList(codes) {
  return Array.from(new Set(
    (Array.isArray(codes) ? codes : []).filter(code => isPermissionCodeEnabled(code))
  ));
}

// ---------------------------------------------------------------------------
// from js/config.js:614-616 — getInherentRolePermissions
// ---------------------------------------------------------------------------
function getInherentRolePermissions(roleKey) {
  return INHERENT_ROLE_PERMISSIONS[roleKey] || [];
}

// ---------------------------------------------------------------------------
// from js/config.js:686-703 — getDefaultRolePermissions (simplified, no runtime custom roles)
// ---------------------------------------------------------------------------
function getDefaultRolePermissions(roleKey) {
  if (!BUILTIN_ROLE_KEYS.includes(roleKey)) return null;
  if (roleKey === 'user') return [];

  const roleLevel = ROLE_LEVEL_MAP[roleKey] || 0;
  const defaults = [];

  // Collect entry codes whose minRole <= this role's level
  DRAWER_PAGE_ENTRIES.forEach(entry => {
    if (entry.permissionCode && roleLevel >= (ROLE_LEVEL_MAP[entry.minRole] || 0)) {
      defaults.push(entry.permissionCode);
    }
  });

  // Admin+ gets additional team/event codes
  if (roleLevel >= ROLE_LEVEL_MAP.admin) {
    defaults.push('team.create', 'team.manage_all', 'event.edit_all');
  }

  return Array.from(new Set(defaults));
}

// ---------------------------------------------------------------------------
// from js/api-service.js:838-868 — getRolePermissions (simplified for testing)
// Combines: stored permissions + inherent + (super_admin gets all)
// ---------------------------------------------------------------------------
function getRolePermissions(roleKey, storedPermissions) {
  if (roleKey === 'user') return [];

  const stored = Array.isArray(storedPermissions)
    ? storedPermissions
    : (getDefaultRolePermissions(roleKey) || []);

  const inherent = getInherentRolePermissions(roleKey);

  if (roleKey === 'super_admin') {
    return sanitizePermissionCodeList([...stored, ...inherent, ...ALL_PERMISSION_CODES]);
  }

  return sanitizePermissionCodeList([...stored, ...inherent]);
}

// ---------------------------------------------------------------------------
// from js/modules/role.js:32-35 — hasPermission (pure function version)
// ---------------------------------------------------------------------------
function hasPermission(roleKey, storedPermissions, code) {
  if (!code) return false;
  return getRolePermissions(roleKey, storedPermissions).includes(code);
}

// ---------------------------------------------------------------------------
// from js/modules/role.js:43-52 — canAccessDrawerItem (pure function version)
// ---------------------------------------------------------------------------
function canAccessDrawerItem(item, roleKey, storedPermissions) {
  if (!item || item.divider || item.sectionLabel) return true;
  if (item.permissionCode) {
    return hasPermission(roleKey, storedPermissions, item.permissionCode);
  }
  const roleLevel = ROLE_LEVEL_MAP[roleKey] || 0;
  const minLevel = ROLE_LEVEL_MAP[item.minRole || 'user'] || 0;
  return roleLevel >= minLevel;
}

// ---------------------------------------------------------------------------
// from js/modules/role.js:59-68 — canAccessPage (pure function version)
// Simulates the logic without DOM; uses DRAWER_PAGE_ENTRIES as lookup
// ---------------------------------------------------------------------------
function canAccessPage(pageId, roleKey, storedPermissions, dataMinRole) {
  // Check if page is in DRAWER_MENUS
  const drawerItem = DRAWER_PAGE_ENTRIES.find(e => e.page === pageId);
  if (drawerItem) return canAccessDrawerItem(drawerItem, roleKey, storedPermissions);

  // Fallback: check data-min-role (simulated)
  if (!dataMinRole) return true;
  return (ROLE_LEVEL_MAP[roleKey] || 0) >= (ROLE_LEVEL_MAP[dataMinRole] || 0);
}

module.exports = {
  BUILTIN_ROLE_KEYS,
  ROLE_LEVEL_MAP,
  INHERENT_ROLE_PERMISSIONS,
  DISABLED_PERMISSION_CODES,
  ENTRY_PERMISSION_CODES,
  SUB_PERMISSION_CODES,
  ALL_PERMISSION_CODES,
  DRAWER_PAGE_ENTRIES,
  DATA_MIN_ROLE_PAGES,
  ROLE_ONLY_PAGES,
  DATA_MIN_ROLE_DIVS,
  isPermissionCodeEnabled,
  sanitizePermissionCodeList,
  getInherentRolePermissions,
  getDefaultRolePermissions,
  getRolePermissions,
  hasPermission,
  canAccessDrawerItem,
  canAccessPage,
};
