# SportHub 效能優化計劃

> 文件建立日期：2026/02/20
> 最後更新：2026/02/20（v4，補充圖片來源盤點表、量測執行節奏、方案五 Fallback 機制）
> 狀態：規劃中（部分已實作，見各方案說明）
> 目標：改善用戶開啟網頁後的資料加載體驗

---

## 背景與問題描述

### 現有架構載入流程

SportHub 目前的開機流程分為四個 Phase，**依序執行**：

```
Phase 1：PageLoader 抓取 5 個 HTML 片段（500ms～2000ms）
   ↓ 必須等待 Phase 1 完成
Phase 2：從 localStorage 讀取快取資料（50ms）
   ↓
Phase 3：用快取資料渲染畫面（100ms）← 用戶才看到內容
   ↓
Phase 4：背景連線 Firebase 拉取最新資料（3～7 秒）
```

### 核心問題

1. **Phase 3（渲染）被 Phase 1（抓 HTML）阻塞** — localStorage 裡其實已經有快取資料，但程式必須等 HTML 片段全部下載完才能渲染，造成每次開啟都有 500ms～2000ms 的白屏等待。

2. **快取有效期只有 5 分鐘** — 超過 5 分鐘後造訪，快取失效，用戶重新經歷白屏等待 Firebase 回應。

3. **42 個 JS 模組全部在啟動時載入** — 包括後台管理等從未造訪的頁面模組，全部在首次開啟時下載與解析。

4. **首次造訪完全沒有快取** — 新用戶或清除快取後，必須等 Firebase 回傳資料（3～7 秒）才看到內容。

5. **等待期間缺乏視覺回饋** — 只有轉圈圈的 loading spinner，視覺上感覺更慢。

6. **圖片每次重新從 Firebase Storage 下載** — Service Worker 原本對 googleapis.com 採用 Network-first 策略，圖片無法被快取，每次開啟都重新拉取。

7. **onSnapshot 監聽整份 collection** — 隨資料量成長，啟動時同步的資料量越來越大，連線建立後的初始資料傳輸也越來越慢。

---

## 七個優化方案

---

### 方案一：localStorage 快取有效期延長（TTL 延長）

**優先度：★★★★★（立即實施）**
**風險：極低**
**改動範圍：1 行程式碼（firebase-service.js）**
**實作狀態：待實作**

#### 目的

讓重複造訪的用戶在更長的時間範圍內，都能直接使用本地快取渲染畫面，不需要等待 Firebase 連線。

#### 原因

目前 `firebase-service.js` 中設定：

```javascript
_LS_TTL: 5 * 60 * 1000,  // 5 分鐘
```

5 分鐘後造訪，快取就失效，用戶必須重新等待 Firebase 回傳資料。但 SportHub 的資料（活動列表、球隊資訊、廣告橫幅等）並不是每分鐘都在變動，短時間內看到稍微舊一點的資料完全可以接受。況且 `onSnapshot` 即時監聽機制會在背景自動將最新資料更新進來，用戶實際上永遠能看到最新資料，只是初始渲染的速度更快。

#### 做法

**修改 `js/firebase-service.js`：**

```javascript
// 修改前
_LS_TTL: 5 * 60 * 1000,   // 5 分鐘

// 修改後
_LS_TTL: 30 * 60 * 1000,  // 30 分鐘
```

#### 效果

| 情境 | 修改前 | 修改後 |
|------|--------|--------|
| 5 分鐘內回來 | 用快取（快） | 用快取（快） |
| 6～30 分鐘後回來 | 等 Firebase（慢） | 用快取（快） |
| 30 分鐘後回來 | 等 Firebase（慢） | 等 Firebase（慢） |

**覆蓋用戶大多數「同一個使用工作階段」的情境（滑一滑離開、5 分鐘後回來看），效果穩定。**

---

### 方案二：加入 DNS preconnect 資源提示

**優先度：★★★★☆（立即實施）**
**風險：零**
**改動範圍：index.html 加 3～4 行**
**實作狀態：待實作**

#### 目的

讓瀏覽器在解析 HTML 的同時，提前建立與 Firebase 伺服器的 DNS 解析與 TCP 連線，減少後續請求的等待時間。

#### 原因

當用戶開啟頁面，瀏覽器才開始解析 HTML，才發現需要連線到 Firebase 的各個域名，才去做 DNS 解析、TCP 握手、TLS 建立，這一串動作需要 100～300ms。若在 HTML `<head>` 中提前宣告需要連線的域名，瀏覽器會在背景提前把這些工作做好，到真正需要發請求時就能立即使用。

