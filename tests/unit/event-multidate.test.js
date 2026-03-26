/**
 * Event Multi-Date Batch Creation Tests
 * ======================================
 * Tests pure logic: date dedup, limit, relative time calculation,
 * batch event generation, batchGroupId.
 */

// ── Helpers extracted from event-create-multidate.js (pure functions) ──

function calcRegOpenForDate(eventDateStr, eventStartTime, relDays, relHours) {
  if (relDays === 0 && relHours === 0) return '';
  const dt = new Date(eventDateStr + 'T' + eventStartTime);
  if (isNaN(dt.getTime())) return '';
  dt.setDate(dt.getDate() - relDays);
  dt.setHours(dt.getHours() - relHours);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  return y + '-' + m + '-' + d + 'T' + hh + ':' + mm;
}

function buildMultiDateEvents(baseEvent, multiDates, tStart, tEnd, relDays, relHours) {
  const timeVal = tStart + '~' + tEnd;
  const batchGroupId = 'batch_test_123';
  const events = [];
  for (let i = 0; i < multiDates.length; i++) {
    const dateStr = multiDates[i];
    const fullDate = dateStr.replace(/-/g, '/') + ' ' + timeVal;
    const regOpen = calcRegOpenForDate(dateStr, tStart, relDays, relHours);
    events.push(Object.assign({}, baseEvent, {
      id: 'ce_test_' + i,
      date: fullDate,
      regOpenTime: regOpen || null,
      batchGroupId: batchGroupId,
      current: 0,
      waitlist: 0,
      participants: [],
      waitlistNames: [],
    }));
  }
  return events;
}

function formatMultiDateLabel(dateStr) {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return parseInt(parts[1], 10) + '/' + parseInt(parts[2], 10);
}

// ── Tests ──

describe('calcRegOpenForDate', () => {
  test('0 days 0 hours → empty (immediate open)', () => {
    expect(calcRegOpenForDate('2026-04-27', '19:00', 0, 0)).toBe('');
  });

  test('3 days 0 hours before → 3 days earlier same time', () => {
    expect(calcRegOpenForDate('2026-04-27', '19:00', 3, 0)).toBe('2026-04-24T19:00');
  });

  test('0 days 7 hours before → same day earlier', () => {
    expect(calcRegOpenForDate('2026-04-27', '19:00', 0, 7)).toBe('2026-04-27T12:00');
  });

  test('1 day 2 hours before', () => {
    expect(calcRegOpenForDate('2026-04-27', '19:00', 1, 2)).toBe('2026-04-26T17:00');
  });

  test('cross-month: May 1 minus 3 days → April 28', () => {
    expect(calcRegOpenForDate('2026-05-01', '19:00', 3, 0)).toBe('2026-04-28T19:00');
  });

  test('cross-year: Jan 1 minus 1 day → Dec 31', () => {
    expect(calcRegOpenForDate('2027-01-01', '10:00', 1, 0)).toBe('2026-12-31T10:00');
  });

  test('hours wrap to previous day', () => {
    expect(calcRegOpenForDate('2026-04-27', '02:00', 0, 5)).toBe('2026-04-26T21:00');
  });

  test('invalid date → empty', () => {
    expect(calcRegOpenForDate('invalid', '19:00', 3, 0)).toBe('');
  });
});

