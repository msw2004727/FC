const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createElement(value = '', options = {}) {
  const listeners = {};
  return {
    value,
    checked: !!options.checked,
    dataset: {},
    style: {},
    textContent: '',
    disabled: false,
    classList: {
      toggle: jest.fn(),
    },
    setAttribute: jest.fn(),
    listeners,
    addEventListener: jest.fn((type, handler) => {
      listeners[type] = handler;
    }),
    focus: jest.fn(),
  };
}

function loadDraft(featureEnabled = true, gpsEnabled = null) {
  const source = fs.readFileSync(
    path.join(__dirname, '../../js/modules/event/event-location-draft.js'),
    'utf8'
  );
  const elements = {
    'ce-location': createElement('Test Field'),
    'ce-location-status': createElement(),
    'ce-location-btn': createElement(),
    'ce-location-summary': createElement(),
    'ce-location-clear': createElement(),
  };
  if (gpsEnabled !== null) {
    elements['ce-gps-enabled'] = createElement('', { checked: !!gpsEnabled });
  }
  const document = {
    getElementById: jest.fn(id => elements[id] || null),
  };
  const sandbox = {
    window: { App: { showToast: jest.fn() } },
    document,
    console,
    Date,
    isActivityMapLocationPickerEnabled: () => featureEnabled,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return { App: sandbox.window.App, elements };
}

describe('event location draft state', () => {
  test('builds a confirmed map payload when the location text is unchanged', () => {
    const { App, elements } = loadDraft();

    App._setEventLocationDraft('ce', {
      lat: '25.026',
      lng: '121.543',
      mapAddress: 'Test Field',
      mapProvider: 'manual',
      mapLocationUpdatedAt: '2026-05-18T00:00:00.000Z',
    });

    expect(App._buildEventLocationPayload('ce', ' Test   Field ')).toEqual({
      lat: 25.026,
      lng: 121.543,
      mapAddress: 'Test Field',
      mapPlaceId: null,
      mapProvider: 'manual',
      mapLocationConfirmed: true,
      mapLocationUpdatedAt: '2026-05-18T00:00:00.000Z',
    });
    expect(elements['ce-location-status'].dataset.state).toBe('ready');
    expect(elements['ce-location-summary'].textContent).toBe('Test Field');
    expect(elements['ce-location-clear'].style.display).toBe('');
  });

  test('builds a confirmed template payload from the current draft', () => {
    const { App } = loadDraft();

    App._setEventLocationDraft('ce', {
      lat: '25.026',
      lng: '121.543',
      mapAddress: 'Saved Field',
      mapPlaceId: 'place-1',
      mapProvider: 'google',
      mapLocationUpdatedAt: '2026-05-18T00:00:00.000Z',
    });

    expect(App._buildEventLocationTemplatePayload('ce', ' Test   Field ')).toEqual({
      lat: 25.026,
      lng: 121.543,
      mapAddress: 'Saved Field',
      mapPlaceId: 'place-1',
      mapProvider: 'google',
      mapLocationConfirmed: true,
      mapLocationUpdatedAt: '2026-05-18T00:00:00.000Z',
    });
  });

  test('marks confirmed coordinates stale after the location text changes', () => {
    const { App, elements } = loadDraft();

    App._setEventLocationDraft('ce', {
      lat: 25.026,
      lng: 121.543,
      mapAddress: 'Test Field',
      mapProvider: 'manual',
    });
    elements['ce-location'].value = 'Other Field';
    App._markEventLocationStaleIfNeeded('ce');

    expect(elements['ce-location-status'].dataset.state).toBe('stale');
    expect(App._buildEventLocationPayload('ce', 'Other Field')).toEqual({
      lat: null,
      lng: null,
      mapAddress: null,
      mapPlaceId: null,
      mapProvider: null,
      mapLocationConfirmed: false,
      mapLocationUpdatedAt: null,
    });
  });

  test('restores confirmed coordinates from an activity template', () => {
    const { App, elements } = loadDraft();

    elements['ce-location'].value = 'Saved Field';
    App._restoreEventLocationTemplateDraft('ce', {
      location: 'Saved Field',
      lat: '24.151',
      lng: '120.681',
      mapAddress: 'Saved Field',
      mapPlaceId: 'place-2',
      mapProvider: 'google',
      mapLocationConfirmed: true,
      mapLocationUpdatedAt: '2026-05-18T01:00:00.000Z',
    });

    expect(App._buildEventLocationPayload('ce', 'Saved Field')).toEqual({
      lat: 24.151,
      lng: 120.681,
      mapAddress: 'Saved Field',
      mapPlaceId: 'place-2',
      mapProvider: 'google',
      mapLocationConfirmed: true,
      mapLocationUpdatedAt: '2026-05-18T01:00:00.000Z',
    });
    expect(elements['ce-location-status'].dataset.state).toBe('ready');
  });

  test('clears the draft when a loaded template has no confirmed coordinates', () => {
    const { App, elements } = loadDraft();

    App._setEventLocationDraft('ce', {
      lat: 25.026,
      lng: 121.543,
      mapAddress: 'Test Field',
      mapProvider: 'manual',
    });
    elements['ce-location'].value = 'Plain Field';
    App._restoreEventLocationTemplateDraft('ce', {
      location: 'Plain Field',
      mapLocationConfirmed: false,
    });

    expect(App._buildEventLocationPayload('ce', 'Plain Field')).toEqual({
      lat: null,
      lng: null,
      mapAddress: null,
      mapPlaceId: null,
      mapProvider: null,
      mapLocationConfirmed: false,
      mapLocationUpdatedAt: null,
    });
    expect(elements['ce-location-status'].dataset.state).toBe('empty');
  });

  test('disables picker controls when the preparation flag is off', () => {
    const { App, elements } = loadDraft(false);

    App._resetEventLocationDraft('ce', null);

    expect(elements['ce-location-btn'].disabled).toBe(true);
    expect(elements['ce-location-status'].dataset.state).toBe('disabled');
    expect(App._buildEventLocationPayload('ce', 'Test Field')).toEqual({});
    expect(App._buildEventLocationTemplatePayload('ce', 'Test Field')).toEqual({});
  });

  test('keeps the map button clickable but greyed out when GPS is off', async () => {
    const { App, elements } = loadDraft(true, false);

    App._setEventLocationDraft('ce', {
      lat: '25.026',
      lng: '121.543',
      mapAddress: 'Test Field',
      mapProvider: 'manual',
    });

    expect(elements['ce-location-btn'].disabled).toBe(false);
    expect(elements['ce-location-btn'].classList.toggle).toHaveBeenCalledWith('event-location-btn-disabled', true);
    expect(elements['ce-location-btn'].setAttribute).toHaveBeenCalledWith('aria-disabled', 'true');
    expect(elements['ce-location-status'].dataset.state).toBe('disabled');
    expect(App._buildEventLocationPayload('ce', 'Test Field')).toEqual({
      gpsEnabled: false,
      lat: null,
      lng: null,
      mapAddress: null,
      mapPlaceId: null,
      mapProvider: null,
      mapLocationConfirmed: false,
      mapLocationUpdatedAt: null,
    });

    await App.openEventLocationPickerFor('ce');
    expect(App.showToast).toHaveBeenCalledWith('請先至【進階功能】開啟GPS功能');
  });

  test('stores GPS state with confirmed map payload when the GPS toggle exists', () => {
    const { App } = loadDraft(true, true);

    App._setEventLocationDraft('ce', {
      lat: '25.026',
      lng: '121.543',
      mapAddress: 'Test Field',
      mapProvider: 'manual',
      mapLocationUpdatedAt: '2026-05-18T00:00:00.000Z',
    });

    expect(App._buildEventLocationPayload('ce', 'Test Field')).toEqual({
      gpsEnabled: true,
      lat: 25.026,
      lng: 121.543,
      mapAddress: 'Test Field',
      mapPlaceId: null,
      mapProvider: 'manual',
      mapLocationConfirmed: true,
      mapLocationUpdatedAt: '2026-05-18T00:00:00.000Z',
    });
  });
});
