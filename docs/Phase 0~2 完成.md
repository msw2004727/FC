# 3D Charged Shot 私測到正式上線完整規格（Phase 0~2）

## 1. 背景與目標
- 將 `3D Charged Shot` 足球射門小遊戲導入 SportHub。
- 先提供不公開私測入口驗證耐玩度，再逐步接入正式排行榜。
- 排行榜規則採「期間最高單次分數」，區分日/週/月。
- 排名顯示使用完整 LINE 名稱（依目前產品決策）。

## 2. 決策鎖定（本文件預設）
- 私測入口：隱藏路由 + Token。
- 私測資料：僅本地 localStorage，不寫 Firebase。
- 排名規則：期間最高單次分數。
- 上線節奏：Phase 0（私測） -> Phase 1（日榜 MVP） -> Phase 2（週/月 + 強化驗證）。
- 時區：`Asia/Taipei`。

## 3. 範圍與非範圍
### 3.1 In Scope
- 射門遊戲核心可玩、可重開、可顯示分數。
- 私測入口保護（Token 驗證）。
- 私測統計（遊玩次數、最高分、平均局時、最近遊玩時間）。
- 正式版本排行榜資料流與安全策略規格。

### 3.2 Out of Scope（Phase 0）
- Phase 0 不寫 Firestore 分數。
- Phase 0 不上正式站內 modal 入口。
- Phase 0 不做日/週/月雲端排行 UI。

## 4. Phase 規格

## 4.1 Phase 0（私測耐玩度）
### 目標
- 讓指定測試者透過不公開連結遊玩，收集本地耐玩度指標。

### 交付項目
- 私測頁：`/game-lab.html?t=<token>`。
- Token gate：無效 token 不載入遊戲主體。
- 3D 遊戲模組化（與 markdown 原始碼分離）。
- localStorage 測試統計工具面板：
  - 最高分
  - 遊玩次數
  - 平均局時
  - 最近遊玩時間
  - 匯出 JSON
  - 重置統計

### 驗收標準
- 有效 token 可正常遊玩與重開。
- 無效 token 顯示阻擋畫面，不初始化 Three.js 場景。
- 本地統計可累計、可重置、可匯出。
- 頁面反覆重開無明顯記憶體洩漏（renderer 與事件監聽可釋放）。

## 4.2 Phase 1（正式 MVP）
### 目標
- 將遊戲以 modal 形式接入主站並上線「日榜」。

### 交付項目
- 站內 modal 開啟/關閉流程與資源清理。
- `ApiService.submitShotGameScore()`。
- 日榜資料彙總（每位使用者當日最高單次分數）。
- Firestore rules 最小權限控管（本人寫入、受控彙總寫入）。
- 基礎防刷（節流、最小局時、提交頻率限制）。

### 驗收標準
- 同使用者同日多次提交只保留最高分。
- 日榜排序正確（分數降序，平手用較早達成時間）。
- 未登入或權限不符時不允許提交。

## 4.3 Phase 2（擴充）
### 目標
- 完整化日/週/月榜與後端驗證。

### 交付項目
- 週榜、月榜資料桶（bucket）與查詢。
- 分數寫入切換到 Cloud Functions 驗證主路徑。
- 進階反作弊訊號（異常高分、超短局時、頻率異常）。
- 監控儀表（提交成功率、函式錯誤率、異常分數數量）。

### 驗收標準
- 日/週/月榜切換正確、邊界日期正確。
- 非法提交在後端被阻擋並有可追蹤記錄。

## 5. 架構與資料流

## 5.1 Phase 0（本地）
1. User 開啟 `game-lab.html`。
2. Page Controller 驗證 query token。
3. 通過後才初始化 `ShotGameEngine`。
4. 每局結束觸發 `onGameOver`，寫入 `ShotGameMetrics`（localStorage）。
5. 面板顯示最新摘要，可匯出 JSON 供人工分析。

## 5.2 Phase 1~2（雲端）
1. User 完成一局。
2. 前端封裝 payload（分數、局時、時間戳、基本指紋）。
3. Phase 1 可先直寫受限路徑（混合模式第一步）。
4. Phase 2 改為呼叫 Cloud Function 驗證後入庫。
5. 後端更新對應 period bucket 最佳分數。
6. 前端讀取排行榜集合渲染 UI。

## 6. 介面/API 規格

## 6.1 Phase 0（已實作目標）
- `window.ShotGameLabPage.init(options)`
  - `requiredTokenHash: string`
  - `tokenQueryKey?: string`（預設 `t`）
  - `storageKey?: string`
- `window.ShotGameEngine.create(options)`
  - `container: HTMLElement`
  - `onScoreChange?: (payload) => void`
  - `onGameOver?: (payload) => void`
  - `lowFx?: boolean`
  - 回傳 engine 實例，提供 `destroy()`

## 6.2 Phase 1~2（保留）
- `ApiService.submitShotGameScore(payload)`
- `ApiService.getShotGameLeaderboard({ period, bucket })`

## 7. 資料模型（Phase 1~2）

## 7.1 原始成績（寫入稽核）
- `shotGameScores/{uid}/attempts/{attemptId}`
  - `uid`
  - `displayName`
  - `score`
  - `durationMs`
  - `createdAt`
  - `source`（client/function）
  - `flags`（可疑訊號）

## 7.2 排行彙總（讀取榜單）
- `shotGameRankings/{period_bucket}/entries/{uid}`
  - `uid`
  - `displayName`
  - `bestScore`
  - `bestAt`
  - `updatedAt`

## 8. 安全策略
- Phase 0：Token gate + 不公開連結，僅耐玩度測試用途。
- Phase 1：最小權限 + 基礎提交限制。
- Phase 2：Cloud Functions 驗證為主，前端不可直接寫關鍵彙總欄位。

## 9. 測試計劃

## 9.1 功能測試
- token 正確/錯誤/缺失。
- 遊戲流程：瞄準、蓄力、射門、得分、失敗、重開。
- 統計：寫入、重整後保留、重置、匯出。

## 9.2 相容與效能
- 手機直向/橫向視窗縮放。
- 低階裝置 `lowFx=1`。
- 重複進出頁面 20 次後穩定性。

## 9.3 Phase 1~2 追加測試
- 同日重複提交最高分保留。
- 週/月跨邊界切桶。
- 權限拒絕與錯誤訊息可理解。

## 10. 部署與回滾
- Phase 0 先上私測頁，不放正式導覽。
- 使用快取版號規則更新 `CACHE_VERSION` 與 `index.html` `?v=`。
- 若需回滾，移除私測頁入口並恢復上一版靜態資源版本。

## 11. 風險評估
- Token 外流：連結被分享導致非預期測試者進入。
- 本地資料不可稽核：僅供耐玩度參考，不能當正式排名。
- 裝置效能差異：可能影響耐玩度結論，需記錄局時與體感。

## 12. 工作量評估
- Phase 0：0.5 ~ 1.5 天（中）
- Phase 1：1.0 ~ 2.5 天（中高）
- Phase 2：1.5 ~ 3.0 天（中高）

## 13. 亂碼檢查規則（實作必做）
- 任何新增或修改檔案，提交前必須檢查是否有無法判讀亂碼（mojibake）。
- 若可修復，應在同次實作內即時修復，避免把亂碼帶入主分支。
- 新增檔案一律使用 UTF-8，避免跨環境編碼漂移。

## 14. 私測連結格式（Phase 0）
- URL：`https://<your-domain>/game-lab.html?t=<private-token>`
- 建議每輪測試更換 token，並僅在小範圍傳遞。
