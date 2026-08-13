const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const CREATE_METADATA = Object.freeze({
  payloadRevision: 1,
  payloadDigest: `v1-${'1'.repeat(32)}`,
});

function loadFirebaseCrud({ events, dbMock, docLookup }) {
  const FirebaseService = {
    _cache: { events },
    _getEventDocIdAsync: jest.fn(docLookup),
    _uploadImage: jest.fn(),
    ensureAuthReadyForWrite: jest.fn().mockResolvedValue(true),
  };
  const sandbox = {
    FirebaseService,
    db: dbMock,
    _stripDocId: obj => {
      const { _docId, ...rest } = obj || {};
      return rest;
    },
    firebase: {
      firestore: {
        FieldValue: {
          serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
        },
      },
    },
    console,
  };
  const code = fs.readFileSync(path.join(ROOT, 'js/firebase-crud.js'), 'utf8');
  vm.runInNewContext(code, sandbox, { filename: 'js/firebase-crud.js' });
  return { FirebaseService, sandbox };
}

function makeEventsDb() {
  const update = jest.fn().mockResolvedValue(undefined);
  const doc = jest.fn(() => ({ update }));
  const collection = jest.fn(() => ({ doc }));
  return { db: { collection }, collection, doc, update };
}

function makeCreateEventDb({ exists = false, existingData = {}, existingDataById = null } = {}) {
  const transaction = {
    get: jest.fn(async ref => {
      if (existingDataById) {
        const hasData = Object.prototype.hasOwnProperty.call(existingDataById, ref.id);
        return { exists: hasData, data: () => (hasData ? existingDataById[ref.id] : {}) };
      }
      return { exists, data: () => existingData };
    }),
    set: jest.fn(),
  };
  const runTransaction = jest.fn(async callback => callback(transaction));
  const doc = jest.fn(id => ({ id, path: `events/${id}` }));
  const collection = jest.fn(() => ({ doc }));
  return { db: { collection, runTransaction }, collection, doc, transaction, runTransaction };
}

function makeReconcileEventDb({ exists = false, data = {}, error = null, docId = 'ce_123_abc' } = {}) {
  const get = error
    ? jest.fn().mockRejectedValue(error)
    : jest.fn().mockResolvedValue({ exists, id: docId, data: () => data });
  const doc = jest.fn(id => ({ id, get }));
  const collection = jest.fn(() => ({ doc }));
  return { db: { collection }, collection, doc, get };
}

function loadApiService({ cache, dbMock }) {
  const App = {
    _setSyncState: jest.fn(),
    showToast: jest.fn(),
    invalidateHomeNextActivityCache: jest.fn(),
  };
  const FirebaseService = {
    _cache: cache,
    ensureAuthReadyForWrite: jest.fn().mockResolvedValue(true),
    addEvent: jest.fn(),
    addEventsAtomic: jest.fn(),
  };
  const sandbox = {
    App,
    FirebaseService,
    db: dbMock,
    ROLES: {},
    auth: { currentUser: { uid: 'actor-1' } },
    console,
  };
  const code = fs.readFileSync(path.join(ROOT, 'js/api-service.js'), 'utf8');
  vm.runInNewContext(`${code}\nthis.ApiService = ApiService;`, sandbox, { filename: 'js/api-service.js' });
  return { ApiService: sandbox.ApiService, FirebaseService, App };
}

function loadLifecycle() {
  const App = {
    hasPermission: jest.fn(() => true),
    _canManageEvent: jest.fn(() => true),
    _canCancelOwnActivity: jest.fn(() => true),
    _canReopenOrRelistActivity: jest.fn(() => true),
    _canDeleteActivity: jest.fn(() => true),
    appConfirm: jest.fn().mockResolvedValue(true),
    _parseEventStartDate: jest.fn(() => new Date(0)),
    _isEventTrulyFull: jest.fn(() => false),
    _collectEventNotifyRecipientUids: jest.fn(() => []),
    _sendNotifFromTemplate: jest.fn(),
    renderMyActivities: jest.fn(),
    renderActivityList: jest.fn(),
    renderHotEvents: jest.fn(),
    showToast: jest.fn(),
  };
  const ApiService = {
    getEvent: jest.fn(() => ({ id: 'evt-1', _docId: 'doc-1', title: 'Test Event', date: '2026/05/01 19:00~21:00', status: 'open' })),
    updateEventAwait: jest.fn().mockResolvedValue({ id: 'evt-1' }),
    deleteEvent: jest.fn().mockResolvedValue(true),
    _normalizeEventUpdates: data => data,
    _updateAwaitWrite: jest.fn().mockResolvedValue({ id: 'evt-1' }),
    _writeOpLog: jest.fn(),
  };
  const FirebaseService = {
    updateEvent: jest.fn(),
    _getEventDocIdAsync: jest.fn().mockResolvedValue('doc-1'),
  };
  const sandbox = { App, ApiService, FirebaseService, document: {}, console };
  const code = fs.readFileSync(path.join(ROOT, 'js/modules/event/event-manage-lifecycle.js'), 'utf8');
  vm.runInNewContext(code, sandbox, { filename: 'js/modules/event/event-manage-lifecycle.js' });
  App._cleanupCancelledRecords = jest.fn().mockResolvedValue(undefined);
  return { App, ApiService, FirebaseService };
}

