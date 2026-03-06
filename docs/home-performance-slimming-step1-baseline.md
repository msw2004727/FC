# SportHub 首頁性能瘦身 V2 — Step 1 基線凍結與施工矩陣

## 1. 文件定位

本文件是 V2 升級的 Step 1 交付物。

目的不是提出新方案，而是把目前專案的真實啟動鏈、首頁直接依賴、頁面映射與已知缺口完整凍結，作為 Step 2 施工前的唯一基線。

本文件結論只回答三件事：

1. 現況首頁到底依賴哪些模組才不會爆。
2. 現況 `PageLoader` / `ScriptLoader` / `FirebaseService` 的映射有哪些缺口。
3. Step 2 在不移除任何首頁 script 的前提下，必須先補哪些契約。

---

## 2. 基線快照

- 基線日期：`2026-03-06`
- 基線 commit：`da9ef82`
- `index.html` 本地 defer script：`56` 支
- `index.html` 目前 eager 載入的 `js/modules/*`：`42` 支
- `js/modules/` 目錄總數：`45` 檔
- `js/modules/` 總大小：`975,940 bytes`（未壓縮）

目前狀態不是「已有 loader 架構」，而是「loader 存在，但仍被大量 eager scripts 掩蓋」。因此很多頁面映射缺口尚未在使用者端暴露。

---

## 3. 當前啟動鏈凍結

### 3.1 啟動順序

目前正式版冷啟動順序如下：

1. `DOMContentLoaded` 時先讀取 `?event=` / `?team=`，寫入 session storage。
2. 啟動 deep link guard 與輪詢器。
3. 啟動 `PageLoader.loadAll()`，但不等待完成。
4. 正式版從 localStorage 還原 Firebase cache。
5. 直接執行 `App.init()`，不等待 HTML 片段、CDN SDK、Firebase、LIFF ready。
6. `PageLoader.loadAll()` 完成後，再補跑一次 `App.renderAll()` 與 `App._bindPageElements()`。
7. 背景載入 Firebase / LIFF CDN，完成後才執行 `LineAuth.initSDK()`、`FirebaseService.init()`，之後再補跑一次 `App.renderAll()`。
8. deep link guard 在背景輪詢資料與登入狀態，條件符合後直接呼叫 `App.showEventDetail()` / `App.showTeamDetail()`。

### 3.2 基線判定

目前啟動鏈的本質是：

1. `render-before-page-ready`
2. `render-before-cloud-ready`
3. `deep-link-before-route-gateway`

這也是 V2 必須先做 Step 2 gateway 的原因。若先移 script，再補契約，首頁與 detail 首訪會先炸。

---

## 4. `index.html` 當前 eager 載入基線

### 4.1 Core Runtime

目前以下 core runtime 直接由 `index.html` eager 載入：

1. `js/config.js`
2. `js/data.js`
3. `js/firebase-config.js`
4. `js/firebase-service.js`
5. `js/firebase-crud.js`
6. `js/api-service.js`
7. `js/line-auth.js`
8. `js/core/page-loader.js`
9. `js/core/script-loader.js`
10. `app.js`
11. `js/core/navigation.js`
12. `js/core/theme.js`
13. `js/core/mode.js`

### 4.2 目前仍 eager 的功能模組

目前 `index.html` 直接 eager 載入的功能模組，可分成四類：

1. 首頁或 bootstrap 真正直接依賴
   - `image-upload.js`
   - `role.js`
   - `profile-core.js`
   - `profile-data.js`
   - `banner.js`
   - `popup-ad.js`
   - `announcement.js`
   - `site-theme.js`
   - `event-list.js`
   - `event-manage.js`
   - `tournament-render.js`
   - `achievement.js`
   - `favorites.js`
   - `message-inbox.js`

2. 實際上是首頁依賴，但目前 V2 白名單尚未完整反映
   - `shop.js`
   - `event-create.js`
   - `ad-manage-core.js`

3. 路由頁功能，但目前仍被首頁一起載入
   - `profile-card.js`
   - `event-detail.js`
   - `event-detail-signup.js`
   - `event-detail-companion.js`
   - `tournament-manage.js`
   - `team-list.js`
   - `team-detail.js`
   - `team-form.js`
   - `message-admin.js`
   - `dashboard.js`
   - `personal-dashboard.js`
   - `leaderboard.js`
   - `user-admin-list.js`
   - `user-admin-exp.js`
   - `user-admin-roles.js`
   - `error-log.js`
   - `auto-exp.js`
   - `scan.js`
   - `attendance-notify.js`
   - `shot-game-page.js`

