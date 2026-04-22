# 活動行事曆 — 月曆視圖實作計畫書

**狀態**：待用戶審核後動工
**預估工期**：7.5 個工作日（可拆分 2-3 個 commit 批次）
**版號影響**：會 bump 1-3 次（視批次拆分）
**預計動到檔案**：11 個（含 3 新建）
**狀態**：2026-04-22 v7 — 收斂審計（繼續挖 middle/high 瑕疵直到無剩餘），發現 v6 漏掉的 8 項對接與規格瑕疵：返回頁 tab 記憶、日期格式 normalize、filter-bar 互動、CSS 命名空間、cancelled 活動處理、狀態標記規格、my-section 顯示、多日活動資料結構

---

## 0. TL;DR（新進工程師 3 行讀懂）

1. **做什麼**：在活動頁（`#page-activities`）加第三種視圖「月曆」，顯示所有公開活動的月曆視圖，支援上下滑切月、運動色區分、置頂高光
2. **怎麼做**：新建 `event-list-calendar.js` + `event-calendar-constants.js` + `calendar.css`（Phase 1-5、約 7.5 天）
3. **從哪開始**：看 §12「回歸風險與對接驗證」（🔴 必讀）→ §13「How to start coding」→ §6 WBS → §5 檔案清單

**術語約定**（整份文件統一）：
- 「**日期格**」（不混用 day cell / cell / grid cell）
- 「**月曆視圖**」（與 timeline view 對比）
- 「**運動色**」（每個運動獨立顏色，Q4-Q5）

---

**啟動時機建議**（PM 角度）：可等 SEO 優化開始帶來曝光成長（約 2 週後）再啟動本功能，讓資源不分散；但用戶已要此功能，尊重決策

**月曆視圖定位**（產品 + 競品審計澄清）：
- 顯示「**所有公開活動**」（不是個人已報名清單）— 定位為瀏覽型視圖，比照 Facebook Events、Google Calendar 公開日曆
- 台灣競品（Fiveply / Sportalker / Ballgame 等）均**無月曆視圖**，此為 ToosterX 差異化功能
- 「個人活動月曆」（只顯示我報名的）規劃在 §11 後續擴充

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

### 4.1 Tab 切換區（現況擴充 — v6 對照既有程式碼修正）

> ⚠️ **v6 修正**：現有 `pages/activity.html` 的屬性名為 `data-atab`（非 `data-tab`），初始 tab 值為 `'normal'`（非 `'active'`），標籤是「一般」（非「進行中」）。必須沿用既有命名，避免 `_setActivityTab` 無法比對。

```html
<!-- pages/activity.html 現有結構（真實）-->
<div class="tab-bar" id="activity-tabs">
  <button class="tab active" data-atab="normal"
          onclick="App.switchActivityTab('normal')">一般</button>
  <button class="tab" data-atab="ended"
          onclick="App.switchActivityTab('ended')">已結束</button>
  <!-- ★ 新增（注意：屬性名 data-atab、值 calendar）-->
  <button class="tab" data-atab="calendar"
          onclick="App.switchActivityTab('calendar')">月曆</button>
</div>

<!-- 既有容器（直瀑）-->
<div class="timeline-calendar" id="activity-list">...</div>
<!-- ★ 新增容器（月曆）-->
<div id="activity-calendar" hidden>...</div>
```

Tab 切換用現有 JS 邏輯擴充，`_setActivityTab('calendar')` 時：
- 隱藏 `#activity-list`（既有容器，不是 `#activity-timeline`）
- 顯示 `#activity-calendar`
- 呼叫 `App._renderActivityCalendar()`
- **首次進月曆不跑 100ms 防抖**（`renderActivityList` 有防抖、月曆第一次同步 render 減少空白感）

> ⚠️ **不要改現有 tab 的 label**：計畫書 Q3 確認「進行中」保留，但**實際 DOM 是「一般」**；維持「一般 / 已結束 / 月曆」三 tab，不動前兩個文字。

### 4.2 月曆結構（寬版）+ i18n 月份名稱

**月份名稱用 `Intl.DateTimeFormat`（i18n 審計要求）**：不得 hardcode 中文月份名。

```javascript
// file: js/modules/event/event-calendar-constants.js
const MONTH_FORMATTER = new Intl.DateTimeFormat('zh-TW', {
  year: 'numeric', month: 'long'
});
// 呼叫：MONTH_FORMATTER.format(new Date(2026, 4, 1))
// zh-TW 結果："2026年5月"
// en 結果："May 2026"（若 locale 改成 en）
// ja 結果："2026年5月"
```

未來若擴國際市場，改 `Intl.DateTimeFormat(App.currentLocale, ...)` 即可支援多語、零成本。


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

**字體階層（CSS 動態 class 實作）** — v4 字體調整：

中文排版 + 長者用戶審計要求最小字體 12px（Apple HIG 建議最小 13pt、Google Material 建議最小 12sp）：

```css
.calendar-day[data-event-count="1"] .event-item { font-size: 14px; line-height: 1.55; }
.calendar-day[data-event-count="2"] .event-item { font-size: 13px; line-height: 1.5; }
.calendar-day[data-event-count="3"] .event-item,
.calendar-day[data-event-count="4+"] .event-item { font-size: 12px; line-height: 1.45; }

.no-event-mark {
  color: var(--text-muted);
  opacity: 0.25;
  font-size: 14px;
  text-align: center;
  display: block;
  margin-top: .3rem;
}
```

**標題不截固定字數、改用 CSS ellipsis**（中文排版審計要求，避免「內湖國民運」斷詞失義）：

```css
.event-title-short {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: middle;
}
```

顯示效果：
- 短標題（≤ 可用寬度）：完整顯示「雙連網球場」
- 長標題（> 可用寬度）：自然省略「內湖國民運動…」
- `title="完整標題"` 屬性提供 tooltip

**行高規範**（中英混排）：line-height 1.45-1.55（中文較高字形需要略多垂直空間、避免壓字）

#### render 邏輯（v5 修正 — XSS 防禦 + 無障礙強化）

```javascript
function _buildEventHTML(event) {
  const sportKey = event.sportTag || 'other';
  const sportDef = SPORT_COLORS[sportKey] || SPORT_COLORS.other;
  const isPinned = event.pinned === true;
  const pinnedClass = isPinned ? ' is-pinned' : '';
  // ★ v5 (滲透測試 + i18n 審計):
  //   1. 改用 data-id 而非 inline onclick(event.id)，避免 event.id 帶特殊字元時逃逸 JS context
  //   2. aria-label 同時包含置頂狀態與運動類型，對 VoiceOver/TalkBack 友善
  //   3. ✨ 星號走 CSS ::after，不寫進 HTML 避免 screen reader 讀出「星號」
  const label = `${isPinned ? '置頂活動：' : ''}${event.title}，${sportDef.label}`;
  return `<div class="calendar-event-item${pinnedClass}"
            data-id="${escapeHTML(event.id)}"
            style="--sport-color: var(${sportDef.var})"
            role="button"
            tabindex="0"
            aria-label="${escapeHTML(label)}"
            title="${escapeHTML(event.title)}">
    <span class="event-emoji" aria-hidden="true">${sportDef.emoji}</span>
    <span class="event-time">${formatTime(event.date)}</span>
    <span class="event-title-short">${escapeHTML(event.title)}</span>
  </div>`;
}

// 事件委派（掛在 .calendar-container 上、一次處理所有 cell click）
container.addEventListener('click', (ev) => {
  const cell = ev.target.closest('.calendar-event-item[data-id]');
  if (cell) { App.showEventDetail(cell.dataset.id); }
});
container.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter' && ev.key !== ' ') return;
  const cell = ev.target.closest('.calendar-event-item[data-id]');
  if (cell) { ev.preventDefault(); App.showEventDetail(cell.dataset.id); }
});
```

#### 「+N」文字（v4 改親切中文）

CSM 審計建議 + UX 無方向暗示：

