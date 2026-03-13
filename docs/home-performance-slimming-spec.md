# SportHub 首頁性能瘦身升級規格書 V2（討論版）

## 1. 文件定位

本文件是 `docs/home-performance-slimming-spec.md` 的 V2 專案版升級規格。

目的不是追求最激進的瘦身，而是用「最低回歸風險」完成首頁性能升級，並且明確避開目前專案中會造成首頁爆炸、deep link 失效、首頁卡片點擊失效的錯誤拆法。

本版結論：

1. 不接受「把所有 `js/modules/*` 直接搬出 `index.html`」的做法。
2. 採用「首頁 bootstrap 白名單 + 路由群組按需載入 + deep link 安全閘門」三段式升級。
3. 先修正載入邊界與導航契約，再做腳本瘦身，再做雲端延後初始化與首頁分階段渲染。

---

## 2. V2 決策摘要

### 2.1 V1 規格不安全的原因

現況中，`App.init()`、`renderAll()`、`bindLineLogin()` 與首頁卡片點擊，已經直接依賴多個 `js/modules/*` 方法。若直接把所有模組移出 `index.html`，會出現以下問題：

1. 首頁啟動即報錯：`App.init()` 直接呼叫的模組方法不存在。
2. 首頁卡片首點失敗：Hot Events 直接呼叫 `App.showEventDetail()`，但對應模組可能尚未載入。
3. Deep link 首次進站失敗：`?event=` / `?team=` 目前會直接走 detail 方法，沒有先保證 HTML / JS / data ready。
4. 頁面首訪 race condition：`showPage()` 目前沒有 `await PageLoader.ensurePage()`，也沒有 `await ScriptLoader.ensureForPage()`。
5. 載入順序敏感：部分方法存在「多模組同名覆寫」現象，不能靠目前 script 順序碰運氣。

### 2.2 V2 升級原則

1. 先保證不壞，再談更瘦。
2. 任何頁面都必須先 `load-before-render`，不可先 render 再等腳本或 HTML。
3. 任何 deep link 都必須先經過安全閘門，不可直接打 detail method。
4. 首頁首訪不得載入明顯無關的 Team / Shop / Scan / Admin / Game 頁面腳本。
5. 隱藏頁面的 UI 不得在首頁首訪時被預先 render。
6. 共用能力必須有單一 owner，不接受用 load order 撐出正確行為。

---

## 3. 升級目標

### 3.1 主要目標

1. 提升首頁首屏可見速度與可互動速度。
2. 保持產品行為不變，特別是登入、首頁卡片點擊、deep link、受保護頁進入流程。
3. 將非首頁功能改成按需載入，不再於首次首頁載入時全部解析。

### 3.2 成功標準

1. 首次進入 `page-home` 時，不再載入 Team / Shop / Scan / Game / Admin 類模組。
2. `?event=` 與 `?team=` 在冷啟動、未登入返回、快取命中三種情境下都可正確落地。
3. 首次進入任一主頁或管理頁時，頁面 HTML、模組腳本、資料集合都能先 ready 再 render。
4. 首頁首訪不再執行隱藏頁面專屬 render。
5. Firebase / LIFF 雲端初始化可延後，但不影響受保護頁與 deep link 行為。

---

## 4. 範圍

### 4.1 In Scope

1. `index.html` 首頁 boot script 策略
2. `js/core/script-loader.js` 群組與頁面映射
3. `js/core/navigation.js` 的載入契約與切頁流程
4. `app.js` 的雲端啟動時機與首頁 render 拆分
5. deep link 安全流程
6. 首頁 critical / deferred 渲染拆分

### 4.2 Out of Scope

1. Firestore schema 變更
2. 視覺重設計
3. 新功能開發
4. Service Worker 強制清 cache 策略改版

---

## 5. V2 安全升級策略

### 5.1 三層載入模型

V2 採用以下三層：

1. `Bootstrap White List`
   - 首頁啟動一定要有，否則 `App.init()`、`renderAll()`、登入回填、首頁卡片交互會失敗。
