# fetchIfMissing short-circuit 缺陷修復計畫（方案 D）

> **Status**: Draft v1, awaiting audit
> **Date**: 2026-04-25
> **Root cause**: `fetchAttendanceIfMissing` / `fetchRegistrationsIfMissing` 的 short-circuit 條件寫錯（只看「該活動有無紀錄」而非「onSnapshot 是否已載入該活動資料」），導致未結束活動每次進頁都觸發真 Firestore query，實測 500-4000ms。

---

## 1. 實測證據（driving this change）

用戶開啟 `localStorage._perfAttLog='1'` 後、連續進 5 個活動各 3 次。所有 15 筆 log：

| 活動 | 人數 | 1st fetch_ms | 2nd | 3rd |
|------|------|--------------|-----|-----|
| ce_…310w | 20 | **4121.8** | 3786.9 | 537.9 |
| ce_…o1av | 27 | 542.8 | 189.8 | 523.7 |
| ce_…216u | 11 | 553.2 | 209.8 | 493.5 |
| ce_…ahhr | 6 | 536.2 | 190.8 | 493.8 |
| ce_…1s90 | 27 | 411.1 | 73.8 | 435.2 |

`summary_ms` / `noshow_ms` / `rows_ms` / `html_bind_ms` 全部 < 3ms。**99% 延遲源自 fetch**。

---

## 2. 修復策略差異化（關鍵：attendance vs registrations 要分開）

| 集合 | 超 limit 時機 | 短路策略 |
|------|--------------|----------|
| `attendanceRecords` | 只有**已結束活動**的大量簽到記錄才會超 500 limit（新活動簽到記錄必然少） | **未結束活動 → 信任快取空值（不 fetch）**<br>**已結束活動 → 第一次 fetch + Set 去重** |
| `registrations` | 熱門活動**未結束也可能 >500 人報名** | **只用 Set 去重**（不看活動時間） |

**關鍵區別**：registrations 不能用「未結束 → 跳過」邏輯，否則熱門活動會看不到名單。

---

## 3. 詳細實作（api-service.js）

### 3.1 `fetchAttendanceIfMissing` — 活動時間 + Set 雙重去重

```javascript
async fetchAttendanceIfMissing(eventId) {
  if (!eventId || typeof db === 'undefined') return;

  this._fetchedAttendanceIds = this._fetchedAttendanceIds || new Set();
  if (this._fetchedAttendanceIds.has(eventId)) return;

  var cached = this.getAttendanceRecords(eventId);
  if (cached.length > 0) {
    this._fetchedAttendanceIds.add(eventId);
    return;
  }

  var ev = this._findById('events', eventId);
  // 未結束活動：不可能超出 attendance onSnapshot limit，信任快取為空
  if (ev && ev.status !== 'ended' && ev.status !== 'cancelled') return;

  if (!ev || !ev._docId) return;
  try {
    var snap = await db.collection('events').doc(ev._docId)
      .collection('attendanceRecords').get();
    var records = snap.docs.map(function(d) { return Object.assign({}, d.data(), { _docId: d.id }); });
    var source = FirebaseService._cache.attendanceRecords || [];
    var existing = new Set(source.map(function(r) { return r._docId; }));
    records.forEach(function(r) { if (!existing.has(r._docId)) source.push(r); });
    this._fetchedAttendanceIds.add(eventId);
  } catch (err) {
    console.warn('[fetchAttendanceIfMissing]', err);
  }
},
```

### 3.2 `fetchRegistrationsIfMissing` — 僅用 Set 去重

```javascript
async fetchRegistrationsIfMissing(eventId) {
  if (!eventId || typeof db === 'undefined') return;

  this._fetchedRegistrationIds = this._fetchedRegistrationIds || new Set();
  if (this._fetchedRegistrationIds.has(eventId)) return;

  var cached = this.getRegistrationsByEvent(eventId);
  if (cached.length > 0) {
    this._fetchedRegistrationIds.add(eventId);
    return;
  }

  var ev = this._findById('events', eventId);
  if (!ev || !ev._docId) return;
  try {
    var snap = await db.collection('events').doc(ev._docId)
      .collection('registrations').get();
    var records = snap.docs.map(function(d) { return Object.assign({}, d.data(), { _docId: d.id }); });
    var source = FirebaseService._cache.registrations || [];
    var existing = new Set(source.map(function(r) { return r._docId; }));
    records.forEach(function(r) { if (!existing.has(r._docId)) source.push(r); });
    this._fetchedRegistrationIds.add(eventId);
  } catch (err) {
    console.warn('[fetchRegistrationsIfMissing]', err);
  }
},
```

