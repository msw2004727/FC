# Per-User Inbox 遷移計畫書

> 文件建立日期：2026-03-27
> 狀態：待核准

---

## 背景

目前站內信使用「共用池塘」架構（`messages/{msgId}`），所有用戶共享同一個集合，透過 `targetUid/targetTeamId/targetRoles` 欄位 + 7+ 條 onSnapshot listener + 客戶端過濾來實現「我的收件匣」。

400 人規模下已觀察到：
- 每人 7+ 條 listener 造成大量 Firestore 讀取
- 廣播通知觸發全體 listener 同時更新
- `readBy`/`hiddenBy` 陣列隨用戶數膨脹

本計畫將站內信遷移至 `users/{uid}/inbox/{msgId}` per-user 子集合架構。

---

## Phase 0：補齊測試安全網 ✅ 已完成

- 檔案：`tests/unit/message-system.test.js`
- 測試數：139 個
- 覆蓋：訊息過濾、未讀追蹤、團隊審核(first-action-wins)、成員正規化、分塊、排程、儲存計算、訊息結構契約
- 兩角色 AI 驗收通過

---

## Phase 1：雙寫模式

### 目標
新訊息同時寫入舊路徑（`messages/{msgId}`）和新路徑（`users/{uid}/inbox/{msgId}`），讀取仍從舊路徑。

### 改動範圍

| 檔案 | 改動 |
|------|------|
| `js/modules/message/message-notify.js` | `_deliverMessageToInbox()` 新增雙寫邏輯：寫完 `messages/` 後，額外寫入 `users/{targetUid}/inbox/` |
| `js/firebase-crud.js` | 新增 `addUserInboxMessage(uid, data)` 方法 |
| `firestore.rules` | 新增 `users/{uid}/inbox/{msgId}` 規則（create: auth.uid == uid 或 admin; read: auth.uid == uid） |

### 雙寫邏輯

```
_deliverMessageToInbox(title, body, category, categoryName, targetUid, senderName, extra)
  ├── 【既有】寫入 messages/{msgId} （不變）
  └── 【新增】展開收件人 → 寫入 users/{uid}/inbox/{msgId}
       ├── targetUid → 寫 1 筆
       ├── targetTeamId → 查詢俱樂部成員 → 寫 N 筆
       ├── targetRoles → 查詢角色用戶 → 寫 N 筆
       └── targetType:'all' → 查詢全部用戶 → 寫 N 筆（batch，每 450 筆一組）
```

### inbox 文件結構

```javascript
users/{uid}/inbox/{msgId} = {
  // 核心欄位（從 messages 複製）
  title, body, type, typeName, preview, time,
  senderName, fromUid,

  // Per-user 狀態（取代 readBy/hiddenBy 陣列）
  read: false,
  readAt: null,

  // 審核類欄位（原樣保留）
  actionType, actionStatus, reviewerName, meta,

  // 參照
  ref: 'messages/{原始ID}',   // 指回原始文件（Phase 3 後移除）

  // 時間戳
  createdAt: serverTimestamp(),
}
```

### 驗證方式
- 發送一則點對點訊息 → 確認 `messages/` 和 `users/{uid}/inbox/` 都有資料
- 發送一則俱樂部廣播 → 確認所有成員的 inbox 都有副本
- 讀取仍從 `messages/` → 確認 UI 不受影響
- 執行 `npm test` → 確認 1209 個測試全通過

### 風險
- **LOW**：只新增寫入，不改讀取路徑，現有功能完全不受影響
- **注意**：全體廣播在 Phase 1 會觸發大量寫入（400 人 = 400 次），需觀察 Firestore 配額

---

## Phase 2：切換讀取路徑

### 目標
Listener 改從 `users/{uid}/inbox/` 讀取，保留舊 `messages/` 寫入作為 fallback。

### 改動範圍

| 檔案 | 改動 |
|------|------|
| `js/firebase-service.js` | 將 7+ 條 messages listener 替換為 1 條 `users/{uid}/inbox` listener |
| `js/modules/message/message-inbox.js` | 移除 `_filterMyMessages()`（不再需要客戶端過濾） |
| `js/modules/message/message-render.js` | 資料來源從 `ApiService.getMessages()` 改為直讀 inbox cache |
| `js/modules/message/message-actions.js` | `markAllRead()` 改為更新 `users/{uid}/inbox/{msgId}` 的 `read` 欄位 |
| `js/modules/message/message-actions.js` | `clearAllMessages()` 改為直接 delete `users/{uid}/inbox/{msgId}` |
| `js/api-service.js` | `getMessages()` 改為返回 inbox cache |

### 關鍵決策

**未讀追蹤**：
- 舊：`readBy: [uid1, uid2, ...]` 陣列（每人已讀都塞進同一陣列）
- 新：`read: false` / `readAt: Timestamp`（每份 inbox 副本獨立）

**清除訊息**：
- 舊：`hiddenBy: arrayUnion(myUid)`（文件不刪，只加 hiddenBy）
- 新：`db.doc('users/{uid}/inbox/{msgId}').delete()`（真刪除）

**審核類訊息的 groupId 同步**：
- 團隊加入請求發給 3 個幹部 → 3 份 inbox 副本
- 第一個人核准後 → 需找到其他 2 人 inbox 裡的副本更新 `actionStatus`
- 解法：保留 `meta.groupId`，核准時查詢所有幹部的 inbox 中 `meta.groupId == X` 的文件並更新

