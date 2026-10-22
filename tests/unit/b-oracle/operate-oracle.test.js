/**
 * FC (A version) activity operate oracle fixture generator.
 *
 * R-IAM-010 / 011 / 012 / 013 differential oracle for the operate-axis helpers:
 *   _canEditOwnActivityBasic, _canCancelOwnActivity, _canReopenOrRelistActivity,
 *   _canDeleteActivity, _canOperateEventSite, _canRemoveConfirmedParticipant,
 *   _hasActivityManageEntry, _hasUserActivityCapability(x8), _canManageEvent.
 *
 * Loading strategy (matches tests/unit/b-oracle/visibility-oracle.test.js):
 * - All real source files are concatenated and executed inside a single
 *   vm.createContext script. No logic is reimplemented.
 * - Only *data* is stubbed:
 *     * FirebaseService._cache.{currentUser, rolePermissions,
 *       roleActivityCapabilities, currentUserPermissionGrant, customRoles}
 *       are pure data inputs.
 *     * ApiService.getAdminUsers / getTeams / getEvents /
 *       getRegistrationHistoryByEventUser are NOT stubbed here; the tested
 *       helpers do not call them, and js/api-service.js is loaded as-is.
 * - Minimal browser globals (document, window, localStorage, sessionStorage,
 *   navigator, location, history, firebase, ScriptLoader, fetch, ...) are
 *   provided as empty/false-ish stubs so legacy modules parse without
 *   throwing. These do not participate in any logic used by the tested
 *   helpers:
 *     - document.*: only touched by unrelated render helpers not called here.
 *     - window/localStorage/sessionStorage: only read by URL-filter helpers.
 *     - firebase: only used by deferred network paths not exercised here.
 *     - ScriptLoader: only used by openActivityMapEntry (not exercised).
 *     - navigator.share/clipboard: only used by shareCurrentActivityUrl.
 *     - fetch/alert/confirm/prompt: only used by write paths not exercised.
 *
 * Write fixture only when B_ORACLE_WRITE=1.
 * Default output: tests/unit/b-oracle/out/operate-oracle.json
 *
 * Stubs are listed above; no tested path is replaced.
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
  'js/modules/event/event-list-helpers.js',
];

const ALL_CAP_CODES = [
  'user.activity.basic_create',
  'user.activity.external_create',
  'user.activity.own_manage_entry',
  'user.activity.own_edit_basic',
  'user.activity.own_cancel',
  'user.activity.site_operate',
  'user.activity.delegate_assign',
  'user.activity.addons_use',
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
    roleActivityCapabilities: { user: [] },
    currentUserPermissionGrant: null,
    customRoles: [],
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
    + ' } catch (_) {'
    + '   globalThis.__FC_APP__ = globalThis.App || null;'
    + ' }'
    + '})();\n';

  vm.runInContext(combined, context, { filename: 'fc-operate-bundle.js' });

  return {
    context,
    app: context.__FC_APP__ || context.App,
    cache,
  };
}

const TEAM_STAFF_MODES = ['none', 'captain', 'leader', 'coach', 'member'];

/** 照 A `_isCurrentUserTeamStaff`：captainUid／leaderUids（或 leaderUid）／coachUids 任一含本人。 */
function buildTeams(mode, uid) {
  const team = { id: 't1', name: 'Team 1', captainUid: 'other-captain', leaderUids: [], coachUids: [] };
  if (mode === 'none') return [];
  if (mode === 'captain') team.captainUid = uid;
  if (mode === 'leader') team.leaderUids = [uid];
  if (mode === 'coach') team.coachUids = [uid];
  return [team];
}

function buildEvent(relation, uid, status) {
  let creatorUid;
  let delegateUids;

  if (relation === 'owner') {
    // Even when uid === 'unknown', creatorUid is 'unknown' so that
    // _isEventOwner's guard (myUid === 'unknown' -> false) is exercised.
    creatorUid = uid;
    delegateUids = [];
  } else if (relation === 'delegate') {
    creatorUid = 'other-owner-uid';
    delegateUids = [uid];
  } else {
    creatorUid = 'other-owner-uid';
    delegateUids = ['other-delegate-uid'];
  }

  return {
    id: 'e1',
    creatorUid,
    ownerUid: null,
    captainUid: null,
    delegateUids,
    status,
    privateEvent: false,
    teamOnly: false,
    blockedUids: [],
  };
}

function applyRolePermissions(cache, role, mode) {
  const perms = cache.rolePermissions || {};
  delete perms[role];

  switch (mode) {
    case 'absent':
      cache.rolePermissions = perms;
      return;
    case 'empty':
      perms[role] = [];
      cache.rolePermissions = perms;
      return;
    case 'with-codes':
      perms[role] = [
        'event.edit_self',
        'event.delete_self',
        'event.scan',
        'event.manual_checkin',
        'event.edit_all',
        'activity.manage.entry',
        'team.toggle_event_visibility',
        'admin.repair.event_blocklist',
      ];
      cache.rolePermissions = perms;
      return;
    default:
      throw new Error(`bad rolePermissions mode: ${mode}`);
  }
}