2. `Route Feature Groups`
   - 依頁面或頁面族群載入，必須在 render 前完成。
3. `Secondary Lazy Assets`
   - 只有頁內才需要的次級資源，例如 `shot-game-engine.js`、Three.js、QR Code 外部腳本。

### 5.2 升級順序

V2 必須按以下順序實施，不可跳步：

1. 先建立 bootstrap 白名單與 loader 契約。
2. 再把非白名單模組移出 `index.html`。
3. 再把雲端初始化改成 `App.ensureCloudReady()`。
4. 最後才拆首頁 critical / deferred render。

---

## 6. 首頁 Bootstrap 白名單

### 6.1 規則

以下檔案在 V2 cutover 完成前，必須留在 `index.html`，不得先移除。

凡是不在白名單內的檔案，才是按需載入候選。

### 6.2 Core Runtime White List

1. `js/i18n.js`
2. `js/config.js`
3. `js/data.js`
4. `js/firebase-config.js`
5. `js/firebase-service.js`
6. `js/firebase-crud.js`
7. `js/api-service.js`
8. `js/line-auth.js`
9. `js/core/page-loader.js`
10. `js/core/script-loader.js`
11. `app.js`
12. `js/core/navigation.js`
13. `js/core/theme.js`
14. `js/core/mode.js`

### 6.3 Feature Bootstrap White List

| 檔案 | 保留原因 |
|---|---|
| `js/modules/role.js` | `App.init()` 直接依賴 `bindRoleSwitcher()` / `applyRole()` / `renderDrawerMenu()` |
| `js/modules/image-upload.js` | `App.init()` 與 `App._bindPageElements()` 直接依賴 `bindImageUpload()` |
| `js/modules/profile-core.js` | `bindLineLogin()`、`renderLoginUI()`、`updatePointsDisplay()` 屬首頁啟動流程 |
| `js/modules/profile-data.js` | 登入成功回填流程會直接呼叫 `renderProfileData()` |
| `js/modules/site-theme.js` | `App.init()` 直接呼叫 `applySiteThemes()` |
| `js/modules/favorites.js` | `renderHotEvents()` / `renderTournamentDetail()` 直接用到收藏 helper |
| `js/modules/event-list.js` | 首頁 Hot Events 與活動列表主 render owner |
| `js/modules/event-manage.js` | 登入回填流程直接呼叫 `renderMyActivities()`；活動詳情也依賴其 attendance/unreg table |
| `js/modules/tournament-render.js` | 首頁 Ongoing Tournaments 與 tournament detail 入口 owner |
| `js/modules/banner.js` | 首頁 banner / floating ads / sponsors render owner |
| `js/modules/announcement.js` | 首頁公告詳情與公告後台目前共用同一 owner |
| `js/modules/achievement.js` | `renderAchievements()`、`_bindAchBadgeUpload()`、`_populateAchConditionSelects()` 目前在啟動流程中被直接呼叫 |
| `js/modules/message-inbox.js` | `renderAll()` 直接依賴 `updateNotifBadge()` / `updateStorageBar()` |
| `js/modules/popup-ad.js` | `app.js` 在啟動後會直接排程 `showPopupAdsOnLoad()` |

### 6.4 白名單附註

1. `event-detail.js`、`event-detail-signup.js`、`event-detail-companion.js` 不列入 bootstrap 白名單，但前提是要先完成 route gateway 與 loader-safe entry flow。
2. `profile-card.js` 不列入 bootstrap 白名單，但進入 `page-profile` / `page-qrcode` / `page-user-card` 前必須先由 loader 載入。
3. `trackAdClick()` 目前位於 `ad-manage-core.js`，但首頁 banner / popup / sponsor 點擊也會用到。V2 實作時應先抽成獨立共用模組，例如 `js/modules/ad-runtime.js`；在抽離完成前，不得讓首頁點擊追蹤失效。

---

## 7. 模組分層

### 7.1 Layer 定義

