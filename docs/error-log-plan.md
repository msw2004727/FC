# 前端錯誤訊息日誌 — 實作計劃（方案 A，修訂版）

## 目標

當系統發生異常（寫入失敗、權限錯誤、網路錯誤等），自動將錯誤內容寫入 Firestore `errorLogs` 集合，讓管理員可在後台直接查閱，無需透過詢問用戶還原錯誤情境。

---

## 設計原則

- **只記錄系統異常**，不記錄業務驗證提示（如「請填寫必填欄位」、「活動已額滿」）
- **`showToast` 不負責記錄錯誤**——顯示 UI 與寫日誌兩件事分開，各自職責清晰
- Demo 模式下不寫入 Firestore
- 不記錄未登入用戶的錯誤（無法關聯到用戶）
- 同一錯誤在同一 session 只記錄一次（防止重複爆量）
- 每筆 errorLog 包含原始 error 物件資訊，而非只有給用戶看的 toast 文字

---

## 架構說明：兩件事分開做

> **關鍵決策**：`showToast` 維持原本簽名不變，不混入日誌邏輯。
> `_writeErrorLog` 在 catch 區塊中**獨立呼叫**，兩者並列。

```javascript
// ✅ 正確做法：catch 區塊自己決定
catch (err) {
  this.showToast(`寫入失敗（${err?.code || '未知錯誤'}）`);   // ① UI 提示用戶
  ApiService._writeErrorLog('handleTeamJoinAction', err);      // ② 記錄給管理員
}

// ❌ 不採用：把記錄邏輯塞進 showToast
this.showToast('寫入失敗', 'error', 'handleTeamJoinAction');   // 職責混淆，向下相容風險
```

**優點**：
- `showToast` 完全不需要改簽名，現有 ~200 處呼叫不受影響
- 記錄與否由呼叫方（catch 區塊）決定，靈活度更高
- 原始 `err` 物件可直接傳入，不受限於 toast 文字

---

## 修改 1：`js/api-service.js` — 新增 `_writeErrorLog`

```javascript
_errorLogCache: new Set(), // session-level dedup，防止同一錯誤重複爆量

_writeErrorLog(context, err) {
  if (ModeManager.isDemo()) return;
  const curUser = this.getCurrentUser();
  if (!curUser?.uid) return; // 未登入不記錄

  // session-level dedup：同一 context + errorCode 組合只記錄一次
  const dedupKey = (typeof context === 'string' ? context : JSON.stringify(context))
    + '|' + (err?.code || err?.message || 'unknown');
  if (this._errorLogCache.has(dedupKey)) return;
  this._errorLogCache.add(dedupKey);

  // 取得當前頁面
  const page = App._currentPage
    || document.querySelector('.page.active')?.id
    || 'unknown';

  const entry = {
    time: App._formatDateTime ? App._formatDateTime(new Date()) : new Date().toISOString(),
    uid: curUser.uid,
    userName: curUser.displayName || curUser.name || curUser.uid,
    // context：字串（函式名）或物件（含 entity ID），見修改 4 說明
    context: typeof context === 'object' ? JSON.stringify(context) : (context || ''),
    // 原始錯誤資訊（三個獨立欄位，方便 admin 介面過濾）
    errorCode: err?.code || '',
    errorMessage: err?.message || String(err) || '',
    errorStack: err?.stack ? err.stack.slice(0, 500) : '', // 截斷避免過長
    page,
    appVersion: CACHE_VERSION,
    userAgent: navigator.userAgent,
  };

  // 非同步寫入，不阻塞 UI，失敗靜默（避免記錄錯誤的錯誤無窮迴圈）
  FirebaseService._db?.collection('errorLogs').add(entry).catch(() => {});
},
```

> **為何記錄三個 error 欄位而非只記 toast 文字？**
>
> toast 文字是人工拼出的，例如 `'寫入失敗（' + err?.code + '）'`，不穩定且資訊有限。
> 原始 `err` 物件含有：
> - `err.code` → `"permission-denied"`（可在 admin 介面過濾特定錯誤類型）
> - `err.message` → `"Missing or insufficient permissions."`（完整描述）
> - `err.stack` → 完整 call stack（定位問題根源）

---

## 修改 2：`firestore.rules` — 新增 `errorLogs` 集合規則

```
match /errorLogs/{docId} {
  allow read: if isAdmin();
  allow create: if isAuth() && !isRestrictedAccount();
  allow update: if false;
  allow delete: if isAdmin(); // ← 管理員可清除舊記錄（clearOldErrorLogs 需要）
}
```

