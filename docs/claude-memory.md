# SportHub — Claude 修復日誌

此檔案隨 git 版本控制，記錄歷次 bug 修復與重要技術決策，供跨設備、跨會話參考。

---

### 2026-03-05 — 射門遊戲嵌入主站（Phase 2）
- **問題**：射門遊戲只存在於獨立的 `game-lab.html`（需要 token + 私測），無法讓一般登入用戶玩。
- **原因**：架構設計為私測入口，未整合至主站 SPA。
- **修復**：新增以下檔案：
  - `pages/game.html` — 主站頁面片段（無 token gate，直接使用主站 auth）
  - `js/modules/shot-game-page.js` — 遊戲 App 模組（Object.assign 模式），含 Three.js 懶載入、引擎 lifecycle 管理、排行榜、intro modal
  - `css/game.css` — 遊戲頁樣式（所有 selector 以 `#page-game` 為前綴防衝突）
  - 修改 `js/config.js` — 新增 DRAWER_MENUS 射門遊戲入口 + CACHE_VERSION 20260305j
  - 修改 `js/core/page-loader.js` — 加入 `page-game: 'game'` 映射
  - 修改 `js/core/navigation.js` — `_renderPageContent` 加入 page-game；showPage 離開時呼叫 destroyShotGamePage
  - 修改 `pages/home.html` — 新增「小遊戲」區塊含 home-game-card 快捷按鈕
  - 修改 `css/home.css` — 新增 `.home-game-card` 樣式
- **關鍵設計**：Three.js (CDN, ~580KB) 在用戶首次進入 `page-game` 時才懶載入；shot-game-engine.js 透過 ScriptLoader 懶載；離開頁面時 engine.destroy() 釋放 WebGL context。
- **教訓**：`pages/*.html` 片段中的 `position:fixed` modal 在父元素 `display:none` 時不會渲染，無需額外關閉邏輯（但仍在 destroyShotGamePage 中主動關閉以避免狀態殘留）。

---

### 2026-03-05 — Shot Game Phase 1 雲端排行榜接入

- **問題**：Phase 0 射門遊戲排行榜為假資料（mock），需接入正式 Firestore + Cloud Function
- **原因**：Phase 0 設計為純本地 localStorage，故意不接 Firebase
- **修復**：
  1. `firestore.rules`：新增 `shotGameScores`（owner 可讀）與 `shotGameRankings`（登入可讀）規則；前端不可寫
  2. `functions/index.js`：新增 `submitShotGameScore` onCall（驗證 score/shots/durationMs/節流；寫入稽核紀錄 + 更新日榜最高分）
  3. `js/api-service.js`：新增 `submitShotGameScore()`（呼叫 Cloud Function）與 `getShotGameLeaderboard()`（讀 Firestore，5 分鐘 cache）
  4. `js/modules/shot-game-lab-page.js`：新增 `getTaipeiDateBucket()`；`renderLeaderboard` 改 async 讀 Firestore；`onGameOver` 加非同步提交
- **教訓**：
  - `firebase-functions-compat.js` 雖在 index.html `<link preload>`，實際是 `app.js _loadCDNScripts()` 載入，可用 `firebase.app().functions('asia-east1')`
  - Cloud Function Admin SDK 寫入直接繞過 Firestore rules；rules 只需控制前端讀取權限
  - `renderLeaderboard` 改為 async 不需要 caller await（fire-and-forget 對 UI 更新安全）
  - 節流用 `lastSubmitAt` Firestore field（伺服器端），避免 client bypass

---

### 2026-03-04 — 冷啟動加速：分層啟動 + Edge Cache + TTL 分層（Phase A）

- **問題**：冷啟動 5-15 秒，因 Auth 阻塞公開資料載入 + 7 個 listeners 全部等待首次 snapshot
- **原因**：
  1. `init()` 先等 Auth（最長 15 秒），再啟動所有資料載入
  2. 7 個 onSnapshot listeners 包含需 Auth 的集合（messages/registrations/attendanceRecords/users），全部阻塞 init
  3. Worker 每次轉發 Cloud Function 無 cache
  4. localStorage TTL 統一 30 分鐘，一般用戶頻繁重新載入
- **修復**：
  1. **A1 分層啟動**：boot collections + events + teams 不等 Auth 直接啟動；Auth 並行進行；Auth 完成後背景啟動 messages/users/rolePermissions
  2. **A2 Listener 縮減**：registrations/attendanceRecords 延遲到進入對應頁面時才啟動 listener；terminal events 背景啟動
  3. **A3 TTL 分層**：一般用戶 120 分鐘，admin/super_admin 30 分鐘
  4. **A4 Worker Edge Cache**：`_worker.js` 加 Cache API，team-share 頁面 300 秒 edge cache
- **教訓**：
  - Firestore rules 決定哪些集合可以不等 Auth 載入（`allow read: if true` vs `isAuth()`）
  - 啟動流程應以「首頁可渲染」為目標，Auth 和 auth-required 資料在背景並行
  - localStorage cache 對回訪用戶是最佳加速手段，TTL 可以按角色分層
- **版本**: `20260304a`
- **Files**: `firebase-service.js`, `_worker.js`, `config.js`, `index.html`

### 2026-03-04 — 自我驗證：分層啟動引入的寫入競態問題修復

- **問題**：分層啟動讓 `_initialized = true` 早於 Auth 完成，使用者可在 Auth 未就緒時觸發 Firestore 寫入操作導致 `permission-denied`
- **原因**：
  1. 原本 `init()` 阻塞等待 Auth 後才設 `_initialized = true`，寫入時 `auth.currentUser` 一定已就緒
  2. 新的分層啟動在公開資料就緒後即設 `_initialized = true`，Auth 仍在背景並行
  3. `firebase-crud.js` 約 50 個寫入方法中，僅 3 個（`registerForEvent`、`cancelRegistration`、`createOrUpdateUser`）有 `_ensureAuth()` 守衛
  4. `api-service.js` 的 `_create`/`_update`/`_delete` 通用方法及數個直接 `db.collection()` 寫入均無 Auth 檢查
  5. `_startRegistrationsListener` / `_startAttendanceRecordsListener` 在 Auth 未完成時被多次呼叫會重複排隊 `.then()` 回調
- **修復**：
  1. `firebase-service.js` 新增 `ensureAuthReadyForWrite()` — 等待 `_authPromise` 完成（最長 10 秒），供所有寫入操作統一使用
  2. `firebase-crud.js`：`batchRegisterForEvent()` + `cancelCompanionRegistrations()` 加入 `ensureAuthReadyForWrite()` 守衛（高風險用戶操作）
  3. `api-service.js`：`_create()`、`_update()`、`_delete()` 通用方法中的 Firebase 呼叫改為先 `ensureAuthReadyForWrite().then(...)` 再執行
  4. `api-service.js`：`deleteTournament()`、`adjustUserExp()`、`adjustTeamExp()` 等直接 `db.collection()` 寫入加入 auth 守衛
  5. `_startRegistrationsListener` / `_startAttendanceRecordsListener` 加入 `_pendingRegistrations` / `_pendingAttendance` flag 防止 `.then()` 重複排隊
- **自我驗證結果**：
  - 全部 JS 語法檢查（`node -c`）：通過
  - Demo 模式不受影響：`app.js` line 450 有 `!ModeManager.isDemo()` 守衛，`init()` 不會在 Demo 模式執行
  - `_loadEndedEvents` 無外部呼叫者：確認已被 terminal events listener 取代
  - `_persistCache` / `_restoreCache` 集合完整性：`registrations`、`messages` 已加入 `_deferredCollections`
  - `destroy()` 正確清理 `_realtimeListenerStarted` 和 `_authPromise`
  - `index.html` 版本號全部更新，無殘留舊版號
- **教訓**：
  - 將阻塞操作改為並行時，必須檢查所有下游消費者是否假設了「前置條件已滿足」
  - 寫入操作的 Auth 守衛應在統一入口（`ensureAuthReadyForWrite`）而非散落各處
  - 延遲 listener 的 `.then()` 重試模式需加 pending flag 防止多次排隊
- **版本**: `20260304a`
- **Files**: `firebase-service.js`, `firebase-crud.js`, `api-service.js`

---

### 2026-02-27 — 修復錯誤日誌寫入/讀取失敗（zw）

- **問題**：錯誤日誌頁面始終無資料，用戶觸發的錯誤未被記錄
- **原因**：
  1. `_writeErrorLog` 的 `.catch(() => {})` 靜默吞掉所有 Firestore 寫入失敗，無法看到是否成功
  2. `errorLogs` 讀取規則使用 `isSuperAdmin()` → `authRole()` → `roleFromUserDoc()` 路徑，而 `roleFromUserDoc` 的 null ternary 有編譯警告 `[W] 29:56 - Invalid type. Received one of [null]`，可能導致 super_admin 也無法讀取
  3. 寫入規則使用 `isRestrictedAccount()` 額外 get() 呼叫，增加不必要的複雜性
- **修復**：
  1. `.catch(() => {})` → `.then(() => console.log(...)).catch(e => console.warn(...))`：寫入成敗均有 console 輸出
  2. Firestore rules 改用 `request.auth.token.role == 'super_admin'` 直接檢查 custom claims，繞過 `roleFromUserDoc()` null 問題
  3. 寫入規則簡化為 `isAuth()`（移除 `isRestrictedAccount()` 依賴）
- **教訓**：Firestore rules 中 `get()` 返回 null 的 ternary 可能導致規則評估失敗；對非關鍵寫入，也不應完全吞掉錯誤
- **版本**: `20260227zw`
- **Files**: `api-service.js`, `firestore.rules`, `config.js`, `index.html`

---

### 2026-02-27 — 前端錯誤日誌系統（zs）

- **功能**：當 catch 區塊捕獲系統異常時，自動寫入 Firestore `errorLogs` 集合，總管可在後台查閱
- **架構**：
  - `ApiService._writeErrorLog(context, err)` — 防禦性設計，session-level dedup（err.code），整體 try/catch 不拋錯
  - `FirebaseService.addErrorLog/deleteErrorLog` — CRUD
  - `errorLogs` 集合：read/delete=`isSuperAdmin()`，create=`isAuth() && !isRestrictedAccount()`
  - `js/modules/error-log.js` — 渲染/過濾/分頁/清除（複製操作日誌模式）
  - `pages/admin-system.html` — `page-admin-error-logs` section（`data-min-role="super_admin"`）
  - `app.js` — `_errorLogReady` flag + `unhandledrejection` handler（過濾 LIFF/Firebase/Firestore 雜訊）
- **catch 區塊**：10 處加入 `_writeErrorLog`（message-inbox, team-form, event-detail-signup, event-manage, shop）
- **版本**: `20260227zs`
- **Files**: `api-service.js`, `firebase-crud.js`, `firebase-service.js`, `data.js`, `firestore.rules`, `error-log.js`(new), `admin-system.html`, `navigation.js`, `config.js`, `index.html`, `admin.css`, `message-inbox.js`, `team-form.js`, `event-detail-signup.js`, `event-manage.js`, `shop.js`, `app.js`

---

### 2026-02-27 — 補齊操作日誌（zr）

- **功能**：補上 6 類先前未記錄的操作項目，確保操作日誌完整
- **新增記錄**：
  1. `handleJoinTeam`（team-form.js）— 申請入隊：`申請入隊` / `${applicantName} 申請加入「${t.name}」`
  2. `handleLeaveTeam`（team-form.js）— 退出球隊：`退出球隊` / `${userName} 退出「${t.name}」`
  3. `handleTeamJoinAction` ignore 分支（message-inbox.js）— 忽略審批：`球隊審批` / `${reviewerName} 忽略...`
  4. `handleSaveShopItem`（shop.js）— 商品編輯/上架：`商品編輯` / `商品上架`
  5. `delistShopItem` / `relistShopItem` / `removeShopItem`（shop.js）— 下架/重新上架/刪除
  6. `handleCancelSignup`（event-detail-signup.js，Demo 與 Prod 兩個路徑）— 取消報名/候補
  7. `_confirmAllAttendance`（event-manage.js）— 手動簽到批次更新
- **版本**: `20260227zr`
- **Files**: `team-form.js`, `message-inbox.js`, `shop.js`, `event-detail-signup.js`, `event-manage.js`

---

### 2026-02-27 — 審批入隊 ensureAuth + isTeamStaff leaderUids + linePushQueue

- **問題**：球隊隊長/領隊按「同意」入隊申請時持續出現「寫入失敗」
- **原因**（複數）：
  1. `updateUser` 在跨用戶寫入前未呼叫 `_ensureAuth()`，若 Firebase Auth token 過期則 permission-denied
  2. `isTeamStaff` 只檢查舊版 `leaderUid` 欄位，未包含新版 `leaderUids[]` 陣列，導致新版領隊被擋在外
  3. `Object.assign(applicant, ...)` 在寫入前就修改 in-memory 快取，若寫入失敗快取狀態會損壞
  4. `linePushQueue` Firestore 規則為 `allow create: if false`，推播佇列寫入一律靜默失敗
- **修復**：
  - `handleTeamJoinAction`：寫入前加 `await FirebaseService._ensureAuth()`；`Object.assign` 移至成功後；isTeamStaff 加 `teamLeaderUids.includes(curUid)`；錯誤 toast 顯示實際 error code
  - `firestore.rules`：`linePushQueue` allow create 改為 `if isAuth()`
- **版本**: `20260227zo`
- **Files**: `js/modules/message-inbox.js`, `firestore.rules`

---

### 2026-02-27 — 球隊領隊複數化 + 角色升降 + 經理轉移限制

- **功能**：
  1. 領隊改為複數（`leaderUids[]` + `leaders[]`），表單支援多選 Tags UI
  2. 指派領隊自動升至 coach 等級；移除領隊後自動降級（`_recalcUserRole` + `_applyRoleChange`）
  3. 建立球隊時創立者自動成為球隊經理（鎖定，不可更改）
  4. 編輯球隊時只有當前球隊經理或 admin 可以轉移經理職位，其他人看到鎖定提示
  5. 欄位順序對調：球隊經理在上、球隊領隊在下
- **相容**：舊資料 `leader`/`leaderUid` 單一欄位仍可讀取；新存同時寫 `leaders`/`leaderUids` + 舊欄位
- **Files**: `js/modules/team-form.js`, `js/modules/team-detail.js`, `js/api-service.js`, `pages/team.html`
- **版本**: `20260227zm`

---

### 2026-02-27 — 球隊入隊審批 Firestore 規則再修（領隊角色）

- **問題**：領隊（team.leader）同意入隊後仍顯示「寫入失敗」
- **原因**：原規則用 `isCoachPlus()` 檢查角色，但領隊的 Firebase role 是 `'user'`，不在 coach+ 清單 → permission-denied。Coach/captain 若 token 未更新也可能同樣失敗
- **修復**：`firestore.rules` users.update 條件改為 `isAuthNotRestricted()`（任何登入非受限用戶），`hasOnly(['teamId','teamName','updatedAt'])` 欄位限制確保安全性不降低
- **已部署**：`firebase deploy --only firestore:rules`

### 2026-02-27 — 球隊加入審批同意後申請人未入隊修復

- **問題**：隊長/教練按「同意」後申請人沒有成功加入球隊
- **原因**：`message-inbox.js` `handleTeamJoinAction` approve 時呼叫 `FirebaseService.updateUser(applicant._docId, { teamId, teamName })`，但 Firestore rules `users.update` 只允許 `isOwner || isAdmin`，隊長/教練不是 admin → permission-denied，錯誤僅 `console.error` 不顯示 toast，UI 假裝成功
- **修復**：
  1. `firestore.rules`：`users.update` 新增條件：`isCoachPlus() && !isRestrictedAccount()` 且 `affectedKeys().hasOnly(['teamId','teamName','updatedAt'])`（限制只能改這三個欄位）
  2. `message-inbox.js`：approve 區塊改為 `await updateUser()`，失敗時立即 toast 並 return，找不到申請人也提示
