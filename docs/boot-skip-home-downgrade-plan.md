# Boot 跳過首頁渲染 — 降階方案計劃書(Phase 1 only)

**目標**:reload 帶 hash navigation 或 deep link 時,**boot 階段不渲染首頁內容**,使 boot overlay 隱藏後用戶不會看到「banner + 熱門活動」的完整首頁。

**範圍**:**僅階段 1 + W3 修正**(不做階段 2/3/4,避開 QA 標出的 2 個 BLOCKER)。

**狀態**:📋 計劃書草稿(待 QA 審計後執行)

**Last Updated**:2026-04-27(自我審計後修正:加 `preloadCorePages` 保留 + popup ads 副作用說明)

---

## 一、為什麼選降階方案

QA agent 審計原 4 階段計劃發現:
- 🚨 **B1**:階段 2 在 `init()` 開頭做 `getElementById(target)`,但 PageLoader Phase 1 是背景執行不 await,**目標頁 DOM 尚未存在,swap 失效**
- 🚨 **B2**:手動 swap class 破壞 `_activatePage` 的「class state 由我管」不變式
- ⚠️ **W3**:原階段 1 漏掉 `?event=` deep link 場景(無 hash → 守衛不觸發)

→ 階段 2 必須重設計,風險升 🟠。**降階方案只做階段 1 + 補 W3,維持 🟢 風險**。

---

## 二、唯一改動(1 處)

### 檔案:`app.js renderAll()`(L401-405)

**改動前**:
```javascript
renderAll() {
  this.renderGlobalShell();
  this.renderHomeCritical();
  this._scheduleHomeDeferredRender();
}
```

**改動後**:
```javascript
renderAll() {
  this.renderGlobalShell();  // 全域必要,保留

  // 2026-04-27:hash navigation 或 deep link 時跳過首頁渲染
  // 避免 boot overlay 隱藏後用戶看到「banner + 熱門活動」的完整首頁
  // 詳見 docs/boot-skip-home-downgrade-plan.md
  const bootHash = (location.hash || '').replace(/^#/, '').trim();
  const isHashNav = bootHash && /^page-[\w-]+$/.test(bootHash) && bootHash !== 'page-home';
  let isDeepLink = false;
  try {
    isDeepLink = !!(
      sessionStorage.getItem('_pendingDeepEvent') ||
      sessionStorage.getItem('_pendingDeepTeam') ||
      sessionStorage.getItem('_pendingDeepTournament') ||
      sessionStorage.getItem('_pendingDeepProfile')
    );
  } catch (_) {}
  if (isHashNav || isDeepLink) {
    console.log('[Boot] 跳過首頁初始渲染 (hash=' + bootHash + ', deepLink=' + isDeepLink + ')');
    // 🔑 自我審計後新增:仍呼叫 preloadCorePages 保留全域必要副作用
    // 避免後續切到 activity/team/tournament 頁時,scripts 才即時載入(慢)
    if (typeof ScriptLoader !== 'undefined' && ScriptLoader.preloadCorePages) {
      try { ScriptLoader.preloadCorePages(); } catch (_) {}
    }
    return;
  }

  this.renderHomeCritical();
  this._scheduleHomeDeferredRender();
}
```

**程式碼增加**:約 19 行(含註解)

---

## 三、跳過 `renderHomeCritical` 的副作用清單

### A. 視覺副作用(本來就要跳過)
- ✅ Banner 輪播不渲染 — 用戶看不到首頁 banner
- ✅ 公告區塊不渲染 — 用戶看不到首頁公告
- ✅ 熱門活動列表不渲染 — 用戶看不到首頁熱門活動

→ 這些就是我們要避免的「首頁 flash」內容

### B. State 副作用(可能影響後續)

**B1**:`_markPageSnapshotReady('page-home')` 不會被呼叫
- 影響:首次從目標頁返回首頁時,`_canUseStaleNavigation('page-home')` 可能回 false → 走 fresh-first(較慢)
- **嚴重度**:🟢 低 — 只是首次返回慢一點,不致命
- 處理:**接受**(用戶從目標頁回首頁是主動操作,慢一點可接受)

**B3**:PageLoader 失敗時退化更明顯(QA 審計後新發現)
- 影響:若 PageLoader 10 秒 timeout,page-activities DOM 未插入時:
  - 修前:用戶看到「首頁(banner+熱門活動)」,可勉強用
  - 修後:用戶看到「全空畫面」(首頁未渲染 + 目標頁 DOM 不存在)→ 看門狗 8 秒 reload 自動救回
- **嚴重度**:🟡 — PageLoader 10 秒 timeout 本身極罕見,且看門狗會 reload
- 處理:**接受**(極端 case 已有看門狗兜底,reload 後通常成功)