這是標準的 Web 效能最佳化手段，屬於 HTML 宣告式優化，沒有任何程式邏輯風險。

#### 做法

**在 `index.html` 的 `<head>` 最前端加入：**

```html
<!-- Firebase & LINE 預連線提示 -->
<link rel="preconnect" href="https://firestore.googleapis.com">
<link rel="preconnect" href="https://firebasestorage.googleapis.com">
<link rel="preconnect" href="https://identitytoolkit.googleapis.com">
<link rel="preconnect" href="https://line-scdn.net" crossorigin>
```

#### 效果

- 每次 Firebase 請求減少 100～300ms 的連線建立時間
- 對 LINE 頭像載入也有輕微幫助
- 完全不影響任何功能邏輯

---

### 方案三：Phase 1 與 Phase 3 並行化（最高 CP 值）

**優先度：★★★★★（最值得實施）**
**風險：中（需仔細分析 DOM 依賴，見下方風險說明）**
**改動範圍：app.js 開機流程**
**實作狀態：待實作**

#### 目的

讓「抓取 HTML 片段」與「渲染快取資料」同時進行，而非序列等待，大幅縮短用戶看到內容的時間。

#### 原因

目前流程中，Phase 1（抓 HTML）與 Phase 3（渲染快取）是序列的，但這兩件事**完全不需要依賴彼此**：

- Phase 1 的結果是讓 DOM 中有各頁面的 HTML 結構
- Phase 3 的快取資料來自 localStorage，與網路請求無關

當 localStorage 快取有效時，資料早就在記憶體裡了，沒有理由等 HTML 下載完才渲染。

#### 現況 vs 目標

**現況（序列，每次都等 500ms～2000ms）：**

```
DOMContentLoaded
│
├─ [等 Phase 1] PageLoader.loadAll() ─────── 500～2000ms
│                                                     ↓
├─ Phase 2: _restoreCache()                   約 50ms
│
└─ Phase 3: App.init() / renderAll()         約 100ms
                                      ← 用戶才看到內容
```

**目標（並行，<200ms 看到內容）：**

```
DOMContentLoaded
│
├─ Phase 1: PageLoader.loadAll() ────── 500～2000ms（背景進行）
│                ↕ 同時
├─ Phase 2: _restoreCache()            約 50ms
│
└─ Phase 3: App.init() / renderAll()  約 100ms
            ← 快取就位立即渲染，不等 HTML
            ← HTML 到了自動填充對應區塊
```

#### 做法

**修改 `app.js` 開機流程，將 Phase 1 改為非阻塞，Phase 2+3 提前執行：**

```javascript
// 修改前（序列）
await PageLoader.loadAll();         // 等 HTML
FirebaseService._restoreCache();    // 才讀快取
App.init();                         // 才渲染

// 修改後（並行）
const htmlReady = PageLoader.loadAll();   // HTML 背景跑
FirebaseService._restoreCache();          // 立即讀快取
App.init();                               // 立即用快取渲染
await htmlReady;                          // 等 HTML（但畫面已有內容）
```

#### ⚠️ 重要風險說明：DOM 依賴分析

**這是方案三最關鍵的風險。** 如果 `App.init()` 在 HTML 尚未載入時嘗試操作某個 DOM 元素，會靜默失敗（container 為 null），造成畫面空白而不報錯。

實施前必須完成以下分類：

**必須等 Phase 1 完成才能渲染（目標元素在動態頁 HTML 中）：**

| 渲染函式 | 目標元素所在 HTML | 原因 |
|---------|----------------|------|
| `renderHotEvents()` | `pages/home/*.html` | 活動列表 container 在動態頁中 |
| `renderBanners()` | `pages/home/*.html` | 橫幅 container 在動態頁中 |
| `renderAnnouncements()` | `pages/home/*.html` | 公告 container 在動態頁中 |
| `renderLeaderboard()` | `pages/home/*.html` | 排行榜 container 在動態頁中 |

**可提前渲染（目標元素在 index.html 靜態存在）：**

| 渲染函式 | 目標元素所在 | 原因 |
|---------|------------|------|
| `renderNavBar()` | `index.html` | 導覽列靜態存在 |
| `renderProfileHeader()` | `index.html` | 頭像區靜態存在 |
| `applyTheme()` | `document.body` | 主題類別套在 body |

