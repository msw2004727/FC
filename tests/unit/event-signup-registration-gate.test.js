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

function loadSignupModule({
  event = { id: 'evt-1', _docId: 'evt-doc-1', status: 'open', max: 10, current: 0 },
  currentUser = { uid: 'user-1' },
  registrations = [],
  fetchedServerEvents = [],
  registrationListenerKey = '',
  registrationsServerSnapshotReceived = false,
  fetchRegistrationsIfMissing = jest.fn(() => Promise.resolve()),
  currentRegistrationState = { signedUp: false },
} = {}) {
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
      _registrationListenerKey: registrationListenerKey,
      _registrationsServerSnapshotReceived: registrationsServerSnapshotReceived,
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
  return { app, context, event, fetchRegistrationsIfMissing };
}

describe('event detail signup registration loading gate', () => {
  afterEach(() => {
    jest.useRealTimers();
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  test('holds signup actions and de-dupes event registration hydrate while event/user state is not server-confirmed', () => {
    const deferred = createDeferred();
    const fetchRegistrationsIfMissing = jest.fn(() => deferred.promise);
    const { app, event } = loadSignupModule({ fetchRegistrationsIfMissing });

    expect(app._ensureEventSignupRegistrationStateLoaded(event)).toBe(true);
    expect(app._ensureEventSignupRegistrationStateLoaded(event)).toBe(true);
    expect(fetchRegistrationsIfMissing).toHaveBeenCalledTimes(1);
    expect(fetchRegistrationsIfMissing).toHaveBeenCalledWith('evt-1');
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
      fetchRegistrationsIfMissing: jest.fn(() => deferred.promise),
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
      fetchRegistrationsIfMissing: jest.fn(() => deferred.promise),
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

  test('marks hydrate as retryable when fetch resolves but registration absence is still unverified', async () => {
    const { app, event } = loadSignupModule({
      fetchRegistrationsIfMissing: jest.fn(() => Promise.resolve()),
    });

    expect(app._ensureEventSignupRegistrationStateLoaded(event)).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(app._ensureEventSignupRegistrationStateLoaded(event)).toBe(false);
    expect(app._isEventSignupRegistrationHydrateIssue(event)).toBe(true);
    expect(app._eventSignupRegistrationHydrateState).toMatchObject({
      pending: false,
      issue: 'unverified',
    });
  });
});
