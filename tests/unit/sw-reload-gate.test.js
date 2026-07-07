const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '../..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function loadApp(html = '<!doctype html><body><div id="toast"></div></body>') {
  const dom = new JSDOM(html, { url: 'https://toosterx.test/#page-home' });
  const document = dom.window.document;
  document.addEventListener = jest.fn();

  const sandbox = {
    window: dom.window,
    document,
    location: dom.window.location,
    navigator: dom.window.navigator,
    sessionStorage: dom.window.sessionStorage,
    localStorage: dom.window.localStorage,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: (fn) => fn(),
    ApiService: {
      _writeErrorLog: jest.fn(),
      getCurrentUser: jest.fn(() => null),
    },
    _withSportHubTimeout: (promise) => promise,
    AUTH_REQUIRED_PAGES: [],
    HISTORY_ROUTE_FLAGS: {},
    PAGE_META_MAP: {},
    PAGE_STRATEGY: {},
    CACHE_VERSION: 'test',
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`${readProjectFile('app.js')}\nglobalThis.__App = App;`, sandbox, {
    filename: 'app.js',
    timeout: 1000,
  });
  return { App: sandbox.__App, window: dom.window, document };
}

describe('Service Worker reload gate helper', () => {
  test('safe list page can auto reload when no dangerous state exists', () => {
    const { App, window } = loadApp();
    window._contentReady = true;
    App.currentPage = 'page-home';

    expect(App._isSafeToAutoReload()).toEqual({
      safe: true,
      reason: 'safe',
      canPrompt: false,
    });
  });

  test('initializing and just-cleared states block without prompting', () => {
    const { App, window } = loadApp();
    App.currentPage = 'page-home';

    window._appInitializing = true;
    expect(App._isSafeToAutoReload()).toMatchObject({
      safe: false,
      reason: 'initializing',
      canPrompt: false,
    });

    window._appInitializing = false;
    window._swJustCleared = true;
    expect(App._isSafeToAutoReload()).toMatchObject({
      safe: false,
      reason: 'just-cleared',
      canPrompt: false,
    });
  });

  test('open modal and image cropper block auto reload', () => {
    const { App, document } = loadApp('<!doctype html><body><div id="toast"></div><div class="modal open"></div></body>');
    App.currentPage = 'page-home';

    expect(App._isSafeToAutoReload()).toMatchObject({ safe: false, reason: 'modal-open' });

    document.querySelector('.modal').classList.remove('open');
    document.body.classList.add('image-cropper-open');
    expect(App._isSafeToAutoReload()).toMatchObject({ safe: false, reason: 'image-cropper-open' });
  });

  test('pending writes, scanner and unsafe pages block auto reload', () => {
    const { App } = loadApp();
    App.currentPage = 'page-home';
    App._waitlistActionPending = { 'event-1:user-1': true };
    expect(App._isSafeToAutoReload()).toMatchObject({ safe: false, reason: 'write-pending' });

    App._waitlistActionPending = null;
    App._scannerInstance = {};
    expect(App._isSafeToAutoReload()).toMatchObject({ safe: false, reason: 'scanner-active' });

    App._scannerInstance = null;
    App.currentPage = 'page-game';
    expect(App._isSafeToAutoReload()).toMatchObject({ safe: false, reason: 'unsafe-page' });
  });

  test('controllerchange defers unsafe reload once and shows one prompt', () => {
    const { App, window, document } = loadApp('<!doctype html><body><div id="toast"></div><div class="modal open"></div></body>');
    App.currentPage = 'page-home';

    const result = App._handleSwControllerChange();

    expect(result).toMatchObject({ reloaded: false, deferred: true, reason: 'modal-open' });
    expect(window._swReloadDeferred).toBe(true);
    expect(window._swReloadDeferredReason).toBe('modal-open');
    expect(document.querySelectorAll('#sw-reload-deferred-prompt')).toHaveLength(1);

    App._handleSwControllerChange();
    expect(document.querySelectorAll('#sw-reload-deferred-prompt')).toHaveLength(1);
  });

  test('user-click can force deferred reload from a non-safe page', () => {
    const { App, window } = loadApp();
    App.currentPage = 'page-game';

    expect(App._handleSwControllerChange()).toMatchObject({
      reloaded: false,
      deferred: true,
      reason: 'unsafe-page',
    });
    expect(window._swReloadDeferred).toBe(true);

    App._reloadForServiceWorkerUpdate = jest.fn(() => ({ reloaded: true, reason: 'safe' }));

    const result = App._maybeRunDeferredSwReload('user-click', { force: true });

    expect(App._reloadForServiceWorkerUpdate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ reloaded: true, reason: 'safe' });
  });

  test('user-click still blocks hard reload risks', () => {
    const { App, window } = loadApp();
    App.currentPage = 'page-home';
    App._waitlistActionPending = { 'event-1:user-1': true };
    window._swReloadDeferred = true;
    App._reloadForServiceWorkerUpdate = jest.fn(() => ({ reloaded: true, reason: 'safe' }));

    const result = App._maybeRunDeferredSwReload('user-click', { force: true });

    expect(App._reloadForServiceWorkerUpdate).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      reloaded: false,
      deferred: true,
      reason: 'write-pending',
    });
  });

  test('later button clears prompt flag so the prompt can be shown again', () => {
    const { App, window, document } = loadApp();

    App._showSwReloadPrompt({ reason: 'unsafe-page' });
    document.querySelector('[data-sw-reload-later]').click();

    expect(document.querySelectorAll('#sw-reload-deferred-prompt')).toHaveLength(0);
    expect(window._swReloadPromptShown).toBe(false);

    App._showSwReloadPrompt({ reason: 'unsafe-page' });
    expect(document.querySelectorAll('#sw-reload-deferred-prompt')).toHaveLength(1);
  });
});

