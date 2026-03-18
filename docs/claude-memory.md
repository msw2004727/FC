# SportHub — Claude 修復日誌（濃縮版）

此檔案隨 git 版本控制，記錄歷次 bug 修復與重要技術決策，供跨設備、跨會話參考。

> **維護規則**：
> - 新紀錄一律寫在檔案前方，採新到舊排序
> - `[永久]` 標記的條目為系統性教訓，永不過期
> - 一般條目超過 30 天且無持續參考價值時可清除
> - 同主題多次迭代合併為一筆（保留最終結果）
> - 純功能新增（可從 git log 得知）不記錄
> - 總行數超過 500 行時觸發清理

### 2026-03-18 — [永久] 站內信與 LINE 推播通知完全失效（Notification Fix）
- **問題**：活動報名、候補遞補、角色變更等自動通知全部停發（站內信 + LINE 推播），用戶收不到任何通知
- **原因**：`_deliverMessageToInbox` 定義在 `message-admin.js`，屬於 ScriptLoader `messageAdmin` 群組，僅在管理後台頁面載入。通知觸發點（活動頁面等）從未載入此模組，導致 `_deliverMessageWithLinePush` 內的 guard `typeof this._deliverMessageToInbox !== 'function'` 始終為 true，直接 return 跳過所有通知
- **修復**：
  - 將 `_deliverMessageToInbox` 及其 dedupe 輔助函式（`_buildInboxDeliveryDedupeKey`、`_claimRecentInboxDeliveryKey`、`_releaseRecentInboxDeliveryKey`、`_recentInboxDeliveryCache`）從 `message-admin.js` 搬到 `message-notify.js`（始終載入）
  - 移除 `_deliverMessageWithLinePush` 中的 `typeof this._deliverMessageToInbox !== 'function'` guard（函式現在永遠存在）
  - 搬入版本使用 `renderMessageList?.()` / `updateNotifBadge?.()` optional chaining，確保非訊息頁面不報錯
  - 從 `message-admin.js` 移除重複定義，`_processScheduledMessages` 透過 App 物件仍可正常呼叫
- **教訓**：依賴 ScriptLoader 延遲載入的函式不能作為核心通知路徑的必要條件。凡是「任何頁面都可能觸發」的功能，其完整依賴鏈必須在主載入階段就就緒，不可依賴按需載入的模組群組

### 2026-03-18 — [永久] _flipAnimating 卡死導致活動卡片無法點擊（F1+F2+F3+F4）
- **問題**：從分享連結進入首頁後，點活動卡片卡死進不去，必須重整瀏覽器才恢復
- **原因**：`_flipAnimating` 旗標在報名/取消的翻牌動畫期間設為 `true`，但多種場景下不會被重置 — (1) 報名中途離開頁面，catch 區塊未執行；(2) Firestore 掛住 await 永不 resolve；(3) `glowWrap` DOM 被 onSnapshot 替換後走不到 reset 行。此旗標一旦卡住，`showEventDetail` 入口的 `if (this._flipAnimating) return` 會擋住**所有**後續活動卡片點擊
- **修復**：
  - F1：`showEventDetail` 加 5 秒安全重置（`_flipAnimatingAt` 時間戳判斷），超時強制解鎖
  - F2：`handleSignup` 改用 `finally` 區塊確保 flag 重置，成功路徑在 `showEventDetail` 之前先解鎖
  - F3：報名/取消的 Firestore 操作加 15 秒 `Promise.race` timeout，防止永久掛住
  - F4：`_cleanupBeforePageSwitch` 離開活動詳情頁時強制清除 flag
- **教訓**：任何「全域 boolean 鎖」都必須有 (1) finally 保底重置、(2) 超時自動解鎖、(3) 頁面切換清理三層防線，缺一不可。特別是 async 流程中的鎖，任何 await 中斷、DOM 消失、網路掛住都會導致鎖孤立

### 2026-03-18 — [永久] 跨裝置報名狀態不同步修復（RC1+RC3+RC4+RC5+RC8）
- **問題**：兩台裝置看到的報名/取消狀態不一致，裝置 A 報名後裝置 B 仍顯示未報名
- **原因**：多層快取同步空窗疊加 — (1) 無 visibilitychange 刷新，切回分頁不更新；(2) localStorage TTL 120 分鐘內只讀快取不查 Firestore；(3) onSnapshot 斷線靜默失敗不重連；(4) localStorage 無 UID 隔離，換帳號讀到前用戶資料
- **修復**：
  - RC3：新增 `visibilitychange` 監聽，頁面切回時自動做一次性 Firestore 查詢刷新 registrations（1 秒防抖）
  - RC4：`onSnapshot` 錯誤回調改為自動重連（exponential backoff 1s→30s，上限 5 次），成功時重置計數
  - RC1：Auth 就緒後立即背景 Firestore 查詢刷新 registrations（stale-while-revalidate，不阻塞 UI）
  - RC8：localStorage key 加 UID 前綴隔離（`shub_c_{uid}_{collection}`），logout 時清除所有 `shub_c_*` / `shub_ts_*`
  - RC5：已有覆蓋（onSnapshot callback 已觸發 showEventDetail 重渲染）
  - QA 修復：reconnect timer ID 存儲 + destroy 清理、visibilitychange listener 可移除、並行 revalidation 競爭防護、legacy fallback 後恢復 UID 前綴
- **教訓**：Cache-first 架構必須有「切回刷新」和「背景驗證」機制，不能只靠 onSnapshot 即時同步（listener 有頁面範圍限制且可能斷線）。localStorage 快取必須有用戶隔離，否則換帳號會讀到前用戶資料

### 2026-03-18 — LINE Notify 綁定修復：外部/PC 瀏覽器無法綁定（P1）
- **問題**：從個人資訊頁或報名後彈窗綁定 LINE 推播時，外部手機瀏覽器和 PC 瀏覽器因 `liff.isLoggedIn()` 檢查而被擋住，無法完成綁定
- **原因**：`profile-data.js` 的 `bindLineNotify()` 有 LIFF 登入狀態檢查（`typeof liff === 'undefined' || !liff.isLoggedIn()`），但外部/PC 瀏覽器不會載入 LIFF SDK 或不會有 LIFF session
- **修復**：移除 LIFF 登入檢查，改為僅依賴 Firebase Auth 登入狀態（`ApiService.getCurrentUser()`）。LINE 推播的安全性由 Cloud Function `processLinePushQueue` 的自動解綁機制保障（偵測無效接收者時自動設 `lineNotify.bound = false`）
- **教訓**：LINE Notify 綁定只是在用戶文件上標記 bound=true + 引導加好友，不需要 LIFF session；實際推播由 Cloud Function 執行，無效接收者會自動解綁，不會造成安全問題

### 2026-03-18 — 取消報名速度優化 + _docId 防禦修復（B1+C1）
- **問題**：取消報名流程有兩個問題：(1) `_syncMyEventRegistrations` 前置查詢多花 200-500ms，而 `cancelRegistration` 內部已查詢相同資料；(2) 若快取中 `_docId` 缺失，`cancelRegistration` 的 `doc(undefined)` 會 crash
- **原因**：歷史上 `_syncMyEventRegistrations` 是為了補救快取缺 `_docId` 而加的，但 `cancelRegistration` 內部已查詢 firestoreRegs 卻沒有回填 `_docId` 給快取中的 reg
- **修復**：
  - `cancelRegistration` 中 fsReg 找到後自動回填 `reg._docId`（C1），且 `_docId` 防禦檢查移到快取變更之前，防止 throw 時汙染快取
  - `handleCancelSignup` 移除 `_syncMyEventRegistrations` 條件查詢（B1），且 `if (reg && reg._docId)` 門檻改為 `if (reg)`，讓 cancelRegistration 內部自行回填
- **教訓**：[永久] 移除前置資料修復（如 _syncMyEventRegistrations）時，必須確認下游函式的入口門檻不依賴被移除的前置修復結果。防禦性 throw 必須在狀態變更之前執行，否則會汙染快取

### 2026-03-17 — 修正瀏覽器重整後活動詳情頁空白模板閃現
- **問題**：在活動詳情頁重新整理瀏覽器後，deep link poller 觸發 showEventDetail()，先呼叫 showPage() 顯示空白模板（"活動圖片 800 × 300"），再渲染活動資料。若渲染失敗或競態條件觸發，用戶會看到空白頁面
- **原因**：showEventDetail() 在 line 221 先 await showPage('page-activity-detail') 使頁面可見，之後才在 line 240+ 渲染內容。showPage 與 render 之間存在競態窗口
- **修復**：重構 showEventDetail() 流程為「先確保 HTML/Script 載入 → 先渲染內容到隱藏 DOM → 最後才 showPage 切換顯示」。使用 PageLoader.ensurePage + ScriptLoader.ensureForPage 取代直接 showPage，所有內容渲染完成後才呼叫 showPage
- **教訓**：detail 頁面渲染應遵循「render-before-show」模式，避免空白模板閃現

### 2026-03-17 — [永久] UID 欄位一致性修正：attendanceRecords/activityRecords uid 欄位歷史資料不一致
- **問題**：部分 attendanceRecords 和 activityRecords 的 uid 欄位存的是 displayName（如「小白」）而非 LINE userId（如 `U196b...`），導致跨集合 JOIN 比對失敗，11+ 處代碼需要 nameToUid 補救邏輯
- **原因**：`event-manage-confirm.js:53` — `_confirmAllAttendance()` 從 `events.participants[]`（displayName 陣列）解析用戶時，若 adminUsers 查找失敗，直接用 displayName 作為 uid 寫入
- **修復**：
  - Phase 1（止血）：修改 `_confirmAllAttendance` 未能解析 UID 時跳過而非寫入 displayName；`_buildConfirmedParticipantSummary` 加 `uidResolved` 標記
  - Phase 2（治療）：新增 Cloud Function `migrateUidFields`（Admin SDK 繞過安全規則）批次修正 92 筆歷史資料，含 dry-run + 備份 + 同名交叉比對 registrations
  - Phase 4（清理）：移除 `_buildRawNoShowCountByUid`、`_getNoShowDetailsByUid`、`getParticipantAttendanceStats`、`_calcScanStats`、`ensureUserStatsLoaded` 中的 nameToUid/nameSet fallback 代碼，簡化架構
  - 前端觸發：`data-sync.js` 新增 `uidMigration` 操作，admin-system.html 新增「⑤ UID 欄位修正」按鈕
