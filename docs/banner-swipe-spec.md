# Banner Swipe 功能規格書

## 目的
為首頁 Banner 輪播加入觸控左右滑動（swipe）支援，讓手機用戶可以用手指滑動切換廣告。

---

## 修改範圍

**只動一個檔案：**
- `js/modules/banner.js`

**不可動的檔案（禁止修改）：**
- `pages/home.html`（HTML 結構不變）
- `css/home.css`（CSS 不變）
- `app.js`
- 任何其他模組

---

## DOM 結構（唯讀參考）

```html
<div class="banner-carousel">
  <div class="banner-track" id="banner-track"></div>
  <button class="banner-arrow banner-arrow-left" id="banner-prev">‹</button>
  <button class="banner-arrow banner-arrow-right" id="banner-next">›</button>
  <div class="banner-dots" id="banner-dots"></div>
</div>
```

- `#banner-track`：輪播容器，以 `transform: translateX(-N * 100%)` 切換張數
- `#banner-prev` / `#banner-next`：已有 click 事件（不可重複綁定）
- `.banner-dot`：小圓點，`goToBanner(idx)` 自動更新 active 狀態

---

## 實作位置

在 `startBannerCarousel()` 函式內，緊接在現有 `prev.addEventListener` / `next.addEventListener` 的**下方**、`setInterval` 的**上方**，加入 swipe 事件。

### 現有程式碼結構（標示插入位置）：

```javascript
startBannerCarousel() {
  const prev = document.getElementById('banner-prev');
  const next = document.getElementById('banner-next');
  if (!prev || !next) return;
  if (prev.dataset.bound) return;
  prev.dataset.bound = '1';
  next.dataset.bound = '1';

  prev.addEventListener('click', () => { ... });
  next.addEventListener('click', () => { ... });

  // ← 在這裡插入 swipe 事件（見下方）

  if (this.bannerTimer) clearInterval(this.bannerTimer);
  this.bannerTimer = setInterval(() => { ... }, 8000);
},
```

---

## 插入的程式碼

```javascript
// ── Touch Swipe ──
const track = document.getElementById('banner-track');
if (track) {
  let _swipeStartX = 0;
  track.addEventListener('touchstart', (e) => {
    _swipeStartX = e.touches[0].clientX;
  }, { passive: true });
  track.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - _swipeStartX;
    const cnt = this.bannerCount || 1;
    if (dx < -50) this.goToBanner((this.bannerIndex + 1) % cnt);       // 左滑 → 下一張
    if (dx >  50) this.goToBanner((this.bannerIndex - 1 + cnt) % cnt); // 右滑 → 上一張
  }, { passive: true });
}
```

### 說明
| 項目 | 值 |
|------|----|
| 觸發閾值 | 滑動距離超過 50px 才切換（避免誤觸） |
| 使用事件 | `touchstart` + `touchend`（不使用 touchmove，避免干擾頁面上下捲動） |
| passive | 兩個事件都設 `{ passive: true }`，符合 Chrome 效能規範，不觸發警告 |
| 防重複 | 插入在 `if (prev.dataset.bound) return;` 之後，`startBannerCarousel()` 已有防重複保護 |
| 自動輪播重置 | 不需要，`goToBanner()` 只更新位置與圓點，不影響 `setInterval` |

---

## 完整修改後的 startBannerCarousel()

```javascript
startBannerCarousel() {
  const prev = document.getElementById('banner-prev');
  const next = document.getElementById('banner-next');
  if (!prev || !next) return;           // DOM 尚未就緒，跳過
  if (prev.dataset.bound) return;       // 防止重複綁定
  prev.dataset.bound = '1';
  next.dataset.bound = '1';
  prev.addEventListener('click', () => {
    const cnt = this.bannerCount || 1;
    this.goToBanner((this.bannerIndex - 1 + cnt) % cnt);
  });
  next.addEventListener('click', () => {
    const cnt = this.bannerCount || 1;
    this.goToBanner((this.bannerIndex + 1) % cnt);
  });

  // ── Touch Swipe ──
  const track = document.getElementById('banner-track');
  if (track) {
    let _swipeStartX = 0;
    track.addEventListener('touchstart', (e) => {
      _swipeStartX = e.touches[0].clientX;
    }, { passive: true });
    track.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - _swipeStartX;
      const cnt = this.bannerCount || 1;
      if (dx < -50) this.goToBanner((this.bannerIndex + 1) % cnt);
      if (dx >  50) this.goToBanner((this.bannerIndex - 1 + cnt) % cnt);
    }, { passive: true });
  }

  if (this.bannerTimer) clearInterval(this.bannerTimer);
  this.bannerTimer = setInterval(() => {
    const cnt = this.bannerCount || 1;
    this.bannerIndex = (this.bannerIndex + 1) % cnt;
    this.goToBanner(this.bannerIndex);
  }, 8000);
},
```

---

## 快取版本號更新（必做）

完成程式修改後，**必須同步更新版本號**：

1. `js/config.js` → 將 `CACHE_VERSION` 改為 `'20260221h'`
2. `index.html` → 將所有 `?v=20260221g` 取代為 `?v=20260221h`（共約 61 處）

> **重要**：`index.html` 含有 UTF-8 BOM，請用 Python 處理，不可用 PowerShell Get-Content/Set-Content（會損毀中文字元）：
> ```python
> with open('index.html', encoding='utf-8-sig') as f:
>     content = f.read()
> content = content.replace('20260221g', '20260221h')
> with open('index.html', 'w', encoding='utf-8-sig') as f:
>     f.write(content)
> ```

---

## 輸出驗收標準

Codex 完成後，請回報以下每項測試結果：

### A. 程式碼檢查
- [ ] `startBannerCarousel()` 內新增了 `touchstart` + `touchend` 兩個事件監聽
- [ ] 兩個事件都設有 `{ passive: true }`
- [ ] `_swipeStartX` 為函式區域變數（`let`），不是全域或 `App.` 屬性
- [ ] 插入位置在 `prev.addEventListener` 之後、`setInterval` 之前
- [ ] **未修改** `pages/home.html`
- [ ] **未修改** `css/home.css`
- [ ] **未修改** `renderBannerCarousel()` 或 `goToBanner()`
- [ ] `js/config.js` CACHE_VERSION 改為 `'20260221h'`
- [ ] `index.html` 所有 `?v=` 改為 `20260221h`

### B. 行為驗收（手機模式或 DevTools 模擬器）
- [ ] 左滑（右→左）超過 50px → 切換到下一張 Banner
- [ ] 右滑（左→右）超過 50px → 切換到上一張 Banner
- [ ] 滑動距離不足 50px → 不切換（防誤觸）
- [ ] 滑動後圓點（`.banner-dot`）正確更新 active 狀態
- [ ] 滑動切換後自動輪播計時器**不中斷**（繼續每 8 秒自動切換）
- [ ] 原有 `‹` / `›` 按鈕點擊切換**仍然正常**
- [ ] 上下捲動頁面時**不會誤觸**橫向切換
- [ ] DevTools Console 無新增錯誤或 passive 警告

### C. 版本號驗收
- [ ] `js/config.js` 中 `CACHE_VERSION === '20260221h'`
- [ ] `index.html` 中不存在 `20260221g`（全部替換完畢）
- [ ] `index.html` 中文字元正常（title / tab 不顯示亂碼）
