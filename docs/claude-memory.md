# ToosterX — Claude 修復日誌（濃縮版）

此檔案隨 git 版本控制，記錄歷次 bug 修復與重要技術決策，供跨設備、跨會話參考。

> **維護規則**：
> - 新紀錄一律寫在檔案前方，採新到舊排序
> - `[永久]` 標記的條目為系統性教訓，永不過期
> - 一般條目超過 30 天且無持續參考價值時可清除
> - 同主題多次迭代合併為一筆（保留最終結果）
> - 純功能新增（可從 git log 得知）不記錄
> - 總行數超過 500 行時觸發清理

### [永久] 2026-04-06 — 角色卡在 user 第二輪修復（三位專家共識，5 層防護完成）
- **問題**：總管開啟 LINE 瀏覽器後角色偶爾卡在 user，第一輪修復（04/04：init 讀 cache + catch 也 apply）後仍偶發，必須完全關閉 LINE 重開才能恢復
- **重現條件**：LINE 放背景一段時間 → LIFF access token 過期但 Firebase Auth persistence 存活 → 回到 app 時觸發退化路徑
- **根因鏈**（第二輪深度調查，經三位專家獨立審查）：
  1. **renderLoginUI 直接賦值**（profile-form.js:219）：`this.currentRole = 'user'` 不走 `applyRole()`，在 `isLoggedIn()` 瞬間回傳 false 時靜默覆蓋已驗證角色。但專家 3 指出此場景中 Tier 2 的 `isLoggedIn()` 實際回傳 true，此路徑非主因但仍是潛在風險
  2. **_startAuthDependentWork 跳過內建角色**（firebase-service.js:1641）：`_resolveCurrentAuthRole()` 正確解析出 `super_admin`，但 `if (!BUILTIN_ROLE_KEYS.includes(authRole))` 條件導致內建角色不呼叫 `applyRole`。**三位專家一致認定此為根因** — auth 解析完成後唯一的 `applyRole` 呼叫點被條件跳過，角色修正完全依賴 snapshot timing
  3. **_syncCurrentUserFromUsersSnapshot 不修正已損壞的 currentRole**（firebase-service.js:950）：`roleChanged = prev.role !== next.role` 只在 Firestore 資料層角色改變時觸發，如果 `App.currentRole` 已被其他路徑覆寫為 `'user'` 但 cache.role 正確，此函式看到「role 沒變」→ 不修正 UI
- **修復（5 層防護）**：
  - **第 1 層**（04/04）：`App.init()` 從 cache 讀角色，不硬編碼 `'user'`
  - **第 2 層**（04/04）：token refresh `.catch` 裡也呼叫 `applyRole`
  - **第 3 層**（04/06）：移除 `renderLoginUI` 的 `currentRole = 'user'` 直接賦值，改為註解說明
  - **第 4 層**（04/06，根因修復）：`_startAuthDependentWork` 移除 `BUILTIN_ROLE_KEYS` 條件，`_resolveCurrentAuthRole()` 完成後一律 `applyRole(authRole, true)`，保留 `customRoles` 載入
  - **第 5 層**（04/06，防禦性）：`_syncCurrentUserFromUsersSnapshot` 新增 `App.currentRole !== next.role` 時 `applyRole(next.role, true)`，不依賴 `roleChanged`；`roleChanged` 區塊簡化為只做 token refresh（移除重複的 applyRole）
- **專家審查結論**：
  - 專家 1（前端 Auth）：line 219 賦值對未登入用戶冗餘，對已登入用戶有害。APPROVE 移除
  - 專家 2（Firebase Auth）：BUILTIN_ROLE_KEYS 條件是最初僅為自訂角色設計，內建角色被意外排除。APPROVE 移除條件 + 簡化 roleChanged 區塊
  - 專家 3（QA 回歸）：5 個場景（首次訪問/正常登入/LIFF 過期/角色降級/快速連呼叫）全部驗證通過。Fix 2 最關鍵，Fix 1 + 3 為防禦性
- **教訓**：
  1. 角色設定不應用 `this.currentRole = 'user'` 直接賦值，必須走 `applyRole()` 統一入口
  2. 權威角色解析（Custom Claims / Firestore）完成後必須無條件套用，不能用 `includes()` 條件限制特定角色類型
  3. snapshot 的 `roleChanged` 判斷只看資料層變化，無法偵測 UI 層的角色損壞，需要額外比對 `App.currentRole`
  4. 多層防護架構的價值：任何單一路徑的 race condition 都會被後續層修正