- **教訓**：寫入 Firestore 的 uid 欄位必須是 LINE userId，禁止用 displayName 代替；Firestore 安全規則禁止更新 uid 欄位，歷史資料修正必須用 Cloud Function Admin SDK；遷移完成後應清除 fallback 代碼避免技術債累積

### 2026-03-17 — [永久] 放鴿子計算 _userStatsCache 汙染：切換用戶導致其他人放鴿子數跳動
- **問題**：查看用戶 A 時放鴿子 = 0（正確），查看用戶 B 後 A 的放鴿子變成 1（錯誤）
- **原因**：`_buildRawNoShowCountByUid` 是全域函式（計算所有人），但合併了 `_userStatsCache`（只有當前查看的那一個用戶的簽到紀錄）。切換用戶後 `_userStatsCache` 被覆蓋，原先用戶的補充簽到紀錄消失，導致被誤判為放鴿子
- **修復**：移除 `_buildRawNoShowCountByUid` 和 `_getNoShowDetailsByUid` 中的 `_userStatsCache` 合併邏輯，全域快取已移除 limit 不再需要補充
- **教訓**：全域統計函式（計算所有人）絕對不能依賴單一用戶的快取資料作為補充來源，否則會因為切換用戶而汙染其他人的統計結果

### 2026-03-17 — [永久] firebase-service.js 全域快取 limit 移除（attendanceRecords / registrations / activityRecords）
- **問題**：全域快取 attendanceRecords limit 500、registrations limit 500（admin）/ 200（user），導致超過限制的紀錄被截斷，放鴿子計算漏掉簽到紀錄而誤判
- **修復**：移除三處 limit — `_getRegistrationsListenerQuery` 移除 limit(500)/limit(200)、`_startAttendanceRecordsListener` 移除 limit(500)、`_buildCollectionQuery` 對 attendanceRecords/registrations/activityRecords 不設 limit
- **教訓**：統計關鍵集合（attendanceRecords、registrations、activityRecords）不可設 limit，否則資料截斷會導致所有依賴這些集合的統計計算出錯

### 2026-03-17 — [永久] 放鴿子計算用全域快取（limit 200）vs 出席率用 userStatsCache（無 limit）導致不一致
- **問題**：用戶出席率 100% 但放鴿子顯示 1
- **原因**：`_buildRawNoShowCountByUid` 用 `ApiService.getAttendanceRecords()`（全域快取，limit 200），`_calcScanStats` 用 `getUserAttendanceRecords(uid)`（_userStatsCache，Firestore 直查無 limit）。如果用戶的簽到紀錄超過全域快取限制，放鴿子計算就會漏掉簽到紀錄而誤判
- **修復**：`_buildRawNoShowCountByUid` 和 `_getNoShowDetailsByUid` 合併全域快取 + _userStatsCache，用 _docId 去重
- **教訓**：所有統計計算必須使用相同的資料來源；全域快取有 limit 截斷風險，涉及個人統計時必須優先使用 user-specific cache

### 2026-03-17 — [永久] stats.js 缺少 displayName fallback 導致出席率與放鴿子不一致
- **問題**：用戶出席率 100% 但放鴿子次數 > 0，兩個數字矛盾
- **原因**：`stats.js` 的 `getParticipantAttendanceStats` 比對 `attendanceRecords.uid` 時用嚴格匹配（`uid === safeUid`），但歷史資料的 `attendanceRecords.uid` 可能存的是顯示名稱（如「小白」）而非 LINE userId。`_buildRawNoShowCountByUid` 和 `evaluator.js` 都有 nameToUid/nameSet fallback，唯獨 stats.js 沒有，造成同一筆簽到紀錄在一個路徑被認定有出席、另一個路徑被忽略
- **修復**：`getParticipantAttendanceStats` 新增 `nameSet` 參數，attendanceRecords UID 比對加入 displayName fallback
- **教訓**：所有涉及 attendanceRecords.uid 比對的函數，都必須包含 displayName fallback（這是 CLAUDE.md 統計系統保護規則的重點）

### 2026-03-17 — [永久] registrations 用 'confirmed' vs activityRecords 用 'registered' 混用導致統計歸零
- **問題**：修正 `'registered'` → `'confirmed'` 後，完成場次和出席率反而歸零
- **原因**：`_calcScanStats()` 把 `activityRecords`（status='registered'）當作 registrations 參數傳給 `getParticipantAttendanceStats()`，但該函數已改為只接受 `'confirmed'`
- **根本問題**：系統有兩個集合使用不同的 status 命名規則：
  - `registrations` 集合 → `'confirmed'` / `'waitlisted'`
  - `activityRecords` 集合 → `'registered'` / `'waitlisted'`
  - 兩者都會被餵進 `getParticipantAttendanceStats()` 作為 registrations 參數
- **修復**：`stats.js` 和 `evaluator.js` 的 status 過濾同時接受 `'confirmed'` 和 `'registered'`
- **教訓**：
  1. 修改 status 過濾時，必須追蹤該函數的**所有呼叫者**和它們傳入的資料來源
  2. `registrations` 和 `activityRecords` 是兩個獨立集合，status 欄位命名不同，但都會流入統計函數
  3. 任何改動 status 比對的地方，必須同時驗證兩條路徑

### 2026-03-17 — [永久] 成就系統 status 名稱不匹配導致所有報名相關成就失效
- **問題**：出席率 100% 仍無法獲得成就徽章，所有依賴 validRegistrations 的成就條件（出席率、完成場次、報名次數等）全部回傳 0
- **原因**：`evaluator.js` 和 `stats.js` 用 `status === 'registered'` 過濾報名紀錄，但 `firebase-crud.js` 實際寫入的是 `status: 'confirmed'`。系統中從未有任何地方寫入 `status: 'registered'`，導致 `validRegistrations` 永遠是空陣列
- **修復**：
  1. `evaluator.js` 3 處 `'registered'` → `'confirmed'`（優先度排序 + validRegistrations 過濾）
  2. `stats.js` 1 處 `'registered'` → `'confirmed'`（getParticipantAttendanceStats 過濾）
  3. `no_show_free` 改為計算放鴿子次數（原本計算連續出席數），加入 `reverseComparison`（current <= target）
  4. `registry.js` no_show_free defaultThreshold 10 → 0，加入 `reverseComparison: true`
- **教訓**：status 欄位值必須與 CRUD 層一致（`confirmed` / `waitlisted` / `cancelled` / `removed`），不可假設有 `registered` 狀態

### 2026-03-17 — [永久] 孤兒記錄清理 event.id vs Firestore doc.id 混淆導致全量誤刪
- **問題**：執行 `_syncOrphanCleanup` 後，registrations、activityRecords、attendanceRecords 三個集合被全部清空
- **原因**：修復快取問題時改用 `db.collection('events').get()`，但取有效 ID 時用了 `d.id`（Firestore 自動產生的 doc ID），而非 `d.data().id`（自訂的 event ID 如 `ce_xxx`）。由於 registrations 等集合的 `eventId` 欄位存的是自訂 ID，所以所有紀錄都被誤判為孤兒而刪除
- **修復**：改為同時收集 `d.data().id`（自訂 ID）和 `d.id`（Firestore doc ID），確保兩種 ID 都納入有效清單
- **資料恢復**：從 events.participants / waitlistNames 陣列重建 registrations、activityRecords、attendanceRecords（docs/rebuild-records.js）
- **教訓**：
  1. **event 有兩個 ID**：`doc.id`（Firestore 自動產生）≠ `doc.data().id`（程式自訂如 `ce_xxx`）。所有子集合（registrations/activityRecords/attendanceRecords）的 `eventId` 欄位存的是自訂 ID
  2. **任何批量刪除操作必須先做 dry-run**：先 log 要刪的數量和抽樣，確認後才實際刪除
  3. **Firestore 沒有自動備份**：此專案未啟用 PITR 或排程備份，刪除不可逆

### 2026-03-17 — [永久] 孤兒記錄清理用快取當有效清單導致誤刪
- **問題**：用戶出席率顯示 0% 而非 100%。診斷發現 7 個活動的 events 文件不存在，但 registrations/activityRecords/attendanceRecords 還在
- **原因**：`_syncOrphanCleanup` 用 `ApiService.getEvents()`（前端快取，limit 200+200）作為有效活動清單。若系統活動超過快取上限，正常活動被誤判為孤兒而清除相關資料，或活動本身被正常刪除但級聯清理不完整
- **修復**：改為 `db.collection('events').get()` 直接查 Firestore 完整集合，不再依賴快取
- **教訓**：任何「判斷資料是否有效」的邏輯，絕不可用有 limit 上限的前端快取作為唯一資料來源

