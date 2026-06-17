# ToosterX — Claude Code 專案指引

> **Last Reviewed: 2026-05-15**（每 2 個月審閱一次，或重大架構重構時立即審閱）

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
| 🎨 **設計系統** | UI/UX 設計原則 · 設計 token（明暗主題）· 共用動畫規範 · 名單暱稱膠囊 |
| 📝 **流程** | 修復日誌 · SEO 日誌 · 自動部署 · 計劃與建議回覆 · 回覆結尾白話總結 |
| 🛠️ **編碼** | 編碼與亂碼規範 |

## 永久地雷清單（讀前必看）

歷史上**重複踩過**的坑，修改相關檔案前必須先查閱對應章節或歷史紀錄：

| 地雷 | 症狀 | 詳情位置 |
|------|------|---------|
| **活動 ID 橋接規則**（新活動 `doc.id=data.id`、舊活動雙軌相容） | 統計歸零、跨集合 join 失敗 | §程式碼規範 最末條 |
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
├── css/                    # 樣式（19 個 CSS）
├── js/
│   ├── config.js           # 全域常數、ModeManager
│   ├── i18n.js             # 多語系
│   ├── firebase-config.js  # Firebase SDK 初始化
│   ├── firebase-service.js # 快取優先資料層
│   ├── firebase-crud.js    # CRUD 操作
│   ├── api-service.js      # Demo / Prod 抽象層
│   ├── line-auth.js        # LINE LIFF 登入
│   ├── core/               # 基礎設施（4 個）
│   └── modules/            # 功能模組（16 子資料夾 + 31 獨立檔案）
│       ├── event/          # 活動系統（47）：列表、詳情、報名、建立、管理、分享、terminal 載入
│       ├── team/           # 俱樂部系統（20）：列表、詳情、表單、動態牆、分享、helpers/stats/builders/validate/roles/invite
│       ├── tournament/     # 賽事系統（24）：渲染、詳情、管理、友誼賽、helpers/builders/state
│       ├── profile/        # 個人資料（9）：核心、資料、名片、分享
│       ├── message/        # 訊息系統（17）：渲染、操作、收件匣、私訊、聊天室稽核、管理員
│       ├── achievement/    # 成就系統（11）：registry / evaluator / badges 等
│       ├── education/      # 教育型俱樂部（27）：分組、學員、課程、報名、簽到、行事曆
│       ├── color-cat/      # 養成角色系統（40）：角色、戰鬥、敵人、場景、AI、MBTI、對話
│       ├── shot-game/      # 射門遊戲（10）：引擎、物理、渲染、計分
│       ├── kickball/       # 踢球遊戲（6）：物理、渲染、排行榜
│       ├── scan/           # QR 掃描（5）：掃描、處理、家庭成員
│       ├── dashboard/      # 儀表板（20）：管理員、個人、報表分享、用量
│       ├── ad-manage/      # 廣告管理（6）：輪播、浮動、贊助、小遊戲、品牌開機
│       ├── user-admin/     # 用戶後台（8）：列表、EXP、角色、補正、權限說明、UID 檢查、權限測試
│       └── [31 獨立模組]   # banner / home-dashboard / shop / leaderboard / role / pwa-install 等
├── pages/                  # HTML 片段（20 個）
├── docs/                   # 專案文件
│   ├── archive/            # 歷史/已結束計畫書歸檔
│   ├── completed/          # 已完成且保留驗收脈絡的計畫
│   ├── specs/              # 正式規格與長期設計文件
│   └── previews/           # AI/設計視覺預覽 HTML，不當正式入口
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

### 文件結構整理規則