**實施策略：**

並行化後，`App.init()` 中的渲染函式需要加入防護：

```javascript
// 渲染前檢查 container 是否存在
renderHotEvents() {
  const container = document.getElementById('hot-events-list');
  if (!container) return;  // 防護：HTML 尚未就緒時跳過
  // ... 正常渲染
}
```

Phase 1 完成後再統一補跑一次 `renderAll()`，確保所有內容就位。

**實施前必做：逐一確認 `App.renderAll()` 中每個函式的 container ID 對應到哪個 HTML 檔案。**

#### 效果

| 情境 | 修改前（等待時間） | 修改後（等待時間） |
|------|-----------------|-----------------|
| 重複造訪（快取有效） | 500～2000ms | <200ms |
| 首次造訪（無快取） | 3000～7000ms | 3000～7000ms（首訪無快取，無法改善）|

**重複造訪是大多數用戶的主要使用情境，這個改動讓每次開啟都有感。**

---

### 方案四：骨架屏（Skeleton Screen）

**優先度：★★★☆☆（加分項）**
**風險：低**
**改動範圍：CSS + 各渲染模組的條件判斷**
**實作狀態：待實作**

#### 目的

在資料尚未載入時，用灰色佔位圖填滿頁面，讓用戶感受到頁面「正在載入」而非「一片空白」，提升感知速度。

#### 原因

研究顯示，**視覺上有內容的等待，比空白等待感覺快 30%～50%**，即使實際時間相同。目前頁面在等待期間只有轉圈圈的 loading spinner，用戶不清楚會等多久、等什麼。骨架屏讓用戶知道「這裡會有一張活動卡片、那裡會有一個橫幅」，心理上更能接受等待。

骨架屏**不加速實際資料載入速度**，是純粹的感知體驗優化。

#### 做法

**在 CSS 新增骨架動畫：**

```css
.skeleton {
  background: linear-gradient(90deg,
    var(--bg-elevated) 25%,
    var(--border) 50%,
    var(--bg-elevated) 75%
  );
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s infinite;
  border-radius: var(--radius-sm);
}

@keyframes skeleton-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

**在渲染函式中加入空資料判斷：**

```javascript
renderHotEvents() {
  const events = ApiService.getEvents();
  if (events.length === 0) {
    container.innerHTML = [1,2,3].map(() => `
      <div class="event-card skeleton" style="height:120px"></div>
    `).join('');
    return;
  }
  container.innerHTML = events.map(e => renderEventCard(e)).join('');
}
```

需要為首頁的熱門活動、橫幅輪播、錦標賽列表各自設計骨架樣式。

#### 效果

- 實際資料速度不變
- 感知速度提升明顯
- 搭配方案三效果最佳（並行化後速度已快，骨架屏讓過渡更順暢）

---

### 方案五：JS 模組按頁面分組延遲載入

**優先度：★★★☆☆（長期優化）**
**風險：中高（詳見依賴樹說明）**
**改動範圍：index.html + script-loader.js + navigation.js**
**實作狀態：待實作，建議在方案一～三穩定後評估**

#### 目的

啟動時只載入首頁必要的 JS 模組（約 12 個），其他頁面的模組等到用戶實際造訪時再載入，減少初始 JS 解析量。

#### 原因

目前 `index.html` 中有 42 個 `<script defer>` 標籤，包含後台管理、掃碼、賽事管理、二手商品等模組，對一般用戶完全不需要在啟動時載入。`script-loader.js` 已設計了按頁面分組的延遲載入機制，但目前**完全沒有被啟用**。

#### 做法

分三步進行：

**Step 1：從 `index.html` 移除非首頁模組的 `<script>` 標籤**

保留啟動必要的核心模組（約 12 個），移除所有頁面特定模組。

**Step 2：確認 `script-loader.js` 的分組設定正確**

```javascript
_groups: {
  home:       ['js/modules/banner.js', 'js/modules/announcement.js', ...],
  activity:   ['js/modules/event-list.js', 'js/modules/event-render.js', ...],
  team:       ['js/modules/team-list.js', 'js/modules/team-detail.js', ...],
  admin:      ['js/modules/user-admin-list.js', 'js/modules/user-admin-exp.js', ...],
  scan:       ['js/modules/scan.js'],
}
```

**Step 3：在 `navigation.js` 的 `showPage()` 中，造訪頁面前先確保對應腳本已載入**

```javascript
async showPage(pageId) {
  await ScriptLoader.ensureForPage(pageId);
  // 原有邏輯繼續...
}
```

#### ⚠️ 重要風險說明：依賴樹與 Smoke Test

**現有腳本有嚴格的載入順序依賴：**

```
config.js
  └─ data.js
       └─ firebase-config.js
            └─ firebase-service.js
                 └─ firebase-crud.js
                      └─ api-service.js
                           └─ line-auth.js
                                └─ app.js
                                     └─ [所有 modules]（Object.assign(App, {...})）