### [永久] 2026-04-06 — 全站捲動跳頂問題修復（8 處高+中優先）
- **問題**：活動詳情、候補名單、未報名單、訊息列表、俱樂部列表等頁面，背景 onSnapshot/SWR 觸發 re-render 時捲動位置被重置到頂部
- **根因**：`container.innerHTML = ...` 全清式渲染破壞捲動位置，且多處 early-return 路徑漏掉 scrollTop 還原
- **修復**：8 處加 `scrollingElement.scrollTop` save/restore 或 `rAF scrollTo`
  - showEventDetail body / _renderUnregTable / _renderGroupedWaitlistSection（高優先）
  - _renderWaitlistSection / renderMessageList / renderTeamList / showTeamDetail 背景 ×2 / showPage timeout（中優先）
- **教訓**：每次加 scrollTop 保護時，必須檢查所有 early-return 路徑是否也有還原；用 QA agent 逐一驗證

### 2026-04-06 — 備註即時儲存
- **問題**：備註只在按「完成」時儲存，忘按就丟失（簽到/簽退有即時儲存但備註沒有）
- **修復**：note input 加 1 秒 debounce 即時儲存（與 checkbox 300ms 分開），flush/cleanup 同步支援 reg + unreg 路徑

### 2026-04-06 — 操作日誌加 eventId 精確查詢
- **問題**：Log 彈窗每次讀 500 筆操作日誌再前端篩選，浪費 Firestore reads
- **修復**：`_writeOpLog` 加 optional `eventId` 參數，5 個 promote/demote call site 補傳；Log 彈窗先用 `where('eventId','==',xxx)` 精確查，0 筆 fallback 舊方式（相容歷史日誌）

### 2026-04-06 — 運動項目切換後畫面不更新
- **問題**：切換到無活動的運動項目後切回「全部」，畫面卡在上一個運動
- **根因**：指紋快取（Plan B）在 `visible.length === 0` 時未更新指紋，切回時指紋匹配跳過 re-render
- **修復**：空結果時 `_hotEventsLastFp = ''` / `_activityListLastFp = ''` 重置

### [永久] 2026-04-06 — Log 彈窗操作日誌排序修復（跨 7 次迭代）
- **問題**：活動 Log 彈窗中，自動遞補/手動正取紀錄永遠排在最底部，不與報名/取消紀錄混合排序
- **根因鏈**（經 7 次迭代才釐清）：
  1. `ApiService.getOperationLogs()` 從本地快取讀取 → 快取載入時機不確定 → 開彈窗時可能為空
  2. 改為 `await ensureStaticCollectionsLoaded` → 載入不穩定，有時有資料有時沒有
  3. 改為直接查 Firestore + `orderBy('createdAt')` → 需要複合索引 → 靜默失敗
  4. `self._regLogToMs()` 的 `this` 綁定問題 → 所有 ms 值為 null → 排序失效
- **最終修復**：
  - 操作日誌改為 `await db.collection('operationLogs').where('type','in',[...]).limit(500).get()`（不加 orderBy，不需索引）
  - 時間解析改為閉包內的 `_toMs` 函式（避免 this/self 綁定）
  - 用 `createdAt.toMillis()` 或 `_docId` 的 Unix timestamp 提取 ms
  - 統一 `entries.sort(b.ms - a.ms)` 降序排列
- **教訓**：
  1. 本地快取的載入時機不可靠，async modal 中若需要資料，必須 await 確保到齊或直接查 Firestore
  2. Firestore 複合查詢（where + orderBy 不同欄位）需要手動建索引，缺索引時查詢靜默回傳空結果
  3. `self._method()` 在深層 forEach 回調中可能有 this 綁定問題，用閉包內定義的函式更安全
  4. debug 時善用 `data-` 屬性或 inline 顯示確認實際值，不要只靠推理

### 2026-04-05 — 簽到簽退後畫面跳回頂部
- **問題**：在活動詳情頁進行簽到/簽退操作後，頁面捲動位置被重置回頂部
- **原因**：`_debouncedSnapshotRender('attendance')` 觸發 `showEventDetail()` 整頁重渲染，其中 `showPage()` → `_resetPageScroll()` 無條件執行 `window.scrollTo(0, 0)`
- **修復**：`firebase-service.js` 的 `_debouncedSnapshotRender()` 中，當 `source === 'attendance'` 且頁面為 detail 時，只更新出席表格（`_renderAttendanceTable` + `_renderUnregTable` + `_refreshRegistrationBadges`），不呼叫 `showEventDetail()`
- **教訓**：即時資料更新（onSnapshot）不應等同於頁面導航，需區分「資料刷新」與「頁面切換」兩種場景

