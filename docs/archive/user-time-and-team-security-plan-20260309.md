# ToosterX 使用者時間與俱樂部欄位安全性修補規格書 V6

> Date: 2026-03-09
> Version: V6
> Status: Planning
> Target: 收斂使用者文件（`users`）中時間欄位與俱樂部欄位的前端 payload 可篡改風險，並確認現有功能在規則收緊後的可行替代路徑。

## Summary

本規格書聚焦兩類使用者文件（`users`）欄位：

1. 時間欄位：最後登入時間（`lastLogin`）、更新時間（`updatedAt`）
2. 俱樂部欄位：主俱樂部識別（`teamId`）、主俱樂部名稱（`teamName`）、多俱樂部識別清單（`teamIds`）、多俱樂部名稱清單（`teamNames`）

核心目標如下：

- 降低前端 payload 直接指定時間欄位的可信度風險
- 禁止一般使用者自行偽造俱樂部歸屬
- 保留退隊自主權：使用者可自行退出任意俱樂部（部分縮減或全部清空），不需經過任何人同意
- 系統允許使用者同時隸屬多俱樂部，第一階段不設定數量上限
- 保留既有正式版主要流程可運作，特別是入隊申請發起、入隊核准與俱樂部相關顯示
- 優先採用低風險方案：收緊 Firestore 規則與既有受控寫入路徑，不在第一階段新增 Cloud Function

---

## V6 與 V5 的主要差異

1. **修正多俱樂部假設**：V3–V5 假設「入隊流程限制單一俱樂部，多俱樂部僅管理員手動加入」。實際上專案允許使用者同時申請並加入複數俱樂部，多俱樂部是正常使用情境而非邊界 case
2. **`isTeamFieldClearOnly` → `isTeamFieldShrinkOrClear`**：利用 Firestore rules 的 `list.hasAll(list)` 實現子集驗證。規則支援兩種 case：(A) 全部清空——退出所有俱樂部；(B) 部分縮減——退出特定俱樂部保留其餘，新 `teamIds` 必須為舊 `teamIds` 的嚴格子集
3. **多俱樂部退隊恢復自助操作**：使用者可自行退出特定俱樂部（部分縮減走 Case B）或退出所有俱樂部（全清走 Case A），不再需要聯繫職員
4. **deleteTeam 隊長多俱樂部不再需要 skip+toast**：部分縮減現在可通過 `isTeamFieldShrinkOrClear` Case B，隊長自身文件的清理與其他成員一致處理

## V5 與 V4 的主要差異（已被 V6 取代）

1. ~~Phase 1 不新增「退出所有俱樂部」UI~~ → V6：多俱樂部退隊恢復自助操作
2. ~~deleteTeam 隊長多俱樂部明確跳過自身寫入~~ → V6：部分縮減可通過規則，不需跳過

## V4 與 V3 的主要差異

1. **明確標註 staff 路徑殘餘風險**：`isSafeTeamMembershipUpdateByStaff` 只驗角色不驗俱樂部歸屬，任何 coach+ 可寫任何 user 的俱樂部欄位。標註為 Phase 1 已知殘餘風險，Phase 2 評估是否加入俱樂部歸屬驗證
2. **補完 deleteTeam 多俱樂部處理**：V3 只處理 `u.teamId === id` 的使用者（primary team），遺漏 secondary team（僅在 `teamIds` 中）的清理。V4 明確定義兩種情境的處理方式與限制
3. **lastLogin 獨立為登入更新格式專用規則**：從 `isSafeSelfProfileUpdate` 移除 `lastLogin`，新增 `isSafeLoginUpdate` 專用規則。`lastLogin` 不再允許夾帶於一般個人資料更新；規則層以登入更新 payload shape 承接，但不主張可從 rules 層辨識「這次操作是否真為登入事件」
4. **統一多俱樂部退隊產品規則**：明確定義多俱樂部使用者退出單一俱樂部的操作路徑、職員職責與 UX 流程

---

## 起因

目前 `firestore.rules` 的 `users/{userId}` 自助更新白名單（`isSafeSelfProfileUpdate`），仍包含以下欄位：

- `lastLogin`
- `updatedAt`
- `teamId`
- `teamName`
- `teamIds`
- `teamNames`

這造成兩類問題：

1. 時間欄位問題
   - 一般使用者可從前端 payload 直接帶入最後登入時間與更新時間
   - 雖然多數正式寫入路徑已使用 `serverTimestamp()`，但規則層目前只檢查 `is timestamp`，客戶端仍可偽造任意 Timestamp 值通過
   - `lastLogin` 混在一般個人資料更新白名單中，語義模糊（登入狀態 vs 個人資料）
   - 風險主要在資料可信度、審計品質與未來維運判斷

2. 俱樂部欄位問題
   - 一般使用者可直接把自己寫入任意俱樂部
   - 俱樂部欄位不只是個人資料，還會影響身分歸屬、俱樂部限定內容、訊息可見性與相關業務判斷
   - 風險明顯高於時間欄位，應列為優先修補項目

---

## 問題範圍

### 一、時間欄位（`lastLogin`、`updatedAt`）

現況特徵：

- `updatedAt` 已廣泛由 `js/firebase-crud.js` 內的 `updateUser()` helper 統一補上 `serverTimestamp()`
- `lastLogin` 主要集中在登入流程，由 `createOrUpdateUser()` 在受控情境下補 `serverTimestamp()`
- 規則目前對這兩個欄位只做 `is timestamp` 型別檢查，無法區分 `serverTimestamp()` 與客戶端偽造的 Timestamp
- `lastLogin` 與一般個人資料欄位（`displayName`、`phone` 等）混在同一白名單中，語義不清

實際風險：

- 客戶端可構造任意 Timestamp 值通過 `is timestamp` 檢查
- `lastLogin` 可在任何個人資料更新時被夾帶寫入，失去「最後登入」的語義
- 時間戳記不再完全代表受控系統行為
- 稽核、比對與故障排查時，時間欄位可信度下降