```

模組的 `Object.assign(App, {...})` 執行時，`App` 物件必須已存在（`app.js` 已載入）。若某模組被提前或延遲載入，但依賴的上層尚未載入，會拋出 `ReferenceError: App is not defined`。

**實施前必做：依賴樹檢查清單**

| 模組 | 直接依賴 | 可延遲載入？ |
|------|---------|------------|
| banner.js | App, ApiService | ✅ 首頁訪問時載入 |
| event-list.js | App, ApiService | ✅ 活動頁訪問時載入 |
| scan.js | App, ApiService, FirebaseService | ✅ 掃碼頁訪問時載入 |
| user-admin-list.js | App, ApiService | ✅ 後台頁訪問時載入 |
| leaderboard.js | App, ApiService | ⚠️ profile 頁用到，需確認 |
| profile-data.js | App, ApiService | ⚠️ 登入流程也用到，需確認 |

**實施後關鍵頁面驗證路徑（Smoke Test）：**

每次拆分後，必須依序走過以下路徑並確認無 console error：

1. 首頁載入 → 橫幅顯示、活動列表顯示
2. 點「活動」→ 活動列表渲染、報名按鈕可用
3. 點「球隊」→ 球隊列表渲染
4. 點「個人」→ 個人資料顯示、報名記錄顯示
5. 從 Drawer 進「掃碼」→ 掃碼頁正常顯示
6. 從 Drawer 進「後台管理」（管理員帳號）→ 數據儀表板正常顯示
7. Demo 模式與正式模式分別測試

#### 效果

- 啟動時少解析約 30～50KB JS
- 低階裝置上啟動速度約提升 20～30%
- 後台管理頁面對一般用戶完全不增加啟動負擔

#### Fallback 機制（載入失敗時的回退策略）

延遲載入腳本存在失敗風險（網路不穩、404、CDN 問題），若不處理，用戶點進某頁會看到空白或靜默錯誤，不知道要怎麼辦。必須設計 Fallback 策略。

**Fallback 分兩層：**

**第一層：單頁腳本載入失敗 → 嘗試重新載入**

```javascript
// script-loader.js
async ensureForPage(pageId) {
  try {
    await this._loadGroup(pageId);
  } catch (err) {
    console.warn(`[ScriptLoader] ${pageId} 腳本載入失敗，嘗試重試...`, err);
    try {
      // 等待 1 秒後重試一次
      await new Promise(r => setTimeout(r, 1000));
      await this._loadGroup(pageId);
    } catch (retryErr) {
      // 重試仍失敗 → 進入第二層
      this._handleLoadFailure(pageId, retryErr);
    }
  }
}
```

**第二層：重試失敗 → 顯示提示並提供重新整理**

```javascript
_handleLoadFailure(pageId) {
  const container = document.getElementById('page-' + pageId);
  if (container) {
    container.innerHTML = `
      <div style="text-align:center;padding:2rem;color:var(--text-muted)">
        <div style="font-size:2rem;margin-bottom:.5rem">⚠️</div>
        <div>頁面載入失敗，請檢查網路後重試</div>
        <button onclick="location.reload()"
          style="margin-top:1rem;padding:.5rem 1.2rem;border-radius:8px;
                 background:var(--accent);color:#fff;border:none;cursor:pointer">
          重新整理
        </button>
      </div>`;
  }
}
```

**第三層（可選）：整頁載入全量 modules 作為終極保底**

若要確保任何情況下都有功能，可在第二層失敗後改用 `index.html` 原本的全量載入方式（動態插入所有 `<script>` 標籤），代價是恢復成原本較慢的啟動速度，但至少功能完整。

---

### 方案六：圖片載入優化

**優先度：★★★★☆**
**風險：低**
**改動範圍：sw.js（已完成）、Firebase Storage 設定（待實作）**
**實作狀態：SW 快取部分已完成（2026/02/20），Cache-Control 待實作**

#### 目的

讓圖片在第二次開啟時從本機快取瞬間顯示，不重新發送網路請求。同時透過 Firebase Storage 的 Cache-Control 設定，強化瀏覽器層的 HTTP 快取。

#### 原因

Firebase Storage 圖片的 URL 形如 `https://firebasestorage.googleapis.com/...?alt=media&token=...`，原本被 Service Worker 以 Network-first 策略處理，代表**每次開啟頁面都會重新從 Firebase Storage 下載圖片**，即使圖片根本沒有變過。

