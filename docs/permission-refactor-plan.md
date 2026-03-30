# ToosterX 權限系統統一重構 — 實作計畫書

> **文件狀態**：計畫書（未實作）
> **建立日期**：2026-03-30
> **審查團隊**：資安架構師、前端工程師、後端工程師、QA 工程師、專案經理（5 位 AI 專家一致認同）

---

## 一、目標與原則

### 1.1 目標

將目前 9 種不同的存取控制機制統一為「前端 `hasPermission()` + 後端 `hasPerm()`」雙層架構。

### 1.2 不可違反的原則

| # | 原則 | 說明 |
|---|------|------|
| **P1** | **super_admin 永遠擁有所有權限** | 前端 `getRolePermissions('super_admin')` 回傳全部啟用碼；後端 `isSuperAdmin()` 繞過所有檢查 |
| **P2** | **僅 super_admin 能控制權限開關** | Firestore Rules: `rolePermissions/{role}` 的 write 規則為 `isSuperAdmin()` 且已鎖定 |
| **P3** | **user 角色零後台權限** | `getRolePermissions('user')` 永遠回傳 `[]`；權限面板所有開關鎖定為關閉 |
| **P4** | **user 基礎功能絕不阻擋** | 報名、取消報名、候補、取消候補、加入球隊、退出球隊、瀏覽活動/俱樂部/個人檔案 — 這些功能**禁止加入任何 `hasPermission()` 或 `hasPerm()` 檢查** |
| **P5** | **後端是最終防線** | 前端權限檢查僅控制 UI 可見性；所有資料寫入必須由 Firestore Rules 或 Cloud Functions 驗證 |

---

## 二、現況分析（9 種機制）

| # | 機制 | 數量 | 類型 | 重構後狀態 |
|---|------|------|------|-----------|
| 1 | HTML `data-min-role` | 24 個頁面 + 2 個 div | 角色等級 | **Phase 1 移除** |
| 2 | DRAWER_MENUS `minRole` | 28 項 | 角色等級 | 保留為回退（`permissionCode` 優先） |
| 3 | DRAWER_MENUS `permissionCode` | 17 項 | 權限碼 | **主要存取控制** |
| 4 | `hasPermission()` | 65 處 | 權限碼 | **統一前端檢查** |
| 5 | `ROLE_LEVEL_MAP` 硬檢查 | 48 處 | 角色等級 | **Phase 2 替換**（22 處）/ 保留（26 處） |
| 6 | `INHERENT_ROLE_PERMISSIONS` | 3 角色 | 權限碼 | 保留不動 |
| 7 | Firestore Rules | 50+ 處 | 混合 | **Phase 4 驗證**（已實作 `hasPerm()`） |
| 8 | Cloud Functions | 50+ 處 | 混合 | **Phase 3 不動** |
| 9 | `this.currentRole ===` | 6 處 | 角色名稱 | 保留（super_admin 專屬邏輯） |

---

## 三、重構後目標架構

```
使用者操作
    ↓
┌─────────────────────────────────────┐
│ 前端（瀏覽器）                       │
│                                     │
│  hasPermission(code, role)          │
│    ├─ 讀取 rolePermissions/{role}    │
│    ├─ 合併 INHERENT_ROLE_PERMISSIONS │
│    └─ super_admin → 全部回傳 true    │
│                                     │
│  決定：頁面可見性、按鈕可見性、      │
│        選單項目、UI 元素             │
└──────────────┬──────────────────────┘
               │ 寫入資料
               ↓
┌─────────────────────────────────────┐
│ 後端（Firestore Rules + CF）         │
│                                     │
│  Firestore Rules:                   │
│    hasPerm(code) → 讀 rolePerms     │
│    isSuperAdmin() → 繞過            │
│    isAuth() → user 基礎功能         │
│                                     │
│  Cloud Functions:                   │
│    ROLE_LEVELS 角色等級（保留）       │
│    access.hasPermission(code)        │
│    isSuperAdmin 繞過                 │
└─────────────────────────────────────┘
```

---

## 四、四階段實作計畫

