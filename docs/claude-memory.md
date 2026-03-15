# SportHub — Claude 修復日誌（濃縮版）

此檔案隨 git 版本控制，記錄歷次 bug 修復與重要技術決策，供跨設備、跨會話參考。

> **維護規則**：
> - 新紀錄一律寫在檔案前方，採新到舊排序
> - `[永久]` 標記的條目為系統性教訓，永不過期
> - 一般條目超過 30 天且無持續參考價值時可清除
> - 同主題多次迭代合併為一筆（保留最終結果）
> - 純功能新增（可從 git log 得知）不記錄
> - 總行數超過 500 行時觸發清理

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
- 球隊欄位需有縮減/清空規則，不能與一般個人資料共用寬鬆白名單

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

### 2026-03-15 — 球隊申請狀態依賴站內信導致已入隊仍顯示審核中
- **問題**：用戶已入隊但 profile 仍顯示「XXX俱樂部 審核中」
- **原因**：`_getMyLatestTeamApplications` 完全依賴 messages 集合判斷狀態，未交叉比對 `users.teamId/teamIds` 實際 membership
- **修復**：filter 加入 `currentTeamIds.includes(teamId)` 比對，已入隊球隊的申請紀錄不再顯示；支援 name-only 舊 message 反查；`handleJoinTeam` 改為 multi-team 檢查
- **教訓**：顯示層判斷狀態應以權威資料（membership）為準，站內信僅作為通知管道，不應作為唯一狀態來源

### 2026-03-15 — stale-first 頁面 lazy module 未載入導致 crash
- **問題**：`renderTeamList is not a function`，stale-first 策略同步呼叫 render 時 lazy script 尚未載入
- **修復**：`_renderPageContent` 中 stale-first 頁面的 lazy 方法加 `?.()` 防護；`_refreshStalePage` 加入 `ScriptLoader.ensureForPage`

### 2026-03-15 — renderMyActivities crash
- event-manage.js 移至 lazy loading 後，profile-core.js 呼叫 `this.renderMyActivities()` 需改為 `?.()` optional chaining

### 2026-03-15 — 用戶卡片 stats 資料未載入時顯示 "--"
- 資料未就緒時顯示 `--` 而非 `0`，避免誤解
- 先 showPage 顯示頁面，再 await 載入資料，最後 renderUserCardRecords

### 2026-03-15 — 球隊自動晉升降級需走 Cloud Function
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

*最後濃縮日期：2026-03-15*
*原始檔案：314 條目 / 2475 行 → 濃縮後約 50 條永久教訓*