此外，Firebase Storage 上傳圖片時若未明確設定 Cache-Control，預設為極短的 TTL（通常 1 小時甚至更短），導致即使瀏覽器有 HTTP 快取機制，也很快就失效。

#### 圖片來源盤點表

本專案所有圖片來源的快取可行性一覽：

| 來源 | 域名 | 可 SW 快取？ | 原因 |
|------|------|-----------|------|
| **Firebase Storage** | `firebasestorage.googleapis.com` | ✅ 可，已實作 | URL 含 token，換圖時 URL 同步更換，長期快取安全 |
| **LINE 頭像** | `line-scdn.net` | ❌ 不建議 | URL 固定不變，用戶換大頭照後 SW 快取會顯示舊圖 |
| **QR Code** | 無（client-side 生成） | ❌ 不適用 | canvas/SVG 本地生成，無網路請求可攔截 |
| **外部廣告素材** | 各廣告主域名 | ❌ 不建議 | 對方未必提供 CORS header，快取可能直接失敗 |
| **贊助商 Logo** | 外部域名 | ❌ 不建議 | 同上，CORS 限制 |

**結論：SW 圖片快取只針對 `firebasestorage.googleapis.com`，其餘來源各有限制，不納入。**

---

#### 已完成的部分（2026/02/20）

**Service Worker 圖片快取（sw.js）：**

- Firebase Storage 圖片改為 **Stale-While-Revalidate** 策略
- 建立獨立的 `sporthub-images-v1` 快取，不與 JS/CSS 混用
- 最多快取 **60 張**（見下方待改善項目）
- 每張快取 **7 天**有效，存入時附加 `sw-cached-at` 時間戳
- 超過上限時自動 LRU 淘汰最舊項目
- SW 升級時保留圖片快取（不清除）

**loading="lazy" 補全：**

- `banner.js` 贊助商格
- `achievement.js` 成就卡片、徽章展示區、後台成就列表

#### 待實作的部分

**問題一：60 張上限可能不足**

活躍用戶瀏覽路徑中的圖片數量估計：

| 類型 | 數量 |
|------|------|
| 橫幅廣告 | 3～5 張 |
| 浮動廣告 | 1～3 張 |
| 贊助商格 | 最多 6 張 |
| 活動封面（首頁+列表） | 15～30 張 |
| 球隊隊徽 | 10～20 張 |
| 成就徽章 | 10～30 張 |
| **合計** | **約 40～94 張** |

活躍用戶可能在一個工作階段內突破 60 張，導致較早載入的橫幅廣告被淘汰。

**建議：將上限從 60 提高至 120～150 張。**

修改 `sw.js`：

```javascript
// 修改前
const MAX_IMAGE_CACHE = 60;

// 修改後
const MAX_IMAGE_CACHE = 150;
```

**問題二：Firebase Storage 未設定 Cache-Control**

上傳圖片時，Firebase Storage 預設 Cache-Control 通常非常短，瀏覽器層的 HTTP 快取快速失效。應在上傳時明確設定：

修改 `js/firebase-crud.js` 的 `_uploadImage()`：

```javascript
// 上傳時加入 metadata
const metadata = {
  cacheControl: 'public, max-age=31536000',  // 瀏覽器 HTTP 快取 1 年
};
const snapshot = await ref.putString(base64DataUrl, 'data_url', metadata);
```

> 說明：Firebase Storage 使用內容定址 URL（URL 含 token），圖片變更時 URL 也會變，因此設定極長的 Cache-Control（1 年）是安全的，不會造成舊圖片無法更新的問題。

**問題三：LINE 頭像快取無法控制**

