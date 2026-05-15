# ToosterX 自動化測試補完計劃書

Last reviewed: 2026-05-15

## 2026-05-15 Phase 1 實作紀錄

狀態：已完成，等待本段 commit。

本階段完成項目：
1. E2E 全面改用 `tests/e2e/helpers/test-harness.js` 注入固定測試身分、固定活動 fixture、LIFF mock、localStorage cache seed 與外部 API 離線攔截。
2. 移除 E2E 中「只驗證 boolean 型別」與「只驗證數量 >= 0」的無效測試寫法，改成可見性、route、DOM state、select option、service worker boot code 等具體 assertion。
3. 新增 `tests/unit/e2e-quality.test.js`，禁止 E2E spec 再引入低保護力 assertion，且要求共用 test harness。
4. 將 ScriptLoader orphan / eager script 風險改為明確 allowlist，未列入原因的新增 orphan 會直接 fail。
5. 將 source drift 從純 warning 改為 baseline gate，避免新的 stale line range 繼續增加。

驗收結果：
1. `npx jest --runInBand --runTestsByPath tests/unit/e2e-quality.test.js tests/unit/script-deps.test.js tests/unit/source-drift.test.js`：3 suites / 26 tests passed。
2. `npm run test:e2e:smoke -- --list`：列出 21 tests。
3. `npm run test:e2e:smoke -- --workers=1` 搭配本地 HTTP server：21 tests passed。

本階段審計發現並已修復：
1. `privacy.html` / `terms.html` 原本用 `locator('title')` 讀不到 title，已改為 `page.toHaveTitle()`。
2. profile 導航原本可能抓到隱藏的 user-menu 項目，已改抓底部 tab 並確認 `#page-profile` 可見。
3. admin dashboard 原本只切 hash 不保證 dashboard 模組已載入，已新增 `openAdminDashboard()` 測試 helper，明確載入 script、注入 admin user、render dashboard。

剩餘風險：
1. `source-drift.test.js` 仍有既有 stale baseline，Phase 1 先禁止惡化；後續可另排清理，不在本階段擴大修改。
2. E2E harness 目前覆蓋主要離線 smoke，後續 Phase 2-9 仍需依功能面補更完整的業務流程。

## 2026-05-15 Phase 2 實作紀錄

狀態：已完成，等待本段 commit。

本階段完成項目：
1. 補強 `role-permissions-cache.test.js`，覆蓋 object map cache、missing role fallback、explicit empty 不回填預設值。
2. 補強 `role-activity-capabilities-cache.test.js`，覆蓋 missing `roleActivityCapabilities/user` fallback、object map override、unknown capability sanitization。
3. 新增 `tests/e2e/activity-permissions.spec.js`，在瀏覽器 runtime 使用固定 user harness 驗證：
   - 一般 user 可建立基本活動。
   - 無 `user.activity.addons_use` 時不可使用加值功能，且 Toast 為「如需更多功能請聯繫官方Line@」。
   - 開啟 `user.activity.addons_use` 後 owner 可用加值，delegate 仍不可用加值。

驗收目標：
1. `npm run test:unit -- --runTestsByPath tests/unit/role-permissions-cache.test.js tests/unit/role-activity-capabilities-cache.test.js tests/unit/permissions-phase2-logic.test.js tests/unit/activity-create-button.test.js tests/unit/activity-social-links.test.js`。
2. `npm run test:rules`。
3. `npm run test:e2e:smoke -- --workers=1`。

驗收結果：
1. `npx jest --runInBand --runTestsByPath tests/unit/role-permissions-cache.test.js tests/unit/role-activity-capabilities-cache.test.js tests/unit/permissions-phase2-logic.test.js tests/unit/activity-create-button.test.js tests/unit/activity-social-links.test.js tests/unit/e2e-quality.test.js`：6 suites / 354 tests passed。
2. `npm run test:rules`：5 suites / 526 tests passed。
3. `npm run test:e2e:smoke -- --workers=1` 搭配本地 HTTP server：23 tests passed。

## 2026-05-15 Phase 3 實作紀錄

狀態：已完成，等待本段 commit。

本階段完成項目：
1. 補強 `canonical-cache.test.js` 的活動頁 stale/fresh race：覆蓋「fresh 先到、舊 cache 後到」與「舊 cache 先 render、fresh detail 後注入」兩種順序，確認 `current/status` 最終維持最新 detail 值。
2. 補強 `event-list-stats.test.js` 的活動狀態判斷：明確驗證「活動開始時間已過即 ended」、取消活動維持 cancelled、未來滿額活動維持 full。
3. 補強 `event-write-integrity.test.js` 的寫入錯誤防線：`_updateAwaitWrite` / `_createAwaitWrite` 發生 Firestore 寫入失敗時，必須 rollback optimistic cache、觸發 toast、並保留錯誤給呼叫端處理。
4. 複核既有 `event-confirmed-summary`、`registration-transaction`、`waitlist-sort`、`waitlist-capacity` 與 Firestore Rules 測試，確認 Phase 3 計劃書要求的報名、候補、取消與 attendance 邊界已被覆蓋。

驗收命令：
1. `npx jest --runInBand --runTestsByPath tests/unit/canonical-cache.test.js tests/unit/event-list-stats.test.js tests/unit/event-confirmed-summary.test.js tests/unit/event-write-integrity.test.js tests/unit/registration-transaction.test.js tests/unit/waitlist-sort.test.js tests/unit/waitlist-capacity.test.js`
2. `npm run test:rules`

驗收結果：
1. Phase 3 unit：7 suites / 112 tests passed。
2. Firestore Rules：5 suites / 526 tests passed。

## 2026-05-15 Phase 4 實作紀錄

狀態：已完成，等待本段 commit。

本階段完成項目：
1. 補強 `home-next-activity.test.js`，覆蓋「切換 UID 不沿用他人 cache」、「超過 1 小時 cache 直接失效」、「10 分鐘以上但 1 小時內 cache 先顯示舊卡再背景刷新」。
2. 補強 `home-dashboard-render.test.js`，驗證運動快速入口只顯示活動數大於 0 的項目、先依活動數排序、同數時依 `EVENT_SPORT_OPTIONS` 順序，並確認密室逃脫排在棒壘球前。
3. 補強 `sport-filter.test.js` 的 sport config source contract，確保密室逃脫存在、位於棒壘球前，且使用指定自訂圖示資源。
4. 新增 `home-game-rank-preview.test.js`，覆蓋小遊戲首頁排行榜月份、TOP4、頭像、暱稱、分數排序、踢球距離格式與無資料 fallback。
5. 修復 E2E harness 兩個測試層瑕疵：一般 user 前台能力 fixture 改成正式 cache 使用的 `{ capabilities: [...] }` 形狀；個人資料提示關閉遇到 navigation context 重建時會重試，降低瀏覽器導航 flaky。

驗收命令：
1. `npx jest --runInBand --runTestsByPath tests/unit/home-next-activity.test.js tests/unit/home-dashboard-render.test.js tests/unit/home-summary.test.js tests/unit/sport-filter.test.js tests/unit/home-game-rank-preview.test.js`
2. `npm run test:e2e:smoke -- --workers=1` 搭配本地 HTTP server

驗收結果：
1. Phase 4 unit：5 suites / 49 tests passed。
2. E2E smoke：23 tests passed。

本階段審計發現並已修復：
1. E2E `activity-permissions.spec.js` 原本在 `ScriptLoader.ensureForPage` 前寫入 array cache，可能被頁面初始化覆蓋，且形狀不完全等同正式 cache；已改為初始化後寫入 `{ user: { capabilities } }`。
2. E2E `example.spec.js` 的 profile prompt dismiss 偶發遇到頁面 navigation context 被銷毀；已在測試 helper 內針對該錯誤重試一次。

## 2026-05-15 Phase 5 實作紀錄

狀態：已完成，等待本段 commit。

