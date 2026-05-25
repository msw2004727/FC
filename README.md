# ToosterX

ToosterX 是一套以 LINE LIFF 為主要入口的台灣運動社群平台，核心涵蓋活動報名、俱樂部、賽事、課程、通知、後台管理、日誌診斷與 SEO 內容。

- 正式站: <https://toosterx.com>
- 目前前端快取版本: `0.20260525a`
- 專案狀態: Source-available, All Rights Reserved
- 主部署方式: push 到 `main` 後由 Cloudflare Pages / GitHub Pages 靜態部署流程發布
- 主要入口: LINE Mini App URL (`https://miniapp.line.me/2009525300-AuPGQ0sh`)；網站 deep link (`?event=` / `?team=` / `?tournament=` / `?profile=`) 與 OG 中繼頁 (`/event-share/{id}`) 會自動橋接到 Mini App

本 repo 是目前正式產品使用中的程式碼庫。主應用是無 bundler 的 Vanilla JavaScript SPA，搭配 Firebase Firestore、Firebase Storage、Firebase Cloud Functions、LINE LIFF、LINE Messaging API、Service Worker 與 GitHub Actions 測試流程。

---

## 產品定位

ToosterX 不是展示用 demo，而是面向實際運動社群營運的產品。主要使用場景是使用者在 LINE 內登入、報名活動、查看俱樂部、接收通知，管理者則在後台處理活動、人員、權限、日誌與營運資料。

目前功能重點:

- 活動探索、報名、取消、候補、同行者報名、團隊報名佔位、出席紀錄、放鴿子（未出席）統計與活動管理；活動詳情頁採用局部 DOM 更新，操作後不再跳頂。
- 活動黑名單（`event-blocklist`）：管理者可隱藏特定使用者對該活動的可見性與寫入入口；曾報名者尊重歷史保留可見性，並含完整 audit log。
- 俱樂部列表、俱樂部內頁（v2 版型）、成員角色、邀請 QR Code、俱樂部動態、俱樂部賽事紀錄與隊伍分享。
- 友誼賽 / 賽事系統，包含隊伍申請、名單、審核、退出與分享內容。
- 課程 / 教育功能，包含課程方案、報名、學生名單、家長綁定、簽到、月曆與課程通知。
- 個人資料、頭像 / 圖片上傳、個人儀表板（含主辦活動分頁、相關活動捷徑）、出席統計、EXP、成就、排行榜與遊戲化頁面（kickball、shot-game、color-cat 養成）。
- 後台使用者、角色、權限、活動紀錄、操作日誌、稽核日誌、錯誤日誌、通知模板、廣告、SEO 與系統診斷；含一次性權限稽核報告（`permission-audit`）。
- LINE Messaging API 推播、使用者 inbox、私訊（PM）、通知設定與可追蹤的稽核紀錄。
- SEO landing pages、blog 文章、多份動態 sitemap、robots、結構化資料、changelog 自動同步與 GSC 輔助腳本。
- 子專案：`inventory/`（庫存管理 PWA）、`valuation/`（估值頁）、`game-lab.html` / `GrowthGames.html`（遊戲實驗室），維護各自獨立版號。

---

## 技術架構

| 類別 | 現況 |
| --- | --- |
| 前端 | Vanilla JS、HTML、CSS，主應用沒有 bundler / build step |
| App shell | `index.html`、`app.js`、`pages/*.html`、`js/core/page-loader.js`、`js/core/script-loader.js` |
| 登入 | LINE LIFF + Firebase Auth / custom token flow |
| 資料庫 | Firebase Firestore |
| 檔案上傳 | Firebase Storage + image upload / cropper modules |
| 後端 | Firebase Cloud Functions v2，Node.js 22 |
| 推播 | LINE Messaging API，由 Cloud Functions 串接 |
| 快取 | Service Worker `sw.js` + 靜態資源 `?v=` cache busting |
| 靜態部署 | Cloudflare Pages 為主，GitHub Pages / 靜態發布路徑為輔 |
| CI | GitHub Actions，push / PR 到 `main` 會跑測試 |
| 測試 | Jest unit tests、Firebase Emulator rules tests、Playwright E2E smoke tests |