### [永久] 2026-04-04 — 重複報名導致假額滿（三層防線修復）
- **問題**：活動「週日早8-10西屯踢球團」上限 27 人但實際 26 人卻顯示額滿。同一用戶 Asanda Mthembu 有兩筆 confirmed self registration（間隔 2.5 小時）
- **原因**：三道防線同時失效：
  1. **CF `registerForEvent` 壞了**：`functions/index.js` 的 `db.collection("events").doc(eventId)` 把邏輯 ID（`ce_...`）當成 Firestore doc ID，永遠找不到文件。全站 65 場活動都受影響，CF 報名上線以來從未成功過
  2. **前端 Transaction 重複檢查被離線快取騙**：`firebase-crud.js` 內 `.get()` 在 `enablePersistence` 環境下可能回傳過期的 IndexedDB 快取，漏掉已存在的報名紀錄
  3. **`_rebuildOccupancy` 不去重**：直接把所有 registration 算入人數，重複報名 = 灌水計數
- **修復**：
  - CF 4 處 `doc(eventId)` → `.where("id","==",eventId).limit(1)` 查詢（functions/index.js:4490, 4812, 3012, 2144）
  - 前端 2 處 `.get()` → `.get({ source: 'server' })` 強制走伺服器（firebase-crud.js registerForEvent + batchRegisterForEvent）
  - `_rebuildOccupancy` 加 `(userId, participantType, companionId)` 三元組去重（前端 + CF 同步）
  - 資料修復：刪除重複 registration/activityRecord/expLog，扣回 EXP，遞補候補第一位
- **教訓**：
  1. event.id（邏輯 ID）≠ Firestore doc ID（_docId），CF 查事件必須用 `.where("id",...)` 查詢
  2. `enablePersistence` 環境下，Transaction 內的非事務 `.get()` 必須加 `{ source: 'server' }`
  3. `_rebuildOccupancy` 作為計數核心必須內建去重防禦，不能假設輸入無重複

### 2026-04-03 — 庫存系統 inv_transactions 權限錯誤修復
- **問題**：inventory 加庫存時報 Missing or insufficient permissions
- **原因**：firestore.rules 欄位名（quantity/operatorUid）與程式碼實際寫入（delta/uid）不一致
- **修復**：firestore.rules 改為 delta is int + uid == request.auth.uid
- **教訓**：Firestore 安全規則的欄位名必須與程式碼寫入的欄位完全一致

### 2026-04-03 — 庫存系統支援修改產品編號
- **問題**：條碼作為 Firestore 文件 ID，無法修改
- **修復**：編號變更時 create new → delete old → 更新快取；含重複編號檢查
- **教訓**：Firestore 不支援重命名文件 ID，變更 doc ID 的唯一方式是 create new → delete old

### 2026-04-02 — 首次登入 modal 繞過漏洞修復（4 項）
- **問題**：新用戶可以不填地區就建檔成功，多筆 region 為空
- **原因**：createOrUpdateUser 在驗證前寫入、_pendingFirstLogin 無重試、toggleModal 不檢查 locked、hashchange 無守衛
- **修復**：navigation.js showPage()/goBack() 加守衛；profile-form.js 最多 3 次重試；toggleModal 雙向 locked 檢查；hashchange 加首次登入守衛
- **教訓**：導航守衛必須覆蓋所有路徑（showPage/goBack/hashchange），遺漏任一路徑都是繞過漏洞

### 2026-04-02 — 編輯活動時活動地區縣市未預選
- **問題**：舊活動開啟編輯，region 有值但 cities 為空，checkbox 全部 unchecked
- **修復**：`_regionSetFormData` 中若 region 有值但 cities 為空，自動從 `REGION_MAP[region]` 填入
- **教訓**：新增功能欄位時，要考慮舊資料沒有該欄位的 fallback 行為

### 2026-04-02 — 活動地區功能（取代地區鎖）
- **修復**：新增 REGION_MAP + REGION_TABS、首頁/行事曆地區 tab、60 個舊活動 backfill
- **教訓**：`SportsEvent` 在 onclick HTML 屬性中 `&` 會被編碼為 `&amp;`，JS 需 decode

