# ToosterX 即時快取顯示 + 背景即時更新 計劃書

> 三位專家（前端架構師、風險管理、效能工程師）共識文件
> 領導整合：Claude Opus 4.6
> 日期：2026-04-04

---

## 一、計劃目的

消除回訪用戶每次開啟 App 時 1-3 秒的白屏等待。改為：**立即顯示快取內容（< 0.3 秒）**，同時**背景持續載入最新資料**，新資料到達後自動更新畫面。適用於整個網站。

---

## 二、起因

目前的啟動流程是：

```
開啟 App → 白屏 / 載入動畫（1-3 秒）→ Firebase SDK 下載完 → Firestore 查詢完 → 才顯示內容
```

但 70% 的回訪用戶其實**已有完整快取在 localStorage 裡**。他們等待的 1-3 秒純粹是在等一個他們暫時不需要的東西（Firebase SDK）。

---

## 三、改善後的啟動流程

```
開啟 App → 從 localStorage 還原快取（30ms）→ 立即渲染畫面（80ms）→ 用戶可操作
                                                      ↓ 背景同時進行
                                            Firebase SDK 下載 + 初始化
                                                      ↓
                                            Firestore 查詢最新資料
                                                      ↓
                                            自動更新畫面有變動的部分
```

---

## 四、預估成果

### 回訪用戶（有快取，佔 70% 的 session）

| 指標 | 現況 | 改善後 | 改善幅度 |
|------|------|--------|---------|
| 首次看到內容 | 1.2-1.8s | **0.15-0.35s** | **↓ 80%** |
| 可互動時間 | 2.5-3.5s | **0.2-0.5s** | **↓ 85%** |
| 完整最新資料到達 | 1.5-3.5s | 2.0-5.0s | 稍慢（背景載入） |

### 慢網路回訪用戶（3G / 不穩定，佔 15%）

| 指標 | 現況 | 改善後 |
|------|------|--------|
| 首次看到內容 | 3-6s（常觸發「連線不穩」提示） | **0.15-0.35s** |
| 可互動時間 | 6-15s | **0.2-0.5s** |

### 新用戶（無快取，佔 5-10%）

| 指標 | 現況 | 改善後 |
|------|------|--------|
| 首次看到內容 | ~1.8s | ~1.8s（**無變化**） |
| 可互動時間 | ~3.5s | ~3.5s（**無變化**） |

### 與 esbuild 打包方案對比

| 方案 | 回訪用戶改善 | 新用戶改善 | 風險 | 工時 |
|------|------------|-----------|------|------|
| **即時快取（本計劃）** | 🔥🔥🔥🔥🔥 | 無 | 低-中 | 4-6 小時 |
| esbuild 打包 | 🔥 | 🔥🔥🔥 | 中 | 3 小時 |
| 兩者合併 | 🔥🔥🔥🔥🔥 | 🔥🔥🔥 | 中 | 7-9 小時 |

**建議**：先做本計劃（效果最大），再做 esbuild（互補不衝突）。

---

## 五、施作範圍

### 會修改的檔案

| 檔案 | 變更內容 | 風險 |
|------|---------|------|
| **app.js** | 重構啟動序列：Phase 3 永遠渲染快取 + 立即關閉 overlay；新增 `_startBackgroundCloudBoot()` 替代阻塞式 `ensureCloudReady()` | 高 |
| **js/firebase-service.js** | 新增 `_notifyCacheUpdated(collectionName)` 統一通知機制；移除重複的 `_restoreCache()` 呼叫；各集合到達時逐一通知 UI 更新 | 中 |
| **js/core/navigation.js** | 放寬 cloud-gate：有快取時先渲染再背景刷新 | 中 |
| **index.html** | 新增 preconnect hints、骨架佔位 HTML、SWR 進度條元素 | 低 |
| **css/（既有檔案）** | 新增骨架動畫 `.skel-card`、更新進度條 `.swr-bar`、過期指示器樣式 | 低 |
| **js/config.js** | 版本號更新 | 低 |
| **sw.js** | 版本號更新 | 低 |

### 不會修改的檔案

| 檔案 / 目錄 | 原因 |
|-------------|------|
| `inventory/` | 獨立系統，不受影響 |
| `functions/index.js` | Cloud Functions，純伺服器端 |
| `firestore.rules` | 安全規則不變 |
| `js/firebase-crud.js` | 鎖定模組，報名系統不動 |
| `js/api-service.js` | 純讀取快取，不需改 |
| `pages/*.html` | HTML 片段不變 |
| 所有懶載入模組（155 個） | ScriptLoader 機制不變 |