### Phase 1：移除 HTML `data-min-role`（前端頁面可見性）

#### 4.1.1 範圍

| 動作 | 數量 | 細節 |
|------|------|------|
| 移除 `data-min-role` | 17 個頁面 | 有 `permissionCode` 回退的頁面 |
| 保留 `data-min-role` | 5 個頁面 | 無 `permissionCode` 的特殊頁面 |
| 轉換為 JS 權限檢查 | 2 個 div | activity.html、team.html 的 my-section |

#### 4.1.2 可安全移除的頁面（17 個）

| 頁面 ID | 原 minRole | permissionCode | 所在檔案 |
|---------|-----------|----------------|---------|
| page-my-activities | coach | activity.manage.entry | activity.html |
| page-admin-tournaments | coach | admin.tournaments.entry | admin-content.html |
| page-admin-banners | admin | admin.banners.entry | admin-content.html |
| page-admin-shop | admin | admin.shop.entry | admin-content.html |
| page-admin-teams | admin | admin.teams.entry | admin-content.html |
| page-admin-messages | admin | admin.messages.entry | admin-content.html |
| page-admin-users | admin | admin.users.entry | admin-users.html |
| page-admin-exp | super_admin | admin.exp.entry | admin-users.html |
| page-admin-auto-exp | super_admin | admin.auto_exp.entry | admin-auto-exp.html |
| page-admin-dashboard | super_admin | admin.dashboard.entry | admin-dashboard.html |
| page-admin-achievements | super_admin | admin.achievements.entry | admin-system.html |
| page-admin-games | admin | admin.games.entry | admin-system.html |
| page-admin-themes | super_admin | admin.themes.entry | admin-system.html |
| page-admin-announcements | super_admin | admin.announcements.entry | admin-system.html |
| page-admin-logs | super_admin | admin.logs.entry | admin-system.html |
| page-admin-repair | admin | admin.repair.entry | admin-system.html |
| page-admin-inactive | super_admin | admin.inactive.entry | admin-system.html |

#### 4.1.3 必須保留的頁面（5 個）

| 頁面 ID | 原 minRole | 原因 | 處理方式 |
|---------|-----------|------|---------|
| page-admin-roles | super_admin | `admin.roles.entry` 在 DISABLED_PERMISSION_CODES 中，不可授權 | **保留 data-min-role** + _canAccessPage 硬編碼 super_admin 檢查 |
| page-admin-audit-logs | super_admin | 不在 DRAWER_MENUS 中（子頁面） | **保留 data-min-role** 或新增 `admin.logs.audit_read` 檢查至 _canAccessPage |
| page-admin-error-logs | super_admin | 不在 DRAWER_MENUS 中（子頁面） | **保留 data-min-role** 或新增 `admin.logs.error_read` 檢查至 _canAccessPage |
| page-scan | coach | 不在 DRAWER_MENUS 中 + 有 delegate 例外邏輯 | **保留 data-min-role** + 保留 `_isAnyActiveEventDelegate()` 回退 |
| page-team-manage | captain | 不在 DRAWER_MENUS 中（從團隊詳情頁進入） | **保留 data-min-role** + 保留現有團隊身分檢查邏輯 |

#### 4.1.4 需修改的檔案

| 檔案 | 變更 |
|------|------|
| pages/activity.html | 移除 page-my-activities 的 data-min-role |
| pages/admin-content.html | 移除 5 頁的 data-min-role |
| pages/admin-users.html | 移除 2 頁的 data-min-role |
| pages/admin-auto-exp.html | 移除 data-min-role |
| pages/admin-dashboard.html | 移除 data-min-role |
| pages/admin-system.html | 移除 7 頁的 data-min-role（保留 page-admin-roles、audit-logs、error-logs） |
| js/modules/role.js | `_canAccessPage()` 新增 5 個保留頁面的硬編碼檢查；`_applyRoleBoundVisibility()` 處理非頁面 div |
| js/config.js | 快取版本號更新 |
| index.html | 快取版本號更新 |
| sw.js | 快取版本號更新 |

#### 4.1.5 user 基礎功能影響評估

