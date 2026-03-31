# ToosterX — Claude 修復日誌（濃縮版）

此檔案隨 git 版本控制，記錄歷次 bug 修復與重要技術決策，供跨設備、跨會話參考。

> **維護規則**：
> - 新紀錄一律寫在檔案前方，採新到舊排序
> - `[永久]` 標記的條目為系統性教訓，永不過期
> - 一般條目超過 30 天且無持續參考價值時可清除
> - 同主題多次迭代合併為一筆（保留最終結果）
> - 純功能新增（可從 git log 得知）不記錄
> - 總行數超過 500 行時觸發清理

### 2026-03-31 — AGENTS 清空規則並統一導向 CLAUDE
- **問題**：`AGENTS.md` 與 `CLAUDE.md` 同時維護完整規則時，容易重複、漏改或兩邊內容漂移。
- **原因**：缺少單一主規則來源，導致兩份 AI 指引文件承擔了相同職責。
- **修復**：清空 `AGENTS.md` 原有規則內容，只保留導入口說明，明確要求 AI 一律先讀 `CLAUDE.md`，並以 `CLAUDE.md` 作為唯一主規則來源。
- **教訓**：AI 指引文件若有多份，必須明確指定 single source of truth，否則規則再完整也會因同步失敗而失效。

### 2026-03-31 — 角色頁三個身分 SVG 改為更貼近角色語意
- **問題**：`roles/index.html` 內除一般用戶外，其餘三個身分代表圖的語意偏弱，和「教練」、「俱樂部」、「場主」名稱連結不夠直觀。
- **原因**：原圖示大多仍以抽象人物或簡化幾何組成，缺少能直接對應身分職責的視覺元素。
- **修復**：重繪 `教練`、`俱樂部`、`場主` 三個 inline SVG。教練改為戰術板加哨子、俱樂部改為盾牌徽章加團隊、場主改為球場場館加定位標記；同步更新 `js/config.js`、`index.html`、`sw.js` 的快取版本到 `20260331b`。
- **教訓**：角色型卡片的代表圖若要讓使用者一眼辨識，應優先用「職責物件 + 身分場景」來畫，而不是只用抽象人像變體。

### 2026-03-31 — 角色頁左右滑動提示改為對齊基礎功能列
- **問題**：`roles/index.html` 的「左右滑動查看更多」提示固定放在比較表上方，無法對齊使用者實際要滑動閱讀的「基礎功能」區段。
- **原因**：提示文字是獨立區塊，沒有綁定比較表內任何列的位置，因此即使置中，也只會停在表格外層上方。
- **修復**：將提示改為浮在比較表容器內，新增 `compare-table-shell`、`compare-swipe-hint`、`base-feature-row` 定位點，並用簡單腳本在行動版把提示鎖到「基礎功能」列的垂直中線；同步更新 `js/config.js`、`index.html`、`sw.js` 的快取版本到 `20260331a`。
- **教訓**：這種「教使用者在哪裡滑」的提示，不應只靠上方留白擺放，應直接綁定到對應內容列，否則視覺提示和操作目標會脫節。

### 2026-03-31 — 角色頁行動版上下滑動提示圖重疊
- **問題**：`roles/index.html` 的「上下滑動瀏覽更多」遮罩提示中，箭頭與手指圖示過度擠在一起，行動版辨識度偏低。
- **原因**：原本的 SVG 在 `64x64` 畫布內同時放入上下箭頭、手指與裝飾線，垂直留白不足，動畫位移又偏大，視覺上容易重疊。
- **修復**：重畫提示 SVG，改為 `72x96` 畫布，將上下箭頭、中心指示線與手指拆開排列；同步縮小位移幅度，並更新 `js/config.js`、`index.html`、`sw.js` 的快取版本到 `20260331`。
- **教訓**：行動版提示圖示若同時承載方向與手勢，應先保留足夠垂直間距，再調整動畫幅度，避免用動畫去放大原本就過密的排版問題。

### 2026-03-31 — [永久] 權限架構安全審查：四項評估結果

完整審查了現有權限架構設計，結論如下：

**1. users 文件欄位層級白名單 → 無漏洞**
- 擔憂：用戶可能直接對 Firestore 寫入 `role` 欄位自我提升角色
- 確認：`firestore.rules` 第 562 行的 `allow update` 每條路徑都必須通過欄位白名單函式（`isSafeSelfProfileUpdate` 等），`isSafeSelfProfileUpdate` 明確封鎖 `role/exp/level/claims/isAdmin/manualRole`，無法繞過。`isOwner` 單獨不夠，必須同時符合欄位限制。

**2. hasPerm() 在 Firestore Rules 的讀取成本 → 無需計畫**
- 評估：每次觸發 `hasPerm()` 的操作最多 +2 次讀取（`users/{uid}` + `rolePermissions/{role}`）；同一請求評估內 Firestore 快取，不會疊乘；`user` 角色因短路不觸發；`admin/super_admin` 因 `isAdmin()` 先通過也幾乎不觸發；實際付費者只有 coach/captain/venue_owner 的寫操作。現有規模下完全在免費額度內，若改用 Custom Claims 消除此成本，代價是失去即時生效優勢，不值得。

**3. INHERENT_ROLE_PERMISSIONS 兩地定義 → 已修復（注釋 + 規則）**
- 評估：`js/config.js` 與 `functions/index.js` 各自定義同名常數，無 build process 故無法共用，屬於維護地雷而非當前 bug。
- 修復（commit 93574d6）：在兩個檔案的常數上方各加 `⚠️ 同步規則` 注釋，並在 `CLAUDE.md` 權限維護規範新增強制同步條目，說明靜默分歧後果。

**4. 前端 role 快取與 Firestore 即時狀態不一致 → 無需計畫**
- 擔憂：App.currentRole 在登入後不更新，導致角色變更要等重整才生效
- 確認：系統已有兩條即時監聽器全程運作：`users` 集合 onSnapshot（偵測到 roleChanged 後強制刷新 token 並呼叫 `applyRole`）、`rolePermissions` 集合 onSnapshot（權限變動後呼叫 `_onRolePermissionsUpdated`）。角色或權限變更後 UI 在毫秒內自動更新，無需重整。Safari PWA 凍結恢復場景也有 `_resumeListeners()` 處理。

### 2026-03-30 — [永久] 權限系統統一重構（Phase 1-4）
- **問題**：系統有 9 種不同的存取控制機制互相矛盾（data-min-role、ROLE_LEVEL_MAP、hasPermission、Firestore Rules 等），權限開關對教練/領隊/場主實際無效
- **修復**：Phase 1 移除 17 個頁面的 data-min-role（改由 DRAWER_MENUS permissionCode 控制）；Phase 2 替換 22 處 ROLE_LEVEL_MAP 硬檢查為 hasPermission()；Phase 3 驗證 CF 不動；Phase 4 擴充 Firestore Rules 測試
- **架構**：前端 hasPermission() + 後端 Firestore Rules hasPerm() 雙層驗證；super_admin 永遠全權限；user 永遠零權限；基礎功能（報名/取消/入隊/退隊）不受影響
- **教訓**：role.js _canAccessPage() 現在有 5 個硬編碼特殊頁面（admin-roles、scan、team-manage、audit-logs、error-logs）必須在此函式中維護；新增後台頁面時必須先加入 DRAWER_MENUS 的 permissionCode

### 2026-03-30 — 層級架構顯示用戶數量 + 說明按鈕
- **需求**：層級架構列表中顯示各角色的用戶人數（紅字），並在標題右側加入「?」說明按鈕解釋兩個數字的意義
- **修復**：`renderRoleHierarchy()` 統計 `ApiService.getAdminUsers()` 各角色人數，以紅色數字顯示在英文名稱右方；標題列加入 `_showPermInfoPopup('_hierarchy')` 說明彈窗
- **檔案**：`user-admin-roles.js`、`user-admin-perm-info.js`、`admin-system.html`、`admin.css`

### 2026-03-30 — 權限開關說明按鈕 + CLAUDE.md 權限維護規則
- **需求**：每個後台權限開關旁加入「?」說明按鈕，點擊顯示該權限的用途說明
- **設計**：參考教學俱樂部 `_showEduInfoPopup` 的圓形按鈕 + 毛玻璃彈窗模式
- **修復**：新增 `user-admin-perm-info.js`（`_PERM_INFO` 對照表 + `_showPermInfoPopup`）、修改 `renderPermissions()` 在入口權限與子權限旁插入按鈕、新增 `.perm-info-btn` / `.perm-info-overlay` CSS
- **CLAUDE.md**：新增規則 #8「權限系統同步維護」——新增或變更後台功能時必須同步評估權限開關與說明

### 2026-03-30 — 層級架構顯示當前權限數量
- **問題**：管理權限頁面的層級架構列表無法一目了然各層級擁有多少權限
- **修復**：在 `renderRoleHierarchy()` 中透過 `ApiService.getRolePermissions(key).length` 取得權限數量，以圓形徽章 `(N)` 顯示在角色標籤後方；新增 `.role-perm-count` CSS 樣式；toggle/reset 權限後同步刷新層級列表數字
- **檔案**：`js/modules/user-admin/user-admin-roles.js`、`css/admin.css`

### 2026-03-30 — 權限面板重新分類 + Firestore permissions 集合清理
- **問題**：權限管理頁面出現重複分類（如「賽事管理」和「賽事相關」同時顯示「建立賽事」）
- **原因**：`getMergedPermissionCatalog()` 合併內建定義 + Firestore `permissions` 集合的遠端資料。遠端有舊分類（perm_0~perm_5），碼名不同但顯示名稱相同，導致看起來重複
- **修復**：用戶在 Firebase Console 刪除 `permissions` 集合的 6 個舊文件。程式碼內建定義已涵蓋所有需要的分類
- **教訓**：`permissions` 集合是遠端擴充用，當內建定義完整後應清空避免衝突。每次新增權限碼只需改 `ADMIN_PAGE_EXTRA_PERMISSION_ITEMS`，不需寫 Firestore
- **新增子權限**：活動管理 9 項、賽事管理 3 項、俱樂部管理 7 項、站內信管理 2 項（部分為 UI 預留）
- **已接線守衛**（OR fallback 模式）：event.create, event.delete, admin.tournaments.create/manage_all/review, admin.messages.compose/delete（共 7 個）
- **固有權限 bug 修復**：coach/captain/venue_owner 的 activity.manage.entry 和 admin.tournaments.entry 開關無法關閉 → 改為 disabled + 標記「固有」

### 2026-03-30 — CI/CD pipeline 修正
- **問題**：GitHub Actions firestore-rules-tests 持續失敗
- **原因 1**：`test:rules:unit` 路徑用 Windows 反斜線（Linux 上黏在一起）
- **原因 2**：直接跑 `test:rules:unit` 沒有啟動 Emulator
- **原因 3**：tournament immutable 測試用 admin 身份（admin 繞過 immutable 檢查）
- **原因 4**：seedDoc 函式名寫錯為 seed
- **修復**：路徑改正斜線、改用 `test:rules`（含 Emulator）、加 setup-java、測試改用 delegate 身份、修正函式名
- **教訓**：Windows 開發 + Linux CI 時，package.json scripts 路徑一律用正斜線

### [永久] 2026-03-30 — 手機日期選擇器 auto-fill 陷阱（picker session 模式）
- **問題**：手機建立活動選日期時，會同時加入今天 + 選取的日期
- **原因**：iOS Safari / Android Chrome 開啟空的 `input[type=date]` 時，系統自動將值設為今天並觸發 `change`；用戶選完再觸發第二次 `change`。桌機 F12 模擬不會復現（Chrome 內建 picker 不 auto-fill）
- **v1 修正（失敗）**：在 `change` handler 中 `_addMultiDate(val)` 後清空 input → 無效，因今天已被加入
- **v2 修正（成功）**：改用 focus/change/blur 三段式 picker session 追蹤
  - `focus`：重設 `_pickerPending = null`
  - `change`：只記錄最新值，不呼叫 `_addMultiDate`；空值時清空 pending（iOS 取消按鈕）
  - `blur`：150ms 延遲後提交 `_pickerPending`（只取最後一個值）
- **教訓**：`input[type=date]` 的 `change` 在手機上可能觸發多次（auto-fill + 用戶選取），絕不能在 `change` 中直接執行不可逆操作。需用 blur 確認最終值。F12 模擬無法測試此類 bug，必須真機驗證。
- **檔案**：`event-create-multidate.js`（picker session）、`event-create.js`（dateVal fallback）

### [永久] 2026-03-30 — 活動報名按鈕「載入中」卡住 + 已報名卻顯示「立即報名」
- **問題 A**：報名按鈕永久卡在「載入中…」（需關閉重開）
- **問題 B**：已報名用戶看到「立即報名」按鈕（1-5 秒後自動修正但造成困惑）
- **原因 A**：Auth 完成但 registrations listener 啟動失敗（`_authPromise` 已 resolve 但 `auth.currentUser` 仍為 null），3 次重繪重試後放棄，按鈕永久卡住
- **原因 B**：localStorage 恢復的舊 registrations 快取不含新報名，`regsLoading` 判定為 false（因快取不為空），直接用舊快取渲染錯誤按鈕
- **修復（三層縱深防禦）**：
  - Fix A：新增 `_registrationsFirstSnapshotReceived` flag，首次 snapshot 到達前一律顯示「載入中…」
  - Fix 1：3 次重繪（9 秒）後強制解除載入狀態，按鈕可點（Transaction 層有重複偵測保障安全）
  - Fix 2：`_startAuthDependentWork` 中 Auth 完成後主動補啟動 registrations listener
- **regsLoading 新條件**：`!firstSnapshotReceived && retryCount < 3`（取代舊的 `length===0 && !listenerStarted`）
- **教訓**：cache-first 架構中，舊快取不能被信任用於判斷「已報名」狀態。必須區分「尚未載入」和「載入完成但為空」。
- **檔案**：`firebase-service.js`（flag 5 處）、`event-detail.js`（regsLoading 條件 + retry 重設）

### 2026-03-30 — Cloudflare Pages 部署失敗（package-lock.json npm 版本不相容）
- **問題**：9c662fa 到 417ce9e 連續多次部署失敗，`npm ci` 報 `Missing: picomatch@4.0.4 from lock file`
- **原因**：本地 npm 11.6.2 產生的 lock file 格式與 Cloudflare 的 npm 10.9.2 有依賴解析差異
- **修復**：用 `npx npm@10 install` 重新生成 lock file + 新增 `.node-version` 指定 Node 22
- **教訓**：安裝 devDependency 後必須確保 lock file 與部署環境的 npm 版本相容。`.node-version` 檔案跟著 repo 走，換設備自動生效。

### 2026-03-30 — 測試基礎設施改善（4 批，+470 測試）
- **新增測試**：source-drift.test.js、waitlist-sort.test.js、registration-transaction.test.js、event-detail-render.test.js（jsdom）、cloud-functions.test.js、data-contracts.test.js、firestore-rules-extended.test.js（252 測試 / 45 集合 / hasPerm 12 碼）、tests/e2e/example.spec.js（Playwright）
- **修正**：line-auth.test.js 假陽性（加 expect.assertions）、tournament 重複測試合併
- **CI/CD**：.github/workflows/test.yml（push/PR 自動跑 unit + rules）
- **教訓**：copy-paste 測試模式有漂移風險，source-drift.test.js 可偵測但無法根治；長期需遷移 ES Module

### 2026-03-30 — 結構導航文件同步 + 廢棄代碼清理 + docs 整理
- **結構文件**：4 檔交叉同步（architecture.md / structure-guide.md / CLAUDE.md / AGENTS.md），修正 33 個未記錄檔案 + 14 處計數差異（12→14 子資料夾，含 education + color-cat）
- **廢棄清理**：歸檔 6 個已完成腳本 + config.js 339 行變更日誌移除
- **docs 整理**：specs/ 11→5（6 個完成計畫歸檔）、tournament-refactor/ 整個歸檔、root 7→6

### 2026-03-28 — 俱樂部留言板遷移到 Firestore subcollection
- **問題**：Feed 留言板存在 team.feed[] 陣列中，每次操作都整個覆寫 team document，不利擴展且有寫入衝突風險
- **修復**：新建 `team-feed.js` 模組，將 Feed CRUD 遷移至 `teams/{teamId}/feed/{postId}` subcollection
  - 新增 `_teamFeedCache` 快取機制，`_loadTeamFeed` 於 showTeamDetail 時預載
  - Prod 模式用 subcollection CRUD（FieldValue.arrayUnion/arrayRemove 原子操作）
  - Demo 模式完全不受影響，仍用 t.feed 陣列
  - 從 `team-detail-members.js` 移除 8 個 feed 函式，改由 `team-feed.js` 提供
  - `team-detail-render.js` 的 `_renderTeamFeed` 改為優先從 `getTeamFeed()` 讀取
  - 更新 firestore.rules 加入 feed subcollection 規則
  - 更新 script-loader.js 載入順序
- **教訓**：subcollection 遷移時，確保 Demo/Prod 雙路徑都有完整的快取同步

### 2026-03-28 — 俱樂部系統清除 __legacy__ 相容碼
- **問題**：俱樂部表單的領隊/經理/教練載入邏輯中，對無法匹配 UID 的名稱會產生 `__legacy__` 前綴的偽 UID，導致搜尋排除、tag 渲染、儲存驗證等多處需要特殊分支處理
- **原因**：歷史遺留的相容設計，當時經理/領隊/教練可能無對應用戶。現在已確認所有俱樂部人員都有唯一匹配用戶
- **修復**：移除 4 個檔案中所有 `__legacy__` / `__legacy_` 相關邏輯：
  - `team-form-init.js`：無法解析的 UID/名稱直接跳過不 push；captain 改為 null
  - `team-form-search.js`：leader/coach tag 渲染移除 legacy 分支；搜尋排除簡化
  - `team-form.js`：移除 13 處 legacy 判斷（驗證/解析/filter/通知/降級）
  - `team-list.js`：`_buildTeamStaffIdentity` 移除 legacy 跳過邏輯
- **教訓**：legacy 相容碼應在確認資料已遷移完成後及時清理，避免長期累積增加維護負擔

### 2026-03-28 — 俱樂部系統三項優化（拆分+重構+快取）
- **優化 5**：`team-detail-render.js` 的 `_buildTeamDetailBodyHtml` 拆為 5 個 helper 函式（290 行）
- **優化 1**：3 個超標教育模組拆分 → 8 個檔案（全部 ≤ 300 行）
  - `edu-course-plan.js` (566→300) + `edu-course-plan-render.js` (153) + `edu-course-plan-attendance.js` (132)
  - `edu-course-enrollment.js` (416→261) + `edu-course-enrollment-render.js` (165)
  - `edu-detail-render.js` (445→247) + `edu-detail-realtime.js` (129) + `edu-detail-withdraw.js` (92)
- **優化 3**：`edu-checkin.js` 新增 300ms debounce + 30 秒 TTL 快取（20 條上限）+ 簽到後立即清除快取
- **教訓**：拆分時 script-loader.js 載入順序很重要（被依賴的檔案要排前面）；快取失效時機必須在寫入成功後立即執行

### 2026-03-28 — edu-detail-render.js 拆分為三檔
- **變更**：將 445 行的 `edu-detail-render.js` 拆為三個檔案（均 < 300 行）
- **新檔案**：`edu-detail-realtime.js`（129 行，Firestore 即時監聽）、`edu-detail-withdraw.js`（92 行，退學流程）
- **保留檔案**：`edu-detail-render.js`（247 行，頁面框架 + 頁籤 + 成員渲染 + helpers）
- **注意**：`_eduStudentsUnsub` 宣告移至 `edu-detail-realtime.js`（掛在 App 上，任何檔案可存取）
- **載入順序**：`script-loader.js` 中 realtime → withdraw → render

### 2026-03-28 — 教學俱樂部頁籤式 UI 改版
- **變更**：教學俱樂部詳情頁從垂直堆疊改為頁籤式（課程 | 分組 | 我的），支援左右滑動切換
- **修改檔案**：`edu-detail-render.js`（新增 `switchEduTab`、`_renderEduTabContent`）、`education.css`（`.edu-tab-content`）
- **設計要點**：俱樂部資訊固定在 tab-bar 上方；預設頁籤為「課程」；「申請加入」放在「我的」頁籤空狀態；複用 `app.js:_bindSwipeTabs()` 滑動機制
- **相容性**：realtime listener、子頁面導航、Phase 2 背景 fetch 均不受影響（各 render 函式已有容器存在性檢查）

### 2026-03-27 — 課程方案系統重新設計
- **新功能**：學員報名流程（選擇學員彈窗 → 審核 → 繳費記錄 → 出勤追蹤 → 教練備註）
- **資料結構**：coursePlans 新增 allowSignup/maxCapacity/price/currentCount + enrollments 子集合
- **卡片重設計**：底色依方案類型（青/紫漸層）、封面圖 8:3、資訊 chip 由上至下、招生狀態 badge
- **修正**：封面裁切比例、分組學員自動導入名單、名單切換先清空防閃現、繳費用 checkbox toggle 取代 prompt

### 2026-03-27 — 教學俱樂部多項 UI 修正
- 簽到獨立區塊移除（併入課程方案名單頁）
- 說明按鈕 ? 緊靠標題（學員分組<?> 課程方案<?> 我已報名的學員<?>）
- 「教學」膠囊移到頁面標題左邊、類型欄位改招生狀態
- 學員分組交錯底色（淡藍/淡綠）、人數+待審核+編輯刪除同行置右
- 我已報名的學員加入時間（待審核=提交申請、已通過=加入俱樂部）
- 追加學員按鈕在 pending 狀態也顯示

### 2026-03-27 — [永久] 教育頁面即時渲染修正
- **問題**：eduSubPages 沒有包含 page-edu-student-apply → 離開 team-detail 去申請頁時 listener 被停
- **修正**：eduSubPages 加入 page-edu-student-apply + page-edu-course-enrollment
- **問題**：_renderPageContent 沒有教育頁面 handler → goBack 後不重繪
- **修正**：加入 page-team-detail / page-edu-groups / page-edu-students handler
- **教訓**：新增教育子頁面時必須同步更新 eduSubPages 和 _renderPageContent

### 2026-03-27 — 三方審核修正（站內信架構）
- updateMessage/updateMessageRead/markAllMessagesRead 改寫 inbox 路徑（原寫 messages/ 舊路徑）
- _debouncedSnapshotRender 新增 messages case（修正收件匣不即時更新）
- deliverToInbox CF：fromUid 強制 callerUid + 廣播需 admin 角色
- syncGroupActionStatus CF：newStatus 白名單驗證
- 站內信審核緞帶：待審核（橘）/ 已審核（綠）右下角斜角

### 2026-03-27 — [永久] Per-User Inbox 完整遷移（Phase 0-5）
- 遷移結果：465 用戶、2744 則訊息 → 3334 inbox 寫入、519 隱藏跳過
- 舊 messages/ + 所有 inbox 已清空重置（舊遷移資料有收件人展開錯誤）
- Firestore Rules：inbox create:false（只有 CF 可寫）、delete 禁刪 pending 審核

### 2026-03-27 — Batch 1 防護型修正 + Level 1 i18n
- 版本同步偵測、UID 正規化、競態防護、密碼雜湊、LS 配額強化
- i18n 安全範圍接線（profile 頁 19 key + admin log tabs）

### 2026-03-27 — [永久] Phase 2-5 Per-User Inbox 完整遷移
- **Phase 2**：遷移腳本 `scripts/migrate-inbox.js`（Admin SDK、幂等、dry-run、hiddenBy 跳過、readBy→read 轉換）
- **Phase 3**：切換讀取路徑
  - `firebase-service.js`：7+ 條 listener → 1 條 `users/{uid}/inbox` listener (orderBy createdAt desc, limit 200)
  - `message-render.js`：移除 `_filterMyMessages` 依賴，readMessage 改寫 inbox 路徑
  - `message-actions.js`：markAllRead/clearAllMessages 改用 inbox 路徑，clearAll 改真刪除（pending 審核除外）
  - `message-actions.js`：`_syncTournamentMessageActionStatus` 改為更新自己 inbox + 呼叫 CF 同步
  - `message-admin-list.js`：recallMsg 改刪 inbox + 舊 messages/ 向後相容
  - `message-inbox.js`：`_isMessageUnread` 優先看 `msg.read` 布林值（向下相容 readBy/unread）
- **Phase 4**：`message-notify.js` 移除 `FirebaseService.addMessage()` 舊路徑，只走 CF
- **教訓**：遷移歷史必須在切讀取之前；跨 inbox 更新只能走 CF (Admin SDK)

