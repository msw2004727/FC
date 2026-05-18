const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadGeo() {
  const source = fs.readFileSync(
    path.join(__dirname, '../../js/modules/event/event-map-geo.js'),
    'utf8'
  );
  const sandbox = { window: { App: {} } };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.window.ActivityMapGeo;
}

describe('ActivityMapGeo', () => {
  const geo = loadGeo();

  test('normalizes valid coordinates and rejects invalid values', () => {
    expect(geo.normalizePoint({ lat: '24.15', lng: 120.67 })).toEqual({ lat: 24.15, lng: 120.67 });
    expect(geo.normalizePoint({ lat: 91, lng: 120 })).toBeNull();
    expect(geo.normalizePoint({ lat: 24, lng: 'bad' })).toBeNull();
  });

  test('filters unconfirmed event map locations', () => {
    expect(geo.getEventPoint({ lat: 24, lng: 121 })).toBeNull();
    expect(geo.getEventPoint({ lat: 24, lng: 121, mapLocationConfirmed: false })).toBeNull();
    expect(geo.getEventPoint({ lat: 24, mapLocationConfirmed: true })).toBeNull();
    expect(geo.getEventPoint({ lat: 24, lng: 121, mapLocationConfirmed: true })).toEqual({ lat: 24, lng: 121 });
  });

  test('calculates stable distance in meters', () => {
    const distance = geo.distanceMeters({ lat: 24.151, lng: 120.646 }, { lat: 24.152, lng: 120.646 });
    expect(distance).toBeGreaterThan(100);
    expect(distance).toBeLessThan(130);
  });

  test('projects points within map bounds', () => {
    const bounds = geo.buildBounds([{ lat: 24.1, lng: 120.6 }, { lat: 24.2, lng: 120.7 }]);
    const projected = geo.projectPoint({ lat: 24.15, lng: 120.65 }, bounds);
    expect(projected.x).toBeGreaterThan(0);
    expect(projected.x).toBeLessThan(1);
    expect(projected.y).toBeGreaterThan(0);
    expect(projected.y).toBeLessThan(1);
  });
});
