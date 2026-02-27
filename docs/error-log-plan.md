# 前端錯誤訊息日誌 — 實作計劃（方案 A）

## 目標

當用戶看到錯誤 toast（系統異常、寫入失敗、權限錯誤等），自動將錯誤內容寫入 Firestore `errorLogs` 集合，讓管理員可在後台直接查閱，無需透過詢問用戶還原錯誤情境。

---

## 設計原則

- **只記錄系統錯誤**，不記錄業務驗證提示（如「請填寫必填欄位」、「活動已額滿」）
- Demo 模式下不寫入 Firestore
- 不記錄未登入用戶的錯誤（無法關聯到用戶）
- 每筆 errorLog 包含足夠的診斷資訊（用戶、頁面、版本、瀏覽器）

---

## 修改 1：`app.js` — `showToast` 加入 type 參數

**現狀**：
```javascript
showToast(message, duration) { ... }
```

**修改後**：
```javascript
showToast(message, type, context) {
  // 向下相容：若 type 是數字，視為舊版 duration 用法（type 降級為 'info'）
  const _type = (typeof type === 'string') ? type : 'info';
  // 'info'（預設，不記錄）| 'error'（記錄）| 'success'（不記錄）

  // 顯示 toast（現有邏輯不變）
  // ...

  // 若為錯誤類型，寫入 errorLog（含呼叫位置 context）
  if (_type === 'error') {
    ApiService._writeErrorLog(message, context || '');
  }
}
```

> 呼叫方式：
> - `this.showToast('已儲存')` → 同舊版，不記錄
> - `this.showToast('寫入失敗（permission-denied）', 'error', 'handleTeamJoinAction')` → 記錄，含位置資訊
> - `this.showToast('寫入失敗', 'error')` → 記錄，context 留空（仍能知道訊息與用戶，但無法定位函式）

---

## 修改 2：`js/api-service.js` — 新增 `_writeErrorLog`

```javascript
_writeErrorLog(message, context) {
  if (ModeManager.isDemo()) return;
  const curUser = this.getCurrentUser();
  if (!curUser?.uid) return; // 未登入不記錄

  // 取得當前頁面（從 App navigation state）
  const page = App._currentPage || document.querySelector('.page.active')?.id || 'unknown';

  const entry = {
    time: App._formatDateTime ? App._formatDateTime(new Date()) : new Date().toISOString(),
    uid: curUser.uid,
    userName: curUser.displayName || curUser.name || curUser.uid,
    message,
    context: context || '',
    page,
    appVersion: CACHE_VERSION,
    userAgent: navigator.userAgent,
  };

  // 非同步寫入，不阻塞 UI，失敗靜默
  FirebaseService._db?.collection('errorLogs').add(entry).catch(() => {});
},
```

---

## 修改 3：`firestore.rules` — 新增 `errorLogs` 集合規則

```
match /errorLogs/{docId} {
  allow read: if isAdmin();
  allow create: if isAuth() && !isRestrictedAccount();
  allow update, delete: if false;
}
```

---

## 修改 4：現有 catch 區塊逐一加上 `'error'` 型別與 `context`

### 關於 `context` 欄位的重要說明

`context` 需在每個呼叫處**手動傳入函式名稱字串**，例如：

```javascript
// showToast 只知道訊息文字，不知道從哪裡觸發
// 若不傳 context，管理員看到錯誤訊息但無法判斷是哪支函式引起的
this.showToast('寫入失敗（permission-denied）', 'error');
// ↑ 只能知道「有人看到寫入失敗」

// 傳入 context 後，管理員可立即定位問題位置
this.showToast('寫入失敗（permission-denied）', 'error', 'handleTeamJoinAction');
// ↑ 知道「誰、在哪個頁面、哪支函式、看到什麼錯誤、用什麼裝置、哪個版本」
```

因此 `showToast` 簽名需再調整為：

```javascript
showToast(message, type, context)
// type: 'info'（預設）| 'error' | 'success'
// context: 選填，呼叫位置識別字串，建議與函式名稱一致
```

> 實際案例對照（舊系統遇到的入隊審批失敗）：
> ```
> time:     "2026-02-27 14:32:05"
> userName: "王小明"
> message:  "寫入失敗（permission-denied）"
> context:  "handleTeamJoinAction"     ← 立即知道問題出在審批流程
> page:     "message"
> version:  "20260227zr"
> device:   "iPhone / Safari"
> ```
> 管理員看到這筆記錄，不需詢問用戶，即可直接定位到 `message-inbox.js` 的 `handleTeamJoinAction`。