### 2026-03-27 — [永久] Phase 1 Per-User Inbox 雙寫模式
- **架構**：站內信遷移第一步，新訊息同時寫入 `messages/` 和 `users/{uid}/inbox/`
- **CF 新增**：`deliverToInbox`（fan-out 寫入收件人 inbox）、`syncGroupActionStatus`（跨 inbox 審核同步）
- **Rules**：`users/{uid}/inbox/{msgId}` — create:false (只有 CF 可寫)、read:isOwner、update:只能改 read/readAt、delete:禁止刪除 pending 審核
- **前端**：`_deliverToInboxCF` + `_syncGroupActionStatusCF` (fire-and-forget)，`_deliverMessageToInbox()` 末尾呼叫 CF
- **教訓**：跨用戶 inbox 寫入必須透過 CF (Admin SDK)，前端直寫會被 Rules 擋住

### 2026-03-27 — Level 1 i18n 安全範圍接線（19 key）
- **需求**：將已定義但未使用的 i18n key 接線到 HTML，讓 6 種語言切換生效
- **做法**：
  - `pages/profile.html` 加 `data-i18n` 屬性（19 處：7 欄位標籤×2 + 區塊標題 + 統計 + 快捷按鈕 + 登入提示 + tab）
  - `navigation.js` 加通用 `[data-i18n]` 掃描器（語言切換時 + 頁面渲染時非 zh-TW 觸發）
  - `admin-log-tabs.js` 日誌 tab 標籤改用 `t()` + typeof 防護
- **排除**：status.*、activity.register/cancel/waitlist/fee/location/time（邏輯/Firestore/LINE 相關）
- **教訓**：i18n 接線前必須逐一比對 HTML 文字與 i18n key 值是否完全一致，不一致的跳過

### 2026-03-27 — Batch 1 防護型修正（5 項）
- **問題**：全專案審閱發現 6 個已知風險（版本同步、UID 不一致、競態條件、密碼明文、LS 配額）
- **修復**：
  1. `app.js` — init() 加入版本同步偵測（config.js vs index.html vs sw.js），不一致時 console.error
  2. `firebase-service.js` — registrations 載入時自動正規化 uid ↔ userId（3 個寫入點）
  3. `navigation.js` — `_renderPageContent()` 開頭加 `currentPage !== pageId` guard 防止競態 render
  4. `dashboard.js` — `clearAllData()` 密碼改用 SHA-256 雜湊比對，原始碼不再含明文
  5. `firebase-service.js` — `_saveToLS()` 可淘汰清單從 2 個擴充至 6 個 + 失敗時顯示資料大小
- **教訓**：防護型修正（只加 guard / 正規化 / 診斷）不改原有流程，回歸風險極低

### 2026-03-27 — 多日期批次建立活動功能
- **需求**：新建活動時可選擇多個日期（上限 30），一次產生多場獨立活動
- **實作**：新增 `event-create-multidate.js`（日期膠囊 + 相對報名時間 + 批次產生），`event-create.js` 加分支，`event-create-options.js` 加多日期模式判斷
- **教訓**：onclick 內嵌改用 data 屬性 + 事件委派避免 XSS 風險；`_multiDateBound` flag 必須在 reset 時清除，否則重開 modal 監聽器不會重新綁定

### 2026-03-26 — eduCheckin CF 無法找到俱樂部（CORS → not-found）
- **問題**：課程批次簽到呼叫 Cloud Function 報 CORS 錯誤，部署後改報「俱樂部不存在」
- **原因**：1) CF 未部署（CORS 錯誤）。2) 部署後，CF 用 `doc(teamId)` 查 Firestore，但 `teamId` 是資料的 `id` 欄位（自訂 ID），非 Firestore 文件 ID（`.add()` 自動生成）
- **修復**：`functions/index.js` 的 `eduCheckin` 改用 `where("id", "==", teamId).limit(1)` 查詢
- **教訓**：本專案 teams 用 `.add()` 建立，`doc.id`（Firestore 文件 ID）≠ `data.id`（自訂 ID）。CF 中不能用自訂 ID 當 `doc()` 路徑

### 2026-03-26 — 教學俱樂部卡片新增右下角斜緞帶
- **需求**：俱樂部列表中，教學俱樂部卡片要有類似活動卡片分類的斜緞帶標示
- **修復**：team.css 新增 `.tc-edu-ribbon`（淺綠漸層、右下角 -35° 旋轉），team-list-render.js 的 `_teamCardHTML()` 為 education 類型卡片渲染緞帶
- **教訓**：`.tc-card` 已有 `position:relative` + `overflow:hidden`，斜緞帶直接 absolute 定位即可

### 2026-03-26 — 申請表單身份聯動：本人自動帶入 + 代理空白 + 本人唯一鎖定
- **問題**：申請表單欄位順序不直覺，無自動帶入個人資料，無「本人唯一」限制
- **修復**：
  - 「您的身份」移至最頂，預設「本人」
  - 本人模式：自動帶入 displayName（唯讀）、birthday（可改）、gender（可改）；送出時同步回寫個人資料
  - 代理模式：全部空白讓用戶填寫
  - 同一俱樂部只允許一筆 selfUid → 已有本人則鎖定「代理」
  - 所有欄位標記 *必填，生日/性別/姓名 缺一不可
- **教訓**：`s.name.trim()` 需防 null（改為 `(s.name || '').trim()`）；通知訊息中 displayName 需有 fallback

### 2026-03-26 — 學員卡片改造 + 俱樂部/詳情頁即時監聽
- **問題**：①出席紀錄只能查看一人 ②按鈕位置不在卡片內 ③俱樂部頁面無即時更新
- **修復**：
  - 「出席紀錄」按鈕移入每位 active 學員卡片內，傳遞 studentId 到 showEduCalendar
  - 學員區塊抽為 `_renderEduMemberSection` 可獨立重繪
  - 新增 `_startEduStudentsListener` onSnapshot 監聽 students subcollection → 即時更新學員卡片
  - 新增 `_startEduTeamsListener` onSnapshot 監聽 teams collection (where active==true) → 即時更新列表
  - `goBack()` 補 `_cleanupBeforePageSwitch` 呼叫（修正所有頁面離開時的監聽器洩漏）
  - 性別符號加彩色（♂藍/♀粉）
- **教訓**：`goBack()` 與 `showPage()` 是兩條獨立路徑，cleanup 必須兩邊都掛

### [永久] 2026-03-26 — 教育簽到安全強化：簽到走 CF + Firestore Rules 封鎖前端寫入
- **問題**：`eduAttendance` 前端直寫，任何登入用戶都能偽造/篡改簽到紀錄；`students` create 可繞過審核直接寫入 `enrollStatus: 'active'`
- **修復**：
  - 新增 CF `eduCheckin`（asia-east1）：驗證呼叫者為俱樂部幹部（captainUid/leaderUids/coaches name match）、日期合法性（不允許未來日期、最多回溯 7 天）、伺服器端生成 docId（防覆寫）、重複簽到自動跳過
  - `firestore.rules`：`eduAttendance` 改為 `create, update, delete: if false`（僅 admin SDK 可寫）
  - `firestore.rules`：`students` create 增加 `enrollStatus == 'pending' || isCurrentUserTeamCaptainOrLeader` 約束
  - 前端 `edu-checkin.js` / `edu-checkin-scan.js` 改呼叫 `httpsCallable('eduCheckin')`
- **已知限制**：coaches 身份驗證仍依賴 displayName 比對（歷史架構），長期應遷移為 coachUids 陣列
- **教訓**：可審計資料（出席、成績、交易）必須由後端寫入，前端僅發起請求

### 2026-03-26 — 教學俱樂部系統重大修正（快取未載入 + 重複申請 + 課程方案不可見）
- **問題**：①申請加入後仍可重複申請 ②加入後看不到學員狀態 ③課程方案只有幹部可見
- **原因**：`renderEduClubDetail` 未呼叫 `_loadEduStudents()`，導致 `_isEduStudentOrParent` 永遠讀到空快取回傳 false；`handleEduStudentApply` 無重複檢查；課程方案區塊包在 `isStaff ?` 條件中
- **修復**：
  - `edu-detail-render.js`：開頭 `await _loadEduStudents()`、新增 `_getMyEduStudents()` 顯示學員狀態卡片、按鈕邏輯改為「無學員→申請加入(本人/代理)、pending→審核中、active→追加學員+出席紀錄」
  - `edu-student-join.js`：加入重複檢查（同 uid + 同姓名 + 同 team 阻擋）
  - `edu-course-plan.js`：`renderEduCoursePlanList` 接受 isStaff 參數，非幹部唯讀
  - `edu-student-list.js`：分組「新增學員」改為指派彈窗 `showEduAssignStudentModal`
  - `edu-student-form.js`：新增指派彈窗（依年齡篩選候選學員 + 加入按鈕）、移除位置標籤與教練備註欄位
  - `education.html`：表單身份改為「本人/代理」、新增指派彈窗 HTML
- **教訓**：頁面渲染前必須確保所有依賴的快取已載入；非同步資料不能用同步 getter 做判斷

### 2026-03-26 — 站內信學員加入申請審核報錯 approveEduStudent is not a function
- **問題**：站內信頁面點「同意」學員申請時，報錯 `this.approveEduStudent is not a function`
- **原因**：`_handleEduApplyAction`（message-actions.js）呼叫 `approveEduStudent` / `rejectEduStudent`，但這兩個函式定義在 `edu-student-join.js`（education 群組），而 `page-messages` 只載入 `message` 群組，教育模組腳本未載入
- **修復**：在 `_handleEduApplyAction` 呼叫前加 `await ScriptLoader.ensureForPage('page-edu-student-apply')` 確保教育模組已載入
- **教訓**：跨模組呼叫前必須確保目標模組腳本已透過 ScriptLoader 載入，否則函式不存在

### [永久] 2026-03-26 — .page 內的 position:fixed 彈窗會定位偏移
- **問題**：站內信詳情彈窗、撰寫站內信、通知腳本編輯器等 modal 位置偏移，需滾動才看到，不同瀏覽器表現不一
- **原因**：modal 放在 `<section class="page">` 內部，而 `.page` 的 `animation: pageIn` 帶 `transform`，CSS 規範中 transform 會建立新的 containing block，使內部 `position:fixed` 失效
- **修復**：開啟彈窗時 `document.body.appendChild(modal)` 動態掛載到 body，脫離 `.page` 的 transform 影響
- **教訓**：不可將 modal 移出 `<section class="page">` 的 HTML 結構（會破壞頁面切換的 display:none 隱藏邏輯），必須用 JS 動態搬移。所有在 `.page` 內使用 `position:fixed` 的 overlay 都有此風險

### 2026-03-26 — updateEvent 在 db 未初始化時靜默失敗
- **問題**：弱網環境下編輯活動後看似成功，但重整後改動消失
- **原因**：`firebase-crud.js` 的 `updateEvent` 直接使用全域 `db`，未檢查是否已初始化；`ensureAuthReadyForWrite` 只檢查 auth 不檢查 db
- **修復**：updateEvent 開頭加 `db` 存在性檢查，throw 明確 Error；api-service `_handleFirestoreWriteError` 加「尚未準備就緒」匹配顯示 toast
- **教訓**：fire-and-forget 寫入路徑（_update）的 catch 只 console.error，用戶無感知。新增的錯誤類型需同步在 `_handleFirestoreWriteError` 加 toast 匹配

### [永久] 2026-03-26 — 圖片裁切框 aspectRatio 必須與顯示區域一致
- **問題**：俱樂部封面裁切框設為 1:1（正方形），但顯示區域是 800x300（8:3）；活動/賽事/教學封面裁切框設為 16:9，但顯示區域也是 800x300
- **原因**：`app.js` 的 `bindImageUpload` 呼叫時 aspectRatio 參數與實際顯示區域不匹配
- **修復**：俱樂部封面 1→8/3，活動/賽事/教學封面 16/9→8/3，共 10 處（兩組綁定）
- **教訓**：新增圖片上傳時必須確認裁切比例與 CSS 顯示區域的 aspect-ratio 一致。全站比例對照表：封面類 8/3、商品圖 4/3、banner 2.2、浮動廣告 1、彈窗廣告 16/9

### 2026-03-26 — 學員申請審核彈窗缺少同意/拒絕/略過按鈕
- **問題**：教學俱樂部學員申請（actionType: edu_student_apply）的站內信詳情彈窗沒有審核按鈕
- **原因**：`showMessageDetail` 只處理了 tournament_register_request 和 team_join_request，漏掉 edu_student_apply
- **修復**：message-render.js 新增 edu_student_apply 分支渲染按鈕；message-actions.js 新增 `_handleEduApplyAction` 呼叫既有 approveEduStudent/rejectEduStudent + 發送通知
- **教訓**：新增 actionType 時需同步更新 showMessageDetail 的 if-else 分支

### 2026-03-26 — inline 彈窗毛玻璃規範統一
- **問題**：6 處 inline modal overlay 使用 `backdrop-filter:blur(4px)` 且缺少 `-webkit-` 前綴，Safari/LINE WebView 毛玻璃不生效
- **修復**：統一為 `-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);background:rgba(0,0,0,.35)` 符合專案規範
- **教訓**：所有 backdrop-filter 必須同時寫 `-webkit-` 前綴版本

### 2026-03-25 — 俱樂部限定活動「未知俱樂部」+ 非成員按鈕修復
- **問題**：開啟俱樂部限定時顯示「未知俱樂部」；非成員可點擊報名按鈕；未登入者看不到限定標示
- **原因**：activeTeamMap 只用 t.id 作 key，用戶的 teamId 可能是 _docId 格式導致查不到；Guest 按鈕未做 teamOnly 判斷
- **修復**：
  - event-create-team-picker.js：activeTeamMap 雙 key（id + _docId）+ userTeamNameMap fallback 名稱
  - event-detail.js：Guest 按鈕加 teamOnly 檢查顯示「球隊限定」disabled；已登入非成員按鈕改 disabled
  - functions/index.js：CF registerForEvent 合併 creatorTeamId 向後相容
- **教訓**：teams 集合用 .add() 建立導致 _docId ≠ id，所有用 team ID 做 Map key 的地方都需要加入雙 key

### 2026-03-25 — 俱樂部系統 13 個 Bug 批次修復
- **問題**：全面審查俱樂部系統發現 13 個 bug（2 嚴重 / 5 高 / 5 中 / 1 低）
- **修復**：
  - [嚴重] functions/index.js：import Timestamp 取代未定義的 admin.firestore.Timestamp（3處）
  - [嚴重] team-form-search.js：_renderCoachTags 加入 escapeHTML() 防 XSS
  - [高] team-form-join.js：handleLeaveTeam 經理/教練比對改用 UID + myNames Set（同時含 name 和 displayName）
  - [高] team-form-join.js：新增領隊(leaderUids)退出阻擋
  - [高] team-detail.js：_isTeamMember 教練比對改用 myNames Set
  - [高] team-form.js：錯誤日誌變數名 _editingTeamId → _teamEditId
  - [中] team-share.js：成員數判斷 Array.isArray → typeof number（兩處）
  - [中] firebase-crud.js：deleteTeam 加入用戶引用連鎖清理 + 本地快取更新
  - [中] message-actions-team.js + team-detail.js：成員計數 fallback 加入 teamIds 檢查
  - [中] data-sync.js：validTeamIds 同時加入 team.id 和 team._docId
  - [低] team-form-search.js：_teamSearchUsers 加入 (u.name || '') null safety
- **教訓**：`displayName`（LINE 即時名稱）與 `name`（Firestore 儲存值）不保證一致，身份判定應優先用 UID，fallback 時需同時比對兩者

### 2026-03-25 — CDN SDK 載入超時改善（18 秒 + 自動重試）
- **問題**：中階行動裝置在 LINE WebView 內載入 Firebase SDK 經常超過 12 秒超時，導致連鎖失敗（Firestore 未初始化 → 登入失敗 → 權限被拒）
- **修復**：
  - 超時從 12 秒加長至 18 秒
  - `_loadCDNScripts` 加入自動重試一次機制（重試用 10 秒較短超時，因瀏覽器已部分快取）
  - 只重新下載失敗的 SDK（已成功的不重複下載）
- **教訓**：CDN 超時設定需考慮中階裝置 + LINE WebView + 4G 環境，12 秒在此場景偏緊

### 2026-03-24 — 首頁 partial loading 時 6 秒重整按鈕未觸發
- **問題**：首頁部分區塊資料先到、部分仍為空（partial loading），但 6 秒白屏偵測未觸發重整按鈕
- **原因**：`renderAll()` 在 `renderHomeCritical()` 跑完後立即設 `_contentReady = true`，不管渲染出的是真資料還是「載入中…」佔位符
- **修復**：改判斷條件為「hot-events 有實質卡片 (.h-card) 或 Cloud 已就緒 (_cloudReady)」才標記完成
- **教訓**：白屏偵測不能只檢查「渲染函式跑完了」，要檢查「關鍵區塊是否有實質內容」

### 2026-03-24 — 活動詳情「載入中」按鈕卡住修復
- **問題**：活動詳情頁的報名按鈕偶爾持續顯示「載入中…」無法恢復
- **原因**：registrations 監聽器在 Auth 未就緒或 UID 未解析時靜默退出且不排程重試，導致按鈕永遠卡在 loading 狀態
- **修復**：
  - 資料層（firebase-service.js）：`_startRegistrationsListener` 在 UID 未解析靜默退出時，排程 3 秒後一次性重試
  - UI 層（event-detail.js）：偵測到 `regsLoading` 時設 3 秒重繪 timer（最多 3 次），Auth/UID 就緒後自動恢復
- **教訓**：監聽器靜默退出（silent return）必須有重試或通知機制，否則上層 UI 無法得知需要重繪

### 2026-03-24 — 睡覺時點路牌角色消失 bug 修復
- **問題**：角色在紙箱睡覺時點擊路牌，角色會消失（永遠不再出現）
- **原因**：`startRunAway()` 呼叫 `_.wakeUp()` 但沒傳 `boxX` 參數，導致 `ch.x = undefined + SPRITE_DRAW/3 = NaN`。NaN 座標使角色渲染在不可見位置，且 `updateRunAway` 中 `NaN + speed = NaN` 永遠無法到達場景邊緣
- **修復**：`color-cat-character-actions-interact.js:217` — 改用內聯喚醒邏輯 `ch.x = ch.x + C.SPRITE_DRAW / 3`（與 `_wakeIfSleeping()` 同模式），不依賴需要外部參數的 `wakeUp(boxX)`
- **教訓**：`wakeUp(boxX)` 設計需要外部傳入 boxX，但在多個呼叫點容易遺漏；考慮未來統一用 `ch.x` 相對偏移模式

### 2026-03-24 — 天氣系統永遠晴天 bug 修復
- **問題**：養成遊戲天氣系統永遠顯示晴天(clear)，不會出現雨/雪/霧/雷暴等變化
- **原因**：cloud-save 存檔時用 `r.weather`（runtime.weather）但 `_runtime` 物件未定義 `weather` 屬性，永遠 fallback 到 `{ type: 'clear' }`。且 `exportWeather()` 函式存在但從未被 cloud-save 呼叫
- **修復**：
  1. `color-cat-cloud-save.js:163` — 改用 `Sc.exportWeather()` 取得即時天氣狀態
  2. `color-cat-scene.js:545-546` — 場景初始化改為 `initWeather(null)` 每次進入隨機天氣
  3. `color-cat-scene.js:566` — 移除從雲端存檔還原天氣的邏輯（用戶要求每次進入隨機）
- **教訓**：cloud-save 的 `_buildSaveDoc()` 中場景資料應統一透過 export 函式取得，而非直接讀 runtime 屬性

### 2026-03-24 — ScriptLoader 平行預載入優化
- **問題**：刷新後點底部分頁按鈕（活動/俱樂部/賽事/我的）要等 2-5 秒，因為 30+ 個 JS 模組逐一下載+執行
- **修復**：
  - `loadGroup()` 在依序執行前先用 `<link rel="preload" as="script">` 平行下載所有檔案到瀏覽器快取
  - `preloadCorePages()` 加入 profile 頁，Step 1 立即平行下載全部檔案，Step 2 閒置時依序執行
  - idle timeout 從 3s 縮短到 2s
- **教訓**：CLAUDE.md 禁止改 script 載入「順序」，但平行預載只加速下載不改執行順序，安全可行

### 2026-03-24 — 前端效能優化第二輪（渲染層 1~5）
- **問題**：中低階手機滾動/彈窗掉幀，首頁圖片搶頻寬，離開首頁後動畫仍在跑
- **修復**：
  - (1) 所有動態卡片圖片加 `decoding="async"`（event/tournament/sponsor/news/floating-ad）
  - (2) loading-overlay `backdrop-filter` 從 `blur(14px) saturate(140%)` 降到 `blur(10px)`（符合 CLAUDE.md 規範），top-bar 從 `blur(12px)` 降到 `blur(8px)`
  - (4) 離開首頁時加 `home-paused` class 暫停跑馬燈/浮動廣告呼吸/遊戲卡片光效動畫，回來時恢復
  - (5) popup-ad box-shadow `24px 64px` 降到 `12px 32px`，ln-prompt-card `32px` 降到 `20px`
- **教訓**：CSS selector 必須對準實際有 animation 的元素（是 `.float-ad` 不是 `.float-ad-img`，是 `.announce-marquee-inner` 不是 `.announce-marquee-track`）

### 2026-03-24 — 前端效能優化批次（A~G）
- **問題**：中低階手機/4G 網路下首次載入慢、頁面切換不夠流暢
- **修復**：
  - (A) 頁面切換動畫改為 `.22s ease-out + translateY(6px)`，比原 `.3s fadeIn` 更絲滑
  - (B) Google Fonts 改為 `media="print" onload` 非阻塞載入，減少字重 (4→2 + 5→3)
  - (C) 骨架屏已存在，確認無需新增
  - (D) og.png 壓縮 2.6→1.4MB、appicon.png 壓縮 1.9→259KB（非載入路徑，備用）
  - (E) SW STATIC_ASSETS 新增 6 個 boot page HTML 預快取 + fallback 加 `{ignoreSearch:true}`
  - (F+G) 新增 `NetDevice` 偵測工具（慢網路/低端設備），deferred render 延長 idle timeout，首頁慢速提示，熱門活動卡片數降級 10→6，賽事圖片加 `loading="lazy"`，banner-track 加 `will-change:transform`
- **教訓**：不碰 onSnapshot 監聽或 script 動態載入順序（歷史上反覆出問題），只做 CSS/HTML/渲染層優化最安全

### 2026-03-23 — LINE 瀏覽器 deep link 跳轉至 Mini App
- **問題**：LINE 瀏覽器內開 `toosterx.com/?event=xxx` 不會跳轉到 Mini App，導致 LIFF shareTargetPicker 不可用、分享精美卡片選項消失
- **原因**：`index.html` 中繼跳轉腳本有 `if(/Line\//i.test(navigator.userAgent))return` 守衛，LINE 瀏覽器被排除在外，只有外部瀏覽器會跳轉
- **修復**：移除 LINE UA 守衛，改用 `localStorage`（跨 WebView 共享）防彈跳迴圈，30 秒視窗防止 Mini App 載入時重複跳轉
- **教訓**：LINE 內建瀏覽器 ≠ LINE Mini App，shareTargetPicker 等 LIFF API 只在 Mini App 環境可用

### 2026-03-23 — 紙箱上點路牌角色瞬移修復
- **問題**：角色站在紙箱上時點擊路牌，角色會瞬間從紙箱高度跳到地面再往外跑
- **原因**：`startRunAway` 未處理 combo/box 狀態，直接切換 action 為 runAway，導致跳過 jumpOff 落地動畫
- **修復**：在 `startRunAway` 新增紙箱判斷（`comboStep === 2`），設定 `pendingRunAway` 旗標後先執行 jumpOff；`updateJumpOff` 落地後檢查旗標再接 runAway
- **教訓**：所有需要角色離開紙箱的動作都要走 jumpOff + pending 模式，不能直接切 action

### 2026-03-23 — 養成遊戲 Log 查詢功能（管理員用）
- **功能**：在小遊戲管理頁新增「養成遊戲 Log 查詢」區塊，管理員可模糊搜尋用戶暱稱、查看遊戲存檔（角色、數值、戰績、場景、裝備），並匯出 JSON
- **資料來源**：Firestore `users/{uid}/gamePublic/profile`（搜尋）+ `users/{uid}/game/save`（詳情）
- **改動檔案**：新增 `js/modules/game-log-viewer.js`、修改 `pages/admin-system.html`、`js/core/script-loader.js`、`js/core/navigation.js`