- **版本**：`20260227zd` → `20260227ze`
- **教訓**：非 owner 的跨用戶寫入必須在 Firestore 規則層開放，`.catch(console.error)` 會吞掉錯誤使 UI 假裝成功

### 2026-02-27 — 球隊人數統計未含一般隊員修復

- **問題**：球隊詳情頁「人數」數字偏低，和實際成員列表不符
- **原因**：`team-form.js` 儲存時 `members` 只算 `(captain ? 1 : 0) + coaches.length`，完全漏計所有 `user.teamId === team.id` 的一般隊員
- **修復**：`team-form.js` line 532 改為額外計算 `regularMembersCount`（在已有的 `users` 中過濾 `teamId` 符合且不在 captainCoachNames 中的用戶），加入總計
- **版本**：`20260227zc` → `20260227zd`

### 2026-02-27 — 入隊申請系統升級（廣播、冷卻、衝突保護）

- **問題**：入隊申請只通知隊長、無多職員衝突處理、無冷卻機制、拒絕後可立即重送
- **修復**：
  - `team-form.js` `handleJoinTeam()`：收集 captainUid + leaderUid + coaches 所有 UID，一次廣播給全員，並生成 `groupId` 串聯同一申請的所有訊息
  - 加入 24h 冷卻：被拒絕後訊息帶 `rejectedAt` (top-level)，再次申請時計算剩餘小時數提示
  - `message-inbox.js` `handleTeamJoinAction()`：加入職員身份驗證（captain/leader/coach/admin）、first-action-wins（先查 groupId 是否已有非 pending 訊息）、groupId 群組同步（同組全部更新 + 通知其他職員）
  - 狀態顯示加上審核者姓名 `reviewerName` (top-level)
- **教訓**：新欄位需存 top-level（非 meta 內），因 `_update()` 用 `Object.assign` 無法處理 dot notation nested 更新；groupId 串聯是 tournament 現成模式，可直接重用

### 2026-02-27 — 首頁活動卡左上角自動加上日期標籤

- **需求**：首頁近期活動卡左上角自動顯示月/日，黃底粗體標籤樣式
- **修復**：`js/modules/event-list.js` 的 `visible.map()` 改為 block body，解析 `e.date`（格式 `YYYY/MM/DD HH:MM~HH:MM`）取月/日，在 `.h-card-img` 左上角插入 `<span>` 標籤，並為 `.h-card-img` 加上 `position:relative`
- **版本**：`20260227x`

### 2026-02-27 — 成就評估引擎缺失導致成就永不觸發

- **問題**：在成就/徽章後台設定條件（如「參與教學活動 1 場」），即使已完成對應活動，成就 `current` 永遠維持 0 不觸發
- **原因**：`achievement.current` 是 Firestore 靜態欄位，條件選單（action/filter/threshold）僅用於 UI 描述生成（`_generateConditionDesc`），從未有任何程式碼讀取 `activityRecords` 來計算並更新 `current`——評估引擎根本不存在
- **修復**：在 `js/modules/achievement.js` 新增 `_evaluateAchievements()` 方法，遍歷所有 active achievement，根據 `condition.action` 計算：
  - `attend_play/friendly/camp/watch`：計算 activityRecords 中 status='registered' 且對應事件 type 符合的筆數
  - `register_event`：計算指定類型的報名紀錄數
  - `complete_event`：計算對應活動已 ended 的報名紀錄數
  - 若 `current` 變動則呼叫 `ApiService.updateAchievement()`，達到 threshold 自動設 `completedAt`
  - 從 `renderAchievements()`、`renderAdminAchievements()`、`handleSignup` 成功後、`handleCancelSignup` 成功後呼叫
- **教訓**：條件配置 UI 與評估引擎必須同步實作；`activityRecords` 不儲存事件類型，須 JOIN `events` 集合取得 `type` 欄位

### 2026-02-27 — 候補名單正取功能（繞過人數上限）

- **功能**：候補名單 header 右側新增「編輯」按鈕（canManage 權限），進入編輯模式後每列顯示紫色「正取」按鈕，按下即強制將該用戶（含同行者）從候補移入報名名單，即使超過活動人數上限（顯示為 12/11）
- **實作**：
  - `event-manage.js`：`_buildWaitlistTable` 改為 `_renderWaitlistSection(eventId, containerId)`（re-renderable），支援 `_waitlistEditingEventId` 狀態；新增 `_startWaitlistEdit`、`_stopWaitlistEdit`、`async _forcePromoteWaitlist`
  - `event-detail.js`：`_buildGroupedWaitlist` + `_expandWaitlistGrid` 改為 `_renderGroupedWaitlistSection(eventId, containerId)`（網格正常模式 + 表格編輯模式），另有 `_startWaitlistDetailEdit`、`_stopWaitlistDetailEdit`
  - `showMyActivityDetail`：`${waitlistHtml}` → `<div id="waitlist-table-container"></div>` + `_renderWaitlistSection` call
  - detail page：`${_buildGroupedWaitlist(e)}` → `<div id="detail-waitlist-container"></div>` + `_renderGroupedWaitlistSection` call
- **`_forcePromoteWaitlist`**：調用現有 `_promoteSingleCandidate(e, reg)`（每次 `event.current++`，無容量檢查），對 userId 的所有候補報名一次性處理，再更新 Firebase，最後 re-render 所有相關容器
- **超量顯示**：現有 `_renderAttendanceTable` 中 `nameThContent` 用 `${people.length}/${e.max}` 呈現，超量自動顯示如 12/11

---

### 2026-02-27 — 手動簽到閃爍 + 重複標題修復

- **問題 1**：按「完成簽到」後，最後一個勾選位置短暫消失再出現（閃爍）
- **問題 2**：報名名單標題重複出現（獨立 div 一個 + 表頭 th 一個）
- **原因 1**：`_confirmAllAttendance` 有多個 `await` 呼叫，期間 Firestore onSnapshot 可能觸發 `_renderAttendanceTable(eventId, 'detail-attendance-table')`，該呼叫會覆寫 `this._manualEditingContainerId`，導致最後 render 到錯誤的 container（detail page 而非 modal），同時 pending onSnapshot 尚未 settle 導致 cache 狀態不穩定
- **原因 2**：`showMyActivityDetail` 有獨立的 `<div>報名名單（x/y）</div>`，而 `_renderAttendanceTable` 的 `<th>` 也顯示「報名名單」
- **修復**：
  - `_confirmAllAttendance`：在 loop 前擷取 `containerId = this._manualEditingContainerId`，最後用 captured value render（不再用 `this._manualEditingContainerId`）
  - `_confirmAllAttendance`：最後 render 前加 `await new Promise(r => setTimeout(r, 0))` 讓所有 pending onSnapshot/microtask 先 settle
  - `showMyActivityDetail`：移除獨立的「報名名單（x/y）」div
  - `_renderAttendanceTable`：`nameThContent` 改為 `報名名單（${people.length}/${e.max}）` 含動態人數
- **教訓**：async 函式中若有多個 await，任何 this.xxxId 的 mutable state 都可能被 side effects 覆寫，需在函式開頭 capture snapshot

---

### 2026-02-25 — LINE + Firebase Custom Token 認證升級

- **問題**：Firebase Auth 使用 `signInAnonymously()`，UID 與 LINE userId 無關，Firestore rules 無法做 owner-only 驗證，Firebase Console 全是匿名用戶
- **修復**：
  - 新增 Cloud Function `createCustomToken`（`functions/index.js`）：驗證 LINE Access Token → 簽發 Firebase Custom Token，UID = LINE userId
  - `js/line-auth.js`：新增 `getAccessToken()` 包裝 `liff.getAccessToken()`
  - `js/firebase-service.js`：改用 `_signInWithAppropriateMethod()`，Prod 模式走 Custom Token 流程
  - `firestore.rules`：新增 `isOwner(docId)`，加強 users create / registrations create 規則
- **教訓**：
  - 用 `liff.getAccessToken()`（30 天效期）而非 `liff.getIDToken()`（約 1 小時過期）
  - Cloud Functions SA 需要 `roles/iam.serviceAccountTokenCreator` 才能呼叫 `createCustomToken()`
  - Compat SDK 呼叫 Functions：`firebase.app().functions('asia-east1').httpsCallable(...)` 而非 `firebase.functions()`
  - `firebase-functions-compat.js` 必須明確載入，不會自動引入
  - `users/{userId}` update 規則不能用 `isOwner`，管理員需要更新其他用戶資料
  - `attendanceRecords` create 不能加 owner check，管理員幫其他用戶掃碼簽到

---

### 2026-02-25 — LIFF / Firebase 初始化競態條件

- **問題**：`Promise.all([FirebaseService.init(), LineAuth.init()])` 平行執行，Firebase 端用 5 秒輪詢等 LIFF，如果 LIFF 慢就超時降級匿名登入
- **原因**：`_waitForLiffReady(5000)` 是 polling fallback，不是真正等待 LIFF 完成
- **修復**：`app.js` 改為 sequential — 先 `await LineAuth.init()`，再 `await FirebaseService.init()`；移除 `_waitForLiffReady()` 方法
- **教訓**：有依賴關係的非同步初始化不能用 `Promise.all`，應改為 sequential

---

### 2026-02-25 — Prod 模式產生大量匿名用戶

- **問題**：LIFF 未登入（瀏覽器訪客、登入重導向過程）時，每次載入都產生匿名 Firebase Auth 用戶，累積大量垃圾紀錄
- **原因**：所有 fallback 路徑都呼叫 `signInAnonymously()`
- **修復**：`js/firebase-service.js` — Prod 模式下所有 fallback 改為直接 `return`（不建立匿名），非登入用戶靠 localStorage 快取瀏覽；Demo 模式仍保留匿名登入
- **教訓**：LINE LIFF app 的非登入用戶不需要 Firebase Auth；Firestore 查詢失敗有 `.catch()` 和 `onSnapshot` error callback 可優雅降級

---

### 2026-02-25 — 刷新頁面觸發跨裝置畫面閃爍

- **問題**：電腦刷新頁面後，手機畫面也會閃一下
- **原因**：`createOrUpdateUser()` 每次載入都寫入 `lastLogin: serverTimestamp()`，觸發 Firestore `onSnapshot`，所有連線裝置收到變更並重新渲染
- **修復**：`js/firebase-crud.js` — `lastLogin` 節流：距上次超過 10 分鐘才寫入（`Date.now() - lastLogin.toMillis() > 10 * 60 * 1000`）
- **教訓**：每次頁面載入觸發的 Firestore 寫入都會廣播給所有監聽裝置；高頻但非必要的欄位更新要做節流

---

### 2026-02-25 — 單人取消候補/取消報名抓錯紀錄

- **問題**：活動頁單人取消候補/取消報名有時會顯示成功，但 `registrations` 主資料未正確更新，導致需要反覆點擊才真正取消成功。
- **原因**：`js/modules/event-detail-signup.js` 的 `handleCancelSignup()` 在 Firebase 模式用模糊 `.find(...)` 選取取消目標，只排除 `cancelled` 未排除 `removed`，可能先抓到歷史 `removed` 紀錄；此外找不到有效 `registration` 時仍走 fallback 並顯示成功，造成假成功。
- **修復**：`js/modules/event-detail-signup.js` 改為從 `ApiService.getMyRegistrationsByEvent(id)` 的有效 `myRegs` 中依 `waitlisted/confirmed` 精準選取取消目標；找不到有效 `registration` 時改為顯示同步提示，不再做假成功 fallback。同步依規範更新 `js/config.js` 與 `index.html` 快取版本號至 `20260225m`。
- **教訓**：取消流程必須以有效主資料（`registrations`）為準，明確排除歷史狀態（如 `removed`）；當主資料找不到時不能回報成功，否則會製造難以追查的假成功錯覺。

---

### 2026-02-25 — 候補順位穩定排序與取消防連點

- **問題**：候補名單順位顯示可能受快取順序影響而不穩定；單人取消候補/取消報名在網路請求期間可重複點擊，造成競態與重複請求。
- **原因**：`_buildGroupedWaitlist()` 未對 `waitlisted` 報名紀錄做穩定排序；`handleCancelSignup()` 沒有取消期間 UI 鎖定與防連點。
- **修復**：`js/modules/event-detail.js` 在候補分組前先依 `registeredAt`、`promotionOrder` 排序（`waitlistNames` 仍只作 fallback 補缺）；`js/modules/event-detail-signup.js` 為單人取消按鈕加入 busy guard、按鈕 disable 與處理中 spinner，並於完成/失敗後恢復 UI。同步更新 `js/config.js` 與 `index.html` 快取版本號至 `20260225n`。
- **教訓**：順位顯示必須依明確資料欄位排序，不能依快取陣列自然順序；取消/報名等會改資料的操作都應做防連點與處理中狀態，降低競態問題。

---

### 2026-02-25 — 首頁活動卡片顯示候補人數
- **問題**：首頁活動卡片只顯示正取人數，無法一眼看出當前候補人數。
- **原因**：`renderHotEvents()` 的人數字串僅輸出正取人數，未拼接 `e.waitlist`。
- **修復**：修改 `js/modules/event-list.js`，首頁卡片人數在 `waitlist > 0` 時追加 ` 候補X`，無候補時維持原顯示。同步更新 `js/config.js` 與 `index.html` 快取版本號至 `20260225o`。
- **教訓**：同一份活動摘要資訊在首頁與詳細頁應維持一致格式，避免資訊落差。

---

### 2026-02-25 — 首頁 QR Code 按鈕改為黑色
- **問題**：首頁底部中間的 QR Code 按鈕使用綠色圖示，視覺需求希望改為黑色。
- **原因**：`css/layout.css` 的 `.bot-tab-qr` 與 `.bot-tab-qr svg` 使用 `var(--accent)`（綠色主色）。
- **修復**：修改 `css/layout.css`，將 `.bot-tab-qr` 的文字色與 `svg` 描邊改為 `#111`（黑色），保留原本白底圓形按鈕樣式。同步更新 `js/config.js` 與 `index.html` 快取版本號至 `20260225p`。
- **教訓**：針對單一元件視覺調整時，優先修改該元件專屬 class，避免改動全域 `accent` 造成連帶影響。

---

### 2026-02-25 — 深色模式 QR Code 按鈕改為白色
- **問題**：首頁 QR Code 按鈕在淺色模式改為黑色後，切換深色模式時對比不足，圖示不易辨識。
- **原因**：`.bot-tab-qr` 與 `.bot-tab-qr svg` 目前固定使用黑色，未針對深色主題做覆寫。
- **修復**：修改 `css/layout.css`，新增 `[data-theme="dark"] .bot-tab-qr` 與 `[data-theme="dark"] .bot-tab-qr svg` 覆寫為白色；同步更新 `js/config.js` 與 `index.html` 快取版本號至 `20260225q`。
- **教訓**：顏色調整若影響主題切換元件，需同時檢查 light/dark 模式的對比與可讀性。

---

## 重要技術常數

| 項目 | 值 |
|------|-----|
| LINE Channel ID | `2009084941` |
| LIFF ID | `2009084941-zgn7tQOp` |
| Firebase Project | `fc-football-6c8dc` |
| GCP Project | `firm-vine-jxhhm` |
| Cloud Functions SA | `468419387978-compute@developer.gserviceaccount.com` |
| Cloud Functions region | `asia-east1` |
| Firebase Auth 帳號 | `msw741121@gmail.com` |

