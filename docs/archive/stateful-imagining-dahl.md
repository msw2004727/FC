# ToosterX Firestore 資料架構遷移：全域集合 → 活動子集合

> **📍 進度摘要**：Phase 0~4b **全部完成並部署上線**（2026-04-12）。遷移功能已完全生效——讀寫都走子集合。**唯一剩餘項是 Phase 4c（可選的清潔工作：刪除根集合殘留資料 + 移除去重過濾 + 鎖定 rules）**。不執行 4c 不影響任何功能。詳見下方「執行進度」和「Phase 4c 執行指引」。

## Context

`registrations`、`attendanceRecords`、`activityRecords` 三個全域集合混存所有活動資料。初始嘗試用 onSnapshot `.limit()` 降費，但 limit 截斷導致簽到消失、放鴿子統計歸零等連鎖問題。目前 workaround 已移除 limit（`_buildCollectionQuery` L517-519 回退為無 limit），並加上 per-event cache（`ApiService._eventAttendanceMap`）和 `fetchAttendanceRecordsForEvent` 墊底。

遷移到活動子集合 `events/{docId}/registrations` 讓每場活動天然隔離，消除 limit 需求和全站掃描，預估降費 30-50%（僅 per-event 查詢場景受益，全站統計查詢改用 collectionGroup 後讀取量不變，詳見成本分析）。

---

## 架構變更

```
Before:                              After:
                                     
events/{docId}                       events/{docId}/
registrations/{regId}     ──────►      registrations/{regId}
attendanceRecords/{recId} ──────►      attendanceRecords/{recId}
activityRecords/{recId}   ──────►      activityRecords/{recId}
```

### 雙 ID 映射

子集合路徑 `events/{X}/...` 的 `{X}` 是 Firestore doc.id（如 `ga0CqtaPpjRwimUGEZfU`），但 `registrations.eventId` 存的是 `data.id`（如 `ce_1774920121549_j63p`）。

- **前端**：快取中 `event._docId` 已存在，新增 `_getEventDocId(eventId)` helper 查找
- **CF**：已有 `db.collection("events").where("id","==",eventId).limit(1)` pattern（見 `functions/index.js:4504`）
- **Fallback**：快取 miss 時走 Firestore query（**必須使用 async 版本**，見 Phase 1 雙寫規則）

### 跨活動查詢 → collectionGroup

| 場景 | 改法 |
|------|------|
| 某用戶所有報名（`achievement-batch.js:181`, `ensureUserStatsLoaded:734`） | `db.collectionGroup('registrations').where('userId','==',uid)` |
| 某用戶所有活動紀錄（`achievement-batch.js:182`） | `db.collectionGroup('activityRecords').where('uid','==',uid)` |
| 某用戶所有簽到（`achievement-batch.js:183,194`, `ensureUserStatsLoaded:735`） | `db.collectionGroup('attendanceRecords').where('uid','==',uid)` |
| 全站 checkin（`calcNoShowCountsBatch:5871`, `event-host-list.js:130`） | `db.collectionGroup('attendanceRecords').where('type','==','checkin')` |
| 全站 confirmed（`calcNoShowCountsBatch:5865`） | `db.collectionGroup('registrations').where('status','==','confirmed')` |
| 活動參與者統計（`api-service.js:1978`） | 拆 eventId chunks → 各自查子集合，或改 `collectionGroup` + `where('eventId','in',chunk)` |

> **注意**：collectionGroup 查詢**不能**在 Firestore transaction 中使用。transaction 內的查詢必須改為子集合路徑查詢（`db.collection('events').doc(docId).collection('registrations')`），不可使用 collectionGroup。

---

## 成本分析

| 查詢場景 | 遷移前 | 遷移後 | 節省 |
|----------|--------|--------|------|
| 活動詳情頁載入報名/簽到 | 全域 `.where('eventId','==',x)` 掃描全表 | 子集合直接查詢，僅讀該活動文件 | **大幅節省**（主要受益場景） |
| 用戶個人統計 | 全域 `.where('uid','==',x)` | collectionGroup `.where('uid','==',x)` | **持平**（讀取量相同） |
| Admin 全域監聽 | 全域 collection listener | collectionGroup listener | **持平**（讀取量相同） |
| CF `calcNoShowCounts` 全站掃描 | 全域 `.where(...)` | collectionGroup `.where(...)` | **持平** |
| 雙寫期間（Phase 1 → Phase 4b） | 每筆寫入 1 次 | 每筆寫入 2 次 | **額外成本 +100% 寫入**（持續整個開發+觀察期，約 16-25 天） |

**結論**：主要節省來自 per-event 查詢（活動詳情頁、報名操作），全站查詢無實質節省。預估整體讀取成本降低 30-50%。雙寫期間寫入成本翻倍，但持續時間短。

---

## 分階段實作

紅框 = 高風險階段，涉及 LOCKED 函式

Phase 0 → Phase 1 (高風險) → Phase 2 → Phase 3a → Phase 3b (高風險，需去重) → Phase 3c → [觀察期 3-7 天] → Phase 4a → Phase 4b (高風險，寫入路徑翻轉) → [穩定 3+ 天] → Phase 4c → Phase 4d

---

## 執行進度（即時狀態）

> **最後更新：2026-04-12**