本階段完成項目：
1. 複核既有 `private-message.test.js`、`message.test.js`、`message-system.test.js`、`notif-toggle.test.js`，確認 fresh bubble 轉舊未讀、桌機 PM list 不吃掉 reminder、通知小圖、edit / recall / mark read source contract 皆已有 unit coverage。
2. 新增 `tests/e2e/private-message.spec.js`，用離線 E2E harness 驗證手機 viewport 聊天彈窗：focus input 後套用 keyboard layout、毛玻璃 overlay 位於底層按鈕上方、關閉後 body 不鎖死。
3. 新增桌機 E2E 驗證：新私訊 fresh bubble timeout 後切成舊未讀 reminder，且鈴鐺下方未讀小圖在 bubble 顯示時仍保持可見。
4. E2E 私訊模組改用 `page.addScriptTag({ path })` 強制載入測試所需模組，避免 `ScriptLoader` 因 DOM 預掃描把尚未可用的 script 誤判為已載入。

驗收命令：
1. `npx jest --runInBand --runTestsByPath tests/unit/private-message.test.js tests/unit/message.test.js tests/unit/message-system.test.js tests/unit/notif-toggle.test.js`
2. `npx playwright test tests/e2e/private-message.spec.js --project=chromium-desktop --workers=1` 搭配本地 HTTP server
3. `npm run test:e2e:smoke -- --workers=1` 搭配本地 HTTP server

驗收結果：
1. Phase 5 unit：4 suites / 209 tests passed。
2. PM E2E：2 tests passed。
3. E2E smoke：25 tests passed。

本階段審計發現並已修復：
1. 新增 PM E2E 初版使用 `ScriptLoader._load` 時，因 `_primeLoadedFromDom()` 會把 DOM 既有 script 標為 loaded，導致測試頁中 `pm-listener` 方法尚不可用；已改用 `page.addScriptTag({ path })` 在測試上下文明確執行需要的 PM 模組。

## 2026-05-15 Phase 6 實作紀錄

狀態：已完成，等待本段 commit。

本階段完成項目：
1. 補強 `tests/unit/cloud-functions.test.js` 的 Cloud Functions source contract，覆蓋 `registerForEvent`、`cancelRegistration`、`refreshMyActivityRecords` 的身份驗證、UID bridge、transaction、registration lock、activityRecords、候補遞補與 cooldown 防線。
2. 補強私訊 callable source contract，覆蓋 `sendPrivateMessage`、`markPrivateConversationRead`、`editPrivateMessage`、`recallPrivateMessage`、`updatePrivateMessageSettings` 的參與者驗證、sender-only 修改、已讀後不可改、rate limit、audit copy 與 super_admin 設定權限。
3. 對 `createSportsApiProScoreboardExports` 建立可注入的 callable fast-layer 測試，驗證 `refreshSportsApiProScoreboard`、`fetchSportsApiProMatchDetail`、`upsertScoreboardTranslations` 的 auth / permission / cooldown / invalid sport 防線。
4. 補 `fetchJson` 注入式 fetch 測試，確保測試不會打正式 SportsAPI Pro，且會帶 `x-api-key` header。
5. 複核 `test:functions` script 已存在，沒有新增重複 script。

驗收結果：
1. `npm run test:functions -- --runInBand`：1 suite / 139 tests passed。
2. `npm run test:rules`：5 suites / 526 tests passed。

本階段審計決策：
1. 未抽離 `functions/index.js` 的報名與私訊 runtime helper。原因是這些 callable 目前耦合 Firestore transaction、通知、稽核與歷史資料修補，為了測試大幅抽 helper 會帶來高於測試收益的回歸風險；本階段先用 source contract 鎖住高風險邊界，SportsAPI 則使用既有 dependency injection 做真正 mock 行為測試。
2. Functions emulator callable 層暫不擴大到完整所有 callable；目前以 Rules emulator + callable fast-layer 補 P0/P1 防線，避免 CI 過慢與 flaky。若未來要測真 callable emulator，應只挑 `registerForEvent` / `cancelRegistration` / `sendPrivateMessage` 三條最核心路徑。

## 2026-05-15 Phase 7 實作紀錄

本階段已補 SportsAPI / 比分 / 中文詞庫的自動化測試，重點放在「不打真 API、不消耗 quota、不讓錯誤分類或翻譯狀態污染快取」。

實作項目：
1. `scoreboard-sportsapipro-normalizer.test.js` 補齊台灣日期邊界、quota usage key、request budget 上限、sport card 開關、首頁/即時/賽程/detail 開關、priority order、featured source、detail cache key、homepage sections 24H 範圍與 status payload sanitize。
2. `scoreboard-translations.test.js` 補齊 needs_review / conflict / ignored / keep_original / approved 統計、sport/type coverage、top pending 排序、candidate merge、final-status skip、translation upsert 不覆蓋已核准資料、AI 翻譯指引內容。
3. 測試抓到 `planRequests()` 二次 normalize 會覆蓋已保存的 `sports.*.homepageEnabled`，已修正為只有舊格式沒有明確 sport card homepage 開關時才用 enabled 回填。
4. 自我審計修正 Phase 7 計劃：目前 source 僅保留 scoreboard Functions 與資料層，前台/後台 scoreboard UI 先前已被移除，`docs/claude-memory.md` 有明確紀錄「未重新啟用 removed frontend scoreboard UI」。因此本階段不新增 scoreboard control E2E，避免為測試重啟已移除功能；待 UI 正式恢復時再補對應 E2E。

驗收指令：
1. `npm run test:unit -- --runTestsByPath tests/unit/scoreboard-sportsapipro-normalizer.test.js tests/unit/scoreboard-translations.test.js`
2. `npm run test:functions -- --runInBand`

審計結論：
1. 不會連線 `sportsapipro.com` 或使用正式 API key。
2. 已覆蓋首頁資料分區、運動頁籤、重點聯賽、detail cache key、台灣日期、中文詞庫狀態與 AI 維護流程。
3. UI E2E 暫不補是刻意決策，不屬漏測；原因是目前沒有 scoreboard UI source，測試應避免幻想式 selectors。

## 2026-05-15 Phase 8 實作紀錄

本階段已補首頁 banner / 廣告管理 / 觀賽聚會 / 找活動入口的自動化測試，重點放在近期 UI 改版最容易回歸的固定 overlay、右下 dots、查詢帶參數、觀賽聚會設定與隱藏邏輯。

實作項目：
1. `banner-carousel.test.js` 補固定 overlay 只渲染一次、插在 dots 前方、切換輪播不跟著換文字、非首圖不留 loading、首圖 high priority / 其他 low priority。
2. `home-dashboard-render.test.js` 補找活動彈窗送出後會帶地區、運動、活動類型到活動頁；補觀賽聚會外部網址與空網址 toast。
3. `home-banner.spec.js` 新增 E2E，desktop/mobile 都驗證首頁 banner 固定 CTA overlay 與找活動彈窗流程。
4. `ad-manage.test.js` 既有測試已覆蓋 banner/觀賽聚會/即時資訊編輯欄位與比例，本階段以 targeted run 納入驗收。

驗收指令：
1. `npm run test:unit -- --runTestsByPath tests/unit/ad-manage.test.js tests/unit/banner-carousel.test.js tests/unit/home-dashboard-render.test.js`
2. `BASE_URL=http://127.0.0.1:3000 npx playwright test tests/e2e/home-banner.spec.js --project=chromium-desktop --project=chromium-mobile --workers=1`

審計結論：
1. E2E 使用 test harness 與本地靜態 server，不讀正式 Firebase/LINE。
2. 已覆蓋 mobile/desktop 的 banner overlay、dots、找活動 modal 與活動頁 filter 狀態。
3. 沒新增 screenshot snapshot，避免版面小改造成大量無意義更新；本階段用 DOM 狀態、class、filter 值與頁面可見性驗收。

## 1. 目標

本計劃的目標不是追求測試數量，而是建立能實際攔住回歸 bug 的自動化測試防線。

核心原則：

1. 測試必須保護真實風險：權限、金流或費用、報名、資料一致性、私訊、首頁關鍵資訊、Cloud Functions、Firestore Rules。
2. 測試必須有明確失敗條件：不能只是確認「不 throw」、「是 boolean」、「大於等於 0」。
3. 測試不可污染 production：不得連線正式 Firebase，不得寫入正式資料，不得依賴真實 LINE / Sports API / Storage。
4. 先補黑盒與規則測試，盡量不動現有功能碼；若為了可測試性需要抽 helper，必須另列為低風險重構並保留行為相同。
5. 無意義或誤導性的測試要撤除或改寫，避免給人錯誤安全感。

