const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '../..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function quietConsole() {
  return {
    error: jest.fn(),
    warn: jest.fn(),
    log: jest.fn(),
  };
}

function loadEventList(scriptLoader = {}) {
  const dom = new JSDOM(
    '<!doctype html><body>'
      + '<button id="activity-create-btn"></button>'
      + '<button id="my-activity-create-btn"></button>'
      + '</body>',
    { url: 'https://toosterx.test/activities' }
  );
  const App = { currentPage: 'page-home', showToast: jest.fn() };
  const context = vm.createContext({
    window: dom.window,
    document: dom.window.document,
    App,
    ApiService: { getCurrentUser: jest.fn(() => ({ uid: 'user-1' })) },
    ScriptLoader: {
      ensureGroup: jest.fn(async () => {}),
      loadGroup: jest.fn(async () => {}),
      ...scriptLoader,
    },
    console: quietConsole(),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: callback => callback(),
    URL,
    URLSearchParams,
  });
  context.globalThis = context;
  vm.runInContext(readProjectFile('js/modules/event/event-list.js'), context, {
    filename: 'event-list.js',
  });
  return {
    App,
    ScriptLoader: context.ScriptLoader,
    document: dom.window.document,
  };
}

function loadEventCreate(overrides = {}, options = {}) {
  const dom = new JSDOM('<!doctype html><body></body>', {
    url: 'https://toosterx.test/activities',
  });
  const optionMethods = options.withOptions === false ? {} : {
    _setEventFeeFormState: jest.fn(),
    _setEventRegOpenTimeValue: jest.fn(),
    _setGenderRestrictionState: jest.fn(),
    _setPrivateEventState: jest.fn(),
    bindEventFeeToggle: jest.fn(),
    bindGenderRestrictionToggle: jest.fn(),
    bindPrivateEventToggle: jest.fn(),
  };
  const App = {
    _requireProtectedActionLogin: jest.fn(() => false),
    _getCurrentActivityRoleKey: jest.fn(() => 'user'),
    _ensureActivityRoleCapabilitiesReady: jest.fn(async () => ['roleActivityCapabilities']),
    _canCreateActivityByPermission: jest.fn(() => true),
    _requireActivityCreateProfileComplete: jest.fn(() => false),
    _showCreateEventTypeSheet: jest.fn(),
    showToast: jest.fn(),
    ...optionMethods,
    ...overrides,
  };
  const context = vm.createContext({
    window: dom.window,
    document: dom.window.document,
    App,
    ApiService: {},
    FirebaseService: {},
    ScriptLoader: {
      loadGroup: jest.fn(async () => {}),
      ...(options.scriptLoader || {}),
    },
    console: quietConsole(),
    setTimeout,
    clearTimeout,
    URL,
    Blob: dom.window.Blob,
  });
  context.globalThis = context;
  vm.runInContext(readProjectFile('js/modules/event/event-create.js'), context, {
    filename: 'event-create.js',
  });
  return { App, ScriptLoader: context.ScriptLoader };
}

async function flushPromiseJobs() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function runInlineHandler(button, globals) {
  const context = vm.createContext({
    ...globals,
    button,
    console: quietConsole(),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  });
  context.globalThis = context;
  vm.runInContext(
    `(function () { ${button.getAttribute('onclick')} }).call(button);`,
    context,
    { filename: 'activity-create-inline-handler.js' }
  );
}

function loadActivityCreateFlow(ensureCapabilities) {
  const dom = new JSDOM(
    '<!doctype html><body>'
      + '<button id="activity-create-btn"></button>'
      + '<button id="my-activity-create-btn"></button>'
      + '</body>',
    { url: 'https://toosterx.test/activities' }
  );
  const App = {
    currentPage: 'page-activities',
    _pageTransitionSeq: 7,
    _getCurrentActivityRoleKey: jest.fn(() => 'user'),
    _ensureActivityRoleCapabilitiesReady: ensureCapabilities,
    _requireProtectedActionLogin: jest.fn(() => false),
    _beginSwLazyContinuation: jest.fn(),
    _endSwLazyContinuation: jest.fn(),
    showToast: jest.fn(),
    _setEventFeeFormState: jest.fn(),
    _setEventRegOpenTimeValue: jest.fn(),
    _setGenderRestrictionState: jest.fn(),
    _setPrivateEventState: jest.fn(),
    bindEventFeeToggle: jest.fn(),
    bindGenderRestrictionToggle: jest.fn(),
    bindPrivateEventToggle: jest.fn(),
  };
  const ScriptLoader = {
    ensureGroup: jest.fn(async () => {}),
    loadGroup: jest.fn(async () => {}),
  };
  const context = vm.createContext({
    window: dom.window,
    document: dom.window.document,
    App,
    ApiService: {
      getCurrentUser: jest.fn(() => ({
        uid: 'user-1',
        gender: 'male',
        birthday: '2000-01-01',
        region: 'taipei',
      })),
    },
    FirebaseService: {},
    ScriptLoader,
    console: quietConsole(),
    setTimeout,
    clearTimeout,
    requestAnimationFrame: callback => callback(),
    URL,
    URLSearchParams,
    Blob: dom.window.Blob,
  });
  context.globalThis = context;
  vm.runInContext(readProjectFile('js/modules/event/event-list.js'), context, {
    filename: 'event-list.js',
  });
  vm.runInContext(readProjectFile('js/modules/event/event-create.js'), context, {
    filename: 'event-create.js',
  });
  App._canCreateActivityByPermission = jest.fn(() => true);
  App._showCreateEventTypeSheet = jest.fn();
  return { App, ScriptLoader };
}

