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
