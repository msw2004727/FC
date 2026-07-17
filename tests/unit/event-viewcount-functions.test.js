const {
  MARKER_COLLECTION,
  buildViewMarkerId,
  createIncrementEventViewCountCallable,
  createIncrementEventViewCountHandler,
  getTaipeiDayKey,
  normalizeLegacyViewCount,
} = require('../../functions/event-view-count');

class FakeHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function clone(value) {
  if (value instanceof Date) return new Date(value.getTime());
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(clone);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
}

function createMemoryFirestore(initialEvents = {}) {
  const events = new Map(
    Object.entries(initialEvents).map(([id, data]) => [id, clone(data)]),
  );
  const markers = new Map();
  const operationBatches = [];
  let transactionQueue = Promise.resolve();

  function ref(collectionName, id) {
    return { collectionName, id };
  }

  function readSnapshot(documentRef) {
    const store = documentRef.collectionName === 'events' ? events : markers;
    const data = store.get(documentRef.id);
    return {
      id: documentRef.id,
      exists: typeof data !== 'undefined',
      data: () => clone(data),
    };
  }

  const db = {
    collection: jest.fn(collectionName => ({
      doc: jest.fn(id => ref(collectionName, id)),
    })),
    runTransaction: jest.fn(callback => {
      const run = async () => {
        const operations = [];
        const writes = [];
        const transaction = {
          get: jest.fn(async documentRef => {
            operations.push(`get:${documentRef.collectionName}`);
            return readSnapshot(documentRef);
          }),
          create: jest.fn((documentRef, data) => {
            operations.push(`create:${documentRef.collectionName}`);
            writes.push({ type: 'create', documentRef, data: clone(data) });
          }),
          update: jest.fn((documentRef, data) => {
            operations.push(`update:${documentRef.collectionName}`);
            writes.push({ type: 'update', documentRef, data: clone(data) });
          }),
        };
        const result = await callback(transaction);
        writes.forEach(write => {
          const store = write.documentRef.collectionName === 'events' ? events : markers;
          if (write.type === 'create' && store.has(write.documentRef.id)) {
            const error = new Error('already exists');
            error.code = 'already-exists';
            throw error;
          }
          const previous = store.get(write.documentRef.id) || {};
          store.set(write.documentRef.id, write.type === 'update'
            ? { ...previous, ...clone(write.data) }
            : clone(write.data));
        });
        operationBatches.push(operations);
        return result;
      };

      const result = transactionQueue.then(run, run);
      transactionQueue = result.catch(() => {});
      return result;
    }),
  };

  return { db, events, markers, operationBatches };
}

function createHarness({ events, now = Date.UTC(2026, 6, 16, 16, 0, 0) } = {}) {
  const memory = createMemoryFirestore(events || {
    'event-doc': { id: 'event-public', viewCount: 4 },
  });
  let currentNow = now;
  const logger = { error: jest.fn() };
  const handler = createIncrementEventViewCountHandler({
    db: memory.db,
    HttpsError: FakeHttpsError,
    now: () => currentNow,
    logger,
  });
  const call = (uid = 'viewer-a', data = { eventId: 'event-public', docId: 'event-doc' }) => (
    handler({ auth: uid ? { uid } : null, data })
  );
  return {
    ...memory,
    call,
    handler,
    logger,
    setNow(value) { currentNow = value; },
  };
}