### 2026-03-23 — 防作弊：開局強制讀取雲端存檔 + 關鍵動作即時存檔
- **問題**：用戶可在設備A摘花後，立即開設備B繼續摘（因Firestore尚未同步）
- **修復**：(1) `loadFromCloud` 移除「本地較新則用本地」邏輯，雲端有資料時一律以雲端為準；(2) 新增 `markDirty()` 函式（2秒debounce存檔），在摘花、除草、擊殺敵人時觸發
- **改動檔案**：`color-cat-cloud-save.js`、`color-cat-scene-flower.js`、`color-cat-enemy-util.js`、`color-cat-scene-grass.js`
- **教訓**：防作弊核心是「關鍵動作即時存檔 + 開局強制讀雲端」，session踢出只是輔助

### 2026-03-23 — 放置魚缸：雜草系統
- **功能**：雜草自動生長（與花相同間隔）、3 種草型（blade/sage/tall）、深淺綠色隨機、離線補長、鋤草按鈕（角色跑過底邊清除）、存入雲端存檔
- **新增檔案**：`color-cat-scene-grass.js`（MAX_GRASS=50, AUTO_GROW_INTERVAL=450）
- **修改檔案**：`color-cat-scene.js`（草插槽+渲染+更新+除草按鈕替換刷新按鈕+離線補長+存檔還原）、`color-cat-scene-bg.js`（刷新按鈕→鋤草按鈕）、`color-cat-cloud-save.js`（scene.grass 欄位）、`script-loader.js`、`GrowthGames.html`
- **QA 修復**：除草前檢查角色狀態（禁止 sleeping/dying/combo 等）、場景銷毀時清除 weeding 狀態
- **教訓**：除草動畫涉及角色狀態切換，必須檢查 forbidden states 避免破壞 action state machine

### 2026-03-23 — Cloud Functions 冷啟動優化（P0+P1）
- **問題**：27 個 Cloud Functions 全無 `minInstances`，冷啟動 3-5 秒；`@line/bot-sdk` 全域載入拖慢所有函式
- **修復**：(1) `createCustomToken` 加 `minInstances: 1`，消除登入冷啟動 (2) `@line/bot-sdk` 改為 lazy-load，僅 `processLinePushQueue` 實際使用時才載入，其餘 26 個函式省 ~0.5-1s
- **教訓**：`google-auth-library` 已是 lazy-load（函式內 require），無需再改。未來新增重型 SDK 一律 lazy-load

### 2026-03-23 — GrowthGames 第一期：雲端存檔 + 天氣 + 命名系統
- **功能**：遊戲進度雲端存檔（Firestore）、場景物件持久化（花/球/墓碑位置）、天氣系統（6 種天氣 + 粒子特效）、角色命名 UI
- **新增檔案**：`color-cat-cloud-save.js`（Firestore 存讀檔 + localStorage 備援）、`color-cat-scene-weather.js`（天氣系統）、`color-cat-naming.js`（命名 overlay）
- **修改檔案**：`color-cat-stats.js`（loadFullSave）、`color-cat-ball.js`/`scene-flower.js`/`scene-grave.js`（export/import）、`color-cat-scene.js`（天氣+雲端整合）、`color-cat-profile.js`（customName）、`firestore.rules`（game/gamePublic/gameInbox 規則）、`script-loader.js`（新模組）、`GrowthGames.html`（新 script + 工具列按鈕）
- **存檔策略**：localStorage 即時存（關鍵動作）、Firestore 定時存（5 分鐘 + visibilitychange + beforeunload）
- **Firestore 結構**：`users/{uid}/game/save`（私有）、`users/{uid}/gamePublic/profile`（公開）、`users/{uid}/gameInbox/{docId}`（互動，第二期用）
- **教訓**：cloud-save 模組必須處理 Firebase 不可用情況（GrowthGames.html 獨立頁面無 Firebase）；loadFullSave 需做型別檢查防止損壞資料

### 2026-03-23 — 雲端用量儀表板（Cloud Monitoring API + Billing API 整合）
- **功能**：在管理員儀表板新增雲端用量區塊，顯示 Firestore 讀/寫/刪/儲存 + Cloud Functions 呼叫/延遲 + 本月費用
- **後端**：`functions/index.js` 新增 `fetchUsageMetrics`（每小時 onSchedule）+ `fetchUsageMetricsManual`（super_admin onCall），使用 Google Cloud Monitoring API v3 + `google-auth-library` ADC
- **費用功能**：Cloud Billing API（`billing.googleapis.com/billing/cost` metric）取得實際費用 + 用量估算備援（基於 Firebase 公開定價）
- **前端**：`js/modules/dashboard/dashboard-usage.js` — 用量卡片 grid、免費額度進度條、80% 警示橫幅、費用區塊（實際+估算）、7 天趨勢折線圖
- **Firestore**：新集合 `usageMetrics/{dateKey}`，rules 僅 super_admin 可讀、client 禁寫；docData 包含 `billing`（實際費用）與 `estimated`（估算費用）
- **前提**：需在 Google Cloud Console 啟用 Monitoring API + Cloud Billing API；服務帳號需 `billing.viewer` 角色；Billing metric 需啟用 Billing Export 才有資料，否則靜默降級
- **QA 修復**：`const now` TDZ 變數衝突（改用 `storageNow`）、移除模組層 `ModeManager.isDemo()` 直接呼叫、escapeHTML 補齊、移除未使用 `billingClient` 變數、`_fmtCurrency` 類型安全檢查、alignmentPeriod 防零值

### 2026-03-23 — ColorCat MBTI 16 人格系統
- **功能**：為角色新增 16 種 MBTI 人格，每個角色出生時隨機指派、永久不變（除非測試刷新按鈕）
- **行為差異**：E 型活動量高（dash/chase 權重高、talkCd 低＝愛說話）、I 型偏安靜（sleep/watchFlower 高、talkCd 高）、T 型攻擊力高、F 型賞花多、J 型有結構（climbBox 高）、P 型自發（dash/chase 高）
- **對話系統**：每個人格 30 句不重複台詞，分 12 個動作類別（idle/sleep/biteBall/chase/dash/climbBox/climbWall/watchFlower/attackEnemy/chaseButterfly/hurt/general），根據當前動作選對話
- **新增檔案**：`color-cat-mbti.js`（類型定義+權重乘數）、`dialogue/color-cat-dialogue-mbti-analysts.js`（INTJ/INTP/ENTJ/ENTP）、`-diplomats.js`（INFJ/INFP/ENFJ/ENFP）、`-sentinels.js`（ISTJ/ISFJ/ESTJ/ESFJ）、`-explorers.js`（ISTP/ISFP/ESTP/ESFP）
- **修改檔案**：`color-cat-stats.js`（runtime.mbti 持久化+randomizeMBTI）、`color-cat-character-ai.js`（aiPickAction 套用 MBTI 權重乘數）、`color-cat-character-bubble.js`（MBTI 動作對話+talkCdMultiplier 冷卻）、`script-loader.js` + `GrowthGames.html`（載入順序）
- **載入順序**：`color-cat-mbti.js` 必須在 `color-cat-stats.js` 之前載入（stats 初始化時需要 randomType）
- **教訓**：MBTI 權重設計應優先考慮人格整體性格而非機械套用四字母；對話系統 fallback 到 general 類別確保任何動作都能有台詞

### 2026-03-22 — GrowthGames 戰績統計彈窗 + 紙箱行為改版
- **功能**：點擊紙箱彈出毛玻璃 HTML 彈窗，顯示摘花（紅/黃）、敵人擊殺（含 Boss per-type）、擊敗玩家（預留）統計
- **變更**：紙箱點擊行為改為「有敵人 → 紅色 Toast 警告；無敵人 → 角色進箱睡覺 + 開啟統計」；花朵/敵人擊殺飄字從 "+N EXP" 改為 "+1"（計數語義）
- **涉及檔案**：`stats.js`（新增 runtime 欄位 + localStorage 暫存）、`scene-flower.js`（+1 + 計數）、`enemy-util.js`（+1 + 計數 + byPlayer 參數）、`enemy.js`（NPC 互鬥不計入）、`scene.js`（紙箱行為）、新增 `scene-stats-modal.js`
- **資料持久化**：暫用 localStorage（key: `gg_stats_runtime`），TODO 改用 Firestore + Cloud Functions 防竄改（Security Rules deny client writes）
- **教訓**：`dealDamage` 需區分玩家擊殺與 NPC 互鬥，用 `byPlayer !== false` 預設計入避免漏改舊 call sites

### 2026-03-22 — 背景分頁自動暫停 Firestore listeners 省頻寬
- **問題**：用戶從 LINE 分享連結開啟多個分頁，每個分頁各自維持 Firestore onSnapshot 監聽（users 全集合、messages、registrations 等），搶佔頻寬導致新分頁加載變慢
- **修復**：visibilitychange hidden 時 `_suspendListeners()` 卸載所有 data listeners（保留 auth + rolePermissions），visible 時 `_resumeListeners()` 重啟 + `_handleVisibilityResume()` 刷新資料。新增 `_usersUnsub` 單獨追蹤 users listener 的 unsub（原本混在 `_listeners[]` 無法單獨停止）
- **教訓**：多分頁場景下 Firestore 連線數是隱性成本；背景分頁的監聽對用戶毫無價值但持續消耗頻寬

### 2026-03-22 — QR Code 快取優化 + 首頁按鈕修復
- **問題 1**：長時間未開 App 的用戶點 QR Code 按鈕會點不開（auth 未恢復 → UID unknown）
- **問題 2（根因）**：首頁 QR 按鈕呼叫 `showUidQrCode()`，但該函式在 `profile-card.js`（懶載入的 profile script group），首頁不載入 → 函式 undefined → 靜默失敗；去過個人頁後 script 已載入才會成功
- **修復**：(1) 在 app.js 新增 `_openQrPopup()` 包裝器，從 localStorage 快取秒開 QR 彈窗，無快取時自動觸發 `ScriptLoader.ensureForPage('page-qrcode')` 載入 profile scripts；(2) profile-card.js 的 `_generateQrCode` 成功後自動快取 data URL；(3) 登出時清除 QR 快取
- **教訓**：底部導航列按鈕綁定的函式必須在啟動時就可用，或有懶載入包裝器；不能假設懶載入模組的函式在所有頁面都存在

### 2026-03-22 — GrowthGames 多項功能與修復
- **功能 1**：攻擊花朵時 20% 機率隨機召喚一隻敵人（10 種隨機），大絕招打掉複數花時每朵獨立計算 20%
- **功能 2**：點擊場景右側三棵樹可觸發/撤回濃霧效果
- **功能 3**：裝備頁籤（tab2）格子改為正方形並上下置中
- **功能 4**：打到蝴蝶必定（100%）召喚一隻隨機敵人，含普通攻擊和大絕招範圍擊殺
- **功能 5**：左上角重新整理按鈕（與太陽/月亮對稱），點擊後重置場景並隨機換一隻不同角色
- **功能 6**：拖曳球體在角色正上方時，角色原地跳攻擊（不左右抖動）
- **問題**：個人頁面測試版體力條不顯示
- **原因**：`script-loader.js` 的 profile 群組缺少 `color-cat-character-combat.js`，導致 `drawHpBar` 始終為空函式；同時也缺少 enemy、damage-number、fog、grave 等子模組
- **修復**：將所有缺失的 color-cat 子模組（combat、enemy 4 個、damage-number、fog、grave）加入 profile 群組
- **教訓**：新增 color-cat 子模組時，必須同步更新 GrowthGames.html 的 script 標籤**和** script-loader.js 的 profile 群組，兩處缺一不可

### 2026-03-21 — 場景背景視覺增強
- **功能**：(1) 遠山山頂積雪 (2) 夜間主題兩層山巒色差修正 (3) 40 顆閃爍星星 (4) 移除月亮旁裝飾星 (5) 右側三棵背景樹叢
- **改動**：color-cat-scene-bg.js — drawSnowCaps 新增、夜間山巒色值調整、_stars 預生成陣列、drawMoon 簡化、_trees 三棵橢圓樹冠

### 2026-03-21 — 濃霧時角色 90% 想回紙箱睡覺
- **功能**：場景濃霧啟動時，AI 行動選擇中 sleep 權重提升至 90%
- **改動**：color-cat-character-ai.js — aiPickAction 新增 isFog 判斷，sleepW = otherW × 9

### 2026-03-21 — 模組拆分（花朵/蝴蝶、角色動作）
- **問題**：scene-flower.js（526 行）與 character-actions.js（751 行）超過 300 行限制
- **修復**：scene-flower.js → flower（270 行）+ butterfly（176 行）；character-actions.js → core（270 行）+ interact（192 行）+ special（236 行）
- **改動**：新增 scene-butterfly.js、character-actions-interact.js、character-actions-special.js；更新 GrowthGames.html、script-loader.js 載入順序
- **教訓**：跨 IIFE 拆分時，被拆出的檔案透過共享命名空間 `_` 存取原 IIFE 內部函式；需確認載入順序（flower 先於 butterfly、actions 先於 interact/special）

### 2026-03-21 — 總管隱身模式
- **功能**：點抽屜角色標籤切換隱身，全站膠囊/個人名片/資料頁顯示為一般用戶
- **實作**：`_stealthRole()` 攔截 role 顯示，`localStorage('admin_stealth')` 持久化，抽屜標籤變半透明提示
- **改動**：profile-core.js（_userTag + showUserProfile）、profile-data-render.js、role.js
- **教訓**：純顯示層修改，不碰權限判斷（getUserRole / applyRole 的權限邏輯不受影響）

### 2026-03-21 — 拖曳追球兩階段系統（跳躍→攻擊）
- **問題**：(1) 拖曳中球不被踢飛 (2) 兔子無攻擊動作 (3) 跳太高超出畫面 (4) 攻擊時角色左右翻轉 (5) 應從遠處起跳、接近時才攻擊
- **修復**：`color-cat-character-ai.js` 重寫拖曳 kick 為兩階段 `_dragKickPhase`：Phase 0（跳躍，'jump' 精靈，朝球飛行可轉向）→ Phase 1（攻擊，'attack' 精靈，方向鎖定，命中即踢飛球）。起跳距離 50px、切攻擊距離 22px、最大 vy=-3.5（限高 ~41px）。命中後 return true 讓場景釋放拖曳+踢球。`character.js` getSpriteKey 增加 _dragKickPhase 判斷，Phase 1 一律用 'attack'（解決兔子無 jump_attack 問題）
- **教訓**：拖曳追球需要兩階段動畫（跳躍+攻擊）才自然，單階段直接進攻擊看起來不像追擊；兔子/貓咪的精靈映射差異需在 getSpriteKey 層級統一處理

### 2026-03-21 — 修復拖曳球時角色無攻擊動作
- **問題**：拖曳球時角色看不到攻擊動作，只有跑步沒有踢球動畫
- **原因**：五個根因疊加——(1) 踢中球後 return true 釋放拖曳導致互動瞬間結束 (2) kick 階段角色停止移動，球跑遠後攻擊打空 (3) 球在地面時不跳躍，攻擊動作不明顯 (4) character.js 通用重力與 kick 自管重力同時作用（雙重力） (5) 空中踢球顯示 jump 而非 jump_attack 精靈
- **修復**：`color-cat-character-ai.js`（拖曳中 kick 不 return true、kick 階段持續移動 0.8x 速度、接近球一律跳躍 vy=-4）、`color-cat-character.js`（kick 排除通用重力、空中 kick 改用 jump_attack 精靈）
- **教訓**：多段式動作（chase→kick→idle）涉及物理時，需確認各階段的重力來源不重複，且動畫映射要覆蓋地面/空中兩種情境

### 2026-03-21 — 場景新增山巒背景、濃霧效果、拖曳球持續追擊
- **功能1**：背景加入兩層山巒景深（遠山＋近山），以折線剪影繪製在天空與草地之間，日夜主題各有配色
- **功能2**：左上角新增濃霧按鈕（雲朵圖示），點擊後雲霧從左右兩側緩緩飄入直到幾乎看不見物件，雲霧有正弦飄動＋脈動呼吸感，再點一次淡出
- **功能3**：拖曳球時角色持續跑步→跳→攻擊，踢完不冷卻立即再追，除非體力歸零
- **新檔**：`color-cat-scene-fog.js`（~170行）
- **修改**：`color-cat-scene-bg.js`（加 drawMountains）、`color-cat-scene.js`（fog 整合）、`color-cat-character-ai.js`（拖曳球不冷卻）

### 2026-03-21 — LV 膠囊 badge 被 overflow:hidden 容器遮擋
- **問題**：`.uc-lv` 用 `top:-7px` 溢出 `.user-capsule` 上方，但 `.admin-user-name`、`.reg-name-badges-wrap`、`.tl-event-row` 等容器有 `overflow:hidden`，導致部分場景 badge 被裁切
- **原因**：CSS 規範中 `overflow-x:hidden` + `overflow-y:visible` 會被瀏覽器強制將 visible 解讀為 auto，無法單軸放寬
- **修復**：`.user-capsule` 加 `margin-top:7px` 預留空間，badge 的 `top:-7px` 回到視覺原位但不超出父容器邊界，所有場景統一解決
- **教訓**：absolute 定位的子元素若用負 offset 溢出，應優先用 margin 預留空間而非修改祖先 overflow

### 2026-03-21 — 頂部 EXP 顯示不同步
- **問題**：右上角 `#points-value` 的 EXP 與角色資料頁的 EXP 不一致
- **原因**：`_syncCurrentUserFromUsersSnapshot` 的 `changed` 判斷不包含 `exp` 欄位，當 onSnapshot 收到 exp 變更時，`currentUser` 不更新，`updatePointsDisplay` 也不被呼叫
- **修復**：在 `changed` 判斷前加入 `expChanged` 輕量分支，exp 變更時更新 `currentUser` 並刷新頂部顯示，不觸發 listener/role 等重量級操作
- **教訓**：`_syncCurrentUserFromUsersSnapshot` 的 changed 判斷每新增重要欄位都需檢查是否遺漏

### 2026-03-21 — 回推補發新增 LINE綁定/放鴿子扣分/徽章獎勵
- **問題**：CF `backfillAutoExp` 只處理 4 條原始規則（報名/取消/完成/主辦），缺少 line_binding、noshow_penalty、badge_bonus
- **修復**：CF 新增 3 條規則掃描邏輯：LINE 綁定查 `users.lineNotify.bound`、放鴿子查 registrations+attendanceRecords+userCorrections、徽章查 `users/{uid}/achievements` + `badges` 集合。reconciliation 規則（noshow/badge）成功後更新 `autoExpTracking` 子集合
- **教訓**：reconciliation 模型（對帳式）與 event-based 模型（逐事件補差額）的 backfill 邏輯不同，需分別處理 tracking doc

### 2026-03-21 — 補發操作紀錄改為 Firestore operationLogs
- **問題**：「自動發放紀錄」區塊使用 localStorage 存放，只能看到自己觸發的紀錄，其他管理員的操作看不到
- **修復**：前端 `_renderAutoExpLogs` 改為查詢 Firestore `operationLogs`（`type=='exp_backfill'`），CF 端 `backfillAutoExp` 操作日誌新增 `grantedCount`、`uniqueUsers`、`totalExp`、`errorCount` 結構化欄位
- **教訓**：操作級別的審計紀錄應存 Firestore 而非 localStorage

### 2026-03-21 — 手動簽到批次寫入優化（Firestore batch）
- **問題**：手動簽到確認（_confirmAllAttendance）使用逐筆 await 寫入 Firestore，30 人活動需 60+ 次 round trip + 60 次 localStorage 序列化
- **修復**：改為 Firestore batch 原子寫入，收集所有 add/remove 操作後一次 batch.commit()，再做一次 _saveToLS。新增 `FirebaseService.batchWriteAttendance()` 和 `ApiService.batchWriteAttendance()`，抽取共用 `_collectAttendanceOps()` 消除重複邏輯
- **影響檔案**：firebase-crud.js（新增 batchWriteAttendance）、api-service.js（新增 batchWriteAttendance）、event-manage-confirm.js（重寫 _confirmAllAttendance 和 _confirmAllUnregAttendance）
- **教訓**：Firestore batch 上限 500 操作，30 人最多 180 操作遠低於上限；超過 100 人的活動需注意。Demo 模式需另外處理（直接更新快取）

### 2026-03-21 — [永久] 面板碰撞彈飛失效：update/render 時序 bug
- **問題**：角色靠近右側面板時，展開面板有時只被推開不被彈飛
- **原因**：面板滑動推進 (`_slide`) 和碰撞判定在 `drawPanel()`（render 階段），但角色位置夾限在 `update()` 階段先執行。`update()` 用舊的 `_slide` 算出 `ew`，將角色夾到 `ew - halfW`；然後 `drawPanel()` 推進 `_slide`，新的 `panelEdge` 比角色已被夾過的 x 更右，`charState.x > panelEdge` 永遠 false
- **修復**：將面板滑動推進和碰撞判定提取為 `updatePanel()`，在 `update()` 中 `getEffectiveWidth` 之前呼叫；碰撞改用角色右緣 `x + halfW` 判定
- **教訓**：物理碰撞判定必須在同一個更新階段完成，不能分散在 update 和 render 兩個階段；否則位置夾限會吃掉碰撞訊號

### 2026-03-21 — ColorCat 追蝴蝶、蝴蝶加速離場
- **功能**：角色 AI 隨機追逐停在花上的蝴蝶，蝴蝶觸發 flee 階段加速逃離，角色追到蝴蝶離場後回閒置
- **設計**：角色追蝴蝶速度 2.0 < 蝴蝶逃跑初速 2.5（逐幀 +0.03 加速），確保永遠追不上
- **修改**：scene-flower.js（flee 階段 + API）、character.js（stub + dispatch）、character-actions.js（追逐邏輯）、character-ai.js（AI 權重）、character-particles.js（跑步煙塵）
- **附帶**：自然離場蝴蝶也改為逐幀加速（初速 1.5，+0.015/frame）

### 2026-03-21 — test-color-cat 更名 GrowthGames + 架構整理
- **變更**：`test-color-cat.html` → `GrowthGames.html`，更新標題與頁面 heading
- **清理**：刪除孤兒檔 `color-cat-scene-panel-tabs.js`（已被 tab0/tab1/tab2 取代）
- **文件**：`docs/architecture.md` color-cat 區段從 14 模組更新為 20 模組（補入 profile、flower、panel、panel-tab0/1/2）
- **版號**：`20260321` → `20260321a`（四處同步）

### 2026-03-20 — 自動 EXP 對帳規則：放鴿子 / LINE 綁定 / 徽章獎勵
- **功能**：新增 3 條自動 EXP 規則，以 reconciliation model 運作（expected vs applied → delta 補發/扣回）
- **新檔**：`js/modules/auto-exp-rules.js` — 對帳核心 + 3 條規則邏輯
- **修改**：`auto-exp.js`（新增 3 個 rule key 到 `_AUTO_EXP_DEFAULTS`）、`api-service.js`（ruleKey 透傳）、`functions/index.js`（expLog 寫入 ruleKey）、`firestore.rules`（新增 `autoExpTracking` 子集合）
- **觸發點**：`event-manage-confirm.js`（確認出席後）、`user-admin-corrections.js`（補正儲存/清除後）、`profile-data.js`（LINE 綁定後）、`evaluator.js`（成就評估後）
- **追蹤儲存**：`users/{uid}/autoExpTracking/{ruleKey}` Firestore 子集合，欄位 `{ applied, updatedAt }`
- **CF ±100 限制**：delta > 100 時自動分 chunk 呼叫，每 chunk ≤ 100
- **教訓**：LINE 綁定用 deterministic requestId + CF dedup 達到一次性保證；放鴿子/徽章用 tracking doc 做增量對帳

### 2026-03-20 — 掃碼頁「未報名」誤判（缺少 registrations 資料依賴）
- **問題**：已報名用戶掃碼後，scan log 顯示「未報名此活動」，但簽到簽退功能正常
- **原因**：`firebase-service.js` 的 `_collectionPageMap` 和 `_pageScopedRealtimeMap` 中，`page-scan` 只聲明了 `attendanceRecords`，未包含 `registrations`。掃碼時查報名名單為空或舊快取 → `isRegistered = false` → 寫入錯誤的 `unreg` 記錄
- **修復**：兩處 `page-scan` 加入 `registrations`
- **教訓**：新增頁面功能時，若該頁需要查詢某集合的資料，必須在 `_collectionPageMap` 和 `_pageScopedRealtimeMap` 中同步聲明依賴