---

## 4. 自我審計發現的 10 個已知瑕疵

### P1. `event.status === 'ended'` 有延遲（由 CF 定時任務設定）
- 活動自然結束 → 下一次 `autoEndEvents` CF 執行前，status 還是 `upcoming`
- 此間隔若為 1 小時 → 活動實際結束 59 分後進頁仍被當 active → 不 fetch → 看不到即時簽到記錄
- **緩解**：對剛進頁的用戶，onSnapshot 會自動推送新記錄，但有 limit 截斷風險
- **評估**：**可接受**（這個空窗期一般不會有人查舊活動）

### P2. 黑名單 / 權限擋住的活動仍會觸發 `_findById('events', eventId)`
- 如果活動不在 events 快取中（例如被隱藏、被擋），`_findById` 回傳 `undefined`
- 方案 D 會直接 return（未結束 OR `!ev._docId`）→ 不 fetch
- **評估**：**符合預期**，沒權限的活動本來就不該查

### P3. `_fetchedAttendanceIds` / `_fetchedRegistrationIds` 永不清除
- Set 只會增長，不會減少
- **評估**：每個 eventId ~30 bytes，一萬個也才 300KB，**可忽略**

### P4. 並發 fetch 重複觸發
- onSnapshot trigger + 用戶點擊同時觸發 → 兩次 fetch 同時進行
- 第一次 fetch 完成前、Set 還沒標記 → 第二次檢查 Set 也 miss
- **評估**：不會造成錯誤資料（都是同一個子集合 query、結果一致），只是浪費 1 次讀
- **是否修**：加 `_pendingAttendanceFetch` Map 去重 pending promise。**可選、不做也 OK**

### P5. 活動狀態從 `ended` 被手動改回 `upcoming` 的 edge case
- 管理員手動把已結束活動改回「上架」（罕見操作）
- `_fetchedAttendanceIds` 已標記 → 不會再 fetch
- **評估**：罕見情境、而且 onSnapshot 會推送真實資料、快取會更新。**可接受**

### P6. 未結束活動但快取是空的 → 短暫顯示「尚無報名」
- 用戶第一次開 APP、onSnapshot 還在載中（`_attendanceSnapshotReady === false`）
- 同時進活動詳情頁 → cached 空 → 方案 D 不 fetch → 畫面顯示 `people.length === 0`
- `event-manage-attendance.js:138-157` 已有 skeleton 保護（判斷 `expectedCount > 0` 時顯示載入中）
- **評估**：**符合現有 UX**，等 snapshot 好會自動重繪

### P7. registrations 對「新用戶剛進 APP」的情境仍可能慢
- registrations onSnapshot 只載前 N 筆（常見 500）→ 熱門活動不在前 500 筆時 → fetch 觸發
- 方案 D 只用 Set 去重、不跳過 fetch
- **評估**：**符合預期**，registrations 確實有超 limit 的風險，必須 fetch

### P8. CLAUDE.md 鎖定函式清單需要確認
- `fetchAttendanceIfMissing` / `fetchRegistrationsIfMissing` **不在**鎖定清單
- `api-service.js` **不在**鎖定檔清單
- `getAttendanceRecords` / `getUserAttendanceRecords` 在鎖定清單，但本次不動
- **評估**：**合規**，可修