function applyUserGrant(cache, uid, mode) {
  switch (mode) {
    case 'absent':
      cache.currentUserPermissionGrant = null;
      return;
    case 'valid-edit':
      cache.currentUserPermissionGrant = {
        uid,
        enabled: true,
        permissions: ['event.edit_self'],
      };
      return;
    case 'valid-multi':
      cache.currentUserPermissionGrant = {
        uid,
        enabled: true,
        permissions: [
          'event.edit_self',
          'event.delete_self',
          'event.scan',
          'event.manual_checkin',
          'activity.manage.entry',
        ],
      };
      return;
    case 'disabled':
      cache.currentUserPermissionGrant = {
        uid,
        enabled: false,
        permissions: ['event.edit_self', 'event.delete_self', 'event.scan'],
      };
      return;
    default:
      throw new Error(`bad userGrant mode: ${mode}`);
  }
}

function applyCapabilities(cache, mode) {
  switch (mode) {
    case 'empty':
      cache.roleActivityCapabilities = { user: [] };
      return;
    case 'partial':
      cache.roleActivityCapabilities = {
        user: ['user.activity.own_edit_basic', 'user.activity.own_cancel'],
      };
      return;
    case 'all':
      cache.roleActivityCapabilities = { user: ALL_CAP_CODES.slice() };
      return;
    default:
      throw new Error(`bad capabilities mode: ${mode}`);
  }
}

