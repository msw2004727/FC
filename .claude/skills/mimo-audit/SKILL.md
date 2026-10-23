---
name: mimo-audit
description: 要讓 MiMo 平行做「唯讀查證」時使用：逐條核對條目證據（path:line 是否存在、缺點是否仍在、B 已解決是否屬實）、或對照兩份文件找重疊。含寫卡範本、平行執行與剝開 claude -p JSON 輸出的腳本。
---

# mimo-audit

把「讀檔查證」派給 MiMo（經 Claude Code 無頭模式、只有 Read／Grep／Glob），PM 只讀結論與抽查。
（2026-10-22 T-002 收成 skill：取代每次手寫 runner 與解析腳本。）

## 何時用

- 一批條目要逐條核對 evidence 是否存在、A 是否已修、B 已解決是否屬實。
- 兩份文件要找「講同一件事」的條目。
- 不適用：需要寫檔、跑指令、看截圖的工作（MiMo 設定只開唯讀工具）。

## 步驟

1. **寫卡**：每張卡一個主題、**最多 5 條**，存成 `<卡片目錄>/card-<代號>.md`。卡首必寫：
   - 「只能用 Read／Grep／Glob，不得修改任何檔案。**最多讀 15 個檔案片段就要開始寫報告。**」
   - repo 絕對路徑；大檔（`docs/claude-memory.md`、`functions/index.js`、`index.html`、`app.js`）只 Grep 定位後讀 ±30 行。
   - 每條要回答什麼、輸出格式「只輸出一個 JSON 陣列」與欄位，例如
     `{"id","verdict":"成立|部分成立|不成立|已修復","evidence_found":"path:line＋重點","still_in_a","b_claim","note"}`。
   - 「不得輸出任何 UID、email、token、金鑰值」。
   - 條目用 JSON 貼在卡尾（由腳本從來源產生，不要手抄）。
2. **平行執行**（背景跑，約 5～10 分鐘）：
   `bash ${CLAUDE_SKILL_DIR}/scripts/run-cards.sh <卡片目錄> D:/Users/msw74/Documents/github/FC D:/Users/msw74/Documents/github/FC-B`
3. **解析**：`python -I ${CLAUDE_SKILL_DIR}/scripts/parse-results.py <卡片目錄>/audit.json <卡片目錄>/out-*.json`
   - 空檔＝還在跑；`subtype=error_max_turns`＝卡太寬，拆小重跑。
   - Windows 終端會把中文印成亂碼：結果一律寫成 UTF-8 檔再用 Read 看，不要直接 print。
4. **PM 抽查**：凡會改變結論的判定（「已修復」「不成立」→ 降級或刪除）都要自己 Grep 驗證 1 次；其餘抽 2～3 條。

## 已知坑

- **2026-10-23 T-024 實測**：5 張卡（每卡 7～8 題、max-turns 40）平行約 5 分鐘全部成功交件，`parse-results.py` 一次解析 38 題無失敗；`parsed.json` 再用幾行 Python 攤平成「題號｜結論｜假設影響｜證據」文字檔，比逐檔開 JSON 好讀。題目要求的 `fake_uid_impact` 之類「假設情境影響」欄位可直接當設計表素材，但每卡仍要抽查（本次 20 多條行號皆符）。
- 卡片要說明「背景用途」（為什麼查這件事）與「找不到就寫找不到並列出搜尋過的關鍵字」，MiMo 才不會硬湊；同一批若發現缺口，追加一張小卡（本次追加「UID 鍵集合盤點」卡）比擴充原卡好。

- `claude -p --output-format json` 的陣列在 `result` 字串裡，可能包 Markdown 圍欄；不能直接取 `[0]`。
- stderr 的 `unrecognized_model` 警告無害。
- MiMo 設定在 `C:/t/mimo-claude-home`，金鑰由 apiKeyHelper 讀，派工端不碰也不印。
- 行號常漂移：卡上要求「找到相同內容即可，回報實際行號」。