---

以下位置的 `showToast` 呼叫需改為 `showToast('...', 'error', '函式名稱')`：

### `js/modules/message-inbox.js`
- `handleTeamJoinAction` approve：`寫入失敗（...）` → context: `'handleTeamJoinAction'`

### `js/modules/team-form.js`
- `_saveTeam` catch：`儲存失敗` → context: `'_saveTeam'`
- `handleLeaveTeam` catch：（若有）→ context: `'handleLeaveTeam'`

### `js/modules/event-detail-signup.js`
- `handleSignup` catch：`報名失敗` → context: `'handleSignup'`
- `handleCancelSignup` catch：`取消失敗：...` → context: `'handleCancelSignup'`

### `js/modules/event-manage.js`
- `_confirmAllAttendance` errCount 提示：`已更新（N 筆失敗）` → context: `'_confirmAllAttendance'`
- `_forcePromoteWaitlist` catch：（若有）→ context: `'_forcePromoteWaitlist'`

### `js/modules/shop.js`
- `handleSaveShopItem` catch：`商品更新失敗`、`商品建立失敗` → context: `'handleSaveShopItem'`
- `delistShopItem` catch：`下架失敗` → context: `'delistShopItem'`
- `relistShopItem` catch：`上架失敗` → context: `'relistShopItem'`
- `removeShopItem` catch：`刪除失敗` → context: `'removeShopItem'`

### `js/modules/scan.js`
- 掃碼寫入失敗的 toast → context: `'scan'`

### `js/api-service.js`
- `addAttendanceRecord`、`removeAttendanceRecord` 的 `_mapAttendanceWriteError` 路徑 → context: `'addAttendanceRecord'` / `'removeAttendanceRecord'`

> **規則**：只改 `.catch()` 或明確異常路徑裡的 toast，業務驗證（如「請填寫必填欄位」）**不改**。

---

## 修改 5：Admin 後台 — 錯誤日誌分頁

### `pages/admin-system.html`（或新 `admin-error-logs.html`）

加入一個「錯誤日誌」分頁，功能：
- 列出最近 50 筆 errorLog（最新在最上）
- 每筆顯示：時間、用戶名稱、錯誤訊息、頁面、版本、瀏覽器（縮略）
- 過濾器：by 用戶名稱關鍵字、by 日期
- 「清除 30 天前」按鈕（管理員手動維護）

### `js/modules/user-admin-exp.js` 或新增 `js/modules/error-log.js`

- `renderErrorLogs(page)` 函式
- `_fetchErrorLogs()` 從 Firestore 讀取（server source，不用快取）
- `clearOldErrorLogs(days)` 批次刪除舊紀錄

---

## 修改 6：全局 `unhandledrejection` 補充（選配）

在 `app.js` Phase 1 初始化時加入：

```javascript
window.addEventListener('unhandledrejection', (event) => {
  const msg = event.reason?.message || String(event.reason) || 'Unhandled Promise Rejection';
  ApiService._writeErrorLog?.(msg, 'unhandledrejection');
});
```

補捉所有未被 catch 的 Promise 錯誤，作為第二道保險。

---

## 版本號

實作時版本號格式：當天日期 + 下一個可用後綴。

---

## 驗證步驟

1. 故意觸發一個 permission-denied（例如用低權限帳號執行寫入）→ 確認 Firestore `errorLogs` 出現一筆
2. 執行正常操作（報名、退出球隊）→ 確認**不會**產生 errorLog
3. Admin 後台開啟錯誤日誌分頁 → 確認可看到該筆紀錄，包含用戶名稱、頁面、版本
4. Demo 模式觸發錯誤 → 確認**不寫入** Firestore

---

## 工作量估計

| 項目 | 難度 |
|------|------|
| `showToast` 加 type 參數（向下相容） | 低 |
| `_writeErrorLog` in ApiService | 低 |
| Firestore rules errorLogs | 低 |
| 現有 catch 區塊加 `'error'` 型別（~20–30 處） | 中 |
| Admin 錯誤日誌分頁 | 中 |
| `unhandledrejection` 全局捕捉 | 低 |
