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

---

## 每次新增功能時的規範

1. 新的責任範圍必須以獨立模組方式建立（`js/modules/` 目錄）
2. 完成後更新 `docs/architecture.md`，加入新模組說明與依賴關係
3. 如果有新的模組間依賴，更新 Mermaid 圖
4. 修改任何 JS 或 HTML 檔案後，必須同步更新快取版本號（見上方規則）

---

## 程式碼規範

- 統一使用 `async/await`，不使用 `.then()` 鏈式呼叫
- 所有使用者輸入必須經過 `escapeHTML()` 處理，防止 XSS
- 資料操作統一透過 `ApiService`，不直接操作 `FirebaseService._cache` 或 `DemoData`
- 新模組以 `Object.assign(App, { ... })` 掛載，不建立全域變數
- Demo / Prod 分支邏輯統一在 `ApiService` 內處理，模組層不做 `ModeManager.isDemo()` 判斷
