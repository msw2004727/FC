# 頁面切換 Race Condition 統一修補計畫書 v4（最終定稿）

> **狀態**: v4 定稿、已通過 **3 輪 10 位專家審計**
> **審計修訂歷程**：
>   - v1 → v2：修 7 處正確性 Blocker + 統一 6 項命名/格式
>   - v2 → v3：修 5 處 v2 引入的中度回歸（state 延後過度、pre-write cleanup 反效果、navigation hook、deep helper）
>   - v3 → v4：修 1 個真技術 Blocker（`showEduCheckin` / `showEduCheckinScan` 共用容器）+ 6 個部署/觀測性補強
> **範圍**: 選項 C（一級 + 二級、排除 admin-log-tabs）
> **實際改動**：10 個入口 + 3 個 helper + 2 個 debounce helper + 1 處 navigation 修補 + **3 處觀測性/文件補強**

---

## 背景

既有已保護的 3 個函式（對照組、必讀）：
1. `js/modules/event/event-detail.js:219` `showEventDetail`
2. `js/modules/team/team-detail.js:103` `showTeamDetail`
3. `js/modules/tournament/tournament-friendly-detail.js:29` `showTournamentDetail`（友誼賽分支）

navigation.js 核心 `_showPageFreshFirst` / `_showPagePrepareFirst` 用 `_startingPage` 變化量比對。
`_showPageStale` 立即 activate、不需要保護。

---

## 修補範圍（最終版、13 個函式）

### 一級入口（風險高、必改）
1. `js/modules/tournament/tournament-detail.js:6` `showTournamentDetail`（傳統非友誼賽）
2. `js/modules/profile/profile-core.js:138` `showUserProfile`

### 二級入口（7 個教育模組 + 商品）
3. `js/modules/education/edu-calendar-core.js:18` `showEduCalendar`
4. `js/modules/education/edu-checkin.js:18` `showEduCheckin`
5. `js/modules/education/edu-checkin-scan.js:16` `showEduCheckinScan`
6. `js/modules/education/edu-course-enrollment-render.js:13` `showCourseEnrollmentList`
7. `js/modules/education/edu-course-plan.js:32` `showEduCoursePlanForm`
8. `js/modules/education/edu-student-list.js:27` `showEduStudentList`
9. `js/modules/education/edu-student-join.js:14` `showEduStudentApply`
10. `js/modules/shop.js:40` `showShopDetail`

### 連帶 Helper 函式（審計發現、必須一起修）
11. `js/modules/education/edu-checkin.js` `_renderEduCheckinForm`（被 #4 呼叫、內部有多個 await）
12. `js/modules/education/edu-course-enrollment-render.js` `_renderCourseEnrollmentList`（被 #6 呼叫）
13. `js/modules/education/edu-student-list.js` `renderEduStudentList`（被 #8 呼叫）

### 已決定 SKIP
- `admin-log-tabs.js:20` `goBackFromAdminLogs`（三級、await 本身就是導航動作、race 不構成問題）

---

## v4 新增處理的 Blocker（來自第三輪審計）

| # | Blocker | 來源 Agent |
|---|---------|----------|
| **P1** | **技術 Blocker**：`showEduCheckin` 與 `showEduCheckinScan` 共用 `page-edu-checkin` 容器、v3 雙重檢查對兩者都 pass、快速切換會互相蓋 DOM。修法：兩個入口共用同一 seq counter（合併為 `_eduCheckinPageRequestSeq`） | Agent 8 |
| **P2** | 分批 commit 版本號 bump 規則未明文（CLAUDE.md 要求每 commit 內 bump）。v4 明文：A/B/C 各跑 `bump-version.js` 一次、產生 3 個遞增版本號 | Agent 10 |
| **P3** | Commit B 原子性邊界未明文：navigation.js:784 那一行修補**不可拆**、和教育 7 入口 + 3 helper + 2 deep helper 必須同 commit | Agent 10 |
| **P4** | A→B 部署間隔上限未規定：建議 **72 小時** 內 B 必須 push 或整批 revert A（避免跨模組行為不一致） | Agent 10 |
| **P5** | Debug-mode log 必加（`?debug=1` 觸發）、否則 race 攔截無痕、用戶回報無法歸因 | Agent 9 |
| **P6** | CLAUDE.md 加「新增 async show* 函式必做 checklist」、防止未來 regression | Agent 9 |
| **P7** | Helper caller 不需改的清單明文化（靠 `requestSeq != null` fallback 接住） | Agent 8 |

## v3 新增處理的 Blocker（來自第二輪審計）

| # | Blocker 描述 | 來源 Agent |
|---|-------------|----------|
| R1 | **v2「一律延後 state」是過度保護**：`_eduCurrentTeamId` 等 state 會被 `navigation.js:781-784` 在 `showPage` 內部同步讀取、延後導致 hook 用舊值觸發 rerender（閃現舊資料）。改為「只延後參與外部 stale 判斷的 state」（只有 `currentTournament` 屬此類、因 app.js:1678 deep link 檢查）、其他 state 保留在函式開頭寫入。 | Agent 5 + 6 |
| R2 | **`showEduStudentList` 需特殊處理**：進入時先 `this._eduCurrentTeamId = null; this._eduCurrentGroupId = null;` **清掉舊值**、避免 `_renderPageContent` hook 用舊 teamId 跑出錯誤俱樂部的學員列表 | Agent 6 (B-A1) |
| R3 | **移除 #6 pre-write cleanup**：v2 的 `stuckEl.innerHTML = ''` 反而造成空白永停、保留原本的「載入中」文字即可 | Agent 5 |
| R4 | **`navigation.js:784` 改用 `_renderEduStudentListFromCache`**（現成純同步函式、無 await、無 race 風險） | Agent 7 |
| R5 | **補 `_loadPlanCheckinStudents` + `_onEduCheckinGroupChange` 的 seq 保護**：這兩個函式也會寫 DOM、屬於「深層 DOM-writing helper」、v2 漏掉 | Agent 7 |

## 前輪（v1 → v2）處理的 Blocker（保留）