### 2026-02-26 - F-01 權限模型核心修復 (Custom Claims + users 欄位保護)
- **問題**：`firestore.rules` 大量使用 `isAuth()` 放行寫入，且 `users/{uid}` owner 可改整份文件；若 `createCustomToken` 依賴 `users.role`，會形成自我升權風險。
- **原因**：角色資料來源（`users.role`）與權限判斷未分離，缺少 owner 欄位白名單/敏感欄位保護，也缺少角色變更後的 claims 同步流程。
- **修復**：更新 `firestore.rules`（新增 `isCoachPlus/isAdmin/isSuperAdmin`、限制 `events`/`announcements`/`customRoles`/`rolePermissions`/`permissions`/`adminMessages` 寫入權限；封鎖 owner 修改 `role/manualRole` 等敏感欄位）；更新 `functions/index.js`（`createCustomToken` 依 Firestore `users.role` 設定 Custom Claims，新增 `syncUserRole` callable）；更新 `js/firebase-crud.js`（角色變更後呼叫 `syncUserRole`，並在變更自己角色時強制 refresh token）；同步更新 `js/config.js` 與 `index.html` 快取版本至 `20260226a`。
- **教訓**：Custom Claims 的安全性取決於 claims 資料來源是否可被使用者修改；必須同時修補資料來源寫入規則與 claims 同步流程。

### 2026-02-26 - F-01 第二輪規則收斂與過渡防鎖死
- **問題**：多個高風險集合仍使用 `isAuth()` 寫入、`attendanceRecords` 欄位與前端 `uid` 不一致、`linePushQueue` 仍可被任意登入者建立；另既有管理員若 claims 尚未更新，可能被新規則誤判為 `user`。
- **原因**：第一輪先封住自我升權核心路徑，但尚未完成其他集合權限收斂與過渡相容性處理。
- **修復**：更新 `firestore.rules`：收緊 `tournaments`、`achievements`、`badges`、廣告/主題/模板、`matches`/`standings`、`activityRecords`、`registrations`、`teams`、`messages`、`shopItems`、`trades`、審計 logs 等集合寫入權限；`attendanceRecords.create` 改用 `uid`；`linePushQueue.create` 暫時改為 `false`；`authRole()` 增加從 `users/{uid}.role` 的安全 fallback（claims 缺失時過渡使用）。
- **教訓**：權限模型上線要分「核心升權漏洞修補」與「全域規則收斂」兩階段驗收；過渡期要設計 claims 缺失的 fallback，避免先把管理員鎖在門外。

### 2026-02-26 - F-01 細修：避免 authRole() 多餘讀取 + 收緊 attendanceRecords.update
- **問題**：`authRole()` 先計算 fallback `get(users/{uid})`，即使 claims 已存在仍可能多做 Firestore 規則讀取；`attendanceRecords.update` 仍是 `isAuth()`。
- **原因**：過渡 fallback 寫法採用 eager 區域變數計算，且簽到紀錄 update 權限在第二輪收斂時漏改。
- **修復**：將 fallback 讀取抽成 `roleFromUserDoc(uid)`，由 `authRole()` 在 claims 缺失時才呼叫；將 `attendanceRecords.update` 改為 `isAdmin()`。
- **教訓**：Rules 的 helper 也要注意「求值時機」與效能；收斂清單完成後仍需做逐條回歸比對，避免漏網之魚。

---

### 2026-02-26 — F-01 後續修補計劃（f01-followup-remediation-plan）深度審查

- **工作內容**：對 `docs/f01-followup-remediation-plan-20260226.md` 進行靜態審查，交叉比對 `comprehensive-audit-20260226.md` 的其他 F-xx 議題，找出計劃瑕疵與交叉依賴，直接在文件中插入 `> 審查備註` blockquote。
- **發現的 Critical 瑕疵**：
  1. **D-1 auto-exp 已是 production bug**：`_grantAutoExp` 由 13 個一般用戶觸發點呼叫，`adjustUserExp` 的兩個 Firestore 寫入（`users.exp`、`expLogs`）均被現有 rules 靜默擋住（`sameFieldValue('exp')` + `isAdmin()`），EXP 系統完全無效，計劃卻說「Phase A/B 不處理」。
  2. **D-2 admin 角色變更已壞**：`adminUserUpdateSafe()` 的 `sameFieldValue('role/manualRole/exp')` 使 admin 透過 client SDK 完全無法改 role；`promoteUser()` 和 `_recalcUserRole()` 在 admin session 下都被 PERMISSION_DENIED，Phase A→B 過渡期 admin 角色管理失效。
  3. **D-3 B-2 Admin SDK 設計決策未標注**：`adminChangeRole` callable 內部需用 Admin SDK 繞過 rules，但計劃未明確標注，易被實作者誤用 client SDK 重踩 D-2 的坑。
- **發現的 High 瑕疵**：
  - D-4：F-06 `submitReview` 若走 `updateEvent`，被 `isCoachPlus()` 擋住（一般用戶無法 update events）
  - D-5：B-5 與 F-07 範圍重疊（角色路徑 vs 底層 `_create/_update/_delete`），需明確劃分
  - D-6：B-6 遺漏 `team-form.js`（4 處 `_recalcUserRole` + 2 處 `promoteUser`，line 138/467/479/513/518/654）
  - D-7：A-3 lineUserId fallback 找到 `doc.id != uid` 的舊文件後，未處理雙 doc 並存問題，建議 CF 端直接 migration
  - D-8：B-2 缺「最後一個 super_admin 不能自降」保護
  - D-9：Phase D 驗收清單完全沒有 auto-exp 測試項目
- **新增章節**：文件末尾新增「交叉依賴分析」（F-01-C/F-02/F-04/F-06/F-07/F-11）與「審查備註索引表」（D-1～D-12）。
- **教訓**：
  - 修補計劃的「範圍排除」若排除的是已發生的 production bug 而非未來功能，需重新評估優先級
  - rules 的欄位白名單（`sameFieldValue`）會同時擋掉 owner 和 admin 的直接寫入，只有 super_admin 可繞過；任何修補方案若涉及敏感欄位寫入，必須走 Admin SDK callable
  - 計劃文件中「需要 Admin SDK」的設計決策必須明確標注，否則第三者實作時易犯同樣錯誤


### 2026-02-26 — 首次 LINE 登入確認中 UI 熱修（避免誤顯示未登入）
- **問題**：新用戶首次完成 LINE 登入後，LIFF profile 與 Firebase 帳號同步較慢，短暫期間 UI 顯示「請先登入LINE帳號」且頭像未出現，容易誤判登入失敗。
- **原因**：前端登入判斷高度依賴 LineAuth._profile，在 liff.getProfile() 延遲或暫時失敗時，UI 與導航守門會直接走未登入分支。
- **修復**：js/line-auth.js 新增 ensureProfile() 重試與 pending 狀態；js/modules/profile-core.js 顯示「登入確認中」提示並隱藏登入按鈕；js/core/navigation.js 在 pending 狀態提示稍候而非誤導為未登入。
- **教訓**：登入流程要區分「未登入」與「登入確認中」，避免把暫時狀態直接呈現為失敗結果。

### 2026-02-26 — LINE WebView 首次登入 pending 與首波 UI 更新時序修補
- **問題**：LINE 內建瀏覽器偶發卡在「LINE 登入確認中」，外部瀏覽器雖可登入但頭像或新用戶提示有時更新延遲。
- **原因**：`liff.getProfile()` 在部分 WebView 情境可能卡住不回傳，pending 狀態沒有 timeout；另外 `FirebaseService._onUserChanged` 在 `loginUser()` 後才掛上，可能漏掉首波 currentUser snapshot。
- **修復**：`js/line-auth.js` 為 `liff.getProfile()` 增加 timeout 包裝與重試；`js/modules/profile-core.js` 提前掛 `_onUserChanged`，並在 LIFF profile 可用後先更新登入 UI，`loginUser()` 完成後主動補一次 UI 同步。
- **教訓**：登入流程是多段非同步串接，除了 retry 還要有 timeout 與明確狀態切換，避免 pending 無限等待與首波事件漏接。

### 2026-02-26 — 新用戶卡在「登入確認中」永不結束
- **問題**：新 LINE 用戶從 LINE 內建瀏覽器開啟 app 登入後，永遠卡在「LINE 登入確認中，請稍後」，無法操作直到關閉重開。
- **原因**：Phase 4 async 初始化鏈中，`liff.init()` 和 `_signInWithAppropriateMethod()` 都沒有 timeout；一旦 hang 住，`bindLineLogin()` 永遠不會執行，UI 不更新，`isPendingLogin()` 永遠回 true。
- **修復**：
  - `js/line-auth.js`：`liff.init()` 用 `_withTimeout()` 包裝（8 秒超時）；`isPendingLogin()` 加 `_pendingStartTime` 記錄，超過 20 秒自動降級為未登入
  - `js/firebase-service.js`：`_signInWithAppropriateMethod()` 加 `Promise.race` 15 秒 timeout
  - `app.js`：Phase 4 catch 區塊也呼叫 `bindLineLogin()`，避免失敗後 UI 卡死
- **教訓**：所有 async 初始化步驟都要有 timeout 保護；UI 狀態（isPendingLogin）不能永遠為 true，需有 timestamp-based 自動降級機制

### 2026-02-26 — LINE 首次登入速度優化（並行化 + profile 快取）
- **問題**：Phase 4 登入流程完全串行（liff.init → ensureProfile → FirebaseService.init），首次登入需 4-5 秒用戶才看到頭像和名字。
- **原因**：`ensureProfile()`（取 LINE 頭像/暱稱）和 `FirebaseService.init()`（Custom Token + Firestore 集合載入）沒有依賴關係，卻被迫串行；`getAccessToken()` 依賴 `_ready` flag，而 `_ready` 在 `init()` 最末尾（含 `ensureProfile()`）才設為 `true`，導致無法提前啟動 Firebase Auth。
- **修復**：
  - `js/line-auth.js`：新增 `initSDK()`（只做 liff.init + cleanUrl + 設 `_ready=true`，不含 ensureProfile）；新增 `restoreCachedProfile()`（從 localStorage 還原快取 profile）；`ensureProfile()` 成功後寫入 `liff_profile_cache`；`logout()` 清除快取
  - `app.js` Phase 4：改為 `initSDK()` → 還原快取 profile → `Promise.all([ensureProfile(), FirebaseService.init()])`
  - 版本號更新至 `20260226g`
- **教訓**：
  - LIFF SDK ready 後 `liff.getAccessToken()` 即可用，不需要等 `liff.getProfile()` 完成
  - 將「SDK 初始化」與「取 profile」拆開，可讓 Firebase Auth 提早 ~1-2 秒啟動
  - localStorage 快取 profile 可讓返回用戶立即顯示頭像，背景再更新

### 2026-02-26 — 登入後 Firestore Write channel 400/404
- **問題**：使用者登入後，Console 出現 `Write/channel` 404 + 400 錯誤（堆疊指向 `FirebaseService._seedNotifTemplates`）。
- **原因**：`FirebaseService.init()` 會對所有登入者執行 seed（廣告 slot / 通知模板 / 成就 / 角色權限），但 Firestore Rules 已限制這些集合寫入需 `admin/super_admin`，一般用戶寫入被拒，導致 WebChannel 報錯與重試。
- **修復**：修改 `js/firebase-service.js`，新增 `_resolveCurrentAuthRole()` 與 `_roleLevel()`，在 Step 6 依角色分流 seed：`admin+` 才跑一般 seed，`super_admin` 才跑 `rolePermissions/permissions` seed；一般用戶直接略過，不再發送違規寫入。
- **教訓**：所有初始化 seed/維運寫入都必須先做角色門檻判斷，避免前端在普通使用者會話執行管理級寫入。
### 2026-02-26 — F-01 後續補強（claims backfill + 後台權限 UI 回滾）
- **問題**：F-01 核心已做，但仍有三個風險點：缺少既有使用者 claims 批次回填工具、角色/權限後台寫入失敗時 UI 容易先顯示成功、正常流程尚未有固定 smoke checklist。
- **原因**：`syncUserRole/createCustomToken` 只能覆蓋登入或單人變更場景；`FirebaseService` 的角色權限 CRUD 會吞錯，呼叫端又多為 fire-and-forget；專案尚未建立固定 smoke test 文件。
- **修復**：新增 `functions/index.js` 的 `backfillRoleClaims` callable（`super_admin` only，支援 `limit/dryRun/startAfterDocId`）；調整 `js/firebase-crud.js` 的 `saveRolePermissions/deleteRolePermissions/addCustomRole/deleteCustomRole` 改為拋錯；調整 `js/api-service.js` 的 `updateAdminUser()` 改為 `async` 並在失敗時回滾；調整 `js/modules/user-admin-list.js` 與 `js/modules/user-admin-roles.js` 讓關鍵管理操作改為 `await + rollback`；新增 `docs/smoke-test.md`。
- **教訓**：安全修復不只看 Rules/Functions，管理端 UI 也要避免 optimistic success；對關鍵寫入 API 不應吞錯，否則前端無法正確回滾。

