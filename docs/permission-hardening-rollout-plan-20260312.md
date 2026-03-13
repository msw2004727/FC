# 權限治理修正計畫書 2026-03-12（rev.2 — 2026-03-13 補強）

## 目標

本計畫書對應以下 7 個明確目標：

1. `super_admin` 保持最高權限；若現況已成立則只驗證、不重構。
2. 確保只有 `super_admin` 可進入 `page-admin-roles`，驗證現有防護並清理殘留設定。
3. 任何 permission toggle 一旦開啟或關閉，該角色使用者要立即落實擁有或失去該權限，不可再出現「後台已開但實際不可用」。
4. 確認 `users` 集合的 Firestore Rules 對敏感欄位的防護已足夠，並強化 Cloud Function `adminManageUser()` 的 capability 檢查。
5. `admin` 若被賦予「用戶管理」下的某個權限，該項操作要在 UI、Firestore Rules、Cloud Functions 三層都一致生效。
6. 使用者一旦改變身分，必須立即落實擁有新角色已開啟的權限，並失去舊角色不再擁有的權限。
7. **場主 / 領隊 / 教練取得身分後自動擁有對應權限**，且該權限在 UI / Rules / Functions 三層均可落實。

---

## 現況判讀

目前系統不是單一權限模型，而是三套混合：

- 角色等級：`ROLE_LEVEL_MAP` / `currentRole`（`config.js`）
- Permission code：`rolePermissions` 集合 + `hasPerm()`（`firestore.rules` / `role.js` / `functions/index.js`）
- 靜態特權判斷：`isAdmin()` / `isSuperAdmin()` / `isCoachPlus()`（`firestore.rules`）

### 已確認的防護（已就位）

| 防護項目 | 現狀 | 位置 |
|----------|------|------|
| `page-admin-roles` 入口 | `minRole: 'super_admin'`（無 permissionCode） | `config.js:623` |
| `admin.roles.entry` 禁用 | 在 `DISABLED_PERMISSION_CODES` 中 | `config.js:630` / `functions/index.js:27` |
| `page-admin-roles` HTML | `data-min-role="super_admin"` | `pages/admin-system.html:154` |
| `users` 敏感欄位自改保護 | `isSafeSelfProfileUpdate()` 排除 `role/claims/isAdmin/manualRole` | `firestore.rules:417-425` |
| `users.update` admin 限制 | `admin` 無直接更新 users 的 Rules 路徑（僅 `isSuperAdmin()` 可寫） | `firestore.rules:557-562` |
| 角色變更走 Cloud Function | `adminManageUser()` 走 callable，不走 Rules | `functions/index.js:1001-1110` |
| Cloud Function 角色變更權限 | 需 `ADMIN_USER_CHANGE_ROLE_PERMISSION` capability | `functions/index.js:1068` |
| 自訂角色 claims 同步 | `setRoleClaimMerged()` 使用 `normalizeRole()`（保留自訂角色名） | `functions/index.js:571-579` |
| 自訂角色存在性驗證 | `roleExists()` 查 `customRoles` 集合 | `functions/index.js:563-568` |
| 自訂角色權限查詢 | `getRolePermissionsFromFirestore()` 讀 `rolePermissions/{roleKey}` | `functions/index.js:540-546` |

### 已確認的主要缺口