| # | Blocker 描述 | 來源 Agent |
|---|-------------|----------|
| B1 | `showUserProfile` L270 `this.showPage(...)` 沒 await、且 L274 `.then(asyncBadgeHtml => {...})` 無 seq check → 徽章資料會 stale write | 正確性 + 架構 |
| B2 | `showEduCheckin` L23 `this._renderEduCheckinForm()` 沒 await、內部多個 await 後 DOM write 完全繞過守衛 | 正確性 |
| B3 | `showCourseEnrollmentList` 的 helper `_renderCourseEnrollmentList` 內部 L37/L61 await 後 L101 innerHTML 無守衛 | 正確性 |
| B4 | `showEduStudentList` 的 helper `renderEduStudentList` 內部 L56 await 後 L93 innerHTML 無守衛 | 正確性 |
| B5 | `showEduCheckinScan` stale 時沒清相機、`_eduScanner` orphan 造成相機無法關閉（OS 資源洩漏） | 副作用 |
| B6 | `showCourseEnrollmentList` L17-18 pre-write「載入中」DOM 若 stale 會永停、下次回頁看到永停 | 副作用 |
| B7 | `showPage` 後既有 3 個函式**都有** `currentPage !== pageId` 雙重檢查、v1 誤以為只有 friendly 有 | 一致性 |

## 審計發現的一致性對齊（v2 統一）

| # | 對齊項 | 既有主流派做法（必遵守） |
|---|--------|----------------------|
| C1 | Counter 命名 | `_xxxRequestSeq`（不是 `_xxxSeq`） |
| C2 | 區域變數名 | `requestSeq`（不是 `seq`） |
| C3 | Stale return 值 | `return { ok: false, reason: 'stale' };`（不是裸 `return;`） |
| C4 | Counter 初始化位置 | 該函式所在檔案的 `Object.assign(App, {...})` block 最上方、**禁止**集中 bootstrap |
| C5 | State mutation 時機 | **延後到 stale check 之後**（對照 team-detail.js:138） |
| C6 | showPage 後檢查 | 必用雙重檢查 `requestSeq !== this._xxxRequestSeq \|\| this.currentPage !== pageId` |

---

## 設計原則（v2 補強版）

### 原則 1：Seq 檢查覆蓋所有 async 接續點

**不只是 `await`**、還包括：
- `.then(...)` callback
- Fire-and-forget `this.xxxAsync()`（沒 await 的 async function call）
- Helper 函式內部的 await（若被外層函式 await、需把 seq 傳入 helper）

### 原則 2：State Mutation 延後（v3 修訂：只延後「參與外部 stale 判斷」的 state）

**v3 重大修正**：v2 一律延後所有 state 是**過度保護**、會引入 UX 回歸（閃現舊資料）。v3 只延後有特定條件的 state。

**判斷準則**：
- **延後**：若此 state 被「外部 caller 在 `showXxx` 之後做 stale 判斷」（例如 `app.js:1678` 的 `currentTournament === pending.id`）
- **不延後**：若此 state 只被當前函式或同頁面 UI 互動讀取（例如 `_eduCheckinTeamId` 只被 `confirmEduCheckin` 按鈕讀）
- **反向清空**：若此 state 被 **`navigation.js._renderPageContent` 同步 hook 讀取**（例如 `_eduCurrentTeamId` / `_eduCurrentGroupId`）、必須在 `showPage` **之前**先清 null、避免 hook 用舊值觸發 rerender

**實際分類**（依 Agent 6 審計結果）：

| State | v3 策略 | 理由 |
|-------|---------|------|
| `this.currentTournament` | 延後到 stale check 之後 | 有外部 deep link 檢查（app.js:1678）+ friendly-roster 守衛（L115、L306） |
| `_ucRecordUid` | 保留原位 | 只被同檔 `refreshUserCardRecords` / `_shareUserCard` 讀、都在 await 完成後 |
| `_eduCalendarTeamId` / `_eduCalendarStudentId` | 保留原位 | 只被 `_renderEduCalendarAll` / `changeEduCalendarMonth` 讀、都在 await 完成後；無 navigation hook |
| `_eduCheckinTeamId` / `_eduCheckinGroupId` / `_eduCheckinPlanId` | 保留原位 | 只被 `confirmEduCheckin` 按鈕讀；無 navigation hook |
| `_eduScanTeamId` | 保留原位（無 reader、純形式） | 無 reader、延後與否都無影響 |
| `_ceTeamId` / `_cePlanId` | 保留原位（無 reader、純形式） | 無 reader |
| `_eduCoursePlanEditTeamId` / `_eduCoursePlanEditId` | 保留原位 | 只被 `handleSaveEduCoursePlan` 按鈕讀；無 navigation hook |
| **`_eduCurrentTeamId` / `_eduCurrentGroupId`** | **特殊：進入時清 null + stale check 後寫新值** | **有 navigation.js:781-784 同步 hook！必須反向處理** |

### 原則 2.1（新增）：navigation hook 讀取的 state 要反向清空

```javascript
// 針對 _eduCurrentTeamId / _eduCurrentGroupId（唯一套用此模式）
async showEduStudentList(teamId, groupId) {
  const requestSeq = ++this._eduStudentListRequestSeq;
  // ★ 進入時先清 null：避免 navigation.js:781-784 hook 用上次的舊值
  this._eduCurrentTeamId = null;
  this._eduCurrentGroupId = null;
  await this.showPage('page-edu-students');
  if (requestSeq !== this._eduStudentListRequestSeq || this.currentPage !== 'page-edu-students') {
    return { ok: false, reason: 'stale' };
  }
  // stale check 通過後寫新值
  this._eduCurrentTeamId = teamId;
  this._eduCurrentGroupId = groupId;
  // ...
}
```

### 原則 2.2（新增）：navigation.js:784 改用純同步函式

v3 同步修補 `js/core/navigation.js:784`（本來 fire-and-forget 呼叫 `renderEduStudentList`、無 seq 保護）：

```diff
 if (pageId === 'page-edu-students' && this._eduCurrentTeamId) {
   const gid = this._eduCurrentGroupId;
-  if (gid) this.renderEduStudentList?.(this._eduCurrentTeamId, gid);
+  if (gid) this._renderEduStudentListFromCache?.(this._eduCurrentTeamId, gid);
 }
```

理由：`_renderEduStudentListFromCache`（edu-student-list.js:150 既有函式）是純同步、直接讀 cache 渲染、無 await、無 race 風險。

### 原則 3：Helper 函式必須接受 seq 參數並內部檢查

