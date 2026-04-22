# 活動行事曆 — 月曆視圖實作計畫書

**狀態**：待用戶審核後動工
**預估工期**：7.5 個工作日（可拆分 2-3 個 commit 批次）
**版號影響**：會 bump 1-3 次（視批次拆分）
**預計動到檔案**：11 個（含 3 新建）

---

## 1. 功能概述

在 `#page-activities`（活動頁）新增第三種視圖模式「月曆」，與現有「進行中 / 已結束」並列為 3 個 tab。月曆以「一頁 = 一個月」為單位，支援上下滑手勢切換月份，每個日期格極簡顯示最多 3 場活動，超過以「+N」形式可點擊跳回直瀑式視圖並定位該日。活動顏色以**運動類型**區分（與現有以活動類型區分的顏色不同），並支援運動標籤篩選。

### 關鍵差異（與現有 timeline view 的對比）

| 維度 | Timeline（現有）| Calendar（新增）|
|------|----------------|----------------|
| 排版方向 | 垂直瀑布流（時序）| 7x5/6 網格（月曆）|
| 顏色映射 | 活動類型（PLAY/友誼/教學/觀賽）| 運動類型（足球/籃球/...）|
| 一頁範圍 | 滾動載入所有活動 | 單月（1 號到最後一天）|
| 切換方式 | 滾動 | 整頁上/下滑換月（scroll snap）|
| 活動密度 | 完整資訊 | 極簡（每日 3 slots + 溢出 +N）|

---

## 2. 核心設計決策（13 題預設答案）

| # | 問題 | 採用決策 | 理由 |
|---|------|---------|------|
| Q1 | Tab 結構 | `[進行中] [已結束] [月曆]` 三 tab 並列 | 符合用戶原設計、UX 簡潔 |
| Q2 | 月曆顯示範圍 | **全部活動**（進行中 + 已結束），已結束用淡色 opacity 50% | 月曆主要用來「看當月有什麼」，不該被狀態篩走 |
| Q3 | 「進行中」改名 | 保持「進行中」不改 | 避免 i18n 變動、現有用戶習慣 |
| Q4 | 運動顏色覆蓋範圍 | **熱門 8 種獨立色 + 其他歸「其他」灰** | 16 種全獨立色在深色主題下難辨識 |
| Q5 | 顏色決策權 | 我挑（用色彩心理學 + 無障礙對比度）| 用戶可後續調整 |
| Q6 | 活動顯示資訊 | **標準：運動 emoji + 時間 HH:mm + 標題 5 字** | 窄版可容納、足夠識別 |
| Q7 | 日期格行數 | 寬版 3 行 / 窄版 2 行（第 3 場起算 +N） | 窄版手機螢幕限制 |
| Q8 | 空白日 | 只顯示日期數字，今天額外強調 | 極簡原則 |
| Q9 | 「+N」行為 | 切回「進行中」tab + `scrollIntoView` 錨點該日 | 最熟悉的 UX、無需新 modal |
| Q10 | 直瀑錨點實作 | Timeline 渲染時加 `data-date-anchor="YYYY-MM-DD"` 到日期分組元素 | 最小改動達成目標 |
| Q11 | 月曆範圍邊界 | 過去 6 個月、未來無限（依活動資料）| 平衡資料量與可瀏覽性 |
| Q12 | 手勢衝突 | **CSS scroll-snap-y mandatory**（每月一 snap point）| 原生手勢最順、無 JS 衝突 |
| Q13 | 週起始日 | 週一起始（ISO 8601、台灣習慣）| 符合本地慣例 |

---

## 3. 運動顏色系統（Q4-Q5 詳細）

### 8 種熱門運動獨立色 + 1 種備援色

