# 中低階手機效能優化計畫書（審計修正版 v3）

> **原建立日期**：2026-05-19  
> **審計修正版日期**：2026-05-19  
> **v2 微調日期**：2026-05-19（修正 6 處實作建議瑕疵）  
> **v3 審計補正日期**：2026-05-19（補正 `.event-card`、`.h-card` 上限、SW `ignoreSearch` 邊界）  
> **狀態**：已審計通過，可進入準備實作階段；第一波可直接排程  
> **目標**：讓中低階手機、弱網、LINE WebView 使用 ToosterX 更順暢、更省流量、更少版面跳動  
> **重要結論**：原計畫方向多數正確，但部分選擇器、SW 前提、Firebase preload 效益判斷不精準，量化成效不可直接承諾。

> **v2 / v3 修正項目**：
> - `.h-card` 是水平輪播卡；活動熱門卡最多 10 張（低階降到 6 張），賽事 ongoing 輪播目前不保證 hard limit。第一波不套 `content-visibility`，若賽事量擴大，先加 `priorityLimit` 或資料上限。
> - timeline thumb 是 48×48 固定容器，不應補 1200×450 屬性。
> - `.float-ad` 與 `.sponsor-slot` 兩個既存廣告 slot 都是 1:1，不需先做比例調查。
> - `contain-intrinsic-size` 不再使用 `100vw` / `33vw` 等 viewport 單位。
> - 第一波圖片清單補上 `.hl-avatar`（32×32）、`.float-ad img`（80×80）、`.sponsor-slot img`（1:1）、`.tl-event-thumb img`（48×48）。
> - `.event-card` 實際存在，但不是第一波要套 `content-visibility` 的前台主長列表 selector。
> - SW `ignoreSearch` 只允許套在同源、帶 `?v=` 的靜態資源，不可擴大到 API、HTML navigation、runtime-config 或任何 query 有業務語意的 URL。
> - 修復檔案結尾 UTF-8 截斷與白話結論未完成段落。

---

## 1. 審計總結

這份優化可以做，不是胡扯；但不能照原版直接執行。

原計畫抓到的真實痛點：

- 首屏有 Firebase / LIFF 外部 SDK preload。
- 前台列表有大量卡片、圖片與動畫效果。
- 多數 `<img>` 缺少 `width` / `height`。
- sticky bar 使用 `backdrop-filter: blur(...) saturate(...)`，對低階 GPU 不友善。
- Google Font 對繁中字體流量成本高。

需要修正的地方：

- `content-visibility` 要套用到實際存在的主清單 selector，不是文件中列的 `.team-card`、`.tournament-card`。
- `content-visibility` 對舊 iPhone 8 / X 常見的 iOS 16 WebView 不保證有效，主要收益在 Android Chromium / 新版 WebView。
- 只移除 `firebase-storage-compat` / `firebase-functions-compat` preload 不等於 lazy load，`_loadCDNScriptsOnce()` 仍會一次載入全部 SDK。
- `sw.js` 預快取無版號 CSS，`index.html` 載入 `?v=` 版本化 CSS，直接補清單不一定命中。
- 「FPS 從 30 到 55」「LCP 快 200-500ms」「Lighthouse 80+」無 before/after 量測，不可寫成保證。

本修正版把工作拆成三波：可立即做的低風險項目、需先修正前提或量測的項目、需產品決策的項目。

---

## 2. 審計已核對事實

### 2.1 專案載入方式

Vanilla JS / CSS / HTML，無 webpack / build pipeline。資源以 `<link>`、`<script defer>`、動態 loader 載入。

### 2.2 Firebase preload 現況

`index.html` 目前 preload：firebase-app / firestore / auth / storage / functions / LIFF SDK。`app.js` 的 `_loadCDNScriptsOnce()` 仍會 Promise.all 載入 Firestore + Storage + Auth + Functions + LIFF。移除 preload 只改下載優先序，不會讓 Storage / Functions 真正延後到使用時才載入。

### 2.3 實際前台主清單 selector

實際存在的前台列表 selector：

- 首頁活動 / 賽事卡：`.h-card`（水平輪播）
- 活動時間軸列表：`.tl-event-row`（垂直長列表）
- 俱樂部列表：`.tc-card`（3 欄垂直 grid）

