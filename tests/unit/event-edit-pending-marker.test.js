/** @jest-environment jsdom */

const fs = require('fs');
const path = require('path');

const LIFECYCLE_SOURCE = fs.readFileSync(
  path.join(__dirname, '../../js/modules/event/event-manage-lifecycle.js'),
  'utf8'
);

function installLifecycle(marker) {
  const event = { id: 'event-existing', type: 'external' };
  const App = {
    _eventSubmitInFlight: false,
    _pendingSingleEventSubmission: null,
    _pendingMultiDateSubmission: null,
    _readPendingSingleEventMarker: jest.fn(() => marker),
    _getEventFormAuthUid: jest.fn(() => 'owner-1'),
    _canEditOwnActivityBasic: jest.fn(() => true),
    _canEditExternalActivity: jest.fn(() => true),
    _openCreateCustomEventModal: jest.fn(),
    openCreateExternalEventModal: jest.fn(),
    showToast: jest.fn(),
  };
  const ApiService = {
    getEvent: jest.fn(() => event),
  };
  new Function('App', 'ApiService', LIFECYCLE_SOURCE)(App, ApiService);
  return { App, ApiService };
}

describe('existing activity edit pending-create marker guard', () => {
  test.each([
    ['valid pending marker', { version: 2, kind: 'single', creatorUid: 'owner-1', intentId: 'ce_pending' }],
    ['invalid pending marker', { invalid: true, creatorUid: 'owner-1' }],
  ])('%s remains fail-closed', (_label, marker) => {
    const { App } = installLifecycle(marker);

    App.editMyActivity('event-existing');

    expect(App.showToast).toHaveBeenCalledWith('請先確認上一筆活動的建立結果，再進行編輯');
    expect(App._openCreateCustomEventModal).toHaveBeenCalledTimes(1);
    expect(App.openCreateExternalEventModal).not.toHaveBeenCalled();
  });

  test('unavailable marker storage does not masquerade as a pending create', () => {
    const { App } = installLifecycle({ unavailable: true, creatorUid: 'owner-1' });

    App.editMyActivity('event-existing');

    expect(App.showToast).not.toHaveBeenCalledWith('請先確認上一筆活動的建立結果，再進行編輯');
    expect(App._openCreateCustomEventModal).not.toHaveBeenCalled();
    expect(App.openCreateExternalEventModal).toHaveBeenCalledWith('event-existing');
  });
});