**B2**:`showPopupAdsOnLoad` 不會被觸發(自我審計後新發現)
- 影響:reload 帶 hash 時,當下不彈出 popup ads;用戶後續切回首頁也不會彈(設計如此)
- **嚴重度**:🟡 低 — 影響廣告投放
- 處理:**接受**(popup ads 設計就是「進首頁時顯示」,用戶 reload 到非首頁可視為「沒進首頁」)

### C. 全域必要副作用(自我審計後修正盤點)

| 副作用 | 位置 | 是否需保留? | 處理 |
|--------|------|:---:|------|
| `renderFloatingAds` | `pages/home.html:97` `#floating-ads` | ❌ 不需 | DOM 在首頁專屬,函式自帶 `if (!container) return` 守衛,跳過無影響 |
| `renderSponsors` | `pages/home.html:85` `#sponsor-grid` | ❌ 不需 | 同上 |
| `showPopupAdsOnLoad` | 全頁 popup | ❌ 不需 | 列為 B2 副作用 |
| **`ScriptLoader.preloadCorePages`** | 全域預載 | ✅ **必須保留** | **修正計劃**:跳過分支內單獨呼叫 |

---

## 四、預期效果(基於 7 個測試情境)

| 情境 | 修前 | 修後 |
|------|------|------|
| 1. 無 hash reload(`/`) | 首頁正常 | 首頁正常 ✅(不影響) |
| 2. `#page-home` reload | 首頁正常 | 首頁正常 ✅(`bootHash === 'page-home'` 跳過守衛) |
| 3. `#page-activities` reload | overlay 7s 消失 → 看到首頁 → 跳活動列表 | overlay 消失 → **看到 page-home 空白容器**(不渲染 banner)→ 跳活動列表 ⚠️ |
| 4. `#page-shop` reload | 同 3 | 同 3(空白容器→跳商店) |
| 5. `#page-personal-dashboard` reload | 同 3 | 同 3(空白容器→跳儀表板) |
| 6. **`?event=ce_xxx` deep link reload**(新增 W3 修正) | overlay 消失 → 看到首頁 → 跳活動詳情 | overlay 消失 → **空白容器** → 跳活動詳情 ⚠️ |
| 7. 從活動列表點活動詳情後 reload(無 ?event=) | overlay 消失 → 首頁閃 → 退到活動列表(設計如此) | 同上(因 hash `#page-activity-detail` 觸發守衛 → 空白 → 退活動列表)|

→ 所有「閃完整首頁」情境變成「閃空白容器」,**改善但非完美**(空白容器可能短暫可見)。

---

## 五、與其他既有機制的互動

### 不影響:7 秒 Navigation timeout(commit 8060d364)
- Boot overlay 仍會等 navigation 完成或 7 秒 timeout
- 兩者**串聯**:
  - Navigation 在 7 秒內完成 → overlay 隱藏 → 看到目標頁 ✅
  - Navigation 超過 7 秒 → overlay 強制消失 → 看到「空白容器」(因首頁沒渲染)→ 1-2 秒後跳目標頁 ⚠️(比修前看到完整首頁好)

### 不影響:看門狗 8 秒
- 仍正常運作

### 不影響:MIN_VISIBLE_MS 2.5 秒
- 仍正常運作

---

## 六、Rollback 計畫

完整 rollback:刪除新增的 **19 行**(從 `// 2026-04-27` 註解開始到最後一個 `return`,包含 preloadCorePages 守衛 3 行)

`git revert <commit-id>` 也可。

---

## 六之二、自我審計 5 輪結果(2026-04-27)

| Round | 檢查項 | 結果 | 備註 |
|:---:|------|:---:|------|
| 1 | 語法 + 邏輯(regex / typeof / try-catch) | ✅ | regex `/^page-[\w-]+$/` 正確 case-sensitive |
| 2 | 邊界 case(空 hash / page-home / 大小寫 / 特殊字元 / `#` only) | ✅ | 各情境 fallback 安全 |
| 3 | 時序 race(deep link 解析 `app.js:2197-2222` vs renderAll `app.js:403`) | ✅ | deep link 在 init 之前同步寫入 sessionStorage |
| 4 | 非 boot 場景 renderAll 呼叫(visibility resume / cloud ready / `firebase-service.js:1005, 2234, 2283`) | ✅ | 既有 `_isHomePageActive()` 守衛仍生效,我的守衛是「再加一層」,結果一致 |
| 5 | 跨瀏覽器(Chrome / iOS Safari / LINE WebView) | ✅ | sessionStorage / regex / typeof 三端原生支援 |

**新發現的副作用**(已併入 §三):
- `ScriptLoader.preloadCorePages` 必須單獨呼叫(已修正)
- `showPopupAdsOnLoad` 不觸發(列為 B2,接受)

