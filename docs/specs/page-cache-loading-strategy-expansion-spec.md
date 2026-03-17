# 全站頁面快取與載入策略擴張規格書

## 1. 文件目的

本文件定義 SportHub 下一階段的頁面載入策略擴張方式。

目標不是把所有頁面都硬改成首頁 / 活動頁同一種模式，而是先把頁面分型，再依頁面特性套用正確的載入策略，避免：

1. 該快的頁面不夠快
2. 該新的頁面不夠新
3. 該保守的頁面被錯用舊快取
4. 不同頁面各自長成不同邏輯，後續越來越難維護

---

## 2. 核心原則

### 2.1 不追求全站單一策略

不同頁面分成 4 種策略：

1. 快取先開型（stale-first）
2. 快取先看，但操作前先確認型（stale-confirm）
3. 先準備關鍵資料再開型（prepare-first）
4. fresh-first 型

### 2.2 先分類，再施工

先定清楚每頁屬於哪一型，再改導航、資料契約與 render 順序。

### 2.3 先補資料契約，再談 stale-first

若頁面目前沒有明確的 `page -> data -> render` 契約，就不能直接套用首頁 / 活動頁做法。

### 2.4 即時監聽只留給真的需要的頁面

不是所有頁面都值得開 realtime。能靠靜態抓取 + TTL 的頁面，就不要一進頁就常駐監聽。

### 2.5 不重複建造已有基礎設施

施工前必須先確認現有能力，避免重工。已有能力直接複用，缺口才需新建。

---

## 3. 現有基礎設施盤點

施工前必須了解目前已經具備哪些能力，避免重複建造：

### 3.1 已實作的能力

| 能力 | 現狀 | 位置 |
|------|------|------|
| stale-first 頁面 | `page-home` + `page-activities` 已完成 | `navigation.js` `_canUseStaleFirstNavigation()` |
| 跨頁 transition guard | `_pageTransitionSeq` 防過期 render | `navigation.js` 行 7 |
| page-scoped listeners | 4 頁已定義（見下方） | `firebase-service.js` `_pageScopedRealtimeMap` |
| localStorage 持久化 | 幾乎所有集合都已持久化 | `firebase-service.js` `_debouncedPersistCache()` |
| TTL 快取過期 | admin 30 分鐘 / 一般用戶 120 分鐘 | `firebase-service.js` `_LS_TTL` / `_LS_TTL_LONG` |
| 靜態集合 reload check | events / teams / tournaments 等 1 分鐘 | `firebase-service.js` `_staticReloadMaxAgeMs` |
| Loading overlay | 非 stale-first 路徑顯示 | `navigation.js` `_beginRouteLoading()` |
| 背景刷新 | stale-first 頁面用 `_refreshStaleFirstPage()` | `navigation.js` 行 131-156 |
| Cloud init 超時保護 | 15 秒超時 → 用 localStorage 兜底 | `navigation.js` 行 10-21 |

### 3.2 目前 page-scoped realtime listener 定義

```
page-activities:      registrations, attendanceRecords
page-activity-detail: registrations, attendanceRecords
page-my-activities:   registrations, attendanceRecords
page-scan:            attendanceRecords
```

### 3.3 目前全局 realtime listener

- `users`（Admin 級以上）
- `rolePermissions`
- `messages`

### 3.4 需要新建的能力（差距）

| 缺口 | 說明 |
|------|------|
| 策略 registry | 目前 stale-first 判斷散落在 `_canUseStaleFirstNavigation()` 的 if/else |
| 資料契約 registry | 目前 `ensureCollectionsForPage()` 內硬寫，無統一定義 |
| 頁面級 render guard | 只有跨頁 `_pageTransitionSeq`，缺同頁多次 render 防護 |
| fresh-check 標準機制 | 無統一的操作前確認流程 |
| 分集合 TTL | `_staticReloadMaxAgeMs` 全部 1 分鐘，未依變動頻率分級 |

