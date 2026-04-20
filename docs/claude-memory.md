# ToosterX — Claude 修復日誌（濃縮版）

此檔案隨 git 版本控制，記錄歷次 bug 修復與重要技術決策，供跨設備、跨會話參考。

> **維護規則**：
> - 新紀錄一律寫在檔案前方，採新到舊排序
> - `[永久]` 標記的條目為系統性教訓，永不過期
> - 一般條目超過 30 天且無持續參考價值時可清除
> - 同主題多次迭代合併為一筆（保留最終結果）
> - 純功能新增（可從 git log 得知）不記錄
> - 總行數超過 500 行時觸發清理

### 2026-04-20 — Firebase Callable Function 呼叫雙陷阱（一天內犯兩次） [永久]
- **陷阱 1：前端呼叫 CF 漏指定 region 導致 CORS 失敗**
  - 錯誤訊息：`Access to fetch at 'https://us-central1-.../recordUserLoginIp' ... blocked by CORS policy`
  - 根因：`firebase.functions().httpsCallable(...)` 預設連 `us-central1`，但本專案所有 CF 部署在 `asia-east1`
  - 修正：必須用 `firebase.app().functions('asia-east1').httpsCallable(...)`（與專案既有所有 CF 呼叫一致）
- **陷阱 2：CF 內用 `admin.firestore()` 但專案實際是 modular `db = getFirestore()`**
  - 錯誤訊息：`ReferenceError: admin is not defined at /workspace/index.js:XXXX`
  - 根因：`functions/index.js` 頂部已有 `const { getFirestore } = require("firebase-admin/firestore")` + `const db = getFirestore()`（modular v10+ 寫法）；套用標準 `admin.firestore()` 會找不到 `admin` 變數
  - 修正：CF 內 Firestore 操作一律用 `db.collection(...)`，禁用 `admin.firestore()`
- **共通教訓**：
  - 寫新 CF 前**必須**先看 `functions/index.js` 現有一個 onCall 函式的寫法當範本（命名空間、region、Firestore API）
  - 寫前端呼叫 CF 前**必須**先搜 `httpsCallable` 看既有怎麼寫（`firebase.app().functions('asia-east1')`）
  - 不要套用 Firebase 官方文件的「標準寫法」—— 本專案有自己的 convention
- **預防規則**：新增/修改 CF 時必檢查：①`region: "asia-east1"`設定 ②CF 內用 `db`（不是 `admin.firestore()`）③前端呼叫用 `firebase.app().functions('asia-east1').httpsCallable(...)`

### 2026-04-20 — Super_admin 隱身從「本地開關」升級為「目標用戶屬性」 [永久]
- **問題**：`super_admin` 的「隱身模式」只有「自己看自己的 3 個路徑」有效；其他用戶看你、你自己的「我的名片」頁、分享 Flex 卡片都仍顯示「總管」紅色膠囊
- **根因**：`_stealthRole(name, role)` 原邏輯讀「當前登入用戶自己的」`user.stealth`，別人的 stealth 永遠是 undefined → 別人看你時不套用
- **修復（架構升級）**：
  - `_stealthRole` 改為接受 `userOrUid` 參數，讀「**目標用戶**的 stealth」
  - `_userTag` L78 改為傳 `options?.uid` 讓 `_stealthRole` 優先 O(1) 查找
  - 短路優化：`role !== 'admin' && role !== 'super_admin'` 直接返回，避免 100 人名單中 99 次無謂查找
  - 補 2 個洩漏洞：`profile-card.js renderUserCard`、`profile-share.js _buildProfileFlexMessage`
- **連帶修復 Firestore Rules 持久化 bug**：`isSafeSelfProfileUpdate()` 白名單漏了 `stealth` 欄位 → 切換隱身時 Firestore 寫入被 Rules 靜默拒絕（`.catch(err => console.error)` 吞掉），只存 localStorage → 清快取/換裝置狀態丟失
  - 解法：白名單補 `stealth` + `bool` 型別檢查
- **drawer 身分膠囊刻意保留真實身分**：同時是開關（點擊切換），讓自己知道隱身狀態
- **教訓**：
  - 「隱身/偽裝」類功能的本質是「讓別人看你顯示為另一身分」，所以判斷依據必須是**目標用戶**屬性而非當前用戶屬性
  - 任何用戶屬性寫入路徑都要同步檢查 Rules 白名單是否允許（否則會靜默失敗）
  - `.catch(err => console.error)` 容易掩蓋 Rules 拒絕的 bug，必要時應改為 `console.warn` 並給出更明確訊息

### 2026-04-20 — 活動詳情頁「加載後跳回頂部」經典 async stale closure 陷阱（6 輪修復） [永久]
- **問題**：用戶進活動詳情頁幾秒後、滑到中間瀏覽名單時，畫面會被突然打回頂部；連續修 5 輪都沒根治，第 6 輪靠診斷 log 精準抓到真兇
- **真兇（Round 6 發現）**：`_doRenderAttendanceTable` 是 async 函式，流程：
  1. 函式入口記錄 `_savedScrollY = _scrollEl.scrollTop`（用戶剛進頁 = 0）
  2. `await Promise.all([fetchAttendanceIfMissing, fetchRegistrationsIfMissing])` 期間用戶滑到 490px
  3. render 完成後 `_scrollEl.scrollTop = _savedScrollY` = 0 → 把用戶從 490 打回 0
  - **這是經典 stale closure 陷阱**：async 函式入口記錄的 state，在 await 後已過時但被用來覆寫當前狀態
- **修復歷程（6 輪，每一輪都看似命中但都不徹底）**：
  - Round 1 (`20260420f`, commit c367d17b)：retry/safety net 改走局部 patch（不整頁重繪）
  - Round 2 (`20260420g`, commit 26031601)：`_activatePage` 同頁 activate 時不 reset scroll
  - Round 3-4 (`20260420j/k`, commit 5e6f8a51 / 29e6ec52)：加診斷 log（`_runPageScrollReset` stack trace + window.scrollTo / Element.scrollTop setter monkey-patch，僅 `?debug=1` 啟用）
  - Round 5 (`20260420l`, commit 4449a138)：
    - **Height Lock**：新增 `App._lockContainerHeight(container)` helper，3 個 render 函式入口加 1 行防 DOM 替換造成 scrollHeight 縮短 clamp
    - **Page Lock**：進 detail 類頁設 10s 鎖，非用戶近期（800ms）touch/click 的 showPage 擋下（保留 `bypassPageLock` 逃生口；goBack 不走 showPage 不受影響）
  - Round 6 (`20260420m`, commit a4eedeb9)：**移除 `_doRenderAttendanceTable` 的 scrollTop 還原陷阱**（L152 + L297），信任 Height Lock 防 clamp
- **最終四層防護網**：
  1. Height Lock — 防瀏覽器 DOM 替換 clamp scrollTop
  2. **移除 scrollTop 還原**（Round 6，真正根治）— 防 async stale closure
  3. Page Lock — 防自動機制拉走用戶（deep link poller / pending route 等）
  4. `_activatePage` 同頁不 reset — 防同頁 showPage 觸發 reset
- **同步函式 vs async 函式**：
  - `_renderUnregTable` / `_renderGroupedWaitlistSection` 是**同步**（無 await）→ 無 stale closure 問題 → scroll 還原保留作為 Height Lock 失效時的 fallback
  - `_doRenderAttendanceTable` 是 async（有 `await Promise.all([...])`）→ 有 stale closure 問題 → 還原必須移除
- **關鍵教訓**：
  - **async 函式中記錄 state 再於 await 後覆寫，必定是 bug**（stale closure）。若真需要還原，要在 await 後**重新讀取當前值**或加條件判斷（例如「只在縮小時還原」）
  - **診斷 log 的戰略價值**：5 輪盲修無效，Round 3-4 加 scroll monkey-patch（`?debug=1`）後 Round 6 一擊即中。**複雜的 scroll / 導航 bug 第一步就該加診斷工具**
  - **為什麼反覆修不乾淨**：每輪都只看到「症狀」（整頁重繪、Background reload、同頁 reset 等），沒看到真正的「async state 污染」源頭。每修一層都讓 bug 表象減少但殘餘
  - **Height Lock 的戰略地位**：Round 6 敢移除 scrollTop 還原，是因為 Round 5 的 Height Lock 先做好了 clamp 保護。**兩個修法必須成對存在**（移除還原 depends on Height Lock）
  - **防禦性設計模式**：Height Lock（DOM 層）+ Page Lock（導航層）+ Scroll-trace 診斷（debug 層）+ 主動 touch 感知（UX 層）= 完整保護
- **反覆提到的「被拉回」老 bug**：
  - 多次修復紀錄分別見 commits ce987791 / 96458bb6 / aca6a444（showPage 守衛）
  - Page Lock 是最新的統一防線（10 秒鎖 + 用戶主動感知）
- **部署狀態**：
  - 前端：Cloudflare Pages 自動（main branch push）
  - 診斷 log 保留在生產（Round 3-4），供未來偶發問題再診斷；`?debug=1` 才啟用 monkey-patch，一般用戶零影響
- **回退安全性**：
  - Round 6 可獨立 revert（只回到 async bug 狀態）
  - Round 5 Height Lock 不可單獨 revert（會讓 Round 6 失去保護）
  - 其餘修法皆可獨立 revert

### 2026-04-20 — 活動黑名單功能（Phase 1-6 + 二次審計 + 選項 B 完成） [永久]
- **需求**：管理員可將特定用戶加入活動黑名單，使其看不到該活動（僅擋尚未報名的，已報名的保留可見以尊重歷史）
- **核心設計決策**：
  - 黑名單只擋「尚未報名」的活動，曾有任一 registration 紀錄（含 cancelled/removed）→ 保留可見
  - 被擋用戶看到活動的偽裝訊息：「找不到此活動」（不透露被擋事實，避免人際摩擦）
  - UI 僅位於「用戶補正管理 > 活動黑名單」（不在活動管理面板）
  - super_admin INHERENT 鎖定權限，user 絕對無權限
