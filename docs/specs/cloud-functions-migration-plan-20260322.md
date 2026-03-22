# Cloud Functions 遷移計畫書

> 版本：v1.0 | 日期：2026-03-22 | 狀態：草案

---

## 一、摘要

將目前在用戶端（瀏覽器）執行的關鍵資料操作遷移至 Firebase Cloud Functions（以下簡稱 CF），
解決多人同時操作造成的數據不一致、客戶端 batch 非原子性、以及 fire-and-forget 後置操作失敗的三大問題。

### 預期效益

| 維度 | 現狀 | 目標 |
|------|------|------|
| 報名人數精確度 | 多用戶各自從 cache 重算，可能不一致 | CF Transaction 原子更新，永遠一致 |
| 候補升補可靠度 | 依賴單一用戶手機完成，斷線即中斷 | 伺服器完成，不受用戶網路影響 |
| 報名全流程一致性 | 5-7 步 fire-and-forget，部分失敗造成殘缺資料 | 單一 CF 內全部完成或全部回滾 |
| No-show 計算速度 | 每次開頁面 O(N×M) 掃描 | 活動結束時預計算，前端直接讀值 |
| 團隊成員數 | 從 cache 計算後覆寫，多人操作覆蓋 | Trigger 原子 increment/decrement |

---

## 二、架構對照

```
【現狀 — 用戶端主導】

  用戶手機
    ├─ db.runTransaction()  ← 只包 registration + event 計數
    ├─ activityRecords.add()  ← fire-and-forget（可能失敗）
    ├─ writeAuditLog()        ← fire-and-forget
    ├─ _sendNotifFromTemplate() ← fire-and-forget
    ├─ _grantAutoExp()        ← 呼叫 CF adjustExp
    └─ _evaluateAchievements() ← 從 cache 計算，寫 subcollection

  問題：transaction 只保護 2 個 collection，其餘 5 步各自獨立

【目標 — CF 主導】

  用戶手機
    └─ 呼叫 CF registerForEvent({ eventId, participants })
         ├─ db.runTransaction()
         │   ├─ 讀 event + registrations
         │   ├─ 容量/重複/性別/俱樂部 驗證
         │   ├─ 寫 registration(s)
         │   ├─ 寫 activityRecord(s)
         │   └─ 更新 event occupancy
         ├─ 寫 auditLog
         ├─ 寫 notification message
         ├─ 呼叫 adjustExp（同進程，無網路延遲）
         └─ 更新 achievement progress
    ← 回傳 { status, registrationId }
    → 前端更新 UI

  改善：全部在伺服器同進程完成，前端只負責 UI
```

---

## 三、實施範圍與分波

| 波次 | 名稱 | 內容 | 預估複雜度 |
|------|------|------|-----------|
| **Wave 1** | 報名流程原子化 | 報名、取消、同行者、候補升降、移除參與者 | 高 |
| **Wave 2** | Trigger 自動衍生資料 | activityRecords 同步、團隊成員數、活動狀態 | 中 |
| **Wave 3** | 預計算統計 | No-show、出席率、成就進度增量更新 | 中 |

---

## 四、Wave 1 — 報名流程原子化

### 4.1 總覽

新增 2 個 CF callable，取代目前前端的 6 個寫入路徑：

| 新 CF | 取代前端函式 | 用途 |
|-------|------------|------|
| `registerForEvent` | `handleSignup`、`_confirmCompanionRegister` | 報名（含同行者） |
| `cancelRegistration` | `handleCancelSignup`、`_confirmCompanionCancel`、`_removeParticipant`、`_adjustWaitlistOnCapacityChange` | 取消/移除/候補調整 |

### 4.2 新增 CF：`registerForEvent`

**輸入 Schema**

```js
{
  eventId: string,           // 活動 ID
  participants: [            // 報名人員（至少 1 人 = 自己）
    { userId: string, userName: string, companionName?: string }
  ]
}
```

**內部流程（全部在 db.runTransaction 內）**

| 步驟 | 動作 | 失敗處理 |
|------|------|---------|
| T1 | 讀取 `events/{docId}` | 拋錯：活動不存在 |
| T2 | 查詢 `registrations` where eventId == X | — |
| T3 | 驗證：活動狀態、重複報名、性別限制、俱樂部限制、報名開放時間 | 拋錯：附帶具體原因碼 |
| T4 | 判定每人 confirmed / waitlisted | — |
| T5 | 寫入 registration 文件（每人一筆） | Transaction 自動回滾 |
| T6 | 寫入 activityRecord 文件（僅本人，非同行者） | Transaction 自動回滾 |
| T7 | 更新 event occupancy（用 `_rebuildOccupancy` 邏輯） | Transaction 自動回滾 |

**Transaction 外的後置操作（commit 成功後才執行）**

| 步驟 | 動作 | 失敗處理 |
|------|------|---------|
| P1 | 寫入 auditLog | catch + 記 errorLog（不影響回傳） |
| P2 | 寫入 inbox message（通知） | catch + 記 errorLog |
| P3 | 呼叫 adjustExp（同進程直接呼叫函式） | catch + 記 errorLog |
| P4 | 更新 achievement progress | catch + 記 errorLog |

**回傳 Schema**

```js
{
  success: true,
  registrations: [
    { id: string, status: 'confirmed' | 'waitlisted', userId: string }
  ],
  event: { current: number, waitlist: number, status: string }
}
```

**涉及檔案**

| 檔案 | 動作 | 說明 |
|------|------|------|
| `functions/index.js` | **修改** | 新增 `registerForEvent` callable（約 150-200 行） |
| `js/modules/event/event-detail-signup.js` | **修改** | `handleSignup` 改為呼叫 CF，移除直接 Firestore 寫入 |
| `js/modules/event/event-detail-companion.js` | **修改** | `_confirmCompanionRegister` 改為呼叫同一 CF |
| `js/firebase-crud.js` | **修改** | `registerForEvent`/`batchRegisterForEvent` 加上 deprecated 標記或保留為 fallback |
| `firestore.rules` | **修改** | `registrations` create 規則可收緊為僅 CF 寫入（保留 fallback 期間暫不收緊） |