---

## 4. 四種策略定義

### 4.1 快取先開型（stale-first）

白話流程：

1. 點頁面
2. 若本機已有舊畫面或舊資料，先開頁
3. 使用者先看到內容
4. 背後再抓較新的資料
5. 若資料有變，再局部更新畫面
6. 若該頁真的需要，再延後啟動即時監聽

適用條件：

- 主要是列表、瀏覽、統計
- 舊幾秒到幾十秒可接受
- 先開畫面比資料百分之百最新更重要

### 4.2 快取先看，但操作前先確認型（stale-confirm）

白話流程：

1. 點頁面
2. 先用快取資料開頁
3. 背後刷新較新的資料
4. 使用者可先看內容
5. 但在按下會改資料的按鈕前，先抓一次最新資料（fresh-check）
6. 確定狀態沒變，再送出操作

適用條件：

- 可先看舊資料
- 但操作會影響資料、名額、狀態或他人結果

### 4.3 先準備關鍵資料再開型（prepare-first）

白話流程：

1. 點頁面
2. 先抓這頁最重要的資料
3. 關鍵資料 ready 後才開頁
4. 進頁後只對最敏感的部分補 realtime
5. 不是整頁全 realtime，而是重點即時

適用條件：

- 詳情頁
- 不能太舊
- 但也不值得整頁全程即時監聽

### 4.4 fresh-first 型

白話流程：

1. 點頁面
2. 先確認權限、裝置、狀態或最新資料
3. 確定可用後才開頁
4. 不用舊畫面頂著做主依據

適用條件：

- 掃碼頁
- 後台修改頁
- 權限與修復頁
- 任何用舊快取可能造成誤操作的頁面

---

## 5. 頁面分型總表

### 5.1 快取先開型（stale-first）

| 頁面 | 狀態 | 備註 |
|------|------|------|
| `page-home` | **已完成** | 目前已可 stale-first + 背景刷新 |
| `page-activities` | **已完成** | 目前已可 soft entry + 背景刷新 |
| `page-teams` | 待施工 | |
| `page-tournaments` | 待施工 | |
| `page-personal-dashboard` | 待施工 | |
| `page-leaderboard` | 待施工 | |

### 5.2 快取先看，但操作前先確認型（stale-confirm）

| 頁面 | 備註 |
|------|------|
| `page-profile` | 編輯前 fresh-check |
| `page-team-detail` | 申請 / 退出前 fresh-check |
| `page-tournament-detail` | 報名前 fresh-check |
| `page-shop` | 購買前 fresh-check |
| `page-shop-detail` | 購買前 fresh-check |
| `page-admin-dashboard` | 統計類，管理操作前 fresh-check |
| `page-admin-teams` | 審核前 fresh-check |
| `page-admin-tournaments` | 修改前 fresh-check |

### 5.3 先準備關鍵資料再開型（prepare-first）

| 頁面 | 備註 |
|------|------|
| `page-activity-detail` | **已接近完成** — 進頁前準備 event + 進頁後 realtime registrations / attendanceRecords |
| `page-my-activities` | 需即時反映報名狀態，目前有 registrations 的 page-scoped realtime |

### 5.4 fresh-first 型（不允許 stale-first）

- `page-scan`
- `page-qrcode`
- `page-game`
- `page-admin-users`
- `page-admin-exp`
- `page-admin-auto-exp`
- `page-admin-roles`
- `page-admin-achievements`
- `page-admin-banners`
- `page-admin-shop`
- `page-admin-messages`
- `page-admin-games`
- `page-admin-themes`
- `page-admin-announcements`
- `page-admin-inactive`
- `page-admin-logs`
- `page-admin-repair`

### 5.5 施工前需先補齊資料契約的頁面

以下頁面尚未有明確的 `page -> data -> render` 契約，**在契約補齊前不得套用 stale-first / stale-confirm**：

