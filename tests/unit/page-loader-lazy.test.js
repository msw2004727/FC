/** @jest-environment jsdom */

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.resolve(__dirname, '../../js/core/page-loader.js'),
  'utf8',
);

function createLoader(fragmentByName = {}) {
  document.body.innerHTML = '<main id="main-content"></main><div id="modal-container"></div>';
  sessionStorage.clear();

  const fetchCalls = [];
  const fetchImpl = jest.fn(async url => {
    fetchCalls.push(String(url));
    const match = String(url).match(/pages\/([^?]+)\.html/);
    const name = match ? match[1] : '';
    const html = fragmentByName[name]
      || (name === 'modals'
        ? '<div id="test-modal"></div>'
        : `<section class="page${name === 'home' ? ' active' : ''}" id="page-${name}"></section>`);
    return { ok: true, status: 200, text: async () => html };
  });

  const app = {
    _bindPageElements: jest.fn(),
    _activateBootHashShell: jest.fn(),
    _activateBootHistoryShell: jest.fn(),
    _resolveBootPageId: pageId => pageId,
  };
  const factory = new Function(
    'document',
    'window',
    'location',
    'sessionStorage',
    'fetch',
    'AbortController',
    'CACHE_VERSION',
    'App',
    `${source}; return PageLoader;`,
  );
  const loader = factory(
    document,
    window,
    window.location,
    sessionStorage,
    fetchImpl,
    AbortController,
    'test-version',
    app,
  );
  return { loader, fetchCalls, fetchImpl, app };
}

describe('PageLoader true lazy loading', () => {
  test('normal boot fetches only home and modals', async () => {
    const { loader, fetchCalls } = createLoader();
    window.requestIdleCallback = jest.fn();

    await loader.loadAll();

    expect(fetchCalls).toEqual(expect.arrayContaining([
      expect.stringContaining('pages/home.html'),
      expect.stringContaining('pages/modals.html'),
    ]));
    expect(fetchCalls.some(url => url.includes('pages/activity.html'))).toBe(false);
    expect(fetchCalls.some(url => url.includes('pages/team.html'))).toBe(false);
    expect(window.requestIdleCallback).not.toHaveBeenCalled();
    expect(document.getElementById('page-home')).not.toBeNull();
  });

  test('ensurePage fetches only the requested route fragment', async () => {
    const { loader, fetchCalls } = createLoader();
    await loader.loadAll();
    fetchCalls.length = 0;

    await loader.ensurePage('page-activities');

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]).toContain('pages/activity.html');
    expect(document.getElementById('page-activity')).not.toBeNull();
  });

  test('deep-link priority shares one in-flight fragment fetch', async () => {
    const { loader, fetchCalls } = createLoader({
      activity: '<section class="page" id="page-activity-detail"></section>',
    });
    sessionStorage.setItem('_pendingDeepEvent', 'event-1');

    const boot = loader.loadAll();
    const ensure = loader.ensurePage('page-activity-detail');
    await Promise.all([boot, ensure]);

    expect(fetchCalls.filter(url => url.includes('pages/activity.html'))).toHaveLength(1);
    expect(fetchCalls.filter(url => url.includes('pages/home.html'))).toHaveLength(1);
    expect(document.getElementById('page-activity-detail')).not.toBeNull();
  });
});
