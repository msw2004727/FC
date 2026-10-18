---
name: memory-log
description: 把本次任務的問題、原因、修復與教訓追加到 docs/claude-memory.md。手動呼叫，用於記錄會話經驗供未來參考。
argument-hint: "[標題]"
disable-model-invocation: true
allowed-tools: Bash(git log *)
---

# memory-log

把本次任務的學習條目追加到 `docs/claude-memory.md` 檔尾。輸出固定三段：`通過`／`失敗（列檔案:行號:原因）`／`需人工（說明）`。

## 步驟

1. 確認 `docs/claude-memory.md` 存在（local-only，R-LOG-002）；不存在則回報「不建立」，流程結束。
2. 整理本次任務的「問題／原因／修復／教訓」四項。
3. 遮罩 UID、email、token、真實 event/team ID（R-SAFE-012、R-LOG-005）。
4. 以 `### YYYY-MM-DD — 標題` 條目追加到檔尾；同日多則依序寫在下方；只有資料完整性地雷、UID、架構決策、重複 2 次以上 bug 才加 `[永久]`（R-LOG-001、R-LOG-003）。
5. 若檔案行數超過 500，只回報 maintenance due，不執行清理（R-LOG-004）。
6. 回報三段輸出與追加的條目內容（R-LOG-001）。