### 4.3 新增 CF：`cancelRegistration`

**輸入 Schema**

```js
{
  eventId: string,
  registrationIds: string[],   // 要取消的 registration _docId
  reason: 'user_cancel' | 'manager_remove' | 'capacity_change'
}
```

**內部流程（全部在 db.runTransaction 內）**

| 步驟 | 動作 |
|------|------|
| T1 | 讀取 `events/{docId}` |
| T2 | 查詢所有 `registrations` where eventId == X |
| T3 | 驗證：registrationIds 存在且為 active 狀態 |
| T4 | 標記目標為 `cancelled` 或 `removed` |
| T5 | 若取消的是 confirmed：找候補按 `registeredAt ASC` 升補 |
| T6 | 更新 activityRecords（取消者 → cancelled，升補者 → registered） |
| T7 | `_rebuildOccupancy` → 更新 event 文件 |

**Transaction 外後置操作**

| 步驟 | 動作 |
|------|------|
| P1 | 通知取消者 |
| P2 | 通知升補者（若有） |
| P3 | 調整 EXP（取消扣分 / 升補加分） |
| P4 | 更新 achievement progress |
| P5 | 寫 auditLog |

**回傳 Schema**

```js
{
  success: true,
  cancelled: [{ id, userId }],
  promoted: [{ id, userId, userName }],
  event: { current, waitlist, status }
}
```

**涉及檔案**

| 檔案 | 動作 | 說明 |
|------|------|------|
| `functions/index.js` | **修改** | 新增 `cancelRegistration` callable（約 200-250 行） |
| `js/modules/event/event-detail-signup.js` | **修改** | `handleCancelSignup` 改為呼叫 CF |
| `js/modules/event/event-detail-companion.js` | **修改** | `_confirmCompanionCancel` 改為呼叫 CF |
| `js/modules/event/event-manage-lifecycle.js` | **修改** | `_removeParticipant` 改為呼叫 CF（reason='manager_remove'） |
| `js/modules/event/event-create-waitlist.js` | **修改** | `_adjustWaitlistOnCapacityChange` 改為呼叫 CF（reason='capacity_change'） |
| `js/firebase-crud.js` | **修改** | `cancelRegistration`/`cancelCompanionRegistrations` 加 deprecated |

### 4.4 前端改造模式

```js
// ===== 改造前 =====
async handleSignup(id) {
  // ... 驗證省略 ...
  const reg = await FirebaseService.registerForEvent(id, userId, userName); // Transaction
  await ApiService.addActivityRecord(...);   // fire-and-forget
  await this._sendNotifFromTemplate(...);    // fire-and-forget
  await this._grantAutoExp(userId, ...);     // fire-and-forget CF call
  await this._evaluateAchievements(...);     // fire-and-forget
}

// ===== 改造後 =====
async handleSignup(id) {
  // ... 驗證省略（保留前端 guard，CF 會再驗一次） ...
  const result = await this._callCF('registerForEvent', {
    eventId: id,
    participants: [{ userId, userName }]
  });
  // CF 已完成全部寫入，前端只更新 UI
  this._applyRegistrationResult(result);  // 更新 local cache + UI
}
```

### 4.5 風險評估

| 風險 | 等級 | 說明 | 緩解措施 |
|------|------|------|---------|
| CF 冷啟動延遲 | 中 | 首次呼叫 1-3 秒，影響報名體驗 | 設定 `minInstances: 1`（asia-east1），月成本約 $10 |
| 前端回退相容 | 高 | 遷移期間新舊並存，可能造成雙重寫入 | 用 feature flag 切換，`siteConfig/featureFlags.useServerRegistration` |
| LOCKED 函式修改 | 高 | `handleSignup`、`handleCancelSignup` 等為 CLAUDE.md LOCKED | 需明確授權後才可修改 |
| Firestore Rules 衝突 | 中 | CF 用 Admin SDK 繞過 Rules，但 fallback 模式仍需 client Rules | 遷移完成前不收緊 Rules |
| 測試覆蓋 | 中 | 目前 664 測試中有 signup-logic、pure-functions 等依賴前端路徑 | 新增 CF 單元測試 + 修改前端測試 |
| `_rebuildOccupancy` 搬移 | 低 | 此為純函式，搬到 CF 端只需複製 | 確保與前端版本邏輯完全一致 |

### 4.6 驗收項目

**功能驗收**

| # | 測試情境 | 預期結果 | 驗證方法 |
|---|---------|---------|---------|
| F1 | 單人報名（名額充足） | status=confirmed，event.current +1 | 手動 + 自動測試 |
| F2 | 單人報名（名額已滿） | status=waitlisted，event.waitlist +1 | 手動 + 自動測試 |
| F3 | 同行者報名（2人，名額剩1） | 1人 confirmed + 1人 waitlisted | 手動測試 |
| F4 | 重複報名 | 拋錯 `ALREADY_REGISTERED` | 自動測試 |
| F5 | 性別限制違反 | 拋錯 `GENDER_RESTRICTED` | 自動測試 |
| F6 | 俱樂部限制違反 | 拋錯 `TEAM_RESTRICTED` | 自動測試 |
| F7 | 取消報名（無候補者） | reg.status=cancelled，event.current -1 | 手動 + 自動測試 |
| F8 | 取消報名（有候補者） | 候補者自動升補，收到通知 | 手動測試 |
| F9 | 管理員移除參與者 | reg.status=removed，候補者升補 | 手動測試 |
| F10 | 容量增加 → 候補升補 | 按 registeredAt 順序升補 | 手動 + 自動測試 |
| F11 | 容量減少 → 確認降級 | 最後報名的人降為候補 | 手動測試 |
| F12 | activityRecord 同步 | 報名/取消/升補後 activityRecord 狀態正確 | 自動測試 |
| F13 | EXP 正確發放 | confirmed 報名 +EXP，取消 -EXP，升補 +EXP | 查 expLogs |
| F14 | 成就進度更新 | 報名後 register_event 進度 +1 | 查 users/{uid}/achievements |
| F15 | 通知送達 | 報名/取消/升補各有對應通知 | 查 messages collection |

