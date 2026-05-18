const fs = require('fs');
const path = require('path');
const vm = require('vm');

const apiServiceSource = fs.readFileSync(
  path.join(__dirname, '../../js/api-service.js'),
  'utf8'
);
const newsSource = fs.readFileSync(
  path.join(__dirname, '../../js/modules/news.js'),
  'utf8'
);

function loadApiService({ gameConfigs = [], lazyLoaded = {} } = {}) {
  const sandbox = {
    console,
    document: {},
    HOME_GAME_PRESETS: [],
    FirebaseService: {
      _cache: { gameConfigs },
      _lazyLoaded: lazyLoaded,
    },
    App: {
      showToast: jest.fn(),
      _setSyncState: jest.fn(),
    },
  };
  vm.runInNewContext(`${apiServiceSource}\nthis.ApiService = ApiService;`, sandbox, {
    filename: 'js/api-service.js',
  });
  return sandbox.ApiService;
}

function createDomElement() {
  return {
    style: {},
    innerHTML: '',
    querySelectorAll: () => [],
  };
}

function loadNewsApp({ visible = false, articles = [] } = {}) {
  const elements = {
    'news-section-title': createDomElement(),
    'news-tabs': createDomElement(),
    'news-card-list': createDomElement(),
    'news-divider': createDomElement(),
  };
  const sandbox = {
    console,
    App: {
      _bindSwipeTabs: jest.fn(),
    },
    ApiService: {
      isNewsVisible: jest.fn(() => visible),
      getNewsArticles: jest.fn(() => articles),
    },
    document: {
      getElementById: jest.fn(id => elements[id] || null),
    },
    EVENT_SPORT_OPTIONS: [],
    EVENT_SPORT_MAP: {},
    escapeHTML: value => String(value ?? ''),
    location: { href: '' },
  };
  vm.runInNewContext(newsSource, sandbox, {
    filename: 'js/modules/news.js',
  });
  return { App: sandbox.App, elements };
}

describe('homepage news visibility', () => {
  test('stays hidden before game config visibility has loaded', () => {
    const ApiService = loadApiService();

    expect(ApiService.isNewsVisible()).toBe(false);
  });

  test('honors disabled news-section config from cache', () => {
    const ApiService = loadApiService({
      gameConfigs: [{ id: 'news-section', gameKey: 'news-section', homeVisible: false }],
    });

    expect(ApiService.isNewsVisible()).toBe(false);
  });

  test('can show news after configs have loaded when no explicit config exists', () => {
    const ApiService = loadApiService({
      lazyLoaded: { gameConfigs: true },
    });

    expect(ApiService.isNewsVisible()).toBe(true);
  });

  test('hides the news card container when news is disabled', () => {
    const { App, elements } = loadNewsApp({ visible: false });

    App.renderNews();

    expect(elements['news-section-title'].style.display).toBe('none');
    expect(elements['news-tabs'].style.display).toBe('none');
    expect(elements['news-divider'].style.display).toBe('none');
    expect(elements['news-card-list'].style.display).toBe('none');
    expect(elements['news-card-list'].innerHTML).toBe('');
  });

  test('restores the news card container when visible articles exist', () => {
    const { App, elements } = loadNewsApp({
      visible: true,
      articles: [{
        title: 'Sport update',
        source: 'Test',
        url: 'https://example.com/news',
        publishedAt: '2026-05-18T00:00:00.000Z',
      }],
    });

    elements['news-card-list'].style.display = 'none';
    App.renderNews();

    expect(elements['news-section-title'].style.display).toBe('');
    expect(elements['news-card-list'].style.display).toBe('');
    expect(elements['news-card-list'].innerHTML).toContain('Sport update');
  });
});
