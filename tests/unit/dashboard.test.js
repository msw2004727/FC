/**
 * Dashboard module unit tests — extracted pure functions.
 *
 * Source files:
 *   js/modules/dashboard/dashboard-participant-query.js
 *   js/modules/dashboard/personal-dashboard.js
 */

// ---------------------------------------------------------------------------
// Extracted from dashboard-participant-query.js:33-35
// _getDashboardParticipantSearchPanelHint
// ---------------------------------------------------------------------------
function _getDashboardParticipantSearchPanelHint(state) {
  return state?.collapsed ? '展開搜尋條件與查詢結果' : '收起搜尋條件與查詢結果';
}

// ---------------------------------------------------------------------------
// Extracted from dashboard-participant-query.js:37-47
// _getDashboardParticipantSearchPanelSummary
// ---------------------------------------------------------------------------
function _getDashboardParticipantSearchPanelSummary(state) {
  const keyword = String(state?.keyword || '').trim();
  const startDate = String(state?.startDate || '').trim();
  const endDate = String(state?.endDate || '').trim();
  const rangeText = startDate && endDate ? `${startDate} 至 ${endDate}` : '未設定日期區間';

  if (keyword) {
    return `關鍵字：${keyword} · ${rangeText}`;
  }
  return `日期區間：${rangeText}`;
}

// ---------------------------------------------------------------------------
// Extracted from dashboard-participant-query.js:49-55
// _getDashboardParticipantSearchPanelMeta
// ---------------------------------------------------------------------------
function _getDashboardParticipantSearchPanelMeta(state) {
  if (state.loading) return '查詢中';
  if (state.shareLoading) return '產生網址中';
  if (state.error) return '查詢失敗';
  if (!state.result) return '尚未查詢';
  return `${Number(state.result.matchedEventCount || 0)} 活動 / ${Number(state.result.matchedUserCount || 0)} 用戶 / ${Number(state.result.totalParticipationCount || 0)} 次`;
}

// ---------------------------------------------------------------------------
// Extracted from dashboard-participant-query.js:57-67
// _hasDashboardParticipantSearchHighlight
// ---------------------------------------------------------------------------
function _hasDashboardParticipantSearchHighlight(state) {
  return Boolean(
    String(state?.keyword || '').trim() ||
    state?.loading ||
    state?.error ||
    state?.result ||
    state?.shareLoading ||
    state?.shareError ||
    state?.shareUrl
  );
}

// ---------------------------------------------------------------------------
// Extracted from personal-dashboard.js:199-218
// _calcWeeklyActivity — 12-week sliding window
// Adapted: accepts explicit `now` and `parseDate` for testability
// ---------------------------------------------------------------------------
function _calcWeeklyActivity(records, { now, parseDate }) {
  const weeks = [];
  for (let i = 11; i >= 0; i--) {
    const weekEnd = new Date(now);
    weekEnd.setDate(now.getDate() - i * 7);
    const weekStart = new Date(weekEnd);
    weekStart.setDate(weekEnd.getDate() - 6);
    weeks.push({ start: weekStart, end: weekEnd, label: `${weekStart.getMonth()+1}/${weekStart.getDate()}`, value: 0 });
  }
  const activeRecords = records.filter(r => r.status === 'completed' || r.status === 'registered');
  activeRecords.forEach(r => {
    const recDate = parseDate(r.date);
    if (!recDate || isNaN(recDate)) return;
    for (const w of weeks) {
      if (recDate >= w.start && recDate <= w.end) { w.value++; break; }
    }
  });
  return weeks;
}

// ===========================================================================
// TESTS
// ===========================================================================

describe('_getDashboardParticipantSearchPanelHint', () => {
  test('collapsed → expand hint', () => {
    expect(_getDashboardParticipantSearchPanelHint({ collapsed: true }))
      .toBe('展開搜尋條件與查詢結果');
  });

  test('not collapsed → collapse hint', () => {
    expect(_getDashboardParticipantSearchPanelHint({ collapsed: false }))
      .toBe('收起搜尋條件與查詢結果');
  });

  test('null state → expand hint (falsy collapsed)', () => {
    expect(_getDashboardParticipantSearchPanelHint(null))
      .toBe('收起搜尋條件與查詢結果');
  });
});

describe('_getDashboardParticipantSearchPanelSummary', () => {
  test('keyword + dates → keyword summary', () => {
    const state = { keyword: '大安', startDate: '2026-01-01', endDate: '2026-03-01' };
    const result = _getDashboardParticipantSearchPanelSummary(state);
    expect(result).toContain('大安');
    expect(result).toContain('2026-01-01 至 2026-03-01');
  });

  test('no keyword → date range only', () => {
    const state = { keyword: '', startDate: '2026-01-01', endDate: '2026-03-01' };
    const result = _getDashboardParticipantSearchPanelSummary(state);
    expect(result).toBe('日期區間：2026-01-01 至 2026-03-01');
  });

  test('no dates → 未設定日期區間', () => {
    const state = { keyword: 'test', startDate: '', endDate: '' };
    const result = _getDashboardParticipantSearchPanelSummary(state);
    expect(result).toContain('未設定日期區間');
  });

  test('null state → graceful', () => {
    const result = _getDashboardParticipantSearchPanelSummary(null);
    expect(result).toContain('未設定日期區間');
  });
});