### 二、俱樂部欄位（`teamId`、`teamName`、`teamIds`、`teamNames`）

現況特徵：

- 多個頁面與流程直接讀取使用者文件中的俱樂部欄位判斷身分或可見性
- 核准入隊流程會由 coach 以上角色把俱樂部欄位寫入申請者的使用者文件
- 自行退隊流程會由使用者本人清除自己的俱樂部欄位
- `isSafeTeamMembershipUpdateByStaff` 只驗角色等級，不驗寫入者是否為目標俱樂部的職員

實際風險：

- 一般使用者可偽造自己屬於某支俱樂部
- 任何 coach 以上角色可把任何使用者寫入任意俱樂部（跨隊寫入）
- 俱樂部限定活動、俱樂部頁、俱樂部訊息、成員顯示與部分權限判斷可能被繞過或污染
- 若後續還有更多俱樂部綁定功能，風險會持續放大

---

## 俱樂部欄位寫入路徑完整盤點

以下為所有會寫入 `users` 文件俱樂部欄位的路徑，共 8 條，逐一標註寫入角色、目標文件、適用規則，以及本次修改是否受影響：

### 路徑 1：申請入隊發起（`handleJoinTeam`）

- 來源：`js/modules/team-form.js`（活躍版本）
- 行為：使用者按下「申請加入」，**只寫入 `messages` collection**（建立入隊申請訊息），不寫 `users` 文件的俱樂部欄位
- 適用規則：`messages` collection 的 create 規則
- 影響：**不受影響**

### 路徑 2：核准入隊（`handleTeamJoinAction`）

- 來源：`js/modules/message-inbox.js`
- 行為：隊長 / 教練 / 管理員核准後，將申請者的 `teamId`、`teamName`、`teamIds`、`teamNames` 寫入申請者的 `users` 文件
- 寫入角色：coach 以上（寫入**他人**的文件）
- 適用規則：`isCoachPlus() && !isOwner(userId) && isSafeTeamMembershipUpdateByStaff()`
- 殘餘風險：規則只驗角色等級，不驗寫入者是否為目標俱樂部的職員（見「殘餘風險」章節）
- 影響：**不受影響**（規則結構不變，殘餘風險列為 Phase 2 待評估）

### 路徑 3：自行退隊（`handleLeaveTeam` in `team-form.js`）

- 來源：`js/modules/team-form.js:177`
- 行為：使用者自行退出俱樂部，清除自己的俱樂部欄位
- 寫入角色：使用者本人（寫入**自己**的文件）
- 目前適用規則：`isOwner(userId) && isSafeSelfProfileUpdate()`
- 影響：**受影響，需要新的 `isTeamFieldShrinkOrClear` 規則承接**
- 單一俱樂部：全部清空（Case A）；多俱樂部：部分縮減（Case B）或全部清空（Case A）

### 路徑 4：職員移除隊員（`removeTeamMember`）

- 來源：`js/modules/team-detail.js`
- 行為：隊長 / 教練以上角色，將某位隊員從俱樂部移除（清除或縮減對方的俱樂部欄位）
- 寫入角色：coach 以上（寫入**他人**的文件）
- 適用規則：`isCoachPlus() && !isOwner(userId) && isSafeTeamMembershipUpdateByStaff()`
- 殘餘風險：同路徑 2
- 影響：**不受影響**

### 路徑 5：刪除俱樂部（`deleteTeam` in `api-service.js`）

- 來源：`js/api-service.js:420`
- 行為：刪除俱樂部時，遍歷所有引用此俱樂部的使用者，清除其俱樂部欄位
- 寫入角色：admin 或 teamOwner（captain）
- 適用規則：
  - 寫他人文件 → `isAdmin() && isSafeAdminUserUpdate()` 或 `isCoachPlus() && isSafeTeamMembershipUpdateByStaff()`
  - 寫自己文件（隊長刪除自己所屬俱樂部）→ `isOwner(userId) && isTeamFieldShrinkOrClear()`（全清走 Case A，部分縮減走 Case B）
- **既有問題 1**：只清 `teamId`、`teamName`，未清 `teamIds`、`teamNames`
- **既有問題 2**：只遍歷 `u.teamId === id` 的使用者（primary team 匹配），遺漏 secondary team 使用者（此俱樂部僅在 `teamIds` 中但非 `teamId`）
- 影響：**受影響，需修復欄位清除不完整 + 多俱樂部清理邏輯**

### 路徑 6：修復歷史入隊（`repairTeamJoins` in `user-admin-list.js`）

- 來源：`js/modules/user-admin-list.js:391`
- 行為：管理員一鍵修復歷史審批但 teamId 未正確寫入的使用者
- 寫入角色：admin（寫入**他人**的文件）
- 適用規則：`isAdmin() && isSafeAdminUserUpdate()`
- 影響：**不受影響**

### 路徑 7：首次建立使用者（`createOrUpdateUser` in `firebase-crud.js`）

- 來源：`js/firebase-crud.js:649`
- 行為：新使用者首次登入時建立文件，帶入 `teamId: null`、`teamName: null`
- 適用規則：`allow create`（不是 update）
- 影響：**不受影響**

### 路徑 8（死碼）：`team.js` 舊版 `handleJoinTeam` / `handleLeaveTeam`

- 來源：`js/modules/team.js`
- 載入狀態：**未被載入**。`js/core/script-loader.js:73-76` 的 team 群組只載入 `team-list.js`、`team-detail.js`、`team-form.js`；`index.html` 中也無任何 `team.js` 引用
- 行為：包含 `handleJoinTeam` 與 `handleLeaveTeam` 的舊版實作
- 影響：**死碼，不影響正式版行為。不列入本次施工項目**

---

## 受影響功能盤點

### 直接依賴俱樂部欄位的主要流程

1. 入隊申請發起
   - `js/modules/team-form.js`（`handleJoinTeam`）
   - 只寫 `messages` collection，不寫 `users` 俱樂部欄位 → 不受影響