```javascript
// 外層 entry
async showXxxList(teamId) {
  const requestSeq = ++this._xxxListRequestSeq;
  await this.showPage('page-xxx');
  if (requestSeq !== this._xxxListRequestSeq || this.currentPage !== 'page-xxx') {
    return { ok: false, reason: 'stale' };
  }
  await this._renderXxxList(teamId, requestSeq);  // ← 把 seq 傳進去
}

// Helper
async _renderXxxList(teamId, requestSeq) {
  const data = await this._loadData(teamId);
  // 若呼叫端有傳 seq、檢查；沒傳則跳過（保留被其他地方獨立呼叫的彈性）
  if (requestSeq != null && requestSeq !== this._xxxListRequestSeq) return;
  container.innerHTML = buildHtml(data);
}
```

**補充原則（v3 新增）**：
- **Helper 與對應 entry 共用同一 counter**（不另立新 counter）
- **Helper 內部再呼叫深層 DOM-writing async helper 時**、必須把 `requestSeq` 繼續傳下去（範圍達所有直接或間接寫 DOM 的 async function）
- **純寫快取（不碰 DOM）的深層 helper** 可不傳（例：`_loadEduStudents` 只寫 `_eduStudentsCache`、不寫 DOM、可豁免）

### 原則 4：資源清理

Stale 時若有以下資源、必須清理：
- **相機 / scanner**：`_stopEduScan()` 類函式手動呼叫
- **Pre-write「載入中」DOM**：清空 innerHTML 或改回空字串
- **Timer / interval**：`clearTimeout` / `clearInterval`
- **Event listener**：`removeEventListener`

### 原則 5：`fire-and-forget` async 調用必須改為 await + check

```javascript
// ❌ 原代碼
async showEduCheckin(teamId, planId) {
  await this.showPage('page-edu-checkin');
  this._renderEduCheckinForm(teamId, planId);  // ← async 但沒 await
}

// ✅ v2 修正
async showEduCheckin(teamId, planId) {
  const requestSeq = ++this._eduCheckinRequestSeq;
  await this.showPage('page-edu-checkin');
  if (requestSeq !== this._eduCheckinRequestSeq || this.currentPage !== 'page-edu-checkin') {
    return { ok: false, reason: 'stale' };
  }
  await this._renderEduCheckinForm(teamId, planId, requestSeq);  // ← await + 傳 seq
  return { ok: true };
}
```

---

## 標準修補樣板（v2 定稿）

```javascript
async showXxxDetail(args) {
  // ─── 1. 前置守衛（登入、權限、資料存在性等）────
  if (this._requireLogin()) return;
  if (!validateArgs()) return;

  // ─── 2. 分配 seq（放在所有 state mutation 之前）────
  const requestSeq = ++this._xxxRequestSeq;

  // ─── 3. 資料 / Script / Collection 載入 ────
  const data = await loadSomething();
  if (requestSeq !== this._xxxRequestSeq) return { ok: false, reason: 'stale' };

  // ─── 4. 切頁 + 雙重檢查（seq + currentPage）────
  await this.showPage('page-xxx');
  if (requestSeq !== this._xxxRequestSeq || this.currentPage !== 'page-xxx') {
    // 若有 pre-write DOM 或資源、在此 cleanup
    return { ok: false, reason: 'stale' };
  }

  // ─── 5. state mutation（stale check 之後才寫）────
  this.currentXxx = args.id;

  // ─── 6. DOM 渲染（同步或 await helper 傳 seq）────
  renderSync();
  await this._renderHelper(args, requestSeq);
  if (requestSeq !== this._xxxRequestSeq) return { ok: false, reason: 'stale' };

  // ─── 7. .then chains 內也要 seq ────
  loadAsyncFragment().then(result => {
    if (requestSeq !== this._xxxRequestSeq) return;
    writeDom(result);
  });

  return { ok: true };
}
```

### Counter 變數初始化

每個函式所在檔案的 `Object.assign(App, {...})` block 最上方加入：

```javascript
// tournament-detail.js
Object.assign(App, {
  _tournamentDetailRequestSeq: 0,
  // ... 既有 state ...
  async showTournamentDetail(id, options) { ... },
});
```

```javascript
// profile-core.js
Object.assign(App, {
  _userProfileRequestSeq: 0,
  // ...
});
```

... 共 10 個 counter、散布在對應的 10 個檔案裡、**禁止**集中放 bootstrap。

---

## 逐檔改動細節（v2 完整版）

### #1 tournament-detail.js:6 `showTournamentDetail`

**await 清單**：
- L12 `await ApiService.getTournamentAsync(id)`（快取 miss 時）
- L15 `await this.showPage('page-tournament-detail')`

**完整 diff**：
```diff
+  _tournamentDetailRequestSeq: 0,
+
   async showTournamentDetail(id, options) {
     if (!(options && options.allowGuest) && this._requireLogin()) return;
-    this.currentTournament = id;
+    const requestSeq = ++this._tournamentDetailRequestSeq;
     let t = ApiService.getTournament(id);
     if (!t) {
       t = await ApiService.getTournamentAsync(id);
+      if (requestSeq !== this._tournamentDetailRequestSeq) return { ok: false, reason: 'stale' };
       if (!t) return;
     }
     await this.showPage('page-tournament-detail');
+    if (requestSeq !== this._tournamentDetailRequestSeq || this.currentPage !== 'page-tournament-detail') {
+      return { ok: false, reason: 'stale' };
+    }
+    this.currentTournament = id;   // ← state mutation 延後
     if (!document.getElementById('td-title')) return;
     // ... 既有 DOM 渲染不動 ...
+    return { ok: true };
   }
```

---

### #2 profile-core.js:138 `showUserProfile`（改動最複雜）

**await 清單 + 審計發現的問題**：
- L146 `await ScriptLoader.ensureForPage('page-user-card')`
- L270 `this.showPage('page-user-card')` — **沒 await！**
- L274 `.then(asyncBadgeHtml => {...})` — **stale write 風險**