## 2. 不做範圍

下列項目不列入自動化測試，除非日後成為正式功能風險：

1. `docs/previews/demo.html` 這類 AI 視覺預覽檔。
2. 純圖片、純靜態素材、人工設計稿。
3. 無業務邏輯的文案微調。
4. 已歸檔、僅保留歷史背景的測試，例如 `tests/archive/subcollection-rules.pre-migration.js`。
5. 只用人工確認才有意義的主觀美術細節，例如「這個漸層好不好看」。
6. 外部 API 真實資料準確性本身，例如 SportsAPI Pro 是否回傳正確比分；我們只測接入、快取、降級、資料正規化。

## 3. 現況基線

本節基於本輪實際讀取的檔案、本輪執行的 E2E 清單命令，以及既有最近測試盤點結果。計劃實作前仍需依本文件第 14 節重新跑一次基線，避免用過期數字做決策。

- `package.json`
- `.github/workflows/test.yml`
- `tests/e2e/example.spec.js`
- `tests/e2e/smoke-journeys.spec.js`
- `tests/` 目錄檔案清單
- 既有最近盤點：`npm run test:unit:coverage -- --coverageReporters=text-summary --coverageReporters=json-summary`
- 既有最近盤點：`npm run test:rules`
- 本輪執行：`npx playwright test tests/e2e --list`

### 3.1 現有測試腳本

| 指令 | 現況 | 用途 |
|---|---|---|
| `npm run test` | 等同 `jest tests/unit/` | 預設 unit suite |
| `npm run test:unit` | `jest tests/unit/` | 單元測試 |
| `npm run test:unit:coverage` | `jest tests/unit/ --coverage` | 單元測試 coverage |
| `npm run test:rules` | Firebase Emulator + 5 個 rules test 檔 | Firestore Rules |
| `npm run test:e2e` | Playwright `tests/e2e/` | E2E smoke |

### 3.2 CI 現況

`.github/workflows/test.yml` 已有三段：

1. `unit-tests`: `npm run test:unit`
2. `firestore-rules-tests`: `npm run test:rules`
3. `e2e-smoke-tests`: 啟動 Python static server 後跑 Playwright Chromium

CI 結構是對的，但目前缺：

1. coverage artifact / summary。
2. 高風險檔案 coverage threshold。
3. Cloud Functions emulator 或 callable 行為測試 job。
4. 真正業務流程型 E2E。

### 3.3 實測結果

截至本計劃撰寫時可確認的最近測試盤點：

| 類型 | 結果 |
|---|---:|
| Unit | 126 suites / 3098 tests passed |
| Firestore Rules | 5 suites / 526 tests passed |
| E2E listed | 21 tests / 2 files |
| Unit coverage statements | 1.38% |
| Unit coverage branches | 1.42% |
| Unit coverage functions | 1.76% |
| Unit coverage lines | 1.56% |

解讀：

1. 測試數量多，且 rules 測試已有基本安全價值。
2. coverage 數字極低，不能拿來宣稱整體覆蓋完善。
3. 低 coverage 不代表現有測試無用；原因之一是大量測試透過 VM / sandbox / mock 驗證重點函式，Istanbul 沒有完整反映。
4. 目前 coverage 設定只看 `js/**/*.js`，不含 `functions/`，也不含 Firestore Rules。

## 4. 現有測試分類

### 4.1 已有且有價值的測試

這些測試應保留並補強：

1. Firestore Rules tests
   - `tests/firestore.rules.test.js`
   - `tests/firestore-rules-extended.test.js`
   - `tests/team-split-rules.test.js`
   - `tests/firestore-rules/team-feed-rules.test.js`
   - `tests/firestore-rules/tournament-member-rules.test.js`
2. 權限與 role cache
   - `tests/unit/permissions-phase1-visibility.test.js`
   - `tests/unit/permissions-phase2-logic.test.js`
   - `tests/unit/permission-guard-safety.test.js`
   - `tests/unit/role-permissions-cache.test.js`
   - `tests/unit/role-activity-capabilities-cache.test.js`
3. 活動與報名
   - `tests/unit/event-write-integrity.test.js`
   - `tests/unit/event-confirmed-summary.test.js`
   - `tests/unit/registration-transaction.test.js`
   - `tests/unit/signup-logic.test.js`
   - `tests/unit/waitlist-capacity.test.js`
   - `tests/unit/waitlist-sort.test.js`
4. 首頁與活動摘要
   - `tests/unit/home-next-activity.test.js`
   - `tests/unit/home-dashboard-render.test.js`
   - `tests/unit/home-summary.test.js`
5. 私訊與通知
   - `tests/unit/private-message.test.js`
   - `tests/unit/message.test.js`
   - `tests/unit/message-system.test.js`
   - `tests/unit/notif-toggle.test.js`
6. SportsAPI / 比分
   - `tests/unit/scoreboard-sportsapipro-normalizer.test.js`
   - `tests/unit/scoreboard-translations.test.js`
7. Cloud Functions 靜態或局部驗證
   - `tests/unit/cloud-functions.test.js`

### 4.2 有價值但目前不足的測試

1. E2E 目前偏 smoke，不足以驗證真實流程。
2. Cloud Functions 目前多數不是 emulator 行為測試，無法完整證明 callable 權限與資料寫入。
3. UI 權限頁缺少「改完、刷新、仍保留」的 E2E。
4. 首頁「我的下一場活動」需要更多情境測試，尤其報名、主辦、委託人同時存在時的排序。
5. 活動頁新舊資料覆蓋問題需要資料版本與載入順序測試。

## 5. 現有無意義或低保護力測試撤除/改造清單

這些不是立刻刪光，而是逐一判定：能改造成有效測試就改；不能改就刪除，避免誤導。

### 5.1 `tests/e2e/smoke-journeys.spec.js`

| 現有測試 | 問題 | 處理方式 |
|---|---|---|
| Dashboard cards `count >= 0` | 永遠成立，無保護力 | 改成要求已登入 admin mock 後至少有指定 dashboard card，並驗證 `data-drill-key` 導航結果 |
| refresh bar info button `typeof exists === 'boolean'` | 永遠成立 | 改成實際存在時開說明彈窗，或若該頁未授權則驗證不出現 |
| Theme 允許 `null` / 空字串 | 過寬，無法攔截 theme 初始化壞掉 | 改成載入完成後必須是 `light` 或 `dark`，除非測試的是初始未載入狀態 |
| Deep link hash 測試有 mojibake 且疑似 expect 被註解污染 | 可能沒有真正驗證 | 重寫成可讀、明確驗證 route state 與頁面可見 |
| User Card `typeof viewCountExists === 'boolean'` | 永遠成立 | 改成有 event data 時必須顯示瀏覽數；無資料時驗證 fallback |

### 5.2 `tests/e2e/example.spec.js`

| 現有測試 | 問題 | 處理方式 |
|---|---|---|
| can navigate to activity page | 若 tab 不可見就跳過，且沒有頁面後置驗證 | 改成必須找到活動 tab，點擊後 `#page-activities` 可見 |
| can navigate to profile page | 同上 | 改成必須找到 profile tab，點擊後 profile shell 可見 |
| service worker is registered | 只驗證 boolean 類型 | 改成測 `sw.js` 內容與 cache name；註冊行為移到 PWA 專用測試 |
| privacy / terms text 使用 mojibake | 文字本身不可信 | 改成驗證 HTTP 200、title/meta、主要 heading selector |

### 5.3 `tests/unit/source-drift.test.js`

現況：

- 測試通過，但會警告大量 stale line ranges。

問題：

- 長期警告會讓真正的警告被忽略。
- 「通過但一直警告」會降低 CI 信任度。

處理方式：

1. 先修正或移除過期 annotations。
2. 將需要保護的 source mapping 改成 fail-hard。
3. 不再維護的 annotation 直接移除。

### 5.4 `tests/unit/script-deps.test.js`

現況：

- 測試通過，但會警告 orphan modules 與 Phase B scripts。

問題：

- 若 orphan 是刻意的，應明確 allowlist。
- 若不是刻意的，應 fail。
- 現在介於兩者之間，保護力不足。

