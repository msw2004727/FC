# 一般 user 自己活動與委託人權限計劃書

## 目標

本計劃要讓一般 `user` 可以建立與管理「自己開啟的基本活動」，但不能使用新增活動內的「加值功能」開關。一般 `user` 嘗試開啟任一加值開關時，前端必須立即還原開關並顯示 Toast：

```text
如需更多功能請聯繫官方Line@
```

同時，一般 `user` 建立的活動仍可使用日常營運需要的功能：掃碼簽到、建立外部活動連結、取消活動、候補名單、委託人。委託人只承擔現場協作權限，不等同活動主辦人或完整管理者。

## 最終審計補正

本計劃在最後審計時發現三個必須先補進設計的阻斷點。後續實作不得只改前端與 Firestore rules，必須同時處理以下項目，否則會留下權限繞過面。

1. Cloud Functions callable 也是安全邊界。
   - `cancelRegistration` 等 callable 使用 Admin SDK 寫入 Firestore，會繞過 Firestore rules。
   - 因此 callable 內必須同步檢查 owner、delegate、admin、既有 permission code 與 `roleActivityCapabilities`。
   - 不能只依賴前端按鈕是否顯示，也不能只依賴 Firestore rules。

2. root legacy collection 不能直接用現有 `eventId` 做 manager 驗證。
   - 現有 `registrations.eventId` / `attendanceRecords.eventId` 存的是活動資料的 `data.id`，不是 Firestore `events/{docId}`。
   - Firestore rules 不能用欄位查詢 event，所以 root `registrations` / `attendanceRecords` 無法可靠驗證 event owner / delegate。
   - 涉及活動管理者權限的寫入必須改走 `events/{eventDocId}/...` subcollection、Cloud Functions，或先補 `eventDocId` 遷移後才能在 root path 驗證。

3. delegate 判斷必須三層一致。
   - 前端、Firestore rules、Cloud Functions 都要同時支援 `delegates[].uid` 與 `delegateUids[]`。
   - 不可出現 UI 判斷允許、rules 拒絕，或 callable 只看其中一種欄位而造成委託人權限不一致。

若實作前無法確認以上三點的處理策略，應中斷實作，不得部署。

## 第三輪阻斷審計補正

再次以現有前端、Firestore rules、Cloud Functions 與測試架構比對後，計劃書仍有以下阻斷級瑕疵。這些項目已納入後續章節的正式設計要求；若實作前未完成，仍不得開始部署。

1. `user.activity.own_manage_entry` 必須真的控制活動管理入口。
   - `page-my-activities` 不可只對所有登入 user 開放。
   - 一般 `user` 進入活動管理頁必須符合 `user.activity.own_manage_entry`，且至少有自己建立或被委託的活動，或具備建立活動能力。
   - coach+ / admin 維持既有 `activity.manage.entry` / role 行為，不受 user capability 關閉影響。

2. `event.create` 不等於加值功能。
   - `event.create` 只能代表「可建立活動」。
   - 加值功能必須由 `_canUseActivityAddons(e)` / rules / callable 的同一套邏輯控制。
   - 完整加值活動能力只給 admin、`event.edit_all`、`activity.manage.entry`，或一般 user 明確開啟 `user.activity.addons_use`。

3. Firestore rules 不能只靠 `hasPerm('activity.manage.entry')` 判斷 coach+。
   - 現有前端與 Functions 有 `INHERENT_ROLE_PERMISSIONS`，但 rules 的 `hasPerm()` 只讀 `rolePermissions` 文件。
   - Rules 必須新增 `hasActivityManageEntry()` 或等價 helper，將 `isCoachPlus()` 與 `hasPerm('activity.manage.entry')` 合併。

4. 一般 user 編輯既有活動時不可清掉既有加值欄位。
   - create 時一般 user 的加值欄位必須歸零 / 缺省。
   - update 時一般 user 不得新增、啟用、關閉或修改加值欄位；若既有活動有加值資料，應保留原值或在 payload 中省略，不可 sanitize 成 false/null 造成資料遺失。

5. 候補、名單、活動投影必須 server-authoritative。
   - `_forcePromoteWaitlist()`、`_forceDemoteToWaitlist()`、`_adjustWaitlistOnCapacityChange()`、管理者移除參與者，不能繼續由 client batch 同時更新 `registrations`、`activityRecords`、`events` 投影欄位。
   - Firestore rules 無法驗證 occupancy / participants / waitlistWithUid / activityRecords 的重建正確性。
   - 這些操作必須改由 Cloud Functions callable 在 transaction 內完成，前端只呼叫 callable 並刷新快取。

6. `activityRecords` 也在安全邊界內。
   - 現有 root / subcollection `activityRecords` 仍有 authenticated create 或 status-only update 的寬規則。
   - 本計劃收斂 `registrations`、`attendanceRecords` 時必須同步收斂 `activityRecords`，否則候補、取消、簽到統計仍可被旁路寫入。

7. 委託人不可「退回候補」confirmed 參與者。
   - 第一階段 delegate 的現場權限只包含查看名單、掃碼 / 手動簽到、將 waitlisted 候補升為 confirmed。
   - delegate 不可移除 confirmed 參與者，不可把 confirmed 退回 waitlisted，不可觸發 capacity change。

8. 部署順序必須納入 Functions。
   - 新 callable 是收斂 rules 前的必要條件。
   - 部署順序需避免「rules 已收斂但舊前端仍在用 client batch」造成正式功能中斷。

9. callable 測試必須被 `npm test` 覆蓋。
   - 若測試放在 `tests/functions/`，必須同步更新 `package.json` scripts。
   - 若不改 scripts，callable pure logic tests 應放在 `tests/unit/`，確保 `npm test` 會執行。

10. 掃碼頁入口也必須吃 `user.activity.site_operate`。
   - 目前 `page-scan` 只看 `event.scan`、`activity.manage.entry` 或 `_isAnyActiveEventDelegate()`。
   - 計劃不能只新增 owner / delegate 入口，否則權限管理把 `user.activity.site_operate` 關閉時，user owner / delegate 仍可能進掃碼頁。
   - `_isAnyActiveEventOperator()` 與 preset event 判斷需把一般 user owner / delegate 限制在 `user.activity.site_operate == true`。

11. `teamSplit` 的「後續操作」也是加值管理面。
   - 目前 `event-team-split.js` 的 `_tsBatchRandom()`、`_tsBatchFill()`、`_tsBatchReset()`、`_tsPickTeam()` 會直接改 `registrations.teamKey`，UI 入口主要依 `_canManageEvent(e)`。
   - 若只限制 create / edit / template 的 `teamSplit` 欄位，一般 user 或 delegate 仍可能在既有 teamSplit 活動中操作分隊，形成加值旁路。
   - 計劃需把 teamSplit manager 操作納入 `_canUseActivityAddons(e)` 或更細的 `_canManageTeamSplit(e)`，並同步收斂 Firestore `teamKey` manager write rules。

## 第四輪中型審計補正

本輪再對照 active code 的外部活動、狀態同步、teamOnly 可見性與 fallback 寫入後，以下中型瑕疵已補成正式實作要求。這些不是可留到實作時再判斷的細節。

1. 外部活動編輯權限必須明確。
   - 一般 `user` owner 可編輯自己建立的外部活動基本欄位，前提是 `user.activity.own_edit_basic` 開啟。
   - `user.activity.external_create` 只控制新增外部活動，不控制既有外部活動的基本編輯。
   - delegate 不可編輯外部活動；coach+ / admin 沿用既有活動管理權。
   - 外部活動 payload 必須維持非加值格式，不可透過 edit 寫入 fee、teamOnly、genderRestriction、privateEvent、teamSplit。

2. 前端自動更新活動狀態不可成為 rules 收斂後的隱性中斷點。
   - 目前 `_syncEventEffectiveStatus()`、`_autoEndExpiredEvents()`、報名 / 取消 guard 會由任意前端呼叫 `ApiService.updateEvent(... status ...)`。
   - 收斂 rules 後，一般 client 不可再直接寫 `open/full/upcoming/ended` 這類 canonical status。
   - 計劃需改成：前端只做 derived status 顯示；需要寫回 canonical status 時改由 server callable / scheduled function / event trigger 處理。
   - 一般 user owner 第一階段只允許把自己的活動 `status -> cancelled`；不可重新開放、重上架、結束或自動推進狀態。

3. teamOnly 的公開切換也是加值 / team 管理面。
   - 目前 `toggleEventPublicFromDetail()` 會寫 `isPublic`，`_canToggleEventPublic(e)` 可讓 owner 或 team staff 操作。
   - 因 `teamOnly` 屬加值功能，`isPublic` toggle 必須受 `_canManageTeamOnlyVisibility(e)` 或等價 helper 控制。
   - 一般 user owner 只有在 `user.activity.addons_use` 開啟且具有效隊伍 / team staff 資格時，才可操作 teamOnly 可見性；delegate 不可操作。

4. manager fallback direct write 必須在部署前移除或關閉。
   - 現有 `_removeParticipant()`、`_forcePromoteWaitlist()`、`_forceDemoteToWaitlist()`、`_adjustWaitlistOnCapacityChange()` 仍有 `shouldUseServerRegistration*` fallback，會走 client batch。
   - stricter rules 部署後，manager fallback 若保留會造成「新前端走 callable、舊前端或 fallback 仍嘗試 direct write」的中斷或旁路。
   - 實作需讓 manager roster / waitlist / capacity 操作只走 callable；fallback 僅可保留本人 self-cancel 等低權限安全路徑，且需 rules tests 覆蓋。

5. `_canManageEvent(e)` call-site 需分類清理，不能只新增 helper。
   - 所有會造成寫入、顯示管理按鈕、打開管理 modal、顯示 sensitive logs 的 call-site 必須改用精準 helper。
   - read-only visibility 或私密活動查看若暫時保留 `_canManageEvent(e)`，需在代碼註解或測試中確認不授予額外寫入能力。
   - 實作驗收需用 `rg "_canManageEvent"` 逐一列出殘留用途，確認沒有 delegate 或一般 user 被放大成完整管理者。

## 第五輪中型審計補正

本輪把前一版仍可能放大權限或造成部署後中斷的中型缺口補成硬性要求。

1. 一般 `user` owner 第一階段不取得 confirmed 參與者的破壞性管理權。
   - 使用者需求是「候補名單」，不是完整報名名單生命週期管理。
   - 一般 `user` owner / delegate 可查看名單、操作簽到、將 waitlisted 升為 confirmed、移除 waitlisted 候補者。
   - `demote_confirmed`、移除 confirmed 參與者、會把 confirmed 參與者退回或移除的 destructive capacity adjustment，第一階段只保留給 admin、`event.edit_all`、`hasActivityManageEntry()` / coach+。
   - 一般 `user` owner 若可修改活動人數上限，server 必須拒絕會低於目前 confirmed 人數的破壞性調整，或只做非破壞性 status / capacity 重算。

2. 活動詳情頁的掃碼與操作紀錄入口不能繼續共用 `_canManageEvent(e)`。
   - 現有 detail page 仍有 `canScan = _canManageEvent(e)` 類型判斷，會讓 delegate / owner 被視為完整管理者。
   - 掃碼、手動簽到、候補名單入口改用 `_canOperateEventSite(e)`。
   - 操作紀錄、報名異動 log、敏感管理紀錄需新增 `_canViewEventOperationLog(e)`；第一階段只允許 admin、`event.edit_all`、`hasActivityManageEntry()` / coach+ 與活動 owner，delegate 不因現場委託自動取得 log 權限。

3. self registration / self cancel fallback 也要在 rules 收斂前盤點。
   - 若舊前端仍能直接寫 root / subcollection `registrations`、`attendanceRecords`、`activityRecords` 完成報名或取消，stricter rules 部署後會中斷，或被迫留下過寬規則。
   - 實作必須先用 `rg` 盤點所有 direct registration / activity record 寫入路徑；新路徑優先走 `registerForEvent` / `cancelRegistration` callable。
   - 若保留本人 self-cancel 或 self-signup direct write，只能保留窄 allowlist，且 Firestore rules tests 必須覆蓋「只能改自己的、不能改投影、不能改他人、不能管理候補」。

4. `_canManageTeamOnlyVisibility(e)` 依賴的 team staff 判斷必須落地。
   - `_isEventOwnerOrTeamStaffForTeamOnly(e)` 不能只是 optional helper 名稱；前端、rules、callable 若使用 teamOnly 可見性控制，需有一致定義。
   - 若第一階段無法可靠判斷 team staff，則一般 `user` owner 即使 `addons_use` 開啟，也不得操作 teamOnly `isPublic`，避免把隊伍可見性權限放大。

## 第六輪代碼反向審計補正

本輪用 active code 反向搜尋 direct registration / activityRecords 寫入後，補上兩個 rules 收斂時容易誤傷或漏放大的項目。

1. `registrations.displayBadges` 不是候補 / roster 管理，但仍是 client registration write。
   - 目前 `event-manage-badges.js` 在 `event.edit_all` 條件下會直接更新 `events/{eventDocId}/registrations/{regId}.displayBadges`。
   - stricter registration rules 不能把這條路徑誤當成 waitlist / roster manager write；否則 admin badge refresh 會被 rules 打斷。
   - 實作需二選一：保留 admin / `event.edit_all` 的 `displayBadges`-only allowlist，或把 badge refresh 移到 callable。
   - 一般 user owner / delegate 不因活動現場權限取得替他人更新 `displayBadges` 的能力。

2. admin repair / migration tools 與一般活動管理路徑要分開分類。
   - `data-sync`、`registration-audit`、achievement repair、manual repair 類工具也會批次改 `registrations`、`attendanceRecords`、`activityRecords` 或 event 投影。
   - 這些工具不屬於一般 user owner-scope 功能；rules 收斂時需保留 super_admin / admin-only repair 路徑，或改由 callable / maintenance function 執行。
   - 實作前的 `rg` 盤點不能只看活動頁模組，需把 repair / migration direct writes 分類為「一般前台路徑」、「高權限維修路徑」、「應移除或 callable 化路徑」。

## 權限支狀圖