| 功能 | 頁面 | 是否有 data-min-role？ | Phase 1 影響 |
|------|------|----------------------|-------------|
| 瀏覽活動列表 | page-activities | **無** | **零影響** |
| 活動詳情 / 報名 / 取消 | page-activity-detail | **無** | **零影響** |
| 瀏覽俱樂部 | page-teams | **無** | **零影響** |
| 加入 / 退出俱樂部 | page-team-detail | **無** | **零影響** |
| 候補遞補 | 自動（firebase-crud.js） | **無** | **零影響** |
| 個人檔案 | page-profile | **無** | **零影響** |
| 站內信 | page-messages | **無** | **零影響** |

**結論：Phase 1 不會觸碰任何 user 基礎功能頁面。**

---

### Phase 2：替換 JS 硬編碼角色檢查（前端功能存取）

#### 4.2.1 48 處 ROLE_LEVEL_MAP 分類

| 分類 | 數量 | 動作 | 說明 |
|------|------|------|------|
| **(a) 替換為 hasPermission()** | 22 處 | 改用現有權限碼 | UI 可見性控制，非寫入路徑 |
| **(b) 業務邏輯保留** | 12 處 | 加註釋不動 | 團隊角色計算、成員驗證等內部邏輯 |
| **(c) super_admin 專屬保留** | 8 處 | 加註釋不動 | clearAllData、自訂層級 CRUD 等破壞性操作 |
| **(d) role.js 內部邏輯** | 6 處 | 不動 | _getEffectiveRoleLevel、drawer 渲染等基礎設施 |

#### 4.2.2 分類 (a)：替換為 hasPermission() — 22 處

| 檔案 | 行數 | 現有代碼模式 | 替換為 |
|------|------|-------------|--------|
| event/event-detail-signup.js | 17 | `>= ROLE_LEVEL_MAP.admin` | `hasPermission('event.edit_all')` |
| event/event-list-helpers.js | 216-217 | `>= ROLE_LEVEL_MAP.admin` | `hasPermission('event.edit_all')` |
| event/event-list-helpers.js | 226-227 | `>= ROLE_LEVEL_MAP.admin` | `hasPermission('event.edit_all')` |
| event/event-list-helpers.js | 254-255 | `>= ROLE_LEVEL_MAP.admin` | `hasPermission('event.edit_all')` |
| event/event-list-home.js | 49-50 | 角色等級比較 | `hasPermission('activity.manage.entry')` |
| event/event-manage-badges.js | 44-45 | `>= ROLE_LEVEL_MAP.admin` | `hasPermission('event.edit_all')` |
| event/event-manage.js | 178-179 | `>= ROLE_LEVEL_MAP.admin` | `hasPermission('event.edit_all')` |
| scan/scan.js | 29-30 | `>= ROLE_LEVEL_MAP.admin` | `hasPermission('event.edit_all')`（已有回退） |
| team/team-form-init.js | 158 | `>= ROLE_LEVEL_MAP.admin` | `hasPermission('team.manage_all')` |
| team/team-list-render.js | 87 | `>= ROLE_LEVEL_MAP.admin` | `hasPermission('team.manage_all')`（已有回退） |
| tournament/tournament-core.js | 215-216, 230-231 | `>= ROLE_LEVEL_MAP.admin` | `hasPermission('admin.tournaments.manage_all')` |
| tournament/tournament-manage-host.js | 33-35 | `>= ROLE_LEVEL_MAP.admin` | `hasPermission('admin.tournaments.manage_all')` |
| tournament/tournament-manage.js | 23-24 | `>= ROLE_LEVEL_MAP.admin` | `hasPermission('admin.tournaments.manage_all')` |
| ad-manage/ad-manage-core.js | 22-23 | `< ROLE_LEVEL_MAP.admin` | `hasPermission('admin.banners.entry')` |

**所有替換使用的權限碼均已存在於系統中，不需新增權限碼。**

#### 4.2.3 分類 (c)：super_admin 專屬保留 — 8 處

