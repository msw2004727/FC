# ToosterX — Claude Code 專案指引

<!--
  結構文件交叉引用（任一檔案的結構描述更新時，必須同步更新以下所有檔案）：
  - docs/architecture.md       ← 完整架構圖 + 模組清單 + Mermaid 圖
  - docs/structure-guide.md    ← 中文功能導覽圖（給人看的，附功能解釋）
  - CLAUDE.md                  ← 目錄結構概覽（§ 目錄結構）
  - AGENTS.md                  ← 目錄結構指引（§ 目錄結構）
-->

## 專案概述

**ToosterX** 是一套運動活動報名與管理系統，提供用戶報名活動（PLAY / 友誼 / 教學 / 觀賽）、組建俱樂部、參加錦標賽、QR Code 簽到簽退及個人數據統計等功能。管理端提供活動管理、用戶管理、EXP 系統、成就徽章、廣告投放等後台能力。

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
│       ├── team/           # 俱樂部系統（11）：列表、詳情、表單、動態牆、分享
│       ├── tournament/     # 賽事系統（12）：渲染、詳情、管理、友誼賽
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

當你修改了任何 JS 或 HTML 檔案後，**必須**同步更新以下 **四個位置**的版本號（缺一不可，否則用戶端無法正確更新）：

| # | 檔案 | 位置 | 說明 |
|---|------|------|------|
| 1 | `js/config.js` | `CACHE_VERSION` 常數 | 動態載入的 pages/*.html 和 js 模組用此值做 cache busting |
| 2 | `index.html` | 所有 `?v=` 參數（約 62 處） | CSS + JS 靜態資源的 cache busting |
| 3 | `index.html` | 第 235 行 `var V='...'` | **快取自動清除觸發器**——版本號變更時自動清除所有 SW 快取並重新下載 |
| 4 | `sw.js` | 第 9 行 `CACHE_NAME` | Service Worker 快取群組名稱，必須與 `var V` 同步，否則舊快取不會被清除 |

**四個值必須完全一致**（同一個版本號字串）。

版本號格式：`YYYYMMDD`，同天多次部署加後綴 `a`, `b`, `c`...

範例：`20260211` → `20260211a` → `20260211b` → `20260212`

> `page-loader.js` 的 fetch 會自動讀取 `CACHE_VERSION`，不需額外改。

---

## 架構文件

模組依賴關係圖與各層說明：[docs/architecture.md](docs/architecture.md)

---

## 模組建立規則

- **bug 修復或小幅調整** → 直接修改現有檔案
- **同一責任範圍的邏輯擴充** → 修改現有檔案
- **新的責任範圍或獨立業務邏輯** → 在 `js/modules/` 建立新模組，以 `Object.assign(App, {...})` 掛載
- **單一檔案不得超過 300 行**，超過則拆分（新模組放入對應功能子資料夾（如 js/modules/event/、js/modules/team/），參考既有資料夾結構）
- **相同類型的模組必須放在同一個資料夾內**：新增模組時，若已有對應的功能子資料夾（如 event/、team/、profile/ 等），**禁止**將同類型模組放在 `js/modules/` 扁平目錄下，必須放入對應子資料夾。若新功能不屬於任何既有子資料夾，且預期會有 2 個以上相關檔案，應優先建立新的功能子資料夾

## 模組化演進目標（新增）

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
8. **權限系統同步維護（強制）**：當新增或變更任何後台功能時，必須同步評估並執行以下事項：
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

## 程式碼規範

- 統一使用 `async/await`，不使用 `.then()` 鏈式呼叫
- 所有使用者輸入必須經過 `escapeHTML()` 處理，防止 XSS
- 資料操作統一透過 `ApiService`，不直接操作 `FirebaseService._cache` 或 `DemoData`
- 新模組以 `Object.assign(App, { ... })` 掛載，不建立全域變數
- Demo / Prod 分支邏輯統一在 `ApiService` 內處理，模組層不做 `ModeManager.isDemo()` 判斷
- 涉及既有大模組重構時，優先先做結構整理與責任切分，再進入業務邏輯改寫，避免一次性搬移與修 bug 疊在同一批變更。
- **跨瀏覽器相容性檢查（每次修改前必做）**：每次計畫修改 CSS、JS、HTML 之前，必須先確認 LINE 瀏覽器（WebView）、Chrome、Safari 三端是否對齊。不得引入僅部分瀏覽器支援的 API 或 CSS 屬性而未提供 fallback（例如：`backdrop-filter` 需加 `-webkit-` 前綴、`dvh` 需有 `vh` fallback、`replaceAll` 需用 `replace(/…/g)` 替代、`navigator.clipboard` 需有 `execCommand` 降級）。若不確定相容性，應先查證後再實作，避免產生跨瀏覽器不一致或 BUG。
- **彈窗毛玻璃風格規範**：所有彈窗（modal / dialog / overlay）一律使用毛玻璃背景遮擋效果。背景層必須包含 `backdrop-filter: blur(10px)` + `-webkit-backdrop-filter: blur(10px)`，搭配半透明黑底 `rgba(0,0,0,.35)`。彈窗本體使用圓角 `border-radius: 16px` + 陰影 `box-shadow: 0 8px 32px rgba(0,0,0,.15)`。觸控事件必須阻止穿透但允許彈窗內部滾動：overlay 層的 `touchmove` 事件中，若 `e.target` 在 modal 內則放行（允許滾動），否則 `preventDefault` + `stopPropagation`（阻止穿透到背景）。彈窗本體**不得**加 `touch-action: none`（否則內部無法滾動）。參考實作：`color-cat-scene-stats-modal.js`、`color-cat-scene-panel-modal.js`。
- **用戶 ID 欄位命名規範**：所有新增的 Firestore 文件寫入，若需記錄「操作者」或「所屬用戶」，**必須包含 `uid` 欄位**，值為 Firebase Auth UID（即 LINE userId）。禁止只存顯示名稱而不存 UID。既有集合中 `registrations` 使用 `userId` 為歷史慣例，讀取時需注意欄位名差異。各集合的用戶 ID 欄位對照：`users` → `uid`/`lineUserId`、`registrations` → `userId`、`attendanceRecords` → `uid`、`activityRecords` → `uid`、`events` → `creatorUid`、`expLogs` → `uid`、`operationLogs` → `uid`。

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

1. **所有面向用戶的分享 URL 必須使用 Mini App URL**：禁止使用 `liff.line.me` 或 `toosterx.com` 作為新分享連結。
2. **分享功能的優先實作順序**：
   - 首選：`liff.shareTargetPicker()`（Flex Message 卡片）— 需 LIFF session + LINE Developers Console 啟用
   - 次選：底部選單提供「複製分享連結」（複製 Mini App URL 純文字）
   - 兜底：`navigator.share()` / `_copyToClipboard()` fallback
3. **新增分享功能時必須比照 `event-share.js` 的模式**：底部選單（Action Sheet）+ Flex Message + 防連點 + altText 截斷（400 字）+ 各級 fallback。
4. **QR Code 內容也必須使用 Mini App URL**：QR Code 掃描後在 LINE 開啟 Mini App。
5. **Cloud Function OG 頁面為例外**：`/team-share/{id}` 等 OG 預覽用的中繼頁需保留直連 URL（社群平台爬蟲無法解析 Mini App URL），但最終 redirect 目標應改為 Mini App URL。
6. **LINE Developers Console 設定**：任何使用 `shareTargetPicker` 的 LIFF App，必須確認 Console 中 Share Target Picker 開關為 ON。

### 分享功能遷移狀態

| 功能 | 狀態 |
|------|------|
| 活動分享 | ✅ Mini App URL + Flex Message |
| 俱樂部邀請 | ✅ Mini App URL + Flex Message |
| 賽事分享 | ✅ Mini App URL + Flex Message |
| 個人名片分享 | ✅ Mini App URL |
| 角色頁複製連結 | ✅ Mini App URL |
| index.html 中繼跳轉 | ✅ 跳轉目標改為 Mini App URL |
| Cloud Function OG | ✅ redirect 目標改為 Mini App URL |
| Dashboard 報表 | ⚠️ 維持現狀（管理功能，非面向一般用戶） |

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
