const fs = require('fs');
const path = require('path');
const vm = require('vm');

const KNOWN_PERMS = new Set([
  'activity.manage.entry',
  'admin.users.entry',
  'event.edit_all',
  'team.create',
  'profile.secondary_identity',
]);


function loadRoleHarness() {
  const sandbox = {
    console,
    App: {
      currentRole: 'user',
      _canAccessOwnActivityManageEntry() { return true; },
    },
    ROLE_LEVEL_MAP: { user: 0, coach: 2, admin: 4, super_admin: 5 },
    ROLES: { user: {}, admin: {}, super_admin: {} },
    DRAWER_MENUS: [{ page: 'page-admin-users', permissionCode: 'admin.users.entry', minRole: 'admin' }],
    AUTH_REQUIRED_PAGES: [],
    getAdminDrawerPermissionCodes() { return ['admin.users.entry']; },
    normalizePermissionCode(code) { return typeof code === 'string' ? code.trim() : ''; },
    ApiService: {
      getCurrentUser() { return { uid: 'uid-1', role: 'user' }; },
      getCurrentUserEffectivePermissions() { return ['admin.users.entry']; },
      getRolePermissions(role) { return role === 'admin' ? ['admin.users.entry'] : []; },
    },
  };
  vm.createContext(sandbox);
  const roleSource = fs.readFileSync(path.join(__dirname, '../../js/modules/role.js'), 'utf8');
  vm.runInContext(roleSource, sandbox, { filename: 'js/modules/role.js' });
  return sandbox;
}

function loadHarness() {
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Promise,
    Date,
    Math,
    localStorage: {
      getItem: jest.fn(),
      setItem: jest.fn(),
      removeItem: jest.fn(),
      key: jest.fn(),
      get length() { return 0; },
    },
    sanitizePermissionCodeList(codes) {
      return Array.from(new Set(
        (Array.isArray(codes) ? codes : []).filter(code => KNOWN_PERMS.has(code))
      ));
    },
    normalizePermissionCode(code) {
      if (typeof code !== 'string') return '';
      const trimmed = code.trim();
      if (!trimmed || trimmed === 'admin.roles.entry') return '';
      if (trimmed === 'event.edit_own') return 'event.edit_self';
      return trimmed;
    },
    sanitizeUserPermissionGrantCodeList(codes) {
      const allowed = new Set([...KNOWN_PERMS, 'profile.secondary_identity']);
      return Array.from(new Set(
        (Array.isArray(codes) ? codes : [])
          .map(code => (typeof code === 'string' ? code.trim() : ''))
          .filter(code => code && allowed.has(code) && sandbox.normalizePermissionCode(code) === code)
      ));
    },
    getDefaultRolePermissions(roleKey) {
      if (roleKey === 'admin') return ['team.create', 'event.edit_all'];
      if (roleKey === 'coach') return ['activity.manage.entry'];
      return [];
    },
    getInherentRolePermissions() {
      return [];
    },
    getAllPermissionCodes() {
      return Array.from(KNOWN_PERMS);
    },
    getDefaultRoleActivityCapabilities() {
      return [];
    },
    sanitizeRoleActivityCapabilities() {
      return [];
    },
  };
  vm.createContext(sandbox);
  const firebaseSource = fs.readFileSync(path.join(__dirname, '../../js/firebase-service.js'), 'utf8');
  vm.runInContext(`${firebaseSource}\nglobalThis.FirebaseService = FirebaseService;`, sandbox, {
    filename: 'js/firebase-service.js',
  });
  const apiSource = fs.readFileSync(path.join(__dirname, '../../js/api-service.js'), 'utf8');
  vm.runInContext(`${apiSource}\nglobalThis.ApiService = ApiService;`, sandbox, {
    filename: 'js/api-service.js',
  });
  return sandbox;
}

