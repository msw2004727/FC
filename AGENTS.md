# SportHub — Claude Code 專案指引

## 專案概述

**SportHub** 是一套運動活動報名與管理系統，提供用戶報名活動（PLAY / 友誼 / 教學 / 觀賽）、組建球隊、參加錦標賽、QR Code 簽到簽退及個人數據統計等功能。管理端提供活動管理、用戶管理、EXP 系統、成就徽章、廣告投放等後台能力。

- **部署平台**：自有域名 `toosterx.com`（Cloudflare Pages）、GitHub Pages（`msw2004727.github.io`）
- **使用者驗證**：LINE LIFF 登入
- **Demo 模式**：無需登入，使用靜態假資料瀏覽全功能

---

## 技術架構

| 類別 | 技術 |
|------|------|
| 前端 | Vanilla JS (ES6+)、HTML5、CSS3，**無框架、無 build 流程** |
| 資料庫 | Firebase Firestore |
| 儲存 / 驗證 | Firebase Storage + LINE LIFF SDK |
| 推播 / 後端 | LINE Messaging API + Firebase Cloud Functions (Node.js 20) |
| 離線支援 | Service Worker（sw.js） |

**無 npm / webpack / build**：前端為純靜態，直接以 `<script>` 載入，無需編譯。
**API Keys 直接硬編碼**：Firebase 設定在 `js/firebase-config.js`，LINE / 模式密碼在 `js/config.js`，參考 `.env.example` 對照。

---

## 目錄結構

```
FC-github/
├── index.html              # 主入口，定義所有 <script> 載入順序（約 40 個 ?v= 參數）
├── app.js                  # App 核心物件，4 階段初始化流程
├── sw.js                   # Service Worker
├── css/                    # 樣式（按頁面拆分：base / layout / home / activity / team 等共 11 個）
├── js/
│   ├── config.js           # 全域常數（CACHE_VERSION、ROLES、TYPE_CONFIG 等）、ModeManager
│   ├── data.js             # Demo 靜態資料集（結構對應 FirebaseService._cache）
│   ├── i18n.js             # 多語系翻譯字串
│   ├── firebase-config.js  # Firebase SDK 初始化，暴露 db / storage / auth
│   ├── firebase-service.js # 快取優先資料層，onSnapshot 即時同步，localStorage 持久化
│   ├── firebase-crud.js    # CRUD 操作（Object.assign 擴充 FirebaseService）
│   ├── api-service.js      # Demo / Prod 抽象層（依 ModeManager 切換資料來源）
│   ├── line-auth.js        # LINE LIFF 登入 / 登出 / 取得個人資料
│   ├── core/               # 基礎設施：page-loader / script-loader / navigation / theme / mode
│   └── modules/            # 功能模組 37 個（Object.assign 擴充 App）
│       ├── event-*.js      # 活動：列表、詳情、建立、管理、渲染
│       ├── team*.js        # 球隊：列表、詳情、表單
│       ├── tournament-*.js # 錦標賽：渲染、管理
│       ├── profile-*.js    # 個人資料：核心、資料、名片
│       ├── message-*.js    # 訊息：收件匣、管理員廣播
│       ├── user-admin-*.js # 用戶後台：列表、EXP、角色
│       ├── ad-manage-*.js  # 廣告管理：Banner、浮動廣告、贊助彈窗
│       └── [其他]          # scan / shop / dashboard / achievement / favorites /
│                           # leaderboard / announcement / auto-exp / banner /
│                           # role / site-theme / image-upload / popup-ad / personal-dashboard
├── pages/                  # HTML 片段（PageLoader 按需載入）
│   ├── home/activity/team/profile/message/modals/scan/shop/tournament/personal-dashboard.html
│   └── admin-dashboard / admin-users / admin-content / admin-auto-exp / admin-system.html
├── docs/                   # 專案文件（architecture.md、player-registration-plan.md）
└── functions/              # Cloud Functions：LINE push notification
```

---

## 快取版本號規則（每次修改必做）

當你修改了任何 JS 或 HTML 檔案後，**必須**同步更新快取版本號：