- `docs/` 是本機專案知識庫，包含架構、測試覆蓋、調校參數、SEO log、歷史教訓、規格、active workflow 與預覽檔；**不得追蹤到 Git，也不得發布到公開 GitHub 或靜態部署輸出**。
- `tools/` 是本機或臨時診斷腳本資料夾；**不得追蹤到 Git，也不得發布到公開 GitHub 或靜態部署輸出**。需要瀏覽器 console 診斷時，只能由維護者在本機或受控環境手動載入。
- 若發現 `docs/` 或 `tools/` 已被 Git 追蹤，必須用 `git rm --cached -r docs tools` 只移除追蹤，不得刪除本機檔案；`.gitignore` 必須保留 `docs/` 與 `tools/`。
- 不要把需要 CI、正式站 runtime、後端部署或公開 SEO 的資料夾移成本機專用。目前 `tests/`、`.github/`、`functions/`、`scripts/`、`LOGO/`、`PWA/`、`permissions/`、`roles/`、`inventory/`、`valuation/`、`blog/`、`seo/` 都有測試、部署、runtime 或公開頁用途，必須保留在 Git。
- `docs/` 根目錄只保留仍需優先閱讀的活躍文件、active workflow 或正在執行的計畫。
- 已結束、歷史審計或暫不執行的計畫書放 `docs/archive/`，避免根目錄堆積。
- 已實作完成但仍需保留驗收脈絡的計畫放 `docs/completed/`。
- 正式規格與長期設計文件放 `docs/specs/`。
- AI 或人工用來快速呈現視覺結果的 HTML 預覽檔放 `docs/previews/`；例如 `docs/previews/demo.html`，不得當成正式產品入口。
- 本機輸出與暫存檔如 `.gcloud/`、`debug.log`、`test-results/` 必須忽略，不進 Git。

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
- 已完成 16 個功能子資料夾化（achievement / tournament / user-admin / event / team / profile / message / scan / dashboard / kickball / ad-manage / shot-game / education / color-cat / auto-exp / admin-seo ），新增模組應放入對應子資料夾。
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
   - **同步權限測試報告**：新增、刪除或調整 `DRAWER_MENUS`、`ADMIN_PAGE_EXTRA_PERMISSION_ITEMS`、`ROLE_ACTIVITY_CAPABILITY_ITEMS`、`rolePermissions` 或 `roleActivityCapabilities` 時，必須同步檢查 `js/modules/user-admin/permission-audit/`。此資料夾是「權限管理 > 權限測試」的一次性只讀報告來源，需維持能覆蓋所有角色、抽屜入口、子權限、一般 user 前台活動能力與高風險權限組合。
   - **`event.edit_all` 是全活動編輯唯一總開關**：沒有 `event.edit_all` 時，活動管理列表與活動詳細頁「活動編輯」只能作用於自己建立或受委託活動；`activity.manage.entry` 只代表入口/管理頁可見，不可當成跨活動編輯授權。
   - **不確定是否需要新增權限時**：應先向用戶說明該功能的存取需求，並建議適合的權限碼命名與層級配置，由用戶決定是否新增。
   - **權限碼命名規則**：入口權限以 `.entry` 結尾（如 `admin.xxx.entry`），子權限以動作命名（如 `xxx.create`、`xxx.edit_all`、`xxx.delete`）。
   - **歷史權限碼正規化**：若權限碼改名，不可只改 UI catalog；必須同步維護 `js/config.js` 與 `functions/index.js` 的 legacy permission normalization，並更新 `permission-audit` 測試，避免資料庫舊 `rolePermissions` 讓前後端判斷不一致。
   - **`INHERENT_ROLE_PERMISSIONS` 兩地同步（強制）**：此常數同時定義於 `js/config.js` 與 `functions/index.js`（無 build process 故無法共用）。修改任一邊時**必須同步更新另一邊**，否則前端 UI 顯示與後端驗證行為將出現無錯誤訊息的靜默分歧。
   - **`hasPermission` 守衛新增規則（強制，歷史教訓）**：新增 `hasPermission()` 前端守衛時，**禁止**使用 `if (!hasPermission(...)) return` 直接擋回的寫法。必須遵守以下規則：
     - **「查看」類功能不加守衛**：報名名單（`_renderAttendanceTable`）、活動詳情等查看類渲染函式，預設所有登入用戶可見，不加權限守衛。管理操作（編輯/刪除/簽到）才需要守衛。
     - **管理操作守衛必須有 fallback**：格式為 `if (!hasPermission('xxx') && !hasPermission('activity.manage.entry')) { if (!_canManageEvent(e)) { showToast('權限不足'); return; } }`。確保主辦/委託人即使沒有顯式權限碼也能操作自己管理的活動。
     - **按鈕與功能一致性**：若 `canManage`（`_canManageEvent`）決定了按鈕顯示，對應的函式守衛必須包含同等的 `_canManageEvent` fallback，否則會出現「看得到按鈕但點不動」的 UX 缺陷。
     - **測試覆蓋**：新增守衛後必須用 `user`（一般用戶）、`coach`、`captain`、以及「一般 user 但為委託人」四種身分驗證行為。
     - **委託人功能範圍**：委託人只需要手動簽到（`_startTableEdit`）+ 現場掃碼（`renderScanPage`），不需要編輯/結束/刪除活動的權限。

---

## 一般 user 活動特殊權限設計（強制）

> 2026-05-14 補充：一般 user 的活動能力是第二套「前台活動能力」，不是傳統 `rolePermissions`。修改活動建立、活動管理、權限管理、Firestore Rules 或權限快取時，必須先檢查本節。

### 兩套權限的責任邊界

- 傳統角色權限：`rolePermissions` / `hasPermission(...)`，用於後台、管理入口、admin/coach/captain/venue_owner 等一般角色權限。**不要直接把 `activity.manage.entry` 或 `event.create` 下放給一般 user**，否則會放大既有活動管理權限。
- 一般 user 前台活動能力：`roleActivityCapabilities/user.capabilities`，只控制一般 user 在「自己主辦或被委託的活動」範圍內可以做什麼。
- Firestore Rules 需與前端一致：一般 user 建立/管理自己活動時，應走 owner-scope capability，例如 `hasActivityCap('user.activity.basic_create')`，而不是走全域管理權限。
- 一般 user 的活動能力可以在權限管理 UI 裡手動啟閉，**不是鎖死預設值**。預設只是初始值，不可覆蓋管理員手動設定。

### 一般 user 活動能力清單

`roleActivityCapabilities/user.capabilities` 目前支援：

- `user.activity.basic_create`：一般 user 可以建立基本活動。
- `user.activity.external_create`：可以建立外部活動連結。
- `user.activity.own_manage_entry`：可以看到自己活動的管理入口。
- `user.activity.own_edit_basic`：可以編輯自己活動基本資料。
- `user.activity.own_cancel`：可以取消自己主辦的活動。
- `user.activity.site_operate`：可以操作自己活動的現場簽到與候補相關流程。
- `user.activity.delegate_assign`：可以設定自己活動的委託人。
- `user.activity.addons_use`：可以使用新增活動內的進階/加值功能，例如私密活動、收費、女生專屬、社群連結等加值欄位。

### 加值功能規則

- `user.activity.addons_use` 預設關閉，但權限管理中手動開啟後必須保留。
- 一般 user 未開啟 `user.activity.addons_use` 時，新增活動內的加值/進階開關應阻擋並 Toast：「如需更多功能請聯繫官方Line@」。
- 一般 user 已開啟 `user.activity.addons_use` 時，可以建立含加值欄位的自己活動；Firestore Rules 必須允許與此 capability 相符的 payload。
- 測試覆蓋至少要包含：未開啟 add-ons 時加值欄位被拒、開啟 add-ons 時完整前端 payload 可建立、UI 讀取開關刷新後仍保留。

### 權限快取與資料形狀規則

