# F-01 後續修補計劃（可實作版，含修正版 Phase A/B）

## 目標

建立「以 Custom Claims 作為安全敏感權限來源」的完整流程，降低 Firestore / Functions / 前端狀態分叉風險，同時避免首次登入崩潰與角色同步半成功。

## 範圍說明（避免東牆補西牆）

1. 「唯一權限來源」指的是 `Firestore Rules + Cloud Functions` 的敏感權限判斷。
2. `users.role` 保留作 UI / 資料展示用途，但不再視為可由本人修改的安全權限來源。
3. Phase A / B 不處理 EXP 發放（F-01-C 議題），只處理 F-01 的登入與角色變更一致性。

> **D-1 `Critical` 審查備註：F-01-C auto-exp 已是 production bug，不能推遲**
>
> `_grantAutoExp` 由一般用戶 session 觸發（報名、取消、評價、加入球隊等 **13 處**呼叫點：
> `event-detail-signup.js:70,226`、`event-detail-companion.js:132,245`、`event-detail.js:356`、
> `event-create.js:586`、`scan.js:502,754`、`team-form.js:88`、`team.js:277,489`、`team-detail.js:270`）。
>
> `adjustUserExp`（`api-service.js:526-542`）執行兩個 Firestore 寫入：
> 1. `db.collection('users').doc(user._docId).update({ exp })` → 被 `ownerUserUpdateSafe` 的 `sameFieldValue('exp')`（`firestore.rules:82`）擋住
> 2. `db.collection('expLogs').add(...)` → 被 `isAdmin()`（`firestore.rules:390`）擋住
>
> **兩個寫入在一般用戶 session 下都靜默失敗**（`.catch(console.error)` 吞掉錯誤）→ EXP 系統完全無效。
>
> **建議**：Phase A 至少加暫時方案（例如在 `createCustomToken` 或 `adminChangeRole` 附近新增
> `grantExp` callable，讓 EXP 寫入走 Admin SDK 繞過 rules）；或在本文件新增 Phase A+ 專門處理。
> 延後到 Phase C 會讓 EXP 在整個 Phase A/B 期間持續失效。

## 核心設計決策

1. 不使用 `onUserCreate` 當首次登入補 claims 的主方案。
2. 在 `createCustomToken` 內主動 `ensureAuthUser(uid)`，先確保 Auth user 存在，再設 claims。
3. 角色變更收斂到後端 `adminChangeRole` callable，但明確承認「非跨系統原子」，用補償機制降低半成功風險。
4. Backend 在 Phase B 就處理舊資料 `users doc.id != uid` 相容，不能等到 Phase C 才補。
5. 前端所有角色變更路徑一起收斂，不只改 `updateAdminUser()`。

---

## Phase A（當天，緊急修補，阻止首次登入崩潰）

### A-1 `functions/index.js`：新增 `ensureAuthUser(uid)`

目的：避免新用戶首次登入時 `setCustomUserClaims` 因 `auth/user-not-found` 失敗。

做法：

1. 先 `authAdmin.getUser(uid)`。
2. 若 `auth/user-not-found`，呼叫 `authAdmin.createUser({ uid })`。
3. 若 `auth/uid-already-exists`（併發競態），再 `getUser(uid)` 一次視為成功。
4. 其他錯誤直接拋出。

### A-2 `functions/index.js`：`setRoleClaim` 改成保留既有 claims

問題：目前 `setCustomUserClaims(uid, { role })` 會覆蓋其他 claims。

做法：

1. 先讀 `authAdmin.getUser(uid).customClaims`。
2. merge 後寫回，例如 `{ ...oldClaims, role: normalizedRole }`。
3. `role` 仍使用 `normalizeRole()` 的 allowlist（至少保護敏感權限）。

> **D-10 `Medium` 審查備註：merge 併發風險未提及**
>
> `getUser(uid).customClaims` → merge → `setCustomUserClaims` 不是原子操作。
> 若兩個 Cloud Function 同時執行（例如 `createCustomToken` 和 `syncUserRole` 併發觸發），
> 後寫的會覆蓋先寫的 merge 結果。
>
> **建議**：在計劃中標注此已知限制，並考慮：
> 1. 對 `setRoleClaimMerged` 加 Firestore transaction 或分散式鎖（例如用 Firestore doc 做 optimistic lock）
> 2. 或至少文件化「claims merge 不是 concurrent-safe」，在 Phase B 確保 `adminChangeRole` 是唯一寫 claims 的入口後，併發風險自然降低。

