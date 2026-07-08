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

function _buildLoginRedirectUri(currentHref, origin) {
  const base = new URL((origin || new URL(currentHref).origin) + '/').toString();
  const url = new URL(currentHref);
  _getLiffParamsToClean(url.searchParams).forEach(p => url.searchParams.delete(p));
  const redirectUri = url.toString();
  return redirectUri === base ? null : redirectUri;
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

function _matchesFirebaseCurrentUserCache(currentUser, firebaseUid, hasExistingProfile = false) {
  if (!currentUser || !firebaseUid) return false;
  const matches = [currentUser.uid, currentUser.lineUserId, currentUser._docId]
    .map(v => String(v || '').trim())
    .filter(Boolean)
    .includes(firebaseUid);
  if (!matches) return false;
  return hasExistingProfile || !!String(currentUser.displayName || currentUser.name || '').trim();
}

function _canUseCachedProfileForFastCloudReady({
  liveProfile,
  cachedProfile,
  firebaseUid,
  firebaseSessionAlive,
  liffDecodedUid,
}) {
  const profile = liveProfile || cachedProfile;
  return !!firebaseSessionAlive
    && _matchesFirebaseUid(profile, firebaseUid)
    && !!liffDecodedUid
    && liffDecodedUid === profile.userId;
}

function _isLoggedIn({ ready, profile, firebaseUid, cachedProfile, currentUser, hasLiffSession = false }) {
  const hasFirebaseUserFallback = () => {
    if (!firebaseUid) return false;
    if (cachedProfile && _matchesFirebaseUid(cachedProfile, firebaseUid)) return true;
    return _matchesFirebaseCurrentUserCache(currentUser, firebaseUid);
  };
  if (!ready) return hasFirebaseUserFallback();
  if (profile !== null && profile !== undefined) {
    if (hasLiffSession) return true;
    if (_matchesFirebaseUid(profile, firebaseUid)) return true;
    return _matchesFirebaseCurrentUserCache(currentUser, firebaseUid, true);
  }
  return hasFirebaseUserFallback();
}

function _profileFromCurrentUserCache(currentUser, firebaseUid) {
  if (!_matchesFirebaseCurrentUserCache(currentUser, firebaseUid)) return null;
  return {
    userId: firebaseUid,
    displayName: currentUser.displayName || currentUser.name || currentUser.email || '用戶',
    pictureUrl: currentUser.pictureUrl || currentUser.photoURL || null,
    email: currentUser.email || null,
  };
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
    expect.assertions(1);
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

describe('_buildLoginRedirectUri (line-auth.js login redirect contract)', () => {
  test('returns null for root URL so LIFF SDK can use endpoint default', () => {
    expect(_buildLoginRedirectUri('https://toosterx.com/', 'https://toosterx.com')).toBeNull();
  });

  test('preserves clean path routes for login round-trip', () => {
    expect(_buildLoginRedirectUri('https://toosterx.com/activities', 'https://toosterx.com'))
      .toBe('https://toosterx.com/activities');
    expect(_buildLoginRedirectUri('https://toosterx.com/events/ce_1777307578139_1hw5bj', 'https://toosterx.com'))
      .toBe('https://toosterx.com/events/ce_1777307578139_1hw5bj');
  });

  test('removes LIFF OAuth params while keeping app route params', () => {
    expect(_buildLoginRedirectUri('https://toosterx.com/events/ce_1?code=abc&state=xyz&foo=bar#page-activity-detail', 'https://toosterx.com'))
      .toBe('https://toosterx.com/events/ce_1?foo=bar#page-activity-detail');
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

describe('_matchesFirebaseCurrentUserCache', () => {
  test('matches Firebase uid against currentUser uid', () => {
    expect(_matchesFirebaseCurrentUserCache({ uid: 'u1', displayName: 'Alice' }, 'u1')).toBe(true);
  });

  test('matches Firebase uid against currentUser lineUserId or doc id', () => {
    expect(_matchesFirebaseCurrentUserCache({ uid: 'legacy', lineUserId: 'u1', displayName: 'Alice' }, 'u1')).toBe(true);
    expect(_matchesFirebaseCurrentUserCache({ _docId: 'u1', name: 'Alice' }, 'u1')).toBe(true);
  });

  test('does not match missing or unrelated currentUser cache', () => {
    expect(_matchesFirebaseCurrentUserCache(null, 'u1')).toBe(false);
    expect(_matchesFirebaseCurrentUserCache({ uid: 'u2', lineUserId: 'u3', displayName: 'Alice' }, 'u1')).toBe(false);
    expect(_matchesFirebaseCurrentUserCache({ uid: 'u1', displayName: 'Alice' }, '')).toBe(false);
    expect(_matchesFirebaseCurrentUserCache({ uid: 'u1' }, 'u1')).toBe(false);
  });
});

describe('cached profile fast cloud-ready contract', () => {
  test('allows fast path only when Firebase session is alive and uid matches', () => {
    expect(_canUseCachedProfileForFastCloudReady({
      liveProfile: { userId: 'u1', displayName: 'Alice' },
      cachedProfile: null,
      firebaseUid: 'u1',
      firebaseSessionAlive: true,
      liffDecodedUid: 'u1',
    })).toBe(true);
  });

  test('rejects fast path when the cached profile belongs to another user', () => {
    expect(_canUseCachedProfileForFastCloudReady({
      liveProfile: { userId: 'u2', displayName: 'Bob' },
      cachedProfile: null,
      firebaseUid: 'u1',
      firebaseSessionAlive: true,
      liffDecodedUid: 'u2',
    })).toBe(false);
  });

  test('rejects fast path before Firebase Auth has restored the session', () => {
    expect(_canUseCachedProfileForFastCloudReady({
      liveProfile: null,
      cachedProfile: { userId: 'u1', displayName: 'Alice' },
      firebaseUid: 'u1',
      firebaseSessionAlive: false,
      liffDecodedUid: 'u1',
    })).toBe(false);
  });

  test('rejects fast path when LIFF decoded token is unavailable', () => {
    expect(_canUseCachedProfileForFastCloudReady({
      liveProfile: { userId: 'u1', displayName: 'Alice' },
      cachedProfile: null,
      firebaseUid: 'u1',
      firebaseSessionAlive: true,
      liffDecodedUid: '',
    })).toBe(false);
  });
});

describe('isLoggedIn fallback contract', () => {
  test('accepts a restored Firebase user before LIFF is ready when cache matches', () => {
    expect(_isLoggedIn({
      ready: false,
      profile: null,
      firebaseUid: 'u1',
      cachedProfile: null,
      currentUser: { uid: 'u1', displayName: 'Alice' },
    })).toBe(true);
  });

  test('does not accept unrelated cache before LIFF is ready', () => {
    expect(_isLoggedIn({
      ready: false,
      profile: null,
      firebaseUid: 'u1',
      cachedProfile: null,
      currentUser: { uid: 'u2', displayName: 'Alice' },
    })).toBe(false);
  });

  test('does not accept Firebase cache without a real display name', () => {
    expect(_isLoggedIn({
      ready: false,
      profile: null,
      firebaseUid: 'u1',
      cachedProfile: null,
      currentUser: { uid: 'u1' },
    })).toBe(false);
  });

  test('accepts a live LINE profile when a LIFF session is active', () => {
    expect(_isLoggedIn({
      ready: true,
      profile: { userId: 'u1', displayName: 'Alice' },
      firebaseUid: '',
      cachedProfile: null,
      currentUser: null,
      hasLiffSession: true,
    })).toBe(true);
  });

  test('rejects stale LINE profile when LIFF session and Firebase Auth are both unavailable', () => {
    expect(_isLoggedIn({
      ready: true,
      profile: { userId: 'u1', displayName: 'Alice' },
      firebaseUid: '',
      cachedProfile: null,
      currentUser: null,
      hasLiffSession: false,
    })).toBe(false);
  });

  test('accepts a cached LINE profile only when Firebase Auth matches the same uid', () => {
    expect(_isLoggedIn({
      ready: true,
      profile: { userId: 'u1', displayName: 'Alice' },
      firebaseUid: 'u1',
      cachedProfile: null,
      currentUser: { uid: 'u1', displayName: 'Alice' },
      hasLiffSession: false,
    })).toBe(true);
  });
  test('Firebase cache fallback can provide a minimal profile for logged-in callers', () => {
    expect(_profileFromCurrentUserCache({
      uid: 'u1',
      displayName: 'Alice',
      pictureUrl: 'https://example.test/a.png',
    }, 'u1')).toMatchObject({
      userId: 'u1',
      displayName: 'Alice',
      pictureUrl: 'https://example.test/a.png',
    });
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