### 2026-03-17 — [永久] _showPageStale 未等待 ensureForPage 導致動態函式呼叫崩潰
- **問題**：開啟個人頁面時報錯 `renderUserCard is not a function`
- **原因**：`_showPageStale()` 是同步函式，直接呼叫 `_activatePage()` → `_renderPageContent()`，未先 `await ScriptLoader.ensureForPage(pageId)` 載入動態腳本。`stale-first`/`stale-confirm` 策略的頁面（page-profile、page-activity-detail 等）會走此路徑
- **修復**：`_showPageStale` 改為 `async`，在 `_activatePage` 前加入 `ensureForPage`。呼叫端加 `await` 確保 `finally` 中的 `_endRouteLoading` 時序正確
- **教訓**：Phase 1 移除 eager script 後，不只要檢查 `_renderPageContent` 內的呼叫，還要檢查所有進入 `_renderPageContent` 的路徑是否都有 `ensureForPage` 前置。`_showPageStale` 是唯一沒有的路徑

### 2026-03-17 — 自動化測試擴充：新增 5 個測試套件 139 個測試（總計 511）
- **內容**：新增 tournament-core.test.js(42)、leaderboard-stats.test.js(30)、script-loader.test.js(22)、no-show-stats.test.js(30)、script-deps.test.js(15)
- **覆蓋範圍**：賽事狀態/模式/隊長判斷、活動紀錄三階段分類、ScriptLoader URL 正規化/群組去重、放鴿子統計含 nameToUid 歷史修正、跨模組依賴靜態驗證
- **script-deps.test.js 重點**：解析 index.html 與 script-loader.js，驗證 eager script 不會呼叫僅在 dynamic 群組定義的函式。偵測 `?.()` / `typeof` / truthiness guard。此測試能在部署前捕捉 Phase 1 類型的跨模組呼叫斷裂
- **教訓**：測試 _categorizeRecords 時需注意「取消後重新報名」的 seenCancel 清除邏輯，以及 waitlisted + 活動結束不算 missed 的業務規則

### 2026-03-17 — 效能優化 Phase 1：21 個 script 從 index.html 移至動態載入
- **內容**：將 21 個非首頁必需的 script 從 index.html 移除，改由 script-loader.js 按需載入。新增 `tournament`、`message` 兩個群組，`image-cropper.js` 加入 `profile` 群組。新增 `_pageGroups` 映射：page-tournaments、page-tournament-detail、page-messages
- **移除清單**：image-cropper / profile-avatar / profile-data / profile-data-render / profile-data-stats / profile-data-history / profile-card / profile-share / event-share-builders / event-share / team-share / tournament-detail / tournament-friendly-detail / tournament-friendly-detail-view / tournament-share / tournament-friendly-roster / tournament-friendly-notify / leaderboard / message-actions / message-actions-team / message-inbox
- **安全措施**：新增 `_openTournamentDetail()` 包裝函式（tournament-render.js），確保動態載入 tournament 群組後再呼叫 `showTournamentDetail`。所有非 tournament 群組內的呼叫端（首頁輪播、收藏清單、深連結、訊息操作）均改用此包裝或加入 `ScriptLoader.ensureForPage` 前置載入
- **教訓**：從 index.html 移除 script 時，必須檢查所有 onclick / 程式呼叫端是否假設函式已存在；若呼叫端在不同群組，需加入動態載入保護

### 2026-03-17 — 模組資料夾化（80+ 模組移入 12 個功能子資料夾）
- **內容**：將 js/modules/ 下 80+ 個扁平模組移入 12 個子資料夾：event/(27), team/(10), tournament/(12), profile/(9), message/(9), scan/(5), dashboard/(5), kickball/(6), ad-manage/(5), user-admin/(4), shot-game/(10), achievement/(10 既有)。保留 21 個獨立模組在扁平目錄
- **更新檔案**：script-loader.js（97 條路徑）、index.html（75 個 script tag）、game-lab.html（8 條路徑）、shot-game-page.js（5 條硬編碼路徑）
- **教訓**：shot-game-page.js 內有硬編碼的動態載入路徑（`_loadEngine()`），資料夾化時容易遺漏。其他模組都透過 Object.assign 掛載，不含路徑引用

### 2026-03-17 — JS 檔案拆分 Phase 3（6 大模組 + 整合既有拆分檔）
- **內容**：event-manage(2056→532)、event-create(2249→402)、team-form(1011→386)、tournament-manage(988→299)、event-detail(793→692)、tournament-render(557→155)、event-share(508→262)。新增 23 個拆分檔、刪除 team.js(1381行)
- **風險發現**：event-share-builders.js 僅在 script-loader 但 event-share.js 在 index.html 直接載入，已修復（加入 index.html）
- **評估不拆的檔案**：user-admin-roles(670)/exp(599)/list(537)、event-detail-signup(563)、tournament-render(557→已拆)、banner(414)、audit-log(409)、event-create(402→已拆) — 耦合緊密或已為拆分後殘餘
- **教訓**：拆分後必須檢查 index.html 直接載入 vs script-loader 動態載入的一致性，避免拆出的檔案未被載入

### 2026-03-17 — JS 檔案拆分 Phase 2（7 大模組拆分為 24 個檔案）
- **內容**：將 7 個超過 300 行的模組拆分至 300 行以下
  - event-list.js → event-list-helpers.js, event-list-stats.js, event-list-home.js, event-list-timeline.js
  - scan.js → scan-ui.js, scan-camera.js, scan-process.js, scan-family.js
  - team-detail.js → team-detail-render.js, team-detail-members.js
  - profile-data.js → profile-data-render.js, profile-data-stats.js, profile-data-history.js
  - profile-core.js → profile-form.js, profile-avatar.js
  - team-list.js → team-list-render.js
  - dashboard.js → dashboard-widgets.js
- **修復**：scan-process.js 超 300 行，手動提取 family checkin 至 scan-family.js
- **教訓**：Linter hook 會自動整理檔案，不要與之對抗；innerHTML 安全 hook 需在檔案頭加 escapeHTML 安全註解

### 2026-03-17 — Phase 2 自動化測試擴充（350 個新測試）
- **內容**：新增 3 個測試檔案，覆蓋 config 工具函式、成就系統、活動模組
  1. `tests/unit/config-utils.test.js`（87 tests）— escapeHTML、Permission System（7 函式）、Sport Config、Custom Role
  2. `tests/unit/achievement.test.js`（141 tests）— shared/evaluator/stats 三檔案，含 getParticipantAttendanceStats 深度測試（23 tests）
  3. `tests/unit/event-utils.test.js`（122 tests）— 性別限制（9 函式）、_buildEventPeopleSummaryByStatus、_getEventOccupancyState、Navigation
- **累計**：4 個測試檔案、378 個單元測試，全部通過
- **教訓**：Agent 執行 npm install 時可能汙染 package.json（加入 dependencies），需在 commit 前檢查還原

### 2026-03-17 — Phase 1 自動化測試建立
- **內容**：建立兩層自動化測試基礎
  1. `tests/unit/pure-functions.test.js`（28 個測試）— 從 Object.assign 模組中提取純函式邏輯進行測試：_rebuildOccupancy、_isEventDelegate、_isAnyActiveEventDelegate、_categorizeScanEvents
  2. `tests/firestore.rules.test.js` 擴充（+585 行）— 新增 attendanceRecords CRUD 權限、users 自更新安全邊界（3 條路徑）、rolePermissions 讀寫權限測試
  3. `package.json` 新增 `test:unit` script
- **教訓**：專案使用 Object.assign 模式無法直接 import，測試需複製純函式邏輯；修改原始函式時需同步更新對應測試

### 2026-03-17 — 用戶名片活動記錄徽章數量顯示錯誤
- **問題**：查看其他用戶的活動記錄時，徽章數量顯示的是管理員（當前登入者）自己的徽章數，而非該用戶實際獲得的徽章數
- **原因**：`renderUserCardRecords` 使用 `getCurrentBadgeCount()` 計算徽章數，此函式固定對當前登入者（`ApiService.getCurrentUser()`）評估成就，未考慮目標用戶
- **修復**：新增 `_updateUserCardBadgeCount(uid)` 方法：當前用戶 → 同步走 `getCurrentBadgeCount()`；其他用戶 → 異步從 per-user 子集合讀取成就進度再計算徽章數
- **教訓**：統計數據（出席率、場次）已正確使用目標 uid，但徽章數遺漏了。新增統計維度時必須確認資料來源是否對應正確用戶

### 2026-03-17 — [永久] 成就出席率徽章無法達成：evaluator 缺少 displayName → UID 對照
- **問題**：用戶個人檔案顯示 100% 出席率，但成就系統的「達到出席率」徽章無法達成
- **原因**：成就 evaluator 的 `buildAttendanceStateByEvent` 對 `attendanceRecords.uid` 做嚴格 UID 比對，但歷史資料中部分 attendance record 的 uid 存的是顯示名稱（非 LINE userId）。個人檔案統計走 `ensureUserStatsLoaded` → `getUserAttendanceRecords` 有 displayName fallback（先查 uid、查無再用 userName），所以能正確顯示 100%。但 evaluator 走 `getAttendanceRecords()`（全域快取、無 fallback），UID 不匹配 → 認為無簽到 → 出席率 0%
- **修復**：
  1. `buildAttendanceStateByEvent` 新增第三參數 `nameSet`：UID 不匹配時，檢查 record.uid 是否為目標用戶的已知 displayName
  2. `buildEvaluationContext` 改用 `getUserAttendanceRecords(uid)`（優先使用 user-specific cache，含 displayName fallback）作為 attendanceRecords 來源
  3. 傳入 `getUserNameSet(resolvedUser)` 作為 nameSet
- **教訓**：任何涉及 `attendanceRecords.uid` 比對的新邏輯，都必須加入 displayName → uid 解析（與 CLAUDE.md 統計系統保護規則第 5 條一致）

