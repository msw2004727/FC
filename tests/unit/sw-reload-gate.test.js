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
});

describe('Service Worker reload gate source wiring', () => {
  test('controllerchange delegates to App helper with legacy fallback', () => {
    const source = readProjectFile('index.html');
    expect(source).toContain("navigator.serviceWorker.addEventListener('controllerchange'");
    expect(source).toContain("window.App._handleSwControllerChange()");
    expect(source).toContain("!window._swReloading && !window._appInitializing && !window._swJustCleared");
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