```text
活動權限架構
├─ 一般 user
│  ├─ 可建立自己的基本活動
│  ├─ 可建立自己的外部活動連結
│  ├─ 可管理自己建立的活動
│  │  ├─ 編輯基本資料
│  │  ├─ 取消活動
│  │  ├─ 查看報名與候補名單
│  │  ├─ 將候補升為正取
│  │  ├─ 移除 waitlisted 候補者
│  │  ├─ 不可移除 / 退回 confirmed 參與者（第一階段）
│  │  ├─ 掃碼簽到 / 簽退
│  │  ├─ 手動簽到 / 簽退
│  │  └─ 新增 / 移除委託人
│  └─ 不可使用加值功能
│     ├─ 收費 / 金額
│     ├─ 限隊員
│     ├─ 性別限制
│     ├─ 私密活動
│     └─ 自動分隊 / 隊伍設定
├─ 委託人
│  ├─ 只能操作被委託的活動
│  ├─ 可查看該活動報名與候補名單
│  ├─ 可將 waitlisted 候補升為正取
│  ├─ 可掃碼簽到 / 簽退
│  ├─ 可手動簽到 / 簽退
│  └─ 不可建立、編輯、取消、退回 confirmed、移除 confirmed 或設定委託人
├─ coach / captain / venue_owner
│  ├─ 保留既有活動管理入口
│  ├─ 保留既有建立活動能力
│  ├─ 可使用加值功能
│  └─ 管理範圍仍依 owner / delegate / explicit permission 區分
└─ admin / super_admin / event.edit_all
   ├─ 可管理全部活動
   ├─ 可使用所有加值功能
   └─ 可執行全域管理與刪除等高權限操作
```

## 目標能力表

| 功能 | 一般 user（自己活動主辦人） | 委託人 | coach+ / 既有活動管理者 | admin / event.edit_all | 備註 |
| --- | --- | --- | --- | --- | --- |
| 建立一般活動 | 可 | 不可 | 可 | 可 | `user` 只建立自己的基本活動 |
| 建立外部活動連結 | 可 | 不可 | 可 | 可 | 外部活動仍需綁定 `creatorUid` |
| 進入活動管理頁 | 可，只看自己活動 | 可，只看被委託活動 | 可，看自己 / 被委託活動 | 可，看全部 | 不建議直接把 `activity.manage.entry` 給 `user` |
| 編輯基本資料 | 可 | 不可 | 可，依管理範圍 | 可 | 委託人不等於編輯者 |
| 取消活動 | 可 | 不可 | 可，依管理範圍 | 可 | 委託人不可取消，避免現場協作權限過大 |
| 重新開放 / 重新上架 | 第一階段不可 | 不可 | 可，依既有權限 | 可 | 建議先維持高階活動管理功能 |
| 刪除活動 | 不可 | 不可 | 依 `event.delete_self` / `event.delete` 設計 | 可 | Firestore 目前偏向 admin / delete permission |
| 掃碼簽到 / 簽退 | 可 | 可 | 可，依管理範圍 | 可 | 一般 user owner / delegate 需 `user.activity.site_operate` 開啟 |
| 手動簽到 / 簽退 | 可 | 可 | 可，依管理範圍 | 可 | 一般 user owner / delegate 需 `user.activity.site_operate` 開啟 |
| 查看報名名單 | 可 | 可 | 可，依管理範圍 | 可 | 委託人需要現場核對 |
| 候補升正取 | 可 | 可 | 可，依管理範圍 | 可 | 一般 user owner / delegate 需 `user.activity.site_operate` 開啟；必須走 callable |
| confirmed 退回候補 / 移除 | 第一階段不可 | 不可 | 可，依管理範圍 | 可 | 一般 user owner / delegate 第一階段都不可操作 confirmed 參與者 |
| 設定委託人 | 可 | 不可 | 可，限自己可管理活動 | 可 | 建議維持最多 3 人 |
| 收費 / 金額 | 不可 | 不可 | 可 | 可 | 加值功能 |
| 限隊員 | 不可 | 不可 | 可 | 可 | 加值功能 |
| 性別限制 | 不可 | 不可 | 可 | 可 | 加值功能 |
| 私密活動 | 不可 | 不可 | 可 | 可 | 加值功能 |
| 自動分隊 / 隊伍設定 | 不可 | 不可 | 可 | 可 | 加值功能 |

## 設計原則

1. 不把一般 `user` 升級成既有活動管理者。
   - 不建議把 `activity.manage.entry`、`event.create`、`event.edit_self` 直接塞進 `user` 預設權限。
   - 原因是目前專案中這些權限會牽動抽屜選單、活動管理頁、建立活動、編輯活動與部分生命週期操作，直接授權容易放大權限。

2. 新增「基本活動主辦人」能力，而不是重用完整管理權限。
   - 一般 `user` 的建立活動能力應由登入身分與 owner scope 決定。
   - coach+ 與 admin 繼續走既有 permission code。

3. 把「活動管理」拆成更小的能力判斷。
   - 目前 `_canManageEvent(e)` 同時把 owner、delegate、`event.edit_all` 視為可管理。
   - 目標應拆成：
     - `_isEventOwner(e)`
     - `_isEventDelegate(e)`
     - `_canManageAllActivities()`
     - `_canCreateBasicActivity()`
     - `_canCreateExternalActivity()`
     - `_canEditOwnActivityBasic(e)`
     - `_canCancelOwnActivity(e)`
     - `_canOperateEventSite(e)`
     - `_canManageEventDelegates(e)`
     - `_canUseActivityAddons(e)`

4. 加值功能必須前後端雙重防護。
   - 前端：開關被一般 `user` 開啟時立即 reset 並 Toast。
   - 表單送出：create 時再次 sanitize 加值欄位；update 時保留既有加值欄位且禁止變更，避免 DOM 操作繞過或誤清資料。
   - Firestore rules：限制一般 `user` create/update 時不可寫入加值欄位。
   - Cloud Functions：若活動管理操作會透過 callable 寫入活動主資料或投影欄位，callable 也必須套用同一套加值欄位規則。

## 前端實作計劃

### 1. 建立活動入口

目前 `openCreateEventModal()` 與 `handleCreateEvent()` 依賴 `_canCreateActivityByPermission()`，而此 helper 只接受 `event.create` 或 `activity.manage.entry`。

計劃調整：

```js
_canCreateBasicActivity() {
  const currentUser = ApiService.getCurrentUser?.();
  if (!currentUser) return false;
  if (this.hasPermission('event.create') || this.hasPermission('activity.manage.entry')) return true;
  return this._hasUserActivityCapability?.('user.activity.basic_create') === true;
}

_canCreateExternalActivity() {
  const currentUser = ApiService.getCurrentUser?.();
  if (!currentUser) return false;
  if (this.hasPermission('event.create') || this.hasPermission('activity.manage.entry')) return true;
  return this._hasUserActivityCapability?.('user.activity.external_create') === true;
}

_canCreateActivityByPermission() {
  return this.hasPermission('event.create')
    || this.hasPermission('activity.manage.entry')
    || this._canCreateBasicActivity()
    || this._canCreateExternalActivity();
}

_canUseActivityAddons(e = null) {
  if (this.hasPermission('event.edit_all') || this.hasPermission('activity.manage.entry')) return true;
  // event.create 只代表可建立活動，不代表可使用加值功能。
  return this._hasUserActivityCapability?.('user.activity.addons_use') === true
    && (!e || this._isEventOwner(e));
}

_canAccessOwnActivityManageEntry() {
  if (this.hasPermission('event.edit_all') || this.hasPermission('activity.manage.entry')) return true;
  if (this._hasUserActivityCapability?.('user.activity.own_manage_entry') !== true) return false;
  const events = ApiService.getEvents?.() || [];
  return events.some(e => this._isEventOwner?.(e) || this._isEventDelegate?.(e))
    || this._canCreateActivityByPermission();
}
```

重點是保留舊方法名稱給既有呼叫點，但內部改成支援一般登入 user。

同時，建立活動的底部選單必須依 capability 分別顯示項目：

- `user.activity.basic_create` 關閉時，隱藏 / 禁用「自訂活動」。
- `user.activity.external_create` 關閉時，隱藏 / 禁用「活動連結」。
- 兩者都關閉時，活動頁右上角「新增活動」與活動管理頁 `＋ 新增` 都不顯示。

### 2. 外部活動連結

目前 `handleCreateExternalEvent()` 需要 `activity.manage.entry`。計劃改為：

- coach+ / admin：沿用 `activity.manage.entry`。
- 一般 `user`：登入後可建立，payload 必須固定為基本外部活動格式。
- 委託人：不可因被委託而建立外部活動。
- 編輯外部活動：
  - 一般 `user` owner 可編輯自己建立的外部活動基本欄位，需 `user.activity.own_edit_basic` 開啟。
  - `user.activity.external_create` 關閉後，只禁止新增外部活動；既有外部活動是否可編輯由 `own_edit_basic` 控制。
  - delegate 不可編輯外部活動。
  - edit payload allowlist 僅包含 `title`、`date`、`location`、`externalUrl`、`sportTag`、`image`、`gradient` 等外部活動基本欄位。
  - edit payload 不可寫入 `fee`、`feeEnabled`、`teamOnly`、`genderRestrictionEnabled`、`allowedGender`、`privateEvent`、`teamSplit`、`delegates`、`delegateUids`、roster projection 欄位。

### 3. 活動管理頁入口

目前 `page-my-activities` 在 `DRAWER_MENUS` 中設定 `minRole: 'coach'` 與 `permissionCode: 'activity.manage.entry'`，`_canAccessPage()` 會優先套用這個 drawer rule，所以一般 `user` 無法進入。

計劃調整：

- `page-my-activities` 不直接對所有登入 user 開放，改由 `_canAccessOwnActivityManageEntry()` 控制。
- 一般 `user` 必須具備 `user.activity.own_manage_entry` 才能進入。
- `user.activity.own_manage_entry` 關閉時，即使該 user 是 owner 或 delegate，也不可從活動管理入口進入。
- 列表資料仍由 `renderMyActivities()` scope 控制：
  - admin / `event.edit_all` 看全部。
  - owner 看自己活動。
  - delegate 看被委託活動。
- UI 文案可保留「活動管理」，但權限含義從「coach 管理入口」擴展成「我的活動 / 被委託活動入口」。

### 3.1 新增活動按鈕顯示策略

目前活動頁右上角的 `#activity-create-btn` 預設 `display:none`，由 `_refreshActivityCreateButton()` 依 `_canCreateActivityByPermission()` 決定是否顯示。完成本計劃後，只要 `_canCreateActivityByPermission()` 納入 `_canCreateBasicActivity()`，一般登入 `user` 就應看得到活動頁右上角的「新增活動」按鈕。

需同步處理另一顆按鈕：`page-my-activities` header 內的 `＋ 新增` 目前是硬顯示。未來 `page-my-activities` 開放 owner / delegate scope 後，這顆按鈕也必須套用 `_canCreateActivityByPermission()` 顯示條件，避免委託人看得到新增入口但點擊後才被權限阻擋。

`user.activity.own_manage_entry` 關閉時，`page-my-activities` header 內所有新增 / 管理操作都不可顯示；若使用者已停留在該頁且 capability 被關閉，capability listener 必須導回安全頁。

### 3.2 權限管理中的呈現方式

目前權限管理頁會列出 `user` 層級，但 `ApiService.getRolePermissions('user')` 固定回傳空陣列，`user-admin-roles.js` 也將 `user` 視為 locked role，提示「一般用戶固定沒有任何後台功能權限，所有開關已鎖定，避免誤開啟。」

因此，本計劃中的「基本活動主辦人」能力不應出現在一般 permission toggle 清單，也不應計入 `user` 的後台權限數量。它不是 `rolePermissions/user` 內的權限，而是登入使用者基於 owner scope 固定可用的前台能力。

為了讓管理者可查看與手動啟閉，建議在選取 `user` 層級時，在既有後台權限清單上方或下方新增一個獨立區塊：

```text
前台活動能力（一般 user）
```

這個區塊可以顯示第二套活動能力開關，但它不屬於既有後台 permission toggle，不寫入 `rolePermissions/user`，也不讓 Firestore `hasPerm()` 開始接受 `role == 'user'`。

建議的開關：

| capability code | 顯示名稱 | 預設 | 說明 |
| --- | --- | --- | --- |
| `user.activity.basic_create` | 建立基本活動 | 開 | 控制一般 user 是否可建立非加值活動 |
| `user.activity.external_create` | 建立外部活動連結 | 開 | 控制一般 user 是否可建立外部活動連結 |
| `user.activity.own_manage_entry` | 查看自己的活動管理 | 開 | 控制一般 user 是否可進入自己的活動 / 被委託活動入口 |
| `user.activity.own_edit_basic` | 編輯自己活動基本資料 | 開 | 不含加值欄位 |
| `user.activity.own_cancel` | 取消自己活動 | 開 | 僅 owner 可取消 |
| `user.activity.site_operate` | 現場操作 | 開 | 掃碼、手動簽到、候補操作 |
| `user.activity.delegate_assign` | 設定委託人 | 開 | 僅 owner 可設定，建議最多 3 人 |
| `user.activity.addons_use` | 使用加值功能 | 關 | 一般 user 預設關閉；開啟後才可用收費、限隊員、性別限制、私密、自動分隊 |

當 `user.activity.addons_use` 關閉時，一般 user 開啟加值開關仍需 Toast：

```text
如需更多功能請聯繫官方Line@
```

資料儲存建議新增獨立 collection，例如 `roleActivityCapabilities/{roleKey}`，文件格式：

```js
{
  capabilities: [
    'user.activity.basic_create',
    'user.activity.external_create',
    'user.activity.own_manage_entry',
    'user.activity.own_edit_basic',
    'user.activity.own_cancel',
    'user.activity.site_operate',
    'user.activity.delegate_assign'
  ],
  updatedAt,
  updatedBy
}
```

前端 helper 讀取這套 capability，例如 `_hasUserActivityCapability(code)`。Firestore rules 也新增對應 helper，例如 `hasUserActivityCapability(cap)`，只用在 user 前台活動能力判斷，不取代 `hasPerm()`。

這樣權限管理頁看得到開關，也能手動啟閉，但不會把 user 混入既有後台權限系統。

#### capability 預設值與缺文件行為

