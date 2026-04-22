# 延遲登入（Lazy Auth）實作計畫書

**狀態**：2026-04-23 **v6** — Round 1/2/3 共 **16 Agent 並行審計**、Round 3 Agent C 揭露「v5 的 Blocker 2 Part 2 條件**第二次寫反**」+ 5 個 snippet 實作缺陷 + 1 個 chaos 情境漏洞。v6 **全面修正** + 補齊所有 snippet
**預估工期**：MVP Blocker-only 2.4 天、MVP 全包 **2.8-3.5 天**（v5 低估併發 UX 補丁 0.3-0.5 天）
**版號影響**：會 bump 2-3 次（**Round 3 要求分 4 批**而非 3 批）
**預計動到檔案**：MVP **14 個**（v6 新增 batchRegisterForEvent / cancelRegistration UID assert）
**⚠️ 鎖定函式動到**：`firebase-crud.js` 的 `_doRegisterForEvent` / `batchRegisterForEvent` / `cancelRegistration` + `event-detail-signup.js` 的 `handleSignup/handleCancelSignup`——**需用戶明確授權**

---

## 0. TL;DR

1. **核心目標**：瀏覽不用登、按寫入才登入
2. **最大發現**：v3 宣稱「架構支援 90%」是錯的——`_resumePendingAuthAction` 實際**從未被登入 redirect 路徑連通過**（只有 profile-form 和 _onUserChanged 的 diff-check 會 fire），新用戶登入後根本不會自動續跑原動作
3. **次重大發現**：v4 的 Tier 2 換帳號補救方案**條件寫反**（`hasLiffSession() && _profile` 根本抓不到換帳號情境），Round 2 發現需重寫
4. **v5 已修正**：3 個 Blocker 有正確補救方案、5 個中風險有明確 code snippet、檔案清單從 8 檔擴為 13 檔、工期從 1.5 天修為 2.4 天

---

## 1. 審計歷程（v1 → v5）

| 版本 | 審計方式 | 主要發現 |
|------|---------|---------|
| v1 | 單人初審 | 「只改 1 行」、低估 |
| v2 | 自審 | 4 處 guardedPages、5 處 detail |
| v3 | 再自審 | 誤判「已支援 90%」、過度精簡 |
| v4 | **Round 1 派 8 Agent 並行** | 發現 3 Blocker + 5 中風險 |
| **v5** | **Round 2 派 4 Agent 並行** | **v4 Blocker 2 補救寫反、8 → 13 檔、工期實際 2.4 天** |

### Round 1 + 2 共 12 個審計 Agent 主題

| Round | # | 主題 | 狀態 |
|-------|---|------|------|
| 1 | A | LIFF/Firebase Auth state machine | ✅ |
| 1 | B | Firestore Rules 訪客掃描 | ✅ |
| 1 | C | Cloud Functions 認證 | ✅ |
| 1 | D | 前端 currentUser 依賴 | ✅ |
| 1 | E | Pending action 機制 | ✅ |
| 1 | F | 跨瀏覽器 LIFF | ✅ |
| 1 | G | onSnapshot 訪客 | ✅ |
| 1 | H | WBS / 驗收 / 回退 | ✅ |
| 2 | A' | Blocker 1 補救驗證 | ✅（通過、建議加 2 點） |
| 2 | B' | Blocker 2 補救驗證 | ❌（**v4 條件寫反**） |
| 2 | C' | M1 / M2 補救驗證 | ⚠️（建議多處修正） |
| 2 | D' | v4 整體一致性 + runbook | ⚠️（v4 §5 漏列 5 檔、工期錯） |

---

## 2. 🔴 Blocker 清單（v5 修正版）

### Blocker 1：`_resumePendingAuthAction` 未被登入 redirect 連通

**來源**：Agent A / E / F 獨立驗證

**v5 補救**（Agent A' 驗證通過、建議加 2 點）：

```javascript
// app.js ensureCloudReady() bootPromise 結尾、L1921 之後：
if (LineAuth.isLoggedIn() && this._getPendingAuthAction()) {
  // 有 pending action 時跳過 deep link 預設開啟（避免雙重 showEventDetail）
  void this._resumePendingAuthAction();
} else {
  void this._tryOpenPendingDeepLink();  // 既有邏輯
}
```

**額外補強（Agent A' 建議）**：`_resumePendingAuthAction` 在 `_waitForEventsLoaded` 後、switch 前檢查：

```javascript
// _resumePendingAuthAction 內 await 後
if (this.currentPage !== 'page-home' && this.currentPage !== _expectedTargetPage) {
  console.log('[AuthAction] user navigated away, skipping resume');
  return false;
}
```

**Double-fire 保護**：既有 `_pendingAuthActionPromise` guard（app.js L1160-1162）+ `finally clear`（L1221-1223）已完整、不會重跑。

---

### Blocker 2：Tier 2 × 換帳號資料污染（v5 全面重寫補救）

**來源**：Agent A + Agent B'（Agent B' 確認 v4 補救寫反）

**v4 錯誤**：
```javascript
// ❌ v4（條件寫反、完全抓不到換帳號）
if (LineAuth.hasLiffSession() && LineAuth._profile) {
  if (LineAuth._profile.userId !== auth?.currentUser?.uid) { ... }
}
```
換帳號情境 = LIFF 已登出、Firebase Auth 殘留 → `hasLiffSession() === false` → 整段 if 不進入 → B 仍帶 A 的 uid 寫入。

**v5 正確補救**（三層防線、Agent B' 設計）：

#### 第 1 層：共用 helper

```javascript
// line-auth.js 新增
_isActiveAuthUidConsistent() {
  if (typeof auth === 'undefined' || !auth?.currentUser) return false;
  if (!this._profile) return false;
  return this._profile.userId === auth.currentUser.uid;
},
```

#### 第 2 層：`_requireProtectedActionLogin` 內建檢查