### A-3 `functions/index.js`：`getUserRoleFromFirestore(uid)` 立刻補舊資料相容

不要等 Phase C 才做。

做法：

1. 先讀 `db.collection("users").doc(uid)`。
2. 若不存在，再 `where("lineUserId", "==", uid).limit(1)` 查舊資料。
3. 找到就讀 role；找不到回 `user`。

原因：

1. 現有前端仍有歷史資料可能不是 `doc.id == uid`。
2. 不補這個，既有 admin 可能登入後 claims 被錯設成 `user`。

> **D-7 `High` 審查備註：lineUserId fallback 找到的 doc.id != uid 時，後續 users create 會失敗**
>
> A-3 的 fallback 查到舊文件（`doc.id = "old_xxx"`）後，`createCustomToken` 回傳的 `role` 是正確的。
> 但前端拿到 customToken 後以 `auth.uid`（= LINE userId）登入，接著 `createOrUpdateUser()` 會嘗試
> `db.collection('users').doc(uid).set(...)` 建新文件。
>
> Firestore Rules（`firestore.rules:199-203`）要求：
> - `isOwner(userId)` → `request.auth.uid == userId` ✓（通過）
> - `request.resource.data.uid == userId` ✓（若前端正確填 uid）
>
> **但問題是**：這會建立一個 **第二個** users doc（新 doc.id = LINE userId），與舊 doc 並存。
> 後續 `updateUser` 若仍指向舊 `_docId`，就會因 `isOwner` 失敗。
>
> **建議**：A-3 找到 `doc.id != uid` 的舊文件時，應在 Cloud Function 端：
> 1. 將舊文件的 role 讀出來（已做）
> 2. **額外回傳 `legacyDocId`** 給前端，或
> 3. **在 CF 端直接做 migration**：建新 doc(`uid`) 複製舊資料 → 刪舊 doc（Admin SDK 繞過 rules）
> 選項 3 最乾淨，一次性解決舊資料問題。

### A-4 `functions/index.js`：修正 `createCustomToken` 流程（取代原本 try-catch 跳過方案）

建議流程：

1. 驗證 LINE access token 取得 `lineUserId`
2. `await ensureAuthUser(lineUserId)`
3. `const role = await getUserRoleFromFirestore(lineUserId)`
4. `await setRoleClaimMerged(lineUserId, role)`
5. `const customToken = await authAdmin.createCustomToken(lineUserId)`
6. `return { customToken, role }`

為什麼不用「catch user-not-found 然後跳過」：

1. 跳過 claims 會讓首次登入的權限狀態不確定。
2. `onUserCreate` 對 custom token 流程不可靠，不能當主修法。

### A-5 `functions/index.js`：`syncUserRole` 先做過渡修補（不重構）

做法：

1. `callerRole` 驗證改成 `claims 優先 + Firestore fallback`（和 rules 過渡策略一致）。
2. 呼叫 `setRoleClaim` 前先 `ensureAuthUser(targetUid)`。
3. 保留 API（避免前端立即壞掉）。

備註：這是過渡措施，Phase B 會用 `adminChangeRole` 取代角色變更主流程。

> **D-11 `Medium` 審查備註：A-5 syncUserRole fallback 細節不足**
>
> 「claims 優先 + Firestore fallback」的具體邏輯未展開：
> - fallback 是讀 caller 的 `users` doc 的 `role` 欄位？還是用 `findUserDocByUidOrLineUserId`？
> - 若 caller 的 claims 尚未設定（Phase A 剛部署，admin 未重登入），fallback 到 Firestore 讀到的 role 是否能通過 `['admin','super_admin'].includes(callerRole)` 的驗證？
>
> **建議**：明確寫出 fallback 虛擬碼，避免實作時漏掉 edge case。例如：
> ```
> const callerRole = request.auth?.token?.role
>   || (await getUserRoleFromFirestore(request.auth.uid));
> ```

