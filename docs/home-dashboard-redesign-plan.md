# 首頁儀表首頁改版計劃書

> 狀態：規劃修正版，尚未實作 production code
> 日期：2026-05-06
> 範圍：首頁 `page-home` UI 改版、首頁 boot data 改造、比分預留區與後台控制頁規劃
> 重要結論：本計劃已納入深度審計補正。若後續實作發現中型以上新瑕疵，必須停下回報，不可硬做。

## 一、改版目標

首頁由上到下改成：

1. 保留輪播 banner，不改現有行為。
2. 保留走馬燈公告，不改現有行為。
3. 新增各類運動快速分類入口，橫向設計。
   - 有活動的運動依活動數由多到少排列。
   - 0 活動的運動依 `EVENT_SPORT_OPTIONS` 既有設定順序排列。
   - 點擊後切換全站運動篩選，並導向活動頁。
4. 新增當前資訊數量儀表。
   - 順序：活動數、俱樂部數、賽事數。
   - 活動數點擊導向活動頁。
   - 俱樂部數點擊導向俱樂部頁。
   - 賽事數點擊導向賽事頁。
   - 活動數右側顯示眼睛 SVG 與活動瀏覽總數。
   - 俱樂部/賽事右側保留眼睛 SVG，但明確標示「預留」或「尚未追蹤」，本階段不顯示假數字。
5. 新增「我要開活動」按鈕。
   - 位置需明顯但不搶版面。
   - 目標導向一般建立活動流程。
6. 新增比分與行事曆預留區。
   - 預設放在小遊戲入口上方。
   - 初期顯示足球五大聯賽、歐冠、歐聯、世界盃的預留入口。
   - 預留未來 NBA、奧運、羽毛球等更多運動。
   - 首頁不得直接呼叫第三方比分 API。
7. 保留小遊戲入口。
   - 關閉時隱藏。
8. 保留體育新聞欄位。
   - 關閉時隱藏。

## 二、已審計過的現況重點

現有首頁由以下檔案與流程組成：

- `pages/home.html`
  - banner：`#banner-track`
  - 公告：`#announce-marquee-wrap`
  - 舊區域 tab：`#home-region-tabs`
  - 舊熱門活動：`#hot-events-loading`、`#hot-events`
  - 舊最新賽事：`#ongoing-tournaments`
  - 小遊戲入口：`#home-game-card-shot`、`#home-game-card-kick`
  - sponsor / news / floating ads
- `app.js`
  - `renderAll()` 目前用 `#hot-events` 判斷 content ready。
  - `renderHomeCritical()` 目前呼叫 `renderHotEvents()`、`renderOngoingTournaments()`。
  - `renderHomeDeferred()` 目前再次呼叫 `renderOngoingTournaments()`，再載入 sponsor/news/ads。
  - boot phase 目前讀 `boot-events-data`、`boot-banners-data`、`boot-tournaments-data`。
  - boot overlay phase 目前用 `FirebaseService._cache.events.length > 0` 判斷首頁是否已有內容。
- `js/modules/event/event-list.js`
  - `renderHotEvents()` 目前也負責呼叫 `renderHomeGameShortcut()`。
  - 舊熱門活動會依 region tab、sport filter、活動狀態過濾。
- `js/modules/tournament/tournament-render.js`
  - `renderOngoingTournaments()` 目前渲染舊首頁賽事卡。
- `js/core/theme.js`
  - `bindSportPicker()` 的 `setActiveSport()` 是 closure，外部首頁分類入口不能直接安全呼叫。
- `js/firebase-service.js`
  - 多處資料更新仍會回呼 `renderHotEvents()` / `renderOngoingTournaments()`。
  - `page-home` 目前只保證載入 `events`、`newsArticles`；teams 不在首頁 warmup，tournaments 只在背景 warmup。
  - `events`、`teams`、`tournaments` 現行查詢都有首批上限，不能把 `ApiService` cache 長度當成全站總量。
  - `siteConfig` 目前是 single-doc cache/direct doc 模式，不是一般 collection page map。
- `.github/workflows/inject-hot-events.yml` 與 `scripts/inject-hot-events.js`
  - 目前每 6 小時寫入完整熱門活動與賽事 payload 到 `index.html`。
  - 現有 script 只會 upsert block；若不明確移除舊 block，`boot-events-data` 與 `boot-tournaments-data` 會殘留。

## 三、審計補正後的硬性設計決策

### 1. 瀏覽數範圍

本階段只有「活動瀏覽數」是正式資料。

- 活動瀏覽數來源：`events.viewCount`。
- 活動瀏覽數統計：只加總可見且未結束、未取消活動。
- 已結束、已取消活動不得納入活動瀏覽數。
- 目前 `events.viewCount` 只代表「系統已記錄到的活動詳情瀏覽數」，不是全站所有訪客瀏覽數；首頁文案不得寫成「所有瀏覽數」。
- 俱樂部瀏覽數：本階段預留，不新增追蹤。
- 賽事瀏覽數：本階段預留，不新增追蹤。

原因：

- 現有專案只有活動詳情頁會累加 `events.viewCount`。
- Firestore rules 目前只允許 `events.viewCount` 安全 +1。
- `teams`、`tournaments` 尚無 viewCount 欄位、前端累加流程、rules 與測試。

首頁 UI 要避免誤導：

- 活動：眼睛 SVG + 「已記錄瀏覽」或「活動詳情瀏覽」總數。
- 俱樂部：眼睛 SVG + `預留` 或 `尚未追蹤`。
- 賽事：眼睛 SVG + `預留` 或 `尚未追蹤`。

若未來要啟用俱樂部/賽事瀏覽數，必須另開計劃，至少包含：

- `teams.viewCount` / `tournaments.viewCount` 或獨立 metrics collection。
- 詳情頁每日去重累加。
- Firestore rules 只允許 +1。
- unit tests 與 rules tests。

### 2. 首頁儀表統計必須使用「完整首頁摘要」，不得直接相信部分 cache

首頁儀表的活動數、俱樂部數、賽事數、活動瀏覽總數，必須以完整摘要資料為主。

嚴禁直接用以下方式當首頁總量：

```js
ApiService.getEvents().length
ApiService.getActiveTeams().length
ApiService.getTournaments().length
```