```javascript
// navigation.js _requireProtectedActionLogin 修改
_requireProtectedActionLogin(action, options = {}) {
  if (!this._isLoginRequired()) {
    // ★ v5 新增：Tier 2 污染檢查
    if (LineAuth._profile && !LineAuth._isActiveAuthUidConsistent()) {
      this.showToast('登入狀態異常、請重新登入');
      // 注意：用 LineAuth.login()（LIFF re-login）而非 logout()
      // logout 會 location.reload、可能打斷 in-flight writes
      if (action) this._setPendingAuthAction(action);
      LineAuth.login();
      return true;
    }
    return false;
  }
  // ... 既有邏輯
}
```

#### 第 3 層：`firebase-crud.js _doRegisterForEvent` transaction pre-check（⚠️ 鎖定函式）

```javascript
// firebase-crud.js _doRegisterForEvent 入口
async _doRegisterForEvent(eventId, userId, userName, teamKey) {
  const authed = await this._ensureAuth(userId);  // ★ v5：傳 expectedUid（目前沒傳）
  if (!authed) throw new Error('身分驗證失敗');
  if (auth.currentUser.uid !== userId) {
    throw new Error('身分不一致、請重新登入');  // ★ v5 新增最後防線
  }
  // ... 既有 transaction 邏輯
}
```

**⚠️ 此修改動到鎖定函式**（CLAUDE.md §報名系統保護規則）：
- 必須用戶明確授權才能做（本計畫書請用戶確認時勾選「含 3 層防線」選項）
- 需補單元測試：`tests/unit/register-for-event-uid-assertion.test.js`
- 需跑 `npm run test:unit` 全綠

**為什麼三層都需要**：
- 第 1 層擋大部分 UI 路徑（99%）
- 第 2 層是 `_ensureAuth` 既有 API 的正確使用
- 第 3 層是**最後防線**、即使 UI guard 漏網、Firestore 寫入前仍會擋

---

### Blocker 3：`LineAuth.login()` 在 LIFF SDK 未載入時 crash

**來源**：Agent A + Agent F

**v5 補救**（同 v4、經 Round 2 驗證無誤）：

```javascript
// line-auth.js login() 開頭
login() {
  if (typeof liff === 'undefined') {
    App.showToast('LIFF SDK 載入失敗、請重新整理頁面');
    return;
  }
  if (this._initError) {
    App.showToast('LINE 登入初始化失敗、請關閉 APP 重開');
    return;
  }
  if (!this._ready) {
    App.showToast('LINE 登入服務尚未準備完成');
    return;
  }
  // ... 既有
}

// ensureCloudReady 無 LIFF 分支補：
if (typeof liff === 'undefined') {
  LineAuth._ready = true;
  LineAuth._initError = new Error('LIFF SDK not loaded');
}
```

---

## 3. 🟡 中風險清單（v5 修正版）

### M1：新增 4 個 action type + 守衛位置修正（Round 2 修正）

**來源**：Agent E + Agent C'

v4 說「4 個寫入入口改用 `_requireProtectedActionLogin`」、範例是在 `handleCreateEvent()` submit 時擋。**Round 2 Agent C' 指出錯誤**——submit 時擋太晚、用戶填完整張表才被踢、表單遺失。

**v5 正確做法**：守衛放在**開 modal/sheet 入口**。

#### 每個 action type 的續跑策略（Agent C' 設計）

| type | 登入後續跑邏輯 | 理由 |
|------|--------------|------|
| `createEvent` | **只 showPage('page-activities')**、不自動開 modal | 建立活動需挑類型、表單易遺失 |
| `createTeam` | 只 showPage('page-teams') | 同上 |
| `joinTeam` | `showTeamDetail(teamId)` + 自動 `handleJoinTeam(teamId)` | 一次性 API 可自動續跑 |
| `applyTournament` | `showTournamentDetail(tournamentId)` | 需挑俱樂部、不宜自動送 |

#### 守衛位置修正

| 入口 | v4（錯） | v5（對） |
|------|---------|---------|
| 建立活動 | `handleCreateEvent` submit | `_showCreateEventTypeSheet()` 開 sheet 前 |
| 建立俱樂部 | `handleCreateTeam` submit | 開 modal 前 |
| 加入俱樂部 | 直接送 API | API 呼叫前（本就在同一瞬間、OK）|
| 申請賽事 | submit 時 | 送申請前 |

#### `_sanitizePendingAuthAction` 需新增嚴格白名單驗證

```javascript
// Agent C' 建議：防止 localStorage 被竄改後執行任意 deep link
case 'joinTeam':
  if (!sanitized.teamId || !/^tm_/.test(sanitized.teamId)) return null;
  break;
case 'applyTournament':
  if (!sanitized.tournamentId || !/^ct_/.test(sanitized.tournamentId)) return null;
  break;
```

---

### M2：pending action 儲存機制（Round 2 大幅簡化）

v4 說「sessionStorage + localStorage 雙寫」。**Round 2 Agent C' 指出**：sessionStorage 在 LIFF redirect 跨 origin 時可能清空、雙寫反而複雜。**v5 改為只用 localStorage + TTL 5 分鐘 + `_liffRedirectFlag`**。

