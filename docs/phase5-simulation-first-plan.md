# Phase 5 計畫書：鎖定函式模擬先行重構

## 狀態：待實作
- **建立日期**：2026-04-06
- **前置完成**：Phase 1-4 已部署（commit ebace32）
- **授權需求**：H6-H7 在 CLAUDE.md 鎖定範圍內，需用戶明確授權

---

## 1. 起因

### 問題
H4、H6、H7 三個函式在 `batch.commit()` **之前**就修改了 live cache。如果 commit 失敗（Firestore 故障、網路中斷），用戶看到假成功——快取和 Firestore 不一致，且 H6/H7 的 catch block 不 return，導致汙染的快取被 `_saveToLS` 持久化到 localStorage。

### 違反的規則
CLAUDE.md Rule #10：
> **禁止在 batch.commit() 前修改本地快取**：`cancelRegistration` 和 `cancelCompanionRegistrations` 必須使用「模擬模式」——在副本上計算結果，commit 成功後才寫入本地快取。

Rule #10 的文字只點名了 `cancelRegistration` 和 `cancelCompanionRegistrations`，但精神同樣適用於 H4/H6/H7。`cancelRegistration` 已正確實作模擬先行，是本次重構的參考範本。

### 受影響函式

| 代號 | 函式 | 位置 | 觸發場景 |
|------|------|------|---------|
| **H4** | `_removeParticipant` fallback | `event-manage-lifecycle.js:327-412` | 管理員從活動移除參加者（CF fallback 路徑） |
| **H6** | `_adjustWaitlistOnCapacityChange` 遞補 | `event-create-waitlist.js:109-157` | 活動容量增加 → 候補自動升正取 |
| **H7** | `_adjustWaitlistOnCapacityChange` 降級 | `event-create-waitlist.js:161-228` | 活動容量減少 → 正取降為候補 |

---

## 2. 參考範本：cancelRegistration 的模擬模式

`firebase-crud.js:887-1041` 是已驗證的 gold standard：

```
Step 1: 查詢 Firestore 取得最新 registrations（不信任快取）
Step 2: shallow clone → simRegs = firestoreRegs.map(r => ({...r}))
Step 3: 在 simRegs 上模擬所有狀態變更
Step 4: 用 simRegs 呼叫 _rebuildOccupancy（純函式，不改 live cache）
Step 5: 用模擬結果建 batch（reg updates + event occupancy）
Step 6: await batch.commit()
Step 7: commit 成功 → 把模擬結果寫入 live cache
Step 8: commit 失敗 → 副本丟棄，live cache 不動
```

### 關鍵設計：
- **clone 方式**：`map(r => ({...r}))` shallow spread（不用 JSON.parse/stringify，避免 Timestamp 序列化問題）
- **`_rebuildOccupancy`**：接收 event（唯讀，只讀 .max/.status）+ simRegs clone array，回傳 occupancy 物件
- **post-commit**：用 `id` 或 `_docId` 比對找到 live cache 中對應的物件再修改

---

## 3. 現有程式碼分析：每個函式的 live cache mutation

### H4: `_removeParticipant` fallback（event-manage-lifecycle.js:327-412）

**commit 前的 5 個 live cache mutation：**

| 行號 | 改什麼 | 改在哪 |
|------|--------|--------|
| 344 | `reg.status = 'removed'` | live registrations cache |
| 345 | `reg.removedAt = new Date().toISOString()` | live registrations cache |
| 358 | `ar.status = 'removed'` | live activityRecords cache |
| 375 | `_promoteSingleCandidateLocal(event, candidate)` | live reg.status + live ar.status + 發通知 + 寫 opLog |
| 391-393 | `_rebuildOccupancy` + `_applyRebuildOccupancy` | live event cache |

**while 迴圈耦合**：`_getNextWaitlistCandidate`（line 373）讀 live cache 找下一個候補者。因為上一次迴圈的 `_promoteSingleCandidateLocal` 已經改了 live cache 的 `status = 'confirmed'`，所以下次不會重複選到同一人。改成 clone 後必須從 clone array 找候補者。

### H6: promote path（event-create-waitlist.js:109-157）

**commit 前的 mutation：**

| 行號 | 改什麼 | 改在哪 |
|------|--------|--------|
| 119 | `_promoteSingleCandidateLocal(event, candidate)` | live reg + live AR + 通知 + opLog |
| 135-137 | `_rebuildOccupancy` + `_applyRebuildOccupancy` | live event |