### [永久] 2026-04-02 — LINE Mini App 首次登入彈窗不顯示（嚴重用戶流失）
- **問題**：LINE Mini App 全新用戶首次登入後彈窗不跳出，90%+ 用戶個人資料永遠留空
- **原因**：`PageLoader.loadAll()` 非同步，`App.init()` 不等完成就呼叫 `bindLineLogin()`，LIFF 瞬間登入 → `showModal()` 時 profile.html 還沒載完 → `getElementById` 回傳 null → 靜默失敗
- **修復**：新增 `_showFirstLoginWhenReady()` 每 300ms 重試（最多 10 次）
- **教訓**：`showModal()` 在 DOM 不存在時靜默失敗，任何依賴動態載入 HTML 的 showModal 都必須加重試機制

### 2026-04-02 — Tournament P0-P2 production fixes
- **修復**：color-mix→rgba fallback、審核 race condition re-fetch、end/reopen 狀態守衛
- **教訓**：`color-mix()` 瀏覽器支援不足（LINE WebView），用 rgba 更安全；涉及配額的寫入操作應即時重讀最新狀態

### 2026-04-02 — AI 輔助開發 DX 改善 + 自動化測試升級 + 賽事系統修復
- **自動化測試**：38→48 suites, 1903→2122 tests
- **主辦方出席率**：修正為（正取-放鴿子）/正取算法
- **教訓**：函式索引行號要在插入索引後重新計算

### 2026-04-01 — 分隊功能多項修補（合併：UI 整合 + 編輯模式 + jersey picker + i18n）
- **問題**：編輯時分隊開關不顯示、均分按鈕無反應、i18n key 顯示原始字串、隊名重複、主辦點球衣無法分隊
- **修復**：event-manage-lifecycle.js 補 bind/setFormData；卡片綁 click + preventDefault；移除多餘 `+ '隊'`；實作 jersey picker（onclick 改用單引號避免 JSON.stringify 雙引號破壞）
- **教訓**：checkbox `display:none` + `<label for>` 在 LINE WebView 不可靠；CSS `::before` 在 SVG 元素上不生效

### 2026-04-01 — 小遊戲首頁入口被過嚴權限擋住 + 閃爍修復
- **修復**：移除權限檢查，改由 gameConfigs 控制可見性；兩張卡片預設 `display:none`
- **教訓**：HTML 預設狀態應配合 JS 動態渲染的「最終正確態」，避免 flash-of-wrong-content

### 2026-04-01 — 開球王成績提交靜默失敗
- **原因**：`.catch(function () {})` 靜默吃掉 Cloud Function 所有錯誤
- **教訓**：[永久] Cloud Function 呼叫的 `.catch()` 絕不可以用空函式靜默吞錯

### [永久] 權限守衛新增規則 — 必須驗證所有角色 × 所有入口的實際行為
- **起因**：`event.view_registrations` 守衛讓所有 `user` 看不到報名名單
- **強制規則**：(1) 列出所有受影響角色 (2) 按鈕可見性與功能一致 (3) 查看類功能預設開放 (4) 守衛必須有 `_canManageEvent` fallback (5) delegate 只需簽到+掃碼

### 2026-04-01 — 修復委託人(delegate)權限缺口
- **問題**：user 被指定為委託人後，按鈕可見但 hasPermission 擋住功能
- **修復**：3 個 guard point 加入 delegate 例外
- **教訓**：權限系統多層設計每一層都需要一致的 delegate 例外

### 2026-03-31 — 原地翻譯功能上線（Cloud Translation API）
- **用戶名排除最終方案**：16 個檔案 34 處加 `data-no-translate`，TreeWalker `closest` 一行排除
- **教訓**：翻譯排除不能靠啟發式規則，要在源頭標記

### 2026-03-31 — 推播通知開關落地 + 最小權限
- **修復**：admin.notif.toggle 限縮為只能寫 `siteConfig/featureFlags.notificationToggles`；冷快取時先預載再判斷
- **教訓**：多個功能共用同一設定集合時，規則必須以「文件 + 欄位」雙層收斂

### [永久] 2026-03-31 — Demo 死代碼全面移除（方案 C）
- **修復**：移除所有 isDemo/DemoData/_demoMode 引用（247 處 / 61 檔案），api-service.js 減少 231 行
- **教訓**：`if (!isDemo()) { prod }` 和 `if (isDemo()) { demo } else { prod }` 是兩種不同的刪除模式

