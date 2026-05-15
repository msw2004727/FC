# `participantsWithUid` 遷移計劃書（v9 — 最終定稿）

> **產生日期**：2026-04-19（v1 → v9）
> **目的**：根治同暱稱用戶互相干擾的 bug
> **狀態**：待使用者批准 Phase 1
> **版本**：v9（Round 8 審計後最終定稿，補**CF 部署驗證機制**；所有 🔴🟡 風險已消除）

---

## TL;DR（一頁速讀）

**問題**：同暱稱用戶（14 組，含「勝」「Ivan」）的放鴿子紀錄互相污染。

**根因**：`_userByName.set(name, user)` 同名覆蓋，`participants[]` fallback 路徑用 name 反查挑錯人。

**方案**：events 新增 `participantsWithUid: [{uid, name, teamKey}]` 物件陣列。

**工時**：6-9 小時專注 / 3-5 個工作日 elapsed。

**風險**：~65% 至少 1 個 minor bug，~25% 用戶可見，~5% 緊急回滾。Additive 設計保資料不損。

**Phase**：1a Rules → 1 寫入（CF+前端）→ 2 遷移 → 3 讀取切換 → 4 一致性工具。

**必須使用者決策**：隱私方案 A/B、執行節奏、受害者通知、teamKey 納入（見附錄 H）。

---

## 1. 執行摘要

**問題**：[event-manage-noshow.js:63-76](js/modules/event/event-manage-noshow.js:63) 的 `_userByName.set(name, user)` 同暱稱被覆蓋，下游顯示錯位。

**規模**：⑨ 偵測顯示 14 組同暱稱，12 組有活動污染，2 組已誤植。

**方案**：events 新增 `participantsWithUid` / `waitlistWithUid` / `schemaVersion: 2`。additive 策略。

**Rollback**：10-30 分鐘（含 CI + 部署 + SW）。

---

## 2. 背景與現況

### 2.1 系統架構

`participants[]` 由**純函式 `_rebuildOccupancy()`** 生成：
- 前端：[firebase-crud.js:578](js/firebase-crud.js:578)（鎖定）
- CF：[functions/index.js:4369](functions/index.js:4369)（雙端手動同步）
- 寫入：10 處前端 + 2 處 CF，都透過 `occupancy.participants`
- 語義：正取（confirmed），候補放 `waitlistNames`；同行者用 `companionName`

### 2.2 報名兩條路徑

1. 前端 transaction：[firebase-crud.js:789](js/firebase-crud.js:789)（鎖定）
2. CF callable：[functions/index.js:4581](functions/index.js:4581)（被 [event-detail-signup.js:218](js/modules/event/event-detail-signup.js:218)、[event-detail-companion.js:187](js/modules/event/event-detail-companion.js:187) 呼叫）

**兩條都要改**。

### 2.3 Rules whitelist

[firestore.rules:437](firestore.rules:437) 限制一般用戶可寫欄位。必須先擴充。

### 2.4 Change-Watch

新欄位不觸發異常偵測也不受保護（Phase 5 可選擴充）。

### 2.5 noShowCount 無自動懲罰

Phase 3 後「勝」「Ivan」數字變 1 不會自動限權。

### 2.6 網路流量

30 人活動新欄位 +3KB，200 人 +22KB。遠低於 Firestore 1MB。

### 2.7 localStorage

81 events × 3KB = 240KB，距 500KB eviction 上限有餘裕。

### 2.8 索引限制

`participantsWithUid` 物件陣列無法建 `array-contains` 索引。當前業務無此需求。

### 2.9 相關系統

教育、賽事系統**皆不使用 `.participants`**。本計劃範圍僅 events 集合。

### 2.10 schemaVersion 語義

- 原始 events：無 `schemaVersion`（視為 version 1 legacy）
- Phase 1 後：寫 `schemaVersion: 2`

---

## 3. 設計決策

### 3.1 資料結構

```ts
participantsWithUid: Array<{
  uid: string,          // LINE UID 或同行者合成字串
  name: string,
  teamKey?: string|null
}>
waitlistWithUid?: Array<{uid, name, teamKey?}>
schemaVersion: 2
```

排序完全對應 `participants[]`（沿用 `_regSort`）。