| 頁面 | 目標策略 | 缺什麼 |
|------|----------|--------|
| `page-messages` | stale-confirm | 依賴集合不明確（messages 子查詢動態構築）|
| `page-achievements` | stale-confirm | 依賴 achievements + badges + 用戶進度，未明確分層 |
| `page-titles` | stale-confirm | 依賴同 achievements，需一併釐清 |
| `page-user-card` | stale-confirm | 依賴 currentUser + achievements + 個人統計，需定義哪些先到 |

---

## 6. 資料契約表

### 6.1 集合 TTL 建議值

依集合的變動頻率，建議調整 `_staticReloadMaxAgeMs`：

| 集合 | 目前 TTL | 建議 TTL | 理由 |
|------|----------|----------|------|
| `events` | 60 秒 | 60 秒（維持） | 報名中的活動需要較新資料 |
| `teams` | 60 秒 | 5 分鐘 | 球隊資料變動頻率低 |
| `tournaments` | 60 秒 | 5 分鐘 | 錦標賽變動頻率低 |
| `standings` | 60 秒 | 5 分鐘 | 賽程積分變動頻率低 |
| `matches` | 60 秒 | 5 分鐘 | 賽程比賽變動頻率低 |
| `shopItems` | 無 | 10 分鐘 | 商品變動頻率極低 |
| `leaderboard` | 無 | 15 分鐘 | 排行榜計算後才變 |
| `achievements` | 無 | 30 分鐘 | 成就定義幾乎不變 |
| `badges` | 無 | 30 分鐘 | 徽章定義幾乎不變 |

### 6.2 頁面資料依賴表

| 頁面 | 必要集合（required） | 可背景補的集合（optional） | realtime 集合 |
|------|---------------------|--------------------------|--------------|
| `page-home` | events, banners, announcements | teams, tournaments, leaderboard | — |
| `page-activities` | events | registrations | registrations |
| `page-teams` | teams | — | — |
| `page-tournaments` | tournaments | standings, matches | — |
| `page-personal-dashboard` | events, registrations | attendanceRecords | — |
| `page-leaderboard` | leaderboard | — | — |
| `page-profile` | currentUser | achievements, badges | — |
| `page-team-detail` | teams | — | — |
| `page-tournament-detail` | tournaments, standings, matches | — | — |
| `page-shop` | shopItems | — | — |
| `page-activity-detail` | events | registrations, attendanceRecords | registrations, attendanceRecords |
| `page-my-activities` | events, registrations | attendanceRecords | registrations |
| `page-scan` | events, attendanceRecords | — | attendanceRecords |

---

## 7. 技術規格

### 7.1 頁面策略 Registry

在 `js/config.js` 或獨立 registry 檔中定義，作為唯一策略來源：

```js
const PAGE_STRATEGY = {
  'page-home':               'stale-first',
  'page-activities':         'stale-first',
  'page-teams':              'stale-first',
  'page-tournaments':        'stale-first',
  'page-personal-dashboard': 'stale-first',
  'page-leaderboard':        'stale-first',

  'page-profile':            'stale-confirm',
  'page-team-detail':        'stale-confirm',
  'page-tournament-detail':  'stale-confirm',
  'page-shop':               'stale-confirm',
  'page-shop-detail':        'stale-confirm',
  'page-admin-dashboard':    'stale-confirm',
  'page-admin-teams':        'stale-confirm',
  'page-admin-tournaments':  'stale-confirm',

  'page-activity-detail':    'prepare-first',
  'page-my-activities':      'prepare-first',

  // 所有未列出的頁面預設 fresh-first
};
```

### 7.2 showPage() 策略分派重構

目前 `showPage()` 超過 400 行，不應繼續在裡面加 if/else。改為策略分派模式：