| Phase | 狀態 | 完成日期 | commit | 備註 |
|-------|------|----------|--------|------|
| 0 | ✅ 完成 | 2026-04-12 | `7875c6f6` | 8 個索引 + rules + _getEventDocId + migrateToSubcollections CF |
| 1 | ✅ 完成 | 2026-04-12 | `ea6420cc` | 49 個寫入點雙寫（16 個檔案，+507 行） |
| 2 | ✅ 完成 | 2026-04-12 | （資料操作） | 5,094 筆遷移，0 missing / 0 field mismatch / 78 孤兒 |
| 3a | ✅ 完成 | 2026-04-12 | `c4c87618` | 16 處 per-event 查詢切到子集合 |
| 3b | ✅ 完成 | 2026-04-12 | 同上 | 監聽器 collectionGroup + 去重 17 處 |
| 3c | ✅ 完成 | 2026-04-12 | 同上 | _eventAttendanceMap workaround 移除 |
| 4a | ✅ 完成 | 2026-04-12 | `513f524f` | CF 觸發器改為子集合路徑 |
| 4b | ✅ 完成 | 2026-04-12 | 同上 | 寫入路徑翻轉（-502 行），根集合不再被寫入。版號已同步更新（原 4d 部分完成） |
| **4c** | **⏸ 唯一待執行項** | — | — | **刪除根集合資料 + 移除去重 + 鎖定 rules（不可逆，見下方完整指引）** |
| 4d | ✅ 版號已完成 | 2026-04-12 | 含在 4b commit | 版號已更新。`docs/architecture.md` 更新併入 4c 一起做 |

**目前系統狀態**：
- 寫入：只寫子集合 ✅
- 讀取：只讀子集合/collectionGroup ✅
- 根集合：已凍結（無人讀寫），資料仍存在作為回退保險
- 去重過濾（`doc.ref.parent.parent !== null`）：仍在程式碼中（17 處），等 4c 刪根資料後移除
- **不做 4c 也不影響任何功能**——僅為清潔工作（刪垃圾、掃地、鎖門）

---

## Phase 4c 執行指引（未來新對話用）

> **前提條件**：Phase 4b 已穩定運行 3+ 天，無功能異常回報。
> **不可逆警告**：4c 執行後根集合資料永久刪除，回退需從子集合反向複製（成本高）。

### 步驟 1：刪除根集合資料（Admin SDK）

在專案根目錄執行，或在新對話中請 AI 撰寫並執行：

```bash
node -e "
const admin = require('./functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: 'fc-football-6c8dc' });
const db = admin.firestore();

async function deleteRootCollection(col) {
  const snap = await db.collection(col).get();
  console.log(col + ': ' + snap.size + ' docs to delete');
  const BATCH_SIZE = 400;
  for (let i = 0; i < snap.docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    snap.docs.slice(i, i + BATCH_SIZE).forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    console.log('  deleted batch ' + Math.floor(i / BATCH_SIZE + 1));
  }
  console.log(col + ': done');
}

(async () => {
  await deleteRootCollection('registrations');
  await deleteRootCollection('attendanceRecords');
  await deleteRootCollection('activityRecords');
  console.log('All root collections cleared.');
})().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
"
```

需要 Firebase ADC 認證（`gcloud auth application-default login`）。

### 步驟 2：移除去重過濾（程式碼修改）

搜尋並移除以下 pattern：

**前端（js/ 目錄，10 處）**：
```js
.filter(doc => doc.ref.parent.parent !== null)
```
搜尋：`parent.parent !== null`

**attendance-notify.js（1 處）**：
```js
if (change.doc.ref.parent.parent === null) return;
```

**Cloud Functions（functions/index.js，7 處）**：
```js
.filter(d => d.ref.path.split("/").length > 2)
```
搜尋：`split("/").length > 2`

**總計 18 處**（前端 11 + CF 7）。

### 步驟 3：鎖定根集合 Security Rules

在 `firestore.rules` 中，將根集合的 3 個 match 區塊改為：

```
match /registrations/{regId} {
  allow read, write: if false;
}
match /attendanceRecords/{recordId} {
  allow read, write: if false;
}
match /activityRecords/{recordId} {
  allow read, write: if false;
}
```

原本的 helper functions（`isWaitlistPromotion` 等）可以整段刪除。

**注意**：`/{path=**}/registrations/{regId}` 的 collectionGroup wildcard rules 不要動——它們是子集合 collectionGroup 查詢所需的。

### 步驟 4：移除 collectionGroup wildcard read rules（可選）

根集合資料刪除後，collectionGroup 查詢不再返回根文件。但 wildcard rules 仍會 OR 覆蓋根集合的 `if false`。如果要完全鎖死：

- 刪除 `match /{path=**}/registrations/{regId}` 等 3 個 wildcard 區塊
- collectionGroup 查詢會改為使用子集合規則 `match /events/{eventId}/registrations/{regId}` 授權

**此步驟可選**——根資料已刪，wildcard 覆蓋也讀不到東西。

### 步驟 5：部署 + 驗收

```bash
firebase deploy --only firestore:rules
firebase deploy --only functions
npx jest tests/unit/ tests/subcollection-rules.test.js  # 全套測試
node scripts/migration-verify.js phase3                  # 驗證根集合已空
```

更新 `migration-path-coverage.test.js` 的 KNOWN_REFERENCES（去重移除後計數會變）。
版號更新（CACHE_VERSION + index.html ?v= + var V + sw.js CACHE_NAME）。
更新 `docs/architecture.md` 和 `docs/claude-memory.md`。
commit + push。

### 步驟 6：更新本計劃書進度表

將上方進度表的 4c 和 4d 標為 ✅ 完成。

---

### Phase 0 — 索引 + 路徑工具 + 安全規則 + 遷移腳本

**檔案：**