**完整 diff**：
```diff
+  _userProfileRequestSeq: 0,
+
   async showUserProfile(name, options = {}) {
     if (!options.allowGuest && this._requireProtectedActionLogin(...)) return;
+    const requestSeq = ++this._userProfileRequestSeq;
     const uidHint = options.uid || null;
     await ScriptLoader.ensureForPage('page-user-card');
+    if (requestSeq !== this._userProfileRequestSeq) return { ok: false, reason: 'stale' };
     // ... 既有大量同步 DOM 計算 ...
     document.getElementById('user-card-full').innerHTML = `...`;
     this._bindAvatarFallbacks(...);
+    // 切頁前檢查 seq（避免已 stale 還硬把用戶拉回 user-card）
+    if (requestSeq !== this._userProfileRequestSeq) return { ok: false, reason: 'stale' };
     this._ucRecordUid = targetUid || null;  // ← v3：保留原位置（無 navigation hook、無外部 stale 檢查）
+    await this.showPage('page-user-card');
+    if (requestSeq !== this._userProfileRequestSeq || this.currentPage !== 'page-user-card') {
+      return { ok: false, reason: 'stale' };
+    }

     // .then chain 內補 seq check（避免 stale 徽章寫入）
     if (!isSelf && user && _badgeCacheHit && achievementProfile?.buildEarnedBadgeListHtmlAsync) {
       achievementProfile.buildEarnedBadgeListHtmlAsync({...}).then(asyncBadgeHtml => {
+        if (requestSeq !== this._userProfileRequestSeq) return;
         const badgeContainer = document.getElementById('uc-badge-container');
         if (badgeContainer) badgeContainer.innerHTML = asyncBadgeHtml;
       }).catch(() => {});
     }
     // ...
+    return { ok: true };
   }
```

---

### #3 edu-calendar-core.js:18 `showEduCalendar`（**v3 修正：state 不延後**）

**await 清單**：
- L25 `await this._loadEduStudents(teamId)`（`if (!studentId)` block 內）
- L35 `await this.showPage('page-edu-calendar')`
- L54 `await this._loadEduAttendanceForCalendar(teamId, studentId)`

**v3 完整 diff**（state 保留原位置、不延後）：
```diff
+  _eduCalendarRequestSeq: 0,
+
   async showEduCalendar(teamId, studentId) {
+    const requestSeq = ++this._eduCalendarRequestSeq;
     this._eduCalendarTeamId = teamId;  // ← v3：保留原位置、不延後

     if (!studentId) {
       const curUser = ApiService.getCurrentUser();
       if (curUser) {
         const students = await this._loadEduStudents(teamId);
+        if (requestSeq !== this._eduCalendarRequestSeq) return;
         const myStudent = students.find(...);
         studentId = myStudent ? myStudent.id : null;
       }
     }

     this._eduCalendarStudentId = studentId;  // ← v3：保留原位置、不延後
     await this.showPage('page-edu-calendar');
+    if (requestSeq !== this._eduCalendarRequestSeq || this.currentPage !== 'page-edu-calendar') {
+      return { ok: false, reason: 'stale' };
+    }

     // ... 設標題、日期（同步） ...

     await this._loadEduAttendanceForCalendar(teamId, studentId);
+    if (requestSeq !== this._eduCalendarRequestSeq) return { ok: false, reason: 'stale' };
     this._renderEduCalendarAll();
+    return { ok: true };
   }
```

---

### #4 + #5 共用 seq counter（**v4 重大修正**）

**v4 關鍵發現**：`showEduCheckin`（#4）和 `showEduCheckinScan`（#5）都 `await this.showPage('page-edu-checkin')`、共用同一容器 DOM。兩個入口若各自有獨立 counter，雙重檢查 `currentPage !== 'page-edu-checkin'` 對兩者都通過、仍會 race。

**v4 修正**：
- **合併為單一 counter `_eduCheckinPageRequestSeq`**（替代 v3 的 `_eduCheckinRequestSeq` + `_eduCheckinScanRequestSeq` 雙 counter）
- `showEduCheckin` 和 `showEduCheckinScan` 進入時都 `++this._eduCheckinPageRequestSeq`，後到的會讓先到的 stale
- helper（`_renderEduCheckinForm` / `_loadPlanCheckinStudents` / `_onEduCheckinGroupChange`）接收此單一 counter
- `#5 showEduCheckinScan` 進入時仍然 `try { this._stopEduScan(); } catch(_) {}` 做相機清理

### #4 edu-checkin.js:18 `showEduCheckin` + 3 個 helper（**v4 修訂：共用 counter**）

**問題**：
1. L23 `this._renderEduCheckinForm(teamId, planId)` 無 await（v2 已處理）
2. **v3 新發現**：`_loadPlanCheckinStudents` 和 `_onEduCheckinGroupChange` 也會寫 DOM、v2 漏掉

**v3 完整 diff**：

**外層 `showEduCheckin`**（v4：共用 counter、state 保留原位置）：
```diff
+  _eduCheckinPageRequestSeq: 0,   // ★ v4：batch 與 scan 共用此 counter
+
   async showEduCheckin(teamId, planId) {
+    const requestSeq = ++this._eduCheckinPageRequestSeq;
     this._eduCheckinTeamId = teamId;
     this._eduCheckinGroupId = null;
     this._eduCheckinPlanId = planId || null;
     await this.showPage('page-edu-checkin');
+    if (requestSeq !== this._eduCheckinPageRequestSeq || this.currentPage !== 'page-edu-checkin') {
+      return { ok: false, reason: 'stale' };
+    }
-    this._renderEduCheckinForm(teamId, planId);
+    await this._renderEduCheckinForm(teamId, planId, requestSeq);
+    return { ok: true };
   }
```

**Helper 1 `_renderEduCheckinForm`**（接收 seq）：
```diff
-  async _renderEduCheckinForm(teamId, planId) {
+  async _renderEduCheckinForm(teamId, planId, requestSeq) {
     // ... 同步 DOM 組裝 ...
     if (plan) {
-      await this._loadPlanCheckinStudents();
+      await this._loadPlanCheckinStudents(requestSeq);
+      if (requestSeq != null && requestSeq !== this._eduCheckinRequestSeq) return;
     } else {
       const groups = await this._loadEduGroups(teamId);
+      if (requestSeq != null && requestSeq !== this._eduCheckinRequestSeq) return;
       // ...
     }
   }
```

**Helper 2 `_loadPlanCheckinStudents`**（v3 新增保護）：
```diff
-  async _loadPlanCheckinStudents() {
+  async _loadPlanCheckinStudents(requestSeq) {
     // ...
     const students = await ...;
+    if (requestSeq != null && requestSeq !== this._eduCheckinRequestSeq) return;
     // ... DOM write ...
     const attendRecords = await FirebaseService.queryEduAttendance(...);
+    if (requestSeq != null && requestSeq !== this._eduCheckinRequestSeq) return;
     // ... DOM write ...
   }
```

