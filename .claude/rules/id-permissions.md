---
paths:
  - "js/**"
  - "functions/**"
  - "firestore.rules"
  - "pages/**"
  - "index.html"
  - "app.js"
  - "scripts/**"
  - "tests/firestore-rules/**"
  - "tests/unit/**"
---

# 實體 ID、後台權限與 user capabilities

> 本檔是 `CLAUDE.md` 的領域規則檔，以下 Rule ID 的 canonical 定義在此。條文中的「本檔」除非明確指特定檔案，一律指整個生效規則集（`CLAUDE.md` 加全部規則檔），標記的權威層級不因所在檔案而異。標記、權威順序與授權模式見 `CLAUDE.md` §0；修改本檔後必須跑 `node scripts/check-rules-integrity.js`。

## 9. Exact Contract Registry：ID 與權限

### 9.1 實體 ID

- **R-ID-001 [A/HARD]**：新建／重構遵守一實體一 canonical ID；正常 legacy 不做無關大遷移。
- **R-ID-002 [A/HARD]**：用戶唯一身份是 Firebase Auth UID（= LINE userId）。新增操作者／所屬用戶資料必含 UID；禁 displayName／name 作身份查詢。
- **R-ID-003 [A/HARD]**：欄位：`users` → `uid/lineUserId`；`registrations` → `userId`；`attendanceRecords`、`activityRecords`、`expLogs`、`operationLogs` → `uid`；`events` → `creatorUid`。
- **R-ID-004 [A/HARD]**：俱樂部 ID 由 `generateId('tm_')` 產生（`tm_<timestamp>_<random>`），用 `db.collection('teams').doc(teamId).set(data)`；`users.teamIds`、`events.creatorTeamIds`、`tournaments.hostTeamId` 存該 ID。幹部用 `captainUid`／`leaderUids`／`coachUids`；`captainName`／`leaderNames`／`coachNames` 只顯示 cache。
- **R-ID-005 [A/HARD]**：賽事 ID 由 `generateId('ct_')` 產生（`ct_<timestamp>_<random>`），用 `.doc(tournamentId).set(data)`；委託用 `delegateUids`，`delegateNames` 只顯示。
- **R-ID-006 [A/HARD]**：除本規則明列的決定性複合鍵外，隨機／時間型新 ID 統一用 `generateId(prefix)`，禁止以字串拼接自行模擬；`tm_`俱樂部、`ct_`賽事、`ce_`活動、`reg_`報名、`cm_` match。`ta_` 賽事申請是決定性例外：`tournaments/{tournamentId}/applications/{applicationId}` 的 `applicationId` 必須精確為 `ta_${teamId}`，同一賽事／俱樂部重用同一文件鍵，禁止改成 `generateId('ta_')`。`fp_`貼文、`fc_`留言是目前停用的動態牆保留契約；若功能恢復，分別用 `generateId('fp_')`、`generateId('fc_')`。
- **R-ID-007 [A/HARD]**：新活動用 `events.doc(eventId).set(...)` 或 transaction；`data.id === _docId === eventId`；禁 `add()`。ID 限 `[A-Za-z0-9_-]{1,120}`。
- **R-ID-008 [A/HARD]**：舊活動可能 public `data.id` + 隨機 `_docId`；保留雙軌，不大量搬。
- **R-ID-009 [A/HARD]**：`registrations.eventId`、`attendanceRecords.eventId`、`activityRecords.eventId` 永遠存 public `data.id`。
- **R-ID-010 [A/HARD]**：寫 `events/{docId}/...` 前用 `FirebaseService._getEventDocIdAsync(eventId)` 或後端等價 helper：先 `events/{eventId}`，再 fallback `where('id','==',eventId)`。
- **R-ID-011 [B/HARD]**：統計歸零／join 失敗先查 public eventId 與 `_docId` 混用。

### 9.2 後台權限