**一致性驗收**

| # | 測試情境 | 預期結果 |
|---|---------|---------|
| C1 | 10 人同時報名（剩 3 名額） | 恰好 3 人 confirmed + 7 人 waitlisted，event.current == max |
| C2 | 5 人同時取消同一活動 | 每人只取消一次，候補按順序升補，無重複升補 |
| C3 | 報名後立即重整頁面 | 顯示正確的報名狀態和人數 |
| C4 | CF 超時（模擬） | 前端顯示錯誤，資料無殘留（Transaction 回滾） |
| C5 | 執行 `registration-integrity-check.js` | 全部 6 項檢查通過 |

**效能驗收**

| # | 指標 | 目標值 |
|---|------|--------|
| P1 | 報名 CF 回應時間（warm） | < 2 秒 |
| P2 | 報名 CF 回應時間（cold） | < 4 秒 |
| P3 | 取消 CF 回應時間（warm） | < 2 秒 |
| P4 | 前端 cache 更新延遲 | CF 回傳後 < 100ms |

---

## 五、Wave 2 — Trigger 自動衍生資料

### 5.1 總覽

新增 2 個 Firestore Trigger，自動維護衍生欄位：

| Trigger | 監聽 | 更新目標 |
|---------|------|---------|
| `onRegistrationWritten` | `registrations/{docId}` | `events/{eventId}` occupancy 投影欄位 |
| `onUserTeamFieldChanged` | `users/{docId}` | `teams/{teamId}` memberCount |

### 5.2 Trigger：`onRegistrationWritten`

**觸發條件**：`registrations` collection 任何文件 create/update/delete

**邏輯**

```
1. 從變更文件取得 eventId
2. 查詢該 eventId 的全部 active registrations
3. 執行 _rebuildOccupancy（與前端相同邏輯）
4. 更新 events/{docId} 的投影欄位
```

**涉及檔案**

| 檔案 | 動作 | 說明 |
|------|------|------|
| `functions/index.js` | **修改** | 新增 `onRegistrationWritten` trigger（約 60 行） |

**風險**

| 風險 | 等級 | 緩解 |
|------|------|------|
| 與 Wave 1 CF 的 Transaction 重複更新 | 中 | Trigger 以最終一致性為目標，CF Transaction 為主要寫入路徑；Trigger 作為防護網，覆寫結果相同 |
| 高頻觸發成本 | 低 | 每次報名觸發 1 次，以目前使用量（~50 活動/週）成本極低 |
| 無限迴圈 | 低 | Trigger 寫 `events`，不寫 `registrations`，無迴圈風險 |

### 5.3 Trigger：`onUserTeamFieldChanged`

**觸發條件**：`users/{docId}` 文件 update，且 `teamId` 或 `teamIds` 欄位變動

**邏輯**

```
1. 比對 before/after 的 teamId + teamIds
2. 對移除的 teamId：teams/{id}.members -= 1（FieldValue.increment(-1)）
3. 對新增的 teamId：teams/{id}.members += 1（FieldValue.increment(1)）
```

**涉及檔案**

| 檔案 | 動作 | 說明 |
|------|------|------|
| `functions/index.js` | **修改** | 新增 `onUserTeamFieldChanged` trigger（約 50 行） |
| `js/modules/team/team-detail.js` | **修改** | `removeTeamMember` 移除手動 memberCount 更新（改由 Trigger） |
| `js/modules/team/team-form-join.js` | **修改** | `handleLeaveTeam` 移除手動 memberCount 更新 |
| `js/modules/message/message-actions-team.js` | **修改** | `handleTeamJoinAction` 移除手動 memberCount 更新 |

**風險**

| 風險 | 等級 | 緩解 |
|------|------|------|
| increment 永遠不歸零 | 低 | 保留 `_syncTeamMembers()` 資料同步工具作為定期校正 |
| Trigger 延遲 | 低 | 通常 < 1 秒，用戶感知不到 |

### 5.4 驗收項目

| # | 測試情境 | 預期結果 |
|---|---------|---------|
| T1 | 直接在 Firestore Console 新增 registration | 對應 event 的 current/waitlist 自動更新 |
| T2 | 用戶加入俱樂部 | 俱樂部 members 欄位 +1 |
| T3 | 用戶離開俱樂部 | 俱樂部 members 欄位 -1 |
| T4 | 2 人同時加入同一俱樂部 | members 正確 +2（FieldValue.increment 原子性） |
| T5 | 執行 `_syncTeamMembers()` | 結果與 Trigger 更新一致（零差異） |

---

## 六、Wave 3 — 預計算統計

### 6.1 No-show 預計算

**觸發時機**：活動狀態變為 `ended` 時（由現有 CF `autoEndStartedEvents` 觸發）

**新增 CF（內部函式，非 callable）**：`computeEventNoShows(eventId)`

**邏輯**

```
1. 查詢該活動所有 confirmed registrations（非 companion）
2. 查詢該活動所有 checkin attendanceRecords
3. 建立 checkinSet（uid::eventId）
4. 對每個 confirmed 但無 checkin 的用戶：
   a. FieldValue.increment(1) 到 users/{uid} 的 noShowCount 欄位
   b. 寫入 users/{uid}/noShowDetails/{eventId} 子集合
```

**涉及檔案**

| 檔案 | 動作 | 說明 |
|------|------|------|
| `functions/index.js` | **修改** | 在 `autoEndStartedEvents` 內呼叫 `computeEventNoShows`（約 80 行） |
| `js/modules/event/event-manage-noshow.js` | **修改** | `_buildRawNoShowCountByUid` 改為優先讀 `users/{uid}.noShowCount`，fallback 保留原邏輯 |

