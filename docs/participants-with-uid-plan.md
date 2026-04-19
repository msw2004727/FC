# `participantsWithUid` 遷移計劃書

> **產生日期**：2026-04-19
> **目的**：根治同暱稱用戶互相干擾的 bug（用戶回報：A 的放鴿子紀錄顯示在 B 身上）
> **狀態**：待使用者批准 Phase 1a

---

## 1. 執行摘要

**問題**：[event-manage-noshow.js:63-76](js/modules/event/event-manage-noshow.js:63) 的 `_buildConfirmedParticipantSummary` fallback 路徑，用 `_userByName.set(name, user)` 從名字反查 UID，同暱稱會被後者覆蓋，導致下游顯示錯位。

**已驗證規模**（2026-04-19 ⑨ 偵測）：
- 729 位用戶中 **14 組同暱稱**（28 人）
- **12 組有活動污染**（participants[] 中含該暱稱）
- **2 組已產生實際誤植**（「勝」、「Ivan」各 1 次放鴿子紀錄被隱身）

**根治方案**：events 新增 `participantsWithUid: [{uid, name}]` 物件陣列，消除 name 反查。採 additive 策略，舊 `participants[]` 保留作為 fallback。

**工時**：5-6 小時，分 5 個 Phase 漸進部署。

**最壞情況**：需緊急回滾（機率 ~5%），但 additive 設計保證不會資料損壞。

---

## 2. 背景與現況

### 2.1 系統架構（Phase 0 調查結論）

`participants[]` 字串陣列在 events 文件上，由**唯一的純函式 `_rebuildOccupancy()`** 生成：

- 前端：[firebase-crud.js:578-635](js/firebase-crud.js:578)（鎖定函式）
- CF：[functions/index.js:4369](functions/index.js:4369)（雙端必須同步，CLAUDE.md 明寫規則）
- 寫入觸點：約 10 處，全部透過 `occupancy.participants` 傳遞
- 語義：僅含正取（confirmed），候補另放 `waitlistNames`；同行者顯示 `companionName`

### 2.2 Firestore Rules 限制

[firestore.rules:437](firestore.rules:437) 有一般用戶可寫欄位 whitelist：
```js
changed.hasOnly(['current', 'waitlist', 'participants', 'waitlistNames', 'status', 'updatedAt'])
```

**必須先擴充 whitelist 再部署程式碼**，否則一般用戶的報名 transaction 會被 Rules 擋。

### 2.3 為什麼不用更簡單的 Patch

| 方案 | 問題 |
|---|---|
| C. `_userByName` 改成「選報名最多者當勝者」 | 1:1 平手時仍瞎猜；bug 仍潛在；未來新同名組會再爆 |
| B. 請用戶改暱稱 | 暱稱是 LINE displayName，需協調；14 組難聯繫；未來新註冊會重生 |
| **A. participantsWithUid（本計劃）** | **一勞永逸**；但工程量中等 |

---

## 3. 設計決策

### 3.1 資料結構

**events 文件新增欄位**：
```ts
participantsWithUid: Array<{uid: string, name: string}>     // 正取（對應 participants[]）
waitlistWithUid?: Array<{uid: string, name: string}>        // 候補（對應 waitlistNames[]）
```

**語義**：
- `uid` 欄位值：主報名者為 LINE UID（U 開頭 32 hex），同行者為 `companionId`（合成字串：`mainUid + '_' + companionName`，是唯一 ID 但非真 LINE UID）
- `name` 欄位值：主報名者為 `userName`，同行者為 `companionName`
- 陣列順序與 `participants[]` 一致（`_regSort` 排序後）

### 3.2 additive 策略

- 舊 `participants[]` / `waitlistNames[]` **保留**，不廢除
- 新欄位 additive 寫入，舊讀取路徑繼續運作
- 讀取端採「優先 `participantsWithUid`，fallback 到 `participants[]`」
- Phase 4（可選）再評估是否廢除舊欄位

### 3.3 遷移策略

**絕不從 `participants[]` 字串反查 UID**（同名會挑錯，正是 bug 本身）。

