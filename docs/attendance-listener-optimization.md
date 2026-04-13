# 簽到監聽器優化：全站大杯子 → 按需小杯子（v5）

> **📍 狀態**：計劃書 v5（四輪專家審計，Feature Flag 架構，累計 13 個 MUST FIX 全部納入）

## 問題

全站簽到監聽器 `collectionGroup('attendanceRecords').orderBy('createdAt','desc').limit(1500)` 有兩個問題：

1. **舊活動看不到簽到紀錄**：2576 筆 + 根集合重複 = ~5152 筆。limit 1500 + dedup 後只剩 ~750 筆在快取，較舊活動的簽到紀錄被截斷
2. **浪費讀取費用**：每個用戶載入 1500 筆，但只看 1 場活動（~20 筆），99% 白載

## 核心思路

子集合遷移完成後，可以精準監聽**單場活動**的簽到子集合，不需要全站撈。並以 **Feature Flag** 控制新舊方案切換，出問題時從儀表板 1 秒回退。

```
Feature Flag ON（新方案）：
  活動詳情/掃碼頁 → per-event 子集合監聽器（~20 筆，完整、即時）
  其他頁面 → 全站監聽器（limit 500，列表用）

Feature Flag OFF（舊方案，等同目前行為）：
  所有頁面 → 全站監聽器（limit 由儀表板設定）
```

---

## Feature Flag 設計

**Firestore 路徑**：`siteConfig/featureFlags`
**欄位**：`usePerEventAttendanceListener`（布林）

| 值 | 行為 |
|---|------|
| `true` | 活動詳情 / 掃碼頁用 per-event 監聽器，全站監聽器在這兩頁不啟動 |
| `false` 或不存在 | 完全走舊邏輯，所有新程式碼被跳過 |

**回退方式**：Firebase Console 設 `usePerEventAttendanceListener: false` → 下次用戶開啟 App 立即生效，不需改程式碼。

**讀取方式**：`FirebaseService._featureFlags` 在 App 啟動時已從 `siteConfig/featureFlags` 載入（既有機制，零額外成本）。

---

## 消費者清查

| 消費者 | 頁面 | 需要範圍 | 需要即時更新 | 方案（Flag ON） |
|--------|------|----------|-------------|----------------|
| `_renderAttendanceTable` | page-activity-detail | 單場活動 | ✅ | Per-event 監聽器 |
| `_renderScanResults` | page-scan | 單場活動 | ✅ | Per-event 監聽器 |
| `_renderAttendanceSections` | page-scan | 單場活動 | ✅ | 同上 |
| `scan-process.js` | page-scan | 單場活動 | ✅ | 同上 |
| `scan-family.js` | page-scan | 單場活動 | ✅ | 同上 |
| `event-manage.js:460,536` | page-activity-detail | 單場活動 | ✅ | 同上（透過 `getAttendanceRecords` 自動切換） |
| `leaderboard.js` | page-leaderboard | 單一用戶 | ❌ | `ensureUserStatsLoaded`（不受影響） |
| `achievement/evaluator.js` | page-profile | 單一用戶 | ❌ | 同上 |
| `event-manage.js:262` | page-activities（僅管理員） | 全站 | ❌ | 全站監聽器（不受影響） |
| `event-manage-noshow.js:146` | page-activity-detail（僅管理員） | 全站 | ❌ | 同上 |

---

## 實作方案

### Phase A：per-event 監聽器（含 error callback + reconnect）

**新增位置**：`js/firebase-service.js`，`FirebaseService` 物件字面量內部（與 `_realtimeListenerStarted` 同區塊，約 line 104 附近）。