### 驗證方式
- 切換到英文模式 → 收件匣正常顯示
- 標記全部已讀 → 只更新自己的 inbox
- 清除全部 → inbox 文件真刪除
- 團隊加入審核 → 3 個幹部的 inbox 狀態同步
- listener 數量從 7+ 降到 1 → 用 DevTools 確認

### 風險
- **MEDIUM**：改動核心讀取路徑，需全面手動測試
- **最大風險**：審核類訊息的 groupId 跨 inbox 同步

---

## Phase 3：停止舊寫入

### 目標
移除 `messages/` 集合的寫入，只寫 `users/{uid}/inbox/`。

### 改動範圍

| 檔案 | 改動 |
|------|------|
| `js/modules/message/message-notify.js` | `_deliverMessageToInbox()` 移除 `messages/` 寫入 |
| `js/firebase-crud.js` | `addMessage()` 改為只寫 inbox |
| `js/modules/message/message-admin.js` | 排程訊息處理改為寫 inbox |
| `functions/index.js` | `writeInboxNotification` Cloud Function 改路徑 |

### 關鍵：Cloud Function 同步
`functions/index.js` 中的 `writeInboxNotification`（line 4261）直接用 Admin SDK 寫 `messages/`。必須同步改為寫 `users/{uid}/inbox/`，否則 server 端發的通知（如 Firestore trigger 觸發的歡迎訊息）不會進入用戶 inbox。

### 驗證方式
- `messages/` 集合不再有新文件寫入
- 所有通知（報名、取消、審核、排程、CF 觸發）都正確出現在 inbox
- LINE 推播不受影響（走獨立的 `linePushQueue`）

### 風險
- **MEDIUM**：CF 路徑修改需要重新部署 Cloud Functions
- 需確認 `processLinePushQueue` 不依賴 `messages/` 集合

---

## Phase 4：遷移歷史資料

### 目標
將 `messages/` 現有資料分配到各用戶的 inbox。

### 遷移腳本邏輯

```
for each message in messages/:
  1. 判斷收件人（targetUid / targetTeamId / targetRoles / targetType）
  2. 展開為用戶列表
  3. 對每個用戶：
     a. 檢查 hiddenBy → 如果包含該用戶，跳過（等同已刪除）
     b. 檢查 readBy → 設定 read: true / readAt
     c. 寫入 users/{uid}/inbox/{msgId}
  4. batch commit（每 450 筆一組）
```

### 預估寫入量
- 假設 1,000 則訊息，平均每則 5 個收件人 → 5,000 次寫入
- 廣播訊息（targetType: 'all'）× 400 人 → 需特別處理
- 建議分批執行，每批 10,000 次寫入，間隔 5 秒

### 驗證方式
- 遷移前後用戶 inbox 訊息數量一致
- 已讀/未讀狀態正確保留
- 已隱藏的訊息不出現在 inbox
- 審核類訊息的 actionStatus 正確

### 風險
- **MEDIUM**：遷移腳本如果中途失敗，部分用戶的歷史訊息可能缺失
- 解法：幂等設計（已存在的 inbox 文件跳過），可重複執行

---

## Phase 5：清理

### 目標
移除所有舊架構的程式碼和資料。

### 改動範圍

| 項目 | 動作 |
|------|------|
| `js/modules/message/message-inbox.js` | 移除 `_filterMyMessages()`、`_isMessageUnread()` 舊版 |
| `js/firebase-service.js` | 移除 7+ 條 messages listener 邏輯、移除 `_messageListenerResults` |
| `js/firebase-crud.js` | 移除舊 `addMessage()` / `clearAllMessages()` / `markAllMessagesRead()` |
| `firestore.rules` | 簡化 `messages` 規則（只保留 admin 讀寫），強化 `users/{uid}/inbox` 規則 |
| `messages/` 集合 | 確認無人讀取後，可選擇保留（歷史記錄）或清除 |
| `DemoData.messages` | 改為 `DemoData.userInbox` 結構 |
| `docs/architecture.md` | 更新訊息系統架構說明 |
| `docs/claude-memory.md` | 記錄遷移完成 |

### 驗證方式
- 全站功能正常
- `npm test` 全通過
- Firestore console 確認 `messages/` 不再被查詢
- 監控 Firestore read/write 用量下降

### 風險
- **LOW**：此時所有功能已切換完畢，清理只是移除死碼

---

## 整體時程估計

| Phase | 工作量 | 風險 | 前置條件 |
|-------|--------|------|----------|
| Phase 0 | ✅ 已完成 | - | - |
| Phase 1 | 4-6 小時 | LOW | Phase 0 |
| Phase 2 | 8-12 小時 | MEDIUM | Phase 1 驗證通過 |
| Phase 3 | 3-4 小時 | MEDIUM | Phase 2 穩定運行 1-2 天 |
| Phase 4 | 2-3 小時 | MEDIUM | Phase 3 完成 |
| Phase 5 | 2-3 小時 | LOW | Phase 4 完成 + 全站驗證 |

**建議**：Phase 1 和 Phase 2 之間至少觀察 1-2 天，確認雙寫無異常再切換讀取。

---

## 回滾策略

| Phase | 回滾方式 | 難度 |
|-------|----------|------|
| Phase 1 | 移除雙寫邏輯，`git revert` | 簡單 |
| Phase 2 | 切回舊 listener，`git revert` | 簡單 |
| Phase 3 | 恢復 `messages/` 寫入，`git revert` | 簡單 |
| Phase 4 | 歷史資料已寫入 inbox，無需回滾 | N/A |
| Phase 5 | 需手動恢復已刪除的程式碼 | 中等（但可從 git 恢復） |

**關鍵**：Phase 1-3 的每個 phase 都是獨立 commit，可以單獨 revert。
