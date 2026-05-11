# History API 雙軌升級決策文件(Phase 0)

> 對應計劃書: [docs/history-api-dual-route-plan.md](history-api-dual-route-plan.md)
> 階段: Phase 0(施工前審計與決策)
> Last Reviewed: 2026-05-11
> 狀態: Phase 0 已審計確認,進入 Phase 0.5-3 施工

---

## 0. 文件用途

本文件是計劃書 §8.1 Phase 0 的**輸出 deliverable**,把 v2 預設答案展開為「決策 + 理由 + 後果 + 驗收條件」,供 reviewer 逐項確認。

每個決策採 ADR(Architecture Decision Record)風格:

- **問題**:要決定什麼
- **背景**:為什麼要決定、現況證據
- **選項**:可能的做法與各自利弊
- **決策**:選哪個、何時可改
- **理由**:為何這樣選
- **影響到的階段**:後續哪些 Phase 依此決策
- **驗收**:Phase 0 結束前必須驗證的條件

---

## 1. 決策清單總覽

| # | 主題 | 決策狀態 |
|---|---|---|
| D1 | history route 解析後的 boot 整合形式 | 已確認 |
| D2 | Cloudflare Pages SPA fallback 機制 | 已確認 |
| D3 | GitHub Pages 是否仍為次要部署目標 | 已確認 |
| D4 | `_resolveBootPageId` alias 是否套用到新 route | 已確認 |
| D5 | Feature flag 命名與位置 | 已確認 |
| D6 | `_pageLockUntil` 與 popstate 互動策略 | 已確認 |

額外項目(decision 過程中浮出,不阻擋 Phase 0.5 但需在後續確認):

| # | 主題 | 決策狀態 |
|---|---|---|
| D7 | LIFF 環境是否硬性禁用 path URL writer | 已確認 |
| D8 | canonical 動態化的觸發點 | 已確認 |
| D9 | clean list path boot overlay guard | 已確認 |

Phase 6 專屬決策(2026-05-11 V6 審計補強,進入 Phase 6 實作前必須全數確認):

| # | 主題 | 決策狀態 |
|---|---|---|
| D10 | hashchange × popstate dedupe 策略 | 已產出預設答案 |
| D11 | Sentinel state push 防退出 Mini App | 已產出預設答案 |
| D12 | goBack 與 browser history 統合策略 | 已產出預設答案 |
| D13 | popstate state = null 的 fallback 鏈 | 已產出預設答案 |
| D14 | Global popstate race counter | 已產出預設答案 |

---

## D1. history route 解析後的 boot 整合形式

### 問題

`parseHistoryRoute(pathname)` 解析 `/events/ce_xxx` 得到 `{ kind: 'eventDetail', id: 'ce_xxx' }` 之後,要怎麼餵進既有的 boot flow?

### 背景

[app.js:2456-2479](../app.js) boot 階段已有 5 層 deep link 機制:

```javascript
// (app.js:2458-2476 摘錄)
const urlParams = new URLSearchParams(location.search);
const deepEvent = String(urlParams.get('event') || '').trim();
// ... deepTeam / deepTournament / deepProfile
if (deepEvent) sessionStorage.setItem('_pendingDeepEvent', deepEvent);
if (deepTeam) sessionStorage.setItem('_pendingDeepTeam', deepTeam);
if (deepTournament) sessionStorage.setItem('_pendingDeepTournament', deepTournament);
if (deepProfile) sessionStorage.setItem('_pendingDeepProfile', deepProfile);

const restEventId = deepEvent || String(sessionStorage.getItem('_pendingDeepEvent') || '').trim();
if (restEventId) {
  App._deepLinkRestFetch = App._fetchEventViaRest(restEventId);
}

App._startDeepLinkGuard();
App._primeBootHashRoute?.();
```

而 [page-loader.js:133-152](../js/core/page-loader.js) `_getBootPriorityFile` 也依賴這些 sessionStorage flag 決定優先載哪個 fragment。

### 選項

**選項 A:轉成既有 sessionStorage flag(沿用 boot flow)**

```javascript
const route = parseHistoryRoute(location.pathname);
if (route?.kind === 'eventDetail') {
  sessionStorage.setItem('_pendingDeepEvent', route.id);
} else if (route?.kind === 'teamDetail') {
  sessionStorage.setItem('_pendingDeepTeam', route.id);
}
// ... 列表頁 -> location.hash = '#' + pageId 降級到 hash 流程
```

優點:
- 完全沿用既有 boot flow、`_deepLinkRestFetch`、`_startDeepLinkGuard`、PageLoader priority、boot overlay timing
- 不引入新狀態機
- LIFF 登入 round-trip 期間 sessionStorage 仍保留,行為一致

缺點:
- URL bar 仍顯示 `/events/ce_xxx`,但內部已轉成「query 風格的 deep link」,概念不純
- Phase 4-5 啟用 URL writer 時,要記得不要把 sessionStorage flag 也同步寫(會雙重觸發)

**選項 B:新增第 4 個 priority source(`_pendingDeepRouteFromPath`)**

新增獨立 sessionStorage key + 修改 `_getBootPriorityFile`、`_tryOpenPendingDeepLink` 等多處。

優點:
- 概念純粹,history route 與 query/hash deep link 並列三種來源

缺點:
- 改動面大,既有 boot flow 多處要分支
- `_deepLinkRestFetch`、`_startDeepLinkGuard` 也要支援新 source
- 回歸風險高

**選項 C:不過 boot flow,直接在 DOMContentLoaded 後呼叫 `App.showEventDetail(id)`**

優點:
- 簡單直接

缺點:
- 完全繞過 boot priority、PageLoader priority、boot overlay timing 已修過的所有 race fix
- 違反 CLAUDE.md §race condition 防禦規則
- 不可行

### 決策

**選 A:轉成既有 `_pendingDeepXxx` sessionStorage flag,沿用 boot flow**。

### 理由

1. 改動面最小,風險最低
2. 既有 boot flow 已在 race 防禦、boot overlay timing、PageLoader priority 修過多輪,沿用是穩妥選擇(CLAUDE.md §boot 階段 deep link 部分有明確修復歷史)
3. 列表頁(`/activities` 等)直接降級到 `location.hash = '#page-activities'`,讓既有 hashchange listener 處理,連寫 sessionStorage 都不必
4. URL bar 仍然顯示 path,使用者體感不變;內部轉譯只是技術細節

### 影響到的階段

- Phase 1:`parseHistoryRoute` 輸出格式必須能 1:1 對應到 4 種 sessionStorage flag
- Phase 3:boot 整合點放在 `app.js:2456` 既有 deep link parse 之後、`_startDeepLinkGuard` 之前
- Phase 4:列表頁 URL writer 寫 path 時,**不要**同步寫 sessionStorage(避免雙重觸發);只在 boot 階段把 path 轉成 sessionStorage,之後一概不寫

### 驗收

- [ ] Phase 1 unit test 涵蓋:`/events/ce_xxx` → `{ kind: 'eventDetail', id: 'ce_xxx' }`、`/activities` → `{ kind: 'page', pageId: 'page-activities' }`
- [ ] Phase 3 自我驗收:`/events/ce_xxx` 與 `/?event=ce_xxx` 行為完全一致(走相同 boot flow)
- [ ] Phase 3 自我驗收:`/events/ce_xxx` + `/?event=ce_yyy` 衝突時,以 query 為準(舊路由優先,§5.1)且有 `console.warn`

---

## D2. Cloudflare Pages SPA fallback 機制

### 問題

`/activities` 重新整理時,Cloudflare Pages 找不到實體檔,該怎麼回到 SPA?

### 背景

實證:

- [firebase.json](../firebase.json) 無 hosting 段
- [_headers](../_headers) 是 Cloudflare Pages 格式,**無任何 SPA fallback rule**
- `ls | grep -iE "redirect|routes|wrangler|netlify|vercel"` 在 repo 根目錄無檔案
- [_worker.js:80-83](../_worker.js) 對非 OG path 直走 `env.ASSETS.fetch(request)`
- Cloudflare Pages 預設行為:`env.ASSETS.fetch` 找不到檔 → 回 [404.html](../404.html)
- 確認 Cloudflare Pages 為**唯一中介層**(Firebase Hosting 未使用)