1. **`firestore.indexes.json`** — 新增 collectionGroup 索引（8 個）：
   - `registrations` (userId ASC) — scope: COLLECTION_GROUP
   - `registrations` (status ASC, registeredAt DESC) — scope: COLLECTION_GROUP
   - `registrations` (**registeredAt DESC**) — scope: COLLECTION_GROUP ← admin 監聽器 `.orderBy('registeredAt','desc')` 必需
   - `attendanceRecords` (uid ASC) — scope: COLLECTION_GROUP
   - `attendanceRecords` (type ASC) — scope: COLLECTION_GROUP
   - `attendanceRecords` (**createdAt DESC**) — scope: COLLECTION_GROUP ← admin 簽到監聽器 `.orderBy('createdAt','desc')` 必需
   - `attendanceRecords` (**uid ASC, createdAt DESC**) — scope: COLLECTION_GROUP ← `attendance-notify.js` 複合查詢必需
   - `activityRecords` (uid ASC) — scope: COLLECTION_GROUP

2. **`js/firebase-service.js`** — 新增工具函式（插在 `getCachedDoc` 附近）：
   ```js
   _getEventDocId(eventId) {
     const ev = this._cache.events.find(e => e.id === eventId);
     if (ev && ev._docId) return ev._docId;
     return null; // caller 需 fallback 到 async 版本
   },
   
   async _getEventDocIdAsync(eventId) {
     const cached = this._getEventDocId(eventId);
     if (cached) return cached;
     const snap = await db.collection('events').where('id','==',eventId).limit(1).get();
     return snap.empty ? null : snap.docs[0].id;
   }
   ```

3. **`firestore.rules`** — 新增子集合 + collectionGroup 規則：
   ```
   // 子集合規則（Phase 1 雙寫使用）
   match /events/{eventId}/registrations/{regId} {
     // 複製現有全域 registrations rules，getRegEventData() 改為
     // get(/databases/$(database)/documents/events/$(eventId)).data
     allow read: if isAuth();
     allow create: if isAuth() && (isAdmin() || ...);
     allow update: if isAuth() && (...);
     allow delete: if isAuth() && (isAdmin() || ...);
   }
   match /events/{eventId}/attendanceRecords/{recId} {
     allow read: if isAuth();
     allow create: if isAuth();
     allow update: if isAuth() && (isAdmin() || isAttendanceStatusUpdate());
     allow delete: if false;
   }
   match /events/{eventId}/activityRecords/{recId} {
     allow read: if isAuth();
     allow create: if isAuth();
     allow update: if isAuth() && (isUserFieldOwnerResource() || isAdmin() || isActivityStatusOnly());
     allow delete: if isAdmin();
   }

   // collectionGroup 規則（Phase 3 collectionGroup 查詢所需）
   match /{path=**}/registrations/{regId} {
     allow read: if request.auth != null;
   }
   match /{path=**}/attendanceRecords/{recId} {
     allow read: if request.auth != null;
   }
   match /{path=**}/activityRecords/{recId} {
     allow read: if request.auth != null;
   }
   ```
   > **關鍵**：collectionGroup 查詢必須有 `/{path=**}/collectionName/{docId}` 層級的 rules，僅有子集合層級的 rules 不足以授權 collectionGroup 查詢。

4. **`functions/index.js`** — 新增 `migrateToSubcollections` callable function：
   - 建立 `data.id → doc.id` 映射（pattern 同 `backfillAutoExp:3691`）
   - 批次複製 registrations → `events/{docId}/registrations/{原 regId}`（**使用 `set()` 覆寫語義**，保留原 doc ID，確保冪等）
   - 同理 attendanceRecords、activityRecords
   - 複製前檢查子集合中是否已存在（Phase 1 雙寫可能已建立），存在則 skip 或 merge
   - 找不到映射的孤兒記錄寫入 log
   - 支援 `dryRun` 模式 + 進度回報

**部署順序**：先 deploy indexes（需 10-20 分鐘建立）→ deploy rules → deploy functions → 最後前端。

> **注意**：索引建置期間，依賴該索引的 collectionGroup 查詢會失敗（回傳錯誤而非空結果）。Phase 3 必須等索引狀態為 READY 才能開始。可用 `firebase firestore:indexes` 檢查狀態。

**驗收**：
- `firebase deploy --only firestore:indexes` 成功
- `firebase deploy --only firestore:rules` 成功
- `_getEventDocId` 對快取中每個 event 返回 non-null
- 遷移腳本 dryRun 報告數量合理
- collectionGroup 索引狀態為 READY

---

### Phase 1 — 雙寫層

所有寫入同時寫全域集合 + 子集合。讀取仍走全域。

**雙寫規則（強制）**：
1. 非 transaction 場景**必須使用 `_getEventDocIdAsync`**（async 版本），確保快取 miss 時仍能取得 docId
2. Transaction 場景可用同步版 `_getEventDocId`，但 **null 時必須 log warning**（不可靜默跳過）
3. 子集合寫入失敗不中斷主流程（try-catch 包裹），但必須 log error

**LOCKED 函式改動（需特別審查）：**

| 函式 | 檔案:行 | 改法 |
|------|---------|------|
| `_doRegisterForEvent` | `firebase-crud.js:772` | transaction 內：主 ref 維持全域（不變動），額外 set 子集合 ref（registrations） |
| `cancelRegistration` | `firebase-crud.js:887` | batch 中每個全域寫入後加對應子集合寫入（registrations :975,:992）；B' 階段新增 activityRecords 子集合 query + update（候補遞補 waitlisted → registered 同步） |
| `batchRegisterForEvent` | `firebase-crud.js:1994` | 同 `_doRegisterForEvent` 模式（registrations） |
| `cancelCompanionRegistrations` | `firebase-crud.js:2113` | 同 `cancelRegistration` 模式（registrations :2234,:2253）；B' 階段新增 activityRecords 子集合 query + update（候補遞補 waitlisted → registered 同步） |
| CF `registerForEvent` | `functions/index.js:4441` | transaction 中雙寫：registrations(:4500) + **activityRecords(:4692)** |
| CF `cancelRegistration` | `functions/index.js:4798` | transaction 中雙寫：registrations(:4916,:4946) + **activityRecords(:4966,:4975)** |
| CF `adjustTeamReservation` | `functions/index.js:6624` | transaction 中讀寫活動子集合：registrations（讀取、席位標記、同俱樂部候補轉正）+ activityRecords（同俱樂部候補轉正同步 waitlisted → registered） |