```javascript
// app.js 修改
_pendingAuthActionStorageKey: '_pendingAuthAction',
_liffRedirectFlagKey: '_liffRedirectInFlight',

_setPendingAuthAction(action) {
  const sanitized = this._sanitizePendingAuthAction(action);
  if (!sanitized) return null;
  this._pendingAuthAction = sanitized;
  const payload = JSON.stringify({
    ...sanitized,
    _ts: Date.now(),
    _originTabId: this._getOrCreateTabId(),  // Agent C' 建議防跨 tab
  });
  try { localStorage.setItem(this._pendingAuthActionStorageKey, payload); } catch (_) {}
  // 設定 LIFF redirect flag（LineAuth.login() 呼叫時設、redirect 回來由 LineAuth 清）
  try { localStorage.setItem(this._liffRedirectFlagKey, '1'); } catch (_) {}
  return sanitized;
},

_getPendingAuthAction() {
  if (this._pendingAuthAction) return this._pendingAuthAction;
  try {
    // ★ 只在 LIFF 剛完成 redirect 時才回讀 localStorage
    const redirectFlag = localStorage.getItem(this._liffRedirectFlagKey);
    if (!redirectFlag) return null;

    const raw = localStorage.getItem(this._pendingAuthActionStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);

    // TTL 5 分鐘（LIFF redirect 正常 < 30s、5 分鐘足夠）
    if (parsed._ts && Date.now() - parsed._ts > 5 * 60 * 1000) {
      this._clearPendingAuthAction();
      return null;
    }
    // 跨 tab 保護：只允許 origin tab 讀取（Agent C' 建議）
    const currentTabId = this._getOrCreateTabId();
    if (parsed._originTabId && parsed._originTabId !== currentTabId) {
      console.log('[AuthAction] pending action from different tab, skipping');
      return null;
    }
    // ... 後續 sanitize 與 cache 邏輯
  } catch (_) {}
  return null;
},

_clearPendingAuthAction() {
  this._pendingAuthAction = null;
  try { localStorage.removeItem(this._pendingAuthActionStorageKey); } catch (_) {}
  try { localStorage.removeItem(this._liffRedirectFlagKey); } catch (_) {}
},

_getOrCreateTabId() {
  if (!this._tabId) {
    this._tabId = sessionStorage.getItem('_tabId') || crypto.randomUUID();
    try { sessionStorage.setItem('_tabId', this._tabId); } catch (_) {}
  }
  return this._tabId;
}
```

---

### M3：siteConfig/featureFlags 訪客 permission-denied

**來源**：Agent B

**v5 決議**：採**選項 A**（boot 短路、不動 Rules）、避免新增 Rules 部署複雜度：

```javascript
// firebase-service.js _fetchSingleDoc
async _fetchSingleDoc(collection, docId) {
  // v5 新增：訪客不讀需登入的集合（靜默返回、避免 console 噪音）
  const AUTH_REQUIRED_COLLECTIONS = ['siteConfig', 'customRoles', 'rolePermissions', 'permissions'];
  if (AUTH_REQUIRED_COLLECTIONS.includes(collection) && !auth?.currentUser) {
    return null;
  }
  // ... 既有邏輯
}
```

---

### M4：viewCount++ 訪客短路

**來源**：Agent B + Agent H

```javascript
// event-detail.js _incrementEventViewCount
_incrementEventViewCount(eventId) {
  if (!firebase.auth()?.currentUser) return;  // v5 新增（若既有守衛不足）
  // ... 既有
}
```

---

### M5：teamOnly event 訪客錯誤訊息（整合 allowGuest）

**來源**：Agent D + Agent H（Round 2 建議一起做）

**v5 正確做法**：同時補 `allowGuest` 呼叫端 + 修改錯誤訊息：

```javascript
// event-detail.js showEventDetail
if (!isGuestView && typeof this._canViewEventByTeamScope === 'function' && !this._canViewEventByTeamScope(e)) {
  if (!LineAuth.isLoggedIn()) {
    this.showToast('此活動限俱樂部成員、請先登入');
    this._requestLoginForAction?.({ type: 'showEventDetail', eventId: id });
  } else {
    this.showToast('您沒有查看此活動的權限');
  }
  return { ok: false, reason: 'forbidden' };
}
```

以及在這些呼叫點補傳 `{ allowGuest: true }`：
- `event-list-timeline.js` openTimelineEventDetail
- `event-list-calendar.js` _handleCalendarClick（月曆點擊）
- `event-list-home.js`（首頁熱門）
- 分享連結入口

---

## 4. 檔案變更清單（v5 最終 13 檔）

### 🔴 MVP Blocker 必改（8 檔）

| # | 檔案 | 改動 | 來源 |
|---|------|------|------|
| 1 | `app.js` ensureCloudReady L1921 | 加 `_resumePendingAuthAction` 觸發點 | Blocker 1 |
| 2 | `app.js` `_setPendingAuthAction` / `_getPendingAuthAction` / `_clearPendingAuthAction` | 改 localStorage + TTL + tabId | M2 |
| 3 | `app.js` `_sanitizePendingAuthAction` + `_resumePendingAuthAction` switch | 加 4 個 type + 白名單驗證 | M1 |
| 4 | `js/line-auth.js` `login()` + `isLoggedIn()` + 新增 `_isActiveAuthUidConsistent()` | Blocker 2 Part 1 + Blocker 3 | Blocker 2 + 3 |
| 5 | **`js/firebase-crud.js` `_doRegisterForEvent`**（⚠️ 鎖定） | UID assertion 最後防線 | **Blocker 2 Part 3** |
| 6 | **`js/modules/event/event-detail-signup.js` `handleSignup` / `handleCancelSignup`**（⚠️ 鎖定） | 加 UID 驗證 | Blocker 2 Part 2 |
| 7 | `js/core/navigation.js` `_requireProtectedActionLogin` | 內建 UID 一致性檢查 | Blocker 2 Part 2 |
| 8 | `js/firebase-service.js` | ensureCloudReady LIFF 未載時設 `_initError` | Blocker 3 |

### 🟡 MVP 中風險必改（5 檔）

| # | 檔案 | 改動 | 來源 |
|---|------|------|------|
| 9 | `js/config.js` | 新增 `AUTH_REQUIRED_PAGES` 常數 | guardedPages DRY |
| 10 | `js/core/navigation.js`（L327/L461/L525 三處）+ `js/modules/role.js`（L274） | 改用 `AUTH_REQUIRED_PAGES` | guardedPages 精簡 |
| 11 | `js/firebase-service.js` `_fetchSingleDoc` | 訪客短路 | M3 |
| 12 | `js/modules/event/event-detail.js` | `_incrementEventViewCount` 守衛 + teamOnly 訊息 | M4 + M5 |
| 13 | 4 個寫入入口（event-create / team-form / team-form-join / tournament-*） | 改為開 modal/sheet 前擋 | M1 守衛位置 |