describe('activity create cold-start entry', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('two quick CTA clicks share one load and restore both buttons', async () => {
    let resolveGroup;
    const groupPromise = new Promise(resolve => { resolveGroup = resolve; });
    const ensureGroup = jest.fn(() => groupPromise);
    const { App, document } = loadEventList({ ensureGroup });
    const openModal = jest.fn(async () => true);

    const first = App.openActivityCreateEvent();
    const second = App.openActivityCreateEvent();
    const primary = document.getElementById('activity-create-btn');
    const manage = document.getElementById('my-activity-create-btn');

    expect(primary.disabled).toBe(true);
    expect(manage.disabled).toBe(true);
    expect(primary.getAttribute('aria-busy')).toBe('true');
    expect(ensureGroup).toHaveBeenCalledTimes(1);
    expect(ensureGroup).toHaveBeenCalledWith('activityCreate');

    App.openCreateEventModal = openModal;
    resolveGroup();

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(openModal).toHaveBeenCalledTimes(1);
    expect(primary.disabled).toBe(false);
    expect(manage.disabled).toBe(false);
    expect(primary.hasAttribute('aria-busy')).toBe(false);
    expect(App._activityCreateEntryPromise).toBeNull();
  });

  test('page-switch cancellation restores both CTAs immediately and isolates an immediate retry', async () => {
    const oldLoader = deferred();
    const newLoader = deferred();
    const ensureGroup = jest.fn()
      .mockImplementationOnce(() => oldLoader.promise)
      .mockImplementationOnce(() => newLoader.promise);
    const { App, document } = loadEventList({ ensureGroup });
    App.currentPage = 'page-activities';
    App._pageTransitionSeq = 7;
    App._beginSwLazyContinuation = jest.fn();
    App._endSwLazyContinuation = jest.fn();
    App.openCreateEventModal = jest.fn(async () => true);
    const primary = document.getElementById('activity-create-btn');
    const manage = document.getElementById('my-activity-create-btn');

    const oldOpening = App.openActivityCreateEvent();
    expect(primary.disabled).toBe(true);
    expect(manage.disabled).toBe(true);
    expect(primary.getAttribute('aria-busy')).toBe('true');

    App.currentPage = 'page-teams';
    App._pageTransitionSeq = 8;
    expect(App._cancelActivityCreateEntry('page-switch')).toBe(true);
    expect(primary.disabled).toBe(false);
    expect(manage.disabled).toBe(false);
    expect(primary.hasAttribute('aria-busy')).toBe(false);
    expect(App._activityCreateEntryPromise).toBeNull();
    await expect(oldOpening).resolves.toBe(false);
    expect(App._endSwLazyContinuation).toHaveBeenCalledTimes(1);

    App.currentPage = 'page-activities';
    App._pageTransitionSeq = 9;
    const newOpening = App.openActivityCreateEvent();
    const newEntryPromise = App._activityCreateEntryPromise;
    expect(newEntryPromise).not.toBeNull();
    expect(primary.disabled).toBe(true);

    oldLoader.resolve();
    await flushPromiseJobs();
    expect(App.openCreateEventModal).not.toHaveBeenCalled();
    expect(App._activityCreateEntryPromise).toBe(newEntryPromise);
    expect(primary.disabled).toBe(true);

    newLoader.resolve();
    await expect(newOpening).resolves.toBe(true);
    expect(App.openCreateEventModal).toHaveBeenCalledTimes(1);
    expect(primary.disabled).toBe(false);
    expect(manage.disabled).toBe(false);
    expect(App._activityCreateEntryPromise).toBeNull();
    expect(App._beginSwLazyContinuation).toHaveBeenCalledTimes(2);
    expect(App._endSwLazyContinuation).toHaveBeenCalledTimes(2);
  });

  test('entry timeout reports failure, restores state, and permits an immediate retry', async () => {
    jest.useFakeTimers();
    const ensureGroup = jest.fn()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce(undefined);
    const { App, document } = loadEventList({
      ensureGroup,
    });
    App._activityCreateEntryTimeoutMs = 50;
    App.openCreateEventModal = jest.fn(async () => true);
    const manage = document.getElementById('my-activity-create-btn');
    manage.disabled = true;

    const firstOpening = App.openActivityCreateEvent();
    await jest.advanceTimersByTimeAsync(50);

    await expect(firstOpening).resolves.toBe(false);
    expect(App.showToast).toHaveBeenCalledWith(expect.stringContaining('載入逾時'));
    expect(document.getElementById('activity-create-btn').disabled).toBe(false);
    expect(manage.disabled).toBe(true);
    expect(manage.hasAttribute('aria-busy')).toBe(false);
    expect(App._activityCreateEntryPromise).toBeNull();

    await expect(App.openActivityCreateEvent()).resolves.toBe(true);
    expect(ensureGroup).toHaveBeenCalledTimes(2);
    expect(App.openCreateEventModal).toHaveBeenCalledTimes(1);
    expect(App._activityCreateEntryPromise).toBeNull();
  });

  test('an old loader missing create options self-heals before opening', async () => {
    let app;
    const loadGroup = jest.fn(async () => {
      app._getActivityCreateOptionMethodNames().forEach(name => {
        app[name] = jest.fn();
      });
    });
    const loaded = loadEventCreate({}, {
      withOptions: false,
      scriptLoader: { loadGroup },
    });
    app = loaded.App;

    await expect(app._ensureActivityCreateOptionsReady()).resolves.toBe(true);
    expect(loadGroup).toHaveBeenCalledWith(['js/modules/event/event-create-options.js']);
  });
});

