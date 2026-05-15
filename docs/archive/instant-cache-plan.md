# ToosterX 即時快取顯示 + 背景即時更新 計劃書

> v2 — 三輪專家審查後修正版
> 三位專家（前端架構師、風險管理、效能工程師）共識文件
> 領導整合：Claude Opus 4.6
> 日期：2026-04-04（v2 修正：同日）

---

## 一、計劃目的

消除回訪用戶每次開啟 App 時 1-3 秒的白屏等待。改為：**立即顯示快取內容（< 0.5 秒）**，同時**背景持續載入最新資料**，新資料到達後自動更新畫面。適用於全站 35 個用戶導航頁面。

---

## 二、起因

目前的啟動流程是：

```
開啟 App → 白屏 / 載入動畫（1-3 秒）→ Firebase SDK 下載完 → Firestore 查詢完 → 才顯示內容
```

但 70% 的回訪用戶其實**已有完整快取在 localStorage 裡**。他們等待的 1-3 秒純粹是在等一個他們暫時不需要的東西（Firebase SDK）。

### 現有機制（計劃需利用，非新增）

- `FirebaseService._restoreCache()` — 已存在，從 localStorage 還原快取到記憶體（**只呼叫一次**，在 Phase 2）
- Phase 3 已有快取命中判斷：`_homeHasContent` 為 true 時呼叫 `_dismissBootOverlay('Phase 3 快取命中')`
- `FirebaseService.init()` Step 2.5 已有 **15 分鐘 TTL 快速路徑**：快取夠新時跳過啟動等待，背景靜默更新
- `stale-first` 頁面策略已在 25 個頁面上實現

**但問題是**：即使 Phase 3 快取命中關閉了 overlay，Phase 4 的 `ensureCloudReady()` 仍在背景阻塞其他操作（導航守衛、登入流程）。且有 10 個頁面未加入 SWR 策略。

---

## 三、改善後的啟動流程

```
開啟 App → 從 localStorage 還原快取（50-100ms）→ App.init() 綁定 + 渲染（150-250ms）
  ↓ 有快取                               ↓ 無快取
  立即關閉 overlay，顯示內容               顯示骨架佔位（非阻塞式 overlay）
  SWR 進度條顯示中                         SWR 進度條顯示中
  ↓ 背景同時進行                           ↓ 背景同時進行
  Firebase SDK 下載 + 初始化               Firebase SDK 下載 + 初始化
  ↓                                       ↓
  Firestore 逐集合查詢                     Firestore 逐集合查詢
  ↓ 每個集合到達                            ↓ 每個集合到達
  _notifyCacheUpdated() → 選擇性重渲染     骨架逐一替換為真實內容
  ↓ 全部到達                               ↓ 全部到達
  SWR 進度條消失                           SWR 進度條消失
```

---

## 四、預估成果（保守估計，經效能專家修正）

### 回訪用戶（有快取，佔 70% 的 session）

| 指標 | 現況 | 改善後（保守） | 改善幅度 |
|------|------|---------------|---------|
| 首次看到內容 | 1.2-1.8s | **0.28-0.5s** | **↓ 60-75%** |
| 可瀏覽時間（可滾動、看內容） | 2.5-3.5s | **0.5-0.8s** | **↓ 70-80%** |
| 可寫入時間（報名等操作） | 2.5-3.5s | 1.5-3.5s | 不變（需等 SDK） |
| 完整最新資料到達 | 1.5-3.5s | 2.0-5.0s | 稍慢（背景載入） |

### 慢網路回訪用戶（3G / 不穩定，佔 15%）

| 指標 | 現況 | 改善後 |
|------|------|--------|
| 首次看到內容 | 3-6s（常觸發「連線不穩」提示） | **0.5-0.8s** |
| 可瀏覽時間 | 6-15s | **0.5-0.8s** |

### 新用戶（無快取，佔 5-10%）