describe('event write integrity', () => {
  test('addEvent creates new events with data id as Firestore doc id', async () => {
    const db = makeCreateEventDb();
    const { FirebaseService } = loadFirebaseCrud({
      events: [],
      dbMock: db.db,
      docLookup: jest.fn(),
    });
    const event = {
      ...CREATE_METADATA,
      id: 'ce_123_abc',
      clientRequestId: 'ce_123_abc',
      creatorUid: 'actor-1',
      title: 'New Event',
      image: '',
    };

    const result = await FirebaseService.addEvent(event);

    expect(db.collection).toHaveBeenCalledWith('events');
    expect(db.doc).toHaveBeenCalledWith('ce_123_abc');
    expect(db.runTransaction).toHaveBeenCalled();
    expect(db.transaction.get).toHaveBeenCalledWith(expect.objectContaining({ id: 'ce_123_abc' }));
    expect(db.transaction.set).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ce_123_abc' }),
      expect.objectContaining({
        id: 'ce_123_abc',
        clientRequestId: 'ce_123_abc',
        creatorUid: 'actor-1',
        title: 'New Event',
        createdAt: 'SERVER_TIMESTAMP',
        updatedAt: 'SERVER_TIMESTAMP',
      })
    );
    expect(result._docId).toBe('ce_123_abc');
    expect(result.clientRequestId).toBe(result.id);
  });

  test('addEvent rejects unsafe event ids before writing', async () => {
    const db = makeCreateEventDb();
    const { FirebaseService } = loadFirebaseCrud({
      events: [],
      dbMock: db.db,
      docLookup: jest.fn(),
    });

    await expect(FirebaseService.addEvent({
      id: 'events/bad',
      clientRequestId: 'events/bad',
      creatorUid: 'actor-1',
      title: 'Bad Event',
    }))
      .rejects.toThrow('EVENT_ID_INVALID');
    expect(db.collection).not.toHaveBeenCalled();
    expect(db.runTransaction).not.toHaveBeenCalled();
  });

  test.each([
    ['missing creatorUid', undefined],
    ['blank creatorUid', '   '],
    ['unknown creatorUid', 'unknown'],
  ])('addEvent rejects %s before auth or Firestore writes', async (_label, creatorUid) => {
    const db = makeCreateEventDb();
    const { FirebaseService } = loadFirebaseCrud({ events: [], dbMock: db.db, docLookup: jest.fn() });
    const event = {
      id: 'ce_123_abc',
      clientRequestId: 'ce_123_abc',
      title: 'Missing Creator Event',
    };
    if (creatorUid !== undefined) event.creatorUid = creatorUid;

    await expect(FirebaseService.addEvent(event))
      .rejects.toMatchObject({
        code: 'event/creator-uid-invalid',
        eventCreatePhase: 'preflight',
        eventCreateOutcome: 'definitive-rejected',
        eventCreateWriteState: 'not-started',
      });

    expect(FirebaseService.ensureAuthReadyForWrite).not.toHaveBeenCalled();
    expect(db.runTransaction).not.toHaveBeenCalled();
  });

  test.each([
    ['missing clientRequestId', { id: 'ce_123_abc', creatorUid: 'actor-1' }],
    ['different clientRequestId', { id: 'ce_123_abc', clientRequestId: 'ce_other', creatorUid: 'actor-1' }],
  ])('addEvent rejects a create with %s', async (_label, event) => {
    const db = makeCreateEventDb();
    const { FirebaseService } = loadFirebaseCrud({
      events: [],
      dbMock: db.db,
      docLookup: jest.fn(),
    });

    await expect(FirebaseService.addEvent(event))
      .rejects.toMatchObject({
        code: 'event/client-request-id-mismatch',
        eventCreatePhase: 'preflight',
        eventCreateOutcome: 'definitive-rejected',
        eventCreateWriteState: 'not-started',
      });
    expect(db.runTransaction).not.toHaveBeenCalled();
  });

  test.each([
    ['missing payloadRevision', event => { delete event.payloadRevision; }, 'event/payload-revision-invalid'],
    ['zero payloadRevision', event => { event.payloadRevision = 0; }, 'event/payload-revision-invalid'],
    ['missing payloadDigest', event => { delete event.payloadDigest; }, 'event/payload-digest-invalid'],
    ['invalid payloadDigest', event => { event.payloadDigest = 'v1-short'; }, 'event/payload-digest-invalid'],
  ])('addEvent rejects %s before auth, upload, or Firestore writes', async (_label, mutate, code) => {
    const db = makeCreateEventDb();
    const { FirebaseService } = loadFirebaseCrud({ events: [], dbMock: db.db, docLookup: jest.fn() });
    FirebaseService._uploadEventImageVariants = jest.fn();
    const event = {
      ...CREATE_METADATA,
      id: 'ce_metadata',
      clientRequestId: 'ce_metadata',
      creatorUid: 'actor-1',
    };
    mutate(event);

    await expect(FirebaseService.addEvent(event)).rejects.toMatchObject({
      code,
      eventCreatePhase: 'preflight',
      eventCreateOutcome: 'definitive-rejected',
      eventCreateWriteState: 'not-started',
    });
    expect(FirebaseService.ensureAuthReadyForWrite).not.toHaveBeenCalled();
    expect(FirebaseService._uploadEventImageVariants).not.toHaveBeenCalled();
    expect(db.runTransaction).not.toHaveBeenCalled();
  });

  test('addEvent treats the same id, client request id, and creator uid as an acknowledged replay', async () => {
    const db = makeCreateEventDb({
      exists: true,
      existingData: {
        ...CREATE_METADATA,
        id: 'ce_123_abc',
        clientRequestId: 'ce_123_abc',
        creatorUid: 'actor-1',
        title: 'Stored Event',
      },
    });
    const { FirebaseService } = loadFirebaseCrud({ events: [], dbMock: db.db, docLookup: jest.fn() });

    const result = await FirebaseService.addEvent({
      ...CREATE_METADATA,
      id: 'ce_123_abc',
      clientRequestId: 'ce_123_abc',
      creatorUid: 'actor-1',
      title: 'Retry Payload',
      image: '',
    });

    expect(db.transaction.set).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      id: 'ce_123_abc',
      clientRequestId: 'ce_123_abc',
      creatorUid: 'actor-1',
      title: 'Stored Event',
      _docId: 'ce_123_abc',
    });
  });

  test('addEvent returns the final canonical replay when the Firestore transaction callback retries', async () => {
    const stored = {
      ...CREATE_METADATA,
      id: 'ce_123_abc',
      clientRequestId: 'ce_123_abc',
      creatorUid: 'actor-1',
      title: 'Concurrent Stored Event',
    };
    const db = makeCreateEventDb();
    db.transaction.get
      .mockResolvedValueOnce({ exists: false, data: () => ({}) })
      .mockResolvedValueOnce({ exists: true, data: () => stored });
    db.runTransaction.mockImplementation(async callback => {
      await callback(db.transaction);
      return callback(db.transaction);
    });
    const { FirebaseService } = loadFirebaseCrud({ events: [], dbMock: db.db, docLookup: jest.fn() });

    const result = await FirebaseService.addEvent({
      ...CREATE_METADATA,
      id: 'ce_123_abc',
      clientRequestId: 'ce_123_abc',
      creatorUid: 'actor-1',
      title: 'Original Attempt',
      image: '',
    });

    expect(db.transaction.get).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ ...stored, _docId: 'ce_123_abc' });
  });

  test.each([
    ['id', { id: 'ce_other', clientRequestId: 'ce_123_abc', creatorUid: 'actor-1' }],
    ['clientRequestId', { id: 'ce_123_abc', clientRequestId: 'ce_other', creatorUid: 'actor-1' }],
    ['missing creatorUid', { id: 'ce_123_abc', clientRequestId: 'ce_123_abc' }],
    ['unknown creatorUid', { id: 'ce_123_abc', clientRequestId: 'ce_123_abc', creatorUid: 'unknown' }],
    ['creatorUid', { id: 'ce_123_abc', clientRequestId: 'ce_123_abc', creatorUid: 'actor-2' }],
    ['payloadRevision', { id: 'ce_123_abc', clientRequestId: 'ce_123_abc', creatorUid: 'actor-1', payloadRevision: 2 }],
    ['payloadDigest', { id: 'ce_123_abc', clientRequestId: 'ce_123_abc', creatorUid: 'actor-1', payloadDigest: `v1-${'2'.repeat(32)}` }],
  ])('addEvent rejects an existing event when persisted %s differs', async (_label, existingData) => {
    const persisted = { ...CREATE_METADATA, ...existingData };
    const db = makeCreateEventDb({ exists: true, existingData: persisted });
    const { FirebaseService } = loadFirebaseCrud({ events: [], dbMock: db.db, docLookup: jest.fn() });

    await expect(FirebaseService.addEvent({
      ...CREATE_METADATA,
      id: 'ce_123_abc',
      clientRequestId: 'ce_123_abc',
      creatorUid: 'actor-1',
      title: 'Duplicate',
      image: '',
    })).rejects.toMatchObject({
      code: 'event/id-conflict',
      eventCreatePhase: 'transaction',
      eventCreateOutcome: 'conflict',
      eventCreateWriteState: 'unknown',
    });
    expect(db.transaction.set).not.toHaveBeenCalled();
  });

  test.each([
    ['permission-denied', 'ambiguous'],
    ['unauthenticated', 'ambiguous'],
    ['invalid-argument', 'ambiguous'],
    ['unavailable', 'ambiguous'],
  ])('addEvent tags a transaction %s rejection as %s', async (code, outcome) => {
    const db = makeCreateEventDb();
    const error = new Error(code);
    error.code = code;
    db.runTransaction.mockRejectedValue(error);
    const { FirebaseService } = loadFirebaseCrud({ events: [], dbMock: db.db, docLookup: jest.fn() });

    await expect(FirebaseService.addEvent({
      ...CREATE_METADATA,
      id: 'ce_phase',
      clientRequestId: 'ce_phase',
      creatorUid: 'actor-1',
      image: '',
    })).rejects.toMatchObject({
      code,
      eventCreatePhase: 'transaction',
      eventCreateOutcome: outcome,
      eventCreateWriteState: 'unknown',
    });
  });

  test('addEventsAtomic commits every date in one transaction', async () => {
    const db = makeCreateEventDb();
    const { FirebaseService } = loadFirebaseCrud({ events: [], dbMock: db.db, docLookup: jest.fn() });
    FirebaseService.ensureAuthReadyForWrite = jest.fn().mockResolvedValue(true);
    FirebaseService._uploadEventImageVariants = jest.fn().mockResolvedValue(undefined);
    const events = [
      { ...CREATE_METADATA, id: 'ce_batch_1', clientRequestId: 'ce_batch_1', title: 'Date 1', creatorUid: 'actor-1', batchGroupId: 'batch-1', image: '' },
      { ...CREATE_METADATA, id: 'ce_batch_2', clientRequestId: 'ce_batch_2', title: 'Date 2', creatorUid: 'actor-1', batchGroupId: 'batch-1', image: '' },
    ];

    const result = await FirebaseService.addEventsAtomic(events);

    expect(db.runTransaction).toHaveBeenCalledTimes(1);
    expect(db.transaction.get).toHaveBeenCalledTimes(2);
    expect(db.transaction.set).toHaveBeenCalledTimes(2);
    expect(result.map(event => event._docId)).toEqual(['ce_batch_1', 'ce_batch_2']);
    expect(result.map(event => event.clientRequestId)).toEqual(['ce_batch_1', 'ce_batch_2']);
  });

  test('addEventsAtomic treats an acknowledged retry of the same batch as idempotent', async () => {
    const db = makeCreateEventDb({
      existingDataById: {
        ce_batch_1: {
          ...CREATE_METADATA,
          id: 'ce_batch_1',
          clientRequestId: 'ce_batch_1',
          creatorUid: 'actor-1',
          batchGroupId: 'batch-1',
          title: 'Stored Date 1',
        },
        ce_batch_2: {
          ...CREATE_METADATA,
          id: 'ce_batch_2',
          clientRequestId: 'ce_batch_2',
          creatorUid: 'actor-1',
          batchGroupId: 'batch-1',
          title: 'Stored Date 2',
        },
      },
    });
    const { FirebaseService } = loadFirebaseCrud({ events: [], dbMock: db.db, docLookup: jest.fn() });
    FirebaseService.ensureAuthReadyForWrite = jest.fn().mockResolvedValue(true);
    FirebaseService._uploadEventImageVariants = jest.fn().mockResolvedValue(undefined);
    const events = [
      { ...CREATE_METADATA, id: 'ce_batch_1', clientRequestId: 'ce_batch_1', creatorUid: 'actor-1', batchGroupId: 'batch-1', image: '' },
      { ...CREATE_METADATA, id: 'ce_batch_2', clientRequestId: 'ce_batch_2', creatorUid: 'actor-1', batchGroupId: 'batch-1', image: '' },
    ];

    const result = await FirebaseService.addEventsAtomic(events);

    expect(db.transaction.set).not.toHaveBeenCalled();
    expect(result).toEqual([
      expect.objectContaining({ id: 'ce_batch_1', title: 'Stored Date 1', _docId: 'ce_batch_1' }),
      expect.objectContaining({ id: 'ce_batch_2', title: 'Stored Date 2', _docId: 'ce_batch_2' }),
    ]);
  });

  test.each([
    ['missing creatorUid', batch => { delete batch[1].creatorUid; }, 'event/creator-uid-invalid'],
    ['blank creatorUid', batch => { batch[1].creatorUid = '   '; }, 'event/creator-uid-invalid'],
    ['unknown creatorUid', batch => { batch[1].creatorUid = 'unknown'; }, 'event/creator-uid-invalid'],
    ['different creatorUid', batch => { batch[1].creatorUid = 'actor-2'; }, 'event/batch-creator-mismatch'],
    ['missing clientRequestId', batch => { delete batch[1].clientRequestId; }, 'event/client-request-id-mismatch'],
    ['different clientRequestId', batch => { batch[1].clientRequestId = 'ce_other'; }, 'event/client-request-id-mismatch'],
    ['missing batchGroupId', batch => { delete batch[1].batchGroupId; }, 'event/batch-group-invalid'],
    ['blank batchGroupId', batch => { batch[1].batchGroupId = '   '; }, 'event/batch-group-invalid'],
    ['different batchGroupId', batch => { batch[1].batchGroupId = 'batch-2'; }, 'event/batch-group-invalid'],
    ['missing payloadRevision', batch => { delete batch[1].payloadRevision; }, 'event/payload-revision-invalid'],
    ['invalid payloadRevision', batch => { batch[1].payloadRevision = 0; }, 'event/payload-revision-invalid'],
    ['missing payloadDigest', batch => { delete batch[1].payloadDigest; }, 'event/payload-digest-invalid'],
    ['invalid payloadDigest', batch => { batch[1].payloadDigest = 'v1-short'; }, 'event/payload-digest-invalid'],
  ])('addEventsAtomic rejects %s before auth, upload, or Firestore writes', async (_label, mutate, code) => {
    const db = makeCreateEventDb();
    const { FirebaseService } = loadFirebaseCrud({ events: [], dbMock: db.db, docLookup: jest.fn() });
    FirebaseService._uploadEventImageVariants = jest.fn().mockResolvedValue(undefined);
    const batch = [
      { ...CREATE_METADATA, id: 'ce_batch_1', clientRequestId: 'ce_batch_1', creatorUid: 'actor-1', batchGroupId: 'batch-1', image: '' },
      { ...CREATE_METADATA, id: 'ce_batch_2', clientRequestId: 'ce_batch_2', creatorUid: 'actor-1', batchGroupId: 'batch-1', image: '' },
    ];
    mutate(batch);

    await expect(FirebaseService.addEventsAtomic(batch)).rejects.toMatchObject({
      code,
      eventCreatePhase: 'preflight',
      eventCreateOutcome: 'definitive-rejected',
      eventCreateWriteState: 'not-started',
    });

    expect(FirebaseService.ensureAuthReadyForWrite).not.toHaveBeenCalled();
    expect(FirebaseService._uploadEventImageVariants).not.toHaveBeenCalled();
    expect(db.collection).not.toHaveBeenCalled();
    expect(db.runTransaction).not.toHaveBeenCalled();
  });

  test('addEventsAtomic rejects an invalid event id before auth, upload, or Firestore writes', async () => {
    const db = makeCreateEventDb();
    const { FirebaseService } = loadFirebaseCrud({ events: [], dbMock: db.db, docLookup: jest.fn() });
    FirebaseService._uploadEventImageVariants = jest.fn().mockResolvedValue(undefined);
    const batch = [
      { ...CREATE_METADATA, id: 'ce_batch_1', clientRequestId: 'ce_batch_1', creatorUid: 'actor-1', batchGroupId: 'batch-1', image: '' },
      { ...CREATE_METADATA, id: 'events/bad', clientRequestId: 'events/bad', creatorUid: 'actor-1', batchGroupId: 'batch-1', image: '' },
    ];

    await expect(FirebaseService.addEventsAtomic(batch)).rejects.toThrow('EVENT_ID_INVALID');

    expect(FirebaseService.ensureAuthReadyForWrite).not.toHaveBeenCalled();
    expect(FirebaseService._uploadEventImageVariants).not.toHaveBeenCalled();
    expect(db.collection).not.toHaveBeenCalled();
    expect(db.runTransaction).not.toHaveBeenCalled();
  });

  test.each([
    ['id', current => { current.id = 'ce_other'; }],
    ['clientRequestId', current => { current.clientRequestId = 'ce_other'; }],
    ['creatorUid', current => { current.creatorUid = 'actor-2'; }],
    ['batchGroupId', current => { current.batchGroupId = 'batch-2'; }],
    ['payloadRevision', current => { current.payloadRevision = 2; }],
    ['payloadDigest', current => { current.payloadDigest = `v1-${'2'.repeat(32)}`; }],
  ])('addEventsAtomic rejects an existing event when persisted %s differs', async (_label, mutate) => {
    const storedDate1 = {
      ...CREATE_METADATA,
      id: 'ce_batch_1',
      clientRequestId: 'ce_batch_1',
      creatorUid: 'actor-1',
      batchGroupId: 'batch-1',
    };
    mutate(storedDate1);
    const db = makeCreateEventDb({
      existingDataById: {
        ce_batch_1: storedDate1,
        ce_batch_2: {
          ...CREATE_METADATA,
          id: 'ce_batch_2',
          clientRequestId: 'ce_batch_2',
          creatorUid: 'actor-1',
          batchGroupId: 'batch-1',
        },
      },
    });
    const { FirebaseService } = loadFirebaseCrud({ events: [], dbMock: db.db, docLookup: jest.fn() });
    FirebaseService._uploadEventImageVariants = jest.fn().mockResolvedValue(undefined);
    const batch = [
      { ...CREATE_METADATA, id: 'ce_batch_1', clientRequestId: 'ce_batch_1', creatorUid: 'actor-1', batchGroupId: 'batch-1', image: '' },
      { ...CREATE_METADATA, id: 'ce_batch_2', clientRequestId: 'ce_batch_2', creatorUid: 'actor-1', batchGroupId: 'batch-1', image: '' },
    ];

    await expect(FirebaseService.addEventsAtomic(batch))
      .rejects.toMatchObject({
        code: 'event/id-conflict',
      eventCreatePhase: 'transaction',
      eventCreateOutcome: 'conflict',
      eventCreateWriteState: 'unknown',
      });
    expect(db.transaction.set).not.toHaveBeenCalled();
  });

  test('createEventsAtomic validates the batch, confirms every write, and upserts cache by id', async () => {
    const stale = { id: 'ce_batch_1', title: 'Stale Date 1' };
    const cache = { events: [stale] };
    const { ApiService, FirebaseService } = loadApiService({ cache });
    const saved = [
      {
        ...CREATE_METADATA,
        id: 'ce_batch_1',
        _docId: 'ce_batch_1',
        clientRequestId: 'ce_batch_1',
        creatorUid: 'actor-1',
        batchGroupId: 'batch-1',
        title: 'Stored Date 1',
      },
      {
        ...CREATE_METADATA,
        id: 'ce_batch_2',
        _docId: 'ce_batch_2',
        clientRequestId: 'ce_batch_2',
        creatorUid: 'actor-1',
        batchGroupId: 'batch-1',
        title: 'Stored Date 2',
      },
    ];
    FirebaseService.addEventsAtomic.mockResolvedValue(saved);
    const batch = [
      { ...CREATE_METADATA, id: 'ce_batch_1', clientRequestId: 'ce_batch_1', creatorUid: 'actor-1', batchGroupId: ' batch-1 ', title: 'Date 1' },
      { ...CREATE_METADATA, id: 'ce_batch_2', clientRequestId: 'ce_batch_2', creatorUid: 'actor-1', batchGroupId: 'batch-1', title: 'Date 2' },
    ];

    const result = await ApiService.createEventsAtomic(batch);

    expect(FirebaseService.ensureAuthReadyForWrite).toHaveBeenCalledWith('actor-1');
    expect(FirebaseService.addEventsAtomic).toHaveBeenCalledWith([
      expect.objectContaining({ ...CREATE_METADATA, id: 'ce_batch_1', clientRequestId: 'ce_batch_1', creatorUid: 'actor-1', batchGroupId: 'batch-1' }),
      expect.objectContaining({ ...CREATE_METADATA, id: 'ce_batch_2', clientRequestId: 'ce_batch_2', creatorUid: 'actor-1', batchGroupId: 'batch-1' }),
    ]);
    expect(result).toBe(saved);
    expect(cache.events).toHaveLength(2);
    expect(cache.events.find(event => event.id === 'ce_batch_1')).toBe(stale);
    expect(stale.title).toBe('Stored Date 1');
    expect(cache.events.filter(event => event.id === 'ce_batch_2')).toHaveLength(1);
  });

  test.each([
    ['invalid id', batch => { batch[1].id = 'events/bad'; batch[1].clientRequestId = 'events/bad'; }, 'event/id-invalid'],
    ['missing clientRequestId', batch => { delete batch[1].clientRequestId; }, 'event/client-request-id-mismatch'],
    ['different clientRequestId', batch => { batch[1].clientRequestId = 'ce_other'; }, 'event/client-request-id-mismatch'],
    ['missing creatorUid', batch => { delete batch[1].creatorUid; }, 'event/creator-uid-invalid'],
    ['blank creatorUid', batch => { batch[1].creatorUid = '   '; }, 'event/creator-uid-invalid'],
    ['unknown creatorUid', batch => { batch[1].creatorUid = 'unknown'; }, 'event/creator-uid-invalid'],
    ['different creatorUid', batch => { batch[1].creatorUid = 'actor-2'; }, 'event/batch-creator-mismatch'],
    ['missing batchGroupId', batch => { delete batch[1].batchGroupId; }, 'event/batch-group-invalid'],
    ['blank batchGroupId', batch => { batch[1].batchGroupId = '   '; }, 'event/batch-group-invalid'],
    ['different batchGroupId', batch => { batch[1].batchGroupId = 'batch-2'; }, 'event/batch-group-invalid'],
    ['missing payloadRevision', batch => { delete batch[1].payloadRevision; }, 'event/payload-revision-invalid'],
    ['invalid payloadRevision', batch => { batch[1].payloadRevision = 0; }, 'event/payload-revision-invalid'],
    ['missing payloadDigest', batch => { delete batch[1].payloadDigest; }, 'event/payload-digest-invalid'],
    ['invalid payloadDigest', batch => { batch[1].payloadDigest = 'v1-short'; }, 'event/payload-digest-invalid'],
  ])('createEventsAtomic rejects %s before auth, write, or cache changes', async (_label, mutate, code) => {
    const cache = { events: [] };
    const { ApiService, FirebaseService } = loadApiService({ cache });
    const batch = [
      { ...CREATE_METADATA, id: 'ce_batch_1', clientRequestId: 'ce_batch_1', creatorUid: 'actor-1', batchGroupId: 'batch-1' },
      { ...CREATE_METADATA, id: 'ce_batch_2', clientRequestId: 'ce_batch_2', creatorUid: 'actor-1', batchGroupId: 'batch-1' },
    ];
    mutate(batch);

    await expect(ApiService.createEventsAtomic(batch)).rejects.toMatchObject({
      code,
      eventCreatePhase: 'preflight',
      eventCreateOutcome: 'definitive-rejected',
      eventCreateWriteState: 'not-started',
    });

    expect(FirebaseService.ensureAuthReadyForWrite).not.toHaveBeenCalled();
    expect(FirebaseService.addEventsAtomic).not.toHaveBeenCalled();
    expect(cache.events).toEqual([]);
  });

  test('createEventsAtomic leaves cache unchanged when a returned event identity is unconfirmed', async () => {
    const cached = { id: 'ce_existing', title: 'Existing Event' };
    const cache = { events: [cached] };
    const { ApiService, FirebaseService } = loadApiService({ cache });
    FirebaseService.addEventsAtomic.mockResolvedValue([
      { ...CREATE_METADATA, id: 'ce_batch_1', _docId: 'ce_batch_1', clientRequestId: 'ce_batch_1', creatorUid: 'actor-1', batchGroupId: 'batch-1' },
      { ...CREATE_METADATA, id: 'ce_batch_2', _docId: 'ce_batch_2', clientRequestId: 'ce_batch_2', creatorUid: 'actor-1', batchGroupId: 'batch-other' },
    ]);
    const batch = [
      { ...CREATE_METADATA, id: 'ce_batch_1', clientRequestId: 'ce_batch_1', creatorUid: 'actor-1', batchGroupId: 'batch-1' },
      { ...CREATE_METADATA, id: 'ce_batch_2', clientRequestId: 'ce_batch_2', creatorUid: 'actor-1', batchGroupId: 'batch-1' },
    ];

    await expect(ApiService.createEventsAtomic(batch))
      .rejects.toMatchObject({
        code: 'event/batch-write-unconfirmed',
        eventCreatePhase: 'post-confirm',
        eventCreateOutcome: 'ambiguous',
        eventCreateWriteState: 'unknown',
      });

    expect(cache.events).toEqual([cached]);
  });

  test('updateEvent resolves missing event doc id before writing', async () => {
    const event = { id: 'evt-1', title: 'Test Event' };
    const db = makeEventsDb();
    const { FirebaseService } = loadFirebaseCrud({
      events: [event],
      dbMock: db.db,
      docLookup: jest.fn().mockResolvedValue('doc-1'),
    });

    const result = await FirebaseService.updateEvent('evt-1', { status: 'cancelled' });

    expect(FirebaseService._getEventDocIdAsync).toHaveBeenCalledWith('evt-1');
    expect(event._docId).toBe('doc-1');
    expect(db.collection).toHaveBeenCalledWith('events');
    expect(db.doc).toHaveBeenCalledWith('doc-1');
    expect(db.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
    expect(result).toBe(event);
  });

  test('updateEvent throws instead of silently returning null when event doc id is unavailable', async () => {
    const db = makeEventsDb();
    const { FirebaseService } = loadFirebaseCrud({
      events: [{ id: 'evt-1', title: 'Test Event' }],
      dbMock: db.db,
      docLookup: jest.fn().mockResolvedValue(null),
    });

    await expect(FirebaseService.updateEvent('evt-1', { status: 'cancelled' }))
      .rejects.toThrow('EVENT_DOC_NOT_FOUND');
    expect(db.update).not.toHaveBeenCalled();
  });

  test('_updateAwaitWrite rolls back optimistic cache when firebase write returns null', async () => {
    const item = { id: 'evt-1', title: 'Test Event', status: 'open' };
    const { ApiService } = loadApiService({ cache: { events: [item] } });
    const firebaseMethod = jest.fn().mockResolvedValue(null);

    await expect(ApiService._updateAwaitWrite('events', 'evt-1', { status: 'cancelled' }, firebaseMethod, 'updateEvent'))
      .rejects.toThrow('write did not update target');

    expect(item.status).toBe('open');
  });

  test('_updateAwaitWrite rolls back optimistic cache and surfaces permission toast on write failure', async () => {
    const item = { id: 'evt-1', title: 'Test Event', status: 'open' };
    const { ApiService, App } = loadApiService({ cache: { events: [item] } });
    const err = Object.assign(new Error('Missing or insufficient permissions.'), {
      code: 'permission-denied',
    });
    const firebaseMethod = jest.fn().mockRejectedValue(err);

    await expect(ApiService._updateAwaitWrite('events', 'evt-1', { status: 'cancelled' }, firebaseMethod, 'updateEvent'))
      .rejects.toBe(err);

    expect(item).toMatchObject({ id: 'evt-1', title: 'Test Event', status: 'open' });
    expect(App.showToast).toHaveBeenCalledWith(expect.any(String));
    expect(err._toasted).toBe(true);
  });

  test('_createAwaitWrite rolls back optimistic cache and surfaces generic internal write toast', async () => {
    const event = { id: 'ce-1', title: 'Internal Error Event', creatorUid: 'actor-1' };
    const cache = { events: [] };
    const { ApiService, App } = loadApiService({ cache });
    const err = new Error('Firebase internal assertion failed');
    const firebaseMethod = jest.fn().mockRejectedValue(err);

    await expect(ApiService._createAwaitWrite('events', event, firebaseMethod, 'createEvent'))
      .rejects.toBe(err);

    expect(cache.events).toEqual([]);
    expect(App.showToast).toHaveBeenCalled();
    expect(err._toasted).toBe(true);
  });

  test('_createAwaitWrite checks event creator uid before writing', async () => {
    const event = { id: 'ce-1', title: 'Private Event', creatorUid: 'actor-1' };
    const cache = { events: [] };
    const { ApiService, FirebaseService } = loadApiService({ cache });
    const firebaseMethod = jest.fn().mockResolvedValue(event);

    await ApiService._createAwaitWrite('events', event, firebaseMethod, 'createEvent');

    expect(FirebaseService.ensureAuthReadyForWrite).toHaveBeenCalledWith('actor-1');
    expect(firebaseMethod).toHaveBeenCalledWith(event);
    expect(cache.events).toEqual([event]);
  });

  test('_createAwaitWrite rolls back event create when auth uid does not match creator uid', async () => {
    const event = { id: 'ce-1', title: 'Private Event', creatorUid: 'line-uid' };
    const cache = { events: [] };
    const { ApiService, FirebaseService } = loadApiService({ cache });
    FirebaseService.ensureAuthReadyForWrite.mockResolvedValue(false);
    const firebaseMethod = jest.fn();

    await expect(ApiService._createAwaitWrite('events', event, firebaseMethod, 'createEvent'))
      .rejects.toMatchObject({
        code: 'auth/uid-mismatch',
        authUid: 'actor-1',
        expectedUid: 'line-uid',
      });

    expect(firebaseMethod).not.toHaveBeenCalled();
    expect(cache.events).toEqual([]);
  });

  test('createEvent waits for the confirmed write before inserting the event cache', async () => {
    const event = { id: 'ce_123_abc', title: 'Pending Event', creatorUid: 'actor-1' };
    const cache = { events: [] };
    const { ApiService, FirebaseService } = loadApiService({ cache });
    let resolveWrite;
    let sentPayload;
    FirebaseService.addEvent.mockImplementation(payload => {
      sentPayload = payload;
      return new Promise(resolve => { resolveWrite = resolve; });
    });

    const createPromise = ApiService.createEvent(event);
    await Promise.resolve();

    expect(FirebaseService.addEvent).toHaveBeenCalledWith(expect.objectContaining({
      id: 'ce_123_abc',
      clientRequestId: 'ce_123_abc',
      creatorUid: 'actor-1',
      payloadRevision: 1,
      payloadDigest: expect.stringMatching(/^v1-[0-9a-f]{32}$/),
    }));
    expect(cache.events).toEqual([]);

    resolveWrite({
      ...sentPayload,
      _docId: 'ce_123_abc',
      title: 'Confirmed Event',
    });
    const result = await createPromise;

    expect(result.title).toBe('Confirmed Event');
    expect(cache.events).toHaveLength(1);
    expect(cache.events[0]).toBe(result);
  });

  test('createEvent leaves cache unchanged when the confirmed write fails', async () => {
    const cached = { id: 'ce_existing', title: 'Existing Event' };
    const cache = { events: [cached] };
    const { ApiService, FirebaseService } = loadApiService({ cache });
    const err = new Error('write failed');
    FirebaseService.addEvent.mockRejectedValue(err);

    await expect(ApiService.createEvent({
      id: 'ce_123_abc',
      clientRequestId: 'ce_123_abc',
      creatorUid: 'actor-1',
      title: 'Failed Event',
    })).rejects.toBe(err);

    expect(cache.events).toEqual([cached]);
  });

  test('createEvent rejects an explicit client request id mismatch before writing', async () => {
    const cache = { events: [] };
    const { ApiService, FirebaseService } = loadApiService({ cache });

    await expect(ApiService.createEvent({
      id: 'ce_123_abc',
      clientRequestId: 'ce_other',
      creatorUid: 'actor-1',
      title: 'Mismatched Event',
    })).rejects.toMatchObject({
      code: 'event/client-request-id-mismatch',
      eventCreatePhase: 'preflight',
      eventCreateOutcome: 'definitive-rejected',
      eventCreateWriteState: 'not-started',
    });

    expect(FirebaseService.addEvent).not.toHaveBeenCalled();
    expect(cache.events).toEqual([]);
  });

  test.each([
    ['missing creatorUid', undefined],
    ['blank creatorUid', '   '],
    ['unknown creatorUid', 'unknown'],
  ])('createEvent rejects %s before writing or changing cache', async (_label, creatorUid) => {
    const cache = { events: [] };
    const { ApiService, FirebaseService } = loadApiService({ cache });
    const event = {
      id: 'ce_123_abc',
      clientRequestId: 'ce_123_abc',
      title: 'Missing Creator Event',
    };
    if (creatorUid !== undefined) event.creatorUid = creatorUid;

    await expect(ApiService.createEvent(event))
      .rejects.toMatchObject({ code: 'event/creator-uid-invalid' });

    expect(FirebaseService.addEvent).not.toHaveBeenCalled();
    expect(cache.events).toEqual([]);
  });

  test('createEvent upserts repeated confirmations by event id without duplicate cache rows', async () => {
    const cache = { events: [{ id: 'ce_123_abc', title: 'Stale Event' }] };
    const { ApiService, FirebaseService } = loadApiService({ cache });
    FirebaseService.addEvent.mockImplementation(async payload => ({
      ...payload,
      title: 'Stored Event',
      _docId: 'ce_123_abc',
    }));
    const request = {
      id: 'ce_123_abc',
      clientRequestId: 'ce_123_abc',
      creatorUid: 'actor-1',
      title: 'Retry Event',
    };

    const first = await ApiService.createEvent(request);
    const second = await ApiService.createEvent(request);

    expect(cache.events).toHaveLength(1);
    expect(cache.events[0]).toBe(first);
    expect(second).toBe(first);
    expect(first.title).toBe('Stored Event');
  });

  test('reconcileEventCreate performs a server-source read and returns committed with canonical cache data', async () => {
    const db = makeReconcileEventDb({
      exists: true,
      data: {
        ...CREATE_METADATA,
        id: 'ce_123_abc',
        clientRequestId: 'ce_123_abc',
        creatorUid: 'actor-1',
        title: 'Stored Event',
      },
    });
    const cache = { events: [{ id: 'ce_123_abc', title: 'Stale Event' }] };
    const { ApiService } = loadApiService({ cache, dbMock: db.db });

    const result = await ApiService.reconcileEventCreate({
      ...CREATE_METADATA,
      id: 'ce_123_abc',
      clientRequestId: 'ce_123_abc',
      creatorUid: 'actor-1',
    });

    expect(db.collection).toHaveBeenCalledWith('events');
    expect(db.doc).toHaveBeenCalledWith('ce_123_abc');
    expect(db.get).toHaveBeenCalledWith({ source: 'server' });
    expect(result.state).toBe('committed');
    expect(result.event).toMatchObject({ title: 'Stored Event', _docId: 'ce_123_abc' });
    expect(cache.events).toHaveLength(1);
    expect(cache.events[0]).toBe(result.event);
  });

  test('reconcileEventCreate returns missing only after a server-source nonexistence result', async () => {
    const db = makeReconcileEventDb({ exists: false });
    const cache = { events: [] };
    const { ApiService } = loadApiService({ cache, dbMock: db.db });

    const result = await ApiService.reconcileEventCreate({
      ...CREATE_METADATA,
      id: 'ce_123_abc',
      clientRequestId: 'ce_123_abc',
      creatorUid: 'actor-1',
    });

    expect(result).toEqual({
      state: 'missing',
      eventId: 'ce_123_abc',
      clientRequestId: 'ce_123_abc',
    });
    expect(cache.events).toEqual([]);
  });

  test.each([
    { ...CREATE_METADATA, id: 'ce_other', clientRequestId: 'ce_123_abc', creatorUid: 'actor-1' },
    { ...CREATE_METADATA, id: 'ce_123_abc', clientRequestId: 'ce_other', creatorUid: 'actor-1' },
    { ...CREATE_METADATA, id: 'ce_123_abc', clientRequestId: 'ce_123_abc', creatorUid: 'actor-2' },
    { ...CREATE_METADATA, payloadRevision: 2, id: 'ce_123_abc', clientRequestId: 'ce_123_abc', creatorUid: 'actor-1' },
    { ...CREATE_METADATA, payloadDigest: `v1-${'2'.repeat(32)}`, id: 'ce_123_abc', clientRequestId: 'ce_123_abc', creatorUid: 'actor-1' },
  ])('reconcileEventCreate returns conflict when persisted request identity differs', async (persisted) => {
    const db = makeReconcileEventDb({ exists: true, data: persisted });
    const cache = { events: [] };
    const { ApiService } = loadApiService({ cache, dbMock: db.db });

    const result = await ApiService.reconcileEventCreate({
      ...CREATE_METADATA,
      id: 'ce_123_abc',
      clientRequestId: 'ce_123_abc',
      creatorUid: 'actor-1',
    });

    expect(result.state).toBe('conflict');
    expect(cache.events).toEqual([]);
  });

  test('reconcileEventCreate propagates server read errors instead of reporting missing', async () => {
    const err = new Error('offline');
    const db = makeReconcileEventDb({ error: err });
    const { ApiService } = loadApiService({ cache: { events: [] }, dbMock: db.db });

    await expect(ApiService.reconcileEventCreate({
      ...CREATE_METADATA,
      id: 'ce_123_abc',
      clientRequestId: 'ce_123_abc',
      creatorUid: 'actor-1',
    })).rejects.toBe(err);
  });

  test('reconcileEventCreate rejects a missing client request id without reading Firestore', async () => {
    const db = makeReconcileEventDb({ exists: true });
    const { ApiService } = loadApiService({ cache: { events: [] }, dbMock: db.db });

    await expect(ApiService.reconcileEventCreate({
      id: 'ce_123_abc',
      creatorUid: 'actor-1',
    })).rejects.toMatchObject({ code: 'event/client-request-id-mismatch' });

    expect(db.collection).not.toHaveBeenCalled();
  });

  test.each([
    ['missing payloadRevision', request => { delete request.payloadRevision; }, 'event/payload-revision-invalid'],
    ['invalid payloadRevision', request => { request.payloadRevision = 0; }, 'event/payload-revision-invalid'],
    ['missing payloadDigest', request => { delete request.payloadDigest; }, 'event/payload-digest-invalid'],
    ['invalid payloadDigest', request => { request.payloadDigest = 'v1-short'; }, 'event/payload-digest-invalid'],
  ])('reconcileEventCreate rejects %s without reading Firestore', async (_label, mutate, code) => {
    const db = makeReconcileEventDb({ exists: true });
    const { ApiService } = loadApiService({ cache: { events: [] }, dbMock: db.db });
    const request = {
      ...CREATE_METADATA,
      id: 'ce_123_abc',
      clientRequestId: 'ce_123_abc',
      creatorUid: 'actor-1',
    };
    mutate(request);

    await expect(ApiService.reconcileEventCreate(request)).rejects.toMatchObject({ code });
    expect(db.collection).not.toHaveBeenCalled();
  });

  test.each([
    ['missing creatorUid', undefined],
    ['blank creatorUid', '   '],
    ['unknown creatorUid', 'unknown'],
  ])('reconcileEventCreate rejects %s without reading Firestore', async (_label, creatorUid) => {
    const db = makeReconcileEventDb({ exists: true });
    const { ApiService } = loadApiService({ cache: { events: [] }, dbMock: db.db });
    const request = { id: 'ce_123_abc', clientRequestId: 'ce_123_abc' };
    if (creatorUid !== undefined) request.creatorUid = creatorUid;

    await expect(ApiService.reconcileEventCreate(request))
      .rejects.toMatchObject({ code: 'event/creator-uid-invalid' });

    expect(db.collection).not.toHaveBeenCalled();
  });

  test('attendance permission-denied error is not mapped to LINE login failure', () => {
    const { ApiService } = loadApiService({ cache: { events: [] } });
    const err = Object.assign(new Error('Missing or insufficient permissions.'), {
      code: 'permission-denied',
    });

    const message = ApiService._mapAttendanceWriteError(err);

    expect(message).toContain('Firebase 權限不足');
    expect(message).not.toContain('LINE');
  });

  test('attendance unauthenticated error still asks for LINE login when LIFF session is missing', () => {
    const { ApiService } = loadApiService({ cache: { events: [] } });
    const err = Object.assign(new Error('unauthenticated'), {
      code: 'unauthenticated',
    });

    const message = ApiService._mapAttendanceWriteError(err);

    expect(message).toContain('LINE 登入');
  });

  test('getEvent resolves ended event records by data id or Firestore doc id', () => {
    const item = { id: 'evt-ended-1', _docId: 'doc-ended-1', docId: 'legacy-doc-id', title: 'Ended Event', status: 'ended' };
    const { ApiService } = loadApiService({ cache: { events: [item] } });

    expect(ApiService.getEvent('evt-ended-1')).toBe(item);
    expect(ApiService.getEvent('doc-ended-1')).toBe(item);
    expect(ApiService.getEvent('legacy-doc-id')).toBe(item);
    expect(ApiService.getEvent('missing')).toBeNull();
  });
});