### 2026-02-26 �X �����n�J�a�ϧאּ���x 22 �����å[�J�ҽk�j�M
- **���D**�G�����n�J����a�Ͽﶵ�L�֡]�Ȥּƿ��� + ��L�^�A�L�k�л\���x�ϥΪ̡A�B��涵�ؼW�[��|����C
- **��]**�G`pages/profile.html` �� `#fl-region` �U�Կ��O�����g������²�����A�S���j�M���U�C
- **�״_**�G�b�����n�J modal �s�W `#fl-region-search` �j�M�ءF�e�ݩT�w�g�����x 22 ���� + `��L`�F�b `profile-data.js` �s�W�ҽk�j�M�]`includes`�A�t `�x/�O` ���W�ơ^�P�}�� modal �ɪ���歫�m��l�ơF��s `CACHE_VERSION` �P `index.html` �����ѼơC
- **�аV**�G�R�A�U�ԲM��@���W�L�Q�X���A���P�ɴ��ѷj�M�Τ��աA�קK�����n�J�y�{�d�b��ﶵ�C

### 2026-02-26 �X users �b������]����/�Ѱ�����^MVP
- **���D**�G�ݭn�b�Τ�޲z��@�� `user` �b��������/�Ѱ�����A�����Q����̵n�J��ȯఱ�d�����A�ާ@�\��ɴ��ܡu�b������v�C
- **��]**�G�{���t�Υu�������v���P�����n�J�ˬd�A�ʤֱb�����A�h�]�Ҧp����/����^�P����ɭ��d�I�C
- **�״_**�G`user-admin-list.js` �s�W `����/�Ѱ�����` ���s�]�� `role === 'user'` ��ܡ^�P `toggleUserRestriction()`�F`navigation.js` �s�W����A�P�_�P `showPage()`/���� tab/goBack �d�I�A����̦۰ʾɦ^�����F`profile-core.js` �b currentUser �Y�ɧ�s�^�I��Ĳ�o����ɬy�F`api-service.js` �s�W����b���g�J���b�]�t���W�B�T���wŪ�B�Ӹ�/�P��̵��^�F`firestore.rules` �s�W `isRestrictedAccount()`�A�O�@ `users.isRestricted*` ���� super_admin �i��A�ê��׳Q����b�����D�n�ϥΪ̼g�J���|�C
- **�аV**�G�b������Y�u���e�� UI �|�Q console ¶�L�A�ܤ֭n�P�B�� Rules �����O�@�P�`���g�J����F�ɯ��d�I�������b `showPage()` �o�س�@�J�f���C�|���v�C

### 2026-02-26 �X �Ѱ���������������s�u�\��ǳƤ��v�תO
- **���D**�G��������������������s�I����Q `�\��ǳƤ�` �����d�I�A�L�k�i�J����C
- **��]**�G`bindNavigation()` �N `page-teams` �P `page-tournaments` �@�_��b�P�@�ӥ��}��תO���󤺡C
- **�״_**�G�u�O�d `page-tournaments` ��� `�\��ǳƤ�`�A���� `page-teams` ���d�I�F��s `CACHE_VERSION` �P `index.html` �����ѼơC
- **�аV**�G�����������Ȱ��\�����v������A���n��h�ӭ����j�b�P�@����A�קK�}��@���ɻ~�ץt�@���C
### 2026-02-26 — 球隊頁新增球隊按鈕（依 rolePermissions 顯示）
- **問題**：球隊頁沒有直接的新增球隊入口，用戶需先進入球隊管理頁；且新增入口未依後台角色權限 `team.create` 動態控制顯示。
- **原因**：`pages/team.html` 的球隊頁 header 只有標題，建立球隊入口僅存在於球隊管理頁，且 `showTeamForm()` 建立模式沒有權限防呆。
- **修復**：在球隊頁 header 新增 `新增球隊` 按鈕；於 `team-list.js` 新增 `team.create` 權限判斷與按鈕顯示更新（同步作用於球隊管理頁既有新增按鈕）；在 `team-form.js` 的 `showTeamForm()` 建立模式加入權限檢查與提示；更新 `CACHE_VERSION` 與 `index.html` 版本參數。
- **教訓**：新增功能入口若受角色權限控制，除了 UI 顯示條件外，入口函式本身也要補一層防呆，避免被 console 或舊 DOM 狀態繞過。
### 2026-02-26 — 球隊建立領隊必填、詳情頁編輯入口、入隊申請站內信修復
- **問題**：建立球隊可不設定領隊；球隊詳情頁缺少直接編輯入口；部分球隊送出入隊申請後領隊收不到站內信。
- **原因**：`handleSaveTeam()` 未驗證新增模式領隊；球隊詳情頁 header 無編輯按鈕與權限判斷；入隊申請收件人僅依 `team.captainUid` / 名稱單一路徑解析，遇到 legacy `captainUid`（docId）或名稱不一致時會投遞失敗。
- **修復**：建立球隊新增領隊必填且需為有效用戶驗證；在球隊詳情頁 header 新增 `編輯球隊` 按鈕，僅球隊領隊或具有 `team.manage_all` 權限者顯示並可進入編輯；新增領隊解析 helper（支援 `uid/_docId/name/displayName/teamId+captain role` fallback），入隊申請改用解析後的有效 `uid` 投遞站內信；更新 `CACHE_VERSION` 與 `index.html` 版本參數。
- **教訓**：涉及收件人身分的資料（如 `captainUid`）要容忍 legacy 欄位格式與名稱不一致，應集中成單一解析 helper，避免每個功能各自猜測欄位。
### 2026-02-26 — 補充：站內信即時監聽排序欄位缺失（timestamp）
- **問題**：部分站內信（包含入隊申請）寫入後收件人看不到。
- **原因**：`messages` 監聽使用 `orderBy('timestamp', 'desc')`，但 `FirebaseService.addMessage()` 寫入僅有 `createdAt`，缺少 `timestamp`，導致新文件被查詢排除。
- **修復**：`js/firebase-crud.js` 的 `addMessage()` 補上 `timestamp: serverTimestamp()`（保留 `createdAt`）。
- **教訓**：查詢使用 `orderBy()` 的集合，所有寫入路徑都必須保證該欄位存在，否則會出現寫入成功但訂閱查不到的假象。
### 2026-02-26 — rolePermissions 改為 onSnapshot 即時同步
- **問題**：後台調整角色權限（例如 `team.create`）後，其他用戶端不會立即反映新功能，需要重整頁面才生效。
- **原因**：`rolePermissions` 原本僅在 `FirebaseService.init()` 時 `get()` 一次，之後不在 `_liveCollections` 即時監聽範圍內；前端功能判斷讀的是本地 `FirebaseService._cache.rolePermissions`。
- **修復**：將 `rolePermissions` 改為 `onSnapshot` 即時同步（初始化等待首個 snapshot），更新快取與 localStorage；權限更新時自動刷新受影響頁面（球隊頁、球隊管理、球隊詳情、自訂層級管理）；更新 `CACHE_VERSION` 與 `index.html` 版本參數。
- **教訓**：凡是用於前端功能 gating 的設定資料（feature permission matrix），若要求管理端變更後立即生效，就不能只做啟動時 `get()`，需使用即時同步或明確的重新載入機制。

### 2026-02-26 — 活動管理排序、球隊領隊必填標示與分享活動文案精簡
- **問題**：活動管理列表排序未依時間優先；球隊表單領隊欄位缺少必填紅字提示；分享活動文案包含不需要的費用欄位。
- **原因**：活動管理渲染僅依既有過濾結果直接輸出，未做時間排序；球隊表單標籤未標示必填；shareEvent() 文案仍保留舊版費用欄位。
- **修復**：event-manage.js 新增活動管理預設排序（未結束活動依距今時間最近優先，已結束/取消排後）；pages/team.html 領隊欄位標籤加入紅字 *必填；event-list.js 分享活動文案移除費用行；同步更新 CACHE_VERSION 與 index.html 版本參數。
- **教訓**：列表排序規則應集中在渲染入口明確定義，避免依賴資料原始順序；對必填欄位需在 UI 明示，減少使用者誤填。
### 2026-02-26 - Fix ghost team card after team deletion
- **Problem**: After deleting a team from team management, some users could still see a deleted team card on the teams page after refresh until they navigated away and back.
- **Cause**: Teams onSnapshot updated cache only but did not re-render team pages immediately; team deletion also used fire-and-forget behavior and could show local success before backend deletion completed.
- **Fix**: Added teams realtime UI refresh hooks in firebase-service.js; changed ApiService.deleteTeam() to async/await and only remove local cache after backend delete succeeds; made team-form delete flow await delete and show error toast on failure; updated cache version and index.html version params.
- **Lesson**: Realtime cache updates need matching UI refresh paths, and destructive operations should not be fire-and-forget.

### 2026-02-26 - Add event pinning in activity management and home hot events
- **Problem**: Activity management lacked pin/unpin controls; pinned events were not visually highlighted in activity cards; home hot-events section did not reflect event pinning.
- **Cause**: Event cards had no `pinned/pinOrder` UI handling in `event-manage.js` and `event-list.js`, and home/activity sorting ignored pin metadata.
- **Fix**: Added pin/unpin button to activity management (inserted after roster button and before edit in the action flow), added `toggleMyActivityPin()` with `pinned/pinOrder` updates, prioritized pinned events in activity management sorting and home hot-events sorting, and added pinned border/badge styling to activity management cards, activity timeline cards, and home hot-event cards; updated cache version and index version params.
- **Lesson**: Pinning needs both ordering logic and visual affordance; otherwise users cannot confirm whether pin state is applied.
### 2026-02-26 - Add separate team leader and team manager fields
- **Problem**: Team form and team info only had one captain field, but operations needed separate roles for 球隊領隊 and 球隊經理 with required selection during team creation.
- **Cause**: Team schema/UI used only `captain/captainUid`, so the same field handled both display meaning and permission-bearing manager role.
- **Fix**: Added `leader/leaderUid` selection UI and validation in team form (required valid user on create), relabeled existing captain field to 球隊經理, reordered team detail info grid to show 領隊 and 球隊經理 on the first row, and updated team management/admin team cards/search to show and match the new leader field; updated cache version and index version params.
- **Lesson**: When introducing a second business role, keep existing permission-bearing fields stable and add a new field for display/business semantics to avoid breaking authorization logic.
### 2026-02-26 - Align leader/manager wording and limited-event visibility
- **Problem**: Team leader (leader field) and team manager (captain field) had unclear role wording in the custom-role page, team leaders could not see their own team-only events, and leader capsules looked the same as manager/captain capsules.
- **Cause**: Custom role UI displayed only the built-in `captain` label, limited-event visibility checked only `currentUser.teamId`, and team-detail leader tag reused the captain capsule style.
- **Fix**: Updated user-admin-roles UI to show `captain` as「領隊 / 經理」for custom-role hierarchy/permission panel, expanded team-only event visibility to include teams where the current user is `captain` or `leader`, added a direct event-detail visibility guard, and added a distinct `uc-team-leader` capsule style for the team leader tag in team detail.
- **Lesson**: When one stored role is reused for multiple business titles, keep data model stable but make UI wording and visibility checks explicit to avoid behavior mismatches.
### 2026-02-26 - Add team-only signup lock and event public toggle in event detail
- **Problem**: Non-team viewers could still see a normal signup CTA on team-only events, and organizers/team staff had no quick way to toggle team-only event public visibility from the activity detail page.
- **Cause**: Event detail signup button logic did not distinguish team-only non-members, and event visibility/public toggle controls existed only indirectly in create/edit data without a detail-page control or shared staff visibility helpers.
- **Fix**: Added team-staff/team-membership helpers in event-list.js, allowed public team-only events to be viewable while keeping signup restricted to the event team, rendered a disabled red「球隊限定」button for non-team viewers, added signup guard in event-detail-signup.js, and added an activity-detail title-side「活動公開」toggle (host + team leader/manager/coach) that updates `isPublic` on the event and refreshes views; updated cache version and index version params.
- **Lesson**: Team-only visibility and signup eligibility are different concerns; treat them separately so public viewing does not accidentally imply public signup.
### 2026-02-26 - Allow admin public-toggle and swap team manager/leader order in team info
- **Problem**: Admin/super_admin could view team-only events but could not use the event-detail public toggle unless they were the host or team staff; team detail info card also needed 球隊經理 shown before 領隊.
- **Cause**: `_canToggleEventPublic()` only checked host/team staff, and team detail info grid rendered 領隊 first.
- **Fix**: Updated `_canToggleEventPublic()` to allow `admin+`, and swapped the first-row order in team detail info to `球隊經理` then `領隊`; updated cache version and index version params.
- **Lesson**: Operational controls often need an explicit admin override even when business ownership checks already exist.
### 2026-02-26 - Add team-only button toast and team link in event detail
- **Problem**: The red team-only signup button in event detail could not be clicked to show feedback, and the team name in the「限定 <球隊> 專屬活動」text was not clickable.
- **Cause**: The team-only button was rendered as disabled, and the team-only label text used plain text for the creator team name.
- **Fix**: Changed the red `球隊限定` button to a non-signup toast trigger (`App.showToast('球隊限定')`) and rendered the team name in the team-only label as a clickable link to `App.showTeamDetail(creatorTeamId)` when team id exists; updated cache version and index version params.
- **Lesson**: A blocked action should still provide a clickable feedback path when the UI visually looks like a button.

### 2026-02-26 - Fix team-only events hidden from team members in activity calendar
- **Problem**: Team members could not see their own team-only events in the activity calendar/list in some production sessions.
- **Cause**: `_getVisibleTeamIdsForLimitedEvents()` relied on `currentUser.teamId` plus staff-role scans, but some sessions had no `teamId` on `currentUser` while membership existed in `adminUsers`.
- **Fix**: Added `adminUsers` fallback lookup (by `uid`/name) in `js/modules/event-list.js` when building visible team IDs for team-limited events; updated cache version and `index.html` version params.
- **Lesson**: Create/view permission paths should share the same membership fallback sources to avoid inconsistent visibility checks.

### 2026-02-26 - Activity calendar team-only badge label (clean)
- **Problem**: Team-only cards in the activity calendar did not show a fixed label text.
- **Cause**: The team badge label in activity timeline rendering used dynamic team-name data.
- **Fix**: Changed the activity calendar team-only badge text to fixed red label "球隊限定"; updated cache version to 20260226x and all index.html version query params.
- **Lesson**: Use fixed wording for fixed-status badges.
### 2026-02-26 - Unify team-only badge text across activity cards
- **Problem**: Team-only events showed mixed badge text (`限定` vs `球隊限定`) between hot-event cards and activity timeline cards.
- **Cause**: Hot-event card renderer in `event-list.js` still used the old short label.
- **Fix**: Updated hot-event card badge text to `球隊限定` to match the timeline card badge; bumped `CACHE_VERSION` to `20260226y` and updated all `index.html` version query params.
- **Lesson**: Keep fixed-rule status labels consistent across all list surfaces to avoid user confusion.
### 2026-02-26 - Fix delayed/missing event visibility after status transition
- **Problem**: An event could disappear from activity calendar/management for minutes after status changed, and some events were marked ended right at start time.
- **Cause**: Realtime events listener only watched `open/full/upcoming`, so events changing to `ended/cancelled` could drop from cache until a later full reload path; auto-end logic used start time instead of end time.
- **Fix**: Added dual realtime event slices (`active` + `terminal`) and merged cache updates in `js/firebase-service.js`; changed auto-end check to parse and compare event end time in `js/modules/event-list.js`; bumped cache version and index version params.
- **Lesson**: If UI state depends on status transitions, realtime listeners must cover both source and target statuses, and terminal-state timing must use end-time semantics.
### 2026-02-26 - Adjust activity calendar team-only badge text to 限定
- **Problem**: Requirement clarified that activity calendar cards should show the short badge text `限定` (not `球隊限定`) outside the card.
- **Cause**: Timeline card badge text had been standardized to `球隊限定` in earlier change.
- **Fix**: Updated timeline card badge text in `js/modules/event-list.js` to `限定`; bumped cache version to `20260226za` and updated all `index.html` version query params.
- **Lesson**: Keep UI label wording aligned with exact product wording for each surface, even when the underlying rule is the same.
### 2026-02-26 - Fix attendance write visibility and error handling in manual/scan flows
- **Problem**: Manual attendance confirm could appear "updated" but not persist in Firestore, and notes could look unchanged after refresh; scan flow also lacked explicit write-failure feedback.
- **Cause**: `ApiService.addAttendanceRecord/removeAttendanceRecord` swallowed Firebase errors; note rendering used `.pop()` on mixed-order records and could read older note entries.
- **Fix**: Made attendance add/remove propagate errors with cache rollback in `js/api-service.js`; added latest-record helper in `js/modules/event-manage.js` and switched note/checkout/checkin lookups to latest-by-time; improved `js/modules/scan.js` with write failure `try/catch` handling and fixed missing `modeLabel` variable in family confirm flow; bumped cache version and index params.
- **Lesson**: For audit-like event logs, UI must resolve "latest state" explicitly and must never report success when persistence failed.
### 2026-02-26 - Switch attendance edit delete to soft delete (status=removed)
- **Problem**: Super admin editing attendance could fail with permission denied because canceling checkin/checkout attempted hard delete on `attendanceRecords`, while rules deny delete.
- **Cause**: `removeAttendanceRecord()` used Firestore document delete and cache splice, conflicting with `attendanceRecords` rule `allow delete: if false`.
- **Fix**: Changed attendance removal to soft delete (`status: removed`, `removedAt`, optional `removedByUid`) in `js/firebase-crud.js` and `js/api-service.js`; attendance reads now filter out removed/cancelled records; updated event-manage summary to use filtered attendance source; bumped cache version and index params.
- **Lesson**: For audit collections, deletion should be represented as state transition, and read APIs must consistently hide removed rows.
### 2026-02-26 - Improve attendance write auth retry and permission error messaging
- **Problem**: Scan/manual attendance writes could fail with raw `Missing or insufficient permissions`, giving unclear guidance and no pre-write auth recovery attempt.
- **Cause**: Attendance writes executed even when Firebase Auth session was missing/stale, and raw Firestore errors were surfaced directly.
- **Fix**: Added `ApiService._ensureFirebaseWriteAuth()` to retry Firebase sign-in before attendance writes; mapped Firestore permission/auth errors to clear Chinese guidance via `_mapAttendanceWriteError()`; bumped cache/version params.
- **Lesson**: For production writes, always gate by active auth state and normalize backend errors into actionable user-facing messages.

### 2026-02-26 - Strengthen attendance write auth retry
- **Problem**: Production attendance writes in manual edit and QR scan could fail with auth/permission errors and no self-recovery path.
- **Cause**: The write path only checked whether `auth.currentUser` existed, without token freshness validation or forced re-auth retry on permission-denied/unauthenticated errors.
- **Fix**: Updated `js/api-service.js` to validate token freshness before attendance writes, add one forced re-auth + retry path for permission/auth errors, add lightweight auth-state diagnostics logging, and validate required payload fields (`eventId`/`uid`) before write.
- **Lesson**: For critical production writes, auth existence checks are not enough; validate usable tokens and provide a controlled retry strategy for transient auth drift.

### 2026-02-26 — 修復簽到簽退權限與錯誤訊息中文化
- **問題**：活動頁面用編輯按鈕或掃碼方式簽到簽退時顯示「更新失敗：Firebase 登入已失效或權限不足，請重新登入 LINE 後再試」。
- **原因**：(1) Firestore rules 中 `attendanceRecords` 的 `allow update` 設為 `isAdmin()`，教練(coach+)在取消勾選簽到/簽退時觸發的 soft delete（update 操作）被規則拒絕；(2) `_mapAttendanceWriteError()` 返回英文錯誤訊息，中文 app 顯示不當；(3) event-manage.js 的 catch 區塊有額外的正規表達式覆蓋邏輯，導致錯誤訊息不一致。
- **修復**：(1) `firestore.rules` 中 attendanceRecords update 規則從 `isAdmin()` 改為 `isCoachPlus()`；(2) `js/api-service.js` 中 `_mapAttendanceWriteError` 所有錯誤訊息改為中文；(3) 簡化 `js/modules/event-manage.js` 的 catch 區塊，直接使用 `_mapAttendanceWriteError` 返回的中文訊息；(4) 更新快取版本至 `20260226zf`。
- **教訓**：Firestore rules 必須與 UI 層允許的操作角色對齊；面向用戶的錯誤訊息需與 app 語言一致，避免在 error mapper 和 catch 區塊中做雙重轉譯。

### 2026-02-26 — 簽到簽退 update 規則放寬，確保活動主辦/委託人皆可操作
- **問題**：attendanceRecords 的 update 規則為 `isCoachPlus()`，但活動委託人可能不是 coach+ 角色（如一般用戶被指派為委託人），導致無法取消勾選（soft delete = update）。
- **原因**：Firestore 規則無法用 `eventId`（邏輯 ID）反查 events 文件的 `creatorUid`/`delegates`（因 events 使用自動產生的 document ID），無法在規則層做活動歸屬檢查。
- **修復**：將 attendanceRecords update 規則從 `isCoachPlus()` 放寬為 `isAuth() && !isRestrictedAccount()`；安全性由前端存取控制（`_canManageEvent`：admin / owner / delegate）+ 審計軌跡（`removedByUid`）+ `delete: false` 共同保障。
- **教訓**：當 Firestore 規則無法做跨集合歸屬驗證時，採用「寬鬆規則 + 前端存取控制 + 審計軌跡」的分層安全策略。

### 2026-02-26 — 修復 Firebase Auth 狀態恢復競態導致簽到寫入失敗
- **問題**：Firestore rules 和用戶資料都正確，但簽到寫入仍顯示「更新失敗：Firebase 登入已失效或權限不足」。
- **原因**：Firebase Auth 從 persistence（indexedDB/localStorage）恢復登入狀態是非同步的，但 `_hasFreshFirebaseUser()` 直接同步檢查 `auth.currentUser`，在恢復完成前會得到 null；`_signInWithAppropriateMethod()` 也沒有先等 persistence 恢復，即使先前已成功登入也會嘗試重新走 LINE Token → Cloud Function 流程。
- **修復**：(1) `js/firebase-config.js` 新增 `onAuthStateChanged` 監聽器與 `_firebaseAuthReadyPromise`，首次觸發即代表 persistence 恢復完成；(2) `js/api-service.js` 的 `_hasFreshFirebaseUser()` 先等待 `_firebaseAuthReadyPromise`（最多 5 秒）再檢查 `auth.currentUser`；(3) `js/firebase-service.js` 的 `_signInWithAppropriateMethod()` 先等 persistence 恢復，若已有有效 currentUser 則直接返回，避免不必要的 Cloud Function 呼叫；(4) 強化錯誤訊息：區分「Firebase 未登入」與「權限不足」兩種情境。
- **教訓**：Firebase Auth 的 `auth.currentUser` 在頁面載入後是非同步填入的，必須透過 `onAuthStateChanged` 或 `authStateReady()` 等待首次回呼後才可信賴；直接同步讀取會造成競態條件。

---

### 2026-02-28 - Firestore rules盤點與高風險修補（重點補記）
- **Problem**: Firestore rules 與前端/後端存取路徑長期累積，存在「登入即可跨人讀寫/刪除」與 queue 濫用風險，且缺少可持續回歸測試。
- **Scope**:
  - 先盤點 `firestore.rules` + code usage（collections/path + CRUD + 角色假設）
  - 建立 rules 自動化測試框架（Emulator + `@firebase/rules-unit-testing`）
  - 先修最低風險且不破壞既有流程的漏洞（cross-user damage、queue abuse）
- **Key Fixes (Rules)**:
  - `/registrations/{regId}`: 僅 owner 或 admin/superAdmin 可讀寫刪；禁止 member 操作他人 registration。
  - `/messages/{msgId}`: 僅 sender（`fromUid`）或 admin/superAdmin 可 update/delete/read（依現規則）；禁止跨人破壞。
  - `/linePushQueue/{docId}`: create 從 member 可寫改為至少 admin/superAdmin 才可寫；guest 明確拒絕。
  - 保留 admin/superAdmin 管理能力，不擴大破壞既有功能範圍。
- **Key Fixes (Tests)**:
  - 將原本標記 `[SECURITY_GAP]` 的重點案例（registrations/messages/linePushQueue）改為修補後預期，並用 `[SECURITY_GAP_FIXED]` 保留追蹤語意。
  - 強化 A/B 使用者互斥測試：memberA 不能讀/改/刪 memberB；member 不可批量刪他人資料。
- **Lesson**: rules 修補要以「最小破壞」為優先，先封鎖跨人破壞與濫用入口，再逐步收斂其他灰區權限。
- **Files**: `firestore.rules`, `tests/firestore.rules.test.js`

### 2026-02-28 - Firestore Security Rules 測試框架落地（repo root）
- **Requirement**: rules 測試依賴不得綁在 `functions/`；需在 repo root 建立可持續執行流程。
- **Implementation**:
  - root 安裝並使用：`@firebase/rules-unit-testing`、`firebase-tools`、`jest`、`cross-env`。
  - `firebase.json` 補齊 Firestore emulator 設定，並確保載入當前 `firestore.rules`。
  - `package.json` scripts:
    - `test:rules:unit`
    - `test:rules`（`firebase emulators:exec --only firestore`）
    - `test:rules:watch`
  - 測試 helper contexts 固定化：`guest/memberA/memberB/admin/superAdmin`，並集中 seed 入口（`withSecurityRulesDisabled`）。
- **Outcome**: rules regression 可在本機 emulator 內穩定重現與驗證。
- **Files**: `package.json`, `firebase.json`, `tests/firestore.rules.test.js`

### 2026-02-28 - Role usability smoke tests（角色可用性冒煙）
- **Goal**: 不追求全覆蓋，先驗證各角色核心操作是否可用。
- **Added contexts**:
  - `user(uidUser)`, `coach(uidCoach)`, `captain(uidCaptain)`, `manager(uidManager)`, `leader(uidLeader)`, `venue_owner(uidVenue)`, `admin`, `superAdmin`
  - 同步 seed `claims/token.role` 與 `/users/{uid}.role`，對齊目前 fallback 邏輯。
- **Coverage focus**:
  - user 對 own registration/message 的 CRUD 可用性。
  - coach+ 對 event、manager/leader 對 teams 的可用性驗證。
  - admin/superAdmin 可 create `linePushQueue`；一般 user 必須 fail。
  - 用 `[USABILITY_BLOCKED]` / `[SECURITY_GAP_USABILITY]` 標註「規格應允許但被擋」或「不該允許卻放行」。
- **Files**: `tests/firestore.rules.test.js`

### 2026-02-28 - UID 不一致登入修補與舊 users 文件相容
- **Problem**: LINE/Firebase UID 與 users docId 不一致時，前端容易出現 permission-denied 與 WebChannel 400/404 後續錯誤。
- **Fix Direction**:
  - 偵測 UID mismatch 時強制重新登入/刷新 token（避免 stale auth session）。
  - 避免前端去改寫 uid 主鍵型欄位。
  - 相容舊資料：允許 legacy users docId 轉移到 canonical uid doc（migrate once）。
- **Result**: 登入後 profile 同步流程更穩定，跨舊資料時不再直接卡死在 permission-denied。
- **Files**: `js/firebase-crud.js`, `js/modules/profile-core.js`, `js/firebase-service.js`（相關流程）

### 2026-02-28 - 活動建立「球隊限定」多選體驗重設計
- **Problem**: 原 team-only UI 不易讀、不好選，且無法自然支援 10+ 球隊多選。
- **UX Redesign**:
  - 改為「已選標籤 + 搜尋欄 + 勾選清單」的多選器。
  - `ce-team-select` 改為隱藏狀態源，新的 picker 負責互動與同步。
  - 文案改為全中文，移除英文狀態文字。
  - 列表可滾動、可搜尋、可快速取消單一已選球隊。
- **Files**: `pages/activity.html`, `css/base.css`, `js/modules/event-create.js`


### 2026-03-04 �X �C�����[�t�W��ѡ]�N�Ұʦ��]����^
- **���D**�G�ζ��ݭn�i����ѦҪ��u�C�����[�t�v�W��A���קK���ӿ�ѭ��}�C���ڦ]�C
- **��]**�G�L���Q�פ����A�N�ҰʻP��l�ƭt�����ߵ�����������@�i�l�����C
- **�״_**�G�s�W `docs/low-cost-acceleration-plan.md`�A���}�Y����z�N�Ұʸ��C��]�A�A�w�q Phase A/Phase B�B��@�W��B�禬�P���I�ﵦ�C
- **�аV**�G�į��u�Ƥ�������O���ڦ]�A�A�C��סF����M�u�N�Ұʡv�P�u��l�ƭt���v�i�קK����~�P�u���ǡC

### 2026-03-04 - Fix Firestore users/messages permission mismatch
- **問題**：[deliverMsg] 和 [updateCurrentUser] 觸發 Firestore Missing or insufficient permissions，且一般用戶清空訊息會走全域 delete。
- **原因**：Firestore.rules 與前端資料模型不一致；messages 仍偏舊欄位權限邏輯，users self-update 白名單不足。
- **修復**：更新 Firestore.rules 的 users/messages 規則；message-admin.js 寫入補上 fromUid/toUid/hiddenBy；message-inbox.js 清空改為 hiddenBy 個人隱藏。
- **教訓**：規則變更要與前端資料結構同步，訊息刪除需優先使用 per-user soft hide。

### 2026-03-04 — 新增亂碼檢查與即時修復規則
- **問題**：實作過程偶爾會出現無法判讀的亂碼，若未即時處理會擴散到更多檔案。
- **原因**：跨工具與編碼處理時，文字內容可能被錯誤轉碼（mojibake）。
- **修復**：在 AGENTS.md 與 CLAUDE.md 新增「實作亂碼檢查規則」，要求每次實作後檢查亂碼，能修即修，不能修需明確回報風險與方案。
- **教訓**：編碼檢查要納入每次實作的收尾檢查清單，避免小範圍亂碼演變成全域資料污染。

### 2026-03-04 — 修復收藏頁活動狀態誤顯示為報名中
- **問題**：用戶已取消活動報名，但個人頁收藏清單仍顯示「報名中」。
- **原因**：收藏清單狀態來源使用 event.status（活動整體狀態），未優先採用當前用戶在該活動的報名狀態。
- **修復**：在 js/modules/favorites.js 新增 _getFavoriteEventBadge()，優先依當前用戶 registrations 顯示「已報名/候補中/已取消報名」；無個人報名資料時才回退活動狀態。
- **教訓**：個人頁面中的狀態標籤必須以「用戶關聯狀態」為優先，避免與活動全域狀態混用。
### 2026-03-04 — 3D Charged Shot Phase 0 private lab launch
- **問題**：需要先驗證射門小遊戲耐玩度，但不能直接暴露給一般用戶，也不能污染正式排行榜資料。
- **原因**：正式站內 modal 與雲端排行榜尚未完成，若直接接入會提高風險（資料污染、權限與防作弊策略未就緒）。
- **修復**：新增 `docs/Phase 0~2 完成.md` 完整規格；新增私測頁 `game-lab.html`（Token gate）；新增 `js/modules/shot-game-engine.js` 與 `js/modules/shot-game-lab-page.js`；本地統計寫入 `sporthub_shot_game_lab_metrics_v1`，提供 JSON 匯出/重置；更新 `_headers` 對私測頁加上 `X-Robots-Tag: noindex`。
- **教訓**：遊戲功能應先做隔離式私測與本地指標驗證，再接正式雲端榜單；避免在驗證階段引入難回滾的資料與權限風險。

### 2026-03-05 — game-lab.html 一片藍（showGame 未實際顯示遊戲區塊）
- **問題**：開啟 `/game-lab.html?t=<token>` 後畫面一片藍，遊戲完全沒出現。
- **原因**：`shot-game-lab-page.js` 的 `showGame()` 使用 `gameSection.style.display = ''`（清空 inline style），導致元素退回 CSS 規則 `#game-section { display: none; }`，遊戲區塊永遠隱藏；gate 也因 `gate.style.display = 'none'` 被隱藏，頁面只剩 body 深藍漸層背景，即「一片藍」現象。
- **修復**：`showGame()` 改為 `gameSection.style.display = 'block'` 以確實覆蓋 CSS 規則；更新 `game-lab.html` 及 `js/config.js` 快取版本號至 `20260305`；index.html 全部 64 處 `?v=` 一併更新。
- **教訓**：用 `element.style.display = ''` 只會移除 inline style，若 stylesheet 仍有 `display: none` 則元素不會顯示。需顯示元素時必須設定具體值（如 `'block'`），不可依賴清空 inline style。

