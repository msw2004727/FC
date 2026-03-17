# SportHub — Claude Code 專案指引

<!--
  結構文件交叉引用（任一檔案的結構描述更新時，必須同步更新以下所有檔案）：
  - docs/architecture.md       ← 完整架構圖 + 模組清單 + Mermaid 圖
  - docs/structure-guide.md    ← 中文功能導覽圖（給人看的，附功能解釋）
  - CLAUDE.md                  ← 目錄結構概覽（§ 目錄結構）
  - AGENTS.md                  ← 目錄結構指引（§ 目錄結構）
-->

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
| 推播 / 後端 | LINE Messaging API + Firebase Cloud Functions (Node.js 22) |
| 離線支援 | Service Worker（sw.js） |

**無 npm / webpack / build**：前端為純靜態，直接以 `<script>` 載入，無需編譯。
**API Keys 直接硬編碼**：Firebase 設定在 `js/firebase-config.js`，LINE / 模式密碼在 `js/config.js`，參考 `.env.example` 對照。

---

## 目錄結構

> 目錄結構與模組清單統一維護於 `CLAUDE.md`（概覽）、`docs/architecture.md`（完整架構圖）和 `docs/structure-guide.md`（中文功能導覽），此處不重複列出。

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
- **單一檔案不得超過 300 行**，超過則拆分（新模組放入對應功能子資料夾（如 js/modules/event/、js/modules/team/），參考既有資料夾結構）

## 模組化演進目標（新增）

- 專案長期目標是逐步走向**功能模組化、資料夾化、責任邊界清楚**的架構；對於已明顯跨頁、跨責任、跨資料來源的功能，不應長期維持在單一大檔案中持續堆疊。
- 重構既有功能時，預設採用「**保留舊入口、內部邏輯逐步抽離到新資料夾**」的方式進行；除非使用者明確要求，否則不要直接做一次性大搬家。
- 已完成 12 個功能子資料夾化（achievement / tournament / user-admin / event / team / profile / message / scan / dashboard / kickball / ad-manage / shot-game），新增模組應放入對應子資料夾。
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

---

## 程式碼規範

- 統一使用 `async/await`，不使用 `.then()` 鏈式呼叫
- 所有使用者輸入必須經過 `escapeHTML()` 處理，防止 XSS
- 資料操作統一透過 `ApiService`，不直接操作 `FirebaseService._cache` 或 `DemoData`
- 新模組以 `Object.assign(App, { ... })` 掛載，不建立全域變數
- Demo / Prod 分支邏輯統一在 `ApiService` 內處理，模組層不做 `ModeManager.isDemo()` 判斷
- **跨瀏覽器相容性檢查（每次修改前必做）**：每次計畫修改 CSS、JS、HTML 之前，必須先確認 LINE 瀏覽器（WebView）、Chrome、Safari 三端是否對齊。不得引入僅部分瀏覽器支援的 API 或 CSS 屬性而未提供 fallback（例如：`backdrop-filter` 需加 `-webkit-` 前綴、`dvh` 需有 `vh` fallback、`replaceAll` 需用 `replace(/…/g)` 替代、`navigator.clipboard` 需有 `execCommand` 降級）。若不確定相容性，應先查證後再實作，避免產生跨瀏覽器不一致或 BUG。
- **用戶 ID 欄位命名規範**：所有新增的 Firestore 寫入若需記錄操作者或所屬用戶，**必須包含 `uid` 欄位**（值為 Firebase Auth UID = LINE userId）。禁止只存顯示名稱不存 UID。既有集合欄位對照：`users` → `uid`、`registrations` → `userId`、`attendanceRecords` → `uid`、`activityRecords` → `uid`、`events` → `creatorUid`、`expLogs` → `uid`、`operationLogs` → `uid`。

---

## 分享功能設計規範（LIFF URL 優先）

所有面向用戶的分享功能**必須優先使用 LIFF URL**（`https://liff.line.me/{LIFF_ID}?param=value`），確保連結在 LINE 內建瀏覽器開啟。

### 強制規則
1. **禁止直接分享 `toosterx.com` URL 給用戶**：一律使用 LIFF URL
2. **分享優先順序**：`liff.shareTargetPicker()`（Flex Message）→ 底部選單複製連結 → `navigator.share()` → clipboard fallback
3. **新增分享功能比照 `event-share.js` 模式**：Action Sheet + Flex Message + 防連點 + altText 截斷 + fallback
4. **QR Code 也必須編碼 LIFF URL**
5. **Deep link 參數**：`?event=` / `?team=` / `?tournament=` / `?profile=` — 依功能擴展
6. **LINE Developers Console**：使用 `shareTargetPicker` 的 LIFF App 必須確認 Console 中開關為 ON

---

## 報名系統保護規則（核心模組鎖定）

報名系統是最核心的業務邏輯，歷史上多次因修改引發嚴重 bug（人數覆蓋、候補未遞補、超收）。以下規則**強制適用**：

### 鎖定範圍（修改需特別審查）
| 檔案 | 鎖定函式 |
|------|----------|
| `js/firebase-crud.js` | `registerForEvent`、`batchRegisterForEvent`、`cancelRegistration`、`cancelCompanionRegistrations`、`_rebuildOccupancy`、`_applyRebuildOccupancy` |
| `js/modules/event/event-detail-signup.js` | `handleSignup`、`handleCancelSignup` |
| `js/modules/event/event-detail-companion.js` | `_confirmCompanionRegister`、`_confirmCompanionCancel` |

### 強制規則
1. **禁止使用本地快取作為計數來源**：`_rebuildOccupancy` 的輸入必須來自 Firestore 查詢，禁止用 `this._cache.registrations` 計數
2. **禁止手動 `current++` / `current--`**：必須透過 `_rebuildOccupancy()` 統一重建（Demo 模式除外）
3. **必須使用原子操作**：報名寫入用 `db.runTransaction()` 或 `db.batch()`
4. **候補遞補必須在同一 batch**：取消正取與遞補必須同一 batch 內完成
5. **修改後必須驗證**：執行 `docs/registration-integrity-check.js` 確認一致性
6. **`_rebuildOccupancy` 禁止引入副作用**：不寫快取、不呼叫 API、不修改傳入參數

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
