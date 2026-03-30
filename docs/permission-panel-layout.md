# 權限管理面板 — 開關清單與排列順序

> 調整方式：修改 `js/config.js` 中 `DRAWER_MENUS` 陣列順序，權限面板會自動跟著變。
> 子權限定義在同檔案的 `ADMIN_PAGE_EXTRA_PERMISSION_ITEMS`。
> 固有權限定義在 `INHERENT_ROLE_PERMISSIONS`（不可關閉）。
> Firestore `permissions` 集合已清空，所有定義由程式碼內建管理。

---

## 目前排列順序

```
活動管理
    ├ 顯示入口              activity.manage.entry       (固有: coach+)   ✅ 已接線
    ├ 建立活動              event.create                                 ✅ 已接線
    ├ 編輯自己的活動         event.edit_self                              ✅ 已接線
    ├ 編輯所有活動           event.edit_all                               ✅ 已接線
    ├ 刪除自己的活動         event.delete_self                            ✅ 已接線
    ├ 刪除所有活動           event.delete                                 ✅ 已接線
    ├ 上架 / 下架活動        event.publish                                ✅ 已接線
    ├ 掃碼簽到 / 簽退        event.scan                                   ✅ 已接線
    ├ 手動簽到 / 簽退        event.manual_checkin                         ✅ 已接線
    └ 查看報名名單           event.view_registrations                     ✅ 已接線

賽事管理
    ├ 顯示入口              admin.tournaments.entry     (固有: coach+)   ✅ 已接線
    ├ 建立賽事              admin.tournaments.create                     ✅ 已接線
    ├ 管理所有賽事           admin.tournaments.manage_all                 ✅ 已接線
    └ 審核參賽申請           admin.tournaments.review                     ✅ 已接線

小遊戲管理
    └ 顯示入口              admin.games.entry                            ✅ Rules 接線

用戶管理
    ├ 顯示入口              admin.users.entry                            🔗 抽屜入口
    ├ 編輯基本資料           admin.users.edit_profile                     ✅ CF 接線
    ├ 修改用戶身分           admin.users.change_role                      ✅ CF 接線
    └ 限制 / 解除限制        admin.users.restrict                         ✅ CF 接線

廣告管理
    └ 顯示入口              admin.banners.entry                          ✅ 已接線

二手商品管理
    └ 顯示入口              admin.shop.entry                             ✅ Rules 接線

站內信管理
    ├ 顯示入口              admin.messages.entry                         ✅ Rules 接線
    ├ 撰寫廣播              admin.messages.compose                       ✅ 已接線
    └ 刪除站內信            admin.messages.delete                        ✅ 已接線

俱樂部管理
    ├ 顯示入口              admin.teams.entry                            🔗 抽屜入口
    ├ 建立俱樂部             team.create                                  ✅ 已接線
    ├ 管理所有俱樂部         team.manage_all                               ✅ 已接線
    ├ 管理自己的俱樂部       team.manage_self                              ✅ 已接線
    ├ 審核入隊申請           team.review_join                              ✅ 已接線
    ├ 指派俱樂部教練         team.assign_coach                             ✅ 已接線
    ├ 建立俱樂部專屬活動     team.create_event                             ✅ 已接線
    └ 切換活動公開性         team.toggle_event_visibility                  ✅ 已接線

數據儀表板
    └ 顯示入口              admin.dashboard.entry                        🔗 抽屜入口

佈景主題
    └ 顯示入口              admin.themes.entry                           ✅ 已接線

手動 EXP 管理
    └ 顯示入口              admin.exp.entry                              ✅ 已接線

自動 EXP 管理
    └ 顯示入口              admin.auto_exp.entry                         ✅ 已接線

系統公告管理
    └ 顯示入口              admin.announcements.entry                    ✅ 已接線

成就 / 徽章管理
    └ 顯示入口              admin.achievements.entry                     ✅ Rules 接線

日誌中心
    ├ 顯示入口              admin.logs.entry                             🔗 抽屜入口
    ├ 錯誤日誌讀取           admin.logs.error_read                        ✅ Rules 接線
    ├ 錯誤日誌清除           admin.logs.error_delete                      ✅ Rules 接線
    └ 稽核日誌讀取           admin.logs.audit_read                        ✅ Rules 接線

用戶補正管理
    ├ 顯示入口              admin.repair.entry                           🔗 抽屜入口
    ├ 歷史入隊補正           admin.repair.team_join_repair                ✅ 已接線
    ├ 放鴿子修改             admin.repair.no_show_adjust                  ✅ 已接線
    └ 系統資料同步           admin.repair.data_sync                       ✅ 已接線

無效資料查詢
    └ 顯示入口              admin.inactive.entry                         🔗 抽屜入口
```

---

## 接線狀態圖例

| 標記 | 含義 |
|:---:|------|
| ✅ | 前端 hasPermission / Firestore Rules hasPerm / Cloud Functions 已接線 |
| 🔗 | 控制抽屜入口顯隱（間接接線） |
| ○ | UI 預留開關（尚未接入前端守衛） |

---

## 被停用（不顯示在面板）

| 權限碼 | 原因 |
|--------|------|
| `admin.roles.entry` | 權限管理頁固定由 super_admin 控制 |

---

## 固有權限

coach / captain / venue_owner 固有，不可在面板中關閉：

```javascript
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