> **D-2 `Critical` 審查備註：現有 admin（非 super_admin）角色變更已壞**
>
> 原始碼驗證確認：
> - `adminUserUpdateSafe()`（`firestore.rules:91-102`）包含 `sameFieldValue('role')` + `sameFieldValue('manualRole')` + `sameFieldValue('exp')`
> - 這表示 `admin` 透過 client SDK 的 direct write **無法更改任何用戶的 role、manualRole、exp**
> - 只有 `isSuperAdmin()` 可繞過（`firestore.rules:205`）
>
> **影響**：
> - `promoteUser()`（`api-service.js:469-478`）→ 呼叫 `FirebaseService.updateUserRole()` → direct write → admin session 下 **PERMISSION_DENIED**
> - `_recalcUserRole()`（`api-service.js:485-520`）→ 同上
> - 所有 admin 操作（升降權、批次角色調整）在 Phase A→B 過渡期完全失效
>
> **建議**：
> 1. Phase A 驗收清單應加上「admin 角色變更功能暫時不可用」的明確警告
> 2. 或在 Phase A 同時部署一個簡易 `adminChangeRole` callable（即使不完整），讓 admin 有暫時的後端管道
> 3. Phase B 的優先級應提高——**Phase A 部署後 admin 角色管理立即失效**

### Phase A 部署順序

1. `firebase deploy --only functions`
2. 不動前端，不動 rules（除非同步微調 logging）

### Phase A 驗收

1. 新 LINE 用戶首次登入成功，不再崩潰。
2. Firebase Console `Authentication` 出現該 uid。
3. 該 uid 的 Custom Claims 有 `role`（至少 `user`）。
4. 舊 admin / super_admin 重新登入後 claims 正確。
5. 舊資料 `doc.id != uid`（若存在）登入後 claims 仍能正確讀到 role。

> **D-2 `Critical` 審查備註（補充）：Phase A 驗收缺少 admin 過渡期限制說明**
>
> Phase A 只部署 functions，不動 rules。但現有 rules 的 `adminUserUpdateSafe()` 已經擋住 admin
> 的 role/manualRole/exp direct writes。Phase A 部署後 admin 的角色管理功能**已經是壞的**
> （不是 Phase A 弄壞的，是現有 rules 本就如此）。
>
> **建議**：在 Phase A 驗收清單加入：
> 6. ⚠️ 已知限制：admin（非 super_admin）無法透過前端 UI 更改用戶角色，需等 Phase B 的 `adminChangeRole` callable 上線。過渡期若需角色變更，請由 super_admin 操作或透過 Firebase Console 手動修改。

---

## Phase B（1-2 天，收斂角色變更流程，降低分叉）

### B-0 先做範圍決策（必做）

決策內容：

1. `adminChangeRole` 在 Phase B 只處理內建安全角色：`user / coach / captain / venue_owner / admin / super_admin`。
2. 自訂角色 `customRoles` 的「定義管理」不受影響。
3. 若 UI 允許把使用者直接改成 custom role，Phase B 先暫時禁用該入口或加提示（待後續擴充）。
4. 不在 Phase B 一次重構 custom role 權限層級模型（避免範圍爆炸）。

### B-1 `functions/index.js`：新增共用 helper（給 `adminChangeRole` / `syncUserRole` 用）

建議 helper：

1. `getCallerRoleWithFallback(request)`：claims 優先，無 claims 才讀 Firestore（過渡期）
2. `findUserDocByUidOrLineUserId(uid)`：解決 `doc.id != uid`
3. `setRoleClaimMerged(uid, role)`：保留既有 claims
4. `ensureAuthUser(uid)`：沿用 Phase A

### B-2 `functions/index.js`：新增 `adminChangeRole` Callable（角色變更唯一入口）

責任：

1. 驗證 caller 已登入。
2. 驗證 caller 權限（claims 優先 + Firestore fallback）。
3. 驗證目標使用者存在（用 uid / lineUserId resolve）。
4. 驗證 `newRole` 合法（內建角色 allowlist）。
5. 保護 `super_admin`：
   - 只有 `super_admin` 可指派 `super_admin`
   - 只有 `super_admin` 可修改目前是 `super_admin` 的目標（包含降權）