必須明確定義缺少 `roleActivityCapabilities/user` 文件時的行為，避免前端預設開、Rules 預設關，造成「按鈕看得到但寫入失敗」。

建議預設：

- 未建立 capability 文件時，前端與 Firestore rules 都採用內建預設。
- 內建預設為：
  - `user.activity.basic_create`：開
  - `user.activity.external_create`：開
  - `user.activity.own_manage_entry`：開
  - `user.activity.own_edit_basic`：開
  - `user.activity.own_cancel`：開
  - `user.activity.site_operate`：開
  - `user.activity.delegate_assign`：開
  - `user.activity.addons_use`：關
- 一旦 `roleActivityCapabilities/user` 文件存在，則以文件內 `capabilities` 清單為準。
- Firestore rules 中也要有同一份預設清單，或以 helper 明確處理 `!exists()` 的情境。

#### FirebaseService / ApiService 載入與監聽

新增 `roleActivityCapabilities` 後，不能只在 UI 讀一次，需納入現有資料層：

- `FirebaseService._cache` 新增 `roleActivityCapabilities: {}`。
- `_persistCache()`、`_restoreCache()`、logout / clear cache 流程都要正確處理這個 object，不可被清成 array。
- `page-admin-roles`、`page-activities`、`page-my-activities`、`page-scan` 的資料需求要包含 capability 資料，或由全域 listener 保證登入後即時可用。
- 參考 `rolePermissions` 的 onSnapshot，新增 `roleActivityCapabilities` 即時監聽。
- capability 更新時需觸發：
  - `App.applyRole()`
  - `_refreshActivityCreateButton()`
  - `renderRoleHierarchy()` / `renderPermissions()` / 新的 user activity capability panel
  - 若目前頁面因 capability 關閉而不可存取，需導回安全頁。
- `ApiService` 需提供：
  - `getRoleActivityCapabilities(roleKey)`
  - `getUserActivityCapabilities()`
  - `hasUserActivityCapability(code)`

#### capability 寫入與審計

權限管理 UI 啟閉 user 前台活動能力時，需新增獨立寫入路徑：

- `FirebaseService.saveRoleActivityCapabilities(roleKey, capabilities)`。
- 只允許 `super_admin` 寫入。
- 寫入時 sanitize capability code，拒絕未知 code。
- 建議寫入 `updatedAt`、`updatedBy`。
- 建議寫入 operation log，方便追蹤誰開關了一般 user 的活動能力。

### 4. 掃碼頁入口

目前 `page-scan` 特例只允許 coach+ 或 `_isAnyActiveEventDelegate()`，不包含活動 owner。

計劃調整：

- 新增 `_isAnyActiveEventOperator()`，但一般 `user` owner / delegate 必須同時具備 `user.activity.site_operate`。
- 有 preset event 時，判斷該活動是否為 owner / delegate / admin；一般 `user` 仍需 `user.activity.site_operate`，不可只因被委託就進入。
- `renderScanPage()` 改用 `_canOperateEventSite(e)` 過濾活動。
- `page-scan` 的 `_canAccessPage()` 特例也要套同一套 helper，避免 capability 關閉時仍能進頁面。

### 5. 拆分 `_canManageEvent(e)`

目前 `_canManageEvent(e)` 把 delegate 視為完整管理者，導致委託人可被多個 UI 區塊視為可編輯、取消或操作生命週期。

同時要補強 delegate 判斷來源。目前部分資料可能只有 `delegateUids`，而 `_isEventDelegate(e)` 主要看 `delegates` 陣列。實作時應讓 delegate 判斷同時支援：

- `e.delegates[].uid`
- `e.delegateUids[]`

前端與 Firestore rules 都應以同一語意判斷委託人，避免 UI 看不到、Rules 卻允許，或 UI 允許、Rules 卻拒絕。

計劃改為保留 `_canManageEvent(e)` 給舊相容，但逐步把重要操作改用更精準 helper：

```js
_canEditOwnActivityBasic(e) {
  return this.hasPermission('event.edit_all')
    || this.hasPermission('event.edit_self')
    || this.hasPermission('activity.manage.entry')
    || (this._isEventOwner(e) && this._hasUserActivityCapability?.('user.activity.own_edit_basic') === true);
}

_canCancelOwnActivity(e) {
  return this.hasPermission('event.edit_all')
    || this.hasPermission('activity.manage.entry')
    || (this._isEventOwner(e) && this._hasUserActivityCapability?.('user.activity.own_cancel') === true);
}

_canOperateEventSite(e) {
  return this.hasPermission('event.edit_all')
    || this.hasPermission('activity.manage.entry')
    || this.hasPermission('event.scan')
    || this.hasPermission('event.manual_checkin')
    || ((this._isEventOwner(e) || this._isEventDelegate(e))
      && this._hasUserActivityCapability?.('user.activity.site_operate') === true);
}

_canManageEventDelegates(e) {
  return this.hasPermission('event.edit_all')
    || this.hasPermission('activity.manage.entry')
    || (this._isEventOwner(e) && this._hasUserActivityCapability?.('user.activity.delegate_assign') === true);
}

_canManageTeamSplit(e) {
  return this.hasPermission('event.edit_all')
    || this.hasPermission('activity.manage.entry')
    || (this._isEventOwner(e)
      && this._hasUserActivityCapability?.('user.activity.addons_use') === true);
}

_canManageTeamOnlyVisibility(e) {
  if (!e?.teamOnly) return false;
  if (this.hasPermission('event.edit_all') || this.hasPermission('activity.manage.entry')) return true;
  if (this.hasPermission('team.toggle_event_visibility') && this._isEventOwnerOrTeamStaffForTeamOnly?.(e) === true) return true;
  return this._isEventOwner(e)
    && this._hasUserActivityCapability?.('user.activity.addons_use') === true
    && this._isEventOwnerOrTeamStaffForTeamOnly?.(e) === true;
}

_canViewEventOperationLog(e) {
  return this.hasPermission('event.edit_all')
    || this.hasPermission('activity.manage.entry')
    || (this._isEventOwner(e)
      && this._hasUserActivityCapability?.('user.activity.own_manage_entry') === true);
}
```

注意：coach+ / admin 的既有 permission code 應維持可用，不應被 user capability 關閉影響。
`_canManageTeamSplit(e)` 第一階段不把 delegate 視為可操作者；delegate 的現場權限限於簽到與候補，不含加值分隊管理。
`_canManageTeamOnlyVisibility(e)` 用於活動詳情頁公開切換，不能再直接把一般 owner 或 delegate 當成可切換者。
`_canViewEventOperationLog(e)` 用於活動詳情頁操作紀錄 / 報名異動紀錄；delegate 不因現場委託自動取得 sensitive log 權限。

### 6. 加值功能 UI gating

一般 `user` 不可開啟：

- `ce-fee-enabled`
- `ce-team-only`
- `ce-gender-restriction-enabled`
- `ce-private-event`
- `ce-team-split-enabled`

計劃：

- 在 modal 開啟時根據 `_canUseActivityAddons()` 設定加值區狀態。
- 一般 `user` 點擊加值開關時：
  - 立即將 checkbox 還原為 `false`。
  - 關閉相關欄位。
  - 顯示 Toast：`如需更多功能請聯繫官方Line@`。
- submit 時再次防護：
  - create：一般 `user` 加值欄位一律 sanitize 為關閉 / 空值。
  - update：一般 `user` 不可變更加值欄位；payload 應省略加值欄位或保留 existing event 原值，不可把既有加值欄位清成 false/null。
  - create sanitize 目標：
    - `feeEnabled: false`
    - `fee: 0`
    - `teamOnly: false`
    - `genderRestrictionEnabled: false`
    - `allowedGender: ''`
    - `privateEvent: false`
    - `teamSplitData: null`
- `teamSplit` 既有活動的後續操作也需 gating：
  - `_tsRenderBatchButtons()` 需改看 `_canManageTeamSplit(e)`，不可只看 `_canManageEvent(e)`。
  - `_tsBatchRandom()`、`_tsBatchFill()`、`_tsBatchReset()`、`_tsPickTeam()` 開頭都需 server / client 雙層檢查，不可只靠 UI 隱藏。
  - user / delegate 沒有 `user.activity.addons_use` 時，不得操作批次分隊、補齊、重置或替他人指定球衣；一般參與者在 self-select 模式選自己的 teamKey 另按既有自選規則處理。

### 7. 活動範本 gating

目前活動範本會從新增活動表單讀取並回填 `feeEnabled`、`fee`、`genderRestrictionEnabled`、`allowedGender`、`privateEvent` 等加值欄位。若只限制一般新增流程，仍可能被「套用範本」或「儲存範本」帶入加值設定。

計劃：

- 一般 `user` 儲存範本時，同步 sanitize 加值欄位。
- 一般 `user` 套用範本時，若範本含加值欄位：
  - 基本欄位照常套用。
  - 加值欄位一律 reset。
  - 顯示 Toast：`如需更多功能請聯繫官方Line@`。
- coach+ / admin 套用範本時保留既有行為。

## Firestore rules 計劃

前端限制不是安全邊界，必須補 rules。

### 0. 角色核心權限 helper

現有 `hasPerm()` 只讀 `rolePermissions/{role}`，不包含 `INHERENT_ROLE_PERMISSIONS`。因此 rules 內不能直接用 `hasPerm('activity.manage.entry')` 代表 coach / captain / venue_owner 的核心活動管理權。

計劃新增 helper：

```js
function hasActivityManageEntry() {
  return isCoachPlus() || hasPerm('activity.manage.entry');
}

function canUseActivityAddonsForRules(eventData) {
  return isAdmin()
    || hasPerm('event.edit_all')
    || hasActivityManageEntry()
    || (isAuth()
      && eventData.creatorUid == request.auth.uid
      && hasUserActivityCapability('user.activity.addons_use'));
}
```

後續 events、registrations、attendanceRecords、activityRecords、eventTemplates 只要需要判斷既有 coach+ 活動管理權，都應使用 `hasActivityManageEntry()`，不可只寫 `hasPerm('activity.manage.entry')`。

### 1. events create

目前 authenticated user 可建立 event，條件偏寬。計劃改成：

- admin / `event.edit_all` / `hasActivityManageEntry()`：可建立完整活動。
- `event.create`：只能建立非加值基本活動，不等同加值功能。
- 一般 user：只能建立 `creatorUid == request.auth.uid` 的基本活動。
- 基本活動 create 不得包含或不得啟用加值欄位：
  - `feeEnabled == false`
  - `fee == 0`
  - `teamOnly == false`
  - `genderRestrictionEnabled == false`
  - `allowedGender` empty / absent
  - `privateEvent == false`
  - `teamSplit` / `teamSplitData` absent / null

### 2. events update

目前 owner update 太寬，會讓一般 owner 直接寫入加值欄位。

計劃：

- owner 可以更新基本欄位、取消活動、委託人欄位、報名營運相關欄位。
- delegate 不可更新活動主資料的編輯欄位與生命週期欄位。
- delegate 只可透過 server-authoritative callable 進行允許的現場操作；不可直接更新活動主文件投影欄位。
- 加值欄位只能由 admin、`event.edit_all`、`hasActivityManageEntry()`，或 owner 且 `user.activity.addons_use` 開啟者更新。
- 一般 `user` owner 若 `user.activity.addons_use` 關閉，update 時必須保持加值欄位不變；rules 需用 `diff().affectedKeys()` 拒絕加值欄位變更，而不是要求它們變成 false/null。
- `delegateUids` / `delegates` 只能由 owner / admin 更新，並限制 shape 與最多 3 人。
- 一般 `user` owner 的 status update 第一階段只允許自己的活動 `status -> cancelled`。
- `open` / `full` / `upcoming` / `ended` 這類 canonical status 自動推進不可由任意前端直接寫入；前端只可做 derived status 顯示，server 端透過 callable / scheduled function / event trigger 寫回。
- 外部活動 edit 走獨立 basic allowlist；不可因 `type == external` 放寬為完整 event update。
- `isPublic` 屬 teamOnly 可見性控制，需拆成 teamOnly visibility allowlist；一般 user owner 需 `addons_use` 開啟且具有效 team / team staff 條件，delegate 不可寫。

### 2.5. derived status / canonical status 同步

目前多個前端路徑會直接呼叫 `ApiService.updateEvent(event.id, { status })`：

- `_syncEventEffectiveStatus()`
- `_autoEndExpiredEvents()`
- 報名 / 取消 guard 中的過期活動自動 `ended`

收斂 rules 後，這些 direct write 不能繼續由一般 client 執行。計劃調整：

- 前端顯示使用 `_getEventEffectiveStatus(e)` 或等價 derived status，不一定寫回 Firestore。
- `registerForEvent` / `cancelRegistration` / `manageEventRoster` callable 需自行判斷 effective status，不能信任 stale event.status。
- 若仍需要 canonical status 寫回，用 Cloud Functions：
  - callable：`syncEventEffectiveStatus(eventId)`，只由 owner / coach+ / admin 或 registration callable 內部呼叫。
  - 或 scheduled function：定期把過期活動標記為 ended、把 upcoming/open/full 同步。
  - 或 onWrite trigger：報名投影變更後重算 open/full。
- Firestore rules 對一般 authenticated user 不開放 `status` direct update；owner 只保留 `cancelled`，coach+ / admin 保留高階生命週期操作。

### 3. attendanceRecords

目前 root 與 subcollection attendanceRecords 的 create/update 對 authenticated user 過寬。

計劃：

- create / update attendance status 必須符合其中之一：
  - admin
  - event creator
  - event delegate
  - explicit attendance permission
- 若是一般 `user` 的 owner / delegate，還必須具備 `user.activity.site_operate`。
- 單純 authenticated user 不可替任意活動建立或更新 attendance。

### 4. waitlist promotion / demotion

目前 root 與 subcollection registration waitlist promotion 對 authenticated user 過寬。

計劃：

- 候補升正取必須改由 Cloud Functions callable 執行，callable 在 transaction 內更新 `registrations`、`activityRecords`、`events` 投影欄位。
- confirmed 退回候補 / 移除 confirmed 參與者同樣必須走 callable；第一階段一般 user owner / delegate 不可執行。
- Firestore rules 不應允許一般 client 直接做 manager waitlist / demotion / projection write。
- callable 允許者必須是：
  - admin
  - event creator
  - event delegate
  - explicit event management permission
