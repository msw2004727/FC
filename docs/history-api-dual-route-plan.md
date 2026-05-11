# History API 雙軌漸進式升級計劃書(V5 定稿候選版)

> Last Reviewed: 2026-05-10
> 狀態: 計劃書,尚未實作。V5 在 V4 基礎上修正中型審計缺口:拆分純重構與行為改變、補上 `_replaceRouteHash`、補齊 clean URL boot overlay guard、統一 Worker path-first 規則、修正 404 hash 保存、補齊 `_headers` 與 SW/SEO 執行時機(v1 → v5)
> 原則: 舊路由完整保留,新路由只做入口轉譯,不重寫既有頁面邏輯

---

## 0. 修訂摘要(v1 → v5)

v1 上線前審計發現 6 個 P1 重大瑕疵與 9 個 P2 中度瑕疵。V2 補齊大方向後,再次審計發現 3 個會影響實作判斷的問題:Cloudflare fallback 不能依賴 `404.html`、活動 ID regex 過窄、第一輪 QA 混入 Phase 5.5 SEO 項目。V3 已修正這三點。表中所有「證據」皆為實際讀過的程式碼位置(`file:line`),不是推論。

### 0.1 結構性變更

| 變更 | v1 | V3 | 證據 / 理由 |
|---|---|---|---|
| Phase 2 / 3 順序 | 先 boot 接入,後 fallback | **對調**:先 Worker SPA fallback,後 boot 接入 | `firebase.json` 無 hosting 段、`_headers` 無 SPA rule、`_redirects` / `wrangler.toml` / `_routes.json` / `netlify.toml` / `vercel.json` 皆不存在;`_worker.js:80-83` 對非 OG path 直走 `env.ASSETS.fetch`。Phase 2 自我驗收若搶先做,根本驗不過。 |
| 新增 Phase 0.5 前置重構 | 無 | 3 個前置重構必須先完成 | (1) hash sink、(2) LineAuth、(3) 404.html。詳見 §8.2 |
| Phase 0 性質 | 「閱讀」 | **「決策」**:產出整合策略文件 | `app.js:2456-2479` boot deep link 流程已是 5 層機制,Phase 2 「再加一段 parse」前必須先決定整合形式 |
| 新增 Phase 5.5 SEO 對齊 | 無 | 詳情頁 URL writer 啟用時才同步處理 canonical / sitemap | `index.html:9-11, 18` canonical / hreflang / og:url 全寫死指向 `/`,`sitemap.xml` 完全無 SPA 內部 URL。V3 明確切出第一輪不驗 SEO。 |
| ID 驗證策略 | 未定 | **只做 route-safe segment 驗證** | `generateId(prefix)` 不是唯一格式;活動建立程式另有 4 碼 suffix、multidate 會加 `_1`。V3 不用過窄 regex 阻擋舊資料。 |

### 0.2 V3 修正重點

| 修正點 | V2 問題 | V3 定案 |
|---|---|---|
| Cloudflare fallback | V2 的 `_routes.json` 只 include OG path,再假設 Cloudflare 會 fallback 到 `404.html`。這會造成 clean URL 可能仍是 404 或非 200。 | Cloudflare 以 `_worker.js` SPA fallback 為主方案,對 clean URL 回 `index.html` 且 HTTP 200。`404.html` bootstrap 僅作 GitHub Pages 備援。 |
| `_routes.json` | V2 只列 `/event-share/*`、`/team-share/*`,會讓 SPA path 不一定進 Worker。 | 若使用 `_routes.json`,必須 include OG path 與 SPA clean URL path,並 exclude 靜態資源。 |
| ID regex | V2 寫死 `ce_\d{13}_[a-z0-9]{6}` 或 20 碼 docId。 | clean URL adapter 只驗證 URL segment 安全、長度與不可含 path traversal;存在性交給既有 detail lookup 判斷。 |
| 第一輪 QA | V2 把 canonical / og:url / GSC / seo-log 放進第一輪驗收。 | 第一輪只驗 Phase 0 → 3。SEO 驗收移到 Phase 5.5。 |
| 列表頁 clean path | V2 建議 list route 轉回 `location.hash`,可能出現 `/activities#page-activities`。 | V3 要求 history path 入口可保留 `/activities`,透過 `suppressHashSync` 或等價 one-shot guard 避免立即寫回 hash。 |

### 0.3 V4 修正重點

| 修正點 | V3 問題 | V4 定案 |
|---|---|---|
| 混合 URL(P2) | V3 §8.5 step 4 只在 boot 進入時 `suppressHashSync`,使用者後續點底部 nav 從 `/activities` 切到俱樂部,`location.hash = 'page-teams'` 寫入時不清 path,變成 `/activities#page-teams`。 | V4 曾定案由 `_setRouteUrl` 寫 hash 時清 path;V5 將此拆成 0.5a 純重構與 0.5b flag 防護。詳 §0.4 與 §7.2。 |
| `_syncTournamentDetailRoute` 接管(P2) | V3 §8.7 step 5 只寫「從寫 query+hash 改為 path」,沒指明既有 `_syncTournamentDetailRoute`、`_clearTournamentDetailRouteParam`(`navigation.js:154`、`app.js:1051-1059`)的改寫策略。 | Phase 5 必須把這兩個 helper 內部改為呼叫 `_setRouteUrl`,離開頁時若 `writeDetailPaths=true` 用 `history.replaceState` 把 path 改回 `/`(或上一頁 path),不再操作 `searchParams`。詳 §8.7 step 5。 |
| Worker fallback Accept(P3) | V3 §8.4.1 把 `Accept: text/html` 當硬條件,curl 與部分非瀏覽器 OG bot 會掉到 Cloudflare 預設 404。 | path-first 判斷:命中 `SPA_PATHS` 即回 `index.html` 200;`Accept: text/html` 只當 hint 不當阻擋條件。詳 §8.4.1。 |
| 404.html redirect 範圍(P3) | V3 §8.2.3 範例 redirect script 沒排除 `/event-share/*`、`/team-share/*`。GitHub Pages 上分享 OG 連結會跑錯 redirect。 | redirect 前 early-return:若 path 第一段是 `event-share` 或 `team-share`,不 redirect、保留死路頁。詳 §8.2.3。 |
| 部署順序(P3) | V3 §13 第一輪交付沒明說 `_worker.js` SPA handler 與 `_routes.json` SPA include 必須同一次 deploy。 | 補一段「兩者必須同 commit / 同 PR / 同 deploy」說明。詳 §8.4.5(新增 §8.4.6 部署順序)。 |
| 決策數(P3) | V3 §8.1.3 自我驗收仍寫「6 個決策皆有明確答案」,但 `decisions.md` 已含 D7 / D8 共 8 題。 | 改為「§8.1.2 列出的所有決策皆有明確答案,並與 `decisions.md` 一致」。 |

### 0.4 V5 審計修正重點

| 修正點 | V4 中型瑕疵 | V5 定案 |
|---|---|---|
| Phase 0.5 行為邊界 | V4 同時要求「純轉接、行為完全一致」與「hash 模式清 path」,兩者互相矛盾。 | 拆成 **0.5a 純 URL sink 重構** 與 **0.5b clean path 降級防護**。0.5a 只替換呼叫點,不改 URL 行為;0.5b 需獨立 flag、獨立 QA、獨立回滾。 |
| `_replaceRouteHash` 遺漏 | `app.js:2028-2035` 會直接 `history.replaceState` / `location.hash`,V4 只列 `navigation.js` 三處 hash 寫入,仍可能繞過 sink。 | `_replaceRouteHash` 必須納入 Phase 0.5a,改為呼叫 `_setRouteUrl` 或成為 sink 的薄 wrapper。 |
| clean URL boot overlay | 目前 `_dismissBootOverlay` 只看 `_hasPendingDeepLink()` / `_hasPendingHashNav()`,V4 對 `/activities` 這種 list clean URL 沒寫 guard。 | Phase 3 必須新增 `_hasPendingHistoryNav()`、`_dismissBootOverlayAfterHistoryNav()` 與 `_primeBootHistoryRoute()`。list clean URL 需像 hash shell 一樣先 prime,避免 boot overlay 提早關閉後閃首頁。 |
| Worker fallback 規則矛盾 | V4 文字仍寫「Accept 包含 text/html」,但範例寫 path-first。 | 明確定案:只要 `GET/HEAD + SPA_PATHS` 命中就回 `index.html` 200,Accept 僅可用於 debug,不可作為阻擋條件。 |
| 404 redirect hash 保存 | V4 範例把 `l.hash` 接在 `_spa_redirect` 參數外,會變成真正的 URL hash,不是被保存的原始 path。 | 改為 `encodeURIComponent(l.pathname + l.search + l.hash)`,boot 還原時一次還原 path/search/hash,再依 query/hash/history 優先序處理。 |
| `_headers` 與路由表不一致 | V4 route table / Worker 範例含 `/profile`、`/users/*`,但 `_headers` 補規則漏掉。 | 若本輪啟用 `/profile` 或 `/users/*`,`_headers`、Worker `SPA_PATHS`、route adapter、QA 必須同時列入;若不啟用就全部標為第二輪。V5 預設 `/profile` 啟用、`/users/*` 第二輪。 |
| SW navigate cache 不夠精確 | V4 只說不要每條 path 都 cache,但未指定實作 key,容易仍以 `/activities` 作 key。 | navigate fallback 一律 normalize 到 `/` 或 `/index.html` cache key;SPA path 不直接 `cache.put(event.request, clone)`。 |
| SEO meta 呼叫時機矛盾 | `history-route-decisions.md` D8 定案在 `_renderPageContent` 更新 meta,但 V4 §8.8 又寫 `_setRouteUrl` 寫 path 時更新。 | V5 定案:URL sink 只寫 URL 與記錄 route intent;meta 更新在成功 render 後執行,detail 頁在資料載入後用實際 id/name 更新。 |

### 0.5 新增與強化的關鍵風險

| ID | 標題 | 證據 |
|---|---|---|
| **E** | LIFF login 的 redirectUri builder 只搬 query 不搬 path | `js/line-auth.js:434-447` |
| **S** | canonical / hreflang / og:url 全寫死指向首頁 | `index.html:9-11, 18` |
| **B** | navigation.js 3 處 `location.hash =` 強制寫入,且 `_replaceRouteHash` 也直接寫 URL | `js/core/navigation.js:139, 721, 945`;`app.js:2028-2035` |
| **M** | 既有 `_syncTournamentDetailRoute` 已有 query+hash 混合寫入 | `app.js:1051-1059` |
| **F** | `_pageLockUntil` 10 秒鎖會擋 popstate | `js/core/navigation.js:174-182, 519-531` |