6. 更新 Firestore `users/{targetDoc}` 的 `role / manualRole / updatedAt`
7. 更新 target 的 Custom Claims
8. 回傳結果（`targetUid`, `targetDocId`, `newRole`）

### B-2 一致性處理（重要：補償，不是假原子）

做法：

1. 先讀取目標舊值（`oldRole`, `oldManualRole`）。
2. 寫 Firestore 新角色。
3. 寫 claims。
4. 若 claims 失敗：
   - best-effort rollback Firestore 回舊值
   - log error（含 `targetUid`, `oldRole`, `newRole`, rollback 是否成功）
   - 回 `HttpsError('aborted' 或 'internal')`
5. 前端收到錯誤一律視為失敗，不更新 UI 本地狀態。

備註：這不是 100% 原子，但已比前端兩段式穩定很多。

> **D-3 `Critical` 審查備註：B-2 adminChangeRole 使用 Admin SDK 寫 Firestore 但未明確說明**
>
> `adminChangeRole` 是 Callable Function，步驟 6 寫 `users/{targetDoc}` 時使用的是 **Admin SDK**
> （`admin.firestore().collection('users').doc(...).update(...)`），因此 **繞過 Firestore Rules**。
> 這是正確的設計（callable 內部以 Admin 身分操作），但計劃未標明此關鍵設計決策。
>
> **風險**：第三者實作時可能誤用 client SDK（`firebase.firestore().collection(...)`），
> 導致被 `adminUserUpdateSafe()` 的 `sameFieldValue('role')` 擋住。
>
> **建議**：在 B-2 步驟 6 明確加註：「使用 Admin SDK（`admin.firestore()`）寫入，繞過 client rules。
> 前端只透過 callable 觸發，絕不用 client SDK 直接寫 role。」

> **D-8 `High` 審查備註：B-2 缺少「最後一個 super_admin 不能自降」保護**
>
> B-2 步驟 5 保護了「只有 super_admin 可降權 super_admin」，但未處理邊界情況：
> **如果只剩一個 super_admin，且該 super_admin 將自己降為 admin？**
>
> 這會導致系統內無任何 super_admin，後續所有 super_admin-only 操作
> （`rolePermissions` 寫入、`customRoles` 管理、角色最高權限指派）全部失效。
>
> **建議**：在 `adminChangeRole` 加入檢查：
> ```javascript
> if (targetCurrentRole === 'super_admin' && newRole !== 'super_admin') {
>   const superAdminCount = await db.collection('users')
>     .where('role', '==', 'super_admin').get();
>   if (superAdminCount.size <= 1) {
>     throw new HttpsError('failed-precondition',
>       '系統至少需要一個 super_admin');
>   }
> }
> ```

### B-3 `functions/index.js`：保留 `syncUserRole` 但降級為相容 API

做法：

1. 內部改走共用 helper。
2. 文件標記 deprecated。
3. 僅做「補同步 claims」，不再作為角色變更主流程。

### B-4 `js/firebase-crud.js`：新增角色變更專用方法，避免 generic `updateUser()` 亂入

建議新增：

1. `changeUserRoleByUid(targetUid, newRole)`
2. 內部只呼叫 `adminChangeRole` callable
3. 成功後若 `auth.currentUser.uid === targetUid`，強制 `getIdToken(true)`

同時調整：

1. `updateUser(docId, updates)` 若包含 `role` / `manualRole`
   - 不直接寫 Firestore role
   - 拆成 `role 部分` + `非 role 部分`
   - role 部分走 `changeUserRoleByUid`
   - 非 role 部分才 direct update
2. `updateUserRole(...)` 改成 wrapper（先相容，避免舊呼叫點立刻壞掉）

注意：

1. `targetUid` 不要再用 `_docId` 盲傳。
2. 從 cache 或 user object 取 `uid`；若缺失再 fallback 查文件。

### B-5 `js/api-service.js`：把角色變更路徑全面改成 `await + throw`

至少要改：

1. `updateAdminUser()` 改 `async`，後端成功才 `Object.assign(user, updates)`
2. `promoteUser()` 改 `async`
3. `_recalcUserRole()` 改 `async`
4. 內部角色變更都走 `FirebaseService.changeUserRoleByUid(...)`
5. 發生錯誤時 `throw`，不要只 `console.error`