原文件提到的 `.team-card`、`.tournament-card`、`.activity-card` 不是現有前台主列表 selector。`.event-card` 實際存在於活動 CSS 與 team manage 類列表，但不是第一波要套 `content-visibility` 的前台主長列表 selector。

### 2.4 圖片變體尺寸

- 活動 / 俱樂部 cover：`1200 x 450`，比例 8:3
- 首頁下一場活動 homeNext：`1000 x 750`，比例 4:3
- 俱樂部 card：`1000 x 1000`，比例 1:1

補 `width` / `height` 合理，但要對齊**實際 CSS 容器尺寸**，不可一律硬塞同一組尺寸。

### 2.5 Service Worker 快取前提

`STATIC_ASSETS` 預快取無版號路徑（如 `./css/base.css`），但 `index.html` 載入 `css/base.css?v=...`。`sw.js` cache-first 分支用 `caches.match(event.request)` 精準比對（無 `ignoreSearch`），所以「補缺漏 CSS 進 `STATIC_ASSETS`」不等於「版本化 CSS 從預快取命中」。

---

## 3. 成效目標與量測方式

本計畫不承諾固定 FPS / LCP 數字，改用 before / after 量測：

| 指標 | 目標方向 | 判定方式 |
|------|----------|----------|
| 列表滾動 | 掉幀減少、長列表操作更穩 | Chrome Performance 觀察 long task、frame chart、實機手感 |
| CLS | 圖片載入造成的跳動下降 | Lighthouse / DevTools Layout Shift |
| LCP | 首頁首屏不變慢，弱網下最好改善 | DevTools Network + Lighthouse |
| INP | 點擊卡片、報名按鈕不變慢 | DevTools Performance / 實機操作 |
| 首屏資源 | critical path 不增加 | Network panel 比對 transferred size 與 priority |

**建議測試裝置**：Android 中階機（或 Chrome DevTools 4x CPU + Slow 4G）、LINE WebView 實機、iPhone SE 2 / 8 / X（確認不破版）。

---

## 4. 第一波：可立即做的低風險項目

### 4.1 補 `<img>` 的 `width` / `height` / `decoding`

**結論**：可做，低風險，優先度高。

**要解決的問題**：圖片晚載入時，瀏覽器不知道 intrinsic ratio 會造成版面跳動，對 lazy-loaded image 特別重要。

**實作原則**：

- 填的 `width`/`height` 必須對齊**實際 CSS 渲染容器**，不是圖片來源檔案的比例。例如 cover 變體原始檔是 1200×450，但若顯示容器是 48×48 固定 thumb，就要寫 48×48（否則瀏覽器會以錯誤比例預留版位，反而造成 CLS）。
- 有固定變體比例的圖片，補對應 `width` / `height`。
- 已有 `aspect-ratio` 的外層仍可補，作為瀏覽器更早期的比例提示。
- 不要只補前台列表卡，detail cover、小頭像、廣告 slot 也應一次掃乾淨。

**建議修改範圍**：

| 檔案 | 建議 | 依據 |
|------|------|------|
| `js/modules/event/event-list.js` | 活動卡 cover 補 `width="1200" height="450"` | cover 變體 8:3，放在 `.h-card-img` |
| `js/modules/event/event-list-timeline.js` | timeline thumb 補 `width="48" height="48"` | `.tl-event-thumb` 固定 48×48（`activity.css:583`） |
| `js/modules/home-next-activity.js` | homeNext 補 `width="1000" height="750"` | homeNext 變體 4:3 |
| `js/modules/team/team-list-render.js` | 俱樂部 card 補 `width="1000" height="1000"` | card 變體 1:1 |
| `js/modules/tournament/tournament-render.js` | 賽事卡 cover 補 `width="1200" height="450"` | 與活動卡共用 `.h-card-img` |
| `js/modules/event/event-detail.js` | detail cover 補 `width="1200" height="450"` | cover 變體 8:3 |
| `js/modules/team/team-detail.js` | team detail cover 補 `width="1200" height="450"` | cover 變體 8:3 |
| `js/modules/tournament/tournament-detail.js` | tournament cover 補 `width="1200" height="450"` | 通常上傳 cover 8:3 |
| `js/modules/event/event-host-list.js` | host avatar 補 `width="32" height="32"` | `.hl-avatar` 固定 32×32（`activity.css:2499`） |
| `js/modules/banner.js`（float-ad） | 廣告圖補 `width="80" height="80"` | `.float-ad` 固定 80×80 圓形（`home.css:1607`） |
| `js/modules/banner.js`（sponsor-slot） | 贊助商圖補 `width="100" height="100"` | `.sponsor-slot` 是 `aspect-ratio: 1`（`home.css:1867`） |