function readCacheVersionBootstrapScript() {
  const source = readProjectFile('index.html');
  const match = source.match(/<script>\s*\r?\n\s*\(function\(\)\{\r?\n\s*var V='[^']+';[\s\S]*?\r?\n\s*\}\)\(\);\r?\n\s*<\/script>/);
  expect(match).toBeTruthy();
  const version = match[0].match(/var V='([^']+)'/)[1];
  const script = match[0]
    .replace(/^<script>\s*\r?\n/, '')
    .replace(/\r?\n\s*<\/script>$/, '');
  return { script, version };
}

function createLocalStorageLike(initial = {}) {
  const storage = { ...initial };
  Object.defineProperties(storage, {
    getItem: {
      value: jest.fn(key => (Object.prototype.hasOwnProperty.call(storage, key) ? String(storage[key]) : null)),
      enumerable: false,
    },
    setItem: {
      value: jest.fn((key, value) => { storage[key] = String(value); }),
      enumerable: false,
    },
    removeItem: {
      value: jest.fn(key => { delete storage[key]; }),
      enumerable: false,
    },
  });
  return storage;
}

function runCacheVersionBootstrap({ search = '', initialStorage = {} } = {}) {
  const { script, version } = readCacheVersionBootstrapScript();
  const localStorage = createLocalStorageLike(initialStorage);
  const sessionStorage = createLocalStorageLike();
  const caches = {
    keys: jest.fn(() => Promise.resolve(['sporthub-0.old', 'sporthub-images-v2'])),
    delete: jest.fn(() => Promise.resolve(true)),
  };
  const registrations = [{ unregister: jest.fn() }];
  const serviceWorker = {
    getRegistrations: jest.fn(() => Promise.resolve(registrations)),
  };
  const indexedDB = {
    databases: jest.fn(() => Promise.resolve([{ name: 'firebaseLocalStorageDb' }])),
    deleteDatabase: jest.fn(),
  };
  const sandbox = {
    console,
    URLSearchParams,
    location: { search, pathname: '/index.html', replace: jest.fn() },
    localStorage,
    sessionStorage,
    navigator: { serviceWorker },
    caches,
    indexedDB,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox, { filename: 'index.html cache version bootstrap' });
  return { ...sandbox, version, registrations };
}

function flushMicrotasks() {
  return Promise.resolve().then(() => Promise.resolve()).then(() => Promise.resolve());
}

describe('Cache version bootstrap behavior', () => {
  test('ordinary version change preserves SW, caches and display cache while setting the crossover flag', () => {
    const ctx = runCacheVersionBootstrap({
      initialStorage: {
        sporthub_cache_ver: '0.old',
        shub_c_currentUser: 'keep-user-cache',
        shub_ts_U1: 'keep-uid-ts',
        shub_cache_ts: 'keep-global-ts',
      },
    });

    expect(ctx._swJustCleared).toBe(true);
    expect(ctx.caches.keys).not.toHaveBeenCalled();
    expect(ctx.caches.delete).not.toHaveBeenCalled();
    expect(ctx.navigator.serviceWorker.getRegistrations).not.toHaveBeenCalled();
    expect(ctx.localStorage.removeItem).not.toHaveBeenCalled();
    expect(ctx.localStorage.getItem('shub_c_currentUser')).toBe('keep-user-cache');
    expect(ctx.localStorage.getItem('shub_ts_U1')).toBe('keep-uid-ts');
    expect(ctx.localStorage.getItem('shub_cache_ts')).toBe('keep-global-ts');
    expect(ctx.localStorage.setItem).toHaveBeenCalledWith('sporthub_cache_ver', ctx.version);
  });

  test('clear query keeps the full reset escape hatch', async () => {
    const ctx = runCacheVersionBootstrap({
      search: '?clear=1&debug=1',
      initialStorage: {
        sporthub_cache_ver: '0.old',
        shub_c_currentUser: 'drop-user-cache',
        shub_ts_U1: 'drop-uid-ts',
        shub_cache_ts: 'drop-global-ts',
        LIFF_STORE: 'drop-liff-cache',
        keep_unrelated: 'stay',
      },
    });

    await flushMicrotasks();

    expect(ctx.caches.keys).toHaveBeenCalledTimes(1);
    expect(ctx.caches.delete).toHaveBeenCalledWith('sporthub-0.old');
    expect(ctx.caches.delete).toHaveBeenCalledWith('sporthub-images-v2');
    expect(ctx.navigator.serviceWorker.getRegistrations).toHaveBeenCalledTimes(1);
    expect(ctx.registrations[0].unregister).toHaveBeenCalledTimes(1);
    expect(ctx.localStorage.removeItem).toHaveBeenCalledWith('shub_c_currentUser');
    expect(ctx.localStorage.removeItem).toHaveBeenCalledWith('shub_ts_U1');
    expect(ctx.localStorage.removeItem).toHaveBeenCalledWith('shub_cache_ts');
    expect(ctx.localStorage.removeItem).toHaveBeenCalledWith('LIFF_STORE');
    expect(ctx.localStorage.getItem('keep_unrelated')).toBe('stay');
    expect(ctx.indexedDB.deleteDatabase).toHaveBeenCalledWith('firebaseLocalStorageDb');
    expect(ctx.sessionStorage.setItem).toHaveBeenCalledWith('_bootWatchdog', '2');
    expect(ctx.localStorage.setItem).toHaveBeenCalledWith('sporthub_cache_ver', ctx.version);
    expect(ctx.location.replace).toHaveBeenCalledWith('/index.html?debug=1');
  });
});
describe('Service Worker reload gate source wiring', () => {
  test('controllerchange delegates to App helper with legacy fallback', () => {
    const source = readProjectFile('index.html');
    expect(source).toContain("navigator.serviceWorker.addEventListener('controllerchange'");
    expect(source).toContain("window.App._handleSwControllerChange()");
    expect(source).toContain("!window._swReloading && !window._appInitializing && !window._swJustCleared");
    expect(source).toContain("_maybeRunDeferredSwReload('user-click', { force: true })");
  });

  test('deferred reload is retried after route, modal, scanner and cropper completion', () => {
    expect(readProjectFile('js/core/navigation.js')).toContain("_maybeRunDeferredSwReload?.('route-complete')");
    expect(readProjectFile('js/core/navigation.js')).toContain("_maybeRunDeferredSwReload?.('modal-close')");
    expect(readProjectFile('js/modules/scan/scan-camera.js')).toContain("_maybeRunDeferredSwReload?.('scanner-stop')");
    expect(readProjectFile('js/modules/image-cropper.js')).toContain("_maybeRunDeferredSwReload?.('image-cropper-close')");
  });

  test('inline runtime mirrors app.js after adding the reload gate', () => {
    const indexSource = readProjectFile('index.html').replace(/\r\n/g, '\n');
    const appSource = readProjectFile('app.js').replace(/\r\n/g, '\n').trim();
    const match = indexSource.match(/<script id="app-inline-runtime">\r?\n([\s\S]*?)\r?\n\s*<\/script>/);

    expect(match).toBeTruthy();
    expect(match[1].trim()).toBe(appSource);
    expect(match[1]).toContain('_isSafeToAutoReload()');
  });
});
