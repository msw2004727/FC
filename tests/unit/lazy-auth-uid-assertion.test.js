/**
 * Lazy Auth — UID Assertion Tests (Blocker 2 三層防線)
 *
 * 保護對象（CLAUDE.md §報名系統保護規則鎖定函式）：
 *   - js/line-auth.js              _isActiveAuthUidConsistent (v6 新增)
 *   - js/core/navigation.js        _requireProtectedActionLogin (v6 R3.1 修正)
 *   - js/firebase-crud.js          _doRegisterForEvent (v5 Part 3)
 *   - js/firebase-crud.js          batchRegisterForEvent / cancelRegistration (v6 R3.6)
 *
 * 既有專案測試風格（extract-then-test）：不 import source，抽純邏輯進 test 檔。
 * 歷史教訓：Blocker 2 Part 2 條件 v4→v5→v6 三次寫反，此檔是 merge 前 gate。
 */

// ===========================================================================
// LAYER 1: line-auth.js _isActiveAuthUidConsistent (v6 新增)
// 擴充自既有 _matchesFirebaseUid (line-auth.js:65-73) — 加 cache fallback
// ===========================================================================
function _isActiveAuthUidConsistent(lineAuth, authRef) {
  // v6 R3.1 正確邏輯：cached profile 也要能比對（Tier 2 換帳號時 _profile 可能為 null）
  const cachedOrLive = lineAuth._profile
    || (typeof lineAuth.restoreCachedProfile === 'function' && lineAuth.restoreCachedProfile());
  if (!cachedOrLive || !cachedOrLive.userId) return true; // 無 profile 視為「未登入」，非不一致
  if (!authRef || !authRef.currentUser) return true;      // auth 未就緒，不判定不一致
  return cachedOrLive.userId === authRef.currentUser.uid;
}

// ===========================================================================
// LAYER 1 helper: _requireProtectedActionLogin UID consistency branch
// Extracted pure decision: shouldBlockAndRelogin(profile, cached, authRef)
// ===========================================================================
function shouldBlockAndRelogin(profile, cachedProfile, authRef) {
  const cachedOrLive = profile || cachedProfile;
  if (!cachedOrLive) return false;
  if (typeof authRef === 'undefined' || !authRef || !authRef.currentUser) return false;
  return cachedOrLive.userId !== authRef.currentUser.uid;
}

// ===========================================================================
// LAYER 3: _doRegisterForEvent UID assertion pre-check
// Extracted from firebase-crud.js:833 (v6 Blocker 2 Part 3)
// ===========================================================================
function assertAuthUidMatchesUserId(authRef, userId) {
  if (!authRef || !authRef.currentUser) {
    throw new Error('身分驗證失敗');
  }
  if (authRef.currentUser.uid !== userId) {
    throw new Error('身分不一致、請重新登入');
  }
  return true;
}

function assertAuthUidMatchesOperator(authRef, operatorUid) {
  if (!authRef || !authRef.currentUser) throw new Error('身分驗證失敗');
  if (authRef.currentUser.uid !== operatorUid) throw new Error('身分不一致');
  return true;
}

function assertAuthUidCanCancel(authRef, reg) {
  if (!reg) throw new Error('報名記錄不存在');
  if (!authRef || !authRef.currentUser) throw new Error('身分驗證失敗');
  if (authRef.currentUser.uid !== reg.userId) {
    throw new Error('身分不一致、無法取消他人報名');
  }
  return true;
}

// ===========================================================================
// TESTS
// ===========================================================================

describe('LAYER 1 — _isActiveAuthUidConsistent (line-auth.js, v6 新增)', () => {
  test('T-L1-01 happy path: profile A + auth A → consistent (true)', () => {
    const la = { _profile: { userId: 'A' } };
    const authRef = { currentUser: { uid: 'A' } };
    expect(_isActiveAuthUidConsistent(la, authRef)).toBe(true);
  });

  test('T-L1-02 Tier 2 swap (CORE): profile A + auth B → NOT consistent (false)', () => {
    const la = { _profile: { userId: 'A' } };
    const authRef = { currentUser: { uid: 'B' } };
    expect(_isActiveAuthUidConsistent(la, authRef)).toBe(false);
  });

  test('T-L1-03 _profile=null + cache A + auth B → fallback to cache, NOT consistent', () => {
    const la = {
      _profile: null,
      restoreCachedProfile: () => ({ userId: 'A' }),
    };
    const authRef = { currentUser: { uid: 'B' } };
    expect(_isActiveAuthUidConsistent(la, authRef)).toBe(false);
  });

  test('T-L1-04 _profile=null + no cache + auth exists → treat as "not-logged-in", true (no false alarm)', () => {
    const la = { _profile: null, restoreCachedProfile: () => null };
    const authRef = { currentUser: { uid: 'B' } };
    expect(_isActiveAuthUidConsistent(la, authRef)).toBe(true);
  });

  test('T-L1-05 complete guest: no profile, no cache, no auth → true (no Tier 2 path)', () => {
    const la = { _profile: null, restoreCachedProfile: () => null };
    const authRef = { currentUser: null };
    expect(_isActiveAuthUidConsistent(la, authRef)).toBe(true);
  });

  test('T-L1-06 auth undefined (SDK not loaded): profile A + undefined auth → true (Blocker 3 territory)', () => {
    const la = { _profile: { userId: 'A' } };
    expect(_isActiveAuthUidConsistent(la, undefined)).toBe(true);
    expect(_isActiveAuthUidConsistent(la, null)).toBe(true);
  });

  test('T-L1-07 restoreCachedProfile is not a function → gracefully skip cache fallback', () => {
    const la = { _profile: null }; // no restoreCachedProfile
    const authRef = { currentUser: { uid: 'B' } };
    expect(_isActiveAuthUidConsistent(la, authRef)).toBe(true);
  });
});

