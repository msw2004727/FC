# 簽到監聽器優化：全站大杯子 → 按需小杯子

> **📍 狀態**：計劃書階段，尚未實作

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

## 消費者清查

| 消費者 | 頁面 | 需要範圍 | 需要即時更新 | 方案 |
|--------|------|----------|-------------|------|
| `_renderAttendanceTable` | page-activity-detail | 單場活動 | ✅ 掃碼後立刻更新 | **Per-event 子集合監聽器** |
| `_renderScanResults` | page-scan | 單場活動 | ✅ 掃碼後立刻更新 | **Per-event 子集合監聽器** |
| `_renderAttendanceSections` | page-scan | 單場活動 | ✅ | 同上 |
| `scan-process.js` | page-scan | 單場活動 | ✅ | 同上 |
| `scan-family.js` | page-scan | 單場活動 | ✅ | 同上 |
| `event-manage.js:460,536` | page-activity-detail | 單場活動 | ✅ | 同上 |
| `leaderboard.js` | page-leaderboard | 單一用戶全部 | ❌ 一次性讀取 | `ensureUserStatsLoaded`（已存在，per-user 無 limit） |
| `achievement/evaluator.js` | page-profile | 單一用戶全部 | ❌ | 同上 |
| `event-manage.js:262` | page-activities（僅管理員） | 全站 | ❌ | 保留全站監聽器（大幅縮小 limit） |
| `event-manage-noshow.js:146` | page-activity-detail（僅管理員） | 全站 | ❌ | 同上 |

**結論**：
- **10 個消費者**只需要單場活動資料 → per-event 子集合監聽器
- **2 個消費者**只需要單一用戶資料 → `ensureUserStatsLoaded`（已有，不需改）
- **2 個消費者**需要全站資料（僅管理員）→ 保留全站監聽器但大幅縮小 limit

## 實作方案

### Phase A：新增 per-event 子集合監聽器

**新增位置**：`js/firebase-service.js`

```js
// 概念：進入活動詳情/掃碼頁時，啟動該活動的子集合監聽器
_startEventAttendanceListener(eventDocId) {
  // 已在監聽同一活動 → 跳過
  if (this._eventAttendanceListenerId === eventDocId) return;
  this._stopEventAttendanceListener();
  
  this._eventAttendanceListenerId = eventDocId;
  this._eventAttendanceUnsub = db.collection('events').doc(eventDocId)
    .collection('attendanceRecords')
    .onSnapshot(snapshot => {
      // 更新 per-event 快取
      this._eventAttendanceCache = snapshot.docs.map(doc => ({
        ...doc.data(), _docId: doc.id
      }));
      // 觸發頁面更新
      this._debouncedSnapshotRender('attendance');
    });
},

_stopEventAttendanceListener() {
  if (this._eventAttendanceUnsub) {
    this._eventAttendanceUnsub();
    this._eventAttendanceUnsub = null;
  }
  this._eventAttendanceListenerId = null;
  this._eventAttendanceCache = null;
}
```

**消費端改動**：`js/api-service.js`

```js
getAttendanceRecords(eventId) {
  // 有 per-event 快取且 eventId 匹配 → 優先使用（完整、即時）
  if (eventId && FirebaseService._eventAttendanceCache 
      && FirebaseService._eventAttendanceListenerId) {
    // 確認是同一場活動的快取
    var cache = FirebaseService._eventAttendanceCache;
    var active = cache.filter(r => r.status !== 'removed' && r.status !== 'cancelled');
    if (active.some(r => r.eventId === eventId)) return active;
    // eventId 不匹配（快取是別場活動的）→ fallback 到全站快取
  }
  // fallback：全站快取（limit 截斷的）
  var source = this._src('attendanceRecords');
  var active = source.filter(r => r.status !== 'removed' && r.status !== 'cancelled');
  if (eventId) return active.filter(r => r.eventId === eventId);
  return active;
}
```

### Phase B：啟動/停止時機

**活動詳情頁**：`showEventDetail` 中啟動

```js
// showEventDetail 中，取得 eventDocId 後
FirebaseService._startEventAttendanceListener(e._docId);
```

**掃碼頁**：`renderScanPage` 中啟動

```js
// 選擇活動後
FirebaseService._startEventAttendanceListener(eventDocId);
```

**離開頁面時停止**：`finalizePageScopedRealtimeForPage` 中

```js
// 離開活動詳情 / 掃碼頁時
if (pageId !== 'page-activity-detail' && pageId !== 'page-scan') {
  this._stopEventAttendanceListener();
}
```

### Phase C：縮小全站監聽器 limit

