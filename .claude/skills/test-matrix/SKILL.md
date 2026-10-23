---
name: test-matrix
description: 當改完程式需要決定要跑哪些測試時使用。依變更檔案選出 npm／node 檢查命令，執行後區分回歸失敗與環境問題。
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/select-tests.js *) Bash(git diff *) Bash(npm run test:*) Bash(npm run check:*)
---

# test-matrix

依本次變更檔案決定測試命令並執行。

## 流程

1. 取得變更清單：
   - 優先使用使用者提供的檔案清單。
   - 否則執行 `git diff --name-only HEAD`。
   - 未追蹤檔以使用者提供的清單補上。
2. 執行 `node ${CLAUDE_SKILL_DIR}/scripts/select-tests.js <files...>`；需要機器可讀輸出時加 `--json`。
3. 依輸出逐一執行建議命令。
4. 執行失敗時區分：
   - 回歸：程式或測試斷言失敗。
   - 環境問題：emulator、瀏覽器、外部服務或憑證缺失。
5. 以固定三段回報：
   - `通過`：列出已通過命令與結果。
   - `失敗（列檔案:行號:原因）`：列出回歸失敗。
   - `需人工（說明）`：列出環境問題與未執行命令。
6. 標出已知 drift：
   - `tests/firestore-rules/tournament-match-rules.test.js` 未被 aggregate 收錄（R-QA-008）。
   - `test:functions` 只跑 `tests/unit/cloud-functions.test.js`（R-QA-009）。
7. 需要 UI 瀏覽器驗證時標 `R-QA-010～013`。
8. 鎖定檔變更時標 `R-EXEC-016／R-STAT-001`。

## 邊界

- 不修改測試檔或程式碼。
- 建議命令需要授權或站長決定時，停下並回報。

## 乾淨 worktree 跑完整 unit（2026-10-23 T-020 補）

主目錄常有 docs 副本與 CRLF 污染，完整 `npm run test:unit` 在乾淨 worktree 判斷：
1. `git worktree add --detach <scratchpad>/wt HEAD`，把本次改動的檔 `cp` 進去（不 stash、不切分支）。
2. node_modules 用 PowerShell 建 junction：`New-Item -ItemType Junction -Path "<wt>
ode_modules" -Target "<FC>
ode_modules"`，`functions
ode_modules` 同樣做。（bash 內 `cmd //c mklink /J` 會因引號跳脫失敗。）
3. 跑完先拆 junction：`[System.IO.Directory]::Delete("<wt>
ode_modules")`（只刪連結）；**不要用 `Remove-Item -Recurse`**，PowerShell 5.1 可能連目標內容一起刪。再 `git worktree remove --force <wt>`（有複製進去的改動所以要 --force）。
4. 授權類改動可在 worktree 做一次突變檢查：把授權呼叫行註解掉，deny 案例應全紅，再還原。