### 2026-03-17 — [永久] 權限管理 UI 重構為收折式分組 + _seedRoleData 自動補新權限碼
- **問題**：(1) 權限管理頁所有權限平鋪列出，缺乏入口/子權限的視覺層級；(2) `_seedRoleData()` 對已有自訂權限的角色完全跳過 seed，導致新增入口權限時既有角色不會自動獲得
- **修復**：
  - `renderPermissions()` 重寫為收折式分組：入口權限開關放在分類標題右側（header toggle），子權限收進可展開區塊
  - `_seedRoleData()` 新增 `else if (savedDefaults)` 分支：比對 savedDefaults 與 defaults 的差集，自動補入新增碼（只加不刪）
  - `ROLE_PERMISSION_CATALOG_VERSION` 升至 `20260317a` 以觸發 baseline 儲存
  - CSS 更新：`.perm-category` 加邊框、`.perm-cat-name` flex:1、`.no-sub` 隱藏箭頭
- **教訓**：新增入口權限後若不 bump catalog version，既有角色不會觸發 seed 邏輯；必須同步 bump 並確保 `defaultPermissions` baseline 已建立

### 2026-03-17 — [永久] admin 角色固有權限設計決策
- **決策**：admin 及以上角色的所有入口權限均由 super_admin 在權限管理 UI 自由啟閉，不放入 `INHERENT_ROLE_PERMISSIONS`
- **原因**：用戶明確要求「入口權限是由總管去權限管理來決定所有層級的權限與入口」
- **`INHERENT_ROLE_PERMISSIONS` 僅保留**：coach/captain/venue_owner 的 `activity.manage.entry` + `admin.tournaments.entry`（身分核心功能）
- **配套**：`_seedRoleData()` 自動補新權限碼機制確保既有角色不會因新增入口而掉功能

### 2026-03-17 — [永久] admin 角色固有權限不足導致自訂覆蓋後功能消失
- **問題**：admin 在權限管理頁存過自訂權限後，大量入口權限消失（賽事、用戶、廣告、俱樂部等）
- **原因**：`INHERENT_ROLE_PERMISSIONS` 只列了 2 個權限，但 admin 應有 12 個入口權限。`getRolePermissions()` 在有自訂權限時完全覆蓋預設，只有固有權限不受影響
- **修復**：admin 固有權限擴充為全部入口權限（9 個 .entry + team.create + team.manage_all + event.edit_all）。子權限（.edit_profile 等）保持可配置
- **教訓**：`INHERENT_ROLE_PERMISSIONS` 是自訂權限覆蓋的最後防線；新增入口權限時若 minRole <= admin，必須同步加入此處

### 2026-03-16 — 頁籤滑動改為跟手滑動 + 滑出滑入動畫
- **問題**：`_bindSwipeTabs` 為二元切換，手勢結束才切換，無視覺回饋
- **修復**：重寫 `app.js:_bindSwipeTabs`，touchmove 時 `translateX` 跟手、邊界阻尼、滑出/滑入動畫（~450ms），`passive:false` 防滑動衝突，`transitionend` 有 350ms fallback
- **影響範圍**：活動列表（2 tabs）、活動管理（6 tabs）、新聞（動態 tabs）三處呼叫端零修改
- **教訓**：`transitionend` 在 LINE WebView 偶爾不觸發，必須加 fallback timer

### 2026-03-16 — 抽屜選單用戶補正管理位置與顏色調整
- **問題**：「用戶補正管理」在抽屜最底部且無紅底色標示
- **修復**：移至「日誌中心」與「無效資料查詢」之間；加 `highlight: 'red'` 強制紅底
- **教訓**：紅底 = 高階功能視覺提示、藍底 = 中階、無色 = 低階，僅視覺區分與權限無關

### 2026-03-16 — [永久] 系統資料同步功能
- **需求**：將「成就批次更新」頁籤擴大為「系統資料同步」，包含 4 項操作
- **操作項目**：
  1. **成就進度 + 報名徽章**（原有）：重算成就進度 → `users/{uid}/achievements` + `registrations.displayBadges`
  2. **俱樂部成員數重算**（新增）：從 `users.teamId` 動態計算 → `teams.members`
  3. **用戶俱樂部欄位驗證**（新增）：移除指向已刪除俱樂部的 `teamId/teamIds` 引用
  4. **孤兒記錄清理**（新增）：刪除指向不存在活動的 `registrations/activityRecords/attendanceRecords`
- **費用預估**：每個操作的確認彈窗會顯示預估讀寫次數與 USD 費用（Firestore Blaze 計價）
- **權限**：`admin.repair.data_sync`（原 `admin.repair.achievement_batch`），頁面 minRole 從 `super_admin` 降為 `admin`
- **備註**：放鴿子次數（noShow）不需加入同步 — 此數據僅供 coach 以上層級管理員參考，一般用戶看不到；且 corrections 在管理端已正確套用
- **教訓**：`teams.members` 是高風險過期欄位，只有瀏覽俱樂部頁才會重算寫回；`users.teamId` 在俱樂部被刪除時不會自動清除

### 2026-03-16 — 身份成就 + 手動授予成就
- **需求**：新增 4 種身份判定動作類型（教練/領隊/場主/管理員）+ 1 種手動授予動作類型
- **設計**：
  - **身份成就**：`role_coach`、`role_captain`、`role_venue_owner`、`role_admin`，共用 `role_check` handler，以 `ROLE_LEVEL_MAP` 做階層判定（高階角色自動滿足低階條件），`fixedThreshold: 1`
  - **手動授予**：`manual_award`，evaluator handler 直接回傳既有 `current` 值（不自動評估），管理員透過後台「授予」按鈕開啟面板，模糊搜尋用戶後直接寫入 `users/{uid}/achievements/{achId}`
- **修改位置**：`config.js` 加 5 筆 actions、`registry.js` 加 5 筆 actionMetaMap、`evaluator.js` 加 `role_check` + `manual_award` handler、`admin.js` 加 `openManualAwardPanel` + 授予/撤銷 UI、`achievement.js` 加 facade
- **教訓**：手動授予繞過 evaluator 自動計算，直接寫 Firestore 子集合，因此批次更新時 `manual_award` handler 會保留既有 `current` 值不覆蓋

### 2026-03-16 — [永久] 成就鎖定/解鎖功能
- **需求**：管理員可控制每個成就是否為「達成即永久」或「條件消失即撤銷」
- **設計**：成就文件新增 `locked` 欄位（預設 `true`，向下相容）
  - **鎖定（locked: true）**：`completedAt` 一旦設定就永久保留，即使 `current < threshold` 也不清除
  - **解鎖（locked: false）**：`current < threshold` 時 `completedAt` 會被設為 `null`，成就被撤銷
- **修改位置**：`evaluator.js:776` 加入 `isLocked` 判斷；`admin.js` 加入鎖頭圖示按鈕 + `toggleAchievementLock`；`achievement.js` 加入 facade
- **教訓**：`locked` 預設為 `true` 是關鍵決策——所有既有成就自動向下相容為永久型，不會因為升級而意外撤銷用戶的成就

### 2026-03-16 — 成就批次更新功能（用戶補正管理第三頁籤）
- **需求**：用戶徽章在活動頁可見但在個人名片不可見，因為 `users/{uid}/achievements` 子集合只有用戶本人觸發才寫入
- **實作**：
  - 在用戶補正管理頁新增第三個頁籤「成就批次更新」
  - 新增 `js/modules/achievement-batch.js`（~200 行），逐一為每位用戶查 Firestore 完整資料、暫時替換快取、呼叫 evaluator、還原快取
  - 寫入 `users/{uid}/achievements/{achId}` + 更新 `registrations.displayBadges`（diff 比對無變動跳過）
  - Firestore rules 放寬 achievements 子集合寫入：`isOwner(userId) || isAdmin()`
  - 新增權限碼 `admin.repair.achievement_batch`
- **修改檔案**：`firestore.rules`、`pages/admin-system.html`、`js/modules/user-admin-corrections.js`、`js/modules/achievement-batch.js`（新增）、`js/core/script-loader.js`、`js/config.js`、`index.html`
- **教訓**：快取替換必須在 try/finally 中還原，evaluator 是同步的所以循序處理時不會有併發問題

### 2026-03-16 — [永久] 非管理員用戶看不到活動詳情頁徽章
- **問題**：一般用戶（非 admin）進入活動詳情頁，參加者名單上看不到任何徽章
- **原因**：`_refreshRegistrationBadges` 使用 `ApiService.getRegistrationsByEvent()` 讀取本地快取，但非管理員的 Firestore listener 只查自己的報名（`where('userId', '==', uid)`），本地快取不含其他參加者的報名資料
- **修復**：
  - `_refreshRegistrationBadges` 改為直接查 Firestore `db.collection('registrations').where('eventId', '==', eventId).get()`（Firestore rules 允許 `isAuth()` 讀取）
  - 從查詢結果的 `displayBadges` 欄位建立 `badgeMap`，同時以 `userId` 和 `userName` 做 key
  - `_buildConfirmedParticipantSummary` 的 fallback 路徑（`e.participants` 字串陣列）改從 `_eventBadgeCache` 讀取 `displayBadges`
  - 管理員仍保留即時計算+寫入 Firestore 的完整流程
- **教訓**：非管理員的 registrations 本地快取只含自己的資料，任何需要讀取「其他用戶報名資料」的功能都必須直接查 Firestore

### 2026-03-16 — 成就系統新增 11 種動作類型
- **需求**：擴充成就系統，新增可立即使用現有資料的動作類型
- **新增動作**：`organize_event`（啟用）、`diverse_sports`、`no_show_free`、`create_team`、`bring_companion`、`team_member_count`、`early_event`、`night_event`、`shop_trade`、`game_play`、`game_high_score`
- **修改檔案**：`config.js`（ACHIEVEMENT_CONDITIONS）、`registry.js`（actionMetaMap）、`evaluator.js`（actionHandlers）
- **注意**：`shop_trade`、`game_play`、`game_high_score` 依賴 trades/leaderboard 集合資料，尚無交易功能時這些成就自然不會觸發