### 2026-03-20 — ColorCat 模組化拆分 + 修復煙霧/喘氣/貓臉消失
- **問題**：角色拆分為子模組後，煙霧效果、虛弱喘氣粒子消失，AI 不動作
- **原因**：5 個角色子模組檔案（stamina/particles/actions/combo/ai）已建立在磁碟上，但未加入 GrowthGames.html 的 `<script>` 標籤與 script-loader.js 的 profile 群組。子模組未載入導致核心的函式插槽（stubs）保持空操作
- **修復**：
  - 在 GrowthGames.html 加入 8 個新 script 標籤（5 角色子模組 + 3 場景子模組）
  - 在 script-loader.js profile 群組加入 8 個新模組路徑
  - 將 scene.js（639 行）拆為 4 檔：scene.js（253）+ scene-bg.js（68）+ scene-box.js（208）+ scene-flag.js（133）
  - character.js（原 1049 行）拆為 6 檔：character.js（236）+ stamina（95）+ particles（124）+ actions（196）+ combo（186）+ ai（93）
- **教訓**：拆分模組時，除了建立新檔案，必須同步更新所有載入點（HTML script 標籤、script-loader 群組）。子模組採「函式插槽」模式時，未載入只會靜默失效（no-op），不會報錯，極難察覺

### 2026-03-20 — 主題切換開關加入太陽/月亮 emoji 圖示
- **變更**：在 `.toggle-switch` track 上用 `::before`（🌙左側）和 `::after`（☀️右側）放置 emoji，`.toggle-knob` 加 `z-index:2` 蓋住對應圖示
- **效果**：淺色模式 knob 在左蓋住月亮→太陽可見；深色模式 knob 在右蓋住太陽→月亮可見
- **同步**：移除 `.toggle-switch` 的 `margin-left: auto`，文字靠右緊鄰開關

### 2026-03-20 — ColorCat 煙霧與貓臉消失（script-loader 漏載 stats 模組）
- **問題**：正式版 profile 頁面中 ColorCat 場景的跑步煙塵與紙箱貓臉塗鴉消失，角色 AI 約 4 秒後崩潰凍結
- **原因**：commit 4cbe9cf 將養成數值抽到獨立的 `color-cat-stats.js`，但未同步更新 `js/core/script-loader.js` 的 profile 模組載入清單。導致 `window.ColorCatStats` 未定義，`_s()` 回傳 undefined，`aiPickAction()` 呼叫 `_s().ai` 拋 TypeError
- **修復**：在 `script-loader.js` 的 profile 模組群組中加入 `color-cat-stats.js`（放在 config 之後、sprite 之前）；同時在 `aiPickAction()` 加入 `!_s()` null check 防護
- **教訓**：模組拆分時必須同步更新所有載入入口（script-loader、index.html、test 頁面），不能只更新 test 頁面

### [永久] 2026-03-20 — 清除快取後角色降為 user（LIFF/Firebase Auth 半死半活狀態）
- **問題**：用戶點擊抽屜「清除快取」後，瀏覽器報 `auth uid mismatch: authUid: null`，角色降為 user，必須手動登出再登入才恢復
- **原因**：`confirmClearCache()` 清除 LIFF localStorage + 刪除所有 IndexedDB，但未先執行正式登出。在 LINE WebView 中，`liff.isLoggedIn()` 仍回傳 true（WebView session 層級），但 `liff.getAccessToken()` 回傳 null（localStorage 已清）。結果：系統認為用戶已登入（profile 取得成功），但無法取得 access token 走 Custom Token 流程，Firebase Auth 永遠為 null，Firestore 寫入被拒
- **修復**：`app.js:confirmClearCache()` 在清除儲存前先執行 `auth.signOut()` + `liff.logout()` + 清除 LineAuth 狀態 + 清除 `_lineLoginRetryCount`；`index.html:?clear=1` handler 也清除 `_lineLoginRetryCount`，確保重載後能正常觸發自動登入流程
- **教訓**：清除快取時必須先正式登出所有 auth 層（Firebase Auth + LIFF），再清除底層儲存。否則 WebView session 存活 + localStorage token 消失 = 半死半活狀態，無法自行恢復

### 2026-03-20 — clear=1 與版本更新未清 localStorage 集合快取（5.9 + 5.16）
- **問題**：`?clear=1` 只清 SW cache 和 2 個舊 key，30+ 個 `shub_c_*` / `shub_ts_*` 集合快取未清；版本更新時同樣。共用裝置上用戶 A 清快取後用戶 B 開啟會短暫看到 A 的資料
- **原因**：原始 clear=1 handler 只針對 2 個已知 key，未涵蓋 FirebaseService 的集合快取前綴
- **修復**：`index.html` clear=1 handler 和版本不符 handler 都加入清除 `shub_c_*` / `shub_ts_*` / `shub_cache_*` 前綴的 localStorage
- **教訓**：快取清除功能必須隨快取策略同步更新，否則形同虛設

### 2026-03-20 — Firestore 寫入失敗靜默吞掉：permission-denied 無用戶提示
- **問題**：`ApiService._update()` / `_delete()` 是 fire-and-forget 模式，`.catch()` 只 `console.error`；`app.js` unhandledrejection 又把所有含 firebase/firestore 字樣的錯誤靜默 return，導致 permission-denied 寫入失敗時用戶完全不知道
- **原因**：兩層靜默：(1) ApiService catch 不提示用戶 (2) app.js 全面過濾 firebase 錯誤
- **修復**：
  - `api-service.js`：新增 `_handleFirestoreWriteError()` 統一處理，所有 5 個通用 CRUD 方法（`_update`/`_updateAwaitWrite`/`_delete`/`_deleteAwaitWrite`/`_createAwaitWrite`）失敗時顯示 toast
  - `app.js:1822`：unhandledrejection 中 permission-denied 不再靜默，改為記錄 + toast 提示
- **教訓**：fire-and-forget 寫入必須有用戶可見的錯誤回饋，不能只 console.error

### 2026-03-20 — [永久] 首次登入 modal 在 LINE WebView 中按鈕無反應 + 地區列表不顯示
- **問題**：LINE 瀏覽器中首次登入 modal 的確認按鈕點擊無反應，地區搜尋列表不顯示
- **原因**：`profile-data.js` 是懶載入（script-loader.js 的 profile bundle），但 `bindLineLogin` 在 app init 時就執行。此時 `initFirstLoginRegionPicker?.()` 和 `saveFirstLoginProfile` 都不存在於 App 上。之前改用 addEventListener 綁定按鈕後，inline onclick 被移除，導致按鈕完全無法點擊
- **修復**：將首次登入相關邏輯（地區列表、模糊搜尋、saveFirstLoginProfile）搬到 `profile-form.js`（eagerly loaded in index.html），HTML 改回 inline onclick/oninput
- **教訓**：懶載入模組中的方法不能用 addEventListener 綁定 UI 事件；inline handler（`onclick="App.xxx()"`）在執行時才解析 App，不受載入順序影響。修改事件綁定方式前必須確認目標 JS 檔案的載入時機

### 2026-03-20 — Firebase INTERNAL ASSERTION FAILED 防護 + 登入錯誤訊息改善
- **問題**：用戶在 LINE WebView 中看到 `FIRESTORE (10.14.1) INTERNAL ASSERTION FAILED` 錯誤，導致登入失敗
- **原因**：Firebase SDK 10.14.1 compat 的 `enablePersistence({ synchronizeTabs: true })` 在 LINE WebView 的 IndexedDB 環境中觸發 SDK 內部 assertion error。此為火忘 Promise，assertion 同步拋出時未被攔截
- **修復**：
  1. `firebase-config.js`: `enablePersistence` 加 try-catch 包裹，assertion error 時降級為無離線快取
  2. `profile-form.js`: 登入失敗訊息區分 assertion/internal 錯誤，建議用戶「關閉所有分頁後重新開啟」
  3. `firebase-service.js`: Custom Token 登入失敗區分伺服器不可用 vs assertion error
  4. `app.js`: unhandledrejection handler 攔截 Firebase assertion error 並記錄（原先被過濾掉）
- **教訓**：`enablePersistence` 的 `.catch()` 只能捕獲 Promise reject，SDK 同步拋出的 assertion error 需要外層 try-catch

### 2026-03-20 — boot-dependency-map 優化 8 步全部實作完成
- **問題**：首次訪問/4G 中階手機載入慢、SW cache 永遠為空、快取層級聯失敗風險
- **修復**（8 個獨立 commit，版本 20260320u→aa）：
  - Step 1: SW cache.addAll → 逐個快取（單檔失敗不阻塞）
  - Step 2: pagehide 持久化（已提前完成）
  - Step 3: init() ?.() 防護 + try-catch 錯誤邊界
  - Step 4: FirebaseService.init() 防重入鎖
  - Step 5: onSnapshot 重連加 jitter 防驚群
  - Step 6: renderHotEvents 空列表顯示 loading 提示
  - Step 7: page-loader fetch 加 response.ok 檢查
  - Step 8: localStorage quota exceeded 淘汰 newsArticles/gameConfigs
- **教訓**：每層快取的失敗處理都要獨立加固，打斷級聯雪崩鏈

### 2026-03-20 — 首次登入地區選擇改為自動完成元件
- **問題**：地區搜尋欄與選單分開，用戶體驗差（輸入後看不到篩選結果）
- **修復**：將 input + select 改為 input + dropdown 自動完成；新增 `onRegionInput`、`onRegionFocus`、`onRegionBlur`、`_selectRegion`、`_renderRegionDropdown`、`_getFilteredRegions`；`saveFirstLoginProfile` 改讀 `fl-region-input`
- **教訓**：HTML 事件綁定與 JS 方法需同步新增，否則會造成無聲錯誤

### 2026-03-20 — 首頁活動卡片候補人數不正確（hasSource 誤判 + 缺少首頁重繪）
- **問題**：少數用戶在首頁看到活動卡片上的候補人數與實際不符
- **原因 1**：`_getEventParticipantStats()` 的 `hasSource` 只要快取有任何一筆 registration 就為 true，但一般用戶快取僅含自己的報名紀錄（非全量），導致混合計數與 event 投影欄位不一致
- **原因 2**：用戶瀏覽活動詳情頁後，registrations 快取殘留；回到首頁後 listener 停止但過期快取仍被讀取
- **原因 3**：registrations listener 的 onSnapshot 回調缺少 `page-home` → `renderHotEvents()` 觸發
- **修復**：(1) `_getEventParticipantStats` 僅在 admin 且 listener 存活時信任 registration 計數，否則使用 event.current/event.waitlist (2) registrations onSnapshot 加入首頁重繪
- **教訓**：`hasSource` 模式在快取可能不完整的場景下不可靠；首頁卡片計數應一律使用 event 文件投影欄位

### 2026-03-20 — 正取名單排序不一致 + 候補人數跨裝置差異
- **問題 1**：不同手機看到的正取報名名單排序不同，重新整理也一樣
- **原因**：`_buildConfirmedParticipantSummary()` 沒有對 confirmedRegs 做排序，順序取決於各手機 Firestore 快取的文件 ID 字典序
- **問題 2**：不同手機看到的候補人數有差異
- **原因**：一般用戶 registrations 快取只有自己的紀錄，`_getEventWaitlistDisplayCount()` 從不完整快取計算出錯誤數量
- **修復**：(1) confirmedRegs 加排序（registeredAt → promotionOrder → docId），與候補名單排序邏輯一致 (2) 候補人數優先使用 event.waitlist（由 _rebuildOccupancy 寫入），fallback 才用 Set 計算
- **教訓**：任何面向用戶的名單顯示都必須有明確排序，不能依賴快取陣列順序；跨角色可見範圍不同的資料，數量顯示應使用 event 文件上的權威數字

### [永久] 2026-03-20 — 候補邏輯四項修復（容量變更 / 同行者取消）
- **問題 1**：容量減少降級正取者時，activityRecord 未從 `registered` 更新為 `waitlisted`，導致活動紀錄顯示錯誤
- **問題 2**：`cancelCompanionRegistrations` 在 `batch.commit()` 前就修改快取，commit 失敗時快取已汙染
- **問題 3**：`cancelCompanionRegistrations` 用本地快取判斷候補遞補，快取過時可能遞補錯人
- **問題 4**：`_adjustWaitlistOnCapacityChange` 用本地快取而非 Firestore 查詢
- **修復**：
  - `event-create-waitlist.js`：降級迴圈新增 activityRecord 同步更新（local + Firestore batch）
  - `event-create-waitlist.js`：函式開頭新增 Firestore 查詢刷新快取（含 Timestamp 轉換）
  - `firebase-crud.js`：`cancelCompanionRegistrations` 改為 5 階段模式（收集 → Firestore 查詢 → 模擬 → batch 寫入 → commit 後才更新快取），與 `cancelRegistration` 結構對齊
  - `firebase-crud.js`：新增 `_docId` 防禦（回填後仍缺失則排除 + warn）、Timestamp 轉 ISO 確保遞補排序正確
- **教訓**：所有改變 registration 狀態的路徑，必須同步更新 activityRecord；Firestore 查詢結果的 Timestamp 需轉換後再排序

### 2026-03-19 — 外部活動中繼卡片加一鍵分享按鈕
- **功能**：中繼卡片右下角新增圓形分享 FAB 按鈕（箭頭圖示），點擊呼叫 `shareExternalEvent()`
- **修改**：`event-external-transit.js`（加 shareHtml + 事件綁定）、`activity.css`（`.ext-transit-share-fab` 樣式）

### [永久] 2026-03-19 — cancelRegistration 快取提前寫入導致假成功
- **問題**：用戶取消報名時，UI 顯示「已取消」+ 發送站內信，但資料庫未更新。一定機率出現
- **原因**：`cancelRegistration()` 在 `batch.commit()` 之前就修改了本地快取（`reg.status = 'cancelled'`），若 commit 失敗（網路延遲、文件不存在），快取已汙染，呼叫端以為成功
- **修復**：改為「先計算投影（用 simRegs 副本），commit 成功後才寫入本地快取」。batch.commit() 是唯一的成功判定點
- **教訓**：所有 Firestore 寫入操作，本地快取必須在 `await commit()` 之後才能修改。這是報名系統的核心安全規則

### 2026-03-19 — 外部活動中繼卡片 + YouTube 嵌入
- **問題**：外部活動分享後直接跳轉第三方，站點零曝光
- **修復**：新增 `event-external-transit.js`，外部活動改為顯示中繼卡片（活動資訊 + YouTube 嵌入播放或跳轉按鈕），不再直接 `location.href` 跳走
- **影響範圍**：`event-detail.js`、`event-list-timeline.js`、`event-list-home.js` 三處 redirect 改為呼叫 `showExternalTransitCard()`
- **教訓**：transit 模組須在 index.html 中早於 event-list-home.js 載入（boot script），因首頁熱門活動卡片點擊也需要呼叫

### 2026-03-19 — 下載APP 按鈕光激繞圈效果修正
- **問題**：抽屜「下載APP」按鈕只有 box-shadow 呼吸光暈，缺少 conic-gradient 旋轉光跡邊框
- **原因**：原始 CSS 只定義了 `pwa-glow`（box-shadow pulse），未加入 `::before` 旋轉光跡
- **修復**：`css/layout.css` — 加入 `::before`（conic-gradient 旋轉邊框）+ `::after`（內填色遮蓋），`pwa-border-spin` 動畫 2s 線性無限循環
- **教訓**：小按鈕的旋轉光跡需 `position: relative; z-index: 0; overflow: visible` + `::before` z-index: -1 配合 `::after` 填色

### [永久] 2026-03-19 — Cloudflare CDN 快取導致 JS 更新未生效
- **問題**：更新 `CACHE_VERSION` 和 `?v=` 參數後，用戶瀏覽器仍載入舊版 JS（`config.js` 顯示舊版本號），即使用無痕模式也一樣
- **原因**：Cloudflare CDN 邊緣快取會快取靜態資源（JS/CSS），且可能忽略 query string 差異，導致 `config.js?v=20260319p` 仍回傳舊版內容。更新 `CACHE_VERSION` 和 `sw.js CACHE_NAME` 都無法繞過 CDN 層快取
- **修復**：登入 Cloudflare Dashboard → Caching → Configuration → **Purge Everything**，清除所有 CDN 邊緣快取
- **教訓**：
  1. 每次部署含關鍵 JS 變更後，若行為未如預期，優先檢查 CDN 快取（不只是瀏覽器快取和 SW 快取）
  2. 四層快取排查順序：**Cloudflare CDN → LINE WebView → Service Worker → 瀏覽器快取**
  3. 驗證方式：讓用戶在 Console 執行 `alert(CACHE_VERSION)` 比對版本號，可快速定位是哪一層快取
  4. 未來重大 JS 變更部署後，應主動到 Cloudflare Dashboard 執行 Purge Everything
  5. **LINE WebView 快取特別頑固**：關閉分頁甚至退出 APP 都不一定清除，通常需等數小時～24 小時自動過期。用戶手動清除路徑：LINE → 設定 → 聊天 → 刪除資料 → 勾選「快取」→ 刪除。架構上確保 index.html 不被快取（Cloudflare Pages 預設行為），靠 `?v=CACHE_VERSION` 讓後續 JS/CSS 自動更新

### 2026-03-19 — 活動分享 OG 中繼頁（動態封面圖預覽）
- **需求**：LINE 分享活動連結時顯示活動封面圖作為 OG 預覽縮圖
- **實作**：新增 Cloud Function `eventShareOg`（asia-east1）讀取 Firestore 活動資料，產生含 og:image 的 HTML 中繼頁，meta refresh 跳轉至 Mini App URL
- **範圍**：functions/index.js（新增 eventShareOg + helpers）、_worker.js（新增 /event-share 路由 + 重構共用 handleOgShare）、event-share-builders.js（新增 _buildEventShareOgUrl）、event-share.js（altText 改用 OG URL）
- **風險控管**：_worker.js 重構將 team-share 專用邏輯抽為共用 handleOgShare，行為完全等同；既有 /team-share 路由、一般頁面路由不受影響
- **部署注意**：Cloud Function 需另外執行 `firebase deploy --only functions:eventShareOg`

### 2026-03-19 — 分享連結遷移至 LINE Mini App URL
- **變更**：所有分享 URL 從 `liff.line.me/2009084941-zgn7tQOp` 改為 `miniapp.line.me/2009525300-AuPGQ0sh`
- **範圍**：config.js（新增 MINI_APP_ID + MINI_APP_BASE_URL）、event-share-builders.js、team-share.js、tournament-share.js、profile-share.js、team-detail-members.js、role.js、index.html 中繼跳轉、functions/index.js OG redirect
- **向後相容**：舊 LIFF URL 仍可運作（LIFF App 未下架）；舊 toosterx.com 中繼跳轉保留並改導向 Mini App URL；所有舊 URL 以 `// [備用]` 註解保留
- **教訓**：分享 URL 是散佈在多個模組的硬編碼，遷移時必須全面搜尋 `liff.line.me` 和 `toosterx.com` 確保無遺漏

### 2026-03-19 — 抽屜字型放大按鈕
- **需求**：在左側抽屜頭像區右上方加字型放大按鈕，三段切換（小 15px / 中 16.5px / 大 18px）
- **實作**：`index.html` 抽屜 header 加按鈕 + body 開頭加早期 restore 腳本；`css/layout.css` 加 `.drawer-font-btn` 樣式 + `.drawer-name` overflow 保護；`js/core/theme.js` 加 `cycleFontSize` / `initFontSize`；`app.js` init 時呼叫 `initFontSize`
- **教訓**：最大 1.2x（18px）是安全上限，超過會導致抽屜名稱溢出、徽章變形、表單擁擠

### 2026-03-18 — LIFF bounce 外部瀏覽器取消跳轉後無限迴圈
- **問題**：外部瀏覽器（如 Safari）開啟 `toosterx.com/?event=xxx` 後跳轉 `liff.line.me/...`，若用戶拒絕開啟 LINE App，liff.line.me 會 fallback 回 toosterx.com，造成無限迴圈
- **原因**：UA 偵測只防了「已在 LINE 內」的情境，未防「外部瀏覽器被 liff.line.me 彈回」的情境
- **修復**：`index.html` 跳轉腳本加 `sessionStorage('_liffBounce')` 單次保護——跳轉前設旗標，被彈回時偵測到旗標即不再跳轉，讓頁面正常載入
- **教訓**：sessionStorage 在同一分頁內可靠（之前失敗是因為 LIFF webview 開新 context），此場景正好適用

### 2026-03-18 — 活動管理應收/實收費用公式修正
- **問題**：應收把「未報名」人數也算入，導致金額偏高；實收計算所有簽退記錄數（含重複），導致金額翻倍
- **原因**：應收公式多算了未報名人數；實收用 `.filter().length` 計算 checkout 記錄數而非唯一人次，同行者 checkout 記錄的 uid 與主報名者相同導致重複計數
- **修復**：`js/modules/event/event-manage.js` 兩處（列表卡片 + 詳情 `_renderDetailFeeSummary`）：應收改為 `fee * confirmedCount`（僅報名名單）；實收改為用 `uid + companionId` 組合鍵去重，只計算唯一人次中屬於正取或未報名者的 checkout 人數 × fee
- **教訓**：同行者 checkout 記錄的 uid 欄位存的是主報名者 uid（不是 companionId），必須用 `uid|companionId` 作為唯一人次鍵才能正確計數

### 2026-03-18 — 私密活動首頁卡片「不公開」印章
- **需求**：私密活動在首頁卡片圖片上疊加紅色圓形「不公開」印章
- **實作**：`css/home.css` 新增 `.stamp-circle` + `.h-card-img .stamp-circle` 定位樣式；`js/modules/event/event-list.js` 在 `.h-card-img` 內依 `e.privateEvent` 條件插入 `<span class="stamp-circle">不公開</span>`
- **教訓**：stamp 使用 `position:absolute` + `mix-blend-mode:multiply`，需確保父容器 `.h-card-img` 有 `position:relative`（已有）

### 2026-03-18 — 首次開站或久未操作時報名卡在「報名中」
- **問題**：首次開站或長時間未操作後，點「立即報名」會卡在「報名中...」無回應，刷新後才正常
- **原因**：Production 路徑在鎖定按鈕後直接呼叫 `registerForEvent`，但 Firebase SDK/Auth 尚未完成初始化（`ensureCloudReady` 未完成），`_ensureAuth` 等待 persistence restore + CF cold start 可能超過 15s timeout
- **修復**：在 `handleSignup`/`handleCancelSignup`/`_confirmCompanionRegister` 鎖定按鈕之前，先檢查 `_cloudReady`；若未就緒則 toast 提示並觸發 `ensureCloudReady`，不鎖按鈕
- **教訓**：所有需要 Firestore 寫入的 UI 操作，必須先確認 cloud init 已完成，不能依賴快取中的用戶資料假設 SDK 已就緒

### 2026-03-18 — [永久] 首次造訪或快取過期時卡在空框架
- **問題**：手機開網址時只看到框架沒有內容，要多刷新一兩次才正常
- **原因**：Loading overlay 在 Phase 3 後無條件移除，不管是否有資料渲染；首頁被排除在 cloud 依賴外，完全仰賴 localStorage 快取（TTL 2h）；CDN SDK 延遲到 Phase 4 才下載；Firestore WS 超時 15 秒
- **修復**：
  - overlay 改為「有內容才收」：Phase 3 檢查 events 快取，無資料則保留 overlay 到 Phase 4 完成
  - CDN SDK 加 `<link rel="preload">` 搶跑下載
  - Firestore init timeout 15s → 6s
  - SW CACHE_NAME 更新
- **教訓**：loading overlay 的移除必須以「用戶可見內容已就緒」為判斷依據，不能以「框架初始化完成」為依據。首頁依賴 localStorage 快取的架構下，必須有 fallback loading 狀態

### 2026-03-18 — [永久] LIFF bounce redirect 無限迴圈
- **問題**：`toosterx.com/?event=xxx` → `liff.line.me/...` → LIFF 開回 `toosterx.com/?event=xxx` → 再次跳轉 → 無限迴圈
- **原因**：防迴圈用 sessionStorage/localStorage 設 flag，但 LIFF 在隔離 webview 中開啟 endpoint URL 時兩者都是空的
- **修復**：改用 User Agent 偵測（`/Line\//i.test(navigator.userAgent)`），已在 LINE 瀏覽器內則不跳轉，不依賴任何 storage
- **教訓**：LINE LIFF webview 是完全隔離的瀏覽環境，sessionStorage 和 localStorage 都不跨 webview。跨頁面狀態傳遞不能依賴 client storage，應使用環境偵測（UA）或 URL 參數