2. 入隊核准
   - `js/modules/message-inbox.js`（`handleTeamJoinAction`）
   - 核准時由 coach+ 把申請者的俱樂部欄位寫入 `users` → 不受影響

3. 自行退隊
   - `js/modules/team-form.js`（`handleLeaveTeam`）
   - 單一俱樂部：全部清空 → 走 `isTeamFieldShrinkOrClear` Case A
   - 多俱樂部退出特定俱樂部：部分縮減 → 走 `isTeamFieldShrinkOrClear` Case B（`hasAll` 子集驗證）
   - 多俱樂部退出所有俱樂部：全部清空 → 走 Case A

4. 職員移除隊員
   - `js/modules/team-detail.js`（`removeTeamMember`）
   - coach+ 寫他人文件 → 不受影響

5. 俱樂部限定活動可見性
   - `js/modules/event-list.js`
   - 只讀俱樂部欄位，不寫入 → 不受影響

6. 俱樂部成員與頁面顯示
   - `js/modules/team-detail.js`
   - `js/modules/profile-data.js`
   - 只讀俱樂部欄位 → 不受影響

7. 刪除俱樂部
   - `js/api-service.js`（`deleteTeam`）
   - 需修復：欄位清除不完整 + 多俱樂部使用者遺漏

### 時間欄位主要使用場景

1. 登入與建檔
   - `js/firebase-crud.js`（`createOrUpdateUser()`）
   - 新使用者：`canonicalRef.set()` 帶 `lastLogin: serverTimestamp()` — CREATE 操作，不受 update 規則影響
   - 舊使用者遷移：`canonicalRef.set(..., { merge: true })` 帶 `lastLogin: serverTimestamp()` — SET 操作
   - 既有帳號登入：`canonicalRef.update({ displayName, pictureUrl, [lastLogin] })` — payload shape 不含 `updatedAt`，由 `isSafeLoginUpdate` 承接

2. 一般資料更新
   - `js/firebase-crud.js`（`updateUser()`）
   - 所有更新統一附加 `updatedAt: serverTimestamp()`，不含 `lastLogin`

---

## 解決方式

### 一、時間欄位修補方案

#### 核心策略

1. `is timestamp` → `== request.time`：確保只有 `serverTimestamp()` 能通過
2. `lastLogin` 獨立為登入更新格式專用規則：從一般個人資料更新白名單移除，不再允許夾帶於一般個人資料更新

#### 更新時間（`updatedAt`）

規則修改：

- **保留** `updatedAt` 在 `isSafeSelfProfileUpdate()` 的白名單中
- 驗證條件從 `is timestamp` 改為 `== request.time`
- `updateUser()` helper 統一補 `serverTimestamp()`，自動通過

影響盤點：

- `updateUser()` helper → 通過 `== request.time` ✓
- 登入更新路徑不含 `updatedAt` → 不觸發此驗證 ✓
- 客戶端偽造 Timestamp → 被擋 ✓

#### 最後登入時間（`lastLogin`）

規則修改：

- **移除** `lastLogin` 出 `isSafeSelfProfileUpdate()` 白名單
- 新增獨立規則 `isSafeLoginUpdate()`，專門承接登入更新 payload shape

登入更新的 payload shape（`createOrUpdateUser` line 718-730）：

```
{ displayName: string, pictureUrl: string|null, [lastLogin: serverTimestamp()] }
```

此 shape 不含 `updatedAt`（因為不經過 `updateUser()` helper），能與一般個人資料更新形成清楚的責任分流；但若只更新 `displayName` / `pictureUrl`，仍可能同時符合一般個人資料更新與登入更新兩條規則，因此文件不再主張兩者「完全不重疊」。

#### `isSafeLoginUpdate` 規則設計

```javascript
function isSafeLoginUpdate() {
  let changed = request.resource.data.diff(resource.data).affectedKeys();
  return changed.hasOnly(['displayName', 'pictureUrl', 'lastLogin'])
    && (!changed.hasAny(['displayName']) || (
        request.resource.data.displayName is string
        && request.resource.data.displayName.size() > 0
    ))
    && (!changed.hasAny(['pictureUrl']) || (
        request.resource.data.pictureUrl == null
        || request.resource.data.pictureUrl is string
    ))
    && (!changed.hasAny(['lastLogin']) || (
        request.resource.data.lastLogin == request.time
    ));
}
```

影響盤點：

- 既有帳號登入（間隔 > 10 分鐘）：`{ displayName, pictureUrl, lastLogin: serverTimestamp() }` → 通過 `isSafeLoginUpdate` ✓
- 既有帳號登入（間隔 ≤ 10 分鐘）：`{ displayName, pictureUrl }` → 通過 `isSafeLoginUpdate`（`lastLogin` 未變更，不觸發驗證）✓
- 一般個人資料更新（帶 `updatedAt`）：不符合 `isSafeLoginUpdate` 的 `hasOnly`，走 `isSafeSelfProfileUpdate` → `lastLogin` 已不在白名單中，無法夾帶 ✓
- 客戶端偽造 `lastLogin: Timestamp(任意值)` → 被擋（`!= request.time`）✓
- 客戶端在個人資料更新中夾帶 `lastLogin: serverTimestamp()` → 被擋（`isSafeSelfProfileUpdate` 白名單已無 `lastLogin`，且 payload 含 `updatedAt` 不符合 `isSafeLoginUpdate` 的 `hasOnly`）✓

#### `isSafeSelfProfileUpdate` 修改摘要

修改前後的 `changed.hasOnly([...])` 對照：

```javascript
// 修改前
changed.hasOnly([
    'displayName', 'photoURL', 'pictureUrl', 'phone', 'updatedAt', 'lastLogin',
    'gender', 'birthday', 'region', 'sports',
    'favorites', 'socialLinks',
    'titleBig', 'titleNormal',
    'lineNotify',
    'teamId', 'teamName', 'teamIds', 'teamNames',
    'companions'
])

// 修改後：移除 lastLogin + 4 個俱樂部欄位
changed.hasOnly([
    'displayName', 'photoURL', 'pictureUrl', 'phone', 'updatedAt',
    'gender', 'birthday', 'region', 'sports',
    'favorites', 'socialLinks',
    'titleBig', 'titleNormal',
    'lineNotify',
    'companions'
])
```