| Layer | 說明 | 載入時機 |
|---|---|---|
| L0 | Core Runtime | 一律隨 `index.html` 載入 |
| L1 | Bootstrap Shared / Home Runtime | 一律隨 `index.html` 載入 |
| L2 | Route Feature Groups | 切頁前按需載入 |
| L3 | Secondary Lazy Assets | 頁內互動時才載入 |

### 7.2 V2 模組群組

| 群組 | 模組 |
|---|---|
| `bootstrap-core` | `js/i18n.js`, `js/config.js`, `js/data.js`, `js/firebase-config.js`, `js/firebase-service.js`, `js/firebase-crud.js`, `js/api-service.js`, `js/line-auth.js`, `js/core/page-loader.js`, `js/core/script-loader.js`, `app.js`, `js/core/navigation.js`, `js/core/theme.js`, `js/core/mode.js` |
| `bootstrap-shared` | `role.js`, `image-upload.js`, `profile-core.js`, `profile-data.js`, `site-theme.js`, `favorites.js`, `event-list.js`, `event-manage.js`, `tournament-render.js`, `banner.js`, `announcement.js`, `achievement.js`, `message-inbox.js`, `popup-ad.js` |
| `activity-route` | `event-detail.js`, `event-detail-signup.js`, `event-detail-companion.js`, `event-create.js` |
| `team-route` | `team-list.js`, `team-detail.js`, `team-form.js` |
| `profile-route` | `profile-card.js` |
| `shop-route` | `shop.js`, `leaderboard.js` |
| `message-admin` | `message-admin.js` |
| `scan-route` | `scan.js`, `attendance-notify.js` |
| `game-route` | `shot-game-page.js` |
| `tournament-admin` | `tournament-manage.js` |
| `admin-dashboard` | `dashboard.js` |
| `personal-dashboard` | `personal-dashboard.js` |
| `admin-users` | `user-admin-list.js`, `user-admin-exp.js`, `user-admin-roles.js` |
| `admin-content` | `ad-manage-core.js`, `ad-manage-banner.js`, `ad-manage-float.js`, `ad-manage-popup-sponsor.js`, `ad-manage-shotgame.js` |
| `admin-system` | `game-manage.js`, `error-log.js`, `auto-exp.js` |

### 7.3 L3 次級 Lazy 資源

| 資源 | owner |
|---|---|
| `js/modules/shot-game-engine.js` | `shot-game-page.js` 內部二次 lazy load |
| Three.js / GLTFLoader | `shot-game-page.js` 或 `game-lab.html` |
| QRCode CDN | `profile-card.js` 內 `_generateQrCode()` |

### 7.4 模組 owner 規則

V2 實作時必須遵守：

1. 同一個 UI 行為只允許一個主 owner。
2. 不再接受靠 script 載入順序覆寫同名方法。
3. 若共用能力同時被首頁與後台使用，必須抽成 shared runtime，再讓後台管理模組依賴該 shared runtime。

---

## 8. Loader 映射表（V2）

### 8.1 導航契約

所有切頁與入口流程，在 V2 必須統一遵守以下順序：

1. 權限與登入檢查
2. 若該頁需要雲端：`await App.ensureCloudReady()`
3. `await PageLoader.ensurePage(pageId)`
4. `await ScriptLoader.ensureForPage(pageId)`
5. `await FirebaseService.ensureCollectionsForPage(pageId)`（若有對應集合）
6. 最後才執行 `_renderPageContent(pageId)` 或 detail/init method

### 8.2 Page -> Group 映射