- **資料結構**（events 文件新增 2 欄位）：
  - `blockedUids: string[]` — 被擋用戶 UID 列表
  - `blockedUidsLog: [{uid, by, action, at, reason}]` — 審計軌跡（永久保留）
- **實作 Phase**：
  - Phase 1（0.5 天）：Firestore Rules + 權限碼 + INHERENT 兩端同步
  - Phase 2（0.5 天）：共用 helper `_isEventVisibleToUser` + 23 個單元測試
  - Phase 3（1 天）：後台 UI（模糊搜尋活動/用戶、新增/移除、列表依活動分組）
  - Phase 4（0.5 天）：全站過濾入口 — 利用既有 `_getVisibleEvents` 單一 choke-point
  - Phase 5（無程式碼變更）：CF 稽核結論 = 不需改（通知僅發給已報名用戶）
  - Phase 6（0.5 天）：CLAUDE.md 永久條目 + 修復日誌
- **關鍵 helper（禁止重寫）**：
  - `_isEventVisibleToUser(e, uid)` 於 `js/modules/event/event-blocklist.js`
  - 四狀態邏輯：訪客→可見、未擋→可見、擋+有歷史→可見、擋+無歷史→不可見
- **過濾入口清單**：
  - 首頁輪播 / 行事曆 / 搜尋 → 經 `_getVisibleEvents` 統一處理
  - 俱樂部內嵌活動 → `_renderTeamEvents` 明確 filter
  - 活動詳情直接 URL（QR/分享/訊息連結）→ `showEventDetail` 守衛
  - 豁免：Favorites（用戶資料）、Scan/Dashboard（admin 用途）、Tournament（無內嵌列表）
- **5 層防禦架構**（commit 順序）：
  1. **列表層** — `_getVisibleEvents` / `_renderTeamEvents` 過濾（commit 491379de）
  2. **詳情入口** — `showEventDetail` 第一檢查點（commit 491379de）
  3. **詳情重取後** — `showEventDetail` 第二檢查點（第一次審計發現，commit e8d9a9b7）
  4. **寫入守衛** — `handleSignup` / `_confirmCompanionRegister`（第二次審計 + 選項 B，commit 965ebcbe）
  5. **Firestore Rules** — `canManageEventBlocklist()` 寫入規則（已手動部署至 fc-football-6c8dc）
- **Companion 守衛範圍**：只擋主報名人（operator）被擋，不擋同行者中的被擋用戶
- **部署狀態**：
  - 前端：Cloudflare Pages 自動（main branch push）
  - Firestore Rules：**已手動 `firebase deploy --only firestore:rules` 部署**
  - Cloud Functions：**無需部署**（CF 本次未實質引用新權限碼，INHERENT 同步是為未來一致性）
- **Commit 歷程**（共 7 個）：
  - `e4fbc08e` Phase 1、`dec72e86` Phase 2、`c3eab11f` Phase 3
  - `491379de` Phase 4、`df5cd9e6` Phase 5+6
  - `e8d9a9b7` 審計修復 #1（第二檢查點）
  - `965ebcbe` 選項 B（寫入守衛）
- **二次審計發現（全部已處理）**：
  - 🔴 Rules 手動部署疏忽 → 已提醒並部署
  - 🔴 第二檢查點漏守衛 → 已補（commit e8d9a9b7）
  - 🔴 未登入先進頁 → 登入後報名繞過 → 已補（commit 965ebcbe）
- **接受的已知限制（未處理）**：
  - event owner rules 允許改 blockedUids（UI 不給入口）
  - admin 預設無此權限（與 admin.repair.* 家族一致）
  - `_renderExistingEventBlocklist` 排序用字串比較（僅顯示順序，不影響功能）
  - 加黑名單後當下頁面不自動刷新（Firestore 單向推播常態）
  - event-blocklist.js 載入失敗時 fail-open（UX 優先）
- **教訓**：
  - **單一 choke-point 設計省力氣**：既有 `_getVisibleEvents` 已整合 teamOnly + privateEvent，黑名單只需 +1 行就覆蓋首頁+行事曆+搜尋三個關鍵入口
  - **「尊重歷史」解決強制退報的複雜性**：保留曾報名用戶可見 = 避免資料狀態機、自動退費、通知誤發等棘手邊界
  - **CF 端自然不需過濾**：因通知只發給已報名用戶，我們的豁免規則自動對齊
  - **永久條目強制共用 helper**：防止日後新入口漏過濾（已在 CLAUDE.md 建立「活動可見性規則」章節）
  - **一次性規劃 ≠ 一次做對**：Phase 1-6 完成後仍經 2 次審計才補齊漏洞（第二檢查點、bypass 繞過）。中大型功能上線前必須至少做一次獨立審計
  - **Firestore Rules 部署不在 git push 範圍內**：必須明確紀錄手動部署步驟到 commit message / 日誌，避免「程式碼上了、功能沒上」的狀態

### 2026-04-19 — 首次登入 UX 改為「可瀏覽、寫入才擋」
- **問題/目標**：原設計強制首次登入用戶填完基本資料才能操作任何功能，包括瀏覽。
  對新用戶造成 onboarding 摩擦，無法先看看內容再決定是否加入
- **改動**：
  - **移除**三處「_pendingFirstLogin 攔截導航」守衛：
    1. `navigation.js showPage`（L449-453 舊守衛）
    2. `navigation.js goBack`（L702-706 舊守衛）
    3. `app.js hashchange`（L2282-2286 舊守衛）
  - **移除** `profile-form.js` 登入後自動彈 modal 的邏輯（L140-162）
  - **新增** `_requireProfileComplete()` helper（`navigation.js`）
    - `_pendingFirstLogin` 為 true 時彈 modal + return true（呼叫者中止動作）
    - false 時直接放行
  - **7 個寫入入口加守衛**：
    - `handleSignup`（活動報名）
    - `_confirmCompanionRegister`（同行者報名，附帶關閉 companion modal）
    - `handleJoinTeam`（加入俱樂部）
    - `handleSaveTeam`（建立/編輯俱樂部）
    - `handleCreateEvent`（建立活動）
    - `registerTournament` × 2（賽事報名 + 友誼賽報名）
  - **Modal 內容更新**（`index.html`）：
    - 加紅字提醒「※ 下列資料將作為地區歸屬及活動參與資格的判定依據,請務必如實填寫」
    - 加「稍後填寫」按鈕（`App.dismissFirstLoginModal`），允許用戶先關閉繼續瀏覽
    - `_pendingFirstLogin` 保留，下次寫入類動作仍會彈出
- **保留的行為**：
  - `_pendingFirstLogin` 仍在 3 處設置（登入時、CF PROFILE_INCOMPLETE 錯誤時）
  - Modal 的 `overlay.dataset.locked = '1'` 保留，避免用戶點外層意外關閉
  - 用戶必須透過「稍後填寫」或「確認送出」才能離開 modal
- **教訓**：
  - 「守衛一律擋」的 UX 容易讓新用戶流失；改用「可瀏覽 + 寫入才擋」的層次化守衛
    對 onboarding 友善很多
  - Helper function（`_requireProfileComplete`）比每個入口手寫判斷更易維護
  - 寫入守衛需覆蓋所有可能的入口（7 處），漏一個就會讓用戶繞過

### 2026-04-19 — 活動詳情頁 attendance-table「名單 → 空白 → 名單」生硬閃爍修復
- **問題**：進入活動詳情頁時，先顯示快取名單，然後快取名單閃消失變空白，幾秒後才補上最新資料，轉場生硬
- **根因**：`showEventDetail()` 被多個路徑重複呼叫（`_regsLoadingRetryTimer` 3 秒重試 /
  Phase 3 安全網 / onSnapshot 觸發 / 第二次 showPage），每次都執行
  `nodes.body.innerHTML = ...` 重寫整個外框，連帶把內部 `<div id="detail-attendance-table">`
  清成空 div。然後 `_renderAttendanceTable` 有 **100ms debounce + fetch 等待**，
  這段時間內 DOM 就是空白。等到 `_doRenderAttendanceTable` 寫入新名單才原子替換
- **修復（commit pending）**：`js/modules/event/event-detail.js`
  - 在 try 塊入口（line 232 前）捕獲 `_isSameEventRerender = (currentPage === 'page-activity-detail' && _currentDetailEventId === id)`
  - 外框 innerHTML 改寫前，若 `_isSameEventRerender` 為 true，捕獲舊 attendance-table innerHTML
  - 外框改寫後，若 preservation 有值：還原舊內容（稍後由 `_renderAttendanceTable` 原子替換）
  - 若無 preservation（首次進入 / 切換到不同活動）：顯示 loading skeleton
  - **注意**：只處理 attendance-table，waitlist/unreg 在 `nodes.body.innerHTML` 改寫後
    立即同步重渲染（line 535-536），沒有 debounce 空窗，不需 preservation
- **教訓**：
  - 原子性 innerHTML 替換看似瞬間（舊 DOM 持續顯示直到新 DOM 組好），但**中間插入的
    空白狀態**（如 `innerHTML = ''` 或外框改寫把子容器清空）會破壞原子性
  - `_renderAttendanceTable` 的 100ms debounce 對連續多次呼叫是好的（coalesce），
    但在 `nodes.body.innerHTML = ...` 改寫後會造成 debounce 期間空白可見
  - 多個 re-render 觸發路徑（retry / safety net / snapshot）下游都走 `showEventDetail`
    而不是 `_patchDetailTables`，長期來看該把 retry / safety net 改走局部更新

