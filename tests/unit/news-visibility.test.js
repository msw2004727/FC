const fs = require('fs');
const path = require('path');
const vm = require('vm');

const apiServiceSource = fs.readFileSync(
  path.join(__dirname, '../../js/api-service.js'),
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
});