| pageId | HTML fragment | Script groups | Data collections | Cloud ready |
|---|---|---|---|---|
| `page-home` | `home.html` | bootstrap only | boot collections + live `events` / `teams` | 非 deep link 時可延後 |
| `page-activities` | `activity.html` | `activity-route` | `attendanceRecords`, `activityRecords`, `registrations` | 是 |
| `page-activity-detail` | `activity.html` | `activity-route` | `registrations`, `attendanceRecords` | 是 |
| `page-my-activities` | `activity.html` | `activity-route` | `attendanceRecords`, `activityRecords`, `registrations` | 是 |
| `page-teams` | `team.html` | `team-route` | 以 live `teams` 為主 | 否，但 prod 建議已 ready |
| `page-team-detail` | `team.html` | `team-route` | 以 live `teams` 為主 | 否，但 prod 建議已 ready |
| `page-team-manage` | `team.html` | `team-route` | 以 live `teams` 為主 | 是 |
| `page-tournaments` | `tournament.html` | bootstrap only | `tournaments`, `standings`, `matches` | 是 |
| `page-tournament-detail` | `tournament.html` | bootstrap only | `tournaments`, `standings`, `matches` | 是 |
| `page-profile` | `profile.html` | `profile-route` | `attendanceRecords`, `activityRecords` | 是 |
| `page-qrcode` | `profile.html` | `profile-route` | none | 否 |
| `page-achievements` | `profile.html` | bootstrap only | boot `achievements`, `badges` | 否 |
| `page-titles` | `profile.html` | bootstrap only | none | 否 |
| `page-user-card` | `profile.html` | `profile-route` | `attendanceRecords`, `activityRecords`（顯示記錄時） | 視情況 |
| `page-messages` | `message.html` | bootstrap only | `messages`（auth listener） | 是 |
| `page-shop` | `shop.html` | `shop-route` | `shopItems`, `trades` | 是 |
| `page-shop-detail` | `shop.html` | `shop-route` | `shopItems`, `trades` | 是 |
| `page-leaderboard` | `shop.html` | `shop-route` | `leaderboard` | 是 |
| `page-scan` | `scan.html` | `scan-route` | `attendanceRecords` | 是 |
| `page-game` | `game.html` | `game-route` | `gameConfigs` | 是 |
| `page-personal-dashboard` | `personal-dashboard.html` | `personal-dashboard` | `attendanceRecords`, `activityRecords` | 是 |
| `page-admin-dashboard` | `admin-dashboard.html` | `admin-dashboard` | `expLogs`, `teamExpLogs`, `operationLogs`, `attendanceRecords`, `activityRecords` | 是 |
| `page-admin-users` | `admin-users.html` | `admin-users` | `permissions`, `customRoles` | 是 |
| `page-admin-exp` | `admin-users.html` | `admin-users` | `expLogs`, `teamExpLogs` | 是 |
| `page-admin-repair` | `admin-system.html` | `admin-users` | current users cache | 是 |
| `page-admin-banners` | `admin-content.html` | `admin-content` | `banners`, `floatingAds`, `popupAds`, `sponsors`, `gameConfigs` | 是 |
| `page-admin-shop` | `admin-content.html` | `shop-route` | `shopItems`, `trades` | 是 |
| `page-admin-teams` | `admin-content.html` | `team-route` | `tournaments`, `standings`, `matches` | 是 |
| `page-admin-messages` | `admin-content.html` | `message-admin` | `adminMessages`, `notifTemplates` | 是 |
| `page-admin-tournaments` | `admin-content.html` | `tournament-admin` | `tournaments`, `standings`, `matches` | 是 |
| `page-admin-achievements` | `admin-system.html` | bootstrap only | `achievements`, `badges` | 是 |
| `page-admin-games` | `admin-system.html` | `admin-system` | `gameConfigs` | 是 |
| `page-admin-themes` | `admin-system.html` | bootstrap only | `siteThemes` | 是 |
| `page-admin-announcements` | `admin-system.html` | bootstrap only | `announcements` | 是 |
| `page-admin-roles` | `admin-system.html` | `admin-users` | `permissions`, `customRoles` | 是 |
| `page-admin-inactive` | `admin-system.html` | `admin-users` | `attendanceRecords`, `activityRecords`, `operationLogs` | 是 |
| `page-admin-logs` | `admin-system.html` | `admin-users` | `operationLogs` | 是 |
| `page-admin-error-logs` | `admin-system.html` | `admin-system` | `errorLogs` | 是 |
| `page-admin-auto-exp` | `admin-auto-exp.html` | `admin-system` | `expLogs` | 是 |

