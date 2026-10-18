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
