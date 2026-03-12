# 權限 Capability 真相表 2026-03-12

## 原則

- `super_admin` 是最高權限，不接受任何可配置角色超過它。
- `users.role` 是正式角色來源。
- `claims.role` 只作為 token mirror，不是正式授權來源。
- 任何可下放能力都必須同時在 UI、Firestore Rules、Cloud Functions 三層成立。

## super_admin only

| Capability / 功能 | UI 入口 | Firestore / Function | 備註 |
| --- | --- | --- | --- |
| `admin.roles.manage` | `page-admin-roles` | `customRoles` / `rolePermissions` / `permissions` 寫入 | 權限管理後台只能給 `super_admin` |
| `admin.audit.backfill` | 無一般入口 | `backfillAuditActorNames` | 只保留 `super_admin` |
| `admin.role_claims.backfill` | 無一般入口 | `backfillRoleClaims` | 只保留 `super_admin` |
| `admin.dashboard.full` | `page-admin-dashboard` | 後台儀表板資料讀取 | 目前維持 `super_admin` |

## delegable by permission

### 用戶管理

| Capability | UI | Firestore / Function | 說明 |
| --- | --- | --- | --- |
| `admin.users.entry` | `page-admin-users` 入口 | 無直接寫入；只控制頁面可見與可進入 | 只代表能進頁 |
| `admin.users.edit_profile` | 編輯基本資料按鈕 / 儲存 | `users.update` 非敏感欄位 | 可改 `region/gender/birthday/sports/phone` |
| `admin.users.change_role` | 角色欄位 / 儲存 | `users.update` 敏感欄位 + `syncUserRole` | 可改 `role/manualRole`，並同步 claims |
| `admin.users.restrict` | 限制 / 解除限制按鈕 | `users.update` 限制欄位 | 可改 `isRestricted*` 相關欄位 |

### 既有已能力化項目

| Capability | UI | Firestore / Function | 說明 |
| --- | --- | --- | --- |
| `team.create` | 球隊建立入口 | `teams.create` | 已存在 |
| `team.manage_all` | 球隊管理 | `teams.update` | 已存在 |
| `event.edit_all` | 活動管理 | `events.update` | 已存在 |
| `admin.repair.team_join_repair` | 補正頁按鈕 | `users.update` / `messages.read` | 已存在 |
| `admin.repair.no_show_adjust` | 補正頁按鈕 | `userCorrections.*` | 已存在 |

## role-level only legacy

下列項目目前仍是角色等級硬判斷，這次要逐步清掉：

- `page-admin-roles` 入口曾同時有 `permissionCode` 與 `super_admin` 頁級限制
- `user-admin-list.js` 的 `saveUserEdit()` / `toggleUserRestriction()` / `handlePromote()`
- `firestore.rules` 的 `isSafeAdminUserUpdate()`
- `functions/index.js` 的 `syncUserRole` 只認內建 `admin/super_admin`

## 這次改造後的落地標準

1. `super_admin` 永遠保留全部能力，且沒有任何自訂角色能超過它。
2. 權限管理後台不再出現在 permission toggle 清單中。
3. `admin.users.*` 的每一個能力都必須「開了就能用，關了就不能用」。
4. `admin` 不可再直接透過原始 `users.update` 寫 `role/manualRole/claims/isAdmin`。
5. 用戶角色改變後，新的 `rolePermissions` 與 claims 必須同步落實。
