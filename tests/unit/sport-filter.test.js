/**
 * Sport Filter — unit tests
 *
 * Tests the _filterBySportTag logic extracted from
 * js/modules/event/event-list-helpers.js:280-284
 */

// Extracted logic (matches source)
function _filterBySportTag(events, activeSport) {
  const tag = activeSport || 'all';
  if (tag === 'all') return events;
  return events.filter(e => (e.sportTag || 'football') === tag);
}

const sampleEvents = [
  { id: '1', title: 'Football A', sportTag: 'football' },
  { id: '2', title: 'Football B', sportTag: 'football' },
  { id: '3', title: 'Basketball A', sportTag: 'basketball' },
  { id: '4', title: 'Running A', sportTag: 'running' },
  { id: '5', title: 'Legacy (no tag)', sportTag: undefined },
  { id: '6', title: 'Legacy null', sportTag: null },
  { id: '7', title: 'Legacy empty', sportTag: '' },
];

const calendarSportOptions = [
  { key: 'football', label: '足球' },
  { key: 'basketball', label: '籃球' },
  { key: 'pickleball', label: '匹克球' },
  { key: 'dodgeball', label: '美式躲避球' },
  { key: 'running', label: '跑步' },
];

function _getSportKeySafe(key) {
  const raw = String(key || '').trim();
  return calendarSportOptions.some(opt => opt.key === raw) ? raw : '';
}

function _buildCalendarSportCounts(events) {
  const orderMap = new Map(calendarSportOptions.map((item, index) => [item.key, index]));
  const counts = new Map();
  events.forEach(event => {
    const sportKey = _getSportKeySafe(event?.sportTag) || 'football';
    counts.set(sportKey, (counts.get(sportKey) || 0) + 1);
  });
  return Array.from(counts, ([sportKey, count]) => ({ sportKey, count }))
    .sort((a, b) => (orderMap.get(a.sportKey) ?? 999) - (orderMap.get(b.sportKey) ?? 999));
}

describe('_filterBySportTag', () => {
  test('all → returns all events unfiltered', () => {
    const result = _filterBySportTag(sampleEvents, 'all');
    expect(result).toHaveLength(7);
  });

  test('undefined activeSport → treated as all', () => {
    const result = _filterBySportTag(sampleEvents, undefined);
    expect(result).toHaveLength(7);
  });

  test('empty string activeSport → treated as all', () => {
    const result = _filterBySportTag(sampleEvents, '');
    expect(result).toHaveLength(7);
  });

  test('football → returns football + legacy events (no tag defaults to football)', () => {
    const result = _filterBySportTag(sampleEvents, 'football');
    expect(result).toHaveLength(5);
    expect(result.map(e => e.id).sort()).toEqual(['1', '2', '5', '6', '7']);
  });

  test('basketball → returns only basketball events', () => {
    const result = _filterBySportTag(sampleEvents, 'basketball');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('3');
  });

  test('running → returns only running events', () => {
    const result = _filterBySportTag(sampleEvents, 'running');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('4');
  });

  test('nonexistent sport → returns empty array', () => {
    const result = _filterBySportTag(sampleEvents, 'badminton');
    expect(result).toHaveLength(0);
  });

  test('empty events array → returns empty', () => {
    const result = _filterBySportTag([], 'football');
    expect(result).toHaveLength(0);
  });

  test('does not mutate original array', () => {
    const copy = [...sampleEvents];
    _filterBySportTag(sampleEvents, 'basketball');
    expect(sampleEvents).toEqual(copy);
  });
});

describe('_buildCalendarSportCounts', () => {
  test('groups all visible events by sport in configured sport order', () => {
    const events = [
      { id: 'p1', sportTag: 'pickleball' },
      { id: 'f1', sportTag: 'football' },
      { id: 'd1', sportTag: 'dodgeball' },
      { id: 'b1', sportTag: 'basketball' },
      { id: 'p2', sportTag: 'pickleball' },
      { id: 'f2', sportTag: 'football' },
    ];

    expect(_buildCalendarSportCounts(events)).toEqual([
      { sportKey: 'football', count: 2 },
      { sportKey: 'basketball', count: 1 },
      { sportKey: 'pickleball', count: 2 },
      { sportKey: 'dodgeball', count: 1 },
    ]);
  });

  test('respects active sport filtering before calendar count rendering', () => {
    const footballOnly = _filterBySportTag(sampleEvents, 'football');
    expect(_buildCalendarSportCounts(footballOnly)).toEqual([
      { sportKey: 'football', count: 5 },
    ]);
  });

  test('treats legacy or invalid sport tags as football', () => {
    const result = _buildCalendarSportCounts([
      { id: 'legacy-a' },
      { id: 'legacy-b', sportTag: '' },
      { id: 'invalid', sportTag: 'curling' },
    ]);

    expect(result).toEqual([
      { sportKey: 'football', count: 3 },
    ]);
  });
});