原因：

- `FirebaseService._cache.events` 現行 active 首批最多 200、terminal 首批最多 100。
- `FirebaseService._cache.teams` 現行首批最多 50，而且首頁不會保證載入 teams。
- `FirebaseService._cache.tournaments` 現行首批最多 100，且首頁只是背景 warmup。
- 直接用前端 cache 長度會讓首頁儀表顯示 0、舊快取、或部分數量。
- 活動可見性是使用者相依的。
- `_getVisibleEvents()` 會套用：
  - 俱樂部限定可見性。
  - 私密活動可見性。
  - owner 可見性。
  - blacklist / hidden visibility。
- GitHub Actions 產出的 inline summary 無法知道目前登入者、owner、delegate、黑名單與私密活動可見狀態。

實作規則：

- `boot-home-summary-data` 是首頁儀表的主要資料來源，不只是暫時 placeholder。
- `boot-home-summary-data` 必須由 GitHub Action 或同等後台任務完整分頁掃描後產生。
- 摘要只能包含公開安全統計，不包含活動標題、圖片、地點、主辦者等完整活動資料。
- 活動統計範圍採公開首頁口徑：未結束、未取消、非私密、非 team-only 活動。
- 俱樂部統計範圍採公開首頁口徑：active 俱樂部總數。
- 賽事統計範圍採公開首頁口徑：未結束賽事總數，判斷邏輯需與 `App.isTournamentEnded()` 等價。
- 活動瀏覽總數只加總公開首頁口徑活動的 `viewCount`。
- 運動分類排序使用摘要中的 `sportCounts`，避免用部分 event cache 排序。
- 前端 runtime cache 只有在確認資料完整時才可覆蓋摘要；若只是首批/部分 cache，只能刷新互動狀態，不可覆蓋總數。
- 登入後本階段不額外做「個人化私密活動總量」；自己的私密活動仍在活動頁/我的活動頁依既有權限顯示。

建議摘要 schema：

```js
homeSummary = {
  schemaVersion: 1,
  generatedAt: '2026-05-06T00:00:00.000Z',
  source: 'github-action',
  scope: 'public-active',
  complete: true,
  counts: {
    activities: 0,
    teams: 0,
    tournaments: 0
  },
  activityViews: {
    total: 0
  },
  sportCounts: [
    { sportTag: 'football', count: 0 }
  ]
};
```

活動摘要的「未結束」不得只看 Firestore 文件上的 `status`。必須新增或抽出純函式：

```js
getHomeSummaryEventEffectiveStatus(event, now)
isHomeSummaryPublicActiveEvent(event, now)
```

硬性口徑：

- `cancelled` 一律視為取消，`ended` 一律視為結束。
- `open` / `full` / `upcoming` 若活動開始時間已過，首頁 summary 必須視為 `ended`；這與現有前台「開始後即不再列為可報名活動」的口徑一致。
- 判斷時間以活動開始時間為準；無法解析開始時間時才視為仍可保守保留，不因解析失敗直接歸零。
- `upcoming` 若報名時間已到但活動開始時間尚未到，可視為公開有效活動；summary script 不需要把狀態寫回 Firestore。
- `counts.activities`、`sportCounts`、`activityViews.total` 必須全部使用同一個 `isHomeSummaryPublicActiveEvent(event, now)` helper。
- 不可讓活動數、運動分類排序、瀏覽數各自使用不同 filter。

若摘要不存在或 `complete !== true`：

- 首頁儀表顯示「載入中」或安全 fallback，不顯示誤導性的 0。
- 不使用 partial cache 假裝總量。
- `git diff` 與測試必須能證明不會從 `ApiService.getActiveTeams().length` 這類部分 cache 直接取總量。

### 3. 比分區本階段只做預留與設定，不串第三方 API

本階段範圍：

- 首頁新增比分/行事曆預留區 UI。
- 新增左側抽屜管理入口「賽事比分控制」。
- 後台頁可設定資料來源開關、排序、首頁顯示數量、快取 TTL 等設定。
- 設定只保存為平台設定，尚不呼叫任何第三方比分 API。
- 首頁比分區只讀本機/inline/cache 摘要，不打第三方 API。

不在本階段：

- 不串 Football Data API。
- 不串 NBA、奧運、BWF 等 API。
- 不實作比分 ingestion job。
- 不把任何 API key 放前端。

未來串 API 時必須另開計劃：

- 第三方 API 必須由 Cloud Function 或 GitHub Action 後台 job 呼叫。
- API key 僅能放 secrets。
- 寫入公開安全的 `homeScoreboardSnapshot` 或 inline summary。
- 首頁只讀已整理快取。

### 4. GitHub inline 任務必須改造，不能殘留舊 payload

舊任務不能繼續寫：

- `boot-events-data`
- `boot-tournaments-data`

新方向：

- 保留或改造 banner inline，加速 banner 首屏。
- 必須新增 `boot-home-summary-data`，作為首頁儀表的完整公開摘要。
- 可新增 `boot-scoreboard-summary-data`，但只放已整理好的預留/快取摘要。
- 新 script 必須明確移除舊 `BOOT_EVENTS_INJECT_*` 與 `BOOT_TOURNAMENTS_INJECT_*` block。
- `app.js` boot loader 必須停止讀舊 script id。
- 新 script 必須完整分頁掃描 events / teams / tournaments，不能只抓第一頁或沿用前端首批限制。
- 新 script 必須有摘要 schema 驗證與 inline JSON 大小檢查，避免又把完整卡片資料塞回首頁。

### 5. 文件同步不可漏

正式實作完成後必須同步更新：

- `docs/architecture.md`
- `docs/structure-guide.md`
- `docs/tunables.md`
- `docs/claude-memory.md`

原因：

- 本次會改首頁初始化順序、content ready、boot payload、GitHub inline 任務、可能新增管理頁與設定快取 TTL。
- 這些都屬於專案規則要求記錄的架構與 tunables 變更。

## 四、資料邏輯

### 首頁摘要取得順序

首頁儀表資料來源順序：

