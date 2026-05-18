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
  window.eval('var App = window.App;');
  window.eval('var escapeHTML = window.escapeHTML;');
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
});
