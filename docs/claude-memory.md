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

### 2026-02-25 — 單人取消候補/取消報名抓錯紀錄

- **問題**：活動頁單人取消候補/取消報名有時會顯示成功，但 `registrations` 主資料未正確更新，導致需要反覆點擊才真正取消成功。
- **原因**：`js/modules/event-detail-signup.js` 的 `handleCancelSignup()` 在 Firebase 模式用模糊 `.find(...)` 選取取消目標，只排除 `cancelled` 未排除 `removed`，可能先抓到歷史 `removed` 紀錄；此外找不到有效 `registration` 時仍走 fallback 並顯示成功，造成假成功。
- **修復**：`js/modules/event-detail-signup.js` 改為從 `ApiService.getMyRegistrationsByEvent(id)` 的有效 `myRegs` 中依 `waitlisted/confirmed` 精準選取取消目標；找不到有效 `registration` 時改為顯示同步提示，不再做假成功 fallback。同步依規範更新 `js/config.js` 與 `index.html` 快取版本號至 `20260225m`。
- **教訓**：取消流程必須以有效主資料（`registrations`）為準，明確排除歷史狀態（如 `removed`）；當主資料找不到時不能回報成功，否則會製造難以追查的假成功錯覺。

---

### 2026-02-25 — 候補順位穩定排序與取消防連點

- **問題**：候補名單順位顯示可能受快取順序影響而不穩定；單人取消候補/取消報名在網路請求期間可重複點擊，造成競態與重複請求。
- **原因**：`_buildGroupedWaitlist()` 未對 `waitlisted` 報名紀錄做穩定排序；`handleCancelSignup()` 沒有取消期間 UI 鎖定與防連點。
- **修復**：`js/modules/event-detail.js` 在候補分組前先依 `registeredAt`、`promotionOrder` 排序（`waitlistNames` 仍只作 fallback 補缺）；`js/modules/event-detail-signup.js` 為單人取消按鈕加入 busy guard、按鈕 disable 與處理中 spinner，並於完成/失敗後恢復 UI。同步更新 `js/config.js` 與 `index.html` 快取版本號至 `20260225n`。
- **教訓**：順位顯示必須依明確資料欄位排序，不能依快取陣列自然順序；取消/報名等會改資料的操作都應做防連點與處理中狀態，降低競態問題。

---

### 2026-02-25 — 首頁活動卡片顯示候補人數
- **問題**：首頁活動卡片只顯示正取人數，無法一眼看出當前候補人數。
- **原因**：`renderHotEvents()` 的人數字串僅輸出正取人數，未拼接 `e.waitlist`。
- **修復**：修改 `js/modules/event-list.js`，首頁卡片人數在 `waitlist > 0` 時追加 ` 候補X`，無候補時維持原顯示。同步更新 `js/config.js` 與 `index.html` 快取版本號至 `20260225o`。
- **教訓**：同一份活動摘要資訊在首頁與詳細頁應維持一致格式，避免資訊落差。

---

### 2026-02-25 — 首頁 QR Code 按鈕改為黑色
- **問題**：首頁底部中間的 QR Code 按鈕使用綠色圖示，視覺需求希望改為黑色。
- **原因**：`css/layout.css` 的 `.bot-tab-qr` 與 `.bot-tab-qr svg` 使用 `var(--accent)`（綠色主色）。
- **修復**：修改 `css/layout.css`，將 `.bot-tab-qr` 的文字色與 `svg` 描邊改為 `#111`（黑色），保留原本白底圓形按鈕樣式。同步更新 `js/config.js` 與 `index.html` 快取版本號至 `20260225p`。
- **教訓**：針對單一元件視覺調整時，優先修改該元件專屬 class，避免改動全域 `accent` 造成連帶影響。

---

