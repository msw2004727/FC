/**
 * Signup Logic — unit tests
 *
 * A1: _isUserSignedUp / _isUserOnWaitlist (event-list-stats.js:301-330)
 * A2: _docId backfill logic (firebase-crud.js:752-757)
 * A3: handleCancelSignup reg selection (event-detail-signup.js:435-449)
 *
 * These are CRITICAL functions per CLAUDE.md — tests protect against regressions
 * in the signup/cancel button state and _docId recovery flow.
 */

// ═══════════════════════════════════════════════════════
//  A1: _isUserSignedUp / _isUserOnWaitlist
//  Extracted from js/modules/event/event-list-stats.js:261-290
//  Adapted: inject user + regs instead of ApiService globals
// ═══════════════════════════════════════════════════════

function _getCurrentUserEventRegistrationState(e, { user, getRegistrationsByEvent }) {
  const uid = String(user?.uid || '').trim();
  if (!uid || !e?.id) return { signedUp: false, onWaitlist: false };
  const regs = getRegistrationsByEvent?.(e.id) || [];
  const isActive = r => r && r.status !== 'cancelled' && r.status !== 'removed';
  const isMine = r => String(r?.userId || r?.uid || '').trim() === uid;
  const myRegs = regs.filter(r => isActive(r) && isMine(r));
  if (myRegs.length > 0) {
    return { signedUp: true, onWaitlist: myRegs.some(r => r.status === 'waitlisted') };
  }
  const hasUid = list => Array.isArray(list) && list.some(item =>
    String(item?.uid || item?.userId || '').trim() === uid
  );
  if (hasUid(e.waitlistWithUid)) return { signedUp: true, onWaitlist: true };
  if (hasUid(e.participantsWithUid)) return { signedUp: true, onWaitlist: false };
  return { signedUp: false, onWaitlist: false };
}

function _isUserSignedUp(e, deps) {
  return _getCurrentUserEventRegistrationState(e, deps).signedUp;
}

function _isUserOnWaitlist(e, deps) {
  return _getCurrentUserEventRegistrationState(e, deps).onWaitlist;
}

// ═══════════════════════════════════════════════════════
//  A2: _docId backfill + guard
//  Extracted from js/firebase-crud.js:752-757
//  Adapted: standalone pure function for testability
// ═══════════════════════════════════════════════════════

/**
 * Simulates the _docId backfill logic from cancelRegistration.
 * Returns { reg, fsReg, threw, errorMessage } for assertion.
 */
function simulateDocIdBackfill(reg, firestoreRegs, registrationId) {
  // Clone reg to avoid mutating input
  const regCopy = { ...reg };

  const fsReg = firestoreRegs.find(r => r.id === registrationId || r._docId === regCopy._docId);
  if (fsReg && !regCopy._docId && fsReg._docId) regCopy._docId = fsReg._docId;

  let threw = false;
  let errorMessage = '';
  if (!regCopy._docId) {
    threw = true;
    errorMessage = '報名記錄不完整，請重新整理後再試';
  }

  return { reg: regCopy, fsReg: fsReg || null, threw, errorMessage };
}

// ═══════════════════════════════════════════════════════
//  A3: Reg selection logic from handleCancelSignup
//  Extracted from js/modules/event/event-detail-signup.js:435-441
//  Adapted: standalone pure function
// ═══════════════════════════════════════════════════════

/**
 * Simulates the reg selection + extraRegs detection logic.
 * Returns { reg, extraRegs } for assertion.
 */
function selectCancelReg(myRegs, isWaitlist) {
  const targetStatuses = isWaitlist ? ['waitlisted'] : ['confirmed', 'registered'];
  const reg = myRegs.find(r => targetStatuses.includes(r.status))
    || myRegs.find(r => r._docId && r.status !== 'cancelled' && r.status !== 'removed')
    || myRegs[0]
    || null;
  const extraRegs = myRegs.filter(r => r !== reg && r._docId);
  return { reg, extraRegs };
}