> **D-5 `High` 審查備註：B-5 與 comprehensive-audit F-07 範圍重疊，可能重工**
>
> B-5 的目標是「把角色變更路徑全面改成 `await + throw`」，但 comprehensive-audit 的
> **F-07**（全域 optimistic update + 吞錯誤）要求 `_create/_update/_delete` **全部**改為
> `async + throw + rollback`，範圍遠大於 B-5。
>
> 若 B-5 只改角色相關方法（`updateAdminUser`、`promoteUser`、`_recalcUserRole`），
> 而 F-07 稍後又改底層 `_create/_update/_delete`，會導致：
> 1. 同一段 code 被改兩次（浪費 + 合併衝突風險）
> 2. B-5 的 `await` 改法可能與 F-07 的 rollback pattern 不一致
>
> **建議**：明確劃分：
> - B-5 **只改角色變更路徑**（走 callable，不走 `_update`）
> - F-07 **負責底層 `_create/_update/_delete`**（Phase 2 做）
> - 兩者的 `await + throw` pattern 應事先統一規格

### B-6 前端呼叫端一起改（不能漏）

至少要改：

1. `js/modules/user-admin-list.js`
   - `handlePromote()` 改 `async/await + try/catch`
   - `saveUserEdit()` 改 `async/await + try/catch`
   - 通知 / toast / 本地 UI 更新改在成功後執行
2. `js/modules/user-admin-roles.js`
   - 刪 custom role 時批次 demote 的 `updateUserRole(...)` 改 `await` 收斂錯誤
3. 其他直接調 `FirebaseService.updateUserRole()` 的地方一併替換

> **D-6 `High` 審查備註：B-6 遺漏 `team-form.js`（4 處 `_recalcUserRole` + 2 處 `promoteUser`）**
>
> B-6 只列出 `user-admin-list.js` 和 `user-admin-roles.js`，但漏掉最大的呼叫集中地：
>
> **`js/modules/team-form.js`**：
> - `_recalcUserRole` × 4：line 138、513、518、654
> - `promoteUser` × 2：line 467（promote to captain）、479（promote to coach）
>
> 這些呼叫發生在「建立球隊 / 編輯球隊 / 更換隊長教練」流程中，一旦 B-5 把
> `promoteUser` 和 `_recalcUserRole` 改成 async，`team-form.js` 的呼叫端若沒加
> `await + try/catch`，會產生 **unhandled promise rejection** 且 UI 不反映失敗。
>
> **建議**：B-6 「至少要改」清單應新增：
> ```
> 4. `js/modules/team-form.js`
>    - line 138: `_recalcUserRole(uid)` 改 `await + try/catch`
>    - line 467/479: `promoteUser(...)` 改 `await + try/catch`
>    - line 513/518: `_recalcUserRole(...)` 改 `await + try/catch`
>    - line 654: `_recalcUserRole(...)` 改 `await + try/catch`
> ```

### B-7 `firestore.rules`（Phase B 不做大改，只做必要對齊）

Phase B 先不移除 fallback，保留：

1. `authRole()` claims 優先 + Firestore fallback（過渡期）
2. `users` 欄位白名單保護（F-01 核心）

備註：Phase B 的主變更在 Functions + 前端，不在 rules。

### Phase B 部署順序

1. `firebase deploy --only functions`（先上 `adminChangeRole`）
2. 部署前端（`firebase-crud.js`, `api-service.js`, `user-admin-*`）
3. 若有 JS / HTML 變更，依規範更新 `CACHE_VERSION` 與 `index.html` 的 `?v=`

### Phase B 驗收（重點版）

1. `super_admin` 升 / 降一般用戶角色：
   - Firestore `users.role / manualRole` 更新
   - target claims 更新
   - 前端 UI 成功後才更新顯示
2. `admin` 嘗試把任何人設為 `super_admin`：
   - `permission-denied`
3. `admin` 嘗試修改目前是 `super_admin` 的目標：
   - `permission-denied`
4. 模擬 claims 更新失敗（臨時 throw）：
   - 前端收到失敗
   - Firestore 應回滾或至少明確記錄 rollback fail（不可靜默）
