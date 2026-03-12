# 成就 / 徽章 / 稱號 Phase 1~7 最終整合自驗

## 驗收目的
- 確認 Phase 1~7 的資料夾化、相容層、條件收斂、前後台顯示與最終收尾已整體閉環
- 以「第三方角度」重新檢查 render 污染、失效稱號、假條件殘留與載入鏈缺件

## 自動化整合驗收
- [x] Phase 1：`achievement/index.js`、getter 與 facade 入口仍可用
- [x] Phase 2：`stats.js` 的徽章數、稱號選項、應到 / 完成 / 出席率 helper 輸出正確
- [x] Phase 3：registry 只保留正式支援條件，`timeRange` 只剩 `none`
- [x] Phase 4：稱號 sanitize 只保留仍有效且已完成的稱號；儲存稱號仍能寫回使用者資料
- [x] Phase 5：後台 cleanup 會清掉假成就與 orphan badge，action 下拉不再露出假條件
- [x] Phase 6：`join_team`、`attendance_rate`、`complete_event` 依正式規格評估
- [x] Phase 7：成就頁 / 稱號 / 徽章改走只讀快照，不再於 render 過程呼叫 `_evaluateAchievements()` 寫回全域進度

## 第三方角度補驗收
- [x] 管理頁 render 不再寫回 achievement `current / completedAt`
- [x] 成就頁 render 不再寫回 achievement `current / completedAt`
- [x] 失效 legacy 稱號不再顯示於個人頁與稱號頁
- [x] `achievement/view.js` 已進正式 script 載入鏈與動態 loader 群組
- [x] 舊 facade 仍存在，既有呼叫點不需同步大改

## 執行紀錄
- [x] `node scripts/achievement-phase1-7-final-smoke.js`
- [x] 相關 JS 語法解析檢查
- [x] `git diff --check`
- [x] UTF-8 / 控制字元掃描（未發現 `U+FFFD`、BEL、PUA）

## 本輪特別修正
- 修正成就頁 / 稱號頁 / 後台 render 會污染全域 achievement 進度的問題
- 新增 evaluator 只讀快照 API，讓顯示層不再依賴「先 render 再寫資料」
- 補上 Phase 1~7 smoke script 與手動驗收表，讓後續回歸有固定入口