### P9. 測試覆蓋
- `tests/unit/` 目前沒有 fetchAttendanceIfMissing / fetchRegistrationsIfMissing 測試
- 方案 D 加了條件分支（活動時間判斷 + Set 去重）→ 應補測試
- **行動**：新增 4-6 個單元測試覆蓋：
  1. Set 已標記 → 直接 return
  2. cached.length > 0 → 標記並 return
  3. 未結束活動 + cached 空 → 不 fetch（attendance 專屬）
  4. 已結束活動 + cached 空 → fetch 並標記
  5. registrations：cached 空 + 任何狀態 → fetch 並標記
  6. 錯誤路徑：`db undefined`、`!ev._docId`

### P10. 回退策略
- 若方案 D 出問題（例如大量用戶回報看不到簽到）→ git revert 秒回退
- 回退難度：**極低**（單一檔案、2 函式）

---

## 5. 影響範圍

### 5.1 只有 2 處呼叫
已用 grep 驗證：
```
js/modules/event/event-manage-attendance.js:127  fetchAttendanceIfMissing
js/modules/event/event-manage-attendance.js:128  fetchRegistrationsIfMissing
```
只有報名名單渲染在用，沒有其他路徑會受影響。

### 5.2 不動鎖定函式
- ✅ `registerForEvent` / `cancelRegistration` / `_rebuildOccupancy` 等報名系統鎖定函式完全不動
- ✅ `_buildRawNoShowCountByUid` / `_buildConfirmedParticipantSummary` 不動
- ✅ `ensureUserStatsLoaded` 不動
- ✅ Firestore Rules 不動
- ✅ Cloud Functions 不動

### 5.3 UI 影響
- **正面**：未結束活動的報名名單載入從 500-4000ms → < 50ms
- **負面**：若 CF 的 `autoEndEvents` 延遲，剛結束的活動簽到記錄可能晚 1 分鐘才完整（P1）

---

## 6. 預期效益評估

| 評估項目 | 內容 |
|----------|------|
| **做了會怎樣（好處）** | 用戶進活動頁時名單「瞬開」（< 50ms），取代現在要等 0.5-4 秒 |
| **不做會怎樣** | 活動頁載入體驗持續差、特別是新活動每次都卡頓 |
| **最壞情況** | 剛結束（< 1 小時）的活動簽到記錄短暫看不到最新 → 等 CF 自動結束後正常 |
| **影響範圍** | 只影響 `api-service.js` 2 個函式 + 單元測試 + memory log |
| **回退難度** | 秒回退（git revert） |
| **歷史教訓** | 2026-04-23 曾誤判 fetchIfMissing 不慢 → 回滾兩段式 render。本次**用實測數據打破假設**、符合當時的教訓「先實測再優化」|

---

## 7. 提交策略

### 一個 commit
- `js/api-service.js`（修 2 函式）
- `tests/unit/api-service-fetch-if-missing.test.js`（新檔、6 個測試）
- `docs/claude-memory.md`（記錄修復 + 更新 2026-04-23 認知 [永久]）
- `js/config.js` / `sw.js` / `index.html`（版號 bump）

### Commit message
```
perf(attendance): fix fetchIfMissing 短路邏輯、未結束活動免查 Firestore

實測發現 fetch_ms 佔總渲染 99%（500-4000ms），根因是 short-circuit
只看 cached.length > 0，未結束活動永遠命中 false 分支觸發真 query。

- fetchAttendanceIfMissing: 未結束活動直接信任快取空值、不 fetch
- fetchRegistrationsIfMissing: 僅用 per-eventId Set 去重（registrations
  熱門活動可能超 limit、不能用狀態判斷）
- _fetchedAttendanceIds / _fetchedRegistrationIds Set 避免重複 fetch
- 新增 6 個單元測試
- 更新 memory log 2026-04-23 的認知誤區
```

---

## 8. 剩餘未決問題

1. **是否加 pending-promise 去重**（P4 提到）？
   - **建議**：先不加，觀察 log 是否真的看到並發 fetch。若有才補。
2. **`event.status` 以外，是否用 `event.date` 兜底**？
   - **建議**：先只信 `status`，因 CF `autoEndEvents` 已可靠運行。若出現 P1 症狀再補日期 fallback。
3. **需要加 debug log 追蹤 fetch 發生嗎**？
   - **建議**：新增 `console.log('[fetch-attendance]', eventId, reason)` gated by `window._fetchDebug`，方便後續排查。可選。