處理方式：

1. 建立明確 allowlist，例如 game lab 或實驗頁專用模組。
2. allowlist 以外的 orphan 直接 fail。
3. Phase B scripts 若仍需保留，寫入明確遷移狀態；否則轉成 fail。

### 5.5 全 repo 低價值 assertion 掃描

新增一次性審計任務：

1. 掃描 `expect(typeof x).toBe('boolean')`。
2. 掃描 `toBeGreaterThanOrEqual(0)`。
3. 掃描 `if (await locator.isVisible()) { click }` 但沒有 else fail 或後置驗證。
4. 掃描只驗證 `body` 可見但沒有業務 assertion 的 E2E。

處理準則：

- 若能改成明確業務結果，改寫。
- 若只能證明「測試程式跑過」，撤除。

## 6. 測試補完策略

### 6.1 測試分層

| 層級 | 用途 | 原則 |
|---|---|---|
| Unit | 純函式、資料轉換、權限判斷、排序、狀態機 | 快速、穩定、可大量補 |
| Integration | 多模組協作、ApiService/FirebaseService cache、DOM render helper | 使用 mock，不連 production |
| Firestore Rules | 讀寫安全邊界 | 必須跑 emulator |
| Cloud Functions | callable / scheduled / trigger 的權限與資料效果 | 優先用 emulator 或 dependency injection |
| E2E | 使用者主流程與跨模組互動 | 少量但高價值，避免脆弱視覺細節 |
| Visual smoke | 手機/桌機關鍵版面不破框 | 只覆蓋高風險 UI，不測美感 |

### 6.2 測試資料策略

1. 測試資料必須獨立，不依賴 production。
2. 使用固定 UID / eventId / teamId。
3. Firestore Rules 使用 emulator seed。
4. E2E 使用 mock backend 或 fixture injection。
5. 外部 API 全部 mock，禁止真實 API key。
6. E2E 每個測試案例開始前必須清空或重建：
   - `localStorage`
   - `sessionStorage`
   - IndexedDB
   - Service Worker cache
   - 測試專用的全域 mock 狀態
7. 若測試需要模擬登入，必須明確設定固定測試身分，不可沿用瀏覽器殘留狀態。
8. 測試資料命名需帶 `test_` 或 `e2e_` 前綴，避免與正式資料格式混淆。

### 6.3 命名與 selector 策略

E2E 不應依賴易變的中文文案或 CSS class。新增測試時優先使用：

1. `data-testid`
2. `data-page`
3. 穩定 id
4. 穩定 route hash

若需要加 `data-testid`，只加不影響 UI 的屬性，不改行為。

### 6.4 E2E Test Harness 規格

目的：避免 E2E 測試變成「看起來有測，但其實用殘留登入狀態或假資料碰巧通過」。

必須建立或補齊以下測試工具：

1. 固定測試身分：
   - `e2e_user_basic`
   - `e2e_user_advanced`
   - `e2e_owner`
   - `e2e_delegate`
   - `e2e_coach`
   - `e2e_admin`
2. 固定測試活動：
   - 公開活動
   - 私密活動
   - 已額滿活動
   - 候補活動
   - 已取消活動
   - 已結束活動
3. 固定注入入口：
   - LIFF profile mock
   - Firebase auth mock
   - Firestore/API response fixture
   - SportsAPI response fixture
4. 每個 E2E 檔案必須有 `beforeEach` 清理瀏覽器狀態。
5. 每個需要權限的 E2E 必須明確宣告使用哪個角色，不可只用「目前登入者」。
6. E2E 若無法穩定建立身分與 fixture，該測試不得進 CI，只能列入手動驗收或先補 harness。

驗收標準：

1. 新增 `tests/e2e/helpers/` 或等價測試輔助層。
2. 權限管理、user 開團、首頁下一場活動、私訊至少各有一個案例使用固定身分。
3. E2E 不依賴 production Firebase、真實 LINE、真實 SportsAPI。

### 6.5 禁止測試複製版邏輯規則

目前專案有些 unit test 是把 production 邏輯改寫成 test 內的純函式來驗證。這種方式可在早期保留行為理解，但不能成為長期主要防線。

新測試規則：

1. 優先 import production helper 測試。
2. 若 production 邏輯仍包在大型 `App` 模組內，優先規劃低風險抽 helper。
3. 若短期只能 mirror production logic，測試檔必須註明：
   - 來源檔案
   - 來源函式或行為
   - mirror 原因
   - 後續抽 helper 的目標
4. mirror test 只能算「輔助保護」，不可計入完成定義中的主要覆蓋。
5. `source-drift.test.js` 應負責提醒 mirror test 與來源邏輯可能脫鉤；若能建立穩定對應，就改成 fail-hard。

## 7. 分階段實作計劃

### Phase 0：測試治理基礎

目的：先讓測試數字與文件可信。

工作項目：

1. 更新 `docs/test-coverage.md`，同步目前實測數字。
2. 新增測試矩陣文件或章節：
   - 功能
   - 風險
   - 現有測試
   - 缺口
   - 補測試優先級
3. 加入 coverage summary CI artifact。
4. 暫不設定全域 coverage threshold，避免 1.38% 直接阻斷所有 CI。
5. 建立 E2E Test Harness 規格文件或 helper skeleton。
6. 盤點現有 mirror-style unit tests，標記哪些應抽 production helper。

驗收：

1. `npm run test:unit` 通過。
2. `npm run test:rules` 通過。
3. `npm run test:e2e -- --list` 可列出測試。
4. 文件中的測試數字與命令結果一致。
5. E2E helper 能清理瀏覽器狀態並注入固定測試身分。
6. mirror test 清單已列入測試矩陣，不再被誤算為正式覆蓋。

### Phase 1：撤除或改造無意義測試

目的：降低假安全感。

工作項目：

1. 改寫 `tests/e2e/example.spec.js` 的條件式點擊測試。
2. 改寫 `tests/e2e/smoke-journeys.spec.js` 中永遠成立的 assertion。
3. 修正 mojibake 測試名稱與靜態頁文字 assertion。
4. `script-deps.test.js` 改成 allowlist + fail-hard。
5. `source-drift.test.js` 清掉 stale annotations 或改成可維護規則。

驗收：

1. E2E 測試失敗時能指向真實問題。
2. CI 不再輸出可忽略的長期 warning。
3. 移除的測試均有理由紀錄。

### Phase 2：權限與 user 開團防線

目的：保護最近最高風險的權限模型。

Unit 補強：

1. `rolePermissions` cache shape：
   - 正常 array
   - object map
   - missing role
   - stale cache
2. `roleActivityCapabilities/user`：
   - default fallback
   - Firestore override
   - refresh 後不被預設值覆蓋
3. 一般 user 建立活動：
   - basic create allowed
   - addons denied
   - private event 依 capability 成功/失敗
   - teamOnly / club-only 權限提示

4. `user.activity.addons_use` 加值 create/edit 權限矩陣：
   - capability 關閉：前端顯示 toast，Firestore Rules 也必須 deny。
   - capability 開啟：一般 user owner 可建立/編輯非團隊範圍加值欄位。
   - 非團隊範圍加值欄位至少覆蓋 `feeEnabled/fee`、`privateEvent`、`genderRestrictionEnabled/allowedGender`、`teamSplit`、`socialLinksEnabled/socialLinks`。
   - 團隊範圍加值欄位 `teamOnly/isPublic/creatorTeamId/creatorTeamIds` 不可只靠 `user.activity.addons_use` 放行，仍需 `team.create_event` 或管理權限。
   - owner 與 delegate 必須分開測：owner 可依能力改加值；delegate 只能改基本欄位，不可改加值欄位。

Rules 補強：

1. user basic create allow。
2. user addons create deny。
3. user add-ons create 依 `user.activity.addons_use` allow/deny。
4. user owner add-ons edit 依 `user.activity.addons_use` allow/deny。
5. delegate add-ons edit deny，即使該角色有基本活動管理能力也不可放大。
6. team-scoped add-ons create/edit 必須另外測 deny/allow 邊界。
7. user private create 依 capability allow/deny。
8. coach/captain/venue_owner/admin 以下看不到非自己私密活動。
9. owner/delegate 現場簽到與取消活動權限。

