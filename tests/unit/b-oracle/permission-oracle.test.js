/**
 * FC (A version) permission differential oracle fixture generator (Phase P).
 *
 * Differential oracle for the permission-axis helpers:
 *   App.hasPermission(code)
 *   ApiService.hasCurrentUserEffectivePermission(code)
 *
 * Loading strategy (matches tests/unit/b-oracle/operate-oracle.test.js):
 * - All real source files are concatenated and executed inside a single
 *   vm.createContext script. No logic is reimplemented.
 * - SOURCE_PATHS includes:
 *     * js/config.js — defines DRAWER_MENUS, ADMIN_PAGE_EXTRA_PERMISSION_ITEMS,
 *       INHERENT_ROLE_PERMISSIONS, DISABLED_PERMISSION_CODES,
 *       LEGACY_PERMISSION_CODE_REPLACEMENTS, normalizePermissionCode,
 *       sanitizePermissionCodeList, sanitizeUserPermissionGrantCodeList,
 *       getDefaultRolePermissions, getAllPermissionCodes, etc.
 *     * js/modules/role.js — defines App.hasPermission,
 *       App._getPermissionListForContext, App._shouldUseCurrentUserEffectivePermissions,
 *       App._getRolePermissionList, App._getEffectiveRoleKey.
 *     * js/api-service.js — defines ApiService.getRolePermissions,
 *       ApiService.getCurrentUserPermissionGrants,
 *       ApiService.getCurrentUserEffectivePermissions,
 *       ApiService.hasCurrentUserEffectivePermission,
 *       ApiService.getRolePermissionDefaults.
 *     * js/modules/user-admin/user-admin-roles.js — loaded for parity with
 *       operate-oracle.test.js and to ensure any runtime role helpers / custom
 *       role utilities referenced by config / role resolution are present in
 *       the VM context.
 * - Only *data* is stubbed:
 *     * FirebaseService._cache.{currentUser, rolePermissions,
 *       rolePermissionMeta, currentUserPermissionGrant, customRoles, permissions}
 *       are pure data inputs.
 * - Minimal browser globals (document, window, localStorage, sessionStorage,
 *   navigator, location, history, firebase, ScriptLoader, fetch, ...) are
 *   provided as empty/false-ish stubs so legacy modules parse without
 *   throwing. No tested path is replaced.
 *
 * Write fixture only when B_ORACLE_WRITE=1.
 * Default output: tests/unit/b-oracle/out/permission-oracle.json
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '../../..');

const SOURCE_PATHS = [
  'js/config.js',
  'js/modules/role.js',
  'js/api-service.js',
  'js/modules/user-admin/user-admin-roles.js',
];

function sha256File(absPath) {
  return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
}

function getGitHead() {
  try {
    const head = execSync('git rev-parse HEAD', {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    return head || null;
  } catch (_) {
    return null;
  }
}

function createFcSandbox() {
  const cache = {
    currentUser: null,
    rolePermissions: {},
    rolePermissionMeta: {},
    roleActivityCapabilities: { user: [] },
    currentUserPermissionGrant: null,
    customRoles: [],
    permissions: [],
  };

  const context = {
    App: {},
    console,
    URL,
    URLSearchParams,
    Date,
    Math,
    JSON,
    Object,
    Array,
    Set,
    Map,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: jest.fn(cb => setTimeout(cb, 0)),
    cancelAnimationFrame: jest.fn(),
    localStorage: {
      getItem: jest.fn(() => null),
      setItem: jest.fn(),
      removeItem: jest.fn(),
      clear: jest.fn(),
    },
    sessionStorage: {
      getItem: jest.fn(() => null),
      setItem: jest.fn(),
      removeItem: jest.fn(),
      clear: jest.fn(),
    },
    navigator: {
      userAgent: 'jest-oracle',
      share: jest.fn(),
      clipboard: { writeText: jest.fn() },
      serviceWorker: {},
    },
    location: new URL('https://toosterx.com/'),
    history: {
      replaceState: jest.fn(),
      pushState: jest.fn(),
      back: jest.fn(),
    },
    screen: { width: 1024, height: 768 },
    innerWidth: 1024,
    innerHeight: 768,
    devicePixelRatio: 1,
    performance: {
      now: () => 0,
      mark: jest.fn(),
      measure: jest.fn(),
    },
    crypto: {
      randomUUID: () => '00000000-0000-4000-8000-000000000000',
    },
    matchMedia: jest.fn(() => ({
      matches: false,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
    getComputedStyle: jest.fn(() => ({
      getPropertyValue: () => '',
    })),
    alert: jest.fn(),
    confirm: jest.fn(() => false),
    prompt: jest.fn(() => null),
    fetch: jest.fn(() => Promise.resolve({ ok: true, json: async () => ({}) })),
    firebase: {},
    ScriptLoader: { ensureGroup: jest.fn() },
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
    scrollTo: jest.fn(),
    open: jest.fn(),
    close: jest.fn(),
    focus: jest.fn(),
    blur: jest.fn(),
    FirebaseService: { _cache: cache },
    // NOTE: ApiService is intentionally NOT pre-defined — js/api-service.js
    // (loaded below) defines it, and we must not shadow it with a stub.
  };

  context.window = context;
  context.globalThis = context;
  context.self = context;
  context.top = context;
  context.parent = context;
  context.frames = context;
  context.opener = null;
  context.closed = false;

  context.document = {
    getElementById: jest.fn(() => null),
    querySelector: jest.fn(() => null),
    querySelectorAll: jest.fn(() => []),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    createElement: jest.fn(() => ({
      style: {},
      classList: {
        add: jest.fn(),
        remove: jest.fn(),
        toggle: jest.fn(),
        contains: jest.fn(() => false),
      },
      setAttribute: jest.fn(),
      getAttribute: jest.fn(() => null),
      appendChild: jest.fn(),
      remove: jest.fn(),
      addEventListener: jest.fn(),
    })),
    createTextNode: jest.fn(text => ({ textContent: text })),
    documentElement: {
      style: {},
      classList: {
        add: jest.fn(),
        remove: jest.fn(),
        toggle: jest.fn(),
      },
    },
    head: {
      appendChild: jest.fn(),
      style: {},
    },
    body: {
      classList: {
        add: jest.fn(),
        remove: jest.fn(),
        toggle: jest.fn(),
      },
      appendChild: jest.fn(),
      style: {},
    },
    cookie: '',
    readyState: 'complete',
    visibilityState: 'visible',
    hidden: false,
  };
  context.document.defaultView = context.window;

  context.window.document = context.document;
  context.window.localStorage = context.localStorage;
  context.window.sessionStorage = context.sessionStorage;
  context.window.navigator = context.navigator;
  context.window.location = context.location;
  context.window.history = context.history;
  context.window.screen = context.screen;
  context.window.matchMedia = context.matchMedia;
  context.window.getComputedStyle = context.getComputedStyle;
  context.window.alert = context.alert;
  context.window.confirm = context.confirm;
  context.window.prompt = context.prompt;
  context.window.fetch = context.fetch;
  context.window.crypto = context.crypto;
  context.window.performance = context.performance;
  context.window.requestAnimationFrame = context.requestAnimationFrame;
  context.window.cancelAnimationFrame = context.cancelAnimationFrame;

  vm.createContext(context);

  const combined = SOURCE_PATHS
    .map(rel => fs.readFileSync(path.join(root, rel), 'utf8'))
    .join('\n;\n')
    + '\n;\n;(function () {'
    + ' try {'
    + '   globalThis.__FC_APP__ = (typeof App !== "undefined" ? App : (globalThis.App || null));'
    + '   globalThis.__FC_API__ = (typeof ApiService !== "undefined" ? ApiService : (globalThis.ApiService || null));'
    + '   globalThis.__FC_CONSTS__ = {'
    + '     DRAWER_MENUS: typeof DRAWER_MENUS !== "undefined" ? DRAWER_MENUS : [],'
    + '     ADMIN_PAGE_EXTRA_PERMISSION_ITEMS: typeof ADMIN_PAGE_EXTRA_PERMISSION_ITEMS !== "undefined" ? ADMIN_PAGE_EXTRA_PERMISSION_ITEMS : {},'
    + '     INHERENT_ROLE_PERMISSIONS: typeof INHERENT_ROLE_PERMISSIONS !== "undefined" ? INHERENT_ROLE_PERMISSIONS : {},'
    + '     DISABLED_PERMISSION_CODES: typeof DISABLED_PERMISSION_CODES !== "undefined" ? Array.from(DISABLED_PERMISSION_CODES) : [],'
    + '   };'
    + ' } catch (_) {'
    + '   globalThis.__FC_APP__ = globalThis.App || null;'
    + '   globalThis.__FC_API__ = globalThis.ApiService || null;'
    + ' }'
    + '})();\n';

  vm.runInContext(combined, context, { filename: 'fc-permission-bundle.js' });

  return {
    context,
    app: context.__FC_APP__ || context.App,
    api: context.__FC_API__ || context.ApiService,
    consts: context.__FC_CONSTS__,
    cache,
  };
}

/**
 * Deterministic PRNG (Mulberry32) so combination sampling is 100% reproducible.
 */