### 8.3 ScriptLoader 補充規則

1. `page-home` 不走大雜燴 group，只依賴 bootstrap 白名單。
2. `page-activities`、`page-activity-detail`、`page-my-activities` 同屬 `activity-route`。
3. `page-profile`、`page-qrcode`、`page-user-card` 同屬 `profile-route`。
4. `page-admin-repair` 必須補進 loader 映射，不可漏。
5. `page-admin-error-logs` 與 `page-game` 必須明確映射，不可再依賴 `index.html` 全載入兜底。

---

## 9. Route Entry 安全規格

### 9.1 禁止事項

V2 實作時，禁止以下做法：

1. 在首頁卡片直接 `onclick="App.showEventDetail(...)"`，前提卻未保證 detail group 已載入。
2. Deep link 直接進 `showEventDetail()` / `showTeamDetail()`，前提卻未保證 target page / target scripts / data ready。
3. 先切 page、後補腳本。

### 9.2 建議入口方法

V2 應建立 route-safe gateway，命名可依實作調整，但責任需明確：

1. `App.openEventEntry(eventId, source)`
2. `App.openTeamEntry(teamId, source)`
3. `App.openShopEntry(itemId)`
4. `App.openGameEntry()`

若 `js/core/navigation.js` 因此超過 300 行，應拆出新檔，例如 `js/core/route-entry.js`。

### 9.3 Gateway 契約

以 `openEventEntry()` 為例：

1. `await App.ensureCloudReady()`（prod）
2. `await PageLoader.ensurePage('page-activity-detail')`
3. `await ScriptLoader.ensureForPage('page-activity-detail')`
4. `await FirebaseService.ensureCollectionsForPage('page-activity-detail')`
5. 驗證 event 是否存在
6. 最後才呼叫 `showEventDetail(eventId)`

Team、Shop、Game 入口遵守同一契約。

---

## 10. Deep Link 安全流程

### 10.1 支援範圍

1. `?event=<eventId>`
2. `?team=<teamId>`

### 10.2 標準流程

1. `DOMContentLoaded` 最先讀取 query params。
2. 將 deep link 任務寫入 session，例如 `_pendingDeepEvent` / `_pendingDeepTeam`。
3. 顯示 deep link overlay。
4. 立即 `await App.ensureCloudReady()`，不可走 idle。
5. 根據參數決定 target page：
   - `event` -> `page-activity-detail`
   - `team` -> `page-team-detail`
6. `await PageLoader.ensurePage(targetPage)`
7. `await ScriptLoader.ensureForPage(targetPage)`
8. `await FirebaseService.ensureCollectionsForPage(targetPage)`（若有對應）
9. 驗證資料存在：
   - event 不存在 -> fallback `page-activities`
   - team 不存在 -> fallback `page-teams`
10. 呼叫 detail method
11. 成功後清掉 query params 與 pending state
12. 關閉 overlay

### 10.3 Guest Event Preview 流程（V2 新增）

1. `?event=xxx` deep link 在未登入時，**不觸發 LIFF login redirect**。
2. `_tryOpenPendingDeepLink()` 允許 event type 在未登入時繼續：`if (!isAuthed && pending.type !== 'event')` 才擋。
3. 若 cache 未命中，直接 `db.collection('events').doc(id).get()` 取單筆。
4. 呼叫 `showEventDetail(id, { allowGuest: true })`，渲染 guest 版本。
5. Guest 版本中，互動按鈕（報名/取消/收藏）透過 `requestProtectedEventAction()` 觸發 `_requestLoginForAction()` → LINE 登入。
6. 分享與聯繫主辦人按鈕不需登入。

### 10.4 未登入返回流程（非 event 類型）

1. 若 deep link 命中且 prod 未登入（非 event 類型），允許觸發 LIFF login redirect。
2. redirect 前保留 pending state，不清 query。
3. redirect 回來後，deep link 流程重新走一次，不可直接假設 detail owner 已 ready。