重要部署原則: 前端與靜態網站的發布方式是 `git push origin main`。不要用 Cloud Run 或 `gcloud` 部署前端。

---

## 專案結構

| 路徑 | 用途 |
| --- | --- |
| `index.html` | SPA 入口、boot overlay、CSS/JS 載入、LIFF/Firebase 啟動流程 |
| `app.js` | 主要 `App` 物件、初始化流程、共用 UI helper、導航整合 |
| `sw.js` | Service Worker、靜態快取、圖片快取與舊快取清理 |
| `css/` | 依頁面 / 功能拆分的樣式，目前 19 個 CSS 檔 |
| `pages/` | 由 `PageLoader` 載入的 HTML page fragments，目前 20 個頁面檔 |
| `js/config.js` | 全域常數、cache version、角色、權限、運動圖示、頁面載入策略 |
| `js/firebase-config.js` | Firebase SDK 初始化 |
| `js/firebase-service.js` | Firestore / cache 資料服務與 realtime listeners |
| `js/firebase-crud.js` | Firestore CRUD、圖片上傳、活動 / 俱樂部 / 賽事資料操作 |
| `js/api-service.js` | App 面向的 service facade，含 audit / error / operation log 與 Cloud Functions wrapper |
| `js/core/` | page loader、script loader、navigation、theme、button loading |
| `js/modules/` | 主要功能模組，多數以 `Object.assign(App, {...})` 掛入 |
| `functions/` | Firebase Cloud Functions 原始碼與套件設定 |
| `firestore.rules` | Firestore security rules，目前約 2,725 行 |
| `storage.rules` | Firebase Storage 圖片讀寫規則 |
| `tests/` | Unit、Firestore rules、E2E 測試 |
| `docs/` | 架構、測試覆蓋、調校參數、SEO log、活躍計畫、歸檔計畫與預覽檔 |
| `blog/` | SEO blog 文章頁 |
| `seo/` | SEO landing pages |
| `changelog/` | 公開更新紀錄（GitHub Actions 自動同步 commit 標題） |
| `inventory/`、`valuation/` | 獨立子專案（庫存管理 PWA、估值頁） |
| `scripts/` | 版本 bump、GSC、sitemap、changelog、migration、維護腳本 |
| `_headers`、`_routes.json`、`_worker.js` | Cloudflare Pages 設定（cache headers、路由、OG 中繼頁 worker） |
| `robots.txt`、`sitemap.xml`、`sitemap-events.xml`、`sitemap-teams.xml`、`sitemap-tournaments.xml`、`sitemap-static.xml` | 搜尋引擎爬取控制（多份動態 sitemap，由 `scripts/build-sitemap.js` 維護） |

文件整理規則:

- `docs/` 根目錄只放目前仍需要被優先閱讀的文件，例如架構、測試覆蓋、調校參數、SEO log、active workflow 或正在執行的計畫。
- `docs/archive/` 放已結束、歷史審計或不再主動執行的計畫書，保留追溯價值但不混在根目錄。
- `docs/completed/` 放已完成且仍有驗收價值的修復計畫。
- `docs/specs/` 放正式規格或長期設計文件。
- `docs/previews/` 放 AI 或人工用來快速呈現視覺結果的 HTML 預覽檔，例如 `demo.html`，預覽檔需避免被當成正式入口。
- 本機輸出如 `.gcloud/`、`debug.log`、`test-results/` 不進 Git。

依目前 repo 盤點:

- `git ls-files` 回傳 1,153 個受版控檔案。
- `js/` 底下目前有 297 個 JavaScript 檔。
- `js/modules/` 底下有 16 個主要功能模組資料夾與 31 個獨立模組檔。
- `tests/unit/` 目前有 151 個 unit test 檔。
- `functions/index.js` 目前有 68 個 exported Cloud Functions。
- `blog/` 目前有 23 個 HTML 文章 / 索引頁。
- `seo/` 目前有 10 個 HTML landing pages。

---

## 主要功能模組

主應用保留共享的 `App` facade，頁面或功能需要時再由 `ScriptLoader` 載入對應模組。

