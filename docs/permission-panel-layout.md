# 權限管理面板 — 開關清單與排列順序

> 調整方式：修改 `js/config.js` 中 `DRAWER_MENUS` 陣列順序，權限面板會自動跟著變。
> 子權限定義在同檔案的 `ADMIN_PAGE_EXTRA_PERMISSION_ITEMS`。
> 固有權限定義在 `INHERENT_ROLE_PERMISSIONS`（不可關閉）。

---

## 目前排列順序

| # | 分類 | 權限碼 | 開關名稱 | 最低角色 | 固有 |
|---|------|--------|----------|----------|:---:|
| 1 | **活動管理** | `activity.manage.entry` | 顯示入口 | coach | ✔ |
| 2 | | `event.edit_all` | 編輯所有活動 | coach | |
| 3 | **賽事管理** | `admin.tournaments.entry` | 顯示入口 | coach | ✔ |
| 4 | **小遊戲管理** | `admin.games.entry` | 顯示入口 | admin | |
| 5 | **用戶管理** | `admin.users.entry` | 顯示入口 | admin | |
| 6 | | `admin.users.edit_profile` | 編輯基本資料 | admin | |
| 7 | | `admin.users.change_role` | 修改用戶身分 | admin | |
| 8 | | `admin.users.restrict` | 限制 / 解除限制 | admin | |
| 9 | **廣告管理** | `admin.banners.entry` | 顯示入口 | admin | |
| 10 | **二手商品管理** | `admin.shop.entry` | 顯示入口 | admin | |
| 11 | **站內信管理** | `admin.messages.entry` | 顯示入口 | admin | |
| 12 | **俱樂部管理** | `admin.teams.entry` | 顯示入口 | admin | |
| 13 | | `team.create` | 建立俱樂部 | admin | |
| 14 | | `team.manage_all` | 管理所有俱樂部 | admin | |
| 15 | **數據儀表板** | `admin.dashboard.entry` | 顯示入口 | super_admin | |
| 16 | **佈景主題** | `admin.themes.entry` | 顯示入口 | super_admin | |
| 17 | **手動 EXP 管理** | `admin.exp.entry` | 顯示入口 | super_admin | |
| 18 | **自動 EXP 管理** | `admin.auto_exp.entry` | 顯示入口 | super_admin | |
| 19 | **系統公告管理** | `admin.announcements.entry` | 顯示入口 | super_admin | |
| 20 | **成就/徽章管理** | `admin.achievements.entry` | 顯示入口 | super_admin | |
| 21 | **日誌中心** | `admin.logs.entry` | 顯示入口 | super_admin | |
| 22 | | `admin.logs.error_read` | 錯誤日誌讀取 | super_admin | |
| 23 | | `admin.logs.error_delete` | 錯誤日誌清除 | super_admin | |
| 24 | | `admin.logs.audit_read` | 稽核日誌讀取 | super_admin | |
| 25 | **用戶補正管理** | `admin.repair.entry` | 顯示入口 | admin | |
| 26 | | `admin.repair.team_join_repair` | 歷史入隊補正 | admin | |
| 27 | | `admin.repair.no_show_adjust` | 放鴿子修改 | admin | |
| 28 | | `admin.repair.data_sync` | 系統資料同步 | admin | |
| 29 | **無效資料查詢** | `admin.inactive.entry` | 顯示入口 | super_admin | |

---

## 被停用（不顯示在面板）

| 權限碼 | 原因 |
|--------|------|
| `admin.roles.entry` | 權限管理頁固定由 super_admin 控制，不開放切換 |

---

## 固有權限說明

標記 ✔ 的權限為 coach / captain / venue_owner 的**固有權限**，取得該角色即自動擁有，無法在面板中關閉。

```javascript
// js/config.js
INHERENT_ROLE_PERMISSIONS = {
  coach:       ['activity.manage.entry', 'admin.tournaments.entry'],
  captain:     ['activity.manage.entry', 'admin.tournaments.entry'],
  venue_owner: ['activity.manage.entry', 'admin.tournaments.entry'],
};
```

---

## 角色層級

| Lv | 角色 | 說明 |
|----|------|------|
| 0 | user | 一般用戶（所有開關鎖定關閉） |
| 1 | coach | 教練 |
| 2 | captain | 隊長 |
| 3 | venue_owner | 場主 |
| 4 | admin | 管理員 |
| 5 | super_admin | 總管（所有開關鎖定開啟） |

---

## 如何調整

- **調整分類順序**：移動 `DRAWER_MENUS` 陣列中的物件位置
- **新增子權限**：在 `ADMIN_PAGE_EXTRA_PERMISSION_ITEMS` 對應的 page key 中加入項目
- **新增固有權限**：在 `INHERENT_ROLE_PERMISSIONS` 中加入權限碼
- **停用權限碼**：在 `DISABLED_PERMISSION_CODES` Set 中加入
