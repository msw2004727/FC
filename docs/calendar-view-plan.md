# 活動行事曆 — 月曆視圖實作計畫書

**狀態**：待用戶審核後動工
**預估工期**：7.5 個工作日（可拆分 2-3 個 commit 批次）
**版號影響**：會 bump 1-3 次（視批次拆分）
**預計動到檔案**：11 個（含 3 新建）
**狀態**：2026-04-22 v2 — 用戶確認 13 題（Q4/Q7/Q8/Q11 有調整），已更新計畫

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

## 2. 核心設計決策（13 題 — 用戶確認版）

| # | 問題 | 採用決策 | 備註 |
|---|------|---------|------|
| Q1 | Tab 結構 | `[進行中] [已結束] [月曆]` 三 tab 並列 | 用戶確認 Aa |
| Q2 | 月曆顯示範圍 | **全部活動**（進行中 + 已結束），已結束用淡色 opacity 50% | 用戶確認方案 1 |
| Q3 | 「進行中」tab 名 | 保持「進行中」不改（用戶原訊息的「一般」指「頁籤上所寫的」即現 tab 文字） | 用戶釐清 |
| Q4 | 運動顏色覆蓋範圍 | **熱門 8 種獨立色 + 結構化預留其他 8 種位置**（目前都 fallback 到 `--sport-other` 灰色，未來填色即生效）| 用戶要求預留擴充點 |
| Q5 | 顏色決策權 | 我挑（色彩心理學 + WCAG AA 對比度）| 用戶同意 |
| Q6 | 活動顯示資訊 | 標準：運動 emoji + 時間 HH:mm + 標題 5 字 | 用戶確認 |
| Q7 | 日期格活動數量 | **彈性顯示 1-3 場**（按當日實際活動數決定） | 用戶調整：不強制 3 slots |
|   |   | 1 場 → 字體稍大有呼吸空間 |
|   |   | 2 場 → 字體中等 |
|   |   | 3 場 → 字體最小（可讀下限 11px） |
|   |   | 4+ 場 → 3 場 + `+N more` 觸發區 |
| Q8 | 空白日 | 日期數字 + **淡色「—」符號**（opacity 0.25） | 用戶調整 |
| Q9 | 「+N」行為 | 切「進行中」tab + `scrollIntoView` 錨點該日 | 用戶確認 |
| Q10 | 直瀑錨點實作 | Timeline 渲染時加 `data-date-anchor="YYYY-MM-DD"` | 用戶確認 |
| Q11 | **月曆範圍邊界 + 懶載入** | 預設載入當月 ± 1 月（3 個月範圍）、過去最遠 3 個月、未來無限 | 用戶調整 |
|   |   | 用戶滑超過 ±1 月 → 動態 fetch 該月資料（按 Firestore composite query）|
|   |   | 目的：減少首次載入的 Firestore reads 成本 |
| Q12 | 手勢切換 | CSS scroll-snap-y mandatory（每月一 snap point）| 用戶採用建議 |
| Q13 | 週起始日 | 週一起始（ISO 8601、台灣習慣）| 用戶確認 |

---

## 3. 運動顏色系統（Q4-Q5 詳細）

### 8 種熱門運動獨立色 + 8 種結構化預留 + 1 種備援