### 3.2 additive 策略

舊欄位保留；讀取優先新；Phase 5 可選廢除。

### 3.3 遷移 + Race 策略

**Firestore transaction 不支援 collection query**（無法原子讀子集合），所以採用：
1. 接受 race 存在（Phase 2 約 1 分鐘內剛好有新寫入的機率低）
2. Double-check：遷移腳本 update 前**兩次 read event doc** 確認 schemaVersion 未升級
3. 自我修復：Phase 1 已部署後，新寫入自動產新欄位；若 race overwrite 了 ongoing event，下次 commit 自動修復
4. **已結束活動兜底**（v6 新增）：Phase 4 一致性檢查工具發現 `status: ended` 且 `participantsWithUid` 與 registrations 不一致時，提供「強制重算」按鈕一鍵修復

### 3.4 隱私方案

A（推薦，公開 UID）/ B（訪客限制，+2-3h）。預設 A，需使用者簽字。

---

## 4. 範圍

### 4.1 In Scope

- events 新欄位（`participantsWithUid` / `waitlistWithUid` / `schemaVersion`）
- `_rebuildOccupancy` 前後端擴充
- 10+2 寫入點 + 6 讀取點改動
- Rules whitelist 擴充
- Phase 2 遷移 + Phase 4 一致性工具（v6 強化已結束活動修復）
- 4 個既有測試更新 + 2 個新增（`_isValidParticipantUid` + **同暱稱情境**）
- `_isValidParticipantUid` 格式驗證
- 文件同步（schema / memory / CLAUDE.md）

### 4.2 Out of Scope

- 不移除舊 `participants[]`
- 不修 `scan-process.js:59` / `event-manage-attendance.js:51` userName fallback
- 不動 transaction 核心
- 不統一 attendanceRecords / activityRecords uid（已遷移）
- 不擴充 `CHANGE_WATCH_EVENT_SIGNUP_FIELDS`
- 不改訪客讀取（採方案 A）
- 不自動化雙端測試（手動 review）
- 教育 / 賽事系統不動

### 4.3 讀取端（必改 6 / 不改 6）

| # | 檔案:行 | 處理 |
|---|---|---|
| 1 | `event-manage-noshow.js:63-76` | ✅ 改 |
| 2 | `event-manage-confirm.js:115-126`（鎖定）| ✅ 改 fallback |
| 3 | `event-manage-instant-save.js:31` | ✅ 改 |
| 4 | `event-detail.js:145-157` `_buildGuestEventPeople` | ✅ 改 |
| 5 | `event-detail.js:283` count | ✅ 改 |
| 6 | `event-create.js:245-251` | ✅ 改 |
| 7-12 | 其他 6 處純字串用途 | ⚠️ 不改 |

---

## 5. Phase 實作

### Phase 1a：Rules 擴充（10 分 + 30 分觀察）

```diff
  changed.hasOnly([
-   'current', 'waitlist', 'participants', 'waitlistNames', 'status', 'updatedAt'
+   'current', 'waitlist', 'participants', 'waitlistNames', 'status', 'updatedAt',
+   'participantsWithUid', 'waitlistWithUid', 'schemaVersion'
  ]);
```

部署：`npm run test:rules && firebase deploy --only firestore:rules`

---

### Phase 1：寫入路徑（3-4 小時）

**部署策略**（v9 重新修正）：
- CF 和前端是**獨立部署**
- **建議 CF 先**，但**觀察機制修正**：
  1. CF 部署後進 Firebase Console → Functions → Logs，確認版本號更新成功（`deployed function registerForEvent`）
  2. **不依賴觀察流量**（因前端還沒部署，CF callable 不會被觸發）
  3. 確認 CF 部署無錯誤後即可部署前端
- **前端部署後 2 小時內**密切監控：
  - `firebase functions:log --only registerForEvent --lines 50` 確認 CF callable 第一筆實際流量無錯誤
  - `errorLogs` 集合新增筆數
  - 此時才是真正的「新欄位實戰測試」
- 若同時部署也可（建議低峰時段）

