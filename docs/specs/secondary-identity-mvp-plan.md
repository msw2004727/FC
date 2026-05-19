# 第二身份功能 MVP 實作前計劃書（修訂版）

> **狀態**：實作前規格（已納入安全與落地性審計修訂）  
> **日期**：2026-05-19  
> **範圍**：我的頁面、用戶管理顯示、用戶資料結構、身份顯示快照、Firestore/Storage 規則  
> **核心決策**：第二身份只作為顯示身份，不作為新用戶、不作為新 UID、不參與升權、不拆分營運統計。

---

## 0. 本版修訂重點

本版補上 MVP 落地前必須先釐清的中型以上風險：

- Firestore Rules 不能只把 `identities` 加進本人可寫白名單，必須限制可改欄位、巢狀結構、字串長度與固定值。
- Storage Rules 不能沿用「所有登入者可寫 `images/**`」作為第二身份頭像保護，必須依 `uid` 限定路徑所有權。
- MVP 不持久化 `identities.main`，主身份由 `users/{uid}` root 欄位即時計算，避免主資料與 `identities.main` 漂移。
- 舊資料沒有 identity snapshot 時，不可 fallback 到目前 active identity；應先用舊紀錄內既有姓名/頭像欄位，再用作者主 UID 查 root profile。
- Phase 順序調整為「規則與寫入 API 先行」，公開寫入點盤點不可延到 UI 完成後才處理。

---

## 1. 背景與目標

目前專案內多處邏輯以 `uid` 作為真實用戶、統計、活動紀錄、出席紀錄、QR、分享與個人資料查詢的核心主鍵。若直接將第二身份設計成另一個真實 UID 或另一筆 `users/{uid}` 文件，會讓既有資料撈取、權限判斷與後台統計出現高風險分裂。

本計劃採用較保守的 MVP 設計：保留單一主帳號 UID，第二身份只是一層顯示身份。

目標：

- 在我的頁面支援主身份 / 第二身份切換。
- 第二身份可以有獨立頭像與暱稱。
- 第二身份固定顯示為一般用戶。
- 第二身份不影響真實權限。
- 第二身份不影響後台統計與營運數據。
- 用戶管理仍以一個真實用戶為一列，但可以顯示主副頭像。
- 未來若要擴充真正身份系統，可從本資料結構平滑延伸。

---

## 2. 非目標

本階段明確不做以下事項：

- 不建立第二個 `users/{uid}` 文件。
- 不建立第二個 Firebase Auth / LINE 登入身份。
- 不讓第二身份擁有獨立真實 UID。
- 不讓第二身份改變 `user.role`。
- 不讓第二身份參與 `hasPermission()` 或任何管理權限判斷。
- 不讓第二身份拆分活動、出席、營運、用戶成長等統計。
- 不在用戶管理中把第二身份列成第二筆用戶。
- 不做第二身份專屬公開頁或專屬 QR。
- 不在 MVP 持久化 `identities.main`。

---

## 3. 核心設計原則

### 3.1 真實身份與顯示身份分離

系統只承認一個真實身份：

```txt
真實身份 = users/{uid}
```

第二身份只是一個顯示身份：

```txt
顯示身份 = users/{uid}.identities.secondary
```

任何資料歸屬、權限、統計都仍使用主帳號 UID。

### 3.2 權限永遠看主身份

權限判斷只能使用：

```js
user.role
```

不可使用：

```js
activeIdentity.displayRoleLabel
activeIdentity.role
identityRole
```

第二身份的「一般用戶」只是一個顯示標籤，不是權限角色。

### 3.3 統計永遠看主 UID

活動、出席、報名、留言、營運統計仍以主 UID 匯總：

```js
record.uid === user.uid
```

第二身份資料只在畫面顯示時使用，不改變統計歸屬。

### 3.4 顯示資料不得污染主資料

第二身份切換只改變畫面顯示與新寫入資料的顯示快照，不得改寫：

- `user.uid`
- `user.role`
- `user.displayName`
- `user.pictureUrl`
- 既有主身份頭像 Storage path

---

## 4. 建議資料結構

本階段建議將第二身份資料嵌入 `users/{uid}`，避免增加子集合讀取與同步複雜度。

MVP 不持久化 `identities.main`。主身份一律由 root 欄位即時計算，避免登入同步或 profile 編輯時出現兩份主身份資料不同步。

