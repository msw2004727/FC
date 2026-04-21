/**
 * Dashboard Drilldown — unit tests
 *
 * Extracted from:
 *   - js/modules/dashboard/dashboard-snapshot.js (filterByTime, toMillis)
 *   - js/modules/dashboard/dashboard-drilldown-users.js (身分/性別/年齡分布計算)
 *   - js/modules/dashboard/dashboard-drilldown-attend.js (出席率 / 全勤門檻)
 *   - js/modules/dashboard/dashboard-data-fetcher.js (_dashCutoffMillis)
 *
 * 重點驗證：
 *   - monthsRange filter 正確（1/3/6/12）
 *   - 邊界 case（空陣列、null、Firestore Timestamp、字串日期）
 *   - 「全勤用戶最少 3 場」「放鴿子活動最少 3 人」small sample 防呆
 */

// ─── 從 dashboard-data-fetcher.js 抽取 ───
function _dashCutoffMillis(monthsRange) {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsRange);
  return d.getTime();
}

// ─── 從 dashboard-snapshot.js 抽取 ───
function toMillis(v) {
  if (!v) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v.seconds) return v.seconds * 1000;
  if (typeof v === 'string') {
    const t = new Date(v.replace(/\//g, '-')).getTime();
    return isNaN(t) ? 0 : t;
  }
  const t = new Date(v).getTime();
  return isNaN(t) ? 0 : t;
}

function filterByTime(arr, cutoff, ...fields) {
  return arr.filter(item => {
    for (const f of fields) {
      const ms = toMillis(item[f]);
      if (ms > 0 && ms >= cutoff) return true;
    }
    // 所有欄位都無效 → 保留（admin 寧可多不可少）
    return fields.every(f => !item[f]);
  });
}

// ─── 從 dashboard-drilldown-users.js 抽取（年齡分布）───
function buildAgeGroups(users, thisYear) {
  const groups = { '<20': 0, '20-30': 0, '31-40': 0, '41-50': 0, '51+': 0, '未填': 0 };
  users.forEach(u => {
    if (!u.birthday) { groups['未填']++; return; }
    const y = parseInt(String(u.birthday).slice(0, 4));
    if (isNaN(y) || y < 1900 || y > thisYear) { groups['未填']++; return; }
    const age = thisYear - y;
    if (age < 20) groups['<20']++;
    else if (age <= 30) groups['20-30']++;
    else if (age <= 40) groups['31-40']++;
    else if (age <= 50) groups['41-50']++;
    else groups['51+']++;
  });
  return groups;
}

// ─── 從 dashboard-drilldown-attend.js 抽取（全勤門檻）───
function buildPerfectUsers(completedRegs, checkinSet, minAttend = 3) {
  const userAttend = {};
  completedRegs.forEach(r => {
    const uid = r.userId;
    if (!uid) return;
    if (!userAttend[uid]) userAttend[uid] = { attend: 0, total: 0 };
    userAttend[uid].total++;
    if (checkinSet.has(`${uid}::${r.eventId}`)) userAttend[uid].attend++;
  });
  return Object.entries(userAttend)
    .filter(([, v]) => v.total >= minAttend && v.attend === v.total)
    .map(([uid, v]) => ({ uid, count: v.total }))
    .sort((a, b) => b.count - a.count);
}

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════

describe('Dashboard Drilldown — Time Filter', () => {
  test('_dashCutoffMillis 回傳正確月數前的時間戳', () => {
    const now = Date.now();
    const cutoff1 = _dashCutoffMillis(1);
    const cutoff6 = _dashCutoffMillis(6);
    // 1 個月前應該小於 now，但大於 45 天前
    const oneMonthAgoApprox = now - 31 * 24 * 3600 * 1000;
    const fortyFiveDaysAgo = now - 45 * 24 * 3600 * 1000;
    expect(cutoff1).toBeLessThan(now);
    expect(cutoff1).toBeGreaterThan(fortyFiveDaysAgo);
    // 6 個月 < 1 個月
    expect(cutoff6).toBeLessThan(cutoff1);
  });

  test('toMillis 處理 Firestore Timestamp 物件', () => {
    const fakeTimestamp = { toMillis: () => 1712345678000 };
    expect(toMillis(fakeTimestamp)).toBe(1712345678000);
  });

  test('toMillis 處理 {seconds, nanoseconds} 物件', () => {
    expect(toMillis({ seconds: 1712345678, nanoseconds: 0 })).toBe(1712345678000);
  });

  test('toMillis 處理 "2026/04/20" 字串（斜線）', () => {
    const ms = toMillis('2026/04/20');
    expect(ms).toBeGreaterThan(0);
    expect(new Date(ms).getFullYear()).toBe(2026);
  });

  test('toMillis 處理 "2026-04-20" 字串（連字號）', () => {
    const ms = toMillis('2026-04-20');
    expect(ms).toBeGreaterThan(0);
  });

  test('toMillis 空值 / 無效字串 回傳 0', () => {
    expect(toMillis(null)).toBe(0);
    expect(toMillis(undefined)).toBe(0);
    expect(toMillis('')).toBe(0);
    expect(toMillis('not-a-date')).toBe(0);
  });

  test('filterByTime: cutoff 內的 registrations 保留', () => {
    const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
    const recent = { registeredAt: new Date().toISOString() };
    const old = { registeredAt: '2020-01-01' };
    const items = [recent, old];
    const result = filterByTime(items, cutoff, 'registeredAt');
    expect(result).toContain(recent);
    expect(result).not.toContain(old);
  });

  test('filterByTime: 所有欄位皆無效時保留（admin 寧可多不可少）', () => {
    const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
    const itemNoTime = { title: 'no time field' };
    const result = filterByTime([itemNoTime], cutoff, 'registeredAt', 'createdAt');
    expect(result).toContain(itemNoTime);
  });

  test('filterByTime: 有 fallback 欄位時取第一個有效', () => {
    const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
    const recent = { registeredAt: null, createdAt: new Date().toISOString() };
    const old = { registeredAt: null, createdAt: '2020-01-01' };
    const result = filterByTime([recent, old], cutoff, 'registeredAt', 'createdAt');
    expect(result).toContain(recent);
    expect(result).not.toContain(old);
  });
});

describe('Dashboard Drilldown — Users 年齡分布', () => {
  test('正常 birthday 歸類正確', () => {
    const thisYear = 2026;
    const users = [
      { birthday: '2020-01-01' }, // 6 歲 → <20
      { birthday: '2000-01-01' }, // 26 歲 → 20-30
      { birthday: '1990-01-01' }, // 36 歲 → 31-40
      { birthday: '1980-01-01' }, // 46 歲 → 41-50
      { birthday: '1970-01-01' }, // 56 歲 → 51+
    ];
    const groups = buildAgeGroups(users, thisYear);
    expect(groups['<20']).toBe(1);
    expect(groups['20-30']).toBe(1);
    expect(groups['31-40']).toBe(1);
    expect(groups['41-50']).toBe(1);
    expect(groups['51+']).toBe(1);
    expect(groups['未填']).toBe(0);
  });

  test('無 birthday → 歸類「未填」', () => {
    const users = [{ birthday: null }, { birthday: '' }, { /* 無此欄位 */ }];
    const groups = buildAgeGroups(users, 2026);
    expect(groups['未填']).toBe(3);
  });

  test('異常 birthday（parse 失敗 / 未來年份 / 1800 年）→ 歸類「未填」', () => {
    const users = [
      { birthday: 'abc' },
      { birthday: '9999-12-31' }, // 未來
      { birthday: '1800-01-01' }, // 太遠古
    ];
    const groups = buildAgeGroups(users, 2026);
    expect(groups['未填']).toBe(3);
  });

  test('邊界：20 歲歸 20-30 組', () => {
    const groups = buildAgeGroups([{ birthday: '2006-01-01' }], 2026);
    expect(groups['20-30']).toBe(1);
    expect(groups['<20']).toBe(0);
  });

  test('邊界：51 歲歸 51+ 組', () => {
    const groups = buildAgeGroups([{ birthday: '1975-01-01' }], 2026);
    expect(groups['51+']).toBe(1);
  });
});

describe('Dashboard Drilldown — 出席率全勤門檻', () => {
  const makeReg = (userId, eventId) => ({ userId, eventId, status: 'confirmed' });

  test('全勤用戶 = 至少 3 場 100% 簽到', () => {
    const regs = [
      makeReg('A', 'e1'), makeReg('A', 'e2'), makeReg('A', 'e3'), // A 三場
      makeReg('B', 'e1'), makeReg('B', 'e2'), // B 兩場（樣本太少）
    ];
    const checkinSet = new Set(['A::e1', 'A::e2', 'A::e3', 'B::e1', 'B::e2']);
    const perfect = buildPerfectUsers(regs, checkinSet);
    expect(perfect.map(p => p.uid)).toEqual(['A']);
    expect(perfect.map(p => p.uid)).not.toContain('B');
  });

  test('A 缺席一場 → 不算全勤', () => {
    const regs = [
      makeReg('A', 'e1'), makeReg('A', 'e2'), makeReg('A', 'e3'),
    ];
    const checkinSet = new Set(['A::e1', 'A::e2']); // 缺 e3
    const perfect = buildPerfectUsers(regs, checkinSet);
    expect(perfect).toEqual([]);
  });

  test('無報名 → 空清單', () => {
    expect(buildPerfectUsers([], new Set())).toEqual([]);
  });

  test('門檻可調整（minAttend=5）', () => {
    const regs = [
      makeReg('A', 'e1'), makeReg('A', 'e2'), makeReg('A', 'e3'), // 3 場
    ];
    const checkinSet = new Set(['A::e1', 'A::e2', 'A::e3']);
    expect(buildPerfectUsers(regs, checkinSet, 5)).toEqual([]);
    expect(buildPerfectUsers(regs, checkinSet, 3).map(p => p.uid)).toEqual(['A']);
  });

  test('多用戶全勤依場次數量排序', () => {
    const regs = [
      makeReg('A', 'e1'), makeReg('A', 'e2'), makeReg('A', 'e3'), // 3 場
      makeReg('B', 'e1'), makeReg('B', 'e2'), makeReg('B', 'e3'), makeReg('B', 'e4'), // 4 場
    ];
    const checkinSet = new Set(['A::e1', 'A::e2', 'A::e3', 'B::e1', 'B::e2', 'B::e3', 'B::e4']);
    const perfect = buildPerfectUsers(regs, checkinSet);
    expect(perfect[0].uid).toBe('B');
    expect(perfect[1].uid).toBe('A');
  });
});