> **Phase 1 原則**：全域路徑為主（primary），子集合為副（secondary）。Transaction 內的查詢仍走全域集合，僅寫入時雙寫。

**一般寫入改動（完整清單）：**

| 檔案 | 寫入點 | 說明 |
|------|--------|------|
| `firebase-crud.js:445,465,491,515` | addAttendanceRecord, removeAttendanceRecord, batchWriteAttendance | attendanceRecords 雙寫 |
| `firebase-crud.js:740` | displayBadges update | registrations 雙寫 |
| `event-detail-signup.js:20,282,557,562,570` | activityRecords delete/add/update | activityRecords 雙寫 |
| `event-detail-signup.js:464` | 重複報名 dedup 取消 | **registrations** 雙寫（非 activityRecords） |
| `event-detail-companion.js:222,362,370` | activityRecords add/update | activityRecords 雙寫 |
| `event-detail-companion.js:375→380` | activityRecords query-then-update fallback | activityRecords 雙寫（375 查詢 → 380 update） |
| `event-create-waitlist.js:146,148` | 遞補 batch（registrations + activityRecords） | registrations(:146) + activityRecords(:148) 雙寫 |
| `event-create-waitlist.js:233,235` | 降級 batch（registrations + activityRecords） | registrations(:233) + activityRecords(:235) 雙寫 |
| `event-manage-waitlist.js:218,222` | 手動晉升 registrations(:218) + activityRecords(:222) | 雙寫 |
| `event-manage-waitlist.js:337,344` | 手動降級 registrations(:337) + activityRecords(:344) | 雙寫 |
| `event-manage-lifecycle.js:257` | activityRecords batch.delete | activityRecords 雙寫 |
| `event-manage-lifecycle.js:402,408` | 移除/遞補 registrations | registrations 雙寫 |
| `event-manage-lifecycle.js:405,410` | 移除/遞補 activityRecords | activityRecords 雙寫 |
| `event-team-split.js:140,165,182,355` | teamKey 更新 | registrations 雙寫 |
| `event-manage-badges.js:93` | 徽章更新 | registrations 雙寫（:19 為 READ，見 Phase 3a） |
| `registration-audit.js:269,277` | 審計修復 | registrations 雙寫 |
| `achievement-batch.js:305` | displayBadges 更新 | registrations 雙寫 |
| `app.js:37` | activityRecords 管理工具更新 | activityRecords 雙寫 |

**雙寫模式**：
```js
// 既有（全域）
batch.update(db.collection('registrations').doc(reg._docId), { status: 'confirmed' });

// 新增雙寫（子集合）— 非 transaction 場景使用 async
const eventDocId = await FirebaseService._getEventDocIdAsync(reg.eventId);
if (eventDocId) {
  batch.update(db.collection('events').doc(eventDocId).collection('registrations').doc(reg._docId), { status: 'confirmed' });
} else {
  console.error('[雙寫] 找不到 eventDocId for eventId:', reg.eventId);
}
```

**Batch 容量**：最大 batch（cancelRegistration 候補遞補）通常 < 15 ops，雙寫後 < 30，遠低於 500 限制。

**`firestore.rules`**：已在 Phase 0 完成子集合 + collectionGroup 規則部署。

**驗收**：
- 新報名 → 全域 + 子集合都有
- 取消 + 候補遞補 → 兩邊一致
- 掃碼簽到 → 兩邊都有
- 徽章更新 → 兩邊都有
- 管理端移除/遞補 → 兩邊都有
- 快取 miss 場景 → log 確認 async fallback 正常觸發

---

### Phase 2 — 執行資料遷移

呼叫 Phase 0 準備的 `migrateToSubcollections`，將歷史資料複製到子集合。

**步驟**：
1. 先 dryRun 確認數量
2. 正式執行（使用 `set()` 覆寫語義，Phase 1 雙寫已建立的文件不會重複，確保冪等）
3. 比對全域 vs 子集合文件數（允許子集合 ≥ 全域，因 Phase 1 雙寫可能已新增）
4. 抽查 10 筆資料欄位完整性

**資料量**：~2500 筆寫入，5 個 batch，約 1-3 分鐘

---

### Phase 3a — 切換 per-event 查詢（低風險）

將「按 eventId 查詢」的路徑從全域集合切換為子集合直接查詢。

**改動（16 處 per-event 查詢）：**

| 改動 | 檔案:行 | 說明 |
|------|---------|------|
| `_doRegisterForEvent` | `firebase-crud.js:814` | `db.collection('registrations').where('eventId','==',id)` → 子集合查詢 |
| `cancelRegistration` | `firebase-crud.js:902` | 同上模式 |
| `batchRegisterForEvent` | `firebase-crud.js:2007` | 同上模式 |
| `cancelCompanionRegistrations` | `firebase-crud.js:2138` | 同上模式 |
| `_adjustWaitlistOnCapacityChange` | `event-create-waitlist.js:77` | 同上模式 |
| 報名紀錄 modal | `event-detail.js:752` | `db.collection('registrations').where('eventId','==',eventId)` → 子集合查詢 |
| 查詢自己的報名 | `event-detail-signup.js:88` | `db.collection('registrations').where('eventId',...).where('userId',...)` → 子集合 + userId filter |
| CF 報名後補查 | `event-detail-signup.js:351` | `firebase.firestore().collection('registrations').where('eventId',...).where('userId',...)` → 子集合 |
| 報名紀錄 modal 查詢 | `event-manage-lifecycle.js:335` | `db.collection('registrations').where('eventId','==',eventId)` → 子集合查詢 |
| 徽章查詢 | `event-manage-badges.js:19` | `db.collection('registrations').where('eventId','==',eventId)` → 子集合查詢 |
| 活動參與者統計 | `api-service.js:1978` | `db.collection('attendanceRecords').where('eventId','in',chunk)` → 分別查子集合或 collectionGroup |
| CF `registerForEvent` | `functions/index.js:4538` | transaction 內改為子集合路徑查詢（**不用 collectionGroup**） |
| CF `cancelRegistration` regs | `functions/index.js:4859` | 同上 |
| CF `cancelRegistration` AR | `functions/index.js:4958` | `db.collection("activityRecords").where("eventId","==",eventId)` → 子集合查詢 |
| 取消報名 fallback | `event-detail-signup.js:570` | `db.collection('activityRecords').where('uid',...).where('eventId',...)` → 子集合 + uid filter |
| 同行者取消 fallback | `event-detail-companion.js:375` | `db.collection('activityRecords').where('uid',...).where('eventId',...)` → 子集合 + uid filter |