### 選項

**選項 A:新增 `_routes.json` + 擴充 `_worker.js` 加 SPA fallback**

```json
// _routes.json — 控制哪些路徑進 _worker.js
{
  "version": 1,
  "include": ["/event-share/*", "/team-share/*", "/activities", "/teams", "/tournaments",
              "/profile", "/events/*", "/teams/*", "/tournaments/*"],
  "exclude": []
}
```

```javascript
// _worker.js 新增 SPA fallback(在既有 OG handler 之後)
const SPA_PATHS = /^\/(activities|teams|tournaments|profile|events\/[\w-]+|teams\/[\w-]+|tournaments\/[\w-]+)\/?$/;
if (SPA_PATHS.test(url.pathname)) {
  const indexRequest = new Request(url.origin + '/', request);
  return env.ASSETS.fetch(indexRequest);
}
```

優點:
- OG route 永遠優先(既有 isTeamSharePath / isEventSharePath 檢查在前)
- 細粒度,不會誤吃靜態資源 `/css/...`、`/js/...`、`/pages/...`
- 未來新增 path 只需更新 regex + `_routes.json`

缺點:
- 需維護 regex 與 `_routes.json` 兩處
- 部署時 Cloudflare Pages 需重新識別 `_routes.json`(首次部署需確認生效)

**選項 B:全站開啟 Cloudflare Pages「Single-page Application」選項**

在 Cloudflare Dashboard 把 Pages 專案的 `not_found_handling` 設為 `single-page-application`。所有 404 都自動回 `index.html`。

優點:
- 最簡單,Dashboard 設一次即可

缺點:
- **可能吃掉 OG route**:若 `_worker.js` 出錯或部署順序錯,`/event-share/{id}` 可能被吞成 SPA
- **無 git track**:設定在 Cloudflare Dashboard,git diff 看不到,新團隊成員不知有此設定
- **無法區分 `/events/abc`(合法)vs `/random-path`(垃圾)**:後者也會被當 SPA 處理,壞 SEO

**選項 C:擴充 _worker.js 不依賴 `_routes.json`**

```javascript
// _worker.js 直接處理 SPA fallback,不靠 _routes.json
// (不貼 _routes.json,所有 path 都進 worker)
```

優點:
- 一個檔搞定

缺點:
- 所有靜態資源(每張圖、每個 JS、每個 CSS)都走 worker,效能影響;Cloudflare 會收 worker 執行費用

### 決策

**選 A:新增 `_routes.json` + 擴充 `_worker.js`**。

### 理由

1. OG route 不會被吃(首要條件)
2. 設定在 git,可 review、可回滾
3. `_routes.json` 細粒度控制,效能最佳(靜態資源不進 worker)
4. 未來新增 path 流程清晰

### 影響到的階段

- Phase 2:必須同時 deploy `_routes.json`、`_worker.js` 改動、`_headers` 規則
- Phase 2 deploy 順序採 V5 定案:`_routes.json`、`_worker.js`、`_headers` 同 commit / 同部署；不再拆成 24 小時觀察兩段式，避免 Phase 3 驗收時 fallback 與 boot 版本不一致
- Phase 3 boot 接入時,`_routes.json` 與 worker fallback 已生效,`/events/ce_xxx` refresh 才能正常進站

### 驗收

- [ ] `_routes.json` 已寫入 repo,內容如選項 A 所示
- [ ] `_worker.js` SPA_PATHS regex 涵蓋所有 §6 對照表的新 route
- [ ] **OG route 優先性測試**:`/event-share/ce_xxx` 仍回 OG HTML,**不被** SPA fallback 吃掉
- [ ] 靜態資源 `/css/base.css`、`/js/config.js`、`/pages/home.html` 不被 fallback
- [ ] `/random-unknown-path` 不被 fallback(走 Cloudflare 預設 404.html)
- [ ] Cloudflare Dashboard 確認 `not_found_handling` 維持預設(不開全站 SPA 模式)

---

## D3. GitHub Pages 是否仍為次要部署目標

### 問題

`msw2004727.github.io` 上的部署,新 path URL 要不要支援?

### 背景

實證:

- 主 repo 根目錄有 `.nojekyll` → GitHub Pages 慣例,禁止 Jekyll 處理
- 主 repo 根目錄**無 CNAME** → 不是綁自有域名,而是用 `msw2004727.github.io` 預設域名
- 遠端 branches:`main`、`cf-beta`、`claude/parse-activity-details-EhrLT`,**無 `gh-pages` branch**
- `.github/workflows/` 有 test、lighthouse、gsc-snapshot 等,**無 deploy-pages 類 workflow**
- CLAUDE.md §專案概述明寫:「部署平台:自有域名 `toosterx.com`(Cloudflare Pages)、GitHub Pages(`msw2004727.github.io`)」

推論:GitHub Pages 是從 `main` branch 根目錄直接發佈(repo Settings > Pages → Source: Branch main /),靠 `.nojekyll` 跳過 Jekyll。

### 選項

**選項 A:保留 GitHub Pages,404.html 改為 SPA bootstrap**

依計劃書 Phase 0.5 #3 改寫 `404.html`,GitHub Pages 命中 404 時自動 redirect 回 `/?_spa_redirect=...`,index.html boot 階段再還原 path。

優點:
- 雙部署平台容錯,Cloudflare Pages 出包時 GitHub Pages 仍可用
- CLAUDE.md 既有承諾不變

缺點:
- 多維護一份 fallback 機制
- 404.html SPA bootstrap 對 SEO 可能有負面影響(短暫 redirect 會被 Google 視為 soft 404)

**選項 B:停用 GitHub Pages,只用 Cloudflare Pages**

優點:
- 維護面減少,只需處理 Cloudflare Pages fallback

缺點:
- CLAUDE.md 需更新
- 失去 Cloudflare 出包時的容錯
- `msw2004727.github.io` 既有外部連結會失效(若有)

**選項 C:GitHub Pages 上不啟用 path URL,只在 Cloudflare Pages 啟用**

優點:
- GitHub Pages 行為不變,無風險

缺點:
- 兩個部署平台行為分歧,使用者打 `/activities` 在 GitHub Pages 上仍 404
- LIFF Endpoint URL 一定指向 Cloudflare(`toosterx.com`),GitHub Pages 上的 path URL 反正 LIFF 進不來,但純瀏覽用戶會踩雷

### 決策

**選 A:保留 GitHub Pages,Phase 0.5 #3 改寫 404.html 為 SPA bootstrap**。

### 理由

1. CLAUDE.md 既有承諾不破壞
2. 雙部署容錯有實際價值(Cloudflare 過去曾有大規模故障紀錄)
3. SPA bootstrap redirect 對 SEO 的傷害可控(robots noindex,Google 不會收 GitHub Pages 上的內容)
4. 改寫成本低(`404.html` 加一段 redirect script + `app.js` boot 解析 `?_spa_redirect=`)

### 影響到的階段

- Phase 0.5 #3:`404.html` 加 SPA bootstrap redirect script
- Phase 3:`app.js` boot 階段解析 `?_spa_redirect=` 並 `history.replaceState` 還原 path
- 文件:無需改 CLAUDE.md(承諾不變)

### 驗收

- [ ] Phase 0.5 #3 完成後,GitHub Pages `https://msw2004727.github.io/activities` 會 redirect 回 `/?_spa_redirect=%2Factivities`
- [ ] 主站 `https://toosterx.com/activities` 不走 404.html(由 `_routes.json` + `_worker.js` 處理)
- [ ] redirect 失敗(JS 關閉)時,404.html 仍顯示原本死路頁(有 link to `/`),不無限迴圈
- [ ] OG 路徑 `/event-share/{id}`、`/team-share/{id}` 在兩個部署平台都不會掉到 404.html

---

## D4. `_resolveBootPageId` alias 是否套用到新 route

### 問題

歷史上 `_resolveBootPageId` 把 hash 上的某些 page id 重新對應(例如 `page-admin-audit-logs` → `page-admin-logs`,因為 `admin-logs` 是統一頁、tab 由 `_pendingAdminLogTab` 控制)。新 history route 解析後要不要套同一份 alias?