| 模組 | JS 檔數 | 職責 |
| --- | ---: | --- |
| `achievement` | 11 | 成就 registry、條件判定、徽章、稱號與後台管理 |
| `ad-manage` | 6 | Banner、贊助商、popup、浮動廣告、開機品牌與遊戲廣告管理 |
| `admin-seo` | 2 | SEO 儀表板與 GSC / SEO 資料載入 |
| `auto-exp` | 2 | 自動 EXP 規則 |
| `color-cat` | 45 | 個人場景、角色互動、MBTI 對話、場景 UI 與小遊戲邏輯 |
| `dashboard` | 20 | 後台 / 個人 dashboard、drilldown、usage metrics |
| `education` | 23 | 課程、報名、簽到、學生 / 家長 / 群組 / 月曆流程 |
| `event` | 46 | 活動列表、詳情、建立、管理、報名、候補、同行者、出席、黑名單、分享、地圖、留言 |
| `kickball` | 6 | 開球遊戲頁、物理、渲染、排行榜 |
| `message` | 17 | Inbox、後台訊息、通知設定、私訊（PM）對話、LINE push helper |
| `profile` | 9 | 個人資料、頭像、表單、卡片、歷史紀錄、統計、分享 |
| `scan` | 5 | QR scan camera / UI / process / family flow |
| `shot-game` | 10 | 蓄力射門 engine、renderer、physics、scoring、lab controls |
| `team` | 20 | 俱樂部列表、詳情（v2 版型）、表單、動態、邀請、分享、加入 |
| `tournament` | 19 | 賽事核心、詳情、渲染、管理、友誼賽名單 / 申請 / 分享 |
| `user-admin` | 10 | 使用者列表、角色、權限、EXP、修正、UID health、活動黑名單、權限測試報告 |

另有 31 個獨立模組分散於 `js/modules/` 根目錄，例如 `error-log`、`error-log-insights`、`error-log-diagnostics`、`admin-log-tabs`、`audit-log`、`announcement`、`attendance-notify`、`auto-exp-rules`、`banner`、`data-sync`、`favorites`、`game-log-viewer`、`game-manage`、`home-dashboard`、`home-game-rank-preview`、`home-next-activity`、`image-upload`、`image-cropper`、`leaderboard`、`multi-tab-guard`、`news`、`popup-ad`、`pwa-install`、`registration-audit`、`role`、`shop`、`site-theme`、`sync-status`、`translate`。

---

## 資料與安全模型

Firestore 是主要資料來源，前端再搭配 local cache、realtime listeners 與缺漏補抓流程。

重要不變式:

- Firestore `doc.id` 與資料內的 `data.id` 不一定能互換。修改活動、俱樂部、賽事資料時要確認呼叫端期待哪一種 ID。
- 使用者身分必須保持 UID 一致。任何影響使用者的寫入都要注意 Firebase Auth UID、LINE UID 與 app user document 的關係。
- 活動報名資料以 event subcollection 為主，例如 `events/{eventId}/registrations`。
- 權限是高風險區域。`INHERENT_ROLE_PERMISSIONS` 如果變更，必須同步檢查前端與 Functions 中的同名邏輯。
- Firestore rules 與 Cloud Functions 不應在 UI-only 修補中順手修改。只要動到 rules / functions，就要有相對應測試。
- Storage 寫入限制在已登入使用者的圖片上傳，並受大小與 content type 約束。
- 不要提交 secrets、private keys、service account、本機 Firebase config artifacts 或 `key(不上傳github)/` 內的內容。

目前日誌相關資料面:

- `operationLogs`: 一般後台 / 系統操作紀錄。
- `errorLogs`: 前端與系統錯誤診斷紀錄。
- `auditLogsByDay/{dayKey}/auditEntries`: 敏感操作與關鍵行為稽核紀錄。

---

## 分享與 deep link 規則

主要使用者群在 LINE 內，所有面向用戶的分享連結原則使用 LINE Mini App URL：

```
https://miniapp.line.me/2009525300-AuPGQ0sh?{event|team|tournament|profile}={id}
```