### 2026-03-18 — 新增私密活動功能
- **需求**：活動建立時可設為私密，私密活動不顯示在列表中，僅能透過分享連結查看
- **實作**：建立表單新增「私密活動」開關（性別限定下方），`_getVisibleEvents()` 過濾 privateEvent（建立者/委託人/管理員除外），詳情頁顯示私密標籤，deeplink 直接存取不受影響
- **檔案**：activity.html、event-create-options.js、event-create.js、event-manage-lifecycle.js、event-create-template.js、event-list-helpers.js、event-detail.js

### 2026-03-18 — 圖片裁切功能在多數頁面靜默失效
- **問題**：上傳圖片的裁切功能消失，選圖後直接顯示預覽而不彈出裁切視窗
- **原因**：3/9 效能優化（commit 9b70774）將 `image-cropper.js` 從 `index.html` 移至 ScriptLoader 動態載入，但只加到 `achievement` 和 `profile` 兩個群組；其餘頁面（活動建立、賽事、廣告、俱樂部等）的 `showImageCropper` 為 undefined，條件 `aspectRatio && this.showImageCropper` 靜默 fallthrough
- **修復**：將 `image-cropper.js` 加回 `index.html`（在 `image-upload.js` 之前），並從 ScriptLoader 群組中移除重複項
- **教訓**：搬移全域使用的模組到動態載入時，必須檢查所有呼叫點是否都在對應的 ScriptLoader 群組內

### 2026-03-18 — LINE 社群分享連結被自動回收
- **問題**：活動/球隊/賽事/名片分享到 LINE OpenChat 社群後，訊息被自動回收
- **原因**：分享的純文字 altText 中包含 `liff.line.me/` URL，LINE OpenChat 會自動回收含此域名的訊息
- **修復**：
  - 新增 `_buildShareUrl(paramKey, paramValue)` 產生 `toosterx.com/?event=xxx` 格式的中繼 URL（event-share-builders.js）
  - 所有 share 模組的 altText 改用 `shareUrl`（不含 liff.line.me），Flex Message 按鈕仍用 `liffUrl`
  - index.html 新增 LIFF bounce redirect script：偵測 deep link 參數後自動跳轉至 `liff.line.me/...`，sessionStorage 防無限迴圈
  - 影響檔案：index.html、event-share-builders.js、event-share.js、team-share.js、tournament-share.js、profile-share.js
- **教訓**：LINE OpenChat 會回收含 `liff.line.me/` 的訊息，社群分享文字必須使用自有域名 URL，再透過前端 redirect 導向 LIFF

### 2026-03-18 — 刷新瀏覽器後點頁籤缺少加載提示
- **問題**：刷新瀏覽器後點擊底部功能頁籤（活動、俱樂部、我的等），因 stale-first 快取策略跳過了加載提示，但第一次切頁仍有延遲，用戶容易以為按鈕壞掉
- **原因**：`showPage` 中 `shouldShowRouteLoading` 條件含 `!canUseStale`，stale-first 路徑完全不顯示 status-hint 加載提示
- **修復**：移除 `!canUseStale` 條件，stale 導航使用 500ms 延遲（`delayMs: canUseStale ? 500 : 220`），500ms 內完成則不顯示，超過才跳出提示
- **教訓**：stale-first 雖然能從快取快速渲染，但首次載入仍需等腳本下載，應保留延遲加載提示作為用戶反饋

### 2026-03-18 — Auto-EXP 發放後畫面 EXP 數字未更新
- **問題**：觸發自動 EXP（報名/簽退等）後，個人頁面與頂部的 EXP 數字不會增加
- **原因**：`adjustUserExp()` 只更新 `adminUsers` 快取中的 user 物件，但 `getCurrentUser()` 回傳的是 `FirebaseService._cache.currentUser`——兩者是不同的物件參照，EXP 變更沒有同步到 currentUser；且 `_grantAutoExp` 執行後沒有觸發 UI 重新渲染
- **修復**：(1) `api-service.js` 的 `adjustUserExp` / `adjustUserExpAsync` 在更新 adminUsers 後同步 currentUser.exp（含 rollback 路徑）(2) `auto-exp.js` 的 `_grantAutoExp` 在同步 currentUser 後呼叫 `renderProfileData()` / `renderPersonalDashboard()` 即時刷新 UI
- **教訓**：`adminUsers` 與 `currentUser` 是不同物件，任何修改 user.exp 的路徑都必須兩邊同步

### 2026-03-18 — 賽事系統二次 QA 審計修復
- **問題**：(1) 建立/編輯賽事無 regStart ≤ regEnd 驗證，可設無效報名期間 (2) 名額已滿時若用戶有 pending 申請，按鈕顯示「審核中」給人假希望
- **修復**：
  - `handleCreateTournament` 與 `handleSaveEditTournament` 加報名時間先後驗證
  - `renderRegisterButton` 改為名額已滿時優先顯示「名額已滿」，僅用戶已核准時顯示「已通過審核」
- **檔案**：tournament-manage.js、tournament-manage-edit.js、tournament-friendly-detail-view.js

### 2026-03-18 — 賽事系統全面審計與修復
- **問題**：5 個邏輯/安全瑕疵 — state null 存取崩潰、creatorUid 可為 'demo-user'、delegateUids 含空字串、roster 成員重複、刪除賽事不清理 subcollections
- **修復**：
  - `registerTournament` 加 state null guard 防止 TypeError（tournament-friendly-detail.js）
  - `handleCreateTournament` creatorUid 空字串 + production 強制登入（tournament-manage.js）
  - delegateUids 改用 trim + length 過濾（tournament-manage.js、tournament-manage-edit.js）
  - roster 載入加 Set dedup 防重複成員（tournament-friendly-roster.js）
  - `deleteTournament` 先清理 applications/entries/members subcollections 再刪主文件（api-service.js）
- **教訓**：Firestore 刪除主文件不會 cascade 刪除 subcollections，必須手動清理

### 2026-03-18 — EXP 系統自動化測試 + 死代碼清理
- **變更**：新增 `tests/unit/exp-system.test.js`（42 個測試），覆蓋 auto-exp 規則載入、fallback chain、金額查詢、uid null guard、樂觀更新 + rollback、requestId 生成、grant 守衛、log 建構
- **修復**：移除 `firebase-crud.js` 中的 `updateUserPoints` 死函式（無權限檢查、繞過 CF 直接寫 Firestore，為安全風險）
- **檔案**：tests/unit/exp-system.test.js（新增）、js/firebase-crud.js（移除死代碼）

### 2026-03-18 — [永久] EXP 系統全面修復（5 階段）
- **問題**：候補遞補不發 EXP、手動確認出席不發 EXP、CF 無冪等性、auto-EXP 規則只存 localStorage、CF 失敗時快取不 rollback、3 個未實作規則佔空間
- **修復**：
  - 候補遞補補發 register_activity EXP（event-detail-signup.js）
  - 手動確認簽退補發 complete_activity EXP（event-manage-confirm.js）
  - 掃碼簽退後觸發成就重評（scan-process.js）
  - adjustUserExp/adjustUserExpAsync 加 uid null 守衛 + CF 失敗 rollback
  - CF adjustExp 加 requestId 冪等性保護（_expDedupe collection, create 原子操作）
  - Auto-EXP 規則持久化到 Firestore siteConfig/autoExpRules + localStorage fallback
  - 移除 submit_review/join_team/post_team_feed 3 個未實作規則
- **檔案**：event-detail-signup.js、event-manage-confirm.js、scan-process.js、api-service.js、auto-exp.js、app.js、functions/index.js、firestore.rules
- **教訓**：EXP 相關改動必須同時檢查所有發放路徑（報名/取消/掃碼/手動確認/遞補），避免路徑遺漏

### 2026-03-18 — 活動詳情頁按鈕佈局重構 + 一鍵加入行事曆
- **變更**：報名按鈕全寬置頂、工具列（聯繫主辦/分享活動/加入行事曆/現場簽到）純文字按鈕排列於下方；新增 event-detail-calendar.js 模組，iOS 用 data URI、Android/桌面用 blob download 觸發系統行事曆
- **修復**：iOS blob: URL 靜默失敗改為 data:text/calendar URI；報名按鈕高度 +15%（padding .55→.63rem）
- **檔案**：css/activity.css、js/modules/event/event-detail.js、js/modules/event/event-detail-calendar.js、js/core/script-loader.js

### 2026-03-18 — [永久] 站內信與 LINE 推播通知完全失效（Notification Fix）
- **問題**：活動報名、候補遞補、角色變更等自動通知全部停發（站內信 + LINE 推播），用戶收不到任何通知
- **原因**：`_deliverMessageToInbox` 定義在 `message-admin.js`，屬於 ScriptLoader `messageAdmin` 群組，僅在管理後台頁面載入。通知觸發點（活動頁面等）從未載入此模組，導致 `_deliverMessageWithLinePush` 內的 guard `typeof this._deliverMessageToInbox !== 'function'` 始終為 true，直接 return 跳過所有通知
- **修復**：
  - 將 `_deliverMessageToInbox` 及其 dedupe 輔助函式（`_buildInboxDeliveryDedupeKey`、`_claimRecentInboxDeliveryKey`、`_releaseRecentInboxDeliveryKey`、`_recentInboxDeliveryCache`）從 `message-admin.js` 搬到 `message-notify.js`（始終載入）
  - 移除 `_deliverMessageWithLinePush` 中的 `typeof this._deliverMessageToInbox !== 'function'` guard（函式現在永遠存在）
  - 搬入版本使用 `renderMessageList?.()` / `updateNotifBadge?.()` optional chaining，確保非訊息頁面不報錯
  - 從 `message-admin.js` 移除重複定義，`_processScheduledMessages` 透過 App 物件仍可正常呼叫
- **教訓**：依賴 ScriptLoader 延遲載入的函式不能作為核心通知路徑的必要條件。凡是「任何頁面都可能觸發」的功能，其完整依賴鏈必須在主載入階段就就緒，不可依賴按需載入的模組群組

### 2026-03-18 — [永久] _flipAnimating 卡死導致活動卡片無法點擊（F1+F2+F3+F4）
- **問題**：從分享連結進入首頁後，點活動卡片卡死進不去，必須重整瀏覽器才恢復
- **原因**：`_flipAnimating` 旗標在報名/取消的翻牌動畫期間設為 `true`，但多種場景下不會被重置 — (1) 報名中途離開頁面，catch 區塊未執行；(2) Firestore 掛住 await 永不 resolve；(3) `glowWrap` DOM 被 onSnapshot 替換後走不到 reset 行。此旗標一旦卡住，`showEventDetail` 入口的 `if (this._flipAnimating) return` 會擋住**所有**後續活動卡片點擊
- **修復**：
  - F1：`showEventDetail` 加 5 秒安全重置（`_flipAnimatingAt` 時間戳判斷），超時強制解鎖
  - F2：`handleSignup` 改用 `finally` 區塊確保 flag 重置，成功路徑在 `showEventDetail` 之前先解鎖
  - F3：報名/取消的 Firestore 操作加 15 秒 `Promise.race` timeout，防止永久掛住
  - F4：`_cleanupBeforePageSwitch` 離開活動詳情頁時強制清除 flag
- **教訓**：任何「全域 boolean 鎖」都必須有 (1) finally 保底重置、(2) 超時自動解鎖、(3) 頁面切換清理三層防線，缺一不可。特別是 async 流程中的鎖，任何 await 中斷、DOM 消失、網路掛住都會導致鎖孤立

### 2026-03-18 — [永久] 跨裝置報名狀態不同步修復（RC1+RC3+RC4+RC5+RC8）
- **問題**：兩台裝置看到的報名/取消狀態不一致，裝置 A 報名後裝置 B 仍顯示未報名
- **原因**：多層快取同步空窗疊加 — (1) 無 visibilitychange 刷新，切回分頁不更新；(2) localStorage TTL 120 分鐘內只讀快取不查 Firestore；(3) onSnapshot 斷線靜默失敗不重連；(4) localStorage 無 UID 隔離，換帳號讀到前用戶資料
- **修復**：
  - RC3：新增 `visibilitychange` 監聽，頁面切回時自動做一次性 Firestore 查詢刷新 registrations（1 秒防抖）
  - RC4：`onSnapshot` 錯誤回調改為自動重連（exponential backoff 1s→30s，上限 5 次），成功時重置計數
  - RC1：Auth 就緒後立即背景 Firestore 查詢刷新 registrations（stale-while-revalidate，不阻塞 UI）
  - RC8：localStorage key 加 UID 前綴隔離（`shub_c_{uid}_{collection}`），logout 時清除所有 `shub_c_*` / `shub_ts_*`
  - RC5：已有覆蓋（onSnapshot callback 已觸發 showEventDetail 重渲染）
  - QA 修復：reconnect timer ID 存儲 + destroy 清理、visibilitychange listener 可移除、並行 revalidation 競爭防護、legacy fallback 後恢復 UID 前綴
- **教訓**：Cache-first 架構必須有「切回刷新」和「背景驗證」機制，不能只靠 onSnapshot 即時同步（listener 有頁面範圍限制且可能斷線）。localStorage 快取必須有用戶隔離，否則換帳號會讀到前用戶資料

### 2026-03-18 — LINE Notify 綁定修復：外部/PC 瀏覽器無法綁定（P1）
- **問題**：從個人資訊頁或報名後彈窗綁定 LINE 推播時，外部手機瀏覽器和 PC 瀏覽器因 `liff.isLoggedIn()` 檢查而被擋住，無法完成綁定
- **原因**：`profile-data.js` 的 `bindLineNotify()` 有 LIFF 登入狀態檢查（`typeof liff === 'undefined' || !liff.isLoggedIn()`），但外部/PC 瀏覽器不會載入 LIFF SDK 或不會有 LIFF session
- **修復**：移除 LIFF 登入檢查，改為僅依賴 Firebase Auth 登入狀態（`ApiService.getCurrentUser()`）。LINE 推播的安全性由 Cloud Function `processLinePushQueue` 的自動解綁機制保障（偵測無效接收者時自動設 `lineNotify.bound = false`）
- **教訓**：LINE Notify 綁定只是在用戶文件上標記 bound=true + 引導加好友，不需要 LIFF session；實際推播由 Cloud Function 執行，無效接收者會自動解綁，不會造成安全問題

### 2026-03-18 — 取消報名速度優化 + _docId 防禦修復（B1+C1）
- **問題**：取消報名流程有兩個問題：(1) `_syncMyEventRegistrations` 前置查詢多花 200-500ms，而 `cancelRegistration` 內部已查詢相同資料；(2) 若快取中 `_docId` 缺失，`cancelRegistration` 的 `doc(undefined)` 會 crash
- **原因**：歷史上 `_syncMyEventRegistrations` 是為了補救快取缺 `_docId` 而加的，但 `cancelRegistration` 內部已查詢 firestoreRegs 卻沒有回填 `_docId` 給快取中的 reg
- **修復**：
  - `cancelRegistration` 中 fsReg 找到後自動回填 `reg._docId`（C1），且 `_docId` 防禦檢查移到快取變更之前，防止 throw 時汙染快取
  - `handleCancelSignup` 移除 `_syncMyEventRegistrations` 條件查詢（B1），且 `if (reg && reg._docId)` 門檻改為 `if (reg)`，讓 cancelRegistration 內部自行回填
- **教訓**：[永久] 移除前置資料修復（如 _syncMyEventRegistrations）時，必須確認下游函式的入口門檻不依賴被移除的前置修復結果。防禦性 throw 必須在狀態變更之前執行，否則會汙染快取

### 2026-03-17 — 修正瀏覽器重整後活動詳情頁空白模板閃現
- **問題**：在活動詳情頁重新整理瀏覽器後，deep link poller 觸發 showEventDetail()，先呼叫 showPage() 顯示空白模板（"活動圖片 800 × 300"），再渲染活動資料。若渲染失敗或競態條件觸發，用戶會看到空白頁面
- **原因**：showEventDetail() 在 line 221 先 await showPage('page-activity-detail') 使頁面可見，之後才在 line 240+ 渲染內容。showPage 與 render 之間存在競態窗口
- **修復**：重構 showEventDetail() 流程為「先確保 HTML/Script 載入 → 先渲染內容到隱藏 DOM → 最後才 showPage 切換顯示」。使用 PageLoader.ensurePage + ScriptLoader.ensureForPage 取代直接 showPage，所有內容渲染完成後才呼叫 showPage
- **教訓**：detail 頁面渲染應遵循「render-before-show」模式，避免空白模板閃現

### 2026-03-17 — [永久] UID 欄位一致性修正：attendanceRecords/activityRecords uid 欄位歷史資料不一致
- **問題**：部分 attendanceRecords 和 activityRecords 的 uid 欄位存的是 displayName（如「小白」）而非 LINE userId（如 `U196b...`），導致跨集合 JOIN 比對失敗，11+ 處代碼需要 nameToUid 補救邏輯
- **原因**：`event-manage-confirm.js:53` — `_confirmAllAttendance()` 從 `events.participants[]`（displayName 陣列）解析用戶時，若 adminUsers 查找失敗，直接用 displayName 作為 uid 寫入
- **修復**：
  - Phase 1（止血）：修改 `_confirmAllAttendance` 未能解析 UID 時跳過而非寫入 displayName；`_buildConfirmedParticipantSummary` 加 `uidResolved` 標記
  - Phase 2（治療）：新增 Cloud Function `migrateUidFields`（Admin SDK 繞過安全規則）批次修正 92 筆歷史資料，含 dry-run + 備份 + 同名交叉比對 registrations
  - Phase 4（清理）：移除 `_buildRawNoShowCountByUid`、`_getNoShowDetailsByUid`、`getParticipantAttendanceStats`、`_calcScanStats`、`ensureUserStatsLoaded` 中的 nameToUid/nameSet fallback 代碼，簡化架構
  - 前端觸發：`data-sync.js` 新增 `uidMigration` 操作，admin-system.html 新增「⑤ UID 欄位修正」按鈕
- **教訓**：寫入 Firestore 的 uid 欄位必須是 LINE userId，禁止用 displayName 代替；Firestore 安全規則禁止更新 uid 欄位，歷史資料修正必須用 Cloud Function Admin SDK；遷移完成後應清除 fallback 代碼避免技術債累積

### 2026-03-17 — [永久] 放鴿子計算 _userStatsCache 汙染：切換用戶導致其他人放鴿子數跳動
- **問題**：查看用戶 A 時放鴿子 = 0（正確），查看用戶 B 後 A 的放鴿子變成 1（錯誤）
- **原因**：`_buildRawNoShowCountByUid` 是全域函式（計算所有人），但合併了 `_userStatsCache`（只有當前查看的那一個用戶的簽到紀錄）。切換用戶後 `_userStatsCache` 被覆蓋，原先用戶的補充簽到紀錄消失，導致被誤判為放鴿子
- **修復**：移除 `_buildRawNoShowCountByUid` 和 `_getNoShowDetailsByUid` 中的 `_userStatsCache` 合併邏輯，全域快取已移除 limit 不再需要補充
- **教訓**：全域統計函式（計算所有人）絕對不能依賴單一用戶的快取資料作為補充來源，否則會因為切換用戶而汙染其他人的統計結果

### 2026-03-17 — [永久] firebase-service.js 全域快取 limit 移除（attendanceRecords / registrations / activityRecords）
- **問題**：全域快取 attendanceRecords limit 500、registrations limit 500（admin）/ 200（user），導致超過限制的紀錄被截斷，放鴿子計算漏掉簽到紀錄而誤判
- **修復**：移除三處 limit — `_getRegistrationsListenerQuery` 移除 limit(500)/limit(200)、`_startAttendanceRecordsListener` 移除 limit(500)、`_buildCollectionQuery` 對 attendanceRecords/registrations/activityRecords 不設 limit
- **教訓**：統計關鍵集合（attendanceRecords、registrations、activityRecords）不可設 limit，否則資料截斷會導致所有依賴這些集合的統計計算出錯

### 2026-03-17 — [永久] 放鴿子計算用全域快取（limit 200）vs 出席率用 userStatsCache（無 limit）導致不一致
- **問題**：用戶出席率 100% 但放鴿子顯示 1
- **原因**：`_buildRawNoShowCountByUid` 用 `ApiService.getAttendanceRecords()`（全域快取，limit 200），`_calcScanStats` 用 `getUserAttendanceRecords(uid)`（_userStatsCache，Firestore 直查無 limit）。如果用戶的簽到紀錄超過全域快取限制，放鴿子計算就會漏掉簽到紀錄而誤判
- **修復**：`_buildRawNoShowCountByUid` 和 `_getNoShowDetailsByUid` 合併全域快取 + _userStatsCache，用 _docId 去重
- **教訓**：所有統計計算必須使用相同的資料來源；全域快取有 limit 截斷風險，涉及個人統計時必須優先使用 user-specific cache

### 2026-03-17 — [永久] stats.js 缺少 displayName fallback 導致出席率與放鴿子不一致
- **問題**：用戶出席率 100% 但放鴿子次數 > 0，兩個數字矛盾
- **原因**：`stats.js` 的 `getParticipantAttendanceStats` 比對 `attendanceRecords.uid` 時用嚴格匹配（`uid === safeUid`），但歷史資料的 `attendanceRecords.uid` 可能存的是顯示名稱（如「小白」）而非 LINE userId。`_buildRawNoShowCountByUid` 和 `evaluator.js` 都有 nameToUid/nameSet fallback，唯獨 stats.js 沒有，造成同一筆簽到紀錄在一個路徑被認定有出席、另一個路徑被忽略
- **修復**：`getParticipantAttendanceStats` 新增 `nameSet` 參數，attendanceRecords UID 比對加入 displayName fallback
- **教訓**：所有涉及 attendanceRecords.uid 比對的函數，都必須包含 displayName fallback（這是 CLAUDE.md 統計系統保護規則的重點）

### 2026-03-17 — [永久] registrations 用 'confirmed' vs activityRecords 用 'registered' 混用導致統計歸零
- **問題**：修正 `'registered'` → `'confirmed'` 後，完成場次和出席率反而歸零
- **原因**：`_calcScanStats()` 把 `activityRecords`（status='registered'）當作 registrations 參數傳給 `getParticipantAttendanceStats()`，但該函數已改為只接受 `'confirmed'`
- **根本問題**：系統有兩個集合使用不同的 status 命名規則：
  - `registrations` 集合 → `'confirmed'` / `'waitlisted'`
  - `activityRecords` 集合 → `'registered'` / `'waitlisted'`
  - 兩者都會被餵進 `getParticipantAttendanceStats()` 作為 registrations 參數
- **修復**：`stats.js` 和 `evaluator.js` 的 status 過濾同時接受 `'confirmed'` 和 `'registered'`
- **教訓**：
  1. 修改 status 過濾時，必須追蹤該函數的**所有呼叫者**和它們傳入的資料來源
  2. `registrations` 和 `activityRecords` 是兩個獨立集合，status 欄位命名不同，但都會流入統計函數
  3. 任何改動 status 比對的地方，必須同時驗證兩條路徑

### 2026-03-17 — [永久] 成就系統 status 名稱不匹配導致所有報名相關成就失效
- **問題**：出席率 100% 仍無法獲得成就徽章，所有依賴 validRegistrations 的成就條件（出席率、完成場次、報名次數等）全部回傳 0
- **原因**：`evaluator.js` 和 `stats.js` 用 `status === 'registered'` 過濾報名紀錄，但 `firebase-crud.js` 實際寫入的是 `status: 'confirmed'`。系統中從未有任何地方寫入 `status: 'registered'`，導致 `validRegistrations` 永遠是空陣列
- **修復**：
  1. `evaluator.js` 3 處 `'registered'` → `'confirmed'`（優先度排序 + validRegistrations 過濾）
  2. `stats.js` 1 處 `'registered'` → `'confirmed'`（getParticipantAttendanceStats 過濾）
  3. `no_show_free` 改為計算放鴿子次數（原本計算連續出席數），加入 `reverseComparison`（current <= target）
  4. `registry.js` no_show_free defaultThreshold 10 → 0，加入 `reverseComparison: true`
- **教訓**：status 欄位值必須與 CRUD 層一致（`confirmed` / `waitlisted` / `cancelled` / `removed`），不可假設有 `registered` 狀態

