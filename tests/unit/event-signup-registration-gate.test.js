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
  lineHasSession = lineSessionResolving,
  lineReady = !lineSessionResolving,
  lineProfile = null,
  lineProfileLoading = lineSessionResolving,
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
      hasLiffSession: jest.fn(() => lineHasSession),
      getProfile: jest.fn(() => lineProfile),
      _profileError: null,
      _profileLoading: lineProfileLoading,
      _ready: lineReady,
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

  test('renders user profile syncing CTA with a spinner while signup identity is loading', () => {
    const { app } = loadSignupModule();
    const container = document.createElement('div');

    container.innerHTML = app._buildEventSignupLoadingButton();
    const button = container.querySelector('button');

    expect(button).not.toBeNull();
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.textContent).toContain('用戶資料同步中');
    expect(button.querySelector('.mini-spinner')).not.toBeNull();
  });

  test('starts a background user-scoped registration proof without holding when auth is ready', async () => {
    const deferred = createDeferred();
    const fetchRegistrationsIfMissing = jest.fn(() => Promise.resolve());
    const { app, event, queryCalls } = loadSignupModule({
      fetchRegistrationsIfMissing,
      registrationQueryImpl: () => deferred.promise,
    });

    expect(app._ensureEventSignupRegistrationStateLoaded(event)).toBe(false);
    expect(app._ensureEventSignupRegistrationStateLoaded(event)).toBe(false);
    await flushMicrotasks(3);

    expect(fetchRegistrationsIfMissing).not.toHaveBeenCalled();
    expect(queryCalls).toHaveLength(1);
    expect(app._eventSignupRegistrationHydrateState).toBeFalsy();
    expect(app._eventSignupRegistrationBackgroundProofState).toMatchObject({
      eventId: event.id,
      uid: 'user-1',
      pending: true,
    });
    expect(queryCalls[0]).toMatchObject({
      field: 'userId',
      value: 'user-1',
      limit: 5,
    });
    // 2026-06-10：主查詢改預設 get()（伺服器優先、SDK 離線時回快取），不再強制 source:'server'
    expect(queryCalls[0].options).toBeUndefined();
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

  test('does not keep deep-link signup gate held after LIFF profile is ready but Firebase auth is absent', () => {
    const { app, event, queryCalls } = loadSignupModule({
      authCurrentUid: null,
      lineSessionResolving: false,
      lineHasSession: true,
      lineReady: true,
      lineProfile: { userId: 'user-1', displayName: 'User One' },
      lineProfileLoading: false,
    });

    expect(app._isEventSignupAuthStillResolving()).toBe(false);
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

  test('renders an optimistic signup CTA while registration proof runs in the background', async () => {
    const deferred = createDeferred();
    const { app, queryCalls } = loadSignupModule({
      registrationQueryImpl: () => deferred.promise,
    });
    app._buildEventSignupLoadingButton = jest.fn(() => '<button data-state="loading" disabled>loading</button>');
    app._isUserSignedUp = jest.fn(() => false);

    document.body.innerHTML = '<div class="detail-action-primary"></div>';
    app._refreshSignupButton('evt-1');
    await flushMicrotasks(3);

    expect(document.querySelector('.detail-action-primary button')?.dataset.state).toBeUndefined();
    expect(document.querySelector('.detail-action-primary button')?.textContent).toContain('立即報名');
    expect(app._isUserSignedUp).toHaveBeenCalled();
    expect(queryCalls).toHaveLength(1);
  });

  test('turns unresolved hydrate into a retryable issue instead of staying pending forever', async () => {
    jest.useFakeTimers();
    const deferred = createDeferred();
    const { app, event } = loadSignupModule({
      registrationQueryImpl: () => deferred.promise,
      authCurrentUid: null,
      lineSessionResolving: true,
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
      authCurrentUid: null,
      lineSessionResolving: true,
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
      authCurrentUid: null,
      lineSessionResolving: true,
    });

    expect(app._ensureEventSignupRegistrationStateLoaded(event)).toBe(true);
    await flushMicrotasks(20);

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
    await flushMicrotasks(20);

    expect(app._eventSignupRegistrationHydrateState).toBe(null);
    expect(app._isEventSignupRegistrationHydrateIssue(event)).toBe(false);

    jest.advanceTimersByTime(900);
    expect(app._refreshSignupButton).toHaveBeenCalledWith(event.id);
    jest.useRealTimers();
  });

  test('repeated auth-not-ready while LIFF is still resolving temporarily releases the signup gate', async () => {
    jest.useFakeTimers();
    const { app, event } = loadSignupModule({
      ensureAuthReadyForWrite: jest.fn(() => Promise.resolve(false)),
      authCurrentUid: null,
      lineSessionResolving: true,
    });
    app._eventSignupRegistrationAuthRetryLimit = 2;
    app._refreshSignupButton = jest.fn();

    expect(app._ensureEventSignupRegistrationStateLoaded(event)).toBe(true);
    await flushMicrotasks(20);
    expect(app._isEventSignupRegistrationAuthBypassed(event.id, 'user-1')).toBe(false);
    expect(app._shouldHoldSignupActionsForEventRegistrations(event)).toBe(true);

    jest.advanceTimersByTime(900);
    expect(app._ensureEventSignupRegistrationStateLoaded(event)).toBe(true);
    await flushMicrotasks(20);

    expect(app._isEventSignupRegistrationAuthBypassed(event.id, 'user-1')).toBe(true);
    expect(app._shouldHoldSignupActionsForEventRegistrations(event)).toBe(false);
    jest.useRealTimers();
  });

  test('auth proof timeout recovers as auth-not-ready instead of surfacing a sync issue', async () => {
    jest.useFakeTimers();
    const { app, event } = loadSignupModule({
      ensureAuthReadyForWrite: jest.fn(() => new Promise(() => {})),
      authCurrentUid: null,
      lineSessionResolving: true,
      lineHasSession: true,
      lineReady: false,
      lineProfileLoading: true,
    });
    app._eventSignupRegistrationHydrateTimeoutMs = 4000;
    app._refreshSignupButton = jest.fn();

    expect(app._ensureEventSignupRegistrationStateLoaded(event)).toBe(true);
    await jest.advanceTimersByTimeAsync(3300);
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
      authCurrentUid: null,
      lineSessionResolving: true,
    });
    app._refreshSignupButton = jest.fn();

    expect(app._ensureEventSignupRegistrationStateLoaded(event)).toBe(true);
    await flushMicrotasks(20);

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

  // ═══ 2026-06-10：快取兜底 + issue 退避自動重查（防止「重新檢查報名狀態」永久卡死）═══

  test('server read failure falls back to local cache and releases the gate', async () => {
    const unavailable = new Error('stream broken');
    unavailable.code = 'unavailable';
    const { app, event } = loadSignupModule({
      registrationQueryImpl: ({ options }) => (options?.source === 'cache'
        ? Promise.resolve({ empty: true, docs: [] })
        : Promise.reject(unavailable)),
    });

    expect(app._ensureEventSignupRegistrationStateLoaded(event)).toBe(false);
    await flushMicrotasks(20);

    expect(app._eventSignupRegistrationBackgroundProofState).toBe(null);
    expect(app._eventSignupRegistrationHydrateState).toBeFalsy();
    expect(app._isEventSignupRegistrationHydrateIssue(event)).toBe(false);
    expect(app._hasCurrentEventSignupRegistrationServerProof(event)).toBe(true);
  });

  test('cache fallback still surfaces an active registration when server reads fail', async () => {
    const unavailable = new Error('stream broken');
    unavailable.code = 'unavailable';
    const regDoc = { eventId: 'evt-1', userId: 'user-1', status: 'confirmed', participantType: 'self' };
    const { app, context, event } = loadSignupModule({
      registrationQueryImpl: ({ field, options }) => {
        if (options?.source !== 'cache') return Promise.reject(unavailable);
        return Promise.resolve({
          empty: field !== 'userId',
          docs: field === 'userId' ? [{ id: 'reg-1', data: () => regDoc }] : [],
        });
      },
    });

    expect(app._ensureEventSignupRegistrationStateLoaded(event)).toBe(false);
    await flushMicrotasks(20);

    expect(context.FirebaseService._upsertCanonicalCacheRecord).toHaveBeenCalledWith(
      'registrations',
      expect.objectContaining({ eventId: 'evt-1', userId: 'user-1', status: 'confirmed' })
    );
    expect(app._eventSignupRegistrationBackgroundProofState).toBe(null);
    expect(app._eventSignupRegistrationHydrateState).toBeFalsy();
    expect(app._isEventSignupRegistrationHydrateIssue(event)).toBe(false);
  });

  test('sync issue auto-retries after the backoff window instead of pinning forever', async () => {
    const failing = new Error('boom');
    failing.code = 'internal';
    let mode = 'fail-all';
    const { app, event } = loadSignupModule({
      registrationQueryImpl: () => (mode === 'fail-all'
        ? Promise.reject(failing)
        : Promise.resolve({ empty: true, docs: [] })),
      authCurrentUid: null,
      lineSessionResolving: true,
    });

    expect(app._ensureEventSignupRegistrationStateLoaded(event)).toBe(true);
    await flushMicrotasks(20);

    // 伺服器 + 快取兜底都失敗 → issue；退避期內維持 issue、不自動重查
    expect(app._eventSignupRegistrationHydrateState).toMatchObject({ pending: false, issue: 'error' });
    expect(app._ensureEventSignupRegistrationStateLoaded(event)).toBe(false);
    expect(app._isEventSignupRegistrationHydrateIssue(event)).toBe(true);

    // 退避期滿 → 放行自動重查；環境恢復後 gate 解鎖
    mode = 'recover';
    app._eventSignupRegistrationHydrateState.issueAt = Date.now() - 999999;
    expect(app._ensureEventSignupRegistrationStateLoaded(event)).toBe(true);
    await flushMicrotasks(20);

    expect(app._eventSignupRegistrationHydrateState).toBe(null);
    expect(app._isEventSignupRegistrationHydrateIssue(event)).toBe(false);
  });

  test('marks issue with a scheduled nudge that refreshes the signup button after backoff', async () => {
    jest.useFakeTimers();
    const failing = new Error('boom');
    failing.code = 'internal';
    const { app, event } = loadSignupModule({
      registrationQueryImpl: () => Promise.reject(failing),
      authCurrentUid: null,
      lineSessionResolving: true,
    });
    app._refreshSignupButton = jest.fn();

    expect(app._ensureEventSignupRegistrationStateLoaded(event)).toBe(true);
    await flushMicrotasks(20);
    expect(app._eventSignupRegistrationHydrateState).toMatchObject({ pending: false, issue: 'error' });

    app._refreshSignupButton.mockClear();
    await jest.advanceTimersByTimeAsync(10000);

    expect(app._refreshSignupButton).toHaveBeenCalledWith(event.id);
    jest.useRealTimers();
  });

  test('age signup state blocks users below the event minimum age using the event date', () => {
    const { app, event } = loadSignupModule({
      event: {
        id: 'evt-1',
        _docId: 'evt-doc-1',
        status: 'open',
        max: 10,
        current: 0,
        date: '2026/06/12 20:00~22:00',
        minAge: 13,
      },
    });
    app._getEventSignupReferenceDate = jest.fn(() => app._parseEventSignupBirthday('2026/06/12'));

    expect(app._getEventAgeSignupState(event, { uid: 'user-1', birthday: '2015/06/13' }))
      .toMatchObject({ restricted: true, canSignup: false, reason: 'underage', minAge: 13, age: 10 });
    expect(app._getEventAgeSignupState(event, { uid: 'user-1', birthday: '2013/06/12' }))
      .toMatchObject({ restricted: false, canSignup: true, minAge: 13, age: 13 });
  });

  test('age signup state waits for minimal LINE-primed users before showing an age verdict', () => {
    const { app, event } = loadSignupModule({
      event: {
        id: 'evt-1',
        _docId: 'evt-doc-1',
        status: 'open',
        max: 10,
        current: 0,
        date: '2026/06/12 20:00~22:00',
        minAge: 13,
      },
      currentUser: { uid: 'user-1', displayName: 'User One' },
    });

    const state = app._getEventAgeSignupState(event, { uid: 'user-1', displayName: 'User One' });

    expect(state).toMatchObject({
      restricted: true,
      canSignup: false,
      requiresLogin: false,
      reason: 'profile-syncing',
      minAge: 13,
      age: null,
      syncing: true,
    });
    expect(app._isEventAgeSignupStateSyncing(state)).toBe(true);
    expect(app._getEventAgeRestrictionMessage(event, state)).toBe('用戶資料同步中，請稍候再試');
  });

  test('age signup state still evaluates known birthdays while auth is resolving', () => {
    const currentUser = { uid: 'user-1', displayName: 'User One', birthday: '2013/06/12' };
    const { app, event } = loadSignupModule({
      event: {
        id: 'evt-1',
        _docId: 'evt-doc-1',
        status: 'open',
        max: 10,
        current: 0,
        date: '2026/06/12 20:00~22:00',
        minAge: 13,
      },
      currentUser,
      authCurrentUid: null,
      lineSessionResolving: true,
    });
    app._getEventSignupReferenceDate = jest.fn(() => app._parseEventSignupBirthday('2026/06/12'));

    expect(app._getEventAgeSignupState(event, currentUser))
      .toMatchObject({ restricted: false, canSignup: true, reason: '', minAge: 13, age: 13 });
  });

  test('age restriction button text does not show the threshold before birthday is known', () => {
    const { app, event } = loadSignupModule({
      event: {
        id: 'evt-1',
        _docId: 'evt-doc-1',
        status: 'open',
        max: 10,
        current: 0,
        date: '2026/06/12 20:00~22:00',
        minAge: 13,
      },
    });

    const missingBirthdayState = app._getEventAgeSignupState(event, { uid: 'user-1' });

    expect(missingBirthdayState).toMatchObject({ reason: 'birthday-missing', age: null });
    expect(app._getEventAgeRestrictionButtonText(event, missingBirthdayState)).toBe('補齊生日');
    expect(app._getEventAgeRestrictionButtonText(event, { reason: 'underage' })).toBe('13歲以上');

    app._pendingFirstLogin = true;
    const pendingFirstLoginState = app._getEventAgeSignupState(event, { uid: 'user-1', displayName: 'User One' });
    expect(pendingFirstLoginState).toMatchObject({ reason: 'birthday-missing', age: null });
  });

  test('refresh signup button renders profile syncing instead of an age threshold for minimal users', () => {
    const { app } = loadSignupModule({
      event: {
        id: 'evt-1',
        _docId: 'evt-doc-1',
        status: 'open',
        max: 10,
        current: 0,
        date: '2026/06/12 20:00~22:00',
        minAge: 13,
      },
      currentUser: { uid: 'user-1', displayName: 'User One' },
      currentRegistrationState: { signedUp: false },
    });
    app._isUserSignedUp = jest.fn(() => false);
    document.body.innerHTML = '<div class="detail-action-primary"></div>';

    app._refreshSignupButton('evt-1');

    const button = document.querySelector('.detail-action-primary button');
    expect(button?.textContent).toContain('用戶資料同步中');
    expect(button?.textContent).not.toContain('13歲以上');
    expect(button?.querySelector('.mini-spinner')).not.toBeNull();
  });

  test('callable auth guard blocks writes and schedules a retry when Firebase auth is not ready', async () => {
    jest.useFakeTimers();
    const ensureAuthReadyForWrite = jest.fn(() => Promise.resolve(false));
    const { app } = loadSignupModule({ ensureAuthReadyForWrite });
    app.showToast = jest.fn();
    app.ensureCloudReady = jest.fn(() => Promise.resolve(true));
    app._refreshSignupButton = jest.fn();

    const result = await app._ensureEventSignupCallableAuthReady('evt-1', 'user-1');
    await flushMicrotasks();

    expect(result).toBe(false);
    expect(ensureAuthReadyForWrite).toHaveBeenCalledWith('user-1');
    expect(app.showToast).toHaveBeenCalledWith('登入狀態同步中，請稍後再試');
    expect(app.ensureCloudReady).toHaveBeenCalledWith({ reason: 'signup-auth' });

    jest.advanceTimersByTime(900);
    expect(app._refreshSignupButton).toHaveBeenCalledWith('evt-1');
    jest.useRealTimers();
  });

  test('callable auth guard treats synchronous auth readiness errors as not ready', async () => {
    jest.useFakeTimers();
    const ensureAuthReadyForWrite = jest.fn(() => { throw new Error('sync auth failure'); });
    const { app } = loadSignupModule({ ensureAuthReadyForWrite });
    app.showToast = jest.fn();
    app.ensureCloudReady = jest.fn(() => Promise.resolve(true));
    app._refreshSignupButton = jest.fn();

    await expect(app._ensureEventSignupCallableAuthReady('evt-1', 'user-1')).resolves.toBe(false);
    expect(app.showToast).toHaveBeenCalledWith('登入狀態同步中，請稍後再試');
    expect(app.ensureCloudReady).toHaveBeenCalledWith({ reason: 'signup-auth' });

    jest.advanceTimersByTime(900);
    expect(app._refreshSignupButton).toHaveBeenCalledWith('evt-1');
    jest.useRealTimers();
  });
});