### 2026-03-05 — 蓄力時游標離開球體範圍導致蓄力斷開

- **問題**：按住蓄力後移動游標，一旦游標離開球體（或容器範圍），蓄力立即中斷。
- **原因**：
  1. `pointermove` / `pointerup` listeners 掛在 `container` 上，依賴 `setPointerCapture` 將事件路由到容器；在某些瀏覽器或觸控裝置上 `setPointerCapture` 表現不一致。
  2. `#shot-game-container` 缺少 `touch-action: none`，在行動端瀏覽器偵測到拖曳後觸發滾動意圖，發送 `pointercancel` 事件。
  3. `pointercancel` 被掛到 `onPointerUp`，會呼叫 `kick()` 意外踢球而非靜默中止蓄力。
- **修復**：
  1. `shot-game-engine.js`：改用 **window-level listeners 策略**：`pointerdown` 命中球後動態向 `window` 加掛 `pointermove`、`pointerup`、`pointercancel` 三個監聽；放開或取消後透過 `cleanupWindowListeners()` 一次移除。移除原本 `container.setPointerCapture` 呼叫。
  2. 新增獨立 `onPointerCancel`：靜默中止（`charging = false`、清除 UI）而不踢球。
  3. `game-lab.html`：`#shot-game-container` CSS 加入 `touch-action: none`。
  4. 快取版本號 `20260305b` → `20260305c`，同步更新 `index.html`（64 處）及 `game-lab.html`（2 處）。
- **教訓**：跨元素邊界的拖曳行為應改用 window-level listeners（動態掛載/卸載），比 `setPointerCapture` 更可靠且不受容器邊界限制；行動端務必加 `touch-action: none` 防止滾動劫持 pointer 事件。

### 2026-03-05 — 射門遊戲強化：門框反彈、連進特效、足球貼圖

- **問題**：私測版射門遊戲缺少「打中門框的物理回饋」、連進里程碑的情緒反饋，以及足球本體視覺辨識度。
- **原因**：
  1. 既有物理僅處理地面反彈與門線判定，沒有門柱/橫樑碰撞解算。
  2. `#sg-message` 只有一般得分文案，沒有連進里程碑視覺事件。
  3. 球材質為純色 `MeshStandardMaterial`，缺少足球紋理語意。