### 2026-03-17 — [永久] 孤兒記錄清理 event.id vs Firestore doc.id 混淆導致全量誤刪
- **問題**：執行 `_syncOrphanCleanup` 後，registrations、activityRecords、attendanceRecords 三個集合被全部清空
- **原因**：修復快取問題時改用 `db.collection('events').get()`，但取有效 ID 時用了 `d.id`（Firestore 自動產生的 doc ID），而非 `d.data().id`（自訂的 event ID 如 `ce_xxx`）。由於 registrations 等集合的 `eventId` 欄位存的是自訂 ID，所以所有紀錄都被誤判為孤兒而刪除
- **修復**：改為同時收集 `d.data().id`（自訂 ID）和 `d.id`（Firestore doc ID），確保兩種 ID 都納入有效清單
- **資料恢復**：從 events.participants / waitlistNames 陣列重建 registrations、activityRecords、attendanceRecords（docs/rebuild-records.js）
- **教訓**：
  1. **event 有兩個 ID**：`doc.id`（Firestore 自動產生）≠ `doc.data().id`（程式自訂如 `ce_xxx`）。所有子集合（registrations/activityRecords/attendanceRecords）的 `eventId` 欄位存的是自訂 ID
  2. **任何批量刪除操作必須先做 dry-run**：先 log 要刪的數量和抽樣，確認後才實際刪除
  3. **Firestore 沒有自動備份**：此專案未啟用 PITR 或排程備份，刪除不可逆

### 2026-03-17 — [永久] 孤兒記錄清理用快取當有效清單導致誤刪
- **問題**：用戶出席率顯示 0% 而非 100%。診斷發現 7 個活動的 events 文件不存在，但 registrations/activityRecords/attendanceRecords 還在
- **原因**：`_syncOrphanCleanup` 用 `ApiService.getEvents()`（前端快取，limit 200+200）作為有效活動清單。若系統活動超過快取上限，正常活動被誤判為孤兒而清除相關資料，或活動本身被正常刪除但級聯清理不完整
- **修復**：改為 `db.collection('events').get()` 直接查 Firestore 完整集合，不再依賴快取
- **教訓**：任何「判斷資料是否有效」的邏輯，絕不可用有 limit 上限的前端快取作為唯一資料來源

### 2026-03-17 — [永久] _showPageStale 未等待 ensureForPage 導致動態函式呼叫崩潰
- **問題**：開啟個人頁面時報錯 `renderUserCard is not a function`
- **原因**：`_showPageStale()` 是同步函式，直接呼叫 `_activatePage()` → `_renderPageContent()`，未先 `await ScriptLoader.ensureForPage(pageId)` 載入動態腳本。`stale-first`/`stale-confirm` 策略的頁面（page-profile、page-activity-detail 等）會走此路徑
- **修復**：`_showPageStale` 改為 `async`，在 `_activatePage` 前加入 `ensureForPage`。呼叫端加 `await` 確保 `finally` 中的 `_endRouteLoading` 時序正確
- **教訓**：Phase 1 移除 eager script 後，不只要檢查 `_renderPageContent` 內的呼叫，還要檢查所有進入 `_renderPageContent` 的路徑是否都有 `ensureForPage` 前置。`_showPageStale` 是唯一沒有的路徑

### 2026-03-17 — 自動化測試擴充：新增 5 個測試套件 139 個測試（總計 511）
- **內容**：新增 tournament-core.test.js(42)、leaderboard-stats.test.js(30)、script-loader.test.js(22)、no-show-stats.test.js(30)、script-deps.test.js(15)
- **覆蓋範圍**：賽事狀態/模式/隊長判斷、活動紀錄三階段分類、ScriptLoader URL 正規化/群組去重、放鴿子統計含 nameToUid 歷史修正、跨模組依賴靜態驗證
- **script-deps.test.js 重點**：解析 index.html 與 script-loader.js，驗證 eager script 不會呼叫僅在 dynamic 群組定義的函式。偵測 `?.()` / `typeof` / truthiness guard。此測試能在部署前捕捉 Phase 1 類型的跨模組呼叫斷裂
- **教訓**：測試 _categorizeRecords 時需注意「取消後重新報名」的 seenCancel 清除邏輯，以及 waitlisted + 活動結束不算 missed 的業務規則

### 2026-03-17 — 效能優化 Phase 1：21 個 script 從 index.html 移至動態載入
- **內容**：將 21 個非首頁必需的 script 從 index.html 移除，改由 script-loader.js 按需載入。新增 `tournament`、`message` 兩個群組，`image-cropper.js` 加入 `profile` 群組。新增 `_pageGroups` 映射：page-tournaments、page-tournament-detail、page-messages
- **移除清單**：image-cropper / profile-avatar / profile-data / profile-data-render / profile-data-stats / profile-data-history / profile-card / profile-share / event-share-builders / event-share / team-share / tournament-detail / tournament-friendly-detail / tournament-friendly-detail-view / tournament-share / tournament-friendly-roster / tournament-friendly-notify / leaderboard / message-actions / message-actions-team / message-inbox
- **安全措施**：新增 `_openTournamentDetail()` 包裝函式（tournament-render.js），確保動態載入 tournament 群組後再呼叫 `showTournamentDetail`。所有非 tournament 群組內的呼叫端（首頁輪播、收藏清單、深連結、訊息操作）均改用此包裝或加入 `ScriptLoader.ensureForPage` 前置載入
- **教訓**：從 index.html 移除 script 時，必須檢查所有 onclick / 程式呼叫端是否假設函式已存在；若呼叫端在不同群組，需加入動態載入保護

### 2026-03-17 — 模組資料夾化（80+ 模組移入 12 個功能子資料夾）
- **內容**：將 js/modules/ 下 80+ 個扁平模組移入 12 個子資料夾：event/(27), team/(10), tournament/(12), profile/(9), message/(9), scan/(5), dashboard/(5), kickball/(6), ad-manage/(5), user-admin/(4), shot-game/(10), achievement/(10 既有)。保留 21 個獨立模組在扁平目錄
- **更新檔案**：script-loader.js（97 條路徑）、index.html（75 個 script tag）、game-lab.html（8 條路徑）、shot-game-page.js（5 條硬編碼路徑）
- **教訓**：shot-game-page.js 內有硬編碼的動態載入路徑（`_loadEngine()`），資料夾化時容易遺漏。其他模組都透過 Object.assign 掛載，不含路徑引用

### 2026-03-17 — JS 檔案拆分 Phase 3（6 大模組 + 整合既有拆分檔）
- **內容**：event-manage(2056→532)、event-create(2249→402)、team-form(1011→386)、tournament-manage(988→299)、event-detail(793→692)、tournament-render(557→155)、event-share(508→262)。新增 23 個拆分檔、刪除 team.js(1381行)
- **風險發現**：event-share-builders.js 僅在 script-loader 但 event-share.js 在 index.html 直接載入，已修復（加入 index.html）
- **評估不拆的檔案**：user-admin-roles(670)/exp(599)/list(537)、event-detail-signup(563)、tournament-render(557→已拆)、banner(414)、audit-log(409)、event-create(402→已拆) — 耦合緊密或已為拆分後殘餘
- **教訓**：拆分後必須檢查 index.html 直接載入 vs script-loader 動態載入的一致性，避免拆出的檔案未被載入

### 2026-03-17 — JS 檔案拆分 Phase 2（7 大模組拆分為 24 個檔案）
- **內容**：將 7 個超過 300 行的模組拆分至 300 行以下
  - event-list.js → event-list-helpers.js, event-list-stats.js, event-list-home.js, event-list-timeline.js
  - scan.js → scan-ui.js, scan-camera.js, scan-process.js, scan-family.js
  - team-detail.js → team-detail-render.js, team-detail-members.js
  - profile-data.js → profile-data-render.js, profile-data-stats.js, profile-data-history.js
  - profile-core.js → profile-form.js, profile-avatar.js
  - team-list.js → team-list-render.js
  - dashboard.js → dashboard-widgets.js
- **修復**：scan-process.js 超 300 行，手動提取 family checkin 至 scan-family.js
- **教訓**：Linter hook 會自動整理檔案，不要與之對抗；innerHTML 安全 hook 需在檔案頭加 escapeHTML 安全註解

### 2026-03-17 — Phase 2 自動化測試擴充（350 個新測試）
- **內容**：新增 3 個測試檔案，覆蓋 config 工具函式、成就系統、活動模組
  1. `tests/unit/config-utils.test.js`（87 tests）— escapeHTML、Permission System（7 函式）、Sport Config、Custom Role
  2. `tests/unit/achievement.test.js`（141 tests）— shared/evaluator/stats 三檔案，含 getParticipantAttendanceStats 深度測試（23 tests）
  3. `tests/unit/event-utils.test.js`（122 tests）— 性別限制（9 函式）、_buildEventPeopleSummaryByStatus、_getEventOccupancyState、Navigation
- **累計**：4 個測試檔案、378 個單元測試，全部通過
- **教訓**：Agent 執行 npm install 時可能汙染 package.json（加入 dependencies），需在 commit 前檢查還原

### 2026-03-17 — Phase 1 自動化測試建立
- **內容**：建立兩層自動化測試基礎
  1. `tests/unit/pure-functions.test.js`（28 個測試）— 從 Object.assign 模組中提取純函式邏輯進行測試：_rebuildOccupancy、_isEventDelegate、_isAnyActiveEventDelegate、_categorizeScanEvents
  2. `tests/firestore.rules.test.js` 擴充（+585 行）— 新增 attendanceRecords CRUD 權限、users 自更新安全邊界（3 條路徑）、rolePermissions 讀寫權限測試
  3. `package.json` 新增 `test:unit` script
- **教訓**：專案使用 Object.assign 模式無法直接 import，測試需複製純函式邏輯；修改原始函式時需同步更新對應測試

### 2026-03-17 — 用戶名片活動記錄徽章數量顯示錯誤
- **問題**：查看其他用戶的活動記錄時，徽章數量顯示的是管理員（當前登入者）自己的徽章數，而非該用戶實際獲得的徽章數
- **原因**：`renderUserCardRecords` 使用 `getCurrentBadgeCount()` 計算徽章數，此函式固定對當前登入者（`ApiService.getCurrentUser()`）評估成就，未考慮目標用戶
- **修復**：新增 `_updateUserCardBadgeCount(uid)` 方法：當前用戶 → 同步走 `getCurrentBadgeCount()`；其他用戶 → 異步從 per-user 子集合讀取成就進度再計算徽章數
- **教訓**：統計數據（出席率、場次）已正確使用目標 uid，但徽章數遺漏了。新增統計維度時必須確認資料來源是否對應正確用戶

### 2026-03-17 — [永久] 成就出席率徽章無法達成：evaluator 缺少 displayName → UID 對照
- **問題**：用戶個人檔案顯示 100% 出席率，但成就系統的「達到出席率」徽章無法達成
- **原因**：成就 evaluator 的 `buildAttendanceStateByEvent` 對 `attendanceRecords.uid` 做嚴格 UID 比對，但歷史資料中部分 attendance record 的 uid 存的是顯示名稱（非 LINE userId）。個人檔案統計走 `ensureUserStatsLoaded` → `getUserAttendanceRecords` 有 displayName fallback（先查 uid、查無再用 userName），所以能正確顯示 100%。但 evaluator 走 `getAttendanceRecords()`（全域快取、無 fallback），UID 不匹配 → 認為無簽到 → 出席率 0%
- **修復**：
  1. `buildAttendanceStateByEvent` 新增第三參數 `nameSet`：UID 不匹配時，檢查 record.uid 是否為目標用戶的已知 displayName
  2. `buildEvaluationContext` 改用 `getUserAttendanceRecords(uid)`（優先使用 user-specific cache，含 displayName fallback）作為 attendanceRecords 來源
  3. 傳入 `getUserNameSet(resolvedUser)` 作為 nameSet
- **教訓**：任何涉及 `attendanceRecords.uid` 比對的新邏輯，都必須加入 displayName → uid 解析（與 CLAUDE.md 統計系統保護規則第 5 條一致）

### 2026-03-17 — [永久] 權限管理 UI 重構為收折式分組 + _seedRoleData 自動補新權限碼
- **問題**：(1) 權限管理頁所有權限平鋪列出，缺乏入口/子權限的視覺層級；(2) `_seedRoleData()` 對已有自訂權限的角色完全跳過 seed，導致新增入口權限時既有角色不會自動獲得
- **修復**：
  - `renderPermissions()` 重寫為收折式分組：入口權限開關放在分類標題右側（header toggle），子權限收進可展開區塊
  - `_seedRoleData()` 新增 `else if (savedDefaults)` 分支：比對 savedDefaults 與 defaults 的差集，自動補入新增碼（只加不刪）
  - `ROLE_PERMISSION_CATALOG_VERSION` 升至 `20260317a` 以觸發 baseline 儲存
  - CSS 更新：`.perm-category` 加邊框、`.perm-cat-name` flex:1、`.no-sub` 隱藏箭頭
- **教訓**：新增入口權限後若不 bump catalog version，既有角色不會觸發 seed 邏輯；必須同步 bump 並確保 `defaultPermissions` baseline 已建立

### 2026-03-17 — [永久] admin 角色固有權限設計決策
- **決策**：admin 及以上角色的所有入口權限均由 super_admin 在權限管理 UI 自由啟閉，不放入 `INHERENT_ROLE_PERMISSIONS`
- **原因**：用戶明確要求「入口權限是由總管去權限管理來決定所有層級的權限與入口」
- **`INHERENT_ROLE_PERMISSIONS` 僅保留**：coach/captain/venue_owner 的 `activity.manage.entry` + `admin.tournaments.entry`（身分核心功能）
- **配套**：`_seedRoleData()` 自動補新權限碼機制確保既有角色不會因新增入口而掉功能

### 2026-03-17 — [永久] admin 角色固有權限不足導致自訂覆蓋後功能消失
- **問題**：admin 在權限管理頁存過自訂權限後，大量入口權限消失（賽事、用戶、廣告、俱樂部等）
- **原因**：`INHERENT_ROLE_PERMISSIONS` 只列了 2 個權限，但 admin 應有 12 個入口權限。`getRolePermissions()` 在有自訂權限時完全覆蓋預設，只有固有權限不受影響
- **修復**：admin 固有權限擴充為全部入口權限（9 個 .entry + team.create + team.manage_all + event.edit_all）。子權限（.edit_profile 等）保持可配置
- **教訓**：`INHERENT_ROLE_PERMISSIONS` 是自訂權限覆蓋的最後防線；新增入口權限時若 minRole <= admin，必須同步加入此處

### 2026-03-16 — 頁籤滑動改為跟手滑動 + 滑出滑入動畫
- **問題**：`_bindSwipeTabs` 為二元切換，手勢結束才切換，無視覺回饋
- **修復**：重寫 `app.js:_bindSwipeTabs`，touchmove 時 `translateX` 跟手、邊界阻尼、滑出/滑入動畫（~450ms），`passive:false` 防滑動衝突，`transitionend` 有 350ms fallback
- **影響範圍**：活動列表（2 tabs）、活動管理（6 tabs）、新聞（動態 tabs）三處呼叫端零修改
- **教訓**：`transitionend` 在 LINE WebView 偶爾不觸發，必須加 fallback timer

### 2026-03-16 — 抽屜選單用戶補正管理位置與顏色調整
- **問題**：「用戶補正管理」在抽屜最底部且無紅底色標示
- **修復**：移至「日誌中心」與「無效資料查詢」之間；加 `highlight: 'red'` 強制紅底
- **教訓**：紅底 = 高階功能視覺提示、藍底 = 中階、無色 = 低階，僅視覺區分與權限無關

### 2026-03-16 — [永久] 系統資料同步功能
- **需求**：將「成就批次更新」頁籤擴大為「系統資料同步」，包含 4 項操作
- **操作項目**：
  1. **成就進度 + 報名徽章**（原有）：重算成就進度 → `users/{uid}/achievements` + `registrations.displayBadges`
  2. **俱樂部成員數重算**（新增）：從 `users.teamId` 動態計算 → `teams.members`
  3. **用戶俱樂部欄位驗證**（新增）：移除指向已刪除俱樂部的 `teamId/teamIds` 引用
  4. **孤兒記錄清理**（新增）：刪除指向不存在活動的 `registrations/activityRecords/attendanceRecords`
- **費用預估**：每個操作的確認彈窗會顯示預估讀寫次數與 USD 費用（Firestore Blaze 計價）
- **權限**：`admin.repair.data_sync`（原 `admin.repair.achievement_batch`），頁面 minRole 從 `super_admin` 降為 `admin`
- **備註**：放鴿子次數（noShow）不需加入同步 — 此數據僅供 coach 以上層級管理員參考，一般用戶看不到；且 corrections 在管理端已正確套用
- **教訓**：`teams.members` 是高風險過期欄位，只有瀏覽俱樂部頁才會重算寫回；`users.teamId` 在俱樂部被刪除時不會自動清除

### 2026-03-16 — 身份成就 + 手動授予成就
- **需求**：新增 4 種身份判定動作類型（教練/領隊/場主/管理員）+ 1 種手動授予動作類型
- **設計**：
  - **身份成就**：`role_coach`、`role_captain`、`role_venue_owner`、`role_admin`，共用 `role_check` handler，以 `ROLE_LEVEL_MAP` 做階層判定（高階角色自動滿足低階條件），`fixedThreshold: 1`
  - **手動授予**：`manual_award`，evaluator handler 直接回傳既有 `current` 值（不自動評估），管理員透過後台「授予」按鈕開啟面板，模糊搜尋用戶後直接寫入 `users/{uid}/achievements/{achId}`
- **修改位置**：`config.js` 加 5 筆 actions、`registry.js` 加 5 筆 actionMetaMap、`evaluator.js` 加 `role_check` + `manual_award` handler、`admin.js` 加 `openManualAwardPanel` + 授予/撤銷 UI、`achievement.js` 加 facade
- **教訓**：手動授予繞過 evaluator 自動計算，直接寫 Firestore 子集合，因此批次更新時 `manual_award` handler 會保留既有 `current` 值不覆蓋

### 2026-03-16 — [永久] 成就鎖定/解鎖功能
- **需求**：管理員可控制每個成就是否為「達成即永久」或「條件消失即撤銷」
- **設計**：成就文件新增 `locked` 欄位（預設 `true`，向下相容）
  - **鎖定（locked: true）**：`completedAt` 一旦設定就永久保留，即使 `current < threshold` 也不清除
  - **解鎖（locked: false）**：`current < threshold` 時 `completedAt` 會被設為 `null`，成就被撤銷
- **修改位置**：`evaluator.js:776` 加入 `isLocked` 判斷；`admin.js` 加入鎖頭圖示按鈕 + `toggleAchievementLock`；`achievement.js` 加入 facade
- **教訓**：`locked` 預設為 `true` 是關鍵決策——所有既有成就自動向下相容為永久型，不會因為升級而意外撤銷用戶的成就

### 2026-03-16 — 成就批次更新功能（用戶補正管理第三頁籤）
- **需求**：用戶徽章在活動頁可見但在個人名片不可見，因為 `users/{uid}/achievements` 子集合只有用戶本人觸發才寫入
- **實作**：
  - 在用戶補正管理頁新增第三個頁籤「成就批次更新」
  - 新增 `js/modules/achievement-batch.js`（~200 行），逐一為每位用戶查 Firestore 完整資料、暫時替換快取、呼叫 evaluator、還原快取
  - 寫入 `users/{uid}/achievements/{achId}` + 更新 `registrations.displayBadges`（diff 比對無變動跳過）
  - Firestore rules 放寬 achievements 子集合寫入：`isOwner(userId) || isAdmin()`
  - 新增權限碼 `admin.repair.achievement_batch`
- **修改檔案**：`firestore.rules`、`pages/admin-system.html`、`js/modules/user-admin-corrections.js`、`js/modules/achievement-batch.js`（新增）、`js/core/script-loader.js`、`js/config.js`、`index.html`
- **教訓**：快取替換必須在 try/finally 中還原，evaluator 是同步的所以循序處理時不會有併發問題

### 2026-03-16 — [永久] 非管理員用戶看不到活動詳情頁徽章
- **問題**：一般用戶（非 admin）進入活動詳情頁，參加者名單上看不到任何徽章
- **原因**：`_refreshRegistrationBadges` 使用 `ApiService.getRegistrationsByEvent()` 讀取本地快取，但非管理員的 Firestore listener 只查自己的報名（`where('userId', '==', uid)`），本地快取不含其他參加者的報名資料
- **修復**：
  - `_refreshRegistrationBadges` 改為直接查 Firestore `db.collection('registrations').where('eventId', '==', eventId).get()`（Firestore rules 允許 `isAuth()` 讀取）
  - 從查詢結果的 `displayBadges` 欄位建立 `badgeMap`，同時以 `userId` 和 `userName` 做 key
  - `_buildConfirmedParticipantSummary` 的 fallback 路徑（`e.participants` 字串陣列）改從 `_eventBadgeCache` 讀取 `displayBadges`
  - 管理員仍保留即時計算+寫入 Firestore 的完整流程
- **教訓**：非管理員的 registrations 本地快取只含自己的資料，任何需要讀取「其他用戶報名資料」的功能都必須直接查 Firestore

### 2026-03-16 — 成就系統新增 11 種動作類型
- **需求**：擴充成就系統，新增可立即使用現有資料的動作類型
- **新增動作**：`organize_event`（啟用）、`diverse_sports`、`no_show_free`、`create_team`、`bring_companion`、`team_member_count`、`early_event`、`night_event`、`shop_trade`、`game_play`、`game_high_score`
- **修改檔案**：`config.js`（ACHIEVEMENT_CONDITIONS）、`registry.js`（actionMetaMap）、`evaluator.js`（actionHandlers）
- **注意**：`shop_trade`、`game_play`、`game_high_score` 依賴 trades/leaderboard 集合資料，尚無交易功能時這些成就自然不會觸發

### 2026-03-16 — 修復活動詳情頁徽章展示未生效 + 手勢補全
- **問題**：`_refreshRegistrationBadges` 使用 `getEvaluatedAchievementsForUserAsync` 為其他用戶讀取 per-user 子集合，但大部分用戶無子集合資料，導致成就全部判定為未完成、徽章永遠為空；觸控手勢缺少 `touchcancel` 處理
- **原因**：`badges.js` 的 `getEvaluatedAchievementsForUserAsync` 對非當前用戶僅讀子集合（不即時計算），子集合空時回傳模板 `current:0`
- **修復**：
  - `event-manage.js`: `_refreshRegistrationBadges` 改用 `evaluator.getEvaluatedAchievements({ targetUid })` 即時計算任何用戶成就
  - 新增防護：空結果不覆蓋已有 `displayBadges`（避免資料未載入時誤清）
  - `_bindBadgeRowSnapBack` 新增 `touchcancel` 事件支援
  - `event-detail.js`: 呼叫加 `.catch(() => {})` 防止未處理 rejection
- **教訓**：`getEvaluatedAchievementsForUserAsync` 只適用於讀取已存在的 per-user 資料；需要即時計算其他用戶成就時，應使用 evaluator 的 `getEvaluatedAchievements`

### 2026-03-16 — 報名名單顯示用戶徽章
- **問題**：活動詳情頁報名名單需展示用戶擁有的徽章縮圖
- **修復**：
  - `firebase-crud.js`: 報名成功後背景寫入 `displayBadges` 到 registration 文件（transaction 外）
  - `event-manage.js`: `_buildConfirmedParticipantSummary` 傳遞 `displayBadges`；`_renderAttendanceTable` 名字旁顯示徽章；新增 `_refreshRegistrationBadges` 背景更新 + `_bindBadgeRowSnapBack` 滑動彈回
  - `event-detail.js`: 開詳情頁時觸發背景徽章更新
  - `css/activity.css`: 新增 `.reg-name-badges` 橫向滾動 + `.reg-badge-icon` 樣式
- **教訓**：徽章寫入必須在報名 transaction 外，避免影響報名核心邏輯；背景更新用 30 分鐘間隔避免重複查詢

### 2026-03-16 — 首頁每日體育新聞功能
- **問題**：用戶希望在首頁新增每日體育新聞區塊
- **修復**：
  - `functions/index.js`: 新增 `fetchSportsNews` scheduled function（每 6 小時從 NewsData.io 抓取中文體育新聞）
  - `js/firebase-service.js`: 新增 `newsArticles` 快取 + `_buildCollectionQuery` 排序
  - `js/api-service.js`: 新增 `getNewsArticles()` 方法
  - `js/modules/news.js`: **新建** — 新聞卡片直瀑式渲染模組，含體育分類頁籤篩選
  - `pages/home.html`: 贊助商下方新增新聞區塊 HTML（置中標題 + 方形頁籤）
  - `css/home.css`: 新聞卡片 + 方形頁籤 + 置中標題樣式
  - `app.js`: `renderHomeDeferred()` 加入 `renderNews()` + deep link `?news=` 參數
  - `firestore.rules`: 新增 `newsArticles` 集合規則（公開可讀、僅 CF 可寫）
