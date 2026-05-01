const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');

function loadFirebaseCrud({ events, dbMock, docLookup }) {
  const FirebaseService = {
    _cache: { events },
    _getEventDocIdAsync: jest.fn(docLookup),
    _uploadImage: jest.fn(),
  };
  const sandbox = {
    FirebaseService,
    db: dbMock,
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

function loadApiService({ cache }) {
  const App = {
    _setSyncState: jest.fn(),
    showToast: jest.fn(),
  };
  const FirebaseService = {
    _cache: cache,
    ensureAuthReadyForWrite: jest.fn().mockResolvedValue(true),
  };
  const sandbox = {
    App,
    FirebaseService,
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

  test('deleteMyActivity preserves event doc id for cleanup and writes event id in operation log', async () => {
    const { App, ApiService } = loadLifecycle();

    await App.deleteMyActivity('evt-1');

    expect(ApiService.deleteEvent).toHaveBeenCalledWith('evt-1');
    expect(App._cleanupCancelledRecords).toHaveBeenCalledWith('evt-1', 'doc-1');
    expect(ApiService._writeOpLog).toHaveBeenCalledWith('event_delete', '刪除活動', '刪除「Test Event」', 'evt-1');
  });
});