function resolveCancelRegistrationId(reg) {
  return reg ? (reg.id || reg._docId || null) : null;
}

function isActiveSelfRegistrationRecord(reg) {
  const status = String(reg?.status || '').trim();
  const participantType = String(reg?.participantType || '').trim();
  return participantType !== 'companion' && status !== 'cancelled' && status !== 'removed';
}

function hasActiveSelfRegistrationForEvent(regs, userId) {
  return (regs || []).some(reg =>
    isActiveSelfRegistrationRecord(reg)
    && (!userId || reg.userId === userId || reg.uid === userId)
  );
}

function isDuplicateSignupError(err) {
  const code = String(err?.details || err?.code || '').trim();
  const message = String(err?.message || err || '');
  return code === 'ALREADY_REGISTERED'
    || message.includes('已報名')
    || message.includes('已經報名')
    || (message.includes('撌脣') && message.includes('瘣餃'));
}

function isMissingCancelRegistrationError(err) {
  const code = String(err?.details || err?.code || '').trim();
  const message = String(err?.message || err || '');
  return code === 'REG_NOT_FOUND'
    || message.includes('報名記錄不存在')
    || message.includes('找不到報名');
}


// ═══════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════

// --- Helpers ---
const USER = { uid: 'U123', displayName: 'Alice', name: 'Alice' };
const mkReg = (userId, eventId, status, extras = {}) => ({ userId, eventId, status, ...extras });

// ─────────────────────────────────────────────────────
//  A1: _isUserSignedUp
// ─────────────────────────────────────────────────────

describe('_isUserSignedUp (event-list-stats.js:261-275)', () => {
  const deps = (regs) => ({ user: USER, getRegistrationsByEvent: () => regs });

  test('no user → false', () => {
    expect(_isUserSignedUp({ id: 'e1' }, { user: null, getRegistrationsByEvent: () => [] })).toBe(false);
  });

  test('user with confirmed registration → true', () => {
    const regs = [mkReg('U123', 'e1', 'confirmed')];
    expect(_isUserSignedUp({ id: 'e1' }, deps(regs))).toBe(true);
  });

  test('user with waitlisted registration → true', () => {
    const regs = [mkReg('U123', 'e1', 'waitlisted')];
    expect(_isUserSignedUp({ id: 'e1' }, deps(regs))).toBe(true);
  });

  test('registration with uid-only cache row → true', () => {
    const regs = [{ uid: 'U123', eventId: 'e1', status: 'confirmed' }];
    expect(_isUserSignedUp({ id: 'e1' }, deps(regs))).toBe(true);
  });

  test('user with cancelled registration → false (registrations path)', () => {
    const regs = [mkReg('U123', 'e1', 'cancelled')];
    expect(_isUserSignedUp({ id: 'e1' }, deps(regs))).toBe(false);
  });

  test('user with removed registration → false', () => {
    const regs = [mkReg('U123', 'e1', 'removed')];
    expect(_isUserSignedUp({ id: 'e1' }, deps(regs))).toBe(false);
  });

  test('different userId → false', () => {
    const regs = [mkReg('OTHER', 'e1', 'confirmed')];
    expect(_isUserSignedUp({ id: 'e1' }, deps(regs))).toBe(false);
  });

  test('participants array ignored — only registrations matter', () => {
    expect(_isUserSignedUp(
      { id: 'e1', participants: ['Alice', 'U123'] },
      { user: USER, getRegistrationsByEvent: () => [] }
    )).toBe(false);
  });

  test('waitlistNames array ignored — only registrations matter', () => {
    expect(_isUserSignedUp(
      { id: 'e1', waitlistNames: ['Alice', 'U123'] },
      { user: USER, getRegistrationsByEvent: () => [] }
    )).toBe(false);
  });

  test('participantsWithUid fallback → true when registration cache is missing', () => {
    expect(_isUserSignedUp(
      { id: 'e1', participantsWithUid: [{ uid: 'U123', name: 'Alice' }] },
      { user: USER, getRegistrationsByEvent: () => [] }
    )).toBe(true);
  });

  test('waitlistWithUid fallback → true when registration cache is missing', () => {
    expect(_isUserSignedUp(
      { id: 'e1', waitlistWithUid: [{ uid: 'U123', name: 'Alice' }] },
      { user: USER, getRegistrationsByEvent: () => [] }
    )).toBe(true);
  });

  test('no match anywhere → false', () => {
    expect(_isUserSignedUp(
      { id: 'e1', participants: ['Bob'], waitlistNames: ['Charlie'] },
      { user: USER, getRegistrationsByEvent: () => [] }
    )).toBe(false);
  });

  test('getRegistrationsByEvent is undefined → false (no fallback)', () => {
    expect(_isUserSignedUp(
      { id: 'e1', participants: ['Alice'] },
      { user: USER, getRegistrationsByEvent: undefined }
    )).toBe(false);
  });

  test('cancelled in regs, name in participants → false (no displayName fallback)', () => {
    const regs = [mkReg('U123', 'e1', 'cancelled')];
    expect(_isUserSignedUp(
      { id: 'e1', participants: ['Alice'] },
      { user: USER, getRegistrationsByEvent: () => regs }
    )).toBe(false);
  });

  test('user with empty uid → false', () => {
    expect(_isUserSignedUp(
      { id: 'e1' },
      { user: { uid: '', displayName: 'Alice' }, getRegistrationsByEvent: () => [] }
    )).toBe(false);
  });

  test('name collision: different user same name in participants → false', () => {
    expect(_isUserSignedUp(
      { id: 'e1', participants: ['Alice'] },
      { user: { uid: 'U999', displayName: 'Alice' }, getRegistrationsByEvent: () => [] }
    )).toBe(false);
  });
});