**同樣的 while 迴圈耦合**：`_getNextWaitlistCandidate`（line 117）讀 live cache。

### H7: demote path（event-create-waitlist.js:161-228）

**commit 前的 mutation：**

| 行號 | 改什麼 | 改在哪 |
|------|--------|--------|
| 177 | `reg.status = 'waitlisted'` | live reg |
| 184-185 | `ar.status = 'waitlisted'` | live AR |
| 192-194 | `_sendNotifFromTemplate(...)` | 發通知（副作用） |
| 200-203 | `_rebuildOccupancy` + `_applyRebuildOccupancy` | live event |

---

## 4. 阻塞問題與解法

### 阻塞 1：`_promoteSingleCandidateLocal` 不相容模擬模式

**原因**：這個函式同時做 4 件事：
1. `reg.status = 'confirmed'`（必須在 clone 上做）
2. `ar.status = 'registered'`（必須在 clone 上做）
3. `_sendNotifFromTemplate`（必須延遲到 commit 後）
4. `ApiService._writeOpLog`（必須延遲到 commit 後）

**解法**：不呼叫 `_promoteSingleCandidateLocal`。在模擬迴圈內只做 status 改變（在 clone 上），通知和 opLog 收集到陣列中，commit 成功後再逐一發送。

```
// 模擬階段
simCandidate.status = 'confirmed';
promotedList.push({ userId, userName, companionName, participantType, _docId });

// commit 後
for (const p of promotedList) {
  _sendNotifFromTemplate(...);
  _writeOpLog(...);
}
```

`_promoteSingleCandidateLocal` 函式本身不修改不刪除——其他呼叫者（如 `_forcePromoteWaitlistItem`）仍使用它。

### 阻塞 2：`_getNextWaitlistCandidate` 讀 live cache

**原因**：它呼叫 `ApiService.getRegistrationsByEvent(eventId)` 讀 live cache。

**解法**：在模擬迴圈中直接從 clone array 找候補者，不呼叫 `_getNextWaitlistCandidate`。

```
// 模擬階段
const nextCandidate = simRegs
  .filter(r => r.status === 'waitlisted')
  .sort((a, b) => { /* registeredAt ASC, promotionOrder ASC — Rule #7 */ })[0];
```

排序邏輯必須與 `_getNextWaitlistCandidate` 完全一致（Rule #7）。

### 阻塞 3：`_getPromotedArDocIds` 搜尋已變更的狀態

**原因**：它搜 `a.status === 'registered'`，但這個狀態是 `_promoteSingleCandidateLocal` 改的。在模擬模式下 live AR 還是 `'waitlisted'`。

**解法**：不呼叫 `_getPromotedArDocIds`。在模擬階段直接從 live AR cache 搜尋 `status === 'waitlisted'`（原始狀態）並記錄 docId。

```
// 模擬階段（commit 前，AR 還是 waitlisted）
const ar = arSource.find(a => a.eventId === event.id && a.uid === sim.userId && a.status === 'waitlisted');
if (ar && ar._docId) arUpdates.push({ docId: ar._docId, uid: sim.userId });
```

---

## 5. 修改計畫

### 不動的檔案（零風險）

| 檔案 | 原因 |
|------|------|
| `firebase-crud.js` | `cancelRegistration` 已是模擬模式，不需要改 |
| `api-service.js` | Phase 1-4 已完成，不再動 |
| `functions/index.js` | CF 用 Admin SDK transaction，不受前端重構影響 |

### 修改的檔案

| 檔案 | 修改範圍 | 動什麼 |
|------|---------|--------|
| `event-create-waitlist.js` | 遞補路徑 lines 109-157、降級路徑 lines 161-228 | 改為 clone → simulate → commit → apply 模式 |
| `event-manage-lifecycle.js` | `_removeParticipant` fallback lines 327-412 | 同上 |

### 不動的函式（保持原樣）

| 函式 | 原因 |
|------|------|
| `_promoteSingleCandidateLocal` | 其他呼叫者（`_forcePromoteWaitlistItem`）仍使用它。不刪除、不修改 |
| `_getNextWaitlistCandidate` | 其他呼叫者可能使用。不修改 |
| `_getPromotedArDocIds` | 同上。不修改 |
| `_rebuildOccupancy` | 純函式，已正確。不修改 |

### 新增的檔案

**無新增檔案。** 所有改動在現有兩個檔案內完成。

---

## 6. 每個函式的 Before/After 虛擬碼