### 2026-02-25 — 深色模式 QR Code 按鈕改為白色
- **問題**：首頁 QR Code 按鈕在淺色模式改為黑色後，切換深色模式時對比不足，圖示不易辨識。
- **原因**：`.bot-tab-qr` 與 `.bot-tab-qr svg` 目前固定使用黑色，未針對深色主題做覆寫。
- **修復**：修改 `css/layout.css`，新增 `[data-theme="dark"] .bot-tab-qr` 與 `[data-theme="dark"] .bot-tab-qr svg` 覆寫為白色；同步更新 `js/config.js` 與 `index.html` 快取版本號至 `20260225q`。
- **教訓**：顏色調整若影響主題切換元件，需同時檢查 light/dark 模式的對比與可讀性。

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

### 2026-02-26 - F-01 權限模型核心修復 (Custom Claims + users 欄位保護)
- **問題**：`firestore.rules` 大量使用 `isAuth()` 放行寫入，且 `users/{uid}` owner 可改整份文件；若 `createCustomToken` 依賴 `users.role`，會形成自我升權風險。
- **原因**：角色資料來源（`users.role`）與權限判斷未分離，缺少 owner 欄位白名單/敏感欄位保護，也缺少角色變更後的 claims 同步流程。
- **修復**：更新 `firestore.rules`（新增 `isCoachPlus/isAdmin/isSuperAdmin`、限制 `events`/`announcements`/`customRoles`/`rolePermissions`/`permissions`/`adminMessages` 寫入權限；封鎖 owner 修改 `role/manualRole` 等敏感欄位）；更新 `functions/index.js`（`createCustomToken` 依 Firestore `users.role` 設定 Custom Claims，新增 `syncUserRole` callable）；更新 `js/firebase-crud.js`（角色變更後呼叫 `syncUserRole`，並在變更自己角色時強制 refresh token）；同步更新 `js/config.js` 與 `index.html` 快取版本至 `20260226a`。
- **教訓**：Custom Claims 的安全性取決於 claims 資料來源是否可被使用者修改；必須同時修補資料來源寫入規則與 claims 同步流程。

### 2026-02-26 - F-01 第二輪規則收斂與過渡防鎖死
- **問題**：多個高風險集合仍使用 `isAuth()` 寫入、`attendanceRecords` 欄位與前端 `uid` 不一致、`linePushQueue` 仍可被任意登入者建立；另既有管理員若 claims 尚未更新，可能被新規則誤判為 `user`。
- **原因**：第一輪先封住自我升權核心路徑，但尚未完成其他集合權限收斂與過渡相容性處理。
- **修復**：更新 `firestore.rules`：收緊 `tournaments`、`achievements`、`badges`、廣告/主題/模板、`matches`/`standings`、`activityRecords`、`registrations`、`teams`、`messages`、`shopItems`、`trades`、審計 logs 等集合寫入權限；`attendanceRecords.create` 改用 `uid`；`linePushQueue.create` 暫時改為 `false`；`authRole()` 增加從 `users/{uid}.role` 的安全 fallback（claims 缺失時過渡使用）。
- **教訓**：權限模型上線要分「核心升權漏洞修補」與「全域規則收斂」兩階段驗收；過渡期要設計 claims 缺失的 fallback，避免先把管理員鎖在門外。

### 2026-02-26 - F-01 細修：避免 authRole() 多餘讀取 + 收緊 attendanceRecords.update
- **問題**：`authRole()` 先計算 fallback `get(users/{uid})`，即使 claims 已存在仍可能多做 Firestore 規則讀取；`attendanceRecords.update` 仍是 `isAuth()`。
- **原因**：過渡 fallback 寫法採用 eager 區域變數計算，且簽到紀錄 update 權限在第二輪收斂時漏改。
- **修復**：將 fallback 讀取抽成 `roleFromUserDoc(uid)`，由 `authRole()` 在 claims 缺失時才呼叫；將 `attendanceRecords.update` 改為 `isAdmin()`。
- **教訓**：Rules 的 helper 也要注意「求值時機」與效能；收斂清單完成後仍需做逐條回歸比對，避免漏網之魚。

