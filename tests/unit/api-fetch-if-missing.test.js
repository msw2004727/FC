/**
 * fetchAttendanceIfMissing / fetchRegistrationsIfMissing — unit tests
 *
 * 驗證 2026-04-25 方案 D 的修復：
 *   1. Set 去重避免重複 Firestore query
 *   2. attendance：未結束活動（status=upcoming）直接信任快取空值、不 fetch
 *   3. registrations：只用 Set 去重（因熱門活動可能超 onSnapshot limit）
 *   4. cached > 0 → 標記 Set 並短路
 *   5. _docId 缺失 → warn + return
 *
 * Extracted logic from js/api-service.js fetchAttendanceIfMissing /
 * fetchRegistrationsIfMissing. 保持與源碼等價、純函式化以便單元測試。
 */

// ---------------------------------------------------------------------------
// Extracted pure logic — fetchAttendanceIfMissing short-circuit decision tree
// Returns one of: 'dup' | 'cached' | 'upcoming-skip' | 'no-docid' | 'fetch'
// ---------------------------------------------------------------------------
function decideAttendanceFetch(eventId, fetchedSet, cachedLength, event) {
  if (!eventId) return 'invalid';
  if (fetchedSet.has(eventId)) return 'dup';
  if (cachedLength > 0) return 'cached';
  if (event && event.status !== 'ended' && event.status !== 'cancelled') return 'upcoming-skip';
  if (!event || !event._docId) return 'no-docid';
  return 'fetch';
}

// ---------------------------------------------------------------------------
// Extracted pure logic — fetchRegistrationsIfMissing short-circuit decision tree
// Returns one of: 'dup' | 'cached' | 'no-docid' | 'fetch'
// Note: registrations 不看 event.status，因熱門活動可能超 limit
// ---------------------------------------------------------------------------
function decideRegistrationsFetch(eventId, fetchedSet, cachedLength, event) {
  if (!eventId) return 'invalid';
  if (fetchedSet.has(eventId)) return 'dup';
  if (cachedLength > 0) return 'cached';
  if (!event || !event._docId) return 'no-docid';
  return 'fetch';
}

// ---------------------------------------------------------------------------
// Extracted pure logic — dedup push via _docId
// 模擬 fetchIfMissing 內 Set(_docId) 去重把新紀錄合併到 source 陣列
// ---------------------------------------------------------------------------
function mergeDedupByDocId(source, incoming) {
  const existing = new Set(source.map(r => r._docId));
  const merged = source.slice();
  incoming.forEach(r => {
    if (!existing.has(r._docId)) {
      merged.push(r);
      existing.add(r._docId);
    }
  });
  return merged;
}

describe('decideAttendanceFetch — 方案 D 短路邏輯', () => {
  const endedEvent = { id: 'ev1', _docId: 'doc1', status: 'ended' };
  const cancelledEvent = { id: 'ev1', _docId: 'doc1', status: 'cancelled' };
  const upcomingEvent = { id: 'ev1', _docId: 'doc1', status: 'upcoming' };
  const openEvent = { id: 'ev1', _docId: 'doc1', status: 'open' };

  test('Set 已標記 → 回傳 dup（不 fetch）', () => {
    const fetched = new Set(['ev1']);
    expect(decideAttendanceFetch('ev1', fetched, 0, endedEvent)).toBe('dup');
  });

  test('快取已有紀錄（cached > 0）→ 回傳 cached', () => {
    const fetched = new Set();
    expect(decideAttendanceFetch('ev1', fetched, 5, endedEvent)).toBe('cached');
  });

  test('未結束活動（upcoming）+ 空快取 → 回傳 upcoming-skip（不 fetch）', () => {
    const fetched = new Set();
    expect(decideAttendanceFetch('ev1', fetched, 0, upcomingEvent)).toBe('upcoming-skip');
  });

  test('進行中活動（open）+ 空快取 → 回傳 upcoming-skip（不 fetch）', () => {
    const fetched = new Set();
    expect(decideAttendanceFetch('ev1', fetched, 0, openEvent)).toBe('upcoming-skip');
  });

  test('已結束活動（ended）+ 空快取 → 回傳 fetch（觸發 Firestore query）', () => {
    const fetched = new Set();
    expect(decideAttendanceFetch('ev1', fetched, 0, endedEvent)).toBe('fetch');
  });

  test('已取消活動（cancelled）+ 空快取 → 回傳 fetch', () => {
    const fetched = new Set();
    expect(decideAttendanceFetch('ev1', fetched, 0, cancelledEvent)).toBe('fetch');
  });

  test('已結束但缺 _docId → 回傳 no-docid（不 fetch）', () => {
    const fetched = new Set();
    const noDoc = { id: 'ev1', status: 'ended' };
    expect(decideAttendanceFetch('ev1', fetched, 0, noDoc)).toBe('no-docid');
  });

  test('活動不存在（event null）→ 回傳 no-docid', () => {
    const fetched = new Set();
    expect(decideAttendanceFetch('ev1', fetched, 0, null)).toBe('no-docid');
  });

  test('eventId 為空 → 回傳 invalid', () => {
    const fetched = new Set();
    expect(decideAttendanceFetch('', fetched, 0, endedEvent)).toBe('invalid');
  });
});