> **Transaction 規則**：transaction 內的查詢**一律使用子集合路徑**，禁止使用 collectionGroup（Firestore 限制）。
>
> **注意**：`event-detail-signup.js:570` 和 `event-detail-companion.js:375` 同時是 Phase 1 寫入點和 Phase 3a 讀取點（query-then-update 模式）。Phase 1 加雙寫時只需處理 update 部分；Phase 3a 需同時改 query 路徑。

**驗收**：
- 完整報名流程（報名→候補→遞補→取消）
- 委託人手動簽到
- 容量變更觸發的自動遞補/降級

---

### Phase 3b — 切換監聽器 + 跨活動查詢（中風險）

> **⚠️ collectionGroup 去重規則（強制）**：所有 `collectionGroup` 查詢結果和監聽器 snapshot **必須**過濾掉根集合文件，否則會與子集合文件重複（Phase 1-4 期間根集合仍有資料）。
>
> ```js
> // 所有 collectionGroup snapshot/query 回調必須加此過濾
> snapshot.docs
>   .filter(doc => doc.ref.parent.parent !== null)  // 僅保留子集合文件（根集合的 parent.parent === null）
>   .map(doc => ({ ...doc.data(), _docId: doc.id }))
> ```
>
> 不加此過濾的後果：`_cache` 中資料翻倍 → 報名人數 2x、統計 2x、簽到紀錄 2x。

**改動：**

| 改動 | 檔案:行 | 說明 |
|------|---------|------|
| 監聽器 | `firebase-service.js:1519` (registrations snapshot callback) | 加 `doc.ref.parent.parent !== null` 過濾 |
| 監聽器 | `firebase-service.js:1608` (attendanceRecords snapshot callback) | 加同上過濾 |
| 監聽器 | `firebase-service.js:1547` (`_getRegistrationsListenerQuery`) | admin: 改為 `collectionGroup('registrations')`；user: `collectionGroup('registrations').where('userId','==',uid)` |
| 監聽器 | `firebase-service.js:1586` (`_startAttendanceRecordsListener`) | 同上改 collectionGroup |
| **監聽器** | **`attendance-notify.js:22`** | `db.collection('attendanceRecords').where('uid','==',uid).onSnapshot(...)` → `collectionGroup` + 去重過濾 |
| 初始載入 | `firebase-service.js:506` (`_buildCollectionQuery`) | **registrations + attendanceRecords**：移除初始載入（有專用監聽器接手）；**activityRecords**：保留初始載入但改為 `db.collectionGroup('activityRecords')` + 去重過濾（無專用監聽器，移除會導致快取永久為空） |
| 按 userId 查 | `firebase-service.js:728`, `achievement-batch.js:181,182,183` | → `db.collectionGroup(...)` + 去重過濾 |
| displayName fallback | `achievement-batch.js:194` | `db.collection('attendanceRecords').where('userName','==',displayName)` → `collectionGroup` + 去重過濾 |
| 全站掃描 | `event-host-list.js:130` | → `db.collectionGroup(...)` + 去重過濾 |
| admin 工具查詢 | `app.js:11,13` | activityRecords + registrations 全表查詢 → `collectionGroup` + 去重過濾 |

**Cloud Functions 更新（此前遺漏，現補充）：**

| 函式 | 檔案:行 | 改法 |
|------|---------|------|
| `calcNoShowCountsBatch` | `functions/index.js:5865` | → `collectionGroup` + **去重**（CF 用 Admin SDK 無 rules 限制，但仍需 `doc.ref.parent.parent` 過濾） |
| `calcNoShowCountsBatch` | `functions/index.js:5871` | 同上 |
| `migrateUidFields` | `functions/index.js:3419` | 保留全域（一次性工具，不遷移） |
| `backfillAutoExp` :3756 | `functions/index.js:3756` | → `collectionGroup` + 去重 |
| `backfillAutoExp` :3786 | `functions/index.js:3786` | → `collectionGroup` + 去重 |
| `backfillAutoExp` :3816 | `functions/index.js:3816` | → `collectionGroup` + 去重 |
| `backfillAutoExp` :3920 | `functions/index.js:3920` | → `collectionGroup` + 去重 |
| `backfillAutoExp` :3921 | `functions/index.js:3921` | → `collectionGroup` + 去重 |

**快取策略**：`_cache.registrations` / `_cache.attendanceRecords` 保留為扁平陣列（UI 層不改），但來源改為子集合或 collectionGroup。**所有 collectionGroup 來源必須加去重過濾**。

**驗收**：
- Admin 全域查詢（event-host-list.js）資料完整，**無重複**
- 用戶個人統計（排行榜、成就系統）數值正確，**不是 2 倍**
- 監聽器即時更新正常
- **去重驗證**：任一活動報名後，`_cache.registrations.filter(r => r.eventId === xxx).length` 應等於 Firestore console 子集合文件數

