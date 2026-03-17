# F-01 Phase A 實作紀錄（2026-02-26）

> **文件用途說明**
> 本文件是 F-01 修補計劃中 Phase A 的**實作紀錄與驗收報告**。
> 記錄了實作內容、自我驗收結果，以及 2026-02-26 由 Claude 進行的靜態驗收結果（含發現問題與修正建議）。
> 作為 Phase B 實作前的參考依據，Phase B 完成後本文件可封存。
> 對應計劃文件：`docs/f01-followup-remediation-plan-20260226.md`

---

## 範圍

本次只實作 `F-01` 後續修補計劃中的 `Phase A`（Functions 端），目標是：

1. 修復新用戶首次 LINE 登入可能在 `setCustomUserClaims` 發生 `auth/user-not-found` 而崩潰
2. 補齊 `Custom Claims` 設定流程的穩定性（保留既有 claims）
3. 補齊 legacy `users` 文件相容（`doc.id != uid`）
4. 過渡修補 `syncUserRole`，避免 claims / rules 過渡期判斷分叉

本次不處理：

1. `Phase B` 的 `adminChangeRole` callable 收斂
2. `F-01-C`（auto-exp / EXP logs）
3. `F-02`（LINE 推播 callable 恢復）

---

## 實作檔案

1. `functions/index.js`
2. `docs/f01-phase-a-implementation-20260226.md`（本文件）
3. `docs/claude-memory.md`
4. `js/config.js`（版本號）
5. `index.html`（版本號）

---

## 實作內容（Phase A）

### A-1 新增 `ensureAuthUser(uid)`

位置：`functions/index.js:33-47`

目的：

1. 在簽發 custom token 前先確保 Firebase Auth user 已存在
2. 避免 `setCustomUserClaims` 因 `auth/user-not-found` 失敗

行為：

1. 先 `authAdmin.getUser(uid)`
2. 若不存在則 `authAdmin.createUser({ uid })`
3. 處理併發競態（`auth/uid-already-exists`）後再 `getUser(uid)`

### A-2 Claims 寫入改為 merge（保留既有 claims）

位置：`functions/index.js:81-90`

新增：

1. `setRoleClaimMerged(uid, role)`

改動重點：

1. 先讀 `authAdmin.getUser(uid).customClaims`
2. merge 後再 `setCustomUserClaims`
3. 保留其他 claims，避免被 `role` 覆蓋掉

### A-3 `getUserRoleFromFirestore` 補 legacy 相容

位置：`functions/index.js:49-79`

新增：

1. `findUserDocByUidOrLineUserId(uidOrDocId)`
2. `getAuthUidFromUserDoc(found, fallbackUid)`

改動重點：

1. 先查 `users/{uid}`
2. 查不到再用 `where('lineUserId', '==', uid).limit(1)` fallback
3. 支援 legacy `doc.id != uid` 資料
4. `getAuthUidFromUserDoc` 解析優先順序：`data.uid` → `data.lineUserId` → `docId` → `fallbackUid`

### A-4 `createCustomToken` 流程修正

位置：`functions/index.js:135-159`

新流程：

1. 驗證 LINE access token -> `lineUserId`
2. `ensureAuthUser(lineUserId)`
3. 從 Firestore 取 role（含 legacy fallback）
4. `setRoleClaimMerged(lineUserId, role)`
5. `createCustomToken(lineUserId)`

效果：

1. 新用戶首次登入不再依賴 `onUserCreate` 觸發
2. 首次登入前就能完成 claims 設定

### A-5 `syncUserRole` 過渡修補（含 legacy target resolve）

位置：`functions/index.js:161-206`

修補內容：

1. caller 權限驗證改成 `claims 優先 + Firestore fallback`
2. target 使用 `findUserDocByUidOrLineUserId(targetUid)` 解析（避免 legacy `_docId` 誤判）
3. 由解析後的實際 auth uid 進行 `ensureAuthUser + setRoleClaimMerged`
4. 回傳增加 `targetDocId`

補充：

1. 本次仍保留 `syncUserRole`（相容舊前端：`firebase-crud.js:572` 傳 `{ targetUid: uid }` 無 `newRole`）
2. 正式角色變更收斂仍待 `Phase B` 的 `adminChangeRole`

---

## 自我驗收（本次已執行）

1. `node --check functions/index.js`：通過
2. 檢查 `createCustomToken` 流程已包含 `ensureAuthUser -> get role -> set claims -> create token`
3. 檢查 `syncUserRole` 已支援：
   - caller claims 缺失時 Firestore fallback
   - target legacy `doc.id != uid` 解析
4. 檢查 claims 寫入已改為 merge（不再直接覆蓋 `{ role }`）

---

## 外部靜態驗收結果（2026-02-26，Claude）

驗收方式：對照 `functions/index.js` 原始碼 + `js/firebase-crud.js` 呼叫端交叉比對。

### A-1 ✅

`ensureAuthUser`（line 33-47）流程正確，race condition 處理完整。

### A-2 ✅

`setRoleClaimMerged`（line 81-90）merge 邏輯正確，`normalizeRole` allowlist 保護有效。

### A-3 ✅

`findUserDocByUidOrLineUserId` + `getAuthUidFromUserDoc` 邏輯正確，legacy UID 解析優先順序符合預期。

### A-4 ✅

`createCustomToken` 流程（line 135-159）與計劃 A-4 一致，失敗時明確拋出而非靜默跳過（比舊版更安全）。

### A-5 ✅