1. 讀 `boot-home-summary-data`。
2. 驗證 `schemaVersion === 1`、`complete === true`、必要欄位都是有限數字。
3. 驗證失敗時顯示安全 fallback，不用部分 cache 補 0。
4. Firebase 後續載入完成後，只有在資料來源標記完整時才可覆蓋摘要。

前端新增 helper 建議：

```js
getHomeSummary()
normalizeHomeSummary(raw)
isHomeSummaryComplete(summary)
```

### 活動數

正式顯示值：

```js
const activityCount = homeSummary.counts.activities;
```

摘要產生規則：

- 完整分頁掃描 `events`。
- 使用 `isHomeSummaryPublicActiveEvent(event, now)` 判斷是否納入。
- 不可只用 `status !== 'ended' && status !== 'cancelled'`，因為既有活動可能已過期但文件狀態仍是 `open` / `full` / `upcoming`。
- 排除 `privateEvent === true`。
- 排除 `teamOnly === true`。
- 不納入被設計為登入者相依才可見的活動。

注意：

- 不直接用 `ApiService.getEvents().length`。
- 不直接用 `_getVisibleEvents()` 的部分 cache 結果覆蓋總量。
- 本階段首頁儀表採公開首頁口徑，不顯示個人化私密活動總量。

### 活動瀏覽數

正式顯示值：

```js
const activityViewTotal = homeSummary.activityViews.total;
```

摘要產生規則：

- 與活動數使用同一批公開首頁口徑活動。
- `viewCount` 必須轉成有限非負數。
- 已結束、已取消、私密、team-only 活動都不納入。
- 首頁文案需標成「已記錄瀏覽」或「活動詳情瀏覽」，不得宣稱為所有訪客瀏覽。

注意：

- 不直接用部分 event cache reduce。
- 避免活動數與瀏覽數使用不同範圍。

### 俱樂部數

正式顯示值：

```js
const teamCount = homeSummary.counts.teams;
```

摘要產生規則：

- 完整分頁掃描 `teams`。
- 只計算 `active === true` 的俱樂部。

注意：

- 不直接用 `ApiService.getActiveTeams().length`，因為首頁不保證 teams 已載入且現行首批只有 50。
- 本階段不統計俱樂部瀏覽數。
- UI 顯示 `預留` 或 `尚未追蹤`。

### 賽事數

正式顯示值：

```js
const tournamentCount = homeSummary.counts.tournaments;
```

摘要產生規則：

- 完整分頁掃描 `tournaments`。
- 使用與 `App.isTournamentEnded()` 等價的純函式判斷是否結束。
- 已結束賽事不納入。

注意：

- 不直接用 `ApiService.getTournaments().filter(...)`，因為首頁不保證 tournaments 完整且現行首批只有 100。
- 本階段不統計賽事瀏覽數。
- UI 顯示 `預留` 或 `尚未追蹤`。

### 運動分類排序

1. 用 `EVENT_SPORT_OPTIONS` 當完整順序來源。
2. 用 `homeSummary.sportCounts` 當活動數來源。
3. `sportTag` 需用 `getSportKeySafe(sportTag) || 'football'` 同等邏輯正規化。
4. 有活動者依 count desc 排序。
5. count 相同或 0 活動者依 `EVENT_SPORT_OPTIONS` 原始順序排序。
6. 若摘要不存在或不完整，分類入口仍渲染但顯示安全 loading state，不以部分 cache 排序。

### 分類入口點擊

新增公開方法：

```js
App.setActiveSportFilter(sportKey, { silent: true });
```

此方法要與 top bar sport picker 共用同一套狀態：

- 更新 `App._activeSport`。
- 更新 `localStorage.sporthub_active_sport`。
- 更新 top bar sport picker active 狀態。
- 更新首頁分類入口 active 狀態。
- 需要時重渲染活動頁、俱樂部頁、賽事頁。

## 五、預計檔案變更

### 首頁 HTML

修改：

- `pages/home.html`

新增：

- `#home-sport-quick-entry`
- `#home-info-meter`
- `#home-scoreboard-preview`
- 「我要開活動」按鈕區塊

移除或停止使用：

- `#home-region-tabs`
- `#hot-events-loading`
- `#hot-events`
- `#ongoing-tournaments`
- 舊「最新活動」與「最新賽事」標題/分隔線

### 首頁 JS

新增：

- `js/modules/home/home-dashboard.js`

職責：

- `getHomeSportEntries()`
- `getHomeInfoMeterStats()`
- `renderHomeSportQuickEntry()`
- `renderHomeInfoMeter()`
- `renderHomeScoreboardPreview()`
- `selectHomeSportQuickEntry(sportKey)`
- `renderHomeGameShortcut()` 的呼叫從 `renderHotEvents()` 移出後，改由首頁 pipeline 明確呼叫。

載入要求：

- `home-dashboard.js` 必須在首頁初始 render 前可用。
- 因 `renderHomeCritical()` 會呼叫它，必須加到 `index.html` 首頁初始 script 區，或併入既有初始首頁模組。
- 不可只放在 deferred ScriptLoader，否則初始首頁可能找不到 function。

### Scoreboard / 比分控制

新增：

- `js/modules/scoreboard/scoreboard-config.js`
- `js/modules/scoreboard/scoreboard-admin.js`

可選：

- 若首頁比分 preview 邏輯與首頁 dashboard 不宜混在一起，再新增 `js/modules/scoreboard/scoreboard-home.js`。
- 若只是預留 UI，優先放在 `home-dashboard.js`，避免首頁多載一個模組。

新增或修改 HTML：

- 優先在 `pages/admin-system.html` 內新增 `#page-admin-scoreboard`。
- 或新增 `pages/admin-scoreboard.html`，但必須同步 `PageLoader._pageFileMap`。

設定資料模型：

```js
const SCOREBOARD_SOURCE_KEYS = [
  'premier_league',
  'laliga',
  'serie_a',
  'bundesliga',
  'ligue_1',
  'champions_league',
  'europa_league',
  'world_cup',
  'nba',
  'badminton',
  'olympics'
];

scoreboardConfig = {
  schemaVersion: 1,
  homepageEnabled: true,
  homepageOrder: ['premier_league', 'laliga', 'serie_a'],
  sources: {
    premier_league: {
      enabled: true,
      label: '英超',
      sport: 'football',
      sourceKey: 'football_epl',
      sortOrder: 1
    }
  }
};
```

