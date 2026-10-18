---
name: release-bump
description: 當主站 runtime 有變更且需要同步更新版號時使用。依指定版號或自動遞增呼叫既有腳本，並驗證四處版號一致。
disable-model-invocation: true
argument-hint: "[0.YYYYMMDD{suffix}]"
allowed-tools: Bash(node scripts/bump-version.js *) Bash(node ${CLAUDE_SKILL_DIR}/scripts/verify-bump.js *) Bash(git status *) Bash(git diff *)
---

# release-bump

依 `$ARGUMENTS` 同步主站版號；未給參數時由既有腳本自動遞增。

## 流程

1. 執行 `git status --short --branch` 記錄基線（R-SAFE-001）。
2. 確認本批含主站 runtime：JS、HTML、CSS、pages、SW。沒有就停下回報「不需 bump」（R-REL-006、R-REL-007）。
3. 若 `$ARGUMENTS` 非空：
   - 以 `^0\.\d{8}[a-z]*$` 驗證版號。
   - 不符格式就回報參數錯並停止（R-REL-002）。
   - 符合格式就執行 `node scripts/bump-version.js $ARGUMENTS`。
4. 若 `$ARGUMENTS` 為空，執行 `node scripts/bump-version.js`（R-REL-002）。
5. 執行 `node ${CLAUDE_SKILL_DIR}/scripts/verify-bump.js`；需要機器可讀輸出時加 `--json`。
6. 執行 `git diff -- js/config.js sw.js index.html`，整理版號變更摘要。
7. 以固定三段回報：
   - `通過`：列出驗證通過項目。
   - `失敗（列檔案:行號:原因）`：列出 verify-bump.js 的失敗。
   - `需人工（說明）`：列出待確認事項。
8. 在 `需人工` 明說 push／deploy 仍需站長授權（R-SHIP-017）。

## 邊界

- 只透過既有 `scripts/bump-version.js` 改版號。
- 不執行 git add、commit、push、deploy。
- 版號不一致時不自行手改其他檔案，回報失敗後停止。