確認前端呼叫慣例（`firebase-crud.js:572`：`fn({ targetUid: uid })`，無 `newRole` 欄位），與新版 `syncUserRole` 只從 Firestore 讀 role 的行為完全相容，不破壞既有前端。

### 發現問題（不阻擋部署，需標注）

**問題 1（High）：`已知限制` 原說明不完整**

原第 1 條「syncUserRole 仍是過渡 API」會讓人誤以為 admin 仍可透過前端做角色變更，但實際上已完全失效（見下方已知限制更新說明）。→ 已在本文件「已知限制」中修正。

**問題 2（Medium）：`createCustomToken` 路徑有兩次 `authAdmin.getUser()` 呼叫**

`ensureAuthUser`（line 35）與 `setRoleClaimMerged`（line 82）各呼叫一次，第一次的回傳值被丟棄。兩次 Auth API call 在低流量下可接受。建議 Phase B 時傳遞 userRecord 避免重複呼叫，但不阻擋 Phase A 部署。

**問題 3（Low）：`processLinePushQueue` 推播失敗仍自動 unbind（line 272-280）**

屬於 F-02 範疇，Phase A 不處理，已記錄於 `f01-followup-remediation-plan-20260226.md` 交叉依賴分析。

### 驗收結論

**Phase A 可部署。** 部署前請確認操作人員已知「admin 角色變更過渡期限制」（見下方已知限制第 1 條）。

---

## 已知限制（Phase A 後仍存在）

1. **`admin`（非 `super_admin`）透過前端 UI 更改用戶角色目前完全失效。**
   根本原因：`firebase-crud.js` 的 `updateUserRole()` / `updateUser()` 用 client SDK 寫入 `users.role`，被 `firestore.rules` 的 `adminUserUpdateSafe()` 中 `sameFieldValue('role')` 擋住（PERMISSION_DENIED）。`promoteUser()` / `_recalcUserRole()` 的 `.catch(console.error)` 會靜默吞掉錯誤，UI 不顯示失敗。
   **過渡期處置**：角色變更請由 `super_admin` 操作，或直接在 Firebase Console 修改 Firestore `users.role` 欄位後，重新登入讓 `createCustomToken` 同步 claims。Phase B 的 `adminChangeRole` callable 上線後恢復正常。

2. `users` 與 claims 的跨系統更新仍非原子（待 `adminChangeRole` + 補償策略，Phase B）

3. `auto-exp`（F-01-C）仍可能因 rules 收緊而失敗（`adjustUserExp` 的 `users.exp` 寫入被 `sameFieldValue('exp')` 擋住、`expLogs` 被 `isAdmin()` 擋住），未在本次處理

4. claims 降權不會 100% 即時生效（需 token refresh / 重新登入，最長 1 小時）

5. legacy `doc.id != uid` 用戶登入後 claims 正確，但前端 `createOrUpdateUser()` 仍可能建立第二個新 doc（`users/{lineUserId}`）與舊 doc 並存（D-7 問題，待 Phase B 或專門 migration script 處理）

---

## 部署建議（Phase A）

1. 先部署 Functions：`firebase deploy --only functions`
2. 驗收新用戶首次登入與既有管理員重新登入 claims
3. 告知操作人員：過渡期 admin 角色變更需由 super_admin 執行
4. 驗收通過後再進入 Phase B（`adminChangeRole` callable + 前端收斂）
---

## 2026-02-26 Follow-up 實作日誌（Round 2）

> 本段為後續補強，目標是降低「未完成或未證實」項目的營運風險，不改動 `comprehensive-audit-20260226.md` 的勾選狀態。

### 本次實作範圍
1. `functions/index.js`：新增 `backfillRoleClaims` Callable（`super_admin` only）
2. `js/api-service.js`：`updateAdminUser()` 改為 `async`，失敗時回滾本地快取
3. `js/firebase-crud.js`：`rolePermissions/customRoles` 的 CRUD 不再吞錯（改為拋錯）
4. `js/modules/user-admin-list.js`：角色編輯/升級改為 `await` 後端成功才顯示成功
5. `js/modules/user-admin-roles.js`：權限切換/重設/自訂角色新增刪除加上 `await + rollback`
6. `docs/smoke-test.md`：新增 F-01 後續 smoke test 手動清單

### 實作重點
- `backfillRoleClaims` 支援分批與分頁：
- 參數：`limit`（1-200）、`dryRun`、`startAfterDocId`
- 回傳：`processed / updated / failed / legacyResolved / nextCursor / hasMore`
- `backfillRoleClaims` 沿用既有 legacy resolve 邏輯（`docId / uid / lineUserId`）回填 claims。
- 前端角色/權限管理改為「寫入失敗就回滾 UI 狀態」，避免畫面先顯示成功但 Firestore 實際失敗。

### 風險與限制（本次仍保留）
- `admin` vs `super_admin` 的權限策略仍維持「最小權限」：`customRoles/rolePermissions/permissions` 仍為 `super_admin` only（未放寬 rules）。
- `backfillRoleClaims` 目前提供 callable 工具，但尚未接前端 UI 按鈕（可由 console / functions callable 手動執行）。
- 「正常流程不受影響」仍需實機手動 smoke test；本次已先補清單與關鍵管理流程的錯誤回滾。

### 本次驗證
- `node --check functions/index.js`
- `node --check js/api-service.js`
- `node --check js/firebase-crud.js`
- `node --check js/modules/user-admin-list.js`
- `node --check js/modules/user-admin-roles.js`