function createSeededRng(seed = 0x5045524d) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CUSTOM_ROLES_FIXTURE = [
  {
    key: 'custom_event_helper',
    roleKey: 'custom_event_helper',
    id: 'custom_event_helper',
    _docId: 'custom_event_helper',
    label: '活動小幫手',
    color: '#10b981',
    level: 1,
    baseRole: 'coach',
    minRole: 'coach',
    permissions: [
      'activity.manage.entry',
      'event.edit_self',
      'event.scan_qr',
      'profile.secondary_identity',
    ],
  },
  {
    key: 'custom_club_auditor',
    roleKey: 'custom_club_auditor',
    id: 'custom_club_auditor',
    _docId: 'custom_club_auditor',
    label: '俱樂部稽核員',
    color: '#6366f1',
    level: 2,
    baseRole: 'captain',
    minRole: 'captain',
    permissions: [
      'team.manage.entry',
      'team.approve_join',
      'admin.logs.audit_read',
    ],
  },
];

const PARTIAL_ROLE_PERMISSION_CODES = [
  'activity.manage.entry',
  'event.create',
  'event.edit_own',            // legacy alias -> event.edit_self
  'team.approve_join',         // legacy alias -> team.review_join
  'admin.teams.entry',         // legacy alias -> team.manage.entry
  'admin.scoreboard.entry',    // legacy alias -> ''
  'admin.roles.entry',         // disabled code
  'admin.repair.data_sync',
  'profile.secondary_identity',
  'admin.users.entry',
];

