# 權限治理修正計畫書 2026-03-12

## 目標

本計畫書對應以下 6 個明確目標：

1. `super_admin` 保持最高權限；若現況已成立則只驗證、不重構。
2. 移除「權限管理後台入口」的可配置開關，確保只有 `super_admin` 可進入 `page-admin-roles`。
3. 任何 permission toggle 一旦開啟或關閉，該角色使用者要立即落實擁有或失去該權限，不可再出現「後台已開但實際不可用」。
4. 收緊 `users.update`，禁止 `admin` 直接改 `role / manualRole / claims / isAdmin`。
5. `admin` 若被賦予「用戶管理」下的某個權限，該項操作要在 UI、Firestore Rules、Cloud Functions 三層都一致生效。
6. 使用者一旦改變身分，必須立即落實擁有新角色已開啟的權限，並失去舊角色不再擁有的權限。

## 現況判讀

目前系統不是單一權限模型，而是三套混合：

- 角色等級：`ROLE_LEVEL_MAP` / `currentRole`
- Permission code：`rolePermissions`
- 靜態特權判斷：`isAdmin()` / `isSuperAdmin()` / `isCoachPlus()`

已確認的主要不一致：

- `page-admin-roles` 目前仍有 `permissionCode` 入口，代表理論上可把權限管理頁入口派發給非 `super_admin`。
- 多數 UI 入口走 permission code，但很多實際寫入仍走 `isAdmin()` / `isSuperAdmin()`。
- `users.update` 目前對 `admin` 過寬，存在繞過前端直接改敏感欄位的風險。
- Cloud Functions 目前只把內建角色視為有效管理角色，自訂角色與 permission code 的落實不完整。
- 角色切換與 claims 同步雖然已有部分機制，但尚未形成「角色改變 -> 權限立即落實」的完整閉環。

## 設計原則

- `users.role` 是正式角色來源。
- `manualRole` 只作為人工保底角色，不可被一般 `admin` 任意改。
- `claims` 是 token mirror，不是正式權限來源。
- `isAdmin` 視為舊欄位，相容處理，不再作為正式授權依據。
- 權限必須以「是否具備某個 capability」為準，不再只靠頁面可見性推定可操作性。
- 所有可下放給 `admin` 的敏感動作，都必須有對應 permission code，且 UI / Rules / Functions 同步採用。

## 實作步驟

### Step 1：建立權限真相表與能力矩陣

工作內容：

- 盤點所有後台功能，分成三類：
  - `super_admin only`
  - `delegable by permission`
  - `role-level only legacy`
- 針對「用戶管理」拆出明確 capability，例如：
  - `admin.users.entry`
  - `admin.users.edit_profile`
  - `admin.users.change_role`
  - `admin.users.restrict`
  - `admin.users.view_sensitive`
- 明確標注每個 capability 對應的 UI、Firestore Rules、Cloud Functions。

自我驗收：

- 產出一張 capability 對照表，沒有任何一個敏感按鈕或寫入路徑處於「UI 有、Rules 沒有」或「Rules 有、UI 沒有」的未分類狀態。
- `super_admin` 專屬能力與可下放能力邊界清楚。

### Step 2：鎖死權限管理後台，只保留 super_admin

工作內容：

- 從權限目錄移除 `page-admin-roles` 的 `permissionCode` 開關。
- 確保 `page-admin-roles` 入口與頁面進入條件都只看 `super_admin`，不接受其他角色透過 toggle 取得。
- 清理現有 `rolePermissions` 中遺留的 `admin.roles.entry` 或等價入口碼，避免殘留設定繼續影響。

自我驗收：

- 非 `super_admin` 即使手動寫入舊的 `admin.roles.entry`，也無法看到或進入權限管理頁。
- `super_admin` 原有權限管理能力不受影響。

### Step 3：把 permission toggle 與實際授權來源統一

工作內容：

- 針對所有標記為 `delegable by permission` 的操作，統一改成 capability 驅動。
- Firestore Rules 對應寫入改用 `hasPerm(...)` 或等價 capability 檢查，而不是只看 `isAdmin()`。
- Cloud Functions 對應 callable 也改成同一份 capability 檢查，不再只接受內建角色白名單。
- 前端按鈕顯示、頁面入口、送出前檢查全部改用同一份 capability 名稱。

自我驗收：