---

## 七、測試 Checkpoint(必須全綠才視為成功)

### 桌面(Chrome)
- [ ] 測試 1:無 hash reload → 首頁正常顯示(banner / 公告 / 熱門活動)
- [ ] 測試 2:`#page-home` reload → 首頁正常顯示
- [ ] 測試 3:`#page-activities` reload → 不看到 banner 內容
- [ ] 測試 4:`#page-shop` reload → 不看到 banner 內容
- [ ] 測試 5:`#page-personal-dashboard` reload → 不看到 banner 內容(需登入)
- [ ] 測試 6:`?event=ce_xxx` deep link reload → 不看到 banner 內容
- [ ] 測試 7:活動列表點詳情後 reload → 退到列表(預期設計)
- [ ] 測試 8:從目標頁返回首頁(點抽屜)→ 首頁正常顯示(雖然首次可能慢)

### 跨瀏覽器(降階方案規模較小,不強制)
- [ ] 手機 Safari `#page-activities` reload → 同測試 3
- [ ] 手機 LINE WebView `#page-activities` reload → 同測試 3

### 自動化測試
- [ ] `npm run test:unit` 通過(預期不影響,因為 unit test 不模擬 boot 流程)

### 新增:全域副作用驗證
- [ ] 測試 9:`#page-activities` reload → 切到 `page-teams` → 確認 team scripts 已預載(F12 Network 看是否有 `team-list.js?v=...` 在 boot 階段已下載)
- [ ] 測試 10:`#page-activities` reload → 確認 popup ads **不**自動彈出(設計如此)
- [ ] 測試 11:正常無 hash reload → 確認 popup ads 仍正常彈出(對照組)

### 新增:極端退化路徑驗證(QA 條件批准要求)
- [ ] 測試 12:DevTools throttle 模擬 network failure → `#page-activities` reload → PageLoader 10 秒 timeout → 確認看門狗 8 秒 reload 自動觸發 + reload 後正常進入

---

## 八、實作順序

1. **改動 1 個檔案**:`app.js renderAll()` 加 16 行
2. **不需動 docs/architecture.md**(沒新增模組)
3. **更新 docs/tunables.md**:在「Sequence Effects → Boot overlay 隱藏流程」加註「2026-04-27:hash nav / deep link 場景跳過 `renderHomeCritical`」
4. **更新 docs/claude-memory.md**:加修復日誌條目
5. **bump version**(`bump-version.js`)
6. **跑 npm run test:unit**(預期 2456 PASS)
7. **本地測試 8 個 checkpoint**(桌面 Chrome)
8. **commit + push**
9. **手機驗證**(Cloudflare 部署完後)

---

## 九、風險評估表

| 評估項目 | 內容 |
|---------|------|
| 做了會怎樣 | hash nav / deep link reload 不再渲染首頁完整內容,可能看到極短空白容器 |
| 不做會怎樣 | 維持「閃完整首頁(banner+熱門活動)→ 跳目標頁」現狀 |
| 最壞情況 | `_markPageSnapshotReady('page-home')` 沒被 mark → 首次從目標頁返回首頁慢一點(走 fresh-first 而非 stale-first)|
| 影響範圍 | `app.js renderAll()` + 1 處,新增 16 行 |
| 動到鎖定函式 | ❌ 無 |
| 回退難度 | 秒回退(刪 16 行) |
| 跨瀏覽器相容 | ✅ 純 JS 邏輯 + sessionStorage 三端支援 |
| 預估時間 | 30-45 分鐘 |

---

## 十、決策請求(動手前最後確認)

請確認:
- [x] 接受降階方案範圍(僅階段 1 + W3,不做階段 2/3/4)
- [x] 接受「空白容器可能短暫可見」的妥協(避開 BLOCKER B1/B2)
- [x] 接受 `_markPageSnapshotReady` 副作用(首次返回首頁稍慢)
- [x] 接受預估時間 30-45 分鐘
- [x] 接受 8 個測試 checkpoint

**已確認 → 開始執行(先 QA 審計這份計劃,通過才動手)**

---

## 十一、跟「完整方案」的差距

降階方案**沒解決**的問題:
- ⚠️ Boot overlay timeout 提早觸發時,用戶仍看到「page-home 空白容器」(無 banner / 熱門活動)
- ⚠️ 無 100% 視覺完美

要 100% 治本仍需要:
- 階段 2 重設計(用 `_activatePage(target, { suppressHashSync: true, render: false })`)
- 階段 4 動 `currentPage` 預設值 + 全域 review

→ **未來若降階方案不夠,可加做完整方案**(但 QA 確認風險顯著高)。