describe('buildMultiDateEvents', () => {
  const base = {
    title: '週二足球',
    type: 'play',
    location: '大安運動中心',
    fee: 200,
    max: 20,
    sportTag: 'football',
  };

  test('generates correct number of events', () => {
    const dates = ['2026-04-07', '2026-04-14', '2026-04-21'];
    const events = buildMultiDateEvents(base, dates, '19:00', '21:00', 3, 0);
    expect(events).toHaveLength(3);
  });

  test('each event has unique id', () => {
    const dates = ['2026-04-07', '2026-04-14'];
    const events = buildMultiDateEvents(base, dates, '19:00', '21:00', 0, 0);
    const ids = events.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('each event has correct date format', () => {
    const dates = ['2026-04-07', '2026-04-14'];
    const events = buildMultiDateEvents(base, dates, '19:00', '21:00', 0, 0);
    expect(events[0].date).toBe('2026/04/07 19:00~21:00');
    expect(events[1].date).toBe('2026/04/14 19:00~21:00');
  });

  test('all events share batchGroupId', () => {
    const dates = ['2026-04-07', '2026-04-14', '2026-04-21'];
    const events = buildMultiDateEvents(base, dates, '19:00', '21:00', 0, 0);
    const groupIds = new Set(events.map(e => e.batchGroupId));
    expect(groupIds.size).toBe(1);
    expect(events[0].batchGroupId).toBeTruthy();
  });

  test('regOpenTime calculated per event', () => {
    const dates = ['2026-04-07', '2026-04-14'];
    const events = buildMultiDateEvents(base, dates, '19:00', '21:00', 3, 0);
    expect(events[0].regOpenTime).toBe('2026-04-04T19:00');
    expect(events[1].regOpenTime).toBe('2026-04-11T19:00');
  });

  test('regOpenTime null when relative is 0/0', () => {
    const dates = ['2026-04-07'];
    const events = buildMultiDateEvents(base, dates, '19:00', '21:00', 0, 0);
    expect(events[0].regOpenTime).toBeNull();
  });

  test('base event fields are preserved', () => {
    const dates = ['2026-04-07'];
    const events = buildMultiDateEvents(base, dates, '19:00', '21:00', 0, 0);
    expect(events[0].title).toBe('週二足球');
    expect(events[0].type).toBe('play');
    expect(events[0].location).toBe('大安運動中心');
    expect(events[0].fee).toBe(200);
    expect(events[0].max).toBe(20);
  });

  test('each event starts with empty participants', () => {
    const dates = ['2026-04-07', '2026-04-14'];
    const events = buildMultiDateEvents(base, dates, '19:00', '21:00', 0, 0);
    events.forEach(e => {
      expect(e.current).toBe(0);
      expect(e.waitlist).toBe(0);
      expect(e.participants).toEqual([]);
      expect(e.waitlistNames).toEqual([]);
    });
  });

  test('does not mutate base event', () => {
    const dates = ['2026-04-07'];
    const before = JSON.stringify(base);
    buildMultiDateEvents(base, dates, '19:00', '21:00', 1, 0);
    expect(JSON.stringify(base)).toBe(before);
  });
});

describe('formatMultiDateLabel', () => {
  test('formats YYYY-MM-DD to M/D', () => {
    expect(formatMultiDateLabel('2026-04-07')).toBe('4/7');
    expect(formatMultiDateLabel('2026-12-25')).toBe('12/25');
  });

  test('strips leading zeros', () => {
    expect(formatMultiDateLabel('2026-01-05')).toBe('1/5');
  });

  test('returns raw string on invalid format', () => {
    expect(formatMultiDateLabel('invalid')).toBe('invalid');
  });
});

describe('date dedup and limit logic', () => {
  test('sorted dates produce sorted events', () => {
    const dates = ['2026-04-14', '2026-04-07', '2026-04-21'];
    dates.sort();
    const events = buildMultiDateEvents({}, dates, '19:00', '21:00', 0, 0);
    expect(events[0].date).toContain('04/07');
    expect(events[1].date).toContain('04/14');
    expect(events[2].date).toContain('04/21');
  });

  test('duplicate dates in input produce duplicate events (dedup is caller responsibility)', () => {
    const dates = ['2026-04-07', '2026-04-07'];
    const events = buildMultiDateEvents({}, dates, '19:00', '21:00', 0, 0);
    expect(events).toHaveLength(2);
  });

  test('30 dates produces 30 events', () => {
    const dates = [];
    for (let d = 1; d <= 30; d++) {
      dates.push('2026-04-' + String(d).padStart(2, '0'));
    }
    const events = buildMultiDateEvents({}, dates, '10:00', '12:00', 0, 0);
    expect(events).toHaveLength(30);
  });
});