### 2026-04-19 — 活動詳情頁「幾秒後被拉回行事曆」連續修復 [永久]
- **問題**：用戶回報「首頁／行事曆點活動卡進詳情頁，幾秒後被拉回行事曆」，
  剛刷新/剛開啟網站時最常發生
- **追查過程**：
  - 用 `?debug=1` 內建 debug console 收集完整 log
  - `_activatePage` 加 stack trace log 定位出真兇：`_showPageFreshFirst`
  - 真實時序：
    1. URL hash 是 `#page-activities`（殘留）
    2. Boot 解析 hash → `App.showPage('page-activities')` 走 `_showPageFreshFirst`
    3. 卡在 `await ensureCloudReady`（Firebase init）數秒
    4. 用戶在首頁點活動卡 → `showPage('page-activity-detail')` 走 `_showPageStale`（cache 有）→ 快速進詳情頁
    5. cloud ready → boot 的 `_showPageFreshFirst` 復活 → `_activatePage('page-activities')` 把用戶拉走
  - 既有 `transitionSeq` 守衛（L539）沒擋住這個 race
- **修復（commit 96458bb6 + 調整版 [pending]）**：
  `_showPageFreshFirst` / `_showPagePrepareFirst` 在 `_activatePage` 前新增 `_startingPage` 比對守衛：
  - 記錄函式進入時的 `this.currentPage`（_startingPage）
  - await 完成後檢查 `this.currentPage !== _startingPage && !== pageId` → 放棄本次切頁
  - **關鍵**：比對變化量（不能只用 `!== 'page-home'`），否則會誤擋正常頁面切換
    （例如用戶從 page-activities 切到 page-teams 且無 cache 時）
- **連鎖副作用修復**：
  - **commit f03a42ed**：拉回問題修好後，更早走到 `_startEventsRealtimeListener`，
    暴露 `db undefined` TypeError（setTimeout 350ms 延遲啟動 listener 時 Firebase 可能還沒 init）。
    `_startPageScopedRealtimeForPage` 加 `typeof db === 'undefined'` 守衛。
    Listener 會在 `ensureCollectionsForPage` 路徑重新觸發，不會永久中斷
  - **commit 6a13cbab**：切換活動時 `detail-attendance-table` 殘留前一活動名單，
    顯示「B 標題 + A 名單」造成「被拉回 A」錯覺。showEventDetail 切換時立即清空
    attendance-table 並顯示 loading skeleton；await `_renderAttendanceTable` 後補 stale check
  - **commits 56f31c55 / 5d0909d0 / 9f4a214b**：同模式守衛套用到
    `_flushPendingProtectedBootRoute` / `_completeDeepLinkFallback` / `_tryOpenPendingDeepLink`
    （但這些都在 boot / deep-link 流程，不影響正常切頁）
- **Debug 工具加強（commit 11073947）**：`?debug=1` 浮動 console 加 📋 複製 / 🗑️ 清 / ✕ 隱藏
  按鈕，手機 LIFF 也能匯出 log
- **教訓**：
  - `showPage` 的 async await 內，一切「等 cloud / 等 auth」都可能數秒，
    await 後若不以**起始 currentPage** 比對，會在用戶已主動導航後強制拉走
  - **守衛不能用 `currentPage !== 'page-home'`**（會誤擋正常切頁）；
    必須用 `_startingPage` 變化量比對
  - Boot 期間的自動 navigate（`_flushPendingProtectedBootRoute` / deep-link poller /
    fallback）必須全部加「尊重用戶主動導航」守衛
  - 修好一個層級可能暴露下一層級的潛伏 bug（例如 db undefined），要持續監控
- **診斷基礎設施**（永久保留）：
  - `index.html` 的 `?debug=1` 浮動 console（手機可用）
  - `app.js` DOMContentLoaded 印 CACHE_VERSION
  - `navigation.js _activatePage` 印 stack trace（切頁來源）
  - `app.js _flushPendingProtectedBootRoute` 多處診斷 log

### 2026-04-19 — events.participantsWithUid 導入（Phase 0-4 完成） [永久]
- **問題**：14 組同暱稱用戶（含「勝」「Ivan」各 1 次放鴿子被隱身），根因是
  `_buildConfirmedParticipantSummary` / `_buildGuestEventPeople` 等 fallback 路徑
  用 `_userByName.set(name, user)` 反查 UID，同名被後者覆蓋
- **修復**：events 新增 `participantsWithUid: [{uid, name, teamKey}]` / `waitlistWithUid` /
  `schemaVersion: 2`。由 `_rebuildOccupancy`（前端 + CF 雙端同步）統一產出。
  讀取端（6 處 fallback）優先使用新欄位，fallback 回舊 participants[] 保持相容
- **分 Phase 實施**（單日全部完成）：
  - Phase 0：pure-functions.test.js 補 8 個測試（同暱稱/排序/去重）鎖定既有行為
  - Phase 1a：firestore.rules whitelist 加 3 欄位，已 deploy
  - Phase 1：`_rebuildOccupancy` + `_applyRebuildOccupancy` + 13 處 `db.update()` 擴充
    CF registerForEvent + cancelRegistration 已 deploy
  - Phase 2：data-sync ⑩ 遷移工具（從 registrations 子集合重算，double-check 避 race）
  - Phase 3：6 處讀取端優先 participantsWithUid（_buildConfirmedParticipantSummary /
    _confirmAllAttendance 鎖定函式 fallback / _initInstantSave / _buildGuestEventPeople /
    guest view count / event-create.js uid 反查）
  - Phase 4：data-sync ⑪ 一致性檢查（唯讀）+ ⑫ 強制重算（寫入 + 權限守衛 + double-check）
  - **Phase 3 補強**（事後修復）：用戶回報「兩個同暱稱 Ivan 點名字都跳同一位」。
    根因是 Phase 3 只改了**資料層** 6 處，但**渲染層** 8 處 `_userTag(name)` 沒傳 uid
    → HTML onclick 變成 `showUserProfile('Ivan')` 沒 uid
    → fallback 到 `_findUserByName` 挑第一個。
    補修 event-detail.js (4 處) / event-manage-attendance.js / event-manage-waitlist.js /
    user-admin-list.js / leaderboard.js 共 8 處 `_userTag` 呼叫傳入 uid
- **Commits**：78e81034 / e93e7fab / 5bb799d0 / ea6894a1 / 237ace45 / 7ddbbbd2 / 521602fd
- **教訓**：
  - **禁止用 name 反查 uid 做身分識別**。公開副本欄位必須帶 UID 結構
  - **修復資料層不夠，必須同時檢查渲染層**：`_userTag(name)` 類 HTML 產生器若 onclick
    沒帶 uid，即使底層 people 物件有 uid 也會在 UI 點擊時遺失。未來類似 bug
    必須 grep 所有 `_userTag`、`onclick`、`showUserProfile` 呼叫點
  - 舊資料 fallback 必須偵測同名衝突並警告（console.warn('[pwu] ...')）
  - Firestore transaction **不支援 collection query**，race 緩解依賴 double-check + 自我修復
  - CF / 前端純函式雙端同步規則：註解交叉引用 + 手動 review + grep 腳本
  - additive 欄位策略零風險：舊 client 不認識新欄位但不 break
- **後續（Phase 5，2-4 週後評估）**：廢除舊 `participants[]` / 移除 `scan-process.js:59`
  `event-manage-attendance.js:51` userName fallback / 擴充 CHANGE_WATCH / 隱私方案 B
- **使用操作**：用戶登入後台 → 用戶補正管理 → 系統資料同步 →
  先跑 ⑩ 遷移（首次）→ ⑪ 檢查是否一致 → ⑫ 強制重算（若有不一致）

### 2026-04-19 — 活動詳情頁跳頂老問題修復（visibilitychange + RC1 revalidate 全頁重繪）
- **問題**：用戶回報「活動詳細報名頁面因為加載渲染畫面常常跑回頂部」，是長期老問題
- **根因**：`js/firebase-service.js` 兩處違反 CLAUDE.md「活動詳情頁局部更新規則」：
  - L2764 `_staleWhileRevalidateRegistrations`（Auth ready 後 RC1 背景刷新）→ 直接呼叫 `App.showEventDetail` 全頁重繪
  - L2871 `_handleVisibilityResume`（visibilitychange 切回前景 1s 後觸發）→ 同樣 `showEventDetail`
  - `showEventDetail` 是 async 含 `await _renderAttendanceTable`（100ms debounce + Firestore fetch），子流程替換 DOM 時文件高度塌縮，外層的單次 `requestAnimationFrame(scrollTo)` 趕不上 → scroll 被 clamp 跳頂
- **為什麼「老問題一直無法修正」**：2026-04-13 已建立活動詳情頁局部更新規則（`_refreshSignupButton` / `_patchDetailCount` / `_patchDetailTables`），但只覆蓋「報名/取消/候補操作後」路徑，漏掉 revalidate + visibility resume 兩條高頻刷新路徑
- **修復**：兩處改走 `this._debouncedSnapshotRender('registrations')`（已驗證的標準局部更新路徑，內建 scroll 保護）。保留 activities / my-activities 的 render + scroll restore（這些頁面沒有局部更新路徑，維持原邏輯）
- **版號**：20260419（config.js + index.html var V + sw.js CACHE_NAME + 68 處 ?v=）
- **審計通過**：
  - `npm run test:unit` 全過（51 suites / 2169 tests）
  - 局部更新分支（firebase-service.js:144-161）原本就處理 `_flipAnimating` 鎖、null eventId gracefully 退出、5 項局部更新（按鈕 + 人數 + 正取/未報名/候補名單）
  - 不動鎖定函式（firebase-service.js 鎖定的是 `ensureUserStatsLoaded` 等統計系統，兩處修改位於 RC1 / RC3 UI 刷新路徑，不觸及統計）
