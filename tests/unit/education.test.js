/**
 * Education module unit tests — extracted pure functions.
 *
 * Source files:
 *   js/modules/education/edu-helpers.js
 */

// ---------------------------------------------------------------------------
// Extracted from js/modules/education/edu-helpers.js:80-96
// calcAge — age from birthday string
// ---------------------------------------------------------------------------
function calcAge(birthday, referenceDate) {
  if (!birthday) return null;
  const parts = birthday.split('-');
  if (parts.length !== 3) return null;
  const birthYear = parseInt(parts[0], 10);
  const birthMonth = parseInt(parts[1], 10);
  const birthDay = parseInt(parts[2], 10);
  if (isNaN(birthYear) || isNaN(birthMonth) || isNaN(birthDay)) return null;

  const ref = referenceDate ? new Date(referenceDate) : new Date();
  let age = ref.getFullYear() - birthYear;
  const monthDiff = (ref.getMonth() + 1) - birthMonth;
  if (monthDiff < 0 || (monthDiff === 0 && ref.getDate() < birthDay)) {
    age--;
  }
  return age;
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/education/edu-helpers.js:104-115
// autoMatchGroups — matches age to active groups with age range
// ---------------------------------------------------------------------------
function autoMatchGroups(age, groups) {
  if (age == null || !Array.isArray(groups)) return [];
  return groups
    .filter(g => {
      if (!g.active) return false;
      if (g.ageMin == null && g.ageMax == null) return false;
      if (g.ageMin != null && age < g.ageMin) return false;
      if (g.ageMax != null && age > g.ageMax) return false;
      return true;
    })
    .map(g => g.id);
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/education/edu-helpers.js:161-179
// generateWeeklyDates — generates dates for weekday-based course plan
// ---------------------------------------------------------------------------
function generateWeeklyDates(plan) {
  if (!plan || !plan.weekdays || !plan.startDate || !plan.endDate) return [];
  const dates = [];
  const start = new Date(plan.startDate);
  const end = new Date(plan.endDate);
  const weekdays = new Set(plan.weekdays);

  const current = new Date(start);
  while (current <= end) {
    if (weekdays.has(current.getDay())) {
      const y = current.getFullYear();
      const m = String(current.getMonth() + 1).padStart(2, '0');
      const d = String(current.getDate()).padStart(2, '0');
      dates.push(y + '-' + m + '-' + d);
    }
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/education/edu-helpers.js:184-186
// _weekdayLabel — weekday number to Chinese label
// ---------------------------------------------------------------------------
function _weekdayLabel(day) {
  return ['日', '一', '二', '三', '四', '五', '六'][day] || '';
}

// ===========================================================================
// TESTS
// ===========================================================================

describe('calcAge (edu-helpers.js:80-96)', () => {
  test('exact birthday → age calculated correctly', () => {
    // Reference: 2026-03-19, birthday: 2000-03-19 → 26
    expect(calcAge('2000-03-19', '2026-03-19')).toBe(26);
  });

  test('birthday not yet reached this year → age - 1', () => {
    // Reference: 2026-03-19, birthday: 2000-06-15 → 25 (not yet 26)
    expect(calcAge('2000-06-15', '2026-03-19')).toBe(25);
  });

  test('birthday already passed this year → correct age', () => {
    // Reference: 2026-03-19, birthday: 2000-01-10 → 26
    expect(calcAge('2000-01-10', '2026-03-19')).toBe(26);
  });

  test('same month, day before birthday → age - 1', () => {
    // Reference: 2026-03-10, birthday: 2000-03-15 → 25
    expect(calcAge('2000-03-15', '2026-03-10')).toBe(25);
  });

  test('null/empty birthday → null', () => {
    expect(calcAge(null)).toBeNull();
    expect(calcAge('')).toBeNull();
  });

  test('invalid format → null', () => {
    expect(calcAge('not-a-date')).toBeNull();
    expect(calcAge('2000/01/01')).toBeNull(); // wrong separator
  });

  test('partial date → null', () => {
    expect(calcAge('2000-01')).toBeNull();
  });

  test('child age', () => {
    expect(calcAge('2018-06-01', '2026-03-19')).toBe(7);
  });
});

describe('autoMatchGroups (edu-helpers.js:104-115)', () => {
  const groups = [
    { id: 'g1', active: true, ageMin: 6, ageMax: 8 },
    { id: 'g2', active: true, ageMin: 9, ageMax: 12 },
    { id: 'g3', active: false, ageMin: 6, ageMax: 12 },
    { id: 'g4', active: true, ageMin: null, ageMax: null },
  ];

  test('age matches first group', () => {
    expect(autoMatchGroups(7, groups)).toEqual(['g1']);
  });

  test('age matches second group', () => {
    expect(autoMatchGroups(10, groups)).toEqual(['g2']);
  });

  test('age too young for any', () => {
    expect(autoMatchGroups(5, groups)).toEqual([]);
  });

  test('age too old for any', () => {
    expect(autoMatchGroups(13, groups)).toEqual([]);
  });

  test('inactive groups excluded', () => {
    // g3 covers age 7 but is inactive
    const result = autoMatchGroups(7, groups);
    expect(result).not.toContain('g3');
  });

  test('groups with no age range excluded', () => {
    // g4 has null ageMin/ageMax
    const result = autoMatchGroups(7, groups);
    expect(result).not.toContain('g4');
  });

  test('null age → empty', () => {
    expect(autoMatchGroups(null, groups)).toEqual([]);
  });

  test('non-array groups → empty', () => {
    expect(autoMatchGroups(7, null)).toEqual([]);
  });

  test('boundary: exactly at ageMin', () => {
    expect(autoMatchGroups(6, groups)).toEqual(['g1']);
  });

  test('boundary: exactly at ageMax', () => {
    expect(autoMatchGroups(8, groups)).toEqual(['g1']);
  });

  test('open-ended: only ageMin set', () => {
    const openGroups = [{ id: 'x', active: true, ageMin: 5, ageMax: null }];
    expect(autoMatchGroups(5, openGroups)).toEqual(['x']);
    expect(autoMatchGroups(100, openGroups)).toEqual(['x']);
    expect(autoMatchGroups(4, openGroups)).toEqual([]);
  });
});

describe('generateWeeklyDates (edu-helpers.js:161-179)', () => {
  test('generates correct dates for a single weekday', () => {
    // 2026-03-02 is Monday (weekday=1), 2026-03-15 is Sunday
    const plan = {
      weekdays: [1], // Monday
      startDate: '2026-03-02',
      endDate: '2026-03-15',
    };
    const dates = generateWeeklyDates(plan);
    expect(dates).toEqual(['2026-03-02', '2026-03-09']);
  });

  test('multiple weekdays', () => {
    // Mon + Wed in one week
    const plan = {
      weekdays: [1, 3], // Mon, Wed
      startDate: '2026-03-02',
      endDate: '2026-03-08', // Sun
    };
    const dates = generateWeeklyDates(plan);
    expect(dates).toEqual(['2026-03-02', '2026-03-04']);
  });

  test('empty weekdays → no dates', () => {
    const plan = {
      weekdays: [],
      startDate: '2026-03-01',
      endDate: '2026-03-31',
    };
    expect(generateWeeklyDates(plan)).toEqual([]);
  });

  test('null plan → empty', () => {
    expect(generateWeeklyDates(null)).toEqual([]);
  });

  test('missing startDate → empty', () => {
    expect(generateWeeklyDates({ weekdays: [1], endDate: '2026-03-31' })).toEqual([]);
  });

  test('start after end → empty', () => {
    const plan = {
      weekdays: [1],
      startDate: '2026-04-01',
      endDate: '2026-03-01',
    };
    expect(generateWeeklyDates(plan)).toEqual([]);
  });

  test('same start and end date, matching weekday', () => {
    // 2026-03-02 is Monday
    const plan = {
      weekdays: [1],
      startDate: '2026-03-02',
      endDate: '2026-03-02',
    };
    expect(generateWeeklyDates(plan)).toEqual(['2026-03-02']);
  });
});

describe('_weekdayLabel (edu-helpers.js:184-186)', () => {
  test('0 → 日', () => {
    expect(_weekdayLabel(0)).toBe('日');
  });

  test('1 → 一', () => {
    expect(_weekdayLabel(1)).toBe('一');
  });

  test('6 → 六', () => {
    expect(_weekdayLabel(6)).toBe('六');
  });

  test('out of range → empty string', () => {
    expect(_weekdayLabel(7)).toBe('');
    expect(_weekdayLabel(-1)).toBe('');
  });
});