**Helper 3 `_onEduCheckinGroupChange`**（由 UI onchange 觸發、仍可能 race）：
```diff
-  async _onEduCheckinGroupChange() {
+  async _onEduCheckinGroupChange() {
+    // 由用戶 onchange 觸發、當下 state 應已 up-to-date、本地 snapshot seq 以防萬一
+    const requestSeq = this._eduCheckinRequestSeq;
     const groupId = document.getElementById('edu-ci-group-select')?.value;
     this._eduCheckinGroupId = groupId;
     const students = await this._loadGroupCheckinStudents(...);
+    if (requestSeq !== this._eduCheckinRequestSeq) return;
     // ... DOM write ...
   }
```

---

### #5 edu-checkin-scan.js:16 `showEduCheckinScan`（含相機資源清理）

**問題**：stale 時 `_eduScanner` orphan、相機持續運行。

**v4 完整 diff**（共用 `_eduCheckinPageRequestSeq` + 相機清理雙保險）：
```diff
   async showEduCheckinScan(teamId) {
+    // ★ v4：與 showEduCheckin 共用同一 counter、快速切換時互相 stale
+    const requestSeq = ++this._eduCheckinPageRequestSeq;
+    // 進入時若已有 scanner、先停掉（避免 orphan）
+    if (this._eduScanner) {
+      try { this._stopEduScan(); } catch (_) {}
+    }
     this._eduScanTeamId = teamId;
     await this.showPage('page-edu-checkin');
+    if (requestSeq !== this._eduCheckinPageRequestSeq || this.currentPage !== 'page-edu-checkin') {
+      // Stale 時若已開啟 scanner、再次停掉
+      if (this._eduScanner) { try { this._stopEduScan(); } catch (_) {} }
+      return { ok: false, reason: 'stale' };
+    }

     const container = document.getElementById('edu-checkin-container');
     if (!container) return;
     // ... DOM 組裝（同步） ...
     this._startEduScan(teamId);
+    return { ok: true };
   }
```

**注意**：`_eduCheckinPageRequestSeq` 只在 #4 `showEduCheckin` 檔案初始化一次（見上方 diff）、#5 不重複宣告。

**額外建議（非 Blocker、列入測試備註）**：`_onEduScanSuccess(teamId, ...)` callback 開頭加 `if (this._eduScanTeamId !== teamId) return;` 防止舊 scanner 遲到 callback。本次先不做、下輪再說。

---

### #6 edu-course-enrollment-render.js:13 `showCourseEnrollmentList` + `_renderCourseEnrollmentList`

**問題**：pre-write「載入中」DOM + helper 內部 race。

**v3 完整 diff**（外層、**移除 pre-write cleanup**、state 保留原位置）：
```diff
+  _eduCourseEnrollmentRequestSeq: 0,
+
   async showCourseEnrollmentList(teamId, planId) {
+    const requestSeq = ++this._eduCourseEnrollmentRequestSeq;
     this._ceTeamId = teamId;  // ← v3：保留原位置
     this._cePlanId = planId;
     const listEl = document.getElementById('edu-ce-list');
     if (listEl) listEl.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text-muted)">載入中...</div>';
     await this.showPage('page-edu-course-enrollment');
+    if (requestSeq !== this._eduCourseEnrollmentRequestSeq || this.currentPage !== 'page-edu-course-enrollment') {
+      // v3：不清空 DOM、保留「載入中」讓用戶若返回此頁仍看到載入提示
+      return { ok: false, reason: 'stale' };
+    }

     // ... plan title / subtitle（同步） ...

-    await this._renderCourseEnrollmentList(teamId, planId);
+    await this._renderCourseEnrollmentList(teamId, planId, requestSeq);
+    return { ok: true };
   }
```

**Helper `_renderCourseEnrollmentList`**：
```diff
-  async _renderCourseEnrollmentList(teamId, planId) {
+  async _renderCourseEnrollmentList(teamId, planId, requestSeq) {
     const container = document.getElementById('edu-ce-list');
     if (!container) return;
     const enrollments = await this._loadCourseEnrollments(teamId, planId);
+    if (requestSeq != null && requestSeq !== this._eduCourseEnrollmentRequestSeq) return;
     // ...
     try {
       const attendRecords = await FirebaseService.queryEduAttendance({ teamId, coursePlanId: planId });
+      if (requestSeq != null && requestSeq !== this._eduCourseEnrollmentRequestSeq) return;
       // ...
     } catch (_) {}
     // ...
     container.innerHTML = html;
   }
```

---

### #7 edu-course-plan.js:32 `showEduCoursePlanForm`（**v3 修正：state 不延後**）

**await 清單**：
- L37 `await this.showPage('page-edu-course-plan')`
- L42 `await this._loadEduGroups(teamId)`

**v3 完整 diff**（state 保留原位置）：
```diff
+  _eduCoursePlanRequestSeq: 0,
+
   async showEduCoursePlanForm(teamId, planId) {
+    const requestSeq = ++this._eduCoursePlanRequestSeq;
     this._eduCoursePlanEditTeamId = teamId;  // ← v3：保留原位置
     this._eduCoursePlanEditId = planId || null;
     await this.showPage('page-edu-course-plan');
+    if (requestSeq !== this._eduCoursePlanRequestSeq || this.currentPage !== 'page-edu-course-plan') {
+      return { ok: false, reason: 'stale' };
+    }

     const container = document.getElementById('edu-course-plan-page');
     if (!container) return;

     const groups = await this._loadEduGroups(teamId);
+    if (requestSeq !== this._eduCoursePlanRequestSeq) return { ok: false, reason: 'stale' };
     const plan = planId ? (this.getEduCoursePlans(teamId).find(p => p.id === planId) || null) : null;
     // ... 同步 innerHTML ...
+    return { ok: true };
   }
```

---

### #8 edu-student-list.js:27 `showEduStudentList` + `renderEduStudentList`（**v3 關鍵修正：清 null 處理**）

**問題**：
1. Helper 內部 await 後 DOM write 無守衛（v2 已處理）
2. **v3 新發現**：`navigation.js:781-784` 同步讀 `_eduCurrentTeamId`/`_eduCurrentGroupId`、若舊值殘留會用錯 teamId 觸發 rerender