5. 舊資料 `doc.id != uid` 的用戶改角色：
   - 仍成功（backend resolve 成功）
6. 自己被改角色後重新登入：
   - claims 生效
7. 自己被改角色且當下在線：
   - 本機 token 在 refresh 後更新（若是自己變更）

---

## Phase C（Phase B 驗收通過後）

### C-1 確認所有用戶都已有 Claims

做法：

1. 使用 Firebase Console 或一次性腳本巡檢 / 補設 claims。
2. 腳本建議用 Admin SDK 列出 Auth users，按 uid 對應 `users` 文件角色補寫 claims。

### C-2 `firestore.rules`：移除 `roleFromUserDoc` fallback

前提：確認活躍用戶 claims 完整後再做。

`authRole()` 改回純 claims 版：

```rules
function authRole() {
  return (request.auth != null && request.auth.token.role is string)
    ? request.auth.token.role
    : 'user';
}
```

效果：

1. 消除 fallback 的 Firestore read 成本
2. rules 邏輯更單純
3. 權限來源一致性更高

### C-3 收尾：移除 / 關閉 `syncUserRole`（deprecated）

在前端與操作流程全部改用 `adminChangeRole` / 批次腳本後，再移除或封存 `syncUserRole`。

### Phase C 驗收

1. 有 claims 的用戶正常操作不受影響。
2. 無 claims 的用戶被當成 `user`（需重登入，符合預期）。
3. 舊資料 `doc.id != uid` 用戶登入後 claims 仍正確（若有此情況）。

---

## Phase D（持續）部署前回歸驗收清單

### 核心登入流程

1. 新用戶首次登入：不報錯，`users` 文件建立，claims 有 `role: 'user'`
2. 舊用戶重新登入：claims 正確反映 Firestore 中的 role
3. 舊 admin 未重登入：
   - Phase B 前可透過 fallback 操作（過渡期）
   - Phase C 後需重登入（符合預期）

### 角色變更

1. `super_admin` 升權其他用戶：Firestore + claims 同步成功，對方重登後權限正確
2. `admin` 降權其他一般用戶：同上（不可操作 `super_admin` 目標）
3. 一般用戶嘗試改他人 role：Firestore Rules 拒絕 + Callable 拒絕
4. 一般用戶改自己個資：成功，但 `role / exp / level` 等欄位不可更動
5. 降權後舊 token 使用者可能暫時保留舊權限直到 token refresh（claims 模型特性，需文件化）

### 敏感集合防護（現況一致版）

1. 一般用戶寫 `rolePermissions` → `PERMISSION_DENIED`
2. `admin` 寫 `rolePermissions` → `PERMISSION_DENIED`
3. `super_admin` 寫 `rolePermissions` → 成功
4. 一般用戶寫 `linePushQueue` → `PERMISSION_DENIED`（目前全封）
5. `admin` 寫 `linePushQueue` → `PERMISSION_DENIED`（目前全封）
6. 一般用戶寫 `announcements` → `PERMISSION_DENIED`
7. `admin` 寫 `announcements` → 成功

### 系統完整性

1. `expLogs / operationLogs` 一般用戶無法建立（F-01-C 議題，待 Callable 實作）
2. `attendanceRecords create` 帶 `uid` 欄位 → 成功（F-03 已修）
3. `attendanceRecords update` 非 admin → `PERMISSION_DENIED`

> **D-9 `High` 審查備註：Phase D 驗收清單漏掉 auto-exp 情境**
>
> 「系統完整性」只提到 `expLogs / operationLogs` 「待 Callable 實作」，
> 但完全沒有 auto-exp 的驗收項目。EXP 是用戶激勵系統的核心，應加入：
>
> **建議新增驗收項目**：
> 4. 一般用戶報名活動後 → EXP 正確增加，`expLogs` 有對應記錄
> 5. 一般用戶取消報名後 → EXP 正確扣減，`expLogs` 有對應記錄
> 6. 一般用戶提交評價後 → EXP 正確增加
> 7. 一般用戶加入球隊後 → EXP 正確增加
> 8. EXP 變更失敗時 → UI 顯示提示（不靜默吞掉）

---

## 執行順序與依賴關係

### Phase A（當天）