本階段的 `enabled` 是設定預留，不代表已串 API。

安全限制：

- `SCOREBOARD_SOURCE_KEYS` 必須是固定白名單，不接受任意動態來源 ID。
- `homepageOrder` 與 `sources` 的 key 都只能使用上述固定白名單。
- `sources.*.sourceKey` 是公開來源代號，不是 API key；必須等於前端 catalog 固定值，不得讓後台任意輸入，也不得保存任何真實 API key、token、secret 或 header。
- 未來新增更多比分來源、運動種類或賽事 key 時，必須同步更新前端常數、Firestore rules helper、unit tests、rules tests 與權限說明，不可只透過後台資料新增任意 key。
- `sources` 每個可存在的固定 key 都要在 rules 內逐一驗證欄位型別與允許欄位；不得設計成「任意 key 都通過」。

設定讀寫策略：

- `scoreboardConfig` 儲存在 `siteConfig/scoreboardConfig`。
- 讀取必須走 single-doc 路徑：`FirebaseService.ensureSingleDocLoaded('siteConfig', 'scoreboardConfig')`。
- 快取讀取使用 `FirebaseService.getCachedDoc('siteConfig', 'scoreboardConfig')`。
- 儲存可由 `scoreboard-config.js` 包一層 `getScoreboardConfig()` / `saveScoreboardConfig()`，底層 direct doc get/set。
- 不得把 `siteConfig` 放進 `_deferredCollections` 或 `_collectionPageMap` 當一般 collection 載入。
- `PAGE_DATA_CONTRACT['page-admin-scoreboard']` 只能表達 route 可 stale/可載入，不得把 `siteConfig` 放入 required/optional。
- 若 `renderScoreboardAdmin()` 是 async，必須套用頁面 race guard，避免切頁後把設定畫面寫回錯頁。
- 首頁首屏不等待 `scoreboardConfig`；首屏使用 `boot-scoreboard-summary-data` 或靜態預留。
- Firebase 可用後，首頁可讀公開的 `siteConfig/scoreboardConfig` 套用顯示/排序設定，但仍不得呼叫第三方 API。
- `scoreboardConfig` 不得含 API key、token、secret、付費 API endpoint 憑證或任何私人資料。
- 因為 `scoreboardConfig` 會公開讀，安全邊界必須放在 Firestore rules；不得只靠前端保存邏輯阻擋敏感欄位。

公開設定欄位白名單：

```js
const SCOREBOARD_SOURCE_KEYS = [
  'premier_league',
  'laliga',
  'serie_a',
  'bundesliga',
  'ligue_1',
  'champions_league',
  'europa_league',
  'world_cup',
  'nba',
  'badminton',
  'olympics'
];

scoreboardConfig = {
  schemaVersion: 1,                    // fixed
  homepageEnabled: true,               // boolean
  homepageOrder: ['premier_league'],   // only SCOREBOARD_SOURCE_KEYS
  sources: {
    premier_league: {
      label: '英超',                   // string, 1-24 chars
      enabled: true,
      sport: 'football',               // fixed by catalog
      sourceKey: 'football_epl',       // public source id, not a credential
      sortOrder: 1                     // int, 1-999
    }
  },
  updatedAt: serverTimestamp
};
```

公開設定文件不得保存操作人 UID、LINE user id、email、displayName 或任何可識別管理員身分的欄位。若需要追蹤誰修改過比分設定，不能寫入目前登入者可讀的 `operationLogs`；必須另走 `auditLogsByDay` 這類 client write denied 的私有稽核流程，或新增 Cloud Function / Admin SDK 寫入的 private scoreboard audit collection。該稽核資料僅限有管理權限者讀取，不得放在首頁會公開讀取的 `siteConfig/scoreboardConfig` 內。

本階段若沒有新增後端稽核寫入能力，則不新增「誰修改過比分設定」的操作者追蹤；避免為了追蹤而把操作者資料放進公開設定或 auth-wide readable logs。

明確禁止：

- `apiKey`
- `token`
- `secret`
- `authorization`
- `headers`
- `credential`
- `clientSecret`
- `privateKey`
- 任何付費 API endpoint 憑證、簽章或可識別私密帳號的設定

Rules 實作要求：

- 新增 `isSafeScoreboardConfig()` 或同等 helper。
- 新增 `scoreboardSourceKeys()`，使用固定白名單，不接受任意動態 key。
- `siteConfig/scoreboardConfig` 的 `allow create/update` 必須同時滿足：
  - `isAdmin()` 或 `hasPerm('admin.scoreboard.configure')`
  - request payload 只包含白名單欄位
  - `homepageOrder` 只能包含 `scoreboardSourceKeys()` 內的 key，且限制長度上限
  - 巢狀 `sources` 只能包含固定來源 key，且每個固定 key 都要逐一驗證公開展示/排序/啟閉欄位
  - `sources.*.label` 必須是短字串，限制 1-24 字元；`sources.*.sport` / `sourceKey` 必須等於該來源的 catalog 固定值；前端輸出時仍必須 `escapeHTML`
- 白名單不得包含 `updatedBy`、`operatorUid`、`uid`、`email`、`lineUserId`、`displayName` 等可識別操作者身分欄位。
- 任何含 secret-like 欄位的寫入，即使由 admin 或有 `admin.scoreboard.configure` 的角色發出，也必須被 rules 拒絕。
- `match /siteConfig/{docId}` 必須先分流：`docId == 'scoreboardConfig'` 只走 scoreboard 專用 read/write helper；`docId != 'scoreboardConfig'` 才能走既有 admin / auto_exp / notif 分支，避免 admin 萬用寫入繞過 scoreboard 白名單。

### 權限與導覽

必須同步：

- `js/config.js`
  - `PAGE_STRATEGY['page-admin-scoreboard']`
  - `PAGE_DATA_CONTRACT['page-admin-scoreboard']`，但 required/optional 不列 `siteConfig`
  - `DRAWER_MENUS`
  - `ADMIN_PAGE_EXTRA_PERMISSION_ITEMS`
  - `getDefaultRolePermissions()`