**注意事項**：

- 若 CSS 強制 `object-fit: cover`，比例不一致不會扭曲但會裁切。實機檢查 cover 變體在 list 與 detail 是否裁掉關鍵內容。
- 圖片來源不是固定變體（如使用者頭像、外部活動圖），以 **CSS 容器尺寸** 為準，不要用上傳檔的原始比例。

**驗收**：Slow 4G 重整首頁觀察跳動；Lighthouse 確認 Layout Shift 下降；活動 / 俱樂部 / 賽事 detail 各開一次確認無扭曲。

---

### 4.2 對真實列表 selector 加 `content-visibility`

**結論**：可做，但只套用真正長垂直列表，且承認舊 iOS 可能無效。

**要解決的問題**：長列表中，畫面外卡片仍可能參與 layout / paint。`content-visibility: auto` 能讓支援的瀏覽器略過畫面外內容的部分渲染工作。

**正確套用目標**：

- `.tl-event-row`（page-activities 主時間軸長垂直列表，一次 50+ 筆）
- `.tc-card`（俱樂部頁 `.team-grid` 是 `repeat(3, 1fr)` 三欄垂直 grid，可多列）

**不套用 `.h-card`**：

- `.h-card` 是 `min/max-width: 220px` 固定寬度卡，放在 `.horizontal-scroll`（`overflow-x: auto; scroll-snap-type: x mandatory`）橫向滑動容器中。
- `renderHotEvents` 最多顯示 10 張卡（`NetDevice.shouldDegrade()` 為 true 時降到 6 張）。
- `tournament-render.js` 也用 `.h-card`，且 `renderOngoingTournaments()` 未傳 `priorityLimit` 時會渲染全部 ongoing tournaments；如果正式資料常超過 15-20 筆，應先替賽事輪播加 `priorityLimit` 或資料上限，而不是把 `content-visibility` 套到水平輪播卡。
- 水平輪播不是本計畫第一波的主瓶頸；第一波優先處理長垂直列表，避免把風險擴大到首頁輪播互動。

**不建議套用**：頁面容器、sticky header、modal / overlay、需要立即量測尺寸的元素、動態高度差異極大的複雜區塊。

**建議 CSS 寫法**：

```css
@supports (content-visibility: auto) {
  /* page-activities 時間軸主列表，row 高度約 80-110px */
  .tl-event-row {
    content-visibility: auto;
    contain-intrinsic-size: 0 96px;
  }

  /* 俱樂部 3 欄 grid，每張卡高度約 200-260px */
  .tc-card {
    content-visibility: auto;
    contain-intrinsic-size: 0 230px;
  }
}
```

實作時在實機量到實際卡高再調整高度值。**不可用 `100vw` / `33vw` 等 viewport 單位**——row / card 寬度由 container 決定，viewport 單位對 layout 沒有意義。寬度欄一律用 `0`，只給高度估值。

**風險**：支援瀏覽器才有效（舊 iOS WebView 可能直接忽略）；intrinsic size 估太不準會造成滾動條跳動；套在錯誤容器會讓 focus / scroll anchor 變怪。

**驗收**：Android Chrome / LINE WebView 測活動時間軸 50 筆以上滾動；iPhone 8 / X 確認即使不支援也不破版；搜尋 / 篩選 / 切 tab / 卡片 pending loading 正常。

---

### 4.3 移除滾動常駐元素的 `backdrop-filter saturate()`

**結論**：可做，低風險。

