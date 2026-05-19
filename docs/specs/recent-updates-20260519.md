# 2026-05-19 近期系統更新索引

這份文件是第二身份、權限與錯誤診斷的快速查找入口。未來排查相關問題時，先看這份，再回到 `docs/architecture.md`、`docs/specs/firestore-schema.md`、`docs/test-coverage.md` 與 `docs/claude-memory.md`。

## 第二身份權限閘門

權限碼：`profile.secondary_identity`

第二身份現在納入一般第一套角色權限 `rolePermissions/{roleId}`。

- `user` 鎖死無權限。即使資料庫誤存這個權限碼，前端 helper、Firestore Rules、Cloud Functions 仍會拒絕 `user` 使用第二身份。
- `super_admin` 鎖死有權限，沿用既有 all-permissions 行為。
- 其他非 user 角色必須在權限管理中打開 `profile.secondary_identity` 才能使用第二身份。
- 權限關閉時，個人資料頁不顯示第二身份欄位，身份解析回到主身份，callable 寫入被拒絕，Firestore 直接寫入被拒絕，secondary 留言快照也被拒絕。

主要實作檔案：

- `js/config.js`：`PROFILE_FEATURE_PERMISSION_CATEGORY`，併入 role permission catalog。
- `js/api-service.js`：`canUseSecondaryIdentityFeature()`，保護第二身份設定與頭像 callable。
- `js/identity-resolver.js`：`allowSecondaryIdentity` 閘門；無權限時回主身份，不建立 secondary public snapshot。
- `js/modules/profile/profile-data-render.js`：隱藏第二身份卡片，並阻擋無權限的編輯、上傳、儲存。
- `js/modules/role.js`：套用 `[data-permission-code]` 元素可見性。
- `pages/profile.html`：第二身份卡片標記 `data-permission-code="profile.secondary_identity"`。
- `functions/index.js`：`commitIdentitySettings`、`commitSecondaryIdentityAvatar` 需要 `canUseSecondaryIdentityAccess()`。
- `firestore.rules`：`canUseSecondaryIdentity()` 保護 `identityPrivate/settings` 寫入與 secondary `identitySnapshot` 驗證。
- `js/modules/user-admin/user-admin-perm-info.js`：權限管理中的說明文字。

已完成的正式部署：

- GitHub/Pages：已推送 `main`。
- Firestore Rules：已部署到 `fc-football-6c8dc`。
- Functions：已精準部署 `commitIdentitySettings`、`commitSecondaryIdentityAvatar`。

## 第二身份資料邊界

第二身份只是顯示身份，不是授權 actor。

- 真實 actor 永遠是 `users/{uid}` 與 LINE UID。
- 私人設定存在 `users/{uid}/identityPrivate/settings`。
- 第二身份頭像 metadata 必須由 callable 驗證 Storage path、bucket、content type、size 後 commit。
- 公開 snapshot 只能保存 `identityId`、`displayName`、`avatarUrl`。
- 目前公開支援面是活動留言。
- 管理者追查時必須用 `authorUid` join；不要把 role、claims、permissions 或 root actor 細節寫進公開留言文件。

## 報名個資未補齊診斷

報名失敗若原因是必要個資缺漏，現在會保留業務錯誤碼，不再只顯示 generic Firebase Functions code。

- `event-detail-signup.js` 優先從 callable message/context 抓 `PROFILE_INCOMPLETE`，再 fallback 到 Firebase code。
- `error-log-diagnostics.js` 會移除 `functions/` 前綴、辨識 `PROFILE_INCOMPLETE`、歸類為低/一般嚴重度，並顯示「請補齊性別、生日、地區」。
- `error-log.js`、`error-log-insights.js` 使用 display-code helper，讓分組、詳情、搜尋、匯出都顯示 `PROFILE_INCOMPLETE`。

主要測試：

- `tests/unit/event-signup-error-code.test.js`
- `tests/unit/error-log-diagnostics.test.js`
- `tests/unit/error-log-insights.test.js`

## 驗收快照

第二身份權限化後最近一次相關驗收：

- 身份/權限精準單元測試：6 suites，640 tests passed。
- Firestore Rules：5 suites，552 tests passed。
- 完整單元測試：145 suites，3301 tests passed。

未來改這一區，最低驗收建議：

```bash
npx jest tests/unit/profile.test.js tests/unit/identity-resolver.test.js tests/unit/permissions-phase2-logic.test.js tests/unit/config-utils.test.js tests/unit/permission-audit-page.test.js tests/unit/cloud-functions.test.js --runInBand
npm run test:rules
npm test -- --runInBand
```