---

### 2026-02-26 — F-01 後續修補計劃（f01-followup-remediation-plan）深度審查

- **工作內容**：對 `docs/f01-followup-remediation-plan-20260226.md` 進行靜態審查，交叉比對 `comprehensive-audit-20260226.md` 的其他 F-xx 議題，找出計劃瑕疵與交叉依賴，直接在文件中插入 `> 審查備註` blockquote。
- **發現的 Critical 瑕疵**：
  1. **D-1 auto-exp 已是 production bug**：`_grantAutoExp` 由 13 個一般用戶觸發點呼叫，`adjustUserExp` 的兩個 Firestore 寫入（`users.exp`、`expLogs`）均被現有 rules 靜默擋住（`sameFieldValue('exp')` + `isAdmin()`），EXP 系統完全無效，計劃卻說「Phase A/B 不處理」。
  2. **D-2 admin 角色變更已壞**：`adminUserUpdateSafe()` 的 `sameFieldValue('role/manualRole/exp')` 使 admin 透過 client SDK 完全無法改 role；`promoteUser()` 和 `_recalcUserRole()` 在 admin session 下都被 PERMISSION_DENIED，Phase A→B 過渡期 admin 角色管理失效。
  3. **D-3 B-2 Admin SDK 設計決策未標注**：`adminChangeRole` callable 內部需用 Admin SDK 繞過 rules，但計劃未明確標注，易被實作者誤用 client SDK 重踩 D-2 的坑。
- **發現的 High 瑕疵**：
  - D-4：F-06 `submitReview` 若走 `updateEvent`，被 `isCoachPlus()` 擋住（一般用戶無法 update events）
  - D-5：B-5 與 F-07 範圍重疊（角色路徑 vs 底層 `_create/_update/_delete`），需明確劃分
  - D-6：B-6 遺漏 `team-form.js`（4 處 `_recalcUserRole` + 2 處 `promoteUser`，line 138/467/479/513/518/654）
  - D-7：A-3 lineUserId fallback 找到 `doc.id != uid` 的舊文件後，未處理雙 doc 並存問題，建議 CF 端直接 migration
  - D-8：B-2 缺「最後一個 super_admin 不能自降」保護
  - D-9：Phase D 驗收清單完全沒有 auto-exp 測試項目
- **新增章節**：文件末尾新增「交叉依賴分析」（F-01-C/F-02/F-04/F-06/F-07/F-11）與「審查備註索引表」（D-1～D-12）。
- **教訓**：
  - 修補計劃的「範圍排除」若排除的是已發生的 production bug 而非未來功能，需重新評估優先級
  - rules 的欄位白名單（`sameFieldValue`）會同時擋掉 owner 和 admin 的直接寫入，只有 super_admin 可繞過；任何修補方案若涉及敏感欄位寫入，必須走 Admin SDK callable
  - 計劃文件中「需要 Admin SDK」的設計決策必須明確標注，否則第三者實作時易犯同樣錯誤


### 2026-02-26 — 首次 LINE 登入確認中 UI 熱修（避免誤顯示未登入）
- **問題**：新用戶首次完成 LINE 登入後，LIFF profile 與 Firebase 帳號同步較慢，短暫期間 UI 顯示「請先登入LINE帳號」且頭像未出現，容易誤判登入失敗。
- **原因**：前端登入判斷高度依賴 LineAuth._profile，在 liff.getProfile() 延遲或暫時失敗時，UI 與導航守門會直接走未登入分支。
- **修復**：js/line-auth.js 新增 ensureProfile() 重試與 pending 狀態；js/modules/profile-core.js 顯示「登入確認中」提示並隱藏登入按鈕；js/core/navigation.js 在 pending 狀態提示稍候而非誤導為未登入。
- **教訓**：登入流程要區分「未登入」與「登入確認中」，避免把暫時狀態直接呈現為失敗結果。