LINE 頭像 URL 的 Cache-Control 由 LINE 伺服器決定，應用層無法設定。目前唯一可行的方向是：若應用層需要頻繁顯示 LINE 頭像，可在首次載入後將 URL 存入 IndexedDB 或 localStorage，下次以相同 URL 顯示（瀏覽器通常會命中 HTTP 快取）。此項改動效益有限，暫不列入優先。

---

#### ❌ 不建議納入 SW 圖片快取的來源

以下三類圖片來源**不適合**加入 Service Worker 的圖片快取策略，原因如下：

**LINE 頭像（`line-scdn.net`）— 有過期資料風險**

LINE 頭像 URL 是固定的，即使用戶更新大頭照，URL 也不會改變。Firebase Storage 可以安全設定長期快取，是因為圖片更換時 URL 也同步更換，舊 URL 永遠對應舊圖，不會出錯。但 LINE 頭像若被 SW 快取 7 天，這 7 天內用戶換了大頭照，其他人仍會看到舊照片，存在顯示錯誤的風險。

**QR Code — 本專案不適用**

若 QR Code 是在瀏覽器端以 canvas 或 SVG 生成（client-side rendering），不會產生網路請求，Service Worker 無從攔截，此建議對本專案不適用。

**外部圖片 URL（贊助商、廣告素材）— CORS 限制**

Service Worker 快取跨域資源需要對方伺服器的回應包含 `Access-Control-Allow-Origin` header。外部廣告素材或贊助商圖片來源不一定提供 CORS header，強行快取可能直接失敗，增加實作複雜度卻得不到效益。

**結論：SW 圖片快取策略應只針對 `firebasestorage.googleapis.com`（本專案的主要圖片儲存來源），其餘來源各有限制，不建議納入。**

---

### 方案七：onSnapshot 資料量縮減（長期架構優化）

**優先度：★★★☆☆（長期）**
**風險：高（需同步調整 ApiService 查詢邏輯）**
**改動範圍：firebase-service.js、firebase-crud.js、api-service.js**
**實作狀態：待評估，建議在方案一～六穩定後規劃**

#### 目的

限制 onSnapshot 監聽的資料範圍，從「整份 collection」縮減為「實際需要的子集」，減少初始連線後的資料傳輸量，隨資料量增長也不會變慢。

#### 原因

延長 TTL（方案一）是治標：讓已有的快取撐更久。縮減資料量才是治本：本來就不要拉那麼多資料回來。

目前 `_liveCollections`（onSnapshot）和 `_bootCollections`（一次性抓取）都是整份 collection：

- `events`：監聽所有活動，包括一年前已結束的活動
- `registrations`：監聽所有用戶的報名記錄
- `activityRecords`：監聽所有用戶的活動歷史
- `messages`：監聽所有站內信（無分頁）

隨著平台累積資料，這些 collection 會越來越大，啟動時的資料傳輸量也會線性增長。

#### 建議的縮減策略

**策略一：events 只同步近期活動**

```javascript
// 改為只抓取近 90 天內的活動
const cutoff = new Date();
cutoff.setDate(cutoff.getDate() - 90);
db.collection('events')
  .where('date', '>=', cutoff.toISOString())
  .onSnapshot(...)
```

**策略二：registrations / activityRecords 改為按 userId 查詢**

```javascript
// 改為只抓取當前用戶的紀錄（非整份 collection）
db.collection('registrations')
  .where('userId', '==', currentUserId)
  .onSnapshot(...)
```

**策略三：messages 加入分頁或限制筆數**

```javascript
// 只取最新 50 筆
db.collection('messages')
  .where('recipientUid', '==', currentUserId)
  .orderBy('time', 'desc')
  .limit(50)
  .onSnapshot(...)
```

#### 角色分流規劃（必要前提）

**資料縮減策略不能對所有角色一視同仁。** 不同角色對資料的需求範圍根本不同，必須分流設計，否則縮減後管理功能會直接壞掉。

| 角色 | events 範圍 | registrations 範圍 | activityRecords 範圍 | messages 範圍 |
|------|-----------|-------------------|---------------------|-------------|
| **user** | 近期公開活動 | 僅自己的 | 僅自己的 | 僅自己收到的 |
| **coach** | 近期公開活動 + 自己創建的所有活動 | 自己活動的所有報名 | 僅自己的 | 僅自己收到的 |
| **admin / super_admin** | 所有活動（不可縮減） | 所有報名（不可縮減） | 所有記錄（不可縮減） | 所有站內信（不可縮減） |

