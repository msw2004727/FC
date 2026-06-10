/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '../..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(count = 8) {
  for (let i = 0; i < count; i++) await Promise.resolve();
}

function loadSignupModule({
  event = { id: 'evt-1', _docId: 'evt-doc-1', status: 'open', max: 10, current: 0 },
  currentUser = { uid: 'user-1' },
  registrations = [],
  fetchedServerEvents = [],
  registrationListenerKey = '',
  registrationsServerSnapshotReceived = false,
  fetchRegistrationsIfMissing = jest.fn(() => Promise.resolve()),
  ensureAuthReadyForWrite = jest.fn(() => Promise.resolve(true)),
  authCurrentUid = currentUser?.uid || null,
  lineSessionResolving = false,
  registrationDocsByField = { userId: [], uid: [] },
  registrationQueryImpl = null,
  currentRegistrationState = { signedUp: false },
} = {}) {
  const queryCalls = [];
  const makeSnap = docs => ({
    empty: docs.length === 0,
    docs: docs.map((data, index) => ({
      id: data.id || `reg-${index + 1}`,
      data: () => data,
    })),
  });
  const app = {
    currentPage: 'page-activity-detail',
    _currentDetailEventId: event.id,
    _flipAnimating: false,
    _getCurrentUserEventRegistrationState: jest.fn(() => currentRegistrationState),
  };
  const context = {
    App: app,
    ApiService: {
      _fetchedRegistrationServerIds: new Set(fetchedServerEvents),
      getCurrentUser: jest.fn(() => currentUser),
      getEvent: jest.fn(id => (id === event.id ? event : null)),
      getRegistrationsByEvent: jest.fn(id => (id === event.id ? registrations : [])),
      getMyRegistrationsByEvent: jest.fn(id => (id === event.id ? registrations : [])),
      fetchRegistrationsIfMissing,
    },
    FirebaseService: {
      ensureAuthReadyForWrite,
      _mapSubcollectionDoc: jest.fn((doc) => ({ ...doc.data(), _docId: doc.id, id: doc.id })),
      _upsertCanonicalCacheRecord: jest.fn(),
      _registrationListenerKey: registrationListenerKey,
      _registrationsServerSnapshotReceived: registrationsServerSnapshotReceived,
    },
    auth: authCurrentUid ? { currentUser: { uid: authCurrentUid } } : { currentUser: null },
    LineAuth: {
      isPendingLogin: jest.fn(() => lineSessionResolving),
      hasLiffSession: jest.fn(() => lineSessionResolving),
      getProfile: jest.fn(() => null),
      _profileError: null,
    },
    db: {
      collection: jest.fn(() => ({
        doc: jest.fn(() => ({
          collection: jest.fn(() => ({
            where: (field, op, value) => ({
              limit: limit => ({
                get: options => {
                  queryCalls.push({ field, op, value, limit, options });
                  if (registrationQueryImpl) return registrationQueryImpl({ field, op, value, limit, options });
                  return Promise.resolve(makeSnap(registrationDocsByField[field] || []));
                },
              }),
            }),
          })),
        })),
      })),
    },
    console,
    document,
    setTimeout,
    clearTimeout,
    escapeHTML: value => String(value ?? ''),
  };
  vm.runInNewContext(readProjectFile('js/modules/event/event-detail-signup.js'), context, {
    filename: 'js/modules/event/event-detail-signup.js',
  });
  return { app, context, event, fetchRegistrationsIfMissing, queryCalls };
}

