const {
  PROFILE_POPULARITY_COLLECTION,
  PROFILE_VIEWERS_SUBCOLLECTION,
  createRecordProfileViewCallable,
  createRecordProfileViewHandler,
  normalizeProfileViews,
} = require('../../functions/profile-view-count');

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

// 以路徑字串當 key 的 in-memory Firestore：支援 collection/doc/collection/doc 巢狀。
function createMemoryFirestore(initialDocs = {}) {
  const store = new Map(Object.entries(initialDocs).map(([path, data]) => [path, clone(data)]));
  const operationBatches = [];
  let transactionQueue = Promise.resolve();

  function docRef(path) {
    return {
      path,
      collection: name => ({ doc: id => docRef(`${path}/${name}/${id}`) }),
    };
  }

  const db = {
    collection: jest.fn(name => ({ doc: id => docRef(`${name}/${id}`) })),
    runTransaction: jest.fn(callback => {
      const run = async () => {
        const operations = [];
        const writes = [];
        const transaction = {
          get: jest.fn(async ref => {
            operations.push(`get:${ref.path}`);
            const data = store.get(ref.path);
            return { exists: typeof data !== 'undefined', data: () => clone(data) };
          }),
          create: jest.fn((ref, data) => {
            operations.push(`create:${ref.path}`);
            writes.push({ type: 'create', path: ref.path, data: clone(data) });
          }),
          set: jest.fn((ref, data) => {
            operations.push(`set:${ref.path}`);
            writes.push({ type: 'set', path: ref.path, data: clone(data) });
          }),
        };
        const result = await callback(transaction);
        writes.forEach(write => {
          if (write.type === 'create' && store.has(write.path)) {
            const error = new Error('already exists');
            error.code = 'already-exists';
            throw error;
          }
          store.set(write.path, clone(write.data));
        });
        operationBatches.push(operations);
        return result;
      };
      const result = transactionQueue.then(run, run);
      transactionQueue = result.catch(() => {});
      return result;
    }),
  };

  return { db, store, operationBatches };
}

const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);
const parentPath = uid => `${PROFILE_POPULARITY_COLLECTION}/${uid}`;
const viewerPath = (target, viewer) => `${parentPath(target)}/${PROFILE_VIEWERS_SUBCOLLECTION}/${viewer}`;

function createHarness(docs = { 'users/target-1': { name: 'T' } }) {
  const memory = createMemoryFirestore(docs);
  const logger = { error: jest.fn() };
  const handler = createRecordProfileViewHandler({
    db: memory.db,
    HttpsError: FakeHttpsError,
    now: () => NOW,
    logger,
  });
  const call = (uid = 'viewer-a', data = { targetUid: 'target-1' }) => (
    handler({ auth: uid ? { uid } : null, data })
  );
  return { ...memory, call, handler, logger };
}

