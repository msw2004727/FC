const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createRegistrationDoc(eventDocId, row) {
  return {
    id: row._docId,
    data: () => {
      const { _docId, ...data } = row;
      return { ...data };
    },
    ref: { path: `events/${eventDocId}/registrations/${row._docId}` },
  };
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

function createDbMock(eventDocId, serverRows, options = {}) {
  const writes = [];
  const get = jest.fn(async () => ({
    docs: serverRows.map(row => createRegistrationDoc(eventDocId, row)),
  }));
  return {
    writes,
    get,
    collection: jest.fn(collectionName => {
      expect(collectionName).toBe('events');
      return {
        doc: eventId => ({
          id: eventId,
          collection: subcollectionName => {
            expect(subcollectionName).toBe('registrations');
            return {
              get,
              doc: regDocId => ({
                id: regDocId,
                path: `events/${eventId}/registrations/${regDocId}`,
              }),
            };
          },
        }),
      };
    }),
    batch: jest.fn(() => ({
      update: jest.fn((ref, payload) => writes.push({ ref, payload })),
      commit: jest.fn(() => options.commitImpl?.() || Promise.resolve()),
    })),
  };
}

function loadTeamSplitModule({ event, cacheRows = [], serverRows, random = Math.random, commitImpl = null }) {
  const eventDocId = event._docId || 'event-doc';
  const timestampSentinel = { __type: 'serverTimestamp' };
  const db = createDbMock(eventDocId, serverRows, { commitImpl });
  const context = {
    App: {
      appConfirm: jest.fn(async () => true),
      showToast: jest.fn(),
      showEventDetail: jest.fn(async () => {}),
      _renderAttendanceTable: jest.fn(),
      _canManageTeamSplit: jest.fn(() => true),
      _tsCloseJerseyPicker: jest.fn(),
    },
    ApiService: {
      _fetchedRegistrationIds: new Set(),
      _fetchedRegistrationServerIds: new Set(),
      getEvent: jest.fn(id => (id === event.id ? event : null)),
      getRegistrationsByEvent: jest.fn(id => (id === event.id ? cacheRows : [])),
    },
    FirebaseService: {
      _cache: { registrations: cacheRows },
      _getEventDocIdAsync: jest.fn(async id => (id === event.id ? eventDocId : '')),
      _mapSubcollectionDoc: jest.fn((doc, _collectionName, { eventId }) => ({
        ...doc.data(),
        eventId,
        _docId: doc.id,
        _path: `events/${eventDocId}/registrations/${doc.id}`,
        _sourceKind: 'subcollection',
      })),
      _upsertCanonicalCacheRecord: jest.fn((_collectionName, record) => {
        const idx = cacheRows.findIndex(row => row._docId === record._docId || row.id === record.id);
        if (idx >= 0) cacheRows[idx] = { ...cacheRows[idx], ...record };
        else cacheRows.push(record);
      }),
      _saveToLS: jest.fn(),
    },
    firebase: {
      firestore: {
        FieldValue: {
          serverTimestamp: jest.fn(() => timestampSentinel),
        },
      },
    },
    db,
    I18N: { t: jest.fn(() => null) },
    escapeHTML: value => String(value || ''),
    requestAnimationFrame: cb => cb(),
    setTimeout,
    document: { body: { appendChild: jest.fn() }, addEventListener: jest.fn(), removeEventListener: jest.fn() },
    window: { innerWidth: 390 },
    Math: Object.create(Math, {
      random: { value: random },
    }),
    console,
  };
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../js/modules/event/event-team-split.js'),
    'utf8',
  );
  vm.runInNewContext(source, context, { filename: 'js/modules/event/event-team-split.js' });
  return { app: context.App, db, cacheRows, timestampSentinel };
}

function createEvent() {
  return {
    id: 'evt-team-split-write',
    _docId: 'evt-doc',
    teamSplit: {
      enabled: true,
      mode: 'manual',
      teams: [
        { key: 'A', name: 'A Team' },
        { key: 'B', name: 'B Team' },
      ],
    },
  };
}