**要解決的問題**：sticky / fixed 元素在滾動時長期可見，`backdrop-filter: blur(...) saturate(...)` 對低階 Android GPU 成本偏高。保留 `blur()`，移除 `saturate()` 可降低重繪成本。

**建議修改範圍**：

| 檔案 | 位置 |
|------|------|
| `css/layout.css` | 頂部 sticky bar 的 `blur(...) saturate(...)` |
| `css/activity.css` | 活動詳情底部 sticky 報名列的 `blur(...) saturate(...)` |

**禁止修改範圍**：modal / dialog / overlay 的背景遮罩（CLAUDE.md §彈窗毛玻璃風格規範強制保留）、`host-list-overlay`、`event-location-picker-overlay`、`ext-transit-overlay`、私訊 dialog overlay。

**驗收**：首頁、活動詳情頁滾動順暢度；修改前後截圖比對 sticky bar 可讀性；確認 modal 毛玻璃背景仍存在。

---

### 4.4 補全 `prefers-reduced-motion`

**結論**：可做，但是 accessibility / 省電優化，不是所有低階機都受益。

**要解決的問題**：目前只有部分 boot / calendar / sport picker 動畫尊重減動效。使用者若在系統開啟減少動態效果，應停掉非必要動畫。

**建議策略**：全域降低裝飾性 animation / transition；保留必要 loading feedback（改成非旋轉、非位移的低動態樣式）；不要讓「正在載入」狀態完全消失。

**建議 CSS**（放 `css/base.css`）：

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
  .loading-spinner,
  .reg-loading::before,
  .tc-loading-spinner {
    animation: none !important;
  }
}
```

如果 loading spinner 關掉後辨識度不足，要補靜態 loading 文案或 progress bar。

**驗收**：iOS「減少動態」、Android「移除動畫」開啟後頁面切換動畫停用；關閉系統設定後動畫恢復；loading / pending / toast 仍可理解。

---

## 5. 第二波：方向正確，但不能照原版直接做

### 5.1 Firebase Storage / Functions SDK 延後載入

**審計判斷**：只移除兩個 preload 不等於 lazy load。`_loadCDNScriptsOnce()` 仍等待它們載入，可能改善頻寬競爭也可能延後 Firebase ready，無量測不能保證。

**建議分兩階段**：

- **方案 A（低風險實驗）**：只移除 `storage` / `functions` preload，保留 `_loadCDNScriptsOnce()` 不動。當 A/B 量測，不是正式方案。
- **方案 B（真正有效）**：把 SDK 載入分層：Core boot 載 firebase-app / firestore / auth / LIFF；Lazy storage 在第一次用 Storage API 前載入；Lazy functions 在第一次呼叫 `firebase.app().functions(...)` 前載入。新增 `ensureFirebaseStorageSdk()` / `ensureFirebaseFunctionsSdk()` helper，所有使用點前保證 ready。

**風險**：需掃全部 `firebase.storage()` 與 `firebase.app().functions(...)` 使用點；漏補 helper 會造成 runtime error；Callable region / CORS 不可改。

**結論**：方案 A 可量測，方案 B 才是真正讓首屏更輕的改法，風險與工時應升為中等。

---

### 5.2 Service Worker cache key 修正 + 補齊 CSS

**審計判斷**：cache key 不一致，直接補 `STATIC_ASSETS` 不會命中版本化 CSS。

**可行修法**：

- **方案 A（推薦）**：只對同源、帶 `?v=` 的版本化靜態資源使用 `ignoreSearch`。不可直接把 `sw.js:236` 的整個同源 cache-first 分支改成 `caches.match(event.request, { ignoreSearch: true })`，必須先判斷資源是 `.css` / `.js` / 圖片等靜態檔且 `url.searchParams.has('v')`。API、HTML navigate、`runtime-config.json`、以及 query string 有業務語意的 URL 都必須維持精準比對或既有策略。
- **方案 B**：預快取版本化 URL，讓 `STATIC_ASSETS` 包含 `?v=${version}`。但 `sw.js` 沒有獨立 `CACHE_VERSION` 常數，實作較麻煩且要同步 `bump-version.js`。

**建議**：先做方案 A，再補齊缺漏 CSS：`calendar.css`、`calendar-sport-counts.css`、`admin-seo.css`、`game.css`、`image-cropper.css`、`education.css`。

**成本校正**：缺漏 CSS 原始大小合計約 **102KB**（實測 100.3KB；gzip 後約 21KB）。原版寫的 80KB 是錯的。

**驗收**：清 Cache Storage 重載首頁；確認新增 CSS 在 SW cache；版本化 CSS 從 SW 命中；改 `sw.js` 後必 bump version。

---

## 6. 第三波：需產品決策

### 6.1 Noto Sans TC 改系統字體

**結論**：值得討論，但不能當純工程低風險項目。

`index.html` 目前載入 Noto Sans TC + Outfit。`css/base.css` 字體變數：

```css
--font-display: 'Outfit', 'Noto Sans TC', sans-serif;
--font-body: 'Noto Sans TC', 'Outfit', sans-serif;
```

- **方案 A（保守）**：font stack 改系統字體優先，仍保留 Google Font link。省流量效果有限。
- **方案 B（積極）**：移除 Noto Sans TC 的 Google Font link，body 用系統中文字體：

```css
--font-body: -apple-system, BlinkMacSystemFont, "PingFang TC",
  "Noto Sans CJK TC", "Microsoft JhengHei", "Segoe UI", sans-serif;
