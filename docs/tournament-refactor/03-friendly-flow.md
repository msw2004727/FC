# 03 Friendly Flow

## Flow A：建立友誼賽
1. 使用者開啟新增賽事 modal
2. 系統檢查其建賽資格
3. 使用者選擇 `主辦球隊`
4. 使用者填寫表單並建立
5. 系統建立：
   - `tournaments/{id}` 主文件
   - `entries/{hostTeamId}` 主辦隊 entry
6. 系統同步：
   - `approvedTeamIds = [hostTeamId]`
   - `approvedTeamCount = 1`
7. 系統發送主辦建賽通知給主辦隊成員

## Flow B：其他球隊申請參賽
1. 使用者進入賽事詳情頁
2. 點擊 `參加賽事`
3. 系統檢查此人是否為任一球隊的 `captain / leader`
4. 若只有一支可申請球隊：
   - 直接送出申請
5. 若有多支可申請球隊：
   - 彈出選隊 modal
6. 系統建立 `applications/{applicationId}`
7. 詳情頁對主辦與申請球隊顯示灰色 pending 列
8. 第三方仍看不到此申請

## Flow C：主辦審核球隊
1. 主辦方或委託人在詳情頁看到 pending 列
2. 可點：
   - `確認`
   - `拒絕`
3. 若點 `確認`：
   - 再次檢查 `approvedTeamCount < teamLimit`
   - application 狀態改 `approved`
   - 建立對應 `entries/{teamId}`
   - 更新 summary count
4. 若點 `拒絕`：
   - application 狀態改 `rejected`
5. v1 不支援被拒絕後重新申請

## Flow D：已核准球隊的隊員加入
1. 一般隊員進入詳情頁
2. 系統檢查其所屬球隊中，哪些已存在 `approved entry`
3. 若沒有：
   - 按鈕反灰
   - 點擊提示需先由球隊負責人報名並經主辦核准
4. 若有一支：
   - 直接加入該隊 member 子集合
5. 若有多支：
   - 先跳出選隊 modal
   - 使用者選定後再加入
6. UI 立即將該人顯示在該隊 roster

## Flow E：隊員取消參賽
1. 使用者點擊取消參賽
2. 系統刪除該人在目標隊伍 members 子集合中的記錄
3. 不影響隊伍本身的 approved 狀態
4. 使用者可重新加入其他已核准隊伍

## Flow F：主辦隊成員加入
1. 主辦球隊建立賽事後，自動成為第一支已核准隊伍
2. 主辦隊成員收到站內信後，可直接到詳情頁加入主辦隊 roster
3. v1 不要求主辦隊建立當下就必須有 roster 成員

## 邊界條件
- `pending` 球隊不佔名額
- 核准瞬間超過 4 隊時，後核准者必須被阻止
- 同一人同一賽事只能在一支隊伍 roster 中出現一次
- 同一支球隊同一賽事同時間只能有一筆有效申請