---

## 1. 目標

ToosterX 主要使用 hash route 與 query deep link:

- `#page-activities`、`#page-teams`、`#page-tournaments`、`#page-activity-detail`
- `?event=ce_xxx`、`?team=xxx`、`?tournament=xxx`、`?profile=xxx`
- LINE Mini App 分享連結:`https://miniapp.line.me/...?...`

本計劃的目標是**新增** History API clean URL 入口:

- `/activities`、`/teams`、`/tournaments`
- `/events/{eventId}`、`/teams/{teamId}`、`/tournaments/{tournamentId}`

第一階段不移除、不替換、不重寫現有 hash / query 路由。新 URL 只作為「入口轉譯層」,解析後仍呼叫現有函式(`App.showEventDetail(id)`、`App.showTeamDetail(id)`、`App.showTournamentDetail(id)`、`App.showPage('page-activities')` 等)。

---

## 2. 為什麼採用雙軌

雙軌方案把風險切小:

1. 舊路由繼續有效,已分享出去的連結不失效。
2. 新路由不改報名、活動列表、詳細頁資料邏輯。
3. 每一階段都可以獨立驗收與回滾(僅限「寫入端」;「解析 / fallback」一旦上線即永久承諾,見 §10)。
4. 可以先讓 clean URL 作為外層入口,確認穩定後再決定是否擴大使用。

牽涉的系統:

- `app.js` boot 階段 deep link 判斷
- `js/core/navigation.js` 的 `_activatePage` / `showPage` / `goBack`
- `js/core/page-loader.js` 的頁面片段載入與 priority preload
- `ScriptLoader.ensureForPage(...)` 的模組載入
- Service Worker 與 boot overlay timing
- Cloudflare Pages Worker(`_worker.js`)的社群分享 OG 路由
- LINE LIFF SDK / `js/line-auth.js` 的登入 redirectUri 構建
- `index.html` 中靜態的 canonical / hreflang / og:url
- `sitemap.xml` 與 SEO 著陸頁

---

## 3. 不做的事(第一輪邊界)

本計劃第一輪不做以下項目:

- 不移除 `#page-xxx`。
- 不移除 `?event=`、`?team=`、`?tournament=`、`?profile=`。
- 不改 LINE Mini App 分享連結格式(`https://miniapp.line.me/...`)。
- 不重寫活動報名、取消、候補、團隊報名邏輯。
- 不重寫活動列表、俱樂部列表、賽事列表渲染。
- 不重寫 `App.goBack()` 的自訂 page history。
- 不讓 `/event-share/{id}`、`/team-share/{id}` 這類 OG route 被 SPA fallback 吃掉。
- 不改 `MINI_APP_BASE_URL` 常數。
- 不改 LIFF Endpoint URL(LINE Developers Console 設定)。

---

## 4. 現況盤點

### 4.1 舊路由

| 類型 | 範例 | 目前用途 |
|---|---|---|
| Hash page | `#page-activities` | 進入活動行事曆 |
| Hash page | `#page-teams` | 進入俱樂部 |
| Hash page | `#page-tournaments` | 進入賽事中心 |
| Query deep link | `?event=ce_xxx` | 進入活動詳細頁 |
| Query deep link | `?team=xxx` | 進入俱樂部內頁 |
| Query deep link | `?tournament=ct_xxx` | 進入賽事詳細頁 |
| Query deep link | `?profile=uid` | 進入個人資料 |
| Mini App | `https://miniapp.line.me/...?...` | LINE Mini App 開啟入口 |

### 4.2 現況不變式(必須保留)

| 不變式 | 來源 |
|---|---|
| `App.showEventDetail(id, options)` 是活動詳情入口 | `js/core/navigation.js:472-474` |
| `App.showTeamDetail(id, options)` 是俱樂部詳情入口 | `js/core/navigation.js:476-483` |
| `App.showTournamentDetail(id, options)` 是賽事詳情入口 | `js/modules/tournament/tournament-detail.js:8` |
| `App.showPage(pageId, options)` 是 page 切換入口 | `js/core/navigation.js:506` |
| `App.goBack()` 用 `this.pageHistory` array,不靠瀏覽器 history | `js/core/navigation.js:922-953` |
| `_pendingDeepEvent / Team / Tournament / Profile` sessionStorage 是 LINE 登入 round-trip 的 deep link 暫存 | `app.js:2464-2467` |
| `_deepLinkRestFetch` 啟動 REST fetch 不等 SDK | `app.js:2475` |
| `_resolveBootPageId(pageId)` boot 階段套用 page alias | `app.js:1923, 2721` |
| `hashchange` listener 不套 alias(註解明寫) | `app.js:2759-2760` |
| `_pageLockUntil` 10 秒 detail page lock | `js/core/navigation.js:174-182, 519-531` |
| `_syncTournamentDetailRoute` 已對賽事詳情寫 `?tournament=` + `#page-tournament-detail` | `app.js:1051-1059` |

### 4.3 現況風險點(已實證)

| 風險點 | 證據 | V5 處理階段 |
|---|---|---|
| **無 SPA fallback** | `firebase.json` 無 hosting / `_headers` 無 fallback rule / 專案根目錄無 `_redirects`、`_routes.json`、`wrangler.toml` | Phase 2:Cloudflare Worker SPA fallback |
| **404.html 是純靜態死路** | `404.html` 整個 107 行無 `<script>` 載入 SPA | Phase 0.5 #3:僅 GitHub Pages 備援 |
| **3 處 `location.hash =` 強制寫入 + `_replaceRouteHash` 直接寫 URL** | `navigation.js:139, 721, 945`(其中 945 完全無 `suppressHashSync`);`app.js:2028-2035` | Phase 0.5 #1a/#1b |
| **LineAuth.login 不搬 path** | `line-auth.js:434-447` 只搬 4 個 query | Phase 0.5 #2 |
| **canonical / hreflang / og:url 寫死** | `index.html:9-11, 18` 全指向 `https://toosterx.com/` | Phase 5.5 |
| **SW HTML cache 無上限 / LRU** | `sw.js:167-178` | Phase 2 |
| **`_pageLockUntil` 與 popstate 衝突** | `navigation.js:174-182, 519-531` | Phase 6 |
| **Boot deep link 5 層機制** | `app.js:2464-2479, 2710, 2718-2739` | Phase 0 + 3 |
| **`_headers` 對新 path 無規則** | `_headers` 只列 `/index.html`、`/css/*` 等,無 `/activities`、`/events/*` | Phase 2 |

---

## 5. 相容性規則

### 5.1 舊路由永遠先通

URL 同時包含舊路由與新路由時,以舊路由為優先,避免破壞既有入口:

1. `?event=...`
2. `?team=...`
3. `?tournament=...`
4. `?profile=...`
5. `#page-xxx`
6. History path route(本計劃新增)

**衝突情境必須記 warning log**:若 `/events/ce_xxx?event=ce_yyy`(path 與 query 指向不同 ID),取舊路由(query)但寫 `console.warn`,方便日後排查分享連結錯亂。

### 5.2 新 route 只做轉譯

新 route 解析後不直接操作 DOM、不直接改資料流,只轉呼叫既有 App 方法。

範例:

```text
/events/ce_1777808740886_nafqd5
  -> parseHistoryRoute()
  -> { type: 'eventDetail', id: 'ce_1777808740886_nafqd5' }
  -> App.showEventDetail(id)
```

### 5.3 分享連結先不動

活動、俱樂部、賽事分享按鈕第一輪仍產生現有連結。等 clean URL 經過實測後,再另開計劃評估是否把一般 web 分享改成 clean URL。LINE Mini App 分享連結保持原樣。

---

## 6. Route 對照表

| 新路由 | 舊等價入口 | 既有函式 | ID 驗證 | 備註 |
|---|---|---|---|---|
| `/` | `#page-home` | `App.showPage('page-home')` | — | 首頁 |
| `/activities` | `#page-activities` | `App.showPage('page-activities')` | — | 活動行事曆 |
| `/teams` | `#page-teams` | `App.showPage('page-teams')` | — | 俱樂部列表 |
| `/tournaments` | `#page-tournaments` | `App.showPage('page-tournaments')` | — | 賽事中心 |
| `/profile` | `#page-profile` | `App.showPage('page-profile')` | — | 我的頁面 |
| `/events/{eventId}` | `?event={eventId}` | `App.showEventDetail(eventId)` | route-safe segment:`^[A-Za-z0-9_-]{3,80}$` | 活動詳細頁;不硬擋舊 ID 或測試 ID |
| `/teams/{teamId}` | `?team={teamId}` | `App.showTeamDetail(teamId)` | route-safe segment:`^[A-Za-z0-9_-]{3,80}$` | 俱樂部內頁;不硬擋舊 ID |
| `/tournaments/{tournamentId}` | `?tournament={tournamentId}` | `App.showTournamentDetail(tournamentId)` | route-safe segment:`^[A-Za-z0-9_-]{3,80}$` | 賽事詳細頁;支援 `ct_...` 與既有 docId |
| `/users/{uid}` | `?profile={uid}` | (依現有個人頁入口確認) | `^U[a-fA-F0-9]{32}$` | **建議第二輪再啟用**,UID 格式必須嚴格驗證 |

### 6.1 路由命名注意

`/teams` 與 `/teams/{teamId}` 共用第一段 path,解析時必須先判斷段數:

- path 只有 `/teams` -> 俱樂部列表
- path 為 `/teams/{id}` -> 俱樂部詳細頁

`/tournaments` 與 `/tournaments/{id}`、`/events` 與 `/events/{id}` 同理。

### 6.2 ID 格式驗證

V2 使用 `^ce_\d{13}_[a-z0-9]{6}$` 過窄。實際程式碼裡至少有以下 ID 來源:

- `js/config.js:554-556` 的 `generateId(prefix)` 產生 `[prefix]\d{13}_[a-z0-9]{6}`。
- `js/modules/event/event-create-external.js:168` 產生 `ce_${Date.now()}_${random4}`。
- `js/modules/event/event-create-multidate.js:207` 產生 `ce_${Date.now()}_${random4}_${i}`。
- 測試與舊資料可能有 `ce_test_123`、`ce_111_abc` 或 Firestore docId。