**變更 1**：`_rebuildOccupancy`（前端 + CF 同步）
```js
// ⚠️ 雙端同步：此函式與 functions/index.js:4369 rebuildOccupancy 必須邏輯一致
//    執行附錄 I grep 腳本輔助雙端比對
const _buildWuEntry = (r) => {
  const isComp = r.participantType === 'companion';
  const uid = isComp
    ? String(r.companionId || (r.userId ? `${r.userId}_${r.companionName || ''}` : '')).trim()
    : String(r.userId || '').trim();
  const name = isComp
    ? String(r.companionName || r.userName || '').trim()
    : String(r.userName || '').trim();
  return { uid, name, teamKey: r.teamKey || null };
};
const _isValidWu = (x) => x.uid && x.name && !x.uid.endsWith('_');
const participantsWithUid = confirmed.map(_buildWuEntry).filter(_isValidWu);
const waitlistWithUid = waitlisted.map(_buildWuEntry).filter(_isValidWu);
return { ..., participantsWithUid, waitlistWithUid };
```

**變更 2**：`_applyRebuildOccupancy` 寫入本地快取新欄位。

**變更 3**：10+2 處 `db.update()` 擴充：
```diff
  update({
    ...
+   participantsWithUid: occupancy.participantsWithUid,
+   waitlistWithUid: occupancy.waitlistWithUid,
+   schemaVersion: 2,
    status: occupancy.status,
  });
```

**Log tag**：前端 + CF 加 `console.log('[pwu]', eventId, wu.length)` 方便事後 grep。

**驗證**：
- `npm run test:unit` 全過
- **新測試**：`participant-uid-validation.test.js` + `participants-with-uid-same-name.test.js`（v6 新增，見 6.2）
- 雙端手動 review（附錄 B）+ `scripts/check-rebuild-occupancy-sync.sh` 輔助
- 7 項 smoke test
- `registration-integrity-check.js`（注意：此腳本**只檢查舊邏輯一致性**，不驗證 participantsWithUid，新欄位由 ⑪ 檢查工具負責）

**觀察**：2-4 小時 errorLogs + `[pwu]` log。

---

### Phase 2：遷移（1 小時）

```js
async function _backfillParticipantsWithUid(ui) {
  const events = FirebaseService._cache.events || [];
  for (const event of events) {
    const eventDoc = await db.collection('events').doc(event._docId)
      .get({ source: 'server' });
    const ed = eventDoc.data();

    // 跳過已升級（避免 overwrite 新寫入）
    if (ed.schemaVersion === 2
      && Array.isArray(ed.participantsWithUid)
      && ed.participantsWithUid.length === (ed.current || 0)) {
      ui.log('[pwu] skip migrated: ' + event.title);
      continue;
    }

    const regsSnap = await db.collection('events').doc(event._docId)
      .collection('registrations').get();
    const allRegs = regsSnap.docs.map(d => ({...d.data(), _docId: d.id}));

    // 第二次 read 減少 race 窗口
    const verify = await db.collection('events').doc(event._docId)
      .get({ source: 'server' });
    if (verify.data().schemaVersion === 2) {
      ui.log('[pwu] skip (race): ' + event.title);
      continue;
    }

    const occupancy = FirebaseService._rebuildOccupancy(ed, allRegs);
    await db.collection('events').doc(event._docId).update({
      participantsWithUid: occupancy.participantsWithUid,
      waitlistWithUid: occupancy.waitlistWithUid,
      schemaVersion: 2,
    });
    ui.log('[pwu] migrated: ' + event.title);
    await new Promise(r => setTimeout(r, 50));
  }
}
```

**時段建議**：週間凌晨 02:00-08:00。

---

### Phase 3：讀取切換（1.5-2 小時）

**變更**（6 處讀取端）：
```js
// 優先新欄位
const wu = Array.isArray(e.participantsWithUid) ? e.participantsWithUid : [];
const expectedLen = Number(e.current || 0);
if (wu.length > 0 && wu.length === expectedLen) {
  wu.filter(x => App._isValidParticipantUid?.(x.uid))
    .forEach(({uid, name, teamKey}) => {
      people.push({ uid, name, teamKey, isCompanion: false, ... });
    });
} else {
  if (wu.length > 0) console.warn('[pwu] inconsistent', e.id);
  // Fallback 舊邏輯
  // ...
}
```