| 缺口 | 說明 | 影響範圍 |
|------|------|----------|
| UI 入口 vs Rules 不對稱 | 多數 UI 入口走 permission code，但 Firestore Rules 寫入仍走 `isAdmin()` / `isSuperAdmin()`，無對應 `hasPerm()` | 自訂角色或拿到 permission code 的 admin 看到按鈕卻操作失敗 |
| `rolePermissions` 集合保護不明 | 未確認 `rolePermissions` 的 Rules 是否防止 `admin` 自己給自己加權限 | 若 admin 可直接寫入 rolePermissions，存在升權風險 |
| `isAdmin` 舊欄位殘留依賴 | 前端部分邏輯仍讀取 `isAdmin` 欄位，未遷移到 capability 架構 | 自訂角色可能被誤判為無管理權限 |
| `hasPerm()` Rules 讀取上限 | 每次 `hasPerm()` 消耗 1-2 次 `get()`，Rules 單條上限 10 次 | 同一條 Rule 多個 `hasPerm()` 可能超出上限 |
| `normalizeBuiltInRole()` 影響 | `isAdmin` 欄位只對內建角色設 `true`，自訂角色一律 `false` | 若有程式碼依賴 `isAdmin` 欄位，自訂高階角色會被誤判 |
| 角色切換生效延遲 | Firebase Auth token 有效期 1 小時，被改角色的在線使用者無主動通知機制 | 被降權的使用者可能持續操作最多 1 小時 |
| Cloud Functions 的 `super_admin` 權限 | `rolePermissions/super_admin` 文件不一定存在，函式靠 `role === 'super_admin'` 短路判斷 | 若查詢方式改變可能遺漏 super_admin 的全權 |
| `errorLogs` / `auditLogsByDay` 讀取限 `isSuperAdmin()` | 即使 admin 被授予 `admin.logs.entry`，Firestore Rules 仍用 `isSuperAdmin()` 擋讀取（`firestore.rules:868,878`） | admin 進入日誌中心 → 錯誤日誌 / 稽核日誌頁籤空白 |
| `errorLogs` 刪除限 `isSuperAdmin()` | `allow delete: if isSuperAdmin()`（`firestore.rules:871`） | admin 的「清除 30 天前」按鈕操作失敗 |
| `autoExpRules` 無 Firestore Rules | 集合未出現在 `firestore.rules`，任何登入使用者可能可讀寫 | 自動 EXP 規則無後端保護 |
| `admin.users.change_role` 無最低角色等級檢查 | Cloud Function `adminManageUser()` 的 roleChange 分支只檢查 `hasPermission()` 不檢查呼叫者角色等級（`functions/index.js:1067-1068`） | 若 super_admin 誤將 `admin.users.change_role` 開給 coach / captain，低階角色即可改角色 |
| coach / captain / venue_owner 自動權限未定義 | `getDefaultRolePermissions()` 有預設邏輯但規格書未明確定義哪些是不可剝奪的自動權限 | 自訂 `rolePermissions/{role}` 會完全覆蓋預設，可能導致身分對應功能不可用 |

---

## 設計原則

- `users.role` 是正式角色來源。
- `manualRole` 只作為人工保底角色，不可被一般 `admin` 任意改。
- `claims` 是 token mirror，不是正式權限來源。
- `isAdmin` 視為舊欄位，相容處理，不再作為正式授權依據；前端殘留依賴應在本計畫中逐步清理。
- 權限必須以「是否具備某個 capability」為準，不再只靠頁面可見性推定可操作性。
- 所有可下放給 `admin` 的敏感動作，都必須有對應 permission code，且 UI / Rules / Functions 同步採用。
- Firestore Rules 的 `hasPerm()` 呼叫次數需納入設計考量，避免超出 10 次 `get()` 上限。
- **不可下放原則**：若某功能的 Firestore Rules 堅持 `isSuperAdmin()`，則其對應的 permission code **不應出現在權限管理的 toggle 清單中**，否則必定出現「開了看得到用不到」。
- **最低角色等級防線**：可下放的敏感 capability（如 `admin.users.change_role`）須在 Cloud Function 額外檢查呼叫者的角色等級 ≥ `admin`，作為防禦性設計，不依賴 super_admin 的操作正確性。
- **身分自動權限**：coach / captain / venue_owner 取得身分時應自動擁有一組「不可剝奪」的基礎權限，且這些權限在 Firestore Rules 層面有對應的讀寫能力。

---

## 實作步驟

### Step 1：建立權限真相表與能力矩陣

工作內容：

- 盤點所有後台功能，分成三類：
  - `super_admin only`：僅 super_admin 可操作，不可下放
  - `delegable by permission`：可透過 permission code 下放給其他角色
  - `role-level only legacy`：目前靠角色等級判斷，需評估是否遷移
- 針對「用戶管理」拆出明確 capability，例如：
  - `admin.users.entry`
  - `admin.users.edit_profile`
  - `admin.users.change_role`
  - `admin.users.restrict`
  - `admin.users.view_sensitive`
- 明確標注每個 capability 對應的 UI 入口、Firestore Rules 函式、Cloud Functions callable。
- 盤點前端所有仍讀取 `isAdmin` 欄位的位置，列入清理清單。
- 確認 `rolePermissions` 集合的 Firestore Rules 寫入條件。
- **建立「不可下放功能」明確清單**，將所有功能分為以下三類：

**不可下放（super_admin only，permission code 不出現在 toggle 清單）**：

| 功能 | Firestore 集合 | Rules 函式 | 說明 |
|------|---------------|-----------|------|
| 權限管理 | `rolePermissions` / `customRoles` / `permissions` | `isSuperAdmin()` | 不可下放 |
| 一鍵清除 | — | — | 僅 Cloud Function 入口 |

**可下放但須 Firestore Rules 配合改造**：

| 功能 | Firestore 集合 | 現況 Rules | 改造目標 |
|------|---------------|-----------|----------|
| 日誌中心 — 錯誤日誌 | `errorLogs` | `isSuperAdmin()` read/delete | `isSuperAdmin() \|\| hasPerm('admin.logs.error_read')` |
| 日誌中心 — 稽核日誌 | `auditLogsByDay/*/auditEntries` | `isSuperAdmin()` read | `isSuperAdmin() \|\| hasPerm('admin.logs.audit_read')` |
| 自動 EXP 管理 | `autoExpRules` | **無 Rules（缺口）** | 新增 `isSuperAdmin() \|\| hasPerm('admin.auto_exp.entry')` |

