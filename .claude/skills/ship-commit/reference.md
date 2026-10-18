# ship-commit 參考

## 禁止動作

- `git add -A`／`git add .`：一律逐檔指定精確路徑（R-SAFE-003）。
- `git reset`／`git checkout --`／`git stash`：不得以任何方式還原或藏起變更（R-SAFE-002）。
- `git push`／deploy：skill 只能停下並回報，需站長授權（R-SHIP-017～018、R-GOV-007）。
- 暫存內容混入他人變更或秘密：停下回報（R-SAFE-004～005、R-SAFE-011）。
- 檔案路徑不確定時：先向使用者確認清單（R-SAFE-003）。

## Commit message 範例

```
修復活動報名重複送出與狀態顯示錯誤

- 報名送出後 disable 按鈕，避免連點
- 狀態 badge 改用 theme token，修正深色模式對比
- 新增報名流程單元測試

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

## 規則索引

本 skill 引用的 Rule ID（條文只在 `CLAUDE.md` 與 `.claude/rules/` 有 canonical 定義，此處不複製）：R-SAFE-001～005、R-SAFE-011、R-EXEC-014～015、R-GOV-007、R-GOV-015、R-SHIP-002、R-SHIP-016～018。
