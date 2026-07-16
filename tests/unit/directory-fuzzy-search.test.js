const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '../..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function loadServices() {
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
  };
  vm.createContext(sandbox);
  vm.runInContext(
    `${readProjectFile('js/firebase-service.js')}\nglobalThis.FirebaseService = FirebaseService;`,
    sandbox,
    { filename: 'js/firebase-service.js' }
  );
  vm.runInContext(
    `${readProjectFile('js/api-service.js')}\nglobalThis.ApiService = ApiService;`,
    sandbox,
    { filename: 'js/api-service.js' }
  );
  return sandbox;
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

function loadUiModule(file, html, App, ApiService) {
  const dom = new JSDOM(html, { url: 'https://example.test/' });
  const sandbox = {
    App,
    ApiService,
    document: dom.window.document,
    window: dom.window,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    escapeHTML,
    ROLES: {},
    console,
    setTimeout,
    clearTimeout,
    Promise,
    Date,
    Math,
    String,
    Number,
    Array,
    Object,
    Map,
    Set,
  };
  vm.createContext(sandbox);
  vm.runInContext(readProjectFile(file), sandbox, { filename: file });
  return dom;
}

describe('on-demand user and team directories', () => {
  test('user directory shares one in-flight read and refreshes the cache', async () => {
    const sandbox = loadServices();
    const service = sandbox.FirebaseService;
    let resolveSnapshot;
    const get = jest.fn(() => new Promise(resolve => { resolveSnapshot = resolve; }));

    sandbox.auth = { currentUser: { uid: 'viewer' } };
    sandbox.db = { collection: jest.fn(() => ({ get })) };
    service._initialized = true;
    service._cache.adminUsers = [];
    service._lazyLoaded = {};
    service._collectionLoadedAt = {};
    service._syncCurrentUserFromUsersSnapshot = jest.fn();
    service._debouncedPersistCache = jest.fn();

    const first = service.ensureAdminUsersReady();
    const second = service.ensureAdminUsersReady();

    expect(get).toHaveBeenCalledTimes(1);
    resolveSnapshot({
      docs: [{
        id: 'user-1',
        data: () => ({ displayName: '\u6797\u653f\u7a4e', role: 'member' }),
      }],
    });

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(service._cache.adminUsers[0]).toMatchObject({
      uid: 'user-1',
      name: '\u6797\u653f\u7a4e',
      _docId: 'user-1',
    });
    expect(service._lazyLoaded.adminUsers).toBe(true);
    expect(service._debouncedPersistCache).toHaveBeenCalledTimes(1);
  });

  test('user directory does not write a response after the signed-in user changes', async () => {
    const sandbox = loadServices();
    const service = sandbox.FirebaseService;
    let resolveSnapshot;
    const get = jest.fn(() => new Promise(resolve => { resolveSnapshot = resolve; }));
    const originalCache = [{ uid: 'cached-user', name: 'Cached' }];

    sandbox.auth = { currentUser: { uid: 'viewer-a' } };
    sandbox.db = { collection: jest.fn(() => ({ get })) };
    service._initialized = true;
    service._cache.adminUsers = originalCache;
    service._lazyLoaded = {};
    service._collectionLoadedAt = {};
    service._debouncedPersistCache = jest.fn();

    const pending = service.ensureAdminUsersReady();
    sandbox.auth.currentUser = { uid: 'viewer-b' };
    resolveSnapshot({ docs: [{ id: 'new-user', data: () => ({ name: 'New' }) }] });

    await expect(pending).resolves.toBe(false);
    expect(service._cache.adminUsers).toBe(originalCache);
    expect(service._adminUsersLoadPromise).toBeNull();
  });

  test('cached user directory hydrates preview without becoming fresh', async () => {
    const sandbox = loadServices();
    const service = sandbox.FirebaseService;

    sandbox.auth = { currentUser: { uid: 'viewer' } };
    sandbox.db = {
      collection: jest.fn(() => ({
        get: jest.fn(async () => ({
          metadata: { fromCache: true },
          docs: [{ id: 'cached-user', data: () => ({ name: 'Cached User' }) }],
        })),
      })),
    };
    service._initialized = true;
    service._cache.adminUsers = [];
    service._lazyLoaded = {};
    service._collectionLoadedAt = {};
    service._syncCurrentUserFromUsersSnapshot = jest.fn();
    service._debouncedPersistCache = jest.fn();

    await expect(service.ensureAdminUsersReady()).resolves.toBe(false);
    expect(service._cache.adminUsers[0]).toMatchObject({ uid: 'cached-user', name: 'Cached User' });
    expect(service._lazyLoaded.adminUsers).not.toBe(true);
  });

  test('cached user directory never shrinks a more complete existing cache', async () => {
    const sandbox = loadServices();
    const service = sandbox.FirebaseService;
    const snapshots = [
      {
        metadata: { fromCache: true },
        docs: [{ id: 'user-1', data: () => ({ name: 'Updated User 1' }) }],
      },
      {
        metadata: { fromCache: true },
        docs: [],
      },
    ];

    sandbox.auth = { currentUser: { uid: 'viewer' } };
    sandbox.db = {
      collection: jest.fn(() => ({
        get: jest.fn(async () => snapshots.shift()),
      })),
    };
    service._initialized = true;
    service._cache.adminUsers = [
      { uid: 'user-1', name: 'User 1' },
      { uid: 'user-2', name: 'User 2' },
    ];
    service._lazyLoaded = {};
    service._collectionLoadedAt = {};
    service._syncCurrentUserFromUsersSnapshot = jest.fn();
    service._debouncedPersistCache = jest.fn();

    await expect(service.ensureAdminUsersReady()).resolves.toBe(false);
    expect(service._cache.adminUsers).toEqual(expect.arrayContaining([
      expect.objectContaining({ uid: 'user-1', name: 'Updated User 1' }),
      expect.objectContaining({ uid: 'user-2', name: 'User 2' }),
    ]));

    await expect(service.ensureAdminUsersReady()).resolves.toBe(false);
    expect(service._cache.adminUsers).toHaveLength(2);
    expect(service._lazyLoaded.adminUsers).not.toBe(true);
  });

  test('user directory does not write after the service lifecycle ends', async () => {
    const sandbox = loadServices();
    const service = sandbox.FirebaseService;
    let resolveSnapshot;
    const originalCache = [{ uid: 'cached-user', name: 'Cached' }];

    sandbox.auth = { currentUser: { uid: 'viewer' } };
    sandbox.db = {
      collection: jest.fn(() => ({
        get: jest.fn(() => new Promise(resolve => { resolveSnapshot = resolve; })),
      })),
    };
    service._initialized = true;
    service._cache.adminUsers = originalCache;
    service._lazyLoaded = {};
    service._collectionLoadedAt = {};
    service._debouncedPersistCache = jest.fn();

    const pending = service.ensureAdminUsersReady();
    service._initialized = false;
    resolveSnapshot({
      metadata: { fromCache: false },
      docs: [{ id: 'new-user', data: () => ({ name: 'New User' }) }],
    });

    await expect(pending).resolves.toBe(false);
    expect(service._cache.adminUsers).toBe(originalCache);
  });
  test('team directory loads beyond 50, shares one read, and respects refresh controls', async () => {
    const sandbox = loadServices();
    const { ApiService, FirebaseService } = sandbox;
    const snapshot = {
      metadata: { fromCache: false },
      docs: Array.from({ length: 51 }, (_, index) => ({
        id: `team-doc-${index + 1}`,
        data: () => ({
          ...(index === 50 ? {} : { id: `team-${index + 1}` }),
          name: index === 50 ? 'Legacy Club' : `Club ${index + 1}`,
          active: true,
        }),
      })),
    };
    const get = jest.fn(async () => snapshot);

    sandbox.db = { collection: jest.fn(() => ({ get })) };
    FirebaseService._initialized = true;
    FirebaseService._lazyLoaded = {};
    FirebaseService._collectionLoadedAt = {};
    FirebaseService._teamDirectoryCache = [];
    FirebaseService._teamDirectoryHasSnapshot = false;
    FirebaseService._teamDirectoryLoadPromise = null;
    ApiService._teamsReadyPromise = null;

    const first = ApiService.ensureTeamsReady();
    const second = ApiService.ensureTeamsReady();

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(ApiService.getTeamDirectory()).toHaveLength(51);
    expect(ApiService.getTeamDirectory().some(team => team.name === 'Legacy Club')).toBe(true);
    expect(ApiService.getTeamDirectory().find(team => team.name === 'Legacy Club')?.id).toBe('team-doc-51');

    await expect(ApiService.ensureTeamsReady()).resolves.toBe(true);
    expect(get).toHaveBeenCalledTimes(1);
    await expect(ApiService.ensureTeamsReady({ force: true })).resolves.toBe(true);
    expect(get).toHaveBeenCalledTimes(2);
    expect(ApiService._teamsReadyPromise).toBeNull();
  });

  test('cached team directory remains preview-only and retries server loading', async () => {
    const sandbox = loadServices();
    const { ApiService, FirebaseService } = sandbox;
    const previewTeams = [{ id: 'preview-team', name: 'Preview Team' }];
    const snapshots = [
      {
        metadata: { fromCache: true },
        docs: [{ id: 'cached-team-doc', data: () => ({ id: 'cached-team', name: 'Cached Team' }) }],
      },
      {
        metadata: { fromCache: true },
        docs: [],
      },
    ];
    const get = jest.fn(async () => snapshots.shift());

    sandbox.db = { collection: jest.fn(() => ({ get })) };
    FirebaseService._initialized = true;
    FirebaseService._cache.teams = previewTeams;
    FirebaseService._lazyLoaded = {};
    FirebaseService._collectionLoadedAt = {};
    FirebaseService._teamDirectoryCache = [];
    FirebaseService._teamDirectoryHasSnapshot = false;
    ApiService._teamsReadyPromise = null;

    await expect(ApiService.ensureTeamsReady()).resolves.toBe(false);
    expect(ApiService.getTeams()).toBe(previewTeams);
    expect(ApiService.getTeamDirectory()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'preview-team', name: 'Preview Team' }),
      expect.objectContaining({ id: 'cached-team', name: 'Cached Team' }),
    ]));
    expect(FirebaseService._lazyLoaded.teamDirectory).not.toBe(true);

    await expect(ApiService.ensureTeamsReady()).resolves.toBe(false);
    expect(get).toHaveBeenCalledTimes(2);
    expect(ApiService.getTeamDirectory()).toHaveLength(2);
  });
});