改為：**從 registrations 子集合重建** `participantsWithUid`，類似 `_rebuildOccupancy` 的邏輯但只產出新欄位。

對於 `participants[]` 中有但 registrations 無對應的字串（歷史亂入資料），**跳過不瞎填**，讀取端保留舊 fallback。

---

## 4. 範圍定義

### 4.1 In Scope

- events 新增 `participantsWithUid` / `waitlistWithUid` 欄位
- `_rebuildOccupancy`（前端 + CF）擴充回傳
- 10 處 `db.update({ participants: ... })` 擴充寫入新欄位
- `firestore.rules` whitelist 擴充
- 3 個下游讀取端改 fallback 優先
  - `_buildConfirmedParticipantSummary`
  - `_confirmAllAttendance`（鎖定函式，只改 fallback 段）
  - `_initInstantSave`
- Phase 2 資料遷移腳本（data-sync 新增 ⑩）
- 既有 4 個 `_rebuildOccupancy` 測試更新

### 4.2 Out of Scope

- ❌ **不移除**舊 `participants[]` 欄位（留作 fallback）
- ❌ **不修改** `scan-process.js:59` 和 `event-manage-attendance.js:51` 的 userName fallback（那兩處屬於另一類 bug，Phase 4 再評估）
- ❌ **不改動**候補順序、佔位重建、報名/取消/遞補的 transaction 核心邏輯
- ❌ **不統一** `attendanceRecords` / `activityRecords` 的 uid 欄位（那些已於 2026-03-17 遷移完成）
- ❌ **不新增**後台「手動編輯 participants[]」的 UI（目前不存在此路徑）

---

## 5. Phase 分段實作

### Phase 1a：Firestore Rules 擴充（10 分鐘）

**變更**：[firestore.rules:437](firestore.rules:437)
```diff
  changed.hasOnly([
-   'current', 'waitlist', 'participants', 'waitlistNames', 'status', 'updatedAt'
+   'current', 'waitlist', 'participants', 'waitlistNames', 'status', 'updatedAt',
+   'participantsWithUid', 'waitlistWithUid'
  ]);
```

**部署**：
```bash
npm run test:rules      # 確保規則測試通過
firebase deploy --only firestore:rules
```

**驗證**：
- 既有報名流程正常（一般用戶可報名 / 取消）
- 讀取 events 正常

**回退**：`git revert` + 重新部署 rules（30 秒）

**為什麼先做這步**：rules 擴充對舊 client 無害（允許的欄位比實際寫入的多不會出錯），可以提前部署，後續 Phase 才有地方寫入。

---

### Phase 1b：`_rebuildOccupancy` 雙端同步（1 小時）

**變更 1**：[firebase-crud.js:578-635](js/firebase-crud.js:578) `_rebuildOccupancy`（鎖定函式，只動回傳）
```diff
  const participants = confirmed.map(r => /* ... */).filter(Boolean);
  const waitlistNames = waitlisted.map(r => /* ... */).filter(Boolean);
+ const participantsWithUid = confirmed.map(r => ({
+   uid: r.participantType === 'companion'
+     ? String(r.companionId || `${r.userId}_${r.companionName || ''}`)
+     : String(r.userId || ''),
+   name: r.participantType === 'companion'
+     ? String(r.companionName || r.userName || '').trim()
+     : String(r.userName || '').trim()
+ })).filter(x => x.uid && x.name);
+ const waitlistWithUid = waitlisted.map(/* 同上 */).filter(x => x.uid && x.name);

  return {
    participants, waitlistNames, current, waitlist, status,
+   participantsWithUid, waitlistWithUid
  };
```

**變更 2**：[firebase-crud.js:640-645](js/firebase-crud.js:640) `_applyRebuildOccupancy`
```diff
  event.participants = occupancy.participants;
  event.waitlistNames = occupancy.waitlistNames;
+ event.participantsWithUid = occupancy.participantsWithUid;
+ event.waitlistWithUid = occupancy.waitlistWithUid;
  event.current = occupancy.current;
  event.waitlist = occupancy.waitlist;
```