同時移除的驗證區段：

- `!changed.hasAny(['lastLogin'])` 的驗證條件（1 組）
- `!changed.hasAny(['teamId'])` 的驗證條件（1 組）
- `!changed.hasAny(['teamName'])` 的驗證條件（1 組）
- `!changed.hasAny(['teamIds'])` 的驗證條件（1 組）
- `!changed.hasAny(['teamNames'])` 的驗證條件（1 組）

`updatedAt` 驗證保留但收緊：

```javascript
// 修改前
&& (!changed.hasAny(['updatedAt']) || (
    request.resource.data.updatedAt is timestamp
))

// 修改後
&& (!changed.hasAny(['updatedAt']) || (
    request.resource.data.updatedAt == request.time
))
```

#### 三條 self-update 規則的 payload shape 分流原則

| 規則 | 用途 | 識別特徵 | `lastLogin` | `updatedAt` | 俱樂部欄位 |
|------|------|----------|-------------|-------------|----------|
| `isSafeLoginUpdate` | 登入更新 | 只含 `displayName` + `pictureUrl` + 可選 `lastLogin` | 可寫（`== request.time`）| 不可帶 | 不可帶 |
| `isSafeSelfProfileUpdate` | 一般個人資料更新 | 各種個人欄位；實務上多數路徑會含 `updatedAt` | 不可帶 | 可寫（`== request.time`）| 不可帶 |
| `isTeamFieldShrinkOrClear` | 退隊 | 只含俱樂部欄位 + 可選 `updatedAt` | 不可帶 | 可寫（`== request.time`）| 只能歸零或子集縮減 |

補充說明：

- `isSafeLoginUpdate` 與 `isSafeSelfProfileUpdate` 在 `displayName` / `pictureUrl` 上可能存在可重疊 payload（例如 `{ displayName }`）
- 這不構成敏感欄位保護漏洞，因為 `lastLogin` 只在 `isSafeLoginUpdate` 中可寫，`updatedAt` 只在帶時間欄位的規則中可寫，俱樂部欄位只在 `isTeamFieldShrinkOrClear` 中可寫
- 本文件將三條規則定位為「責任分流」而非「payload shape 完全互斥」

### 二、俱樂部欄位修補方案 — 「只允許清空或子集縮減，不允許填入」

#### 核心策略

將俱樂部欄位從 `isSafeSelfProfileUpdate()` 白名單中移除，改由獨立規則 `isTeamFieldShrinkOrClear()` 承接「退隊」場景：

- **禁止**：使用者自行填入任意俱樂部值（偽造入隊）
- **禁止**：使用者自行替換俱樂部（新 teamIds 必須為舊 teamIds 的嚴格子集）
- **允許**：使用者自行全部清空俱樂部欄位（退出所有俱樂部，Case A）
- **允許**：使用者自行部分縮減俱樂部清單（退出特定俱樂部保留其餘，Case B，`hasAll` 子集驗證）
- **保留**：coach 以上角色透過既有路徑寫入他人的俱樂部欄位（入隊核准、移除隊員）

#### 關鍵技術：`list.hasAll(list)` 子集驗證

Firestore rules 的 `list.hasAll(list)` 可驗證一個 list 是否包含另一個 list 的所有元素：

```
resource.data.teamIds.hasAll(request.resource.data.teamIds)
// 等效於：舊 teamIds 包含新 teamIds 的每個元素 → 新 teamIds 是舊 teamIds 的子集
```

配合 `size()` 嚴格遞減檢查，可完整防止偽造：

- `['A','B']` → `['A']`：子集 ✓ 且 size 縮減 ✓ → 通過
- `['A','B']` → `['X']`：`hasAll(['X'])` = false → 被擋
- `['A','B']` → `['A','X']`：size 未縮減（2 == 2）→ 被擋
- `['A','B','C']` → `['A','X']`：`hasAll(['A','X'])` = false → 被擋
- `['A','B']` → `['B','A']`：size 未縮減（2 == 2）→ 被擋（防重排序偷換 primary）

#### `isTeamFieldShrinkOrClear` 規則設計

```javascript
function isTeamFieldShrinkOrClear() {
  let changed = request.resource.data.diff(resource.data).affectedKeys();
  let newData = request.resource.data;
  let oldData = resource.data;

  return changed.hasOnly(['teamId', 'teamName', 'teamIds', 'teamNames', 'updatedAt'])
    && (
      // ── Case A: Full clear（退出所有俱樂部）──
      (  newData.teamId == null
      && newData.teamName == null
      && (newData.teamIds == null
          || (newData.teamIds is list && newData.teamIds.size() == 0))
      && (newData.teamNames == null
          || (newData.teamNames is list && newData.teamNames.size() == 0))
      )
      ||
      // ── Case B: Shrink（退出部分俱樂部，保留其餘）──
      (  oldData.teamIds is list
      && oldData.teamIds.size() > 0
      && newData.teamIds is list
      && newData.teamIds.size() > 0
      && newData.teamIds.size() < oldData.teamIds.size()
      // 子集驗證：新 teamIds 的每個元素都必須存在於舊 teamIds 中
      && oldData.teamIds.hasAll(newData.teamIds)
      // teamId 一致性：必須等於 teamIds[0]
      && newData.teamId is string
      && newData.teamId == newData.teamIds[0]
      // teamName 一致性：必須等於 teamNames[0]
      && newData.teamName is string
      && newData.teamName == newData.teamNames[0]
      // teamNames 長度一致性
      && newData.teamNames is list
      && newData.teamNames.size() == newData.teamIds.size()
      )
    )
    // updatedAt：必須為 serverTimestamp
    && (!changed.hasAny(['updatedAt'])
        || newData.updatedAt == request.time);
}
```

#### Case B 殘餘限制：`teamNames` 不驗證內容正確性