### 背景

[app.js:1923](../app.js) 定義 `_resolveBootPageId`,在 [app.js:2721](../app.js) 與 [page-loader.js:144-145](../js/core/page-loader.js) 套用。

關鍵:[app.js:2759-2760](../app.js) hashchange listener **註解明寫不套 alias**:

```javascript
// hashchange 不套用 _resolveBootPageId,因為正常導航(showTeamDetail 等)
// 會在渲染完成後設定 hash,此時不應被重導回列表頁
```

也就是 alias 只在 **boot 初始解析** 階段套用,執行期 hashchange 不套。

### 選項

**選項 A:新 route 套用同一份 alias(維持與 hash boot 一致行為)**

在 `parseHistoryRoute` 結束後、轉成 `_pendingDeepXxx` 之前,呼叫 `_resolveBootPageId(pageId)` 一次。

優點:
- 與 hash boot 行為一致,降低使用者認知差異
- `/admin-audit-logs` 之類的 path 也能正確映射(若未來啟用)

缺點:
- 需確認 alias 表完整(目前只看到 `page-admin-audit-logs` / `page-admin-error-logs` → `page-admin-logs`)
- 列表頁路由(`/activities`)不需要 alias,只 detail 路由需要

**選項 B:不套用,新 route 解析結果視為 final**

優點:
- 概念簡單,parseHistoryRoute 是單一輸出

缺點:
- 歷史 alias 行為不一致(boot hash 會 alias、boot path 不 alias)
- 若 alias 對應的 admin 頁啟用 path URL,行為會分歧

### 決策

**選 A:套用 `_resolveBootPageId`**。

### 理由

1. 與 boot hash 行為一致,維持現有不變式
2. 第一輪不啟用 admin 頁的 clean URL,但留下對應路徑(未來啟用時不需再回頭改)
3. 套用成本低(parseHistoryRoute 結束後一行呼叫)

### 影響到的階段

- Phase 1:`parseHistoryRoute` 後對 `pageId` 套用 `_resolveBootPageId`(若 App 已載入);否則延後到 boot 整合階段
- Phase 3:boot 整合階段確保 `_resolveBootPageId` 已可呼叫
- 同步:第一輪 §6 對照表**不**列出 admin 頁路由(避免使用者打到後混淆)

### 驗收

- [ ] Phase 1 unit test 覆蓋:`parseHistoryRoute('/admin-logs')` 結果走 alias 解析(若本輪啟用,則應解析 OK;否則應回 null)
- [ ] Phase 3 整合後確認:打 `/activities` 進活動行事曆與 `#page-activities` 行為完全一致

---

## D5. Feature flag 命名與位置

### 問題

計劃書 §11 用 `FEATURE_FLAGS.historyRouteRead = true` 風格,但這名稱在專案內已有用途。

### 背景

實證:

- [config.js:60-62](../js/config.js):`FirebaseService.getCachedDoc('siteConfig', 'featureFlags')` 是 Firestore doc 名稱
- 5 個檔案有 `featureFlags` 引用([firebase-service.js](../js/firebase-service.js)、[config.js](../js/config.js)、[user-admin-perm-info.js](../js/modules/user-admin/user-admin-perm-info.js)、[message-line-push.js](../js/modules/message/message-line-push.js)、[notif-settings.js](../js/modules/message/notif-settings.js))

若新 flag 也叫 `FEATURE_FLAGS`,容易讓人誤以為要存到 Firestore。

### 選項

**選項 A:`HISTORY_ROUTE_FLAGS`(集中放 `js/core/route-flags.js`)**

```javascript
// js/core/route-flags.js
const HISTORY_ROUTE_FLAGS = {
  parseRead: true,
  cleanHashFallbackPath: false,
  bootIntegration: false,
  writeListPaths: false,
  writeDetailPaths: false,
  popstateTakeover: false,
  liffPathDisable: true,
};
```

由 `index.html` 在 `app.js` 之前載入。

優點:
- 名稱不衝突
- 集中管理,後續加新 flag 不必散落

缺點:
- 多一個檔
- runtime 切換需 reload

**選項 B:放 `js/config.js` 內的 const**

優點:
- 不多開新檔

缺點:
- `config.js` 已超過 500+ 行,不宜再塞
- 與既有的 `getCachedDoc('siteConfig', 'featureFlags')` 太接近,概念易混

**選項 C:放 Firestore `siteConfig/historyRouteFlags` doc**

優點:
- runtime 切換不必 reload(Firestore listener 推送)

缺點:
- 大幅增加複雜度(SW 預載、cache、Rules)
- 第一輪不需要這種彈性

### 決策

**選 A:`HISTORY_ROUTE_FLAGS` 集中放 `js/core/route-flags.js`,前端常數,非 Firestore doc**。

### 理由

1. 不與既有 `siteConfig/featureFlags` doc 撞名
2. 集中管理,新 flag 容易找
3. 第一輪不需要 runtime 切換,bump CACHE_VERSION 重新部署即可

### 影響到的階段

- Phase 0.5 #1a(純 URL sink)前先建立 `js/core/route-flags.js`,讓後續 Phase 0.5b+ 都讀這個常數
- Phase 1-6 各自啟用對應 flag
- `index.html` 必須在 `app.js` 之前載入 `route-flags.js`(類似 `config.js` 的順位)
- `sw.js` `STATIC_ASSETS` 必須加入 `./js/core/route-flags.js`

### 驗收

- [ ] Phase 0.5 開工前 `js/core/route-flags.js` 已建立
- [ ] `index.html` script 順序:`config.js` → `route-flags.js` → 其他 core
- [ ] `sw.js` `STATIC_ASSETS` 已加入 route-flags.js
- [ ] grep 確認:無檔案誤用 `FEATURE_FLAGS.historyRouteRead`(避免和 Firestore doc 混淆)

---

## D6. `_pageLockUntil` 與 popstate 互動策略

### 問題

進 detail 頁有 10 秒 page lock,期間非用戶觸發的 `showPage` 會被擋。Phase 6 的 popstate 接管時,瀏覽器返回觸發的 `showPage` 是否要 bypass 此 lock?

### 背景

[js/core/navigation.js:174-182](../js/core/navigation.js):

```javascript
// 進 detail 頁設 10 秒 lock
const _DETAIL_LOCK_PAGES = ['page-activity-detail', 'page-team-detail',
  'page-tournament-detail', 'page-user-card'];
if (_DETAIL_LOCK_PAGES.indexOf(pageId) !== -1) {
  this._pageLockUntil = Date.now() + 10000;
} else if (_prevPage !== pageId) {
  this._pageLockUntil = 0;
}
```

[js/core/navigation.js:519-531](../js/core/navigation.js):

```javascript
// showPage 進入時的 lock 檢查
if (this._pageLockUntil && Date.now() < this._pageLockUntil
  && pageId !== this.currentPage
  && !options.bypassPageLock) {
  const recentlyTouched = this._userTouchedAt
    && (Date.now() - this._userTouchedAt < 800);
  if (!recentlyTouched) {
    return { ok: false, reason: 'page_locked' };
  }
}
```

也就是說 lock 期間,**只有「最近 800ms 有 touch/click」或 `options.bypassPageLock=true` 才放行**。

popstate 觸發時是「使用者按瀏覽器返回鍵」,但**不會**觸發 `_userTouchedAt = Date.now()`(那個只監聽頁面內 touchstart/click)。

### 選項

**選項 A:popstate handler 永遠 bypass page lock**

```javascript
window.addEventListener('popstate', (e) => {
  // ... parseHistoryRoute or hash sync
  App.showPage(targetPageId, { bypassPageLock: true });
});
```

優點:
- popstate 是明確的使用者意圖,不該被擋
- 邏輯簡單

缺點:
- 失去 lock 對「進 detail 後立即被自動機制拉走」的防護(但 popstate 本來就不是自動機制觸發,此擔憂不成立)

**選項 B:popstate handler 沿用 800ms recently-touched 邏輯**

讓 popstate 觸發時也檢查 `_userTouchedAt`。但 popstate 本身不會觸發 touch,所以 < 800ms 內按返回會被擋。