**_isValidParticipantUid**：`/^U[0-9a-f]{32}(_.+)?$/`

**驗證**：
- ⑨ 偵測 bug 消失
- 受害者（勝、Ivan）正確
- 訪客模式
- XSS / corrupted 模擬

**觀察**：48 小時。

---

### Phase 4：一致性工具（1-1.5 小時）

**⑪ participantsWithUid 一致性檢查（唯讀）**：
- 逐個 event 比對 `participantsWithUid` 與從 registrations 重算的期望結果
- 列出不一致的 events（長度差、uid 差、schemaVersion 差）
- 純唯讀，任何 admin 可執行

**⑫ participantsWithUid 強制重算（寫入，v7 新增分離）**：
- **權限守衛**：必須 `hasPermission('admin.repair.data_sync')`，一般用戶不可見
- **二次確認**：點擊後 appConfirm「確認重算 N 個不一致 events？」
- **race 緩解**（同 Phase 2 double-check）：
  ```js
  async function _forceRebuildEvent(eventDocId) {
    if (!this.hasPermission?.('admin.repair.data_sync')) {
      this.showToast('權限不足'); return;
    }
    // Read 1: event
    const before = await db.collection('events').doc(eventDocId).get({ source: 'server' });
    const ed = before.data();
    // Read 2: registrations
    const regsSnap = await db.collection('events').doc(eventDocId)
      .collection('registrations').get();
    const allRegs = regsSnap.docs.map(d => ({...d.data(), _docId: d.id}));
    // Read 3: verify event 仍不一致（double-check 減少 race）
    const verify = await db.collection('events').doc(eventDocId)
      .get({ source: 'server' });
    const expected = FirebaseService._rebuildOccupancy(verify.data(), allRegs);
    if (verify.data().participantsWithUid?.length === expected.participantsWithUid.length
      && JSON.stringify(verify.data().participantsWithUid?.map(x => x.uid))
         === JSON.stringify(expected.participantsWithUid.map(x => x.uid))) {
      ui.log('[pwu] skip (race healed): ' + eventDocId);
      return;
    }
    await db.collection('events').doc(eventDocId).update({
      participantsWithUid: expected.participantsWithUid,
      waitlistWithUid: expected.waitlistWithUid,
      schemaVersion: 2,
    });
    ui.log('[pwu] force rebuilt: ' + eventDocId);
  }
  ```
- **用途**：Phase 2 遷移後仍不一致的 events、已結束活動的修復

**執行頻率**（v8 明確化）：
- **Phase 3 上線首週**：⑪ 每日執行一次，⑫ 發現不一致立即修復（積極監測期）
- **Phase 3 穩定後（第 2 週起）**：⑪ 每週執行，⑫ 按需
- **長期維運**：⑪ 每月執行一次作為健康檢查

**紀錄留存**：每次執行結果（通過 / 不一致 event 數）建議截圖或記錄到 `docs/claude-memory.md`，累積系統健康度基線。

---

### Phase 5（未來，v7 明確排序）

**執行時機**：Phase 3 穩定 2-4 週後評估。

| 優先 | 項目 | 工時 | 前置條件 |
|---|---|---|---|
| **P1** | 廢除舊 `participants[]` / `waitlistNames` | 2-3h | 所有在線 client 升級到含 Phase 3 版本（CACHE_VERSION 驗證）|
| P2 | 移除 `scan-process.js:59` / `event-manage-attendance.js:51` userName fallback | 1h | 獨立；可與 P1 並行 |
| P3 | 擴充 `CHANGE_WATCH_EVENT_SIGNUP_FIELDS` 保護新欄位 | 30 分 | 獨立 |
| P4 | 隱私方案 B（訪客限制讀 UID） | 2-3h | 需使用者重新評估（若 Phase 3 後仍偏好方案 A 可不做） |

---

## 6. 測試

### 6.1 單元測試

| 測試檔 | 變更 |
|---|---|
| `pure-functions.test.js` | `_rebuildOccupancy` 新欄位期望 |
| `registration-transaction.test.js` | Transaction 寫新欄位 |
| `waitlist-capacity.test.js` | 候補遞補新欄位 |
| `batch-registration.test.js` | 批次同行者新欄位 |
| **`participant-uid-validation.test.js`**（新增）| 格式驗證 10 case |
| **`participants-with-uid-same-name.test.js`**（v6 新增）| **同暱稱情境** |

