# Smoke Test Checklist (F-01 Follow-up)

## 使用方式
- 在 `production` 模式執行
- 每項記錄：`PASS / FAIL / N/A`
- 若失敗，附上 console error 與操作步驟

## A. F-01 權限驗證
- [ ] 一般使用者：修改 `rolePermissions` 被拒絕（`PERMISSION_DENIED`）
- [ ] 一般使用者：建立 `customRoles` 被拒絕
- [ ] 一般使用者：修改他人 `users/{uid}` 被拒絕
- [ ] 一般使用者：建立 `events` 被拒絕
- [ ] `super_admin`：調整角色權限設定成功（權限 toggle / reset）
- [ ] `super_admin`：新增與刪除自訂角色成功
- [ ] 管理端寫入失敗時（模擬權限不足）：UI 顯示失敗提示且畫面回滾

## B. Claims 同步驗證
- [ ] 新使用者首次登入後取得正確 role claim（預設 `user`）
- [ ] `super_admin` 修改使用者 role 後，目標使用者重新登入權限正確
- [ ] `backfillRoleClaims` dry run 可回傳 `processed/failed/nextCursor`
- [ ] `backfillRoleClaims` 實跑可逐批完成（如資料量 > limit，使用 `nextCursor`）

## C. 基本流程 Smoke（F-01 後）
- [ ] 瀏覽首頁/活動列表無 console error
- [ ] 一般使用者報名活動成功
- [ ] 一般使用者取消報名成功
- [ ] 管理員進入後台頁面（users / roles / messages）無權限錯誤噴滿 console
- [ ] 管理員發送 admin message 成功
- [ ] 掃碼頁可開啟（不要求實機掃碼）

## D. 記錄欄位（手動填）
- 測試日期：
- 測試環境（domain / branch）：
- 測試帳號角色：
- 結果摘要：
