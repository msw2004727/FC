/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

function readModule(relPath) {
  return fs.readFileSync(path.join(__dirname, '../..', relPath), 'utf8');
}

function loadActivityMapModule() {
  window.App = {};
  window.escapeHTML = value => String(value ?? '');
  window.EVENT_SPORT_OPTIONS = [
    { key: 'football', label: '足球' },
    { key: 'basketball', label: '籃球' },
    { key: 'running', label: '跑步' },
  ];
  window.getSportKeySafe = key => {
    const raw = String(key || '').trim();
    return window.EVENT_SPORT_OPTIONS.some(item => item.key === raw) ? raw : '';
  };
  window.getSportLabelByKey = key => window.EVENT_SPORT_OPTIONS.find(item => item.key === key)?.label || '足球';
  window.eval('var App = window.App;');
  window.eval('var escapeHTML = window.escapeHTML;');
  window.eval('var EVENT_SPORT_OPTIONS = window.EVENT_SPORT_OPTIONS;');
  window.eval('var getSportKeySafe = window.getSportKeySafe;');
  window.eval('var getSportLabelByKey = window.getSportLabelByKey;');
  window.eval(readModule('js/modules/event/event-map.js'));
  return window.App;
}

function installGoogleMapsStub() {
  const listeners = [];
  const maps = [];
  class MapStub {
    constructor(el, options) {
      this.el = el;
      this.options = options;
      this.fitBounds = jest.fn();
      this.getCenter = jest.fn(() => options.center);
      this.setCenter = jest.fn();
      maps.push(this);
    }

    getDiv() {
      return this.el;
    }
  }
  class MarkerStub {
    constructor(options) {
      this.options = options;
      this.setMap = jest.fn();
    }

    addListener() {}
  }
  class LatLngBoundsStub {
    constructor() {
      this.points = [];
    }

    extend(point) {
      this.points.push(point);
    }
  }
  window.google = {
    maps: {
      Map: MapStub,
      Marker: MarkerStub,
      LatLngBounds: LatLngBoundsStub,
      MapTypeId: { ROADMAP: 'roadmap' },
      RenderingType: { RASTER: 'RASTER' },
      SymbolPath: { CIRCLE: 'CIRCLE' },
      event: {
        trigger: jest.fn(),
        addListenerOnce: jest.fn((target, name, callback) => {
          listeners.push({ target, name, callback });
          return { remove: jest.fn() };
        }),
      },
    },
  };
  return { listeners, maps };
}