```js
async showPage(pageId, options = {}) {
  const seq = ++this._pageTransitionSeq;
  const strategy = PAGE_STRATEGY[pageId] || 'fresh-first';

  // 共用前置：權限檢查、登入檢查
  if (!this._preShowPageChecks(pageId, options)) return;

  switch (strategy) {
    case 'stale-first':
      return this._showPageStaleFirst(pageId, seq, options);
    case 'stale-confirm':
      return this._showPageStaleConfirm(pageId, seq, options);
    case 'prepare-first':
      return this._showPagePrepareFirst(pageId, seq, options);
    default:
      return this._showPageFreshFirst(pageId, seq, options);
  }
}
```

每個策略函式內部職責：
- `_showPageStaleFirst`：快取有效 → 立即渲染 → 背景刷新 → 差異更新
- `_showPageStaleConfirm`：同 stale-first，但操作按鈕綁定 fresh-check
- `_showPagePrepareFirst`：顯示 overlay → 載入關鍵集合 → 渲染 → 啟動 page-scoped realtime
- `_showPageFreshFirst`：顯示 overlay → 載入所有集合 → 渲染

### 7.3 fresh-check 標準流程

所有 stale-confirm 頁面的操作按鈕，送出前必須經過此流程：

```
fresh-check 標準流程：

1. 對操作涉及的文件做 db.collection(X).doc(id).get()
   — 不是重載整個集合，只查單一文件
2. 超時上限 3 秒
3. 超時時顯示 toast「資料確認中，請稍候」並禁止送出
4. 比對取得的資料與本地快取：
   a. 若一致 → 允許送出
   b. 若不一致 → 先更新本地快取 + 重繪 UI → 再讓用戶確認是否仍要操作
5. 若完全無法連線（離線）→ 禁止操作，toast「目前離線，無法執行此操作」
```

實作建議：封裝為共用函式 `_freshCheckBeforeAction(collection, docId, cachedData)`

```js
async _freshCheckBeforeAction(collection, docId, cachedData) {
  try {
    const doc = await Promise.race([
      db.collection(collection).doc(docId).get(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 3000)),
    ]);
    if (!doc.exists) return { ok: false, reason: 'NOT_FOUND' };
    const freshData = doc.data();
    const changed = JSON.stringify(freshData) !== JSON.stringify(cachedData);
    return { ok: true, changed, freshData };
  } catch (err) {
    return { ok: false, reason: err.message === 'TIMEOUT' ? 'TIMEOUT' : 'OFFLINE' };
  }
}
```

### 7.4 頁面級 Render Guard 標準模式

防止同一頁面的背景刷新覆蓋正在渲染的內容：

```js
// 每頁維護自己的 render sequence
_teamsRenderSeq: 0,

async renderTeamsList() {
  const seq = ++this._teamsRenderSeq;
  const data = ApiService.getAllTeams();
  // async 操作後檢查
  if (seq !== this._teamsRenderSeq) return; // 被新的 render 取代
  // 實際 DOM 渲染...
},
```

命名規則：`_{pageName}RenderSeq`，例如 `_teamsRenderSeq`、`_tournamentsRenderSeq`。

### 7.5 背景刷新差異檢測

stale-first 頁面背景刷新後，不應盲目重繪整頁。標準做法：

```
1. 記錄快取版本（_collectionLoadedAt 或資料 hash）
2. 背景 reload 完成後，比對新舊版本
3. 若無差異 → 不觸發 re-render
4. 若有差異 → 呼叫頁面的局部更新函式（非整頁重建）
5. 局部更新時保留用戶的篩選狀態、滾動位置
```

---

## 8. 施工步驟

### Step 1：建立頁面策略清單與資料契約表

工作內容：

1. 在 `js/config.js` 中建立 `PAGE_STRATEGY` registry（§7.1）
2. 在 `js/config.js` 中建立 `PAGE_DATA_CONTRACT` registry（§6.2）
3. 調整 `_staticReloadMaxAgeMs` 依集合分級（§6.1）
4. 標記 fresh-first deny list
5. 盤點 §5.5 中需先補齊資料契約的頁面