describe('rolePermissions cache shape', () => {
  test('static collection loads stay in role-key map shape', () => {
    const { FirebaseService, ApiService } = loadHarness();

    FirebaseService._replaceCollectionCache('rolePermissions', [{
      _docId: 'admin',
      permissions: ['team.create', 'team.create', 'unknown.permission'],
      defaultPermissions: ['team.create'],
      catalogVersion: 'v-test',
    }]);

    expect(Array.isArray(FirebaseService._cache.rolePermissions)).toBe(false);
    expect(FirebaseService._cache.rolePermissions.admin).toEqual(['team.create']);
    expect(FirebaseService._cache.rolePermissionMeta.admin).toEqual({
      catalogVersion: 'v-test',
      defaultPermissions: ['team.create'],
    });
    expect(ApiService.getRolePermissions('admin')).toEqual(['team.create']);
  });

  test('explicitly empty stored permissions do not fall back to defaults', () => {
    const { FirebaseService, ApiService } = loadHarness();

    FirebaseService._replaceCollectionCache('rolePermissions', [{
      _docId: 'admin',
      permissions: [],
    }]);

    expect(FirebaseService._cache.rolePermissions.admin).toEqual([]);
    expect(ApiService.getRolePermissions('admin')).toEqual([]);
  });

  test('legacy array cache still resolves stored permissions', () => {
    const { FirebaseService, ApiService } = loadHarness();
    FirebaseService._cache.rolePermissions = [{
      _docId: 'admin',
      permissions: ['admin.users.entry'],
    }];

    expect(ApiService.getRolePermissions('admin')).toEqual(['admin.users.entry']);
  });

  test('legacy array cache with empty permissions stays empty', () => {
    const { FirebaseService, ApiService } = loadHarness();
    FirebaseService._cache.rolePermissions = [{
      _docId: 'admin',
      permissions: [],
    }];

    expect(ApiService.getRolePermissions('admin')).toEqual([]);
  });

  test('object map cache resolves stored permissions and strips unknown codes', () => {
    const { FirebaseService, ApiService } = loadHarness();
    FirebaseService._cache.rolePermissions = {
      admin: {
        permissions: ['team.create', 'admin.users.entry', 'unknown.permission'],
      },
    };

    expect(ApiService.getRolePermissions('admin')).toEqual(['team.create', 'admin.users.entry']);
  });

  test('missing stored role falls back to current default permissions', () => {
    const { FirebaseService, ApiService } = loadHarness();
    FirebaseService._cache.rolePermissions = {};

    expect(ApiService.getRolePermissions('admin')).toEqual(['team.create', 'event.edit_all']);
  });

  test('explicitly empty object-map permissions do not get repopulated by defaults after refresh', () => {
    const { FirebaseService, ApiService } = loadHarness();
    FirebaseService._cache.rolePermissions = {
      admin: { permissions: [] },
    };

    expect(ApiService.getRolePermissions('admin')).toEqual([]);
  });

  test('current user effective permissions merge UID grants without enabling rolePermissions/user', () => {
    const { FirebaseService, ApiService } = loadHarness();
    FirebaseService._cache.currentUser = { uid: 'uid-1', role: 'user' };
    FirebaseService._cache.rolePermissions = { user: ['admin.users.entry'] };
    FirebaseService._cache.currentUserPermissionGrant = {
      uid: 'uid-1',
      enabled: true,
      permissions: ['profile.secondary_identity', 'admin.users.entry', 'admin.roles.entry', 'event.edit_own', { code: 'team.create' }],
    };

    expect(ApiService.getRolePermissions('user')).toEqual([]);
    expect(ApiService.getCurrentUserPermissionGrants()).toEqual(['profile.secondary_identity', 'admin.users.entry']);
    expect(ApiService.getCurrentUserEffectivePermissions()).toEqual(['profile.secondary_identity', 'admin.users.entry']);
    expect(ApiService.hasCurrentUserEffectivePermission('profile.secondary_identity')).toBe(true);
    expect(ApiService.canUseSecondaryIdentityFeature()).toBe(true);
    expect(ApiService.canUseSecondaryIdentityFeature('user')).toBe(false);
  });

  test('current user UID grants fail closed before current user is known', () => {
    const { FirebaseService, ApiService } = loadHarness();
    FirebaseService._cache.currentUser = null;
    FirebaseService._cache.currentUserPermissionGrant = {
      uid: 'uid-1',
      enabled: true,
      permissions: ['profile.secondary_identity'],
    };

    expect(ApiService.getCurrentUserPermissionGrants()).toEqual([]);
    expect(ApiService.canUseSecondaryIdentityFeature()).toBe(false);
  });

  test('current user UID grants fail closed when disabled, missing, or mismatched', () => {
    const { FirebaseService, ApiService } = loadHarness();
    FirebaseService._cache.currentUser = { uid: 'uid-1', role: 'user' };

    FirebaseService._cache.currentUserPermissionGrant = null;
    expect(ApiService.getCurrentUserEffectivePermissions()).toEqual([]);
    expect(ApiService.canUseSecondaryIdentityFeature()).toBe(false);

    FirebaseService._cache.currentUserPermissionGrant = {
      uid: 'uid-1',
      enabled: false,
      permissions: ['profile.secondary_identity'],
    };
    expect(ApiService.getCurrentUserPermissionGrants()).toEqual([]);
    expect(ApiService.canUseSecondaryIdentityFeature()).toBe(false);

    FirebaseService._cache.currentUserPermissionGrant = {
      uid: 'uid-2',
      enabled: true,
      permissions: ['profile.secondary_identity'],
    };
    expect(ApiService.getCurrentUserPermissionGrants()).toEqual([]);
    expect(ApiService.canUseSecondaryIdentityFeature()).toBe(false);
  });

  test('App.hasPermission keeps explicit role checks role-only while no-role checks use current effective permissions', () => {
    const { App } = loadRoleHarness();

    expect(App.hasPermission('admin.users.entry')).toBe(true);
    expect(App.hasPermission('admin.users.entry', 'user')).toBe(false);
    expect(App.hasPermission('admin.users.entry', 'admin')).toBe(true);
    expect(App._canAccessDrawerItem({ page: 'page-admin-users', permissionCode: 'admin.users.entry', minRole: 'admin' })).toBe(true);
    expect(App._canAccessDrawerItem({ page: 'page-admin-users', permissionCode: 'admin.users.entry', minRole: 'admin' }, 'user')).toBe(false);
  });

  test('App drawer item keeps page-my-activities role-only when role is explicit', () => {
    const { App } = loadRoleHarness();
    const item = { page: 'page-my-activities', permissionCode: 'activity.manage.entry', minRole: 'coach' };

    expect(App._canAccessDrawerItem(item)).toBe(true);
    expect(App._canAccessDrawerItem(item, 'user')).toBe(false);
  });
});