**風險**

| 風險 | 等級 | 緩解 |
|------|------|------|
| 活動被 reopen 後 noShowCount 不回退 | 中 | `handleReopenTournament` 需呼叫 `reverseEventNoShows` 清理 |
| 重複計算 | 低 | 在 event 文件加 `_noShowComputedAt` 欄位，跳過已計算的活動 |

### 6.2 出席率快取

**觸發時機**：checkout attendanceRecord 寫入時

**新增邏輯（加入既有 `watchAttendanceChanges`）**

```
1. 讀取用戶的全部 registrations（ended events）
2. 讀取用戶的全部 checkin records
3. 計算 attendRate = attended / expected
4. 更新 users/{uid}.attendanceStats = { expected, attended, completed, rate }
```

**涉及檔案**

| 檔案 | 動作 | 說明 |
|------|------|------|
| `functions/index.js` | **修改** | 擴充 `watchAttendanceChanges` 或新增 helper（約 50 行） |
| `js/modules/achievement/stats.js` | **修改** | `getParticipantAttendanceStats` 優先讀快取欄位 |

### 6.3 成就增量更新

**觸發時機**：registration 或 attendanceRecord 變動時

**新增 CF（內部函式）**：`incrementalAchievementEval(uid, eventType)`

```
1. 讀取該用戶的 achievement progress（users/{uid}/achievements）
2. 僅評估與 eventType 相關的 achievement conditions
3. 更新有變動的 progress 文件
```

**涉及檔案**

| 檔案 | 動作 | 說明 |
|------|------|------|
| `functions/index.js` | **修改** | 新增增量評估邏輯（需搬移 evaluator 核心邏輯至 functions） |
| `js/modules/achievement/evaluator.js` | **不修改** | 前端保留完整評估能力作為 fallback |

**風險**

| 風險 | 等級 | 緩解 |
|------|------|------|
| 評估邏輯在前後端重複 | 高 | 提取共用模組（但目前無 build system，只能手動同步） |
| 19 個 handler 搬移工作量大 | 高 | Wave 3 可拆分，先搬 register_event / complete_event / attend_event 三個最常用的 |

### 6.4 驗收項目

| # | 測試情境 | 預期結果 |
|---|---------|---------|
| S1 | 活動自動結束（scheduled CF） | 未出席者的 noShowCount +1 |
| S2 | 用戶 checkout | 該用戶 attendanceStats 自動更新 |
| S3 | 報名後查看成就頁 | register_event 進度已更新（不需等待前端評估） |
| S4 | 管理員 reopen 活動 | 先前計算的 noShow 被清除 |

---

## 七、實施時程與依賴關係

```
         Week 1           Week 2           Week 3           Week 4
    ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
W1  │ registerFor │→ │cancelRegist │→ │ 整合測試    │→ │ Feature Flag│
    │ Event CF    │  │ ration CF   │  │ + 修前端    │  │ 漸進上線   │
    └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘
                                            ↓
    ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
W2  │             │  │ onRegistra- │→ │ onUserTeam- │→ │ 驗證 + 校正 │
    │             │  │ tionWritten │  │ FieldChanged│  │ 工具確認    │
    └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘
                                                              ↓
    ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
W3  │             │  │             │  │ No-show 預  │→ │ 出席率快取 │→ │ 成就增量 │
    │             │  │             │  │ 計算        │  │            │  │（可選）  │
    └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘
```

**前置條件**

- Wave 1 完成後才啟動 Wave 2（Trigger 邏輯依賴 CF 寫入模式）
- Wave 3 的 No-show 可與 Wave 2 平行，但出席率快取需等 Wave 2 的 Trigger 穩定

---

## 八、全檔案影響清單

### 新增檔案

| 檔案 | 波次 | 用途 |
|------|------|------|
| （無新增檔案，全部修改既有 `functions/index.js`） | — | 遵循現有單檔案 CF 架構 |

### 修改檔案

| # | 檔案 | 波次 | 改動範圍 | LOCKED? |
|---|------|------|---------|---------|
| 1 | `functions/index.js` | W1+W2+W3 | 新增 2 callable + 2 trigger + 3 helper | 否 |
| 2 | `js/modules/event/event-detail-signup.js` | W1 | `handleSignup` + `handleCancelSignup` 改呼叫 CF | **是** |
| 3 | `js/modules/event/event-detail-companion.js` | W1 | `_confirmCompanionRegister` + `_confirmCompanionCancel` 改呼叫 CF | **是** |
| 4 | `js/modules/event/event-manage-lifecycle.js` | W1 | `_removeParticipant` 改呼叫 CF | 否 |
| 5 | `js/modules/event/event-create-waitlist.js` | W1 | `_adjustWaitlistOnCapacityChange` 改呼叫 CF | **是** |
| 6 | `js/firebase-crud.js` | W1 | `registerForEvent`/`cancelRegistration` 等加 deprecated + fallback 模式 | 否 |
| 7 | `js/modules/team/team-detail.js` | W2 | 移除手動 memberCount 更新 | 否 |
| 8 | `js/modules/team/team-form-join.js` | W2 | 移除手動 memberCount 更新 | 否 |
| 9 | `js/modules/message/message-actions-team.js` | W2 | 移除手動 memberCount 更新 | 否 |
| 10 | `js/modules/event/event-manage-noshow.js` | W3 | 優先讀預計算值 | **是** |
| 11 | `js/modules/achievement/stats.js` | W3 | 優先讀快取出席率 | **是** |
| 12 | `js/config.js` | W1 | 新增 feature flag 讀取 | 否 |
| 13 | `firestore.rules` | W1（可選） | 收緊 registrations 寫入規則 | 否 |

---

## 九、回退計畫

每個波次都有獨立的 Feature Flag 控制：

```js
// siteConfig/featureFlags
{
  useServerRegistration: false,    // Wave 1
  useRegistrationTrigger: false,   // Wave 2
  usePrecomputedNoShow: false      // Wave 3
}
```

