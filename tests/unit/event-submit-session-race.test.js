const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..', '..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushPromiseJobs() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
}

function makeEvent(id, title) {
  return {
    id,
    title,
    type: 'play',
    status: 'open',
    location: `${title} Field`,
    date: '2099/01/01 14:00~16:00',
    max: 20,
    current: 0,
    minAge: 0,
    notes: '',
    sportTag: 'football',
    delegates: [{ uid: 'delegate-same', name: 'Same Delegate' }],
    delegateUids: ['delegate-same'],
    teamOnly: false,
    privateEvent: false,
  };
}

function loadHarness(verifyUserDirectorySelection) {
  const dom = new JSDOM(`<!doctype html><body>
    <div id="modal-overlay"></div>
    <div id="create-event-modal" class="modal">
      <button class="modal-close" onclick="App.closeModal()">close</button>
      <button id="ce-submit-btn">save</button>
      <input id="ce-title">
      <select id="ce-type"><option value="play">play</option></select>
      <input id="ce-location">
      <input id="ce-date">
      <input id="ce-time-start" value="14:00">
      <input id="ce-time-end" value="16:00">
      <input id="ce-fee-enabled" type="checkbox">
      <input id="ce-fee" value="0">
      <input id="ce-max" value="20">
      <input id="ce-waitlist" value="0">
      <input id="ce-min-age" value="0">
      <textarea id="ce-notes"></textarea>
      <input id="ce-sport-tag" value="football">
      <input id="ce-team-only" type="checkbox">
      <select id="ce-team-select"></select>
      <input id="ce-gender-restriction-enabled" type="checkbox">
      <input id="ce-private-event" type="checkbox">
      <input id="ce-image" type="file">
      <div id="ce-upload-preview"></div>
      <input id="ce-delegate-search">
      <div id="ce-delegate-dropdown"></div>
      <div id="ce-delegate-tags"></div>
    </div>
  </body>`, { url: 'https://toosterx.test/activities' });
  const events = new Map([
    ['event-a', makeEvent('event-a', 'Event A')],
    ['event-b', makeEvent('event-b', 'Event B')],
  ]);
  const updateEventAwait = jest.fn(async () => true);
  const createEvent = jest.fn(async () => true);
  const createEventsAtomic = jest.fn(async () => true);
  const App = {
    currentPage: 'page-activities',
    currentRole: 'admin',
    showToast: jest.fn(),
  };
  const ApiService = {
    getCurrentUser: jest.fn(() => ({ uid: 'owner-1', role: 'admin', name: 'Owner' })),
    getEvent: jest.fn(id => events.get(id) || null),
    getRegistrationsByEvent: jest.fn(() => []),
    getAdminUsers: jest.fn(() => []),
    getUserDirectory: jest.fn(() => [{ uid: 'delegate-same', name: 'Same Delegate', role: 'user' }]),
    verifyUserDirectorySelection,
    updateEventAwait,
    createEvent,
    createEventsAtomic,
    _writeOpLog: jest.fn(),
    _writeErrorLog: jest.fn(),
  };
  const auth = { currentUser: { uid: 'owner-1' } };
  const sandbox = {
    App,
    ApiService,
    FirebaseService: {},
    window: dom.window,
    document: dom.window.document,
    MutationObserver: dom.window.MutationObserver,
    auth,
    console: { error: jest.fn(), warn: jest.fn(), log: jest.fn() },
    getSportKeySafe: value => String(value || '').trim(),
    escapeHTML: value => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;'),
    generateId: () => 'ce-created',
    GRADIENT_MAP: { play: '#123', friendly: '#456' },
    REGION_MAP: {},
    URL,
    Blob: dom.window.Blob,
    setTimeout,
    clearTimeout,
  };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(readProjectFile('js/modules/event/event-create.js'), context, { filename: 'event-create.js' });
  vm.runInContext(readProjectFile('js/modules/event/event-create-delegates.js'), context, { filename: 'event-create-delegates.js' });
  vm.runInContext(readProjectFile('js/modules/event/event-manage-lifecycle.js'), context, { filename: 'event-manage-lifecycle.js' });

  Object.assign(App, {
    _canEditOwnActivityBasic: () => true,
    _canCreateBasicActivity: () => true,
    _canManageEventDelegates: () => true,
    _canManageCourseLinkedEventDelegates: () => false,
    _canManageAllActivities: () => true,
    _hasActivityManageEntry: () => true,
    _requireProfileComplete: () => false,
    _ensureFreshActivityRoleCapabilitiesForCreate: jest.fn(async options => options?.entryGuard?.() !== false),
    _formatCreateTimeValue: value => String(value || ''),
    _getEventRegOpenTimeValue: () => '',
    _getEventMinAgeFormValue: () => 0,
    _getAllowedGenderValue: () => '',
    _tsGetFormData: () => null,
    _getEventSocialLinksFormData: () => ({ enabled: false, links: [] }),
    _getEventEarlyBirdFormData: () => ({ enabled: false, cost: 0 }),
    _getEventGpsFormData: () => ({ enabled: false }),
    _regionGetFormData: () => ({ regionEnabled: false, region: '', cities: [] }),
    _canUseActivityAddons: () => true,
    _buildEventLocationPayload: () => ({}),
    _isEventTrulyFull: () => false,
    _hasEventChangeNotificationDiff: () => false,
    _collectEventNotifyRecipientUids: () => new Set(),
    _adjustWaitlistOnCapacityChange: jest.fn(async () => true),
    _refreshTeamDetailAfterEventSave: jest.fn(async () => true),
    _getEventCreatorName: () => 'Owner',
    _getEventCreatorUid: () => 'owner-1',
    _resolveEventCoverImage: jest.fn(async () => 'cover-url'),
    _isMultiDateMode: () => false,
    _saveInputHistory: jest.fn(),
    _saveRecentDelegates: jest.fn(),
    _grantAutoExp: jest.fn(),
    _clearEventLocationDraft: jest.fn(),
    _resetEventLocationDraft: jest.fn(),
    _bindEventLocationInputs: jest.fn(),
    _setEventFeeFormState: jest.fn(),
    _setEventAgeLimitState: jest.fn(),
    _setEventRegOpenTimeValue: jest.fn(),
    _setGenderRestrictionState: jest.fn(),
    _setPrivateEventState: jest.fn(),
    _setEventSocialLinksFormData: jest.fn(),
    _setEventEarlyBirdFormData: jest.fn(),
    _setEventGpsFormData: jest.fn(),
    _regionSetFormData: jest.fn(),
    _tsSetFormData: jest.fn(),
    _updateCreateTimeSummary: jest.fn(),
    _resetMultiDates: jest.fn(),
    _initMultiDatePicker: jest.fn(),
    _initSportTagPicker: jest.fn(),
    _renderHistoryChips: jest.fn(),
    _renderRecentDelegateChips: jest.fn(),
    _renderTemplateSelector: jest.fn(),
    _ensureEventTemplatesReady: jest.fn(async () => true),
    _updateTeamOnlyLabel: jest.fn(),
    bindEventImageVariantUpload: jest.fn(),
    bindTeamOnlyToggle: jest.fn(),
    bindEventFeeToggle: jest.fn(),
    bindEventAgeLimitToggle: jest.fn(),
    bindGenderRestrictionToggle: jest.fn(),
    bindPrivateEventToggle: jest.fn(),
    bindTeamSplitToggle: jest.fn(),
    bindEventSocialLinksToggle: jest.fn(),
    bindEventEarlyBirdToggle: jest.fn(),
    bindEventGpsToggle: jest.fn(),
    bindReservedActivityAddonToggles: jest.fn(),
    bindRegionToggle: jest.fn(),
    _bindCreateTimeSummary: jest.fn(),
    _userTag: name => String(name || ''),
    renderActivityList: jest.fn(),
    renderHotEvents: jest.fn(),
    renderMyActivities: jest.fn(),
    showModal: jest.fn(id => dom.window.document.getElementById(id)?.classList.add('open')),
    closeModal: jest.fn((options = {}) => {
      if (App._eventSubmitInFlight && options.allowSubmitting !== true) {
        App.showToast('資料儲存中，請稍候');
        return false;
      }
      dom.window.document.getElementById('create-event-modal')?.classList.remove('open');
      return true;
    }),
  });

  const setForm = title => {
    dom.window.document.getElementById('ce-title').value = title;
    dom.window.document.getElementById('ce-type').value = 'play';
    dom.window.document.getElementById('ce-location').value = `${title} Field`;
    dom.window.document.getElementById('ce-date').value = '2099-01-01';
    dom.window.document.getElementById('ce-time-start').value = '14:00';
    dom.window.document.getElementById('ce-time-end').value = '16:00';
    dom.window.document.getElementById('ce-sport-tag').value = 'football';
  };

  return { App, ApiService, auth, dom, events, updateEventAwait, createEvent, createEventsAtomic, setForm };
}

