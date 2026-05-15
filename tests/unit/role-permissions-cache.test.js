const fs = require('fs');
const path = require('path');
const vm = require('vm');

const KNOWN_PERMS = new Set([
  'activity.manage.entry',
  'admin.users.entry',
  'event.edit_all',
  'team.create',
]);

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
    getDefaultRolePermissions(roleKey) {
      if (roleKey === 'admin') return ['team.create', 'event.edit_all'];
      if (roleKey === 'coach') return ['activity.manage.entry'];
      return [];
    },
    getInherentRolePermissions(roleKey) {
      return roleKey === 'coach' ? ['activity.manage.entry'] : [];
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
});