- **修復**：
  1. `js/modules/shot-game-engine.js`：新增門框碰撞解算（左右門柱垂直 capsule + 橫樑水平 capsule），在 `step()` 先處理碰撞再做門線進球判定，並加入反射、切向阻尼、旋轉衰減。
  2. `js/modules/shot-game-engine.js`：新增連進 `5/10/20/30` 里程碑判定，命中時顯示 `🔥 ×N 連進！`。
  3. `game-lab.html` + `js/modules/shot-game-engine.js`：新增 `flash-hit` 亮度閃白（`brightness(2)`）與 JS 觸發/清理機制。
  4. `js/modules/shot-game-engine.js`：用 `CanvasTexture` 動態生成經典黑白五邊形足球貼圖並套用到球材質。
  5. `game-lab.html`：`shot-game-engine.js` 快取版號 `20260305d` → `20260305e`。
- **教訓**：射門遊戲的手感與可理解性需要「物理回饋 + 視覺回饋」同時存在；碰撞、訊息、材質三者一起升級，才能讓玩家即時理解球路與成就節點。

### 2026-03-05 — 改用現成球貼圖素材並統一「當前最佳」文案

- **問題**：先前自繪球面貼圖方案在球體上出現變形與半球覆蓋感；底部歷史文案需由「開啟後最佳」改名為「當前最佳」。
- **原因**：自繪圖樣與球體 UV 映射不一致；UI 文案仍沿用舊字串。
- **修復**：
  1. `js/modules/shot-game-engine.js`：改用 `THREE.TextureLoader` 載入 `assets/ball/club-world-cup-2025/textures` 的 `Al_Rihla_baseColor / normal / metallicRoughness`，直接套到既有 `SphereGeometry` 材質。
  2. 同步設定貼圖 `flipY=false`、色彩貼圖 `sRGBEncoding`、`anisotropy`（上限 8）以改善方向與清晰度。
  3. `js/modules/shot-game-lab-page.js` 與 `game-lab.html`：將「開啟後最佳」全面改為「當前最佳」。
  4. `game-lab.html`：更新版本參數為 `shot-game-engine.js?v=20260305g`、`shot-game-lab-page.js?v=20260305e`。
- **教訓**：球體外觀優先採完整 PBR 貼圖流程（BaseColor/Normal/MetalRough）比臨時平面圖樣更穩定；文案命名需與產品語彙一致，避免同義詞造成認知落差。
### 2026-03-05 — 首頁 Firestore Listen/channel 400/404 連續報錯修復

- **起因**：
  1. `FirebaseService.init()` 在未完成登入時仍會啟動 auth-dependent 監聽（`messages/users/rolePermissions`）。
  2. 受保護監聽在未登入或登入切換中觸發 WebChannel 重試，首頁持續出現 `Listen/channel` 400/404。
  3. 登入完成後缺少穩定補啟動時機，初始化與 Auth 狀態容易失步。
- **修復**：
  1. `js/firebase-service.js`
     - `_watchRolePermissionsRealtime`、`_startMessagesListener`、`_startUsersListener` 加上 `auth.currentUser` 守門。
     - `_startAuthDependentWork()` 在未登入時直接 return，不再啟動受保護監聽。
     - `init()` 新增 `auth.onAuthStateChanged`，Auth 就緒後自動補啟動 auth-dependent 流程。
     - `destroy()` 補齊 `_authDependentWorkPromise`、`_authDependentWorkUid` 清理。
  2. `js/firebase-crud.js`
     - `createOrUpdateUser()` 三條成功路徑（新建/遷移/更新）都補呼叫 `_startAuthDependentWork()`。
- **驗收**：
  1. `node --check js/firebase-service.js` 通過。
  2. `node --check js/firebase-crud.js` 通過。
  3. 程式路徑確認：未登入不啟動受保護監聽，登入後會自動補啟動。

### 2026-03-05 — PK 射手榜刷新後紀錄消失（落庫與登入態修正）
- **問題**：PK 大賽頁面當下可看到「你」的成績，但刷新後常消失，懷疑未正確寫入資料庫。
- **原因**：
  1. `game-lab` 只檢查「有 Firebase user」就放行，匿名登入也可進入遊戲；但 `submitShotGameScore` 會拒絕 anonymous，造成提交失敗。
  2. 前端提交失敗被靜默吞掉（`catch(() => {})`），玩家看不到失敗原因。
  3. 後端僅更新 daily bucket，週榜/月榜不會落庫，切到週/月榜時刷新後更容易誤判為資料遺失。
- **修復**：
  1. `js/modules/shot-game-lab-page.js`：新增匿名登入擋板（需非匿名登入才可進入遊戲與寫榜）。
  2. `js/modules/shot-game-lab-page.js`：提交流程改為 `async/await`，失敗寫入 `console.warn`，遇 `permission-denied` 直接顯示「請回主站重新登入 LINE」。
  3. `functions/index.js`：`submitShotGameScore` 改為同步更新 `daily/weekly/monthly` 三個 bucket，回傳 `isNewBestByPeriod` 供除錯。
  4. 依快取規則更新版本：`js/config.js` `CACHE_VERSION` → `20260305n`，`index.html` 與 `game-lab.html` 全部 `?v=` 同步升版。
- **教訓**：排行榜功能必須把「可遊玩資格」與「可寫榜資格」對齊，且提交失敗不可靜默；UI 有多周期榜單時，後端 bucket 寫入也必須同步覆蓋，避免出現「當下看得到、刷新就消失」的假象。

### 2026-03-05 — 射門遊戲廣告偶發「被刪除」根因修復（seed 覆蓋）
- **問題**：射門遊戲廣告（`banners/sga1`）偶發突然變空白，表現像被隨機刪除；首頁 Banner 曾有類似偶發清空體感。
- **原因**：
  1. `FirebaseService._seedAdSlots()` 在 `cache` 為空時，使用 `set(..., { merge: true })` 直接把預設空值（`status: 'empty'`, `image: null`）寫回既有廣告文件，會覆蓋真實廣告資料。
  2. `_startAuthDependentWork()` 可能在公開 boot collections 尚未完成前就觸發，形成 seed 初始化競態，放大第 1 點發生機率。
  3. `_autoExpireAds()` 全站每分鐘執行，非管理員會話也會進入自動下架流程（雖多數會被 rules 擋寫），增加狀態抖動與誤判。
- **修復**：
  1. `js/firebase-service.js`：`_seedAdSlots()` 改為「先讀 doc，僅建立不存在的欄位」，不再覆蓋既有廣告內容。
  2. `js/firebase-service.js`：`_startAuthDependentWork()` 新增 `_initialized` 守門與 promise 去重，避免初始化競態導致重複 seed。
  3. `js/modules/ad-manage-core.js`：`_autoExpireAds()` 僅允許 admin+ 會話執行（Production），移除一般用戶端的無效自動寫入流程。
  4. 依快取規則更新版本：`js/config.js` `CACHE_VERSION` → `20260305o`，`index.html` 全部 `?v=` 同步升版。
- **教訓**：seed 類初始化必須是「只補缺」而非「覆蓋預設」，且需避開啟動競態；排程型寫入（如自動下架）應限制在可寫角色或後端任務，避免前端多端競態改寫正式資料。

### 2026-03-05 — 射手榜同玩家重複列（「你」+「玩家XXXX」）修復
- **問題**：射手榜會出現同一個玩家兩列，分數完全相同，一列是本地「你」，另一列是 `玩家XXXX`，看起來像重複寫入。
- **原因**：
  1. 後端排行榜以 `shotGameRankings/{bucket}/entries/{uid}` 寫入，實際上同 bucket 不會有同 uid 的重複文件。
  2. 前端渲染時先讀 Firestore 排名，再無條件把本地最佳分數（`player-self`）再 push 一列，造成同一人雙列。
  3. 當 Firebase Auth displayName 為空時，Firestore 那列會顯示 fallback 名稱 `玩家${uid尾碼}`，更像「另一個玩家」。
- **修復**：
  1. `js/modules/shot-game-lab-page.js`：榜單組裝改為以當前 `auth.currentUser.uid` 合併本地與遠端資料；若遠端已有本人列只更新更佳成績，不再新增第二列。
  2. `js/modules/shot-game-page.js`：主站嵌入版套用同一合併邏輯，避免雙列。
  3. 兩個模組提交分數時，`displayName` 改為優先採用 `LineAuth.getProfile().displayName`（auth displayName 為空時避免落成 `玩家XXXX`）。
  4. 依快取規則更新版本：`js/config.js` `CACHE_VERSION` → `20260305p`，`index.html` 與 `game-lab.html` 全部 `?v=` 同步升版。
- **教訓**：榜單渲染若同時混用「本地暫存分數」與「遠端排名」，必須先做 uid 去重與合併；否則即使資料庫無重複，UI 仍會誤導成重複寫入。
### 2026-03-05 — PK 射門 UI 可讀性與主題切換修正
- **問題**：淺色模式中央訊息過亮、左上 HUD 字太小、深色模式主題切換月亮圖示會被滑塊或邊界遮擋。
- **原因**：setMessage() 固定使用亮色字，HUD 字級偏小，主題切換按鈕的滑塊位移與圖示留白配置不足。
- **修復**：js/modules/shot-game-engine.js 新增淺色模式訊息顏色映射；game-lab.html 調整 HUD 字級（含手機版）並修正主題切換的 track overflow、icon z-index、moon 位置與 thumb 位移；快取版號更新為 20260305q（js/config.js、index.html、game-lab.html）。
- **教訓**：UI 在雙主題下都要檢查對比與可視範圍，切換元件要同時驗證層級、位移與邊界裁切。
### 2026-03-05 — 射手榜即時「幽靈玩家」重複列修復
- **問題**：同一局剛結算時，榜單會同時出現「你」與一筆 玩家XXX 同分資料；重新整理後重複列消失。
- **原因**：前端會先插入本地最佳成績列，雲端資料回來後若以 doc.id 比對不到自己（例如歷史資料鍵值不一致），就會在當下畫面形成雙列。
- **修復**：shot-game-lab-page.js 與 shot-game-page.js 新增排行榜 uid/id 身分去重、提交中暫存列機制（僅提交中才顯示本地列），並改為優先以 row.uid 對齊當前使用者；提交完成後強制重刷榜單以移除暫存列。
- **教訓**：排行榜合併本地暫存與遠端資料時，必須有穩定 identity key（uid）與「暫存列生命週期」控制，否則容易出現短暫幽靈重複列。
### 2026-03-05 - game-lab remove light cloud pattern and add opening loader
- **Issue**: Light theme background still had cloud icons, and game-lab lacked the same opening loading transition used on the main site.
- **Cause**: Light theme bg-pattern pointed to a cloud SVG, and game-lab did not include the loading-overlay / boot-loading UI and progress animation flow.
- **Fix**: Updated game-lab light theme bg-pattern to none (keep gradient only), added main-site style loading overlay (brand image, pixel progress bar, scan animation, percentage), and completed/hid overlay in bootShotGameLab() after initialization.
- **Lesson**: Standalone entry pages must explicitly include boot UX and completion timing when they bypass the main App init pipeline.
### 2026-03-05 - shot leaderboard name prefer LINE nickname
- **Issue**: Some leaderboard rows still showed placeholder names like player_xxxx instead of full LINE nicknames.
- **Cause**: Client-side submit name selection prioritized Firebase Auth displayName; when that value was placeholder-like, it was written into rankings.
- **Fix**: Updated js/modules/shot-game-lab-page.js and js/modules/shot-game-page.js to prefer LineAuth.getProfile().displayName first, and only fallback when unavailable; updated functions/index.js to avoid persisting placeholder-like names when better auth token name exists.
- **Lesson**: For social-login identity fields, establish a strict source priority and filter placeholder values before persistence.
### 2026-03-05 — 首頁空資料區塊隱藏與小遊戲卡片視覺升級
- **問題**：首頁在沒有近期活動/賽事時仍顯示空區塊，小遊戲卡文案與視覺不符合需求。
- **原因**：`renderHotEvents()` 與 `renderOngoingTournaments()` 在空資料時只顯示提示文案，沒有隱藏整個區塊；小遊戲卡沿用一般卡片樣式與舊標題副標。
- **修復**：`js/modules/event-list.js` 新增首頁區塊顯示控制與小遊戲捷徑渲染；`js/modules/tournament-render.js` 在無賽事時隱藏區塊；`pages/home.html` 更新小遊戲卡標題/副標；`css/home.css` 改為金色漸層底並加入規律反光動畫。
- **教訓**：首頁摘要區塊應採「有資料才顯示」策略，避免空區塊噪音；重點入口卡片要用專屬視覺語言凸顯優先級。
### 2026-03-05 — 小遊戲 HUD 位置調整與首頁顯示開關管理
- **問題**：射門遊戲「當前最佳」顯示在左下角不易對齊 HUD；後台缺少首頁小遊戲顯示開關，無法控管首頁是否顯示小遊戲卡。
- **原因**：`session-badge` 放在底部列；抽屜後台只有佈景主題入口，沒有遊戲配置頁與對應資料模型。
- **修復**：將 `session-badge` 移到左上 HUD（分數/連進上方，主站與 game-lab 同步）；新增 `gameConfigs` 資料流（DemoData / FirebaseService / ApiService / firebase-crud upsert）；新增 `js/modules/game-manage.js` 與 `page-admin-games`，並在抽屜加入「小遊戲管理」入口；首頁小遊戲顯示改為讀取 `gameConfigs.homeVisible`（預留 `HOME_GAME_PRESETS` 多遊戲結構）。
- **教訓**：首頁入口是否顯示屬於全站配置，應獨立成可擴充的設定集合，不應綁死在單一頁面固定文案或硬編碼顯示邏輯。
### 2026-03-05 — 射門 HUD 改為整合資訊卡（當前最佳 + 即時分數）
- **問題**：玩家希望左上角資訊改為單一欄位，顯示「當前最佳記錄」與「分數/連進」，並與右側九宮格得分說明卡等高。
- **原因**：原本 UI 將 `session-badge` 與 `分數/連進` 拆成三個 chip，資訊分散且高度與右側說明卡不一致。
- **修復**：`pages/game.html` 與 `game-lab.html` 改成單一卡片版型（標題/最佳紀錄/分隔線/即時分數列）；`css/game.css` 與 `game-lab.html` 內嵌樣式改為固定資訊卡高度、與九宮格說明卡同高；`js/modules/shot-game-page.js`、`js/modules/shot-game-lab-page.js` 新增 `onScoreChange` 即時同步與 session badge 模板更新邏輯。
- **教訓**：HUD 需以「資訊聚合與掃讀效率」為優先，並在視覺層建立一致對齊基準（同高卡片）來降低玩家辨識成本。
### 2026-03-05 — 球門左右移動範圍擴大 20%
- **問題**：球門左右移動範圍偏窄，希望邊界再往外增加 20%。
- **原因**：射門引擎內 `GOAL_MIN_X / GOAL_MAX_X` 為固定 ±6.6，導致可移動水平區間受限。
- **修復**：`js/modules/shot-game-engine.js` 改為 `GOAL_BASE_SWING_BOUNDARY * GOAL_SWING_RANGE_SCALE`，並將 `GOAL_SWING_RANGE_SCALE` 設為 `1.2`，使邊界由 ±6.6 擴至 ±7.92；同步更新快取版本 `20260305x`（`js/config.js`、`index.html`、`game-lab.html`）。
- **教訓**：遊戲可調參數應避免硬編碼，抽成「基準值 + 倍率」可降低後續平衡調校成本。
### 2026-03-05 — HUD 記分板重構與九宮格等高對齊
- **問題**：九宮格得分欄位需完整包覆分數格內容，當前最佳欄位需與九宮格等高，且分數/連進需要更醒目的多層記分板風格。
- **原因**：前版 HUD 為單層文字卡，字級偏小且視覺層級不足；高度使用固定值，無法保證以九宮格卡片實際高度為基準對齊。
- **修復**：`pages/game.html`、`game-lab.html` 改為「標題 + 分數/連進雙獨立框 + 最佳紀錄 + 底部即時列」堆疊結構；`css/game.css` 與 `game-lab.html` 內嵌樣式放大字級兩級並加入記分板視覺；`js/modules/shot-game-page.js`、`js/modules/shot-game-lab-page.js` 新增動態高度同步（以九宮格卡片高度套用至當前最佳卡）與焦點數值即時更新。
- **教訓**：HUD 需要同時處理資訊層級與版面對齊；當兩個卡片要求等高時，應由主卡實測高度驅動，不要依賴固定常數。
### 2026-03-05 — HUD 記分板資訊重排與欄位縮窄
- **問題**：希望分數/連進上層欄位縮窄，`當前最佳記錄` 移到中段，移除重複的分隔線與下層分數列，並在最上方改為 `本局記錄`。
- **原因**：上一版同時保留上層記分框與下層即時列，資訊重複；`當前最佳記錄` 放置層級也不符合使用者掃讀順序。
- **修復**：`pages/game.html`、`game-lab.html`、`shot-game-page.js`、`shot-game-lab-page.js` 將結構改為 `本局記錄 → 分數/連進雙欄 → 當前最佳記錄 → 分|射門|秒`；移除 `sg-session-divider` 與 `sg-session-live`；`css/game.css` 與 `game-lab.html` 內嵌樣式將上層雙欄寬度改為約 37.5%（較原先縮窄 25%），並調整數字字體為不換行、等寬數字風格，避免四/五位數換行。
- **教訓**：高頻資訊（本局分數）與歷史資訊（當前最佳）應分層排列且避免重複輸出，才能維持記分板可讀性。
### 2026-03-05 — 手機版 HUD 防換行與寬度保護
- **問題**：需兼顧主流手機尺寸，避免 HUD 過窄導致 `分|射門|秒` 在小螢幕換行或擠壓可讀性。
- **原因**：先前手機斷點下欄位寬度與字級配置偏緊，且右上九宮格與左上 HUD 可能互搶水平空間。
- **修復**：`css/game.css` 與 `game-lab.html` 手機斷點調整為更寬的記分板（`min(80vw, 252px)`）、最佳紀錄字級改 `clamp`、數字欄位最小寬度保護（`min-width: 78px`），並在 `<=390px` 時將九宮格得分卡下移避免壓縮 HUD。
- **教訓**：手機版 HUD 應以「不換行優先」設計，透過欄位寬度下限 + 響應式字級 + 元件錯位策略，兼顧可讀性與排版穩定。
### 2026-03-05 — HUD 左右欄位邊線重疊修正
- **問題**：左上本局記錄欄與右上九宮格得分欄在部分尺寸下邊線有輕微重疊。
- **原因**：兩側元件使用固定 left/right 與固定寬度，HUD 寬度缺少「扣除右側九宮格佔位」的最大寬度保護。
- **修復**：`css/game.css` 與 `game-lab.html` 為遊戲容器加入 `--sg-hud-left / --sg-guide-right / --sg-guide-width / --sg-hud-gap` 變數；左側 HUD 改為依 `--sg-hud-left` 靠左，右側九宮格改為依 `--sg-guide-right` 靠右；本局記錄卡新增 `max-width: calc(100% - (...))`，確保不會侵入九宮格區域；手機斷點同步套用變數。
- **教訓**：左右雙錨點 UI 需要「佔位計算式」而非單純固定寬度，才能避免邊線交疊。
### 2026-03-05 — 修復記分板下層母版容器被裁切
- **問題**：左上記分板下方母版區塊在部分尺寸下會被切掉，看起來像「下半截消失」。
- **原因**：HUD 同步高度邏輯將記分板 `height` 硬設為九宮格高度；當記分板內容高度大於九宮格時，底部內容會被裁切。
- **修復**：`shot-game-page.js`、`shot-game-lab-page.js` 的高度同步改為：先 `height='auto'` 取內容高度，再設 `height=max(九宮格高度, 內容高度)`，確保不裁切。
- **教訓**：等高策略不能只依外部參考高度，必須同時保護內容最小需求高度。
### 2026-03-05 — 射門遊戲第二廣告位未生效（改為 3D 球門後看板）
- **問題**：頁面下方廣告可正常顯示，但球門後方的第二廣告位沒有任何畫面。
- **原因**：原本程式只把 `banners/sga1` 寫入 DOM 的 `#sg-ad-container`，3D 引擎內沒有建立第二廣告看板，也沒有把廣告圖同步到引擎層。
- **修復**：
  - `js/modules/shot-game-engine.js`：新增球門後方 3D 廣告看板（frame + ad plane），提供 `setBillboardAdImage()` 動態更新貼圖。
  - `js/modules/shot-game-engine.js`：新增中央訊息半透明橫向底帶（隨主題切換），在訊息顯示時同步淡入淡出，提升廣告高彩度下文字可讀性。
  - `js/modules/shot-game-page.js`：`_loadAd()` 讀取 `sga1` 後同步更新底部廣告與 3D 看板貼圖；無廣告時會清空看板。
  - `js/modules/shot-game-lab-page.js` + `game-lab.html`：加入 `window.__shotGameAdImageUrl` 與 `shotgame-ad-updated` 事件，確保 lab 也同步更新第二廣告位。