---

### Phase 3c — 移除 per-event cache workaround（低風險，依賴 3a+3b 驗證通過）

**改動：**

| 改動 | 檔案:行 | 說明 |
|------|---------|------|
| 移除 per-event cache | `api-service.js:905-926` | 刪除 `_eventAttendanceMap`、`_eventAttendancePending`、`fetchAttendanceRecordsForEvent` |
| 移除 per-event cache 同步 | `api-service.js:964-965,992-994,1024-1030` | 刪除 per-event cache 寫入/清除 |
| 移除 fetchEventAttendanceRecords | `firebase-service.js:1572-1583` | 不再需要 |
| 移除 per-event cache 清除 | `firebase-service.js:1609` | 不再需要（`ApiService._eventAttendanceMap = {}`） |
| 移除 fetchAttendanceRecordsForEvent 呼叫 | `event-manage-attendance.js:123` | 不再需要 |

**驗收**：
- 掃碼簽到/簽退正常
- 放鴿子統計（CF `calcNoShowCounts`）
- 活動詳情頁簽到列表完整

---

### 觀察期（3-7 天）

Phase 3c 完成後，進入觀察期。期間：
- 全域集合仍由 Phase 1 雙寫保持同步
- 監控 Firestore console 的讀寫量變化
- 監控 Cloud Functions logs 是否有異常
- 確認以下功能正常：報名、取消、候補遞補、掃碼、統計、排行榜、成就

**進入 Phase 4 的條件**：觀察期內無功能異常、無資料不一致回報。

---

### Phase 4 — 移除雙寫 + 遷移觸發器 + 清理

> **⚠️ 閱讀注意（給 AI）**：以下 4a 和 4b 段落是**原始設計文件**，描述的改動**已全部完成並部署**（commit `513f524f`，2026-04-12）。保留此段落是為了記錄「做了什麼」和「為什麼這樣做」。**唯一未完成的是 4c**，其完整執行指引在上方「Phase 4c 執行指引」區塊。

**4a — 遷移 Cloud Function 觸發器：** ✅ 已完成

| 觸發器 | 檔案:行 | 改法 |
|--------|---------|------|
| `watchRegistrationsChanges` | `functions/index.js:2703` | `document: "registrations/{regId}"` → `document: "events/{eventId}/registrations/{regId}"` |
| `watchAttendanceChanges` | `functions/index.js:2711` | `document: "attendanceRecords/{recordId}"` → `document: "events/{eventId}/attendanceRecords/{recordId}"` |

> **關鍵**：這兩個是 `onDocumentWrittenWithAuthContext` 審計日誌觸發器。若不遷移，Phase 4 移除全域寫入後觸發器將永久沉默，審計日誌功能中斷。

**4b — 寫入路徑翻轉：子集合變唯一目標** ✅ 已完成

> **⚠️ 注意**：Phase 1 定義「全域=主、子集合=副」。Phase 4 要做的是**反過來**：移除全域（原主），保留子集合（原副），讓子集合成為唯一寫入目標。

具體改動：
1. **所有 LOCKED 函式的原始全域寫入改為子集合寫入**：
   - `firebase-crud.js:794` — `db.collection('registrations').doc()` → `db.collection('events').doc(eventDocId).collection('registrations').doc()`
   - `firebase-crud.js:2020` — 同上模式（batchRegisterForEvent）
   - `firebase-crud.js:975,992` — batch.update ref 改為子集合路徑
   - `firebase-crud.js:2234,2253` — 同上
   - CF `registerForEvent:4500` — `db.collection("registrations").doc()` → 子集合 ref
   - CF `cancelRegistration:4916,4946` — transaction.update ref 改為子集合
2. **所有一般寫入的全域 ref 改為子集合 ref**（Phase 1 表格中每個檔案的原始寫入行）
3. **移除 Phase 1 新增的雙寫邏輯**（try-catch 包裹、`_getEventDocId` 呼叫、secondary write 行）
4. 去重過濾**暫時保留**（根集合資料仍存在，待 4c 刪除後才移除）

**4c — 清理根集合殘留資料 + 鎖定：** ⏸ 唯一待執行項（完整指引見上方「Phase 4c 執行指引」區塊）

- 執行 Cloud Function 刪除根集合 `registrations`、`attendanceRecords`、`activityRecords` 的所有文件（Admin SDK 不受 rules 限制）
- 刪除完成後，移除 collectionGroup 查詢中的 `doc.ref.parent.parent !== null` 去重過濾（不再需要）
- `firestore.rules` 全域集合改 `allow read, write: if false`

> **⚠️ 安全規則注意**：`/{path=**}/registrations/{regId} { allow read }` 的 wildcard 規則會 OR 覆蓋根集合的 `if false`。因此**必須先刪除根集合資料**再鎖定，否則鎖定形同虛設（Firestore 規則 OR 運算：任一匹配規則允許即通過）。

**4d — 文件更新 + 版號：** ✅ 版號已在 4b commit 完成，docs 更新併入 4c

- ~~版號更新~~ → 已在 4b commit 中同步完成
- `docs/architecture.md`、`docs/claude-memory.md` 更新 → 併入 4c 一起做

**回退策略**：若 Phase 4 部署後發現問題：
1. 恢復全域寫入路徑（git revert Phase 4b commit — 恢復雙寫）
2. 恢復 Cloud Function 觸發器路徑（git revert Phase 4a commit）
3. 若 4c 已執行（根集合資料已刪）：需重新從子集合複製回根集合（新增反向遷移腳本）
4. 恢復 security rules（git revert）
5. **建議**：4c（刪除根資料）應在 4a+4b 穩定運行 3+ 天後才執行，作為最終清理步驟

