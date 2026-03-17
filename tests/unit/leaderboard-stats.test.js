/**
 * Leaderboard & Activity Records — unit tests
 *
 * Extracted from js/modules/leaderboard.js
 * Tests: _categorizeRecords (3-pass classification of user activity records)
 *
 * The function depends on ApiService lookups, so we inject mock data
 * as function parameters instead.
 */

// ---------------------------------------------------------------------------
// Extracted from leaderboard.js:35-93
// Adapted: inject dependencies instead of calling ApiService globals
// Parameters:
//   activityRecords – all activity records for the user (ApiService.getActivityRecords)
//   attendanceRecords – attendance records (ApiService.getUserAttendanceRecords)
//   uid – user ID
//   isPublic – public card mode (hides registered)
//   getEvent – function(eventId) => event object or null
// ---------------------------------------------------------------------------
function _categorizeRecords({ activityRecords, attendanceRecords, uid, isPublic, getEvent }) {
  const all = activityRecords;
  const attRecords = attendanceRecords || [];
  const registered = [];
  const completed = [];
  const cancelled = [];

  // Pass 1: build eventId sets
  const seenCancel = new Set();
  const seenActive = new Set();
  const seenComplete = new Set();
  all.forEach(r => {
    if (r.status === 'cancelled') seenCancel.add(r.eventId);
    if (r.status === 'registered' || r.status === 'waitlisted') seenActive.add(r.eventId);
  });
  // Re-registered after cancel → treat as active
  seenActive.forEach(eid => seenCancel.delete(eid));
  all.forEach(r => {
    if (r.status === 'cancelled' || r.status === 'removed') return;
    const hasCheckin  = attRecords.some(a => a.eventId === r.eventId && a.uid === uid && a.type === 'checkin');
    const hasCheckout = attRecords.some(a => a.eventId === r.eventId && a.uid === uid && a.type === 'checkout');
    if (hasCheckin && hasCheckout) seenComplete.add(r.eventId);
  });

  // Pass 2: classify
  all.forEach(r => {
    if (r.status === 'removed') return;
    if (r.status === 'cancelled') {
      if (seenActive.has(r.eventId)) return;
      if (!cancelled.some(c => c.eventId === r.eventId)) {
        cancelled.push(r);
      }
      return;
    }
    if (seenComplete.has(r.eventId) && !seenCancel.has(r.eventId)) {
      if (!completed.some(c => c.eventId === r.eventId)) {
        completed.push({ ...r, _displayStatus: 'completed' });
      }
      return;
    }
    if (r.status === 'registered' || r.status === 'waitlisted') {
      if (seenCancel.has(r.eventId) || seenComplete.has(r.eventId)) return;
      if (isPublic) return;
      const event = getEvent(r.eventId);
      if (event && event.status !== 'ended' && event.status !== 'cancelled') {
        registered.push(r);
      } else if (event && event.status === 'ended' && r.status === 'registered') {
        registered.push({ ...r, _displayStatus: 'missed' });
      }
    }
  });
  return { registered, completed, cancelled };
}

// ═══════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════

const UID = 'user-1';

// Helper: build activity record
function makeRecord(eventId, status, extras = {}) {
  return { eventId, status, name: `Event ${eventId}`, date: '2026/03/01', ...extras };
}

// Helper: build attendance record
function makeAttendance(eventId, type) {
  return { eventId, uid: UID, type };
}

// Helper: build event
function makeEvent(id, status = 'open') {
  return { id, status, title: `Event ${id}` };
}