describe('cache-first fuzzy search refresh', () => {
  test('activity delegate search renders cached matches immediately, then refreshes them', async () => {
    let users = [{ uid: 'user-old', name: '\u653f\u7a4e', role: 'member' }];
    let finish;
    const loading = new Promise(resolve => {
      finish = () => {
        users = [{ uid: 'user-new', name: '\u6797\u653f\u7a4e', role: 'member' }];
        resolve(true);
      };
    });
    const App = {
      _canManageEventDelegates: () => true,
      _canManageCourseLinkedEventDelegates: () => false,
      _getEventCreatorUid: () => 'viewer',
      _formatUidForDisplay: uid => uid,
    };
    const ApiService = {
      getCurrentUser: () => ({ uid: 'viewer' }),
      getAdminUsers: () => users,
      ensureAdminUsersReady: jest.fn(() => loading),
    };
    const dom = loadUiModule(
      'js/modules/event/event-create-delegates.js',
      '<div id="create-event-modal" class="open"></div><input id="ce-delegate-search" value="\u653f"><div id="ce-delegate-dropdown"></div><div id="ce-delegate-tags"></div>',
      App,
      ApiService
    );

    const pending = App._searchDelegates('\u653f');
    expect(dom.window.document.getElementById('ce-delegate-dropdown').textContent).toContain('\u653f\u7a4e');

    finish();
    await pending;
    expect(dom.window.document.getElementById('ce-delegate-dropdown').textContent).toContain('\u6797\u653f\u7a4e');
    expect(ApiService.ensureAdminUsersReady).toHaveBeenCalledTimes(1);
    dom.window.close();
  });

  test('activity delegate search ignores an older response after the query changes', async () => {
    let users = [];
    let finish;
    const loading = new Promise(resolve => {
      finish = () => {
        users = [
          { uid: 'user-wang', name: '\u738b\u5c0f\u660e', role: 'member' },
          { uid: 'user-lin', name: '\u6797\u653f\u7a4e', role: 'member' },
        ];
        resolve(true);
      };
    });
    const App = {
      _canManageEventDelegates: () => true,
      _canManageCourseLinkedEventDelegates: () => false,
      _getEventCreatorUid: () => 'viewer',
      _formatUidForDisplay: uid => uid,
    };
    const ApiService = {
      getCurrentUser: () => ({ uid: 'viewer' }),
      getAdminUsers: () => users,
      ensureAdminUsersReady: jest.fn(() => loading),
    };
    const dom = loadUiModule(
      'js/modules/event/event-create-delegates.js',
      '<div id="create-event-modal" class="open"></div><input id="ce-delegate-search" value="\u653f"><div id="ce-delegate-dropdown"></div><div id="ce-delegate-tags"></div>',
      App,
      ApiService
    );
    const input = dom.window.document.getElementById('ce-delegate-search');
    const dropdown = dom.window.document.getElementById('ce-delegate-dropdown');

    const older = App._searchDelegates('\u653f');
    expect(dropdown.textContent).toContain('\u8f09\u5165');
    input.value = '\u738b';
    const newer = App._searchDelegates('\u738b');

    finish();
    await Promise.all([older, newer]);
    expect(dropdown.textContent).toContain('\u738b\u5c0f\u660e');
    expect(dropdown.textContent).not.toContain('\u6797\u653f\u7a4e');
    dom.window.close();
  });

  test('tournament referee search refreshes a cold user directory', async () => {
    let users = [];
    let finish;
    const loading = new Promise(resolve => {
      finish = () => {
        users = [{ uid: 'ref-1', name: '\u6797\u653f\u7a4e', role: 'member' }];
        resolve(true);
      };
    });
    const App = {
      _tournamentFormState: {
        personSearchBound: {},
        delegates: [],
        referees: [],
        refereeHeads: [],
      },
      _formatUidForDisplay: uid => uid,
    };
    const ApiService = {
      getAdminUsers: () => users,
      ensureAdminUsersReady: jest.fn(() => loading),
    };
    const dom = loadUiModule(
      'js/modules/tournament/tournament-manage-people.js',
      '<div id="tournament-form-modal" class="open"></div><input id="tf-referee-search" value="\u653f"><div id="tf-referee-dropdown"></div>',
      App,
      ApiService
    );
    const dropdown = dom.window.document.getElementById('tf-referee-dropdown');

    const pending = App._searchTournamentPeople('\u653f', 'referee', 'tf');
    expect(dropdown.textContent).toContain('\u8f09\u5165');
    finish();
    await pending;

    expect(dropdown.textContent).toContain('\u6797\u653f\u7a4e');
    dom.window.close();
  });

  test('message team search refreshes a cold team directory', async () => {
    let teams = [];
    let finish;
    const loading = new Promise(resolve => {
      finish = () => {
        teams = [{ id: 'team-1', name: '\u53f0\u4e2d\u8db3\u7403\u4ff1\u6a02\u90e8', active: true }];
        resolve(true);
      };
    });
    const App = {};
    const ApiService = {
      getTeams: () => teams,
      ensureTeamsReady: jest.fn(() => loading),
    };
    const dom = loadUiModule(
      'js/modules/message/message-admin-compose.js',
      '<div id="msg-compose" style="display:flex"></div><select id="msg-target"><option value="team" selected>team</option></select><input id="msg-team-target" value="\u53f0\u4e2d"><div id="msg-team-dropdown"></div><div id="msg-team-result"></div>',
      App,
      ApiService
    );
    const dropdown = dom.window.document.getElementById('msg-team-dropdown');

    const pending = App.searchMsgTeam();
    expect(dropdown.textContent).toContain('\u8f09\u5165');
    finish();
    await pending;

    expect(dropdown.textContent).toContain('\u53f0\u4e2d\u8db3\u7403\u4ff1\u6a02\u90e8');
    dom.window.close();
  });

  test('activity delegate reports refresh failure when stale cache misses the query', async () => {
    const App = {
      _canManageEventDelegates: () => true,
      _canManageCourseLinkedEventDelegates: () => false,
      _getEventCreatorUid: () => 'viewer',
      _formatUidForDisplay: uid => uid,
    };
    const ApiService = {
      getCurrentUser: () => ({ uid: 'viewer' }),
      getAdminUsers: () => [{ uid: 'cached-user', name: 'Cached User' }],
      ensureAdminUsersReady: jest.fn(async () => false),
    };
    const dom = loadUiModule(
      'js/modules/event/event-create-delegates.js',
      '<div id="create-event-modal" class="open"></div><input id="ce-delegate-search" value="Missing"><div id="ce-delegate-dropdown"></div><div id="ce-delegate-tags"></div>',
      App,
      ApiService
    );

    await App._searchDelegates('Missing');

    expect(dom.window.document.getElementById('ce-delegate-dropdown').textContent).toContain('\u8f09\u5165\u5931\u6557');
    dom.window.close();
  });

  test('tournament people search reports refresh failure when stale cache misses the query', async () => {
    const App = {
      _tournamentFormState: {
        personSearchBound: {},
        delegates: [],
        referees: [],
        refereeHeads: [],
      },
      _formatUidForDisplay: uid => uid,
    };
    const ApiService = {
      getAdminUsers: () => [{ uid: 'cached-user', name: 'Cached User' }],
      ensureAdminUsersReady: jest.fn(async () => false),
    };
    const dom = loadUiModule(
      'js/modules/tournament/tournament-manage-people.js',
      '<div id="tournament-form-modal" class="open"></div><input id="tf-referee-search" value="Missing"><div id="tf-referee-dropdown"></div>',
      App,
      ApiService
    );

    await App._searchTournamentPeople('Missing', 'referee', 'tf');

    expect(dom.window.document.getElementById('tf-referee-dropdown').textContent).toContain('\u8f09\u5165\u5931\u6557');
    dom.window.close();
  });

  test('message team search reports refresh failure when stale cache misses the query', async () => {
    const teams = [{ id: 'cached-team', name: 'Cached Team', active: true }];
    const App = {};
    const ApiService = {
      getTeamDirectory: () => teams,
      ensureTeamsReady: jest.fn(async () => false),
    };
    const dom = loadUiModule(
      'js/modules/message/message-admin-compose.js',
      '<div id="msg-compose" style="display:flex"></div><select id="msg-target"><option value="team" selected>team</option></select><input id="msg-team-target" value="Missing"><div id="msg-team-dropdown"></div><div id="msg-team-result"></div>',
      App,
      ApiService
    );

    await App.searchMsgTeam();

    expect(dom.window.document.getElementById('msg-team-dropdown').textContent).toContain('\u8f09\u5165\u5931\u6557');
    dom.window.close();
  });
  test('message team search can find a team beyond the first 50 list records', async () => {
    const directory = Array.from({ length: 51 }, (_, index) => ({
      id: `team-${index + 1}`,
      name: index === 50 ? 'Legacy Club' : `Club ${index + 1}`,
      active: true,
    }));
    const App = {};
    const ApiService = {
      getTeams: () => directory.slice(0, 50),
      getTeamDirectory: () => directory,
    };
    const dom = loadUiModule(
      'js/modules/message/message-admin-compose.js',
      '<div id="msg-compose" style="display:flex"></div><select id="msg-target"><option value="team" selected>team</option></select><input id="msg-team-target" value="Legacy"><div id="msg-team-dropdown"></div><div id="msg-team-result"></div>',
      App,
      ApiService
    );

    await App.searchMsgTeam({ skipRefresh: true });

    expect(dom.window.document.getElementById('msg-team-dropdown').textContent).toContain('Legacy Club');
    dom.window.close();
  });

  test('editing a selected message team clears the stale target', async () => {
    const teams = [
      { id: 'team-a', name: 'Team A', active: true },
      { id: 'team-b', name: 'Team B', active: true },
    ];
    const App = {};
    const ApiService = { getTeamDirectory: () => teams };
    const dom = loadUiModule(
      'js/modules/message/message-admin-compose.js',
      '<div id="msg-compose" style="display:flex"></div><select id="msg-target"><option value="team" selected>team</option></select><input id="msg-team-target"><div id="msg-team-dropdown"></div><div id="msg-team-result"></div>',
      App,
      ApiService
    );
    const input = dom.window.document.getElementById('msg-team-target');
    const result = dom.window.document.getElementById('msg-team-result');

    App._selectMsgTeam('team-a', 'Team A');
    expect(App._msgMatchedTeam).toEqual({ id: 'team-a', name: 'Team A' });
    input.value = 'Team B';
    await App.searchMsgTeam({ skipRefresh: true });

    expect(App._msgMatchedTeam).toBeNull();
    expect(result.textContent).toBe('');
    dom.window.close();
  });
  test('activity team-only search refresh preserves the current selection', async () => {
    let teams = [{ id: 'team-old', name: 'Old Club', active: true }];
    const App = {
      _getUserTeamIds: user => user.teamIds || [],
      _getVisibleTeamIdsForLimitedEvents: () => [],
    };
    const ApiService = {
      getCurrentUser: () => ({
        uid: 'viewer',
        teamIds: ['team-old', 'team-new'],
        teamNames: ['Old Club', 'New Club'],
      }),
      getTeams: () => teams.slice(0, 1),
      getTeamDirectory: () => teams,
      getTeam: id => teams.find(team => team.id === id) || null,
      getEvents: () => [],
      ensureTeamsReady: jest.fn(async () => {
        teams = [
          { id: 'team-old', name: 'Old Club', active: true },
          { id: 'team-new', name: 'New Club', active: true },
        ];
        return true;
      }),
    };
    const dom = loadUiModule(
      'js/modules/event/event-create-team-picker.js',
      '<div id="create-event-modal" class="open"></div><input id="ce-team-only" type="checkbox" checked><div id="ce-team-only-label"></div><select id="ce-team-select" multiple><option value="team-old" data-name="Old Club" selected>Old Club</option></select><div id="ce-team-picker"><input id="ce-team-search"><div id="ce-team-chips"></div><div id="ce-team-list"></div></div>',
      App,
      ApiService
    );

    await App._refreshTeamOnlyDirectoryIfOpen();

    const select = dom.window.document.getElementById('ce-team-select');
    expect(Array.from(select.options).map(option => option.value)).toEqual(['team-new', 'team-old']);
    expect(Array.from(select.selectedOptions).map(option => option.value)).toEqual(['team-old']);
    expect(ApiService.ensureTeamsReady).toHaveBeenCalledTimes(1);
    dom.window.close();
  });
  test('activity team directory ignores an older refresh response', async () => {
    let teams = [{ id: 'team-1', name: 'Old Club', active: true }];
    let resolveFirst;
    let callCount = 0;
    const App = {
      _getUserTeamIds: user => user.teamIds || [],
      _getVisibleTeamIdsForLimitedEvents: () => [],
    };
    const ApiService = {
      getCurrentUser: () => ({ teamIds: ['team-1'], teamNames: ['Old Club'] }),
      getTeamDirectory: () => teams,
      getTeam: id => teams.find(team => team.id === id) || null,
      getEvents: () => [],
      ensureTeamsReady: jest.fn(() => {
        callCount += 1;
        if (callCount === 1) {
          return new Promise(resolve => {
            resolveFirst = () => {
              teams = [{ id: 'team-1', name: 'Old Club', active: true }];
              resolve(true);
            };
          });
        }
        teams = [{ id: 'team-1', name: 'New Club', active: true }];
        return Promise.resolve(true);
      }),
    };
    const dom = loadUiModule(
      'js/modules/event/event-create-team-picker.js',
      '<div id="create-event-modal" class="open"></div><input id="ce-team-only" type="checkbox" checked><div id="ce-team-only-label"></div><select id="ce-team-select" multiple><option value="team-1" data-name="Old Club" selected>Old Club</option></select><div id="ce-team-picker"><input id="ce-team-search"><div id="ce-team-chips"></div><div id="ce-team-list"></div></div>',
      App,
      ApiService
    );

    const older = App._refreshTeamOnlyDirectoryIfOpen();
    await App._refreshTeamOnlyDirectoryIfOpen();
    expect(dom.window.document.getElementById('ce-team-select').textContent).toContain('New Club');

    resolveFirst();
    await expect(older).resolves.toBe(false);
    expect(dom.window.document.getElementById('ce-team-select').textContent).toContain('New Club');
    dom.window.close();
  });
  test('activity team directory stays idle until team-only mode is enabled', async () => {
    const App = {};
    const ApiService = { ensureTeamsReady: jest.fn(async () => true) };
    const dom = loadUiModule(
      'js/modules/event/event-create-team-picker.js',
      '<div id="create-event-modal" class="open"></div><input id="ce-team-only" type="checkbox"><select id="ce-team-select"></select>',
      App,
      ApiService
    );

    await expect(App._refreshTeamOnlyDirectoryIfOpen()).resolves.toBe(true);
    expect(ApiService.ensureTeamsReady).not.toHaveBeenCalled();
    dom.window.close();
  });
});