---

## 風險評估

| 風險 | 嚴重度 | 機率 | 緩解 |
|------|--------|------|------|
| LOCKED 函式 transaction 改動引入 race condition | 高 | 低 | Phase 1 全域路徑為 primary 不變；子集合為 secondary；切換前 E2E 測試 |
| collectionGroup 索引未就緒 | 高 | 低 | Phase 0 提前部署；Phase 3 開始前驗證索引狀態為 READY |
| collectionGroup 安全規則缺失導致查詢被拒 | 高 | 低 | Phase 0 同時部署 `/{path=**}/collectionName/{docId}` 層級規則 |
| **collectionGroup 返回根+子集合重複資料** | **高** | **高** | **所有 collectionGroup 查詢/監聽器必須加 `doc.ref.parent.parent !== null` 去重過濾** |
| **Phase 4 寫入路徑翻轉遺漏 doc ref 建立** | **高** | **中** | **Phase 4b 明確列出 :794,:2020 等 doc ref 建立必須改為子集合** |
| `event._docId` 快取 miss（同步版本靜默跳過） | 中 | 中 | 非 transaction 場景強制使用 `_getEventDocIdAsync`；同步版 null 時 log error |
| 遷移與雙寫時間窗重疊產生重複 | 中 | 高 | 遷移腳本使用 `set()` 覆寫語義，確保冪等 |
| CF 觸發器未遷移導致審計日誌中斷 | 高 | — | Phase 4a 優先遷移觸發器，再移除雙寫 |
| **Wildcard rules OR 覆蓋根集合鎖定** | **中** | **高** | **Phase 4c 先刪除根集合資料，再鎖定 rules** |
| 遷移孤兒資料（eventId 無對應活動） | 低 | 中 | 記 log，不中斷遷移 |
| Security Rules 與代碼部署不同步 | 中 | 低 | Phase 0 先部署 rules（不影響舊的，僅新增） |
| Transaction 內誤用 collectionGroup | 高 | 低 | 代碼審查 checklist 明確標註：transaction 內一律用子集合路徑 |
| Phase 4 回退需同時恢復 rules + 根資料 | 中 | 低 | 4c（刪根資料）延後 3+ 天執行，給足回退窗口 |

**回退方案**：
- **Phase 1-2**：全域集合仍完整可用，隨時可撤回到純全域模式。
- **Phase 3**：恢復全域讀取路徑即可（子集合數據已由雙寫保持同步）。
- **Phase 4a-4b**：git revert 恢復雙寫 + 觸發器路徑（根集合資料仍在，回退安全）。
- **Phase 4c 後**：根集合資料已刪，回退需從子集合反向複製（需反向遷移腳本，成本高）。

---

## 工時預估

| Phase | 內容 | 預估 |
|-------|------|------|
| 0 | 索引 + 工具 + 安全規則 + 遷移腳本 | 1 天 |
| 1 | 雙寫層（~53 個寫入點，含前端 + CF activityRecords） | 2-3 天 |
| 2 | 執行遷移 | 0.5 天 |
| 3a | 切換 per-event 查詢（16 處） | 1-2 天 |
| 3b | 切換監聽器（含 attendance-notify）+ 跨活動查詢 + CF 更新（含 backfillAutoExp 5 處） | 2-3 天 |
| 3c | 移除 workaround | 0.5 天 |
| 觀察 | 線上驗證期 | 3-7 天（非開發工時） |
| 4a | 遷移 CF 觸發器 | 0.5 天 |
| 4b | 寫入路徑翻轉（根→子集合）+ 移除雙寫邏輯 | 2-3 天 |
| 4c | 刪除根集合資料 + 移除去重過濾 + 鎖定 rules | 0.5 天 |
| 4d | 文件 + 版號 | 0.5 天 |
| **合計** | | **10-15 天**（不含觀察期） |

---

## 修訂紀錄

| 日期 | 版本 | 變更摘要 |
|------|------|----------|
| 2026-04-12 | v2 | 多領域專家審查修訂：修正 C1-C5 致命缺陷 + H1-H6 高風險缺陷 + M1-M4 中風險缺陷 |
| 2026-04-12 | v3 | 逐檔逐行深度審計：修正 S1-S10 遺漏路徑 + L1-L5 標籤錯誤 |
| 2026-04-12 | v4 | 87 處全域搜尋交叉比對：修正 F1-F3 架構級缺陷 |
| 2026-04-12 | v5 | Firestore 引擎行為語義審計：修正 G1-G5 引擎級缺陷 |
| 2026-04-12 | v6 | 新增執行進度追蹤表 + Phase 4c 完整執行指引（6 步驟 + 腳本 + 注意事項） |
| 2026-04-12 | v7 | 消除 AI 誤判：頂部加進度摘要、Phase 4 本文加完成標記 + AI 閱讀注意、4d 狀態修正（版號已在 4b 完成） |

### v2 修訂內容

**致命缺陷修正：**
- C1：新增 Phase 4a CF 觸發器遷移（`watchRegistrationsChanges`、`watchAttendanceChanges`）
- C2：Phase 0 新增 collectionGroup wildcard 安全規則（`/{path=**}/collectionName/{docId}`）
- C3：Phase 3b 新增遺漏的 CF 更新（`calcNoShowCountsBatch`、`migrateUidFields`、`backfillAutoExp`）
- C4：雙寫規則強制非 transaction 場景使用 `_getEventDocIdAsync`，null 時 log error
- C5：寫入點清單補充 `app.js:37`、`event-manage-lifecycle.js:257`、`achievement-batch.js:305`、`event-manage-waitlist.js:222,344`