1. 更新 `js/config.js` 中的 `CACHE_VERSION` 常數
2. 更新 `index.html` 中所有 `?v=` 參數（CSS + JS，共約 40 處）
3. 版本號格式：`YYYYMMDD`，同天多次部署加後綴 `a`, `b`, `c`...

範例：`20260211` → `20260211a` → `20260211b` → `20260212`

> `page-loader.js` 的 fetch 會自動讀取 `CACHE_VERSION`，不需額外改。
> `sw.js` 內的 `CACHE_NAME` 是 Service Worker 獨立快取識別名稱，**一般改版不需動**，只有在需要強制清除所有 SW 快取時才一併更新。

---

## 架構文件

模組依賴關係圖與各層說明：[docs/architecture.md](docs/architecture.md)

---

## 模組建立規則

- **bug 修復或小幅調整** → 直接修改現有檔案
- **同一責任範圍的邏輯擴充** → 修改現有檔案
- **新的責任範圍或獨立業務邏輯** → 在 `js/modules/` 建立新模組，以 `Object.assign(App, {...})` 掛載
- **單一檔案不得超過 300 行**，超過則拆分（參考 `user-admin-list/exp/roles.js` 的拆分方式）

## 模組化演進目標（新增）

- 專案長期目標是逐步走向**功能模組化、資料夾化、責任邊界清楚**的架構；對於已明顯跨頁、跨責任、跨資料來源的功能，不應長期維持在單一大檔案中持續堆疊。
- 重構既有功能時，預設採用「**保留舊入口、內部邏輯逐步抽離到新資料夾**」的方式進行；除非使用者明確要求，否則不要直接做一次性大搬家。
- 若某功能已演進為多個責任混雜的領域（例如：前台顯示、後台管理、資料評估、共用 helper、狀態同步），應優先規劃同名資料夾，例如 `js/modules/achievement/`、`js/modules/tournament/`、`js/modules/user-admin/`，再逐步拆分。
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

---

## 程式碼規範

- 統一使用 `async/await`，不使用 `.then()` 鏈式呼叫
- 所有使用者輸入必須經過 `escapeHTML()` 處理，防止 XSS
- 資料操作統一透過 `ApiService`，不直接操作 `FirebaseService._cache` 或 `DemoData`
- 新模組以 `Object.assign(App, { ... })` 掛載，不建立全域變數
- Demo / Prod 分支邏輯統一在 `ApiService` 內處理，模組層不做 `ModeManager.isDemo()` 判斷
- **跨瀏覽器相容性檢查（每次修改前必做）**：每次計畫修改 CSS、JS、HTML 之前，必須先確認 LINE 瀏覽器（WebView）、Chrome、Safari 三端是否對齊。不得引入僅部分瀏覽器支援的 API 或 CSS 屬性而未提供 fallback（例如：`backdrop-filter` 需加 `-webkit-` 前綴、`dvh` 需有 `vh` fallback、`replaceAll` 需用 `replace(/…/g)` 替代、`navigator.clipboard` 需有 `execCommand` 降級）。若不確定相容性，應先查證後再實作，避免產生跨瀏覽器不一致或 BUG。

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
> 新紀錄必須寫在檔案前方（標題與說明之後），採新到舊排序；若需補記舊項目，應插入對應日期區段，不得追加到檔尾。
> 若 `docs/claude-memory.md` 出現亂碼、混合編碼或非 UTF-8 狀態，必須先修復並標準化回 UTF-8，再繼續追加到同一檔案。

---

## Demo / Production 優先順序

- **正式版（Production）永遠優先**：除非用戶主動要求更新或修正 Demo 版本，否則一律以正式版為優先開發與修復目標
- **用戶回報的所有問題與需求一律以正式版（Production）為前提**，除非用戶特別指明是 Demo 版，否則不要假設問題來自 Demo 模式
- 若修改的程式碼同時涵蓋 Demo 與 Production（例如共用函式），則兩者一起更新即可，無先後之分
- 當需要有先後順序時（例如時間有限或分批實作），**一律先完成正式版，再處理 Demo 版**

## 完成後自動部署規範

每次完成一項任務（功能開發、bug 修復、文件更新等）後，**必須**主動評估是否需要部署：