describe('public page performance contract', () => {
  test('public activity and tournament pages keep users off realtime listeners', () => {
    const firebaseSource = readProjectFile('js/firebase-service.js');
    const eventSearchSource = readProjectFile('js/modules/event/event-create-delegates.js');
    const tournamentSearchSource = readProjectFile('js/modules/tournament/tournament-manage-people.js');
    const messageSearchSource = readProjectFile('js/modules/message/message-admin-compose.js');
    const teamPickerSource = readProjectFile('js/modules/event/event-create-team-picker.js');
    const teamDirectoryStart = firebaseSource.indexOf('  async ensureTeamDirectoryReady(options = {}) {');
    const teamDirectoryEnd = firebaseSource.indexOf('  async ensureAdminUsersReady(options = {}) {');
    const teamDirectorySource = firebaseSource.slice(teamDirectoryStart, teamDirectoryEnd);

    expect(firebaseSource).toContain("'page-activities':      ['registrations', 'events']");
    expect(firebaseSource).toContain("'page-tournaments':     ['tournaments']");
    expect(firebaseSource).not.toContain("'page-activities':      ['registrations', 'events', 'users']");
    expect(firebaseSource).not.toContain("'page-tournaments':     ['tournaments', 'users']");
    expect(eventSearchSource).toContain('ApiService.ensureAdminUsersReady');
    expect(firebaseSource).toContain("if (!fromCache) this._markCollectionsLoaded(['adminUsers'])");
    expect(firebaseSource).not.toContain("this._syncCurrentUserFromUsersSnapshot();\n              this._markCollectionsLoaded(['adminUsers']);");
    expect(tournamentSearchSource).toContain('ApiService.ensureAdminUsersReady');
    expect(firebaseSource).toContain("return db.collection('teams').orderBy('createdAt', 'desc').limit(50);");
    expect(firebaseSource).toContain(".limit(this._getRealtimeLimit('teamLimit'))");
    expect(teamDirectoryStart).toBeGreaterThan(-1);
    expect(teamDirectoryEnd).toBeGreaterThan(teamDirectoryStart);
    expect(teamDirectorySource).toContain("db.collection('teams').get()");
    expect(teamDirectorySource).not.toContain('.limit(');
    expect(messageSearchSource).toContain('ApiService.getTeamDirectory');
    expect(teamPickerSource).toContain('ApiService.getTeamDirectory');
  });
});