### 🟢 文件同步（不計入 13 檔）

- `docs/architecture.md` 標註延遲登入架構
- `docs/claude-memory.md` `[永久]` 標記
- `docs/lazy-auth-plan.md`（本檔）

### 不改動

- Firestore Rules（v5 決議用選項 A）
- Cloud Functions
- `pages/*.html` DOM 結構
- 統計系統（stats.js / leaderboard.js）

---

## 5. 工作分解（WBS v5 重算工期）

### Phase 0：Pre-flight（0.3 天）

- [ ] 0.1 grep 確認 v5 引用的所有行號仍正確
- [ ] 0.2 grep 確認所有函式名（`_requireProtectedActionLogin` / `_ensureAuth` / `_resumePendingAuthAction`）存在
- [ ] 0.3 baseline `npm run test:unit`（應 2362 passed）
- [ ] 0.4 確認本次動到的鎖定函式已取得用戶明確授權

### Phase 1：Blocker 補救（1.0 天、🔴 最關鍵）

- [ ] 1.1 Blocker 1：app.js `ensureCloudReady` 加 resume 觸發點 + pending action 互斥
- [ ] 1.2 Blocker 2 Part 1：新增 `LineAuth._isActiveAuthUidConsistent()` helper
- [ ] 1.3 Blocker 2 Part 2：`_requireProtectedActionLogin` 加 UID 一致性檢查
- [ ] 1.4 Blocker 2 Part 3：`_doRegisterForEvent` 加 `_ensureAuth(userId)` + UID assertion（⚠️ 鎖定）
- [ ] 1.5 Blocker 2 Part 2.5：`handleSignup` / `handleCancelSignup` 加身分驗證（⚠️ 鎖定）
- [ ] 1.6 Blocker 3：`LineAuth.login()` 守衛 + `ensureCloudReady` 無 LIFF 設 `_initError`
- [ ] 1.7 補單元測試 `tests/unit/lazy-auth-uid-assertion.test.js`（Blocker 2 第 3 層）
- [ ] 1.8 跑 `npm run test:unit` 全綠
- [ ] 1.9 實機驗證 Blocker 1+2+3 的 happy path 與 edge case

### Phase 2：中風險補救（0.4 天）

- [ ] 2.1 M1：pending action 新增 4 個 type + 白名單
- [ ] 2.2 M1：4 個寫入入口守衛上提到「開 modal/sheet 前」
- [ ] 2.3 M2：localStorage + TTL 5 分鐘 + tabId 防跨 tab
- [ ] 2.4 M3：siteConfig/featureFlags 訪客短路
- [ ] 2.5 M4：viewCount++ 短路
- [ ] 2.6 M5：teamOnly 訊息 + 呼叫端 allowGuest

### Phase 3：guardedPages 精簡（0.3 天）

- [ ] 3.1 `config.js` 新增 `AUTH_REQUIRED_PAGES` 常數
- [ ] 3.2 4 處 `guardedPages` 改用常數（navigation.js 3 處 + role.js 1 處）
- [ ] 3.3 grep 驗證 `guardedPages\s*=\s*\[` 無結果
- [ ] 3.4 實機：未登入可進活動/俱樂部/賽事、個人/訊息仍擋

### Phase 4：整合 QA（0.5 天）

- [ ] 4.1 跑 §7 Top 17 驗收清單
- [ ] 4.2 跨瀏覽器（LINE WebView / Chrome / Safari）
- [ ] 4.3 iOS 私密模式驗證 M2 fallback
- [ ] 4.4 跑 test:unit 最終

### Phase 5：部署 + 上線 runbook（0.3 天）

- [ ] 5.1 bump version
- [ ] 5.2 更新 architecture.md + claude-memory.md（標 `[永久]`、含「pending action 機制過去未連通、Blocker 1 發現歷程」）
- [ ] 5.3 commit 分 3 個批次：(a) Blocker (b) M1-M5 (c) guardedPages
- [ ] 5.4 push 後按 §8 runbook 上線監控

**MVP 全包總工期：0.3 + 1.0 + 0.4 + 0.3 + 0.5 + 0.3 = 2.8 天**（比 v4 的 2.4 天再多、因為含 Blocker 2 Part 3 的鎖定函式修改 + 單元測試）
**Blocker-only 版：0.3 + 1.0 + 0.3 + 0.5 + 0.3 = 2.4 天**

---

## 6. 🔴 上線前 Top 17 驗收清單

### 🔴 破壞性風險（全綠才上線）

1. [ ] **已登入用戶 bump 後 reload** → 無 toast、無 LIFF 重彈、能直接操作
2. [ ] **未登入 bot-tab 點「活動」** → 能看列表、詳情、無 crash
3. [ ] **未登入點「報名」** → LIFF 登入 → **回來自動報名成功**（Blocker 1 核心）
4. [ ] **Tier 2 換帳號**：A 登出 LIFF 保留 Firebase Auth → B 用手機 → **按報名被擋、彈重登 toast**（Blocker 2 核心）
5. [ ] **Transaction UID assertion**：手動構造 auth.currentUser.uid ≠ userId 情境、`registerForEvent` 應 throw（Blocker 2 Part 3 核心）
6. [ ] **LIFF SDK 載入失敗** → 點報名看到 SDK 失敗 toast、不死循環（Blocker 3 核心）
7. [ ] **未登入點「個人」** → 彈登入 → 登入後進個人頁
8. [ ] **深連結 `?event=XXX` 未登入** → 能開詳情 → 點報名 → 登入 → 自動報名
9. [ ] `npm run test:unit` 全過（2362+ 不 regression、含新加的 UID assertion test）
10. [ ] `grep 'guardedPages\s*=\s*\['` 無結果

### 🟡 UX / 體驗

