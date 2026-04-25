# ToosterX — Claude Code 專案指引

> **Last Reviewed: 2026-04-21**（每 2 個月審閱一次，或重大架構重構時立即審閱）

<!--
  結構文件交叉引用（任一檔案的結構描述更新時，必須同步更新以下所有檔案）：
  - docs/architecture.md       ← 完整架構圖 + 模組清單 + Mermaid 圖
  - docs/structure-guide.md    ← 中文功能導覽圖（給人看的，附功能解釋）
  - CLAUDE.md                  ← 目錄結構概覽(§ 目錄結構)
-->

## 目錄

| 類別 | 章節 |
|------|------|
| 📖 **背景** | 專案概述 · 技術架構 · 目錄結構 · 架構文件 |
| ⚠️ **永久地雷** | 見下方「永久地雷清單」 |
| 🔧 **日常規範** | 快取版本號 · Service Worker 策略 · 模組建立 · 模組化演進 · 新增功能 · 測試與 CI |
| ⛓️ **開發守則** | 除錯規則 · 開發守則（4 子節：編碼風格 / 實作前思考 / 程式碼精簡 / 外科手術式修改） |
| 🔒 **鎖定保護** | 報名系統 · 統計系統 · Firestore Rules · Cloud Functions |
| 🌐 **業務規範** | 分享功能 · 活動可見性 |
| 📝 **流程** | 修復日誌 · SEO 日誌 · 自動部署 · 計劃與建議回覆 · 回覆結尾白話總結 |
| 🛠️ **編碼** | 編碼與亂碼規範 |

## 永久地雷清單（讀前必看）

歷史上**重複踩過**的坑，修改相關檔案前必須先查閱對應章節或歷史紀錄：

| 地雷 | 症狀 | 詳情位置 |
|------|------|---------|
| **活動 ID 雙軌制**（`doc.id` vs `data.id`） | 統計歸零、跨集合 join 失敗 | §程式碼規範 最末條 |
| **UID 欄位對照差異** | 統計歸零、身份誤判 | §統計系統保護規則 背景知識 |
| **`INHERENT_ROLE_PERMISSIONS` 兩地同步** | 前後端權限靜默分歧 | §每次新增功能時的規範 第 8 條 |
| **報名系統原子操作** | 人數覆蓋、超收、候補漏遞補 | §報名系統保護規則 |
| **Firestore 初始化參數變更** | 費用爆量、多 tab 衝突 | `docs/claude-memory.md` 搜 `synchronizeTabs` |
| **Callable Function region/CORS** | 一天內連犯兩次 | `docs/claude-memory.md` 搜 `Callable` |
| **`hasPermission` 守衛無 fallback** | 看得到按鈕但點不動 | §每次新增功能時的規範 第 8 條子項 |
| **`attendanceRecords.uid` 欄位誤用** | 出席統計誤判 | §統計系統保護規則 背景知識 |

## 專案概述

**ToosterX** 是一套運動活動報名與管理系統，提供用戶報名活動（PLAY / 友誼 / 教學 / 觀賽）、組建俱樂部、參加錦標賽、QR Code 簽到簽退及個人數據統計等功能。管理端提供活動管理、用戶管理、EXP 系統、成就徽章、廣告投放等後台能力。

- **部署平台**：自有域名 `toosterx.com`（Cloudflare Pages）、GitHub Pages（`msw2004727.github.io`）
- **使用者驗證**：LINE LIFF 登入
- **Firestore 架構**：子集合（`events/{docId}/registrations` 等），2026-04-12 遷移完成

---

## 技術架構

| 類別 | 技術 |
|------|------|
| 前端 | Vanilla JS (ES6+)、HTML5、CSS3，**無框架、無 build 流程** |
| 資料庫 | Firebase Firestore（子集合架構：`events/{docId}/registrations` 等，2026-04-12 Phase 4b 完成） |
| 儲存 / 驗證 | Firebase Storage + LINE LIFF SDK |
| 推播 / 後端 | LINE Messaging API + Firebase Cloud Functions (Node.js 22) |
| 離線支援 | Service Worker（sw.js） |

**無 npm / webpack / build**：前端為純靜態，直接以 `<script>` 載入，無需編譯。
**API Keys 直接硬編碼**：Firebase 設定在 `js/firebase-config.js`，LINE / 模式密碼在 `js/config.js`，參考 `.env.example` 對照。

**執行環境**：
- **僅有 Production 環境**（Demo 模式已於 2026-04 移除，`ModeManager.getMode()` 硬編碼返回 `'production'`）
- 用戶回報的所有問題與需求一律以正式版為前提
- 不存在 Demo 分支邏輯，`ApiService` 直接讀取 `FirebaseService._cache`

---

## 目錄結構（概覽）

> 完整模組關係圖、模組說明表與初始化流程請見 [docs/architecture.md](docs/architecture.md)

```
FC-github/
├── index.html              # 主入口
├── app.js                  # App 核心物件
├── sw.js                   # Service Worker
├── css/                    # 樣式（14 個 CSS）
├── js/
│   ├── config.js           # 全域常數、ModeManager
│   ├── i18n.js             # 多語系
│   ├── firebase-config.js  # Firebase SDK 初始化
│   ├── firebase-service.js # 快取優先資料層
│   ├── firebase-crud.js    # CRUD 操作
│   ├── api-service.js      # Demo / Prod 抽象層
│   ├── line-auth.js        # LINE LIFF 登入
│   ├── core/               # 基礎設施（4 個）
│   └── modules/            # 功能模組（14 子資料夾 + 24 獨立檔案）
│       ├── event/          # 活動系統（30）：列表、詳情、報名、建立、管理、分享
│       ├── team/           # 俱樂部系統（16）：列表、詳情、表單、動態牆、分享、helpers/stats/builders/validate/roles/invite
│       ├── tournament/     # 賽事系統（16）：渲染、詳情、管理、友誼賽、helpers/builders/state
│       ├── profile/        # 個人資料（9）：核心、資料、名片、分享
│       ├── message/        # 訊息系統（9）：渲染、操作、收件匣、管理員
│       ├── achievement/    # 成就系統（10）：registry / evaluator / badges 等
│       ├── education/      # 教育型俱樂部（21）：分組、學員、課程、報名、簽到、行事曆
│       ├── color-cat/      # 養成角色系統（45）：角色、戰鬥、敵人、場景、AI、MBTI、對話
│       ├── shot-game/      # 射門遊戲（10）：引擎、物理、渲染、計分
│       ├── kickball/       # 踢球遊戲（6）：物理、渲染、排行榜
│       ├── scan/           # QR 掃描（5）：掃描、處理、家庭成員
│       ├── dashboard/      # 儀表板（6）：管理員、個人、報表分享、用量
│       ├── ad-manage/      # 廣告管理（6）：輪播、浮動、贊助、小遊戲、品牌開機
│       ├── user-admin/     # 用戶後台（5）：列表、EXP、角色、補正、權限說明
│       └── [24 獨立模組]   # banner / shop / leaderboard / role / pwa-install 等
├── pages/                  # HTML 片段（18 個）
├── docs/                   # 專案文件
└── functions/              # Cloud Functions
```

---

## 快取版本號規則（每次修改必做）

### 版號格式（強制）

**格式：`0.YYYYMMDD{suffix}`**

例：
- `0.20260422`（當天第一次部署，無後綴）
- `0.20260422a`（當天第二次部署）
- `0.20260422b`（當天第三次部署）
- ...
- `0.20260422z`
- `0.20260422za`（第 27 次部署）
- `0.20260423`（隔天第一次部署，**重置無後綴**）

**跨日自動重置**：`bump-version.js` 會取台北時間今天日期，若與 existing 版號日期不同（隔天）則重置為今天無後綴，不會沿用舊日期一直遞增後綴。

### 更新方式（強制使用腳本）

