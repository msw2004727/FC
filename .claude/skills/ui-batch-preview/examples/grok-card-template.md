# Grok CLI 派工卡範本：UI 預覽包腳本（scenes／harness／種子）

> 用法：複製成工作樹內 `.grok-input/<批次>-<項目>.md`，存成 **UTF-8 加 BOM**（PowerShell 5.1 讀無 BOM 會亂碼）；卡上路徑一律寫相對路徑（Grok 無人值守不支援 `--add-dir`）。一卡最多 5 項，超過拆卡。啟動指令與 deny 清單見 `delegate` skill「Grok 走 CLI」。交件由派工者另審（Grok 不當終審）。

## 任務
產出 `<批次資料夾>/<檔名>`（只寫這個檔／這幾個檔，其他檔一律不改）。

## 背景（只讀，已複製到 .grok-input/）
- 參考範本：`.grok-input/ref-scenes.mjs`（上一批 scenes.mjs）、`.grok-input/ref-harness.mjs`
- A 原始碼片段：`.grok-input/a-<頁面>.html`、`.grok-input/a-<模組>.js`（由派工者用 extract-symbols／pack-prompt 切好，含完整呼叫鏈）
- 本批項目與情境清單：`.grok-input/items.json`

## 規格
1. 情境名稱固定為：`<逐一列出>`（不得增減、不得改名）。
2. A 情境：本機離線開 A（所有 Firebase／Google／LINE 網路請求 abort），用 A 自己的 render 函式＋示意資料；示意資料只用假名與假 ID（不得出現真實 UID、email、電話、正式俱樂部名稱）。
3. B 情境：只連 emulator（127.0.0.1）與 dev server 5181；**禁止 `vite build`**。
4. 種子腳本只打 127.0.0.1，不得出現正式專案網址或金鑰。
5. 寫不出或缺資訊時，依合理假設實作並以 `// ASSUMPTION:` 標註，不要停下索取。

## 禁止
不 commit、不 push、不跑全套測試、不連任何外部網址、不改 `src/**` 與 FC 程式、不讀寫 `.grok-input/` 以外的祕密檔。

## 交件
- 修改的檔案清單＋每個 `ASSUMPTION` 一行摘要，寫到 `.grok-input/<卡名>-report.md`。