> ⚠️ 原計劃寫 `allow update, delete: if false` 是錯誤的——
> `clearOldErrorLogs` 需要刪除權限，否則清除功能永遠無法執行。

部署：`firebase deploy --only firestore:rules`

---

## 修改 3：現有 catch 區塊加上 `_writeErrorLog`

### 呼叫格式

```javascript
// 基本格式：傳函式名字串
ApiService._writeErrorLog('函式名稱', err);

// 進階格式：傳物件含 entity ID（診斷力更強）
ApiService._writeErrorLog({ fn: '函式名稱', teamId, applicantUid }, err);
```

> **為何 context 建議傳物件？**
>
> 純字串只知道「哪支函式出錯」，物件可以知道「哪支函式對哪個資料出錯」：
> ```
> context: "handleTeamJoinAction"
> → 知道「審批流程出錯」，但不知道是哪個球隊、哪個申請人
>
> context: { fn: "handleTeamJoinAction", teamId: "team_abc", applicantUid: "U123" }
> → 直接可以去 Firestore 查對應資料，一次定位
> ```

---

### 需要新增 `_writeErrorLog` 的位置

#### `js/modules/message-inbox.js`
```javascript
// handleTeamJoinAction approve — updateUser 失敗
catch (err) {
  this.showToast(`寫入失敗（${err?.code || err?.message || '權限錯誤'}），請重試`);
  ApiService._writeErrorLog({ fn: 'handleTeamJoinAction', teamId, applicantUid }, err);
  return;
}
```

#### `js/modules/team-form.js`
```javascript
// _saveTeam — 儲存失敗
ApiService._writeErrorLog({ fn: '_saveTeam', teamId: this._editingTeamId }, err);

// handleLeaveTeam — adminUser 更新失敗（目前只有 console.error，連 toast 都沒有）
// ⚠️ 這是「靜默錯誤」，用戶不知道，管理員也不知道，特別需要補記錄
ApiService._writeErrorLog({ fn: 'handleLeaveTeam', teamId }, err);
```

#### `js/modules/event-detail-signup.js`
```javascript
// handleSignup — 報名失敗
ApiService._writeErrorLog({ fn: 'handleSignup', eventId: id }, err);

// handleCancelSignup — 取消失敗
ApiService._writeErrorLog({ fn: 'handleCancelSignup', eventId: id }, err);
```

#### `js/modules/event-manage.js`
```javascript
// _confirmAllAttendance — 部分失敗（errCount > 0）
// 注意：這是「部分成功」不是硬失敗，建議只在 errCount > 0 時記錄
if (errCount > 0) {
  ApiService._writeErrorLog({ fn: '_confirmAllAttendance', eventId, errCount }, new Error(`${errCount} 筆寫入失敗`));
}
```

#### `js/modules/shop.js`
```javascript
ApiService._writeErrorLog({ fn: 'handleSaveShopItem', itemId: this._shopEditId }, err);
ApiService._writeErrorLog({ fn: 'delistShopItem', itemId: id }, err);
ApiService._writeErrorLog({ fn: 'relistShopItem', itemId: id }, err);
ApiService._writeErrorLog({ fn: 'removeShopItem', itemId: id }, err);
```

#### `js/modules/scan.js`
```javascript
ApiService._writeErrorLog({ fn: 'scan', eventId }, err);
```

#### `js/api-service.js`
```javascript
// _mapAttendanceWriteError 路徑（addAttendanceRecord / removeAttendanceRecord）
ApiService._writeErrorLog({ fn: 'addAttendanceRecord', eventId }, err);
ApiService._writeErrorLog({ fn: 'removeAttendanceRecord', eventId }, err);
```

---

### 靜默錯誤（silent catch）也需補記錄 ⚠️

全專案有許多 `.catch(err => console.error(..., err))` 的寫法——用戶不知道、管理員也不知道。這是最危險的盲區。需逐一審查並補上 `_writeErrorLog`，即使不顯示 toast 也要記錄。

重點目標（目前確認的靜默錯誤）：
- `team-form.js` `handleLeaveTeam`：`FirebaseService.updateUser(...).catch(err => console.error('[leaveTeam]', err))`
- `event-detail-signup.js` cancelSignup dedup 區塊：`.catch(err => console.error('[activityRecord cancel]', err))`
- 其他 `.catch(console.error)` 一律視為潛在記錄點

> **規則**：只改確實是系統異常的 catch，業務驗證的 return 路徑不改。

---

## 修改 4：全局 `unhandledrejection`（選配，加過濾）

