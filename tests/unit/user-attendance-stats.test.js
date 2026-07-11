const {
  SOURCE_VERSION,
  collectRelevantEventIds,
  computeUserAttendanceStats,
} = require('../../functions/user-attendance-stats-core');

const uid = 'U-test';
const ended = (id = 'e1') => ({ id, status: 'ended' });
const confirmed = (eventId = 'e1', overrides = {}) => ({
  userId: uid,
  eventId,
  status: 'confirmed',
  participantType: 'self',
  ...overrides,
});
const activity = (eventId = 'e1', overrides = {}) => ({
  uid,
  eventId,
  status: 'registered',
  ...overrides,
});
const attendance = (type, eventId = 'e1', overrides = {}) => ({
  uid,
  eventId,
  type,
  status: 'active',
  ...overrides,
});

function calculate(overrides = {}) {
  return computeUserAttendanceStats({
    uid,
    events: [],
    registrations: [],
    activityRecords: [],
    attendanceRecords: [],
    ...overrides,
  });
}

describe('user attendance materialized stats core', () => {
  test('returns stable zero summary for empty input', () => {
    expect(calculate()).toMatchObject({
      sourceVersion: SOURCE_VERSION,
      expectedCount: 0,
      attendedCount: 0,
      completedCount: 0,
      attendRate: 0,
    });
  });

  test('counts a confirmed registration only after its event ended', () => {
    expect(calculate({ events: [ended()], registrations: [confirmed()] }).expectedCount).toBe(1);
    expect(calculate({
      events: [{ id: 'e1', status: 'open' }],
      registrations: [confirmed()],
    }).expectedCount).toBe(0);
  });

  test.each(['cancelled', 'removed', 'waitlisted'])(
    'explicit %s registration excludes stale registered activity evidence',
    (status) => {
      const result = calculate({
        events: [ended()],
        registrations: [confirmed('e1', { status })],
        activityRecords: [activity()],
      });
      expect(result.expectedCount).toBe(0);
    },
  );

  test('confirmed registration remains authoritative when activity record is missing or stale', () => {
    const missing = calculate({ events: [ended()], registrations: [confirmed()] });
    const stale = calculate({
      events: [ended()],
      registrations: [confirmed()],
      activityRecords: [activity('e1', { status: 'waitlisted' })],
    });
    expect(missing.expectedCount).toBe(1);
    expect(stale.expectedCount).toBe(1);
  });

  test('preserves a qualifying legacy activity record when no registration exists', () => {
    const result = calculate({ events: [ended()], activityRecords: [activity()] });
    expect(result.expectedEventIds).toEqual(['e1']);
  });

  test('does not use cancelled legacy activity as expected attendance evidence', () => {
    const result = calculate({
      events: [ended()],
      activityRecords: [activity('e1', { status: 'cancelled' })],
    });
    expect(result.expectedCount).toBe(0);
  });

  test('checkin counts attendance but completion requires checkout too', () => {
    const checkinOnly = calculate({
      events: [ended()],
      registrations: [confirmed()],
      attendanceRecords: [attendance('checkin')],
    });
    expect(checkinOnly).toMatchObject({ attendedCount: 1, completedCount: 0, attendRate: 100 });

    const completed = calculate({
      events: [ended()],
      registrations: [confirmed()],
      attendanceRecords: [attendance('checkin'), attendance('checkout')],
    });
    expect(completed).toMatchObject({ attendedCount: 1, completedCount: 1, attendRate: 100 });
  });

  test('deduplicates registrations, activities, checkins, and checkouts by event', () => {
    const result = calculate({
      events: [ended()],
      registrations: [confirmed(), confirmed()],
      activityRecords: [activity(), activity()],
      attendanceRecords: [
        attendance('checkin'), attendance('checkin'),
        attendance('checkout'), attendance('checkout'),
      ],
    });
    expect(result).toMatchObject({ expectedCount: 1, attendedCount: 1, completedCount: 1 });
  });

  test.each(['removed', 'cancelled'])(
    'ignores %s attendance rows',
    (status) => {
      const result = calculate({
        events: [ended()],
        registrations: [confirmed()],
        attendanceRecords: [attendance('checkin', 'e1', { status })],
      });
      expect(result.attendedCount).toBe(0);
    },
  );

  test('excludes companion registration, activity, and attendance rows', () => {
    const companion = { participantType: 'companion', companionId: 'c1' };
    const result = calculate({
      events: [ended()],
      registrations: [confirmed('e1', companion)],
      activityRecords: [activity('e1', companion)],
      attendanceRecords: [attendance('checkin', 'e1', companion)],
    });
    expect(result.expectedCount).toBe(0);
  });

  test('excludes records owned by a different uid', () => {
    const result = calculate({
      events: [ended()],
      registrations: [confirmed('e1', { userId: 'other' })],
      activityRecords: [activity('e1', { uid: 'other' })],
      attendanceRecords: [attendance('checkin', 'e1', { uid: 'other' })],
    });
    expect(result.expectedCount).toBe(0);
  });

  test('uses public event id instead of Firestore document id', () => {
    const result = calculate({
      events: [{ id: 'public-e1', _docId: 'doc-e1', status: 'ended' }],
      registrations: [confirmed('public-e1')],
    });
    expect(result.expectedEventIds).toEqual(['public-e1']);
  });

  test('drops evidence whose event no longer exists', () => {
    const result = calculate({ registrations: [confirmed()], activityRecords: [activity()] });
    expect(result.expectedCount).toBe(0);
  });

  test('a re-confirmed registration wins over a historical cancelled row', () => {
    const result = calculate({
      events: [ended()],
      registrations: [confirmed('e1', { status: 'cancelled' }), confirmed()],
    });
    expect(result.expectedCount).toBe(1);
  });

  test('rounds attendance rate from unique attended events', () => {
    const result = calculate({
      events: [ended('e1'), ended('e2'), ended('e3')],
      registrations: [confirmed('e1'), confirmed('e2'), confirmed('e3')],
      attendanceRecords: [attendance('checkin', 'e1'), attendance('checkin', 'e2')],
    });
    expect(result.attendRate).toBe(67);
  });

  test('collectRelevantEventIds includes confirmed and legacy evidence only', () => {
    const ids = collectRelevantEventIds({
      uid,
      registrations: [confirmed('confirmed'), confirmed('waitlist', { status: 'waitlisted' })],
      activityRecords: [activity('legacy'), activity('cancelled', { status: 'cancelled' })],
    });
    expect([...ids].sort()).toEqual(['confirmed', 'legacy']);
  });
});
