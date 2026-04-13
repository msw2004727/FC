# 簽到監聽器優化：全站大杯子 → 按需小杯子（v2）

> **📍 狀態**：計劃書 v2（5 位專家審計後修訂，4 個 MUST FIX 已納入）

## 問題

全站簽到監聽器 `collectionGroup('attendanceRecords').orderBy('createdAt','desc').limit(1500)` 有兩個問題：

1. **舊活動看不到簽到紀錄**：2576 筆 + 根集合重複 = ~5152 筆。limit 1500 + dedup 後只剩 ~750 筆在快取，較舊活動的簽到紀錄被截斷
2. **浪費讀取費用**：每個用戶載入 1500 筆，但只看 1 場活動（~20 筆），99% 白載

## 核心思路

子集合遷移完成後，可以精準監聽**單場活動**的簽到子集合，不需要全站撈：

```
遷移前（根集合）：只能監聽全站 → 必須用 limit 控制成本 → 舊資料被截斷
遷移後（子集合）：可以只監聽一場 → 零浪費 → 所有活動都有完整資料
```

---

## 消費者清查

| 消費者 | 頁面 | 需要範圍 | 需要即時更新 | 方案 |
|--------|------|----------|-------------|------|
| `_renderAttendanceTable` | page-activity-detail | 單場活動 | ✅ 掃碼後立刻更新 | **Per-event 子集合監聽器** |
| `_renderScanResults` | page-scan | 單場活動 | ✅ 掃碼後立刻更新 | **Per-event 子集合監聽器** |
| `_renderAttendanceSections` | page-scan | 單場活動 | ✅ | 同上 |
| `scan-process.js` | page-scan | 單場活動 | ✅ | 同上 |
| `scan-family.js` | page-scan | 單場活動 | ✅ | 同上 |
| `event-manage.js:460,536` | page-activity-detail | 單場活動 | ✅ | 同上 |
| `leaderboard.js` | page-leaderboard | 單一用戶全部 | ❌ 一次性 | `ensureUserStatsLoaded`（已存在，per-user 無 limit） |
| `achievement/evaluator.js` | page-profile | 單一用戶全部 | ❌ | 同上 |
| `event-manage.js:262` | page-activities（僅管理員） | 全站 | ❌ | 保留全站監聽器（大幅縮小 limit） |
| `event-manage-noshow.js:146` | page-activity-detail（僅管理員） | 全站 | ❌ | 同上 |

---

## 實作方案

### Phase A：新增 per-event 子集合監聽器

**新增位置**：`js/firebase-service.js`

```js
// ═══ 新增 state fields（初始化區塊）═══
_eventAttendanceListenerId: null,      // 目前監聽的 eventDocId（Firestore doc.id）
_eventAttendanceEventId: null,         // 對應的 data.id（供 getAttendanceRecords 比對）
_eventAttendanceCache: null,           // per-event snapshot 資料
_eventAttendanceUnsub: null,           // unsubscribe 函式
_eventAttendanceSnapshotReady: false,  // 首次 snapshot 到達旗標

// ═══ 啟動 ═══
_startEventAttendanceListener(eventDocId, eventId) {
  // 已在監聯同一活動 → 跳過
  if (this._eventAttendanceListenerId === eventDocId) return;
  this._stopEventAttendanceListener();

  this._eventAttendanceListenerId = eventDocId;
  this._eventAttendanceEventId = eventId;  // 追蹤雙 ID
  this._eventAttendanceSnapshotReady = false;

  // closure 捕獲 — 防止 stale callback 寫入錯誤資料
  var targetDocId = eventDocId;

  this._eventAttendanceUnsub = db.collection('events').doc(eventDocId)
    .collection('attendanceRecords')
    .onSnapshot(function(snapshot) {
      // Guard：用戶已切換到其他活動 → 丟棄此 callback
      if (this._eventAttendanceListenerId !== targetDocId) return;

      this._eventAttendanceCache = snapshot.docs.map(function(doc) {
        return Object.assign({}, doc.data(), { _docId: doc.id });
      });
      this._eventAttendanceSnapshotReady = true;
      this._debouncedSnapshotRender('attendance');
    }.bind(this));
},

// ═══ 停止 ═══
_stopEventAttendanceListener() {
  if (this._eventAttendanceUnsub) {
    this._eventAttendanceUnsub();
    this._eventAttendanceUnsub = null;
  }
  this._eventAttendanceListenerId = null;
  this._eventAttendanceEventId = null;
  this._eventAttendanceCache = null;
  this._eventAttendanceSnapshotReady = false;
},
```

**v2 修正（vs v1）**：
- 接受雙 ID（`eventDocId` + `eventId`）— 解決 doc.id vs data.id 不匹配問題
- closure guard `targetDocId` — 防止快速切換活動時 stale callback 覆蓋新資料
- `_eventAttendanceSnapshotReady` 旗標 — 防止首次 snapshot 前顯示空表格

---

### Phase A（續）：修改 `getAttendanceRecords`

