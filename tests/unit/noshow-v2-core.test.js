const {
  NOSHOW_V2_SINCE,
  computeEventCountedCheckoutFlag,
  computeUserCountedStats,
  eventStartMillis,
  isCountedEvent,
  isLatePromotion,
  normalizeEventDateKey,
} = require('../../functions/noshow-v2-core');

const SINCE = '2026-11-08';
const uid = 'U-self';

const event = (overrides = {}) => ({
  id: 'e1',
  _docId: 'doc-e1',
  status: 'ended',
  date: '2026/11/10 19:00~21:00',
  creatorUid: 'U-host',
  delegateUids: ['U-delegate'],
  ...overrides,
});
const reg = (userId, overrides = {}) => ({
  userId,
  eventId: 'e1',
  status: 'confirmed',
  participantType: 'self',
  ...overrides,
});
const att = (type, recordUid, overrides = {}) => ({
  uid: recordUid,
  eventId: 'e1',
  type,
  status: 'active',
  ...overrides,
});

describe('noshow v2 date normalization', () => {
  test.each([
    ['2026/11/8 19:00~21:00', '2026-11-08'],
    ['2026/1/5', '2026-01-05'],
    ['2026-11-08', '2026-11-08'],
    ['2026-3-7 08:00~10:00', '2026-03-07'],
    [' 2026/12/31 23:00~01:00 ', '2026-12-31'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeEventDateKey(raw)).toBe(expected);
  });

  test.each([
    [''], [null], [undefined], ['11/08/2026'], ['2026/13/01'], ['2026/02/30'],
    ['2026/11'], ['abc'], ['2026/11/08x'], [12345],
  ])('unparsable %p → null', (raw) => {
    expect(normalizeEventDateKey(raw)).toBeNull();
  });

  test('event start is Asia/Taipei local time; missing time means 00:00', () => {
    expect(eventStartMillis('2026/11/10 19:00~21:00')).toBe(Date.parse('2026-11-10T19:00:00+08:00'));
    expect(eventStartMillis('2026/11/10')).toBe(Date.parse('2026-11-10T00:00:00+08:00'));
    expect(eventStartMillis('bad')).toBeNull();
  });

  test('placeholder since constant is a zero-padded Taipei date', () => {
    expect(NOSHOW_V2_SINCE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('noshow v2 event flag (hasCountedCheckout)', () => {
  const flag = (registrations, attendanceRecords, ev = event()) => (
    computeEventCountedCheckoutFlag({ event: ev, registrations, attendanceRecords })
  );

  test('a confirmed participant checkout turns the flag on', () => {
    expect(flag([reg('U-a')], [att('checkout', 'U-a')])).toBe(true);
  });

  test('checkin only does not turn the flag on', () => {
    expect(flag([reg('U-a')], [att('checkin', 'U-a')])).toBe(false);
  });

  test('walk-in scan without registration does not count', () => {
    expect(flag([reg('U-a')], [att('checkout', 'U-stranger')])).toBe(false);
  });

  test.each(['waitlisted', 'cancelled', 'removed'])('non-confirmed (%s) registrant checkout does not count', (status) => {
    expect(flag([reg('U-a', { status })], [att('checkout', 'U-a')])).toBe(false);
  });

  test('host and delegate self checkout do not count even when registered', () => {
    expect(flag([reg('U-host'), reg('U-delegate')], [att('checkout', 'U-host'), att('checkout', 'U-delegate')])).toBe(false);
    expect(flag([reg('U-host'), reg('U-a')], [att('checkout', 'U-host'), att('checkout', 'U-a')])).toBe(true);
  });

  test('companion checkout or companion registration does not count', () => {
    expect(flag([reg('U-a')], [att('checkout', 'U-a', { companionId: 'c1' })])).toBe(false);
    expect(flag([reg('U-a')], [att('checkout', 'U-a', { participantType: 'companion' })])).toBe(false);
    expect(flag([reg('U-a', { participantType: 'companion', companionId: 'c1' })], [att('checkout', 'U-a')])).toBe(false);
  });

  test.each(['removed', 'cancelled'])('%s checkout does not count', (status) => {
    expect(flag([reg('U-a')], [att('checkout', 'U-a', { status })])).toBe(false);
  });

  test('empty or missing status counts as active', () => {
    expect(flag([reg('U-a')], [att('checkout', 'U-a', { status: '' })])).toBe(true);
    expect(flag([reg('U-a')], [att('checkout', 'U-a', { status: undefined })])).toBe(true);
  });

  test('uid only — userId is not used as fallback', () => {
    expect(flag([reg('U-a')], [{ userId: 'U-a', eventId: 'e1', type: 'checkout' }])).toBe(false);
  });

  test('eventId may be public id or doc id; anything else is rejected', () => {
    expect(flag([reg('U-a')], [att('checkout', 'U-a', { eventId: 'doc-e1' })])).toBe(true);
    expect(flag([reg('U-a')], [att('checkout', 'U-a', { eventId: 'other' })])).toBe(false);
  });

  test('flag flips off when the only valid checkout is removed', () => {
    const regs = [reg('U-a'), reg('U-b')];
    expect(flag(regs, [att('checkout', 'U-a')])).toBe(true);
    expect(flag(regs, [att('checkout', 'U-a', { status: 'removed' })])).toBe(false);
  });
});

describe('noshow v2 counted event / promotion helpers', () => {
  test('counted requires ended + start date on/after since + flag true', () => {
    expect(isCountedEvent(event(), true, SINCE)).toBe(true);
    expect(isCountedEvent(event({ date: '2026/11/8 08:00~10:00' }), true, SINCE)).toBe(true);
    expect(isCountedEvent(event({ date: '2026/11/7 23:00~23:59' }), true, SINCE)).toBe(false);
    expect(isCountedEvent(event(), false, SINCE)).toBe(false);
    expect(isCountedEvent(event({ status: 'open' }), true, SINCE)).toBe(false);
    expect(isCountedEvent(event({ date: 'bad' }), true, SINCE)).toBe(false);
  });

  test('promotedAt after event start is late; before or missing is not', () => {
    const ev = event();
    const start = Date.parse('2026-11-10T19:00:00+08:00');
    expect(isLatePromotion({ promotedAt: { toMillis: () => start + 60000 } }, ev)).toBe(true);
    expect(isLatePromotion({ promotedAt: new Date(start - 60000) }, ev)).toBe(false);
    expect(isLatePromotion({ promotedAt: { seconds: (start + 1000) / 1000, nanoseconds: 0 } }, ev)).toBe(true);
    expect(isLatePromotion({ promotedAt: '2026-11-10T18:00:00+08:00' }, ev)).toBe(false);
    expect(isLatePromotion({}, ev)).toBe(false);
    // 純數字毫秒
    expect(isLatePromotion({ promotedAt: start + 1 }, ev)).toBe(true);
    expect(isLatePromotion({ promotedAt: start - 1 }, ev)).toBe(false);
    expect(isLatePromotion({ promotedAt: start }, ev)).toBe(false);
  });
});

describe('noshow v2 per-user counted stats', () => {
  const flags = (entries = [['doc-e1', true]]) => new Map(entries);
  const stats = (overrides = {}) => computeUserCountedStats({
    uid,
    participations: [{ event: event(), registration: reg(uid) }],
    flagsByEventDocId: flags(),
    attendanceRecords: [],
    since: SINCE,
    ...overrides,
  });

  test('no checkin and no checkout in a counted event is a no-show', () => {
    expect(stats()).toEqual({
      participatedCount: 1,
      countedCount: 1,
      countedCompletedCount: 0,
      countedIncompleteCount: 0,
      countedNoShowCount: 1,
      countedSince: SINCE,
      lastWasNoShow: true,
    });
  });

  test('checkin only is incomplete, not a no-show', () => {
    expect(stats({ attendanceRecords: [att('checkin', uid)] })).toMatchObject({
      countedCount: 1, countedCompletedCount: 0, countedIncompleteCount: 1, countedNoShowCount: 0, lastWasNoShow: false,
    });
  });

  test('checkout only is completed', () => {
    expect(stats({ attendanceRecords: [att('checkout', uid)] })).toMatchObject({
      countedCompletedCount: 1, countedIncompleteCount: 0, countedNoShowCount: 0,
    });
  });

  test('checkin + checkout is completed once', () => {
    expect(stats({ attendanceRecords: [att('checkin', uid), att('checkout', uid), att('checkout', uid)] })).toMatchObject({
      countedCount: 1, countedCompletedCount: 1,
    });
  });

  test('removed/cancelled, companion, other-uid and userId-only records are ignored', () => {
    expect(stats({
      attendanceRecords: [
        att('checkin', uid, { status: 'removed' }),
        att('checkout', uid, { status: 'cancelled' }),
        att('checkout', uid, { companionId: 'c1' }),
        att('checkout', 'U-other'),
        { userId: uid, eventId: 'e1', type: 'checkout' },
      ],
    })).toMatchObject({ countedNoShowCount: 1, countedCompletedCount: 0 });
  });

  test('attendance keyed by doc id matches the event', () => {
    expect(stats({ attendanceRecords: [att('checkout', uid, { eventId: 'doc-e1' })] }).countedCompletedCount).toBe(1);
  });

  test('event before since only counts as participated', () => {
    expect(stats({
      participations: [{ event: event({ date: '2026/11/1 19:00~21:00' }), registration: reg(uid) }],
    })).toMatchObject({ participatedCount: 1, countedCount: 0, countedNoShowCount: 0, lastWasNoShow: false });
  });

  test('event without flag (no valid checkout by anyone) only counts as participated', () => {
    expect(stats({ flagsByEventDocId: new Map() })).toMatchObject({ participatedCount: 1, countedCount: 0 });
    expect(stats({ flagsByEventDocId: flags([['doc-e1', false]]) })).toMatchObject({ countedCount: 0 });
  });

  test('flag flip moves the event in and out of counted', () => {
    const on = stats({ flagsByEventDocId: flags([['doc-e1', true]]) });
    const off = stats({ flagsByEventDocId: flags([['doc-e1', false]]) });
    expect(on.countedCount).toBe(1);
    expect(off.countedCount).toBe(0);
    expect(off.participatedCount).toBe(on.participatedCount);
  });

  test('waitlist promoted after event start is not counted for that user', () => {
    const late = reg(uid, { promotedAt: new Date(Date.parse('2026-11-10T19:30:00+08:00')) });
    const early = reg(uid, { promotedAt: new Date(Date.parse('2026-11-09T12:00:00+08:00')) });
    expect(stats({ participations: [{ event: event(), registration: late }] })).toMatchObject({ participatedCount: 1, countedCount: 0 });
    expect(stats({ participations: [{ event: event(), registration: early }] })).toMatchObject({ countedCount: 1 });
  });

  test('legacy participation without registration can still be counted', () => {
    expect(stats({ participations: [{ event: event(), registration: null }] }).countedCount).toBe(1);
  });

  test('host participant own checkout still completes their own event', () => {
    expect(computeUserCountedStats({
      uid: 'U-host',
      participations: [{ event: event(), registration: reg('U-host') }],
      flagsByEventDocId: flags(),
      attendanceRecords: [att('checkout', 'U-host')],
      since: SINCE,
    }).countedCompletedCount).toBe(1);
  });

  test('lastWasNoShow follows the latest counted event by start time', () => {
    const e2 = event({ id: 'e2', _docId: 'doc-e2', date: '2026/11/20 08:00~10:00' });
    const e3old = event({ id: 'e3', _docId: 'doc-e3', date: '2026/11/9 08:00~10:00' });
    const result = stats({
      participations: [
        { event: event(), registration: reg(uid) },
        { event: e2, registration: reg(uid, { eventId: 'e2' }) },
        { event: e3old, registration: reg(uid, { eventId: 'e3' }) },
      ],
      flagsByEventDocId: flags([['doc-e1', true], ['doc-e2', true], ['doc-e3', true]]),
      attendanceRecords: [att('checkout', uid, { eventId: 'e2' })],
    });
    expect(result).toMatchObject({ countedCount: 3, countedCompletedCount: 1, countedNoShowCount: 2, lastWasNoShow: false });
  });

  test('duplicate participations count once', () => {
    expect(stats({
      participations: [{ event: event(), registration: reg(uid) }, { event: event(), registration: reg(uid) }],
    })).toMatchObject({ participatedCount: 1, countedCount: 1 });
  });

  test('empty uid returns zero summary with since', () => {
    expect(computeUserCountedStats({ uid: '', since: SINCE })).toMatchObject({
      participatedCount: 0, countedCount: 0, countedSince: SINCE, lastWasNoShow: false,
    });
  });
});
