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

## 4.1 Phase 0（私測耐玩度）✅ 已完成

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

## 5.1 Phase 0（本地）✅ 已完成
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

## 6.1 Phase 0（已實作）✅
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
  - `uid` — 使用者 UID
  - `displayName` — LINE 顯示名稱
  - `score` — 本局分數（0~9999）
  - `shots` — 本局出手次數（>= 1）
  - `streak` — 本局最高連續進球數
  - `durationMs` — 本局局時毫秒（>= 5000）
  - `createdAt` — 提交時間戳（Firestore Timestamp）
  - `source` — 來源（`client` / `function`）
  - `flags` — 可疑訊號陣列（供後端標記）

## 7.2 排行彙總（讀取榜單）
- `shotGameRankings/{period_bucket}/entries/{uid}`
  - `uid` — 使用者 UID
  - `displayName` — LINE 顯示名稱
  - `bestScore` — 期間最高單次分數
  - `bestStreak` — 期間最高連續進球數
  - `bestAt` — 最高分達成時間（用於平手排序）
  - `updatedAt` — 最後更新時間

**period_bucket 格式**（Asia/Taipei 時區）：
- 日榜：`daily_2026-03-05`
- 週榜：`weekly_2026-W10`
- 月榜：`monthly_2026-03`

## 8. 安全策略
- Phase 0：Token gate + 不公開連結，僅耐玩度測試用途。✅ 已完成
- Phase 1：最小權限 + 基礎提交限制。
- Phase 2：Cloud Functions 驗證為主，前端不可直接寫關鍵彙總欄位。

### 8.1 Cloud Function 防刷規則（Phase 2）
`submitShotGameScore` onCall 必須通過以下驗證才入庫：
- 必須已登入（`request.auth` 存在）
- `score` 範圍：0 ~ 9999
- `durationMs` >= 5000（防閃退提交）
- `shots` >= 1
- 同 `uid` 同 `period_bucket` 每 10 秒最多 1 次提交（伺服器端節流）

## 9. 修改檔案清單（Phase 1~2）

| 檔案 | 改動 |
|------|------|
| `functions/index.js` | 新增 `submitShotGameScore` onCall Cloud Function |
| `js/api-service.js` | 新增 `submitShotGameScore()` 和 `getShotGameLeaderboard()` |
| `js/modules/shot-game-lab-page.js` | onGameOver 加提交呼叫；renderLeaderboard 改讀 Firestore |
| `firestore.rules` | 新增 shotGameScores 和 shotGameRankings 存取規則 |

## 10. 測試計劃

## 10.1 功能測試
- token 正確/錯誤/缺失。
- 遊戲流程：瞄準、蓄力、射門、得分、失敗、重開。
- 統計：寫入、重整後保留、重置、匯出。

## 10.2 相容與效能
- 手機直向/橫向視窗縮放。
- 低階裝置 `lowFx=1`。
- 重複進出頁面 20 次後穩定性。

## 10.3 Phase 1~2 追加測試
- 同日重複提交最高分保留。
- 週/月跨邊界切桶。
- 權限拒絕與錯誤訊息可理解。

## 11. 部署與回滾
- Phase 0 先上私測頁，不放正式導覽。
- 使用快取版號規則更新 `CACHE_VERSION` 與 `index.html` `?v=`。
- 若需回滾，移除私測頁入口並恢復上一版靜態資源版本。

## 12. 風險評估

| 風險 | 緩解方式 |
|------|---------|
| Token 外流 | 連結被分享導致非預期測試者進入，每輪測試更換 token |
| 本地資料不可稽核 | 僅供耐玩度參考，不能當正式排名 |
| 裝置效能差異 | 可能影響耐玩度結論，需記錄局時與體感 |
| 玩家未登入 | 遊戲仍可玩，提交靜默失敗，排行榜不顯示本人位置 |
| Cloud Function 冷啟動 | 非同步提交，不阻塞遊戲結束畫面 |
| 分數造假 | Cloud Function 驗證局時與分數上限 |
| Firestore 讀取費用 | client-side cache 5 分鐘 TTL |
| 時區邊界 | Cloud Function 統一用 Asia/Taipei 計算 bucket |

## 13. 工作量評估

| 步驟 | 複雜度 |
|------|-------|
| Phase 0 私測（已完成）| ✅ 完成 |
| Cloud Function submitShotGameScore | 中（約 80 行） |
| ApiService 新增兩個方法 | 低（約 40 行） |
| shot-game-lab-page.js 排行榜改讀 | 中 |
| shot-game-lab-page.js onGameOver | 低（約 5 行） |
| Firestore 安全規則 | 低 |
| 登入狀態整合 | 低~中 |
| **Phase 1~2 總計** | **預估 1.0~2.0 天** |

## 14. 亂碼檢查規則（實作必做）
- 任何新增或修改檔案，提交前必須檢查是否有無法判讀亂碼（mojibake）。
- 若可修復，應在同次實作內即時修復，避免把亂碼帶入主分支。
- 新增檔案一律使用 UTF-8，避免跨環境編碼漂移。

## 15. 私測連結格式（Phase 0）✅ 已完成
- URL：`https://<your-domain>/game-lab.html?t=<private-token>`
- 建議每輪測試更換 token，並僅在小範圍傳遞。