建議交付物：

- `PAGE_STRATEGY` 常數
- `PAGE_DATA_CONTRACT` 常數
- 更新後的 `_staticReloadMaxAgeMs`

工作量：

- 複雜度：中
- 主要耗時：盤點現有頁面與資料依賴

自我驗收：

- 每個主要頁面都有策略型別
- 每個主要頁面都有資料依賴表
- 沒有同一頁同時標成互相衝突的策略
- §5.5 的頁面未被放入 stale-first / stale-confirm
- `_staticReloadMaxAgeMs` 中低頻集合的 TTL 已延長

可能產生的 BUG：

- 頁面分類錯誤，導致不該 stale 的頁面誤用舊資料
- 頁面漏列依賴集合，進頁後出現半殘畫面
- 同一頁不同入口使用不同策略，造成行為分裂

風險修復方式：

- 先以 registry 為唯一來源，不接受散落頁面內部各自判斷
- 對每頁做 `page -> data -> render` 對照檢查
- 由第三方角度抽查高風險頁面：活動詳情、訊息、後台頁

---

### Step 2：把導航層改成策略分派模式

工作內容：

1. 將 `showPage()` 重構為策略分派（§7.2）
2. 抽出 4 個策略函式：`_showPageStaleFirst` / `_showPageStaleConfirm` / `_showPagePrepareFirst` / `_showPageFreshFirst`
3. 把現有 `page-home` / `page-activities` 的 stale-first 邏輯遷入 `_showPageStaleFirst`
4. 保留 `_pageTransitionSeq` guard，每個策略函式內部檢查
5. 統一 loading overlay 管理：stale-first / stale-confirm 不顯示，其餘顯示

重構策略（降低風險）：

- 第一步：先抽出策略分派框架，但所有策略暫時都走現有 `showPage()` 的完整流程
- 第二步：把 `page-home` / `page-activities` 的 stale-first 搬入新函式，驗證無退步
- 第三步：逐一啟用其他頁面的策略

工作量：

- 複雜度：高
- 主要耗時：整理 `navigation.js` 中既有分支與例外

自我驗收：

- 首頁 / 活動頁體感不能退步（最重要）
- 路由層不再只硬寫 `page-home` / `page-activities`
- 新策略可由 registry 控制
- 進頁流程不因策略新增而互相覆蓋

可能產生的 BUG：

- 切頁流程卡住
- route loading overlay 無法正確結束
- 快速連點造成過期 render 覆蓋新畫面
- hash / history 同步錯亂
- 重構後首頁 / 活動頁行為改變

風險修復方式：

- 保留 transition sequence guard
- 每種策略都走同一套 route timeout 保險絲（15 秒）
- 在 `showPage()` 加入策略層級的 console.log 便於除錯
- 重構完先只對首頁 / 活動頁啟用，確認無誤後再開放

---

### Step 3：先擴張「快取先開型」頁面

目標頁面：

- `page-teams`
- `page-tournaments`
- `page-personal-dashboard`
- `page-leaderboard`

工作內容：

1. 讓這些頁面支援先開頁再背景刷新
2. 為每頁建立 render guard（§7.4）
3. 實作背景刷新差異檢測（§7.5）
4. 非必要不要開 realtime

工作量：

- 複雜度：中
- 主要耗時：補頁面 render guard、局部重 render 邏輯

自我驗收：

- 再次進入頁面時可先顯示既有畫面
- 背後刷新後資料有變才更新
- 沒有變動時不重刷整頁
- 不會因 stale-first 造成白屏或按鈕失效
- 回頁後篩選狀態 / 滾動位置保留

可能產生的 BUG：

- 顯示舊資料後沒有補更新
- 多次 render 造成列表重複、事件綁定重複
- 頁面標題 / 篩選狀態被重設

風險修復方式：

