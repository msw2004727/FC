# SportHub — 模組架構圖

## 模組關係圖

```mermaid
flowchart TD
    subgraph F["① 基礎層 Foundation"]
        CONFIG["config.js\n常數 & ModeManager"]
        DATA["data.js\nDemo 資料集"]
        I18N["i18n.js\n多語系翻譯"]
        FB_CFG["firebase-config.js\nFirebase SDK 初始化"]
    end

    subgraph D["② 資料層 Data Layer"]
        FB_SVC["firebase-service.js\n快取優先服務層"]
        FB_CRUD["firebase-crud.js\nCRUD 操作擴充"]
        API["api-service.js\nDemo / Prod 抽象層"]
        LINE["line-auth.js\nLINE LIFF 驗證"]
    end

    subgraph I["③ 基礎設施 Infrastructure"]
        PAGE_LDR["page-loader.js\nHTML 片段載入器"]
        SCRPT_LDR["script-loader.js\nJS 模組動態載入"]
    end

    subgraph C["④ 核心應用 App Core"]
        APP["app.js\nApp 主物件 & 初始化流程"]
    end

    subgraph E["⑤ 功能擴充 Feature Modules"]
        NAV["core/navigation.js\n頁面路由 & Modal"]
        THEME["core/theme.js\n深色 / 淺色主題"]
        MODE["core/mode.js\nDemo ↔ Prod 切換"]
        MODS["modules/*.js\n40+ 功能模組"]
    end

    %% Foundation 內部依賴
    FB_CFG --> CONFIG

    %% 資料層依賴
    FB_SVC --> CONFIG
    FB_SVC --> FB_CFG
    FB_CRUD --> FB_SVC
    API --> DATA
    API --> CONFIG
    API --> FB_SVC
    API --> FB_CRUD
    LINE --> CONFIG

    %% 基礎設施依賴
    PAGE_LDR --> CONFIG
    SCRPT_LDR --> CONFIG
    SCRPT_LDR --> PAGE_LDR

    %% App Core 依賴
    APP --> API
    APP --> LINE
    APP --> PAGE_LDR
    APP --> SCRPT_LDR
    APP --> I18N

    %% 功能擴充（Object.assign）
    NAV --> APP
    NAV --> PAGE_LDR
    NAV --> SCRPT_LDR
    THEME --> APP
    MODE --> APP
    MODE --> API
    MODS --> APP
    MODS --> API
```

## 模組說明

| 模組 | 說明 |
|------|------|
| `config.js` | 全域常數、列舉值（ROLES、TYPE_CONFIG 等）、`ModeManager` 單例，控制 Demo/Prod 模式 |
| `data.js` | 完整的 Demo 靜態資料集，結構與 `FirebaseService._cache` 完全對應，供 Demo 模式使用 |
| `i18n.js` | 多語系翻譯字串，無外部依賴，最先載入 |
| `firebase-config.js` | 初始化 Firebase SDK，向外暴露 `db`、`storage`、`auth` 全域物件 |
| `firebase-service.js` | **快取優先**資料層；以 `_cache` 記憶體物件映射 Firestore，透過 `onSnapshot` 即時同步，並持久化至 localStorage |
| `firebase-crud.js` | 透過 `Object.assign` 擴充 `FirebaseService`，提供各集合的新增 / 更新 / 刪除操作 |
| `api-service.js` | **抽象層**；根據 `ModeManager.isDemo()` 決定從 `DemoData` 或 `FirebaseService._cache` 取資料，隔離所有 UI 模組與 Demo/Prod 切換邏輯 |
| `line-auth.js` | LINE LIFF SDK 封裝；在 Demo 模式或 localhost 時停用，提供登入 / 登出 / 取得個人資料 |
| `page-loader.js` | 按需非同步載入 HTML 片段（pages/*.html），快取版本由 `CACHE_VERSION` 控制 |
| `script-loader.js` | 按頁面群組動態載入 JS 模組，減少首次載入體積 |
| `app.js` | `App` 主物件；定義初始化流程（4 階段）、`renderAll()`、`showToast()`、`appConfirm()` |
| `core/navigation.js` | `showPage()` 頁面路由、Modal 管理，透過 `Object.assign` 擴充 App |
| `core/theme.js` | 深色 / 淺色主題切換，偏好儲存於 localStorage |
| `core/mode.js` | Demo ↔ Production 切換（Logo 連按 5 次 / Shift+Alt+D），切換時重建 Firebase 監聽器並重繪 UI |
| `modules/*.js` | 40+ 功能模組（活動、球隊、錦標賽、個人資料、訊息、商店、掃碼、廣告、管理後台等），全部透過 `Object.assign(App, {...})` 掛載，依賴 `App` 與 `ApiService` |

## 初始化流程（4 階段）

```
DOMContentLoaded
  │
  ├─ Phase 1 ── PageLoader.loadAll()        → 載入 Boot HTML 片段
  ├─ Phase 2 ── FirebaseService._restoreCache() → 從 localStorage 還原快取
  ├─ Phase 3 ── App.init() → renderAll()    → 立即顯示 UI（使用快取資料）
  │
  └─ Phase 4（背景 async）
       ├─ 載入 Firebase + LIFF CDN SDK
       ├─ FirebaseService.init()             → Firestore onSnapshot 即時同步
       └─ LineAuth.init()                   → LINE 登入狀態初始化
```

> Phase 3 在 Phase 4 之前完成渲染，確保弱網路環境下不出現白畫面。