- 任意一個 capability 開啟後，同角色使用者在不重新部署的情況下即可使用。
- 任意一個 capability 關閉後，同角色使用者立即失去對應 UI 與後端寫入能力。
- 不再出現「頁面進得去但按鈕不能用」或「按鈕能按但 Rules 拒絕」的情況。

### Step 4：收緊 users.update，切斷 admin 直接改敏感欄位

工作內容：

- 在 `users.update` 規則中把敏感欄位拆出：
  - `role`
  - `manualRole`
  - `claims`
  - `isAdmin`
- 明確禁止一般 `admin` 直接透過 `users.update` 修改上述欄位。
- 一般 `admin` 僅能修改被授權的非敏感 user 管理欄位，且要有對應 capability。

自我驗收：

- `admin` 直接對 `users/{uid}` 發送原始寫入，嘗試修改 `role/manualRole/claims/isAdmin` 會被 Rules 拒絕。
- `user` 自己修改上述欄位也一律被拒絕。
- `super_admin` 或明確授權的安全路徑仍可完成必要更新。

### Step 5：把「用戶管理」改成真正可下放的 capability

工作內容：

- 將用戶管理頁內的動作拆成可配置權限：
  - 看列表
  - 編輯基本資料
  - 限制/解除限制
  - 變更角色
- 前端不再硬寫 `currentRole >= super_admin`，改成檢查對應 capability。
- 後端 Rules / Functions 與前端採同一組 capability 名稱。
- 若某動作不打算下放，則明確標記為 `super_admin only`，不再放進 toggle 清單。

自我驗收：

- `admin` 只拿到 `admin.users.edit_profile` 時，只能修改基本資料，不能改角色。
- `admin` 拿到 `admin.users.change_role` 時，角色變更可在 UI、Rules、claims 同步三層完整落實。
- 未被授權的動作在 UI 看不到，或看到也無法送出，且 Rules 最終仍會擋下。

### Step 6：建立角色切換即時生效閉環

工作內容：

- 將角色變更流程標準化：
  - 更新 `users.role`
  - 必要時更新 `manualRole`
  - 同步 claims
  - 強制刷新當前使用者 token
  - 重新套用角色與 permission cache
- 對於被改身分的使用者，明確定義生效時機：
  - 自己當前在線：立即刷新並生效
  - 其他使用者：下次 token refresh / 重登入時生效
- Cloud Functions 不能再把自訂角色一律 normalize 成 `user`。

自我驗收：

- 使用者從 A 角色改到 B 角色後，B 角色已開啟的 permission 立即可用。
- 舊角色已關閉的 permission 立即失效。
- 自訂角色與內建角色都遵守同一套生效規則，不再出現 claims 與 Firestore 角色分裂。

### Step 7：補齊測試與第三方驗證

工作內容：

- 新增 Rules 測試：
  - `user` 不可自改敏感欄位
  - `admin` 不可直改敏感欄位
  - `admin` 有明確 capability 時只能做被授權動作
  - `super_admin` 可做全部應保留動作
- 新增 UI / integration smoke list：
  - 開啟 permission 後立即生效
  - 關閉 permission 後立即失效
  - 角色改變後權限立即切換
- 以第三方角色重新驗證：
  - `user`
  - `admin`（有部分 capability）
  - `custom role`
  - `super_admin`

自我驗收：

- 沒有任何一條測試路徑出現「給了權限卻仍不可用」。
- 沒有任何一條測試路徑讓 `user` 或未授權 `admin` 自行升權。
- 第三方角度重新審視時，UI、Rules、Functions 三層結論一致。

## 建議執行順序

1. Step 1：真相表與 capability 矩陣
2. Step 2：鎖死權限管理後台
3. Step 4：先收緊 `users.update`
4. Step 5：重做用戶管理 capability
5. Step 3：把其他可下放功能統一 capability 化
6. Step 6：補完角色切換即時生效閉環
7. Step 7：測試與第三方驗證

## 交付標準

本計畫完成後，必須同時滿足以下結果：

- `super_admin` 是唯一能管理角色層級與權限結構的人。
- `admin` 只能做被明確授權的管理動作，且授權一旦開啟就必定可落實。
- `user` 沒有任何直接或繞路自升權方法。
- 角色變更與 permission toggle 的效果能在 UI、Rules、Functions 三層同步落實。