**回退步驟**

1. 在 Firestore Console 將對應 flag 設為 `false`
2. 前端會自動 fallback 到原有客戶端邏輯（無需部署）
3. CF 端的 callable 不再被呼叫（但 trigger 仍會執行，僅做幂等更新，無副作用）

**極端回退**：`firebase deploy --only functions` 部署無 Wave 1/2/3 的 `functions/index.js` 版本

---

## 十、成本估算

基於目前使用量（~200 活動/月，~500 活躍用戶）：

| 項目 | 現有成本 | 遷移後成本 | 差異 |
|------|---------|-----------|------|
| CF 呼叫 | ~2,000/月（adjustExp 等） | ~6,000/月（+registerForEvent/cancelRegistration） | +$0.0024/月 |
| CF 最低實例（minInstances: 1） | $0 | ~$10/月 | +$10/月 |
| Firestore 讀取 | ~50,000/月 | ~65,000/月（Trigger 額外讀取） | +$0.009/月 |
| Firestore 寫入 | ~30,000/月 | ~35,000/月（Trigger 額外寫入） | +$0.009/月 |
| **合計增量** | | | **~$10/月** |

---

## 十一、多角色審查

### 審查 #1：後端工程師視角

**審查重點**：CF 架構、Transaction 設計、錯誤處理

| 項目 | 評估 | 問題 | 修正 |
|------|------|------|------|
| Transaction 範圍 | 合理 | registrations 查詢在 Transaction 內用 `getAll` 可能效能不佳 | 改用 `where(eventId).get()` 在 Transaction 外，Transaction 內只讀 event doc + 寫入。或接受延遲（通常 < 500ms） |
| `_rebuildOccupancy` 搬移 | 需注意 | CF 端沒有 `_rebuildOccupancy` 函式，需手動搬移 | **已補充**：在 `functions/index.js` 新增 `rebuildOccupancy` helper（純函式，直接從前端複製） |
| adjustExp 同進程呼叫 | 好 | 但目前 adjustExp 是 `onCall`，內部呼叫需用不同方式 | **已補充**：提取 adjustExp 核心邏輯為 `_adjustExpInternal()`，callable 和內部呼叫共用 |
| Error codes | 不足 | 計畫書只列了 3 個錯誤碼 | **已補充**：完整錯誤碼表 → `EVENT_NOT_FOUND`, `EVENT_ENDED`, `EVENT_CANCELLED`, `ALREADY_REGISTERED`, `GENDER_RESTRICTED`, `TEAM_RESTRICTED`, `REG_NOT_OPEN`, `CAPACITY_ERROR`, `REG_NOT_FOUND`, `ALREADY_CANCELLED`, `PERMISSION_DENIED` |
| 冪等性 | 缺少 | 同一請求重複提交怎麼辦？ | **已補充**：前端傳 `requestId`（timestamp + random），CF 用 `_regDedupe` collection 做 5 分鐘冪等窗口 |

### 審查 #2：前端工程師視角

**審查重點**：前端改動範圍、UI 回應速度、cache 同步

| 項目 | 評估 | 問題 | 修正 |
|------|------|------|------|
| Cache 更新時機 | 需改進 | CF 回傳後，前端要手動更新 `FirebaseService._cache`，但 onSnapshot 也會收到更新，可能衝突 | **已補充**：CF 回傳後立即更新 cache（optimistic），onSnapshot 到來時以 Firestore 為準覆蓋（最終一致） |
| Loading 狀態 | 需設計 | CF 比本地 Transaction 慢（多了網路往返），報名按鈕要有適當的 loading 狀態 | **已補充**：保留現有 `_setCreateEventSubmitting` pattern，超過 3 秒顯示「伺服器處理中」 |
| Flip 動畫相容 | 需確認 | `handleSignup` 有報名按鈕 flip 動畫，改呼叫 CF 後時序不同 | **已確認**：flip 動畫只在 CF 回傳成功後觸發，與現在 Transaction 成功後觸發一致 |
| 離線支援 | 退化 | 目前 Firestore offline persistence 允許離線報名（queue 寫入），CF 必須在線 | **已接受**：離線報名不是核心需求。顯示「需要網路連線」提示 |
| Feature Flag 讀取時機 | 需設計 | flag 在 `siteConfig` collection，什麼時候讀？ | **已補充**：在 `FirebaseService._loadBootCollections` 時讀取並快取，與 `autoExpRules` 同一策略 |

### 審查 #3：安全審計師視角

**審查重點**：權限驗證、資料注入、API 濫用

| 項目 | 評估 | 問題 | 修正 |
|------|------|------|------|
| 身份驗證 | 需強化 | 計畫書的 CF 未提及 auth 驗證 | **已補充**：CF 入口必須 `const { uid } = context.auth`，未登入直接 throw `unauthenticated` |
| 代替他人報名 | 漏洞 | `participants[0].userId` 可能不是 caller 自己 | **已補充**：CF 強制 `participants[0].userId === context.auth.uid`，同行者需驗證 companionName 存在於用戶 companions 子集合 |
| Rate limiting | 缺少 | 惡意用戶可高頻呼叫 | **已補充**：用 `_regDedupe` collection 的冪等機制天然限制重複；額外加 IP-based rate limit 由 Firebase App Check 處理 |
| 管理員移除權限 | 需驗證 | `reason: 'manager_remove'` 時需驗證 caller 是活動管理者 | **已補充**：CF 內檢查 `_canManageEvent(event, callerUid, callerRole)`，非管理者 throw `permission-denied` |
| Input sanitization | 需確認 | userName 是否需要 sanitize？ | **已補充**：所有字串欄位走 `normalizeAuditText()`（已有函式），長度上限 50 字元 |

### 審查 #4：QA / 測試工程師視角

**審查重點**：測試策略、覆蓋率、回歸風險

