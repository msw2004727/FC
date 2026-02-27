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
showToast(message, typeOrDuration, duration) {
  // 向下相容：若第二參數是數字，視為舊版 duration 用法
  let type = 'info';
  let _duration = 2000;
  if (typeof typeOrDuration === 'number') {
    _duration = typeOrDuration;
  } else if (typeof typeOrDuration === 'string') {
    type = typeOrDuration; // 'info' | 'error' | 'success'
    if (typeof duration === 'number') _duration = duration;
  }

  // 顯示 toast（現有邏輯不變）
  // ...

  // 若為錯誤類型，寫入 errorLog
  if (type === 'error') {
    ApiService._writeErrorLog(message);
  }
}
```

> 呼叫方式：
> - `this.showToast('已儲存')` → 同舊版，type 預設 'info'，不記錄
> - `this.showToast('寫入失敗（permission-denied）', 'error')` → 記錄

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

## 修改 4：現有 catch 區塊逐一加上 `'error'` 型別

以下位置的 `showToast` 呼叫需改為 `showToast('...', 'error')`：

### `js/modules/message-inbox.js`
- `handleTeamJoinAction` approve：`寫入失敗（...）`

### `js/modules/team-form.js`
- `_saveTeam` catch：`儲存失敗`
- `handleLeaveTeam` catch：（若有）

### `js/modules/event-detail-signup.js`
- `handleSignup` catch：`報名失敗`
- `handleCancelSignup` catch：`取消失敗：...`

### `js/modules/event-manage.js`
- `_confirmAllAttendance` errCount 提示：`已更新（N 筆失敗）`
- `_forcePromoteWaitlist` catch：（若有）

### `js/modules/shop.js`
- `handleSaveShopItem` catch：`商品更新失敗`、`商品建立失敗`
- `delistShopItem` catch：`下架失敗`
- `relistShopItem` catch：`上架失敗`
- `removeShopItem` catch：`刪除失敗`

### `js/modules/scan.js`
- 掃碼寫入失敗的 toast

### `js/api-service.js`
- `addAttendanceRecord`、`removeAttendanceRecord` 的 `_mapAttendanceWriteError` 路徑

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