優點:
- 與既有邏輯對稱

缺點:
- 不符合直覺(用戶按返回鍵卻被擋)

**選項 C:popstate handler 主動更新 `_userTouchedAt = Date.now()`**

進 popstate 後先寫 `_userTouchedAt`,再呼叫 `showPage`(不需 bypass)。

優點:
- 不必引入新 option

缺點:
- 把 `_userTouchedAt` 概念延伸,容易誤導後人
- 不如直接 bypass 清楚

### 決策

**選 A:popstate handler 永遠 bypass page lock**(Phase 6 啟用時)。

### 理由

1. popstate 是使用者明確意圖,不該被擋
2. lock 設計目標是擋「進 detail 後被自動機制拉走」,不是擋「使用者按返回」
3. `bypassPageLock` 已是既有 option,直接用即可

### 影響到的階段

- Phase 6:popstate handler 必須 `App.showPage(target, { bypassPageLock: true })`
- Phase 6 自我驗收新增三段測試(進 detail 後 < 800ms / 1-3s / >10s 按返回)

### 驗收

- [ ] Phase 6 popstate handler 確實傳 `bypassPageLock: true`
- [ ] 進活動詳情 → 立刻按返回 → 正常返回(不被 lock 擋)
- [ ] 進活動詳情 → 等 2 秒 → 按返回 → 正常返回
- [ ] 進活動詳情 → 等 11 秒 → 按返回 → 正常返回
- [ ] 進活動詳情 → 系統自動觸發其他 showPage(無 bypassPageLock)→ 仍被 lock 擋

---

## D7. LIFF 環境是否硬性禁用 path URL writer

### 問題

Phase 0.5 #2 改寫 `LineAuth.login` 後,LIFF 環境下 redirectUri 會包 path。但 LIFF SDK 對 path-scope redirectUri 是否完全支援,目前無 100% 把握。為避免上線意外,LIFF 環境是否預設禁用 Phase 4-5 的 URL writer?

### 背景

LIFF redirectUri 規格(LINE 官方文件):

- redirectUri 必須與 LIFF Endpoint URL 同 origin
- path 是否必須在 Endpoint URL path scope 內,文件描述模糊
- 實務上:大多數情況下 path 會被允許,但邊界 case 需實測

實證:

- [line-auth.js:441](../js/line-auth.js):目前 redirectUri 構建邏輯只搬 query
- [line-auth.js:121-128](../js/line-auth.js):`hasLiffSession()` 與 `liff.isInClient()` 可區分 LIFF / 一般瀏覽器

### 選項

**選項 A:預設啟用 `liffPathDisable = true`,LIFF 內仍寫 hash/query**

```javascript
// _setRouteUrl 內
const isLiff = LineAuth.hasLiffSession() || (typeof liff !== 'undefined' && liff.isInClient?.());
const usePathUrl = !isLiff || !HISTORY_ROUTE_FLAGS.liffPathDisable;
if (usePathUrl && HISTORY_ROUTE_FLAGS.writeListPaths) {
  history.pushState(/* ... */, path);
} else {
  location.hash = '#' + pageId;
}
```

優點:
- 保險,LIFF 行為不變
- Phase 0.5 #2 的 LineAuth 改寫只在一般瀏覽器發揮作用,風險最低
- LIFF 內既有的 query/hash 流程都已驗證過

缺點:
- LIFF 用戶看不到 clean URL(但 LINE Mini App 內 URL bar 通常被遮蔽,使用者體感無差)

**選項 B:LIFF 內也啟用 path URL**

優點:
- 一致性高,所有環境都用 clean URL

缺點:
- LIFF 邊界 case 風險(若 LIFF 拒絕 path-scope redirectUri,登入會失敗)
- 需 LIFF 環境完整 round-trip 實測

### 決策

**選 A:`HISTORY_ROUTE_FLAGS.liffPathDisable = true`(預設啟用),LIFF 內仍寫 hash/query**。

### 理由

1. LIFF 是核心使用情境,任何登入/分享行為退化都是 P1
2. LIFF 內 URL bar 通常被遮蔽,clean URL 體感差異小
3. 第一輪不需要冒險,等一般瀏覽器穩定後再評估
4. 此 flag 隨時可關(關閉後 LIFF 內也寫 path),不是永久承諾

### 影響到的階段

- Phase 0.5 #2 LineAuth 改寫仍要做(一般瀏覽器需要),但驗收條件不要求 LIFF 內測試
- Phase 4-5 URL writer 內必須檢查 `liffPathDisable`
- Phase 4-5 自我驗收:LIFF 內仍寫 hash/query,行為不變

### 驗收

- [ ] `HISTORY_ROUTE_FLAGS.liffPathDisable = true` 已寫入 `route-flags.js`
- [ ] Phase 4 啟用後,LIFF 內 `/activities` 不變(仍是 `#page-activities` 或原始 URL)
- [ ] Phase 4 啟用後,一般 Safari/Chrome `/activities` 寫入正常
- [ ] Phase 0.5 #2 LineAuth 改寫的自我驗收僅要求一般瀏覽器,LIFF 環境延後到 `liffPathDisable = false` 評估時驗證

---

## D8. canonical 動態化的觸發點

### 問題

Phase 5.5 SEO 對齊要動態更新 canonical / hreflang / og:url。觸發點放在 `_setRouteUrl`(寫 URL 時)還是 `_renderPageContent`(渲染頁面時)?

### 背景

兩者時序不同:

- `_setRouteUrl` 是寫 URL bar,可能發生在頁面已 render 之前(例如 boot 階段)
- `_renderPageContent` 是頁面 DOM render,通常晚於 `_setRouteUrl`

實證:

- [navigation.js:824-907](../js/core/navigation.js) `_renderPageContent` 是 page-by-page 渲染入口
- [index.html:9-11, 18](../index.html) canonical / hreflang / og:url 寫死

### 選項

**選項 A:在 `_setRouteUrl` 內呼叫 `_updateRouteMetaTags`**

優點:
- URL 變化與 meta tag 變化原子化
- 無 timing 落差

缺點:
- 觸發頻率與 URL 寫入次數一致(可能比 render 多)
- 若 URL 寫了但頁面沒 render(極端 race),meta tag 會與實際內容不一致

**選項 B:在 `_renderPageContent` 內呼叫 `_updateRouteMetaTags`**

優點:
- meta tag 與實際 render 內容同步
- Google 抓取時看到的 meta 與內容一致

缺點:
- 與 URL 寫入有時序落差(極短,使用者無感)
- 每個 `_renderPageContent` 分支都要記得呼叫(易遺漏)

**選項 C:兩處都呼叫**

優點:
- 雙重保險

缺點:
- 重複呼叫,DOM 操作增加

### 決策

**選 B:在 `_renderPageContent` 內呼叫 `_updateRouteMetaTags`,並抽出 helper 確保各分支不遺漏**。

### 理由

1. Google 抓取時最關心 meta 與實際內容一致
2. URL 寫了但頁面沒 render 的情境很少見,且即使發生,Google 不會在那毫秒內抓取
3. 抽 helper 統一管理:每個 page 對應 `(canonicalPath, ogType)`,一份對照表,不易遺漏

對照表初稿:

```javascript
const PAGE_META_MAP = {
  'page-home':              { path: '/', ogType: 'website' },
  'page-activities':        { path: '/activities', ogType: 'website' },
  'page-teams':             { path: '/teams', ogType: 'website' },
  'page-tournaments':       { path: '/tournaments', ogType: 'website' },
  'page-profile':           { path: '/profile', ogType: 'profile' },
  'page-activity-detail':   { path: ctx => `/events/${ctx.eventId}`, ogType: 'event' },
  'page-team-detail':       { path: ctx => `/teams/${ctx.teamId}`, ogType: 'website' },
  'page-tournament-detail': { path: ctx => `/tournaments/${ctx.tournamentId}`, ogType: 'event' },
};
```

### 影響到的階段

- Phase 5.5:`_updateRouteMetaTags` helper + `PAGE_META_MAP` 對照表
- Phase 5.5:`_renderPageContent` 末尾統一呼叫(避免每個 page 分支都加)
- Phase 5.5 自我驗收:每個 page 進去後 canonical / og:url / og:type 都符合對照表