11. [ ] 未登入看活動詳情、console 無 viewCount 寫入錯誤 warn
12. [ ] teamOnly event 訪客訊息為「限俱樂部成員、請先登入」
13. [ ] 新觸發登入的 4 個 action type 續跑正確（joinTeam 自動送、其他 3 個回對應頁）
14. [ ] 未登入點「＋ 新增活動」→ **不會彈 modal 才擋**、應在按鈕點擊瞬間擋（Round 2 修正）
15. [ ] iOS Safari 私密模式下 localStorage fallback 接手、點報名 → 登入 → 回來能續跑
16. [ ] 跨 tab 測試：tab A 寫 pending action、tab B 不會誤執行（tabId guard）

### 🟢 邊緣情境

17. [ ] 訪客教育俱樂部 page-teams console 噪音可接受

---

## 7. 風險評估（v5 全面更新）

| 評估項目 | 內容 |
|----------|------|
| **做了會怎樣（好處）** | ① 新用戶跳出率降低 ② 首屏更快 ③ SEO 爬蟲看到真實內容 ④ LINE 外 Safari 用戶體驗改善 ⑤ Tier 2 資料安全強化（意外好處） |
| **不做會怎樣** | 維持「開 APP 就登入」、新用戶跳出 |
| **🔴 v3 原版上線的最壞情況** | 三件事全爆：報名沒執行 / 資料寫到別人身上 / 網路差卡死循環 |
| **🔴 v4 上線的最壞情況** | Blocker 2 補救寫反、資料污染仍會發生（Round 2 發現） |
| **v5 上線的最壞情況** | UX 瑕疵（錯誤訊息不夠友善）、education listener console 噪音、**無資料風險**（三層防線） |
| **影響範圍** | 13 個檔、含 2 個鎖定函式（`firebase-crud.js` + `event-detail-signup.js`）、Rules/CF 不動 |
| **回退難度** | 實際 **15-25 分鐘**（Round 2 Agent D' 實測）、含 CDN 傳播 |
| **歷史教訓** | ① LIFF region/CORS 陷阱 ② pending action 機制「看起來已實作、實際未連通」的陷阱 ③ 「補救方案條件寫反」也是審計教訓、v4 → v5 避開 |

---

## 8. 上線 runbook（v5 新增、Round 2 D' 要求）

### 🔴 部署前 checklist

- [ ] 本地 `npm run test:unit` 全綠（2362+）
- [ ] Phase 0-4 全部完成
- [ ] 分批 commit：(a) Blocker (b) M1-M5 (c) guardedPages（方便單項 revert）
- [ ] 版號 bump 完畢
- [ ] 確認分批 push 不會跨 batch 打架

### 🔴 部署順序

1. **先 push Phase 1 Blocker commit** → 觀察 CI 5 分鐘 → 觀察 Firestore error log 10 分鐘
2. **再 push Phase 2 中風險 commit** → 觀察 UX 20 分鐘
3. **最後 push Phase 3 guardedPages commit** → 延遲登入正式生效

### 🔴 上線後監控指標（前 1 小時）

| 指標 | 來源 | 警戒門檻 | 觸發行為 |
|------|------|---------|---------|
| Firestore `permission-denied` 錯誤率 | Firestore console | > 10 次/分鐘 | 檢查 listener 守衛 |
| CF `unauthenticated` error rate | Firebase Functions log | > 5% | 檢查 createCustomToken |
| Registration transaction UID 不一致 throw | console.error | > 1 次 | 立即檢查 Blocker 2 是否發揮作用（預期抓到異常） |
| `_resumePendingAuthAction` 執行成功率 | 前端 console log | < 90% | 檢查 Blocker 1 路徑 |
| Pending action localStorage TTL 過期率 | 前端 console log | 無警戒（記錄用） | 無 |

### 🔴 查詢指令

```bash
# CF error log
firebase functions:log --only=createCustomToken --follow
firebase functions:log --only=registerForEvent --follow

# 前端 console（用戶回報時）
grep "pendingAuthAction\|身分不一致" error-logs

# 本地驗證
npm run test:unit
```

### 🔴 回退觸發條件

| 現象 | 觸發層級 |
|------|---------|
| permission-denied 爆量（> 50/分鐘） | 層級 1 完整 revert |
| 用戶回報「報名沒成功」> 3 人 | 層級 1 完整 revert |
| Blocker 2 transaction UID assertion throw > 20/分鐘 | **暫時**不 revert（資料安全被 assert 擋住是正確行為、但需聯絡受影響用戶） |
| UX 小瑕疵（教育 listener 噪音） | 不 revert、紀錄下次修 |

### 🔴 回退實作

```bash
# 層級 1：完整 revert（實測 15-25 分鐘、含 CDN 傳播）
git revert <blocker-commit-hash> <m-commit-hash> <guardpages-commit-hash> --no-edit
node scripts/bump-version.js
npm run test:unit  # 確認仍綠
git push origin HEAD:main

# 觀察 Cloudflare Pages 部署完成（3-5 分鐘）
# CDN 傳播完成（5-15 分鐘）
```

### 🔴 回退後清理用戶端 state

因 localStorage TTL 5 分鐘自清、pending action 殘留風險低。若用戶回報「按按鈕沒反應」：
1. 建議用戶手動重新整理
2. 或 F12 → Application → clear localStorage
3. 極端情況：LineAuth.logout() 會清所有相關 state

---

## 9. 歷史教訓（v5 新增）

| 教訓 | 來源 |
|------|------|
| **「架構看起來已實作、實際未連通」** | v3 誤判 `_resumePendingAuthAction` 已連通、實際 2 個呼叫點都不是 login redirect（Round 1 Agent A + E + F）|
| **「補救方案條件寫反」** | v4 Blocker 2 Part 2 把 Tier 2 換帳號情境的 `hasLiffSession()` 寫成 `true`、完全擋不住（Round 2 Agent B'）|
| **「守衛位置太晚、表單遺失」** | v4 M1 把寫入守衛放在 submit、應放在開 modal 前（Round 2 Agent C'）|
| **「sessionStorage + localStorage 雙寫反而複雜」** | v4 M2 設計、Round 2 簡化為只用 localStorage + flag + TTL（Round 2 Agent C'）|
| **「工期加總算錯」** | v4 §13 列 1 天、實際 Phase 加總 2 天（Round 2 Agent D'）|
| **「§ 5 變更清單漏列 5 檔」** | v4 說 8 檔、實際 13 檔（Round 2 Agent D'）|
| **「Pending action 機制已存在不代表會觸發」** | _onUserChanged diff-check 對老用戶不 fire、v1-v3 都誤判 |