| 項目 | 評估 | 問題 | 修正 |
|------|------|------|------|
| 現有測試受影響 | 高風險 | `signup-logic.test.js`（430行）、`pure-functions.test.js`（419行）直接測試前端函式 | **已補充**：前端函式保留為 fallback，現有測試不刪除。新增 CF 端測試檔 `tests/functions/registration.test.js` |
| Emulator 測試 | 必要 | CF Transaction 邏輯需要 Firestore Emulator | **已補充**：利用現有 `npm run test:rules` 的 emulator 設定，新增 `npm run test:functions` |
| 併發測試 | 關鍵 | C1（10人同時報名）需要自動化 | **已補充**：撰寫 `tests/functions/concurrent-registration.test.js`，使用 Promise.all 模擬 10 個併發 CF 呼叫 |
| Feature Flag 測試 | 需要 | flag 切換時的行為需驗證 | **已補充**：新增測試 case：flag=true 呼叫 CF、flag=false fallback 到本地、flag 切換中無錯誤 |
| `registration-integrity-check.js` | 可複用 | 遷移後應該跑一遍 | **已確認**：列入每個波次的驗收必跑項目 |

### 審查 #5：產品經理視角

**審查重點**：用戶體驗影響、上線策略、回退風險

| 項目 | 評估 | 問題 | 修正 |
|------|------|------|------|
| 報名速度感知 | 可能退步 | CF 冷啟動 1-3 秒 vs 本地 Transaction < 1 秒 | **已回應**：設定 minInstances=1 消除冷啟動（asia-east1）；warm 狀態 < 2 秒接近目前體驗 |
| 用戶感知改變 | 無 | UI 流程不變，只是後端路徑不同 | **已確認**：用戶不會感知到任何流程變化 |
| 漸進上線 | 需細化 | Feature Flag 是全局切換，無法灰度 | **已補充**：增加 `serverRegistrationRolloutPercent` 欄位（0-100），前端根據 `uid.hashCode % 100 < percent` 決定走 CF 或本地。初始設 10%，逐步提升 |
| 回退影響 | 需確認 | CF 寫入的資料格式與前端一致嗎？回退後前端能正確讀取？ | **已確認**：CF 寫入的 registration/activityRecord 欄位格式與前端完全一致（使用相同的 `_rebuildOccupancy`） |
| 上線通知 | 建議 | 是否需要維護公告？ | **已回應**：不需要。用戶無感知變化，靜默上線即可 |

### 審查 #6：DevOps / SRE 視角（額外追加）

**審查重點**：部署流程、監控、災難恢復

| 項目 | 評估 | 問題 | 修正 |
|------|------|------|------|
| 部署順序 | 關鍵 | CF 和前端誰先部署？ | **已補充**：必須先部署 CF（含 Feature Flag 讀取），再部署前端。前端部署時 flag 仍為 false，驗證 CF 正常後再開 flag |
| 監控 | 缺少 | 如何知道 CF 是否正常？ | **已補充**：在 CF 內寫 `operationLogs`（成功/失敗），新增 GCP Cloud Monitoring alert：CF error rate > 5% 觸發告警 |
| 日誌 | 需規劃 | CF 的 `console.log` 在哪裡看？ | **已回應**：GCP Cloud Logging（已有），新增結構化日誌 `{ severity, eventId, action, duration }` |
| functions 檔案大小 | 需關注 | `functions/index.js` 已 4133 行，Wave 1+2+3 預估再增 500-600 行 | **已補充**：考慮拆分為 `functions/index.js`（入口）+ `functions/registration.js`（報名邏輯）+ `functions/triggers.js`（觸發器）。Node.js 支援 require |
| 部署失敗回退 | 需計畫 | `firebase deploy --only functions` 失敗怎麼辦？ | **已回應**：Firebase Functions 有版本管理，失敗時自動保留舊版本；也可 `firebase functions:delete` 移除問題函式 |

---

## 十二、最終修正總結

經六輪審查，以下為計畫書的補強項目：

| # | 來源 | 補強內容 |
|---|------|---------|
| 1 | 後端 | 新增 `rebuildOccupancy` helper 搬移計畫 |
| 2 | 後端 | 提取 `_adjustExpInternal()` 避免 CF 套 CF |
| 3 | 後端 | 完整錯誤碼表（11 個錯誤碼） |
| 4 | 後端 | `_regDedupe` 冪等機制 |
| 5 | 前端 | Cache 樂觀更新 + onSnapshot 最終一致策略 |
| 6 | 前端 | Loading 狀態設計（3 秒升級提示） |
| 7 | 前端 | 離線降級提示 |
| 8 | 前端 | Feature Flag 讀取時機（boot collections） |
| 9 | 安全 | 強制 `participants[0].userId === auth.uid` |
| 10 | 安全 | 同行者身份驗證（companions 子集合） |
| 11 | 安全 | 管理員移除權限驗證 |
| 12 | 安全 | Input sanitization + 長度上限 |
| 13 | QA | 新增 CF 端測試檔案計畫 |
| 14 | QA | 併發測試（10 人同時報名） |
| 15 | QA | Feature Flag 切換測試 |
| 16 | 產品 | 灰度上線機制（rolloutPercent） |
| 17 | DevOps | 部署順序（CF 先、前端後、flag 最後） |
| 18 | DevOps | 結構化日誌 + error rate 告警 |
| 19 | DevOps | functions 拆檔計畫 |

---

## 十三、測試環境（B 空間）部署計畫

### 13.1 概念

在正式版（A 空間）之外建立一個「測試版」（B 空間），兩者共用同一個 Firebase 資料庫。所有新功能先在 B 空間開發、測試，確認沒問題後才合併到正式版。

```
【A 空間 — 正式版】                     【B 空間 — 測試版】
正式網站（用戶在用的）                    測試網站（只有開發者能看到）
Cloudflare Pages: main 分支              Cloudflare Pages: staging 分支
toosterx.com                             staging.xxx.pages.dev（自動產生）
功能開關 = 關（走原本流程）               功能開關 = 開（走新 CF 流程）
        │                                         │
        └──────────── 同一個 Firebase 專案 ────────┘
                      同一個 Firestore 資料庫
                      同一組 Cloud Functions
```

