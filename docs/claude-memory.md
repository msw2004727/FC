# ToosterX — Claude 修復日誌（濃縮版）

此檔案隨 git 版本控制，記錄歷次 bug 修復與重要技術決策，供跨設備、跨會話參考。

> **維護規則**：
> - 新紀錄一律寫在檔案前方，採新到舊排序
> - `[永久]` 標記的條目為系統性教訓，永不過期
> - 一般條目超過 30 天且無持續參考價值時可清除
> - 同主題多次迭代合併為一筆（保留最終結果）
> - 純功能新增（可從 git log 得知）不記錄
> - 總行數超過 500 行時觸發清理

### [永久] 2026-04-09 — _isUserSignedUp displayName fallback 同名碰撞 bug
- **問題**：兩個不同用戶同名 "Lucas"，`_isUserSignedUp` 的 displayName fallback 用名字比對 `event.participants`，導致未報名的用戶被誤判為已報名，看到「取消報名」按鈕但無法取消（`getMyRegistrationsByEvent` 正確用 UID 查不到報名紀錄）
- **原因**：`event.participants` 存的是 displayName（非 UID），fallback 用 `p === name` 比對，同名即中招
- **修復**：移除 `_isUserSignedUp` 和 `_isUserOnWaitlist` 中的 displayName fallback，僅保留 UID 比對 registrations 快取。經驗證全部 49 個活動都有 registration 文件，fallback 無存在必要
- **教訓**：`event.participants` 是顯示用快取，不可用於身份判斷。所有身份相關判斷必須基於 UID，displayName 是用戶可任意修改的欄位

### 2026-04-09 — 球隊限定活動報名：後端未檢查職員身分
- **問題**：前端 `_getVisibleTeamIdsForLimitedEvents()` 會掃描 teams 集合，將 captain/leader/coach 也納入可報名範圍；但後端 Cloud Function `getUserTeamIds()` 只查用戶文件的 `teamIds`/`teamId`，不查 teams 集合的職員欄位。導致職員看到報名按鈕但實際報名被 `TEAM_RESTRICTED` 擋回。
- **修復**：`functions/index.js` 的 `submitShotGameScore` 旁的 `submitRegistration` Transaction 內，當 `teamIds` 比對失敗後補查 teams 集合的 `captainUid`/`leaderUid`/`captain`/`leader`/`coaches` 欄位，與前端邏輯對齊。
- **教訓**：前後端的權限/資格判定邏輯必須同步維護，前端新增判定路徑時要檢查後端是否也需要對應更新。

### [永久] 2026-04-07 — 寫入安全重構 Phase 1-5 + 同步指示器
- **問題**：8 項高風險 + 9 項中風險 Firestore 寫入用 fire-and-forget（`_update()`），失敗時 cache 汙染。鎖定函式在 `batch.commit()` 前改 live cache，違反 Rule #10
- **修復**：
  - Phase 1-3：新增 `updateEventAwait/TeamAwait/CurrentUserAwait`（snapshot + await + 失敗回滾）+ 全域同步指示器
  - Phase 4：_cleanupCancelledRecords batch 化；deleteTournamentAwait 分批 + 子集合獨立容錯
  - Phase 5（鎖定函式）：H6 遞補/H7 降級/H4 移除 → clone → simulate → commit → apply（模擬先行）
- **教訓**：
  1. `_update()` fire-and-forget 是系統性債務，關鍵寫入應改 `_updateAwaitWrite` 模式
  2. Rule #10 適用於所有 batch/transaction 路徑
  3. post-commit 寫回必須重新查詢 `ApiService._src()` live array（防 onSnapshot 替換 stale reference）

### [永久] 2026-04-06 — 角色卡在 user（兩輪修復，5 層防護完成）
- **問題**：總管角色偶爾卡在 user，LINE 放背景 → LIFF token 過期但 Firebase Auth 存活 → 退化路徑
- **根因**：`_startAuthDependentWork` 的 `BUILTIN_ROLE_KEYS.includes()` 條件跳過內建角色的 `applyRole`（三位專家一致認定）
- **修復（5 層）**：(1) init 讀 cache 不硬編碼 user (2) catch 也 applyRole (3) 移除 renderLoginUI 直接賦值 (4) 移除 BUILTIN_ROLE_KEYS 條件 (5) snapshot 新增 `App.currentRole !== next.role` 比對
- **教訓**：角色設定必須走 `applyRole()` 統一入口；權威解析完成後必須無條件套用；snapshot 的 roleChanged 無法偵測 UI 層損壞