**已可下放（Rules 已支援 isAdmin / hasPerm）**：

| 功能 | Firestore 集合 | 現況 Rules |
|------|---------------|-----------|
| 用戶管理 | `users`（透過 Cloud Function） | callable 已有 capability 檢查 |
| 廣告管理 | `banners` / `floatingAds` | `isAdmin()` |
| 站內信 | `adminMessages` | `isAdmin()` |
| 商品管理 | `shopProducts` | `isAdmin()` |
| 球隊管理 | `teams` | `isAdmin()` / `isCoachPlus()` |
| 活動管理 | `events` | `isAuth()` + `isEventOwner()` |
| 賽事管理 | `tournaments` | `isAdmin()` |
| 公告管理 | `announcements` | `isAdmin()` |
| 成就/徽章 | `achievements` / `badges` | `isAdmin()` |
| 佈景主題 | `siteThemes` | `isAdmin()` |

- **建立 permission code ↔ Firestore Rule 對照表**（格式如附錄 B）。

自我驗收：

- 產出一張 capability 對照表，沒有任何一個敏感按鈕或寫入路徑處於「UI 有、Rules 沒有」或「Rules 有、UI 沒有」的未分類狀態。
- `super_admin` 專屬能力與可下放能力邊界清楚。
- `isAdmin` 殘留依賴清單完整。
- `rolePermissions` 集合的 Rules 保護狀態已確認。
- **不可下放功能的 permission code 不出現在前端 toggle 清單中。**

---

### Step 2：驗證並強化權限管理後台保護

> **前置確認**：`page-admin-roles` 的入口已由 `minRole: 'super_admin'` 保護，`admin.roles.entry` 已在前後端的 `DISABLED_PERMISSION_CODES` 中。本步驟為驗證性質，非從零實作。

工作內容：

- 驗證 `_canAccessPage('page-admin-roles')` 的判斷路徑，確認只看 `minRole` 不看 `permissionCode`。
- 確認即使有人在 Firestore 手動為某角色寫入 `admin.roles.entry`，前端的 `DISABLED_PERMISSION_CODES` 會攔截。
- 確認 Cloud Functions 端的 `DISABLED_PERMISSION_CODES` 同步包含 `admin.roles.entry`。
- 確認 `rolePermissions` 集合的 Firestore Rules 禁止非 `super_admin` 寫入（若未禁止，需新增 Rule）。
- 掃描 Firestore `rolePermissions` 現有資料，清理遺留的 `admin.roles.entry` 權限碼。

自我驗收：

- 非 `super_admin` 即使手動寫入 `admin.roles.entry`，也無法看到或進入權限管理頁。
- `rolePermissions` 集合的 Rules 確認只有 `super_admin` 可寫入。
- `super_admin` 原有權限管理能力不受影響。

---

### Step 3：把「用戶管理」改成真正可下放的 capability

> 用戶管理是最複雜的可下放功能，先做此步驟作為其他功能的範本。

工作內容：

- 將用戶管理頁內的動作拆成可配置權限：
  - 看列表（`admin.users.entry`）
  - 編輯基本資料（`admin.users.edit_profile`）
  - 限制/解除限制（`admin.users.restrict`）
  - 變更角色（`admin.users.change_role`）
- 前端不再硬寫 `currentRole >= super_admin`，改成檢查對應 capability。
- Cloud Function `adminManageUser()` 的每個操作分支都檢查對應 capability：
  - `profileUpdate` → 需 `admin.users.edit_profile`
  - `restrictionUpdate` → 需 `admin.users.restrict`
  - `roleChange` → 需 `admin.users.change_role`（**已實作**，驗證即可）
- 若某動作不打算下放，則明確標記為 `super_admin only`，不再放進 toggle 清單。
- **新增最低角色等級防線**：在 Cloud Function `adminManageUser()` 的 `roleChange` 分支加入角色等級檢查：
  ```javascript
  // functions/index.js — roleChange 分支，在 hasPermission 檢查之後追加
  const ROLE_LEVELS = { user:0, coach:1, captain:2, venue_owner:3, admin:4, super_admin:5 };
  const callerLevel = ROLE_LEVELS[access.role] ?? 0;
  if (callerLevel < ROLE_LEVELS.admin) {
    throw new HttpsError("permission-denied", "Only admin or above can change roles");
  }
  ```
  確保即使 `admin.users.change_role` 被誤授予 coach / captain，後端仍會拒絕。
