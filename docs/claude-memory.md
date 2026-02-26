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

### 2026-02-26 — LINE WebView 首次登入 pending 與首波 UI 更新時序修補
- **問題**：LINE 內建瀏覽器偶發卡在「LINE 登入確認中」，外部瀏覽器雖可登入但頭像或新用戶提示有時更新延遲。
- **原因**：`liff.getProfile()` 在部分 WebView 情境可能卡住不回傳，pending 狀態沒有 timeout；另外 `FirebaseService._onUserChanged` 在 `loginUser()` 後才掛上，可能漏掉首波 currentUser snapshot。
- **修復**：`js/line-auth.js` 為 `liff.getProfile()` 增加 timeout 包裝與重試；`js/modules/profile-core.js` 提前掛 `_onUserChanged`，並在 LIFF profile 可用後先更新登入 UI，`loginUser()` 完成後主動補一次 UI 同步。
- **教訓**：登入流程是多段非同步串接，除了 retry 還要有 timeout 與明確狀態切換，避免 pending 無限等待與首波事件漏接。

### 2026-02-26 — 新用戶卡在「登入確認中」永不結束
- **問題**：新 LINE 用戶從 LINE 內建瀏覽器開啟 app 登入後，永遠卡在「LINE 登入確認中，請稍後」，無法操作直到關閉重開。
- **原因**：Phase 4 async 初始化鏈中，`liff.init()` 和 `_signInWithAppropriateMethod()` 都沒有 timeout；一旦 hang 住，`bindLineLogin()` 永遠不會執行，UI 不更新，`isPendingLogin()` 永遠回 true。
- **修復**：
  - `js/line-auth.js`：`liff.init()` 用 `_withTimeout()` 包裝（8 秒超時）；`isPendingLogin()` 加 `_pendingStartTime` 記錄，超過 20 秒自動降級為未登入
  - `js/firebase-service.js`：`_signInWithAppropriateMethod()` 加 `Promise.race` 15 秒 timeout
  - `app.js`：Phase 4 catch 區塊也呼叫 `bindLineLogin()`，避免失敗後 UI 卡死
- **教訓**：所有 async 初始化步驟都要有 timeout 保護；UI 狀態（isPendingLogin）不能永遠為 true，需有 timestamp-based 自動降級機制

### 2026-02-26 — LINE 首次登入速度優化（並行化 + profile 快取）
- **問題**：Phase 4 登入流程完全串行（liff.init → ensureProfile → FirebaseService.init），首次登入需 4-5 秒用戶才看到頭像和名字。
- **原因**：`ensureProfile()`（取 LINE 頭像/暱稱）和 `FirebaseService.init()`（Custom Token + Firestore 集合載入）沒有依賴關係，卻被迫串行；`getAccessToken()` 依賴 `_ready` flag，而 `_ready` 在 `init()` 最末尾（含 `ensureProfile()`）才設為 `true`，導致無法提前啟動 Firebase Auth。
- **修復**：
  - `js/line-auth.js`：新增 `initSDK()`（只做 liff.init + cleanUrl + 設 `_ready=true`，不含 ensureProfile）；新增 `restoreCachedProfile()`（從 localStorage 還原快取 profile）；`ensureProfile()` 成功後寫入 `liff_profile_cache`；`logout()` 清除快取
  - `app.js` Phase 4：改為 `initSDK()` → 還原快取 profile → `Promise.all([ensureProfile(), FirebaseService.init()])`
  - 版本號更新至 `20260226g`
- **教訓**：
  - LIFF SDK ready 後 `liff.getAccessToken()` 即可用，不需要等 `liff.getProfile()` 完成
  - 將「SDK 初始化」與「取 profile」拆開，可讓 Firebase Auth 提早 ~1-2 秒啟動
  - localStorage 快取 profile 可讓返回用戶立即顯示頭像，背景再更新