// ─────────────────────────────────────────────────────
//  A1: _isUserOnWaitlist
// ─────────────────────────────────────────────────────

describe('_isUserOnWaitlist (event-list-stats.js:278-290)', () => {
  const deps = (regs) => ({ user: USER, getRegistrationsByEvent: () => regs });

  test('no user → false', () => {
    expect(_isUserOnWaitlist({ id: 'e1' }, { user: null, getRegistrationsByEvent: () => [] })).toBe(false);
  });

  test('user with waitlisted registration → true', () => {
    const regs = [mkReg('U123', 'e1', 'waitlisted')];
    expect(_isUserOnWaitlist({ id: 'e1' }, deps(regs))).toBe(true);
  });

  test('registration with uid-only cache row waitlisted → true', () => {
    const regs = [{ uid: 'U123', eventId: 'e1', status: 'waitlisted' }];
    expect(_isUserOnWaitlist({ id: 'e1' }, deps(regs))).toBe(true);
  });

  test('user with confirmed registration → false', () => {
    const regs = [mkReg('U123', 'e1', 'confirmed')];
    expect(_isUserOnWaitlist({ id: 'e1' }, deps(regs))).toBe(false);
  });

  test('user with cancelled registration → false', () => {
    const regs = [mkReg('U123', 'e1', 'cancelled')];
    expect(_isUserOnWaitlist({ id: 'e1' }, deps(regs))).toBe(false);
  });

  test('different userId waitlisted → false', () => {
    const regs = [mkReg('OTHER', 'e1', 'waitlisted')];
    expect(_isUserOnWaitlist({ id: 'e1' }, deps(regs))).toBe(false);
  });

  test('waitlistNames array ignored — only registrations matter', () => {
    expect(_isUserOnWaitlist(
      { id: 'e1', waitlistNames: ['Alice', 'U123'] },
      { user: USER, getRegistrationsByEvent: () => [] }
    )).toBe(false);
  });

  test('waitlistWithUid fallback → true when registration cache is missing', () => {
    expect(_isUserOnWaitlist(
      { id: 'e1', waitlistWithUid: [{ uid: 'U123', name: 'Alice' }] },
      { user: USER, getRegistrationsByEvent: () => [] }
    )).toBe(true);
  });

  test('participantsWithUid fallback does not mark waitlisted', () => {
    expect(_isUserOnWaitlist(
      { id: 'e1', participantsWithUid: [{ uid: 'U123', name: 'Alice' }] },
      { user: USER, getRegistrationsByEvent: () => [] }
    )).toBe(false);
  });

  test('name in participants but not waitlistNames → false', () => {
    expect(_isUserOnWaitlist(
      { id: 'e1', participants: ['Alice'], waitlistNames: [] },
      { user: USER, getRegistrationsByEvent: () => [] }
    )).toBe(false);
  });

  test('getRegistrationsByEvent undefined → false (no fallback)', () => {
    expect(_isUserOnWaitlist(
      { id: 'e1', waitlistNames: ['Alice'] },
      { user: USER, getRegistrationsByEvent: undefined }
    )).toBe(false);
  });
});

