---
name: encoding-check
description: 當改了含中文的檔案後要檢查編碼時使用。檢查 BOM、UTF-8、mojibake；CR 只提醒。
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/check-encoding.js *) Bash(git diff *) Bash(git status *)
---

# encoding-check

檢查本次修改檔案的編碼與常見亂碼。

## 流程

1. 取得檔案清單：
   - 優先使用使用者提供的檔案清單。
   - 否則執行 `git diff --name-only HEAD`。
   - 用 `git status --short` 補上未追蹤檔。
2. 執行 `node ${CLAUDE_SKILL_DIR}/scripts/check-encoding.js <files...>`；需要機器可讀輸出時加 `--json`。
3. 依結果修正 BOM、非 UTF-8 或 mojibake；CR 只需確認 git 會正規化為 LF。
4. 以固定三段回報：
   - `通過`：列出通過檔案。
   - `失敗（列檔案:行號:原因）`：列出檢查失敗。
   - `需人工（說明）`：列出需確認的顯示或工具問題。
5. 在 `需人工` 提醒：終端亂碼不等於檔案損壞（R-ENC-005）。

## 邊界

- 只讀檢查，不自動改檔。
- 二進位檔跳過。
- 反引號 inline code 內容排除（R-ENC-004）。