describe('activity map Google render hardening', () => {
  let warnSpy;

  beforeEach(() => {
    jest.useFakeTimers();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    document.body.innerHTML = `
      <div id="activity-map-overlay" class="activity-map-overlay open">
        <div id="activity-map-stage"></div>
      </div>`;
    window.requestAnimationFrame = callback => {
      callback();
      return 1;
    };
  });

  afterEach(() => {
    warnSpy.mockRestore();
    jest.useRealTimers();
    delete window.google;
    delete window.requestAnimationFrame;
  });

  test('falls back to the static map when Google base tiles do not finish', () => {
    const App = loadActivityMapModule();
    const { maps } = installGoogleMapsStub();
    App._activityMapBuildBounds = jest.fn(() => ({}));
    App._activityMapProjectPoint = jest.fn(() => ({ x: 0.5, y: 0.5 }));
    const stage = document.getElementById('activity-map-stage');
    const data = {
      userLocation: { lat: 25, lng: 121 },
      mapReady: [
        { point: { lat: 25.1, lng: 121.1 }, event: { id: 'evt1', title: 'Test Event' } },
      ],
    };

    App._renderGoogleActivityMap(stage, data, {
      defaultCenter: { lat: 23.7, lng: 120.9 },
      googleTileFallbackMs: 1000,
      googleLayoutSettleDelaysMs: [],
    });
    jest.advanceTimersByTime(1001);

    expect(maps).toHaveLength(1);
    expect(stage.querySelector('.activity-map-static')).not.toBeNull();
    expect(App._activityMapGoogleMap).toBeNull();
  });

  test('uses stable raster roadmap rendering in the modal map', () => {
    const App = loadActivityMapModule();
    const { maps } = installGoogleMapsStub();
    const stage = document.getElementById('activity-map-stage');
    const data = {
      userLocation: null,
      mapReady: [
        { point: { lat: 25.1, lng: 121.1 }, event: { id: 'evt1', title: 'Test Event' } },
      ],
    };

    App._renderGoogleActivityMap(stage, data, {
      defaultCenter: { lat: 23.7, lng: 120.9 },
      googleTileFallbackMs: 1000,
      googleLayoutSettleDelaysMs: [],
    });

    expect(maps[0].options.mapTypeId).toBe('roadmap');
    expect(maps[0].options.renderingType).toBe('RASTER');
  });

  test('keeps Google map when tilesloaded fires before the fallback timeout', () => {
    const App = loadActivityMapModule();
    const { listeners } = installGoogleMapsStub();
    const stage = document.getElementById('activity-map-stage');
    const data = {
      userLocation: null,
      mapReady: [
        { point: { lat: 25.1, lng: 121.1 }, event: { id: 'evt1', title: 'Test Event' } },
      ],
    };

    App._renderGoogleActivityMap(stage, data, {
      defaultCenter: { lat: 23.7, lng: 120.9 },
      googleTileFallbackMs: 1000,
      googleLayoutSettleDelaysMs: [],
    });
    listeners.find(listener => listener.name === 'tilesloaded').callback();
    jest.advanceTimersByTime(1001);

    expect(stage.querySelector('.activity-google-map')).not.toBeNull();
    expect(stage.querySelector('.activity-map-static')).toBeNull();
  });

  test('activity map overlay avoids backdrop filters around Google map canvas', () => {
    const css = readModule('css/activity.css');
    const overlayRule = css.match(/\.activity-map-overlay\{([^}]+)\}/)?.[1] || '';

    expect(overlayRule).not.toContain('backdrop-filter');
    expect(overlayRule).not.toContain('-webkit-backdrop-filter');
  });

  test('activity map neutralizes global image fade on Google map tile images', () => {
    const baseCss = readModule('css/base.css');
    const css = readModule('css/activity.css');
    const tileImageRule = css.match(/\.activity-google-map\s+\.gm-style\s+img,\s*\.activity-google-map\s+img\{([^}]+)\}/)?.[1] || '';

    expect(baseCss).toMatch(/img\s*\{[^}]*opacity:\s*0/);
    expect(tileImageRule).toContain('max-width:none!important');
    expect(tileImageRule).toContain('opacity:1!important');
    expect(tileImageRule).toContain('transition:none!important');
  });

  test('nearby activity list is constrained to an internal scroll area', () => {
    const css = readModule('css/activity.css');

    expect(css).toContain('.activity-map-panel{width:100%;max-width:560px;height:100%;min-height:0');
    expect(css).toContain('.activity-map-sheet{flex:0 1 min(42vh,360px);min-height:128px;max-height:min(42vh,360px)');
    expect(css).toContain('.activity-map-list{flex:1 1 auto;min-height:0;overflow:auto');
  });
});