Case B 驗證 `teamIds` 為嚴格子集，但 `teamNames` 只驗證長度一致，不驗證每個名稱是否對應正確的俱樂部名稱（驗證需 `get()` 讀取每支俱樂部文件，成本過高）。

影響評估：
- `teamNames` 為顯示用文字，不影響俱樂部歸屬判斷（歸屬以 `teamIds` 為準）
- 前端 `handleLeaveTeam` 透過 `ApiService.getTeam(id).name` 取得正確名稱，正常操作不會產生錯誤
- 惡意使用者理論上可寫入錯誤的 `teamNames`，但僅影響自己的顯示文字，不影響其他使用者或系統判斷
- 風險等級：極低，Phase 1 接受

#### `users/{userId}` update 規則總覽

```javascript
allow update: if (isOwner(userId) && isSafeSelfProfileUpdate())              // 一般個人資料
            || (isOwner(userId) && isSafeLoginUpdate())                      // 登入更新
            || (isOwner(userId) && isTeamFieldShrinkOrClear())               // 退隊（全清或子集縮減）
            || (isAdmin() && isSafeAdminUserUpdate())                        // 管理員
            || (isCoachPlus() && !isOwner(userId) && isSafeTeamMembershipUpdateByStaff()); // 入隊核准 / 移除隊員
```

#### `isSafeTeamMembershipUpdateByStaff` 時間欄位同步加固

```javascript
// 修改前
&& (!changed.hasAny(['updatedAt']) || request.resource.data.updatedAt is timestamp);

// 修改後
&& (!changed.hasAny(['updatedAt']) || request.resource.data.updatedAt == request.time);
```

#### 安全性驗證矩陣

| 場景 | 寫入值 | 規則結果 |
|------|--------|----------|
| 使用者偽造 teamId 為任意俱樂部 | `teamId: 'fakeTeamXyz'` | 被擋（Case A 需 null，Case B 需子集）|
| 使用者全部清空（退出所有俱樂部）| `teamId: null, teamIds: []` | 通過 Case A |
| 使用者部分縮減（退出其中一隊）| `teamIds: ['remaining']`（為舊 teamIds 子集）| 通過 Case B（`hasAll` 子集驗證）|
| 使用者偽造縮減（替換俱樂部）| `['A','B']` → `['X']` | 被擋（`hasAll(['X'])` = false）|
| 使用者偽造擴充（加入俱樂部）| `['A']` → `['A','B']` | 被擋（size 未縮減）|
| 使用者重排序偷換 primary | `['A','B']` → `['B','A']` | 被擋（size 未縮減）|
| 隊長 / 教練核准入隊 | 寫入申請者 doc | 通過 `isSafeTeamMembershipUpdateByStaff` |
| 管理員直接調整 | 任意寫入 | 通過 `isSafeAdminUserUpdate` |
| 使用者偽造 updatedAt | 客戶端構造 Timestamp | 被擋（`!= request.time`）|
| 使用者偽造 lastLogin | 客戶端構造 Timestamp | 被擋（`!= request.time`）|
| 使用者在個人資料更新中夾帶 lastLogin | `{ displayName, phone, updatedAt, lastLogin }` | 被擋（`isSafeSelfProfileUpdate` 白名單無 `lastLogin`，`isSafeLoginUpdate` 白名單無 `phone`/`updatedAt`）|
| 正常登入更新含 lastLogin | `{ displayName, pictureUrl, lastLogin: serverTimestamp() }` | 通過 `isSafeLoginUpdate` |

### 三、多俱樂部退隊產品規則

#### 背景

專案允許使用者同時申請並加入複數俱樂部，多俱樂部是正常使用情境。`handleJoinTeam` 僅檢查使用者是否已在**目標俱樂部**中，不限制已有其他俱樂部的使用者申請新俱樂部。核准入隊（`handleTeamJoinAction`）使用 `normalizeMembership` 將新俱樂部合併至既有清單。第一階段不為多俱樂部數量設定額外上限。

#### 規則定義

1. **單一俱樂部使用者退隊**（`teamIds.length <= 1`）
   - 使用者可自行操作，走 `isTeamFieldShrinkOrClear` Case A
   - 所有俱樂部欄位歸零，不需任何人同意

2. **多俱樂部使用者退出特定俱樂部**（`teamIds.length > 1`，保留其餘）
   - 使用者可自行操作，走 `isTeamFieldShrinkOrClear` Case B
   - `teamIds` 移除目標俱樂部後作為新值，`hasAll` 驗證為舊 list 的嚴格子集
   - `teamId` 自動切換為剩餘 `teamIds[0]`
   - 不需任何人同意

3. **多俱樂部使用者退出所有俱樂部**
   - 使用者可自行操作，走 `isTeamFieldShrinkOrClear` Case A
   - 所有俱樂部欄位歸零
   - 前端目前的 `handleLeaveTeam` 為逐一退隊（從俱樂部詳情頁操作），無「一鍵全退」按鈕
   - 使用者若要退出所有俱樂部，逐一退出即可

#### 前端影響

`js/modules/team-form.js` 的 `handleLeaveTeam` **既有邏輯已正確處理多俱樂部**：

```javascript
// 既有邏輯（team-form.js:218-225），不需修改
const nextTeamIds = teamIds.filter(id => id !== String(teamId));
const nextTeamNames = nextTeamIds.map(id => {
  const teamObj = ApiService.getTeam(id);
  return teamObj ? teamObj.name : id;
});
const userTeamUpdates = nextTeamIds.length > 0
  ? { teamId: nextTeamIds[0], teamName: nextTeamNames[0] || '', teamIds: nextTeamIds, teamNames: nextTeamNames }
  : { teamId: null, teamName: null, teamIds: [], teamNames: [] };
```

- `nextTeamIds.length > 0`：部分縮減 → payload 符合 Case B（`teamIds` 為舊值子集）
- `nextTeamIds.length === 0`：全部清空 → payload 符合 Case A
- 無需新增前端攔截或 toast，既有邏輯直接相容新規則