- **教訓**：新聞來源 API 需設定 Secret（`firebase functions:secrets:set NEWS_API_KEY`）；頁籤使用 `EVENT_SPORT_OPTIONS` 動態生成

### 2026-03-16 — 外部活動連結功能
- **問題**：用戶希望在行事曆與首頁顯示外部平台活動，點擊後直接跳轉到外部連結
- **修復**：
  - `config.js`: TYPE_CONFIG / GRADIENT_MAP 新增 `external` 類型
  - `css/activity.css` / `css/home.css`: 新增外部活動樣式（灰色系）
  - `pages/activity.html`: 新增 `create-external-event-modal` + 篩選下拉選項
  - `event-create.js`: `openCreateEventModal()` 改為先彈 Action Sheet 選擇自訂/外部，新增 `openCreateExternalEventModal()` + `handleCreateExternalEvent()`
  - `event-list.js`: renderHotEvents / renderActivityList 為外部活動顯示不同 meta（無人數），點擊跳轉 externalUrl
  - `event-manage.js`: renderMyActivities 為外部活動顯示不同按鈕，新增 `editExternalActivity()`
  - `event-detail.js`: showEventDetail 攔截 external type 直接跳轉
- **教訓**：外部活動 `max:0, current:0` 會觸發 `current >= max` → full 的判斷，需額外排除

---

### [永久] 2026-03-16 — Per-User Achievement Progress 遷移（Phase 1+2）
- **問題**：`achievements` 集合是全域共用文件，任何用戶觸發 `evaluateAchievements()` 都會把 `current/completedAt` 寫回全域文件，導致所有人都顯示「已獲得」
- **原因**：成就進度存在全域 `achievements` 集合而非每用戶獨立存儲
- **修復**：
  - 新增 `users/{uid}/achievements/{achId}` 子集合儲存每用戶進度
  - `firebase-crud.js` 新增 `saveUserAchievementProgress()` / `loadUserAchievementProgress()`
  - `evaluator.js` 的 `evaluateAchievements()` 改為雙寫（全域 + per-user 子集合），安全防線確保只寫自己的子集合
  - `evaluator.js` 的 `getEvaluatedAchievements()` 優先讀取 per-user 已完成記錄，fallback 到即時計算
  - `firebase-service.js` 新增 `_loadCurrentUserAchievementProgress()` 非阻塞載入 + `getUserAchievementProgressMap()` 查詢介面
  - `firestore.rules` 新增子集合規則：任何登入用戶可讀，僅 owner 可寫
- **教訓**：
  - 全域 `achievements` 集合保留為模板（管理員 CRUD 不動），進度存子集合
  - 三道防火牆：①雙寫保留全域 ②fallback 即時計算 ③安全規則 `auth.uid == uid`
  - Phase 3：badges.js 新增 `getEvaluatedAchievementsForUserAsync()`，profile.js 新增 `buildEarnedBadgeListHtmlAsync()`，profile-core.js 修正其他用戶顯示自己徽章的 bug（傳遞 targetUser + 異步更新）
  - Phase 4：移除 evaluator.js 全域 `ApiService.updateAchievement()` 寫入，移除 `_seedAchievements` 汙染清除邏輯

### 2026-03-16 — 取消報名翻牌動畫 0% 成功率修復
- **問題**：報名後翻牌成功率高，但取消報名後翻牌成功率為 0%
- **原因**：`_flipAnimating = true` 設在 `cancelRegistration()` 之後，但 Firestore `onSnapshot` 在 await 期間觸發 `showEventDetail()` 重渲染 DOM，導致翻牌操作的目標 DOM 已被替換（detached elements）
- **修復**：
  - `_flipAnimating = true` 移到 Firestore 操作之前（loading setup 階段）
  - `_restoreCancelUI()` 中加入 `this._flipAnimating = false` 確保錯誤路徑也清除
  - catch / finally 區塊都加入 `this._flipAnimating = false`
- **教訓**：[永久] onSnapshot 會在任何 await 期間觸發重渲染，所有需要保護 DOM 的標誌必須在 Firestore 操作之前設定，且所有退出路徑都必須清除標誌

### 2026-03-16 — 報名/取消速度優化 + 翻牌特效修復
- **問題**：報名與取消報名流程冗長，有時卡在「取消處理中，請稍後」；翻牌特效不生效
- **原因**：
  1. `_ensureAuth()` 每次都 `getIdToken(true)` 強制刷新 token — 多一次網路往返
  2. `_syncMyEventRegistrations` 在確認對話框之前就發 Firestore query — 用戶按「否」也白等
  3. `_cancelSignupBusyMap` 無超時保護，Firestore 卡住時永久鎖定
  4. CSS 翻轉缺少 `transform-style: preserve-3d`，按鈕原有 `z-index` 干擾 3D 渲染
- **修復**：
  - `_ensureAuth`: `getIdToken(false)` 優先用快取 token，過期才強制刷新
  - `handleCancelSignup`: `_syncMyEventRegistrations` 移到 `appConfirm()` 之後
  - 新增 15 秒安全超時自動解鎖 `_cancelSignupBusyMap`
  - 取消成功 `showEventDetail` 移除不必要的 `await`
  - CSS: 加 `transform-style: preserve-3d`、移除按鈕 `z-index`、翻轉時隱藏光跡元素
- **教訓**：`getIdToken(true)` 是昂貴操作，正常寫入不需要強制刷新；busy lock 必須有超時保護

### 2026-03-16 — 修復三項 Bug（_evaluateAchievements / feeEnabled / 翻牌動畫）
- **問題 1**：`_evaluateAchievements is not a function` — 報名/取消報名時瀏覽器報錯
- **原因**：`achievement.js` 是 lazy-loaded 模組，僅在 achievement/profile 頁面載入，活動詳情頁未載入
- **修復**：`event-detail-signup.js` 中 4 處 `this._evaluateAchievements()` 改為 `this._evaluateAchievements?.()`（optional chaining）
- **問題 2**：`feeEnabled is not defined` — 點擊活動管理查看名單報錯
- **原因**：費用摘要重構時移除了 `feeEnabled` / `fee` 變數宣告，但 `metaParts` 仍引用
- **修復**：在 `event-manage.js` 的 `showMyActivityDetail()` 中補回 `feeEnabled` 和 `fee` 變數宣告
- **問題 3**：報名成功後缺少翻牌特效
- **修復**：CSS 加入 `.signup-flip-back` / `.flipped` 3D 翻轉樣式，JS 在報名/取消成功後動態注入背面元素並觸發翻牌動畫（700ms），完成後再刷新頁面
- **教訓**：重構時移除程式碼區塊前，必須全文搜尋被移除變數的所有引用點；lazy-loaded 模組的方法呼叫必須用 optional chaining

### 2026-03-16 — 報名/簽到速度優化（Strategy C）
- **問題**：按下「立即報名」、「取消報名」或掃碼簽到後，需等待 Firestore 寫入完成才有 UI 回饋，體感延遲明顯
- **修復**：
  - `event-detail.js`：進入活動詳情頁時 fire-and-forget 呼叫 `ensureAuthReadyForWrite()` 預熱 auth
  - `event-detail-signup.js`：`handleSignup()` / `handleCancelSignup()` 成功後立即 toast + 刷新頁面，通知/成就/audit 移至背景
  - `event-detail-companion.js`：`_confirmCompanionRegister()` 同上模式
  - `scan.js`：`_processAttendance()` / `_confirmFamilyCheckin()` 改用 Optimistic UI，`addAttendanceRecord` 同步推入快取後不 await Firestore，UI 即時刷新，錯誤在背景以 toast 通知
- **教訓**：報名核心 transaction（registerForEvent / cancelRegistration）必須 await 確保資料一致性，但後續的 activityRecords、audit log、通知、成就評估等 post-ops 可以 fire-and-forget；簽到紀錄的 `addAttendanceRecord` 已內建 cache-first + rollback 機制，適合 optimistic UI

### 2026-03-16 — 修復 LINE 瀏覽器底部導航列按鈕跑位
- **問題**：LINE 內建瀏覽器開啟時，底部頁籤的按鈕位置偏高
- **原因**：`#bottom-tabs` 使用 `border-box`（全域 reset），`height: 64px` 包含 `padding-bottom: env(safe-area-inset-bottom)`，導致按鈕內容區被壓縮，`align-items: center` 讓按鈕在更小的空間內置中而偏高
- **修復**：`#bottom-tabs` 加上 `box-sizing: content-box`，讓 64px 永遠是內容區高度，safe-area padding 只延伸背景不影響按鈕佈局；同步更新 `body` 的 `padding-bottom` 加入 safe-area
- **教訓**：`position: fixed` 元素若同時使用 `env(safe-area-inset-*)` padding，需注意 `box-sizing` 對內容區的影響，尤其在 LINE WebView 等回報不同 safe-area 值的環境

### 2026-03-16 — 分享底部選單新增「分享到 LINE 社群」（line.me/R/share）
- **問題**：shareTargetPicker 不支援 LINE 社群（OpenChat），用戶只能手動複製連結貼上
- **修復**：
  - `event-share.js`：新增 `_openLineRShare(altText)` 共用 helper，底部選單新增 `line-share` 選項
  - `_showShareActionSheet`：canPicker 時顯示 3 按鈕（Flex / LINE 社群 / 複製）；否則 2 按鈕（LINE / 複製）
  - 4 個 share 模組全部新增 `line-share` choice handler
  - CSS 新增 `.share-action-sheet-btn-inner` / `.share-action-sheet-btn-sub` 按鈕副標題樣式
- **教訓**：`line.me/R/share` 可在任何瀏覽器開啟 LINE 原生分享（含社群），但只能發純文字

### 2026-03-15 — 全站分享升級：俱樂部/賽事/名片改用 LIFF URL + Flex Message
- **問題**：俱樂部邀請、賽事分享、個人名片分享使用直連 URL（`toosterx.com`），不會強制在 LINE 內建瀏覽器開啟，且沒有 Flex Message 卡片
- **修復**：
  - 新建 `team-share.js`、`tournament-share.js`、`profile-share.js`，比照 `event-share.js` 模式（LIFF URL + Flex Message + shareTargetPicker + 底部選單 + fallback）
  - `team-detail.js` / `team.js`：`_getTeamInviteShareUrl` 改為 LIFF URL、QR Code 編碼 LIFF URL
  - `tournament-friendly-detail-view.js`：移除舊 `shareTournament`，由新模組覆蓋
  - `app.js`：新增 `?tournament=` / `?profile=` deep link 路由
  - `line-auth.js`：login redirectUri 保留 tournament/profile 參數
  - `functions/index.js`：teamShareOg redirect 改為 LIFF URL
  - `event-share.js`：`_showShareActionSheet` 支援自訂標題
- **教訓**：所有面向用戶的分享 URL 應一律使用 LIFF URL，確保 LINE 內建瀏覽器開啟

---

### 2026-03-15 — 建立/編輯活動後列表未刷新
- **問題**：建立活動成功後，活動管理列表未顯示新建的活動，需切頁籤或刷新才能看到
- **原因**：`renderActivityList()`、`renderHotEvents()`、`renderMyActivities()` 三個渲染呼叫放在非關鍵操作的 try-catch 區塊內（與 localStorage 儲存、opLog 寫入、autoExp 發放同一個 try），若前面任一操作拋出例外，渲染呼叫就會被跳過
- **修復**：`event-create.js` — 將三個渲染呼叫移到 try-catch 區塊外，各自獨立 try-catch，確保無論記錄操作是否失敗都能刷新列表（建立路徑 + 編輯路徑都修復）
- **教訓**：渲染呼叫屬於用戶可見的即時回饋，不應與可容錯的背景操作共用同一個 try-catch

---

### 2026-03-15 — Tier 2 Login：LIFF 過期時以 Firebase Auth + 快取維持登入
- **問題**：用戶每天被登出，因為登入判斷完全依賴 LIFF session，而外部瀏覽器的 LIFF session 隔天就會失效
- **原因**：`isLoggedIn()` 只檢查 `this._profile !== null`，LIFF 過期後 profile 無法獲取，即使 Firebase Auth（IndexedDB persistence，refresh token ~1 年）仍然有效
- **修復**：
  - `line-auth.js`：profile 快取 TTL 從 6 小時延長至 30 天；新增 `_firebaseSessionAlive()`、`_matchesFirebaseUid()` 輔助方法；`isLoggedIn()` 新增 Tier 2 fallback（Firebase Auth + 快取 profile）；`restoreCachedProfile()` 加入 UID 交叉驗證防換帳號；新增 `_scheduleProfileRefresh()` 背景刷新
  - `app.js`：`ensureCloudReady` LIFF init 區塊增加 Tier 2 快取恢復；profile fetch 區塊增加 Tier 2 UID 驗證與背景刷新排程
  - `profile-core.js`：`bindLineLogin` 的 `loginUser` 失敗時增加 Tier 2 降級處理（Firebase Auth 仍有效則不顯示錯誤）
- **教訓**：Firebase Auth 的 IndexedDB persistence（LOCAL）遠比 LIFF session 長壽，應作為 fallback 信任層

---

### 2026-03-15 — 開球遊戲反作弊 + 排行影子即時更新
- **問題**：(1) Cloud Function `submitKickGameScore` 對極端數值僅 console.warn 不拒絕，前端可篡改成績；(2) 提交成績後場地上月排行前10名影子不會更新
- **原因**：(1) flags 偵測後缺少 throw 拒絕邏輯；(2) `loadTop3Markers` 與 `_submitScore` 不同 scope，提交後未觸發重新載入
- **修復**：(1) `functions/index.js` flags 改為 throw HttpsError 拒絕，閾值收緊(距離>150/球速>250/低速遠距交叉驗證)；(2) `_createGame` return 暴露 `refreshMarkers`，`_submitScore` finally 中呼叫
- **教訓**：遊戲成績類 Cloud Function 必須有 reject 邏輯，不能只記 log；跨 scope 通訊要透過返回物件暴露方法

---

## [永久] UID / 資料完整性地雷

### attendanceRecords uid 欄位存顯示名稱而非 LINE userId
- **問題**：`attendanceRecords.uid` 欄位部分記錄存的是用戶顯示名稱（如「呂維哲」）而非 LINE userId（如 `U196b...`），導致統計交叉比對全部失敗
- **原因**：`_confirmAllAttendance` 在找不到 `registrations` 時，從 `event.participants` 取得顯示名稱直接作為 `uid` 寫入
- **影響**：完成場次=0、放鴿子誤判、出席率歸零。24 人中 21 人受影響
- **修復**：`firebase-service.js` 的 `ensureUserStatsLoaded` 新增 userName fallback 查詢；`event-manage.js` 的放鴿子函式加入 `nameToUid` 對照表
- **教訓**：`event.participants` 存的是顯示名稱，絕不能直接作為 uid。所有涉及 `attendanceRecords.uid` 交叉比對的邏輯都必須包含 displayName → uid 解析

### 手動簽到 UID 不匹配導致已簽到紀錄被批量誤刪（2026-03-14）
- **問題**：delegate user 點「完成簽到」後，已完成簽到簽退的紀錄被軟刪除（status='removed'）
- **原因**：渲染用顯示名稱作為 UID，儲存時解析為真實 UID，導致 checkbox ID 不吻合；`_normalizeAttendanceSelection(undefined)` 回傳 `{checkin:false, checkout:false}` 觸發刪除
- **教訓**：save loop 必須有「使用者有意操作」的證據（checkbox 實際存在且被讀取過），不能用 fallback 預設值推導刪除意圖

### 用戶 ID 欄位命名規範
- 各集合欄位對照：`users` → `uid`/`lineUserId`、`registrations` → `userId`、`attendanceRecords` → `uid`、`activityRecords` → `uid`、`events` → `creatorUid`、`expLogs` → `uid`
- 新增 Firestore 文件寫入必須包含 `uid` 欄位（LINE userId），禁止只存顯示名稱

### UID 不一致登入修補（2026-02-28）
- LINE/Firebase UID 與 users docId 不一致時，前端會出現 permission-denied 與 WebChannel 400/404
- 修復：偵測 UID mismatch 時強制重新登入/刷新 token，允許 legacy users docId 遷移到 canonical uid doc

---

## [永久] 報名系統核心架構

### 報名/取消操作用快取重建計數導致 event.current 被覆蓋（2026-03-13）
- **問題**：活動管理頁顯示 1/20 人，活動頁顯示 21/20 人
- **原因**：transaction 內使用本地快取 `this._cache.registrations` 重建 occupancy，快取不完整時會覆蓋正確值
- **修復**：改為在 transaction 前從 Firestore 查詢該活動所有 registrations
- **教訓**：transaction 內的「從零重建」操作，資料來源必須是 Firestore 而非本地快取

### 統一佔位重建 `_rebuildOccupancy`（2026-03-13）
- 所有 `event.current`/`event.waitlist` 變更必須透過 `_rebuildOccupancy()` 統一重建
- 禁止手動 `current++/--`，禁止使用本地快取作為計數來源
- 報名寫入必須使用 `db.runTransaction()` 或 `db.batch()`

### 反覆報名導致不在名單但紀錄顯示成功（2026-03-14）
- **原因**：registrations 查詢在 transaction 外面，重試時用舊資料
- **教訓**：Firestore transaction 重試時外部查詢不會自動刷新，必須放到 callback 內

---

## [永久] 資料來源與同步規則

### registrations 是唯一權威資料來源
- `activityRecords` 是衍生資料，status 欄位不可靠（取消後可能仍為 'registered'）
- 放鴿子計算、報名狀態判定、人數統計必須以 `registrations` 為準
- `activityRecords` 的五個根因：無 onSnapshot、limit(500) 截斷、fire-and-forget .add() 可能失敗、單向不一致修復、記憶體 push 不去重

### 用戶統計數據因 limit(500) 截斷（2026-03-15）
- 全域 `limit(500)` 查詢不適合用戶級統計
- 修復：`ensureUserStatsLoaded(uid)` 使用 `where('uid','==',uid)` 無 limit 查詢
- user-specific 快取的載入點必須覆蓋所有使用場景（含查看他人卡片）

### 個人數據頁完成場次永遠顯示 0（2026-03-15）
- `activityRecords.status` 永遠不會是 'completed'，`user.completedGames` 從未被更新
- 完成判定必須交叉比對 attendanceRecords（checkin + checkout）
- 統計邏輯統一使用 `_calcScanStats()`

### _calcScanStats 排除已取消報名（2026-03-15）
- `activityRecords.status` 取消後可能未更新，需用 `registrations`（權威）交叉比對建立 `cancelledRegEventIds` 集合
- 取消後又重新報名的不排除

### 取消報名後 activityRecords 未同步（2026-03-14）
- 快取可能未載入 activityRecords，Firestore 中的 activityRecord 不會被更新
- 修復：快取更新後加 Firestore 直查兜底

### 孤兒資料：deleteEvent 需級聯刪除（2026-03-13）
- 刪活動後必須級聯清理 registrations / activityRecords / attendanceRecords
- 手動簽到舊格式 participants 是顯示名稱，需用 `_findUserByName()` 解析真實 UID

---

## [永久] 權限 / Auth 模式

### client SDK 直寫受限欄位會造成樂觀更新與實際不一致
- EXP 系統（2026-03-14）：`users.exp` 只允許 `isSuperAdmin()` 修改，admin/coach 調整 EXP 時本地成功但 Firestore 靜默失敗
- 角色晉升（2026-03-14）：`users.role` 同樣受限
- **統一解法**：涉及權限敏感欄位的寫入一律走 Cloud Function + Admin SDK

### 取消報名 insufficient permissions（2026-03-14）
- `_ensureAuth()` 回傳值必須檢查，LINE Access Token 失效時 Firebase Auth 建立失敗
- 所有 Firestore 寫入函式的 auth 驗證必須檢查回傳值並在失敗時提前丟出錯誤

### admin token 過期但 users doc 已升權（2026-03-12）
- `authRole()` 優先讀 `request.auth.token.role`，token 未刷新時與 users doc 不一致
- 修復：authenticated request 一律優先讀 `users/{uid}.role`，找不到才 fallback token role

### 權限治理三層同步
- UI 按鈕檢查、Firestore Rules、Cloud Functions 必須同步改
- 只改 Rules 不改前端等於沒改；只改前端不改 Rules 會靜默失敗
- 每次新增 `hasPerm()` 規則時，必須同時確認前端有對應 toggle

### 權限管理預設值隔夜失效（2026-03-12）
- `defaultPermissions` 與 `permissions` 必須嚴格分流
- 初始化補遷移只能補缺，不能在看不出使用者意圖時重寫現有權限
- 儲存時同步寫入 `catalogVersion` 避免隔次啟動再觸發錯誤遷移

### 收緊使用者欄位寫入邊界（2026-03-09）
- `lastLogin`/`updatedAt` 時間驗證改為 `request.time`
- 俱樂部欄位需有縮減/清空規則，不能與一般個人資料共用寬鬆白名單

---

## [永久] Firestore Rules 模式

### Firestore 規則不是查詢後過濾器
- 只要 collection 監聽可能包含不可讀文件，listen 階段就會直接 400
- 前端必須先縮成規則可證明合法的查詢
- **registrations**：一般用戶只監聽自己的報名，admin 保留全量（2026-03-10）
- **messages**：依用戶身分拆成多條合法查詢再合併去重（2026-03-09）

### 一般用戶報名 Missing or insufficient permissions（2026-03-13）
- `registrations` 讀取規則若為 owner-only，但 `registerForEvent` 查詢包含他人報名，整個查詢被拒
- 報名紀錄不含敏感資料，改為 `isAuth()` 可讀

### 候補遞補是跨用戶操作（2026-03-13）
- 取消報名時同一 batch 更新他人 registration（waitlisted→confirmed），需額外 rules 規則
- batch 中每筆寫入都必須符合 rules

### Firestore rules 盤點（2026-02-28）
- rules 修補以「最小破壞」優先，先封鎖跨人破壞與濫用入口
- 測試框架：repo root 安裝 `@firebase/rules-unit-testing`，emulator 內穩定重現

---

## [永久] 啟動 / 快取 / 性能架構

### 冷啟動分層啟動（2026-03-04）
- boot collections + events + teams 不等 Auth 直接啟動
- Auth 完成後背景啟動 auth-dependent listeners（messages/users/rolePermissions）
- Auth-dependent listeners 必須有 `auth.currentUser` 守門

### 分層啟動引入的寫入競態（2026-03-04）
- `_initialized = true` 早於 Auth 完成，寫入時 `auth.currentUser` 可能未就緒
- 統一使用 `ensureAuthReadyForWrite()` 守衛所有寫入操作

### 首頁性能瘦身 V2 架構（2026-03-06）
- PAGE_STRATEGY 四種策略：stale-first / stale-confirm / prepare-first / fresh-first
- showPage() 改為 await page/script/data ready 再切頁
- ScriptLoader 具備「識別既有 eager 資產」能力，避免雙載
- 移除 eager script 前必須分析 cross-module 依賴，shared helpers 必須留在 eager 或先提取

### stale-first 策略注意事項（2026-03-14）
- 需同時檢查所有攔截層（requireLogin + showPage.authPending + canUseStaleNavigation）
- 非 guarded 頁面的公開內容不應被 auth 初始化狀態阻擋

### seed 類初始化競態（2026-03-05）
- `_seedAdSlots()` 的 `set({merge:true})` 會用預設空值覆蓋既有資料
- seed 必須是「只補缺」而非「覆蓋預設」
- 排程型寫入（如自動下架）應限制在可寫角色

### 首頁啟動並發控制
- boot collections 序列化載入，降低啟動期 Firestore targets 數量
- 移除 `orderBy(documentId())` 不必要排序
- events 預載完成後再逐一載入其他集合

---

## [永久] Deep Link / 登入 / 外部瀏覽器

### deep link + auth redirect + SPA 三者交會（2026-03-14）
- 必須注意資料就緒時序、並發呼叫互斥、ID 格式一致性（data ID vs doc ID）
- `_tryOpenPendingDeepLink` 需等 events 載入；REST fallback 需用 structuredQuery
- LIFF login redirect 不保留 URL query params，跨 redirect 狀態必須存 sessionStorage

### 外部瀏覽器 LINE 登入 fallback（2026-03-14）
- `liff.getProfile()` 在外部瀏覽器非 100% 可靠
- 需有直接 API 呼叫 `api.line.me/v2/profile` 作為中間 fallback
- 登入失敗時應優先嘗試自動恢復，而非只顯示 toast

---

## [永久] 通用開發模式

