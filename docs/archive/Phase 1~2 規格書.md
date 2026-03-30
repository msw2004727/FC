# 3D Charged Shot 私測到正式上線完整規格（Phase 0~2）

## 1. 背景與目標
- 將 `3D Charged Shot` 足球射門小遊戲導入 ToosterX。
- 先提供不公開私測入口驗證耐玩度，再逐步接入正式排行榜。
- 排行榜規則採「期間最高單次分數」，區分日/週/月。
- 排名顯示使用完整 LINE 名稱（依目前產品決策）。

## 2. 決策鎖定（本文件預設）
- 私測入口：隱藏路由 + Token。
- 私測資料：僅本地 localStorage，不寫 Firebase。
- 排名規則：期間最高單次分數。
- 上線節奏：Phase 0（私測） -> Phase 1（日榜 MVP） -> Phase 2（週/月 + 強化驗證）。
- 時區：`Asia/Taipei`。
- **提交路徑：直接使用 Cloud Function（跳過 Phase 1 直寫 Firestore 混合模式），一次到位。**
- **登入要求：正式站必須先登入才能遊玩與提交。**
- **Modal 入口：暫緩，未來另行新增。**

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
- 將遊戲接入主站並上線「日榜」，必須登入才能遊玩。

### 交付項目
- `ApiService.submitShotGameScore()` 呼叫 Cloud Function。
- `ApiService.getShotGameLeaderboard()` 讀取 Firestore 排行彙總。
- 日榜資料彙總（每位使用者當日最高單次分數）。
- Firestore rules 最小權限控管（前端唯讀榜單；Cloud Function Admin SDK 寫入）。
- Cloud Function 基礎防刷（登入驗證、score 範圍、durationMs、shots、節流）。

### 驗收標準
- 同使用者同日多次提交只保留最高分。
- 日榜排序正確（分數降序，平手用較早達成時間）。
- 未登入不允許進入遊戲。

## 4.3 Phase 2（擴充）
### 目標
- 完整化日/週/月榜與稽核。

### 交付項目
- 週榜、月榜資料桶（bucket）與查詢。
- 進階反作弊訊號（flags 標記異常高分、超短局時、頻率異常）。
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
1. User 登入後完成一局。
2. 前端封裝 payload（分數、局時、shots、streak、時間戳）。
3. 呼叫 `submitShotGameScore` Cloud Function（onCall）。
4. Cloud Function 驗證 + 寫入 `shotGameScores` + 更新 `shotGameRankings` 最高分。
5. 前端讀取 `shotGameRankings/{period_bucket}/entries` 渲染排行榜 UI。

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

## 6.2 Phase 1~2
- `ApiService.submitShotGameScore(payload)` — 呼叫 Cloud Function onCall
- `ApiService.getShotGameLeaderboard({ period, bucket })` — 讀 Firestore

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
  - `source` — 來源（`function`）
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
- Phase 1~2：Cloud Functions Admin SDK 寫入，前端只能讀榜單，不可直接寫任何 shotGame 集合。

### 8.1 Cloud Function 防刷規則
`submitShotGameScore` onCall 必須通過以下驗證才入庫：
- 必須已登入（`request.auth` 存在）
- `score` 範圍：0 ~ 9999
- `durationMs` >= 5000（防閃退提交）
- `shots` >= 1
- 同 `uid` 同 `period_bucket` 每 10 秒最多 1 次提交（伺服器端節流）

## 9. 修改檔案清單（Phase 1~2）

| 檔案 | 改動 |
|------|------|
| `firestore.rules` | 新增 shotGameScores（owner 可讀）和 shotGameRankings（登入可讀）規則；前端不可寫 |
| `functions/index.js` | 新增 `submitShotGameScore` onCall Cloud Function |
| `js/api-service.js` | 新增 `submitShotGameScore()` 和 `getShotGameLeaderboard()` |
| `js/modules/shot-game-lab-page.js` | onGameOver 加提交呼叫；renderLeaderboard 改讀 Firestore；加登入驗證 |

---

## 10. 實作步驟追蹤

### 步驟 1 — Firestore 安全規則（`firestore.rules`）
- **狀態**：✅ 完成（2026-03-05）
- **改動**：新增 `shotGameScores` 與 `shotGameRankings` 兩段規則
  - `shotGameScores/{uid}/attempts/{attemptId}`：本人可讀；前端不可寫（Cloud Function Admin SDK 寫入）
  - `shotGameRankings/{period_bucket}/entries/{uid}`：登入可讀；前端不可寫
- **備注**：—

### 步驟 2 — Cloud Function `submitShotGameScore`（`functions/index.js`）
- **狀態**：✅ 完成（2026-03-05）
- **改動**：新增 `getTaipeiDateInfo()` UTC+8 bucket 計算；`submitShotGameScore` onCall；驗證 score/shots/durationMs；10 秒節流；寫入 shotGameScores + 更新 shotGameRankings
- **備注**：採直寫 Admin SDK，繞過 Firestore rules