describe('decideRegistrationsFetch — 方案 D 短路邏輯', () => {
  const upcomingEvent = { id: 'ev1', _docId: 'doc1', status: 'upcoming' };
  const endedEvent = { id: 'ev1', _docId: 'doc1', status: 'ended' };

  test('Set 已標記 → 回傳 dup（不看 status）', () => {
    const fetched = new Set(['ev1']);
    expect(decideRegistrationsFetch('ev1', fetched, 0, upcomingEvent)).toBe('dup');
  });

  test('快取已有 → 回傳 cached（不看 status）', () => {
    const fetched = new Set();
    expect(decideRegistrationsFetch('ev1', fetched, 3, upcomingEvent)).toBe('cached');
  });

  test('未結束活動 + 空快取 → 仍回傳 fetch（因熱門活動可能超 limit）', () => {
    const fetched = new Set();
    expect(decideRegistrationsFetch('ev1', fetched, 0, upcomingEvent)).toBe('fetch');
  });

  test('已結束活動 + 空快取 → 回傳 fetch', () => {
    const fetched = new Set();
    expect(decideRegistrationsFetch('ev1', fetched, 0, endedEvent)).toBe('fetch');
  });

  test('活動不存在 → 回傳 no-docid', () => {
    const fetched = new Set();
    expect(decideRegistrationsFetch('ev1', fetched, 0, null)).toBe('no-docid');
  });

  test('eventId 為空 → 回傳 invalid', () => {
    const fetched = new Set();
    expect(decideRegistrationsFetch('', fetched, 0, upcomingEvent)).toBe('invalid');
  });
});

describe('mergeDedupByDocId — 去重合併邏輯', () => {
  test('新紀錄全部新增', () => {
    const source = [];
    const incoming = [
      { _docId: 'a', uid: 'u1' },
      { _docId: 'b', uid: 'u2' },
    ];
    const merged = mergeDedupByDocId(source, incoming);
    expect(merged).toHaveLength(2);
    expect(merged.map(r => r._docId)).toEqual(['a', 'b']);
  });

  test('_docId 重複的紀錄不重複新增', () => {
    const source = [{ _docId: 'a', uid: 'u1' }];
    const incoming = [
      { _docId: 'a', uid: 'u1' },  // 重複
      { _docId: 'b', uid: 'u2' },
    ];
    const merged = mergeDedupByDocId(source, incoming);
    expect(merged).toHaveLength(2);
    expect(merged.map(r => r._docId).sort()).toEqual(['a', 'b']);
  });

  test('source 為空、incoming 也為空 → 回傳空陣列', () => {
    const merged = mergeDedupByDocId([], []);
    expect(merged).toEqual([]);
  });

  test('同一 uid 不同 _docId（checkin / checkout / note）都保留', () => {
    const source = [];
    const incoming = [
      { _docId: 'a1', uid: 'u1', type: 'checkin' },
      { _docId: 'a2', uid: 'u1', type: 'checkout' },
      { _docId: 'a3', uid: 'u1', type: 'note' },
    ];
    const merged = mergeDedupByDocId(source, incoming);
    expect(merged).toHaveLength(3);
  });
});