**實作意義：**

- 對 `user` 角色，策略一～三的縮減都可套用，效益最明顯
- 對 `coach` 角色，需要「自己的資料 + 自己活動的資料」兩段查詢合併
- 對 `admin` 角色，資料不可縮減，此方案對其無意義（但也不會使其更慢）

**分流初始化流程（示意）：**

```javascript
// firebase-service.js 初始化時
async init() {
  const role = currentUser?.role || 'user';

  if (role === 'admin' || role === 'super_admin') {
    // 後台角色：全量同步，維持現有邏輯
    await this._setupFullListeners();
  } else if (role === 'coach') {
    // 教練：近期活動 + 自己創建的活動報名
    await this._setupCoachListeners(currentUser.uid);
  } else {
    // 一般用戶：近期活動 + 自己的報名與歷史
    await this._setupUserListeners(currentUser.uid);
  }
}
```

#### ⚠️ 風險說明

現有 `ApiService` 的查詢邏輯（如 `getEvents()`、`getRegistrationsByUser()`）都假設整份 collection 已在 `_cache` 中，改成局部查詢後，**所有依賴這些資料的功能都需要同步確認**：

- 活動管理頁（coaches 看到所有活動）→ 需要不同的查詢範圍
- 後台管理（admins 看到所有用戶的報名）→ 需要後台專用查詢
- 統計計算（出席率、EXP）→ 依賴完整資料，局部查詢可能導致數字錯誤

此方案的實際複雜度遠高於「改幾個 Firestore query」，本質上是**重新設計資料初始化架構**，需要獨立的規劃週期。

**建議：此方案需先評估各功能的資料依賴範圍，逐步拆分，不可一次性改動。**

---

## 成效量測框架

優化實作前後都應量測以下指標，才能客觀驗證改善幅度。**建議在實作任何方案之前先量好基準數字。**

---

### 量測指標

| 指標 | 說明 | 量測方式 | 目標 |
|------|------|---------|------|
| **LCP**（最大內容繪製） | 用戶看到主要內容（橫幅或活動列表）要等多久 | Chrome DevTools → Lighthouse → 手機模擬模式 | < 2.5 秒 |
| **TTI**（可互動時間） | 頁面何時可以正常點擊操作 | Chrome DevTools → Lighthouse | < 3.8 秒 |
| **SW Cache Hit Rate** | Service Worker 快取命中率（減少幾次網路請求） | sw.js 加入 console 計數（見下方） | > 80% 重複造訪 |
| **圖片快取命中率** | 圖片專屬快取命中次數 ÷ 圖片總請求次數 | sw.js IMAGE_CACHE 攔截計數 | > 70% 第二次造訪 |

---

### LCP / TTI 量測方法

1. Chrome DevTools → Lighthouse → 選「Mobile」模式
2. 勾選 Performance
3. 點 Analyze page load
4. 記錄 LCP、TTI 數值

**量測時機：**
- 實作各方案前記錄一次（基準）
- 每個階段完成後記錄一次（比對）
- 建議在「清除快取後的首次造訪」與「重複造訪」兩種情境下分別量測

---

### 量測執行節奏

每個實施階段完成後，應依以下節奏進行量測並更新記錄表：

**每次量測前置條件（必須統一，否則數據無法比較）：**

| 條件 | 說明 |
|------|------|
| 裝置 | 固定使用同一台手機或 DevTools 的同一模擬機型 |
| 網路環境 | 每次量測時標記：行動網路（4G/5G）或 WiFi |
| 快取狀態 | 分兩種情境：① 清除快取（首次訪問模擬）② 保留快取（重複訪問模擬）|
| 時段 | 避免在網路尖峰時段量測，結果會受伺服器負載影響 |

**各階段量測節奏：**

```
實作前      → 量測基準值，填入「基準記錄表（實作前）」
階段一完成  → 量測，填入「階段一後」欄位，與基準比對
階段二完成  → 量測，填入「階段二後」欄位，與階段一比對
階段三完成  → 量測，填入「階段三後」欄位
```

**量測結果記錄格式建議：**

每次量測記錄：日期、網路環境、LCP、TTI、圖片命中率、備註（例如「WiFi、iPhone 14 模擬、清除快取後首次」）。

---

### SW 快取命中率量測方法

在 `sw.js` 的 fetch handler 加入輕量計數，開發期間可開啟，正式上線前移除：