### 2026-03-16 — 修復活動詳情頁徽章展示未生效 + 手勢補全
- **問題**：`_refreshRegistrationBadges` 使用 `getEvaluatedAchievementsForUserAsync` 為其他用戶讀取 per-user 子集合，但大部分用戶無子集合資料，導致成就全部判定為未完成、徽章永遠為空；觸控手勢缺少 `touchcancel` 處理
- **原因**：`badges.js` 的 `getEvaluatedAchievementsForUserAsync` 對非當前用戶僅讀子集合（不即時計算），子集合空時回傳模板 `current:0`
- **修復**：
  - `event-manage.js`: `_refreshRegistrationBadges` 改用 `evaluator.getEvaluatedAchievements({ targetUid })` 即時計算任何用戶成就
  - 新增防護：空結果不覆蓋已有 `displayBadges`（避免資料未載入時誤清）
  - `_bindBadgeRowSnapBack` 新增 `touchcancel` 事件支援
  - `event-detail.js`: 呼叫加 `.catch(() => {})` 防止未處理 rejection
- **教訓**：`getEvaluatedAchievementsForUserAsync` 只適用於讀取已存在的 per-user 資料；需要即時計算其他用戶成就時，應使用 evaluator 的 `getEvaluatedAchievements`

### 2026-03-16 — 報名名單顯示用戶徽章
- **問題**：活動詳情頁報名名單需展示用戶擁有的徽章縮圖
- **修復**：
  - `firebase-crud.js`: 報名成功後背景寫入 `displayBadges` 到 registration 文件（transaction 外）
  - `event-manage.js`: `_buildConfirmedParticipantSummary` 傳遞 `displayBadges`；`_renderAttendanceTable` 名字旁顯示徽章；新增 `_refreshRegistrationBadges` 背景更新 + `_bindBadgeRowSnapBack` 滑動彈回
  - `event-detail.js`: 開詳情頁時觸發背景徽章更新
  - `css/activity.css`: 新增 `.reg-name-badges` 橫向滾動 + `.reg-badge-icon` 樣式
- **教訓**：徽章寫入必須在報名 transaction 外，避免影響報名核心邏輯；背景更新用 30 分鐘間隔避免重複查詢

### 2026-03-16 — 首頁每日體育新聞功能
- **問題**：用戶希望在首頁新增每日體育新聞區塊
- **修復**：
  - `functions/index.js`: 新增 `fetchSportsNews` scheduled function（每 6 小時從 NewsData.io 抓取中文體育新聞）
  - `js/firebase-service.js`: 新增 `newsArticles` 快取 + `_buildCollectionQuery` 排序
  - `js/api-service.js`: 新增 `getNewsArticles()` 方法
  - `js/modules/news.js`: **新建** — 新聞卡片直瀑式渲染模組，含體育分類頁籤篩選
  - `pages/home.html`: 贊助商下方新增新聞區塊 HTML（置中標題 + 方形頁籤）
  - `css/home.css`: 新聞卡片 + 方形頁籤 + 置中標題樣式
  - `app.js`: `renderHomeDeferred()` 加入 `renderNews()` + deep link `?news=` 參數
  - `firestore.rules`: 新增 `newsArticles` 集合規則（公開可讀、僅 CF 可寫）
- **教訓**：新聞來源 API 需設定 Secret（`firebase functions:secrets:set NEWS_API_KEY`）；頁籤使用 `EVENT_SPORT_OPTIONS` 動態生成

### 2026-03-16 — 外部活動連結功能
- **問題**：用戶希望在行事曆與首頁顯示外部平台活動，點擊後直接跳轉到外部連結
- **修復**：
  - `config.js`: TYPE_CONFIG / GRADIENT_MAP 新增 `external` 類型
  - `css/activity.css` / `css/home.css`: 新增外部活動樣式（灰色系）
  - `pages/activity.html`: 新增 `create-external-event-modal` + 篩選下拉選項
  - `event-create.js`: `openCreateEventModal()` 改為先彈 Action Sheet 選擇自訂/外部，新增 `openCreateExternalEventModal()` + `handleCreateExternalEvent()`
  - `event-list.js`: renderHotEvents / renderActivityList 為外部活動顯示不同 meta（無人數），點擊跳轉 externalUrl
  - `event-manage.js`: renderMyActivities 為外部活動顯示不同按鈕，新增 `editExternalActivity()`
  - `event-detail.js`: showEventDetail 攔截 external type 直接跳轉
- **教訓**：外部活動 `max:0, current:0` 會觸發 `current >= max` → full 的判斷，需額外排除

---

### [永久] 2026-03-16 — Per-User Achievement Progress 遷移（Phase 1+2）
- **問題**：`achievements` 集合是全域共用文件，任何用戶觸發 `evaluateAchievements()` 都會把 `current/completedAt` 寫回全域文件，導致所有人都顯示「已獲得」
- **原因**：成就進度存在全域 `achievements` 集合而非每用戶獨立存儲
- **修復**：
  - 新增 `users/{uid}/achievements/{achId}` 子集合儲存每用戶進度
  - `firebase-crud.js` 新增 `saveUserAchievementProgress()` / `loadUserAchievementProgress()`
  - `evaluator.js` 的 `evaluateAchievements()` 改為雙寫（全域 + per-user 子集合），安全防線確保只寫自己的子集合
  - `evaluator.js` 的 `getEvaluatedAchievements()` 優先讀取 per-user 已完成記錄，fallback 到即時計算
  - `firebase-service.js` 新增 `_loadCurrentUserAchievementProgress()` 非阻塞載入 + `getUserAchievementProgressMap()` 查詢介面
  - `firestore.rules` 新增子集合規則：任何登入用戶可讀，僅 owner 可寫
- **教訓**：
  - 全域 `achievements` 集合保留為模板（管理員 CRUD 不動），進度存子集合
  - 三道防火牆：①雙寫保留全域 ②fallback 即時計算 ③安全規則 `auth.uid == uid`
  - Phase 3：badges.js 新增 `getEvaluatedAchievementsForUserAsync()`，profile.js 新增 `buildEarnedBadgeListHtmlAsync()`，profile-core.js 修正其他用戶顯示自己徽章的 bug（傳遞 targetUser + 異步更新）
  - Phase 4：移除 evaluator.js 全域 `ApiService.updateAchievement()` 寫入，移除 `_seedAchievements` 汙染清除邏輯

### 2026-03-16 — 取消報名翻牌動畫 0% 成功率修復
- **問題**：報名後翻牌成功率高，但取消報名後翻牌成功率為 0%
- **原因**：`_flipAnimating = true` 設在 `cancelRegistration()` 之後，但 Firestore `onSnapshot` 在 await 期間觸發 `showEventDetail()` 重渲染 DOM，導致翻牌操作的目標 DOM 已被替換（detached elements）
- **修復**：
  - `_flipAnimating = true` 移到 Firestore 操作之前（loading setup 階段）
  - `_restoreCancelUI()` 中加入 `this._flipAnimating = false` 確保錯誤路徑也清除
  - catch / finally 區塊都加入 `this._flipAnimating = false`
- **教訓**：[永久] onSnapshot 會在任何 await 期間觸發重渲染，所有需要保護 DOM 的標誌必須在 Firestore 操作之前設定，且所有退出路徑都必須清除標誌

### 2026-03-16 — 報名/取消速度優化 + 翻牌特效修復
- **問題**：報名與取消報名流程冗長，有時卡在「取消處理中，請稍後」；翻牌特效不生效
- **原因**：
  1. `_ensureAuth()` 每次都 `getIdToken(true)` 強制刷新 token — 多一次網路往返
  2. `_syncMyEventRegistrations` 在確認對話框之前就發 Firestore query — 用戶按「否」也白等
  3. `_cancelSignupBusyMap` 無超時保護，Firestore 卡住時永久鎖定
  4. CSS 翻轉缺少 `transform-style: preserve-3d`，按鈕原有 `z-index` 干擾 3D 渲染
- **修復**：
  - `_ensureAuth`: `getIdToken(false)` 優先用快取 token，過期才強制刷新
  - `handleCancelSignup`: `_syncMyEventRegistrations` 移到 `appConfirm()` 之後
  - 新增 15 秒安全超時自動解鎖 `_cancelSignupBusyMap`
  - 取消成功 `showEventDetail` 移除不必要的 `await`
  - CSS: 加 `transform-style: preserve-3d`、移除按鈕 `z-index`、翻轉時隱藏光跡元素
- **教訓**：`getIdToken(true)` 是昂貴操作，正常寫入不需要強制刷新；busy lock 必須有超時保護

### 2026-03-16 — 修復三項 Bug（_evaluateAchievements / feeEnabled / 翻牌動畫）
- **問題 1**：`_evaluateAchievements is not a function` — 報名/取消報名時瀏覽器報錯
- **原因**：`achievement.js` 是 lazy-loaded 模組，僅在 achievement/profile 頁面載入，活動詳情頁未載入
- **修復**：`event-detail-signup.js` 中 4 處 `this._evaluateAchievements()` 改為 `this._evaluateAchievements?.()`（optional chaining）
- **問題 2**：`feeEnabled is not defined` — 點擊活動管理查看名單報錯
- **原因**：費用摘要重構時移除了 `feeEnabled` / `fee` 變數宣告，但 `metaParts` 仍引用
- **修復**：在 `event-manage.js` 的 `showMyActivityDetail()` 中補回 `feeEnabled` 和 `fee` 變數宣告
- **問題 3**：報名成功後缺少翻牌特效
- **修復**：CSS 加入 `.signup-flip-back` / `.flipped` 3D 翻轉樣式，JS 在報名/取消成功後動態注入背面元素並觸發翻牌動畫（700ms），完成後再刷新頁面
- **教訓**：重構時移除程式碼區塊前，必須全文搜尋被移除變數的所有引用點；lazy-loaded 模組的方法呼叫必須用 optional chaining

