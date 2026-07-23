const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadServices() {
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Promise,
    Date,
    Math,
    localStorage: {
      getItem: jest.fn(),
      setItem: jest.fn(),
      removeItem: jest.fn(),
      key: jest.fn(),
      get length() { return 0; },
    },
  };
  vm.createContext(sandbox);
  const firebaseSource = fs.readFileSync(path.join(__dirname, '../../js/firebase-service.js'), 'utf8');
  vm.runInContext(`${firebaseSource}\nglobalThis.FirebaseService = FirebaseService;`, sandbox, {
    filename: 'js/firebase-service.js',
  });
  const apiSource = fs.readFileSync(path.join(__dirname, '../../js/api-service.js'), 'utf8');
  vm.runInContext(`${apiSource}\nglobalThis.ApiService = ApiService;`, sandbox, {
    filename: 'js/api-service.js',
  });
  return sandbox;
}

function mockSubcollectionDoc(data, docId = 'reg_sub', eventDocId = 'eventDocA', collectionName = 'registrations') {
  return {
    id: docId,
    data: () => ({ ...data }),
    ref: {
      path: `events/${eventDocId}/${collectionName}/${docId}`,
      parent: {
        path: `events/${eventDocId}/${collectionName}`,
        parent: { path: `events/${eventDocId}` },
      },
    },
  };
}

