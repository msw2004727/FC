# SportHub — 啟動依賴地圖

> 建立日期：2026-03-19（經三次驗證，第三次發現 event-external-transit.js 降級）
> 目的：完整記錄 `App.init()` 啟動流程中的函式呼叫鏈與模組依賴關係，作為載入優化的基礎。
> ⚠️ 本文件包含實作步驟，換設備 / 換會話時請直接閱讀本文件繼續執行。

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
| 28 | `js/modules/tournament/tournament-core.js` | renderOngoingTournaments 的資料層 | ❌ 無防護 |
| 29 | `js/modules/tournament/tournament-render.js` | `renderOngoingTournaments()` | ❌ 無防護 |
| 30 | `js/modules/popup-ad.js` | `showPopupAdsOnLoad()` | ❌ 無防護（但在 try/catch 內） |

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
| 28 | js/modules/tournament/tournament-core.js | 250ms 延遲 renderOngoingTournaments | 加 `if (typeof this.renderOngoingTournaments === 'function')` |
| 29 | js/modules/tournament/tournament-render.js | 同上 | 同上 |
| 30 | js/modules/popup-ad.js | 250ms 延遲 showPopupAdsOnLoad | 加 `if` 防護 |

### ✅ 確定可以安全延遲（7 個）

| # | 檔案 | 安全原因 |
|---|------|---------|
| 31 | js/modules/profile/profile-avatar.js | 只在 profile 頁用，啟動不呼叫 |
| 32 | js/modules/profile/profile-data-stats.js | 只在 profile/titles 頁用 |
| 33 | js/modules/event/event-list-timeline.js | 時間軸視圖，非首頁 |
| 34 | js/modules/message/message-line-push.js | 推播投遞，Cloud 後才需要 |
| 35 | js/modules/message/message-notify.js | 通知範本+投遞，啟動不引用 |
| 36 | js/modules/favorites.js | _processEventReminders 有 try/catch |
| 37 | js/modules/news.js | **已有 `if (this.renderNews)` 防護** |

---

## 四、結論：為什麼優化困難

### 核心數據

- 38 個 script 中，**28 個在啟動時被直接或間接呼叫**（不可動，含 event-external-transit.js 第三次驗證降級）
- **3 個**需加防護後才能延遲
- **7 個**可安全延遲（原為 8 個，event-external-transit.js 降級）
- 延遲 7 個 script ≈ 減少 **18%** 首次載入 script 數量（38→31）
- ⚠️ 7 個中有 4 個不在任何 ScriptLoader group，必須先加入才能移除

### 根本原因

1. **`init()` 是大平面** — 37 個函式呼叫全部平鋪，沒有分群組
2. **`renderGlobalShell()` 強耦合** — 通知 badge + 積分 + 儲存條，啟動時就要顯示
3. **首頁太豐富** — 輪播+公告+活動+賽事+贊助+新聞+廣告
4. **`bindImageUpload` 呼叫 13 次** — 啟動時一次性綁定所有頁面表單
5. **隱藏依賴** — message-inbox.js 的函式被 message-render.js 偷偷引用

---

## 五、分階段實作計劃

> ⚠️ **鐵律**：每個 Phase 獨立完成+部署+驗證，確認無問題才進下一個 Phase。
> 絕對不可跨 Phase 合併。每個 Phase 都是一個獨立 commit。

---

### Phase A：加防護網（零風險，不改載入順序）

**目的**：讓 init() 中所有非核心呼叫容錯，為後續 Phase 鋪路。

**改動檔案**：`app.js`

**具體做法**：在 `init()` 中，將以下硬呼叫改為 `?.()` 可選呼叫：

```javascript
// app.js init() — Phase A 改動
init() {
  // 第 1 群：核心 UI（不改，硬呼叫保留）
  this.bindSportPicker();
  this.bindNavigation();
  this.bindDrawer();
  this.bindTheme();
  this.initFontSize();
  this.bindFilterToggle();
  this.bindTabBars();
  this.bindTournamentTabs();
  this.bindScanModes();
  this.bindNotifBtn();
  this.bindLineLogin();
  this._applyI18nToUI();

  // 第 2 群：加 ?.() 防護（即使模組未載入也不 crash）
  this.initPwaInstall?.();                    // ← 原本硬呼叫
  this.bindFloatingAds?.();                   // ← 原本硬呼叫
  this.bindImageUpload?.('ce-image', 'ce-upload-preview', 16/9);  // ← 每個都加
  // ... 13 個 bindImageUpload 都改成 ?.()
  this._bindAchBadgeUpload?.();               // ← 已有，保留
  this._populateAchConditionSelects?.();      // ← 已有，保留
  this.bindShopSearch?.();                    // ← 已有，保留
  this.bindTeamOnlyToggle?.();               // ← 已有，保留
  this.applySiteThemes?.();                   // ← 原本硬呼叫
  this.initLangSwitcher?.();                  // ← 原本硬呼叫

  // 第 3 群：渲染（保持硬呼叫）
  this.renderAll();
  this.applyRole('user', true);
},
```

