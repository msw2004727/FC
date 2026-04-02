# Firestore Collections Schema

> AI 輔助開發用：查此檔案即可了解所有集合的欄位定義，不需跨檔搜索。

## UID 欄位速查

| 集合 | UID 欄位名 | 內容 | 注意 |
|------|-----------|------|------|
| events | `creatorUid` | LINE userId | delegates 也有 uid |
| registrations | **`userId`** | LINE userId | 不是 `uid`（歷史命名） |
| attendanceRecords | `uid` | LINE userId | 同行者也記主報名者 uid |
| activityRecords | `uid` | LINE userId | |
| users | `uid`（= doc ID） | LINE userId | |
| tournaments | `creatorUid` | LINE userId | |
| messages | `fromUid` / `toUid` | LINE userId | |
| teams | `captainUid` | LINE userId | |
| expLogs | `uid` | LINE userId | |
| operationLogs | `uid` | LINE userId | 操作者 |

---

## events

| 欄位 | 型別 | 說明 |
|------|------|------|
| id | string | 活動 ID |
| title | string | 活動名稱 |
| type | string | 類型（PLAY / 友誼 / 教學 / 觀賽） |
| date | string | 日期時間 "2026/04/02 15:00" |
| location | string | 地點 |
| max | number | 正取上限 |
| current | number | 目前正取人數 |
| waitlist | number | 候補人數 |
| participants | array\<string\> | 正取者名字陣列 |
| waitlistNames | array\<string\> | 候補者名字陣列 |
| status | string | open / full / ended / cancelled |
| creatorUid | string | 建立者 LINE userId |
| creatorName | string | 建立者顯示名稱 |
| delegates | array\<{uid,name}\> | 委託人 |
| delegateUids | array\<string\> | 委託人 uid 陣列（反正規化） |
| regStart | string | 報名開始 ISO datetime |
| regEnd | string | 報名截止 ISO datetime |
| feeEnabled | boolean | 是否收費 |
| fee | number | 費用金額 |
| gender | string\|null | 性別限制 M/F/null |
| teamId | string\|null | 限定俱樂部 |
| teamSplit | object | 分隊設定 {enabled, mode, size} |
| image | string | 封面圖 URL |
| createdAt | Timestamp | 建立時間 |
| updatedAt | Timestamp | 更新時間 |

---

## registrations

| 欄位 | 型別 | 說明 |
|------|------|------|
| id | string | 報名 ID |
| eventId | string | 活動 ID |
| **userId** | string | 報名者 LINE userId（**注意不是 uid**） |
| userName | string | 報名者名稱 |
| participantType | string | `self`（本人）/ `companion`（同行者） |
| companionId | string | 同行者 ID（companion 時有值） |
| companionName | string | 同行者名稱 |
| status | string | confirmed / waitlisted / cancelled / removed |
| registeredAt | Timestamp | 報名時間 |
| promotionOrder | number | 候補排序用（0=本人, 1+=同行者） |
| teamKey | string | 分隊 key（分隊模式） |

---

## attendanceRecords

| 欄位 | 型別 | 說明 |
|------|------|------|
| id | string | 紀錄 ID |
| eventId | string | 活動 ID |
| uid | string | **主報名者** LINE userId（同行者也記主報名者） |
| userName | string | 名稱 |
| participantType | string | self / companion |
| companionId | string\|null | 同行者：`mainUid_companionName`；本人：null |
| companionName | string\|null | 同行者名稱 |
| type | string | checkin / checkout / note / unreg |
| time | string | 格式 "2026/04/02 15:30" |
| note | string | 備註（type=note 時，最多 20 字） |
| status | string | active / removed |
| createdAt | Timestamp | 建立時間 |

---

## activityRecords

| 欄位 | 型別 | 說明 |
|------|------|------|
| eventId | string | 活動 ID |
| uid | string | 使用者 LINE userId |
| name | string | 活動名稱（反正規化） |
| date | string | 活動日期 "MM/DD" |
| eventType | string | 活動類型 |
| status | string | registered / waitlisted / cancelled |
| createdAt | Timestamp | 建立時間 |

---

## users

| 欄位 | 型別 | 說明 |
|------|------|------|
| uid | string | LINE userId（= doc ID） |
| lineUserId | string | LINE user ID |
| displayName | string | 顯示名稱 |
| pictureUrl | string | 頭像 URL |
| role | string | user / coach / captain / venue_owner / admin / super_admin |
| exp | number | 經驗值 |
| gender | string | M / F |
| birthday | string | 生日 |
| region | string | 地區 |
| teamId | string | 主要俱樂部 ID |
| teamIds | array\<string\> | 所有俱樂部 ID |
| companions | array\<object\> | 同行者 {id, name, relationship, phone, birthYear} |
| createdAt | Timestamp | 建立時間 |
| lastLogin | Timestamp | 最後登入 |

---

## tournaments

| 欄位 | 型別 | 說明 |
|------|------|------|
| id | string | 賽事 ID |
| mode | string | friendly / cup / league |
| creatorUid | string | 建立者 LINE userId |
| creatorName | string | 建立者名稱 |
| hostTeamId | string | 主辦俱樂部 ID |
| hostTeamName | string | 主辦俱樂部名稱 |
| delegates | array\<{uid,name}\> | 委託人 |
| delegateUids | array\<string\> | 委託人 uid 陣列 |
| regStart | string | 報名開始 |
| regEnd | string | 報名截止 |
| matchDates | array\<string\> | 比賽日期 |
| maxTeams | number | 隊伍上限 |
| feeEnabled | boolean | 是否收費 |
| fee | number | 報名費 |
| teamApplications | array\<object\> | 報名申請 {teamId, teamName, status, requestedByUid, appliedAt} |
| teamEntries | array\<object\> | 已核准隊伍 {teamId, teamName, entryStatus, memberRoster[]} |
| registeredTeams | array\<string\> | 已核准隊伍 ID |
| friendlyConfig | object | {teamLimit, allowMemberSelfJoin, pendingVisibleToThirdParty} |
| ended | boolean | 是否已結束 |
| schemaVersion | number | Schema 版本 |
| createdAt | Timestamp | 建立時間 |

---

## messages

| 欄位 | 型別 | 說明 |
|------|------|------|
| id | string | 訊息 ID |
| type | string | activity / team / system / admin |
| title | string | 標題 |
| body | string | 內文 |
| fromUid | string | 發送者 uid |
| toUid | string | 接收者 uid（個人訊息） |
| targetTeamId | string | 目標俱樂部 ID（團隊訊息） |
| targetType | string | individual / team / role / all |
| unread | boolean | 是否未讀 |
| readBy | array\<string\> | 已讀 uid 陣列 |
| hiddenBy | array\<string\> | 已隱藏 uid 陣列 |
| dedupeKey | string | 防重複 key |
| timestamp | Timestamp | 建立時間 |

---

## expLogs

| 欄位 | 型別 | 說明 |
|------|------|------|
| uid | string | 使用者 LINE userId |
| rule | string | 規則 key（complete_activity / register_activity 等） |
| amount | number | EXP 數量（可為負） |
| reason | string | 原因說明 |
| source | string | 來源（系統 / auto） |
| requestId | string | 冪等 key |
| time | string | 時間 |

---

## operationLogs

| 欄位 | 型別 | 說明 |
|------|------|------|
| action | string | 動作類型 |
| label | string | 動作名稱 |
| description | string | 詳細說明 |
| uid | string | 操作者 LINE userId |
| userName | string | 操作者名稱 |
| meta | object | 額外資訊 |
| createdAt | Timestamp | 建立時間 |
