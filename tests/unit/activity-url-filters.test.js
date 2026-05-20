const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '../..');
const helperSource = fs.readFileSync(
  path.join(root, 'js/modules/event/event-list-helpers.js'),
  'utf8'
);
const themeSource = fs.readFileSync(
  path.join(root, 'js/core/theme.js'),
  'utf8'
);

function loadActivityHelpers(href = 'https://toosterx.com/activities') {
  const typeInput = { value: '' };
  const keywordInput = { value: '' };
  const elements = {
    'activity-filter-type': typeInput,
    'activity-filter-keyword': keywordInput,
  };
  const context = {
    App: {},
    console,
    URL,
    URLSearchParams,
    EVENT_SPORT_OPTIONS: [
      { key: 'football', label: 'Football' },
      { key: 'basketball', label: 'Basketball' },
      { key: 'restaurant', label: 'Restaurant' },
    ],
    getSportKeySafe(key) {
      const raw = String(key || '').trim();
      return context.EVENT_SPORT_OPTIONS.some(item => item.key === raw) ? raw : '';
    },
    document: {
      getElementById: jest.fn(id => elements[id] || null),
      querySelector: jest.fn(() => null),
      querySelectorAll: jest.fn(() => []),
    },
    history: {
      replaceState: jest.fn((state, title, target) => {
        context.__lastHistoryTarget = target;
        const nextUrl = new URL(target, context.window.location.origin);
        context.window.location = nextUrl;
        context.location = nextUrl;
      }),
      pushState: jest.fn((state, title, target) => {
        context.__lastHistoryTarget = target;
        const nextUrl = new URL(target, context.window.location.origin);
        context.window.location = nextUrl;
        context.location = nextUrl;
      }),
    },
    localStorage: {
      setItem: jest.fn(),
    },
  };
  context.window = {
    location: new URL(href),
    EVENT_SPORT_OPTIONS: context.EVENT_SPORT_OPTIONS,
  };
  context.location = context.window.location;

  vm.createContext(context);
  vm.runInContext(helperSource, context, { filename: 'event-list-helpers.js' });
  return { context, app: context.App, typeInput, keywordInput };
}

describe('activity URL filters', () => {
  test('does not let saved sport picker state overwrite a shared activity URL on boot', () => {
    expect(themeSource).toContain('const activityUrlSport = new URLSearchParams');
    expect(themeSource).toContain("window.location.search || App._bootActivityFilterSearch || ''");
    expect(themeSource).toContain('syncUrl: options.syncUrl !== false');
    expect(themeSource).toContain('setActiveSport(initialSport, { syncUrl: false })');
  });

  test('parses stable shared activity filters from URL slugs', () => {
    const { app, context } = loadActivityHelpers(
      'https://toosterx.com/activities?region=north&sport=basketball&tab=calendar&type=play'
    );

    expect(app._readActivityUrlFilters(context.window.location)).toMatchObject({
      hasExplicit: true,
      region: '北部',
      sport: 'basketball',
      tab: 'calendar',
      type: 'play',
    });
    expect(app._getActivityListRoutePath('/activities')).toBe(
      '/activities?region=north&sport=basketball&tab=calendar&type=play'
    );
  });

  test('keeps safe non-route query params and removes stale route params', () => {
    const { app } = loadActivityHelpers(
      'https://toosterx.com/teams?team=abc123&debug=1&region=central'
    );

    expect(app._composeActivityRoutePath('/activities', {
      region: '南部',
      sport: 'all',
      tab: 'normal',
      type: '',
    })).toBe('/activities?debug=1&region=south&sport=all');
  });

  test('can apply boot-captured filters after early navigation strips the visible query', () => {
    const { app, context } = loadActivityHelpers('https://toosterx.com/activities');
    app._bootActivityFilterSearch = '?region=north&sport=basketball&type=watch';

    expect(app._readActivityUrlFilters(context.window.location)).toMatchObject({
      hasExplicit: true,
      region: '北部',
      sport: 'basketball',
      tab: 'normal',
      type: 'watch',
    });
  });

  test('clears boot-captured filters once they have been applied', () => {
    const { app } = loadActivityHelpers('https://toosterx.com/activities');
    app._bootActivityFilterSearch = '?region=south&sport=all';
    app.currentPage = 'page-activities';

    expect(app._applyActivityUrlFilters({ replace: true })).toBe(true);
    expect(app._activeRegionTab).toBe('南部');
    expect(app._bootActivityFilterSearch).toBe('');
  });

  test('writes the current activity filter state to the clean activity URL', () => {
    const { app, context, typeInput } = loadActivityHelpers('https://toosterx.com/activities');
    app.currentPage = 'page-activities';
    app._activeRegionTab = '南部';
    app._activeSport = 'all';
    app._activityActiveTab = 'normal';
    typeInput.value = '';

    expect(app._syncActivityUrlFilters({ replace: true })).toBe(true);
    expect(context.history.replaceState).toHaveBeenCalledWith(
      { source: 'sportshub', pageId: 'page-activities' },
      '',
      '/activities?region=south&sport=all'
    );
  });

  test('uses the visible sport picker state when writing the activity URL', () => {
    const { app, context, typeInput } = loadActivityHelpers('https://toosterx.com/activities');
    context.document.querySelector.mockImplementation(selector => {
      if (selector === '.sport-picker-item.active[data-sport]') {
        return { getAttribute: () => 'basketball' };
      }
      return null;
    });
    app.currentPage = 'page-activities';
    app._activeRegionTab = '南部';
    app._activeSport = 'all';
    app._activityActiveTab = 'normal';
    typeInput.value = '';

    expect(app._syncActivityUrlFilters({ replace: true })).toBe(true);
    expect(context.__lastHistoryTarget).toBe('/activities?region=south&sport=basketball');
  });

  test('applies shared URL filters without triggering render-time URL recursion', () => {
    const { app, typeInput, keywordInput } = loadActivityHelpers(
      'https://toosterx.com/activities?region=east-islands&sport=basketball&tab=female&type=camp'
    );
    app.currentPage = 'page-activities';
    app.setActiveSportFilter = jest.fn(function(sport, options) {
      this._activeSport = sport;
      this.__sportOptions = options;
      return sport;
    });
    app._setActivityTab = jest.fn(function(tab, options) {
      this._activityActiveTab = tab;
      this.__tabOptions = options;
    });

    expect(app._applyActivityUrlFilters({ replace: true })).toBe(true);
    expect(app._activeRegionTab).toBe('東部&外島');
    expect(app._activeSport).toBe('basketball');
    expect(app._activityActiveTab).toBe('female');
    expect(typeInput.value).toBe('camp');
    expect(keywordInput.value).toBe('');
    expect(app.__sportOptions).toMatchObject({ render: false, syncUrl: false });
    expect(app.__tabOptions).toMatchObject({ render: false, syncUrl: false });
  });
});
