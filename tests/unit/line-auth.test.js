/**
 * LINE Auth module unit tests — extracted pure functions.
 *
 * Source file: js/line-auth.js
 */

// ---------------------------------------------------------------------------
// Extracted from js/line-auth.js:100-119
// _withTimeout — wraps a promise with a timeout
// ---------------------------------------------------------------------------
function _withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`${label || 'operation'} timeout after ${ms}ms`);
      err.code = 'timeout';
      reject(err);
    }, ms);

    Promise.resolve(promise).then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      err => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

// ---------------------------------------------------------------------------
// Extracted from js/line-auth.js:19-32 (adapted)
// _cleanUrlParams — identifies which LIFF params need cleaning
// Pure logic extracted: given a list of param names and a search params object,
// returns which params should be removed.
// ---------------------------------------------------------------------------
function _getLiffParamsToClean(searchParams) {
  const liffParams = ['code', 'state', 'liffClientId', 'liffRedirectUri', 'error', 'error_description'];
  return liffParams.filter(p => searchParams.has(p));
}

// ---------------------------------------------------------------------------
// Extracted from js/line-auth.js:65-73 (adapted)
// _matchesFirebaseUid — checks if cached profile matches Firebase UID
// Adapted to accept explicit UID instead of global `auth`
// ---------------------------------------------------------------------------
function _matchesFirebaseUid(cachedProfile, firebaseUid) {
  if (!cachedProfile || !cachedProfile.userId) return false;
  if (!firebaseUid) return false;
  return firebaseUid === cachedProfile.userId;
}

// ---------------------------------------------------------------------------
// Extracted from js/line-auth.js:38-46 (adapted)
// _isValidProfileCache — checks if cached profile is valid
// ---------------------------------------------------------------------------
function _isValidProfileCache(cached, maxAgeMs) {
  if (!cached || typeof cached !== 'object') return false;
  if (!cached.userId) return false;
  const cachedAt = Number(cached.cachedAt || 0);
  if (!cachedAt) return false;
  return (Date.now() - cachedAt) < maxAgeMs;
}

// ===========================================================================
// TESTS
// ===========================================================================

describe('_withTimeout (line-auth.js:100-119)', () => {
  test('resolves if promise resolves before timeout', async () => {
    const result = await _withTimeout(Promise.resolve('ok'), 1000, 'test');
    expect(result).toBe('ok');
  });

  test('rejects if promise rejects before timeout', async () => {
    await expect(
      _withTimeout(Promise.reject(new Error('fail')), 1000, 'test')
    ).rejects.toThrow('fail');
  });

  test('rejects with timeout error if promise is too slow', async () => {
    const slowPromise = new Promise(() => {}); // never resolves
    await expect(
      _withTimeout(slowPromise, 50, 'myOp')
    ).rejects.toThrow('myOp timeout after 50ms');
  });

  test('timeout error has code "timeout"', async () => {
    const slowPromise = new Promise(() => {});
    try {
      await _withTimeout(slowPromise, 50, 'test');
    } catch (err) {
      expect(err.code).toBe('timeout');
    }
  });

  test('default label if none provided', async () => {
    const slowPromise = new Promise(() => {});
    await expect(
      _withTimeout(slowPromise, 50)
    ).rejects.toThrow('operation timeout after 50ms');
  });
});

describe('_getLiffParamsToClean (line-auth.js:19-32)', () => {
  test('identifies LIFF params present in search', () => {
    const params = new URLSearchParams('code=abc&state=xyz&other=123');
    const toClean = _getLiffParamsToClean(params);
    expect(toClean).toContain('code');
    expect(toClean).toContain('state');
    expect(toClean).not.toContain('other');
  });

  test('no LIFF params → empty array', () => {
    const params = new URLSearchParams('page=home&lang=en');
    expect(_getLiffParamsToClean(params)).toEqual([]);
  });

  test('all LIFF params present', () => {
    const params = new URLSearchParams(
      'code=1&state=2&liffClientId=3&liffRedirectUri=4&error=5&error_description=6'
    );
    const toClean = _getLiffParamsToClean(params);
    expect(toClean.length).toBe(6);
  });
});

describe('_matchesFirebaseUid (line-auth.js:65-73)', () => {
  test('matching uid → true', () => {
    expect(_matchesFirebaseUid({ userId: 'u1' }, 'u1')).toBe(true);
  });

  test('non-matching uid → false', () => {
    expect(_matchesFirebaseUid({ userId: 'u1' }, 'u2')).toBe(false);
  });

  test('null cached profile → false', () => {
    expect(_matchesFirebaseUid(null, 'u1')).toBe(false);
  });

  test('no userId in profile → false', () => {
    expect(_matchesFirebaseUid({ displayName: 'Alice' }, 'u1')).toBe(false);
  });

  test('no firebase uid → false', () => {
    expect(_matchesFirebaseUid({ userId: 'u1' }, null)).toBe(false);
    expect(_matchesFirebaseUid({ userId: 'u1' }, '')).toBe(false);
  });
});

describe('_isValidProfileCache', () => {
  test('valid cache → true', () => {
    const cached = { userId: 'u1', cachedAt: Date.now() - 1000 };
    expect(_isValidProfileCache(cached, 60000)).toBe(true);
  });

  test('expired cache → false', () => {
    const cached = { userId: 'u1', cachedAt: Date.now() - 100000 };
    expect(_isValidProfileCache(cached, 60000)).toBe(false);
  });

  test('null cache → false', () => {
    expect(_isValidProfileCache(null, 60000)).toBe(false);
  });

  test('no userId → false', () => {
    expect(_isValidProfileCache({ cachedAt: Date.now() }, 60000)).toBe(false);
  });

  test('no cachedAt → false', () => {
    expect(_isValidProfileCache({ userId: 'u1' }, 60000)).toBe(false);
  });
});
