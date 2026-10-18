---
name: ship-commit
description: 提交本次變更前的安全檢查流程。手動呼叫，用於把已確認的檔案以精確路徑加入暫存並建立中文 commit message。
argument-hint: "[files...]"
disable-model-invocation: true
allowed-tools: Bash(git status *) Bash(git diff *) Bash(git add *) Bash(git commit *) Bash(node scripts/check-rules-integrity.js *)
---

# ship-commit

把本次範圍的變更安全提交成一個 commit。禁止 `git add -A`／`git add .`（R-SAFE-003）；禁止 `git reset`／`git checkout --`／`git stash`（R-SAFE-002）。

輸出固定三段：`通過`／`失敗（列檔案:行號:原因）`／`需人工（說明）`。

## 步驟

1. 執行 `git status --short --branch`，記錄基線（R-SAFE-001）。
2. 列出本次範圍檔案：`$ARGUMENTS` 優先；無參數則從對話推得，並向使用者確認清單。
3. 若範圍含 `CLAUDE.md`／`AGENTS.md`／`GEMINI.md`／`NAVIGATION.md`／`.claude/rules/**`，先執行 `node scripts/check-rules-integrity.js`（含 NAVIGATION.md 時加 `--nav`），失敗則停下回報（R-GOV-015）。
4. 執行 `git add <精確路徑>`，逐檔列出，不使用 `-A` 或 `.`。
5. 執行 `git diff --cached --stat` 與 `git diff --cached` 審視暫存內容：無他人變更、無無關格式化、無秘密（R-SAFE-003～005、R-SAFE-011、R-EXEC-015）。
6. 以中文 commit message 提交：首行一句摘要，空行，條列關鍵變更，最後一行 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`（R-SHIP-016）。
7. 執行 `git log --oneline -1` 與 `git status --short --branch` 確認提交結果。
8. 回報三段輸出，並明說 push 需站長授權（R-SHIP-017～018、R-GOV-007）。
