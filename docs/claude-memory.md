# SportHub — Claude 修復日誌

此檔案隨 git 版本控制，記錄歷次 bug 修復與重要技術決策，供跨設備、跨會話參考。

---

### 2026-02-25 — LINE + Firebase Custom Token 認證升級

- **問題**：Firebase Auth 使用 `signInAnonymously()`，UID 與 LINE userId 無關，Firestore rules 無法做 owner-only 驗證，Firebase Console 全是匿名用戶
- **修復**：
  - 新增 Cloud Function `createCustomToken`（`functions/index.js`）：驗證 LINE Access Token → 簽發 Firebase Custom Token，UID = LINE userId
  - `js/line-auth.js`：新增 `getAccessToken()` 包裝 `liff.getAccessToken()`
  - `js/firebase-service.js`：改用 `_signInWithAppropriateMethod()`，Prod 模式走 Custom Token 流程
  - `firestore.rules`：新增 `isOwner(docId)`，加強 users create / registrations create 規則
- **教訓**：
  - 用 `liff.getAccessToken()`（30 天效期）而非 `liff.getIDToken()`（約 1 小時過期）
  - Cloud Functions SA 需要 `roles/iam.serviceAccountTokenCreator` 才能呼叫 `createCustomToken()`
  - Compat SDK 呼叫 Functions：`firebase.app().functions('asia-east1').httpsCallable(...)` 而非 `firebase.functions()`
  - `firebase-functions-compat.js` 必須明確載入，不會自動引入
  - `users/{userId}` update 規則不能用 `isOwner`，管理員需要更新其他用戶資料
  - `attendanceRecords` create 不能加 owner check，管理員幫其他用戶掃碼簽到

---

### 2026-02-25 — LIFF / Firebase 初始化競態條件

- **問題**：`Promise.all([FirebaseService.init(), LineAuth.init()])` 平行執行，Firebase 端用 5 秒輪詢等 LIFF，如果 LIFF 慢就超時降級匿名登入
- **原因**：`_waitForLiffReady(5000)` 是 polling fallback，不是真正等待 LIFF 完成
- **修復**：`app.js` 改為 sequential — 先 `await LineAuth.init()`，再 `await FirebaseService.init()`；移除 `_waitForLiffReady()` 方法
- **教訓**：有依賴關係的非同步初始化不能用 `Promise.all`，應改為 sequential

---

### 2026-02-25 — Prod 模式產生大量匿名用戶

- **問題**：LIFF 未登入（瀏覽器訪客、登入重導向過程）時，每次載入都產生匿名 Firebase Auth 用戶，累積大量垃圾紀錄
- **原因**：所有 fallback 路徑都呼叫 `signInAnonymously()`
- **修復**：`js/firebase-service.js` — Prod 模式下所有 fallback 改為直接 `return`（不建立匿名），非登入用戶靠 localStorage 快取瀏覽；Demo 模式仍保留匿名登入
- **教訓**：LINE LIFF app 的非登入用戶不需要 Firebase Auth；Firestore 查詢失敗有 `.catch()` 和 `onSnapshot` error callback 可優雅降級

---

### 2026-02-25 — 刷新頁面觸發跨裝置畫面閃爍

- **問題**：電腦刷新頁面後，手機畫面也會閃一下
- **原因**：`createOrUpdateUser()` 每次載入都寫入 `lastLogin: serverTimestamp()`，觸發 Firestore `onSnapshot`，所有連線裝置收到變更並重新渲染
- **修復**：`js/firebase-crud.js` — `lastLogin` 節流：距上次超過 10 分鐘才寫入（`Date.now() - lastLogin.toMillis() > 10 * 60 * 1000`）
- **教訓**：每次頁面載入觸發的 Firestore 寫入都會廣播給所有監聽裝置；高頻但非必要的欄位更新要做節流

---

## 重要技術常數

| 項目 | 值 |
|------|-----|
| LINE Channel ID | `2009084941` |
| LIFF ID | `2009084941-zgn7tQOp` |
| Firebase Project | `fc-football-6c8dc` |
| GCP Project | `firm-vine-jxhhm` |
| Cloud Functions SA | `468419387978-compute@developer.gserviceaccount.com` |
| Cloud Functions region | `asia-east1` |
| Firebase Auth 帳號 | `msw741121@gmail.com` |