describe('B oracle: activity operate fixture', () => {
  test('generates deterministic operate oracle cases from FC real functions', () => {
    const { app, cache } = createFcSandbox();

    const roles = [
      'user',
      'coach',
      'captain',
      'venue_owner',
      'admin',
      'super_admin',
    ];
    const rolePermModes = ['absent', 'empty', 'with-codes'];
    const userGrantModes = ['absent', 'valid-edit', 'valid-multi', 'disabled'];
    const capModes = ['empty', 'partial', 'all'];
    const relations = ['owner', 'delegate', 'neither'];
    const statuses = ['open', 'full', 'ended', 'cancelled'];
    const uidVariants = [
      { key: 'normal', uid: 'u1' },
      { key: 'unknown', uid: 'unknown' },
    ];

    const cases = [];
    let index = 0;

    for (const uidVar of uidVariants) {
      for (const role of roles) {
        for (const rpMode of rolePermModes) {
          for (const ugMode of userGrantModes) {
            for (const capMode of capModes) {
              // Rotate relation and status so each (role, rp, ug, cap) cell
              // still hits every relation and every status across the sweep.
              const relation = relations[index % relations.length];
              const status = statuses[index % statuses.length];
              const uid = uidVar.uid;

              const event = buildEvent(relation, uid, status);
              // T-005b（M-089）：俱樂部限定活動變體＋幹部身分輪替，供公開切換 helper 對照。
              const teamStaffMode = TEAM_STAFF_MODES[Math.floor(index / 4) % TEAM_STAFF_MODES.length];
              const teamEvent = { ...event, teamOnly: true, creatorTeamId: 't1', creatorTeamIds: ['t1'] };
              const teams = buildTeams(teamStaffMode, uid);

              cache.currentUser = { uid, role };
              applyRolePermissions(cache, role, rpMode);
              applyUserGrant(cache, uid, ugMode);
              applyCapabilities(cache, capMode);
              cache.customRoles = [];
              cache.teams = teams;
              app.currentRole = role;

              const capabilitiesExpected = {};
              for (const code of ALL_CAP_CODES) {
                capabilitiesExpected[code] = !!app._hasUserActivityCapability(code);
              }

              const expected = {
                canEditOwnActivityBasic: app._canEditOwnActivityBasic(event),
                canCancelOwnActivity: app._canCancelOwnActivity(event),
                canReopenOrRelistActivity: app._canReopenOrRelistActivity(event),
                canDeleteActivity: app._canDeleteActivity(event),
                canOperateEventSite: app._canOperateEventSite(event),
                canRemoveConfirmedParticipant: app._canRemoveConfirmedParticipant(event),
                hasActivityManageEntry: app._hasActivityManageEntry(),
                canManageEvent: app._canManageEvent(event),
                canViewEventOperationLog: app._canViewEventOperationLog(event),
                canManageTeamOnlyVisibility: app._canManageTeamOnlyVisibility(teamEvent),
                capabilities: capabilitiesExpected,
              };

              const input = {
                role,
                uid,
                rolePermissions: rpMode === 'absent' ? null : (cache.rolePermissions[role] || []).slice(),
                userGrants: cache.currentUserPermissionGrant
                  ? {
                    uid: cache.currentUserPermissionGrant.uid,
                    enabled: cache.currentUserPermissionGrant.enabled,
                    permissions: Array.isArray(cache.currentUserPermissionGrant.permissions)
                      ? cache.currentUserPermissionGrant.permissions.slice()
                      : [],
                  }
                  : null,
                capabilities: Array.isArray(cache.roleActivityCapabilities.user)
                  ? cache.roleActivityCapabilities.user.slice()
                  : [],
                customRoles: [],
                event,
                teamEvent,
                teams,
              };

              cases.push({
                id: `case-${String(index + 1).padStart(4, '0')}`,
                input,
                expected,
              });

              index += 1;
            }
          }
        }
      }
    }

    // T-005b（M-089）：主 sweep 的身分組合分不出兩個新 helper 的差異（432 案全同），
    // 另建一組聚焦 user／coach × 附加功能能力 × team.* 授權 × 幹部身分 × 私密的案例。
    const teamVisibilityCases = [];
    const tvGrants = [null, ['team.toggle_event_visibility'], ['team.create_event']];
    const tvCaps = [[], ['user.activity.addons_use'], ['user.activity.own_manage_entry']];
    let tvIndex = 0;
    for (const role of ['user', 'coach']) {
      for (const caps of tvCaps) {
        for (const grantCodes of tvGrants) {
          for (const relation of relations) {
            for (const teamStaffMode of TEAM_STAFF_MODES) {
              for (const privateEvent of [false, true]) {
                const uid = 'u1';
                const event = { ...buildEvent(relation, uid, 'open'), privateEvent };
                const teamEvent = { ...event, teamOnly: true, creatorTeamId: 't1', creatorTeamIds: ['t1'] };
                const teams = buildTeams(teamStaffMode, uid);
                cache.currentUser = { uid, role };
                cache.rolePermissions = {};
                cache.currentUserPermissionGrant = grantCodes
                  ? { uid, enabled: true, permissions: grantCodes.slice() }
                  : null;
                cache.roleActivityCapabilities = { user: caps.slice() };
                cache.customRoles = [];
                cache.teams = teams;
                app.currentRole = role;
                teamVisibilityCases.push({
                  id: `team-${String(tvIndex + 1).padStart(4, '0')}`,
                  input: {
                    role,
                    uid,
                    rolePermissions: null,
                    userGrants: cache.currentUserPermissionGrant
                      ? { ...cache.currentUserPermissionGrant, permissions: grantCodes.slice() }
                      : null,
                    capabilities: caps.slice(),
                    customRoles: [],
                    event,
                    teamEvent,
                    teams,
                  },
                  expected: {
                    canViewEventOperationLog: app._canViewEventOperationLog(event),
                    canManageTeamOnlyVisibility: app._canManageTeamOnlyVisibility(teamEvent),
                    canManageTeamOnlyVisibilityNonTeamEvent: app._canManageTeamOnlyVisibility(event),
                  },
                });
                tvIndex += 1;
              }
            }
          }
        }
      }
    }

    const meta = {
      generatedAt: new Date().toISOString(),
      fcHead: getGitHead(),
      sources: SOURCE_PATHS.map(rel => ({
        path: rel,
        sha256: sha256File(path.join(root, rel)),
      })),
      caseCount: cases.length,
      teamVisibilityCaseCount: teamVisibilityCases.length,
    };

    if (process.env.B_ORACLE_WRITE === '1') {
      const outPath = process.env.B_ORACLE_OUT
        ? path.resolve(process.cwd(), process.env.B_ORACLE_OUT)
        : path.join(root, 'tests/unit/b-oracle/out/operate-oracle.json');

      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(
        outPath,
        `${JSON.stringify({ meta, cases, teamVisibilityCases }, null, 2)}\n`,
        'utf8'
      );
    }

    // Smoke assertions — must fire only after successful run.
    expect(cases.length).toBeGreaterThanOrEqual(400);
    expect(meta.caseCount).toBe(cases.length);
    for (const field of ['canViewEventOperationLog', 'canManageTeamOnlyVisibility']) {
      const values = new Set(teamVisibilityCases.map(c => c.expected[field]));
      expect(values.has(true)).toBe(true);
      expect(values.has(false)).toBe(true);
    }
    expect(teamVisibilityCases.some(c =>
      c.expected.canViewEventOperationLog !== c.expected.canManageTeamOnlyVisibility)).toBe(true);

    const boolFields = [
      'canEditOwnActivityBasic',
      'canCancelOwnActivity',
      'canReopenOrRelistActivity',
      'canDeleteActivity',
      'canOperateEventSite',
      'canRemoveConfirmedParticipant',
      'hasActivityManageEntry',
      'canManageEvent',
      'canViewEventOperationLog',
      'canManageTeamOnlyVisibility',
    ];

    for (const c of cases) {
      for (const field of boolFields) {
        expect(typeof c.expected[field]).toBe('boolean');
      }
      expect(c.expected.capabilities).toBeTruthy();
      for (const code of ALL_CAP_CODES) {
        expect(typeof c.expected.capabilities[code]).toBe('boolean');
      }
    }

    for (const field of boolFields) {
      const values = new Set(cases.map(c => c.expected[field]));
      expect(values.has(true)).toBe(true);
      expect(values.has(false)).toBe(true);
    }

    for (const code of ALL_CAP_CODES) {
      const values = new Set(cases.map(c => c.expected.capabilities[code]));
      expect(values.has(true)).toBe(true);
      expect(values.has(false)).toBe(true);
    }
  });
});
