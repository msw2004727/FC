# 02 Permissions

## 角色範圍
- `captain`
- `leader`
- `coach`
- `delegate`
- `member`
- `admin`
- `super_admin`

## 建立賽事
### 允許
- `admin`
- `super_admin`
- 擁有至少一支球隊，且在該球隊是 `captain` 或 `leader` 的一般使用者

### 不允許
- 只有 `coach` 身分者
- 沒有球隊的非管理員使用者

### 主辦球隊選擇
- 一般使用者：
  - 只能從自己可管理的球隊中選擇
- `admin / super_admin`
  - 可從全部球隊中選擇

## 編輯賽事
### 允許
- 主辦球隊的 `captain`
- 主辦球隊的 `leader`
- 該賽事 `delegates`
- `admin / super_admin`

### 不允許
- 一般 `member`
- `coach`
- 非該賽事 delegate 的其他人

## 審核球隊申請
### 允許
- 主辦球隊的 `captain / leader`
- 該賽事 `delegates`
- `admin / super_admin`

### 規則
- 核准時必須重新檢查 `approvedTeamCount < teamLimit`
- 候審隊伍不先佔名額
- 已滿時不可再核准

## 代表球隊送出申請
### 允許
- 該球隊的 `captain`
- 該球隊的 `leader`

### 不允許
- 該球隊一般成員
- `coach`

## 隊員加入 roster
### 允許
- 使用者本人
- 且其所屬球隊已存在 `approved` 的 entry

### 不允許
- 替其他人加入
- 在候審球隊下加入
- 在被拒絕球隊下加入

## 委託人權限範圍
### 允許
- 編輯單一賽事資料
- 審核單一賽事球隊申請
- 收到單一賽事通知

### 不允許
- 管理其他賽事
- 取得全站賽事入口權限
- 直接變成球隊代表人

## 聯繫主辦人
- `聯繫主辦人` 按鈕預設聯繫對象為 `建立者（creatorUid）`
- 若未來要切換成主辦球隊代表人，需另開規格，不在 v1 內變更

## 可見性矩陣
### 主辦球隊 captain/leader
- 可見全部 applications、entries、members

### 委託人 delegate
- 可見全部 applications、entries、members

### 申請球隊成員
- 可見自己球隊的 application 狀態
- 可見全部公開 entries
- 不可見其他球隊的 pending / rejected application

### 第三方一般使用者
- 只可見公開 entries
- 完全不可見 pending / rejected application

## Firestore rules 方向
- `tournaments/{id}`：
  - create: `admin/super_admin` 或符合建賽資格者
  - update: `admin/super_admin` 或該賽事 host/delegate
- `applications/{applicationId}`：
  - create: 目標球隊 `captain/leader`
  - update: host/delegate/admin
- `entries/{teamId}`：
  - create/update: host/delegate/admin
- `entries/{teamId}/members/{uid}`：
  - create/delete: 本人且隊伍已核准
  - admin/host/delegate 可讀
