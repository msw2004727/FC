const {
  createListUserDirectoryCallable,
  createListUserDirectoryHandler,
  projectUserDirectoryEntry,
} = require('../../functions/user-directory');

class FakeHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function fakeDoc(id, data) {
  return {
    id,
    exists: true,
    data: () => (typeof data === 'function' ? data() : data),
  };
}

function createFakeDb(docs, exactDocs = {}, options = {}) {
  const get = jest.fn(options.getImpl || (async () => ({ docs })));
  const exactGet = jest.fn(async (uid) => {
    const hasDocument = Object.prototype.hasOwnProperty.call(exactDocs, uid);
    const value = hasDocument ? exactDocs[uid] : null;
    const data = typeof value === 'function' ? value() : value;
    if (data === null || typeof data === 'undefined') {
      return { id: uid, exists: false, data: () => undefined };
    }
    return fakeDoc(uid, data);
  });
  const doc = jest.fn(uid => ({ get: () => exactGet(uid) }));
  const queryGet = jest.fn(async (field, value, limitValue) => {
    if (options.queryError) throw options.queryError;
    const configuredDocs = typeof options.queryDocs === 'function'
      ? options.queryDocs()
      : (options.queryDocs || docs);
    const candidates = new Map(configuredDocs.map(candidate => [candidate.id, candidate]));
    Object.keys(exactDocs).forEach((uid) => {
      const configured = exactDocs[uid];
      const data = typeof configured === 'function' ? configured() : configured;
      if (data === null || typeof data === 'undefined') candidates.delete(uid);
      else candidates.set(uid, fakeDoc(uid, data));
    });
    return {
      docs: [...candidates.values()]
        .filter(candidate => candidate.data()?.[field] === value)
        .slice(0, limitValue),
    };
  });
  const limits = [];
  const where = jest.fn((field, operator, value) => {
    const limit = jest.fn(limitValue => ({
      get: () => queryGet(field, value, limitValue),
    }));
    limits.push(limit);
    return { limit };
  });
  const collection = jest.fn(() => ({ get, doc, where }));
  return {
    db: { collection }, collection, doc, exactGet, get, limits, queryGet, where,
  };
}