| 檔案 | 行數 | 操作 | 保留原因 |
|------|------|------|---------|
| user-admin-roles.js | 189, 225, 435, 467, 532 | 自訂層級 CRUD / 權限預設儲存 | **權限管理本身不可授權** |
| dashboard/dashboard.js | 119 | clearAllData() | **核彈級操作，硬鎖 super_admin** |
| event/event-manage.js | 236 | 刪除所有活動 | **破壞性操作** |
| event/event-manage.js | 450 | 完全取消活動 | **破壞性操作** |

#### 4.2.4 user 基礎功能影響評估

Phase 2 僅修改後台管理功能的 UI 可見性邏輯。以下函式**不在 Phase 2 範圍內**，不會被修改：

| 函式 | 檔案 | 確認狀態 |
|------|------|---------|
| registerForEvent() | firebase-crud.js | **不觸碰** — 無角色檢查 |
| cancelRegistration() | firebase-crud.js | **不觸碰** — 僅驗證 userId === callerUid |
| batchRegisterForEvent() | firebase-crud.js | **不觸碰** — 無角色檢查 |
| handleJoinTeam() | team-form-join.js | **不觸碰** — 無權限檢查 |
| handleLeaveTeam() | team-detail 相關 | **不觸碰** — 僅驗證非 captain/leader |
| _rebuildOccupancy() | firebase-crud.js | **不觸碰** — 純函式 |

---

### Phase 3：Cloud Functions 驗證（不動代碼）

#### 4.3.1 五位專家一致決議：不修改 Cloud Functions

| 原因 | 說明 |
|------|------|
| **循環依賴** | CF 負責設定角色；若 CF 也讀 rolePermissions 判斷「誰能改角色」，會形成死循環 |
| **效能成本** | 每次 `hasPerm()` 需額外讀一次 Firestore（$0.06/100K reads），高頻操作不划算 |
| **僅 8 處** | 且大部分是核心授權邏輯（角色升降），本質上必須用角色等級判斷 |
| **已有 hasPerm** | CF 中的 `getCallerAccessContext()` 已經支援 `access.hasPermission(code)`，3 個關鍵函式（adminManageUser、adjustExp、backfillAutoExp）已使用 |

#### 4.3.2 Phase 3 執行項目：僅驗證

- [ ] 確認 `functions/index.js` 中 `getRolePermissionsFromFirestore()` 正確讀取 `rolePermissions/{role}`
- [ ] 確認 `getCallerAccessContext()` 正確合併 stored + inherent permissions
- [ ] 確認 `adminManageUser()` 檢查 `admin.users.edit_profile`、`admin.users.change_role`、`admin.users.restrict`
- [ ] 確認 `adjustExp()` 檢查 `admin.exp.entry`
- [ ] 確認 `registerForEvent()` **不檢查任何權限碼**（user 基礎功能）
- [ ] 確認 `cancelRegistration()` **不檢查任何權限碼**（user 基礎功能）

---

### Phase 4：Firestore Rules 強化驗證

#### 4.4.1 後端工程師關鍵發現：Firestore Rules 已經實作完成

`hasPerm()` 函式已存在於 `firestore.rules`（第 85-92 行），且已覆蓋 14 個權限碼：

```
event.edit_all, event.delete, team.manage_all,
admin.shop.entry, admin.announcements.entry, admin.achievements.entry,
admin.banners.entry, admin.messages.entry, admin.messages.delete,
admin.logs.error_read, admin.logs.error_delete, admin.logs.audit_read,
admin.repair.team_join_repair, admin.repair.no_show_adjust
```

#### 4.4.2 hasPerm() 安全特性（已確認）

| 特性 | 狀態 | 說明 |
|------|------|------|
| 失敗時關閉（fail closed） | **已實作** | rolePermissions 文件不存在 → 回傳 false → 拒絕存取 |
| user 角色排除 | **已實作** | `role != 'user'` 確保 user 永遠無法通過 hasPerm |
| super_admin 繞過 | **已實作** | `isSuperAdmin()` 在所有規則中作為 OR 條件 |
| 寫入保護 | **已實作** | `rolePermissions/{role}` 的 write 規則為 `isSuperAdmin()` |

#### 4.4.3 Phase 4 執行項目：驗證 + 補強測試