- 若是一般 `user` 的 owner / delegate，還必須具備 `user.activity.site_operate`。
- 前端操作函式也要補 operation-level guard，不能只靠按鈕是否顯示。

### 4.5. teamSplit / teamKey manager writes

目前 root 與 subcollection registration 的 `teamKey` manager update 允許 owner / delegate 直接寫入，前端 `_tsBatchRandom()`、`_tsBatchFill()`、`_tsBatchReset()`、`_tsPickTeam()` 也會直接 batch update `registrations.teamKey`。因 `teamSplit` 已被列為加值功能，這條路徑必須另外收斂。

計劃：

- manager teamKey write 只能由 admin、`event.edit_all`、`hasActivityManageEntry()`，或 event owner 且 `user.activity.addons_use` 開啟者執行。
- delegate 第一階段不取得 teamSplit manager 操作權；delegate 只保留簽到與候補現場操作。
- 一般參與者在 `teamSplit.mode == 'self-select'` 時選擇自己的 teamKey，仍可走 self-select 規則，但不得替他人或批次操作。
- `isEventManagerTeamKeyUpdate()` / `isSubEventManagerTeamKeyUpdate()` 需拆成 manager add-on write 與 self-select write，不可再用 owner / delegate 通吃。
- Firestore rules tests 必須覆蓋：
  - user owner 且 `addons_use` 關閉時，manager teamKey write 被拒絕。
  - delegate 嘗試批次 teamKey write 被拒絕。
  - coach+ / admin 仍可操作 teamSplit。
  - self-select participant 只可改自己的 registration teamKey。

### 5. activityRecords

`activityRecords` 是報名、候補、取消與簽到統計的關鍵投影資料，必須與 `registrations`、`attendanceRecords` 同步收斂。

計劃：

- root `activityRecords` 不允許一般 authenticated user 建立或任意 status-only update。
- subcollection `events/{eventId}/activityRecords/{recId}` 也不可接受任意 authenticated status-only update。
- 自己報名 / 自己取消所需的 activity record 寫入應由 existing signup / cancel callable 或 owner-safe path 完成。
- 管理者移除、候補升正取、退回候補、容量變更造成的 activity record 更新必須由 callable 完成。
- 若保留 root legacy `activityRecords`，同樣必須有可驗證 `eventDocId`，否則只能讀取或由 admin / repair callable 處理。

### 6. eventTemplates

目前 `eventTemplates` 允許 owner 建立與更新自己的範本，但沒有區分一般 `user` 與可使用加值功能的角色。

計劃：

- 一般 `user` 建立活動範本時，不可保存加值欄位。
- 一般 `user` 更新既有範本時，不可新增、啟用、關閉或修改加值欄位；若既有範本有加值資料，需保留原值或由高權限者處理，不可誤清。
- coach+ / admin 可保存完整範本。
- 前端 sanitize 與 Firestore rules 需一致，避免範本成為加值功能的旁路。

### 7. root legacy registrations / attendanceRecords / activityRecords 策略

root `registrations/{regId}`、root `attendanceRecords/{recordId}` 與 root `activityRecords/{recordId}` 不能直接照 subcollection 的 manager 規則處理，因為 root 文件的 `eventId` 是活動資料內的邏輯 id，不是 Firestore doc id。Firestore rules 無法用 `where('id', '==', eventId)` 查回 event，所以不能可靠判斷該寫入者是否為活動 owner / delegate。

第一階段安全策略：

- 涉及活動管理者的 privileged writes，優先改走 Cloud Functions callable；若仍需 client 寫入，僅限 `events/{eventDocId}/...` subcollection 且 rules 能驗證 event doc。
- root `registrations` 僅保留不需要 event lookup 的安全操作，例如 owner 自己取消自己的報名、自己徽章欄位更新，或 admin 寫入。
- root `attendanceRecords` 不再允許一般 authenticated user 進行現場管理寫入；若需要保留 root 寫入，文件必須新增可驗證的 `eventDocId`，rules 以 `get(/events/{eventDocId})` 驗證 owner / delegate。
- root `activityRecords` 不再允許一般 authenticated user 進行管理狀態寫入；若需要保留 root 寫入，也必須新增可驗證的 `eventDocId`。
- root waitlist promotion 不可再只靠 `isAuth()` 放行；若沒有 `eventDocId`，應拒絕 manager promotion，改由 subcollection 或 callable 執行。
- 需先用 `rg` 確認目前 active client code 是否仍寫 root `registrations` / `attendanceRecords` / `activityRecords`。若仍有活動管理寫入走 root，必須先重構寫入路徑，再收斂 rules。

第二階段可選遷移：

- 對 legacy root 文件補寫 `eventDocId`，來源為 `events` 中 `id == root.eventId` 的 doc id。
- 補完後 root rules 才可加入 `eventDocId` 驗證，但仍建議新功能只走 subcollection。
- migration 需有乾跑模式、統計筆數、失敗清單與 operation log。

### 8. Firestore rules deploy gate

Rules 實作完成後，部署前必須通過以下 gate：

- `roleActivityCapabilities/user` 缺文件時，rules 與前端的預設能力一致。
- `hasPerm()` 仍排除 `user`，沒有把一般 user 混入後台 permission-code。
- 所有 owner / delegate manager writes 都能明確取得 `events/{docId}`。
- root legacy path 沒有留下 `isAuth()` 即可進行 attendance / waitlist / activityRecords privileged write 的路徑。
- rules tests 覆蓋 subcollection 與 root legacy 拒絕案例。
- rules tests 必須覆蓋 coach+ inherent role 在 `rolePermissions` 文件缺少 `activity.manage.entry` 時仍可通過 `hasActivityManageEntry()` 的情境。

## Cloud Functions callable 計劃

Cloud Functions 使用 Admin SDK，Firestore rules 不會保護它的寫入。因此所有與活動管理有關的 callable 必須視為獨立安全邊界。

### 1. 新增 Functions 端 capability helper

在 `functions/index.js` 新增與前端 / rules 對齊的 helper：

- `getRoleActivityCapabilitiesFromFirestore(roleKey)`
- `getDefaultRoleActivityCapabilities(roleKey)`
- `buildUserActivityAccess(uid)`
- `hasUserActivityCapability(uid, code)` 或在 access object 內提供 `hasActivityCapability(code)`

要求：

- `user` 缺少 `roleActivityCapabilities/user` 文件時，套用同一份內建預設。
- `user.activity.addons_use` 預設關閉。
- 不得讓 `access.hasPermission()` 開始對 `user` 回傳後台 permission-code。
- Functions、frontend、rules 的 capability code 清單必須一致；新增 code 時需同步測試。

### 2. `cancelRegistration` 權限矩陣

目前 `cancelRegistration` 的 `manager_remove` / `capacity_change` 只檢查 creator、`delegates[].uid`、admin。需改成以下矩陣：

| reason | 允許者 | 拒絕者 | 備註 |
| --- | --- | --- | --- |
| `user_cancel` | registration owner 本人 | 非本人 | 維持現有邏輯 |
| `manager_remove`：移除 confirmed 參與者 | admin / `event.edit_all` / `hasActivityManageEntry()` | 任意登入者、一般 user owner、delegate | 第一階段不把 confirmed 參與者破壞性管理下放給 owner-scope user |
| `manager_remove`：移除 waitlisted 候補者 | admin / `event.edit_all` / `hasActivityManageEntry()` / 活動 owner 或 delegate 且具 `user.activity.site_operate` | 任意登入者、未具 capability 者 | 屬現場候補管理範圍 |
| `capacity_change` | admin / `event.edit_all` / `hasActivityManageEntry()` / 活動 owner 且具 `user.activity.own_edit_basic` | delegate、任意登入者 | 一般 user owner 的 capacity change 不可造成 confirmed 參與者被移除或退回 |

同時要補：

- delegate 判斷支援 `delegates[].uid` 與 `delegateUids[]`。
- `manager_remove` 必須依 target registration 狀態分流，不能把 waitlist 操作權限擴大成移除所有參與者。
- callable 回傳錯誤需保留一致的 `permission-denied`，前端再顯示可理解訊息。

### 3. `manageEventRoster` / waitlist callable

候補升正取、confirmed 退回候補、容量變更遞補、管理者移除參與者，都會同時牽動 `registrations`、`activityRecords` 與 `events` 投影欄位。這些操作必須集中到 server-authoritative callable。

建議新增或重構為一個 callable，例如 `manageEventRoster`，輸入包含：

```js
{
  eventId,
  action: 'promote_waitlisted' | 'demote_confirmed' | 'manager_remove' | 'capacity_change',
  registrationIds,
  requestId
}
```

要求：

- callable 以 `events.id == eventId` 查出 event doc，並在 transaction 內讀取 / 寫入該 event 的 subcollections。
- callable 在同一 transaction 內重建 occupancy，更新 `current`、`realCurrent`、`waitlist`、`participants`、`waitlistNames`、`participantsWithUid`、`waitlistWithUid`、`teamReservationSummaries`、`schemaVersion`、`status`。
- 前端 `_forcePromoteWaitlist()`、`_forceDemoteToWaitlist()`、`_adjustWaitlistOnCapacityChange()`、`_removeParticipant()` 不再自行組 batch 寫入這些欄位，只呼叫 callable 並依回傳結果刷新快取。
- `promote_waitlisted`：owner / delegate / admin / `hasActivityManageEntry` 可執行；一般 user owner / delegate 需 `user.activity.site_operate`。
- `demote_confirmed`：只允許 admin / `event.edit_all` / `hasActivityManageEntry`；一般 user owner / delegate 第一階段不可執行。
- `manager_remove`：waitlisted 可由 owner / delegate 執行；confirmed 只允許 admin / `event.edit_all` / `hasActivityManageEntry`。
- `capacity_change`：delegate 不可執行；owner / admin / `hasActivityManageEntry` 可執行；一般 user owner 需 `user.activity.own_edit_basic`，且不得造成 confirmed 參與者被移除或退回。
- callable 必須寫 operation log，並保留通知升補 / 移除用戶的行為。

### 4. 其他活動管理 callable 審計

實作前需搜尋並審計所有會改動活動、報名、候補、簽到、隊伍保留的 callable：

- `registerForEvent`
- `cancelRegistration`
- `adjustTeamReservation`
- attendance / check-in 相關 callable
- tournament / activity 共用 helper 若會寫 event registrations 或 attendance

原則：

- 自己報名 / 自己取消：只檢查本人。
- 活動管理者操作：必須檢查 admin / existing permission / owner / delegate / capability。
- 隊伍保留：維持 team staff / admin 邏輯，不因一般 user 活動能力而繞過 team staff requirement。
- registration / cancellation callable 必須自行判斷 effective status，不能信任前端寫回的 event.status。
- callable 寫入 root legacy path 時，必須先確認該 path 不需要 rules 做 event lookup，或改走 subcollection。

### 5. callable 測試要求

需補 callable-level tests，不能只補 Firestore rules tests：

- 任意 authenticated user 直接呼叫 `cancelRegistration({ reason: 'manager_remove' })` 應失敗。
- 活動 owner 且 `user.activity.site_operate` 開啟時，可移除 waitlisted 候補者。
- 活動 owner 且 `user.activity.site_operate` 關閉時，manager remove 應失敗。
- delegate 在 `delegateUids[]` 內時，可執行 waitlist 現場操作。
- 一般 user owner 不可移除 confirmed 參與者、不可執行 `demote_confirmed`。
- delegate 不可移除 confirmed 參與者、不可觸發 `capacity_change`。
- delegate 不可執行 `demote_confirmed`。
- `manageEventRoster` 必須測投影欄位由 server transaction 一次重建，不接受 client 傳入投影結果。
- `delegates[].uid` 與 `delegateUids[]` 任一資料型態都能被 callable 正確辨識。
- `registerForEvent` / `cancelRegistration` 在 event.status stale 時仍用 effective status 正確拒絕已過期活動。

## 實作分期

### Phase 1：權限 helper 與入口拆分

- 新增基本活動 / 外部活動 / 現場營運 / 加值功能 helper。
- 新增 external edit helper 與 teamOnly visibility helper。
- 調整建立活動入口。
- 調整 `page-my-activities` 與 `page-scan` access rule。
- `rg "_canManageEvent"` 盤點所有 call-site，先分類成寫入操作、管理 UI、sensitive read、純 visibility。
- 保留既有 coach+ / admin 行為。

### Phase 2：活動管理 UI 行為

- 活動列表按鈕改用精準 helper：
  - 編輯：owner / admin。
  - 取消：owner / admin。
  - 重新開放 / 重新上架：coach+ / admin。
  - 現場簽到、名單、候補：owner / delegate / admin。
- 委託人不可看到或執行活動編輯、取消、委託人設定。
- 外部活動編輯改用 `_canEditExternalActivity(e)`，一般 user owner 需 `own_edit_basic`。
- 活動詳情頁公開切換改用 `_canManageTeamOnlyVisibility(e)`。
- 活動詳情頁掃碼 / 手動簽到 / 候補入口改用 `_canOperateEventSite(e)`。
- 活動詳情頁操作紀錄 / 報名異動紀錄改用 `_canViewEventOperationLog(e)`，delegate 第一階段不可看 sensitive log。
- 活動狀態顯示改用 derived status；移除一般 client 的 `ApiService.updateEvent(... status ...)` 自動寫回。

### Phase 3：加值功能限制

- 一般 `user` 開啟加值 switch 時 Toast 並 reset。
- create submit 前 sanitize 加值欄位。
- update submit 時一般 `user` 不可變更加值欄位，必須保留 existing event 原值或省略欄位，不可把既有加值資料清空。
- edit modal 載入既有活動時，一般 `user` 不可新增、啟用、關閉或修改加值欄位。
- teamSplit 後續操作同步限制：
  - `_tsRenderBatchButtons()` 改用 `_canManageTeamSplit(e)`。
  - `_tsBatchRandom()`、`_tsBatchFill()`、`_tsBatchReset()`、`_tsPickTeam()` 加 operation guard。
  - delegate 第一階段不可做 teamSplit manager 操作。
  - teamOnly `isPublic` toggle 受 teamOnly visibility helper 控制，不能由一般 owner 無條件切換。