describe('recordProfileView callable（人氣指數：不同的人看過）', () => {
  test('未登入直接拒絕、不進交易', async () => {
    const h = createHarness();
    await expect(h.call('')).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(h.db.runTransaction).not.toHaveBeenCalled();
  });

  test('targetUid 不合法直接拒絕、不進交易', async () => {
    const h = createHarness();
    for (const data of [
      {},
      { targetUid: '' },
      { targetUid: 123 },
      { targetUid: 'a/b' },
      { targetUid: '../x' },
      { targetUid: 'x'.repeat(129) },
      { targetUid: '__reserved__' },
    ]) {
      await expect(h.call('viewer-a', data)).rejects.toMatchObject({ code: 'invalid-argument' });
    }
    expect(h.db.runTransaction).not.toHaveBeenCalled();
  });

  test('自己看自己：回 self，不進交易、不產生任何讀寫', async () => {
    const h = createHarness();
    await expect(h.call('target-1')).resolves.toEqual({ status: 'self' });
    expect(h.db.runTransaction).not.toHaveBeenCalled();
    expect(h.store.has(parentPath('target-1'))).toBe(false);
  });

  test('第一次看：counted，views 0→1，去重文件只有 viewerUid 與 firstSeenAt（無 expireAt）', async () => {
    const h = createHarness();
    await expect(h.call('viewer-a')).resolves.toEqual({ status: 'counted', views: 1 });
    expect(h.store.get(parentPath('target-1'))).toEqual({ views: 1, updatedAt: new Date(NOW) });
    const marker = h.store.get(viewerPath('target-1', 'viewer-a'));
    expect(Object.keys(marker).sort()).toEqual(['firstSeenAt', 'viewerUid']);
    expect(marker.viewerUid).toBe('viewer-a');
    expect(marker).not.toHaveProperty('expireAt');
    expect(marker).not.toHaveProperty('lastDay');
  });

  test('既有 views 7 → 8；缺值、非法值視為 0', async () => {
    const seven = createHarness({
      'users/target-1': {},
      [parentPath('target-1')]: { views: 7 },
    });
    await expect(seven.call()).resolves.toEqual({ status: 'counted', views: 8 });
    const bad = createHarness({
      'users/target-1': {},
      [parentPath('target-1')]: { views: 'abc' },
    });
    await expect(bad.call()).resolves.toEqual({ status: 'counted', views: 1 });
    expect([normalizeProfileViews(undefined), normalizeProfileViews(-3), normalizeProfileViews('12'), normalizeProfileViews(4.9)])
      .toEqual([0, 0, 12, 4]);
  });

  test('同一個觀看者看第二次（不論隔多久）：already，views 不再增加，且不再讀 users', async () => {
    const h = createHarness();
    await h.call('viewer-a');
    h.operationBatches.length = 0;
    await expect(h.call('viewer-a')).resolves.toEqual({ status: 'already' });
    expect(h.store.get(parentPath('target-1')).views).toBe(1);
    expect(h.operationBatches[0]).toEqual([`get:${viewerPath('target-1', 'viewer-a')}`]);
  });

  test('不同觀看者各加 1', async () => {
    const h = createHarness();
    await h.call('viewer-a');
    await expect(h.call('viewer-b')).resolves.toEqual({ status: 'counted', views: 2 });
    await expect(h.call('viewer-c')).resolves.toEqual({ status: 'counted', views: 3 });
    expect(h.store.get(parentPath('target-1')).views).toBe(3);
  });

  test('同一觀看者同時送多次：只增加一次', async () => {
    const h = createHarness();
    const results = await Promise.all([h.call(), h.call(), h.call()]);
    expect(results.filter(r => r.status === 'counted')).toHaveLength(1);
    expect(results.filter(r => r.status === 'already')).toHaveLength(2);
    expect(h.store.get(parentPath('target-1')).views).toBe(1);
  });

  test('被看者 users 不存在：not-found，不寫任何文件', async () => {
    const h = createHarness({});
    await expect(h.call('viewer-a', { targetUid: 'ghost' })).rejects.toMatchObject({ code: 'not-found' });
    expect(h.store.size).toBe(0);
  });

  test('不讀觀看者的 users 文件（沒有管理員／新帳號排除）', async () => {
    const h = createHarness();
    await h.call('viewer-a');
    expect(h.operationBatches[0].some(op => op === 'get:users/viewer-a')).toBe(false);
  });

  test('交易內所有 get 都在第一個寫入之前', async () => {
    const h = createHarness();
    await h.call();
    const ops = h.operationBatches[0];
    const firstWrite = ops.findIndex(op => /^(create|set):/.test(op));
    expect(firstWrite).toBeGreaterThan(0);
    expect(ops.slice(firstWrite).some(op => op.startsWith('get:'))).toBe(false);
    expect(ops).toEqual([
      `get:${viewerPath('target-1', 'viewer-a')}`,
      'get:users/target-1',
      `get:${parentPath('target-1')}`,
      `create:${viewerPath('target-1', 'viewer-a')}`,
      `set:${parentPath('target-1')}`,
    ]);
  });

  test('非 HttpsError 的錯誤包成 unavailable，log 不含 uid 原文', async () => {
    const h = createHarness();
    h.db.runTransaction.mockImplementationOnce(async () => {
      const error = new Error('boom');
      error.code = 'aborted';
      throw error;
    });
    await expect(h.call('viewer-secret', { targetUid: 'target-secret' })).rejects.toMatchObject({
      code: 'unavailable',
      message: 'PROFILE_VIEW_COUNT_UNAVAILABLE',
    });
    const logged = JSON.stringify(h.logger.error.mock.calls);
    expect(logged).not.toContain('viewer-secret');
    expect(logged).not.toContain('target-secret');
    expect(logged).toContain('aborted');
  });

  test('commit 時 create 去重文件遇到 already-exists（並發）：回 already，不當成錯誤、不記 error log', async () => {
    for (const code of ['already-exists', 6]) {
      const h = createHarness();
      h.db.runTransaction.mockImplementationOnce(async () => {
        const error = new Error('already exists');
        error.code = code;
        throw error;
      });
      await expect(h.call()).resolves.toEqual({ status: 'already' });
      expect(h.logger.error).not.toHaveBeenCalled();
    }
  });

  test('createRecordProfileViewCallable 用 asia-east1、最小執行個體 0 呼叫 onCall', () => {
    const onCall = jest.fn((options, handler) => ({ options, handler }));
    const callable = createRecordProfileViewCallable({
      onCall,
      db: createMemoryFirestore().db,
      HttpsError: FakeHttpsError,
    });
    expect(onCall).toHaveBeenCalledTimes(1);
    expect(callable.options).toEqual({ region: 'asia-east1', minInstances: 0 });
    expect(typeof callable.handler).toBe('function');
    expect(() => createRecordProfileViewCallable({ db: {}, HttpsError: FakeHttpsError })).toThrow(TypeError);
  });
});