**變更 3**：[functions/index.js:4369](functions/index.js:4369) `rebuildOccupancy` — **與前端 1:1 同步**

**驗證**：
- `npm run test:unit` 全過（51 suites / 2169 tests）
- 既有 `_rebuildOccupancy` 測試擴充驗證新欄位

**回退**：`git revert` + push（2 分鐘）

---

### Phase 1c：寫入點擴充（1 小時）

**全部需要擴充的 10 處**（Phase 0 已 grep 確認）：

| 檔案 | 位置 | 函式 |
|---|---|---|
| `js/firebase-crud.js` | L897 | `registerForEvent` transaction update |
| `js/firebase-crud.js` | L1081 | `batchRegisterForEvent` transaction update |
| `js/firebase-crud.js` | L2191 | `cancelCompanionRegistrations` update |
| `js/firebase-crud.js` | L2418 | `cancelRegistration` batch update |
| `js/modules/event/event-manage-waitlist.js` | L234, L364 | 候補遞補/降級 |
| `js/modules/event/event-manage-lifecycle.js` | L438 | 活動結束/容量變更 |
| `js/modules/event/event-create-waitlist.js` | L165, L263 | `_adjustWaitlistOnCapacityChange` |
| `js/modules/registration-audit.js` | L146, L294 | 報名審計修復 |
| `functions/index.js` | L4858, L5134 | CF 佔位重建 |
| `js/modules/event/event-create.js` | L453 | 活動建立（`participants: event.participants \|\| []`）|

**變更模板**：
```diff
  db.collection('events').doc(docId).update({
    current: occupancy.current,
    waitlist: occupancy.waitlist,
    participants: occupancy.participants,
    waitlistNames: occupancy.waitlistNames,
+   participantsWithUid: occupancy.participantsWithUid,
+   waitlistWithUid: occupancy.waitlistWithUid,
    status: occupancy.status,
  });
```

**特例**：[event-create.js:453](js/modules/event/event-create.js:453) 是活動建立，初始化空陣列：
```diff
  participants: event.participants || [],
+ participantsWithUid: event.participantsWithUid || [],
+ waitlistWithUid: event.waitlistWithUid || [],
```

**驗證**：
- `npm run test:unit` 全過
- 跑一次完整報名→取消→候補遞補→完成活動的 smoke test
- 執行 `docs/registration-integrity-check.js` 確認報名系統一致性
- 在 console：`FirebaseService._cache.events.filter(e => e.status === 'open').map(e => ({t:e.title, p:e.participants?.length, pu:e.participantsWithUid?.length}))` — 確認新舊欄位長度一致

**回退**：`git revert` + push（2 分鐘）

---

### Phase 2：資料遷移（1 小時）

**新增功能**：在 `用戶補正管理 → 系統資料同步` 新增 ⑩ 回填 participantsWithUid

**變更檔案**：
- `js/modules/data-sync.js` 新增 `_backfillParticipantsWithUid(ui)` 函式 + `runDataSyncOp('backfillPU')` 分支
- `pages/admin-system.html` 新增第 10 張 form-card

**邏輯**：
```js
// 對每個 event，從 registrations 子集合重建 participantsWithUid
for (const event of events) {
  const regsSnap = await db.collection('events').doc(event._docId).collection('registrations').get();
  const allRegs = regsSnap.docs.map(d => ({...d.data(), _docId: d.id}));
  const occupancy = FirebaseService._rebuildOccupancy(event, allRegs);
  await db.collection('events').doc(event._docId).update({
    participantsWithUid: occupancy.participantsWithUid,
    waitlistWithUid: occupancy.waitlistWithUid,
  });
}
```

**驗證**：
- 執行前：跑 ⑨ 同暱稱偵測記錄「受影響活動數」
- 執行後：再跑 ⑨，確認受影響活動數下降（因為 participantsWithUid 已正確）
- 在 console：`FirebaseService._cache.events.filter(e => !e.participantsWithUid || e.participantsWithUid.length !== (e.current || 0))` — 確認所有 events 有完整 participantsWithUid