```js
{
  uid: "主帳號UID",
  displayName: "主身份暱稱",
  pictureUrl: "主身份頭像",
  role: "真實權限角色",
  activeIdentityId: "main",

  identities: {
    secondary: {
      identityId: "secondary",
      displayName: "第二身份暱稱",
      avatarUrl: "第二身份頭像",
      displayRoleLabel: "一般用戶",
      isPrimary: false,
      editable: true,
      updatedAt: "serverTimestamp"
    }
  }
}
```

### 4.1 主身份資料來源

主身份是虛擬身份，不另存一份：

```js
mainIdentity = {
  identityId: "main",
  displayName: user.displayName || user.name || "",
  avatarUrl: user.pictureUrl || "",
  displayRoleLabel: "主身份",
  isPrimary: true,
  editable: false
}
```

若未來真的要持久化 `identities.main`，必須同時修改所有會更新 root `displayName` / `pictureUrl` 的流程，包含登入同步與 profile 編輯，否則會發生主身份資料漂移。MVP 不採用這條路。

### 4.2 第二身份 UID 預留策略

MVP 不需要第二身份 UID。若要預留未來路由或公開識別，可加入：

```js
identityUid: "{uid}~secondary"
```

限制：

- `identityUid` 不可作為登入 UID。
- `identityUid` 不可作為 `users/{uid}` 文件 ID。
- `identityUid` 不可用於營運統計主鍵。
- `identityUid` 只可作為顯示識別或未來 public route 用。

### 4.3 欄位限制

第二身份資料必須有明確限制：

```txt
activeIdentityId: 只能是 "main" 或 "secondary"
secondary.identityId: 固定 "secondary"
secondary.displayName: 1-40 字元
secondary.avatarUrl: null 或 URL 字串，建議上限 1200 字元
secondary.displayRoleLabel: 固定 "一般用戶"，不可由使用者自訂
secondary.isPrimary: 固定 false
secondary.editable: 固定 true
secondary.updatedAt: serverTimestamp
```

不可允許第二身份 map 出現：

```txt
role
permissions
rolePermissions
claims
isAdmin
manualRole
exp
level
uid
lineUserId
```

---

## 5. 身份解析規則

應建立統一解析 helper，避免各畫面自行判斷。

### 5.1 解析流程

```txt
1. 取得 currentUser
2. 讀取 currentUser.activeIdentityId
3. 若 activeIdentityId 是 "secondary" 且 identities.secondary 存在，使用第二身份
4. 其他情況一律使用虛擬主身份
5. 虛擬主身份從 currentUser.displayName / currentUser.pictureUrl 即時計算
```

### 5.2 回傳資料形狀

helper 應明確分離顯示欄位與真實權限欄位：

```js
{
  identityId: "main" | "secondary",
  displayName: "畫面顯示暱稱",
  avatarUrl: "畫面顯示頭像",
  displayRoleLabel: "主身份" | "一般用戶",
  isSecondary: true | false,

  realUid: user.uid,
  realRole: user.role,
  sourceUser: user
}
```

`realUid` 與 `realRole` 只能從 root user 來，不能從 identity map 來。

### 5.3 建議 helper 名稱

可新增於 profile 或 shared helper：

```js
resolveUserIdentity(user)
resolveActiveDisplayProfile(user)
getActiveIdentityId(user)
getDisplayNameForCurrentIdentity(user)
getAvatarForCurrentIdentity(user)
buildIdentitySnapshot(user)
```

實作時需依現有模組風格決定實際位置。

### 5.4 寫入 API 限制

不要用泛用 `ApiService.updateCurrentUser({ "identities.secondary.displayName": value })` 直接處理第二身份，因為現有 local cache 是用 `Object.assign`，dot path 會污染本地 user 物件。

應新增專用方法，例如：

```js
ApiService.updateSecondaryIdentity(updates)
FirebaseService.updateSecondaryIdentity(uid, updates)
ApiService.setActiveIdentity(identityId)
```

這些方法需負責：

- 用 Firestore dot-path 寫入巢狀欄位。
- 同步更新 local `currentUser.identities.secondary`。
- 不改動 root `displayName` / `pictureUrl` / `role`。
- 寫入失敗時回滾 local cache。

---

## 6. 我的頁面 UI 規格

### 6.1 頭像區

我的頁面頭像位置新增主副重疊頭像：