在 `app.js` Phase 4 初始化完成後加入（非 Phase 1，確保 ApiService 已就緒）：

```javascript
window.addEventListener('unhandledrejection', (event) => {
  // 初始化階段的錯誤不記（ApiService 未就緒時無法寫入）
  if (!ApiService._ready) return;

  const msg = event.reason?.message || '';

  // 排除已知第三方 SDK 的雜訊
  if (
    msg.includes('liff') ||
    msg.includes('Firebase') ||
    msg.includes('firestore') ||
    msg.includes('ChunkLoadError') // 網路問題造成的 JS chunk 載入失敗
  ) return;

  ApiService._writeErrorLog('unhandledrejection', event.reason);
});
```

> 若不加過濾直接監聽，LINE LIFF SDK 和 Firebase SDK 自身拋出的 rejection 都會進來，errorLogs 會充斥不相關雜訊。

---

## 修改 5：Admin 後台 — 錯誤日誌分頁

### 建議放置位置

放在 `pages/admin-system.html` 現有的系統管理頁面，新增一個「錯誤日誌」分頁（tab）。

### 顯示欄位

每筆記錄顯示：

| 欄位 | 說明 |
|------|------|
| 時間 | `time` |
| 用戶 | `userName`（可點擊跳至用戶管理） |
| 函式 / 位置 | `context`（JSON parse 後顯示 `fn` 欄位） |
| Entity | `context` 中的 `teamId`/`eventId` 等（若有） |
| 錯誤碼 | `errorCode`（可作為過濾器） |
| 錯誤描述 | `errorMessage` |
| 頁面 | `page` |
| 版本 | `appVersion` |
| 裝置 | `userAgent`（縮略顯示 iOS/Android/Desktop） |

### 功能

- 最新 50 筆（最新在最上）
- 過濾器：by 用戶名稱、by errorCode、by 日期
- 「清除 N 天前」按鈕（管理員手動維護，底層呼叫 `clearOldErrorLogs`）

### 新模組

建立 `js/modules/error-log.js`（獨立模組，不超過 300 行原則）：

```javascript
Object.assign(App, {
  _errorLogPage: 1,

  async renderErrorLogs(page) { ... },         // 讀取並渲染列表
  async _fetchErrorLogs(filters) { ... },       // server source，不用快取
  async clearOldErrorLogs(days) { ... },        // 批次刪除，注意 Firestore 500筆/批次限制
  _parseUserAgent(ua) { ... },                  // 縮略顯示 iOS/Android/Desktop
});
```

> **注意**：`clearOldErrorLogs` 的批次刪除需分批處理（每批最多 500 筆），
> 若舊記錄超過 500 筆需多輪迴圈，否則 Firestore 批次寫入會拋出錯誤。

---

## 驗證步驟

1. **正常路徑**：執行報名、退出球隊等正常操作 → 確認 `errorLogs` 無新增記錄
2. **觸發系統錯誤**：用低權限帳號執行寫入 → 確認 `errorLogs` 出現一筆，且包含 `errorCode: "permission-denied"`
3. **dedup 驗證**：連續觸發同一錯誤 5 次 → 確認 `errorLogs` 只新增 1 筆
4. **entity ID 驗證**：確認 context 物件中的 `teamId`/`eventId` 正確記錄
5. **靜默錯誤**：觸發 `handleLeaveTeam` 的 adminUser 更新失敗 → 確認即使沒有 toast 也有記錄
6. **Demo 模式**：Demo 模式觸發錯誤 → 確認不寫入 Firestore
7. **Admin 清除**：按「清除 30 天前」→ 確認舊記錄被刪除，新記錄保留
8. **unhandledrejection 過濾**：確認 LINE LIFF 的 rejection 不會進入 errorLogs

---

## 工作量估計

| 項目 | 難度 | 說明 |
|------|------|------|
| `_writeErrorLog` in ApiService（含 dedup） | 低 | 單一函式 |
| Firestore rules errorLogs | 低 | 4 行規則 + deploy |
| 顯性 catch 區塊加 `_writeErrorLog`（~15 處） | 低–中 | 對照修改 3 清單逐一加 |
| 靜默 catch 審查與補記錄 | 中 | 需全專案 grep `.catch(console.error)` |
| `unhandledrejection` 全局捕捉（含過濾） | 低 | 約 10 行 |
| Admin 錯誤日誌分頁（新模組） | 中 | 新建 `error-log.js` + HTML 分頁 |
| `clearOldErrorLogs` 分批刪除 | 低–中 | 注意 500筆/批次限制 |