describe('activity form submit session isolation', () => {
  test('close and reopen are blocked while edit verification waits, then the captured edit saves once', async () => {
    const verifyA = deferred();
    const verifyUserDirectorySelection = jest.fn(() => verifyA.promise);
    const { App, dom, updateEventAwait, setForm } = loadHarness(verifyUserDirectorySelection);

    App.editMyActivity('event-a');
    setForm('Edit A');
    const submitA = App.handleCreateEvent();
    await flushPromiseJobs();

    App.closeModal();
    App.editMyActivity('event-b');

    expect(verifyUserDirectorySelection).toHaveBeenCalledTimes(1);
    expect(dom.window.document.getElementById('create-event-modal').classList.contains('open')).toBe(true);
    expect(dom.window.document.getElementById('create-event-modal').inert).toBe(true);
    expect(App.showToast).toHaveBeenCalledWith('資料儲存中，請稍候');

    verifyA.resolve({
      ok: true,
      users: [{ uid: 'delegate-same', name: 'Fresh Same Delegate', role: 'user' }],
      missingUids: [],
      reason: '',
    });
    await submitA;

    expect(updateEventAwait).toHaveBeenCalledTimes(1);
    expect(updateEventAwait.mock.calls[0][0]).toBe('event-a');
    expect(updateEventAwait.mock.calls[0][1]).toEqual(expect.objectContaining({ title: 'Edit A' }));
    expect(dom.window.document.getElementById('create-event-modal').classList.contains('open')).toBe(false);
    expect(dom.window.document.getElementById('create-event-modal').inert).toBe(false);
    dom.window.close();
  });

  test('an auth UID change while verification waits invalidates the captured submit', async () => {
    const verifyAuth = deferred();
    const verifyUserDirectorySelection = jest.fn(() => verifyAuth.promise);
    const { App, auth, updateEventAwait, setForm, dom } = loadHarness(verifyUserDirectorySelection);

    App.editMyActivity('event-a');
    setForm('Auth A');
    const submit = App.handleCreateEvent();
    await flushPromiseJobs();
    expect(verifyUserDirectorySelection).toHaveBeenCalledTimes(1);

    auth.currentUser = { uid: 'owner-2' };
    verifyAuth.resolve({
      ok: true,
      users: [{ uid: 'delegate-same', name: 'Fresh Same Delegate', role: 'user' }],
      missingUids: [],
      reason: '',
    });
    await submit;

    expect(updateEventAwait).not.toHaveBeenCalled();
    expect(App._eventSubmitInFlight).toBe(false);
    expect(dom.window.document.getElementById('ce-submit-btn').disabled).toBe(false);
    expect(App.showToast).not.toHaveBeenCalledWith(expect.stringContaining('Auth A'));
    dom.window.close();
  });

  test('programmatic modal removal unlocks inert state before a later reopen', async () => {
    const verification = deferred();
    const { App, dom, updateEventAwait, setForm } = loadHarness(jest.fn(() => verification.promise));

    App.editMyActivity('event-a');
    setForm('Programmatic Close');
    const oldSubmit = App.handleCreateEvent();
    await flushPromiseJobs();
    const modal = dom.window.document.getElementById('create-event-modal');
    expect(modal.inert).toBe(true);

    modal.classList.remove('open');
    await flushPromiseJobs();
    expect(App._eventSubmitInFlight).toBe(false);
    expect(modal.inert).toBe(false);

    App.editMyActivity('event-b');
    expect(modal.classList.contains('open')).toBe(true);
    expect(modal.inert).toBe(false);

    verification.resolve({ ok: true, users: [], missingUids: [], reason: 'ok' });
    await oldSubmit;
    expect(updateEventAwait).not.toHaveBeenCalled();
    dom.window.close();
  });
  test('close and reopen are blocked while create verification waits, then create writes once', async () => {
    const verifyCreate = deferred();
    const verifyUserDirectorySelection = jest.fn(() => verifyCreate.promise);
    const { App, dom, createEvent, setForm } = loadHarness(verifyUserDirectorySelection);

    App._openCreateCustomEventModal();
    setForm('Create A');
    App._delegates = [{ uid: 'delegate-same', name: 'Same Delegate' }];
    const submitA = App.handleCreateEvent();
    await flushPromiseJobs();

    App.closeModal();
    const reopenResult = App._openCreateCustomEventModal();
    expect(reopenResult).toBe(false);
    expect(dom.window.document.getElementById('create-event-modal').classList.contains('open')).toBe(true);
    expect(dom.window.document.getElementById('create-event-modal').inert).toBe(true);

    verifyCreate.resolve({
      ok: true,
      users: [{ uid: 'delegate-same', name: 'Fresh Same Delegate', role: 'user' }],
      missingUids: [],
      reason: '',
    });
    await submitA;

    expect(createEvent).toHaveBeenCalledTimes(1);
    expect(createEvent.mock.calls[0][0]).toEqual(expect.objectContaining({ title: 'Create A' }));
    expect(dom.window.document.getElementById('create-event-modal').classList.contains('open')).toBe(false);
    expect(dom.window.document.getElementById('create-event-modal').inert).toBe(false);
    dom.window.close();
  });

  test('multi-date failure retries the same atomic batch instead of duplicating completed dates', async () => {
    const firstError = new Error('temporary network failure');
    const verification = { ok: true, users: [], missingUids: [] };
    const { App, dom, createEventsAtomic, setForm } = loadHarness(jest.fn(async () => verification));
    const batch = [
      { id: 'ce-batch-1', title: 'Batch', creatorUid: 'owner-1', batchGroupId: 'batch-1' },
      { id: 'ce-batch-2', title: 'Batch', creatorUid: 'owner-1', batchGroupId: 'batch-1' },
    ];
    App._isMultiDateMode = () => true;
    App._multiDates = ['2099-01-01', '2099-01-08'];
    App._buildMultiDateEvents = jest.fn(() => batch);
    createEventsAtomic
      .mockRejectedValueOnce(firstError)
      .mockResolvedValueOnce(batch);

    App._openCreateCustomEventModal();
    setForm('Atomic Batch');
    await App.handleCreateEvent();

    expect(createEventsAtomic).toHaveBeenCalledTimes(1);
    expect(createEventsAtomic.mock.calls[0][0]).toBe(batch);
    expect(dom.window.document.getElementById('create-event-modal').classList.contains('open')).toBe(true);
    expect(dom.window.document.getElementById('create-event-modal').inert).toBe(false);

    await App.handleCreateEvent();

    expect(App._buildMultiDateEvents).toHaveBeenCalledTimes(1);
    expect(createEventsAtomic).toHaveBeenCalledTimes(2);
    expect(createEventsAtomic.mock.calls[1][0]).toBe(batch);
    expect(dom.window.document.getElementById('create-event-modal').classList.contains('open')).toBe(false);
    dom.window.close();
  });
  test('field mutation after an edit write starts cannot cause a silent duplicate retry', async () => {
    const write = deferred();
    const verification = { ok: true, users: [{ uid: 'delegate-same', name: 'Fresh', role: 'user' }], missingUids: [] };
    const { App, dom, updateEventAwait, setForm } = loadHarness(jest.fn(async () => verification));
    updateEventAwait.mockImplementationOnce(() => write.promise);

    App.editMyActivity('event-a');
    setForm('Captured Edit');
    const submit = App.handleCreateEvent();
    for (let attempt = 0; attempt < 50 && updateEventAwait.mock.calls.length === 0; attempt += 1) await flushPromiseJobs();

    expect(updateEventAwait).toHaveBeenCalledTimes(1);
    expect(dom.window.document.getElementById('create-event-modal').inert).toBe(true);
    dom.window.document.getElementById('ce-title').value = 'Late Script Mutation';
    write.resolve(true);
    await submit;

    expect(updateEventAwait).toHaveBeenCalledTimes(1);
    expect(updateEventAwait.mock.calls[0][1]).toEqual(expect.objectContaining({ title: 'Captured Edit' }));
    expect(dom.window.document.getElementById('create-event-modal').classList.contains('open')).toBe(false);
    expect(dom.window.document.getElementById('create-event-modal').inert).toBe(false);
    dom.window.close();
  });
});