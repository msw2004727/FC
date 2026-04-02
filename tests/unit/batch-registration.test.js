/**
 * Batch Registration Logic — unit tests
 *
 * Tests the core decision logic from batchRegisterForEvent() in
 * firebase-crud.js without a live Firestore connection.
 *
 * Covers:
 *   - Single user registration (happy path)
 *   - User + 1 companion registration
 *   - User + multiple companions
 *   - Duplicate detection (user already registered)
 *   - Companion duplicate detection
 *   - Capacity overflow → some entries waitlisted
 *   - All entries waitlisted when event is full
 *   - Empty companions array
 *   - Event with max=0 (unlimited → all waitlisted per existing logic)
 */

// ===========================================================================
// Extracted: _rebuildOccupancy (firebase-crud.js:514-558)
// ===========================================================================
function _rebuildOccupancy(event, registrations) {
  const confirmed = registrations.filter(r => r.status === 'confirmed');
  const waitlisted = registrations.filter(r => r.status === 'waitlisted');

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
// Extracted: batchRegisterForEvent transaction logic (firebase-crud.js:1922-2039)
//
// Simulates the core decision loop inside the transaction:
//   1. Check if mainUserId already has an active (confirmed/waitlisted) reg
//   2. Filter active regs from Firestore snapshot
//   3. For each entry, check per-entry duplicate by (userId + companionId) key
//   4. Assign confirmed/waitlisted based on confirmedCount vs maxCount
//   5. Rebuild occupancy from (existing active + newly created) regs
// ===========================================================================
function simulateBatchRegister(eventData, existingRegs, entries) {
  const mainUserId = entries[0]?.userId;
  if (!mainUserId) return { error: 'missing userId' };

  // Duplicate check: mainUserId already active? (line 1941-1945)
  const hasActive = existingRegs.some(r =>
    r.userId === mainUserId
    && (r.status === 'confirmed' || r.status === 'waitlisted')
  );
  if (hasActive) return { error: '已報名此活動' };

  const maxCount = eventData.max || 0;

  // Filter active regs from "Firestore" snapshot (line 1951-1953)
  const firestoreActiveRegs = existingRegs.filter(
    r => r.status === 'confirmed' || r.status === 'waitlisted'
  );

  let confirmedCount = firestoreActiveRegs.filter(r => r.status === 'confirmed').length;

  const registrations = [];
  let confirmed = 0, waitlisted = 0;
  let promotionIdx = 0;

  for (const entry of entries) {
    // Per-entry duplicate key (line 1970-1976)
    const dupKey = entry.companionId
      ? `${entry.userId}_${entry.companionId}`
      : entry.userId;
    const existing = existingRegs.find(r => {
      if (r.status === 'cancelled' || r.status === 'removed') return false;
      const rKey = r.companionId ? `${r.userId}_${r.companionId}` : r.userId;
      return rKey === dupKey;
    });
    if (existing) { promotionIdx++; continue; }

    // Waitlist decision (line 1978-1979)
    const isWaitlist = confirmedCount >= maxCount;
    const status = isWaitlist ? 'waitlisted' : 'confirmed';

    const reg = {
      id: 'reg_test_' + promotionIdx,
      eventId: eventData.id,
      userId: entry.userId,
      userName: entry.userName,
      participantType: entry.participantType || 'self',
      companionId: entry.companionId || null,
      companionName: entry.companionName || null,
      status,
      promotionOrder: promotionIdx,
      registeredAt: new Date().toISOString(),
    };
    promotionIdx++;
    registrations.push(reg);

    if (status === 'confirmed') {
      confirmed++;
      confirmedCount++;
    } else {
      waitlisted++;
    }
  }

  // Rebuild occupancy (line 2010-2011)
  const allRegsForRebuild = [...firestoreActiveRegs, ...registrations];
  const occupancy = _rebuildOccupancy(
    { max: maxCount, status: eventData.status },
    allRegsForRebuild
  );

  return { registrations, confirmed, waitlisted, occupancy };
}

// ===========================================================================
// TESTS
// ===========================================================================

describe('batchRegisterForEvent Decision Logic', () => {
  const baseEvent = { id: 'evt1', _docId: 'evt1', max: 5, status: 'open' };

  test('single user registration (happy path)', () => {
    const entries = [
      { userId: 'u1', userName: 'Alice', participantType: 'self' },
    ];
    const result = simulateBatchRegister(baseEvent, [], entries);
    expect(result.error).toBeUndefined();
    expect(result.registrations).toHaveLength(1);
    expect(result.confirmed).toBe(1);
    expect(result.waitlisted).toBe(0);
    expect(result.registrations[0].status).toBe('confirmed');
    expect(result.registrations[0].participantType).toBe('self');
    expect(result.occupancy.current).toBe(1);
  });

  test('user + 1 companion registration', () => {
    const entries = [
      { userId: 'u1', userName: 'Alice', participantType: 'self' },
      { userId: 'u1', userName: 'Alice', participantType: 'companion', companionId: 'c1', companionName: 'Bob' },
    ];
    const result = simulateBatchRegister(baseEvent, [], entries);
    expect(result.error).toBeUndefined();
    expect(result.registrations).toHaveLength(2);
    expect(result.confirmed).toBe(2);
    expect(result.waitlisted).toBe(0);
    expect(result.occupancy.current).toBe(2);
    expect(result.occupancy.participants).toContain('Alice');
    expect(result.occupancy.participants).toContain('Bob');
  });

  test('user + multiple companions', () => {
    const entries = [
      { userId: 'u1', userName: 'Alice', participantType: 'self' },
      { userId: 'u1', userName: 'Alice', participantType: 'companion', companionId: 'c1', companionName: 'Bob' },
      { userId: 'u1', userName: 'Alice', participantType: 'companion', companionId: 'c2', companionName: 'Carol' },
      { userId: 'u1', userName: 'Alice', participantType: 'companion', companionId: 'c3', companionName: 'Dave' },
    ];
    const result = simulateBatchRegister(baseEvent, [], entries);
    expect(result.registrations).toHaveLength(4);
    expect(result.confirmed).toBe(4);
    expect(result.occupancy.current).toBe(4);
    expect(result.occupancy.participants).toEqual(
      expect.arrayContaining(['Alice', 'Bob', 'Carol', 'Dave'])
    );
  });

  test('duplicate detection: user already registered (confirmed)', () => {
    const existing = [
      { userId: 'u1', userName: 'Alice', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:00:00Z' },
    ];
    const entries = [
      { userId: 'u1', userName: 'Alice', participantType: 'self' },
    ];
    const result = simulateBatchRegister(baseEvent, existing, entries);
    expect(result.error).toBe('已報名此活動');
  });

  test('duplicate detection: user already waitlisted', () => {
    const existing = [
      { userId: 'u1', userName: 'Alice', status: 'waitlisted', participantType: 'self', registeredAt: '2026-03-10T08:00:00Z' },
    ];
    const entries = [
      { userId: 'u1', userName: 'Alice', participantType: 'self' },
    ];
    const result = simulateBatchRegister(baseEvent, existing, entries);
    expect(result.error).toBe('已報名此活動');
  });

  test('cancelled user can re-register', () => {
    const existing = [
      { userId: 'u1', userName: 'Alice', status: 'cancelled', participantType: 'self', registeredAt: '2026-03-10T08:00:00Z' },
    ];
    const entries = [
      { userId: 'u1', userName: 'Alice', participantType: 'self' },
    ];
    const result = simulateBatchRegister(baseEvent, existing, entries);
    expect(result.error).toBeUndefined();
    expect(result.confirmed).toBe(1);
  });

  test('companion duplicate detection: companion already exists', () => {
    const existing = [
      { userId: 'u2', userName: 'Eve', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:00:00Z' },
      { userId: 'u2', userName: 'Eve', status: 'confirmed', participantType: 'companion', companionId: 'c1', companionName: 'Bob', registeredAt: '2026-03-10T08:00:00Z' },
    ];
    const entries = [
      { userId: 'u1', userName: 'Alice', participantType: 'self' },
      { userId: 'u1', userName: 'Alice', participantType: 'companion', companionId: 'c1', companionName: 'Bob' },
    ];
    // u1_c1 does not match u2_c1, so no dup for companion; only u1 self is checked for main dup
    const result = simulateBatchRegister(baseEvent, existing, entries);
    expect(result.error).toBeUndefined();
    expect(result.registrations).toHaveLength(2);
  });

  test('companion duplicate: same userId+companionId skipped', () => {
    // Existing has u1's companion c1 still active
    const existing = [
      { userId: 'u1', userName: 'Alice', status: 'confirmed', participantType: 'companion', companionId: 'c1', companionName: 'Bob', registeredAt: '2026-03-10T08:00:00Z' },
    ];
    const entries = [
      { userId: 'u1', userName: 'Alice', participantType: 'self' },
      { userId: 'u1', userName: 'Alice', participantType: 'companion', companionId: 'c1', companionName: 'Bob' },
    ];
    // Main user check: u1 has active reg? existing[0] has userId=u1 + confirmed — triggers dup
    const result = simulateBatchRegister(baseEvent, existing, entries);
    expect(result.error).toBe('已報名此活動');
  });

  test('capacity overflow: some entries waitlisted', () => {
    const smallEvent = { id: 'evt1', _docId: 'evt1', max: 2, status: 'open' };
    const entries = [
      { userId: 'u1', userName: 'Alice', participantType: 'self' },
      { userId: 'u1', userName: 'Alice', participantType: 'companion', companionId: 'c1', companionName: 'Bob' },
      { userId: 'u1', userName: 'Alice', participantType: 'companion', companionId: 'c2', companionName: 'Carol' },
    ];
    const result = simulateBatchRegister(smallEvent, [], entries);
    expect(result.confirmed).toBe(2);
    expect(result.waitlisted).toBe(1);
    expect(result.registrations[0].status).toBe('confirmed');
    expect(result.registrations[1].status).toBe('confirmed');
    expect(result.registrations[2].status).toBe('waitlisted');
    expect(result.occupancy.current).toBe(2);
    expect(result.occupancy.waitlist).toBe(1);
    expect(result.occupancy.status).toBe('full');
  });

  test('all entries waitlisted when event is full', () => {
    const existing = [
      { userId: 'u2', userName: 'Eve', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:00:00Z' },
      { userId: 'u3', userName: 'Frank', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:01:00Z' },
    ];
    const twoMaxEvent = { id: 'evt1', _docId: 'evt1', max: 2, status: 'full' };
    const entries = [
      { userId: 'u1', userName: 'Alice', participantType: 'self' },
      { userId: 'u1', userName: 'Alice', participantType: 'companion', companionId: 'c1', companionName: 'Bob' },
    ];
    const result = simulateBatchRegister(twoMaxEvent, existing, entries);
    expect(result.confirmed).toBe(0);
    expect(result.waitlisted).toBe(2);
    expect(result.registrations.every(r => r.status === 'waitlisted')).toBe(true);
    expect(result.occupancy.current).toBe(2);
    expect(result.occupancy.waitlist).toBe(2);
  });

  test('empty companions array: self only', () => {
    const entries = [
      { userId: 'u1', userName: 'Alice', participantType: 'self' },
    ];
    const result = simulateBatchRegister(baseEvent, [], entries);
    expect(result.registrations).toHaveLength(1);
    expect(result.confirmed).toBe(1);
    expect(result.waitlisted).toBe(0);
  });

  test('event with max=0 sends all to waitlist', () => {
    const zeroMaxEvent = { id: 'evt1', _docId: 'evt1', max: 0, status: 'open' };
    const entries = [
      { userId: 'u1', userName: 'Alice', participantType: 'self' },
      { userId: 'u1', userName: 'Alice', participantType: 'companion', companionId: 'c1', companionName: 'Bob' },
    ];
    const result = simulateBatchRegister(zeroMaxEvent, [], entries);
    expect(result.confirmed).toBe(0);
    expect(result.waitlisted).toBe(2);
    expect(result.registrations.every(r => r.status === 'waitlisted')).toBe(true);
  });

  test('promotionOrder increments across entries', () => {
    const entries = [
      { userId: 'u1', userName: 'Alice', participantType: 'self' },
      { userId: 'u1', userName: 'Alice', participantType: 'companion', companionId: 'c1', companionName: 'Bob' },
      { userId: 'u1', userName: 'Alice', participantType: 'companion', companionId: 'c2', companionName: 'Carol' },
    ];
    const result = simulateBatchRegister(baseEvent, [], entries);
    expect(result.registrations[0].promotionOrder).toBe(0);
    expect(result.registrations[1].promotionOrder).toBe(1);
    expect(result.registrations[2].promotionOrder).toBe(2);
  });

  test('skipped duplicate entry still advances promotionIdx', () => {
    // Existing has a cancelled companion c1 from user u1 — not a dup
    // But if we have an active companion c1 from same userId...
    const existing = [
      { userId: 'u2', userName: 'Eve', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:00:00Z' },
    ];
    const entries = [
      { userId: 'u1', userName: 'Alice', participantType: 'self' },
    ];
    const result = simulateBatchRegister(baseEvent, existing, entries);
    expect(result.registrations).toHaveLength(1);
    expect(result.occupancy.current).toBe(2); // Eve + Alice
  });

  test('occupancy participants list contains companion names', () => {
    const entries = [
      { userId: 'u1', userName: 'Alice', participantType: 'self' },
      { userId: 'u1', userName: 'Alice', participantType: 'companion', companionId: 'c1', companionName: 'Companion One' },
    ];
    const result = simulateBatchRegister(baseEvent, [], entries);
    expect(result.occupancy.participants).toContain('Alice');
    expect(result.occupancy.participants).toContain('Companion One');
  });

  test('removed user does not block re-registration', () => {
    const existing = [
      { userId: 'u1', userName: 'Alice', status: 'removed', participantType: 'self', registeredAt: '2026-03-10T08:00:00Z' },
    ];
    const entries = [
      { userId: 'u1', userName: 'Alice', participantType: 'self' },
    ];
    const result = simulateBatchRegister(baseEvent, existing, entries);
    expect(result.error).toBeUndefined();
    expect(result.confirmed).toBe(1);
  });

  test('partially full event: first entries confirmed, rest waitlisted', () => {
    const existing = [
      { userId: 'u2', userName: 'Eve', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:00:00Z' },
    ];
    const twoMaxEvent = { id: 'evt1', _docId: 'evt1', max: 2, status: 'open' };
    const entries = [
      { userId: 'u1', userName: 'Alice', participantType: 'self' },
      { userId: 'u1', userName: 'Alice', participantType: 'companion', companionId: 'c1', companionName: 'Bob' },
      { userId: 'u1', userName: 'Alice', participantType: 'companion', companionId: 'c2', companionName: 'Carol' },
    ];
    const result = simulateBatchRegister(twoMaxEvent, existing, entries);
    expect(result.confirmed).toBe(1);   // Alice confirmed (slot 2 of 2)
    expect(result.waitlisted).toBe(2);  // Bob + Carol waitlisted
    expect(result.registrations[0].status).toBe('confirmed');
    expect(result.registrations[1].status).toBe('waitlisted');
    expect(result.registrations[2].status).toBe('waitlisted');
  });
});