- 每頁補 render guard（§7.4）
- 對重 render 頁面採局部刷新，不整頁重建
- 驗證回頁後篩選狀態是否保留

---

### Step 4：再擴張「快取先看，但操作前先確認型」頁面

目標頁面（排除 §5.5 需先補契約的頁面）：

- `page-profile`
- `page-team-detail`
- `page-tournament-detail`
- `page-shop`
- `page-shop-detail`
- `page-admin-dashboard`
- `page-admin-teams`
- `page-admin-tournaments`

工作內容：

1. 頁面本身可先用快取開啟
2. 實作 `_freshCheckBeforeAction()` 共用函式（§7.3）
3. 逐頁盤點操作按鈕，在送出前插入 fresh-check
4. fresh-check 發現資料已變時，先重繪 UI 再提示

工作量：

- 複雜度：高
- 主要耗時：逐頁盤點操作按鈕與狀態依賴

自我驗收：

- 頁面可先開
- 背後可刷新
- 操作按鈕送出前會抓最新狀態
- 名額、狀態、擁有權變動時不會用舊資料直接送出
- fresh-check 失敗時有明確的 toast 提示

可能產生的 BUG：

- 使用者看到能按的按鈕，但送出時被最新資料打回
- fresh-check 完後 UI 沒同步，造成誤會
- detail 頁的 stale data 與操作結果互相打架

風險修復方式：

- fresh-check 失敗時明確 toast 說明原因
- 送出前若狀態已變，先重畫最新畫面再提示
- 把「可看快取」與「可用來送出」分成兩層判斷

---

### Step 4.5：補齊 §5.5 頁面的資料契約後納入

目標頁面：

- `page-messages`
- `page-achievements`
- `page-titles`
- `page-user-card`

前提：必須先完成該頁的資料契約定義（依賴集合 / 先到欄位 / 背景補充 / 操作前 fresh-check），確認後才可套用 stale-confirm 策略。

---

### Step 5：整理活動詳細頁，作為高敏感詳情頁範本

目標頁面：

- `page-activity-detail`

工作內容：

1. 明確分出哪些資料要先準備
2. 明確分出哪些資料進頁後走 page-scoped realtime
3. 確認整體人數、報名狀態、出席表格的資料來源一致
4. 評估是否升級為 event-scoped realtime
5. 此頁作為 prepare-first 的範本，`page-my-activities` 參考此做法

工作量：

- 複雜度：高
- 主要耗時：整理 event detail 主資料與周邊資料來源

自我驗收：

- 進頁時不會出現明顯錯誤或按鈕幽靈狀態
- `registrations` 更新時，報名狀態與人數能正確回灌
- `attendanceRecords` 更新時，出席表格能正確更新
- 不會出現一般用戶看到錯誤整包資料範圍

可能產生的 BUG：

- 報名人數與名單不同步
- 報名按鈕狀態和實際報名狀態不一致
- 一般用戶看到部分即時、部分舊資料而誤判

風險修復方式：

- 統一 event detail 的人數與名單 helper（目前已有 `_rebuildOccupancy`）
- 明確區分「主活動資料」與「即時補充資料」
- 先驗證 admin / 一般 user / 未登入 3 種視角

---

### Step 6：保守處理 fresh-first 頁面

目標頁面：

- `page-scan`
- `page-qrcode`
- `page-game`
- 多數後台編輯 / 修復 / 權限頁

工作內容：

1. 在 `PAGE_STRATEGY` registry 中確認這些頁面為 fresh-first（或未列出 → 預設 fresh-first）
2. 在導航層對未列出的頁面強制走 `_showPageFreshFirst`
3. 僅做局部效能優化（如 TTL 調整），不做快取先開

工作量：

- 複雜度：低
- 主要耗時：確認 registry 正確、驗證不受其他策略影響

自我驗收：

- 這些頁面不會誤走 stale-first
- 相機、權限、修復頁仍以正確性優先
- 後台修改頁不會拿舊資料當主依據