**回退**：無需回退（additive 寫入，可多次重跑）

---

### Phase 3：讀取端切換（1-1.5 小時）

**變更 1**：[event-manage-noshow.js:63-76](js/modules/event/event-manage-noshow.js:63) `_buildConfirmedParticipantSummary`
```diff
- // fallback：從 event.participants 字串陣列補齊
- const _userByName = new Map();
- _allUsers.forEach(u => { _userByName.set(n, u); });  // 同名會覆蓋
- (e.participants || []).forEach(p => {
-   const userDoc = _userByName.get(p);
-   const resolvedUid = userDoc?.uid || p;
-   people.push({ name: p, uid: resolvedUid, ... });
- });

+ // 優先用 participantsWithUid（無歧義，不用 name 反查）
+ if (Array.isArray(e.participantsWithUid) && e.participantsWithUid.length > 0) {
+   e.participantsWithUid.forEach(({uid, name}) => {
+     if (addedNames.has(name) || addedUids.has(uid)) return;
+     people.push({ name, uid, isCompanion: false, ... });
+     addedUids.add(uid); addedNames.add(name);
+   });
+ } else {
+   // Fallback：舊 participants[] 字串陣列（歷史資料未遷移時）
+   // 【保留】同名會覆蓋，但至少不讓畫面空白
+   const _userByName = new Map();
+   _allUsers.forEach(u => { _userByName.set(n, u); });
+   (e.participants || []).forEach(p => {
+     /* ...既有邏輯... */
+   });
+ }
```

**變更 2**：[event-manage-confirm.js:109-126](js/modules/event/event-manage-confirm.js:109) `_confirmAllAttendance`（鎖定函式，只改 fallback 段）— 同上模式

**變更 3**：[event-manage-instant-save.js:28-40](js/modules/event/event-manage-instant-save.js:28) `_initInstantSave` — 同上模式

**驗證**：
- `npm run test:unit` 全過
- 執行 ⑨ 同暱稱偵測，確認「bug 行為預測」不再出現
- 實機驗證：開啟「勝」或「Ivan」的活動詳情頁，確認他們的放鴿子次數正確顯示
- 管理員勾選模擬：開啟任一活動管理頁，checkbox 勾選/取消正常

**回退**：`git revert` + push（2 分鐘）

---

### Phase 4（可選，不在首輪）：廢除舊欄位

等 Phase 3 穩定 2-4 週、⑨ 偵測無新受害者後評估：
- 移除寫入端的 `participants[]` / `waitlistNames` 維護
- 移除讀取端的 fallback 分支
- 移除 `scan-process.js:59` 和 `event-manage-attendance.js:51` 的 userName fallback

---

## 6. 測試計畫

### 6.1 單元測試更新

| 測試檔 | 變更 |
|---|---|
| `tests/unit/pure-functions.test.js` | 擴充 `_rebuildOccupancy` 回傳驗證：新增 `participantsWithUid` / `waitlistWithUid` 期望 |
| `tests/unit/registration-transaction.test.js` | 驗證報名 transaction 寫入新欄位 |
| `tests/unit/waitlist-capacity.test.js` | 驗證候補遞補時新欄位同步 |
| `tests/unit/batch-registration.test.js` | 驗證批次同行者寫入新欄位 |

### 6.2 Rules 測試

- `npm run test:rules` 驗證 `participantsWithUid` 在 whitelist 內
- 手動測試：一般用戶報名時 event update 成功（不被 Rules 擋）

### 6.3 整合測試（實機）

Phase 1c 部署後：
1. 開新活動 → 報名 → 確認 `event.participantsWithUid.length === event.current`
2. 報同行者 → 確認新人出現在 `participantsWithUid` 且 `uid` 是 `companionId`
3. 取消報名 → 確認兩陣列都縮短
4. 額滿 → 報候補 → 確認 `waitlistWithUid` 增加
5. 取消正取 → 確認候補遞補，`participantsWithUid` 新增，`waitlistWithUid` 減少

### 6.4 受害者驗證（Phase 3 後）