| 指標 | 現況 | 改善後 |
|------|------|--------|
| 首次看到內容 | ~1.8s | ~1.8s（**無變化**，但改為骨架佔位而非阻塞式 overlay） |
| 可互動時間 | ~3.5s | ~3.5s（**無變化**） |

### 不會改善的項目（誠實揭露）

| 項目 | 原因 |
|------|------|
| Firebase SDK 載入時間（1-3s） | CDN 外部請求，不在控制範圍 |
| Firestore 首次查詢延遲（0.3-0.8s） | WebSocket 建立，與快取無關 |
| 報名等寫入操作的等待時間 | 必須等 SDK 就緒，`_cloudReady` 守衛不可移除 |
| CSS 解析時間（14 檔案，30-80ms） | 需搭配 esbuild 才能改善 |
| CJK 字型載入（Noto Sans TC, 100-300ms） | 外部字型 CDN，不在控制範圍 |
| ScriptLoader 懶載入（首次切頁 100-500ms） | 模組仍為個別檔案 |

### 效能數字的計算基礎

| 階段 | 工作內容 | 預估時間 |
|------|---------|---------|
| Phase 2 `_restoreCache()` | 5-10 個集合 JSON.parse（~400KB） | 50-100ms |
| Phase 3 `App.init()` 核心綁定 | 30-50 個 DOM 查詢 + 25-35 個事件綁定 | 80-150ms |
| `renderAll()` | banner + announcement + 10 張活動卡片 | 100-150ms |
| 瀏覽器 paint + composite | 首次繪製 | 50-100ms |
| **合計（快取命中路徑）** | | **280-500ms** |

### 與 esbuild 打包方案對比

| 方案 | 回訪用戶改善 | 新用戶改善 | 風險 | 工時 |
|------|------------|-----------|------|------|
| **即時快取（本計劃）** | 🔥🔥🔥🔥🔥 | 無 | 低-中 | 6 小時 |
| esbuild 打包 | 🔥 | 🔥🔥🔥 | 中 | 3 小時 |
| 兩者合併 | 🔥🔥🔥🔥🔥 | 🔥🔥🔥 | 中 | 9 小時 |

兩者**完全獨立，互不衝突**，建議先做本計劃。

---

## 五、施作範圍

### 會修改的檔案

| 檔案 | 變更內容 | 風險 |
|------|---------|------|
| **app.js** | Phase 3：有快取時維持現有關閉 overlay 行為，無快取時改為骨架佔位取代阻塞式 overlay；新增 `_startBackgroundCloudBoot()` 為 fire-and-forget；`ensureCloudReady()` 改為 thin wrapper；更新 `_contentStallCheck` 適配骨架模式 | 高 |
| **js/firebase-service.js** | 新增 `_notifyCacheUpdated(collectionName)` 通知機制（**全新函式，非既有**）；各集合到達時逐一通知 UI 更新；利用既有 Step 2.5 快速路徑擴展覆蓋 | 中 |
| **js/core/navigation.js** | 放寬 cloud-gate：有快取時先渲染再背景刷新（注意：`ScriptLoader.ensureForPage()` 在 stale-first 中仍為 await，需保留） | 中 |
| **js/config.js** | 新增 10 頁 SWR 策略到 `PAGE_STRATEGY` 和 `PAGE_DATA_CONTRACT`；版本號更新 | 低 |
| **index.html** | 新增 preconnect hints、骨架佔位 HTML、SWR 進度條元素；版本號更新 | 低 |
| **css/（既有檔案）** | 新增骨架動畫 `.skel-card`、SWR 進度條 `.swr-bar`、過期指示器樣式 | 低 |
| **sw.js** | 版本號更新 | 低 |

### 不會修改的檔案