```js
// ═══ 新增 state fields ═══
_eventAttendanceListenerId: null,      // 目前監聽的 eventDocId（Firestore doc.id）
_eventAttendanceEventId: null,         // 對應的 data.id（供 getAttendanceRecords 比對）
_eventAttendanceCache: null,           // per-event snapshot 資料
_eventAttendanceUnsub: null,           // unsubscribe 函式
_eventAttendanceSnapshotReady: false,  // 首次 snapshot 到達旗標
_eventAttendanceReconnectAttempts: 0,  // 錯誤重連計數

// ═══ 啟動 ═══
_startEventAttendanceListener(eventDocId, eventId) {
  if (this._eventAttendanceListenerId === eventDocId) return;
  this._stopEventAttendanceListener();

  this._eventAttendanceListenerId = eventDocId;
  this._eventAttendanceEventId = eventId;
  this._eventAttendanceSnapshotReady = false;

  var targetDocId = eventDocId; // closure guard

  this._eventAttendanceUnsub = db.collection('events').doc(eventDocId)
    .collection('attendanceRecords')
    .onSnapshot(
      function(snapshot) {
        if (this._eventAttendanceListenerId !== targetDocId) return;
        this._eventAttendanceCache = snapshot.docs.map(function(doc) {
          return Object.assign({}, doc.data(), { _docId: doc.id });
        });
        this._eventAttendanceSnapshotReady = true;
        this._eventAttendanceReconnectAttempts = 0;
        this._debouncedSnapshotRender('attendance');
      }.bind(this),
      function(err) {
        if (this._eventAttendanceListenerId !== targetDocId) return;
        this._reconnectEventAttendanceListener(err, targetDocId, eventId);
      }.bind(this)
    );
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
  this._eventAttendanceReconnectAttempts = 0;
},

// ═══ 錯誤重連（exponential backoff，max 5 次）═══
_reconnectEventAttendanceListener(err, targetDocId, eventId) {
  console.warn('[EventAttendance] listener error:', err?.message || err);
  if (this._eventAttendanceReconnectAttempts >= 5) {
    console.error('[EventAttendance] max reconnect reached');
    return;
  }
  this._eventAttendanceReconnectAttempts++;
  var delay = Math.min(1000 * Math.pow(2, this._eventAttendanceReconnectAttempts - 1), 30000);
  delay += Math.random() * 1000;
  var self = this;
  setTimeout(function() {
    if (self._eventAttendanceListenerId !== targetDocId) return;
    var page = typeof App !== 'undefined' ? App.currentPage : '';
    if (page !== 'page-activity-detail' && page !== 'page-scan') return;
    self._startEventAttendanceListener(targetDocId, eventId);
  }, delay);
},
```

---

### Phase A（續）：`getAttendanceRecords` 加 Feature Flag 判斷

**修改位置**：`js/api-service.js`（約 line 904 `getAttendanceRecords`）

```js
getAttendanceRecords(eventId) {
  // Feature Flag ON + per-event 監聽器 active + snapshot 已到
  var usePerEvent = FirebaseService._featureFlags?.usePerEventAttendanceListener;
  if (usePerEvent && eventId
      && FirebaseService._eventAttendanceEventId === eventId
      && FirebaseService._eventAttendanceSnapshotReady) {
    var cache = FirebaseService._eventAttendanceCache || [];
    return cache.filter(function(r) {
      return r.status !== 'removed' && r.status !== 'cancelled';
    });
  }
  // Flag OFF 或 fallback：全站快取（完全等同現有行為）
  var source = this._src('attendanceRecords');
  var active = source.filter(function(r) {
    return r.status !== 'removed' && r.status !== 'cancelled';
  });
  if (eventId) return active.filter(function(r) { return r.eventId === eventId; });
  return active;
},
```

**關鍵**：Flag OFF 時整段 per-event 邏輯被跳過，走完全不變的舊路徑。

---

### Phase A（續）：樂觀寫入同步

`addAttendanceRecord`、`removeAttendanceRecord`、`batchWriteAttendance` 三者在既有全站快取更新後，**額外同步到 per-event 快取**（僅在 Flag ON 且監聽器 active 時）：

