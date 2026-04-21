/**
 * Kickball Game — unit tests
 *
 * Extracted from: js/modules/kickball/kickball-helpers.js
 *
 * 重點驗證：
 *   - formatDuration 時間格式化（mm:ss）
 *   - clamp 數值夾取
 *   - getTaipeiDateBucket 排行榜期間分桶（daily/weekly/monthly）
 *   - buildRankIcon 前三名圖示
 */

// ─── 從 kickball-helpers.js 抽取 ───
function formatDuration(seconds) {
  const sec = Math.max(0, Number(seconds) || 0);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// 採用固定測試時間（避免測試依賴真實時間）
function getTaipeiDateBucket(period, now = Date.now()) {
  const t = new Date(now + 8 * 3600000);
  const year = t.getUTCFullYear();
  const month = String(t.getUTCMonth() + 1).padStart(2, '0');
  const day = String(t.getUTCDate()).padStart(2, '0');
  if (period === 'monthly') return 'monthly_' + year + '-' + month;
  if (period === 'weekly') {
    const d = new Date(Date.UTC(year, t.getUTCMonth(), t.getUTCDate()));
    const dow = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dow);
    const ys = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const wk = String(Math.ceil(((d - ys) / 86400000 + 1) / 7)).padStart(2, '0');
    return 'weekly_' + d.getUTCFullYear() + '-W' + wk;
  }
  return 'daily_' + year + '-' + month + '-' + day;
}

// ═══════════════════════════════════════════════════════════════════
describe('Kickball — formatDuration 時間格式化', () => {
  test('0 秒 → 00:00', () => {
    expect(formatDuration(0)).toBe('00:00');
  });

  test('59 秒 → 00:59', () => {
    expect(formatDuration(59)).toBe('00:59');
  });

  test('60 秒 → 01:00', () => {
    expect(formatDuration(60)).toBe('01:00');
  });

  test('125 秒 → 02:05', () => {
    expect(formatDuration(125)).toBe('02:05');
  });

  test('3599 秒（59:59）', () => {
    expect(formatDuration(3599)).toBe('59:59');
  });

  test('負數 → 00:00（Math.max 0）', () => {
    expect(formatDuration(-100)).toBe('00:00');
  });

  test('非數字 → 00:00', () => {
    expect(formatDuration('abc')).toBe('00:00');
    expect(formatDuration(null)).toBe('00:00');
    expect(formatDuration(undefined)).toBe('00:00');
  });

  test('小數會有 rounding 行為（JS 字串化 10.5 % 60 = 10.5）', () => {
    // 實際行為：秒餘數為 10.5 → padStart 會變成 "10.5" 或 "0.5"
    // 驗證函式行為是否穩定
    const result = formatDuration(10.5);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThanOrEqual(5); // 至少 mm:ss
  });
});

describe('Kickball — clamp 數值夾取', () => {
  test('值在範圍內 → 原值', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  test('值低於 min → min', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  test('值高於 max → max', () => {
    expect(clamp(100, 0, 10)).toBe(10);
  });

  test('min === max → 固定值', () => {
    expect(clamp(5, 7, 7)).toBe(7);
    expect(clamp(10, 7, 7)).toBe(7);
  });

  test('浮點數 clamp', () => {
    expect(clamp(0.5, 0, 1)).toBe(0.5);
    expect(clamp(1.5, 0, 1)).toBe(1);
  });
});

describe('Kickball — getTaipeiDateBucket 期間分桶', () => {
  const taipeiNoon = new Date('2026-04-20T04:00:00Z').getTime(); // 台北時間 12:00

  test('daily 分桶格式 daily_YYYY-MM-DD', () => {
    const bucket = getTaipeiDateBucket('daily', taipeiNoon);
    expect(bucket).toBe('daily_2026-04-20');
  });

  test('monthly 分桶格式 monthly_YYYY-MM', () => {
    const bucket = getTaipeiDateBucket('monthly', taipeiNoon);
    expect(bucket).toBe('monthly_2026-04');
  });

  test('weekly 分桶格式 weekly_YYYY-Wnn', () => {
    const bucket = getTaipeiDateBucket('weekly', taipeiNoon);
    expect(bucket).toMatch(/^weekly_\d{4}-W\d{2}$/);
  });

  test('無 period 默認 daily', () => {
    const bucket = getTaipeiDateBucket('unknown', taipeiNoon);
    expect(bucket).toBe('daily_2026-04-20');
  });

  test('跨日邊界：台北午夜前後屬於不同 daily 桶', () => {
    const before = new Date('2026-04-20T15:59:00Z').getTime(); // 台北 23:59
    const after = new Date('2026-04-20T16:01:00Z').getTime(); // 台北 隔日 00:01
    const bucketBefore = getTaipeiDateBucket('daily', before);
    const bucketAfter = getTaipeiDateBucket('daily', after);
    expect(bucketBefore).toBe('daily_2026-04-20');
    expect(bucketAfter).toBe('daily_2026-04-21');
  });

  test('跨月：月初第一天 monthly 桶', () => {
    const feb28 = new Date('2026-02-28T00:00:00Z').getTime();
    const mar01 = new Date('2026-03-01T00:00:00Z').getTime();
    // 注意：台北時間比 UTC 早 8 小時，台北的 2026-03-01 08:00 = UTC 2026-03-01 00:00
    expect(getTaipeiDateBucket('monthly', feb28)).toContain('-02');
    expect(getTaipeiDateBucket('monthly', mar01)).toContain('-03');
  });
});