- **定義 admin 改角色的邊界規則**（見附錄 C）：
  - admin 可將 user 升為 coach / captain / venue_owner（不可升為 admin / super_admin）
  - admin 可將 coach / captain / venue_owner 降回 user
  - admin 不可修改同級或更高級角色的身分
  - super_admin 無限制

自我驗收：

- `admin` 只拿到 `admin.users.edit_profile` 時，只能修改基本資料，不能改角色或限制用戶。
- `admin` 拿到 `admin.users.change_role` 時，角色變更可在 UI、Cloud Function 完整落實。
- 未被授權的動作在 UI 看不到，或看到也無法送出，且 Cloud Function 最終仍會擋下。
- `admin` 不能給自己或他人指派 `super_admin` 角色（Cloud Function 已有此檢查：`functions/index.js:1075-1076`）。
- **`admin` 不能將其他 admin 降級**（只有 super_admin 可以）。
- **coach / captain / venue_owner 即使持有 `admin.users.change_role`，roleChange 仍被 Cloud Function 拒絕。**

---

### Step 3.5：定義 coach / captain / venue_owner 身分自動權限機制

> **背景**：用戶取得場主 / 領隊 / 教練身分後，應自動擁有對應功能的權限，且該權限在 UI / Rules / Functions 三層均可落實。目前 `getDefaultRolePermissions()` 有預設邏輯，但規格書未明確定義哪些是「不可剝奪」的自動權限，且 Firestore Rules 層面未完全對應。

工作內容：

- **定義每個身分的自動權限清單**：

| 身分 | 自動權限碼 | 對應功能 | 不可剝奪？ |
|------|-----------|---------|-----------|
| coach (level 1+) | `activity.manage.entry` | 活動管理 | 是 — 教練核心功能 |
| coach (level 1+) | `admin.tournaments.entry` | 賽事管理 | 是 — 教練核心功能 |
| captain (level 2+) | 同 coach 全部 | — | 是 |
| venue_owner (level 3+) | 同 captain 全部 | — | 是 |

- **區分「不可剝奪」與「可調整」權限**：
  - **不可剝奪**：身分取得即自動擁有，super_admin 不可透過權限管理關閉。即使 `rolePermissions/{role}` 自訂清單中未包含，系統仍自動賦予。
  - **可調整**：super_admin 可透過權限管理 toggle 開啟或關閉的額外權限。
- **修改 `getDefaultRolePermissions()` 邏輯**（`config.js:729-746`）：
  - 新增 `getInherentRolePermissions(roleKey)` 函式，回傳該角色不可剝奪的權限碼。
  - `hasPermission()` 合併檢查：先查 `inherentPermissions`，再查 `rolePermissions/{role}` 儲存的自訂清單。
  - 確保 `rolePermissions/{role}` 的自訂清單不會覆蓋不可剝奪權限。
- **在 Cloud Functions 同步實作**（`functions/index.js`）：
  - `getCallerAccessContext()` 的 `hasPermission()` 方法同樣合併不可剝奪權限。
- **確認 Firestore Rules 對應**：
  - `events` 集合：coach+ 建立活動走 `isAuth()` + owner 邏輯 → **已可用**（無需改）
  - `tournaments` 集合：目前走 `isAdmin()` → 需評估是否改為 `isAdmin() || isCoachPlus()` 或 `hasPerm('admin.tournaments.entry')`
- **定義身分取得觸發點**：
  - super_admin / admin 透過用戶管理（`adminManageUser()`）變更角色 → 角色變更後自動生效
  - 自動權限不需額外寫入 `rolePermissions` 集合 — 由程式碼邏輯保證

自我驗收：

- coach 取得身分後，無需 super_admin 額外開權限，即可進入活動管理與賽事管理。
- super_admin 在權限管理頁關閉 coach 的 `activity.manage.entry`，coach 仍保有該能力（不可剝奪）。
- captain / venue_owner 繼承 coach 的所有自動權限。
- 不可剝奪權限在 UI、Firestore Rules、Cloud Functions 三層同步生效。
- 身分變更後（Step 6 的 `claimsUpdatedAt` 機制），自動權限立即生效。

---

### Step 4：驗證並強化 Firestore Rules 的敏感欄位保護

> **前置確認**：Firestore Rules 的 `users` 集合已有嚴格的欄位級保護。本步驟為驗證 + 補強。

工作內容：

- 驗證現有 Firestore Rules 的 `users/{userId}` 更新規則：
  - `isSafeSelfProfileUpdate()` — 已排除 `role/claims/isAdmin/manualRole`（`firestore.rules:425`）
  - `isSafeLoginUpdate()` — 只允許 `displayName/pictureUrl/lastLogin`
  - `isSafeSuperAdminUserUpdate()` — 只排除 `uid/lineUserId/createdAt`，super_admin 可改角色
  - `admin`（非 super_admin）**沒有**直接更新 users 的 Rules 路徑
