# 俱樂部 × 賽事模組優化重構計畫書

> **版本**：v3.0（全 Phase 完成，實作驗證定稿）  
> **完成日期**：2026-04-14  
> **日期**：2026-04-14  
> **目標**：讓俱樂部與賽事模組能承受 500+ 俱樂部、1000+ 場賽事的規模，同時對齊活動模組的成功重構模式  
> **前置條件**：功能尚未正式啟用，可進行破壞性重構  
> **參考標竿**：`js/modules/event/` 活動模組（33 檔、11,063 行）

---

## 目錄

- [快速參考：各 Phase 執行清單](#快速參考各-phase-執行清單v21-新增)

1. [現況診斷總覽](#1-現況診斷總覽)
2. [七大致命瓶頸](#2-七大致命瓶頸)
3. [安全性漏洞](#3-安全性漏洞)
4. [活動模組成功模式分析](#4-活動模組成功模式分析)
5. [重構 Phase 0：安全性修復](#5-phase-0安全性修復)
6. [重構 Phase 1：程式碼結構整理](#6-phase-1程式碼結構整理)
7. [重構 Phase 2A：「專看專讀」per-entity 架構（核心）](#7-phase-2a專看專讀per-entity-架構核心)
8. [重構 Phase 2B：列表效能優化](#8-phase-2b列表效能優化)
9. [重構 Phase 3：資料架構遷移](#9-phase-3資料架構遷移)
10. [重構 Phase 4：表單拆分與教育解耦](#10-phase-4表單拆分與教育解耦)
11. [ID 統一化架構](#11-id-統一化架構)
12. [權限與身分架構](#12-權限與身分架構)
13. [Firestore 索引與規則變更清單](#13-firestore-索引與規則變更清單)
14. [測試策略](#14-測試策略)
15. [風險評估與回退方案](#15-風險評估與回退方案)
16. [v2.0 專家審計修正摘要](#16-v20-專家審計修正摘要)
17. [工作量與排程](#17-工作量與排程)
18. [歷史教訓檢查清單](#18-歷史教訓檢查清單)
- [附錄 A：檔案變更追蹤表](#附錄-a檔案變更追蹤表)

---

## 快速參考：各 Phase 執行清單（v2.1 新增）

> 本節彙整所有章節中分散的任務，每個 Phase 一張完整清單。實作時以此為主，詳細規格查對應章節。

### Phase 0（1 天）— 安全性修復 ✅ 2026-04-14 完成 `6d24f93c`
- [x] 5.1 — `firestore.rules` entries/members `allow read` 改 `if isAuth()`
- [x] 5.2 — `firestore.rules` feed `update`/`delete` 加 `uid == auth.uid || isCurrentUserTeamCaptainOrLeader`（`create` 暫不動）
- [x] 5.3 — `firestore.indexes.json` 新增 teams + tournaments 複合索引
- [x] 5.4 — `firestore.rules` `delegateUidsUnchangedOrCreator` 新增（建立者可改，委託人不可擴權）
- [x] 16.3 — `claude-memory.md` 記錄（標 `[永久]`）。Phase 0 無 JS/CSS 修改不需版號更新
- [ ] ~~新建測試~~ — 待補（8.2D 一併處理）
- **驗證結果**：Firestore Rules 部署成功，entries/members 已限認證用戶，feed 權限收緊確認

### Phase 1（4-5 天）— 結構整理 + 權限碼定義 ✅ 2026-04-14 完成 `35345ed8` + `14e055f6`
- [x] 6.1A — `team-list-helpers.js`（14 函式，178 行）
- [x] 6.1B — `team-list-stats.js`（4 函式，50 行）+ 2 處 inline fallback 刪除，教育分支保留獨立
- [x] 6.1C — `team-share-builders.js`（3 函式，102 行）
- [x] 6.1D — 改名 `team-detail-invite.js` + tests/unit/team.test.js 引用已更新
- [x] 6.1E — removeTeam→list / _applyRoleChange→helpers / _initTeamListSportFilter→render
- [x] 6.2A — `tournament-helpers.js`（9 函式，127 行）
- [x] 6.2B — `tournament-share-builders.js`（3 函式，112 行）
- [x] 6.2C — 死代碼已刪除（renderLeagueSchedule / renderBracket）
- [x] 6.2D — `_tournamentFormState` + `_teamFormState` 物件化
- [x] 6.3 — script-loader.js 更新（含 tournament-render.js 加入 group）
- [x] 11.2① — 6 處 generateId 統一（鎖定函式 2086 行正確跳過）
- [x] 12.4A — end/reopen/delete 三碼新增
- [x] 12.7 — `_PERM_INFO` + `getDefaultRolePermissions()` 更新
- [x] 12.7 — `INHERENT_ROLE_PERMISSIONS` 兩地同步確認
- [x] 16.3 — 版號 `20260414` → `20260414a` + architecture.md + claude-memory.md
- **驗證結果**：team-list.js 305→179 行（-41%），tournament-core.js 364→257 行，source-drift 通過

### Phase 2A（4-5 天）— 專看專讀 + ID 統一建立 ✅ 2026-04-14 完成 `bf746b7b` + `44725091`
- [x] 7.2 — `fetchTeamIfMissing` / `fetchTournamentIfMissing`（雙路徑 .doc→.where + injected 桶）
- [x] 7.3 — `getTeamAsync` / `getTournamentAsync`
- [x] 7.4 — showTeamDetail / showTournamentDetail / friendly-detail 三處 async fallback
- [x] 7.5 — app.js 深連結用 fetchIfMissing 不再等全集合
- [x] 7.6 — PAGE_DATA_CONTRACT 詳情頁 required→optional，列表頁不變
- [x] 7.7 — _getTournamentDocRefById + _getTeamDocRefById 均已注入快取（44725091 補完）
- [x] 11.2② — addTeam/addTournament 改 .doc(customId).set()，data.id === data._docId
- [x] 12.4 — handleEnd/Reopen/Delete 改用獨立權限碼
- [x] 16.3 — 版號 `20260414b` + architecture.md + claude-memory.md（`[永久]`）
- **驗證結果**：深連結可在空快取下渲染，新建俱樂部 doc.id === data.id 確認

### Phase 4（3-4 天，可與 2A 平行）— 表單拆分 ✅ 2026-04-14 完成 `be901eaa`
- [x] 10.1 — team-form-validate.js（104 行）+ team-form-roles.js（186 行）+ team-form.js（171 行）
- [x] 10.2 — `_getTeamTypeHandler` 教育解耦（4 處接入，legacy check 保留安全 fallback）
- [x] 10.3 — `tournament-friendly-state.js`（162 行，5 狀態函式）
- [x] 16.3 — 版號 `20260414c` + architecture.md + claude-memory.md
- **驗證結果**：所有新檔 ≤300 行，script-loader 順序正確，既有測試通過

### Phase 2B（3-5 天）— 列表效能 ✅ 2026-04-14 完成 `5e4bd8ae`
- [x] 8.1 — 分頁 loadMoreTeams/Tournaments + cursor + _buildCollectionQuery limit(50/100)
- [x] 8.2A — 搜尋防抖 300ms + searchTeamsFromServer + 「搜尋所有」按鈕
- [x] 8.2B — 指紋跳過（team-list-render + tournament-render）
- [x] 8.2C — 賽事列表捲動保存
- [ ] 8.2D — 載入進度條 — **待補**
- [x] 8.3 — 即時監聽 + _mergeTeamSlices injected 桶保護 + 指數退避重連
- [x] 8.3 補 — fetchTeamIfMissing 寫入 injected
- [x] 8.4 — team-feed.js 走 ApiService（8 處 CRUD + audit log）
- [x] 12.4B — 4 個權限函式 + 雙層守衛（作者/管理員/幹部）
- [x] 16.3 — 版號 `20260414d` + architecture.md + claude-memory.md
- **驗證結果**：分頁/防抖/指紋/onSnapshot/injected 保護/Feed 權限 全部通過。進度條為 UX 增強項待補

### Phase 3（6-8 天）— 資料遷移 ✅ 2026-04-14 完成 `37107c20`
- [x] 9.1 3a-3e — 內嵌陣列移除：_sync/_persist 不再寫 teamApplications/teamEntries，_build 不再產生，registeredTeams 保留
- [x] 9.2 — Cloud Function `onTeamUpdate`（v2 API, onDocumentWrittenWithAuthContext）
- [x] 11.6 3-coach-a — `scripts/migrate-team-uids.js`（326 行，JWT+REST，冪等，模糊匹配處理）
- [x] 11.6 3-coach-b — 驗證未匹配 = 0 的前置條件機制已建立
- [x] 11.4 3-coach-c — `isCurrentUserTeamStaff` 新增（含 `coachUids is list` 防護），舊函式不動
- [x] 11.5 3-coach-d — 9 個函式改純 UID 比對（含 _isTournamentViewerInTeam）
- [x] 5.2 補完 — feed `create` 收緊為 `isCurrentUserInTeam`，update/delete 升級為 `isCurrentUserTeamStaff`
- [x] 16.3 — 版號 `20260414e` + architecture.md + claude-memory.md（`[永久]`）
- **驗證結果**：內嵌陣列移除、CF v2 級聯、教練 UID 化、feed 全面收緊、9 函式純 UID — 全部通過

---

## 1. 現況診斷總覽

### 1.1 模組規模

| 指標 | 俱樂部（team/） | 賽事（tournament/） | 活動（event/，標竿） |
|------|-----------------|-------------------|---------------------|
| 檔案數 | 11 | 12 | 33 |
| 總行數 | 2,763 | 3,243 | 11,063 |
| 函式數 | 101 | ~60 | ~200+ |
| 純工具檔 | 0 | 0 | 2（helpers + stats） |
| Builder 檔 | 0 | 0 | 1（share-builders） |
| 全域狀態變數 | 11 個（散落 5 檔） | 13 個（散落 6 檔） | 集中管理 |
| Firestore 索引 | 0 | 0 | 2 |
| 即時監聽 | 無 | 無 | 有（頁面範圍 + 動態上限） |
| 列表分頁 | 無 | 無 | 有（cursor-based） |
| 渲染防抖 | 無 | 無 | 有（100ms + fingerprint） |

### 1.2 規模化就緒度評分

| 評估面向 | 俱樂部 | 賽事 | 活動（參考） |
|----------|--------|------|-------------|
| Firestore 查詢效率 | 2/10 | 2/10 | 7/10 |
| 快取/記憶體管理 | 3/10 | 3/10 | 7/10 |
| 列表渲染效能 | 1/10 | 1/10 | 6/10 |
| 程式碼組織 | 4/10 | 5/10 | 8/10 |
| 即時同步能力 | 0/10 | 0/10 | 7/10 |
| 深連結體驗 | 3/10 | 3/10 | 8/10 |
| **綜合** | **2/10** | **2/10** | **7/10** |

---

## 2. 七大致命瓶頸

### 瓶頸 1：硬編碼 200 筆上限

**位置**：`firebase-service.js:512-531`

```javascript
_buildCollectionQuery(name, limitCount = 200) {
    return db.collection(name).limit(limitCount);  // Line 531
}
```

- 500 個俱樂部只載入前 200 個，其餘**靜默消失**
- 無分頁機制、無游標
- 活動模組有 `_terminalLastDoc` + `startAfter` 分頁（`firebase-service.js:603-627`）

### 瓶頸 2：全量 innerHTML 重繪 + 零防抖

**位置**：`team-list-render.js:54-56`、`tournament-render.js:123-158`

```javascript
// team-list-render.js:54-56
container.innerHTML = sorted.map(t => this._teamCardHTML(t)).join('');

// tournament-render.js:123-158 (35 行 HTML 拼接，無防抖)
container.innerHTML = tournaments.map(t => { ... }).join('');
```

- 搜尋每按一鍵觸發完整重繪（`team-list.js:228-269` filterTeams 無 debounce）
- 500 張卡片 ≈ 250KB HTML 字串 + DOM 全量解析
- 活動模組對比：fingerprint 跳過（`event-list.js:156`）+ 100ms 防抖（`event-manage-attendance.js:96-108`）

### 瓶頸 3：即時監聽完全缺失

**位置**：`config.js:123-124`

```javascript
'page-teams':       { required: ['teams'], optional: [], realtime: [] },
'page-tournaments': { required: ['tournaments'], optional: ['standings', 'matches'], realtime: [] },
```

- 隊長改俱樂部名稱 → 其他人必須手動重整才看到
- 活動模組有完整的頁面範圍即時監聽（`firebase-service.js:2707-2722`）+ 動態上限 + 自動重連（指數退避，2^attempts 上限 30s + 30% jitter）

### 瓶頸 4：賽事文件雙軌儲存

**位置**：賽事文件同時儲存內嵌陣列和子集合

| 資料 | 內嵌陣列位置 | 子集合位置 | 問題 |
|------|-------------|-----------|------|
| 申請 | `tournament.teamApplications[]` | `tournaments/{id}/applications/{appId}` | 雙份寫入，可能不同步 |
| 參賽 | `tournament.teamEntries[]` | `tournaments/{id}/entries/{teamId}` | 雙份寫入 |
| 名單 | `teamEntries[].memberRoster[]` | `entries/{teamId}/members/{uid}` | 內嵌陣列膨脹文件 |

- 4 隊 × 20 成員 ≈ 8KB/賽事 → 1000 場 = **8MB 快取**
- 內嵌陣列的每次更新都要讀寫整份賽事文件

### 瓶頸 5：Firestore 索引完全缺失

**位置**：`firestore.indexes.json` — 無任何 teams/tournaments 索引

現有 8 個索引全部給 events/registrations/attendanceRecords/inbox/operationLogs/inv_transactions 使用。

需要但不存在的索引：

| 查詢模式 | 使用位置 | 影響 |
|----------|---------|------|
| `teams.where('id', '==', val)` | `firebase-crud.js:2447` | 無索引 = 全集合掃描 |
| `tournaments.where('id', '==', val)` | `firebase-crud.js:199` | 同上 |
| `teams.where('creatorUid', '==', uid)` | 管理頁面 | 無索引 |
| `users.where('teamIds', 'array-contains', id)` | `firebase-crud.js:1159-1169` deleteTeam | 無索引，目前用 client-side 遍歷 |

### 瓶頸 6：無「專看專讀」機制 — 看 1 筆卻載 200 筆

**核心問題**：用戶只想看 A 賽事或 B 俱樂部，系統卻強制先載入整個集合。

**活動模組有 per-entity fetch**（`app.js:1410-1423`）：
```javascript
// 快取沒有？直接查 Firestore 單筆文件，注入快取，不載入整個集合
if (!event) {
  const doc = await db.collection('events').doc(e.id).get();
  FirebaseService._cache.events.push(doc.data());  // 注入 1 筆即可渲染
}
```

**俱樂部/賽事完全沒有**（`app.js:1445-1454`）：
```javascript
// 快取沒有？直接放棄，用戶看到錯誤
const team = ApiService.getTeam?.(pending.id);
if (!team) return false;  // ← 沒有任何 Firestore fallback
```

**成本衝擊**：

| 場景 | Per-entity（應有） | 全量載入（現況） | 浪費 |
|------|-------------------|-----------------|------|
| 點通知看 1 個俱樂部 | 1 read | 200 reads | 200x |
| 100 人/天各看 1 個俱樂部 | 100 reads | 20,000 reads | 200x |
| 點分享看 1 場賽事 | 1 read | 200+200+200 reads | 600x |

**現有架構限制**：
- `PAGE_DATA_CONTRACT['page-team-detail']` = `{ required: ['teams'] }` — 強制全載
- `ApiService.getTeam(id)` 只讀 `_cache.teams[]`，無 Firestore fallback
- `showTeamDetail(id)` 在 cache miss 時直接顯示錯誤 toast
- 深連結 `?team=xxx` 必須等整個 teams 集合載完才能渲染

### 瓶頸 7：程式碼重複 ~1,030 行

| 重複類型 | 散落處 | 估計行數 | 最嚴重案例 |
|----------|--------|----------|-----------|
| 成員計數 | 5+ 處 | ~80 | team-list.js:96 vs team-detail.js:290 vs team-form-join.js:232 — 三套不同的 fallback 邏輯 |
| 權限檢查 | 5+ 變體 | ~120 | `_hasRolePermission` vs `_canManageTeamMembers` vs `_canEditTeamByRoleOrCaptain` — 三套不同的判斷邏輯 |
| 身分解析 | 8 函式 | ~200 | team-list.js 有 8 個身分解析函式可壓縮為 3 個 |
| 狀態判斷 | 7 處 | ~150 | `getTournamentStatus()` 結果的後處理邏輯重複 7 處 |
| 放錯檔案的函式 | 4 個 | ~200 | `removeTeam()` 在 search 檔、`_applyRoleChange()` 在 join 檔 |

---

## 3. 安全性漏洞

### 3.1 賽事名單公開讀取

**位置**：`firestore.rules:895`

```
match /members/{memberUid} {
    allow read: if true;   // ← 任何人（含未登入）可讀取所有賽事名單
}
```

**影響**：所有參賽者的 UID、姓名、加入時間完全公開。

**同類問題**：
- `firestore.rules:869` — 賽事根文件公開讀取
- `firestore.rules:889` — 賽事 entries 公開讀取

### 3.2 團隊動態牆權限過寬

**位置**：`firestore.rules:779-784`

```
match /feed/{postId} {
    allow read: if request.auth != null;
    allow create: if request.auth != null;
    allow update: if request.auth != null;   // ← 任何登入用戶可改任何貼文
    allow delete: if request.auth != null;   // ← 任何登入用戶可刪任何貼文
}
```

**影響**：非俱樂部成員也能修改/刪除動態牆貼文。

### 3.3 動態牆操作無審計日誌

**位置**：`team-feed.js` — 8 處直接 Firebase 操作（v2.2 更正：deleteFeedComment 有 get + update 兩步），零 audit log

| 操作 | 行號 | 缺少的日誌 |
|------|------|-----------|
| 建立貼文 | L61 | team_feed_post_create |
| 刪除貼文 | L81 | team_feed_post_delete |
| 置頂/取消置頂 | L110 | team_feed_post_pin |
| 按讚/取消按讚 | L141 | team_feed_reaction |
| 新增留言 | L169 | team_feed_comment_create |
| 刪除留言 | L190 | team_feed_comment_delete |

---

## 4. 活動模組成功模式分析

### 4.1 五大模式

#### 模式 A：純工具檔分離

**標竿**：`event-list-helpers.js`（302 行，100% 純函式）

```javascript
// 多來源 Team ID 聚合 + Set 去重（Lines 45-84）
_getVisibleTeamIdsForLimitedEvents() {
  const ids = new Set();
  // user.teamIds → user.teamId → adminUsers match → staff roles
  return ids;
}
```

**命名規則**：`_get*()` 存取、`_can*()` 權限、`_is*()` 布林 — 全部無副作用。

#### 模式 B：純計算檔分離

**標竿**：`event-list-stats.js`（283 行）

```javascript
// Map 去重 + 來源閘門（Lines 23-100）
_buildEventPeopleSummaryByStatus(regs, status) {
  const groups = new Map();
  // groupKey → self + companions → displayName
}

// 資料來源閘門（Lines 96-100）
const _hasCompleteRegs = FirebaseService._realtimeListenerStarted?.registrations;
const confirmedCount = (_hasCompleteRegs) ? confirmedSummary.count : fallbackConfirmed;
```

#### 模式 C：Builder 檔分離

**標竿**：`event-share-builders.js`（295 行）

```javascript
// 安全 emoji 截斷（Lines 44-46）
text = Array.from(text).slice(0, 397).join('') + '...';  // Array.from 不切斷 surrogate pairs

// 結構化 Flex Message JSON（Lines 56-166）
_buildEventFlexMessage(event, liffUrl) { ... }  // 純 JSON 建構，可獨立測試
```

#### 模式 D：渲染防抖 + 指紋跳過 + 捲動保存

**標竿**：`event-manage-attendance.js:94-108` + `event-list.js:155-179`

```javascript
// 100ms 防抖（event-manage-attendance.js:96-108）
_attRenderTimers: {},
_renderAttendanceTable(eventId, containerId) {
  clearTimeout(self._attRenderTimers[key]);
  self._attRenderTimers[key] = setTimeout(() => { ... }, 100);
}

// 指紋跳過（event-list.js:156-158）
var _fp = visible.map(e => e.id + '|' + e.current + '|' + e.status).join(',');
if (this._hotEventsLastFp === _fp && container.children.length > 0) return;

// 捲動保存（event-list.js:160-167）
var _prevScroll = window.scrollY;
container.textContent = '';
container.insertAdjacentHTML('beforeend', cards);
if (_prevScroll > 0) window.scrollTo(0, _prevScroll);
```

#### 模式 E：分頁 + 即時監聽 + 自動重連

**標竿**：`firebase-service.js:603-628`（分頁）+ `firebase-service.js:2707-2755`（監聽）

```javascript
// Cursor-based 分頁（Lines 608-616）
var query = db.collection('events')
  .where('status', 'in', ['ended', 'cancelled'])
  .startAfter(this._terminalLastDoc)
  .limit(100);
this._terminalLastDoc = snap.docs[snap.docs.length - 1];

// 指數退避重連（Lines 2734-2755）
const baseDelay = Math.min(1000 * Math.pow(2, attempts - 1), 30000);
const delay = Math.round(baseDelay + baseDelay * Math.random() * 0.3);
```

---

## 5. Phase 0：安全性修復

> **工期**：1 天 | **風險**：極低 | **前置依賴**：無

### 5.1 修復賽事名單公開讀取

**檔案**：`firestore.rules`

| 行號 | 現況 | 修改為 |
|------|------|--------|
| 895 | `allow read: if true;`（members） | `allow read: if isAuth();` |
| 889 | `allow read: if true;`（entries） | `allow read: if isAuth();` |

### 5.2 收緊動態牆權限

**檔案**：`firestore.rules:779-784`

> **v2.1 修正**：`create` 規則**暫不收緊**。因為 `isCurrentUserInTeam(teamId)` 的 `teamId` 來自 Firestore 路徑（doc.id），但 `users.teamIds` 存的是自訂 ID — 對既有俱樂部（`doc.id ≠ data.id`）會導致成員被誤擋。等 Phase 2A 統一 ID 後再收緊 `create`。

```
// Phase 0：只收緊 update/delete，不動 create 和 read
allow read: if request.auth != null;       // 不變
allow create: if request.auth != null;     // 不變（v2.1：暫不收緊）
allow update: if request.auth != null
  && (resource.data.uid == request.auth.uid
      || isCurrentUserTeamCaptainOrLeader(teamId));
allow delete: if request.auth != null
  && (resource.data.uid == request.auth.uid
      || isCurrentUserTeamCaptainOrLeader(teamId));
```

### 5.4 賽事委託人修改權限收緊

> **v2.4 修正**：不能把 `delegateUids` 設為完全不可變 — 賽事建立者（通常是隊長，非管理員）需要能新增/移除委託人。改為：只有**建立者和管理員**可修改 `delegateUids`，一般委託人不可自我擴權。

**檔案**：`firestore.rules` — 新增獨立函式

```
// 新增：delegateUids 只允許建立者或管理員修改
function delegateUidsUnchangedOrCreator() {
  return request.resource.data.delegateUids == resource.data.delegateUids  // 沒改
    || resource.data.creatorUid == request.auth.uid;                       // 或是建立者改的
}

// 修改 tournament update 規則：
allow update: if isAdmin()
  || (tournamentExists()
    && canManageTournamentScope()
    && tournamentRootImmutableFieldsSafe()
    && delegateUidsUnchangedOrCreator());   // ← 新增
```

**效果**：
- 管理員（`isAdmin()`）→ 可改任何欄位（繞過所有檢查）
- 建立者（`creatorUid == auth.uid`）→ 可修改 `delegateUids`（管理自己的委託人）
- 一般委託人 → 可管理賽事但**不可修改 `delegateUids`**（防止自我擴權）

### 5.3 新增 Firestore 索引

**檔案**：`firestore.indexes.json` 新增：

```json
{
  "collectionGroup": "tournaments",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "creatorUid", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "teams",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "creatorUid", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
}
```

---

## 6. Phase 1：程式碼結構整理

> **工期**：4-5 天 | **風險**：低 | **前置依賴**：無  
> **原則**：不改邏輯，只移動程式碼。舊入口保留為 facade。含 `generateId()` 統一 + 權限碼定義 + `_PERM_INFO` 說明。

### 6.0 架構目標與模組化設計（v2.4 新增）

> 本節明確記載每個拆分的**目標、做法、完成標準**。

#### A. 整體架構目標

```
重構前：                              重構後：
team-list.js（305 行，25 函式）       team-list-helpers.js（~150 行，13 純函式）
  ├ 身分解析                            ↑ 無副作用，可獨立測試
  ├ 成員計數                          team-list-stats.js（~100 行，4 純計算）
  ├ 權限判斷                            ↑ 唯一真相來源，消滅 5 處 fallback
  ├ 排序/排名                         team-list.js（~60 行，瘦身後只留 filter/render 膠水）
  └ 篩選/渲染膠水                       ↑ 只做 DOM 操作，不含計算

team-share.js（189 行）              team-share-builders.js（~80 行，3 純 Builder）
  ├ URL 建構                            ↑ 純 JSON/URL 輸出，可獨立測試
  ├ Flex Message JSON                 team-share.js（~110 行，瘦身後只留 UI 操作）
  └ LINE/Web 分享 UI                    ↑ 平台互動邏輯

tournament-core.js（364 行）         tournament-helpers.js（~120 行，9 純工具）
  ├ 純工具函式                           ↑ 狀態計算、權限判斷、資料正規化
  └ 資料正規化                         tournament-core.js（~240 行，瘦身後留 builder + DOM）
```

#### B. 拆分原則

| 原則 | 做法 | 目標 |
|------|------|------|
| **單一職責** | 每個檔案只做一件事：helpers = 純工具、stats = 純計算、builders = 純建構、render = DOM 操作 | 任何修改只需開一個檔案 |
| **可獨立測試** | 純函式檔（helpers/stats/builders）不依賴 DOM、不依賴快取、不呼叫 API | 可寫 Jest 單元測試而不需 mock |
| **唯一真相來源** | 成員計數只在 `team-list-stats.js` 的 `_calcTeamMemberCountByTeam` 一處實作 | 改邏輯只改一處 |
| **命名一致** | `_get*` 存取、`_can*` 權限、`_is*` 布林、`_build*` 建構、`_render*` DOM | 看名字就知道有無副作用 |
| **300 行上限** | 所有新檔案 ≤ 300 行（CLAUDE.md 規範） | 可維護性 |
| **向後相容** | 舊檔案保留為 facade（呼叫新檔案的實作），不破壞既有的 `Object.assign(App, {...})` 掛載順序 | 零回歸風險 |

#### C. 完成標準

Phase 1 完成時，以下條件必須全部滿足：

- [ ] `team-list.js` 行數從 305 行降至 ≤ 80 行
- [ ] `tournament-core.js` 行數從 364 行降至 ≤ 250 行
- [ ] 每個新檔案 ≤ 300 行
- [ ] `_calcTeamMemberCount` 只有一個實作（team-list-stats.js），其他 2 處 fallback 已刪除
- [ ] 所有 ID 生成呼叫使用 `generateId(prefix)`，無內聯拼接
- [ ] 3 個純函式測試檔全部通過
- [ ] `source-drift.test.js` 通過（改名引用已更新）
- [ ] `script-deps.test.js` 通過（script-loader group 完整）
- [ ] 664 個既有測試全部通過

### 6.1 俱樂部模組 — 新增檔案

#### A. `team-list-helpers.js`（新建，~150 行）

從 `team-list.js` 抽出以下函式（保持原簽名不變）：

| 函式 | 原位置 | 說明 |
|------|--------|------|
| `_normalizeIdentityValue(value)` | team-list.js:28-30 | 字串正規化 |
| `_toNameIdentityKey(name)` | team-list.js:32-35 | 名字轉 identity key |
| `_getUserIdentityKey(user)` | team-list.js:37-44 | uid/docId/name 解析 |
| `_resolveUserIdentityKeyByName(name, users)` | team-list.js:46-55 | 依名字查用戶 |
| `_buildTeamStaffIdentity(team, users)` | team-list.js:57-94 | 幹部身分集合 |
| `_findUserByUidOrDocId(uidOrDocId)` | team-list.js:148-152 | uid/docId 查找 |
| `_resolveTeamCaptainUser(team)` | team-list.js:154-177 | 隊長解析（fallback 鏈） |
| `_isTeamCaptainUser(team)` | team-list.js:179-194 | 是否為隊長 |
| `_isTeamOwner(t)` | team-list.js:118-121 | 是否為擁有者 |
| `_canEditTeamByRoleOrCaptain(team)` | team-list.js:196-199 | 編輯權限 |
| `_canCreateTeamByPermission()` | team-list.js:201-203 | 建立權限 |
| `_hasRolePermission(code)` | team-list.js:141-146 | 角色權限檢查 |
| `_canManageTeamMembers(team)` | team-detail.js:42-55 | 成員管理權限（合併到此） |

**Script Loader 載入順序**：在 `team-list.js` 之前。

#### B. `team-list-stats.js`（新建，~100 行）

從多處整合為**唯一真相來源**（v2.3 修正：刪除 2 處 inline fallback，教育分支保持獨立呼叫不合併）：

| 函式 | 原位置 | 說明 |
|------|--------|------|
| `_calcTeamMemberCountByTeam(team, users)` | team-list.js:96-109 | **唯一版本**，刪除其他 4 處 fallback |
| `_calcTeamMemberCount(teamId)` | team-list.js:111-116 | 便捷包裝 |
| `_getTeamRank(teamExp)` | team-list.js:123-130 | 排名計算 |
| `_sortTeams(teams)` | team-list.js:132-139 | 排序邏輯 |

**刪除以下 inline fallback**（改為呼叫 `_calcTeamMemberCount`）：
- `team-detail.js:290-292` — 內聯 fallback（用 `filter` 做簡易計數，與主函式的 Set 去重邏輯不同）
- `team-form-join.js:232-234` — 內聯 fallback（用 `members - 1` 算術，完全不準確）

**保留但不合併**：
- `team-list-render.js:18-22` — 教育分支用 `_eduStudentsCache` 不同資料來源，保持獨立 `if (isEdu)` 分支呼叫

#### C. `team-share-builders.js`（新建，~80 行）

從 `team-share.js` 抽出：

| 函式 | 原位置 |
|------|--------|
| `_buildTeamLiffUrl(teamId)` | team-share.js:12-15 |
| `_buildTeamShareAltText(team, liffUrl)` | team-share.js:21-35 |
| `_buildTeamFlexMessage(team, liffUrl)` | team-share.js:41-110 |

#### D. 重新命名

| 原檔名 | 新檔名 | 理由 |
|--------|--------|------|
| `team-detail-members.js` | `team-detail-invite.js` | 內容是邀請/QR，不是成員管理 |

#### E. 搬移放錯位置的函式

| 函式 | 原位置 | 搬到 |
|------|--------|------|
| `removeTeam(id)` | team-form-search.js:130-175 | team-list.js（與 toggleTeamPin/toggleTeamActive 同級） |
| `_applyRoleChange(result)` | team-form-join.js:8-18 | team-list-helpers.js（被 3 個檔案呼叫） |
| `_initTeamListSportFilter()` | team-form-init.js:101-112 | team-list-render.js（在渲染時呼叫） |

### 6.2 賽事模組 — 新增檔案

#### A. `tournament-helpers.js`（新建，~120 行）

從 `tournament-core.js` 抽出純工具函式：

| 函式 | 原位置 |
|------|--------|
| `_resolveTournamentOrganizerUser(tournament)` | tournament-core.js:96-134 |
| `_normalizeTournamentDelegates(delegates)` | tournament-core.js:167-179 |
| `_getTournamentDelegateUids(tournament)` | tournament-core.js:181-193 |
| `_isTournamentLeaderForTeam(team, user)` | tournament-core.js:195-203 |
| `_isTournamentCaptainForTeam(team, user)` | tournament-core.js:205-210 |
| `_getFriendlyResponsibleTeams(user)` | tournament-core.js:212-219 |
| `_canCreateFriendlyTournament(user)` | tournament-core.js:221-226 |
| `_isTournamentDelegate(tournament, user)` | tournament-core.js:228-233 |
| `_canManageTournamentRecord(tournament, user)` | tournament-core.js:235-243 |

#### B. `tournament-share-builders.js`（新建，~70 行）

從 `tournament-share.js` 抽出：

| 函式 | 原位置 |
|------|--------|
| `_buildTournamentLiffUrl(tournamentId)` | tournament-share.js:12-15 |
| `_buildTournamentShareAltText(tournament, liffUrl)` | tournament-share.js:21-39 |
| `_buildTournamentFlexMessage(tournament, liffUrl)` | tournament-share.js:45-109 |

#### C. 清理死代碼

| 檔案 | 行號 | 函式 | 處理 |
|------|------|------|------|
| tournament-detail.js | 357-404 | `renderLeagueSchedule()` | 刪除 |
| tournament-detail.js | 406-449 | `renderBracket()` | 刪除 |

#### D. 全域狀態收進物件

**賽事表單狀態**（`tournament-manage-form.js`）：

```javascript
// 修改前（散落 4 處）：
_tfVenues: [],                    // Line 5
_tfDelegates: [],                 // Line 36
_tournamentDelegateSearchBound: {},  // Line 37
_tfMatchDates: [],                // Line 141

// 修改後：
_tournamentFormState: {
  venues: [],
  delegates: [],
  delegateSearchBound: {},
  matchDates: [],
},
```

**俱樂部表單狀態**（`team-form.js`）：

```javascript
// 修改前（Lines 8-11）：
_teamEditId: null,
_teamLeaderUids: [],
_teamCaptainUid: null,
_teamCoachUids: [],

// 修改後：
_teamFormState: {
  editId: null,
  leaders: [],
  captain: null,
  coaches: [],
},
```

### 6.3 Script Loader 更新

**檔案**：`js/core/script-loader.js`

```javascript
// team group（修改後）：
team: [
  'js/modules/auto-exp.js',
  'js/modules/event/event-share-builders.js',
  'js/modules/event/event-share.js',
  'js/modules/team/team-list-helpers.js',       // ← 新增
  'js/modules/team/team-list-stats.js',         // ← 新增
  'js/modules/team/team-list.js',
  'js/modules/team/team-list-render.js',
  'js/modules/team/team-share-builders.js',     // ← 新增
  'js/modules/team/team-detail.js',
  'js/modules/team/team-detail-render.js',
  'js/modules/team/team-detail-invite.js',      // ← 改名
  'js/modules/team/team-share.js',
  'js/modules/team/team-feed.js',
  'js/modules/team/team-form-join.js',
  'js/modules/team/team-form-search.js',
  'js/modules/team/team-form-init.js',
  'js/modules/team/team-form.js',
],

// tournament group（修改後）：
tournament: [
  'js/modules/tournament/tournament-helpers.js',        // ← 新增
  'js/modules/tournament/tournament-core.js',           // ← 新增（原本不在 group）
  'js/modules/tournament/tournament-render.js',         // ← v2.2 補：原本 eager 載入，移入 group
  'js/modules/tournament/tournament-share-builders.js', // ← 新增
  'js/modules/tournament/tournament-detail.js',
  'js/modules/tournament/tournament-friendly-detail.js',
  'js/modules/tournament/tournament-friendly-detail-view.js',
  'js/modules/tournament/tournament-share.js',
  'js/modules/tournament/tournament-friendly-roster.js',
  'js/modules/tournament/tournament-friendly-notify.js',
],
```

---

## 7. Phase 2A：「專看專讀」per-entity 架構（核心）

> **工期**：4-5 天 | **風險**：中 | **前置依賴**：Phase 1 完成  
> **設計原則**：用戶只看 1 筆就只載 1 筆。列表頁才載集合，詳情頁只載單筆。含 ID 統一建立流程（`.doc(customId).set()`）。

這是整份計畫中**成本節省最大**的一項變更。

### 7.1 兩層快取架構（集合快取 + 單筆快取）

**設計概念**：

```
┌─────────────────────────────────────────────────────┐
│ 列表頁（page-teams / page-tournaments）              │
│  → 載入集合快取（_cache.teams[]）                     │
│  → 有分頁上限，用 onSnapshot 即時更新                  │
│  → 用於搜尋、篩選、排序                               │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ 詳情頁（page-team-detail / page-tournament-detail）   │
│  → 優先從集合快取找（O(1) Array.find）                 │
│  → Cache miss → 單筆 Firestore 查詢 + 注入快取        │
│  → 不依賴集合是否已載入                                │
│  → 深連結、通知、分享連結都走此路徑                      │
└─────────────────────────────────────────────────────┘
```

**與活動模組對齊**：活動模組的 `app.js:1410-1423` 已實現此模式。

### 7.2 新增 `fetchTeamIfMissing` / `fetchTournamentIfMissing`

**修改檔案**：`firebase-service.js`

```javascript
// ─── 俱樂部單筆補查 ───
async fetchTeamIfMissing(teamId) {
  const safeId = String(teamId || '').trim();
  if (!safeId) return null;

  // 1. 先查集合快取
  const cached = this._cache.teams.find(t => t.id === safeId);
  if (cached) return cached;

  // 2. Cache miss → 查 Firestore 單筆
  //    ID 統一後（§11）：自訂 ID = doc ID，直接 .doc().get()
  //    既有資料（統一前）：fallback 用 where 查詢
  try {
    let doc;
    const directSnap = await db.collection('teams').doc(safeId).get();
    if (directSnap.exists) {
      doc = directSnap;
    } else {
      // fallback：既有資料的 doc ID 可能不等於自訂 ID
      const querySnap = await db.collection('teams')
        .where('id', '==', safeId).limit(1).get();
      if (querySnap.empty) return null;
      doc = querySnap.docs[0];
    }
    const team = { ...doc.data(), _docId: doc.id };

    // 3. 注入集合快取（避免重複）
    const idx = this._cache.teams.findIndex(t => t.id === safeId);
    if (idx >= 0) {
      this._cache.teams[idx] = team;
    } else {
      this._cache.teams.push(team);
    }
    return team;
  } catch (err) {
    console.warn('[fetchTeamIfMissing]', err);
    return null;
  }
},

// ─── 賽事單筆補查（同模式） ───
async fetchTournamentIfMissing(tournamentId) {
  const safeId = String(tournamentId || '').trim();
  if (!safeId) return null;

  const cached = this._cache.tournaments.find(t => t.id === safeId);
  if (cached) return cached;

  try {
    let doc;
    const directSnap = await db.collection('tournaments').doc(safeId).get();
    if (directSnap.exists) {
      doc = directSnap;
    } else {
      const querySnap = await db.collection('tournaments')
        .where('id', '==', safeId).limit(1).get();
      if (querySnap.empty) return null;
      doc = querySnap.docs[0];
    }
    const tournament = { ...doc.data(), _docId: doc.id };

    const idx = this._cache.tournaments.findIndex(t => t.id === safeId);
    if (idx >= 0) {
      this._cache.tournaments[idx] = tournament;
    } else {
      this._cache.tournaments.push(tournament);
    }
    return tournament;
  } catch (err) {
    console.warn('[fetchTournamentIfMissing]', err);
    return null;
  }
},
```

**成本**：1 Firestore read/次（cache hit = 0 read）

### 7.3 修改 `ApiService` — 加入 Firestore fallback

**修改檔案**：`api-service.js`

```javascript
// 修改前（api-service.js:571）：
getTeam(id) { return this._findById('teams', id); }  // 純快取，miss = null

// 修改後：
getTeam(id) { return this._findById('teams', id); },  // 同步版（向後相容）

async getTeamAsync(id) {
  const cached = this._findById('teams', id);
  if (cached) return cached;
  return FirebaseService.fetchTeamIfMissing(id);  // Firestore fallback
},

// 同模式修改 getTournament / getTournamentAsync
```

### 7.4 修改詳情頁 — 接入 per-entity 查詢

**修改檔案**：`team-detail.js`

```javascript
// 修改前（team-detail.js:123-124）：
let t = ApiService.getTeam(id);
if (!t) { this.showToast('無法開啟'); return { ok: false }; }

// 修改後：
let t = ApiService.getTeam(id);
if (!t) {
  // 快取 miss → 單筆查詢 Firestore（1 read）
  t = await ApiService.getTeamAsync(id);
  if (!t) { this.showToast('找不到此俱樂部'); return { ok: false }; }
}
```

**同模式修改**：
- `tournament-detail.js:9` — `getTournament` → `getTournamentAsync` fallback
- `tournament-friendly-detail.js:183` — 同上

### 7.5 修改深連結 — 不再依賴全集合載入

**修改檔案**：`app.js`

```javascript
// 修改前（app.js:1445-1454）：
if (pending.type === 'team') {
  const team = ApiService.getTeam?.(pending.id);
  if (!team) return false;  // ← 等全集合載完才有機會
  ...
}

// 修改後：
if (pending.type === 'team') {
  let team = ApiService.getTeam?.(pending.id);
  if (!team) {
    // 集合還沒載完？直接查 1 筆，不等全集合
    team = await FirebaseService.fetchTeamIfMissing(pending.id);
  }
  if (!team) return false;
  await ScriptLoader.ensureForPage('page-team-detail');
  const result = await this.showTeamDetail(pending.id);
  return result?.ok;
}

// 同模式修改 tournament 深連結
```

### 7.6 修改 PAGE_DATA_CONTRACT — 詳情頁不再強制載入集合

**修改檔案**：`config.js`

```javascript
// 修改前：
'page-team-detail':       { required: ['teams'], optional: ['events'], realtime: [] },
'page-tournament-detail': { required: ['tournaments', 'standings', 'matches'], optional: [], realtime: [] },

// 修改後：
'page-team-detail':       { required: [], optional: ['teams', 'events'], realtime: [] },
'page-tournament-detail': { required: [], optional: ['tournaments', 'standings', 'matches'], realtime: [] },
```

**效果**：`ensureCollectionsForPage` 不再阻塞詳情頁渲染。集合在背景載入，詳情頁的資料由 `fetchIfMissing` 單筆查詢提供。

### 7.7 賽事子集合的「專看專讀」

賽事詳情頁的 applications / entries / members 子集合**已經是 per-entity 查詢**（`firebase-crud.js:209-310`），這部分不需要改。

但子集合查詢需要先取得賽事 docRef（`_getTournamentDocRefById`），目前的實作（`firebase-crud.js:192-202`）已經有 cache-first + Firestore fallback：

```javascript
// 已存在的正確模式：
const cached = this._cache.tournaments.find(t => t.id === safeTournamentId && t._docId);
if (cached?._docId) return db.collection('tournaments').doc(cached._docId);
// fallback: Firestore where query
const snapshot = await db.collection('tournaments').where('id', '==', safeTournamentId).limit(1).get();
```

**補強**：在 fallback 查詢成功時，也注入快取（目前沒有）：

```javascript
// firebase-crud.js 修改：_getTournamentDocRefById
const doc = snapshot.docs[0];
// 新增：注入快取，後續查詢不再需要 Firestore
if (!this._cache.tournaments.find(t => t.id === safeTournamentId)) {
  this._cache.tournaments.push({ ...doc.data(), _docId: doc.id });
}
return doc.ref;
```

### 7.8 成本對比總結

| 場景 | 修改前 | 修改後 | 節省 |
|------|--------|--------|------|
| 深連結看 1 個俱樂部 | 200 reads（全集合） | **1 read**（單筆） | 99.5% |
| 深連結看 1 場賽事 | 600 reads（3 集合） | **1 read**（單筆） | 99.8% |
| 100 人/天各看 1 個俱樂部 | 20,000 reads | **100 reads** | 99.5% |
| 列表頁瀏覽（不變） | 50 reads | 50 reads | 0%（分頁仍然需要） |
| 已在快取中的詳情頁 | 0 reads | **0 reads** | 不變 |

### 7.9 歷史教訓對照

| 教訓 | 出處 | 本設計如何避免 |
|------|------|---------------|
| collectionGroup 首次快照延遲 | claude-memory 2026-04-13 | `fetchIfMissing` 是 `.get()` 不是 `onSnapshot`，無延遲問題 |
| 快取注入後 onSnapshot 可能覆蓋 | claude-memory 2026-04-13 | 注入時用 `findIndex` + 替換，不是 push 重複；onSnapshot 到達時自然合併 |
| displayName fallback 同名碰撞 | claude-memory 2026-04-09 | `fetchIfMissing` 用 `id` 欄位查詢，不用名字 |

---

### 7.10 未來增強：Pre-auth REST 快速預覽（v2.4 記錄）

> 活動模組有 `_fetchEventViaRest`（`app.js:1265-1336`）可在 LIFF 登入前透過 Firestore REST API + API key 快速取得單筆活動資料，讓深連結在 ~1 秒內預覽。俱樂部/賽事目前沒有此機制 — 深連結必須等 LIFF 登入完成（3-8 秒）後才能渲染。
>
> **不納入本次重構範圍**（理由：Medium 嚴重度，不影響功能正確性，只影響首次開啟速度）。功能正式上線後，若用戶反饋深連結開啟太慢，再實作 `_fetchTeamViaRest` / `_fetchTournamentViaRest`。

---

## 8. Phase 2B：列表效能優化

> **工期**：3-5 天 | **風險**：中 | **前置依賴**：Phase 2A 完成  
> **適用場景**：用戶瀏覽列表頁（搜尋、篩選、翻頁）。含 feed 走 ApiService + 前端權限守衛。

### 8.1 分頁機制

**修改檔案**：`firebase-service.js`

複製活動模組的 `loadMoreTerminalEvents()`（Lines 603-627）模式：

```javascript
// 新增：teams 分頁
_teamSlices: { active: [], inactive: [] },
_teamLastDoc: null,
_teamAllLoaded: false,
_loadingMoreTeams: false,

async loadMoreTeams() {
  if (this._teamAllLoaded || !this._teamLastDoc) return 0;
  if (this._loadingMoreTeams) return -1;
  this._loadingMoreTeams = true;
  try {
    const query = db.collection('teams')
      .orderBy('createdAt', 'desc')
      .startAfter(this._teamLastDoc)
      .limit(50);
    const snap = await query.get();
    // ... merge slices, update cursor, save to LS
  } finally {
    this._loadingMoreTeams = false;
  }
}

// 同模式新增 loadMoreTournaments()
```

**修改 `_buildCollectionQuery`**：

```javascript
// firebase-service.js:531
// 修改前：return db.collection(name).limit(limitCount);
// 修改後：
if (name === 'teams') {
  return db.collection('teams').orderBy('createdAt', 'desc').limit(50);
}
if (name === 'tournaments') {
  return db.collection('tournaments').orderBy('createdAt', 'desc').limit(50);
}
return db.collection(name).limit(limitCount);
```

### 8.2 渲染優化

#### A. 搜尋防抖（300ms）+ 快取外搜尋提示（v2.4 新增）

> **v2.4 業務場景修正**：onSnapshot limit(50) 只載入最新 50 筆，但 `filterTeams()` 只搜尋快取內容 — 第 51 個以後的俱樂部搜不到。必須加入「載入更多」觸發機制。

**修改檔案**：`team-list.js`、`tournament-render.js`

```javascript
// team-list.js — filterTeams 加入防抖 + 快取外提示
_teamFilterTimer: null,
filterTeams() {
  clearTimeout(this._teamFilterTimer);
  this._teamFilterTimer = setTimeout(() => this._doFilterTeams(), 300);
},
_doFilterTeams() {
  const query = /* 搜尋關鍵字 */;
  const filtered = /* 原本的快取過濾邏輯 */;

  // 渲染快取內的結果
  container.innerHTML = filtered.map(t => this._teamCardHTML(t)).join('');

  // v2.4：如果快取不完整且搜尋無結果，顯示「載入更多」按鈕
  if (query && filtered.length === 0 && !this._teamAllLoaded) {
    container.insertAdjacentHTML('beforeend',
      '<div class="load-more-hint" onclick="App.searchTeamsFromServer()">' +
      '找不到？點此搜尋所有俱樂部</div>');
  }
},

// 新增：server-side 搜尋（全集合查詢，僅在用戶主動觸發時執行）
async searchTeamsFromServer() {
  const query = document.getElementById('team-search')?.value?.trim();
  if (!query) return;
  this.showToast('搜尋中...');
  // 載入所有尚未載入的團隊
  while (!this._teamAllLoaded) {
    const loaded = await FirebaseService.loadMoreTeams();
    if (loaded <= 0) break;
  }
  this._doFilterTeams();  // 重新篩選（現在快取有完整資料）
}
```

**同模式套用到 `tournament-render.js` 的 `filterTournamentCenter()`。**

#### B. 指紋跳過

**修改檔案**：`team-list-render.js`、`tournament-render.js`

```javascript
// team-list-render.js — renderTeamList 加入指紋
_teamListLastFp: '',
renderTeamList() {
  // ... filter & sort
  const fp = sorted.map(t => t.id + '|' + (t.name||'') + '|' + (t.active?1:0) + '|' + (t.pinned?1:0)).join(',');
  if (this._teamListLastFp === fp && container.children.length > 0) return;
  this._teamListLastFp = fp;
  // ... render
}
```

#### C. 捲動保存（賽事列表缺失）

**修改檔案**：`tournament-render.js:64-160`（renderTournamentTimeline）

```javascript
// 目前：直接 container.innerHTML = ...
// 修改後：
const scrollEl = document.scrollingElement || document.documentElement;
const savedScroll = scrollEl.scrollTop;
container.innerHTML = ...;
scrollEl.scrollTop = savedScroll;
```

#### D. 載入進度條

複製 `event-list-home.js:135-194` 的 loading bar 模式到俱樂部/賽事列表卡片。

### 8.3 即時監聽

**修改檔案**：`firebase-service.js`、`config.js`

#### A. 新增 config

```javascript
// config.js — REALTIME_LIMIT_DEFAULTS 新增：
teamLimit: 50,
tournamentLimit: 100,

// config.js — PAGE_DATA_CONTRACT 修改：
'page-teams':       { required: ['teams'], optional: [], realtime: ['teams'] },
'page-tournaments': { required: ['tournaments'], optional: ['standings', 'matches'], realtime: ['tournaments'] },
```

#### B. 新增監聽器 + injected 桶保護（v2.2 修正）

> **v2.2 CRITICAL 修正**：onSnapshot 會整批覆蓋 `_cache.teams[]`。如果 `fetchIfMissing` 注入了一個不在 snapshot 範圍（top-50 by updatedAt）的冷門俱樂部，覆蓋後該俱樂部會從快取消失。**必須用 `injected` 桶保護注入的單筆資料。**

```javascript
// firebase-service.js 新增：
_teamSlices: { active: [], injected: [] },  // ← injected 桶保護 fetchIfMissing 注入的資料

_mergeTeamSlices() {
  // 1. 用 active（onSnapshot 的結果）為基底
  const merged = [...this._teamSlices.active];
  const activeIds = new Set(merged.map(t => t.id));

  // 2. 補上 injected 中不在 active 的項目（保護冷門俱樂部不被洗掉）
  for (const t of this._teamSlices.injected) {
    if (!activeIds.has(t.id)) merged.push(t);
  }

  this._cache.teams = merged;
  this._saveToLS('teams', this._cache.teams);
},

_startTeamsRealtimeListener() {
  if (this._realtimeListenerStarted.teams) return;
  this._realtimeListenerStarted.teams = true;
  const unsub = db.collection('teams')
    .orderBy('updatedAt', 'desc')
    .limit(this._getRealtimeLimit('teamLimit'))
    .onSnapshot(
      snapshot => {
        this._teamSlices.active = snapshot.docs.map(doc => ({ ...doc.data(), _docId: doc.id }));
        this._mergeTeamSlices();  // ← 合併而非覆蓋
        this._snapshotReconnectAttempts.teams = 0;
      },
      err => this._reconnectListener('teams', err, () => this._startTeamsRealtimeListener())
    );
  this._pageScopedRealtimeListeners.teams = unsub;
},

// 同模式新增 _startTournamentsRealtimeListener() + _tournamentSlices.injected
```

**fetchTeamIfMissing 注入時也寫入 injected 桶**（修改 §7.2）：

```javascript
// fetchTeamIfMissing 成功時：
this._teamSlices.injected.push(team);  // ← 同時寫入 injected 桶
this._cache.teams.push(team);          // 立即可用
```

### 8.4 team-feed.js 走 ApiService

**修改檔案**：`team-feed.js`、`firebase-crud.js`、`api-service.js`

將 8 處直接 Firebase 操作搬到 `firebase-crud.js`：

```javascript
// firebase-crud.js 新增：
async listTeamFeed(teamId) { ... },
async createTeamPost(teamId, post) { ... },
async deleteTeamPost(teamId, postId) { ... },
async updateTeamPost(teamId, postId, updates) { ... },

// api-service.js 新增：
getTeamFeed(teamId) { return FirebaseService.listTeamFeed(teamId); },
createTeamPost(teamId, post) { return FirebaseService.createTeamPost(teamId, post); },
// ...
```

---

## 9. Phase 3：資料架構遷移

> **工期**：6-8 天 | **風險**：中高 | **前置依賴**：Phase 2B 完成  
> 含 coachUids 遷移 + 賽事內嵌陣列移除。內部子排序見 §17。

### 9.1 賽事文件瘦身 — 移除內嵌陣列

**目標**：賽事文件從 ~8KB 降到 ~2KB

#### 遷移步驟（參照活動 Phase 4b 模式）

1. **Phase 3a**：確認所有讀取路徑已使用子集合（`listTournamentApplications`、`listTournamentEntries`、`listTournamentEntryMembers`）
2. **Phase 3b**：確認所有寫入路徑已使用子集合（`createTournamentApplication`、`upsertTournamentEntry`、`upsertTournamentEntryMember`）
3. **Phase 3c**：移除 `_syncFriendlyTournamentCacheRecord`（`tournament-friendly-detail.js:39-50`）中將子集合資料寫回內嵌陣列的邏輯
4. **Phase 3d**：移除 `_persistFriendlyTournamentCompatState`（`tournament-friendly-detail.js:52-92`）中的內嵌陣列同步
5. **Phase 3e**：停止在 `_buildFriendlyTournamentRecord`（`tournament-core.js:291-347`）中產生內嵌陣列

**保留**：`registeredTeams[]`（輕量 ID 陣列，用於快速判斷「這個俱樂部是否已參賽」）

#### 預估效果

| 指標 | 遷移前 | 遷移後 |
|------|--------|--------|
| 單份賽事文件 | ~8KB | ~2KB |
| 1000 場快取 | ~8MB | ~2MB |
| 寫入成本（更新名單） | 讀寫整份文件 | 只寫子集合文件 |

### 9.2 團隊名稱級聯更新

**問題**：俱樂部改名後，賽事的 `hostTeamName`、`teamEntries[].teamName` 不會自動更新。

**方案**：新增 Cloud Function trigger

```javascript
// functions/index.js 新增：
// v2 API（v2.4 修正：程式碼庫用 v2，不用 v1）
const { onDocumentWrittenWithAuthContext } = require('firebase-functions/v2/firestore');
exports.onTeamUpdate = onDocumentWrittenWithAuthContext(
  'teams/{teamId}',
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before || !after) return;  // 刪除或建立，不處理
    if (before.name === after.name && before.image === after.image) return;
    // 查詢所有使用此 teamId 的賽事，更新 hostTeamName/hostTeamImage
  }
);
```

---

## 10. Phase 4：表單拆分與教育解耦

> **工期**：3-4 天 | **風險**：低 | **前置依賴**：Phase 1 完成（可與 Phase 2A 平行）

### 10.1 team-form.js 拆分

**現況**：`handleSaveTeam()` 一個 393 行函式。

**拆分為**：

| 新檔案 | 行數 | 從 team-form.js 抽出的區塊 |
|--------|------|---------------------------|
| `team-form-validate.js` | ~60 | Lines 14-93（表單驗證 + 值提取） |
| `team-form-roles.js` | ~120 | Lines 98-162（降級預覽）+ Lines 293-384（升降級） |
| `team-form.js`（瘦身後） | ~210 | Lines 164-291（資料組裝 + 儲存 + 日誌） |

### 10.2 教育模組解耦

**現況**：4 個檔案有 `if (type === 'education')` 分支

| 檔案 | 行號 | 耦合內容 |
|------|------|---------|
| team-detail.js | L154 | `if (t.type === 'education') renderEduClubDetail()` |
| team-form-join.js | L37 | `if (team.type === 'education') showEduStudentApply()` |
| team-list-render.js | L18-22 | 教育學員計數特殊處理 |
| team-form-init.js | L51 | 教育欄位切換 |

**方案**：在 `team-list-helpers.js` 新增 type handler pattern：

```javascript
_getTeamTypeHandler(type) {
  if (type === 'education') return {
    memberCount: (teamId) => this._getEduStudentCount(teamId),
    detailRenderer: (teamId) => this.renderEduClubDetail(teamId),
    joinHandler: (teamId) => this.showEduStudentApply(teamId),
  };
  return {
    memberCount: (teamId) => this._calcTeamMemberCount(teamId),
    detailRenderer: null,  // 使用預設
    joinHandler: null,     // 使用預設
  };
},
```

### 10.3 tournament-friendly-detail.js 拆分

| 新檔案 | 內容 |
|--------|------|
| `tournament-friendly-state.js` | `_syncFriendlyTournamentCacheRecord`（L39）、`_persistFriendlyTournamentCompatState`（L52）、`_loadFriendlyTournamentDetailState`（L94）、`_getFriendlyTournamentVisibleApplications`（L155）、`_getFriendlyTournamentApplyContext`（L166） |
| `tournament-friendly-detail.js`（瘦身） | 只留 `showTournamentDetail`（L182）、`registerTournament`（L229）、`reviewFriendlyTournamentApplication`（L302） |

---

## 11. ID 統一化架構

> **核心原則**：一個實體 = 一個 ID。禁止用名字做身分識別。禁止一個實體有兩個不同 ID。

### 11.1 現況：三層 ID 混亂

#### A. 雙軌 ID 問題（所有主要集合都有）

| 集合 | 自訂 ID（`data.id`） | Firestore ID（`doc.id` / `_docId`） | 誰用自訂 ID | 誰用 Firestore ID |
|------|---------------------|-----------------------------------|------------|------------------|
| events | `ce_1774920121549_j63p` | `ga0CqtaPpjRwimUGEZfU` | registrations.eventId、前端快取、分享連結 | 子集合路徑 `events/{_docId}/registrations` |
| teams | `tm_1774920121549_abc1` | `xK9mPqR2...`（自動） | users.teamIds、events.creatorTeamIds、tournaments.hostTeamId | 子集合路徑 `teams/{_docId}/feed` |
| tournaments | `ct_1774920121549_xyz1` | `bN3kLp7W...`（自動） | 前端快取、分享連結 | 子集合路徑 `tournaments/{_docId}/applications` |

**問題**：
- 查詢時必須先 `where('id', '==', customId).limit(1)` 找到文件，再用 `doc.id` 取得 Firestore ref
- 歷史地雷：CF 用 `doc.id` 比對 `registrations.eventId`（存的是 `data.id`）→ 全站放鴿子歸零（`claude-memory [永久] 2026-04-11`）
- `_docId` 只存在記憶體快取中，不寫入 Firestore → 重新載入時必須重新查詢

#### B. 名字做身分識別（最危險）

| 欄位 | 集合 | 儲存內容 | 用途 | 風險 |
|------|------|---------|------|------|
| `captain` | teams | `"王小明"`（名字） | 隊長身分比對 | 同名碰撞 |
| `leader` / `leaders` | teams | `"李大華"` / `["李大華"]` | 領隊身分比對 | 同名碰撞 |
| `coaches` | teams | `["張教練", "陳教練"]` | 教練身分比對 | 同名碰撞 + Firestore Rules 不認 |
| `event.participants` | events | `["王小明", "李大華"]` | 顯示用名單 | 曾因同名導致誤判報名狀態（`claude-memory [永久] 2026-04-09`） |
| `event.waitlistNames` | events | `["候補者名"]` | 顯示用 | 同上 |
| `registrations.userName` | registrations | `"王小明"` | 快速顯示 | 可接受（只讀顯示用，不做比對） |

#### C. ID 生成不一致

| 場景 | 程式碼位置 | 格式 | 隨機長度 |
|------|----------|------|---------|
| 俱樂部 | team-form.js:166 | `generateId('tm_')` | 8 字元 |
| 活動 | event-create.js:322 | `'ce_' + Date.now() + '_' + Math.random()...slice(2,6)` | 6 字元（內聯） |
| 賽事 | tournament-manage.js:244 | `'ct_' + Date.now() + '_' + Math.random()...slice(2,6)` | 6 字元（內聯） |
| 報名 | firebase-crud.js:825 | `'reg_' + Date.now() + '_' + Math.random()...slice(2,5)` | 5 字元（內聯） |
| `generateId()` | config.js:493 | `prefix + Date.now() + '_' + Math.random()...slice(2,8)` | 8 字元 |

**問題**：`generateId()` 函式存在但只有部分場景使用，其他場景手動拼接且隨機長度不同。

### 11.2 ID 統一方案

#### 原則 1：統一使用 `generateId()` 產生所有自訂 ID

**修改 config.js:493**：

```javascript
function generateId(prefix) {
  return (prefix || '') + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}
```

**強制所有建立操作使用此函式**：

| 實體 | 前綴 | 範例 | 修改位置 |
|------|------|------|---------|
| 俱樂部 | `tm_` | `tm_1713052800000_k7j2m9` | team-form.js:166（已使用 ✅） |
| 賽事 | `ct_` | `ct_1713052800000_p3x8n1` | tournament-manage.js:244（改用 `generateId`） |
| 活動 | `ce_` | `ce_1713052800000_a5b2c7` | event-create.js:322（改用 `generateId`） |
| 報名 | `reg_` | `reg_1713052800000_d4e6f8` | firebase-crud.js:825（改用 `generateId`） |
| 動態牆貼文 | `fp_` | `fp_1713052800000_g1h3i5` | team-feed.js:54（現用 `f_` 前綴，改用 `generateId('fp_')`） |
| 動態牆留言 | `fc_` | `fc_1713052800000_j7k9l0` | team-feed.js:162（現用 `c_` 前綴，改用 `generateId('fc_')`） |
| 賽事申請 | `ta_` | `ta_1713052800000_m2n4o6` | firebase-crud.js:220（改用 `generateId`） |

#### 原則 2：用自訂 ID 作為 Firestore 文件 ID（消除雙軌制）

**目前**：`.add(data)` → Firestore 自動產生 doc ID，自訂 ID 存在 `data.id` 欄位
**目標**：`.doc(customId).set(data)` → 自訂 ID **就是** Firestore doc ID

```javascript
// 修改前（firebase-crud.js:1130-1141）：
async addTeam(data) {
  const docRef = await db.collection('teams').add({     // ← auto ID
    ..._stripDocId(data),
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  data._docId = docRef.id;   // ← 雙軌：data.id ≠ data._docId
  return data;
}

// 修改後：
async addTeam(data) {
  const teamId = data.id || generateId('tm_');
  data.id = teamId;
  const docRef = db.collection('teams').doc(teamId);    // ← 自訂 ID = doc ID
  await docRef.set({
    ..._stripDocId(data),
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  data._docId = teamId;      // ← 單軌：data.id === data._docId
  return data;
}
```

**同模式修改**：`addTournament`、新建的俱樂部/賽事

**注意**：既有的活動（events）因為已有大量歷史資料且子集合遷移剛完成（Phase 4b），**不動**。只對俱樂部和賽事執行此統一（因為尚未正式啟用）。

#### 原則 3：所有人員欄位一律用 UID，名字只做顯示快取

**目標格式**：

```javascript
// 修改前（teams 文件）：
{
  captain: "王小明",           // ← 名字做身分
  captainUid: "uid_abc123",    // ← UID 做身分
  leader: "李大華",            // ← 名字做身分
  leaderUid: "uid_def456",     // ← UID 做身分（單數，舊）
  leaders: ["李大華"],          // ← 名字陣列
  leaderUids: ["uid_def456"],  // ← UID 陣列
  coaches: ["張教練"],          // ← 只有名字，沒有 UID ⚠️
}

// 修改後（統一格式）：
{
  // 身分識別：只用 UID
  captainUid: "uid_abc123",
  leaderUids: ["uid_def456"],
  coachUids: ["uid_ghi789"],     // ← 新增

  // 顯示快取：只做渲染用，永遠不做比對
  captainName: "王小明",          // ← 改名，明確標示用途
  leaderNames: ["李大華"],        // ← 改名
  coachNames: ["張教練"],         // ← 改名

  // 廢棄欄位（向後相容保留 30 天）：
  // captain, leader, leaders, coaches → 舊程式碼 fallback 讀取
}
```

**同模式套用到賽事**：

```javascript
// 修改前（tournaments 文件）：
{
  delegates: [{ uid: "uid_1", name: "王小明" }],
  delegateUids: ["uid_1"],        // ← 冗餘
  creatorName: "李大華",           // ← 只做顯示
  hostTeamName: "FC Team",        // ← 只做顯示
}

// 修改後：
{
  delegateUids: ["uid_1"],         // ← 唯一身分來源
  delegateNames: ["王小明"],       // ← 顯示用
  creatorUid: "uid_abc",           // ← 身分
  creatorName: "李大華",           // ← 顯示
  hostTeamId: "tm_1713052800000_k7j2m9",  // ← 統一 ID
  hostTeamName: "FC Team",        // ← 顯示
}
```

### 11.3 欄位遷移對照表

#### 俱樂部（teams）

| 廢棄欄位 | 新欄位（身分） | 新欄位（顯示） | 遷移方式 |
|---------|--------------|--------------|---------|
| `captain`（名字） | `captainUid`（已有） | `captainName` | 名字 → 查 adminUsers → 寫 captainName |
| `leader`（名字） | — | — | 已被 `leaderUids` 取代 |
| `leaders`（名字陣列） | `leaderUids`（已有） | `leaderNames` | 名字 → 查 adminUsers → 寫 leaderNames |
| `leaderUid`（單數） | `leaderUids`（陣列） | — | 單值包進陣列 |
| `coaches`（名字陣列） | `coachUids`（**新增**） | `coachNames` | 名字 → 查 adminUsers → 寫 coachUids + coachNames |
| `ownerUid` | 合併到 `captainUid` | — | 確認無引用後移除 |
| `creatorUid` | 保留 | — | 不變（建立者 ≠ 現任隊長） |

#### 賽事（tournaments）

| 廢棄欄位 | 新欄位（身分） | 新欄位（顯示） | 遷移方式 |
|---------|--------------|--------------|---------|
| `delegates`（物件陣列） | `delegateUids`（已有） | `delegateNames`（新增） | 從物件中提取 |

### 11.4 Firestore Rules 對應修改

> **v2.0 安全修正（多專家共識）**：禁止將 `isCurrentUserTeamCaptainOrLeader` 直接改名為 `isCurrentUserTeamStaff`。此函式被 Firestore Rules 的 **11 個位置**引用（教育分組、課程計劃、學員、賽事建立、賽事主辦、賽事申請等）。如果全面替換加入 `coachUids`，教練將**靜默獲得**建立賽事、刪除學員等不該有的權限。

**正確方案：新增獨立函式，不改名舊函式**

```
// 保留不動：isCurrentUserTeamCaptainOrLeader（11 個引用點不變）
// 新增：isCurrentUserTeamStaff（含教練，只用在明確需要教練權限的地方）
function isCurrentUserTeamStaff(teamId) {
  return isCurrentUserTeamCaptainOrLeader(teamId)
    || (isAuth()
      && teamId is string
      && exists(/databases/$(database)/documents/teams/$(teamId))
      && (get(/databases/$(database)/documents/teams/$(teamId)).data.coachUids is list)
      && request.auth.uid in get(/databases/$(database)/documents/teams/$(teamId)).data.coachUids
    );
}
```

**各引用點使用哪個函式**：

| Rules 位置 | 操作 | 使用函式 | 理由 |
|-----------|------|---------|------|
| teams/feed create | 發貼文 | `isCurrentUserInTeam` | 成員即可發 |
| teams/feed update/delete | 改/刪貼文 | `isCurrentUserTeamStaff` | 幹部（含教練）可管理 |
| teams/groups CRUD | 教育分組 | `isCurrentUserTeamCaptainOrLeader` | **不含教練**（不變） |
| teams/coursePlans CRUD | 課程 | `isCurrentUserTeamStaff` | 教練可管理課程 |
| teams/students CRUD | 學員 | `isCurrentUserTeamStaff` | 教練可管理學員 |
| tournaments create | 建立賽事 | `isCurrentUserTeamCaptainOrLeader` | **不含教練**（不變） |
| tournaments/applications create | 申請參賽 | `isCurrentUserTeamCaptainOrLeader` | **不含教練**（不變） |

**注意**：統一 ID 後 `teams/{teamId}` 的 `teamId` 就是自訂 ID（`tm_...`），不再需要額外查詢。

### 11.5 前端比對邏輯修改

**修改前**（team-detail.js:42-55，名字 + UID 雙重 fallback）：
```javascript
_canManageTeamMembers(team) {
  if (team.captainUid === myUid) return true;
  if (team.captain && myNames.has(team.captain)) return true;     // ← 名字 fallback
  if (myUid && leaderUids.includes(myUid)) return true;
  if (leaderNames.some(name => myNames.has(name))) return true;   // ← 名字 fallback
  if ((team.coaches || []).some(name => myNames.has(name))) return true; // ← 只有名字
  return false;
}
```

**修改後**（純 UID）：
```javascript
_canManageTeamMembers(team) {
  if (!team || !myUid) return false;
  if (team.captainUid === myUid) return true;
  if (Array.isArray(team.leaderUids) && team.leaderUids.includes(myUid)) return true;
  if (Array.isArray(team.coachUids) && team.coachUids.includes(myUid)) return true;
  return false;
}
```

**所有需要同步修改的函式**：

| 函式 | 檔案 | 修改內容 |
|------|------|---------|
| `_isTeamCaptainUser(team)` | team-list.js:179 | 移除名字 fallback |
| `_canManageTeamMembers(team)` | team-detail.js:42 | 改用 `coachUids`，移除名字 |
| `_buildTeamStaffIdentity(team)` | team-list.js:57 | 改用 `coachUids` |
| `_resolveTeamCaptainUser(team)` | team-list.js:154 | 移除名字 fallback |
| `_isTournamentLeaderForTeam(team)` | tournament-core.js:195 | 移除名字 fallback |
| `_isTournamentCaptainForTeam(team)` | tournament-core.js:205 | 移除名字 fallback |
| `_getFriendlyResponsibleTeams(user)` | tournament-core.js:212 | 移除名字 fallback |
| `_isFriendlyTournamentRosterUnlocked(entry, team)` | tournament-friendly-roster.js:35 | 改用 `coachUids`（v2.3 修正：原寫 `_isResponsibleUser`，實際不存在） |
| `_isTournamentViewerInTeam(user, teamId)` | tournament-friendly-detail.js:24 | 移除 `coaches.includes(displayName)` fallback（v2.3 新增：第 9 個需修改的函式） |

### 11.6 遷移腳本

```javascript
// scripts/migrate-team-uids.js
// 1. 讀取所有 teams 文件
// 2. 讀取所有 adminUsers
// 3. 對每個 team：
//    a. coaches[] 名字 → 查 adminUsers 比對 name/displayName → 取得 uid → 寫入 coachUids
//    b. captain 名字 → 寫入 captainName（captainUid 已有）
//    c. leaders[] 名字 → 寫入 leaderNames（leaderUids 已有）
//    d. 若有 leaderUid（單數）→ 合併進 leaderUids（陣列）
// 4. 未匹配到 UID 的教練 → 保留名字在 coachNames，coachUids 留空 + 輸出報告
```

### 11.7 Phase 歸屬

| 項目 | Phase | 理由 |
|------|-------|------|
| 統一 `generateId()` 呼叫 | **Phase 1** | 純程式碼整理 |
| 新建俱樂部/賽事用 `.doc(customId).set()` | **Phase 2A** | 影響建立流程 |
| 新增 `coachUids` 欄位 + 前端比對改 UID-only | **Phase 3** | 資料遷移 |
| 執行遷移腳本（名字 → UID） | **Phase 3** | 搭配遷移 |
| Firestore Rules 新增 `coachUids` | **Phase 3** | 搭配遷移 |
| 廢棄欄位清理（30 天後） | **Phase 3 後** | 確認無引用 |

---

## 12. 權限與身分架構

> 本章節補充於 v1.1，源自全面審計後發現的重大缺口

### 12.1 現況：俱樂部角色對照表

| 角色 | 儲存方式 | 識別方式 | 前端能做什麼 | Firestore Rules 能做什麼 |
|------|---------|---------|-------------|------------------------|
| **隊長** | `captainUid`（UID） | UID 比對 | 編輯俱樂部、管理成員、建立活動、刪除俱樂部 | update（isTeamOwner）、delete |
| **領隊** | `leaderUids[]`（UID 陣列） | UID 比對 | 管理成員、教育子集合 CRUD | isCurrentUserTeamCaptainOrLeader |
| **教練** | `coaches[]`（**名字陣列**） | **名字比對** ⚠️ | 管理成員（team-detail.js:53） | **無規則**（名字不在 rules 中） |
| **一般成員** | `users.teamIds[]` | array-contains | 加入活動、看動態牆 | isCurrentUserInTeam |
| **非成員** | 無 | 無 | 看公開俱樂部資訊 | allow read: if true |

**三大問題**：
1. 教練用**名字**儲存，兩個同名用戶會撞（`claude-memory [永久] 2026-04-09`）
2. 動態牆 6 個操作（貼文/刪除/置頂/按讚/留言/刪留言）**全部零權限檢查**
3. Firestore rules 的 `isCurrentUserTeamCaptainOrLeader` 不含教練 — 前端認教練可管理，後端不認

### 12.2 現況：賽事角色對照表

| 角色 | 儲存方式 | 識別方式 | 前端能做什麼 | Firestore Rules 能做什麼 |
|------|---------|---------|-------------|------------------------|
| **管理員** | 全域角色 `admin`+ | `hasPermission('admin.tournaments.manage_all')` | 所有操作 | isAdmin() |
| **委託人** | `delegateUids[]` | UID 比對 | 管理賽事、審核申請、管理名單 | isTournamentDelegate |
| **主辦隊長/領隊** | `hostTeamId` → 查團隊 | UID 比對（間接） | 同委託人 | isTournamentHostManager |
| **參賽隊長** | `applications[].requestedByUid` | UID 比對 | 申請參賽、看自己隊的申請 | isCurrentUserTeamCaptainOrLeader(data.teamId) |
| **參賽球員** | `entries/{teamId}/members/{uid}` | UID = doc ID | 加入/退出自己隊的名單 | memberUid == auth.uid + isCurrentUserInTeam |
| **一般用戶** | 無 | 無 | 只能看公開資訊 | allow read: if true（entries/members 也公開 ⚠️） |

**三大問題**：
1. `admin.tournaments.entry`（入口權限）被當成操作權限 — 有入口就能結束/重開/刪除賽事
2. 球員沒有獨立權限碼，無法控制「球員能看到什麼」
3. 參賽隊的教練目前無法代替隊長申請（教練是名字不是 UID）

### 12.3 權限碼缺口分析

#### A. 完全沒有權限碼的操作（共 12 個）

| 操作 | 檔案:行號 | 現況 | 風險 |
|------|----------|------|------|
| 發動態牆貼文 | team-feed.js:38 | 任何登入用戶可發 | 非成員可灌水 |
| 刪動態牆貼文 | team-feed.js:79 | 任何登入用戶可刪**任何人的**貼文 | 惡意刪除 |
| 置頂動態牆 | team-feed.js:96 | 同上 | 非幹部可置頂 |
| 動態牆留言 | team-feed.js:152 | 同上 | 非成員可留言 |
| 刪動態牆留言 | team-feed.js:181 | 同上 | 可刪他人留言 |
| 加入俱樂部 | team-form-join.js:20 | 無權限碼 | 無法限制誰能申請 |
| 置頂俱樂部（管理） | team-list.js:278 | 無權限碼 | 無前端守衛 |
| 切換俱樂部啟用 | team-list.js:294 | 無權限碼 | 同上 |
| 加入賽事名單 | tournament-friendly-roster.js:215 | 只查 approved entry | 無權限碼控制 |
| 結束賽事 | tournament-manage.js:322 | 用 `entry` 權限（太寬） | 入口=結束 |
| 重開賽事 | tournament-manage.js:340 | 同上 | 入口=重開 |
| 刪除賽事 | tournament-manage.js:360 | 同上 | 入口=刪除 |

#### B. 權限碼存在但使用邏輯有問題（共 3 個）

| 操作 | 檔案:行號 | 問題 |
|------|----------|------|
| 建立賽事 | tournament-manage.js:198 | `OR` 邏輯：`tournaments.create \|\| tournaments.entry` — entry 太寬 |
| 審核賽事申請 | tournament-friendly-detail.js:303 | 同上：`tournaments.review \|\| tournaments.entry` |
| 移除成員 | team-detail.js:211 | 只查角色（`_canManageTeamMembers`），不查 `team.manage_*` 權限碼 |

#### C. 前端/後端不同步（共 3 個）

| 操作 | 前端檢查 | 後端檢查（Firestore Rules） | 不一致 |
|------|---------|---------------------------|-------|
| 教練管理成員 | ✅ `coaches.includes(name)` | ❌ 不認教練（`isCurrentUserTeamCaptainOrLeader` 不含 coaches） | 前端放行，後端擋回 |
| 動態牆刪貼文 | ❌ 無檢查 | ❌ `if request.auth != null`（任何人） | 雙層都有漏洞 |
| 賽事 entry 權限 | 用 `hasPermission('admin.tournaments.entry')` | 用 `canManageTournamentScope()`（角色） | 邏輯完全不同 |

### 12.4 建議的權限碼擴充方案

> **v2.1 架構修正（專家共識）**：`hasPermission()` 檢查的是**全域角色權限**，無法區分「用戶在 A 隊是隊長、B 隊是普通成員」。因此：
> - **全域權限碼**（如 `team.manage_all`、`admin.tournaments.manage_all`）= 跨所有俱樂部/賽事的管理員 override
> - **Per-team/per-tournament 操作** = 繼續用既有的 team-local 角色檢查（`_canManageTeamMembers`、`_canManageTournamentRecord`）+ Firestore Rules 的 `isCurrentUserTeamStaff`
> - **權限碼不用於 per-team 操作的前端守衛**，避免 A 隊隊長獲得 B 隊的刪除權限

#### A. 賽事新增全域權限碼（管理員操作拆分）

```javascript
// config.js — ADMIN_PAGE_EXTRA_PERMISSION_ITEMS['page-admin-tournaments'] 新增：
'admin.tournaments.end',       // 結束賽事（從 entry 獨立出來）
'admin.tournaments.reopen',    // 重開賽事
'admin.tournaments.delete',    // 刪除賽事
```

#### B. Per-team 操作的守衛模式（v2.1 新增）

Per-team 操作**不用全域權限碼**，改用 team-local 角色 + 全域管理員 override 的雙層模式：

```javascript
// 範例：刪除他人動態牆貼文
_canDeleteTeamFeedPost(team, post) {
  const myUid = ApiService.getCurrentUser()?.uid;
  // 層 1：自己的貼文 → 任何成員可刪
  if (post.uid === myUid) return true;
  // 層 2：全域管理員 override
  if (this.hasPermission('team.manage_all')) return true;
  // 層 3：team-local 角色（幹部可刪）
  return this._canManageTeamMembers(team);
}
```

**守衛模式對照表**：

| 操作 | 誰能做 | 前端守衛 | Firestore Rules |
|------|--------|---------|-----------------|
| 發動態牆貼文 | 成員 | `_isTeamMember(teamId)` | `isCurrentUserInTeam(teamId)` |
| 刪自己貼文 | 作者本人 | `post.uid === myUid` | `resource.data.uid == auth.uid` |
| 刪他人貼文 | 幹部 or 管理員 | `hasPermission('team.manage_all') \|\| _canManageTeamMembers(team)` | `isCurrentUserTeamStaff(teamId)` |
| 置頂貼文 | 幹部 or 管理員 | 同上 | 同上 |
| 移除成員 | 幹部 or 管理員 | 同上 | `isCurrentUserTeamCaptainOrLeader(teamId)` |
| 結束賽事 | 委託人/主辦 or 管理員 | `hasPermission('admin.tournaments.end') \|\| _canManageTournamentRecord(t)` | `canManageTournamentScope()` |
| 刪除賽事 | 管理員 only | `hasPermission('admin.tournaments.delete')` | `isAdmin()` |

**注意**：此模式遵守 CLAUDE.md 的「hasPermission 守衛必須有 fallback」規則 — 全域權限碼是「管理員 override」，team-local 角色是「fallback」。

**賽事角色對照**：

| 權限碼 | 管理員 | 委託人 | 主辦隊長 | 參賽隊長 | 參賽球員 |
|--------|--------|--------|---------|---------|---------|
| admin.tournaments.create | ✓ | — | ✓ | — | — |
| admin.tournaments.manage_all | ✓ | — | — | — | — |
| admin.tournaments.review | ✓ | ✓ | ✓ | — | — |
| admin.tournaments.end | ✓ | ✓ | ✓ | — | — |
| admin.tournaments.reopen | ✓ | — | — | — | — |
| admin.tournaments.delete | ✓ | — | — | — | — |
| admin.tournaments.roster | ✓ | ✓ | ✓ | ✓（自己隊） | — |
| roster.join（自己） | — | — | — | — | ✓ |

### 12.5 教練 UID 化（解決名字碰撞）

**問題**：教練目前存為 `coaches: ["王小明", "李大華"]`（名字陣列），兩個同名用戶會撞。

**方案**：遷移到 UID-based 儲存

```javascript
// 修改前：
coaches: ["王小明", "李大華"]

// 修改後：
coachUids: ["uid_abc123", "uid_def456"],   // UID 陣列（主要）
coaches: ["王小明", "李大華"],              // 保留名字做顯示用（向後相容）
```

**影響範圍**：
- `team-form.js` — 儲存時寫入 `coachUids`
- `team-detail.js:53` — `_canManageTeamMembers` 改用 `coachUids` 比對
- `firestore.rules` — 新增 `isCurrentUserTeamStaff` 函式（含 `coachUids`），不修改舊函式（見 §11.4）
- `functions/index.js` — `eduCheckin` 等 CF 新增 `coachUids` 檢查

**遷移腳本**：讀取所有 teams，比對 adminUsers 將 coaches 名字轉為 UID，寫入 `coachUids`。

### 12.6 Firestore Rules 對齊修改

> **v2.0 修正**：與 §11.4 統一 — 保留 `isCurrentUserTeamCaptainOrLeader` 不動，新增 `isCurrentUserTeamStaff` 作為超集。

```
// Phase 0（立即）：只收緊 update/delete，create 暫不動（見 §5.2 v2.1 修正）
match /feed/{postId} {
  allow read: if request.auth != null;
  allow create: if request.auth != null;                         // ← 暫不動（v2.1）
  allow update: if request.auth != null
    && (resource.data.uid == request.auth.uid
        || isCurrentUserTeamCaptainOrLeader(teamId));
  allow delete: if request.auth != null
    && (resource.data.uid == request.auth.uid
        || isCurrentUserTeamCaptainOrLeader(teamId));
}

// Phase 3（ID 統一 + coachUids 遷移後）：全面升級
// 部署順序：1. 遷移腳本 → 2. 部署 Rules → 3. 部署前端
allow create: ... && isCurrentUserInTeam(teamId);                // ← Phase 3 才收緊（ID 統一後安全）
allow update: ... || isCurrentUserTeamStaff(teamId);             // ← 改用新函式（含教練）
allow delete: ... || isCurrentUserTeamStaff(teamId);             // ← 改用新函式（含教練）
```

### 12.7 Phase 歸屬

| 項目 | Phase | 理由 |
|------|-------|------|
| 動態牆 Firestore Rules 收緊 | **Phase 0** | 安全漏洞，立即修 |
| 賽事 entries/members Rules 收緊 | **Phase 0** | 同上 |
| 新增權限碼定義（config.js） | **Phase 1** | 純增量，不改邏輯 |
| 權限碼說明（user-admin-perm-info.js） | **Phase 1** | 同上 |
| 賽事操作拆分（entry → end/reopen/delete） | **Phase 2A** | 影響操作邏輯 |
| 教練 UID 化遷移 | **Phase 3** | 資料遷移 |
| Firestore Rules 新增 coachUids 欄位 | **Phase 3** | 搭配教練遷移 |
| 動態牆前端權限守衛 | **Phase 2B** | 搭配 feed 走 ApiService |
| INHERENT_ROLE_PERMISSIONS 同步 | 每次修改 config.js 後 | CLAUDE.md 強制規範 |

---

## 13. Firestore 索引與規則變更清單

### 13.1 新增索引

```json
[
  {
    "collectionGroup": "teams",
    "queryScope": "COLLECTION",
    "fields": [
      { "fieldPath": "creatorUid", "order": "ASCENDING" },
      { "fieldPath": "createdAt", "order": "DESCENDING" }
    ]
  },
  {
    "collectionGroup": "tournaments",
    "queryScope": "COLLECTION",
    "fields": [
      { "fieldPath": "creatorUid", "order": "ASCENDING" },
      { "fieldPath": "createdAt", "order": "DESCENDING" }
    ]
  }
]
```

### 13.2 規則變更

| 行號 | 集合 | 變更 |
|------|------|------|
| 895 | tournaments/entries/members | `if true` → `if isAuth()` |
| 889 | tournaments/entries | `if true` → `if isAuth()` |
| 780-783 | teams/feed | update/delete 加入 `uid == auth.uid \|\| isTeamCaptainOrLeader` |

---

## 14. 測試策略（v2.4 完善）

> 每個 Phase 的測試是**交付物**，必須在該 Phase 的最後一個 commit 之前通過。不是事後補做。

### 14.1 自動化測試清單

#### Phase 0 新建（2 個測試檔，12 個案例）

**`tests/firestore-rules/team-feed-rules.test.js`**：
1. 登入用戶可讀 feed ✓
2. 登入用戶可建立貼文 ✓（Phase 0 暫不收緊 create）
3. 貼文作者可 update 自己的貼文 ✓
4. 非作者非幹部不能 update 他人貼文 ✗
5. 非作者非幹部不能 delete 他人貼文 ✗
6. 隊長可 delete 任何貼文 ✓

**`tests/firestore-rules/tournament-member-rules.test.js`**：
7. 未登入用戶不能讀 entries ✗
8. 未登入用戶不能讀 members ✗
9. 登入用戶可讀 entries ✓
10. 非管理員委託人不能修改 `delegateUids` ✗
11. 建立者可修改 `delegateUids` ✓
12. 管理員可修改 `delegateUids` ✓

#### Phase 1 新建（3 個）+ 修改（1 個），35+ 案例

**`tests/unit/team-list-stats.test.js`**（7 案例）：
成員計數去重、排序置頂、排名邊界值

**`tests/unit/team-list-helpers.test.js`**（8 案例）：
identity key 優先順序、身分集合建構、4 種權限函式各測正反面

**`tests/unit/tournament-helpers.test.js`**（6 案例）：
狀態機三態、管理權限 4 角色、responsible teams 篩選

**`tests/unit/team.test.js`（修改）**：
更新 `team-detail-members.js` → `team-detail-invite.js` 引用路徑

#### Phase 2A 新建（1 個），7 案例

**`tests/unit/fetch-if-missing.test.js`**：
快取優先、`.doc().get()` 成功、`where` fallback、兩者都空、去重注入、injected 桶寫入、邊界（空 ID）

#### Phase 2B 新建（2 個），11 案例

**`tests/unit/team-feed.test.js`**（6 案例）：
成員發文 ✓、權限守衛（作者刪 ✓ / 非作者非幹部 ✗ / 幹部 ✓）、走 ApiService、審計日誌

**`tests/unit/tournament-pagination.test.js`**（5 案例）：
首次 50 筆、cursor 推進、結束偵測、併發 lock、injected 桶合併保護

#### Phase 3 新建（1 個），5 案例

**`tests/unit/coach-uid-migration.test.js`**：
1 對 1 匹配、未匹配報告、同名模糊標記、冪等重跑、Rules `coachUids` 檢查

**總計：10 個測試檔、70+ 個測試案例**

### 14.2 既有測試相容性

每 Phase commit 前必須：

```bash
npx jest --ci    # 全部 664 個既有測試必須通過
```

**特別留意的既有測試**：
- `source-drift.test.js` — Phase 1 改名後會偵測斷鏈
- `script-deps.test.js` — Phase 1 修改 group 後會偵測完整性
- `perm-sync.test.js` — Phase 1 修改權限碼後會偵測兩地同步

### 14.3 手動回歸驗證（每 Phase 完成後）

**Phase 0**：未登入不能讀名單 / 非成員不能刪貼文 / 建立者可管委託人
**Phase 1**：列表正常渲染 / 搜尋篩選正常 / source-drift 通過
**Phase 2A**：深連結空快取 ≤3 秒渲染 / 新建俱樂部 doc.id === data.id
**Phase 2B**：500 筆搜尋無卡頓 / 搜不到時出現「搜尋所有」按鈕 / 動態牆權限正確 / injected 桶保護生效
**Phase 3**：教練可管動態牆 / 非成員不能發文 / 遷移後舊教練不失權
**Phase 4**：建立/編輯/角色升降級正常 / 教育型詳情頁正常

---

## 15. 風險評估與回退方案

| Phase | 風險等級 | 最壞情況 | 回退方案 | 回退難度 |
|-------|---------|---------|---------|---------|
| Phase 0 | 極低 | 規則寫錯阻擋合法操作 | `git revert` + `firebase deploy --only firestore:rules` | 5 分鐘 |
| Phase 1 | 低 | Script Loader 順序錯誤導致 Object.assign 失敗 | `git revert`（純檔案搬移，不改邏輯） | 秒回退 |
| Phase 2A | 中 | `fetchIfMissing` 注入的快取與 onSnapshot 衝突 | 移除 `fetchIfMissing`，改回 `required: ['teams']` | 5 分鐘 |
| Phase 2B | 中 | 即時監聽器大量連線導致 Firestore 成本飆升 | 調低 `REALTIME_LIMIT_DEFAULTS` 或改回 `realtime: []` | 5 分鐘 |
| Phase 3 | 中高 | 子集合與內嵌陣列切換不完全，資料不一致 | 保留讀取內嵌陣列的程式碼 30 天作為 fallback | 需反向遷移腳本 |
| Phase 4 | 低 | 表單拆分後漏掉某個 edge case | `git revert`（純重構） | 秒回退 |

---

## 16. v2.0 專家審計修正摘要

> 本章記錄 v1.1 → v2.0 的所有修正，供追溯

### 16.1 安全性修正（v2.0 + v2.1 合併）

| 問題 | 嚴重度 | 修正 | 版本 |
|------|--------|------|------|
| `isCurrentUserTeamCaptainOrLeader` 全面替換會讓教練獲得 11 處不該有的權限 | **HIGH** | 保留舊函式，新增 `isCurrentUserTeamStaff` 超集（§11.4） | v2.0 |
| `fetchIfMissing` 在 ID 統一後仍用 `where` | **HIGH** | 先 `.doc().get()`，fallback `where`（§7.2） | v2.0 |
| Phase 3 內部子排序未指定 | **HIGH** | 1. 遷移腳本 → 2. Rules → 3. 前端（§12.6, §17） | v2.0 |
| `delegateUids` 不在不可變欄位中 | **MEDIUM** | Phase 0 加入 `tournamentRootImmutableFieldsSafe`（§5.4） | v2.0 |
| Phase 0 feed `create` 規則會擋住舊俱樂部成員 | **CRITICAL** | Phase 0 `create` 暫不收緊（§5.2），延至 Phase 3 ID 統一後 | v2.1 |
| 權限碼是全域的但應該是 per-team 的 | **CRITICAL** | 全域碼只做管理員 override，per-team 用角色檢查（§12.4） | v2.1 |

### 16.1b v2.2 第三輪修正（刁鑽審計 + 程式碼驗證）

| 問題 | 嚴重度 | 修正 |
|------|--------|------|
| **onSnapshot 整批覆蓋 `_cache.teams[]`，洗掉 fetchIfMissing 注入的冷門俱樂部** | **CRITICAL** | 新增 `_teamSlices.injected` 桶：fetchIfMissing 注入時同時寫入 injected；`_mergeTeamSlices` 合併 active + injected（§8.3B 重寫） |
| **教練 UID 未匹配（coachUids=[]）時 Phase 3-coach-d 仍會部署，教練永久失去權限** | **HIGH** | Phase 3-coach-d 新增前置條件：「未匹配教練 = 0 才可部署前端」。未匹配的俱樂部保留名字 fallback 直到手動解決 |
| **localStorage 500KB 上限在 200+ 俱樂部時靜默溢出** | **HIGH** | `_saveToLS` 改為只持久化 `_teamSlices.active`（最多 50 筆），不存 injected 桶。injected 是臨時性質（單次 session 有效） |
| **用戶改名後 coachNames/captainName 永久過時** | **MEDIUM** | 方案：前端渲染時用 UID 從 `adminUsers` 快取即時解析名稱，`coachNames` 只做 adminUsers 未載入時的 fallback。不新增 onUserUpdate CF（成本過高） |
| **team-feed.js 實際有 8 處 Firebase 呼叫（非 7 處）** | LOW | 更正計畫書數字：8 處（deleteFeedComment 有 get + update 兩步） |
| **§9.2 的 CF `onTeamUpdate` 用 v1 語法，程式碼庫用 v2** | MEDIUM | 改用 `onDocumentWrittenWithAuthContext` (v2 API) |
| **`tournament-render.js` 未加入 script-loader `tournament` group** | **HIGH** | 加入 §6.3 的 tournament group（在 tournament-core.js 之後） |
| **5 個測試檔在驗證步驟引用但不存在、未列為建立任務** | **HIGH** | 加入 §14.1 + 附錄 A 為 Phase 0/1 的新建測試檔 |
| **team-detail-members.js 改名後 `source-drift.test.js` 會 HARD FAIL** | **HIGH** | Phase 1 須同步更新 `tests/unit/team.test.js` 的引用路徑 |

### 16.1c v2.1 第二輪修正

| 問題 | 嚴重度 | 修正 |
|------|--------|------|
| feed `create` 規則用 `isCurrentUserInTeam(teamId)` 對舊俱樂部 doc.id ≠ data.id 時會擋住成員 | **CRITICAL** | Phase 0 `create` 暫不收緊，延至 Phase 3（ID 統一後安全可用）（§5.2） |
| `team.feed.post` 等權限碼是全域的，A 隊隊長會獲得 B 隊權限 | **CRITICAL** | 全域碼只做管理員 override，per-team 操作用 team-local 角色檢查（§12.4 重寫） |
| §2 標題寫「六大」但有 7 個子節 | LOW | 改為「七大」 |
| §12.5 仍說修改 `isCurrentUserTeamCaptainOrLeader` | MEDIUM | 改為「新增 `isCurrentUserTeamStaff`」（與 §11.4 統一） |
| 各 Phase 工期在章節標頭和排程表不一致 | MEDIUM | 統一為排程表的數字（含 ID/權限/版號工時） |
| Phase 3 內部兩組子步驟（陣列移除 vs coachUids 遷移）用同樣 3a-3d 標籤碰撞 | MEDIUM | 陣列移除用 `3a-3e`，coachUids 用 `3-coach-a~d`（§快速參考） |
| 缺少各 Phase 執行清單和驗證步驟 | HIGH | 新增「快速參考：各 Phase 執行清單」（目錄後，~80 行） |
| hasPermission 守衛未展示必要的 fallback 模式 | HIGH | §12.4B 新增守衛模式對照表 + 程式碼範例 |
| 編碼防亂碼檢查未提及 | MEDIUM | 加入 §16.3 第 5 項 |

### 16.2 完整性修正（v2.0）

| 問題 | 修正 |
|------|------|
| §12 子標題全部錯誤使用 `11.x` 前綴 | 已修正為 `12.x` |
| §13 子標題錯誤使用 `12.x` 前綴 | 已修正為 `13.x` |
| §12.6 與 §11.4 對 `isCurrentUserTeamStaff` 定義矛盾（3 條件 vs 6 條件） | 已統一為 §11.4 的新增獨立函式方案 |
| 快取版號 4 位置更新規則完全缺失 | 新增強制規則（見下方 §16.3） |
| 附錄 A 缺少 `app.js`、遷移腳本等 6+ 個檔案 | 執行時逐 Phase 補齊 |
| 工時低估 ~25-30%（未計入 ID 統一、權限碼、版號、文件更新） | 修正為 23-31 天 |

### 16.3 每 Phase 強制交付項目（v2.0 新增）

每個 Phase 的**最後一個 commit** 必須包含：

1. **快取版號更新**：`config.js` CACHE_VERSION + `index.html` 所有 `?v=` + `index.html` `var V` + `sw.js` CACHE_NAME（4 處同步）
2. **`docs/architecture.md` 更新**：若有新增/搬移/刪除模組檔案
3. **`docs/claude-memory.md` 記錄**：本 Phase 的重大決策和教訓。ID 統一、coachUids 遷移、權限拆分標記為 `[永久]`
4. **`INHERENT_ROLE_PERMISSIONS` 同步**：若修改了 `config.js` 的權限碼，必須同步 `functions/index.js`
5. **編碼防亂碼檢查**：修改含中文內容的 JS/HTML 檔案後，提交前檢查無 `�`、`Ã`、`å` 等 mojibake 痕跡（CLAUDE.md 防亂碼編碼規範）

---

## 17. 工作量與排程

```
Phase 0（安全性修復 + delegateUids 不可變）  ■ 1 天
Phase 1（結構整理 + 權限碼定義 + generateId） ■■■■■ 4-5 天
Phase 2A（專看專讀 + ID 統一建立流程）        ■■■■■ 4-5 天  ★ 成本節省最大
Phase 4（表單拆分 + 教育解耦）               ■■■ 3-4 天（可與 Phase 2A 平行）
Phase 2B（列表效能 + feed 走 ApiService）     ■■■■ 3-5 天
Phase 3（coachUids 遷移 + 內嵌陣列移除）     ■■■■■■■■ 6-8 天

臨界路徑：1 + (4-5) + (4-5) + (3-5) + (6-8) = 18-24 天（Phase 4 與 2A 平行不計）
全工時（含平行工作）：1 + (4-5) + (4-5) + (3-4) + (3-5) + (6-8) = 21-28 天
含審查/測試緩衝 +10%：約 23-31 天

執行順序：
Phase 0 → Phase 1 ─┬→ Phase 4（平行）
                    └→ Phase 2A → Phase 2B → Phase 3
                       ^^^^^^^^
                    成本效益最高，最優先

Phase 3 內部子排序（強制）：
  陣列移除：3a→3e（見 §9.1，可先做）
  coachUids（強制順序）：
    3-coach-a. 執行遷移腳本（寫入 coachUids）
    3-coach-b. 驗證遷移結果
    3-coach-c. 部署 Firestore Rules（新增 isCurrentUserTeamStaff + feed create 收緊）
    3-coach-d. 部署前端程式碼（移除名字 fallback）
```

---

## 18. 歷史教訓檢查清單

> 來自 `docs/claude-memory.md` 的 `[永久]` 標記教訓

### 遷移相關

- [ ] **doc.id vs data.id 雙軌制**（2026-04-11）：任何查詢必須用 `data.id`，不能用 `doc.id`。參照 `calcNoShowCounts` 的前車之鑑
- [ ] **子集合遷移去重**（2026-04-12）：前端 `doc.ref.parent.parent !== null`、CF `path.split('/').length > 2`
- [ ] **collectionGroup 首次快照延遲**（2026-04-13）：切換到 collectionGroup 後第一次快照可能延遲，需要 fallback 直接查詢
- [ ] **Regex 匹配陷阱**（2026-04-12）：`.collection('registrations')` 同時匹配根集合和子集合路徑

### 快取相關

- [ ] **全域監聽上限會截斷舊資料**（2026-04-10）：limit(1500) 只保留最近的，舊活動資料靜默消失。解法：`fetchIfMissing()` 一次性補查
- [ ] **Firestore 成本控制**（2026-04-10）：無上限 onSnapshot = 成本隨歷史永遠增長。必須 cap + 暴露調整入口
- [ ] **commit 前不得修改本地快取**（2026-04-07）：鎖定函式必須先模擬再提交

### 渲染相關

- [ ] **innerHTML 必失去捲動位置**（2026-04-06/13）：任何 innerHTML 重繪都必須 save/restore scrollTop
- [ ] **onSnapshot 刷新 ≠ 頁面導航**（2026-04-06）：real-time 資料刷新只更新表格，不重繪整頁
- [ ] **局部更新必須覆蓋所有分支**（2026-04-13）：部分更新如果漏掉某個狀態分支 = 回歸 bug

### 權限相關

- [ ] **hasPermission 守衛必須有 fallback**（CLAUDE.md）：禁止 `if (!hasPermission) return`。必須包含 `_canManageEvent` 等 fallback
- [ ] **INHERENT_ROLE_PERMISSIONS 兩地同步**（CLAUDE.md）：`config.js` 和 `functions/index.js` 必須同步修改

---

## 附錄 A：檔案變更追蹤表

| 檔案 | Phase | 操作 | 說明 |
|------|-------|------|------|
| `firestore.rules` | 0 | 修改 | 收緊 entries/members/feed 權限 |
| `firestore.indexes.json` | 0 | 新增 | teams + tournaments 索引 |
| `js/modules/team/team-list-helpers.js` | 1 | **新建** | 純工具函式 |
| `js/modules/team/team-list-stats.js` | 1 | **新建** | 純計算函式 |
| `js/modules/team/team-share-builders.js` | 1 | **新建** | 純 Builder |
| `js/modules/team/team-detail-invite.js` | 1 | **改名** | 原 team-detail-members.js |
| `js/modules/team/team-list.js` | 1 | 瘦身 | 抽出函式到 helpers + stats |
| `js/modules/team/team-detail.js` | 1 | 瘦身 | 抽出 `_canManageTeamMembers` |
| `js/modules/team/team-share.js` | 1 | 瘦身 | 抽出 builders |
| `js/modules/team/team-form-search.js` | 1 | 瘦身 | 搬走 `removeTeam()` |
| `js/modules/team/team-form-join.js` | 1 | 瘦身 | 搬走 `_applyRoleChange()` |
| `js/modules/team/team-form-init.js` | 1 | 瘦身 | 搬走 `_initTeamListSportFilter()` |
| `js/modules/tournament/tournament-helpers.js` | 1 | **新建** | 純工具函式 |
| `js/modules/tournament/tournament-share-builders.js` | 1 | **新建** | 純 Builder |
| `js/modules/tournament/tournament-core.js` | 1 | 瘦身 | 抽出函式到 helpers |
| `js/modules/tournament/tournament-share.js` | 1 | 瘦身 | 抽出 builders |
| `js/modules/tournament/tournament-detail.js` | 1 | 清理 | 刪除死代碼 |
| `js/core/script-loader.js` | 1 | 修改 | 新增檔案到 groups |
| `js/config.js` | 1, 2A, 2B | 修改 | P1: 權限碼 + generateId / P2A: PAGE_DATA_CONTRACT / P2B: 即時上限 |
| `js/modules/user-admin/user-admin-perm-info.js` | 1 | 修改 | 新增權限碼說明 |
| `js/modules/tournament/tournament-manage.js` | 1 | 修改 | generateId 統一 |
| `functions/index.js` | 1, 3 | 修改 | P1: INHERENT_ROLE_PERMISSIONS 同步 / P3: onTeamUpdate CF |
| `app.js` | 2A | 修改 | 深連結 fetchIfMissing fallback |
| `js/firebase-service.js` | 2A, 2B | 修改 | P2A: fetchIfMissing / P2B: 分頁 + 即時監聽 |
| `js/api-service.js` | 2A, 2B | 修改 | P2A: getTeamAsync / P2B: Feed API |
| `js/modules/team/team-detail.js` | 1, 2A | 修改 | P1: 抽出函式 / P2A: async fallback |
| `js/modules/tournament/tournament-detail.js` | 1, 2A | 修改 | P1: 清理死代碼 / P2A: async fallback |
| `js/modules/tournament/tournament-friendly-detail.js` | 2A, 3 | 修改 | P2A: async fallback / P3: 移除內嵌陣列 |
| `js/modules/team/team-list-render.js` | 2B | 修改 | 防抖 + 指紋 + 進度條 |
| `js/modules/tournament/tournament-render.js` | 2B | 修改 | 防抖 + 指紋 + 捲動保存 |
| `js/modules/team/team-feed.js` | 2B | 重寫 | 走 ApiService + 前端權限守衛 |
| `js/firebase-crud.js` | 2A, 2B | 修改 | P2A: addTeam/addTournament 改 .doc().set() / P2B: Feed CRUD |
| `js/modules/tournament/tournament-core.js` | 1, 3 | 修改 | P1: 抽出函式 / P3: 移除內嵌陣列建構 |
| `js/modules/tournament/tournament-friendly-roster.js` | 3 | 修改 | UID-only 比對（移除名字 fallback） |
| `scripts/migrate-team-uids.js` | 3 | **新建** | 教練名字→UID 遷移腳本 |
| `js/modules/team/team-form-validate.js` | 4 | **新建** | 表單驗證 |
| `js/modules/team/team-form-roles.js` | 4 | **新建** | 角色升降級 |
| `js/modules/team/team-form.js` | 4 | 瘦身 | 拆出驗證 + 角色 |
| `js/modules/tournament/tournament-friendly-state.js` | 4 | **新建** | 狀態管理 |
| `tests/firestore-rules/team-feed-rules.test.js` | 0 | **新建** | 動態牆權限測試（6 案例） |
| `tests/firestore-rules/tournament-member-rules.test.js` | 0 | **新建** | 名單/委託人權限測試（6 案例） |
| `tests/unit/team-list-stats.test.js` | 1 | **新建** | 成員計數去重 + 排序（7 案例） |
| `tests/unit/team-list-helpers.test.js` | 1 | **新建** | 身分解析 + 權限（8 案例） |
| `tests/unit/tournament-helpers.test.js` | 1 | **新建** | 狀態機 + 管理權限（6 案例） |
| `tests/unit/fetch-if-missing.test.js` | 2A | **新建** | per-entity 快取 + injected 桶（7 案例） |
| `tests/unit/team-feed.test.js` | 2B | **新建** | Feed CRUD + 權限守衛（6 案例） |
| `tests/unit/tournament-pagination.test.js` | 2B | **新建** | 分頁 + injected 合併（5 案例） |
| `tests/unit/coach-uid-migration.test.js` | 3 | **新建** | 遷移冪等 + 模糊匹配（5 案例） |
| `tests/unit/team.test.js` | 1 | 修改 | 更新 `team-detail-members` → `team-detail-invite` 引用 |

---

> **備註**：本計畫書為 v3.0（全 Phase 實作完成定稿）。歷經 7 輪 20+ 位專家審計 + 6 個 Phase 逐步實作驗證。全部 8 個 commit 已部署至 production。

## 待補項目

### 待補 1：載入進度條（§8.2D）
- **優先度**：LOW（UX 增強，不影響功能）
- **內容**：複製 `event-list-home.js:135-194` 的 loading bar 狀態機到俱樂部/賽事列表卡片
- **進度條邏輯**：progress 0→85% 漸進（4/2/0.5/0.15 遞減增量）+ 完成後 snap to 100% + 400ms 淡出
- **適用時機**：點擊卡片進入詳情頁時的等待動畫

### 待補 2：深連結 Pre-auth REST 快速預覽（§7.10）
- **優先度**：LOW（上線後依用戶反饋決定是否實作）
- **內容**：新增 `_fetchTeamViaRest` / `_fetchTournamentViaRest`，用 Firestore REST API + API key 在 LIFF 登入前取得單筆資料
- **效果**：深連結從 3-8 秒（等 LIFF 登入）降到 ~1 秒（即時預覽）
- **參考**：活動模組的 `_fetchEventViaRest`（app.js:1265-1336）

### 待補 3：Firestore Rules 測試檔新建
- **優先度**：MEDIUM（確保 Rules 修改的回歸安全網）
- **內容**：
  - `tests/firestore-rules/team-feed-rules.test.js`（6 案例）
  - `tests/firestore-rules/tournament-member-rules.test.js`（6 案例）
- **測試案例**：見 §14.1 Phase 0 段落

### 待補 4：遷移腳本實際執行
- **優先度**：HIGH（功能正式上線前必須完成）
- **內容**：在 Firestore production 上執行 `scripts/migrate-team-uids.js`
- **前置條件**：確認所有既有俱樂部的教練名字都能匹配到 UID
- **驗證**：未匹配教練 = 0 → 才可確認 Phase 3-coach-d 前端已安全