- **教訓**：多廣告位需求不能只做 DOM 呈現，必須定義「同一資料源到多渲染層（DOM + 3D）」的同步機制與更新事件。
### 2026-03-05 — 移除右上九宮格面板並改為球門內嵌得分
- **問題**：右上角九宮格得分說明佔畫面空間，且與實際球門得分視覺分離。
- **原因**：得分值只在右上 UI 面板顯示，3D 球門格子本身沒有分數標籤。
- **修復**：
  - `pages/game.html`、`game-lab.html`：移除右上九宮格得分面板 DOM。
  - `js/modules/shot-game-engine.js`：在球門九宮格上新增 CanvasTexture + Sprite 分數標籤（100/50/20/40/10），分數會隨球門一起移動。
  - `css/game.css`、`game-lab.html` 內嵌樣式：將左上 HUD（本局記錄）改為水平置中，並強化 `sg-session-top-title` 置中樣式。
  - `js/modules/shot-game-page.js`、`js/modules/shot-game-lab-page.js`：`syncHudPanelHeight` 不再依賴已移除的 goal-guide 元素。
- **教訓**：分數資訊應盡量與可互動目標同層呈現，避免額外說明面板造成視線分散與版面擁擠。
### 2026-03-05 - shot-game billboard ad source fallback + 8x billboard space
- **Issue**: The behind-goal 3D billboard sometimes did not show the uploaded shot-game ad image.
- **Cause**: Frontend loading only read `banners/sga1`; when ad data existed under another doc id (but still `slot=sga1` or `type=shotgame`), the image was missed.
- **Fix**:
  - `js/modules/shot-game-page.js`: `_loadAd()` now resolves ad by layered fallback (ApiService cache -> `doc('sga1')` -> `where(slot=='sga1')` -> `where(type=='shotgame')`) and picks the latest active row by timestamp.
  - `game-lab.html`: Applied the same fallback strategy for lab entry.
  - `js/modules/shot-game-engine.js`: Added `BILLBOARD_SPACE_SCALE = sqrt(8)` and scaled billboard/frame/posts proportionally.
  - `js/config.js`, `index.html`, `game-lab.html`: bumped cache version to `20260305af`.
- **Lesson**: Do not hard-depend on one ad doc id; always provide slot/type fallback for rendering paths.
### 2026-03-05 - goal 3x3 score labels add translucent theme-aware backdrop
- **Issue**: Score numbers on the goal 3x3 grid were not clear enough in some scenes/themes.
- **Cause**: Label sprites only rendered text (stroke/fill) without a dedicated translucent backdrop behind the score.
- **Fix**:
  - `js/modules/shot-game-engine.js`: upgraded zone score sprite drawing to include rounded translucent backdrop panel.
  - Added dark/light theme palettes for score badge panel + text colors.
  - Added `syncZoneLabelTheme()` so label backdrop/text colors update immediately when theme changes.
  - Updated cache version to `20260305ag` in `js/config.js`, `index.html`, and `game-lab.html`.
- **Lesson**: Dynamic in-scene text should include an explicit contrast layer (panel/badge), not rely on background scene colors alone.
### 2026-03-05 - remove behind-goal 3D billboard ad board
- **Issue**: The behind-goal billboard ad still had intermittent image display problems and affected release stability.
- **Cause**: Billboard path depended on async texture mapping and multiple ad-source conditions, making runtime behavior harder to guarantee.
- **Fix**:
  - `js/modules/shot-game-engine.js`: disabled behind-goal billboard rendering with `ENABLE_GOAL_BILLBOARD = false`.
  - Kept `setBillboardAdImage()` API as a safe no-op to preserve page/lab compatibility.
  - Updated cache version to `20260305ah` in `js/config.js`, `index.html`, and `game-lab.html`.
- **Lesson**: If a non-core visual feature is unstable in production, disable it cleanly first, then reintroduce with observability.
### 2026-03-05 - enlarge goal 3x3 score badge backdrop to near-cell size
- **Issue**: The score badge backdrop on each goal grid cell was still visually too small.
- **Cause**: Both sprite scale and inner rounded panel size were conservative.
- **Fix**:
  - `js/modules/shot-game-engine.js`: increased score badge sprite scale from `0.72x0.48` to `0.94x0.88` of each cell.
  - Expanded inner rounded panel to `96% x 90%` of label canvas and reduced radius to keep corners natural.
  - Updated cache version to `20260305ai` in `js/config.js`, `index.html`, and `game-lab.html`.
- **Lesson**: For in-scene readability, adjust both texture content and world-space sprite scale together.
### 2026-03-05 - theme toggle switched to mask-slider reveal style
- **Issue**: The top-right theme switch still showed icons above the knob; desired behavior was reveal-by-occlusion.
- **Cause**: Previous design used icon+thumb overlap with active icon emphasis, not true cover/reveal interaction.
- **Fix**:
  - `game-lab.html`: refactored `.theme-toggle-*` styles so thumb acts as an opaque cover panel.
  - Dark mode (`.is-dark`): thumb moves left to cover sun and reveal moon.
  - Light mode: thumb moves right to cover moon and reveal sun.
  - Updated cache version to `20260305aj` in `js/config.js`, `index.html`, and `game-lab.html`.
- **Lesson**: For toggle semantics based on reveal, use layer order + overflow clipping, not icon opacity alone.
### 2026-03-06 - shot-game full-charge crosshair shake x5 (power>=100)
- **Issue**: At full charge, crosshair shake was not strong enough to create the intended high-risk feel.
- **Cause**: Existing shake formula only increased linearly in overcharge (`40 + (power-100)*1.8`), so full-charge impact was limited.
- **Fix**:
  - `js/modules/shot-game-engine.js`: added `FULL_CHARGE_SHAKE_MULTIPLIER = 5`.
  - `js/modules/shot-game-engine.js`: kept `power<100` shake unchanged, and applied 5x multiplier when `power>=100`.
  - `js/config.js`, `index.html`, `game-lab.html`: bumped cache version to `20260306`.
- **Lesson**: Lock the trigger window first (`power>=100`) before scaling intensity, so lower-charge handling remains stable.
### 2026-03-06 - overcharge shot curve boosted 5x (power>100)
- **Issue**: User wanted stronger ball flight curve when charge exceeds 100.
- **Cause**: Overcharge path only had moderate curve increase from side spin and curve boost.
- **Fix**:
  - `js/modules/shot-game-engine.js`: added `OVERCHARGE_CURVE_MULTIPLIER = 5`.
  - `js/modules/shot-game-engine.js`: in `kick()`, applied 5x multiplier to overcharge side spin and overcharge curveBoost bonus when `power>100`.
  - `js/config.js`, `index.html`, `game-lab.html`: bumped cache version to `20260306a`.
- **Lesson**: For gameplay feel tuning, isolate multiplier to overcharge window so normal-charge control remains stable.
### 2026-03-06 - crosshair drift tuned and release-shot aim aligned with reticle
- **Issue**: Crosshair drift felt too strong, and shot direction did not always match the reticle position at release.
- **Cause**: Drift only affected DOM transform, while shot target still used non-drift `aim` coordinates; drift amplitude was also too aggressive.
- **Fix**:
  - `js/modules/shot-game-engine.js`: added `CROSSHAIR_SHAKE_SCALE = 0.5` to reduce drift by 50%.
  - `js/modules/shot-game-engine.js`: tracked per-frame crosshair shake pixels and used release-time reticle position to solve world-space shot target on `GOAL_Z` plane.
  - `js/modules/shot-game-engine.js`: reset shake offsets on shot reset/cancel/new charge to avoid stale offsets.
  - `js/modules/shot-game-engine.js`: updated ball texture setup to force full UV coverage (`wrapS/T = RepeatWrapping`, `repeat(1,1)`, zero offset).
  - `js/config.js`, `index.html`, `game-lab.html`: bumped cache version to `20260306b`.
- **Lesson**: If UI jitter is part of gameplay, release-time physics must consume the same jittered coordinates; visual-only jitter causes perceived input mismatch.
### 2026-03-06 - switch shot ball to glTF source mesh for full texture coverage
- **Issue**: Ball texture looked like it was not fully covered on the gameplay ball.
- **Cause**: The game used `SphereGeometry` with atlas textures authored for the original glTF mesh UV layout, causing visible unmapped/dark regions.
- **Fix**:
  - `js/modules/shot-game-engine.js`: replaced runtime ball visual from procedural sphere to `assets/ball/club-world-cup-2025/scene.gltf` mesh.
  - `js/modules/shot-game-engine.js`: preserved a fallback sphere if `GLTFLoader` or glTF loading fails.
  - `js/modules/shot-game-engine.js`: centered/scaled loaded ball model to `BALL_RADIUS`, and applied shadow/material texture settings.
  - `js/modules/shot-game-page.js`: updated Three.js loader flow to also load `GLTFLoader` from r128 examples CDN.
  - `game-lab.html`: included `GLTFLoader.js` before shot-game engine script.
  - `js/config.js`, `index.html`, `game-lab.html`: bumped cache version to `20260306c`.
- **Lesson**: Atlas textures must match the mesh UV layout; if not, always render with the asset's native mesh or re-bake textures for the target UVs.
### 2026-03-06 - shot game theme now follows site theme in page mode
- **Issue**: Entering the shot mini-game page often showed dark theme even when the main site was in light theme.
- **Cause**: `shot-game-engine` only read `data-shot-theme` (lab mode) and otherwise fell back to `prefers-color-scheme`, skipping main-site `data-theme` / `sporthub_theme`.
- **Fix**:
  - `js/modules/shot-game-engine.js`: theme snapshot now resolves in this order: `data-shot-theme` -> `data-theme` -> `localStorage('sporthub_theme')` -> system prefers-color-scheme.
  - `js/modules/shot-game-engine.js`: removed extra matchMedia override path so page mode respects site theme consistently.
  - `js/config.js`, `index.html`, `game-lab.html`: bumped cache version to `20260306d`.
- **Lesson**: Shared components used by page and lab modes must support both theme sources, and should not bypass site-level theme state.
### 2026-03-06 - prevent page-game hard fail when GLTFLoader CDN is unavailable
- **Issue**: Entering the mini-game from main page could show "game load failed" even though engine fallback was available.
- **Cause**: `shot-game-page` treated `GLTFLoader` as required in `_loadThreeJs()`, so loader CDN failure rejected initialization before engine start.
- **Fix**:
  - `js/modules/shot-game-page.js`: added best-effort loader path (`_ensureGltfLoaderBestEffort`), and only keep Three.js core as hard requirement.
  - `js/modules/shot-game-page.js`: if `GLTFLoader` fails, log warning and continue so engine fallback sphere can run.
  - `js/config.js`, `index.html`, `game-lab.html`: bumped cache version to `20260306e`.
