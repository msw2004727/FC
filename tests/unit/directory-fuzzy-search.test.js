const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '../..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
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
  test('safe user directory shares one callable, strips private fields, persists, and honors TTL', async () => {
    const sandbox = loadServices();
    const { ApiService, FirebaseService } = sandbox;
    let resolveDirectory;
    const callable = jest.fn(() => new Promise(resolve => { resolveDirectory = resolve; }));
    const httpsCallable = jest.fn(name => {
      if (name !== 'listUserDirectory') throw new Error('unexpected callable');
      return callable;
    });

    sandbox.ensureFirebaseFunctionsSdk = jest.fn(async region => {
      if (region !== 'asia-east1') throw new Error('unexpected region');
      return { httpsCallable };
    });
    sandbox.auth = { currentUser: { uid: 'viewer' } };
    FirebaseService._initialized = true;
    FirebaseService._cache.userDirectory = [];
    FirebaseService._cache.adminUsers = [{ uid: 'admin-cache', email: 'private@example.com' }];
    FirebaseService._lazyLoaded = {};
    FirebaseService._collectionLoadedAt = {};
    FirebaseService._saveToLS = jest.fn();
    FirebaseService._debouncedPersistCache = jest.fn();

    const first = ApiService.ensureUserDirectoryReady();
    const second = ApiService.ensureUserDirectoryReady();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(callable).toHaveBeenCalledTimes(1);
    resolveDirectory({
      data: {
        users: [
          {
            uid: 'user-1',
            name: 'Lin',
            displayName: 'Lin Display',
            pictureUrl: ' https://example.com/u1.png ',
            role: 'coach',
            email: 'leak@example.com',
            phone: '0900',
          },
          { uid: 'user-1', name: 'Duplicate', role: 'admin' },
          { name: 'Missing UID', email: 'missing@example.com' },
        ],
      },
    });

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    const directory = ApiService.getUserDirectory();
    expect(directory).toEqual([{
      uid: 'user-1',
      name: 'Lin',
      displayName: 'Lin Display',
      pictureUrl: 'https://example.com/u1.png',
      role: 'coach',
    }]);
    expect(Object.keys(directory[0]).sort()).toEqual(['displayName', 'name', 'pictureUrl', 'role', 'uid']);
    expect(FirebaseService._cache.adminUsers).toEqual([{ uid: 'admin-cache', email: 'private@example.com' }]);
    expect(FirebaseService._lazyLoaded.userDirectory).toBe(true);
    expect(FirebaseService._saveToLS).toHaveBeenCalledWith('userDirectory', expect.any(Array));

    await expect(ApiService.ensureUserDirectoryReady()).resolves.toBe(true);
    expect(callable).toHaveBeenCalledTimes(1);
    callable.mockResolvedValueOnce({ data: { users: [] } });
    await expect(ApiService.ensureUserDirectoryReady({ force: true })).resolves.toBe(true);
    expect(callable).toHaveBeenCalledTimes(2);
  });

  test('safe user directory ignores a response after the signed-in user changes', async () => {
    const sandbox = loadServices();
    const service = sandbox.FirebaseService;
    const originalCache = [{ uid: 'cached-user', name: 'Cached', displayName: 'Cached', pictureUrl: '', role: 'user' }];
    let resolveDirectory;
    const callable = jest.fn(() => new Promise(resolve => { resolveDirectory = resolve; }));

    sandbox.ensureFirebaseFunctionsSdk = jest.fn(async () => ({ httpsCallable: () => callable }));
    sandbox.auth = { currentUser: { uid: 'viewer-a' } };
    service._initialized = true;
    service._cache.userDirectory = originalCache;
    service._lazyLoaded = {};
    service._collectionLoadedAt = {};

    const pending = service.ensureUserDirectoryReady();
    await new Promise(resolve => setTimeout(resolve, 0));
    sandbox.auth.currentUser = { uid: 'viewer-b' };
    resolveDirectory({ data: { users: [{ uid: 'new-user', name: 'New' }] } });

    await expect(pending).resolves.toBe(false);
    expect(service._cache.userDirectory).toBe(originalCache);
    expect(service._userDirectoryLoadPromise).toBeNull();
    expect(service._userDirectoryLoadUid).toBe('');
  });

  test('safe user directory preserves cached preview on invalid payload and can retry', async () => {
    const sandbox = loadServices();
    const service = sandbox.FirebaseService;
    const originalCache = [{ uid: 'cached-user', name: 'Cached', displayName: 'Cached', pictureUrl: '', role: 'user' }];
    const callable = jest.fn()
      .mockResolvedValueOnce({ data: { users: null } })
      .mockResolvedValueOnce({ data: { users: [{ uid: 'fresh-user', displayName: 'Fresh' }] } });

    sandbox.ensureFirebaseFunctionsSdk = jest.fn(async () => ({ httpsCallable: () => callable }));
    sandbox.auth = { currentUser: { uid: 'viewer' } };
    service._initialized = true;
    service._cache.userDirectory = originalCache;
    service._lazyLoaded = {};
    service._collectionLoadedAt = {};
    service._saveToLS = jest.fn();
    service._debouncedPersistCache = jest.fn();

    await expect(service.ensureUserDirectoryReady()).resolves.toBe(false);
    expect(service._cache.userDirectory).toBe(originalCache);
    expect(service._userDirectoryLoadPromise).toBeNull();

    await expect(service.ensureUserDirectoryReady()).resolves.toBe(true);
    expect(service.getUserDirectory()).toEqual([{
      uid: 'fresh-user',
      name: 'Fresh',
      displayName: 'Fresh',
      pictureUrl: '',
      role: 'user',
    }]);
  });

  test('safe user directory does not write after the service lifecycle ends', async () => {
    const sandbox = loadServices();
    const service = sandbox.FirebaseService;
    const originalCache = [{ uid: 'cached-user', name: 'Cached', displayName: 'Cached', pictureUrl: '', role: 'user' }];
    let resolveDirectory;
    const callable = jest.fn(() => new Promise(resolve => { resolveDirectory = resolve; }));

    sandbox.ensureFirebaseFunctionsSdk = jest.fn(async () => ({ httpsCallable: () => callable }));
    sandbox.auth = { currentUser: { uid: 'viewer' } };
    service._initialized = true;
    service._cache.userDirectory = originalCache;
    service._lazyLoaded = {};
    service._collectionLoadedAt = {};

    const pending = service.ensureUserDirectoryReady();
    await new Promise(resolve => setTimeout(resolve, 0));
    service._initialized = false;
    resolveDirectory({ data: { users: [{ uid: 'new-user', name: 'New User' }] } });

    await expect(pending).resolves.toBe(false);
    expect(service._cache.userDirectory).toBe(originalCache);
  });
  test('fresh selection verification evicts requested cache entries and merges only returned safe users', async () => {
    const sandbox = loadServices();
    const { ApiService, FirebaseService } = sandbox;
    const callable = jest.fn(async () => ({
      data: {
        users: [{
          uid: 'kept-user',
          name: 'Fresh Kept',
          displayName: 'Fresh Kept Display',
          pictureUrl: ' https://example.com/kept.png ',
          role: 'coach',
          email: 'must-not-cache@example.com',
        }],
      },
    }));
    const httpsCallable = jest.fn(() => callable);

    sandbox.ensureFirebaseFunctionsSdk = jest.fn(async () => ({ httpsCallable }));
    sandbox.auth = { currentUser: { uid: 'viewer' } };
    FirebaseService._initialized = true;
    FirebaseService._cache.userDirectory = [
      { uid: 'gone-user', name: 'Cached Gone', displayName: 'Cached Gone', pictureUrl: '', role: 'user' },
      { uid: 'kept-user', name: 'Cached Kept', displayName: 'Cached Kept', pictureUrl: '', role: 'user' },
      { uid: 'other-user', name: 'Other', displayName: 'Other', pictureUrl: '', role: 'user' },
    ];
    FirebaseService._saveToLS = jest.fn();
    FirebaseService._debouncedPersistCache = jest.fn();

    const result = await ApiService.verifyUserDirectorySelection(['gone-user', 'kept-user']);

    expect(httpsCallable).toHaveBeenCalledWith('listUserDirectory');
    expect(callable).toHaveBeenCalledWith({ verifyUids: ['gone-user', 'kept-user'] });
    expect(result).toEqual({
      ok: false,
      users: [{
        uid: 'kept-user',
        name: 'Fresh Kept',
        displayName: 'Fresh Kept Display',
        pictureUrl: 'https://example.com/kept.png',
        role: 'coach',
      }],
      missingUids: ['gone-user'],
      reason: 'missing-users',
    });
    expect(FirebaseService.getUserDirectory()).toEqual([
      { uid: 'other-user', name: 'Other', displayName: 'Other', pictureUrl: '', role: 'user' },
      { uid: 'kept-user', name: 'Fresh Kept', displayName: 'Fresh Kept Display', pictureUrl: 'https://example.com/kept.png', role: 'coach' },
    ]);
    expect(JSON.stringify(FirebaseService._cache.userDirectory)).not.toContain('must-not-cache');
    expect(FirebaseService._saveToLS).toHaveBeenCalledTimes(1);
    expect(FirebaseService._saveToLS.mock.calls[0][0]).toBe('userDirectory');
    expect(Array.from(FirebaseService._saveToLS.mock.calls[0][1])).toHaveLength(2);
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
    let users = [{ uid: 'user-old', name: '\u653f\u7a4e', role: 'user' }];
    let finish;
    const loading = new Promise(resolve => {
      finish = () => {
        users = [
          { uid: 'user-new', name: '\u6797\u653f\u7a4e', role: 'user' },
          { uid: 'coach-new', name: '\u6797\u653f\u6559\u7df4', role: 'coach' },
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
      getUserDirectory: () => users,
      ensureUserDirectoryReady: jest.fn(() => loading),
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
    expect(dom.window.document.getElementById('ce-delegate-dropdown').textContent).toContain('\u6797\u653f\u6559\u7df4');
    expect(ApiService.ensureUserDirectoryReady).toHaveBeenCalledTimes(1);
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
      getUserDirectory: () => users,
      ensureUserDirectoryReady: jest.fn(() => loading),
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
        users = [{ uid: 'ref-1', name: '\u6797\u653f\u7a4e', role: 'user' }];
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
      getUserDirectory: () => users,
      ensureUserDirectoryReady: jest.fn(() => loading),
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

  test('late tournament person verification cannot mutate a reopened form session', async () => {
    const verification = deferred();
    const cachedUser = { uid: 'ref-old', name: 'Old Referee', role: 'user' };
    const App = {
      _tournamentFormGeneration: 1,
      _tournamentFormMode: 'edit',
      _tournamentFormEditId: 'tournament-a',
      _tournamentFormState: { personSearchBound: {}, delegates: [], referees: [], refereeHeads: [] },
      _formatUidForDisplay: uid => uid,
      showToast: jest.fn(),
    };
    const ApiService = {
      getCurrentUser: () => ({ uid: 'viewer' }),
      getUserDirectory: () => [cachedUser],
      verifyUserDirectorySelection: jest.fn(() => verification.promise),
    };
    const dom = loadUiModule(
      'js/modules/tournament/tournament-manage-people.js',
      '<div id="tournament-form-modal" class="open"></div><input id="tf-referee-search" value="old"><div id="tf-referee-dropdown"></div><div id="tf-referee-tags"></div>',
      App,
      ApiService
    );
    const pickerContext = App._captureTournamentPersonPickerContext('referee', 'tf');
    const pending = App._addTournamentPerson('referee', cachedUser.uid, cachedUser.name, 'tf', {
      requestSeq: 0,
      query: 'old',
      pickerContext,
    });

    App._tournamentFormGeneration = 2;
    App._tournamentFormEditId = 'tournament-b';
    App._tournamentFormState.referees = [];
    verification.resolve({ ok: true, users: [cachedUser], missingUids: [], reason: 'ok' });

    await expect(pending).resolves.toBe(false);
    expect(App._tournamentFormState.referees).toEqual([]);
    dom.window.close();
  });

  test('tournament submit keeps the modal inert until the captured task settles', async () => {
    const write = deferred();
    const App = {
      _tournamentFormGeneration: 1,
      _tournamentFormMode: 'create',
      _tournamentFormEditId: null,
      _tournamentFormState: { delegates: [], referees: [], refereeHeads: [], matchDates: [], venues: [] },
      _withButtonLoading: jest.fn((_selector, _label, run) => run()),
    };
    const ApiService = { getCurrentUser: () => ({ uid: 'viewer' }) };
    const dom = loadUiModule(
      'js/modules/tournament/tournament-manage.js',
      '<div id="tournament-form-modal" class="open"><input id="tf-name" value="Captured"><button id="tf-save-btn">Save</button><div id="tf-upload-preview"></div><div id="tf-content-upload-preview"></div></div>',
      App,
      ApiService
    );

    const context = App._beginTournamentSubmit('create', '');
    const modal = dom.window.document.getElementById('tournament-form-modal');
    expect(modal.inert).toBe(true);
    const saving = App._runTournamentSubmit(context, '建立中...', () => write.promise);
    dom.window.document.getElementById('tf-name').value = 'Late Script Mutation';
    write.resolve({ ok: true });
    await saving;

    expect(App._tournamentSubmitToken).toBeNull();
    expect(modal.inert).toBe(false);
    dom.window.close();
  });
  test('message individual search refreshes a cold user directory and includes user and coach roles', async () => {
    let users = [];
    let finish;
    const loading = new Promise(resolve => {
      finish = () => {
        users = [
          { uid: 'user-1', name: '\u6797\u4e00\u822c', role: 'user' },
          { uid: 'coach-1', name: '\u6797\u6559\u7df4', role: 'coach' },
        ];
        resolve(true);
      };
    });
    const App = { _formatUidForDisplay: uid => uid };
    const ApiService = {
      getUserDirectory: () => users,
      ensureUserDirectoryReady: jest.fn(() => loading),
    };
    const dom = loadUiModule(
      'js/modules/message/message-admin-compose.js',
      '<div id="msg-compose" style="display:flex"></div><select id="msg-target"><option value="individual" selected>individual</option></select><input id="msg-individual-target" value="\u6797"><div id="msg-user-dropdown"></div><div id="msg-target-result"></div>',
      App,
      ApiService
    );
    const dropdown = dom.window.document.getElementById('msg-user-dropdown');

    const pending = App.searchMsgTarget();
    expect(dropdown.textContent).toContain('\u8f09\u5165\u7528\u6236\u8cc7\u6599');
    finish();
    await pending;

    expect(dropdown.textContent).toContain('\u6797\u4e00\u822c');
    expect(dropdown.textContent).toContain('\u6797\u6559\u7df4');
    expect(dropdown.textContent).toContain('user');
    expect(dropdown.textContent).toContain('coach');
    expect(ApiService.ensureUserDirectoryReady).toHaveBeenCalledTimes(1);
    dom.window.close();
  });

  test('message individual search ignores an older response after the query changes', async () => {
    let users = [];
    let finish;
    const loading = new Promise(resolve => {
      finish = () => {
        users = [
          { uid: 'user-lin', name: '\u6797\u653f\u7a4e', role: 'user' },
          { uid: 'coach-wang', name: '\u738b\u5c0f\u660e', role: 'coach' },
        ];
        resolve(true);
      };
    });
    const App = { _formatUidForDisplay: uid => uid };
    const ApiService = {
      getUserDirectory: () => users,
      ensureUserDirectoryReady: jest.fn(() => loading),
    };
    const dom = loadUiModule(
      'js/modules/message/message-admin-compose.js',
      '<div id="msg-compose" style="display:flex"></div><select id="msg-target"><option value="individual" selected>individual</option></select><input id="msg-individual-target" value="\u653f"><div id="msg-user-dropdown"></div><div id="msg-target-result"></div>',
      App,
      ApiService
    );
    const input = dom.window.document.getElementById('msg-individual-target');
    const dropdown = dom.window.document.getElementById('msg-user-dropdown');

    const older = App.searchMsgTarget();
    input.value = '\u738b';
    const newer = App.searchMsgTarget();
    finish();
    await Promise.all([older, newer]);

    expect(dropdown.textContent).toContain('\u738b\u5c0f\u660e');
    expect(dropdown.textContent).not.toContain('\u6797\u653f\u7a4e');
    dom.window.close();
  });

  test('selecting or clearing a message user invalidates an in-flight refresh', async () => {
    let users = [{ uid: 'user-lin', name: '\u6797\u4e00\u822c', role: 'user' }];
    let resolveDirectory;
    const loading = new Promise(resolve => { resolveDirectory = resolve; });
    const App = { _formatUidForDisplay: uid => uid };
    const ApiService = {
      getUserDirectory: () => users,
      ensureUserDirectoryReady: jest.fn(() => loading),
      verifyUserDirectorySelection: jest.fn(async uids => ({
        ok: true,
        users: users.filter(user => uids.includes(user.uid)),
        missingUids: [],
        reason: '',
      })),
    };
    const dom = loadUiModule(
      'js/modules/message/message-admin-compose.js',
      '<div id="msg-compose" style="display:flex"></div><select id="msg-target"><option value="individual" selected>individual</option></select><input id="msg-individual-target" value="\u6797"><div id="msg-user-dropdown"></div><div id="msg-target-result"></div>',
      App,
      ApiService
    );
    const input = dom.window.document.getElementById('msg-individual-target');
    const dropdown = dom.window.document.getElementById('msg-user-dropdown');
    const result = dom.window.document.getElementById('msg-target-result');

    const pending = App.searchMsgTarget();
    await App._selectMsgUser('user-lin');
    expect(result.textContent).toContain('\u5df2\u9078\u53d6');
    input.value = '';
    await App.searchMsgTarget();
    users = [{ uid: 'coach-wang', name: '\u738b\u5c0f\u660e', role: 'coach' }];
    resolveDirectory(true);
    await pending;

    expect(App._msgMatchedUser).toBeNull();
    expect(result.textContent).toBe('');
    expect(dropdown.classList.contains('open')).toBe(false);
    dom.window.close();
  });
  test('cached activity delegate missing at verification cannot be selected or submitted', async () => {
    const cachedUser = { uid: 'cached-user', name: 'Cached User', role: 'user' };
    const showToast = jest.fn();
    const App = {
      _canManageEventDelegates: () => true,
      _canManageCourseLinkedEventDelegates: () => false,
      _getEventCreatorUid: () => 'viewer',
      _formatUidForDisplay: uid => uid,
      showToast,
    };
    const ApiService = {
      getUserDirectory: () => [cachedUser],
      verifyUserDirectorySelection: jest.fn(async () => ({
        ok: false, users: [], missingUids: ['cached-user'], reason: 'missing-users',
      })),
    };
    const dom = loadUiModule(
      'js/modules/event/event-create-delegates.js',
      '<div id="create-event-modal" class="open"></div><input id="ce-delegate-search" value="cached"><div id="ce-delegate-dropdown"></div><div id="ce-delegate-tags"></div>',
      App,
      ApiService
    );

    await App._searchDelegates('cached', { skipRefresh: true });
    dom.window.document.querySelector('.ce-delegate-item').dispatchEvent(
      new dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true })
    );
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(App._delegates).toEqual([]);

    App._delegates = [{ uid: 'cached-user', name: 'Cached User' }];
    await expect(App._verifySelectedEventDelegatesForSubmit()).resolves.toBe(false);
    expect(ApiService.verifyUserDirectorySelection).toHaveBeenLastCalledWith(['cached-user']);
    expect(showToast).toHaveBeenCalled();
    dom.window.close();
  });

  test('activity delegate ignores a fresh verification response after the search becomes stale', async () => {
    let finishVerification;
    const verification = new Promise(resolve => { finishVerification = resolve; });
    const App = {
      _canManageEventDelegates: () => true,
      _canManageCourseLinkedEventDelegates: () => false,
      _getEventCreatorUid: () => 'viewer',
      _formatUidForDisplay: uid => uid,
      showToast: jest.fn(),
    };
    const ApiService = {
      getUserDirectory: () => [{ uid: 'cached-user', name: 'Cached User', role: 'user' }],
      verifyUserDirectorySelection: jest.fn(() => verification),
    };
    const dom = loadUiModule(
      'js/modules/event/event-create-delegates.js',
      '<div id="create-event-modal" class="open"></div><input id="ce-delegate-search" value="cached"><div id="ce-delegate-dropdown"></div><div id="ce-delegate-tags"></div>',
      App,
      ApiService
    );

    const pending = App._addDelegate('cached-user', 'Cached User', { requestSeq: 0, query: 'cached' });
    dom.window.document.getElementById('ce-delegate-search').value = 'other';
    App._delegateSearchSeq += 1;
    finishVerification({
      ok: true,
      users: [{ uid: 'cached-user', name: 'Fresh User', displayName: 'Fresh User', pictureUrl: '', role: 'user' }],
      missingUids: [],
      reason: '',
    });

    await expect(pending).resolves.toBe(false);
    expect(App._delegates).toEqual([]);
    dom.window.close();
  });

  test('cached tournament person missing at verification cannot be selected or submitted', async () => {
    const cachedUser = { uid: 'cached-ref', name: 'Cached Referee', role: 'user' };
    const showToast = jest.fn();
    const App = {
      _tournamentFormState: { personSearchBound: {}, delegates: [], referees: [], refereeHeads: [] },
      _formatUidForDisplay: uid => uid,
      showToast,
    };
    const ApiService = {
      getUserDirectory: () => [cachedUser],
      verifyUserDirectorySelection: jest.fn(async () => ({
        ok: false, users: [], missingUids: ['cached-ref'], reason: 'missing-users',
      })),
    };
    const dom = loadUiModule(
      'js/modules/tournament/tournament-manage-people.js',
      '<div id="tournament-form-modal" class="open"></div><input id="tf-referee-search" value="cached"><div id="tf-referee-dropdown"></div><div id="tf-referee-tags"></div>',
      App,
      ApiService
    );

    await App._searchTournamentPeople('cached', 'referee', 'tf', { skipRefresh: true });
    dom.window.document.querySelector('.ce-delegate-item').dispatchEvent(
      new dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true })
    );
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(App._tournamentFormState.referees).toEqual([]);

    App._tournamentFormState.referees = [{ uid: 'cached-ref', name: 'Cached Referee' }];
    await expect(App._verifyTournamentPeopleForSubmit()).resolves.toBe(false);
    expect(ApiService.verifyUserDirectorySelection).toHaveBeenLastCalledWith(['cached-ref']);
    expect(showToast).toHaveBeenCalled();
    dom.window.close();
  });

  test('cached message user missing at verification cannot be selected or sent', async () => {
    const cachedUser = { uid: 'cached-user', name: 'Cached User', role: 'user' };
    const showToast = jest.fn();
    const App = {
      _formatUidForDisplay: uid => uid,
      hasPermission: () => true,
      showToast,
    };
    const ApiService = {
      getUserDirectory: () => [cachedUser],
      verifyUserDirectorySelection: jest.fn(async () => ({
        ok: false, users: [], missingUids: ['cached-user'], reason: 'missing-users',
      })),
      createAdminMessage: jest.fn(),
    };
    const dom = loadUiModule(
      'js/modules/message/message-admin-compose.js',
      '<div id="msg-compose" style="display:flex"></div><select id="msg-target"><option value="individual" selected>individual</option></select><input id="msg-individual-target" value="cached"><div id="msg-user-dropdown"></div><div id="msg-target-result"></div><input id="msg-title" value="Title"><textarea id="msg-body">Body</textarea><select id="msg-category"><option value="system" selected>system</option></select><input id="msg-schedule" value="">',
      App,
      ApiService
    );

    await App.searchMsgTarget({ skipRefresh: true });
    dom.window.document.querySelector('.ce-delegate-item').dispatchEvent(
      new dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true })
    );
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(App._msgMatchedUser).toBeNull();

    App._msgMatchedUser = cachedUser;
    await App.sendMessage();
    expect(ApiService.createAdminMessage).not.toHaveBeenCalled();
    expect(ApiService.verifyUserDirectorySelection).toHaveBeenLastCalledWith(['cached-user']);
    expect(showToast).toHaveBeenCalled();
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
      getUserDirectory: () => [{ uid: 'cached-user', name: 'Cached User' }],
      ensureUserDirectoryReady: jest.fn(async () => false),
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
      getUserDirectory: () => [{ uid: 'cached-user', name: 'Cached User' }],
      ensureUserDirectoryReady: jest.fn(async () => false),
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
    let teams = [{ id: 'team-old', name: 'Old Club', active: true, leaderUids: ['viewer'] }];
    const App = {
      _canManageAllActivities: () => false,
      _getEventCreatorTeam: () => ({ teamId: null, teamName: null }),
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
          { id: 'team-old', name: 'Old Club', active: true, leaderUids: ['viewer'] },
          { id: 'team-new', name: 'New Club', active: true, coachUids: ['viewer'] },
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
  test('activity team-only candidates expand to the full active directory only for managers', () => {
    const teams = [
      { id: 'team-current', name: 'Current Club', active: true, leaderUids: ['viewer'] },
      { id: 'team-membership-only', name: 'Membership Only Club', active: true },
      { id: 'team-other', name: 'Other Active Club', active: true },
      { id: 'team-disabled', name: 'Disabled Club', active: false },
    ];
    const getCandidateIds = (canManageAllActivities) => {
      const App = {
        _canManageAllActivities: () => canManageAllActivities,
        _hasActivityManageEntry: () => true,
        _getUserTeamIds: user => user.teamIds || [],
        _getVisibleTeamIdsForLimitedEvents: () => [],
      };
      const ApiService = {
        getCurrentUser: () => ({
          uid: 'viewer',
          teamIds: ['team-current', 'team-membership-only'],
          teamNames: ['Current Club', 'Membership Only Club'],
        }),
        getTeamDirectory: () => teams,
        getTeam: id => teams.find(team => team.id === id) || null,
        getEvents: () => [],
      };
      const dom = loadUiModule(
        'js/modules/event/event-create-team-picker.js',
        '<div></div>',
        App,
        ApiService
      );
      const ids = App._getTeamOnlyCandidateTeams().map(team => team.id);
      dom.window.close();
      return ids;
    };

    expect(getCandidateIds(false)).toEqual(['team-current']);
    expect(getCandidateIds(true)).toEqual(['team-current', 'team-membership-only', 'team-other']);
  });

  test('activity team directory ignores an older refresh response', async () => {
    let teams = [{ id: 'team-1', name: 'Old Club', active: true, leaderUids: ['viewer'] }];
    let resolveFirst;
    let callCount = 0;
    const App = {
      _canManageAllActivities: () => false,
      _getEventCreatorTeam: () => ({ teamId: null, teamName: null }),
      _getUserTeamIds: user => user.teamIds || [],
      _getVisibleTeamIdsForLimitedEvents: () => [],
    };
    const ApiService = {
      getCurrentUser: () => ({ uid: 'viewer', teamIds: ['team-1'], teamNames: ['Old Club'] }),
      getTeamDirectory: () => teams,
      getTeam: id => teams.find(team => team.id === id) || null,
      getEvents: () => [],
      ensureTeamsReady: jest.fn(() => {
        callCount += 1;
        if (callCount === 1) {
          return new Promise(resolve => {
            resolveFirst = () => {
              teams = [{ id: 'team-1', name: 'Old Club', active: true, leaderUids: ['viewer'] }];
              resolve(true);
            };
          });
        }
        teams = [{ id: 'team-1', name: 'New Club', active: true, leaderUids: ['viewer'] }];
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
  test('non-manager activity team-only create uses one managed club at a time', () => {
    const teams = [
      { id: 'team-a', name: 'Club A', active: true, leaderUids: ['viewer'] },
      { id: 'team-b', name: 'Club B', active: true, coachUids: ['viewer'] },
      { id: 'team-membership-only', name: 'Membership Only', active: true },
    ];
    const App = {
      _canManageAllActivities: () => false,
      _editEventId: null,
      _getEventCreatorTeam: () => ({ teamId: null, teamName: null }),
    };
    const ApiService = {
      getCurrentUser: () => ({ uid: 'viewer', teamIds: teams.map(team => team.id) }),
      getTeamDirectory: () => teams,
      getTeam: id => teams.find(team => team.id === id) || null,
      getEvents: () => [],
    };
    const dom = loadUiModule(
      'js/modules/event/event-create-team-picker.js',
      '<input id="ce-team-only" type="checkbox" checked><div id="ce-team-only-label"></div><select id="ce-team-select"></select><div id="ce-team-picker"><input id="ce-team-search"><div id="ce-team-chips"></div><div id="ce-team-list"></div></div>',
      App,
      ApiService
    );
    const select = dom.window.document.getElementById('ce-team-select');

    App._populateTeamSelect(select, ['team-a'], ['Club A']);
    expect(select.multiple).toBe(false);
    expect(Array.from(dom.window.document.querySelectorAll('#ce-team-list input')).map(input => input.type))
      .toEqual(['radio', 'radio']);

    App._setTeamOptionSelected('team-b', true);
    expect(Array.from(select.selectedOptions).map(option => option.value)).toEqual(['team-b']);
    expect(App._isTeamOnlySelectionValidForSubmit([{ id: 'team-a' }])).toBe(true);
    expect(App._isTeamOnlySelectionValidForSubmit([{ id: 'team-membership-only' }])).toBe(false);
    expect(App._isTeamOnlySelectionValidForSubmit([{ id: 'team-a' }, { id: 'team-b' }])).toBe(false);
    dom.window.close();
  });

  test('team-only create authorization mirrors user, built-in role, broad, and custom-role Rules paths', () => {
    const evaluate = ({
      role = 'user',
      permissions = [],
      capabilities = [],
      selectedIds = ['team-a'],
      staff = true,
      staleRouteTeam = false,
      editId = null,
      hasOnlyTeamScopedAddon = true,
    } = {}) => {
      const teams = [
        { id: 'team-a', name: 'Club A', active: true, leaderUids: staff ? ['viewer'] : [] },
        { id: 'team-b', name: 'Club B', active: true },
      ];
      const App = {
        _editEventId: editId,
        _getCurrentActivityRoleKey: () => role,
        _canManageAllActivities: () => permissions.includes('event.edit_all'),
        _hasActivityManageEntry: () => true,
        _hasUserActivityCapability: code => capabilities.includes(code),
        hasPermission: code => permissions.includes(code),
      };
      const ApiService = {
        getCurrentUser: () => ({ uid: 'viewer', role }),
        getTeamDirectory: () => teams,
        getTeam: id => {
          const team = teams.find(candidate => candidate.id === id) || null;
          return staleRouteTeam && team ? { ...team, leaderUids: [], coachUids: [] } : team;
        },
        getEvents: () => [],
      };
      const dom = loadUiModule(
        'js/modules/event/event-create-team-picker.js',
        '<div></div>',
        App,
        ApiService
      );
      const allowed = App._canCreateTeamOnlyActivityForSubmit(
        selectedIds.map(id => ({ id })),
        { hasOnlyTeamScopedAddon }
      );
      dom.window.close();
      return allowed;
    };

    expect(evaluate({
      permissions: ['activity.manage.entry'],
      capabilities: ['user.activity.basic_create', 'user.activity.addons_use'],
    })).toBe(false);
    expect(evaluate({ permissions: ['event.create', 'team.create_event'] })).toBe(true);
    expect(evaluate({
      permissions: ['event.create', 'team.create_event'],
      staleRouteTeam: true,
    })).toBe(true);
    expect(evaluate({
      permissions: ['event.create', 'team.create_event'],
      hasOnlyTeamScopedAddon: false,
    })).toBe(false);
    expect(evaluate({
      permissions: ['event.create', 'team.create_event'],
      capabilities: ['user.activity.basic_create', 'user.activity.addons_use'],
      hasOnlyTeamScopedAddon: false,
    })).toBe(true);
    expect(evaluate({
      permissions: ['event.edit_all'],
      capabilities: ['user.activity.basic_create', 'user.activity.addons_use'],
      selectedIds: ['team-a', 'team-b'],
      staff: false,
    })).toBe(true);
    expect(evaluate({ role: 'coach' })).toBe(true);
    expect(evaluate({ role: 'coach', staff: false })).toBe(false);
    expect(evaluate({ role: 'custom_manager' })).toBe(false);
    expect(evaluate({ role: 'user', editId: 'event-1', staff: false })).toBe(true);
  });
  test('activity managers retain multi-club team-only selection', () => {
    const teams = [
      { id: 'team-a', name: 'Club A', active: true },
      { id: 'team-b', name: 'Club B', active: true },
    ];
    const App = {
      _canManageAllActivities: () => true,
      _editEventId: null,
      _getEventCreatorTeam: () => ({ teamId: null, teamName: null }),
    };
    const ApiService = {
      getCurrentUser: () => ({ uid: 'manager' }),
      getTeamDirectory: () => teams,
      getTeam: id => teams.find(team => team.id === id) || null,
      getEvents: () => [],
    };
    const dom = loadUiModule(
      'js/modules/event/event-create-team-picker.js',
      '<input id="ce-team-only" type="checkbox" checked><div id="ce-team-only-label"></div><select id="ce-team-select"></select><div id="ce-team-picker"><input id="ce-team-search"><div id="ce-team-chips"></div><div id="ce-team-list"></div></div>',
      App,
      ApiService
    );
    const select = dom.window.document.getElementById('ce-team-select');

    App._populateTeamSelect(select, ['team-a', 'team-b'], ['Club A', 'Club B']);
    expect(select.multiple).toBe(true);
    expect(Array.from(select.selectedOptions).map(option => option.value)).toEqual(['team-a', 'team-b']);
    expect(Array.from(dom.window.document.querySelectorAll('#ce-team-list input')).map(input => input.type))
      .toEqual(['checkbox', 'checkbox']);
    expect(App._isTeamOnlySelectionValidForSubmit([{ id: 'team-a' }, { id: 'team-b' }])).toBe(true);
    dom.window.close();
  });

  test('non-manager activity edit locks and preserves the existing team-only scope', () => {
    const teams = [
      { id: 'team-a', name: 'Club A', active: true, leaderUids: ['viewer'] },
    ];
    const eventRecord = {
      id: 'event-1',
      teamOnly: true,
      creatorTeamIds: ['team-a', 'team-b'],
      creatorTeamNames: ['Club A', 'Club B'],
    };
    const App = {
      _canManageAllActivities: () => false,
      _editEventId: 'event-1',
      _getEventCreatorTeam: () => ({ teamId: null, teamName: null }),
    };
    const ApiService = {
      getCurrentUser: () => ({ uid: 'viewer' }),
      getTeamDirectory: () => teams,
      getTeam: id => teams.find(team => team.id === id) || null,
      getEvent: id => id === 'event-1' ? eventRecord : null,
      getEvents: () => [],
    };
    const dom = loadUiModule(
      'js/modules/event/event-create-team-picker.js',
      '<input id="ce-team-only" type="checkbox" checked><div id="ce-team-only-label"></div><select id="ce-team-select"></select><div id="ce-team-picker"><input id="ce-team-search"><div id="ce-team-chips"></div><div id="ce-team-list"></div></div>',
      App,
      ApiService
    );
    const select = dom.window.document.getElementById('ce-team-select');
    const toggle = dom.window.document.getElementById('ce-team-only');

    App._populateTeamSelect(select, eventRecord.creatorTeamIds, eventRecord.creatorTeamNames);
    expect(toggle.disabled).toBe(true);
    expect(select.dataset.teamScopeLocked).toBe('1');
    expect(Array.from(select.selectedOptions).map(option => option.value)).toEqual(['team-a', 'team-b']);
    expect(Array.from(dom.window.document.querySelectorAll('#ce-team-list input')).every(input => input.disabled))
      .toBe(true);
    expect(App._isTeamOnlySelectionValidForSubmit([{ id: 'team-a' }, { id: 'team-b' }])).toBe(true);
    expect(App._isTeamOnlySelectionValidForSubmit([{ id: 'team-a' }])).toBe(false);

    App._setTeamOptionSelected('team-b', false);
    expect(Array.from(select.selectedOptions).map(option => option.value)).toEqual(['team-a', 'team-b']);
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
    const teamDirectoryEnd = firebaseSource.indexOf('  async ensureUserDirectoryReady(options = {}) {');
    const teamDirectorySource = firebaseSource.slice(teamDirectoryStart, teamDirectoryEnd);

    expect(firebaseSource).toContain("'page-activities':      ['registrations', 'events']");
    expect(firebaseSource).toContain("'page-tournaments':     ['tournaments']");
    expect(firebaseSource).not.toContain("'page-activities':      ['registrations', 'events', 'users']");
    expect(firebaseSource).not.toContain("'page-tournaments':     ['tournaments', 'users']");
    expect(eventSearchSource).toContain('ApiService.ensureUserDirectoryReady');
    expect(firebaseSource).toContain("if (!fromCache) this._markCollectionsLoaded(['adminUsers'])");
    expect(firebaseSource).not.toContain("this._syncCurrentUserFromUsersSnapshot();\n              this._markCollectionsLoaded(['adminUsers']);");
    expect(tournamentSearchSource).toContain('ApiService.ensureUserDirectoryReady');
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
