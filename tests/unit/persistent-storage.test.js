const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '../..');

function readModule() {
  return fs.readFileSync(path.join(root, 'js/modules/persistent-storage.js'), 'utf8');
}

function createContext(options = {}) {
  const timers = [];
  const document = {
    readyState: options.readyState || 'complete',
    addEventListener: jest.fn(),
  };
  const sandbox = {
    App: {},
    FirebaseService: options.currentUser ? { _cache: { currentUser: options.currentUser } } : { _cache: {} },
    LineAuth: options.lineLoggedIn == null ? undefined : { isLoggedIn: jest.fn(() => options.lineLoggedIn) },
    console: { debug: jest.fn(), log: jest.fn() },
    document,
    matchMedia: jest.fn(() => ({ matches: !!options.standalone })),
    navigator: {
      standalone: !!options.navigatorStandalone,
      storage: options.storage,
    },
    Promise,
    setTimeout: jest.fn((fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    }),
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readModule(), sandbox, { filename: 'js/modules/persistent-storage.js' });
  return { sandbox, timers };
}

function createStorage(overrides = {}) {
  return {
    persisted: jest.fn(() => Promise.resolve(!!overrides.persisted)),
    estimate: jest.fn(() => Promise.resolve(overrides.estimate || { usage: 100, quota: 1000 })),
    persist: jest.fn(() => Promise.resolve(overrides.persistResult !== false)),
  };
}

describe('persistent storage request helper', () => {
  test('unsupported StorageManager is skipped without throwing', async () => {
    const { sandbox } = createContext({ storage: {} });

    await expect(sandbox.App.requestPersistentStorage('test')).resolves.toMatchObject({
      ok: false,
      supported: false,
      skipped: 'unsupported',
    });
  });

  test('visitor boot only schedules eligibility checks and does not call persist', async () => {
    const storage = createStorage();
    const { sandbox, timers } = createContext({ storage });

    expect(timers[0].ms).toBe(0);
    await timers[0].fn();

    expect(sandbox.App.maybeRequestPersistentStorage).toBeDefined();
    expect(storage.persisted).not.toHaveBeenCalled();
    expect(storage.persist).not.toHaveBeenCalled();
  });

  test('standalone mode requests persistent storage once', async () => {
    const storage = createStorage({ estimate: { usage: 10, quota: 200 } });
    const { sandbox, timers } = createContext({ storage, standalone: true });

    await timers[0].fn();
    const first = await sandbox.App.maybeRequestPersistentStorage('manual');
    const second = await sandbox.App.requestPersistentStorage('manual-again');

    expect(storage.persisted).toHaveBeenCalledTimes(1);
    expect(storage.estimate).toHaveBeenCalledTimes(1);
    expect(storage.persist).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ ok: true, supported: true, persisted: true, reason: 'standalone-boot' });
    expect(second).toBe(first);
    expect(sandbox.__toosterxPersistentStorageLastResult).toBe(first);
  });

  test('logged-in user can request persistent storage without standalone mode', async () => {
    const storage = createStorage({ persisted: true });
    const { sandbox } = createContext({
      storage,
      currentUser: { uid: 'U-persist' },
    });

    const result = await sandbox.App.maybeRequestPersistentStorage('auth-ready-check');

    expect(storage.persisted).toHaveBeenCalledTimes(1);
    expect(storage.persist).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      supported: true,
      persisted: true,
      alreadyPersisted: true,
      reason: 'auth-ready-check',
    });
  });
});