4. 管理頁專用，但首頁仍一起載入
   - `ad-manage-banner.js`
   - `ad-manage-float.js`
   - `ad-manage-popup-sponsor.js`
   - `ad-manage-shotgame.js`
   - `game-manage.js`

### 4.3 首頁 CDN preload 現況

首頁雖然沒有同步執行 Firebase / LIFF SDK，但 `index.html` 仍 preload：

1. `firebase-app-compat.js`
2. `firebase-firestore-compat.js`
3. `firebase-storage-compat.js`
4. `firebase-auth-compat.js`
5. `firebase-functions-compat.js`
6. `liff sdk.js`

結論：目前只是「延後執行」，不是「真正延後下載」。

---

## 5. 首頁 Bootstrap 直接依賴矩陣

### 5.1 `App.init()` 直接依賴

| 呼叫方法 | 目前 runtime owner | 來源檔案 | Step 1 判定 |
|---|---|---|---|
| `bindRoleSwitcher()` | `role.js` | `js/modules/role.js` | 必留 bootstrap |
| `bindLineLogin()` | `profile-core.js` | `js/modules/profile-core.js` | 必留 bootstrap |
| `bindImageUpload()` | `image-upload.js` | `js/modules/image-upload.js` | 必留 bootstrap |
| `_bindAchBadgeUpload()` | `achievement.js` | `js/modules/achievement.js` | 必留 bootstrap |
| `_populateAchConditionSelects()` | `achievement.js` | `js/modules/achievement.js` | 必留 bootstrap |
| `bindShopSearch()` | `shop.js` | `js/modules/shop.js` | V2 白名單缺漏，暫不能移出 |
| `bindTeamOnlyToggle()` | `event-create.js`（檔內重複定義，後者生效） | `js/modules/event-create.js` | V2 白名單缺漏，且 owner 需要先整理 |
| `renderBannerCarousel()` | `banner.js` | `js/modules/banner.js` | 必留 bootstrap |
| `startBannerCarousel()` | `banner.js` | `js/modules/banner.js` | 必留 bootstrap |
| `applySiteThemes()` | `site-theme.js` | `js/modules/site-theme.js` | 必留 bootstrap |

### 5.2 `App.renderAll()` 直接依賴

| 呼叫方法 | 目前 runtime owner | 來源檔案 | Step 1 判定 |
|---|---|---|---|
| `renderHotEvents()` | `event-list.js` | `js/modules/event-list.js` | 必留 bootstrap |
| `renderOngoingTournaments()` | `tournament-render.js` | `js/modules/tournament-render.js` | 必留 bootstrap |
| `renderBannerCarousel()` | `banner.js` | `js/modules/banner.js` | 必留 bootstrap |
| `renderFloatingAds()` | `banner.js` | `js/modules/banner.js` | 必留 bootstrap |
| `renderSponsors()` | `banner.js` | `js/modules/banner.js` | 必留 bootstrap |
| `renderAnnouncement()` | runtime 最終 owner 為 `announcement.js`，但 `banner.js` 也定義同名方法 | `js/modules/banner.js`, `js/modules/announcement.js` | 必留 bootstrap，且需解決同名覆寫 |
| `renderAchievements()` | `achievement.js` | `js/modules/achievement.js` | 必留 bootstrap |
| `updateNotifBadge()` | `message-inbox.js` | `js/modules/message-inbox.js` | 必留 bootstrap |
| `updatePointsDisplay()` | `profile-core.js` | `js/modules/profile-core.js` | 必留 bootstrap |
| `updateStorageBar()` | `message-inbox.js` | `js/modules/message-inbox.js` | 必留 bootstrap |

### 5.3 啟動後補跑與延遲呼叫依賴

| 呼叫方法 | owner | Step 1 判定 |
|---|---|---|
| `showPopupAdsOnLoad()` | `popup-ad.js` | 必留 bootstrap，否則 Phase 4 後定時呼叫會出錯 |
| `renderProfileData()` | `profile-data.js` | 仍屬首頁登入回填流程 |
| `renderProfileFavorites()` | `favorites.js` | 會被登入回填與個人頁入口直接呼叫 |

