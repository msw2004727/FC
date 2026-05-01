# ToosterX

ToosterX 是一套以 LINE LIFF 為主要入口的台灣運動社群平台，核心涵蓋活動報名、俱樂部、賽事、課程、通知、後台管理、日誌診斷與 SEO 內容。

- 正式站: <https://toosterx.com>
- 目前前端快取版本: `0.20260501`
- 專案狀態: Source-available, All Rights Reserved
- 主部署方式: push 到 `main` 後由 Cloudflare Pages / GitHub Pages 靜態部署流程發布

本 repo 是目前正式產品使用中的程式碼庫。主應用是無 bundler 的 Vanilla JavaScript SPA，搭配 Firebase Firestore、Firebase Storage、Firebase Cloud Functions、LINE LIFF、LINE Messaging API、Service Worker 與 GitHub Actions 測試流程。

---

## 產品定位

ToosterX 不是展示用 demo，而是面向實際運動社群營運的產品。主要使用場景是使用者在 LINE 內登入、報名活動、查看俱樂部、接收通知，管理者則在後台處理活動、人員、權限、日誌與營運資料。

目前功能重點:

- 活動探索、報名、取消、候補、同行者報名、團隊報名佔位、出席紀錄、未出席統計與活動管理。
- 俱樂部列表、俱樂部內頁、成員角色、邀請 QR Code、俱樂部動態、俱樂部賽事紀錄與隊伍分享。
- 友誼賽 / 賽事系統，包含隊伍申請、名單、審核、退出與分享內容。
- 課程 / 教育功能，包含課程方案、報名、學生名單、家長綁定、簽到與課程通知。
- 個人資料、頭像 / 圖片上傳、個人儀表板、出席統計、EXP、成就、排行榜與遊戲化頁面。
- 後台使用者、角色、權限、活動紀錄、操作日誌、稽核日誌、錯誤日誌、通知模板、廣告、SEO 與系統診斷。
- LINE Messaging API 推播、使用者 inbox、通知設定與可追蹤的稽核紀錄。
- SEO landing pages、blog 文章、sitemap、robots、結構化資料與 GSC 輔助腳本。

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
| `css/` | 依頁面 / 功能拆分的樣式，目前 17 個 CSS 檔 |
| `pages/` | 由 `PageLoader` 載入的 HTML page fragments，目前 20 個頁面檔 |
| `js/config.js` | 全域常數、cache version、角色、權限、運動圖示、頁面載入策略 |
| `js/firebase-config.js` | Firebase SDK 初始化 |
| `js/firebase-service.js` | Firestore / cache 資料服務與 realtime listeners |
| `js/firebase-crud.js` | Firestore CRUD、圖片上傳、活動 / 俱樂部 / 賽事資料操作 |
| `js/api-service.js` | App 面向的 service facade，含 audit / error / operation log 與 Cloud Functions wrapper |
| `js/core/` | page loader、script loader、navigation、theme、button loading |
| `js/modules/` | 主要功能模組，多數以 `Object.assign(App, {...})` 掛入 |
| `functions/` | Firebase Cloud Functions 原始碼與套件設定 |
| `firestore.rules` | Firestore security rules，目前約 1,481 行 |
| `storage.rules` | Firebase Storage 圖片讀寫規則 |
| `tests/` | Unit、Firestore rules、E2E 測試 |
| `docs/` | 架構、測試覆蓋、調校參數、遷移計畫、SEO log 等文件 |
| `blog/` | SEO blog 文章頁 |
| `seo/` | SEO landing pages |
| `scripts/` | 版本 bump、GSC、sitemap、migration、維護腳本 |
| `_headers` | Cloudflare Pages cache 與 robots headers |
| `robots.txt`、`sitemap.xml` | 搜尋引擎爬取控制 |

依目前 repo 盤點:

- `rg --files` 回傳 982 個專案檔案。
- `js/` 底下目前有 267 個 JavaScript 檔。
- `js/modules/` 底下有 16 個主要功能模組資料夾。
- `tests/unit/` 目前有 86 個 unit test 檔。
- `functions/index.js` 目前有 52 個 exported Cloud Functions。
- `blog/` 目前有 15 個 HTML 文章 / 索引頁。
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
| `education` | 21 | 課程、報名、簽到、學生 / 家長 / 群組 / 月曆流程 |
| `event` | 39 | 活動列表、詳情、建立、管理、報名、候補、同行者、出席、分享 |
| `kickball` | 6 | 開球遊戲頁、物理、渲染、排行榜 |
| `message` | 10 | Inbox、後台訊息、通知設定、LINE push helper |
| `profile` | 9 | 個人資料、頭像、表單、卡片、歷史紀錄、統計、分享 |
| `scan` | 5 | QR scan camera / UI / process / family flow |
| `shot-game` | 10 | 蓄力射門 engine、renderer、physics、scoring、lab controls |
| `team` | 16 | 俱樂部列表、詳情、表單、動態、邀請、分享、加入 |
| `tournament` | 19 | 賽事核心、詳情、渲染、管理、友誼賽名單 / 申請 / 分享 |
| `user-admin` | 8 | 使用者列表、角色、權限、EXP、修正、UID health、黑名單 |

另有獨立模組，例如 `error-log`、`admin-log-tabs`、`favorites`、`image-upload`、`image-cropper`、`leaderboard`、`multi-tab-guard`、`pwa-install`、`registration-audit`、`role`、`shop`、`sync-status`、`translate`。

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

只有在 `functions/` 或 callable / onRequest / onSchedule 行為有變更時才部署:

```bash
firebase deploy --only functions --project fc-football-6c8dc
```

低風險情境下可優先使用 targeted function deploy。

---

## SEO 維護面

公開 SEO 面包含:

- `seo/*.html` 運動 / 地區 landing pages。
- `blog/**/*.html` 規則、裝備、指南類內容。
- `sitemap.xml`。
- `robots.txt`。
- `_headers`。
- 靜態頁內的 JSON-LD。
- `docs/seo-log.md`，用來記錄 SEO / GSC 修補與決策。
- `scripts/gsc-snapshot.js`、`scripts/submit-sitemap.js` 等 GSC helper。

修改 SEO 頁面時:

- 驗證 JSON-LD，特別是 FAQ answer 內嵌引號。
- 新增或移除公開頁時同步更新 `sitemap.xml`。
- 維持 canonical URL 與 `hreflang` 一致。
- 有意義的 SEO / GSC 修補要記錄到 `docs/seo-log.md`。

---

## AI 與維護者工作規則

開始任何分析、規劃、修改、測試、提交或回覆前，必須先閱讀 `CLAUDE.md`。`AGENTS.md` 只保留入口說明，主規則來源是 `CLAUDE.md`。

維護原則:

- 變更範圍要貼近需求，不順手重構無關區域。
- 不要 revert 不屬於自己這次工作的既有變更。
- 優先沿用既有 helper、資料契約與模組風格。
- 搜尋檔案與內容優先使用 `rg`。
- runtime 前端變更要使用 `scripts/bump-version.js`。
- 修改行為、權限、rules、日誌、報名流程或資料契約時，要補或更新測試。
- 避免用 shell 直接重寫 repo 檔案，手動編輯應使用 patch。
- 編輯中文內容要保留 UTF-8，並檢查是否出現 mojibake。
- 重要 bug 修補與長期教訓要更新 `docs/claude-memory.md`。
- SEO 修補要更新 `docs/seo-log.md`。

常用文件:

- `CLAUDE.md`: 專案主規則與 SOP。
- `docs/architecture.md`: 架構與模組說明。
- `docs/structure-guide.md`: 功能模組拆分指南。
- `docs/test-coverage.md`: 測試覆蓋參考。
- `docs/tunables.md`: timing、limit、threshold、load order、sequence effects。
- `docs/seo-log.md`: SEO 與 GSC 變更紀錄。
- `docs/claude-memory.md`: 重要修補歷史與長期注意事項。

---

## License

本專案採 Source-available, All Rights Reserved。詳細條款請見 [`LICENSE`](LICENSE)。

簡要說明：

- 原始碼公開僅供檢視、參考、資安審查或合作評估。
- GitHub 上可見、可閱讀、可使用 GitHub 平台內建 fork / view 機制，不代表授權重製、散布、商用、改作、重新部署、自架、白牌化、建立競品或取用程式碼片段到其他產品。
- 任何外部使用都需要專案所有人的明確書面授權。

Copyright 2024-2026 ToosterX. All rights reserved.