### Phase 4：Cloud Functions roster callable

- 新增 / 重構 `manageEventRoster` 類 callable，集中處理：
  - waitlisted -> confirmed
  - confirmed -> waitlisted
  - manager remove
  - capacity change
- 前端 waitlist / roster / capacity 操作移除 client batch 寫入，改呼叫 callable。
- callable transaction 內同步更新 `registrations`、`activityRecords`、`events` 投影欄位。
- callable 內套用 owner / delegate / admin / `hasActivityManageEntry` / `roleActivityCapabilities` 權限矩陣。
- 關閉或移除 manager 操作的 client batch fallback；舊 feature flag 不可讓 manager path 回到 direct write。
- 盤點 self signup / self cancel direct write fallback；新報名 / 取消優先走 callable，若保留 direct write 只能保留本人窄 allowlist 並補 rules tests。

### Phase 4.5：活動狀態同步改 server-authoritative

- 前端 `_syncEventEffectiveStatus()` / `_autoEndExpiredEvents()` 改為只回傳 derived status，不直接寫 Firestore。
- registration / cancellation / roster callable 內部重算 effective status，避免 stale status 造成報名或取消錯判。
- 若需要 Firestore canonical status 回寫，新增 `syncEventEffectiveStatus` callable、scheduled function 或 trigger。
- Rules 只允許 owner `status -> cancelled`；`ended` / `open` / `full` / `upcoming` 的自動轉換由 server 寫。

### Phase 5：Firestore rules 安全補強

- 補 event basic create / owner update allowlist。
- 補加值欄位 rules。
- 補 external event edit allowlist。
- 補 teamOnly `isPublic` visibility toggle rules。
- 補 canonical status update rules：一般 client 不可直接推進 `open/full/upcoming/ended`。
- 補 delegateUids shape / max 3。
- 補 attendanceRecords manager-only write。
- 補 waitlist / roster client direct write deny rules，管理操作改由 callable 執行。
- 補 `registrations.displayBadges`-only 規則或 callable 遷移；不可和 waitlist / roster manager writes 混用。
- 補 teamSplit manager `teamKey` write rules；owner / delegate 不可再共用 `_canManageEvent(e)` 語意直接批次分隊。
- 補 activityRecords root / subcollection 收斂規則。
- 補 `roleActivityCapabilities/{roleKey}` read/write rules 與 schema validation。
- 補 `hasUserActivityCapability(cap)` helper，並明確處理 capability 文件不存在時的內建預設。
- 補 `hasActivityManageEntry()` helper，避免 rules 忽略 coach/captain/venue_owner 的 inherent `activity.manage.entry`。
- 補 root legacy `registrations` / `attendanceRecords` 收斂策略：
  - 若 root 文件沒有可驗證 `eventDocId`，不得允許 manager waitlist / attendance / activityRecords privileged write。
  - 新活動管理寫入優先改走 `events/{eventDocId}/...` subcollection。
  - 保留 root owner self-cancel / badge-only 等不需要 event lookup 的安全操作。
- 補 admin repair / migration 工具寫入策略：
  - `data-sync`、`registration-audit`、achievement repair、manual repair 類 direct writes 必須限 super_admin / admin-only，或改由 maintenance callable 執行。
  - 不可因保留維修工具而重新放寬一般 authenticated / owner / delegate 對 roster 投影的直接寫入。
- 補 user capability 對應 rules：
  - `user.activity.basic_create` 控制一般基本活動 create。
  - `user.activity.external_create` 控制外部活動 create。
  - `user.activity.own_edit_basic` 控制 owner 基本欄位 update。
  - `user.activity.own_cancel` 控制 owner 取消活動。
  - `user.activity.site_operate` 控制 owner / delegate attendance 與 waitlist 操作。
  - `user.activity.delegate_assign` 控制 owner 新增 / 移除委託人。
  - `user.activity.addons_use` 控制一般 user 是否可寫入加值欄位。
  - teamSplit manager write 只接受 admin / coach+ / owner 且 `user.activity.addons_use`；participant self-select 另走自己的 registration owner 規則。
  - teamOnly `isPublic` write 只接受 admin / coach+ / team visibility permission，或 owner 且 `addons_use` 開啟並具有效 team staff 條件。

### Phase 6：其他 Cloud Functions callable 安全補強

- 新增 Functions 端 `roleActivityCapabilities` helper，與前端 / rules 預設值一致。
- 調整 `cancelRegistration`：
  - `user_cancel` 維持本人取消。
  - `manager_remove` 依 target registration 狀態區分 confirmed / waitlisted。
  - confirmed 參與者移除 / 退回第一階段只允許 admin / `event.edit_all` / coach+ 活動管理者，不開放一般 user owner / delegate。
  - `capacity_change` 不允許 delegate 執行。
  - 一般 user owner 的 `capacity_change` 不可造成 confirmed 參與者被移除或退回。
  - delegate 判斷同時支援 `delegates[].uid` 與 `delegateUids[]`。
- 審計其他會用 Admin SDK 寫入活動管理資料的 callable，避免 rules 已收斂但 callable 留下旁路。
- 補 callable tests。

### Phase 7：測試與驗收

- 補 unit tests：
  - `user` 可建立基本活動。
  - `user` 不具有 `activity.manage.entry`。
  - owner 可進活動管理頁並只看到自己活動。
  - delegate 可進被委託活動現場操作，但不可取消或編輯。
  - owner 可編輯自己的 external activity；delegate 不可編輯 external activity。
  - owner 且 `user.activity.site_operate` 開啟時可進 scan page。
  - owner 且 `user.activity.site_operate` 關閉時不可進 scan page。
  - delegate 且 `user.activity.site_operate` 開啟時可進 scan page。
  - delegate 且 `user.activity.site_operate` 關閉時不可進 scan page。
  - detail page 掃碼 / 候補入口走 `_canOperateEventSite(e)`，operation log 走 `_canViewEventOperationLog(e)`。
  - delegate 不可看 operation log；一般 user owner 可在 `own_manage_entry` 開啟時看自己活動 operation log。
  - 一般 `user` 加值開關會 Toast 並 reset。
  - delegate 不可看到 / 執行 teamSplit 批次分隊或指定他人球衣。
  - 一般 user owner 沒有 `addons_use` 時不可切換 teamOnly `isPublic`。
  - derived status 顯示不會呼叫 Firestore update。
- 補 Firestore rules tests：
  - 一般 `user` 可 create basic event。
  - 一般 `user` create event with add-ons 被拒絕。
  - owner update add-ons 被拒絕。
  - owner update external basic fields 成功，但 external edit 寫入加值欄位失敗。
  - owner cancel 被允許。
  - owner direct status update to `ended` / `open` / `full` / `upcoming` 被拒絕。
  - delegate cancel 被拒絕。
  - owner / delegate 且 `user.activity.site_operate` 開啟時，attendance update 被允許。
  - owner / delegate 且 `user.activity.site_operate` 關閉時，attendance update 被拒絕。
  - 任意 authenticated user attendance update 被拒絕。
  - owner / delegate 直接 client waitlist promotion 被拒絕，即使 `user.activity.site_operate` 開啟也必須走 callable。
  - 任意 authenticated user waitlist promotion 被拒絕。
  - callable 測試另外覆蓋 owner / delegate 且 `user.activity.site_operate` 開啟時，`promote_waitlisted` 被允許。
  - `displayBadges`-only update 僅 admin / `event.edit_all` 或 badge callable 可執行，一般 user owner / delegate 被拒絕。
  - user owner 且 `user.activity.addons_use` 關閉時，teamSplit manager teamKey write 被拒絕。
  - delegate teamSplit manager teamKey write 被拒絕。
  - user owner 且 `addons_use` 關閉時，teamOnly `isPublic` write 被拒絕。
  - participant self-select 只能改自己的 registration teamKey。
  - root legacy registration / attendance / activityRecords privileged write 被拒絕，除非有可驗證 `eventDocId` 且符合 owner / delegate / admin。
  - 若保留 self signup / self cancel direct write，rules tests 覆蓋只能操作本人 registration / activity record，不能改他人、不能寫 roster 投影、不能做 waitlist manager promotion。
  - coach+ 在 `rolePermissions` 文件缺少 `activity.manage.entry` 時，rules 仍透過 `hasActivityManageEntry()` 保留核心活動管理權。
- 補 callable tests：
  - 任意 authenticated user 直接呼叫 manager remove 被拒絕。
  - owner / delegate 的 waitlist 操作依 `user.activity.site_operate` 開關通過或拒絕。
  - 一般 user owner / delegate 不可移除 confirmed 參與者、退回 confirmed；delegate 也不可執行 `capacity_change`。
  - `manageEventRoster` 不接受 client 提供的 occupancy 投影，必須自行重建。
  - registration / cancellation callable 在 stale event.status 下仍以 effective status 正確拒絕過期活動。

### Phase 8：文件同步與規則說明更新

完成實作與測試後，必須同步更新專案內架構文件與規則說明，避免未來維護者只看到舊的 `rolePermissions` 權限模型，誤以為一般 `user` 仍完全沒有任何可配置的活動能力。

必更新項目：

1. `docs/architecture.md`
   - 更新「權限架構」章節，補上兩套權限模型：
     - 既有 `rolePermissions`：後台 / 管理功能權限。
     - 新增 `roleActivityCapabilities`：一般 `user` 前台活動能力。
   - 更新 Firestore collections 表，加入 `roleActivityCapabilities/{roleKey}`。
   - 更新「Firestore Rules 邊界」，說明 `hasPerm()` 仍排除 `user`，user 活動能力改走 `hasUserActivityCapability()` 類 helper。
   - 更新「Cloud Functions 安全邊界」，說明 callable 使用 Admin SDK，需自行檢查 `roleActivityCapabilities`，不能只靠 Firestore rules。
   - 更新 root legacy `registrations` / `attendanceRecords` / `activityRecords` 策略，標註 manager writes 優先走 callable。
   - 更新 roster / waitlist 架構，說明 `registrations`、`activityRecords`、`events` 投影欄位由 server-authoritative callable 重建。
   - 更新活動管理 / 掃碼 / 候補相關架構描述，明確區分 owner、delegate、coach+、admin。
   - 更新 teamSplit 架構，說明建立 / 編輯 `teamSplit` 與後續 manager `teamKey` 操作都屬於加值管理；participant self-select 另屬個人報名操作。

2. `docs/structure-guide.md`
   - 更新功能導覽，讓「權限管理」下可以看到 `user` 的前台活動能力開關區。
   - 更新「活動」相關功能說明，補上一般 user 可建立基本活動、外部活動、掃碼、候補與委託人。
   - 標註委託人現場權限不包含 teamSplit 批次分隊 / 補齊 / 重置 / 替他人指定 teamKey。

3. `CLAUDE.md`
   - 若本次實作新增 `roleActivityCapabilities` 或新增 Firestore rules helper，需在「權限系統同步維護」或「Firestore Rules 修改規則」補充維護規則。
   - 若架構章節的目錄、模組數量、資料集合或永久地雷有變更，需同步更新 `CLAUDE.md` 的目錄結構概覽。

4. `docs/test-coverage.md`
   - 實際新增測試後，更新 unit / rules / e2e 測試覆蓋項目與測試數量。
   - 補上 user 前台活動 capability、加值功能拒絕、owner/delegate rules、Cloud Functions callable、roster projection callable、activityRecords、root legacy、teamSplit manager teamKey 拒絕案例的測試說明。

5. `docs/permission-panel-layout.md` 或對應權限管理說明文件
   - 若新增 `user` 前台活動能力開關 UI，需補上該區塊與既有後台 permission toggle 的差異。
   - 明確寫出 `user` 後台權限數量仍為 0，但前台活動能力可由 super_admin 在獨立區塊啟閉。

6. `firestore.rules` 註解
   - 新增 `roleActivityCapabilities` match 與 helper 時，需在 rules 內加短註解說明它是 user 前台活動能力，不是後台 `hasPerm()`。
   - 新增 `hasActivityManageEntry()` helper 時，需註明它用來補足 `hasPerm()` 不含 inherent role permissions 的差異。
   - 在 events、attendanceRecords、activityRecords、registrations waitlist promotion、eventTemplates 相關 allow rule 附近補足 owner / delegate / user capability 邊界說明。
   - 在 registration `teamKey` manager write rule 附近註明 teamSplit manager 操作屬於加值管理，與 participant self-select 不同。
   - 在 root legacy `registrations` / `attendanceRecords` / `activityRecords` 附近註明 `eventId` 不是 Firestore event doc id，不能用來做 manager lookup。

7. `js/modules/user-admin/user-admin-perm-info.js` 或 capability 說明來源
   - 若前台活動 capability 開關旁有說明按鈕，需補上每個 capability 的白話用途與影響範圍。
   - 特別標註 `user.activity.addons_use` 預設關閉，以及關閉時會顯示 `如需更多功能請聯繫官方Line@`。

8. `functions/index.js` 權限註解
   - 在 activity callable helper 與 `cancelRegistration` 權限矩陣附近補短註解，說明 callable 會繞過 Firestore rules，因此必須自行套用 owner / delegate / capability 檢查。
   - 註明 delegate 判斷需同時支援 `delegates[].uid` 與 `delegateUids[]`。
   - 在 `manageEventRoster` 或同等 roster callable 附近註明投影欄位只能由 server transaction 重建，前端不可傳入可信 occupancy 結果。

文件同步驗收標準：

1. 架構文件能清楚說明 `rolePermissions` 與 `roleActivityCapabilities` 的責任差異。
2. Firestore rules 註解能讓維護者看出 `hasPerm()` 不處理 `user`，user 活動能力走獨立 helper。
3. 權限管理文件能說明為什麼 `user` 後台權限數量仍為 0，但仍有前台活動能力開關。
4. 測試覆蓋文件與實際新增測試一致。
5. Cloud Functions 相關文件能說明 callable 權限不受 Firestore rules 保護，並列出 `cancelRegistration` 權限矩陣。
6. 文件能說明 waitlist / roster / activityRecords 的投影寫入改由 callable 負責，client batch 不再是安全設計的一部分。
7. 文件能說明 teamSplit manager 操作屬於加值管理，delegate 現場權限不包含批次分隊或替他人指定 teamKey。