### 6.2 核心測試：同暱稱情境（v6 必加）

```js
describe('_rebuildOccupancy handles same userName with different userId', () => {
  test('two confirmed regs with same name but different uid produce 2 distinct entries', () => {
    const event = { max: 10, status: 'open' };
    const regs = [
      { userId: 'U1111', userName: '阿明', status: 'confirmed',
        participantType: 'self', registeredAt: '2024-01-01T00:00:00Z' },
      { userId: 'U2222', userName: '阿明', status: 'confirmed',
        participantType: 'self', registeredAt: '2024-01-01T00:01:00Z' },
    ];
    const result = FirebaseService._rebuildOccupancy(event, regs);
    expect(result.participantsWithUid).toHaveLength(2);
    expect(result.participantsWithUid[0].uid).toBe('U1111');
    expect(result.participantsWithUid[1].uid).toBe('U2222');
    expect(result.participantsWithUid[0].name).toBe('阿明');
    expect(result.participantsWithUid[1].name).toBe('阿明');
  });

  test('companion with same name as existing user has distinct synthetic uid', () => {
    const event = { max: 10, status: 'open' };
    const regs = [
      { userId: 'U1111', userName: '阿明', status: 'confirmed',
        participantType: 'self', registeredAt: '2024-01-01T00:00:00Z' },
      { userId: 'U3333', userName: '小華', status: 'confirmed',
        participantType: 'companion', companionId: 'U3333_阿明', companionName: '阿明',
        registeredAt: '2024-01-01T00:02:00Z' },
    ];
    const result = FirebaseService._rebuildOccupancy(event, regs);
    const unames = result.participantsWithUid.filter(x => x.name === '阿明');
    expect(unames).toHaveLength(2);
    expect(unames[0].uid).toBe('U1111');
    expect(unames[1].uid).toBe('U3333_阿明');
  });

  test('teamKey propagated correctly', () => {
    const event = { max: 10, status: 'open' };
    const regs = [
      { userId: 'U1', userName: 'A', status: 'confirmed', teamKey: 'A',
        participantType: 'self', registeredAt: '2024-01-01T00:00:00Z' },
    ];
    const result = FirebaseService._rebuildOccupancy(event, regs);
    expect(result.participantsWithUid[0].teamKey).toBe('A');
  });

  test('same userName in waitlist also produces distinct uids (v7 追加)', () => {
    const event = { max: 1, status: 'full' };
    const regs = [
      { userId: 'U1111', userName: '阿明', status: 'confirmed',
        participantType: 'self', registeredAt: '2024-01-01T00:00:00Z' },
      { userId: 'U2222', userName: '阿明', status: 'waitlisted',
        participantType: 'self', registeredAt: '2024-01-01T00:01:00Z' },
      { userId: 'U3333', userName: '阿明', status: 'waitlisted',
        participantType: 'self', registeredAt: '2024-01-01T00:02:00Z' },
    ];
    const result = FirebaseService._rebuildOccupancy(event, regs);
    expect(result.participantsWithUid).toHaveLength(1);
    expect(result.waitlistWithUid).toHaveLength(2);
    expect(result.waitlistWithUid[0].uid).toBe('U2222');
    expect(result.waitlistWithUid[1].uid).toBe('U3333');
  });

  test('same userName: confirmed + companion with same name (v7 追加)', () => {
    const event = { max: 10, status: 'open' };
    const regs = [
      { userId: 'U1111', userName: '阿明', status: 'confirmed',
        participantType: 'self', registeredAt: '2024-01-01T00:00:00Z' },
      { userId: 'U2222', userName: '小華', status: 'confirmed',
        participantType: 'self', registeredAt: '2024-01-01T00:01:00Z' },
      { userId: 'U2222', userName: '小華', status: 'confirmed',
        participantType: 'companion', companionId: 'U2222_阿明', companionName: '阿明',
        registeredAt: '2024-01-01T00:02:00Z' },
    ];
    const result = FirebaseService._rebuildOccupancy(event, regs);
    // Two '阿明' should have distinct uids: 'U1111' and 'U2222_阿明'
    const amings = result.participantsWithUid.filter(x => x.name === '阿明');
    expect(amings).toHaveLength(2);
    expect(amings[0].uid).not.toBe(amings[1].uid);
  });
});
```