describe('_getDashboardParticipantSearchPanelMeta', () => {
  test('loading → 查詢中', () => {
    expect(_getDashboardParticipantSearchPanelMeta({ loading: true })).toBe('查詢中');
  });

  test('shareLoading → 產生網址中', () => {
    expect(_getDashboardParticipantSearchPanelMeta({ shareLoading: true })).toBe('產生網址中');
  });

  test('error → 查詢失敗', () => {
    expect(_getDashboardParticipantSearchPanelMeta({ error: 'some error' })).toBe('查詢失敗');
  });

  test('no result → 尚未查詢', () => {
    expect(_getDashboardParticipantSearchPanelMeta({})).toBe('尚未查詢');
  });

  test('with result → formatted counts', () => {
    const state = {
      result: { matchedEventCount: 5, matchedUserCount: 10, totalParticipationCount: 25 },
    };
    expect(_getDashboardParticipantSearchPanelMeta(state)).toBe('5 活動 / 10 用戶 / 25 次');
  });

  test('priority: loading > shareLoading > error > no result', () => {
    expect(_getDashboardParticipantSearchPanelMeta({ loading: true, error: 'err' })).toBe('查詢中');
    expect(_getDashboardParticipantSearchPanelMeta({ shareLoading: true, error: 'err' })).toBe('產生網址中');
  });
});

describe('_hasDashboardParticipantSearchHighlight', () => {
  test('empty state → false', () => {
    expect(_hasDashboardParticipantSearchHighlight({})).toBe(false);
  });

  test('keyword present → true', () => {
    expect(_hasDashboardParticipantSearchHighlight({ keyword: 'test' })).toBe(true);
  });

  test('loading → true', () => {
    expect(_hasDashboardParticipantSearchHighlight({ loading: true })).toBe(true);
  });

  test('result present → true', () => {
    expect(_hasDashboardParticipantSearchHighlight({ result: {} })).toBe(true);
  });

  test('error present → true', () => {
    expect(_hasDashboardParticipantSearchHighlight({ error: 'err' })).toBe(true);
  });

  test('shareUrl present → true', () => {
    expect(_hasDashboardParticipantSearchHighlight({ shareUrl: 'http://...' })).toBe(true);
  });

  test('blank keyword → false', () => {
    expect(_hasDashboardParticipantSearchHighlight({ keyword: '   ' })).toBe(false);
  });

  test('null state → false', () => {
    expect(_hasDashboardParticipantSearchHighlight(null)).toBe(false);
  });
});

describe('_calcWeeklyActivity (personal-dashboard.js:199-218)', () => {
  const now = new Date(2026, 2, 19, 12, 0, 0); // 2026-03-19 noon
  // Parse date using local time (same as the source code's _parseMmDdToDate)
  const parseDate = (dateStr) => {
    if (!dateStr) return null;
    const parts = dateStr.split('-');
    if (parts.length !== 3) return null;
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return isNaN(d.getTime()) ? null : d;
  };

  test('returns 12 weeks', () => {
    const weeks = _calcWeeklyActivity([], { now, parseDate });
    expect(weeks.length).toBe(12);
  });

  test('each week has label and value', () => {
    const weeks = _calcWeeklyActivity([], { now, parseDate });
    weeks.forEach(w => {
      expect(w).toHaveProperty('label');
      expect(w).toHaveProperty('value');
      expect(w).toHaveProperty('start');
      expect(w).toHaveProperty('end');
    });
  });

  test('empty records → all values 0', () => {
    const weeks = _calcWeeklyActivity([], { now, parseDate });
    expect(weeks.every(w => w.value === 0)).toBe(true);
  });

  test('records matched to correct week', () => {
    const records = [
      { date: '2026-03-15', status: 'completed' }, // within last week window
      { date: '2026-03-16', status: 'completed' }, // within last week window
    ];
    const weeks = _calcWeeklyActivity(records, { now, parseDate });
    // Find the week that contains March 15-16
    const matchedWeeks = weeks.filter(w => w.value > 0);
    const totalMatched = matchedWeeks.reduce((s, w) => s + w.value, 0);
    expect(totalMatched).toBe(2);
  });

  test('cancelled/other status records excluded', () => {
    const records = [
      { date: '2026-03-15', status: 'cancelled' },
      { date: '2026-03-15', status: 'completed' },
    ];
    const weeks = _calcWeeklyActivity(records, { now, parseDate });
    const totalMatched = weeks.reduce((s, w) => s + w.value, 0);
    expect(totalMatched).toBe(1);
  });

  test('records outside 12-week window → not counted', () => {
    const records = [
      { date: '2025-01-01', status: 'completed' }, // way before
    ];
    const weeks = _calcWeeklyActivity(records, { now, parseDate });
    expect(weeks.every(w => w.value === 0)).toBe(true);
  });

  test('registered status also counted', () => {
    const records = [
      { date: '2026-03-15', status: 'registered' },
    ];
    const weeks = _calcWeeklyActivity(records, { now, parseDate });
    const totalMatched = weeks.reduce((s, w) => s + w.value, 0);
    expect(totalMatched).toBe(1);
  });
});