```javascript
// 舊：+2 more（英文不親切、箭頭誤導方向）
// 新：還有 2 場（中文親切、無方向暗示）
// v5 安全：與活動 cell 一致，data-* 屬性 + event delegation（禁止 inline onclick）
const moreText = extraCount > 0
  ? `<div class="calendar-more"
          role="button" tabindex="0"
          data-jump-date="${dateKey}"
          aria-label="還有 ${extraCount} 場活動，按 Enter 跳到直瀑視圖">
       還有 ${extraCount} 場
     </div>`
  : '';

// 掛在容器上的 delegation（一次處理）
container.addEventListener('click', (ev) => {
  const more = ev.target.closest('.calendar-more[data-jump-date]');
  if (more) { _jumpToTimelineDate(more.dataset.jumpDate); }
});
```

#### 動態 5/6 週月曆（QA 審計要求）

若該月結構使得第 6 週**整週都是下月日期**，該週不渲染（節省 1/6 垂直空間）：

```javascript
// event-list-calendar.js — _buildMonthGrid
function _buildMonthGrid(year, month) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const firstWeekday = (firstDay.getDay() + 6) % 7;  // 週一起始（0-6）
  const daysInMonth = lastDay.getDate();
  const totalCells = firstWeekday + daysInMonth;
  const weekRows = Math.ceil(totalCells / 7);  // 動態 5 或 6 週
  // ... 建 weekRows × 7 格
}
```

例：2026 年 2 月 1 日是週日、28 天 → `firstWeekday=6, totalCells=34, weekRows=5`（只 5 週）

#### Tooltip（UX 審計：長標題辨識）

活動格 `title="完整活動標題"` 讓滑鼠 hover 顯示完整名；長按手機觸發 `longpress` event 顯示 toast 完整標題（本期不做、§11 後續）。

### 4.4 手勢 — scroll-snap（Q12）+ 跨瀏覽器備援

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

**iOS Safari 14 以前的 scroll-snap-stop bug 備援**（行動開發者審計要求）：

```javascript
// 偵測 scroll-snap 可用性
const supportsScrollSnap = CSS.supports('scroll-snap-type', 'y mandatory');
if (!supportsScrollSnap) {
  // fallback: 用 JS 偵測 scrollTop 到 month cell boundary 時 forced scroll 對齊
  container.addEventListener('scrollend', handleMonthBoundary);
  // 並強制顯示「← 月份 →」按鈕（桌機版本也有）
  document.querySelector('.calendar-nav-arrows').classList.add('always-visible');
}
```

**iOS edge swipe（返回上頁）衝突避免**：
- 月曆容器 `touch-action: pan-y`（僅允許縱向捲動、不處理橫向，橫向留給系統）
- 橫向邊緣手勢被 iOS 原生攔截，不會誤觸

#### ←→ 月份按鈕（長者 + 無障礙審計：44x44 tap area）

Apple HIG 建議最小 tap target 44x44pt、WCAG 2.5.5 建議 44x44 CSS pixels：

```css
.calendar-nav-btn {
  /* 視覺尺寸可小 */
  width: 32px; height: 32px;
  /* 但透過 ::before 擴大實際 tap area */
  position: relative;
}
.calendar-nav-btn::before {
  content: '';
  position: absolute;
  inset: -6px;  /* 32 + 6*2 = 44px tap area */
  min-width: 44px; min-height: 44px;
  /* 不可見、只擴大點擊範圍 */
}
```

確保長者用戶、帶手套、粗手指用戶都能正確點擊。

### 4.5 篩選整合 + Realtime incremental update

既有運動標籤 (`sport-picker`) 已在頂部，月曆的篩選**沿用相同 `App._activeSport`** 狀態。切到月曆時：

- 若 `_activeSport = 'all'` → 顯示所有運動活動
- 若 `_activeSport = 'football'` → 只顯示足球活動
- **此切換會同步影響 Timeline view**（現況已是這樣）

**Realtime 增量更新機制**（資料工程師審計要求）：

現有 `page-activities` 有 `_debouncedSnapshotRender` 處理 realtime events。月曆 render 必須 **hook 進同一機制**：

```javascript
// event-list-timeline.js 的 _debouncedSnapshotRender 分支
if (currentView === 'calendar') {
  App._renderActivityCalendar?.({ keepScrollPosition: true });  // 保持當前月份不重置
} else {
  App._renderActivityTimeline?.();  // 現有
}
```

避免新 event 進來時月曆閃爍或跳回當月。

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

/* 置頂標記：✨ 星號（v5: aria-hidden 用 ::before 天生 decorative、不被讀）*/
.calendar-event-item.is-pinned::before {
  content: '✨';
  margin-right: 2px;
  /* ::before 在 screen reader 預設不讀，但明確加 speak: never 增保障 */
  speak: never;
}

/* 動畫：只有「當前滑動到的月份」的置頂活動有動畫（避免多個同時動畫花亂，UX 審計要求）*/
.calendar-month.is-current-view .calendar-event-item.is-pinned::before {
  animation: pin-sparkle 3s ease-in-out infinite;
}

