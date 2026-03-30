# ToosterX — 啟動依賴地圖

> 建立日期：2026-03-19（經三次驗證，第三次發現 event-external-transit.js 降級）
> 最後修訂：2026-03-20（**Steps 1-8 全部完成**，文件狀態同步更新）
> 目的：完整記錄 `App.init()` 啟動流程中的函式呼叫鏈與模組依賴關係，**並分析高併發下的快取瓶頸**，作為載入優化與穩定性改善的基礎。
> ⚠️ 本文件包含實作步驟，換設備 / 換會話時請直接閱讀本文件繼續執行。
> ✅ **2026-03-20 施作狀態**：附錄 C 的 8 個必做步驟（Step 1-8）已全部完成並部署。可選步驟 9-11 尚未實施。

---

## 一、index.html 的 38 個 Script（載入順序）

### 第 1 層：基礎設施（絕對不可動）

| # | 檔案 | 職責 | init() 依賴方式 |
|---|------|------|-----------------|
| 1 | `js/i18n.js` | 多語系字串 | _applyI18nToUI 依賴 |
| 2 | `js/config.js` | 全域常數、ModeManager | 幾乎所有模組依賴 |
| 3 | `js/firebase-config.js` | Firebase SDK 初始化 | Phase 4 Cloud boot |
| 4 | `js/firebase-service.js` | 快取層、資料持久化 | Phase 2 _restoreCache |
| 5 | `js/firebase-crud.js` | CRUD 操作 | 報名等間接依賴 |
| 6 | `js/api-service.js` | Demo/Prod 抽象層 | renderAll → getEvents |
| 7 | `js/line-auth.js` | LINE LIFF 登入 | Phase 4 Cloud boot |
| 8 | `js/core/page-loader.js` | HTML 片段載入 | Phase 1 loadAll |
| 9 | `js/core/script-loader.js` | 動態模組載入器 | 頁面切換時 |
| 10 | `app.js` | 主控制器 | **init() 本體** |
| 11 | `js/core/navigation.js` | 頁面導航 | **bindNavigation, bindDrawer, bindNotifBtn** |
| 12 | `js/core/theme.js` | 主題/UI 綁定 | **bindTheme 等 7 個** |

### 第 2 層：init() 直接依賴（不可動）

| # | 檔案 | init() 呼叫的函式 |
|---|------|-------------------|
| 13 | `js/modules/pwa-install.js` | `initPwaInstall()` — 硬呼叫 |
| 14 | `js/modules/image-cropper.js` | image-upload.js 的依賴 |
| 15 | `js/modules/image-upload.js` | `bindImageUpload()` ×13 — 硬呼叫 |
| 16 | `js/modules/role.js` | `applyRole()` — 硬呼叫 |
| 17 | `js/modules/profile/profile-core.js` | `updatePointsDisplay()` — renderGlobalShell 硬呼叫 |
| 18 | `js/modules/profile/profile-form.js` | `bindLineLogin()` — 硬呼叫 |
| 19 | `js/modules/banner.js` | `renderBannerCarousel()` + `bindFloatingAds()` — 硬呼叫 |
| 20 | `js/modules/announcement.js` | `renderAnnouncement()` — 硬呼叫 |
| 21 | `js/modules/site-theme.js` | `applySiteThemes()` — 硬呼叫 |
| 22 | `js/modules/event/event-list-helpers.js` | event-list-home 的工具函式 |
| 23 | `js/modules/event/event-list-stats.js` | _parseEventStartDate 被多處引用 |
| 24 | `js/modules/event/event-list-home.js` | renderHotEvents 內部依賴 |
| 25 | `js/modules/event/event-list.js` | `renderHotEvents()` 定義在此 — 硬呼叫 |
| 26 | `js/modules/message/message-render.js` | `updateNotifBadge()` + `updateStorageBar()` — renderGlobalShell 硬呼叫 |

### 第 3 層：隱藏的啟動依賴（看似可動，實際不行）

| # | 檔案 | 隱藏依賴原因 |
|---|------|-------------|
| 27 | `js/modules/message/message-inbox.js` | ❌ **定義 `_filterMyMessages()` 和 `_isMessageUnread()`，被 `updateNotifBadge()` 在啟動時呼叫** |

### 第 4 層：延遲渲染依賴（250ms 後的 renderHomeDeferred）

| # | 檔案 | 呼叫方式 | 現有防護 |
|---|------|---------|---------|
| 28 | `js/modules/tournament/tournament-core.js` | renderOngoingTournaments 的資料層 | ✅ `typeof` 防護（Step 3） |
| 29 | `js/modules/tournament/tournament-render.js` | `renderOngoingTournaments()` | ✅ `typeof` 防護（Step 3） |
| 30 | `js/modules/popup-ad.js` | `showPopupAdsOnLoad()` | ✅ `typeof` 防護（Step 3） |

### 第 5 層：可以安全延遲的 Script ✅

> ⚠️ 注意：以下多數 script **不在任何 ScriptLoader group 中**，Phase B 必須先加入 group 再從 index.html 移除。

| # | 檔案 | 安全原因 | 目前在 ScriptLoader group？ |
|---|------|---------|---------------------------|
| 31 | `js/modules/profile/profile-avatar.js` | ✅ 只在 profile 頁用，啟動不呼叫 | ✅ 已在 `profile` group |
| 32 | `js/modules/profile/profile-data-stats.js` | ✅ 只在 profile/titles 頁用 | ✅ 已在 `profile` group |
| 33 | `js/modules/event/event-list-timeline.js` | ✅ 時間軸視圖，非首頁渲染 | ✅ 已在 `activity` group |
| 34 | `js/modules/message/message-line-push.js` | ✅ 推播投遞，Cloud 後才需要 | ❌ 不在任何 group，需加入 |
| 35 | `js/modules/message/message-notify.js` | ✅ 通知範本+投遞，啟動不引用 | ❌ 不在任何 group，需加入 |
| 36 | `js/modules/favorites.js` | ⚠️ _processEventReminders 有 try/catch | ❌ 不在任何 group，需加入 |
| 37 | `js/modules/news.js` | ✅ **已有 `if (this.renderNews)` 防護** | ❌ 不在任何 group，需加入 |

### ❌ 第三次驗證降級：原標安全但實際不可延遲