describe('activity map location and radius controls', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  afterEach(() => {
    delete window.navigator.permissions;
  });

  test('renders a persistent reopen location button in the map modal', () => {
    const App = loadActivityMapModule();
    App._ensureActivityMapRoot();

    const button = document.getElementById('activity-map-location-btn');
    expect(button).not.toBeNull();
    expect(button.getAttribute('onclick')).toBe('App.reopenActivityMapLocation()');
    expect(button.textContent).toMatch(/定位/);
  });

  test('renders 10/20/30km radius choices and updates the selected range', () => {
    const App = loadActivityMapModule();
    App._renderActivityMap = jest.fn().mockResolvedValue(undefined);
    App._ensureActivityMapRoot();

    const labels = Array.from(document.querySelectorAll('.activity-map-radius-btn')).map(btn => btn.textContent);
    expect(labels).toEqual(['10km', '20km', '30km']);
    expect(document.querySelector('.activity-map-radius-btn.active')?.textContent).toBe('10km');

    App.setActivityMapRadius(20);

    expect(App._ensureActivityMapState().radiusKm).toBe(20);
    expect(localStorage.getItem('toosterx.activityMap.radiusKm.v1')).toBe('20');
    expect(document.querySelector('.activity-map-radius-btn.active')?.textContent).toBe('20km');
  });

  test('renders sport and date filters in the map modal', () => {
    const App = loadActivityMapModule();
    App._renderActivityMap = jest.fn().mockResolvedValue(undefined);
    App._ensureActivityMapRoot();

    const sportOptions = Array.from(document.querySelectorAll('#activity-map-sport-filter option')).map(option => option.textContent);
    const dateOptions = Array.from(document.querySelectorAll('#activity-map-date-mode option')).map(option => option.value);
    expect(sportOptions).toEqual(['全部運動', '足球', '籃球', '跑步']);
    expect(dateOptions).toEqual(['all', 'today', 'tomorrow', '7', '15', '30', 'custom']);
    expect(document.getElementById('activity-map-custom-dates').hidden).toBe(true);

    App.setActivityMapDateMode('custom');

    expect(document.getElementById('activity-map-custom-dates').hidden).toBe(false);
  });

  test('filters positioned activities by the selected radius when location is available', () => {
    const App = loadActivityMapModule();
    App._getVisibleEvents = () => [
      { id: 'near', status: 'open', pointKey: 'near' },
      { id: 'far', status: 'open', pointKey: 'far' },
    ];
    App._activityMapGetEventPoint = event => ({ lat: event.pointKey === 'near' ? 1 : 2, lng: 121 });
    App._activityMapDistanceMeters = (_userLocation, point) => point.lat === 1 ? 9000 : 25000;
    App._ensureActivityMapState().userLocation = { lat: 25, lng: 121 };

    expect(App._getActivityMapData().mapReady.map(item => item.event.id)).toEqual(['near']);

    App._ensureActivityMapState().radiusKm = 30;

    expect(App._getActivityMapData().mapReady.map(item => item.event.id)).toEqual(['near', 'far']);
  });

  test('filters map candidates by modal sport and date range', () => {
    const App = loadActivityMapModule();
    const datePlus = days => {
      const date = new Date();
      date.setHours(10, 0, 0, 0);
      date.setDate(date.getDate() + days);
      return date.toISOString();
    };
    App._getVisibleEvents = () => [
      { id: 'football-soon', status: 'open', sportTag: 'football', date: datePlus(2), point: { lat: 1, lng: 1 } },
      { id: 'basket-soon', status: 'open', sportTag: 'basketball', date: datePlus(3), point: { lat: 2, lng: 2 } },
      { id: 'basket-later', status: 'open', sportTag: 'basketball', date: datePlus(9), point: { lat: 3, lng: 3 } },
    ];
    App._activityMapGetEventPoint = event => event.point;
    App._parseEventStartDate = value => new Date(value);
    App._ensureActivityMapState().sportKey = 'basketball';
    App._ensureActivityMapState().dateMode = '7';

    expect(App._getActivityMapData().mapReady.map(item => item.event.id)).toEqual(['basket-soon']);

    App._ensureActivityMapState().dateMode = 'custom';
    App._ensureActivityMapState().dateStart = datePlus(8).slice(0, 10);
    App._ensureActivityMapState().dateEnd = datePlus(10).slice(0, 10);

    expect(App._getActivityMapData().mapReady.map(item => item.event.id)).toEqual(['basket-later']);
  });

  test('filters map candidates by today and tomorrow date ranges', () => {
    const App = loadActivityMapModule();
    const datePlus = days => {
      const date = new Date();
      date.setHours(10, 0, 0, 0);
      date.setDate(date.getDate() + days);
      return date.toISOString();
    };
    App._getVisibleEvents = () => [
      { id: 'basket-today', status: 'open', sportTag: 'basketball', date: datePlus(0), point: { lat: 1, lng: 1 } },
      { id: 'basket-tomorrow', status: 'open', sportTag: 'basketball', date: datePlus(1), point: { lat: 2, lng: 2 } },
      { id: 'basket-day-two', status: 'open', sportTag: 'basketball', date: datePlus(2), point: { lat: 3, lng: 3 } },
    ];
    App._activityMapGetEventPoint = event => event.point;
    App._parseEventStartDate = value => new Date(value);
    App._ensureActivityMapState().sportKey = 'basketball';

    App._ensureActivityMapState().dateMode = 'today';
    expect(App._getActivityMapData().mapReady.map(item => item.event.id)).toEqual(['basket-today']);

    App._ensureActivityMapState().dateMode = 'tomorrow';
    expect(App._getActivityMapData().mapReady.map(item => item.event.id)).toEqual(['basket-tomorrow']);
  });

  test('does not request geolocation again when the browser reports denied permission', async () => {
    const App = loadActivityMapModule();
    App._renderActivityMap = jest.fn().mockResolvedValue(undefined);
    App.showToast = jest.fn();
    App.refreshActivityMapLocation = jest.fn();
    App._ensureActivityMapRoot();
    App._ensureActivityMapState().userLocation = { lat: 25, lng: 121 };

    const permissionStatus = { state: 'denied', onchange: null };
    Object.defineProperty(window.navigator, 'permissions', {
      configurable: true,
      value: { query: jest.fn().mockResolvedValue(permissionStatus) },
    });

    const result = await App.reopenActivityMapLocation();

    expect(result).toBeNull();
    expect(App.refreshActivityMapLocation).not.toHaveBeenCalled();
    expect(App._ensureActivityMapState().locationStatus).toBe('blocked');
    expect(App._ensureActivityMapState().userLocation).toBeNull();
    expect(document.getElementById('activity-map-location-btn')?.dataset.permission).toBe('denied');
    expect(App.showToast).toHaveBeenCalled();
  });
});