### [永久] 2026-03-31 — 權限架構安全審查四項結論
- users 欄位白名單無漏洞（`isSafeSelfProfileUpdate` 封鎖 role/exp/level）
- hasPerm() 讀取成本在免費額度內，不需 Custom Claims
- INHERENT_ROLE_PERMISSIONS 兩地定義已加同步註釋 + CLAUDE.md 規則
- 前端 role 快取有即時 onSnapshot 同步，無需重整

### [永久] 2026-03-30 — 權限系統統一重構（Phase 1-4）
- **修復**：移除 17 頁 data-min-role、替換 22 處 ROLE_LEVEL_MAP 為 hasPermission()、Firestore Rules 測試
- **教訓**：role.js _canAccessPage() 有 5 個硬編碼特殊頁面；新頁面必須先加入 DRAWER_MENUS permissionCode

### [永久] 2026-03-30 — 手機日期選擇器 auto-fill 陷阱
- **問題**：iOS/Android 開啟空 `input[type=date]` 時自動填今天並觸發 change，選完再觸發第二次
- **修復**：focus/change/blur 三段式 picker session，blur 後才提交最終值
- **教訓**：`input[type=date]` 的 change 在手機上可能觸發多次，必須用 blur 確認最終值

### [永久] 2026-03-30 — 活動報名按鈕「載入中」卡住 + 已報名卻顯示「立即報名」
- **修復**：新增 `_registrationsFirstSnapshotReceived` flag + 3 次重試後強制解除 + Auth 完成後補啟動 listener
- **教訓**：cache-first 架構中必須區分「尚未載入」和「載入完成但為空」

### 2026-03-30 — CI/CD pipeline 修正
- **教訓**：Windows 開發 + Linux CI 時，package.json scripts 路徑一律用正斜線

### [永久] 2026-03-27 — Per-User Inbox 完整遷移（Phase 0-5）
- 465 用戶、2744 則訊息 → 3334 inbox 寫入
- Firestore Rules：inbox create:false（只有 CF 可寫）
- **教訓**：遷移歷史必須在切讀取之前；跨 inbox 更新只能走 CF (Admin SDK)

### [永久] 2026-03-27 — 教育頁面即時渲染修正
- **問題**：eduSubPages 缺 page-edu-student-apply → listener 被停；_renderPageContent 缺教育 handler
- **教訓**：新增教育子頁面時必須同步更新 eduSubPages 和 _renderPageContent

### [永久] 2026-03-26 — 教育簽到安全強化：簽到走 CF + Rules 封鎖前端寫入
- **修復**：新增 CF eduCheckin、eduAttendance create/update/delete: if false、students create 約束
- **教訓**：可審計資料（出席、成績、交易）必須由後端寫入

### [永久] 2026-03-26 — .page 內的 position:fixed 彈窗會定位偏移
- **原因**：`.page` 的 animation 帶 transform，CSS 規範中 transform 建立新 containing block，使 fixed 失效
- **修復**：開啟彈窗時 `document.body.appendChild(modal)` 動態掛載到 body
- **教訓**：不可將 modal 移出 `.page` HTML 結構，必須用 JS 動態搬移

### [永久] 2026-03-26 — 圖片裁切框 aspectRatio 必須與顯示區域一致
- **全站比例對照表**：封面類 8/3、商品圖 4/3、banner 2.2、浮動廣告 1、彈窗廣告 16/9

### 2026-03-26 — eduCheckin CF 無法找到俱樂部
- **教訓**：teams 用 `.add()` 建立，`doc.id` ≠ `data.id`，CF 中不能用自訂 ID 當 `doc()` 路徑

### 2026-03-25 — 俱樂部限定活動「未知俱樂部」修復
- **教訓**：teams 集合 _docId ≠ id，所有用 team ID 做 Map key 的地方都需要雙 key

### [永久] 2026-03-20 — 候補邏輯四項修復（容量變更 / 同行者取消）
- 降級時 activityRecord 必須同步更新
- cancelCompanionRegistrations 改為 5 階段模式（commit 後才更新快取）
- **教訓**：所有改變 registration 狀態的路徑必須同步更新 activityRecord

### [永久] 2026-03-20 — 清除快取後角色降為 user（LIFF/Firebase Auth 半死半活）
- **原因**：清除 LIFF localStorage 但未先登出，liff.isLoggedIn()=true 但 getAccessToken()=null
- **修復**：清除前先 auth.signOut() + liff.logout()
- **教訓**：清除快取時必須先正式登出所有 auth 層

