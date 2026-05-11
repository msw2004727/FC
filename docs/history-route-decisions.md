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

reviewer 確認後,把 [ ] 改為 [x] 並在「變更歷史」加日期 + reviewer。

---

## 3. Phase 0 完成判定

Phase 0 完成的條件:

- [x] D1-D9 全數有 reviewer 簽字確認
- [x] 任何「不選預設答案」的決策已寫入「變更歷史」並更新「預設答案」欄位
- [x] 計劃書 `docs/history-api-dual-route-plan.md` 已對照本決策更新(若 reviewer 改變了答案)
- [x] 進入 Phase 0.5 前置重構

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