function collectTestedPermissionCodes(consts) {
  const codeSet = new Set();

  // 1. All permissionCode entries from DRAWER_MENUS
  for (const item of consts.DRAWER_MENUS || []) {
    if (item && item.permissionCode) {
      codeSet.add(item.permissionCode);
    }
  }

  // 2. All extra items from ADMIN_PAGE_EXTRA_PERMISSION_ITEMS
  const extraMap = consts.ADMIN_PAGE_EXTRA_PERMISSION_ITEMS || {};
  for (const pageKey of Object.keys(extraMap)) {
    for (const entry of extraMap[pageKey] || []) {
      if (entry && entry.code) {
        codeSet.add(entry.code);
      }
    }
  }

  // 3. All codes in INHERENT_ROLE_PERMISSIONS
  const inherentMap = consts.INHERENT_ROLE_PERMISSIONS || {};
  for (const roleKey of Object.keys(inherentMap)) {
    for (const c of inherentMap[roleKey] || []) {
      if (c) codeSet.add(c);
    }
  }

  // 4. All codes in DISABLED_PERMISSION_CODES
  for (const c of consts.DISABLED_PERMISSION_CODES || []) {
    if (c) codeSet.add(c);
  }

  // 5. 2-3 legacy alias codes (from LEGACY_PERMISSION_CODE_REPLACEMENTS)
  codeSet.add('event.edit_own');
  codeSet.add('team.approve_join');
  codeSet.add('admin.teams.entry');

  // 6. 1 non-existent permission code
  codeSet.add('nonexistent.permission.code');

  // 7. Explicitly required codes
  codeSet.add('team.review_join');
  codeSet.add('team.manage.entry');
  codeSet.add('team.manage_all');
  codeSet.add('admin.repair.data_sync');
  codeSet.add('profile.secondary_identity');

  return Array.from(codeSet);
}