```bash
node scripts/bump-version.js              # 自動遞增（跨日重置、同日遞增後綴）
node scripts/bump-version.js 0.20260430a  # 指定版號（必須符合新格式）
```

此腳本**一次同步更新 4 處**版號，禁止手動逐檔修改（容易漏改 `var V`）。

### 4 個版號位置（原理說明，不需手動改）

| # | 檔案 | 位置 | 說明 |
|---|------|------|------|
| 1 | `js/config.js` | `CACHE_VERSION` 常數 | 動態載入的 pages/*.html 和 js 模組用此值做 cache busting |
| 2 | `index.html` | 所有 `?v=` 參數 | CSS + JS 靜態資源的 cache busting |
| 3 | `index.html` | `var V='...'`（inline `<script>` 內，與 `CACHE_VERSION` 共用版號字串） | **快取自動清除觸發器**——版本號變更時自動清除所有 SW 快取並重新下載 |
| 4 | `sw.js` | `CACHE_NAME` | Service Worker 快取群組名稱，必須與 `var V` 同步，否則舊快取不會被清除 |

**四個值必須完全一致**（`bump-version.js` 會保證這點）。版號格式見上方「版號格式」章節。

> `page-loader.js` 的 fetch 會自動讀取 `CACHE_VERSION`，不需額外改。

### 腳本失效時的緊急備援（不推薦）

若 `bump-version.js` 壞掉無法執行，才手動改 — 必須 4 處全改並**跑 grep 驗證一致**：

```bash
grep -rn "CACHE_VERSION\|CACHE_NAME\|var V='" js/config.js sw.js index.html
```

### 獨立頁面不需同步

`game-lab.html`、`GrowthGames.html`、`inventory/index.html` 使用各自的版號系統，**只在修改它們自己的 JS/CSS 時才需要更新**，不需要跟主站同步。

### 版號更新時機（強制）

每次 commit 包含 JS、HTML 或 CSS 的修改，都**必須在同一個 commit 內**同步更新版號。禁止先 commit 程式碼再另開 commit 補版號——會導致用戶端在兩個 commit 之間跑舊快取的 JS 搭配新的 HTML（或反過來），造成功能異常。

---

## Service Worker 策略規範

`sw.js` 已採用分級快取策略，**修改時必須保持這個架構**，錯誤的策略會導致用戶永遠拿不到新版。

### 當前策略（不得更動）

| 資源類型 | 策略 | 理由 |
|----------|------|------|
| HTML（`index.html`、`privacy.html` 等） | **network-first** | 版本更新後用戶立即拿到新版，失敗才走快取 |
| 版本化 JS/CSS（帶 `?v=` 參數） | **cache-first** | 版本號變就 URL 變，天然 cache busting |
| Firebase Storage 圖片 | **stale-while-revalidate** | 優先顯示舊圖再背景更新（上限 150 張、7 天過期） |

### 禁止事項

1. **禁止把 HTML 改成 cache-first**：用戶會卡在舊版永遠無法更新。
2. **禁止加入未被 `bump-version.js` 管理的資源到 `STATIC_ASSETS`**：版本號變更時不會失效，導致舊資源永久殘留。
3. **禁止在 `STATIC_ASSETS` 引用外部 CDN**：SW 無法保證 CORS，可能導致整個 PWA 冷啟動失敗。
4. **禁止直接編輯 `CACHE_NAME`**：必須透過 `bump-version.js`（見 §快取版本號規則）。
5. **禁止加入 `/sw.js` 自己到快取清單**：會造成 SW 無法更新的 deadlock。

---

## 架構文件

- 模組依賴關係圖與各層說明：[docs/architecture.md](docs/architecture.md)
- **可調設定 / Timing / 流程順序總覽：[docs/tunables.md](docs/tunables.md)** — 記錄專案內所有可調常數（timeout、debounce、interval、limit、threshold）+ 加載順序 + 關鍵流程的 sequence effect。修改檔案時若涉及任何上述項目，必須同步更新此檔對應條目（規則見 §每次新增功能時的規範 第 9 條）

---

## 模組建立規則

- **bug 修復或小幅調整** → 直接修改現有檔案
- **同一責任範圍的邏輯擴充** → 修改現有檔案
- **新的責任範圍或獨立業務邏輯** → 在 `js/modules/` 建立新模組，以 `Object.assign(App, {...})` 掛載
- **單一檔案不得超過 300 行**，超過則拆分（新模組放入對應功能子資料夾（如 js/modules/event/、js/modules/team/），參考既有資料夾結構）
- **相同類型的模組必須放在同一個資料夾內**：新增模組時，若已有對應的功能子資料夾（如 event/、team/、profile/ 等），**禁止**將同類型模組放在 `js/modules/` 扁平目錄下，必須放入對應子資料夾。若新功能不屬於任何既有子資料夾，且預期會有 2 個以上相關檔案，應優先建立新的功能子資料夾

## 模組化演進目標

- 專案長期目標是逐步走向**功能模組化、資料夾化、責任邊界清楚**的架構；對於已明顯跨頁、跨責任、跨資料來源的功能，不應長期維持在單一大檔案中持續堆疊。
- 重構既有功能時，預設採用「**保留舊入口、內部邏輯逐步抽離到新資料夾**」的方式進行；除非使用者明確要求，否則不要直接做一次性大搬家。
- 已完成 14 個功能子資料夾化（achievement / tournament / user-admin / event / team / profile / message / scan / dashboard / kickball / ad-manage / shot-game / education / color-cat），新增模組應放入對應子資料夾。
- 舊檔若仍承擔既有入口責任，應先轉為 facade / compatibility layer，再逐步瘦身，而不是在第一步就刪除。
- 功能重構時，要明確區分「結構整理」與「業務邏輯改寫」兩種工作；若兩者同時進行會提高回歸風險，預設先做結構整理，再做邏輯重寫。
- 每次完成資料夾化或模組拆分後，必須同步更新 `docs/architecture.md`，讓專案結構演進有文件可追。

---

## 每次新增功能時的規範

1. 新的責任範圍必須以獨立模組方式建立（`js/modules/` 目錄）
2. 完成後更新 `docs/architecture.md`，加入新模組說明與依賴關係
3. 如果有新的模組間依賴，更新 Mermaid 圖
4. 修改任何 JS 或 HTML 檔案後，必須同步更新快取版本號（見上方規則）
5. 若功能已明顯超出單檔可維護範圍，優先建立功能資料夾，不要繼續把新責任疊加在既有大檔上
6. 功能搬移若涉及既有頁面入口，預設先保留舊入口檔案作為相容層，再逐步轉接到新資料夾
7. 若變更涉及模組新增、搬移或刪除，必須同步更新結構文件（見檔案頂部交叉引用清單）
8. **可調設定 / Timing / 順序變更同步維護（強制）**：修改檔案過程中若涉及以下任一項目，**必須同步更新 [docs/tunables.md](docs/tunables.md) 對應條目**：
   - 新增 / 修改 / 刪除任何 timing 常數（timeout、debounce、interval、`setTimeout` / `setInterval` 數值）
   - 新增 / 修改 / 刪除任何 limit 容量上限、threshold 閾值
   - 變更模組加載順序（`script-loader.js` 各 page 清單、`index.html` script 順序、init Phase 順序）
   - 變更關鍵流程的 sequence effect（boot overlay 隱藏流程、visibility change 流程、報名/簽到流程、deep link 解析流程等）
   - 新增 / 移除 timing 之間的依賴關係（例如「A timeout 必須 < B timeout」）
   - 程式碼註解若引用 tunables.md 的 anchor（如 `// 詳見 docs/tunables.md #boot-overlay-min-visible`），必須確認該 anchor 在 tunables.md 內存在
9. **權限系統同步維護（強制）**：當新增或變更任何後台功能時，必須同步評估並執行以下事項：
   - **新增權限開關**：若該功能需要依層級控制存取，必須在 `js/config.js` 的 `ADMIN_PAGE_EXTRA_PERMISSION_ITEMS` 或 `DRAWER_MENUS` 中新增對應的權限碼（permission code），並在 `getDefaultRolePermissions()` 中設定各層級的預設值。
   - **新增或更新權限說明**：必須在 `js/modules/user-admin/user-admin-perm-info.js` 的 `_PERM_INFO` 對照表中，為新權限碼新增 `{ title, body }` 說明內容，或更新既有權限的說明文字以反映功能變更。說明內容應以白話描述該權限的用途與影響範圍。
   - **不確定是否需要新增權限時**：應先向用戶說明該功能的存取需求，並建議適合的權限碼命名與層級配置，由用戶決定是否新增。
   - **權限碼命名規則**：入口權限以 `.entry` 結尾（如 `admin.xxx.entry`），子權限以動作命名（如 `xxx.create`、`xxx.edit_all`、`xxx.delete`）。
   - **`INHERENT_ROLE_PERMISSIONS` 兩地同步（強制）**：此常數同時定義於 `js/config.js` 與 `functions/index.js`（無 build process 故無法共用）。修改任一邊時**必須同步更新另一邊**，否則前端 UI 顯示與後端驗證行為將出現無錯誤訊息的靜默分歧。
   - **`hasPermission` 守衛新增規則（強制，歷史教訓）**：新增 `hasPermission()` 前端守衛時，**禁止**使用 `if (!hasPermission(...)) return` 直接擋回的寫法。必須遵守以下規則：
     - **「查看」類功能不加守衛**：報名名單（`_renderAttendanceTable`）、活動詳情等查看類渲染函式，預設所有登入用戶可見，不加權限守衛。管理操作（編輯/刪除/簽到）才需要守衛。
     - **管理操作守衛必須有 fallback**：格式為 `if (!hasPermission('xxx') && !hasPermission('activity.manage.entry')) { if (!_canManageEvent(e)) { showToast('權限不足'); return; } }`。確保主辦/委託人即使沒有顯式權限碼也能操作自己管理的活動。
     - **按鈕與功能一致性**：若 `canManage`（`_canManageEvent`）決定了按鈕顯示，對應的函式守衛必須包含同等的 `_canManageEvent` fallback，否則會出現「看得到按鈕但點不動」的 UX 缺陷。
     - **測試覆蓋**：新增守衛後必須用 `user`（一般用戶）、`coach`、`captain`、以及「一般 user 但為委託人」四種身分驗證行為。
     - **委託人功能範圍**：委託人只需要手動簽到（`_startTableEdit`）+ 現場掃碼（`renderScanPage`），不需要編輯/結束/刪除活動的權限。

---

## 測試與 CI 規範（強制）

### CI 自動驗證

本專案已設定 GitHub Actions（`.github/workflows/test.yml`），在 push 或 PR 到 `main` 時自動跑兩組測試：
- `npm run test:unit` — 純函式單元測試（~550 個）
- `npm run test:rules` — Firestore 規則測試（~110 個，需 Java 21 + Firebase Emulator）

**CI 失敗時 GitHub 會顯示紅色錯誤**（本專案直推 `main`，無分支保護，不會擋 push，但代表回歸失敗必須立即修復）。push 前應本地先跑，避免出錯後才來回補救。

### 測試指令清單

| 指令 | 用途 |
|------|------|
| `npm run test:unit` | 純函式單元測試（Jest，無需 emulator） |
| `npm run test:rules` | Firestore 規則測試（自動啟 emulator） |
| `npm run test:e2e` | Playwright E2E（需本地 `npx serve . -l 3000`） |
| `npm run test:unit:coverage` | 單元測試 + 覆蓋率報告 |

完整測試清單與對應來源檔案：見 `docs/test-coverage.md`。

### 何時必須跑測試（強制）

| 修改範圍 | 必跑指令 | 理由 |
|----------|----------|------|
| `firestore.rules` | `npm run test:rules` | CI 會失敗，且 Rules 錯誤會直接破壞 prod 權限 |
| `js/firebase-crud.js`（報名/取消/遞補鎖定函式，清單見 §報名系統保護規則） | `npm run test:unit` | 歷史多次回歸 bug，測試是最後防線 |
| `js/modules/achievement/stats.js`（統計鎖定函式，清單見 §統計系統保護規則） | `npm run test:unit` | 同上 |
| `js/modules/**` 其他模組 | `npm run test:unit` | CI 會失敗，本地先驗省來回補救 |
| `functions/index.js`（Cloud Functions） | 手動測 + `firebase functions:log` 驗證 | 目前無 CF 自動化測試 |
| 純文件變更（`*.md`、`docs/**`） | 無 | 不觸發測試 |

### 測試失敗的處理規則

1. **禁止用 `xdescribe` / `xtest` / `--testPathIgnorePatterns` 繞過失敗的測試**。任何跳過都必須在 commit 訊息中記錄原因與恢復時機。
2. 若測試失敗源自「測試本身過時」（例如鎖定函式已正當升級），先修測試、再修程式碼，並在 commit 訊息標註「測試同步更新」。
3. 若測試失敗源自「程式碼真的壞掉」，先修程式碼，保留測試。
4. **鎖定函式範圍內新增函式必須補單元測試**（清單見 §報名系統保護規則、§統計系統保護規則）；非鎖定範圍不強制但鼓勵。

---

## 除錯規則

- 修復任何錯誤前，必須先閱讀所有相關聯的檔案（import、呼叫方、被呼叫方）
- 找到可能的根因後，先向我報告分析結果，等我確認後才動手修改
- 不要猜測根因，如果無法從程式碼確定，先加 log 來收集證據
- 修復後要檢查是否有其他檔案也受到同樣問題影響

---

## 開發守則

本章包含 4 個層次的守則：**編碼風格 → 動手前思考 → 程式碼精簡 → 外科手術式修改**。動手前依序檢視這 4 個子節。

### 編碼風格與一般規範

- 統一使用 `async/await`，不使用 `.then()` 鏈式呼叫
- 所有使用者輸入必須經過 `escapeHTML()` 處理，防止 XSS
- 資料操作統一透過 `ApiService`，不直接操作 `FirebaseService._cache` 或 `DemoData`
- 新模組以 `Object.assign(App, { ... })` 掛載，不建立全域變數
- Demo / Prod 分支邏輯統一在 `ApiService` 內處理，模組層不做 `ModeManager.isDemo()` 判斷
- 涉及既有大模組重構時，優先先做結構整理與責任切分，再進入業務邏輯改寫，避免一次性搬移與修 bug 疊在同一批變更。
- **跨瀏覽器相容性檢查（每次修改前必做）**：每次計畫修改 CSS、JS、HTML 之前，必須先確認 LINE 瀏覽器（WebView）、Chrome、Safari 三端是否對齊。不得引入僅部分瀏覽器支援的 API 或 CSS 屬性而未提供 fallback（例如：`backdrop-filter` 需加 `-webkit-` 前綴、`dvh` 需有 `vh` fallback、`replaceAll` 需用 `replace(/…/g)` 替代、`navigator.clipboard` 需有 `execCommand` 降級）。若不確定相容性，應先查證後再實作，避免產生跨瀏覽器不一致或 BUG。
- **彈窗毛玻璃風格規範**：所有彈窗（modal / dialog / overlay）一律使用毛玻璃背景遮擋效果。背景層必須包含 `backdrop-filter: blur(10px)` + `-webkit-backdrop-filter: blur(10px)`，搭配半透明黑底 `rgba(0,0,0,.35)`。彈窗本體使用圓角 `border-radius: 16px` + 陰影 `box-shadow: 0 8px 32px rgba(0,0,0,.15)`。觸控事件必須阻止穿透但允許彈窗內部滾動：overlay 層的 `touchmove` 事件中，若 `e.target` 在 modal 內則放行（允許滾動），否則 `preventDefault` + `stopPropagation`（阻止穿透到背景）。彈窗本體**不得**加 `touch-action: none`（否則內部無法滾動）。參考實作：`color-cat-scene-stats-modal.js`、`color-cat-scene-panel-modal.js`。
- **實體 ID 統一規範（強制，所有新增程式碼適用）**：
  - **原則：一個實體 = 一個 ID，禁止名字做身分識別**。既有程式碼能正常運作的不動，但所有新增或重構的程式碼必須遵守此規範。
  - **用戶**：唯一辨識方式為 Firebase Auth UID（= LINE userId）。所有新增的 Firestore 文件寫入，若需記錄「操作者」或「所屬用戶」，**必須包含 `uid` 欄位**，值為 Firebase Auth UID。**禁止用顯示名稱（displayName/name）做身分比對或查詢條件**，名稱只能做為顯示用的快取欄位。既有集合的用戶 ID 欄位名對照（歷史慣例，不變更）：`users` → `uid`/`lineUserId`、`registrations` → `userId`、`attendanceRecords` → `uid`、`activityRecords` → `uid`、`events` → `creatorUid`、`expLogs` → `uid`、`operationLogs` → `uid`。
  - **俱樂部**：唯一辨識方式為自訂 ID（格式 `tm_<timestamp>_<random>`，由 `generateId('tm_')` 產生）。新建俱樂部必須使用 `db.collection('teams').doc(teamId).set(data)` 讓自訂 ID 作為 Firestore 文件 ID，消除 `id` 與 `_docId` 不一致的雙軌制。跨集合引用（`users.teamIds`、`events.creatorTeamIds`、`tournaments.hostTeamId`）一律存此 ID。俱樂部幹部欄位必須用 UID（`captainUid`、`leaderUids`、`coachUids`），禁止用名字做身分比對；名字欄位（`captainName`、`leaderNames`、`coachNames`）只做顯示快取。
  - **賽事**：唯一辨識方式為自訂 ID（格式 `ct_<timestamp>_<random>`，由 `generateId('ct_')` 產生）。新建賽事同樣使用 `.doc(tournamentId).set(data)` 消除雙軌制。委託人欄位用 `delegateUids`（UID 陣列），`delegateNames` 只做顯示快取。
  - **活動（events）**：因已有大量歷史資料且子集合遷移（Phase 4b）剛完成，維持既有的 `data.id` + `_docId` 雙軌制不變動。
  - **ID 生成統一**：所有新建實體的 ID 必須使用 `generateId(prefix)` 函式（`config.js`），禁止內聯拼接。前綴對照：`tm_`=俱樂部、`ct_`=賽事、`ce_`=活動、`reg_`=報名、`fp_`=動態牆貼文、`fc_`=動態牆留言、`ta_`=賽事申請。
- **活動 ID 雙軌制地雷（永久，歷史教訓 2026-04-11）**：`events` 集合的 Firestore 文件 ID（`doc.id`，如 `ga0CqtaPpjRwimUGEZfU`）與活動自訂 ID（`data.id`，如 `ce_1774920121549_j63p`）**不同**。`registrations.eventId`、`attendanceRecords.eventId`、`activityRecords.eventId` 存的都是 `data.id`（自訂 ID），**不是** `doc.id`。在 Cloud Functions 或任何後端查詢中，凡涉及活動 ID 的比對，**必須使用 `doc.data().id`（或 `data.id`），禁止使用 `doc.id`**。前端快取中活動的 `id` 欄位對應 `data.id`，`_docId` 對應 `doc.id`。遇到數據異常（統計歸零、跨集合 join 配不上）時，**第一步就檢查是否誤用了 doc.id 取代 data.id**。

---

### 實作前思考（動手前釐清假設）

- 開始寫程式碼前，必須先表述你的核心假設（例如「我假設這個欄位必定存在」「我假設呼叫者已驗證過輸入」）。若有任何假設無法從既有程式碼確認，必須先向用戶釐清，禁止靜默猜測。
- 若用戶需求有多種合理解讀（例如「修這個 bug」可能對應 A / B / C 三種改法），必須把所有解讀列出讓用戶選,禁止自行挑一個就動手。
- 若存在比用戶提出方案更簡單、更低風險、更符合專案既有模式的替代方案，必須主動提出；若用戶的方案有明顯疑慮（例如違反鎖定函式保護、違反 ID 雙軌制、違反編碼規範、違反跨瀏覽器相容性要求），應適時反駁並說明理由，不得無條件照做。
- 此規則適用於所有涉及程式碼變更的情境（bug 修復、功能開發、重構、優化），與「除錯規則」並列生效。

---

### 程式碼精簡（寫最少的程式碼）

- 以能正確解決問題的**最少程式碼**為目標，不加任何未被要求的功能、選項、參數、抽象層。
- 禁止為「未來可能會用到」做預留設計；禁止為單次使用的邏輯包一層抽象；禁止為不可能發生的情境（例如前端已驗證過的欄位、鎖定函式內已保證的前置條件）加 error handling。
- 完成後若察覺寫了明顯過多的程式碼（例如 200 行但實際 50 行就夠），必須在提交前重寫到最簡形式，再交付給用戶。
- 衡量標準:「資深工程師看到這段變更,會不會覺得過度工程?」若會,就精簡。
- 此規則**不與**「模組化演進目標」衝突：模組化針對的是長期的責任邊界與單檔上限（300 行）；精簡規則針對的是單次變更的程式碼量。長期結構要清晰、單次變更要最小，兩者並行。

---

### 外科手術式修改（只改必要的，鎖定函式區域加倍嚴格）

- 修改既有程式碼時，**只動必須動的部分**。禁止順手優化相鄰程式碼、重排註解、調整格式、重命名無關變數、改寫既有寫法風格。
- 若發現既有程式碼風格與你個人偏好不同（縮排、命名、`var` vs `const`、箭頭函式 vs `function` 等），**必須沿用既有風格**，禁止自作主張改寫；風格統一若要進行，必須另開單獨的結構整理 commit，不得混在功能變更中。
- 若發現無關的 dead code、可疑邏輯、疑似 bug，**只能在回覆中指出並建議後續處理**，禁止在同次變更中順手刪除或修改（違反此規則的變更會讓 git log 語意混亂，也提高回歸風險）。
- 自己的改動若造成孤兒（因修改而不再被引用的 imports / variables / functions / CSS 規則），**必須**一併清除；但**既有的孤兒請保留**，等用戶明確指示再處理。
- 驗收標準：diff 的每一行變更都必須能直接對應到用戶的原始需求；出現「順手優化」的行數會被視為違反此規則。
- **鎖定函式區域加倍嚴格**：修改下列檔案時，不僅不得順手改鎖定函式以外的程式碼，連相鄰的非鎖定函式也應避免變動：
  - `js/firebase-crud.js`（報名/取消/遞補 transaction）
  - `js/modules/event/event-detail-signup.js`、`event-detail-companion.js`、`event-create-waitlist.js`
  - `js/modules/event/event-manage-noshow.js`、`event-manage-confirm.js`
  - `js/modules/achievement/stats.js`、`js/modules/leaderboard.js`
  - `js/firebase-service.js`（`ensureUserStatsLoaded` 等統計系統鎖定函式所在檔案）

---

## 分享功能設計規範（LINE Mini App URL 優先）

本專案的主要用戶群在 LINE 生態系內，所有面向用戶的分享功能**必須使用 LINE Mini App URL**，確保連結在 LINE 內直接開啟 Mini App。

### Mini App URL 格式

```
https://miniapp.line.me/2009525300-AuPGQ0sh?{deepLinkParam}={id}
```

- 活動：`?event={eventId}`
- 俱樂部：`?team={teamId}`
- 賽事：`?tournament={tournamentId}`
- 個人名片：`?profile={uid}`
- 其他新功能：依此模式擴展

**全域常數**：`MINI_APP_BASE_URL`（定義於 `js/config.js`），所有分享 URL 統一使用此常數。

### 向後相容

- **舊 LIFF URL**（`liff.line.me/2009084941-zgn7tQOp?...`）：LIFF App 仍在運作，舊連結不受影響
- **舊 toosterx.com 中繼跳轉**（`toosterx.com/?event=xxx`）：`index.html` 保留中繼跳轉邏輯，自動導向 Mini App URL
- 各分享模組中保留 `// [備用]` 註解標記舊 URL，需要時可快速切回

### 強制規則

1. **面向用戶的分享 URL 原則使用 Mini App URL**：`liff.line.me` 已淘汰禁用。`toosterx.com/event-share/{id}`（OG 中繼頁）作為「複製連結」專用例外（2026-04-23 用戶決議），`LINE 好友` / `LINE 群組` / `shareTargetPicker` / QR Code 仍一律用 Mini App URL。
   - 「複製連結」例外理由：貼到 FB / IG / Twitter / Telegram 時顯示活動封面 OG 卡片（Mini App URL 無法被社群平台爬蟲解析）；Cloud Function 處理 OG 後 redirect 到 Mini App URL，LINE 內點擊仍會進 Mini App
   - 實作：活動類複用既有 `_buildEventShareOgUrl(eventId)`；其他實體（team / tournament / profile）若要啟用同樣例外，需比照新增對應 OG URL 建構器 + Cloud Function OG 路由
2. **分享功能的優先實作順序**：
   - 首選：`liff.shareTargetPicker()`（Flex Message 卡片）— 需 LIFF session + LINE Developers Console 啟用
   - 次選：底部選單提供「複製分享連結」（活動類複製 `toosterx.com/event-share/{id}` OG URL；其他實體仍為 Mini App URL）
   - 兜底：`navigator.share()` / `_copyToClipboard()` fallback
3. **新增分享功能時必須比照 `event-share.js` 的模式**：底部選單（Action Sheet）+ Flex Message + 防連點 + altText 截斷（400 字）+ 各級 fallback。
4. **QR Code 內容也必須使用 Mini App URL**：QR Code 掃描後在 LINE 開啟 Mini App。
5. **Cloud Function OG 頁面**：`/event-share/{id}` / `/team-share/{id}` 等 OG 預覽用的中繼頁直連 URL（社群平台爬蟲無法解析 Mini App URL），最終 redirect 目標為 Mini App URL。
6. **LINE Developers Console 設定**：任何使用 `shareTargetPicker` 的 LIFF App，必須確認 Console 中 Share Target Picker 開關為 ON。

### 分享功能遷移狀態

| 功能 | 狀態 |
|------|------|
| 活動分享 | ✅ Mini App URL + Flex Message（「複製連結」走 OG URL） |
| 俱樂部邀請 | ✅ Mini App URL + Flex Message |
| 賽事分享 | ✅ Mini App URL + Flex Message |
| 個人名片分享 | ✅ Mini App URL |
| 角色頁複製連結 | ✅ Mini App URL |
| index.html 中繼跳轉 | ✅ 跳轉目標改為 Mini App URL |
| Cloud Function OG | ✅ redirect 目標改為 Mini App URL |
| Dashboard 報表 | ⚠️ 維持現狀（管理功能，非面向一般用戶） |

---

## 活動可見性規則（強制，2026-04-20 [永久]）

活動黑名單功能導入後，所有活動列表渲染與詳情入口**一律通過**共用 helper 判斷可見性：

### 核心 helper
- `App._isEventVisibleToUser(event, uid)` — 位於 `js/modules/event/event-blocklist.js`
- 四狀態邏輯：
  1. 訪客（無 uid）→ 可見
  2. 未在 `blockedUids` → 可見
  3. 被擋但曾有任一報名紀錄（含 cancelled/removed）→ 可見（尊重歷史）
  4. 被擋且無任何報名紀錄 → 不可見

### 強制規則

1. **禁止在模組內重寫黑名單判斷邏輯**。任何新活動列表入口必須呼叫 `_isEventVisibleToUser` 或透過 `_getVisibleEvents`（它內部已整合）。
2. **列表渲染優先走 `_getVisibleEvents`**：既有入口（首頁輪播 / 行事曆 / 搜尋）都已經過，新增入口時繼續沿用。
3. **獨立列表（如俱樂部內嵌、賽事內嵌）**需明確呼叫 `_isEventVisibleToUser(e, currentUid)` 在 filter 內。
4. **活動詳情頁直接進入守衛**：`showEventDetail` 已加守衛，偽裝顯示「找不到此活動」，不透露被擋事實。
5. **Cloud Function 端不需過濾**：CF 事件通知僅發給「已報名用戶」，已報名者按規格保留可見性，自然不會產生不一致。未來若有 CF 端主動發送給「非已報名用戶」的路徑，必須同步實作 `isEventVisibleToUser()` 於 `functions/index.js`。
6. **Favorites / Scan / Dashboard 豁免**：Favorites 是用戶自己收藏（保留）；Scan / Dashboard 為 admin 用途（保留）。
7. **寫入類動作守衛（2026-04-20 補強）**：`handleSignup` / `_confirmCompanionRegister` 等寫入入口也呼叫 `_isEventVisibleToUser`，防止「未登入先進詳情頁 → 登入後按報名」的繞過路徑。Companion 情境只擋主報名人（operator），不擋同行者中的被擋用戶。被擋用戶嘗試寫入時顯示「此活動目前無法報名」（非「找不到此活動」，因他已看到）。

### 寫入路徑規範
- `blockedUids`：字串陣列，存 LINE userId（= Firebase Auth UID）
- `blockedUidsLog`：物件陣列，每筆 `{ uid, by, action: 'add'|'remove', at, reason }`（審計軌跡必填）
- 寫入時**僅改這兩個欄位**（對應 Rules `isBlocklistFieldsOnly`），不得順便改 `updatedAt` 或其他欄位
- 使用 `FieldValue.arrayUnion/arrayRemove` 確保原子性

### 權限
- 權限碼：`admin.repair.event_blocklist`
- `super_admin` INHERENT 鎖定（兩端同步：`js/config.js` + `functions/index.js`）
- `user` 絕對無（預設 `[]`、UI 不顯示 toggle）
- 其他角色透過權限管理調整
- Rules 層：`canManageEventBlocklist()` = `isSuperAdmin() || hasPerm(...)`

---

## 報名系統保護規則（核心模組鎖定）

報名系統是最核心的業務邏輯，歷史上多次因修改引發嚴重 bug（人數覆蓋、候補未遞補、超收）。以下規則**強制適用**：

### 鎖定範圍（修改需特別審查）
| 檔案 | 鎖定函式 | 說明 |
|------|----------|------|
| `js/firebase-crud.js` | `registerForEvent()` | 單人報名（Firestore transaction） |
| `js/firebase-crud.js` | `batchRegisterForEvent()` | 批次報名含同行者（Firestore transaction） |
| `js/firebase-crud.js` | `cancelRegistration()` | 取消報名 + 候補遞補（Firestore batch + 模擬模式） |
| `js/firebase-crud.js` | `cancelCompanionRegistrations()` | 取消同行者報名 + 候補遞補（Firestore 查詢 + 模擬模式） |
| `js/firebase-crud.js` | `_rebuildOccupancy()` | 佔位重建（純函式） |
| `js/firebase-crud.js` | `_applyRebuildOccupancy()` | 佔位寫入快取 |
| `js/modules/event/event-detail-signup.js` | `handleSignup()` | 報名 UI 入口 |
| `js/modules/event/event-detail-signup.js` | `handleCancelSignup()` | 取消報名 UI 入口 |
| `js/modules/event/event-detail-companion.js` | `_confirmCompanionRegister()` | 同行者報名 UI |
| `js/modules/event/event-detail-companion.js` | `_confirmCompanionCancel()` | 同行者取消 UI |
| `js/modules/event/event-create-waitlist.js` | `_adjustWaitlistOnCapacityChange()` | 容量變更時自動遞補 / 降級（Firestore 查詢 + batch） |
| `js/modules/event/event-create-waitlist.js` | `_getNextWaitlistCandidate()` | 取得下一位候補遞補者（排序邏輯） |
| `js/modules/event/event-create-waitlist.js` | `_promoteSingleCandidateLocal()` | 單人遞補本地狀態變更 + 通知 |
| `js/modules/event/event-create-waitlist.js` | `_getPromotedArDocIds()` | 遞補時取得 activityRecord docId |

### 修改這些函式時的強制規則

1. **禁止使用本地快取作為計數來源**：`_rebuildOccupancy` 的輸入資料必須來自 Firestore 查詢結果，禁止使用 `this._cache.registrations` 作為計數或重建的資料來源。快取可能不完整（LIFF 重導、首次載入、網速慢），會導致覆蓋正確的 `current` 值。
2. **禁止手動 `current++` / `current--`**：所有 `event.current`、`event.waitlist` 的變更必須透過 `_rebuildOccupancy()` 統一重建，不得手動增減（Demo 模式除外）。
3. **必須使用原子操作**：報名寫入必須使用 `db.runTransaction()` 或 `db.batch()`，禁止分散的 `db.collection().doc().update()` 呼叫。
4. **候補遞補必須在同一 batch**：取消正取後的候補遞補，必須與取消操作在同一個 batch/transaction 內完成，不得分開提交。
5. **修改前必須執行驗證**：修改上述任何函式後，必須在 console 執行 `docs/registration-integrity-check.js` 驗證報名系統一致性。
6. **禁止修改 `_rebuildOccupancy` 的純函式特性**：此函式不得引入副作用（不寫快取、不呼叫 API、不修改傳入參數）。

### 候補系統額外強制規則（歷史上多次因違反而產生嚴重 bug）

7. **遞補排序不可變更**：候補遞補順序固定為 `registeredAt ASC`（報名時間先到先遞補），同時間內依 `promotionOrder ASC`。任何遞補路徑（容量變更、取消觸發）都必須遵守此排序，不得自行定義其他排序邏輯。
8. **降級排序不可變更**：容量減少時的降級順序固定為 `registeredAt DESC`（最晚報名先降級），同時間內依 `promotionOrder DESC`。
9. **狀態變更必須同步 activityRecord**：任何將 registration 從 `confirmed ↔ waitlisted` 轉換的操作，必須同步更新對應的 `activityRecord`（`registered ↔ waitlisted`）。同行者（`participantType === 'companion'`）除外，因其不產生 activityRecord。
10. **禁止在 batch.commit() 前修改本地快取**：`cancelRegistration` 和 `cancelCompanionRegistrations` 必須使用「模擬模式」— 在副本上計算結果，commit 成功後才寫入本地快取。違反此規則會導致 commit 失敗時快取汙染（假成功）。
11. **Firestore 查詢結果的 Timestamp 必須轉換**：從 Firestore 讀取的 `registeredAt` 是 Timestamp 物件，必須透過 `data.registeredAt?.toDate?.()?.toISOString?.() || data.registeredAt` 轉換為 ISO 字串後才能用於排序。未轉換的 Timestamp 會導致 `new Date()` 回傳 NaN，遞補排序失效。
12. **`_adjustWaitlistOnCapacityChange` 必須先查詢 Firestore**：函式開頭必須先從 Firestore 查詢最新報名資料並同步到快取，不得直接使用可能過時的快取資料進行遞補/降級判斷。

### 子集合遷移後的查詢路徑（2026-04-12 Phase 4b 完成後強制）

所有報名/簽到/活動紀錄查詢**必須使用子集合路徑**，禁止查詢已凍結的根集合：

| 場景 | 正確路徑 ✅ | 禁止路徑 ❌ |
|------|------------|------------|
| 單一活動報名 | `db.collection('events').doc(eventDocId).collection('registrations')` | `db.collection('registrations').where('eventId','==',id)` |
| 跨活動查詢 | `db.collectionGroup('registrations')` + 去重 | `db.collection('registrations').where('userId','==',uid)` |
| CF 查詢 | `admin.firestore().collectionGroup('registrations')` + `path.split('/').length > 2` | `db.collection('registrations')` |

**去重過濾**（Phase 4c 刪除根資料前必須保留）：
- 前端：`doc.ref.parent.parent !== null`
- CF：`d.ref.path.split('/').length > 2`

### 活動詳情頁局部更新規則（2026-04-13 新增）

報名/取消/候補操作後**禁止呼叫 `showEventDetail()` 做全頁重繪**（會導致頁面跳頂）。必須使用局部 DOM 更新：
- `_refreshSignupButton(eventId)` — 更新按鈕（涵蓋所有 8 種狀態）
- `_patchDetailCount(eventId)` — 更新人數文字
- `_patchDetailTables(eventId)` — 更新報名/候補/簽到表格
- `_debouncedSnapshotRender` 的 `page-activity-detail` 分支也必須走局部更新

---

## 統計系統保護規則（UID 比對鎖定）

統計系統（完成場次、出席率、放鴿子）歷史上多次因 UID 欄位不一致導致統計歸零或誤判。以下規則**強制適用**：

### 背景知識（必讀）

`attendanceRecords` 和 `activityRecords` 的 `uid` 欄位已於 2026-03-17 透過 Cloud Function `migrateUidFields` 完成遷移修正，所有歷史資料的 uid 欄位已統一為正確的 LINE userId。寫入路徑（`_confirmAllAttendance`）也已修復，不再產生新的 displayName-as-uid 資料。

### 鎖定範圍（修改需用戶明確授權）

| 檔案 | 鎖定函式 / 區塊 | 說明 |
|------|------------------|------|
| `js/modules/event/event-manage-noshow.js` | `_buildRawNoShowCountByUid()` | 放鴿子原始計數（全用戶） |
| `js/modules/event/event-manage-noshow.js` | `_getNoShowDetailsByUid()` | 放鴿子明細查詢（單一用戶） |
| `js/modules/event/event-manage-confirm.js` | `_confirmAllAttendance()` | 批次確認出席（寫入 attendanceRecords） |
| `js/modules/achievement/stats.js` | `getParticipantAttendanceStats()` | 出席統計核心（完成場次、出席率） |
| `js/modules/leaderboard.js` | `_calcScanStats()` | 掃碼統計（呼叫 getParticipantAttendanceStats） |
| `js/modules/leaderboard.js` | `_categorizeRecords()` | 活動紀錄分類（完成 / 未出席 / 取消） |
| `js/firebase-service.js` | `ensureUserStatsLoaded()` | 用戶統計資料載入 |
| `js/api-service.js` | `getUserAttendanceRecords()` | 用戶簽到紀錄取得（優先 userStatsCache） |

### 修改這些函式時的強制規則

1. **未經用戶明確授權，禁止修改上述任何函式**。即使是看似無害的重構、變數重命名或程式碼整理，都可能破壞統計邏輯。
2. **禁止變更 UID 欄位對照關係**：`registrations` 用 `userId`、`attendanceRecords` 用 `uid`、`activityRecords` 用 `uid`、`users` 集合的快取 key 是 `adminUsers`（非 `users`）。不得變更這些欄位名或快取 key。
3. **`attendanceRecords.uid` 現在可信賴**：歷史資料已遷移、寫入路徑已修復，新增比對邏輯時可直接用 uid 比對，不需 displayName fallback。
4. **修改前必須說明影響範圍**：任何修改提案必須列出對完成場次、出席率、放鴿子統計的影響，並說明是否需要重新驗證歷史資料。

---

## Firestore Rules 修改規則（強制）

`firestore.rules` 約 1500 行，近 2 個月被修改 80 次，是 CI 會擋的檔案。修改前必讀：

### 強制規則

1. **閱讀前**：修改任何 helper 函式前，必須先掃過哪些 rule 呼叫它（用 grep），避免誤刪他人依賴。
2. **刪除保守**：禁止刪除既有 helper 函式（如 `isSuperAdmin()`、`hasPerm()`、`isBlocklistFieldsOnly()`）。若確定不再使用，須獨立 commit 並在 message 明確標示「確認無呼叫端」。
3. **欄位白名單完整性**：新增或擴充 `isSafeSelfProfileUpdate()` 之類的白名單時，必須**同步更新對應測試**（`tests/firestore*.test.js`），否則新欄位會被 Rules 靜默拒絕（參考 stealth 欄位漏白名單的歷史案例）。
4. **修改後必跑**：`npm run test:rules` 本地通過才可 push。失敗必須先修通，禁止用 skip 繞過。
5. **部署驗證**：`firebase deploy --only firestore:rules` 後，在 Prod 跑一輪代表性寫入測試（建立活動、報名、取消等）確認無回歸。

### 歷史教訓（修改前查閱）

- `isSafeSelfProfileUpdate()` 白名單漏 stealth 欄位 → 潛行開關 Firestore 寫入被靜默拒絕（`docs/claude-memory.md` 搜 `stealth`）
- 詳細 Rules 相關教訓見 `docs/claude-memory.md` 搜 `Rules`

---

## Cloud Functions 修改規則（強制）

`functions/index.js` 約 6200 行、36 個 exports，近 2 個月被修改 90 次，**目前無自動化測試**，出錯直接影響 prod。

### 強制規則

1. **Callable Function 檢查項目**（歷史雙陷阱）：
   - 必須指定 `region`（本專案用 `asia-east1`）
   - 前端 `firebase.functions().httpsCallable()` 的 region 必須對應
   - region 不匹配會產生 CORS 錯誤假象，但根因不是 CORS
2. **禁止吞錯**：所有 `.catch()` 必須 log 清楚上下文或重新拋出。

   ```javascript
   // ❌ 禁止
   .catch(err => {})
   .catch(err => console.log(err))  // log 太弱，無法定位

   // ✅ 正確
   .catch(err => {
     console.error('[funcName] 具體上下文:', err);
     throw err;  // 或回傳 HttpsError
   })
   ```
3. **`INHERENT_ROLE_PERMISSIONS` 兩地同步**（已規範於 §每次新增功能時的規範 第 8 條）
4. **Transaction 必須處理 contention**：Firestore transaction 會因併發拋 `ABORTED`，必須允許 SDK 的自動重試或自行 retry。
5. **部署後驗證**：`firebase deploy --only functions:xxx` 後必看 `firebase functions:log` 至少 5 分鐘，確認無 unhandled exception。

### 歷史教訓（修改前查閱）

- 一天內連犯兩次的 region/CORS 陷阱（`docs/claude-memory.md` 搜 `Callable`）
- `.catch()` 靜默吞錯（`docs/claude-memory.md` 搜 `靜默`）
- `recordUserLoginIp` region 不匹配 + `admin is not defined` 變數未宣告（近期修復）

---

## 新增 async `show*` 函式 Checklist（race condition 防禦、強制）

每次新增 `async showXxxDetail` / `showXxxList` / `showXxxForm` 類函式時、**必須**照以下清單檢查、避免「用戶離開頁面後被 async await 完成強制拉回」的 race bug 復發。

### 標準模板

```javascript
// 1. 在同檔 Object.assign(App, {...}) 最上方加 counter
_xxxRequestSeq: 0,

// 2. 函式開頭分配 seq
async showXxx(args) {
  if (this._requireLogin()) return;
  const requestSeq = ++this._xxxRequestSeq;

  // 3. 每個 await 後檢查 seq
  const data = await loadSomething();
  if (requestSeq !== this._xxxRequestSeq) {
    if (window._raceDebug || (typeof localStorage !== 'undefined' && localStorage.getItem('_raceLog'))) {
      console.log('[race-skip]', { fn: 'showXxx', seq: requestSeq, latest: this._xxxRequestSeq, stage: 'after-load' });
    }
    return { ok: false, reason: 'stale' };
  }

  // 4. showPage 後必用雙重檢查（seq + currentPage）
  await this.showPage('page-xxx');
  if (requestSeq !== this._xxxRequestSeq || this.currentPage !== 'page-xxx') {
    return { ok: false, reason: 'stale' };
  }

  renderDom();
  return { ok: true };
}
```

### Checklist

- [ ] 在同檔 `Object.assign(App, {...})` 最上方加 `_xxxRequestSeq: 0,`
- [ ] 函式開頭分配 `const requestSeq = ++this._xxxRequestSeq;`
- [ ] 每個 `await` 後做 seq check（若 race 則 `return { ok: false, reason: 'stale' };`）
- [ ] `showPage` 後必用**雙重檢查**：`requestSeq !== this._xxxRequestSeq || this.currentPage !== 'page-xxx'`
- [ ] Stale return 前加 debug log（`window._raceDebug` 或 `localStorage._raceLog` 觸發）
- [ ] 若 helper 內部有 `await` + DOM write、helper 必須接受 `requestSeq` 參數、內部用 `if (requestSeq != null && requestSeq !== this._xxxRequestSeq) return;` 檢查
- [ ] 若 `.then()` chain 會寫 DOM、callback 開頭加 seq check
- [ ] 若持有資源（相機 / timer / listener）、stale 時必清理（如 `try { this._stopXxx(); } catch(_) {}`）
- [ ] 若同一個 page 有多個入口（例：`page-edu-checkin` 有 batch + scan）、**入口間共用同一 counter**（避免雙重檢查失效）
- [ ] State mutation（`this.currentXxx = id`）依情境判斷：
  - 若被 `navigation.js._renderPageContent` 同步 hook 讀取 → **進入時先清 null、stale check 後寫新值**
  - 若被外部 stale 檢查（如 `app.js:1678` deep link）→ **延後到 stale check 之後**
  - 其他情況 → 保留在函式開頭（避免閃現舊資料）

### 參考實作

- 完整範例：`js/modules/event/event-detail.js:219` `showEventDetail`
- Helper + counter 共用：`js/modules/education/edu-checkin.js` + `edu-checkin-scan.js`
- State 清 null 模式：`js/modules/education/edu-student-list.js:27` `showEduStudentList`
- 計畫書：`docs/page-race-fix-plan.md`

---

## 修復日誌規則（每次解決問題後必做）

每次解決一個 bug 或完成一項功能後，**必須**在 `docs/claude-memory.md` 新增一筆記錄：

```markdown
### YYYY-MM-DD — 標題（簡短描述）
- **問題**：描述症狀
- **原因**：根本原因
- **修復**：修改了哪些檔案、做了什麼
- **教訓**：未來要注意的事項
```

> 這個檔案隨 git 走，換設備或跨會話都能參考歷史修復經驗。
> `docs/claude-memory.md` 是唯一指定的修復 / 功能歷史紀錄檔，禁止另建 `memory.md`、`fix-log.md`、`handoff-log.md` 或其他平行日誌檔分流紀錄。
> 若 `docs/claude-memory.md` 出現亂碼、混合編碼或非 UTF-8 狀態，必須先修復並標準化回 UTF-8，再繼續追加到同一檔案。

**格式注意事項**：
- `[永久]` 標記**統一放在標題末尾**（如 `### YYYY-MM-DD — 標題 [永久]`），不得放在標題前（既有歷史條目保留原狀，不追溯修正）。
- 日期格式一律 `YYYY-MM-DD`，不得用 `YYYY/MM/DD` 或其他變體。
- 同一天多筆記錄依時間先後排序，後寫的在下面。

### 修復日誌維護規則（定期清理）

`docs/claude-memory.md` 採兩層分級管理：

| 分級 | 標記 | 有效期 | 說明 |
|------|------|--------|------|
| 永久 | `[永久]` 區塊標題 | 永不過期 | 系統性資料完整性地雷、UID 陷阱、架構決策、反覆出現的 bug 模式（2 次+） |
| 一般 | 無特殊標記 | 30 天 | 一次性 bug 修復、UI 調整、功能新增等 |

**清理觸發條件**：總行數超過 **500 行**時觸發清理。

**清理規則**：
1. 一般條目超過 30 天且無持續參考價值 → 刪除
2. 同主題多次迭代（如 UI 反覆調整） → 合併為一筆，保留最終結果
3. 純功能新增（可從 `git log` 得知） → 刪除
4. 涉及資料不一致 / UID 地雷 / 架構決策 / 反覆 bug → 標記為 `[永久]`
5. 新條目預設為「一般」；只有符合永久條件的才標記 `[永久]`

---

## SEO 日誌規則（每次 SEO 相關變更必做）

每次執行 SEO 相關工作後，**必須**在 `docs/seo-log.md` 新增或更新記錄。SEO 相關工作包括但不限於：

- 新增或修改 `seo/*.html` 著陸頁
- 修改 `sitemap.xml`、`robots.txt`、`_headers`
- 修改任何 meta 標籤（title、description、OG、hreflang、canonical）
- 修改結構化資料（JSON-LD）
- 修改 Cloudflare SEO 相關設定（重導向、Crawler Hints 等）
- 新增或修改 SEO 自動化腳本

**記錄格式**：

```markdown
### YYYY-MM-DD — 標題（簡短描述）
**問題 / 目標**：為什麼要做這個變更
**執行項目**：
1. 具體做了什麼（列出修改的檔案和內容）
2. ...
**關鍵決策**：如果有取捨或放棄的方案，記錄原因
```

**同步維護**：修改 SEO 架構（新增頁面、變更 schema、調整 sitemap）後，必須同步更新日誌頂部的「SEO 架構總覽」區塊，確保總覽與實際狀態一致。

> `docs/seo-log.md` 是唯一指定的 SEO 日誌檔，禁止另建平行日誌分流記錄。

---

## 完成後自動部署規範

每次完成一項任務（功能開發、bug 修復、文件更新等）後，**必須**主動評估是否需要部署：

1. **評估條件**：若本次變更涉及任何 JS、HTML、CSS 或設定檔的修改，即視為需要部署
2. **主動執行順序**：
   1. 依 §測試與 CI 規範「何時必須跑測試」對照表，**先跑相關測試本地通過**
   2. `git add` → `git commit`
   3. 確認無回歸後 `git push origin main`
   4. 若測試失敗，先修測試或程式碼，通過後才 push
3. **Commit 訊息**：遵循既有 commit 規範（中文描述、列出關鍵改動）
4. **若僅修改文件檔案**（如 `CLAUDE.md`、`docs/*.md`），不觸發測試，可直接 commit + push
5. **例外**：僅當用戶明確表示「先不要 push」或「等我確認」時，才暫緩部署

## 計劃與建議回覆規範

### 規劃類回覆（「先計劃、不實作」）
- 回覆中必須同時提供：
  - 風險評估（列出主要風險、影響範圍、可能後果）
  - 工作量評估（拆分步驟並給出粗略工時或複雜度等級）

### 任何建議或優化提案（強制）
- 每當向用戶提出修改建議、優化方案、架構調整或任何技術提案時，**必須附上白話易懂的優劣與風險評估報告**，格式如下：

| 評估項目 | 內容 |
|----------|------|
| **做了會怎樣（好處）** | 用大白話說明用戶/開發者能感受到的改善 |
| **不做會怎樣** | 說明維持現狀的代價或沒影響 |
| **最壞情況** | 如果實作出問題，最嚴重會發生什麼事 |
| **影響範圍** | 會動到哪些檔案、哪些功能、哪些用戶流程 |
| **回退難度** | 出問題時能不能輕鬆改回來（秒回退 / 需手動還原 / 不可逆） |
| **歷史教訓** | 過去有沒有做過類似的事？結果如何？（查 `docs/claude-memory.md`） |

- 此規範適用於：效能優化、架構重構、新功能設計、CSS/JS/HTML 變更建議、部署策略調整等所有非 trivial 的提案
- 不適用於：純 bug 修復（已確認根因的直接修復）、用戶明確指示的精確操作、版本號更新等機械性操作
- **禁止只列好處不列風險**：若某項建議看起來「零風險」，必須明確寫出「最壞情況：無，純增量變更不影響既有邏輯」，而非省略不提

## 編碼與亂碼規範

### 檔案編碼原則

- 所有新增與修改的 repo 檔案一律以 UTF-8 保存；不得混用 ANSI、Big5、CP950、UTF-8 BOM 或其他不一致編碼。

### 修改方式

- 只要檔案含中文內容，預設優先使用 diff-based 修補（如 Edit / apply_patch）修改；除非有明確必要，禁止以 Write 整檔覆寫或以 shell 讀出整檔再整段覆寫回 repo 檔案。
- 禁止使用未明確指定 UTF-8 的 shell 寫檔方式修改 repo 檔案，包括但不限於 `Out-File`、`Set-Content`、`Add-Content`、未指定 encoding 的 `WriteAllText` / `WriteAllLines`。
- 若不得不用 shell 寫回 repo 檔案，必須明確指定 UTF-8（無 BOM）或等效安全設定，並在同次變更中重新讀檢查結果。

### 檢查時機（強制）

- **實作時**（新增或修改任何檔案），必須檢查是否出現無法判讀的亂碼（mojibake / encoding corruption）。
- **提交前**修改 `index.html`、`docs/claude-memory.md`、以及任何含中文 UI 文案的 `js/modules/*.js` 後，必須重新檢查是否出現 `�`、`Ã`、`å`、`æ`、連續 `???`（0x3F 替換）、PUA 字元（U+E000–U+F8FF）、殘缺標籤、殘缺引號或其他典型 mojibake 痕跡。
- 若只是批次更新版本號、快取參數、meta 標籤或文件文字，也同樣適用，不得因為是小改動而省略檢查。

### 終端 vs 檔案亂碼

- 若終端顯示為亂碼，必須先區分「終端顯示解碼錯誤」與「檔案實際內容已損壞」；禁止直接依據終端中的亂碼文字做 patch 或 replace。

### 受損處理

- 若發現亂碼且可安全修復，必須在同一次變更中優先即時修復，不得延後。
- 若檔案已出現 mojibake、混合編碼、殘缺 HTML 標籤、字串引號不閉合等情況，必須先整體修復編碼與結構，再繼續做功能修改；不得在受損區塊上直接疊加新需求。
- 若無法安全修復（例如來源不明或風險過高），必須在回覆中明確標註受影響檔案、區段、風險與建議處理方式，並提出可執行的修復方案；不得在未說明風險的情況下直接提交。
- 若需修復歷史紀錄檔的編碼，必須以 `docs/claude-memory.md` 為唯一目標檔，先標準化為 UTF-8，再沿用原檔續寫，不得改寫到其他替代檔案。

---

## 回覆結尾白話總結規則（強制）

每次回覆結束前，**必須**在最後額外新增一個「白話情境總結」區塊，用非工程師也能秒懂的方式描述本次變更或建議對用戶的實際影響。

- 標題統一用：`## 白話總結`
- 內容格式：用「點開 APP 會怎樣 / 用戶會看到什麼 / 用戶會感覺什麼」的情境式描述
- 避免使用技術詞彙（如 onSnapshot、Firestore、快取、Rules 等），必須翻譯成白話
- 若有對照前後差異，用「原本 → 改後」的簡短敘事
- 長度控制：1-5 行即可，不超過一個螢幕高度
- 適用於：功能實作建議、修復說明、審計結果、方案比較等所有技術類回覆
- 不適用於：純資訊查詢（如列檔案內容）、單行指令回覆