### H6: 遞補路徑（event-create-waitlist.js:109-157）

**BEFORE（現狀）：**
```
allRegs = live cache registrations for this event
while slotsAvailable > 0:
  candidate = _getNextWaitlistCandidate(eventId)  // 讀 live cache
  _promoteSingleCandidateLocal(event, candidate)   // 改 live cache + 發通知
  batch.update(candidate, confirmed)
  arDocIds = _getPromotedArDocIds(event, candidate) // 搜 live cache（已改後的）
  batch.update(AR, registered)
occupancy = _rebuildOccupancy(event, live_active_regs)
_applyRebuildOccupancy(event, occupancy)           // 改 live event cache
batch.update(event, occupancy)
await batch.commit()                                // 可能失敗 → live cache 已壞
_saveToLS()
```

**AFTER（模擬先行）：**
```
allRegs = live cache registrations for this event
simRegs = allRegs.map(r => ({...r}))               // shallow clone
arSource = live activityRecords cache
promotedSim = []
arUpdates = []

// 模擬階段（只動 clone）
while slotsAvailable > 0:
  candidate = simRegs.filter(waitlisted).sort(Rule #7)[0]  // 從 clone 找
  candidate.status = 'confirmed'                             // 改 clone
  promotedSim.push(candidate)
  ar = arSource.find(waitlisted for this user)               // 從 live cache 找（還是 waitlisted）
  if ar: arUpdates.push({ docId: ar._docId, uid })

simActive = simRegs.filter(confirmed or waitlisted)
occupancy = _rebuildOccupancy(event, simActive)              // 純函式，用 clone

// 建 batch
batch.update(each promoted reg, confirmed)
batch.update(each AR, registered)
batch.update(event, occupancy fields)

// commit
try:
  await batch.commit()
catch:
  showToast('遞補失敗')
  return                                                      // live cache 不動

// commit 成功 → 寫入 live cache
for sim in promotedSim:
  live = allRegs.find(r => r._docId === sim._docId)
  live.status = 'confirmed'
for au in arUpdates:
  liveAr = arSource.find(a => a._docId === au.docId)
  liveAr.status = 'registered'
_applyRebuildOccupancy(event, occupancy)

// commit 成功 → 發通知 + 寫 opLog（不會假發）
for sim in promotedSim:
  _sendNotifFromTemplate('waitlist_promoted', ...)
  _writeOpLog('auto_promote', ...)

_saveToLS()
```

### H7: 降級路徑（event-create-waitlist.js:161-228）

**AFTER（模擬先行）：**
```
simRegs = allRegs.map(r => ({...r}))
arSource = live activityRecords cache
demotedSim = []
arDemoteUpdates = []

// 模擬階段
sortedForDemote = simRegs.filter(confirmed).sort(Rule #8)    // registeredAt DESC
for i in 0..excess:
  sim = sortedForDemote[i]
  sim.status = 'waitlisted'                                    // 改 clone
  demotedSim.push(sim)
  ar = arSource.find(registered for this user)
  if ar: arDemoteUpdates.push({ docId, uid })

simActive = simRegs.filter(confirmed or waitlisted)
occupancy = _rebuildOccupancy(event, simActive)

// 建 batch + commit
try await batch.commit()
catch: showToast + return（live cache 不動）

// commit 成功 → live cache + 通知
apply to live regs, ARs, event
_sendNotifFromTemplate('waitlist_demoted', ...)
_writeOpLog('capacity_demote', ...)
_saveToLS()
```

### H4: _removeParticipant fallback（event-manage-lifecycle.js:327-412）

**AFTER（模擬先行）：**
```
simRegs = cacheRegs for this event .map(r => ({...r}))
simTarget = simRegs.find(target)
simTarget.status = 'removed'

// 模擬遞補
arSource = live activityRecords cache
promotedSim = [], arUpdates = [], arRemoveUpdate = null

// 找要移除的 AR
arRemove = arSource.find(registered for removed user)
if arRemove: arRemoveUpdate = arRemove._docId

// 遞補迴圈（在 clone 上）
while slotsAvailable > 0:
  candidate = simRegs.filter(waitlisted).sort(Rule #7)[0]
  candidate.status = 'confirmed'
  promotedSim.push(candidate)
  ar = arSource.find(waitlisted for this user)
  if ar: arUpdates.push({ docId, uid })

simActive = simRegs.filter(confirmed or waitlisted)
occupancy = _rebuildOccupancy(event, simActive)

// 建 batch + commit
batch: reg → removed, AR → removed, promoted regs → confirmed, promoted ARs → registered, event → occupancy
try await batch.commit()
catch: showToast + return（live cache 不動）

// commit 成功 → live cache
apply all to live regs, ARs, event
// 發通知 + opLog
_saveToLS()
```