### 10.5 Fallback 規則

| 情境 | fallback |
|---|---|
| LIFF / Firebase 初始化超時（guest event） | `page-home`，toast「活動詳情載入已逾時」 |
| LIFF / Firebase 初始化超時（logged in） | event -> `page-activities`；team -> `page-teams` |
| 使用者未登入且登入失敗 | `page-home`，保留 toast |
| 資料不存在 | event -> `page-activities`；team -> `page-teams` |
| detail render 失敗 | 導回 list page，不停留空白 detail page |

### 10.6 必守原則

Deep link 成功條件不是「有 query param」，而是「HTML + JS + data + auth state 全部 ready 後，detail page 成功打開」。

---

## 11. 雲端初始化 V2

### 11.1 目標

非 deep link、非受保護頁的首頁首訪，可以先完成本地 shell render，再延後 Firebase / LIFF 初始化。

### 11.2 `App.ensureCloudReady()` 契約

V2 必須建立 singleton promise gate，包住：

1. `_loadCDNScripts()`（串行，後續步驟需要 SDK）
2. `initFirebaseApp()`（串行，需要 SDK 已載入）
3. `LineAuth.initSDK()` + `FirebaseService.init()`（**並行**，避免 LIFF 阻塞資料載入）
4. `LineAuth.ensureProfile()`（在 3 完成後，僅限有 LIFF session 時）

規則：

1. 只允許初始化一次。
2. 所有受保護頁與 deep link 都透過此方法入場。
3. 首頁非 deep link 情境可透過 `requestIdleCallback` 或 fallback `setTimeout` 延後。
4. **LIFF init 不得阻塞 Firebase 資料載入**，guest deep link 不需要 LIFF。

### 11.3 啟動時機

| 情境 | 時機 |
|---|---|
| `?event=` / `?team=` deep link | 立即 |
| 使用者進入受保護頁 | 立即 |
| 首頁一般訪問 | idle / short delay |
| Demo mode | 不啟動 cloud gate |

### 11.4 CDN preload 策略

V2 建議：

1. 保留 `preconnect`
2. 將 Firebase / LIFF 的 `preload as=script` 視作待移除項
3. 只有在 `ensureCloudReady()` 穩定後，才移除或降級 preload，避免「名義上 deferred，實際上先下載」的假延後

---

## 12. 首頁渲染拆分 V2

### 12.1 核心原則

首頁首訪不應再執行隱藏頁面的 render。

目前 `renderAll()` 仍會在首頁首訪時做太多事，V2 必須拆成三塊：

1. `renderGlobalShell()`
2. `renderHomeCritical()`
3. `renderHomeDeferred()`

### 12.2 建議拆分

#### `renderGlobalShell()`（立即）

1. top bar / drawer / bottom tabs
2. mode badge / toast / loading shell
3. points placeholder / notif badge placeholder
4. theme / language / login shell

#### `renderHomeCritical()`（立即）

1. banner 第一屏或 skeleton
2. announcement marquee（若本地 cache 可用）
3. Hot Events 首批卡片
4. 首頁必要按鈕與滾動容器

#### `renderHomeDeferred()`（idle / in-viewport）

1. ongoing tournaments
2. sponsors
3. floating ads
4. popup ad decision
5. banner autoplay / 次級動畫

### 12.3 必須移出首頁首訪的 render

以下 render 不應再由首頁首訪驅動：

1. `renderAchievements()`：應只在 `page-achievements` 進入時觸發
2. `renderUserCard()`：應只在 `page-profile` / `page-user-card` 流程內觸發
3. 任何 admin page render
4. 任何 scan / shop / game page render

### 12.4 視覺穩定要求

1. 所有 deferred 區塊保留 skeleton 與保底高度
2. 不允許延後內容插入後造成大幅 layout jump
3. 若區塊在視窗外，可使用 `IntersectionObserver`

---

## 13. 風險評估

### 13.1 高風險