describe('event team split writes', () => {
  test('manual picker resolves a displayed registration id to the real registration doc id', async () => {
    const event = createEvent();
    const cacheRows = [];
    const serverRows = [
      {
        _docId: 'reg-doc-a',
        id: 'display-reg-a',
        eventId: event.id,
        userId: 'user-a',
        userName: 'User A',
        participantType: 'self',
        status: 'confirmed',
        teamKey: 'A',
      },
    ];
    const { app, db, cacheRows: updatedCache, timestampSentinel } = loadTeamSplitModule({ event, cacheRows, serverRows });

    await app._tsPickTeam('display-reg-a', event.id, 'B');

    expect(db.writes).toHaveLength(1);
    expect(db.writes[0].ref.path).toBe('events/evt-doc/registrations/reg-doc-a');
    expect(db.writes[0].payload).toEqual({ teamKey: 'B', updatedAt: timestampSentinel });
    expect(updatedCache.find(row => row._docId === 'reg-doc-a').teamKey).toBe('B');
    expect(app.showEventDetail).toHaveBeenCalledWith(event.id);
    expect(app._renderAttendanceTable).not.toHaveBeenCalled();
  });

  test('manual picker applies the selected team before the backend commit resolves', async () => {
    const event = createEvent();
    const deferred = createDeferred();
    const commitImpl = jest.fn(() => deferred.promise);
    const serverRows = [
      {
        _docId: 'reg-doc-a',
        id: 'display-reg-a',
        eventId: event.id,
        userId: 'user-a',
        status: 'confirmed',
        teamKey: 'A',
      },
    ];
    const { app, cacheRows: updatedCache } = loadTeamSplitModule({ event, serverRows, commitImpl });

    await app._tsPickTeam('display-reg-a', event.id, 'B');

    expect(updatedCache.find(row => row._docId === 'reg-doc-a').teamKey).toBe('B');
    expect(app.showEventDetail).toHaveBeenCalledWith(event.id);
    expect(app.showToast).not.toHaveBeenCalled();
    const pending = app._tsTeamSplitPendingOps.get(event.id);
    expect(pending).toBeTruthy();

    deferred.resolve();
    await pending;
  });

  test('manual picker rolls back the optimistic team when the backend commit fails', async () => {
    const event = createEvent();
    const deferred = createDeferred();
    const commitImpl = jest.fn(() => deferred.promise);
    const serverRows = [
      {
        _docId: 'reg-doc-a',
        id: 'display-reg-a',
        eventId: event.id,
        userId: 'user-a',
        status: 'confirmed',
        teamKey: 'A',
      },
    ];
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { app, cacheRows: updatedCache } = loadTeamSplitModule({ event, serverRows, commitImpl });

    await app._tsPickTeam('display-reg-a', event.id, 'B');
    expect(updatedCache.find(row => row._docId === 'reg-doc-a').teamKey).toBe('B');
    const pending = app._tsTeamSplitPendingOps.get(event.id);
    expect(pending).toBeTruthy();

    deferred.reject(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    await pending;

    expect(updatedCache.find(row => row._docId === 'reg-doc-a').teamKey).toBe('A');
    expect(app.showToast).toHaveBeenCalledWith(expect.stringContaining('\u5206\u968a\u6b0a\u9650'));
    consoleErrorSpy.mockRestore();
  });

  test('reset writes only assigned confirmed or waitlisted registrations by real doc id', async () => {
    const event = createEvent();
    const serverRows = [
      { _docId: 'reg-doc-a', eventId: event.id, status: 'confirmed', teamKey: 'A' },
      { _docId: 'reg-doc-b', eventId: event.id, status: 'waitlisted', teamKey: 'B' },
      { _docId: 'reg-doc-c', eventId: event.id, status: 'cancelled', teamKey: 'A' },
      { _docId: 'reg-doc-d', eventId: event.id, status: 'confirmed', teamKey: null },
    ];
    const { app, db, timestampSentinel } = loadTeamSplitModule({ event, serverRows });

    await app._tsBatchReset(event.id);

    expect(db.writes.map(write => write.ref.path)).toEqual([
      'events/evt-doc/registrations/reg-doc-a',
      'events/evt-doc/registrations/reg-doc-b',
    ]);
    expect(db.writes.map(write => write.payload)).toEqual([
      { teamKey: null, updatedAt: timestampSentinel },
      { teamKey: null, updatedAt: timestampSentinel },
    ]);
  });

  test('random split fetches writable registration docs instead of relying on projected cache rows', async () => {
    const event = createEvent();
    const cacheRows = [
      { id: 'projected-a', eventId: event.id, status: 'confirmed', teamKey: null },
      { id: 'projected-b', eventId: event.id, status: 'confirmed', teamKey: null },
    ];
    const serverRows = [
      { _docId: 'reg-doc-a', id: 'projected-a', eventId: event.id, status: 'confirmed', teamKey: null },
      { _docId: 'reg-doc-b', id: 'projected-b', eventId: event.id, status: 'confirmed', teamKey: null },
    ];
    const { app, db } = loadTeamSplitModule({ event, cacheRows, serverRows, random: () => 0 });

    await app._tsBatchRandom(event.id);

    expect(db.get).toHaveBeenCalledTimes(1);
    const writesByPath = Object.fromEntries(db.writes.map(write => [write.ref.path, write.payload.teamKey]));
    expect(Object.keys(writesByPath).sort()).toEqual([
      'events/evt-doc/registrations/reg-doc-a',
      'events/evt-doc/registrations/reg-doc-b',
    ]);
    expect(new Set(Object.values(writesByPath))).toEqual(new Set(['A', 'B']));
  });
});
