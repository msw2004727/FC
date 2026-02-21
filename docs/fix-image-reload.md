# Fix: 首頁活動 / 賽事列表封面圖重複加載

## 問題描述

用戶從首頁切換到其他頁面再切回來時，首頁的活動卡片與賽事卡片封面圖會重新加載（短暫空白後才出現）。

**根本原因**：`renderAll()` 在以下時機各被呼叫一次：
1. Phase 1 HTML 片段載入完成後
2. Phase 4 Firebase 連線完成後

每次呼叫都會執行 `container.innerHTML = ...`，導致已載入的 `<img>` 元素被銷毀並重建，即使圖片已在 SW 快取中，重建元素仍會產生短暫空白。

## 修改目標

在 `renderHotEvents()` 與 `renderOngoingTournaments()` 加入跳過條件：
**若容器已存在正確數量的真實卡片（非骨架），則直接 return，不重新渲染。**

---

## 修改一：`js/modules/event-render.js`

找到 `renderHotEvents()` 函式，在取得 `visible` 陣列後、執行 `container.innerHTML =` 之前，加入以下判斷：

```javascript
renderHotEvents() {
  this._autoEndExpiredEvents();
  const container = document.getElementById('hot-events');
  if (!container) return;

  const visible = this._getVisibleEvents()
    .filter(e => e.status !== 'ended' && e.status !== 'cancelled')
    .sort((a, b) => {
      const da = this._parseEventStartDate(a.date);
      const db = this._parseEventStartDate(b.date);
      return (da || 0) - (db || 0);
    })
    .slice(0, 10);

  // ── 新增：已渲染且數量相同 → 跳過，避免封面圖重載 ──
  const existingCards = container.querySelectorAll('.h-card:not(.skeleton)');
  if (existingCards.length > 0 && existingCards.length === visible.length) return;

  container.innerHTML = visible.length > 0
    ? visible.map(e => `...`).join('')   // 原有渲染邏輯，不動
    : ...;                               // 原有空狀態邏輯，不動
},
```

**新增的兩行放在 `container.innerHTML =` 的正上方：**

```javascript
const existingCards = container.querySelectorAll('.h-card:not(.skeleton)');
if (existingCards.length > 0 && existingCards.length === visible.length) return;
```

---

## 修改二：`js/modules/tournament-render.js`

找到 `renderOngoingTournaments()` 函式，在取得 `ongoing` 陣列後、執行 `container.innerHTML =` 之前，加入以下判斷：

```javascript
renderOngoingTournaments() {
  const container = document.getElementById('ongoing-tournaments');
  if (!container) return;

  const ongoing = ApiService.getTournaments().filter(t => !this.isTournamentEnded(t));

  // ── 新增：已渲染且數量相同 → 跳過，避免封面圖重載 ──
  const existingCards = container.querySelectorAll('.h-card:not(.skeleton)');
  if (existingCards.length > 0 && existingCards.length === ongoing.length) return;

  if (ongoing.length === 0) {
    container.innerHTML = ...;  // 原有空狀態邏輯，不動
    return;
  }
  container.innerHTML = ongoing.map(t => `...`).join('');  // 原有渲染邏輯，不動
},
```

**新增的兩行放在 `if (ongoing.length === 0)` 的正上方：**

```javascript
const existingCards = container.querySelectorAll('.h-card:not(.skeleton)');
if (existingCards.length > 0 && existingCards.length === ongoing.length) return;
```

---

## 修改三：`js/config.js`

更新快取版本號（格式規則：同天多次加後綴 a, b, c...）：

```javascript
// 目前版本
const CACHE_VERSION = '20260221c';

// 改為（依實際日期調整）
const CACHE_VERSION = '20260221d';
```

---

## 修改四：`index.html`

將所有 `?v=20260221c` 改為 `?v=20260221d`（共約 40 處，包含 CSS 與 JS）。

使用全域搜尋取代：
- 搜尋：`?v=20260221c`
- 取代：`?v=20260221d`

---

## 修改五：`sw.js`

更新 Service Worker 靜態資源快取名稱：

```javascript
// 目前
const CACHE_NAME = 'sporthub-20260221c';

// 改為
const CACHE_NAME = 'sporthub-20260221d';
```

---

## 驗收條件

完成後確認以下項目：

1. `js/modules/event-render.js` 的 `renderHotEvents()` 有新增兩行跳過邏輯
2. `js/modules/tournament-render.js` 的 `renderOngoingTournaments()` 有新增兩行跳過邏輯
3. 新增的判斷放在 `container.innerHTML =` 之前，不影響骨架屏與空狀態邏輯
4. `js/config.js` 的 `CACHE_VERSION` 已更新
5. `index.html` 所有 `?v=` 已統一更新
6. `sw.js` 的 `CACHE_NAME` 已更新
7. 原有渲染邏輯（活動卡片 HTML、空狀態訊息、骨架屏）完全未動

## 不要動的部分

- `renderHotEvents()` 和 `renderOngoingTournaments()` 內的其他邏輯
- 骨架屏相關 HTML（`.skeleton` class）
- 空狀態訊息（`t('activity.noActive')`、`t('tournament.noActive')`）
- `App._firebaseConnected` 判斷邏輯
- 其他 render 函式

## 注意事項

- 跳過條件是 `existingCards.length > 0 AND existingCards.length === visible.length`
  - 必須兩個條件同時成立才跳過
  - `> 0` 確保骨架屏狀態不會被誤判為「已渲染完成」
  - `=== visible.length` 確保活動數量有變動時仍會重新渲染
- 不使用 `===` 比較 innerHTML 字串（太耗效能）
- `querySelectorAll('.h-card:not(.skeleton)')` 是正確的選取方式，骨架卡片有 `.skeleton` class 所以會被排除