/**
 * Apply rolePermissions state to FirebaseService._cache.rolePermissions.
 * Covers both Object map shape (array value or { permissions } object value)
 * and Array-of-docs shape (_docId / roleKey / role / id + permissions), as
 * supported by ApiService.getRolePermissions.
 */
function applyRolePermissions(cache, role, rpState, shapeVariant) {
  if (rpState === 'absent') {
    if (shapeVariant === 'array-docs') {
      cache.rolePermissions = [
        { _docId: 'other_unrelated_role', permissions: ['event.create'] },
      ];
    } else {
      cache.rolePermissions = {};
    }
    return;
  }

  const codes = rpState === 'empty' ? [] : PARTIAL_ROLE_PERMISSION_CODES.slice();

  if (shapeVariant === 'array-docs') {
    cache.rolePermissions = [
      {
        _docId: role,
        roleKey: role,
        permissions: codes,
      },
    ];
  } else if (shapeVariant === 'object-wrapped') {
    cache.rolePermissions = {
      [role]: { permissions: codes },
    };
  } else {
    cache.rolePermissions = {
      [role]: codes,
    };
  }
}

/**
 * Apply rolePermissionMeta state (with or without custom defaultPermissions).
 * Covers both object map and array-of-docs shapes read by ApiService.getRolePermissionDefaults.
 */
function applyRolePermissionMeta(cache, role, metaState) {
  if (metaState === 'absent') {
    cache.rolePermissionMeta = {};
    return;
  }
  const defaultPermissions = [
    'activity.manage.entry',
    'team.manage.entry',
    'team.review_join',
  ];
  if (metaState === 'present-array') {
    cache.rolePermissionMeta = [
      { _docId: role, roleKey: role, defaultPermissions },
    ];
    return;
  }
  cache.rolePermissionMeta = {
    [role]: { defaultPermissions },
  };
}

/**
 * Apply currentUserPermissionGrant state.
 * States:
 *   - 'absent': null
 *   - 'enabled-true': { uid, enabled: true, permissions: [...] }
 *   - 'enabled-false': { uid, enabled: false, permissions: [...] }
 *   - 'no-enabled-field': { uid, permissions: [...] } (no `enabled` property)
 */
function applyUserGrant(cache, uid, grantState) {
  const grantPermissions = [
    'admin.repair.data_sync',
    'profile.secondary_identity',
    'team.review_join',
    'event.edit_self',
    'event.edit_own',         // legacy code (filtered out by sanitizeUserPermissionGrantCodeList)
    'admin.roles.entry',      // disabled code
  ];

  switch (grantState) {
    case 'absent':
      cache.currentUserPermissionGrant = null;
      return;
    case 'enabled-true':
      cache.currentUserPermissionGrant = {
        uid,
        enabled: true,
        permissions: grantPermissions.slice(),
      };
      return;
    case 'enabled-false':
      cache.currentUserPermissionGrant = {
        uid,
        enabled: false,
        permissions: grantPermissions.slice(),
      };
      return;
    case 'no-enabled-field':
      cache.currentUserPermissionGrant = {
        uid,
        permissions: grantPermissions.slice(),
      };
      return;
    default:
      throw new Error(`Unknown grantState: ${grantState}`);
  }
}