**v3 完整 diff**（外層、**進入時清 null**）：
```diff
+  _eduStudentListRequestSeq: 0,
+
   async showEduStudentList(teamId, groupId) {
+    const requestSeq = ++this._eduStudentListRequestSeq;
+    // ★ 進入時先清 null：避免 navigation.js:781-784 hook 用上次進入的舊 teamId/groupId
+    this._eduCurrentTeamId = null;
+    this._eduCurrentGroupId = null;
     await this.showPage('page-edu-students');
+    if (requestSeq !== this._eduStudentListRequestSeq || this.currentPage !== 'page-edu-students') {
+      return { ok: false, reason: 'stale' };
+    }
+    // stale check 通過後、寫新值（navigation hook 之後讀到的會是新值）
+    this._eduCurrentGroupId = groupId;
+    this._eduCurrentTeamId = teamId;

     const titleEl = document.getElementById('edu-students-title');
     if (groupId === '__unmatched__') {
       if (titleEl) titleEl.textContent = '待審核名單';
       this._renderUnmatchedStudentList(teamId);
       return { ok: true };
     }
     // ... title 設定（同步） ...

-    await this.renderEduStudentList(teamId, groupId);
+    await this.renderEduStudentList(teamId, groupId, requestSeq);
+    return { ok: true };
   }
```

**Helper `renderEduStudentList`**：
```diff
-  async renderEduStudentList(teamId, groupId) {
+  async renderEduStudentList(teamId, groupId, requestSeq) {
     // ...
     const allStudents = await this._loadEduStudents(teamId);
+    if (requestSeq != null && requestSeq !== this._eduStudentListRequestSeq) return;
     // ... DOM write ...
     container.innerHTML = html;
   }
```

**navigation.js 外部修補（v3 新增）**：
```diff
   if (pageId === 'page-edu-students' && this._eduCurrentTeamId) {
     const gid = this._eduCurrentGroupId;
-    if (gid) this.renderEduStudentList?.(this._eduCurrentTeamId, gid);
+    // v3: 改用純同步 cache render、無 race 風險
+    if (gid) this._renderEduStudentListFromCache?.(this._eduCurrentTeamId, gid);
   }
```

---

### #9 edu-student-join.js:14 `showEduStudentApply`

**完整 diff**：
```diff
+  _eduStudentApplyRequestSeq: 0,
+
   async showEduStudentApply(teamId) {
+    const requestSeq = ++this._eduStudentApplyRequestSeq;
     await this.showPage('page-edu-student-apply');
+    if (requestSeq !== this._eduStudentApplyRequestSeq || this.currentPage !== 'page-edu-student-apply') {
+      return { ok: false, reason: 'stale' };
+    }

     // ... title + team-id 設定（同步） ...

     const curUser = ApiService.getCurrentUser();
     const students = await this._loadEduStudents(teamId);
+    if (requestSeq !== this._eduStudentApplyRequestSeq) return { ok: false, reason: 'stale' };
     // ...
+    return { ok: true };
   }
```

---

### #10 shop.js:40 `showShopDetail`

**完整 diff**（最簡單）：
```diff
+  _shopDetailRequestSeq: 0,
+
   async showShopDetail(id) {
     const s = ApiService.getShopItem(id);
     if (!s) return;
+    const requestSeq = ++this._shopDetailRequestSeq;
     await this.showPage('page-shop-detail');
+    if (requestSeq !== this._shopDetailRequestSeq || this.currentPage !== 'page-shop-detail') {
+      return { ok: false, reason: 'stale' };
+    }
     if (!document.getElementById('shop-detail-title')) return;
     // ... 既有 DOM 渲染不動 ...
+    return { ok: true };
   }
```

---

## v4 新增：觀測性補強（P5）

**Debug-mode log**：所有 stale return 前加此檢查（**加在原則 1 的模板裡**）：

```javascript
if (requestSeq !== this._xxxRequestSeq || this.currentPage !== 'page-xxx') {
  // v4: 新增 debug log（?debug=1 或 localStorage._raceLog 觸發）
  if (window._raceDebug || (typeof localStorage !== 'undefined' && localStorage.getItem('_raceLog'))) {
    console.log('[race-skip]', {
      fn: 'showXxx',
      seq: requestSeq,
      latest: this._xxxRequestSeq,
      currentPage: this.currentPage,
      expectedPage: 'page-xxx',
    });
  }
  return { ok: false, reason: 'stale' };
}
```

好處：
- 用戶回報「又被拉回舊頁」時、請他開 `localStorage.setItem('_raceLog','1')` 重現、console 會吐確鑿證據
- Playwright 測試可 `page.on('console', ...)` 斷言 stale skip 真的觸發
- 正常用戶無感（需明確啟用才 log）

## v4 新增：Helper Caller Fallback 清單（P7）

以下 caller **無需修改**、靠 helper 內 `if (requestSeq != null && ...)` fallback 接住：

| Caller | 檔案:行 | 理由 |
|--------|---------|------|
| `_debouncedCheckinLoad` | edu-checkin.js:12 | debounce wrapper、不涉及 race |
| `_debouncedCheckinGroup` | edu-checkin.js:13 | 同上 |
| `confirmEduCheckin` 成功後重整 | edu-checkin.js:284-286 | 用戶按鈕觸發、當下 state 已就位 |
| `_approveCourseEnrollment` | edu-course-enrollment.js:186 | 審核按鈕觸發、不切頁 |
| `_rejectCourseEnrollment` | edu-course-enrollment.js:201 | 同上 |
| `_toggleEnrollPaid` | edu-course-enrollment.js:229 | 同上 |
| `_editEnrollPaidDate` | edu-course-enrollment.js:276 | 同上 |
| `_approveFromList` | edu-student-list.js:270 | 審核按鈕觸發 |
| `_rejectFromList` | edu-student-list.js:281 | 同上 |
| `_removeStudentFromGroup` | edu-student-list.js:323 | 同上 |
| `handleSaveEduStudent` | edu-student-form.js:151 | 表單儲存觸發 |
| `_assignStudentToGroup` | edu-student-form.js:291 | 同上 |
| `handleEduStudentApply` | edu-student-join.js:196 | 同上 |

**實作者注意**：這 13 處**不要動**。v4 的新簽名（多一個可選 `requestSeq` 參數）向後相容、舊 caller 傳 2 個參數仍正常運作。

