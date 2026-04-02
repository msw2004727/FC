/**
 * Pure function unit tests — extracted from the frontend codebase.
 *
 * The project uses Object.assign(App, {...}) (not ES modules), so each
 * function body is copied here as a standalone testable function.
 * A comment above each function notes the source file and line range.
 */

// ---------------------------------------------------------------------------
// Extracted from js/firebase-crud.js:514-558
// Pure function: computes occupancy from event config + registration list
// ---------------------------------------------------------------------------
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
      { status: 'confirmed', userName: 'Alice' },
      { status: 'confirmed', userName: 'Bob' },
    ];
    const result = _rebuildOccupancy({ max: 5, status: 'open' }, regs);
    expect(result.current).toBe(2);
    expect(result.status).toBe('open');
    expect(result.participants).toEqual(['Alice', 'Bob']);
  });

  test('all confirmed, at max → status=full', () => {
    const regs = [
      { status: 'confirmed', userName: 'A' },
      { status: 'confirmed', userName: 'B' },
      { status: 'confirmed', userName: 'C' },
    ];
    const result = _rebuildOccupancy({ max: 3, status: 'open' }, regs);
    expect(result.current).toBe(3);
    expect(result.status).toBe('full');
  });

  test('mix confirmed + waitlisted → correct counts', () => {
    const regs = [
      { status: 'confirmed', userName: 'A' },
      { status: 'confirmed', userName: 'B' },
      { status: 'waitlisted', userName: 'C' },
      { status: 'waitlisted', userName: 'D' },
    ];
    const result = _rebuildOccupancy({ max: 5, status: 'open' }, regs);
    expect(result.current).toBe(2);
    expect(result.waitlist).toBe(2);
    expect(result.participants).toEqual(['A', 'B']);
    expect(result.waitlistNames).toEqual(['C', 'D']);
  });

  test('companion registrations → companionName used when present', () => {
    const regs = [
      { status: 'confirmed', participantType: 'companion', companionName: 'CompanionA', userName: 'OwnerA' },
      { status: 'confirmed', participantType: 'companion', companionName: '', userName: 'OwnerB' },
      { status: 'confirmed', userName: 'NormalUser' },
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
      { status: 'confirmed', userName: 'A' },
      { status: 'confirmed', userName: 'B' },
    ];
    const result = _rebuildOccupancy({ max: 2, status: 'cancelled' }, regs);
    expect(result.status).toBe('cancelled');
    expect(result.current).toBe(2);
  });

  test('registrations with blank/missing userName → filtered out', () => {
    const regs = [
      { status: 'confirmed', userName: '' },
      { status: 'confirmed', userName: '   ' },
      { status: 'confirmed' },  // userName undefined
      { status: 'confirmed', userName: 'Valid' },
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