1. **評估條件**：若本次變更涉及任何 JS、HTML、CSS 或設定檔的修改，即視為需要部署
2. **主動執行**：確認需要部署時，主動執行 `git add` → `git commit` → `git push origin main`，不需等待用戶指示
3. **Commit 訊息**：遵循既有 commit 規範（中文描述、列出關鍵改動）
4. **若僅修改文件檔案**（如 `CLAUDE.md`、`AGENTS.md`、`docs/*.md`），也應主動 commit + push 以保持 repo 同步
5. **例外**：僅當用戶明確表示「先不要 push」或「等我確認」時，才暫緩部署

## 計劃回覆規範（新增）
- 當需求為「先計劃、不實作」時，回覆中必須同時提供：
- 風險評估（列出主要風險、影響範圍、可能後果）
- 工作量評估（拆分步驟並給出粗略工時或複雜度等級）

## 術語回覆格式規範（新增）
- 與使用者說明專案中的欄位、集合、函式、模組、規則、角色、設定鍵名或其他技術名詞時，預設使用「中文名稱（英文代碼）」格式。
- 第一次提到時必須寫成「中文名稱（`EnglishCode`）」；後續在同一段或同一小節中，若不致造成歧義，可只用中文名稱。
- 若該項目沒有合適的既有中文名稱，應先補一個簡短、穩定、易懂的中文名稱，再附上英文代碼。
- 除非使用者明確要求只看英文，否則不要只寫英文代碼。
- 適用範圍包含但不限於：Firestore 集合、文件欄位、JavaScript 函式、模組檔名、權限名稱、角色名稱、設定鍵名。

## 實作亂碼檢查規則（新增）
- 實作時（新增或修改任何檔案），必須檢查是否出現無法判讀的亂碼（mojibake / encoding corruption）。
- 若發現亂碼且可安全修復，必須在同一次變更中優先即時修復，不得延後。
- 若無法安全修復（例如來源不明或風險過高），必須在回覆中明確標註檔案與區段、說明風險，並提出可執行的修復方案。
- 若需修復歷史紀錄檔的編碼，必須以 `docs/claude-memory.md` 為唯一目標檔，先標準化為 UTF-8，再沿用原檔續寫，不得改寫到其他替代檔案。

## 防亂碼編碼規範（新增）
- 所有新增與修改的 repo 檔案一律以 UTF-8 保存；不得混用 ANSI、Big5、CP950、UTF-8 BOM 或其他不一致編碼。
- 只要檔案含中文內容，預設優先使用 diff-based 修補（如 Edit / apply_patch）修改；除非有明確必要，禁止以 Write 整檔覆寫或以 shell 讀出整檔再整段覆寫回 repo 檔案。
- 禁止使用未明確指定 UTF-8 的 shell 寫檔方式修改 repo 檔案，包括但不限於 `Out-File`、`Set-Content`、`Add-Content`、未指定 encoding 的 `WriteAllText` / `WriteAllLines`。
- 若不得不用 shell 寫回 repo 檔案，必須明確指定 UTF-8（無 BOM）或等效安全設定，並在同次變更中重新讀檢查結果。
- 若終端顯示為亂碼，必須先區分「終端顯示解碼錯誤」與「檔案實際內容已損壞」；禁止直接依據終端中的亂碼文字做 patch 或 replace。
- 若檔案已出現 mojibake、混合編碼、殘缺 HTML 標籤、字串引號不閉合等情況，必須先整體修復編碼與結構，再繼續做功能修改；不得在受損區塊上直接疊加新需求。
- 修改 `index.html`、`docs/claude-memory.md`、以及任何含中文 UI 文案的 `js/modules/*.js` 後，提交前必須重新檢查是否出現 `�`、`Ã`、`å`、`æ`、連續 `???`（0x3F 替換）、PUA 字元（U+E000–U+F8FF）、殘缺標籤、殘缺引號或其他典型 mojibake 痕跡。
- 若只是批次更新版本號、快取參數、meta 標籤或文件文字，也同樣適用上述編碼規範，不得因為是小改動而省略檢查。
- 若發現亂碼無法安全修復，必須在回覆中明確標註受影響檔案、區段、風險與建議處理方式；不得在未說明風險的情況下直接提交。
