const {
  MARKER_COLLECTION,
  buildViewMarkerId,
  createIncrementEventViewCountCallable,
  createIncrementEventViewCountHandler,
  getTaipeiDayKey,
  normalizeLegacyViewCount,
  isIncrementSafeViewCount,
} = require('../../functions/event-view-count');
// 86450431b 版（O3 修正前、每次都開交易）原封不動的凍結副本，只供行為等價對照。
const legacyModule = require('./fixtures/event-view-count-legacy-86450431b');

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

// 模擬 FieldValue.increment：欄位是數字才相加，否則（含不存在、字串）直接設成增量值（Firestore 語意）。
const FakeFieldValue = {
  increment: jest.fn(amount => ({ __increment: amount })),
};

function applyUpdate(previous, data) {
  const next = { ...previous };
  Object.entries(data).forEach(([key, value]) => {
    if (value && typeof value === 'object' && '__increment' in value) {
      next[key] = typeof previous[key] === 'number' ? previous[key] + value.__increment : value.__increment;
    } else {
      next[key] = clone(value);
    }
  });
  return next;
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
            ? applyUpdate(previous, write.data)
            : clone(write.data));
        });
        operationBatches.push(operations);
        return result;
      };

      const result = transactionQueue.then(run, run);
      transactionQueue = result.catch(() => {});
      return result;
    }),
    getAll: jest.fn(async (...documentRefs) => {
      operationBatches.push([`getAll:${documentRefs.map(item => item.collectionName).join(',')}`]);
      return documentRefs.map(readSnapshot);
    }),
    batch: jest.fn(() => {
      const writes = [];
      return {
        create: jest.fn((documentRef, data) => { writes.push({ type: 'create', documentRef, data }); }),
        update: jest.fn((documentRef, data) => { writes.push({ type: 'update', documentRef, data }); }),
        commit: jest.fn(async () => {
          if (db.failNextCommit) {
            const error = db.failNextCommit;
            db.failNextCommit = null;
            throw error;
          }
          // 原子：先全部檢查，任一失敗整批不寫。
          writes.forEach(write => {
            const store = write.documentRef.collectionName === 'events' ? events : markers;
            if (write.type === 'create' && store.has(write.documentRef.id)) {
              const error = new Error('already exists');
              error.code = 6;
              throw error;
            }
            if (write.type === 'update' && !store.has(write.documentRef.id)) {
              const error = new Error('no document to update');
              error.code = 5;
              throw error;
            }
          });
          writes.forEach(write => {
            const store = write.documentRef.collectionName === 'events' ? events : markers;
            store.set(write.documentRef.id, write.type === 'update'
              ? applyUpdate(store.get(write.documentRef.id) || {}, write.data)
              : clone(write.data));
          });
          operationBatches.push([`batch:${writes.map(write => `${write.type}:${write.documentRef.collectionName}`).join(',')}`]);
        }),
      };
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
    FieldValue: FakeFieldValue,
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
    expect(harness.db.getAll).not.toHaveBeenCalled();
    expect(harness.db.batch).not.toHaveBeenCalled();
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
    // O3：不開交易（不持活動主文件讀鎖），一次 getAll 讀兩份，再以 batch 原子寫入標記＋increment(1)。
    expect(harness.db.runTransaction).not.toHaveBeenCalled();
    expect(FakeFieldValue.increment).toHaveBeenCalledWith(1);
    expect(harness.operationBatches).toEqual([
      [`getAll:events,${MARKER_COLLECTION}`],
      [`batch:create:${MARKER_COLLECTION},update:events`],
    ]);
  });

  test('an existing marker returns the current count without any write or transaction', async () => {
    const harness = createHarness();
    await harness.call();
    harness.db.batch.mockClear();

    await expect(harness.call()).resolves.toEqual({ incremented: false, viewCount: 5 });
    expect(harness.db.batch).not.toHaveBeenCalled();
    expect(harness.db.runTransaction).not.toHaveBeenCalled();
    expect(harness.operationBatches.slice(-1)).toEqual([[`getAll:events,${MARKER_COLLECTION}`]]);
  });

  test('a pre-existing marker for this viewer and day blocks the increment', async () => {
    const harness = createHarness();
    const markerId = buildViewMarkerId('viewer-a', 'event-public', '2026-07-17');
    harness.markers.set(markerId, { eventId: 'event-public', eventDocId: 'event-doc', dayKey: '2026-07-17' });

    await expect(harness.call()).resolves.toEqual({ incremented: false, viewCount: 4 });
    expect(harness.events.get('event-doc').viewCount).toBe(4);
    expect(harness.markers.size).toBe(1);
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
    ['negative legacy count', -3, 1],
    ['fractional legacy count', 2.5, 3],
    ['null legacy count', null, 1],
  ])('normalizes %s exactly like the legacy transaction', async (_label, initial, expected) => {
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

  test('sanitizes unexpected read failures and does not log UID', async () => {
    const db = {
      collection: jest.fn(() => ({ doc: jest.fn(id => ({ id })) })),
      runTransaction: jest.fn(),
      batch: jest.fn(),
      getAll: jest.fn(async () => {
        const error = new Error('backend exploded for viewer-secret');
        error.code = 'internal';
        throw error;
      }),
    };
    const logger = { error: jest.fn() };
    const handler = createIncrementEventViewCountHandler({
      db,
      HttpsError: FakeHttpsError,
      FieldValue: FakeFieldValue,
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
      expect.objectContaining({ errorCode: 'internal', stage: 'read' }),
    );
    expect(db.batch).not.toHaveBeenCalled();
  });

  test('a failed batch commit writes neither the marker nor the increment and can be retried', async () => {
    const harness = createHarness();
    const failure = new Error('deadline for viewer-a');
    failure.code = 'deadline-exceeded';
    harness.db.failNextCommit = failure;

    await expect(harness.call()).rejects.toMatchObject({
      code: 'unavailable',
      message: 'EVENT_VIEW_COUNT_UNAVAILABLE',
    });
    expect(harness.events.get('event-doc').viewCount).toBe(4);
    expect(harness.markers.size).toBe(0);
    expect(JSON.stringify(harness.logger.error.mock.calls)).not.toContain('viewer-a');
    expect(harness.logger.error).toHaveBeenCalledWith(
      '[incrementEventViewCount] transaction failed',
      expect.objectContaining({ errorCode: 'deadline-exceeded', stage: 'batch' }),
    );

    // 沒留下標記，同一人同一天再開一次仍會正常 +1（不會永久少算）。
    await expect(harness.call()).resolves.toEqual({ incremented: true, viewCount: 5 });
    expect(harness.markers.size).toBe(1);
  });

  test('an event deleted between read and commit returns not-found and leaves no marker', async () => {
    const harness = createHarness();
    const originalGetAll = harness.db.getAll.getMockImplementation();
    harness.db.getAll.mockImplementationOnce(async (...refs) => {
      const snapshots = await originalGetAll(...refs);
      harness.events.delete('event-doc');
      return snapshots;
    });

    await expect(harness.call()).rejects.toMatchObject({ code: 'not-found' });
    expect(harness.markers.size).toBe(0);
  });

  test('legacy non-integer counts keep using the original transaction path', async () => {
    const harness = createHarness({ events: { 'event-doc': { id: 'event-public', viewCount: '9' } } });

    await expect(harness.call()).resolves.toEqual({ incremented: true, viewCount: 10 });
    expect(harness.db.runTransaction).toHaveBeenCalledTimes(1);
    expect(harness.db.batch).not.toHaveBeenCalled();
    expect(harness.events.get('event-doc').viewCount).toBe(10);
    // 轉成整數後，下一位觀看者改走 batch。
    await expect(harness.call('viewer-b')).resolves.toEqual({ incremented: true, viewCount: 11 });
    expect(harness.db.runTransaction).toHaveBeenCalledTimes(1);
    expect(harness.db.batch).toHaveBeenCalledTimes(1);
  });

  test('only missing or non-negative safe integers use increment', () => {
    expect(isIncrementSafeViewCount(undefined)).toBe(true);
    expect(isIncrementSafeViewCount(0)).toBe(true);
    expect(isIncrementSafeViewCount(42)).toBe(true);
    [null, '9', -1, 2.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, {}].forEach(value => {
      expect(isIncrementSafeViewCount(value)).toBe(false);
    });
  });

  test('registers in the canonical callable region', () => {
    const { db } = createMemoryFirestore();
    const onCall = jest.fn((options, handler) => ({ options, handler }));

    const callable = createIncrementEventViewCountCallable({
      onCall,
      db,
      HttpsError: FakeHttpsError,
      FieldValue: FakeFieldValue,
    });

    expect(callable.options).toEqual({ region: 'asia-east1' });
    expect(typeof callable.handler).toBe('function');
  });

  test.each([
    ['getAll', { omitGetAll: true, withFieldValue: true }],
    ['batch', { omitBatch: true, withFieldValue: true }],
    ['FieldValue', { withFieldValue: false }],
  ])('missing %s does not throw at load time and returns internal when called', async (_label, options) => {
    const db = {
      collection: jest.fn(() => ({ doc: jest.fn(id => ({ id })) })),
      runTransaction: jest.fn(),
    };
    if (!options.omitGetAll) db.getAll = jest.fn();
    if (!options.omitBatch) db.batch = jest.fn();
    const logger = { error: jest.fn() };
    let handler;
    expect(() => {
      handler = createIncrementEventViewCountHandler({
        db,
        HttpsError: FakeHttpsError,
        FieldValue: options.withFieldValue ? FakeFieldValue : undefined,
        logger,
      });
    }).not.toThrow();

    await expect(handler({
      auth: { uid: 'viewer-secret' },
      data: { eventId: 'event-public', docId: 'event-doc' },
    })).rejects.toMatchObject({ code: 'internal', message: 'EVENT_VIEW_COUNT_MISCONFIGURED' });
    expect(logger.error).toHaveBeenCalledWith(
      '[incrementEventViewCount] missing dependency',
      expect.objectContaining({ hasGetAll: expect.any(Boolean), hasBatch: expect.any(Boolean) }),
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('viewer-secret');
    expect(db.runTransaction).not.toHaveBeenCalled();
    if (db.getAll) expect(db.getAll).not.toHaveBeenCalled();
  });

  test('marker hashes are deterministic without exposing their inputs', () => {
    const marker = buildViewMarkerId('viewer-a', 'event-public', '2026-07-17');
    expect(marker).toBe(buildViewMarkerId('viewer-a', 'event-public', '2026-07-17'));
    expect(marker).not.toBe(buildViewMarkerId('viewer-b', 'event-public', '2026-07-17'));
    expect(marker).not.toContain('viewer-a');
    expect(normalizeLegacyViewCount(undefined)).toBe(0);
  });
});

describe('incrementEventViewCount behaviour parity with 86450431b (pre-O3 transaction)', () => {
  const DAY_1 = Date.UTC(2026, 6, 16, 16, 0, 0);
  const DAY_2 = Date.UTC(2026, 6, 17, 16, 0, 0);
  const INITIAL_EVENTS = {
    'doc-int': { id: 'ev-int', viewCount: 7 },
    'doc-missing': { id: 'ev-missing' },
    'doc-zero': { id: 'ev-zero', viewCount: 0 },
    'doc-str': { id: 'ev-str', viewCount: '9' },
    'doc-bad': { id: 'ev-bad', viewCount: 'invalid' },
    'doc-neg': { id: 'ev-neg', viewCount: -3 },
    'doc-frac': { id: 'ev-frac', viewCount: 2.5 },
    'doc-null': { id: 'ev-null', viewCount: null },
    'doc-mismatch': { id: 'other', viewCount: 1 },
  };
  // [uid, eventId, docId, now]
  const SCENARIO = [];
  const pairs = [
    ['ev-int', 'doc-int'], ['ev-missing', 'doc-missing'], ['ev-zero', 'doc-zero'],
    ['ev-str', 'doc-str'], ['ev-bad', 'doc-bad'], ['ev-neg', 'doc-neg'],
    ['ev-frac', 'doc-frac'], ['ev-null', 'doc-null'],
  ];
  [DAY_1, DAY_2].forEach(day => {
    ['viewer-a', 'viewer-b', 'viewer-a', 'viewer-c', 'viewer-b'].forEach(uid => {
      pairs.forEach(([eventId, docId]) => SCENARIO.push([uid, eventId, docId, day]));
    });
  });
  SCENARIO.push(['viewer-a', 'ev-mismatch', 'doc-mismatch', DAY_1]);
  SCENARIO.push(['viewer-a', 'ev-gone', 'doc-gone', DAY_1]);
  SCENARIO.push(['', 'ev-int', 'doc-int', DAY_1]);
  SCENARIO.push(['viewer-a', '../x', 'doc-int', DAY_1]);

  async function runScenario(createHandler) {
    const memory = createMemoryFirestore(INITIAL_EVENTS);
    let currentNow = DAY_1;
    const handler = createHandler({
      db: memory.db,
      HttpsError: FakeHttpsError,
      FieldValue: FakeFieldValue,
      now: () => currentNow,
      logger: { error: jest.fn() },
    });
    const outcomes = [];
    for (const [uid, eventId, docId, day] of SCENARIO) {
      currentNow = day;
      try {
        outcomes.push({ ok: await handler({ auth: uid ? { uid } : null, data: { eventId, docId } }) });
      } catch (error) {
        outcomes.push({ error: error.code });
      }
    }
    const markers = Object.fromEntries([...memory.markers.entries()].sort(([a], [b]) => a.localeCompare(b)));
    return { outcomes, events: Object.fromEntries(memory.events), markers };
  }

  test('same inputs give the same results, final counts and markers', async () => {
    const legacy = await runScenario(legacyModule.createIncrementEventViewCountHandler);
    const current = await runScenario(createIncrementEventViewCountHandler);

    expect(current.outcomes).toEqual(legacy.outcomes);
    expect(current.events).toEqual(legacy.events);
    expect(current.markers).toEqual(legacy.markers);
    // 防呆：對照組確實涵蓋加一、去重、錯誤三種結果。
    expect(legacy.outcomes.filter(item => item.ok?.incremented)).toHaveLength(48);
    expect(legacy.outcomes.filter(item => item.ok && !item.ok.incremented)).toHaveLength(32);
    expect(legacy.outcomes.filter(item => item.error).map(item => item.error)).toEqual([
      'failed-precondition', 'not-found', 'unauthenticated', 'invalid-argument',
    ]);
    expect(Object.keys(current.markers)).toHaveLength(48);
    Object.values(current.events).forEach(event => {
      expect(Number.isSafeInteger(event.viewCount)).toBe(true);
    });
  });

  test('concurrent first views by different viewers lose no increments', async () => {
    const harness = createHarness();
    const results = await Promise.all(['v1', 'v2', 'v3', 'v4'].map(uid => harness.call(uid)));

    expect(results.every(result => result.incremented)).toBe(true);
    expect(harness.events.get('event-doc').viewCount).toBe(8);
    expect(harness.markers.size).toBe(4);
  });
});