### 2026-03-16 — 報名/簽到速度優化（Strategy C）
- **問題**：按下「立即報名」、「取消報名」或掃碼簽到後，需等待 Firestore 寫入完成才有 UI 回饋，體感延遲明顯
- **修復**：
  - `event-detail.js`：進入活動詳情頁時 fire-and-forget 呼叫 `ensureAuthReadyForWrite()` 預熱 auth
  - `event-detail-signup.js`：`handleSignup()` / `handleCancelSignup()` 成功後立即 toast + 刷新頁面，通知/成就/audit 移至背景
  - `event-detail-companion.js`：`_confirmCompanionRegister()` 同上模式
  - `scan.js`：`_processAttendance()` / `_confirmFamilyCheckin()` 改用 Optimistic UI，`addAttendanceRecord` 同步推入快取後不 await Firestore，UI 即時刷新，錯誤在背景以 toast 通知
- **教訓**：報名核心 transaction（registerForEvent / cancelRegistration）必須 await 確保資料一致性，但後續的 activityRecords、audit log、通知、成就評估等 post-ops 可以 fire-and-forget；簽到紀錄的 `addAttendanceRecord` 已內建 cache-first + rollback 機制，適合 optimistic UI

### 2026-03-16 — 修復 LINE 瀏覽器底部導航列按鈕跑位
- **問題**：LINE 內建瀏覽器開啟時，底部頁籤的按鈕位置偏高
- **原因**：`#bottom-tabs` 使用 `border-box`（全域 reset），`height: 64px` 包含 `padding-bottom: env(safe-area-inset-bottom)`，導致按鈕內容區被壓縮，`align-items: center` 讓按鈕在更小的空間內置中而偏高
- **修復**：`#bottom-tabs` 加上 `box-sizing: content-box`，讓 64px 永遠是內容區高度，safe-area padding 只延伸背景不影響按鈕佈局；同步更新 `body` 的 `padding-bottom` 加入 safe-area
- **教訓**：`position: fixed` 元素若同時使用 `env(safe-area-inset-*)` padding，需注意 `box-sizing` 對內容區的影響，尤其在 LINE WebView 等回報不同 safe-area 值的環境

### 2026-03-16 — 分享底部選單新增「分享到 LINE 社群」（line.me/R/share）
- **問題**：shareTargetPicker 不支援 LINE 社群（OpenChat），用戶只能手動複製連結貼上
- **修復**：
  - `event-share.js`：新增 `_openLineRShare(altText)` 共用 helper，底部選單新增 `line-share` 選項
  - `_showShareActionSheet`：canPicker 時顯示 3 按鈕（Flex / LINE 社群 / 複製）；否則 2 按鈕（LINE / 複製）
  - 4 個 share 模組全部新增 `line-share` choice handler
  - CSS 新增 `.share-action-sheet-btn-inner` / `.share-action-sheet-btn-sub` 按鈕副標題樣式
- **教訓**：`line.me/R/share` 可在任何瀏覽器開啟 LINE 原生分享（含社群），但只能發純文字

### 2026-03-15 — 全站分享升級：俱樂部/賽事/名片改用 LIFF URL + Flex Message
- **問題**：俱樂部邀請、賽事分享、個人名片分享使用直連 URL（`toosterx.com`），不會強制在 LINE 內建瀏覽器開啟，且沒有 Flex Message 卡片
- **修復**：
  - 新建 `team-share.js`、`tournament-share.js`、`profile-share.js`，比照 `event-share.js` 模式（LIFF URL + Flex Message + shareTargetPicker + 底部選單 + fallback）
  - `team-detail.js` / `team.js`：`_getTeamInviteShareUrl` 改為 LIFF URL、QR Code 編碼 LIFF URL
  - `tournament-friendly-detail-view.js`：移除舊 `shareTournament`，由新模組覆蓋
  - `app.js`：新增 `?tournament=` / `?profile=` deep link 路由
  - `line-auth.js`：login redirectUri 保留 tournament/profile 參數
  - `functions/index.js`：teamShareOg redirect 改為 LIFF URL
  - `event-share.js`：`_showShareActionSheet` 支援自訂標題
- **教訓**：所有面向用戶的分享 URL 應一律使用 LIFF URL，確保 LINE 內建瀏覽器開啟

---

### 2026-03-15 — 建立/編輯活動後列表未刷新
- **問題**：建立活動成功後，活動管理列表未顯示新建的活動，需切頁籤或刷新才能看到
- **原因**：`renderActivityList()`、`renderHotEvents()`、`renderMyActivities()` 三個渲染呼叫放在非關鍵操作的 try-catch 區塊內（與 localStorage 儲存、opLog 寫入、autoExp 發放同一個 try），若前面任一操作拋出例外，渲染呼叫就會被跳過
- **修復**：`event-create.js` — 將三個渲染呼叫移到 try-catch 區塊外，各自獨立 try-catch，確保無論記錄操作是否失敗都能刷新列表（建立路徑 + 編輯路徑都修復）
- **教訓**：渲染呼叫屬於用戶可見的即時回饋，不應與可容錯的背景操作共用同一個 try-catch

---

### 2026-03-15 — Tier 2 Login：LIFF 過期時以 Firebase Auth + 快取維持登入
- **問題**：用戶每天被登出，因為登入判斷完全依賴 LIFF session，而外部瀏覽器的 LIFF session 隔天就會失效
- **原因**：`isLoggedIn()` 只檢查 `this._profile !== null`，LIFF 過期後 profile 無法獲取，即使 Firebase Auth（IndexedDB persistence，refresh token ~1 年）仍然有效
- **修復**：
  - `line-auth.js`：profile 快取 TTL 從 6 小時延長至 30 天；新增 `_firebaseSessionAlive()`、`_matchesFirebaseUid()` 輔助方法；`isLoggedIn()` 新增 Tier 2 fallback（Firebase Auth + 快取 profile）；`restoreCachedProfile()` 加入 UID 交叉驗證防換帳號；新增 `_scheduleProfileRefresh()` 背景刷新
  - `app.js`：`ensureCloudReady` LIFF init 區塊增加 Tier 2 快取恢復；profile fetch 區塊增加 Tier 2 UID 驗證與背景刷新排程
  - `profile-core.js`：`bindLineLogin` 的 `loginUser` 失敗時增加 Tier 2 降級處理（Firebase Auth 仍有效則不顯示錯誤）
- **教訓**：Firebase Auth 的 IndexedDB persistence（LOCAL）遠比 LIFF session 長壽，應作為 fallback 信任層

---

### 2026-03-15 — 開球遊戲反作弊 + 排行影子即時更新
- **問題**：(1) Cloud Function `submitKickGameScore` 對極端數值僅 console.warn 不拒絕，前端可篡改成績；(2) 提交成績後場地上月排行前10名影子不會更新
- **原因**：(1) flags 偵測後缺少 throw 拒絕邏輯；(2) `loadTop3Markers` 與 `_submitScore` 不同 scope，提交後未觸發重新載入
- **修復**：(1) `functions/index.js` flags 改為 throw HttpsError 拒絕，閾值收緊(距離>150/球速>250/低速遠距交叉驗證)；(2) `_createGame` return 暴露 `refreshMarkers`，`_submitScore` finally 中呼叫
- **教訓**：遊戲成績類 Cloud Function 必須有 reject 邏輯，不能只記 log；跨 scope 通訊要透過返回物件暴露方法

---

## [永久] UID / 資料完整性地雷

### attendanceRecords uid 欄位存顯示名稱而非 LINE userId
- **問題**：`attendanceRecords.uid` 欄位部分記錄存的是用戶顯示名稱（如「呂維哲」）而非 LINE userId（如 `U196b...`），導致統計交叉比對全部失敗
- **原因**：`_confirmAllAttendance` 在找不到 `registrations` 時，從 `event.participants` 取得顯示名稱直接作為 `uid` 寫入
- **影響**：完成場次=0、放鴿子誤判、出席率歸零。24 人中 21 人受影響
- **修復**：`firebase-service.js` 的 `ensureUserStatsLoaded` 新增 userName fallback 查詢；`event-manage.js` 的放鴿子函式加入 `nameToUid` 對照表
- **教訓**：`event.participants` 存的是顯示名稱，絕不能直接作為 uid。所有涉及 `attendanceRecords.uid` 交叉比對的邏輯都必須包含 displayName → uid 解析

### 手動簽到 UID 不匹配導致已簽到紀錄被批量誤刪（2026-03-14）
- **問題**：delegate user 點「完成簽到」後，已完成簽到簽退的紀錄被軟刪除（status='removed'）
- **原因**：渲染用顯示名稱作為 UID，儲存時解析為真實 UID，導致 checkbox ID 不吻合；`_normalizeAttendanceSelection(undefined)` 回傳 `{checkin:false, checkout:false}` 觸發刪除
- **教訓**：save loop 必須有「使用者有意操作」的證據（checkbox 實際存在且被讀取過），不能用 fallback 預設值推導刪除意圖

### 用戶 ID 欄位命名規範
- 各集合欄位對照：`users` → `uid`/`lineUserId`、`registrations` → `userId`、`attendanceRecords` → `uid`、`activityRecords` → `uid`、`events` → `creatorUid`、`expLogs` → `uid`
- 新增 Firestore 文件寫入必須包含 `uid` 欄位（LINE userId），禁止只存顯示名稱