- [ ] 驗證所有 14 個 hasPerm 權限碼與前端定義一致（避免拼字差異）
- [ ] 驗證 `rolePermissions` 集合中所有 6 個角色都有文件
- [ ] 新增 Firestore Rules 測試：hasPerm() 授予 → 存取成功；撤銷 → 存取拒絕
- [ ] 新增 Firestore Rules 測試：rolePermissions 文件缺失 → 安全拒絕
- [ ] 新增 Firestore Rules 測試：user 角色 + 任何權限碼 → 永遠拒絕

#### 4.4.4 user 基礎功能 Firestore Rules 確認

| 功能 | 集合 | 規則 | 是否需要權限碼？ |
|------|------|------|-----------------|
| 報名活動 | registrations | `isRegistrationOwnerRequest()` | **否** |
| 取消報名 | registrations | `isRegistrationOwnerResource()` | **否** |
| 讀取活動 | events | `true`（公開） | **否** |
| 建立活動 | events | `isAuth() && hasString('title')` | **否** |
| 讀取俱樂部 | teams | `true`（公開） | **否** |
| 加入俱樂部 | messages | `isAuth() && isMessageSenderRequest()` | **否** |
| 讀取個人檔案 | users/{uid} | `isAuth()` | **否** |
| 更新個人檔案 | users/{uid} | `isOwner(userId) && isSafeSelfProfileUpdate()` | **否** |
| 讀取站內信 | users/{uid}/inbox | `isOwner(userId)` | **否** |
| 讀取出席紀錄 | attendanceRecords | `isAuth()` | **否** |
| 讀取活動紀錄 | activityRecords | `isAuth()` | **否** |

**結論：所有 user 基礎功能在 Firestore Rules 層均不需要權限碼，Phase 4 不會影響。**

---

## 五、自動化測試計畫

### 5.1 現有測試基礎

| 項目 | 狀態 | 數量 |
|------|------|------|
| Jest 單元測試 | **已有** | 34 檔、19,471 行、1,801 測試案例 |
| Firestore Rules 測試 | **已有** | 2 檔、168 KB |
| Playwright E2E 測試 | **已有** | 1 檔 |
| 權限系統測試（新增） | **已建立** | 3 檔、522 測試案例（Phase 1: 206 + Phase 2: 316） |
| GitHub Actions CI/CD | **已有** | 每次 push 自動跑 unit + rules 測試 |

### 5.2 各階段測試閘門

#### Phase 1 部署前

```bash
npm run test:unit -- permissions-phase1-visibility.test.js
# 必須：206 測試全部通過
# 驗證：所有頁面可見性邏輯正確、user 無法存取任何後台頁面、super_admin 可存取全部
```

啟用 HTML 掃描測試（取消 permissions-phase1-visibility.test.js 中的註解）：
- 驗證已遷移頁面的 HTML 不再包含 `data-min-role`
- 驗證保留頁面仍有 `data-min-role`

#### Phase 2 部署前

```bash
npm run test:unit -- permissions-phase2-logic.test.js
# 必須：316 測試全部通過
# 驗證：6 角色 × 47 權限碼完整矩陣、固有權限不可移除、disabled codes 永不授予
```

#### Phase 3 驗證後

```bash
npm run test:unit -- cloud-functions.test.js
# 必須：現有 CF 測試全部通過
# 確認：registerForEvent 不檢查權限碼
```

#### Phase 4 部署前

```bash
npm run test:rules
# 必須：現有 Rules 測試全部通過 + 新增的 hasPerm 測試通過
```

新增測試（擴充 `tests/firestore.rules.test.js`）：

| 測試場景 | 測試數量 |
|---------|---------|
| 6 角色 × 14 權限碼 hasPerm 矩陣 | 84 |
| rolePermissions 文件缺失 → 安全拒絕 | 6 |
| rolePermissions 寫入保護（僅 super_admin） | 12 |
| 即時權限變更（授予 → 存取成功 → 撤銷 → 拒絕） | 6 |
| user 基礎功能不受阻（報名、取消、入隊等） | 20 |
| **小計** | **~128** |