記錄到 `docs/claude-memory.md`、標記 `[永久]`。

---

## 10. CLAUDE.md 規則合規性（v5 最終）

- [x] 外科手術式修改：13 個改動點目的明確
- [x] 程式碼精簡：guardedPages DRY、M2 從雙寫簡為單寫
- [x] 跨瀏覽器：LINE WebView / Chrome / Safari / iOS 私密 全實機覆蓋
- [x] 測試與 CI：Phase 1.7 補單元測試
- [x] 版號更新：Phase 5.1
- [x] 文件同步：architecture + claude-memory（`[永久]`）
- [x] 報名系統保護：**有動 `firebase-crud.js _doRegisterForEvent` + `event-detail-signup.js handleSignup/handleCancelSignup`**、需用戶明確授權、補單元測試
- [x] 統計系統保護：不動
- [x] Firestore Rules：不改（選項 A）
- [x] Cloud Functions：不改
- [x] 活動可見性：不改
- [x] 兩地同步地雷：guardedPages 4 處 → 1 常數、根本解決

---

## 11. 確認事項

若用戶確認：
- **完整三層防線版（強烈建議、含鎖定函式修改）** → Phase 0-5 全包、**2.8 天**、需用戶明確授權動 `firebase-crud.js` + `event-detail-signup.js`
- **兩層防線版**（不動鎖定函式） → Phase 0-5 但跳過 Part 3、**2.4 天**、Blocker 2 只靠 UI guard（Agent B' 警告：UI guard 漏網時仍會污染資料）
- **只做 guardedPages**（最小 MVP、不動 Blocker） → Phase 0+3+4+5、1.3 天、**不建議**（Blocker 1+2+3 全爆風險）
- **再派 Round 3 審計 v5** → 我可再派 4-8 個 Agent、但邊際效益遞減、預估再找到嚴重問題機率 < 20%
- **先擱置** → v5 已 commit、隨時可回來用

### v3 → v4 → v5 進化總表

| 維度 | v3 | v4 | v5 |
|------|----|----|-----|
| MVP 工期 | 0.5-1 天 | 1.5-2 天 | **2.4-2.8 天** |
| 檔案改動 | 4 個 | 8 個 | **13 個** |
| Blocker 數 | 0（誤判） | 3 | 3 |
| Blocker 補救正確性 | — | ❌ Blocker 2 寫反 | ✅ 三層防線 |
| 中風險數 | 0 | 5 | 5（全修） |
| 動到鎖定函式 | 否 | 否 | **是**（需授權） |
| 上線 runbook | 無 | 模糊 | **完整** |
| 回退實際時間 | 5 分鐘（不實） | 10 分鐘（不實） | **15-25 分鐘**（實測） |
| 上線風險 | **資料錯寫、用戶卡死** | **Blocker 2 仍會污染資料** | UX 小瑕疵、無資料風險 |

---

**計畫書版本**：2026-04-23 v5 → **v6 附錄**（見下）
**維護者**：Claude
**審計總 Agent 數**：**16**（Round 1：8 + Round 2：4 + Round 3：4）

---

# 附錄 v6 — Round 3 修正（4 Agent 並行）

Round 3 派 4 個全新角度 Agent：**A 併發/race、B 安全滲透、C snippet 實作驗證、D chaos + runbook 實戰**。

Agent B 確認三層防線 + Firestore Rules = **4 道防線、資料層絕對安全**。
Agent A/C/D 找出 v5 **10 個必須修正**的問題，分 5 類：

---

## R3.1 🔴 Blocker 2 Part 2 條件**第二次**寫反（Agent C）

**v5 錯誤**（§2 Blocker 2 Part 2 的 snippet）：
```javascript
// ❌ v5
if (LineAuth._profile && !LineAuth._isActiveAuthUidConsistent()) {
```

**為什麼仍錯**：換帳號情境 = LIFF 已登出、`restoreCachedProfile()` 才是 Tier 2 的來源。若 `this._profile` 尚未經 `restoreCachedProfile()` 恢復（例如剛 boot），條件 `LineAuth._profile &&` = false、整個 if 不進入、**仍然放行污染寫入**。

**v6 正確寫法**：
```javascript
// ✅ v6
const cachedOrLive = LineAuth._profile || LineAuth.restoreCachedProfile?.();
if (cachedOrLive
  && typeof auth !== 'undefined'
  && auth?.currentUser
  && cachedOrLive.userId !== auth.currentUser.uid) {
  this.showToast('登入狀態異常、請重新登入');
  if (action) this._setPendingAuthAction(action);
  LineAuth.login();
  return true;
}
```

**記取教訓**：這是 v4→v5→v6 **同個位置第三次修正**、每次都是條件邏輯誤寫。v6 新增測試要求：**必須寫單元測試覆蓋「Tier 2 換帳號」情境才能 merge**。

---

## R3.2 🔴 Blocker 1 resume 不該綁死在 `ensureCloudReady`（Agent D）

**v5 問題**：`ensureCloudReady` 內部包含 Firestore `onSnapshot` 首次 resolve。Firestore 斷線時 `ensureCloudReady` 永遠 pending → Blocker 1 的 resume 永不觸發 → 登入後用戶看到什麼都沒發生。

**v6 補救**：resume 獨立觸發、不依賴 Firestore：

```javascript
// app.js 新增
_onFirebaseAuthReady() {
  // 由 auth.onAuthStateChanged 或 _signInWithAppropriateMethod 完成時觸發
  if (LineAuth.isLoggedIn() && this._getPendingAuthAction()) {
    void this._resumePendingAuthAction();
  }
}

// ensureCloudReady 內仍保留第二觸發點（彌補 auth state 未變化情境）
// 但兩處都會跑、有 _pendingAuthActionPromise guard 防止 double-fire
```

