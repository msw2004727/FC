---
paths:
  - "sw.js"
  - "app.js"
  - "js/**"
  - "css/**"
  - "pages/**"
  - "index.html"
  - "scripts/bump-version.js"
  - "_worker.js"
  - "_routes.json"
  - "_headers"
  - "404.html"
  - "manual.html"
  - "privacy.html"
  - "terms.html"
  - "game-lab.html"
  - "GrowthGames.html"
  - "permissions/**"
  - "roles/**"
  - "blog/**"
  - "seo/**"
  - "inventory/**"
---

# Release 與 Service Worker

> 本檔是 `CLAUDE.md` 的領域規則檔，以下 Rule ID 的 canonical 定義在此。條文中的「本檔」除非明確指特定檔案，一律指整個生效規則集（`CLAUDE.md` 加全部規則檔），標記的權威層級不因所在檔案而異。標記、權威順序與授權模式見 `CLAUDE.md` §0；修改本檔後必須跑 `node scripts/check-rules-integrity.js`。

## 6. Release 與 Service Worker

### 6.1 主站 cache 版號

- **R-REL-001 [B/HARD]**：格式 `0.YYYYMMDD{suffix}`。台北當日第一次 release 無 suffix，同日依 `a...z, za...` 遞增；跨日重置。
- **R-REL-002 [B/HARD]**：只用 `node scripts/bump-version.js` 自動遞增，或傳入符合 `^0\.\d{8}[a-z]*$` 的指定版號；呼叫者先驗證，因腳本目前不保證拒絕所有錯誤 argv。
- **R-REL-003 [B/HARD]**：腳本同步四類：`js/config.js#CACHE_VERSION`、`sw.js#CACHE_NAME`、`index.html` inline `var V`、符合 app 版號格式的 asset `?v=`；其他 query version 不誤改。
- **R-REL-004 [B/HARD]**：`page-loader.js` 自動用 `CACHE_VERSION`，不人工同步。
- **R-REL-005 [B/HARD]**：只有腳本壞才手改四處，之後搜尋驗證一致；正常禁止逐檔手改。
- **R-REL-006 [B/HARD]**：主站 runtime 變更可先本機 commit 暫不 bump，但不得 push／deploy；真正上線批次含 JS／HTML／CSS／pages／SW 時只 bump 一次。
- **R-REL-007 [B/HARD]**：純文件、註解、tests-only、Functions-only、Rules-only 不 bump。`game-lab.html`、`GrowthGames.html`、`inventory/index.html` 各自版號，只改自身依賴才更新。
- **R-REL-008 [C/DEFAULT]**：非緊急 release 可台北約 22:00 彙整；hotfix 不等待，仍需 bump、tests、review、push 授權。
- **R-REL-009 [B/HARD]**：`manual.html`、`privacy.html`、`terms.html`、`permissions/`、`roles/`、`blog/`、`seo/` 等獨立 network-first 內容頁，若只改可見文案、連結、metadata 或 JSON-LD 事實，且不改 executable inline JS／CSS、shared asset、route、互動或 app shell，視為內容文件：不更新主站 cache 版號；仍須跑相關 static／SEO tests，並依 R-QA-010～013 檢查受影響頁面。超出此邊界即回到 R-REL-006。

### 6.2 SW 不變式

- **R-REL-010 [B/HARD]**：修改 `sw.js` 保留分級策略；常數與 precache 以 source 為準，不複製易過期容量／天數。
- **R-REL-011 [B/HARD]**：`/runtime-config.json` no-store；Firebase Storage 圖片 SWR（查 `MAX_IMAGE_CACHE`、`MAX_IMAGE_AGE_MS`）；HTML/navigation network-first；外部 Firebase／CDN network-first；其他同源非 HTML cache-first；外來 app 版號 miss 阻止跨版混載。
- **R-REL-012 [B/HARD]**：一般版更保留設計上持續的前一版 runtime、圖片、display cache；只有明確 `clear=1` reset 全清。不得宣稱每版清全部 cache。
- **R-REL-013 [A/HARD]**：禁止 HTML cache-first。
- **R-REL-014 [B/HARD]**：禁止把任何未被 `bump-version.js` 管理的新資源加入 `STATIC_ASSETS`，不分 JS、CSS、JSON、字型、圖片或其他類型；避免版號更新後舊資源永久殘留。
- **R-REL-015 [A/HARD]**：`STATIC_ASSETS` 禁外部 CDN；禁止快取 `/sw.js` 本身。
- **R-REL-016 [B/HARD]**：禁止直接改 `CACHE_NAME`，只能 bump script。
- **R-REL-017 [B/HARD]**：新增／改 clean route 同步 `_worker.js#getSpaRouteKind`、`sw.js#isSpaNavigationPath`、`404.html`、`_routes.json`、適用 `_headers`、`app.js#_resolveRouteIntent`／`_setRouteUrl`，並跑 route-meta／hosting／worker／SW tests。

---