- `roleActivityCapabilities` 在 `FirebaseService._cache`、localStorage、`ApiService.getRoleActivityCapabilities(...)` 中必須維持物件形狀：`{ user: ['capability.code'] }`。
- Firestore collection 靜態載入會拿到文件陣列，例如 `[{ _docId: 'user', capabilities: [...] }]`；載入後必須立刻正規化為 `{ user: [...] }`，不可直接覆蓋 `_cache.roleActivityCapabilities`。
- 即時監聽、靜態載入、localStorage 還原、儲存後 optimistic cache，都要走同一套正規化邏輯。參考：`FirebaseService._normalizeRoleActivityCapabilitiesCache(...)`。
- `ApiService.getRoleActivityCapabilities('user')` 可以容忍舊版陣列快取，但新寫入與新保存不得再產生陣列形狀。
- `_seedRoleData()` 或 catalog version migration 不得用 default 覆蓋 Firestore 既有 `capabilities`。若 Firestore 已有 `capabilities: []`，也代表管理員手動關閉全部能力，必須保留空陣列。
- 新增/修改 capability 時，需同步更新：
  - `js/config.js` 的 `ROLE_ACTIVITY_CAPABILITY_ITEMS`
  - `functions/index.js` 的 capability allowlist（如有 server side 檢查）
  - `firestore.rules` 的 `hasActivityCap(...)` / create/update allow 邏輯
  - 權限管理 UI：`js/modules/user-admin/user-admin-roles.js`
  - 單元測試與 rules 測試：至少覆蓋快取形狀、讀取 fallback、Firestore allow/deny。

### 審計提醒

- 若權限管理中「一般 user 前台活動能力」刷新後開關變回預設，優先檢查 `roleActivityCapabilities` 是否被陣列形狀覆蓋，或 `_seedRoleData()` 是否用 default 洗掉 Firestore 既有值。
- 若一般 user 建立私密活動顯示「建立活動失敗」，優先檢查：
  1. `roleActivityCapabilities/user.capabilities` 是否含 `user.activity.addons_use`
  2. 前端 `ApiService.hasRoleActivityCapability('user', 'user.activity.addons_use')` 是否讀到 true
  3. Firestore Rules `hasActivityCap('user.activity.addons_use')` 是否允許該 payload
  4. payload 是否含其他仍需 admin/coach 權限的欄位，例如 team scope 相關欄位。

---

## 活動頁終端活動載入與已結束規則（2026-05-15）

- 前台活動頁不再提供「已結束」頁籤；舊 hash、舊 state 或舊連結若帶 `ended`，`event-list.js` 必須正規化回 `normal`。
- 一般結束與手動取消共用同一條前台顯示規則：活動結束時間 + 6 小時後才視為活動頁 terminal；6 小時內仍留在「報名中」列表。
- 前台只載入少量 terminal preview（目前 50 筆）維持 6 小時判定與最近狀態，不可為了活動頁全量載入歷史已結束/已取消活動。
- 活動管理仍可看已結束/已取消歷史；需要完整歷史時由 `FirebaseService.ensureTerminalEventsLoaded({ mode: 'history' })` 升級，並用 `loadMoreTerminalEvents()` 分頁。
- 修改活動列表、取消活動、auto-end、或 terminal event cache 時，必須同步跑 `tests/unit/activity-terminal-events-loading.test.js`、`tests/unit/event-ended-tab-delay.test.js` 與活動列表相關測試。

---

## UI/UX 設計系統規範（強制，2026-06-17）

> 目的：讓未來所有新頁面與改版維持一致的視覺語言與「去 AI 感」的業界級質感。新增或重構任何前台 UI 前必讀本節。參考實作見本機 `docs/previews/member-management-redesign-demo.html`（local-only 預覽）。

### 設計原則（去 AI 感）

- **單一主色 + 中性色階**：主色只用一個（emerald），其餘以中性 slate 表達；禁止多種高彩度顏色互相競爭。
- **低飽和 tinted 徽章**：角色／狀態標籤用「淺底深字」（深色主題反轉為深底亮字），不用糖果色。
- **hairline 分隔取代厚框卡**：列表項以 1px 細線分隔，不要每項一個外框，提高密度與閱讀連貫性。
- **線性 SVG 圖示取代 emoji**：功能性圖示（編輯、更多、備註…）一律用 16–18px 線性 SVG ＋ hover 態；**禁止用 emoji（✎ ⋮ 📝）當功能按鈕**。
- **8pt 間距系統 + 統一圓角**；數字（背號、統計）用 `font-variant-numeric: tabular-nums` 對齊。
- **明確空狀態文案**：用「未設背號／未分組」取代「-」「#-」這類 placeholder 感字樣。
- **頭像**：優先 LINE 大頭照（`pictureUrl`／`avatarUrl`，見 `identity-resolver.js`），無照片才用「姓名首字 ＋ 色塊」fallback。

### 設計 token（對應明暗主題）

沿用既有 `css/base.css` 的主題變數機制；新元件一律吃 CSS 變數，**不寫死色碼**。

| Token | 用途 | Light | Dark |
|------|------|------|------|
| `surface` | 面板／卡片底 | `#ffffff` | `#12161d` |
| `ink` | 主要文字 | `#0f172a` | `#e7ebf1` |
| `ink-2` | 次要文字 | `#475569` | `#9aa6b4` |
| `ink-3` | 弱化文字 | `#94a3b8` | `#69727f` |
| `line` | 分隔線 | `#eef1f4` | `#1e242d` |
| `accent` | 強調主色 | `#0b7a5c` | `#5fe0b0` |
| `chip` | 晶片／備註底 | `#f1f5f9` | `#1b222c` |

- 間距：4 / 8 / 12 / 16 / 20（以 8pt 為基準）。圓角：列表／晶片 8–9px、卡片／面板 14–22px。
- 角色色票（依主題「淺底深字／深底亮字」）：球經 indigo、領隊 amber、教練 violet、學員 teal/cyan。

### 深色主題準則

- **不用純黑**：底 `#12161d`、分隔 `#1e242d`，避免純黑刺眼與邊界消失。
- **文字分三階對比**（主／次／弱），不要全部死白。
- **角色色票深底亮字**；選取態／實心元件做「亮底深字」反轉，確保兩主題都夠醒目。
- **主色於暗背景需提亮**（`#0b7a5c → #5fe0b0`）。

### 共用動畫規範（強制 — 加載動畫一致性）