// ─────────────────────────────────────────────────────
//  A2: _docId backfill logic
// ─────────────────────────────────────────────────────

describe('_docId backfill (firebase-crud.js:752-757)', () => {
  test('reg has _docId → no change, no throw', () => {
    const reg = { id: 'reg_1', _docId: 'DOC_1', status: 'confirmed' };
    const fsRegs = [{ id: 'reg_1', _docId: 'DOC_1' }];
    const result = simulateDocIdBackfill(reg, fsRegs, 'reg_1');
    expect(result.reg._docId).toBe('DOC_1');
    expect(result.threw).toBe(false);
  });

  test('reg missing _docId, fsReg matched by id → backfill', () => {
    const reg = { id: 'reg_1', status: 'confirmed' }; // no _docId
    const fsRegs = [{ id: 'reg_1', _docId: 'DOC_FROM_FS' }];
    const result = simulateDocIdBackfill(reg, fsRegs, 'reg_1');
    expect(result.reg._docId).toBe('DOC_FROM_FS');
    expect(result.threw).toBe(false);
  });

  test('reg missing _docId, fsReg matched by _docId (both undefined) → no backfill, throws', () => {
    const reg = { id: 'reg_1', status: 'confirmed' }; // no _docId
    const fsRegs = [{ id: 'reg_999', _docId: 'DOC_X' }]; // different id, won't match
    const result = simulateDocIdBackfill(reg, fsRegs, 'reg_1');
    expect(result.threw).toBe(true);
    expect(result.errorMessage).toBe('報名記錄不完整，請重新整理後再試');
  });

  test('reg missing _docId, firestoreRegs empty → throws', () => {
    const reg = { id: 'reg_1', status: 'confirmed' };
    const result = simulateDocIdBackfill(reg, [], 'reg_1');
    expect(result.threw).toBe(true);
  });

  test('reg has _docId, fsReg has different _docId → keeps original', () => {
    const reg = { id: 'reg_1', _docId: 'ORIGINAL', status: 'confirmed' };
    const fsRegs = [{ id: 'reg_1', _docId: 'DIFFERENT' }];
    const result = simulateDocIdBackfill(reg, fsRegs, 'reg_1');
    expect(result.reg._docId).toBe('ORIGINAL'); // !reg._docId is false, skip backfill
  });

  test('multiple fsRegs, first match by id wins', () => {
    const reg = { id: 'reg_2', status: 'confirmed' };
    const fsRegs = [
      { id: 'reg_1', _docId: 'DOC_1' },
      { id: 'reg_2', _docId: 'DOC_2' },
      { id: 'reg_3', _docId: 'DOC_3' },
    ];
    const result = simulateDocIdBackfill(reg, fsRegs, 'reg_2');
    expect(result.reg._docId).toBe('DOC_2');
    expect(result.threw).toBe(false);
  });

  test('fsReg matched but fsReg._docId is also undefined → throws', () => {
    const reg = { id: 'reg_1', status: 'confirmed' };
    const fsRegs = [{ id: 'reg_1' }]; // fsReg has no _docId
    const result = simulateDocIdBackfill(reg, fsRegs, 'reg_1');
    expect(result.threw).toBe(true);
  });

  test('does not mutate original reg object', () => {
    const reg = { id: 'reg_1', status: 'confirmed' };
    const fsRegs = [{ id: 'reg_1', _docId: 'DOC_X' }];
    simulateDocIdBackfill(reg, fsRegs, 'reg_1');
    expect(reg._docId).toBeUndefined(); // original not mutated
  });
});