```js
// addAttendanceRecord 中，push 全站快取之後加：
if (FirebaseService._eventAttendanceEventId === normalized.eventId
    && FirebaseService._eventAttendanceCache) {
  FirebaseService._eventAttendanceCache.push(normalized);
}

// removeAttendanceRecord 中，設 status='removed' 之後加：
if (FirebaseService._eventAttendanceCache) {
  var peRec = FirebaseService._eventAttendanceCache.find(function(r) { return r.id === record.id; });
  if (peRec) { peRec.status = 'removed'; }
}

// batchWriteAttendance 中，FirebaseService.batchWriteAttendance 成功後加：
if (FirebaseService._eventAttendanceCache) {
  adds.forEach(function(r) {
    if (r.eventId && FirebaseService._eventAttendanceEventId === r.eventId) {
      FirebaseService._eventAttendanceCache.push(r);
    }
  });
  removes.forEach(function(r) {
    if (!FirebaseService._eventAttendanceCache) return;
    var peRec = FirebaseService._eventAttendanceCache.find(function(c) { return c.id === r.id; });
    if (peRec) { peRec.status = 'removed'; }
  });
}
```

---

### Phase B：啟動 / 停止時機（全部 Feature Flag 守衛）

所有啟動/停止呼叫都加 Flag 檢查，Flag OFF 時完全不觸發：

**活動詳情頁**（`showEventDetail`，取得 event 物件後，約 line 265 附近）：

```js
if (FirebaseService._featureFlags?.usePerEventAttendanceListener && e._docId) {
  FirebaseService._startEventAttendanceListener(e._docId, e.id);
}
```

**掃碼頁**——三個啟動點：

```js
// 統一 helper（可放在 scan-ui.js 頂部或 App 物件上）
function _startScanEventListener() {
  if (!FirebaseService._featureFlags?.usePerEventAttendanceListener) return;
  var id = App._scanSelectedEventId;
  if (!id) { FirebaseService._stopEventAttendanceListener(); return; }
  var ev = ApiService.getEvent(id);
  if (ev && ev._docId) FirebaseService._startEventAttendanceListener(ev._docId, ev.id);
}

// 1. renderScanPage 結尾（_updateScanControls() 前）
_startScanEventListener();

// 2. _bindScanEvents select change handler 中
_startScanEventListener();

// 3. _applyScanDateFilter → _populateScanSelect 之後
_startScanEventListener();
```

**離開頁面**（`finalizePageScopedRealtimeForPage`，約 line 687）：

```js
// 既有 if (!needed.has('attendanceRecords')) 區塊內加一行：
this._stopEventAttendanceListener();
```

**前後台 suspend/resume**（`_suspendListeners` 約 line 2552，`_resumeListeners` 約 line 2565）：

```js
// _suspendListeners() 末尾加：
this._stopEventAttendanceListener();

// _resumeListeners() 末尾加（在 schedulePageScopedRealtimeForPage 之後）：
if (FirebaseService._featureFlags?.usePerEventAttendanceListener) {
  var _page = typeof App !== 'undefined' ? App.currentPage : '';
  if (_page === 'page-activity-detail' && App._currentDetailEventId) {
    var _ev = ApiService.getEvent(App._currentDetailEventId);
    if (_ev && _ev._docId) this._startEventAttendanceListener(_ev._docId, _ev.id);
  }
  if (_page === 'page-scan' && App._scanSelectedEventId) {
    var _ev2 = ApiService.getEvent(App._scanSelectedEventId);
    if (_ev2 && _ev2._docId) this._startEventAttendanceListener(_ev2._docId, _ev2.id);
  }
}
```

**Feature Flag 對監聽器的 runtime 抑制**（`_startPageScopedRealtimeForPage`，約 line 645）：