- 確認 `admin` 能否透過以下方式繞過：
  - 直接 Firestore SDK 寫入 `users/{uid}.role` → 應被 Rules 拒絕（驗證）
  - 透過 Cloud Function `adminManageUser()` → 已有 capability 檢查（驗證）
- 若 Step 3 新增了可下放的用戶管理 capability（如 `admin.users.edit_profile`），需在 Rules 中新增對應更新路徑：
  - 新增 `isSafeAdminProfileUpdate()` 函式，只允許 `displayName/phone/gender/birthday/region/sports` 等非敏感欄位
  - 配合 `hasPerm('admin.users.edit_profile')` 授權
- 評估 `hasPerm()` 在 users Rules 中的 `get()` 消耗量，確認不超過 10 次上限。

自我驗收：

- `admin` 直接對 `users/{uid}` 發送原始寫入，嘗試修改 `role/manualRole/claims/isAdmin` 會被 Rules 拒絕。
- `user` 自己修改上述欄位也一律被拒絕。
- `admin` 有 `admin.users.edit_profile` capability 時，可透過 Rules 修改被授權的非敏感欄位。
- `super_admin` 或 Cloud Function 授權路徑仍可完成必要更新。
- Rules 中 `get()` 呼叫次數未超出單條 10 次上限。

---

### Step 5：把其他可下放功能統一 capability 化

工作內容：

- 針對所有在 Step 1 標記為 `delegable by permission` 的操作，統一改成 capability 驅動。
- Firestore Rules 對應寫入改用 `hasPerm(...)` 或等價 capability 檢查，而不是只看 `isAdmin()`。
- Cloud Functions 對應 callable 也改成同一份 capability 檢查，不再只接受內建角色白名單。
- 前端按鈕顯示、頁面入口、送出前檢查全部改用同一份 capability 名稱。
- 優先處理高風險操作（活動管理、公告管理、商品管理），低風險操作（主題、Banner）可後續批次。
- **明確處理每條 `isSuperAdmin()` Rules 的下放決策**：

| Firestore 集合 | 現況 Rules | 決策 | 改造方式 |
|---------------|-----------|------|---------|
| `errorLogs` read | `isSuperAdmin()` | **(A) 下放** | `isSuperAdmin() \|\| hasPerm('admin.logs.error_read')` |
| `errorLogs` delete | `isSuperAdmin()` | **(A) 下放** | `isSuperAdmin() \|\| hasPerm('admin.logs.error_delete')` |
| `auditLogsByDay/*/auditEntries` read | `isSuperAdmin()` | **(A) 下放** | `isSuperAdmin() \|\| hasPerm('admin.logs.audit_read')` |
| `rolePermissions` write | `isSuperAdmin()` | **(B) 不下放** | 維持，且前端 toggle 不顯示 |
| `customRoles` write | `isSuperAdmin()` | **(B) 不下放** | 維持，且前端 toggle 不顯示 |
| `permissions` write | `isSuperAdmin()` | **(B) 不下放** | 維持，且前端 toggle 不顯示 |
| `autoExpRules`（目前無 Rules） | **缺口** | **(A) 下放** | 新增 `isSuperAdmin() \|\| hasPerm('admin.auto_exp.entry')` |

  對於決策 **(B) 不下放** 的功能，需同步確認其 permission code **不出現在 `ADMIN_PAGE_EXTRA_PERMISSION_ITEMS` 或 `DRAWER_MENUS` 的 `permissionCode` 中**。

- **新增 `ADMIN_PAGE_EXTRA_PERMISSION_ITEMS['page-admin-logs']`**：
  ```javascript
  'page-admin-logs': [
    { code: 'admin.logs.error_read', name: '錯誤日誌讀取' },
    { code: 'admin.logs.error_delete', name: '錯誤日誌清除' },
    { code: 'admin.logs.audit_read', name: '稽核日誌讀取' },
  ],
  ```

設計考量 — Firestore Rules `hasPerm()` 呼叫上限：

- 每個 `hasPerm()` 消耗 1-2 次 `get()`（`authRole()` 可能讀 `users/{uid}` + `get(rolePermissions/{role})`）
- 同一條 Rule 不可呼叫超過 10 次 `get()`
- 若同一集合的不同操作需要不同 capability，改用 `||` 合併判斷，或先 `get()` 一次 rolePermissions 再用 `in` 逐項檢查
- 對於 `super_admin`，應在 `hasPerm()` 前先短路：`isSuperAdmin() || hasPerm('xxx')`

自我驗收：

- 任意一個 capability 開啟後，同角色使用者在不重新部署的情況下即可使用。
- 任意一個 capability 關閉後，同角色使用者立即失去對應 UI 與後端寫入能力。
- 不再出現「頁面進得去但按鈕不能用」或「按鈕能按但 Rules 拒絕」的情況。
- 任何一條 Rule 的 `get()` 總呼叫數不超過 10 次。