### [永久] 2026-03-20 — 首次登入 modal 在 LINE WebView 按鈕無反應
- **原因**：`profile-data.js` 懶載入，但 bindLineLogin 在 init 時執行，函式不存在
- **修復**：首次登入邏輯搬到 `profile-form.js`（eagerly loaded），HTML 改回 inline onclick
- **教訓**：懶載入模組的方法不能綁定 UI 事件；inline handler 執行時才解析 App

### [永久] 2026-03-19 — Cloudflare CDN 快取導致 JS 更新未生效
- **四層快取排查順序**：Cloudflare CDN → LINE WebView → Service Worker → 瀏覽器快取
- **LINE WebView 快取特別頑固**：通常需等數小時～24 小時自動過期

### [永久] 2026-03-19 — cancelRegistration 快取提前寫入導致假成功
- **教訓**：所有 Firestore 寫入，本地快取必須在 `await commit()` 之後才修改

### [永久] 2026-03-18 — 首次造訪或快取過期時卡在空框架
- **教訓**：loading overlay 的移除必須以「用戶可見內容已就緒」為判斷依據

### [永久] 2026-03-18 — LIFF bounce redirect 無限迴圈
- **修復**：改用 UA 偵測（`/Line\//i.test(navigator.userAgent)`），不依賴 storage
- **教訓**：LINE LIFF webview 是完全隔離的瀏覽環境，sessionStorage/localStorage 都不跨 webview

### [永久] 2026-03-18 — 站內信與 LINE 推播通知完全失效
- **原因**：`_deliverMessageToInbox` 在懶載入模組中，通知觸發點永遠載入不到
- **教訓**：「任何頁面都可能觸發」的功能，完整依賴鏈必須在主載入階段就就緒

### [永久] 2026-03-18 — _flipAnimating 卡死導致活動卡片無法點擊
- **修復**：5 秒安全重置 + finally 保底 + 15 秒 timeout + 頁面切換清理
- **教訓**：全域 boolean 鎖必須有 (1) finally 保底 (2) 超時解鎖 (3) 頁面切換清理 三層防線

### [永久] 2026-03-18 — 跨裝置報名狀態不同步修復
- **修復**：visibilitychange 刷新 + onSnapshot 自動重連 + Auth 後背景查詢 + localStorage UID 隔離
- **教訓**：Cache-first 架構必須有「切回刷新」和「背景驗證」機制；localStorage 快取必須有用戶隔離

### [永久] 2026-03-18 — EXP 系統全面修復（5 階段）
- 候補遞補/手動確認補發 EXP、CF requestId 冪等性、Auto-EXP 規則持久化到 Firestore
- **教訓**：EXP 相關改動必須同時檢查所有發放路徑（報名/取消/掃碼/手動確認/遞補）

### [永久] 2026-03-18 — 修復建立活動無反應 + 重複建立
- **教訓**：`finally` 不應用於重置 UI 鎖定狀態；關鍵收尾必須放在非關鍵操作之前

### [永久] 2026-03-17 — UID 欄位一致性修正（attendanceRecords/activityRecords）
- **修復**：Phase 1 止血 + Phase 2 CF migrateUidFields 修正 92 筆 + Phase 4 移除 nameToUid fallback
- **教訓**：寫入 uid 欄位必須是 LINE userId；歷史修正必須用 CF Admin SDK

### [永久] 2026-03-17 — 放鴿子計算 _userStatsCache 汙染
- **教訓**：全域統計函式絕對不能依賴單一用戶的快取資料作為補充來源

### [永久] 2026-03-17 — registrations 用 'confirmed' vs activityRecords 用 'registered'
- **教訓**：兩個集合 status 命名不同，修改 status 過濾時必須追蹤所有呼叫者和資料來源

### [永久] 2026-03-17 — 成就系統 status 名稱不匹配導致失效
- **教訓**：status 值必須與 CRUD 層一致（confirmed / waitlisted / cancelled / removed）

### [永久] 2026-03-17 — 孤兒記錄清理 event.id vs doc.id 混淆導致全量誤刪
- **教訓**：event 有兩個 ID（doc.id ≠ data().id）；批量刪除必須先 dry-run；Firestore 無自動備份

### [永久] 2026-03-17 — _showPageStale 未等待 ensureForPage 導致崩潰
- **教訓**：所有進入 _renderPageContent 的路徑都必須有 ensureForPage 前置

