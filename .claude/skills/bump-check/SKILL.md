---
name: bump-check
description: FC 主站跑完 node scripts/bump-version.js 之後、commit 之前使用：確認 index.html、js/config.js、sw.js 只換了主站版號，沒有誤改其他 ?v=（例如首頁快照 JSON 的圖片網址）。
---

# bump-check

`scripts/bump-version.js` 曾把 GitHub Actions 產生的 `boot-*-data` 快照 JSON 裡的圖片網址（如 `Nocoverimage%20set.png?v=0.20260923d`）一起改掉，違反 R-REL-003（2026-10-22 T-007 發現）。T-008 已修：腳本跳過所有 `<script type="application/json">` 區塊（`bumpIndexHtml`，測試在 `tests/unit/bump-version-script.test.js`）。仍建議每次 bump 後跑一次當保險（取代原「腳本修好前」的暫時做法）：

```
node scripts/bump-version.js
PYTHONUTF8=1 python -I .claude/skills/bump-check/scripts/verify-bump.py <舊版號> <新版號>
```

- 不加 `PYTHONUTF8=1` 時中文輸出在 Windows 終端會變 cp950 亂碼（檔案不受影響）。
- 輸出 `OK：只換了版號` 才 stage。
- 有「不只換版號」的行：確認都是誤改後加 `--restore`，腳本把那些行還原成「HEAD 原文只換版號」並重新檢查。
- 行數不同代表不是單純 bump，停下來看 diff。
- 只比對 HEAD 與工作樹，要在 bump 前 commit 其他改動（或確認這三個檔沒有別的未 commit 修改）。