---

### Step 6：建立角色切換即時生效閉環

工作內容：

- 將角色變更流程標準化（Cloud Function `adminManageUser()` 為唯一入口）：
  1. 更新 `users.role`
  2. 必要時更新 `manualRole`
  3. 更新 `claims` 欄位
  4. 呼叫 `setRoleClaimMerged()` 同步 Firebase Auth custom claims
  5. 寫入 `claimsUpdatedAt: serverTimestamp()` 到 users 文件
- 對於被改身分的使用者，建立主動通知機制：
  - 被改角色的使用者若當前在線，其前端 `users` onSnapshot 偵測到 `claimsUpdatedAt` 變動後，自動呼叫 `auth.currentUser.getIdToken(true)` 強制刷新 token
  - 刷新後重新載入 permission cache，重新渲染當前頁面
  - 若使用者不在線，下次開啟 App 時 `createCustomToken()` 會同步最新 claims
- 明確定義生效時機：
  - 管理員自己：操作完成後立即生效（同步返回新角色）
  - 被改的在線使用者：透過 `claimsUpdatedAt` onSnapshot → token 刷新 → 30 秒內生效
  - 被改的離線使用者：下次開啟 App / token 自動 refresh 時生效（最多 1 小時）
- 確認 Cloud Functions 的 `normalizeRole()` 不會把自訂角色降級：
  - `normalizeRole()`（`functions/index.js:251`）：只 trim，不降級 → **已正確**
  - `normalizeBuiltInRole()`（`functions/index.js:257`）：自訂角色 → `'user'` → **僅用於 `isAdmin` 欄位計算**，不影響角色本身
  - `setRoleClaimMerged()`：使用 `normalizeRole()` → **已正確**，claims 中保留自訂角色名

自我驗收：

- 使用者從 A 角色改到 B 角色後，B 角色已開啟的 permission 立即可用。
- 舊角色已關閉的 permission 立即失效。
- 自訂角色與內建角色都遵守同一套生效規則，不再出現 claims 與 Firestore 角色分裂。
- 被改角色的在線使用者在 30 秒內自動感知到角色變更。
- `claimsUpdatedAt` 寫入不破壞現有 Rules（需列入 `isSafeSuperAdminUserUpdate()` 白名單）。

---

### Step 7：清理 `isAdmin` 舊欄位殘留依賴

工作內容：

- 根據 Step 1 的盤點清單，逐一替換前端讀取 `isAdmin` 的位置：
  - 改為 `hasPermission(code)` 或 `ROLE_LEVEL_MAP[role] >= ROLE_LEVEL_MAP['admin']`
- 前端不再以 `isAdmin` 欄位作為授權依據，僅作為 UI 相容顯示（例如用戶名旁的管理員標籤）。
- Firestore Rules 中的 `isAdmin()` 函式保留但不再擴大使用範圍；新增的 Rules 一律使用 `isSuperAdmin()` 或 `hasPerm()`。

自我驗收：

- 前端沒有任何授權判斷依賴 `user.isAdmin` 欄位。
- 自訂高階角色（有 admin 級 permission code）不會因 `isAdmin === false` 被誤判為無權限。

---

### Step 8：補齊測試與第三方驗證

工作內容：

- 新增 Rules 測試（可用 Firebase Emulator 或手動驗證）：
  - `user` 不可自改 `role/claims/isAdmin/manualRole`
  - `admin` 不可直改上述欄位
  - `admin` 有明確 capability 時可執行被授權動作
  - `admin` 無 capability 時操作被拒絕
  - `super_admin` 可做全部應保留動作
  - `admin` 不可寫入 `rolePermissions` 集合
- 新增 UI / integration smoke list：
  - 開啟 permission 後立即生效
  - 關閉 permission 後立即失效
  - 角色改變後權限立即切換
  - 自訂角色賦予 permission 後可操作
- 以第三方角色重新驗證：
  - `user`
  - `admin`（有部分 capability）
  - `custom role`（有部分 capability）
  - `super_admin`

自我驗收：

- 沒有任何一條測試路徑出現「給了權限卻仍不可用」。
- 沒有任何一條測試路徑讓 `user` 或未授權 `admin` 自行升權。
- 第三方角度重新審視時，UI、Rules、Functions 三層結論一致。
- 自訂角色的行為與同等級內建角色一致。

---

## 建議執行順序