### 2026-02-26 — 登入後 Firestore Write channel 400/404
- **問題**：使用者登入後，Console 出現 `Write/channel` 404 + 400 錯誤（堆疊指向 `FirebaseService._seedNotifTemplates`）。
- **原因**：`FirebaseService.init()` 會對所有登入者執行 seed（廣告 slot / 通知模板 / 成就 / 角色權限），但 Firestore Rules 已限制這些集合寫入需 `admin/super_admin`，一般用戶寫入被拒，導致 WebChannel 報錯與重試。
- **修復**：修改 `js/firebase-service.js`，新增 `_resolveCurrentAuthRole()` 與 `_roleLevel()`，在 Step 6 依角色分流 seed：`admin+` 才跑一般 seed，`super_admin` 才跑 `rolePermissions/permissions` seed；一般用戶直接略過，不再發送違規寫入。
- **教訓**：所有初始化 seed/維運寫入都必須先做角色門檻判斷，避免前端在普通使用者會話執行管理級寫入。
### 2026-02-26 — F-01 後續補強（claims backfill + 後台權限 UI 回滾）
- **問題**：F-01 核心已做，但仍有三個風險點：缺少既有使用者 claims 批次回填工具、角色/權限後台寫入失敗時 UI 容易先顯示成功、正常流程尚未有固定 smoke checklist。
- **原因**：`syncUserRole/createCustomToken` 只能覆蓋登入或單人變更場景；`FirebaseService` 的角色權限 CRUD 會吞錯，呼叫端又多為 fire-and-forget；專案尚未建立固定 smoke test 文件。
- **修復**：新增 `functions/index.js` 的 `backfillRoleClaims` callable（`super_admin` only，支援 `limit/dryRun/startAfterDocId`）；調整 `js/firebase-crud.js` 的 `saveRolePermissions/deleteRolePermissions/addCustomRole/deleteCustomRole` 改為拋錯；調整 `js/api-service.js` 的 `updateAdminUser()` 改為 `async` 並在失敗時回滾；調整 `js/modules/user-admin-list.js` 與 `js/modules/user-admin-roles.js` 讓關鍵管理操作改為 `await + rollback`；新增 `docs/smoke-test.md`。
- **教訓**：安全修復不只看 Rules/Functions，管理端 UI 也要避免 optimistic success；對關鍵寫入 API 不應吞錯，否則前端無法正確回滾。