- **R-IAM-001 [A/HARD]**：新增／改後台功能先評估權限；需分層者在 `ADMIN_PAGE_EXTRA_PERMISSION_ITEMS` 或 `DRAWER_MENUS` 加 code，`getDefaultRolePermissions()` 設各層 default。
- **R-IAM-002 [B/HARD]**：同步 `js/modules/user-admin/user-admin-perm-info.js#_PERM_INFO` 的 `{title, body}` 白話說明。
- **R-IAM-003 [B/HARD]**：改 `DRAWER_MENUS`、`ADMIN_PAGE_EXTRA_PERMISSION_ITEMS`、`ROLE_ACTIVITY_CAPABILITY_ITEMS`、`rolePermissions`、`roleActivityCapabilities` 時，更新權限測試並查 `js/modules/user-admin/permission-audit/` 覆蓋所有角色、入口、子權限、user capabilities、高風險組合。
- **R-IAM-004 [A/HARD]**：`event.edit_all` 是跨全活動編輯唯一總開關；無它只能在 owner／delegate record scope 內依 action-specific helper、permission 或 capability 執行被明確允許的操作。`activity.manage.entry` 的目標語意只代表入口可見，禁止新路徑把它當泛用動作授權。**已知 drift**：前端 `_hasActivityManageEntry()` 與 Rules `hasActivityManageEntry()` 仍含 coach+ 角色 fallback，且 Rules 會把它用於 scoped event update；Functions `getCallerAccessContext()` 會合併個別授權，而 `canOperateEventSiteForAccess()`／`canManageSingleEventRosterForAccess()` 對 coach+、`activity.manage.entry` 或 `event.edit_all` 直接回傳跨活動通過，未驗 owner／delegate scope，`cancelRegistration` 的 `manager_remove`／`capacity_change` 會使用此路徑。因此關閉 staff 的 `rolePermissions` 目前不能視為已完整撤回後端 scoped activity 能力；一般 user 個別取得 `activity.manage.entry` 也可能在 Callable 取得超出入口語意的跨活動名單操作。這些都是待修授權 drift，不得複製或當目標契約。
- **R-IAM-005 [B/HARD]**：不確定需否加權限時，說明需求、建議 code／層級，由使用者決定。
- **R-IAM-006 [B/HARD]**：入口 code 以 `.entry` 結尾；子權限按動作，如 `.create`、`.edit_all`、`.delete`。
- **R-IAM-007 [A/HARD]**：code 改名同步 `js/config.js`、`functions/index.js` legacy normalization、permission-audit。
- **R-IAM-008 [A/HARD]**：`INHERENT_ROLE_PERMISSIONS` 同時在 `js/config.js`、`functions/index.js`；改任一邊同步另一邊並驗 parity。coach／captain／venue_owner 的陣列為空，不代表後端已可完整撤權；權限稽核必須同時檢查 `firestore.rules#hasActivityManageEntry()` 的 `isCoachPlus()` fallback，以及 Functions `getCallerAccessContext()` → `hasActivityManageEntryAccess()` → `canOperateEventSiteForAccess()`／`canManageSingleEventRosterForAccess()` 的 scope。修正此 drift 時同步前端、Functions、Rules 與 tests，覆蓋 coach+、角色權限關閉、一般 user 個別 grant、非 owner／delegate 的 allow／deny。
- **R-IAM-009 [B/HARD]**：查看類 render 預設登入用戶可見；編輯、刪除、簽到才守衛。
- **R-IAM-010 [A/HARD]**：禁只寫 `if (!hasPermission(...)) return`，也禁把 `.entry` 或泛用 `_canManageEvent(e)` 當動作授權。跨活動編輯只認 `event.edit_all`；編輯依 `_canEditOwnActivityBasic`，取消依 `_canCancelOwnActivity`，結束／重開／重新上架依 `_canReopenOrRelistActivity`，刪除依 `_canDeleteActivity`，現場操作依 `_canOperateEventSite`，正取移除再依 `_canRemoveConfirmedParticipant`。delegate 只界定 record scope，不是獨立 action grant；每個 helper 仍須依角色 permission／user capability／明列 fallback 判斷。拒絕時 Toast 後 return。
- **R-IAM-011 [A/HARD]**：按鈕顯示與 handler 使用同一 action-specific permission／helper；禁止一寬一窄。
- **R-IAM-012 [B/HARD]**：逐動作測 `user`、`coach`、`captain`、owner、delegate；一般 user delegate 同時覆蓋有／無 `own_edit_basic`、`own_cancel`、`site_operate`，並分開驗編輯、取消、結束、重開、現場操作、正取移除與刪除。
- **R-IAM-013 [A/HARD]**：現行 delegate 契約：一般 user delegate 有 `user.activity.own_edit_basic`／`own_cancel` 時可編輯基本資料／取消；明列 delegate 即使沒有 `site_operate` 仍可進 `_canOperateEventSite` 的現場操作，但 `_canRemoveConfirmedParticipant` 仍須額外條件；staff delegate 因目前 entry／coach+ fallback 可編輯、取消、結束與重開／重新上架。delegate 身分本身不授予刪除，也不授予設定其他 delegate；刪除只依 `_canDeleteActivity`，delegate 管理只限 owner 或全域管理者。