| 運動 | Light Mode | Dark Mode | Emoji | 本期狀態 |
|------|-----------|-----------|-------|---------|
| 足球 `football` | `#2e7d32` 綠 | `#66bb6a` | ⚽ | ✅ 啟用 |
| 籃球 `basketball` | `#e65100` 橘 | `#ffa726` | 🏀 | ✅ 啟用 |
| 匹克球 `pickleball` | `#7b1fa2` 紫 | `#ba68c8` | 🥒 | ✅ 啟用 |
| 美式躲避球 `dodgeball` | `#c62828` 紅 | `#ef5350` | 🎯 | ✅ 啟用 |
| 跑步 `running` | `#0277bd` 藍 | `#4fc3f7` | 🏃 | ✅ 啟用 |
| 登山 / 健行 `hiking` | `#4e342e` 棕 | `#8d6e63` | 🥾 | ✅ 啟用 |
| 羽球 `badminton` | `#f57f17` 黃橘 | `#ffca28` | 🏸 | ✅ 啟用 |
| 游泳 `swimming` | `#006064` 深青 | `#4dd0e1` | 🏊 | ✅ 啟用 |
| 排球 `volleyball` | — | — | 🏐 | 🔒 結構預留，fallback 灰 |
| 網球 `tennis` | — | — | 🎾 | 🔒 結構預留，fallback 灰 |
| 桌球 `table_tennis` | — | — | 🏓 | 🔒 結構預留，fallback 灰 |
| 棒球 `baseball` | — | — | ⚾ | 🔒 結構預留，fallback 灰 |
| 壘球 `softball` | — | — | 🥎 | 🔒 結構預留，fallback 灰 |
| 健身 `fitness` | — | — | 💪 | 🔒 結構預留，fallback 灰 |
| 自行車 `cycling` | — | — | 🚴 | 🔒 結構預留，fallback 灰 |
| 其他 `other` | — | — | 🏃 | 🔒 結構預留，fallback 灰 |
| **備援** `--sport-other` | `#616161` 灰 | `#9e9e9e` | 🏃 | ✅ 未啟用運動統一用此色 |

### 色彩驗證