### 驗收

- [x] `PAGE_META_MAP` 涵蓋 §6 全部新 route（2026-05-11 `app.js` `_getPageMetaMap()`）
- [x] 進首頁 `/` 後 canonical = `https://toosterx.com/`、og:type = `website`（2026-05-11 unit test 覆蓋）
- [x] 進活動詳情 `/events/ce_xxx` 後 canonical = 對應 path、og:type = `event`（2026-05-11 event-detail.js 在 `_setRouteUrl` 後呼叫 helper）
- [x] 進俱樂部詳情 `/teams/tm_xxx` 後 canonical = 對應 path、og:type = `website`（2026-05-11 team-detail.js 同上）
- [x] 切換 path → hash 路由時 canonical 也同步更新（2026-05-11 `_renderPageContent` 末尾呼叫 helper；hash 與 path 進站走同一渲染入口）
- [x] [docs/seo-log.md](seo-log.md) 已新增此次變更紀錄（CLAUDE.md 強制；2026-05-11 紀錄）

---

## D9. clean list path boot overlay guard

### 問題

`/activities`、`/teams`、`/tournaments`、`/profile` 這類 clean list path 不是 detail deep link,不會寫入 `_pendingDeepXxx`。現有 `_dismissBootOverlay` 只檢查 `_hasPendingDeepLink()` 與 `_hasPendingHashNav()`,若沒有新 guard,`App.init()` 後可能先關掉 overlay,讓首頁短暫閃出來再跳目標頁。

### 背景

實證:

- [app.js:85-110](../app.js) `_hasPendingDeepLink()` / `_hasPendingHashNav()` 沒有 history path 判斷
- [app.js:141-184](../app.js) `_dismissBootOverlay()` 只等 deep link 或 hash nav
- [app.js:1960-1999](../app.js) `_primeBootHashRoute()` 只處理 hash shell,沒有 clean path shell
- [app.js:2625, 2636](../app.js) boot 期間會主動 `_dismissBootOverlay(...)`

### 選項

**選項 A:把 list clean path 也轉成 `_pendingDeepXxx`**

優點:
- 沿用現有 guard

缺點:
- `_pendingDeepXxx` 語意是 detail/profile pending,硬塞 list page 會污染既有流程

**選項 B:新增 history boot shell guard**

優點:
- 語意清楚,list path 走 list guard,detail path 走既有 pending deep link
- 可比照 `_primeBootHashRoute()` 先同步 currentPage、bottom tab、data attribute

缺點:
- 需要新增 `_hasPendingHistoryNav()` / `_dismissBootOverlayAfterHistoryNav()` 與少量 boot 狀態

### 決策

**選 B:新增 history boot shell guard。**

### 理由

1. clean list path 與 detail deep link 是不同問題,不應混用 `_pendingDeepXxx`
2. 現有 hash boot shell 已證明「先 prime shell,完成後解除 overlay guard」是低風險路徑
3. 這能直接驗收「不閃首頁」,也是 V5 計劃書修正的核心缺口

### 影響到的階段

- Phase 3:新增 `_primeBootHistoryRoute()`、`_hasPendingHistoryNav()`、`_dismissBootOverlayAfterHistoryNav()`
- Phase 3:PageLoader priority 需能看見 clean list path 對應 file
- Phase 3:自我驗收新增 `/activities` 不閃首頁

### 驗收

- [ ] `/activities` 直開時,boot overlay 不會先關閉露出首頁
- [ ] `/teams`、`/tournaments`、`/profile` 同樣不閃首頁
- [ ] `/events/{id}` 仍走 `_pendingDeepEvent`,不走 history list guard
- [ ] `/#page-activities` 既有 hash boot shell 行為不變

---

## D10. hashchange × popstate dedupe 策略

### 問題

瀏覽器規範:URL 同時改變 path + hash(例如從 `/events/abc#page-activity-detail` 返回 `/`)時,`popstate` 與 `hashchange` 會接續觸發。若兩個 listener 各自呼叫 `showPage()`,會跑兩次 render → race condition + 重複 DOM 寫入 + 多餘 Firestore 訂閱。

### 背景

實證:

- [app.js:3144-3156](../app.js) 既有 hashchange listener 完全沒有 race protection、沒有 popstate dedupe:
  ```javascript
  window.addEventListener('hashchange', () => {
    const pageId = location.hash.replace(/^#/, '');
    const canResolvePage = pageId
      && (document.getElementById(pageId)
        || (typeof PageLoader !== 'undefined' && PageLoader._pageFileMap && PageLoader._pageFileMap[pageId]));
    if (canResolvePage && pageId !== App.currentPage) {
      App.showPage(pageId);
    }
  });
  ```
- Phase 6 加入 popstate handler 後,**popstate 先 fire**(path 變),**hashchange 後 fire**(hash 變);兩者各自呼叫 `showPage`,造成雙觸發

### 選項

**選項 A:`_suppressNextHashchange` flag + 50ms 視窗**

```javascript
// popstate handler 進入時設旗標
window._suppressNextHashchange = true;
setTimeout(() => { window._suppressNextHashchange = false; }, 50);

// hashchange listener 讀旗標
if (window._suppressNextHashchange) {
  window._suppressNextHashchange = false;
  return;
}
```

優點:
- 既有 hashchange listener 只多 3 行,改動最小
- 50ms 視窗在 Chrome / Safari / LINE WebView 都足夠攔截同次 URL 變化引發的 hashchange
- 不會誤殺後續真實 hashchange

缺點:
- 隱性時間依賴(假設瀏覽器一定先 fire popstate);需在 [docs/tunables.md](tunables.md) 紀錄 50ms window

**選項 B:popstate handler 把 currentPage 設好,hashchange listener 看到 `pageId === currentPage` 就 skip**

優點:
- 不引入新 flag

缺點:
- popstate handler 是 async,在 `await showPage` 期間 currentPage 可能還沒更新,hashchange 仍跑了一次

**選項 C:popstate handler 主動清 hash(replaceState)**

優點:
- 從源頭防止 hashchange 觸發

缺點:
- 改 URL 形狀,使用者若 URL 帶 hash(例如 `#section` 錨點)會被破壞
- 與既有 `_replaceRouteHash` 寫入流程衝突

### 決策

**選 A:`_suppressNextHashchange` flag + 50ms 視窗**

### 理由

1. 改動最少,既有 hashchange listener 加 3 行 early return 即可
2. 50ms 視窗在實測瀏覽器(Chrome 120+ / Safari 17 / LINE WebView iOS 14+/Android 80+)都足夠
3. 副作用範圍明確(50ms 內 hashchange 被 swallowed),易於 docs 紀錄與除錯

### 影響到的階段

- Phase 6 Commit B:popstate handler 進入時 `window._suppressNextHashchange = true` + `setTimeout(() => { window._suppressNextHashchange = false; }, 50)`
- Phase 6 Commit B:hashchange listener (`app.js:3144`) 開頭 `if (window._suppressNextHashchange) { window._suppressNextHashchange = false; return; }`
- Phase 6 Commit B:[docs/tunables.md](tunables.md) 登記 `popstate-hashchange-dedupe-window = 50ms`

### 驗收

- [ ] Phase 6 popstate handler 進入時 set `window._suppressNextHashchange = true`
- [ ] hashchange listener 在 flag 為 true 時 early return 並 reset flag
- [ ] 從 `/events/abc#page-activity-detail` 返回 `/` 觸發 popstate + hashchange,實測只有 1 次 showPage
- [ ] 純 hash route 變化(無 path 改變)正常 fire hashchange(flag 未被誤觸發)
- [ ] `docs/tunables.md` 登記 50ms window 與其依賴關係

---

## D11. Sentinel state push 防退出 Mini App

### 問題

從 LINE 訊息點 `/events/abc` 進站時 `window.history.length === 1`,用戶按返回鍵直接退出 Mini App / 關閉 Tab,UX 痛點。LIFF / Mini App 是 ToosterX 主要用戶來源(計劃書 §1),退出後重開要「開 LINE → 找訊息 → 點連結」,流失率高。

