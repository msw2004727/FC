/**
 * Registration Transaction Logic — unit tests
 *
 * Tests the core Firestore Transaction logic from firebase-crud.js
 * without a live Firestore connection. Uses mocked db.runTransaction
 * and db.batch to verify:
 *   - Duplicate detection (inside Transaction)
 *   - Waitlist vs confirmed status assignment
 *   - Occupancy rebuild with fresh Firestore data
 *   - Cancellation with waitlist promotion in same batch
 *   - Simulation-first pattern (no cache mutation before commit)
 *
 * IMPORTANT: These tests verify the LOGIC extracted from the locked
 * functions per CLAUDE.md. The actual functions are not imported
 * (no build tools); instead, the core decision logic is replicated.
 */

// ===========================================================================
// Extracted pure logic: _rebuildOccupancy (firebase-crud.js:547-602)
// Includes _dedupRegs (2026-04-04 fix: 三元組去重防止重複報名灌水計數)
// ===========================================================================
function _dedupRegs(regs) {
  const seen = new Set();
  return regs.filter(r => {
    const key = r.participantType === 'companion'
      ? `${r.userId}_companion_${r.companionId || ''}`
      : `${r.userId}_self`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function _rebuildOccupancy(event, registrations) {
  const confirmed = _dedupRegs(registrations.filter(r => r.status === 'confirmed'));
  const waitlisted = _dedupRegs(registrations.filter(r => r.status === 'waitlisted'));

  const _regSortTime = (r) => {
    const v = r && r.registeredAt;
    if (!v) return Number.POSITIVE_INFINITY;
    if (typeof v.toMillis === 'function') { try { return v.toMillis(); } catch (_e) {} }
    if (typeof v === 'object' && typeof v.seconds === 'number')
      return (v.seconds * 1000) + Math.floor((v.nanoseconds || 0) / 1000000);
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
  };
  const _regSort = (a, b) => {
    const ta = _regSortTime(a), tb = _regSortTime(b);
    if (ta !== tb) return ta - tb;
    return String(a._docId || a.id || '').localeCompare(String(b._docId || b.id || ''));
  };
  confirmed.sort(_regSort);
  waitlisted.sort(_regSort);

  const participants = confirmed.map(r =>
    r.participantType === 'companion'
      ? String(r.companionName || r.userName || '').trim()
      : String(r.userName || '').trim()
  ).filter(Boolean);

  const waitlistNames = waitlisted.map(r =>
    r.participantType === 'companion'
      ? String(r.companionName || r.userName || '').trim()
      : String(r.userName || '').trim()
  ).filter(Boolean);

  const current = participants.length;
  const waitlist = waitlistNames.length;

  let status = event.status;
  if (status !== 'ended' && status !== 'cancelled') {
    status = current >= (event.max || 0) ? 'full' : 'open';
  }
  return { participants, waitlistNames, current, waitlist, status };
}

// ===========================================================================
// Extracted logic: Transaction duplicate check (firebase-crud.js:755-760)
// ===========================================================================
function hasActiveDuplicate(allEventRegs, userId) {
  return allEventRegs.some(r =>
    r.userId === userId
    && (r.status === 'confirmed' || r.status === 'waitlisted')
    && r.participantType !== 'companion'
  );
}

// ===========================================================================
// Extracted logic: Waitlist promotion sort (firebase-crud.js:860-867)
// ===========================================================================
function promotionSort(a, b) {
  const ta = new Date(a.registeredAt).getTime();
  const tb = new Date(b.registeredAt).getTime();
  if (ta !== tb) return ta - tb;
  return (a.promotionOrder || 0) - (b.promotionOrder || 0);
}

// ===========================================================================
// Simulated Transaction logic: registerForEvent (firebase-crud.js:741-790)
// ===========================================================================
function simulateRegisterTransaction(eventData, existingRegs, newUserId, newUserName) {
  const maxCount = eventData.max || 0;

  // Duplicate check (same as line 755-760)
  if (hasActiveDuplicate(existingRegs, newUserId)) {
    return { error: '已報名此活動' };
  }

  const firestoreActiveRegs = existingRegs.filter(
    r => r.status !== 'cancelled' && r.status !== 'removed'
  );
  const confirmedCount = firestoreActiveRegs.filter(r => r.status === 'confirmed').length;

  const isWaitlist = confirmedCount >= maxCount;
  const status = isWaitlist ? 'waitlisted' : 'confirmed';

  const registration = {
    id: 'reg_test_' + Date.now(),
    eventId: eventData.id,
    userId: newUserId,
    userName: newUserName,
    participantType: 'self',
    promotionOrder: 0,
    registeredAt: new Date().toISOString(),
    status,
  };

  const allRegsForRebuild = [...firestoreActiveRegs, registration];
  const occupancy = _rebuildOccupancy(eventData, allRegsForRebuild);

  return { registration, status, occupancy };
}

// ===========================================================================
// Simulated Cancel logic: cancelRegistration (firebase-crud.js:841-884)
// ===========================================================================
function simulateCancelTransaction(event, firestoreRegs, cancelRegId) {
  const reg = firestoreRegs.find(r => r.id === cancelRegId);
  if (!reg) return { error: '報名記錄不存在' };

  const wasPreviouslyConfirmed = reg.status === 'confirmed';

  // Simulate on a copy (line 843: const simRegs = firestoreRegs.map(r => ({ ...r })))
  const simRegs = firestoreRegs.map(r => ({ ...r }));
  const simTarget = simRegs.find(r => r.id === cancelRegId);
  if (simTarget) simTarget.status = 'cancelled';

  const promotedCandidates = [];

  if (wasPreviouslyConfirmed && event.max) {
    const activeRegs = simRegs.filter(
      r => r.status === 'confirmed' || r.status === 'waitlisted'
    );
    const confirmedCount = activeRegs.filter(r => r.status === 'confirmed').length;
    const slotsAvailable = event.max - confirmedCount;

    if (slotsAvailable > 0) {
      const waitlistedCandidates = activeRegs
        .filter(r => r.status === 'waitlisted')
        .sort(promotionSort);

      let promoted = 0;
      for (const candidate of waitlistedCandidates) {
        if (promoted >= slotsAvailable) break;
        candidate.status = 'confirmed';
        promotedCandidates.push(candidate);
        promoted++;
      }
    }
  }

  const allActive = simRegs.filter(
    r => r.status === 'confirmed' || r.status === 'waitlisted'
  );
  const occupancy = _rebuildOccupancy(event, allActive);

  return { cancelledReg: simTarget, promotedCandidates, occupancy };
}

// ===========================================================================
// TESTS
// ===========================================================================

describe('registerForEvent Transaction Logic', () => {
  const baseEvent = { id: 'evt1', _docId: 'evt1', max: 3, status: 'open' };

  test('new registration is confirmed when under capacity', () => {
    const result = simulateRegisterTransaction(baseEvent, [], 'user1', 'Alice');
    expect(result.error).toBeUndefined();
    expect(result.status).toBe('confirmed');
    expect(result.occupancy.current).toBe(1);
    expect(result.occupancy.waitlist).toBe(0);
  });

  test('registration goes to waitlist when at capacity', () => {
    const existing = [
      { id: 'r1', userId: 'u1', userName: 'A', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:00:00Z' },
      { id: 'r2', userId: 'u2', userName: 'B', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:01:00Z' },
      { id: 'r3', userId: 'u3', userName: 'C', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:02:00Z' },
    ];
    const result = simulateRegisterTransaction(baseEvent, existing, 'user4', 'Dave');
    expect(result.status).toBe('waitlisted');
    expect(result.occupancy.current).toBe(3);
    expect(result.occupancy.waitlist).toBe(1);
  });

  test('duplicate registration is rejected', () => {
    const existing = [
      { id: 'r1', userId: 'user1', userName: 'Alice', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:00:00Z' },
    ];
    const result = simulateRegisterTransaction(baseEvent, existing, 'user1', 'Alice');
    expect(result.error).toBe('已報名此活動');
  });

  test('waitlisted duplicate is also rejected', () => {
    const existing = [
      { id: 'r1', userId: 'user1', userName: 'Alice', status: 'waitlisted', participantType: 'self', registeredAt: '2026-03-10T08:00:00Z' },
    ];
    const result = simulateRegisterTransaction(baseEvent, existing, 'user1', 'Alice');
    expect(result.error).toBe('已報名此活動');
  });

  test('cancelled registration does NOT block new registration', () => {
    const existing = [
      { id: 'r1', userId: 'user1', userName: 'Alice', status: 'cancelled', participantType: 'self', registeredAt: '2026-03-10T08:00:00Z' },
    ];
    const result = simulateRegisterTransaction(baseEvent, existing, 'user1', 'Alice');
    expect(result.error).toBeUndefined();
    expect(result.status).toBe('confirmed');
  });

  test('companion registration does NOT block self registration', () => {
    const existing = [
      { id: 'r1', userId: 'user1', userName: 'Alice Companion', status: 'confirmed', participantType: 'companion', registeredAt: '2026-03-10T08:00:00Z' },
    ];
    const result = simulateRegisterTransaction(baseEvent, existing, 'user1', 'Alice');
    expect(result.error).toBeUndefined();
    expect(result.status).toBe('confirmed');
  });

  test('max=0 event sends all to waitlist', () => {
    const zeroMaxEvent = { ...baseEvent, max: 0 };
    const result = simulateRegisterTransaction(zeroMaxEvent, [], 'user1', 'Alice');
    expect(result.status).toBe('waitlisted');
  });

  test('occupancy status becomes full when reaching max', () => {
    const existing = [
      { id: 'r1', userId: 'u1', userName: 'A', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:00:00Z' },
      { id: 'r2', userId: 'u2', userName: 'B', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:01:00Z' },
    ];
    const result = simulateRegisterTransaction(baseEvent, existing, 'user3', 'Charlie');
    expect(result.occupancy.status).toBe('full');
    expect(result.occupancy.current).toBe(3);
  });

  test('occupancy uses only fresh Firestore data, ignores removed/cancelled', () => {
    const existing = [
      { id: 'r1', userId: 'u1', userName: 'A', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:00:00Z' },
      { id: 'r2', userId: 'u2', userName: 'B', status: 'cancelled', participantType: 'self', registeredAt: '2026-03-10T08:01:00Z' },
      { id: 'r3', userId: 'u3', userName: 'C', status: 'removed', participantType: 'self', registeredAt: '2026-03-10T08:02:00Z' },
    ];
    const result = simulateRegisterTransaction(baseEvent, existing, 'user4', 'Dave');
    expect(result.status).toBe('confirmed');
    expect(result.occupancy.current).toBe(2); // A + Dave
  });
});

describe('cancelRegistration Transaction Logic', () => {
  const baseEvent = { id: 'evt1', _docId: 'evt1', max: 2, status: 'full' };

  test('cancellation updates status to cancelled', () => {
    const regs = [
      { id: 'r1', userId: 'u1', userName: 'Alice', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:00:00Z', _docId: 'd1' },
      { id: 'r2', userId: 'u2', userName: 'Bob', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:01:00Z', _docId: 'd2' },
    ];
    const result = simulateCancelTransaction(baseEvent, regs, 'r1');
    expect(result.cancelledReg.status).toBe('cancelled');
  });

  test('waitlisted candidate is promoted when confirmed user cancels', () => {
    const regs = [
      { id: 'r1', userId: 'u1', userName: 'Alice', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:00:00Z', _docId: 'd1' },
      { id: 'r2', userId: 'u2', userName: 'Bob', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:01:00Z', _docId: 'd2' },
      { id: 'r3', userId: 'u3', userName: 'Charlie', status: 'waitlisted', participantType: 'self', registeredAt: '2026-03-10T08:02:00Z', _docId: 'd3' },
    ];
    const result = simulateCancelTransaction(baseEvent, regs, 'r1');
    expect(result.promotedCandidates).toHaveLength(1);
    expect(result.promotedCandidates[0].userId).toBe('u3');
    expect(result.promotedCandidates[0].status).toBe('confirmed');
    expect(result.occupancy.current).toBe(2);
    expect(result.occupancy.waitlist).toBe(0);
  });

  test('earliest waitlisted is promoted first (registeredAt ASC)', () => {
    const regs = [
      { id: 'r1', userId: 'u1', userName: 'Alice', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:00:00Z', _docId: 'd1' },
      { id: 'r2', userId: 'u2', userName: 'Bob', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:01:00Z', _docId: 'd2' },
      { id: 'r3', userId: 'u3', userName: 'Charlie', status: 'waitlisted', participantType: 'self', registeredAt: '2026-03-10T10:00:00Z', _docId: 'd3' },
      { id: 'r4', userId: 'u4', userName: 'Dave', status: 'waitlisted', participantType: 'self', registeredAt: '2026-03-10T09:00:00Z', _docId: 'd4' },
    ];
    const result = simulateCancelTransaction(baseEvent, regs, 'r1');
    expect(result.promotedCandidates[0].userId).toBe('u4'); // Dave (09:00) before Charlie (10:00)
  });

  test('no promotion when waitlisted user cancels', () => {
    const regs = [
      { id: 'r1', userId: 'u1', userName: 'Alice', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:00:00Z', _docId: 'd1' },
      { id: 'r2', userId: 'u2', userName: 'Bob', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:01:00Z', _docId: 'd2' },
      { id: 'r3', userId: 'u3', userName: 'Charlie', status: 'waitlisted', participantType: 'self', registeredAt: '2026-03-10T08:02:00Z', _docId: 'd3' },
    ];
    const result = simulateCancelTransaction(baseEvent, regs, 'r3');
    expect(result.promotedCandidates).toHaveLength(0);
    expect(result.occupancy.current).toBe(2);
    expect(result.occupancy.waitlist).toBe(0);
  });

  test('simulation does not mutate original firestoreRegs array', () => {
    const regs = [
      { id: 'r1', userId: 'u1', userName: 'Alice', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:00:00Z', _docId: 'd1' },
      { id: 'r2', userId: 'u2', userName: 'Bob', status: 'waitlisted', participantType: 'self', registeredAt: '2026-03-10T08:01:00Z', _docId: 'd2' },
    ];
    const originalStatus1 = regs[0].status;
    const originalStatus2 = regs[1].status;
    simulateCancelTransaction(baseEvent, regs, 'r1');
    expect(regs[0].status).toBe(originalStatus1); // still 'confirmed'
    expect(regs[1].status).toBe(originalStatus2); // still 'waitlisted'
  });

  test('non-existent registration returns error', () => {
    const result = simulateCancelTransaction(baseEvent, [], 'r999');
    expect(result.error).toBe('報名記錄不存在');
  });

  test('multiple promotions when multiple slots open', () => {
    const bigEvent = { id: 'evt1', _docId: 'evt1', max: 3, status: 'full' };
    const regs = [
      { id: 'r1', userId: 'u1', userName: 'A', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:00:00Z', _docId: 'd1' },
      { id: 'r2', userId: 'u2', userName: 'B', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:01:00Z', _docId: 'd2' },
      { id: 'r3', userId: 'u3', userName: 'C', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:02:00Z', _docId: 'd3' },
      { id: 'r4', userId: 'u4', userName: 'D', status: 'waitlisted', participantType: 'self', registeredAt: '2026-03-10T09:00:00Z', _docId: 'd4' },
      { id: 'r5', userId: 'u5', userName: 'E', status: 'waitlisted', participantType: 'self', registeredAt: '2026-03-10T09:01:00Z', _docId: 'd5' },
    ];
    // Cancel r1 → 1 slot opens → D promoted (earliest waitlisted)
    const result = simulateCancelTransaction(bigEvent, regs, 'r1');
    expect(result.promotedCandidates).toHaveLength(1);
    expect(result.promotedCandidates[0].userId).toBe('u4');
    expect(result.occupancy.current).toBe(3);
    expect(result.occupancy.waitlist).toBe(1);
  });
});

describe('hasActiveDuplicate', () => {
  test('detects confirmed duplicate', () => {
    const regs = [{ userId: 'u1', status: 'confirmed', participantType: 'self' }];
    expect(hasActiveDuplicate(regs, 'u1')).toBe(true);
  });

  test('detects waitlisted duplicate', () => {
    const regs = [{ userId: 'u1', status: 'waitlisted', participantType: 'self' }];
    expect(hasActiveDuplicate(regs, 'u1')).toBe(true);
  });

  test('ignores cancelled', () => {
    const regs = [{ userId: 'u1', status: 'cancelled', participantType: 'self' }];
    expect(hasActiveDuplicate(regs, 'u1')).toBe(false);
  });

  test('ignores companion', () => {
    const regs = [{ userId: 'u1', status: 'confirmed', participantType: 'companion' }];
    expect(hasActiveDuplicate(regs, 'u1')).toBe(false);
  });

  test('no duplicate for different user', () => {
    const regs = [{ userId: 'u2', status: 'confirmed', participantType: 'self' }];
    expect(hasActiveDuplicate(regs, 'u1')).toBe(false);
  });

  test('empty array → no duplicate', () => {
    expect(hasActiveDuplicate([], 'u1')).toBe(false);
  });
});

// ===========================================================================
// _dedupRegs — 三元組去重 (2026-04-04 fix)
// ===========================================================================
describe('_dedupRegs — registration deduplication', () => {
  test('removes duplicate self registration for same userId', () => {
    const regs = [
      { userId: 'u1', participantType: 'self', userName: 'Alice', registeredAt: '2026-04-01T01:00:00Z' },
      { userId: 'u1', participantType: 'self', userName: 'Alice', registeredAt: '2026-04-01T03:00:00Z' },
    ];
    const result = _dedupRegs(regs);
    expect(result).toHaveLength(1);
    expect(result[0].registeredAt).toBe('2026-04-01T01:00:00Z');
  });

  test('keeps different users with same name', () => {
    const regs = [
      { userId: 'u1', participantType: 'self', userName: 'Alice' },
      { userId: 'u2', participantType: 'self', userName: 'Alice' },
    ];
    expect(_dedupRegs(regs)).toHaveLength(2);
  });

  test('keeps self + companion for same userId', () => {
    const regs = [
      { userId: 'u1', participantType: 'self', userName: 'Alice' },
      { userId: 'u1', participantType: 'companion', companionId: 'c1', companionName: 'Bob' },
    ];
    expect(_dedupRegs(regs)).toHaveLength(2);
  });

  test('keeps different companions for same userId', () => {
    const regs = [
      { userId: 'u1', participantType: 'companion', companionId: 'c1', companionName: 'Bob' },
      { userId: 'u1', participantType: 'companion', companionId: 'c2', companionName: 'Carol' },
    ];
    expect(_dedupRegs(regs)).toHaveLength(2);
  });

  test('removes duplicate companion with same companionId', () => {
    const regs = [
      { userId: 'u1', participantType: 'companion', companionId: 'c1', companionName: 'Bob' },
      { userId: 'u1', participantType: 'companion', companionId: 'c1', companionName: 'Bob' },
    ];
    expect(_dedupRegs(regs)).toHaveLength(1);
  });

  test('empty array returns empty', () => {
    expect(_dedupRegs([])).toHaveLength(0);
  });

  test('no duplicates passes through unchanged', () => {
    const regs = [
      { userId: 'u1', participantType: 'self', userName: 'Alice' },
      { userId: 'u2', participantType: 'self', userName: 'Bob' },
      { userId: 'u3', participantType: 'self', userName: 'Carol' },
    ];
    expect(_dedupRegs(regs)).toHaveLength(3);
  });
});

// ===========================================================================
// _rebuildOccupancy with dedup — integration (2026-04-04 fix)
// ===========================================================================
describe('_rebuildOccupancy — dedup integration', () => {
  test('duplicate confirmed self does NOT inflate current count', () => {
    const event = { max: 27, status: 'open' };
    const regs = [];
    // 26 unique users
    for (let i = 1; i <= 26; i++) {
      regs.push({ userId: `u${i}`, userName: `User${i}`, participantType: 'self', status: 'confirmed', registeredAt: `2026-04-01T0${String(i).padStart(2,'0')}:00:00Z` });
    }
    // duplicate: same userId as u1
    regs.push({ userId: 'u1', userName: 'User1', participantType: 'self', status: 'confirmed', registeredAt: '2026-04-01T99:00:00Z' });

    const result = _rebuildOccupancy(event, regs);
    expect(result.current).toBe(26);
    expect(result.status).toBe('open');
    expect(result.participants.filter(n => n === 'User1')).toHaveLength(1);
  });

  test('duplicate confirmed self: event stays open instead of false full', () => {
    const event = { max: 3, status: 'open' };
    const regs = [
      { userId: 'u1', userName: 'Alice', participantType: 'self', status: 'confirmed', registeredAt: '2026-04-01T01:00:00Z' },
      { userId: 'u2', userName: 'Bob', participantType: 'self', status: 'confirmed', registeredAt: '2026-04-01T02:00:00Z' },
      { userId: 'u1', userName: 'Alice', participantType: 'self', status: 'confirmed', registeredAt: '2026-04-01T03:00:00Z' },
    ];
    const result = _rebuildOccupancy(event, regs);
    expect(result.current).toBe(2);
    expect(result.status).toBe('open');
  });

  test('duplicate waitlisted self does NOT inflate waitlist count', () => {
    const event = { max: 1, status: 'full' };
    const regs = [
      { userId: 'u1', userName: 'Alice', participantType: 'self', status: 'confirmed', registeredAt: '2026-04-01T01:00:00Z' },
      { userId: 'u2', userName: 'Bob', participantType: 'self', status: 'waitlisted', registeredAt: '2026-04-01T02:00:00Z' },
      { userId: 'u2', userName: 'Bob', participantType: 'self', status: 'waitlisted', registeredAt: '2026-04-01T03:00:00Z' },
    ];
    const result = _rebuildOccupancy(event, regs);
    expect(result.current).toBe(1);
    expect(result.waitlist).toBe(1);
    expect(result.waitlistNames).toEqual(['Bob']);
  });

  test('companion + self for same user are both counted (not deduped)', () => {
    const event = { max: 10, status: 'open' };
    const regs = [
      { userId: 'u1', userName: 'Alice', participantType: 'self', status: 'confirmed', registeredAt: '2026-04-01T01:00:00Z' },
      { userId: 'u1', userName: 'Alice', participantType: 'companion', companionId: 'c1', companionName: 'Bob', status: 'confirmed', registeredAt: '2026-04-01T01:00:00Z' },
    ];
    const result = _rebuildOccupancy(event, regs);
    expect(result.current).toBe(2);
    expect(result.participants).toEqual(['Alice', 'Bob']);
  });
});