### UID 不一致登入修補（2026-02-28）
- LINE/Firebase UID 與 users docId 不一致時，前端會出現 permission-denied 與 WebChannel 400/404
- 修復：偵測 UID mismatch 時強制重新登入/刷新 token，允許 legacy users docId 遷移到 canonical uid doc

---

## [永久] 報名系統核心架構

### 報名/取消操作用快取重建計數導致 event.current 被覆蓋（2026-03-13）
- **問題**：活動管理頁顯示 1/20 人，活動頁顯示 21/20 人
- **原因**：transaction 內使用本地快取 `this._cache.registrations` 重建 occupancy，快取不完整時會覆蓋正確值
- **修復**：改為在 transaction 前從 Firestore 查詢該活動所有 registrations
- **教訓**：transaction 內的「從零重建」操作，資料來源必須是 Firestore 而非本地快取

### 統一佔位重建 `_rebuildOccupancy`（2026-03-13）
- 所有 `event.current`/`event.waitlist` 變更必須透過 `_rebuildOccupancy()` 統一重建
- 禁止手動 `current++/--`，禁止使用本地快取作為計數來源
- 報名寫入必須使用 `db.runTransaction()` 或 `db.batch()`

### 反覆報名導致不在名單但紀錄顯示成功（2026-03-14）
- **原因**：registrations 查詢在 transaction 外面，重試時用舊資料
- **教訓**：Firestore transaction 重試時外部查詢不會自動刷新，必須放到 callback 內

---

## [永久] 資料來源與同步規則

### registrations 是唯一權威資料來源
- `activityRecords` 是衍生資料，status 欄位不可靠（取消後可能仍為 'registered'）
- 放鴿子計算、報名狀態判定、人數統計必須以 `registrations` 為準
- `activityRecords` 的五個根因：無 onSnapshot、limit(500) 截斷、fire-and-forget .add() 可能失敗、單向不一致修復、記憶體 push 不去重

### 用戶統計數據因 limit(500) 截斷（2026-03-15）
- 全域 `limit(500)` 查詢不適合用戶級統計
- 修復：`ensureUserStatsLoaded(uid)` 使用 `where('uid','==',uid)` 無 limit 查詢
- user-specific 快取的載入點必須覆蓋所有使用場景（含查看他人卡片）

### 個人數據頁完成場次永遠顯示 0（2026-03-15）
- `activityRecords.status` 永遠不會是 'completed'，`user.completedGames` 從未被更新
- 完成判定必須交叉比對 attendanceRecords（checkin + checkout）
- 統計邏輯統一使用 `_calcScanStats()`

### _calcScanStats 排除已取消報名（2026-03-15）
- `activityRecords.status` 取消後可能未更新，需用 `registrations`（權威）交叉比對建立 `cancelledRegEventIds` 集合
- 取消後又重新報名的不排除

### 取消報名後 activityRecords 未同步（2026-03-14）
- 快取可能未載入 activityRecords，Firestore 中的 activityRecord 不會被更新
- 修復：快取更新後加 Firestore 直查兜底

### 孤兒資料：deleteEvent 需級聯刪除（2026-03-13）
- 刪活動後必須級聯清理 registrations / activityRecords / attendanceRecords
- 手動簽到舊格式 participants 是顯示名稱，需用 `_findUserByName()` 解析真實 UID

---

## [永久] 權限 / Auth 模式

### client SDK 直寫受限欄位會造成樂觀更新與實際不一致
- EXP 系統（2026-03-14）：`users.exp` 只允許 `isSuperAdmin()` 修改，admin/coach 調整 EXP 時本地成功但 Firestore 靜默失敗
- 角色晉升（2026-03-14）：`users.role` 同樣受限
- **統一解法**：涉及權限敏感欄位的寫入一律走 Cloud Function + Admin SDK

### 取消報名 insufficient permissions（2026-03-14）
- `_ensureAuth()` 回傳值必須檢查，LINE Access Token 失效時 Firebase Auth 建立失敗
- 所有 Firestore 寫入函式的 auth 驗證必須檢查回傳值並在失敗時提前丟出錯誤

### admin token 過期但 users doc 已升權（2026-03-12）
- `authRole()` 優先讀 `request.auth.token.role`，token 未刷新時與 users doc 不一致
- 修復：authenticated request 一律優先讀 `users/{uid}.role`，找不到才 fallback token role

### 權限治理三層同步
- UI 按鈕檢查、Firestore Rules、Cloud Functions 必須同步改
- 只改 Rules 不改前端等於沒改；只改前端不改 Rules 會靜默失敗
- 每次新增 `hasPerm()` 規則時，必須同時確認前端有對應 toggle

### 權限管理預設值隔夜失效（2026-03-12）
- `defaultPermissions` 與 `permissions` 必須嚴格分流
- 初始化補遷移只能補缺，不能在看不出使用者意圖時重寫現有權限
- 儲存時同步寫入 `catalogVersion` 避免隔次啟動再觸發錯誤遷移

### 收緊使用者欄位寫入邊界（2026-03-09）
- `lastLogin`/`updatedAt` 時間驗證改為 `request.time`
- 俱樂部欄位需有縮減/清空規則，不能與一般個人資料共用寬鬆白名單

---

## [永久] Firestore Rules 模式

### Firestore 規則不是查詢後過濾器
- 只要 collection 監聽可能包含不可讀文件，listen 階段就會直接 400
- 前端必須先縮成規則可證明合法的查詢
- **registrations**：一般用戶只監聽自己的報名，admin 保留全量（2026-03-10）
- **messages**：依用戶身分拆成多條合法查詢再合併去重（2026-03-09）

### 一般用戶報名 Missing or insufficient permissions（2026-03-13）
- `registrations` 讀取規則若為 owner-only，但 `registerForEvent` 查詢包含他人報名，整個查詢被拒
- 報名紀錄不含敏感資料，改為 `isAuth()` 可讀

### 候補遞補是跨用戶操作（2026-03-13）
- 取消報名時同一 batch 更新他人 registration（waitlisted→confirmed），需額外 rules 規則
- batch 中每筆寫入都必須符合 rules

### Firestore rules 盤點（2026-02-28）
- rules 修補以「最小破壞」優先，先封鎖跨人破壞與濫用入口
- 測試框架：repo root 安裝 `@firebase/rules-unit-testing`，emulator 內穩定重現

---

## [永久] 啟動 / 快取 / 性能架構

### 冷啟動分層啟動（2026-03-04）
- boot collections + events + teams 不等 Auth 直接啟動
- Auth 完成後背景啟動 auth-dependent listeners（messages/users/rolePermissions）
- Auth-dependent listeners 必須有 `auth.currentUser` 守門

### 分層啟動引入的寫入競態（2026-03-04）
- `_initialized = true` 早於 Auth 完成，寫入時 `auth.currentUser` 可能未就緒
- 統一使用 `ensureAuthReadyForWrite()` 守衛所有寫入操作

### 首頁性能瘦身 V2 架構（2026-03-06）
- PAGE_STRATEGY 四種策略：stale-first / stale-confirm / prepare-first / fresh-first
- showPage() 改為 await page/script/data ready 再切頁
- ScriptLoader 具備「識別既有 eager 資產」能力，避免雙載
- 移除 eager script 前必須分析 cross-module 依賴，shared helpers 必須留在 eager 或先提取

### stale-first 策略注意事項（2026-03-14）
- 需同時檢查所有攔截層（requireLogin + showPage.authPending + canUseStaleNavigation）
- 非 guarded 頁面的公開內容不應被 auth 初始化狀態阻擋

### seed 類初始化競態（2026-03-05）
- `_seedAdSlots()` 的 `set({merge:true})` 會用預設空值覆蓋既有資料
- seed 必須是「只補缺」而非「覆蓋預設」
- 排程型寫入（如自動下架）應限制在可寫角色

### 首頁啟動並發控制
- boot collections 序列化載入，降低啟動期 Firestore targets 數量
- 移除 `orderBy(documentId())` 不必要排序
- events 預載完成後再逐一載入其他集合

---

## [永久] Deep Link / 登入 / 外部瀏覽器

### deep link + auth redirect + SPA 三者交會（2026-03-14）
- 必須注意資料就緒時序、並發呼叫互斥、ID 格式一致性（data ID vs doc ID）
- `_tryOpenPendingDeepLink` 需等 events 載入；REST fallback 需用 structuredQuery
- LIFF login redirect 不保留 URL query params，跨 redirect 狀態必須存 sessionStorage

### 外部瀏覽器 LINE 登入 fallback（2026-03-14）
- `liff.getProfile()` 在外部瀏覽器非 100% 可靠
- 需有直接 API 呼叫 `api.line.me/v2/profile` 作為中間 fallback
- 登入失敗時應優先嘗試自動恢復，而非只顯示 toast

---

## [永久] 通用開發模式

### async 函式中使用 try/catch/finally 而非 .then()/.catch()/.finally()
- fire-and-forget 的 showEventDetail 會造成 UI 時序問題（2026-03-14）
- cancel UI restore 只在 catch 失敗時執行；busy map 清除移到 finally

### Firestore 操作不應靜默回傳 false
- 應統一用 throw 讓呼叫端正確判斷成功/失敗（2026-03-14）

### 操作日誌/通知 idempotent 設計
- 使用固定文件 ID + `set({merge:true})`，不依賴 `.add()` 自動 ID（2026-03-10）
- 通知系統站內信與 LINE 推播共用同一個去重鍵

### SPA 中注入的 DOM 元素會被 innerHTML 重建摧毀
- 載入狀態必須獨立於 DOM 追蹤，用 eventId 而非特定 DOM 元素（2026-03-14）

