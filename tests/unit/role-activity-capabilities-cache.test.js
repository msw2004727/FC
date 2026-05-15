const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DEFAULT_CAPS = [
  'user.activity.basic_create',
  'user.activity.external_create',
  'user.activity.own_manage_entry',
  'user.activity.own_edit_basic',
  'user.activity.own_cancel',
  'user.activity.site_operate',
  'user.activity.delegate_assign',
];

const ALL_CAPS = new Set([
  ...DEFAULT_CAPS,
  'user.activity.addons_use',
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
    sanitizeRoleActivityCapabilities(codes) {
      return Array.from(new Set(
        (Array.isArray(codes) ? codes : []).filter(code => ALL_CAPS.has(code))
      ));
    },
    getDefaultRoleActivityCapabilities(roleKey) {
      return roleKey === 'user' ? [...DEFAULT_CAPS] : [];
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

describe('roleActivityCapabilities cache shape', () => {
  test('static collection loads stay in role-key map shape', () => {
    const { FirebaseService, ApiService } = loadHarness();

    FirebaseService._replaceCollectionCache('roleActivityCapabilities', [{
      _docId: 'user',
      capabilities: [...DEFAULT_CAPS, 'user.activity.addons_use'],
    }]);

    expect(Array.isArray(FirebaseService._cache.roleActivityCapabilities)).toBe(false);
    expect(FirebaseService._cache.roleActivityCapabilities.user).toContain('user.activity.addons_use');
    expect(ApiService.hasRoleActivityCapability('user', 'user.activity.addons_use')).toBe(true);
  });

  test('legacy array cache still resolves manually enabled add-on capability', () => {
    const { FirebaseService, ApiService } = loadHarness();
    FirebaseService._cache.roleActivityCapabilities = [{
      _docId: 'user',
      capabilities: [...DEFAULT_CAPS, 'user.activity.addons_use'],
    }];

    expect(ApiService.hasRoleActivityCapability('user', 'user.activity.addons_use')).toBe(true);
  });

  test('missing user capability doc falls back to default basic activity capabilities', () => {
    const { FirebaseService, ApiService } = loadHarness();
    FirebaseService._cache.roleActivityCapabilities = {};

    expect(ApiService.getRoleActivityCapabilities('user')).toEqual(DEFAULT_CAPS);
    expect(ApiService.hasRoleActivityCapability('user', 'user.activity.basic_create')).toBe(true);
    expect(ApiService.hasRoleActivityCapability('user', 'user.activity.addons_use')).toBe(false);
  });

  test('object map cache resolves manual add-on capability and strips unknown codes', () => {
    const { FirebaseService, ApiService } = loadHarness();
    FirebaseService._cache.roleActivityCapabilities = {
      user: {
        capabilities: [...DEFAULT_CAPS, 'user.activity.addons_use', 'user.activity.unknown'],
      },
    };

    expect(ApiService.getRoleActivityCapabilities('user')).toEqual([...DEFAULT_CAPS, 'user.activity.addons_use']);
  });

  test('explicitly empty user capabilities do not fall back to defaults', () => {
    const { FirebaseService, ApiService } = loadHarness();

    FirebaseService._replaceCollectionCache('roleActivityCapabilities', [{
      _docId: 'user',
      capabilities: [],
    }]);

    expect(FirebaseService._cache.roleActivityCapabilities.user).toEqual([]);
    expect(ApiService.getRoleActivityCapabilities('user')).toEqual([]);
  });

  test('activity creation pages require fresh role activity capabilities', () => {
    const { FirebaseService } = loadHarness();

    expect(FirebaseService._collectionPageMap['page-activities']).toContain('roleActivityCapabilities');
    expect(FirebaseService._collectionPageMap['page-my-activities']).toContain('roleActivityCapabilities');
    expect(FirebaseService._collectionPageMap['page-team-detail']).toContain('roleActivityCapabilities');
    expect(FirebaseService._staticReloadMaxAgeMs.roleActivityCapabilities).toBeLessThanOrEqual(60 * 1000);
  });
});