- **[永久] 教訓**：
  - 建立局部更新規則時，必須全檔掃描所有 `showEventDetail` 呼叫，區分「用戶操作」與「自動刷新」，兩類都要規範
  - `showEventDetail` async 流程內的 scroll 保護（setTimeout 50/150ms 恢復）對外層非 await 的呼叫者而言**不可靠**，因為 `await _renderAttendanceTable` 會延遲到 150ms 之後才完成 DOM 替換
  - 已知限制：局部更新不覆蓋標題/圖片/地點/時間等「活動主體資訊」欄位變更（events listener 本來就不更新這些），若用戶在背景時活動被編輯，切回後需重新導航才能看到新值——這是 events 路徑設計缺口，不屬於本次修復範圍

### 2026-04-17 — 多分頁權限加載衝突修復（Firestore 單 tab + BroadcastChannel 警告）
- **問題**：PWA / 多瀏覽器分頁場景下權限加載卡住、LIFF session 錯亂。根因是 Firestore `enablePersistence({ synchronizeTabs: true })` 的多 tab IndexedDB leader election 競爭
- **修復（commit 6e0daede，版號 20260417e）**：
  - **Level 2（核心）**：`firebase-config.js` `synchronizeTabs: true → false`。第一個 tab 拿 IndexedDB 快取，後續 tab 自動走 memory cache（SDK 降級，catch handle `failed-precondition`）。消除 leader 競爭
  - **Level 1（UX）**：新增 `js/modules/multi-tab-guard.js`。BroadcastChannel 偵測同站其他分頁，顯示毛玻璃警告 modal + 關閉提示
  - CSS：`base.css` 新增 `.multi-tab-overlay` 樣式（CLAUDE.md 毛玻璃規範 + `@supports` fallback for 舊 Android WebView）
  - 模組自動 init（DOMContentLoaded 後），不動 `app.js init()` 順序
- **審計通過**：
  - `npm run test:unit` 全過（51 suites / 2169 tests）
  - `node --check` multi-tab-guard.js + firebase-config.js OK
  - 符合 CLAUDE.md 毛玻璃規範（blur + webkit + rgba + radius + shadow + fallback）
  - 跨瀏覽器 fallback：BroadcastChannel `typeof` 檢查，舊環境靜默降級
  - 不動鎖定函式、不影響 LIFF（LIFF 靠 localStorage 跨 tab 同步，不受影響）、不影響 SW cache
- **已知限制**：
  - BroadcastChannel 跨 context 不通（iOS Safari PWA vs Safari 是獨立 WebKit，偵測不到）
  - 後續 tab 無離線快取，切頁稍慢（比「卡住」好）
- **Smoke test 待用戶驗證**：同站開兩分頁 → 應看到警告 modal + console.warn `failed-precondition`
- **教訓**：
  - Firestore multi-tab 持久化的 leader election 機制在正常情況 OK，但搭配 LIFF / PWA 多 tab 複雜情境會暴露競爭問題
  - 單 tab 模式（`synchronizeTabs: false`）是小而有效的解法，第二 tab 犧牲離線快取換穩定
  - BroadcastChannel 是標準 API，但 Safari 15.4+ 才全面支援，需 typeof 檢查

### 2026-04-17 — 用戶資料卡片頁加毛玻璃遮蔽（節省 Firestore 自動讀取）
- **目標**：看別人名片預設自動拉 activityRecords + achievement subcollection（100-400 reads/次），成本隨用戶數線性成長；改為點擊才載入
- **設計決策**：
  - 自己/別人都遮，文字不同（isSelf 提示「本次進入需重新載入」）
  - 徽章與活動紀錄都遮（但 isSelf 徽章例外，本地 cache 同步計算即可）
  - 無中央按鈕，文字提示「點擊任一處載入」
  - 只有需額外讀取才遮（用 `FirebaseService.getUserStatsCache().uid` 與 `_userAchievementProgressUid` 判斷，不建額外 set）
- **實作（commit 6ba99723，版號 20260417b）**：
  - `profile-core.js showUserProfile`：加 cache 命中判斷 + 動態遮蔽 HTML，移除自動 await ensureUserStatsLoaded
  - `profile-core.js` 新增 `_loadUserCardUncovered(uid)`：遮蔽點擊觸發，並行載入 stats + badges，完成後移除遮蔽
  - `profile.css` 新增 `.uc-blur-overlay` 樣式（CLAUDE.md 毛玻璃規範：blur(10px) + webkit 前綴 + rgba(0,0,0,.35) + radius + shadow；含 `@supports not (backdrop-filter)` fallback 用 rgba(0,0,0,.72) 為舊 Android WebView 降級）
- **保護機制**：
  - `_userCardLoading` flag 防連點
  - `currentPage === 'page-user-card'` guard 防跨頁 DOM 競態
  - 錯誤時遮蔽文字改「載入失敗，點擊重試」
  - `targetUid` null guard（資料未同步時不遮直接走原流程）
- **審計通過**：
  - `npm run test:unit` 全過（51 suites / 2169 tests）— **吸取 B' 階段漏跑測試的教訓**
  - `node --check` profile-core.js 語法 OK
  - 不動鎖定函式（`_calcScanStats` / `ensureUserStatsLoaded`）
  - 不動自己的 `#page-profile`（原本 `_userStatsCache` 機制保留）
  - 不衝突 B' smoke test（B' 用 Admin SDK 直查 Firestore，不依賴 UI）
- **未來潛在擴展**：
  - 可延伸到 `#page-profile`（自己的 profile）
  - 可加「顯示為 DNS 預拉」（hover 就 prefetch，點擊時瞬間顯示）
  - 若用戶反映太煩人，可加「記住偏好」選項 persist 到 localStorage

### [永久] 2026-04-17 — B' 階段治本：修 cancelRegistration / cancelCompanionRegistrations 遞補漏同步 activityRecord（部署完成、smoke test 待驗）
- **問題**：A' 階段 backfill 了 93 位用戶 110 筆異常資料，但寫入路徑未修，未來新的取消+遞補會持續產生新異常
- **根因**：`cancelRegistration` 與 `cancelCompanionRegistrations` 在候補遞補時，只改 `registrations.status=confirmed`，漏改對應 `activityRecord.status`（保持 waitlisted）
- **修復（commit 76336d57，版號 20260417a）**：
  - 兩個鎖定函式各加三處：
    1. Firestore 查詢該活動所有 activityRecords（避免本地 onSnapshot limit 漏資料）
    2. batch 加 `activityRecord.status=registered`
    3. commit 成功後同步本地快取
  - 同行者 `participantType='companion'` 排除處理（不產生 activityRecord）
  - 找不到對應 activityRecord 時 `console.warn`（不靜默漏修）
  - 處理歷史重複資料（filter 全部 matched 而非 find 第一筆）
- **審計通過**：
  - 符合 CLAUDE.md 報名系統保護規則 13 條全部
  - 與既有 `_adjustWaitlistOnCapacityChange` 模式一致
  - Firestore rules L1488-1499 `isSubActivityStatusOnly()` 允許此寫入
  - 12 個劇本自我模擬測試全過（正常遞補、取消候補不遞補、取消正取無候補、candidate 是同行者、activityRecord 找不到、並發取消、cross-event 取消、companion 取消不遞補、退化測試、Firestore 查詢失敗、活動已 ended、空 activityRecords）
  - 5+ 輪審計找到 14 個瑕疵全部修訂
- **未完成待辦（T+24h 之後執行，約 2026-04-18 10:00 後）**：
  - [ ] Smoke test：建測試活動容量 2 → 3 人報名（2 正 1 補）→ 取消 1 正取 → Admin SDK 查候補者 `activityRecord.status` 是否變 `registered`
  - [ ] 重跑稽核腳本 `scripts/_audit-bug-ab.js`（仍在主 repo，已寫好），預期 0 筆異常
  - [ ] 若有殘餘異常（A'→修 bug 之間累積，預期 < 10）→ 用 Admin SDK patch
  - [ ] 清理 `scripts/_audit-bug-ab.js` 和 `scripts/_audit-bug-ab-result.json`
  - [ ] 若稽核通過，在此條目末尾加「驗證完成」註記
- **失敗處理策略**：不使用 `git revert`（會搞亂版號一致性），改用 forward-fix 寫新 commit 撤銷錯誤行為
- **未修範圍（非本次任務）**：
  - Bug #C（取消自己的 activityRecord，目前 UI 層已處理）
  - Bug #D（現場補位未建 registration/activityRecord，需業務決策）
  - A' 中 7 筆 `cancelled → registered` + 1 筆 `removed → registered`（成因不同）
  - 21 筆 `reg=confirmed 缺 act`（UI 層 addActivityRecord 某時漏跑，另案調查）
- **長期改善建議**：把 activityRecord 寫入統一收進 CRUD 層（目前由 UI 層寫），避免未來再出現寫入不對稱的 bug。需大範圍重構，留待專門任務
- **教訓**：
  - 寫入路徑不對稱是資料完整性的最大敵人——`registrations` 和 `activityRecords` 成對寫入必須在同一 batch
  - 架構上 activityRecord 由 UI 層寫、CRUD 層不寫，讓 CRUD 的遞補路徑容易漏寫衍生資料
  - 遞補路徑有多處（取消觸發、容量變更觸發、管理員手動）需逐一檢查，不能假設「修了 cancelRegistration 就 OK」
  - **自我審計必須包含 `npm run test:unit`**——B' 階段做了 50+ 視角審計卻漏掉這個最基本的關卡，造成 commit 76336d57 後才被用戶發現 `migration-path-coverage.test.js` 失敗（新增 4 處 `.collection('activityRecords')` 未更新 KNOWN_REFERENCES 白名單）。後續以 commit 修復測試並補 `docs/stateful-imagining-dahl.md` 的 migration plan 備註。未來鎖定函式修改必跑 unit tests 作為審計的必要步驟