- **現況問題（2026-06-17 盤點）**：`css/` 內已有 **60+ 個各自定義的 `@keyframes`**（`spin` 重複定義、`*-loading-spin`、`*-shimmer`、`skel-*`、`signup-*-spin`…），散落 12+ 個 css 檔，導致載入動畫速度／節奏不一致、維護困難。
- **規則**：
  1. 共用動畫一律集中定義在 `css/base.css`，以 `ui-` 命名前綴提供「標準 keyframes ＋ utility class」。
  2. 新功能的 loading / skeleton / spinner / 進場動畫**必須複用**共用集合，**禁止**再為個別模組複製同義的 keyframes。
  3. 動畫時長／緩動使用統一 token，不分散寫死數值。
  4. 必須支援 `prefers-reduced-motion: reduce`（關閉或大幅減弱動畫）。
  5. 既有重複動畫採「**逐步收斂**」：新代碼走共用集合；舊的在重構該模組時才改名／移除（外科手術式，不一次性大搬）。
- **標準 token 與集合（可直接放進 `css/base.css`）**：

```css
:root{
  --ui-dur-fast:150ms; --ui-dur:220ms; --ui-dur-slow:400ms;
  --ui-ease:cubic-bezier(.2,.8,.2,1);
  --ui-spin-dur:.9s; --ui-shimmer-dur:1.2s;
}
@keyframes ui-spin{to{transform:rotate(360deg)}}
@keyframes ui-pulse{0%,100%{opacity:1}50%{opacity:.5}}
@keyframes ui-shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
@keyframes ui-fade-in{from{opacity:0}to{opacity:1}}
@keyframes ui-slide-up{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}

.ui-spin{animation:ui-spin var(--ui-spin-dur) linear infinite}
.ui-pulse{animation:ui-pulse 1.4s var(--ui-ease) infinite}
.ui-fade-in{animation:ui-fade-in var(--ui-dur) var(--ui-ease) both}
.ui-slide-up{animation:ui-slide-up var(--ui-dur) var(--ui-ease) both}
.ui-skeleton{
  background:linear-gradient(90deg,var(--chip) 25%,rgba(148,163,184,.18) 37%,var(--chip) 63%);
  background-size:200% 100%;
  animation:ui-shimmer var(--ui-shimmer-dur) linear infinite;
  border-radius:8px;
}
@media (prefers-reduced-motion:reduce){
  .ui-spin,.ui-pulse,.ui-fade-in,.ui-slide-up,.ui-skeleton{animation:none}
}
```

- 動畫時長屬可調 timing：若日後調整這些 token，依 §每次新增功能時的規範 第 8 條同步 `docs/tunables.md`。

### 名單暱稱膠囊（user-capsule）統一規範（強制，2026-06-17）

> 凡是會「列出用戶」的畫面——活動報名／簽到名單、成員管理、學員名單、隊員／賽事名單、排行榜、後台用戶列表、動態牆作者、訊息列表等——暱稱一律使用共用元件 `.user-capsule` 呈現，不得自行拼裝名稱樣式。目的：讓全專案所有名單的暱稱呈現完全一致。

- **必須走中央產生器**：暱稱膠囊一律由 `App._userTag(name, forceRole, options)`（`js/modules/profile/profile-core.js`）輸出；**禁止**在各模組自行手寫 `<span class="user-capsule …">` 或寫死 `uc-user`（會導致層級底色、`Lv`、出席率等資訊失效並造成各頁不一致）。
- **底色語意 ＝ 角色／權限身分（非等級）**：產生器依角色給 `uc-<role>` 底色；等級由左上 `Lv` badge 表示，兩者分開。角色色票（含深色主題）定義於 `css/profile.css`：

  | class | 身分 | 淺色底 |
  |------|------|------|
  | `uc-user` | 一般用戶 | 中性 |
  | `uc-coach` | 教練 | 琥珀 |
  | `uc-captain` | 隊長 | 紫 |
  | `uc-team-leader` | 領隊 | 藍 |
  | `uc-venue_owner` | 場地主 | 橘 |
  | `uc-admin` | 管理員 | 藍 |
  | `uc-super_admin` | 超級管理員 | 紅 |

- **附掛資訊由產生器負責**（依 `options` 帶入，不得自行另作）：左上 `Lv` 等級 badge、出席率（放鴿子）染色 `uc-att-warn`、最近放鴿子 🕊 `uc-recent-noshow`、右上色衣背號 `uc-team-jersey`。
- **點擊行為一致**：膠囊點擊一律導向用戶名片 `App.showUserProfile(name, { uid })`。
- **身分以 UID 為準**：傳入 `options.uid`（＝ LINE userId，見 §實體 ID 統一規範）；名稱僅供顯示，不可用名稱做身分查詢。
- **不適用情境**：純文字輸入欄位、需要 inline 編輯的儲存格等「非展示用名稱」情境。
- **既有未照做的名單**：不在本規範回溯範圍；待各該畫面重構時再依 §模組化演進「逐步收斂」回中央產生器，不一次性大改。
- **驗收**：新增或改動名單畫面後，依下節「套用範圍與驗證」跑 desktop ＋ mobile ＋ 明暗主題瀏覽器檢查，確認膠囊底色、`Lv`、點擊名片皆正常。

### 套用範圍與驗證

- 適用於所有新前台頁面與既有 UI 改版；屬純前端，不動後端。
- 改 CSS／HTML 後須跑 §前端 UI 本機瀏覽器驗證（desktop ＋ mobile ＋ 明暗主題各看一輪）。
- **將共用動畫實作進 `css/base.css` 屬 runtime 變更**：需 bump 版號、跑相關測試、依 §部署前審查流程(SOP) 過 Codex review 再 push（本節僅為文件規範，尚未動到 `css/base.css`）。

---

## 測試與 CI 規範（強制）

### CI 自動驗證

本專案已設定 GitHub Actions（`.github/workflows/test.yml`），在 push 或 PR 到 `main` 時自動跑以下檢查：
- `npm run check:registration-ops` — 報名操作鎖定檢查
- `npm run test:unit` — 純函式單元測試
- `npm run test:unit:coverage` — 單元測試覆蓋率摘要
- `npm run test:rules` — Firestore 規則測試（需 Java 21 + Firebase Emulator）
- `npm run test:e2e:smoke` — Playwright Chromium smoke test（CI 會啟動本地靜態站）