### 四、既有 bug 修復

#### bug 1：`api-service.js` 刪除俱樂部欄位清除不完整

- 位置：`js/api-service.js:427-445`
- 問題 1：只清 `{ teamId: null, teamName: null }`，漏清 `teamIds` 與 `teamNames`
- 問題 2：只遍歷 `u.teamId === id` 的使用者，遺漏 secondary team 使用者（此俱樂部僅在 `teamIds` 中但非 `teamId`）
- 修正方式：

```javascript
// 修改前：只清 primary team 使用者
users.forEach(u => {
  if (u.teamId === id) {
    u.teamId = null;
    u.teamName = null;
    // ...
  }
});

// 修改後：同時處理 primary 和 secondary team 使用者
users.forEach(u => {
  const isPrimary = u.teamId === id;
  const inTeamIds = Array.isArray(u.teamIds) && u.teamIds.includes(id);
  if (!isPrimary && !inTeamIds) return;

  // 從 teamIds / teamNames 移除此俱樂部
  const oldIds = Array.isArray(u.teamIds) ? u.teamIds : (u.teamId ? [u.teamId] : []);
  const oldNames = Array.isArray(u.teamNames) ? u.teamNames : (u.teamName ? [u.teamName] : []);
  const idx = oldIds.indexOf(id);
  const nextIds = oldIds.filter(tid => tid !== id);
  const nextNames = oldNames.filter((_, i) => i !== idx);

  const updates = nextIds.length > 0
    ? { teamId: nextIds[0], teamName: nextNames[0] || '', teamIds: nextIds, teamNames: nextNames }
    : { teamId: null, teamName: null, teamIds: [], teamNames: [] };

  Object.assign(u, updates);
  if (!this._demoMode && u._docId) {
    FirebaseService.updateUser(u._docId, updates)
      .catch(err => console.error('[deleteTeam] clear user team:', err));
  }
});
```

- 注意：此修正中，寫他人文件走 `isSafeTeamMembershipUpdateByStaff`（coach+ 或 admin），寫自己文件走 `isTeamFieldShrinkOrClear`（全清走 Case A，部分縮減走 Case B）
- **隊長自身多俱樂部**：V6 的 `isTeamFieldShrinkOrClear` Case B 支援部分縮減（子集驗證），隊長自身文件的 update 可正常通過規則，不需特殊處理

#### bug 2：`deleteTeam` currentUser 清除同步修正

- 位置：`js/api-service.js:437-445`
- 問題：與上述相同，只清 2 個欄位
- 修正方式：與上述邏輯統一，currentUser 的清除走同一套 nextIds/nextNames 計算

#### 備註：`team.js` 為死碼

- `js/modules/team.js` 未被載入，不列入本次施工項目

### 五、第一階段不採用的方案

本階段明確不採用：

- 新增 Cloud Function 作為俱樂部欄位的唯一寫入入口
- 大幅重構使用者與俱樂部 membership schema
- 重新設計俱樂部完整審批流程
- 退隊改為需經隊長核准（會犧牲退隊自主權）
- 展開式（unroll）子集驗證（規則膨脹、可讀性差、仍無法驗證 teamNames 對應關係）
- `isSafeTeamMembershipUpdateByStaff` 加入俱樂部歸屬驗證（需額外 `get()` 呼叫，Phase 2 評估）

---

## 殘餘風險

### `isSafeTeamMembershipUpdateByStaff` 跨隊寫入風險

**現況**：`isCoachPlus()` 只驗角色等級（`coach`、`captain`、`venue_owner`、`admin`、`super_admin`），不驗寫入者是否為目標俱樂部的實際職員。

**風險**：任何 coach 以上角色可把任何使用者寫入任意俱樂部。例如俱樂部 A 的教練可以把某位使用者寫入俱樂部 B。

**影響**：

- coach / captain 角色需要基本信任，否則可跨隊污染成員資料
- 正常操作流程中，前端 UI 只會在審核本隊申請時觸發寫入，降低意外發生的機率
- 但規則層無法防止惡意構造的直接 Firestore 寫入

**Phase 1 處置**：

- 接受為已知殘餘風險
- 前端流程已限制操作範圍（只對本隊申請觸發核准/移除），實務風險可控
- 在風險評估中記錄

**Phase 2 評估方向**：

- 在規則中讀取 `teams/{teamId}` 文件，驗證寫入者的 uid 是否為該俱樂部的 `captainUid` 或在 `coaches` 清單中
- 代價：每次 staff 寫入增加 1 次 `get()` 呼叫（Firestore 每次規則評估上限 10 次）
- 替代方案：改用 Cloud Function 作為俱樂部成員變更的唯一入口

### `teamNames` 顯示文字不驗證內容正確性

**現況**：`isTeamFieldShrinkOrClear` Case B 驗證 `teamIds` 為舊值的嚴格子集，但 `teamNames` 只驗證長度與 `teamIds` 一致，不驗證每個名稱是否為對應俱樂部的真實名稱。

**風險**：惡意使用者可在退隊時寫入錯誤的 `teamNames`，但僅影響自己的顯示文字，不影響俱樂部歸屬判斷。

**Phase 1 處置**：

- 接受為極低風險殘餘項目
- 前端 `handleLeaveTeam` 透過 `ApiService.getTeam(id).name` 取得正確名稱，正常操作不會產生錯誤
- 若需更嚴格驗證，Phase 2 可改用 Cloud Function 處理退隊寫入

---

## 風險評估

### 一、時間欄位修補風險

等級：低

主要風險：

- `== request.time` 與 `serverTimestamp()` 在某些 Firestore SDK 版本或邊界條件下的相容性
- 若存在未經 `updateUser()` helper 的直接 update 路徑帶有自行構造的 `updatedAt`，會被新規則擋住

可能後果：

- 使用者登入後建立或同步資料失敗
- 後台清單顯示的最後活躍時間未更新

緩解措施：