### [永久] 2026-04-06 — 全站捲動跳頂問題修復（含簽到跳頂）
- **問題**：活動詳情、候補名單、訊息列表、俱樂部列表等，onSnapshot/SWR re-render 時捲動重置
- **根因**：`innerHTML` 全清式渲染 + attendance onSnapshot 觸發整頁重渲染 + early-return 漏掉 scrollTop 還原
- **修復**：8 處加 scrollTop save/restore；attendance source 只更新表格不重繪整頁；showEventDetail 同活動時 `{ resetScroll: false }`
- **教訓**：onSnapshot 資料刷新 ≠ 頁面導航；每次加 scrollTop 保護時必須檢查所有 early-return 路徑

### [永久] 2026-04-06 — Log 彈窗操作日誌排序修復（跨 7 次迭代）
- **根因鏈**：本地快取載入時機不確定 → Firestore orderBy 需複合索引靜默失敗 → `self._method()` this 綁定問題
- **最終修復**：直接查 Firestore（不加 orderBy 不需索引）+ 閉包 `_toMs` 函式 + `entries.sort(b.ms - a.ms)`
- **教訓**：async modal 需資料時直接查 Firestore；Firestore 複合查詢缺索引靜默回傳空；深層回調用閉包函式避免 this 問題

### 2026-04-06 — 運動項目切換 + 空結果指紋修復
- **修復**：解鎖運動選單、`'all'` 字串不用空字串；空結果時重置指紋（`_hotEventsLastFp = ''`）防跳過 re-render
- **教訓**：建立表單的 picker 與頂部 picker 完全隔離

### 2026-04-06 — 備註即時儲存 + 操作日誌 eventId 精確查詢
- note input 加 1s debounce 即時儲存；`_writeOpLog` 加 optional `eventId`，彈窗先精確查再 fallback 舊方式

### 2026-04-05 — 放鴿子 race condition + opLog 欄位名修正
- `_buildNoShowCountByUid` 加 `_attendanceSnapshotReady` 旗標，未就緒回傳 null
- opLog 欄位名 `log.action`→`log.type`、`log.detail`→`log.content`

### [永久] 2026-04-04 — 重複報名導致假額滿（三層防線修復）
- **問題**：同一用戶兩筆 confirmed registration，三道防線同時失效
- **原因**：(1) CF `doc(eventId)` 把邏輯 ID 當 doc ID（上線以來從未成功）(2) 前端 `.get()` 回傳離線快取 (3) `_rebuildOccupancy` 不去重
- **修復**：CF 改 `.where("id","==",eventId)`；前端 `.get({ source: 'server' })`；`_rebuildOccupancy` 加三元組去重
- **教訓**：event.id ≠ Firestore doc ID；enablePersistence 下 `.get()` 必須加 `{ source: 'server' }`；計數核心必須內建去重

### [永久] 2026-04-04 — 候補遞補排序失效（Timestamp 未轉換）
- **問題**：cancelRegistration 從 Firestore 讀取 registrations 時未轉換 Timestamp → `new Date(Timestamp)` = NaN → 排序隨機
- **修復**：加入 `data.registeredAt?.toDate?.()?.toISOString?.() || data.registeredAt`
- **教訓**：Firestore Timestamp 轉換必須在每個 `.docs.map()` 中執行，此類 bug 不報錯只靜默產生錯誤排序

### 2026-04-04 — 手動簽到即時儲存（Instant Save）
- checkbox 300ms debounce 自動寫 Firestore，per-UID sequential queue，失敗自動還原 + 閃紅
- **教訓**：eventId 不可用 closure 綁死，必須讀 `_attendanceEditingEventId`

### 2026-04-03 — 庫存系統 inv_transactions 權限修復
- **教訓**：Firestore Rules 欄位名必須與程式碼寫入的欄位完全一致

### 2026-04-02 — 首次登入 modal 繞過漏洞修復
- navigation.js showPage()/goBack()/hashchange 全加首次登入守衛；toggleModal 雙向 locked 檢查
- **教訓**：導航守衛必須覆蓋所有路徑，遺漏任一都是繞過漏洞

### 2026-04-02 — 編輯活動地區未預選 + HTML `&amp;` 教訓
- region 有值但 cities 為空 → 自動填入 `REGION_MAP[region]`
- **教訓**：新增欄位要考慮舊資料 fallback；onclick 屬性中 `&` 被編碼為 `&amp;`

### [永久] 2026-04-02 — LINE Mini App 首次登入彈窗不顯示（嚴重用戶流失）
- **原因**：`PageLoader.loadAll()` 非同步，LIFF 瞬間登入 → `showModal()` 時 HTML 還沒載完 → null → 靜默失敗
- **修復**：`_showFirstLoginWhenReady()` 每 300ms 重試（最多 10 次）
- **教訓**：依賴動態載入 HTML 的 showModal 必須加重試機制

