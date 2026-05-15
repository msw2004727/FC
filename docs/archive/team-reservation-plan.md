# 俱樂部團隊席位功能計劃書

## 目標

讓俱樂部職員能在既有活動中，用俱樂部身份保留一組團隊席位。席位會佔用活動名額，但不會產生假的報名者；同俱樂部真人報名後會消耗該俱樂部席位，並在報名名單中集中成一組顯示。

## 已對齊規則

- 職員的團隊報名不包含本人。本人要參加時，仍需另外點「個人報名」。
- 活動詳情的主操作區拆成並行按鈕：個人報名/取消報名、團隊報名/調整名額。
- 同俱樂部席位集中成一組顯示。
- 俱樂部真人成員仍是 registrations 的真人資料，必須列入簽到、簽退、放鴿子、EXP 與後台統計。
- 空席只作為席位佔用與 UI placeholder，不可列入真人統計，也不可有簽到、簽退、放鴿子操作。
- 調整團隊名額不可低於已使用的俱樂部真人數，也不可高於活動可容納上限。
- 取消/縮減團隊空席釋出的名額，才可以觸發一般候補遞補。
- 同俱樂部真人取消時，如果仍有團隊保留席位，釋出的真人位置回到該俱樂部空席，不遞補一般候補。
- 操作紀錄需保留既有真人報名 log，並新增團隊席位建立/調整紀錄。

## 資料模型

新增活動子集合：

`events/{eventDocId}/teamReservations/{teamId}`

主要欄位：

- `eventId`
- `teamId`
- `teamName`
- `reservedSlots`
- `status`: `active` 或 `cancelled`
- `createdByUid`
- `createdByName`
- `createdAt`
- `updatedAt`
- `lastAdjustedByUid`
- `lastUsedSlots`

活動文件新增投影欄位：

- `teamReservationSummaries`
- `realCurrent`

registration 真人資料新增可選欄位：

- `teamReservationTeamId`
- `teamReservationTeamName`
- `teamSeatSource`: `reserved` 或 `overflow`

## 佔位公式

每個活動重建佔位時：

`realCurrent = confirmed registrations 真人數`

每個俱樂部：

- `usedSlots = 已 confirmed 且標記為該 teamReservationTeamId 的真人數`
- `remainingSlots = max(0, reservedSlots - usedSlots)`
- `occupiedSlots = max(reservedSlots, usedSlots)`

活動佔位：

`current = realCurrent + sum(remainingSlots)`

也就是：真人永遠只算一次；空席只補足俱樂部保留席位尚未被真人使用的部分。

## UI 呈現

活動詳情報名名單：

- 顯示佔位數：`報名名單：current/max`
- 可補充顯示實際報名：`實際報名 realCurrent 人`
- 俱樂部區塊顯示：
  - `原團隊佔位`
  - `已被俱樂部成員使用`
  - `剩餘佔位`
  - `可增加上限`
- 俱樂部真人列有旗幟/標記，點擊提示「XXX俱樂部席位」。
- 空席列使用俱樂部底色與旗幟，但簽到/簽退/放鴿子欄位顯示 `--`。
- 一般報名者維持原樣。

## 遞補規則

- 個人報名：
  - 如果報名者屬於有團隊席位的俱樂部，且該俱樂部 `usedSlots < reservedSlots`，即使活動因該席位顯示額滿，仍可正取消耗俱樂部空席。
  - 如果該俱樂部已超過保留席位，只有活動仍有總名額時才可正取，並標記為 `overflow`。
  - 超過活動上限時進一般候補，不使用團隊特殊席位呈現。
- 個人取消：
  - 一般正取取消，照原本邏輯遞補。
  - 俱樂部真人取消後若仍有保留席位，活動 `current` 不下降，不遞補一般候補。
  - 俱樂部 overflow 真人取消，若活動佔位下降，才可遞補候補。
- 調整團隊席位：
  - 增加席位時更新活動佔位，不自動通知候補。
  - 減少空席時如果釋出活動總名額，才依原排序遞補候補。

## 審計重點

- `current` 代表活動名額佔用，不再等於真人 confirmed 數。
- 所有真人統計必須使用 `realCurrent` 或 registrations，不得使用 `current`。
- 放鴿子計算只掃 confirmed self registrations 和 attendanceRecords，不會讀 teamReservation placeholder。
- 出勤表可以顯示 placeholder，但儲存時要跳過 placeholder。
- log 需同時支援真人事件與團隊席位事件。
- Cloud Function 與前端 fallback 的佔位重建公式必須一致。

## 實作範圍

1. 新增共享佔位 helper：正規化團隊席位、計算 used/remaining/current。
2. 更新前端 direct registration fallback。
3. 更新 Cloud Functions registration/cancel registration。
4. 新增 `adjustTeamReservation` callable。
5. 新增活動詳情團隊按鈕、名額調整 modal、名單分組與旗幟提示。
6. 更新候補遞補、容量調整、手動正取/下放的佔位重建。
7. 更新 Firestore rules：teamReservations 讀取允許，寫入走 Cloud Function。
8. 補 unit tests 覆蓋佔位公式與遞補邊界。