## 分批 Commit 策略（v4 修訂、新增 P2/P3/P4）

### Commit A（一級 2 個）
- `tournament-detail.js`（#1）+ `profile-core.js`（#2）
- 包含 debug log、counter 初始化
- **版本號**：跑 `node scripts/bump-version.js` 一次（v4 強制、P2）
- **Push 後觀察 24 小時**、確認 tournament / profile 新行為無回歸

### Commit B（教育模組整批、**原子性邊界寫死、P3**）

**必須同 commit**、任何拆分都會無聲失效：
- `edu-calendar-core.js`（#3）
- `edu-checkin.js`（#4 entry + `_renderEduCheckinForm` + `_loadPlanCheckinStudents` + `_onEduCheckinGroupChange`）
- `edu-checkin-scan.js`（#5、共用 counter）
- `edu-course-enrollment-render.js`（#6 + `_renderCourseEnrollmentList`）
- `edu-course-plan.js`（#7）
- `edu-student-list.js`（#8 + `renderEduStudentList`）
- `edu-student-join.js`（#9）
- **`js/core/navigation.js:782-785` 那一行外部修補**（改用 `_renderEduStudentListFromCache`）

**版本號**：跑 `node scripts/bump-version.js` 一次（P2）

**A→B 部署 deadline（P4）**：
- **A push 後 72 小時內 B 必須 push**、否則整批 revert A
- 理由：tournament/profile 已修、教育模組沒修、會造成跨模組行為不一致

### Commit C（shop、低風險補強）
- `shop.js`（#10）
- **版本號**：跑 `node scripts/bump-version.js` 一次（P2）
- **建議 B → C 間隔 ≥ 30 分鐘**（避免用戶連續兩次被 `var V` 觸發清快取、UX 擾動）

### 絕對禁止事項

- ❌ 3 個 commit 共用一個版本號（違反 CLAUDE.md、SW 不會更新）
- ❌ B 拆成多個 commit（尤其 navigation.js 那一行不可單獨拆、會無聲失效）
- ❌ A push 後放著超過 72 小時不 push B（跨模組不一致視為 regression、應整批 revert）

### Hot Fix 決策樹

若 prod 出現 bug、依範圍決策：

| Bug 範圍 | 決策 | 動作 |
|---------|------|------|
| 單點明確（如 #5 相機清理錯誤） | **Hot fix** | 寫新 commit 修單點、bump version、push |
| 範圍不明 / 多用戶受影響 | **快速 revert** | `git revert <batch-commit>` + bump version + push（3 分鐘恢復） |
| 邊緣路徑、難重現 | **加 log 觀察** | 不 revert、push 純 log commit 收集證據、一週後決定 |

---

## 測試計畫

### 自動化（必跑）
- `npm run test:unit`（2381 tests 全綠）

### 人工煙霧測試（共 13 個函式 × 3 情境 = 約 40 min）

**基本情境（每個入口）**：
1. 點進去 → 立刻點返回 → 等 3 秒 → **預期不被拉回**
2. 點進去 → 切 tab → 等 3 秒 → 同上
3. 網速慢（DevTools Slow 3G）下重測 1、2

**特殊情境**：
- **#2 showUserProfile**：點名片 A → 馬上點名片 B → 等 3 秒 → 徽章應是 B 的、不是 A
- **#5 showEduCheckinScan**：點進掃碼頁 → 切走 → 檢查手機相機指示燈關閉
- **#6 showCourseEnrollmentList**：點方案名單 → 立刻切走 → 等 3 秒 → 回此頁 → 不應看到「載入中」永停
- **#4/#8 有 helper 的**：快速連點同一入口（不同 id）3 次、應只生效最後一次

### 單元測試（可選、下一輪）
目前無計畫補、race condition 本身難以用 Jest 精確模擬。

---

## 風險與回退

| 風險 | 可能性 | 影響 | 緩解 |
|------|--------|------|------|
| Counter 未初始化 → undefined 比較失效 | 低 | 中 | 各 counter 統一初始為 `0`、`++` 後至少 `1`、不會和 `undefined` 相等 |
| Helper 函式的 requestSeq 參數遺漏傳遞 | 中 | 低-中 | Helper 設 `requestSeq != null` 檢查、沒傳則跳過（向後相容） |
| 相機清理 `_stopEduScan()` 失敗拋錯 | 低 | 低 | 已包 try-catch |
| 誤改既有 control flow | 低 | 中 | v2 明列每個檔 full diff、code review 逐行對照 |
| `.then()` callback 改動影響既有徽章顯示 | 低 | 低 | 新增 seq check 只在 stale 時跳過、正常流程不變 |

### 回退

- 依 Commit A/B/C 分三批、獨立 `git revert` 可回退
- 若只想退 helper 改動：單獨 revert 內層函式的 diff（保留外層 seq）

---

## 預估工時

- Counter 初始化 + 10 入口改動：30 min
- 3 helper 改動：15 min
- 特殊處理（#2 `.then`、#5 相機、#6 pre-write cleanup）：15 min
- 本地煙霧測試：40 min
- Unit tests + commit + push：10 min
- **總計：約 1 小時 50 分鐘**

---

## 決策點（v2 已決定）

| 問題 | v2 決定 |
|------|---------|
| Counter 放哪 | 各檔 `Object.assign(App, {...})` 最上方、禁止集中 |
| Stale 時是否 log | 不加（噪音）、需要 debug 時再臨時加 |
| 教育模組 7 個是否全做 | 全做、且含 3 個 helper |
| 傳統 vs friendly tournament seq 是否共用 | 不共用（friendly 用既有 `_friendlyTournamentDetailSeq`、legacy 用新的 `_tournamentDetailRequestSeq`） |
| #4/#5/#10 是否降級跳過 | 不降級、做（一致性重要、一次補齊） |
| Counter 命名後綴 | 統一 `RequestSeq`、不用 `Seq` |
| 既有 `_friendlyTournamentDetailSeq` 是否改名對齊 | 保留不改（動到鎖定區邊緣、非必要） |

---

## v4 新增：CLAUDE.md Regression Safeguard（P6）

**實作同時需要在 `CLAUDE.md` 末端加入以下章節**：