**V3 定案**:`parseHistoryRoute()` 不驗證資料是否存在,只驗證 path segment 安全:

1. `decodeURIComponent` 後不可為空。
2. 不可包含 `/`、`\`、`?`、`#`、`..`、encoded slash(`%2F` / `%5C`)。
3. 長度建議 3 到 80 字元。
4. 字元建議 `^[A-Za-z0-9_-]{3,80}$`;若未來要支援更寬字元,必須先加測試。
5. `uid` 仍維持嚴格 `^U[a-fA-F0-9]{32}$`,因為 UID 是個資入口,不可寬鬆。

ID 存不存在交給既有 `showEventDetail(id)` / `showTeamDetail(id)` / `showTournamentDetail(id)` 的資料讀取流程處理,避免 route adapter 因格式假設過時而擋掉合法舊資料。

---

## 7. 建議架構

### 7.1 新增 Route Adapter

新增模組:

```text
js/core/history-route-adapter.js
```

責任:

1. 讀取 `location.pathname`
2. 判斷是否是 clean URL
3. 轉成既有 pageId / detail id
4. 不做 DOM render
5. 不寫 Firestore
6. 不改報名狀態

輸出格式:

```javascript
{
  source: 'history',
  kind: 'eventDetail',
  pageId: 'page-activity-detail',
  id: 'ce_...',
  legacyEquivalent: '?event=ce_...'
}
```

### 7.2 統一 URL Sink(V5 修訂,Phase 0.5 #1a/#1b 前置條件)

v1 計劃漏盤點的關鍵:`navigation.js` 已有 3 處 `location.hash =` 強制寫入,且其中 1 處(`goBack`)無 `suppressHashSync` 開關。Phase 4 的 URL Writer 不能只「再加一個 writer」,而是必須**先把 3 處整合成統一 sink**:

```javascript
App._setRouteUrl(routeOrPageId, options)
```

統一 sink 設計責任:

1. 依當前 feature flag 決定要寫 hash 還是 path
2. 取代 `_activatePage` 內 `location.hash = pageId`
3. 取代 `_showPageFreshFirst` 內 `location.hash = '#' + pageId`
4. 取代 `goBack` 內 `location.hash = '#' + prev`(此處原本無 `suppressHashSync`)
5. 取代 `app.js:2028-2035` 的 `_replaceRouteHash(pageId)` 直接寫 URL 行為;V5 要求它改成呼叫 `_setRouteUrl(pageId, { mode: 'replace' })` 或成為 sink 的薄 wrapper
6. 與 `_syncTournamentDetailRoute` 既有的 query+hash 混合寫入策略明確協調(Phase 5 才接管,初期保留 query)
7. **(V5 拆分)Phase 0.5a 只做純轉接,不得清 path、不得新增 path writer、不得改 URL 結果。**
8. **(V5 拆分)Phase 0.5b 才啟用 hash fallback 清 path 防護:**hash 模式下,若 `location.pathname !== '/'`,寫 hash 前由 sink 以 `history.replaceState(null, '', '/#' + pageId)` 把 path 清回 `/`。此規則需由獨立 flag 控制,例如 `HISTORY_ROUTE_FLAGS.cleanHashFallbackPath`,且有獨立 QA 與回滾。
9. **(V5 補強)`bindNavigation` 底部 tab、drawer 入口、各種 onclick 進 list 頁的 `App.showPage(pageId)` 呼叫,皆以 sink 為準,不另寫 `location.hash`**。確保規則 8 不被繞過。

### 7.3 Boot 階段整合點

整合點放在既有 deep link parse 附近,而不是另起一套 boot:

1. 先處理 `?_spa_redirect=` 還原(若存在)
2. 再解析 query deep link
3. 再解析 hash route
4. 最後解析 history path route
5. 若得到 detail route,**轉成既有 pending route 格式**(`_pendingDeepEvent` / `_pendingDeepTeam` / `_pendingDeepTournament` / `_pendingDeepProfile` 既有 sessionStorage 機制)
6. 若得到 list route(`/activities` / `/teams` / `/tournaments` / `/profile`),必須建立 history boot shell 狀態,例如 `App._bootHistoryTargetPageId`、`window._bootHistoryNavPending = true`、`window._bootTargetPageId = pageId`,並同步底部 tab。這是 V5 新增要求,因為目前 boot overlay 只認 deep link 與 hash nav,不認 clean list path。
7. 交給現有 boot flush / `showPage` / `showDetail` 流程;完成後呼叫 `_dismissBootOverlayAfterHistoryNav()` 或等價清除 guard。

這樣可以最大化沿用目前已修過的 boot overlay、PageLoader priority、route loading overlay。**選擇「轉成既有 pending」而非「新增第 4 個 priority source」是 V3 Phase 0 決策結果**(見 §8.1)。

---

## 8. 分階段實作步驟

### 8.1 Phase 0:施工前審計與決策(V3 修訂)

目的:確認實際入口與命名,**並產出整合策略決策文件**,避免計劃和程式碼不一致。

#### 8.1.1 需閱讀並對照的檔案

1. `app.js` 中 boot deep link 解析區(line 2456-2479, 2710, 2718-2739)
2. `js/core/navigation.js` 的 `showPage`、`_activatePage`、`goBack`(line 138-140, 506-632, 721, 922-953)
3. `js/core/page-loader.js` 的 pageId 對應與 priority 判斷(line 133-152)
4. 活動、俱樂部、賽事詳細頁入口函式名稱(已確認:`showEventDetail` / `showTeamDetail` / `showTournamentDetail`)
5. `_worker.js` 的 `/event-share`、`/team-share` 處理(line 8-78)
6. `js/line-auth.js` 的 `login()` redirectUri 構建邏輯(line 410-448)
7. `index.html` 的 canonical / hreflang / og:url(line 9-11, 18)
8. `sitemap.xml` 現有 URL 結構
9. `_headers` 現有 Cache-Control 規則

#### 8.1.2 必須產出的決策(V3 修訂)

Phase 0 不只是「閱讀」,必須對以下問題產出明確答案,寫入 `docs/history-route-decisions.md`:

| 決策題 | V3 預設答案 | 是否確認 |
|---|---|---|
| history route 解析後存到哪? | 轉成既有 `_pendingDeepXxx` sessionStorage flag,沿用 boot flow | [ ] |
| Cloudflare Pages 是否啟用 SPA Single-page Application 模式? | 採用 `_worker.js` SPA fallback 回 `index.html` HTTP 200;`_routes.json` 若存在必須 include SPA paths | [ ] |
| GitHub Pages 是否仍為次要部署目標? | 保留,404.html 改為 spa-github-pages 風格 redirect | [ ] |
| `_resolveBootPageId` alias 是否套用到新 route? | 套用(維持與 hash boot 一致行為) | [ ] |
| Feature flag 命名? | `HISTORY_ROUTE_FLAGS`(避免與 `siteConfig/featureFlags` doc 重名) | [ ] |
| `_pageLockUntil` 與 popstate 互動策略? | popstate 視為用戶主動導航,bypass page lock | [ ] |
| clean list path boot overlay 如何防閃首頁? | 新增 history boot shell guard,不得只靠 `_pendingDeepXxx` | [ ] |

#### 8.1.3 自我驗收

- [ ] 已產出 `docs/history-route-decisions.md`,**§8.1.2 列出的所有決策皆有明確答案,並與 `decisions.md` 一致**(目前 V5 需含 D1-D9;計劃書若新增決策需同步)
- [ ] 已列出所有 detail 入口函式名稱
- [ ] 已確認 OG route 不會被 SPA fallback 覆蓋
- [ ] 已確認 Mini App 分享連結產生位置
- [ ] 已確認 Cloudflare Pages 為唯一中介層(Firebase Hosting 未使用)

---

### 8.2 Phase 0.5:前置重構(V3 延續,Phase 1 前必完成)

v1 計劃完全漏掉的 3 個前置重構。**未做完前不能進 Phase 1**,否則後續 Phase 4-6 都會撞牆。

#### 8.2.1 子任務 #1a:純重構 URL sink

**問題**:`navigation.js:139, 721, 945` 三處無條件寫 `location.hash`,其中 `goBack` 完全無 `suppressHashSync` 開關。另有 `app.js:2028-2035` `_replaceRouteHash(pageId)` 直接 `history.replaceState` / `location.hash`,V4 漏列此處會讓 URL sink 不完整。

**做法**:

1. 新增 `App._setRouteUrl(routeOrPageId, options)` 統一 sink(初期內部仍寫 hash,行為與目前一致)
2. 把 `_activatePage:139`、`_showPageFreshFirst:721`、`goBack:945` 改為呼叫 `_setRouteUrl`
3. 把 `_replaceRouteHash(pageId)` 改為呼叫 `_setRouteUrl(pageId, { mode: 'replace' })` 或保留函式名稱但內部只轉接 sink
4. **此 commit 內僅做轉接,不改行為**;不得清 path、不得新增 path writer、不得改 `history.length`;確保所有舊測試通過

**自我驗收**:

- [ ] 對 `_setRouteUrl` 有 unit test
- [ ] hash 寫入行為與重構前完全一致
- [ ] `_replaceRouteHash('page-home')` 的 URL 結果與重構前一致
- [ ] `npm run test:unit` 全綠
- [ ] 在 LIFF 與一般瀏覽器各做一次完整 nav round-trip 確認 URL 一致

#### 8.2.1b 子任務 #1b:hash fallback 清 path 防護

**問題**:clean URL 入口(`/activities`)進站後,如果站內導航仍處於 hash 模式,直接寫 `#page-teams` 會產生 `/activities#page-teams` 混合 URL。這是行為改變,不能混在 0.5a 的純重構 commit。

**做法**:

1. 新增獨立 flag,例如 `HISTORY_ROUTE_FLAGS.cleanHashFallbackPath = false`
2. 只有 flag 開啟且 sink 判定本次要寫 hash 時,才執行 `history.replaceState(null, '', '/#' + pageId)` 清回根路徑
3. 不處理 path writer;Phase 4/5 啟用 path writer 時此防護不應介入
4. 此子任務要有獨立 commit、獨立 QA、獨立回滾方式

**自我驗收**:

- [ ] flag 關閉時,URL 行為與 0.5a 完全一致
- [ ] flag 開啟時,從 `/activities` 點底部「俱樂部」後 URL 是 `/#page-teams`,不是 `/activities#page-teams`
- [ ] 同頁點活動頁籤不寫多餘 URL
- [ ] LIFF 環境 flag 預設關閉,避免影響 Mini App 登入 round-trip