describe('canonical registration/activity/attendance cache', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('maps subcollection docs with source metadata and uid aliases', () => {
    const { FirebaseService } = loadServices();
    const doc = mockSubcollectionDoc({ eventId: 'e1', userId: 'u1', status: 'confirmed' });

    const mapped = FirebaseService._mapSubcollectionDoc(doc, 'registrations');

    expect(mapped).toMatchObject({
      eventId: 'e1',
      userId: 'u1',
      uid: 'u1',
      _docId: 'reg_sub',
      _path: 'events/eventDocA/registrations/reg_sub',
      _parentPath: 'events/eventDocA',
      _sourceCollection: 'registrations',
      _sourceKind: 'subcollection',
    });
  });

  test('official ApiService registration reads ignore root leftovers and dedupe to subcollection docs', () => {
    const { FirebaseService, ApiService } = loadServices();
    FirebaseService._cache.registrations = [
      {
        eventId: 'e1',
        userId: 'u1',
        status: 'confirmed',
        _docId: 'root_old',
        _path: 'registrations/root_old',
      },
      {
        eventId: 'e1',
        userId: 'u1',
        status: 'confirmed',
        _docId: 'reg_sub',
        _path: 'events/eventDocA/registrations/reg_sub',
        _sourceKind: 'subcollection',
        _sourceCollection: 'registrations',
      },
      {
        eventId: 'e1',
        userId: 'u1',
        status: 'cancelled',
        _docId: 'reg_cancelled',
        _path: 'events/eventDocA/registrations/reg_cancelled',
        _sourceKind: 'subcollection',
        _sourceCollection: 'registrations',
      },
    ];

    expect(ApiService.getRegistrationsByEvent('e1').map(r => r._docId)).toEqual(['reg_sub']);
    expect(ApiService.getRegistrations({
      eventId: 'e1',
      userId: 'u1',
      includeTerminal: true,
    }).map(r => r._docId)).toEqual(['reg_sub', 'reg_cancelled']);
  });

  test('fetchRegistrationsIfMissing does not treat root leftovers as a valid cache hit', async () => {
    const sandbox = loadServices();
    const { FirebaseService, ApiService } = sandbox;
    FirebaseService._cache.events = [{ id: 'e1', _docId: 'eventDocA' }];
    FirebaseService._cache.registrations = [{
      eventId: 'e1',
      userId: 'u1',
      status: 'confirmed',
      _docId: 'root_old',
      _path: 'registrations/root_old',
    }];

    const get = jest.fn().mockResolvedValue({
      docs: [mockSubcollectionDoc({ eventId: 'e1', userId: 'u1', status: 'confirmed' }, 'reg_sub')],
    });
    const collection = jest.fn(() => ({ get }));
    const doc = jest.fn(() => ({ collection }));
    sandbox.db = { collection: jest.fn(() => ({ doc })) };

    await ApiService.fetchRegistrationsIfMissing('e1');

    expect(get).toHaveBeenCalledTimes(1);
    expect(ApiService.getRegistrationsByEvent('e1').map(r => r._docId)).toEqual(['reg_sub']);
  });

  test('fetchRegistrationsIfMissing validates complete-looking cache against server once', async () => {
    const sandbox = loadServices();
    const { FirebaseService, ApiService } = sandbox;
    FirebaseService._cache.events = [{ id: 'e2', _docId: 'eventDocB', current: 1, waitlist: 0 }];
    FirebaseService._cache.registrations = [{
      eventId: 'e2',
      userId: 'u1',
      status: 'confirmed',
      _docId: 'reg_cached',
      _path: 'events/eventDocB/registrations/reg_cached',
      _sourceKind: 'subcollection',
    }];
    FirebaseService._registrationsServerSnapshotReceived = false;

    const get = jest.fn().mockResolvedValue({
      docs: [mockSubcollectionDoc({ eventId: 'e2', userId: 'u1', status: 'confirmed' }, 'reg_server', 'eventDocB')],
    });
    const collection = jest.fn(() => ({ get }));
    const doc = jest.fn(() => ({ collection }));
    sandbox.db = { collection: jest.fn(() => ({ doc })) };

    await ApiService.fetchRegistrationsIfMissing('e2');

    expect(get).toHaveBeenCalledTimes(1);
    expect(ApiService._fetchedRegistrationServerIds.has('e2')).toBe(true);
    expect(ApiService.getRegistrationsByEvent('e2').map(r => r._docId)).toEqual(['reg_server']);
    expect(ApiService.getActivityDetailFreshnessState('e2').roster).toMatchObject({
      status: 'server-fresh',
      source: 'server',
      recordCount: 1,
    });
  });

  test('fetchRegistrationsIfMissing does not trust the limited all-registration listener as per-event proof', async () => {
    const sandbox = loadServices();
    const { FirebaseService, ApiService } = sandbox;
    FirebaseService._cache.events = [{ id: 'e-admin', _docId: 'eventDocAdmin', current: 1, waitlist: 0 }];
    FirebaseService._cache.registrations = [{
      eventId: 'e-admin',
      userId: 'u1',
      status: 'confirmed',
      _docId: 'reg_cached',
      _path: 'events/eventDocAdmin/registrations/reg_cached',
      _sourceKind: 'subcollection',
    }];
    FirebaseService._registrationsServerSnapshotReceived = true;
    FirebaseService._registrationListenerKey = 'all';

    const get = jest.fn().mockResolvedValue({
      metadata: { fromCache: false },
      docs: [mockSubcollectionDoc({ eventId: 'e-admin', userId: 'u1', status: 'confirmed' }, 'reg_server', 'eventDocAdmin')],
    });
    const collection = jest.fn(() => ({ get }));
    const doc = jest.fn(() => ({ collection }));
    sandbox.db = { collection: jest.fn(() => ({ doc })) };

    await ApiService.fetchRegistrationsIfMissing('e-admin');

    expect(get).toHaveBeenCalledTimes(1);
    expect(ApiService._fetchedRegistrationServerIds.has('e-admin')).toBe(true);
  });

  test('fetchRegistrationsIfMissing does not mark cache snapshots as server-fetched', async () => {
    const sandbox = loadServices();
    const { FirebaseService, ApiService } = sandbox;
    FirebaseService._cache.events = [{ id: 'e-cache', _docId: 'eventDocCache', current: 1, waitlist: 0 }];

    const get = jest.fn().mockResolvedValue({
      metadata: { fromCache: true },
      docs: [mockSubcollectionDoc({ eventId: 'e-cache', userId: 'u1', status: 'confirmed' }, 'reg_cache', 'eventDocCache')],
    });
    const collection = jest.fn(() => ({ get }));
    const doc = jest.fn(() => ({ collection }));
    sandbox.db = { collection: jest.fn(() => ({ doc })) };

    await ApiService.fetchRegistrationsIfMissing('e-cache');

    expect(ApiService._fetchedRegistrationIds.has('e-cache')).toBe(false);
    expect(ApiService._fetchedRegistrationServerIds.has('e-cache')).toBe(false);
    expect(ApiService.getActivityDetailFreshnessState('e-cache').roster).toMatchObject({
      status: 'preview',
      source: 'cache',
      fromCache: true,
    });
  });

  test('fetchRegistrationsIfMissing releases an in-flight registration fetch after timeout', async () => {
    jest.useFakeTimers();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const sandbox = loadServices();
    const { FirebaseService, ApiService } = sandbox;
    FirebaseService._cache.events = [{ id: 'e-timeout', _docId: 'eventDocTimeout', current: 1, waitlist: 0 }];

    const get = jest.fn(() => new Promise(() => {}));
    const collection = jest.fn(() => ({ get }));
    const doc = jest.fn(() => ({ collection }));
    sandbox.db = { collection: jest.fn(() => ({ doc })) };

    const promise = ApiService.fetchRegistrationsIfMissing('e-timeout', { timeoutMs: 50 });
    await jest.advanceTimersByTimeAsync(60);
    const result = await promise;

    expect(result).toMatchObject({ ok: false, reason: 'timeout' });
    expect(get).toHaveBeenCalledTimes(1);
    expect(ApiService._fetchingRegistrationPromises?.['e-timeout']).toBeUndefined();
    expect(ApiService._fetchedRegistrationIds.has('e-timeout')).toBe(false);
    expect(ApiService.getActivityDetailFreshnessState('e-timeout').roster).toMatchObject({
      status: 'stale-error',
      source: 'server',
      reason: 'timeout',
    });
  });

  test('activity detail mutation shadow state does not mark roster server-fresh', () => {
    const { ApiService } = loadServices();

    const seq = ApiService.markEventMutationPending('evt-mutation', {
      mutationType: 'signup',
      source: 'callable',
      requestId: 'req-1',
      affectedRegistrationIds: ['reg_1'],
    });
    ApiService.markEventMutationServerConfirmed('evt-mutation', seq, {
      requestId: 'req-1',
    });

    const state = ApiService.getActivityDetailFreshnessState('evt-mutation');
    expect(state.roster).toBeNull();
    expect(state.mutations).toHaveLength(1);
    expect(state.mutations[0]).toMatchObject({
      mutationType: 'signup',
      status: 'server-confirmed-own-mutation',
      requestId: 'req-1',
      affectedRegistrationIds: ['reg_1'],
    });
  });

  test('pending registration mutation protects optimistic status from equal-time stale snapshots', () => {
    const { FirebaseService, ApiService } = loadServices();
    const updatedAt = '2026-05-28T08:00:00.000Z';
    const optimistic = {
      eventId: 'evt-mutation',
      userId: 'u1',
      status: 'confirmed',
      updatedAt,
      registeredAt: updatedAt,
      _docId: 'reg_1',
      _path: 'events/eventDocMutation/registrations/reg_1',
      _sourceKind: 'subcollection',
    };
    const staleSnapshot = {
      ...optimistic,
      status: 'waitlisted',
    };
    FirebaseService._cache.registrations = [optimistic];
    ApiService.markEventMutationPending('evt-mutation', {
      mutationType: 'waitlist-promote',
      source: 'callable',
      affectedRegistrationIds: ['reg_1'],
      timeoutMs: 30000,
    });

    FirebaseService._replaceCanonicalCollectionCache('registrations', [staleSnapshot]);

    expect(FirebaseService._cache.registrations).toHaveLength(1);
    expect(FirebaseService._cache.registrations[0].status).toBe('confirmed');
  });

  test('server-confirmed companion signup mutation preserves newly added registration during stale snapshots', () => {
    const { FirebaseService, ApiService } = loadServices();
    const registeredAt = '2026-05-28T08:30:00.000Z';
    const optimisticCompanion = {
      eventId: 'evt-companion',
      userId: 'u1',
      participantType: 'companion',
      companionId: 'c1',
      companionName: 'Buddy',
      status: 'confirmed',
      registeredAt,
      _docId: 'reg_companion_1',
      id: 'reg_public_companion_1',
      _path: 'events/eventDocCompanion/registrations/reg_companion_1',
      _sourceKind: 'subcollection',
    };
    FirebaseService._cache.registrations = [optimisticCompanion];
    const seq = ApiService.markEventMutationPending('evt-companion', {
      mutationType: 'companion-toggle-register',
      source: 'callable',
      requestId: 'req-companion',
      timeoutMs: 30000,
    });
    ApiService.markEventMutationServerConfirmed('evt-companion', seq, {
      mutationType: 'companion-toggle-register',
      requestId: 'req-companion',
      affectedRegistrationIds: ['reg_companion_1', 'reg_public_companion_1'],
      confirmedAt: Date.now(),
    });

    FirebaseService._replaceCanonicalCollectionCache('registrations', []);

    expect(FirebaseService._cache.registrations).toHaveLength(1);
    expect(FirebaseService._cache.registrations[0]).toMatchObject({
      _docId: 'reg_companion_1',
      companionId: 'c1',
      status: 'confirmed',
    });
  });

  test.each([
    'cancel-signup',
    'cancel-waitlist',
    'companion-cancel',
    'companion-toggle-cancel',
  ])('%s mutation keeps a just-cancelled registration over stale active upserts', (mutationType) => {
    const { FirebaseService, ApiService } = loadServices();
    const now = Date.now();
    const staleConfirmed = {
      eventId: 'evt-cancel-race',
      userId: 'u1',
      participantType: mutationType.includes('companion') ? 'companion' : 'self',
      companionId: mutationType.includes('companion') ? 'c1' : null,
      companionName: mutationType.includes('companion') ? 'Buddy' : null,
      status: 'confirmed',
      registeredAt: '2026-05-28T08:00:00.000Z',
      updatedAt: '2026-05-28T08:00:05.000Z',
      _docId: 'reg_cancel_race_1',
      id: 'reg_public_cancel_race_1',
      _path: 'events/eventDocCancelRace/registrations/reg_cancel_race_1',
      _sourceKind: 'subcollection',
    };
    const cancelled = {
      ...staleConfirmed,
      status: 'cancelled',
      updatedAt: '2026-05-28T08:00:00.000Z',
      cancelledAt: '2026-05-28T08:10:00.000Z',
    };
    FirebaseService._cache.registrations = [cancelled];
    const signupSeq = ApiService.markEventMutationPending('evt-cancel-race', {
      mutationType: 'signup',
      source: 'callable',
      requestId: 'signup-before-cancel',
      affectedRegistrationIds: ['reg_cancel_race_1', 'reg_public_cancel_race_1'],
      startedAt: now - 2000,
      timeoutMs: 30000,
    });
    ApiService.markEventMutationServerConfirmed('evt-cancel-race', signupSeq, {
      mutationType: 'signup',
      requestId: 'signup-before-cancel',
      affectedRegistrationIds: ['reg_cancel_race_1', 'reg_public_cancel_race_1'],
      confirmedAt: now - 1500,
    });
    const cancelSeq = ApiService.markEventMutationPending('evt-cancel-race', {
      mutationType,
      source: 'callable',
      requestId: 'cancel-after-signup',
      affectedRegistrationIds: ['reg_cancel_race_1', 'reg_public_cancel_race_1'],
      startedAt: now - 500,
      timeoutMs: 30000,
    });
    ApiService.markEventMutationServerConfirmed('evt-cancel-race', cancelSeq, {
      mutationType,
      requestId: 'cancel-after-signup',
      affectedRegistrationIds: ['reg_cancel_race_1', 'reg_public_cancel_race_1'],
      confirmedAt: now - 100,
    });

    FirebaseService._upsertCanonicalCacheRecord('registrations', staleConfirmed, {
      requireSubcollection: false,
    });

    expect(FirebaseService._cache.registrations).toHaveLength(1);
    expect(FirebaseService._cache.registrations[0]).toMatchObject({
      _docId: 'reg_cancel_race_1',
      status: 'cancelled',
    });
  });

  test('newer signup mutation can restore an active registration after a protected cancel', () => {
    const { FirebaseService, ApiService } = loadServices();
    const now = Date.now();
    const cancelled = {
      eventId: 'evt-resignup',
      userId: 'u1',
      participantType: 'self',
      status: 'cancelled',
      registeredAt: '2026-05-28T08:00:00.000Z',
      cancelledAt: '2026-05-28T08:10:00.000Z',
      _docId: 'reg_resignup_1',
      id: 'reg_public_resignup_1',
      _path: 'events/eventDocResignup/registrations/reg_resignup_1',
      _sourceKind: 'subcollection',
    };
    const confirmedAgain = {
      ...cancelled,
      status: 'confirmed',
      registeredAt: '2026-05-28T08:15:00.000Z',
      updatedAt: '2026-05-28T08:15:00.000Z',
      cancelledAt: null,
    };
    FirebaseService._cache.registrations = [cancelled];
    const cancelSeq = ApiService.markEventMutationPending('evt-resignup', {
      mutationType: 'cancel-signup',
      source: 'callable',
      requestId: 'cancel-before-resignup',
      affectedRegistrationIds: ['reg_resignup_1', 'reg_public_resignup_1'],
      startedAt: now - 2000,
      timeoutMs: 30000,
    });
    ApiService.markEventMutationServerConfirmed('evt-resignup', cancelSeq, {
      mutationType: 'cancel-signup',
      requestId: 'cancel-before-resignup',
      affectedRegistrationIds: ['reg_resignup_1', 'reg_public_resignup_1'],
      confirmedAt: now - 1500,
    });
    const signupSeq = ApiService.markEventMutationPending('evt-resignup', {
      mutationType: 'signup',
      source: 'callable',
      requestId: 'resignup-after-cancel',
      affectedRegistrationIds: ['reg_resignup_1', 'reg_public_resignup_1'],
      startedAt: now - 500,
      timeoutMs: 30000,
    });
    ApiService.markEventMutationServerConfirmed('evt-resignup', signupSeq, {
      mutationType: 'signup',
      requestId: 'resignup-after-cancel',
      affectedRegistrationIds: ['reg_resignup_1', 'reg_public_resignup_1'],
      confirmedAt: now - 100,
    });

    FirebaseService._upsertCanonicalCacheRecord('registrations', confirmedAgain, {
      requireSubcollection: false,
    });

    expect(FirebaseService._cache.registrations).toHaveLength(1);
    expect(FirebaseService._cache.registrations[0]).toMatchObject({
      _docId: 'reg_resignup_1',
      status: 'confirmed',
    });
  });

  test('limited registration snapshots preserve event-specific server-fetched rows', () => {
    const sandbox = loadServices();
    const { FirebaseService, ApiService } = sandbox;
    ApiService._fetchedRegistrationServerIds = new Set(['evt-detail']);
    FirebaseService._cache.registrations = [
      {
        eventId: 'evt-detail',
        userId: 'u1',
        status: 'confirmed',
        _docId: 'reg_1',
        _path: 'events/eventDocDetail/registrations/reg_1',
        _sourceKind: 'subcollection',
      },
      {
        eventId: 'evt-detail',
        userId: 'u2',
        status: 'confirmed',
        _docId: 'reg_2',
        _path: 'events/eventDocDetail/registrations/reg_2',
        _sourceKind: 'subcollection',
      },
    ];

    FirebaseService._replaceCanonicalCollectionCache('registrations', [
      {
        eventId: 'evt-detail',
        userId: 'u1',
        status: 'confirmed',
        _docId: 'reg_1',
        _path: 'events/eventDocDetail/registrations/reg_1',
        _sourceKind: 'subcollection',
      },
    ]);

    expect(ApiService.getRegistrationsByEvent('evt-detail').map(r => r._docId).sort()).toEqual(['reg_1', 'reg_2']);
  });

  test('cache-only event snapshots do not overwrite fresher detail-fetched counts', () => {
    const { FirebaseService } = loadServices();
    const fresh = {
      id: 'evt-fresh',
      _docId: 'eventDocFresh',
      current: 21,
      max: 21,
      status: 'full',
      _detailSnapshot: true,
      _detailSnapshotTs: Date.now(),
    };
    const staleCacheSnapshot = {
      id: 'evt-fresh',
      _docId: 'eventDocFresh',
      current: 20,
      max: 21,
      status: 'open',
    };

    FirebaseService._cache.events = [fresh];
    FirebaseService._eventSlices = {
      active: [staleCacheSnapshot],
      terminal: [],
      injected: [fresh],
    };
    FirebaseService._debouncedPersistCache = jest.fn();

    FirebaseService._mergeRealtimeEventSlices(false, { fromCache: true });

    expect(FirebaseService._cache.events).toHaveLength(1);
    expect(FirebaseService._cache.events[0].current).toBe(21);
    expect(FirebaseService._cache.events[0].status).toBe('full');
  });

  test('fresh detail count wins when an older cache snapshot arrives after it', () => {
    const { FirebaseService } = loadServices();
    const fetchedAt = Date.now();
    const freshDetail = {
      id: 'evt-race-after',
      _docId: 'eventDocRaceAfter',
      current: 21,
      max: 21,
      status: 'full',
      _detailSnapshot: true,
      _detailSnapshotTs: fetchedAt,
    };
    const staleLocalSnapshot = {
      id: 'evt-race-after',
      _docId: 'eventDocRaceAfter',
      current: 20,
      max: 21,
      status: 'open',
    };

    FirebaseService._cache.events = [freshDetail];
    FirebaseService._eventSlices = {
      active: [staleLocalSnapshot],
      terminal: [],
      injected: [freshDetail],
    };
    FirebaseService._debouncedPersistCache = jest.fn();
    FirebaseService._debouncedSnapshotRender = jest.fn();

    FirebaseService._mergeRealtimeEventSlices(true, { fromCache: true });

    expect(FirebaseService._cache.events[0]).toMatchObject({
      id: 'evt-race-after',
      current: 21,
      status: 'full',
    });
    expect(FirebaseService._debouncedSnapshotRender).toHaveBeenCalledWith('events');
  });

  test('fresh detail count wins when stale cache is rendered first and detail is injected later', () => {
    const { FirebaseService } = loadServices();
    const staleLocalSnapshot = {
      id: 'evt-race-before',
      _docId: 'eventDocRaceBefore',
      current: 20,
      max: 21,
      status: 'open',
    };
    const freshDetail = {
      id: 'evt-race-before',
      _docId: 'eventDocRaceBefore',
      current: 21,
      max: 21,
      status: 'full',
      _detailSnapshot: true,
      _detailSnapshotTs: Date.now(),
    };

    FirebaseService._cache.events = [];
    FirebaseService._eventSlices = {
      active: [staleLocalSnapshot],
      terminal: [],
      injected: [],
    };
    FirebaseService._debouncedPersistCache = jest.fn();

    FirebaseService._mergeRealtimeEventSlices(false, { fromCache: true });
    expect(FirebaseService._cache.events[0].current).toBe(20);

    FirebaseService._cache.events = [freshDetail];
    FirebaseService._eventSlices.injected = [freshDetail];
    FirebaseService._mergeRealtimeEventSlices(false, { fromCache: true });

    expect(FirebaseService._cache.events[0]).toMatchObject({
      id: 'evt-race-before',
      current: 21,
      status: 'full',
    });
  });

  test('server event snapshots replace injected detail records', () => {
    const { FirebaseService } = loadServices();
    FirebaseService._cache.events = [{
      id: 'evt-server',
      _docId: 'eventDocServer',
      current: 21,
      _detailSnapshot: true,
      _detailSnapshotTs: Date.now(),
    }];
    FirebaseService._eventSlices = {
      active: [{ id: 'evt-server', _docId: 'eventDocServer', current: 20, status: 'open' }],
      terminal: [],
      injected: [{
        id: 'evt-server',
        _docId: 'eventDocServer',
        current: 21,
        _detailSnapshot: true,
        _detailSnapshotTs: Date.now(),
      }],
    };
    FirebaseService._debouncedPersistCache = jest.fn();

    FirebaseService._mergeRealtimeEventSlices(false, { fromCache: false });

    expect(FirebaseService._cache.events[0].current).toBe(20);
    expect(FirebaseService._eventSlices.injected).toEqual([]);
  });

  test('same subcollection doc path is merged before status-aware logical dedupe', () => {
    const { FirebaseService } = loadServices();
    const stale = {
      eventId: 'e1',
      userId: 'u1',
      status: 'waitlisted',
      _docId: 'reg_same',
      _path: 'events/eventDocA/registrations/reg_same',
      _sourceKind: 'subcollection',
    };
    const fresh = {
      ...stale,
      status: 'confirmed',
      updatedAt: '2026-04-30T09:00:00.000Z',
    };
    const cancelledHistory = {
      eventId: 'e1',
      userId: 'u1',
      status: 'cancelled',
      _docId: 'reg_cancelled',
      _path: 'events/eventDocA/registrations/reg_cancelled',
      _sourceKind: 'subcollection',
    };

    const result = FirebaseService._canonicalizeRecordList('registrations', [
      stale,
      fresh,
      cancelledHistory,
    ]);

    expect(result.map(r => `${r._docId}:${r.status}`)).toEqual([
      'reg_same:confirmed',
      'reg_cancelled:cancelled',
    ]);
  });

  test('getMyRegistrationsByEvent merges direct and courseOwnerUids ownership without collapsing siblings', () => {
    const { FirebaseService, ApiService } = loadServices();
    FirebaseService._cache.currentUser = { uid: 'parent-1' };
    const makeRegistration = (id, data) => ({
      eventId: 'course-event',
      status: 'confirmed',
      _docId: id,
      _path: `events/eventDocA/registrations/${id}`,
      _sourceKind: 'subcollection',
      _sourceCollection: 'registrations',
      ...data,
    });
    FirebaseService._cache.registrations = [
      makeRegistration('self', { userId: 'parent-1' }),
      makeRegistration('legacy-uid', { userId: 'child-legacy', uid: 'parent-1' }),
      makeRegistration('child-a', { userId: 'child-a', courseOwnerUids: ['parent-1'] }),
      makeRegistration('child-b', { userId: 'child-b', courseOwnerUids: ['parent-1', 'parent-2'] }),
      makeRegistration('other', { userId: 'other', courseOwnerUids: ['parent-2'] }),
      makeRegistration('cancelled-child', {
        userId: 'child-cancelled',
        courseOwnerUids: ['parent-1'],
        status: 'cancelled',
      }),
    ];

    expect(ApiService.getMyRegistrationsByEvent('course-event').map(reg => reg._docId))
      .toEqual(['self', 'legacy-uid', 'child-a', 'child-b']);
    expect(ApiService.getRegistrationHistoryByEventUser('course-event', 'parent-1').map(reg => reg._docId))
      .toEqual(['self', 'legacy-uid', 'child-a', 'child-b', 'cancelled-child']);
  });

  test('attendance cache keeps separate companions under the same owner uid', () => {
    const { FirebaseService } = loadServices();
    const records = [
      {
        eventId: 'e1',
        uid: 'owner_uid',
        userName: 'Owner',
        type: 'checkin',
        participantType: 'companion',
        companionId: 'comp_a',
        companionName: 'Guest A',
        status: 'active',
        _docId: 'att_a',
        _path: 'events/eventDocA/attendanceRecords/att_a',
        _sourceKind: 'subcollection',
      },
      {
        eventId: 'e1',
        uid: 'owner_uid',
        userName: 'Owner',
        type: 'checkin',
        participantType: 'companion',
        companionId: 'comp_b',
        companionName: 'Guest B',
        status: 'active',
        _docId: 'att_b',
        _path: 'events/eventDocA/attendanceRecords/att_b',
        _sourceKind: 'subcollection',
      },
    ];

    const result = FirebaseService._canonicalizeRecordList('attendanceRecords', records);

    expect(result.map(r => r.companionId).sort()).toEqual(['comp_a', 'comp_b']);
  });
});