## 關鍵修改項目對照

| 核心判斷 | 需要修改的方向 | 驗證方式 |
| --- | --- | --- |
| 不能直接把 `activity.manage.entry` 或 `event.create` 下放給一般 `user` | 保持 `user` 預設 permission-code 為空，不改 `INHERENT_ROLE_PERMISSIONS.user`，新增 owner-scope helper 來處理基本活動能力 | 檢查 `js/config.js`、`js/api-service.js`、`functions/index.js`，確認 `user` 仍沒有既有活動管理權 |
| 一般 `user` 應是「基本活動主辦人」，不是完整活動管理者 | 新增 `_canCreateBasicActivity()`、`_canCreateExternalActivity()`、`_canEditOwnActivityBasic(e)`、`_canCancelOwnActivity(e)`、`_canManageEventDelegates(e)` | unit tests 覆蓋 user owner 可以建立 / 編輯基本資料 / 取消自己活動，但不能取得完整管理權 |
| `_canManageEvent(e)` 目前對委託人過寬 | 將編輯、取消、重新開放、委託人設定、現場操作拆成不同 helper，不再讓 delegate 共用完整管理判斷 | unit tests 覆蓋 delegate 可掃碼 / 候補，但不可編輯 / 取消 / 設定委託人 |
| `own_manage_entry` 必須控制活動管理入口 | `page-my-activities` 改走 `_canAccessOwnActivityManageEntry()`，不能只對所有登入 user 開放 | unit / UI tests 覆蓋 capability 關閉時 user owner / delegate 也不能進活動管理頁 |
| `event.create` 不等於加值功能 | `_canUseActivityAddons()` 獨立判斷加值；`event.create` 只允許基本建立 | unit / rules tests 覆蓋有 `event.create` 但無 add-ons 能力時仍不可寫加值欄位 |
| Firestore rules 需補 inherent role helper | 新增 `hasActivityManageEntry()`，合併 `isCoachPlus()` 與 `hasPerm('activity.manage.entry')` | rules tests 覆蓋 coach+ 即使 rolePermissions 文件沒有該 code 仍保留核心活動管理權 |
| Firestore authenticated write rules 目前過寬 | 收斂 `events`、`attendanceRecords`、`activityRecords`、`registrations`、`eventTemplates` 的 create/update 條件 | Firestore rules tests 覆蓋 owner/delegate/admin 可寫與任意 authenticated user 被拒絕 |
| Cloud Functions callable 會繞過 Firestore rules | 在 Functions 端新增相同 capability helper，並調整 `cancelRegistration` 等活動管理 callable | callable tests 覆蓋直接呼叫 `manager_remove` / `capacity_change` 的允許與拒絕案例 |
| root legacy path 不能可靠驗證 event manager | root `eventId` 不是 Firestore doc id，manager writes 改走 subcollection / callable 或補 `eventDocId` 遷移 | rules tests 覆蓋 root path 拒絕、subcollection path 允許 |
| waitlist / roster 投影不能由 client batch 決定 | 新增 server-authoritative roster callable，transaction 內更新 registrations / activityRecords / events 投影 | callable tests 驗證 client 不傳 occupancy，server 自行重建投影 |
| 加值功能不能只靠前端 Toast | 前端開關 reset + create sanitize + update preserve/deny + template preserve/deny + Firestore add-on deny rules | UI tests / manual QA 驗證 Toast；rules tests 驗證直接寫入加值欄位被拒絕且 update 不誤清既有加值欄位 |
| teamSplit 後續操作也是加值功能 | `_tsBatchRandom()` / `_tsBatchFill()` / `_tsBatchReset()` / `_tsPickTeam()` 改走 `_canManageTeamSplit(e)`，rules 收斂 manager `teamKey` writes | unit / rules tests 覆蓋 delegate 與 `addons_use` 關閉的 user owner 不可批次分隊；self-select participant 仍只能改自己 |
| 權限管理需避免誤導 | `user` 的 owner-scope 基本活動能力不進既有後台 permission toggle；在 `user` 層級新增獨立「前台活動能力」開關區 | UI / unit tests 確認 `user` 後台權限數量仍為 0，前台活動能力開關可見且可由 super_admin 啟閉 |

## 自我測試計劃

### 1. 靜態審計

每次實作後先用程式碼搜尋確認以下條件：

1. `user` 沒有被加入 `INHERENT_ROLE_PERMISSIONS`。
2. `getDefaultRolePermissions('user')` 仍不回傳 `activity.manage.entry`、`event.create`、`event.edit_self`。
3. `functions/index.js` 與 `js/config.js` 的 `INHERENT_ROLE_PERMISSIONS` 仍同步。
4. 建立活動、外部活動、活動管理頁、掃碼頁都有走新的 owner-scope helper。
5. `page-my-activities` 有套用 `user.activity.own_manage_entry`，且 capability 關閉時不開放一般 user owner / delegate 入口。
6. 加值欄位 `feeEnabled`、`teamOnly`、`genderRestrictionEnabled`、`privateEvent`、`teamSplit` 在 create/edit/template 三條路徑都被限制；create 歸零，update 保留原值且禁止變更。
7. 權限管理中 `user` 的後台權限數量仍為 0，但可看到獨立的「前台活動能力」開關區。
8. `functions/index.js` 內所有活動管理 callable 不只檢查 creator / delegate，也檢查 `roleActivityCapabilities` 或既有 permission。
9. callable delegate 判斷同時支援 `delegates[].uid` 與 `delegateUids[]`。
10. root `registrations` / `attendanceRecords` / `activityRecords` 沒有留下單純 `isAuth()` 即可做 privileged write 的規則。
11. waitlist / roster / capacity 相關前端函式沒有直接 batch 更新 `registrations`、`activityRecords`、`events` 投影欄位，而是呼叫 callable。
12. Firestore rules 中活動管理判斷使用 `hasActivityManageEntry()` 或等價 helper，不只使用 `hasPerm('activity.manage.entry')`。
13. teamSplit manager 操作沒有直接用 `_canManageEvent(e)`，且 `teamKey` manager writes 不允許 delegate 或 `addons_use` 關閉的一般 user owner。

### 2. 前端單元 / pure logic 測試

至少覆蓋：

1. 一般 `user` 可建立基本活動，但沒有 `activity.manage.entry`。
2. 一般 `user` owner 可看自己的活動管理列表。
3. 一般 `user` owner 可取消自己的活動。
4. 一般 `user` owner 在 `user.activity.site_operate` 開啟時可進入自己的 scan page，關閉時不可進入。
5. delegate 在 `user.activity.site_operate` 開啟時可進入被委託活動 scan page，關閉時不可進入。
6. delegate 可將候補升為正取與操作簽到。
7. delegate 不可編輯活動、取消活動、設定委託人。
8. 一般 user owner / delegate 不可移除 confirmed 參與者、不可把 confirmed 退回候補；delegate 不可執行 capacity change。
9. delegate 不可操作 teamSplit 批次分隊、補齊、重置或替他人指定 teamKey。
10. 一般 user owner 可編輯自己的 external activity 基本欄位；delegate 不可編輯 external activity。
11. derived status 顯示不觸發 Firestore status write。
12. coach+ 既有活動建立與加值功能不回歸。
13. admin / `event.edit_all` 仍可管理全部活動。

### 3. Firestore rules 測試

至少覆蓋：

1. 一般 `user` create basic event 成功。
2. 一般 `user` create event with add-ons 失敗。
3. 一般 `user` owner update add-ons 失敗。
4. owner update external basic fields 成功，但 external edit 寫入加值欄位失敗。
5. owner cancel event 成功。
6. owner direct status update to `ended` / `open` / `full` / `upcoming` 被拒絕。
7. delegate cancel event 失敗。
8. owner / delegate 且 `user.activity.site_operate` 開啟時，update attendance status 成功。
9. owner / delegate 且 `user.activity.site_operate` 關閉時，update attendance status 失敗。
10. 任意 authenticated user update attendance status 失敗。
11. owner / delegate 直接 client waitlist promotion 失敗，即使 `user.activity.site_operate` 開啟也必須走 callable。
12. 任意 authenticated user waitlist promotion 失敗。
13. callable 測試另外覆蓋 owner / delegate 且 `user.activity.site_operate` 開啟時，`promote_waitlisted` 成功。
14. 一般 `user` 儲存 / 更新含加值欄位的 event template 失敗。
15. 一般 `user` 更新既有含加值欄位的 event / template 時，不可變更加值欄位，也不可把既有加值欄位清空。
16. user owner 且 `user.activity.addons_use` 關閉時，teamSplit manager teamKey write 失敗。
17. delegate teamSplit manager teamKey write 失敗。
18. user owner 且 `addons_use` 關閉時，teamOnly `isPublic` write 被拒絕。
19. participant self-select 只能改自己的 registration teamKey。
20. root legacy waitlist promotion 在沒有可驗證 `eventDocId` 時失敗。
21. root legacy attendance / activityRecords status update 不允許任意 authenticated user 操作。
22. coach+ 在 `rolePermissions` 文件沒有 `activity.manage.entry` 時仍可通過 `hasActivityManageEntry()` 的必要活動管理規則。

### 4. Cloud Functions callable 測試

至少覆蓋：

1. `cancelRegistration` 的 `user_cancel` 只能取消自己的報名。
2. 任意 authenticated user 呼叫 `manager_remove` 失敗。
3. owner 且 `user.activity.site_operate` 開啟時，可移除 waitlisted 候補者。
4. owner 且 `user.activity.site_operate` 關閉時，移除 waitlisted 候補者失敗。
5. owner / delegate 且 `user.activity.site_operate` 開啟時，`promote_waitlisted` 成功。
6. owner / delegate 且 `user.activity.site_operate` 關閉時，`promote_waitlisted` 失敗。
7. 一般 user owner / delegate 不可移除 confirmed 參與者或執行 `demote_confirmed`。
8. delegate 不可執行 `capacity_change`；一般 user owner 的 `capacity_change` 不可造成 confirmed 參與者被移除或退回。
9. `delegates[].uid` 與 `delegateUids[]` 兩種資料型態都能被 callable 正確辨識。
10. `manageEventRoster` / 等價 callable 會自行重建 occupancy，不接受 client 傳入的投影結果。
11. registration / cancellation callable 在 stale event.status 下仍以 effective status 正確拒絕過期活動。
12. 前端直接嘗試 client batch 更新 waitlist / roster 投影欄位時，rules 會拒絕。

### 5. 手動驗收

使用實際登入狀態驗收：

1. 一般 `user` 開新增活動 modal，能送出基本活動。
2. 一般 `user` 開啟任一加值開關，開關立即 reset 並顯示 `如需更多功能請聯繫官方Line@`。
3. 一般 `user` 建立外部活動連結成功。
4. 一般 `user` 在活動管理頁只看到自己活動。
5. owner 可設定最多 3 位委託人。
6. `user.activity.site_operate` 關閉時，owner / delegate 不能進掃碼頁或做現場操作。
7. delegate 登入後只能看到被委託活動，且只能做現場操作與 waitlisted 升正取。
8. 一般 user owner / delegate 嘗試退回 / 移除 confirmed 參與者時會被前端與 callable 拒絕。
9. delegate 看不到也不能執行 teamSplit 批次分隊、補齊、重置或指定他人 teamKey。
10. coach+ 登入後原本的加值功能仍可正常使用。

## 自動化測試覆蓋升級項目

本次權限調整不可只靠手動驗收。實作時需同步新增 / 擴充自動化測試，讓「一般 user 基本建立活動」與「加值功能限制」成為回歸保護。