#### 8.2.2 子任務 #2:重構 LineAuth.login 把 path 也搬到 redirectUri

**問題**:`js/line-auth.js:434-447` 構建 redirectUri 時:

```javascript
const base = this._getBaseUrl();   // 包 path
const url = new URL(base);
['event', 'team', 'tournament', 'profile'].forEach(key => {  // 只搬 4 個 query
  const val = current.searchParams.get(key);
  if (val) url.searchParams.set(key, val);
});
const redirectUri = url.toString();
if (redirectUri === base) {
  liff.login();    // ← 直接 login,LIFF 用 Endpoint URL,path 丟失
} else {
  liff.login({ redirectUri });
}
```

`/activities`(無 query)登入 → `redirectUri === base`(都是 `origin + pathname`)→ `liff.login()` 不帶 redirectUri → LIFF 用 Endpoint URL `/` → **用戶被丟回首頁,path 丟失**。

**做法**:

1. 改為**只要 path 不是 `/`,就帶 redirectUri**:
   ```javascript
   const base = window.location.origin + '/';   // 改成永遠以 '/' 為基準
   const target = new URL(window.location.href);
   // 移除 LIFF 系列 query,保留其他 query 與 path
   ['code', 'state', 'liffClientId', 'liffRedirectUri', 'error', 'error_description']
     .forEach(p => target.searchParams.delete(p));
   const redirectUri = target.toString();
   if (redirectUri === base) {
     liff.login();
   } else {
     liff.login({ redirectUri });
   }
   ```
2. 與 LINE Developers Console 確認 LIFF Endpoint URL 仍為 `/`,且 LIFF 是否接受 path scope 內的任意 redirectUri(LIFF 文件:redirectUri 必須與 Endpoint URL 同 origin,path 通常被允許)
3. 在 LIFF 環境硬性測試:`/activities` → 點需要登入的按鈕 → LINE OAuth → 回來必須仍在 `/activities`

**自我驗收**:

- [ ] LIFF 環境 `/activities`(無 query)登入後仍在 `/activities`
- [ ] LIFF 環境 `/events/ce_xxx?event=ce_xxx` 登入後仍在原 URL
- [ ] 一般瀏覽器(非 LIFF)登入後仍在原 URL
- [ ] `_cleanUrl()` 仍正確清除 LIFF 系列 query
- [ ] `liff_profile_cache` localStorage 行為不變

#### 8.2.3 子任務 #3:重寫 404.html 為 GitHub Pages SPA bootstrap

**問題**:`404.html` 純靜態 107 行,無 JS 載入 SPA。這只影響 GitHub Pages 備援入口;Cloudflare 正式站不可依賴 `404.html`,必須用 Worker SPA fallback 回 200。

**做法(spa-github-pages 風格)**:

1. 在 `404.html` `<head>` 加入 redirect script:
   ```html
   <script>
     (function() {
       var l = window.location;
       var pathSegments = l.pathname.split('/').filter(Boolean);
       // V5: OG share path early-return,不 redirect。
       // GitHub Pages 上若有人分享 /event-share/{id} 或 /team-share/{id},
       // 該連結通常指向 toosterx.com(Cloudflare),意外掉到 GitHub 404 時不該誤包成 _spa_redirect。
       var firstSeg = pathSegments[0];
       if (firstSeg === 'event-share' || firstSeg === 'team-share') return;
       // 段數 ≤ 2 視為可能的 SPA route(/activities, /events/ce_test_123),redirect 回 /
       // 把 path 編進 query,index.html 啟動時解出來
       if (pathSegments.length > 0 && pathSegments.length <= 2) {
         var encodedPath = '/?_spa_redirect=' + encodeURIComponent(l.pathname + l.search + l.hash);
         l.replace(l.origin + encodedPath);
       }
     })();
   </script>
   ```
2. `app.js` 在 boot 階段最開頭(§8.5 Phase 3 整合)解析 `?_spa_redirect=` 並 `history.replaceState` 還原原 path/search/hash;還原後再跑 query/hash/history 優先序,避免 `_spa_redirect` 與實際 `location.hash` 互相打架
3. 保留現有靜態 fallback HTML(redirect 失敗時仍顯示死路頁,但有 link to `/`)

**自我驗收**:

- [ ] GitHub Pages 上打 `/activities` 會被 404.html redirect 到 `/?_spa_redirect=%2Factivities`
- [ ] index.html 啟動時 URL 還原為 `/activities`
- [ ] redirect 失敗時不會無限迴圈(只 redirect 一次)
- [ ] OG 路徑 `/event-share/{id}`、`/team-share/{id}` 不會掉到 404.html(正式站由 Cloudflare Worker 處理)

---

### 8.3 Phase 1:新增只讀 Route Adapter

目的:先做解析,不改頁面切換行為。

步驟:

1. 新增 `js/core/history-route-adapter.js`,export `parseHistoryRoute(pathname, search)`
2. 解析時只做 route-safe segment 驗證(§6.2),不做資料存在性判斷
3. 加入單元測試,覆蓋 `/activities`、`/events/{id}` 等路徑與失敗情境
4. 在開發環境 console 可手動呼叫測試
5. 不在 production boot 啟用跳轉
6. **bump CACHE_VERSION**(`node scripts/bump-version.js`),把新 JS 加進 `sw.js` `STATIC_ASSETS`

自我驗收:

- [ ] `/activities` 解析成 `page-activities`
- [ ] `/events/ce_1777808740886_nafqd5` 解析成 `eventDetail` + id
- [ ] `/events/ce_1777808740886_abcd_1` 解析成 `eventDetail` + id(multidate 兼容)
- [ ] `/events/ce_test_123` 可解析;若資料不存在,由 detail 頁顯示找不到
- [ ] `/events/a%2Fb`、`/events/..`、`/events/` 回傳 `null`
- [ ] `/event-share/ce_xxx` 回傳 `null`,不進 SPA(避免 OG route 被吞)
- [x] 不合法路徑回傳 `null`
- [x] `/users/{uid}` 對 `^U[a-fA-F0-9]{32}$` 嚴格驗證(若本輪啟用)
- [x] 無任何 DOM 或 Firestore 寫入
- [x] CACHE_VERSION 已 bump,sw.js STATIC_ASSETS 已加 history-route-adapter.js

---

### 8.4 Phase 2:靜態 / Worker SPA fallback(V3:Worker fallback 版)

目的:解決 clean URL 重新整理時主機找不到檔案的問題。**此階段必須在 Phase 3 boot 接入前完成**,否則 Phase 3 自我驗收驗不過。

#### 8.4.1 Cloudflare Pages

**V3 主方案:擴充 `_worker.js` 加 SPA fallback,回 `index.html` 且 HTTP 200。**

原因:Cloudflare Pages 有根目錄 `404.html` 時,clean URL 若只靠靜態找檔或 `_routes.json` 排除 Worker,很容易得到 404 狀態或 404 頁面。History API clean URL 的正式站入口必須由 Worker 明確處理。

Worker 處理順序:

1. 先保留既有 OG route:`/event-share/*`、`/team-share/*`。
2. 再判斷 SPA clean URL path。
3. **V5 定案:只要 `GET` / `HEAD` 且 `SPA_PATHS` 命中就回 `index.html` 200;`Accept: text/html` 只能作為 debug hint,不可作為阻擋條件。**
4. 靜態資源(`/js/*`、`/css/*`、`/pages/*`、`/img/*`、`/assets/*`、`/sw.js`)不進 SPA fallback。

範例邏輯(V5 修訂:path-first,Accept 不當硬條件):

```javascript
const SPA_PATHS = /^\/(activities|teams|tournaments|profile|events\/[^/]+|teams\/[^/]+|tournaments\/[^/]+)\/?$/;

// V5: path 命中即視為 SPA。Accept header 只當作 hint,不阻擋。
// 理由:curl、部分 OG bot(Slack/Discord 偶有)、舊版 Twitterbot 不一定帶 Accept: text/html。
// path 已是 whitelist(精確列舉,不含 wildcard 萬用),不會誤吃到非 SPA 路徑。
if ((request.method === 'GET' || request.method === 'HEAD') &&
    SPA_PATHS.test(url.pathname)) {
  const indexUrl = new URL('/index.html', url.origin);
  const indexResponse = await env.ASSETS.fetch(new Request(indexUrl, request));
  const headers = new Headers(indexResponse.headers);
  headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  // X-Robots-Tag 視 path 決定;detail SPA path 預設 noindex 直到 Phase 5.5 sitemap 上線。
  if (/^\/(events|teams|tournaments|users)\/[^/]+/.test(url.pathname)) {
    headers.set('X-Robots-Tag', 'noindex, nofollow');
  }
  return new Response(request.method === 'HEAD' ? null : indexResponse.body, {
    status: 200,
    headers
  });
}
```

`X-Robots-Tag` 的設計:Phase 2 部署後,detail SPA path 雖然能進站,但 canonical 仍寫死指向 `/`(Phase 5.5 才動)。為避免 Google 在 Phase 5.5 之前就把 `/events/{id}` 當首頁副本索引,Worker 主動回 `noindex`。Phase 5.5 sitemap 與 canonical 動態化上線時再移除此標頭。

`_routes.json` 若要新增,不可只 include OG path。必須讓 OG path 與 SPA path 都進 Worker:

```json
{
  "version": 1,
  "include": [
    "/event-share/*",
    "/team-share/*",
    "/activities",
    "/teams",
    "/tournaments",
    "/profile",
    "/events/*",
    "/teams/*",
    "/tournaments/*"
  ],
  "exclude": [
    "/css/*",
    "/js/*",
    "/pages/*",
    "/img/*",
    "/assets/*",
    "/sw.js"
  ]
}
```

**重點**:OG route 必須優先(`_worker.js` 既有 `isTeamSharePath` / `isEventSharePath` 檢查在前)。`404.html` bootstrap 不可作為 Cloudflare 正式站主方案。

V5 定案:`/users/*` 是第二輪功能,第一輪 `_routes.json` 不 include。若後續啟用 `/users/{uid}`,才同時補 include、`_headers`、route adapter、權限/隱私 QA。

#### 8.4.2 GitHub Pages

