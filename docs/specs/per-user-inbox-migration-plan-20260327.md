# Per-User Inbox 遷移計畫書

> 文件建立日期：2026-03-27
> 最後更新：2026-03-27（三方專家審核後修訂 v2）
> 狀態：已通過三方審核（Firebase 架構師 + 安全工程師 + 前端工程師）

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

## 三方審核修正摘要（v2 新增）

經 Firebase 架構師、安全工程師、前端工程師三方審核，以下為 v1 計畫的重大修正：

| # | 問題 | 修正 |
|---|------|------|
| 1 | Rules `auth.uid == uid` 會擋跨用戶寫入 | 改為 `isAuth()` + `fromUid == auth.uid` 驗證（參考既有 `gameInbox` 模式） |
| 2 | 跨 inbox 審核狀態同步無權限 | 新增 `deliverToInbox` Callable CF，所有 fan-out 寫入與跨 inbox 更新透過 CF 執行 |
| 3 | 切讀取(原Phase2)在遷移歷史(原Phase4)之前 → 用戶丟失歷史訊息 | 重排順序：遷移歷史提前到 Phase 2 |
| 4 | CF 端 `writeInboxNotification` 延到 Phase 3 才改 → Phase 2 切讀取後 CF 通知消失 | CF 雙寫納入 Phase 1 |
| 5 | 前端做 400 人廣播 fan-out 不可靠 | 所有 fan-out 寫入走 `deliverToInbox` CF |
| 6 | Demo 模式、recallMsg、updateMessage 路徑未處理 | 各自在對應 Phase 補上 |
| 7 | 審核訊息(actionType)不應硬刪除 | Rules 禁止刪除 pending 的 action 訊息 |
| 8 | 缺 Firestore composite index | 列出所有必要 index |

---

## Phase 1：雙寫模式 + Callable CF

### 目標
新訊息同時寫入舊路徑（`messages/{msgId}`）和新路徑（`users/{uid}/inbox/{msgId}`），讀取仍從舊路徑。所有 inbox 寫入透過 Cloud Function 執行（解決跨用戶權限問題）。

### 核心架構決策：為何所有 inbox 寫入走 CF

三位審核專家一致指出：前端直接寫 `users/{B}/inbox/` 會被 Firestore Rules 擋住（sender UID ≠ recipient UID）。解法有二：
- **方案 A**：放寬 Rules 為 `isAuth()`（任何登入者可寫任何人 inbox）→ 安全風險高
- **方案 B（採用）**：建立 `deliverToInbox` Callable CF，前端只呼叫 CF，CF 用 Admin SDK 寫入 → Rules 可嚴格鎖定

### 改動範圍

| 檔案 | 改動 |
|------|------|
| `functions/index.js` | 新增 `deliverToInbox` Callable CF：接收訊息 payload + 收件人規格，fan-out 寫入所有收件人 inbox |
| `functions/index.js` | 修改 `writeInboxNotification`：同時寫 `messages/` 和 `users/{uid}/inbox/`（CF 雙寫） |
| `js/modules/message/message-notify.js` | `_deliverMessageToInbox()` 新增：寫完 `messages/` 後，呼叫 `deliverToInbox` CF |
| `js/firebase-crud.js` | 新增 `callDeliverToInbox(payload)` 方法（Callable CF wrapper） |
| `firestore.rules` | 新增 `users/{uid}/inbox/{msgId}` 規則（見下方） |

### Firestore Rules 設計（審核後修正）

```
match /users/{userId}/inbox/{msgId} {
  // 只有 Admin SDK (CF) 可以建立 inbox 文件
  allow create: if false;

  // 只有 inbox 擁有者可以讀取
  allow read: if isOwner(userId);

  // 擁有者可更新 read 狀態；admin 可更新任何欄位
  allow update: if (isOwner(userId) && onlyUpdatingReadStatus())
    || isAdmin();

  // 擁有者可刪除（但禁止刪除 pending 審核訊息）
  allow delete: if (isOwner(userId) && !isPendingActionMessage())
    || isAdmin();
}
```

> `create: false` — 所有 inbox 文件只能透過 Admin SDK (CF) 寫入，前端無法直接寫入其他用戶 inbox。這是最安全的設計。

### 跨 inbox 審核同步機制（審核後新增）

團隊加入/賽事審核需要同步更新多位幹部 inbox 裡的 `actionStatus`：
- 前端核准後 → 呼叫 `syncGroupActionStatus` Callable CF
- CF 查詢 collection group `inbox` where `meta.groupId == X` and `actionStatus == 'pending'`
- CF 用 Admin SDK 批次更新所有匹配文件的 `actionStatus`
- 前端只負責更新自己 inbox 裡的那一份（Rules 允許 owner update）

### 雙寫流程