**同時**在 `renderHomeDeferred()` 加防護：

```javascript
renderHomeDeferred() {
  if (!this._isHomePageActive()) return false;
  if (typeof this.renderOngoingTournaments === 'function') this.renderOngoingTournaments();  // ← 加防護（Phase C 會移除）
  this.renderSponsors();                                      // banner.js 定義，永遠存在
  if (this.renderNews) this.renderNews();                     // ← 已有防護 ✅
  this.renderFloatingAds();                                   // banner.js 定義，永遠存在
  if (typeof this.showPopupAdsOnLoad === 'function') this.showPopupAdsOnLoad();  // ← 加防護（Phase C 會移除）
  this.startBannerCarousel();                                 // banner.js 定義，永遠存在
  return true;
},
```

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

**⚠️ 風險點**：
- `renderHomeDeferred` 原本不是 async，改成 async 後呼叫端 `_scheduleHomeDeferredRender` 需確認是否有依賴回傳值
- `tournament-core.js` 可能被其他地方直接引用（如賽事頁），需確認不影響
- `popup-ad.js` 定義 `showPopupAdsOnLoad`，如果 init() 裡的 `bindFloatingAds` 引用了 popup-ad 的東西需確認（已驗證：`bindFloatingAds` 定義在 banner.js，與 popup-ad.js 無關 ✅）

**驗證清單**：
1. ✅ 首頁延遲區塊（賽事、贊助商、廣告）正常顯示（可能慢 100ms 但不影響體驗）
2. ✅ 首頁首屏（輪播+公告+活動）仍然秒出
3. ✅ 賽事頁面正常（ScriptLoader 從 _groups.tournament 載入）
4. ✅ 彈窗廣告正常觸發
5. ✅ Console 無新增 error

**commit message**：`啟動優化 Phase C：延遲渲染區塊改動態載入（30→27）`

---

### Phase D：bindImageUpload 懶綁定（高風險，需謹慎）

**目的**：把 13 次 bindImageUpload 改為「開對應頁面時才綁定」，而不是啟動時全綁。

**前置條件**：Phase A + B + C 已完成、穩定運行至少 1 天

**⚠️ 此 Phase 風險最高，原因**：
- 13 個表單散佈在不同頁面（活動建立、俱樂部建立、橫幅管理、主題管理...）
- 每個表單的 DOM 元素在 PageLoader 載入 HTML 片段後才存在
- 如果綁定時機早於 DOM 載入，會靜默失敗（不 crash 但上傳不動）

**做法概要（不詳列程式碼，風險太高需要逐一處理）**：

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

**替代方案（風險更低）**：
不移除 init() 的呼叫，而是讓 `bindImageUpload` 內部自動判斷 DOM 是否存在，不存在就跳過，等頁面載入後由 `_bindPageElements()` 再次觸發綁定。這樣改動最小。

**commit message**：`啟動優化 Phase D：bindImageUpload 改按頁面懶綁定`

---

## 六、預期效果

| Phase | 移除 script 數 | 剩餘 script 數 | 風險 | 預估節省 |
|-------|---------------|---------------|------|---------|
| A | 0 | 38 | 零 | 0（但為後續鋪路） |
| B | 7 | 31 | 低 | ~70KB + 7 次 HTTP 請求 |
| C | 3 | 28 | 中 | ~30KB + 3 次 HTTP 請求 |
| D | 0 | 28 | 高 | 啟動時 13 次 DOM 查詢 + 事件綁定 |
| **總計** | **10** | **28** | — | **~100KB + 10 次 HTTP 請求** |

> 注意：Service Worker 的 cache-first 策略意味著第二次訪問已經很快。
> 這些優化主要改善**首次訪問**和**清快取後**的體驗。

---

## 七、歷史教訓（必讀）

> 2026-03-17～18：嘗試將 script 從 index.html 移到動態載入，造成：
> - `bindLineLogin is not a function` — profile-form.js 被移但 init() 硬呼叫它
> - `updatePointsDisplay is not a function` — profile-core.js 被移但 renderGlobalShell 硬呼叫
> - image-cropper 失效 — 移除但 image-upload 依賴它
> - message-notify 失效 — 移除後通知功能壞掉
>
> 2026-03-19：再次嘗試 init 分拆（initCore + initModules），同樣失敗，已 rollback。
>
> **核心教訓**：不能只看「這個檔案是否被 init() 直接呼叫」，還要追蹤隱藏的間接依賴鏈。
> 本文件的價值就是把這些隱藏依賴全部挖出來，讓未來的修改有據可依。