| 測試層 | 建議新增 / 擴充位置 | 必測覆蓋項目 | 執行指令 |
| --- | --- | --- | --- |
| 權限 pure logic unit tests | 新增 `tests/unit/activity-user-host-permissions.test.js`，或擴充 `tests/unit/permission-guard-safety.test.js` | `user` 沒有 `activity.manage.entry` / `event.create`，但 owner-scope helper 允許建立基本活動、外部活動、取消自己活動；delegate 只允許現場操作 | `npm test -- --runTestsByPath tests/unit/activity-user-host-permissions.test.js` |
| 活動生命週期 unit tests | 擴充 `tests/unit/event-lifecycle.test.js` | owner 可 cancel；delegate 不可 cancel；coach+ / admin 舊行為不回歸 | `npm test -- --runTestsByPath tests/unit/event-lifecycle.test.js` |
| 外部活動 unit tests | 新增 `tests/unit/activity-external-permissions.test.js` 或擴充活動權限測試 | owner 可編輯自己的 external activity 基本欄位；delegate 不可編輯；external edit 不可帶入加值欄位 | `npm test -- --runTestsByPath tests/unit/activity-external-permissions.test.js` |
| derived status unit tests | 新增 `tests/unit/event-derived-status.test.js` 或擴充 `event-lifecycle.test.js` | `_syncEventEffectiveStatus()` / `_autoEndExpiredEvents()` 不再由一般 client 寫 Firestore；registration callable 以 effective status 判斷過期活動 | `npm test -- --runTestsByPath tests/unit/event-derived-status.test.js` |
| 活動寫入完整性 unit tests | 擴充 `tests/unit/event-write-integrity.test.js` | 一般 `user` create 前會 sanitize `feeEnabled`、`fee`、`teamOnly`、`genderRestrictionEnabled`、`allowedGender`、`privateEvent`、`teamSplit`；update 時不可清掉既有加值欄位 | `npm test -- --runTestsByPath tests/unit/event-write-integrity.test.js` |
| 加值 UI gating unit tests | 新增 `tests/unit/activity-addon-gating.test.js` | 一般 `user` 開啟加值 switch 會 reset，並觸發 Toast `如需更多功能請聯繫官方Line@`；coach+ 可正常開啟 | `npm test -- --runTestsByPath tests/unit/activity-addon-gating.test.js` |
| 活動範本 unit tests | 新增 `tests/unit/activity-template-addon-gating.test.js`，或擴充活動範本相關測試 | 一般 `user` 建立 / 套用 template 時加值欄位被 sanitize；更新既有 template 時不可變更加值欄位且不可誤清；coach+ 保留 template 加值欄位 | `npm test -- --runTestsByPath tests/unit/activity-template-addon-gating.test.js` |
| 權限管理 UI unit tests | 擴充 `tests/unit/user-admin.test.js` 或新增 `tests/unit/activity-user-permission-panel.test.js` | `user` role 的後台 permission toggle 仍 locked、後台權限數量為 0、前台活動能力開關區可見且可啟閉、不寫入 `rolePermissions/user` | `npm test -- --runTestsByPath tests/unit/user-admin.test.js` |
| 前台活動 capability rules tests | 擴充 `tests/firestore.rules.test.js` 或新增 capability rules 測試段落 | `roleActivityCapabilities/user` 只能 super_admin 寫入；一般登入 user 可讀；關閉 `user.activity.basic_create` 後 user create basic event 失敗；開啟後成功 | `npm run test:rules` |
| 活動管理入口 unit tests | 新增 `tests/unit/activity-manage-entry.test.js` 或併入權限測試 | `user.activity.own_manage_entry` 關閉時，一般 user owner / delegate 不可進 `page-my-activities`；coach+ 不受影響 | `npm test -- --runTestsByPath tests/unit/activity-manage-entry.test.js` |
| 掃碼入口 unit tests | 新增 `tests/unit/activity-scan-access.test.js` 或併入權限測試 | owner / delegate 只有在 `user.activity.site_operate` 開啟時可進 `page-scan`；關閉時不可進；coach+ / event.scan 既有權限不回歸 | `npm test -- --runTestsByPath tests/unit/activity-scan-access.test.js` |
| 活動詳情 sensitive action unit tests | 新增 `tests/unit/activity-detail-access.test.js` 或併入權限測試 | detail 掃碼 / 候補入口走 `_canOperateEventSite(e)`；operation log 走 `_canViewEventOperationLog(e)`；delegate 不可看 sensitive log | `npm test -- --runTestsByPath tests/unit/activity-detail-access.test.js` |
| teamSplit add-on operation tests | 新增 `tests/unit/activity-team-split-addon-gating.test.js` 或擴充 team-split 測試 | delegate 與 `addons_use` 關閉的一般 user owner 不可看到 / 執行 `_tsBatchRandom`、`_tsBatchFill`、`_tsBatchReset`、`_tsPickTeam`；coach+ / owner+addons_use 可操作 | `npm test -- --runTestsByPath tests/unit/activity-team-split-addon-gating.test.js` |
| teamOnly visibility unit tests | 新增 `tests/unit/activity-teamonly-visibility.test.js` | `addons_use` 關閉的一般 user owner 不可切換 `isPublic`；具 team permission / coach+ 可操作；delegate 不可操作 | `npm test -- --runTestsByPath tests/unit/activity-teamonly-visibility.test.js` |
| Firestore rules tests | 擴充 `tests/firestore.rules.test.js` 或 `tests/firestore-rules-extended.test.js` | user create basic event 成功；external edit basic 成功但 add-ons 失敗；user create / update add-ons 失敗且 update 不誤清既有 add-ons；owner cancel 成功；owner direct status push to ended/open/full/upcoming 被拒；delegate cancel 失敗；attendance / activityRecords / waitlist direct write 被拒；self signup / self cancel direct path 若保留則只能操作本人且不可改投影；displayBadges-only update 只允許 admin / event.edit_all 或 callable；teamSplit manager teamKey write 依 add-ons 能力拒絕 / 允許；teamOnly isPublic 依 add-ons / team permission 拒絕 / 允許；eventTemplates 加值欄位被拒絕 | `npm run test:rules` |
| root legacy rules tests | 擴充 `tests/firestore.rules.test.js` | root `registrations` / `attendanceRecords` / `activityRecords` 在沒有可驗證 `eventDocId` 時，不允許任意 authenticated user 做 waitlist promotion、attendance status、activity status privileged write | `npm run test:rules` |
| inherent role rules tests | 擴充 `tests/firestore.rules.test.js` | coach / captain / venue_owner 即使 `rolePermissions/{role}` 沒有 `activity.manage.entry`，仍可通過 `hasActivityManageEntry()` 相關 rules；一般 user 不可 | `npm run test:rules` |
| Cloud Functions callable tests | 新增或擴充 `tests/unit/activity-callables.test.js`；若放在 `tests/functions/` 則必須更新 `package.json` scripts | `cancelRegistration` / `manageEventRoster` 的 `manager_remove`、`promote_waitlisted`、`demote_confirmed`、`capacity_change` 依 owner、delegate、admin、permission、capability 正確允許或拒絕；一般 user owner / delegate 不可移除或退回 confirmed；同時支援 `delegates[].uid` 與 `delegateUids[]`；stale event.status 仍用 effective status 判斷 | `npm test -- --runTestsByPath tests/unit/activity-callables.test.js` |
| E2E / UI smoke tests | 新增 `tests/e2e/activity-user-host.spec.js` | 一般 `user` 可開活動 modal、加值開關 Toast、建立外部活動入口、委託人只能看到現場操作 | `npm run test:e2e -- tests/e2e/activity-user-host.spec.js` |

自動化完成標準：

1. 新增 helper 的允許 / 拒絕案例都要有 unit tests，不能只測 happy path。
2. Firestore rules 必須測「被拒絕」案例，尤其是直接寫入加值欄位、delegate 取消活動、任意 authenticated user 寫 attendance / waitlist。
3. Cloud Functions callable 必須測「直接呼叫」案例，確認 Admin SDK 寫入不會繞過前端與 Firestore rules。
4. 所有新增測試需能被既有指令納入：
   - `npm test`
   - `npm run test:rules`
   - 如有 UI smoke：`npm run test:e2e -- tests/e2e/activity-user-host.spec.js`
5. callable 測試預設放在 `tests/unit/`，確保 `npm test` 會跑；若放到 `tests/functions/`，必須同步更新 `package.json` 的 `test` / `test:unit` scripts。
6. 若新增測試檔未被現有 script 自動涵蓋，需同步更新 `package.json` scripts，避免測試只存在但 CI 不會跑。

## 部署與回滾順序

本功能不可用單純「先 rules 後前端」處理，因為舊前端仍可能使用 client batch 操作 waitlist / roster；若 rules 先收斂，正式活動管理會中斷。建議順序：

1. 本地完整測試：
   - `npm test`
   - `npm run test:rules`
   - 如有 E2E：`npm run test:e2e -- tests/e2e/activity-user-host.spec.js`
2. 部署 Cloud Functions additive 版本：
   - 新增 / 更新 `roleActivityCapabilities` helper。
   - 新增 / 更新 `manageEventRoster`、`cancelRegistration` 等 callable。
   - 舊前端尚未切換前，新增 callable 不應破壞既有流程。
3. 部署前端與 cache version：
   - 前端 waitlist / roster / capacity 操作改呼叫 callable。
   - 前端 capability listener、權限管理 UI、加值 gating 同步上線。
4. 部署 stricter Firestore rules：
   - 收斂 `events`、`registrations`、`attendanceRecords`、`activityRecords`、`eventTemplates`。
   - 拒絕舊 client batch 的 manager projection writes。
5. 部署後 smoke：
   - 一般 user 建立基本活動。
   - 一般 user 加值 Toast / reset。
   - owner / delegate 現場候補與簽到操作。
   - 一般 user owner / delegate 不可 demote / remove confirmed。
   - coach+ 加值與既有活動管理不回歸。

回滾原則：

- Functions 部署失敗：停止，不部署前端 / rules。
- 前端部署失敗：保留舊 rules，不部署 stricter rules。
- Rules 部署後 smoke 失敗：優先回滾 rules 至前一版，避免活動管理中斷，再回滾前端。

## 二次嚴格審計補強項目

以下是重新比對現有代碼後，原計劃容易漏掉或需要寫得更精準的事項。實作時必須逐項確認。

| 風險 / 缺口 | 為什麼重要 | 補強要求 |
| --- | --- | --- |
| capability 文件不存在時的預設行為 | 若前端預設開、Rules 預設關，會變成按鈕看得到但寫入失敗 | 前端與 Firestore rules 必須共用同一套內建預設；`addons_use` 預設關閉 |
| `roleActivityCapabilities` 未納入快取與 listener | 目前 `FirebaseService` 只有 `rolePermissions` 的特殊 cache / onSnapshot 流程 | 新增 `_cache.roleActivityCapabilities`、persist/restore/logout 清理、onSnapshot、UI refresh |
| `own_manage_entry` 未真正掛到入口 | 若只把 `page-my-activities` 對登入 user 開放，權限管理開關會失效 | 活動管理入口必須走 `_canAccessOwnActivityManageEntry()`，capability 關閉時導回安全頁 |
| 建立活動底部選單沒有分項 gating | 目前 `openCreateEventModal()` 只用一個建立權限，底部選單同時顯示自訂活動與活動連結 | `basic_create` 與 `external_create` 要分別控制「自訂活動」與「活動連結」 |
| 活動管理頁 `＋ 新增` 硬顯示 | `page-my-activities` 開放 delegate 後，委託人可能看到新增入口但點擊被擋 | 與活動頁右上角按鈕共用 `_canCreateActivityByPermission()` 顯示條件 |
| `_isEventDelegate(e)` 只看 `delegates` | Rules 與 CRUD 已同步 `delegateUids`，歷史或部分資料可能只有 `delegateUids` | delegate 判斷同時支援 `delegates[].uid` 與 `delegateUids[]` |
| 外部活動編輯權限 | `handleCreateExternalEvent()` 同時處理新增與編輯，目前只看 `activity.manage.entry` | 已定義：一般 user owner 需 `own_edit_basic` 才可編輯自己的外部活動基本欄位；`external_create` 只控新增；delegate 不可編輯 |
| `teamOnly` 加值功能另有隊伍語意 | 目前 `teamOnly` 仍受 `team.create_event` / `activity.manage.entry` 檢查影響 | 即使 `addons_use` 開啟，也要明確定義是否仍需有效隊伍 / 隊伍管理資格，不可單純繞過隊伍限制 |
| `event.create` 與 add-ons 混淆 | 若把 `event.create` 視為完整活動，會讓可建立者自動拿到加值 | `event.create` 只代表建立基本活動；加值需 `_canUseActivityAddons()` |
| 既有委託人遇到 `delegate_assign` 關閉 | 若直接禁止所有 delegate 欄位變更，owner 可能無法移除既有委託人 | 建議 `delegate_assign` 關閉時禁止新增，但允許 owner 移除 / 縮減委託人以降低風險 |
| event update allowlist 太粗 | 目前 owner update 偏寬，若只加 helper 但不收斂 affected keys，仍可能寫入加值或營運欄位 | Rules 需以 `diff().affectedKeys()` 分出基本欄位、取消狀態、delegate 欄位、加值欄位 |
| 一般 user edit 誤清加值 | 若 submit sanitize 將加值欄位設為 false/null，會把既有加值活動資料清掉 | create sanitize；update preserve/deny，不可清掉 existing add-ons |
| status transition 沒定義 | 取消、重開、重新上架若只看 owner，可能讓一般 user 做到第一階段不開放的生命週期操作 | user owner 第一階段只允許 `status -> cancelled`；重新開放 / 重上架仍保留 coach+ / admin |
| 活動詳情頁掃碼與 log 入口仍可能過寬 | detail page 仍可能用 `_canManageEvent(e)` 控制 `canScan` 或操作紀錄按鈕 | 掃碼 / 候補改 `_canOperateEventSite(e)`；operation log 改 `_canViewEventOperationLog(e)`，delegate 不自動取得 sensitive log |
| self signup / self cancel fallback | 舊前端若仍直接寫 registration / activityRecords，strict rules 會中斷或被迫留寬 | 優先改 callable；若保留 direct self path，必須窄 allowlist 並補只能本人操作、不能改投影、不能管理候補的 rules tests |
| `displayBadges` registration write | `event-manage-badges.js` 會直接更新 `registrations.displayBadges` | 保留 admin / `event.edit_all` 的 displayBadges-only allowlist 或改 callable；不可讓 owner / delegate 因現場權限更新他人 badges |
| admin repair / migration writes | `data-sync`、`registration-audit`、achievement repair 會批次更新 registrations / activityRecords / events 投影 | 分類成 high-permission maintenance path；限 super_admin / admin 或 callable，不可為了維修工具放寬一般活動管理 rules |
| attendance / waitlist / activityRecords root 與 subcollection 雙路徑 | 專案仍同時有 root 與 `events/{eventId}/...` 規則 | 三類資料兩套路徑都要補 manager / capability guard，避免只修一邊 |
| waitlist / roster client batch 無法驗證投影 | Rules 無法驗證 client 傳入 occupancy 是否正確 | promote/demote/remove/capacity 改由 callable transaction 重建投影 |
| Rules `get()` 次數預算 | capability helper 會多讀一份設定文件，部分 waitlist / attendance rules 已會讀 event doc | rules tests 需覆蓋複合操作，確認沒有超過 Firestore rules get limit |
| Rules 不含 inherent role permissions | `hasPerm()` 只讀 rolePermissions，不含 coach+ 固定權限 | 新增 `hasActivityManageEntry()` 合併 `isCoachPlus()` 與 `hasPerm('activity.manage.entry')` |
| capability schema validation | 若允許任意 code 寫入，未來 helper 拼字或未知 code 可能造成混亂 | rules 寫入驗證 `capabilities` 只能包含已知 code，`updatedBy == request.auth.uid`，`updatedAt == request.time` |
| 部署順序 | rules 若先收斂，舊前端仍用 client batch 會中斷正式功能；前端若先上但 callable 未部署也會失敗 | 建議順序：測試通過 -> deploy functions additive -> deploy frontend/cache bump -> deploy stricter rules -> post-deploy smoke |
| 快取版本號 | 本功能會修改 JS / HTML / rules / docs | 只要實作改到前端 JS/HTML，需依 `CLAUDE.md` 透過版本流程更新快取版本 |
| operation log | user 活動能力開關會影響所有一般 user | 建議 capability 開關寫入 operation log，方便追蹤權限變更 |
| Cloud Functions callable 繞過 rules | callable 使用 Admin SDK，Firestore rules 不會攔截其寫入 | `cancelRegistration` 與其他活動管理 callable 必須同步檢查 owner / delegate / admin / permission / capability，並補 callable tests |
| `cancelRegistration` 權限過粗 | 目前 `manager_remove` 只要 creator / delegate / admin 即可，未區分 confirmed 與 waitlisted | 依 target registration status 分流；一般 user owner / delegate 第一階段只允許 waitlist 現場操作，不允許移除 / 退回 confirmed 參與者；delegate 不允許 `capacity_change` |
| root legacy path 無法查 event owner | root `eventId` 是 `data.id`，rules 不能用欄位查 event doc | root privileged writes 改走 subcollection / callable；若保留 root manager write，必須先補 `eventDocId` 遷移 |
| Functions / frontend / rules delegate 判斷不一致 | 現有 callable 只看 `delegates[].uid`，部分資料可能只有 `delegateUids[]` | 三層 helper 統一支援 `delegates[].uid` 與 `delegateUids[]`，並用測試覆蓋兩種資料 |
| callable capability 預設與前端不一致 | 若 Functions 缺文件時預設不同，會造成前端看得到但 callable 拒絕，或前端拒絕但 callable 放行 | Functions 端必須有同一份 default capability 清單；`addons_use` 預設關閉 |
| callable 測試未被 `npm test` 執行 | 目前 `npm test` 只跑 `tests/unit/` | callable tests 放 `tests/unit/`，或同步更新 package scripts |