// ─────────────────────────────────────────────────────
//  A3: handleCancelSignup reg selection
// ─────────────────────────────────────────────────────

describe('selectCancelReg (event-detail-signup.js:435-441)', () => {
  test('single confirmed reg (not waitlist) → selected', () => {
    const regs = [{ id: '1', status: 'confirmed', _docId: 'D1' }];
    const { reg, extraRegs } = selectCancelReg(regs, false);
    expect(reg.id).toBe('1');
    expect(extraRegs).toHaveLength(0);
  });

  test('single waitlisted reg (isWaitlist) → selected', () => {
    const regs = [{ id: '1', status: 'waitlisted', _docId: 'D1' }];
    const { reg, extraRegs } = selectCancelReg(regs, true);
    expect(reg.id).toBe('1');
    expect(extraRegs).toHaveLength(0);
  });

  test('isWaitlist=false: prefers confirmed over other statuses', () => {
    const regs = [
      { id: '1', status: 'waitlisted', _docId: 'D1' },
      { id: '2', status: 'confirmed', _docId: 'D2' },
    ];
    const { reg } = selectCancelReg(regs, false);
    expect(reg.id).toBe('2');
  });

  test('isWaitlist=false: accepts "registered" status too', () => {
    const regs = [{ id: '1', status: 'registered', _docId: 'D1' }];
    const { reg } = selectCancelReg(regs, false);
    expect(reg.id).toBe('1');
  });

  test('isWaitlist=true: prefers waitlisted over confirmed', () => {
    const regs = [
      { id: '1', status: 'confirmed', _docId: 'D1' },
      { id: '2', status: 'waitlisted', _docId: 'D2' },
    ];
    const { reg } = selectCancelReg(regs, true);
    expect(reg.id).toBe('2');
  });

  test('fallback: no matching status, uses _docId + active status', () => {
    const regs = [
      { id: '1', status: 'some_unknown', _docId: 'D1' },
    ];
    const { reg } = selectCancelReg(regs, false);
    expect(reg.id).toBe('1'); // matched by second find (has _docId, not cancelled/removed)
  });

  test('fallback: no _docId, uses first reg', () => {
    const regs = [
      { id: '1', status: 'some_unknown' }, // no _docId
    ];
    const { reg } = selectCancelReg(regs, false);
    expect(reg.id).toBe('1'); // matched by myRegs[0]
  });

  test('empty array → reg is null', () => {
    const { reg, extraRegs } = selectCancelReg([], false);
    expect(reg).toBeNull();
    expect(extraRegs).toHaveLength(0);
  });

  test('extraRegs: duplicate regs with _docId are marked as extra', () => {
    const regs = [
      { id: '1', status: 'confirmed', _docId: 'D1' },
      { id: '2', status: 'confirmed', _docId: 'D2' },
      { id: '3', status: 'confirmed', _docId: 'D3' },
    ];
    const { reg, extraRegs } = selectCancelReg(regs, false);
    expect(reg.id).toBe('1'); // first confirmed
    expect(extraRegs).toHaveLength(2);
    expect(extraRegs.map(r => r.id)).toEqual(['2', '3']);
  });

  test('extraRegs: regs without _docId are NOT in extraRegs', () => {
    const regs = [
      { id: '1', status: 'confirmed', _docId: 'D1' },
      { id: '2', status: 'confirmed' }, // no _docId
      { id: '3', status: 'confirmed', _docId: 'D3' },
    ];
    const { reg, extraRegs } = selectCancelReg(regs, false);
    expect(reg.id).toBe('1');
    expect(extraRegs).toHaveLength(1);
    expect(extraRegs[0].id).toBe('3'); // only the one with _docId
  });

  test('cancelled regs are skipped by fallback _docId check', () => {
    const regs = [
      { id: '1', status: 'cancelled', _docId: 'D1' },
    ];
    const { reg } = selectCancelReg(regs, false);
    // First find: no confirmed/registered match
    // Second find: _docId exists but status is 'cancelled' → skip
    // Third: myRegs[0] → returns it
    expect(reg.id).toBe('1');
    expect(reg.status).toBe('cancelled'); // fell through to myRegs[0]
  });

  test('removed regs are skipped by fallback _docId check', () => {
    const regs = [
      { id: '1', status: 'removed', _docId: 'D1' },
      { id: '2', status: 'confirmed' },
    ];
    const { reg } = selectCancelReg(regs, false);
    expect(reg.id).toBe('2'); // first find matches confirmed
  });

  test('cancel action accepts _docId when custom id is absent', () => {
    const regs = [{ _docId: 'DOC_1', status: 'confirmed' }];
    const { reg } = selectCancelReg(regs, false);
    expect(resolveCancelRegistrationId(reg)).toBe('DOC_1');
  });
});