### 跨瀏覽器相容性
- iOS Safari 需 `-webkit-` 前綴（backdrop-filter）
- `100dvh` 需 `100vh` fallback
- `replaceAll` 不可用，改 `replace(/…/g)`
- `navigator.clipboard` 需 `execCommand` 降級
- LINE WebView API 支援度有限需完整降級鏈

### 表單預設值一致性
- 不能只改單一 input，還要一起檢查初始化、回填、toggle 補值與 reset 流程

---

## 一般條目（2026-03-15）

### 2026-03-15 — 開球王遊戲（誰才是開球王）整合至主站
- **內容**：將獨立 HTML 的 Three.js 開球遊戲重構後嵌入 SPA 架構
- **架構修復**：消除全域變數（IIFE 封裝）、加入 setPixelRatio、cancelAnimationFrame 清理、container-relative sizing
- **新增檔案**：`pages/kickball.html`（頁面模板）、`js/modules/kickball-game-page.js`（遊戲模組）
- **新增 Cloud Function**：`submitKickGameScore`（距離排行，collections: `kickGameRankings` / `kickGameScores`）
- **對接**：PageLoader、ScriptLoader、navigation.js（init/destroy lifecycle）、config.js（HOME_GAME_PRESETS homeVisible:false）、首頁第二張金色卡片、Firestore rules、CSS（`#page-kick-game` prefix）
- **教訓**：多張遊戲卡片共用 section title 時，不能用 `_setHomeSectionVisibility` 逐個控制（會互相覆蓋），需整體判斷 anyVisible 後統一控制 title 顯示

### 2026-03-15 — 俱樂部申請狀態依賴站內信導致已入隊仍顯示審核中
- **問題**：用戶已入隊但 profile 仍顯示「XXX俱樂部 審核中」
- **原因**：`_getMyLatestTeamApplications` 完全依賴 messages 集合判斷狀態，未交叉比對 `users.teamId/teamIds` 實際 membership
- **修復**：filter 加入 `currentTeamIds.includes(teamId)` 比對，已入隊俱樂部的申請紀錄不再顯示；支援 name-only 舊 message 反查；`handleJoinTeam` 改為 multi-team 檢查
- **教訓**：顯示層判斷狀態應以權威資料（membership）為準，站內信僅作為通知管道，不應作為唯一狀態來源

### 2026-03-15 — stale-first 頁面 lazy module 未載入導致 crash
- **問題**：`renderTeamList is not a function`，stale-first 策略同步呼叫 render 時 lazy script 尚未載入
- **修復**：`_renderPageContent` 中 stale-first 頁面的 lazy 方法加 `?.()` 防護；`_refreshStalePage` 加入 `ScriptLoader.ensureForPage`

### 2026-03-15 — renderMyActivities crash
- event-manage.js 移至 lazy loading 後，profile-core.js 呼叫 `this.renderMyActivities()` 需改為 `?.()` optional chaining

### 2026-03-15 — 用戶卡片 stats 資料未載入時顯示 "--"
- 資料未就緒時顯示 `--` 而非 `0`，避免誤解
- 先 showPage 顯示頁面，再 await 載入資料，最後 renderUserCardRecords

### 2026-03-15 — 俱樂部自動晉升降級需走 Cloud Function
- `updateUserRole()` 改為呼叫 `autoPromoteTeamRole` CF，限定 user/coach/captain 三層

### 2026-03-15 — 小遊戲管理開關無效（homeVisible 合併邏輯 bug）
- **問題**：管理頁開關顯示已開啟但實際無效，首頁卡片不顯示
- **原因**：`_getHomeGameManageItems()` 合併 saved + preset 時，`(saved && saved.homeVisible === false) ? false : preset.homeVisible !== false` 只處理 saved=false，saved=true 時落入 else 回傳 preset 預設值
- **修復**：改為 `saved != null ? saved.homeVisible !== false : preset.homeVisible !== false`，優先採用 Firestore 值
- **教訓**：布林合併邏輯必須同時處理 true/false 兩個方向，不能只攔截單一值

### 2026-03-15 — 開球王整合完成 + 玩法說明修正
- **功能**：完成開球王小遊戲完整 SPA 整合（頁面模板、JS 模組、CSS、Cloud Function、Firestore 規則、首頁入口卡片、管理開關）
- **修正**：玩法說明移除不可見的「地形」提示，新增 PERFECT/GREAT 加成規則說明（含取得條件提示）
- **PERFECT 判定放寬**：`powerDiff <= 3 && aimAcc >= 0.68`（約 2.5 frame 視窗），加成改為隨機範圍 ×1.06~1.12
- **GREAT 判定**：`powerDiff <= 8 && aimAcc >= 0.42`，加成隨機 ×1.02~1.06
- **物理調整**：二次方高吊懲罰 `(1 - t² × 0.9)` 取代線性懲罰，最遠甜蜜點 cy≈-0.35；隨機速度方差 ±2% 減少同分
- **色系統一**：開球王 CSS 從綠色改為藍/青色，與射門王一致
- **標題修正**：射門王 → "TooSterxHub 射門大賽"、開球王 → "TooSterxHub 開球大賽"
- **動態標題**：兩遊戲 pageTitle 改為從 HOME_GAME_PRESETS / Firestore gameConfigs 動態載入

### 2026-03-15 — 開球王鏡頭控制 + 月排行前三標記
- **鏡頭控制**：右鍵拖曳旋轉 + 滾輪縮放（桌面）、雙指旋轉 + 捏合縮放（手機），鬆開後自動回正（0.93 衰減）
- **月排行前三標記**：場地上顯示當月排行前三名的距離標記（光柱 + 地面環 + 暱稱/距離文字精靈）
- **技術**：yaw/pitch 旋轉矩陣、atan2 仰角夾角、Sprite billboard 文字、cross-shaped 半透明光柱
- **修改檔案**：`kickball-game-page.js`（camera state + handlers + orbit math + snap-back + loadTop3Markers + destroy cleanup）
- **教訓**：window 級 listener 必須在 destroy 中 removeEventListener，containerEl 級 listener 因 innerHTML 清除可容忍但不理想

---

### 2026-03-15 — 活動分享升級：LINE Flex Message + shareTargetPicker
- **問題**：活動分享只能發送純文字，無法在 LINE 中發送精美卡片
- **修復**：新建 `js/modules/event-share.js`，覆蓋舊 `shareEvent`，實作 Flex Message 卡片 + shareTargetPicker + 底部選單（分享到 LINE / 複製連結）+ 建立活動後自動提示分享
- **修改檔案**：新建 `event-share.js`、修改 `event-list.js`（移除舊 shareEvent）、`event-create.js`（建立後觸發分享提示）、`css/activity.css`（底部選單樣式）、`script-loader.js`（註冊 lazy-load）、`index.html`（script 標籤）
- **教訓**：shareTargetPicker 不支援 LINE 社群（OpenChat），需另提供複製連結選項；LIFF URL 不受 LINE Labs 設定影響，永遠在 LINE 內建瀏覽器開啟

### 2026-03-15 — [永久] 修復建立活動無反應 + 重複建立
- **問題**：點「建立活動」後無任何反饋（toast 不顯示、modal 不關閉），用戶多次點擊導致重複建立活動
- **原因**：`finally` 區塊在 `closeModal()` / `showToast()` 之前就重置了 `_eventSubmitInFlight=false` 並重新啟用按鈕。中間 `_saveInputHistory` 等非關鍵操作若拋錯，closeModal / showToast 永遠不執行，而按鈕已可再次點擊
- **修復**：重構 try/catch 結構 — 關鍵收尾（closeModal + showToast + flag reset）緊接 createEvent 成功後執行；非關鍵操作（saveHistory / writeOpLog / grantEXP / render）包在獨立 try/catch 中。編輯路徑同步修復
- **教訓**：`finally` 不應用於重置 UI 鎖定狀態（如提交按鈕），因為它在 success path 其他操作之前執行。關鍵收尾操作（modal 關閉、用戶通知）必須放在非關鍵操作之前，且不依賴非關鍵操作的成功

### 2026-03-17 — 新增教育型俱樂部系統（MVP 全 8 Phase）
- **問題**：現有系統缺少面向兒童教學的場景，教練需要不建活動就能簽到、行事曆式出席追蹤、學員分組管理
- **修復**：完整實作教育型俱樂部 MVP，包含 8 個階段：
  - Phase 1: 基礎建設（type=education 欄位、edu-helpers.js）
  - Phase 2: 分組管理 + 學員註冊（groups/students 子集合 CRUD、申請審核流程）
  - Phase 3: 課程方案（weekly/session 兩種類型）
  - Phase 4: 簽到流程（批次簽到 + QR 掃碼混合模式）
  - Phase 5: 行事曆卡片 UI（集點卡 + 月曆雙視圖切換）
  - Phase 6: 家長-孩子綁定（eduChildren on users doc）
  - Phase 7: 通知（簽到成功推播、課前提醒、出席報告）
  - Phase 8: 俱樂部列表 Tab 篩選（全部/運動/教學）
- **新增檔案**：15 個 JS 模組（js/modules/education/）、1 個 HTML（pages/education.html）、1 個 CSS（css/education.css）
- **修改檔案**：firebase-crud.js、api-service.js、firestore.rules、page-loader.js、script-loader.js、team-detail.js、team-form.js、team-form-init.js、team-form-join.js、team-list.js、team-list-render.js、team.html、team.css、index.html、config.js、architecture.md
- **教訓**：eduAttendance 獨立為頂層集合（非 attendanceRecords 子集合），因為教育簽到沒有 eventId、查詢模式完全不同、分開避免污染現有統計

*最後濃縮日期：2026-03-15*
*原始檔案：314 條目 / 2475 行 → 濃縮後約 50 條永久教訓*