- 主頭像為主要圓形頭像。
- 第二身份頭像以較小圓形重疊於角落。
- 若第二身份尚未設定頭像，使用預設 avatar 或主頭像淡化版本。
- 旁邊放置切換按鈕，使用 icon button。

### 6.2 切換行為

切換主身份 / 第二身份時，畫面即時更新：

- 頭像
- 暱稱
- 身份標籤
- 目前使用身份狀態

建議顯示：

```txt
目前使用：主身份
目前使用：第二身份
```

切換應保存 `activeIdentityId`，但若保存失敗，畫面需回復原狀並提示。

### 6.3 第二身份可編輯欄位

第二身份狀態下允許：

- 編輯第二身份暱稱。
- 上傳第二身份頭像。

第二身份狀態下不可：

- 修改真實 `user.role`。
- 修改主身份 UID。
- 修改主身份權限資料。
- 修改主身份 `displayName` / `pictureUrl`。
- 修改用戶管理中的主資料欄位。

### 6.4 主身份資料維持既有流程

主身份編輯仍走既有 profile 編輯邏輯。第二身份編輯應獨立更新：

```txt
users/{uid}.identities.secondary.displayName
users/{uid}.identities.secondary.avatarUrl
users/{uid}.identities.secondary.updatedAt
```

---

## 7. 用戶管理頁規格

用戶管理頁仍維持一個真實用戶一列。

### 7.1 顯示方式

頭像欄位：

- 顯示主副重疊頭像。
- 主頭像代表真實用戶。
- 第二頭像代表第二身份顯示設定。

暱稱欄位：

- 主暱稱仍為主要顯示文字。
- 可輔助顯示第二身份暱稱，例如小字或 tooltip。

UID 欄位：

- 只顯示主 UID。
- 不顯示第二身份為獨立 UID。

權限欄位：

- 只顯示真實 `role`。
- 不使用第二身份的 `displayRoleLabel` 參與權限管理。

### 7.2 編輯限制

用戶管理的既有編輯功能只編輯主身份資料。

本階段不在用戶管理提供第二身份編輯，以免混淆管理操作與用戶自訂顯示身份。

---

## 8. 對外資料寫入快照

若某些新資料需要顯示當下身份，例如留言、活動建立者、公開紀錄，可在寫入時保存顯示快照。

建議新寫入採用巢狀 snapshot，避免和既有 `userName` / `creator` / `senderName` 混淆：

```js
{
  uid: "主帳號UID",
  identitySnapshot: {
    identityId: "secondary",
    displayName: "第二身份暱稱",
    avatarUrl: "第二身份頭像",
    displayRoleLabel: "一般用戶"
  }
}
```

若既有 collection 已採用扁平欄位，也可保留扁平欄位，但必須明確標示其用途只供顯示：

```js
{
  uid: "主帳號UID",
  identityId: "secondary",
  displayNameSnapshot: "第二身份暱稱",
  avatarSnapshot: "第二身份頭像",
  displayRoleLabelSnapshot: "一般用戶"
}
```

### 8.1 統計規則

統計仍使用：

```js
uid
```

不得使用：

```js
identityId
identityUid
displayNameSnapshot
identitySnapshot.displayName
```

### 8.2 顯示規則

新舊資料顯示優先順序：

```txt
1. record.identitySnapshot / displayNameSnapshot / avatarSnapshot
2. record 既有顯示欄位，例如 userName、creator、authorName、senderName、authorPhoto
3. 依 record.uid / authorUid / creatorUid 查到的 root user.displayName / user.pictureUrl
4. fallback placeholder
```

不得在舊資料沒有 snapshot 時 fallback 到「目前登入者的 active identity」。舊資料必須維持寫入當時的既有欄位語意，避免使用者切換身份後讓歷史紀錄改名。

### 8.3 公開寫入點盤點

實作前必須盤點所有會對外顯示姓名/頭像的寫入點，至少包含：

- 活動留言與留言按讚 summary。
- 私訊與站內信 sender 顯示。
- 活動建立者 `creator` / `creatorUid`。
- 報名與出席顯示欄位。
- 個人公開名片與分享卡。

若某個寫入點在 MVP 不支援第二身份顯示，需在規格中明確列為「仍顯示主身份」，不可讓使用者誤以為切換後全站公開行為都會套用第二身份。

---