E2E 補強：

1. 權限管理開啟 user 進階能力。
2. 刷新後開關仍保留。
3. user 建立基本活動成功。
4. capability 關閉時 user 開加值功能顯示 toast，且後端寫入失敗。
5. capability 開啟後 user 建立/編輯允許的非團隊加值欄位成功。
6. capability 開啟後 user 仍不可建立/編輯 team-scoped add-ons，除非另外具備團隊或管理權限。
7. delegate 編輯活動時不可改加值欄位。
8. 每個案例都使用固定測試身分與固定 fixture，不使用瀏覽器殘留登入狀態。

驗收：

1. `npm run test:unit -- role-permissions-cache.test.js role-activity-capabilities-cache.test.js permissions-phase2-logic.test.js`
2. `npm run test:rules`
3. 新增 E2E 可在 test harness 下穩定通過。

### Phase 3：活動報名與資料一致性

目的：避免報名人數、新舊資料覆蓋、候補與取消出錯。

Unit 補強：

1. 活動 detail 新資料不可被舊 snapshot 覆蓋。
2. registration count 以 canonical source 為準。
3. `participantsWithUid` stale 時不覆蓋 confirmed summary。
4. waitlist promotion 排序。
5. event ended 判斷：開始時間已過即 ended。

Integration 補強：

1. ApiService update/create 寫入失敗時顯示正確錯誤訊息。
2. FirebaseService cache merge 不降低資料版本。
3. local cache 與 cloud snapshot 合併順序固定。
4. 建立 stale/fresh 競態測試：
   - fresh snapshot 先回傳 21/21。
   - stale cache 或較舊 snapshot 後回傳 20/21。
   - DOM 與內部 state 最終必須維持 21/21。
   - 反向順序也要測，確認新資料最後仍勝出。

Rules 補強：

1. 自己報名/取消只能操作本人。
2. 非 owner 不可改他人 registration。
3. attendance/activityRecords 只能透過合法路徑或 callable。

驗收：

1. `npm run test:unit`
2. `npm run test:rules`
3. stale/fresh 競態自動化測試通過。
4. 手動抽查活動頁快速進入不再有舊資料覆蓋新資料，僅作輔助驗收，不作為主要防線。

### Phase 4：首頁關鍵資訊

目的：首頁是高曝光入口，需保護資料正確與載入體驗。

Unit 補強：

1. `我的下一場活動`：
   - 有報名活動
   - 有主辦活動
   - 有委託活動
   - 三者同時存在取時間最近
   - 已取消/已結束排除
   - cache 1 小時內先顯示舊資料再背景刷新
2. 運動快速入口：
   - 只顯示活動數 > 0
   - 依活動數排序
   - 新增運動標籤如密室逃脫排序正確
3. 即時資訊：
   - 關閉時不先閃現容器
   - 文字過長 ellipsis
   - 眼睛瀏覽數移到正確容器
4. 小遊戲排行榜：
   - 月份顯示
   - 前四名排序
   - 無資料 fallback

E2E 補強：

1. 首頁載入不出現已關閉區塊閃爍。
2. 點「查看全部」到活動頁。
3. 點觀賽聚會按鈕帶正確分類。
4. 底部首頁 tab 重置體育標籤 all + 全部地區。

驗收：

1. `npm run test:unit -- home-next-activity.test.js home-dashboard-render.test.js home-summary.test.js sport-filter.test.js`
2. 新增首頁 E2E 在 mobile viewport 和 desktop viewport 各跑一次。

### Phase 5：私訊與通知

目的：私訊是高互動功能，手機鍵盤、未讀提醒、桌機泡泡都要穩。

Unit 補強：

1. 30 分鐘內新私訊提示消失後，若仍有舊未讀，切成舊未讀提示。
2. 桌機與手機 reminder 狀態一致。
3. 對話通知框顯示時，未讀小圖仍保持。
4. 私訊設定權限。
5. edit / recall / mark read callable 權限。

E2E 補強：

1. 手機 viewport 開聊天室。
2. focus input 後版面不鎖死。
3. blur / 關鍵盤後仍可關閉彈窗。
4. 彈窗外毛玻璃遮罩不可觸控底層。
5. 桌機未讀泡泡不消失。

Cloud Functions 補強：

1. `sendPrivateMessage`
2. `markPrivateConversationRead`
3. `editPrivateMessage`
4. `recallPrivateMessage`
5. `updatePrivateMessageSettings`

驗收：

1. `npm run test:unit -- private-message.test.js message.test.js message-system.test.js notif-toggle.test.js`
2. 私訊 E2E mobile/desktop 通過。

### Phase 6：Cloud Functions 正式測試層

目的：目前 `functions/` 沒有被 coverage 與 emulator 行為完整納管。

工作項目：

1. 新增 `test:functions` script。
2. 將可抽離的 function logic 移到可注入 dependency 的 helper。
3. 對高風險 callable 建兩層測試：
   - 快速層：dependency injection + mock admin SDK，驗證權限、輸入驗證、資料寫入意圖。
   - 真實邊界層：少量 emulator 測試，驗證 Firestore 實際讀寫與 callable 邊界。
4. 不要求所有 functions 立即達到高 coverage；先保護高風險 callable。

優先測：

1. `registerForEvent`
2. `cancelRegistration`
3. `refreshMyActivityRecords`
4. `sendPrivateMessage`
5. `markPrivateConversationRead`
6. `adminManageUser`
7. `syncUserRole`
8. `refreshSportsApiProScoreboard`
9. `fetchSportsApiProMatchDetail`
10. `upsertScoreboardTranslations`

暫不優先：

1. OG image request 的完整視覺輸出。
2. scheduled function 的實際排程觸發。
3. 真實外部 API 回應內容。

驗收：

1. `npm run test:functions` 通過。
2. CI 新增 functions job。
3. function tests 不需要 production credentials。
4. P0/P1 callable 至少有 mock admin SDK 快速測試。
5. 報名、取消、私訊、管理用戶至少各有一個 emulator 或等價 integration 驗證。

### Phase 7：SportsAPI / 比分 / 中文詞庫

目的：保護 API 額度、快取、資料顯示與翻譯流程。

Unit 補強：

1. API quota：
   - 每日上限
   - 剩餘額度
   - 台灣時間 08:00 歸零說明
2. 資料正規化：
   - sport tabs
   - live / upcoming / featured
   - match detail cache key
3. 中文詞庫：
   - translated
   - pending
   - keep original
   - needs review
   - conflict
   - sport-level stats
4. 後台控制：
   - sport card settings
   - homepage/live/schedule/detail switches
   - priority leagues ordering

E2E 補強：

1. 首頁比分區三個 tab 顯示一致。
2. 點賽事進詳情頁。
3. 後台關閉首頁顯示後首頁不渲染。
4. AI 翻譯指引一鍵複製。

驗收：

1. `npm run test:unit -- scoreboard-sportsapipro-normalizer.test.js scoreboard-translations.test.js`
2. 新增 scoreboard control E2E 通過。

### Phase 8：廣告管理與首頁 banner

目的：廣告管理會改首頁入口，且近期多次修改比例、彈窗、連結。

Unit 補強：

1. banner overlay controls 不隨輪播切換。
2. dots 移到右下角。
3. 找活動彈窗帶地區與運動分類。
4. 觀賽聚會按鈕：
   - 可下架
   - 可清空圖片
   - 可設定連結類型：賽事/俱樂部/活動/網址
   - pill 自適應寬度
5. 廣告管理編輯彈窗比例與首頁實際比例一致。

E2E 補強：

1. 後台編輯 banner 設定。
2. 首頁 overlay 固定。
3. 點找活動帶 query 到活動頁。
4. 點我要開團進建立活動。

驗收：

1. `npm run test:unit -- ad-manage.test.js banner-carousel.test.js`
2. banner E2E mobile/desktop 通過。

### Phase 9：視覺與手機版安全 smoke

目的：只測容易壞且客觀可判定的 UI，不測主觀美感。

測試項目：