**CI 失敗時 GitHub 會顯示紅色錯誤**（本專案直推 `main`，無分支保護，不會擋 push，但代表回歸失敗必須立即修復）。push 前應本地先跑，避免出錯後才來回補救。

### 測試指令清單

| 指令 | 用途 |
|------|------|
| `npm run test:unit` | 純函式單元測試（Jest，無需 emulator） |
| `npm run test:rules` | Firestore 規則測試（自動啟 emulator） |
| `npm run test:e2e` | Playwright E2E（需本地 `npx serve . -l 3000`） |
| `npm run test:e2e:smoke` | Playwright Chromium desktop smoke test（CI 同步執行） |
| `npm run test:e2e:visual` | Playwright mobile visual guard（適合 UI/版面回歸） |
| `npm run test:e2e:admin` | Playwright admin desktop guard |
| `npm run test:unit:coverage` | 單元測試 + 覆蓋率報告 |

完整測試清單與對應來源檔案：見 `docs/test-coverage.md`。

### 何時必須跑測試（強制）

| 修改範圍 | 必跑指令 | 理由 |
|----------|----------|------|
| `firestore.rules` | `npm run test:rules` | CI 會失敗，且 Rules 錯誤會直接破壞 prod 權限 |
| `js/firebase-crud.js`（報名/取消/遞補鎖定函式，清單見 §報名系統保護規則） | `npm run test:unit` | 歷史多次回歸 bug，測試是最後防線 |
| `js/modules/achievement/stats.js`（統計鎖定函式，清單見 §統計系統保護規則） | `npm run test:unit` | 同上 |
| `js/modules/**` 其他模組 | `npm run test:unit` | CI 會失敗，本地先驗省來回補救 |
| CSS / HTML / 前端 UI 呈現或互動 | 相關單元測試 + 本地瀏覽器 desktop/mobile 驗證；若有對應 E2E，跑 `npm run test:e2e:smoke` 或目標 Playwright 測試 | 單元測試看不到跑版、重疊、文字溢出、按鈕擠壓與 console error |
| `functions/index.js`（Cloud Functions） | `npm run test:functions` + 部署後 `firebase functions:log` 驗證 | Functions 有基礎 source contract 測試，但 production 仍需部署後觀察 |
| 純文件變更（`*.md`、`docs/**`） | 無 | 不觸發測試 |

### 前端 UI 本機瀏覽器驗證（強制）

每次完成前端 UI 修改後（包含 CSS、HTML、DOM render、卡片/列表/彈窗/表單/按鈕/載入狀態、responsive layout、主題樣式或互動狀態），必須實際啟動本機頁面並用瀏覽器檢查，不得只靠單元測試或靜態 diff 判斷。

驗證方式：
1. 啟動本地靜態站，例如 `node tests/e2e/static-server.cjs 3000` 或 `npx serve . -l 3000`。
2. 用 Browser / Playwright / Chrome 實際打開本機頁面，至少檢查 desktop 與 mobile viewport。建議基準：desktop `1280x720` 或 `1366x768`，mobile `390x844` 或 `375x812`；若修改特定斷點，必須加測該斷點。
3. 檢查目標流程與鄰近 UI：不得跑版、重疊、文字溢出、按鈕擠壓、無法點擊、焦點/滾動異常，且 console 不得出現新的 error。
4. 若發現視覺或互動問題，必須直接修正並重新跑同一組 viewport 驗證後再回報。
5. 回報時列出實際檢查的頁面/流程、viewport、瀏覽器或 Playwright 指令，以及 console 是否乾淨。若因環境限制無法啟動本機頁面或瀏覽器，必須明確標註「UI 瀏覽器驗證未完成」與原因，不得用單元測試通過替代。

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
  - **活動（events）**：新建活動必須使用 `db.collection('events').doc(eventId).set(...)`（或 transaction set）讓 `events/{eventId}` 的 Firestore 文件 ID 與 `data.id` 相同，`eventId` 只允許系統產生的安全格式 `[A-Za-z0-9_-]{1,120}`，禁止使用 `add()` 讓 Firestore 產生隨機 doc.id。歷史活動維持既有 `data.id` + `_docId` 雙軌資料，不做大遷移；所有讀寫仍需保留橋接 fallback。
  - **ID 生成統一**：所有新建實體的 ID 必須使用 `generateId(prefix)` 函式（`config.js`），禁止內聯拼接。前綴對照：`tm_`=俱樂部、`ct_`=賽事、`ce_`=活動、`reg_`=報名、`fp_`=動態牆貼文、`fc_`=動態牆留言、`ta_`=賽事申請、`cm_`=賽事比賽（盃賽/聯賽 matches 子集合）。
- **活動 ID 橋接規則（永久，歷史教訓 2026-04-11；新規 2026-05-08）**：2026-05-08 起新活動必須 `data.id === _docId === events/{eventId}`；舊活動仍可能是 Firestore 隨機 `doc.id`（如 `ga0CqtaPpjRwimUGEZfU`）搭配活動自訂 `data.id`（如 `ce_1774920121549_j63p`）。`registrations.eventId`、`attendanceRecords.eventId`、`activityRecords.eventId` 永遠存活動公開 ID，也就是 `data.id`，不是舊資料的隨機 `doc.id`。任何需要寫入 `events/{docId}/...` 子集合的流程，必須先透過 `FirebaseService._getEventDocIdAsync(eventId)` 或 Cloud Functions 的等價橋接 helper 解析：先查新制 `events/{eventId}`，找不到再 fallback `where('id','==',eventId)`。禁止為了統一 ID 大量搬移舊資料；遇到統計歸零、跨集合 join 配不上時，第一步檢查是否混用了公開 `eventId` 與 Firestore `_docId`。

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

### 根網址 Query 跳轉規則

