---
paths:
  - "js/**"
  - "css/**"
  - "pages/**"
  - "functions/**"
  - "tests/**"
  - "scripts/**"
  - "index.html"
  - "app.js"
  - "sw.js"
  - "firestore.rules"
  - "storage.rules"
  - "firebase.json"
  - "_worker.js"
  - "_routes.json"
  - "*.html"
  - "**/*.html"
  - "inventory/**"
  - "valuation/**"
  - "permissions/**"
  - "roles/**"
  - "changelog/**"
  - "blog/**"
  - "seo/**"
  - "firestore.indexes.json"
  - "_headers"
  - "playwright.config.js"
  - "package.json"
  - ".github/workflows/**"
  - ".gitignore"
---

# 程式修改通則（背景、調查、外科手術式修改、程式風格）

> 本檔是 `CLAUDE.md` 的領域規則檔，以下 Rule ID 的 canonical 定義在此。條文中的「本檔」除非明確指特定檔案，一律指整個生效規則集（`CLAUDE.md` 加全部規則檔），標記的權威層級不因所在檔案而異。標記、權威順序與授權模式見 `CLAUDE.md` §0；修改本檔後必須跑 `node scripts/check-rules-integrity.js`。

> 2026-11-15 自 `CLAUDE.md` §0.3、§1、§3.1～3.3、§4.3 移入（原文照搬，取代原「全部常駐在 CLAUDE.md」，因只在調查或修改程式時才用得到，常駐浪費用量）。

## 1. 專案背景與目錄責任

### 1.1 穩定背景

ToosterX 是運動活動報名與管理系統，包含活動、俱樂部、錦標賽、教育課程、QR 簽到、個人統計與管理後台。

| 項目 | 穩定事實／真相來源 |
|------|--------------------|
| 前端 | Vanilla ES6、HTML、CSS 直接載入；沒有前端 bundler/build。npm 仍用於 tests、工具與 Functions |
| 資料 | Firebase Firestore；活動報名等採 `events/{docId}/...` 子集合 |
| 驗證 | LINE LIFF + Firebase Auth |
| 後端 | Firebase Cloud Functions v2；runtime 查 `functions/package.json`、`firebase.json` |
| 離線 | `sw.js` Service Worker |
| 部署 | main push 保守視為可能觸發外部 Cloudflare／GitHub Pages integration；repo 不能證明平台當前設定，執行前即時查。Functions／Rules 是不同 lane |

- **R-CTX-002 [B/HARD]**：`ModeManager.getMode()` 可作既有 localStorage key namespace；不表示存在第二環境。
- **R-CTX-003 [B/HARD]**：Firebase browser config／公開 client identifier 與 server secret 分類處理；`js/firebase-config.js`、`js/config.js` 的公開 client 設定不能證明 server secret 可硬編。

### 1.2 目錄責任

| 路徑 | 責任 |
|------|------|
| `index.html`、`app.js` | 主入口與 App 核心 |
| `js/core/` | navigation、loader、history、theme 等基礎設施 |
| `js/modules/` | 功能模組；同功能放對應子資料夾 |
| `pages/` | 動態載入 HTML fragments |
| `css/` | 主題與元件樣式 |
| `functions/` | Cloud Functions |
| `firestore.rules` | Firestore 存取邊界 |
| `tests/` | unit、Rules、E2E、contract tests |
| `scripts/` | 可追蹤維護／驗證腳本 |
| `.github/` | CI 與 automation |
| `docs/`、`tools/` | local-only 知識與受控診斷工具 |

- **R-CTX-006 [C/DEFAULT]**：結構用 `rg --files` 即時探索，不以歷史計數判斷漏檔。

### 永久地雷（原 §0.3）

| 地雷 | 典型後果 | Canonical Rule |
|------|----------|----------------|
| 新舊活動 ID 橋接 | 統計歸零、跨集合 join 失敗 | R-ID-007～R-ID-011 |
| UID 欄位差異 | 身分誤判、出席統計歸零 | R-ID-002～R-ID-003、R-STAT-002～R-STAT-003 |
| `INHERENT_ROLE_PERMISSIONS` 雙端同步 | 前後端授權靜默分歧 | R-IAM-008 |
| 報名／候補原子操作 | 超收、current 覆蓋、漏遞補 | R-REG-001～R-REG-016 |
| Firestore 初始化參數 | 費用暴增、多分頁衝突 | 搜尋 memory 的 `synchronizeTabs` |
| Callable region | 偽裝成 CORS 的呼叫失敗 | R-CF-001 |
| 泛用 owner／delegate fallback | 委託人被錯誤擴權 | R-IAM-010～R-IAM-013 |
| `attendanceRecords.uid` 誤用 | 出席率、放鴿子統計錯誤 | R-STAT-002～R-STAT-003 |
| cache 版號不同步 | 新舊 JS／HTML 混載 | R-REL-001～R-REL-009 |
| popstate／sentinel state 不完整 | 返回循環、退出 LIFF、詳情 ID 遺失 | R-NAV-011～R-NAV-020 |