describe('activity create mixed-version compatibility', () => {
  test.each(['activity-create-btn', 'my-activity-create-btn'])(
    'new activity HTML %s loads the complete legacy activity group and calls the old entry',
    async buttonId => {
      const dom = new JSDOM(readProjectFile('pages/activity.html'));
      const button = dom.window.document.getElementById(buttonId);
      const legacyEntry = jest.fn(async () => true);
      const App = { showToast: jest.fn() };
      const ScriptLoader = {
        ensureGroup: jest.fn(async groupName => {
          expect(groupName).toBe('activity');
          App.openHomeCreateEvent = legacyEntry;
        }),
      };

      runInlineHandler(button, {
        App,
        ScriptLoader,
        _withSportHubTimeout: promise => promise,
      });

      expect(button.disabled).toBe(true);
      expect(button.getAttribute('aria-busy')).toBe('true');
      await flushPromiseJobs();

      expect(ScriptLoader.ensureGroup).toHaveBeenCalledWith('activity');
      expect(legacyEntry).toHaveBeenCalledTimes(1);
      expect(App.showToast).not.toHaveBeenCalled();
      expect(button.disabled).toBe(false);
      expect(button.hasAttribute('aria-busy')).toBe(false);
    }
  );

  test.each(['activity-create-btn', 'my-activity-create-btn'])(
    'new activity HTML %s cancels stale legacy handoff and restores both CTAs before timeout',
    async buttonId => {
      jest.useFakeTimers();
      try {
        const dom = new JSDOM(readProjectFile('pages/activity.html'));
        const button = dom.window.document.getElementById(buttonId);
        const primary = dom.window.document.getElementById('activity-create-btn');
        const manage = dom.window.document.getElementById('my-activity-create-btn');
        const loader = deferred();
        const legacyEntry = jest.fn(async () => true);
        const App = {
          currentPage: 'page-activities',
          _pageTransitionSeq: 4,
          showToast: jest.fn(),
          openHomeCreateEvent: legacyEntry,
        };
        const ScriptLoader = {
          ensureGroup: jest.fn(() => loader.promise),
        };

        runInlineHandler(button, {
          App,
          ScriptLoader,
          _withSportHubTimeout: promise => promise,
        });

        expect(primary.disabled).toBe(true);
        expect(manage.disabled).toBe(true);
        App.currentPage = 'page-teams';
        App._pageTransitionSeq = 5;
        jest.advanceTimersByTime(25);

        expect(primary.disabled).toBe(false);
        expect(manage.disabled).toBe(false);
        expect(primary.hasAttribute('aria-busy')).toBe(false);
        expect(manage.hasAttribute('aria-busy')).toBe(false);
        expect(App._activityCreateCompatEntry).toBeNull();

        loader.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(legacyEntry).not.toHaveBeenCalled();
        expect(App.showToast).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    }
  );

  test('mixed-version handoff prefers the freshly loaded guarded entry over the legacy navigator', async () => {
    const dom = new JSDOM(readProjectFile('pages/activity.html'));
    const button = dom.window.document.getElementById('activity-create-btn');
    const freshEntry = jest.fn(async () => true);
    const legacyEntry = jest.fn(async () => true);
    const App = {
      currentPage: 'page-activities',
      _pageTransitionSeq: 9,
      showToast: jest.fn(),
      openHomeCreateEvent: legacyEntry,
    };
    const ScriptLoader = {
      ensureGroup: jest.fn(async () => {
        App.openActivityCreateEvent = freshEntry;
      }),
    };

    runInlineHandler(button, {
      App,
      ScriptLoader,
      _withSportHubTimeout: promise => promise,
    });
    await flushPromiseJobs();

    expect(freshEntry).toHaveBeenCalledTimes(1);
    expect(legacyEntry).not.toHaveBeenCalled();
    expect(App._activityCreateCompatEntry).toBeNull();
    expect(dom.window.document.getElementById('activity-create-btn').disabled).toBe(false);
    expect(dom.window.document.getElementById('my-activity-create-btn').disabled).toBe(false);
  });
});

describe('activity create capability refresh gate', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('concurrent callers share one forced refresh', async () => {
    let resolveRefresh;
    const refreshPromise = new Promise(resolve => { resolveRefresh = resolve; });
    const ensureCapabilities = jest.fn(() => refreshPromise);
    const { App } = loadEventCreate({
      _ensureActivityRoleCapabilitiesReady: ensureCapabilities,
    });

    const first = App._ensureFreshActivityRoleCapabilitiesForCreate();
    const second = App._ensureFreshActivityRoleCapabilitiesForCreate();
    expect(ensureCapabilities).toHaveBeenCalledTimes(1);
    expect(ensureCapabilities).toHaveBeenCalledWith({ force: true });

    resolveRefresh(['roleActivityCapabilities']);
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    await Promise.resolve();
    expect(App._activityRoleCapabilityRefreshPromise).toBeNull();
  });

  test('timeout stays fail-closed and never opens the create sheet', async () => {
    jest.useFakeTimers();
    const ensureCapabilities = jest.fn(() => new Promise(() => {}));
    const { App } = loadEventCreate({
      _ensureActivityRoleCapabilitiesReady: ensureCapabilities,
    });
    App._showCreateEventTypeSheet = jest.fn();
    App._activityRoleCapabilityRefreshTimeoutMs = 50;

    const opening = App.openCreateEventModal();
    await jest.advanceTimersByTimeAsync(50);

    await expect(opening).resolves.toBe(false);
    expect(App._showCreateEventTypeSheet).not.toHaveBeenCalled();
    expect(App.showToast).toHaveBeenCalledWith(expect.stringContaining('權限資料載入逾時'));
    expect(App._activityRoleCapabilityRefreshPromise).toBeNull();
  });

  test('leaving the activity route during capability refresh opens nothing and balances SW continuations', async () => {
    let resolveCapabilities;
    const ensureCapabilities = jest.fn(() => new Promise(resolve => {
      resolveCapabilities = resolve;
    }));
    const { App } = loadActivityCreateFlow(ensureCapabilities);

    const opening = App.openActivityCreateEvent();
    await flushPromiseJobs();
    expect(ensureCapabilities).toHaveBeenCalledWith({ force: true });

    App.currentPage = 'page-teams';
    App._pageTransitionSeq += 1;
    resolveCapabilities(['roleActivityCapabilities']);

    await expect(opening).resolves.toBe(false);
    expect(App._showCreateEventTypeSheet).not.toHaveBeenCalled();
    expect(App.showToast).not.toHaveBeenCalled();
    expect(App._beginSwLazyContinuation).toHaveBeenCalledTimes(2);
    expect(App._endSwLazyContinuation).toHaveBeenCalledTimes(2);
    expect(App._endSwLazyContinuation.mock.calls.map(call => call[0])).toEqual([
      'activity-create-modal-ready',
      'activity-create-entry-complete',
    ]);
  });

  test('permission failure always clears submit busy state', async () => {
    const { App } = loadEventCreate();
    App._ensureFreshActivityRoleCapabilitiesForCreate = jest.fn(async () => false);
    App._setCreateEventSubmitting = jest.fn();

    await App.handleCreateEvent();

    expect(App._setCreateEventSubmitting).toHaveBeenCalledWith(true);
    expect(App._setCreateEventSubmitting).toHaveBeenLastCalledWith(false);
    expect(App._eventSubmitInFlight).toBe(false);
  });
});