```js
// 在 if (needed.has('attendanceRecords')) this._startAttendanceRecordsListener(); 前加：
if (needed.has('attendanceRecords')
    && FirebaseService._featureFlags?.usePerEventAttendanceListener
    && (pageId === 'page-activity-detail' || pageId === 'page-scan')) {
  // Flag ON + 詳情/掃碼頁 → 跳過全站監聽器，由 per-event 負責
} else if (needed.has('attendanceRecords')) {
  this._startAttendanceRecordsListener();
}
```

> **為什麼不靜態移除 map 條目？** 因為 map 條目是**全局配置**，靜態移除後如果 Flag OFF（回退），這兩頁就完全沒有 attendance 監聽器了。用 runtime 判斷，Flag OFF 時全站監聽器照常啟動。

---

### Phase C：縮小全站監聽器 limit + 儀表板可調

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
2. config.js REALTIME_LIMIT_DEFAULTS ← 程式碼預設 500（fallback）
```

---

### Phase D（可選）：載入中提示

```js
// _renderAttendanceTable（event-manage-attendance.js 約 line 96）開頭加：
if (FirebaseService._featureFlags?.usePerEventAttendanceListener
    && FirebaseService._eventAttendanceEventId === eventId
    && !FirebaseService._eventAttendanceSnapshotReady) {
  container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:1rem;font-size:.82rem">載入簽到紀錄中...</div>';
  return;
}
```

---

## 改動範圍

| 檔案 | 改動 | 風險 |
|------|------|------|
| `js/firebase-service.js` | 新增 listener 函式（含 error + reconnect）+ state fields + `finalizePageScopedRealtimeForPage` 加停止 + `_startPageScopedRealtimeForPage` 加 Flag runtime 抑制 + `_suspendListeners`/`_resumeListeners` 加 per-event 處理 | 中 |
| `js/api-service.js` | `getAttendanceRecords` 加 Flag + per-event 判斷 + `addAttendanceRecord`/`removeAttendanceRecord`/`batchWriteAttendance` 樂觀同步 | 中 |
| `js/modules/event/event-detail.js` | `showEventDetail` 加 Flag-guarded listener start（1 行） | 低 |
| `js/modules/scan/scan-ui.js` + `scan.js` | `renderScanPage` 結尾 + change handler + `_applyScanDateFilter` 後 + helper 函式 | 低 |
| `js/config.js` | `attendanceLimit: 1500 → 500` | 低 |
| `js/modules/event/event-manage-attendance.js` | （可選）Phase D 載入提示 | 低 |

**不需要改的**（v5 關鍵差異）：
- `_pageScopedRealtimeMap` — **不動**（Flag 控制 runtime 行為，不改配置）
- `_collectionPageMap` — **不動**（同上）
- `_renderAttendanceTable` — 不動渲染邏輯
- `ensureUserStatsLoaded` — 不動
- Cloud Functions — 不動

---

## 回退方式

| 情境 | 操作 | 生效時間 |
|------|------|----------|
| 新方案有 bug | Firebase Console 設 `usePerEventAttendanceListener: false` | 用戶下次開啟 App |
| 想恢復舊 limit | Firebase Console 設 `attendanceLimit: 1500` | 同上 |
| 完全移除新程式碼 | git revert（安全——map 未修改，不會靜默故障） | 部署後 |

**v5 vs v4 的關鍵安全差異**：
- v4：靜態移除 map 條目 → 部分回退會造成靜默數據消失
- **v5：map 完全不動 → 無論怎麼回退都安全（最壞情況 = 回到舊行為）**

---

## 效果對比

| 指標 | 現在 | Flag ON |
|------|------|---------|
| 活動詳情頁讀取 | 1500 筆（全站） | **~20 筆**（僅該活動，大型賽事可達 200+） |
| 舊活動簽到紀錄 | ❌ 被截斷 | ✅ 完整 |
| 即時更新 | ✅ | ✅ |
| 全站監聽器讀取 | 1500 筆 | **500 筆**（詳情/掃碼頁不啟動全站監聽器） |
| 記憶體（詳情/掃碼頁） | 1500 筆 | **~20 筆**（僅 per-event） |
| 記憶體（列表/管理頁） | 1500 筆 | **500 筆** |
| 回退方式 | git revert | **儀表板 1 秒** |

---

## 風險評估

| 評估項目 | 內容 |
|----------|------|
| **做了會怎樣** | 舊活動簽到完整 + 省 50-70% 讀取 + 1 秒回退能力 |
| **不做會怎樣** | 舊活動持續看不到簽到，資料增長會更嚴重 |
| **最壞情況** | Feature Flag ON 時 per-event listener 有 bug → 儀表板關掉 Flag → 1 秒恢復舊行為 |
| **影響範圍** | 6 個檔案，~80 行改動 |
| **回退難度** | **零風險** — Flag OFF = 所有新程式碼被跳過，map 未修改 |

---

## 工時預估

| Phase | 內容 | 預估 |
|-------|------|------|
| A | per-event 監聽器 + reconnect + getAttendanceRecords Flag 判斷 + 樂觀寫入同步 | 45 分鐘 |
| B | 啟動/停止時機（detail + scan 3 點 + 離開 + suspend/resume + runtime 抑制） | 25 分鐘 |
| C | 縮小全站 limit | 1 分鐘 |
| D | （可選）載入提示 | 10 分鐘 |
| 測試 + QA | 全套驗收 | 20 分鐘 |
| **合計** | | **~2 小時** |

---

## 部署步驟

1. 部署程式碼（Feature Flag 預設為 OFF → 不影響任何現有行為）
2. 在 Firebase Console `siteConfig/featureFlags` 新增 `usePerEventAttendanceListener: true`
3. 測試驗收（詳情頁、掃碼頁、前後台切換、簽到/取消）
4. 確認無問題 → 完成
5. 有問題 → 設 `usePerEventAttendanceListener: false` → 1 秒恢復

---

## 修訂紀錄

### v1 → v2（第一輪審計）
| # | 嚴重度 | 修正 |
|---|--------|------|
| 1 | MUST FIX | 樂觀寫入同步（add/remove） |
| 2 | MUST FIX | getAttendanceRecords 用 `_eventAttendanceEventId` 比對 |
| 3 | MUST FIX | closure guard 防 stale callback |
| 4 | MUST FIX | 雙 ID 追蹤（eventDocId + eventId） |

### v2 → v3（第二輪審計）
| # | 嚴重度 | 修正 |
|---|--------|------|
| 8 | MUST FIX | `batchWriteAttendance` 樂觀同步 |
| 9 | MUST FIX | 移除雙重監聽器（`_pageScopedRealtimeMap`） |
| 10 | MUST FIX | state fields/method 掛載明確化 |

### v3 → v4（第三輪審計 — 對抗性 + SDK + 事故模擬）
| # | 嚴重度 | 修正 |
|---|--------|------|
| 14 | MUST FIX | onSnapshot error callback + reconnect |
| 15 | MUST FIX | suspend/resume 處理 per-event listener |
| 16 | MUST FIX | `_collectionPageMap` deep-link 快取覆寫 |

### v4 → v5（第四輪審計 — LINE LIFF + 文件完整性 + 回退安全）
| # | 嚴重度 | 修正 |
|---|--------|------|
| 18 | **CRITICAL** | 部分回退造成靜默數據消失 → **改為 Feature Flag 架構** |
| 19 | MUST FIX | 不再靜態移除 map 條目 → runtime Flag 判斷 |
| 20 | MUST FIX | `_startPageScopedRealtimeForPage` 加 Flag runtime 抑制 |
| 21 | HIGH | `_applyScanDateFilter` 補充程式碼（統一 helper） |
| 22 | HIGH | suspend/resume 放置位置明確化（`_resumeListeners` 末尾） |
| 23 | MEDIUM | 工時上調至 2 小時 |
| 24 | MEDIUM | 記憶體估算修正（詳情頁 ~20 筆 vs 列表頁 500 筆） |