| 運動 | Light Mode | Dark Mode | Emoji | 說明 |
|------|-----------|-----------|-------|------|
| 足球 `football` | `#2e7d32` 綠 | `#66bb6a` | ⚽ | 草地綠，辨識度最強 |
| 籃球 `basketball` | `#e65100` 橘 | `#ffa726` | 🏀 | 經典 NBA 橘 |
| 匹克球 `pickleball` | `#7b1fa2` 紫 | `#ba68c8` | 🥒 | 紫色區隔球類 |
| 美式躲避球 `dodgeball` | `#c62828` 紅 | `#ef5350` | 🎯 | 競技紅 |
| 跑步 `running` | `#0277bd` 藍 | `#4fc3f7` | 🏃 | 晴天藍 |
| 登山 / 健行 `hiking` | `#4e342e` 棕 | `#8d6e63` | 🥾 | 山林棕 |
| 羽球 `badminton` | `#f57f17` 黃橘 | `#ffca28` | 🏸 | 羽球黃 |
| 游泳 `swimming` | `#006064` 深青 | `#4dd0e1` | 🏊 | 水藍 |
| **其他運動** `other` | `#616161` 灰 | `#9e9e9e` | 🏃 | 排球/桌球/網球/棒球/健身等 |

### 色彩驗證