### 5.4 Step 1 對 V2 白名單的修正結論

目前 V2 討論稿雖然方向正確，但 Step 1 實測後確認以下補正：

1. `shop.js` 在 Step 2 前不能直接移出首頁，因為 `App.init()` 直接呼叫 `bindShopSearch()`。
2. `event-create.js` 在 Step 2 前不能直接移出首頁，因為 `bindTeamOnlyToggle()` 目前由 `event-create.js` 提供，而且檔內還有重複定義，需先整理 owner。
3. `ad-manage-core.js` 在 `trackAdClick()` 抽成 shared runtime 前不能直接移出首頁，否則 banner / floating ad / sponsor / popup 的點擊追蹤會失效。

---

## 6. Route Entry 與導航面真實入口

### 6.1 當前主入口

目前可進入頁面或 detail 的入口共有四條：

1. `showPage(pageId)` 導航入口
2. `hashchange -> App.showPage(pageId)`
3. deep link guard 直接呼叫 `showEventDetail(id)` / `showTeamDetail(id)`
4. 多個首頁卡片 / 球隊卡 / 個人頁 inline `onclick="App.showEventDetail(...)"` / `App.showTeamDetail(...)`

### 6.2 Step 1 判定

目前 detail entry 並未經過統一 gateway。

也就是說：

1. detail method 並沒有先保證 page HTML ready
2. detail method 並沒有先保證 script group ready
3. deep link 目前是「資料 ready 就直接打 detail method」

這是 Step 2 必須優先收斂的核心風險。

---

## 7. `PageLoader` / `ScriptLoader` / `FirebaseService` 基線矩陣

### 7.1 `PageLoader` 現況

- boot pages：`home`, `activity`, `team`, `message`, `profile`
- deferred pages：`scan`, `tournament`, `shop`, `admin-users`, `admin-content`, `admin-system`, `admin-dashboard`, `admin-auto-exp`, `personal-dashboard`, `game`

Step 1 確認：

1. boot pages 之外的頁面，第一次進入理論上必須依賴 `ensurePage(pageId)`。
2. 但目前 `showPage()` 沒有 `await PageLoader.ensurePage(pageId)`，存在 race condition。

### 7.2 `ScriptLoader` 現況

目前 `_pageGroups` 最大問題不是 group 不存在，而是「很多頁面在今天看似正常，只是因為模組還全都在 `index.html`」。

### 7.3 `FirebaseService.ensureCollectionsForPage()` 現況

目前資料載入映射並非全面缺失，但也不是完整路由契約。它只覆蓋了部分頁面，且很多頁面目前之所以能工作，是因為：

1. 靜態 boot collections 本來就預先載入
2. 某些 listener 在 Firebase init 後自動啟動
3. 所有路由模組今天仍是 eager

---

## 8. Step 1 已確認的映射缺口

### 8.1 高風險缺口

| 項目 | 當前狀態 | 風險 |
|---|---|---|
| `showPage()` 未 `await PageLoader.ensurePage()` | 存在 | 首訪頁面可能先 render 再等 HTML |
| `showPage()` 未 `await ScriptLoader.ensureForPage()` | 存在 | 一旦移除 eager script，首訪頁會直接缺方法 |
| deep link 直接呼叫 `showEventDetail()` / `showTeamDetail()` | 存在 | 冷啟動 detail 首訪失敗 |
| `page-admin-error-logs` 無 `PageLoader` 映射 | 存在 | 首次進入管理錯誤日誌頁時可能頁面 DOM 尚未存在 |
| `page-admin-error-logs` 無 `ScriptLoader` 映射 | 存在 | 一旦移除 eager `error-log.js` 會首訪失敗 |
| `page-game` 無 `ScriptLoader` 映射 | 存在 | 一旦移除 eager `shot-game-page.js` 會首訪失敗 |
| `page-qrcode` 被映射到 `scan` group | 存在 | 真正 owner 是 `profile-card.js`，群組錯配 |
| `page-leaderboard` 被映射到 `admin` group | 存在 | 真正 owner 是 `leaderboard.js`，群組錯配 |
| `page-admin-repair` 無顯式 loader 契約 | 存在 | 頁面可進入，但沒有被正式納入 loader 設計 |