describe('user directory callable', () => {
  test('projects an exact public allowlist without leaking sensitive fields', () => {
    const projected = projectUserDirectoryEntry({
      uid: 'U-1',
      name: 'Legacy Name',
      displayName: 'Visible Name',
      pictureUrl: 'https://example.test/avatar.png',
      role: 'coach',
      email: 'private@example.test',
      phone: '0900-000-000',
      birthday: '1990-01-01',
      lineAccessToken: 'secret-token',
      permissions: ['admin.users.entry'],
    }, 'ignored-doc-id');

    expect(projected).toEqual({
      uid: 'U-1',
      name: 'Legacy Name',
      displayName: 'Visible Name',
      pictureUrl: 'https://example.test/avatar.png',
      role: 'coach',
    });
    expect(Object.keys(projected).sort()).toEqual([
      'displayName',
      'name',
      'pictureUrl',
      'role',
      'uid',
    ]);
  });

  test.each(['admin', 'super_admin'])(
    'projects a stealth %s role as user',
    (role) => {
      expect(projectUserDirectoryEntry({
        uid: 'U-' + role,
        displayName: 'Hidden Staff',
        role,
        stealth: true,
      })).toMatchObject({ role: 'user' });
    },
  );

  test('omits restricted users from the callable response', async () => {
    const { db } = createFakeDb([
      fakeDoc('allowed', { displayName: 'Allowed', role: 'user' }),
      fakeDoc('blocked', { displayName: 'Blocked', role: 'coach', isRestricted: true }),
    ]);
    const handler = createListUserDirectoryHandler({ db, HttpsError: FakeHttpsError });

    await expect(handler({ auth: { uid: 'caller' } })).resolves.toEqual({
      users: [{
        uid: 'allowed',
        name: 'Allowed',
        displayName: 'Allowed',
        pictureUrl: '',
        role: 'user',
      }],
    });
  });

  test('canonical restricted identity suppresses every visible legacy alias', async () => {
    const uid = 'U-canonical-restricted';
    const canonical = {
      uid,
      displayName: 'Restricted Canonical',
      role: 'admin',
      isRestricted: true,
    };
    const docs = [
      fakeDoc(uid, canonical),
      fakeDoc('legacy-visible', {
        lineUserId: uid,
        displayName: 'Visible Alias',
        role: 'coach',
      }),
    ];
    const { db, where } = createFakeDb(docs, { [uid]: canonical });
    const handler = createListUserDirectoryHandler({ db, HttpsError: FakeHttpsError });

    await expect(handler({ auth: { uid: 'caller' } })).resolves.toEqual({ users: [] });
    await expect(handler({
      auth: { uid: 'caller' },
      data: { verifyUids: [uid] },
    })).resolves.toEqual({ users: [] });
    expect(where).not.toHaveBeenCalled();
  });

  test('a mismatched canonical document id cannot leak through a visible alias', async () => {
    const canonicalUid = 'U-canonical-key';
    const claimedUid = 'U-different-claim';
    const docs = [
      fakeDoc(canonicalUid, {
        uid: claimedUid,
        displayName: 'Mismatched Identity',
        role: 'user',
      }),
      fakeDoc('legacy-visible', {
        lineUserId: canonicalUid,
        displayName: 'Would Otherwise Leak',
        role: 'coach',
      }),
    ];
    const { db } = createFakeDb(docs);
    const handler = createListUserDirectoryHandler({ db, HttpsError: FakeHttpsError });

    const result = await handler({ auth: { uid: 'caller' } });
    expect(result.users.map(user => user.uid)).toEqual([claimedUid]);
    expect(result.users.some(user => user.uid === canonicalUid)).toBe(false);
  });

  test('canonical visible identity wins over conflicting visible legacy projections', async () => {
    const uid = 'U-canonical-visible';
    const canonical = { uid, displayName: 'Canonical Name', role: 'captain' };
    const docs = [
      fakeDoc(uid, canonical),
      fakeDoc('legacy-different', {
        lineUserId: uid,
        displayName: 'Old Alias Name',
        role: 'coach',
      }),
    ];
    const { db } = createFakeDb(docs, { [uid]: canonical });
    const handler = createListUserDirectoryHandler({ db, HttpsError: FakeHttpsError });
    const expected = {
      uid,
      name: 'Canonical Name',
      displayName: 'Canonical Name',
      pictureUrl: '',
      role: 'captain',
    };

    await expect(handler({ auth: { uid: 'caller' } })).resolves.toEqual({
      users: [expected],
    });
    await expect(handler({
      auth: { uid: 'caller' },
      data: { verifyUids: [uid] },
    })).resolves.toEqual({ users: [expected] });
  });

  test('fresh verification finds a legacy-only identity by exact uid fields', async () => {
    const uid = 'U-legacy-only';
    const legacyDoc = fakeDoc('legacy-document-id', {
      lineUserId: uid,
      displayName: 'Legacy Only',
      role: 'coach',
    });
    const { db, limits, where } = createFakeDb(
      [legacyDoc],
      { [uid]: null },
      { queryDocs: [legacyDoc] },
    );
    const handler = createListUserDirectoryHandler({ db, HttpsError: FakeHttpsError });

    await expect(handler({
      auth: { uid: 'caller' },
      data: { verifyUids: [uid] },
    })).resolves.toEqual({
      users: [{
        uid,
        name: 'Legacy Only',
        displayName: 'Legacy Only',
        pictureUrl: '',
        role: 'coach',
      }],
    });
    expect(where).toHaveBeenCalledWith('uid', '==', uid);
    expect(where).toHaveBeenCalledWith('lineUserId', '==', uid);
    limits.forEach(limit => expect(limit).toHaveBeenCalledWith(6));
  });

  test('conflicting or restricted duplicate identities fail closed', async () => {
    const ambiguousUid = 'U-ambiguous';
    const restrictedUid = 'U-restricted-alias';
    const canonical = { uid: restrictedUid, displayName: 'Canonical', role: 'user' };
    const docs = [
      fakeDoc('legacy-a', {
        uid: ambiguousUid,
        displayName: 'First Identity',
        role: 'user',
      }),
      fakeDoc('legacy-b', {
        lineUserId: ambiguousUid,
        displayName: 'Different Identity',
        role: 'coach',
      }),
      fakeDoc(restrictedUid, canonical),
      fakeDoc('restricted-alias', {
        lineUserId: restrictedUid,
        displayName: 'Restricted Alias',
        role: 'admin',
        restricted: true,
      }),
    ];
    const { db } = createFakeDb(docs, {
      [ambiguousUid]: null,
      [restrictedUid]: canonical,
    });
    const handler = createListUserDirectoryHandler({ db, HttpsError: FakeHttpsError });

    await expect(handler({ auth: { uid: 'caller' } })).resolves.toEqual({ users: [] });
    await expect(handler({
      auth: { uid: 'caller' },
      data: { verifyUids: [ambiguousUid, restrictedUid] },
    })).resolves.toEqual({ users: [] });
  });

  test('a document with conflicting uid fields blocks every claimed identity', async () => {
    const primaryUid = 'U-primary';
    const otherUid = 'U-other';
    const docs = [
      fakeDoc('legacy-conflict', {
        uid: primaryUid,
        lineUserId: otherUid,
        displayName: 'Conflicted',
        role: 'user',
      }),
      fakeDoc('legacy-clean', {
        lineUserId: primaryUid,
        displayName: 'Would Otherwise Be Visible',
        role: 'user',
      }),
    ];
    const { db } = createFakeDb(docs, { [primaryUid]: null });
    const handler = createListUserDirectoryHandler({ db, HttpsError: FakeHttpsError });

    await expect(handler({ auth: { uid: 'caller' } })).resolves.toEqual({ users: [] });
    await expect(handler({
      auth: { uid: 'caller' },
      data: { verifyUids: [primaryUid] },
    })).resolves.toEqual({ users: [] });
  });

  test('identity query errors fail closed with a sanitized unavailable error', async () => {
    const logger = { error: jest.fn() };
    const { db } = createFakeDb([], { 'U-query-error': null }, {
      queryError: new Error('simulated database failure'),
    });
    const handler = createListUserDirectoryHandler({
      db,
      HttpsError: FakeHttpsError,
      logger,
    });

    await expect(handler({
      auth: { uid: 'caller' },
      data: { verifyUids: ['U-query-error'] },
    })).rejects.toMatchObject({
      code: 'unavailable',
      message: 'USER_DIRECTORY_UNAVAILABLE',
    });
    expect(logger.error).toHaveBeenCalledWith(
      '[listUserDirectory] failed to load directory',
      expect.objectContaining({ operation: 'fresh-identity-verification' }),
    );
  });

  test('too many exact identity matches fail closed at the bounded query limit', async () => {
    const uid = 'U-too-many';
    const aliases = Array.from({ length: 6 }, (_, index) => fakeDoc(
      `legacy-${index}`,
      { uid, displayName: 'Same Alias', role: 'user' },
    ));
    const { db, limits } = createFakeDb(aliases, { [uid]: null });
    const handler = createListUserDirectoryHandler({ db, HttpsError: FakeHttpsError });

    await expect(handler({
      auth: { uid: 'caller' },
      data: { verifyUids: [uid] },
    })).resolves.toEqual({ users: [] });
    limits.forEach(limit => expect(limit).toHaveBeenCalledWith(6));
  });

  test('fresh verification eviction wins over an older full-directory load', async () => {
    const uid = 'U-cache-race';
    const staleDocs = [fakeDoc(uid, {
      uid,
      displayName: 'Stale Visible',
      role: 'user',
    })];
    let resolveFullLoad;
    const fullLoadResult = new Promise((resolve) => {
      resolveFullLoad = resolve;
    });
    const { db, get } = createFakeDb(staleDocs, {
      [uid]: { uid, displayName: 'Now Restricted', isRestricted: true },
    }, {
      getImpl: () => fullLoadResult,
    });
    const handler = createListUserDirectoryHandler({ db, HttpsError: FakeHttpsError });

    const loadingDirectory = handler({ auth: { uid: 'caller' } });
    expect(get).toHaveBeenCalledTimes(1);
    await expect(handler({
      auth: { uid: 'caller' },
      data: { verifyUids: [uid] },
    })).resolves.toEqual({ users: [] });
    resolveFullLoad({ docs: staleDocs });

    await expect(loadingDirectory).resolves.toEqual({ users: [] });
    await expect(handler({ auth: { uid: 'caller' } })).resolves.toEqual({ users: [] });
  });
  test('rejects unauthenticated requests before reading Firestore or using cache', async () => {
    const { db, collection } = createFakeDb([
      fakeDoc('cached', { displayName: 'Cached User', role: 'user' }),
    ]);
    const handler = createListUserDirectoryHandler({ db, HttpsError: FakeHttpsError });

    await handler({ auth: { uid: 'caller' } });
    await expect(handler({
      data: { verifyUids: ['cached'] },
    })).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(collection).toHaveBeenCalledTimes(1);
  });

  test('verifyUids bypasses warm cache and returns only the exact allowlist', async () => {
    const exactDocs = {
      cached: {
        uid: 'cached',
        name: 'Fresh Legacy',
        displayName: 'Fresh User',
        pictureUrl: 'https://example.test/fresh.png',
        role: 'admin',
        stealth: true,
        email: 'private@example.test',
        phone: '0900-000-000',
        permissions: ['admin.users.entry'],
      },
    };
    const { db, doc, exactGet, get } = createFakeDb([
      fakeDoc('cached', { uid: 'cached', displayName: 'Cached User', role: 'user' }),
    ], exactDocs);
    const handler = createListUserDirectoryHandler({ db, HttpsError: FakeHttpsError });

    await handler({ auth: { uid: 'caller' } });
    await expect(handler({
      auth: { uid: 'caller' },
      data: { verifyUids: [' cached ', 'cached'] },
    })).resolves.toEqual({
      users: [{
        uid: 'cached',
        name: 'Fresh Legacy',
        displayName: 'Fresh User',
        pictureUrl: 'https://example.test/fresh.png',
        role: 'user',
      }],
    });
    expect(get).toHaveBeenCalledTimes(1);
    expect(doc).toHaveBeenCalledTimes(1);
    expect(doc).toHaveBeenCalledWith('cached');
    expect(exactGet).toHaveBeenCalledTimes(1);

    exactDocs.cached = {
      uid: 'cached',
      name: 'Fresh Again',
      displayName: 'Fresh Again',
      pictureUrl: '',
      role: 'coach',
      birthday: 'private',
    };
    await expect(handler({
      auth: { uid: 'caller' },
      data: { verifyUids: ['cached'] },
    })).resolves.toEqual({
      users: [{
        uid: 'cached',
        name: 'Fresh Again',
        displayName: 'Fresh Again',
        pictureUrl: '',
        role: 'coach',
      }],
    });
    expect(exactGet).toHaveBeenCalledTimes(2);

    await expect(handler({ auth: { uid: 'caller' } })).resolves.toEqual({
      users: [{
        uid: 'cached',
        name: 'Fresh Again',
        displayName: 'Fresh Again',
        pictureUrl: '',
        role: 'coach',
      }],
    });
    expect(get).toHaveBeenCalledTimes(1);
  });

  test('verifyUids omits restricted or missing users and evicts stale cache rows', async () => {
    const exactDocs = {
      keep: { uid: 'keep', displayName: 'Fresh Keep', role: 'captain' },
      restricted: {
        uid: 'restricted',
        displayName: 'Now Restricted',
        role: 'admin',
        isRestricted: true,
      },
      missing: null,
    };
    const { db, exactGet, get } = createFakeDb([
      fakeDoc('keep', { uid: 'keep', displayName: 'Cached Keep', role: 'user' }),
      fakeDoc('restricted', {
        uid: 'restricted',
        displayName: 'Cached Restricted',
        role: 'admin',
      }),
      fakeDoc('missing', { uid: 'missing', displayName: 'Cached Missing', role: 'coach' }),
    ], exactDocs);
    const handler = createListUserDirectoryHandler({ db, HttpsError: FakeHttpsError });

    await handler({ auth: { uid: 'caller' } });
    await expect(handler({
      auth: { uid: 'caller' },
      data: { verifyUids: ['keep', 'restricted', 'missing'] },
    })).resolves.toEqual({
      users: [{
        uid: 'keep',
        name: 'Fresh Keep',
        displayName: 'Fresh Keep',
        pictureUrl: '',
        role: 'captain',
      }],
    });
    expect(exactGet).toHaveBeenCalledTimes(3);

    await expect(handler({ auth: { uid: 'caller' } })).resolves.toEqual({
      users: [{
        uid: 'keep',
        name: 'Fresh Keep',
        displayName: 'Fresh Keep',
        pictureUrl: '',
        role: 'captain',
      }],
    });
    expect(get).toHaveBeenCalledTimes(1);
  });

  test('verifyUids rejects invalid input and more than 50 entries', async () => {
    const { db, collection } = createFakeDb([]);
    const handler = createListUserDirectoryHandler({ db, HttpsError: FakeHttpsError });
    const invalidValues = [
      'not-an-array',
      [],
      [' '],
      ['valid', 42],
      ['nested/path'],
      Array.from({ length: 51 }, (_, index) => 'U-' + index),
    ];

    for (const verifyUids of invalidValues) {
      await expect(handler({
        auth: { uid: 'caller' },
        data: { verifyUids },
      })).rejects.toMatchObject({ code: 'invalid-argument' });
    }
    expect(collection).not.toHaveBeenCalled();
  });

  test('reuses the warm-instance cache only until its short TTL expires', async () => {
    let currentTime = 1_000;
    const { db, collection, get } = createFakeDb([
      fakeDoc('cached', { displayName: 'Cached User', role: 'captain' }),
    ]);
    const handler = createListUserDirectoryHandler({
      db,
      HttpsError: FakeHttpsError,
      cacheTtlMs: 100,
      now: () => currentTime,
    });

    await handler({ auth: { uid: 'caller' } });
    currentTime = 1_099;
    await handler({ auth: { uid: 'caller' } });
    expect(collection).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(1);

    currentTime = 1_100;
    await handler({ auth: { uid: 'caller' } });
    expect(collection).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledTimes(2);
  });

  test('registers listUserDirectory in the canonical region', () => {
    const { db } = createFakeDb([]);
    const onCall = jest.fn((options, handler) => ({ options, handler }));

    const callable = createListUserDirectoryCallable({
      onCall,
      db,
      HttpsError: FakeHttpsError,
    });

    expect(callable.options).toMatchObject({ region: 'asia-east1' });
    expect(typeof callable.handler).toBe('function');
  });
});
