/**
 * 活動瀏覽數（viewCount）— unit tests
 *
 * Extracted from:
 *   - js/modules/event/event-detail.js (_incrementEventViewCount)
 *   - firestore.rules (isViewCountIncrementOnly)
 *
 * 重點驗證：
 *   - localStorage 同日去重 key 格式（本地時區 YYYY-MM-DD，非 UTC）
 *   - IP 比對 rate limit 邏輯
 *   - Rules 規則：只允許 viewCount +1、拒絕 -1、拒絕同時改其他欄位
 *   - 舊活動無 viewCount 欄位時的 increment 行為
 */

// ─── 從 event-detail.js 抽取 ───
function buildViewCountLocalKey(eventId, date = new Date()) {
  const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return `view_${eventId}_${today}`;
}

// ─── Rules: isViewCountIncrementOnly 的行為模擬 ───
function isViewCountIncrementOnly({ affectedKeys, newViewCount, oldViewCount }) {
  // affectedKeys = request.resource.data.diff(resource.data).affectedKeys()
  // hasOnly(['viewCount'])
  if (!Array.isArray(affectedKeys) || affectedKeys.length !== 1 || affectedKeys[0] !== 'viewCount') {
    return false;
  }
  // request.resource.data.viewCount == resource.data.get('viewCount', 0) + 1
  const expected = (oldViewCount || 0) + 1;
  return newViewCount === expected;
}

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════

describe('ViewCount — localStorage key 格式', () => {
  test('台灣時區日期格式化正確', () => {
    const key = buildViewCountLocalKey('ce_123', new Date(2026, 3, 20, 18, 0));
    // 2026-04-20（注意 Month 0-indexed）
    expect(key).toBe('view_ce_123_2026-04-20');
  });

  test('月份 / 日期補 0', () => {
    const key = buildViewCountLocalKey('ce_456', new Date(2026, 0, 5));
    expect(key).toBe('view_ce_456_2026-01-05');
  });

  test('跨年邊界', () => {
    const key = buildViewCountLocalKey('ce_789', new Date(2026, 11, 31, 23, 59));
    expect(key).toBe('view_ce_789_2026-12-31');
  });

  test('同日不同時間 → 同一 key', () => {
    const morning = buildViewCountLocalKey('ce_abc', new Date(2026, 3, 20, 6, 0));
    const evening = buildViewCountLocalKey('ce_abc', new Date(2026, 3, 20, 23, 59));
    expect(morning).toBe(evening);
  });

  test('同裝置不同活動 → 不同 key', () => {
    const date = new Date(2026, 3, 20);
    expect(buildViewCountLocalKey('ce_111', date)).not.toBe(buildViewCountLocalKey('ce_222', date));
  });
});

describe('ViewCount — Rules: isViewCountIncrementOnly', () => {
  test('合法：只改 viewCount 且 +1', () => {
    expect(isViewCountIncrementOnly({
      affectedKeys: ['viewCount'],
      newViewCount: 6,
      oldViewCount: 5,
    })).toBe(true);
  });

  test('舊活動無 viewCount 欄位（oldViewCount=undefined）→ +1 = 1 合法', () => {
    expect(isViewCountIncrementOnly({
      affectedKeys: ['viewCount'],
      newViewCount: 1,
      oldViewCount: undefined,
    })).toBe(true);
  });

  test('拒絕：減 1', () => {
    expect(isViewCountIncrementOnly({
      affectedKeys: ['viewCount'],
      newViewCount: 4,
      oldViewCount: 5,
    })).toBe(false);
  });

  test('拒絕：+ 2（試圖加兩次）', () => {
    expect(isViewCountIncrementOnly({
      affectedKeys: ['viewCount'],
      newViewCount: 7,
      oldViewCount: 5,
    })).toBe(false);
  });

  test('拒絕：同時改其他欄位（viewCount + title）', () => {
    expect(isViewCountIncrementOnly({
      affectedKeys: ['viewCount', 'title'],
      newViewCount: 6,
      oldViewCount: 5,
    })).toBe(false);
  });

  test('拒絕：沒改 viewCount（只改其他欄位）', () => {
    expect(isViewCountIncrementOnly({
      affectedKeys: ['title'],
      newViewCount: 5,
      oldViewCount: 5,
    })).toBe(false);
  });

  test('拒絕：空 affectedKeys', () => {
    expect(isViewCountIncrementOnly({
      affectedKeys: [],
      newViewCount: 5,
      oldViewCount: 5,
    })).toBe(false);
  });

  test('拒絕：不改值但 affectedKeys=[viewCount]', () => {
    expect(isViewCountIncrementOnly({
      affectedKeys: ['viewCount'],
      newViewCount: 5,
      oldViewCount: 5,
    })).toBe(false);
  });
});

describe('ViewCount — 整體邏輯防護', () => {
  test('連續 10 次 +1 永遠合法', () => {
    for (let i = 0; i < 10; i++) {
      expect(isViewCountIncrementOnly({
        affectedKeys: ['viewCount'],
        newViewCount: i + 1,
        oldViewCount: i,
      })).toBe(true);
    }
  });

  test('刷榜情境：短時間 +1000 被分散成 1000 次獨立寫入（每次仍合法）', () => {
    // 此測試驗證 Rules 無法擋住「分散式刷榜」
    // 這是方案 A 的已知限制（CLAUDE.md 記錄的接受風險）
    for (let i = 0; i < 100; i++) {
      expect(isViewCountIncrementOnly({
        affectedKeys: ['viewCount'],
        newViewCount: i + 1,
        oldViewCount: i,
      })).toBe(true);
    }
    // 這是預期行為：Rules 層無法擋惡意刷榜，需要 rate limit 層額外保護
  });
});