| 網址形式 | 目前行為 | 用途 |
|----------|----------|------|
| `https://toosterx.com/?event={eventId}` | `index.html` 會跳轉到 `https://miniapp.line.me/2009525300-AuPGQ0sh?event={eventId}` | 舊 deep link / Mini App 開啟入口 |
| `https://toosterx.com/?team={teamId}` | `index.html` 會跳轉到 `https://miniapp.line.me/2009525300-AuPGQ0sh?team={teamId}` | 俱樂部 / 球隊 deep link |
| `https://toosterx.com/?tournament={tournamentId}` | `index.html` 會跳轉到 `https://miniapp.line.me/2009525300-AuPGQ0sh?tournament={tournamentId}` | 賽事 deep link |
| `https://toosterx.com/?profile={uid}` | `index.html` 會跳轉到 `https://miniapp.line.me/2009525300-AuPGQ0sh?profile={uid}` | 個人名片 deep link |
| `https://toosterx.com/event-share/{eventId}` | OG crawler 停留讀取活動縮圖；一般使用者自動進網站活動頁 `/events/{eventId}`，不跳 Mini App、不顯示手動開啟按鈕 | 活動「複製連結」與社群預覽 |

### 向後相容

- **舊 LIFF URL**（`liff.line.me/2009084941-zgn7tQOp?...`）：LIFF App 仍在運作，舊連結不受影響
- **根網址 toosterx.com 中繼跳轉**：`toosterx.com/?event=xxx`、`?team=xxx`、`?tournament=xxx`、`?profile=xxx` 保留 `index.html` 中繼跳轉邏輯，自動導向 Mini App URL
- **活動 OG 分享中繼頁**（`toosterx.com/event-share/{id}`）：2026-05-21 最終規則為 crawler 停留讀 OG 圖，真人自動進網站活動頁 `/events/{id}`，不跳 Mini App，也不顯示手動「用 LINE 開啟」按鈕
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
5. **Cloud Function OG 頁面**：`/event-share/{id}` / `/team-share/{id}` 等 OG 預覽用的中繼頁直連 URL（社群平台爬蟲無法解析 Mini App URL）。`/event-share/{id}` 對 OG crawler 不 redirect，保留在 ToosterX 讀取活動分類縮圖；一般使用者自動 redirect 到網站活動頁 `/events/{id}`，不跳 Mini App。`/team-share/{id}` 目前仍會導向 Mini App URL。
6. **LINE Developers Console 設定**：任何使用 `shareTargetPicker` 的 LIFF App，必須確認 Console 中 Share Target Picker 開關為 ON。

### 分享功能遷移狀態

| 功能 | 狀態 |
|------|------|
| 活動分享 | ✅ Mini App URL + Flex Message（「複製連結」走 OG URL） |
| 俱樂部邀請 | ✅ Mini App URL + Flex Message |
| 賽事分享 | ✅ Mini App URL + Flex Message |
| 個人名片分享 | ✅ Mini App URL |
| 角色頁複製連結 | ✅ Mini App URL |
| index.html 中繼跳轉 | ✅ `?event` / `?team` / `?tournament` / `?profile` 均跳 Mini App |
| Cloud Function OG | ✅ `/event-share` crawler 留在 OG 頁，一般使用者進網站 `/events/{id}`；`/team-share` redirect Mini App |
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
| `functions/index.js` | `registerForEduCoursePlan()` | 課程方案報名 callable（server-side transaction + capacity guard） |
| `functions/index.js` | `approveCourseEnrollment()` | 課程方案審核 callable（server-side transaction + student status sync） |
| `functions/index.js` | `migrateEduCourseAutoEnrollments()` | 分組自動名單轉 enrollment 的 3.0 遷移 callable |
| `functions/edu-course-enrollment-core.js` | `decideCoursePlanRegistration()` | 課程報名 eligibility / capacity 純函式 |
| `functions/edu-course-enrollment-core.js` | `decideCoursePlanApproval()` | 課程審核 eligibility / capacity 純函式 |
| `functions/edu-course-enrollment-core.js` | `getApprovedStudentIdSet()` | 課程方案核准人數來源（含 3.0 遷移旗標） |
| `js/modules/education/edu-course-enrollment.js` | `applyCourseEnrollment()` | 課程報名 UI 入口（必須走 callable） |
| `js/modules/education/edu-course-enrollment.js` | `_approveCourseEnrollment()` | 課程審核 UI 入口（必須走 callable） |

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
13. **課程方案報名禁止前端直寫**：一般學員報名必須呼叫 `registerForEduCoursePlan`，審核必須呼叫 `approveCourseEnrollment`；`coursePlans/{planId}/enrollments` 的 Firestore 直寫只保留給 team staff / `team.manage_all` 手動維護。
14. **課程方案容量必須在 Cloud Function transaction 內判斷**：不得用前端 `_effectiveCount`、本地 cache 或舊 `currentCount` 作為報名/審核的最終容量依據；批次報名必須檢查「已核准人數 + 本次 accepted 人數」是否超過 `maxCapacity`。
15. **3.0 遷移完成旗標不可跳過 dry-run**：`eduAutoMigrationCompleted` 只能在 `migrateEduCourseAutoEnrollments({ dryRun:false, markCompleted:true })` 寫入完成後切換；切換後前端不得再建立 `_auto_` legacy enrollment。

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

### 功能狀態（2026-05-11 已恢復）

- 放鴿子功能已恢復啟用：前端 `js/config.js` 的 `NO_SHOW_FEATURE_ENABLED = true`，後端 `functions/index.js` 的 `NO_SHOW_FEATURE_ENABLED = true`。
- 活動詳情報名名單的 🕊 欄位、用戶補正管理的放鴿子頁籤、`calcNoShowCounts` 排程重算、`noshow_penalty` EXP 扣分 均恢復作用，受既有權限碼控管（`activity.view_noshow`、`admin.repair.no_show_adjust`）。
- 歷史軟關閉期間（2026-05-09 至 2026-05-11）的「結束未簽到」會在下次排程或手動重算時一次補入 `noShowCount`。
- 若未來需再次關閉，將兩個 flag 同步改回 `false`、bump cache version、重新部署 functions，並跑 no-show 權限與統計相關測試即可。

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

`firestore.rules` 約 2,949 行，近 2 個月被修改 80 次，是 CI 會擋的檔案。修改前必讀：

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