| 檔案 | 降級原因 |
|------|---------|
| `js/modules/event/event-external-transit.js` (#33→降級) | **event-list-home.js:239（啟動必要 #24）直接硬呼叫 `showExternalTransitCard()`，無防護。event-detail.js:218 也在 `ensureForPage` 之前就呼叫。從 index.html 移除會導致首頁點擊外部活動 crash。且不在任何 ScriptLoader group 中。** |

---

## 二、App.init() 完整呼叫鏈（已驗證）

```
App.init()                              → app.js:136
  │
  ├─ bindSportPicker()                  → js/core/theme.js:100
  ├─ bindNavigation()                   → js/core/navigation.js:280
  ├─ bindDrawer()                       → js/core/navigation.js:663
  ├─ bindTheme()                        → js/core/theme.js:7
  ├─ initFontSize()                     → js/core/theme.js:55
  ├─ initPwaInstall()                   → js/modules/pwa-install.js:10
  ├─ bindFilterToggle()                 → js/core/theme.js:63
  ├─ bindTabBars()                      → js/core/theme.js:81
  ├─ bindTournamentTabs()               → js/core/theme.js:94    (空 stub)
  ├─ bindScanModes()                    → js/core/theme.js:96    (空 stub)
  ├─ bindFloatingAds()                  → js/modules/banner.js:293
  ├─ bindNotifBtn()                     → js/core/navigation.js:757
  ├─ bindLineLogin()                    → js/modules/profile/profile-form.js:7
  ├─ bindImageUpload() ×13              → js/modules/image-upload.js:56
  ├─ _bindAchBadgeUpload?.()            → (lazy loaded, 有 ?.() 防護) ✅
  ├─ _populateAchConditionSelects?.()   → (lazy loaded, 有 ?.() 防護) ✅
  ├─ bindShopSearch?.()                 → (lazy loaded, 有 ?.() 防護) ✅
  ├─ bindTeamOnlyToggle?.()             → (lazy loaded, 有 ?.() 防護) ✅
  ├─ applySiteThemes()                  → js/modules/site-theme.js:172
  ├─ initLangSwitcher()                 → js/core/navigation.js:704
  ├─ _applyI18nToUI()                   → js/core/navigation.js:718
  │
  ├─ renderAll()                        → app.js:192
  │   ├─ renderGlobalShell()            → app.js:199
  │   │   ├─ updateNotifBadge()         → message-render.js:65 → 呼叫 message-inbox.js 的函式
  │   │   ├─ updatePointsDisplay()      → profile-core.js:28
  │   │   └─ updateStorageBar()         → message-render.js:74 → 呼叫 message-inbox.js 的函式
  │   │
  │   ├─ renderHomeCritical()           → app.js:211  (首頁才執行)
  │   │   ├─ renderBannerCarousel()     → banner.js:7
  │   │   ├─ renderAnnouncement()       → announcement.js:13
  │   │   └─ renderHotEvents()          → event-list.js:74
  │   │
  │   └─ _scheduleHomeDeferredRender(250ms)
  │       └─ renderHomeDeferred()       → app.js:219  (idle callback / 250ms 後)
  │           ├─ renderOngoingTournaments()  → tournament-render.js:14
  │           ├─ renderSponsors()            → banner.js:231
  │           ├─ if (this.renderNews) renderNews()  → news.js (有 if 防護 ✅)
  │           ├─ renderFloatingAds()         → banner.js:207
  │           ├─ showPopupAdsOnLoad()        → popup-ad.js:36
  │           └─ startBannerCarousel()       → banner.js:153
  │
  └─ applyRole('user', true)            → role.js:144

--- 啟動末尾的定時任務（app.js:1840-1846）---

  try { _autoExpireAds() } catch(e){}           → ad-manage-core.js（lazy, 有 try/catch ✅）
  try { _processScheduledMessages() } catch(e){} → message-admin.js（lazy, 有 try/catch ✅）
  try { _processEventReminders() } catch(e){}  → favorites.js（#37, 有 try/catch ✅）
  setInterval 同上三者，各 60s / 60s / 300s
```

---

## 三、分類總結（已驗證修正）

### ❌ 絕對不能延遲（28 個）

| # | 檔案 | 致命呼叫 |
|---|------|---------|
| 1 | js/i18n.js | _applyI18nToUI |
| 2 | js/config.js | 全域常數 |
| 3 | js/firebase-config.js | Phase 4 |
| 4 | js/firebase-service.js | Phase 2 |
| 5 | js/firebase-crud.js | CRUD |
| 6 | js/api-service.js | getEvents 等 |
| 7 | js/line-auth.js | Phase 4 |
| 8 | js/core/page-loader.js | Phase 1 |
| 9 | js/core/script-loader.js | 頁面切換 |
| 10 | app.js | init() 本體 |
| 11 | js/core/navigation.js | bindNavigation + bindDrawer + bindNotifBtn |
| 12 | js/core/theme.js | 7 個 bind 函式 |
| 13 | js/modules/pwa-install.js | initPwaInstall() 硬呼叫 |
| 14 | js/modules/image-cropper.js | image-upload 前置依賴 |
| 15 | js/modules/image-upload.js | bindImageUpload ×13 |
| 16 | js/modules/role.js | applyRole |
| 17 | js/modules/profile/profile-core.js | updatePointsDisplay |
| 18 | js/modules/profile/profile-form.js | bindLineLogin |
| 19 | js/modules/banner.js | renderBannerCarousel + bindFloatingAds |
| 20 | js/modules/announcement.js | renderAnnouncement |
| 21 | js/modules/site-theme.js | applySiteThemes |
| 22 | js/modules/event/event-list-helpers.js | event-list-home 依賴 |
| 23 | js/modules/event/event-list-stats.js | _parseEventStartDate |
| 24 | js/modules/event/event-list-home.js | 首頁活動 |
| 25 | js/modules/event/event-list.js | renderHotEvents |
| 26 | js/modules/message/message-render.js | updateNotifBadge + updateStorageBar |
| 27 | js/modules/message/message-inbox.js | **隱藏依賴：_filterMyMessages 被 #26 呼叫** |
| 28 | js/modules/event/event-external-transit.js | **第三次驗證降級：event-list-home.js:239 硬呼叫 showExternalTransitCard** |

### ⚠️ 可延遲但需加防護才安全（3 個）

| # | 檔案 | 延遲條件 | 需要的防護 |
|---|------|---------|-----------|
| 29 | js/modules/tournament/tournament-core.js | 250ms 延遲 renderOngoingTournaments | 加 `if (typeof this.renderOngoingTournaments === 'function')` |
| 30 | js/modules/tournament/tournament-render.js | 同上 | 同上 |
| 31 | js/modules/popup-ad.js | 250ms 延遲 showPopupAdsOnLoad | 加 `if` 防護 |

### ✅ 確定可以安全延遲（7 個）

| # | 檔案 | 安全原因 |
|---|------|---------|
| 32 | js/modules/profile/profile-avatar.js | 只在 profile 頁用，啟動不呼叫 |
| 33 | js/modules/profile/profile-data-stats.js | 只在 profile/titles 頁用 |
| 34 | js/modules/event/event-list-timeline.js | 時間軸視圖，非首頁 |
| 35 | js/modules/message/message-line-push.js | 推播投遞，Cloud 後才需要 |
| 36 | js/modules/message/message-notify.js | 通知範本+投遞，啟動不引用 |
| 37 | js/modules/favorites.js | _processEventReminders 有 try/catch |
| 38 | js/modules/news.js | **已有 `if (this.renderNews)` 防護** |

---

## 四、結論：為什麼優化困難

### 核心數據

- 38 個 script 中，**28 個在啟動時被直接或間接呼叫**（不可動，含 event-external-transit.js 第三次驗證降級）
- **3 個**需加防護後才能延遲
- **7 個**可安全延遲（#32-#38，原為 8 個，event-external-transit.js 降級）
- 延遲 7 個 script ≈ 減少 **18%** 首次載入 script 數量（38→31）
- ⚠️ 7 個中有 4 個不在任何 ScriptLoader group，必須先加入才能移除

### 根本原因

1. **`init()` 是大平面** — 35 個函式呼叫全部平鋪，沒有分群組
2. **`renderGlobalShell()` 強耦合** — 通知 badge + 積分 + 儲存條，啟動時就要顯示
3. **首頁太豐富** — 輪播+公告+活動+賽事+贊助+新聞+廣告
4. **`bindImageUpload` 呼叫 13 次** — 啟動時一次性綁定所有頁面表單
5. **隱藏依賴** — message-inbox.js 的函式被 message-render.js 偷偷引用

---

## 五、高併發情境下的快取瓶頸分析（新增）

> 本節聚焦「突然大量用戶湧入時」可能觸發的快取相關錯誤。
> 第四次驗證中，以原始碼交叉比對確認每個問題的存在與嚴重性。

### 5.1 Service Worker `addAll` 靜默失敗 → 快取雪崩（嚴重度：🔴🔴 P0 — ✅ 已修復 Step 1）

**原始碼位置**：`sw.js:76-83`

```javascript
// sw.js — install 事件
event.waitUntil(
  caches.open(CACHE_NAME).then((cache) => {
    return cache.addAll(STATIC_ASSETS).catch(() => {});  // ← 整批失敗，靜默吞錯
  })
);
self.skipWaiting();
```

**問題 A — all-or-nothing 靜默失敗**：`cache.addAll()` 是 **all-or-nothing** — 其中任何一個 fetch 失敗（CDN 壓力、網路逾時），整個陣列的快取全部放棄。`catch(() => {})` 靜默吞掉錯誤，SW 仍然啟用（`skipWaiting`），但 cache 為空。

**問題 B — ⛔ STATIC_ASSETS 含不存在的檔案（第五次驗證發現）**：

`sw.js:34` 列了 `'./js/core/mode.js'`，但 **此檔案不存在於 repository 中**。`js/core/` 目錄只有 4 個檔案：`navigation.js`、`page-loader.js`、`script-loader.js`、`theme.js`。

**這意味著 `cache.addAll(STATIC_ASSETS)` 每次都必然失敗**（因為 fetch `mode.js` 必返回 404），導致 SW 安裝後 cache 永遠為空。這不是潛在風險，而是**已存在的 bug**。

**問題 C — SW cache key 與 index.html 的 `?v=` 不匹配**：

STATIC_ASSETS 快取的是不帶版本號的 URL（如 `./js/config.js`），但 index.html 實際請求的是帶版本號的 URL（如 `js/config.js?v=20260320e`）。兩者 cache key 不同，因此即使 `addAll` 成功，SW 的 cache-first 策略在匹配 index.html 的請求時也會 miss。

**綜合影響**：SW cache 目前形同虛設 — 既無法成功安裝，即使手動修復 `addAll` 後 cache key 也不匹配。所有靜態資源始終從網路載入。

**✅ 已修復（Step 1, 2026-03-20）**：
1. ✅ 已移除 `./js/core/mode.js`（E1a）
2. ✅ 已改為 `Promise.allSettled` + 逐個 `cache.add()` + 個別錯誤 warn（E1b）
3. ⏳ E1c-alt（帶版本號預快取）為可選步驟 11，尚未實施

> **殘留問題**：STATIC_ASSETS 的 cache key 仍不帶 `?v=`，與 index.html 的 `?v=` 請求不匹配。SW cache-first 對帶版本號的請求會 miss，但 section 4 的 cache-first 策略會在 miss 後從網路載入並快取。這是可接受的行為。

### 5.2 onSnapshot 重連風暴 — 缺少 jitter（嚴重度：🟡 P1 — ✅ 已修復 Step 5）

**原始碼位置**：`firebase-service.js:2064-2162`

```javascript
// 重連延遲公式（三個 listener 共用同一模式）
const delay = Math.min(1000 * Math.pow(2, attempts - 1), 30000);
// → 1s, 2s, 4s, 8s, 16s, 30s（上限），最多 5 次重試
```

**已有的防護**：指數退避（exponential backoff）✅、最大重試次數 5 次 ✅、成功時重置計數器 ✅

**缺少的防護**：**隨機抖動（jitter）** ❌

**併發觸發條件**：大量用戶同時上線 → Firestore WebSocket 連線壓力 → 連線斷開 → 所有用戶的 `onSnapshot` 在**完全相同的時間點**觸發重連（1s 後 → 2s 後 → 4s 後…）→ **Thundering Herd（驚群效應）**。

每一波重連都是同步的，因為所有用戶的退避延遲完全一致。加入 jitter 後，同一波重連會被分散到一個時間窗口內。

**影響的三個 listener**：
- `_reconnectRegistrationsListener()`（報名資料即時同步）
- `_reconnectAttendanceRecordsListener()`（簽到資料即時同步）
- `_reconnectEventsListener()`（活動資料即時同步）

**✅ 已修復（Step 5, 2026-03-20）**：三個 `_reconnect*Listener` 函式已加入 jitter：
```javascript
const baseDelay = Math.min(1000 * Math.pow(2, attempts - 1), 30000);
const delay = Math.round(baseDelay + baseDelay * Math.random() * 0.3); // +0~30% jitter
```

### 5.3 registrations / attendanceRecords / activityRecords 無 limit 全集合載入（嚴重度：🟡 P1）

**原始碼位置**：`firebase-service.js:362-378`

```javascript
_buildCollectionQuery(name, limitCount = 200) {
  // 統計關鍵集合不設 limit，避免截斷導致放鴿子/出席率計算錯誤
  if (name === 'attendanceRecords' || name === 'registrations' || name === 'activityRecords') {
    return db.collection(name);  // ← 全集合載入，無 limit
  }
  return db.collection(name).limit(limitCount);
}
```

**設計原因**：統計系統（出席率、完成場次、放鴿子）需要完整資料，截斷會導致計算錯誤。這是刻意的設計決策。

**併發觸發條件**：用戶數成長 → 這三個集合膨脹 → 每個新用戶開啟活動頁或統計頁時拉取整個集合 → Firestore 讀取量 = `用戶數 × 集合大小` → 讀取配額耗盡或延遲飆升。

**量化估計 — 最壞情況**（localStorage 快取全部失效，所有用戶觸發全量載入）：

以 100 個活動 × 平均 20 人為例：
- registrations: ~2,000 筆文件
- attendanceRecords: ~4,000 筆（每活動 2 次簽到簽退）
- activityRecords: ~2,000 筆
- 每個用戶載入頁面 = 8,000 次 Firestore 讀取
- 50 個用戶同時開啟 = 400,000 次讀取

> 正常情況下，大部分回訪用戶會命中 localStorage 快取（TTL 120 分鐘），不會觸發全量載入。
> 但當 5.4（LS 配額耗盡）或 5.1（SW cache 丟失）同時發生時，回訪用戶也會退化為全量載入。

**現有緩解措施**：
- `_staticReloadMaxAgeMs` 讓集合不會每次頁面切換都重新載入 ✅
- `_collectionLoadedAt` 追蹤載入時間 ✅
- localStorage 快取在 TTL 內不重新查詢 ✅

**不足之處**：
- 首次訪問（無 localStorage 快取）仍然會觸發全集合載入
- `_restoreCache()` 恢復失敗（見 5.4）時，也會觸發全集合載入
- onSnapshot listener 斷線重連後會收到整個集合的 snapshot

**建議修復方向**：
- 對 registrations 改為按活動 ID 查詢（`where('eventId', '==', currentEventId)`），全域統計改由 Cloud Function 預計算
- 對 attendanceRecords/activityRecords 改為按用戶查詢（已有 `ensureUserStatsLoaded` 機制，可擴大使用範圍）
- ⚠️ 此改動涉及統計系統鎖定函式，需特別審查

### 5.4 localStorage 配額耗盡靜默失敗（嚴重度：🟡 P1 — ✅ 已修復 Step 8）

**原始碼位置**：`firebase-service.js:134-141`

```javascript
_saveToLS(name, data) {
  try {
    const json = JSON.stringify(data);
    if (json.length > 512000) return;        // 單一集合 > 500KB 跳過
    localStorage.setItem(this._getLSKey(name), json);
  } catch (e) { /* quota exceeded — 忽略 */ }  // ← 靜默失敗
},
```

**已有的防護**：單一集合 500KB 上限 ✅

**不足之處**：
- `catch (e) {}` 靜默吞掉 `QuotaExceededError`，不留痕跡
- localStorage 總配額通常為 5MB（LINE WebView 可能更低）
- 30+ 個集合共用 5MB，個別集合未超 500KB 但加總超過總配額時，**後面存入的集合會靜默失敗**
- 下次 `_restoreCache()` 恢復的集合數量不足（`restored > 3` 閥值），導致判定快取無效 → 觸發 Firestore 全量載入

**併發觸發條件**：用戶數成長 → registrations/attendanceRecords 增大 → 逐步擠壓其他集合的 localStorage 空間 → 某天突然大量用戶湧入 → 所有用戶的 `_restoreCache()` 失敗 → 全部穿透到 Firestore

**✅ 已修復（Step 8, 2026-03-20）**：
- ✅ 外層 try-catch 包裹 `JSON.stringify`，防止序列化失敗冒泡
- ✅ 寫入失敗時 log warning
- ✅ 保守淘汰策略：只刪除 `newsArticles` / `gameConfigs` 兩個非 boot 集合
- ✅ 淘汰後重試寫入，仍失敗則放棄但不刪更多集合

### 5.5 `_persistCache()` 的 30 秒 debounce — 頁面關閉時丟失資料（嚴重度：🟡 P2 — ✅ 已修復 Step 2）

**原始碼位置**：`firebase-service.js:151-155`

```javascript
_debouncedPersistCache() {
  clearTimeout(this._persistDebounceTimer);
  this._persistDebounceTimer = setTimeout(() => this._persistCache(), 30000);
},
```

**設計原因**：onSnapshot 高頻觸發時避免重複 I/O，30 秒 debounce 合理。

**問題**：如果用戶在最後一次 onSnapshot 觸發後 30 秒內關閉頁面（LINE WebView 中切換聊天室非常常見），最後一批更新**永遠不會持久化到 localStorage**。下次開啟看到的是舊資料。

**✅ 已修復（Step 2, 2026-03-20）**：在 `_setupVisibilityRefresh()` 中加入 pagehide + visibilitychange hidden 雙重持久化：
```javascript
window.addEventListener('pagehide', () => {
  clearTimeout(this._persistDebounceTimer);
  this._persistCache();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearTimeout(this._persistDebounceTimer);
    this._persistCache();
  }
});
```

### 5.6 visibilitychange 觸發頻率控制（嚴重度：🟢 P3 — 已有防護）

**原始碼位置**：`firebase-service.js:2007-2059`

**已有的防護**（第四次驗證確認）：
- 1 秒 debounce（`_visibilityRefreshDebounce`）✅
- `_registrationsRevalidating` 防止並行查詢競爭 ✅
- 若 registrations listener 已活躍則跳過一次性查詢 ✅
- 只在 `auth?.currentUser` 存在時才執行 ✅

**評估**：此處的防護已經足夠。唯一可能的改善是在 debounce 時間上加入漸進式延長（頻繁切換時逐步延長 debounce 時間），但目前不是瓶頸。

### 5.7 SW 版本號與 config.js CACHE_VERSION 雙軌不同步風險（嚴重度：🟡 P2）

**現狀**（2026-03-20 更新）：
- `sw.js:9` → `CACHE_NAME = 'sporthub-20260320ab'`（SW 版本，Step 1-8 期間已同步更新）
- `js/config.js` → `CACHE_VERSION = '20260320ab'`（前端快取版本）
- 目前兩者已同步，但屬手動維護，仍有不同步風險

**CLAUDE.md 已說明**：「`sw.js` 的 `CACHE_NAME` 只有在需要強制清除所有 SW 快取時才一併更新」。

**潛在問題**：
- 部署時更新了 `CACHE_VERSION`（index.html 的 `?v=` 全部更新），但 SW 的 `CACHE_NAME` 沒變
- SW 的 cache-first 策略（`sw.js:166-179`）先查快取 → 找到舊版 `script.js?v=舊版` → 回傳舊版
- 但新的 index.html 引用 `script.js?v=新版`（不同 URL）→ cache miss → 從網路載入新版
- **實際上不會衝突**：因為 `?v=` 參數不同，SW 的 cache key 也不同，舊版和新版是兩個不同的 cache entry ✅

**真正的問題**：舊版的 cache entry **不會被清理**（除非 `CACHE_NAME` 變更觸發 activate 清除）。隨時間積累，SW cache 會膨脹。

**建議修復方向**：
- 考慮在 SW activate 時清理同一 `CACHE_NAME` 內的舊版號 entry
- 或在 `CACHE_VERSION` 更新時同步更新 `CACHE_NAME`，統一版本管理

### 5.8 `_restoreCache()` 回傳值被忽略（嚴重度：🟡 P2 — 第五次驗證發現）

**原始碼位置**：`firebase-service.js:1420`

```javascript
async init() {
  // ── Step 1: 嘗試從 localStorage 恢復快取 ──
  this._restoreCache();  // ← 回傳值被丟棄，不檢查是否成功
  // ... 後續流程無論成功失敗都繼續
}
```

**`_restoreCache()` 回傳值**：
- 回傳 `false`：TTL 過期 或 恢復的集合數 ≤ 3
- 回傳 `true`：成功恢復 > 3 個集合

**問題**：init() 完全忽略回傳值。當恢復失敗時：
- `_cache` 可能為空或只有 1-2 個集合
- 後續 `renderAll()` 在 Firestore 回應前就執行 → 用戶看到空白或部分內容
- 沒有任何日誌記錄恢復失敗，管理員無從得知

**與 5.4（localStorage 配額耗盡）的連鎖**：配額爆掉 → 部分集合寫入失敗 → 下次 `_restoreCache()` 恢復不足 3 個 → 回傳 false → 被忽略 → 觸發 Firestore 全量載入

**建議修復方向**：
```javascript
const cacheRestored = this._restoreCache();
if (!cacheRestored) {
  console.warn('[FirebaseService] localStorage 快取恢復失敗，將從 Firestore 全量載入');
  // 可選：記錄到 errorLogs，讓管理員追蹤
}
```

### 5.9 `clear=1` 參數未清除 localStorage 快取（嚴重度：🟡 P2 — ✅ 已修復 2026-03-20）

**原始碼位置**：`index.html:94-112`

**`clear=1` 目前清除的範圍**：
- ✅ 所有 Service Worker caches
- ✅ 所有 Service Worker registrations
- ✅ 2 個特定 localStorage key（`sporthub_auto_exp_rules`、`sporthub_auto_exp_logs`）

**`clear=1` 未清除的範圍**：
- ❌ 30+ 個 `shub_c_*` localStorage 集合快取
- ❌ UID 前綴的快取 key（`shub_c_{uid}_*`）
- ❌ 時間戳 key（`shub_cache_ts`、`shub_ts_{uid}`）
- ❌ currentUser 快取資料

**另有版本不符處理器**（`index.html:106-110`）：當 `localStorage.sporthub_cache_ver` 與當前版本不一致時，會清除 SW caches + registrations，但**同樣不清除 `shub_c_*` localStorage**。

**問題**：用戶或管理員使用 `?clear=1` 期望「清除所有快取重新開始」，但 localStorage 中的舊資料仍然存在。下次訪問時 `_restoreCache()` 恢復的是舊的 localStorage 資料，不是 Firestore 最新資料。

**建議修復方向**：在 `clear=1` handler 中加入 localStorage 全面清理：
```javascript
// 清除所有 shub_ 前綴的 localStorage
Object.keys(localStorage).forEach(k => {
  if (k.startsWith('shub_c_') || k.startsWith('shub_ts_') || k.startsWith('shub_cache_')) {
    try { localStorage.removeItem(k); } catch(e) {}
  }
});
```

### 5.10 FirebaseService.init() 的 6 秒逾時 — 成功也可能是危險訊號（嚴重度：🟢 P3）

**原始碼位置**：`firebase-service.js:1447-1484`

```javascript
// 6 秒逾時保護
const timeoutPromise = new Promise(resolve =>
  setTimeout(() => resolve('TIMEOUT'), 6000)
);
```

**併發觸發條件**：大量用戶同時首次訪問 → Firestore 回應延遲 → 更多用戶命中 6 秒逾時 → `_initialized = true` 但 `_cache` 為空或不完整 → 前端渲染空白或缺失 → 用戶手動刷新 → 再次觸發全量查詢 → **惡性循環**

**已有的防護**：逾時後仍然標記 `_initialized = true`，允許後續的 `ensureCollectionsForPage` 按需補充載入 ✅

**不足之處**：逾時發生時 **沒有記錄**到 errorLogs，管理員無法知道有多少用戶遇到了逾時。

### 5.11 Firebase SDK CDN 載入失敗 → 用戶體驗降級（嚴重度：🟡 P2 — 第六次新增，第七次驗證修正）

**原始碼位置**：`firebase-config.js:70-141` + `app.js:1405-1409`

**已有的防護**（第七次驗證確認）：
- `app.js:1407` 有 `if (!initFirebaseApp()) { throw new Error('FIREBASE_APP_INIT_FAILED'); }` ✅
- `ensureCloudReady()` 外層有 try-catch ✅
- CDN 載入由 `_loadCDNScripts()` 處理（line 1406），有獨立的逾時機制 ✅

> ⛔ **第七次驗證修正**：原 5.11 宣稱「回傳值被忽略」是**事實錯誤** — 實際程式碼有完整的檢查與錯誤拋出機制。嚴重度從 🔴🔴 P0 降級為 🟡 P2。

**殘餘問題**：CDN 載入失敗時，`ensureCloudReady` 拋出錯誤 → 被外層 catch 捕獲 → 但用戶看到的錯誤提示可能不夠友善（顯示為通用載入失敗）。這是 UX 問題，不是崩潰問題。

**建議**：可考慮在 CDN 失敗時顯示更明確的提示（如「網路連線異常，請稍後再試」），但不是阻斷性 bug。

### 5.12 App.init() 無錯誤邊界 → 單一失敗拖垮全局（嚴重度：🟡 P1 — ✅ 已修復 Step 3）

**原始碼位置**：`app.js:136-172`

**問題**：`init()` 中 35 個函式呼叫**沒有任何 try-catch**。如果其中任何一個拋出例外（例如某個 `<script defer>` 載入失敗導致函式未定義），整個 `init()` 中止，後續的 `renderAll()` 和 `applyRole()` 都不會執行 → 用戶看到半成品頁面。

**這與 Phase A 的 `?.()` 互補**：`?.()` 防止「函式不存在」的 crash，但無法防止「函式存在但內部拋出例外」。兩者應同時實施。

**✅ 已修復（Step 3, 2026-03-20）**：init() 已拆為三段：
1. 核心 UI（硬呼叫，失敗 = 致命）
2. 非核心模組（`?.()` + try-catch，失敗不影響核心渲染）
3. 核心渲染（`_applyI18nToUI` + `renderAll` + `applyRole`，不受上方錯誤影響）

### 5.13 FirebaseService.init() 重複呼叫 → 監聽器洩漏（嚴重度：🟡 P1 — ✅ 已修復 Step 4）

**原始碼位置**：`firebase-service.js:1410-1521`

**問題**：`init()` 在 line 1411 有 `if (this._initialized) return;` 防護 ✅。但 `_initialized` 要到 line 1510 才設為 `true`（init 流程結束）。如果網路慢（>6s），init 還在進行中時被第二次呼叫：
- `this._initialized` 仍為 `false`（尚未設定）
- 第二次 init 開始平行執行
- 兩個 `_setupVisibilityRefresh()` → 兩個 `visibilitychange` handler 加到 document
- 兩個 `auth.onAuthStateChanged()` → 重複的 auth 觀察者
- 結果：記憶體洩漏 + 資料競爭

**已有的部分防護**：`App._cloudReadyPromise`（**app.js** line 1400）防止 `ensureCloudReady` 重複進入 ✅。但如果有其他路徑直接呼叫 `FirebaseService.init()` 則防護無效。

**建議修復方向**：
```javascript
// 在 init() 開頭加入 inflight 防護（需初始化 _initInFlight: false 在物件定義中）
async init() {
  if (this._initialized) return;
  if (this._initInFlight) return;  // ← 新增：防止平行 init，直接返回不等待
  this._initInFlight = true;
  try {
    // ... 原有的 init 邏輯保持不動 ...
    this._initialized = true;
  } finally {
    this._initInFlight = false;
  }
}
```
> 第七次驗證修正：原版使用 `return this._initPromise` 但未賦值該屬性。簡化為直接 return（不等待第一次 init 完成），因為 `App._cloudReadyPromise`（app.js:1400）已經在更上層防止重複進入。

### 5.14 onSnapshot 監聽器在長時間工作階段中累積（嚴重度：🟡 P1 — 第六次驗證新增）

**原始碼位置**：`firebase-service.js:2164-2202`（destroy 函式）

**問題**：`destroy()` 會清除所有監聽器 ✅，但 `destroy()` **不會在頁面關閉時自動呼叫**。在 SPA 式的頁面切換中：
- 用戶切到活動頁 → `_startRegistrationsListener()` 註冊監聽器
- 用戶切到其他頁 → `_stopRegistrationsListener()` 應該被呼叫
- 但如果停止邏輯有遺漏（如切頁時未觸發清理），舊監聽器仍在 WebSocket 上

**已有的防護**：`_realtimeListenerStarted[key]` 旗標防止同一 key 重複註冊 ✅。每次停止時重設旗標 ✅。

**實際風險評估**：因為有 `_realtimeListenerStarted` 旗標，此問題的影響範圍有限。但在 LINE WebView 中長時間掛著不關（LINE 聊天室切來切去但 WebView 不被殺），可能累積 idle 的 WebSocket 連線。

**建議**：此項風險可接受，暫不需修復。記錄為未來監控項目。

### 5.15 LINE WebView localStorage 配額限制（嚴重度：🟡 P1 — 第六次驗證新增）

**原始碼位置**：`firebase-service.js:91-95`（TTL 設定）

**問題**：一般瀏覽器 localStorage 配額約 5MB，但 **LINE WebView（iOS）可能只有 ~1MB**。ToosterX 快取 30+ 個集合：
- 大型集合（registrations、attendanceRecords）各可達 200-400KB
- 兩三個大集合就會吃掉 LINE WebView 的全部配額
- `_saveToLS()` 在 catch 中靜默失敗（見 5.4）
- 後續 `_restoreCache()` 恢復不完整
- 但 `restored > 3` 閥值可能仍然通過（boot 集合小，容易恢復 5+ 個）→ 誤判「快取有效」
- 結果：首頁秒開但某些頁面（統計、排行榜）資料缺失

**與 5.4 的區別**：5.4 討論的是正常瀏覽器（5MB）的配額耗盡；5.15 討論的是 LINE WebView（~1MB）的配額根本不夠用。

**建議修復方向**：
- 偵測 LINE WebView 環境（User-Agent 包含 `Line`）
- 在 LINE WebView 中降低快取策略：只快取 boot 集合 + 當前頁面必要集合
- 或改用 IndexedDB（配額通常更大且可申請更多空間）

### 5.16 localStorage UID 前綴競爭 — 共用裝置的資料洩漏風險（嚴重度：🟡 P2 — ✅ 已隨 5.9 修復 2026-03-20）

**原始碼位置**：`firebase-service.js:193-200`

```javascript
// _restoreCache() 中的 UID 前綴恢復邏輯（line 193-200）
if (!this._lsUidPrefix) {
  const raw = localStorage.getItem(this._LS_PREFIX + 'currentUser');
  const saved = raw ? JSON.parse(raw) : null;
  if (saved && saved.uid) {
    this._setLSUidPrefix(saved.uid);  // ← 用上次登入的 UID
  }
}
```

**問題**：在共用裝置情境下：
1. 用戶 A 登入 → localStorage 存入 `shub_c_{A-uid}_*` 的快取
2. 用戶 A 使用 `?clear=1` 登出 → 但 `clear=1` 不清除 `shub_c_*` 集合（見 5.9）
3. 用戶 B 在同一裝置開啟 → `_restoreCache()` 讀到 `currentUser` → 用戶 A 的 UID
4. 設定 `_lsUidPrefix = A-uid` → 從 localStorage 恢復用戶 A 的快取
5. 用戶 B 短暫看到用戶 A 的資料（活動、報名、個人資料）
6. Auth 狀態恢復後（line 855）才會發現 UID 不符 → 重新載入

**影響**：隱私風險，雖然持續時間短（秒級），但可能顯示敏感資料。

**建議修復方向**：在 `_restoreCache()` 中加入 UID 比對：
```javascript
// 等待 auth 狀態確認後再恢復 UID 前綴快取
// 或在 clear=1 handler 中一併清除 shub_c_* keys（見 5.9 修復）
```
> 此問題的根本修復是 5.9（`clear=1` 完整清除），修好 5.9 後此問題自動消失。

### 5.17 ApiService-FirebaseService 競態 — renderAll 可能在 _cache 填充前執行（嚴重度：🔴 P1 — ✅ 已修復 Step 6）

**原始碼位置**：`app.js:136-172`（init）→ `app.js:192`（renderAll）→ `api-service.js`

**問題**：`App.init()` 的執行流程：
1. 同步呼叫 `renderAll()`（line 170）
2. `renderAll()` → `ApiService.getEvents()` → 判斷 Demo/Prod
3. Prod 模式下，`ApiService` 呼叫 `FirebaseService._cache.events`
4. 但此時 `FirebaseService.init()` 可能尚未完成（它是非同步的，在 `ensureCloudReady()` 中等待）

**實際流程分析**：
- `renderAll()` 在 `init()` 同步區段執行，此時 `_cache` 可能只有 `_restoreCache()` 從 localStorage 恢復的資料
- 如果是首次訪問（無 localStorage 快取），`_cache` 為空 → `getEvents()` 回傳空陣列 → 首頁活動列表空白
- Cloud 資料載入完成後，`onSnapshot` 會更新 `_cache`，但**不會自動觸發重新渲染**（除非用戶切頁再回來）

**影響**：首次訪問用戶可能看到空白首頁，直到 Cloud 資料就緒並觸發重新渲染。回訪用戶有 localStorage 快取所以不受影響。

**✅ 已修復（Step 6, 2026-03-20）**：`renderHotEvents()` 的 `visible.length === 0` 分支加入 `_cloudReady` 判斷：
- `!_cloudReady` → 顯示「載入中…」提示，不清空
- `_cloudReady` + 真的沒活動 → 正常清空
- Cloud 就緒後 `renderAll()` 和 `onSnapshot` 回調會覆蓋 loading 狀態

### 5.18 page-loader.js 缺少 HTTP 錯誤恢復（嚴重度：🟡 P1 — ✅ 已修復 Step 7）

**原始碼位置**：`js/core/page-loader.js`

**問題**：`page-loader.js` 載入 HTML 片段時使用 `fetch(pages/{name}.html?v=${CACHE_VERSION})`，但：
1. **未檢查 HTTP 狀態碼**：404（片段不存在）、503（伺服器過載）時，`response.ok` 為 false 但不會拋出例外
2. **無重試機制**：CDN 暫時故障時直接失敗
3. **無降級策略**：載入失敗時頁面區域顯示空白，無用戶提示

**在高併發場景下的影響**：
- CDN 短暫過載 → 片段 fetch 回傳 503 → 用戶看到空白頁面
- 與 5.1（SW cache 失效）組合時，每次頁面切換都直接打 origin → 壓力倍增

**✅ 已修復（Step 7, 2026-03-20）**：3 處 fetch 加入 `if (!r.ok)` 檢查：
- `_loadSingleFile`：HTTP 錯誤時回傳空字串
- `loadAll` bootPages：HTTP 錯誤時回傳空字串
- `loadAll` modals：HTTP 錯誤時回傳空字串

---

## 六、分階段實作計劃

> ⚠️ **鐵律**：每個 Phase 獨立完成+部署+驗證，確認無問題才進下一個 Phase。
> 絕對不可跨 Phase 合併。每個 Phase 都是一個獨立 commit。

---

### Phase A：加防護網（零風險，不改載入順序）

**目的**：讓 init() 中所有非核心呼叫容錯，為後續 Phase 鋪路。

**改動檔案**：`app.js`

**具體做法**：在 `init()` 中，**保持原有函式順序不變**，僅將非核心呼叫加上 `?.()` 防護：

> ⚠️ **第六次驗證修正**：原版將函式重新分群排列，但實際 init() 中 `initPwaInstall()` 和 `bindFloatingAds()` 穿插在核心 UI 呼叫中間。**禁止重新排序**，只能原地加 `?.()` — 改變順序可能引入未預期的時序依賴問題。

```javascript
// app.js init() — Phase A 改動（原地修改，不改順序）
init() {
  this.bindSportPicker();                    // 核心 UI — 保持硬呼叫
  this.bindNavigation();                     // 核心 UI — 保持硬呼叫
  this.bindDrawer();                         // 核心 UI — 保持硬呼叫
  this.bindTheme();                          // 核心 UI — 保持硬呼叫
  this.initFontSize();                       // 核心 UI — 保持硬呼叫
  this.initPwaInstall?.();                   // ← 改 ?.()（非核心，PWA 安裝按鈕）
  this.bindFilterToggle();                   // 核心 UI — 保持硬呼叫
  this.bindTabBars();                        // 核心 UI — 保持硬呼叫
  this.bindTournamentTabs();                 // 核心 UI — 保持硬呼叫（空 stub）
  this.bindScanModes();                      // 核心 UI — 保持硬呼叫（空 stub）
  this.bindFloatingAds?.();                  // ← 改 ?.()（非核心，浮動廣告）
  this.bindNotifBtn();                       // 核心 UI — 保持硬呼叫
  this.bindLineLogin();                      // 核心 UI — 保持硬呼叫

  this.bindImageUpload?.('ce-image', 'ce-upload-preview', 16/9);  // ← 每個都加 ?.()
  // ... 13 個 bindImageUpload 都改成 ?.()（已有內建 DOM 偵測，?.() 是額外保險）
  this.bindImageUpload?.('theme-image', 'theme-preview', 0);

  this._bindAchBadgeUpload?.();              // 已有 ?.()，保留
  this._populateAchConditionSelects?.();     // 已有 ?.()，保留
  this.bindShopSearch?.();                   // 已有 ?.()，保留
  this.bindTeamOnlyToggle?.();              // 已有 ?.()，保留
  this.applySiteThemes?.();                  // ← 改 ?.()（非核心，主題裝飾）
  this.initLangSwitcher?.();                 // ← 改 ?.()（非核心，語言切換器）
  this._applyI18nToUI();                     // 核心 UI — 保持硬呼叫

  this.renderAll();                          // 核心渲染 — 保持硬呼叫
  this.applyRole('user', true);              // 核心權限 — 保持硬呼叫
},
```

**⚠️ `?.()` 的限制（第四次驗證補充）**：

`?.()` 只能防止「函式不存在」的情況（即模組未載入）。它**無法防止**「函式存在但內部依賴缺失」的情況。例如：
- `bindImageUpload`（#15）內部呼叫 `ImageCropper`（#14 定義）
- 如果未來有人把 `image-cropper.js` 也改為延遲載入，`bindImageUpload?.()` 會通過 `?.()` 檢查（函式存在），但執行時拋出 `ImageCropper is not defined`

**規則**：`?.()` 防護只適用於「整個模組可能不存在」的情況。對於有**跨模組內部依賴**的函式（如 #14 → #15），兩者必須保持同步載入，不能只對外層加 `?.()` 就以為安全。

**同時**在 `renderHomeDeferred()` 加防護：

```javascript
renderHomeDeferred() {
  if (!this._isHomePageActive()) return false;
  if (typeof this.renderOngoingTournaments === 'function') this.renderOngoingTournaments();  // ← 加防護
  this.renderSponsors();                                      // banner.js 定義，永遠存在
  if (this.renderNews) this.renderNews();                     // ← 已有防護 ✅
  this.renderFloatingAds();                                   // banner.js 定義，永遠存在
  if (typeof this.showPopupAdsOnLoad === 'function') this.showPopupAdsOnLoad();  // ← 加防護
  this.startBannerCarousel();                                 // banner.js 定義，永遠存在
  return true;
},
```

**風險評估**：零風險。只加入防護，不改載入順序，不改函式邏輯。
**工作量**：~30 分鐘，改動僅限 `app.js`。

**驗證方式**：
1. 本地開啟首頁，確認所有功能正常
2. 開 DevTools Console 確認無新增 error
3. 點各頁面確認圖片上傳、登入按鈕、主題切換正常

**commit message**：`啟動優化 Phase A：init() 非核心呼叫加 ?.() 防護網`

---

### Phase B：移除 7 個安全 script（低風險）

**目的**：把 7 個確認安全的 script 從 index.html 移除，改由 ScriptLoader 動態載入。

**前置條件**：Phase A 已完成並驗證

**改動檔案**：
1. `js/core/script-loader.js` — **先**將不在 group 中的 script 加入對應 group
2. `index.html` — **然後**移除 7 個 `<script>` 標籤

**⚠️ 執行順序很重要：必須先加 group 再移除 script tag，否則移除後永遠無法載入！**

**`_primeLoadedFromDom` 路徑匹配安全性（第四次驗證確認）**：

ScriptLoader 使用 `_normalizeLocalSrc()` 將 `<script src>` 的完整 URL 正規化為本地路徑（去掉 origin、`?v=` 參數）。group 中的路徑也是本地相對路徑。因此：
- index.html 中的 `<script src="js/foo.js?v=20260320e">` → 正規化為 `js/foo.js`
- group 中的 `'js/foo.js'` → 直接匹配

**結論**：`?v=` 參數不會影響匹配，重複載入問題不存在 ✅

**要移除的 7 個 script 與 group 狀態**：

| 檔案 | 目前在 group？ | 需要加入的 group |
|------|--------------|----------------|
| `js/modules/profile/profile-avatar.js` | ✅ 已在 `profile` | 不需改 |
| `js/modules/profile/profile-data-stats.js` | ✅ 已在 `profile` | 不需改 |
| `js/modules/event/event-list-timeline.js` | ✅ 已在 `activity` | 不需改 |
| `js/modules/message/message-line-push.js` | ❌ 不在任何 group | 加入 `activity` + `message` |
| `js/modules/message/message-notify.js` | ❌ 不在任何 group | 加入 `activity` + `message`（在 line-push 之後） |
| `js/modules/favorites.js` | ❌ 不在任何 group | 加入 `activity` |
| `js/modules/news.js` | ❌ 不在任何 group | 加入 `activity` |

**⛔ 不移除 `event-external-transit.js`**：第三次驗證發現 event-list-home.js:239 直接硬呼叫 `showExternalTransitCard()`，移除會 crash。

**script-loader.js 具體改動**：

```javascript
// _groups.activity — 在現有陣列的適當位置插入 4 個新 script
activity: [
  'js/modules/auto-exp.js',
  'js/modules/favorites.js',                    // ← 新增（靠前，無前置依賴）
  'js/modules/event/event-list-helpers.js',      // 已有
  'js/modules/event/event-list-stats.js',        // 已有
  'js/modules/event/event-list-home.js',         // 已有
  'js/modules/event/event-list-timeline.js',     // 已有
  'js/modules/event/event-list.js',              // 已有
  'js/modules/event/event-share-builders.js',    // 已有
  'js/modules/event/event-share.js',             // 已有
  // ... 其他現有 event 模組保持不動 ...
  'js/modules/registration-audit.js',            // 已有（尾部）
  'js/modules/message/message-line-push.js',     // ← 新增（notify 依賴它，必須在前）
  'js/modules/message/message-notify.js',        // ← 新增
  'js/modules/news.js',                          // ← 新增（放最後）
],

// _groups.message — 在現有陣列 "前面" 插入 2 個新 script
message: [
  'js/modules/message/message-line-push.js',     // ← 新增
  'js/modules/message/message-notify.js',        // ← 新增
  'js/modules/message/message-actions.js',       // 已有
  'js/modules/message/message-actions-team.js',  // 已有
  'js/modules/message/message-inbox.js',         // 已有
],

// _groups.profile — 不需改，profile-avatar.js 和 profile-data-stats.js 已在其中
```

**⚠️ 特別注意**：
- `message-notify.js` 依賴 `message-line-push.js`（見檔案頂部註解），載入順序必須先 push 後 notify
- `favorites.js` 定義 `_processEventReminders`，啟動時有 try/catch 保護，不載入也不 crash
- `news.js` 的 `renderNews` 已有 `if (this.renderNews)` 防護
- `ScriptLoader._primeLoadedFromDom()` 會標記已在 index.html 中的 script 為 loaded，所以 group 中重複出現的路徑不會被重複載入

**風險評估**：低風險。移除的 7 個 script 都經過三次驗證確認不在啟動路徑上。
**工作量**：~1 小時，改動 `script-loader.js` + `index.html` + 版本號更新。

**驗證清單**：
1. ✅ 首頁：輪播、公告、活動列表、賽事正常顯示
2. ✅ 首頁 news 區塊：延遲渲染後正常出現（或不出現但不報錯）
3. ✅ 點活動列表 → 時間軸視圖正常
4. ✅ **點外部活動 → 中繼卡片正常**（event-external-transit.js 仍在 index.html）
5. ✅ 點個人資料 → 頭像、統計正常
6. ✅ 收到訊息 → 通知功能正常
7. ✅ 分享活動 → LINE 推播正常
8. ✅ 收藏活動功能正常（favorites.js 在 activity group 中被載入）
9. ✅ Console 無新增 error

**commit message**：`啟動優化 Phase B：7 個非啟動 script 改動態載入（38→31）`

---

### Phase C：延遲渲染區塊動態載入（中風險）

**目的**：把 renderHomeDeferred 依賴的 3 個模組也改為動態載入。

**前置條件**：Phase A + B 已完成並驗證

**要移除的 3 個 script（從 index.html 刪除）**：

| 檔案 | 目前在 group？ | 需要加入的 group |
|------|--------------|----------------|
| `js/modules/tournament/tournament-core.js` | ❌ **不在** tournament group（group 只有 detail/friendly/share） | 加入 `tournament` group 開頭 |
| `js/modules/tournament/tournament-render.js` | ❌ **不在** tournament group | 加入 `tournament` group（在 core 之後） |
| `js/modules/popup-ad.js` | ❌ 不在任何 group | 新建 `homeDeferred` group 或加入 `activity` |

**額外改動 — app.js renderHomeDeferred()**：

```javascript
async renderHomeDeferred() {
  if (!this._isHomePageActive()) return false;

  // 動態載入延遲渲染區塊的依賴
  try {
    await ScriptLoader.loadGroup([
      'js/modules/tournament/tournament-core.js',
      'js/modules/tournament/tournament-render.js',
      'js/modules/popup-ad.js',
    ]);
  } catch (err) {
    console.warn('[renderHomeDeferred] script load failed:', err);
  }

  if (typeof this.renderOngoingTournaments === 'function') this.renderOngoingTournaments();
  this.renderSponsors();
  if (this.renderNews) this.renderNews();
  this.renderFloatingAds();  // banner.js 定義，永遠存在，不需防護
  if (typeof this.showPopupAdsOnLoad === 'function') this.showPopupAdsOnLoad();
  this.startBannerCarousel();
  return true;
},
```

**async 改動的安全性（第四次驗證確認）**：

`_scheduleHomeDeferredRender()` 的呼叫方式（`app.js:242-260`）：
```javascript
// _scheduleHomeDeferredRender 使用 requestIdleCallback / setTimeout
// 呼叫 renderHomeDeferred() 時沒有使用回傳值：
const run = () => { ...; this.renderHomeDeferred(); };
```

**結論**：`_scheduleHomeDeferredRender` **不依賴 `renderHomeDeferred` 的回傳值**，改為 async 後回傳 `Promise<true>` 而非 `true`，但呼叫端沒有檢查回傳值，因此 **安全** ✅

**⚠️ 風險點**：
- `tournament-core.js` 可能被其他地方直接引用（如賽事頁），需確認不影響
- `popup-ad.js` 定義 `showPopupAdsOnLoad`，如果 init() 裡的 `bindFloatingAds` 引用了 popup-ad 的東西需確認（已驗證：`bindFloatingAds` 定義在 banner.js，與 popup-ad.js 無關 ✅）

**風險評估**：中風險。async 改動已確認安全，但動態載入可能在首次載入時增加約 100ms 延遲。
**工作量**：~1 小時，改動 `app.js` + `script-loader.js` + `index.html` + 版本號更新。

**驗證清單**：
1. ✅ 首頁延遲區塊（賽事、贊助商、廣告）正常顯示（可能慢 100ms 但不影響體驗）
2. ✅ 首頁首屏（輪播+公告+活動）仍然秒出
3. ✅ 賽事頁面正常（ScriptLoader 從 _groups.tournament 載入）
4. ✅ 彈窗廣告正常觸發
5. ✅ Console 無新增 error

**commit message**：`啟動優化 Phase C：延遲渲染區塊改動態載入（31→28）`

---

### Phase D：bindImageUpload 懶綁定 — ⚠️ 第五次驗證：已有防護，此 Phase 可跳過

**第五次驗證發現**：`bindImageUpload`（`image-upload.js:56-58`）**已經內建 DOM 存在性檢查**：

```javascript
bindImageUpload(inputId, previewId, aspectRatio) {
  const input = document.getElementById(inputId);
  if (!input || input.dataset.bound) return;  // ← 已有：DOM 不存在或已綁定時直接跳過
  input.dataset.bound = '1';
  // ...
}
```

**結論**：init() 中的 13 次 `bindImageUpload` 呼叫，在 DOM 元素不存在時已經會快速跳過（`getElementById` 回傳 null → `if (!input)` → return）。加上 `input.dataset.bound` 防止重複綁定。

**此 Phase 原本要做的事情（加 DOM 偵測）已經存在，不需要任何改動。**

如果仍然想優化啟動效能，唯一的收益是省去 13 次 `getElementById` 呼叫（每次約 0.01ms），總計節省約 0.13ms — **不值得為此改動程式碼**。

**建議**：跳過 Phase D，將精力投入 Phase E（快取韌性強化）。

**風險評估**：零（不做任何改動）。
**工作量**：0。

**備選方案（高風險）— 完全移除 init() 呼叫**：

<details>
<summary>展開查看高風險備選方案</summary>

1. 在 `init()` 中移除所有 `bindImageUpload` 呼叫
2. 在每個相關頁面的 `_bindPageElements()` 或 `showPage()` 回調中，加入對應的 `bindImageUpload`
3. 每個綁定都需要加 `if (!document.getElementById(inputId)) return;` 防護

**涉及的 13 個綁定與所屬頁面**：

| 輸入元素 ID | 預覽元素 ID | 比例 | 所屬頁面 |
|------------|------------|------|---------|
| ce-image | ce-upload-preview | 16/9 | 建立活動 |
| ct-image | ct-upload-preview | 16/9 | 建立賽事 |
| ct-content-image | ct-content-upload-preview | 16/9 | 建立賽事 |
| et-image | et-upload-preview | 16/9 | 編輯賽事 |
| et-content-image | et-content-upload-preview | 16/9 | 編輯賽事 |
| cs-img1 | cs-preview1 | 4/3 | 商店頁（pages/shop.html） |
| cs-img2 | cs-preview2 | 4/3 | 商店頁（pages/shop.html） |
| cs-img3 | cs-preview3 | 4/3 | 商店頁（pages/shop.html） |
| banner-image | banner-preview | 2.2 | 橫幅管理 |
| floatad-image | floatad-preview | 1 | 浮動廣告管理 |
| popupad-image | popupad-preview | 16/9 | 彈窗廣告管理 |
| ct-team-image | ct-team-preview | 1 | 俱樂部建立 |
| theme-image | theme-preview | 0 | 主題管理 |

**風險**：13 個表單散佈在不同頁面，如果遺漏任何一個 `_bindPageElements` 呼叫，該頁面的圖片上傳功能會靜默失效。

</details>

**commit message**：`啟動優化 Phase D：bindImageUpload 加 DOM 偵測，延遲頁面首次綁定`

---

### Phase E（新增）：快取韌性強化（針對高併發）

> 此 Phase 獨立於 Phase A-D 的 script 載入優化，可並行或提前執行。
> 優先級由高到低排列。

**前置條件**：無（獨立於 Phase A-D）

#### E1：SW 全面修復 — 移除幽靈檔案 + 逐個快取 + cache key 對齊（🔴 P0）

**改動檔案**：`sw.js`

**必須修復的三個問題（第五次驗證確認）**：

**E1a — 移除 `./js/core/mode.js`（⛔ 阻斷性 bug）**：
此檔案不存在，導致 `addAll` 每次必然失敗。這是目前 SW cache 完全失效的根本原因。

**E1b — 改為逐個快取**：
```javascript
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      const critical = ['./index.html', './css/base.css', './css/layout.css', './js/config.js', './app.js'];
      const secondary = STATIC_ASSETS.filter(a => !critical.includes(a));

      for (const url of critical) {
        try { await cache.add(url); }
        catch (_) {
          try { await cache.add(url); }
          catch (e) { console.warn('[SW] Critical asset cache failed:', url); }
        }
      }
      await Promise.allSettled(secondary.map(url => cache.add(url)));
    })
  );
  self.skipWaiting();
});
```

**~~E1c — fetch handler 加入 cache key 正規化~~ ⛔ 第六次驗證判定：此方案不安全，已撤回**：

> 原提案：去掉 `?v=` 做 cache key 正規化。
> **撤回原因**（第六次驗證發現的三個致命缺陷）：
>
> 1. **破壞快取版本策略**：`?v=` 參數是整個應用的快取失效機制。去掉後，版本從 `20260320e` 更新到 `20260320f` 時，SW 仍會回傳舊版 CSS/JS/HTML — 用戶看到的是過期的樣式和邏輯，直到新 SW 啟用（可能 5-30 秒）。
> 2. **HTML 片段也受影響**：`page-loader.js` 載入頁面片段時使用 `pages/{name}.html?v=${CACHE_VERSION}`，去掉 `?v=` 會導致頁面片段也命中舊快取。
> 3. **`./` vs `/` 路徑不匹配**：STATIC_ASSETS 用 `./css/base.css`（帶 `./`），但 `url.pathname` 回傳 `/css/base.css`（不帶 `./`），兩者 cache key 不同，無法匹配。

**E1c 替代方案 — 不改 fetch handler，改善 install handler 的 cache key**：

既然 E1b 已改為逐個 `cache.add()`，可在 install 時用帶 `?v=` 的 URL 預快取：

```javascript
// E1c-alt：在 install handler 中，STATIC_ASSETS 改為帶版本號
// 好處：cache key 與 index.html 請求一致，cache-first 直接命中
// 缺點：每次部署都要同步更新 sw.js 的 STATIC_ASSETS URL
const CACHE_VERSION_SW = '20260320e';  // 與 config.js 的 CACHE_VERSION 保持一致
const STATIC_ASSETS = [
  './',
  `./index.html`,
  `./css/base.css?v=${CACHE_VERSION_SW}`,
  `./css/layout.css?v=${CACHE_VERSION_SW}`,
  // ... 其他資源都加上 ?v=
];
```

> ⚠️ 此替代方案增加維護成本（每次部署需同步更新 `sw.js`）。**如果覺得成本太高，可完全跳過 E1c** — E1a+E1b 已足以修復 SW cache 從「完全失效」到「對 STATIC_ASSETS 列表有效」。`?v=` 不匹配的問題可接受（回訪用戶的 SW fetch handler 會在 section 4 從網路載入並快取帶版本號的 URL）。

**風險評估**：E1a 零風險（只刪一行）。E1b 低風險。E1c-alt 低風險但高維護成本。
**工作量**：E1a ~5 分鐘。E1b ~15 分鐘。E1c-alt 可選，~30 分鐘。建議先做 E1a+E1b，E1c-alt 視需要再決定。

#### E2：onSnapshot 重連加 jitter（🟡 P1）

**改動檔案**：`firebase-service.js`（三個 `_reconnect*Listener` 函式）

```javascript
// 在 delay 計算後加入 jitter
const baseDelay = Math.min(1000 * Math.pow(2, attempts - 1), 30000);
const jitter = baseDelay * Math.random() * 0.3;  // 0~30% 隨機偏移
const delay = Math.round(baseDelay + jitter);
```

**風險評估**：極低風險。只改延遲時間計算，不影響邏輯。
**工作量**：~15 分鐘，三處相同改動。

#### E3：localStorage 寫入失敗告警 + 保守淘汰（🟡 P1）

**改動檔案**：`firebase-service.js`

**⚠️ 第五次驗證修正**：原始 E3 方案有**級聯失敗風險**。如果反覆觸發 quota exceeded，每次刪除 5 個低優先集合，多次累積後 `_restoreCache()` 的 `restored > 3` 閥值可能無法通過，導致快取系統整體失效。修正為更保守的策略：

```javascript
_saveToLS(name, data) {
  try {
    const json = JSON.stringify(data);
    if (json.length > 512000) return;
    localStorage.setItem(this._getLSKey(name), json);
  } catch (e) {
    console.warn('[LS] Write failed for', name, '- quota likely exceeded');
    // 保守策略：只刪除 1 個最低優先集合，避免連鎖淘汰
    // 被刪除的集合不影響 _restoreCache() 的 restored > 3 閥值
    // （因為 boot 集合 5 個 + adminUsers 1 個 > 3）
    const expendable = ['newsArticles', 'gameConfigs'];  // ← 只刪非 boot、非統計的集合
    for (const lp of expendable) {
      if (lp === name) continue;
      try {
        localStorage.removeItem(this._getLSKey(lp));
        localStorage.setItem(this._getLSKey(name), json);
        console.warn('[LS] Evicted', lp, 'to make room for', name);
        return;
      } catch (_) { continue; }
    }
    // 如果仍然失敗，放棄寫入但不刪更多集合
    console.warn('[LS] Gave up writing', name, '- no more expendable collections');
  }
},
```

**與 `_restoreCache()` 的安全性分析**：
- `_bootCollections` 有 5 個（banners, announcements, siteThemes, achievements, badges）
- 加上 adminUsers + rolePermissions + rolePermissionMeta = 至少 8 個
- 只淘汰 `newsArticles`、`gameConfigs` 這兩個非 boot 集合
- 即使兩個都被淘汰，`_restoreCache()` 的 `restored` 仍然 ≥ 6 → 遠超閥值 3 ✅

**風險評估**：低風險。只淘汰 2 個不影響啟動的集合，不會造成級聯失敗。
**工作量**：~30 分鐘。

#### E4：頁面關閉前強制持久化（🔴 P1 — 第七次驗證升級：5.5 資料遺失是真實問題）

**改動檔案**：`firebase-service.js`（在 `_setupVisibilityRefresh` 或 `init` 中加入）

```javascript
// 在 _setupVisibilityRefresh() 方法內加入（arrow function 會正確捕獲 this = FirebaseService）：
window.addEventListener('pagehide', () => {
  clearTimeout(this._persistDebounceTimer);
  this._persistCache();
});
// ⚠️ 注意：此段程式碼必須放在 FirebaseService 的方法內（如 _setupVisibilityRefresh），
//    arrow function 才能正確綁定 this。不可放在全域或獨立函式中。
// 備選：visibilitychange hidden 時也持久化（覆蓋 LINE WebView 切頁場景）
// 注意：不要用 beforeunload，Chrome 會阻止 bfcache
```

**風險評估**：低風險。`_persistCache()` 內部全部是同步操作（`JSON.stringify` + `localStorage.setItem`） ✅

> ⚠️ **第 9 輪（魔鬼代言人）風險提醒**：iOS Safari 的 pagehide handler 執行時間可能受限（~5ms）。若 30+ 個集合的 `JSON.stringify` + `setItem` 超過此限制，寫入可能被截斷。**緩解方式**：`_persistCache()` 只寫入有變更的集合（已有 dirty tracking），實際寫入量遠小於 30 個。若仍擔心，可在 `visibilitychange hidden` 時也觸發持久化（分攤寫入壓力）：
>
> ```javascript
> // 雙重方案：pagehide + visibilitychange hidden
> window.addEventListener('pagehide', () => { ... });
> document.addEventListener('visibilitychange', () => {
>   if (document.hidden) {
>     clearTimeout(this._persistDebounceTimer);
>     this._persistCache();
>   }
> });
> ```
> 注意：visibilitychange 觸發更頻繁（最小化、切分頁），但因為 `_persistCache()` 只寫 dirty 集合，效能衝擊極小。

**工作量**：~20 分鐘。

#### ~~E5：Firebase SDK 載入失敗降級~~ — ⚠️ 第七次驗證：5.11 前提錯誤，此項撤回

> 5.11 原宣稱 `initFirebaseApp()` 回傳值被忽略，但第七次驗證確認 `app.js:1407` 已有 `if (!initFirebaseApp()) throw` 檢查。既然檢查已存在，E5 不需要實施。

#### E6：init() 非核心區段加 try-catch 錯誤邊界（🟡 P1 — 第六次驗證新增）

**改動檔案**：`app.js`（`init()` 方法）

**問題**：見 5.12 — init() 35 個呼叫無錯誤邊界。

**與 Phase A 的關係**：Phase A 加 `?.()` 防護 + E6 加 try-catch 是**互補的兩層防護**：
- `?.()` 防止「函式不存在」→ 不 crash
- try-catch 防止「函式存在但內部拋出例外」→ 不中止後續流程

> ⚠️ 第七次驗證修正：原建議「與 Phase A 合併實施」，但違反鐵律「絕對不可跨 Phase 合併」。E6 應作為**獨立 commit**，在 Phase A 之後、Phase B 之前實施。

**建議做法**（獨立於 Phase A）：
```javascript
init() {
  // 核心 UI（硬呼叫，拋出例外代表致命問題 → 讓它 crash 以便偵錯）
  this.bindSportPicker();
  this.bindNavigation();
  // ...

  // 非核心模組（加 try-catch，失敗不影響核心渲染）
  try {
    this.initPwaInstall?.();
    this.bindFloatingAds?.();
    this.bindImageUpload?.('ce-image', 'ce-upload-preview', 16/9);
    // ... 所有 ?.() 呼叫
    this.applySiteThemes?.();
    this.initLangSwitcher?.();
  } catch (e) {
    console.error('[App] 非核心模組初始化失敗:', e.message);
  }

  // 核心渲染（不受上方錯誤影響）
  this._applyI18nToUI();
  this.renderAll();
  this.applyRole('user', true);
},
```

**風險評估**：極低風險。核心 UI 保持硬呼叫（致命問題仍然會 crash），非核心區段加防護網。
**工作量**：與 Phase A 合併，~10 分鐘額外工作。

#### E7：FirebaseService.init() 防重複呼叫（🟡 P1 — 第六次驗證新增）

**改動檔案**：`firebase-service.js`（`init()` 方法開頭）

**問題**：見 5.13 — init() 在 `_initialized = true` 之前可能被重複呼叫。

```javascript
async init() {
  if (this._initialized) return;
  if (this._initInFlight) return;  // ← 新增：防止平行 init，直接返回
  this._initInFlight = true;
  try {
    // ... 原有的 init 邏輯 ...
    this._initialized = true;
  } finally {
    this._initInFlight = false;
  }
}
```

> ⚠️ **第七次驗證修正**：原版寫 `return this._initPromise` 但從未賦值 `_initPromise`。簡化為 `return;` — 第二個呼叫者直接跳過即可，不需要等待第一個完成（因為 UI 渲染由 renderAll 驅動，不依賴 init 回傳值）。

**風險評估**：極低風險。只加入防護，不改現有邏輯。
**工作量**：~15 分鐘。

#### E8：首次渲染空白時顯示 loading 提示（🔴 P1 — 第十三次驗證新增）

**改動檔案**：`js/modules/event/event-list.js`（`renderHotEvents` 方法）

**問題**：見 5.17 — 首次訪問 Prod 模式時，`renderAll()` → `renderHotEvents()` 執行時 `_cache` 為空，`_getVisibleEvents()` 回傳空陣列，首頁活動區域直接被清空（`container.textContent = ''`）。Cloud 就緒後 `app.js:1471` 會呼叫 `renderAll()` 重新渲染，但中間有 1-3 秒空白閃爍。

**現況確認**：
- `app.js:1471` 已有 `try { this.renderAll(); } catch (_) {}` → Cloud 就緒後會重新渲染 ✅
- `firebase-service.js:710` 已有 `App.renderHotEvents?.()` → events onSnapshot 更新後也會重新渲染 ✅
- **問題只在「首次渲染到 Cloud 就緒」之間的空白期**

**具體做法**（改動 `event-list.js:renderHotEvents`）：

```javascript
renderHotEvents() {
  this._autoEndExpiredEvents();
  this.renderHomeGameShortcut();
  const container = document.getElementById('hot-events');
  if (!container) return;

  const visible = this._getVisibleEvents()
    .filter(e => e.status !== 'ended' && e.status !== 'cancelled')
    .sort(/* ... 現有排序邏輯 ... */)
    .slice(0, 10);

  this._setHomeSectionVisibility(container, visible.length > 0);

  if (visible.length === 0) {
    // ── E8 改動開始 ──
    // 判斷是否為「資料尚未就緒」（Cloud 未 ready 且無 localStorage 快取）
    // 還是「真的沒有活動」（Cloud 已 ready 但集合為空）
    if (!this._cloudReady) {
      // Cloud 尚未就緒 → 顯示 loading 提示，而非清空
      if (!container.querySelector('.home-loading-hint')) {
        container.innerHTML = '<div class="home-loading-hint" style="text-align:center;padding:2rem;color:var(--text-secondary,#888)">載入中…</div>';
      }
      return;  // 不清空，等 Cloud ready 後的 renderAll 會覆蓋
    }
    // Cloud 已 ready，確實沒有活動 → 正常清空
    // ── E8 改動結束 ──
    container.textContent = '';
    return;
  }

  // ... 後續正常渲染 cards 的邏輯不變 ...
}
```

**為什麼改 `event-list.js` 而非 `app.js`**：
- `renderHomeCritical()` 只是依序呼叫 `renderBannerCarousel`、`renderAnnouncement`、`renderHotEvents`，沒有自己的邏輯
- 問題的根源在 `renderHotEvents` 的 `visible.length === 0` 分支 — 它分不清「沒資料」和「資料還沒來」
- 在這裡改動最精準，不影響其他渲染函式

**驗證清單**：
1. ✅ 首次訪問（清快取）→ 首頁活動區域顯示「載入中…」而非空白
2. ✅ Cloud 就緒後 → 「載入中…」被活動卡片覆蓋
3. ✅ 回訪用戶（有 localStorage 快取）→ 直接顯示活動卡片，不閃 loading
4. ✅ Demo 模式 → 資料同步可用，不受影響
5. ✅ 確實無活動的情境（Cloud ready + events 為空）→ 正常清空，不卡在 loading
6. ✅ Console 無新增 error

**風險評估**：極低風險。只在 `visible.length === 0 && !_cloudReady` 時改變行為，其餘路徑完全不變。Cloud 就緒後的 `renderAll()` 和 `onSnapshot` 回調都會重新呼叫此函式覆蓋 loading 狀態。
**工作量**：~15 分鐘。

#### E9：page-loader.js 加入 HTTP 錯誤檢查（🟡 P1 — 第十三次驗證新增）

**改動檔案**：`js/core/page-loader.js`（`_loadSingleFile` + `loadAll` 兩處）

**問題**：見 5.18 — fetch 未檢查 `response.ok`，HTTP 4xx/5xx 時靜默返回錯誤頁面 HTML 作為頁面內容。

**需要改動的 3 個位置**：

**位置 1 — `_loadSingleFile`（line 107）**：
```javascript
// 改前：
const html = await fetch(`pages/${fileName}.html?v=${CACHE_VERSION}`).then(r => r.text());

// 改後：
const html = await fetch(`pages/${fileName}.html?v=${CACHE_VERSION}`).then(r => {
  if (!r.ok) { console.warn(`[PageLoader] ${fileName}: HTTP ${r.status}`); return ''; }
  return r.text();
});
```

**位置 2 — `loadAll` bootPages（line 144-145）**：
```javascript
// 改前：
fetchMap[name] = fetch(`pages/${name}.html?v=${CACHE_VERSION}`)
  .then(r => r.text())
  .catch(err => { console.warn(`[PageLoader] pages/${name}.html 載入失敗:`, err); return ''; });

// 改後：
fetchMap[name] = fetch(`pages/${name}.html?v=${CACHE_VERSION}`)
  .then(r => {
    if (!r.ok) { console.warn(`[PageLoader] ${name}: HTTP ${r.status}`); return ''; }
    return r.text();
  })
  .catch(err => { console.warn(`[PageLoader] pages/${name}.html 載入失敗:`, err); return ''; });
```

**位置 3 — `loadAll` modals（line 150）**：
```javascript
// 改前：
fetch(`pages/${name}.html?v=${CACHE_VERSION}`).then(r => r.text())
  .catch(err => { console.warn(`[PageLoader] pages/${name}.html 載入失敗:`, err); return ''; })

// 改後：
fetch(`pages/${name}.html?v=${CACHE_VERSION}`).then(r => {
  if (!r.ok) { console.warn(`[PageLoader] ${name}: HTTP ${r.status}`); return ''; }
  return r.text();
}).catch(err => { console.warn(`[PageLoader] pages/${name}.html 載入失敗:`, err); return ''; })
```

**為什麼不用 `response.ok` 拋例外讓 catch 統一處理**：
- `.catch()` 只捕獲網路層錯誤（DNS 失敗、timeout、CORS），**不捕獲 HTTP 4xx/5xx**
- HTTP 錯誤時 `fetch()` 仍回傳正常的 Response 物件，`.then()` 會正常執行
- 如果用 `throw` 再 catch，會和網路錯誤混在一起，不利於除錯（console 訊息不同）

**驗證清單**：
1. ✅ 正常情況：所有頁面片段載入成功，行為無變化
2. ✅ HTTP 404（片段不存在）→ console.warn + 回傳空字串 → 頁面區域空白但不 crash
3. ✅ HTTP 503（CDN 過載）→ 同上
4. ✅ 網路錯誤（斷網）→ 走原有 .catch() 路徑，行為不變
5. ✅ Deep link 優先載入（line 156-168）→ 失敗時 html 為空字串 → `if (html)` 跳過，不 crash
6. ✅ Console 無新增 error（只有 warn）

**風險評估**：極低風險。每個改動只在 `.then()` 內加一行 `if (!r.ok)` 檢查，失敗時回傳空字串（與網路錯誤的 `.catch()` 行為一致）。正常情況下完全不影響。
**工作量**：~15 分鐘。

---

## 七、預期效果

### Script 載入優化（Phase A-D）

| Phase | 移除 script 數 | 剩餘 script 數 | 風險 | 預估節省（首次訪問） | 預估節省（回訪） |
|-------|---------------|---------------|------|-------------------|----------------|
| A | 0 | 38 | 零 | 0（為後續鋪路） | 0 |
| B | 7 | 31 | 低 | ~70KB + 7 次 HTTP | 極小（SW cache-first） |
| C | 3 | 28 | 中 | ~30KB + 3 次 HTTP | 極小（SW cache-first） |
| D | ~~0~~ 跳過 | 28 | — | ~~啟動時 13 次 DOM 查詢→0~~ 已有防護，無需改動 | — |
| **小計** | **10** | **28** | — | **~100KB + 10 次 HTTP** | **極小** |

> **重要說明**：Service Worker 的 cache-first 策略意味著回訪用戶的 JS/CSS 都從 SW cache 讀取，HTTP 請求數的節省**主要影響首次訪問和清快取後的體驗**。

### 快取韌性強化（Phase E）

| 子 Phase | 目標 | 影響場景 | 風險 | 優先級 |
|----------|------|---------|------|--------|
| E1a | 移除 sw.js 幽靈檔案 `mode.js` | **SW cache 完全失效的阻斷性 bug** | 零 | ✅ Step 1 完成 |
| E1b | SW addAll 改逐個快取 | 首次訪問 / SW 更新時的快取成功率 | 低 | ✅ Step 1 完成 |
| ~~E1c~~ | ~~SW fetch handler cache key 正規化~~ | ⛔ **第六次驗證撤回：會破壞 `?v=` 快取版本策略** | — | ~~🟡~~ 撤回 |
| E1c-alt | SW install handler 帶版本號（可選） | STATIC_ASSETS cache 命中率 | 低 | 🟢 可選（Step 11） |
| E2 | onSnapshot 加 jitter | 50+ 用戶同時在線的連線穩定性 | 極低 | ✅ Step 5 完成 |
| E3 | LS 寫入告警 + 保守淘汰 | 長期用戶的快取完整性 | 低 | ✅ Step 8 完成 |
| E4 | pagehide 持久化 | LINE WebView 切頁後的資料新鮮度 | 極低 | ✅ Step 2 完成 |
| ~~E5~~ | ~~Firebase SDK 載入失敗降級~~ | ⚠️ **第七次驗證撤回：5.11 前提錯誤，已有檢查** | — | ~~🔴~~ 撤回 |
| E6 | init() 非核心區段加 try-catch | 單一模組失敗拖垮全局 | 極低 | ✅ Step 3 完成 |
| E7 | FirebaseService.init() 防重複呼叫 | 慢網路下的監聽器洩漏 | 極低 | ✅ Step 4 完成 |
| E8 | renderHotEvents loading 提示 | 首次訪問首頁空白閃爍（5.17） | 低 | ✅ Step 6 完成 |
| E9 | page-loader.js HTTP 錯誤檢查 | CDN 過載時頁面片段載入失敗（5.18） | 極低 | ✅ Step 7 完成 |

> **Phase E 是解決「大量用戶突然湧入」問題的核心**。Phase A-D 減少啟動負擔，Phase E 增加快取系統在壓力下的韌性。兩者互補。
> **第六次驗證新增 E5-E7**，第十三次驗證新增 E8-E9。
>
> **未建立 Phase E 條目的問題**（屬設計取捨或已有間接修復路徑）：
> - 5.3（無 limit 集合）：需後端配合加 limit，非前端可獨立修復
> - 5.7（SW 版本雙軌）：E1c-alt 已覆蓋；若不做 E1c-alt 則接受風險
> - 5.8（_restoreCache 回傳值）：影響有限，Cloud 就緒後會重新載入
> - 5.9（clear=1 不清 LS）：獨立修復，與 Phase E 快取韌性主線無關，可作為獨立 hotfix
> - 5.14（監聽器累積）：長工作階段問題，destroy() 已有清理機制，接受風險
> - 5.15（LINE WebView 配額）：E3 的保守淘汰策略已部分緩解

---

## 八、歷史教訓（必讀）

> 2026-03-17～18：嘗試將 script 從 index.html 移到動態載入，造成：
> - `bindLineLogin is not a function` — profile-form.js 被移但 init() 硬呼叫它
> - `updatePointsDisplay is not a function` — profile-core.js 被移但 renderGlobalShell 硬呼叫
> - image-cropper 失效 — 移除但 image-upload 依賴它
> - message-notify 失效 — 移除後通知功能壞掉
>
> 2026-03-19：再次嘗試 init 分拆（initCore + initModules），同樣失敗，已 rollback。
>
> **核心教訓**：
> 1. 不能只看「這個檔案是否被 init() 直接呼叫」，還要追蹤隱藏的間接依賴鏈。
> 2. `?.()` 只防「函式不存在」，不防「函式存在但內部依賴缺失」。
> 3. 載入優化（減少 script 數）和快取韌性（防止快取系統在壓力下崩潰）是兩個不同的問題，不要混為一談。
> 4. **提案前必須驗證現有程式碼**：Phase D 的「加 DOM 偵測」修復方案，在第五次驗證中發現程式碼已有此邏輯（`image-upload.js:58`），整個 Phase 是多餘的。
> 5. **STATIC_ASSETS 列表必須與實際檔案同步**：`sw.js` 中列了不存在的 `mode.js`，導致 SW cache 自建站以來可能從未正常運作。靜默的 `catch(() => {})` 隱藏了這個問題。
> 6. **修復方案本身也需要審查副作用**：E3 的「刪除低優先集合騰空間」方案，在第五次驗證中發現可能導致 `_restoreCache()` 閥值失敗，造成比原問題更嚴重的級聯故障。
> 7. **修復方案不能破壞既有的快取失效機制**：第六次驗證發現 E1c（去掉 `?v=` 做 cache key 正規化）會讓版本更新後用戶拿到舊的 CSS/JS/HTML，直接破壞整個快取版本策略。`?v=` 不只是「版本提示」，它是唯一的快取失效手段。
> 8. **改動程式碼時禁止順便重新排序**：第六次驗證發現 Phase A 的範例程式碼把函式重新分群排列，但實際 init() 中函式穿插排列是有意義的。「只加 `?.()` 不改順序」才安全。
> 9. **從「離線/錯誤路徑」檢查是正常路徑檢查的盲區**：前五次驗證集中在「正常流程」的正確性，第六次驗證從「CDN 掛了怎麼辦」、「init 被呼叫兩次怎麼辦」的角度切入，發現了 6 個新問題（5.11-5.16）。
> 10. **驗證文件本身的事實宣稱**：第七次驗證發現 5.11 宣稱「initFirebaseApp() 回傳值被忽略」是事實錯誤 — `app.js:1407` 已有 `if (!initFirebaseApp()) throw` 檢查。基於錯誤前提的修復方案（E5）也必須一併撤回。
> 11. **附錄/圖表必須與正文同步更新**：第十五次驗證發現附錄 B 故障連鎖圖仍寫「被忽略（5.11）」，但正文 5.11 早已修正。圖表與正文脫節會誤導實作者。
> 12. **每個問題都應有對應的處置決策**：第十四次驗證發現 7 個問題（5.3/5.7/5.8/5.9/5.14/5.15/5.17/5.18）缺少 Phase E 修復條目，讀者無法判斷是「刻意不修」還是「遺漏」。即使決定不修，也要在文件中註明原因。
>
> 本文件的價值就是把這些隱藏依賴全部挖出來，讓未來的修改有據可依。

---

## 附錄 A：快取架構全景圖

```
┌─────────────────────────────────────────────────────────────────┐
│                     ToosterX 四層快取架構                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Layer 1: Cloudflare Edge Cache                                 │
│  ├─ 位置：CDN 邊緣節點                                           │
│  ├─ TTL：300 秒（5 分鐘）                                        │
│  ├─ 範圍：/team-share/* 和 /event-share/* 的 OG 頁面              │
│  └─ 策略：Cache-Control: public, max-age=300, s-maxage=300       │
│                                                                 │
│  Layer 2: Service Worker Cache                                  │
│  ├─ CACHE_NAME: sporthub-{version}（靜態資源）                    │
│  │   ├─ HTML: network-first（確保不卡舊版）                       │
│  │   ├─ JS/CSS (有 ?v=): cache-first（版本號變更才更新）           │
│  │   └─ ⚠️ addAll 靜默失敗風險（見 5.1）                          │
│  ├─ IMAGE_CACHE_NAME: sporthub-images-v2（圖片）                  │
│  │   ├─ 策略: stale-while-revalidate                             │
│  │   ├─ TTL: 7 天 / 最多 150 張                                  │
│  │   └─ 單張上限 2MB，超齡/超量自動清理                            │
│  └─ 外部 CDN (Firebase/LINE/unpkg): network-first（不快取）       │
│                                                                 │
│  Layer 3: localStorage 持久化快取                                │
│  ├─ 前綴: shub_c_{uid}_{collection}                              │
│  ├─ TTL: admin 30 分鐘 / 一般用戶 120 分鐘                       │
│  ├─ 單一集合上限: 500KB                                           │
│  ├─ 總配額: ~5MB（瀏覽器限制，LINE WebView 可能更低）              │
│  ├─ 持久化: 30 秒 debounce 批次寫入                               │
│  ├─ ⚠️ 配額耗盡靜默失敗風險（見 5.4）                             │
│  └─ ⚠️ 頁面關閉前未持久化風險（見 5.5）                           │
│                                                                 │
│  Layer 4: 記憶體快取 (FirebaseService._cache)                    │
│  ├─ 結構: 與 DemoData 完全一致的 30+ 集合陣列                     │
│  ├─ 來源: Firestore .get() 一次性載入 + onSnapshot 即時同步       │
│  ├─ Boot 集合: banners, announcements, siteThemes, achievements  │
│  ├─ 即時同步: registrations, attendanceRecords, events            │
│  ├─ 懶載入: 其餘集合按頁面需求載入                                 │
│  ├─ ⚠️ 無 limit 集合的膨脹風險（見 5.3）                          │
│  └─ ⚠️ onSnapshot 重連風暴風險（見 5.2）                          │
│                                                                 │
│  ── 資料流向 ──                                                  │
│  首次訪問: Firestore → _cache → localStorage → SW cache           │
│  回訪:     localStorage → _cache → (背景) Firestore 驗證/更新     │
│  即時更新: Firestore onSnapshot → _cache → (debounce) localStorage│
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 附錄 B：併發壓力下的故障連鎖圖

```
大量用戶同時湧入
    │
    ├─→ 前置條件：Firebase SDK CDN 是否可用？
    │   ├─→ CDN 被擋或故障 → firebase 全域不存在 → initFirebaseApp() 回傳 false
    │   │   └─→ ensureCloudReady() 有 throw 檢查（5.11，已有防護）
    │   │       └─→ 但 throw 後無用戶提示 → ⚠️ 用戶看到空白頁（無離線降級 UI）
    │   │
    │   └─→ CDN 可用 → 繼續正常流程 ↓
    │
    ├─→ 所有用戶（不分首次/回訪）
    │   └─→ ⛔ sw.js STATIC_ASSETS 含不存在的 mode.js → addAll 每次必失敗（5.1 問題 B — ✅ Step 1 已修復）
    │       └─→ [已修復] mode.js 已移除 + 改逐個快取，SW cache 可正常運作
    │
    ├─→ 首次訪問用戶多（上述 SW bug 修復後仍可能發生）
    │   ├─→ SW addAll 有資源 fetch 失敗 → 整批快取丟失（5.1）
    │   │   └─→ cache-first 策略全部 miss → 所有請求穿透 origin → 放大壓力 ──┐
    │   │                                                                    │
    │   └─→ localStorage 無快取 → _restoreCache() 失敗                       │
    │       └─→ Firestore 全量載入（含無 limit 集合）→ 讀取量暴增 ────────────┤
    │                                                                        │
    ├─→ Firestore 承壓                                                       │
    │   ├─→ WebSocket 連線數暴增 → 部分連線被拒                        ←─────┘
    │   │   └─→ onSnapshot 斷線 → 重連已加 jitter 分散（5.2 ✅ Step 5 已修復）
    │   │       └─→ [已緩解] 重連時間分散在 0~30% 窗口內，驚群效應大幅降低
    │   │
    │   ├─→ 回應延遲 > 6 秒 → init() 逾時
    │   │   └─→ _cache 不完整 → 前端渲染空白 → 用戶手動刷新 → 再次觸發全量查詢
    │   │
    │   └─→ init() 慢 → 用戶不耐 → 快速切頁或重整
    │       └─→ FirebaseService.init() 防重入鎖已加入（5.13 ✅ Step 4 已修復）
    │           └─→ [已修復] _initInFlight 鎖防止重複呼叫
    │
    ├─→ LINE WebView 用戶
    │   ├─→ localStorage 配額 ~1MB（5.15）→ 只能快取 5-6 個集合
    │   │   └─→ _restoreCache() 部分成功 → 某些頁面資料缺失
    │   └─→ 快速切換聊天室 → pagehide + visibilitychange 持久化已加入（5.5 ✅ Step 2 已修復）
    │       └─→ [已修復] 切頁前強制持久化，減少資料丟失
    │
    ├─→ 首次訪問 + Prod 模式的渲染競態（5.17 ✅ Step 6 已修復）
    │   └─→ renderAll() 同步執行 → _cache 為空 → 顯示「載入中…」提示
    │       └─→ [已修復] Cloud 就緒後 renderAll() 自動覆蓋 loading 狀態
    │
    ├─→ 頁面切換時 page-loader 失敗（5.18 ✅ Step 7 已修復）
    │   └─→ CDN 過載 → HTML 片段 fetch 回傳 503 → response.ok 檢查
    │       └─→ [已修復] 回傳空字串 + console.warn，不將錯誤 HTML 插入頁面
    │
    └─→ 回訪用戶（佔多數）
        ├─→ localStorage 快取有效 → 秒開 ✅（正常路徑）
        ├─→ localStorage 快取過期/損壞 → 同首次訪問路徑
        └─→ localStorage 配額已滿 → _saveToLS 保守淘汰（5.4 ✅ Step 8 已修復）
            └─→ [已緩解] 淘汰 newsArticles/gameConfigs 騰空間，boot 集合保持完整
```

**關鍵結論**：快取系統的每一層失敗都會導致壓力向下一層傳遞。當多層同時失敗時，形成級聯雪崩。Phase E（Step 1-8）已加固每一層的失敗處理，打斷多條關鍵連鎖。上圖中標記 ✅ 的節點為已修復路徑。

**仍存在的未修復風險路徑**：
- 5.3（無 limit 集合）：首次訪問全量載入仍無限制
- 5.8（_restoreCache 回傳值忽略）：恢復失敗不會 warn
- 5.15（LINE WebView 配額）：1MB 限制下仍可能快取不足

---

## 附錄 C：施作步驟計劃（依賴關係已合併）

> 將有依賴關係的項目合併為同一步驟，確保每一步都是**獨立可部署的原子單位**，不會施作一半導致網站異常。
> 每一步完成後獨立 commit + 部署 + 驗證，確認無問題才進下一步。

### Step 1：SW 全面修復（E1a + E1b 合併） — ✅ 已完成 2026-03-20

**改動檔案**：`sw.js`
**合併原因**：E1b（逐個快取）前提是 E1a（刪 mode.js），分開部署沒有意義 — 不刪 mode.js 的話逐個快取仍會對 mode.js 那一項失敗。
**預估工時**：20 分鐘
**風險**：低

**改動內容**：
1. 移除 STATIC_ASSETS 中的 `'./js/core/mode.js'`（E1a）
2. 將 `cache.addAll(STATIC_ASSETS).catch(() => {})` 改為逐個 `cache.add()` + `Promise.allSettled`（E1b）
3. 更新 `CACHE_NAME` 版本號（強制新 SW 啟用）

**驗證清單**：
1. ✅ 開啟 DevTools → Application → Service Workers → 新 SW 已啟用
2. ✅ Application → Cache Storage → `sporthub-{version}` 內有 index.html, base.css 等資源
3. ✅ 重新載入 → Network 面板顯示靜態資源來自 `(ServiceWorker)` 而非網路
4. ✅ Console 無 `[SW] Critical asset cache failed` 警告

**commit message**：`修復 SW cache：移除幽靈檔案 mode.js + addAll 改逐個快取`

---

### Step 2：頁面關閉前持久化（E4） — ✅ 已完成 2026-03-20

**改動檔案**：`js/firebase-service.js`
**獨立性**：✅ 完全獨立，不依賴任何其他步驟
**預估工時**：20 分鐘
**風險**：極低

**改動內容**：
在 `_setupVisibilityRefresh()` 方法內加入 pagehide + visibilitychange 雙重持久化

**驗證清單**：
1. ✅ 開啟首頁 → 等待資料載入 → 關閉分頁 → 重新開啟 → 資料仍為最新
2. ✅ 在 LINE WebView 中測試：開啟 → 切到聊天室 → 切回 → 資料不丟失
3. ✅ Console 搜尋 `[LS]` → 無異常寫入錯誤
4. ✅ 多次切換分頁 → 無重複寫入（dirty tracking 有效）

**commit message**：`加入 pagehide+visibilitychange 持久化，防止 LINE WebView 切頁丟資料`

---

### Step 3：init() 防護網（Phase A + E6 合併） — ✅ 已完成 2026-03-20

**改動檔案**：`app.js`
**合併原因**：Phase A（加 `?.()` 防護）和 E6（加 try-catch）是「同一個函式的兩層互補防護」。Phase A 的 `?.()` 防「函式不存在」，E6 的 try-catch 防「函式存在但拋例外」。分開部署時，中間狀態只有半套防護。
**預估工時**：40 分鐘
**風險**：零（只加防護，不改邏輯，不改順序）

**改動內容**：
1. init() 中非核心呼叫加 `?.()` — **保持原有函式順序不變，禁止重排序**（詳見 Phase A 說明）
2. 非核心呼叫區段包 try-catch（E6）

> ⚠️ **關鍵約束**：init() 中 `initPwaInstall()` 和 `bindFloatingAds()` 穿插在核心 UI 呼叫中間，這是有意義的順序。只能原地加 `?.()` 和 try-catch，不可重新分群排列。完整的逐行改動範例見本文件 Phase A 章節。

**驗證清單**：
1. ✅ 首頁正常：輪播、公告、活動列表、賽事正常顯示
2. ✅ Console 無 `[App] 非核心模組初始化失敗` 警告（正常時不會觸發）
3. ✅ 手動在 Console 輸入 `delete App.initPwaInstall` → 重新呼叫 `App.init()` → 不 crash，其他功能正常
4. ✅ 所有 13 個 bindImageUpload 仍正常（建立活動/賽事表單可上傳圖片）
5. ✅ init() 函式呼叫順序未改變（對比 git diff 確認）

**commit message**：`init() 加 ?.() 防護網 + 非核心區段 try-catch 錯誤邊界`

---

### Step 4：FirebaseService 防重複初始化（E7） — ✅ 已完成 2026-03-20

**改動檔案**：`js/firebase-service.js`
**獨立性**：✅ 完全獨立
**預估工時**：15 分鐘
**風險**：極低

**改動內容**：
init() 開頭加 `_initInFlight` 鎖，防止慢網路下重複呼叫導致雙重 onSnapshot 監聽器

**驗證清單**：
1. ✅ 正常載入 → 只觸發一次 init（Console 只有一次 `[Firebase] App 初始化成功`）
2. ✅ 在 Console 手動呼叫 `FirebaseService.init()` 兩次 → 第二次直接 return
3. ✅ 頁面功能正常（活動列表、報名、訊息）

**commit message**：`FirebaseService.init() 加防重入鎖，防止慢網路下雙重監聽器`

---

### Step 5：onSnapshot 重連加 jitter（E2） — ✅ 已完成 2026-03-20

**改動檔案**：`js/firebase-service.js`
**獨立性**：✅ 完全獨立
**預估工時**：15 分鐘
**風險**：極低

**改動內容**：
三個 `_reconnect*Listener` 函式的 delay 計算加入 0-30% 隨機偏移

**驗證清單**：
1. ✅ 斷網 → 恢復網路 → onSnapshot 自動重連（Console 可見重連訊息）
2. ✅ 重連延遲不再是固定值（多次斷網測試，Console 顯示的 delay 值每次不同）

**commit message**：`onSnapshot 重連加 jitter，防止高併發下的驚群效應`

---

### Step 6：首次渲染 loading 提示（E8） — ✅ 已完成 2026-03-20

**改動檔案**：`js/modules/event/event-list.js`
**獨立性**：✅ 完全獨立
**預估工時**：15 分鐘
**風險**：極低

**改動內容**：
`renderHotEvents()` 中 `visible.length === 0` 分支加入 `_cloudReady` 判斷

**驗證清單**：
1. ✅ 清快取後首次訪問 → 活動區域顯示「載入中…」
2. ✅ Cloud 就緒後 →「載入中…」被活動卡片覆蓋
3. ✅ 回訪用戶（有快取）→ 直接顯示卡片，不閃 loading
4. ✅ 確實無活動時（Cloud ready + events 為空）→ 正常清空
5. ✅ Demo 模式 → 不受影響

**commit message**：`首次渲染活動列表為空時顯示 loading 提示，Cloud 就緒後自動覆蓋`

---

### Step 7：page-loader HTTP 錯誤檢查（E9） — ✅ 已完成 2026-03-20

**改動檔案**：`js/core/page-loader.js`
**獨立性**：✅ 完全獨立
**預估工時**：15 分鐘
**風險**：極低

**改動內容**：
3 處 fetch 加入 `if (!r.ok)` 檢查（`_loadSingleFile` + `loadAll` bootPages + modals）

**驗證清單**：
1. ✅ 正常載入 → 所有頁面片段正常顯示
2. ✅ DevTools → Network → 模擬 Offline → 頁面切換 → Console 顯示 warn 而非 error
3. ✅ 各頁面切換正常（activity、team、message、profile、scan、tournament）

**commit message**：`page-loader 加入 HTTP 狀態檢查，防止 4xx/5xx 回應被當作有效 HTML`

---

### Step 8：localStorage 保守淘汰（E3） — ✅ 已完成 2026-03-20

**改動檔案**：`js/firebase-service.js`
**獨立性**：✅ 完全獨立
**預估工時**：30 分鐘
**風險**：低

**改動內容**：
`_saveToLS` 的 catch 中加入保守淘汰策略（只刪 newsArticles / gameConfigs）

**驗證清單**：
1. ✅ 正常使用 → 無淘汰觸發（Console 無 `[LS] Evicted` 訊息）
2. ✅ 手動填滿 localStorage 後觸發寫入 → Console 顯示淘汰了哪個集合
3. ✅ 淘汰後 → 重新載入 → `_restoreCache()` 仍通過閥值（`restored > 3`）

**commit message**：`localStorage 寫入失敗時保守淘汰非 boot 集合，防止配額耗盡級聯失敗`

---

### 可選步驟（ROI 較低，視需要再做）

| Step | 項目 | 檔案 | 工時 | 前置條件 |
|------|------|------|------|---------|
| 9 | Phase B — 7 script 動態載入 | index.html + script-loader.js | 1 小時 | Step 3（Phase A） |
| 10 | Phase C — 3 script 延遲載入 | app.js + script-loader.js + index.html | 1 小時 | Step 9（Phase B） |
| 11 | E1c-alt — SW 帶版本號預快取 | sw.js | 30 分鐘 | Step 1（E1a+E1b） |

---

### 施作總覽

```
✅ Step 1 ──→ [可選 Step 11]
   (SW 修復)

✅ Step 2
   (pagehide)

✅ Step 3 ──→ [可選 Step 9 ──→ Step 10]
   (init 防護)

✅ Step 4
   (防重複 init)

✅ Step 5
   (jitter)

✅ Step 6
   (loading 提示)

✅ Step 7
   (page-loader)

✅ Step 8
   (LS 淘汰)

✅ 必做 8 步全部完成（2026-03-20）。
可選步驟 9-11 尚未實施，視需要再做。
```