1. 首頁主要容器左右寬度一致。
2. 我的下一場活動卡片按鈕不破框。
3. 活動頁女生專屬 tab 不超出右邊界。
4. 聊天彈窗在 mobile keyboard 模擬下不鎖死。
5. 品牌開機圖在 mobile/desktop 不偏移。

方式：

1. Playwright screenshot smoke。
2. 不做大範圍 snapshot，避免每次 UI 微調都大量失敗。
3. 只檢查 bounding box、overflow、可點擊狀態。

驗收：

1. mobile viewport: 390x844
2. desktop viewport: 1280x720
3. 主要 CTA 無重疊、無水平 overflow。

## 8. Coverage 策略

### 8.1 不採用全域硬門檻的原因

目前 `js/**/*.js` coverage 實測 statements 只有 1.38%。直接設定全域 80% 會讓 CI 無法運作，而且會逼出大量低價值測試。

### 8.2 建議門檻

先對高風險純邏輯檔設定局部門檻：

| 類型 | 初始門檻 | 最終目標 |
|---|---:|---:|
| 權限純函式 | 70% | 85% |
| 報名/候補純函式 | 70% | 85% |
| cache merge / race helper | 60% | 80% |
| SportsAPI normalizer | 75% | 90% |
| Cloud Functions helper | 60% | 80% |

### 8.3 coverage 改造

1. 將純 helper 從大型 App 模組逐步抽出。
2. 測 helper，不硬測整個 DOM 巨型模組。
3. CI 先產出 coverage summary，不立即阻斷。
4. 每個階段完成後才提高門檻。

## 9. CI 設計

### 9.1 每次 push 必跑

1. `npm run test:unit`
2. `npm run test:rules`
3. `npm run test:e2e:smoke -- --workers=1`

### 9.2 PR 或 main push 附加

1. coverage summary
2. high-risk coverage threshold
3. functions tests
4. 視改動範圍加跑對應 E2E project：
   - home
   - activity
   - message
   - admin

### 9.3 夜間或手動完整測試

1. full E2E mobile + desktop
2. visual smoke
3. functions emulator
4. dependency / script deps strict scan

### 9.4 E2E 腳本分層

需新增或調整 npm scripts：

1. `test:e2e:smoke`：每次 push 跑，僅含最高價值流程。
2. `test:e2e:full`：夜間或手動跑，含 mobile + desktop。
3. `test:e2e:visual`：只跑客觀視覺 smoke，例如 overflow、主要 CTA 可點擊、手機鍵盤不鎖死。
4. `test:e2e:admin`：後台權限、廣告管理、比分控制等管理流程。

Playwright project 建議：

1. `chromium-desktop`
2. `chromium-mobile`
3. `admin-desktop`

每個 project 都必須重用同一套 E2E Test Harness，避免不同測試環境結果不一致。

## 10. 風險控管

### 10.1 對現有功能代碼的影響

預設不改現有功能代碼。只有以下情況允許改：

1. 補 `data-testid`，不改 UI 與行為。
2. 抽純 helper，需保留原函式輸出完全一致。
3. 測試發現既有 bug，另開修復項目並跑對應驗收。

### 10.2 測試本身可能造成的風險

| 風險 | 防護 |
|---|---|
| 測試 flaky | 避免固定 sleep，改 waitForSelector / waitForFunction |
| CI 變慢 | 分層：push 跑 smoke，夜間跑 full |
| mock 與真實行為落差 | 對 Rules / Functions 用 emulator 補足 |
| coverage 造成假目標 | 只對高風險 helper 設 threshold |
| E2E 綁死文案 | 用 data-testid / route / state |
| 測試複製 production 邏輯 | 優先 import production helper；短期 mirror 必須被 source-drift 追蹤 |

## 11. 預估工作量

| 階段 | 預估 |
|---|---:|
| Phase 0 測試治理基礎 | 0.5-1 天 |
| Phase 1 無效測試撤除/改造 | 1 天 |
| Phase 2 權限與 user 開團 | 1-2 天 |
| Phase 3 活動報名與資料一致性 | 1-2 天 |
| Phase 4 首頁關鍵資訊 | 1-2 天 |
| Phase 5 私訊與通知 | 1-2 天 |
| Phase 6 Cloud Functions | 2-3 天 |
| Phase 7 SportsAPI / 比分 | 1-2 天 |
| Phase 8 廣告管理與 banner | 1-2 天 |
| Phase 9 視覺與手機 smoke | 1 天 |

建議執行方式：

1. 第一輪先做 Phase 0-2，建立可信基礎與最高風險權限防線。
2. 第二輪做 Phase 3-5，保護活動、首頁、私訊。
3. 第三輪做 Phase 6-9，補 Cloud Functions、比分、廣告、手機 UI。

## 12. 優先級

### P0 必做

1. 權限管理刷新後不回預設。
2. 一般 user 開團權限矩陣。
3. Firestore Rules 對 user / owner / delegate / admin 以下角色的安全邊界。
4. 活動頁新舊資料覆蓋防線。
5. 無意義 E2E 改造。
6. E2E Test Harness，包含固定測試身分、fixture、瀏覽器狀態清理。
7. 報名、取消、權限管理等高風險 callable 的第一層 functions 測試。

### P1 應做

1. 首頁我的下一場活動。
2. 私訊手機鍵盤與桌機未讀泡泡。
3. SportsAPI 快取與後台控制。
4. 廣告管理彈窗與 banner 控制。
5. 私訊、SportsAPI、後台管理 callable 的 functions 測試補強。

### P2 可排程

1. Visual smoke。
2. Cloud Functions 擴大 coverage，不含 P0/P1 已要求的高風險 callable。
3. 進一步提高 coverage threshold。

## 13. 完成定義

本計劃完成不是以測試數量判定，而是以下條件：

1. 高風險功能都有至少一層自動化測試。
2. 權限與資料安全都有 Firestore Rules 或 Cloud Functions 測試。
3. 主要使用者流程有 E2E。
4. CI 不再長期輸出可忽略 warning。
5. 無意義測試已刪除或改造成有效測試。
6. `docs/test-coverage.md` 與實際測試狀態同步。
7. coverage summary 可在 CI 查閱。
8. 新增測試不需要 production credentials。
9. E2E 有固定身分與 fixture，不依賴殘留登入狀態。
10. 活動頁 stale/fresh 競態有自動化測試，不只靠手動抽查。
11. 新增高風險測試優先測 production helper；mirror test 不被算作主要覆蓋。

## 14. 執行前檢查清單

每一階段開始前：

1. `git status --short`
2. 確認不覆蓋使用者未提交變更。
3. 確認該階段是否需要功能碼重構；若需要，先列出檔案與理由。
4. 先跑該區既有測試。

每一階段完成後：

1. 跑該階段指定測試。
2. 跑 `npm run test:unit`。
3. 若動 rules，跑 `npm run test:rules`。
4. 若動 E2E 或 UI，至少跑 `npm run test:e2e:smoke -- --workers=1`；若動到完整流程、手機版、後台或路由，需加跑對應 project 或 `npm run test:e2e:full`。
5. 更新測試矩陣與 `docs/test-coverage.md`。

## 15. 審計結論

目前測試基礎不差，但不能稱為完整覆蓋。最主要問題不是測試太少，而是：

1. E2E 部分測試保護力偏低。
2. coverage 沒有形成治理能力。
3. Cloud Functions 行為測試不足。
4. CI 有測試，但缺少分層與 coverage 資訊。
5. 部分長期 warning 會削弱測試可信度。

依本計劃分階段補完後，測試體系會從「有很多測試」升級成「能針對高風險功能攔截回歸」。

## 16. 二次審計修補紀錄

2026-05-15 以自動化測試專家角度重審後，已補入以下中型缺口：

1. 補入 E2E Test Harness 規格，避免 E2E 依賴殘留登入狀態、真實外部服務或不可控資料。
2. 補入禁止測試複製版邏輯規則，要求新測試優先 import production helper；短期 mirror test 必須被標記並納入 source-drift 追蹤。
3. Phase 3 將活動頁 stale/fresh 問題改成自動化驗收，手動抽查降為輔助。
4. Phase 6 將 Cloud Functions 測試拆成 mock admin SDK 快速層與 emulator 真實邊界層，並把高風險 callable 提升到 P0/P1。
5. CI 設計補入 E2E 分層腳本與 Playwright project，避免未來每次 push 跑完整 E2E 導致慢與不穩。