依賴 Phase 0.5 #3 已完成的 `404.html` SPA bootstrap 改寫,GitHub Pages 命中 404 時自動 redirect 回 `/?_spa_redirect=...`。

#### 8.4.3 `_headers` 補規則

`_headers` 目前對 `/index.html`、`/` 設 `max-age=0, must-revalidate`,但新 path 沒有規則。必須補:

```
/activities
  Cache-Control: public, max-age=0, must-revalidate

/teams
  Cache-Control: public, max-age=0, must-revalidate

/tournaments
  Cache-Control: public, max-age=0, must-revalidate

/profile
  Cache-Control: public, max-age=0, must-revalidate

/events/*
  Cache-Control: public, max-age=0, must-revalidate

/teams/*
  Cache-Control: public, max-age=0, must-revalidate

/tournaments/*
  Cache-Control: public, max-age=0, must-revalidate
```

V5 定案:第一輪啟用 `/profile`,但 `/users/*` 先列為第二輪;若實作時決定啟用 `/users/*`,必須同時補 `_headers`、Worker `SPA_PATHS`、route adapter 與 QA。

#### 8.4.4 SW 改造(避免 cache 膨脹)

`sw.js:167-178` HTML network-first 對所有 200 navigate response 寫進 `CACHE_NAME`,無 LRU。Phase 2 必須改為:

1. 維護 `NAVIGATE_PATH_WHITELIST = ['/', '/index.html']`
2. 對 `event.request.mode === 'navigate'` 建立 normalize helper:
   - path 是 `/` 或 `/index.html`:可用原 request fetch,但 cache key 統一成 `/index.html`
   - path 命中 SPA route(`/activities`、`/events/{id}` 等):network fetch 可打原 request,但成功後**只能 cache 到 `/index.html` 或 `/`**,不可 `cache.put(event.request, clone)`
   - network 失敗時 fallback `caches.match('/index.html') || caches.match('/')`
3. 此改造只影響 HTML navigate response,不碰 JS/CSS/image cache-first 規則

#### 8.4.5 自我驗收

- [ ] `/activities` 重新整理回 HTTP 200,不是 404 redirect
- [ ] `/events/{id}` 重新整理回 HTTP 200,不是 404 redirect
- [ ] `/events/{id}` response header 含 `X-Robots-Tag: noindex, nofollow`(Phase 5.5 前的暫時保護)
- [ ] `/event-share/{id}` 仍回 OG HTML,不變成 SPA
- [ ] `/team-share/{id}` 仍回 OG HTML,不變成 SPA
- [ ] curl `/activities`(不帶 Accept header)仍回 index.html 200(V5 path-first 邊界驗收)
- [ ] 靜態資源 `/js/...`、`/css/...`、`/pages/...` 不被 fallback
- [ ] Cloudflare 邊緣對新 path 的 cache-control 為 `max-age=0, must-revalidate`
- [ ] SW cache 不會無限膨脹(可用 chrome devtools 觀察 CACHE_NAME 大小)

#### 8.4.6 部署順序(V5 延續)

`_worker.js` SPA handler、`_routes.json` 的 SPA path include、`_headers` 規則,**三者必須在同一個 commit / PR / deploy 內生效**,不可分批 deploy。

理由:

- 若先 deploy `_routes.json`(把 SPA path 路由進 worker)但 `_worker.js` 還沒寫 SPA handler,worker 會 fall through 到 `env.ASSETS.fetch`,SPA path 仍 404。
- 若先 deploy `_worker.js`(已寫 handler)但 `_routes.json` 還沒 include SPA path,`_routes.json` 不存在或 include 範圍小時,worker 仍會接到 SPA path 沒問題,但若已有 `_routes.json` 卻沒 include SPA,SPA path 不會進 worker → 仍 404。
- `_headers` 不影響功能但影響邊緣快取,延後 deploy 會讓部分使用者拿到非預期 cache。

部署檢查清單:

- [x] `_worker.js`、`_routes.json`(若使用)、`_headers` 三者在同一個 commit
- [x] CACHE_VERSION 已 bump(SW STATIC_ASSETS 同步含 history-route-adapter.js)
- [ ] 部署後 5 分鐘內以 `curl -I https://toosterx.com/activities` 驗證 HTTP 200 + X-Robots-Tag
- [ ] 部署後以 `curl -I https://toosterx.com/event-share/test123` 驗證仍回 OG handler(不被 SPA fallback 吃)

---

### 8.5 Phase 3:Boot 接入入口轉譯(V5 補強)

目的:讓直接開 clean URL 可以進到既有頁面。**此階段依賴 Phase 0.5 + Phase 1 + Phase 2 全部完成**。

步驟:

1. 在 `app.js:2456` boot deep link 階段最前面加入 `?_spa_redirect=` 還原,必須在計算 `restEventId` 前完成,否則 `/events/{id}` 會失去 REST fast path。
2. 解析 `?_spa_redirect=`(GitHub Pages 來的)並 `history.replaceState` 還原原 path/search/hash。
3. 若 query / hash 已命中,跳過 history route(舊路由優先,§5.1)。
4. 若 history route 命中 detail,**轉寫到對應 `_pendingDeepXxx` sessionStorage**:
   - `eventDetail` → `_pendingDeepEvent`
   - `teamDetail` → `_pendingDeepTeam`
   - `tournamentDetail` → `_pendingDeepTournament`
   - `userCard` → `_pendingDeepProfile`
5. 若 history route 命中 list page(`/activities`、`/teams`、`/tournaments`、`/profile`),不得只呼叫 `showPage`。V5 要求先建立 history boot shell:
   - `App._bootHistoryTargetPageId = pageId`
   - `window._bootHistoryNavPending = true`
   - `window._bootTargetPageId = pageId`
   - 同步 currentPage / `_userIntendedPage` / bottom tab,邏輯比照 `_primeBootHashRoute`
6. 新增 `_hasPendingHistoryNav()` 並納入 `_dismissBootOverlay` guard;新增 `_dismissBootOverlayAfterHistoryNav(reason)` 在 list route 完成後解除 guard。否則 `App.init()` 後的 `_dismissBootOverlay('Phase 3 快取命中')` 可能先關 overlay,讓首頁閃出來。
7. 交給原本 `showPage` 或 detail 函式;list route 使用 `{ resetHistory: true, suppressHashSync: true, historyRouteSource: 'path' }`。
8. 保留 debug log,方便追查 route source(`window._raceDebug` 或 `localStorage._raceLog`)
9. 對 `_resolveBootPageId` alias 解析的套用範圍依 Phase 0 §8.1.2 決策執行

自我驗收:

- [ ] `https://toosterx.com/activities` 可進活動行事曆
- [ ] `https://toosterx.com/events/{id}` 可進活動詳細頁
- [ ] `https://toosterx.com/?event={id}` 行為不變
- [ ] `https://toosterx.com/#page-activities` 行為不變
- [ ] 從 `/activities` 進站後 URL 仍是 `/activities`,不被改成 `/activities#page-activities`
- [ ] **(V5 新增)history boot shell guard 生效:**`/activities` 進站時 boot overlay 不會在 list route 完成前被 `_dismissBootOverlay('Phase 3 快取命中')` 關掉
- [ ] **(V5 新增)若 `cleanHashFallbackPath=true`,從 `/activities` 進站後點底部 nav 進俱樂部,URL 變成 `/#page-teams` 而非 `/activities#page-teams`**(依賴 §7.2 規則 8)
- [ ] **(V5 新增)從 `/activities` 進站後,點底部 nav 進活動,URL 仍是 `/activities`**(同頁不寫,sink 應 short-circuit)
- [ ] query / hash / history 同時存在時,舊路由優先,衝突有 `console.warn`
- [ ] boot overlay 不會先閃首頁再跳目標頁
- [ ] LIFF 環境下從 `/activities` 觸發登入,登完仍在 `/activities`(依賴 Phase 0.5 #2)
- [ ] GitHub Pages 上的 `/activities` 重新整理可正常進站(依賴 Phase 0.5 #3)

---

### 8.6 Phase 4:列表頁 URL Writer 小範圍啟用

目的:讓部分頁面切換後網址可變 clean URL,但仍可回滾。

依賴:Phase 0.5 #1a(純 URL sink)已完成;若要支援從 clean path 降級回 hash,Phase 0.5 #1b 也必須通過。

建議順序:

1. 先只啟用列表頁:
   - 活動:`/activities`
   - 俱樂部:`/teams`
   - 賽事:`/tournaments`
2. 詳細頁暫時仍維持舊 query / hash
3. 觀察無問題後,再啟用詳細頁 clean URL

實作要點:

- `App._setRouteUrl` 內依 `HISTORY_ROUTE_FLAGS.writeListPaths` 切換寫 path 或 hash
- `history.pushState({ source: 'sportshub' }, '', path)` — state 帶 source 標記,popstate 才能識別來源
- 同步更新 list 頁的 canonical(若已有)為 path version
- **不**啟用 popstate listener(留給 Phase 6)

自我驗收:

- [ ] 從首頁點活動行事曆,URL 變 `/activities`
- [ ] 重新整理後仍在活動行事曆
- [ ] 底部導航 active 狀態正確
- [ ] `App.goBack()` 行為不退步
- [ ] 舊 `#page-activities` 仍有效
- [ ] LIFF 環境 list 頁 URL 寫入正常(若 LIFF disable,跳過)
- [ ] CACHE_VERSION 已 bump
- [ ] [docs/tunables.md](tunables.md) 已登記新 timing(URL writer debounce、若有)

---

### 8.7 Phase 5:詳細頁 URL Writer 啟用

目的:讓活動、俱樂部、賽事詳細頁也能產生 clean URL。

步驟:

1. 活動詳細頁先做(`/events/{id}`)
2. 俱樂部詳細頁第二個(`/teams/{id}`)
3. 賽事詳細頁第三個(`/tournaments/{id}`)
4. 每個 detail route 都必須確認 refresh、返回、分享、權限頁狀態
5. **`_syncTournamentDetailRoute`(`app.js:1051-1059`)與 `_clearTournamentDetailRouteParam`(`navigation.js:154` 呼叫處)的 V5 接管細則**:
   - 兩個 helper 內部 **不再直接操作** `searchParams`、`location.hash` 或 `history.replaceState`
   - 改為呼叫統一 sink:`App._setRouteUrl({ kind: 'tournamentDetail', id }, { mode: 'replace' })`
   - sink 依 `HISTORY_ROUTE_FLAGS.writeDetailPaths` 決定:
     - `true` 寫 `/tournaments/{id}`(replace history)
     - `false` 維持既有 `?tournament={id}` + `#page-tournament-detail`(向後相容)
   - 離開賽事詳情頁時(`_clearTournamentDetailRouteParam`),sink 依當前 flag 決定:
     - `writeDetailPaths=true` 把 path replace 為 `/`(或用 `App.pageHistory` 末尾推回上一頁的 path)
     - `writeDetailPaths=false` 沿用既有 `searchParams.delete('tournament')` 行為
   - **此改動只動 sink 內部分支**,helper 對外簽章不變,不影響 `event-detail-renderer.js` 等呼叫端
6. 活動詳情、俱樂部詳情若有同類 helper(進入時寫 query / 離開時清 query),Phase 5 啟用時必須一併納入 sink 接管,清單在 Phase 0 §8.1.1 審計時補入

自我驗收:

- [ ] 活動詳細頁 `/events/{id}` refresh 後資料正確
- [ ] 俱樂部詳細頁 `/teams/{id}` refresh 後資料正確
- [ ] 賽事詳細頁 `/tournaments/{id}` refresh 後資料正確
- [ ] 報名、取消、候補、團隊報名功能不受影響
- [ ] 管理按鈕權限不受 URL 格式影響
- [ ] 分享按鈕仍產生既有 Mini App 連結(§3 邊界保留)
- [ ] LIFF 環境詳情頁 URL 寫入正常,登入回來不丟 path
- [ ] `_syncTournamentDetailRoute` 已改寫為純 path,測試覆蓋

---

### 8.8 Phase 5.5:SEO 對齊(V3 延續,後續階段)

目的:解決 detail 頁啟用 path URL 後,Google 把所有頁視為首頁副本的重複內容問題。

問題:`index.html:9-11, 18` canonical / hreflang / og:url 全寫死指向 `https://toosterx.com/`。`sitemap.xml` 完全無 SPA 內部 URL。

#### 8.8.1 動態 canonical / hreflang / og:url

新增 helper `App._updateRouteMetaTags(canonicalUrl, options)`:

```javascript
App._updateRouteMetaTags = function(canonicalUrl, options = {}) {
  const head = document.head;
  // canonical
  let canonical = head.querySelector('link[rel="canonical"]');
  if (canonical) canonical.href = canonicalUrl;
  // hreflang
  ['zh-TW', 'x-default'].forEach(lang => {
    const el = head.querySelector(`link[rel="alternate"][hreflang="${lang}"]`);
    if (el) el.href = canonicalUrl;
  });
  // og:url
  const ogUrl = head.querySelector('meta[property="og:url"]');
  if (ogUrl) ogUrl.setAttribute('content', canonicalUrl);
  // og:type(detail 頁應為 article 或 event,list 頁為 website)
  if (options.ogType) {
    const ogType = head.querySelector('meta[property="og:type"]');
    if (ogType) ogType.setAttribute('content', options.ogType);
  }
};
```

V5 呼叫時機定案:`_setRouteUrl` 只負責 URL 與 route intent,不直接改 meta。`_updateRouteMetaTags` 應在 `_renderPageContent` 成功後呼叫;detail 頁需等資料載入完成後以實際 id/name 組 canonical / og:url / og:type。這與 `docs/history-route-decisions.md` D8 的「render 後更新」一致。

#### 8.8.2 sitemap.xml 動態擴充

選項 A(推薦):新增 `scripts/build-sitemap.js`,從 Firestore 公開活動 / 俱樂部 / 賽事讀取後產生 `sitemap-events.xml`、`sitemap-teams.xml`、`sitemap-tournaments.xml`,在 `sitemap.xml` 加 `<sitemapindex>` 引用。

選項 B(過渡):僅靜態列入熱門俱樂部、長期活動,動態的不做 SEO。

時機:於 GitHub Actions(`inject-hot-events.yml` 已有類似工作流)新增排程,每日重建 sitemap。

#### 8.8.3 自我驗收

- [ ] 進 `/events/ce_xxx` 後 `<link rel="canonical">` 變為 `https://toosterx.com/events/ce_xxx`
- [ ] 進 `/activities` 後 canonical 變為 `https://toosterx.com/activities`
- [ ] 回首頁 `/` 後 canonical 變回 `https://toosterx.com/`
- [ ] sitemap.xml 包含至少首頁、5 個列表頁、若干熱門 detail URL
- [ ] Google Search Console 提交新 sitemap 後 24 小時內有抓取紀錄(部署後驗證)
- [ ] [docs/seo-log.md](seo-log.md) 已新增本次 SEO 變更紀錄(CLAUDE.md 強制)

---

### 8.9 Phase 6:Browser Back / Popstate 協調

目的:若 clean URL 大量啟用,瀏覽器返回鍵要和 `App.goBack()` 不衝突。

步驟:

1. 監聽 `popstate`
2. 將 `popstate` 轉成既有 route activation
3. 不直接繞過 `showPage`
4. 保留 feature flag `HISTORY_ROUTE_FLAGS.popstateTakeover` 可關閉 popstate 接管
5. **`popstate` handler 必須 bypass `_pageLockUntil`**(用 `options.bypassPageLock = true`),依 Phase 0 §8.1.2 決策
6. 與既有 `hashchange` listener(`app.js:2757-2769`)協調:同一個 URL 變化只觸發一次 `showPage`

自我驗收:

- [ ] 手機瀏覽器返回鍵不會白屏
- [ ] 站內圓形返回鍵仍可用
- [ ] 從列表進詳細,再返回列表,資料不重複渲染
- [ ] 連續快速返回不造成 stale render
- [ ] route loading overlay 能正常結束
- [ ] **進 detail 後 < 800ms 按返回**:popstate 能正常返回
- [ ] **進 detail 後 1-3 秒按返回**:popstate 能正常返回(不被 page lock 擋)
- [ ] **進 detail 後 > 10 秒按返回**:popstate 能正常返回
- [ ] popstate 與 hashchange 不雙觸發
- [ ] [docs/tunables.md](tunables.md) 登記新 timing(若有)

---

## 9. 完整自我驗收矩陣

### 9.1 舊路由回歸

| 測試 | 預期 |
|---|---|
| `/#page-activities` | 進活動行事曆 |
| `/#page-teams` | 進俱樂部列表 |
| `/#page-tournaments` | 進賽事中心 |
| `/?event={id}` | 進活動詳細頁 |
| `/?team={id}` | 進俱樂部內頁 |
| `/?tournament={id}` | 進賽事詳細頁 |
| Mini App event link | 行為不變 |
| Mini App tournament link | 行為不變 |

### 9.2 新路由驗收

| 測試 | 預期 |
|---|---|
| `/activities` | 進活動行事曆 |
| `/teams` | 進俱樂部列表 |
| `/tournaments` | 進賽事中心 |
| `/events/{id}` | 進活動詳細頁 |
| `/teams/{id}` | 進俱樂部內頁 |
| `/tournaments/{id}` | 進賽事詳細頁 |
| 直接貼網址開啟 | 不 404、不白屏 |
| 頁面重新整理 | 留在同一頁 |
| `/events/ce_test_123` | path 可解析;若資料不存在,由既有 detail 頁顯示找不到 |
| `/events/a%2Fb`、`/events/..` | route adapter 回 `null`,不進錯頁 |
| `/unknown-path` | 回首頁或 404 fallback,不進錯頁 |

### 9.3 LIFF 與登入(V3 延續)

| 測試 | 預期 |
|---|---|
| LIFF 環境 `/activities` 觸發登入 → 登完 | 仍在 `/activities` |
| LIFF 環境 `/events/{id}` 觸發登入 → 登完 | 仍在 `/events/{id}` |
| 一般瀏覽器(非 LIFF)`/teams/{id}` 觸發登入 → 登完 | 仍在 `/teams/{id}` |
| LIFF 環境舊 `?event=` URL 觸發登入 → 登完 | 仍在 `?event=` URL(行為不變) |
| LIFF init 期間 `_cleanUrl()` | 只清 LIFF 系列 query,path 不動 |

### 9.4 功能回歸

| 功能 | 驗收重點 |
|---|---|
| 活動報名 | 自己報名、取消、候補、團隊報名不變 |
| 幫夥伴報名 | 入口 URL 不影響按鈕狀態 |
| 活動留言 | 私密 / 公開 / 回覆 / 按讚不受影響 |
| 管理名單 | 權限與功能不受 URL 格式影響 |
| 俱樂部內頁 | 成員、動態、俱樂部活動正常 |
| 賽事詳細頁 | 報名、比分、職員權限正常 |
| 首頁 | 返回首頁與資訊區正常 |
| 底部導航 | active 樣式正確 |

### 9.5 分享與 SEO

| 測試 | 預期 |
|---|---|
| `/event-share/{id}` | 回 OG HTML(Cloudflare Worker 處理) |
| `/team-share/{id}` | 回 OG HTML(Cloudflare Worker 處理) |
| 活動分享按鈕 | 仍用既有 Mini App 連結 |
| LINE Mini App 開啟 | 不受 clean URL 影響 |
| 一般瀏覽器開 clean URL | 可正常進頁 |
| **canonical 動態化** | Phase 5.5 才驗;第一輪 Phase 0 → 3 不列入阻擋項 |
| **og:url 動態化** | Phase 5.5 才驗;第一輪 Phase 0 → 3 不列入阻擋項 |
| **sitemap 包含新 URL** | Phase 5.5 才驗;第一輪 Phase 0 → 3 不列入阻擋項 |

### 9.6 失敗情境

| 情境 | 預期 |
|---|---|
| `/events/not-found` | 顯示找不到或回列表,不白屏 |
| `/unknown-path` | 回首頁或 404 fallback 頁,不進錯頁 |
| 無登入打開需登入頁 | 走既有登入 / 權限流程 |
| 網路慢 | route loading 有提示,不卡死 |
| 快速連續切頁 | 不產生 stale DOM |
| `/activities` 離線(SW 快取後) | 仍可進列表頁 |
| `/events/{id}` 離線(SW 快取後) | 仍可進詳細頁,資料從 localStorage |
| GitHub Pages refresh `/activities` | redirect 還原 path 後正常進站 |

---

## 10. 回滾策略(V3 補強:區分 writer 可回 / parser/fallback 永久承諾)

### 10.1 永久承諾(一旦上線不可回滾)

下列階段的功能一旦對外公開,**任何已分享的 clean URL 連結會永久存在於 LINE / FB / Email 中**,不可回滾:

- **Phase 1 + Phase 2**:Route adapter 存在 + SPA fallback 存在
- **Phase 5**:詳情頁 clean URL 已產生並可能被使用者複製分享
- **Phase 5.5**:sitemap 已被 Google 索引

回滾這些功能會讓既有用戶分享的連結失效,**不可行**。Phase 1 + Phase 2 上線後即視為不可逆。

### 10.2 可回滾(關 feature flag 即可)

| Phase | 回滾方式 | 影響 |
|---|---|---|
| Phase 3 boot 接入 | 關 `HISTORY_ROUTE_FLAGS.bootIntegration` | 直開 path URL 進首頁,但 fallback 仍生效不出 404 |
| Phase 4 list URL writer | 關 `HISTORY_ROUTE_FLAGS.writeListPaths` | 列表頁切回 hash URL |
| Phase 5 detail URL writer | 關 `HISTORY_ROUTE_FLAGS.writeDetailPaths` | 詳細頁切回 query URL |
| Phase 6 popstate | 關 `HISTORY_ROUTE_FLAGS.popstateTakeover` | 瀏覽器返回不接管,維持 hash 行為 |

### 10.3 Phase 0.5 前置重構回滾

| 子任務 | 回滾風險 |
|---|---|
| #1a 純 URL sink 統一 | 純重構,行為不變;若有問題,git revert 即可 |
| #1b hash fallback 清 path | 行為改變,以 `HISTORY_ROUTE_FLAGS.cleanHashFallbackPath=false` 回滾;不可和 #1a 混在同一 commit |
| #2 LineAuth 改寫 | **中度風險**:若新 redirectUri 觸發 LIFF 端錯誤,登入會失敗。建議先在 LIFF 測試版做完整 round-trip 測試再 deploy |
| #3 404.html SPA bootstrap | 純前端 redirect;失敗時 fallback 到原靜態頁,不會比現況差 |

---

## 11. Feature Flags(V3 延續)

```javascript
// 集中放置,建議在 js/core/route-flags.js
const HISTORY_ROUTE_FLAGS = {
  parseRead: true,           // Phase 1: 啟用 parseHistoryRoute
  cleanHashFallbackPath: false, // Phase 0.5b: clean URL 入口降級回 hash 時清 path,預設關閉
  bootIntegration: false,    // Phase 3: boot 階段轉譯 path -> pending deep link
  writeListPaths: false,     // Phase 4: 列表頁 push path
  writeDetailPaths: false,   // Phase 5: 詳細頁 push path
  popstateTakeover: false,   // Phase 6: popstate 接管
  liffPathDisable: true,     // 若 LIFF 內,即使 writeXxx=true 也不寫 path(預設啟用降低風險)
};
```

**命名理由**:`FEATURE_FLAGS` 已被 `firebase-service.js` / `config.js` 用於 Firestore `siteConfig/featureFlags` doc 讀取(`config.js:60-62`)。改名 `HISTORY_ROUTE_FLAGS` 避免混淆。

上線順序:

1. `parseRead = true`(Phase 1)
2. `cleanHashFallbackPath = true`(Phase 0.5b,只在 0.5a 驗收通過後啟用)
3. fallback 部署完成(Phase 2,前端旗標不需動)
4. `bootIntegration = true`(Phase 3)
5. `writeListPaths = true`(Phase 4)
6. SEO 動態化部署(Phase 5.5,前端旗標不需動)
7. `writeDetailPaths = true`(Phase 5)
8. `popstateTakeover = true`(Phase 6)

---

## 12. 工量與風險評估(V3 補強)

| 項目 | 工量 | 風險 | 說明 |
|---|---:|---:|---|
| Phase 0 決策文件 | 小 | 低 | 純整理 |
| Phase 0.5 #1a 純 URL sink 統一 | 中 | 中低 | 純重構但牽涉 navigation.js 核心,且需涵蓋 `_replaceRouteHash` |
| Phase 0.5 #1b hash fallback 清 path | 小 | 中低 | 行為改變,但有獨立 flag 可回滾 |
| Phase 0.5 #2 LineAuth 改寫 | 小到中 | 中 | LIFF 行為差異需實測 |
| Phase 0.5 #3 404.html bootstrap | 小 | 低 | 純 redirect script |
| Phase 1 Route adapter + tests | 小 | 低 | 純解析 |
| Phase 2 Static / Worker fallback | 中 | 中 | OG route 不能誤吃 |
| Phase 2 SW cache 改造 | 小到中 | 中 | 影響 SW 快取規模 |
| Phase 3 Boot 接入 | 中 | 中 | 牽涉 deep link 與 overlay |
| Phase 4 列表頁 URL writer | 小到中 | 中低 | 只處理主頁入口 |
| Phase 5 詳細頁 URL writer | 中 | 中 | 牽涉 refresh 與資料 readiness |
| Phase 5.5 SEO 動態化 + sitemap | 中 | 中 | sitemap 自動化是新增工作流 |
| Phase 6 Popstate 整合 | 中到大 | 中高 | 與自訂 page history、_pageLockUntil 容易衝突 |

結論:

- 「Phase 0 + 0.5 + 1 + 2 + 3」是基本盤,完成後 clean URL 可直接打開且不會跑 LIFF / 登入地雷
- 「Phase 4 + 5 + 5.5」對外公開 clean URL,SEO 衝擊需同步處理
- 「Phase 6」是最重的,等前面穩定再做

---

## 13. 建議第一輪交付範圍(V5 修訂)

第一輪交付:

1. [x] **Phase 0 決策文件** (`docs/history-route-decisions.md`) — 2026-05-11 審計完成
2. [x] **Phase 0.5 #1a**:`App._setRouteUrl` 純 URL sink,含 `_replaceRouteHash` 接管 — 2026-05-11 實作與驗收完成
3. [x] **Phase 0.5 #1b**:hash fallback 清 path 防護,獨立 flag 驗收 — 2026-05-11 實作與驗收完成
4. [x] **Phase 0.5 #2**:`LineAuth.login` redirectUri 改寫 — 2026-05-11 實作與驗收完成
5. [x] **Phase 0.5 #3**:`404.html` SPA bootstrap — 2026-05-11 實作與驗收完成
6. [x] **Phase 1**:`parseHistoryRoute()` + 單元測試 — 2026-05-11 實作與驗收完成
7. [x] **Phase 2**:`_worker.js` Worker SPA fallback 為主 + 必要 `_routes.json` include/exclude + `_headers` 規則 + SW cache 改造 — 2026-05-11 實作與驗收完成
8. [x] **Phase 3**:Boot 階段可讀 `/activities`、`/teams`、`/tournaments`、`/profile`、`/events/{id}` — 2026-05-11 實作與驗收完成

Phase 0 → Phase 3 回顧驗收(2026-05-11):

- [x] 每個 Phase 已分段審計、實作與驗收
- [x] 第一輪仍保留舊路由:`#page-xxx`、`?event=`、`?team=`、`?tournament=`、`?profile=`
- [x] 新路由只作為入口轉譯層,仍呼叫既有 `showPage` / `showEventDetail` / `showTeamDetail` / `showTournamentDetail`
- [x] LINE Mini App 分享連結與 OG 分享中繼路由維持現況
- [x] Phase 4-6、Phase 5.5 SEO 不在本次實作範圍
9. **不啟用全站 URL writer**(Phase 4-6 留下一輪)
10. **不改分享連結**
11. **不接管 popstate**

第一輪完成後,用戶能直接打開:

```text
https://toosterx.com/activities
https://toosterx.com/events/ce_xxx
```

但站內切頁仍可暫時維持 hash / query,等驗收穩定後再進 Phase 4。**LIFF 用戶在 path URL 觸發登入後不會丟失 path**(Phase 0.5 #2 的價值)。

---

## 14. 實作前最終審計清單(V3 補強)

施工前必須逐項確認:

- [ ] `CLAUDE.md` 已讀
- [ ] `app.js` deep link boot flow 已讀(line 2456-2479, 2710, 2718-2739)
- [ ] `js/core/navigation.js` page activation / back flow 已讀(line 138-140, 506-632, 721, 922-953)
- [ ] `js/core/page-loader.js` priority preload flow 已讀(line 133-152)
- [ ] `js/line-auth.js` `login()` redirectUri builder 已讀(line 410-448)
- [ ] 活動詳細頁入口函式已確認(`showEventDetail`)
- [ ] 俱樂部詳細頁入口函式已確認(`showTeamDetail`)
- [ ] 賽事詳細頁入口函式已確認(`showTournamentDetail`)
- [ ] `_worker.js` OG route 已確認(line 8-78)
- [ ] 現有 Mini App 分享連結產生位置已確認(`MINI_APP_BASE_URL`)
- [ ] 已確認 Cloudflare Pages 為唯一中介層(`firebase.json` 無 hosting,無 `_redirects` / `_routes.json` / `wrangler.toml`)
- [ ] 已決定 fallback 規則放在哪個部署層
- [ ] 已規劃 feature flag 與回滾點(§10、§11)
- [ ] 已決策 history route 整合形式(轉成既有 pending sessionStorage)
- [ ] 已盤點 `_syncTournamentDetailRoute` 既有 query+hash 混合寫入(`app.js:1051-1059`)
- [ ] 已確認 `_pageLockUntil` 與 popstate 協調策略(`navigation.js:174-182, 519-531`)
- [ ] 已確認 canonical / hreflang / og:url 動態化方案(`index.html:9-11, 18`)
- [ ] 已確認 `index.html` 載入 history-route-adapter.js 的方式(同 sw.js STATIC_ASSETS 同步)

---

## 15. 實作後自我驗收步驟

### 15.1 Step 1:本地靜態檢查

1. 執行 route adapter unit tests
2. 執行既有 navigation / boot hash tests(`tests/unit/boot-hash-navigation.test.js`)
3. 搜尋是否誤改 Mini App 分享連結
4. 搜尋是否誤改 `/event-share`、`/team-share`
5. 搜尋是否誤改 `MINI_APP_BASE_URL` 常數
6. **`npm run test:unit` 全綠**(CLAUDE.md §測試與 CI 規範)

通過條件:

- [x] 測試全通
- [x] 無未預期的分享連結改動
- [x] 無未預期的報名功能檔改動
- [x] CACHE_VERSION 已 bump,且 4 處版號(config.js / sw.js / index.html `var V` / index.html `?v=`)一致

### 15.2 Step 2:本地瀏覽器驗收

1. 開 `/activities`
2. 開 `/teams`
3. 開 `/tournaments`
4. 開 `/events/{id}`
5. 重新整理每一個頁面
6. 用舊路由各測一次(`/#page-activities`、`/?event={id}` 等)
7. 觸發 LIFF 登入,登完確認 path 不丟失

通過條件:

- [ ] 不白屏
- [ ] 不 404
- [ ] 不先閃首頁再跳頁
- [ ] 底部導航狀態正確
- [ ] LIFF 登入 round-trip 後 path 保留

### 15.3 Step 3:功能冒煙測試

1. 活動詳細頁按分享
2. 活動詳細頁按加入行事曆
3. 活動詳細頁檢查立即報名按鈕狀態
4. 俱樂部內頁確認卡片與活動區塊正常
5. 賽事詳細頁確認資料載入正常

通過條件:

- [ ] 詳細頁資料正確
- [ ] 按鈕權限正確
- [ ] 無 console error
- [ ] 分享按鈕仍產生既有 Mini App 連結

### 15.4 Step 4:部署後驗收

1. 用 production 網址開 clean URL
2. 用 production 網址開舊 hash / query URL
3. 用手機 Safari 或 LINE 瀏覽器測 Mini App 既有連結
4. 檢查 Cloudflare / GitHub Actions 部署結果
5. 檢查 clean URL response status 是 HTTP 200,不是 404 redirect
6. **`docs/claude-memory.md` 已新增本次修復日誌**(若已實作)
7. **`docs/tunables.md` 已登記新 timing**(若涉及 timing 變更)

通過條件:

- [ ] clean URL 可直接開
- [ ] 舊 URL 可直接開
- [ ] Mini App 分享不受影響
- [ ] OG 分享路由不受影響
- [ ] 修復日誌、tunables 視實作範圍同步維護

### 15.5 Step 5:Phase 5.5 SEO 驗收(後續才執行)

Phase 0 → 3 第一輪不執行本段。只有啟用 Phase 5 詳細頁 URL writer 並準備對外公開 detail clean URL 時,才執行:

1. 進 `/events/{id}` 後檢查 `<link rel="canonical">` 動態化正確。
2. 進 `/events/{id}` 後檢查 `og:url` 動態化正確。
3. sitemap 包含首頁、列表頁與要公開索引的 detail URL。
4. Google Search Console 查 `/events/{id}` 是否被索引(SEO 部署後 24 小時)。
5. **`docs/seo-log.md` 已更新本次 SEO 變更**(CLAUDE.md 強制)。

通過條件:

- [ ] canonical 動態化生效
- [ ] og:url 動態化生效
- [ ] sitemap 已提交或可被搜尋引擎讀取
- [ ] seo-log 已更新

---

## 16. 最終建議

採用「雙軌漸進式升級」,但**第一輪只完成 Phase 0 → Phase 3**:

推薦先做:

1. [x] Phase 0 決策文件
2. [x] Phase 0.5 三項前置重構(關鍵)
3. [x] Phase 1 Route adapter
4. [x] Phase 2 Cloudflare Worker SPA fallback
5. [x] Phase 3 Boot 入口轉譯

暫緩:

1. Phase 4 / 5 全站 URL writer
2. Phase 5.5 SEO 對齊(等 detail URL 真正啟用再做)
3. Phase 6 Browser back / popstate 全面接管

這樣能先取得 clean URL 的主要好處(可直接打開、可重新整理、LIFF 登入不丟 path),同時把既有活動報名、Mini App 分享、OG 預覽、返回鍵的風險壓到最低。

---

## 附錄 A:v1 → V5 主要差異

### A.1 v1 → V3 關鍵差異(供 reviewer 對照,V3 已完成)

1. **Phase 0 從「閱讀」升級為「決策」**:必須產出 `docs/history-route-decisions.md`
2. **新增 Phase 0.5 前置重構**:hash sink 統一 + LineAuth 改寫 + GitHub Pages 用 `404.html` SPA bootstrap
3. **Phase 2 / 3 對調**:Cloudflare Worker fallback 必須先做,boot 接入才有得驗收
4. **Phase 5.5 SEO 對齊新增但後延**:canonical / hreflang / og:url 動態化 + sitemap 擴充,不放進第一輪阻擋項
5. **回滾策略明確區分**:writer 可回 / parser+fallback 永久承諾
6. **Feature flag 改名**:`HISTORY_ROUTE_FLAGS` 避免與 `siteConfig/featureFlags` doc 重名
7. **每個 Phase 都加 CACHE_VERSION bump 義務**(CLAUDE.md 強制)
8. **每個 Phase 都加 docs 同步義務**(claude-memory.md / seo-log.md / tunables.md)
9. **ID 驗證明確化**:改為 route-safe segment 驗證,避免過窄 regex 擋掉 4 碼 suffix、multidate 或舊資料
10. **LIFF 環境風險專章**:`HISTORY_ROUTE_FLAGS.liffPathDisable` 預設啟用
11. **Cloudflare fallback 明確化**:`_worker.js` 回 `index.html` HTTP 200 是正式站主方案;`404.html` 只作 GitHub Pages 備援
12. **列表頁 clean path 明確化**:history path 入口不得立即寫回 hash,避免 `/activities#page-activities`

### A.2 V3 → V4 關鍵差異

1. **混合 URL 防護**:V4 規定 sink 寫 hash 時若 `pathname !== '/'` 必先 `replaceState` 清 path。V5 已將此修正為 0.5a 純重構與 0.5b flag 防護,避免把行為改變混進純重構。
2. **`_syncTournamentDetailRoute` / `_clearTournamentDetailRouteParam` 接管細則**:§8.7 step 5 明確兩個 helper 在 Phase 5 改為呼叫 sink、依 flag 分支,helper 對外簽章不變。
3. **Worker fallback path-first**:§8.4.1 範例移除 `Accept: text/html` 硬條件,改為 path 命中即回 200。涵蓋 curl、部分非瀏覽器 OG bot 邊界。
4. **Phase 2 暫時 noindex**:Worker 對 detail SPA path 加 `X-Robots-Tag: noindex, nofollow`,避免 Phase 5.5 之前 Google 把 `/events/{id}` 當首頁副本索引。Phase 5.5 上線時移除。
5. **`404.html` redirect 排除 OG path**:§8.2.3 redirect script early-return `event-share` / `team-share`,避免 GitHub Pages 上意外把 OG 連結誤包成 `_spa_redirect`。
6. **部署順序明確化**:§8.4.6 規定 `_worker.js`、`_routes.json`(若有)、`_headers` 必須同 commit / 同 PR / 同 deploy,並補 `curl -I` 驗證指令。
7. **決策數對齊**:§8.1.3 從「6 個決策」改為「§8.1.2 列出的所有決策,並與 `decisions.md` 一致」。
8. **第一輪自我驗收新增混合 URL 場景**:§8.5 自我驗收加「從 `/activities` 進站後點 nav 不該變 `/activities#page-teams`」。

### A.3 V4 → V5 關鍵差異(本次審計補強)

1. **Phase 0.5 拆分**:V4 把「純重構」與「清 path 行為改變」放在同一段,V5 拆成 #1a 與 #1b,並要求不同 commit / flag / QA / 回滾。
2. **補齊 `_replaceRouteHash`**:`app.js:2028-2035` 必須納入 URL sink,避免 protected boot fallback 繞過 sink。
3. **補 clean URL boot overlay guard**:新增 `_hasPendingHistoryNav()` / `_dismissBootOverlayAfterHistoryNav()` / `_primeBootHistoryRoute()`,避免 `/activities` 類 list clean URL 先閃首頁。
4. **Worker fallback 規則統一**:文字與範例都改為 `GET/HEAD + SPA_PATHS` path-first,Accept 不作硬條件。
5. **404 hash 保存修正**:`_spa_redirect` 必須 encode path + search + hash,不可把 hash 留在參數外。
6. **`/profile` 與 `/users/*` 範圍釐清**:第一輪啟用 `/profile`,`/users/*` 第二輪;Worker、`_headers`、route adapter 與 QA 必須一致。
7. **SW navigate cache key 明確化**:SPA path 不可 `cache.put(event.request)`,需 normalize 到 `/index.html` 或 `/`。
8. **SEO meta 時機與 decisions 對齊**:`_setRouteUrl` 不改 meta,成功 render 後才更新 canonical / og:url。

---

## 17. Phase 4 Completion Note (2026-05-11)

Phase 4 is implemented and self-audited for the limited list URL writer scope.

- [x] Enabled `HISTORY_ROUTE_FLAGS.writeListPaths`.
- [x] `App._setRouteUrl` writes clean paths only for `page-activities`, `page-teams`, and `page-tournaments`.
- [x] Detail URL writer, popstate takeover, `/users/{uid}`, and LIFF in-client path writes remain disabled.
- [x] The list writer runs before `cleanHashFallbackPath`, so list-to-list navigation writes a clean list path instead of path plus hash.
- [x] Added `tests/unit/history-list-url-writer.test.js` to lock flags, mapping, LIFF guard, and ordering.
- [x] Cache version bumped before deployment.

Phase 5/5.5/6 remain deferred.

## 18. Phase 5 Completion Note (2026-05-11)

Phase 5 is implemented and self-audited for the limited detail URL writer scope.

- [x] Enabled `HISTORY_ROUTE_FLAGS.writeDetailPaths`.
- [x] `App._setRouteUrl({ pageId, id })` writes clean detail paths for `page-activity-detail` -> `/events/{id}`, `page-team-detail` -> `/teams/{id}`, and `page-tournament-detail` -> `/tournaments/{id}`.
- [x] Detail IDs are validated through `HistoryRouteAdapter.isSafeRouteSegment` before path writing.
- [x] Event, team, and tournament detail flows suppress intermediate hash writes and sync the URL only after successful detail entry.
- [x] `index.html` includes `<base href="/">` so nested detail paths resolve CSS/JS/page assets from the site root.
- [x] `_syncTournamentDetailRoute` keeps the old `?tournament=` + `#page-tournament-detail` fallback when detail path writing is disabled or LIFF in-client path writing is blocked.
- [x] `popstateTakeover`, `/users/{uid}`, and Phase 5.5 SEO/canonical/sitemap work remain deferred.
- [x] Existing hash/query routes remain readable; LINE Mini App sharing links are unchanged.