describe('signup/cancel rapid-click guard helpers', () => {
  test('active self registration includes confirmed, registered, and waitlisted', () => {
    expect(isActiveSelfRegistrationRecord({ status: 'confirmed' })).toBe(true);
    expect(isActiveSelfRegistrationRecord({ status: 'registered' })).toBe(true);
    expect(isActiveSelfRegistrationRecord({ status: 'waitlisted' })).toBe(true);
  });

  test('active self registration excludes cancelled, removed, and companions', () => {
    expect(isActiveSelfRegistrationRecord({ status: 'cancelled' })).toBe(false);
    expect(isActiveSelfRegistrationRecord({ status: 'removed' })).toBe(false);
    expect(isActiveSelfRegistrationRecord({ status: 'confirmed', participantType: 'companion' })).toBe(false);
  });

  test('hasActiveSelfRegistrationForEvent matches userId or uid only for active self rows', () => {
    const regs = [
      { userId: 'OTHER', status: 'confirmed' },
      { userId: 'U123', status: 'cancelled' },
      { uid: 'U123', status: 'waitlisted' },
    ];
    expect(hasActiveSelfRegistrationForEvent(regs, 'U123')).toBe(true);
    expect(hasActiveSelfRegistrationForEvent(regs, 'U999')).toBe(false);
  });

  test('duplicate signup error detects Cloud Function code and readable messages', () => {
    expect(isDuplicateSignupError({ details: 'ALREADY_REGISTERED' })).toBe(true);
    expect(isDuplicateSignupError(new Error('已報名此活動'))).toBe(true);
    expect(isDuplicateSignupError(new Error('你已經報名這場活動'))).toBe(true);
  });

  test('duplicate signup error detects observed mojibake fallback', () => {
    expect(isDuplicateSignupError(new Error('撌脣?迨瘣餃?'))).toBe(true);
  });

  test('missing cancel registration error detects code and readable messages', () => {
    expect(isMissingCancelRegistrationError({ details: 'REG_NOT_FOUND' })).toBe(true);
    expect(isMissingCancelRegistrationError(new Error('報名記錄不存在'))).toBe(true);
    expect(isMissingCancelRegistrationError(new Error('找不到報名資料'))).toBe(true);
  });

  test('non-benign errors stay reportable', () => {
    expect(isDuplicateSignupError(new Error('permission-denied'))).toBe(false);
    expect(isMissingCancelRegistrationError(new Error('permission-denied'))).toBe(false);
  });
});
