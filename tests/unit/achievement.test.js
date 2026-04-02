/**
 * Achievement module unit tests — extracted from the frontend codebase.
 *
 * The project uses Object.assign(App, {...}) (not ES modules), so each
 * function body is copied here as a standalone testable function.
 * A comment above each function notes the source file and line range.
 */

// ===========================================================================
// Constants (extracted from js/modules/achievement/shared.js:10-25)
// ===========================================================================
const CATEGORY_ORDER = { gold: 0, silver: 1, bronze: 2 };
const CATEGORY_COLOR = {
  gold: '#d4a017',
  silver: '#9ca3af',
  bronze: '#b87333',
};
const CATEGORY_BG = {
  gold: 'rgba(212,160,23,.12)',
  silver: 'rgba(156,163,175,.12)',
  bronze: 'rgba(184,115,51,.12)',
};
const CATEGORY_LABEL = {
  gold: '\u91d1',
  silver: '\u9280',
  bronze: '\u9285',
};

// ===========================================================================
// Functions from js/modules/achievement/shared.js
// ===========================================================================

// ---------------------------------------------------------------------------
// Extracted from js/modules/achievement/shared.js:28-29
// ---------------------------------------------------------------------------
function sortByCat(items) {
  return [...items].sort((a, b) => (CATEGORY_ORDER[a.category] ?? 9) - (CATEGORY_ORDER[b.category] ?? 9));
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/achievement/shared.js:32-33
// ---------------------------------------------------------------------------
function getCategoryOrder() {
  return { ...CATEGORY_ORDER };
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/achievement/shared.js:36-37
// ---------------------------------------------------------------------------
function getCategoryColor(category) {
  return CATEGORY_COLOR[category] || CATEGORY_COLOR.bronze;
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/achievement/shared.js:40-41
// ---------------------------------------------------------------------------
function getCategoryBg(category) {
  return CATEGORY_BG[category] || CATEGORY_BG.bronze;
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/achievement/shared.js:44-45
// ---------------------------------------------------------------------------
function getCategoryLabel(category) {
  return CATEGORY_LABEL[category] || CATEGORY_LABEL.bronze;
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/achievement/shared.js:48-52
// ---------------------------------------------------------------------------
function getThresholdShared(achievement) {
  if (achievement?.condition?.threshold != null) return achievement.condition.threshold;
  if (achievement?.target != null) return achievement.target;
  return 1;
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/achievement/shared.js:54-84
// generateConditionDesc depends on a registry; we test the no-registry path
// ---------------------------------------------------------------------------
function generateConditionDesc(condition, desc) {
  if (!condition) return desc || '\u672a\u8a2d\u5b9a\u6210\u5c31\u689d\u4ef6';

  // In test context, no registry is available, so we simulate the fallback
  const actionLabel = condition.action;
  const unit = '';
  const threshold = condition.threshold != null ? condition.threshold : 0;

  if (condition.timeRange === 'streak') {
    const days = condition.streakDays || threshold;
    return `\u9023\u7e8c ${days} \u5929${actionLabel}`;
  }

  if (!unit && threshold <= 1) return actionLabel;

  const timeText = (condition.timeRange && condition.timeRange !== 'none') ? `${condition.timeRange}` : '';
  if (timeText) {
    return `${timeText}${actionLabel} ${threshold}`.trim();
  }
  return `${actionLabel} ${threshold}`.trim();
}

// ===========================================================================
// Functions from js/modules/achievement/evaluator.js
// ===========================================================================

// ---------------------------------------------------------------------------
// Extracted from js/modules/achievement/evaluator.js:13
// ---------------------------------------------------------------------------
function normalizeString(value) {
  return String(value || '').trim();
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/achievement/evaluator.js:14
// ---------------------------------------------------------------------------
function normalizeLower(value) {
  return normalizeString(value).toLowerCase();
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/achievement/evaluator.js:15-18
// ---------------------------------------------------------------------------
function toFiniteNumber(value, fallback) {
  if (fallback === undefined) fallback = 0;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/achievement/evaluator.js:20-76
// ---------------------------------------------------------------------------
function parseDateValue(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }

  if (typeof value?.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }

  if (typeof value?.seconds === 'number') {
    const ms = (value.seconds * 1000) + Math.floor((value.nanoseconds || 0) / 1000000);
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value !== 'string') return null;

  const raw = value.trim();
  if (!raw) return null;

  let match = raw.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (match) {
    const date = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4] || 0),
      Number(match[5] || 0),
      Number(match[6] || 0)
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }

  match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (match) {
    const date = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4] || 0),
      Number(match[5] || 0),
      Number(match[6] || 0)
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/achievement/evaluator.js:123
// ---------------------------------------------------------------------------
function isEventEnded(event, now) {
  // Simplified version: checks event.status directly
  if (!event) return false;
  const rawStatus = normalizeString(event.status);
  if (rawStatus === 'ended') return true;
  return false;
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/achievement/evaluator.js:125-129
// ---------------------------------------------------------------------------
function maxDate(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;
  return a.getTime() >= b.getTime() ? a : b;
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/achievement/evaluator.js:131-134
// ---------------------------------------------------------------------------
function formatCompletedDate(date) {
  const d = date instanceof Date ? date : new Date();
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/achievement/evaluator.js:136-141
// ---------------------------------------------------------------------------
function normalizeCurrentValue(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  if (num <= 0) return 0;
  return Math.round(num);
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/achievement/evaluator.js:143-149
// ---------------------------------------------------------------------------
function isSelfParticipantRecord(record, uid) {
  if (!record) return false;
  const recordUid = normalizeString(record.userId || record.uid);
  if (!recordUid || recordUid !== normalizeString(uid)) return false;
  if (record.companionId || record.participantType === 'companion') return false;
  return true;
}

// ===========================================================================
// Functions from js/modules/achievement/stats.js
// ===========================================================================

// ---------------------------------------------------------------------------
// Extracted from js/modules/achievement/stats.js:13-18
// Standalone version (no App._getAchievementShared dependency)
// ---------------------------------------------------------------------------
function getThreshold(achievement) {
  if (achievement?.condition?.threshold != null) return achievement.condition.threshold;
  if (achievement?.target != null) return achievement.target;
  return 1;
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/achievement/stats.js:21-26
// Standalone version: no registry dependency, only filters archived
// ---------------------------------------------------------------------------
function getActiveAchievements(achievements) {
  return (Array.isArray(achievements) ? achievements : [])
    .filter(achievement => achievement && achievement.status !== 'archived');
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/achievement/stats.js:28-38
// Note: registry/actionMeta is null in test context (no App global),
// so reverseComparison is always falsy → normal comparison path.
// ---------------------------------------------------------------------------
function isCompleted(achievement) {
  const registry = null; // App._getAchievementRegistry not available in test
  const actionMeta = registry?.findActionMeta?.(achievement?.condition?.action);
  const threshold = Number(getThreshold(achievement));
  const safeThreshold = actionMeta?.reverseComparison ? threshold : Math.max(1, threshold);
  const current = Number(achievement?.current || 0);
  return actionMeta?.reverseComparison
    ? current <= safeThreshold
    : current >= safeThreshold;
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/achievement/stats.js:32-34
// ---------------------------------------------------------------------------
function getCompletedAchievements(achievements) {
  return getActiveAchievements(achievements).filter(isCompleted);
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/achievement/stats.js:36-38
// ---------------------------------------------------------------------------
function getPendingAchievements(achievements) {
  return getActiveAchievements(achievements).filter(achievement => !isCompleted(achievement));
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/achievement/stats.js:40-45
// ---------------------------------------------------------------------------
function splitAchievements(achievements) {
  const active = getActiveAchievements(achievements);
  const completed = active.filter(isCompleted);
  const pending = active.filter(achievement => !isCompleted(achievement));
  return { active, completed, pending };
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/achievement/stats.js:47-49 + 51-71
// Standalone: uses getCompletedAchievements and takes badges directly
// ---------------------------------------------------------------------------
function getBadgeCount(achievements, badges) {
  return getEarnedBadgeViewModels(achievements, badges).length;
}

function getEarnedBadgeViewModels(achievements, badges) {
  const completedAchievements = getCompletedAchievements(achievements);
  const badgeList = Array.isArray(badges) ? badges : [];
  const completedMap = new Map(completedAchievements.map(achievement => [achievement.id, achievement]));

  return badgeList.map(badge => {
    const achievement = completedMap.get(badge?.achId);
    if (!achievement) return null;
    const category = achievement.category || badge.category || 'bronze';
    return {
      badge,
      achievement,
      achName: achievement.name,
      category,
      color: getCategoryColor(category),
      background: getCategoryBg(category),
      label: getCategoryLabel(category),
    };
  }).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/achievement/stats.js:73-80
// ---------------------------------------------------------------------------
function getTitleOptions(achievements) {
  const earned = getCompletedAchievements(achievements);
  return {
    earned,
    bigTitles: earned.filter(achievement => achievement.category === 'gold').map(achievement => achievement.name),
    normalTitles: earned.filter(achievement => achievement.category !== 'gold').map(achievement => achievement.name),
  };
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/achievement/stats.js:82-153
// Pure function version: all data passed as params
// ---------------------------------------------------------------------------
function getParticipantAttendanceStats({
  uid,
  registrations,
  attendanceRecords,
  eventMap,
  now = new Date(),
  isEventEnded: isEventEndedFn,
} = {}) {
  const safeUid = normalizeString(uid);
  const expectedEventIds = new Set();
  const attendanceStateByEvent = new Map();

  (Array.isArray(registrations) ? registrations : []).forEach(record => {
    if (!record) return;
    const recordUid = normalizeString(record.uid || record.userId || safeUid);
    if (recordUid && safeUid && recordUid !== safeUid) return;
    if (normalizeString(record.status) !== 'registered') return;

    const eventId = normalizeString(record.eventId);
    if (!eventId) return;
    const event = eventMap?.get?.(eventId) || null;
    if (!event) return;

    const ended = typeof isEventEndedFn === 'function'
      ? isEventEndedFn(event, now)
      : normalizeString(event.status) === 'ended';
    if (!ended) return;

    expectedEventIds.add(eventId);
  });

  (Array.isArray(attendanceRecords) ? attendanceRecords : []).forEach(record => {
    if (!record) return;
    if (normalizeString(record.uid) !== safeUid) return;
    if (record.companionId || record.participantType === 'companion') return;

    const eventId = normalizeString(record.eventId);
    if (!expectedEventIds.has(eventId)) return;

    const type = normalizeString(record.type);
    if (type !== 'checkin' && type !== 'checkout') return;

    const state = attendanceStateByEvent.get(eventId) || { checkin: false, checkout: false };
    if (type === 'checkin') state.checkin = true;
    if (type === 'checkout') state.checkout = true;
    attendanceStateByEvent.set(eventId, state);
  });

  const attendedEventIds = new Set();
  const completedEventIds = new Set();
  attendanceStateByEvent.forEach((state, eventId) => {
    if (state.checkin) attendedEventIds.add(eventId);
    if (state.checkin && state.checkout) completedEventIds.add(eventId);
  });

  const expectedCount = expectedEventIds.size;
  const attendedCount = attendedEventIds.size;
  const completedCount = completedEventIds.size;
  const attendRate = expectedCount > 0
    ? Math.round((attendedCount / expectedCount) * 100)
    : 0;

  return {
    expectedEventIds,
    attendedEventIds,
    completedEventIds,
    expectedCount,
    attendedCount,
    completedCount,
    attendRate,
  };
}


// ===========================================================================
// TESTS
// ===========================================================================

// ---- shared.js tests ----

describe('shared.js — sortByCat', () => {
  test('sorts gold before silver before bronze', () => {
    const items = [
      { category: 'bronze', name: 'B' },
      { category: 'gold', name: 'G' },
      { category: 'silver', name: 'S' },
    ];
    const result = sortByCat(items);
    expect(result.map(i => i.category)).toEqual(['gold', 'silver', 'bronze']);
  });

  test('does not mutate original array', () => {
    const items = [{ category: 'bronze' }, { category: 'gold' }];
    const original = [...items];
    sortByCat(items);
    expect(items).toEqual(original);
  });

  test('unknown categories sort to end', () => {
    const items = [
      { category: 'unknown' },
      { category: 'gold' },
    ];
    const result = sortByCat(items);
    expect(result[0].category).toBe('gold');
    expect(result[1].category).toBe('unknown');
  });

  test('empty array returns empty', () => {
    expect(sortByCat([])).toEqual([]);
  });

  test('stable sort for same category', () => {
    const items = [
      { category: 'silver', name: 'A' },
      { category: 'silver', name: 'B' },
    ];
    const result = sortByCat(items);
    expect(result[0].name).toBe('A');
    expect(result[1].name).toBe('B');
  });
});

describe('shared.js — getCategoryOrder', () => {
  test('returns copy of category order map', () => {
    const order = getCategoryOrder();
    expect(order).toEqual({ gold: 0, silver: 1, bronze: 2 });
  });

  test('returned object is a copy (not same reference)', () => {
    const order = getCategoryOrder();
    order.gold = 99;
    expect(getCategoryOrder().gold).toBe(0);
  });
});

describe('shared.js — getCategoryColor', () => {
  test('returns correct color for gold', () => {
    expect(getCategoryColor('gold')).toBe('#d4a017');
  });

  test('returns correct color for silver', () => {
    expect(getCategoryColor('silver')).toBe('#9ca3af');
  });

  test('returns correct color for bronze', () => {
    expect(getCategoryColor('bronze')).toBe('#b87333');
  });

  test('unknown category falls back to bronze', () => {
    expect(getCategoryColor('diamond')).toBe('#b87333');
  });

  test('undefined category falls back to bronze', () => {
    expect(getCategoryColor(undefined)).toBe('#b87333');
  });
});

describe('shared.js — getCategoryBg', () => {
  test('returns correct bg for gold', () => {
    expect(getCategoryBg('gold')).toBe('rgba(212,160,23,.12)');
  });

  test('unknown category falls back to bronze', () => {
    expect(getCategoryBg('platinum')).toBe('rgba(184,115,51,.12)');
  });
});

describe('shared.js — getCategoryLabel', () => {
  test('returns correct label for gold', () => {
    expect(getCategoryLabel('gold')).toBe('\u91d1');
  });

  test('returns correct label for silver', () => {
    expect(getCategoryLabel('silver')).toBe('\u9280');
  });

  test('returns correct label for bronze', () => {
    expect(getCategoryLabel('bronze')).toBe('\u9285');
  });

  test('unknown category falls back to bronze label', () => {
    expect(getCategoryLabel('mythic')).toBe('\u9285');
  });
});

describe('shared.js — getThresholdShared', () => {
  test('returns condition.threshold when present', () => {
    expect(getThresholdShared({ condition: { threshold: 5 } })).toBe(5);
  });

  test('returns target when no condition.threshold', () => {
    expect(getThresholdShared({ target: 3 })).toBe(3);
  });

  test('returns 1 as default', () => {
    expect(getThresholdShared({})).toBe(1);
  });

  test('returns 1 for null/undefined', () => {
    expect(getThresholdShared(null)).toBe(1);
    expect(getThresholdShared(undefined)).toBe(1);
  });

  test('threshold 0 is valid (not null)', () => {
    expect(getThresholdShared({ condition: { threshold: 0 } })).toBe(0);
  });
});

describe('shared.js — generateConditionDesc', () => {
  test('returns desc or default when no condition', () => {
    expect(generateConditionDesc(null, 'custom')).toBe('custom');
    expect(generateConditionDesc(null)).toBe('\u672a\u8a2d\u5b9a\u6210\u5c31\u689d\u4ef6');
    expect(generateConditionDesc(undefined, undefined)).toBe('\u672a\u8a2d\u5b9a\u6210\u5c31\u689d\u4ef6');
  });

  test('streak format', () => {
    const result = generateConditionDesc({ action: 'login', timeRange: 'streak', streakDays: 7, threshold: 7 });
    expect(result).toContain('7');
    expect(result).toContain('login');
  });

  test('simple action with threshold <= 1', () => {
    const result = generateConditionDesc({ action: 'complete_profile', threshold: 1 });
    expect(result).toBe('complete_profile');
  });

  test('action with threshold > 1', () => {
    const result = generateConditionDesc({ action: 'register_event', threshold: 10 });
    expect(result).toBe('register_event 10');
  });

  test('action with timeRange', () => {
    const result = generateConditionDesc({ action: 'attend_event', threshold: 5, timeRange: 'monthly' });
    expect(result).toBe('monthlyattend_event 5');
  });
});

// ---- evaluator.js tests ----

describe('evaluator.js — normalizeString', () => {
  test('trims whitespace', () => {
    expect(normalizeString('  hello  ')).toBe('hello');
  });

  test('converts null/undefined to empty string', () => {
    expect(normalizeString(null)).toBe('');
    expect(normalizeString(undefined)).toBe('');
  });

  test('converts number to string', () => {
    expect(normalizeString(123)).toBe('123');
  });

  test('converts 0 to empty string (falsy)', () => {
    expect(normalizeString(0)).toBe('');
  });

  test('empty string stays empty', () => {
    expect(normalizeString('')).toBe('');
  });

  test('preserves inner whitespace', () => {
    expect(normalizeString('  a b  ')).toBe('a b');
  });
});

describe('evaluator.js — normalizeLower', () => {
  test('lowercases and trims', () => {
    expect(normalizeLower('  HELLO  ')).toBe('hello');
  });

  test('null returns empty', () => {
    expect(normalizeLower(null)).toBe('');
  });

  test('mixed case', () => {
    expect(normalizeLower('FoO BaR')).toBe('foo bar');
  });
});

describe('evaluator.js — toFiniteNumber', () => {
  test('returns number for valid input', () => {
    expect(toFiniteNumber(42)).toBe(42);
    expect(toFiniteNumber('3.14')).toBeCloseTo(3.14);
  });

  test('returns fallback for NaN', () => {
    expect(toFiniteNumber('abc', 10)).toBe(10);
  });

  test('returns fallback for Infinity', () => {
    expect(toFiniteNumber(Infinity, 5)).toBe(5);
    expect(toFiniteNumber(-Infinity, 5)).toBe(5);
  });

  test('default fallback is 0', () => {
    expect(toFiniteNumber('abc')).toBe(0);
  });

  test('returns 0 for input 0', () => {
    expect(toFiniteNumber(0)).toBe(0);
  });

  test('returns negative numbers', () => {
    expect(toFiniteNumber(-7)).toBe(-7);
  });

  test('null returns 0 (Number(null) === 0, which is finite)', () => {
    expect(toFiniteNumber(null, 99)).toBe(0);
  });

  test('undefined returns fallback (Number(undefined) is NaN)', () => {
    expect(toFiniteNumber(undefined, 99)).toBe(99);
  });
});

describe('evaluator.js — parseDateValue', () => {
  test('returns null for null/undefined/empty', () => {
    expect(parseDateValue(null)).toBeNull();
    expect(parseDateValue(undefined)).toBeNull();
    expect(parseDateValue('')).toBeNull();
    expect(parseDateValue(0)).toBeNull();
    expect(parseDateValue(false)).toBeNull();
  });

  test('returns clone of valid Date object', () => {
    const original = new Date(2025, 0, 15);
    const result = parseDateValue(original);
    expect(result).toEqual(original);
    expect(result).not.toBe(original); // must be a clone
  });

  test('returns null for invalid Date object', () => {
    expect(parseDateValue(new Date('invalid'))).toBeNull();
  });

  test('handles Firestore Timestamp mock with toDate()', () => {
    const mockTimestamp = {
      toDate() { return new Date(2025, 5, 15); },
      seconds: 0,
      nanoseconds: 0,
    };
    const result = parseDateValue(mockTimestamp);
    expect(result).toEqual(new Date(2025, 5, 15));
  });

  test('handles Firestore Timestamp mock with toDate() returning invalid', () => {
    const mockTimestamp = {
      toDate() { return new Date('invalid'); },
    };
    expect(parseDateValue(mockTimestamp)).toBeNull();
  });

  test('handles {seconds, nanoseconds} object', () => {
    const ts = { seconds: 1700000000, nanoseconds: 500000000 };
    const result = parseDateValue(ts);
    expect(result).toBeInstanceOf(Date);
    expect(result.getTime()).toBe(1700000000 * 1000 + 500);
  });

  test('handles {seconds, nanoseconds} with no nanoseconds', () => {
    const ts = { seconds: 1700000000 };
    const result = parseDateValue(ts);
    expect(result.getTime()).toBe(1700000000 * 1000);
  });

  test('handles epoch number (milliseconds)', () => {
    const epoch = 1700000000000;
    const result = parseDateValue(epoch);
    expect(result).toBeInstanceOf(Date);
    expect(result.getTime()).toBe(epoch);
  });

  test('handles "YYYY/MM/DD" string', () => {
    const result = parseDateValue('2025/03/15');
    expect(result.getFullYear()).toBe(2025);
    expect(result.getMonth()).toBe(2); // 0-indexed
    expect(result.getDate()).toBe(15);
  });

  test('handles "YYYY/MM/DD HH:mm:ss" string', () => {
    const result = parseDateValue('2025/03/15 14:30:45');
    expect(result.getFullYear()).toBe(2025);
    expect(result.getHours()).toBe(14);
    expect(result.getMinutes()).toBe(30);
    expect(result.getSeconds()).toBe(45);
  });

  test('handles "YYYY-MM-DD" string', () => {
    const result = parseDateValue('2025-03-15');
    expect(result.getFullYear()).toBe(2025);
    expect(result.getMonth()).toBe(2);
    expect(result.getDate()).toBe(15);
  });

  test('handles "YYYY-MM-DDTHH:mm:ss" ISO-like string', () => {
    const result = parseDateValue('2025-03-15T10:20:30');
    expect(result.getFullYear()).toBe(2025);
    expect(result.getHours()).toBe(10);
    expect(result.getMinutes()).toBe(20);
  });

  test('handles "YYYY-MM-DD HH:mm" string (no seconds)', () => {
    const result = parseDateValue('2025-06-01 09:15');
    expect(result.getFullYear()).toBe(2025);
    expect(result.getMonth()).toBe(5);
    expect(result.getHours()).toBe(9);
    expect(result.getMinutes()).toBe(15);
    expect(result.getSeconds()).toBe(0);
  });

  test('handles whitespace-padded string', () => {
    const result = parseDateValue('  2025/01/01  ');
    expect(result.getFullYear()).toBe(2025);
  });

  test('returns null for non-string non-date non-number', () => {
    expect(parseDateValue({})).toBeNull();
    expect(parseDateValue([])).toBeNull();
    expect(parseDateValue(true)).toBeNull();
  });

  test('returns null for empty trimmed string', () => {
    expect(parseDateValue('   ')).toBeNull();
  });
});

describe('evaluator.js — isEventEnded', () => {
  test('returns true when status is ended', () => {
    expect(isEventEnded({ status: 'ended' }, new Date())).toBe(true);
  });

  test('returns false when status is open', () => {
    expect(isEventEnded({ status: 'open' }, new Date())).toBe(false);
  });

  test('returns false for null event', () => {
    expect(isEventEnded(null, new Date())).toBe(false);
  });

  test('returns false for no status', () => {
    expect(isEventEnded({}, new Date())).toBe(false);
  });
});

describe('evaluator.js — maxDate', () => {
  test('returns the later date', () => {
    const d1 = new Date(2025, 0, 1);
    const d2 = new Date(2025, 5, 1);
    expect(maxDate(d1, d2)).toBe(d2);
    expect(maxDate(d2, d1)).toBe(d2);
  });

  test('returns b when a is null', () => {
    const d = new Date(2025, 0, 1);
    expect(maxDate(null, d)).toBe(d);
  });

  test('returns a when b is null', () => {
    const d = new Date(2025, 0, 1);
    expect(maxDate(d, null)).toBe(d);
  });

  test('returns null when both are null', () => {
    expect(maxDate(null, null)).toBeNull();
  });

  test('returns a when dates are equal', () => {
    const d1 = new Date(2025, 0, 1);
    const d2 = new Date(2025, 0, 1);
    expect(maxDate(d1, d2)).toBe(d1);
  });

  test('handles undefined', () => {
    expect(maxDate(undefined, undefined)).toBeNull();
  });
});

describe('evaluator.js — formatCompletedDate', () => {
  test('formats date as YYYY/MM/DD', () => {
    expect(formatCompletedDate(new Date(2025, 0, 5))).toBe('2025/01/05');
    expect(formatCompletedDate(new Date(2025, 11, 25))).toBe('2025/12/25');
  });

  test('pads single-digit month and day', () => {
    expect(formatCompletedDate(new Date(2025, 2, 3))).toBe('2025/03/03');
  });

  test('uses current date when non-Date is passed', () => {
    const result = formatCompletedDate('not a date');
    // Should be today's date formatted
    const now = new Date();
    const expected = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;
    expect(result).toBe(expected);
  });
});

describe('evaluator.js — normalizeCurrentValue', () => {
  test('returns positive integer', () => {
    expect(normalizeCurrentValue(5)).toBe(5);
  });

  test('rounds to nearest integer', () => {
    expect(normalizeCurrentValue(3.7)).toBe(4);
    expect(normalizeCurrentValue(3.2)).toBe(3);
  });

  test('returns 0 for negative', () => {
    expect(normalizeCurrentValue(-5)).toBe(0);
  });

  test('returns 0 for zero', () => {
    expect(normalizeCurrentValue(0)).toBe(0);
  });

  test('returns 0 for non-finite', () => {
    expect(normalizeCurrentValue('abc')).toBe(0);
    expect(normalizeCurrentValue(NaN)).toBe(0);
    expect(normalizeCurrentValue(Infinity)).toBe(0);
  });

  test('parses string numbers', () => {
    expect(normalizeCurrentValue('7')).toBe(7);
  });

  test('returns 0 for null/undefined', () => {
    expect(normalizeCurrentValue(null)).toBe(0);
    expect(normalizeCurrentValue(undefined)).toBe(0);
  });
});

describe('evaluator.js — isSelfParticipantRecord', () => {
  test('returns true for matching uid', () => {
    expect(isSelfParticipantRecord({ uid: 'user1' }, 'user1')).toBe(true);
  });

  test('returns true for matching userId field', () => {
    expect(isSelfParticipantRecord({ userId: 'user1' }, 'user1')).toBe(true);
  });

  test('returns false for null record', () => {
    expect(isSelfParticipantRecord(null, 'user1')).toBe(false);
  });

  test('returns false for mismatched uid', () => {
    expect(isSelfParticipantRecord({ uid: 'user2' }, 'user1')).toBe(false);
  });

  test('returns false for companion records', () => {
    expect(isSelfParticipantRecord({ uid: 'user1', companionId: 'comp1' }, 'user1')).toBe(false);
    expect(isSelfParticipantRecord({ uid: 'user1', participantType: 'companion' }, 'user1')).toBe(false);
  });

  test('trims whitespace in uid comparison', () => {
    expect(isSelfParticipantRecord({ uid: '  user1  ' }, 'user1')).toBe(true);
  });

  test('returns false when record has no uid/userId', () => {
    expect(isSelfParticipantRecord({}, 'user1')).toBe(false);
  });
});

// ---- stats.js tests ----

describe('stats.js — getThreshold', () => {
  test('returns condition.threshold when present', () => {
    expect(getThreshold({ condition: { threshold: 10 } })).toBe(10);
  });

  test('returns target when no condition.threshold', () => {
    expect(getThreshold({ target: 5 })).toBe(5);
  });

  test('returns 1 as default', () => {
    expect(getThreshold({})).toBe(1);
  });

  test('handles null', () => {
    expect(getThreshold(null)).toBe(1);
  });

  test('prefers condition.threshold over target', () => {
    expect(getThreshold({ condition: { threshold: 3 }, target: 7 })).toBe(3);
  });

  test('threshold 0 is valid', () => {
    expect(getThreshold({ condition: { threshold: 0 } })).toBe(0);
  });
});

describe('stats.js — getActiveAchievements', () => {
  test('filters out archived achievements', () => {
    const achs = [
      { id: '1', status: 'active' },
      { id: '2', status: 'archived' },
      { id: '3' },
    ];
    const result = getActiveAchievements(achs);
    expect(result).toHaveLength(2);
    expect(result.map(a => a.id)).toEqual(['1', '3']);
  });

  test('returns empty for non-array', () => {
    expect(getActiveAchievements(null)).toEqual([]);
    expect(getActiveAchievements(undefined)).toEqual([]);
    expect(getActiveAchievements('not array')).toEqual([]);
  });

  test('filters out null/falsy entries', () => {
    const achs = [null, undefined, { id: '1' }, false, 0];
    const result = getActiveAchievements(achs);
    expect(result).toHaveLength(1);
  });

  test('empty array returns empty', () => {
    expect(getActiveAchievements([])).toEqual([]);
  });
});

describe('stats.js — isCompleted', () => {
  test('returns true when current >= threshold', () => {
    expect(isCompleted({ current: 5, condition: { threshold: 5 } })).toBe(true);
    expect(isCompleted({ current: 10, condition: { threshold: 5 } })).toBe(true);
  });

  test('returns false when current < threshold', () => {
    expect(isCompleted({ current: 3, condition: { threshold: 5 } })).toBe(false);
  });

  test('defaults current to 0', () => {
    expect(isCompleted({ condition: { threshold: 1 } })).toBe(false);
  });

  test('defaults threshold to 1', () => {
    expect(isCompleted({ current: 1 })).toBe(true);
    expect(isCompleted({ current: 0 })).toBe(false);
  });

  test('handles null', () => {
    expect(isCompleted(null)).toBe(false);
  });

  test('threshold 0 with safeThreshold clamped to 1 (non-reverse)', () => {
    // Without registry, safeThreshold = Math.max(1, 0) = 1
    // So current=0 is NOT completed (0 >= 1 = false)
    expect(isCompleted({ current: 0, condition: { threshold: 0 } })).toBe(false);
    // current=1 IS completed (1 >= 1 = true)
    expect(isCompleted({ current: 1, condition: { threshold: 0 } })).toBe(true);
  });
});

describe('stats.js — getCompletedAchievements', () => {
  test('returns only completed and active achievements', () => {
    const achs = [
      { id: '1', current: 5, condition: { threshold: 5 } },
      { id: '2', current: 2, condition: { threshold: 5 } },
      { id: '3', current: 10, condition: { threshold: 5 }, status: 'archived' },
    ];
    const result = getCompletedAchievements(achs);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });
});

describe('stats.js — getPendingAchievements', () => {
  test('returns only pending and active achievements', () => {
    const achs = [
      { id: '1', current: 5, condition: { threshold: 5 } },
      { id: '2', current: 2, condition: { threshold: 5 } },
      { id: '3', current: 0, condition: { threshold: 5 }, status: 'archived' },
    ];
    const result = getPendingAchievements(achs);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('2');
  });
});

describe('stats.js — splitAchievements', () => {
  test('splits into active, completed, and pending', () => {
    const achs = [
      { id: '1', current: 5, condition: { threshold: 5 } },
      { id: '2', current: 2, condition: { threshold: 5 } },
      { id: '3', status: 'archived', current: 5, condition: { threshold: 5 } },
    ];
    const result = splitAchievements(achs);
    expect(result.active).toHaveLength(2);
    expect(result.completed).toHaveLength(1);
    expect(result.pending).toHaveLength(1);
    expect(result.completed[0].id).toBe('1');
    expect(result.pending[0].id).toBe('2');
  });

  test('handles empty array', () => {
    const result = splitAchievements([]);
    expect(result.active).toEqual([]);
    expect(result.completed).toEqual([]);
    expect(result.pending).toEqual([]);
  });
});

describe('stats.js — getBadgeCount & getEarnedBadgeViewModels', () => {
  const achievements = [
    { id: 'ach1', name: 'First Win', current: 5, condition: { threshold: 5 }, category: 'gold' },
    { id: 'ach2', name: 'Runner', current: 2, condition: { threshold: 5 }, category: 'silver' },
    { id: 'ach3', name: 'Veteran', current: 10, condition: { threshold: 3 }, category: 'bronze' },
  ];
  const badges = [
    { achId: 'ach1', icon: 'star' },
    { achId: 'ach2', icon: 'run' },
    { achId: 'ach3', icon: 'shield' },
    { achId: 'ach_unknown', icon: 'mystery' },
  ];

  test('getBadgeCount counts only earned badges', () => {
    expect(getBadgeCount(achievements, badges)).toBe(2); // ach1 and ach3
  });

  test('getEarnedBadgeViewModels returns correct structure', () => {
    const result = getEarnedBadgeViewModels(achievements, badges);
    expect(result).toHaveLength(2);

    const goldBadge = result.find(vm => vm.achName === 'First Win');
    expect(goldBadge).toBeDefined();
    expect(goldBadge.category).toBe('gold');
    expect(goldBadge.color).toBe('#d4a017');
    expect(goldBadge.label).toBe('\u91d1');

    const bronzeBadge = result.find(vm => vm.achName === 'Veteran');
    expect(bronzeBadge).toBeDefined();
    expect(bronzeBadge.category).toBe('bronze');
  });

  test('empty badges returns empty', () => {
    expect(getEarnedBadgeViewModels(achievements, [])).toEqual([]);
  });

  test('empty achievements returns empty', () => {
    expect(getEarnedBadgeViewModels([], badges)).toEqual([]);
  });

  test('badge with no matching achievement is filtered out', () => {
    const result = getEarnedBadgeViewModels(achievements, [{ achId: 'nonexistent' }]);
    expect(result).toEqual([]);
  });

  test('uses badge category as fallback when achievement has none', () => {
    const achNoCat = [{ id: 'x', name: 'X', current: 1, condition: { threshold: 1 } }];
    const badgeWithCat = [{ achId: 'x', category: 'silver' }];
    const result = getEarnedBadgeViewModels(achNoCat, badgeWithCat);
    expect(result[0].category).toBe('silver');
  });

  test('defaults to bronze when neither achievement nor badge has category', () => {
    const achNoCat = [{ id: 'x', name: 'X', current: 1, condition: { threshold: 1 } }];
    const badgeNoCat = [{ achId: 'x' }];
    const result = getEarnedBadgeViewModels(achNoCat, badgeNoCat);
    expect(result[0].category).toBe('bronze');
  });
});

describe('stats.js — getTitleOptions', () => {
  test('separates gold and non-gold titles', () => {
    const achs = [
      { id: '1', name: 'Champion', current: 5, condition: { threshold: 5 }, category: 'gold' },
      { id: '2', name: 'Runner', current: 3, condition: { threshold: 3 }, category: 'silver' },
      { id: '3', name: 'Beginner', current: 1, condition: { threshold: 5 }, category: 'bronze' },
    ];
    const result = getTitleOptions(achs);
    expect(result.bigTitles).toEqual(['Champion']);
    expect(result.normalTitles).toEqual(['Runner']);
    expect(result.earned).toHaveLength(2);
  });

  test('empty when no completed', () => {
    const achs = [{ id: '1', current: 0, condition: { threshold: 5 } }];
    const result = getTitleOptions(achs);
    expect(result.bigTitles).toEqual([]);
    expect(result.normalTitles).toEqual([]);
    expect(result.earned).toEqual([]);
  });
});

// ---- stats.js — getParticipantAttendanceStats (CRITICAL) ----

describe('stats.js — getParticipantAttendanceStats', () => {
  const uid = 'user123';
  const now = new Date(2025, 5, 1);

  test('returns zero stats for empty inputs', () => {
    const result = getParticipantAttendanceStats({});
    expect(result.expectedCount).toBe(0);
    expect(result.attendedCount).toBe(0);
    expect(result.completedCount).toBe(0);
    expect(result.attendRate).toBe(0);
  });

  test('returns zero stats when called with no arguments', () => {
    const result = getParticipantAttendanceStats();
    expect(result.expectedCount).toBe(0);
    expect(result.attendRate).toBe(0);
  });

  test('returns zero stats for null registrations/attendance', () => {
    const result = getParticipantAttendanceStats({
      uid,
      registrations: null,
      attendanceRecords: null,
      eventMap: new Map(),
      now,
    });
    expect(result.expectedCount).toBe(0);
    expect(result.attendedCount).toBe(0);
  });

  test('counts expected events from registered + ended events', () => {
    const eventMap = new Map([
      ['e1', { status: 'ended' }],
      ['e2', { status: 'open' }],
      ['e3', { status: 'ended' }],
    ]);
    const registrations = [
      { uid, eventId: 'e1', status: 'registered' },
      { uid, eventId: 'e2', status: 'registered' },
      { uid, eventId: 'e3', status: 'registered' },
    ];
    const result = getParticipantAttendanceStats({
      uid,
      registrations,
      attendanceRecords: [],
      eventMap,
      now,
      isEventEnded: (event) => event.status === 'ended',
    });
    expect(result.expectedCount).toBe(2); // e1 and e3
    expect(result.attendedCount).toBe(0);
    expect(result.attendRate).toBe(0);
  });

  test('excludes cancelled registrations', () => {
    const eventMap = new Map([
      ['e1', { status: 'ended' }],
    ]);
    const registrations = [
      { uid, eventId: 'e1', status: 'cancelled' },
    ];
    const result = getParticipantAttendanceStats({
      uid,
      registrations,
      attendanceRecords: [],
      eventMap,
      now,
      isEventEnded: (event) => event.status === 'ended',
    });
    expect(result.expectedCount).toBe(0);
  });

  test('excludes registrations for events not in eventMap', () => {
    const eventMap = new Map(); // empty
    const registrations = [
      { uid, eventId: 'e1', status: 'registered' },
    ];
    const result = getParticipantAttendanceStats({
      uid,
      registrations,
      attendanceRecords: [],
      eventMap,
      now,
    });
    expect(result.expectedCount).toBe(0);
  });

  test('counts attended events (checkin only)', () => {
    const eventMap = new Map([
      ['e1', { status: 'ended' }],
      ['e2', { status: 'ended' }],
    ]);
    const registrations = [
      { uid, eventId: 'e1', status: 'registered' },
      { uid, eventId: 'e2', status: 'registered' },
    ];
    const attendanceRecords = [
      { uid, eventId: 'e1', type: 'checkin' },
    ];
    const result = getParticipantAttendanceStats({
      uid,
      registrations,
      attendanceRecords,
      eventMap,
      now,
      isEventEnded: (event) => event.status === 'ended',
    });
    expect(result.expectedCount).toBe(2);
    expect(result.attendedCount).toBe(1);
    expect(result.completedCount).toBe(0); // no checkout
    expect(result.attendRate).toBe(50);
  });

  test('counts completed events (checkin + checkout)', () => {
    const eventMap = new Map([
      ['e1', { status: 'ended' }],
    ]);
    const registrations = [
      { uid, eventId: 'e1', status: 'registered' },
    ];
    const attendanceRecords = [
      { uid, eventId: 'e1', type: 'checkin' },
      { uid, eventId: 'e1', type: 'checkout' },
    ];
    const result = getParticipantAttendanceStats({
      uid,
      registrations,
      attendanceRecords,
      eventMap,
      now,
      isEventEnded: (event) => event.status === 'ended',
    });
    expect(result.expectedCount).toBe(1);
    expect(result.attendedCount).toBe(1);
    expect(result.completedCount).toBe(1);
    expect(result.attendRate).toBe(100);
  });

  test('excludes companion attendance records', () => {
    const eventMap = new Map([
      ['e1', { status: 'ended' }],
    ]);
    const registrations = [
      { uid, eventId: 'e1', status: 'registered' },
    ];
    const attendanceRecords = [
      { uid, eventId: 'e1', type: 'checkin', companionId: 'comp1' },
    ];
    const result = getParticipantAttendanceStats({
      uid,
      registrations,
      attendanceRecords,
      eventMap,
      now,
      isEventEnded: (event) => event.status === 'ended',
    });
    expect(result.attendedCount).toBe(0);
  });

  test('excludes participantType=companion attendance records', () => {
    const eventMap = new Map([
      ['e1', { status: 'ended' }],
    ]);
    const registrations = [
      { uid, eventId: 'e1', status: 'registered' },
    ];
    const attendanceRecords = [
      { uid, eventId: 'e1', type: 'checkin', participantType: 'companion' },
    ];
    const result = getParticipantAttendanceStats({
      uid,
      registrations,
      attendanceRecords,
      eventMap,
      now,
      isEventEnded: (event) => event.status === 'ended',
    });
    expect(result.attendedCount).toBe(0);
  });

  test('ignores attendance for non-expected events', () => {
    const eventMap = new Map([
      ['e1', { status: 'ended' }],
    ]);
    const registrations = [
      { uid, eventId: 'e1', status: 'registered' },
    ];
    const attendanceRecords = [
      { uid, eventId: 'e999', type: 'checkin' }, // not in expected
    ];
    const result = getParticipantAttendanceStats({
      uid,
      registrations,
      attendanceRecords,
      eventMap,
      now,
      isEventEnded: (event) => event.status === 'ended',
    });
    expect(result.attendedCount).toBe(0);
  });

  test('attendance records with wrong uid are excluded', () => {
    const eventMap = new Map([
      ['e1', { status: 'ended' }],
    ]);
    const registrations = [
      { uid, eventId: 'e1', status: 'registered' },
    ];
    const attendanceRecords = [
      { uid: 'other_user', eventId: 'e1', type: 'checkin' },
    ];
    const result = getParticipantAttendanceStats({
      uid,
      registrations,
      attendanceRecords,
      eventMap,
      now,
      isEventEnded: (event) => event.status === 'ended',
    });
    expect(result.attendedCount).toBe(0);
  });

  test('handles registration with userId field instead of uid', () => {
    const eventMap = new Map([
      ['e1', { status: 'ended' }],
    ]);
    const registrations = [
      { userId: uid, eventId: 'e1', status: 'registered' },
    ];
    const result = getParticipantAttendanceStats({
      uid,
      registrations,
      attendanceRecords: [],
      eventMap,
      now,
      isEventEnded: (event) => event.status === 'ended',
    });
    expect(result.expectedCount).toBe(1);
  });

  test('filters registrations with mismatched uid', () => {
    const eventMap = new Map([
      ['e1', { status: 'ended' }],
    ]);
    const registrations = [
      { uid: 'other_user', eventId: 'e1', status: 'registered' },
    ];
    const result = getParticipantAttendanceStats({
      uid,
      registrations,
      attendanceRecords: [],
      eventMap,
      now,
      isEventEnded: (event) => event.status === 'ended',
    });
    expect(result.expectedCount).toBe(0);
  });

  test('uses status fallback when no isEventEnded function', () => {
    const eventMap = new Map([
      ['e1', { status: 'ended' }],
      ['e2', { status: 'open' }],
    ]);
    const registrations = [
      { uid, eventId: 'e1', status: 'registered' },
      { uid, eventId: 'e2', status: 'registered' },
    ];
    // No isEventEnded function provided
    const result = getParticipantAttendanceStats({
      uid,
      registrations,
      attendanceRecords: [],
      eventMap,
      now,
    });
    expect(result.expectedCount).toBe(1); // only e1 is ended
  });

  test('full scenario: mix of ended/open events with attendance', () => {
    const eventMap = new Map([
      ['e1', { status: 'ended' }],
      ['e2', { status: 'ended' }],
      ['e3', { status: 'ended' }],
      ['e4', { status: 'open' }],
    ]);
    const registrations = [
      { uid, eventId: 'e1', status: 'registered' },
      { uid, eventId: 'e2', status: 'registered' },
      { uid, eventId: 'e3', status: 'registered' },
      { uid, eventId: 'e4', status: 'registered' },
    ];
    const attendanceRecords = [
      { uid, eventId: 'e1', type: 'checkin' },
      { uid, eventId: 'e1', type: 'checkout' },
      { uid, eventId: 'e2', type: 'checkin' },
      // e3: no attendance (no-show)
    ];
    const result = getParticipantAttendanceStats({
      uid,
      registrations,
      attendanceRecords,
      eventMap,
      now,
      isEventEnded: (event) => event.status === 'ended',
    });
    expect(result.expectedCount).toBe(3);
    expect(result.attendedCount).toBe(2);
    expect(result.completedCount).toBe(1);
    expect(result.attendRate).toBe(67); // Math.round(2/3 * 100)
  });

  test('handles null entries in registrations array', () => {
    const eventMap = new Map([
      ['e1', { status: 'ended' }],
    ]);
    const registrations = [null, undefined, { uid, eventId: 'e1', status: 'registered' }];
    const result = getParticipantAttendanceStats({
      uid,
      registrations,
      attendanceRecords: [],
      eventMap,
      now,
      isEventEnded: (event) => event.status === 'ended',
    });
    expect(result.expectedCount).toBe(1);
  });

  test('handles null entries in attendanceRecords array', () => {
    const eventMap = new Map([
      ['e1', { status: 'ended' }],
    ]);
    const registrations = [{ uid, eventId: 'e1', status: 'registered' }];
    const attendanceRecords = [null, undefined, { uid, eventId: 'e1', type: 'checkin' }];
    const result = getParticipantAttendanceStats({
      uid,
      registrations,
      attendanceRecords,
      eventMap,
      now,
      isEventEnded: (event) => event.status === 'ended',
    });
    expect(result.attendedCount).toBe(1);
  });

  test('ignores attendance records with invalid type', () => {
    const eventMap = new Map([
      ['e1', { status: 'ended' }],
    ]);
    const registrations = [{ uid, eventId: 'e1', status: 'registered' }];
    const attendanceRecords = [
      { uid, eventId: 'e1', type: 'invalid_type' },
    ];
    const result = getParticipantAttendanceStats({
      uid,
      registrations,
      attendanceRecords,
      eventMap,
      now,
      isEventEnded: (event) => event.status === 'ended',
    });
    expect(result.attendedCount).toBe(0);
  });

  test('returns Set objects for event ID collections', () => {
    const result = getParticipantAttendanceStats({});
    expect(result.expectedEventIds).toBeInstanceOf(Set);
    expect(result.attendedEventIds).toBeInstanceOf(Set);
    expect(result.completedEventIds).toBeInstanceOf(Set);
  });

  test('100% attendance rate', () => {
    const eventMap = new Map([
      ['e1', { status: 'ended' }],
      ['e2', { status: 'ended' }],
    ]);
    const registrations = [
      { uid, eventId: 'e1', status: 'registered' },
      { uid, eventId: 'e2', status: 'registered' },
    ];
    const attendanceRecords = [
      { uid, eventId: 'e1', type: 'checkin' },
      { uid, eventId: 'e2', type: 'checkin' },
    ];
    const result = getParticipantAttendanceStats({
      uid,
      registrations,
      attendanceRecords,
      eventMap,
      now,
      isEventEnded: (event) => event.status === 'ended',
    });
    expect(result.attendRate).toBe(100);
  });

  test('registration with empty eventId is skipped', () => {
    const eventMap = new Map([
      ['', { status: 'ended' }],
    ]);
    const registrations = [
      { uid, eventId: '', status: 'registered' },
    ];
    const result = getParticipantAttendanceStats({
      uid,
      registrations,
      attendanceRecords: [],
      eventMap,
      now,
      isEventEnded: () => true,
    });
    expect(result.expectedCount).toBe(0);
  });

  test('checkout only (no checkin) does not count as attended or completed', () => {
    const eventMap = new Map([
      ['e1', { status: 'ended' }],
    ]);
    const registrations = [
      { uid, eventId: 'e1', status: 'registered' },
    ];
    const attendanceRecords = [
      { uid, eventId: 'e1', type: 'checkout' },
    ];
    const result = getParticipantAttendanceStats({
      uid,
      registrations,
      attendanceRecords,
      eventMap,
      now,
      isEventEnded: (event) => event.status === 'ended',
    });
    expect(result.attendedCount).toBe(0);
    expect(result.completedCount).toBe(0);
  });

  test('registration with no uid uses safeUid and matches', () => {
    const eventMap = new Map([
      ['e1', { status: 'ended' }],
    ]);
    // Registration has no uid/userId - falls back to safeUid
    const registrations = [
      { eventId: 'e1', status: 'registered' },
    ];
    const result = getParticipantAttendanceStats({
      uid,
      registrations,
      attendanceRecords: [],
      eventMap,
      now,
      isEventEnded: (event) => event.status === 'ended',
    });
    // recordUid defaults to safeUid when record has no uid/userId, so it matches
    expect(result.expectedCount).toBe(1);
  });
});