### 2026-04-02 — Tournament P0-P2 production fixes
- **教訓**：`color-mix()` LINE WebView 不支援，用 rgba；涉及配額寫入應即時重讀最新狀態

### 2026-04-01 — 分隊功能多項修補
- 編輯時開關不顯示、均分無反應、jersey picker onclick 單引號避免 JSON.stringify 破壞
- **教訓**：checkbox `display:none` + `<label for>` 在 LINE WebView 不可靠

### [永久] 2026-04-01 — Cloud Function .catch() 靜默吞錯
- **起因**：開球王成績提交 `.catch(function () {})` 靜默吃掉所有錯誤
- **教訓**：CF 呼叫的 `.catch()` 絕不可用空函式靜默吞錯

### [永久] 2026-04-01 — 權限守衛新增規則 + 委託人權限
- **起因**：`event.view_registrations` 守衛讓所有 user 看不到報名名單；委託人按鈕可見但 hasPermission 擋住
- **規則**：(1) 查看類功能預設開放 (2) 守衛必須有 `_canManageEvent` fallback (3) 按鈕可見性與功能一致 (4) delegate 只需簽到+掃碼 (5) 每一層都需一致的 delegate 例外

### 2026-03-31 — 翻譯功能 + 推播通知開關
- 翻譯排除用 `data-no-translate` 源頭標記（16 檔 34 處），不靠啟發式規則
- 推播通知 Firestore Rules 以「文件 + 欄位」雙層收斂

### [永久] 2026-03-31 — Demo 死代碼全面移除（方案 C）
- 移除所有 isDemo/DemoData 引用（247 處 / 61 檔案）
- **教訓**：`if (!isDemo()) { prod }` 和 `if (isDemo()) { demo } else { prod }` 是兩種不同的刪除模式

### [永久] 2026-03-31 — 權限架構安全審查結論
- users 欄位白名單無漏洞；hasPerm() 讀取成本在免費額度內；INHERENT_ROLE_PERMISSIONS 兩地同步

### [永久] 2026-03-30 — 權限系統統一重構（Phase 1-4）
- 移除 17 頁 data-min-role、替換 22 處為 hasPermission()
- **教訓**：新頁面必須先加入 DRAWER_MENUS permissionCode

### [永久] 2026-03-30 — 手機日期選擇器 auto-fill 陷阱
- iOS/Android 開空 `input[type=date]` 自動填今天觸發 change → focus/change/blur 三段式 picker session
- **教訓**：`input[type=date]` 的 change 在手機上可能觸發多次，必須用 blur 確認最終值

### [永久] 2026-03-30 — 報名按鈕「載入中」卡住
- `_registrationsFirstSnapshotReceived` flag + 3 次重試後強制解除
- **教訓**：cache-first 架構必須區分「尚未載入」和「載入完成但為空」

### [永久] 2026-03-27 — Per-User Inbox 遷移 + 教育頁面即時渲染
- Inbox：465 用戶 2744 訊息遷移；Rules 限 CF 寫入。**教訓**：遷移歷史必須在切讀取之前
- 教育：eduSubPages 缺頁 → listener 被停。**教訓**：新增子頁面必須同步更新 eduSubPages + _renderPageContent

### [永久] 2026-03-26 — 教育簽到安全強化 + 彈窗定位 + 裁切比例
- 簽到走 CF + Rules 封鎖前端寫入。**教訓**：可審計資料必須由後端寫入
- `.page` 的 transform 建立新 containing block 使 fixed 失效 → JS 動態掛載 body
- **全站裁切比例**：封面 8/3、商品圖 4/3、banner 2.2、浮動廣告 1、彈窗 16/9
- teams `doc.id` ≠ `data.id`，CF/Map key 都需雙 key

### [永久] 2026-03-20 — 候補邏輯修復 + 快取清除角色降級 + 首次登入按鈕無反應
- 候補：降級時 activityRecord 必須同步更新；cancelCompanionRegistrations 改 5 階段模式
- 快取清除：必須先 auth.signOut() + liff.logout() 再清 localStorage
- 首次登入：懶載入模組方法不能綁 UI 事件；inline handler 執行時才解析 App

### [永久] 2026-03-19 — CDN 快取排查 + cancelRegistration 快取提前寫入
- **快取排查順序**：Cloudflare CDN → LINE WebView → Service Worker → 瀏覽器快取
- LINE WebView 快取需數小時～24 小時過期
- **教訓**：所有 Firestore 寫入，本地快取必須在 `await commit()` 之後才修改