```
前端 _deliverMessageToInbox()
  ├── 【既有】寫入 messages/{msgId}（不變）
  └── 【新增】呼叫 deliverToInbox CF
       CF 內部：
       ├── targetUid → 寫 1 筆到 users/{uid}/inbox/
       ├── targetTeamId → 查詢俱樂部成員 → 寫 N 筆
       ├── targetRoles → 查詢角色用戶 → 寫 N 筆
       └── targetType:'all' → 查詢全部用戶 → 寫 N 筆（batch 450/組）
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

### Message ID 策略（審核後明確）

inbox 文件的 Firestore document ID 直接使用訊息的 `id` 欄位值（如 `msg_1711512000000_0.456`），確保所有 `messages.find(m => m.id === id)` 查詢在遷移後不需修改。

### 必要 Firestore Indexes（審核後新增）

```
# firebase.json 或 Firestore Console
users/{uid}/inbox — composite index: createdAt DESC（列表排序）
users/{uid}/inbox — composite index: read ASC, createdAt DESC（未讀優先）
collection group: inbox — composite index: meta.groupId ASC（審核同步）
collection group: inbox — composite index: createdAt DESC（管理員查詢）
```

### 驗證方式
- 發送一則點對點訊息 → 確認 `messages/` 和 `users/{uid}/inbox/` 都有資料
- 發送一則俱樂部廣播 → 確認所有成員的 inbox 都有副本
- 讀取仍從 `messages/` → 確認 UI 不受影響
- 執行 `npm test` → 確認測試全通過

### 風險
- **LOW**：只新增寫入，不改讀取路徑，現有功能完全不受影響
- CF 冷啟動可能增加 200-500ms 延遲（可接受）

---

## Phase 2：遷移歷史資料（原 Phase 4，審核後提前）

> **為何提前**：三位審核專家一致指出，必須先遷移歷史資料，再切換讀取路徑，否則用戶看不到歷史訊息。

### 目標
將 `messages/` 現有資料分配到各用戶的 inbox。

### 執行方式
使用 **Admin SDK Node.js 腳本**（非瀏覽器端），含 dry-run 模式和進度記錄。

### 遷移腳本邏輯

```
for each message in messages/:
  1. 判斷收件人（targetUid / targetTeamId / targetRoles / targetType）
  2. 展開為用戶列表
  3. 對每個用戶：
     a. 檢查 hiddenBy → 包含該用戶則跳過（等同已刪除）
     b. 檢查 readBy → 設定 read: true / readAt
     c. 寫入 users/{uid}/inbox/{msgId}（幂等：已存在則跳過）
  4. batch commit（每 450 筆一組）