- **監測指標**（觀察 24 小時內）：
  - `console.warn` 含 `[cancelRegistration] no waitlisted activityRecord found` → 歷史特殊資料，可追蹤但非新 bug
  - `console.error` 含 `activityRecords query failed` → Firestore 問題，需立刻處理
  - 取消報名功能的 error rate

### [永久] 2026-04-17 — 全站簽到資料修復：候補遞補 status 未同步 + activityRecord 衍生資料漏寫
- **問題**：93 位用戶有 checkin+checkout 紀錄但個人頁應到/完成顯示 0；資料不完整率 10.9%（1006 個 checkin 組合中 110 筆異常）
- **調查**：以 Admin SDK 全站稽核 `collectionGroup('attendanceRecords').where('type','==','checkin')` 交叉比對 `registrations` + `activityRecords`
- **兩種資料不一致模式**：
  - Bug 1（63 筆）：有 activityRecord 但 status 未同步 — 55 筆 waitlisted（候補遞補路徑漏改）、7 筆 cancelled、1 筆 removed
  - Bug 2（47 筆）：有 checkin 但完全缺 activityRecord — 21 筆 `reg=confirmed` 衍生資料漏寫、26 筆 `reg=(缺)` 多為 Phase 4b 前老資料或手動掃碼簽到流程
- **修復**：全站 patch activityRecord 子集合，Bug 1 統一改 status=registered，Bug 2 補建 activityRecord（schema: eventId / name / date / status / uid / eventType / createdAt）
- **驗證**：patch 後重跑稽核 0 筆異常；目標 UID `Ud822a6c5a...` 從 應到0/完成0 → 應到2/完成2、出席率 100%
- **教訓**：
  - `registrations` 是權威但 `activityRecords` 是前端統計依賴的衍生資料，寫入路徑有多處不對稱 → 必須在寫入路徑統一兩者狀態轉換（candidate 遞補、取消重報、removed 等 edge case）
  - 全站稽核腳本用 `collectionGroup + parent.parent !== null` 過濾子集合是 Phase 4b 後的必備模式
  - 邊界案例（cancelled/removed 有 checkin）反映業務流程（現場補位、取消後反悔）在資料模型沒有對應狀態 → B′ 階段需考慮新增中間狀態或明確業務規則
- **B′ 待辦（未完成，下次觸碰報名系統時一起做）**：
  - code review `js/firebase-crud.js` 的 `cancelRegistration` 遞補路徑、`batchRegisterForEvent` 衍生寫入、`registerForEvent` status 轉換
  - code review `js/modules/event/event-create-waitlist.js` 的 `_adjustWaitlistOnCapacityChange` / `_promoteSingleCandidateLocal` / `_getPromotedArDocIds` 候補遞補是否正確同步 activityRecord
  - 評估是否需要定期稽核 Cloud Function 當防線（類似 `calcNoShowCounts` 的做法）

### 2026-04-17 — 個人頁統計與報名紀錄首次進場顯示 0
- **問題**：用戶有報名、簽到、簽退紀錄，但個人頁四格統計（應到/完成/出席率）與報名紀錄 tab 首次進場顯示為 0 或空白；反覆切頁或手動刷新才會正確
- **原因**：`renderActivityRecords` / `renderProfileData` 在 `_userStatsCache` 未 ready 時直接把 `_calcScanStats(uid)` 的結果（0）寫入 DOM。`ensureUserStatsLoaded` 是 async collectionGroup 查詢，頁面先渲染、cache 後到位；fallback 讀 `_src('activityRecords')` 的根集合快取（Phase 4b 遷移後已凍結、無 onSnapshot 維護）回傳空陣列。完成後亦無 re-render 觸發機制
- **修復**：
  - `profile-data-render.js` `renderProfileData`：4 格統計加 `statsReady` 檢查，未 ready 顯示 `--`
  - `leaderboard.js` `renderActivityRecords`：cache 未 ready 時顯示「載入紀錄中...」+ stats `--`，並背景觸發 `ensureUserStatsLoaded(uid).then` 完成後於 `page-profile` 自動重繪
  - 未動任何鎖定函式（`_calcScanStats / _categorizeRecords / getParticipantAttendanceStats / ensureUserStatsLoaded` 保持原狀）
- **教訓**：
  - `renderUserCardRecords`（看別人名片）早已有 `statsReady` 檢查顯示 `--`，自己的 profile 路徑缺失，造成不對稱 bug
  - Async 資料載入後若缺 re-render 觸發，用戶會卡在初始值；fire-and-forget + `then(() => currentPage === X && re-render)` 是可重用修法
  - 架構級根治方案為後端預算寫入 user doc（比照 `calcNoShowCounts`），已規劃為下一階段任務（含 UI 毛玻璃遮蔽 + 手動刷新按鈕設計）

### 2026-04-15 — 俱樂部加入申請審核「找不到此俱樂部」
- **問題**：職員從訊息頁審核俱樂部加入申請時顯示「找不到此俱樂部」，但從俱樂部頁進入則正常
- **原因**：兩個 bug 疊加 — (1) `message-actions-team.js` 的 fallback `ensureCollectionsForPage('page-teams', {skipRealtimeStart:true})` 是死路（teams 在 `_pageScopedRealtimeMap` 中被排除靜態載入，同時 skipRealtimeStart 又不啟動即時監聽） (2) `firebase-service.js` init 中 `_teamSlices`/`_tournamentSlices` 的 `injected` 仍為 `new Set()`（Phase 2B 文件記載要改 Array 但 init 遺漏），導致 `fetchTeamIfMissing` 呼叫 `.findIndex()` 時 TypeError 靜默回傳 null
- **修復**：`message-actions-team.js` 改用 `getTeamAsync(teamId)`（cache-first + Firestore 單筆補查）；`firebase-service.js` init 中 `injected: new Set()` → `injected: []`
- **教訓**：Phase 2B 重構改了消費端但遺漏 init 初始化，Set/Array 不匹配被 try/catch 靜默吞掉不報錯

### [永久] 2026-04-14 — 首次登入個人資料強制填寫修復（Plan B + Plan C）
- **問題**：18.7% 用戶（127/678）資料不完整。根因：首登表單依賴 ScriptLoader 載入 48 個不相關 script，網路差時 3 次重試全失敗後靜默放棄
- **修復**：
  - Plan B：首登表單 HTML 內聯到 index.html，完全移除 ScriptLoader 依賴。表單從 modals.html 移除避免重複 DOM
  - Plan B：`saveFirstLoginProfile` 改用 `updateCurrentUserAwait`（async await），存檔失敗不關 modal 讓用戶重試
  - Plan B：`navigation.js _tryShowFirstLoginModal` 同步簡化（移除 ScriptLoader）
  - Plan C：`functions/index.js registerForEvent` 加入 `PROFILE_INCOMPLETE` 前置檢查（gender + birthday + region 三欄一致）
  - Plan C：`firebase-crud.js registerForEvent / batchRegisterForEvent` 前端 pre-check（鎖定函式，僅 pre-check 不觸碰 transaction）
  - Plan C：`event-detail-signup.js / event-detail-companion.js` 攔截 PROFILE_INCOMPLETE 錯誤 → 自動彈出首登表單
- **教訓**：
  - `updateCurrentUser` 是 fire-and-forget，關鍵資料存檔必須用 `updateCurrentUserAwait`
  - 首登表單只需 ~160 行 JS + ~30 行 HTML，不應該依賴 48 script 的 ScriptLoader 鏈
  - CF 路徑目前 0% 流量（feature flag 關閉），前端 pre-check 才是實際有效的防線

### [永久] 2026-04-14 — 俱樂部×賽事重構完成總結（Phase 0-3 + Phase 4）— 全計畫結案
- **範圍**：6 個 Phase、9 個 commit、14 個新建檔案、30+ 個修改檔案
- **架構成果**：
  - per-entity 專看專讀（fetchIfMissing + injected 桶 + onSnapshot 合併保護）
  - ID 統一（新建俱樂部/賽事 doc.id === data.id，events 維持雙軌）
  - 教練 UID 化（coaches[]名字 → coachUids[] UID + coachNames[] 顯示快取）
  - 內嵌陣列移除（賽事 teamApplications/teamEntries → 純子集合，registeredTeams 保留）
  - 權限強化（feed 雙層守衛 + delegateUids 擴權防護 + 賽事操作拆分 + feed create 收緊）
  - 效能優化（分頁 + 防抖 + 指紋跳過 + 即時監聯 + 捲動保存）
  - CF 級聯更新（onTeamUpdate：俱樂部改名/圖自動同步賽事 hostTeamName/hostTeamImage）
- **部署狀態**（2026-04-14 全部完成）：
  - ✅ 遷移腳本已執行：5 俱樂部全部 coachUids 已就位，0 未匹配
  - ✅ Firestore Rules 已部署：`isCurrentUserTeamStaff` + feed create 收緊
  - ✅ Cloud Functions 已部署：`onTeamUpdate`（新建）+ `eduCheckin`（更新）
  - ✅ 前端已部署（版號 `20260414f`）
- **待補（非 blocking，UX 增強）**：8.2D 載入進度條、§7.10 深連結 pre-auth REST
- **定時清理提醒**：
  - 2026-05-14 後可移除賽事內嵌陣列 fallback 讀取路徑（tournament-friendly-state.js L70-71, tournament-friendly-roster.js L81, tournament-detail.js L340-341, tournament-friendly-detail-view.js L144, tournament-friendly-roster.js L318）
  - 2026-05-14 後可移除 Firestore 中舊賽事文件的 `teamApplications`/`teamEntries` 欄位
- **計畫書**：`docs/specs/team-tournament-refactor-plan.md` v3.0（所有 Phase checklist 已打勾）

