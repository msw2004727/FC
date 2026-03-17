# 05 Notification Spec

## 渠道
- 第一階段以 `站內信（messages）` 為主
- 若既有 `_deliverMessageWithLinePush()` 可沿用，則可同步保留 LINE 推播，但站內信為必達主渠道

## 模板來源
- 使用既有 `站內信模板（notifTemplates）`
- 所有新模板 key 必須能在 `站內信管理` 中編輯

## 模板 key
- `tournament_friendly_host_opened`
- `tournament_friendly_team_apply_host`
- `tournament_friendly_team_approved_applicant`
- `tournament_friendly_team_rejected_applicant`
- `tournament_friendly_team_approved_broadcast`

## 模板變數
- `{tournamentName}`
- `{hostTeamName}`
- `{teamName}`
- `{creatorName}`
- `{applicantName}`
- `{reviewerName}`
- `{regEnd}`

## 通知情境
### 1. 主辦建賽通知
- key：`tournament_friendly_host_opened`
- 觸發：友誼賽建立成功
- 收件者：主辦俱樂部所有成員
- 目的：提醒主辦隊成員與職員加入 roster

### 2. 俱樂部申請待審通知
- key：`tournament_friendly_team_apply_host`
- 觸發：其他俱樂部送出 application
- 收件者：
  - 建立者 `creatorUid`
  - 該賽事 `delegates`

### 3. 核准通知申請人
- key：`tournament_friendly_team_approved_applicant`
- 觸發：主辦核准某隊
- 收件者：申請人 `requestedByUid`

### 4. 拒絕通知申請人
- key：`tournament_friendly_team_rejected_applicant`
- 觸發：主辦拒絕某隊
- 收件者：申請人 `requestedByUid`

### 5. 核准後廣播給該隊成員
- key：`tournament_friendly_team_approved_broadcast`
- 觸發：主辦核准某隊
- 收件者：該俱樂部全部成員
- 目的：提醒已可加入該隊 roster

## Message meta 建議欄位
- `tournamentId`
- `tournamentName`
- `hostTeamId`
- `hostTeamName`
- `teamId`
- `teamName`
- `applicationId`
- `messageGroupId`
- `actionType`
  - `tournament_friendly_application`
- `actionStatus`
  - `pending`
  - `approved`
  - `rejected`

## v1 不做
- 對同一俱樂部成員發送已讀同步規則
- 對不同語系收件者做模板語系分流
- 通知節流與批次合併