## 3. 執行、精簡與程式風格

### 3.1 調查與除錯

- **R-EXEC-001 [B/HARD]**：修 bug 前讀完整鏈：入口、import、caller、callee、資料來源、權限、tests 與設計；用 `rg` 搜同類及所有呼叫端。
- **R-EXEC-002 [B/HARD]**：根因需 code、重現、log 或 test 證據；不得猜。證據不足可提最小觀測 log，但新增 runtime log 仍需修改授權。
- **R-EXEC-003 [B/HARD]**：實作前表述核心假設；可由 repo 查證者先查。任何假設無法從既有 code／config／tests 確認時，先向使用者釐清，禁止靜默猜測。
- **R-EXEC-004 [B/HARD]**：需求有多種合理解讀時，列出各解讀及造成的差異讓使用者選擇，禁止自行挑一個就實作。
- **R-EXEC-005 [B/HARD]**：有更簡單、低風險或符合既有模式的方案時主動提出；會破壞鎖定規則、ID、編碼、相容性或安全時具體反駁。
- **R-EXEC-006 [B/HARD]**：修復後搜尋其他同模式；未授權的無關問題只回報。

### 3.2 外科手術式修改

- **R-EXEC-010 [C/DEFAULT]**：以正確解題的最少程式碼為目標，不加未要求功能、選項、參數、抽象或預留設計。
- **R-EXEC-011 [C/DEFAULT]**：同一信任邊界已證明的不變量不加無效防禦；網路、Auth、storage、外部輸入與 server boundary 不可省略驗證／錯誤處理。
- **R-EXEC-012 [B/HARD]**：只改必要部分；禁止順手格式化、重排註解、改無關命名、統一偏好或清除既有 dead code。
- **R-EXEC-013 [C/DEFAULT]**：沿用目標檔風格。風格統一或大規模整理須獨立任務／commit。
- **R-EXEC-014 [B/HARD]**：本次造成的孤兒 import／variable／function／CSS 必須清；既有孤兒保留並回報。
- **R-EXEC-015 [B/HARD]**：diff 每一行須直接對應需求、必要驗證或本次造成的清理。
- R-EXEC-016（A/HARD 鎖定檔）定義在 `CLAUDE.md` §2，常駐。

### 3.3 程式風格與信任邊界

- **R-CODE-001 [B/HARD]**：新增或實質改寫的業務流程統一使用 `async/await`，不得新增 `.then()` chain；未觸及的 legacy chain 可保留。若修改既有 Promise DOM callback，仍須遵守 R-NAV-005。
- R-CODE-002（A/HARD 不可信內容寫 HTML）定義在 `CLAUDE.md` §2，常駐。
- **R-CODE-003 [B/HARD]**：模組資料操作走 `ApiService`，不得任意操作 `FirebaseService._cache`。R-REG-008／010 所要求且已有測試的既有 registration／optimistic cache 同步可保留；新路徑優先封裝既有 service／core helper，禁止擴散 direct mutation。
- **R-CODE-004 [B/HARD]**：新模組必須用 `Object.assign(App, { ... })` 掛載，不建立新全域變數。
- **R-CODE-005 [B/HARD]**：改 CSS／JS／HTML 前確認 LINE WebView、Chrome、Safari 相容；必要時保留 `-webkit-backdrop-filter`、`dvh` 的 `vh` fallback、以 `replace(/…/g)` 取代不相容 `replaceAll`、clipboard 降級。

### Tracked runtime 與 local-only docs

- **R-DOC-006 [B/HARD]**：tracked runtime／CI 不得依賴 local-only docs 才能正確執行；必要契約須 self-contained 或移至 tracked canonical spec。已知 `functions/scoreboard-translations.js` 參照不存在的 `docs/scoreboard-translation-workflow-plan.md`，在專門任務修正前列為 drift，不假裝可讀。
