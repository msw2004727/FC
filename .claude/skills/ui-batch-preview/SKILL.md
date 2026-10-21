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
3. **截圖情境**：複製 `examples/batch3.scenes.mjs` 改情境；`node scripts/shots.mjs <scenes.mjs> <outDir>/shots [單一情境]`。
   - A 需登入的畫面截不到：設定檔 `loginOnly` 列這些情境、`loginFallback` 指定改用哪張 A 訪客圖，頁上自動註明。
   - 連登入都進不去的 A 畫面（例如名單編輯模式）：用 A 原始碼的 inline style 在 Playwright `setContent` 重現一張示意圖，檔名照 `<情境>-A-<theme>.png`，並在 `mockNotes` 註明「依原始碼重現，非實拍」。
4. `node scripts/build-index.mjs <outDir>` → `index.html`（單檔、離線、資料內嵌、深淺色截圖切換、需站長決定置頂琥珀色）。
5. `node scripts/verify.mjs <outDir>`：0 console error、0 破圖、無水平捲動才算過；會存 `overview-desktop.png`、`overview-mobile-dark.png`。再自己看一張需站長決定區塊的截圖。
6. 跑 `encoding-check`；確認 FC-B `git status` 乾淨（預覽任務不得改 `src/`）。

## 踩過的坑

- A 正式站進頁後會跳「有新版本可用」浮層蓋住下半部：`shots.mjs` 已自動按「稍後」，點卡片進詳情後要再呼叫一次 `h.dismissA`。
- A 詳情頁在內層容器捲動，`scrollIntoView` 常無效 → 用 `h.wheel(p, 650)`。
- `getByText` 會撈到隱藏頁面裡的同名字 → `h.scrollToText` 已加 `visible` 篩選。
- Playwright 按鈕名稱預設子字串比對：「管理名單」會先撈到「管理名單 / 出席紀錄」→ `h.clickButton(p, '管理名單', true)`。
- B 名單編輯要兩步：摘要卡「管理名單 / 出席紀錄」展開表格，表格內「管理名單」才進編輯模式。
- 預覽頁用 file:// 開，不能 `fetch('items.json')`，資料必須在產生時內嵌（`build-index.mjs` 已處理）。
- 產頁腳本當初是派 DeepSeek（`--effort low`）寫的，一次過；要改版面就改 `build-index.mjs`，不必再派。