- 登入路徑已確認使用 `serverTimestamp()`，不受影響
- 所有 `updateUser()` helper 統一補 `serverTimestamp()`，不受影響
- 登入更新路徑有獨立的 `isSafeLoginUpdate` 承接，不會被 `isSafeSelfProfileUpdate` 的白名單變更影響
- 部署前在模擬器驗證所有登入 + 更新場景

### 二、俱樂部欄位修補風險

等級：低

主要風險：

- 前端退隊 payload 格式與規則預期不一致（Case A/B 判定邊界）
- `teamNames` 顯示文字不驗證內容正確性

可能後果：

- 退隊按鈕點了沒反應（Firestore 權限錯誤，payload 不符合 Case A 或 B）
- 惡意使用者寫入錯誤的 teamNames（僅影響自身顯示）

緩解措施：

- Case A（全清）邏輯直白，Case B（子集縮減）以 `hasAll` 驗證，測試覆蓋容易
- 前端 `handleLeaveTeam` 既有邏輯已正確處理單一/多俱樂部，不需額外修改
- `deleteTeam` 流程中隊長自身文件走 Case A 或 Case B，統一處理
- 部署前在模擬器驗證退隊（單一 + 多俱樂部）+ deleteTeam 場景

### 三、staff 路徑殘餘風險

等級：中（Phase 1 接受）

主要風險：

- 任何 coach+ 可跨隊寫入他人俱樂部欄位
- 前端 UI 限制可被直接 Firestore API 呼叫繞過

緩解措施：

- coach / captain 角色授予需基本信任
- 前端操作流程限制正常情境的觸發範圍
- Phase 2 評估是否加入俱樂部歸屬驗證

### 四、文件與編碼風險

等級：低

控制方式：

- 全程使用 diff-based 修補
- 修改後重新以 UTF-8 讀取檢查
- 檢查典型 mojibake 痕跡

---

## 施作難度與工時

### 工作項目評估

1. 時間欄位規則修補（`updatedAt` 收緊 + `lastLogin` 獨立 + 新增 `isSafeLoginUpdate`）
   - 難度：低
   - 工時：0.5 到 1 小時

2. 俱樂部欄位規則修補（新增 `isTeamFieldShrinkOrClear`、移除白名單、收緊 staff 路徑 `updatedAt`）
   - 難度：低
   - 工時：0.5 到 1 小時

3. 前端退隊邏輯驗證（確認既有 `handleLeaveTeam` payload 與新規則相容）
   - 難度：低
   - 工時：0.25 小時

4. 既有 bug 修復（`api-service.js` deleteTeam 欄位清除 + 多俱樂部遍歷）
   - 難度：中
   - 工時：1 小時

5. 入隊核准、退隊與俱樂部相關流程驗證
   - 難度：中
   - 工時：1 到 2 小時

6. Firestore 規則測試補強
   - 難度：中
   - 工時：1 到 2 小時

7. 文件與版本紀錄更新
   - 難度：低
   - 工時：0.5 小時

### 總工時估算

- 低估：4.5 小時
- 常態：5.5 到 7 小時
- 高估：8 小時

---

## 動用與新增檔案

### 動用檔案

- `firestore.rules`（規則修補主體）
- `tests/firestore.rules.test.js`（測試補強）
- `js/api-service.js`（deleteTeam bug 修復）
- `docs/claude-memory.md`（修復日誌）

### 驗證但不修改的檔案

- `js/modules/team-form.js`（驗證退隊 payload 與多俱樂部行為；原則上不修改）
- `js/firebase-crud.js`（確認 `updateUser` / `createOrUpdateUser` 行為）
- `js/modules/message-inbox.js`（確認核准入隊流程不受影響）

### 視實作需要可能動用的檔案

- `js/modules/team-detail.js`
- `js/modules/event-list.js`
- `js/modules/profile-data.js`
- `docs/architecture.md`
- `js/config.js`
- `index.html`

### 不動用的檔案

- `js/modules/team.js`（死碼，不列入施工）

### 新增檔案

- 無（本文件為原地升版）

---

## 施工清單

### 一、時間欄位

1. 修改 `firestore.rules` 的 `isSafeSelfProfileUpdate()`：
   - 從 `changed.hasOnly([...])` 移除 `lastLogin`
   - 移除 `!changed.hasAny(['lastLogin'])` 驗證區段
   - `updatedAt` 驗證從 `is timestamp` 改為 `== request.time`
2. 新增 `isSafeLoginUpdate()` 函式（完整邏輯見本文件）
3. 修改 `users/{userId}` 的 update 允許條件，加上 `|| (isOwner(userId) && isSafeLoginUpdate())`
4. 修改 `isSafeTeamMembershipUpdateByStaff()` 的 `updatedAt` 驗證：`is timestamp` → `== request.time`
5. 驗證首次登入、既有帳號登入（含 > 10 分鐘 / ≤ 10 分鐘）、舊資料遷移不會被新規則誤擋
6. 驗證一般個人資料更新不能夾帶 `lastLogin`

### 二、俱樂部欄位

1. 從 `isSafeSelfProfileUpdate()` 移除俱樂部欄位：
   - `changed.hasOnly([...])` 移除 `teamId`、`teamName`、`teamIds`、`teamNames`
   - 移除對應的 4 組 `!changed.hasAny` 驗證區段
2. 新增 `isTeamFieldShrinkOrClear()` 函式（完整邏輯見本文件，含 Case A 全清 + Case B 子集縮減）
3. 修改 `users/{userId}` 的 update 允許條件，加上 `|| (isOwner(userId) && isTeamFieldShrinkOrClear())`
4. 驗證管理員與既有隊職員以上流程仍能更新他人的俱樂部欄位
5. 驗證入隊核准流程可正確寫入申請者俱樂部欄位
6. 驗證入隊申請發起流程不受影響（僅寫 messages collection）
7. 驗證退隊流程（單一俱樂部）可正確通過 `isTeamFieldShrinkOrClear` Case A
8. 驗證退隊流程（多俱樂部退出特定俱樂部）可正確通過 `isTeamFieldShrinkOrClear` Case B
9. 驗證 `deleteTeam` 流程中自身文件清除可通過 `isTeamFieldShrinkOrClear`（全清走 A、部分縮減走 B）
10. 驗證俱樂部限定活動、俱樂部成員判斷、俱樂部頁顯示不出現明顯回歸

