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

function installManualCreateDeadlines(App) {
  const pending = new Map();
  App._waitForActivityCreateDependency = async (promise, _timeoutMs, code, message) => {
    if (code !== 'event-create-write-timeout' && code !== 'event-create-reconcile-timeout') {
      return await promise;
    }
    const gate = deferred();
    if (!pending.has(code)) pending.set(code, []);
    pending.get(code).push(gate);
    const timeout = gate.promise.then(() => {
      const err = new Error(message || code);
      err.code = code;
      throw err;
    });
    return await Promise.race([promise, timeout]);
  };
  return {
    async expireNext(code) {
      for (let attempt = 0; attempt < 100 && !(pending.get(code)?.length); attempt += 1) {
        await flushPromiseJobs();
      }
      const gate = pending.get(code)?.shift();
      if (!gate) throw new Error(`No pending deadline for ${code}`);
      gate.resolve();
      await flushPromiseJobs();
    },
  };
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

function makeCreateWriteError(code, outcome = 'definitive-rejected') {
  const error = new Error(String(code || 'create failed'));
  error.code = code;
  error.eventCreateOutcome = outcome;
  error.eventCreatePhase = outcome === 'definitive-rejected' ? 'preflight' : 'unknown';
  error.eventCreateWriteState = outcome === 'definitive-rejected' ? 'not-started' : 'unknown';
  return error;
}

function makeTransactionCreateWriteError(code) {
  const error = new Error(code);
  error.code = code;
  error.eventCreatePhase = 'transaction';
  error.eventCreateOutcome = 'ambiguous';
  error.eventCreateWriteState = 'unknown';
  return error;
}

function createSharedStorage() {
  const data = new Map();
  const writes = [];
  return {
    forTab(tabId) {
      return {
        getItem: key => data.has(String(key)) ? data.get(String(key)) : null,
        setItem: (key, value) => {
          data.set(String(key), String(value));
          writes.push({ tabId, type: 'set', key: String(key), value: String(value) });
        },
        removeItem: key => {
          data.delete(String(key));
          writes.push({ tabId, type: 'remove', key: String(key) });
        },
        clear: () => data.clear(),
        key: index => [...data.keys()][index] || null,
        get length() { return data.size; },
      };
    },
    peek: key => data.get(String(key)) || null,
    writes,
  };
}

function createCapacityStorage(initialEntries, maxChars) {
  const data = new Map(Object.entries(initialEntries || {}).map(([key, value]) => [String(key), String(value)]));
  const writes = [];
  const sizeWith = (key, value) => {
    const candidate = new Map(data);
    candidate.set(String(key), String(value));
    return [...candidate.entries()].reduce((total, [entryKey, entryValue]) => (
      total + entryKey.length + entryValue.length
    ), 0);
  };
  const facade = {
    getItem: key => data.has(String(key)) ? data.get(String(key)) : null,
    setItem: (key, value) => {
      if (sizeWith(key, value) > maxChars) {
        const error = new Error('Storage quota exceeded');
        error.name = 'QuotaExceededError';
        error.code = 22;
        throw error;
      }
      data.set(String(key), String(value));
      writes.push({ type: 'set', key: String(key), value: String(value) });
    },
    removeItem: key => {
      data.delete(String(key));
      writes.push({ type: 'remove', key: String(key) });
    },
    key: index => [...data.keys()][index] || null,
    get length() { return data.size; },
  };
  return {
    forTab: () => facade,
    peek: key => data.get(String(key)) || null,
    writes,
  };
}

function createDeterministicLockManager() {
  const locks = new Map();
  const trace = [];
  const drain = name => {
    const state = locks.get(name);
    if (!state || state.active || state.queue.length === 0) return;
    const next = state.queue.shift();
    state.active = true;
    trace.push({ type: 'acquire', name, tabId: next.tabId });
    Promise.resolve()
      .then(() => next.callback({ name, mode: 'exclusive' }))
      .then(next.resolve, next.reject)
      .finally(() => {
        trace.push({ type: 'release', name, tabId: next.tabId });
        state.active = false;
        drain(name);
      });
  };
  return {
    forTab(tabId) {
      return {
        request: (name, optionsOrCallback, maybeCallback) => {
          const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
          return new Promise((resolve, reject) => {
            if (!locks.has(name)) locks.set(name, { active: false, queue: [] });
            locks.get(name).queue.push({ tabId, callback, resolve, reject });
            drain(name);
          });
        },
      };
    },
    trace,
    queued: name => locks.get(name)?.queue.length || 0,
  };
}

function createFakeIndexedDb(options = {}) {
  const records = new Map();
  const stats = { opens: 0, transactions: 0, puts: 0, deletes: 0, aborts: 0, closes: 0, commits: 0 };
  const transactions = [];
  const transactionQueue = [];
  let activeTransaction = null;
  const releaseTransaction = transaction => {
    if (activeTransaction === transaction) activeTransaction = null;
    const queuedIndex = transactionQueue.indexOf(transaction);
    if (queuedIndex >= 0) transactionQueue.splice(queuedIndex, 1);
    setImmediate(drainTransactions);
  };
  const drainTransactions = () => {
    if (activeTransaction || transactionQueue.length === 0) return;
    const transaction = transactionQueue.shift();
    activeTransaction = transaction;
    if (transaction.aborted || options.hangTransaction === true) return;
    setImmediate(() => {
      if (transaction.aborted || !transaction.getRequest) return;
      transaction.getRequest.result = records.get(transaction.getKey);
      transaction.getRequest.onsuccess?.();
      setImmediate(() => {
        if (transaction.aborted) return;
        const hanging = options.hangCommitTransactions;
        if (hanging && (hanging.has?.(transaction.number) || hanging.includes?.(transaction.number))) return;
        transaction.staged.forEach((value, key) => records.set(key, { ...value }));
        transaction.deleted.forEach(key => records.delete(key));
        stats.commits += 1;
        transaction.oncomplete?.();
        releaseTransaction(transaction);
      });
    });
  };
  const makeDatabase = () => ({
    objectStoreNames: { contains: () => true },
    createObjectStore: jest.fn(),
    close: jest.fn(() => { stats.closes += 1; }),
    transaction: jest.fn(() => {
      stats.transactions += 1;
      const transaction = {
        number: stats.transactions,
        error: null,
        oncomplete: null,
        onerror: null,
        onabort: null,
        aborted: false,
        getRequest: null,
        getKey: '',
        staged: new Map(),
        deleted: new Set(),
        abort: jest.fn(() => {
          if (transaction.aborted) return;
          transaction.aborted = true;
          transaction.staged.clear();
          transaction.deleted.clear();
          stats.aborts += 1;
          setImmediate(() => {
            transaction.onabort?.();
            releaseTransaction(transaction);
          });
        }),
      };
      transactions.push(transaction);
      transaction.objectStore = () => ({
        get: key => {
          const request = { result: undefined, error: null, onsuccess: null, onerror: null };
          transaction.getKey = String(key);
          transaction.getRequest = request;
          return request;
        },
        put: value => {
          if (!transaction.aborted) {
            transaction.staged.set(String(value.creatorUid), { ...value });
            stats.puts += 1;
          }
        },
        delete: key => {
          if (!transaction.aborted) {
            transaction.deleted.add(String(key));
            stats.deletes += 1;
          }
        },
      });
      transactionQueue.push(transaction);
      setImmediate(drainTransactions);
      return transaction;
    }),
  });
  return {
    open: jest.fn(() => {
      stats.opens += 1;
      const request = {
        result: makeDatabase(),
        error: null,
        transaction: { abort: jest.fn(() => { stats.aborts += 1; }) },
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
      };
      if (options.hangOpen !== true) setImmediate(() => request.onsuccess?.());
      return request;
    }),
    records,
    stats,
    transactions,
  };
}

function loadHarness(verifyUserDirectorySelection, options = {}) {
  const dom = new JSDOM(`<!doctype html><body>
    <div id="modal-overlay"></div>
    <div id="create-event-modal" class="modal">
      <button class="modal-close" onclick="App.closeModal()">close</button>
      <div class="modal-body">
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
      <button id="ce-submit-btn">save</button>
    </div>
  </body>`, { url: 'https://toosterx.test/activities' });
  if (options.sharedStorage) {
    Object.defineProperty(dom.window, 'localStorage', {
      configurable: true,
      value: options.sharedStorage.forTab(options.tabId || 'tab-1'),
    });
  }
  if (options.useWebLocks !== false) {
    Object.defineProperty(dom.window.navigator, 'locks', {
      configurable: true,
      value: options.sharedLocks
        ? options.sharedLocks.forTab(options.tabId || 'tab-1')
        : {
        request: async (_name, optionsOrCallback, maybeCallback) => {
          const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
          return await callback({ name: _name, mode: 'exclusive' });
        },
      },
    });
  }
  const indexedDB = Object.prototype.hasOwnProperty.call(options, 'indexedDB')
    ? options.indexedDB
    : createFakeIndexedDb();
  Object.defineProperty(dom.window, 'indexedDB', {
    configurable: true,
    value: indexedDB,
  });
  const events = new Map([
    ['event-a', makeEvent('event-a', 'Event A')],
    ['event-b', makeEvent('event-b', 'Event B')],
  ]);
  const updateEventAwait = jest.fn(async () => true);
  const createEvent = options.createEvent || jest.fn(async () => true);
  const createEventsAtomic = options.createEventsAtomic || jest.fn(async () => true);
  const reconcileEventCreate = options.reconcileEventCreate || jest.fn(async () => ({ state: 'missing' }));
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
    reconcileEventCreate,
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
    generateId: options.generateId || (() => 'ce_created'),
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

  return {
    App,
    ApiService,
    auth,
    dom,
    events,
    updateEventAwait,
    createEvent,
    createEventsAtomic,
    reconcileEventCreate,
    indexedDB,
    setForm,
  };
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
      { id: 'ce_batch_1', clientRequestId: 'ce_batch_1', title: 'Batch', creatorUid: 'owner-1', batchGroupId: 'batch-1' },
      { id: 'ce_batch_2', clientRequestId: 'ce_batch_2', title: 'Batch', creatorUid: 'owner-1', batchGroupId: 'batch-1' },
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
    expect(createEventsAtomic.mock.calls[0][0]).toEqual(batch.map(event => expect.objectContaining(event)));
    expect(createEventsAtomic.mock.calls[0][0]).toEqual(batch.map(() => expect.objectContaining({
      payloadRevision: 1,
      payloadDigest: expect.stringMatching(/^v1-[0-9a-f]{32}$/),
    })));
    expect(dom.window.document.getElementById('create-event-modal').classList.contains('open')).toBe(true);
    expect(dom.window.document.getElementById('create-event-modal').inert).toBe(false);

    await App.handleCreateEvent();

    expect(App._pendingMultiDateSubmission).toBeNull();
    expect(App._buildMultiDateEvents).toHaveBeenCalledTimes(1);
    expect(createEventsAtomic).toHaveBeenCalledTimes(2);
    expect(createEventsAtomic.mock.calls[1][0]).toEqual(createEventsAtomic.mock.calls[0][0]);
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

  test('a never-settling create write releases the busy state and preserves one request id for confirmation', async () => {
    const never = new Promise(() => {});
    const { App, createEvent, setForm, dom } = loadHarness(jest.fn(async () => ({ ok: true, users: [], missingUids: [] })));
    App._eventCreateWriteTimeoutMs = 5;
    createEvent.mockImplementation(() => never);

    App._openCreateCustomEventModal();
    setForm('Pending Create');
    await App.handleCreateEvent();

    const firstPayload = createEvent.mock.calls[0][0];
    expect(firstPayload.id).toBe('ce_created');
    expect(firstPayload.clientRequestId).toBe(firstPayload.id);
    expect(App._pendingSingleEventSubmission).toEqual(expect.objectContaining({
      creatorUid: 'owner-1',
      state: 'outcome-unknown',
      event: expect.objectContaining({
        id: firstPayload.id,
        clientRequestId: firstPayload.clientRequestId,
        title: firstPayload.title,
      }),
    }));
    expect(App._eventSubmitInFlight).toBe(false);
    expect(dom.window.document.getElementById('ce-submit-btn')).toMatchObject({
      disabled: false,
      textContent: '確認建立結果',
    });
    expect(dom.window.document.getElementById('create-event-modal').classList.contains('open')).toBe(true);
    expect(App.showToast).toHaveBeenCalledWith(expect.stringContaining('請勿重複開團'));
    dom.window.close();
  });

  test('after an unknown result, a missing server document retries the exact same event id and completes once', async () => {
    const never = new Promise(() => {});
    const verification = { ok: true, users: [], missingUids: [] };
    const { App, createEvent, reconcileEventCreate, setForm, dom } = loadHarness(jest.fn(async () => verification));
    App._eventCreateWriteTimeoutMs = 5;
    createEvent
      .mockImplementationOnce(() => never)
      .mockResolvedValueOnce({ id: 'ce_created', clientRequestId: 'ce_created', creatorUid: 'owner-1' });
    reconcileEventCreate.mockResolvedValueOnce({ state: 'missing' });

    App._openCreateCustomEventModal();
    setForm('Retry Same Id');
    await App.handleCreateEvent();
    await App.handleCreateEvent();

    expect(reconcileEventCreate).toHaveBeenCalledWith(expect.objectContaining({
      id: 'ce_created',
      clientRequestId: 'ce_created',
      creatorUid: 'owner-1',
      payloadRevision: 1,
      payloadDigest: expect.stringMatching(/^v1-[0-9a-f]{32}$/),
    }));
    expect(createEvent).toHaveBeenCalledTimes(2);
    expect(createEvent.mock.calls[1][0]).toEqual(createEvent.mock.calls[0][0]);
    expect(App._pendingSingleEventSubmission).toBeNull();
    expect(dom.window.document.getElementById('create-event-modal').classList.contains('open')).toBe(false);
    dom.window.close();
  });

  test('a late successful create is confirmed without sending a second write', async () => {
    const lateWrite = deferred();
    const verification = { ok: true, users: [], missingUids: [] };
    const { App, createEvent, reconcileEventCreate, setForm, dom } = loadHarness(jest.fn(async () => verification));
    App._eventCreateWriteTimeoutMs = 5;
    createEvent.mockImplementationOnce(() => lateWrite.promise);

    App._openCreateCustomEventModal();
    setForm('Late Success');
    await App.handleCreateEvent();
    lateWrite.resolve({ id: 'ce_created', clientRequestId: 'ce_created', creatorUid: 'owner-1' });
    await flushPromiseJobs();
    await App.handleCreateEvent();

    expect(createEvent).toHaveBeenCalledTimes(1);
    expect(reconcileEventCreate).not.toHaveBeenCalled();
    expect(App._pendingSingleEventSubmission).toBeNull();
    expect(dom.window.document.getElementById('create-event-modal').classList.contains('open')).toBe(false);
    dom.window.close();
  });

  test('a reconciling tab owns the one-time create log and EXP before the original write fulfills late', async () => {
    const sharedStorage = createSharedStorage();
    const sharedLocks = createDeterministicLockManager();
    const fakeIndexedDb = createFakeIndexedDb();
    const lateWrite = deferred();
    const firstCreate = jest.fn(() => lateWrite.promise);
    const first = loadHarness(jest.fn(async () => ({ ok: true, users: [], missingUids: [] })), {
      tabId: 'late-owner-a', sharedStorage, sharedLocks, indexedDB: fakeIndexedDb,
      createEvent: firstCreate,
    });
    const second = loadHarness(jest.fn(async () => ({ ok: true, users: [], missingUids: [] })), {
      tabId: 'late-owner-b', sharedStorage, sharedLocks, indexedDB: fakeIndexedDb,
      reconcileEventCreate: jest.fn(async request => ({
        state: 'committed',
        event: { id: request.id, clientRequestId: request.clientRequestId, creatorUid: request.creatorUid },
      })),
    });

    first.App._openCreateCustomEventModal();
    first.setForm('Cross-tab');
    const firstSubmit = first.App.handleCreateEvent();
    for (let attempt = 0; attempt < 50 && firstCreate.mock.calls.length < 1; attempt += 1) await flushPromiseJobs();
    expect(firstCreate).toHaveBeenCalledTimes(1);

    second.App._openCreateCustomEventModal();
    await second.App.handleCreateEvent();

    expect(second.App._readPendingSingleEventMarker('owner-1')).toBeNull();
    expect(second.ApiService._writeOpLog).toHaveBeenCalledTimes(1);
    expect(second.App._grantAutoExp).toHaveBeenCalledTimes(1);

    lateWrite.resolve(firstCreate.mock.calls[0][0]);
    await firstSubmit;

    expect(first.ApiService._writeOpLog).not.toHaveBeenCalled();
    expect(first.App._grantAutoExp).not.toHaveBeenCalled();
    expect(first.App._saveInputHistory).toHaveBeenCalled();
    expect(first.dom.window.document.getElementById('create-event-modal').classList.contains('open')).toBe(false);
    first.dom.window.close();
    second.dom.window.close();
  });

  test('a remove timeout defers one-time create effects until reload reconciliation finalizes the marker', async () => {
    const sharedStorage = createSharedStorage();
    const sharedLocks = createDeterministicLockManager();
    const fakeIndexedDb = createFakeIndexedDb();
    const createEvent = jest.fn(async event => event);
    const first = loadHarness(jest.fn(async () => ({ ok: true, users: [], missingUids: [] })), {
      tabId: 'remove-timeout-a', sharedStorage, sharedLocks, indexedDB: fakeIndexedDb,
      createEvent,
    });
    const runPendingOperation = first.App._runEventCreatePendingOperation.bind(first.App);
    let removeTimedOut = true;
    first.App._runEventCreatePendingOperation = jest.fn(async (...args) => {
      if (args[0] === 'remove' && removeTimedOut) {
        removeTimedOut = false;
        return { state: 'unavailable' };
      }
      return await runPendingOperation(...args);
    });

    first.App._openCreateCustomEventModal();
    first.setForm('Reload Finalizer');
    await first.App.handleCreateEvent();

    expect(first.App._readPendingSingleEventMarker('owner-1')).toEqual(expect.objectContaining({
      intentId: 'ce_created',
      attempts: [expect.objectContaining({ state: 'committed' })],
    }));
    expect(first.ApiService._writeOpLog).not.toHaveBeenCalled();
    expect(first.App._grantAutoExp).not.toHaveBeenCalled();
    expect(first.App._saveInputHistory).toHaveBeenCalled();

    const second = loadHarness(jest.fn(async () => ({ ok: true, users: [], missingUids: [] })), {
      tabId: 'remove-timeout-b', sharedStorage, sharedLocks, indexedDB: fakeIndexedDb,
      reconcileEventCreate: jest.fn(async request => ({
        state: 'committed',
        event: { id: request.id, clientRequestId: request.clientRequestId, creatorUid: request.creatorUid },
      })),
    });
    second.App._openCreateCustomEventModal();
    await second.App.handleCreateEvent();

    expect(second.App._readPendingSingleEventMarker('owner-1')).toBeNull();
    expect(second.ApiService._writeOpLog).toHaveBeenCalledTimes(1);
    expect(second.App._grantAutoExp).toHaveBeenCalledTimes(1);
    expect(first.ApiService._writeOpLog.mock.calls.length + second.ApiService._writeOpLog.mock.calls.length).toBe(1);
    expect(first.App._grantAutoExp.mock.calls.length + second.App._grantAutoExp.mock.calls.length).toBe(1);
    first.dom.window.close();
    second.dom.window.close();
  });

  test('a stale late finalizer preserves a successor marker and cannot run create log or EXP effects', async () => {
    const sharedStorage = createSharedStorage();
    const sharedLocks = createDeterministicLockManager();
    const fakeIndexedDb = createFakeIndexedDb();
    const lateWrite = deferred();
    const createEvent = jest.fn(() => lateWrite.promise);
    const first = loadHarness(jest.fn(async () => ({ ok: true, users: [], missingUids: [] })), {
      tabId: 'stale-finalizer-a', sharedStorage, sharedLocks, indexedDB: fakeIndexedDb,
      createEvent,
    });
    const second = loadHarness(jest.fn(async () => ({ ok: true, users: [], missingUids: [] })), {
      tabId: 'stale-finalizer-b', sharedStorage, sharedLocks, indexedDB: fakeIndexedDb,
    });

    first.App._openCreateCustomEventModal();
    first.setForm('Stale Finalizer');
    const firstSubmit = first.App.handleCreateEvent();
    for (let attempt = 0; attempt < 50 && createEvent.mock.calls.length < 1; attempt += 1) await flushPromiseJobs();
    const staleMarker = first.App._readPendingSingleEventMarker('owner-1');
    expect(staleMarker).toEqual(expect.objectContaining({ intentId: 'ce_created' }));
    expect(await second.App._removePendingEventCreateIntent(staleMarker)).toBe(true);

    const successorMarker = second.App._getPendingEventCreateMarkerFromPending({
      kind: 'single', creatorUid: 'owner-1', startedAt: Date.now() + 1,
      event: {
        id: 'ce_successor', clientRequestId: 'ce_successor', creatorUid: 'owner-1', title: 'Successor',
      },
    });
    expect((await second.App._claimPendingEventCreateIntent(successorMarker)).state).toBe('claimed');

    lateWrite.resolve(createEvent.mock.calls[0][0]);
    await firstSubmit;

    expect(second.App._readPendingSingleEventMarker('owner-1')).toEqual(expect.objectContaining({
      intentId: 'ce_successor',
    }));
    expect(first.ApiService._writeOpLog).not.toHaveBeenCalled();
    expect(first.App._grantAutoExp).not.toHaveBeenCalled();
    expect(first.App._saveInputHistory).toHaveBeenCalled();
    expect(first.dom.window.document.getElementById('create-event-modal').classList.contains('open')).toBe(false);
    first.dom.window.close();
    second.dom.window.close();
  });

  test('two tabs atomically claim one pending intent and cannot remove another tab intent', async () => {
    const sharedStorage = createSharedStorage();
    const sharedLocks = createDeterministicLockManager();
    const first = loadHarness(jest.fn(async () => ({ ok: true, users: [], missingUids: [] })), {
      tabId: 'tab-a',
      sharedStorage,
      sharedLocks,
    });
    const second = loadHarness(jest.fn(async () => ({ ok: true, users: [], missingUids: [] })), {
      tabId: 'tab-b',
      sharedStorage,
      sharedLocks,
    });
    const markerA = first.App._getPendingEventCreateMarkerFromPending({
      kind: 'single',
      creatorUid: 'owner-1',
      event: { id: 'ce_tab_a', clientRequestId: 'ce_tab_a', creatorUid: 'owner-1', title: 'A' },
      signature: 'a',
      startedAt: 1,
    });
    const markerB = second.App._getPendingEventCreateMarkerFromPending({
      kind: 'single',
      creatorUid: 'owner-1',
      event: { id: 'ce_tab_b', clientRequestId: 'ce_tab_b', creatorUid: 'owner-1', title: 'B' },
      signature: 'b',
      startedAt: 2,
    });

    const [claimA, claimB] = await Promise.all([
      first.App._claimPendingEventCreateIntent(markerA),
      second.App._claimPendingEventCreateIntent(markerB),
    ]);

    expect([claimA.state, claimB.state].sort()).toEqual(['claimed', 'existing']);
    const winner = claimA.state === 'claimed' ? markerA : markerB;
    const loser = claimA.state === 'claimed' ? markerB : markerA;
    const storageKey = first.App._getEventCreatePendingStorageKey('owner-1');
    const stored = first.App._parsePendingEventCreateMarker(sharedStorage.peek(storageKey), 'owner-1');
    expect(first.App._isSamePendingEventCreateIntent(stored, winner)).toBe(true);
    expect(sharedStorage.writes.filter(write => write.type === 'set')).toHaveLength(1);
    expect(await second.App._removePendingEventCreateIntent(loser)).toBe(false);
    expect(first.App._isSamePendingEventCreateIntent(
      first.App._parsePendingEventCreateMarker(sharedStorage.peek(storageKey), 'owner-1'),
      winner,
    )).toBe(true);
    expect(sharedLocks.trace.filter(entry => entry.type === 'acquire')).toHaveLength(3);
    first.dom.window.close();
    second.dom.window.close();
  });

  test('mixed Web-Locks and no-Web-Locks tabs share the same IndexedDB mutex', async () => {
    const sharedStorage = createSharedStorage();
    const sharedLocks = createDeterministicLockManager();
    const fakeIndexedDb = createFakeIndexedDb();
    const first = loadHarness(jest.fn(async () => ({ ok: true, users: [], missingUids: [] })), {
      tabId: 'mixed-lock', sharedStorage, sharedLocks, indexedDB: fakeIndexedDb,
    });
    const second = loadHarness(jest.fn(async () => ({ ok: true, users: [], missingUids: [] })), {
      tabId: 'mixed-idb', sharedStorage, useWebLocks: false, indexedDB: fakeIndexedDb,
    });
    const markerA = first.App._getPendingEventCreateMarkerFromPending({
      kind: 'single', creatorUid: 'owner-1', startedAt: 1,
      event: { id: 'ce_mixed_a', clientRequestId: 'ce_mixed_a', creatorUid: 'owner-1' },
    });
    const markerB = second.App._getPendingEventCreateMarkerFromPending({
      kind: 'single', creatorUid: 'owner-1', startedAt: 2,
      event: { id: 'ce_mixed_b', clientRequestId: 'ce_mixed_b', creatorUid: 'owner-1' },
    });

    const [claimA, claimB] = await Promise.all([
      first.App._claimPendingEventCreateIntent(markerA),
      second.App._claimPendingEventCreateIntent(markerB),
    ]);

    expect([claimA.state, claimB.state].sort()).toEqual(['claimed', 'existing']);
    expect(sharedStorage.writes.filter(write => write.type === 'set')).toHaveLength(1);
    expect(fakeIndexedDb.stats.transactions).toBe(2);
    expect(fakeIndexedDb.stats.commits).toBe(2);
    expect([...fakeIndexedDb.records.values()]).toEqual([
      expect.objectContaining({ creatorUid: 'owner-1', epoch: 2 }),
    ]);
    expect([...fakeIndexedDb.records.values()][0]).not.toHaveProperty('serialized');
    first.dom.window.close();
    second.dom.window.close();
  });

  test('two tabs revising the same editable marker allow only the revision CAS winner to write network', async () => {
    const sharedStorage = createSharedStorage();
    const sharedLocks = createDeterministicLockManager();
    const fakeIndexedDb = createFakeIndexedDb();
    const firstWrite = deferred();
    const firstCreate = jest.fn(() => firstWrite.promise);
    const secondCreate = jest.fn(async event => event);
    const first = loadHarness(jest.fn(async () => ({ ok: true, users: [], missingUids: [] })), {
      tabId: 'revision-a', sharedStorage, sharedLocks, indexedDB: fakeIndexedDb,
      createEvent: firstCreate,
    });
    const second = loadHarness(jest.fn(async () => ({ ok: true, users: [], missingUids: [] })), {
      tabId: 'revision-b', sharedStorage, sharedLocks, indexedDB: fakeIndexedDb,
      createEvent: secondCreate,
    });
    const editableMarker = first.App._getPendingEventCreateMarkerFromPending({
      kind: 'single', creatorUid: 'owner-1', state: 'editable', recoveryState: 'editable',
      event: { id: 'ce_revision', clientRequestId: 'ce_revision', creatorUid: 'owner-1', title: 'Original' },
      payloadRevision: 1,
      startedAt: 1,
    });
    expect((await first.App._claimPendingEventCreateIntent(editableMarker)).state).toBe('claimed');

    first.App._openCreateCustomEventModal();
    second.App._openCreateCustomEventModal();
    first.App._pendingSingleEventSubmission.state = 'editable';
    first.App._pendingSingleEventSubmission.restored = false;
    second.App._pendingSingleEventSubmission.state = 'editable';
    second.App._pendingSingleEventSubmission.restored = false;
    first.setForm('Revision Winner');
    second.setForm('Stale Loser');
    const firstSubmit = first.App.handleCreateEvent();
    for (let attempt = 0; attempt < 50 && firstCreate.mock.calls.length === 0; attempt += 1) await flushPromiseJobs();
    expect(firstCreate).toHaveBeenCalledTimes(1);

    await second.App.handleCreateEvent();

    expect(secondCreate).not.toHaveBeenCalled();
    expect(sharedStorage.writes.filter(write => write.type === 'set')).toHaveLength(3);
    expect(first.App._readPendingSingleEventMarker('owner-1')).toEqual(expect.objectContaining({
      intentId: 'ce_revision',
      payloadRevision: 2,
      recoveryState: 'frozen',
    }));
    expect(second.App.showToast).toHaveBeenCalledWith(expect.stringContaining('其他分頁更新'));

    firstWrite.resolve(firstCreate.mock.calls[0][0]);
    await firstSubmit;
    expect(first.App._readPendingSingleEventMarker('owner-1')).toBeNull();
    first.dom.window.close();
    second.dom.window.close();
  });

  test('a stale revision cannot remove a newer marker for the same event id', async () => {
    const { App, dom } = loadHarness(jest.fn(async () => ({ ok: true, users: [], missingUids: [] })));
    const editableMarker = App._getPendingEventCreateMarkerFromPending({
      kind: 'single', creatorUid: 'owner-1', state: 'editable', recoveryState: 'editable',
      event: { id: 'ce_revision_remove', clientRequestId: 'ce_revision_remove', creatorUid: 'owner-1', title: 'Original' },
      payloadRevision: 1,
      startedAt: 1,
    });
    const revisedMarker = App._getPendingEventCreateMarkerFromPending({
      kind: 'single', creatorUid: 'owner-1', state: 'pending', recoveryState: 'frozen',
      event: { id: 'ce_revision_remove', clientRequestId: 'ce_revision_remove', creatorUid: 'owner-1', title: 'Corrected' },
      payloadRevision: 2,
      intentRevision: 2,
      startedAt: 1,
    });

    expect((await App._claimPendingEventCreateIntent(editableMarker)).state).toBe('claimed');
    expect((await App._replacePendingEventCreateIntent(editableMarker, revisedMarker)).state).toBe('replaced');
    expect(await App._removePendingEventCreateIntent(editableMarker)).toBe(false);
    expect(App._readPendingSingleEventMarker('owner-1')).toEqual(expect.objectContaining({
      intentId: 'ce_revision_remove',
      payloadRevision: 2,
      recoveryState: 'frozen',
    }));
    expect(await App._removePendingEventCreateIntent(revisedMarker)).toBe(true);
    dom.window.close();
  });

  test('a stale frozen tab cannot write after another tab atomically makes the intent editable', async () => {
    const sharedStorage = createSharedStorage();
    const sharedLocks = createDeterministicLockManager();
    const fakeIndexedDb = createFakeIndexedDb();
    const first = loadHarness(jest.fn(async () => ({ ok: true, users: [], missingUids: [] })), {
      tabId: 'stale-edit-a', sharedStorage, sharedLocks, indexedDB: fakeIndexedDb,
    });
    const staleCreate = jest.fn(async event => event);
    const second = loadHarness(jest.fn(async () => ({ ok: true, users: [], missingUids: [] })), {
      tabId: 'stale-edit-b', sharedStorage, sharedLocks, indexedDB: fakeIndexedDb,
      createEvent: staleCreate,
    });
    const initial = first.App._getPendingEventCreateMarkerFromPending({
      kind: 'single', creatorUid: 'owner-1', startedAt: 1,
      event: { id: 'ce_stale_frozen', clientRequestId: 'ce_stale_frozen', creatorUid: 'owner-1' },
    });
    const rejected = first.App._normalizePendingEventCreateMarker({
      ...initial,
      attempts: [{
        token: 'eca_stale_rejected', payloadRevision: 1,
        payloadDigest: initial.payloadDigest, state: 'rejected-definitive',
      }],
    }, 'owner-1');
    expect((await first.App._claimPendingEventCreateIntent(rejected)).state).toBe('claimed');
    const firstPending = first.App._restorePendingEventCreateIntent(rejected, 1);
    const stalePending = second.App._restorePendingEventCreateIntent(rejected, 1);

    expect(await first.App._markPendingEventCreateEditable(firstPending)).toBe(true);
    await second.App._runSingleEventCreateAttempt(stalePending);

    expect(staleCreate).not.toHaveBeenCalled();
    expect(second.App._readPendingSingleEventMarker('owner-1')).toEqual(expect.objectContaining({
      recoveryState: 'editable',
    }));
    first.dom.window.close();
    second.dom.window.close();
  });

  test('a replace whose localStorage write wins before IndexedDB timeout is recovered as replaced', async () => {
    const hangingCommits = new Set();
    const fakeIndexedDb = createFakeIndexedDb({ hangCommitTransactions: hangingCommits });
    const sharedStorage = createSharedStorage();
    const { App, dom } = loadHarness(jest.fn(async () => ({ ok: true, users: [], missingUids: [] })), {
      indexedDB: fakeIndexedDb, sharedStorage,
    });
    const initial = App._getPendingEventCreateMarkerFromPending({
      kind: 'single', creatorUid: 'owner-1', startedAt: 1,
      event: { id: 'ce_replace_timeout', clientRequestId: 'ce_replace_timeout', creatorUid: 'owner-1' },
    });
    const rejected = App._normalizePendingEventCreateMarker({
      ...initial,
      attempts: [{
        token: 'eca_replace_rejected', payloadRevision: 1,
        payloadDigest: initial.payloadDigest, state: 'rejected-definitive',
      }],
    }, 'owner-1');
    expect((await App._claimPendingEventCreateIntent(rejected)).state).toBe('claimed');
    const pending = App._restorePendingEventCreateIntent(rejected, 1);
    App._eventCreatePendingCoordinatorTimeoutMs = 5;
    hangingCommits.add(fakeIndexedDb.stats.transactions + 1);

    expect(await App._markPendingEventCreateEditable(pending)).toBe(true);
    expect(fakeIndexedDb.stats.aborts).toBeGreaterThan(0);
    expect(sharedStorage.writes.filter(write => write.type === 'set')).toHaveLength(2);
    expect(App._readPendingSingleEventMarker('owner-1')).toEqual(expect.objectContaining({
      recoveryState: 'editable',
      intentRevision: rejected.intentRevision + 1,
    }));
    expect(dom.window.document.querySelector('#create-event-modal > .modal-body').inert).toBe(false);
    dom.window.close();
  });

  test('an unavailable revision CAS rereads canonical state without authorizing a network write', async () => {
    const createEvent = jest.fn(async event => event);
    const { App, dom } = loadHarness(
      jest.fn(async () => ({ ok: true, users: [], missingUids: [] })),
      { createEvent },
    );
    const editableMarker = App._getPendingEventCreateMarkerFromPending({
      kind: 'single', creatorUid: 'owner-1', state: 'editable', recoveryState: 'editable',
      event: { id: 'ce_revision_timeout', clientRequestId: 'ce_revision_timeout', creatorUid: 'owner-1', title: 'Original' },
      payloadRevision: 1,
      startedAt: 1,
    });
    const revisedMarker = App._getPendingEventCreateMarkerFromPending({
      kind: 'single', creatorUid: 'owner-1', state: 'pending', recoveryState: 'frozen',
      event: { id: 'ce_revision_timeout', clientRequestId: 'ce_revision_timeout', creatorUid: 'owner-1', title: 'Corrected' },
      payloadRevision: 2,
      intentRevision: 2,
      startedAt: 1,
    });
    App._runEventCreatePendingOperation = jest.fn()
      .mockResolvedValueOnce({ state: 'unavailable' })
      .mockResolvedValueOnce({ state: 'existing', marker: revisedMarker });

    await expect(App._replacePendingEventCreateIntent(editableMarker, revisedMarker)).resolves.toEqual({
      state: 'replaced',
      marker: revisedMarker,
    });
    expect(App._runEventCreatePendingOperation).toHaveBeenNthCalledWith(
      1, 'replace', 'owner-1', {
        expectedMarker: editableMarker,
        nextMarker: revisedMarker,
      },
    );
    expect(App._runEventCreatePendingOperation).toHaveBeenNthCalledWith(2, 'read', 'owner-1');
    expect(createEvent).not.toHaveBeenCalled();
    dom.window.close();
  });

  test('a timed-out Web Lock waiter cannot enter IndexedDB or mutate localStorage when invoked late', async () => {
    let lateCallback = null;
    let resolveLock = null;
    const lateLocks = {
      forTab: () => ({
        request: (_name, _options, callback) => {
          lateCallback = callback;
          return new Promise(resolve => { resolveLock = resolve; });
        },
      }),
    };
    const sharedStorage = createSharedStorage();
    const fakeIndexedDb = createFakeIndexedDb();
    const createEvent = jest.fn(async event => event);
    const { App, dom, setForm } = loadHarness(
      jest.fn(async () => ({ ok: true, users: [], missingUids: [] })),
      { sharedStorage, sharedLocks: lateLocks, indexedDB: fakeIndexedDb, createEvent },
    );
    App._eventCreatePendingWebLockTimeoutMs = 5;

    App._openCreateCustomEventModal();
    setForm('Late Lock');
    await App.handleCreateEvent();
    expect(createEvent).not.toHaveBeenCalled();
    expect(fakeIndexedDb.open).not.toHaveBeenCalled();
    expect(sharedStorage.writes).toHaveLength(0);

    resolveLock(await lateCallback());
    await flushPromiseJobs();
    expect(fakeIndexedDb.open).not.toHaveBeenCalled();
    expect(sharedStorage.writes).toHaveLength(0);
    expect(createEvent).not.toHaveBeenCalled();
    dom.window.close();
  });

  test('a late IndexedDB callback after its timeout cannot mutate localStorage or start a write', async () => {
    const sharedStorage = createSharedStorage();
    const fakeIndexedDb = createFakeIndexedDb({ hangTransaction: true });
    const createEvent = jest.fn(async event => event);
    const { App, dom, setForm } = loadHarness(
      jest.fn(async () => ({ ok: true, users: [], missingUids: [] })),
      { sharedStorage, indexedDB: fakeIndexedDb, createEvent },
    );
    App._eventCreatePendingCoordinatorTimeoutMs = 5;

    App._openCreateCustomEventModal();
    setForm('Late IDB');
    await App.handleCreateEvent();
    await flushPromiseJobs();
    const transaction = fakeIndexedDb.transactions[0];
    expect(transaction).toBeDefined();
    expect(transaction.aborted).toBe(true);
    expect(sharedStorage.writes).toHaveLength(0);
    expect(createEvent).not.toHaveBeenCalled();

    transaction.getRequest.result = undefined;
    transaction.getRequest.onsuccess?.();
    transaction.oncomplete?.();
    await flushPromiseJobs();
    expect(sharedStorage.writes).toHaveLength(0);
    expect(fakeIndexedDb.records.size).toBe(0);
    expect(createEvent).not.toHaveBeenCalled();
    dom.window.close();
  });

  test('localStorage quota failure under Web Locks fails closed inside the shared IndexedDB mutex', async () => {
    const fakeIndexedDb = createFakeIndexedDb();
    const createEvent = jest.fn(async event => event);
    const quotaStorage = createSharedStorage();
    const storageFacade = quotaStorage.forTab('quota');
    storageFacade.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    const { App, dom, setForm } = loadHarness(
      jest.fn(async () => ({ ok: true, users: [], missingUids: [] })),
      { createEvent, indexedDB: fakeIndexedDb, sharedStorage: { forTab: () => storageFacade } },
    );

    App._openCreateCustomEventModal();
    setForm('Quota Failure');
    await App.handleCreateEvent();

    expect(createEvent).not.toHaveBeenCalled();
    expect(fakeIndexedDb.open).toHaveBeenCalled();
    expect(fakeIndexedDb.stats.transactions).toBeGreaterThan(0);
    expect([...fakeIndexedDb.records.values()].every(value => !value.serialized)).toBe(true);
    expect(App._pendingSingleEventSubmission).toBeNull();
    expect(App.showToast).toHaveBeenCalledWith(expect.stringContaining('無法安全保存'));
    dom.window.close();
  });

  test('localStorage quota failure under the IndexedDB mutex fails closed without storing payload or writing network', async () => {
    const fakeIndexedDb = createFakeIndexedDb();
    const createEvent = jest.fn(async event => event);
    const quotaStorage = createSharedStorage();
    const storageFacade = quotaStorage.forTab('quota-idb');
    storageFacade.setItem = () => { throw new Error('QuotaExceededError'); };
    const { App, dom, setForm } = loadHarness(
      jest.fn(async () => ({ ok: true, users: [], missingUids: [] })),
      {
        useWebLocks: false,
        indexedDB: fakeIndexedDb,
        createEvent,
        sharedStorage: { forTab: () => storageFacade },
      },
    );

    App._openCreateCustomEventModal();
    setForm('IDB Quota');
    await App.handleCreateEvent();

    expect(createEvent).not.toHaveBeenCalled();
    expect([...fakeIndexedDb.records.values()].every(value => !value.serialized)).toBe(true);
    expect(App._pendingSingleEventSubmission).toBeNull();
    expect(App.showToast).toHaveBeenCalledWith(expect.stringContaining('無法安全保存'));
    dom.window.close();
  });

  test('a 5 MiB localStorage pressure evicts only the largest refetchable cache before claiming', async () => {
    const largeCacheKey = 'shub_c_owner-1_newsArticles';
    const smallerCacheKey = 'shub_c_gameConfigs';
    const protectedKey = 'firebase:authUser:protected';
    const capacityStorage = createCapacityStorage({
      [largeCacheKey]: 'L'.repeat(3200000),
      [smallerCacheKey]: 'S'.repeat(200000),
      [protectedKey]: 'P'.repeat(700000),
    }, 5 * 1024 * 1024);
    const { App, dom } = loadHarness(
      jest.fn(async () => ({ ok: true, users: [], missingUids: [] })),
      { sharedStorage: capacityStorage, indexedDB: createFakeIndexedDb() },
    );
    const cover = `data:image/webp;base64,${'A'.repeat(650000)}`;
    const homeNext = `data:image/webp;base64,${'B'.repeat(850000)}`;
    const marker = App._getPendingEventCreateMarkerFromPending({
      kind: 'single', creatorUid: 'owner-1', startedAt: 1,
      event: {
        id: 'ce_quota_recovery', clientRequestId: 'ce_quota_recovery', creatorUid: 'owner-1',
        image: cover, imageVariants: { cover, homeNext },
      },
    });

    expect((await App._claimPendingEventCreateIntent(marker)).state).toBe('claimed');
    expect(capacityStorage.peek(largeCacheKey)).toBeNull();
    expect(capacityStorage.peek(smallerCacheKey)).toHaveLength(200000);
    expect(capacityStorage.peek(protectedKey)).toHaveLength(700000);
    expect(capacityStorage.writes.filter(write => write.type === 'remove')).toEqual([
      expect.objectContaining({ key: largeCacheKey }),
    ]);
    expect(App._readPendingSingleEventMarker('owner-1')).toEqual(expect.objectContaining({
      intentId: 'ce_quota_recovery',
    }));
    dom.window.close();
  }, 15000);

  test('quota eviction allowlist enumerates refetchable cache families and excludes protected state', () => {
    const storage = createSharedStorage();
    const facade = storage.forTab('allowlist');
    const allowed = [
      'shub_c_other-user_newsArticles',
      'shub_c_operationLogs',
      'shub_qr_data',
      'toosterx.homeNextActivity.v1.owner-1',
      'toosterx.eduCourseRosterPreview.v1.owner-1',
    ];
    const protectedKeys = [
      'currentUser', 'shub_roles', 'shub_ts_events',
      'sportshub:event-create-pending:owner-1', 'eventTemplates', 'inputHistory', 'drafts',
    ];
    [...allowed, ...protectedKeys].forEach(key => facade.setItem(key, key));
    const { App, dom } = loadHarness(jest.fn(async () => ({ ok: true, users: [], missingUids: [] })), {
      sharedStorage: storage,
    });

    expect(new Set(App._getEventCreatePendingEvictableStorageKeys(facade))).toEqual(new Set(allowed));
    dom.window.close();
  });

  test('without Web Locks IndexedDB serializes access while localStorage remains the marker authority', async () => {
    const fakeIndexedDb = createFakeIndexedDb();
    const { App, dom } = loadHarness(
      jest.fn(async () => ({ ok: true, users: [], missingUids: [] })),
      { useWebLocks: false, indexedDB: fakeIndexedDb },
    );
    const marker = App._getPendingEventCreateMarkerFromPending({
      kind: 'single',
      creatorUid: 'owner-1',
      event: { id: 'ce_idb', clientRequestId: 'ce_idb', creatorUid: 'owner-1', title: 'IDB' },
      signature: 'idb',
      startedAt: 1,
    });

    expect(await App._claimPendingEventCreateIntent(marker)).toEqual(expect.objectContaining({ state: 'claimed' }));
    expect((await App._loadPendingEventCreateIntent('owner-1')).marker).toEqual(expect.objectContaining({ intentId: 'ce_idb' }));
    expect(App._readPendingSingleEventMarker('owner-1')).toEqual(expect.objectContaining({ intentId: 'ce_idb' }));
    expect(await App._removePendingEventCreateIntent(marker)).toBe(true);
    expect((await App._loadPendingEventCreateIntent('owner-1')).state).toBe('empty');
    expect([...fakeIndexedDb.records.values()]).toEqual([expect.objectContaining({
      creatorUid: 'owner-1',
      epoch: expect.any(Number),
    })]);
    expect([...fakeIndexedDb.records.values()][0]).not.toHaveProperty('serialized');
    expect(fakeIndexedDb.stats.deletes).toBe(0);
    dom.window.close();
  });

  test('no-Web-Locks tabs serialize through IndexedDB while claiming the same localStorage marker', async () => {
    const sharedStorage = createSharedStorage();
    const fakeIndexedDb = createFakeIndexedDb();
    const first = loadHarness(jest.fn(async () => ({ ok: true, users: [], missingUids: [] })), {
      tabId: 'idb-a', sharedStorage, useWebLocks: false, indexedDB: fakeIndexedDb,
    });
    const second = loadHarness(jest.fn(async () => ({ ok: true, users: [], missingUids: [] })), {
      tabId: 'idb-b', sharedStorage, useWebLocks: false, indexedDB: fakeIndexedDb,
    });
    const markerA = first.App._getPendingEventCreateMarkerFromPending({
      kind: 'single', creatorUid: 'owner-1',
      event: { id: 'ce_idb_a', clientRequestId: 'ce_idb_a', creatorUid: 'owner-1' },
      startedAt: 1,
    });
    const markerB = second.App._getPendingEventCreateMarkerFromPending({
      kind: 'single', creatorUid: 'owner-1',
      event: { id: 'ce_idb_b', clientRequestId: 'ce_idb_b', creatorUid: 'owner-1' },
      startedAt: 2,
    });

    const [claimA, claimB] = await Promise.all([
      first.App._claimPendingEventCreateIntent(markerA),
      second.App._claimPendingEventCreateIntent(markerB),
    ]);

    expect([claimA.state, claimB.state].sort()).toEqual(['claimed', 'existing']);
    expect(sharedStorage.writes.filter(write => write.type === 'set')).toHaveLength(1);
    expect([...fakeIndexedDb.records.values()][0]).toEqual(expect.objectContaining({
      creatorUid: 'owner-1', epoch: 2,
    }));
    expect([...fakeIndexedDb.records.values()][0]).not.toHaveProperty('serialized');
    first.dom.window.close();
    second.dom.window.close();
  });

  test.each([
    ['open', { hangOpen: true }],
    ['transaction', { hangTransaction: true }],
  ])('IndexedDB %s timeout fails closed and cannot start a late network write', async (_stage, indexedDbOptions) => {
    const fakeIndexedDb = createFakeIndexedDb(indexedDbOptions);
    const createEvent = jest.fn(async event => event);
    const { App, dom, setForm } = loadHarness(
      jest.fn(async () => ({ ok: true, users: [], missingUids: [] })),
      { useWebLocks: false, indexedDB: fakeIndexedDb, createEvent },
    );
    App._eventCreatePendingCoordinatorTimeoutMs = 5;

    App._openCreateCustomEventModal();
    setForm('IDB Timeout');
    await App.handleCreateEvent();
    await flushPromiseJobs();

    expect(createEvent).not.toHaveBeenCalled();
    expect(fakeIndexedDb.records.size).toBe(0);
    expect(App._pendingSingleEventSubmission).toBeNull();
    expect(App.showToast).toHaveBeenCalledWith(expect.stringContaining('無法安全保存'));
    dom.window.close();
  });

  test('an IndexedDB blocked open cannot mutate after the caller has failed closed', async () => {
    const database = {
      objectStoreNames: { contains: () => false },
      createObjectStore: jest.fn(),
      close: jest.fn(),
    };
    const openRequest = {
      result: database,
      transaction: { abort: jest.fn() },
      error: null,
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
      onblocked: null,
    };
    const indexedDB = {
      open: jest.fn(() => {
        setImmediate(() => openRequest.onblocked?.());
        return openRequest;
      }),
    };
    const { App, dom } = loadHarness(
      jest.fn(async () => ({ ok: true, users: [], missingUids: [] })),
      { useWebLocks: false, indexedDB },
    );

    expect(await App._loadPendingEventCreateIntent('owner-1')).toEqual({ state: 'unavailable' });
    openRequest.onupgradeneeded?.();
    openRequest.onsuccess?.();

    expect(database.createObjectStore).not.toHaveBeenCalled();
    expect(openRequest.transaction.abort).toHaveBeenCalled();
    expect(database.close).toHaveBeenCalled();
    dom.window.close();
  });

  test('a stale tab cannot retry after another tab removes the canonical intent', async () => {
    const sharedStorage = createSharedStorage();
    const sharedLocks = createDeterministicLockManager();
    const firstWrite = deferred();
    const createEvent = jest.fn(() => firstWrite.promise);
    const first = loadHarness(jest.fn(async () => ({ ok: true, users: [], missingUids: [] })), {
      tabId: 'stale-a', sharedStorage, sharedLocks, createEvent, generateId: jest.fn(() => 'ce_stale_a'),
    });
    const deadlines = installManualCreateDeadlines(first.App);
    first.App._openCreateCustomEventModal();
    first.setForm('Stale A');
    const firstSubmit = first.App.handleCreateEvent();
    for (let attempt = 0; attempt < 50 && createEvent.mock.calls.length < 1; attempt += 1) await flushPromiseJobs();
    await deadlines.expireNext('event-create-write-timeout');
    await firstSubmit;

    const canonicalMarker = first.App._readPendingSingleEventMarker('owner-1');
    const second = loadHarness(jest.fn(async () => ({ ok: true, users: [], missingUids: [] })), {
      tabId: 'stale-b', sharedStorage, sharedLocks,
    });
    expect(await second.App._removePendingEventCreateIntent(canonicalMarker)).toBe(true);
    first.reconcileEventCreate.mockResolvedValueOnce({ state: 'missing' });
    await first.App.handleCreateEvent();

    expect(createEvent).toHaveBeenCalledTimes(1);
    expect(first.App._pendingSingleEventSubmission).not.toBeNull();
    expect(first.App.showToast).toHaveBeenCalledWith(expect.stringContaining('其他分頁更新'));
    firstWrite.reject(new Error('late failure'));
    await flushPromiseJobs();
    first.dom.window.close();
    second.dom.window.close();
  });

  test('a rejected retry preserves an older in-flight attempt whose late success commits the intent', async () => {
    const firstWrite = deferred();
    const secondWrite = deferred();
    const createEvent = jest.fn()
      .mockImplementationOnce(() => firstWrite.promise)
      .mockImplementationOnce(() => secondWrite.promise);
    const { App, dom, reconcileEventCreate, setForm } = loadHarness(
      jest.fn(async () => ({ ok: true, users: [], missingUids: [] })),
      { createEvent },
    );
    const deadlines = installManualCreateDeadlines(App);

    App._openCreateCustomEventModal();
    setForm('Overlap Retry');
    const submitOne = App.handleCreateEvent();
    for (let attempt = 0; attempt < 50 && createEvent.mock.calls.length < 1; attempt += 1) await flushPromiseJobs();
    await deadlines.expireNext('event-create-write-timeout');
    await submitOne;

    reconcileEventCreate.mockResolvedValueOnce({ state: 'missing' });
    const submitTwo = App.handleCreateEvent();
    for (let attempt = 0; attempt < 50 && createEvent.mock.calls.length < 2; attempt += 1) await flushPromiseJobs();
    secondWrite.reject(new Error('retry failed'));
    await submitTwo;

    expect(App._pendingSingleEventSubmission).not.toBeNull();
    expect(App._readPendingSingleEventMarker('owner-1')).not.toBeNull();
    expect(dom.window.document.getElementById('create-event-modal').classList.contains('open')).toBe(true);

    firstWrite.resolve({ id: 'ce_created', clientRequestId: 'ce_created', creatorUid: 'owner-1' });
    await flushPromiseJobs();
    await App.handleCreateEvent();

    expect(createEvent).toHaveBeenCalledTimes(2);
    expect(createEvent.mock.calls[1][0]).toEqual(createEvent.mock.calls[0][0]);
    expect(App._pendingSingleEventSubmission).toBeNull();
    expect(App._readPendingSingleEventMarker('owner-1')).toBeNull();
    expect(dom.window.document.getElementById('create-event-modal').classList.contains('open')).toBe(false);
    dom.window.close();
  });

  test('all rejected attempts plus server missing keep retrying the same frozen id', async () => {
    const generateId = jest.fn(() => 'ce_first');
    const createEvent = jest.fn()
      .mockRejectedValueOnce(new Error('first rejected'))
      .mockRejectedValueOnce(new Error('second rejected'))
      .mockResolvedValueOnce({ id: 'ce_first', clientRequestId: 'ce_first', creatorUid: 'owner-1' });
    const { App, dom, reconcileEventCreate, setForm } = loadHarness(
      jest.fn(async () => ({ ok: true, users: [], missingUids: [] })),
      { createEvent, generateId },
    );

    App._openCreateCustomEventModal();
    setForm('Rejected Intent');
    await App.handleCreateEvent();

    expect(App._pendingSingleEventSubmission).not.toBeNull();
    expect(App._readPendingSingleEventMarker('owner-1')?.intentId).toBe('ce_first');
    reconcileEventCreate.mockResolvedValueOnce({ state: 'missing' });
    await App.handleCreateEvent();

    expect(createEvent).toHaveBeenCalledTimes(2);
    expect(createEvent.mock.calls[1][0]).toEqual(createEvent.mock.calls[0][0]);
    expect(App._pendingSingleEventSubmission).not.toBeNull();
    expect(App._readPendingSingleEventMarker('owner-1')?.intentId).toBe('ce_first');
    expect(dom.window.document.getElementById('create-event-modal').classList.contains('open')).toBe(true);

    reconcileEventCreate.mockResolvedValueOnce({ state: 'missing' });
    await App.handleCreateEvent();
    expect(createEvent).toHaveBeenCalledTimes(3);
    expect(createEvent.mock.calls.map(call => call[0].id)).toEqual(['ce_first', 'ce_first', 'ce_first']);
    expect(generateId).toHaveBeenCalledTimes(1);
    expect(App._pendingSingleEventSubmission).toBeNull();
    expect(App._readPendingSingleEventMarker('owner-1')).toBeNull();
    dom.window.close();
  });

  test.each([
    ['permission-denied', 'permission-denied'],
    ['invalid-argument', 'invalid-argument'],
    ['unauthenticated', 'unauthenticated'],
  ])('%s plus server missing unlocks the real modal body and revises the same single id', async (_label, code) => {
    const generateId = jest.fn(() => 'ce_definitive');
    const createEvent = jest.fn()
      .mockRejectedValueOnce(makeTransactionCreateWriteError(code))
      .mockImplementationOnce(async event => event);
    const reconcileEventCreate = jest.fn(async () => ({ state: 'missing' }));
    const { App, dom, setForm } = loadHarness(
      jest.fn(async () => ({ ok: true, users: [], missingUids: [] })),
      { createEvent, reconcileEventCreate, generateId },
    );

    App._openCreateCustomEventModal();
    setForm('Needs Correction');
    await App.handleCreateEvent();

    const body = dom.window.document.querySelector('#create-event-modal > .modal-body');
    const editableMarker = App._readPendingSingleEventMarker('owner-1');
    expect(reconcileEventCreate).toHaveBeenCalledTimes(1);
    expect(editableMarker).toEqual(expect.objectContaining({
      intentId: 'ce_definitive',
      payloadRevision: 1,
      recoveryState: 'editable',
    }));
    expect(editableMarker.payloadDigest).toMatch(/^v1-[0-9a-f]{32}$/);
    expect(editableMarker.signature).toMatch(/^v1-[0-9a-f]{32}$/);
    expect(body.inert).toBe(false);
    expect(dom.window.document.getElementById('ce-submit-btn').textContent).toBe('修正後重新送出');
    expect(dom.window.document.getElementById('create-event-modal').classList.contains('open')).toBe(true);

    setForm('Corrected Fields');
    await App.handleCreateEvent();

    expect(createEvent).toHaveBeenCalledTimes(2);
    expect(createEvent.mock.calls[1][0]).toEqual(expect.objectContaining({
      id: 'ce_definitive',
      clientRequestId: 'ce_definitive',
      title: 'Corrected Fields',
    }));
    expect(generateId).toHaveBeenCalledTimes(1);
    expect(App._readPendingSingleEventMarker('owner-1')).toBeNull();
    expect(App._pendingSingleEventSubmission).toBeNull();
    expect(dom.window.document.getElementById('create-event-modal').classList.contains('open')).toBe(false);
    dom.window.close();
  });

  test.each([
    ['committed', { state: 'committed', event: { id: 'ce_authoritative', clientRequestId: 'ce_authoritative', creatorUid: 'owner-1' } }, false],
    ['conflict', { state: 'conflict' }, true],
  ])('transaction permission rejection waits for server %s before deciding recovery', async (_label, reconciliation, remainsOpen) => {
    const createEvent = jest.fn(async () => { throw makeTransactionCreateWriteError('permission-denied'); });
    const reconcileEventCreate = jest.fn(async () => reconciliation);
    const { App, dom, setForm } = loadHarness(
      jest.fn(async () => ({ ok: true, users: [], missingUids: [] })),
      { createEvent, reconcileEventCreate, generateId: jest.fn(() => 'ce_authoritative') },
    );

    App._openCreateCustomEventModal();
    setForm('Auth Reject');
    await App.handleCreateEvent();

    expect(createEvent).toHaveBeenCalledTimes(1);
    expect(reconcileEventCreate).toHaveBeenCalledTimes(1);
    expect(dom.window.document.getElementById('create-event-modal').classList.contains('open')).toBe(remainsOpen);
    if (remainsOpen) {
      expect(App._readPendingSingleEventMarker('owner-1')).toEqual(expect.objectContaining({
        recoveryState: 'frozen',
      }));
      expect(dom.window.document.querySelector('#create-event-modal > .modal-body').inert).toBe(true);
    } else {
      expect(App._readPendingSingleEventMarker('owner-1')).toBeNull();
    }
    dom.window.close();
  });

  test('a transaction-started unavailable rejection stays frozen without treating it as authoritative', async () => {
    const createEvent = jest.fn(async () => {
      throw makeTransactionCreateWriteError('unavailable');
    });
    const reconcileEventCreate = jest.fn(async () => ({ state: 'missing' }));
    const { App, dom, setForm } = loadHarness(
      jest.fn(async () => ({ ok: true, users: [], missingUids: [] })),
      { createEvent, reconcileEventCreate },
    );

    App._openCreateCustomEventModal();
    setForm('Ambiguous');
    await App.handleCreateEvent();

    expect(reconcileEventCreate).not.toHaveBeenCalled();
    expect(App._readPendingSingleEventMarker('owner-1')).toEqual(expect.objectContaining({
      payloadRevision: 1,
      recoveryState: 'frozen',
    }));
    expect(dom.window.document.querySelector('#create-event-modal > .modal-body').inert).toBe(true);
    expect(dom.window.document.getElementById('ce-submit-btn').textContent).toBe('確認建立結果');
    dom.window.close();
  });

  test('a definitive multi rejection unlocks editing but preserves every event id and the batch id on revision', async () => {
    const generateId = jest.fn(() => 'ce_multi_base');
    const createEventsAtomic = jest.fn()
      .mockRejectedValueOnce(makeTransactionCreateWriteError('permission-denied'))
      .mockImplementationOnce(async events => events);
    const reconcileEventCreate = jest.fn(async () => ({ state: 'missing' }));
    const { App, dom, setForm } = loadHarness(
      jest.fn(async () => ({ ok: true, users: [], missingUids: [] })),
      { createEventsAtomic, reconcileEventCreate, generateId },
    );
    let buildCount = 0;
    App._isMultiDateMode = () => true;
    App._multiDates = ['2099-01-01', '2099-01-08'];
    App._buildMultiDateEvents = jest.fn(base => {
      buildCount += 1;
      const suffix = buildCount === 1 ? 'original' : 'replacement';
      return App._multiDates.map((date, index) => ({
        ...base,
        id: `ce_${suffix}_${index}`,
        batchGroupId: `batch_${suffix}`,
        date: `${date.replace(/-/g, '/')} 14:00~16:00`,
      }));
    });

    App._openCreateCustomEventModal();
    setForm('Batch Correction');
    await App.handleCreateEvent();

    const editable = App._readPendingSingleEventMarker('owner-1');
    expect(editable).toEqual(expect.objectContaining({
      kind: 'multi',
      batchGroupId: 'batch_original',
      payloadRevision: 1,
      recoveryState: 'editable',
    }));
    expect(dom.window.document.querySelector('#create-event-modal > .modal-body').inert).toBe(false);

    App._multiDates = ['2099-01-01', '2099-01-08', '2099-01-15'];
    await App.handleCreateEvent();
    expect(createEventsAtomic).toHaveBeenCalledTimes(1);
    expect(App._readPendingSingleEventMarker('owner-1')).toEqual(expect.objectContaining({
      payloadRevision: 1,
      recoveryState: 'editable',
    }));

    App._multiDates = ['2099-01-01', '2099-01-08'];
    setForm('Corrected Batch');
    await App.handleCreateEvent();

    expect(createEventsAtomic).toHaveBeenCalledTimes(2);
    expect(createEventsAtomic.mock.calls[1][0].map(event => ({
      id: event.id,
      clientRequestId: event.clientRequestId,
      batchGroupId: event.batchGroupId,
      title: event.title,
    }))).toEqual([
      { id: 'ce_original_0', clientRequestId: 'ce_original_0', batchGroupId: 'batch_original', title: 'Corrected Batch' },
      { id: 'ce_original_1', clientRequestId: 'ce_original_1', batchGroupId: 'batch_original', title: 'Corrected Batch' },
    ]);
    expect(generateId).toHaveBeenCalledTimes(1);
    expect(App._readPendingSingleEventMarker('owner-1')).toBeNull();
    dom.window.close();
  });

  test('partial multi reconciliation stays frozen after a definitive rejection', async () => {
    const batch = [
      { id: 'ce_partial_1', creatorUid: 'owner-1', batchGroupId: 'batch-partial' },
      { id: 'ce_partial_2', creatorUid: 'owner-1', batchGroupId: 'batch-partial' },
    ];
    const createEventsAtomic = jest.fn(async () => {
      throw makeTransactionCreateWriteError('permission-denied');
    });
    const reconcileEventCreate = jest.fn()
      .mockResolvedValueOnce({ state: 'committed', event: batch[0] })
      .mockResolvedValueOnce({ state: 'missing' });
    const { App, dom, setForm } = loadHarness(
      jest.fn(async () => ({ ok: true, users: [], missingUids: [] })),
      { createEventsAtomic, reconcileEventCreate },
    );
    App._isMultiDateMode = () => true;
    App._multiDates = ['2099-01-01', '2099-01-08'];
    App._buildMultiDateEvents = jest.fn(() => batch);

    App._openCreateCustomEventModal();
    setForm('Partial Batch');
    await App.handleCreateEvent();

    expect(App._readPendingSingleEventMarker('owner-1')).toEqual(expect.objectContaining({
      recoveryState: 'frozen',
    }));
    expect(dom.window.document.querySelector('#create-event-modal > .modal-body').inert).toBe(true);
    expect(createEventsAtomic).toHaveBeenCalledTimes(1);
    dom.window.close();
  });

  test('reload restores the frozen single payload and retries the original id after server missing', async () => {
    const sharedStorage = createSharedStorage();
    const sharedLocks = createDeterministicLockManager();
    const lateWrite = deferred();
    const firstCreate = jest.fn(() => lateWrite.promise);
    const first = loadHarness(jest.fn(async () => ({ ok: true, users: [], missingUids: [] })), {
      tabId: 'before-reload',
      sharedStorage,
      sharedLocks,
      generateId: jest.fn(() => 'ce_before_reload'),
      createEvent: firstCreate,
    });
    const deadlines = installManualCreateDeadlines(first.App);
    first.App._openCreateCustomEventModal();
    first.setForm('Persisted Create');
    const firstSubmit = first.App.handleCreateEvent();
    for (let attempt = 0; attempt < 50 && firstCreate.mock.calls.length < 1; attempt += 1) await flushPromiseJobs();
    await deadlines.expireNext('event-create-write-timeout');
    await firstSubmit;

    const afterGenerate = jest.fn(() => 'ce_after_reload');
    const afterCreate = jest.fn(async event => event);
    const reconcileEventCreate = jest.fn(async () => ({ state: 'missing' }));
    const second = loadHarness(jest.fn(async () => ({ ok: true, users: [], missingUids: [] })), {
      tabId: 'after-reload',
      sharedStorage,
      sharedLocks,
      generateId: afterGenerate,
      createEvent: afterCreate,
      reconcileEventCreate,
    });
    second.App._openCreateCustomEventModal();
    await second.App.handleCreateEvent();

    expect(reconcileEventCreate).toHaveBeenCalledWith(expect.objectContaining({
      id: 'ce_before_reload',
      clientRequestId: 'ce_before_reload',
      creatorUid: 'owner-1',
      payloadRevision: 1,
      payloadDigest: expect.stringMatching(/^v1-[0-9a-f]{32}$/),
    }));
    expect(afterCreate).toHaveBeenCalledTimes(1);
    expect(afterCreate.mock.calls[0][0]).toEqual(expect.objectContaining({
      id: 'ce_before_reload',
      clientRequestId: 'ce_before_reload',
      title: 'Persisted Create',
    }));
    expect(afterGenerate).not.toHaveBeenCalled();
    expect(second.App._readPendingSingleEventMarker('owner-1')).toBeNull();

    lateWrite.resolve({ id: 'ce_before_reload', clientRequestId: 'ce_before_reload', creatorUid: 'owner-1' });
    await flushPromiseJobs();
    expect(second.App._readPendingSingleEventMarker('owner-1')).toBeNull();
    first.dom.window.close();
    second.dom.window.close();
  });

  test('reload of an editable marker fails closed when the full form cannot be hydrated', async () => {
    const sharedStorage = createSharedStorage();
    const sharedLocks = createDeterministicLockManager();
    const fakeIndexedDb = createFakeIndexedDb();
    const first = loadHarness(jest.fn(async () => ({ ok: true, users: [], missingUids: [] })), {
      tabId: 'editable-before', sharedStorage, sharedLocks, indexedDB: fakeIndexedDb,
    });
    const marker = first.App._getPendingEventCreateMarkerFromPending({
      kind: 'single', creatorUid: 'owner-1', state: 'editable', recoveryState: 'editable',
      event: { id: 'ce_editable_reload', clientRequestId: 'ce_editable_reload', creatorUid: 'owner-1', title: 'Frozen Form' },
      payloadRevision: 2,
      startedAt: 1,
    });
    expect((await first.App._claimPendingEventCreateIntent(marker)).state).toBe('claimed');
    first.dom.window.close();

    const createEvent = jest.fn(async event => event);
    const reconcileEventCreate = jest.fn(async () => ({ state: 'missing' }));
    const second = loadHarness(jest.fn(async () => ({ ok: true, users: [], missingUids: [] })), {
      tabId: 'editable-after', sharedStorage, sharedLocks, indexedDB: fakeIndexedDb,
      createEvent, reconcileEventCreate,
    });
    second.App._openCreateCustomEventModal();
    second.setForm('Unsafe Replacement');
    await second.App.handleCreateEvent();

    expect(createEvent).not.toHaveBeenCalled();
    expect(reconcileEventCreate).not.toHaveBeenCalled();
    expect(second.App._readPendingSingleEventMarker('owner-1')).toEqual(expect.objectContaining({
      intentId: 'ce_editable_reload',
      payloadRevision: 2,
      recoveryState: 'editable',
    }));
    expect(second.dom.window.document.querySelector('#create-event-modal > .modal-body').inert).toBe(true);
    expect(second.App.showToast).toHaveBeenCalledWith(expect.stringContaining('無法安全還原'));
    second.dom.window.close();
  });

  test.each([
    ['Web Locks to IndexedDB mutex', true, false],
    ['IndexedDB mutex to Web Locks', false, true],
  ])('%s capability transition reloads the same localStorage intent', async (_label, beforeLocks, afterLocks) => {
    const sharedStorage = createSharedStorage();
    const sharedLocks = createDeterministicLockManager();
    const fakeIndexedDb = createFakeIndexedDb();
    const markerOptions = {
      tabId: 'cap-before', sharedStorage, sharedLocks,
      useWebLocks: beforeLocks, indexedDB: fakeIndexedDb,
    };
    const first = loadHarness(jest.fn(async () => ({ ok: true, users: [], missingUids: [] })), markerOptions);
    const marker = first.App._getPendingEventCreateMarkerFromPending({
      kind: 'single', creatorUid: 'owner-1',
      event: { id: 'ce_capability', clientRequestId: 'ce_capability', creatorUid: 'owner-1', title: 'Capability' },
      startedAt: 1,
    });
    expect((await first.App._claimPendingEventCreateIntent(marker)).state).toBe('claimed');

    const second = loadHarness(jest.fn(async () => ({ ok: true, users: [], missingUids: [] })), {
      tabId: 'cap-after', sharedStorage, sharedLocks,
      useWebLocks: afterLocks, indexedDB: fakeIndexedDb,
    });
    const loaded = await second.App._loadPendingEventCreateIntent('owner-1');

    expect(loaded.state).toBe('existing');
    expect(loaded.marker).toEqual(expect.objectContaining({ intentId: 'ce_capability' }));
    expect(second.App._readPendingSingleEventMarker('owner-1')).toEqual(expect.objectContaining({
      intentId: 'ce_capability',
    }));
    first.dom.window.close();
    second.dom.window.close();
  });

  test('committed remove followed by capability switch cannot resurrect the marker', async () => {
    const sharedStorage = createSharedStorage();
    const sharedLocks = createDeterministicLockManager();
    const fakeIndexedDb = createFakeIndexedDb();
    const first = loadHarness(jest.fn(async () => ({ ok: true, users: [], missingUids: [] })), {
      tabId: 'remove-lock', sharedStorage, sharedLocks, indexedDB: fakeIndexedDb,
    });
    const marker = first.App._getPendingEventCreateMarkerFromPending({
      kind: 'single', creatorUid: 'owner-1',
      event: { id: 'ce_removed', clientRequestId: 'ce_removed', creatorUid: 'owner-1' },
      startedAt: 1,
    });
    expect((await first.App._claimPendingEventCreateIntent(marker)).state).toBe('claimed');
    expect(await first.App._removePendingEventCreateIntent(marker)).toBe(true);

    const second = loadHarness(jest.fn(async () => ({ ok: true, users: [], missingUids: [] })), {
      tabId: 'remove-idb', sharedStorage, useWebLocks: false, indexedDB: fakeIndexedDb,
    });
    expect((await second.App._loadPendingEventCreateIntent('owner-1')).state).toBe('empty');
    expect(second.App._readPendingSingleEventMarker('owner-1')).toBeNull();
    expect([...fakeIndexedDb.records.values()].every(value => !value.serialized)).toBe(true);
    first.dom.window.close();
    second.dom.window.close();
  });

  test('multi marker tags shared-delta-v1, stores 30 identical images once, and deep-clones expansion', () => {
    const { App, dom } = loadHarness(jest.fn(async () => ({ ok: true, users: [], missingUids: [] })));
    const repeatedImage = `data:image/webp;base64,${'A'.repeat(12000)}`;
    const imageVariants = {
      cover: repeatedImage,
      homeNext: `data:image/webp;base64,${'B'.repeat(6000)}`,
    };
    const events = Array.from({ length: 30 }, (_, index) => ({
      id: `ce_compact_${index}`,
      clientRequestId: `ce_compact_${index}`,
      creatorUid: 'owner-1',
      batchGroupId: 'batch_compact',
      title: 'Compact Batch',
      image: repeatedImage,
      imageVariants,
      date: `2099/01/${String(index + 1).padStart(2, '0')} 14:00~16:00`,
    }));
    const marker = App._getPendingEventCreateMarkerFromPending({
      kind: 'multi', creatorUid: 'owner-1', events, startedAt: 1,
    });
    const serialized = App._serializePendingEventCreateMarker(marker);
    const parsed = App._parsePendingEventCreateMarker(serialized, 'owner-1');
    const wire = JSON.parse(serialized);
    const compact = wire.marker;

    expect(wire.wireEncoding).toBe('base64-table-v1');
    expect(wire.blobs).toEqual([repeatedImage, imageVariants.homeNext]);
    expect(compact.eventEncoding).toBe('shared-delta-v1');
    expect(compact.imageEncoding).toBe('cover-alias-v1');
    expect(compact.imageFromCoverIndexes).toHaveLength(30);
    expect(compact.sharedEvent).not.toHaveProperty('image');
    expect(compact.events.every(event => Object.prototype.hasOwnProperty.call(event, 'id'))).toBe(true);
    expect(compact.events.every(event => Object.prototype.hasOwnProperty.call(event, 'clientRequestId'))).toBe(true);
    expect((serialized.match(/data:image\/webp;base64/g) || [])).toHaveLength(2);
    expect(serialized.length).toBeLessThan(repeatedImage.length + JSON.stringify(imageVariants).length + 5000);
    expect(parsed.events).toEqual(events);
    expect(parsed.events[0].imageVariants).not.toBe(parsed.events[1].imageVariants);
    parsed.events[0].imageVariants.homeNext = 'changed';
    expect(parsed.events[1].imageVariants.homeNext).toBe(imageVariants.homeNext);
    dom.window.close();
  });

  test('a production-sized single marker stores image equals cover once and remains claimable under the guard', async () => {
    const sharedStorage = createSharedStorage();
    const { App, dom } = loadHarness(jest.fn(async () => ({ ok: true, users: [], missingUids: [] })), {
      sharedStorage,
    });
    const cover = `data:image/webp;base64,${'A'.repeat(650000)}`;
    const homeNext = `data:image/webp;base64,${'B'.repeat(850000)}`;
    const event = {
      id: 'ce_production_image',
      clientRequestId: 'ce_production_image',
      creatorUid: 'owner-1',
      title: 'High Detail',
      image: cover,
      imageVariants: { cover, homeNext },
    };
    const marker = App._getPendingEventCreateMarkerFromPending({
      kind: 'single', creatorUid: 'owner-1', event, startedAt: 1,
    });
    const serialized = App._serializePendingEventCreateMarker(marker);
    const firstCoverIndex = serialized.indexOf(cover);

    expect(firstCoverIndex).toBeGreaterThanOrEqual(0);
    expect(serialized.indexOf(cover, firstCoverIndex + cover.length)).toBe(-1);
    expect(serialized.length).toBeLessThan(App._eventCreatePendingMaxSerializedChars);
    expect(App._parsePendingEventCreateMarker(serialized, 'owner-1')?.event).toEqual(event);
    expect((await App._claimPendingEventCreateIntent(marker)).state).toBe('claimed');
    expect(App._readPendingSingleEventMarker('owner-1')?.event).toEqual(event);
    dom.window.close();
  }, 15000);

  test('slow marker preparation finishes before the bounded IndexedDB coordinator starts', async () => {
    const fakeIndexedDb = createFakeIndexedDb();
    const { App, dom } = loadHarness(jest.fn(async () => ({ ok: true, users: [], missingUids: [] })), {
      indexedDB: fakeIndexedDb,
    });
    const marker = App._getPendingEventCreateMarkerFromPending({
      kind: 'single', creatorUid: 'owner-1', startedAt: 1,
      event: { id: 'ce_slow_prepare', clientRequestId: 'ce_slow_prepare', creatorUid: 'owner-1' },
    });
    const serialize = App._serializePendingEventCreateMarker.bind(App);
    let preparationFinished = false;
    App._serializePendingEventCreateMarker = value => {
      const deadline = Date.now() + 30;
      while (Date.now() < deadline) {} // deterministic CPU cost belongs outside lock/IDB timeout
      preparationFinished = true;
      return serialize(value);
    };
    const open = fakeIndexedDb.open;
    fakeIndexedDb.open = jest.fn((...args) => {
      expect(preparationFinished).toBe(true);
      return open(...args);
    });
    App._eventCreatePendingCoordinatorTimeoutMs = 10;

    expect((await App._claimPendingEventCreateIntent(marker)).state).toBe('claimed');
    expect(fakeIndexedDb.stats.commits).toBe(1);
    dom.window.close();
  });

  test.each([
    ['wrong image alias tag', compact => { compact.imageEncoding = 'cover-alias-v2'; }],
    ['out-of-range image alias', compact => { compact.imageFromCoverIndexes = [1]; }],
    ['image alias with an explicit image', compact => { compact.event.image = 'duplicate'; }],
  ])('image alias parser rejects %s', (_label, mutate) => {
    const { App, dom } = loadHarness(jest.fn(async () => ({ ok: true, users: [], missingUids: [] })));
    const cover = `data:image/webp;base64,${'COVER'.repeat(20)}`;
    const event = {
      id: 'ce_alias', clientRequestId: 'ce_alias', creatorUid: 'owner-1',
      image: cover, imageVariants: { cover },
    };
    const marker = App._getPendingEventCreateMarkerFromPending({
      kind: 'single', creatorUid: 'owner-1', event, startedAt: 1,
    });
    const wire = JSON.parse(App._serializePendingEventCreateMarker(marker));
    const compact = wire.marker;
    mutate(compact);

    expect(App._parsePendingEventCreateMarker(JSON.stringify(wire), 'owner-1')).toBeNull();
    dom.window.close();
  });

  test('multi-date Firestore errors use the same add-on-specific message mapper as single create', () => {
    const { App, dom } = loadHarness(jest.fn(async () => ({ ok: true, users: [], missingUids: [] })));
    const error = makeCreateWriteError('permission-denied');
    const message = App._getFirestoreWriteErrorMessageForUser(error, {
      label: 'createEventsAtomic',
      payload: { privateEvent: true },
    });

    expect(message).toContain('私密活動');
    expect(message).toContain('請關閉相關進階功能後再試');
    dom.window.close();
  });

  test('shared-delta codec dedupes null but not missing or different fields', () => {
    const { App, dom } = loadHarness(jest.fn(async () => ({ ok: true, users: [], missingUids: [] })));
    const events = [
      { id: 'ce_shape_1', clientRequestId: 'ce_shape_1', creatorUid: 'owner-1', batchGroupId: 'batch-shape', commonNull: null, optional: 'only-first', different: 'a' },
      { id: 'ce_shape_2', clientRequestId: 'ce_shape_2', creatorUid: 'owner-1', batchGroupId: 'batch-shape', commonNull: null, different: 'b' },
      { id: 'ce_shape_3', clientRequestId: 'ce_shape_3', creatorUid: 'owner-1', batchGroupId: 'batch-shape', commonNull: null, different: 'c' },
    ];
    const marker = App._getPendingEventCreateMarkerFromPending({
      kind: 'multi', creatorUid: 'owner-1', events, startedAt: 1,
    });
    const compact = JSON.parse(App._serializePendingEventCreateMarker(marker));

    expect(compact.sharedEvent.commonNull).toBeNull();
    expect(compact.sharedEvent).not.toHaveProperty('optional');
    expect(compact.sharedEvent).not.toHaveProperty('different');
    expect(compact.events[0].optional).toBe('only-first');
    expect(compact.events.map(event => event.different)).toEqual(['a', 'b', 'c']);
    expect(App._parsePendingEventCreateMarker(JSON.stringify({ ...marker }), 'owner-1')?.events).toEqual(events);
    dom.window.close();
  });

  test.each([
    ['missing encoding tag', compact => { delete compact.eventEncoding; }],
    ['wrong encoding tag', compact => { compact.eventEncoding = 'shared-delta-v2'; }],
    ['array shared event', compact => { compact.sharedEvent = []; }],
    ['overlapping shared and delta key', compact => { compact.sharedEvent.id = compact.events[0].id; }],
  ])('shared-delta parser rejects %s', (_label, mutate) => {
    const { App, dom } = loadHarness(jest.fn(async () => ({ ok: true, users: [], missingUids: [] })));
    const events = [
      { id: 'ce_codec_1', clientRequestId: 'ce_codec_1', creatorUid: 'owner-1', batchGroupId: 'batch-codec', title: 'Same' },
      { id: 'ce_codec_2', clientRequestId: 'ce_codec_2', creatorUid: 'owner-1', batchGroupId: 'batch-codec', title: 'Same' },
    ];
    const marker = App._getPendingEventCreateMarkerFromPending({
      kind: 'multi', creatorUid: 'owner-1', events, startedAt: 1,
    });
    const compact = JSON.parse(App._serializePendingEventCreateMarker(marker));
    mutate(compact);

    expect(App._parsePendingEventCreateMarker(JSON.stringify(compact), 'owner-1')).toBeNull();
    dom.window.close();
  });

  test('shared-delta parser rejects dangerous keys and serializer rejects lossy values', () => {
    const { App, dom } = loadHarness(jest.fn(async () => ({ ok: true, users: [], missingUids: [] })));
    const dangerous = '{"version":2,"kind":"multi","creatorUid":"owner-1","intentId":"batch-danger","batchGroupId":"batch-danger","startedAt":1,"eventEncoding":"shared-delta-v1","sharedEvent":{"__proto__":{"polluted":true}},"events":[{"id":"ce_danger_1","clientRequestId":"ce_danger_1","creatorUid":"owner-1","batchGroupId":"batch-danger"},{"id":"ce_danger_2","clientRequestId":"ce_danger_2","creatorUid":"owner-1","batchGroupId":"batch-danger"}]}';
    expect(App._parsePendingEventCreateMarker(dangerous, 'owner-1')).toBeNull();
    expect({}.polluted).toBeUndefined();

    const baseEvents = () => [
      { id: 'ce_lossy_1', clientRequestId: 'ce_lossy_1', creatorUid: 'owner-1', batchGroupId: 'batch-lossy' },
      { id: 'ce_lossy_2', clientRequestId: 'ce_lossy_2', creatorUid: 'owner-1', batchGroupId: 'batch-lossy' },
    ];
    const serializeWithInvalidValue = invalidValue => {
      const events = baseEvents();
      events.forEach(event => { event.invalid = invalidValue; });
      const marker = App._getPendingEventCreateMarkerFromPending({
        kind: 'multi', creatorUid: 'owner-1', events, startedAt: 1,
      });
      return () => App._serializePendingEventCreateMarker(marker);
    };
    expect(serializeWithInvalidValue(undefined)).toThrow();
    expect(serializeWithInvalidValue(() => true)).toThrow();
    expect(serializeWithInvalidValue(Number.POSITIVE_INFINITY)).toThrow();
    expect(serializeWithInvalidValue(-0)).toThrow();
    expect(serializeWithInvalidValue({
      __sportshubEventCreateDate: '2099-01-01T00:00:00.000Z',
    })).toThrow();
    const sparse = [];
    sparse.length = 2;
    sparse[1] = 'value';
    const sparseEvents = baseEvents();
    sparseEvents.forEach(event => { event.invalid = sparse; });
    const sparseMarker = App._getPendingEventCreateMarkerFromPending({
      kind: 'multi', creatorUid: 'owner-1', events: sparseEvents, startedAt: 1,
    });
    expect(() => App._serializePendingEventCreateMarker(sparseMarker)).toThrow();

    class UnsupportedPayload { constructor() { this.value = 1; } }
    const unsupportedEvents = baseEvents();
    unsupportedEvents.forEach(event => { event.invalid = new UnsupportedPayload(); });
    const unsupportedMarker = App._getPendingEventCreateMarkerFromPending({
      kind: 'multi', creatorUid: 'owner-1', events: unsupportedEvents, startedAt: 1,
    });
    expect(() => App._serializePendingEventCreateMarker(unsupportedMarker)).toThrow();

    class Timestamp {
      constructor(date) { this.date = date; }
      toDate() { return this.date; }
    }
    const supportedEvents = baseEvents();
    supportedEvents.forEach(event => {
      event.nested = { date: new Date('2099-01-01T00:00:00.000Z'), timestamp: new Timestamp(new Date('2099-01-02T00:00:00.000Z')) };
    });
    const supportedMarker = App._getPendingEventCreateMarkerFromPending({
      kind: 'multi', creatorUid: 'owner-1', events: supportedEvents, startedAt: 1,
    });
    const supportedParsed = App._parsePendingEventCreateMarker(
      App._serializePendingEventCreateMarker(supportedMarker),
      'owner-1',
    );
    expect(supportedParsed.events[0].nested.date.getTime()).toBe(new Date('2099-01-01T00:00:00.000Z').getTime());
    expect(supportedParsed.events[0].nested.timestamp.getTime()).toBe(new Date('2099-01-02T00:00:00.000Z').getTime());
    expect(supportedParsed.events[0].nested).not.toBe(supportedParsed.events[1].nested);
    dom.window.close();
  });

  test('multi-date timeout reload retries the frozen batch with the exact original ids', async () => {
    const sharedStorage = createSharedStorage();
    const sharedLocks = createDeterministicLockManager();
    const lateBatch = deferred();
    const originalBatch = [
      { id: 'ce_multi_1', title: 'Frozen Batch', creatorUid: 'owner-1', batchGroupId: 'batch-frozen' },
      { id: 'ce_multi_2', title: 'Frozen Batch', creatorUid: 'owner-1', batchGroupId: 'batch-frozen' },
    ];
    const firstAtomic = jest.fn(() => lateBatch.promise);
    const first = loadHarness(jest.fn(async () => ({ ok: true, users: [], missingUids: [] })), {
      tabId: 'multi-before',
      sharedStorage,
      sharedLocks,
      createEventsAtomic: firstAtomic,
    });
    first.App._isMultiDateMode = () => true;
    first.App._multiDates = ['2099-01-01', '2099-01-08'];
    first.App._buildMultiDateEvents = jest.fn(() => originalBatch);
    const deadlines = installManualCreateDeadlines(first.App);
    first.App._openCreateCustomEventModal();
    first.setForm('Frozen Batch');
    const firstSubmit = first.App.handleCreateEvent();
    for (let attempt = 0; attempt < 50 && firstAtomic.mock.calls.length < 1; attempt += 1) await flushPromiseJobs();
    await deadlines.expireNext('event-create-write-timeout');
    await firstSubmit;

    const afterGenerate = jest.fn(() => 'ce_new_batch');
    const afterAtomic = jest.fn(async events => events);
    const reconcileEventCreate = jest.fn(async () => ({ state: 'missing' }));
    const second = loadHarness(jest.fn(async () => ({ ok: true, users: [], missingUids: [] })), {
      tabId: 'multi-after',
      sharedStorage,
      sharedLocks,
      generateId: afterGenerate,
      createEventsAtomic: afterAtomic,
      reconcileEventCreate,
    });
    second.App._openCreateCustomEventModal();
    await second.App.handleCreateEvent();

    expect(reconcileEventCreate).toHaveBeenCalledTimes(2);
    expect(afterAtomic).toHaveBeenCalledTimes(1);
    expect(afterAtomic.mock.calls[0][0].map(event => ({
      id: event.id,
      clientRequestId: event.clientRequestId,
      batchGroupId: event.batchGroupId,
    }))).toEqual([
      { id: 'ce_multi_1', clientRequestId: 'ce_multi_1', batchGroupId: 'batch-frozen' },
      { id: 'ce_multi_2', clientRequestId: 'ce_multi_2', batchGroupId: 'batch-frozen' },
    ]);
    expect(afterGenerate).not.toHaveBeenCalled();
    expect(second.App._readPendingSingleEventMarker('owner-1')).toBeNull();
    first.dom.window.close();
    second.dom.window.close();
  });

  test('delegate verification timeout unlocks the modal without writing an event', async () => {
    const never = new Promise(() => {});
    const { App, createEvent, setForm, dom } = loadHarness(jest.fn(() => never));
    App._eventCreateDelegateTimeoutMs = 5;

    App._openCreateCustomEventModal();
    setForm('Delegate Timeout');
    App._delegates = [{ uid: 'delegate-same', name: 'Same Delegate' }];
    await App.handleCreateEvent();

    expect(createEvent).not.toHaveBeenCalled();
    expect(App._eventSubmitInFlight).toBe(false);
    expect(dom.window.document.getElementById('ce-submit-btn').disabled).toBe(false);
    expect(App.showToast).toHaveBeenCalledWith('委託人驗證逾時，請檢查網路後再試');
    dom.window.close();
  });

  test('creator identity fails closed when the profile uid differs from Firebase Auth', async () => {
    const { App, ApiService, createEvent, setForm, dom } = loadHarness(jest.fn(async () => ({ ok: true, users: [], missingUids: [] })));
    ApiService.getCurrentUser.mockReturnValue({ uid: 'stale-profile-uid', role: 'admin', name: 'Owner' });

    App._openCreateCustomEventModal();
    setForm('Identity Guard');
    await App.handleCreateEvent();

    expect(createEvent).not.toHaveBeenCalled();
    expect(App.showToast).toHaveBeenCalledWith('登入狀態不同步，請重新登入後再建立活動');
    expect(ApiService._writeErrorLog).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'validateCreatorIdentity', authMatchesProfile: false }),
      expect.objectContaining({ code: 'auth/uid-mismatch' }),
    );
    dom.window.close();
  });
});