- 全域常數定義在 `js/config.js` 的 `MINI_APP_BASE_URL`。
- 根網址 `toosterx.com/?event=` / `?team=` / `?tournament=` / `?profile=` 由 `index.html` 中繼跳轉到 Mini App URL，向後相容舊連結。
- 活動「複製連結」例外採用 OG 中繼頁 `toosterx.com/event-share/{id}`：搜尋引擎與社群爬蟲停留讀取 OG 卡片，一般使用者自動進網站活動頁 `/events/{id}`，LINE 內開啟仍會進 Mini App。
- 詳細規範與分享功能遷移狀態請見 `CLAUDE.md` 的「分享功能設計規範」章節。

---

## 快取與版本規則

只要改到會影響使用者端 runtime 的 JS / CSS / HTML，就必須 bump 前端 cache version。

使用:

```bash
node scripts/bump-version.js
```

此腳本會同步:

- `js/config.js` 的 `CACHE_VERSION`
- `index.html` inline `var V`
- `index.html` 靜態資源的 `?v=...`
- `sw.js` 的 `CACHE_NAME`

runtime 修改後可用以下指令查核版本面是否一致:

```bash
rg -n "CACHE_VERSION|CACHE_NAME|var V='|v=0\\." js/config.js sw.js index.html
```

純文件修改，例如只更新 `README.md`，不需要 bump version，因為沒有改到使用者端載入的 JS / CSS / HTML runtime asset。

---

## 本機設定

安裝 root dependencies:

```bash
npm install
```

如果要修改或部署 Functions，再安裝 `functions/` dependencies:

```bash
cd functions
npm install
```

Node 版本現況:

- repo root 的 `.node-version` 目前是 `22`。
- GitHub Actions CI 目前使用 Node `24` 跑測試。
- Firebase Functions runtime 是 Node.js `22`，設定在 `firebase.json` 與 `functions/package.json`。

Firestore Emulator rules tests 需要 Java。CI 目前使用 Temurin Java 21。

---

## 本機執行

主應用沒有 frontend build command。需要瀏覽器測試時，從 repo root 啟動靜態伺服器即可。

範例:

```bash
python -m http.server 3000
```

然後開啟:

```text
http://127.0.0.1:3000
```

Playwright 預設 `BASE_URL` 是 `http://localhost:3000`。

---

## 測試指令

root scripts:

```bash
npm test
npm run test:unit
npm run test:unit:coverage
npm run test:rules
npm run test:rules:watch
npm run test:e2e
```

測試範圍:

| 指令 | 範圍 |
| --- | --- |
| `npm test` | Jest unit tests，目標是 `tests/unit/` |
| `npm run test:unit` | 同樣是 unit test suite，語意更明確 |
| `npm run test:unit:coverage` | Unit tests + coverage output |
| `npm run test:rules` | Firebase Emulator 中執行 Firestore security rules tests |
| `npm run test:rules:watch` | Firestore rules watch mode |
| `npm run test:e2e` | Playwright smoke journeys，目標是 `tests/e2e/` |

CI 目前會跑:

- Unit tests。
- Firestore rules tests。
- Playwright Chromium E2E smoke tests，CI 內會先啟動 Python static server。

修改 rules、permissions、報名流程、team feed、audit/error logs、Cloud Functions 或資料契約時，先跑最小相關測試，再跑較完整的 suite 後再 push。

`.github/workflows/` 內另有定期維護任務：`build-sitemap.yml`（動態 sitemap 重建）、`inject-hot-events.yml`（首頁摘要 inline）、`gsc-snapshot.yml` / `verify-gsc-read.yml`（Google Search Console 快照）、`submit-sitemap.yml`（sitemap 提交）、`sync-changelog.yml`（公開 changelog 同步）、`ci-usage-snapshot.yml`（用量快照）、`lighthouse.yml`（效能稽核）。這些工作流會自動 commit `[skip ci]` 結果，不會觸發測試循環。

---

## 部署

### 前端與靜態網站

commit 後 push 到 `main`:

```bash
git push origin main
```

這就是 Cloudflare Pages / GitHub Pages 靜態發布流程的觸發方式。

### Firestore Rules

只有在 `firestore.rules` 有變更且 rules tests 通過時才部署:

```bash
npm run test:rules
firebase deploy --only firestore:rules --project fc-football-6c8dc
```

### Cloud Functions
