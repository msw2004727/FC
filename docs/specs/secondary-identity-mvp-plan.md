# 第二身份功能 MVP 實作前計劃書（四次修訂版）

> **狀態**：實作前規格（已納入四輪安全、落地性與相容性審計修訂）
> **日期**：2026-05-19  
> **範圍**：我的頁面、用戶管理顯示、用戶資料結構、身份顯示快照、Firestore/Storage 規則、Cloud Functions、管理稽核顯示
> **核心決策**：第二身份只作為顯示身份，不作為新用戶、不作為新 UID、不參與升權、不拆分營運統計。

---

## 0. 本版修訂重點

本版補上 MVP 落地前必須先釐清的中型以上風險：

- Firestore Rules 不能只把 `identities` 加進本人可寫白名單，必須限制可改欄位、巢狀結構、字串長度與固定值。
- Storage Rules 不能沿用「所有登入者可寫 `images/**`」作為第二身份頭像保護，必須依 `uid` 限定路徑所有權。
- MVP 不持久化 `identities.main`，主身份由 `users/{uid}` root 欄位即時計算，避免主資料與 `identities.main` 漂移。
- 舊資料沒有 identity snapshot 時，不可 fallback 到目前 profile active identity；應先用舊紀錄內既有姓名/頭像欄位，再用作者主 UID 查 root profile。
- Phase 順序調整為「規則與寫入 API 先行」，公開寫入點盤點不可延到 UI 完成後才處理。
- 第二身份不得寫入既有邏輯欄位，例如 `userName`、`creator`、`participants`、`senderName`；這些欄位在現有系統仍被用於比對、反查或 fallback。
- 公開顯示 snapshot 不可信任 client 任意送入，需由 Cloud Functions 產生，或由 Firestore Rules 對照 `users/{uid}` 驗證。
- `profileActiveIdentityId` 只代表我的頁面顯示偏好，不自動套用到全站公開寫入。
- 公開 profile 永遠顯示主身份；第二身份只出現在明確支援 identity snapshot 的紀錄中。
- 管理與稽核畫面必須可看到真實 UID、root role、identityId 與 snapshot display 的對照。
- `LineAuth.getProfile()` 只能作為登入同步 root user 的來源，不可被公開顯示或寫入流程直接當成身份來源。
- 第二身份必須有停用、重新啟用、清除頭像與 avatar storage path 記錄，避免 `profileActiveIdentityId` 指向不存在或已停用的身份。
- identity snapshot 採 create-time immutable policy；建立時驗證，後續一般更新不得改寫 snapshot。
- 公開可讀文件的 snapshot 只保存顯示欄位，不保存 root role / permissions / claims；管理稽核資料需用 join 或管理專用 log 取得。
- 第二身份頭像不可接受任意外部 URL；需由受控上傳流程產生並保存實際 Storage path。
- 支援第二身份公開顯示的 surface 必須有本地身份選擇或明確確認，不可偷用我的頁面切換狀態。
- 第二身份 snapshot 沒有公開頁時，公開作者互動不得偽裝成可直接進入主 profile 的第二身份頁。
- 因現有 `users/{uid}` 對所有登入者可讀，第二身份完整資料與 `profileActiveIdentityId` 不得存放在 `users/{uid}` root；需改放 owner/admin-only identity settings 文件。
- `users/{uid}` create 規則必須同步收斂，不能只保護 update；client 建立 root user doc 時不得夾帶 `identities`、`profileActiveIdentityId` 或權限相近欄位。
- 第二身份 avatar metadata 不接受 client 任意直寫 `avatarUrl`；MVP 採「Storage 上傳 + server commit endpoint / Cloud Functions commit metadata」作為標準路徑。
- 私訊 / 站內信若納入第二身份顯示，必須先定義 sender/recipient mirror、thread summary、audit log 的欄位矩陣；未完成前預設維持主身份顯示。

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
- 不讓第二身份取代既有邏輯欄位，例如 `userName`、`creator`、`participants`、`waitlistNames`、`senderName`。
- 不讓公開 profile 或 `?profile=uid` 因使用者切換第二身份而改顯示第二身份。
- 不讓 client 自行聲稱任意 snapshot 顯示名稱或頭像。
- 不讓身份顯示、留言、活動建立、私訊或 topbar/drawer 直接以 `LineAuth.getProfile()` 覆蓋 resolver 結果。
- 不在 MVP 提供「刪除所有歷史公開 snapshot」能力；已寫入公開紀錄的 snapshot 依歷史紀錄保留。
- 不承諾資料層匿名；既有公開 collection 若本來含 `uid` / `authorUid`，MVP 不在本階段隱藏這些主 UID 欄位。

---

## 3. 核心設計原則

### 3.1 真實身份與顯示身份分離

系統只承認一個真實身份：

```txt
真實身份 = users/{uid}
```

第二身份只是一個顯示身份：

```txt
顯示身份 = identitySettings(uid).identities.secondary
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

### 3.5 既有邏輯欄位維持主身份語意

現有系統中部分「看似顯示」的欄位實際仍被用於比對、反查、fallback 或營運流程，例如：

```txt
userName
creator
participants
waitlistNames
senderName
authorName
```

MVP 不得把第二身份暱稱直接寫入這些欄位來取代原本語意。這些欄位維持主身份或既有流程的值；第二身份只能寫入新增的 snapshot 欄位，例如 `identitySnapshot.displayName`。

### 3.6 公開顯示與管理稽核分層

公開畫面可顯示第二身份 snapshot；管理、稽核、修復、權限與營運畫面必須能看到真實資料。

注意：Firestore 沒有欄位級 read rule。若某個公開 collection 會被一般登入者讀取，就不得把 `realRole` 這類只應管理端可見的欄位直接寫進同一份公開文件。

公開文件可保留既有權限或統計所需的主 UID 欄位，例如 `uid` / `authorUid`，但 MVP 不承諾第二身份具備匿名性。若未來要讓一般使用者完全看不到主 UID，必須另做匿名公開紀錄架構，不屬本 MVP。

管理、稽核、修復與營運畫面需能透過 root user join、管理專用 mirror collection、Cloud Functions log 或後台查詢取得：

```txt
realUid
realRole
root displayName / pictureUrl
identityId
identitySnapshot displayName / avatarUrl
```

管理畫面不得只顯示「一般用戶」或第二身份暱稱，否則會降低事後追蹤與責任歸屬能力；但 `realRole` 不應出現在一般使用者可讀的公開文件中。

### 3.7 Active identity 只限我的頁面偏好

本 MVP 使用 `identitySettings(uid).profileActiveIdentityId` 表示「我的頁面目前顯示 / 編輯哪個身份」。它不是全站公開發文身份，也不能被所有寫入點自動套用。

因 `profileActiveIdentityId` 會透露本人目前偏好的顯示身份，不得存放在所有登入者可讀的 `users/{uid}` root。我的頁面、topbar 與 drawer 只對目前登入者讀取自己的 identity settings；管理畫面需透過管理權限或 Cloud Functions 讀取。

公開寫入若要使用第二身份，必須由該功能明確支援 identity snapshot，且在該寫入流程中取得經驗證的 snapshot。未明確支援的公開寫入點一律使用主身份語意。

### 3.8 LineAuth 只作登入同步來源

`LineAuth.getProfile()` 可用來在登入或重新登入時同步 root user 的 `displayName` / `pictureUrl`，但不可被畫面顯示、公開寫入、snapshot builder、topbar/drawer 或留言/活動作者 helper 直接當成最終身份來源。

身份顯示與公開寫入只能走：

```txt
ApiService.getCurrentUser() / FirebaseService currentUser cache
-> resolveUserIdentity()
-> buildIdentitySnapshot()
```

若仍有既有模組直接優先讀 `LineAuth.getProfile()`，Phase 1 必須列入盤點並改成 resolver。否則同一個使用者可能在 profile 頁顯示第二身份，但在留言或活動建立時仍寫入 LINE 暱稱。

### 3.9 Snapshot 建立後不可隨身份編輯漂移

公開紀錄中的 `identitySnapshot` 是寫入當下的顯示快照。使用者後續修改第二身份暱稱、頭像、停用第二身份或重新登入同步主身份時，不應自動重寫既有公開紀錄的 snapshot。

一般使用者更新既有紀錄時，snapshot 欄位必須保持不變。只有明確的管理修復工具可在稽核記錄下修正 snapshot。

---

## 4. 建議資料結構

### 4.0 資料可見性決策

現有 `users/{uid}` 規則允許所有登入者讀取 user root 文件，因此第二身份完整設定不可放在 `users/{uid}` root。若放在 root，即使 UI 不顯示第二身份，一般登入者仍可直接讀到第二身份暱稱、頭像、啟用狀態與 profile 顯示偏好，這與「公開 profile 永遠主身份」的產品語意不一致。

MVP 採用分層儲存：

```txt
users/{uid}
  只保存既有 root user 欄位，例如 uid / displayName / pictureUrl / role。
  不保存 identities、profileActiveIdentityId 或第二身份 avatar metadata。