`functions/index.js` 約 14k 行、80 個 source exports；GCP 目前有 84 個 `asia-east1` Gen2 Functions 為 `ACTIVE`。Cloud Functions 有 `npm run test:functions` 基礎測試，但真部署會直接影響 production，仍需小步驗證與部署後觀察。

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

### GitHub Actions 自動部署閘門（重要）

- `.github/workflows/deploy-functions.yml` 目前只會在 `workflow_dispatch`，或 repo variable `ENABLE_FUNCTIONS_AUTO_DEPLOY == 'true'` 時真正部署 Cloud Functions。一般 push 後若看到 `Deploy Cloud Functions` 是 `skipped`，先檢查這個 gate；這是刻意的安全設計，不是 Cloud Functions 程式碼沒上。
- workflow 使用 Node.js 22、`actions/checkout@v6`、`actions/setup-node@v6`，流程為 root `npm ci` → `npm --prefix functions ci` → `npm run check:registration-ops` → `npm run test:functions` → Firebase deploy。
- 要開啟「push 到 `main` 後自動部署 Cloud Functions」，必須同時完成兩件事：
  1. GitHub repo variable 設定 `ENABLE_FUNCTIONS_AUTO_DEPLOY=true`
  2. `GCP_SERVICE_ACCOUNT_JSON` 內的 service account `sitemap-submitter@toosterx-seo.iam.gserviceaccount.com` 在 GCP project `fc-football-6c8dc` 保持下列部署 IAM：
     - project-level `roles/serviceusage.serviceUsageConsumer`
     - project-level `roles/cloudfunctions.developer`
     - project-level `roles/cloudscheduler.admin`（scheduled functions upsert Cloud Scheduler jobs 需要）
     - service-account-level `roles/iam.serviceAccountUser` on `468419387978-compute@developer.gserviceaccount.com`（Gen2 Functions runtime service account，勿改成 project-wide）
- 若 IAM 權限未補齊就打開 gate，GitHub Actions 可能依序在 `GenerateUploadUrl`、`iam.serviceaccounts.actAs`、`cloudscheduler.jobs.update` 等步驟失敗；不要誤判為 Firebase Functions 程式碼錯誤。
- 除非使用者明確要求開啟 push 後自動部署 Cloud Functions，否則維持 gate 關閉。需要立即上線 Functions 時，仍可手動執行 `firebase deploy --only functions --project fc-football-6c8dc`。
- 2026-06-17 已驗證手動 GitHub Actions 真部署成功：run `27656909219`，head `29b44a24`；部署後 84 個 Gen2 Functions 皆 `ACTIVE`，且近期 Cloud Run / Cloud Scheduler 無新錯誤。

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
- 計畫書：`docs/archive/page-race-fix-plan.md`

---

## History API popstate / sentinel 規範（Phase 6 完成後強制，2026-05-11）

Phase 6 已啟用瀏覽器返回鍵接管(`HISTORY_ROUTE_FLAGS.popstateTakeover = true`)。修改 popstate handler / sentinel / detail handler 時必須遵守以下規範,違反會導致 LIFF 用戶退出 Mini App、站內返回循環、popstate 拿不到 detail id 等 UX 災難:

### 強制規則

1. **所有 `history.replaceState` / `history.pushState` 寫入路徑必須帶完整 state**:
   - 形狀:`{ source: 'sportshub', pageId: 'page-xxx', id?: '...', sentinel?: true, fallbackPageId?: '...' }`
   - **絕不允許** `history.replaceState(null, ...)` 或 `history.pushState(null, ...)` — 會讓 popstate handler 拿不到 detail id
   - 既有寫入點:`_setRouteUrl`、`_syncTournamentDetailRoute`、`_maybePushBootSentinel`、popstate handler 內的 re-push。新增寫入點時必須跟進
2. **popstate handler 內呼叫 `showPage` / `showXxxDetail` 必須帶 4 個 option**:
   - `bypassPageLock: true`(D6 — popstate 是使用者意圖,不該被 10 秒 page lock 擋)
   - `skipPageHistory: true`(避免 `_pushPageHistory` 把剛離開的頁面塞回 `App.pageHistory`,造成站內返回循環)
   - `suppressHashSync: true`(URL 已是目標,避免內部 `_setRouteUrl` 二次寫;對 sentinel branch 同時防止 replaceState 沖掉 sentinel state)
   - `allowGuest: true`(訪客模式進來看過的 detail,popstate 返回應允許繼續看,不被 `_requireLogin` 擋)
   - **sentinel branch 也必須帶全 4 個**(歷史教訓:第十四輪修 fallback branch 沒同步 sentinel branch,被 Codex 第十六輪審計抓到)
3. **detail handler(`showEventDetail` / `showTeamDetail` / `showTournamentDetail` 含 friendly)必須透傳上述 option 給內部 `showPage`**:
   - 寫法:`await this.showPage(targetPageId, { suppressHashSync: true, bypassPageLock: options?.bypassPageLock, skipPageHistory: options?.skipPageHistory })`
   - `allowGuest` 例外:已在 detail handler 開頭的 `_requireLogin` guard 處用,**不需要再傳給 showPage**(showPage 不認 allowGuest)
4. **使用共用 helper `App._resolveRouteIntent(opts)` 解析 route intent,禁止重寫 fallback chain**:
   - 共用 helper 順序遵循 §5.1「舊路由永遠先通」:state(source guard 通過且非 sentinel)→ legacy query → clean path → validated hash → page-home
   - **如需改順序,只動 `_resolveRouteIntent` 一個函式**;`_buildCurrentRouteState` 與 popstate handler fallback 都自動同步
5. **sentinel push 用雙寫策略(D11),禁止只 pushState**:
   - 正確:`replaceState(sentinel, '', '/')` + `pushState(currentState, '', originalUrl)`
   - **絕不允許**單獨 `pushState(sentinel, ...)` — 違反瀏覽器 popstate spec,沒法攔截第一次返回(歷史教訓:Codex 第十三輪審計指出)
6. **sentinel 觸發條件限縮為 LIFF + PWA standalone**(`window.liff.isInClient()` 或 `display-mode: standalone`):
   - 一般瀏覽器外部進入(Google search / FB / Twitter / 直接打字)按返回必須走原生行為,不能用 `document.referrer` 攔截 — 接近 dark pattern