1. 直接移除 bootstrap 模組會讓首頁啟動報錯。
2. 未先建立 route gateway 就搬出 detail 模組，會導致首頁卡片與 deep link 首點失敗。
3. `showPage()` 若仍不 `await` HTML / script / data，就算 loader 映射正確也會有 race condition。

### 13.2 中風險

1. `renderAnnouncement()` 等同名方法目前有 load-order 敏感問題，owner 不清會造成行為漂移。
2. `trackAdClick()` 仍綁在後台模組時，首頁點擊追蹤容易在瘦身後失效。
3. 雲端初始化延後後，首次進入受保護頁的等待體感會更明顯，需要明確 loading state。

### 13.3 低風險

1. `PageLoader` 與 `FirebaseService.ensureCollectionsForPage()` 已有現成基礎，V2 是補齊契約，不是從零重寫。

---

## 14. 工作量評估

### 14.1 估時

| 階段 | 內容 | 粗估工時 |
|---|---|---|
| Phase A | 建立 bootstrap 白名單、補齊 loader contract、修正 page/group 映射 | 4-6 小時 |
| Phase B | 建立 route gateway、修正首頁卡片與 deep link 入場流程 | 6-8 小時 |
| Phase C | 建立 `App.ensureCloudReady()`、調整 Firebase / LIFF preload 策略 | 4-6 小時 |
| Phase D | 拆 `renderAll()`、移除首頁首訪對隱藏頁 render、導入 deferred render | 4-6 小時 |
| Phase E | 冷啟動、deep link、主頁首訪、admin 首訪、手機實機回歸 | 4-6 小時 |

### 14.2 總工時

總估時：`22-32 小時`

這比 V1 的 `10-15 小時` 更接近本專案現況，原因是：

1. 啟動邊界耦合比原規格假設更重。
2. deep link 與首頁卡片都需要安全入場重構。
3. 現有 loader 與 render 流程尚未真正串起來。

---

## 15. 驗證與驗收

### 15.1 功能驗證

1. 首頁冷啟動無 console error。
2. 首頁 Hot Events 首次點擊可正常打開 detail。
3. `?event=` deep link 在未登入返回後仍可落地。
4. `?team=` deep link 在冷啟動下可落地。
5. `page-teams`、`page-shop`、`page-scan`、`page-game`、各 admin page 首次進入都能正常載入。
6. 首次進入 `page-profile`、`page-qrcode`、`page-user-card` 不會因 `profile-card.js` 未載入而報錯。
7. banner / popup / sponsor 點擊追蹤仍有效。

### 15.2 性能驗證

1. 首頁首次訪問 network panel 中，不應再看到 Team / Shop / Scan / Admin / Game 模組腳本。
2. 比較前後 `DOMContentLoaded`、LCP、INP/TTI。
3. 主流手機上首頁滾動與點擊反應更順。
4. 首頁首訪不再執行隱藏頁面專屬 render。

---

## 16. 實作規則

### 16.1 版本與快取

未來進入實作階段時：

1. 只要修改 JS 或 HTML，必須同步更新 `js/config.js` 內 `CACHE_VERSION`
2. 必須同步更新 `index.html` 所有 `?v=`
3. 依專案規範追加 `docs/claude-memory.md`

本次 V2 文件改寫僅修改 `docs/*.md`，不涉及 JS / HTML，因此本次不需要 bump cache version。

### 16.2 文件更新規則

V2 若進一步被拆成實作批次，建議用以下標記：

1. `V2-A`：Bootstrap / loader contract
2. `V2-B`：Route gateway / deep link
3. `V2-C`：Cloud defer
4. `V2-D`：Home staged render

---

## 17. 交付物

1. 本文件：`docs/home-performance-slimming-spec.md`
2. 後續實作時的 bootstrap 白名單與 route group 對照
3. deep link 安全流程落地結果
4. 回歸測試與性能對比紀錄

---

## 18. Guest Event Preview（活動分享連結免登入預覽）

### 18.1 需求

