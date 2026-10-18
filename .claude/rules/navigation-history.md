---
paths:
  - "app.js"
  - "index.html"
  - "js/core/**"
  - "js/modules/**"
  - "_worker.js"
  - "_routes.json"
  - "404.html"
  - "tests/unit/*route*.test.js"
  - "tests/unit/*popstate*.test.js"
  - "tests/unit/*history*.test.js"
---

# Async show* 與 History／popstate

> 本檔是 `CLAUDE.md` 的領域規則檔，以下 Rule ID 的 canonical 定義在此。條文中的「本檔」除非明確指特定檔案，一律指整個生效規則集（`CLAUDE.md` 加全部規則檔），標記的權威層級不因所在檔案而異。標記、權威順序與授權模式見 `CLAUDE.md` §0；修改本檔後必須跑 `node scripts/check-rules-integrity.js`。

## 12. Exact Contract Registry：Async 與 History

### 12.1 Async `show*`

- **R-NAV-001 [B/HARD]**：新增 async detail／list／form `showXxx`，同檔 App 建 `_xxxRequestSeq`；開頭遞增保存。
- **R-NAV-002 [B/HARD]**：每個 `await` 後 check；stale 回 `{ ok:false, reason:'stale' }`，不寫 state／DOM。
- **R-NAV-003 [B/HARD]**：`showPage` 後同查 seq 與 `currentPage`。
- **R-NAV-004 [B/HARD]**：stale return 前提供 `window._raceDebug` 或 localStorage `_raceLog` 開啟的 debug log。
- **R-NAV-005 [B/HARD]**：helper 有 await + DOM write 時接受 requestSeq 並內查；legacy `.then()` DOM callback 開頭也查 seq。
- **R-NAV-006 [A/HARD]**：stale 清相機、timer、listener；同 page 多入口共用 counter。
- **R-NAV-007 [B/HARD]**：state mutation：同步 render hook 會讀時先清 null、stale 後寫；外部 stale guard 會讀時延後；其他可開頭寫。
- **R-NAV-008 [C/DEFAULT]**：參考 `js/modules/event/event-detail.js#showEventDetail`、`js/modules/education/edu-checkin.js`／`edu-checkin-scan.js`、`edu-student-list.js#showEduStudentList`；改 event detail 同讀 `js/core/navigation.js` lazy facade 與實作。

### 12.2 popstate／sentinel

- **R-NAV-011 [A/HARD]**：一般 `history.replaceState/pushState` 完整 state 為 `{ source:'sportshub', pageId:'page-xxx', id?, fallbackPageId? }`；sentinel 的 canonical 例外為 `{ source:'sportshub', sentinel:true, fallbackPageId:'page-home' }`，可不含 `pageId`。目標契約禁止 null state。**已知 drift**：`app.js#_clearDeepLinkQueryParams` 與 `index.html` inline 同名實作在 `preserveHistoryState:true` 且 `history.state` 為空時仍會 `replaceState(null, ...)`；不得複製，專門修復時改用有效 current-route state fallback 並跑 history／route tests。
- **R-NAV-012 [A/HARD]**：popstate 呼 `showPage`／detail 帶 `bypassPageLock:true`、`skipPageHistory:true`、`suppressHashSync:true`、`allowGuest:true`；sentinel branch 也全帶。
- **R-NAV-013 [B/HARD]**：`showEventDetail`、`showTeamDetail`、`showTournamentDetail` 與 friendly variants 向內 `showPage` 透傳前三 option；`allowGuest` 在 detail login guard 消耗，不傳 `showPage`。
- **R-NAV-014 [A/HARD]**：route intent 統一 `App._resolveRouteIntent(opts)`，禁複製 fallback。
- **R-NAV-015 [A/HARD]**：順序：合法非 sentinel state → legacy query → clean path → validated hash → home；改順序只動 helper。
- **R-NAV-016 [A/HARD]**：sentinel 雙寫：先 `replaceState(sentinel,'','/')`，再 `pushState(currentState,'',originalUrl)`；禁只 push sentinel。
- **R-NAV-017 [A/HARD]**：sentinel 只 LIFF client 或 PWA standalone；一般瀏覽器外部進入保留原生返回，禁 `document.referrer` 強攔。
- **R-NAV-018 [B/HARD]**：新增 history／popstate path 搜完整 state、四 options、雙寫、觸發範圍、`fallbackPageId`。
- **R-NAV-019 [B/HARD]**：canonical：`app.js#_resolveRouteIntent`、`_buildCurrentRouteState`、`_maybePushBootSentinel`、`_setRouteUrl`、`_syncTournamentDetailRoute`、`window.addEventListener('popstate', ...)`；禁行號。
- **R-NAV-020 [B/HARD]**：跑 popstate／route tests；查 `docs/archive/history-api-dual-route-plan.md`、`docs/archive/history-route-decisions.md` D6／D10–D14。

---

