# 01 Domain Model

## 設計原則
- `賽事（tournaments）` 主文件只存列表頁、權限判斷、摘要展示必需的欄位
- 高變動與可成長資料改放子集合，避免單一 document 持續膨脹
- 第一階段雖只做 `friendly`，仍要在主文件保留 `cup / league` 的配置位

## 主文件
路徑：`tournaments/{tournamentId}`

### 必填欄位
- `id`
- `name`
- `mode`
  - 第一階段固定 `friendly`
  - 預留值：`cup`, `league`
- `status`
  - `draft`
  - `upcoming`
  - `registration_open`
  - `registration_closed`
  - `ended`
- `creatorUid`
- `creatorName`
- `hostTeamId`
- `hostTeamName`
- `hostTeamImage`
- `organizerDisplay`
- `regStart`
- `regEnd`
- `feeEnabled`
- `fee`
- `friendlyConfig`
- `approvedTeamIds`
- `approvedTeamCount`
- `pendingTeamCount`
- `teamLimit`
- `createdAt`
- `updatedAt`

### 選填欄位
- `coverImage`
- `contentImage`
- `description`
- `region`
- `venues`
- `matchDates`
- `delegates`
- `ended`
- `registeredTeams`
  - 過渡相容欄位
  - 由 `approvedTeamIds` 衍生，不再作為唯一真實來源

### 預留欄位
- `cupConfig`
- `leagueConfig`
- `scheduleConfig`
- `rankingConfig`

## friendlyConfig
- `teamLimit`
  - 第一階段預設 `4`
- `allowMemberSelfJoin`
  - 第一階段固定 `true`
- `pendingVisibleToThirdParty`
  - 第一階段固定 `false`
- `hostAutoApproved`
  - 第一階段固定 `true`

## 球隊申請子集合
路徑：`tournaments/{tournamentId}/applications/{applicationId}`

### 欄位
- `applicationId`
- `teamId`
- `teamName`
- `teamImage`
- `requestedByUid`
- `requestedByName`
- `status`
  - `pending`
  - `approved`
  - `rejected`
  - `cancelled`
- `messageGroupId`
- `appliedAt`
- `reviewedAt`
- `reviewedByUid`
- `reviewedByName`

### 規則
- 同一支球隊在同一賽事同時間只能有一筆 `pending` 或 `approved` 狀態
- `rejected` 在 v1 不可直接重複申請
- `cancelled` 僅供未來擴充，v1 不開放 UI 操作

## 參賽隊伍子集合
路徑：`tournaments/{tournamentId}/entries/{teamId}`

### 欄位
- `teamId`
- `teamName`
- `teamImage`
- `entryStatus`
  - `host`
  - `approved`
- `displayOrder`
  - 主辦隊固定 `0`
  - 其他核准隊伍依核准時間往後排
- `approvedAt`
- `approvedByUid`
- `approvedByName`
- `memberCount`
- `createdAt`
- `updatedAt`

## 隊員名單子集合
路徑：`tournaments/{tournamentId}/entries/{teamId}/members/{uid}`

### 欄位
- `uid`
- `name`
- `teamId`
- `teamName`
- `joinedAt`
- `joinedBy`
  - v1 固定等於本人 uid

### 規則
- 同一使用者在同一賽事只能出現在一支隊伍的 member 子集合中
- 使用者可取消自己的 member 記錄，再重新加入另一支已核准隊伍

## 列表頁與詳情頁資料來源
### 列表頁
- 讀 `tournaments` 主文件
- 使用：
  - `approvedTeamCount`
  - `teamLimit`
  - `status`
  - `organizerDisplay`

### 詳情頁
- 讀 `tournaments/{id}`
- 讀 `applications`
- 讀 `entries`
- 讀各隊 `members`

## 相容與遷移
- 現有 `registeredTeams` 暫時保留為 summary 欄位
- 實作時應提供過渡 helper：
  - 舊資料若只有 `registeredTeams`
  - 詳情頁可先 fallback 顯示已核准隊伍，但不支援完整新流程
- 新建立的友誼賽一律走新 schema，不再只寫平面陣列