可能產生的 BUG：

- 某些後台頁被誤分類後，直接顯示舊資料
- 掃碼頁進頁時相機 / 權限流程被錯誤延後
- 修復頁用快取資料導致管理員做錯事

風險修復方式：

- 預設策略為 fresh-first（未列入 registry 的頁面自動歸此類）
- 驗證高風險頁面不受 stale-first 影響

---

### Step 7：全站整合驗收與第三方驗收

工作內容：

1. 針對各策略頁面做整合驗收
2. 以第三方角度重跑一次高風險頁面
3. 補抓「自己施工時容易忽略」的 UI / 狀態邊角問題

工作量：

- 複雜度：中高
- 主要耗時：跨頁回歸測試與角色視角測試

驗收矩陣：

| 測試項目 | stale-first | stale-confirm | prepare-first | fresh-first |
|----------|-------------|---------------|---------------|-------------|
| 首次載入（無快取） | 應等待載入 | 應等待載入 | 應等待關鍵資料 | 應等待載入 |
| 再次進入（有快取） | 應秒開 | 應秒開 | 應等待關鍵資料 | 應等待載入 |
| 背景刷新有新資料 | 局部更新 | 局部更新 | realtime 即時 | N/A |
| 背景刷新無新資料 | 不重繪 | 不重繪 | N/A | N/A |
| 操作按鈕送出前 | 直接送出 | fresh-check | fresh-check | 直接送出 |
| 快速連點切頁 | 不卡住 | 不卡住 | 不卡住 | 不卡住 |
| 離頁後 listener | 無 | 無 | 應收尾 | 應收尾 |

角色視角測試：

- 未登入用戶
- 一般用戶（user）
- 教練（coach）
- 管理員（admin）
- 超級管理員（super_admin）

可能產生的 BUG：

- 某一頁策略正確，但從別的頁入口進來就錯
- 同一頁在不同角色下資料權限不同，導致 stale render 異常
- 離頁後 listener 沒收乾淨

風險修復方式：

- 驗收時以「入口」而不是只以「頁面」測試
- 驗證多角色視角
- 驗證切頁與返回時 listener finalize 是否正確

---

## 9. 建議施工順序

建議分 5 批做，不要全站一起改：

### Batch A：基礎設施（Step 1 + Step 2）

- 建立 registry
- 調整 TTL
- 重構 `showPage()` 策略分派
- 驗證首頁 / 活動頁無退步

### Batch B：最容易成功的前台列表頁（Step 3）

- `page-teams`
- `page-tournaments`
- `page-personal-dashboard`
- `page-leaderboard`

### Batch C：有操作的前台頁面（Step 4）

- `page-profile`
- `page-team-detail`
- `page-tournament-detail`
- `page-shop` / `page-shop-detail`

### Batch D：高敏感詳情與狀態頁（Step 4.5 + Step 5）

- `page-activity-detail`
- `page-my-activities`
- §5.5 補齊契約後的頁面

### Batch E：保守處理 + 整合驗收（Step 6 + Step 7）

- 確認 fresh-first 頁面不受影響
- 全站整合驗收

---

## 10. 總工作量評估

### 整體複雜度

- 複雜度：高

### 原因

1. 不只是資料抓取，還會動到導航流程
2. 不只是前台 render，還會碰到 realtime 啟動與收尾
3. 不同頁面有不同資料敏感度，不能複製貼上
4. 需避免破壞既有首頁 / 活動頁的成熟策略

### 粗略工作量