- 8 個啟用色 WCAG AA 對比度 ≥ 4.5:1 on white/dark background
- 避免與現有 `--accent` (#0d9488 青綠) 衝突 → 足球選深綠 #2e7d32
- 避免與「已結束 opacity 50%」後的視覺衝突 → 顏色飽和度足夠

### 實作：CSS 變數結構化預留 + JS 映射表

```css
/* css/calendar.css — 啟用的 8 個 + 預留 8 個註解 */
:root {
  /* ── 啟用運動（8 種）── */
  --sport-football:   #2e7d32;
  --sport-basketball: #e65100;
  --sport-pickleball: #7b1fa2;
  --sport-dodgeball:  #c62828;
  --sport-running:    #0277bd;
  --sport-hiking:     #4e342e;
  --sport-badminton:  #f57f17;
  --sport-swimming:   #006064;

  /* ── 結構預留（fallback 到 --sport-other）── */
  --sport-volleyball:    var(--sport-other);
  --sport-tennis:        var(--sport-other);
  --sport-table-tennis:  var(--sport-other);
  --sport-baseball:      var(--sport-other);
  --sport-softball:      var(--sport-other);
  --sport-fitness:       var(--sport-other);
  --sport-cycling:       var(--sport-other);

  /* ── 備援 ── */
  --sport-other: #616161;
}
[data-theme="dark"] {
  --sport-football:   #66bb6a;
  --sport-basketball: #ffa726;
  --sport-pickleball: #ba68c8;
  --sport-dodgeball:  #ef5350;
  --sport-running:    #4fc3f7;
  --sport-hiking:     #8d6e63;
  --sport-badminton:  #ffca28;
  --sport-swimming:   #4dd0e1;
  --sport-other:      #9e9e9e;
  /* 預留的 7 個自動 inherit 到 --sport-other */
}
```

```javascript
// js/modules/event/event-calendar-constants.js
const SPORT_COLORS = Object.freeze({
  // 啟用運動（8）
  football:      { var: '--sport-football',      emoji: '⚽', label: '足球',    enabled: true },
  basketball:    { var: '--sport-basketball',    emoji: '🏀', label: '籃球',    enabled: true },
  pickleball:    { var: '--sport-pickleball',    emoji: '🥒', label: '匹克球',  enabled: true },
  dodgeball:     { var: '--sport-dodgeball',     emoji: '🎯', label: '美式躲避球', enabled: true },
  running:       { var: '--sport-running',       emoji: '🏃', label: '跑步',    enabled: true },
  hiking:        { var: '--sport-hiking',        emoji: '🥾', label: '登山健行', enabled: true },
  badminton:     { var: '--sport-badminton',     emoji: '🏸', label: '羽球',    enabled: true },
  swimming:      { var: '--sport-swimming',      emoji: '🏊', label: '游泳',    enabled: true },
  // 結構預留（未來啟用只需改 CSS 值、不需改 JS）
  volleyball:    { var: '--sport-volleyball',    emoji: '🏐', label: '排球',    enabled: false },
  tennis:        { var: '--sport-tennis',        emoji: '🎾', label: '網球',    enabled: false },
  table_tennis:  { var: '--sport-table-tennis',  emoji: '🏓', label: '桌球',    enabled: false },
  baseball:      { var: '--sport-baseball',      emoji: '⚾', label: '棒球',    enabled: false },
  softball:      { var: '--sport-softball',      emoji: '🥎', label: '壘球',    enabled: false },
  fitness:       { var: '--sport-fitness',       emoji: '💪', label: '健身',    enabled: false },
  cycling:       { var: '--sport-cycling',       emoji: '🚴', label: '自行車',  enabled: false },
  // 備援
  other:         { var: '--sport-other',         emoji: '🏃', label: '其他',    enabled: true },
});
```

**未來啟用流程**：只需改 CSS 中 `--sport-xxx: 原 fallback → 實際色值` 即可，`enabled: false` 改 `true`，無需動 render 邏輯。

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

### 4.3 日期格內容（彈性顯示，最多 3 場活動）

**0 場活動（空白日）**：
```
┌────────────┐
│  15        │ ← 日期數字
│     —      │ ← 淡色「—」符號（opacity 0.25）
│            │
└────────────┘
```

**1 場活動**（字體稍大、有呼吸空間）：
```
┌────────────┐
│  15        │
│ ━━━━━━━━━  │ ← 運動色細條
│ ⚽ 19:30    │ ← 字體 13px
│ 雙連網球場   │
│            │ ← 留白
└────────────┘
```

**2 場活動**（字體中等）：
```
┌────────────┐
│  15        │
│ ━━━━━━━━━  │
│ ⚽ 19:30  雙連 │ ← 字體 12px
│ ━━━━━━━━━  │
│ 🏀 20:00  大安 │
│            │
└────────────┘
```

**3 場活動**（字體最小但保持可讀）：
```
┌────────────┐
│  15        │
│ ━━━━━━━━━  │
│ ⚽ 19:30  雙 │ ← 字體 11px（可讀下限）
│ 🏀 20:00  大 │
│ 🎯 21:00  成 │
│            │
└────────────┘
```

**4+ 場活動**（3 場 + 溢出觸發區）：
```
┌────────────┐
│  15        │
│ ━━━━━━━━━  │
│ ⚽ 19:30  雙 │
│ 🏀 20:00  大 │
│ 🎯 21:00  成 │
│  +2 more   │ ← 點擊切 timeline 並滾到該日
└────────────┘
```

**字體階層（CSS `:has` 或 JS 動態 class 實作）**：

```css
.calendar-day[data-event-count="1"] .event-item { font-size: 13px; line-height: 1.5; }
.calendar-day[data-event-count="2"] .event-item { font-size: 12px; line-height: 1.4; }
.calendar-day[data-event-count="3"] .event-item,
.calendar-day[data-event-count="4+"] .event-item { font-size: 11px; line-height: 1.3; }

.no-event-mark {
  color: var(--text-muted);
  opacity: 0.25;
  font-size: 14px;
  text-align: center;
  display: block;
  margin-top: .3rem;
}
```

render 時 `data-event-count` 設為實際活動數（1/2/3/4+），CSS 自動套對應字體。

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

### 4.8 置頂活動高光（後台 pinned 功能整合）

後台管理可將活動設為**置頂**（`event.pinned === true`）。月曆上置頂活動需有**明顯視覺高光**，區別於一般活動。

#### 高光設計

```
┌────────────┐
│  15  📌    │ ← 日期數字右邊加 pin icon（若當日有置頂）
│ ━━━━━━━━━  │
│ ✨⚽ 19:30 雙 │ ← 置頂活動：左側加 ✨ 星號 + 背景加發光效果
│ 🏀 20:00 大 │ ← 一般活動：只有運動色條
│            │
└────────────┘
```

#### CSS 實作（保留運動色 + 額外裝飾）

```css
/* 置頂活動：運動色 + 發光邊框 */
.calendar-event-item.is-pinned {
  position: relative;
  background: linear-gradient(
    90deg,
    var(--sport-color, var(--sport-other)) 0 3px,
    color-mix(in srgb, var(--sport-color) 12%, var(--bg-card)) 3px
  );
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--sport-color) 40%, transparent),
    0 0 8px -2px color-mix(in srgb, var(--sport-color) 35%, transparent);
  font-weight: 600;
}

/* 置頂標記：✨ 星號加載入動畫 */
.calendar-event-item.is-pinned::before {
  content: '✨';
  margin-right: 2px;
  animation: pin-sparkle 3s ease-in-out infinite;
}

@keyframes pin-sparkle {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; transform: scale(1.15); }
}

/* 日期數字右邊的 pin icon（若當日有任一置頂活動）*/
.calendar-day[data-has-pinned="true"] .calendar-day-number::after {
  content: '📌';
  font-size: 0.7em;
  margin-left: 2px;
  vertical-align: super;
}

/* 減少動畫對 reduce-motion 用戶的影響 */
@media (prefers-reduced-motion: reduce) {
  .calendar-event-item.is-pinned::before { animation: none; }
}
```

#### Render 邏輯

```javascript
// event-list-calendar.js
function _buildEventHTML(event) {
  const sportKey = event.sportTag || 'other';
  const sportDef = SPORT_COLORS[sportKey] || SPORT_COLORS.other;
  const pinnedClass = event.pinned ? ' is-pinned' : '';
  return `<div class="calendar-event-item${pinnedClass}"
            style="--sport-color: var(${sportDef.var})"
            onclick="App.showEventDetail('${event.id}')"
            title="${event.pinned ? '置頂活動：' : ''}${escapeHTML(event.title)}">
    <span class="event-emoji">${sportDef.emoji}</span>
    <span class="event-time">${formatTime(event.date)}</span>
    <span class="event-title-short">${escapeHTML(event.title.slice(0, 5))}</span>
  </div>`;
}

function _buildDayCell(date, events) {
  const hasPinned = events.some(e => e.pinned);
  return `<div class="calendar-day"
              data-date="${date}"
              data-event-count="${events.length}"
              data-has-pinned="${hasPinned}">
    <div class="calendar-day-number">${dayNum}</div>
    ${events.slice(0, 3).map(_buildEventHTML).join('')}
    ${events.length > 3 ? `<div class="calendar-more" onclick="...">+${events.length - 3} more</div>` : ''}
  </div>`;
}
```

#### 視覺優先級

當日期格空間有限時，**置頂活動排在最前面**（若有 4+ 場活動，置頂優先進 3 個 slot）：

```javascript
function _sortEventsForCell(events) {
  return events.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;  // 置頂優先
    return a.date.localeCompare(b.date);  // 同優先級按時間
  });
}
```

---

### 4.9 懶載入策略（Q11 — 減少 Firestore 成本）

#### 載入範圍

- **初次進月曆 tab**：載入當月 ± 1 月（共 3 個月資料）
- **用戶滑超過預載範圍**：動態 fetch 額外月份
- **最遠範圍**：過去 3 個月、未來不限（但用戶不可能一次滑很遠）

#### Cache 結構

```javascript
App._calendarCache = {
  loadedMonths: new Set(),  // e.g. { '2026-03', '2026-04', '2026-05' }
  eventsByMonth: new Map(), // '2026-04' → [events...]
  loadingMonths: new Set(), // fetch 中避免重複請求
};
```

#### 觸發時機

| 情境 | 動作 |
|------|------|
| 首次切 `[月曆]` tab | fetch 當月 ± 1 月 |
| 滑動到已載入月份 | 直接 render |
| 滑動到未載入月份 | fetch 該月 + 相鄰 1 月（合計 2 個月 buffer）|
| 滑到過去 > 3 個月 | 顯示「無更早資料」提示，不 fetch |
| 用戶回到當月 | 已有 cache，不重 fetch |

#### Firestore query 策略

**用既有 `FirebaseService` 快取機制（不自己發 query）**：

目前 `ApiService.getEvents()` 回傳所有已快取事件（from `FirebaseService._cache.events`）。計畫書做法：

- **不新增 query**：月曆篩選由**前端 cache 的事件 in-memory filter**（`event.date` 是字串 `YYYY-MM-DD HH:mm`，按月 group 極快）
- **依賴既有載入機制**：events 在 boot 時 load 一次、增量由 realtime listener 維護（現有架構）

這代表 Q11 的「懶載入」其實是**前端 filter 而非 Firestore lazy query**，因為現有資料層已把所有 events cache 到前端。

#### 若未來 events 量過大（> 1000 場活動）

那時才需要真正的 Firestore 按月 query，但 **本期不實作**（增加 complexity、現況資料量不需要）。在 `docs/calendar-view-plan.md` §11 後續擴充點已加此項。

#### 成本評估（以現況規模）

- 當前 events 集合數量：依實際規模而定（假設幾十到幾百場）
- FirebaseService boot 時 load 一次，之後 realtime incremental updates
- 月曆切換：0 額外 Firestore reads（純前端 filter）
- **結論：Q11 的「懶載入」變成「前端 in-memory filter」，零額外資料庫成本**

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
- [ ] 2.2 `_groupEventsByDate(events)` — 按 YYYY-MM-DD group（純 in-memory filter）
- [ ] 2.3 日期格彈性 render：`data-event-count="1|2|3|4+"` + CSS 字體階層
- [ ] 2.4 空白日「—」符號（`.no-event-mark`，opacity 0.25）
- [ ] 2.5 運動色整合：每場活動用 `SPORT_COLORS[sportTag].var` 取色，未啟用運動 fallback `--sport-other`
- [ ] 2.6 今天高亮、跨月灰化（週末顏色本期不做）

### Phase 3：互動與導航（Day 4-6）

- [ ] 3.1 Tab 切換邏輯擴充（event-list.js）
- [ ] 3.2 Scroll-snap 手勢切換月份（預載當月 ± 1 月共 3 個月的 DOM）
- [ ] 3.3 月份 `←/→` 按鈕（手勢不可用時 fallback）
- [ ] 3.4 月份範圍邊界：過去 3 個月顯示「無更早資料」灰階 UI、未來無限
- [ ] 3.5 「+N」點擊：切回 timeline tab + scrollIntoView 到 `data-date-anchor`
- [ ] 3.6 活動格點擊：showEventDetail（現有）
- [ ] 3.7 運動篩選整合：切到月曆時 `_activeSport` 仍有效
- [ ] 3.8 **置頂活動高光** render（`.is-pinned` class + 發光邊框 + ✨ 動畫 + 日期旁 📌 icon）
- [ ] 3.9 置頂優先排序：`_sortEventsForCell` 把 pinned 排在最前、同優先級按時間
- [ ] 3.10 `prefers-reduced-motion` 無障礙：關閉 ✨ 動畫

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
- [ ] 每個日期格**彈性顯示** 1-3 場活動（`data-event-count` 控字體階層）
- [ ] 4 場以上顯示「+N more」點擊區
- [ ] **空白日顯示日期數字 + 淡色「—」符號**（opacity 0.25）
- [ ] 8 個運動各有獨立辨識色（light/dark 兩主題下）
- [ ] 另外 7 種預留運動 fallback 到灰色（`--sport-other`）
- [ ] 點「+N」正確切回 timeline 並滾到該日
- [ ] 運動標籤篩選在月曆上有效
- [ ] 已結束活動 opacity 50%（月曆內）
- [ ] 今天日期有明顯視覺區分
- [ ] **置頂活動有發光邊框 + ✨ 星號動畫**
- [ ] **當日有置頂時，日期數字旁顯示 📌 icon**
- [ ] 置頂活動優先佔 3 個顯示 slot（若有 4+ 場）
- [ ] 月份範圍：過去 3 個月邊界顯示「無更早資料」、未來可無限滑
- [ ] `prefers-reduced-motion` 時置頂動畫停止

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
   - 未來 3 個月、過去 3 個月有無活動都能正確顯示（過去 3 個月為邊界）

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