### 6.3 `_isValidParticipantUid` 10 個 case（見 v5 附錄 6.2）

### 6.4 整合測試

- 7 項 smoke test + XSS + corrupted 模擬
- 雙端 grep 腳本（附錄 I）

---

## 7. 風險矩陣

| # | 風險 | 機率 | 影響 | 緩解 |
|---|---|---|---|---|
| R1 | rules 部署失敗 | 1% | 災難 | emulators |
| R2 | `_rebuildOccupancy` 雙端不同步 | 35% | 中 | 手動 review + grep 腳本 + 註解 |
| R3 | 漏改寫入點 | 25% | 中 | Phase 4 一致性工具（v6 含強制修復）|
| R4 | Phase 2 遷移部分失敗 | 30% | 低 | fallback + Phase 4 修復 |
| R5 | 鎖定函式引入 bug | 3% | 嚴重 | integrity-check |
| R6 | 同行者空值 | 15% | 低 | `_isValidWu` |
| R7 | 既有測試 break | 95% | 低 | 跟著改 |
| R8 | CF callable 遺漏 | 10% | 中 | Phase 1 CF 2 處 |
| R9 | Change-watch 誤判 | 0% | 無 | — |
| R10 | UID 隱私 | 100%（A）| 低 | 簽字 |
| R11 | 受害者誤解 | 20% | 低 | 私訊通知 |
| R12 | Race 自我修復失敗（含已結束活動）| 5%（v6 下修）| 低 | Phase 4 一致性工具強制修復 |
| R13 | 惡意寫入 | 5% | 低 | `_isValidParticipantUid` |
| R14 | 流量翻倍 | 100% | 低 | 絕對值小 |
| R15 | Corrupted data | 5% | 低 | Phase 3 fallback |
| R16 | teamKey 未帶 | 0% | 無 | v4 已納入 |
| R17 | CF/前端部署時序 | 5%（v6 下修）| 低 | 獨立部署，建議 CF 先 15-30 分鐘觀察 |
| R18 | 熱修復中斷服務 | 5% | 中 | 細緻封鎖（只擋新欄位）|
| **R19** | **⑫ 強制重算誤觸或 race overwrite**（v7 新增）| 5% | 低 | 權限守衛 `admin.repair.data_sync` + 二次確認 + double-check |

**總體**：~65% 至少 1 個 minor bug，~25% 用戶可見，~5% 緊急回滾。

---

## 8. 監控與回退

### 8.1 Rollback

- Phase 1a：git revert + rules 部署 = 5-10 分
- Phase 1：git revert + CF + 前端 CI + Pages = 10-30 分
- Phase 2：無需
- Phase 3：git revert + CI + 部署 = 10-30 分

### 8.2 熱修復

**細緻封鎖**（推薦）：Rules 暫時移除 whitelist 中的新欄位，報名功能維持。
**極端封鎖**：`allow update: if false` 會中斷報名 5-10 分鐘。

### 8.3 監控

```bash
# CF 錯誤
firebase functions:log --only registerForEvent --lines 50

# 前端 errorLogs（console）
const snap = await db.collection('errorLogs')
  .where('timestamp', '>=', new Date(Date.now() - 3600000))
  .orderBy('timestamp', 'desc').limit(50).get();
console.table(snap.docs.map(d => ({
  fn: d.data().context?.fn,
  tag: (d.data().message || '').includes('[pwu]') ? 'pwu' : '',
  time: d.data().timestamp?.toDate()
})));
```

### 8.4 回滾觸發

| 情境 | 閾值 |
|---|---|
| Phase 1a 後 CF ERROR | 10 分內 > 平時 3x |
| Phase 1 後 errorLogs | 1 小時內 > 5 筆 registration 相關 |
| Phase 1 後用戶回報 | 2 小時內 > 2 則 |
| Phase 3 後 ⑨ 偵測 | 污染組沒下降或反增 |
| Phase 3 後用戶回報 | 48 小時內 > 3 則 |