| 檔案 / 目錄 | 原因 |
|-------------|------|
| `inventory/` | 獨立系統 |
| `functions/index.js` | Cloud Functions，純伺服器端 |
| `firestore.rules` | 安全規則不變 |
| `js/firebase-crud.js` | 鎖定模組，報名系統不動 |
| `js/api-service.js` | 純讀取快取 |
| `pages/*.html` | HTML 片段不變 |
| 所有懶載入模組（155 個） | ScriptLoader 機制不變 |

### 額外需修改：SWR 策略補齊（10 頁）

以下 10 頁目前預設走 `fresh-first`（必須等 Firebase 就緒才渲染）。需在 `js/config.js` 和 `js/firebase-service.js` 補上策略。

#### 教育俱樂部頁面（6 頁）

| 頁面 ID | 策略 | 需要的集合 | `_DETAIL_PAGE_FALLBACK` |
|---------|------|-----------|------------------------|
| `page-edu-groups` | stale-first | teams, educationGroups | → page-teams |
| `page-edu-students` | stale-first | teams, students | → page-teams |
| `page-edu-checkin` | stale-first | attendanceRecords, events | → page-teams |
| `page-edu-calendar` | stale-first | events | → page-teams |
| `page-edu-course-plan` | stale-first | courses | → page-teams |
| `page-edu-course-enrollment` | stale-first | enrollments | → page-teams |

> 注意：教育頁面在 `_DETAIL_PAGE_FALLBACK` 中已有回退到 `page-teams` 的邏輯，補齊 SWR 時需一併確認回退路徑相容。

#### 遊戲 + 成就（4 頁）

| 頁面 ID | 策略 | 需要的集合 |
|---------|------|-----------|
| `page-game` | stale-first | gameConfigs |
| `page-kick-game` | stale-first | gameConfigs |
| `page-achievements` | stale-first | achievements, badges |
| `page-titles` | stale-first | titles |

#### 覆蓋率

| | 補齊前 | 補齊後 |
|---|---|---|
| 有 SWR 策略 | 25 / 35 | **35 / 35（100%）** |

### 不需要新增的檔案

**無新增 JS 檔案**。所有邏輯在既有檔案內完成。

---

## 六、施作步驟

### Step 1（最低風險）：新增通知機制

在 `firebase-service.js` 新增 `_notifyCacheUpdated(collectionName)` — **這是全新函式**，目前不存在。所有寫入 `_cache` 的路徑（`_replaceCollectionCache`、`_loadEventsStatic`、`_continueLoadAfterTimeout`、`_handleWarmLoadedCollections`、所有 `onSnapshot` callback）都透過它通知 UI。

此步驟為純增量新增，不改變既有行為。

### Step 2：新增骨架 CSS + HTML

在 `index.html` 和 CSS 加入：
- `.skel-card` 骨架佔位卡片（shimmer 動畫）
- `.swr-bar` 頂部細進度條（`_cloudReady === false` 時顯示）
- 骨架模式 `_contentStallCheck` 更新：骨架顯示中不觸發「連線不穩」警告

### Step 3：修改 Phase 3 overlay 邏輯

`app.js` DOMContentLoaded handler：
- **有快取時**：維持現有 `_dismissBootOverlay('Phase 3 快取命中')` 行為（已正確實現）
- **無快取時**：改為顯示骨架佔位取代阻塞式 overlay
- 兩種情況都顯示 SWR 進度條

需同時處理：
- `_contentStallCheck`：骨架模式下延長容忍時間或改為檢查 `_cloudReady`
- `prod-early` CSS 類別：確認與骨架顯示不衝突

### Step 4（最高風險）：重構 ensureCloudReady

將 `ensureCloudReady()` 拆分：
- `_startBackgroundCloudBoot()` — fire-and-forget，Phase 3 完成後立即啟動
- `ensureCloudReady()` 保留為 thin wrapper（回傳 promise，供導航和深連結使用）

