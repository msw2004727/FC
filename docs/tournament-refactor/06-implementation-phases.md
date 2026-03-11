# 06 Implementation Phases

## Phase 0：文件與架構預留
- 建立 `docs/tournament-refactor/`
- 建立 `js/modules/tournament/`
- 更新 `docs/architecture.md`

## Phase 1：資料與 API
- 定義新 tournament schema
- 新增子集合 gateway：
  - `applications`
  - `entries`
  - `members`
- 補齊 API helper：
  - 建賽
  - 查詢詳情
  - 送出申請
  - 核准/拒絕
  - 加入/退出 roster
- 保留舊資料 fallback

## Phase 2：權限與 rules
- 重寫 `tournaments` 規則
- 新增 `applications / entries / members` 規則
- 將 `captain / leader` 判斷抽成共用 helper
- 將 `delegate` 的賽事範圍權限抽成共用 helper

## Phase 3：建立/編輯表單
- 建立主辦球隊選擇欄
- 移動封面圖欄位到最頂
- 報名費改成開關式
- 保留委託人
- 將賽事類型鎖為 `friendly`

## Phase 4：詳情頁與球隊申請
- 重做詳情頁資訊區
- 加入三個操作按鈕
- 接上球隊申請流程
- 顯示 pending 隊伍灰色列
- 加入主辦審核操作

## Phase 5：隊員 roster
- 已核准球隊才開放隊員加入
- 建立多隊身份選擇 modal
- 建立取消參賽流程
- 詳情頁以每隊一列橫向顯示 roster

## Phase 6：通知與模板
- 新增友誼賽模板 key
- 主辦建賽通知
- 球隊申請通知
- 核准/拒絕通知
- 核准後球隊廣播

## Phase 7：清理與驗收
- 舊欄位 fallback 驗證
- UI 可見性驗證
- 角色/多隊/滿額邏輯驗證
- 文件與架構圖同步更新

## 驗收重點
- 符合資格者才能建賽
- 主辦隊自動入列
- 其他球隊需申請後才可核准
- 隊員只能加入已核准隊伍
- 候審隊伍第三方不可見
- 站內信模板可編輯且能正確送達

## 主要風險
- 舊 `registeredTeams` 過渡相容
- Firestore rules 由單純 admin-only 改為賽事範圍 ACL
- 多隊身分與 roster 唯一性衝突
- 子集合資料與主文件 summary 一致性

## 回滾原則
- 若 Phase 2 rules 或 Phase 4 詳情頁出現高風險，可保留新 schema 與舊 UI 並暫時關閉新入口
- `registeredTeams` 在過渡期保留，方便舊列表頁 fallback
