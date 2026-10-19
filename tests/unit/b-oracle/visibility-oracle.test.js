/**
 * FC (A version) visibility oracle fixture generator.
 *
 * IMPORTANT (R-ID-002 guard):
 * - A's _getVisibleTeamIdsForLimitedEvents() may supplement team ids from
 *   ApiService.getAdminUsers() by comparing uid OR name.
 * - B does not port name-based adminUsers matching (R-ID-002 violation).
 * - In this oracle, adminUsers is stubbed as [{ uid }] only: no name field,
 *   and no teamIds/teamId fields. Therefore adminUsers cannot cause expected
 *   values to depend on name matching.
 *
 * Write fixture only when B_ORACLE_WRITE=1.
 * Default output: tests/unit/b-oracle/out/visibility-oracle.json
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
  'js/modules/event/event-blocklist.js',
  'js/modules/event/event-list-helpers.js',
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
    adminUsers: [],
    teams: [],
    events: [],
    registrations: [],
    rolePermissions: {
      user: [],
      coach: [],
      captain: [],
      venue_owner: [],
      admin: ['event.edit_all'],
      super_admin: ['event.edit_all'],
    },
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
    ApiService: {
      getCurrentUser: jest.fn(() => cache.currentUser),
      getAdminUsers: jest.fn(() => cache.adminUsers || []),
      getTeams: jest.fn(() => cache.teams || []),
      getEvents: jest.fn(() => cache.events || []),
      getRegistrationHistoryByEventUser: jest.fn((eventId, uid) => (
        (cache.registrations || []).filter(r => r.eventId === eventId && r.uid === uid)
      )),
      getRolePermissions: jest.fn(role => cache.rolePermissions[role] || []),
      hasRoleActivityCapability: jest.fn(() => false),
      getTeam: jest.fn(() => null),
    },
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

  vm.runInContext(combined, context, { filename: 'fc-visibility-bundle.js' });

  return {
    context,
    app: context.__FC_APP__ || context.App,
    cache,
  };
}

function buildUserDoc(viewer, role, shape) {
  if (!viewer.uid) return null;

  const doc = { uid: viewer.uid, role };

  if (shape === 'teamIds') {
    doc.teamIds = ['t1', 't9'];
  } else if (shape === 'teamId') {
    doc.teamId = 't1';
  }

  return doc;
}

function buildTeam(shape, viewerUid) {
  const uid = viewerUid || 'guest-viewer';
  const other = 'other-uid';

  switch (shape) {
    case 0:
      return { id: 't1', captainUid: uid, coachUids: [] };
    case 1:
      return { id: 't1', captainUid: other, leaderUids: [uid], coachUids: [] };
    case 2:
      return { id: 't1', captainUid: other, leaderUid: uid, coachUids: [] };
    case 3:
      return {
        id: 't1',
        captainUid: other,
        leaderUids: [uid],
        leaderUid: 'different-uid',
        coachUids: [uid],
      };
    case 4:
      return { id: 't1', captainUid: other, coachUids: [uid] };
    default:
      throw new Error(`bad team shape: ${shape}`);
  }
}

function buildEvent(scenario, viewerUid) {
  const blockedUid = viewerUid || 'some-other-uid';

  const event = {
    id: 'e1',
    blockedUids: [],
    privateEvent: false,
    teamOnly: false,
    creatorTeamIds: [],
    creatorTeamId: null,
    isPublic: true,
    creatorUid: 'other-owner',
    ownerUid: null,
    captainUid: null,
    delegateUids: [],
  };

  switch (scenario) {
    case 0:
      return event;

    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
      return { ...event, blockedUids: [blockedUid] };

    case 6:
      return {
        ...event,
        privateEvent: true,
        creatorUid: viewerUid || 'guest-owner',
      };

    case 7:
      return {
        ...event,
        privateEvent: true,
        delegateUids: [viewerUid || 'guest-delegate'],
      };

    case 8:
      return {
        ...event,
        privateEvent: true,
        creatorUid: 'other-owner',
        delegateUids: ['other-delegate'],
      };

    case 9:
      return {
        ...event,
        teamOnly: true,
        creatorTeamIds: ['t1'],
        isPublic: false,
      };

    case 10:
      return {
        ...event,
        teamOnly: true,
        creatorTeamIds: ['t2'],
        isPublic: false,
      };

    case 11:
      return {
        ...event,
        teamOnly: true,
        creatorTeamIds: ['t2'],
        isPublic: true,
      };

    default:
      throw new Error(`bad scenario: ${scenario}`);
  }
}

function buildRegistrations(scenario, viewerUid) {
  const uid = viewerUid || 'guest-viewer';

  switch (scenario) {
    case 2:
      return [{ eventId: 'e1', uid, status: 'confirmed' }];
    case 3:
      return [{ eventId: 'e1', uid, status: 'cancelled' }];
    case 4:
      return [{ eventId: 'e1', uid, status: 'removed' }];
    case 5:
      return [{ eventId: 'e1', uid: 'other-registration-uid', status: 'confirmed' }];
    default:
      return [];
  }
}

describe('B oracle: activity visibility fixture', () => {
  test('generates deterministic visibility oracle cases from FC real functions', () => {
    const { app, cache } = createFcSandbox();

    const viewerDefs = [
      { key: 'guest', uid: null, currentUser: null, shapes: ['none'] },
      { key: 'normal', uid: 'u1', currentUser: { uid: 'u1' }, shapes: ['teamIds', 'teamId', 'none'] },
      { key: 'unknown', uid: 'unknown', currentUser: { uid: 'unknown' }, shapes: ['teamIds', 'teamId', 'none'] },
      { key: 'whitespace', uid: ' u1 ', currentUser: { uid: ' u1 ' }, shapes: ['teamIds', 'teamId', 'none'] },
    ];

    const roles = [
      'user',
      'coach',
      'captain',
      'venue_owner',
      'admin',
      'super_admin',
    ];

    const teamShapes = [0, 1, 2, 3, 4];

    const cases = [];
    let index = 0;

    for (const viewer of viewerDefs) {
      for (const shape of viewer.shapes) {
        for (const role of roles) {
          for (const teamShape of teamShapes) {
            const scenario = index % 12;

            const userDoc = buildUserDoc(viewer, role, shape);
            const team = buildTeam(teamShape, viewer.uid);
            const event = buildEvent(scenario, viewer.uid);
            const viewerRegistrations = buildRegistrations(scenario, viewer.uid);

            const input = {
              viewer: { uid: viewer.uid },
              role,
              userDoc,
              teams: [team],
              event,
              viewerRegistrations,
            };

            cache.currentUser = userDoc;
            // R-ID-002 guard: uid only, no name, no teamIds/teamId.
            cache.adminUsers = [{ uid: viewer.uid || 'guest-viewer' }];
            cache.teams = input.teams;
            cache.events = [event];
            cache.registrations = viewerRegistrations;

            app.currentRole = role;

            const isEventVisibleToUser = app._isEventVisibleToUser(event, viewer.uid);
            const visibleTeamIds = Array.from(app._getVisibleTeamIdsForLimitedEvents()).sort();
            const canListPrivateEvent = app._canListPrivateEvent(event);

            const visibleEvents = app._getVisibleEvents();
            const visibleInList = visibleEvents.length === 1
              && visibleEvents[0].id === event.id;

            cases.push({
              id: `case-${String(index + 1).padStart(3, '0')}`,
              input,
              expected: {
                isEventVisibleToUser,
                visibleTeamIds,
                canListPrivateEvent,
                visibleInList,
              },
            });

            index += 1;
          }
        }
      }
    }

    // 2026-10-19 Fable：A 的 _canListPrivateEvent 以 ROLE_LEVEL_MAP[roleKey] || 0 判斷，不解析自訂角色 level；
    // B 照 A。以兩案鎖住：排在 admin 之後的自訂角色看不到他人私密活動，但仍看得到自己的。
    const customRoles = [{ key: 'custom_vip', label: 'VIP', afterRole: 'admin' }];
    app._getCustomRoles = () => customRoles;
    const normalViewer = viewerDefs.find(viewer => viewer.key === 'normal');
    for (const scenario of [8, 6]) {
      const role = 'custom_vip';
      const userDoc = buildUserDoc(normalViewer, role, 'teamIds');
      const team = buildTeam(0, normalViewer.uid);
      const event = buildEvent(scenario, normalViewer.uid);
      const input = {
        viewer: { uid: normalViewer.uid },
        role,
        customRoles,
        userDoc,
        teams: [team],
        event,
        viewerRegistrations: [],
      };

      cache.currentUser = userDoc;
      cache.adminUsers = [{ uid: normalViewer.uid }];
      cache.teams = input.teams;
      cache.events = [event];
      cache.registrations = [];
      app.currentRole = role;

      const visibleEvents = app._getVisibleEvents();
      cases.push({
        id: `case-${String(index + 1).padStart(3, '0')}`,
        input,
        expected: {
          isEventVisibleToUser: app._isEventVisibleToUser(event, normalViewer.uid),
          visibleTeamIds: Array.from(app._getVisibleTeamIdsForLimitedEvents()).sort(),
          canListPrivateEvent: app._canListPrivateEvent(event),
          visibleInList: visibleEvents.length === 1 && visibleEvents[0].id === event.id,
        },
      });
      index += 1;
    }
    delete app._getCustomRoles;

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
        : path.join(root, 'tests/unit/b-oracle/out/visibility-oracle.json');

      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(
        outPath,
        `${JSON.stringify({ meta, cases }, null, 2)}\n`,
        'utf8'
      );
    }

    expect(cases.length).toBeGreaterThanOrEqual(300);
    expect(meta.caseCount).toBe(cases.length);

    for (const c of cases) {
      expect(typeof c.expected.isEventVisibleToUser).toBe('boolean');
      expect(Array.isArray(c.expected.visibleTeamIds)).toBe(true);
      expect(typeof c.expected.canListPrivateEvent).toBe('boolean');
      expect(typeof c.expected.visibleInList).toBe('boolean');

      for (const teamId of c.expected.visibleTeamIds) {
        expect(typeof teamId).toBe('string');
      }
    }
  });
});