describe('LAYER 1 branch — _requireProtectedActionLogin should-relogin decision', () => {
  test('T-L1B-01 profile consistent with auth → no relogin', () => {
    expect(shouldBlockAndRelogin({ userId: 'A' }, null, { currentUser: { uid: 'A' } })).toBe(false);
  });

  test('T-L1B-02 profile A, auth B → relogin triggered (Tier 2 swap)', () => {
    expect(shouldBlockAndRelogin({ userId: 'A' }, null, { currentUser: { uid: 'B' } })).toBe(true);
  });

  test('T-L1B-03 profile null, cache A, auth B → relogin triggered (v6 R3.1)', () => {
    expect(shouldBlockAndRelogin(null, { userId: 'A' }, { currentUser: { uid: 'B' } })).toBe(true);
  });

  test('T-L1B-04 profile null, cache null → no relogin (normal guest flow)', () => {
    expect(shouldBlockAndRelogin(null, null, { currentUser: { uid: 'B' } })).toBe(false);
  });

  test('T-L1B-05 auth undefined → no relogin (don\'t throw on missing SDK)', () => {
    expect(shouldBlockAndRelogin({ userId: 'A' }, null, undefined)).toBe(false);
    expect(shouldBlockAndRelogin({ userId: 'A' }, null, { currentUser: null })).toBe(false);
  });
});

describe('LAYER 3 — _doRegisterForEvent UID assertion (firebase-crud.js, 鎖定函式)', () => {
  test('T-L3-01 auth.currentUser.uid === userId → pass', () => {
    const authRef = { currentUser: { uid: 'A' } };
    expect(() => assertAuthUidMatchesUserId(authRef, 'A')).not.toThrow();
    expect(assertAuthUidMatchesUserId(authRef, 'A')).toBe(true);
  });

  test('T-L3-02 auth.currentUser.uid !== userId → throw "身分不一致"', () => {
    const authRef = { currentUser: { uid: 'B' } };
    expect(() => assertAuthUidMatchesUserId(authRef, 'A'))
      .toThrow('身分不一致、請重新登入');
  });

  test('T-L3-03 auth.currentUser = null → throw "身分驗證失敗"', () => {
    expect(() => assertAuthUidMatchesUserId({ currentUser: null }, 'A'))
      .toThrow('身分驗證失敗');
    expect(() => assertAuthUidMatchesUserId(null, 'A'))
      .toThrow('身分驗證失敗');
  });

  test('T-L3-04 batchRegisterForEvent operator mismatch → throw (R3.6)', () => {
    const authRef = { currentUser: { uid: 'B' } };
    expect(() => assertAuthUidMatchesOperator(authRef, 'A')).toThrow('身分不一致');
  });

  test('T-L3-05 cancelRegistration: cancel someone else\'s reg → throw (R3.6)', () => {
    const authRef = { currentUser: { uid: 'B' } };
    const reg = { id: 'reg_x', userId: 'A' };
    expect(() => assertAuthUidCanCancel(authRef, reg))
      .toThrow('身分不一致、無法取消他人報名');
  });

  test('T-L3-06 cancelRegistration: cancel own reg → pass', () => {
    const authRef = { currentUser: { uid: 'A' } };
    const reg = { id: 'reg_x', userId: 'A' };
    expect(() => assertAuthUidCanCancel(authRef, reg)).not.toThrow();
  });

  test('T-L3-07 cancelRegistration: null reg → throw "報名記錄不存在"', () => {
    const authRef = { currentUser: { uid: 'A' } };
    expect(() => assertAuthUidCanCancel(authRef, null)).toThrow('報名記錄不存在');
  });
});
