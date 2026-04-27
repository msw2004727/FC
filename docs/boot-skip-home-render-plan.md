# Boot 階段跳過首頁渲染 — 完全治本計劃書

**目標**:讓 reload 帶 hash(如 `#page-activities`)時,**boot 過程完全不渲染首頁內容**,使 boot overlay 隱藏後用戶**直接看到目標頁**(不再經過首頁 flash)。

**狀態**:📋 計劃書草稿(待 QA 審計後執行)

**Last Updated**:2026-04-27

---

## 一、當前架構問題深度分析

### 視覺元兇:`renderHomeCritical()` 無條件執行

[app.js renderAll()](app.js):
```javascript
renderAll() {
  this.renderGlobalShell();
  this.renderHomeCritical();        // ← 不管 URL 是什麼,一律渲染首頁!
  this._scheduleHomeDeferredRender(); // 同上
}
```

### 隱性元兇:`currentPage` 預設值寫死

[app.js:239](app.js:239):
```javascript
currentPage: 'page-home',  // 寫死
```

### HTML 結構元兇:`page-home` 預設 `.active`

```html
<div id="page-home" class="page active">  <!-- 預設可見 -->
```

### 結合三者的後果

1. boot 階段 `currentPage='page-home'` + page-home DOM `.active`
2. `renderHomeCritical()` 渲染 banner / 熱門活動 / 公告等內容到 `#page-home`
3. boot overlay 蓋住 → 用戶不知道
4. boot overlay 7 秒 timeout 後消失(navigation 還沒完成)
5. **用戶看到完整渲染的首頁**(banner 輪播、熱門活動列表)
6. 1-2 秒後 hash navigation 完成 → `_activatePage('page-activities')` swap class → 跳到 page-activities

---

## 二、4 階段修法計劃(由低風險到高風險,可分階段部署)

### 🟢 **階段 1**:跳過 `renderHomeCritical`(方案 C 核心)

**檔案**:`app.js renderAll()`(L399-405 附近)

**改動**:
```javascript
renderAll() {
  this.renderGlobalShell();  // 全域必要(banner-related infra),保留

  // 🔑 新增:URL 有 hash 且非 page-home → 跳過首頁渲染
  const bootHash = (location.hash || '').replace(/^#/, '').trim();
  const isHashNav = bootHash && /^page-[\w-]+$/.test(bootHash) && bootHash !== 'page-home';
  if (isHashNav) {
    console.log('[Boot] hash nav 偵測到 (' + bootHash + '),跳過首頁初始渲染');
    return;
  }

  this.renderHomeCritical();
  this._scheduleHomeDeferredRender();
}
```

**風險**:🟢 **極低**
- 不動任何 `currentPage` 判斷
- 只跳過渲染,不改 state
- Explore agent 確認首頁 critical 副作用都是首頁獨佔(banner / 熱門活動)
- 全域必要副作用(floatingAds / sponsors / preloadCorePages)在 `renderGlobalShell` 或 deferred 區塊,**不在跳過範圍**

**預期效果**:
- ✅ 用戶不再看到「banner + 熱門活動」的完整首頁
- ⚠️ 用戶仍可能看到「page-home 空白容器」(因為 DOM 仍 `.active`)— 但比之前好

**測試 checkpoint**:
- 開 `#page-activities` reload → 確認首頁 banner / 熱門活動**沒有渲染**(F12 看 `#hot-events` 是空的)
- 開 `https://toosterx.com/`(無 hash)reload → 首頁正常渲染
- 開 `#page-home` reload → 首頁正常渲染

**Rollback**:刪除 7 行新增程式碼

---

### 🟡 **階段 2**:HTML class swap(boot 階段早期把 `.active` 移到目標頁)

**檔案**:`app.js init()` 開頭

**改動**:
```javascript
init() {
  // 🔑 boot 階段早期 swap .active class 到 hash 對應的目標頁
  // 避免 page-home DOM 仍 .active 導致 overlay 隱藏後仍可見空白首頁容器
  try {
    const bootHash = (location.hash || '').replace(/^#/, '').trim();
    if (bootHash && /^page-[\w-]+$/.test(bootHash) && bootHash !== 'page-home') {
      const targetEl = document.getElementById(bootHash);
      const homeEl = document.getElementById('page-home');
      if (targetEl && homeEl && targetEl !== homeEl) {
        homeEl.classList.remove('active');
        targetEl.classList.add('active');
        // ⚠️ 注意:不動 this.currentPage(仍 'page-home'),避免影響 15 處判斷
        console.log('[Boot] 早期 swap .active class 到 ' + bootHash);
      }
    }
  } catch (_) {}

  // ...原有 init 程式碼
}
```

**風險**:🟡 **低**
- 只動 DOM `.active` class
- **不動 `this.currentPage`**(仍 'page-home',15 處判斷不受影響)
- `_activatePage(target)` 後續會正確設 `currentPage = bootHash`

**預期效果**:
- ✅ boot overlay 隱藏後,用戶看到目標頁的 DOM 結構(雖然內容可能還沒渲染)
- ✅ 不會再看到空白首頁容器