```

### 驗證方式
- 遷移前後用戶 inbox 訊息數量一致
- 已讀/未讀狀態正確保留
- 已隱藏的訊息不出現在 inbox
- 審核類訊息的 actionStatus 正確

### 風險
- **MEDIUM**：幂等設計可重複執行，中途失敗可重跑

---

## Phase 3：切換讀取路徑（原 Phase 2，審核後延後）

### 目標
Listener 改從 `users/{uid}/inbox/` 讀取。舊 `messages/` 寫入保留作為 fallback。

### 改動範圍

| 檔案 | 改動 |
|------|------|
| `js/firebase-service.js` | 將 7+ 條 messages listener 替換為 1 條 `users/{uid}/inbox` listener |
| `js/modules/message/message-inbox.js` | 移除 `_filterMyMessages()`（不再需要客戶端過濾） |
| `js/modules/message/message-render.js` | 資料來源改為直讀 inbox cache |
| `js/modules/message/message-actions.js` | `markAllRead()` → 更新 `users/{uid}/inbox/{msgId}` 的 `read` 欄位 |
| `js/modules/message/message-actions.js` | `clearAllMessages()` → 直接 delete inbox 文件（審核訊息除外） |
| `js/modules/message/message-actions-team.js` | 審核核准後 → 呼叫 `syncGroupActionStatus` CF 同步其他幹部 inbox |
| `js/modules/message/message-admin-list.js` | `recallMsg()` → 呼叫 CF 從所有收件人 inbox 刪除（審核後補上） |
| `js/api-service.js` | `getMessages()` → 返回 inbox cache；`updateMessage()` → 更新 inbox 路徑 |
| `js/config.js` | DemoData 新增 `userInbox` 結構（審核後補上 Demo 模式相容） |

### 關鍵決策

**未讀追蹤**：
- 舊：`readBy: [uid1, uid2, ...]` 陣列
- 新：`read: false` / `readAt: Timestamp`（每份 inbox 副本獨立）

**清除訊息**：
- 舊：`hiddenBy: arrayUnion(myUid)`（文件永久存在）
- 新：直接 delete inbox 文件（真刪除，節省空間）
- **例外**：`actionType` 存在且 `actionStatus == 'pending'` 的審核訊息禁止刪除（Rules 層防護）

**審核類訊息的 groupId 同步**（審核後修正）：
- 前端核准/拒絕後 → 更新自己 inbox 裡的 `actionStatus`（Rules 允許 owner update）
- 然後呼叫 `syncGroupActionStatus` CF → CF 用 Admin SDK 更新其他幹部 inbox

**localStorage 快取切換**（審核後補上）：
- 新增 CACHE_VERSION（觸發自動清除舊快取）
- 明確移除 `shub_c_{uid}_messages` 舊 key
- 新 cache key 使用 `inbox` 取代 `messages`

### 驗證方式
- 收件匣正常顯示（含歷史訊息）
- 標記全部已讀 → 只更新自己的 inbox
- 清除全部 → inbox 文件真刪除
- 團隊加入審核 → 3 個幹部的 inbox 狀態同步
- listener 從 7+ 降到 1（DevTools 確認）
- Demo 模式正常運作

### 風險
- **MEDIUM**：改動核心讀取路徑，需全面手動測試
- 最大風險：localStorage shape mismatch（用版本號觸發清除解決）

---

## Phase 4：停止舊寫入（原 Phase 3）

### 目標
移除 `messages/` 集合的寫入，只透過 CF 寫 `users/{uid}/inbox/`。

### 改動範圍

| 檔案 | 改動 |
|------|------|
| `js/modules/message/message-notify.js` | `_deliverMessageToInbox()` 移除 `messages/` 寫入（只保留 CF 呼叫） |
| `js/firebase-crud.js` | 移除 `addMessage()` 的 `messages/` 寫入 |
| `js/modules/message/message-admin.js` | 排程訊息處理改為只呼叫 CF |

### 驗證方式
- `messages/` 集合不再有新文件寫入
- 所有通知正常出現在 inbox
- LINE 推播不受影響

### 風險
- **LOW**：Phase 1 已建立 CF 寫入路徑，此 Phase 只是移除舊路徑

---

## Phase 5：清理

### 目標
移除所有舊架構的程式碼和資料。

### 改動範圍

| 項目 | 動作 |
|------|------|
| `js/modules/message/message-inbox.js` | 移除 `_filterMyMessages()`、`_isMessageUnread()` 舊版 |
| `js/firebase-service.js` | 移除 7+ 條 messages listener、`_messageListenerResults` |
| `js/firebase-crud.js` | 移除舊 `addMessage()` / `clearAllMessages()` / `markAllMessagesRead()` |
| `firestore.rules` | 簡化 `messages` 規則（只保留 admin 讀），移除舊 recipient 判斷邏輯 |
| `messages/` 集合 | 可選擇保留（歷史記錄）或清除 |
| inbox 文件中的 `ref` 欄位 | 移除（不再需要指回 `messages/`） |
| `docs/architecture.md` | 更新訊息系統架構說明 |
| `docs/claude-memory.md` | 記錄遷移完成 |

### 訊息保留策略（審核後新增）
- inbox 訊息設 90 天 TTL（Cloud Function 定期清理過期文件）
- 每用戶 inbox 上限 200 則（最舊的自動清除）
- 審核類訊息（actionType 有值）保留 180 天

### 驗證方式
- 全站功能正常
- `npm test` 全通過
- Firestore read/write 用量顯著下降

### 風險
- **LOW**：所有功能已切換完畢，清理只是移除死碼

---

## 整體時程估計（審核後修訂）

| Phase | 內容 | 工作量 | 風險 | 前置條件 |
|-------|------|--------|------|----------|
| Phase 0 | 補齊測試 | ✅ 已完成 | - | - |
| Phase 1 | 雙寫 + Callable CF | 6-8 小時 | LOW | Phase 0 |
| Phase 2 | 遷移歷史資料 | 2-3 小時 | MEDIUM | Phase 1 穩定 |
| Phase 3 | 切換讀取路徑 | 8-12 小時 | MEDIUM | Phase 2 完成 |
| Phase 4 | 停止舊寫入 | 2-3 小時 | LOW | Phase 3 穩定 1-2 天 |
| Phase 5 | 清理 + TTL | 3-4 小時 | LOW | Phase 4 完成 |

---

## 回滾策略

| Phase | 回滾方式 | 難度 |
|-------|----------|------|
| Phase 1 | 移除 CF 呼叫，`git revert` | 簡單 |
| Phase 2 | 歷史資料已寫入 inbox，無需回滾 | N/A |
| Phase 3 | 切回舊 listener，`git revert` | 簡單 |
| Phase 4 | 恢復 `messages/` 寫入，`git revert` | 簡單 |
| Phase 5 | 從 git 恢復已刪除程式碼 | 中等 |

**關鍵**：每個 Phase 都是獨立 commit，可以單獨 revert。資料層（Phase 2 遷移）不可逆但也不需逆（inbox 資料只增不減）。