### [永久] 2026-03-21 — 面板碰撞彈飛失效：update/render 時序 bug
- **教訓**：物理碰撞判定必須在同一個更新階段完成，不能分散在 update 和 render

---

## [永久] UID / 資料完整性地雷

### attendanceRecords uid 欄位（已修正）
- 歷史資料已透過 CF migrateUidFields 修正，寫入路徑已修復
- `event.participants` 存的是顯示名稱，絕不能直接作為 uid

### 手動簽到 UID 不匹配（2026-03-14）
- save loop 必須有「使用者有意操作」的證據，不能用 fallback 預設值推導刪除意圖

### 用戶 ID 欄位命名規範
- `users` → `uid`/`lineUserId`、`registrations` → `userId`、`attendanceRecords` → `uid`、`activityRecords` → `uid`、`events` → `creatorUid`

### UID 不一致登入修補（2026-02-28）
- 偵測 UID mismatch 時強制重新登入/刷新 token

---

## [永久] 報名系統核心架構

- 報名/取消用快取重建計數會覆蓋 event.current → 必須用 Firestore 查詢
- 所有 current/waitlist 變更必須透過 `_rebuildOccupancy()` 統一重建
- 反覆報名：registrations 查詢必須放在 transaction callback 內
- cancelRegistration：commit 成功後才寫入本地快取（模擬模式）
- `_docId` 防禦：移除前置修復時確認下游入口門檻不依賴

---

## [永久] 資料來源與同步規則

- **registrations 是唯一權威資料來源**（activityRecords 是衍生資料，status 不可靠）
- 統計關鍵集合不可設 limit（attendanceRecords / registrations / activityRecords）
- `ensureUserStatsLoaded(uid)` 使用 where('uid','==',uid) 無 limit 查詢
- 完成判定必須交叉比對 attendanceRecords（checkin + checkout）

---

## [永久] 權限 / Auth 模式

- 涉及權限敏感欄位（exp/role）的寫入一律走 Cloud Function + Admin SDK
- `_ensureAuth()` 回傳值必須檢查，LINE Access Token 失效時 Firebase Auth 建立失敗
- admin token 過期：authenticated request 一律優先讀 users/{uid}.role
- 權限治理三層同步：UI 按鈕、Firestore Rules、Cloud Functions 必須同步改
- `INHERENT_ROLE_PERMISSIONS` 兩地同步（js/config.js + functions/index.js）

---

## [永久] Firestore Rules 模式

- Firestore 規則不是查詢後過濾器，前端必須先縮成規則可證明合法的查詢
- 候補遞補是跨用戶操作，batch 中每筆寫入都必須符合 rules

---

## [永久] 啟動 / 快取 / 性能架構

- 冷啟動分層：boot collections 不等 Auth；Auth 完成後背景啟動 auth-dependent listeners
- `_initialized = true` 早於 Auth，寫入時用 `ensureAuthReadyForWrite()` 守衛
- PAGE_STRATEGY 四種策略：stale-first / stale-confirm / prepare-first / fresh-first
- seed 類初始化必須是「只補缺」而非「覆蓋預設」

---

## [永久] Deep Link / 登入 / 外部瀏覽器

- deep link + auth redirect + SPA 三者交會需注意資料就緒時序
- LIFF login redirect 不保留 URL query params，跨 redirect 狀態必須存 sessionStorage
- `liff.getProfile()` 在外部瀏覽器非 100% 可靠，需有 API 呼叫 fallback

---

## [永久] 通用開發模式

- fire-and-forget 的 showEventDetail 會造成 UI 時序問題，用 try/catch/finally
- Firestore 操作不應靜默回傳 false，應統一用 throw
- 操作日誌使用固定文件 ID + `set({merge:true})`，不依賴 `.add()` 自動 ID
- SPA 中 innerHTML 重建會摧毀注入的 DOM，載入狀態必須獨立於 DOM 追蹤
- iOS Safari 需 `-webkit-` 前綴；`100dvh` 需 `100vh` fallback；`replaceAll` 不可用
- 表單預設值：不能只改單一 input，還要檢查初始化、回填、toggle 補值與 reset

---

### [永久] 2026-03-16 — Per-User Achievement Progress 遷移
- 成就進度存 `users/{uid}/achievements/{achId}` 子集合（非全域 achievements）
- 三道防火牆：雙寫保留全域、fallback 即時計算、安全規則 `auth.uid == uid`

### [永久] 2026-03-16 — 成就鎖定/解鎖功能
- `locked` 預設 true（向下相容為永久型），解鎖時 current < threshold 會撤銷