### [永久] 2026-04-14 — coachUids 欄位遷移（教練 UID 化）
- **問題**：教練以名字（`coaches[]`）儲存，同名用戶會碰撞，且 Firestore Rules 無法驗證教練身分
- **修復**：
  - 新增 `coachUids[]` 欄位（UID 陣列），`coachNames[]` 做顯示快取，舊 `coaches[]` 保留不刪
  - 遷移腳本 `scripts/migrate-team-uids.js`（名字→UID，冪等，同名標記模糊不自動分配，支援 `--dry-run`）
  - Firestore Rules 新增 `isCurrentUserTeamStaff` 函式（隊長+領隊+教練超集），**不改名** `isCurrentUserTeamCaptainOrLeader`（11 處引用不動，避免教練靜默獲得賽事建立等權限）
  - 前端 17 個函式移除名字 fallback，改用純 UID 比對
  - CF `eduCheckin` / `registerForEvent` 改用 `coachUids` 比對
  - Team form 儲存時同步寫入 `coachUids`/`coachNames`/`captainName`/`leaderNames`
- **Firestore Rules 函式使用對照表**（新增教練權限後的最終狀態）：
  - `isCurrentUserTeamCaptainOrLeader`：groups CRUD、tournaments create、tournaments/applications create（**不含教練**）
  - `isCurrentUserTeamStaff`：feed update/delete、coursePlans CRUD + enrollments、students create/update/delete（**含教練**）
  - `isCurrentUserInTeam`：feed create（成員即可發文）
- **教訓**：
  - `isCurrentUserTeamStaff` 只用在明確需要教練權限的地方（feed 管理、課程、學員）
  - 教育分組（groups）、賽事建立（tournaments create）、賽事申請仍用 `isCurrentUserTeamCaptainOrLeader`（不含教練）
  - 未匹配教練 = 0 才可部署前端（否則教練永久失去權限）
  - `coachUids` 在 Rules 中使用前必須加 `is list` 型別檢查（未遷移的 team 可能沒有此欄位）
  - 退隊時只需移除 `coachUids` 中的 uid，`coachNames` 為顯示快取不需嚴格同步

### 2026-04-14 — 俱樂部×賽事重構 Phase 3：資料架構遷移（已部署）
- **目標**：賽事內嵌陣列移除 + Cloud Function 級聯更新 + 教練 UID 化 + feed 規則收緊
- **執行內容**：
  - §9.1 賽事內嵌陣列移除：`_syncFriendlyTournamentCacheRecord` / `_persistFriendlyTournamentCompatState` / `_buildFriendlyTournamentRecord` 不再產生/寫入 `teamApplications`/`teamEntries`，只保留 `registeredTeams`。賽事建立/編輯改寫 entries 子集合
  - §9.2 `onTeamUpdate` CF（已部署 asia-east1）：v2 API，team.name/image 變更時級聯更新 hostTeamName/hostTeamImage。僅處理 `hostTeamId` 引用，entries 子集合的 teamName/teamImage 不在此 CF 範圍（需另行手動或前端同步）
  - §11.4-11.6 教練 UID 化（已部署）：見上方 [永久] 條目。遷移腳本已執行完畢，5 俱樂部全部匹配成功
  - §5.2 feed create 收緊為 `isCurrentUserInTeam(teamId)`（Firestore Rules 已部署）
  - feed update/delete 改用 `isCurrentUserTeamStaff`（含教練，已部署）
  - coursePlans / students 子集合規則改用 `isCurrentUserTeamStaff`（教練可管理課程/學員，已部署）
- **實際修改超出計畫的部分**：計畫列 9 個前端函式，實際修改 17 個（額外 8 個在 api-service.js、message-actions-team.js、event-list-helpers.js、team-detail.js、team-form-roles.js、team-form-join.js、team-form.js、team-form-validate.js 中也有名字比對邏輯需同步遷移）
- **影響範圍**：tournament-friendly-state.js、tournament-core.js、tournament-friendly-roster.js、tournament-manage.js、tournament-manage-edit.js、team-list-helpers.js、team-detail.js、team-form.js、team-form-validate.js、team-form-roles.js、team-form-join.js、tournament-helpers.js、tournament-friendly-notify.js、event-list-helpers.js、message-actions-team.js、api-service.js、firestore.rules、functions/index.js
- **注意事項**：
  - `registeredTeams[]` 仍保留在賽事文件中（輕量 ID 陣列，快速判斷參賽狀態）
  - 舊賽事 Firestore 文件中的 `teamApplications`/`teamEntries` 欄位未刪除（僅停止寫入），2026-05-14 後可清理
  - 前端 fallback 讀取路徑（`base.teamApplications`/`base.teamEntries`）保留 30 天，2026-05-14 後可移除
  - `onTeamUpdate` CF 只監聽 `teams/{teamId}` 文件的 name/image 變更，不處理 entries 子集合內的 teamName/teamImage

### 2026-04-14 — 俱樂部×賽事重構 Phase 2B：列表效能優化
- **目標**：俱樂部/賽事列表頁效能優化 + 動態牆走 ApiService + 前端權限守衛
- **執行內容**：
  - §8.1 分頁機制：`firebase-service.js` 擴充 `_teamSlices: { active:[], injected:[] }`（原 Phase 2A 的 `{ injected: new Set() }`），`_buildCollectionQuery` teams/tournaments 改 `orderBy('createdAt','desc').limit(50/100)`，新增 `loadMoreTeams()` / `loadMoreTournaments()` cursor-based 分頁，`_loadStaticCollections` 新增 cursor 捕捉
  - §8.2 渲染優化：`team-list.js` 搜尋防抖 300ms + `searchTeamsFromServer()` 全集合搜尋按鈕，`team-list-render.js` 指紋跳過重繪（`_teamListLastFp`），`tournament-render.js` 搜尋防抖 + 指紋跳過（`_tournamentListLastFp`）+ 捲動保存 + `searchTournamentsFromServer()`
  - §8.3 即時監聽：`config.js` 新增 `teamLimit:50` / `tournamentLimit:100`，`PAGE_DATA_CONTRACT` page-teams/page-tournaments 加入 `realtime`，`firebase-service.js` 新增 `_startTeamsRealtimeListener` / `_startTournamentsRealtimeListener` + stop/reconnect，`_mergeTeamSlices` / `_mergeTournamentSlices` 合併 active + injected（防 onSnapshot 洗掉冷門俱樂部），`fetchTeamIfMissing` 改為 push 完整 team 物件到 `injected[]`（原 Set.add(id)），整合 `_startPageScopedRealtimeForPage` / `finalizePageScopedRealtimeForPage` / `destroy`
  - §8.4 team-feed.js 走 ApiService：`firebase-crud.js` 新增 8 個 Team Feed CRUD 函式，`api-service.js` 新增對應封裝 + audit log，`team-feed.js` 全面改用 ApiService
  - §12.4B Feed 前端權限守衛：`team-feed.js` 新增 `_canDeleteTeamFeedPost` / `_canPinTeamFeedPost` / `_canPostTeamFeed` / `_canDeleteTeamFeedComment`，per-team 角色 + `team.manage_all` 管理員 override 雙層模式
- **教訓**：`_teamSlices.injected` 從 `Set<id>` 改為 `Array<object>` 是必要的，因為 onSnapshot 替換 active 後需要完整物件才能合併回 `_cache.teams`。loadMore 結果也放入 injected 桶保護，避免下次 onSnapshot 洗掉。

### 2026-04-14 — 俱樂部×賽事重構 Phase 4：表單拆分 + 教育解耦
- **目標**：降低 team-form.js / tournament-friendly-detail.js 的單檔複雜度，解耦教育型俱樂部的 if 散落
- **執行內容**：
  - §10.1 `team-form.js`（393→155 行）拆分為 `team-form-validate.js`（表單驗證 + 值提取）+ `team-form-roles.js`（降級預覽 + 自動升降級/通知）+ 瘦身後的 `team-form.js`（資料組裝 + 儲存 + 日誌）
  - §10.2 教育解耦：`team-list-helpers.js` 新增 `_getTeamTypeHandler(type)` + `_getEduStudentCount(teamId)`，4 處 `if (type === 'education')` 改為呼叫 handler（team-detail.js / team-form-join.js / team-list-render.js / team-form-init.js）
  - §10.3 `tournament-friendly-detail.js`（368→216 行）拆出 `tournament-friendly-state.js`（5 個狀態管理函式 + _isTournamentViewerInTeam），detail 只留 3 個渲染/操作函式
  - `script-loader.js` 新增 3 個檔案載入（validate/roles 在 form 之前、state 在 detail 之前）
  - `docs/architecture.md` 更新模組數（team 14→16、tournament 14→15）
- **教訓**：Object.assign 載入順序很重要 — validate/roles 必須在 form 之前載入，否則 handleSaveTeam 呼叫時函式尚未掛載

### [永久] 2026-04-14 — 俱樂部×賽事重構 Phase 2A：專看專讀 per-entity 架構 + ID 統一建立流程
- **目標**：深連結看 1 個俱樂部/賽事從 200-600 reads 降至 1 read；消除俱樂部/賽事的雙軌 ID
- **執行內容**：
  - `firebase-service.js` 新增 `fetchTeamIfMissing()` / `fetchTournamentIfMissing()`（cache-first → `.doc().get()` → `.where('id','==').limit(1)` 三層 fallback），注入快取時寫 `_teamSlices.injected` / `_tournamentSlices.injected`（Phase 2B onSnapshot 保護用）
  - `api-service.js` 新增 `getTeamAsync()` / `getTournamentAsync()`（同步快取 + Firestore fallback）
  - `team-detail.js` / `tournament-detail.js` / `tournament-friendly-detail.js` 詳情頁接入 async fallback
  - `app.js` 深連結 team/tournament 區塊改為 cache miss 時直接查 1 筆，不等全集合
  - `config.js` `PAGE_DATA_CONTRACT` 詳情頁 required → optional（不阻塞等全集合）
  - `firebase-crud.js` `_getTournamentDocRefById` fallback 成功時注入快取
  - `firebase-crud.js` `addTeam` / `addTournament` 改用 `.doc(customId).set()`（`data.id === data._docId`，消除雙軌 ID）
  - `tournament-manage.js` 賽事操作拆分：`handleEndTournament` 用 `admin.tournaments.end` + `_canManageTournamentRecord` fallback，`handleReopenTournament` / `handleDeleteTournament` 各用獨立權限碼（僅管理員）