用戶透過活動分享連結（`?event=xxx`）進入時，應能**快速預覽**活動頁面，**不需要跳轉登入**。只有當用戶點選互動按鍵（報名、取消、收藏等）時才觸發 LINE 登入。分享按鈕與聯繫主辦人按鈕除外，這兩個不需登入。

### 18.2 V1 實作失敗原因分析

V1 實作（commit `785a1bd`）新增了 `allowGuest` 選項與 `_pendingAuthAction` 系統，邏輯正確但存在**時序瓶頸**：

| 階段 | 耗時 | 說明 |
|------|------|------|
| CDN 腳本載入 | 2-5s | Firebase SDK + LIFF SDK |
| LIFF SDK init | 1-8s | **串行阻塞** Firebase init，guest 不需要 LIFF |
| FirebaseService.init | 2-5s | 載入所有 events 集合 |
| **合計** | **5-18s** | 12 秒 deep link guard 超時 → 切回首頁 |

**根本原因**：`ensureCloudReady()` 中 `LineAuth.initSDK()` **串行**執行在 `FirebaseService.init()` 之前。LIFF init 在外部瀏覽器可能耗時 1-8 秒，但 guest event preview 完全不需要 LIFF。

### 18.3 V2 修正方案

#### 修正 A：LIFF init 與 Firebase init 並行

`ensureCloudReady()` 內，將 `LineAuth.initSDK()` 與 `FirebaseService.init()` 放入同一個 `Promise.all` 並行執行。LIFF profile 取得移至兩者完成後。

**預期效果**：節省 1-8 秒，整體 boot 時間降至 4-10 秒。

#### 修正 B：Deep link 快速路徑 — 直接 Firestore 單筆取得

`_tryOpenPendingDeepLink()` 在 `ApiService.getEvent()` cache miss 時，直接用 `db.collection('events').doc(id).get()` 取單筆活動。不需等待所有 events 集合載入完成。

**預期效果**：事件可在 Firebase app init 後 1-2 秒內取得，不需等整個 `_loadEventsStatic()` 完成。

#### 修正 C：Guest 互動按鈕觸發登入

`showEventDetail(id, { allowGuest: true })` 渲染 guest 版本：
- 報名按鈕 → `requestProtectedEventAction('eventSignup', eventId)` → 觸發 `_requestLoginForAction`
- 取消/候補等按鈕 → 同上
- **分享按鈕** → 直接執行 `shareEvent()`，不需登入
- **聯繫主辦人** → 直接執行 `contactEventOrganizer()`，不需登入

### 18.4 時序改善對比

| | V1（串行） | V2（並行 + 直接取得） |
|---|---|---|
| CDN 載入 | 3s | 3s |
| LIFF init | +3s（串行） | 並行（不阻塞） |
| Firebase init | +3s | 3s（與 LIFF 並行） |
| 事件取得 | 等全部載入 | 直接單筆 +1s |
| **總計** | ~9s | ~4s |
| 12s timeout | 接近/超時 | 安全範圍 |

### 18.5 安全邊界

1. 並行 LIFF + Firebase init 對**已登入用戶**的影響：Firebase auth persistence 會自動恢復，不依賴 LIFF init 完成。
2. 直接 Firestore 單筆取得使用 `allow read: if true` 規則，guest 可讀。
3. Guest view 不暴露用戶個資（只顯示 participants 名稱）。
4. 所有互動操作仍需登入，防止未授權寫入。

---

## 19. 最終結論

V2 的安全升級結論不是「一次搬空 `index.html`」，而是：

1. 先明確首頁 bootstrap 白名單
2. 先把 `PageLoader` / `ScriptLoader` / `FirebaseService` 串成真正的 load-before-render 契約
3. 先建立 deep link 與首頁卡片的安全入口
4. **Guest event preview 快速路徑**：LIFF/Firebase 並行 + 單筆事件直取
5. 再逐步把非首頁模組搬出
6. 最後再做雲端延後初始化與首頁 staged render

這是目前最安全、最符合 SportHub 架構、也最有機會一次升級成功的做法。