describe('_categorizeRecords — basic classification', () => {
  test('empty input returns empty arrays', () => {
    const result = _categorizeRecords({
      activityRecords: [],
      attendanceRecords: [],
      uid: UID,
      isPublic: false,
      getEvent: () => null,
    });
    expect(result.registered).toEqual([]);
    expect(result.completed).toEqual([]);
    expect(result.cancelled).toEqual([]);
  });

  test('registered records appear in registered (event open)', () => {
    const events = { e1: makeEvent('e1', 'open') };
    const result = _categorizeRecords({
      activityRecords: [makeRecord('e1', 'registered')],
      attendanceRecords: [],
      uid: UID,
      isPublic: false,
      getEvent: id => events[id] || null,
    });
    expect(result.registered).toHaveLength(1);
    expect(result.registered[0].eventId).toBe('e1');
  });

  test('cancelled records appear in cancelled', () => {
    const result = _categorizeRecords({
      activityRecords: [makeRecord('e1', 'cancelled')],
      attendanceRecords: [],
      uid: UID,
      isPublic: false,
      getEvent: () => null,
    });
    expect(result.cancelled).toHaveLength(1);
  });

  test('completed records (checkin + checkout) appear in completed', () => {
    const events = { e1: makeEvent('e1', 'open') };
    const result = _categorizeRecords({
      activityRecords: [makeRecord('e1', 'registered')],
      attendanceRecords: [
        makeAttendance('e1', 'checkin'),
        makeAttendance('e1', 'checkout'),
      ],
      uid: UID,
      isPublic: false,
      getEvent: id => events[id] || null,
    });
    expect(result.completed).toHaveLength(1);
    expect(result.completed[0]._displayStatus).toBe('completed');
    expect(result.registered).toHaveLength(0);
  });

  test('checkin only (no checkout) does NOT count as completed', () => {
    const events = { e1: makeEvent('e1', 'open') };
    const result = _categorizeRecords({
      activityRecords: [makeRecord('e1', 'registered')],
      attendanceRecords: [makeAttendance('e1', 'checkin')],
      uid: UID,
      isPublic: false,
      getEvent: id => events[id] || null,
    });
    expect(result.completed).toHaveLength(0);
    expect(result.registered).toHaveLength(1);
  });

  test('removed records are excluded from all categories', () => {
    const result = _categorizeRecords({
      activityRecords: [makeRecord('e1', 'removed')],
      attendanceRecords: [],
      uid: UID,
      isPublic: false,
      getEvent: () => makeEvent('e1'),
    });
    expect(result.registered).toHaveLength(0);
    expect(result.completed).toHaveLength(0);
    expect(result.cancelled).toHaveLength(0);
  });
});

describe('_categorizeRecords — re-registration after cancel', () => {
  test('cancel then re-register: cancel record hidden, registered shown', () => {
    const events = { e1: makeEvent('e1', 'open') };
    const result = _categorizeRecords({
      activityRecords: [
        makeRecord('e1', 'cancelled'),
        makeRecord('e1', 'registered'),
      ],
      attendanceRecords: [],
      uid: UID,
      isPublic: false,
      getEvent: id => events[id] || null,
    });
    expect(result.cancelled).toHaveLength(0);
    expect(result.registered).toHaveLength(1);
  });

  test('cancel then re-register then complete: shows completed only', () => {
    const events = { e1: makeEvent('e1', 'open') };
    const result = _categorizeRecords({
      activityRecords: [
        makeRecord('e1', 'cancelled'),
        makeRecord('e1', 'registered'),
      ],
      attendanceRecords: [
        makeAttendance('e1', 'checkin'),
        makeAttendance('e1', 'checkout'),
      ],
      uid: UID,
      isPublic: false,
      getEvent: id => events[id] || null,
    });
    expect(result.cancelled).toHaveLength(0);
    expect(result.registered).toHaveLength(0);
    expect(result.completed).toHaveLength(1);
  });
});

describe('_categorizeRecords — deduplication', () => {
  test('duplicate cancelled records for same event only show once', () => {
    const result = _categorizeRecords({
      activityRecords: [
        makeRecord('e1', 'cancelled'),
        makeRecord('e1', 'cancelled'),
      ],
      attendanceRecords: [],
      uid: UID,
      isPublic: false,
      getEvent: () => null,
    });
    expect(result.cancelled).toHaveLength(1);
  });

  test('duplicate completed records for same event only show once', () => {
    const events = { e1: makeEvent('e1', 'open') };
    const result = _categorizeRecords({
      activityRecords: [
        makeRecord('e1', 'registered'),
        makeRecord('e1', 'registered'),
      ],
      attendanceRecords: [
        makeAttendance('e1', 'checkin'),
        makeAttendance('e1', 'checkout'),
      ],
      uid: UID,
      isPublic: false,
      getEvent: id => events[id] || null,
    });
    expect(result.completed).toHaveLength(1);
  });
});