### [永久] 2026-03-18 — 啟動 / 通知 / 鎖定 / 同步 / EXP / 建立活動（6 項系統性修復）
- 首次造訪卡空框架：loading overlay 移除須以「用戶可見內容就緒」為依據
- LIFF bounce 無限迴圈：改用 UA 偵測，不依賴 storage（LINE webview 隔離環境）
- 站內信失效：「任何頁面都可能觸發」的功能，依賴鏈必須在主載入階段就緒
- _flipAnimating 卡死：全域 boolean 鎖需 finally 保底 + 超時解鎖 + 頁面切換清理
- 跨裝置不同步：visibilitychange 刷新 + onSnapshot 重連 + localStorage UID 隔離
- EXP 全面修復：所有發放路徑（報名/取消/掃碼/確認/遞補）必須同時檢查
- 建立活動無反應：`finally` 不應用於重置 UI 鎖；關鍵收尾必須放在非關鍵操作之前

### [永久] 2026-03-17 — UID 一致性 + 統計汙染 + status 不匹配 + 孤兒誤刪 + 權限 seed
- UID：寫入 uid 必須是 LINE userId；歷史修正用 CF Admin SDK
- _userStatsCache：全域統計函式不能依賴單一用戶快取
- registrations 用 `confirmed` / activityRecords 用 `registered`：修改 status 過濾時追蹤所有來源
- 成就 status 必須與 CRUD 層一致
- event 有兩個 ID（doc.id ≠ data().id）；批量刪除必須先 dry-run
- _showPageStale：所有進入 _renderPageContent 的路徑必須有 ensureForPage 前置
- 新增入口權限後必須 bump catalog version 觸發 seed

### [永久] 2026-03-21 — 面板碰撞彈飛失效
- **教訓**：物理碰撞判定必須在同一個更新階段完成

### [永久] 2026-03-16 — 成就系統遷移 + 鎖定/解鎖
- 進度存 `users/{uid}/achievements/{achId}` 子集合；三道防火牆
- `locked` 預設 true，解鎖時 current < threshold 會撤銷

---

## [永久] UID / 資料完整性地雷

- 歷史 attendanceRecords uid 已透過 CF migrateUidFields 修正，寫入路徑已修復
- `event.participants` 存的是顯示名稱，絕不能直接作為 uid
- save loop 必須有「使用者有意操作」的證據，不能用 fallback 預設值推導刪除意圖
- 欄位對照：`users`→`uid`/`lineUserId`、`registrations`→`userId`、`attendanceRecords`→`uid`、`activityRecords`→`uid`、`events`→`creatorUid`
- UID mismatch 時強制重新登入/刷新 token

---

## [永久] 報名系統核心架構

- 所有 current/waitlist 變更必須透過 `_rebuildOccupancy()` 統一重建，禁止手動 current++
- registrations 查詢必須在 transaction callback 內
- cancelRegistration：commit 成功後才寫入本地快取（模擬模式）

---

## [永久] 資料來源與同步規則

- **registrations 是唯一權威資料來源**（activityRecords 是衍生資料）
- 統計關鍵集合不可設 limit
- 完成判定必須交叉比對 attendanceRecords（checkin + checkout）

---

## [永久] 權限 / Auth 模式

- 權限敏感欄位（exp/role）寫入走 CF + Admin SDK
- 權限治理三層同步：UI 按鈕、Firestore Rules、Cloud Functions
- `INHERENT_ROLE_PERMISSIONS` 兩地同步（config.js + functions/index.js）
- admin 入口權限由 super_admin 在 UI 啟閉

---

## [永久] Firestore Rules 模式

- 規則不是查詢後過濾器，前端必須先縮成規則可證明合法的查詢
- 候補遞補是跨用戶操作，batch 中每筆寫入都必須符合 rules

---

## [永久] 啟動 / 快取 / 性能架構

- 冷啟動分層：boot collections 不等 Auth；Auth 完成後背景啟動 listeners
- PAGE_STRATEGY：stale-first / stale-confirm / prepare-first / fresh-first
- seed 類初始化必須是「只補缺」而非「覆蓋預設」

---

## [永久] Deep Link / 登入 / 外部瀏覽器

- deep link + auth redirect + SPA 三者交會需注意資料就緒時序
- LIFF redirect 不保留 URL query params，跨 redirect 狀態存 sessionStorage
- `liff.getProfile()` 在外部瀏覽器不 100% 可靠，需 API fallback

---

## [永久] 通用開發模式

- Firestore 操作不應靜默回傳 false，應統一用 throw
- SPA 中 innerHTML 重建會摧毀注入的 DOM，載入狀態必須獨立於 DOM 追蹤
- iOS Safari 需 `-webkit-` 前綴；`100dvh` 需 `100vh` fallback；`replaceAll` 不可用
- 表單預設值：需同時檢查初始化、回填、toggle 補值與 reset

*最後清理日期：2026-04-07*
*原始檔案：449 行 → 清理後約 195 行*