### 8.2 中風險缺口

| 項目 | 當前狀態 | 風險 |
|---|---|---|
| `renderAnnouncement()` 同名覆寫 | 存在 | 載入順序改變會影響首頁公告與後台公告行為 |
| `bindTeamOnlyToggle()` 在 `event-create.js` 內重複定義 | 存在 | 若未先整理 owner 就抽離首頁，行為邊界不清楚 |
| `trackAdClick()` 位於 admin 模組 | 存在 | 首頁廣告點擊追蹤無法獨立於 admin runtime |

### 8.3 低風險但必須記錄

| 項目 | 當前狀態 | 備註 |
|---|---|---|
| `team.js` 仍存在舊版 `showTeamDetail()` 與相關 team owner | 存在但未被 `index.html` 載入 | 屬 legacy 檔案，Step 2 不應誤納入主群組 |
| `shot-game-lab-page.js` 存在 | 存在但不屬主站 page route | 屬 lab 專用，不應誤判為主站 route owner |

---

## 9. Step 1 施工矩陣結論

### 9.1 Step 2 前不可做的事

1. 不可先從 `index.html` 移除 `shop.js`
2. 不可先從 `index.html` 移除 `event-create.js`
3. 不可先從 `index.html` 移除 `ad-manage-core.js`
4. 不可先移除任何 detail route 模組後再回頭補 gateway
5. 不可先調整 deep link 再忽略 `showPage()` 的 await 契約

### 9.2 Step 2 前必做清單

1. 建立統一 page gateway，讓 `showPage()` 走 `load-before-render`
2. 建立 detail gateway，讓 `showEventDetail()` / `showTeamDetail()` 不再直接裸打
3. 補齊以下 page 契約：
   - `page-game`
   - `page-admin-error-logs`
   - `page-admin-repair`
   - `page-qrcode`
   - `page-leaderboard`
4. 決定 `bindShopSearch()` 的暫時 owner 邊界
5. 決定 `bindTeamOnlyToggle()` 的單一 owner，或先抽成 shared bootstrap helper
6. 決定 `trackAdClick()` 是否先抽成 shared `ad-runtime`

### 9.3 Step 1 Gate 判定

Step 1 結論為：

- `Go`，可以進入 Step 2
- 但 Step 2 的任務不是移 script，而是先補導航與 detail gateway 契約

換句話說，Step 1 已確認 V2 方向正確，但也證明了「先移 script、後補契約」在這個專案中不可接受。

---

## 10. Step 2 前置提醒

進入 Step 2 前，必須把目標限定為：

1. 不移除 `index.html` 任何功能模組
2. 只建立 gateway 與 await 契約
3. 只補 page/group/data mapping
4. 不碰雲端延後初始化
5. 不碰首頁 critical / deferred render 拆分

若 Step 2 過程中混入 script slimming、cloud delay、首頁 render 拆分，風險會重新變成 Big Bang 改造，違反 V2 安全原則。

---

## 11. 關鍵原始碼定位

以下位置是 Step 1 判定時的主要依據：

1. `app.js`
   - `App.init()` / `renderAll()` / `_bindPageElements()`
   - deep link guard / `_tryOpenPendingDeepLink()`
   - `DOMContentLoaded` 四階段啟動流程
2. `js/core/navigation.js`
   - `showPage(pageId, options)`
   - `_renderPageContent(pageId)`
3. `js/core/page-loader.js`
   - `_bootPages`
   - `_deferredPages`
   - `_pageFileMap`
   - `ensurePage(pageId)`
4. `js/core/script-loader.js`
   - `_groups`
   - `_pageGroups`
   - `ensureForPage(pageId)`
5. `js/firebase-service.js`
   - `_bootCollections`
   - `_deferredCollections`
   - `_collectionPageMap`
   - `ensureCollectionsForPage(pageId)`
6. `js/modules/shop.js`
   - `bindShopSearch()`
7. `js/modules/event-create.js`
   - `bindTeamOnlyToggle()`（檔內重複定義）
8. `js/modules/ad-manage-core.js`
   - `trackAdClick()`
9. `js/modules/announcement.js` / `js/modules/banner.js`
   - `renderAnnouncement()` 同名方法