describe('incrementEventViewCount callable', () => {
  test('uses an Asia/Taipei calendar day at the UTC boundary', () => {
    expect(getTaipeiDayKey(Date.UTC(2026, 6, 16, 15, 59, 59))).toBe('2026-07-16');
    expect(getTaipeiDayKey(Date.UTC(2026, 6, 16, 16, 0, 0))).toBe('2026-07-17');
  });

  test('rejects unauthenticated and invalid event identifiers before a transaction', async () => {
    const harness = createHarness();

    await expect(harness.call('')).rejects.toMatchObject({ code: 'unauthenticated' });
    for (const data of [
      {},
      { eventId: 'event-public' },
      { eventId: '../event', docId: 'event-doc' },
      { eventId: 'event-public', docId: 'events/event-doc' },
      { eventId: 'x'.repeat(121), docId: 'event-doc' },
    ]) {
      await expect(harness.call('viewer-a', data)).rejects.toMatchObject({
        code: 'invalid-argument',
      });
    }
    expect(harness.db.runTransaction).not.toHaveBeenCalled();
  });

  test('creates a private hashed marker and increments exactly once', async () => {
    const harness = createHarness();
    const result = await harness.call();

    expect(result).toEqual({ incremented: true, viewCount: 5 });
    expect(Object.keys(result).sort()).toEqual(['incremented', 'viewCount']);
    expect(harness.events.get('event-doc').viewCount).toBe(5);
    expect(harness.markers).toHaveProperty('size', 1);

    const [[markerId, marker]] = [...harness.markers.entries()];
    expect(markerId).toMatch(/^[a-f0-9]{64}$/);
    expect(markerId).not.toContain('viewer-a');
    expect(marker).toMatchObject({
      eventId: 'event-public',
      eventDocId: 'event-doc',
      dayKey: '2026-07-17',
    });
    expect(JSON.stringify(marker)).not.toContain('viewer-a');
    expect(harness.operationBatches[0]).toEqual([
      'get:events',
      `get:${MARKER_COLLECTION}`,
      `create:${MARKER_COLLECTION}`,
      'update:events',
    ]);
  });

  test('same UID, event and Taipei day is idempotent', async () => {
    const harness = createHarness();

    await expect(harness.call()).resolves.toEqual({ incremented: true, viewCount: 5 });
    await expect(harness.call()).resolves.toEqual({ incremented: false, viewCount: 5 });
    expect(harness.events.get('event-doc').viewCount).toBe(5);
    expect(harness.markers.size).toBe(1);
  });

  test('concurrent duplicate requests commit only one increment', async () => {
    const harness = createHarness();

    const results = await Promise.all([harness.call(), harness.call(), harness.call()]);
    expect(results.filter(result => result.incremented)).toHaveLength(1);
    expect(results.filter(result => !result.incremented)).toHaveLength(2);
    expect(results.every(result => result.viewCount === 5)).toBe(true);
    expect(harness.events.get('event-doc').viewCount).toBe(5);
    expect(harness.markers.size).toBe(1);
  });

  test('a different UID or Taipei day gets its own increment', async () => {
    const harness = createHarness();

    await harness.call('viewer-a');
    await expect(harness.call('viewer-b')).resolves.toEqual({ incremented: true, viewCount: 6 });
    harness.setNow(Date.UTC(2026, 6, 17, 16, 0, 0));
    await expect(harness.call('viewer-a')).resolves.toEqual({ incremented: true, viewCount: 7 });
    expect(harness.markers.size).toBe(3);
  });

  test.each([
    ['missing count', undefined, 1],
    ['numeric legacy string', '9', 10],
    ['invalid legacy count', 'invalid', 1],
  ])('normalizes %s inside the transaction', async (_label, initial, expected) => {
    const event = { id: 'event-public' };
    if (typeof initial !== 'undefined') event.viewCount = initial;
    const harness = createHarness({ events: { 'event-doc': event } });

    await expect(harness.call()).resolves.toEqual({
      incremented: true,
      viewCount: expected,
    });
    expect(harness.events.get('event-doc').viewCount).toBe(expected);
  });

  test('rejects missing events and logical ID mismatches without writing markers', async () => {
    const missing = createHarness({ events: {} });
    await expect(missing.call()).rejects.toMatchObject({ code: 'not-found' });
    expect(missing.markers.size).toBe(0);

    const mismatch = createHarness({
      events: { 'event-doc': { id: 'different-event', viewCount: 8 } },
    });
    await expect(mismatch.call()).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(mismatch.events.get('event-doc').viewCount).toBe(8);
    expect(mismatch.markers.size).toBe(0);
  });

  test('sanitizes unexpected transaction failures and does not log UID', async () => {
    const db = {
      collection: jest.fn(() => ({ doc: jest.fn(id => ({ id })) })),
      runTransaction: jest.fn(async () => {
        const error = new Error('backend exploded for viewer-secret');
        error.code = 'internal';
        throw error;
      }),
    };
    const logger = { error: jest.fn() };
    const handler = createIncrementEventViewCountHandler({
      db,
      HttpsError: FakeHttpsError,
      logger,
    });

    await expect(handler({
      auth: { uid: 'viewer-secret' },
      data: { eventId: 'event-public', docId: 'event-doc' },
    })).rejects.toMatchObject({
      code: 'unavailable',
      message: 'EVENT_VIEW_COUNT_UNAVAILABLE',
    });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('viewer-secret');
    expect(logger.error).toHaveBeenCalledWith(
      '[incrementEventViewCount] transaction failed',
      expect.objectContaining({ errorCode: 'internal' }),
    );
  });

  test('registers in the canonical callable region', () => {
    const { db } = createMemoryFirestore();
    const onCall = jest.fn((options, handler) => ({ options, handler }));

    const callable = createIncrementEventViewCountCallable({
      onCall,
      db,
      HttpsError: FakeHttpsError,
    });

    expect(callable.options).toEqual({ region: 'asia-east1' });
    expect(typeof callable.handler).toBe('function');
  });

  test('marker hashes are deterministic without exposing their inputs', () => {
    const marker = buildViewMarkerId('viewer-a', 'event-public', '2026-07-17');
    expect(marker).toBe(buildViewMarkerId('viewer-a', 'event-public', '2026-07-17'));
    expect(marker).not.toBe(buildViewMarkerId('viewer-b', 'event-public', '2026-07-17'));
    expect(marker).not.toContain('viewer-a');
    expect(normalizeLegacyViewCount(undefined)).toBe(0);
  });
});
