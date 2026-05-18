/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

function readModule(relPath) {
  return fs.readFileSync(path.join(__dirname, '../..', relPath), 'utf8');
}

function loadEventLocationModules() {
  window.App = { showToast: jest.fn() };
  window.ActivityMapGeo = {
    normalizePoint(input) {
      const lat = Number(input?.lat);
      const lng = Number(input?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
      return { lat, lng };
    },
  };
  window.ACTIVITY_MAP_CONFIG = { googleApiKey: '' };
  window.isActivityMapLocationPickerEnabled = () => true;
  window.eval('var App = window.App;');
  window.eval('var ACTIVITY_MAP_CONFIG = window.ACTIVITY_MAP_CONFIG;');
  window.eval('var isActivityMapLocationPickerEnabled = window.isActivityMapLocationPickerEnabled;');
  window.eval(readModule('js/modules/event/event-location-draft.js'));
  window.eval(readModule('js/modules/event/event-location-picker.js'));
  return window.App;
}

function googleScriptCount() {
  return Array.from(document.querySelectorAll('script[src*="maps.googleapis.com"]')).length;
}

describe('event location picker lazy behavior', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '<input id="ce-location" value="Test Field">';
  });

  test('opening the picker does not load Google Maps automatically', async () => {
    const App = loadEventLocationModules();

    await App.openEventLocationPicker({ formPrefix: 'ce', locationText: 'Test Field' });

    expect(document.getElementById('event-location-picker-overlay')).not.toBeNull();
    expect(document.getElementById('event-location-picker-overlay').classList.contains('open')).toBe(true);
    expect(googleScriptCount()).toBe(0);
  });

  test('search without an API key keeps the flow manual and avoids Google script load', async () => {
    const App = loadEventLocationModules();
    await App.openEventLocationPicker({ formPrefix: 'ce', locationText: 'Test Field' });

    await App.searchEventLocationByAddress();

    expect(document.getElementById('event-location-result').textContent).toContain('尚未設定 Google Maps key');
    expect(googleScriptCount()).toBe(0);
  });

  test('manual coordinates confirm into the event location draft', async () => {
    const App = loadEventLocationModules();
    await App.openEventLocationPicker({ formPrefix: 'ce', locationText: 'Test Field' });
    document.getElementById('event-location-lat').value = '25.026';
    document.getElementById('event-location-lng').value = '121.543';
    document.getElementById('event-location-address').value = 'Test Field';

    App.confirmEventLocationPicker();

    expect(App._buildEventLocationPayload('ce', 'Test Field')).toMatchObject({
      lat: 25.026,
      lng: 121.543,
      mapAddress: 'Test Field',
      mapProvider: 'manual',
      mapLocationConfirmed: true,
    });
    expect(document.getElementById('event-location-picker-overlay').classList.contains('open')).toBe(false);
  });

  test('manual coordinate edits clear stale Google place attribution', async () => {
    const App = loadEventLocationModules();
    await App.openEventLocationPicker({ formPrefix: 'ce', locationText: 'Test Field' });

    App._eventLocationGooglePlaceId = 'stale-place-id';
    document.getElementById('event-location-lat').dispatchEvent(new Event('input', { bubbles: true }));

    expect(App._eventLocationGooglePlaceId).toBe('');
  });
});