### 不需要新增的檔案

**無新增 JS 檔案**。所有邏輯在既有檔案內完成：
- `_notifyCacheUpdated()` → `firebase-service.js`
- 啟動序列重構 → `app.js`
- 骨架 HTML/CSS → `index.html` + 既有 CSS

---

## 六、施作步驟

### Step 1（最低風險）：新增通知機制

在 `firebase-service.js` 新增 `_notifyCacheUpdated(collectionName)`，所有寫入 `_cache` 的路徑都透過它通知 UI。這是純增量變更，不影響既有行為。

### Step 2：新增骨架 CSS + HTML

在 `index.html` 和 CSS 加入骨架佔位卡片（shimmer 動畫）和 SWR 進度條。純增量。

### Step 3：修改 Phase 3 — 永遠渲染快取

`app.js` 的 DOMContentLoaded handler：
- `renderAll()` 後**永遠關閉 overlay**
- 有快取 → 顯示內容
- 無快取 → 顯示骨架佔位（不是阻塞式 overlay）

### Step 4（最高風險）：重構 ensureCloudReady

將 `ensureCloudReady()` 拆分為：
- `_startBackgroundCloudBoot()` — 非阻塞，fire-and-forget
- `ensureCloudReady()` 保留為 thin wrapper（回傳 promise，供導航程式碼使用）

Firebase SDK + Firestore 初始化改為背景執行，每個集合到達時透過 `_notifyCacheUpdated()` 逐一更新 UI。

### Step 5：放寬導航 cloud-gate

`navigation.js` 的 `showPage()` 改為：
- 有快取 → 先渲染快取 → 背景刷新
- 無快取 → 顯示骨架 → 等 `ensureCollectionsForPage()` 完成 → 渲染

---

## 七、風險評估

### R-1：用戶看到過期資料後操作（例：已額滿的活動顯示有名額）

| 項目 | 內容 |
|------|------|
| 可能性 | 中高 |
| 影響 | 中（Firestore transaction 會擋住超收，不會造成資料錯誤） |
| 緩解 | `handleSignup()` 已有 `_cloudReady` 守衛，SDK 未就緒時顯示「系統載入中」；報名用 `runTransaction` 原子操作，服務端為最終權威 |
| 應急 | 若用戶反映困惑，加入報名前即時重查確認對話框 |

### R-2：Firebase SDK 載入失敗 — 用戶以為看到的是即時資料

| 項目 | 內容 |
|------|------|
| 可能性 | 低中 |
| 影響 | 高 |
| 緩解 | `_cloudReady === false` 超過 8 秒後顯示持續性離線橫幅「目前顯示的是離線資料，連線後自動更新」；所有寫入操作按鈕在 `_cloudReady === false` 時停用 |
| 應急 | 現有 20 秒安全超時 + 重載提示仍為最後防線 |

### R-3：用戶在 SDK 就緒前觸發寫入操作

| 項目 | 內容 |
|------|------|
| 可能性 | 低（`handleSignup` 已有守衛） |
| 影響 | 中高 |
| 緩解 | 審計所有 CRUD 入口點，加入共用的 `_requireCloudReady()` 守衛函式 |
| 應急 | Firestore Security Rules 為服務端最後防線，未認證的寫入會被拒絕 |

### R-4：即時監聽與背景刷新衝突

| 項目 | 內容 |
|------|------|
| 可能性 | 中 |
| 影響 | 低中（下一次 snapshot 會自動修正） |
| 緩解 | 「監聽優先」策略：一旦 `onSnapshot` 啟動，該集合的 `.get()` 結果不覆寫快取 |

### R-5：localStorage 資料損壞導致亂渲染

| 項目 | 內容 |
|------|------|
| 可能性 | 低 |
| 影響 | 中 |
| 緩解 | `_restoreCache()` 加入輕量結構驗證（檢查首筆資料是否有必要欄位）；不通過則丟棄該集合快取 |

### R-7：部分集合更新、部分未更新 — 不一致狀態

| 項目 | 內容 |
|------|------|
| 可能性 | 中 |
| 影響 | 中（純視覺問題，寫入路徑不受影響） |
| 緩解 | 相關集合分組刷新（events + registrations 必須同步），任一失敗則整組保持快取版 |

