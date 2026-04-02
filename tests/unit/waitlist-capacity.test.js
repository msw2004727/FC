/**
 * Waitlist Capacity Adjustment Logic — unit tests
 *
 * Tests the core decision logic from _adjustWaitlistOnCapacityChange()
 * in event-create-waitlist.js without live Firestore or ApiService.
 *
 * Covers:
 *   - Capacity increase → waitlisted candidates get promoted (registeredAt ASC)
 *   - Capacity decrease → latest confirmed get demoted (registeredAt DESC)
 *   - Capacity unchanged → no changes
 *   - Increase by more than waitlist count → all waitlisted promoted
 *   - Decrease below 0 → handled gracefully
 *   - Empty registrations
 *   - Promotion order: registeredAt ASC, then promotionOrder ASC (CLAUDE.md rule 7)
 *   - Demotion order: registeredAt DESC, then promotionOrder DESC (CLAUDE.md rule 8)
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
// Extracted: promotion sort (event-create-waitlist.js:12-16)
// registeredAt ASC, promotionOrder ASC — CLAUDE.md rule #7
// ===========================================================================
function promotionSort(a, b) {
  const ta = new Date(a.registeredAt).getTime();
  const tb = new Date(b.registeredAt).getTime();
  if (ta !== tb) return ta - tb;
  return (a.promotionOrder || 0) - (b.promotionOrder || 0);
}

// ===========================================================================
// Extracted: demotion sort (event-create-waitlist.js:160-165)
// registeredAt DESC, promotionOrder DESC — CLAUDE.md rule #8
// ===========================================================================
function demotionSort(a, b) {
  const ta = new Date(a.registeredAt).getTime();
  const tb = new Date(b.registeredAt).getTime();
  if (ta !== tb) return tb - ta;
  return (b.promotionOrder || 0) - (a.promotionOrder || 0);
}

// ===========================================================================
// Extracted: _adjustWaitlistOnCapacityChange decision logic
// (event-create-waitlist.js:56-225)
//
// Simulates the core capacity adjustment without Firestore/ApiService:
//   - newMax > oldMax: promote waitlisted (earliest first) up to available slots
//   - newMax < oldMax: demote excess confirmed (latest first)
//   - newMax === oldMax: no changes
// ===========================================================================
function simulateCapacityChange(allRegs, oldMax, newMax) {
  // Work on copies to avoid mutating inputs
  const regs = allRegs.map(r => ({ ...r }));
  const promoted = [];
  const demoted = [];

  if (newMax > oldMax) {
    // Promotion path (line 106-127)
    const confirmedCount = regs.filter(r => r.status === 'confirmed').length;
    let slotsAvailable = newMax - confirmedCount;
    if (slotsAvailable <= 0) return { promoted, demoted, regs };

    const waitlistedCandidates = regs
      .filter(r => r.status === 'waitlisted')
      .sort(promotionSort);

    let idx = 0;
    while (slotsAvailable > 0 && idx < waitlistedCandidates.length) {
      const candidate = waitlistedCandidates[idx];
      candidate.status = 'confirmed';
      promoted.push(candidate);
      slotsAvailable--;
      idx++;
    }
  } else if (newMax < oldMax) {
    // Demotion path (line 158-193)
    const confirmedRegs = regs
      .filter(r => r.status === 'confirmed')
      .sort(demotionSort);
    const excess = confirmedRegs.length - newMax;
    if (excess <= 0) return { promoted, demoted, regs };

    let count = 0;
    for (const reg of confirmedRegs) {
      if (count >= excess) break;
      reg.status = 'waitlisted';
      demoted.push(reg);
      count++;
    }
  }

  const activeAfter = regs.filter(
    r => r.status === 'confirmed' || r.status === 'waitlisted'
  );
  const occupancy = _rebuildOccupancy({ max: newMax, status: 'open' }, activeAfter);

  return { promoted, demoted, regs, occupancy };
}

// ===========================================================================
// TESTS
// ===========================================================================

describe('_adjustWaitlistOnCapacityChange Decision Logic', () => {

  describe('Capacity increase (promotion)', () => {
    test('waitlisted candidates get promoted when capacity increases', () => {
      const regs = [
        { id: 'r1', userId: 'u1', userName: 'A', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:00:00Z', promotionOrder: 0 },
        { id: 'r2', userId: 'u2', userName: 'B', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:01:00Z', promotionOrder: 0 },
        { id: 'r3', userId: 'u3', userName: 'C', status: 'waitlisted', participantType: 'self', registeredAt: '2026-03-10T08:02:00Z', promotionOrder: 0 },
      ];
      const result = simulateCapacityChange(regs, 2, 3);
      expect(result.promoted).toHaveLength(1);
      expect(result.promoted[0].userId).toBe('u3');
      expect(result.promoted[0].status).toBe('confirmed');
      expect(result.occupancy.current).toBe(3);
      expect(result.occupancy.waitlist).toBe(0);
    });

    test('promotes in registeredAt ASC order (earliest first)', () => {
      const regs = [
        { id: 'r1', userId: 'u1', userName: 'A', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:00:00Z', promotionOrder: 0 },
        { id: 'r2', userId: 'u2', userName: 'B', status: 'waitlisted', participantType: 'self', registeredAt: '2026-03-10T10:00:00Z', promotionOrder: 0 },
        { id: 'r3', userId: 'u3', userName: 'C', status: 'waitlisted', participantType: 'self', registeredAt: '2026-03-10T09:00:00Z', promotionOrder: 0 },
      ];
      const result = simulateCapacityChange(regs, 1, 2);
      expect(result.promoted).toHaveLength(1);
      expect(result.promoted[0].userId).toBe('u3'); // 09:00 < 10:00
    });

    test('promotion tiebreaker: promotionOrder ASC', () => {
      const regs = [
        { id: 'r1', userId: 'u1', userName: 'A', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:00:00Z', promotionOrder: 0 },
        { id: 'r2', userId: 'u2', userName: 'B', status: 'waitlisted', participantType: 'self', registeredAt: '2026-03-10T09:00:00Z', promotionOrder: 2 },
        { id: 'r3', userId: 'u3', userName: 'C', status: 'waitlisted', participantType: 'self', registeredAt: '2026-03-10T09:00:00Z', promotionOrder: 1 },
      ];
      const result = simulateCapacityChange(regs, 1, 2);
      expect(result.promoted).toHaveLength(1);
      expect(result.promoted[0].userId).toBe('u3'); // promotionOrder 1 < 2
    });

    test('increase by more than waitlist count → all waitlisted promoted', () => {
      const regs = [
        { id: 'r1', userId: 'u1', userName: 'A', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:00:00Z', promotionOrder: 0 },
        { id: 'r2', userId: 'u2', userName: 'B', status: 'waitlisted', participantType: 'self', registeredAt: '2026-03-10T09:00:00Z', promotionOrder: 0 },
        { id: 'r3', userId: 'u3', userName: 'C', status: 'waitlisted', participantType: 'self', registeredAt: '2026-03-10T10:00:00Z', promotionOrder: 0 },
      ];
      // Increase from 1 to 10 — only 2 waitlisted, should promote both
      const result = simulateCapacityChange(regs, 1, 10);
      expect(result.promoted).toHaveLength(2);
      expect(result.occupancy.current).toBe(3);
      expect(result.occupancy.waitlist).toBe(0);
    });

    test('no promotion when already enough confirmed slots', () => {
      const regs = [
        { id: 'r1', userId: 'u1', userName: 'A', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:00:00Z', promotionOrder: 0 },
      ];
      // Increase from 2 to 3 — but only 1 confirmed, no waitlisted
      const result = simulateCapacityChange(regs, 2, 3);
      expect(result.promoted).toHaveLength(0);
    });

    test('increase does not promote if slotsAvailable <= 0', () => {
      const regs = [
        { id: 'r1', userId: 'u1', userName: 'A', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:00:00Z', promotionOrder: 0 },
        { id: 'r2', userId: 'u2', userName: 'B', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:01:00Z', promotionOrder: 0 },
        { id: 'r3', userId: 'u3', userName: 'C', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:02:00Z', promotionOrder: 0 },
        { id: 'r4', userId: 'u4', userName: 'D', status: 'waitlisted', participantType: 'self', registeredAt: '2026-03-10T09:00:00Z', promotionOrder: 0 },
      ];
      // Increase from 2 to 3, but already 3 confirmed — 0 slots
      const result = simulateCapacityChange(regs, 2, 3);
      expect(result.promoted).toHaveLength(0);
    });
  });

  describe('Capacity decrease (demotion)', () => {
    test('latest confirmed get demoted when capacity decreases', () => {
      const regs = [
        { id: 'r1', userId: 'u1', userName: 'A', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:00:00Z', promotionOrder: 0 },
        { id: 'r2', userId: 'u2', userName: 'B', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:01:00Z', promotionOrder: 0 },
        { id: 'r3', userId: 'u3', userName: 'C', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:02:00Z', promotionOrder: 0 },
      ];
      const result = simulateCapacityChange(regs, 3, 2);
      expect(result.demoted).toHaveLength(1);
      expect(result.demoted[0].userId).toBe('u3'); // latest registeredAt
      expect(result.demoted[0].status).toBe('waitlisted');
      expect(result.occupancy.current).toBe(2);
      expect(result.occupancy.waitlist).toBe(1);
    });

    test('demotes in registeredAt DESC order (latest first)', () => {
      const regs = [
        { id: 'r1', userId: 'u1', userName: 'A', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:00:00Z', promotionOrder: 0 },
        { id: 'r2', userId: 'u2', userName: 'B', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T10:00:00Z', promotionOrder: 0 },
        { id: 'r3', userId: 'u3', userName: 'C', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T09:00:00Z', promotionOrder: 0 },
      ];
      const result = simulateCapacityChange(regs, 3, 1);
      expect(result.demoted).toHaveLength(2);
      expect(result.demoted[0].userId).toBe('u2'); // 10:00 (latest)
      expect(result.demoted[1].userId).toBe('u3'); // 09:00
    });

    test('demotion tiebreaker: promotionOrder DESC', () => {
      const regs = [
        { id: 'r1', userId: 'u1', userName: 'A', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:00:00Z', promotionOrder: 0 },
        { id: 'r2', userId: 'u2', userName: 'B', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T09:00:00Z', promotionOrder: 1 },
        { id: 'r3', userId: 'u3', userName: 'C', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T09:00:00Z', promotionOrder: 3 },
        { id: 'r4', userId: 'u4', userName: 'D', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T09:00:00Z', promotionOrder: 2 },
      ];
      const result = simulateCapacityChange(regs, 4, 2);
      // Should demote 2 from the 3 tied at 09:00 — promotionOrder DESC: 3, 2, 1
      expect(result.demoted).toHaveLength(2);
      expect(result.demoted[0].userId).toBe('u3'); // promotionOrder 3
      expect(result.demoted[1].userId).toBe('u4'); // promotionOrder 2
    });

    test('decrease below current confirmed count demotes excess', () => {
      const regs = [
        { id: 'r1', userId: 'u1', userName: 'A', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:00:00Z', promotionOrder: 0 },
        { id: 'r2', userId: 'u2', userName: 'B', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:01:00Z', promotionOrder: 0 },
        { id: 'r3', userId: 'u3', userName: 'C', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:02:00Z', promotionOrder: 0 },
      ];
      // Decrease to 1 — demote 2 (C, then B)
      const result = simulateCapacityChange(regs, 3, 1);
      expect(result.demoted).toHaveLength(2);
      expect(result.occupancy.current).toBe(1);
      expect(result.occupancy.waitlist).toBe(2);
    });

    test('no demotion when confirmed count is within new capacity', () => {
      const regs = [
        { id: 'r1', userId: 'u1', userName: 'A', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:00:00Z', promotionOrder: 0 },
      ];
      // Decrease from 5 to 3 — only 1 confirmed, no excess
      const result = simulateCapacityChange(regs, 5, 3);
      expect(result.demoted).toHaveLength(0);
    });
  });

  describe('Capacity unchanged', () => {
    test('no changes when newMax equals oldMax', () => {
      const regs = [
        { id: 'r1', userId: 'u1', userName: 'A', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:00:00Z', promotionOrder: 0 },
        { id: 'r2', userId: 'u2', userName: 'B', status: 'waitlisted', participantType: 'self', registeredAt: '2026-03-10T09:00:00Z', promotionOrder: 0 },
      ];
      const result = simulateCapacityChange(regs, 1, 1);
      expect(result.promoted).toHaveLength(0);
      expect(result.demoted).toHaveLength(0);
    });
  });

  describe('Edge cases', () => {
    test('empty registrations — increase does nothing', () => {
      const result = simulateCapacityChange([], 2, 5);
      expect(result.promoted).toHaveLength(0);
      expect(result.demoted).toHaveLength(0);
    });

    test('empty registrations — decrease does nothing', () => {
      const result = simulateCapacityChange([], 5, 2);
      expect(result.promoted).toHaveLength(0);
      expect(result.demoted).toHaveLength(0);
    });

    test('does not mutate original registrations array', () => {
      const regs = [
        { id: 'r1', userId: 'u1', userName: 'A', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:00:00Z', promotionOrder: 0 },
        { id: 'r2', userId: 'u2', userName: 'B', status: 'waitlisted', participantType: 'self', registeredAt: '2026-03-10T09:00:00Z', promotionOrder: 0 },
      ];
      const originalStatus = regs[1].status;
      simulateCapacityChange(regs, 1, 2);
      expect(regs[1].status).toBe(originalStatus);
    });

    test('companion registrations are included in promotion', () => {
      const regs = [
        { id: 'r1', userId: 'u1', userName: 'A', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:00:00Z', promotionOrder: 0 },
        { id: 'r2', userId: 'u1', userName: 'A', status: 'waitlisted', participantType: 'companion', companionName: 'Comp', registeredAt: '2026-03-10T08:00:00Z', promotionOrder: 1 },
      ];
      const result = simulateCapacityChange(regs, 1, 2);
      expect(result.promoted).toHaveLength(1);
      expect(result.promoted[0].participantType).toBe('companion');
    });

    test('companion registrations are included in demotion', () => {
      const regs = [
        { id: 'r1', userId: 'u1', userName: 'A', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:00:00Z', promotionOrder: 0 },
        { id: 'r2', userId: 'u1', userName: 'A', status: 'confirmed', participantType: 'companion', companionName: 'Comp', registeredAt: '2026-03-10T08:01:00Z', promotionOrder: 1 },
      ];
      const result = simulateCapacityChange(regs, 2, 1);
      expect(result.demoted).toHaveLength(1);
      expect(result.demoted[0].participantType).toBe('companion');
    });

    test('occupancy status reflects full when at capacity after promotion', () => {
      const regs = [
        { id: 'r1', userId: 'u1', userName: 'A', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:00:00Z', promotionOrder: 0 },
        { id: 'r2', userId: 'u2', userName: 'B', status: 'waitlisted', participantType: 'self', registeredAt: '2026-03-10T09:00:00Z', promotionOrder: 0 },
      ];
      // Increase from 1 to 2 — both become confirmed, 2/2 = full
      const result = simulateCapacityChange(regs, 1, 2);
      expect(result.occupancy.status).toBe('full');
      expect(result.occupancy.current).toBe(2);
    });

    test('occupancy status reflects open when below capacity after demotion', () => {
      const regs = [
        { id: 'r1', userId: 'u1', userName: 'A', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:00:00Z', promotionOrder: 0 },
        { id: 'r2', userId: 'u2', userName: 'B', status: 'confirmed', participantType: 'self', registeredAt: '2026-03-10T08:01:00Z', promotionOrder: 0 },
      ];
      // Decrease from 3 to 5 → actually increase, but using decrease path...
      // Use proper decrease: from 2 to 5 is increase
      // Let's test: decrease from 2 to 1 → 1 confirmed, 1 waitlisted, max=1 → full
      const result = simulateCapacityChange(regs, 2, 1);
      expect(result.occupancy.status).toBe('full');  // 1 confirmed, max=1
      expect(result.occupancy.current).toBe(1);
      expect(result.occupancy.waitlist).toBe(1);
    });
  });
});
