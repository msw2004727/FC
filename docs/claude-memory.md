# ToosterX — Claude 修復日誌（濃縮版）

此檔案隨 git 版本控制，記錄歷次 bug 修復與重要技術決策，供跨設備、跨會話參考。

> **維護規則**：
> - 新紀錄一律寫在檔案前方，採新到舊排序
> - `[永久]` 標記的條目為系統性教訓，永不過期
> - 一般條目超過 30 天且無持續參考價值時可清除
> - 同主題多次迭代合併為一筆（保留最終結果）
> - 純功能新增（可從 git log 得知）不記錄
> - 總行數超過 500 行時觸發清理

### 2026-04-13 — 運動圖示全面改用 SVG 取代 Emoji
- **問題**：運動項目切換選單（頂部 sport picker）及所有運動圖示使用 emoji，跨平台顯示不一致
- **修復**：
  - `js/config.js`：新增 `SPORT_ICON_SVG` 物件（19 組 SVG：all + 18 運動），`getSportIconSvg()` 改為回傳 inline SVG（class `sport-icon-svg`），保留 `SPORT_ICON_EMOJI` 供分享文字用
  - `js/core/theme.js`：移除 `_allSportSvg` 硬編碼，`_sportIcon` 改為統一呼叫 `getSportIconSvg()`
  - CSS 四檔（layout / base / activity / home）：新增 `.sport-icon-svg` 尺寸規則（13~18px 各場景）
  - 測試：`config-utils.test.js` 同步更新函式副本與斷言
- **教訓**：SVG class 注入用 `replace('<svg ', ...)` 方式，需確保 SVG 字串以 `<svg ` 開頭

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