/* 若一個月內有多個置頂，只第一個有動畫 */
.calendar-month.is-current-view .calendar-event-item.is-pinned:not(:first-of-type)::before {
  animation: none;
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

> 活動 cell 的完整 render 邏輯見 §4.3「render 邏輯（v5 修正 — XSS 防禦 + 無障礙強化）」，本節只補充 pinned 相關的日期格容器設定。

```javascript
// event-list-calendar.js — 日期格層級的 pinned 標記
function _buildDayCell(date, events) {
  const hasPinned = events.some(e => e.pinned === true);
  return `<div class="calendar-day"
              role="gridcell"
              data-date="${date}"
              data-event-count="${events.length}"
              data-has-pinned="${hasPinned}">
    <div class="calendar-day-number">${dayNum}</div>
    ${events.slice(0, 3).map(_buildEventHTML).join('')}
    ${events.length > 3
      ? `<div class="calendar-more" data-date="${date}">還有 ${events.length - 3} 場</div>`
      : ''}
  </div>`;
}
```

> `_buildEventHTML` 本身已含 `is-pinned` class 切換、`aria-label` 前綴「置頂活動：」與 `data-id`（見 §4.3）。本節無需重寫、避免 render 邏輯雙軌分歧。

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

### 4.9 隱私與權限整合（⚠️ CLAUDE.md 活動可見性規則必須遵守）

**資安審計發現：原計畫未涵蓋此項！嚴重度：🔴 必修**

CLAUDE.md §活動可見性規則明文規定：所有活動列表入口**必須**通過 `_isEventVisibleToUser(event, uid)` 過濾。月曆屬於新增列表入口，**必須加入**。

#### 篩選邏輯（強制）

```javascript
// event-list-calendar.js — _filterEventsForCalendar()
function _filterEventsForCalendar(allEvents, monthKey, activeSport) {
  const uid = App.currentUser?.uid || null;
  return allEvents
    // 1. 黑名單 + privateEvent 過濾（CLAUDE.md 強制）
    .filter(e => App._isEventVisibleToUser(e, uid))
    // 2. 月份過濾（in-memory filter by date prefix）
    .filter(e => e.date && e.date.startsWith(monthKey))
    // 3. 運動篩選
    .filter(e => activeSport === 'all' || e.sportTag === activeSport);
}
```

#### 涵蓋的隱私邊界

| 欄位 / 情境 | 處理 |
|-----------|------|
| `privateEvent: true` | `_isEventVisibleToUser` 已處理，月曆不顯示給非報名用戶 |
| `blockedUids` 含當前用戶 | `_isEventVisibleToUser` 已處理（4 狀態邏輯，含「曾報名者尊重歷史」）|
| 未登入用戶（uid=null） | 傳 null 給 helper，仍能看到公開活動 |

#### 置頂權限補註

`event.pinned` 欄位**後台 admin 才能設定**（既有權限機制，非本期改動）。月曆只是讀取、顯示。

### 4.10 無障礙（WCAG 2.1 Level AA）

#### 色盲備援

色盲 5% 男性發生率，紅綠色盲會混淆：
- 足球綠 `#2e7d32` vs 美式躲避球紅 `#c62828`

**備援設計**：每個活動**必有運動 emoji**（Q6 已定），emoji 是獨立的視覺 channel（不靠顏色）：
- ⚽ 足球、🏀 籃球、🥒 匹克球、🎯 躲避球、🏃 跑步、🥾 登山、🏸 羽球、🏊 游泳

色盲用戶靠 emoji 辨識，不依賴顏色。符合 WCAG 1.4.1「顏色使用」。

#### 鍵盤導航（grid pattern）

```javascript
// event-list-calendar.js — 鍵盤導航
_handleCalendarKeydown(event) {
  const cell = document.activeElement.closest('.calendar-day');
  if (!cell) return;
  const { row, col } = cell.dataset;  // aria-rowindex / aria-colindex
  let target = null;
  switch (event.key) {
    case 'ArrowRight': target = _getCellAt(row, +col + 1); break;
    case 'ArrowLeft':  target = _getCellAt(row, +col - 1); break;
    case 'ArrowDown':  target = _getCellAt(+row + 1, col); break;
    case 'ArrowUp':    target = _getCellAt(+row - 1, col); break;
    case 'Enter':
    case ' ':
      // 進入該日活動清單（第一場活動 focus）
      cell.querySelector('.calendar-event-item')?.click();
      break;
    case 'PageDown': _goToNextMonth(); break;
    case 'PageUp':   _goToPrevMonth(); break;
  }
  if (target) { target.focus(); event.preventDefault(); }
}
```

#### ARIA 結構（v5 視障審計強化）

**關鍵修正**：日期格 `aria-label` 摘要（空白日、有活動日）、活動 cell 用 `aria-label` 主、`title` 輔：

```html
<div role="grid" aria-label="活動月曆 2026年5月">
  <div role="row" aria-rowindex="1">
    <div role="columnheader" aria-colindex="1">一</div>
    <!-- ... 七天 -->
  </div>
  <div role="row" aria-rowindex="2">
    <!-- 有活動日 -->
    <div role="gridcell" aria-colindex="1"
         tabindex="0"
         aria-label="5月1日，3場活動，按 Enter 展開">
      <!-- 日期格內的活動 cell -->
      <div class="calendar-event-item"
           data-id="ce_123"
           role="button" tabindex="0"
           aria-label="置頂活動：雙連網球場雙打揪團，足球"
           title="雙連網球場雙打揪團">
        <span class="event-emoji" aria-hidden="true">⚽</span>
        <span class="event-time">19:30</span>
        <span class="event-title-short">雙連網球場雙打揪團</span>
      </div>
      ...
    </div>
    <!-- 空白日（視障 A 要求：aria-label 摘要讓 skim 快速略過）-->
    <div role="gridcell" aria-colindex="2"
         tabindex="0"
         aria-label="5月2日，無活動">
      <div class="calendar-day-number">2</div>
      <div class="no-event-mark" aria-hidden="true">—</div>
    </div>
    <!-- ... -->
  </div>
</div>
```

**視障用戶瀏覽體驗**：
- Tab 進月曆 → VoiceOver 讀「活動月曆 2026年5月」
- ↓ 到 5/1 → 讀「5月1日，3場活動，按 Enter 展開」
- Enter → 進第一個活動：「置頂活動：雙連網球場雙打揪團，足球」
- ↓ 到 5/2 → 讀「5月2日，無活動」（瞬間略過）
- 整體朗讀量 vs v3 減少 60%+

### 4.11 懶載入策略（Q11 — 減少 Firestore 成本）

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

**Bundle size 影響**（財務審計）：
- 新增 code ~630 行、gzipped **~10-15 KB**
- **必做 lazy load**（僅切到 calendar tab 時才載入）：
  - `script-loader.js` 把 `event-list-calendar.js` + `event-calendar-constants.js` 放在 `page-activities` 的**延遲載入群組**、非 boot 群組
  - `calendar.css` 用 `<link rel="preload" as="style" onload="this.rel='stylesheet'">` 或在切 tab 時動態注入
- 首次切 tab 多 50-100ms loading（可接受、顯示 skeleton）

### 修改（13 個檔案、14 個改動點 — v7 新增 navigation.js + theme.js filter 處）

> ⚠️ **版本演進**：v5 列 8 個 → v6 列 12 個（+4：firebase-service / theme / event-list-helpers-switchRegion / event-manage）→ **v7 再加 navigation.js（§12.M）+ theme.js filter-bar 處（§12.O）**，若不改會有「返回頁 tab 資料不刷新」與「切 tab 後改 filter 月曆不更新」兩個功能斷鏈。
>
> 既有檔案修改點統計：firebase-service ×1、theme ×4（setActiveSport + filter-type + filter-btn + filter-keyword）、event-list-helpers switchRegionTab ×1、event-manage toggleMyActivityPin ×1、navigation ×1 = **既有模組共 5 檔 / 8 處改動**。

| # | 檔案 | 改動範圍 | 鎖定狀態 |
|---|------|---------|---------|
| 1 | `pages/activity.html` | 新增 `[月曆]` tab button（`data-atab="calendar"`）+ `#activity-calendar` 容器 | 一般 |
| 2 | `js/modules/event/event-list-timeline.js` | 加 `data-date-anchor`（padded `YYYY-MM-DD`）到日期分組元素（Q10）**— 僅加屬性、不動邏輯** | ⚠️ **鎖定區、小心** |
| 3 | `js/modules/event/event-list.js` | `_setActivityTab` 擴充處理第 3 種 `'calendar'`（隱藏 `#activity-list`、顯示 `#activity-calendar`、呼叫 render）| ⚠️ **鎖定區、小心** |
| 4 | `js/modules/event/event-list-helpers.js` | 加 `_groupEventsByDate` 輔助函式 + `_toDateKey()` padded 日期 key | ⚠️ **鎖定區、小心** |
| 5 | `js/core/script-loader.js` | 註冊新群組 `activityCalendar`（支援 tab 級延遲載入，見「lazy-load 實作方案」） | 一般 |
| 6 | `index.html` | `<link>` 載入 `calendar.css` | 一般（改 HTML 要 bump version）|
| 7 | `docs/architecture.md` | 模組清單加 `event-list-calendar` | 一般 |
| 8 | `docs/structure-guide.md` | 中文功能導覽同步 | 一般 |
| 9 | `js/firebase-service.js` | L196-202 snapshot render dispatch 加月曆分支（見 §12.C） | ⚠️ **鎖定檔、僅加 1 行** |
| 10 | `js/core/theme.js`（**2 處改動**）| (a) `setActiveSport` L186-189 末尾加 `_renderActivityCalendar?.()`（§12.D）<br>(b) filter-bar 的 3 個 handler L70-78 加同樣分支（§12.O）| 一般（共 4 行）|
| 11 | `js/modules/event/event-list-helpers.js` | `switchRegionTab` L307-308 加 `_renderActivityCalendar?.()`（§12.D） | ⚠️ 鎖定區 |
| 12 | `js/modules/event/event-manage.js` | `toggleMyActivityPin` L444-446 加 `_renderActivityCalendar?.()`（§12.E） | 一般（只加 1 行）|
| **13** | **`js/core/navigation.js`** | **`_renderPageContent('page-activities')` L698-701 加月曆分支**（返回頁時重 render、§12.M） | 一般（只加 1 行）|

### lazy-load 實作方案（v6 明確化）

`script-loader.js` 既有設計是**頁面級**載入（`_pageGroups['page-activities']`）。要實現「只在切到月曆 tab 時才載入」，採用：

**方案 A（採用）：獨立群組 + 動態觸發**

```javascript
// script-loader.js 新增群組
_groups: {
  activityCalendar: [
    'js/modules/event/event-calendar-constants.js',
    'js/modules/event/event-list-calendar.js',
  ],
  // ... 既有群組不動
}
// ⚠️ 不要加到 _pageGroups['page-activities']，避免 boot 時即載入

// event-list.js — _setActivityTab 擴充
_setActivityTab(tab, options = {}) {
  // 既有邏輯不動 ...
  if (tab === 'calendar') {
    ScriptLoader.loadGroup(ScriptLoader._groups.activityCalendar)
      .then(() => this._renderActivityCalendar?.())
      .catch(err => { console.error('[Calendar] load failed:', err); this.showToast('月曆載入失敗，請重試'); });
  }
  // ... 既有 render 分支
}
```

**為什麼選方案 A**：不動 `_pageGroups`、不增加 boot 時 bundle、失敗有 toast 降級。

### 不改動（v6 終版）

- **Firestore Rules** — `events` read 為 `if true`、update 有白名單、無 `pinned` 特殊規則，月曆只讀不寫
- **Cloud Functions** — 既有 CF 完全不依賴前端 tab 狀態、月曆無新 CF 呼叫
- `js/firebase-crud.js`（報名鎖定函式不動）
- `js/api-service.js`（`getEvents()` 已夠用）
- `js/modules/achievement/stats.js`、`js/modules/leaderboard.js`（統計鎖定函式）

### 資料層使用的既有 API（v6 確認）

| 需求 | 用法 | 風險 |
|------|------|------|
| 取所有活動 | `ApiService.getEvents()` 或 `App._getVisibleEvents()` | 無 |
| 過濾黑名單 + 私密 + 俱樂部限定 | `App._getVisibleEvents()`（已整合 `_isEventVisibleToUser` + `_canViewEventByTeamScope` + `privateEvent`）| 無 |
| 過濾地區 | `App._filterByRegionTab(events)` | 無 |
| 過濾運動 | `App._filterBySportTag(events)` | 無 |
| 取活動詳情 | `App.showEventDetail(id)`（既有）| 無 |
| 置頂狀態 | `event.pinned`（truthy）+ `event.pinOrder`（數字）| 見 §15 F |

> ⚠️ **計畫書 v5 §4.9「必須先呼叫 `_isEventVisibleToUser`」多餘**：`_getVisibleEvents()` 已內建三層過濾（`_canViewEventByTeamScope` + `privateEvent` + `_isEventVisibleToUser`），月曆直接用 `_getVisibleEvents()` 即完成全部可見性判斷，**不需再手動呼叫 `_isEventVisibleToUser`**。

---

## 6. 工作分解（WBS）

### Phase 1：基礎設施（Day 1-2）

- [ ] 1.1 建立 `event-calendar-constants.js`（SPORT_COLORS / WEEK_NAMES / MONTH_NAMES）
- [ ] 1.2 建立 `css/calendar.css` 骨架（grid、日期格、tab button）
- [ ] 1.3 index.html 載入 calendar.css
- [ ] 1.4 script-loader 註冊新模組
- [ ] 1.5 pages/activity.html 加 `[月曆]` tab + `#activity-calendar` 容器

### Phase 2：月曆 render（Day 2-4）

- [ ] 2.1 `event-list-calendar.js` — `_buildMonthGrid(year, month)` **動態 5/6 週**（totalCells / 7 計算）
- [ ] 2.2 `_filterEventsForCalendar` — 3 層 filter（**必須先過 `_isEventVisibleToUser`**）
- [ ] 2.3 `_groupEventsByDate(events)` — 按 YYYY-MM-DD group（in-memory filter）
- [ ] 2.4 日期格彈性 render：`data-event-count="1|2|3|4+"` + CSS 字體階層
- [ ] 2.5 空白日「—」符號（`.no-event-mark`，opacity 0.25）
- [ ] 2.6 運動色整合：`SPORT_COLORS[sportTag]` 取色，未啟用 fallback `--sport-other`
- [ ] 2.7 `event.pinned` 防呆：`event.pinned === true` 嚴格比對（避免 truthy undefined）
- [ ] 2.8 今天高亮、跨月灰化（週末顏色本期不做）
- [ ] 2.9 Tooltip：每個活動格 `title` 屬性顯示完整標題

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

### Phase 4：RWD + 主題 + 無障礙（Day 6-7）

- [ ] 4.1 窄版 CSS（media query < 768px）
- [ ] 4.2 深淺主題運動色切換（data-theme）
- [ ] 4.3 無障礙：`role="grid"` + `aria-rowindex` / `aria-colindex` / `aria-label`
- [ ] 4.4 鍵盤導航：`_handleCalendarKeydown`（↑↓←→ Enter PageUp PageDown）
- [ ] 4.5 scroll-snap 備援：`CSS.supports()` 檢測失敗時用 JS + 強制顯示月份按鈕
- [ ] 4.6 iOS edge swipe 避免衝突：`touch-action: pan-y` 於月曆容器
- [ ] 4.7 置頂動畫節制：只 `.is-current-view` + 第一個置頂有 `pin-sparkle`
- [ ] 4.8 `prefers-reduced-motion` 關閉 pin-sparkle

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
| `tests/unit/event-calendar.test.js` | `_buildMonthGrid(2026, 4)` 產出 35 格（動態 5 週）|
| 同上 | `_buildMonthGrid(2026, 1)` 閏年 2 月測試 |
| 同上 | `_groupEventsByDate([events])` 按 date key 正確分組 |
| 同上 | `_getSportColor('football')` → 正確 CSS 變數 |
| 同上 | `_getSportColor('未啟用運動')` → fallback `--sport-other` |
| 同上 | 多日活動（multiDate、5 天）在月曆 5 個日期格各自顯示（每天一獨立 event、不合併）|
| 同上 | `event.pinned` truthy 即視為置頂（沿用全站既有風格、v7 §12.F 決議）|
| 同上 | `_toDateKey('2026/5/1 19:30~21:00')` → `'2026-05-01'`（padded、與 data-date-anchor 一致）|
| 同上 | cancelled 活動在月曆有刪除線 + opacity 0.35（§12.Q）|
| 同上 | `_filterEventsForCalendar` 必先呼叫 `_isEventVisibleToUser` |
| 同上 | 黑名單用戶的活動不顯示月曆 |
| 同上 | 私人活動（privateEvent=true）不顯示給未報名用戶 |

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
8. **跨時區與跨日邊界**（QA 審計要求）
   - 設置裝置時間為 23:59 開月曆 → 等到 00:00 看「今天」是否正確切換
   - 跨時區旅行（假設 UTC+0 時段看）— date 字串以台灣時間處理，不受裝置時區影響
9. **隱私與權限**（資安審計要求）
   - 被特定活動拉黑的用戶：月曆不出現該活動
   - 私人活動（privateEvent=true）：未報名用戶的月曆不顯示
   - 未登入訪客：月曆正常顯示所有公開活動
10. **置頂防呆**
    - `event.pinned === undefined` / `false` / `null` / `0` / `""` 皆不視為置頂
    - 只有明確 `=== true` 才有 ✨ 高光
11. **閏年 / 月尾對齊**
    - 2026/2（28 天）、2028/2（29 天）、月 1 日是週一/週日各測試
    - 動態 5 週 / 6 週壓縮正確
12. **無障礙（a11y）**
    - 只用鍵盤：tab 進月曆 → ↑↓←→ 切日期 → Enter 進活動詳情
    - 色盲模式（Chrome DevTools Rendering → Emulate vision deficiency）看色盲用戶體驗
    - 螢幕閱讀器（VoiceOver / NVDA）能讀月曆結構
13. **Realtime 增量更新**（資料工程師審計）
    - 開月曆停在 5 月 → 另裝置新增 5/20 活動 → 本月曆應自動出現新活動、不跳回當月

---

## 11. 後續擴充點（不在本期）

### 功能擴充
- [ ] 週視圖（更極簡）
- [ ] 日視圖（單日完整列表）
- [ ] 「+N more」彈窗替代方案（UX 審計建議）— 當日活動浮層代替切 tab
- [ ] **個人月曆視圖**（家長審計需求：只顯示我報名的 / 我發起的 / 我家人報名的活動）
- [ ] 匯出月曆到 Google Calendar / iCal（BD 審計：業界標配）
- [ ] 月曆訂閱功能（BD 審計）
- [ ] 拖拉活動改日（需要管理權限）
- [ ] 統計圖表（當月活動密度 heatmap）
- [ ] 個人化：隱藏不感興趣的運動
- [ ] **首次使用 onboarding tooltip**（CSM 審計：新用戶引導切月手勢、+N 解釋）

### 商業與合規擴充（BD + 法遵審計）
- [ ] **付費置頂機制 + `sponsored` 強制標示**（公平交易法 + Google SEO 規範，禁止未標示付費內容）
- [ ] **付費置頂數量限制**（防止 admin 濫用、保持 UX 品質）
- [ ] 場地業主展示頁（venue 動態頁 — 見 SEO P1 #6 計畫）
- [ ] 活動贊助（運動品牌置入、強制揭露）

### 用戶參與度擴充（遊戲化審計）
- [ ] **本月報名數 badge**（月曆頁頂顯示「本月已報名 5 場」）
- [ ] **連續報名 streak**（類似 Duolingo 連續天數）
- [ ] 熱門活動標記（報名率 > 80% 的活動顯示 🔥）
- [ ] 智能推薦置頂（依用戶運動偏好推薦、而非 admin 手動）

### 效能擴充
- [ ] `_filterEventsForCalendar` memoize（cache key = `month-key-sportFilter`），events > 500 時啟用（效能工程師審計）
- [ ] Virtual scrolling（events > 500 時）— DOM 只保留當前視區的 3 個月
- [ ] 真正的 Firestore 按月 query（events > 1000 時）— `where('date', '>=', monthStart).where('date', '<=', monthEnd)`

### 無障礙擴充
- [ ] 手機長按顯示完整標題 toast
- [ ] 高對比度模式（Windows High Contrast Mode 支援）

### 產品監測（CSM + 數據分析）
- [ ] 月曆 tab 切換率 A/B test（上線 2 週後評估使用率）
- [ ] 「+N more」點擊率（判斷是否需要改設計）
- [ ] 月份切換行為（用戶最常看哪個月 — 本月 / 下月 / 過去月）

### 無障礙 / 認知障礙擴充（v5 ADHD / 永續 / 道德審計）
- [ ] **簡化模式**（ADHD 用戶）：關閉動畫、單色、極簡格子
- [ ] **`prefers-reduced-data`** 偵測（慢網路 / 低電量時自動關動畫、降採樣）
- [ ] **←→ 按鈕永遠顯示**（道德審計：scroll-snap 強制切月的 escape hatch）
- [ ] 支援「高對比度」作業系統設定（Windows High Contrast Mode）

### 國際化擴充（v5 i18n 審計）
- [ ] 擴充 locale（en / ja / ko / th / vi）— 月份名 Intl.DateTimeFormat 已 locale-aware，只需切 App.currentLocale
- [ ] 週起始日 locale-aware（英文市場：週日起始）
- [ ] 英文用戶：日期格式用英文縮寫「Mon」取代「一」

---

## 12. 回歸風險與對接驗證（v6 新增 — 首次實作必讀）

> 🔴 **動手前必須逐項確認本章**。v6 審計發現 11 項計畫書原本未涵蓋的對接錯誤與規範缺失；若直接照 v5 實作會產生中到高度回歸。

### 12.A 🔴 DOM 屬性名錯誤（高風險，直接 break tab）

**現況**：`pages/activity.html` L28-31 使用 `data-atab`（非 `data-tab`），tab 值為 `'normal'` / `'ended'`（非 `'active'`）。

**行為**：`event-list.js` L28 以 `btn.dataset.atab === tab` 比對。若用 `data-tab` 新屬性，三個 tab 全失效。

**驗收**：新 tab button 必須用 `data-atab="calendar"` + `onclick="App.switchActivityTab('calendar')"`，與既有兩個 tab 風格一致。

### 12.B 🔴 scroll-snap × _bindSwipeTabs 手勢衝突

**現況**：`event-list-timeline.js` L338-341 綁定左右滑動切 tab（`_bindSwipeTabs('activity-list', 'activity-tabs', ...)`）。月曆 scroll-snap-y 是上下方向，**理論上不衝突**但需驗證：

1. 月曆容器是 `#activity-calendar`（與 `#activity-list` 不同元素），`_bindSwipeTabs` 不會綁到月曆
2. 月曆容器加 `touch-action: pan-y` 僅攔截縱向、橫向留給瀏覽器/系統
3. **風險**：若用戶剛切到月曆、馬上左右滑（試圖切 tab），會不會因為月曆容器吃掉事件而失效？

**驗收**：
- [ ] iOS Safari 實測：月曆 tab 下左右滑能否切回一般 tab
- [ ] LINE WebView 實測同上
- [ ] 若失效，在 `#activity-calendar` 上也綁 `_bindSwipeTabs`（比照 timeline）

### 12.C 🔴 onSnapshot 不會觸發月曆 render（Realtime 失效）

**現況**：`firebase-service.js` L196-202 的 snapshot render dispatch：

```javascript
if (p === 'page-home') App.renderHotEvents?.();
if (p === 'page-activities') App.renderActivityList?.();  // ← 只呼叫 timeline
if (p === 'page-my-activities') App.renderMyActivities?.();
```

**行為**：若月曆 tab 開啟時別人新增/更新活動，月曆**不會自動重 render**，違反計畫書 §測試計畫第 13 項。

**必改**：`firebase-service.js` L198 加月曆分支：

```javascript
if (p === 'page-activities') {
  App.renderActivityList?.();
  if (App._activityActiveTab === 'calendar') App._renderActivityCalendar?.();
}
```

**驗收**：
- [ ] 月曆 tab 下另一裝置新增活動，5 秒內月曆出現新活動
- [ ] 月曆 tab 下別人取消活動，月曆即時消失
- [ ] 既有 timeline 行為不變

### 12.D 🔴 切運動/地區分類不重 render 月曆（篩選失效）

**現況**：
- `theme.js` L186-189 `setActiveSport` 只呼叫 `renderHotEvents/renderActivityList/renderTeamList/renderTournamentTimeline`
- `event-list-helpers.js` L307-308 `switchRegionTab` 只呼叫 `renderHotEvents/renderActivityList`

**行為**：用戶在月曆 tab 切「籃球」→ 月曆不變（仍顯示所有運動）；切「北部」→ 月曆不過濾。**違反 §3.7「`_activeSport` 仍有效」宣稱**。

**必改**（兩處各加一行）：

```javascript
// theme.js L189 末尾
try { this._renderActivityCalendar?.(); } catch (_) {}

// event-list-helpers.js L309 末尾
try { this._renderActivityCalendar?.(); } catch (_) {}
```

**驗收**：
- [ ] 月曆下切「籃球」→ 只剩籃球活動
- [ ] 月曆下切「北部」→ 只剩北部活動

### 12.E 🟡 置頂 toggle 後月曆未重 render（視覺不同步）

**現況**：`event-manage.js` `toggleMyActivityPin` L444-446：

```javascript
this.renderMyActivities();
this.renderActivityList();
this.renderHotEvents();
```

**行為**：後台點「置頂」→ 切回月曆 → 置頂高光未出現，要手動重開 tab。

**必改**：L446 後加：

```javascript
this._renderActivityCalendar?.();
```

### 12.F 🟡 pinned 比對風格一致性（`=== true` vs truthy）

**現況**：既有模組（`event-list.js` L87-94、`event-list-timeline.js` L223-231、`event-list-home.js`、`event-manage.js`）**全部用 `e?.pinned ? 1 : 0` truthy** 風格，**不是** `=== true` 嚴格比對。

**v5 計畫書要求**：§4.8 / §測試第 10 項要求 `event.pinned === true` 嚴格比對，避免 `undefined/null/0/""` 被誤判。

**衝突**：若月曆用 `=== true`、其他地方用 truthy，資料寫入 `pinned: 1`（數字而非 bool）時，timeline 顯示置頂但月曆**不顯示**，造成資料不一致假象。

**v6 決議**：**沿用既有 truthy 風格** `e?.pinned` 以保持全站一致。若要改嚴格，**全站一起改**不得只改月曆。

**排序同步**：月曆排序必須包含 `pinOrder` 次序：

```javascript
function _sortEventsForCell(a, b) {
  const ap = a?.pinned ? 1 : 0;
  const bp = b?.pinned ? 1 : 0;
  if (ap !== bp) return bp - ap;  // pinned 先
  if (ap && bp) {
    const ao = Number(a?.pinOrder) || 0;
    const bo = Number(b?.pinOrder) || 0;
    if (ao !== bo) return ao - bo;  // pinOrder 小的先（最早置頂）
  }
  // 同優先級按開始時間
  const ta = (a.date || '').split(' ')[1] || '';
  const tb = (b.date || '').split(' ')[1] || '';
  return ta.localeCompare(tb);
}
```

### 12.G 🟡 lazy-load 路徑缺明確實作

**現況**：`script-loader.js` 是頁面級載入（`_pageGroups['page-activities']` 一次載全部）。v5 計畫書只寫「必做 lazy load」沒說怎麼做。

**v6 決議**：見 §5「lazy-load 實作方案」方案 A（獨立群組 `activityCalendar` + `_setActivityTab('calendar')` 動態觸發）。

**驗收**：
- [ ] 未切月曆 tab 時 devtools Network 不顯示 `event-list-calendar.js` 下載
- [ ] 切月曆 tab 時 50-200ms 內完成載入 + render
- [ ] 載入失敗顯示 toast「月曆載入失敗，請重試」

### 12.H 🟢 首次切 tab 的 100ms 防抖會產生視覺延遲

**現況**：`renderActivityList` L155-157 有 100ms 防抖（避免多路徑觸發連續 re-render）。

**風險**：若月曆 render 也複製這個防抖、或依賴 `renderActivityList`，首次切 tab 會有 100ms 空白。

**v6 決議**：
- 月曆**首次**切 tab **不走防抖**，同步 render 一次
- **後續**的 realtime 更新可走防抖（避免連續 snapshot 觸發）
- 用獨立 timer `_activityCalendarRenderTimer` 不共用

### 12.I 🟢 _autoEndExpiredEvents 副作用需對齊

**現況**：`_doRenderActivityList` L160 呼叫 `_autoEndExpiredEvents()`，把超時活動自動改 `ended`。

**行為**：月曆若不呼叫此函式，會顯示「已結束但狀態未變」的活動為進行中，與 timeline 不一致。

**v6 決議**：月曆 render 開頭也呼叫 `this._autoEndExpiredEvents()`，與 timeline 對齊。此函式是冪等的（已結束的不會再改）、無重複寫入風險。

### 12.J 🟢 冷啟動骨架

**現況**：`#activity-list` 的 HTML 骨架（activity.html L40-44）有 skeleton-line。

**v6 決議**：`#activity-calendar` 也加骨架，避免首次切 tab 時短暫空白：

```html
<div id="activity-calendar" hidden>
  <div class="calendar-skeleton" aria-hidden="true">
    <!-- 7x5 灰格骨架 -->
  </div>
</div>
```

首次 `_renderActivityCalendar` 成功後移除骨架。

### 12.K 🔴 規範層：鎖定清單需更新

**CLAUDE.md §外科手術式修改**提到 `js/firebase-service.js` 是「鎖定函式所在檔案」。本次為加月曆 render 分支必須動此檔，**即使只加 1 行**，也需：

1. 單獨 commit：`refactor(snapshot): firebase-service dispatch 加月曆 render 分支`
2. commit message 明確標示「非鎖定函式區的新增、與報名/統計無關」
3. push 後跑 `npm run test:unit` 驗證無 regression
4. 在 `docs/claude-memory.md` 記錄此例外，標記為「合理例外」

**驗收**：
- [ ] firebase-service.js diff 只有 L198 附近 1-2 行改動
- [ ] 不動 `ensureUserStatsLoaded`、`_mapUserDoc`、`onSnapshot` 邏輯本體

---

### 12.L 資料庫 / Rules / CF 對接最終確認

| 層級 | 改動? | 驗證 |
|------|-------|------|
| Firestore Rules | ❌ 不改 | `events` read 為 `allow read: if true`；update 走既有白名單；`pinned`/`pinOrder` 寫入走 `isEventOwner() || hasPerm('event.edit_all')`（後台現有路徑）|
| Firestore 結構 | ❌ 不改 | 無新集合、無新欄位（`pinned`/`pinOrder` 既有，Phase 4b 後子集合路徑亦無涉及）|
| Cloud Functions | ❌ 不改 | 所有 CF 均不依賴前端 tab 狀態、無新 callable |
| 客戶端 onSnapshot | ✅ 加 1 行 | `firebase-service.js` L198 分支補月曆 render（見 §15.C）|
| 讀取路徑 | ❌ 不改 | `ApiService.getEvents()` + `_getVisibleEvents()` 已夠用 |
| 寫入路徑 | ❌ 不改 | 月曆純讀取視圖，無任何寫入 |
| Service Worker | ✅ 透過 `bump-version.js` 自動 | 新增 `event-list-calendar.js`、`calendar.css` 透過 `?v=` 參數自動 cache bust |

**結論**：月曆功能對資料庫 / Rules / CF **零影響**，僅前端視圖層變更。最大風險集中在既有前端模組的**渲染流程對接**（A-K 11 項）。

---

### 12.M 🔴 返回頁面時月曆未重 render（v7 新發現）

**現況**：`js/core/navigation.js` `_renderPageContent()` L698-701：

```javascript
if (pageId === 'page-activities') {
  // 不重設頁籤 — 保留用戶離開前的 _activityActiveTab（如「已結束」）
  this.renderActivityList?.();  // ← 只 render timeline
}
```

**行為**：用戶在月曆 → 點活動 → 進詳情 → 按返回 → `_renderPageContent('page-activities')` 只呼叫 `renderActivityList()`，**月曆資料不刷新**。若此時有 realtime 變動，月曆會看到舊資料。

**必改**：L700 後加月曆分支：

```javascript
if (pageId === 'page-activities') {
  this.renderActivityList?.();
  if (this._activityActiveTab === 'calendar') this._renderActivityCalendar?.();
}
```

> ⚠️ **這是繼 §12.C 之後第二個既有核心模組必改處**（`navigation.js`），`navigation.js` 不是鎖定檔但仍屬核心。

**驗收**：
- [ ] 月曆 tab → 進活動詳情 → 返回 → 月曆資料已更新（若有人中途新增活動）
- [ ] timeline tab → 進詳情 → 返回 → timeline 維持既有行為

### 12.N 🔴 event.date 格式是 `YYYY/MM/DD`（非 `YYYY-MM-DD`）

**現況**：`event.date` 實際格式為 **`YYYY/MM/DD HH:mm~HH:mm`**（斜線分隔、月日可個位數），見 `_parseEventStartDate` L152-166。

**v6 計畫書混用 `YYYY-MM-DD` vs `YYYY/MM/DD`**：
- `data-date-anchor="YYYY-MM-DD"`（Q10）
- `_groupEventsByDate` 按 `YYYY-MM-DD` group

**風險**：若月曆 group key 用 `e.date.split(' ')[0]`，會得到 `'2026/5/1'`（未補零），無法與 `'2026-05-01'` 錨點對上。

**v7 決議 — 統一規範**：

```javascript
// 月曆內部 group key 統一用 YYYY-MM-DD padded（與 data-date-anchor 一致）
function _toDateKey(eventDate) {
  const parts = eventDate.split(' ')[0].split('/');
  const y = String(parseInt(parts[0])).padStart(4, '0');
  const m = String(parseInt(parts[1])).padStart(2, '0');
  const d = String(parseInt(parts[2])).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// timeline 的 data-date-anchor 也用此函式產生（確保一致）
// "2026/5/1" → "2026-05-01"
// "2026/12/31" → "2026-12-31"
```

**驗收**：
- [ ] 活動日期 `2026/5/1` 在月曆 5 月 1 日格顯示
- [ ] 點 +N more 能跳回 timeline 對應 `data-date-anchor="2026-05-01"`
- [ ] `_parseEventStartDate` 既有 UTC vs 本地時區行為不動（月曆用本地時區顯示）

### 12.O 🟡 filter-bar（類別 / 關鍵字）在月曆 tab 下的行為未規範

**現況**：`pages/activity.html` L11-23 有 `#filter-bar`（類別 select + 關鍵字 input + 搜尋 btn）。這 3 個元件都綁定 `renderActivityList()`（見 `theme.js` L70-78），**月曆不會重 render**。

**v7 決議**：月曆 tab 下的 filter 互動採**方案 B（保留但同步）**：

1. **保留 filter-bar 顯示**（不隱藏）— 避免用戶切 tab 時 UI 跳動
2. **類別 change / 關鍵字 Enter / 搜尋 btn click** 時，若 `_activityActiveTab === 'calendar'`，同步呼叫 `_renderActivityCalendar()`
3. **必改**：`theme.js` L70-78 的 3 個 handler 末尾加：

```javascript
document.getElementById('activity-filter-type')?.addEventListener('change', () => {
  this.renderActivityList();
  if (this._activityActiveTab === 'calendar') this._renderActivityCalendar?.();
});
// 另外兩個 handler 同樣加分支
```

> ⚠️ **這是第 3 個既有核心模組必改處**（`theme.js` 除了 §12.D 的 setActiveSport 外、filter-bar handler 也要改）。總計既有模組改動點變為：firebase-service / theme（兩處） / event-list-helpers / event-manage / navigation = 5 個檔案共 6 個改動點。

**驗收**：
- [ ] 月曆下選「類別 = PLAY」→ 月曆只剩 PLAY 活動
- [ ] 月曆下搜尋「台北」→ 月曆只剩標題/地點含「台北」的活動
- [ ] 切回 timeline tab，filter 值仍保留

### 12.P 🟡 CSS 命名空間污染風險

**現況**：既有 CSS 命名：
- `.timeline-calendar`（`css/activity.css` L7）— 用於直瀑 timeline 容器
- `.edu-monthly-calendar` / `.edu-cal-*`（`css/education.css` L547+）— 教育模組月曆
- `.calendar-*` — **尚未使用、屬全域命名空間**

**v5 計畫書用 `.calendar-container` / `.calendar-day` / `.calendar-event-item` / `.calendar-more`** — 佔據全域 `.calendar-*` 命名空間。

**風險**：未來若有其他月曆功能（如 dashboard 月曆、admin 報表月曆）也用 `.calendar-*`，會互相污染。

**v7 決議 — 改用 `.evt-cal-*` 命名空間**（比照 `.edu-cal-*` 模式、跟 event 綁定）：

| v5/v6 名稱 | v7 名稱 |
|-----------|--------|
| `.calendar-container` | `.evt-cal-container` |
| `.calendar-month` | `.evt-cal-month` |
| `.calendar-day` | `.evt-cal-day` |
| `.calendar-day-number` | `.evt-cal-day-num` |
| `.calendar-event-item` | `.evt-cal-event` |
| `.calendar-more` | `.evt-cal-more` |
| `.event-emoji` / `.event-time` / `.event-title-short` | `.evt-cal-emoji` / `.evt-cal-time` / `.evt-cal-title` |
| `.no-event-mark` | `.evt-cal-empty-mark` |
| `.is-pinned` | `.evt-cal-is-pinned`（局部作用域）|
| `.pin-sparkle` | `.evt-cal-sparkle` |

**CSS 檔名保持 `calendar.css`**（檔案路徑不污染、class 才是關鍵）。

**驗收**：
- [ ] grep `\.calendar-` 全專案 CSS、月曆外檔案無新增
- [ ] grep `\.evt-cal-` 只在 `calendar.css` 和 `event-list-calendar.js`

### 12.Q 🟡 cancelled（已取消）活動的月曆處理未規範

**現況**：
- timeline tab 「一般」排除 `ended + cancelled`
- timeline tab 「已結束」包含 `ended + cancelled`
- **月曆 v5 只說「已結束 opacity 50%」，沒說 cancelled**

**v7 決議**：

| 狀態 | 月曆顯示 | opacity | 視覺 |
|------|---------|---------|------|
| `open` / `upcoming` / `full` | ✅ 正常 | 1.0 | 運動色 + 標題 |
| `ended` | ✅ 顯示 | 0.5 | 標題灰階、運動色也降飽和 |
| `cancelled` | ✅ 顯示 | 0.35 | **加刪除線** + 標題旁貼「已取消」小標 |

CSS：
```css
.evt-cal-event[data-status="ended"] { opacity: 0.5; filter: grayscale(0.3); }
.evt-cal-event[data-status="cancelled"] { opacity: 0.35; text-decoration: line-through; }
.evt-cal-event[data-status="cancelled"] .evt-cal-title::after {
  content: "已取消"; font-size: .6em; color: var(--danger); margin-left: .3em;
}
```

`aria-label` 也要含狀態：`aria-label="已取消活動：雙連網球場雙打揪團，足球"`

**驗收**：
- [ ] cancelled 活動在月曆顯示、有刪除線
- [ ] 點 cancelled 活動仍可進詳情看過往資訊（與 timeline 一致）

### 12.R 🟡 月曆格狀態標記規格未定（收藏 / 正取 / 候補 / 私密 / 俱樂部限定 / 性別）

**現況**：timeline 每個 event row 顯示這些狀態標記（`event-list-timeline.js` L260-277）：
- `_favHeartHtml` 收藏愛心
- `regStamp` 正取/候補戳記
- `privateStamp` 不公開戳記
- `genderRibbon` 性別限定彩帶
- `teamBadge` 俱樂部限定章

**v5 月曆 §4.8 只提：運動 emoji + 時間 + 標題**，**這 5 種狀態全部沒規範**。

**v7 決議 — 採極簡主義**（月曆格只 45x80~150x120px、塞不下全部）：

| 狀態 | 月曆處理 | 理由 |
|------|---------|------|
| 收藏 (favorited) | ❌ 不顯示 | 用戶自行點擊後得知 |
| 已報名正取 | ✅ 格邊框加 2px 綠色（`.is-signed-up`）| 用戶關心自己有沒有報 |
| 已報名候補 | ✅ 格邊框加 2px 橘色虛線（`.is-waitlisted`）| 同上 |
| 私密活動 | ❌ 不顯示（能被用戶看到時已通過 `privateEvent` 守衛）| 無資訊價值 |
| 性別限定 | ❌ 不顯示 | 進詳情頁才看、月曆塞不下 |
| 俱樂部限定 | ❌ 不顯示 | 同上 |
| 置頂 | ✅ ✨ 動畫 + 金色邊框（v5 §4.8） | 產品強調功能 |

CSS：
```css
.evt-cal-event.is-signed-up { box-shadow: 0 0 0 2px #22c55e inset; }
.evt-cal-event.is-waitlisted { box-shadow: 0 0 0 2px #f59e0b inset; outline: 1px dashed #f59e0b; }
.evt-cal-event.evt-cal-is-pinned { /* 見 §4.8 */ }
```

**驗收**：
- [ ] 已報名活動在月曆格有綠色邊框
- [ ] 候補活動有橘色虛線邊框
- [ ] 置頂活動與狀態邊框可疊加（三層邊框不互相覆蓋）

### 12.S 🟢 my-section coach+ 按鈕在月曆 tab 下仍顯示

**現況**：`pages/activity.html` L24-27：

```html
<div class="my-section" data-min-role="coach">
  <button class="action-btn" onclick="App.showPage('page-my-activities')">活動管理</button>
</div>
```

**v7 決議**：**維持現狀**。這是全局頁面層級入口、不隨 tab 切換、與月曆無衝突。**無需修改**，只是明確記錄不動。

### 12.T 🟢 多日活動（multiDate）資料結構釐清

**現況**：看 `event-create-multidate.js` L192-217，多日活動建立時**每個日期都是一個獨立 event 文件**（各自 id + date + `batchGroupId` 分組）。**不存在「一個活動跨多日」的資料結構**。

**v7 決議 — 修正計畫書誤解**：
- ~~§10 測試第 11 項「跨月活動（4/30 到 5/2）只在 4/30 顯示」❌ 刪除~~（資料結構不存在）
- 改為：「batch 活動（多日同批）在月曆每天各自顯示、不合併、不特殊處理 batchGroupId」
- 本期不做 batch 視覺分組（後續擴充點）

**驗收**：
- [ ] 多日活動（5 天）在月曆 5 個日期格各自顯示
- [ ] 每個格可獨立點擊進詳情
- [ ] 不會誤顯示 batchGroupId 或其他批次資訊

---

## 13. How to start coding（新進工程師指引）

此章為新加入此工程的開發者提供上手指引。

### 13.1 從哪裡看起

1. **先讀 §0 TL;DR**（3 行）了解整體目標
2. **讀 §2 設計決策表**（13 題）了解基本規則
3. **讀 §5 檔案清單** 知道要動哪些檔
4. **跳到 §6 WBS Phase 1** 開始動手

### 13.2 開發前檢查

```bash
# 1. 確保在正確分支
git status

# 2. 跑現有測試確保環境 OK
npm run test:unit

# 3. 啟動本地 server 測試
npx serve . -l 3000
```

### 13.3 Phase 1 具體步驟

```bash
# 建新模組目錄下的檔案
touch js/modules/event/event-calendar-constants.js
touch js/modules/event/event-list-calendar.js
touch css/calendar.css

# 編輯（參考 §3 運動色系統、§4.2 月份 Intl 用法）
```

### 13.4 常見踩坑（v7 擴充）

| 情境 | 注意 |
|------|------|
| tab 屬性名 | **用 `data-atab="calendar"`、不是 `data-tab`**（見 §12.A）|
| tab 值 | **用 `'calendar'`，既有兩 tab 是 `'normal'` / `'ended'`**（不是 `'active'`）|
| 改動 `js/modules/event/event-list-timeline.js` | 屬鎖定區、僅加 `data-date-anchor`、不動邏輯 |
| 改動 `firestore.rules` | **本期不需改**（月曆只讀既有 events）|
| 改動 `js/firebase-crud.js` / `stats.js` | **本期不需改** |
| 改動 `js/firebase-service.js` | **必須加 1 行月曆 render 分支**（見 §12.C，L198 附近）|
| 改動 `js/core/theme.js` | **2 處都要改**：setActiveSport（§12.D）+ filter-bar 3 handler（§12.O）|
| 改動 `event-list-helpers.js` switchRegionTab | 必須加 1 行（見 §12.D）|
| 改動 `event-manage.js` toggleMyActivityPin | 必須加 1 行（見 §12.E）|
| **改動 `js/core/navigation.js`** | **必須加 1 行**（`_renderPageContent`、返回頁時 rerender、§12.M）|
| 月曆 render 過濾 | 直接用 `App._getVisibleEvents()`，**不需再呼叫 `_isEventVisibleToUser`**（已內建） |
| 運動色 | 用 `SPORT_COLORS[sportTag]`、未註冊運動自動 fallback `--sport-other` |
| 月份名 | 用 `Intl.DateTimeFormat`、不 hardcode |
| 事件 cell | 用 `data-id` + event delegation、不用 inline onclick |
| pinned 判斷 | 用 truthy `e?.pinned`、不用 `=== true`（與既有全站一致，§12.F）|
| 排序 | 必加 `pinOrder` 次序（與 timeline 一致，§12.F）|
| 防抖 | 首次切 tab 不走防抖、同步 render 一次（§12.H）|
| `_autoEndExpiredEvents` | render 前呼叫一次、與 timeline 對齊（§12.I）|
| lazy-load | 用獨立群組 `activityCalendar` + `_setActivityTab('calendar')` 動態觸發 |
| **CSS 命名空間** | **用 `.evt-cal-*` 前綴、不用 `.calendar-*`**（避免全域污染，§12.P）|
| **日期格式** | **統一 padded `YYYY-MM-DD`（透過 `_toDateKey()`）、event.date 實際是 `YYYY/MM/DD`**（§12.N）|
| **cancelled 活動** | 月曆顯示刪除線 + opacity 0.35（§12.Q）|
| **已報名邊框** | 正取綠色、候補橘色虛線（§12.R）|
| **多日活動** | 每個日期為獨立 event、不合併、不特殊處理 batchGroupId（§12.T）|

### 13.5 測試 checklist

- [ ] `npm run test:unit` 全過（2362+ 不 regression）
- [ ] Chrome / Safari / LINE WebView 實測
- [ ] 深淺主題都試
- [ ] 寬版（≥ 768px）+ 窄版（< 768px）
- [ ] 鍵盤導航（Tab + ↑↓←→ + Enter）
- [ ] VoiceOver / TalkBack 實測（至少一個）
- [ ] 跑 `node scripts/bump-version.js`
- [ ] commit + push 前 grep 無殘留錯誤

### 13.6 求助

- CLAUDE.md 查規則
- `docs/claude-memory.md` 查歷史踩坑
- 現有 `js/modules/event/event-list-timeline.js` 作為 reference

---

## 14. CLAUDE.md 規則檢查清單（動手前必讀 — v6 更新）

- [x] **外科手術式修改**：只動必要的檔案，鎖定函式區最小改動（只加 `data-date-anchor` 屬性、不改邏輯）
- [x] **程式碼精簡**：不加未來可能用到的抽象層
- [x] **跨瀏覽器相容性**：LINE WebView / Chrome / Safari 都要實測（scroll-snap fallback 已備）
- [x] **彈窗毛玻璃規範**：本期無彈窗（若後續擴充加則遵循）
- [x] **實體 ID 統一**：活動用 `data.id`（非 `doc.id`）
- [x] **測試與 CI**：改 `event-list*.js` 必須跑 `npm run test:unit`
- [x] **版號更新**：改 HTML/JS/CSS 必須 `bump-version.js`
- [x] **文件同步**：新模組要更新 `architecture.md` + `structure-guide.md`
- [x] **開發守則**：新模組放入 `js/modules/event/` 對應資料夾（不扁平化）
- [x] **⚠️ 活動可見性規則**：直接用 `App._getVisibleEvents()`（內建 `_isEventVisibleToUser` + `privateEvent` + `_canViewEventByTeamScope`）
- [x] **黑名單機制整合**：`blockedUids`、`privateEvent` 透過上述 helper 處理
- [x] **報名系統保護規則**：月曆是**讀取**視圖，不動 registration 邏輯，無鎖定風險
- [x] **統計系統保護規則**：月曆不涉及 UID 比對、統計計算，無鎖定風險
- [x] **無障礙 WCAG 2.1 AA**：色盲 emoji 備援、鍵盤導航、ARIA（§4.10）
- [x] **跨時區**：event.date 視為台灣時間字串處理（與現有一致）
- [x] **v6 新增：鎖定檔例外記錄** — `js/firebase-service.js` L198 加 1 行 render 分支（非鎖定函式區、單獨 commit、標記「合理例外」於 `docs/claude-memory.md`）
- [x] **v6 新增：首次實作零 regression 驗證** — §12.A-K 11 項全部 PASS 才算完工
- [x] **v6 新增：pinned 風格一致** — 全站 truthy 比對，月曆沿用 `e?.pinned`（不改為 `=== true`）
- [x] **v6 新增：Rules / CF 零改動** — Firestore Rules `events` read 本就 `if true`、CF 不依賴前端 tab、月曆 Database 層零影響
- [x] **v7 新增：返回頁 tab 記憶** — `navigation.js` `_renderPageContent` 必須含月曆分支（§12.M）
- [x] **v7 新增：日期 key normalize** — 統一用 `_toDateKey()` 產 padded `YYYY-MM-DD`（§12.N）
- [x] **v7 新增：filter-bar 同步** — `theme.js` filter-bar 3 handler 必須呼叫月曆 render（§12.O）
- [x] **v7 新增：CSS 命名空間** — 用 `.evt-cal-*` 前綴（§12.P）
- [x] **v7 新增：cancelled 規格** — 刪除線 + opacity 0.35（§12.Q）
- [x] **v7 新增：狀態標記極簡原則** — 只保留「已報名邊框」+「置頂高光」，其餘（收藏/私密/性別/俱樂部）不進月曆格（§12.R）
- [x] **v7 新增：多日活動理解** — 每個日期是獨立 event、不合併（§12.T）

---

## 15. 確認事項

此計畫書列出我的 13 個預設答案 + 完整工程計畫。若用戶確認：

- **全盤同意** → 我開始 Phase 1-5 實作
- **部分調整** → 請用 Q 編號告知修改點
- **延期** → 保留此計畫書作為未來執行依據

**預期完成時間**：若連續專注 7.5 天全職、或分散 2-3 週兼職。

---

**計畫書版本**：2026-04-22 v1
**維護者**：Claude
**連絡**：用戶審核後修訂 v2