### [永久] 2026-03-17 — 權限管理 _seedRoleData 自動補新權限碼
- **教訓**：新增入口權限後必須 bump catalog version，否則既有角色不會觸發 seed

### [永久] 2026-03-17 — admin 角色固有權限設計
- admin 入口權限由 super_admin 在 UI 啟閉
- `INHERENT_ROLE_PERMISSIONS` 僅保留 coach/captain/venue_owner 核心功能

*最後清理日期：2026-04-03*
*原始檔案：1984 行 → 清理後 305 行*

### 2026-04-04 — [永久] 候補遞補排序失效（cancelRegistration Timestamp 未轉換）
- **問題**：正取取消觸發候補遞補時，候補 3 比候補 1、2 優先入正取
- **原因**：firebase-crud.js cancelRegistration() 第 888 行從 Firestore 讀取 registrations 時，未將 registeredAt Timestamp 轉換為 ISO 字串。new Date(Timestamp) 回傳 NaN，NaN !== NaN 為 true，排序完全失效變成隨機順序
- **修復**：第 888 行加入 data.registeredAt?.toDate?.()?.toISOString?.() || data.registeredAt 轉換
- **審計**：全面掃描所有讀取 registrations 並用於排序的路徑，確認其他位置（event-create-waitlist.js、functions/index.js、cancelCompanionRegistrations）皆已有正確轉換，僅此一處遺漏
- **教訓**：Firestore Timestamp 轉換必須在每個查詢結果的 .docs.map() 中執行，不能只在部分路徑做。此類 bug 不會報錯，只會靜默產生錯誤排序，極難偵測

### 2026-04-04 — 手動簽到即時儲存（Instant Save）
- **問題**：手動簽到需勾選 20~30 人後一次送出，若 batch 失敗或頁面離開，全部重勾
- **修復**：新增 `event-manage-instant-save.js`，checkbox 勾選後 300ms debounce 自動寫入 Firestore，per-UID sequential queue 防止同一人重複寫入。失敗自動還原 checkbox + 閃紅提示。「完成簽到」按鈕改為處理備註 + 收尾（flush → batch notes → EXP → no-show reconciliation）
- **教訓**：事件代理綁定 handler 時，eventId 不可用 closure 綁死，必須讀 `_attendanceEditingEventId` 支援容器復用不同活動

### 2026-04-04 — [永久] 角色卡在 user 的根因修復
- **問題**：總管登入後角色常卡在 user，需反覆登出登入才恢復
- **原因**：(1) `app.js:291` `applyRole('user')` 無條件覆蓋 cache 中的正確角色，且後續 `_syncCurrentUserFromUsersSnapshot` 因 roleChanged=false 不會修正；(2) `firebase-service.js:907` token refresh 失敗時 `.catch` 不呼叫 `applyRole`，角色永遠不更新
- **修復**：(1) 改為讀 `FirebaseService._cache?.currentUser?.role || 'user'`；(2) `.catch` 裡也呼叫 `applyRole(next.role, true)`
- **教訓**：前端角色設定有多條非同步路徑競爭，任何路徑的 fallback 都不應硬編碼 'user'，應優先讀快取。安全靠 Firestore Rules，不靠 client-side role

### 2026-04-04 — 編輯簽到新增「候補」下放按鈕
- **功能**：管理員可在報名名單編輯模式中，將正取用戶（含同行者）強制下放至候補
- **設計**：方案 A（自然排序），下放後位置依原始報名時間排列，不做優先插入
- **實作**：`_forceDemoteToWaitlist` 加在 `event-manage-waitlist.js`（與 `_forcePromoteWaitlist` 互為反操作），紫色按鈕僅顯示在非同行者行且 event.max > 0 時

### 2026-04-04 — 活動頁面背景 re-render 跳回頂部修復
- **問題**：瀏覽活動列表時頁面反覆跳回頂部
- **原因**：`renderActivityList`/`renderHotEvents`/`renderMyActivities` 用 `container.textContent=''` 全清 DOM 再重建，背景 onSnapshot/SWR/visibilitychange 每隔數秒觸發一次
- **修復**：(A) re-render 前後存還原 scrollTop + window.scrollY；(B) 資料指紋比對（id+status+current+waitlist+pinned+title+filter），未變則跳過
- **教訓**：SPA 中任何 `innerHTML=''` 或 `textContent=''` 全清式渲染都必須考慮捲動位置保留
