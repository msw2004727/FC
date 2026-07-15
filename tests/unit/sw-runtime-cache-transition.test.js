const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '../..');
const swSource = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

function getRequestKey(request) {
  return typeof request === 'string' ? request : request.url;
}

function createSwHarness({ cacheNames = [], entries = {} } = {}) {
  const listeners = {};
  const names = [...cacheNames];
  const stores = new Map();

  const getStore = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  };
  Object.entries(entries).forEach(([name, values]) => {
    if (!names.includes(name)) names.push(name);
    const store = getStore(name);
    Object.entries(values).forEach(([url, response]) => store.set(url, response));
  });

  const cacheObjects = new Map();
  const getCache = (name) => {
    if (!cacheObjects.has(name)) {
      const store = getStore(name);
      cacheObjects.set(name, {
        add: jest.fn(async () => undefined),
        put: jest.fn(async (request, response) => {
          store.set(getRequestKey(request), response);
        }),
        match: jest.fn(async (request) => store.get(getRequestKey(request))),
        keys: jest.fn(async () => [...store.keys()].map(url => new Request(url))),
        delete: jest.fn(async (request) => store.delete(getRequestKey(request))),
      });
    }
    return cacheObjects.get(name);
  };

  const caches = {
    keys: jest.fn(async () => [...names]),
    delete: jest.fn(async (name) => {
      const index = names.indexOf(name);
      if (index >= 0) names.splice(index, 1);
      stores.delete(name);
      cacheObjects.delete(name);
      return index >= 0;
    }),
    open: jest.fn(async (name) => {
      if (!names.includes(name)) names.push(name);
      return getCache(name);
    }),
    match: jest.fn(async (request) => {
      const key = getRequestKey(request);
      for (const name of names) {
        const response = getStore(name).get(key);
        if (response) return response;
      }
      return undefined;
    }),
  };
  const fetchMock = jest.fn();
  const self = {
    addEventListener: jest.fn((type, handler) => { listeners[type] = handler; }),
    skipWaiting: jest.fn(),
    registration: {
      navigationPreload: { enable: jest.fn(async () => undefined) },
    },
    clients: { claim: jest.fn(async () => undefined) },
  };
  const sandbox = {
    self,
    caches,
    fetch: fetchMock,
    location: { origin: 'https://toosterx.test' },
    URL,
    Request,
    Response,
    Headers,
    console,
    setTimeout,
    clearTimeout,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    `${swSource}\n` +
      'globalThis.__swHelpers = {' +
        'CACHE_NAME, IMAGE_CACHE_NAME, isLegacyRuntimeCacheName, ' +
        'selectObsoleteRuntimeCaches, cleanupLegacyRuntimeCaches, ' +
        'isForeignAppVersionRequest' +
      '};',
    sandbox,
    { filename: 'sw.js', timeout: 1000 }
  );

  return {
    listeners,
    names,
    caches,
    fetchMock,
    self,
    helpers: sandbox.__swHelpers,
  };
}

function dispatchFetch(handler, request) {
  let responsePromise;
  const event = {
    request,
    respondWith: jest.fn(value => { responsePromise = Promise.resolve(value); }),
    waitUntil: jest.fn(),
  };
  handler(event);
  expect(event.respondWith).toHaveBeenCalledTimes(1);
  return responsePromise;
}

describe('Service Worker runtime cache transition behavior', () => {
  test('helper and activate retain only the newest formal previous runtime cache', async () => {
    const formalOld = [
      'sporthub-0.20260101',
      'sporthub-0.20260102a',
      'sporthub-0.20260103z',
    ];
    const unrelated = [
      'sporthub-images-v2',
      'sporthub-business-cache',
      'sporthub-0.old',
      'other-app-cache',
    ];
    const harness = createSwHarness({ cacheNames: [...formalOld, ...unrelated] });
    harness.names.push(harness.helpers.CACHE_NAME);

    expect(harness.helpers.selectObsoleteRuntimeCaches(harness.names)).toEqual([
      'sporthub-0.20260102a',
      'sporthub-0.20260101',
    ]);
    expect(harness.helpers.isLegacyRuntimeCacheName('sporthub-business-cache')).toBe(false);
    expect(harness.helpers.isLegacyRuntimeCacheName('sporthub-0.old')).toBe(false);

    let activation;
    const event = { waitUntil: jest.fn(value => { activation = value; }) };
    harness.listeners.activate(event);
    await activation;

    expect(harness.caches.delete.mock.calls.map(([name]) => name)).toEqual([
      'sporthub-0.20260102a',
      'sporthub-0.20260101',
    ]);
    expect(harness.names).toEqual(expect.arrayContaining([
      harness.helpers.CACHE_NAME,
      'sporthub-0.20260103z',
      ...unrelated,
    ]));
    expect(harness.names).not.toEqual(expect.arrayContaining([
      'sporthub-0.20260102a',
      'sporthub-0.20260101',
    ]));
    expect(harness.self.registration.navigationPreload.enable).toHaveBeenCalledTimes(1);
    expect(harness.self.clients.claim).toHaveBeenCalledTimes(1);
  });

  test.each(['js', 'css'])('old-version %s resolves from an exact cross-cache hit', async (extension) => {
    const oldVersion = '0.20260103z';
    const oldCache = `sporthub-${oldVersion}`;
    const url = `https://toosterx.test/assets/runtime.${extension}?v=${oldVersion}`;
    const harness = createSwHarness({
      cacheNames: [oldCache],
      entries: {
        [oldCache]: {
          [url]: new Response(`cached-${extension}`, { status: 200 }),
        },
      },
    });

    const response = await dispatchFetch(harness.listeners.fetch, new Request(url));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(`cached-${extension}`);
    expect(harness.caches.match).toHaveBeenCalledTimes(1);
    expect(harness.fetchMock).not.toHaveBeenCalled();
  });

  test.each(['js', 'css'])('uncached old-version %s returns 409 without fetching current bytes', async (extension) => {
    const oldVersion = '0.20260103z';
    const url = `https://toosterx.test/assets/runtime.${extension}?v=${oldVersion}`;
    const harness = createSwHarness();

    const response = await dispatchFetch(harness.listeners.fetch, new Request(url));

    expect(response.status).toBe(409);
    expect(response.headers.get('X-SportHub-Version-Miss')).toBe('1');
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(harness.fetchMock).not.toHaveBeenCalled();
  });
});