修補後仍保留的風險：

1. 若現有大型 `App` 模組短期無法抽 helper，部分 unit test 仍可能需要 mirror；此風險已透過 6.5 限制其計入方式。
2. Functions emulator 成本較高，因此計劃採取少量關鍵 integration，而不是所有 callable 全部 emulator 化。
3. Visual smoke 只做客觀邊界，不處理主觀美術判斷。

二次審計結論：目前計劃書已沒有需要先修正的重大瑕疵；中型缺口已補入可執行規則與驗收標準。後續可依 P0 開始實作。

## 17. 各步驟可能產生 BUG 的風險審計

本節以「實作測試計劃本身也可能引入 bug」為前提，逐步檢查每個階段的風險。風險等級定義：

| 等級 | 意義 |
|---|---|
| 高 | 可能影響正式功能、權限、安全、資料寫入或部署穩定性 |
| 中 | 可能造成 CI 不穩、測試誤判、開發流程卡住或局部功能回歸 |
| 低 | 多屬文件、測試描述、局部 selector 或可快速回復的問題 |

### 17.1 Phase 0：測試治理基礎

| 步驟 | 可能產生的 bug / 風險 | 等級 | 防護方式 |
|---|---|---:|---|
| 更新 `docs/test-coverage.md` | 寫入過期數字，導致後續判斷錯誤 | 低 | 更新前重新跑基線，文件標明測試日期與命令 |
| 新增測試矩陣 | 把 mirror test 誤算成正式覆蓋，造成假安全感 | 中 | 在矩陣欄位明確區分 production helper / mirror / E2E / rules |
| 加入 coverage summary artifact | CI artifact path 錯誤會讓 CI 失敗 | 中 | 先在分支測 GitHub Actions，artifact 失敗不得阻斷 runtime |
| 暫不設全域 threshold | coverage 長期無治理可能被忽略 | 中 | 只暫緩全域門檻，同步建立高風險 helper 局部門檻 |
| 建立 E2E harness skeleton | mock 注入污染全域 `window`，影響其他 E2E | 高 | 每個測試前清理 storage/cache/mock；helper 只在測試環境載入 |
| 盤點 mirror-style tests | 錯刪仍有保護力的測試 | 中 | 只先標記，不直接刪；刪除前需有替代測試或明確理由 |

### 17.2 Phase 1：撤除或改造無意義測試

| 步驟 | 可能產生的 bug / 風險 | 等級 | 防護方式 |
|---|---|---:|---|
| 改寫 `example.spec.js` 條件式點擊 | selector 過嚴導致 E2E flaky | 中 | 使用 `data-testid` 或穩定 route，不綁易變文案 |
| 改寫 `smoke-journeys.spec.js` 永遠成立 assertion | 從過鬆變過嚴，導致 CI 被環境差異卡住 | 中 | 先用 deterministic fixture，不依賴 production 資料 |
| 修正 mojibake 測試名稱與靜態頁 assertion | 編碼處理錯誤可能污染測試檔 | 中 | 僅用 `apply_patch`，修改後檢查 UTF-8 與 diff |
| `script-deps.test.js` 改 allowlist + fail-hard | 合法的 lazy module 被誤判 orphan | 中 | allowlist 必須附理由與 owner；先警告一輪再 fail-hard |
| `source-drift.test.js` 清 stale annotations | 移除後失去來源追蹤 | 中 | 只刪無法維護的 annotation；可定位者改成穩定 mapping |
| 全 repo 低價值 assertion 掃描 | 機械掃描誤判合理測試 | 低 | 掃描只產生候選清單，由人工確認後改寫或刪除 |

### 17.3 Phase 2：權限與 user 開團防線

| 步驟 | 可能產生的 bug / 風險 | 等級 | 防護方式 |
|---|---|---:|---|
| 測 `rolePermissions` cache shape | 測試 mirror 現有錯誤格式，讓錯誤制度化 | 中 | 以 production helper 或規格文件為準，不以現有壞資料為準 |
| 測 `roleActivityCapabilities/user` override | fallback 與 Firestore override 優先序寫錯，造成刷新後回預設 | 高 | 測 array/object/missing/stale 四種資料形狀，且驗證刷新後仍保留 |
| user basic create allowed | 規則放太寬，可能讓 user 開到不該開的功能 | 高 | Rules 測試同時寫 allow 與 deny；只允許基本欄位 |
| addons denied | 前端 toast 有但後端仍可寫入，造成繞過 | 高 | 前端 toast + Firestore Rules/Callable deny 都要測 |
| add-ons capability create allow | `user.activity.addons_use` 放太寬，讓 user 開到 team-scoped 或管理級功能 | 高 | 分開測非團隊加值 allow 與 `teamOnly/isPublic/creatorTeamId` deny |
| owner add-ons edit | owner 編輯加值欄位時 create 規則通過但 update 規則拒絕，造成「建立可行、編輯失敗」 | 高 | 同一 fixture 同時測 create 與 update，欄位覆蓋 fee/private/gender/teamSplit/socialLinks |
| delegate add-ons edit deny | delegate 基本編輯權被誤放大成加值編輯權 | 高 | delegate 可改 title/location，但改 fee/private/teamSplit/socialLinks 必須 deny |
| private event capability | capability 路徑或 key 命名不一致，導致 user 建立失敗 | 高 | 測權限管理開關、刷新、建立活動三段完整鏈路 |
| coach/captain/venue_owner 私密活動可見性 | 過度收緊導致 owner/delegate 看不到自己活動 | 高 | 測「非自己不可見」與「自己/委託可見」兩邊 |
| 權限管理 E2E | 假登入或殘留角色導致測試假通過 | 中 | 必須使用 E2E harness 固定角色與清理瀏覽器狀態 |

### 17.4 Phase 3：活動報名與資料一致性

| 步驟 | 可能產生的 bug / 風險 | 等級 | 防護方式 |
|---|---|---:|---|
| 新資料不可被舊 snapshot 覆蓋 | 測試只覆蓋單一順序，漏掉反向 race | 高 | stale/fresh 與 fresh/stale 兩種順序都測 |
| registration count canonical source | 選錯 canonical source，導致報名數與實際名單不一致 | 高 | 明確定義 confirmed summary、registrations、participantsWithUid 的優先序 |
| `participantsWithUid` stale 不覆蓋 | 舊欄位仍被其他 render path 使用 | 高 | 搜尋所有 render path，測 DOM 最終狀態 |
| waitlist promotion 排序 | 同時間報名排序不穩 | 中 | 固定 timestamp + doc id tie-breaker |
| event ended 判斷 | 時區或日期格式錯誤造成活動提早/延後 ended | 高 | 使用台灣時區、ISO/local 字串、缺值三種案例 |
| ApiService update/create failure | mock 與真實 Firebase error shape 不同 | 中 | 測 `code`、`message`、無 code 三種錯誤 |
| FirebaseService cache merge | merge helper 抽離時改變現有資料形狀 | 高 | 抽 helper 前後用同一 fixture 做 snapshot 對比 |
| Rules: 自己報名/取消 | 權限過寬可取消別人報名 | 高 | allow self + deny other 同時測 |

### 17.5 Phase 4：首頁關鍵資訊

| 步驟 | 可能產生的 bug / 風險 | 等級 | 防護方式 |
|---|---|---:|---|
| 我的下一場活動排序 | 主辦/委託/報名同時存在時選錯活動 | 中 | 同 fixture 同時放三種身分，驗證取最近時間 |
| 排除取消/已結束 | 已取消活動仍出現在首頁 | 中 | fixture 包含 canceled、ended、past-start |
| 1 小時 cache | stale cache 顯示太久或切換帳號後沿用他人資料 | 高 | cache key 必須含 UID；測換帳號後不讀前一人 cache |
| 運動快速入口排序 | 0 活動未隱藏或排序錯 | 低 | 測 0、1、多活動數排序 |
| 新增運動標籤 | icon path 或排序插入錯，影響全站分類 | 中 | 測 sport config 單一來源與所有使用處同步 |
| 即時資訊關閉不閃現 | 初始預設先 render 再關閉，造成刷新閃爍 | 中 | 初始 render 前先讀設定；E2E 檢查首屏沒有容器 |
| 小遊戲排行榜 | 無資料時破版或高度撐開 | 低 | 測 0、1、4、超過 4 名 |