- `js/modules/user-admin/user-admin-perm-info.js`
  - 新增 `admin.scoreboard.entry`
  - 新增 `admin.scoreboard.configure`
- `js/core/page-loader.js`
  - `page-admin-scoreboard` 對應頁面片段。
- `js/core/script-loader.js`
  - 新增 scoreboard admin script group。
  - `page-admin-scoreboard` 對應 group。
- `js/core/navigation.js`
  - `_renderPageContent()` 補 `renderScoreboardAdmin()`。

權限碼建議：

- `admin.scoreboard.entry`：可進入比分控制頁。
- `admin.scoreboard.configure`：可修改比分來源、排序、首頁顯示設定。

預設權限策略：

- `admin` 與 `super_admin` 預設同時具備 `admin.scoreboard.entry` 與 `admin.scoreboard.configure`，避免「看得到控制頁但不能儲存」。
- `coach` / `captain` / `venue_owner` 預設不具備比分控制權；若未來需要委派，必須在權限管理內同時開啟 `admin.scoreboard.entry` 與 `admin.scoreboard.configure`。
- 前端保存按鈕的判斷必須與 Rules 一致：`isAdminRole` 或 `hasPermission('admin.scoreboard.configure')` 才能保存。
- `getDefaultRolePermissions()`、權限管理說明、permission fixtures、unit tests 必須同步更新，避免 UI、測試與 rules 權限口徑不同步。
- 既有正式站若已存在 `rolePermissions/admin` 文件，`ApiService.getRolePermissions()` 會優先使用 stored permissions，不會自動吃到新的 `getDefaultRolePermissions()`；因此實作必須加入 migration / backfill：
  - 若 `rolePermissions/admin` 已存在，必須合併補入 `admin.scoreboard.entry` 與 `admin.scoreboard.configure`。
  - 若 `rolePermissionMeta.admin.defaultPermissions` 已存在，也必須合併補入同兩個權限碼。
  - `super_admin` 仍由「全部權限」與 locked role 邏輯保護，但 fixtures/tests 仍要反映新權限碼存在。
  - migration 必須保留使用者已手動開啟的其他權限，不可覆蓋整份權限文件。
  - 必須同步升版 `ROLE_PERMISSION_CATALOG_VERSION`，否則 `_seedRoleData()` 會因既有 catalogVersion 相同而跳過 migration。
  - `ROLE_PERMISSION_CATALOG_VERSION` 升版後，`rolePermissionMeta.admin.defaultPermissions` 必須更新成新的 defaults，避免下一次新增權限時重複判斷錯誤。
  - tests 必須覆蓋「catalogVersion 不同時會合併新增權限」與「catalogVersion 相同時不誤寫」。

Firestore rules 若要允許非 admin 但有權限碼的角色設定比分，需補 helper：

- `canManageScoreboardConfig()`
- 限定 `siteConfig/scoreboardConfig`。
- `allow read` 對 `siteConfig/scoreboardConfig` 可公開讀，因為首頁需要套用顯示/排序設定；其他 `siteConfig` 仍維持既有 auth read。
- `allow create/update` 允許 `isAdmin()` 或 `hasPerm('admin.scoreboard.configure')`。
- Rules 必須強制禁止把 API key/token/secret 類欄位寫進 `scoreboardConfig`；前端保存邏輯只能作為 UX 提醒，不可作為唯一安全邊界。
- `scoreboardConfig` 必須從既有 `siteConfig` admin 萬用 create/update 分支排除，避免 admin 寫入任意欄位時繞過 `isSafeScoreboardConfig()`。
- 若要記錄操作者，只能透過 Cloud Function / Admin SDK 寫私有稽核集合；不得使用目前登入者可讀的 `operationLogs`。

### FirebaseService / boot render

必須同步：

- 首頁 summary 讀取邏輯，來源為 `boot-home-summary-data`，不是 Firestore collection cache。
- 首頁 summary 若有 `generatedAt`，資訊儀表要顯示簡短更新時間；若 summary 不存在或不完整，顯示安全 fallback，不顯示誤導性的 0。
- `_singleDocCache` 讀取 `siteConfig/scoreboardConfig` 的 helper 或 facade。
- `ensureSingleDocLoaded('siteConfig', 'scoreboardConfig')` 的呼叫位置。
- `_notifyCacheUpdated()`
- `_handleWarmLoadedCollections()`
- `_debouncedSnapshotRender()`
- `_refreshEventsOnResume()`

明確禁止：

- 不得把 `siteConfig` 加到 `_deferredCollections`。
- 不得把 `siteConfig` 加到 `_collectionPageMap['page-admin-scoreboard']`。
- 不得用 `_cache.scoreboardConfig` 這種 collection cache 假裝 single doc。
- 不得用 `ApiService.getActiveTeams().length`、`ApiService.getTournaments().length` 或部分 events cache 直接覆蓋首頁儀表總量。

首頁資料更新後應呼叫：

- `renderHomeSportQuickEntry()`
- `renderHomeInfoMeter()`
- `renderHomeScoreboardPreview()`
- `renderHomeGameShortcut()`

不得再讓首頁必要刷新只呼叫 `renderHotEvents()`。

### GitHub inline 任務

建議改名：

- `.github/workflows/inject-hot-events.yml` -> `.github/workflows/inject-home-boot-data.yml`
- `scripts/inject-hot-events.js` -> `scripts/inject-home-boot-data.js`

必須做到：

- 不再寫 `boot-events-data`。
- 不再寫 `boot-tournaments-data`。
- 明確移除舊 block。
- 保留 `boot-banners-data`。
- 必須產生 `boot-home-summary-data`，只能包含匿名公開摘要。
- 若產生 `boot-scoreboard-summary-data`，只能包含已整理摘要或預留資料。
- workflow commit message 改成首頁 boot data，不再寫熱門活動。
- events / teams / tournaments 必須完整分頁取得，不得只抓第一頁。
- `boot-home-summary-data` 不得包含活動卡完整欄位，不得包含 title/image/location/creatorUid 等個資或可識別活動細節。
- 成功寫入的 summary 必須帶 `complete: true` 與 `generatedAt`；若任一集合抓取失敗，script 應停止更新 summary 或標成不完整，前端不可把不完整 summary 當總量。
- 前端不得假設 `boot-home-summary-data` 必定存在；首次部署、workflow 失敗或舊 index 尚未更新時，必須顯示安全 fallback 與「暫無統計」類文案。
- injection script 測試必須覆蓋「多頁資料」與「舊 block 被刪除」。