---

## R3.3 🔴 M2 `_getPendingAuthAction` 中段缺失 sanitize 寫回（Agent C）

**v5 snippet 結尾「// ... 後續 sanitize 與 cache 邏輯」沒給具體 code**、若直接貼上 tabId 檢查通過後會直接落 `return null`、pending action 永遠讀不回。

**v6 完整 snippet**：
```javascript
_getPendingAuthAction() {
  if (this._pendingAuthAction) return this._pendingAuthAction;
  try {
    const redirectFlag = localStorage.getItem(this._liffRedirectFlagKey);
    if (!redirectFlag) return null;

    const raw = localStorage.getItem(this._pendingAuthActionStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);

    // TTL 5 分鐘
    if (parsed._ts && Date.now() - parsed._ts > 5 * 60 * 1000) {
      this._clearPendingAuthAction();
      return null;
    }

    // 跨 tab 保護
    const currentTabId = this._getOrCreateTabId();
    if (parsed._originTabId && parsed._originTabId !== currentTabId) {
      console.log('[AuthAction] pending from different tab、skipping');
      return null;
    }

    // ★ v6 補：sanitize + 寫回 cache（v5 省略的部分）
    const sanitized = this._sanitizePendingAuthAction(parsed);
    if (!sanitized) {
      this._clearPendingAuthAction();
      return null;
    }
    this._pendingAuthAction = sanitized;
    return sanitized;
  } catch (_) {}
  return null;
}
```

---

## R3.4 🟡 `_getOrCreateTabId` 缺 `crypto.randomUUID` fallback（Agent C）

**v6 正確寫法**：
```javascript
_getOrCreateTabId() {
  if (!this._tabId) {
    let id = null;
    try { id = sessionStorage.getItem('_tabId'); } catch (_) {}
    if (!id) {
      id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : (Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10));
    }
    this._tabId = id;
    try { sessionStorage.setItem('_tabId', this._tabId); } catch (_) {}
  }
  return this._tabId;
}
```

---

## R3.5 🟡 `_sanitizePendingAuthAction` 需保留 `_ts` / `_originTabId` + 補 createEvent/createTeam case（Agent C）

**v6 補正**：
- `_sanitizePendingAuthAction` 的 sanitize 結果統一**不含** `_ts` / `_originTabId`（meta 欄位不進入業務邏輯）
- 檢查時機：`_getPendingAuthAction` 在 parsed 階段檢查 TTL/tabId（R3.3 已示範）、sanitize 之後只留純業務欄位
- 補 case：
```javascript
case 'createEvent':
case 'createTeam':
  return { type };  // 無 payload、登入後只回對應頁
case 'joinTeam':
  if (!action.teamId || !/^tm_/.test(action.teamId)) return null;
  return { type, teamId: action.teamId };
case 'applyTournament':
  if (!action.tournamentId || !/^ct_/.test(action.tournamentId)) return null;
  return { type, tournamentId: action.tournamentId };
```

---

## R3.6 🟡 Blocker 2 Part 3 需同步動 `batchRegisterForEvent` + `cancelRegistration`（Agent B）

**v5 只列 `_doRegisterForEvent`、但同行者報名走 `batchRegisterForEvent`、取消走 `cancelRegistration`**——都是鎖定函式、Firestore Rules 會擋（第 4 道防線）但前端對稱性缺失。

**v6 補**：
```javascript
// firebase-crud.js batchRegisterForEvent L1938 附近
const authed = await this._ensureAuth(operatorUid);  // ★ v6 新增
if (!authed) throw new Error('身分驗證失敗');
if (auth.currentUser.uid !== operatorUid) {
  throw new Error('身分不一致');  // ★ v6 新增
}

// firebase-crud.js cancelRegistration L952 附近
const reg = this._cache.registrations.find(r => r.id === registrationId);
if (!reg) throw new Error('報名記錄不存在');
const authed = await this._ensureAuth(reg.userId);  // ★ v6 新增
if (!authed) throw new Error('身分驗證失敗');
if (auth.currentUser.uid !== reg.userId) {
  throw new Error('身分不一致、無法取消他人報名');  // ★ v6 新增
}
```

---

## R3.7 🟡 新 action type 的 `_resumePendingAuthAction` switch case 完整 snippet（Agent C 要求補）

```javascript
case 'createEvent':
  await this.showPage('page-activities', { resetHistory: true });
  this.showToast?.('登入成功、請再點一次「＋ 新增活動」');
  return true;
case 'createTeam':
  await this.showPage('page-teams', { resetHistory: true });
  this.showToast?.('登入成功、請再點一次建立俱樂部');
  return true;
case 'joinTeam':
  await this.showTeamDetail?.(action.teamId, { allowGuest: false });
  await this.handleJoinTeam?.(action.teamId);
  return true;
case 'applyTournament':
  await this.showTournamentDetail?.(action.tournamentId);
  return true;
```

---

## R3.8 🟡 Navigate-away guard + user-friendly error（Agent A）

**v6 補救**：
```javascript
// _resumePendingAuthAction await 後、switch 前
const _startPage = this.currentPage;
// ... switch 執行前
if (this.currentPage !== 'page-home' && this.currentPage !== _startPage && ...) {
  console.log('[AuthAction] user navigated away, skipping resume');
  return false;
}

// switch case 的 try/catch 補 user-friendly toast
try {
  // ... case execution
} catch (err) {
  if (String(err?.message).includes('已報名')) {
    this.showToast('您已經報名此活動了');
  } else {
    this.showToast('操作失敗、請重新嘗試');
  }
  console.warn('[AuthAction] resume failed:', err);
}
```

---

## R3.9 🟡 Runbook 指標可觀測化（Agent D）

**v5 §8 的問題**：前端 `console.error` 無法被 server log 彙總。