#### 全部完成後 — 完整回歸

```bash
npm run test:unit && npm run test:rules
# 必須：全部測試通過（1,801 + 522 + 128 = ~2,451 測試案例）
```

### 5.3 需新增的測試檔案

| 檔案 | 用途 | 估計測試數 |
|------|------|-----------|
| tests/unit/permissions-fixtures.js | **已建立** — 共用資料與提取函式 | — |
| tests/unit/permissions-phase1-visibility.test.js | **已建立** — Phase 1 頁面可見性 | 206 |
| tests/unit/permissions-phase2-logic.test.js | **已建立** — Phase 2 權限矩陣 | 316 |
| tests/firestore.rules.test.js（擴充） | Phase 4 hasPerm 驗證 | ~128 |
| **合計新增** | | **~650** |

### 5.4 測試覆蓋矩陣

```
          │ user │ coach │ captain │ venue_owner │ admin │ super_admin │
──────────┼──────┼───────┼─────────┼─────────────┼───────┼─────────────┤
前端可見性 │  ✓   │   ✓   │    ✓    │      ✓      │   ✓   │      ✓      │  Phase 1
前端邏輯   │  ✓   │   ✓   │    ✓    │      ✓      │   ✓   │      ✓      │  Phase 2
CF 驗證    │  ✓   │   ✓   │    ✓    │      ✓      │   ✓   │      ✓      │  Phase 3
Rules 驗證 │  ✓   │   ✓   │    ✓    │      ✓      │   ✓   │      ✓      │  Phase 4
基礎功能   │  ✓   │   ✓   │    ✓    │      ✓      │   ✓   │      ✓      │  全階段

每個 ✓ = 該角色 × 47 權限碼 = 47 測試案例
6 角色 × 47 碼 × 4 層 = 1,128 矩陣單元
```

---

## 六、風險登記簿

### 6.1 嚴重風險

| ID | 風險 | 機率 | 影響 | 緩解措施 | 回退觸發條件 |
|---|------|------|------|---------|-------------|
| **R1** | user 基礎功能被阻擋 | 低 | **致命** | 原則 P4 明確禁止修改基礎功能路徑；測試覆蓋所有基礎功能 | 任何用戶回報「無法報名」或「無法取消」 |
| **R2** | admin 被鎖在權限管理頁面外 | 中 | 高 | page-admin-roles 保留 data-min-role + 硬編碼 super_admin 檢查 | super_admin 無法進入權限管理頁面 |
| **R3** | rolePermissions 文件缺失 | 低 | 高 | Phase 4 前驗證所有 6 角色文件存在；hasPerm() fail closed 設計 | hasPerm 全面拒絕（監控 Firestore 錯誤率） |
| **R4** | Service Worker 快取舊代碼 | 中 | 高 | 4 處快取版本號嚴格同步；部署後在 LINE LIFF 實機測試 | 用戶反映頁面行為與預期不符 |
| **R5** | Phase 2 hasPermission() 注入攻擊 | 中 | 低 | 前端僅控制 UI；所有寫入由 Firestore Rules + CF 後端驗證 | 無需回退（前端注入不影響資料安全） |
| **R6** | 權限碼拼字不一致（前後端） | 低 | 中 | Phase 4 測試驗證所有碼一致；加入自動化比對測試 | 特定權限切換無效 |

### 6.2 注意事項

| ID | 項目 | 說明 |
|---|------|------|
| **N1** | Firestore 讀取成本 | hasPerm() 每次 1 read；估計 ~30K-50K reads/月，成本可忽略 |
| **N2** | 權限變更延遲 | 用戶角色變更後需重新登入或等 1 小時 token 過期才生效 |
| **N3** | DOM 操控 | 用戶可用 DevTools 顯示隱藏頁面，但所有寫入被後端阻擋（純 UI 欺騙） |

---

## 七、部署策略

### 7.1 部署順序與等待時間