- **教訓**：
  - 俱樂部/賽事新建後 `data.id === data._docId`（單軌），但既有歷史資料仍可能 `id ≠ _docId`，所以 `fetchIfMissing` 必須保留 `.where('id','==')` fallback
  - `_teamSlices.injected` 在 init 時需重設為空 Set，避免跨會話殘留
  - 活動（events）的 `addEvent` 不動（歷史資料量大 + 子集合遷移剛完成）

### 2026-04-14 — 俱樂部×賽事重構 Phase 1a：俱樂部結構整理
- **目標**：拆分過大的 team-list.js（305→179 行）與 team-share.js（190→84 行），建立唯一真相來源
- **執行內容**：
  - 新建 `team-list-helpers.js`（178 行）— 12 個身分解析/權限函式 + `_canManageTeamMembers`（從 team-detail.js）+ `_applyRoleChange`（從 team-form-join.js）
  - 新建 `team-list-stats.js`（50 行）— `_calcTeamMemberCountByTeam` / `_calcTeamMemberCount` / `_getTeamRank` / `_sortTeams`
  - 新建 `team-share-builders.js`（102 行）— `_buildTeamLiffUrl` / `_buildTeamShareAltText` / `_buildTeamFlexMessage`
  - 改名 `team-detail-members.js` → `team-detail-invite.js`
  - 搬移錯放函式：`removeTeam` → team-list.js / `_applyRoleChange` → team-list-helpers.js / `_initTeamListSportFilter` → team-list-render.js
  - 刪除 2 處 inline fallback（team-detail.js / team-form-join.js），改為呼叫 `_calcTeamMemberCount`
  - 更新 script-loader.js 載入順序：helpers → stats → list → render
  - 更新測試引用 + source-drift 註解
- **教訓**：§6.0C 的 ≤80 行目標未考慮 `removeTeam`（46 行）搬入 team-list.js，實際結果 179 行但已達到結構分離目的

### [永久] 2026-04-14 — 俱樂部×賽事重構 Phase 0：安全性修復（Firestore Rules + 索引）
- **問題**：三處安全漏洞 — (1) 賽事 entries/members 公開讀取（未登入可讀取所有參賽者 UID/姓名）(2) 動態牆任何登入用戶可刪改他人貼文 (3) 賽事委託人可自我擴權（修改 delegateUids 新增其他委託人）
- **修復**：
  - `firestore.rules` entries/members `allow read: if true` → `if isAuth()`
  - `firestore.rules` feed update/delete 加 `uid == auth.uid || isCurrentUserTeamCaptainOrLeader`（create 暫不收緊，等 Phase 3 ID 統一後再處理）
  - 新增 `delegateUidsUnchangedOrCreator()` 函式 — 只有建立者（`creatorUid`）和管理員可修改 `delegateUids`
  - `firestore.indexes.json` 新增 teams + tournaments 的 `creatorUid + createdAt` 複合索引
- **教訓**：
  - feed create 不能用 `isCurrentUserInTeam(teamId)` 收緊 — `teamId` 來自 Firestore 路徑是 doc.id，但 `users.teamIds` 存的是自訂 ID，對舊俱樂部（doc.id ≠ data.id）會擋住合法成員
  - `delegateUids` 不能設為完全不可變（immutable），因為賽事建立者通常是隊長而非管理員，需要能管理自己的委託人

### 2026-04-13 — 舊活動簽到/報名紀錄不顯示 — 全站監聯器 limit 截斷 + 極簡補查
- **問題**：全站監聽器 `collectionGroup.limit(1500)` + dedup 後實際只有 ~750 筆快取，舊活動的簽到/報名紀錄被截斷，詳情頁顯示空白
- **調查過程**：經四輪專家審計（13 個 MUST FIX）設計出 per-event listener + Feature Flag 完整方案（v5），但第五輪極簡挑戰 + 7 位專家 7-0 投票後決定採用極簡方案
- **修復**：`fetchAttendanceIfMissing` + `fetchRegistrationsIfMissing` — 快取有資料直接 return（零成本），沒有就從子集合查一次 merge 進快取。15 行 / 2 檔案
- **教訓**：舊活動資料是凍結的靜態資料，不需要即時監聽。用 80 行 + Feature Flag 解決 15 行能解決的問題是過度工程。完整方案保留在 `docs/attendance-listener-optimization.md` 作為決策參考

### 2026-04-13 — 圖片載入優化（淡入 + 預解碼 + 品牌圖壓縮 + Banner 預載）
- **問題**：圖片從「無」到「有」的閃現衝擊
- **修復**：`img { opacity:0 }` + `img.decode()` 預解碼後才淡入 + 開機品牌圖壓縮 96%（1198KB→49KB WebP）+ 輪播 Banner `new Image().decode()` 預載
- **教訓**：`img.decode()` 在 load 事件後呼叫確保完全解碼；`.img-loaded` 不可加 `transition:none`（會取消淡入）；開機 LOGO 需覆寫全局 `opacity:0`

### 2026-04-13 — CF 報名成功後按鈕閃爍 — 樂觀補入 registration
- **問題**：CF 路徑報名成功後，翻牌動畫結束時 `_refreshSignupButton` 讀到空快取，按鈕短暫閃回「報名」
- **修復**：CF 成功後立即 push 一筆樂觀 registration 到 `_cache.registrations`，snapshot 到達後整批覆蓋
- **教訓**：CF 路徑的樂觀更新只更新 event 欄位，必須同時更新 registration 快取

### 2026-04-13 — 活動詳情頁局部更新機制 + 跳頂修復 + 回歸修正
- **問題 1（跳頂）**：報名/取消後頁面跳回頂部。經 6 次嘗試，前 5 次（scroll 保護、showPage 跳過、高度鎖定等）全部無效
- **根因**：`showEventDetail` 的 `innerHTML` 全頁替換無論如何都會丟失 scroll
- **修復**：改為局部 DOM 更新——`_refreshSignupButton`（按鈕）+ `_patchDetailCount`（人數）+ `_patchDetailTables`（名單），不做全頁重繪
- **問題 2（被拉回）**：刷新後切頁會被拉回原頁。根因是 `showEventDetail` async 函式在 await 期間用戶已離開，但 `showPage` 仍執行。修復：在 `showPage` 前加 `requestSeq` stale 檢查
- **問題 3（回歸）**：局部更新遺漏性別限定按鈕 + 人數不更新。修復：`_refreshSignupButton` 涵蓋全部 8 種按鈕狀態；`_patchDetailCount` 修正 DOM 選取（text node 非 span）
- **教訓**：全頁 innerHTML 替換在 SPA 中必然丟失 scroll，局部 DOM patch 是唯一可靠解法。局部更新函式必須覆蓋原始全頁渲染的所有分支，否則產生回歸

### 2026-04-13 — 活動詳情頁報名狀態偶發性錯誤 — collectionGroup 監聽器首次 snapshot 競態
- **問題**：用戶已報名成功但開啟活動頁面偶爾顯示「報名/候補」按鈕。原因是 Phase 3 切換到 collectionGroup 監聽器後，首次 snapshot 到達前快取為空，頁面依空快取渲染為未報名
- **修復**：`event-detail.js showEventDetail()` 新增安全網——當快取判定「未報名」時，直接對子集合做 `get({source:'server'})` 查詢確認，若已報名則補入快取並重新渲染
- **教訓**：從根集合切到 collectionGroup 後，首次 snapshot 延遲可能更長，讀取路徑切換時必須為「快取未就緒」狀態加 fallback 查詢

### 2026-04-12 — Phase 4a+4b 完成：CF 觸發器遷移 + 寫入路徑翻轉
- **問題**：Phase 3 完成後，讀取已切到子集合，但寫入仍雙寫（根+子集合），CF 觸發器仍監聽根集合
- **修復**：
  - Phase 4a：`watchRegistrationsChanges` / `watchAttendanceChanges` document path 改為子集合路徑
  - Phase 4b 步驟 1：LOCKED 函式（`_doRegisterForEvent`、`batchRegisterForEvent`、`cancelRegistration`、`cancelCompanionRegistrations`）+ CF `registerForEvent` / `cancelRegistration` 的根集合 ref 改為子集合 ref
  - Phase 4b 步驟 2：所有一般寫入（`addAttendanceRecord`、`removeAttendanceRecord`、`batchWriteAttendance`、`displayBadges` 等 15 個檔案）根集合 ref 改為子集合 ref
  - Phase 4b 步驟 3：移除所有 `[dual-write]` 區塊（38 個雙寫區塊）；`_getEventDocIdAsync` 從 try-catch 提升為主路徑必要呼叫，null 時 throw
  - 測試：`KNOWN_REFERENCES` / `KNOWN_CF_REFERENCES` / `KNOWN_CF_TRIGGERS` 全部更新；4330 tests passed
- **教訓**：regex `.collection('registrations')` 會同時匹配根集合和子集合鏈中的引用，更新 allowlist 時需用實際計數

### 2026-04-12 — Phase 3 完成：子集合讀取路徑切換
- **問題**：Phase 0-2 完成後，讀取仍走根集合。需切換全部讀取路徑到子集合/collectionGroup
- **修復**：
  - Phase 3a（16 處）：per-event 查詢改子集合直接查詢（firebase-crud.js 4 處、6 個 event modules、api-service.js、CF 3 處）
  - Phase 3b（12+ 處）：監聽器改 collectionGroup + 去重過濾、跨活動查詢改 collectionGroup（firebase-service.js 7 處、achievement-batch/attendance-notify/event-host-list/app.js、CF calcNoShowCountsBatch+backfillAutoExp 7 處）
  - Phase 3c：移除 per-event cache workaround（_eventAttendanceMap/fetchAttendanceRecordsForEvent）