- **Lesson**: Optional visual enhancements (model loaders) should never block game boot path when a functional fallback exists.
### 2026-03-06 - fix shot click not starting charge after glTF ball migration
- **Issue**: Clicking/tapping the ball no longer started charging, so users could not shoot.
- **Cause**: Ball became an `Object3D` wrapper with child meshes; click detection still used non-recursive raycast (`intersectObject(ball)`), which misses child geometry.
- **Fix**:
  - `js/modules/shot-game-engine.js`: changed hit test to recursive raycast (`raycaster.intersectObject(ball, true)`).
  - `js/config.js`, `index.html`, `game-lab.html`: bumped cache version to `20260306f`.
- **Lesson**: When converting visuals from direct `Mesh` to grouped/nested objects, all raycast paths must use recursive intersection.
### 2026-03-06 - fix white fallback ball when glTF loader/model is unavailable
- **Issue**: The ball sometimes rendered as plain white with no visible pattern.
- **Cause**: When GLTFLoader/model load failed, engine fell back to a plain white sphere material.
- **Fix**:
  - `js/modules/shot-game-engine.js`: fallback sphere now loads baseColor/normal/metallicRoughness textures.
  - `js/modules/shot-game-page.js`: GLTFLoader best-effort now tries two CDNs (cdnjs, jsDelivr) before fallback.
  - `game-lab.html`: added secondary GLTFLoader CDN script include.
  - `js/config.js`, `index.html`, `game-lab.html`: bumped cache version to `20260306g`.
- **Lesson**: Fallback visuals should preserve key art identity, and external loader dependencies should have multi-source redundancy.
### 2026-03-06 — add homepage slimming implementation spec document
- **Issue**: Needed a decision-complete implementation spec for homepage slimming priorities.
- **Cause**: Team needed a handoff-ready document before coding P0/P1/P2 optimization tasks.
- **Fix**:
  - Added `docs/home-performance-slimming-spec.md` with prioritized plan, implementation steps, risks, tests, and delivery checklist.
- **Lesson**: For multi-step performance refactors, finalize executable spec first to reduce implementation ambiguity and rework.
### 2026-03-06 — 修復 claude-memory 混合編碼並統一記錄規範
- **問題**：`docs/claude-memory.md` 混入非 UTF-8 位元組，導致標準編輯工具無法安全讀寫，也阻斷後續修復紀錄追加。
- **原因**：同一檔案前段為 UTF-8、尾段誤混入 Big5/CP950 內容，形成混合編碼檔案。
- **修復**：
  - 備份原始混合編碼檔到 `C:\Users\kere\.codex\memories\FC-github-claude-memory-20260306-mixed-backup.md`。
  - 以前段 UTF-8、尾段 Big5 的方式無損重建全文，重新輸出為純 UTF-8。
  - 更新 `AGENTS.md` 與 `CLAUDE.md`，明定所有修復/功能記錄統一寫入 `docs/claude-memory.md`，不得另建或分散到其他日誌檔。
- **教訓**：知識庫檔案必須維持單一 UTF-8 規格；一旦發現混合編碼，應先做無損標準化，再繼續追加內容。

### 2026-03-06 — 首頁性能瘦身 V2 Step 1 基線凍結與施工矩陣
- **問題**：V2 規格已建立方向，但真正施工前仍缺少「目前首頁直接依賴什麼、哪些 page/group/data 映射其實不完整」的基線凍結，直接進 Step 2 會把推測當事實。
- **原因**：現況是 loader 架構與 eager scripts 並存，許多映射缺口被 `index.html` 全量載入掩蓋；同時 V2 白名單仍漏了部分首頁實際依賴。
- **修復**：
  - 新增 `docs/home-performance-slimming-step1-baseline.md`，凍結當前啟動鏈、首頁 bootstrap 依賴、route entry 面、loader/data 映射缺口與 Step 2 前置條件。
  - 確認 `shop.js` 的 `bindShopSearch()`、`event-create.js` 的 `bindTeamOnlyToggle()`、`ad-manage-core.js` 的 `trackAdClick()` 目前都不能在 Step 2 前直接移出首頁。
  - 確認 `page-game`、`page-admin-error-logs`、`page-admin-repair`、`page-qrcode`、`page-leaderboard` 是 Step 2 必須先補契約的高風險頁面。
- **教訓**：在無 build、全域 `Object.assign(App, ...)` 的專案中，先凍結真實依賴與缺口，比先動手移 script 更重要；若沒有基線矩陣，後續每一步都會退化成碰運氣施工。

### 2026-03-06 — 首頁性能瘦身 V2 Step 2 導航 gateway 與 loader 契約
- **問題**：`showPage()` 目前沒有形成 `page -> script -> data -> render` 的等待鏈；`PageLoader` 也無法對 boot fragments 提供可等待契約，導致頁面首訪行為仍依賴 eager scripts 與載入時機碰運氣。
- **原因**：現況的 `PageLoader` 只支援部分 deferred page 的即時補載，`ScriptLoader` 也尚未具備「辨識已由 `index.html` eager 載入 script」的能力，因此一旦直接接上 loader 契約就會重複載 script 或首訪缺頁。
- **修復**：
  - `js/core/page-loader.js`：新增全頁面 `pageId -> fragment` 映射、boot pages 可等待契約、單檔載入去重與 `loadAll()` Promise 化。
  - `js/core/script-loader.js`：新增 DOM eager script 掃描、順序穩定載入、補齊 `page-game` / `page-admin-error-logs` / `page-admin-repair` / `page-qrcode` / `page-leaderboard` 等映射。
  - `js/core/navigation.js`：`showPage()` 改為先 `await` page/script/data ready，再切頁並 render；同時加入頁面切換序號，避免快速連點造成過時 render 覆蓋。
  - `js/config.js`、`index.html`：同步 bump `CACHE_VERSION` 至 `20260306h`。
- **教訓**：在腳本尚未真正抽離首頁前，必須先讓 loader 具備「識別既有 eager 資產」的能力，否則一接上 await gateway 就會先產生雙載與順序風險。
### 2026-03-06 - homepage slimming V2 Step 3 detail gateway and deep link guard
- **Issue**: Event/team detail pages could be rendered before their page shells were ready, and boot deep links (?event= / ?team=) retried by polling without waiting for a real detail-open completion.
- **Cause**: showEventDetail() and showTeamDetail() still used the old eager pattern of writing detail DOM first and navigating afterward. _tryOpenPendingDeepLink() also fired detail opens fire-and-forget, so cold start had duplicate opens and race conditions.
- **Fix**:
  - js/modules/event-detail.js: added event detail request sequencing, page-shell DOM checks, and async showEventDetail() that waits for showPage('page-activity-detail') before rendering.
  - js/modules/team-detail.js: added team detail request sequencing, page-shell DOM checks, async showTeamDetail(), and updated member-edit refresh paths to await detail rerender before reopening the members section.
  - `app.js`: added in-flight deep link open guard so one pending deep link only opens once at a time, and _tryOpenPendingDeepLink() now awaits detail open completion before deciding success/fallback.
  - js/config.js, index.html: bumped cache version to 20260306i.
- **Lesson**: In this no-build Object.assign(App, ...) architecture, detail pages must follow the same load shell -> ensure script -> render detail contract as route pages, or cold-start deep links will fail intermittently.
### 2026-03-06 - homepage slimming V2 Step 4 remove non-home eager route modules
- **Issue**: `index.html` still eagerly loaded many page-owned modules that are not required for homepage boot, so Step 2/3's loaders were not yet reducing homepage parse cost.
- **Cause**: Several route modules were still left in the eager block, and direct homepage/profile entry points (`App.showEventDetail()` / `App.showTeamDetail()`) would have broken if those modules were simply removed without a gateway fallback.
- **Fix**:
  - `js/core/navigation.js`: added lazy route gateways for `showEventDetail()` and `showTeamDetail()` so direct card clicks can first ensure the target page/script/data pipeline, then hand off to the real module implementation after it is loaded.
  - `index.html`: removed eager loading for non-home route modules now covered by `ScriptLoader`, including event detail, team detail/form/list, tournament manage, message admin, dashboard/personal dashboard, admin user/system pages, scan, shot game page, and ad-manage leaf pages.
  - `index.html`: deliberately kept `shop.js`, `event-create.js`, `ad-manage-core.js`, `profile-card.js`, and `leaderboard.js` eager because they still have cross-module bootstrap/runtime dependencies outside pure route entry.
  - `js/config.js`, `index.html`: bumped cache version to `20260306j`.
- **Lesson**: In this architecture, script slimming must be gated by actual call-entry analysis, not page ownership alone. If an eager module directly calls a function defined in another module, that callee cannot be removed from eager load until a gateway or dependency split exists.
### 2026-03-06 - fix Step 4 login regression from applyRole eager admin rerender
- **Issue**: Homepage login could throw `this.renderAdminUsers is not a function` immediately after user data synced.
- **Cause**: `js/modules/role.js` still assumed `renderAdminUsers()` was eagerly loaded and called it inside `applyRole()`. After Step 4, `user-admin-list.js` is lazy-loaded by route, so that eager-time call became invalid.
- **Fix**:
  - `js/modules/role.js`: changed `applyRole()` to rerender admin users only when `renderAdminUsers` is already present.
  - `js/config.js`, `index.html`: bumped cache version to `20260306k`.
- **Lesson**: After moving route modules out of `index.html`, every eager lifecycle hook must be audited for direct method calls into those modules. Route-owned renderers can no longer be treated as globally present at login time.
### 2026-03-06 - fix Step 4 team join regression from shared runtime helpers moved out of eager load
- **Issue**: Applying to join a team could silently fail on production/mobile, with no pending record shown in "我的球隊申請".
- **Cause**: `js/modules/team-form.js` still directly called `_deliverMessageToInbox()` and `_grantAutoExp()`, but those helpers live in `message-admin.js` and `auto-exp.js`. Step 4 moved both modules out of eager load even though they are still shared by user-facing pages, so clicking join could throw before any message record was created.
- **Fix**:
  - Restored `js/modules/message-admin.js` and `js/modules/auto-exp.js` to the eager script block in `index.html`.
  - `js/config.js`, `index.html`: bumped cache version to `20260306l`.
- **Lesson**: Before slimming eager scripts, distinguish true route-only modules from modules that currently hide shared runtime utilities. Shared helpers must either stay eager or be extracted into a dedicated bootstrap/runtime module first.
### 2026-03-06 - implement Step 5A deferred cloud boot for homepage slimming
- **Issue**: Production home boot still downloaded Firebase/LIFF eagerly because `DOMContentLoaded` always started Phase 4 immediately and `index.html` preloaded the CDN SDKs, so homepage render still competed with cloud initialization.
- **Cause**: Cloud startup logic lived inline inside `app.js` boot flow instead of a reusable gateway, and route/deep-link entry points had no shared way to demand cloud readiness only when needed.
- **Fix**:
  - `app.js`: extracted cloud startup into `App.ensureCloudReady()`, made script loading idempotent, and deferred normal home boot until after first paint while still forcing immediate init for deep links.
  - `js/core/navigation.js`: added cloud gating before protected route checks and page entry readiness so first route/detail entry can safely trigger initialization on demand.
  - `js/core/mode.js`: switched production mode boot to use the same `ensureCloudReady()` path.
  - `index.html`: removed Firebase/LIFF preload tags and bumped cache version to `20260306m`.
- **Lesson**: For this no-build script architecture, homepage slimming is only safe when cloud init has exactly one gateway. Deep link, guarded route, and mode-switch flows must all share the same once-only initialization path.

### 2026-03-06 - implement Step 5B staged home render for homepage slimming
- **Issue**: Homepage boot still executed banner autoplay, popup-ad startup, sponsors/floating ads/tournament rendering, and other non-critical home work inside the first render pass, so Step 5A alone could not materially lighten first paint.
- **Cause**: `App.renderAll()` still behaved like a monolithic homepage renderer, `renderBannerCarousel()` always started autoplay immediately, and popup ads were still modeled as a boot-time effect instead of a deferred home-only effect.
- **Fix**:
  - `app.js`: split homepage rendering into `renderGlobalShell()`, `renderHomeCritical()`, and `renderHomeDeferred()`, added deferred scheduling/cancelation helpers, and removed the old global popup timeout from boot.
  - `js/core/navigation.js`: when leaving home, now cancels pending deferred work and stops banner autoplay; returning to home reruns the staged `renderAll()` path instead of a direct home content render.
  - `js/modules/banner.js`: separated control binding from autoplay startup, added `stopBannerCarousel()`, and let `renderBannerCarousel({ autoplay: false })` render the first frame without starting the timer.
  - `js/modules/popup-ad.js`: added a per-session active-key guard so moving popup startup into deferred home render does not re-open the same popup stack every time the user revisits home.
  - `js/config.js`, `index.html`: bumped cache version to `20260306n`.
- **Lesson**: In this architecture, homepage slimming requires splitting "render DOM" from "start behavior". Anything that creates timers, overlays, or secondary sections must have an explicit deferred entry point and a cleanup path when the user leaves home.

### 2026-03-06 - add route loading overlay for cold page transitions and cloud pending
- **Issue**: After homepage slimming Step 5A/5B, first navigation from a cold `?clear=1` boot could spend noticeable time waiting for cloud/page/script/data readiness, but the UI often looked unresponsive during that delay.
- **Cause**: `showPage()` had no explicit loading feedback while awaiting `ensureCloudReady()` and `_ensurePageEntryReady()`. The project only had a heavy boot overlay and a deep-link overlay, so normal first route transitions had no clear waiting state.
- **Fix**:
  - `app.js`: added route-loading copy mapping plus delayed show / slow-network escalation / minimum-visible-time helpers for a shared route-loading overlay.
  - `js/core/navigation.js`: wrapped normal page transitions with `_beginRouteLoading()` / `_endRouteLoading()` and switched to an immediate cloud/login copy when the target page still requires cloud initialization.
  - `index.html`: added a lightweight route-loading overlay that reuses the existing deep-link loading card visual language.
  - `js/config.js`, `index.html`: bumped cache version to `20260306o`.
- **Lesson**: Once homepage boot is intentionally decoupled from cloud/page readiness, route-level waiting feedback becomes mandatory. Users should see a lightweight loading state whenever the app is waiting on initialization, not just during full boot or deep-link entry.

### 2026-03-06 - refine route loading into non-blocking status hint and reduce auth wording noise
- **Issue**: The first route-loading implementation was too visually heavy because it still used a centered overlay card, and the `正在確認 LINE 登入` copy appeared too often even when LIFF was already effectively ready.
- **Cause**: The loading feedback reused an overlay pattern that blocked the screen, while the phase selection treated most cloud-init waits as auth waits instead of distinguishing real auth-pending from generic data sync.
- **Fix**:
  - `index.html`, `css/base.css`: replaced the route-loading overlay with a small non-blocking status hint positioned below the toast.
  - `app.js`: changed route-loading copy to concise single-line hint text and updated the loading helpers to drive the new `#status-hint` element instead of a full-screen overlay.
  - `js/core/navigation.js`: split loading phases into `auth / cloud / page`, and only uses LINE wording when `LineAuth.isPendingLogin()` or LIFF session restoration is actually still pending.
  - `js/config.js`, `index.html`: bumped cache version to `20260306p`.
- **Lesson**: Route feedback should match the weight of the wait. For short transitional waits, a small anchored status hint is easier to tolerate than a blocking overlay, and auth wording must be reserved for true auth-pending states or it quickly becomes noise.

### 2026-03-06 - align status hint height with existing toast position
- **Issue**: After switching route feedback to the non-blocking `status-hint`, its vertical position still sat lower than the existing toast used by messages like `功能準備中`.
- **Cause**: `status-hint` used a different `bottom` offset than `.toast`, so the two patterns looked visually inconsistent.
- **Fix**:
  - `css/base.css`: changed `.status-hint` bottom offset to match `.toast` at `calc(var(--bottombar-h) + 16px)`.
  - `js/config.js`, `index.html`: bumped cache version to `20260306q`.
- **Lesson**: When introducing a new feedback component intended to match an existing interaction pattern, align anchor position as well as shape and motion; otherwise the UI still feels inconsistent.