需確保與以下既有機制相容：
- **深連結三層邏輯**：REST fetch → `_tryInstantEventDeepLink()` → SDK 背景更新。`_instantDeepLinkMode` 旗標已繞過 cloud gate，新方案不可破壞此路徑
- **`_flushPendingProtectedBootRoute()`**：在 SDK 就緒後執行。需加入判斷：若用戶已離開首頁（正在瀏覽快取內容），延遲或取消 flush
- **`_pendingFirstLogin` 守衛**：若用戶缺少必填資料，首次登入 modal 必須在快取渲染前或同時觸發，不可讓用戶先看到內容再被擋住

### Step 5：放寬導航 cloud-gate

`navigation.js` 的 `showPage()` 改為：
- 有快取 → 先渲染快取 → 背景刷新（`ScriptLoader.ensureForPage()` 仍為 await，這是必要的等待）
- 無快取 → 顯示骨架 → 等 `ensureCollectionsForPage()` 完成 → 渲染

### Step 6：補齊 10 頁 SWR 策略

在 `js/config.js` 的 `PAGE_STRATEGY`、`PAGE_DATA_CONTRACT` 和 `js/firebase-service.js` 的 `_collectionPageMap` 補上 10 頁設定。

純設定新增，**不修改任何邏輯程式碼**。需在 Step 5 之後執行。

### Step 7：SDK 就緒後驗證與同步

SDK 就緒時執行：
- 重新取得 `currentUser.role` 並與快取比對，若變更則重渲染 UI
- 過濾已刪除的活動（快取中有但 Firestore 中已不存在）
- 檢查快取 schema 版本相容性

---

## 七、風險評估

### 既有風險（R-1 ~ R-7）

#### R-1：用戶看到過期資料後操作

| 項目 | 內容 |
|------|------|
| 可能性 | 中高 |
| 影響 | 中（Firestore transaction 擋住超收） |
| 緩解 | `handleSignup()` 已有 `_cloudReady` 守衛；報名用 `runTransaction` |
| 應急 | 加入報名前即時重查確認對話框 |

#### R-2：Firebase SDK 載入失敗

| 項目 | 內容 |
|------|------|
| 可能性 | 低中 |
| 影響 | 高 |
| 緩解 | 8 秒後顯示離線橫幅；所有寫入按鈕在 `_cloudReady === false` 時停用 |
| 應急 | 20 秒安全超時 + 重載提示 |

#### R-3：SDK 就緒前觸發寫入

| 項目 | 內容 |
|------|------|
| 可能性 | 低 |
| 影響 | 中高 |
| 緩解 | 審計所有 CRUD 入口點加 `_requireCloudReady()` 守衛 |
| 應急 | Firestore Security Rules 為服務端最後防線 |

#### R-4：即時監聽與背景刷新衝突

| 項目 | 內容 |
|------|------|
| 可能性 | 中 |
| 影響 | 低中 |
| 緩解 | 「監聽優先」策略：onSnapshot 啟動後 .get() 結果不覆寫 |

#### R-5：localStorage 資料損壞

| 項目 | 內容 |
|------|------|
| 可能性 | 低 |
| 影響 | 中 |
| 緩解 | `_restoreCache()` 加輕量結構驗證；不通過則丟棄 |

#### R-6：`_contentStallCheck` 與骨架衝突

| 項目 | 內容 |
|------|------|
| 可能性 | 中 |
| 影響 | 低中（「連線不穩」警告疊在骨架上方） |
| 緩解 | 骨架模式下延長 stall check 時間或改為檢查 `_cloudReady` 而非 DOM 內容 |

#### R-7：部分集合更新不一致

| 項目 | 內容 |
|------|------|
| 可能性 | 中 |
| 影響 | 中 |
| 緩解 | 相關集合分組刷新（events + registrations 同步） |

### 新增風險（M-1 ~ M-6，審查後補充）

#### M-1：幽靈活動卡片（已刪除活動仍顯示在快取中）

| 項目 | 內容 |
|------|------|
| 可能性 | 中 |
| 影響 | 中高 |
| 緩解 | SDK 就緒後比對快取 events，過濾已不存在的活動；點擊詳情時輕量 .get() 驗證 |
| 應急 | 顯示「此活動已不存在」提示 |