**修改位置**：`js/api-service.js`

```js
getAttendanceRecords(eventId) {
  // Per-event 快取：監聽器 active + 是同一場活動 + 首次 snapshot 已到達
  if (eventId
      && FirebaseService._eventAttendanceEventId === eventId
      && FirebaseService._eventAttendanceSnapshotReady) {
    var cache = FirebaseService._eventAttendanceCache || [];
    return cache.filter(function(r) {
      return r.status !== 'removed' && r.status !== 'cancelled';
    });
  }
  // Fallback：全站快取（可能被 limit 截斷）
  var source = this._src('attendanceRecords');
  var active = source.filter(function(r) {
    return r.status !== 'removed' && r.status !== 'cancelled';
  });
  if (eventId) return active.filter(function(r) { return r.eventId === eventId; });
  return active;
},
```

**v2 修正（vs v1）**：
- 比對 `_eventAttendanceEventId`（data.id）而非檢查記錄內容 — 解決空快取 `some()` 失敗問題
- 加入 `_eventAttendanceSnapshotReady` 檢查 — snapshot 未到前使用全站快取（避免空表格閃爍）

---

### Phase A（續）：樂觀寫入同步到 per-event 快取

**修改位置**：`js/api-service.js`

`addAttendanceRecord` 和 `removeAttendanceRecord` 的樂觀更新必須**同時寫入全站快取和 per-event 快取**，否則掃碼後 per-event 快取優先返回舊資料 → 新簽到暫時看不到。

```js
// addAttendanceRecord 中，push 到全站快取之後加：
if (FirebaseService._eventAttendanceEventId === normalized.eventId
    && FirebaseService._eventAttendanceCache) {
  FirebaseService._eventAttendanceCache.push(normalized);
}

// removeAttendanceRecord 中，設 status='removed' 之後加：
if (FirebaseService._eventAttendanceCache) {
  var peRec = FirebaseService._eventAttendanceCache.find(function(r) {
    return r.id === record.id;
  });
  if (peRec) { peRec.status = 'removed'; }
}
```

**v2 新增**：v1 完全沒有這段，會導致掃碼後 100-500ms 簽到紀錄「消失再出現」的回歸。

---

### Phase B：啟動 / 停止時機

**活動詳情頁**（`showEventDetail`，在取得 event 物件後）：

```js
if (e._docId) {
  FirebaseService._startEventAttendanceListener(e._docId, e.id);
}
```

**掃碼頁**（`_bindScanEvents` change handler + `renderScanPage` preset）：

```js
// 選擇活動時
var ev = ApiService.getEvent(this._scanSelectedEventId);
if (ev && ev._docId) {
  FirebaseService._startEventAttendanceListener(ev._docId, ev.id);
} else {
  FirebaseService._stopEventAttendanceListener();
}
```

**離開頁面時**（`finalizePageScopedRealtimeForPage`）：

```js
if (!needed.has('attendanceRecords')) {
  this._stopAttendanceRecordsListener();     // 停止全站監聽器
  this._stopEventAttendanceListener();       // 停止 per-event 監聽器
}
```

**v2 修正**：掃碼頁明確使用 `ApiService.getEvent()` 查找 `_docId`（v1 未指定）。

---

### Phase C：縮小全站監聽器 limit + 儀表板可調

**程式碼預設值**：

```js
// config.js — fallback 預設值
const REALTIME_LIMIT_DEFAULTS = {
  attendanceLimit: 500,     // 1500 → 500
  registrationLimit: 3000,  // 不變
  eventLimit: 100,          // 不變
};
```

**儀表板動態設定**（優先於程式碼預設值）：

```
Firestore 路徑：siteConfig/realtimeConfig
欄位：attendanceLimit（數字）

設定優先級：
1. siteConfig/realtimeConfig.attendanceLimit ← 儀表板設的值（最高優先）
2. config.js REALTIME_LIMIT_DEFAULTS.attendanceLimit ← 程式碼預設 500（fallback）

想恢復原本 → 儀表板設 1500（不需改程式碼）
```

---

### Phase D（可選）：載入中提示

per-event 監聽器啟動但首次 snapshot 未到達時，顯示載入提示：

```js
// _renderAttendanceTable 開頭加
if (FirebaseService._eventAttendanceEventId === eventId
    && !FirebaseService._eventAttendanceSnapshotReady) {
  container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:1rem;font-size:.82rem">載入簽到紀錄中...</div>';
  return;
}
```

---

## 改動範圍