```javascript
// sw.js — 統計區塊（開發期間使用）
let _stats = { imageHit: 0, imageMiss: 0, staticHit: 0, staticMiss: 0 };

// 圖片命中時
if (isValid) {
  _stats.imageHit++;
  console.log(`[SW Stats] 圖片快取 HIT（共 ${_stats.imageHit} 次）`);
  event.waitUntil(networkFetch);
  return cached;
}

// 圖片未命中時
_stats.imageMiss++;
console.log(`[SW Stats] 圖片快取 MISS（共 ${_stats.imageMiss} 次）`);

// 靜態資源命中時（同樣位置加）
// ...

// 每 10 次請求輸出一次整體統計
if ((_stats.imageHit + _stats.imageMiss) % 10 === 0) {
  const hitRate = Math.round(_stats.imageHit / (_stats.imageHit + _stats.imageMiss) * 100);
  console.log(`[SW Stats] 圖片命中率：${hitRate}%`);
}
```

---

### 基準記錄表（實作前填寫）

| 量測情境 | LCP | TTI | 圖片快取命中率 | 量測日期 |
|---------|-----|-----|-------------|---------|
| 首次造訪（清除快取） | — | — | — | — |
| 重複造訪（5 分鐘內） | — | — | — | — |
| 重複造訪（10 分鐘後） | — | — | — | — |

---

## 實施建議順序

### 階段一：零風險立即改善

| 方案 | 改動 | 效果 |
|------|------|------|
| 方案一（TTL 延長） | firebase-service.js 改 1 行 | 同工作階段不再白屏 |
| 方案二（preconnect） | index.html 加 3～4 行 | Firebase 連線提前建立 |
| 方案六 SW 上限調整 | sw.js 改 1 行（60→150） | 活躍用戶圖片快取不被淘汰 |
| 方案六 Cache-Control | firebase-crud.js 上傳加 metadata | 瀏覽器 HTTP 快取有效 1 年 |

---

### 階段二：主要優化

| 方案 | 改動 | 效果 |
|------|------|------|
| 方案三（並行化） | app.js 開機流程調整（需先做 DOM 分析） | 重複造訪 <200ms 看到內容 |

---

### 階段三：體驗加分

| 方案 | 改動 | 效果 |
|------|------|------|
| 方案四（骨架屏） | CSS + 各渲染模組 | 感知速度提升，視覺流暢 |

---

### 階段四：長期優化（穩定後評估）

| 方案 | 改動 | 效果 |
|------|------|------|
| 方案五（JS 分組） | index.html + script-loader + navigation | 啟動解析量減少 |
| 方案七（資料縮減） | firebase-service + api-service 架構調整 | 大量資料時根本性改善 |

---

## 優化前後預期比較

| 指標 | 優化前 | 階段一後 | 階段二後 |
|------|--------|---------|---------|
| 重複造訪看到內容 | 500～2000ms | 400～1900ms | **<200ms** |
| 5 分鐘後回來 | 等 Firebase（慢） | **30 分鐘內快取有效** | **30 分鐘內快取有效** |
| 首次造訪 | 3000～7000ms | 2700～6700ms | 2700～6700ms |
| Firebase 連線 | DNS 解析才開始 | **提前建立** | **提前建立** |
| 圖片重新載入 | 每次從網路下載 | **第二次起從本機快取** | **第二次起從本機快取** |
| 大量資料時 | 線性變慢 | 線性變慢 | 線性變慢（方案七後改善）|
| 視覺等待體驗 | 只有轉圈圈 | 只有轉圈圈 | 骨架屏（方案四後）|

---

## 注意事項

1. **方案三實施前**，必須逐一確認 `App.renderAll()` 中每個渲染函式的 container 元素位於哪個 HTML 檔案，分類為「可提前渲染」與「需等 Phase 1」兩類，並為後者加入 null 防護。
2. **方案五實施前**，必須完成依賴樹分析，並在每次拆分後完整走過 Smoke Test 清單（7 個關鍵路徑）。
3. **方案七** 改動範圍最大、影響最廣，必須在其他方案穩定後獨立規劃，不可與其他方案同時進行。
4. 所有方案實施後，記得依規範更新 `CACHE_VERSION` 與 `index.html` 的 `?v=` 參數。
5. 方案三涉及開機流程核心邏輯，實施後須在 **Demo 模式**與**正式模式**下分別測試，且要測試**有快取**與**無快取**兩種情境。