- **教訓**：collectionGroup 去重（`doc.ref.parent.parent !== null`）是 Phase 3b 最關鍵步驟，漏加會導致資料 2x。CF 用 Admin SDK 需改用 `d.ref.path.split('/').length > 2`
- **下一步**：觀察期 3-7 天，確認無異常後進 Phase 4（移除雙寫 + 遷移觸發器）

### 2026-04-12 — Phase 1 完成：子集合雙寫層（49 個寫入點）
- **問題**：Phase 0 基礎設施已部署，需實作雙寫層讓所有寫入同時寫全域集合 + 子集合
- **修復**：16 個檔案新增雙寫邏輯（firebase-crud.js 11 點、8 個 event modules 30 點、achievement-batch+app 2 點、CF registerForEvent+cancelRegistration 6 點）
- **關鍵修正**：計劃書原稱 KNOWN_REFERENCES 不需更新，但 migration-path-coverage 的 regex 會匹配子集合鏈中的 `.collection('registrations')`，所有計數必須同步更新
- **教訓**：CF 行號因 Phase 0 新增 migrateToSubcollections 而偏移 ~300 行，實作時需以程式碼搜尋為準而非計劃書行號

### 2026-04-12 — 子集合遷移計劃書 v5 + 自動化測試安全網
- **問題**：Firestore 全域集合遷移到子集合的計劃書經 5 輪審計（33 處修正），需在實作前建立測試安全網
- **修復**：新增 4 個測試檔 + 1 個驗證腳本（migration-path-coverage 6 tests、subcollection-utils 22 tests、subcollection-rules 16 tests、migration-verify.js 4 階段驗證）
- **教訓**：遷移路徑覆蓋率測試可自動偵測新增的 db.collection() 引用是否在遷移計劃涵蓋範圍內；Emulator 測試必須顯示 skip 而非靜默 pass

### 2026-04-11 — [永久] calcNoShowCounts doc.id vs data.id 錯配 — 全站放鴿子算出 0
- **問題**：Cloud Function `calcNoShowCounts` 部署後計算出全站 0 次放鴿子，users 文件的 `noShowCount` 始終為 undefined
- **原因**：events 集合的 Firestore 文件 ID（`doc.id`，如 `ga0CqtaPpjRwimUGEZfU`）與活動自訂 ID（`data.id`，如 `ce_1774920121549_j63p`）**不同**。CF 用 `doc.id` 建 `endedEventIds`，但 `registrations.eventId` 存的是 `data.id`，`endedEventIds.has(reg.eventId)` 永遠 false → 所有報名都被 skip → 0 次放鴿子
- **修復**：`endedEventIds.add(data.id || doc.id)` + `.select()` 加入 `"id"` 欄位
- **教訓**：見下方 [永久] events 雙 ID 地雷

### 2026-04-10 — [永久] 放鴿子統計改為後端預算（Cloud Function calcNoShowCounts）
- **問題**：放鴿子次數在前端即時計算，依賴全域 attendanceRecords 快取（有 onSnapshot limit），超出 limit 的舊活動 checkin 紀錄被截斷，導致有簽到的用戶仍被誤判為放鴿子
- **原因**：`_buildRawNoShowCountByUid()` 呼叫 `getAttendanceRecords()` 無 eventId，走全域快取，受 limit 截斷
- **修復**：
  - Cloud Function `calcNoShowCounts`（排程每小時正點）+ `calcNoShowCountsManual`（callable 手動觸發）
  - 後端直接查 Firestore（無 limit）：已結束活動 + confirmed 報名 + 無 checkin → 計為放鴿子
  - 結果寫入 users 文件的 `noShowCount` 欄位
  - 前端 `_buildRawNoShowCountByUid` 改為從 users 快取讀取，不再跨集合即時算
  - 管理後台「系統資料同步」新增「⑧ 放鴿子次數重算」按鈕
- **教訓**：
  - 跨集合的全域統計不適合在前端即時計算，資料量增長後必然撞到 limit 天花板
  - 正確架構：後端定時算 → 結果掛在實體文件上 → 前端只讀
  - 補正系統（correction）與原始計數分離，改了計數來源不影響補正邏輯

### 2026-04-10 — 簽到紀錄因 onSnapshot limit 部分遺漏 — 改用 per-event 直接查詢
- **問題**：部分活動的簽到簽退紀錄在管理頁面看不到，有些有、有些沒有，不分新舊
- **原因**：同日稍早的費用優化加上 `attendanceRecords` onSnapshot `.limit(1500)`，全站簽到紀錄超過此上限時，部分活動的紀錄被排除在前端快取外。調到 3000 仍有遺漏
- **修復**：
  - `FirebaseService.fetchEventAttendanceRecords(eventId)` — 按 eventId 直接 `.where().get()`，繞過全域 limit
  - `ApiService.fetchAttendanceRecordsForEvent(eventId)` — per-event cache + 並發去重 + Demo fallback
  - `getAttendanceRecords(eventId)` — 優先讀 per-event cache，無則 fallback 全域快取
  - `_renderAttendanceTable` 改為 async，渲染前先 `await fetchAttendanceRecordsForEvent`
  - 寫入路徑（add/remove/batch）成功後同步更新 per-event cache
  - onSnapshot 觸發時清除 per-event cache，確保遠端寫入可見
- **教訓**：
  - 全域 onSnapshot limit 適合即時列表，但特定資源的完整查詢必須走獨立 `.get()`
  - 快取分層：全域快取（有 limit，供列表）+ per-event cache（無 limit，供詳情頁）
  - 寫入後必須同步更新 per-event cache，否則同步讀取會落回不完整的全域快取

### 2026-04-10 — Firestore 費用優化：onSnapshot limit + Functions 降頻 + 儀表板可調
- **問題**：10 天費用 ~500 TWD。Firestore 每日 177 萬次讀取（onSnapshot 無 limit 監聽全集合）、Cloud Run 92,973 秒/天（autoEndStartedEvents 每分鐘 + createCustomToken minInstances:1）
- **原因**：attendanceRecords / registrations / events 的 onSnapshot 無 .limit()，每次資料變動重讀全集合；autoEndStartedEvents 每分鐘跑但幾乎 0 更新；fetchUsageMetrics 每小時跑
- **修復**：
  - 第一刀（前端）：三個監聽器加 .limit()，值可在儀表板動態調整（存 siteConfig/realtimeConfig）
    - attendanceRecords: .orderBy('createdAt','desc').limit(1500)
    - registrations admin: .orderBy('registeredAt','desc').limit(3000)
    - events: .where(...).limit(100)
  - 第二刀（後端）：autoEndStartedEvents `*/5` + 128MiB；fetchUsageMetrics 每 6 小時
  - 儀表板設定卡片：admin 以上可即時調整三個 limit 值（100~10000），用戶切頁/重開生效
- **教訓**：
  - onSnapshot 無 limit = 費用隨歷史資料永遠增長，必須加上限封頂
  - 統計查詢用獨立 .get()（不走監聽器），limit 不影響統計正確性
  - 排程函式只能預熱自己，不能幫其他函式預熱
  - createCustomToken 是登入關鍵路徑，不應降記憶體

### 2026-04-10 — 庫存系統頁籤管理功能（顯示名稱映射）
- **需求**：讓用戶自訂庫存頁面群組頁籤的顯示名稱（商品/活動/器材/其他）
- **設計決策**：採用「顯示名稱映射」方案，而非「重新命名 group 欄位」。內部 group 值永不改變，僅在 Firestore `inv_stores/{storeId}.groupTabNames` 存映射表。此設計消滅了 8/15 個潛在 Bug（含批次更新失敗、資料一致性、快取同步等致命問題），且單筆 Firestore 文件寫入天然原子。
- **修改範圍**：`inv-products.js`（新增 `_groupTabNames`、`loadGroupTabs()`、`_groupLabel()` + 15 處顯示點套用）、`inv-store.js`（切換倉庫重置映射）、`inv-auth.js`（登入後載入映射）、`inv-permissions.js`（新增 `settings.group_tabs` 權限碼）、`inv-settings.js`（頁籤管理卡片 + 改名彈窗 + 還原功能）、`inv-sale.js`（購物車拆分品名稱映射）、`inv-utils.js`（log label）、`index.html`（切換庫存按鈕 + 版號 82）
- **教訓**：當需要「重新命名」一個被多處引用的值時，優先考慮「映射/別名」方案而非「批量替換原始值」，可大幅降低資料一致性風險

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

### 2026-04-14 — 俱樂部×賽事重構 Phase 1b — 賽事結構整理 + 全域任務
- **問題**：賽事模組結構需要與俱樂部模組同步整理（Phase 1a 已完成俱樂部部分）
- **修復**：
  - 新建 `tournament-helpers.js`（9 個純工具函式從 tournament-core.js 抽出）
  - 新建 `tournament-share-builders.js`（3 個 Builder 從 tournament-share.js 抽出）
  - 刪除 `tournament-detail.js` 死代碼（renderLeagueSchedule / renderBracket）
  - 全域狀態收進 `_tournamentFormState` / `_teamFormState` 物件
  - 更新 `script-loader.js` — tournament group 新增 helpers / core / render / share-builders
  - 統一 6 處 ID 生成為 `generateId(prefix)`（fp_ / fc_ / ct_ / ce_ / reg_ / ta_）
  - 新增 3 個賽事權限碼：end / reopen / delete（config.js + user-admin-perm-info.js）
- **教訓**：Phase 1 結構整理不改邏輯，舊入口保留為 facade，降低回歸風險