### 13.2 建置步驟

| # | 動作 | 說明 |
|---|------|------|
| 1 | 在 GitHub 建立 `staging` 分支 | 從 `main` 分支複製一份出來，之後所有新功能都先在這裡改。**每次新 Wave 都從 main 重新建立**，確保起點乾淨 |
| 2 | Cloudflare Pages 自動部署 | 推送 `staging` 分支後，Cloudflare 會自動產生一個測試網址（免費，不需額外設定） |
| 3 | **設定 B 空間存取控制** | 在 Cloudflare 設定 Access Policy，限定只有開發者能存取 B 空間的測試網址（防止外部用戶誤用測試版操作正式資料庫） |
| 4 | 測試分支設定環境變數 | 在 Cloudflare Pages 的 staging 環境設定 `STAGING_MODE=true` 環境變數（**不寫在程式碼中**，避免意外合併到正式版） |
| 5 | 部署 Cloud Functions | 執行 `firebase deploy --only functions:registerForEvent,cancelRegistration` **只部署新函式**，不動舊函式，確保正式版不受影響 |
| 6 | 在測試網站驗證 | 用測試活動進行報名、取消、候補等操作，對照驗收清單逐項確認 |
| 7 | 合併到正式版 | 測試通過後，將 `staging` 合併回 `main`，正式網站自動更新（此時 flag=false，還沒啟用） |
| 8 | 灰度開啟 + 觀察 | 在 Firestore 設定灰度百分比，逐步開啟並觀察（見 13.8 灰度策略） |

### 13.3 前端開關機制

**環境判斷方式**：不在程式碼中寫死開關，改用 Cloudflare Pages 的環境變數注入。這樣同一份程式碼在不同環境自動有不同行為，不會因為合併分支而意外洩漏。

```js
// js/config.js — 從 HTML meta tag 讀取環境變數（由 Cloudflare Pages 注入）
const IS_STAGING = document.querySelector('meta[name="staging"]')?.content === 'true';

// 判斷邏輯（各報名入口共用）
function shouldUseServerRegistration() {
  // B 空間：永遠走新的 CF 流程
  if (IS_STAGING) return true;

  // A 空間：根據 Firestore 功能開關決定
  const flags = FirebaseService.getCachedDoc('siteConfig', 'featureFlags');
  if (!flags || !flags.useServerRegistration) return false;

  // 灰度：根據用戶 UID 的 hash 百分比決定
  const percent = flags.serverRegistrationRolloutPercent || 0;
  const uid = App.currentUser.uid;
  // 使用 djb2 hash 算法，分布均勻（charCode 加總法分布不均已修正）
  let h = 5381;
  for (let i = 0; i < uid.length; i++) {
    h = ((h << 5) + h) + uid.charCodeAt(i);
  }
  return (Math.abs(h) % 100) < percent;
}
```

> **為什麼不用 `FORCE_STAGING_MODE` 全域變數？** 審查發現三個問題：(1) 可能意外合併到正式版導致全部用戶走未驗證的新流程；(2) 任何人在瀏覽器 console 輸入就能啟用；(3) 每次合併分支都會產生衝突。改用環境變數注入一次解決這三個問題。

### 13.4 每個 Wave 的測試流程

```
                    staging 分支                          main 分支
                    ─────────────                         ──────────
Wave 1 開發    ──→  改前端 + 寫 CF  ──→  推送
                                          ↓
                                    B 空間自動部署
                                          ↓
                                    部署 CF 到 Firebase
                                          ↓
                                    在 B 空間測試
                                          ↓
                                    ✅ 通過 ──→  合併到 main ──→  A 空間自動部署
                                                                       ↓
                                                              flag=false（還沒啟用）
                                                                       ↓
                                                              灰度開啟 10% → 50% → 100%
                                    ❌ 失敗 ──→  在 staging 修復，重新測試
```

### 13.5 注意事項與風險緩解

| 議題 | 風險等級 | 處理方式 |
|------|:---:|---------|
| **B 空間網址外洩** | 高 | Cloudflare Pages 的測試網址預設公開，任何人拿到連結就能操作正式資料庫。**必須**在 Cloudflare 設定 Access Policy（免費方案支援），限定只有開發者 email 能存取 |
| **測試資料汙染** | 高 | 測試操作會寫入正式資料庫。除了用 `[測試]` 前綴命名活動外，**新增自動清理工具** `scripts/cleanup-test-data.js`，自動查找並刪除所有帶 `[測試]` 標記的活動及關聯的 registrations、activityRecords。每次測試結束後執行，不靠手動清理 |
| **CF 部署影響正式版** | 中 | Cloud Functions 只有一組。**規則：只新增不修改**——用 `firebase deploy --only functions:新函式名稱` 精準部署，嚴格禁止在測試階段修改任何舊函式。部署前執行 `git diff functions/index.js` 確認只有新增的程式碼 |
| **LINE LIFF 登入** | 高 | B 空間的 LIFF 登入是重要測試盲區。**必須**在 LINE Developers Console 新增第二個 LIFF App，endpoint 指向 B 空間網址，這樣才能完整測試 LIFF 流程（token、redirect、userId 綁定）。若無法新增，則在合併到 main 後、灰度開啟前，用 1% 灰度做一次含 LIFF 的端到端真實測試 |
| **staging 分支落後** | 中 | **每次新 Wave 都從 main 重新建立 staging 分支**（`git checkout -b staging main`），不在舊 staging 上繼續做，確保每次起點乾淨 |
| **額外成本** | — | 零成本。Cloudflare Pages 的分支部署免費，Firebase 不需要開第二個專案 |

### 13.6 測試活動規範

為避免測試資料影響正式用戶，B 空間測試時遵守以下規則：