### 8.5 部署時段

推薦：週間 02:00-08:00（Phase 1 / 3）或日間 10:00-17:00（Phase 1a / 2 / 4）。

---

## 9. 部署 checklist

### 執行前
- [ ] 隱私方案（A/B）
- [ ] 執行節奏（併行/批次/保守）
- [ ] 受害者通知
- [ ] teamKey 納入（默認 yes）

### Phase 1a
- [ ] `npm run test:rules`
- [ ] 選低峰
- [ ] 部署後 10 分 errorLogs 無 spike

### Phase 1
- [ ] Phase 1a 穩定 30 分
- [ ] `npm run test:unit` 全過（含新增 2 test）
- [ ] 雙端手動 review + grep 腳本
- [ ] 4 處版號
- [ ] CF 先部署觀察 15-30 分
- [ ] 前端部署
- [ ] Console 驗證新舊欄位長度一致
- [ ] `registration-integrity-check.js`（檢查舊邏輯）
- [ ] ⑪ 一致性檢查（檢查新欄位）
- [ ] 觀察 2-4 小時 errorLogs + `[pwu]` log

### Phase 2
- [ ] Phase 1 穩定 2-4 小時
- [ ] ⑨ 偵測 baseline
- [ ] 執行遷移
- [ ] 後：⑨ 偵測下降；`schemaVersion === 2` 覆蓋
- [ ] ⑪ 一致性檢查

### Phase 3
- [ ] 私訊通知「勝」「Ivan」
- [ ] Phase 2 驗證
- [ ] 4 處版號
- [ ] 更新 `firestore-schema.md`（附錄 F）
- [ ] 低峰
- [ ] 後：受害者正確；訪客正確；XSS / corrupted 模擬；48 小時觀察
- [ ] `claude-memory.md` 加 `[永久]`（附錄 E）
- [ ] `CLAUDE.md` 加規則（附錄 G）

---

## 10. 時程

| Phase | 工時 | 間隔 |
|---|---|---|
| 1a | 10 分 | 30 分 |
| 1 | 3-4 小時 | 2-4 小時 |
| 2 | 1 小時 | 1-2 小時 |
| 3 | 1.5-2 小時 | 48 小時 |
| 4 | 1 小時 | 立即 |

**專注**：6-9 小時 / **Elapsed**：3-5 個工作日。

---

## 11. 成功標準

- ✅ ⑨ 偵測 bug 消失
- ✅ 勝、Ivan 數字正確
- ✅ 訪客點名字跳對
- ✅ `npm run test:unit` 全過
- ✅ 報名流程無回歸
- ✅ `registration-integrity-check.js` 通過
- ✅ ⑪ 一致性檢查全同步
- ✅ 所有 events `schemaVersion === 2`
- ✅ 隱私方案簽字

---

## 12. 附錄 A：受影響檔案

### 修改（11-12 檔）
firestore.rules / firebase-crud.js / event-manage-{waitlist,lifecycle,confirm,noshow,instant-save}.js / event-create{,-waitlist}.js / event-detail.js / registration-audit.js / data-sync.js / admin-system.html / functions/index.js

### 測試
更新 4 + 新增 2（`participant-uid-validation.test.js` + `participants-with-uid-same-name.test.js`）

### 版號
4 處（config.js / sw.js / index.html var V / 68 ?v=）

### 文件
firestore-schema.md / claude-memory.md / CLAUDE.md

---

## 13. 附錄 B：雙端手動 review

- [ ] `_buildWuEntry` 邏輯一致（uid 合成/name/teamKey）
- [ ] `_isValidWu` 一致
- [ ] 回傳結構（欄位數 + 名）
- [ ] `_regSort` 一致
- [ ] `_dedupRegs` 一致
- [ ] Functions Shell + 前端 console 跑 mock 比對
- [ ] `scripts/check-rebuild-occupancy-sync.sh` 通過

---

## 14. 附錄 C：鎖定函式範圍

