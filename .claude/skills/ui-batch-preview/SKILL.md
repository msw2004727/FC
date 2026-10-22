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
