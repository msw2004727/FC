---
name: ui-batch-preview
description: 要把 FC-B 某一批 UI/UX 改動整理成「給站長預覽」的包時使用：從 p75 UI/UX 盤點抽項目、附 PM 建議、A 正式站與 B 本機 A／B 並排截圖（390px 深淺色）、產生可離線開的單檔預覽頁並驗收。UI 派工前的預覽閘門（R-GOV-007）都走這份。
disable-model-invocation: false
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/*)
---

# ui-batch-preview

站長 2026-10-22 定案：UI/UX 改動派工前必須先讓站長預覽並同意。這份 skill 把「抽項目 → 截圖 → 預覽頁 → 驗收」做成四支腳本，第 4～9 批照抄設定檔即可。第 3 批的實際設定在 `examples/`。

## 前置

- B 本機：`npm run emulators`、`npm run seed:emulator`、`VITE_FIREBASE_EMULATOR=1 npx vite --port 5181 --strictPort`（都在 FC-B，背景執行）。**不得 `vite build`**（會直連正式資料庫）。
- emulator 啟動要十幾秒；用 `curl -s --retry 40 --retry-connrefused --retry-delay 2 http://127.0.0.1:8080/` 等它好了再 seed。
- A 正式站只以訪客身分截圖、只讀，不登入、不點任何寫入按鈕。

## 步驟

1. **設定檔**：複製 `examples/batch3.config.json`，改 `outDir`、`title`、`rule`、`groups`（盤點 group 全收）、`ids`（零星收的 U 項）、`decide`（需站長決定）、`bMissing`（B 尚未實作）、`pm`（每項 `[建議, 一句原因, 截圖情境名]`）、`extra`（指揮官追加、盤點沒有的項目，ID 用 `C-` 前綴）。
   - 盤點檔沒有「批次」欄位；批次範圍要依 `uiux-inventory.md`「建議施工批次順序」自己判斷，並把判斷寫進 `rule`，回報時附「盤點條數／追加條數」。
   - 先查 FC-B `git log` 有沒有前面批次已做掉的項目（第 3 批的 M-024、U-026 就是），已做的不列或標「已完成（請追認）」。
   - PM 建議用語固定：照舊版／採優化／建議略過／已完成（請追認）。
2. `node scripts/pick-items.mjs <config.json>` → `<outDir>/items.json`。
3. **截圖情境**：複製 `examples/batch3.scenes.mjs` 改情境；`node scripts/shots.mjs <scenes.mjs> <outDir>/shots [單一情境]`。B 不在 5181 時用環境變數 `B_BASE=http://localhost:5182`（平行 PM 分支各有自己的 dev server；2026-10-22 T-005a 新增）。
   - A 需登入的畫面截不到：設定檔 `loginOnly` 列這些情境、`loginFallback` 指定改用哪張 A 訪客圖，頁上自動註明。
   - 連登入都進不去的 A 畫面（例如名單編輯模式、整個簽到頁）：寫 `<outDir>/mocks-a.mjs`（匯出 `{ css: ['css/base.css', ...], scenes: [{ name, html }] }`，html 照抄 A 的 pages／render 函式輸出），跑 `node scripts/mock-a.mjs <mocks-a.mjs> <outDir>/shots`，會讀 FC 本機 css、用 A 的 `data-theme` 切深淺色，產出 `<情境>-A-<theme>.png`；再在 `mockNotes` 註明「依原始碼重現，非實拍」。範例見 `p75-uiux/batch4-preview/mocks-a.mjs`（2026-10-22 T-009 新增，取代第 3 批在情境裡手寫 setContent）。
   - 長表單分段截圖：mocks 情境加 `scrollTo: '<CSS 選擇器>'`（截圖前捲到該元素頂端，可用 `:has()`，例如 `.ce-row:has(button[onclick*="'max'"])`）與 `bodyClass`（例如 A 開表單時的 `create-event-modal-open`）；A 頁面片段可在 mocks 裡用 `fs` 直接讀 FC `pages/*.html` 切出來，不必手抄（第 5 批 `batch5-preview/mocks-a.mjs`）。一個項目只能掛一個 `shot`，多出來的分段圖用 `extra` 的 C- 項目（標「M-xxx 附圖」）承載。（2026-10-22 T-012 新增）
   - 每個項目的 `shot` 情境都必須同時有 A 與 B 兩張圖，否則預覽頁破圖、`verify.mjs` 不過。B 缺功能時也要截一張「目前畫面」（例如被掃者首頁），並在 `mockNotes` 寫明。
   - 只重跑單一情境（第三個參數）不會更新 `shots-report.json`；先跑完整版，再補跑單一情境。
4. 有長篇對照表（例如欄位對照 `fields.md`）時，設定檔加 `"appendix": ["fields.md"]`，`build-index.mjs` 會把它內嵌成頁尾可摺疊附錄（支援標題、表格、條列、行內 code／粗體；表格在框內橫向捲動，不造成整頁水平捲動）。（2026-10-22 T-012 新增）
5. `node scripts/build-index.mjs <outDir>` → `index.html`（單檔、離線、資料內嵌、深淺色截圖切換、需站長決定置頂琥珀色）。
6. `node scripts/verify.mjs <outDir>`：0 console error、0 破圖、無水平捲動才算過；會存 `overview-desktop.png`、`overview-mobile-dark.png`。再自己看一張需站長決定區塊的截圖。
   - 驗收截圖內容用 `node scripts/sheet.mjs <outDir> light <情境,…最多 6 個> <out.png>` 拼縮圖總表，一次看 6 組 A｜B，比逐張開圖省用量；被彈窗擋住、點擊失敗、mock 錯版一眼可見。（2026-10-22 T-017 新增）
7. 跑 `encoding-check`；確認 FC-B `git status` 乾淨（預覽任務不得改 `src/`）。

## 踩過的坑

- A 正式站進頁後會跳「有新版本可用」浮層蓋住下半部：`shots.mjs` 已自動按「稍後」，點卡片進詳情後要再呼叫一次 `h.dismissA`。
- A 詳情頁在內層容器捲動，`scrollIntoView` 常無效 → 用 `h.wheel(p, 650)`。
- `getByText` 會撈到隱藏頁面裡的同名字 → `h.scrollToText` 已加 `visible` 篩選。
- Playwright 按鈕名稱預設子字串比對：「管理名單」會先撈到「管理名單 / 出席紀錄」→ `h.clickButton(p, '管理名單', true)`。
- B 名單編輯要兩步：摘要卡「管理名單 / 出席紀錄」展開表格，表格內「管理名單」才進編輯模式。
- 預覽頁用 file:// 開，不能 `fetch('items.json')`，資料必須在產生時內嵌（`build-index.mjs` 已處理）。
- 「照 A」前先確認 A 的那段程式真的有呼叫端：第 4 批的被掃方通知（`attendance-notify.js#startAttendanceListener`）從未被呼叫，A 實際行為是「沒有通知」，盤點寫的是死碼（2026-10-22 T-009）。用 `git grep -n <函式名>` 與 `git log -S` 查。
- 前一個 PM 分支可能留著 emulator 與 5181 dev server：用 `Get-NetTCPConnection -LocalPort 5181` 查行程命令列，並 `curl -s http://localhost:5181/src/data/firebase.ts | grep VITE_FIREBASE_EMULATOR` 確認是 `"1"`（emulator 模式）才沿用；再 `npm run seed:emulator` 重灌種子。
- 產頁腳本當初是派 DeepSeek（`--effort low`）寫的，一次過；要改版面就改 `build-index.mjs`，不必再派。
- 欄位對照表派 MiMo（`--no-think`）時，它會把「無法確定」清單寫成無限重複直到輸出額度用完（T-012：`finish=length`、2185 行，表格本體完整），且行號換算不可靠（出現超過檔案長度的行號）。交件後：截掉重複段、A 出處改用 grep 依元素 id 重算、摘要數字依表格重數（範例 `batch5-preview/work/fix-fields.py`），再抽查 10 欄以上。（2026-10-22 T-012）
- B 的選項按鈕（`role=option`）文字被 `<Text>` 斷詞拆成多個 span，`getByRole('option', { name })` 比對不到 → 用 `p.locator('dialog[open] .ce-sport-option', { hasText: '足球' })`。B 表單在原生 dialog 內捲動，分段截圖用 `el.closest(...).scrollIntoView({ block: 'start' })`。（2026-10-22 T-012）
- B 元件用 `hidden` 屬性隱藏、但同元素的 class 有 `display:flex` 時，`hidden` 會失效（T-012 的活動地區開關）。盤點「B 有」的權限型隱藏欄位，要實測 `getComputedStyle(el).display`，不能只讀程式碼。
- 種子教練缺性別／生日／地區，B「我要開團」是 `aria-disabled`（點了只會開個資編輯），Playwright 的 click 會等到逾時。截建立活動相關畫面前 `node scripts/coach-profile.mjs on`，截完 `off` 刪回（只動 emulator；共用 emulator 的其他分支在這段時間看到的教練是「已填個資」）。（2026-10-22 T-018）
- **照 A 的尺寸驗收用量的，不要只看圖**：Playwright 在 A、B 量同一元件的 `getBoundingClientRect().height`，B−A ≤ 2px 才算過；改前改後各量一次。A 需登入的元件（例如類型選單）可把 A 原始碼的同一段 HTML 注入 A 訪客頁的 DOM 量（只在本機瀏覽器、不送請求），但**要連同 A 的外層容器一起注入**：T-018 只注入 `.ce-row label` 量到 16px，A 實際包在 `.modal-body`（行高 1.7）裡是 19.9px，差點誤判成 B 有問題。量測腳本範例 `p75-uiux/t018-line-height/work/measure.mjs`。（2026-10-22 T-018）
- 截改前／改後同一份 B 程式時，在 FC-B 開 worktree 跑自己的 dev server（`node_modules` 用 PowerShell `New-Item -ItemType Junction` 連到 FC-B），改前狀態用「暫時註解掉那行 import」取得，不必動共用目錄（別的分支的 5181 截圖不受影響）。但 worktree 裡 `npm run check` 會有 `scanner.test.ts` 9 個「Denied ID …zxing_reader.wasm?url」失敗（junction 讓 node_modules 落在 Vite fs.allow 之外），屬環境問題：全綠要在 FC-B 主目錄單跑。收尾先用 `(Get-Item <junction>).Delete()` 拆 junction 再 `git worktree remove`，以免刪到 FC-B 的 node_modules。（2026-10-22 T-018）
- 三欄並排（A｜B 改前｜B 改後）用 PIL 拼圖即可，範例 `p75-uiux/t018-line-height/compose.py`；A 是 mock 的情境在欄標註「依原始碼重現」。（2026-10-22 T-018）
- **emulator 是共用的，別的分支會改你補的種子**：T-017 補的教練個資，被同時在跑的 T-018 `coach-profile.mjs off` 刪掉，B 個人頁又跳「完善個人資料」蓋住畫面。自己的補種子寫成腳本（範例 `p75-uiux/batch6-preview/work/seed-pm.mjs`），**每次跑 shots 前重跑一次**，不要只在開工時跑。（2026-10-22 T-017）
- B 個人頁、開團等畫面遇到種子帳號缺性別／生日／地區會先跳「完善個人資料」：補種子時用 `updateMask` PATCH 只寫這三欄（seed-pm.mjs），不要整份覆寫 users 文件。
- 有權限碼才出現的卡（例如第二身份卡 `profile.secondary_identity`，A 對 role=user 一律關）：在 emulator 寫 `userPermissionGrants/{uid}`，**文件必須帶 `uid`（與文件 id 相同）與 `enabled: true`**，只有 `permissions` 陣列時 B 照 A 視為無效授權。（2026-10-22 T-017）
- B 個人頁的收折標題與卡內按鈕，Playwright `locator.click` 會等到逾時（判定不可操作）；截圖用 `p.evaluate(() => document.querySelector(sel)?.click())` 觸發 DOM click。私訊對話卡的名稱列會 stopPropagation（點名字跳個人頁），要點 `.pm-thread-preview` 才開對話。（2026-10-22 T-017）
- A 示意圖量大時派 DeepSeek 寫 `mocks-a.mjs`（`--effort low`，約 3 分鐘、52k 輸入）：規格寫死情境名與「class、文案逐字照附件 render 函式」，附件用 `pack-prompt.py` 依函式行號切。交件檢查三件事：①回覆常是 ```` ```js ```` 包住且只有 `===== END FILE =====`、沒有 FILE 開頭，`--split-dir` 會切不出檔，要手動去掉圍欄；②搜 `不確定` 註解——附件行號範圍切太短的函式（T-017 的收藏、報名紀錄）它會自己猜，PM 照完整函式補正；③跨檔 helper（例如皇冠 `_identityCrownBadgeHtml`）沒附就會用 emoji 代替，要補附件或自己補。範例 `p75-uiux/batch6-preview/work/mocks-spec.md`。（2026-10-22 T-017）
- 站長提供的截圖（通常只有淺色）：複製成某情境的 `<情境>-A|B-light.png` 與 `-dark.png`（同一張），並在 `mockNotes` 寫明「站長提供、只有淺色」；用 C- 附圖項目承載，不佔盤點項目的 shot（範例 `batch6-preview/work/owner-shots.mjs`）。（2026-10-22 T-017）
- 計畫書與 FC-B `docs/handover.md` 的現況描述可能過期：T-017 計畫書要標「入隊核准鈕需等 P 階段」，但 FC-B `git log` 顯示 P 階段已在 3da1d95 完成（handover 第 71、104 行沒更新）。標「已完成／需等」前一律以 `git log` 與程式碼為準，盤點的「B 沒有 X」也要 grep 確認（M-124 的 LINE 綁定其實已在活動頁）。（2026-10-22 T-017）
- **A 登入後的畫面優先用「A 自己的 render 函式＋示意資料」重現，不要請 LLM 手寫 HTML**（2026-10-23 T-021，取代 T-017 的「派 DeepSeek 寫 mocks-a.mjs」做法，俱樂部 25 張卡零 LLM 產圖）：scenes 的 A 情境 `run` 裡，先 `ScriptLoader.ensureForPage('page-xxx')` 載入該頁腳本、把 `App._requireProtectedActionLogin` 換成回 false、`ApiService.getCurrentUser`／`getAdminUsers`／`App.hasPermission` 換成示意身分（隊長、隊員、非成員），再把快取裡一筆真實資料用 `Object.assign` 改成示意值（名稱、成員、戰績），最後呼叫 A 原本的 `App.showTeamDetail`、`openTeamCreateFromTeamsPage`、`showPage('page-team-manage')` 等。外觀、文案、CSS 都是 A 實際程式，不會有手抄偏差。只改瀏覽器記憶體；訪客沒有 Firebase 寫入權限，且不點任何寫入鈕（不要真的按確認）。範例 `examples/a-harness.mjs`（`setupA(p, { role, perms, joinState })`、`openDetailA`）與 `p75-uiux/batch7-preview/scenes.mjs`。**注意**：`showTeamDetail` 載入後可能用伺服器資料覆蓋你改過的快取，需要「有編輯權限」的畫面要同時給 `perms: ['team.manage_all']` 才會出現編輯鈕與設定彈窗。
  - **安全閘（2026-10-23 經理PM 驗收 T-021 補）**：這個做法是在正式站 A 上跑、A 只連正式 Firestore（本機開 A 也一樣連正式庫，不會比較安全），所以「訪客沒有寫入權限」與「不點寫入鈕」不夠。下一批起 `setupA` 必須先用 Playwright `page.route` 擋掉所有 Firestore／Functions 寫入請求（`firestore.googleapis.com` 的 `:commit`、`:batchWrite`、`/Write/channel`，以及 `cloudfunctions.net`／`*.run.app` 的 POST），被擋時 `console.warn` 並讓該情境失敗；未補前不得再用此做法拍需要切示意身分的畫面。
- A 的「有新版本可用」浮層 id 是 `#sw-reload-deferred-prompt`，SPA 換頁後會再出現；`setupA` 用 `addStyleTag` 把它整個隱藏，比反覆按「稍後」可靠。要拍 toast 的情境不要再呼叫 `dismiss`（逾時等待會讓 toast 先消失）。
- A 詳情頁的 `scrollIntoView` 不一定有效（內層容器捲動）：`scenes.mjs` 的 `aScrollTo` 先找可捲動的祖先元素再設 `scrollTop`。
- A 在 LINE 外的行為實測：訪客點俱樂部卡 → 導去 LINE 登入頁（可直接拍成 A 實拍）；直接開 `/teams/<id>` 落在首頁；`?team=` 深連結被導去 miniapp.line.me。盤點的「訪客能否進入」類權限項目，先用 Playwright 實測再下建議。
- B 的錯誤畫面（Firestore 讀取失敗）擋 emulator 連線或回 503 都觸發不了（離線快取會回空清單）：在 `run` 裡 `p.route('**/src/features/…/xxx-repo.ts*', r => r.fulfill({ contentType: 'application/javascript', body: 'export async function loadXxx(){ throw new Error("offline") } …' }))`，再 `p.goto` 該頁（要整頁重載，route 才會套用到模組載入）。只動瀏覽器請求，不改 FC-B 原始碼。
- 預覽頁長識別字（函式名）會把卡片撐出右邊界：`build-index.mjs` 的 body 已加 `overflow-wrap: anywhere`。
- Grok（xai API）20 字實測回 HTTP 400 時直接退備援，不要再試；本批沒有需要 LLM 產碼的項目，只用 MiMo 做 A 原始碼查證（4 卡約 8 分鐘）與 Gemini 4 看圖。
- 拍整批：`shots.mjs` 外層是主題、內層是情境，A 站每個情境都要重新載入，25 個情境約 30 分鐘；改了 scenes 後別同時還跑著舊的整批（會用舊版覆蓋新圖），先停掉舊的再重跑受影響的情境。