1. A-1：`ensureAuthUser`
2. A-2：`setRoleClaim` 改 merge
3. A-3：`getUserRoleFromFirestore` 補 `lineUserId` fallback
4. A-4：修正 `createCustomToken` 流程
5. A-5：`syncUserRole` 過渡修補

### Phase B（1-2 天）

1. B-0：範圍決策（customRoles Phase B 的策略）
2. B-1：Functions 共用 helper
3. B-2：`adminChangeRole` callable + 補償機制
4. B-3：`syncUserRole` 降級相容
5. B-4：`firebase-crud.js` 收斂角色變更入口
6. B-5：`api-service.js` 改 `await + throw`
7. B-6：前端呼叫端補齊 `await + try/catch`
8. 部署 functions → 部署前端 → 驗收

### Phase C（Phase B 穩定後）

1. claims 批次補齊
2. 移除 rules fallback
3. 移除 / 關閉 deprecated `syncUserRole`

### Phase D（持續）

1. 每次部署前執行回歸驗收清單

---

## 本版相較舊版計劃的關鍵修正

1. 不依賴 `onUserCreate` 補 claims（避免 custom token 流程事件限制）
2. Phase A 直接解決首次登入崩潰（`ensureAuthUser`）
3. Phase B 承認跨系統非原子，改用補償策略
4. 補上 `super_admin` 目標保護（避免 admin 降權 super_admin）
5. 將 `doc.id != uid` 相容處理提前到 Phase A/B
6. 要求所有角色變更呼叫路徑一起收斂，不只改單一 API

---

## 交叉依賴分析（comprehensive-audit F-xx 議題）

> 以下為本計劃與 `comprehensive-audit-20260226.md` 中其他 F-xx 議題的交叉依賴分析。
> 每個依賴若未妥善處理，可能導致本計劃的修補效果打折或引入新問題。

### F-01-C（EXP 系統）→ `Critical` Production Bug

| 項目 | 說明 |
|------|------|
| **現狀** | `_grantAutoExp` → `adjustUserExp` 的兩個 Firestore 寫入（`users.exp` + `expLogs`）在一般用戶 session 下靜默失敗 |
| **根因** | `ownerUserUpdateSafe` 的 `sameFieldValue('exp')` + `expLogs` 的 `isAdmin()` create rule |
| **影響** | EXP 系統完全無效：報名、取消、評價、加入球隊等 13 個觸發點全部失效 |
| **與本計劃的關係** | 本計劃第 3 點明確排除 F-01-C，但這已不是「未來議題」而是 production bug |
| **建議** | Phase A 加暫時方案：新增 `grantExp` callable（Admin SDK 寫入），或至少在 Phase A+ 單獨處理 |

### F-02（linePushQueue 推播）→ 功能停擺

| 項目 | 說明 |
|------|------|
| **現狀** | `linePushQueue` 已全封（`allow create: if false`，`firestore.rules:458`） |
| **影響** | 前端推播功能完全停擺（`message-inbox.js` 的 `_queueLinePush()` 寫入被拒絕） |
| **與本計劃的關係** | Phase D 驗收清單 4-5 確認全封，但未列出恢復時程 |
| **建議** | Phase B 或 Phase B+ 明確列入 `sendLinePush` callable 的實作與部署，恢復推播功能 |

> **D-12 `Medium` 審查備註**：本計劃完全未提及 F-02 推播恢復的時程。
> `linePushQueue` 全封是 comprehensive-audit Phase 0 的止血措施，但止血後需要恢復方案。
> 若 Phase B 已部署 `adminChangeRole` callable 的基礎設施（Functions 部署 + callable pattern），
> 在同一次部署中加入 `sendLinePush` callable 的邊際成本很低。

### F-04（attendanceRecords 軟刪除）→ 需 rules 配合

| 項目 | 說明 |
|------|------|
| **現狀** | `attendanceRecords` 的 `allow delete: if false` 導致前端刪除靜默失敗 |
| **與本計劃的關係** | F-04 的修正（軟刪除 `status: 'cancelled'`）需要 `attendanceRecords update: isAdmin()` 規則配合，此規則已就位 |
| **依賴方向** | F-04 可在 Phase B 之後獨立實作，不阻塞本計劃 |
| **建議** | Phase B 後可立即實作，無額外依賴 |