describe('event lifecycle operation logs', () => {
  test('cancelMyActivity writes operation log with event id only after awaited update', async () => {
    const { App, ApiService, FirebaseService } = loadLifecycle();

    await App.cancelMyActivity('evt-1');

    expect(ApiService._updateAwaitWrite).toHaveBeenCalledWith('events', 'evt-1', { status: 'cancelled' }, FirebaseService.updateEvent, 'cancelMyActivity');
    expect(ApiService._writeOpLog).toHaveBeenCalledWith('event_cancel', '取消活動', '取消「Test Event」', 'evt-1');
  });

  test('closeMyActivity awaits event update and writes event id in operation log', async () => {
    const { App, ApiService } = loadLifecycle();

    await App.closeMyActivity('evt-1');

    expect(ApiService.updateEventAwait).toHaveBeenCalledWith('evt-1', { status: 'ended' });
    expect(ApiService._writeOpLog).toHaveBeenCalledWith('event_end', '結束活動', '結束「Test Event」', 'evt-1');
  });

  test('course-linked lifecycle guard recognizes course links and ignores ordinary events', () => {
    const { App } = loadLifecycle();

    expect(App._guardCourseLinkedEventLifecycle({ id: 'course-1', courseLinked: true })).toBe(true);
    expect(App.showToast).toHaveBeenCalledWith(expect.stringContaining('\u8ab2\u7a0b\u8f49\u5316'));

    App.showToast.mockClear();
    expect(App._guardCourseLinkedEventLifecycle({ id: 'course-2', courseLinkId: 'link-1' })).toBe(true);
    expect(App.showToast).toHaveBeenCalledWith(expect.stringContaining('\u8ab2\u7a0b\u8f49\u5316'));

    App.showToast.mockClear();
    expect(App._guardCourseLinkedEventLifecycle({ id: 'plain-1' })).toBe(false);
    expect(App.showToast).not.toHaveBeenCalled();
  });

  test('deleteMyActivity blocks course-linked events before destructive writes', async () => {
    const { App, ApiService } = loadLifecycle();
    ApiService.getEvent.mockReturnValue({
      id: 'evt-1',
      _docId: 'doc-1',
      title: 'Course Event',
      date: '2026/05/01 19:00~21:00',
      status: 'open',
      courseLinked: true,
      courseLinkId: 'link-1',
    });

    await App.deleteMyActivity('evt-1');

    expect(App.appConfirm).not.toHaveBeenCalled();
    expect(ApiService.deleteEvent).not.toHaveBeenCalled();
    expect(App._cleanupCancelledRecords).not.toHaveBeenCalled();
    expect(ApiService._writeOpLog).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), 'evt-1');
  });

  test('deleteMyActivity preserves event doc id for cleanup and writes event id in operation log', async () => {
    const { App, ApiService } = loadLifecycle();

    await App.deleteMyActivity('evt-1');

    expect(ApiService.deleteEvent).toHaveBeenCalledWith('evt-1');
    expect(App._cleanupCancelledRecords).toHaveBeenCalledWith('evt-1', 'doc-1');
    expect(ApiService._writeOpLog).toHaveBeenCalledWith('event_delete', '刪除活動', '刪除「Test Event」', 'evt-1');
  });
});
