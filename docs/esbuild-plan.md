# ToosterX esbuild 混合打包計劃書

> 三位專家（前端架構師、風險管理、效能工程師）共識文件
> 領導整合：Claude Opus 4.6
> 日期：2026-04-04

---

## 一、起因

用戶普遍反映網站載入速度慢、常常卡住。根因分析：

- 首次載入產生 **52 個 HTTP 請求**（41 JS + 14 CSS + CDN）
- JS 總量 887 KB 未壓縮，14 個 CSS 共 298 KB
- 無 build process — 所有檔案原始碼直接部署，未壓縮、未合併
- 每個 HTTP 請求在 4G 手機上有 ~100-150ms overhead

---

## 二、方案：混合打包（Hybrid Bundling）

### 打包範圍

| 範圍 | 數量 | 做法 |
|------|------|------|
| **打包** | ~41 個啟動必要 JS + 14 個 CSS | 合併 + 壓縮為 `dist/app.bundle.js` + `dist/app.bundle.css` |
| **不打包** | ~155 個懶載入模組 | 維持 ScriptLoader 動態載入 |
| **不打包** | Firebase / LIFF CDN | 維持動態載入 |
| **不打包** | inventory/、pages/*.html、sw.js | 完全不動 |

### 關鍵技術決策

**為什麼不用 `format: 'iife'` 或 `format: 'esm'`？**

所有模組用 `Object.assign(App, {...})` 掛載全域物件，HTML 有 337 個 `onclick="App.xxx()"` 行內處理器。如果 esbuild 用 IIFE 包裝，`App` 變成函式內部變數 → 全部 onclick 報 `App is not defined`。

**正確做法**：用 `esbuild.transform()`（僅壓縮，不包裝作用域）。將 41 個檔案按原始順序串接成一個字串，再通過 transform 壓縮。輸出直接在全域作用域執行，等同原本的 41 個 `<script>` 標籤。

---

## 三、預估成果

### 首次訪問（冷快取、4G 手機）

| 指標 | 現況 | 保守估計 | 樂觀估計 |
|------|------|---------|---------|
| HTTP 請求數 | 52 | 12-14 | 10-12 |
| JS 傳輸量（brotli） | ~220 KB | ~80 KB | ~70 KB |
| CSS 傳輸量（brotli） | ~55 KB | ~30 KB | ~25 KB |
| 首次繪製（FCP） | ~1.8s | ~1.4-1.5s | ~1.2-1.3s |
| 可互動時間（TTI） | ~3.5s | ~2.6-2.9s | ~2.2-2.5s |
| 速度指數 | ~2.5s | ~1.8-2.1s | ~1.5-1.8s |

### 不會改善的項目（誠實揭露）

| 項目 | 原因 |
|------|------|
| Firebase SDK 載入（~200-300ms） | CDN 外部請求，不在打包範圍 |
| Firestore 首次查詢延遲（~300-800ms） | WebSocket 建立，與打包無關 |
| 懶載入模組的首次頁面切換 | 155 個模組仍為獨立檔案 |
| 回訪用戶（SW 快取命中） | 已有快取，改善幅度小 |
| 圖片載入 | Firebase Storage，與打包無關 |

### 最大受益場景

每次部署更新版本號後，所有用戶的 SW 快取失效，需重新下載所有資源。
- 現在：55 個檔案重新下載
- 打包後：2 個檔案重新下載
- **這是用戶感受最明顯的改善**

---

## 四、施作步驟

### Step 1：安裝 esbuild

```bash
npm install --save-dev esbuild
```

驗證：`npx esbuild --version`

### Step 2：建立 build 腳本

建立 `build/esbuild.config.mjs`：
- 讀取 41 個 JS 檔案，按 index.html 順序串接
- 通過 `esbuild.transform()` 壓縮（不包裝作用域）
- 末尾注入 ScriptLoader 預設標記（防止重複載入已打包的模組）
- CSS 用 `@import` 串接 14 個檔案 → `esbuild.build()` 合併壓縮

輸出：
- `dist/app.bundle.js`（~320 KB → brotli ~80 KB）
- `dist/app.bundle.css`（~200 KB → brotli ~30 KB）

### Step 3：修改 index.html

**CSS**：14 個 `<link>` → 1 個
```html
<link rel="stylesheet" href="dist/app.bundle.css?v=VERSION">
```

**JS**：41 個 `<script defer>` → 1 個
```html
<script defer src="dist/app.bundle.js?v=VERSION"></script>
```

保留：行內 `<script>` 區塊（SW 註冊、boot watchdog 等）不動。

### Step 4：修改 sw.js STATIC_ASSETS

```javascript
const STATIC_ASSETS = [
  './',
  './index.html',
  './dist/app.bundle.css',
  './dist/app.bundle.js',
  './pages/home.html',
  './pages/activity.html',
  './pages/team.html',
  './pages/message.html',
  './pages/profile.html',
  './pages/modals.html',
];
```

### Step 5：新增 npm script

```json
"build": "node build/esbuild.config.mjs"
```

### Step 6：版本號同步（4 處 + build）

1. `js/config.js` → `CACHE_VERSION`
2. `sw.js` → `CACHE_NAME`
3. `index.html` → `var V='...'`
4. `index.html` → `?v=` 參數（現在只剩 2 處）
5. **執行 `npm run build`**（因為 bundle 內含 CACHE_VERSION）

### Step 7：部署方式

**建議 Option A：commit dist/ 到 git**
- 本地跑 `npm run build` → commit dist/ → push
- Cloudflare Pages 直接部署，不需 CI build
- 與現有「無 build process」的部署模式一致

### Step 8：保留原始檔案

原始 41 個 JS + 14 個 CSS 不得刪除，因為：
- build 腳本讀取它們產生 bundle
- 懶載入模組仍從原始路徑載入
- 開發時編輯原始檔案

---

## 五、風險評估

### P0 風險（必須在部署前完全緩解）

| ID | 風險 | 可能性 | 影響 | 緩解方式 |
|----|------|--------|------|---------|
| R1 | App 全域變數遺失（IIFE 包裝） | 高 | 致命 | 用 `transform()` 不用 `build()`，不包裝作用域 |
| R2 | ScriptLoader 路徑不一致（404） | 高 | 致命 | bundle 末尾注入 `ScriptLoader._loaded` 預設標記 |
| R3 | SW 提供舊版個別檔案 | 高 | 高 | 更新 STATIC_ASSETS + 同步 CACHE_NAME |

### P1 風險（必須有緩解計劃）

| ID | 風險 | 可能性 | 影響 | 緩解方式 |
|----|------|--------|------|---------|
| R4 | onclick 在 bundle 載入前觸發 | 中 | 高 | 保持 `<script defer>`，與原始行為一致 |
| R5 | Firebase/LIFF 時序錯亂 | 中 | 高 | CDN 不打包，保持動態載入順序 |
| R8 | 已打包模組被 ScriptLoader 重複執行 | 中 | 中 | ScriptLoader._loaded 預設標記 |
| R12 | 版本號不同步 | 中 | 高 | 只有 2 處 `?v=`（大幅簡化） |

### P2 風險（設定時防範）

| ID | 風險 | 可能性 | 影響 | 緩解方式 |
|----|------|--------|------|---------|
| R10 | LINE WebView 語法不相容 | 低 | 高 | `target: ['chrome69', 'safari12']` |
| R11 | Source map 洩漏設定 | 低 | 中 | 生產環境 `sourcemap: false` |

---

## 六、回滾計劃

如果部署後發現問題，**15-20 分鐘內可完全復原**：

```bash
# 1. 還原程式碼
git revert <bundle-commit>

# 2. 更新版本號（4 處）
# 新版號強制清除所有用戶快取

# 3. 推送
git push origin main

# 4. 通知受影響用戶
# 加 ?clear=1 參數清除快取
```

---

## 七、驗收清單（部署前必過）

| # | 測試 | 預期結果 |
|---|------|---------|
| 1 | 首頁載入 | 6 秒內顯示，無 connection unstable |
| 2 | Console 無錯誤 | 零 TypeError / ReferenceError |
| 3 | 五個底部 tab 切換 | 每頁都能載入，無白屏 |
| 4 | 活動詳情頁 | 報名按鈕可點擊 |
| 5 | 報名 + 取消報名 | 完整流程，toast 確認 |
| 6 | LINE 登入流程 | LIFF 重導向 + 登入成功 |
| 7 | Demo 模式切換 | 正常顯示 demo 資料 |
| 8 | 側邊抽屜選單 | 所有項目可點擊 |
| 9 | Network tab | 只有 app.bundle.js + app.bundle.css（非 41 個個別檔案） |
| 10 | 懶載入（進活動詳情） | Network 顯示 activity 群組個別檔案載入 |
| 11 | SW 快取 | Application > Cache Storage 包含 bundle 檔案 |
| 12 | 離線測試 | 離線後重新載入仍可顯示快取內容 |
| 13 | LINE WebView | iOS + Android LINE 內開啟正常 |
| 14 | 硬重載兩次 | 第一次 network fetch，第二次 SW cache-first |
| 15 | 深連結 | `?event=xxx` 導向正確 |

---

## 八、部署後監控（48 小時）

### 0-2 小時：主動監控
- JS 錯誤日誌（Admin > Error Logs）
- Cloudflare Pages 部署狀態
- 404 錯誤（ScriptLoader 路徑不一致）
- LINE WebView 載入

### 2-24 小時：每 4 小時檢查
- 錯誤日誌量（超過基準 2 倍 → 調查）
- 報名成功率（下降 30% → 調查）
- 用戶回報

### 48 小時決策門檻

| 狀態 | 條件 | 行動 |
|------|------|------|
| 🟢 綠燈 | 零致命錯誤，效能持平或改善 | 確認部署穩定 |
| 🟡 黃燈 | 有小問題但已部署修補 | 繼續監控 48 小時 |
| 🔴 紅燈 | 致命問題 | 執行回滾計劃 |

---

## 九、版本號簡化效益

| 項目 | 現況 | 打包後 |
|------|------|--------|
| `?v=` 參數數量 | ~66 處 | 2 處 |
| sed 替換範圍 | 全檔案 | 2 行 |
| 版本不同步風險 | 高（66 處可能漏改） | 低（2 處） |

---

## 十、工時評估

| 階段 | 時間 | 內容 |
|------|------|------|
| 安裝 + build 腳本 | 30 分鐘 | esbuild + config + entry files |
| 修改 index.html + sw.js | 30 分鐘 | 替換標籤、更新 STATIC_ASSETS |
| 本地測試 | 1 小時 | 15 項驗收清單 |
| 效能量測 | 30 分鐘 | Lighthouse before/after |
| 部署 + 監控 | 30 分鐘 | push + 前 2 小時觀察 |
| **總計** | **3 小時** | |

---

## 十一、專家共識聲明

三位專家一致同意：

1. **混合打包是正確方案** — 只打包啟動模組，保留懶載入
2. **`transform()` 不包裝作用域** — 是唯一安全的壓縮方式
3. **ScriptLoader 預設標記** — 是防止重複載入的必要措施
4. **commit dist/ 到 git** — 比 CI build 更安全（避免新故障點）
5. **保留原始檔案** — 不可刪除，build 和懶載入都依賴它們
6. **回滾計劃** — 15-20 分鐘可完全復原，風險可控

---

*本計劃書由前端架構專家、風險管理專家、效能工程專家共同審核通過。*
*領導整合：Claude Opus 4.6 (1M context)*
*專案：ToosterX — toosterx.com*