**高風險修正：**
- H1：遷移腳本改用 `set()` 覆寫語義確保冪等
- H2：Phase 3 拆分為 3a/3b/3c 三個子階段
- H3：Phase 3c 與 Phase 4 之間加入 3-7 天觀察期
- H4：新增 Transaction 限制警告，明確標註 transaction 內禁用 collectionGroup
- H5：降費估算從 60-80% 修正為 30-50%，新增成本分析表
- H6：Phase 4 新增完整回退策略（rules + code + triggers 三步驟）

**中風險修正：**
- M1：（Demo 模式已移除，不適用）
- M2：成本分析表加入雙寫期間額外成本
- M3：備註 `attendanceRecords` 刪除規則限制
- M4：Phase 0 驗收項加入索引狀態檢查，Phase 3 標註索引就緒依賴

### v3 修訂內容（逐檔逐行深度審計）

**遺漏路徑修正（S1-S10）：**
- S1：Phase 3a 新增 `event-detail.js:752`（報名紀錄 modal per-event 查詢）
- S2：Phase 3b 新增 `attendance-notify.js:22`（簽到通知 onSnapshot 監聽器）
- S3：Phase 3a 新增 `api-service.js:1978`（活動參與者統計 eventId-in 查詢）
- S4-S5：Phase 3a 新增 `event-detail-signup.js:88,351`（報名查詢 × 2）
- S6：Phase 3b 補充 `achievement-batch.js:182`（activityRecords by-uid 查詢，原計劃僅列 181,183）
- S7：Phase 3b 新增 `achievement-batch.js:194`（attendanceRecords displayName fallback 查詢）
- S8：Phase 3b 新增 `app.js:11,13`（admin 工具全表查詢）
- S9：Phase 3b `backfillAutoExp` 從 1 處擴充為 5 處查詢（:3756,:3786,:3816,:3920,:3921）
- S10：Phase 1 CF 雙寫明確列出 activityRecords 路徑（registerForEvent:4692, cancelRegistration:4958,4966,4975）

**標籤/分類修正（L1-L5）：**
- L1：`event-detail-signup.js:464` 從「activityRecords CRUD」更正為「registrations 寫入」
- L2：`event-manage-lifecycle.js:335` 從 Phase 1 寫入表移至 Phase 3a 讀取表
- L3：`event-manage-badges.js:19` 從 Phase 1 寫入表移至 Phase 3a 讀取表（僅保留 :93 為寫入）
- L4：`event-create-waitlist.js` 補充 :148,:235 activityRecords 寫入（與 :146,:233 同 batch）
- L5：Phase 3a 「31 處 per-event 查詢」修正為實際計數「16 處」（含 :570,:375 query-then-update）

### v4 修訂內容（87 處全域搜尋交叉比對）

**架構級缺陷修正（F1-F3）：**
- F1（致命）：**collectionGroup 重複資料問題** — 所有 collectionGroup 查詢和監聽器 snapshot 必須加 `doc.ref.parent.parent !== null` 過濾，否則根集合+子集合文件同時返回導致快取 2x。影響：`firebase-service.js:1519,:1608` snapshot callback、`attendance-notify.js:22`、`ensureUserStatsLoaded`、`achievement-batch.js`、CF `calcNoShowCountsBatch`、`backfillAutoExp` 共計 15+ 處。
- F2（致命）：**Phase 4 寫入路徑描述反轉** — 原計劃說「移除 Phase 1 新增的 secondary write」等於移除子集合寫入（反了）。修正為：Phase 4b 將全域寫入改為子集合寫入，移除雙寫邏輯。明確列出 `firebase-crud.js:794,:2020` doc ref 建立必須從 `db.collection('registrations').doc()` 改為子集合 ref。
- F3（高風險）：**Phase 4 根集合安全規則鎖定無效** — `/{path=**}/registrations/{regId} { allow read }` 的 wildcard 規則 OR 覆蓋根集合 `{ allow read: if false }`。修正為：Phase 4c 先用 Admin SDK 刪除根集合資料，再鎖定 rules。4c 延後 3+ 天執行以保留回退窗口。

**其他修正：**
- Phase 3a 新增 `event-detail-signup.js:570` 和 `event-detail-companion.js:375`（query-then-update 的查詢路徑部分）
- Phase 4 工時從 1-2 天細化為 4a(0.5天)+4b(2-3天)+4c(0.5天)+4d(0.5天)
- 總工時從 8-12 天修正為 10-15 天
- 風險評估表新增 3 行高風險項（collectionGroup 重複、寫入翻轉、wildcard OR 覆蓋）

### v5 修訂內容（Firestore 引擎行為語義審計）

**引擎級缺陷修正（G1-G5）：**
- G1（致命）：**Phase 0 缺少 3 個 collectionGroup 索引** — 補充 `registrations (registeredAt DESC)`、`attendanceRecords (createdAt DESC)`、`attendanceRecords (uid ASC, createdAt DESC)` 複合索引。無這些索引，Phase 3b 監聽器啟動時 Firestore 回傳 `FAILED_PRECONDITION`，功能完全無法使用。索引總數從 5 個增至 8 個。
- G2（致命）：**activityRecords 無專用監聽器，不能移除初始載入** — Phase 3b `_buildCollectionQuery` 改動從「三個集合不在初始載入」修正為「registrations + attendanceRecords 移除初始載入（有監聽器）；activityRecords 保留初始載入改為 collectionGroup + 去重」。
- G3（中風險）：**Phase 4b 與 4c 去重移除時序矛盾** — 4b 原寫「移除去重過濾」改為「暫時保留」，去重僅在 4c 刪除根資料後才移除。
- G4（低風險）：成本分析雙寫期從「3-5 天」修正為「16-25 天」（Phase 1 → Phase 4b）。
- G5（低風險）：移除未被引用的 `_getSubRef` 工具函式。