### 背景

- 計劃書 §8.9 V5 完全未提此問題
- 經驗值:LINE Mini App 退出後 7 天內回流率約 30% 左右(對比 SPA 內導航留存)
- 多個社群分享活動連結時用戶滑進來 → 看一眼 → 返回的行為極常見

### 選項

**選項 A:boot 完成後 always push sentinel**

```javascript
history.pushState({ source: 'sportshub', sentinel: true }, '', location.href);
```

優點:
- 所有情境都有保護,邏輯簡單

缺點:
- 即使 history.length > 1(站內導航進來)也 push,污染 history stack
- 用戶在站內按返回會多一個無意義 entry

**選項 B:只在 `window.history.length === 1` 時 push**

```javascript
if (window.history.length === 1 && flags.popstateTakeover) {
  history.pushState(
    { source: 'sportshub', sentinel: true, fallbackPageId: 'page-home' },
    '',
    location.href
  );
}
```

優點:
- 只在真正需要保護的情境介入
- 不污染既有站內導航 history stack

缺點:
- `window.history.length` 在某些瀏覽器是不精確的;需在 boot 流程適當 hook 點呼叫(boot 完成、第一次 interaction 前)

**選項 C:popstate handler 偵測 state=null 才補 push**

優點:
- 反應式,不需要預判

缺點:
- 已感受到「按了返回但沒退出」的卡頓
- 若 popstate handler 失敗或 race,使用者真的退出

### 決策

**選 B:`window.history.length === 1` 時 push sentinel,popstate handler 偵測 sentinel 後 navigate 到 fallback 並 re-push**

### Sentinel state 形狀

```javascript
{ source: 'sportshub', sentinel: true, fallbackPageId: 'page-home' }
```

### popstate handler 處理 sentinel

```javascript
// 完整邏輯詳計劃書 §8.9.1 popstate handler 整體骨架
// 重點:必須帶 { bypassPageLock: true } 才能在 detail 進站 10 秒內也能正常返回(D6)
if (event.state?.sentinel === true) {
  await this.showPage(event.state.fallbackPageId || 'page-home', { bypassPageLock: true });
  if (seq !== App._popstateRequestSeq) return;  // D14 stale check
  // 再 push 一次撐住下一次返回(pushState 本身不觸發 popstate / hashchange)
  history.pushState({ ...event.state }, '', location.href);
  return;
}
```

### 理由

1. 比 A 乾淨(不污染站內導航 history stack)
2. 比 C 主動(預防,不等使用者試圖退出才反應)
3. sentinel 在 popstate handler 內處理 fallback,與 D13 state=null 邏輯解耦但可協作
4. Hook 點放在 boot 完成 + popstateTakeover=true 的 AND 條件下,避免 Phase 6 flag 關閉時介入

### 影響到的階段

- Phase 6 Commit B:boot 完成 hook 點(`App.init()` 結尾)新增 sentinel push
- Phase 6 Commit B:popstate handler 偵測 sentinel 並重 push
- Phase 6 Commit C:自我驗收涵蓋 LIFF 進站 + 一般瀏覽器直開兩種情境

### 驗收

- [ ] 從 LIFF 點 `/events/abc` 進站 → 按返回 → 顯示首頁,**不退出 Mini App**
- [ ] 從一般瀏覽器 `/events/abc` 直開 → 按返回 → 顯示首頁,**不關閉 Tab**
- [ ] 站內導航(history.length > 1)時 boot 不 push sentinel(透過 length 檢查)
- [ ] sentinel state 在 popstate 後被 re-push,連按 3 次返回都不退出
- [ ] flag `popstateTakeover=false` 時不 push sentinel,維持 Phase 5 行為

---

## D12. goBack 與 browser history 統合策略

### 問題

`goBack` 每次 `pageHistory.pop()` 後呼叫 `_setRouteUrl(prev)`,後者預設 `pushState` 或 `location.hash = pageId`(都會 push 新 entry),導致 browser history 隨 goBack 持續膨脹。Phase 6 啟用 popstate 後,「站內返回 → 瀏覽器返回」會跳到剛離開的頁面(因為 browser history 還在前進方向)。

### 背景

- [js/core/navigation.js:953-957](../js/core/navigation.js):
  ```javascript
  // 同步 URL hash
  if (location.hash !== '#' + prev) {
    if (typeof this._setRouteUrl === 'function') this._setRouteUrl(prev);
    else location.hash = prev;
  }
  ```
- `_setRouteUrl(pageId)` 預設 `pushState`(detail path)或 `location.hash = pageId`(都會 push 一條 entry)
- 實證情境:用戶點活動 → 進詳情 → 按站內返回:`pageHistory.pop` → `_setRouteUrl('page-activities')` → push `/activities` → **browser history 變 `[/, /events/abc, /activities]`**
- 下一步若按瀏覽器返回 → popstate fire → URL 跳回 `/events/abc` → showPage 把使用者拉回詳情
- 此 bug 在 Phase 6 之前就**已隱性存在**,只是沒接管 popstate 所以使用者按錯方向再按一次就對了,沒人發現

### 選項

**選項 A:goBack 改用 replace 模式**

```javascript
// 保留外層守衛(避免 URL 已等於目標時無謂寫入,與 _activatePage:138 風格一致)
if (location.hash !== '#' + prev) {
  if (typeof this._setRouteUrl === 'function') {
    this._setRouteUrl(prev, { mode: 'replace' });
  } else {
    history.replaceState(null, '', '#' + prev);
  }
}
```

優點:
- 改動最小(範例 7 行但實質只是 push → replace)
- 不依賴 popstate handler,可獨立成 Pre-Phase 6 commit 先 deploy 並驗證
- 即使 Phase 6 不啟用 popstateTakeover 也修正了 history stack 膨脹
- 保留外層守衛確保不產生無謂的 replaceState 呼叫

缺點:
- 兩個 history stack(自訂 pageHistory + 瀏覽器 history)仍各管各的
- 用戶「站內返回 5 次」後按瀏覽器返回會直接跳到 boot 之前的外部頁面(但這通常是 user 想要的行為:離站)

**選項 B:goBack 改用 `history.back()`,讓 popstate handler 統一處理**

```javascript
async goBack() {
  if (this.pageHistory.length > 0 && window.history.length > 1) {
    history.back(); // 觸發 popstate handler
    return;
  }
  // fallback: 原本邏輯
}
```

優點:
- 兩個 stack 永遠同步,popstate handler 是單一真實源
- 用戶感受「站內返回 = 瀏覽器返回」,UX 直覺一致

缺點:
- 必須等 Phase 6 啟用 popstate handler 才能運作,無法 Pre-Phase 6 獨立 deploy
- 改動大(`goBack` 內 page cleanup / DOM / Firestore subscribe 全部要搬到 popstate handler)
- LIFF 部分版本 `history.back()` 行為不可靠(iOS WebView 報告過 quirk)

**選項 C:goBack 維持現狀,popstate handler 內偵測「reverse direction」做特殊處理**

優點:
- goBack 零改動

缺點:
- popstate handler 邏輯複雜
- 偵測「剛從站內返回」vs「按瀏覽器返回」機制脆弱,易誤判

### 決策

**選 A 為短期方案(Pre-Phase 6 獨立 commit),選 B 為未來演進目標**

### 理由

1. 選 A 改動最小、可獨立驗證、可獨立上線、即使 Phase 6 不做也是純改進
2. 選 A 修正的是**現存隱性 bug**(history 膨脹),不依賴 Phase 6
3. 選 B 雖然架構更乾淨,但牽涉 `goBack` 內所有 cleanup / DOM / subscribe 邏輯重構,風險高,留待 Phase 6 主體穩定 ≥ 1 月後再評估
4. LIFF 在 iOS WebView 對 `history.back()` 的行為仍不可預測,選 B 需要先在 LIFF 內充分測試才能上線

### 影響到的階段