| 檔案 | 改動 | 風險 |
|------|------|------|
| `js/firebase-service.js` | 新增 `_startEventAttendanceListener` / `_stopEventAttendanceListener` + `finalizePageScopedRealtimeForPage` 加停止 | 低（新增函式 + 一行修改） |
| `js/api-service.js` | `getAttendanceRecords` 加 per-event 判斷 + `addAttendanceRecord` / `removeAttendanceRecord` 樂觀寫入同步 | 中（修改既有函式，但 fallback 保留原邏輯） |
| `js/modules/event/event-detail.js` | `showEventDetail` 中呼叫 `_startEventAttendanceListener` | 低（一行新增） |
| `js/modules/scan/scan-ui.js` + `scan.js` | 選擇活動後呼叫 `_startEventAttendanceListener` | 低（2-3 行新增） |
| `js/config.js` | `attendanceLimit: 1500 → 500`（fallback 預設值） | 低 |
| `js/modules/event/event-manage-attendance.js` | （可選）載入中提示 | 低 |

**不需要改的**：
- `_renderAttendanceTable` — 不動渲染邏輯（仍讀 `ApiService.getAttendanceRecords`）
- `_debouncedSnapshotRender` — 不動（per-event 監聽器呼叫同一函式）
- `ensureUserStatsLoaded` — 不動（per-user 路徑已正常）
- Cloud Functions — 不動

---

## 效果對比

| 指標 | 現在 | 優化後 |
|------|------|--------|
| 用戶開活動詳情頁 Firestore 讀取 | 1500 筆 | **~20 筆**（該活動的簽到） |
| 舊活動看得到簽到紀錄 | ❌ 被截斷 | ✅ 完整（子集合無 limit） |
| 即時更新（掃碼後立刻反映） | ✅ | ✅ |
| 全站監聽器讀取 | 1500 筆 | **500 筆**（預設，可從儀表板調整） |
| Firestore 每月讀取成本 | ~$3-8 | **~$1-3**（估計省 50-70%） |
| 記憶體 | 1500 筆快取 | ~520 筆（500 全站 + ~20 當前活動） |

---

## 風險評估

| 評估項目 | 內容 |
|----------|------|
| **做了會怎樣（好處）** | 舊活動簽到紀錄完整顯示 + Firestore 讀取省 50-70% + 記憶體減少 65% |
| **不做會怎樣** | 舊活動持續看不到簽到紀錄，資料越多越嚴重 |
| **最壞情況** | per-event 監聽器的 stale callback 寫入錯誤資料 → closure guard 防護 |
| **影響範圍** | 6 個檔案、~60 行改動 |
| **回退難度** | 秒回退 — 儀表板 `attendanceLimit` 改回 1500 + 移除 per-event 監聽器呼叫 |
| **歷史教訓** | Phase 3c 移除 per-event 快取假設子集合遷移解決了 limit 問題但沒有。本方案用監聽器（非快取）+ closure guard + 雙 ID 追蹤避免舊方案的缺陷 |

---

## 工時預估

| Phase | 內容 | 預估 |
|-------|------|------|
| A | per-event 監聽器 + getAttendanceRecords 改動 + 樂觀寫入同步 | 40 分鐘 |
| B | 啟動/停止時機（detail + scan + 離開） | 15 分鐘 |
| C | 縮小全站 limit | 1 分鐘 |
| D | （可選）載入中提示 | 10 分鐘 |
| 測試 + QA | 全套驗收 | 15 分鐘 |
| **合計** | | **~1.5 小時** |

---

## v1 → v2 修訂紀錄（專家審計修正）

| # | 嚴重度 | 問題 | 修正 |
|---|--------|------|------|
| 1 | **MUST FIX** | 樂觀寫入只更新全站快取，per-event 快取看不到新簽到 → 掃碼後紀錄「消失再出現」 | 新增 Phase A 樂觀寫入同步段落 |
| 2 | **MUST FIX** | `getAttendanceRecords` 用 `some()` 檢查記錄內容，空快取會失敗 | 改為比對 `_eventAttendanceEventId`（data.id） |
| 3 | **MUST FIX** | 快速切換活動時 stale callback 覆蓋新活動資料 | 監聽器 callback 加 closure guard `targetDocId` |
| 4 | **MUST FIX** | `_eventAttendanceListenerId` 存 doc.id，`getAttendanceRecords` 收 data.id，不匹配 | 新增 `_eventAttendanceEventId` 追蹤雙 ID |
| 5 | SHOULD FIX | 首次 snapshot 前顯示空表格 | 新增 `_eventAttendanceSnapshotReady` 旗標 + Phase D 載入提示 |
| 6 | SHOULD FIX | 掃碼頁 hook 點未指定 + 需要 `_docId` 查找 | Phase B 明確寫出 `ApiService.getEvent()` 查找 |
| 7 | SHOULD FIX | 快速切頁的讀取浪費 | 可加 debounce（文件建議但非必要） |

---

## 與 Phase 4c / 其他方案的關係

- **Phase 4c（刪根資料）**完成後：全站 limit 500 有效快取從 ~250 提升到 500，per-event 不受影響
- **此優化不依賴 Phase 4c，可以獨立執行**
- 與之前 Phase 3c 移除的 per-event 快取的差異：舊方案用一次性 `.get()` + 手動快取管理（容易失效），本方案用 `onSnapshot` 監聽器 + closure guard + 雙 ID 追蹤（自動管理、即時更新）