**潛在風險**:
- `currentPage` 跟 DOM `.active` 不一致(中間 1-2 秒)
- 某些 listener 用 `currentPage` 判斷渲染目標,可能誤觸發
- 例如 `firebase-service.js:2952` `if (App.currentPage === 'page-home') App.renderHotEvents()` 在 visibility resume 時會誤觸發 → 渲染熱門活動到隱藏的 page-home → 不會被看到,但浪費 CPU

**測試 checkpoint**:
- F12 確認 `#page-home` 沒有 `.active` class、`#page-activities` 有
- 確認 `App.currentPage` 仍是 `'page-home'`(中間態)
- 等 hash routing 完成 → `App.currentPage` 變 `'page-activities'`

**Rollback**:刪除 init 開頭加的 12 行

---

### 🟠 **階段 3**:更新 6 處 `_isHomePageActive` 使用點(讓判斷邏輯一致)

**問題**:`_isHomePageActive()` 的當前邏輯:
```javascript
_isHomePageActive() {
  const homePage = document.getElementById('page-home');
  if (!homePage) return false;
  return this.currentPage === 'page-home' || homePage.classList.contains('active');
}
```

階段 2 後,`currentPage='page-home'` 但 `homePage.classList.contains('active')=false` → `_isHomePageActive()` 仍回 true(因為 ||)。

→ `renderHomeCritical` 自帶守衛 `if (!this._isHomePageActive()) return;` 會被誤觸發(因為 currentPage 還是 page-home)。

**這正是階段 1 + 階段 2 的衝突點**。階段 1 已用「hash nav 偵測」跳過,所以 `_isHomePageActive` 的誤判實際上**沒影響**(階段 1 在 renderAll 早就 return 了)。

**需要動嗎**?**不需要**(階段 1 在前已擋住)。但為了一致性,可以改:
```javascript
_isHomePageActive() {
  const homePage = document.getElementById('page-home');
  if (!homePage) return false;
  return homePage.classList.contains('active');  // 只用 DOM 判斷
}
```

**風險**:🟠 **中**
- 改動 `_isHomePageActive` 影響 6 處 caller:
  - `app.js:430` `renderHomeCritical` 守衛
  - `app.js:461` `_scheduleHomeDeferredRender` 守衛
  - `app.js:484` 待 review
  - `app.js:528` 待 review
  - `banner.js:178` banner 渲染守衛
- 大部分 caller 是「渲染前的守衛」,改純 DOM 判斷後行為一致
- **但若有 caller 依賴「currentPage 為主、DOM 為輔」邏輯,可能 break**

**判斷**:**這階段可不做**。階段 1 + 階段 2 已解決視覺問題。階段 3 是「程式碼一致性」優化,非必要。

**Rollback**:還原 `_isHomePageActive` 為原邏輯

---

### 🔴 **階段 4**:讓 `currentPage` 預設值動態化(完全治本)

**檔案**:`app.js:239`

**改動**:
```javascript
currentPage: (() => {
  try {
    const h = (location.hash || '').replace(/^#/, '').trim();
    if (h && /^page-[\w-]+$/.test(h) && document.getElementById(h)) {
      return h;
    }
  } catch (_) {}
  return 'page-home';
})(),
```

**問題**:在 `app.js` 載入時(L239 是 const App = { ... } object literal),DOM 可能還沒完全建構好(尤其 PageLoader 是 Phase 1 動態插入)。`document.getElementById(h)` 可能回 null。

**修正**:用單純 hash 格式判斷,不檢查 DOM 存在:
```javascript
currentPage: (() => {
  try {
    const h = (location.hash || '').replace(/^#/, '').trim();
    if (h && /^page-[\w-]+$/.test(h)) return h;
  } catch (_) {}
  return 'page-home';
})(),
```

**風險**:🔴 **高**
- 影響 **15 處** `currentPage === 'page-home'` 或 `!== 'page-home'` 判斷:
  - `app.js:457` (`_isHomePageActive`) — 階段 3 已處理
  - `js/core/navigation.js:280, 698`
  - `js/firebase-service.js:1000, 2952, 2235`
  - `app.js:1103, 1972, 1979`
- 每處都要 review:
  - 該判斷的本意是「初始化階段是否在首頁」?還是「**現在**是否在首頁」?
  - 如果是「初始化階段」,改 currentPage 預設值會破壞邏輯
  - 如果是「現在」,改了沒影響

**潛在 bug**:
- protected route fallback `if (this.currentPage !== 'page-home')`(`app.js:1972`)— 階段 4 後,即使 reload 進 admin 頁,currentPage 從一開始就是 admin 頁(不是 page-home)→ 邏輯誤觸發
- `_completeDeepLinkFallback` 內 `currentPage !== 'page-home'`(`app.js:1103`)— 同上

**判斷**:**這階段風險最高,可能造成 protected route / deep link fallback 邏輯失效**。

**強烈建議**:**不做階段 4**。階段 1 + 階段 2 已大幅改善體感,階段 4 邊際效益低、風險高。

**Rollback**:還原 currentPage 為 `'page-home'` 字串

---

## 三、推薦執行範圍