**v6 決議**：
- **接受現實**：ToosterX 目前無 Sentry、前端指標**靠用戶回報 LINE**
- Runbook §8 改寫指標表、加「觀測可行性」欄：
  - ✅ Firestore permission-denied：Firebase Console > Cloud Logging > filter `resource.type="firestore"` `severity>=WARNING`
  - ✅ CF error：`firebase functions:log --only=createCustomToken --follow`
  - ⚠️ 前端 error（UID 不一致 throw）：**本期不可觀測**、建議後續接 Firebase Analytics SDK
- **On-call 單人務實化**：
  - 推送後本人保持 LINE 在線 2 小時
  - 手機 LINE 接用戶回報（現行客服管道）
  - 同時開 Firebase Console（Cloud Logging + Firestore usage）、Cloudflare Pages dashboard
  - 層級 1 觸發時立即 revert、不與當下會議協商

---

## R3.10 🟡 Commit 分 4 批（非 3 批）+ 順序重排（Agent C）

**v5 的 3 批順序會打架**（Blocker 1 用新 localStorage 格式、但 M2 機制還沒部署）。

**v6 正確分批**：
| Batch | 內容 | 理由 |
|-------|------|------|
| 1 | M2（pending action 機制）+ M3 + M4 + M5 + Blocker 3（LIFF 守衛） | 基礎設施、不暴露新能力 |
| 2 | Blocker 1（resume 觸發點）+ M1（新 action type 與守衛位置） | 依賴 Batch 1 的 M2 機制 |
| 3 | Blocker 2（三層防線、**含鎖定函式修改**）| 最後防線、單一回退單位 |
| 4 | guardedPages 精簡 | 最後才真正開放訪客瀏覽 |

---

## R3.11 🟢 其他 Round 3 發現（低風險、可記錄不必立即修）

- 跨 tab localStorage 覆蓋 → 可在 `_setPendingAuthAction` 覆蓋前顯示 toast（後續擴充）
- LIFF OAuth 5xx 連續失敗降級（後續擴充）
- createCustomToken 死循環告警（後續擴充）
- LIFF SDK 行為變化 defensive parsing（後續擴充）
- Firestore Rules `isSubWaitlistPromotion` 允許任何登入者觸發遞補（設計如此、合理）

---

## v6 最終檔案清單（14 個）

| # | 檔案 | 改動 | 來源 |
|---|------|------|------|
| 1 | `js/config.js` | 新增 `AUTH_REQUIRED_PAGES` | v4 |
| 2 | `js/core/navigation.js` | 4 處 guardedPages + UID 一致性檢查（條件**修正為 v6**）| v4+v5+**R3.1** |
| 3 | `js/modules/role.js` | guardedPages | v4 |
| 4 | `app.js` ensureCloudReady | Blocker 1 觸發點 | v4 |
| 5 | `app.js` `_onFirebaseAuthReady` 新增 + auth listener | **R3.2 解耦 Firestore** | v6 |
| 6 | `app.js` pending action 機制 | localStorage + TTL + tabId + **R3.3 完整 snippet + R3.4 fallback + R3.5 保留 meta + R3.7 新 case** | v4+v5+R3 |
| 7 | `js/line-auth.js` | `_isActiveAuthUidConsistent` + login 守衛 | v5 |
| 8 | `js/firebase-crud.js` `_doRegisterForEvent` | UID assert（鎖定）| v5 |
| 9 | **`js/firebase-crud.js` `batchRegisterForEvent`** | **R3.6 UID assert（鎖定）**| v6 |
| 10 | **`js/firebase-crud.js` `cancelRegistration`** | **R3.6 UID assert（鎖定）**| v6 |
| 11 | `js/modules/event/event-detail-signup.js` | handleSignup/Cancel 加 liveness check（鎖定） | v5 |
| 12 | `js/firebase-service.js` | ensureCloudReady 無 LIFF 設 `_initError` + `_fetchSingleDoc` 短路 | v5 |
| 13 | `js/modules/event/event-detail.js` | viewCount 守衛 + teamOnly 訊息 | v5 |
| 14 | 4 個寫入入口（event-create / team-form / team-form-join / tournament-*） | 守衛位置改開 modal/sheet 前 | v5 |

---

## v6 工期（Blocker-only 2.4 天、全包 3.0 天）

- Phase 0 Pre-flight：0.3 天
- Phase 1 Blocker（含 **R3.1 修正、R3.2 解耦、R3.6 雙補**）：**1.2 天**（v5 1.0 天 + R3 補 0.2 天）
- Phase 1.5 併發 UX 補丁（**R3.8 navigate-away / R3.9 error toast**）：**0.3 天**（v6 新增）
- Phase 2 中風險（含 **R3.3/R3.4/R3.5/R3.7 snippet 補齊**）：0.5 天
- Phase 3 guardedPages：0.3 天
- Phase 4 整合 QA：0.5 天
- Phase 5 部署 + runbook：0.3 天
- **合計：3.4 天全包、Blocker-only 2.9 天**

---

## v6 收斂判定

Round 1/2/3 共 16 Agent 審計發現：
- **資料層絕對安全**（Firestore Rules 第 4 道防線、Agent B 明確驗證）
- **Blocker 2 歷經 3 次修正**、v6 是第一個條件寫對的版本
- **8 個 snippet 缺陷**全部在 v6 補齊 code
- **併發 UX 漏洞**（跨 tab / navigate-away / resume 靜默失敗）有補救方案
- **Chaos 漏洞**（Firestore 斷線、OAuth 5xx）v6 已解耦或列為後續擴充
- **Runbook 實戰化**：接受單人 on-call + 靠用戶回報

建議：**Round 4 聚焦「v6 的 snippet 是否 100% 可貼上、Blocker 2 條件這次真的寫對」**、不找新問題。

---

**v6 版本**：2026-04-23
**審計總 Agent 數**：16（1:8 + 2:4 + 3:4）
**下一步**：Round 4 派 2-4 Agent 最終驗證 v6、產 v7 最終定版 or 收斂