---

## 7. Clone 策略

**使用 shallow spread**（與 gold standard 一致）：
```js
const simRegs = allRegs.map(r => ({ ...r }));
```

- 只改 `status` scalar 屬性，不需要 deep copy
- 避免 `JSON.parse(JSON.stringify())` 破壞 Firestore Timestamp 物件
- H6/H7 已有 Firestore refresh step（lines 74-102）將 `registeredAt` 轉為 ISO 字串，所以 clone 內不會有 Timestamp 物件

H4 不同：它讀 live cache（可能有 Timestamp 物件）。但 `_rebuildOccupancy._regSortTime` 已處理所有 format。

---

## 8. 排序邏輯不可變更（CLAUDE.md 規則）

### 遞補排序（Rule #7）
```js
.sort((a, b) => {
  const ta = new Date(a.registeredAt).getTime();
  const tb = new Date(b.registeredAt).getTime();
  if (ta !== tb) return ta - tb;                    // registeredAt ASC
  return (a.promotionOrder || 0) - (b.promotionOrder || 0);  // promotionOrder ASC
})
```

### 降級排序（Rule #8）
```js
.sort((a, b) => {
  const ta = new Date(a.registeredAt).getTime();
  const tb = new Date(b.registeredAt).getTime();
  if (ta !== tb) return tb - ta;                    // registeredAt DESC
  return (b.promotionOrder || 0) - (a.promotionOrder || 0);  // promotionOrder DESC
})
```

這些排序邏輯在重構中**原封不動複製**，不做任何修改。

---

## 9. 測試矩陣

### 單元測試（新增到 tests/unit/registration-transaction.test.js）

| 場景 | 驗證 |
|------|------|
| 遞補 1 人（容量 +1） | clone 上 status 改 confirmed，live cache 不動直到 commit |
| 遞補 3 人（容量 +3） | 依 registeredAt ASC 排序遞補 |
| 降級 1 人（容量 -1） | 最晚報名的被降級（registeredAt DESC） |
| 降級 3 人（容量 -3） | 依序降級 |
| 遞補含同行者 | companion 不更新 activityRecord |
| commit 失敗時 live cache 不動 | 模擬核心驗證 |

### 手動測試

| 場景 | 操作 | 預期結果 |
|------|------|---------|
| 正常遞補 | 編輯活動增加名額 | 候補者收到通知、名單更新 |
| 正常降級 | 編輯活動減少名額 | 正取者收到降級通知 |
| 移除參加者 | 管理員移除正取 | 候補者遞補、名單更新 |
| 網路斷線時操作 | 斷網 → 操作 | 同步指示器顯示失敗、名單不變 |
| 重新整理後一致性 | 操作後刷新頁面 | Firestore 資料與顯示一致 |

---

## 10. 風險評估

| 評估項目 | 內容 |
|----------|------|
| **做了會怎樣** | commit 失敗時 live cache 保持乾淨、不發假通知、不汙染 localStorage。完全符合 Rule #10 |
| **不做會怎樣** | 維持現狀——commit 失敗時假成功。但 commit 失敗在正常網路下極少發生 |
| **最壞情況** | 重構邏輯寫錯 → 遞補/降級功能異常（候補系統是最核心的業務邏輯之一） |
| **回退難度** | git revert 一個 commit 即可回到 Phase 4 狀態 |
| **影響範圍** | 2 個檔案、3 個函式路徑 |
| **所需注意力** | 高——涉及鎖定函式、排序規則、迴圈耦合、AR 狀態搜尋邏輯 |

---

## 11. 實作順序

1. **先寫測試**——在 `registration-transaction.test.js` 加入遞補/降級的模擬先行測試案例
2. **H7（降級）**——最簡單，沒有迴圈耦合，直接 for loop clone
3. **H6（遞補）**——有迴圈耦合（while loop 從 clone 找候補者）
4. **H4（移除參加者）**——最複雜，結合移除 + 遞補
5. **更新 CLAUDE.md Rule #10**——將 H4/H6/H7 加入模擬模式強制範圍
6. **全量測試**——npm test + 手動測試矩陣