describe('event detail signup registration loading gate', () => {
  afterEach(() => {
    jest.useRealTimers();
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  test('holds signup actions and de-dupes user-scoped registration hydrate while event/user state is not server-confirmed', async () => {
    const deferred = createDeferred();
    const fetchRegistrationsIfMissing = jest.fn(() => Promise.resolve());
    const { app, event, queryCalls } = loadSignupModule({
      fetchRegistrationsIfMissing,
      registrationQueryImpl: () => deferred.promise,
    });

    expect(app._ensureEventSignupRegistrationStateLoaded(event)).toBe(true);
    expect(app._ensureEventSignupRegistrationStateLoaded(event)).toBe(true);
    await flushMicrotasks(3);

    expect(fetchRegistrationsIfMissing).not.toHaveBeenCalled();
    expect(queryCalls).toHaveLength(1);
    expect(queryCalls[0]).toMatchObject({
      field: 'userId',
      value: 'user-1',
      limit: 5,
      options: { source: 'server' },
    });
  });

  test('does not hold or refetch when current cache already proves the user is registered', () => {
    const fetchRegistrationsIfMissing = jest.fn(() => Promise.resolve());
    const { app, event } = loadSignupModule({
      fetchRegistrationsIfMissing,
      currentRegistrationState: { signedUp: true, status: 'confirmed' },
    });

    expect(app._ensureEventSignupRegistrationStateLoaded(event)).toBe(false);
    expect(fetchRegistrationsIfMissing).not.toHaveBeenCalled();
  });

  test('does not hold when only stale cached currentUser exists without auth or LINE session', () => {
    const { app, event, queryCalls } = loadSignupModule({
      authCurrentUid: null,
      lineSessionResolving: false,
    });

    expect(app._ensureEventSignupRegistrationStateLoaded(event)).toBe(false);
    expect(queryCalls).toHaveLength(0);
  });

  test('uses a user-scoped server registrations snapshot as absence proof without fetching the whole event', () => {
    const fetchRegistrationsIfMissing = jest.fn(() => Promise.resolve());
    const { app, event } = loadSignupModule({
      fetchRegistrationsIfMissing,
      registrationListenerKey: 'user:user-1',
      registrationsServerSnapshotReceived: true,
    });

    expect(app._ensureEventSignupRegistrationStateLoaded(event)).toBe(false);
    expect(fetchRegistrationsIfMissing).not.toHaveBeenCalled();
  });

  test('keeps refreshSignupButton on loading and does not compute a signup CTA before registration proof', () => {
    const deferred = createDeferred();
    const { app } = loadSignupModule({
      registrationQueryImpl: () => deferred.promise,
    });
    app._buildEventSignupLoadingButton = jest.fn(() => '<button data-state="loading" disabled>loading</button>');
    app._isUserSignedUp = jest.fn(() => false);

    document.body.innerHTML = '<div class="detail-action-primary"></div>';
    app._refreshSignupButton('evt-1');

    expect(document.querySelector('.detail-action-primary button')?.dataset.state).toBe('loading');
    expect(app._isUserSignedUp).not.toHaveBeenCalled();
  });

  test('turns unresolved hydrate into a retryable issue instead of staying pending forever', async () => {
    jest.useFakeTimers();
    const deferred = createDeferred();
    const { app, event } = loadSignupModule({
      registrationQueryImpl: () => deferred.promise,
    });
    app._eventSignupRegistrationHydrateTimeoutMs = 3000;
    app._refreshSignupButton = jest.fn();

    expect(app._ensureEventSignupRegistrationStateLoaded(event)).toBe(true);

    await jest.advanceTimersByTimeAsync(3100);

    expect(app._ensureEventSignupRegistrationStateLoaded(event)).toBe(false);
    expect(app._isEventSignupRegistrationHydrateIssue(event)).toBe(true);
    expect(app._eventSignupRegistrationHydrateState).toMatchObject({
      pending: false,
      issue: 'timeout',
    });
    expect(app._refreshSignupButton).toHaveBeenCalledWith(event.id);
  });

  test('late user-scoped proof refreshes a timed-out retry issue', async () => {
    jest.useFakeTimers();
    const deferred = createDeferred();
    const emptySnap = { empty: true, docs: [] };
    const { app, event } = loadSignupModule({
      registrationQueryImpl: ({ field }) => (field === 'userId'
        ? deferred.promise
        : Promise.resolve(emptySnap)),
    });
    app._eventSignupRegistrationHydrateTimeoutMs = 3000;
    app._refreshSignupButton = jest.fn();

    expect(app._ensureEventSignupRegistrationStateLoaded(event)).toBe(true);

    await jest.advanceTimersByTimeAsync(3100);
    expect(app._isEventSignupRegistrationHydrateIssue(event)).toBe(true);

    app._refreshSignupButton.mockClear();
    deferred.resolve(emptySnap);
    await flushMicrotasks();

    expect(app._hasCurrentEventSignupRegistrationServerProof(event)).toBe(true);
    expect(app._isEventSignupRegistrationHydrateIssue(event)).toBe(false);
    expect(app._refreshSignupButton).toHaveBeenCalledWith(event.id);
  });

  test('releases hydrate when server proves the current user has no registration', async () => {
    const { app, event } = loadSignupModule({
      registrationDocsByField: { userId: [], uid: [] },
    });

    expect(app._ensureEventSignupRegistrationStateLoaded(event)).toBe(true);
    await flushMicrotasks();

    expect(app._ensureEventSignupRegistrationStateLoaded(event)).toBe(false);
    expect(app._isEventSignupRegistrationHydrateIssue(event)).toBe(false);
    expect(app._eventSignupRegistrationHydrateState).toBe(null);
  });

  test('auth-not-ready keeps signup state retryable without showing sync issue', async () => {
    jest.useFakeTimers();
    const { app, event } = loadSignupModule({
      ensureAuthReadyForWrite: jest.fn(() => Promise.resolve(false)),
      authCurrentUid: null,
      lineSessionResolving: true,
    });
    app._refreshSignupButton = jest.fn();

    expect(app._ensureEventSignupRegistrationStateLoaded(event)).toBe(true);
    await flushMicrotasks();

    expect(app._eventSignupRegistrationHydrateState).toBe(null);
    expect(app._isEventSignupRegistrationHydrateIssue(event)).toBe(false);

    jest.advanceTimersByTime(900);
    expect(app._refreshSignupButton).toHaveBeenCalledWith(event.id);
    jest.useRealTimers();
  });

  test('permission-denied during proof read delays retry instead of showing sync issue', async () => {
    jest.useFakeTimers();
    const denied = new Error('permission denied');
    denied.code = 'permission-denied';
    const { app, event } = loadSignupModule({
      registrationQueryImpl: () => Promise.reject(denied),
      authCurrentUid: 'user-1',
      lineSessionResolving: false,
    });
    app._refreshSignupButton = jest.fn();

    expect(app._ensureEventSignupRegistrationStateLoaded(event)).toBe(true);
    await flushMicrotasks();

    expect(app._eventSignupRegistrationHydrateState).toBe(null);
    expect(app._isEventSignupRegistrationHydrateIssue(event)).toBe(false);
    expect(app._refreshSignupButton).not.toHaveBeenCalled();

    jest.advanceTimersByTime(900);
    expect(app._refreshSignupButton).toHaveBeenCalledWith(event.id);
    jest.useRealTimers();
  });

  test('repeated auth proof failures temporarily release the signup gate', () => {
    jest.useFakeTimers();
    const { app, event } = loadSignupModule({
      authCurrentUid: 'user-1',
      lineSessionResolving: false,
    });
    app._eventSignupRegistrationAuthRetryLimit = 2;

    app._recoverEventSignupRegistrationAuthNotReady(event.id, { eventId: event.id, uid: 'user-1' });
    expect(app._isEventSignupRegistrationAuthBypassed(event.id, 'user-1')).toBe(false);

    app._recoverEventSignupRegistrationAuthNotReady(event.id, { eventId: event.id, uid: 'user-1' });
    expect(app._isEventSignupRegistrationAuthBypassed(event.id, 'user-1')).toBe(true);
    expect(app._shouldHoldSignupActionsForEventRegistrations(event)).toBe(false);

    jest.useRealTimers();
  });
});