#### M-2：角色變更未同步（降權用戶看到管理員按鈕）

| 項目 | 內容 |
|------|------|
| 可能性 | 中 |
| 影響 | 中 |
| 緩解 | SDK 就緒後重新取得 role 並與快取比對；變更時立即重渲染 UI |
| 應急 | 管理按鈕操作仍有 Firestore Rules 擋住 |

#### M-3：快取資料格式不相容（版本更新後）

| 項目 | 內容 |
|------|------|
| 可能性 | 低中 |
| 影響 | 中高 |
| 緩解 | 新增快取 schema 版本號；不相容時清除快取強制重載 |

#### M-4：首次登入 modal 與快取顯示衝突

| 項目 | 內容 |
|------|------|
| 可能性 | 中 |
| 影響 | 低中 |
| 緩解 | 在 `renderAll()` 之前檢查 `_pendingFirstLogin`；若為 true，先顯示 modal 再渲染 |

#### M-5：Boot route flush 打斷用戶瀏覽

| 項目 | 內容 |
|------|------|
| 可能性 | 中 |
| 影響 | 低中 |
| 緩解 | 僅在用戶仍在首頁時 flush；離開首頁後取消 boot route |

#### M-6：深連結與骨架顯示衝突

| 項目 | 內容 |
|------|------|
| 可能性 | 中 |
| 影響 | 低中 |
| 緩解 | 深連結已有獨立的 REST fetch → Instant render 三層路徑（`_instantDeepLinkMode`），骨架邏輯需排除此路徑 |

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

# 2. 更新版本號（4 處，強制清除所有用戶快取）

# 3. 推送
git push origin main