## 六、分階段實作與每階段自我驗收

### Phase 0：實作前再審計與保護線

工作：

- 再讀一次 `CLAUDE.md`。
- 再確認 worktree 狀態，避免覆蓋使用者改動。
- 檢查 `pages/home.html`、`app.js`、`firebase-service.js`、`theme.js`、`script-loader.js`、`page-loader.js`、`config.js`、`firestore.rules`、GitHub workflow 與 injection script。
- 確認 `demo.html` 僅作示意，不進 production pipeline。

自我驗收：

- [ ] 已確認沒有需要使用者立即決策的中型以上設計問題。
- [ ] 已確認 production 實作不會依賴 demo 內的臨時主題切換。
- [ ] 已確認本階段不新增俱樂部/賽事 viewCount。
- [ ] 已確認首頁儀表不會使用 partial cache 當總量。
- [ ] 已確認 `siteConfig/scoreboardConfig` 走 single-doc 讀寫，不走 collection page map。
- [ ] 已確認 `admin.scoreboard.entry` / `admin.scoreboard.configure` 的預設權限、權限管理、fixtures 與 tests 會同步。
- [ ] 已確認既有 `rolePermissions/admin` 與 `rolePermissionMeta.admin.defaultPermissions` 需要 migration / backfill，不會只改 code 預設值。
- [ ] 已確認 `operationLogs` 不適合存 scoreboard 操作者資料；若要追蹤操作者，必須另走私有稽核。
- [ ] 已確認既有 permission fixture 漂移會在實作階段先修正，不讓過時測試阻塞最後驗收。

### Phase 1：首頁 HTML 結構

工作：

- 更新 `pages/home.html`。
- 保留 banner 與公告 DOM。
- 移除或停用舊 region tab、熱門活動、最新賽事 DOM。
- 新增 sport quick entry、info meter、scoreboard preview、我要開活動。
- 保留 game/news/sponsor/floating ads 既有 DOM。

自我驗收：

- [ ] banner DOM 與 id 未被改壞。
- [ ] announcement DOM 與 id 未被改壞。
- [ ] `#hot-events`、`#hot-events-loading`、`#ongoing-tournaments` 不再是首頁必要 DOM。
- [ ] `#home-scoreboard-preview` 位於資訊儀表下方、小遊戲上方。
- [ ] 小遊戲與新聞仍可由既有開關隱藏。
- [ ] 390px、768px、1280px 版面不出現重疊或文字溢出。

### Phase 2：首頁 dashboard 模組

工作：

- 新增 `home-dashboard.js`。
- 實作分類入口、儀表統計、活動瀏覽總數、比分預留 preview。
- 實作 `boot-home-summary-data` 解析、驗證與安全 fallback。
- 俱樂部/賽事瀏覽數顯示為預留。
- 新增 `setActiveSportFilter()`，讓 top bar 與首頁入口共用。
- 「我要開活動」導向既有建立活動流程。

自我驗收：

- [ ] 活動數使用完整 `homeSummary.counts.activities`。
- [ ] 活動數摘要使用有效狀態 helper，排除過期的 `open/full/upcoming`、`ended/cancelled/private/team-only`。
- [ ] 活動瀏覽數使用同一批公開首頁口徑活動摘要。
- [ ] 活動瀏覽數文案為「已記錄瀏覽」或「活動詳情瀏覽」，不誤導為所有訪客瀏覽。
- [ ] 若 `homeSummary.generatedAt` 存在，儀表顯示簡短更新時間。
- [ ] 俱樂部數使用完整 `homeSummary.counts.teams`，不直接使用 `ApiService.getActiveTeams().length`。
- [ ] 賽事數使用完整 `homeSummary.counts.tournaments`，不直接使用部分 tournaments cache。
- [ ] 摘要不存在或不完整時不顯示誤導性的 0。
- [ ] 俱樂部/賽事瀏覽數沒有顯示假數字。
- [ ] 運動分類排序符合 count desc + config order。
- [ ] 運動分類排序使用 `homeSummary.sportCounts`，不使用部分 event cache 排序。
- [ ] 點運動分類會同步 top bar sport picker 狀態並導向活動頁。
- [ ] 首頁比分區不呼叫第三方 API。

### Phase 3：首頁 render pipeline 替換

工作：

- 修改 `app.js`。
- `renderHomeCritical()` 改呼叫：
  - `renderBannerCarousel({ autoplay: false })`
  - `renderAnnouncement()`
  - `renderHomeDashboard()`
  - `renderHomeScoreboardPreview()`
  - `_markPageSnapshotReady('page-home')`
- `renderHomeDeferred()` 改呼叫：
  - `renderHomeGameShortcut()`
  - `renderSponsors()`
  - `renderNews()`
  - `renderFloatingAds()`
  - `showPopupAdsOnLoad()`
  - `startBannerCarousel()`
- `renderHotEvents()` 不再承擔首頁小遊戲入口渲染。
- content ready 不再依賴 `#hot-events` 卡片。
- boot overlay 判斷不再只看 `FirebaseService._cache.events.length > 0`。

自我驗收：

- [ ] 首頁初始 render 不呼叫 `renderHotEvents()`。
- [ ] 首頁初始 render 不呼叫 `renderOngoingTournaments()`。
- [ ] 移除 `#hot-events` 後不會影響 boot overlay dismissal。
- [ ] Firebase cache ready 後首頁區塊會重繪，但總量仍以完整 summary 為準。
- [ ] visibility resume 後首頁區塊會重繪，但不以 partial cache 覆蓋總量。
- [ ] 深連結啟動時仍不渲染首頁，避免首頁閃爍。

### Phase 4：比分控制頁與權限落點

工作：

- 新增 scoreboard admin UI。
- 新增 drawer entry。
- 新增權限碼與說明 popup。
- 新增 page loader / script loader / navigation render hook。
- 新增設定保存邏輯，限定 `siteConfig/scoreboardConfig` single-doc get/set。
- 若寫入 Firestore，補 rules 與 rules tests。