## 9. 第二身份頭像上傳

### 9.1 Storage 路徑

建議第二身份頭像獨立存放於專屬 prefix：

```txt
images/users/{uid}/identities/secondary/avatar_{timestamp}
```

若使用現有 `_uploadImage(path)` helper，傳入 logical path 時應避免含副檔名假設，例如：

```txt
users/{uid}/identities/secondary/avatar
```

由 helper 產生實際版本化檔名，成功後只把 download URL 寫入：

```txt
users/{uid}.identities.secondary.avatarUrl
```

### 9.2 上傳限制

上傳時需限制：

- 僅本人可上傳。
- 限制圖片 MIME type。
- 限制檔案大小。
- 成功後只更新 `users/{uid}.identities.secondary.avatarUrl`。

### 9.3 Storage Rules 必須先收斂

目前若仍是所有登入者可寫 `images/**`，不可直接上線第二身份頭像功能。

第二身份頭像需有 path-scoped rule：

```txt
match /images/users/{uid}/identities/secondary/{fileName} {
  allow read: if true;
  allow write: if request.auth != null
    && request.auth.uid == uid
    && request.resource.size < 2 * 1024 * 1024
    && request.resource.contentType.matches('image/.*');
}
```

若保留其他 `images/**` 寫入規則，不能讓它覆蓋或繞過這個專屬限制。

### 9.4 不可覆蓋主頭像

第二身份頭像上傳不得覆蓋：

```txt
users/{uid}.pictureUrl
```

也不得覆蓋既有主身份 avatar storage path。

---

## 10. Firestore 與安全規則

### 10.1 寫入權限

使用者只能修改自己的身份資料：

```txt
request.auth.uid == uid
```

允許本人修改：

- `activeIdentityId`
- `identities.secondary.displayName`
- `identities.secondary.avatarUrl`
- `identities.secondary.updatedAt`

不允許一般使用者修改：

- `role`
- `permissions`
- `rolePermissions`
- `claims`
- `isAdmin`
- `manualRole`
- `exp`
- `level`
- `uid`
- `lineUserId`
- `identities.main`
- 任意會影響管理權限的欄位

### 10.2 Rules 實作要求

不能只做：

```txt
changed.hasOnly(["activeIdentityId", "identities", "updatedAt"])
```

因為這會讓使用者改整包 `identities`。

Rules 必須做到：

```txt
1. activeIdentityId 只能是 "main" 或 "secondary"。
2. 若改 identities，只允許改 secondary。
3. identities.main 必須不存在，或與舊值完全相同。
4. secondary 只能包含允許欄位。
5. secondary.displayName 必須是 1-40 字元。
6. secondary.avatarUrl 必須是 null 或字串，建議上限 1200 字元。
7. secondary.identityId 若存在必須等於 "secondary"。
8. secondary.displayRoleLabel 若存在必須等於 "一般用戶"。
9. secondary.isPrimary 若存在必須等於 false。
10. secondary.editable 若存在必須等於 true。
11. secondary.updatedAt 必須等於 request.time。
```

建議新增獨立 helper，例如：

```txt
isSafeIdentityUpdate()
isSafeSecondaryIdentityMap()
```

並在 `users/{userId}` update 中與既有 `isSafeSelfProfileUpdate()` 並列。

### 10.3 欄位命名風險

第二身份不要使用 `role` 作為欄位名稱，避免未來被誤接到權限系統。

建議使用：

```js
displayRoleLabel: "一般用戶"
```

不建議使用：

```js
role: "user"
```

更保守的選項是不要讓 client 寫 `displayRoleLabel`，由 resolver 固定回傳「一般用戶」。

---

## 11. 舊資料相容

舊用戶可能沒有：

```js
activeIdentityId
identities
identities.secondary
```

需 fallback：

```txt
activeIdentityId 預設 main
main identity 由 user.displayName / user.pictureUrl 即時計算
secondary 不存在時顯示建立 / 啟用第二身份入口
activeIdentityId 是 secondary 但 secondary 不存在時，畫面 fallback main
```

不需要批次遷移舊資料。可採用 lazy initialization：

```txt
使用者第一次啟用第二身份時才建立 identities.secondary
```

Lazy initialization 只建立 `identities.secondary`，不建立 `identities.main`。

---

## 12. 建議實作階段

### Phase 0：安全規則與寫入邊界