function cloneJson(val) {
  return val === undefined ? null : JSON.parse(JSON.stringify(val));
}

describe('B oracle: permission fixture (Phase P)', () => {
  test('generates deterministic permission oracle cases and verifies anchor invariants', () => {
    const { app, api, consts, cache } = createFcSandbox();

    const allTestedCodes = collectTestedPermissionCodes(consts);

    const roles = [
      'user',
      'coach',
      'captain',
      'team_leader',
      'venue_owner',
      'admin',
      'super_admin',
      'custom_event_helper',
      'custom_club_auditor',
    ];

    const rpStates = ['absent', 'empty', 'partial'];
    const rpShapes = ['object-array', 'object-wrapped', 'array-docs'];
    const grantStates = ['absent', 'enabled-true', 'enabled-false', 'no-enabled-field'];
    const metaStates = ['absent', 'present-object', 'present-array'];

    const rng = createSeededRng(20260519);
    const cases = [];
    let caseIndex = 0;

    function recordCase({
      uid,
      role,
      rpState,
      rpShape,
      metaState,
      grantState,
      code,
    }) {
      cache.customRoles = cloneJson(CUSTOM_ROLES_FIXTURE);
      cache.currentUser = { uid, role };
      app.currentRole = role;

      applyRolePermissions(cache, role, rpState, rpShape);
      applyRolePermissionMeta(cache, role, metaState);
      applyUserGrant(cache, uid, grantState);

      const hasPermission = !!app.hasPermission(code);
      const hasCurrentUserEffectivePermission = !!api.hasCurrentUserEffectivePermission(code);

      caseIndex += 1;
      cases.push({
        id: `perm-case-${String(caseIndex).padStart(4, '0')}`,
        input: {
          currentUser: cloneJson(cache.currentUser),
          rolePermissionsState: rpState,
          rolePermissionsShape: rpShape,
          rolePermissions: cloneJson(cache.rolePermissions),
          rolePermissionMetaState: metaState,
          rolePermissionMeta: cloneJson(cache.rolePermissionMeta),
          currentUserPermissionGrantState: grantState,
          currentUserPermissionGrant: cloneJson(cache.currentUserPermissionGrant),
          customRoles: cloneJson(cache.customRoles),
          code,
        },
        expected: {
          hasPermission,
          hasCurrentUserEffectivePermission,
        },
      });
    }

    // Pass 1: Guarantee every (role × rpState × grantState) cell appears at least once,
    // while also cycling across all rpShapes, metaStates, and allTestedCodes.
    // 9 roles × 3 rpStates × 4 grantStates = 108 base cells; we emit 5 codes per cell = 540 cases.
    let codeCursor = 0;
    let cellCounter = 0;

    for (const role of roles) {
      for (const rpState of rpStates) {
        for (const grantState of grantStates) {
          const rpShape = rpShapes[cellCounter % rpShapes.length];
          const metaState = metaStates[cellCounter % metaStates.length];
          const uid = cellCounter % 7 === 0 ? 'u-alt-99' : 'u-main-01';

          // Pick 5 distinct codes per cell: deterministic sweep + seeded offset
          // so every code in allTestedCodes is covered multiple times and each role
          // gets both true and false outcomes.
          const pickedCodes = [];
          for (let k = 0; k < 5; k += 1) {
            const c = allTestedCodes[(codeCursor + k) % allTestedCodes.length];
            pickedCodes.push(c);
          }
          codeCursor = (codeCursor + 5 + Math.floor(rng() * 3)) % allTestedCodes.length;

          for (const code of pickedCodes) {
            recordCase({
              uid,
              role,
              rpState,
              rpShape,
              metaState,
              grantState,
              code,
            });
          }

          cellCounter += 1;
        }
      }
    }

    // Pass 2: Explicit anchor & edge combinations to ensure every single code in
    // allTestedCodes is exercised across representative roles/states (adds ~100 cases,
    // keeping total within 400..800).
    for (let i = 0; i < allTestedCodes.length; i += 1) {
      const code = allTestedCodes[i];
      const role = roles[i % roles.length];
      const rpState = rpStates[i % rpStates.length];
      const rpShape = rpShapes[(i + 1) % rpShapes.length];
      const grantState = grantStates[i % grantStates.length];
      const metaState = metaStates[(i + 2) % metaStates.length];

      recordCase({
        uid: 'u-sweep-02',
        role,
        rpState,
        rpShape,
        metaState,
        grantState,
        code,
      });
    }

    // Pass 3: Explicit anchor cases for each role so every role is guaranteed to have
    // both true and false results (including user with grant enabled-true vs absent,
    // custom roles with partial permissions vs absent, and super_admin on enabled vs disabled/nonexistent codes).
    const explicitRolePairs = [
      // user: true via currentUserPermissionGrant ('admin.repair.data_sync'), false when grant absent
      { role: 'user', rpState: 'absent', rpShape: 'object-array', grantState: 'enabled-true', code: 'admin.repair.data_sync' },
      { role: 'user', rpState: 'absent', rpShape: 'object-array', grantState: 'absent', code: 'admin.users.entry' },
      // team_leader & custom roles: true when partial / grant, false on nonexistent
      { role: 'team_leader', rpState: 'partial', rpShape: 'object-array', grantState: 'absent', code: 'activity.manage.entry' },
      { role: 'team_leader', rpState: 'absent', rpShape: 'object-array', grantState: 'absent', code: 'nonexistent.permission.code' },
      { role: 'custom_event_helper', rpState: 'partial', rpShape: 'array-docs', grantState: 'absent', code: 'event.edit_own' },
      { role: 'custom_event_helper', rpState: 'absent', rpShape: 'array-docs', grantState: 'absent', code: 'nonexistent.permission.code' },
      { role: 'custom_club_auditor', rpState: 'partial', rpShape: 'object-wrapped', grantState: 'absent', code: 'team.approve_join' },
      { role: 'custom_club_auditor', rpState: 'absent', rpShape: 'object-wrapped', grantState: 'absent', code: 'nonexistent.permission.code' },
      // super_admin: true on inherent/catalog code, false on disabled/nonexistent code
      { role: 'super_admin', rpState: 'empty', rpShape: 'object-array', grantState: 'absent', code: 'admin.repair.event_blocklist' },
      { role: 'super_admin', rpState: 'absent', rpShape: 'object-array', grantState: 'absent', code: 'admin.roles.entry' },
      { role: 'super_admin', rpState: 'absent', rpShape: 'object-array', grantState: 'absent', code: 'nonexistent.permission.code' },
    ];

    for (const item of explicitRolePairs) {
      recordCase({
        uid: 'u-anchor-01',
        role: item.role,
        rpState: item.rpState,
        rpShape: item.rpShape,
        metaState: 'absent',
        grantState: item.grantState,
        code: item.code,
      });
    }

    const meta = {
      generatedAt: new Date().toISOString(),
      fcHead: getGitHead(),
      sources: SOURCE_PATHS.map(rel => ({
        path: rel,
        sha256: sha256File(path.join(root, rel)),
      })),
      caseCount: cases.length,
    };

    if (process.env.B_ORACLE_WRITE === '1') {
      const outPath = process.env.B_ORACLE_OUT
        ? path.resolve(process.cwd(), process.env.B_ORACLE_OUT)
        : path.join(root, 'tests/unit/b-oracle/out/permission-oracle.json');

      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(
        outPath,
        `${JSON.stringify({ meta, cases }, null, 2)}\n`,
        'utf8'
      );
    }

    // ─── Assertions: Case count & coverage requirements ───
    expect(cases.length).toBeGreaterThanOrEqual(400);
    expect(cases.length).toBeLessThanOrEqual(800);
    expect(meta.caseCount).toBe(cases.length);

    // Every (role × rpState × grantState) combination must appear at least once
    for (const role of roles) {
      for (const rpState of rpStates) {
        for (const grantState of grantStates) {
          const found = cases.some(
            c =>
              c.input.currentUser.role === role &&
              c.input.rolePermissionsState === rpState &&
              c.input.currentUserPermissionGrantState === grantState
          );
          expect(found).toBe(true);
        }
      }
    }

    // Every tested permission code must appear at least once
    const seenCodes = new Set(cases.map(c => c.input.code));
    for (const code of allTestedCodes) {
      expect(seenCodes.has(code)).toBe(true);
    }

    // Every role must have both true and false results for hasPermission and hasCurrentUserEffectivePermission
    for (const role of roles) {
      const roleCases = cases.filter(c => c.input.currentUser.role === role);
      const hpValues = new Set(roleCases.map(c => c.expected.hasPermission));
      const effValues = new Set(roleCases.map(c => c.expected.hasCurrentUserEffectivePermission));
      expect(hpValues.has(true)).toBe(true);
      expect(hpValues.has(false)).toBe(true);
      expect(effValues.has(true)).toBe(true);
      expect(effValues.has(false)).toBe(true);
    }

    // ─── Anchor Assertions (derived directly from A's functions in context files) ───
    function evalAnchor({ role, rpState, rpShape = 'object-array', grantState = 'absent', code }) {
      cache.customRoles = cloneJson(CUSTOM_ROLES_FIXTURE);
      cache.currentUser = { uid: 'u-anchor', role };
      app.currentRole = role;
      applyRolePermissions(cache, role, rpState, rpShape);
      applyRolePermissionMeta(cache, role, 'absent');
      applyUserGrant(cache, 'u-anchor', grantState);
      return {
        hasPermission: app.hasPermission(code),
        hasCurrentUserEffectivePermission: api.hasCurrentUserEffectivePermission(code),
      };
    }

    // Anchor 1: super_admin has INHERENT_ROLE_PERMISSIONS ('admin.repair.event_blocklist', 'admin.seo.entry')
    // even when rolePermissions[super_admin] is explicitly empty [].
    // Source: js/config.js `INHERENT_ROLE_PERMISSIONS` / `getInherentRolePermissions('super_admin')`
    // and js/api-service.js `ApiService.getRolePermissions('super_admin')` which merges
    // `[...resolved, ...inherent, ...getAllPermissionCodes(...)]`.
    expect(evalAnchor({
      role: 'super_admin',
      rpState: 'empty',
      grantState: 'absent',
      code: 'admin.repair.event_blocklist',
    })).toEqual({
      hasPermission: true,
      hasCurrentUserEffectivePermission: true,
    });
    expect(evalAnchor({
      role: 'super_admin',
      rpState: 'empty',
      grantState: 'absent',
      code: 'admin.seo.entry',
    })).toEqual({
      hasPermission: true,
      hasCurrentUserEffectivePermission: true,
    });

    // Anchor 2: 'user' role with no rolePermissions doc and no grant returns false for
    // backend entry codes (e.g. 'admin.users.entry', 'activity.manage.entry').
    // Source: js/api-service.js `ApiService.getRolePermissions('user')` early-returns `[]`,
    // and `ApiService.getCurrentUserPermissionGrants()` returns `[]` when grant is null.
    expect(evalAnchor({
      role: 'user',
      rpState: 'absent',
      grantState: 'absent',
      code: 'admin.users.entry',
    })).toEqual({
      hasPermission: false,
      hasCurrentUserEffectivePermission: false,
    });
    expect(evalAnchor({
      role: 'user',
      rpState: 'absent',
      grantState: 'absent',
      code: 'activity.manage.entry',
    })).toEqual({
      hasPermission: false,
      hasCurrentUserEffectivePermission: false,
    });

    // Anchor 3: 'captain' with no stored rolePermissions document gets default permissions
    // where `team.manage.entry` (minRole: 'captain') is true, while `admin.users.entry` (minRole: 'admin') is false.
    // Source: js/config.js `DRAWER_MENUS` + `getDefaultRolePermissions('captain')` and
    // js/api-service.js `ApiService.getRolePermissions('captain')`.
    expect(evalAnchor({
      role: 'captain',
      rpState: 'absent',
      grantState: 'absent',
      code: 'team.manage.entry',
    })).toEqual({
      hasPermission: true,
      hasCurrentUserEffectivePermission: true,
    });
    expect(evalAnchor({
      role: 'captain',
      rpState: 'absent',
      grantState: 'absent',
      code: 'admin.users.entry',
    })).toEqual({
      hasPermission: false,
      hasCurrentUserEffectivePermission: false,
    });

    // Anchor 4: 'captain' with explicit empty array `rolePermissions.captain = []` has
    // `team.manage.entry` turned off (false) because INHERENT_ROLE_PERMISSIONS.captain is `[]`.
    // Source: js/config.js `INHERENT_ROLE_PERMISSIONS` (`captain: []`) and
    // js/api-service.js `ApiService.getRolePermissions` (`hasStoredRolePermissions ? stored : getDefaultRolePermissions(role)`).
    expect(evalAnchor({
      role: 'captain',
      rpState: 'empty',
      grantState: 'absent',
      code: 'team.manage.entry',
    })).toEqual({
      hasPermission: false,
      hasCurrentUserEffectivePermission: false,
    });

    // Anchor 5: Legacy alias normalization — when rolePermissions contains legacy code
    // 'team.approve_join', querying either 'team.approve_join' or 'team.review_join' returns true;
    // disabled code 'admin.roles.entry' always normalizes to '' and returns false even for super_admin.
    // Source: js/config.js `LEGACY_PERMISSION_CODE_REPLACEMENTS`, `DISABLED_PERMISSION_CODES`,
    // `normalizePermissionCode`, `App.hasPermission`, and `ApiService.hasCurrentUserEffectivePermission`.
    expect(evalAnchor({
      role: 'coach',
      rpState: 'partial',
      grantState: 'absent',
      code: 'team.review_join',
    })).toEqual({
      hasPermission: true,
      hasCurrentUserEffectivePermission: true,
    });
    expect(evalAnchor({
      role: 'coach',
      rpState: 'partial',
      grantState: 'absent',
      code: 'team.approve_join',
    })).toEqual({
      hasPermission: true,
      hasCurrentUserEffectivePermission: true,
    });
    expect(evalAnchor({
      role: 'super_admin',
      rpState: 'absent',
      grantState: 'absent',
      code: 'admin.roles.entry',
    })).toEqual({
      hasPermission: false,
      hasCurrentUserEffectivePermission: false,
    });

    // Anchor 6: Individual user grant behavior — when `enabled: true` or `enabled` field is omitted
    // (`grant.enabled === false` is false), allowed grant codes like `profile.secondary_identity`
    // and `admin.repair.data_sync` are granted to `user`; when `enabled: false`, they are not.
    // Source: js/api-service.js `ApiService.getCurrentUserPermissionGrants` (`if (!uid || !grant || grant.enabled === false) return [];`)
    // and js/config.js `sanitizeUserPermissionGrantCodeList`.
    expect(evalAnchor({
      role: 'user',
      rpState: 'absent',
      grantState: 'enabled-true',
      code: 'profile.secondary_identity',
    })).toEqual({
      hasPermission: true,
      hasCurrentUserEffectivePermission: true,
    });
    expect(evalAnchor({
      role: 'user',
      rpState: 'absent',
      grantState: 'no-enabled-field',
      code: 'admin.repair.data_sync',
    })).toEqual({
      hasPermission: true,
      hasCurrentUserEffectivePermission: true,
    });
    expect(evalAnchor({
      role: 'user',
      rpState: 'absent',
      grantState: 'enabled-false',
      code: 'profile.secondary_identity',
    })).toEqual({
      hasPermission: false,
      hasCurrentUserEffectivePermission: false,
    });
  });
});