```js
// config.js
const REALTIME_LIMIT_DEFAULTS = {
  attendanceLimit: 200,     // 1500 → 200（只為列表頁的「已簽到」標記）
  registrationLimit: 3000,  // 不變
  eventLimit: 100,          // 不變
};
```

200 筆覆蓋最近 ~100 場活動的簽到（平均每場 2 筆 checkin/checkout），足夠列表頁顯示「已簽到」標記。

**Phase 4c 完成後**：200 筆全是有效的（不被 dedup 砍半），覆蓋更多。

## 改動範圍

| 檔案 | 改動 | 風險 |
|------|------|------|
| `js/firebase-service.js` | 新增 `_startEventAttendanceListener` / `_stopEventAttendanceListener` + 離開頁面時停止 | 低（新增函式，不動既有邏輯） |
| `js/api-service.js` | `getAttendanceRecords` 加 per-event 快取優先判斷 | 低（fallback 保留原邏輯） |
| `js/modules/event/event-detail.js` | `showEventDetail` 中呼叫 `_startEventAttendanceListener` | 低（一行新增） |
| `js/modules/scan/scan.js` 或 `scan-ui.js` | 選擇活動後呼叫 `_startEventAttendanceListener` | 低（一行新增） |
| `js/config.js` | `attendanceLimit: 1500 → 200` | 低（只影響全站快取大小） |

**不需要改的**：
- `_renderAttendanceTable` — 不動（仍讀 `ApiService.getAttendanceRecords`）
- `_debouncedSnapshotRender` — 不動（仍觸發同樣的渲染）
- `ensureUserStatsLoaded` — 不動（per-user 路徑已正常）
- 任何 CF — 不動

## 效果對比

| 指標 | 現在 | 優化後 |
|------|------|--------|
| 用戶開活動詳情頁 Firestore 讀取 | 1500 筆 | **~20 筆**（該活動的簽到） |
| 舊活動看得到簽到紀錄 | ❌ 被截斷 | ✅ 完整（子集合無 limit） |
| 即時更新（掃碼後立刻反映） | ✅ | ✅ |
| 全站監聽器讀取 | 1500 筆 | **200 筆** |
| Firestore 每月讀取成本 | ~$3-8 | **~$0.5-2**（估計省 60-80%） |
| 記憶體 | 1500 筆快取 | ~220 筆（200 全站 + ~20 當前活動） |

## 風險評估

| 評估項目 | 內容 |
|----------|------|
| **做了會怎樣（好處）** | 舊活動簽到紀錄完整顯示 + Firestore 讀取省 60-80% + 記憶體減少 85% |
| **不做會怎樣** | 舊活動持續看不到簽到紀錄，資料越多越嚴重 |
| **最壞情況** | per-event 監聽器在切換活動時沒正確停止 → 同時監聽多場活動 → 多一些讀取（不影響功能，只是多花錢） |
| **影響範圍** | 5 個檔案、~30 行新增程式碼 |
| **回退難度** | 秒回退 — `attendanceLimit` 改回 1500 + 移除 per-event 監聽器呼叫 |
| **歷史教訓** | Phase 3c 移除 per-event 快取時假設子集合遷移解決了 limit 問題，但實際沒有。這次用監聽器（非快取）避免快取失效問題 |

## 工時預估

| Phase | 內容 | 預估 |
|-------|------|------|
| A | 新增 per-event 子集合監聽器 + ApiService 改動 | 30 分鐘 |
| B | 啟動/停止時機（detail + scan + 離開） | 15 分鐘 |
| C | 縮小全站 limit | 1 分鐘 |
| 測試 + QA | 全套驗收 | 15 分鐘 |
| **合計** | | **~1 小時** |

## 與 Phase 4c 的關係

Phase 4c（刪除根集合資料）完成後：
- 全站監聯器 limit 200 → 有效快取從 ~100 提升到 200（dedup 不再砍半）
- per-event 監聽器不受影響（子集合資料完整）
- 可以移除 dedup 過濾器

**此優化不依賴 Phase 4c，可以獨立執行。Phase 4c 是額外加分。**

## 與之前 per-event 快取（Phase 3c 移除的）的差異

| | Phase 3c 移除的舊方案 | 本方案 |
|---|---|---|
| 資料來源 | 一次性 `.get()` 查詢 | **`onSnapshot` 即時監聽** |
| 快取管理 | 需要 Map + 失效邏輯 + 寫入同步 | **監聽器自動管理**（snapshot 整批替換） |
| 即時更新 | ❌ 查完就不更新 | ✅ 有人掃碼立刻反映 |
| 複雜度 | 高（5+ 個元件互動） | 低（2 個函式 + 1 個判斷） |
| 被移除原因 | 快取失效邏輯出問題 | — |