## 目前代碼審計結果

| 審計點 | 目前檔案 / 代碼狀態 | 結論 |
| --- | --- | --- |
| role 階層 | `js/config.js` 定義 `user < coach < captain < venue_owner < admin < super_admin` | 角色層級清楚 |
| user 預設權限 | `js/config.js` 的 `getDefaultRolePermissions('user')` 回傳空陣列；`js/api-service.js` 的 user rolePermissions 直接回傳空陣列 | 一般 user 目前沒有 permission-code 型活動管理權 |
| 權限管理 user 顯示 | `user-admin-roles.js` 的 `_isLockedPermissionRole('user')` 回 true，提示 user 固定沒有後台功能權限；角色列表權限數量取 `ApiService.getRolePermissions(key).length` | user 會在權限管理中看得到此層級，但目前只會顯示 0 個後台權限；需新增獨立「前台活動能力」開關區 |
| Firestore user permission | `firestore.rules` 的 `hasPerm(perm)` 排除 `role == 'user'` | 不能靠給 user role permission 解決，需 owner-scope rules |
| 活動管理入口 | `DRAWER_MENUS.page-my-activities` 需要 `activity.manage.entry`，`_canAccessPage()` 優先使用 drawer rule | user 目前無法直接進入活動管理頁 |
| 建立活動入口 | `_canCreateActivityByPermission()` 只接受 `event.create` 或 `activity.manage.entry` | user 目前不能建立活動，需新增基本建立能力 |
| 外部活動建立 | `handleCreateExternalEvent()` 目前要求 `activity.manage.entry` | user 目前不能建立外部活動 |
| owner / delegate 判斷 | `_isEventOwner(e)`、`_isEventDelegate(e)` 已存在 | 可重用，但需新增更精準 helper |
| `_canManageEvent(e)` | 目前 owner、delegate、`event.edit_all` 都回 true | 對委託人過寬，需拆分 |
| 活動列表 scope | `renderMyActivities()` 非 admin 只顯示 owner / delegate 活動 | scope 基礎可用，入口與操作按鈕需調整 |
| 取消活動 | `cancelMyActivity()` 只依 `_canManageEvent(e)` 判斷 | 委託人目前可能可取消，需改成 owner / admin |
| 掃碼頁 | `page-scan` 特例允許 coach+ / delegate，不包含 owner，且 delegate 入口未吃 `user.activity.site_operate` | user owner / delegate 需要改走 `_canOperateEventSite(e)`，capability 關閉時不可進 |
| 活動詳情掃碼入口 | detail page 仍有 `canScan` 類判斷依 `_canManageEvent(e)` | 改用 `_canOperateEventSite(e)`，避免 delegate / owner 因掃碼入口被視為完整管理者 |
| 活動詳情 operation log | detail page 的報名異動 / 操作紀錄屬 sensitive read | 新增 `_canViewEventOperationLog(e)`；delegate 第一階段不可只因被委託就看 log |
| 手動簽到 | confirm / attendance 模組多處依 `_canManageEvent(e)` | 功能方向符合 owner/delegate 現場操作，但需換成 `_canOperateEventSite(e)` |
| 候補名單 | waitlist UI 依 `_canManageEvent(e)`，且 `_forcePromoteWaitlist()` / `_forceDemoteToWaitlist()` 仍由 client batch 寫 registrations / activityRecords / events 投影 | 需改成 server-authoritative callable；delegate 只可 promote waitlisted，不可 demote / remove confirmed |
| self signup / cancel fallback | signup / cancel 相關前端仍需盤點是否有 direct registration / activityRecords 寫入 fallback | stricter rules 前需改 callable 或保留窄 self-only allowlist，避免部署後中斷或保留寬規則 |
| badge refresh | `event-manage-badges.js` 會在 `event.edit_all` 下直接更新 `events/{eventDocId}/registrations/{regId}.displayBadges` | 視為獨立 badge projection write；rules 需 admin-only allowlist 或改 callable，不能混入 owner / delegate roster 權限 |
| repair / migration tooling | `data-sync`、`registration-audit`、achievement repair 等高權限工具會批次改 registrations / activityRecords / events | 實作前分類為 maintenance path；只允許 admin / super_admin 或 callable，不納入一般 user owner-scope |
| 加值欄位 | create / edit payload 會讀寫 fee、teamOnly、genderRestriction、privateEvent、teamSplit | 需前端 gating；create sanitize；update preserve/deny；rules 防直接寫入 |
| teamSplit 後續操作 | `event-team-split.js` 的 batch random / fill / reset / pick team 直接用 manager UI 與 batch 寫 `teamKey` | teamSplit manager 操作也要視為加值功能；delegate 與 `addons_use` 關閉的一般 user owner 不可操作 |
| 活動範本 | `event-create-template.js` 會儲存與套用 fee、genderRestriction、privateEvent 等加值欄位 | 需範本 save / load gating，並補 `eventTemplates` rules |
| 委託人功能 | 實際 delegate UI 已存在，且 CRUD 會同步 `delegateUids` | 功能存在；計劃是保留給 owner 設定，delegate 不可設定 |
| events rules | authenticated user create / owner update 偏寬 | 必須補 basic create 與 add-on deny rules |
| attendance rules | authenticated user create / status update 偏寬 | 必須收斂到 owner / delegate / admin |
| activityRecords rules | root / subcollection 仍有 authenticated create 或 status-only update | 必須和 registrations / attendanceRecords 一起收斂 |
| waitlist rules | waitlist promotion 對 authenticated user 偏寬 | 必須禁止 client manager direct write，改由 callable 交易處理 |
| rules inherent role | `hasPerm()` 不包含 `INHERENT_ROLE_PERMISSIONS`，coach+ 核心權限可能在 rules 中失效 | 補 `hasActivityManageEntry()`，rules 測試需覆蓋 rolePermissions 缺碼情境 |
| Cloud Functions `cancelRegistration` | `manager_remove` / `capacity_change` 目前只檢查 creator、`delegates[].uid`、admin，且使用 Admin SDK 寫入 | 必須補 `roleActivityCapabilities` 檢查、confirmed / waitlisted 分流、`delegateUids[]` 支援與 callable tests |
| root legacy registrations | root `registrations.eventId` 是活動資料 `data.id`，rules 無法用它查 `events/{docId}` | root waitlist promotion 不可只用 `isAuth()`；需改走 subcollection / callable 或先補 `eventDocId` 遷移 |
| root legacy attendanceRecords | root `attendanceRecords.eventId` 同樣不是 event doc id，且目前 authenticated user create / status update 偏寬 | root attendance privileged write 需拒絕或要求 `eventDocId`；新現場操作應走 subcollection |
| root legacy activityRecords | root `activityRecords` 也可能殘留舊資料與寬寫入 | root activity status privileged write 需拒絕或要求 `eventDocId`；管理投影由 callable 處理 |

審計結論：此權限設計有條件可行，但不能用「直接給 user 既有活動管理權限」的方式實作，也不能只改前端與 Firestore rules。正確做法是新增 owner-scope 的基本活動能力，並將目前過寬的 `_canManageEvent(e)`、Firestore authenticated write rules、Cloud Functions callable 權限邊界一起拆細。候補 / 名單 / activityRecords / events 投影寫入必須改由 server-authoritative callable 負責；加值功能限制需要前端 UX、Firestore rules、callable 權限一致，且 teamSplit 後續 manager 操作也必須視為加值管理，否則只靠 Toast、只靠 rules，或繼續使用 client batch 都會留下繞過面。

## 驗收標準

1. 一般 `user` 登入後可以建立一般基本活動。
2. 一般 `user` 登入後可以建立外部活動連結。
3. 一般 `user` 在新增 / 編輯自己的活動時，開啟加值開關會立即 reset 並 Toast `如需更多功能請聯繫官方Line@`。
4. 一般 `user` 不能透過直接 Firestore write 建立或更新加值欄位。
5. 一般 `user` 只能在活動管理頁看到自己建立的活動。
6. 委託人只能看到被委託活動，且在 `user.activity.site_operate` 開啟時可做掃碼、手動簽到、候補操作。
7. 委託人不可建立活動、不可編輯活動、不可取消活動、不可設定委託人、不可啟用加值功能。
8. owner 可取消自己的活動。
9. owner 可設定最多 3 位委託人。
10. 一般 user owner / delegate 第一階段只能做候補現場操作，不可移除或退回 confirmed 參與者。
11. coach+ 與 admin 既有建立活動、加值功能、管理入口不能被回歸破壞。
12. Firestore rules tests 覆蓋 owner、delegate、coach+、admin、任意 authenticated user 的允許與拒絕案例。
13. Cloud Functions callable tests 覆蓋 `cancelRegistration` 的 `user_cancel`、`manager_remove`、`capacity_change` 允許與拒絕案例。
14. Cloud Functions callable tests 覆蓋 `manageEventRoster` 或等價 roster callable 的 promote / demote / remove / capacity change。
15. 任意 authenticated user 不能透過 callable、root legacy path 或 client subcollection batch 繞過前端與 Firestore rules 做 attendance / activityRecords / waitlist / manager remove。
16. delegate 判斷在前端、Firestore rules、Cloud Functions 中對 `delegates[].uid` 與 `delegateUids[]` 結果一致。
17. 若 root legacy path 尚未完成 `eventDocId` 遷移，root path 不得開放 manager privileged write。
18. `user.activity.own_manage_entry` 關閉時，一般 user 不能進活動管理頁。
19. `event.create` 不給加值能力；加值必須由 `_canUseActivityAddons()` / rules / callable 共同判斷。
20. 一般 user 更新既有活動或範本時，不可誤清既有加值欄位。
21. teamSplit 批次分隊、補齊、重置與替他人指定 teamKey 需受加值能力限制；delegate 與 `addons_use` 關閉的一般 user owner 不可操作。
22. 活動詳情頁掃碼 / 候補入口與 operation log 必須分開判斷，delegate 不可只因被委託就看 sensitive log。
23. `registrations.displayBadges` 與 admin repair / migration direct writes 有獨立高權限策略，不因 rules 收斂被誤傷，也不放寬給一般 user owner / delegate。
## 2026-05-05 實作完成版審計結論

本計劃已落地為「既有 coach+/admin 活動管理權限」加上「一般 user owner-scope 活動主辦能力」兩層模型。

### 已實作能力

| 對象 | 可用能力 | 控制來源 |
|---|---|---|
| 一般 user | 建立基本活動、建立外部活動連結、查看自己的活動管理入口、編輯自己活動基本欄位、取消自己活動、設定委託人、掃碼/手動簽到、候補操作 | `roleActivityCapabilities/user` |
| 委託人 | 被委託活動的掃碼/手動簽到與候補操作 | 活動 `delegateUids` + `user.activity.site_operate` |
| coach+ / admin / activity manager | 完整活動管理、加值功能、跨活動管理 | `rolePermissions`、角色階層、`activity.manage.entry`、`event.edit_all` |

### 已實作限制

- 一般 user 預設不能使用加值功能：收費、限隊員、性別限制、私密活動、自動分隊。
- 一般 user 開啟加值開關會顯示 Toast：`如需更多功能請聯繫官方Line@`。
- Firestore Rules 同步拒絕一般 user 寫入加值欄位，避免只靠前端 UI。
- 一般 user owner 修改 `max` 時不能低於既有 `current`。
- `events/{eventId}/attendanceRecords` 寫入需為活動 operator，且一般 user owner/delegate 必須具備 `user.activity.site_operate`。
- `events/{eventId}/activityRecords` 寫入收斂到參與者本人或活動 operator。
- Cloud Functions `cancelRegistration` 的 manager 路徑已補 owner/delegate + `site_operate` 檢查，confirmed 參與者移除仍保留高權限限制。

### 自我測試與驗收

- Firestore Rules：`npm run test:rules` 已擴充至 506 tests，覆蓋 `roleActivityCapabilities`、一般 user 建立/編輯/取消、加值拒絕、現場操作、子集合簽到/活動紀錄寫入。
- Unit：維持 `npm run test:unit` 全量驗收，並補 source drift / helper 行為相容修正。
- 佈署前必跑：`node --check`、`npm run test:rules`、`npm run test:unit`、`node scripts/bump-version.js`、`git diff --check`。
- 佈署項目：frontend 走 `git push origin main`，Firestore Rules 走 `firebase deploy --only firestore:rules --project fc-football-6c8dc`，Functions 走 `firebase deploy --only functions --project fc-football-6c8dc`。

### 最終審計

目前無重大或中型設計瑕疵阻擋實作。剩餘屬既有 legacy root collection 風險：root `attendanceRecords` / `activityRecords` 仍保留舊測試標記的 auth-wide 行為，以避免破壞歷史資料修復流程；正式 runtime 寫入已走 event subcollection 並完成權限收斂。