```

可保留 Outfit 給數字 / 英文標題 / 品牌字。

**風險**：不同手機字型不同，品牌一致性下降；中文字重、行高、按鈕文字寬度可能改變；需實機截圖比對。

**決策條件**：產品端接受視覺差異後再做。若要追求中低階手機流量與 LCP，建議方案 B。

---

## 7. 不建議納入本計畫的項目

超出本計畫「低風險小改」範圍：

- `app.js` 拆檔：方向正確，但屬架構工程。
- 全量 Firebase SDK dynamic import：需重構多個服務入口。
- 完整 `srcset`：要先確認後端產出多解析度變體。
- 虛擬列表：活動時間軸超過大量筆數可考慮，會碰觸 scroll anchor、搜尋、日期定位。
- 遊戲 / color-cat 低階模式：需產品決策。
- LOGO 大圖與 `og.png`：不是主流程列表卡頓的第一優先，可另開圖片資產瘦身計畫。

---

## 8. 建議執行順序

**第一波（低風險）**：1. 補主要圖片 `width/height/decoding`（1-2 小時）→ 2. 真實 selector 加 `content-visibility`（30-60 分）→ 3. 移除 sticky 常駐元素 `saturate()`（15-30 分）→ 4. 補全 `prefers-reduced-motion`（30 分）。

**第二波（需量測 / 重構）**：5. Firebase preload A/B 量測（30-60 分）→ 6. Firebase SDK 分層 lazy load（0.5-1.5 天）→ 7. SW cache key 修正 + 補 CSS（1-2 小時）。

**第三波（產品決策）**：8. Noto Sans TC 是否移除（視決策）。

---

## 9. 驗證流程

### 9.1 本地測試

```bash
npm run test:unit          # 動到 JS / CSS / HTML / SW 都跑
npm run test:e2e:smoke     # 動到路由、頁面切換、主要列表時跑
```

動到 Service Worker 必須跑 `node scripts/bump-version.js` 並檢查 `js/config.js`、`index.html`、`sw.js` 版本同步。

### 9.2 手動驗收清單

- 首頁可立即顯示 boot snapshot 內容
- 活動列表切 tab、搜尋、日期定位正常
- 點活動 / 俱樂部 / 賽事卡的 pending loading 正常
- 活動詳情報名列 sticky 正常
- 圖片載入不扭曲、不明顯跳動
- LINE LIFF 內開啟正常
- iPhone 舊機即使不支援 `content-visibility` 也不破版

### 9.3 效能紀錄

每波至少記錄：首頁 cold load transferred size、首頁 LCP / CLS、活動列表 50 筆滾動 performance trace、活動詳情進入時間、中階 Android LINE WebView 實機手感。

---

## 10. 風險總覽

| 風險 | 來源 | 緩解 |
|------|------|------|
| `content-visibility` 舊 iOS 無效 | 瀏覽器支援限制 | 當 progressive enhancement |
| intrinsic size 估錯造成跳動 | `contain-intrinsic-size` 設錯 | 實機調整，分 selector 設高度 |
| 圖片比例寫錯 | 未對齊實際容器 | 依 CSS 容器尺寸補，不用上傳檔原始比例 |
| Firebase ready 變慢 | 只移除 preload 未改 loader | 先量測，正式方案改 SDK 分層 |
| SW 補 CSS 沒命中 | 無版號 cache key 對不上 `?v=` | 只對同源、帶 `?v=` 的靜態資源限縮使用 `ignoreSearch` |
| reduced motion 讓 loading 不明顯 | 全域停動畫 | 保留靜態 loading 文案或進度條 |
| 字體改動影響品牌 | 移除 Noto Sans TC | 產品確認、截圖比對 |

---

## 11. 修改檔案總覽

### 第一波預計修改

| 檔案 | 內容 |
|------|------|
| `css/base.css` | `prefers-reduced-motion` 全域降級 |
| `css/activity.css` | `.tl-event-row` content-visibility、sticky 報名列移除 saturate |
| `css/team.css` | `.tc-card` content-visibility |
| `css/layout.css` | 頂部 sticky bar 移除 saturate |
| `js/modules/event/event-list.js` | 活動卡 cover 補 `1200×450` |
| `js/modules/event/event-list-timeline.js` | timeline thumb 補 `48×48` |
| `js/modules/home-next-activity.js` | homeNext 補 `1000×750` |
| `js/modules/team/team-list-render.js` | 俱樂部 card 補 `1000×1000` |
| `js/modules/tournament/tournament-render.js` | 賽事卡 cover 補 `1200×450` |
| `js/modules/event/event-detail.js` | detail cover 補 `1200×450` |
| `js/modules/team/team-detail.js` | detail cover 補 `1200×450` |
| `js/modules/tournament/tournament-detail.js` | detail cover 補 `1200×450` |
| `js/modules/event/event-host-list.js` | host avatar 補 `32×32` |
| `js/modules/banner.js` | float-ad 補 `80×80`、sponsor-slot 補 `100×100`（皆 1:1） |

注：`css/home.css` 已不在第一波範圍（`.h-card` ROI 低不套 content-visibility）。

### 第二波可能修改

| 檔案 | 內容 |
|------|------|
| `index.html` | Firebase preload 實驗、字體決策 |
| `app.js` | Firebase SDK 分層載入 |
| `js/firebase-config.js` | Storage / Functions lazy ready 協調 |
| `js/firebase-crud.js` | Storage / Functions 使用點補 ready |
| `js/api-service.js` | Functions 使用點補 ready |
| `sw.js` | 版本化靜態資源 cache key 比對修正 + 補齊 CSS |
| `scripts/bump-version.js` | 若改 SW 版本策略可能需同步 |

---

## 12. 白話結論

這份優化計畫可以做，但要把原本太樂觀的部分收斂。

第一波建議先做：圖片尺寸、真實列表 selector 的 `content-visibility`、sticky 毛玻璃降成本、減動效。這些改動的共同特性是：每一條都對應實際存在的選擇器與檔案、改完用戶在中低階手機上能感覺到差別、出了問題一句 `git revert` 就能還原，風險低、好衡量。

第二波（Firebase SDK 分層 lazy load、SW cache key 修正）方向正確但不能照原版直接做，需要先量測、補 helper、改 fetch 比對策略，工時與風險都高一個量級，獨立排期比較安全。

第三波（Noto Sans TC 改系統字體）可能省下可觀字型流量，但實際數字要用 Network 面板量測；它會改變品牌視覺，必須由產品端決策，不是純工程判斷。

不承諾「FPS 30 變 55」「LCP 快 200-500ms」「Lighthouse 80+」這類數字——本計畫採 before/after 量測，做完才能說改善多少；做不出來就 revert，不打腫臉充胖子。

執行時依 CLAUDE.md §部署前審查流程：改完→跑測試→commit→等 `/codex:review`→push。動到 CSS/JS/HTML 都要先 `node scripts/bump-version.js` 同步版號。