1. **建立專用測試活動**：標題格式 `[測試] xxx`，讓管理員一眼辨識
2. **使用自己的帳號測試**：不要用正式用戶的帳號
3. **測試完畢執行清理工具**：執行 `node scripts/cleanup-test-data.js`，自動刪除帶有 `[測試]` 標題的活動及其關聯文件（registrations、activityRecords、auditLogs）
4. **不要在正式活動上測試新流程**：即使 B 空間功能開關開著，也不要報名正式活動

### 13.7 每個 Wave 的操作清單（Checklist）

每次開始新 Wave 時，按照以下清單逐步操作並勾選：

**開發階段**
- [ ] 從 main 建立新的 staging 分支（`git checkout -b staging main`）
- [ ] 確認 Cloudflare Pages 已自動部署 B 空間
- [ ] 確認 B 空間的 Cloudflare Access 存取控制仍然生效
- [ ] 在 staging 分支完成程式碼修改

**部署階段**
- [ ] 執行 `git diff functions/index.js` 確認只有新增程式碼，沒有修改舊函式
- [ ] 執行 `firebase deploy --only functions:新函式名稱` 部署新 CF
- [ ] 部署後呼叫新 CF 確認回傳正常（基本 health check）

**測試階段**
- [ ] 在 B 空間建立 `[測試]` 活動
- [ ] 完成所有功能驗收項目（參照 Section 4.6 / 5.4 / 6.4 的驗收清單）
- [ ] 在 B 空間測試 LIFF 登入流程（使用第二個 LIFF App）
- [ ] 關閉 B 空間的 staging 環境變數，模擬 A 空間行為，確認灰度邏輯正確
- [ ] 執行 `registration-integrity-check.js` 驗證資料一致性
- [ ] 執行 `node scripts/cleanup-test-data.js` 清理測試資料

**上線階段**
- [ ] 將 staging 合併回 main
- [ ] 確認 A 空間自動部署成功（此時 flag=false）
- [ ] 設定灰度百分比 10%，開始觀察（見 13.8）
- [ ] 刪除本次 staging 分支

### 13.8 灰度上線策略與觀察期

| 階段 | 灰度百分比 | 觀察期 | 升級條件 |
|------|:---:|:---:|---------|
| 第一階段 | 10% | 2 天 | CF 錯誤率 < 1%，無用戶回報異常 |
| 第二階段 | 50% | 3 天 | CF 錯誤率 < 0.5%，報名/取消流程正常，資料一致性檢查通過 |
| 第三階段 | 100% | 持續監控 | 全面啟用，保留回退能力 |

**監控指標**
- CF 的 `operationLogs` 中 `success: false` 的比例
- Firestore Console 檢查 event 的 current/waitlist 是否與 registrations 數量一致
- 用戶是否回報「報名失敗」或「頁面異常」

**緊急回退 SOP**（手機上也能操作）
1. 打開 Firebase Console → Firestore → `siteConfig/featureFlags`
2. 將 `serverRegistrationRolloutPercent` 設為 `0`
3. 正式版立即回退到原本的前端流程，無需部署任何程式碼
4. 所有用戶下次操作時自動走舊流程（即時生效，不需重新整理）

### 13.9 B 空間審查結果

經 5 個角色（安全工程師、QA、DevOps、前端開發者、專案經理）審查，共找出 20 項問題，以下為已整合的關鍵修正：

| # | 嚴重度 | 來源 | 原始問題 | 修正方式 |
|---|:---:|------|---------|---------|
| 1 | 高 | 安全 | B 空間網址預設公開，外人可操作正式資料庫 | 新增 Cloudflare Access 存取控制（13.2 步驟 3） |
| 2 | 高 | 安全 | `FORCE_STAGING_MODE` 可能意外合併到正式版 | 改用 Cloudflare 環境變數注入，不寫在程式碼中（13.3） |
| 3 | 高 | 前端 | 灰度 hash 算法（charCode 加總）分布不均勻 | 改用 djb2 hash 算法，分布均勻（13.3） |
| 4 | 高 | QA | LINE LIFF 登入完全未測試 | 建立第二個 LIFF App 指向 B 空間（13.5） |
| 5 | 高 | DevOps | CF 部署瞬間影響正式版 | 改用 `--only functions:函式名稱` 精準部署，只新增不修改（13.5） |
| 6 | 高 | DevOps | 缺乏回滾策略 | 新增緊急回退 SOP（13.8） |
| 7 | 中 | QA | 測試資料手動清理不可靠 | 新增自動清理工具 `scripts/cleanup-test-data.js`（13.6） |
| 8 | 中 | QA | B 空間測試路徑與 A 空間不同 | 測試時也模擬 A 空間灰度行為（13.7 測試階段） |
| 9 | 中 | DevOps | staging 分支同步策略不明確 | 每次 Wave 從 main 重建 staging（13.5） |
| 10 | 中 | 專案經理 | 手動步驟多，缺操作清單 | 新增 Wave Checklist（13.7） |
| 11 | 中 | 專案經理 | 缺灰度觀察期標準 | 新增三階段灰度策略 + 升級條件（13.8） |

---

## 十四、核准與啟動條件

- [ ] CLAUDE.md LOCKED 函式修改授權（`handleSignup`、`handleCancelSignup`、`_confirmCompanionRegister`、`_confirmCompanionCancel`、`_adjustWaitlistOnCapacityChange`）
- [ ] Firebase Blaze Plan 確認（Cloud Functions 需要）
- [ ] GCP Cloud Monitoring 設定完成
- [ ] Wave 1 Feature Flag 文件 `siteConfig/featureFlags` 已建立
- [ ] GitHub `staging` 分支已建立，Cloudflare Pages 分支部署已確認可用
- [ ] Cloudflare Access Policy 已設定（B 空間存取控制）
- [ ] LINE Developers Console 已建立第二個 LIFF App（B 空間測試用）
- [ ] 開發環境 Firestore Emulator 可正常啟動