users/{uid}/identityPrivate/settings
  保存 profileActiveIdentityId 與 identities.secondary。
  只允許本人、管理員或 Cloud Functions 讀寫。
```

下文用 `identitySettings(uid)` 代表 `users/{uid}/identityPrivate/settings`。所有 resolver、snapshot builder、Cloud Functions 與 Rules 驗證第二身份時，都必須同時讀 root user 與 `identitySettings(uid)`。

若未來產品明確決定「第二身份資料本身可被所有登入者讀取」，才可重新評估把部分欄位同步到 public root；本 MVP 不採用。

MVP 不持久化 `identities.main`。主身份一律由 root 欄位即時計算，避免登入同步或 profile 編輯時出現兩份主身份資料不同步。

```js
{
  // users/{uid}
  uid: "主帳號UID",
  displayName: "主身份暱稱",
  pictureUrl: "主身份頭像",
  role: "真實權限角色"
}
```

```js
{
  // users/{uid}/identityPrivate/settings
  profileActiveIdentityId: "main",

  identities: {
    secondary: {
      identityId: "secondary",
      enabled: true,
      displayName: "第二身份暱稱",
      avatarUrl: "第二身份頭像",
      avatarStoragePath: "images/users/{uid}/identities/secondary/avatar_{timestamp}",
      avatarStorageBucket: "Firebase Storage bucket name",
      displayRoleLabel: "一般用戶",
      isPrimary: false,
      editable: true,
      updatedAt: "serverTimestamp"
    }
  },

  updatedAt: "serverTimestamp"
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
identitySettings(uid).profileActiveIdentityId: 只能是 "main" 或 "secondary"，只代表我的頁面顯示偏好
secondary.identityId: 固定 "secondary"
secondary.enabled: boolean；建立後預設 true，停用時為 false
secondary.displayName: 1-40 字元
secondary.avatarUrl: null 或 URL 字串，建議上限 1200 字元
secondary.avatarStoragePath: null 或限定在 images/users/{uid}/identities/secondary/ 下的實際 Storage fullPath
secondary.avatarStorageBucket: null 或 Firebase Storage bucket 名稱；若專案使用 uploadStorage 與 default storage 分流，需保存
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
providerProfile
lineProfile
```

### 4.4 公開身份選擇不共用 profileActiveIdentityId

`profileActiveIdentityId` 不得作為所有公開寫入的隱含來源。若某個功能支援第二身份公開顯示，必須在該功能內明確呼叫 snapshot builder：

```js
buildIdentitySnapshot(user, {
  surface: "event_comment",
  requestedIdentityId: "secondary"
})
```

snapshot builder 必須在內部回傳真實 actor 與顯示 identity 的分層資料，不能只回傳顯示名稱：

```js
{
  actor: {
    realUid: user.uid,
    realRole: user.role
  },
  publicSnapshot: {
    identityId: "secondary",
    displayName: "第二身份暱稱",
    avatarUrl: "第二身份頭像",
    displayRoleLabel: "一般用戶"
  }
}
```

寫入公開可讀文件時，只能寫入 `publicSnapshot`。`actor.realRole` 只供 Rules/Cloud Functions 驗證、管理查詢或稽核 log 使用，不得落在一般使用者可讀的公開文件欄位。

未明確傳入 `requestedIdentityId` 的寫入流程，預設使用主身份 snapshot。

若 `requestedIdentityId == "secondary"`，snapshot builder 必須確認：

```txt
identitySettings(uid).identities.secondary 存在
identitySettings(uid).identities.secondary.enabled == true
secondary.displayName 通過長度與字元驗證
```

任一條件不成立時，不得靜默使用第二身份；應回退主身份或回傳明確錯誤，由該 surface 決定 UX。

凡是 MVP 明確支援第二身份公開顯示的 surface，必須在該 surface 提供本地身份選擇或明確確認，不可偷用 `profileActiveIdentityId` 作為全站預設。建議預設值為主身份；使用者每次在該 surface 選擇第二身份時，才傳入 `requestedIdentityId="secondary"`。

---

## 5. 身份解析規則

應建立統一解析 helper，避免各畫面自行判斷。

### 5.1 解析流程

```txt
1. 從 ApiService / FirebaseService cache 取得 currentUser，不直接讀 LineAuth.getProfile()
2. 讀取 identitySettings(uid).profileActiveIdentityId
3. 若 profileActiveIdentityId 是 "secondary" 且 identitySettings(uid).identities.secondary 存在且 enabled=true，使用第二身份
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

此 helper 回傳的 `realUid` / `realRole` 是內部資料，不代表可以寫入公開可讀文件。公開寫入只能保存顯示 snapshot；管理稽核需要真實資料時，另由 root user join 或管理 log 取得。

### 5.3 建議 helper 名稱

可新增於 profile 或 shared helper：

```js
resolveUserIdentity(user)
resolveActiveDisplayProfile(user)
getProfileActiveIdentityId(user)
getDisplayNameForCurrentIdentity(user)
getAvatarForCurrentIdentity(user)
buildIdentitySnapshot(user, options)
assertNoDirectLineProfileIdentityUse(surface)
```

實作時需依現有模組風格決定實際位置。

### 5.4 寫入 API 限制

不要用泛用 `ApiService.updateCurrentUser({ "identities.secondary.displayName": value })` 直接處理第二身份，因為現有 local cache 是用 `Object.assign`，dot path 會污染本地 user 物件；也不要把第二身份資料寫進 `users/{uid}` root。

應新增專用方法，例如：

```js
ApiService.updateSecondaryIdentity(updates)
FirebaseService.updateSecondaryIdentity(uid, updates)
ApiService.setProfileActiveIdentity(identityId)
ApiService.disableSecondaryIdentity()
ApiService.enableSecondaryIdentity()
ApiService.clearSecondaryIdentityAvatar()
```

這些方法需負責：

- 用 Firestore dot-path 寫入巢狀欄位。
- 寫入目標限定為 `identitySettings(uid)`，不得改動 `users/{uid}` root。
- 同步更新 local `currentUser.identitySettings.identities.secondary` 或等價 cache，不把私有欄位攤平成 root user。
- 不改動 root `displayName` / `pictureUrl` / `role`。
- 寫入失敗時回滾 local cache。
- 停用第二身份時同步把 `identitySettings(uid).profileActiveIdentityId` 改回 `main`。
- 上傳或清除頭像時同步維護 `avatarUrl`、`avatarStoragePath` 與必要時的 `avatarStorageBucket`。
- 清除頭像或替換頭像後，嘗試刪除舊 `avatarStoragePath` / `avatarStorageBucket` 指向的物件；刪除失敗不得阻斷身份資料更新，但需可記錄或重試。

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

切換應保存 `identitySettings(uid).profileActiveIdentityId`，但若保存失敗，畫面需回復原狀並提示。

切換只影響我的頁面顯示與第二身份資料編輯入口，不代表留言、報名、建立活動或私訊等公開寫入會自動使用第二身份。

### 6.3 第二身份可編輯欄位

第二身份狀態下允許：

- 編輯第二身份暱稱。
- 上傳第二身份頭像。
- 停用第二身份。
- 清除第二身份頭像。
- 重新啟用已停用的第二身份。

第二身份狀態下不可：

- 修改真實 `user.role`。
- 修改主身份 UID。
- 修改主身份權限資料。
- 修改主身份 `displayName` / `pictureUrl`。
- 修改用戶管理中的主資料欄位。

### 6.4 第二身份生命週期

第二身份不得只靠刪除巢狀 map 表示停用。MVP 採用明確狀態：

```txt
identities.secondary.enabled = true | false
```

行為規則：

- 第一次啟用時建立 `identitySettings(uid).identities.secondary`，並設 `enabled=true`。
- 停用時設 `enabled=false`，同一筆寫入需把 `identitySettings(uid).profileActiveIdentityId` 改回 `main`。
- 停用後我的頁面 fallback 主身份，公開寫入不得再使用第二身份 snapshot。
- 重新啟用時可沿用原暱稱與頭像，但仍需使用者明確操作。
- 清除頭像時設 `avatarUrl=null`、`avatarStoragePath=null`，並嘗試刪除舊 Storage 物件。
- 若保存了 `avatarStorageBucket`，清除頭像時也需設為 null。
- 停用第二身份不會刪除已存在公開紀錄中的歷史 snapshot。

### 6.5 主身份資料維持既有流程

主身份編輯仍走既有 profile 編輯邏輯。第二身份編輯應獨立更新：

```txt
identitySettings(uid).identities.secondary.displayName
identitySettings(uid).identities.secondary.avatarUrl
identitySettings(uid).identities.secondary.avatarStoragePath
identitySettings(uid).identities.secondary.avatarStorageBucket
identitySettings(uid).identities.secondary.enabled
identitySettings(uid).identities.secondary.updatedAt
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

### 8.0 既有邏輯欄位不得改為第二身份

現有欄位中有些名字雖然會顯示在畫面上，但仍被程式當成邏輯資料使用。MVP 不得把第二身份暱稱直接寫入這些欄位：

```txt
registrations.userName
attendanceRecords.userName
events.creator
events.participants
events.waitlistNames
messages.senderName
comments.authorName
```

這些欄位維持既有主身份或既有流程的值，以免破壞：

- 舊資料沒有 UID 時的姓名 fallback。
- 活動 owner 判斷。
- 報名 / 出席 / 候補 / no-show 的姓名比對。
- 管理員搜尋與修復流程。
- 站內信與私訊稽核。

第二身份顯示只能寫入新增欄位：

```txt
identitySnapshot.displayName
identitySnapshot.avatarUrl
identitySnapshot.identityId
```

畫面顯示可以優先讀 snapshot，但不得讓 snapshot 取代既有邏輯欄位的資料責任。

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

若管理稽核需要 `realRole`、root displayName 或更完整 actor 資料，不可把這些欄位混進一般使用者可讀的公開文件。應用既有 `uid` / `authorUid` 去 join `users/{uid}`，或由 Cloud Functions 寫入管理專用 log / mirror collection。

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

不得在舊資料沒有 snapshot 時 fallback 到「目前登入者的 profile active identity」。舊資料必須維持寫入當時的既有欄位語意，避免使用者切換身份後讓歷史紀錄改名。

### 8.3 Snapshot 信任來源

identity snapshot 不可信任 client 任意送入。實作時必須採用其中一種策略：

```txt
策略 A：Cloud Functions / server 重新讀 users/{uid} 與 identitySettings(uid) 後產生 snapshot。
策略 B：Firestore Rules 使用 get(users/{request.auth.uid}) 與 get(users/{request.auth.uid}/identityPrivate/settings) 驗證 snapshot 與當前 root/secondary identity 相符。
```

若採用策略 B，Rules 至少要驗證：

- `request.resource.data.<uidField> == request.auth.uid`
- `identitySnapshot.identityId` 只能是 `main` 或 `secondary`
- `main` snapshot 的 display fields 等於 root `displayName` / `pictureUrl`
- `secondary` snapshot 的 display fields 等於 `identitySettings(uid).identities.secondary.displayName` / `avatarUrl`
- `secondary` snapshot 只能在 `identitySettings(uid).identities.secondary.enabled == true` 時建立
- `displayRoleLabel` 只能是 resolver 定義的固定文字
- 公開可讀文件中的 `identitySnapshot` 不得包含 `realRole`、`role`、`permissions`、`claims` 等管理欄位

若該 collection 的 Rules 不方便驗證 snapshot，該寫入點在 MVP 不得接受 client snapshot，只能走 Cloud Functions。

### 8.4 Snapshot create / update 政策

`identitySnapshot` 採 create-time immutable policy：

```txt
create:
  驗證 snapshot 與當下 users/{uid} root / identitySettings(uid) secondary identity 相符

update:
  一般使用者不得新增、刪除或修改既有 identitySnapshot
  request.resource.data.identitySnapshot == resource.data.identitySnapshot

delete:
  依既有刪除權限處理，不因 snapshot identityId 改變刪除權限
```

原因：

- 使用者改第二身份暱稱後，舊留言或舊活動仍應保留寫入當下的顯示。
- 使用者更新留言內容時，不應因舊 snapshot 不等於目前 identity 而被 Rules 擋住。
- 若允許 update 改 snapshot，會讓歷史紀錄被重新署名，破壞稽核。

若需要修復錯誤 snapshot，必須走管理修復工具或 Cloud Functions，並記錄 operator、before/after、record id 與原因。

### 8.5 Cloud Functions 寫入路徑

現有部分公開資料由 Cloud Functions 寫入，例如活動報名 callable。這些路徑必須納入實作範圍：

- 前端傳入的 `participants[].userName` 仍維持主身份語意。
- 前端不得傳入任意 `identitySnapshot` 並被 CF 原樣信任。
- CF 若要保存第二身份 snapshot，必須用 `request.auth.uid` 重新讀 `users/{uid}` 與 `identitySettings(uid)` 後產生，且確認 `identitySettings(uid).identities.secondary.enabled == true`。
- CF 回傳給前端的 optimistic cache 資料也需包含同一份經驗證 snapshot，避免 UI 在 onSnapshot 前顯示不一致。
- CF 更新既有公開紀錄時，不得因使用者目前身份變更而重寫既有 snapshot。

### 8.6 公開寫入點盤點

實作前必須盤點所有會對外顯示姓名/頭像的寫入點，至少包含：

- 活動留言與留言按讚 summary。
- 私訊與站內信 sender 顯示。
- 活動建立者 `creator` / `creatorUid`。
- 報名與出席顯示欄位。
- 個人公開名片與分享卡。

若某個寫入點在 MVP 不支援第二身份顯示，需在規格中明確列為「仍顯示主身份」，不可讓使用者誤以為切換後全站公開行為都會套用第二身份。

### 8.6.1 私訊 / 站內信納入條件

私訊與站內信不可只改 message body 的 `senderName`。現有 server path 會同時寫入 sender message、recipient message、sender/recipient thread summary、audit conversation、audit message 與 audit log；前端也可能先建立 optimistic message。

MVP 預設私訊 / 站內信維持主身份顯示。若要納入第二身份公開顯示，Phase 1 必須先產出欄位矩陣，至少逐一決定：

```txt
sender message identitySnapshot
recipient message identitySnapshot
sender thread peerName / peerAvatar 是否維持 root peer profile
recipient thread peerName / peerAvatar 是否顯示 sender snapshot
pmAuditConversations / pmAuditMessages / pmAuditLogs 是否只保存 root actor 與 snapshot 對照
前端 optimistic message 是否由 CF 回傳的 verified snapshot 覆蓋
```

原則：

- audit 與管理追溯資料必須保留 root UID、root displayName、root role。
- 一般使用者可讀的 message / thread 顯示欄位不得包含 root role / permissions / claims。
- 若任一 mirror 無法一致保存或回傳 snapshot，私訊在本 MVP 明確列為「仍顯示主身份」。

### 8.7 公開 profile 規則

MVP 不做第二身份公開頁，因此以下入口永遠顯示主身份：

```txt
?profile={uid}
showUserProfile(uid/name)
個人名片分享 URL
```

公開 profile 可以在管理員或本人視角顯示「此用戶已設定第二身份」提示，但不得把 profile 主標題、主頭像或權限標籤改成第二身份。

若公開列表或留言列顯示的是第二身份 snapshot，且 MVP 沒有第二身份公開頁，作者暱稱 / 頭像不應沿用現有 `showUserProfile(authorUid)` 互動直接打開主身份 profile。可接受做法：

- 讓第二身份 snapshot 在公開畫面只作純顯示，不提供 profile link。
- 或在點擊前明確標示將前往主帳號 profile。
- 管理員視角可保留追溯入口，但需使用管理標記或展開詳情，不可偽裝成一般公開 profile link。

### 8.8 管理與稽核顯示

管理與稽核畫面不得只顯示 snapshot。凡是顯示第二身份 snapshot 的管理列表，至少需保留或可展開：

```txt
realUid
root displayName
root role
identityId
snapshot displayName
snapshot avatarUrl
record id / createdAt
```

這些管理資料可由管理頁讀取 `users/{uid}` 後 join，或由 Cloud Functions 寫入管理專用 log。不可為了管理頁方便，把 `realRole` 放進一般使用者可讀的公開紀錄。

範例：

```txt
公開顯示：第二身份暱稱
管理顯示：第二身份暱稱（主帳號：王小明 / admin / Uxxxx）
```

---

## 9. 第二身份頭像上傳

### 9.1 Storage 路徑

建議第二身份頭像獨立存放於專屬 prefix：

```txt
images/users/{uid}/identities/secondary/avatar_{timestamp}
```

第二身份頭像不可只使用現有 `_uploadImage(path)` 回傳的 download URL，因為清除或替換時需要實際 Storage path。應使用現有 `_uploadImageWithRef(path)`，或新增等價 helper 回傳 `{ url, fullPath, bucket }`。

傳入 logical path 時應避免含副檔名假設，例如：

```txt
users/{uid}/identities/secondary/avatar
```

由 helper 產生實際版本化檔名，成功後寫入：

```txt
identitySettings(uid).identities.secondary.avatarUrl
identitySettings(uid).identities.secondary.avatarStoragePath
identitySettings(uid).identities.secondary.avatarStorageBucket
```

`avatarStoragePath` 必須保存 `snapshot.ref.fullPath` 這類實際物件路徑，而不是 logical path `users/{uid}/identities/secondary/avatar`。若 `uploadStorage` 與 default storage 可能不同，需同步保存 bucket，或以可從 `avatarUrl` 還原正確 bucket 的方式刪除。

### 9.2 上傳限制

上傳時需限制：

- 僅本人可上傳。
- 限制圖片 MIME type。
- 限制檔案大小。
- 成功後只透過 server commit endpoint / Cloud Functions commit metadata 到 `identitySettings(uid).identities.secondary.avatarUrl`、`avatarStoragePath` 與必要時的 `avatarStorageBucket`。
- 替換頭像後嘗試刪除舊 `avatarStoragePath`。
- 清除頭像時需把 `avatarUrl` / `avatarStoragePath` / `avatarStorageBucket` 設為 null。
- 不可接受使用者手動輸入任意外部 `avatarUrl`。
- MVP 不允許 client 任意直寫 avatar metadata。標準流程是 client 只能上傳 Storage 物件，再呼叫 server commit endpoint / Cloud Functions 以 `request.auth.uid`、`snapshot.ref.fullPath`、bucket 與 download URL commit 到 identity settings。

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
  allow delete: if request.auth != null
    && request.auth.uid == uid;
}
```

若保留其他 `images/**` 寫入規則，不能讓它覆蓋或繞過這個專屬限制。

Rules 只能保護「誰能寫/刪 path」，不能保證 `identitySettings(uid).identities.secondary.avatarStoragePath` 一定對應最新檔案。因此 server metadata commit endpoint 必須同時保存實際 Storage fullPath / bucket，避免未來無法清理舊檔。

### 9.4 不可覆蓋主頭像

第二身份頭像上傳不得覆蓋：

```txt
users/{uid}.pictureUrl
```

也不得覆蓋既有主身份 avatar storage path。

---

## 10. Firestore 與安全規則

### 10.1 寫入權限

#### 10.1.1 `users/{uid}` root create / update 必須收斂

`users/{uid}` root 不得新增第二身份欄位。現有 create 規則若只檢查 `uid` 與 `displayName`，會讓 client 在建立自己 user doc 時夾帶任意 `identities`、`profileActiveIdentityId`、外部 avatar URL 或 role-like 巢狀欄位，繞過 update 規則。

Root user create 必須至少做到：

```txt
request.auth.uid == uid
request.resource.data.uid == uid
request.resource.data.keys().hasOnly(明確允許的 root 欄位)
request.resource.data.keys().hasAll(["uid", "displayName"])
request.resource.data.keys() 不包含 identities
request.resource.data.keys() 不包含 profileActiveIdentityId
request.resource.data.keys() 不包含 rolePermissions / permissions / claims / isAdmin / manualRole
```

若登入同步流程需要建立 root user doc，應只建立既有 root profile 欄位；第二身份 settings 由專用 API 在 `identitySettings(uid)` 建立。不要把 `profileActiveIdentityId` 加進 `isSafeLoginUpdate()` 或 `isSafeSelfProfileUpdate()` 的 root 白名單。

#### 10.1.2 Identity settings read / write

使用者只能修改自己的 identity settings：

```txt
request.auth.uid == uid
```

允許本人直接修改：

- `identitySettings(uid).profileActiveIdentityId`
- `identitySettings(uid).identities.secondary.enabled`
- `identitySettings(uid).identities.secondary.displayName`
- `identitySettings(uid).identities.secondary.updatedAt`

只允許 server commit endpoint / Cloud Functions 修改：

- `identitySettings(uid).identities.secondary.avatarUrl`
- `identitySettings(uid).identities.secondary.avatarStoragePath`
- `identitySettings(uid).identities.secondary.avatarStorageBucket`

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

針對 `identitySettings(uid)`，不能只做：

```txt
changed.hasOnly(["profileActiveIdentityId", "identities", "updatedAt"])
```

因為這會讓使用者改整包 `identities`。

Identity settings create 與 update 都必須做到同一組 schema 驗證：

```txt
1. profileActiveIdentityId 只能是 "main" 或 "secondary"。
2. 若改 identities，只允許改 secondary。
3. identities.main 必須不存在，或與舊值完全相同。
4. secondary 只能包含允許欄位。
5. secondary.enabled 必須是 boolean。
6. secondary.displayName 必須是 1-40 字元。
7. secondary.avatarUrl 必須是 null 或字串，建議上限 1200 字元。
8. secondary.avatarStoragePath 必須是 null 或 images/users/{uid}/identities/secondary/ 下的實際 fullPath。
9. secondary.avatarStorageBucket 必須是 null 或字串；若使用多 bucket 上傳，必須保存。
10. secondary.avatarUrl 非 null 時，不可為任意外部 URL；需對應 Firebase Storage 上傳結果，且 avatar metadata 由 server commit endpoint / Cloud Functions 寫入。
11. secondary.identityId 若存在必須等於 "secondary"。
12. secondary.displayRoleLabel 若存在必須等於 "一般用戶"。
13. secondary.isPrimary 若存在必須等於 false。
14. secondary.editable 若存在必須等於 true。
15. 只要 secondary map 有變更，secondary.updatedAt 必須等於 request.time；只切換 profileActiveIdentityId 時不強迫改 secondary.updatedAt。
16. 若 profileActiveIdentityId 設為 "secondary"，secondary 必須存在且 enabled == true；legacy secondary 沒有 enabled 時，必須在同一筆寫入補上 enabled=true。
17. 若 secondary.enabled 從 true 改 false，同一筆寫入必須把 profileActiveIdentityId 設為 "main"。
18. `identitySettings(uid)` 文件只能有 `profileActiveIdentityId`、`identities`、`updatedAt` 與必要的 migration metadata；不得混入 root user 欄位。
```

本人直接寫入 `identitySettings(uid)` 時，不得變更 `avatarUrl`、`avatarStoragePath`、`avatarStorageBucket`。這三個欄位只能由 server commit endpoint / Cloud Functions 以管理 SDK 寫入；Rules 測試需覆蓋 client 直接改 metadata 會被拒絕。

建議新增獨立 helper，例如：

```txt
isSafeIdentityUpdate()
isSafeSecondaryIdentityMap()
```

若為 migration 暫時仍需讀舊 root 欄位，只能讀取，不得再讓一般使用者透過 `users/{userId}` update 寫入第二身份欄位。

實作時更建議把 identity settings 放在獨立 nested match，例如：

```txt
match /users/{userId}/identityPrivate/settings {
  allow read: if isOwner(userId) || isAdmin();
  allow create, update: if isOwner(userId) && isSafeIdentitySettingsWrite(userId);
}
```

這個 nested match 不得繼承 root `users/{uid}` 的廣泛 read 語意。

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

### 10.4 公開紀錄 snapshot 驗證

凡是允許 client 直接建立公開紀錄且包含 identity snapshot 的 collection，Rules 必須驗證 snapshot 不被偽造。

最低要求：

```txt
request.resource.data.<uidField> == request.auth.uid
identitySnapshot.identityId in ["main", "secondary"]
identitySnapshot 不包含 realRole / role / permissions / claims
```

若 `identityId == "main"`：

```txt
identitySnapshot.displayName == users/{uid}.displayName
identitySnapshot.avatarUrl == users/{uid}.pictureUrl
```

若 `identityId == "secondary"`：

```txt
identitySettings(uid).identities.secondary.enabled == true
identitySnapshot.displayName == identitySettings(uid).identities.secondary.displayName
identitySnapshot.avatarUrl == identitySettings(uid).identities.secondary.avatarUrl
```

update 要求：

```txt
若 resource.data.identitySnapshot 存在：
  request.resource.data.identitySnapshot == resource.data.identitySnapshot

若 resource.data.identitySnapshot 不存在：
  一般使用者不得在 update 補上 identitySnapshot
```

若既有 collection Rules 只檢查字串長度，例如 `authorName` / `senderName`，不得把第二身份 snapshot 加進該 client 寫入路徑，除非同步補上上述驗證。

### 10.5 停用狀態保護

`identitySettings(uid).identities.secondary.enabled == false` 代表第二身份不可被新公開寫入使用。Rules / Cloud Functions / snapshot builder 均需遵守：

```txt
enabled=false:
  identitySettings(uid).profileActiveIdentityId 不可是 secondary
  不可建立 secondary identitySnapshot
  舊資料已有 secondary snapshot 仍可讀取顯示
```

停用不是刪除歷史紀錄，也不會回寫舊 snapshot。

### 10.6 既有邏輯欄位保護

Rules 或 Cloud Functions 不應要求第二身份 snapshot 等於既有邏輯欄位。相反地，應保護既有欄位語意：

```txt
userName / creator / participants / senderName / authorName = 既有主身份或既有流程欄位
identitySnapshot.* = 顯示身份欄位
```

若某個欄位目前同時承擔「顯示」與「邏輯比對」，MVP 必須先保留其邏輯用途，不可直接改成第二身份。

---

## 11. 舊資料相容

舊用戶可能沒有：

```js
identitySettings(uid)
identitySettings(uid).profileActiveIdentityId
identitySettings(uid).identities
identitySettings(uid).identities.secondary
```

需 fallback：

```txt
identitySettings(uid).profileActiveIdentityId 預設 main
main identity 由 user.displayName / user.pictureUrl 即時計算
secondary 不存在時顯示建立 / 啟用第二身份入口
identitySettings(uid).profileActiveIdentityId 是 secondary 但 secondary 不存在時，畫面 fallback main
identitySettings(uid).profileActiveIdentityId 是 secondary 但 secondary.enabled=false 時，畫面 fallback main，並應把偏好修正回 main
```

不需要批次遷移舊資料。可採用 lazy initialization：

```txt
使用者第一次啟用第二身份時才建立 identitySettings(uid) 與 identities.secondary
```

Lazy initialization 只建立 `identitySettings(uid).identities.secondary`，不建立 `identities.main`。

若舊資料已有 `identities.secondary` 但沒有 `enabled`，讀取時可視為 `enabled=true` 以避免破壞既有設定；下一次第二身份編輯時補寫 `enabled=true`。Rules 新寫入後則必須要求明確 boolean。

---

## 12. 建議實作階段

### Phase 0：安全規則與寫入邊界

目標：

- 新增 Firestore identity update 安全規則。
- 收斂 `users/{uid}` create 規則，禁止 client 在 root user doc 建立時夾帶 `identities`、`profileActiveIdentityId` 或權限相近欄位。
- 新增 `users/{uid}/identityPrivate/settings` nested rules，讀寫權限限定本人 / 管理員 / Cloud Functions。
- 新增 Storage 第二身份頭像 path-scoped 規則。
- 新增 snapshot create/update immutable 規則。
- 補 rules 測試，確認本人只能改允許欄位。
- 建立專用 identity update API，不使用泛用 `updateCurrentUser()` 處理 dot-path local cache。
- 建立 server avatar metadata commit endpoint / Cloud Functions；client 只能上傳 Storage，不可任意直寫 `avatarUrl`。
- 建立停用、重新啟用、清除頭像 API，並保存實際 `avatarStoragePath` / `avatarStorageBucket`。

可能影響區域：

- `firestore.rules`
- `storage.rules`
- `tests/`
- `js/firebase-service.js`
- `js/api-service.js`
- `functions/index.js`

### Phase 1：資料解析層與公開寫入盤點

目標：

- 新增 profile active identity resolver。
- resolver 必須同時讀 root user 與 `identitySettings(uid)`，不得期待第二身份欄位存在於 root user。
- 讓畫面可統一取得目前顯示身份。
- 保持所有 UID 與權限判斷不變。
- 盤點公開寫入點，決定哪些在 MVP 套用 snapshot，哪些明確維持主身份。
- 產出 surface matrix，明確標示留言、活動建立、報名、出席、個人公開卡、私訊 / 站內信、遊戲排行榜、achievement 顯示是 Include / Exclude / Later。
- 若私訊 / 站內信要 Include，需完成 message mirror / thread summary / audit log / optimistic UI 欄位矩陣。
- 盤點既有邏輯姓名欄位，標記哪些不可被第二身份覆蓋。
- 盤點所有直接優先讀 `LineAuth.getProfile()` 的畫面與寫入 helper，改成 root user / resolver。

可能影響區域：

- `js/modules/profile/`
- `js/firebase-service.js`
- `js/api-service.js`
- `js/modules/event/`
- `js/modules/message/`
- `js/modules/team/`
- `functions/index.js`

### Phase 2：我的頁面 UI

目標：

- 新增主副重疊頭像。
- 新增身份切換按鈕。
- 支援第二身份暱稱編輯。
- 支援第二身份頭像上傳。
- 支援停用、重新啟用與清除第二身份頭像。
- 切換失敗時回滾 UI。

可能影響區域：

- `js/modules/profile/profile-card.js`
- `js/modules/profile/profile-form.js`
- `js/modules/profile/profile-data-render.js`
- profile 相關 CSS

### Phase 3：公開顯示快照

目標：

- 針對 MVP 支援的公開寫入點加入 identity snapshot。
- 將 snapshot 放進新增欄位，不覆蓋 `userName` / `creator` / `senderName` 等既有邏輯欄位。
- 對 client 寫入點補 Rules 驗證；對 callable / server 寫入點由 Cloud Functions 產生 snapshot。
- create 時驗證 snapshot；update 時保持既有 snapshot 不變。
- 確保統計仍使用主 UID。
- 舊資料顯示使用 legacy record 欄位，不使用目前 profile active identity。
- 公開 profile 維持主身份，不讀第二身份 snapshot。

最低需處理或明確排除：

- 留言。
- 私訊 / 站內信發送人；未完成 mirror / audit / optimistic UI 欄位矩陣前預設排除，維持主身份。
- 活動建立者。
- 報名 / 出席顯示。
- 個人公開紀錄。
- Cloud Functions `registerForEvent` 與私訊相關 callable / server path；若該 path 未納入 snapshot 產生與回傳一致性，必須明確列為主身份。

### Phase 4：用戶管理顯示

目標：

- 用戶列表頭像欄位顯示主副重疊頭像。
- 用戶管理仍只編輯主資料。
- 權限、UID、統計顯示不受第二身份影響。
- 管理列表若顯示第二身份 snapshot，必須同時保留真實 UID / root role / root displayName。

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

- `users/{uid}` create 不可夾帶 `identities`、`profileActiveIdentityId`、`permissions`、`rolePermissions`、`claims`、`isAdmin`、`manualRole`。
- `users/{uid}` update 不可新增或修改 `identities` / `profileActiveIdentityId` root 欄位。
- 本人可以在 `identitySettings(uid)` 更新 `profileActiveIdentityId` 為 `main` / `secondary`。
- 本人不可在 `identitySettings(uid)` 更新 `profileActiveIdentityId` 為其他值。
- 本人可以更新 `identitySettings(uid).identities.secondary.displayName`。
- 本人不可更新 `identitySettings(uid).identities.secondary.role`。
- 本人不可更新 `identitySettings(uid).identities.main`。
- 本人不可透過 `identitySettings(uid).identities` 寫入 `permissions` / `rolePermissions` / `claims`。
- 本人不可修改其他使用者的 secondary identity。
- 非本人不可上傳 `images/users/{uid}/identities/secondary/*`。
- 本人可上傳自己的 secondary avatar，且 MIME/size 限制有效。
- 本人可刪除自己的 secondary avatar storage object，非本人不可刪。
- 本人不可直接把 `identitySettings(uid).identities.secondary.avatarUrl` 改成任意外部 URL。
- 本人不可繞過 server commit endpoint / Cloud Functions 直接 commit 不可信的 avatar metadata。
- `identitySettings(uid).profileActiveIdentityId=secondary` 時必須有 enabled=true 的 secondary identity。
- 停用 secondary 時必須同時把 `identitySettings(uid).profileActiveIdentityId` 改回 `main`。
- Client 不可建立與 `users/{uid}` 不一致的 identity snapshot。
- Client 不可用自己的 UID 搭配任意 `identitySnapshot.displayName` / `avatarUrl`。
- Client 不可在一般 update 中修改既有 `identitySnapshot`。
- 公開可讀文件的 `identitySnapshot` 不可包含 `realRole`、`permissions`、`claims`。

### 13.2 基本資料相容

- 舊用戶沒有 `identitySettings(uid)` 時，我的頁面正常顯示。
- 舊用戶沒有 `identitySettings(uid).profileActiveIdentityId` 時，預設使用主身份。
- `identitySettings(uid).profileActiveIdentityId` 是 `secondary` 但 `identitySettings(uid).identities.secondary` 不存在時，fallback 主身份。
- `identitySettings(uid).profileActiveIdentityId` 是 `secondary` 但 `identitySettings(uid).identities.secondary.enabled=false` 時，fallback 主身份並修正偏好。
- 舊 secondary identity 沒有 `enabled` 時，讀取相容為啟用；下一次編輯補寫 boolean。
- 第二身份尚未建立時，不影響主身份資料。

### 13.3 我的頁面切換

- 切換到第二身份後，頭像正確更新。
- 切換到第二身份後，暱稱正確更新。
- 切換到第二身份後，身份標籤顯示一般用戶。
- 切回主身份後，恢復 root `displayName` / `pictureUrl`。
- 重新整理後可維持或正確 fallback 到已保存的 profile active identity。
- 切換寫入失敗時 UI 回滾且有錯誤提示。
- profile、topbar、drawer 不得直接用 `LineAuth.getProfile()` 覆蓋 resolver 顯示。

### 13.4 編輯行為

- 編輯第二身份暱稱不會改到主身份暱稱。
- 上傳第二身份頭像不會覆蓋主頭像。
- 第二身份頭像同步更新 `identitySettings(uid).identities.secondary.avatarStoragePath`。
- 若使用 uploadStorage / default storage 分流，第二身份頭像同步更新 `identitySettings(uid).identities.secondary.avatarStorageBucket`。
- 清除第二身份頭像後 `avatarUrl` / `avatarStoragePath` / `avatarStorageBucket` 皆為 null。
- 停用第二身份後新公開寫入不得產生 secondary snapshot。
- 重新啟用第二身份需使用者明確操作。
- 編輯主身份資料不會意外清除第二身份資料。
- 登入同步更新 root `displayName` / `pictureUrl` 後，主身份顯示跟著更新。
- 登入同步更新 root `displayName` / `pictureUrl` 後，不會覆蓋第二身份暱稱或頭像。
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
- 支援第二身份的公開寫入 surface 需有本地身份選擇或明確確認，且預設主身份。
- 使用者修改第二身份後，既有公開紀錄的 snapshot 不被自動改寫。
- 使用者更新舊留言內容時，Rules 不要求舊 snapshot 等於目前身份資料。
- 舊資料沒有 snapshot 時，優先顯示 record 既有姓名/頭像欄位。
- 舊資料沒有 snapshot 時，不使用目前 profile active identity 作為 fallback。
- snapshot 不參與統計主鍵。
- 第二身份 snapshot 不會覆蓋 `userName` / `creator` / `participants` / `senderName` 等既有邏輯欄位。
- `registerForEvent` callable 路徑不信任前端傳入 snapshot，需由 CF 產生或驗證。
- 前端 Firestore fallback 報名路徑與 Cloud Functions 報名路徑產生一致的 snapshot 顯示結果。

### 13.8 公開 profile 與管理稽核

- `?profile={uid}` 與 `showUserProfile` 永遠顯示主身份。
- 切換第二身份後，公開 profile 主標題與主頭像不變。
- 公開列顯示第二身份 snapshot 時，作者暱稱 / 頭像不會直接偽裝成主 profile link。
- 管理列表顯示第二身份 snapshot 時，仍可看到真實 UID。
- 管理列表顯示第二身份 snapshot 時，仍可看到 root `role`。
- 管理列表顯示第二身份 snapshot 時，仍可看到 root `displayName`。
- 一般使用者讀公開紀錄時，不會在 `identitySnapshot` 看到 root `role`。

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

### 14.8 既有姓名欄位被誤改成第二身份

風險：`userName`、`creator`、`participants`、`senderName` 等欄位目前仍被拿來做比對、反查或 fallback。若改寫成第二身份，可能造成活動 owner 判斷、簽到、候補、no-show 與管理搜尋錯誤。

防護：

- 既有邏輯欄位維持主身份或既有流程值。
- 第二身份只寫入 `identitySnapshot.*`。
- Phase 1 盤點每個公開寫入點的「邏輯欄位」與「顯示欄位」。

### 14.9 Snapshot 偽造

風險：若 client 可以任意送 `identitySnapshot`，攻擊者可用自己的 UID 搭配任意姓名或頭像顯示。

防護：

- 優先由 Cloud Functions 產生 snapshot。
- Client 直寫 collection 必須由 Firestore Rules 對照 `users/{uid}` 驗證 snapshot。
- 無法驗證的直寫路徑在 MVP 不支援第二身份 snapshot。

### 14.10 Cloud Functions 路徑漏改

風險：前端 fallback 路徑支援 snapshot，但 callable 路徑仍寫主身份，會造成早鳥報名、一般報名或不同瀏覽器狀態顯示不一致。

防護：

- Phase 0/1/3 都把 `functions/index.js` 納入影響範圍。
- callable 必須從 `request.auth.uid` 重新讀取 user doc。
- callable 回傳資料與 Firestore 實際寫入欄位一致。

### 14.11 Active identity 作用範圍混淆

風險：若 `profileActiveIdentityId` 被誤用成全站公開身份，使用者在我的頁面切換後可能意外影響活動建立、留言或私訊署名。

防護：

- `profileActiveIdentityId` 只代表我的頁面顯示偏好，且存於 `identitySettings(uid)`。
- 公開寫入必須由該功能明確傳入 `requestedIdentityId` 並建立經驗證 snapshot。
- 未明確支援的寫入點一律使用主身份。

### 14.12 公開 profile 誤變第二身份頁

風險：若 profile render 直接套 active identity resolver，`?profile=uid` 可能顯示第二身份，等同變相建立第二身份公開頁。

防護：

- 公開 profile 永遠讀 root user。
- 第二身份只出現在支援 snapshot 的紀錄列。
- 本人或管理員可看到第二身份設定提示，但不替換 profile 主身份。

### 14.13 管理稽核責任弱化

風險：管理畫面若只顯示第二身份暱稱與「一般用戶」，會遮蔽真實 actor 的 UID 與 root role。

防護：

- 管理 / 稽核 / 修復畫面必須保留真實 UID、root displayName、root role。
- 顯示第二身份時採「snapshot（主帳號 / role / UID）」格式或可展開詳情。
- 操作記錄與錯誤記錄只用真實 UID 作為責任歸屬。

### 14.14 LineAuth 直接讀取造成身份不一致

風險：現有 profile、topbar、活動建立、留言等 helper 仍有直接優先讀 `LineAuth.getProfile()` 的路徑。若只新增 resolver 但沒有替換這些讀取點，使用者可能在我的頁面看到第二身份，實際公開寫入卻仍使用 LINE 暱稱或頭像。

防護：

- `LineAuth.getProfile()` 只作登入同步 root user 的來源。
- Phase 1 必須 grep 並盤點所有 `LineAuth.getProfile()` 顯示 / 寫入用途。
- profile、topbar、drawer、留言作者、活動建立者都必須改走 root user / resolver / snapshot builder。

### 14.15 第二身份停用與頭像清理缺口

風險：若沒有 `enabled` 與 `avatarStoragePath`，第二身份被停用後仍可能被新公開寫入使用，或舊 avatar 檔案無法清理。

防護：

- 第二身份使用 `enabled` 表示狀態，不靠刪除 map 表示停用。
- 停用時同一筆寫入必須把 `identitySettings(uid).profileActiveIdentityId` 設回 `main`。
- avatar 上傳成功時保存 `avatarStoragePath`，替換或清除時嘗試刪除舊檔。

### 14.16 Snapshot 更新時被重新署名

風險：若 update 時重新驗證 snapshot 等於目前身份，使用者改名後可能無法編輯舊留言；若 update 允許改 snapshot，則舊紀錄會被重新署名，破壞歷史顯示與稽核。

防護：

- create 時驗證 snapshot 與當下 root user / identity settings 相符。
- 一般 update 時 snapshot 必須 immutable。
- 需要修復 snapshot 時只能走管理修復工具或 Cloud Functions，並留下 before/after 記錄。

### 14.17 公開文件洩漏 root role

風險：若把 `realRole` 放進一般使用者可讀的公開紀錄，第二身份畫面雖然顯示「一般用戶」，但任何能讀 Firestore 文件的人都能看到真實權限角色，造成身份顯示與隱私預期落差。

防護：

- 公開 `identitySnapshot` 只放顯示欄位。
- Rules 拒絕公開 snapshot 內出現 `realRole` / `permissions` / `claims`。
- 管理頁需要 root role 時，透過 `users/{uid}` join 或管理專用 log/mirror 取得。

### 14.18 任意外部頭像 URL

風險：若 client 可直接寫 `avatarUrl`，使用者可填任意外部圖片網址，造成追蹤、壞圖、惡意內容或 CSP/載入行為不可控。

防護：

- 第二身份頭像需透過受控上傳流程產生。
- 保存實際 `avatarStoragePath` / `avatarStorageBucket`。
- server commit endpoint / Cloud Functions 拒絕任意外部 `avatarUrl`；Rules 測試確保 client 不能直接寫入 metadata。

### 14.19 使用者誤以為切換 profile 就套用全站

風險：若公開寫入 surface 不提供局部身份選擇，使用者可能以為我的頁面切到第二身份後，留言、活動或私訊都會自動使用第二身份。

防護：

- `profileActiveIdentityId` 僅限我的頁面，且存於 `identitySettings(uid)`。
- 支援第二身份的公開寫入 surface 預設主身份，並提供局部選擇或確認。
- 未支援的 surface 明確維持主身份語意。

### 14.20 第二身份顯示誤連主 profile

風險：現有留言與公開列表常用 `showUserProfile(authorUid)`。若畫面顯示第二身份 snapshot，但點擊作者卻打開主身份 profile，使用者會誤以為第二身份有公開頁，或意外揭露主身份。

防護：

- 第二身份 snapshot 在 MVP 可作純顯示，不必提供 profile link。
- 若需要連到主帳號 profile，必須在 UI 明確標示。
- 管理追溯入口與一般公開 profile link 必須視覺分離。

### 14.21 `users/{uid}` read 洩漏第二身份資料

風險：目前 `users/{uid}` root 對所有登入者可讀。若把 `identities.secondary` 或 `profileActiveIdentityId` 放在 root，即使 UI 不顯示，其他登入者仍可直接讀取第二身份資料。

防護：

- 第二身份完整資料與 `profileActiveIdentityId` 放在 `users/{uid}/identityPrivate/settings`。
- root user create / update 規則拒絕 `identities` 與 `profileActiveIdentityId`。
- resolver、snapshot builder、Cloud Functions 必須明確讀取 identity settings，不可期待 root user 帶有第二身份欄位。

### 14.22 Root user create 污染

風險：若只保護 update，不保護 create，使用者可在建立自己的 `users/{uid}` 時夾帶任意第二身份 map、外部 avatar URL 或權限相近欄位，後續 resolver / snapshot builder 可能誤信污染資料。

防護：

- `users/{uid}` create 使用 root 欄位白名單。
- create 與 update 都拒絕 `identities`、`profileActiveIdentityId`、`rolePermissions`、`permissions`、`claims`、`isAdmin`、`manualRole`。
- identity settings 的 create / update 使用同一套 schema 驗證與 rules 測試。

### 14.23 私訊 mirror / audit 顯示不一致

風險：私訊 server path 會寫多份鏡像與 audit 記錄。若只改其中一份的 sender 顯示，收件人 thread、寄件人 thread、audit log 與 optimistic UI 可能出現不同身份，甚至把 root role 放進一般可讀資料。

防護：

- 私訊 / 站內信預設維持主身份。
- 若納入 MVP，Phase 1 必須先完成 message mirror、thread summary、audit log、optimistic UI 欄位矩陣。
- Cloud Functions 必須用同一份 verified snapshot 寫入所有一般可讀 mirror，audit 則保留 root actor 對照。

---

## 15. 驗收標準

功能可視為完成需符合：

- Firestore Rules 通過 identity update 安全測試。
- `users/{uid}` root 不保存 `identities`、`profileActiveIdentityId` 或第二身份 avatar metadata。
- `users/{uid}` create / update 規則拒絕第二身份與權限相近欄位污染。
- `users/{uid}/identityPrivate/settings` 只有本人 / 管理員 / Cloud Functions 可讀寫。
- Storage Rules 通過本人/非本人 avatar 上傳測試。
- Storage Rules 通過本人/非本人 avatar 刪除測試。
- 我的頁面可在主身份與第二身份間切換。
- 第二身份可編輯暱稱。
- 第二身份可上傳獨立頭像。
- 第二身份可停用、重新啟用與清除頭像。
- 第二身份頭像 metadata 只能由 server commit endpoint / Cloud Functions commit，不可保存任意外部 URL。
- 切換第二身份不改變真實 `uid`。
- 切換第二身份不改變真實 `role`。
- `LineAuth.getProfile()` 不再直接決定 profile、topbar、留言或活動建立顯示身份。
- 用戶管理仍只顯示一筆真實用戶。
- 用戶管理可看到主副頭像顯示。
- 後台統計仍將兩個身份視為同一位用戶。
- 舊用戶資料不需要批次遷移即可正常使用。
- 舊公開資料沒有 snapshot 時不會被 profile active identity 改名。
- 第二身份 snapshot 不覆蓋既有邏輯欄位。
- 支援第二身份的公開寫入 surface 有局部身份選擇或明確確認。
- 第二身份 snapshot 的公開作者互動不會直接偽裝成主 profile link。
- Client 無法偽造不屬於自己的 snapshot 名稱或頭像。
- 公開 snapshot 不包含 root `role` / `permissions` / `claims`。
- 一般 update 不會改寫既有 `identitySnapshot`。
- 第二身份停用後，不可建立新的 secondary snapshot。
- Cloud Functions 與前端直寫路徑的 snapshot 行為一致。
- 私訊 / 站內信若未完成 mirror / audit / optimistic UI 欄位矩陣，明確維持主身份顯示。
- 公開 profile 永遠顯示主身份。
- 管理 / 稽核畫面可追溯真實 UID、root role 與 root displayName。
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
identitySettings(uid) = users/{uid}/identityPrivate/settings，owner/admin-only
profileActiveIdentityId = 我的頁面顯示偏好，不是全站公開身份，存於 identitySettings(uid)
既有 userName / creator / senderName = 保持原本邏輯語意
identitySnapshot = 經驗證的公開顯示快照
public identitySnapshot = 只含顯示欄位，不含 root role / permissions
identitySnapshot update = 一般更新不可改寫，管理修復例外
LineAuth profile = 登入同步來源，不是身份顯示來源
secondary.enabled = 第二身份是否可被新顯示 / 新 snapshot 使用
avatarStoragePath = 清除或替換第二身份頭像的 cleanup 依據
avatarUrl = 只能由受控上傳流程與 server metadata commit endpoint 產生，不接受任意外部 URL
MVP anonymity = 不承諾資料層匿名，既有 uid / authorUid 欄位仍可存在
公開 profile = 永遠主身份
secondary snapshot profile link = 預設不連主 profile，除非明確標示
管理稽核 = 永遠可追溯 realUid / root role
私訊 / 站內信 = 預設主身份；納入第二身份前必須完成 mirror / audit / optimistic UI matrix
營運統計 = 永遠以主 UID 匯總
```

此設計可先提供使用者可見的第二身份體驗，同時避免破壞既有資料查詢、權限判斷與營運統計。未來若需要擴充獨立公開頁、身份專屬 QR 或更完整的身份系統，可在 `identitySettings(uid).identities` 結構上逐步擴充，而不需要推翻主 UID 架構。