### 2026-02-26 �X �����n�J�a�ϧאּ���x 22 �����å[�J�ҽk�j�M
- **���D**�G�����n�J����a�Ͽﶵ�L�֡]�Ȥּƿ��� + ��L�^�A�L�k�л\���x�ϥΪ̡A�B��涵�ؼW�[��|����C
- **��]**�G`pages/profile.html` �� `#fl-region` �U�Կ��O�����g������²�����A�S���j�M���U�C
- **�״_**�G�b�����n�J modal �s�W `#fl-region-search` �j�M�ءF�e�ݩT�w�g�����x 22 ���� + `��L`�F�b `profile-data.js` �s�W�ҽk�j�M�]`includes`�A�t `�x/�O` ���W�ơ^�P�}�� modal �ɪ���歫�m��l�ơF��s `CACHE_VERSION` �P `index.html` �����ѼơC
- **�аV**�G�R�A�U�ԲM��@���W�L�Q�X���A���P�ɴ��ѷj�M�Τ��աA�קK�����n�J�y�{�d�b��ﶵ�C

### 2026-02-26 �X users �b������]����/�Ѱ�����^MVP
- **���D**�G�ݭn�b�Τ�޲z��@�� `user` �b��������/�Ѱ�����A�����Q����̵n�J��ȯఱ�d�����A�ާ@�\��ɴ��ܡu�b������v�C
- **��]**�G�{���t�Υu�������v���P�����n�J�ˬd�A�ʤֱb�����A�h�]�Ҧp����/����^�P����ɭ��d�I�C
- **�״_**�G`user-admin-list.js` �s�W `����/�Ѱ�����` ���s�]�� `role === 'user'` ��ܡ^�P `toggleUserRestriction()`�F`navigation.js` �s�W����A�P�_�P `showPage()`/���� tab/goBack �d�I�A����̦۰ʾɦ^�����F`profile-core.js` �b currentUser �Y�ɧ�s�^�I��Ĳ�o����ɬy�F`api-service.js` �s�W����b���g�J���b�]�t���W�B�T���wŪ�B�Ӹ�/�P��̵��^�F`firestore.rules` �s�W `isRestrictedAccount()`�A�O�@ `users.isRestricted*` ���� super_admin �i��A�ê��׳Q����b�����D�n�ϥΪ̼g�J���|�C
- **�аV**�G�b������Y�u���e�� UI �|�Q console ¶�L�A�ܤ֭n�P�B�� Rules �����O�@�P�`���g�J����F�ɯ��d�I�������b `showPage()` �o�س�@�J�f���C�|���v�C

### 2026-02-26 �X �Ѱ���������������s�u�\��ǳƤ��v�תO
- **���D**�G��������������������s�I����Q `�\��ǳƤ�` �����d�I�A�L�k�i�J����C
- **��]**�G`bindNavigation()` �N `page-teams` �P `page-tournaments` �@�_��b�P�@�ӥ��}��תO���󤺡C
- **�״_**�G�u�O�d `page-tournaments` ��� `�\��ǳƤ�`�A���� `page-teams` ���d�I�F��s `CACHE_VERSION` �P `index.html` �����ѼơC
- **�аV**�G�����������Ȱ��\�����v������A���n��h�ӭ����j�b�P�@����A�קK�}��@���ɻ~�ץt�@���C
### 2026-02-26 — 球隊頁新增球隊按鈕（依 rolePermissions 顯示）
- **問題**：球隊頁沒有直接的新增球隊入口，用戶需先進入球隊管理頁；且新增入口未依後台角色權限 `team.create` 動態控制顯示。
- **原因**：`pages/team.html` 的球隊頁 header 只有標題，建立球隊入口僅存在於球隊管理頁，且 `showTeamForm()` 建立模式沒有權限防呆。
- **修復**：在球隊頁 header 新增 `新增球隊` 按鈕；於 `team-list.js` 新增 `team.create` 權限判斷與按鈕顯示更新（同步作用於球隊管理頁既有新增按鈕）；在 `team-form.js` 的 `showTeamForm()` 建立模式加入權限檢查與提示；更新 `CACHE_VERSION` 與 `index.html` 版本參數。
- **教訓**：新增功能入口若受角色權限控制，除了 UI 顯示條件外，入口函式本身也要補一層防呆，避免被 console 或舊 DOM 狀態繞過。
### 2026-02-26 — 球隊建立領隊必填、詳情頁編輯入口、入隊申請站內信修復
- **問題**：建立球隊可不設定領隊；球隊詳情頁缺少直接編輯入口；部分球隊送出入隊申請後領隊收不到站內信。
- **原因**：`handleSaveTeam()` 未驗證新增模式領隊；球隊詳情頁 header 無編輯按鈕與權限判斷；入隊申請收件人僅依 `team.captainUid` / 名稱單一路徑解析，遇到 legacy `captainUid`（docId）或名稱不一致時會投遞失敗。
- **修復**：建立球隊新增領隊必填且需為有效用戶驗證；在球隊詳情頁 header 新增 `編輯球隊` 按鈕，僅球隊領隊或具有 `team.manage_all` 權限者顯示並可進入編輯；新增領隊解析 helper（支援 `uid/_docId/name/displayName/teamId+captain role` fallback），入隊申請改用解析後的有效 `uid` 投遞站內信；更新 `CACHE_VERSION` 與 `index.html` 版本參數。
- **教訓**：涉及收件人身分的資料（如 `captainUid`）要容忍 legacy 欄位格式與名稱不一致，應集中成單一解析 helper，避免每個功能各自猜測欄位。
### 2026-02-26 — 補充：站內信即時監聽排序欄位缺失（timestamp）
- **問題**：部分站內信（包含入隊申請）寫入後收件人看不到。
- **原因**：`messages` 監聽使用 `orderBy('timestamp', 'desc')`，但 `FirebaseService.addMessage()` 寫入僅有 `createdAt`，缺少 `timestamp`，導致新文件被查詢排除。
- **修復**：`js/firebase-crud.js` 的 `addMessage()` 補上 `timestamp: serverTimestamp()`（保留 `createdAt`）。
- **教訓**：查詢使用 `orderBy()` 的集合，所有寫入路徑都必須保證該欄位存在，否則會出現寫入成功但訂閱查不到的假象。
### 2026-02-26 — rolePermissions 改為 onSnapshot 即時同步
- **問題**：後台調整角色權限（例如 `team.create`）後，其他用戶端不會立即反映新功能，需要重整頁面才生效。
- **原因**：`rolePermissions` 原本僅在 `FirebaseService.init()` 時 `get()` 一次，之後不在 `_liveCollections` 即時監聽範圍內；前端功能判斷讀的是本地 `FirebaseService._cache.rolePermissions`。
- **修復**：將 `rolePermissions` 改為 `onSnapshot` 即時同步（初始化等待首個 snapshot），更新快取與 localStorage；權限更新時自動刷新受影響頁面（球隊頁、球隊管理、球隊詳情、自訂層級管理）；更新 `CACHE_VERSION` 與 `index.html` 版本參數。
- **教訓**：凡是用於前端功能 gating 的設定資料（feature permission matrix），若要求管理端變更後立即生效，就不能只做啟動時 `get()`，需使用即時同步或明確的重新載入機制。

### 2026-02-26 — 活動管理排序、球隊領隊必填標示與分享活動文案精簡
- **問題**：活動管理列表排序未依時間優先；球隊表單領隊欄位缺少必填紅字提示；分享活動文案包含不需要的費用欄位。
- **原因**：活動管理渲染僅依既有過濾結果直接輸出，未做時間排序；球隊表單標籤未標示必填；shareEvent() 文案仍保留舊版費用欄位。
- **修復**：event-manage.js 新增活動管理預設排序（未結束活動依距今時間最近優先，已結束/取消排後）；pages/team.html 領隊欄位標籤加入紅字 *必填；event-list.js 分享活動文案移除費用行；同步更新 CACHE_VERSION 與 index.html 版本參數。
- **教訓**：列表排序規則應集中在渲染入口明確定義，避免依賴資料原始順序；對必填欄位需在 UI 明示，減少使用者誤填。
### 2026-02-26 - Fix ghost team card after team deletion
- **Problem**: After deleting a team from team management, some users could still see a deleted team card on the teams page after refresh until they navigated away and back.
- **Cause**: Teams onSnapshot updated cache only but did not re-render team pages immediately; team deletion also used fire-and-forget behavior and could show local success before backend deletion completed.
- **Fix**: Added teams realtime UI refresh hooks in firebase-service.js; changed ApiService.deleteTeam() to async/await and only remove local cache after backend delete succeeds; made team-form delete flow await delete and show error toast on failure; updated cache version and index.html version params.
- **Lesson**: Realtime cache updates need matching UI refresh paths, and destructive operations should not be fire-and-forget.

### 2026-02-26 - Add event pinning in activity management and home hot events
- **Problem**: Activity management lacked pin/unpin controls; pinned events were not visually highlighted in activity cards; home hot-events section did not reflect event pinning.
- **Cause**: Event cards had no `pinned/pinOrder` UI handling in `event-manage.js` and `event-list.js`, and home/activity sorting ignored pin metadata.
- **Fix**: Added pin/unpin button to activity management (inserted after roster button and before edit in the action flow), added `toggleMyActivityPin()` with `pinned/pinOrder` updates, prioritized pinned events in activity management sorting and home hot-events sorting, and added pinned border/badge styling to activity management cards, activity timeline cards, and home hot-event cards; updated cache version and index version params.
- **Lesson**: Pinning needs both ordering logic and visual affordance; otherwise users cannot confirm whether pin state is applied.
### 2026-02-26 - Add separate team leader and team manager fields
- **Problem**: Team form and team info only had one captain field, but operations needed separate roles for 球隊領隊 and 球隊經理 with required selection during team creation.
- **Cause**: Team schema/UI used only `captain/captainUid`, so the same field handled both display meaning and permission-bearing manager role.
- **Fix**: Added `leader/leaderUid` selection UI and validation in team form (required valid user on create), relabeled existing captain field to 球隊經理, reordered team detail info grid to show 領隊 and 球隊經理 on the first row, and updated team management/admin team cards/search to show and match the new leader field; updated cache version and index version params.
- **Lesson**: When introducing a second business role, keep existing permission-bearing fields stable and add a new field for display/business semantics to avoid breaking authorization logic.
### 2026-02-26 - Align leader/manager wording and limited-event visibility
- **Problem**: Team leader (leader field) and team manager (captain field) had unclear role wording in the custom-role page, team leaders could not see their own team-only events, and leader capsules looked the same as manager/captain capsules.
- **Cause**: Custom role UI displayed only the built-in `captain` label, limited-event visibility checked only `currentUser.teamId`, and team-detail leader tag reused the captain capsule style.
- **Fix**: Updated user-admin-roles UI to show `captain` as「領隊 / 經理」for custom-role hierarchy/permission panel, expanded team-only event visibility to include teams where the current user is `captain` or `leader`, added a direct event-detail visibility guard, and added a distinct `uc-team-leader` capsule style for the team leader tag in team detail.
- **Lesson**: When one stored role is reused for multiple business titles, keep data model stable but make UI wording and visibility checks explicit to avoid behavior mismatches.
### 2026-02-26 - Add team-only signup lock and event public toggle in event detail
- **Problem**: Non-team viewers could still see a normal signup CTA on team-only events, and organizers/team staff had no quick way to toggle team-only event public visibility from the activity detail page.
- **Cause**: Event detail signup button logic did not distinguish team-only non-members, and event visibility/public toggle controls existed only indirectly in create/edit data without a detail-page control or shared staff visibility helpers.
- **Fix**: Added team-staff/team-membership helpers in event-list.js, allowed public team-only events to be viewable while keeping signup restricted to the event team, rendered a disabled red「球隊限定」button for non-team viewers, added signup guard in event-detail-signup.js, and added an activity-detail title-side「活動公開」toggle (host + team leader/manager/coach) that updates `isPublic` on the event and refreshes views; updated cache version and index version params.
- **Lesson**: Team-only visibility and signup eligibility are different concerns; treat them separately so public viewing does not accidentally imply public signup.
### 2026-02-26 - Allow admin public-toggle and swap team manager/leader order in team info
- **Problem**: Admin/super_admin could view team-only events but could not use the event-detail public toggle unless they were the host or team staff; team detail info card also needed 球隊經理 shown before 領隊.
- **Cause**: `_canToggleEventPublic()` only checked host/team staff, and team detail info grid rendered 領隊 first.
- **Fix**: Updated `_canToggleEventPublic()` to allow `admin+`, and swapped the first-row order in team detail info to `球隊經理` then `領隊`; updated cache version and index version params.
- **Lesson**: Operational controls often need an explicit admin override even when business ownership checks already exist.
### 2026-02-26 - Add team-only button toast and team link in event detail
- **Problem**: The red team-only signup button in event detail could not be clicked to show feedback, and the team name in the「限定 <球隊> 專屬活動」text was not clickable.
- **Cause**: The team-only button was rendered as disabled, and the team-only label text used plain text for the creator team name.
- **Fix**: Changed the red `球隊限定` button to a non-signup toast trigger (`App.showToast('球隊限定')`) and rendered the team name in the team-only label as a clickable link to `App.showTeamDetail(creatorTeamId)` when team id exists; updated cache version and index version params.
- **Lesson**: A blocked action should still provide a clickable feedback path when the UI visually looks like a button.

### 2026-02-26 - Fix team-only events hidden from team members in activity calendar
- **Problem**: Team members could not see their own team-only events in the activity calendar/list in some production sessions.
- **Cause**: `_getVisibleTeamIdsForLimitedEvents()` relied on `currentUser.teamId` plus staff-role scans, but some sessions had no `teamId` on `currentUser` while membership existed in `adminUsers`.
- **Fix**: Added `adminUsers` fallback lookup (by `uid`/name) in `js/modules/event-list.js` when building visible team IDs for team-limited events; updated cache version and `index.html` version params.
- **Lesson**: Create/view permission paths should share the same membership fallback sources to avoid inconsistent visibility checks.

### 2026-02-26 - Activity calendar team-only badge label (clean)
- **Problem**: Team-only cards in the activity calendar did not show a fixed label text.
- **Cause**: The team badge label in activity timeline rendering used dynamic team-name data.
- **Fix**: Changed the activity calendar team-only badge text to fixed red label "球隊限定"; updated cache version to 20260226x and all index.html version query params.
- **Lesson**: Use fixed wording for fixed-status badges.
### 2026-02-26 - Unify team-only badge text across activity cards
- **Problem**: Team-only events showed mixed badge text (`限定` vs `球隊限定`) between hot-event cards and activity timeline cards.
- **Cause**: Hot-event card renderer in `event-list.js` still used the old short label.
- **Fix**: Updated hot-event card badge text to `球隊限定` to match the timeline card badge; bumped `CACHE_VERSION` to `20260226y` and updated all `index.html` version query params.
- **Lesson**: Keep fixed-rule status labels consistent across all list surfaces to avoid user confusion.
### 2026-02-26 - Fix delayed/missing event visibility after status transition
- **Problem**: An event could disappear from activity calendar/management for minutes after status changed, and some events were marked ended right at start time.
- **Cause**: Realtime events listener only watched `open/full/upcoming`, so events changing to `ended/cancelled` could drop from cache until a later full reload path; auto-end logic used start time instead of end time.
- **Fix**: Added dual realtime event slices (`active` + `terminal`) and merged cache updates in `js/firebase-service.js`; changed auto-end check to parse and compare event end time in `js/modules/event-list.js`; bumped cache version and index version params.
- **Lesson**: If UI state depends on status transitions, realtime listeners must cover both source and target statuses, and terminal-state timing must use end-time semantics.
### 2026-02-26 - Adjust activity calendar team-only badge text to 限定
- **Problem**: Requirement clarified that activity calendar cards should show the short badge text `限定` (not `球隊限定`) outside the card.
- **Cause**: Timeline card badge text had been standardized to `球隊限定` in earlier change.
- **Fix**: Updated timeline card badge text in `js/modules/event-list.js` to `限定`; bumped cache version to `20260226za` and updated all `index.html` version query params.
- **Lesson**: Keep UI label wording aligned with exact product wording for each surface, even when the underlying rule is the same.
### 2026-02-26 - Fix attendance write visibility and error handling in manual/scan flows
- **Problem**: Manual attendance confirm could appear "updated" but not persist in Firestore, and notes could look unchanged after refresh; scan flow also lacked explicit write-failure feedback.
- **Cause**: `ApiService.addAttendanceRecord/removeAttendanceRecord` swallowed Firebase errors; note rendering used `.pop()` on mixed-order records and could read older note entries.
- **Fix**: Made attendance add/remove propagate errors with cache rollback in `js/api-service.js`; added latest-record helper in `js/modules/event-manage.js` and switched note/checkout/checkin lookups to latest-by-time; improved `js/modules/scan.js` with write failure `try/catch` handling and fixed missing `modeLabel` variable in family confirm flow; bumped cache version and index params.
- **Lesson**: For audit-like event logs, UI must resolve "latest state" explicitly and must never report success when persistence failed.
### 2026-02-26 - Switch attendance edit delete to soft delete (status=removed)
- **Problem**: Super admin editing attendance could fail with permission denied because canceling checkin/checkout attempted hard delete on `attendanceRecords`, while rules deny delete.
- **Cause**: `removeAttendanceRecord()` used Firestore document delete and cache splice, conflicting with `attendanceRecords` rule `allow delete: if false`.
- **Fix**: Changed attendance removal to soft delete (`status: removed`, `removedAt`, optional `removedByUid`) in `js/firebase-crud.js` and `js/api-service.js`; attendance reads now filter out removed/cancelled records; updated event-manage summary to use filtered attendance source; bumped cache version and index params.
- **Lesson**: For audit collections, deletion should be represented as state transition, and read APIs must consistently hide removed rows.
### 2026-02-26 - Improve attendance write auth retry and permission error messaging
- **Problem**: Scan/manual attendance writes could fail with raw `Missing or insufficient permissions`, giving unclear guidance and no pre-write auth recovery attempt.
- **Cause**: Attendance writes executed even when Firebase Auth session was missing/stale, and raw Firestore errors were surfaced directly.
- **Fix**: Added `ApiService._ensureFirebaseWriteAuth()` to retry Firebase sign-in before attendance writes; mapped Firestore permission/auth errors to clear Chinese guidance via `_mapAttendanceWriteError()`; bumped cache/version params.
- **Lesson**: For production writes, always gate by active auth state and normalize backend errors into actionable user-facing messages.