1. **Step 1**：建立權限真相表與能力矩陣（基礎，含不可下放清單）
2. **Step 2**：驗證並強化權限管理後台保護（快速勝利，降低升權風險）
3. **Step 3**：用戶管理 capability 拆分 + 最低角色等級防線（作為範本）
4. **Step 3.5**：定義 coach / captain / venue_owner 身分自動權限機制
5. **Step 4**：驗證並強化 Rules 敏感欄位保護（配合 Step 3 成果）
6. **Step 5**：其他功能 capability 化 + Rules 下放決策（依 Step 3 範本擴張）
7. **Step 6**：角色切換即時生效閉環（含身分自動權限生效）
8. **Step 7**：清理 `isAdmin` 舊欄位殘留依賴
9. **Step 8**：測試與第三方驗證

---

## 風險評估

| 風險 | 影響 | 嚴重度 | 緩解措施 |
|------|------|--------|----------|
| `rolePermissions` 集合無 Rules 保護 | admin 可自行添加權限碼升權 | **高** | Step 2 優先確認並補齊 Rules |
| `hasPerm()` 超出 Rules get() 上限 | 合法操作被 Rules 拒絕 | 中 | Step 5 設計時計算 get() 消耗量 |
| 角色切換後 token 延遲刷新 | 被降權使用者持續操作 | 中 | Step 6 加入 claimsUpdatedAt 主動通知 |
| `isAdmin` 舊欄位殘留依賴 | 自訂角色被誤判 | 中 | Step 7 統一清理 |
| Firestore Rules 修改導致誤擋 | 正常操作被拒絕 | 高 | 每步驗證後再進下一步，保留回滾能力 |
| 前端 capability 檢查與 Rules 不同步 | UI 能按但後端拒絕 | 中 | 使用同一份 capability 名稱常數 |
| capability 誤授予低階角色 | coach/captain 可改角色 | **高** | Step 3 加入 Cloud Function 最低角色等級檢查 |
| `autoExpRules` 無 Rules 保護 | 任何登入者可讀寫 | **高** | Step 5 新增 Rules |
| 身分自動權限被自訂覆蓋 | coach 進不了活動管理 | 中 | Step 3.5 不可剝奪權限合併邏輯 |

---

## 工作量評估

| 步驟 | 複雜度 | 說明 |
|------|--------|------|
| Step 1 真相表 | 中 | 盤點工作量，不涉及程式碼修改 |
| Step 2 驗證後台保護 | 低 | 多數已就位，驗證 + rolePermissions Rules 補齊 |
| Step 3 用戶管理 capability | 高 | Cloud Function 分支拆分 + 前端 UI 條件改寫 |
| Step 4 Rules 強化 | 中 | 新增 admin 操作的 Rules 路徑 + hasPerm 整合 |
| Step 3.5 身分自動權限 | 中 | 定義不可剝奪清單 + 合併邏輯（前端 + Cloud Function） |
| Step 5 其他功能 capability | 高 | 逐功能盤點 + 三層同步改造 + Rules 下放決策 |
| Step 6 即時生效閉環 | 中高 | claimsUpdatedAt 機制 + 前端 onSnapshot 刷新 |
| Step 7 isAdmin 清理 | 中 | 逐檔替換，需回歸測試 |
| Step 8 測試 | 中高 | 跨角色、跨功能回歸測試 |

---

## 交付標準

本計畫完成後，必須同時滿足以下結果：

- `super_admin` 是唯一能管理角色層級與權限結構的人。
- `rolePermissions` 集合在 Rules 層面只有 `super_admin` 可寫入。
- `admin` 只能做被明確授權的管理動作，且授權一旦開啟就必定在 UI / Rules / Functions 三層可落實。
- `user` 沒有任何直接或繞路自升權方法。
- 角色變更與 permission toggle 的效果能在 UI、Rules、Functions 三層同步落實。
- 自訂角色在權限系統中的行為與同等級內建角色完全一致。
- 前端不再以 `isAdmin` 欄位作為授權判斷依據。
- **coach / captain / venue_owner 取得身分後自動擁有對應權限，無需 super_admin 額外手動開啟。**
- **不可下放功能的 permission code 不出現在前端 toggle 清單中，杜絕「開了看得到用不到」。**
- **`admin.users.change_role` 等敏感 capability 有最低角色等級防線，防止 capability 誤授予低階角色時被利用。**
- **admin 改角色有明確邊界：不可升為 admin / super_admin，不可改同級或更高級角色。**

---

## 附錄

### 附錄 A：需求覆蓋矩陣

| # | 用戶要求 | 涵蓋狀態 | 對應 Step |
|---|---------|---------|----------|
| 1 | 權限管理只有 super_admin 可用，可向下調整所有層級權限 | ✅ 完整 | Step 2 |
| 2 | 被 super_admin 開啟的權限就應該能用，不能開了看得到用不到 | ✅ 已補強 | Step 1（不可下放清單）+ Step 5（Rules 下放決策） |
| 3 | user 禁止自己修改自己的層級 | ✅ 完整 | Step 4 |
| 4 | 只有 super_admin / admin 可在用戶管理調整用戶層級 | ✅ 已補強 | Step 3（最低角色等級防線 + 邊界規則） |
| 5 | 場主 / 領隊 / 教練取得身分後自動獲得權限 | ✅ 已新增 | Step 3.5 |

