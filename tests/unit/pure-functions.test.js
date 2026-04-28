/**
 * Pure function unit tests — extracted from the frontend codebase.
 *
 * The project uses Object.assign(App, {...}) (not ES modules), so each
 * function body is copied here as a standalone testable function.
 * A comment above each function notes the source file and line range.
 */

// ---------------------------------------------------------------------------
// Extracted from js/firebase-crud.js:601-678
// Pure function: computes occupancy from event config + registration list
// ---------------------------------------------------------------------------
function _rebuildOccupancy(event, registrations) {
  // 去重：同一 (userId, participantType, companionId) 只保留最早報名的那筆
  const _dedupRegs = (regs) => {
    const seen = new Set();
    return regs.filter(r => {
      const key = r.participantType === 'companion'
        ? `${r.userId}_companion_${r.companionId || ''}`
        : `${r.userId}_self`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

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

  // Phase 1: participantsWithUid / waitlistWithUid (sync with firebase-crud.js)
  const _buildWuEntry = (r) => {
    const isComp = r.participantType === 'companion';
    const uid = isComp
      ? String(r.companionId || (r.userId ? `${r.userId}_${r.companionName || ''}` : '')).trim()
      : String(r.userId || '').trim();
    const name = isComp
      ? String(r.companionName || r.userName || '').trim()
      : String(r.userName || '').trim();
    return { uid, name, teamKey: r.teamKey || null };
  };
  const _isValidWu = (x) => x.uid && x.name && !x.uid.endsWith('_');
  const participantsWithUid = confirmed.map(_buildWuEntry).filter(_isValidWu);
  const waitlistWithUid = waitlisted.map(_buildWuEntry).filter(_isValidWu);

  const current = participants.length;
  const waitlist = waitlistNames.length;

  let status = event.status;
  if (status !== 'ended' && status !== 'cancelled') {
    status = current >= (event.max || 0) ? 'full' : 'open';
  }

  return {
    participants, waitlistNames, current, waitlist, status,
    participantsWithUid, waitlistWithUid,
  };
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/event-list.js:377-381
// Requires a context with _getEventCreatorUid()
// ---------------------------------------------------------------------------
function _isEventDelegate(delegates, myUid) {
  if (!delegates || !delegates.length) return false;
  return delegates.some(d => d.uid === myUid);
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/role.js:71-86
// _isAnyActiveEventDelegate — checks whether the current user is a delegate
// of any scannable (open/full/ended) event, or the preset event.
// Adapted to accept explicit dependencies instead of `this.*` / globals.
// ---------------------------------------------------------------------------
function _isAnyActiveEventDelegate({
  events,
  presetEventId,
  getEvent,
  isEventDelegate,
}) {
  // preset event takes priority (solves timing issue where events list
  // has not loaded yet)
  if (presetEventId) {
    const presetEvent = getEvent(presetEventId);
    if (presetEvent && isEventDelegate(presetEvent)) return true;
  }
  if (!events || !events.length) return false;
  return events.some(e =>
    (e.status === 'open' || e.status === 'full' || e.status === 'ended') &&
    isEventDelegate(e)
  );
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/scan.js:96-123
// _categorizeScanEvents — buckets events into today / past / future.
// Accepts an explicit `now` and `parseDate` so the test can control time.
// ---------------------------------------------------------------------------
function _categorizeScanEvents(events, { now, parseDate }) {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowStart = new Date(todayStart.getTime() + 86400000);

  const buckets = { today: [], past: [], future: [] };
  events.forEach(e => {
    const parsed = parseDate ? parseDate(e.date) : null;
    if (!parsed) { buckets.past.push(e); return; }
    const eventDay = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
    if (eventDay >= todayStart && eventDay < tomorrowStart) {
      buckets.today.push(e);
    } else if (eventDay < todayStart) {
      buckets.past.push(e);
    } else {
      buckets.future.push(e);
    }
  });

  const cmpAsc = (a, b) => (a.date || '').localeCompare(b.date || '');
  const cmpDesc = (a, b) => (b.date || '').localeCompare(a.date || '');
  buckets.today.sort(cmpAsc);
  buckets.past.sort(cmpDesc);
  buckets.future.sort(cmpAsc);

  return buckets;
}

// ===========================================================================
// TESTS
// ===========================================================================

describe('_rebuildOccupancy (js/firebase-crud.js:514-558)', () => {
  test('empty registrations → current=0, waitlist=0, status=open', () => {
    const result = _rebuildOccupancy({ max: 10, status: 'open' }, []);
    expect(result.current).toBe(0);
    expect(result.waitlist).toBe(0);
    expect(result.status).toBe('open');
    expect(result.participants).toEqual([]);
    expect(result.waitlistNames).toEqual([]);
  });

  test('all confirmed, under max → correct count, status=open', () => {
    const regs = [
      { status: 'confirmed', userName: 'Alice', userId: 'u1' },
      { status: 'confirmed', userName: 'Bob', userId: 'u2' },
    ];
    const result = _rebuildOccupancy({ max: 5, status: 'open' }, regs);
    expect(result.current).toBe(2);
    expect(result.status).toBe('open');
    expect(result.participants).toEqual(['Alice', 'Bob']);
  });

  test('all confirmed, at max → status=full', () => {
    const regs = [
      { status: 'confirmed', userName: 'A', userId: 'u1' },
      { status: 'confirmed', userName: 'B', userId: 'u2' },
      { status: 'confirmed', userName: 'C', userId: 'u3' },
    ];
    const result = _rebuildOccupancy({ max: 3, status: 'open' }, regs);
    expect(result.current).toBe(3);
    expect(result.status).toBe('full');
  });

  test('mix confirmed + waitlisted → correct counts', () => {
    const regs = [
      { status: 'confirmed', userName: 'A', userId: 'u1' },
      { status: 'confirmed', userName: 'B', userId: 'u2' },
      { status: 'waitlisted', userName: 'C', userId: 'u3' },
      { status: 'waitlisted', userName: 'D', userId: 'u4' },
    ];
    const result = _rebuildOccupancy({ max: 5, status: 'open' }, regs);
    expect(result.current).toBe(2);
    expect(result.waitlist).toBe(2);
    expect(result.participants).toEqual(['A', 'B']);
    expect(result.waitlistNames).toEqual(['C', 'D']);
  });

  test('companion registrations → companionName used when present', () => {
    const regs = [
      { status: 'confirmed', participantType: 'companion', companionName: 'CompanionA', userName: 'OwnerA', userId: 'u1', companionId: 'c1' },
      { status: 'confirmed', participantType: 'companion', companionName: '', userName: 'OwnerB', userId: 'u2', companionId: 'c2' },
      { status: 'confirmed', userName: 'NormalUser', userId: 'u3' },
    ];
    const result = _rebuildOccupancy({ max: 10, status: 'open' }, regs);
    // First companion: companionName is 'CompanionA'
    // Second companion: companionName is empty → falls back to userName 'OwnerB'
    // Third: normal user 'NormalUser'
    expect(result.participants).toEqual(['CompanionA', 'OwnerB', 'NormalUser']);
    expect(result.current).toBe(3);
  });

  test('event status ended → stays ended regardless of count', () => {
    const regs = [
      { status: 'confirmed', userName: 'A' },
    ];
    const result = _rebuildOccupancy({ max: 10, status: 'ended' }, regs);
    expect(result.status).toBe('ended');
    expect(result.current).toBe(1);
  });

  test('event status cancelled → stays cancelled', () => {
    const regs = [
      { status: 'confirmed', userName: 'A', userId: 'u1' },
      { status: 'confirmed', userName: 'B', userId: 'u2' },
    ];
    const result = _rebuildOccupancy({ max: 2, status: 'cancelled' }, regs);
    expect(result.status).toBe('cancelled');
    expect(result.current).toBe(2);
  });

  test('registrations with blank/missing userName → filtered out', () => {
    const regs = [
      { status: 'confirmed', userName: '', userId: 'u1' },
      { status: 'confirmed', userName: '   ', userId: 'u2' },
      { status: 'confirmed', userId: 'u3' },  // userName undefined
      { status: 'confirmed', userName: 'Valid', userId: 'u4' },
    ];
    const result = _rebuildOccupancy({ max: 10, status: 'open' }, regs);
    expect(result.current).toBe(1);
    expect(result.participants).toEqual(['Valid']);
  });

  test('max=0 edge case → any confirmed makes it full', () => {
    const result = _rebuildOccupancy({ max: 0, status: 'open' }, []);
    // 0 >= 0 is true → full
    expect(result.status).toBe('full');

    const result2 = _rebuildOccupancy(
      { max: 0, status: 'open' },
      [{ status: 'confirmed', userName: 'A' }]
    );
    expect(result2.status).toBe('full');
    expect(result2.current).toBe(1);
  });

  // ----------------------------------------------------------------
  // Phase 0 (2026-04-19): participantsWithUid 遷移前置—同暱稱、排序、去重覆蓋
  // 鎖定 _rebuildOccupancy 現有行為，作為 Phase 1 安全網
  // ----------------------------------------------------------------

  test('same userName with different userId -> both included (confirmed)', () => {
    const regs = [
      { status: 'confirmed', userName: 'Aming', userId: 'U1111',
        participantType: 'self', registeredAt: '2024-01-01T00:00:00Z' },
      { status: 'confirmed', userName: 'Aming', userId: 'U2222',
        participantType: 'self', registeredAt: '2024-01-01T00:01:00Z' },
    ];
    const result = _rebuildOccupancy({ max: 10, status: 'open' }, regs);
    expect(result.current).toBe(2);
    expect(result.participants).toEqual(['Aming', 'Aming']);
  });

  test('same userName: confirmed + waitlisted keeps both buckets', () => {
    const regs = [
      { status: 'confirmed', userName: 'Aming', userId: 'U1111',
        participantType: 'self', registeredAt: '2024-01-01T00:00:00Z' },
      { status: 'waitlisted', userName: 'Aming', userId: 'U2222',
        participantType: 'self', registeredAt: '2024-01-01T00:01:00Z' },
    ];
    const result = _rebuildOccupancy({ max: 1, status: 'full' }, regs);
    expect(result.participants).toEqual(['Aming']);
    expect(result.waitlistNames).toEqual(['Aming']);
    expect(result.current).toBe(1);
    expect(result.waitlist).toBe(1);
  });

  test('same userName: self + companion with same name both counted', () => {
    const regs = [
      { status: 'confirmed', userName: 'Aming', userId: 'U1111',
        participantType: 'self', registeredAt: '2024-01-01T00:00:00Z' },
      { status: 'confirmed', userName: 'Xiaohua', userId: 'U2222',
        participantType: 'companion', companionId: 'U2222_Aming', companionName: 'Aming',
        registeredAt: '2024-01-01T00:01:00Z' },
    ];
    const result = _rebuildOccupancy({ max: 10, status: 'open' }, regs);
    expect(result.current).toBe(2);
    expect(result.participants).toEqual(['Aming', 'Aming']);
  });

  test('registeredAt ASC sort -> participants order follows registration time', () => {
    const regs = [
      { status: 'confirmed', userName: 'Late', userId: 'U3',
        participantType: 'self', registeredAt: '2024-01-03T00:00:00Z' },
      { status: 'confirmed', userName: 'Early', userId: 'U1',
        participantType: 'self', registeredAt: '2024-01-01T00:00:00Z' },
      { status: 'confirmed', userName: 'Mid', userId: 'U2',
        participantType: 'self', registeredAt: '2024-01-02T00:00:00Z' },
    ];
    const result = _rebuildOccupancy({ max: 10, status: 'open' }, regs);
    expect(result.participants).toEqual(['Early', 'Mid', 'Late']);
  });

  test('dedup: same userId + same type (self) -> only earliest kept', () => {
    const regs = [
      { status: 'confirmed', userName: 'A', userId: 'U1', participantType: 'self',
        registeredAt: '2024-01-01T00:00:00Z' },
      { status: 'confirmed', userName: 'A-DUP', userId: 'U1', participantType: 'self',
        registeredAt: '2024-01-02T00:00:00Z' },
    ];
    const result = _rebuildOccupancy({ max: 10, status: 'open' }, regs);
    expect(result.current).toBe(1);
    expect(result.participants).toEqual(['A']);
  });

  test('dedup: same userId with different companionIds -> each companion kept', () => {
    const regs = [
      { status: 'confirmed', userName: 'Main', userId: 'U1', participantType: 'self',
        registeredAt: '2024-01-01T00:00:00Z' },
      { status: 'confirmed', userName: 'Main', userId: 'U1', participantType: 'companion',
        companionId: 'c1', companionName: 'Buddy1',
        registeredAt: '2024-01-01T00:01:00Z' },
      { status: 'confirmed', userName: 'Main', userId: 'U1', participantType: 'companion',
        companionId: 'c2', companionName: 'Buddy2',
        registeredAt: '2024-01-01T00:02:00Z' },
    ];
    const result = _rebuildOccupancy({ max: 10, status: 'open' }, regs);
    expect(result.current).toBe(3);
    expect(result.participants).toEqual(['Main', 'Buddy1', 'Buddy2']);
  });

  test('registeredAt tie-break by docId', () => {
    const regs = [
      { status: 'confirmed', userName: 'B', userId: 'U2', _docId: 'docB',
        participantType: 'self', registeredAt: '2024-01-01T00:00:00Z' },
      { status: 'confirmed', userName: 'A', userId: 'U1', _docId: 'docA',
        participantType: 'self', registeredAt: '2024-01-01T00:00:00Z' },
    ];
    const result = _rebuildOccupancy({ max: 10, status: 'open' }, regs);
    expect(result.participants).toEqual(['A', 'B']);
  });

  test('Firestore Timestamp object (seconds) -> sorted correctly', () => {
    const regs = [
      { status: 'confirmed', userName: 'Later', userId: 'U2', participantType: 'self',
        registeredAt: { seconds: 2000, nanoseconds: 0 } },
      { status: 'confirmed', userName: 'Earlier', userId: 'U1', participantType: 'self',
        registeredAt: { seconds: 1000, nanoseconds: 0 } },
    ];
    const result = _rebuildOccupancy({ max: 10, status: 'open' }, regs);
    expect(result.participants).toEqual(['Earlier', 'Later']);
  });

  // ----------------------------------------------------------------
  // Phase 1 (2026-04-19): participantsWithUid / waitlistWithUid field verification
  // ----------------------------------------------------------------

  test('participantsWithUid: self users have LINE UID as uid', () => {
    const regs = [
      { status: 'confirmed', userName: 'A', userId: 'U1111', participantType: 'self' },
      { status: 'confirmed', userName: 'B', userId: 'U2222', participantType: 'self' },
    ];
    const result = _rebuildOccupancy({ max: 10, status: 'open' }, regs);
    expect(result.participantsWithUid).toEqual([
      { uid: 'U1111', name: 'A', teamKey: null },
      { uid: 'U2222', name: 'B', teamKey: null },
    ]);
  });

  test('participantsWithUid: companions have synthetic uid', () => {
    const regs = [
      { status: 'confirmed', userName: 'Main', userId: 'U1111', participantType: 'self' },
      { status: 'confirmed', userName: 'Main', userId: 'U1111', participantType: 'companion',
        companionId: 'U1111_Buddy', companionName: 'Buddy' },
    ];
    const result = _rebuildOccupancy({ max: 10, status: 'open' }, regs);
    expect(result.participantsWithUid).toHaveLength(2);
    expect(result.participantsWithUid[0]).toEqual({ uid: 'U1111', name: 'Main', teamKey: null });
    expect(result.participantsWithUid[1]).toEqual({ uid: 'U1111_Buddy', name: 'Buddy', teamKey: null });
  });

  test('participantsWithUid: same userName distinct userId produces distinct uids (core bug fix)', () => {
    const regs = [
      { status: 'confirmed', userName: 'Aming', userId: 'U1111', participantType: 'self' },
      { status: 'confirmed', userName: 'Aming', userId: 'U2222', participantType: 'self' },
    ];
    const result = _rebuildOccupancy({ max: 10, status: 'open' }, regs);
    expect(result.participantsWithUid).toHaveLength(2);
    expect(result.participantsWithUid[0].uid).toBe('U1111');
    expect(result.participantsWithUid[1].uid).toBe('U2222');
    expect(result.participantsWithUid[0].name).toBe('Aming');
    expect(result.participantsWithUid[1].name).toBe('Aming');
  });

  test('participantsWithUid: teamKey propagated from registration', () => {
    const regs = [
      { status: 'confirmed', userName: 'A', userId: 'U1', participantType: 'self', teamKey: 'A' },
      { status: 'confirmed', userName: 'B', userId: 'U2', participantType: 'self', teamKey: 'B' },
      { status: 'confirmed', userName: 'C', userId: 'U3', participantType: 'self' },
    ];
    const result = _rebuildOccupancy({ max: 10, status: 'open' }, regs);
    expect(result.participantsWithUid[0].teamKey).toBe('A');
    expect(result.participantsWithUid[1].teamKey).toBe('B');
    expect(result.participantsWithUid[2].teamKey).toBe(null);
  });

  test('waitlistWithUid: waitlisted users populated separately', () => {
    const regs = [
      { status: 'confirmed', userName: 'A', userId: 'U1', participantType: 'self' },
      { status: 'waitlisted', userName: 'B', userId: 'U2', participantType: 'self' },
    ];
    const result = _rebuildOccupancy({ max: 1, status: 'full' }, regs);
    expect(result.participantsWithUid).toEqual([{ uid: 'U1', name: 'A', teamKey: null }]);
    expect(result.waitlistWithUid).toEqual([{ uid: 'U2', name: 'B', teamKey: null }]);
  });

  test('participantsWithUid: empty userId filtered out (safety)', () => {
    const regs = [
      { status: 'confirmed', userName: 'NoUid', userId: '', participantType: 'self' },
      { status: 'confirmed', userName: 'Valid', userId: 'U1', participantType: 'self' },
    ];
    const result = _rebuildOccupancy({ max: 10, status: 'open' }, regs);
    expect(result.participantsWithUid).toHaveLength(1);
    expect(result.participantsWithUid[0].uid).toBe('U1');
  });

  test('participantsWithUid: companion with empty companionName filtered out', () => {
    const regs = [
      { status: 'confirmed', userName: 'Main', userId: 'U1', participantType: 'companion',
        companionId: '', companionName: '' },
      { status: 'confirmed', userName: 'Valid', userId: 'U2', participantType: 'self' },
    ];
    const result = _rebuildOccupancy({ max: 10, status: 'open' }, regs);
    expect(result.participantsWithUid).toHaveLength(1);
    expect(result.participantsWithUid[0].uid).toBe('U2');
  });

});

describe('_isEventDelegate (js/modules/event-list.js:377-381)', () => {
  const myUid = 'U_me';

  test('no delegates field → false', () => {
    expect(_isEventDelegate(undefined, myUid)).toBe(false);
    expect(_isEventDelegate(null, myUid)).toBe(false);
  });

  test('empty delegates array → false', () => {
    expect(_isEventDelegate([], myUid)).toBe(false);
  });

  test('user is in delegates → true', () => {
    const delegates = [{ uid: 'U_me', name: 'Me' }];
    expect(_isEventDelegate(delegates, myUid)).toBe(true);
  });

  test('user is not in delegates → false', () => {
    const delegates = [{ uid: 'U_other', name: 'Other' }];
    expect(_isEventDelegate(delegates, myUid)).toBe(false);
  });

  test('multiple delegates, user is one of them → true', () => {
    const delegates = [
      { uid: 'U_a', name: 'A' },
      { uid: 'U_me', name: 'Me' },
      { uid: 'U_b', name: 'B' },
    ];
    expect(_isEventDelegate(delegates, myUid)).toBe(true);
  });
});

describe('_isAnyActiveEventDelegate (js/modules/role.js:71-86)', () => {
  const myUid = 'U_me';
  const makeDelegate = (e) => e.delegates && e.delegates.some(d => d.uid === myUid);

  test('no events → false', () => {
    const result = _isAnyActiveEventDelegate({
      events: [],
      presetEventId: null,
      getEvent: () => null,
      isEventDelegate: makeDelegate,
    });
    expect(result).toBe(false);
  });

  test('events exist but none with user as delegate → false', () => {
    const events = [
      { id: '1', status: 'open', delegates: [{ uid: 'U_other' }] },
      { id: '2', status: 'full', delegates: [] },
    ];
    const result = _isAnyActiveEventDelegate({
      events,
      presetEventId: null,
      getEvent: () => null,
      isEventDelegate: makeDelegate,
    });
    expect(result).toBe(false);
  });

  test('open event with user as delegate → true', () => {
    const events = [
      { id: '1', status: 'open', delegates: [{ uid: myUid }] },
    ];
    const result = _isAnyActiveEventDelegate({
      events,
      presetEventId: null,
      getEvent: () => null,
      isEventDelegate: makeDelegate,
    });
    expect(result).toBe(true);
  });

  test('full event with user as delegate → true', () => {
    const events = [
      { id: '1', status: 'full', delegates: [{ uid: myUid }] },
    ];
    const result = _isAnyActiveEventDelegate({
      events,
      presetEventId: null,
      getEvent: () => null,
      isEventDelegate: makeDelegate,
    });
    expect(result).toBe(true);
  });

  test('ended event with user as delegate → true (THE FIX!)', () => {
    const events = [
      { id: '1', status: 'ended', delegates: [{ uid: myUid }] },
    ];
    const result = _isAnyActiveEventDelegate({
      events,
      presetEventId: null,
      getEvent: () => null,
      isEventDelegate: makeDelegate,
    });
    expect(result).toBe(true);
  });

  test('cancelled event with user as delegate → false', () => {
    const events = [
      { id: '1', status: 'cancelled', delegates: [{ uid: myUid }] },
    ];
    const result = _isAnyActiveEventDelegate({
      events,
      presetEventId: null,
      getEvent: () => null,
      isEventDelegate: makeDelegate,
    });
    expect(result).toBe(false);
  });

  test('preset eventId matches delegate → true (THE FIX!)', () => {
    const presetEvent = { id: 'preset-1', status: 'ended', delegates: [{ uid: myUid }] };
    const result = _isAnyActiveEventDelegate({
      events: [],  // events list not yet loaded
      presetEventId: 'preset-1',
      getEvent: (id) => id === 'preset-1' ? presetEvent : null,
      isEventDelegate: makeDelegate,
    });
    expect(result).toBe(true);
  });

  test('preset eventId but user is not delegate → false', () => {
    const presetEvent = { id: 'preset-1', status: 'open', delegates: [{ uid: 'U_other' }] };
    const result = _isAnyActiveEventDelegate({
      events: [],
      presetEventId: 'preset-1',
      getEvent: (id) => id === 'preset-1' ? presetEvent : null,
      isEventDelegate: makeDelegate,
    });
    expect(result).toBe(false);
  });
});

describe('_categorizeScanEvents (js/modules/scan.js:96-123)', () => {
  // Fixed reference date: 2026-03-17 12:00:00
  const now = new Date(2026, 2, 17, 12, 0, 0);
  const parseDate = (dateStr) => {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  };

  test('events categorized into today/past/future correctly', () => {
    const events = [
      { id: '1', date: '2026-03-17' },  // today
      { id: '2', date: '2026-03-16' },  // past
      { id: '3', date: '2026-03-18' },  // future
    ];
    const buckets = _categorizeScanEvents(events, { now, parseDate });
    expect(buckets.today.map(e => e.id)).toEqual(['1']);
    expect(buckets.past.map(e => e.id)).toEqual(['2']);
    expect(buckets.future.map(e => e.id)).toEqual(['3']);
  });

  test('events with unparseable dates go to past', () => {
    const events = [
      { id: '1', date: 'not-a-date' },
      { id: '2', date: '' },
      { id: '3', date: null },
    ];
    const buckets = _categorizeScanEvents(events, { now, parseDate });
    expect(buckets.past.length).toBe(3);
    expect(buckets.today.length).toBe(0);
    expect(buckets.future.length).toBe(0);
  });

  test('today events sorted ascending', () => {
    const events = [
      { id: 'b', date: '2026-03-17T18:00' },
      { id: 'a', date: '2026-03-17T09:00' },
      { id: 'c', date: '2026-03-17T12:00' },
    ];
    const buckets = _categorizeScanEvents(events, { now, parseDate });
    expect(buckets.today.map(e => e.id)).toEqual(['a', 'c', 'b']);
  });

  test('past events sorted descending', () => {
    const events = [
      { id: 'a', date: '2026-03-10' },
      { id: 'c', date: '2026-03-15' },
      { id: 'b', date: '2026-03-12' },
    ];
    const buckets = _categorizeScanEvents(events, { now, parseDate });
    expect(buckets.past.map(e => e.id)).toEqual(['c', 'b', 'a']);
  });

  test('future events sorted ascending', () => {
    const events = [
      { id: 'c', date: '2026-03-25' },
      { id: 'a', date: '2026-03-19' },
      { id: 'b', date: '2026-03-20' },
    ];
    const buckets = _categorizeScanEvents(events, { now, parseDate });
    expect(buckets.future.map(e => e.id)).toEqual(['a', 'b', 'c']);
  });

  test('empty events array → all buckets empty', () => {
    const buckets = _categorizeScanEvents([], { now, parseDate });
    expect(buckets.today).toEqual([]);
    expect(buckets.past).toEqual([]);
    expect(buckets.future).toEqual([]);
  });
});