### 9.3 一般 user capabilities

- **R-CAP-001 [A/HARD]**：`rolePermissions/hasPermission` 與 `roleActivityCapabilities/user.capabilities` 是兩套系統；禁把 `activity.manage.entry`／`event.create` 直接下放 user。
- **R-CAP-002 [A/HARD]**：user capability 只控制自己主辦／受委託的 scoped activity，不改全域權限；Rules 用 `hasActivityCap(...)`。明列 delegate 的現場操作 fallback 是獨立 legacy contract：前端 `_canOperateEventSite` 與 Rules `isEventSiteOperatorForData` 可在沒有 `site_operate` 時接受 delegate，但不因此取得正取移除、編輯、取消或刪除；各動作仍依 R-IAM-010～013。
- **R-CAP-003 [A/HARD]**：UI 可手動啟閉；default 只初始化，不覆蓋既有。`capabilities: []` 代表全關，必須保留。

| Code | 語意 |
|------|------|
| `user.activity.basic_create` | 建基本活動 |
| `user.activity.external_create` | 建外部連結活動 |
| `user.activity.own_manage_entry` | 自己活動管理入口 |
| `user.activity.own_edit_basic` | 編自己主辦或受委託活動的基本資料 |
| `user.activity.own_cancel` | 取消自己主辦或受委託活動 |
| `user.activity.site_operate` | owner-scope 現場簽到／候補；delegate 例外見 R-IAM-013 |
| `user.activity.delegate_assign` | owner 設自己活動委託人 |
| `user.activity.addons_use` | 私密、收費、女生專屬、社群連結等加值欄位 |

- **R-CAP-004 [A/HARD]**：`addons_use` 預設關；未開阻擋並 Toast「如需更多功能請聯繫官方Line@」。開啟後前端完整 payload 與 Rules allow 一致。
- **R-CAP-005 [B/HARD]**：tests 至少：關閉拒絕、開啟可建、刷新保留。
- **R-CAP-006 [A/HARD]**：cache／localStorage／`ApiService.getRoleActivityCapabilities` 新 shape 固定 `{ user: ['capability.code'] }`；Firestore 文件陣列立即 normalize。
- **R-CAP-007 [A/HARD]**：即時監聽、靜態載入、localStorage、optimistic cache 都走 `_normalizeRoleActivityCapabilitiesCache`；ApiService 可讀 legacy 陣列，新寫入不得產生。
- **R-CAP-008 [A/HARD]**：`_seedRoleData()`／catalog migration 不得用 default 洗既有 capabilities。
- **R-CAP-009 [B/HARD]**：加／改 capability 同步 `ROLE_ACTIVITY_CAPABILITY_ITEMS`、Functions allowlist、Rules、`user-admin-roles.js`、unit／Rules tests，覆蓋 shape、legacy fallback、allow／deny。
- **R-CAP-010 [B/HARD]**：刷新回 default 先查 array shape／seed；私密活動失敗依序查 Firestore capability、前端讀值、Rules allow、其他受限 payload 欄位。

---