| 函式 | 允許 | 禁止 |
|---|---|---|
| `_rebuildOccupancy` | 回傳擴充 | 去重/排序/計數 |
| `_confirmAllAttendance` | L115-126 fallback | 出席/EXP |
| `registerForEvent` 等 | update 擴充 | transaction 邏輯 |
| `cancelRegistration` 等 | batch 擴充 | 候補遞補 |

---

## 15. 附錄 D：v1 → v6 演進

| 版本 | 主要變更 |
|---|---|
| v1 | 初版 |
| v2 | 讀取端補全、CF callable、隱私章節 |
| v3 | 流量量化、race 緩解、UID 驗證 |
| v4 | Phase 合併、teamKey、schemaVersion、熱修復 |
| v5 | Race 誠實化、部署時序、test case、log tag |
| v6 | 同暱稱 test、已結束活動強制修復、TL;DR、部署時序簡化 |
| v7 | Phase 4 權限守衛 + ⑪⑫ 分離、race 緩解、同暱稱+候補 test、Phase 5 排序 |
| v8 | Phase 4 執行頻率、TL;DR 清理、claude-memory 日期提示 |
| **v9** | **CF 部署驗證機制修正（不依賴觀察流量）→ 所有 🔴🟡 風險消除** |

---

## 16. 附錄 E：`claude-memory.md` 草稿

```markdown
### YYYY-MM-DD — events.participantsWithUid 導入 [永久]
<!-- 部署時填入實際日期（格式：2026-04-XX）-->
- 問題：14 組同暱稱用戶，_buildConfirmedParticipantSummary fallback
  用 _userByName.set(name, user) 反查 UID，同名被覆蓋
  （勝、Ivan 放鴿子 1 次被隱身）
- 修復：events 新增 participantsWithUid: [{uid,name,teamKey}] + schemaVersion: 2
- 教訓：禁止用 name 反查 uid 做身分識別；公開副本欄位必帶 UID
- 決策：additive / schemaVersion 標記 / 手動雙端 review / 隱私方案 A / race 接受自我修復
```

---

## 17. 附錄 F：`firestore-schema.md` diff

```diff
+| participantsWithUid | array\<{uid,name,teamKey}\> | 正取 UID+名字+分隊（2026-04 新增）|
+| waitlistWithUid | array\<{uid,name,teamKey}\> | 候補同上 |
+| schemaVersion | number | 結構版本（undefined=1 legacy，2=升級後）|
```

---

## 18. 附錄 G：`CLAUDE.md` 新規則

```markdown
### 禁止用 name 反查 uid 做身分識別（2026-04 教訓）

- 需公開副本欄位時，必須帶 UID 結構，不得用 name 反查
- 舊資料 fallback 必須偵測同名衝突並警告
- 案例：events.participantsWithUid
```

---

## 19. 附錄 H：使用者決策簽字欄

### H.1 隱私
- [ ] A（推薦）：公開 UID
- [ ] B：訪客限制（+2-3h）

### H.2 節奏
- [ ] 併行 / [ ] 批次 / [ ] 保守

### H.3 通知
- [ ] 我通知勝/Ivan / [ ] 不通知

### H.4 teamKey
- [ ] 納入（默認）/ [ ] 不納入

---

## 20. 附錄 I：`scripts/check-rebuild-occupancy-sync.sh`

```bash
#!/bin/bash
# 輔助雙端一致性粗檢（確認關鍵字存在，不驗證邏輯）
FRONTEND="js/firebase-crud.js"
CF="functions/index.js"
KEYWORDS=("_buildWuEntry" "_isValidWu" "participantsWithUid" "waitlistWithUid"
          "participantType" "companionId" "companionName" "teamKey" "schemaVersion")

for kw in "${KEYWORDS[@]}"; do
  fc=$(grep -c "$kw" "$FRONTEND" 2>/dev/null || echo 0)
  cc=$(grep -c "$kw" "$CF" 2>/dev/null || echo 0)
  if [ "$fc" -eq 0 ] || [ "$cc" -eq 0 ]; then
    echo "[WARN] '$kw' 缺失：frontend=$fc cf=$cc"
  fi
done
echo "[check] done — 請手動比對邏輯，此腳本只驗關鍵字存在"
```

執行：Phase 1 修改後 `bash scripts/check-rebuild-occupancy-sync.sh`