```markdown
## 新增 async `show*` 函式必做 Checklist（race condition 防禦）

每次新增 `async showXxxDetail` / `showXxxList` 類函式時：

- [ ] 在同檔 `Object.assign(App, {...})` 最上方加 `_xxxRequestSeq: 0,`
- [ ] 函式開頭分配：`const requestSeq = ++this._xxxRequestSeq;`
- [ ] 每個 `await` 後做**雙重檢查**：
      `if (requestSeq !== this._xxxRequestSeq || this.currentPage !== 'page-xxx') return { ok: false, reason: 'stale' };`
- [ ] Stale 前加 debug log（`?debug=1` 或 `localStorage._raceLog` 觸發）
- [ ] 若 helper 內部有 `await` + DOM write、把 `requestSeq` 傳進去做同樣檢查
- [ ] 若 `.then()` chain 寫 DOM、seq check 放在 callback 開頭
- [ ] 若持有資源（相機 / timer / listener）、stale 時必清理
- [ ] 若同一個 page 有多個入口（例：`page-edu-checkin` 有 batch + scan）、入口間**共用同一 counter**（避免雙重檢查失效）

參考模板：`js/modules/event/event-detail.js:219` `showEventDetail` 或 `docs/page-race-fix-plan.md`
```

## 審計認可摘要（3 輪 10 位專家）

### 第一輪（v1 → v2）

| 審計面向 | 審計 Agent | v2 處理狀態 |
|---------|----------|---------|
| 正確性 + 邊界情境 | Agent 1 | ✅ 所有 Blocker（B1-B4）已納入 v2 |
| 一致性 + pattern 對齊 | Agent 2 | ✅ 6 項命名/格式已統一（C1-C6） |
| 副作用 + 資源清理 | Agent 3 | ✅ 相機清理（B5）、DOM cleanup（B6）、state delay 已補（**v3 部分修正**） |
| 架構 + 替代方案 | Agent 4 | ✅ 確認 Pattern B 是正確選擇、避免短期重構既有鎖定函式 |

### 第二輪（v2 → v3）— 專找影響正常功能的中重度瑕疵

| 審計面向 | 審計 Agent | v3 處理狀態 |
|---------|----------|---------|
| 回歸風險（v2 改動本身造成的回歸） | Agent 5 | ✅ R1（state 延後過度）+ R3（pre-write cleanup 反效果）已修 |
| 跨模組 state 污染 | Agent 6 | ✅ R2（showEduStudentList 清 null 模式）已加入 |
| Helper caller 相容性 + 深層 race | Agent 7 | ✅ R4（navigation.js:784）+ R5（深層 DOM helper）已補 |

**所有 7 位專家意見皆已納入 v3、確認可以實作**。

### v3 相對 v2 的關鍵修正

| 項 | v2 | v3 |
|---|----|----|
| State mutation 策略 | 一律延後 | **分類處理**：只有 `currentTournament` 延後；`_eduCurrentTeamId/GroupId` 清 null + 後寫；其他保留原位置 |
| `showEduStudentList` | 延後寫 state | **進入時清 null**（避免 navigation hook 用舊值） |
| `#6 pre-write cleanup` | stale 時清空 DOM | **移除**（保留「載入中」） |
| `navigation.js:784` | 未處理 | 改用 `_renderEduStudentListFromCache`（純同步） |
| `_loadPlanCheckinStudents` / `_onEduCheckinGroupChange` | 未保護 | **補入 seq 保護**（Helper 2、Helper 3） |

### 第三輪（v3 → v4）— 專找實作可行性 / 測試 / 部署的陷阱

| 審計面向 | 審計 Agent | v4 處理狀態 |
|---------|----------|---------|
| 實作可行性（diff 對齊、行號、edge case） | Agent 8 | ✅ P1（共用容器問題）已修 + P7（fallback 清單）已加 |
| 測試策略（race 可驗證性） | Agent 9 | ✅ P5（debug log）已加 + P6（CLAUDE.md checklist）已加 |
| 部署風險（分批 commit 陷阱） | Agent 10 | ✅ P2-P4（版號、原子性、deadline、hot fix）已加 |

### v4 相對 v3 的關鍵修正

| 項 | v3 | v4 |
|---|----|----|
| `showEduCheckin` + `showEduCheckinScan` counter | 各自獨立 | **共用 `_eduCheckinPageRequestSeq`**（避免雙重檢查失效） |
| Stale 時的觀測性 | 無 log | **Debug-mode log**（`?debug=1` 觸發） |
| 版號 bump 規則 | 未明文 | **明文**：A/B/C 各 bump 一次 |
| Commit B 原子性 | 未明文 | **明文**：navigation.js:784 與教育 7+3+2 必須同 commit |
| A→B 部署 deadline | 未規定 | **明文**：72 小時內、否則整批 revert |
| Hot fix 路徑 | 未規定 | **明文決策樹**：單點 / 整批 revert / log 觀察 |
| Helper caller 修改範圍 | 不清 | **明文**：13 處 caller 不需改、靠 fallback |
| CLAUDE.md regression safeguard | 無 | **加 show* checklist**（防未來復發） |

### 實作前最終確認

- ✅ 不動既有 3 個已保護函式（鎖定區邊緣）
- ✅ 不動 Firestore Rules / Cloud Functions
- ✅ 不影響其他 admin 頁（全部走核心路由已保護）
- ✅ 回歸風險逐項審核、state 分類邏輯有具體依據
- ✅ navigation.js 只改 1 行、用 existing 函式、無新風險
- ✅ `page-edu-checkin` 共用容器問題已修（P1、共用 counter）
- ✅ 有觀測性手段（debug log）可驗證 race 真被攔截
- ✅ 有長期防禦（CLAUDE.md checklist）防止未來復發
- ✅ 部署策略明文、分批風險可控

**結論：v4 可實作**。

## 預估工時（v4 更新）

- Counter 初始化 + 10 入口改動：30 min
- 3 helper + 2 deep helper 改動：20 min
- #4/#5 共用 counter 調整：5 min
- `.then` callback、相機清理、`#8` 清 null：10 min
- Debug log 加入：10 min
- navigation.js:784 修補：2 min
- CLAUDE.md checklist 加入：5 min
- Unit tests（2381 全綠驗證）：5 min
- 本地煙霧測試（含 #4/#5 共用容器、快速切俱樂部）：50 min
- 分 3 批 commit + push（各 bump version + 等 CF Pages）：15 min
- **總計：約 2 小時 30 分鐘**