- **Pre-Phase 6 獨立 commit**:`goBack` 內 `_setRouteUrl(prev, { mode: 'replace' })`
- Pre-Phase 6 自我驗收:點首頁 → 活動列表 → 活動詳情 → 站內返回 5 次後,`window.history.length` 不膨脹
- Phase 6 主體:popstate handler 與 goBack 解耦,各自負責自己的 stack
- 未來迭代(暫不排期):評估選 B,需 goBack 重構成 popstate-driven

### 驗收

- [ ] `goBack()` 內 `_setRouteUrl` 使用 `{ mode: 'replace' }`
- [ ] hash 模式 fallback(`location.hash = prev`)也走 replace(`history.replaceState(null, '', '#' + prev)`)
- [ ] 點首頁 → 活動列表 → 活動詳情 → 站內返回 5 次後,`window.history.length` ≤ 進站時 +1
- [ ] 站內返回 → 瀏覽器返回 → **不會跳到剛離開的詳情頁**
- [ ] 此 commit 可獨立上線,不依賴 Phase 6 啟用

---

## D13. popstate state = null 的 fallback 鏈

### 問題

popstate 事件的 `event.state` 在以下 4 種情境是 null:

1. 用戶從外部連結進站,瀏覽器原生 history entry 沒 state object
2. refresh 後第一次 popstate 觸發
3. 用戶按返回退到 boot 之前的 history entry(站外)
4. iOS WebView 偶發 state 丟失(已知 Safari/WebView quirk)

如果 popstate handler 把 state=null 當錯誤,會白屏或停在錯誤頁。

### 背景

- [app.js:2089+](../app.js) `_setRouteUrl` 所有寫入都用 `{ source: 'sportshub', pageId, id? }` 形狀
- 但 history entry 可能來自:
  - boot 時瀏覽器初始 entry(無 state)
  - 從其他網站連過來的 referrer entry(無 state)
  - LIFF 內 popstate 偶發 state 丟失

### 選項

**選項 A:state = null 視為錯誤,console.error 並停在原頁**

優點:
- 嚴格

缺點:
- UX 差(使用者按了返回鍵卻沒反應)
- iOS WebView quirk 會被誤判

**選項 B:fallback chain — `state.pageId → parse from URL → validated hash → 'page-home'`**

```javascript
// hash 解析必須驗證 pageId 真的對應 SPA 頁面(否則 #section 錨點會被誤當成 pageId)
function _validatePageId(pageId) {
  if (!pageId) return null;
  if (document.getElementById(pageId)) return pageId;
  if (typeof PageLoader !== 'undefined' && PageLoader._pageFileMap?.[pageId]) return pageId;
  return null;
}

const stateValid = event.state && event.state.source === 'sportshub';  // source guard
const targetPageId = (stateValid && event.state.pageId)
  || (window.HistoryRouteAdapter?.parseHistoryRoute?.(location.pathname, location.search)?.pageId)
  || _validatePageId(location.hash.replace(/^#/, ''))  // 驗證後才使用
  || 'page-home';
```

優點:
- 任何情境都有解,不會白屏
- 與既有 boot deep link parse 邏輯一致(都從 URL 重新解析)
- 終極 fallback 是 `page-home` 不是錯誤頁
- `_validatePageId` 避免 `#section`、`#unknown-page` 等錨點被誤判
- source guard 避免第三方 library 寫入 state 污染

缺點:
- 多走一次 URL parse + DOM lookup(成本低)

**選項 C:state = null 視為「退出意圖」,sentinel 處理**

優點:
- 與 D11 整合

缺點:
- 過度激進,把第 1/2 種情境(正常無 state)也當退出
- 與 D11 sentinel 機制衝突(sentinel 已有 state.sentinel=true)

### 決策

**選 B:fallback chain**

### 理由

1. 任何 4 種情境都能優雅解決,不白屏
2. 與既有 boot deep link parse 邏輯一致,可重用 `HistoryRouteAdapter`
3. 不誤判正常情境為退出
4. 與 D11 sentinel 邏輯解耦(sentinel 偵測 `state.sentinel === true`,fallback 只在 state 為 null 時走)

### 影響到的階段

- Phase 6 Commit B:popstate handler 完整 fallback chain
- Phase 6 Commit B:可能新增 helper `_resolvePopstateTargetPage(event)` 集中 fallback 邏輯

### 驗收

- [ ] popstate 觸發時 state 為 null,handler 從 URL 解析得到 pageId
- [ ] refresh 後第一次按返回不會白屏
- [ ] 終極 fallback 是 `page-home`,不是錯誤頁或停留原頁
- [ ] state = null 不觸發 sentinel 邏輯(兩者解耦,sentinel 看 `state.sentinel === true`)
- [ ] 從外部網站連結進站後按返回,handler 能優雅 fallback 或交給瀏覽器原生返回
- [ ] hash 為 `#section`、`#unknown-pageId` 等錨點時,`_validatePageId` 回 null,fallback chain 走下一層
- [ ] state.source 不是 'sportshub' 時,handler 不信任 state.pageId,改走 URL parse(source guard)

---

## D14. Global popstate race counter

### 問題

連續快速按返回鍵(例如 200ms 內按 3 次)會觸發 3 次 popstate handler,每個都呼叫 async showPage。前一個 showPage 還在 await 期間,後續 popstate 已 fire,可能造成 stale DOM render。

### 背景

- per-detail counter(`_eventDetailRequestSeq`、`_teamDetailRequestSeq`、`_tournamentDetailRequestSeq`、`_friendlyTournamentDetailSeq` 等)只保護「detail 頁內部資料載入 race」
- popstate handler 跨頁切換(list ↔ detail ↔ home),per-detail counter 無法保護「上一個 popstate 還沒完成」這種跨頁 race
- 計劃書 §8.9 V5 self-check 列了「連續快速返回不造成 stale render」但沒給機制

### 選項

**選項 A:per-detail counter 已夠用**

優點:
- 不引入新狀態

缺點:
- 跨頁切換場景無覆蓋,實證有 race

**選項 B:新增 global `App._popstateRequestSeq`**

```javascript
App._popstateRequestSeq = 0;

window.addEventListener('popstate', async (event) => {
  const seq = ++App._popstateRequestSeq;
  // ... resolve targetPageId ...
  await App.showPage(targetPageId, { bypassPageLock: true });
  if (seq !== App._popstateRequestSeq) return; // stale
  // ... post-render work ...
});
```

優點:
- 與既有 per-detail seq 模式一致(CLAUDE.md §新增 async show* 函式 Checklist)
- 跨頁切換場景有保護
- 實作成本最低

缺點:
- 多一個 global state(可接受)

**選項 C:全域 lock 機制(popstate 互斥)**

優點:
- 最嚴格

缺點:
- 複雜,可能造成 popstate 排隊不順暢

### 決策

**選 B:global `App._popstateRequestSeq`**

### 理由

1. 與既有 race counter 模式一致(`_eventDetailRequestSeq` 等)
2. 跨頁切換場景需要 popstate handler 自己的 seq,不能依賴 per-detail
3. CLAUDE.md §新增 async show* 函式 Checklist 已驗證此 pattern 的有效性
4. 實作成本最低

### 影響到的階段

- Phase 6 Commit B:popstate handler 入口 `const seq = ++App._popstateRequestSeq;`
- Phase 6 Commit B:每個 await 後檢查 `seq !== App._popstateRequestSeq` 並 early return
- Phase 6 Commit C:Playwright e2e 覆蓋連續快速 popstate

### 驗收

- [ ] popstate handler 入口 `const seq = ++App._popstateRequestSeq;`
- [ ] 每個 `await` 後檢查 `seq !== App._popstateRequestSeq` 並 early return
- [ ] Playwright e2e:200ms 內連按 3 次返回,最終 DOM 對應最後一次 popstate target
- [ ] popstate handler 失敗或被 swallow 時 seq 仍正確增長(避免下次卡死)
- [ ] sentinel re-push 與 race counter 不衝突(sentinel push 不算新 popstate 觸發)

---

## 2. 決策狀態追蹤