```
DAY 1 ─── Phase 1（HTML 移除）
              ↓ 等待 4+ 小時，監控錯誤率
DAY 2 ─── Phase 2（JS 邏輯替換）
              ↓ 等待 4+ 小時，監控錯誤率
DAY 3 ─── Phase 3（CF 驗證，不部署）
              ↓ 確認 CF 正常
DAY 4 ─── Phase 4（Firestore Rules 測試擴充）
              ↓ 完整回歸測試
DAY 5 ─── 全面驗證 + 文件更新
```

### 7.2 回退程序

每個階段均可獨立回退：

```bash
# Phase 1 回退（~10 分鐘）
git revert --no-edit <Phase1-commit>
# 更新快取版本號（4 處）
git push origin main

# Phase 2 回退（~10 分鐘）
git revert --no-edit <Phase2-commit>
# 更新快取版本號
git push origin main

# Phase 4 回退（~5 分鐘）
git revert --no-edit <Phase4-commit>
firebase deploy --only firestore:rules
```

### 7.3 每階段部署後驗證清單

#### 前 5 分鐘
- [ ] Cloudflare 部署成功
- [ ] 快取版本號 4 處一致
- [ ] 首頁可正常載入

#### 前 30 分鐘
- [ ] 以 user 角色測試：報名、取消、候補、加入球隊、退出球隊
- [ ] 以 coach 角色測試：活動管理、賽事管理可進入
- [ ] 以 admin 角色測試：所有 admin 級頁面可進入
- [ ] 以 super_admin 角色測試：權限管理可進入、所有頁面可進入
- [ ] 測試權限切換：關閉某權限 → 頁面消失；開啟 → 頁面出現

#### 前 4 小時
- [ ] Firestore 錯誤率 < 1%
- [ ] Cloud Logging 無新的 permission-denied 集群
- [ ] LINE LIFF 實機測試同樣流程

---

## 八、前置條件檢查清單

**以下條件全部滿足後才能開始實作：**

- [ ] Git 狀態乾淨（`git status` 無未提交變更）
- [ ] 現有測試全部通過（`npm run test:unit` + `npm run test:rules:unit`）
- [ ] Firestore `rolePermissions` 集合中 6 個角色文件都存在且權限陣列正確
- [ ] 現有線上版本正常運作（手動確認報名、取消、權限管理等核心功能）
- [ ] Firestore 備份快照已建立
- [ ] 回退指令已準備好（預先寫好完整的 git revert 指令）

---

## 九、完成後交付物

| 交付物 | 說明 |
|--------|------|
| 17 個頁面移除 data-min-role | Phase 1 |
| 22 處 JS 硬檢查替換為 hasPermission | Phase 2 |
| CF 驗證報告 | Phase 3 |
| ~128 個新增 Firestore Rules 測試 | Phase 4 |
| ~650 個新增自動化測試（總計） | 全階段 |
| CLAUDE.md 更新 | 新增「權限系統架構」章節 |
| docs/architecture.md 更新 | 權限流程圖 |
| docs/claude-memory.md 更新 | 修復日誌 |
| permissions/ 頁面更新 | 反映重構後的權限狀態 |

---

## 十、專家簽核

| 角色 | 結論 | 狀態 |
|------|------|------|
| **資安架構師** | Phase 1-2 安全（前端僅 UI，後端已有防線）；Phase 4 hasPerm fail closed 正確；user 基礎功能確認不受影響 | **同意** |
| **前端工程師** | 17 頁可安全移除 data-min-role；5 頁必須保留；22 處 ROLE_LEVEL_MAP 可替換；無需新增權限碼 | **同意** |
| **後端工程師** | Firestore Rules hasPerm() 已完整實作；rolePermissions 寫入已鎖定 super_admin；Phase 4 僅需擴充測試 | **同意** |
| **QA 工程師** | 現有 522 測試覆蓋 Phase 1-2；需新增 ~128 個 Rules 測試覆蓋 Phase 4；CI/CD 已就位 | **同意** |
| **專案經理** | 4 天部署時程可行；每階段可獨立回退（< 10 分鐘）；風險可控 | **同意** |

---

*本計畫書由 5 位 AI 專家審查並一致同意。計畫書完成後不會修改任何代碼，直到獲得用戶批准。*