# 4. Cloudflare Pages 自動部署（1-2 分鐘）
```

### 不可逆的變更
**無。** 純前端 JS 變更，`git revert` + 版本號更新即完全還原。

---

## 九、驗收清單

| # | 測試 | 預期結果 |
|---|------|---------|
| 1 | 回訪用戶開啟 App | 0.5 秒內看到活動列表（快取），無 overlay |
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
| 13 | 深連結開啟（?event=xxx） | 走 REST fetch 路徑，不顯示多餘骨架 |
| 14 | 首次登入用戶 | modal 正確攔截，不被快取顯示繞過 |
| 15 | 角色變更後開啟 | 快取顯示舊 UI → SDK 就緒後自動更新為新角色 UI |
| 16 | 已刪除活動點擊 | 顯示「此活動已不存在」，不報錯 |
| 17 | 6 秒內骨架未填入 | 不顯示舊版「連線不穩」，改為骨架持續等待 + 8 秒離線橫幅 |

---

## 十、部署後監控（48 小時）

### 0-2 小時：主動監控
- JS 錯誤日誌（Admin > Error Logs）
- overlay/骨架持續時間（performance beacon）
- 404 錯誤
- LINE WebView 載入
- 深連結功能驗證

### 2-24 小時：每 4 小時
- 錯誤日誌量（超過基準 2 倍 → 調查）
- 報名成功率（下降 30% → 調查）

### 48 小時決策門檻

| 🟢 綠燈 | 零致命錯誤，快取顯示時間 < 0.5s（回訪用戶） |
| 🟡 黃燈 | 有小問題但已修補 |
| 🔴 紅燈 | 致命問題 → 執行回滾 |

---

## 十一、工時評估

| 階段 | 時間 | 內容 |
|------|------|------|
| Step 1：通知機制 | 1 小時 | `_notifyCacheUpdated()` + 所有寫入路徑接線 |
| Step 2：骨架 UI + stall check 適配 | 45 分鐘 | CSS shimmer + HTML 佔位 + SWR bar + stall check 更新 |
| Step 3：Phase 3 overlay 邏輯 | 1 小時 | 骨架模式 + prod-early 協調 |
| Step 4：背景 cloud boot + 相容性 | 2 小時 | 拆分 ensureCloudReady + 深連結相容 + boot route flush 修改 + 首次登入守衛 |
| Step 5：導航 cloud-gate 放寬 | 30 分鐘 | showPage 修改 + 測試 |
| Step 6：補齊 10 頁 SWR 策略 | 30 分鐘 | config.js + firebase-service.js 設定 |
| Step 7：SDK 就緒後驗證 | 30 分鐘 | 角色同步 + 幽靈活動過濾 + schema 版本 |
| 測試 + 效能量測 | 1.5 小時 | 17 項驗收清單 + Lighthouse |
| **總計** | **8 小時** | |

---

## 十二、專家共識聲明（v2 修正後）

三位專家一致同意：

1. **即時快取顯示是目前能做的最高效能改善** — 70% 用戶立即受益
2. **通知機制 `_notifyCacheUpdated()` 是全新函式**，需新增到 `firebase-service.js`，非既有機制
3. **`_restoreCache()` 只呼叫一次**（Phase 2），不需要「移除重複呼叫」
4. **既有 Step 2.5 快速路徑（15 分鐘 TTL）應被利用和擴展**，非重新發明
5. **所有寫入操作必須保持 `_cloudReady` 守衛** — 過期資料只能看不能寫
6. **深連結三層邏輯（REST → Instant → SDK 背景）不可被破壞**
7. **`_contentStallCheck` 必須適配骨架模式**，避免警告疊加
8. **首次登入 modal、boot route flush、角色變更同步** 都是必要的相容性處理
9. **效能數字已修正為保守估計**（0.28-0.5s，非原始的 0.15-0.35s）
10. **全站 100% 覆蓋** — 35 個用戶導航頁面全部享受快取優先
11. **回滾 15 分鐘內可完成** — 純前端變更，無不可逆操作
12. **與 esbuild 打包完全互補** — 可分別獨立實施

---

## 十三、v1 → v2 修正記錄

| 項目 | v1 錯誤/遺漏 | v2 修正 |
|------|------------|--------|
| Phase 3 描述 | 「永遠關閉 overlay」 | 有快取才關（已是現有行為）；無快取改為骨架 |
| `_restoreCache()` | 「移除重複呼叫」 | 只呼叫一次，不需移除 |
| `_debouncedSnapshotRender` | 「是既有機制」 | 不存在，需全新建立 `_notifyCacheUpdated()` |
| Step 2.5 快速路徑 | 未提及 | 已識別並納入計劃（利用而非重建） |
| 效能數字 | 0.15-0.35s | 修正為 0.28-0.5s |
| TTI 數字 | 0.2-0.5s | 修正為 0.5-0.8s（可瀏覽）；寫入仍需等 SDK |
| 深連結相容 | 未提及 | 新增 M-6 風險 + Step 4 相容性要求 |
| `_contentStallCheck` | 未提及 | 新增 R-6 風險 + Step 2 適配 |
| 首次登入 modal | 未提及 | 新增 M-4 風險 + Step 4 處理 |
| Boot route flush | 未提及 | 新增 M-5 風險 + Step 4 處理 |
| 幽靈活動卡片 | 未提及 | 新增 M-1 風險 + Step 7 |
| 角色變更同步 | 未提及 | 新增 M-2 風險 + Step 7 |
| 快取 schema 版本 | 未提及 | 新增 M-3 風險 + Step 7 |
| 教育頁面回退邏輯 | 未提及 | 補充 `_DETAIL_PAGE_FALLBACK` 說明 |
| 驗收清單 | 12 項 | 擴充為 17 項 |
| 工時 | 6 小時 | 修正為 8 小時 |

---

*本計劃書 v2 經三輪專家審查後修正。*
*領導整合：Claude Opus 4.6 (1M context)*
*專案：ToosterX — toosterx.com*