自我驗收：

- [ ] 有 `admin.scoreboard.entry` 才看得到抽屜入口。
- [ ] `page-admin-scoreboard` 可正確載入 HTML。
- [ ] `renderScoreboardAdmin()` 可正確執行。
- [ ] `renderScoreboardAdmin()` 讀取設定時呼叫 `ensureSingleDocLoaded('siteConfig', 'scoreboardConfig')`。
- [ ] `PAGE_DATA_CONTRACT['page-admin-scoreboard']` 沒有把 `siteConfig` 放入 required/optional。
- [ ] `_deferredCollections` 與 `_collectionPageMap` 沒有加入 `siteConfig`。
- [ ] API source 開關與排序只是設定，不會打第三方 API。
- [ ] `scoreboardConfig` 公開讀內容不含任何 secret。
- [ ] `scoreboardConfig` 寫入規則使用欄位白名單，不依賴前端保存邏輯作為唯一防線。
- [ ] `homepageOrder` / `sources` 只能使用固定白名單 key，任意新 key 會被 rules tests 拒絕。
- [ ] `sources.*.label` 有長度上限，前端顯示時一律 escape，不直接插入未清洗文字。
- [ ] `siteConfig/scoreboardConfig` 已從既有 admin 萬用 siteConfig 寫入分支排除。
- [ ] admin 預設同時具備進入與設定權限，不會出現看得到但不能儲存。
- [ ] 既有 `rolePermissions/admin` 若已存在，migration 後也具備進入與設定權限。
- [ ] `ROLE_PERMISSION_CATALOG_VERSION` 已升版，且 migration tests 證明 stored admin 權限會被合併補上。
- [ ] admin 或有 `admin.scoreboard.configure` 的角色嘗試寫入 secret-like 欄位時，rules tests 會失敗拒絕。
- [ ] 若非 admin 但有權限碼可設定，Firestore rules 已同步允許。
- [ ] 權限管理能看到相關權限碼與說明按鈕。

### Phase 5：CSS 與速度優先調整

工作：

- 更新 `css/home.css`。
- 首頁新區塊以小 DOM、少圖片、少 blocking resource 為原則。
- SVG 使用 inline SVG，不新增 icon font 依賴。
- scoreboard 預留區不載大型圖片。

自我驗收：

- [ ] CSS 不形成單一色系過度偏色。
- [ ] 手機與桌面文字不重疊。
- [ ] 橫向分類入口不造成 layout shift。
- [ ] 儀表卡點擊區清楚。
- [ ] 首頁 critical render 不新增第三方網路請求。

### Phase 6：GitHub inline 任務改造

工作：

- 改造或改名 injection workflow/script。
- 移除舊 `boot-events-data` 與 `boot-tournaments-data`。
- 新增完整分頁產生 `boot-home-summary-data`。
- 改造 `app.js` boot loader。
- 確認 index.html 不再殘留舊完整活動/賽事 payload。

自我驗收：

- [ ] workflow 不再寫 `boot-events-data`。
- [ ] workflow 不再寫 `boot-tournaments-data`。
- [ ] script 會明確刪除舊 block。
- [ ] `index.html` 沒有舊活動/賽事 inline payload。
- [ ] 成功產出的 `boot-home-summary-data` 必須存在且 `complete: true`。
- [ ] 前端可安全處理 `boot-home-summary-data` 不存在或 `complete !== true`，不顯示假 0。
- [ ] summary 由完整分頁 events / teams / tournaments 產生，不受前端首批限制。
- [ ] summary 使用同一個有效活動 helper 產生活動數、運動分類與活動瀏覽數。
- [ ] summary 只含匿名公開摘要，不含完整活動卡資料或 creatorUid。
- [ ] `boot-scoreboard-summary-data` 若存在，只含整理後摘要或預留資料。
- [ ] 若本階段不產生 `boot-scoreboard-summary-data`，首頁使用靜態預留來源，並由 `siteConfig/scoreboardConfig` best-effort 覆蓋排序。
- [ ] workflow commit message 不再稱為 hot events。

### Phase 7：版本、文件、測試

工作：

- 依專案規則執行 `node scripts/bump-version.js`。
- 更新：
  - `docs/architecture.md`
  - `docs/structure-guide.md`
  - `CLAUDE.md`
  - `docs/tunables.md`
  - `docs/claude-memory.md`
- 新增或更新 unit tests。
- 必要時補 rules tests。
- 先同步修正既有 permission fixture 漂移：
  - `tests/unit/permissions-fixtures.js`
  - `tests/unit/cloud-functions.test.js`
  - `tests/unit/permissions-phase2-logic.test.js`
  - 確認 `team.manage.entry`、`admin.seo.entry` 與正式 `js/config.js` / `functions/index.js` 一致。

自我驗收：

- [ ] 新增 JS 模組單檔不超過 300 行；若超過需拆分。
- [ ] `CACHE_VERSION`、`index.html ?v=`、`index.html var V`、`sw.js CACHE_NAME` 一致。
- [ ] `docs/architecture.md` 已記錄首頁新架構。
- [ ] `docs/structure-guide.md` 已記錄首頁與比分控制位置。
- [ ] `CLAUDE.md` 目錄結構概覽已同步新增模組/資料夾變更。
- [ ] `docs/tunables.md` 已記錄 boot/render/inline/TTL/limit 變更。
- [ ] `docs/claude-memory.md` 已新增本次功能紀錄。
- [ ] `git diff --check` 通過。
- [ ] `npm test` 通過。
- [ ] 若 rules 有改，`npm run test:rules` 通過。

### Phase 8：最終自我驗收、提交與部署

工作：

- 全面檢查 diff。
- 檢查首頁、活動頁、賽事頁、俱樂部頁、抽屜、權限管理。
- 檢查 GitHub workflow 不會把舊首頁資料寫回。
- 若測試通過且無中型以上瑕疵，再 commit。
- 使用者已明確要求直接部署時，可依 CLAUDE SOP 例外直接 push；否則 commit 後停下請使用者 review。

自我驗收：