describe('_categorizeRecords — ended event handling', () => {
  test('registered + event ended = missed status', () => {
    const events = { e1: makeEvent('e1', 'ended') };
    const result = _categorizeRecords({
      activityRecords: [makeRecord('e1', 'registered')],
      attendanceRecords: [],
      uid: UID,
      isPublic: false,
      getEvent: id => events[id] || null,
    });
    expect(result.registered).toHaveLength(1);
    expect(result.registered[0]._displayStatus).toBe('missed');
  });

  test('waitlisted + event ended = not shown (waitlisted not counted as missed)', () => {
    const events = { e1: makeEvent('e1', 'ended') };
    const result = _categorizeRecords({
      activityRecords: [makeRecord('e1', 'waitlisted')],
      attendanceRecords: [],
      uid: UID,
      isPublic: false,
      getEvent: id => events[id] || null,
    });
    expect(result.registered).toHaveLength(0);
  });
});

describe('_categorizeRecords — public mode', () => {
  test('public mode hides registered records', () => {
    const events = { e1: makeEvent('e1', 'open') };
    const result = _categorizeRecords({
      activityRecords: [makeRecord('e1', 'registered')],
      attendanceRecords: [],
      uid: UID,
      isPublic: true,
      getEvent: id => events[id] || null,
    });
    expect(result.registered).toHaveLength(0);
  });

  test('public mode still shows completed and cancelled', () => {
    const events = { e1: makeEvent('e1', 'open'), e2: makeEvent('e2', 'open') };
    const result = _categorizeRecords({
      activityRecords: [
        makeRecord('e1', 'registered'),
        makeRecord('e2', 'cancelled'),
      ],
      attendanceRecords: [
        makeAttendance('e1', 'checkin'),
        makeAttendance('e1', 'checkout'),
      ],
      uid: UID,
      isPublic: true,
      getEvent: id => events[id] || null,
    });
    expect(result.completed).toHaveLength(1);
    expect(result.cancelled).toHaveLength(1);
    expect(result.registered).toHaveLength(0);
  });
});

describe('_categorizeRecords — multiple events', () => {
  test('correctly classifies mixed events', () => {
    const events = {
      e1: makeEvent('e1', 'open'),
      e2: makeEvent('e2', 'ended'),
      e3: makeEvent('e3', 'open'),
    };
    const result = _categorizeRecords({
      activityRecords: [
        makeRecord('e1', 'registered'),   // e1: open, registered
        makeRecord('e2', 'registered'),   // e2: ended, no scan → missed
        makeRecord('e3', 'cancelled'),    // e3: cancelled
      ],
      attendanceRecords: [],
      uid: UID,
      isPublic: false,
      getEvent: id => events[id] || null,
    });
    expect(result.registered).toHaveLength(2); // e1 active, e2 missed
    expect(result.registered[0].eventId).toBe('e1');
    expect(result.registered[1]._displayStatus).toBe('missed');
    expect(result.cancelled).toHaveLength(1);
    expect(result.completed).toHaveLength(0);
  });

  test('event with null getEvent result does not appear', () => {
    const result = _categorizeRecords({
      activityRecords: [makeRecord('e-unknown', 'registered')],
      attendanceRecords: [],
      uid: UID,
      isPublic: false,
      getEvent: () => null,
    });
    expect(result.registered).toHaveLength(0);
  });
});

describe('_categorizeRecords — cross-category conflict', () => {
  test('completed event is not also shown in registered', () => {
    const events = { e1: makeEvent('e1', 'open') };
    const result = _categorizeRecords({
      activityRecords: [
        makeRecord('e1', 'registered'),
      ],
      attendanceRecords: [
        makeAttendance('e1', 'checkin'),
        makeAttendance('e1', 'checkout'),
      ],
      uid: UID,
      isPublic: false,
      getEvent: id => events[id] || null,
    });
    expect(result.completed).toHaveLength(1);
    expect(result.registered).toHaveLength(0);
  });

  test('attendance from different uid does not affect target user', () => {
    const events = { e1: makeEvent('e1', 'open') };
    const result = _categorizeRecords({
      activityRecords: [makeRecord('e1', 'registered')],
      attendanceRecords: [
        { eventId: 'e1', uid: 'other-user', type: 'checkin' },
        { eventId: 'e1', uid: 'other-user', type: 'checkout' },
      ],
      uid: UID,
      isPublic: false,
      getEvent: id => events[id] || null,
    });
    expect(result.completed).toHaveLength(0);
    expect(result.registered).toHaveLength(1);
  });
});