| 階段 | 風險 | 預期效果 | 推薦? |
|------|:---:|---------|:---:|
| 階段 1(跳過 renderHomeCritical) | 🟢 極低 | 用戶看不到 banner / 熱門活動的完整首頁 | ✅ **必做** |
| 階段 2(HTML class swap) | 🟡 低 | 用戶看不到空白首頁容器 | ✅ **必做** |
| 階段 3(`_isHomePageActive` 改純 DOM) | 🟠 中 | 程式碼一致性(無視覺差異) | ⚠️ 可選 |
| 階段 4(currentPage 預設動態) | 🔴 高 | 100% 治本(無實質視覺差異) | ❌ **不推薦** |

**推薦執行範圍**:**階段 1 + 階段 2**,合計 ~30-45 分鐘。

---

## 四、測試計畫(7 個 reproduce step)

執行階段 1 + 階段 2 後,需測試以下情境:

### 🧪 測試 1:無 hash reload(基準)
- URL: `https://toosterx.com/`
- F5 reload
- 預期:首頁正常顯示(banner + 熱門活動)
- ✅ Pass / ❌ Fail

### 🧪 測試 2:`#page-home` reload
- URL: `https://toosterx.com/#page-home`
- F5 reload
- 預期:首頁正常顯示(同測試 1)
- ✅ Pass / ❌ Fail

### 🧪 測試 3:`#page-activities` reload(主訴求)
- URL: `https://toosterx.com/#page-activities`
- F5 reload
- 預期:**全程不看到首頁,直接到活動列表**
- ✅ Pass / ❌ Fail

### 🧪 測試 4:`#page-shop` reload
- URL: `https://toosterx.com/#page-shop`
- F5 reload
- 預期:**全程不看到首頁,直接到商店**
- ✅ Pass / ❌ Fail

### 🧪 測試 5:`#page-personal-dashboard` reload(需登入)
- URL: `https://toosterx.com/#page-personal-dashboard`
- F5 reload
- 預期:**全程不看到首頁,直接到個人儀表板**(需登入)
- ✅ Pass / ❌ Fail

### 🧪 測試 6:`?event=ce_xxx` deep link reload(LINE 分享連結)
- URL: `https://toosterx.com/?event=ce_xxx`
- F5 reload
- 預期:**全程不看到首頁,直接到活動詳情**
- ✅ Pass / ❌ Fail
- 確認 deep link + hash navigation 不衝突

### 🧪 測試 7:從活動列表點活動詳情後 reload
- 先進活動列表 → 點某活動 → URL 變 `#page-activity-detail`(無 ?event=)
- F5 reload
- 預期:**fallback 到活動列表**(設計如此,因詳情頁需要 ID)
- ✅ Pass / ❌ Fail

---

## 五、Rollback 計畫

每階段獨立可 rollback:

### Rollback 階段 1
- 刪除 `renderAll` 內新增的 7 行(hash 判斷 + return)

### Rollback 階段 2
- 刪除 `init()` 開頭新增的 12 行(.active class swap)

### 完整 Rollback(回到當前狀態)
- `git revert <commit-id>`

---

## 六、實作順序

1. **建分支實作**(避免影響當前 main)
   - 但 worktree 限制下實際在 claude branch 直接做
2. **先做階段 1**(改 `renderAll` 加判斷)
3. **跑單元測試**(確認 2456 測試通過)
4. **本地測試 7 個情境**(模擬 desktop)
5. **commit + push**
6. **手機測試**(實際 reproduce 用戶問題場景)
7. **如階段 1 已解決問題 → 不做階段 2**
8. **如仍有空白容器問題 → 做階段 2**
9. **每階段間 cooling period**(5-10 分鐘觀察)

---

## 七、必須同步維護的文件

依 `CLAUDE.md §每次新增功能時的規範第 8 條`:
- ✅ `docs/tunables.md` — 新增「Boot 跳過首頁渲染」條目(在 Sequence Effects)
- ✅ `docs/claude-memory.md` — 加修復日誌
- ✅ 程式碼註解中參照 `docs/tunables.md` 對應 anchor

---

## 八、未涵蓋情境(已知限制)

1. **Detail 頁面**(activity-detail / team-detail / 6 個 edu 子頁)reload 仍會 fallback 到列表頁
   - 原因:這些頁需要 ID 才能渲染,純 hash 無法提供
   - 解法:`?event=xxx` deep link 機制(已存在)
   - **不在本計劃範圍**

2. **首頁某個 deferred 副作用恰好被其他頁面依賴**
   - 風險評估:Explore agent 確認 critical 部分都是首頁獨佔
   - 防禦:階段 1 只跳過 critical,deferred 仍會跑(因為延遲執行,不阻塞)
   - 待測試 checkpoint 驗證

---

## 九、決策請求

請確認:

- [ ] 接受推薦範圍(階段 1 + 階段 2)
- [ ] 接受預估時間 30-45 分鐘
- [ ] 接受 7 個測試 checkpoint
- [ ] 不做階段 3 + 階段 4(風險高、邊際效益低)
- [ ] 完成後同步更新 `docs/tunables.md` + `docs/claude-memory.md`

確認後我開始執行階段 1。