### 步驟 3 — ApiService 兩個方法（`js/api-service.js`）
- **狀態**：✅ 完成（2026-03-05）
- **改動**：新增 `submitShotGameScore()`（呼叫 Cloud Function，未登入回傳 null）；`getShotGameLeaderboard()`（讀 Firestore，5 分鐘 cache，Demo 回傳 stub 資料）；`_shotGameLeaderboardCache` 屬性
- **備注**：firebase-functions-compat.js 已在 app.js `_loadCDNScripts()` 載入，可直接使用 `firebase.app().functions('asia-east1')`

### 步驟 4 — onGameOver 加提交呼叫（`js/modules/shot-game-lab-page.js`）
- **狀態**：✅ 完成（2026-03-05）
- **改動**：遊戲結束後非同步呼叫 `ApiService.submitShotGameScore()`；提交成功後清除 cache 並重整榜單；未登入或分數 0 靜默跳過
- **備注**：—

### 步驟 5 — 日榜 UI 改讀 Firestore（`js/modules/shot-game-lab-page.js`）
- **狀態**：✅ 完成（2026-03-05）
- **改動**：新增 `getTaipeiDateBucket(period)` client-side bucket 計算；`renderLeaderboard` 改為 async；加入載入中、空榜、讀取失敗三態；Firestore 資料格式轉換後沿用既有 `buildLeaderboardView` 排序邏輯
- **備注**：—

### 步驟 6 — 週/月 bucket 與榜單切換（`js/modules/shot-game-lab-page.js`）
- **狀態**：✅ 完成（2026-03-05）
- **改動**：不需額外程式碼——`getTaipeiDateBucket(period)` 已支援 weekly/monthly；tab click 觸發 `renderLeaderboard(period)` 已傳入正確 period，Firestore query 自動用對應 bucket
- **備注**：週/月 bucket 資料為空時顯示「尚無排行資料」

### 步驟 7 — 進階防刷稽核 flags（`functions/index.js`）
- **狀態**：✅ 完成（2026-03-05）
- **改動**：在 `submitShotGameScore` 寫入前計算 flags：`near_max_score`（>7000）、`fast_game`（<8s）、`high_score_per_shot`（>150/shot）、`high_streak`（>20）；flags 非空時 `console.warn` 供 Cloud Logging 查詢；不阻擋正常玩家
- **備注**：—

---

## 11. 測試計劃

## 11.1 功能測試
- token 正確/錯誤/缺失。
- 遊戲流程：瞄準、蓄力、射門、得分、失敗、重開。
- 統計：寫入、重整後保留、重置、匯出。

## 11.2 相容與效能
- 手機直向/橫向視窗縮放。
- 低階裝置 `lowFx=1`。
- 重複進出頁面 20 次後穩定性。

## 11.3 Phase 1~2 追加測試
- 同日重複提交最高分保留。
- 週/月跨邊界切桶。
- 權限拒絕與錯誤訊息可理解。

## 12. 部署與回滾
- 使用快取版號規則更新 `CACHE_VERSION` 與 `index.html` `?v=`。
- 若需回滾，移除 Cloud Function 部署並恢復上一版靜態資源版本。

## 13. 風險評估

| 風險 | 緩解方式 |
|------|---------|
| 玩家未登入 | 遊戲頁面強制登入，未登入直接阻擋 |
| Cloud Function 冷啟動 | 非同步提交，不阻塞遊戲結束畫面 |
| 分數造假 | Cloud Function 驗證局時與分數上限 |
| Firestore 讀取費用 | client-side cache 5 分鐘 TTL |
| 時區邊界 | Cloud Function 統一用 Asia/Taipei 計算 bucket |
| 規則寫錯阻擋合法操作 | 部署前在 Firebase 模擬器驗證 |

## 14. 工作量評估

| 步驟 | 複雜度 | 狀態 |
|------|-------|------|
| 步驟 1：Firestore 安全規則 | 低（約 20 行） | ✅ 完成 |
| 步驟 2：Cloud Function submitShotGameScore | 中（約 80 行） | ✅ 完成 |
| 步驟 3：ApiService 兩個方法 | 低（約 40 行） | ✅ 完成 |
| 步驟 4：onGameOver 加提交呼叫 | 低（約 10 行） | ✅ 完成 |
| 步驟 5：日榜 UI 改讀 Firestore | 中（約 60 行） | ✅ 完成 |
| 步驟 6：週/月 bucket 切換（Phase 2） | 低（無需額外程式碼） | ✅ 完成 |
| 步驟 7：進階防刷稽核（Phase 2） | 低（約 10 行） | ✅ 完成 |
| **Phase 1 總計** | **預估 0.5~1.0 天** | — |
| **Phase 2 總計** | **預估 0.5~1.0 天** | — |

## 15. 亂碼檢查規則（實作必做）
- 任何新增或修改檔案，提交前必須檢查是否有無法判讀亂碼（mojibake）。
- 若可修復，應在同次實作內即時修復，避免把亂碼帶入主分支。
- 新增檔案一律使用 UTF-8，避免跨環境編碼漂移。