- 「勝」（`U4a644dac...`）：登入個人頁，確認放鴿子次數顯示 **1 次**（而非被誤植的 0 次）
- 「Ivan」（`U6f06fcfe...`）：同上

---

## 7. 風險矩陣

| # | 風險 | 機率 | 影響 | 緩解 |
|---|---|---|---|---|
| R1 | firestore.rules 部署失敗 | 1% | 災難級 | Phase 1a 先過 emulators 測試 |
| R2 | `_rebuildOccupancy` 前後端不同步 | 25% | 中 | commit 前 diff 比對；加一致性 test |
| R3 | 漏改 10 處寫入點 | 40% | 中 | 本計劃已 grep 列出完整清單；Phase 2 遷移會補正 |
| R4 | Phase 2 遷移部分失敗（舊資料亂入） | 30% | 低 | 跳過無對應 reg 的 participants 字串；讀取端保留 fallback |
| R5 | 鎖定函式修改引入報名 bug | 3% | 嚴重 | 只動回傳/擴充，不改核心邏輯；`registration-integrity-check.js` 每 Phase 驗證 |
| R6 | 同行者 `companionId` 空值 | 15% | 低 | `_rebuildOccupancy` 用 fallback 合成 uid |
| R7 | Phase 2 遷移腳本寫入競爭 | 5% | 低 | additive 寫入，競爭結果仍是對的（Phase 1c 已部署寫入路徑） |
| R8 | 既有測試 break | 95% | 低（預期）| 跟著改 test |

**總體 bug 機率**：~65%（至少 1 個 minor bug），用戶可見 ~25%，緊急回滾 ~5%。

---

## 8. 回退計畫

| Phase | 回退方式 | 時間 |
|---|---|---|
| 1a | `git revert` rules commit + `firebase deploy --only firestore:rules` | 30 秒 |
| 1b | `git revert` + push | 2 分鐘 |
| 1c | `git revert` + push | 2 分鐘 |
| 2 | 無需回退（additive 寫入，重跑即可覆蓋） | N/A |
| 3 | `git revert` + push；Bug 回到舊狀態但資料完整 | 2 分鐘 |

**不可逆操作**：無。本計劃全部為 additive 變更。

---

## 9. 部署檢查清單

### Phase 1a 前
- [ ] `npm run test:rules` 通過
- [ ] firestore.rules 語法 lint 無錯誤

### Phase 1b/1c 前
- [ ] `npm run test:unit` 全過（2169 tests）
- [ ] 手動 smoke test：報名 / 取消 / 候補遞補一輪
- [ ] 4 處版號同步更新

### Phase 2 前
- [ ] Phase 1b/1c 已部署並穩定至少 24 小時
- [ ] ⑨ 同暱稱偵測截圖存檔（遷移前 baseline）

### Phase 3 前
- [ ] Phase 2 遷移已執行
- [ ] 抽樣 3-5 個 event 確認 `participantsWithUid` 與 `participants` 長度一致
- [ ] ⑨ 偵測的「受影響活動數」下降

### Phase 3 後
- [ ] 實機驗證「勝」/「Ivan」放鴿子次數顯示正確
- [ ] 管理員手動簽到流程正常
- [ ] QR 掃碼流程正常

---

## 10. 時程估算

| Phase | 工時 | 建議間隔 |
|---|---|---|
| 1a | 10 分 | 部署後觀察 1-2 小時 |
| 1b + 1c | 2-3 小時 | 部署後觀察 24 小時 |
| 2 | 1 小時 | 執行後觀察 1-2 小時 |
| 3 | 1-1.5 小時 | 部署後觀察 48 小時 |
| Tests | 30 分 | 併在各 Phase 內 |

**總計**：5-6 小時專注工作，跨 2-3 個工作日（含觀察期）。

---

## 11. 成功標準