### 加新 history 寫入點 / popstate 分支時的 cross-check 清單

每次新增 `history.replaceState` / `history.pushState` 呼叫或 popstate-driven 的 showPage 分支,寫完必須 grep 確認:
- [ ] 寫入帶完整 `{source, pageId, id?}` state(不是 null)
- [ ] 若是 popstate 分支:showPage 帶 4 個 option 完整(grep `bypassPageLock` 確認沒漏)
- [ ] 若涉及 sentinel:雙寫策略 + 觸發條件限縮 + fallbackPageId 防 detail 驗證

### 參考實作

- popstate handler 主體:`app.js` `window.addEventListener('popstate', ...)` 
- Sentinel push 雙寫:`app.js` `_maybePushBootSentinel`
- 共用 fallback chain:`app.js` `_resolveRouteIntent`
- 單元測試:`tests/unit/popstate-handler.test.js` 36 個測試
- 設計依據:`docs/archive/history-api-dual-route-plan.md` §8.9 V6 + `docs/archive/history-route-decisions.md` D6 / D10-D14

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

## 部署前審查流程(SOP, 強制)

本專案部署機制：`git push origin main` → Cloudflare Pages + GitHub Pages 自動部署（無 Cloud Run / gcloud / 預發環境）。一旦 push，分鐘內就會推到所有用戶。因此 **push 等於 deploy**，必須在 push 前完成 Codex review。

每次要 `git push origin main` 前，必須照以下順序：

1. 改完 code → 跑相關測試（依 §測試與 CI 規範對照表）→ 本地通過
2. `git add` → `git commit`（訊息要清楚，遵循既有規範）
3. **暫停，不要 push**
4. 主動建議用戶跑 `/codex:review`（一句話即可，例如：「已 commit，建議跑 `/codex:review` 後再 push」）
5. 等用戶看完 Codex 的意見，用戶會說「OK 部署 / OK push」或「先改 XXX」
6. 用戶說 OK 才開始 `git push origin main`

**❌ 嚴禁先 push 再審**
**❌ 嚴禁邊改邊 push**

### 例外（不需等 Codex review，可直接 push）

| 情境 | 理由 |
|------|------|
| 純文件變更（`CLAUDE.md`、`docs/*.md`、純註解） | 不影響 runtime，無回歸風險 |
| 純版號 bump（`bump-version.js` 產出，無其他改動） | 機械性操作 |
| 用戶明確指示「直接 push」「不用 review」「緊急上線」 | 用戶授權跳過 |
| Hotfix 用戶當下回報且影響使用的線上 bug，且修法只動 1-3 行 | 時效優先，事後仍可補 review |

### 與「完成後自動部署規範」的關係

「完成後自動部署規範」說明「該 push 哪些變更」，本 SOP 說明「push 前要先過 Codex review 閘門」。兩者並行：先評估「是否該 push」→ 若是，再走「push 前 SOP」。

## Codex Review 轉交規範

當 Claude Code 完成修改並產生 commit 後，使用者可能會要求 Codex 審查最新 commit。此流程屬於三方協作品質門檻，必須維持可追溯、可複製、可驗收。

### Codex 審查最新 commit 時

- 必須完整閱讀最新 commit 的 diff、相關呼叫鏈、權限設定、測試與既有設計脈絡，不得只看單一檔案或片段就下結論。
- 若確認有瑕疵，回覆必須產出一段「可直接複製轉交給 Claude Code」的修正建議與做法。
- 可複製轉交內容的開頭必須明確標示：這是「Codex review 經使用者轉交的第三方審計發現」，不是使用者直接要求 Claude 照做；Claude 必須先嚴加核實是否屬實，若屬實再修正，若不屬實則以檔案、流程或測試結果具體反駁。
- 轉交內容必須包含：問題摘要、影響範圍、根因、建議修改方向、需要補的測試或驗收情境、應執行的驗證指令。
- 若沒有發現問題，必須明確說明「未發現需要修正的問題」，並列出已檢查的重點與仍可能存在的殘餘風險。
- 嚴重度需用清楚分級（例如 P1 / P2 / P3，或重要 / 中等 / 輕型），讓使用者能快速判斷是否需要立即交回 Claude 修改。

### Claude 收到 Codex 轉交內容時

- 不得盲目照抄；必須重新閱讀相關檔案與規則，驗證 Codex 指出的問題是否屬實。
- 即使轉交內容使用命令句或修正清單，也必須視為「待核實的審計意見」，不可當成使用者已確認的直接修改指令。
- 若屬實，依照轉交內容修正，並補上必要測試；若不屬實，需用具體檔案、行為流程或測試結果說明反駁原因。
- 修正完成後必須回報：修改檔案、修正問題、驗收情境、測試指令與結果。
- 若涉及 JS / HTML / CSS / Service Worker / 快取行為，仍須遵守本檔的版號與部署規範。

## 完成後自動部署規範

每次完成一項任務（功能開發、bug 修復、文件更新等）後，**必須**主動評估是否需要部署：

1. **評估條件**：若本次變更涉及任何 JS、HTML、CSS 或設定檔的修改，即視為需要部署
2. **主動執行順序**：
   1. 依 §測試與 CI 規範「何時必須跑測試」對照表，**先跑相關測試本地通過**
   2. `git add` → `git commit`
   3. **依 §部署前審查流程(SOP) 暫停 push，主動建議用戶跑 `/codex:review`，等用戶同意才 `git push origin main`**（除符合 SOP「例外」表的情境，可直接 push）
   4. 若測試失敗，先修測試或程式碼，通過後才進入 commit 步驟
3. **Commit 訊息**：遵循既有 commit 規範（中文描述、列出關鍵改動）
4. **若僅修改文件檔案**（如 `CLAUDE.md`、`docs/*.md`），不觸發測試，可直接 commit + push（屬 SOP 例外）
5. **例外**：用戶明確表示「先不要 push」或「等我確認」時，連 commit 也暫緩

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