### 17.6 Phase 5：私訊與通知

| 步驟 | 可能產生的 bug / 風險 | 等級 | 防護方式 |
|---|---|---:|---|
| 新私訊提示轉舊未讀 | timer race 導致桌機泡泡消失 | 中 | fake timers 測 6.5 秒、新/舊未讀交界 |
| 桌機與手機狀態一致 | viewport 分支不同造成只修到手機 | 中 | desktop + mobile project 都測 |
| 對話通知框與未讀小圖 | z-index 或條件判斷讓提示被遮住 | 低 | 測通知框開/關兩種狀態 |
| 私訊設定權限 | user 可修改他人通知設定 | 高 | Functions/Rules 測 caller uid 與 target uid |
| edit / recall / mark read | 可編輯或撤回他人訊息 | 高 | Callable 測 owner allow、other deny |
| mobile keyboard E2E | Playwright 無法完全模擬真實 iOS 鍵盤 | 中 | 用 viewport/visualViewport mock + 手動 iOS 抽查作輔助 |
| 毛玻璃遮罩不可觸控底層 | overlay pointer-events 設錯，底層仍可點 | 中 | E2E 點 overlay 外底層按鈕，驗證無反應 |

### 17.7 Phase 6：Cloud Functions 正式測試層

| 步驟 | 可能產生的 bug / 風險 | 等級 | 防護方式 |
|---|---|---:|---|
| 新增 `test:functions` script | CI 找不到 functions dependency 或 Node 版本不一致 | 中 | 與 Actions Node 24 對齊，先本地 dry run |
| 抽 dependency-injected helper | 抽離時改變 callable 行為或錯誤格式 | 高 | helper 抽離前後用 golden fixture 比對輸入輸出 |
| mock admin SDK 快速層 | mock 太假，漏掉 Firestore 實際限制 | 中 | 高風險流程至少補少量 emulator test |
| emulator 真實邊界層 | emulator 慢或 flaky，拖慢 CI | 中 | 只測報名、取消、私訊、管理用戶等關鍵路徑 |
| `registerForEvent` | transaction 實作與測試不一致，漏掉併發超額 | 高 | 測容量 0/1/滿額/候補，必要時補 transaction race model |
| `cancelRegistration` | 取消後 summary 未同步 | 高 | 測 registration、summary、activityRecords 三者 |
| `refreshMyActivityRecords` | 重建紀錄漏掉主辦/委託活動 | 中 | fixture 放報名、主辦、委託、已取消 |
| SportsAPI callable | 測試誤打真 API 消耗額度 | 高 | 環境變數阻擋真 key；fetch 必須 mock |

### 17.8 Phase 7：SportsAPI / 比分 / 中文詞庫

| 步驟 | 可能產生的 bug / 風險 | 等級 | 防護方式 |
|---|---|---:|---|
| quota 計算 | 台灣 08:00 歸零與 API 實際 reset 不一致 | 中 | 文件寫清楚為目前假設；測時區轉換與顯示 |
| sport tabs 正規化 | API sport id/name 改變造成 tab 對錯資料 | 中 | 使用 fixture 測 id、slug、display name mapping |
| live/upcoming/featured | 比賽時間時區錯，晚點比賽不顯示 | 中 | 測 UTC、台灣時間、跨日資料 |
| match detail cache key | 不同運動同 id 衝突 | 中 | cache key 必須含 sport + match id |
| 中文詞庫 translated/pending | 非英文原名被錯誤翻譯或覆蓋 | 中 | 測 keep original、needs review、conflict |
| 後台開關 | 關閉首頁顯示但前端仍短暫閃現 | 中 | 首屏 E2E 驗證不 render |
| AI 翻譯指引複製 | Clipboard API 在手機/LINE 失敗 | 低 | fallback 到選取文字或 toast 提示 |

### 17.9 Phase 8：廣告管理與首頁 banner

| 步驟 | 可能產生的 bug / 風險 | 等級 | 防護方式 |
|---|---|---:|---|
| overlay controls 固定 | 輪播切換時按鈕綁到錯誤 slide | 中 | 控制層獨立於 slide DOM，E2E 切換後再點 |
| dots 右下角 | 點擊區遮住 CTA 或 banner 連結 | 低 | bounding box 檢查不重疊 |
| 找活動彈窗 | query 帶錯地區/運動，活動頁篩選不一致 | 中 | 測地區 + 運動兩個參數進活動頁後仍存在 |
| 觀賽聚會連結類型 | URL 類型未驗證，可能導向錯誤或不安全網址 | 高 | 只允許白名單路由；外部網址需協定檢查 |
| 清空圖片 | 誤刪 Storage 圖片而非只清欄位 | 中 | 功能命名與測試明確驗證「清空引用」或「刪除檔案」 |
| 彈窗比例 | 編輯預覽比例與首頁不同造成上線後破版 | 中 | 用相同 aspect ratio 常數，unit 測設定來源一致 |

### 17.10 Phase 9：視覺與手機版安全 smoke

| 步驟 | 可能產生的 bug / 風險 | 等級 | 防護方式 |
|---|---|---:|---|
| screenshot smoke | snapshot 過度敏感導致大量無效失敗 | 中 | 不做全頁 pixel snapshot，只測 bounding box/overflow |
| 首頁容器寬度 | 測試只看一個 viewport，其他手機破版 | 低 | 至少 390x844 與 1280x720 |
| 我的下一場活動按鈕 | 文案長度造成按鈕破框 | 中 | 測中文長字串與窄版 |
| 女生專屬 tab | tab 超出右邊或分隔線錯位 | 低 | 測 scroll/overflow 與最後一個 tab 可見 |
| 聊天手機鍵盤 | Playwright 模擬不足，實機仍可能有差 | 中 | 自動測 overlay/viewport；保留 iOS LINE 手動抽查 |
| 品牌開機圖 | 圖片載入慢時測試誤判偏移 | 低 | 等 image complete 後再量測 |

### 17.11 跨階段共通風險

| 風險 | 可能影響 | 等級 | 防護方式 |
|---|---|---:|---|
| 新增測試時順手改功能碼 | 可能引入與測試無關的功能 bug | 高 | 每階段限制改動範圍；功能修復另開 commit/階段 |
| 測試依賴正式資料 | 污染 production 或測試不穩 | 高 | 所有外部服務 mock/emulator；禁止 production credentials |
| CI 太慢 | 開發者略過測試或 push 卡住 | 中 | smoke/full 分層，full 改夜間或手動 |
| helper 抽離過大 | 大型重構造成回歸 | 高 | 每次只抽單一純函式，抽離前後 fixture 對比 |
| 文案 selector 過多 | UI 文案微調造成測試失敗 | 中 | 用 `data-testid`、route、state |
| 測試資料未清理 | 測試之間互相污染 | 中 | `beforeEach` 清理 storage/cache/mock，必要時每測試新 context |
| 版本/Service Worker cache | 測試跑到舊資源 | 中 | E2E 啟動前 unregister service worker、清 cache |

### 17.12 三次審計結論

這一輪風險審計後，計劃書本身沒有需要中斷的重大設計瑕疵；但實作時最容易產生 bug 的位置是：

1. E2E harness 如果清理不徹底，會造成假通過或 flaky。
2. 權限與 Firestore Rules 若只測 allow、不測 deny，容易放大 user 權限。
3. 活動頁 stale/fresh 修復若沒有雙向 race 測試，舊資料覆蓋問題會復發。
4. Cloud Functions helper 抽離若過大，可能改變 callable 行為。
5. SportsAPI 測試若沒有強制 mock，可能消耗正式 API 額度。

因此後續開始實作時，建議每階段都先做「最小測試基礎」再補案例，不要一次大量重構。P0 階段的安全順序應為：

1. E2E harness 與清理機制。
2. 權限 deny/allow rules。
3. 活動 stale/fresh race 測試。
4. 高風險 callable 快速層測試。
5. 再處理 E2E 無意義測試改寫。