### F-06（submitReview 持久化）→ 需 events rules 配合

| 項目 | 說明 |
|------|------|
| **現狀** | `submitReview()`（`event-detail.js:341-359`）完全未持久化，評價只存記憶體 |
| **與本計劃的關係** | 若修正方案走 `ApiService.updateEvent(eventId, { reviews })`，一般用戶會被 `events update: isCoachPlus()`（`firestore.rules:188`）擋住 |
| **建議方案** | 兩種選擇：<br>1. **Rules 變更**：events update 改為 `isCoachPlus() \|\| (isAuth() && onlyChanges(['reviews']))` → 允許一般用戶只寫 reviews<br>2. **Callable**：新增 `submitReview` callable，Admin SDK 寫入 → 繞過 rules |
| **建議** | 選項 2（callable）與本計劃的 callable pattern 一致，建議在 Phase B 一併實作 |

### F-07（optimistic update 吞錯誤）→ 與 B-5 範圍重疊

| 項目 | 說明 |
|------|------|
| **現狀** | `_create/_update/_delete` 的 `.catch(console.error)` 吞掉所有 Firestore 錯誤 |
| **與本計劃的關係** | B-5 只改角色變更路徑的 `await + throw`，F-07 要改底層所有 CRUD |
| **重疊風險** | 同一段 code 被改兩次，pattern 可能不一致 |
| **建議** | 明確劃分：B-5 只處理走 callable 的角色路徑，F-07 處理底層 `_create/_update/_delete`。兩者的 error handling pattern 事先統一 |

### F-11（模組層繞過 ApiService）→ 與 F-01-C 共同修正

| 項目 | 說明 |
|------|------|
| **現狀** | `adjustUserExp`（`api-service.js:537-539`）直接用 `db.collection('users').doc(...).update({ exp })` 和 `db.collection('expLogs').add(...)` |
| **與本計劃的關係** | 這些直寫是 F-01-C EXP 失效的直接原因之一（繞過 ApiService 統一入口，且被 rules 擋住） |
| **建議** | 與 F-01-C 共同修正：`adjustUserExp` 改走 `grantExp` callable（Admin SDK），同時解決 F-11 的直寫問題和 F-01-C 的 rules 阻擋問題 |

### 交叉依賴總覽

```
Phase A ─── F-01 登入修補（本計劃核心）
  │
  ├─── ⚠️ F-01-C EXP 失效（建議同步處理）
  │         └─── F-11 adjustUserExp 直寫問題
  │
Phase B ─── F-01 角色變更收斂（本計劃核心）
  │
  ├─── ⚠️ F-02 推播恢復（建議同步處理）
  ├─── F-06 submitReview callable（建議同步處理）
  ├─── F-07 底層 CRUD await（建議明確劃分範圍）
  │
Phase B+ ── F-04 attendanceRecords 軟刪除（Phase B 後可獨立實作）
```

---

## 審查備註索引

| 編號 | 嚴重性 | 標題 | 位置 |
|------|--------|------|------|
| D-1 | `Critical` | F-01-C auto-exp 是 production bug | 範圍說明第 3 點後 |
| D-2 | `Critical` | admin 角色變更已壞 | A-5 後 + Phase A 驗收後 |
| D-3 | `Critical` | B-2 Admin SDK 未明確標注 | B-2 補償機制後 |
| D-4 | `High` | F-06 submitReview 被 events rules 擋 | 交叉依賴分析 F-06 |
| D-5 | `High` | B-5 與 F-07 範圍重疊 | B-5 後 |
| D-6 | `High` | B-6 遺漏 team-form.js | B-6 後 |
| D-7 | `High` | A-3 lineUserId fallback doc.id 不一致 | A-3 後 |
| D-8 | `High` | B-2 缺最後 super_admin 保護 | B-2 補償機制後 |
| D-9 | `High` | Phase D 驗收漏 auto-exp | Phase D 系統完整性後 |
| D-10 | `Medium` | A-2 merge 併發風險 | A-2 後 |
| D-11 | `Medium` | A-5 fallback 細節不足 | A-5 後 |
| D-12 | `Medium` | linePushQueue 恢復時程未列 | 交叉依賴分析 F-02 |