目標：

- 新增 Firestore identity update 安全規則。
- 新增 Storage 第二身份頭像 path-scoped 規則。
- 補 rules 測試，確認本人只能改允許欄位。
- 建立專用 identity update API，不使用泛用 `updateCurrentUser()` 處理 dot-path local cache。

可能影響區域：

- `firestore.rules`
- `storage.rules`
- `tests/`
- `js/firebase-service.js`
- `js/api-service.js`

### Phase 1：資料解析層與公開寫入盤點

目標：

- 新增 active identity resolver。
- 讓畫面可統一取得目前顯示身份。
- 保持所有 UID 與權限判斷不變。
- 盤點公開寫入點，決定哪些在 MVP 套用 snapshot，哪些明確維持主身份。

可能影響區域：

- `js/modules/profile/`
- `js/firebase-service.js`
- `js/api-service.js`
- `js/modules/event/`
- `js/modules/message/`
- `js/modules/team/`

### Phase 2：我的頁面 UI

目標：

- 新增主副重疊頭像。
- 新增身份切換按鈕。
- 支援第二身份暱稱編輯。
- 支援第二身份頭像上傳。
- 切換失敗時回滾 UI。

可能影響區域：

- `js/modules/profile/profile-card.js`
- `js/modules/profile/profile-form.js`
- `js/modules/profile/profile-data-render.js`
- profile 相關 CSS

### Phase 3：公開顯示快照

目標：

- 針對 MVP 支援的公開寫入點加入 identity snapshot。
- 確保統計仍使用主 UID。
- 舊資料顯示使用 legacy record 欄位，不使用目前 active identity。

最低需處理或明確排除：

- 留言。
- 私訊 / 站內信發送人。
- 活動建立者。
- 報名 / 出席顯示。
- 個人公開紀錄。

### Phase 4：用戶管理顯示

目標：

- 用戶列表頭像欄位顯示主副重疊頭像。
- 用戶管理仍只編輯主資料。
- 權限、UID、統計顯示不受第二身份影響。

可能影響區域：

- `js/modules/user-admin/`
- user admin 相關 CSS

### Phase 5：測試、版本與部署

目標：

- 補上單元測試或最小回歸測試。
- 驗證舊用戶 fallback。
- 驗證權限不因身份切換改變。
- 驗證統計仍以主 UID 匯總。
- 依專案流程 bump version、commit、review、push 部署。

---

## 13. 測試清單

### 13.1 Rules 與安全

- 本人可以更新 `activeIdentityId` 為 `main` / `secondary`。
- 本人不可更新 `activeIdentityId` 為其他值。
- 本人可以更新 `identities.secondary.displayName`。
- 本人不可更新 `identities.secondary.role`。
- 本人不可更新 `identities.main`。
- 本人不可透過 `identities` 寫入 `permissions` / `rolePermissions` / `claims`。
- 本人不可修改其他使用者的 secondary identity。
- 非本人不可上傳 `images/users/{uid}/identities/secondary/*`。
- 本人可上傳自己的 secondary avatar，且 MIME/size 限制有效。

### 13.2 基本資料相容

- 舊用戶沒有 `identities` 時，我的頁面正常顯示。
- 舊用戶沒有 `activeIdentityId` 時，預設使用主身份。
- `activeIdentityId` 是 `secondary` 但 `identities.secondary` 不存在時，fallback 主身份。
- 第二身份尚未建立時，不影響主身份資料。

### 13.3 我的頁面切換

- 切換到第二身份後，頭像正確更新。
- 切換到第二身份後，暱稱正確更新。
- 切換到第二身份後，身份標籤顯示一般用戶。
- 切回主身份後，恢復 root `displayName` / `pictureUrl`。
- 重新整理後可維持或正確 fallback 到已保存的 active identity。
- 切換寫入失敗時 UI 回滾且有錯誤提示。

### 13.4 編輯行為

- 編輯第二身份暱稱不會改到主身份暱稱。
- 上傳第二身份頭像不會覆蓋主頭像。
- 編輯主身份資料不會意外清除第二身份資料。
- 登入同步更新 root `displayName` / `pictureUrl` 後，主身份顯示跟著更新。
- 專用 identity update API 不會在 local `currentUser` 產生 dot-path literal 欄位。

### 13.5 權限安全