### async 函式中使用 try/catch/finally 而非 .then()/.catch()/.finally()
- fire-and-forget 的 showEventDetail 會造成 UI 時序問題（2026-03-14）
- cancel UI restore 只在 catch 失敗時執行；busy map 清除移到 finally

### Firestore 操作不應靜默回傳 false
- 應統一用 throw 讓呼叫端正確判斷成功/失敗（2026-03-14）

### 操作日誌/通知 idempotent 設計
- 使用固定文件 ID + `set({merge:true})`，不依賴 `.add()` 自動 ID（2026-03-10）
- 通知系統站內信與 LINE 推播共用同一個去重鍵

### SPA 中注入的 DOM 元素會被 innerHTML 重建摧毀
- 載入狀態必須獨立於 DOM 追蹤，用 eventId 而非特定 DOM 元素（2026-03-14）

### 跨瀏覽器相容性
- iOS Safari 需 `-webkit-` 前綴（backdrop-filter）
- `100dvh` 需 `100vh` fallback
- `replaceAll` 不可用，改 `replace(/…/g)`
- `navigator.clipboard` 需 `execCommand` 降級
- LINE WebView API 支援度有限需完整降級鏈

### 表單預設值一致性
- 不能只改單一 input，還要一起檢查初始化、回填、toggle 補值與 reset 流程

---

## 一般條目（2026-03-15）

### 2026-03-15 — 開球王遊戲（誰才是開球王）整合至主站
- **內容**：將獨立 HTML 的 Three.js 開球遊戲重構後嵌入 SPA 架構
- **架構修復**：消除全域變數（IIFE 封裝）、加入 setPixelRatio、cancelAnimationFrame 清理、container-relative sizing
- **新增檔案**：`pages/kickball.html`（頁面模板）、`js/modules/kickball-game-page.js`（遊戲模組）
- **新增 Cloud Function**：`submitKickGameScore`（距離排行，collections: `kickGameRankings` / `kickGameScores`）
- **對接**：PageLoader、ScriptLoader、navigation.js（init/destroy lifecycle）、config.js（HOME_GAME_PRESETS homeVisible:false）、首頁第二張金色卡片、Firestore rules、CSS（`#page-kick-game` prefix）
- **教訓**：多張遊戲卡片共用 section title 時，不能用 `_setHomeSectionVisibility` 逐個控制（會互相覆蓋），需整體判斷 anyVisible 後統一控制 title 顯示

### 2026-03-15 — 俱樂部申請狀態依賴站內信導致已入隊仍顯示審核中
- **問題**：用戶已入隊但 profile 仍顯示「XXX俱樂部 審核中」
- **原因**：`_getMyLatestTeamApplications` 完全依賴 messages 集合判斷狀態，未交叉比對 `users.teamId/teamIds` 實際 membership
- **修復**：filter 加入 `currentTeamIds.includes(teamId)` 比對，已入隊俱樂部的申請紀錄不再顯示；支援 name-only 舊 message 反查；`handleJoinTeam` 改為 multi-team 檢查
- **教訓**：顯示層判斷狀態應以權威資料（membership）為準，站內信僅作為通知管道，不應作為唯一狀態來源

### 2026-03-15 — stale-first 頁面 lazy module 未載入導致 crash
- **問題**：`renderTeamList is not a function`，stale-first 策略同步呼叫 render 時 lazy script 尚未載入
- **修復**：`_renderPageContent` 中 stale-first 頁面的 lazy 方法加 `?.()` 防護；`_refreshStalePage` 加入 `ScriptLoader.ensureForPage`

### 2026-03-15 — renderMyActivities crash
- event-manage.js 移至 lazy loading 後，profile-core.js 呼叫 `this.renderMyActivities()` 需改為 `?.()` optional chaining

### 2026-03-15 — 用戶卡片 stats 資料未載入時顯示 "--"
- 資料未就緒時顯示 `--` 而非 `0`，避免誤解
- 先 showPage 顯示頁面，再 await 載入資料，最後 renderUserCardRecords

### 2026-03-15 — 俱樂部自動晉升降級需走 Cloud Function
- `updateUserRole()` 改為呼叫 `autoPromoteTeamRole` CF，限定 user/coach/captain 三層

### 2026-03-15 — 小遊戲管理開關無效（homeVisible 合併邏輯 bug）
- **問題**：管理頁開關顯示已開啟但實際無效，首頁卡片不顯示
- **原因**：`_getHomeGameManageItems()` 合併 saved + preset 時，`(saved && saved.homeVisible === false) ? false : preset.homeVisible !== false` 只處理 saved=false，saved=true 時落入 else 回傳 preset 預設值
- **修復**：改為 `saved != null ? saved.homeVisible !== false : preset.homeVisible !== false`，優先採用 Firestore 值
- **教訓**：布林合併邏輯必須同時處理 true/false 兩個方向，不能只攔截單一值

### 2026-03-15 — 開球王整合完成 + 玩法說明修正
- **功能**：完成開球王小遊戲完整 SPA 整合（頁面模板、JS 模組、CSS、Cloud Function、Firestore 規則、首頁入口卡片、管理開關）
- **修正**：玩法說明移除不可見的「地形」提示，新增 PERFECT/GREAT 加成規則說明（含取得條件提示）
- **PERFECT 判定放寬**：`powerDiff <= 3 && aimAcc >= 0.68`（約 2.5 frame 視窗），加成改為隨機範圍 ×1.06~1.12
- **GREAT 判定**：`powerDiff <= 8 && aimAcc >= 0.42`，加成隨機 ×1.02~1.06
- **物理調整**：二次方高吊懲罰 `(1 - t² × 0.9)` 取代線性懲罰，最遠甜蜜點 cy≈-0.35；隨機速度方差 ±2% 減少同分
- **色系統一**：開球王 CSS 從綠色改為藍/青色，與射門王一致
- **標題修正**：射門王 → "TooSterxHub 射門大賽"、開球王 → "TooSterxHub 開球大賽"
- **動態標題**：兩遊戲 pageTitle 改為從 HOME_GAME_PRESETS / Firestore gameConfigs 動態載入

### 2026-03-15 — 開球王鏡頭控制 + 月排行前三標記
- **鏡頭控制**：右鍵拖曳旋轉 + 滾輪縮放（桌面）、雙指旋轉 + 捏合縮放（手機），鬆開後自動回正（0.93 衰減）
- **月排行前三標記**：場地上顯示當月排行前三名的距離標記（光柱 + 地面環 + 暱稱/距離文字精靈）
- **技術**：yaw/pitch 旋轉矩陣、atan2 仰角夾角、Sprite billboard 文字、cross-shaped 半透明光柱
- **修改檔案**：`kickball-game-page.js`（camera state + handlers + orbit math + snap-back + loadTop3Markers + destroy cleanup）
- **教訓**：window 級 listener 必須在 destroy 中 removeEventListener，containerEl 級 listener 因 innerHTML 清除可容忍但不理想

---

### 2026-03-15 — 活動分享升級：LINE Flex Message + shareTargetPicker
- **問題**：活動分享只能發送純文字，無法在 LINE 中發送精美卡片
- **修復**：新建 `js/modules/event-share.js`，覆蓋舊 `shareEvent`，實作 Flex Message 卡片 + shareTargetPicker + 底部選單（分享到 LINE / 複製連結）+ 建立活動後自動提示分享
- **修改檔案**：新建 `event-share.js`、修改 `event-list.js`（移除舊 shareEvent）、`event-create.js`（建立後觸發分享提示）、`css/activity.css`（底部選單樣式）、`script-loader.js`（註冊 lazy-load）、`index.html`（script 標籤）
- **教訓**：shareTargetPicker 不支援 LINE 社群（OpenChat），需另提供複製連結選項；LIFF URL 不受 LINE Labs 設定影響，永遠在 LINE 內建瀏覽器開啟

### 2026-03-15 — [永久] 修復建立活動無反應 + 重複建立
- **問題**：點「建立活動」後無任何反饋（toast 不顯示、modal 不關閉），用戶多次點擊導致重複建立活動
- **原因**：`finally` 區塊在 `closeModal()` / `showToast()` 之前就重置了 `_eventSubmitInFlight=false` 並重新啟用按鈕。中間 `_saveInputHistory` 等非關鍵操作若拋錯，closeModal / showToast 永遠不執行，而按鈕已可再次點擊
- **修復**：重構 try/catch 結構 — 關鍵收尾（closeModal + showToast + flag reset）緊接 createEvent 成功後執行；非關鍵操作（saveHistory / writeOpLog / grantEXP / render）包在獨立 try/catch 中。編輯路徑同步修復
- **教訓**：`finally` 不應用於重置 UI 鎖定狀態（如提交按鈕），因為它在 success path 其他操作之前執行。關鍵收尾操作（modal 關閉、用戶通知）必須放在非關鍵操作之前，且不依賴非關鍵操作的成功

### 2026-03-17 — 新增教育型俱樂部系統（MVP 全 8 Phase）
- **問題**：現有系統缺少面向兒童教學的場景，教練需要不建活動就能簽到、行事曆式出席追蹤、學員分組管理
- **修復**：完整實作教育型俱樂部 MVP，包含 8 個階段：
  - Phase 1: 基礎建設（type=education 欄位、edu-helpers.js）
  - Phase 2: 分組管理 + 學員註冊（groups/students 子集合 CRUD、申請審核流程）
  - Phase 3: 課程方案（weekly/session 兩種類型）
  - Phase 4: 簽到流程（批次簽到 + QR 掃碼混合模式）
  - Phase 5: 行事曆卡片 UI（集點卡 + 月曆雙視圖切換）
  - Phase 6: 家長-孩子綁定（eduChildren on users doc）
  - Phase 7: 通知（簽到成功推播、課前提醒、出席報告）
  - Phase 8: 俱樂部列表 Tab 篩選（全部/運動/教學）
- **新增檔案**：15 個 JS 模組（js/modules/education/）、1 個 HTML（pages/education.html）、1 個 CSS（css/education.css）
- **修改檔案**：firebase-crud.js、api-service.js、firestore.rules、page-loader.js、script-loader.js、team-detail.js、team-form.js、team-form-init.js、team-form-join.js、team-list.js、team-list-render.js、team.html、team.css、index.html、config.js、architecture.md
- **教訓**：eduAttendance 獨立為頂層集合（非 attendanceRecords 子集合），因為教育簽到沒有 eventId、查詢模式完全不同、分開避免污染現有統計

### 2026-03-18 — 歷史 EXP 回推補發 Cloud Function（backfillAutoExp）
- **功能**：掃描 registrations / attendanceRecords / events，比對 expLogs，補發從未發放的 Auto-EXP（模式 A：補差額）
- **新增**：`functions/index.js` 新增 `backfillAutoExp` CF、`pages/admin-auto-exp.html` 新增回推區塊、`js/modules/auto-exp.js` 新增 `runAutoExpBackfill()`
- **去重三層保護**：(1) expLogs reason 解析 + eventId↔title 雙向映射、(2) `_expDedupe` collection 前綴查詢、(3) `queuedSet` 防同次 run 重複
- **教訓**：線上 `_grantAutoExp` 用 event.title 作 context，backfill 用 eventId 作 context，去重必須雙向映射才能正確比對；同一 userId+eventId 可能有多筆 registration doc（companion），需 queuedSet 防重複

### 2026-03-18 — Auto-EXP Production 路徑遺漏修復
- **問題**：用戶報名活動後 EXP 不增加（register_activity 設 3，報名前後積分皆 27）
- **原因**：`_grantAutoExp` 呼叫只存在於 Demo 模式的 code path，Production 路徑完全沒有呼叫
- **修復**：
  - `event-detail-signup.js`：Production 報名成功後加 `_grantAutoExp(userId, 'register_activity', e.title)`
  - `event-detail-signup.js`：Production 取消報名後加 `_grantAutoExp(userId, 'cancel_registration', e0.title)`
  - `event-detail-companion.js`：Production 同行者取消後加 `_grantAutoExp(userId, 'cancel_registration', e.title)`
- **教訓**：Demo / Production 分支邏輯容易遺漏，新增功能時必須確認兩個路徑都有覆蓋；可用 backfillAutoExp CF 補發歷史缺漏

### 2026-03-18 — 成就徽章 threshold=0 導致 level 0 誤拿徽章
- **問題**：等級 0 用戶在報名名單內顯示拿到需要等級 1 的徽章
- **原因**：Firestore 存了 `condition.threshold: 0`，evaluator 直接讀取未經 normalizeCondition 保護，`0 >= 0 = true`
- **修復**：evaluator.js + stats.js 的 isCompleted 加 `Math.max(1, rawTarget)` for non-reverseComparison types
- **教訓**：threshold 從 Firestore 讀取時不可信任原值，非 reverseComparison 類型必須 clamp 至少為 1

### 2026-03-18 — 成就條件預覽 reach_level/reach_exp threshold 未顯示
- **問題**：等級目標輸入 1，條件預覽文字看不到數值
- **原因**：shared.js `describeCondition` 中 `if (!unit && threshold <= 1) return actionLabel` 跳過數值，reach_level/reach_exp 的 unit 為空字串
- **修復**：config.js 中 reach_level unit 改為 `'級'`、reach_exp 改為 `'點'`

### 2026-03-20 — 全面修正 12 處跨裝置排序不一致 + 角色快取計數問題
- **問題**：不同手機看到的名單排序、候補人數、費用計算等有差異
- **原因**：Firestore 無 `.orderBy()` 時 document 排列為 ID 字典序，不同裝置 cache sync 時序不同導致 Array 原始順序不一致；非管理員角色只拿到自己的 registrations，計數函式卻以 registrations 陣列長度為準
- **修復**：
  - `event-manage-waitlist.js`：候補名單加 registeredAt → docId 排序
  - `message-render.js`：訊息列表加 time desc 排序
  - `news.js`：新聞加 publishedAt desc 排序
  - `tournament-render.js`：賽事列表加 name 排序（ongoing + timeline）
  - `team-list.js`：非置頂俱樂部加 name 排序（取代 return 0）
  - `shop.js`：商品加 createdAt desc → name 排序
  - `user-admin-list.js`：用戶管理列表加 name 排序
  - `event-manage-attendance.js`：未報名表格加 name 排序
  - `announcement.js`：跑馬燈加 sortOrder 排序
  - `scan-ui.js`：統計報名人數改用 event.current（文件欄位）
  - `event-manage.js`：費用計算 confirmedCount 改用 event.current 優先
- **教訓**：所有從 Firestore 快取取出的陣列在渲染前必須顯式排序；涉及人數計算的場景必須優先使用 event document 欄位（由 transaction 維護），不可依賴 registrations 陣列長度

### 2026-03-20 — _rebuildOccupancy 排序修正：Admin vs 一般用戶候補順序不一致
- **問題**：Admin 看候補第 9 位是 MWC，一般用戶看到是 baskara
- **原因**：Admin 從 registrations（已排序）渲染；一般用戶從 event.waitlistNames（文件欄位）渲染。`_rebuildOccupancy` 寫入 waitlistNames 時沒有排序，順序取決於 Firestore 文件 ID 字典序
- **修復**：`firebase-crud.js` `_rebuildOccupancy` 加入 registeredAt → docId 排序（confirmed + waitlisted），確保寫入 Firestore 的 participants / waitlistNames 順序與前端一致；同時修正 scan-ui.js 已報名/未報名標籤排序
- **教訓**：凡是寫入 Firestore 的陣列欄位，若前端會直接用該順序渲染，寫入前必須排序。`_rebuildOccupancy` 是名單順序的唯一寫入源頭，排序必須在此處保證

### 2026-03-20 — 首次/久未開啟用戶空白首頁
- **問題**：首次開網站或太久沒開的用戶，首頁除了 LINE 頭像外無任何資料
- **原因**：三因素疊加：(1) localStorage 快取為空（首次/過期）→ _restoreCache 失敗；(2) Firestore WebSocket 連線慢 → 6 秒 init timeout；(3) timeout 路徑提前 return，跳過 `_schedulePostInitWarmups()`，且背景中 `_loadEventsStatic()` 完成後無人觸發重新渲染。另外 `sw.js` STATIC_ASSETS 包含不存在的 `mode.js` 導致 cache.addAll 每次必定失敗，SW cache 形同虛設
- **修復**：(1) `firebase-service.js` timeout 路徑新增 `_continueLoadAfterTimeout()` — 背景繼續載入 events + boot collections，完成後觸發 `App.renderAll()` + `_schedulePostInitWarmups()`；(2) `sw.js` 移除不存在的 `./js/core/mode.js`
- **教訓**：timeout 不代表放棄 — 應設計「timeout 先給用戶兜底畫面，背景繼續載入完成後補渲染」的模式。STATIC_ASSETS 列表變更時必須驗證所有檔案存在

### 2026-03-20 — Safari PWA 活動人數不更新（zombie listener + 缺少 events 刷新）
- **問題**：Safari PWA 安裝在桌面的用戶，首頁活動卡片人數永遠是舊數據，退出重進也不更新
- **原因**：(1) `_handleVisibilityResume()` 只刷新 registrations 不刷新 events — 首頁人數來自 `event.current`/`event.waitlist`（event 文件欄位），不是 registrations；(2) Safari PWA 凍結/恢復後 onSnapshot WebSocket 可能已失效（zombie listener），但不觸發 onerror；(3) 沒有 `pagehide` handler，PWA 關閉前 30 秒 debounce 的快取持久化來不及寫入
- **修復**：(1) `_handleVisibilityResume` 加入 `_refreshEventsOnResume()` — 每次恢復時一次性查詢最新 events 並觸發首頁重繪；(2) `_setupVisibilityRefresh` 加入 `pagehide` handler 強制持久化快取
- **教訓**：Safari PWA 的 WebSocket 在凍結/恢復後不可信賴，visibilitychange 恢復時應對所有首頁關鍵資料做一次性查詢兜底，不能只依賴 onSnapshot listener

### 2026-03-21 — 敵人遠程攻擊系統（弓箭手/法師/哥布林弓手）
- **問題**：弓箭手、法師、哥布林弓手應該是遠程攻擊角色，但原本與近戰角色行為完全一樣
- **修復**：(1) PROFILES 新增 `ranged: true, projType: 'arrow'/'magic'`；(2) 攻擊時改為發射投射物，命中率隨距離遞減（90%→5%）；(3) 遠程 AI 在距離 <80px 時逃跑保持距離；(4) 新建 `color-cat-enemy-projectile.js` 處理投射物物理/繪製/命中判定/粒子特效；(5) 拆出 `color-cat-enemy-util.js` 保持主檔案 <300 行
- **教訓**：enemy.js 已接近 300 行上限，戰鬥工具函式（getClicked/dealDamage 等）可獨立為子模組，透過 stub 覆蓋模式與核心解耦

### 2026-03-21 — 傷害飄字、死亡重生睡覺、球拖曳系統
- **問題**：(1) 被攻擊時無傷害數值顯示；(2) 死亡重生直接站著，不自然；(3) 球無法拖曳互動
- **修復**：(1) 新建 `color-cat-damage-number.js` — 敵人被打黃色飄字、主角被打紅色飄字，連打疊加；(2) 重生 phase 3 改為 `sleeping` 狀態在紙箱內登場；(3) `color-cat-ball.js` 新增拖曳模式 + scene.js 加入 mousedown/mousemove/touchstart/touchmove 事件，拖曳球時角色自動追球，踢中後解除拖曳並擊飛
- **教訓**：Canvas 拖曳需在 touchmove 中 preventDefault 避免頁面捲動，且 mouseup 後要攔截 click 事件避免重複觸發

### 2026-03-22 — 模組拆分（flower→butterfly、actions→interact/special）
- **問題**：`color-cat-scene-flower.js`（526 行）和 `color-cat-character-actions.js`（751 行）超過 300 行限制
- **修復**：(1) 從 flower.js 拆出 `color-cat-scene-butterfly.js`（176 行），花檔降為 270 行；(2) 從 actions.js 拆出 `color-cat-character-actions-interact.js`（192 行，擊退+花互動）和 `color-cat-character-actions-special.js`（236 行，蝴蝶+大絕招），核心檔降為 270 行
- **教訓**：跨 IIFE 拆分用 `_` 共享命名空間；拆出檔透過 `if (_.fn) _.fn()` 惰性呼叫；載入順序須確保核心先載、子檔後載（GrowthGames.html + script-loader.js 都要更新）

### 2026-03-22 — 個人頁畫布加入日月星空 + 鑰匙下移
- **問題**：靜態個人頁畫布（`_drawStaticBg`）在暗色模式下沒有月亮和星空，與互動場景不一致；鑰匙圖示位置偏高
- **修復**：(1) 在 `color-cat-scene.js` 新增 `_staticStars` 預生成 30 顆星陣列（固定 alpha，無動畫），暗色模式繪製星空+新月；(2) `_keyY` 從 `textY+38` 改為 `textY+43`，下移 5px
- **教訓**：靜態場景無動畫迴圈，星星不能用 `_starTimer` 閃爍，須用預生成固定值陣列

### 2026-03-22 — user-admin-list.js 亂碼修復
- **問題**：行 286 和 343 的 showToast 內容為亂碼 `'甈?銝雲'`（含 PUA 字元 U+F4C4、U+F69A），用戶看到不可讀文字
- **原因**：歷史編碼損壞（疑似 Big5/CP950 → UTF-8 轉換時產生 mojibake）
- **修復**：根據語境以 binary 方式替換：行 286（權限檢查）→ `'權限不足'`；行 343（無欄位變更）→ `'沒有變更'`
- **教訓**：PUA 字元在 Read 工具顯示為 `?`，Edit 工具無法匹配；需用 Python binary replace 處理

### 2026-03-22 — 導航 Tab 智慧 Toast 提示
- **問題**：(1) QR Code Toast 在腳本已載入時仍顯示「生成中」；(2) 賽事 Tab 被硬編碼封鎖無法進入；(3) 頁面腳本未就緒時無載入提示
- **原因**：QR toast 放在 `showUidQrCode` 檢查之前；賽事 Tab 有寫死的 `return`；導航未檢查 ScriptLoader 載入狀態
- **修復**：(A) `app.js` — 將 QR toast 移入 `if (!this.showUidQrCode)` 內；(B) `navigation.js` — 移除賽事封鎖，加入 `ScriptLoader.isPageReady()` 判斷，未就緒時 toast「載入中…」；(C) `script-loader.js` — 新增 `isPageReady(pageId)` 同步方法
- **教訓**：Toast 提示應以實際狀態為依據，不可無條件顯示；封鎖功能入口應使用 config flag 而非硬編碼 return

### 2026-03-22 — 總管隱身模式改存 Firestore 持久化
- **問題**：隱身狀態存 localStorage，LINE WebView 重啟 / App 更新 / iOS ITP 會清除，導致隱身經常失效
- **原因**：localStorage 在 LINE in-app browser 中不可靠，非持久儲存
- **修復**：`_isAdminStealth()` 改為優先讀 user doc `stealth` 欄位（Firestore），fallback localStorage；`_toggleAdminStealth()` 同時寫 localStorage + `ApiService.updateCurrentUser({ stealth })`；新增 `_syncStealthFromUser()` 在 `applyRole()` 中同步 Firestore → localStorage
- **教訓**：需要跨 session 持久的用戶偏好不應只存 localStorage，應以 Firestore user doc 為 source of truth，localStorage 僅作啟動快取

### 2026-03-23 — 體力改為純 HP + 睡覺可被叫醒 + 統計彈窗觸控穿透修復
- **問題**：(1) 所有動作消耗體力不合理，體力應純作 HP；(2) 角色在紙箱內/上時無法被其他動作叫出；(3) 戰績統計彈窗拖曳時觸控事件穿透到後方個人頁
- **修復**：(A) `color-cat-character-stamina.js` — 移除所有動作體力消耗（chase/kick/dash/biteBall/combo/test），僅保留被攻擊扣血和恢復邏輯；(B) `color-cat-character-actions-special.js` — 大絕招結束不再扣體力/觸發虛弱，直接回 idle；(C) 三個檔案（actions-interact/actions-special/combat）加入 `_wakeIfSleeping()` helper，6 個動作函式移除 sleeping 封鎖改為自動醒來；(D) `color-cat-scene-stats-modal.js` — modal 加 `touch-action:none` CSS，overlay 加 touchmove preventDefault + touchstart stopPropagation
- **教訓**：角色狀態機中「封鎖動作」vs「自動轉換狀態」是不同策略，後者互動性更好；彈窗觸控穿透需 CSS + JS 雙重阻擋

*最後濃縮日期：2026-03-15*
*原始檔案：314 條目 / 2475 行 → 濃縮後約 50 條永久教訓*