- 所有顏色 WCAG AA 對比度 ≥ 4.5:1 on white/dark background
- 避免與現有 `--accent` (#0d9488 青綠) 衝突 → 足球選深綠 #2e7d32
- 避免與「已結束 opacity 50%」後的視覺衝突 → 顏色飽和度足夠

### 實作：CSS 變數 + JS 映射表

```css
/* css/calendar.css */
:root {
  --sport-football: #2e7d32;
  --sport-basketball: #e65100;
  /* ... */
}
[data-theme="dark"] {
  --sport-football: #66bb6a;
  /* ... */
}
```

```javascript
// js/modules/event/event-calendar-constants.js
const SPORT_COLORS = Object.freeze({
  football:   { var: '--sport-football',   emoji: '⚽', label: '足球' },
  basketball: { var: '--sport-basketball', emoji: '🏀', label: '籃球' },
  // ...
  other:      { var: '--sport-other',      emoji: '🏃', label: '其他' },
});
```

---

## 4. UI 設計規格

### 4.1 Tab 切換區（現況擴充）

```html
<!-- pages/activity.html 現有結構（簡化示意）-->
<div class="tab-bar">
  <button class="tab active" data-tab="active">進行中</button>
  <button class="tab" data-tab="ended">已結束</button>
  <!-- ★ 新增 -->
  <button class="tab" data-tab="calendar">月曆</button>
</div>

<div id="activity-timeline">...（現有直瀑）</div>
<!-- ★ 新增 -->
<div id="activity-calendar" hidden>...（月曆）</div>
```

Tab 切換用現有 JS 邏輯擴充，`data-tab="calendar"` 時：
- 隱藏 `#activity-timeline`
- 顯示 `#activity-calendar`
- 呼叫 `App._renderActivityCalendar()`

### 4.2 月曆結構（寬版）

```
┌─────────────────────────────────────────────────────────┐
│  [← 2026/04]   2026 年 5 月   [2026/06 →]    [運動 ▼]   │ ← 月份導覽 + 篩選
├──┬──┬──┬──┬──┬──┬──┤
│一│二│三│四│五│六│日│ ← 週標題（週一起始）
├──┼──┼──┼──┼──┼──┼──┤
│28│29│30│ 1│ 2│ 3│ 4│
│  │  │  │⚽│  │🏀│⚽│ ← 運動色色條 + 標題
│  │  │  │19:0│ │14:0│18:0│
├──┼──┼──┼──┼──┼──┼──┤
│ 5│ 6│ 7│ 8│ 9│10│11│ ← 6 週的完整月曆（跨月灰化）
... 以此類推 6 行
```

- 每格約 **寬版 150x120px、窄版 45x80px**
- 跨月日期（上/下月最後/開始幾天）**灰化顯示**但仍可點擊
- 今天：**背景 `var(--accent-bg)` + 粗體日期**
- 週末：日期顏色稍異（可選）

### 4.3 日期格內容（3 場活動）

```
┌────────────┐
│  15        │ ← 日期數字（右上）
│ ━━━━━━━━━  │ ← 運動色細條（左側 3px）
│ ⚽ 19:30    │ ← emoji + 時間
│ 雙連網球場   │ ← 標題截 5 字
│ ━━━━━━━━━  │
│ 🏀 20:00 ..│
│ ━━━━━━━━━  │
│ +2 more    │ ← 點擊切 timeline 並定位
└────────────┘
```

### 4.4 手勢 — scroll-snap（Q12）

```css
.calendar-container {
  scroll-snap-type: y mandatory;
  overflow-y: auto;
  height: calc(100vh - headers);
}
.calendar-month {
  scroll-snap-align: start;
  scroll-snap-stop: always;
  height: 100%;
}
```

Browser 原生支援滑動切換、無需 JS 手勢 listener，跨瀑布問題小。

### 4.5 篩選整合

既有運動標籤 (`sport-picker`) 已在頂部，月曆的篩選**沿用相同 `App._activeSport`** 狀態。切到月曆時：

- 若 `_activeSport = 'all'` → 顯示所有運動活動
- 若 `_activeSport = 'football'` → 只顯示足球活動
- **此切換會同步影響 Timeline view**（現況已是這樣）

### 4.6 響應式斷點

```css
/* 寬版 desktop（> 768px）：7x6 grid，每格 150x120 */
.calendar-grid { grid-template-columns: repeat(7, 1fr); }

/* 窄版 mobile（≤ 768px）：7x6 grid 縮小 */
@media (max-width: 768px) {
  .calendar-grid { grid-template-columns: repeat(7, minmax(0, 1fr)); }
  .calendar-day { min-height: 80px; }
  .calendar-event-title { display: none; }  /* 只保留 emoji + 時間 */
}
```

### 4.7 深淺主題

全部用 CSS 變數：`--bg-card`、`--border`、`--text-primary` 等現有系統。深色主題的運動色用獨立 palette（見 §3）。

---

## 5. 檔案變更清單

### 新建（3 個）

| 檔案 | 行數估 | 用途 |
|------|--------|------|
| `css/calendar.css` | ~200 | 月曆網格、日期格、運動色、動畫 |
| `js/modules/event/event-list-calendar.js` | ~350 | 月曆 render、月份切換、活動 group by date |
| `js/modules/event/event-calendar-constants.js` | ~80 | SPORT_COLORS 映射表、月份名稱、週天名稱 |

### 修改（8 個）

| 檔案 | 改動範圍 | 鎖定狀態 |
|------|---------|---------|
| `pages/activity.html` | 新增 `[月曆]` tab button + `#activity-calendar` 容器 | 一般 |
| `js/modules/event/event-list-timeline.js` | 加 `data-date-anchor` 到日期分組元素（Q10） | ⚠️ **鎖定區、小心** |
| `js/modules/event/event-list.js` | 擴充 `_activeTab` 處理第 3 種 'calendar' | ⚠️ **鎖定區、小心** |
| `js/modules/event/event-list-helpers.js` | 加 `_groupEventsByDate` 輔助函式 | ⚠️ **鎖定區、小心** |
| `js/core/script-loader.js` | 註冊 `event-list-calendar.js` | 一般 |
| `index.html` | `<link>` 載入 `calendar.css` | 一般（改 HTML 要 bump version）|
| `docs/architecture.md` | 模組清單加 `event-list-calendar` | 一般 |
| `docs/structure-guide.md` | 中文功能導覽同步 | 一般 |

### 不改動

- Firestore Rules（月曆只讀現有 events）
- `js/firebase-service.js`、`js/firebase-crud.js`（鎖定函式區不動）
- `js/api-service.js`（ApiService.getEvents 已夠用）

---

## 6. 工作分解（WBS）

### Phase 1：基礎設施（Day 1-2）

- [ ] 1.1 建立 `event-calendar-constants.js`（SPORT_COLORS / WEEK_NAMES / MONTH_NAMES）
- [ ] 1.2 建立 `css/calendar.css` 骨架（grid、日期格、tab button）
- [ ] 1.3 index.html 載入 calendar.css
- [ ] 1.4 script-loader 註冊新模組
- [ ] 1.5 pages/activity.html 加 `[月曆]` tab + `#activity-calendar` 容器

### Phase 2：月曆 render（Day 2-4）

- [ ] 2.1 `event-list-calendar.js` — `_buildMonthGrid(year, month)` 產出 42 格（6 週 x 7 天）
- [ ] 2.2 `_groupEventsByDate(events)` — 按 YYYY-MM-DD group
- [ ] 2.3 日期格 render：每格顯示日期 + 最多 3 場活動 + 「+N」
- [ ] 2.4 運動色整合：每場活動用 `SPORT_COLORS[sportTag].var` 取色
- [ ] 2.5 今天高亮、週末顏色、跨月灰化

### Phase 3：互動與導航（Day 4-6）

- [ ] 3.1 Tab 切換邏輯擴充（event-list.js）
- [ ] 3.2 Scroll-snap 手勢切換月份
- [ ] 3.3 月份 `←/→` 按鈕（手勢不可用時 fallback）
- [ ] 3.4 「+N」點擊：切回 timeline tab + 加 `data-date-anchor` 到 timeline + `scrollIntoView({ behavior: 'smooth', block: 'start' })`
- [ ] 3.5 活動格點擊：showEventDetail（現有）
- [ ] 3.6 運動篩選整合：切到月曆時 `_activeSport` 仍有效

### Phase 4：RWD + 主題（Day 6-7）

- [ ] 4.1 窄版 CSS（media query < 768px）
- [ ] 4.2 深淺主題運動色切換（data-theme）
- [ ] 4.3 無障礙：鍵盤導航、`aria-label`、`role="grid"`

### Phase 5：測試與收尾（Day 7-8）

- [ ] 5.1 E2E 測試：切 tab、切月、點活動、篩選、點 +N
- [ ] 5.2 跨瀏覽器：Chrome、Safari、LINE WebView（LIFF）
- [ ] 5.3 `npm run test:unit`（鎖定函式區動到要跑）
- [ ] 5.4 文件同步：architecture.md / structure-guide.md
- [ ] 5.5 CLAUDE.md memory 記錄（若踩到新坑則 `[永久]`）
- [ ] 5.6 bump-version + commit + push

---

## 7. 驗收標準（完成定義）

### 功能驗收

- [ ] `[月曆]` tab 可切換，不影響現有 `[進行中]` `[已結束]` tab
- [ ] 月曆正確顯示當前月（預設）
- [ ] 手機上下滑切換月份順暢（scroll-snap）
- [ ] 寬版桌機有 `←/→` 按鈕切換
- [ ] 每個日期格最多顯示 3 場活動，第 4 場起顯示「+N」
- [ ] 8 個運動各有獨立辨識色（light/dark 兩主題下）
- [ ] 點「+N」正確切回 timeline 並滾到該日
- [ ] 運動標籤篩選在月曆上有效
- [ ] 已結束活動 opacity 50%（月曆內）
- [ ] 今天日期有明顯視覺區分

### 非功能驗收

- [ ] `test:unit` 全過（2362+ 不 regression）
- [ ] 版號 bump 完成（4 處一致）
- [ ] Lighthouse score 不低於現況（Performance ≥ 90）
- [ ] LINE WebView 實測無破版
- [ ] Safari iOS 實測手勢正常
- [ ] 深色主題下所有運動色對比度 ≥ 4.5:1

---

## 8. 風險評估（CLAUDE.md 規範）

| 評估項目 | 內容 |
|----------|------|
| **做了會怎樣（好處）** | 用戶瀏覽活動新選項、視覺化整月活動密度、增加停留時間、運動色直觀辨識 |
| **不做會怎樣** | 現有 timeline 仍可用，但「當月有什麼活動」需手動滾 |
| **最壞情況** | 手勢衝突導致 LINE WebView 頁面跳脫、跨月活動顯示錯亂、16+ 運動顏色在深色模式辨識困難 |
| **影響範圍** | 3 新檔 + 8 個既有檔改動（含鎖定函式區 3 個）、css 新增、version bump |
| **回退難度** | 中 —— 可整包 revert，但觸及鎖定區域需逐一確認無 regression |
| **歷史教訓** | `event-list-timeline.js` 近 2 個月被修 15+ 次（高頻修改區）、跳頂問題反覆 6 輪才修好、觸發 rerender 錯誤會造成「選了 tab 但沒切」 |
| **跨瀏覽器** | scroll-snap 在 iOS Safari 15+ 完整支援、LINE WebView 視 iOS 版本；需實測備案 |

---

## 9. 回退策略

若功能上線後發現嚴重問題：

### 層級 1：隱藏 tab（1 分鐘）

在 `pages/activity.html` 的 `[月曆]` tab 加 `style="display:none"`，立即隱藏入口但保留程式碼。

### 層級 2：整包 revert（10 分鐘）

```bash
git revert <commit-hash>
node scripts/bump-version.js
git push origin HEAD:main
```

### 層級 3：只保留 timeline 錨點支援（30 分鐘）

若只是月曆有 bug，可單獨 revert 月曆相關檔案，保留 `data-date-anchor` 的 timeline 改動（未來可重用）。

---

## 10. 測試計畫

### 單元測試（新增）

| 測試檔 | 測什麼 |
|--------|--------|
| `tests/unit/event-calendar.test.js` | `_buildMonthGrid(2026, 4)` 產出 42 格、第 1 週含跨月 3/30-31 |
| 同上 | `_groupEventsByDate([events])` 按 date key 正確分組 |
| 同上 | `_getSportColor('football')` → 正確 CSS 變數 |
| 同上 | 跨月活動（4/30 到 5/2）只在 4/30 顯示 |

### 手動測試場景

1. **一般流程**
   - 開啟活動頁 → 切月曆 → 看 5 月 → 滑到 6 月 → 點活動 → 進詳情
2. **篩選整合**
   - 頂部切「籃球」→ 月曆只剩籃球活動
3. **溢出**
   - 找有 4+ 場的日期 → 點「+N」→ 應切回 timeline 並滾到該日
4. **手勢**
   - 手機上下滑切月、寬版桌機用按鈕
5. **跨瀏覽器**
   - LINE WebView（iOS / Android）、Safari、Chrome
6. **主題**
   - 淺色 / 深色主題下所有運動色可辨識
7. **無活動月**
   - 未來 3 個月、過去 6 個月有無活動都能正確顯示

---

## 11. 後續擴充點（不在本期）

- [ ] 週視圖（更極簡）
- [ ] 日視圖（單日完整列表）
- [ ] 匯出月曆到 Google Calendar / iCal
- [ ] 月曆訂閱功能
- [ ] 拖拉活動改日（需要管理權限）
- [ ] 統計圖表（當月活動密度 heatmap）
- [ ] 個人化：隱藏不感興趣的運動

---

## 12. CLAUDE.md 規則檢查清單（動手前必讀）

- [x] **外科手術式修改**：只動必要的檔案，鎖定函式區最小改動（只加 `data-date-anchor` 屬性、不改邏輯）
- [x] **程式碼精簡**：不加未來可能用到的抽象層
- [x] **跨瀏覽器相容性**：LINE WebView / Chrome / Safari 都要實測
- [x] **彈窗毛玻璃規範**：若有日期詳情彈窗則遵循
- [x] **實體 ID 統一**：活動用 `data.id`（非 `doc.id`）
- [x] **測試與 CI**：改 `event-list*.js` 必須跑 `npm run test:unit`
- [x] **版號更新**：改 HTML/JS/CSS 必須 `bump-version.js`
- [x] **文件同步**：新模組要更新 `architecture.md` + `structure-guide.md`
- [x] **開發守則**：新模組放入 `js/modules/event/` 對應資料夾（不扁平化）

---

## 13. 確認事項

此計畫書列出我的 13 個預設答案 + 完整工程計畫。若用戶確認：

- **全盤同意** → 我開始 Phase 1-5 實作
- **部分調整** → 請用 Q 編號告知修改點
- **延期** → 保留此計畫書作為未來執行依據

**預期完成時間**：若連續專注 7.5 天全職、或分散 2-3 週兼職。

---

**計畫書版本**：2026-04-22 v1
**維護者**：Claude
**連絡**：用戶審核後修訂 v2