---

## 八、回滾計劃

### 觸發條件
- 用戶回報白屏或亂碼渲染
- 報名投訴量超過基準值
- `_cloudReady` 長期無法變為 `true`

### 回滾步驟（15 分鐘內完成）

```bash
# 1. 還原 commit
git revert <commit-sha>

# 2. 更新版本號（強制清除所有用戶快取）
# 4 處：config.js、sw.js、index.html var V、index.html ?v=

# 3. 推送
git push origin main

# 4. Cloudflare Pages 自動部署（1-2 分鐘）
```

### 不可逆的變更
**無。** 所有修改都是純前端 JS，沒有 Firestore schema 變更、沒有伺服器端變更、沒有資料遷移。`git revert` + 版本號更新即完全還原。

---

## 九、驗收清單

| # | 測試 | 預期結果 |
|---|------|---------|
| 1 | 回訪用戶開啟 App | 0.3 秒內看到活動列表（快取），無 overlay |
| 2 | SWR 進度條 | `_cloudReady === false` 時頂部顯示細進度條 |
| 3 | 背景更新完成 | 進度條消失，活動列表靜默更新（若有變動） |
| 4 | 新用戶首次開啟 | 骨架佔位 → 資料到達後逐一填入 |
| 5 | 慢網路回訪用戶 | 立即顯示快取，離線橫幅在 8 秒後出現 |
| 6 | 報名操作（SDK 未就緒） | 顯示「系統載入中」toast，不執行 |
| 7 | 報名操作（SDK 就緒） | 正常報名流程 |
| 8 | 頁面切換（有快取） | 立即顯示，背景刷新 |
| 9 | Console 無錯誤 | 零 TypeError / ReferenceError |
| 10 | LINE WebView（iOS + Android） | 正常載入，無白屏 |
| 11 | 離線後重載 | SW 快取提供靜態資源 + localStorage 提供資料 |
| 12 | 版本更新後首次載入 | localStorage 快取仍可用（獨立於 SW 快取） |

---

## 十、部署後監控（48 小時）

### 0-2 小時：主動監控
- JS 錯誤日誌（Admin > Error Logs）
- overlay 持續時間（performance beacon 記錄）
- 404 錯誤
- LINE WebView 載入

### 2-24 小時：每 4 小時
- 錯誤日誌量（超過基準 2 倍 → 調查）
- 報名成功率（下降 30% → 調查）

### 48 小時決策門檻

| 🟢 綠燈 | 零致命錯誤，overlay 時間 < 0.35s（回訪用戶） |
| 🟡 黃燈 | 有小問題但已修補 |
| 🔴 紅燈 | 致命問題 → 執行回滾 |

---

## 十一、工時評估

| 階段 | 時間 | 內容 |
|------|------|------|
| Step 1：通知機制 | 1 小時 | `_notifyCacheUpdated()` + 所有寫入路徑接線 |
| Step 2：骨架 UI | 30 分鐘 | CSS shimmer + HTML 佔位 + SWR bar |
| Step 3：Phase 3 永遠渲染 | 1 小時 | overlay 邏輯 + 骨架顯示 |
| Step 4：背景 cloud boot | 1.5 小時 | 拆分 ensureCloudReady + 測試 |
| Step 5：導航 cloud-gate 放寬 | 30 分鐘 | showPage 修改 + 測試 |
| 測試 + 效能量測 | 1 小時 | 12 項驗收清單 + Lighthouse |
| **總計** | **5-6 小時** | |

---

## 十二、專家共識聲明

三位專家一致同意：

1. **即時快取顯示是目前能做的最高效能改善** — 70% 用戶立即受益
2. **背景更新使用逐集合通知機制（`_notifyCacheUpdated`）** — 比整頁 `renderAll()` 更精確
3. **所有寫入操作必須保持 `_cloudReady` 守衛** — 過期資料只能看不能寫
4. **新用戶體驗不變** — 無快取時仍顯示骨架/載入動畫
5. **與 esbuild 打包完全互補** — 可分別獨立實施，建議先做本計劃
6. **回滾 15 分鐘內可完成** — 純前端變更，無不可逆操作

---

*本計劃書由前端架構專家、風險管理專家、效能工程專家共同審核通過。*
*領導整合：Claude Opus 4.6 (1M context)*
*專案：ToosterX — toosterx.com*
