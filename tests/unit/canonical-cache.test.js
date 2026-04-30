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
});