### 附錄 B：Permission Code ↔ Firestore Rule 對照表（骨架）

> 完整版在 Step 1 盤點後產出，以下為已知項目的骨架。

| Permission Code | 前端入口 | Firestore Collection.Operation | Rule 函式 |
|----------------|---------|-------------------------------|----------|
| `admin.users.entry` | `page-admin-users` | `users` read（透過 CF） | `adminManageUser()` |
| `admin.users.edit_profile` | 用戶管理 → 編輯 | `users` update（透過 CF） | `adminManageUser()` profileUpdate |
| `admin.users.change_role` | 用戶管理 → 改角色 | `users` update（透過 CF） | `adminManageUser()` roleChange |
| `admin.users.restrict` | 用戶管理 → 限制 | `users` update（透過 CF） | `adminManageUser()` restrictionUpdate |
| `admin.banners.entry` | `page-admin-banners` | `banners` write | `isAdmin()` |
| `admin.messages.entry` | `page-admin-messages` | `adminMessages` write | `isAdmin()` |
| `admin.announcements.entry` | `page-admin-announcements` | `announcements` write | `isAdmin()` |
| `admin.achievements.entry` | `page-admin-achievements` | `achievements` / `badges` write | `isAdmin()` |
| `admin.themes.entry` | `page-admin-themes` | `siteThemes` write | `isAdmin()` |
| `admin.logs.entry` | `page-admin-logs` | — | 頁面入口 |
| `admin.logs.error_read` | 日誌中心 → 錯誤日誌 | `errorLogs` read | `isSuperAdmin()` → 待改 |
| `admin.logs.error_delete` | 日誌中心 → 清除 | `errorLogs` delete | `isSuperAdmin()` → 待改 |
| `admin.logs.audit_read` | 日誌中心 → 稽核日誌 | `auditLogsByDay` read | `isSuperAdmin()` → 待改 |
| `admin.auto_exp.entry` | `page-admin-auto-exp` | `autoExpRules` write | **無 Rules（缺口）** |
| `admin.repair.entry` | `page-admin-repair` | — | 頁面入口 |
| `admin.repair.team_join_repair` | 補正 → 歷史入隊 | `teamJoinRepairs` | `canRunTeamJoinRepair()` |
| `admin.repair.no_show_adjust` | 補正 → 放鴿子 | `userCorrections` | `canManageNoShowCorrections()` |
| `activity.manage.entry` | `page-my-activities` | `events` write | `isAuth()` + owner |
| `admin.tournaments.entry` | `page-admin-tournaments` | `tournaments` write | `isAdmin()` |
| `admin.roles.entry` | ~~`page-admin-roles`~~ | `rolePermissions` write | **DISABLED — 不可下放** |

### 附錄 C：Admin 改角色邊界規則

Cloud Function `adminManageUser()` roleChange 分支應遵守以下規則：

| 呼叫者角色 | 可升級目標 | 可降級目標 | 備註 |
|-----------|-----------|-----------|------|
| `super_admin` | 任何角色 | 任何角色 | 無限制 |
| `admin` | user → coach / captain / venue_owner | coach / captain / venue_owner → user | 不可升為 admin / super_admin |
| `admin` | — | — | 不可修改同級 admin 或 super_admin |
| coach / captain / venue_owner | — | — | **即使持有 capability 也被拒絕**（最低角色等級防線） |
| user | — | — | 無權限 |

實作要點（`functions/index.js` roleChange 分支）：

```javascript
// 1. 最低角色等級檢查（防 capability 誤授）
const ROLE_LEVELS = { user:0, coach:1, captain:2, venue_owner:3, admin:4, super_admin:5 };
const callerLevel = ROLE_LEVELS[access.role] ?? 0;
if (callerLevel < ROLE_LEVELS.admin) {
  throw new HttpsError("permission-denied", "Only admin or above can change roles");
}

// 2. 目標角色上限檢查（admin 不可指派 admin / super_admin）
if (!access.isSuperAdmin && (ROLE_LEVELS[nextRole] ?? 0) >= ROLE_LEVELS.admin) {
  throw new HttpsError("permission-denied", "Only super_admin can assign admin-level roles");
}

// 3. 被修改者等級檢查（admin 不可改同級或更高）
const targetLevel = ROLE_LEVELS[targetRole] ?? 0;
if (!access.isSuperAdmin && targetLevel >= callerLevel) {
  throw new HttpsError("permission-denied", "Cannot modify user with equal or higher role");
}
```