| 步驟 | 複雜度 | 說明 |
|------|--------|------|
| Step 1 Registry + TTL | 中 | 盤點現有頁面與資料依賴 |
| Step 2 導航重構 | 高 | showPage() 拆分為策略分派，需嚴格回歸測試 |
| Step 3 列表頁擴張 | 中 | 補 render guard、局部刷新 |
| Step 4 操作頁擴張 | 高 | 逐頁盤點按鈕、實作 fresh-check |
| Step 4.5 補契約頁面 | 中 | 需先釐清依賴再施工 |
| Step 5 活動詳情 | 高 | 整理主資料與即時資料來源 |
| Step 6 fresh-first | 低 | 確認 registry + 驗證 |
| Step 7 整合驗收 | 中高 | 跨頁回歸 + 多角色測試 |

---

## 11. 全域風險總表

### 11.1 策略誤分類風險

可能 BUG：

- 不該用 stale 的頁面先顯示舊資料
- 使用者根據舊資料誤操作

修復方式：

- 以 `PAGE_STRATEGY` registry 為唯一策略來源
- 未列入 registry 的頁面預設 fresh-first（最保守）
- 建立 deny list 保護高風險頁

### 11.2 資料契約不完整風險

可能 BUG：

- 頁面開了，但資料只到一半
- 部分區塊空白或按鈕狀態錯誤

修復方式：

- 先補 `PAGE_DATA_CONTRACT` → `requiredCollections`
- 缺契約頁不得先導入 stale-first（§5.5 規則）

### 11.3 render 重複與事件綁定重複風險

可能 BUG：

- 列表重複
- 按鈕點一次執行兩次
- DOM 狀態被背景刷新蓋掉

修復方式：

- 每頁建立 render guard（§7.4）
- 背景刷新優先做局部更新（§7.5）

### 11.4 listener 管理錯誤風險

可能 BUG：

- 離頁後 listener 還活著
- 其他頁被不相關 realtime 更新干擾

修復方式：

- page-scoped realtime 一律由導航層統一收尾
- 不允許頁面自行偷偷常駐監聽
- `_pageScopedRealtimeMap` 為唯一 listener 定義來源

### 11.5 fresh-check 沒做完整風險

可能 BUG：

- 使用者看到可按，送出卻撞到過期資料
- 名額 / 狀態 / 擁有權判斷錯誤

修復方式：

- `_freshCheckBeforeAction()` 為標準共用函式（§7.3）
- 所有 stale-confirm 頁面的操作按鈕必須走此流程

### 11.6 首頁 / 活動頁退步風險

可能 BUG：

- 重構 showPage() 後，原本秒開的首頁 / 活動頁變慢或壞掉

修復方式：

- Step 2 分三階段重構（先框架 → 搬遷既有 → 逐一啟用）
- 每階段必須驗證首頁 / 活動頁無退步後才進下一階段

---

## 12. 最終驗收標準

### 功能面

1. 每頁都能在 `PAGE_STRATEGY` 中找到自己的策略型別
2. 每頁都能在 `PAGE_DATA_CONTRACT` 中找到自己的資料來源
3. 首頁 / 活動頁既有體感不能退步

### 使用者體感

1. 常進頁面明顯更快（stale-first 頁面秒開）
2. 不該卡住的頁面不再先等資料才開
3. 需要最新資料的頁面不會因快取而誤導
4. 操作按鈕送出前的 fresh-check 不會造成明顯等待感（< 3 秒）

### 維護面

1. 新頁面未來可直接在 registry 中選擇策略型別
2. 不再每頁各自發明一套切頁與刷新邏輯
3. 導航、資料層、頁面 renderer 的責任邊界更清楚
4. showPage() 從 400+ 行的單一函式 → 策略分派 + 各策略 < 100 行

---

## 13. 結論

本計畫的目標不是把全站都改成首頁 / 活動頁同一招，而是把全站頁面整理成：

1. 哪些頁面重視秒開（stale-first）
2. 哪些頁面可以先看但操作要確認（stale-confirm）
3. 哪些頁面需要先準備再開（prepare-first）
4. 哪些頁面絕對不能信舊資料（fresh-first）

只要先把這 4 種策略收斂清楚，後續擴張快取與背後載入時，風險才可控，架構也才會越來越分明。