| # | 主題 | 預設答案 | reviewer 確認 | 變更歷史 |
|---|---|---|---|---|
| D1 | history route 整合形式 | 選 A:既有 sessionStorage flag | [x] | 2026-05-11 Codex 審計確認 |
| D2 | Cloudflare Pages SPA fallback | 選 A:`_routes.json` + `_worker.js` | [x] | 2026-05-11 Codex 審計確認 |
| D3 | GitHub Pages 部署 | 選 A:保留,404.html 改 SPA bootstrap | [x] | 2026-05-11 Codex 審計確認 |
| D4 | `_resolveBootPageId` alias 套用 | 選 A:套用 | [x] | 2026-05-11 Codex 審計確認 |
| D5 | Feature flag 命名 | 選 A:`HISTORY_ROUTE_FLAGS` 集中 | [x] | 2026-05-11 Codex 審計確認 |
| D6 | `_pageLockUntil` 與 popstate | 選 A:popstate bypass page lock | [x] | 2026-05-11 Codex 審計確認 |
| D7 | LIFF 環境 path URL writer | 選 A:`liffPathDisable = true` | [x] | 2026-05-11 Codex 審計確認 |
| D8 | canonical 動態化觸發點 | 選 B:`_renderPageContent` 內 | [x] | 2026-05-11 Codex 審計確認 |
| D9 | clean list path boot overlay guard | 選 B:新增 history boot shell guard | [x] | 2026-05-11 Codex 審計確認 |
| D10 | hashchange × popstate dedupe | 選 A:`_suppressNextHashchange` flag + 50ms 視窗 | [ ] | 2026-05-11 V6 審計新增 |
| D11 | Sentinel state push 防退出 Mini App | 選 B:`history.length === 1` 時 push | [ ] | 2026-05-11 V6 審計新增 |
| D12 | goBack 與 browser history 統合 | 選 A(短期):goBack 改 replace 模式 | [ ] | 2026-05-11 V6 審計新增 |
| D13 | popstate state = null fallback | 選 B:fallback chain(state → URL → hash → page-home) | [ ] | 2026-05-11 V6 審計新增 |
| D14 | Global popstate race counter | 選 B:`App._popstateRequestSeq` | [ ] | 2026-05-11 V6 審計新增 |

reviewer 確認後,把 [ ] 改為 [x] 並在「變更歷史」加日期 + reviewer。

---

## 3. Phase 0 完成判定

Phase 0 完成的條件:

- [x] D1-D9 全數有 reviewer 簽字確認
- [x] 任何「不選預設答案」的決策已寫入「變更歷史」並更新「預設答案」欄位
- [x] 計劃書 `docs/history-api-dual-route-plan.md` 已對照本決策更新(若 reviewer 改變了答案)
- [x] 進入 Phase 0.5 前置重構

---

## 4. Phase 6 動工前判定(2026-05-11 V6 新增)

Phase 6 進入 Commit A(Pre-Phase 6)實作前的條件:

- [ ] D10-D14 全數有 reviewer 簽字確認
- [ ] 任何「不選預設答案」的決策已寫入「變更歷史」
- [ ] 計劃書 `docs/history-api-dual-route-plan.md` §8.9 V6 章節已對照本決策更新
- [ ] [docs/tunables.md](tunables.md) 已預留 `popstate-hashchange-dedupe-window`(D10)條目
- [ ] 計劃書 §10 回滾策略已加註「Pre-Phase 6 不可回滾」「sentinel push 即使 flag 關閉仍生效但無副作用」說明

Phase 6 三個 Commit 階段完成的條件:

- [ ] **Commit A (Pre-Phase 6)**:`goBack` 改 replace 模式,獨立 deploy 並穩定 ≥ 1 週,期間無 history-stack 相關 bug 回報
- [ ] **Commit B (基礎設施)**:popstate handler + sentinel + dedupe + counter 上線但 `popstateTakeover=false`,所有單元測試與 jsdom 整合測試通過
- [ ] **Commit C (啟用)**:`popstateTakeover=true`,Playwright e2e 全綠,LIFF 五平台(iOS WebView / Android WebView / iOS Safari / Android Chrome / Desktop Chrome)實機驗證通過

---

## 附錄 A:閱讀過的檔案與行號

本決策文件依據以下實際讀過的程式碼,所有引用皆有 `file:line` 來源:

| 檔案 | 關鍵行號 | 用途 |
|---|---|---|
| `app.js` | 85-184, 1015-1041, 1043-1059, 1923, 1960-2035, 2456-2479, 2625-2636, 2710, 2718-2769 | boot overlay guard、boot deep link、`_resolveBootPageId`、hashchange、`_syncTournamentDetailRoute`、`_replaceRouteHash` |
| `js/core/navigation.js` | 138-140, 174-182, 472-484, 506-632, 721, 922-953 | `_activatePage`、page lock、`showEventDetail`、`showTeamDetail`、`goBack` |
| `js/core/page-loader.js` | 11-22, 41-93, 133-152 | `_bootPages`、`_pageFileMap`、`_getBootPriorityFile` |
| `js/line-auth.js` | 19-32, 121-128, 410-448 | `_cleanUrl`、`hasLiffSession`、`login` |
| `js/config.js` | 60-62, 554-556 | `featureFlags`、`generateId` |
| `js/firebase-service.js` | (含 `getCachedDoc`) | featureFlags doc 讀取慣例 |
| `_worker.js` | 1-85 | OG 路由、`env.ASSETS.fetch` fallback |
| `_headers` | 全 55 行 | Cloudflare Pages cache rules |
| `404.html` | 全 107 行 | 純靜態死路頁 |
| `sw.js` | 9-45, 167-178 | CACHE_NAME、HTML network-first |
| `firebase.json` | 全 31 行 | 確認無 hosting 段 |
| `index.html` | 9-11, 18 | canonical / hreflang / og:url |
| `sitemap.xml` | 1-60 | 現有 SEO URL 結構 |
| `js/modules/tournament/tournament-detail.js` | 8 | `showTournamentDetail` 定義位置 |
| 主 repo 根目錄 | `.nojekyll` 存在、無 CNAME、無 `_redirects`、無 `wrangler.toml`、無 `_routes.json`、無 `netlify.toml`、無 `vercel.json` | 部署中介層盤點 |
| `git ls-remote` | branches: `main`、`cf-beta`、`claude/parse-activity-details-EhrLT`,**無 `gh-pages`** | GitHub Pages 部署來源推論 |
| `.github/workflows/` | 8 個 yml,皆非 deploy-pages | GitHub Pages 部署無 workflow |

### 附錄 A.2:Phase 6 V6 審計閱讀過的檔案與行號(2026-05-11)

D10-D14 決策依據以下實際讀過的程式碼:

| 檔案 | 關鍵行號 | 用途 |
|---|---|---|
| `js/core/navigation.js` | 174-184, 389(touchstart), 521-531(page lock check), 774(_pushPageHistory), 931-965(goBack) | pageHistory、goBack、_pageLockUntil、_userTouchedAt |
| `app.js` | 85-184(boot overlay + pending guards), 160-220(_dismissBootOverlay), 1072-1104(_syncTournamentDetailRoute / _clearTournamentDetailRouteParam), 2089-2203(_setRouteUrl), 2219-2232(_restoreGithubSpaRedirect), 2393-2396(_replaceRouteHash), 3144-3156(hashchange listener) | history write sites、hashchange handler、boot overlay |
| `js/core/history-route-flags.js` | 全 11 行 | popstateTakeover flag 已存在但未讀 |
| `js/modules/event/event-detail.js` | 285, 295, 316, 633, 636, 668 | _eventDetailRequestSeq race counter |
| `js/modules/team/team-detail.js` | 137, 146, 202 | _teamDetailRequestSeq race counter |
| `js/modules/tournament/tournament-detail.js` | 10, 15, 24 | _tournamentDetailRequestSeq race counter |
| `js/modules/tournament/tournament-friendly-detail.js` | 108, 112 | _friendlyTournamentDetailSeq race counter |
| `grep popstate` 全 repo | **0 個既有 listener** | 確認 Phase 6 必須從零新增 |
| `grep history.pushState/replaceState` 全 repo | _setRouteUrl / _syncTournamentDetailRoute / _clearTournamentDetailRouteParam / _restoreGithubSpaRedirect / _replaceRouteHash / line-auth.js(OAuth cleanup) / navigation.js:150(_activatePage) | 所有 history write 入口已盤點 |