### 三、前端調整

1. 驗證 `js/modules/team-form.js` 的 `handleLeaveTeam`：
   - 既有邏輯已正確計算 nextTeamIds/nextTeamNames
   - 單一俱樂部 → 全清 payload（Case A）；多俱樂部 → 部分縮減 payload（Case B）
   - **不需修改前端退隊邏輯**，只需驗證 payload 與新規則相容
2. 修正 `js/api-service.js` 的 `deleteTeam`：
   - 遍歷條件擴大：同時匹配 `u.teamId === id` 和 `u.teamIds.includes(id)`
   - 清除邏輯改為計算 nextIds/nextNames，正確處理多俱樂部縮減
   - currentUser 清除走同一套邏輯
   - 隊長自身多俱樂部：走 `isTeamFieldShrinkOrClear` Case B，無需特殊處理

### 四、測試與文件

1. 補上 Firestore 規則測試：一般使用者不得自行填入俱樂部欄位（任何非 null 值）
2. 補上 Firestore 規則測試：一般使用者可自行全部清空俱樂部欄位（Case A）
3. 補上 Firestore 規則測試：一般使用者可自行部分縮減俱樂部欄位（Case B，`hasAll` 子集驗證）
4. 補上 Firestore 規則測試：一般使用者不得偽造縮減（新 teamIds 非舊 teamIds 子集 → 被擋）
5. 補上 Firestore 規則測試：一般使用者不得重排序偷換 primary（size 未縮減 → 被擋）
6. 補上 Firestore 規則測試：`updatedAt` 必須為 `serverTimestamp()`（`== request.time`）
7. 補上 Firestore 規則測試：`lastLogin` 只能在登入更新格式中寫入，不能在個人資料更新中夾帶
8. 補上 Firestore 規則測試：客戶端偽造 Timestamp 值被擋
9. 補上 Firestore 規則測試：`isSafeLoginUpdate` 接受正確的登入 payload shape
10. 若規則與責任邊界有明顯改變，更新 `docs/architecture.md`
11. 在 `docs/claude-memory.md` 記錄本次安全性規格與後續實作結果
12. 若實作中有修改 JS 或 HTML，依規則同步更新快取版本號

---

## 驗收條件

1. 一般使用者無法再自行填入任意俱樂部欄位值（偽造入隊）：
   - `teamId` 不能設為非 null 的值
   - `teamIds` 不能設為非空的 list
   - `teamNames` 不能設為非空的 list

2. 一般使用者仍可自行退隊（全部清空）：
   - 所有俱樂部欄位歸零

3. 多俱樂部使用者可自行部分縮減（退出特定俱樂部）：
   - `isTeamFieldShrinkOrClear` Case B：新 `teamIds` 必須為舊 `teamIds` 的嚴格子集
   - 偽造替換（非子集）被擋、擴充被擋、重排序被擋

4. `lastLogin` 只能以登入更新格式寫入：
    - 登入 payload shape（`displayName` + `pictureUrl` + `lastLogin`）通過 `isSafeLoginUpdate`
    - 一般個人資料更新無法夾帶 `lastLogin`
    - 值必須為 `serverTimestamp()`

5. `updatedAt` 必須為 `serverTimestamp()`：
   - 所有包含 `updatedAt` 的 self-update 規則均驗證 `== request.time`
   - 客戶端偽造 Timestamp 被擋

6. 入隊申請發起流程不受影響

7. 核准入隊流程仍可成功把申請者加入俱樂部

8. 自行退隊流程經由 `isTeamFieldShrinkOrClear` 正確處理（單一俱樂部走 Case A，多俱樂部走 Case B）

9. 職員移除隊員流程不受影響

10. `deleteTeam` 流程正確處理 primary 與 secondary team 使用者的清除

11. `deleteTeam` 隊長自身多俱樂部：走 `isTeamFieldShrinkOrClear` Case B，無需特殊處理

12. 俱樂部限定活動、俱樂部頁、俱樂部成員判斷與相關訊息顯示無明顯回歸

13. Firestore 規則測試覆蓋上述所有核心限制

14. `isSafeTeamMembershipUpdateByStaff` 跨隊寫入風險標記為 Phase 2 待評估

---

## 預設假設

- 第一階段不新增 Cloud Function
- 先以 `firestore.rules` 收緊與既有前端受控寫入路徑對齊為主
- 一般個人資料欄位仍保留自助編輯能力
- 俱樂部欄位屬於身分與業務狀態，不再視為可自助編輯的個人資料
- `lastLogin` 屬於系統狀態，不再視為可自助編輯的個人資料，獨立為登入更新格式專用規則
- 退隊自主權保留：使用者可自行退出任意俱樂部（全清或部分縮減），不需經過任何人同意
- 多俱樂部為正常使用情境：使用者可同時申請並加入複數俱樂部，非管理員限定，第一階段不設定數量上限
- `isTeamFieldShrinkOrClear` 以 `list.hasAll()` 驗證子集，支援安全的部分縮減
- `isSafeTeamMembershipUpdateByStaff` 的跨隊寫入風險為 Phase 1 已知殘餘風險
- `team.js` 為死碼，不列入施工項目
- 時間欄位驗證一律使用 `== request.time`，確保只有 `serverTimestamp()` 能通過
- 三條 self-update 規則（`isSafeSelfProfileUpdate`、`isSafeLoginUpdate`、`isTeamFieldShrinkOrClear`）以責任分流為主；`displayName` / `pictureUrl` 可存在可重疊 payload，但不影響敏感欄位保護

---

## 備註

本文件為實作前規格書 V6 版本，不代表本次已直接修補 `firestore.rules` 或前端邏輯。
後續正式實作時，應以本文件為施工與驗證依據，並在完成後補齊修復日誌與測試結果。