- [ ] 首頁新順序符合需求。
- [ ] 活動數、俱樂部數、賽事數都可點擊導向正確頁面。
- [ ] 儀表總量來自完整 summary，不是部分 cache。
- [ ] 活動瀏覽數排除已結束/已取消活動。
- [ ] 活動瀏覽數排除私密與 team-only 活動，符合公開首頁口徑。
- [ ] 俱樂部/賽事瀏覽顯示為預留，不誤導。
- [ ] 「我要開活動」位置明顯且不佔版面。
- [ ] 小遊戲關閉時隱藏。
- [ ] 新聞關閉時隱藏。
- [ ] Scoreboard 首頁區不打第三方 API。
- [ ] Scoreboard 控制頁只保存設定，不假裝已串 API。
- [ ] Scoreboard 公開設定不含 API key/token/secret。
- [ ] 一般使用者/coach/captain/venue_owner/admin 的主要入口沒有權限回歸。
- [ ] 私密活動可見性沒有被首頁統計放大。
- [ ] 部署後確認首頁載入與 service worker 版本更新。

## 七、自動化測試覆蓋計劃

### Unit tests

新增或更新：

- `tests/unit/home-dashboard.test.js`
  - 運動分類排序。
  - 0 活動按 config order。
  - 只接受 `complete: true` 的 `boot-home-summary-data` 作為儀表總量。
  - 摘要不存在或不完整時不顯示誤導性的 0。
  - 活動數摘要排除有效狀態已結束、cancelled、private、team-only。
  - `status: 'open'` / `status: 'full'` 但活動開始時間已過，不列入活動數、sportCounts、activityViews。
  - 活動開始時間尚未到的未來活動列入活動數、sportCounts、activityViews。
  - 活動瀏覽數摘要排除有效狀態已結束、cancelled、private、team-only。
  - 活動瀏覽數顯示文案不使用「所有瀏覽數」。
  - 俱樂部/賽事瀏覽狀態為預留。
  - runtime partial cache 不覆蓋完整 summary。
  - 運動分類排序使用 summary sportCounts。
- `tests/unit/navigation.test.js`
  - `page-admin-scoreboard` route render hook。
- `tests/unit/config-utils.test.js` 或 permission fixtures
  - `admin.scoreboard.entry` 與 `admin.scoreboard.configure` 存在。
  - drawer 權限與預設權限一致。
  - `admin` / `super_admin` 預設具備 `admin.scoreboard.configure`。
  - permission fixtures 與正式 `INHERENT_ROLE_PERMISSIONS` 同步。
  - 既有 stored `rolePermissions/admin` 合併 migration 後包含 scoreboard entry/configure。
  - `ROLE_PERMISSION_CATALOG_VERSION` 升版後才會觸發 stored admin migration。
- `tests/unit/script-deps.test.js`
  - 新 initial script 載入順序正確。
- `tests/unit/inject-home-boot-data.test.js`
  - 會移除舊 `boot-events-data` / `boot-tournaments-data`。
  - 不 inline 完整活動卡資料。
  - events / teams / tournaments 多頁資料會完整累計。
  - 任一集合抓取失敗時不產出 `complete: true` 的錯誤 summary。
  - summary 不包含 title/image/location/creatorUid。
- `tests/unit/scoreboard-config.test.js`
  - scoreboard config 讀取使用 single-doc helper。
  - `PAGE_DATA_CONTRACT['page-admin-scoreboard']` 不列 `siteConfig`。
  - `_deferredCollections` / `_collectionPageMap` 不加入 `siteConfig`。

### Rules tests

若新增或修改 Firestore rules：

- `siteConfig/scoreboardConfig` read/write 規則。
- `siteConfig/scoreboardConfig` 可公開讀，但 secret 欄位不可寫入。
- `siteConfig/scoreboardConfig` create/update 僅允許白名單欄位。
- `homepageOrder` / `sources` 僅允許固定白名單 key。
- 任意新增 `sources.fakeProvider`、`homepageOrder: ['fakeProvider']` 必須失敗。
- `sources.*.label` 非字串、空字串或超過長度上限必須失敗。
- admin 直接寫 `siteConfig/scoreboardConfig` 的非白名單欄位必須失敗，證明沒有走既有 siteConfig admin 萬用分支。
- admin 嘗試寫入 `apiKey` / `token` / `secret` / `headers` / `authorization` / `credential` 等欄位時必須失敗。
- 有 `admin.scoreboard.configure` 的非 admin 角色嘗試寫入 secret-like 欄位時也必須失敗。
- admin 可設定。
- 有 `admin.scoreboard.configure` 的角色可設定。
- 無權限者不可設定。

### Smoke / E2E

必要時跑：

- 首頁渲染 smoke。
- 點活動數到活動頁。
- 點俱樂部數到俱樂部頁。
- 點賽事數到賽事頁。
- 點運動分類到活動頁且 sport filter 生效。
- 後台比分控制頁能載入。

## 八、部署策略

本專案 push 等於部署。

正式實作完成後順序：

1. 自我審計 diff。
2. 跑必要測試。
3. bump version。
4. 更新文件。
5. commit。
6. 若使用者明確要求直接部署，push main。
7. 若使用者未明確要求直接部署，依 CLAUDE SOP 停下建議 `/codex:review`。

## 九、目前是否可開始實作

在本修正版計劃下，已移除先前中型以上設計瑕疵：

- 俱樂部/賽事瀏覽數不再假裝已有正式資料。
- `boot-home-summary-data` 改為完整公開首頁摘要，不再用前端部分 cache 假裝總量。
- 登入者私密/owner 相依活動總量本階段不做個人化統計，避免外洩或誤算。
- Scoreboard 本階段不串第三方 API，避免 scope 不清與 API key 風險。
- `siteConfig/scoreboardConfig` 明確走 single-doc cache/direct doc 讀寫，不走 collection page map。
- GitHub inline 任務明確要求刪除舊 payload block。
- GitHub inline 任務明確要求完整分頁產生 summary，不受前端首批限制。
- 後台 scoreboard 頁面補齊 page loader / script loader / navigation / permissions / rules 落點。
- 文件同步補齊 `docs/tunables.md` 與 `docs/claude-memory.md`。

結論：可進入分階段實作，但每階段必須先完成自我驗收；若實作中發現新的中型以上瑕疵，必須停下回報。