- 切換第二身份後，管理權限不變。
- 切換第二身份後，`hasPermission()` 結果不變。
- 一般用戶不能藉由第二身份寫入 `role`。
- 用戶管理仍以主身份權限顯示。

### 13.6 統計與營運資料

- 活動統計仍以主 UID 計算。
- 出席統計仍以主 UID 計算。
- 用戶管理仍只有一筆真實用戶。
- 營運報表不因第二身份增加一個新用戶。

### 13.7 顯示快照

- 新寫入資料若包含 snapshot，畫面優先顯示 snapshot。
- 舊資料沒有 snapshot 時，優先顯示 record 既有姓名/頭像欄位。
- 舊資料沒有 snapshot 時，不使用目前 active identity 作為 fallback。
- snapshot 不參與統計主鍵。

---

## 14. 風險與防護

### 14.1 權限欄位混淆

風險：第二身份若使用 `role` 欄位，未來可能被誤接到權限判斷。

防護：

- 第二身份只使用 `displayRoleLabel`，或由 resolver 固定產生顯示標籤。
- 權限判斷只允許讀取 `user.role`。
- Firestore Rules 拒絕 secondary map 中出現 `role`。

### 14.2 UID 語意混淆

風險：若第二身份設計為另一個 UID，可能破壞既有 UID 查詢。

防護：

- MVP 不建立第二身份 UID。
- 如需預留，只使用 `identityUid`，且不得作為查詢主鍵。

### 14.3 統計拆分

風險：未來新資料若改用 `identityId` 統計，會讓同一用戶被拆成兩人。

防護：

- 所有營運統計明確只使用 `uid`。
- `identityId` 僅供顯示與篩選，不作為人數統計主鍵。

### 14.4 舊資料 fallback 不完整

風險：舊用戶沒有 identity 欄位時頁面顯示錯誤。

防護：

- resolver 必須提供完整 fallback。
- 測試需涵蓋無 `identities` 的舊資料。

### 14.5 主身份資料漂移

風險：若持久化 `identities.main`，登入同步與 profile 編輯可能只更新 root 欄位，造成主身份顯示舊暱稱或舊頭像。

防護：

- MVP 不持久化 `identities.main`。
- 主身份由 root `displayName` / `pictureUrl` 即時計算。

### 14.6 Storage 越權覆寫

風險：若沿用寬鬆 `images/**` 寫入規則，任何登入者可能寫入其他人的第二身份頭像 path。

防護：

- 第二身份 avatar path 必須加入 `request.auth.uid == uid`。
- 功能上線前需先部署並測試 Storage Rules。

### 14.7 公開顯示範圍誤解

風險：我的頁面切換完成後，使用者以為留言、活動、私訊都會套用第二身份，但實際寫入仍使用主身份。

防護：

- Phase 1 先完成公開寫入點盤點。
- Phase 3 明確列出 MVP 支援 snapshot 的範圍。
- 未支援的公開寫入點需在規格或 UI 中維持主身份語意。

---

## 15. 驗收標準

功能可視為完成需符合：

- Firestore Rules 通過 identity update 安全測試。
- Storage Rules 通過本人/非本人 avatar 上傳測試。
- 我的頁面可在主身份與第二身份間切換。
- 第二身份可編輯暱稱。
- 第二身份可上傳獨立頭像。
- 切換第二身份不改變真實 `uid`。
- 切換第二身份不改變真實 `role`。
- 用戶管理仍只顯示一筆真實用戶。
- 用戶管理可看到主副頭像顯示。
- 後台統計仍將兩個身份視為同一位用戶。
- 舊用戶資料不需要批次遷移即可正常使用。
- 舊公開資料沒有 snapshot 時不會被 active identity 改名。
- 相關測試通過。

---

## 16. 最終 MVP 決策摘要

```txt
第二身份 = 顯示身份
主 UID = 唯一真實用戶
user.role = 唯一真實權限來源
identityId = 顯示切換用
displayRoleLabel = 顯示標籤，不是權限
主身份 = root user 欄位即時計算，不持久化 identities.main
營運統計 = 永遠以主 UID 匯總
```

此設計可先提供使用者可見的第二身份體驗，同時避免破壞既有資料查詢、權限判斷與營運統計。未來若需要擴充獨立公開頁、身份專屬 QR 或更完整的身份系統，可在 `identities` 結構上逐步擴充，而不需要推翻主 UID 架構。