- ✅ ⑨ 同暱稱偵測的「bug 行為預測」不再出現（或僅殘留讀取端 fallback 路徑）
- ✅ 「勝」、「Ivan」的真實放鴿子次數在個人頁與活動頁正確顯示
- ✅ `npm run test:unit` 全過
- ✅ 報名 / 取消 / 候補遞補 / 管理員簽到流程無回歸
- ✅ `registration-integrity-check.js` 檢查通過（無人數 / 候補順序異常）

---

## 12. 優劣與風險評估（白話版）

| 評估項目 | 內容 |
|---|---|
| **做了會怎樣（好處）** | 同暱稱用戶不再互相干擾；受害者數據正確顯示；未來新同名註冊也不會再爆 bug；符合 CLAUDE.md [永久]「實體 ID 統一規範」|
| **不做會怎樣** | 14 組潛在 bug 持續；現有 2 組實際誤植不解決；未來新同名用戶會不斷遇到類似問題 |
| **最壞情況** | Phase 3 讀取切換出現回歸，管理員簽到畫面錯亂；但 `git revert` 2 分鐘內恢復，資料不受損 |
| **影響範圍** | 約 8 個 JS 檔案 + CF + Rules；10 個寫入點 + 3 個讀取點；5-6 小時工程 + 2-3 天觀察 |
| **回退難度** | 秒級到 2 分鐘（全部 additive，無不可逆操作）|
| **歷史教訓** | 2026-03-17 已完成 `attendanceRecords.uid` 遷移，證實類似 additive migration 可行；本計劃沿用同一模式 |

---

## 13. 後續工作（Phase 4 清單，不在本輪）

等 Phase 3 穩定後評估：
1. 廢除 `participants[]` / `waitlistNames`（純舊欄位清理）
2. 移除 `scan-process.js:59` 和 `event-manage-attendance.js:51` 的 userName fallback（屬於另一類 bug）
3. 前端顯示「同暱稱提示」UX（讓同名組可被管理員識別）
4. 限制新註冊時檢測同暱稱（UX 防禦層）

---

## 附錄 A：受影響檔案完整清單

### 修改（8 個檔案）
- `firestore.rules`
- `js/firebase-crud.js`（含鎖定函式 `_rebuildOccupancy`）
- `js/modules/event/event-manage-waitlist.js`
- `js/modules/event/event-manage-lifecycle.js`
- `js/modules/event/event-create-waitlist.js`
- `js/modules/event/event-create.js`
- `js/modules/registration-audit.js`
- `js/modules/event/event-manage-noshow.js`（含統計系統相鄰函式）
- `js/modules/event/event-manage-confirm.js`（含鎖定函式 `_confirmAllAttendance`，僅改 fallback 段）
- `js/modules/event/event-manage-instant-save.js`
- `js/modules/data-sync.js`
- `pages/admin-system.html`
- `functions/index.js`（含 `rebuildOccupancy` 與兩處 update）

### 測試更新（4 個檔案）
- `tests/unit/pure-functions.test.js`
- `tests/unit/registration-transaction.test.js`
- `tests/unit/waitlist-capacity.test.js`
- `tests/unit/batch-registration.test.js`

### 版號更新（4 處）
- `js/config.js` CACHE_VERSION
- `sw.js` CACHE_NAME
- `index.html` `var V`
- `index.html` 68 處 `?v=`

---

## 附錄 B：鎖定函式修改說明

本計劃涉及 3 個 CLAUDE.md 鎖定函式，修改範圍嚴格限制：

| 鎖定函式 | 允許的變更 | 禁止的變更 |
|---|---|---|
| `_rebuildOccupancy` | 回傳物件新增 `participantsWithUid`/`waitlistWithUid` 欄位 | 去重邏輯、排序、計數（`current`/`waitlist`）、status 判斷 |
| `_confirmAllAttendance` | 只改 L115-126 的 fallback 段（優先讀新欄位）| 出席寫入邏輯、EXP 發放、reconciliation |
| `registerForEvent` / `cancelRegistration` 等 transaction | 擴充 `update()` 呼叫中的 `participantsWithUid` 欄位 | transaction 讀寫順序、佔位計算、狀態轉換 |

所有修改前後執行 `docs/registration-integrity-check.js` 驗證一致性。
