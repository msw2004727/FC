### 2026-03-12 — 修正 admin 使用者刪除活動時被舊 token 權限卡住
- **問題**：部分已經升成 `admin` 的使用者，在活動管理頁刪除活動時仍會一直失敗；前端畫面已顯示管理員權限，但 Firestore 寫入仍被當成一般用戶拒絕。
- **原因**：`firestore.rules` 的 `authRole()` 先讀 `request.auth.token.role`，只有 token 沒帶 role 時才 fallback `users/{uid}.role`。當使用者剛被升權、token 還沒刷新時，就會出現 `users` 文件已是 `admin`、token 仍是 `user` 的不一致；Cloud Functions 的 `getCallerRoleWithFallback()` 也有同樣偏向舊 token 的問題。
- **修復**：更新 `firestore.rules`，改成 authenticated request 一律優先讀 `users/{uid}.role`，找不到 user doc 時才 fallback token role；同步更新 `functions/index.js` 的 `getCallerRoleWithFallback()` 採用同一套來源優先順序；另外在 `tests/firestore.rules.test.js` 補上「升權後 token 仍是 user 應可刪除」與「降權後 token 仍是 admin 應被拒絕」兩個回歸測試。
- **教訓**：權限判斷若同時依賴 custom claims 與 Firestore user doc，必須先定義單一 authoritative source；否則 UI 已升權、寫入仍 permission-denied 的問題會反覆出現，而且還可能留下降權後舊 token 殘留權限的安全風險。

### 2026-03-12 — 補上全站頁面快取與載入策略擴張規格書
- **問題**：首頁與活動頁已經有成熟的 `cache-first / stale-first / delayed realtime` 經驗，但全站其他頁面尚未形成統一分型；若直接把同一招硬搬到個人頁、球隊頁、賽事頁與後台頁，容易把不該用舊資料的頁面也套進去，造成誤操作風險。
- **原因**：目前頁面優化經驗主要散在 `navigation.js`、`firebase-service.js`、`architecture.md` 與 `claude-memory` 歷史記錄，缺少一份把「哪些頁面適合哪種策略、施工順序、風險與驗收」整理成正式規格的文件。
- **修復**：新增 [docs/page-cache-loading-strategy-expansion-spec.md](docs/page-cache-loading-strategy-expansion-spec.md)，把全站頁面拆成 `快取先開型`、`快取先看但操作前先確認型`、`先準備關鍵資料再開型`、`fresh-first 型` 四類，並補上頁面分組、施工步驟、自我驗收、工作量評估、可能 BUG 與修復方式，作為後續擴張策略的施作前依據。
- **教訓**：快取策略不能只看「快不快」，還要先看頁面資料敏感度與操作風險；先做頁面分型與資料契約，再做 stale-first 擴張，才不會把架構優化做成新的資料正確性問題。

### 2026-03-12 — 成就 Phase 7 補上只讀快照與最終整合驗收
- **問題**：Phase 6 雖然已把成就條件收斂成正式模板，但第三方角度重跑時發現成就頁、稱號頁與後台 render 仍會直接呼叫 `App._evaluateAchievements()`，把全域 `achievements.current/completedAt` 洗成當前操作者的結果；這會造成 super admin 進後台後，把一般使用者的完成狀態蓋掉，稱號 sanitize 也因此誤判。
- **原因**：前幾個 phase 先完成資料夾化與 facade，相容層看起來已穩定，但顯示層仍沿用舊習慣，把「render 前順手重算並寫回 Firestore」當成資料來源；`titles.js`、`badges.js`、`profile.js`、`view.js` 都還沒有真正切到只讀快照。
- **修復**：在 `js/modules/achievement/evaluator.js` 新增只讀 `getEvaluatedAchievements()`，讓 `js/modules/achievement/view.js`、`js/modules/achievement/badges.js`、`js/modules/achievement/titles.js`、`js/modules/achievement/profile.js` 改用目標使用者快照計算，不再於 render 時持久化寫回；`js/modules/achievement/admin.js` 與 `js/modules/achievement.js` 的後台 render fallback 也移除 `_evaluateAchievements()`；另外補上 [docs/achievement-phase1-7-final-self-check.md](docs/achievement-phase1-7-final-self-check.md)、[docs/achievement-phase1-7-manual-checklist.md](docs/achievement-phase1-7-manual-checklist.md) 與 `scripts/achievement-phase1-7-final-smoke.js`，把 Phase 1~7 的最終整合驗收固定化。
- **教訓**：資料夾化只解決結構，沒解決「render 污染資料」就不算真的收尾；只要顯示層還能在無感情況下寫回共享資料，就一定要補一層只讀快照，把讀與寫分開。

### 2026-03-12 — 成就 Phase 6 清掉假條件並對齊正式模板
- **問題**：成就系統雖然已經完成資料夾化骨架，但 `ACHIEVEMENT_CONDITIONS`、`registry`、`evaluator`、後台表單與預設 seed 仍同時存在假條件；像 `organize_event`、`30d + complete_event`、`earn_badges` 仍會出現在資料或種子裡，`join_team` 觸發也還可能誤算審核者，前台與後台沒有真正共用同一套正式支援規則。
- **原因**：Phase 1 到 5 先處理結構與 facade，相容層完成後才開始接回 condition 規格；因此前一階段 registry 仍保留過渡用 metadata，seed 與 title display 也還沒有配合正式支援清單收斂。
- **修復**：將 `js/config.js` 的正式條件收斂成只剩可上架 action 與 `timeRange=none`；重寫 `js/modules/achievement/registry.js`，加入正式支援判斷、field state 與 legacy label fallback；修正 `js/modules/achievement/evaluator.js` 僅評估 supported condition，`attendance_rate` 改共用 attendance stats helper，`join_team` 改保留已達成狀態，並在 `js/modules/message-inbox.js` 以申請者 `uid` 觸發；`js/modules/achievement/admin.js` 改由 registry 驅動表單並在後台自動清理不支援 achievement / orphan badge；`js/firebase-service.js` 的預設 seed 改成正式模板；`js/modules/achievement/titles.js` 與 `js/modules/profile-data.js` 補上失效稱號 sanitization；另外修正 `js/api-service.js` 的 achievement / badge 刪除為真正 await Firebase 寫入。
- **教訓**：條件重構不能只改 action 清單，必須同時收斂 seed、cleanup、顯示層與刪除流程；而且只要有「後台 await、底層卻 fire-and-forget」這種斷層，資料清理就會變成看似成功、實際失敗。

### 2026-03-12 — 成就 Phase 5 抽離 admin helper
- **問題**：成就後台管理的列表渲染、表單、圖片上傳與 CRUD 還全塞在 `js/modules/achievement.js`，而且表單選單初始化與徽章上傳綁定沒有穩定掛進 admin 頁生命週期，寫入流程也沒有 `await`，有 race risk；另外舊 facade 一度寫成「直接 return 新 helper」，若新模組缺件會讓 fallback 失效。
- **原因**：Phase 1 到 4 先抽了 registry、evaluator 與 profile-facing helper，但 admin side 還停留在舊 facade；後台頁面依賴 `achievement.js` 內部狀態，導致模組邊界不清楚，也讓 `script-loader` 難以反映真實依賴；同時相容層的委派寫法不夠保守。
- **修復**：新增 `js/modules/achievement/admin.js`，把 `renderAdminAchievements`、表單行為、徽章圖片上傳、`save/toggle/delete` 流程集中到 admin helper，並改為真正的 `async/await`；`js/modules/achievement.js` 改成「有 admin helper 才委派，否則保留舊 fallback」；另外把 `js/modules/profile-data.js` 的稱號入口補回 fallback，避免新 helper 缺件時整段無反應；同時更新 `js/modules/achievement/index.js`、`js/core/script-loader.js`、`index.html`、`docs/architecture.md`，快取版本升到 `20260312k`。
- **教訓**：資料夾化不能只抽純 helper，後台頁面的互動狀態與 CRUD 也要一起收口；另外相容層不能寫成無條件直通，必須保留舊 fallback，才能真的做到逐步搬移而不是一次性切換。

### 2026-03-12 — 成就 Phase 4 抽離 badge/title/profile helper
- **問題**：成就相關的徽章數、稱號顯示、稱號頁與個人名片 badge list 邏輯仍散在 `profile-data.js`、`profile-core.js`、`profile-card.js`、`personal-dashboard.js`、`leaderboard.js`，雖然 Phase 1-3 已完成骨架與 evaluator，但 profile-facing 顯示責任還沒有真正抽進 achievement 資料夾。
- **原因**：舊個人頁模組直接讀 `achievement stats` 或自行組 HTML，導致 badge/title 顯示與個人頁 UI 耦合；同時 `script-loader` 的 `profile` / `personalDashboard` 群組漏載真依賴，未來改成更明確的 lazy loading 時會有缺件風險。
- **修復**：新增 `js/modules/achievement/badges.js`、`js/modules/achievement/titles.js`、`js/modules/achievement/profile.js`，並在 `js/modules/achievement/index.js` 補上 part getter；將 `profile-data.js` 的稱號相關方法改為轉接新 helper，將 `profile-core.js`、`profile-card.js`、`personal-dashboard.js`、`leaderboard.js` 的 badge/title 顯示改接 `achievement profile` helper；同步修正 `js/core/script-loader.js` 的 achievement/profile/personalDashboard 載入邊界、更新 `docs/architecture.md`、以及快取版本 `20260312j`。
- **教訓**：做資料夾化時不要只搬 evaluator 與純 helper，連同 profile-facing display adapter 也要一起收口；另外 `script-loader` 群組必須跟真實依賴保持一致，不然之後縮小全域預載時很容易出現頁面只在某些入口壞掉的隱性 bug。
### 2026-03-12 — 第三方驗收補修成就 Phase 1-3 遺漏
- **問題**：第三方角度重驗 `Phase 1-3` 時，發現兩個先前 smoke test 沒覆蓋到的瑕疵：一是徽章數（`badgeCount`）其實在算完成成就數，遇到成就沒有對應徽章時會高估；二是 `activityRecords` fallback 在沒有 `registrations` 可用的 legacy 情境下，沒有完整尊重後續的 `cancelled / removed` 狀態。
- **原因**：`stats.js` Phase 2 先抽成共用 helper 時延續了舊的「完成成就數 = 徽章數」假設；`evaluator.js` Phase 3 雖然加了 `activityRecords` fallback，但只收 `registered / waitlisted`，忽略了較晚出現的取消或移除記錄。
- **修復**：調整 `js/modules/achievement/stats.js`，讓徽章數改為依實際存在且已獲得的 badge view model 計算；調整 `js/modules/achievement/evaluator.js` 的 `activityRecords` fallback，改成以較新的 `createdAt` / 順序決定事件最終狀態，並正確排除已取消或移除的紀錄。
- **教訓**：抽 helper 與做 fallback 時，不能只驗正常路徑；第三方驗收要刻意用「資料缺欄位」、「關聯被刪除」、「舊資料補算」這些不乾淨樣本去撞，才抓得到真實回歸風險。

### 2026-03-12 — 成就系統 Phase 3 改為 registry 驅動評估
- **問題**：成就條件判定仍停留在舊版 `if/else` evaluator，`registry.js` 只包住 `ACHIEVEMENT_CONDITIONS`，沒有真正承接 action 支援狀態、timeRange fallback 與事件型條件的統一入口；既有 seed 內的 `attendance_rate`、`bind_line_notify`、`organize_event`、`30d + complete_event` 也沒有完整的集中式邏輯可維護。
- **原因**：Phase 1 只先建立 achievement 領域骨架與 facade，相容層完成了，但 action metadata 與 evaluator handler 仍未真正拆開，導致後續 UI、資料清理與條件精簡都缺少單一真實來源。
- **修復**：重寫 `js/modules/achievement/registry.js`，加入 supported action metadata、event trigger 判定、timeRange fallback 與支援狀態查詢；重寫 `js/modules/achievement/evaluator.js`，改成 registry-driven handler，集中支援 `register_event`、`complete_event`、`organize_event`、`attend_*`、`attendance_rate`、`reach_level`、`reach_exp`、`join_team`、`complete_profile`、`bind_line_notify`、`days_registered`，並讓 unsupported action 安全略過不崩潰；同步更新 `docs/architecture.md`。
- **教訓**：資料夾骨架建立後，下一步不能只「搬檔」，還要盡快把舊邏輯背後的能力表與 handler 抽成 registry-driven，否則 facade 只是換位置，沒有真正形成可擴充邊界。

### 2026-03-12 — 啟動成就系統 Phase 2 共用計算收斂
- **問題**：徽章數、已獲得徽章與稱號可選清單分散在個人頁、名片、排行榜、個人儀表板與成就頁各自重算，未來只要改一個條件公式，就很容易出現頁面間統計不一致。
- **原因**：Phase 1 雖然先建了 `achievement` 資料夾骨架，但 Phase 2 之前還沒有把衍生統計抽成單一 helper，消費端仍直接各自讀 `achievements / badges` 手動判斷完成條件。
- **修復**：新增 `js/modules/achievement/stats.js`，集中處理 `badgeCount`、`earnedBadgeViewModels`、`titleOptions` 等共用計算；`profile-core.js`、`profile-card.js`、`profile-data.js`、`personal-dashboard.js`、`leaderboard.js`、`achievement.js` 改吃同一套 helper；同步更新 `docs/architecture.md` 與快取版本 `20260312g`。
- **教訓**：資料夾化不能只搬檔案，還要優先收斂被多處重算的衍生資料；否則 facade 在、資料夾也在，但實際邏輯仍是多頭維護。

### 2026-03-12 — 啟動成就系統 Phase 1 資料夾骨架
- **問題**：achievement 系統已完成 `Phase 0` 盤點，但若不先建立領域資料夾與 facade，相同的 helper、條件設定與 evaluator 仍會繼續堆在 `js/modules/achievement.js` 內，後續無法安全進入模組化拆分。
- **原因**：舊版 achievement 模組同時混有條件描述、條件評估、前台 render、後台 CRUD 與 badge 圖片上傳，而外部頁面與流程又直接依賴 `App.renderAchievements()`、`App.renderAdminAchievements()`、`App._evaluateAchievements()` 等舊入口。
- **修復**：新增 `js/modules/achievement/index.js`、`registry.js`、`shared.js`、`evaluator.js` 建立第一版 achievement 領域骨架；更新 `js/modules/achievement.js` 保留舊入口方法名稱，但將 `_generateConditionDesc`、`_getAchThreshold`、`_sortByCat`、`_evaluateAchievements` 轉為 facade 轉呼叫；同步更新 `js/core/script-loader.js`、`docs/architecture.md`、`js/config.js`、`index.html` 快取版本到 `20260312f`。
- **教訓**：拆舊系統時，第一步應先把「對外入口穩住」，再把內部責任抽成子模組；若一開始就直接改外部方法名稱，路由、按鈕與業務流程會一起承受回歸風險。

### 2026-03-12 — 完成成就系統 Phase 0 盤點
- **問題**：achievement 資料夾化重構雖然已有分期計畫，但若沒有先盤點真實入口、外部呼叫點、責任分布與高風險耦合點，進入 `Phase 1` 時仍容易漏拆或誤拆。
- **原因**：目前成就 / 徽章 / 稱號邏輯不只存在於 `js/modules/achievement.js`，還分散在 profile、leaderboard、dashboard、signup、message、navigation、config、firebase-service 與 CRUD 層，表面上像單一功能，實際上是多模組耦合。
- **修復**：新增 `docs/achievement-phase0-inventory.md`，完成 `Phase 0` 盤點，明確列出頁面入口、業務觸發點、舊入口保留清單、第一批可抽離責任、資料依賴地圖與目前高風險點，作為後續 `Phase 1` 建立 `js/modules/achievement/` 資料夾骨架的施工依據。
- **教訓**：要把既有大模組拆成領域資料夾時，第一步不是先搬檔案，而是先把「誰在呼叫、誰在寫資料、誰在重算同一件事」盤點清楚，否則資料夾化只會把混亂搬到新位置。

### 2026-03-12 — 新增成就系統資料夾化重構計畫
- **問題**：成就 / 徽章 / 稱號系統雖然已整理出條件重構規格，但目前相關邏輯分散在多個模組與頁面，若直接進行條件重寫，後續仍需再做一次結構搬移，回歸風險偏高。
- **原因**：achievement 相關責任目前混在 `js/modules/achievement.js`、個人頁模組、排行榜、dashboard、報名流程與訊息流程中，尚未形成領域資料夾與相容層結構；同時專案層級文件也還沒把「保留舊入口、逐步模組化」列成正式演進目標。
- **修復**：新增 `docs/achievement-folder-refactor-plan.md`，定義以保留舊入口為前提的 achievement 資料夾化重構分期；同步更新 `AGENTS.md` 與 `CLAUDE.md`，將專案長期朝向功能模組化、資料夾化、責任邊界清楚，以及「先結構整理、再邏輯重寫」的原則寫入正式指引，並修正 `CLAUDE.md` 內一行既有亂碼規範。
- **教訓**：當某功能已跨越多頁面與多責任時，不應一邊大搬移一邊重寫業務邏輯；先建立相容層與資料夾骨架，能把結構風險與功能風險分開處理。

### 2026-03-12 — 新增成就條件重構規格書
- **問題**：成就 / 徽章 / 稱號系統準備進入重構，但目前缺少一份可直接施工的前置規格文件，無法在實作前鎖定保留條件、刪除條件、驗收步驟與風險處理。
- **原因**：現有成就條件混有未實作 action、語意與資料來源不一致的條件，以及後台可選但實際無法正確上架的假條件；若沒有先做文件化，很容易在實作時再次分岔。
- **修復**：新增 docs/achievement-condition-refactor-spec.md，明確記錄保留 / 刪除條件、語意定義、模板註冊制、施工步驟、自我驗收項目、BUG 風險與修復方式，作為後續正式重構的唯一前置規格依據。
- **教訓**：當功能已進入「需要刪假條件、補真邏輯、保留未來擴充位」的階段，應先把可上架條件、資料來源與驗收標準文件化，避免後續實作再次失真。

### 2026-03-12 — 修正權限管理預設值隔夜失效
- **問題**：後台權限管理頁把角色權限調整好、甚至按下「儲存成預設（`saveRolePermissionDefaults`）」後，隔天重新開站會發現部分角色權限被打亂或掉回不正確狀態。
- **原因**：有兩個根因。第一，`角色權限（rolePermissions）` 即時同步把只有預設權限、沒有實際權限欄位的文件也當成空權限處理，導致只儲存 `defaultPermissions` 時，隔次載入會被誤認成 `permissions=[]`。第二，啟動補遷移（`_seedRoleData()`）在 `catalogVersion` 缺失時，會把內建預設權限重新合併回目前權限，覆蓋手動調整結果。
- **修復**：更新 `js/firebase-service.js`，讓 `角色權限（rolePermissions）` 監聽只在文件真的有 `permissions` 欄位時才覆寫目前權限，並讓補遷移優先保留既有權限與已儲存預設，不再把內建預設強灌回去；更新 `js/modules/user-admin-roles.js`，首次編輯尚未有文件的角色時，改以目前有效權限作為編輯基底；更新 `js/firebase-crud.js`，儲存權限與預設權限時同步寫入 `目錄版本（catalogVersion）`，避免隔次啟動再次觸發錯誤補遷移；同步更新 `js/config.js`、`index.html` 版本號為 `20260312e`。
- **教訓**：預設值（`defaultPermissions`）與實際值（`permissions`）必須嚴格分流；初始化補遷移只能補缺，不能在看不出使用者意圖時重寫現有權限，否則角色設定會在重新整理或隔天重開後被靜默覆蓋。

### 2026-03-12 — 個人頁報名統計改為應到場次
- **問題**：個人專頁的三格統計把未報名簽到、同行者簽到與候補紀錄混進來，導致「參加場次 / 完成 / 出席率」與報名紀錄清單定義不一致。
- **原因**：統計直接用 `出席紀錄（attendanceRecords）` 的 `checkin / checkout` 去重，且出席率分母只排除 `cancelled`，沒有排除 `waitlisted`、`removed`，也沒有排除同行者與未報名紀錄。
- **修復**：更新 `js/modules/leaderboard.js` 統計公式為「應到場次（已結束 + 本人 + 有效報名） / 完成場次（`checkin + checkout`） / 出席率（有 `checkin` ÷ 應到場次）」；同步排除同行者與未報名紀錄，並修正已結束候補不再顯示為 `missed`；更新 `pages/profile.html`、`js/modules/profile-core.js`、`js/modules/profile-card.js` 文案，並在 `js/modules/leaderboard.js` 留下公式備註；同步更新 `js/config.js`、`index.html` 版本號為 `20260312d`。
- **教訓**：個人頁統計與報名紀錄清單必須共用同一套母集合與狀態定義，否則 UI 名稱再清楚也會因分子分母不一致而失真。

### 2026-03-12 — 修復用戶補正頁的搜尋顯示與 Firestore 權限
- **問題**：放鴿子補正頁的用戶搜尋在名稱缺失時會重複顯示兩次 UID；同時按下「確認補正」會因 Firestore 規則拒絕而報 `Missing or insufficient permissions`。
- **原因**：搜尋結果、已選取提示與摘要卡直接用 `name || uid` 再額外拼接 UID，遇到名稱就是 UID 時會重複；另外 Firestore 規則只認 `rolePermissions` 文件中的權限碼，沒有承接前端對超級管理員（`super_admin`）的全權模型，導致補正寫入被擋下。
- **修復**：更新 `js/modules/user-admin-corrections.js`，抽出統一的用戶顯示字串 helper，避免名稱與 UID 重複輸出；更新 `firestore.rules`，讓放鴿子補正與歷史入隊補正都允許超級管理員直接操作，其他非一般用戶仍維持需開啟對應權限碼；同步更新 `js/config.js`、`index.html` 快取版本到 `20260312c`。
- **教訓**：前端權限與 Firestore 規則若同時存在「預設全權」與「文件化權限」兩套來源，兩邊必須明確對齊；否則 UI 看起來可用，實際寫入仍會被後端拒絕。

### 2026-03-12 — 用戶補正管理與放鴿子補正上線
- **問題**：原本只有單一的「歷史入隊補正」入口，缺少可管理放鴿子次數的後台工具；同時活動詳細頁的放鴿子統計規則仍是「未完成簽到加簽退」而不是新需求的「未簽到」。
- **原因**：放鴿子統計邏輯散落在活動管理模組，沒有補正資料層；既有補正頁也沒有頁籤、用戶搜尋、補正公式與權限細分，Firestore 規則也無法承接新集合與新權限碼。
- **修復**：更新 `pages/admin-system.html`、新增 `js/modules/user-admin-corrections.js`，將入口改為「用戶補正管理」並拆成「歷史入隊補正」與「放鴿子修改」雙頁籤；更新 `js/modules/event-manage.js`，將放鴿子定義改為只看是否完成簽到，並套用 `userCorrections` 補正差額後再顯示；更新 `js/api-service.js`、`js/firebase-service.js`、`js/firebase-crud.js`、`js/core/navigation.js`、`js/core/script-loader.js`、`js/modules/role.js`、`js/modules/user-admin-list.js`、`js/config.js`、`js/i18n.js` 與 `firestore.rules`，加入用戶補正集合、子權限、頁面渲染與 Firestore 權限；同步更新 `docs/architecture.md`，並將快取版本升到 `20260312a`。
- **教訓**：涉及公開統計又要允許人工赦免時，不能直接回寫歷史出席資料；應把原始統計與補正差額拆開，並讓前台顯示、後台工具與 Firestore 規則共用同一套權限定義。

### 2026-03-11 — 活動費用欄位預設改為 0
- **問題**：活動費用開關在沒有有效金額時，一打開就會自動帶入 `300`，不符合要以 `0` 當預設值的需求。
- **原因**：活動建立、編輯與表單重置流程中的費用欄位 fallback 都硬編碼為 `300`，包含 HTML 初始值、開關打開時的補值，以及編輯既有活動時的回填預設。
- **修復**：更新 `pages/activity.html`、`js/modules/event-create.js`、`js/modules/event-manage.js`，將活動費用 input 的初始值、placeholder、開關打開時的 fallback、建立/編輯表單回填與重置值全部改為 `0`；同步更新 `js/config.js`、`index.html` 快取版本到 `20260311am`。
- **教訓**：表單預設值不能只改單一 input，還要一起檢查初始化、回填、toggle 補值與 reset 流程，否則不同入口會出現不一致預設。

### 2026-03-11 — 活動結束時自動關閉費用開關
- **問題**：活動若有開啟費用開關，活動狀態切成已結束後，費用開關仍維持開啟，導致已結束活動還會繼續顯示收費資訊。
- **原因**：現有各條結束活動路徑只更新活動狀態（`status = ended`），沒有同步把費用開關（`feeEnabled`）關閉；同時管理端與場主儀表板的費用統計又直接依賴費用開關判斷，若直接關閉會連內部統計一起消失。
- **修復**：更新 `js/api-service.js`，統一將活動更新為已結束時自動補上 `feeEnabled: false`；更新 `js/firebase-crud.js`，補齊報名守門流程直接寫入 `events` 的 ended 同步；更新 `app.js` 新增原始費用 helper，並調整 `js/modules/event-manage.js`、`js/modules/personal-dashboard.js` 改讀原始費用金額，讓公開頁面在活動結束後自動隱藏費用，但管理端應收/實收與場主營收統計仍保留。
- **教訓**：像費用開關這種同時影響公開顯示與內部統計的欄位，不能只改單一 UI 邏輯；要先分離「是否對外顯示」與「是否保留歷史金額統計」兩種用途。

### 2026-03-11 — 放鴿子次數欄位改為 0 不顯示
- **問題**：活動詳細頁新增放鴿子次數欄位後，未放鴿子的使用者會看到 `0`，畫面過於擁擠，不符合只突出有放鴿子紀錄者的需求。
- **原因**：欄位渲染邏輯直接輸出統計數字，只要成功解析到使用者 UID，就會把 `0` 也顯示出來。
- **修復**：更新 `js/modules/event-manage.js`，將放鴿子次數欄位改為僅在數字大於 `0` 時顯示；`0` 改為空白，仍保留無法辨識實際帳號時顯示 `—` 的行為；同步更新 `js/config.js`、`index.html` 快取版本到 `20260311ak`。
- **教訓**：統計型欄位若重點在風險提示，預設應優先隱藏「正常值」，只讓異常值出現在視覺上，能減少列表雜訊。

### 2026-03-11 — 活動詳細頁出席表新增放鴿子次數欄位
- **問題**：活動詳細頁的出席表只能顯示簽到、簽退與備註，無法公開呈現報名者歷史上已報名但未完成簽到簽退的次數。
- **原因**：出席表資料只讀取當前活動的簽到紀錄（`attendanceRecords`）與報名資料（`registrations`），沒有把歷史活動紀錄（`activityRecords`）納入頁面資料來源，也沒有針對使用者彙總未完成簽到簽退的統計欄位。
- **修復**：更新 `js/firebase-service.js`，讓活動詳細頁一併載入活動紀錄（`activityRecords`）；更新 `js/modules/event-manage.js`，新增放鴿子次數統計函式，並在活動詳細頁的出席表姓名左側加入 `🕊` 欄，公開顯示每位報名者已結束活動中未完成簽到加簽退的次數，無法辨識實際帳號的代報同行者則顯示 `—`。
- **教訓**：只要是跨活動的公開統計欄位，就不能只依賴單一活動的頁面資料；應先補齊歷史集合來源，再讓 UI 只在需要的頁面顯示，避免全站多餘負擔。

### 2026-03-11 — 修復 iOS Chrome 自己的 LINE 頭像無法顯示
- **問題**：PC Chrome 與手機版 LINE 瀏覽器可正常顯示登入者頭像，但 iOS Chrome 在右上角、抽屜與個人資訊頁都只出現破圖。
- **原因**：自我頭像優先使用 LINE 個人資料快取（`liff_profile_cache`）中的 `pictureUrl`，而這份快取沒有時效；一旦 iOS Chrome 留下過期或失效的舊網址，就會持續拿舊圖。另一方面，部分頭像 `<img>` 是先插入 DOM 再綁 `error`，在 iOS Chrome 上可能直接停在破圖狀態，來不及切 fallback。
- **修復**：更新 `js/line-auth.js`，為 LINE 個人資料快取加入 `cachedAt` 與 6 小時 TTL，舊格式快取會自動清除；更新 `js/modules/profile-core.js`，加入頭像候選網址重試、`referrerpolicy="no-referrer"`、壞圖名單 TTL 與 `v2` key 重置，並改成對已經進入 broken state 的圖片立即 fallback；同步更新 `js/modules/profile-data.js`、`js/modules/profile-card.js`，讓自己的 LINE 頭像失效時會回退到資料庫 `pictureUrl` 再嘗試。
- **教訓**：第三方頭像網址不能只靠單一來源與永久快取，尤其瀏覽器分流場景要同時處理「快取過期」與「圖片錯誤事件漏接」兩種失效模式。

# SportHub — Claude 修復日誌

此檔案隨 git 版本控制，記錄歷次 bug 修復與重要技術決策，供跨設備、跨會話參考。

> 新紀錄一律寫在檔案前方，採新到舊排序；若需補記舊項目，應插入對應日期區段，不得追加到檔尾。

---
### 2026-03-11 — 活動頁改為 cloud 未完成也可先顯示快取
- **問題**：即使前兩階段已減輕 Firebase 初始化負載，iPhone 多頁籤進入活動頁時仍可能先卡在 `guard cloud` 或 `page` timeout，導致活動頁打不開。
- **原因**：`page-activities` 仍把 `ensureCloudReady()` 放在進頁前的阻擋鏈上，只要雲端初始化還沒完成，就算本地已有活動頁快取畫面也不能先顯示。
- **修復**：在 `js/core/navigation.js` 新增活動頁 soft-entry 條件，只要活動頁 DOM 已在且有快取活動資料或已建立快照，就允許直接先進入活動頁；背景再等待 `ensureCloudReady()`、補跑 `ensureCollectionsForPage()`，完成後重新 render 當前活動頁。
- **教訓**：列表頁的 guarded route 不應一律採 full fresh-first；當本地已有可用快取時，應優先讓使用者先看到畫面，再把雲端初始化留在背景完成。

### 2026-03-11 — 縮小 cloud init 負載並延後活動頁即時監聽
- **問題**：iPhone 多頁籤連續開啟活動頁時，新的頁籤容易在活動頁切入前卡在 cloud init timeout，雖然不再無限 loading，但仍常因 Firebase 初始化過重而失敗。
- **原因**：`FirebaseService.init()` 會在進頁前同步抓過多 boot collections，且活動頁的 `registrations` / `attendanceRecords` page-scoped 即時監聽在頁面顯示前就啟動，讓多頁籤冷啟動壓力偏高。
- **修復**：在 `js/firebase-service.js` 將 boot collections 縮到首頁與全域必要資料，改成平行抓取，並把 `floatingAds`、`popupAds`、`sponsors`、`tournaments`、`gameConfigs` 改成 init 後背景 warmup；同時讓活動頁可先跳過 page-scoped realtime 啟動，待 `js/core/navigation.js` 完成進頁與 render 後再延後啟動 listener。
- **教訓**：切頁阻擋鏈中的資料載入與即時監聽要拆開看，列表頁不該把非首屏必要監聽放在 guarded route 的同步路徑上。

### 2026-03-11 — 多頁籤活動頁長輪詢卡死保險絲
- **問題**：iPhone 上同時開多個 `toosterx.com` 分頁時，前面分頁若已卡在活動頁的慢載入提示，後面新分頁再切入活動頁容易一直停在「網路較慢，資料仍在載入中...」。
- **原因**：頁面切換（`showPage()`）的雲端初始化與頁面進場等待沒有超時保護；另外舊版 WebSocket fallback 會把 `shub_ws_blocked` 寫進 `localStorage` 24 小時，導致一個分頁的超時把後續所有新分頁都推去長輪詢模式，放大多頁籤連線壓力。
- **修復**：在 `app.js` 新增共用 timeout helper，並替 CDN script loader 加入載入逾時；在 `js/core/navigation.js` 為 guarded route 的雲端初始化與頁面進場套用超時保險絲，逾時時結束 route loading 並回傳失敗，不再無限掛著；在 `js/firebase-config.js` 把 WebSocket fallback 改成 tab-scoped 的 `sessionStorage` 短 TTL，並清掉舊的 cross-tab `localStorage` 標記；在 `js/firebase-service.js` 讓長輪詢本身逾時時清除 fallback，下一次可重新嘗試 WebSocket；同步更新 `js/config.js`、`index.html` 快取版本到 `20260311af`。
- **教訓**：多頁籤環境下的連線 fallback 不應使用長 TTL 的跨分頁共享旗標；所有 route/cloud loading 都必須有可收斂的 timeout 路徑。

### 2026-03-11 — 首頁與活動頁改為先顯示快取畫面再背景刷新
- **問題**：首頁（`page-home`）與活動頁（`page-activities`）切換頻率最高，但每次回頁都會先等待切頁流程與資料檢查，使用者即使剛看過頁面、內容也沒變，仍會感到像重新載入一次。
- **原因**：原本 `showPage()` 會在顯示頁面前先完成 `_ensurePageEntryReady()`，包含資料檢查與可能的重新抓取；因此即便已有快取資料與最近一次畫面，也會先被切頁等待流程阻擋。
- **修復**：在 `js/core/navigation.js` 針對首頁與活動頁加入 stale-first 切頁：若頁面已有最近一次快取畫面，切頁時先立即顯示快取 render，再背景執行資料刷新，僅在資料真的重新載入後才更新當前畫面；`js/firebase-service.js` 的 `ensureCollectionsForPage()` 改為回傳本次實際重新載入的集合清單，讓背景刷新只在必要時重 render；`app.js` 與 `js/modules/event-list.js` 新增首頁、活動頁的快取畫面可用標記。同步更新 `js/config.js`、`index.html` 快取版本到 `20260311ae`。
- **教訓**：高頻切換的列表頁不應把「有可用快取畫面」與「背景資料驗證」綁成同一個阻擋步驟，應優先顯示最近一次可用畫面，再做背景刷新。

### 2026-03-11 — 回首頁時重置近期活動卡片橫向位置
- **問題**：使用者在首頁把「近期活動」卡片列橫向滑到後面後，切去其他頁再回首頁，卡片列會停留在上次的水平位置，沒有回到最左側。
- **原因**：首頁重新 render 時只更新卡片內容，`#hot-events` 橫向捲動容器本身的 `scrollLeft` 不會自動重置，因此切回首頁仍保留前一次的滑動位置。
- **修復**：在 `js/modules/event-list.js` 新增首頁近期活動卡片列的捲動重置 helper，並在 `js/core/navigation.js` 切入 `page-home` 時於首頁 render 後執行，強制將 `#hot-events` 回到最左側；同步更新 `js/config.js`、`index.html` 快取版本到 `20260311ad`。
- **教訓**：橫向 scroll 容器與頁面內容重繪是兩件事，若 UX 要求「每次進頁都回到起點」，必須在切頁入口明確重置 scroll 位置，不能只依賴重新 render。

### 2026-03-11 — 活動頁切回時固定回到一般頁籤
- **問題**：使用者先切到活動頁的「已結束」頁籤，再離開後重新進入活動頁時，畫面會保留上次頁籤，沒有優先回到「一般」頁籤。
- **原因**：活動頁的目前頁籤狀態由 `_activityActiveTab` 保留，切換到 `page-activities` 時只重新 render 列表，沒有先重置頁籤狀態與按鈕 active 樣式。
- **修復**：在 `js/modules/event-list.js` 抽出活動頁籤共用 setter，新增 `resetActivityTab()`；在 `js/core/navigation.js` 切入活動頁時先重置成 `normal` 再 render，並同步更新 `js/config.js`、`index.html` 快取版本到 `20260311ac`。
- **教訓**：列表頁若有內部頁籤或 filter 狀態，切頁入口要明確決定是保留狀態還是重置，不能只依賴模組內的記憶值。

### 2026-03-11 — 切換頁面後統一回到頁面頂端
- **問題**：使用者在主頁、列表頁、細節頁之間切換，或從細節頁返回上一頁時，畫面常停留在前一頁的捲動位置，沒有回到頁面最頂。
- **原因**：導航層只有 `showPage()` 嘗試做 `scrollTo()`，而且使用平滑滾動且執行時機早於後續 render；`goBack()` 則完全沒有重設捲動位置，導致切頁後的 hash 同步與內容重繪會覆蓋原本的回頂行為。
- **修復**：在 `js/core/navigation.js` 新增共用的頁面回頂 helper，統一套用到 `showPage()` 與 `goBack()`，改成即時強制回頂，並在下一幀與延後再補一次，避免被後續 render 蓋掉；同步更新 `js/config.js`、`index.html` 的快取版本為 `20260311ab`。
- **教訓**：SPA 的頁面捲動重設要集中在導航層處理，且要同時覆蓋前進、返回與延後 render 的時序，不能只在單一路徑放一次 `scrollTo()`。

### 2026-03-11 — 修正活動滿額時錯放正取、未進候補
- **問題**：部分活動已經實際滿額，但新報名仍被判成正取，出現 `27/26` 這種超額卻沒有任何人進候補名單的狀況。
- **原因**：`活動報名（registerForEvent / batchRegisterForEvent）` 與 `取消報名（cancelRegistration / cancelCompanionRegistrations）` 都直接把活動文件的 `目前人數（current）`、`候補數（waitlist）` 當作真相來源；一旦這兩個欄位先前和 `參加者名單（participants）`、`候補名單（waitlistNames）` 脫鉤，後續每次報名或取消都會沿著錯誤計數繼續寫下去。
- **修復**：在 `js/firebase-crud.js` 新增活動佔位摘要 helper，之後活動報名、同行者批次報名、取消報名與同行者取消都優先以 `participants / waitlistNames` 的實際名單長度同步 `current / waitlist`，不再直接相信舊的計數欄位；這樣即使歷史上 `current` 曾少算，也不會再把滿額後的新報名錯塞進正取。快取版本同步升到 `20260311z`。
- **教訓**：當 `current / waitlist` 只是快取摘要欄位時，寫入流程不能反過來拿它當唯一真相來源；真正會決定名額的，應該是名單本身或由名單即時計算出的摘要。

### 2026-03-11 — 賽事詳情聯繫主辦與友誼賽表單設定修正
- **問題**：賽事詳情頁的 `聯繫主辦人（contact organizer）` 仍固定跳用戶卡片、`編輯賽事（edit tournament）` 按鈕位置與樣式不符合需求、未開啟報名費時仍顯示費用欄；另外新增 / 編輯賽事表單的 `報名費 toggle` 樣式異常、`報名開始（regStart）` 仍被要求必填、`參賽隊伍數（teamLimit）` 也被鎖死為 4 隊。
- **原因**：賽事詳情沿用舊版按鈕邏輯，沒有解析主辦人的 `LINE 連結（socialLinks.line）`；工具列缺少與頁籤並排的容器；友誼賽表單仍保留舊的固定四隊與錯誤 toggle class，驗證規則也沒跟新需求同步。
- **修復**：更新 `js/modules/tournament/tournament-core.js` 新增主辦人解析與 `contactTournamentOrganizer()`，有 LINE 就開 `line.me`，沒有則 fallback 到用戶卡片；更新 `js/modules/tournament-render.js` 與 `css/tournament.css`，把 `編輯賽事` 改成綠底工具列按鈕放在頁籤列右側，並在未開啟報名費時隱藏 `報名費` 資訊列；更新 `js/modules/tournament-manage.js`，修正報名費 toggle 使用正確的 `toggle-slider`、將 `報名開始` 改為非必填且補上「未設定則立即開放」、把 `參賽隊伍數` 改為可輸入 2 到 4 隊並套用新提示文案，同步讓建立 / 編輯寫入與驗證都使用實際隊伍上限；快取版本升到 `20260311x`。
- **教訓**：同一個業務設定若同時影響詳情頁顯示、表單驗證與資料寫入，必須一起改到同一套 helper 與欄位來源，否則很容易出現 UI 已改、資料層仍沿用舊規則的半套狀態。

### 2026-03-11 — 修正首頁與活動行事曆卡片人數摘要不同步
- **問題**：首頁活動卡片與活動行事曆卡片仍直接顯示 `event.current / event.waitlist`，但活動詳情頁報名名單已改成依 `registrations` 的 confirmed / waitlisted 明細重算；當歷史資料只修到名單、未同步回活動快取欄位時，首頁會顯示人數較少，行事曆卡片也可能在實際已滿時仍顯示「即將額滿」。
- **原因**：卡片列表與詳情頁走了兩套不同的統計來源，前者依賴活動根文件快取欄位，後者依賴報名紀錄聚合，導致首頁、行事曆與詳情頁對同一場活動出現不同答案。
- **修復**：在 `js/modules/event-list.js` 新增活動卡片專用的人數摘要 helper，統一從 `registrations` 聚合 confirmed / waitlisted 人數，並保留 `participants / waitlistNames` 舊欄位作 fallback；首頁活動卡片與活動行事曆卡片都改用同一份摘要與滿額 badge 判斷，已滿優先顯示「已額滿」，不再誤落到「即將額滿」；同步把 `js/config.js` 與 `index.html` 快取版本升到 `20260311w`。
- **教訓**：同一個活動若在多個入口都要顯示人數與滿額狀態，必須共用同一個聚合 helper，不能讓首頁、列表、詳情頁各自吃不同欄位。

### 2026-03-11 — 修正活動詳情頁已報人數與報名名單不一致
- **問題**：活動詳情頁上方人數欄會直接顯示 `活動目前人數（event.current）`，但報名名單是依 `報名紀錄（registrations）` 的 confirmed 狀態重算，遇到歷史補位名單時會出現上方 `25/26`、名單 `26/26` 的不一致。
- **原因**：活動詳情頁與報名名單使用了兩套不同的人數來源，前者吃活動欄位，後者吃 confirmed 名單摘要，導致同頁面自相矛盾。
- **修復**：在 `js/modules/event-manage.js` 抽出共用的 confirmed 名單摘要 helper，讓報名名單表頭統一吃同一份 summary；`js/modules/event-detail.js` 也改用同一份摘要決定已報人數與滿額判斷；同步將 `js/config.js`、`index.html` 快取版本升到 `20260311v`。
- **教訓**：同一頁面若同時顯示統計值與明細名單，必須共用同一個聚合來源，不能一邊吃快取欄位、一邊重算明細。

### 2026-03-11 — 首頁活動等待提示改為超過 1 秒才顯示
- **問題**：首頁活動卡點擊後，只要偵測到首次載入流程，就會立刻跳出「活動資料載入中」提醒，即使實際開啟很快也會多出不必要提示。
- **原因**：首頁活動點擊入口在進入詳情前，對所有等待中的情況都同步顯示 toast，沒有等候閾值。
- **修復**：更新 `js/modules/event-list.js` 與 `css/home.css`，將首頁活動載入 toast 改成超過 1 秒仍未開啟時才顯示，並把卡片 `載入中` 標示從右上角移到縮圖正中央；同步更新 `js/config.js`、`index.html` 快取版本到 `20260311u`。
- **教訓**：等待提示要區分「真的慢」與「只是正常切頁」，提示太早會讓順暢流程也被誤判成卡住。

### 2026-03-11 — 首頁活動首次載入點擊補上等待提示
- **問題**：首頁第一次載入尚未完成時，使用者點近期活動卡片會先卡住等待雲端初始化，畫面沒有立即回饋，容易被誤認為故障。
- **原因**：首頁活動卡片直接呼叫 `活動詳情入口（showEventDetail）`，而 lazy route 內部會先等待 `雲端就緒（ensureCloudReady）`，這段等待期間沒有任何首頁層級的提示。
- **修復**：更新 `js/modules/event-list.js` 與 `css/home.css`，將首頁活動卡點擊改成經過 `首頁活動點擊入口（openHomeEventDetailFromCard）`，在首次載入或登入同步期間先顯示 toast「活動資料載入中，請稍候 1-2 秒」，並讓卡片短暫進入 pending 狀態；同步更新 `js/config.js`、`index.html` 快取版本到 `20260311t`。
- **教訓**：凡是會等待 lazy route、Auth 或 cloud boot 的首頁互動入口，都要在入口層先給立即回饋，不能只依賴後續頁面的 loading 提示。

### 2026-03-11 — 首頁近期活動縮圖補上類型斜角緞帶
- **問題**：首頁的近期活動縮圖沒有和活動詳情頁一致的活動類型提示，縮圖上只能看到日期與地點，無法快速辨識是 PLAY、教學或友誼活動。
- **原因**：首頁活動卡片只渲染了日期角標、運動圖示與性別緞帶，沒有把活動類型標籤同步帶到縮圖層。
- **修復**：更新 `js/modules/event-list.js` 與 `css/home.css`，在首頁 `近期活動（hot-events）` 的活動縮圖左下角加入同款類型斜角緞帶，沿用 `類型設定（TYPE_CONFIG）` 的標籤與配色；同步更新 `js/config.js`、`index.html` 快取版本到 `20260311s`。
- **教訓**：同一個活動的核心識別元素應在首頁卡片、列表與詳情頁維持一致，避免使用者在不同入口看到不同層級的資訊密度。

### 2026-03-11 — 修正活動詳情斜角緞帶方向
- **問題**：活動詳情封面的類型緞帶雖然出現在左下角，但斜向方向做反了，呈現成右上往左下，和需求指定的左上往右下不一致。
- **原因**：`activity.css` 的緞帶旋轉角度使用了 `rotate(-45deg)`，造成斜角方向與預期相反。
- **修復**：更新 `css/activity.css`，將封面緞帶旋轉角度改為 `rotate(45deg)`，保留左下角定位；同步更新 `js/config.js`、`index.html` 快取版本到 `20260311r`。
- **教訓**：做斜角角標時，除了檢查落點，還要同時確認斜率方向是否符合使用者描述，否則容易只對到角落、沒對到視覺走向。

### 2026-03-11 — 活動詳情封面新增類型斜角緞帶
- **問題**：活動詳情封面缺少明確的活動類型提示，使用者進入詳情頁後還要往下看資訊，才知道是 PLAY、教學或友誼活動。
- **原因**：活動詳情頁只有封面圖片，沒有重用活動行事曆既有的類型標籤與配色語意。
- **修復**：更新 `js/modules/event-detail.js` 與 `css/activity.css`，在封面左下角加入依活動類型配色的斜角緞帶；同步更新 `js/config.js`、`index.html` 快取版本到 `20260311q`。
- **教訓**：活動列表與活動詳情的類型辨識應共用同一套視覺語意，避免列表可辨識、進入詳情頁後反而失去提示。

### 2026-03-11 — 賽事最終複檢：修補友誼賽站內信審核與申請重入
- **問題**：友誼賽改成 `球隊申請（teamApplications） + 參賽隊伍（teamEntries）` 後，`站內信（message-inbox）` 仍保留舊版 `查看名單審核` 路徑，可能從 `registeredTeams` 舊欄位直接審核，造成新舊資料模型分叉；另外 `參加賽事（registerTournament）` 缺少前端忙碌鎖與穩定申請 ID，快連點時有機會重複送出申請或重複發送通知。
- **原因**：Step 4-6 建立了新的 `friendly` 詳情頁審核流程與通知模板，但 `message-inbox.js` 的舊審核按鈕沒有一起收斂；同時 `friendly` 申請文件原本使用隨機 `applicationId`，沒有固定到 `隊伍 x 賽事` 粒度，也沒有前端重入保護。
- **修復**：在 `js/modules/message-inbox.js` 新增 `訊息狀態 badge helper（_renderMessageActionStatus）`、`群組鍵解析（_getTournamentMessageGroupId）`、`訊息群組狀態同步（_syncTournamentMessageActionStatus）` 與 `從站內信跳轉友誼賽審核（openFriendlyTournamentMessageReview）`；友誼賽相關訊息改為在站內信只導向賽事詳情頁的隊伍分頁審核，不再走舊版 `registeredTeams` 審核路徑。於 `js/modules/tournament/tournament-core.js` 讓 `球隊申請 ID` 可回退到 `teamId/_docId`，並在 `js/modules/tournament/tournament-friendly-detail.js` 將申請 ID 固定為 `ta_{teamId}`、補上 `messageGroupId`、加入 `申請忙碌鎖（_friendlyTournamentApplyBusyById）` 與 `審核忙碌鎖（_friendlyTournamentReviewBusyById）`，避免快連點重入。同步將快取版本更新到 `20260311p`。
- **教訓**：這類「新資料模型 + 舊通知入口」的重構，不能只檢查主頁流程，還要把 `message inbox / deep link / 後台快捷按鈕` 這些旁路入口一起收口；涉及 `create` 類操作時，也要優先做 `穩定 ID + busy guard`，避免重複寫入。

### 2026-03-11 — 賽事最終檢查：補強寫入等待與錯誤處理
- **問題**：最終檢查時發現賽事流程仍有兩個容易在實測卡關的風險：`建立/編輯/結束/重開賽事` 仍採背景寫入，若 Firestore 權限、登入狀態或網路失敗，畫面會先顯示成功再於刷新後消失；另外友誼賽的 `報名申請`、`主辦審核`、`roster 加入/退出` 等按鈕型 async 入口缺少統一錯誤處理，出錯時容易變成無提示的 Promise rejection。
- **原因**：`ApiService` 原本只有同步樂觀更新版的 `createTournament / updateTournament`；Step 3-5 的表單與 roster 流程又直接從 UI 事件呼叫 async 寫入，沒有等到 Firebase 寫入成功才回應 UI。
- **修復**：在 `js/api-service.js` 新增 `更新等待寫入（_updateAwaitWrite）` 與 `createTournamentAwait / updateTournamentAwait`；在 `js/modules/tournament/tournament-core.js` 補上共用 `賽事錯誤提示（_showTournamentActionError）`；`js/modules/tournament-manage.js` 的建立、編輯、結束、重開改為等待 Firestore 成功後才顯示成功；`js/modules/tournament/tournament-friendly-detail.js` 與 `js/modules/tournament/tournament-friendly-roster.js` 的主要按鈕流程補上 `try/catch`，避免靜默失敗；同步更新快取版本到 `20260311o`。
- **教訓**：最終驗收不能只看資料模型與權限是否正確，還要確認 UI 事件層是不是把寫入失敗當成功處理；對高互動頁面來說，等待寫入成功與明確錯誤提示，價值往往高於再多加一層功能。

### 2026-03-11 — 賽事重構第 1-6 步回頭驗收與一致性修補
- **問題**：友誼賽重構完成後，仍存在三類風險：`賽事管理（tournament-manage）` 重新覆寫舊版狀態 helper，導致狀態字串在不同頁面不一致；`賽事渲染（tournament-render）` 還保留舊狀態標籤判斷；`友誼賽 roster（tournament-friendly-roster）` 讓一般隊員在球隊通過審核後可直接加入，未遵守「需先由領隊或經理加入」的規則；另外 `賽事規則（firestore.rules）` 的賽事根文件仍只允許 `admin` 建立或更新，與友誼賽建立/編輯權限規格不符，且主辦審核球隊後沒有把 `已報名隊伍（registeredTeams）`、`球隊申請（teamApplications）`、`參賽隊伍（teamEntries）` 同步回根文件。
- **原因**：Step 1-6 先把新模組接上後，仍殘留部分 legacy helper 與死碼；權限規則只補了子集合，漏掉賽事根文件；審核流程只寫入子集合，沒有兼顧舊頁面與其他裝置仍可能依賴的根層相容欄位。
- **修復**：清除 `js/modules/tournament-manage.js` 中已被 `return` 截斷的安全死碼，移除舊版 `getTournamentStatus()` / `isTournamentEnded()` 覆寫；更新 `js/modules/tournament-render.js` 讓舊 fallback 同時支援 `即將開始 / 已截止報名` 新狀態；在 `js/modules/tournament/tournament-friendly-roster.js` 補上「領隊或經理先加入才解鎖隊員加入」邏輯；在 `js/modules/tournament/tournament-friendly-detail.js` 新增根層相容欄位同步；在 `firestore.rules` 開放符合條件的主辦球隊領隊或經理建立賽事，並允許主辦方或委託人在不變更 `主辦球隊（hostTeamId）`、`建立者（creatorUid）`、`賽事模式（mode）` 前提下更新賽事根文件；同步更新快取版本到 `20260311n`。
- **教訓**：這類漸進式重構不能只看新流程能不能跑，還要回頭檢查 legacy helper 是否仍會覆寫新邏輯、根文件與子集合是否一致、以及 Firestore 規則是否真的跟產品權限規格同步。

### 2026-03-11 — 賽事重構 Step 6：接上友誼賽站內信模板與通知流程
- **問題**：友誼賽雖然已完成建賽、球隊申請、主辦審核與 roster，但重要節點還沒有接上站內信通知，後台也缺少對應模板 key 可供編輯。
- **原因**：前五步優先完成資料模型、表單、詳情頁與 roster，通知仍停留在既有活動/舊賽事流程，friendly 專用模板與投遞掛點尚未建立。
- **修復**：新增 `js/modules/tournament/tournament-friendly-notify.js`，以外掛方式掛接 `建賽`、`送出球隊申請`、`審核通過/拒絕` 三個節點，沿用既有 `notifTemplates/messages` 發送站內信；同步擴充 `js/modules/message-inbox.js` 的內建模板與 `_sendNotifFromTemplate()` 額外 meta/options 支援，並在 `functions/index.js` 補上 5 組友誼賽預設模板 seed，更新 `docs/architecture.md`，快取版本升到 `20260311m`。
- **教訓**：大型重構的通知層不要直接寫死在業務流程裡，先把模板與投遞抽成獨立模組，再以 wrapper 掛回關鍵節點，較不容易把舊流程一起扯壞。

### 2026-03-11 — 賽事重構 Step 5：補上友誼賽 roster 與多隊身份選擇
- **問題**：友誼賽詳細頁雖然已完成球隊申請與主辦審核，但隊員仍無法在球隊核准後加入或退出參賽名單，多球隊身份也缺少選隊流程。
- **原因**：前一步只先接管 `球隊申請（teamApplications）` 與 `參賽隊伍（teamEntries）`，尚未讀取 `entries/{teamId}/members` 子集合，也沒有 friendly 專用的 roster UI 與 modal 流程。
- **修復**：新增 `js/modules/tournament/tournament-friendly-roster.js`，在 friendly 詳情頁上補上 roster 成員補載、加入/退出球員名單與多隊身份選擇 modal；同步更新 `css/tournament.css` 的 roster 提示與選隊樣式、`docs/architecture.md` 模組說明，並把快取版本升到 `20260311l`。
- **教訓**：賽事重構要把「球隊層申請」與「個人層 roster」分開實作，才能在不中斷既有審核流程的前提下，逐步把參賽邏輯補齊。

### 2026-03-11 — 賽事重構 Step 3：表單改為 friendly-first
- **問題**：賽事建立與編輯表單仍沿用舊的一般賽事流程，缺少主辦球隊欄位、友誼賽固定 4 隊設定與報名費開關式呈現，符合條件的隊職員在前台也缺少建立與編輯入口。
- **原因**：前兩步只先完成核心 helper 與資料模型骨架，表單與公開頁仍綁定舊的 `type / teams / fee / organizer` 欄位與既有權限入口，尚未接上 `hostTeam`、`friendlyConfig`、`feeEnabled`。
- **修復**：調整 `js/modules/tournament-manage.js`，把建立與編輯流程改為 `friendly` 優先，新增主辦球隊選擇、封面圖片置頂、報名費開關、4 隊唯讀限制與前台建立按鈕；同步在 `js/modules/tournament-render.js` 補上前台建立按鈕刷新、主辦單位顯示與詳情頁的編輯入口，並在 `css/base.css` 新增表單輔助樣式；更新 `docs/architecture.md`，快取版本升到 `20260311j`。
- **教訓**：舊表單重構時先以前置分支接管新流程，再做語法檢查與入口盤點，能避免同一函式殘留重複變數宣告或讓新權限有規則卻沒有入口。
### 2026-03-11 — 賽事重構 Step 2 建立友誼賽資料模型與子集合骨架
- **問題**：友誼賽後續要接主辦球隊、球隊申請、主辦審核與隊員 roster，但現有 `tournaments` 只有單層文件 CRUD，`ApiService` 與 `Firestore rules` 都還沒有 friendly 專用資料模型與子集合入口。
- **原因**：舊賽事功能原本只支援簡單報名與列表顯示，沒有把球隊申請、已核准隊伍、隊員名單拆成可擴充結構，也缺少可讓未來 UI 接上的 API/rules 骨架。
- **修復**：擴充 `js/modules/tournament/tournament-core.js`，加入友誼賽 `資料正規化（_buildFriendlyTournamentRecord）`、`球隊申請（teamApplications）`、`參賽隊伍（teamEntries）` 與 `隊員名單（memberRoster）` helper；`js/api-service.js` 新增友誼賽讀寫包裝與 demo 分支骨架，並讓 `createTournament/updateTournament` 先寫入 `mode`、`friendlyConfig`、`delegateUids`、`schemaVersion` 等新欄位；`js/firebase-crud.js` 新增 `applications / entries / entries/{teamId}/members` 子集合 CRUD helper；`firestore.rules` 補上友誼賽子集合的 captain/leader、delegate、host team manager 權限掛點，同步更新 `docs/architecture.md`，並把快取版本升到 `20260311i`。
- **教訓**：在大型重構前先把資料模型與安全規則掛點搭好，比先改 UI 安全，之後每一步可以沿用同一套 schema，不會再把新流程硬塞回舊欄位。

### 2026-03-11 — 賽事重構 Step 1 先抽出 tournament-core 共用骨架
- **問題**：公開賽事頁 `tournament-render.js` 直接依賴 `getTournamentStatus()` 與 `isTournamentEnded()`，但這兩個 helper 原本放在僅後台會 lazy load 的 `tournament-manage.js`，結構上存在公開頁依賴後台模組的風險；同時友誼賽重構也需要一個不會再把新權限邏輯散落各檔案的核心落點。
- **原因**：賽事功能歷史上是從單純展示頁逐步長大，公開頁與後台頁共用的狀態/權限判斷沒有被抽成核心模組，導致賽事頁、收藏頁與後台管理之間出現隱性耦合。
- **修復**：新增 `js/modules/tournament/tournament-core.js`，將賽事狀態判斷、主辦顯示組字、友誼賽責任球隊判斷與賽事管理權限骨架集中到賽事專屬模組；`index.html` 先以 eager script 載入此核心檔，讓公開賽事頁不再依賴後台管理模組才有基本能力；同步更新 `docs/architecture.md`、`js/config.js` 與 `index.html` 快取版本到 `20260311h`。
- **教訓**：大型功能在重構前的第一步，優先抽出公開頁與後台共用的無副作用 helper，能先消除跨模組隱性依賴，後續再改流程時也比較不容易把既有功能一起扯壞。

---
### 2026-03-11 — 賽事重構前置規格書與模組目錄預留
- **問題**：賽事功能準備從現有的單頁式管理/渲染邏輯，擴充成先支援友誼賽、後續再延伸盃賽與聯賽的完整子系統；若先做功能再補文件，後續很容易在資料模型、權限與通知流程上反覆重拆。
- **原因**：目前 repo 只有平鋪的 `tournament-manage.js` 與 `tournament-render.js`，缺少正式的施作前規格與專屬模組落點；既有 `tournaments` 也偏向簡單欄位模型，尚未定義球隊申請、審核與 roster 的長期結構。
- **修復**：新增 `docs/tournament-refactor/` 規格文件組，將友誼賽重構拆成總覽、資料模型、權限、流程、UI、通知、施作階段 7 份 Markdown；另外新增 `js/modules/tournament/README.md` 作為賽事專屬模組目錄預留，並在 `docs/architecture.md` 補上對應說明。
- **教訓**：當功能已經接近子系統等級時，應先把資料模型、權限邊界與模組切分落成文件，再開始實作；否則很容易把短期需求直接疊成長期技術債。

---
### 2026-03-11 — 正式站 console 收斂為 error + 關鍵 warn
- **問題**：正式站 console 充滿大量 `log / warn / error`，視覺上很雜，也把不少啟動流程、Firebase/Auth 狀態與 fallback 細節直接暴露給外部。
- **原因**：專案目前沒有集中式 logger 或正式站 console gate；各模組直接呼叫原生 `console.*`，而 `index.html` 的 `debug=1` 還會進一步把輸出鏡像到頁面內 debug console。
- **修復**：更新 `index.html`，在入口最早期加入正式站 console policy：production host 預設關閉 `console.log / info / debug`、僅保留 `console.error` 與關鍵 `console.warn`，並保留 `debug=1` 作為完整除錯覆寫；同步更新 `js/config.js` 與 `index.html` 快取版本到 `20260311g`。
- **教訓**：console 乾淨不能只靠人工少寫 `log`，正式站需要入口層統一治理；否則模組一多，啟動診斷與 fallback 訊息會自然失控。

### 2026-03-11 — 活動管理頁首屏移除 activityRecords 預載
- **問題**：清除瀏覽器快取後第一次進入活動管理頁時，加載時間明顯變長，資料越多體感越差。
- **原因**：`活動管理頁（page-my-activities）` 在首屏渲染前會等待 `活動紀錄（activityRecords）` 一起載入，但活動卡片列表首屏本身並不直接依賴這包資料；真正使用 `activityRecords` 的只有少數管理操作。
- **修復**：更新 `js/firebase-service.js` 與 `js/modules/event-manage.js`，將 `page-my-activities` 的首屏必要集合移除 `activityRecords`，並新增靜態集合補載 helper，改成在 `強制遞補候補`、`移除參加者`、`取消/刪除活動後清理取消紀錄` 時才補載 `activityRecords`；同步更新 `js/config.js` 與 `index.html` 快取版本到 `20260311f`。
- **教訓**：首屏等待的集合不能用「可能之後會用到」來決定，應只保留當前列表 render 的硬依賴；次要管理資料要改成操作時懶載入，才能在資料量增加時維持進頁體感。

### 2026-03-11 — iOS 新增活動時間欄改為自動重排與雙欄報名時間
- **問題**：上一版已修正桌面模擬手機版的新增活動欄位溢出，但 iOS Chrome 真機仍會出現「活動時間」日期欄被右側時間欄擠壓，以及「開放報名時間」單一 `datetime-local` 欄位仍未真正收縮的情況。
- **原因**：iOS WebKit 的原生 `date / time / datetime-local` 控制項有更強的最小內容寬度限制；即使補上 `border-box`，單一 `datetime-local` 仍容易撐寬，三欄同列的日期時間排列也會壓縮日期文字。
- **修復**：更新 `pages/activity.html`、`css/base.css`、`js/modules/event-create.js`、`js/modules/event-manage.js`，將 `開放報名時間（regOpenTime）` 的 UI 改為「日期 + 時間」雙欄，並在 `event-create.js` 新增組裝 / 回填 helper 維持資料仍儲存為單一 `regOpenTime` 字串；同時讓 `活動時間（ce-date / ce-time-start / ce-time-end）` 在窄螢幕自動重排為日期一列、開始/結束下一列；同步更新 `js/config.js` 與 `index.html` 快取版本到 `20260311e`。
- **教訓**：iOS 上的原生日期時間控制項不能只靠縮 padding 解決，遇到真機收縮不穩時，應優先拆分欄位與重排版面，讓資料格式留在 JS 組裝層，而不是硬把原生控制項塞進同一列。

### 2026-03-11 — 修正新增活動日期時間欄位橫向溢出
- **問題**：新增活動表單在手機真機會出現「開放報名時間（ce-reg-open-time）」右側超出，桌面模擬手機尺寸則可能變成「活動結束（ce-time-end）」欄位多出一點，導致 modal 可橫向滑動，操作體感不佳。
- **原因**：全域表單控制項只有 `width: 100%`，缺少 `box-sizing: border-box`，在不同瀏覽器的原生 `date/time/datetime-local` 控制下會把內距與邊框算到 100% 之外；同時活動時間列用 inline flex，沒有對原生日期時間欄位補 `min-width: 0` 與可收縮版型。
- **修復**：更新 `pages/activity.html` 與 `css/base.css`，將活動時間列改成 class-based grid 版型，為日期/時間欄位補上可收縮設定，並為全域 `input / select / textarea` 補上 `max-width: 100%` 與 `box-sizing: border-box`；同步更新 `js/config.js` 與 `index.html` 快取版本到 `20260311d`。
- **教訓**：原生日期時間欄位在真機與桌面模擬的最小寬度行為不一致，不能只靠 inline `flex` 撐版；只要表單控制項使用 `width: 100%`，就應先統一 `border-box`，再另外處理收縮規則。

### 2026-03-11 — 費用開關移回標題右側並移除提示字
- **問題**：上一版雖然已把新增活動的費用區塊簡化，但仍保留灰色提示字，且開關位置與「費用 ($)」標題不是同一視線，開啟後的金額欄視覺節奏也不夠貼近右側的人數上限欄。
- **原因**：`活動費用開關（feeEnabled）` 的標題列仍採分組排版，讓標題、提示與開關形成三段資訊；金額欄雖沿用共用輸入樣式，但費用列本身的 header 節奏與右側標準欄位不同。
- **修復**：更新 `pages/activity.html`、`css/base.css`、`js/modules/event-create.js`，將費用列改為只顯示「費用 ($) + 開關」同列，移除提示字與對應切換文案，並明確對齊金額欄的共用輸入尺寸；同步更新 `js/config.js` 與 `index.html` 快取版本到 `20260311c`。
- **教訓**：同一列的可選欄位若要和標準輸入欄並排，最穩定的做法是讓標題列只保留必要控制，避免再插入狀態文案，否則很容易破壞表單的整體節奏。

### 2026-03-11 — 新增活動費用開關改為精簡展開式輸入
- **問題**：新增活動表單中的費用區塊使用獨立外框卡片呈現，開關提示過長且佔位偏重，與旁邊的人數上限欄位相比不夠精簡。
- **原因**：`活動費用開關（feeEnabled）` 的表單 UI 沿用「開關區塊 + 內層輸入列」設計，提示文字直接放在開關旁且切換到開啟時還改成強調色，資訊層級過多。
- **修復**：更新 `pages/activity.html`、`css/base.css`、`js/modules/event-create.js`，把費用區塊改成「費用標題 + 灰色小字提示 + 開關」同列顯示，開啟時才展開金額輸入欄位、關閉時完全隱藏；同步更新 `js/config.js` 與 `index.html` 快取版本到 `20260311b`。
- **教訓**：表單中的可選欄位若只是輔助開關，應優先比照同列輸入欄的資訊密度設計，避免額外卡片或強調色把次要控制做得比主要輸入還搶眼。

### 2026-03-11 — 活動費用改為可開關欄位
- **問題**：活動建立表單的費用欄固定存在，免費活動也會在活動詳情頁佔一列顯示「免費」，無法像球隊限定一樣收起不用的欄位。
- **原因**：資料模型只有 `fee` 數字，前端各頁直接用 `fee > 0` 或 `fee == 0` 判斷顯示，缺少「是否啟用費用」的獨立狀態。
- **修復**：在 `pages/activity.html`、`css/base.css`、`app.js`、`js/modules/event-create.js`、`js/modules/event-manage.js`、`js/modules/event-detail.js`、`js/modules/event-detail-companion.js`、`js/modules/personal-dashboard.js` 新增 `活動費用開關（feeEnabled）`、表單顯示/回填邏輯，以及活動詳情與管理端的費用顯示判斷；同步更新 `js/config.js` 與 `index.html` 快取版本到 `20260311a`。
- **教訓**：像費用這種可選欄位，不能只靠數值 `0` 代表關閉，應拆成「是否啟用」與「值」兩個欄位，前端顯示與資料保存才不會互相打架。

### 2026-03-10 — 稽核暱稱補齊完成後同步寫入操作日誌
- **問題**：稽核日誌執行 `補齊暱稱（backfillAuditActorNames）` 後，操作日誌沒有留下「誰補齊了哪些用戶暱稱」的紀錄；同時操作日誌類型標籤即使前一版有分色，實際辨識度仍不夠明顯。
- **原因**：補齊暱稱實際是在 Cloud Function `backfillAuditActorNames` 內批次更新 `auditLogsByDay`，流程中沒有任何 `操作日誌（operationLogs）` 寫入；而操作日誌顏色上一版只做到家族色系，部分既有類型看起來仍接近舊樣式。
- **修復**：更新 `functions/index.js`，新增後端 `操作日誌寫入（writeOperationLog）` helper，讓 `backfillAuditActorNames` 在成功補齊後，自動把 `操作者（operator）`、補齊日期、補齊筆數、涉及用戶清單摘要寫入 `operationLogs`，類型為 `稽核暱稱補齊（audit_backfill）`；更新 `js/modules/audit-log.js`，補齊成功 toast 改顯示「筆數 + 用戶數」；更新 `js/modules/user-admin-exp.js` 與 `css/admin.css`，把操作日誌標籤改成更明確的逐類型 / 家族色彩映射，並加上更醒目的彩色外框；同步更新 `js/config.js` 與 `index.html` 快取版本到 `20260310ap`。
- **教訓**：只要管理操作真正發生在 Cloud Function，若想要在前台後台都可靠留痕，就不能只靠前端補記，必須在後端同一交易流程裡把審計與操作日誌一起落地。

### 2026-03-10 — 操作日誌類型標籤改為按類型家族分色
- **問題**：日誌中心的操作日誌雖然有 `類型（type）` 標籤，但只有少數既有類型有專屬顏色，其他大量操作類型仍以同色呈現，辨識度不足。
- **原因**：`操作日誌（operationLogs）` 的渲染直接把原始 `type` 當 CSS class 使用，樣式表只列了部分固定類型，沒有針對新增類型做統一的色系歸類。
- **修復**：更新 `js/modules/user-admin-exp.js`，新增 `操作日誌色系對映（_getOperationLogToneClass）`，依 `event_*`、`team_*`、`tourn_*`、`ann_*`、`ach_*`、`shop_*`、`system_*` 等類型家族回傳統一色系 class；更新 `css/admin.css`，補上各色系標籤在亮色與深色主題下的樣式；同步更新 `js/config.js` 與 `index.html` 快取版本到 `20260310ao`。
- **教訓**：後台日誌的類型若會持續擴充，顏色規則不能一筆一筆硬寫，應改用「類型家族 -> 視覺語意」的映射，才不會每新增功能就漏色。

### 2026-03-10 — 活動參與查詢摘要列改為兩層並固定預設起始日
- **問題**：活動參與查詢的收折箭頭在小畫面會單獨多佔一行，摘要列顯得鬆散浪費版面；另外未查詢時的預設起始日期需要固定為 `2026-02-01`。
- **原因**：上一版摘要列把提示、狀態、日期與箭頭都放在同一個可換行結構中，手機排版時箭頭容易被擠到額外一行；起始日期則仍沿用「今天往前 90 天」的動態預設。
- **修復**：更新 `js/modules/dashboard-participant-query.js`，把摘要列改成兩層佈局，第一層固定為「標題 + 狀態 + 收折箭頭」，第二層再顯示提示與日期區間，讓箭頭與 `尚未查詢` 同列置右；同時將 `活動參與查詢（dashboard participant query）` 的預設 `開始日期（startDate）` 改為固定 `2026-02-01`。更新 `css/admin.css` 配合新的 grid 版型；同步更新 `js/config.js` 與 `index.html` 快取版本到 `20260310an`。
- **教訓**：收折摘要列的資訊密度要先分層，將「操作控制」和「補充說明」分開排，才能在手機寬度下維持緊湊且可點擊的版面。

### 2026-03-10 — 活動參與查詢收折摘要列對齊稽核日誌
- **問題**：活動參與查詢雖然已可收折，但摘要列的箭頭不夠明顯、提示文字不夠直觀，操作感和稽核日誌相比仍然偏弱。
- **原因**：上一版摘要列只顯示標題與單行資訊，提示文案主要在狀態字串裡，箭頭也只是一般文字符號，缺少「這裡可以展開 / 收起」的明確引導。
- **修復**：更新 `js/modules/dashboard-participant-query.js`，把摘要列改成「標題 + 展開/收起提示 + 查詢狀態 + 日期區間」的雙區塊結構，並在有查詢狀態時套用高亮；更新 `css/admin.css`，將箭頭改為更醒目的圓形按鈕感樣式，並讓整體排列與稽核日誌的折疊摘要列更一致；同步更新 `js/config.js` 與 `index.html` 快取版本到 `20260310am`。
- **教訓**：收折元件不只要能動，還要讓使用者一眼看出「可點擊」與「點了會發生什麼」；箭頭、提示文字與摘要資訊要一起設計，不能分開拼湊。

### 2026-03-10 — 重做活動參與查詢收折並修正版本失配
- **問題**：數據儀表板中的活動參與查詢欄位連續做了四次收折調整後仍無法穩定收起，平常不用時持續佔用版面。
- **原因**：前幾次做法在 `details/summary`、共用 class 名稱、`classList.toggle` 與 inline `onclick` 之間反覆切換，但都還把收折效果綁在容易受儀表板重繪影響的 DOM 結構；另外 `js/config.js` 的快取版本已經一路推進到 `20260310ak`，`index.html` 卻仍大量停在 `20260310af`，導致新腳本與新樣式未必能透過入口版本號完整刷新。
- **修復**：更新 `js/modules/dashboard-participant-query.js`，將活動參與查詢卡改為原生 `details/summary` 結構，改用獨立的 `dash-query-panel-*` class，避免再與結果摘要 grid 共用名稱，並新增 `syncDashboardParticipantSearchCollapse()` 讓收折狀態和重繪保持同步，預設進頁為收起；更新 `css/admin.css`，重做收折摘要列、箭頭旋轉與內容區 padding；同步更新 `js/config.js` 與 `index.html`，把快取版本統一升到 `20260310al`，避免入口檔與模組版本失配。
- **教訓**：收折 UI 若會被整塊重繪，就不能只靠臨時 DOM class 撐效果，必須讓資料狀態與原生行為對齊；同時每次改 JS/HTML 都要把入口檔版本號一起更新，否則修了也可能像沒修。

### 2026-03-10 — 重做稽核搜尋收折並修復日誌中心返回鍵
- **問題**：稽核日誌的搜尋條件收折多次調整後仍不穩定，使用者實際操作時整組欄位沒有可靠地一起收起來；另外日誌中心返回鍵在某些進入情境下會完全沒有反應。
- **原因**：原本收折做法是自訂按鈕加 `hidden` 狀態切換，對日誌中心這種會把舊頁節點搬進整併面板的結構不夠穩，收折狀態與實際 DOM 行為容易脫節；返回鍵則只依賴 `頁面歷史（pageHistory）`，當使用者直接從 hash、重整後頁面或抽屜入口進入日誌中心時，歷史堆疊可能為空，因此 `App.goBack()` 會變成 no-op。
- **修復**：更新 `pages/admin-system.html`，將稽核搜尋區改為原生 `details/summary` 結構，讓日期、開始時間、結束時間、行為與關鍵字都由同一個原生折疊容器控制；更新 `js/modules/audit-log.js`，改為同步折疊摘要文字與已套用篩選提示，不再自行維護 `hidden` 開關；更新 `css/admin.css` 補上新的搜尋摘要與折疊樣式；更新 `js/modules/admin-log-tabs.js` 與 `pages/admin-system.html`，讓日誌中心返回鍵在有歷史時仍走 `goBack()`，沒有歷史時自動回到 `後台儀表板（page-admin-dashboard）`，若無權限再退回首頁；同步更新 `js/config.js` 與 `index.html` 快取版本到 `20260310af`。
- **教訓**：對於會被動態搬移節點的後台頁面，收折功能應優先採用瀏覽器原生行為，避免自己維護過多 UI 狀態；返回鍵若只依賴前端記憶體歷史，對 refresh / deep-link / hash 進頁都不夠安全，必須設計明確 fallback。

### 2026-03-10 — 稽核日誌收折改為整個搜尋條件區一起開關
- **問題**：上一版稽核日誌收折只把部分搜尋條件收起來，日期欄位仍固定顯示，與需求中「整個搜尋欄位一次性收折」不符。
- **原因**：`pages/admin-system.html` 當時把日期欄位放在收折列外側，只把開始時間、結束時間、行為與關鍵字放進可收折區，實作範圍比需求少一層。
- **修復**：更新 `pages/admin-system.html`，將日期欄位移入 `稽核搜尋區（audit-log-filter-body）`，讓日期、開始時間、結束時間、行為與關鍵字都由同一個切換按鈕控制；同步調整 `css/admin.css` 的收折列版面；更新 `js/config.js` 與 `index.html` 快取版本到 `20260310ae`。
- **教訓**：做 UI 收折時要先確認「收折單位」是單一欄位、部分條件，還是整個條件群組；若需求寫的是整組，就不能預設保留其中一欄常駐。

### 2026-03-10 — 稽核日誌搜尋條件改為可收折
- **問題**：稽核日誌頁的搜尋區佔用固定高度，切到頁面後要先滑過日期、時間、行為與關鍵字欄位，真正的日誌列表會被往下擠。
- **原因**：`pages/admin-system.html` 原本把日期、時間、行為與搜尋框全部固定展開，沒有提供收折機制，導致查詢完成後仍持續占用版面。
- **修復**：更新 `pages/admin-system.html`，保留常用的日期欄位常駐顯示，將時間、行為與關鍵字搜尋包成可收折區塊；更新 `js/modules/audit-log.js`，新增稽核搜尋區收折狀態、切換按鈕文案與已套用篩選提示；更新 `css/admin.css` 補上收折列與箭頭樣式；同步更新 `js/config.js` 與 `index.html` 快取版本到 `20260310ad`。
- **教訓**：後台查詢頁的條件區若不是每次都要操作，應把最常用欄位與進階條件拆開，讓列表區保留主要視覺焦點與可視高度。

### 2026-03-10 — 修正日誌中心操作日誌只顯示舊資料
- **問題**：日誌中心的操作日誌看起來沒有作動，做完新操作後進後台仍只看到舊紀錄。
- **原因**：`FirebaseService` 讀取 `操作日誌（operationLogs）` 時只做 `limit(500)`，沒有指定排序；而文件 ID 目前是 `op_<timestamp>`，Firestore 會先回最舊的文件，導致新紀錄被擋在查詢結果之外。前端列表又只用 `time` 字串排序，跨月份或跨年份時會再把順序排錯。
- **修復**：更新 `js/firebase-service.js`，將 `操作日誌（operationLogs）` 的靜態查詢改為依 `createdAt` 由新到舊抓最近 500 筆；更新 `js/modules/user-admin-exp.js`，操作日誌排序改優先使用 `_docId` 時戳 / `createdAt`，最後才回退到 `time` 字串；同步更新 `js/config.js` 與 `index.html` 快取版本到 `20260310ac`。
- **教訓**：任何日誌或時間序列集合只做 `limit()` 不夠，必須同時定義「最新優先」的查詢排序與前端顯示排序，否則資料明明有寫入，管理頁仍會像是失效。

### 2026-03-10 — 鎖定一般用戶為零後台權限
- **問題**：一般用戶理應沒有任何後台能力，但權限管理目前只鎖定總管全開，一般用戶仍可能被寫入後台入口權限或功能權限。
- **原因**：前端權限管理只把總管視為鎖定角色，前端權限解析會繼續讀取 `rolePermissions/user`，而 `Firestore` 規則的 `hasPerm()` 也沒有排除一般用戶角色。
- **修復**：修改 `js/modules/user-admin-roles.js`、`js/api-service.js`、`js/config.js`、`firestore.rules`，把一般用戶鎖成零權限角色，前端永遠回傳空權限，後端規則也不再承認 `user` 的任何權限；同步更新快取版本到 `20260310ab`。
- **教訓**：角色硬鎖不能只做在 UI；只要 `rolePermissions` 同時會被前端與 `Firestore` 規則讀取，就必須三層一起鎖，避免出現畫面關了但後端仍認帳的落差。

### 2026-03-10 — 啟動時延後恢復受保護路由，避免首頁誤跳權限不足
- **問題**：使用者如果停留在後台或其他受保護頁面後直接刷新，啟動流程會先依網址 `hash` 嘗試恢復原頁，但當下角色與入口權限往往還沒同步完成，導致首頁先跳出「權限不足」，而且網址還可能保留在舊路由。
- **原因**：`app.js` 在 boot 階段直接呼叫 `showPage(bootPageId)`；`js/core/navigation.js` 會立即用 `_canAccessPage()` 檢查權限，卻沒有區分「正常切頁」與「啟動中的受保護路由恢復」，因此在 Auth / `rolePermissions` 尚未完成時就過早拒絕。
- **修復**：更新 `app.js`，新增待恢復受保護路由流程，啟動時先把受保護頁記成 pending，首頁維持可見，等 Cloud / Auth / 權限同步後再靜默重試；若最終仍無權限，直接清回 `#page-home`。更新 `js/core/navigation.js`，讓 `showPage()` 支援靜默的登入 / 權限拒絕判斷與可選的 hash 同步抑制。更新 `js/modules/profile-core.js`、`js/modules/role.js`，在登入完成與角色套用後補做 pending 路由重試。同步更新 `js/config.js` 與 `index.html` 快取版本到 `20260310aa`。
- **教訓**：帶權限的頁面恢復不能直接沿用一般切頁流程；boot route restore 必須等到身分與權限資料穩定後再做最後判斷，否則很容易出現誤報 toast 與路由殘留。

### 2026-03-10 — 持久化記錄失效 LINE 頭像網址，降低重複 404 噪音
- **問題**：即使已經有頭像載入失敗 fallback，瀏覽器仍會在每次重新整理或重新進站時，先去請求同一批已失效的 LINE 頭像網址，反覆在 console 產生 `profile.line-scdn.net 404`，干擾真正錯誤的觀察。
- **原因**：先前的失效頭像快取只存在記憶體 `Set`，重新整理頁面後就會清空；因此同一個壞掉網址在新 session / 新頁面流程中仍會再次被請求一次。
- **修復**：更新 `js/modules/profile-core.js`，新增失效頭像網址的 localStorage 持久化載入 / 寫回邏輯；當某個 LINE 頭像網址失敗過一次後，後續同瀏覽器會直接用字首 fallback，不再先發出圖片請求；同步更新 `js/config.js` 與 `index.html` 快取版本到 `20260310z`。
- **教訓**：前端 fallback 若只在 DOM 層替換顯示，仍無法避免下一次重新載入時再次發送壞請求；要真正降低錯誤噪音，必須把「已知壞資源」記錄成可跨重整保留的本地狀態。

### 2026-03-10 — 後台抽屜入口改為只看權限碼顯示
- **問題**：某些用戶雖然已開啟後台入口權限，抽屜仍看不到入口，容易誤以為要重新登入才會生效。
- **原因**：抽屜與頁面顯示邏輯仍先檢查 `最低層級（minRole）`，即使權限碼已開啟，只要角色等級低於入口設定值，入口與頁面根節點仍會被擋掉。
- **修復**：更新 `js/modules/role.js`，讓凡是有 `permissionCode` 的抽屜入口與對應頁面都只看權限碼，不再受 `minRole` 限制；更新 `js/api-service.js`，對沒有既存 `rolePermissions` 文件的內建層級改用 `getDefaultRolePermissions()` 當回退來源，避免在權限文件尚未建立前整批入口消失；同步更新 `docs/architecture.md`、`js/config.js` 與 `index.html` 快取版本到 `20260310y`。
- **教訓**：當系統已經引入細粒度權限碼後，若入口顯示與頁面可見性還殘留舊的角色層級門檻，最終會變成「權限已開卻不能用」的雙軌衝突；入口與頁面要共用同一套權限判斷來源。

### 2026-03-10 — 權限管理頁改版並加入預設權限保存
- **問題**：原本「自訂層級管理」名稱不夠直觀，權限清單也沒有依抽屜排序，缺少「儲存成預設」與「只顯示已有權限」功能；此外總管開關可手動關閉，存在誤觸風險。
- **原因**：權限頁只渲染當前 `rolePermissions.permissions`，沒有獨立的預設權限來源，也沒有 UI 狀態去處理篩選與總管鎖定；抽屜入口排序資訊雖已存在於 `DRAWER_MENUS`，但權限頁尚未完整沿用。
- **修復**：更新 `pages/admin-system.html` 與 `js/i18n.js`，將頁面與抽屜入口名稱改為「權限管理」；更新 `js/config.js`，把「活動管理」「賽事管理」納入權限目錄並讓分類順序直接跟隨抽屜；更新 `js/modules/user-admin-roles.js`，新增「儲存成預設」「只顯示已有權限」、總管鎖定與自訂層級預設權限初始化；更新 `js/api-service.js`、`js/firebase-crud.js`、`js/firebase-service.js`，加入 `rolePermissions.defaultPermissions` 的讀寫與同步；同步更新 `css/admin.css`、`docs/architecture.md`、`js/config.js` 與 `index.html` 快取版本到 `20260310x`。
- **教訓**：權限編輯頁若沒有把「目前權限」「預設權限」「不可關閉的系統權限」分開建模，後續一加上重置或篩選功能就會互相干擾；這類後台頁要先把狀態來源整理乾淨，再做 UI 擴充。

### 2026-03-10 — LINE 頭像失效時自動 fallback 成字首
- **問題**：進入用戶管理頁時，部分使用者的 LINE 頭像網址已失效，瀏覽器對 `profile.line-scdn.net` 請求回 `404`，導致管理頁與個人相關頁面持續噴圖片載入錯誤。
- **原因**：系統把 LINE 當下回傳的 `pictureUrl` 存進資料庫後，後續頁面直接用 `<img src="...">` 渲染，沒有在圖片失敗時回退到字首頭像；而其他使用者的頭像只能等該使用者自己再次登入時才會刷新。
- **修復**：更新 `js/modules/profile-core.js`，新增共用頭像 helper，統一處理圖片渲染與 `error` fallback；更新 `js/modules/profile-data.js`、`js/modules/profile-card.js`、`js/modules/user-admin-list.js`，讓個人頁、用戶名片與用戶管理頁的頭像在連結失效時自動切回字首顯示；同步更新 `js/config.js` 與 `index.html` 快取版本到 `20260310w`。
- **教訓**：第三方頭像網址即使來自官方來源，也不能假設永久有效；所有頭像 UI 都應有本地 fallback，並把「刷新最新頭像」與「舊網址失效時仍可顯示」視為兩層不同問題分開處理。

### 2026-03-10 — 後台抽屜入口全面接入自訂層級權限並修正自訂層級 runtime
- **問題**：後台抽屜入口長期只靠 `minRole` / `data-min-role` 控制，未接入自訂層級管理的權限開關；同時「新增自訂層級」建立後，也沒有正確進入全域角色等級比較，插在自訂層級之後的角色甚至不會被排序出來。
- **原因**：抽屜選單與 `showPage()` 沒有共用權限碼判斷；`permissions` 清單也缺少後台入口權限分類；角色等級則寫死在固定 `ROLE_LEVEL_MAP`，沒有動態計算自訂層級鏈。
- **修復**：更新 `js/config.js`，新增後台抽屜入口對應的權限碼與內建權限分類，並改用 runtime 角色序列 / Proxy 解析自訂層級的 `ROLES` 與 `ROLE_LEVEL_MAP`；更新 `js/modules/role.js` 與 `js/core/navigation.js`，讓抽屜顯示與切頁都同時檢查入口權限；更新 `js/api-service.js`，將 `permissions` 改為內建 catalog 與 Firestore 清單合併渲染；更新 `js/modules/user-admin-roles.js`，修正自訂層級排序與預設權限重置來源；更新 `js/firebase-service.js`，為 `rolePermissions` 加入 catalog metadata 並補做 admin / super_admin 的後台入口權限遷移；同步更新 `js/modules/profile-core.js`、`docs/architecture.md`、`js/config.js` 與 `index.html` 快取版本到 `20260310v`。
- **教訓**：只提供「新增自訂層級」表單但不把它接進全域角色等級解析，功能表面上看似完成，實際上會在抽屜、頁面顯示與權限比較時全面失真；這類 runtime 等級模型必須從一開始就做成單一來源。

### 2026-03-10 — 調整後台抽屜中儀表板與小遊戲管理的角色門檻
- **問題**：後台抽屜裡的「數據儀表板」與「小遊戲管理」順序和預設角色門檻與實際需求不符，數據儀表板需要收斂到總管，小遊戲管理則要開放給一般管理員。
- **原因**：抽屜選單（`DRAWER_MENUS`）與頁面片段（`data-min-role`）仍沿用舊設定，導致抽屜順序、入口可見性與頁面實際門檻都停留在原本配置。
- **修復**：更新 `js/config.js`，將「小遊戲管理」與「數據儀表板」在後台抽屜中的位置互換，並把兩者的預設最低角色改為 `admin` 與 `super_admin`；同步更新 `pages/admin-dashboard.html`、`pages/admin-system.html` 的 `data-min-role`，並將 `js/config.js` 與 `index.html` 快取版本升到 `20260310u`。
- **教訓**：抽屜入口的角色門檻若有調整，必須同時改 `DRAWER_MENUS` 與頁面本身的 `data-min-role`，不能只改其中一層，否則會出現選單與實際頁面權限不一致。

### 2026-03-10 — 活動參與查詢主卡改為摘要模式
- **問題**：數據儀表板中的活動參與查詢同時顯示摘要數字與大型明細表格，畫面過重，且詳細資料已經有臨時頁可以承接。
- **原因**：第一版查詢卡把摘要與完整明細都放在同一張卡裡，還保留了 `複製結果` 流程，導致主儀表板和臨時頁職責重疊。
- **修復**：更新 `js/modules/dashboard-participant-query.js`，移除主卡內的明細表格與 `複製結果` 按鈕，只保留 `符合活動`、`符合用戶`、`參與次數` 三個摘要數字與臨時網址入口；同步把剪貼簿 helper 收斂成共用的 `_copyDashboardParticipantText()`，並更新 `js/modules/dashboard-participant-share.js` 讓臨時頁分享沿用新 helper、可在有符合活動但無符合用戶時仍建立摘要頁；同步更新 `docs/architecture.md`、`js/config.js` 與 `index.html` 快取版本到 `20260310t`。
- **教訓**：若已有專用的詳細閱讀頁，主儀表板應優先呈現摘要決策資訊，不要同時承擔完整報表角色，否則可讀性會快速下降。

### 2026-03-10 — 日誌中心工具列位置與返回箭頭統一
- **問題**：日誌中心整併後，操作日誌、稽核日誌、錯誤日誌的操作按鈕散落在不同位置，有些在頁首、有些在摘要列，返回按鈕文案也被改成「返回」，視覺不一致。
- **原因**：按鈕沿用各子頁原本的掛載位置，整併時只把內容搬進同頁，沒有把操作入口一起收斂到共用工具列。
- **修復**：更新 `js/modules/admin-log-tabs.js`，新增共用工具列並把 `清空資料`、`重整`、`清除 30 天前` 固定收斂到同一區塊；更新 `js/modules/audit-log.js`、`js/modules/error-log.js`，讓稽核與錯誤日誌的動作按鈕改為同位置同樣式的文字按鈕；更新 `css/admin.css` 統一工具列與危險操作樣式，並把日誌中心返回按鈕文案統一維持 `←`；同步更新 `js/config.js` 與 `index.html` 快取版本到 `20260310s`。
- **教訓**：多頁整併成單頁分頁時，不能只合併內容區，連操作按鈕的掛載層也要一起重構成共用工具列，才不會留下拼裝式 UI 痕跡。

### 2026-03-10 — 活動參與查詢支援 7 天臨時分享頁
- **問題**：後台活動參與查詢雖然能在儀表板直接看結果，但無法把查詢當下快照輸出成可分享、可留存的臨時網址頁。
- **原因**：查詢結果只存在前端記憶體，沒有獨立的快照資料模型、公開頁 route，也沒有對匿名只讀與到期失效做規則控管。
- **修復**：更新 `js/modules/dashboard-participant-query.js`、新增 `js/modules/dashboard-participant-share.js`，讓管理者可把查詢結果建立成 7 天有效的臨時網址；同步更新 `js/api-service.js` 寫入 / 讀取 `participantQueryShares` 快照、`pages/admin-dashboard.html` 新增公開頁容器、`js/core/navigation.js` 與 `app.js` 補上 route 進入與初始網址導向、`firestore.rules` 補上公開只讀規則、`css/admin.css` 新增分享狀態與公開頁樣式，並把快取版本升到 `20260310r`。
- **教訓**：需要對外分享的管理查詢結果，不應直接重跑後台查詢；應改成最小化公開欄位的快照模型，搭配明確的 `expiresAt` 與匿名只讀規則，才能同時兼顧可用性與風險控制。

### 2026-03-10 — 後台日誌中心整併為單頁分頁
- **問題**：操作日誌、稽核日誌、錯誤日誌分散在左側抽屜三個入口，管理者切換比對時要一直離開目前頁面。
- **原因**：三種日誌原本各自綁定獨立 route，缺少共用容器與標籤切換層。
- **修復**：新增 `js/modules/admin-log-tabs.js`，把三種日誌整併到同一個「日誌中心」頁；抽屜只保留一個入口，舊的稽核/錯誤日誌 route 會自動轉到同頁對應標籤，並把 `page-admin-logs` 的資料預載擴到 `operationLogs` 與 `errorLogs`。
- **教訓**：同一類型且常需要交叉對照的管理工具，優先整合成單頁分頁式 UI，比維持多個平行頁面更好維護。

### 2026-03-10 — 新增後台活動參與查詢
- **問題**：管理者目前無法用活動關鍵字與時間區間，快速查出實際簽到過該批活動的用戶與參與次數。
- **原因**：既有儀表板只有總覽統計，沒有針對活動標題與日期區間的交叉查詢；而現有 `attendanceRecords` 即時快取僅保留最近 500 筆，也不適合直接拿來做歷史全量統計。
- **修復**：新增 `js/modules/dashboard-participant-query.js` 作為儀表板查詢卡；在 `js/api-service.js` 補上管理查詢用的 server read 方法，先查日期區間內的 `events`，再分批讀取符合活動的 `attendanceRecords`，以 `checkin` 為準並按 `uid + eventId` 去重，確保同一主用戶同場只算一次；同步更新 `js/modules/dashboard.js`、`js/core/script-loader.js`、`css/admin.css`、`docs/architecture.md`，並將快取版本升到 `20260310p`。
- **教訓**：後台歷史查詢不能依賴頁面即時快取，尤其集合已有明確的 500 筆監聽上限時，應改成查詢時強制讀 Server，再把聚合留在管理工具層處理。

### 2026-03-10 — 修正首頁活動卡片性別緞帶偏移
- **問題**：首頁活動卡片把性別緞帶移到人數右側後，女生限定的緞帶看起來偏掉，失去原本明顯的斜角定位感。
- **原因**：緞帶被改成跟人數列一起參與 flex 排版，並且角度從斜掛式改成較平的 `-12deg`，導致它的定位基準跟著文字基線走，看起來像漂移。
- **修復**：更新 `js/modules/event-list.js` 與 `css/home.css`，把首頁性別緞帶改回卡片內的絕對定位，並保留在圖片下方的人數右側區域；同時恢復明顯斜角旋轉與右側預留空間，避免壓到人數文字；同步更新 `js/config.js` 與 `index.html` 快取版本到 `20260310o`。
- **教訓**：斜角緞帶這類視覺元件不要直接放進一般文字排版流，否則旋轉後的視覺中心很容易和基線打架，定位感會立刻變差。

### 2026-03-10 — 個人資訊的我的資料開放編輯性別
- **問題**：個人資訊頁的「我的資料」編輯模式只能修改生日、地區與聯繫方式，性別仍是唯讀，無法在後續自行調整。
- **原因**：編輯區沿用顯示用文字欄位呈現性別，`saveProfileInfo()` 也沒有把性別納入 `更新目前使用者（updateCurrentUser）`。
- **修復**：更新 `pages/profile.html`，將編輯模式的性別欄位改成下拉選單；更新 `js/modules/profile-data.js`，在切換到編輯模式時預填目前性別，儲存時把 `gender` 一起送進 `ApiService.updateCurrentUser()`；同步更新 `js/config.js` 與 `index.html` 快取版本到 `20260310n`。
- **教訓**：同一組個人資料若在首次登入要求必填，後續個人資訊頁也要提供一致的可編輯入口，否則修正資料只能靠額外流程。

### 2026-03-10 — 首頁活動卡片性別緞帶改到人數右側
- **問題**：首頁活動卡片的性別緞帶原本壓在圖片上，使用上希望改到圖片下方、靠近人數右側的空白區。
- **原因**：首頁卡片一開始沿用圖片覆蓋式緞帶，雖然醒目，但不符合首頁卡資訊層級與使用習慣。
- **修復**：更新 `js/modules/event-list.js`，把首頁卡片結構改成地點一列、人數與緞帶一列；同步調整 `css/home.css`，將性別緞帶改為放在卡片內容下方右側、維持斜角視覺但不再覆蓋圖片；並更新 `js/config.js` 與 `index.html` 快取版本到 `20260310m`。
- **教訓**：同一種視覺標記不一定適合所有卡片場景，首頁卡片更適合把限制資訊放在內容區，避免干擾圖片資訊。

### 2026-03-10 — 活動行事曆性別緞帶改成限男生 / 限女生
- **問題**：活動行事曆卡片左上角的性別限定緞帶目前只顯示「限定」，辨識度不夠高。
- **原因**：行事曆卡片沿用固定短字樣，沒有依 `限定性別（allowedGender）` 輸出更具體的文案。
- **修復**：更新 `js/modules/event-list.js`，讓活動行事曆緞帶改為顯示 `限男生` 或 `限女生`；同步調整 `css/activity.css` 緞帶寬度與字距，避免旋轉後裁字，並更新 `js/config.js` 與 `index.html` 快取版本到 `20260310l`。
- **教訓**：狀態型緞帶若承載的是限制條件，文案要盡量具體，否則使用者需要再點進詳情才能理解差異。

### 2026-03-10 — 活動詳情頁隱藏未設定的年齡列
- **問題**：活動詳情頁在沒有設定年齡限制時，仍會顯示「年齡：無限制」，畫面資訊偏冗。
- **原因**：活動詳情模板固定渲染年齡列，僅依 `minAge` 值切換文案，沒有在 `0` 或未設定時直接略過整列。
- **修復**：更新 `js/modules/event-detail.js`，改成只有 `最小年齡（minAge）` 大於 `0` 時才輸出年齡列；同步更新 `js/config.js` 與 `index.html` 快取版本到 `20260310k`。
- **教訓**：詳情頁的條件欄位若屬於可選設定，優先考慮「不顯示」而不是用預設文案佔版，能讓資訊層級更乾淨。

### 2026-03-10 — 新增活動性別限定與活動卡緞帶顯示
- **問題**：活動目前只有球隊限定，缺少「只限男性」或「只限女性」的建立欄位、報名限制與前台辨識標示。
- **原因**：活動資料結構、建立表單、範本存取與報名流程都沒有性別限定欄位，首頁卡片、活動列表與詳情頁也沒有對應顯示。
- **修復**：在 `pages/activity.html` 與 `js/modules/event-create.js` 新增性別限定開關與單選欄位，並把 `genderRestrictionEnabled`、`allowedGender` 納入活動建立、編輯與範本；更新 `js/modules/event-detail.js`、`js/modules/event-detail-signup.js`、`js/modules/event-detail-companion.js`，讓非限定性別、性別空白或 `其他` 無法報名；同步在 `js/modules/event-list.js`、`css/home.css`、`css/activity.css` 與 `css/base.css` 加上首頁右下角與活動行事曆左上角緞帶，以及詳情頁紅字性別欄位；最後更新 `js/config.js` 與 `index.html` 快取版本到 `20260310j`。
- **教訓**：牽涉活動條件限制的新欄位，不只要改建立表單，還要同步覆蓋編輯回填、範本、單人報名、同行者報名與列表辨識，否則功能很容易只做半套。

### 2026-03-10 — 補上 LINE 推播綁定的未登入提示
- **問題**：從彈跳廣告或其他入口觸發 LINE 推播綁定時，若目前使用者資料尚未就緒，函式會直接返回，表面上看起來像完全沒反應。
- **原因**：`bindLineNotify()` 一開始只檢查目前使用者是否存在，但缺少未登入與登入狀態尚未同步時的明確提示。
- **修復**：在 `js/modules/profile-data.js` 補上提示與 fallback，未登入時先顯示訊息並導向 `LineAuth.login()`，登入資料尚未同步時顯示稍後再試；同步更新 `js/config.js` 與 `index.html` 快取版本到 `20260310i`。
- **教訓**：站內動作重用既有函式時，要補足原本只在特定頁面假設成立的前置條件，否則換入口後容易變成靜默失敗。

### 2026-03-10 — 彈跳廣告支援一鍵觸發 LINE 推播綁定
- **問題**：彈跳廣告原本只能開外部網址，無法直接重用個人資訊頁的 LINE 推播綁定流程。
- **原因**：彈跳廣告只把 `連結網址（linkUrl）` 視為一般 `http/https` 連結，沒有支援站內動作。
- **修復**：在 `js/modules/popup-ad.js` 新增 `app://bind-line-notify` 站內動作，點擊彈跳廣告時可直接呼叫既有的 `App.bindLineNotify()`；並在 `pages/admin-content.html` 補上後台填寫提示。
- **教訓**：如果現有流程已經能更新資料與 UI，優先做最小入口重用，不要先重建第二套功能。

### 2026-03-10 — 放寬活動名稱上限到 16 字
- **問題**：活動名稱目前限制為 12 字，推廣期建立活動時容易覺得標題不夠用。
- **原因**：活動建立頁同時在輸入欄位與送出驗證中都把標題上限寫死為 12 字。
- **修復**：將活動名稱輸入上限與送出驗證同步放寬為 16 字，並更新 `js/config.js` 與 `index.html` 的快取版本到 `20260310g`。
- **教訓**：調整前端輸入上限時，要同步檢查 HTML 欄位限制、JavaScript 驗證與快取版本，避免改一半或吃到舊快取。

### 2026-03-10 — 新增 change watch 管理者監看指引
- **問題**：後端已經有可疑異動監看，但管理者缺少一份能直接照著查詢、判斷與處理的操作指引，實際上線後不容易快速使用。
- **原因**：既有文件偏向實作與部署說明，沒有把監看的原因、監看範圍、觸發條件、查詢路徑與管理者判斷流程整理成單一說明文件。
- **修復**：新增 `docs/資料異動監看指引20260310.md`，整理可疑監看的目的、已實作項目、可監看集合與欄位、觸發條件、日誌欄位說明、管理者監看流程與事件判斷原則。
- **教訓**：監看機制上線後，除了技術實作文件，也要同步提供給管理者使用的操作型文件，否則功能存在但不容易落地。


### 2026-03-10 — 收斂 change watch TTL 範圍
- **問題**：第一版 change watch 日誌子集合沿用通用名稱 `entries`，而專案內另有 `shotGameRankings/{bucket}/entries/{uid}` 等其他 `entries` 集合群組，未來若也寫入 `expiresAt`，TTL 規則可能誤傷非監看資料。
- **原因**：Firestore TTL 是以 collection group 名稱 + 欄位套用；`entries` 命名過於通用，會讓 change watch TTL 與其他功能共用同一個 collection group 範圍。
- **修復**：更新 `functions/index.js`，將 change watch 日誌寫入路徑從 `changeWatchByDay/{dayKey}/entries/{eventId}` 改為 `changeWatchByDay/{dayKey}/changeWatchEntries/{eventId}`；同步更新 `docs/change-watch-implementation-checklist-20260310.md` 與快取版本到 `20260310f`，後續再把 TTL 從 `entries.expiresAt` 轉移到 `changeWatchEntries.expiresAt`。
- **教訓**：會被 TTL、索引或跨功能查詢共用的 collection group 名稱，一開始就要使用專用命名，避免用 `entries` 這類過度通用的名稱。

### 2026-03-10 — 實作第一版資料異動監看
- **問題**：專案目前先不想大改前端直寫流程，但需要在推廣期觀察可疑的資料篡改痕跡，至少要知道是誰在何時改了敏感資料。
- **原因**：現有審計紀錄主要依賴正常前端流程主動寫入；若使用者直接從瀏覽器 DevTools 或自組 payload 改 Firestore，很多情況不會留下可靠痕跡。
- **修復**：在 `functions/index.js` 新增第一版資料異動監看 helper 與 4 個 Firestore 帶身分上下文觸發器，監看使用者資料（`users`）、活動資料（`events`）、報名資料（`registrations`）、簽到資料（`attendanceRecords`）；新增 `changeWatchByDay/{dayKey}/entries/{eventId}` 日誌寫入；只記錄高信心可疑事件，忽略正常個資更新、正常登入欄位更新、自己取消報名、活動主控或高權限角色的正常管理操作；同步更新 `js/config.js` 與 `index.html` 快取版本到 `20260310e`。
- **教訓**：單靠前端主動寫審計紀錄不足以觀察繞過 UI 的資料修改；若現階段以低風險觀察為主，後端異動監看要先把低噪音放在第一優先，否則日誌很快會失去可用性。

### 2026-03-10 — 新增資料異動監看實作清單
- **問題**：專案目前存在多個前端可直接寫入 Firestore 的敏感路徑，但推廣期不適合立刻全面改成後端處理，仍需要先有一套低風險的觀察方案。
- **原因**：若直接重構報名、簽到、活動與球隊等正式版流程，雖然安全性更高，但改動面大、容易影響推廣期用戶體驗；同時現有日誌偏向記錄正常流程，對繞過 UI 的直接資料修改留痕不足。
- **修復**：新增 `docs/change-watch-implementation-checklist-20260310.md`，整理只監看、不阻擋的 Firestore 異動監看方案，包含監看集合、敏感欄位、後端函式清單、監看日誌結構、風險判定、成本控制與驗證清單。
- **教訓**：在推廣期若安全風險尚未造成實際營運損失，優先導入低侵入、可留痕的監看方案，通常比全面重構更符合穩定性與風險平衡；但文件中必須明確寫出正常操作可被看到但不落地記錄、只有可疑異動才寫日誌這個設計原則，避免後續誤解。

### 2026-03-10 — 修正操作紀錄（`operationLogs`）偶發 already-exists
- **問題**：瀏覽器偶發出現 `[opLog] FirebaseError: Document already exists`，指向操作紀錄（`operationLogs`）寫入。
- **原因**：操作紀錄原本直接用 `.add()` 寫入，由 Firestore 自動產生文件 ID；在重試、離線恢復或 WebChannel 邊界情況下，同一筆 client write 偶發被視為重複建立，導致後端回 `already-exists`。
- **修復**：更新 `js/api-service.js`，在建立操作紀錄時先產生固定文件 ID（`_docId`）；更新 `js/firebase-crud.js`，將 `addOperationLog()` 改成 `doc(docId).set(..., { merge: true })`，讓同一筆重試改為可重入寫入，不再因為文件已存在而報錯；同步把 `js/config.js` 與 `index.html` 版本升到 `20260310d`。
- **教訓**：對使用者無感但會被大量觸發的後台/稽核類 client write，不要依賴「每次都全新 create」的語意；若允許重試，寫入應盡量設計成冪等（idempotent）。

### 2026-03-10 — 綜合修復 Firestore 監聽（`Listen/channel 400`）與首頁啟動競態
- **問題**：正式版陸續出現多種 Firestore 監聽錯誤，包含登入後的訊息監聽（`messages`）400、活動頁的報名監聽（`registrations`）400，以及首頁偶發但不穩定的 `Listen/channel 400`；同時個人資訊頁的「我的球隊申請」還會顯示已不存在球隊或已退出球隊的舊狀態。
- **原因**：這不是單一 bug，而是三層問題疊加。第一層是前端查詢範圍大於 Firestore 規則允許範圍，例如整包監聽訊息集合（`messages`）或報名集合（`registrations`）；第二層是啟動期對公開集合使用過多並行查詢，boot collections 與首頁活動（`events`）預載同時建立過多 Firestore targets；第三層是個人頁球隊申請狀態只做訊息聚合，沒有再比對球隊是否仍存在、使用者是否仍在該隊。
- **修復**：分階段收斂前端資料流。先把訊息監聽（`messages`）改成依目前用戶可見範圍拆成多條合法查詢，並在訊息寫入補上目標類型（`targetType`）；再把報名監聽（`registrations`）改成一般用戶只監聽自己的報名，管理員（`admin` / `super_admin`）才保留全量監聽；接著移除啟動期 boot/static collection 的 `documentId()` 排序，並把 boot/static collection 載入改成序列化；最後把首頁活動（`events`）預載也從並行改成序列化，讓 `FirebaseService.init()` 先完成 `events` 預載再逐一載入 boot collections。個人資訊頁（`profile-data.js`）則同步過濾已不存在球隊與已退出球隊的申請狀態。
- **成功關鍵**：這次真正讓首頁不再報錯的原因，不是單改某一條 query，而是把整個啟動與監聽流程一起收斂成「規則相容查詢 + 較少並發 targets + 較準確的前端狀態過濾」。前幾次修正先排除了固定的權限不相容查詢，最後一次再把首頁啟動競態壓下來，整體才穩定。
- **教訓**：Firestore 規則不是查詢後過濾器。前端如果直接整包監聽或在啟動期同時建立過多 targets，就算單條查詢看起來合理，也可能在正式環境引發偶發性的 WebChannel / `Listen/channel` 400。之後新增監聽或首頁預載時，要同時檢查「規則相容性」、「是否真的需要全量監聽」以及「啟動期並發數量」。

### 2026-03-10 — 序列化首頁 events 預載以降低首頁偶發 Listen/channel 400
- **問題**：使用者進入首頁時，Firestore 偶發出現 Listen/channel 400 (Bad Request)，而且同一頁有時會報錯、有時不會。
- **原因**：FirebaseService.init() 在首頁啟動期仍會並行預載公開活動（events）與 boot collections，偶發讓 Firestore WebChannel 在初始化階段同時建立過多 targets。
- **修復**：更新 js/firebase-service.js，新增 _fetchQuerySnapshot()，把首頁活動預載從 Promise.all() 改為序列化查詢，並讓 init() 先完成 events 預載後再逐一載入 boot collections；同步把 js/config.js 與 index.html 版本升到 20260310c。
- **教訓**：首頁啟動期的 Firestore 查詢不只要看單條 query 是否合法，還要控制同時建立的 query/listen 數量，否則會出現偶發性的 WebChannel 400。

### 2026-03-10 — 將 boot/static collection 載入改為序列化
- **問題**：啟動期即使收斂查詢形狀後，Firestore 仍在 `FirebaseService.init()` 期間持續出現 `Listen/channel 400`，堆疊顯示與 boot/static collection 載入同時發生。
- **原因**：`js/firebase-service.js` 原本以 `Promise.all()` 併發啟動多個 boot collection 與靜態集合查詢，初始化瞬間會同時建立多個 Firestore targets，增加 WebChannel / listen 通道在啟動期的壓力與不穩定性。
- **修復**：更新 `js/firebase-service.js`，新增 `_fetchCollectionSnapshot()`，把 boot collections 與一般靜態集合載入都改為序列化逐筆查詢，降低啟動期並發 targets 數量；同步更新 `js/config.js` 與 `index.html` 快取版本。
- **教訓**：首頁啟動若要預載多個集合，應優先控制查詢並發度；就算每條 query 單獨合法，初始化期大量同時發送也可能造成 Firestore 通道不穩，尤其在正式站初次進站或網路品質不佳時更明顯。

### 2026-03-10 — 收斂 boot/static collection 查詢避免啟動期 400
- **問題**：即使修正了訊息與報名監聽，正式版啟動階段仍可能在 `FirebaseService.init()` 期間出現 Firestore `Listen/channel 400`，堆疊定位到 `js/firebase-service.js` 的 boot collection `.get()` 查詢。
- **原因**：啟動期與靜態集合載入原本都對多個公開集合使用 `orderBy(documentId()).limit(...).get()`；雖然理論上可行，但這是目前 `init()` 期最明確對應到堆疊的可疑查詢來源，也讓啟動流量比實際需要更複雜。
- **修復**：更新 `js/firebase-service.js`，將 boot collections 與一般靜態集合載入改為更保守的 `limit(...).get()`，移除 `documentId()` 排序依賴，降低啟動期查詢複雜度；同步更新 `js/config.js` 與 `index.html` 快取版本。
- **教訓**：首頁啟動期的公開查詢應盡量保持最小必要複雜度；即使某些 query 在理論上合法，只要它正好落在錯誤堆疊上，就應優先收斂成更簡單、可替代的型態再排查。

### 2026-03-10 — 修正 registrations 即時監聽與規則不相容
- **問題**：一般使用者進入活動列表、活動詳情或我的活動頁時，瀏覽器偶發 Firestore `Listen/channel 400 (Bad Request)`。
- **原因**：`js/firebase-service.js` 的報名即時監聽（`registrations onSnapshot`）原本直接監聽整個集合前 500 筆，但 `firestore.rules` 對報名讀取（`registrations read`）只允許管理員（`admin`）或報名本人，導致查詢本身可能包含不可讀文件，listen 在規則層直接被拒絕。
- **修復**：更新 `js/firebase-service.js`，將報名即時監聽改為依當前身份決定查詢範圍：管理員監聽全量報名，一般使用者只監聽自己的報名（`userId == auth uid`）；並新增 listener key，當目前用戶資料同步後自動重建報名監聽；同步更新 `js/firebase-crud.js` 讓當前用戶 onSnapshot 更新後可刷新相關頁面的報名監聽；更新 `js/config.js` 與 `index.html` 快取版本。
- **教訓**：只要 Firestore 規則對集合採「owner-only read」，前端就不能偷用整包 collection listener；即時監聽也必須先縮成規則可證明合法的查詢，否則會在 WebChannel listen 階段直接報 400，而不是回傳空結果。

### 2026-03-09 — 修正訊息監聽查詢與球隊申請顯示殘留項目
- **問題**：登入後瀏覽器出現 Firestore `Listen/channel 400`，而個人資訊頁的「我的球隊申請」仍會顯示已不存在球隊，或顯示已核准但使用者其實已退出的球隊。
- **原因**：`js/firebase-service.js` 原本直接對訊息集合（`messages`）做整包即時監聽，但目前規則只允許讀取寄件者、收件者、角色收件者、球隊收件者或全體廣播對應的文件，造成查詢與規則不相容；同時 `js/modules/profile-data.js` 只按球隊聚合最新申請，沒有再比對球隊是否仍存在，以及已核准球隊是否仍在使用者目前球隊清單內。
- **修復**：更新 `js/firebase-service.js`，把訊息監聽改為依當前使用者身分拆成多條合法查詢（直接收件、寄件、角色、球隊、全體廣播）後再合併去重；同步更新 `js/firebase-crud.js` 與 `js/modules/message-admin.js`，讓使用者身分變動後會重建訊息監聽，且新寫入的站內訊息帶上目標類型（`targetType`）以支援全體廣播的合法查詢；更新 `js/modules/profile-data.js`，過濾掉不存在球隊，以及已核准但目前已退出的球隊申請狀態；同步更新 `js/config.js` 與 `index.html` 快取版本。
- **教訓**：Firestore 規則不是查詢後過濾器，只要 collection 監聽可能包含不可讀文件，就會在 listen 階段直接失敗；而多球隊申請清單在做「每隊最新一筆」後，還要再套用當前球隊實體與會員狀態驗證，否則 UI 仍會殘留失效紀錄。

### 2026-03-09 — 個人頁球隊申請改為每隊顯示最新狀態
- **問題**：個人資訊頁的「我的球隊申請」原本只顯示全域最新一筆申請狀態，若使用者同時申請多支球隊，其他球隊的最新審核結果會被完全隱藏。
- **原因**：`js/modules/profile-data.js` 的申請渲染流程雖然先依申請群組去重，但最後又直接 `slice(0, 1)`，只保留整體最新一筆，而不是依球隊（`teamId` / `teamName`）各自取最新一筆。
- **修復**：更新 `js/modules/profile-data.js`，新增依申請時間比對的 helper，先對同一申請群組做狀態去重，再以球隊（`teamId` / `teamName`）為單位收斂成每隊最新一筆申請狀態，並同步讓卡片 badge 顯示球隊數量而非訊息總數；同時更新 `js/config.js` 與 `index.html` 快取版本。
- **教訓**：多對象狀態面板不能只看全域最新一筆，必須按業務主鍵分組後再取最新紀錄，否則 UI 會把仍有決策價值的狀態資訊直接吞掉。

### 2026-03-09 — 收緊使用者時間與球隊欄位寫入邊界
- **問題**：使用者文件（`users`）原本允許一般使用者在自助更新中直接帶最後登入時間（`lastLogin`）、更新時間（`updatedAt`）與球隊欄位（`teamId`、`teamName`、`teamIds`、`teamNames`），而刪除球隊（`deleteTeam`）又只清主球隊欄位，導致資料可信度與球隊歸屬都可被前端 payload 篡改。
- **原因**：`firestore.rules` 把時間欄位與球隊欄位混在一般個人資料更新規則（`isSafeSelfProfileUpdate`）中，只驗型別不驗伺服器時間或縮減方向；同時 `js/api-service.js` 的刪隊清理只處理 `teamId === id`，漏掉多球隊清單（`teamIds`）中的 secondary team 引用。
- **修復**：更新 `firestore.rules`，把最後登入時間（`lastLogin`）拆到登入更新格式規則（`isSafeLoginUpdate`），把更新時間（`updatedAt`）與隊職員球隊寫入的時間驗證改為 `request.time`，並新增球隊欄位縮減/清空規則（`isTeamFieldShrinkOrClear`）；更新 `js/api-service.js`，讓刪除球隊（`deleteTeam`）會同時清理主球隊與多球隊清單，正確計算剩餘的 `teamId` / `teamName` / `teamIds` / `teamNames`；補強 `tests/firestore.rules.test.js` 驗證時間欄位與多球隊 shrink 行為，並更新 `docs/architecture.md`、`js/config.js`、`index.html` 與安全性規格書。
- **教訓**：只要某欄位會影響身分、可見性或審計可信度，就不能與一般個人資料共用寬鬆白名單；而任何對 membership schema 的安全修補，都要同步檢查批次清理與刪除流程是否仍會留下 secondary reference。

### 2026-03-09 — 新增使用者時間與球隊欄位安全性規格書
- **問題**：使用者文件（`users`）中的時間欄位與球隊欄位存在前端 payload 可篡改風險，但目前 repo 內缺少一份能直接交付實作者的實作前規格書，也尚未把「中文名稱（英文代碼）」列為專案對話規範。
- **原因**：先前只完成風險盤點與口頭規劃，尚未把修補範圍、解決方式、影響功能、工時與風險收斂成 repo 內正式文件；同時 AGENTS 也沒有明文要求後續說明必須採用「中文名稱（英文代碼）」格式。
- **修復**：新增 `docs/user-time-and-team-security-plan-20260309.md`，整理時間欄位（`lastLogin`、`updatedAt`）與球隊欄位（`teamId`、`teamName`、`teamIds`、`teamNames`）的起因、解法、風險、工時、影響功能與施工清單；同步更新 `AGENTS.md`，加入「中文名稱（英文代碼）」術語回覆格式規範。
- **教訓**：安全性修補若會波及多條正式版流程，應先固化成 repo 內規格書再實作；而專案中的中文技術溝通格式也應寫進 AGENTS，避免後續說明再次脫離使用者可讀性需求。

### 2026-03-09 — 停止寫入不可靠的登出稽核
- **問題**：使用者重登入後有時只看到登入、沒看到登出，容易誤以為登入紀錄覆蓋了登出紀錄。
- **原因**：後端稽核寫入本身是以 `.add()` 新增文件，登入與登出不會互相覆蓋；真正不穩的是 `logout` 原本採 fire-and-forget 呼叫後立刻登出並 reload，請求可能在頁面切換前被中斷，因此登出紀錄容易漏失。
- **修復**：更新 [js/modules/profile-data.js](/C:/Users/kere/Downloads/github/FC/FC-github/js/modules/profile-data.js) 停止寫入 `logout` 稽核，只保留較重要且較可靠的 `login_success`；登出時仍保留 Firebase / LIFF session 清理與登入去重狀態重置。
- **教訓**：對會立即跳頁或 reload 的操作，若沒有可靠的送達機制，就不應與高可信度稽核混用；在只能擇一時，應優先保留登入成功這種關鍵紀錄。

### 2026-03-09 — 補齊 Firebase 登出避免重新登入漏記
- **問題**：使用者手動登出後再重新登入，只看得到 `logout` 稽核，卻沒有新的 `login_success`。
- **原因**：前端原本只做 LIFF 登出，沒有同步執行 Firebase Auth `signOut()`；因此重新登入時 Firebase 仍沿用舊 session，`_signInWithAppropriateMethod()` 直接早退，不會重新寫登入成功稽核。
- **修復**：更新 [js/line-auth.js](/C:/Users/kere/Downloads/github/FC/FC-github/js/line-auth.js) 在登出時同步執行 Firebase Auth `signOut()`；更新 [js/modules/profile-data.js](/C:/Users/kere/Downloads/github/FC/FC-github/js/modules/profile-data.js) 以 `await LineAuth.logout()` 完整等待登出流程；同步更新 [js/config.js](/C:/Users/kere/Downloads/github/FC/FC-github/js/config.js) 與 [index.html](/C:/Users/kere/Downloads/github/FC/FC-github/index.html) 快取版本。
- **教訓**：LIFF session 與 Firebase Auth session 是兩套狀態；只清掉其中一邊，稽核與權限行為都可能出現假登出或漏記。

### 2026-03-09 — 修正登出後重登入漏記與清除按鈕未載入
- **問題**：手動登出後立刻重新登入，稽核日誌偶爾沒有新的登入成功紀錄；管理端操作日誌頁的一鍵清除按鈕點擊會報 `App.clearAllData is not a function`。
- **原因**：前一版為了抑制重複 `login_success`，對同 UID 做了 15 秒去重，但沒有在登出時清空去重狀態，導致正常的重新登入也被跳過；另一方面，`clearAllData()` 定義在 `dashboard.js`，但 `page-admin-logs` 只載入 `adminUsers` 群組，沒有載到該模組。
- **修復**：更新 [js/modules/profile-data.js](/C:/Users/kere/Downloads/github/FC/FC-github/js/modules/profile-data.js) 在登出前清除該 UID 的登入去重狀態；更新 [js/firebase-service.js](/C:/Users/kere/Downloads/github/FC/FC-github/js/firebase-service.js) 在 Firebase Auth 登出狀態時重置登入去重快取；更新 [js/core/script-loader.js](/C:/Users/kere/Downloads/github/FC/FC-github/js/core/script-loader.js) 讓 `page-admin-logs` 一併載入 `adminDashboard` 群組，確保 `App.clearAllData()` 存在；同步更新 [js/config.js](/C:/Users/kere/Downloads/github/FC/FC-github/js/config.js) 與 [index.html](/C:/Users/kere/Downloads/github/FC/FC-github/index.html) 快取版本。
- **教訓**：對稽核事件做去重時要有明確的「會話重置」條件，不能把正常的新操作一起吃掉；使用 inline handler 的頁面必須確認對應模組一定會被當前頁面載入。

### 2026-03-09 — 日誌頁改手動刷新並抑制重複登入成功紀錄
- **問題**：稽核日誌與錯誤日誌頁不是即時監聽，切到頁面後若資料有變化只能重進頁面；另外同一輪登入偶爾會寫出兩筆 `login_success`。
- **原因**：日誌頁原本只有初次載入和分頁查詢，沒有提供手動重抓入口；`login_success` 則可能在短時間內被重複呼叫的 Firebase 登入流程寫入兩次。
- **修復**：更新 [js/modules/audit-log.js](/C:/Users/kere/Downloads/github/FC/FC-github/js/modules/audit-log.js) 與 [js/modules/error-log.js](/C:/Users/kere/Downloads/github/FC/FC-github/js/modules/error-log.js)，在頁首動態加入圖示型重新整理按鈕；更新 [js/firebase-service.js](/C:/Users/kere/Downloads/github/FC/FC-github/js/firebase-service.js) 新增 `refreshCollectionsForPage()` 供錯誤日誌主動重抓 Firestore，並加入 `login_success` 15 秒內同 UID 去重，避免短時間重複寫入；更新 [css/admin.css](/C:/Users/kere/Downloads/github/FC/FC-github/css/admin.css) 補齊圖示按鈕樣式。
- **教訓**：非 realtime 的管理頁至少要提供明確的手動刷新入口；對於登入成功這類容易被競態重複觸發的稽核事件，前端或後端要有最低限度的去重保護。

### 2026-03-09 — 補齊稽核暱稱回填與錯誤日誌中文化
- **問題**：稽核日誌中部分今天已寫入的資料只顯示 UID，錯誤日誌則直接顯示英文 code / message，管理端閱讀成本高。
- **原因**：`writeAuditLog` 原本只靠 user doc id / `lineUserId` 找名稱，漏掉 `users.uid` 與 Firebase Auth `displayName`；既有錯誤日誌 UI 也沒有翻譯層與嚴重程度分類。
- **修復**：更新 [functions/index.js](/C:/Users/kere/Downloads/github/FC/FC-github/functions/index.js) 補上 `users.uid` 與 Auth `displayName` fallback，新增 `backfillAuditActorNames` callable 回填指定日期缺失的 `actorName`；更新 [js/api-service.js](/C:/Users/kere/Downloads/github/FC/FC-github/js/api-service.js) 對接回填 callable；重寫 [js/modules/audit-log.js](/C:/Users/kere/Downloads/github/FC/FC-github/js/modules/audit-log.js) 以本地 fallback 解析名字、顯示活動/球隊名稱並提供今日暱稱補齊按鈕；重寫 [js/modules/error-log.js](/C:/Users/kere/Downloads/github/FC/FC-github/js/modules/error-log.js) 將常見錯誤翻成中文並加上 `嚴重 / 警告 / 一般` 標籤；補樣式於 [css/admin.css](/C:/Users/kere/Downloads/github/FC/FC-github/css/admin.css) 並更新 [docs/architecture.md](/C:/Users/kere/Downloads/github/FC/FC-github/docs/architecture.md)。
- **教訓**：稽核資料若要穩定顯示暱稱，後端寫入時就要多來源補齊名稱；管理後台的錯誤資訊則不該直接暴露 raw 英文訊息，至少要有翻譯與嚴重程度，否則很難快速判讀。

### 2026-03-09 — 稽核日誌返回按鍵改回全站一致樣式
- **問題**：稽核日誌頁的返回按鍵顯示成「返回」，和其他頁面統一使用的 `←` 樣式不一致。
- **原因**：`page-admin-audit-logs` 建頁時按鈕文案單獨寫成文字版，沒有沿用其他頁面的返回符號。
- **修復**：將 [pages/admin-system.html](/C:/Users/kere/Downloads/github/FC/FC-github/pages/admin-system.html) 內稽核日誌頁的返回按鍵改回 `←`，與其他頁面保持一致。
- **教訓**：共用頁首元素應沿用既有樣式與文案，不要在單一頁面自訂不同版本，否則會破壞整體一致性。

### 2026-03-09 — 稽核日誌補 UID 對暱稱回填與球隊名稱顯示
- **問題**：部分稽核日誌只顯示 UID，雖然同一 UID 在其他功能已能查到暱稱；另外入隊申請相關稽核日誌缺少球隊名稱，閱讀時不夠直覺。
- **原因**：後端 `writeAuditLog` 查使用者文件時只查 `docId` 與 `lineUserId`，沒查 `users.uid`；前端 audit log 顯示層也沒有再用現有使用者快取做 UID 對暱稱回填。入隊申請則有存 `targetLabel`，但顯示文字沒帶出來。
- **修復**：在 [functions/index.js](/C:/Users/kere/Downloads/github/FC/FC-github/functions/index.js) 補上 `users.uid` 查詢與 Firebase Auth `displayName` fallback；在 [js/modules/audit-log.js](/C:/Users/kere/Downloads/github/FC/FC-github/js/modules/audit-log.js) 新增 UID 對暱稱回填，並讓 `申請入隊 / 同意入隊 / 拒絕入隊` 顯示成「行為：球隊名稱」。
- **教訓**：稽核資料寫入時要盡量存好顯示用快照，但後台顯示層也應保留一次 UID 反查名字的保險，避免舊資料或特殊帳號只剩 UID 可看。

### 2026-03-09 — 稽核日誌補顯示活動名稱
- **問題**：`event_signup`、`event_cancel_signup` 雖然已把活動名稱寫進 audit log，但後台畫面只顯示行為代碼，看不出報名了哪一場活動。
- **原因**：稽核日誌介面前一版為了簡化，只保留「時間 / 名字膠囊 / 行為」，把 `targetLabel` 完全隱藏。
- **修復**：在 [js/modules/audit-log.js](/C:/Users/kere/Downloads/github/FC/FC-github/js/modules/audit-log.js) 針對活動報名與取消報名改成顯示「行為：活動名稱」，保留簡潔版面但不丟失活動辨識資訊。
- **教訓**：精簡顯示不等於把辨識資訊拿掉；對活動相關稽核來說，活動名稱本身就是核心閱讀資訊，應直接呈現在行為文字裡。

### 2026-03-09 — 稽核日誌介面簡化並移除與操作日誌的重複項
- **問題**：`auditLogs` 後台畫面顯示了 UID、目標、來源等過多欄位，閱讀成本偏高；同時 `operationLogs` 與 `auditLogs` 對同一批用戶行為會重複出現。
- **原因**：第一版 audit log 介面以除錯導向呈現完整欄位，且舊的 `_writeOpLog()` 尚未從已導入 audit 的流程中移除。
- **修復**：重寫 [js/modules/audit-log.js](/C:/Users/kere/Downloads/github/FC/FC-github/js/modules/audit-log.js)，將顯示簡化為「時間 / 名字膠囊 / 行為」；並在 [js/modules/team-form.js](/C:/Users/kere/Downloads/github/FC/FC-github/js/modules/team-form.js)、[js/modules/message-inbox.js](/C:/Users/kere/Downloads/github/FC/FC-github/js/modules/message-inbox.js)、[js/modules/user-admin-list.js](/C:/Users/kere/Downloads/github/FC/FC-github/js/modules/user-admin-list.js)、[js/modules/event-detail-signup.js](/C:/Users/kere/Downloads/github/FC/FC-github/js/modules/event-detail-signup.js) 移除重複的操作日誌寫入；另外在 [js/modules/user-admin-exp.js](/C:/Users/kere/Downloads/github/FC/FC-github/js/modules/user-admin-exp.js) 隱藏歷史上已和 audit 重複的操作日誌。
- **教訓**：`auditLogs` 應聚焦稽核閱讀體驗，`operationLogs` 則保留給系統與管理操作；一旦某類用戶行為升級進 audit，就要同步清理舊操作日誌，避免雙邊各記一份。

### 2026-03-09 — 首頁與球隊改回靜態載入，僅保留活動頁即時監聽
- **問題**：`events`、`teams` 在 `FirebaseService.init()` 內全域常駐 `onSnapshot`，首頁和球隊頁沒有真正需要全站即時同步，卻會持續消耗 Firestore 監聽流量。
- **原因**：公開資料初始化沿用了舊的全域 listener 模式，活動頁需要的即時資料與首頁展示資料被混在同一層處理。
- **修復**：調整 [js/firebase-service.js](C:/Users/kere/Downloads/github/FC/FC-github/js/firebase-service.js) 為 `events/teams` 靜態載入，保留 `registrations/attendanceRecords` 作為活動相關頁面的 page-scoped realtime；同步更新 [js/core/navigation.js](C:/Users/kere/Downloads/github/FC/FC-github/js/core/navigation.js) 的離頁收尾，並在 [docs/architecture.md](C:/Users/kere/Downloads/github/FC/FC-github/docs/architecture.md) 補上新版監聽範圍。
- **教訓**：需要即時的應是「正在操作的頁面資料」，不是整站公開集合；listener 要跟頁面生命週期綁定，不能只做到延遲啟動，沒做到離頁關閉。

### 2026-03-09 — 即時監聽改為活動頁專屬，首頁/球隊退回靜態載入
- **問題**：`events`、`teams` 之前是全域 `onSnapshot`，即使使用者不在活動或球隊頁也會持續吃 Firestore 監聽；`registrations`、`attendanceRecords` 雖然是進頁才開，但一旦開過就整段 session 常駐，不是真正的 page-scoped realtime。
- **原因**：`FirebaseService.init()` 直接啟動公開集合 listener，`ensureCollectionsForPage()` 也只負責延遲啟動，沒有在離頁時 unsubscribe。
- **修復**：`js/firebase-service.js` 改成首頁只做 `events` 靜態預載，移除 `events/teams` 全域 listener；新增 page-scoped realtime 管理，只有 `page-activities`、`page-activity-detail`、`page-my-activities`、`page-scan` 保留 `registrations/attendanceRecords` 即時監聽；首頁、球隊頁、賽事頁改為靜態載入 + TTL 式重新抓取；`js/core/navigation.js` 在成功切頁與返回上一頁時同步關閉不再需要的 realtime listener。
- **教訓**：真正要省 Firestore 讀取，不能只有「晚一點開 listener」，還要做到「離頁就關 listener」；首頁展示型資料不值得掛全域 snapshot，操作頁才值得即時同步。

### 2026-03-09 — 修復 index.html 內嵌腳本語法錯誤
- **問題**：首頁載入時出現多個 `Uncaught SyntaxError`，包含 `Unexpected token 'if'`、`Invalid or unexpected token`、`Unexpected token ')'`，導致前台初始化流程中斷，後續 Firestore 與 Service Worker 行為也被連帶影響。
- **原因**：`index.html` 內嵌 `<script>` 區塊被歷史亂碼與註解污染，造成 `if` / `var prev` 被註解吃掉、`console.warn` 與 `b.textContent` 字串未閉合、以及 `serviceWorker` / `window.addEventListener('error')` 的條件判斷被壓進註解同一行。
- **修復**：修正 `index.html` 中 4 段內嵌腳本的壞行，補回 `?clear=1` 清快取判斷、版本變更的 `prev` 讀取、`Loading overlay safety timeout` 警告字串、`serviceWorker.controllerchange` 監聽，以及 script load fail recovery 按鈕文字；並同步將快取版本升到 `20260309l`、更新 `js/config.js` 的 `CACHE_VERSION`。
- **教訓**：HTML 內嵌腳本一旦被亂碼或註解汙染，會比一般 JS 檔更難局部修補；之後碰到頁面層 `SyntaxError`，要先檢查是否有「註解吃掉程式碼」與「未閉合字串」這兩類低級錯誤。
---

### 2026-03-09 — 修正頁首右上角順序與擠壓跑版
- **問題**：頁首右上角在窄螢幕或資訊較多時容易被 EXP 顯示擠壞，視覺順序也不符合需求，應從右至左呈現頭像、通知鈴鐺、體育分類。
- **原因**：`top-bar-right` 內的 DOM 順序是 sport picker、EXP、通知、頭像，且 header 缺少最小寬度與縮排保護，手機寬度下容易被文字與數字撐壞。
- **修復**：調整 `index.html` 右上角區塊順序為 `points -> sport -> notif -> avatar/login`，並在 `css/layout.css`、`css/base.css` 補上 header 間距、不可換行、logo 收縮與手機隱藏 `points-display` 的規則，讓右側主要操作固定維持頭像、鈴鐺、體育分類的排列。
- **教訓**：固定列的操作區不能只靠 DOM 順序湊版面，必須同時補齊 `flex-shrink`、`min-width` 與窄螢幕降載策略，否則很容易在真機上跑版。
---

### 2026-03-09 — 新增防亂碼編碼規範
- **問題**：Windows / PowerShell / shell 重寫檔案與歷史混合編碼內容交錯時，容易把顯示亂碼寫成真正檔案亂碼，尤其在 `index.html`、`docs/claude-memory.md` 與含中文 UI 文案的 JS 檔案上風險更高。
- **原因**：repo 缺少足夠具體的操作級編碼規範，導致工具可能在未明確指定 UTF-8 的情況下重寫檔案，或直接依據終端亂碼內容做 patch / replace。
- **修復**：在 `AGENTS.md` 新增「防亂碼編碼規範」，明確要求 repo 檔案統一 UTF-8、中文檔案優先 `apply_patch`、禁止未指定 encoding 的 shell 寫檔、終端亂碼不得直接當作 patch 依據，並強制對高風險檔案做提交前檢查。
- **教訓**：防亂碼不能只靠事後檢查，必須把「如何安全修改檔案」寫成操作規範，尤其在 Windows 環境下要優先防止 shell 重寫造成的編碼漂移。
---
### 2026-03-09 — 修復首頁標題亂碼與取消報名 fallback
- **問題**：`index.html` 的 `<title>` / Open Graph meta 再次出現亂碼；一般用戶取消報名時偶發顯示「資料尚未同步，請稍後再試」。
- **原因**：首頁標題區塊曾被受損編碼覆寫；取消報名流程過度依賴前端 `registrations` 快取，且只接受 `confirmed` 狀態，遇到快取未到齊或舊資料 `registered` 狀態時就找不到有效報名紀錄。
- **修復**：將 `index.html` 的標題與分享 meta 改為穩定可解析內容；在 `js/modules/event-detail-signup.js` 新增 Firestore fallback 同步，取消報名前會重新抓一次該用戶該活動的 registrations，並兼容 `confirmed` / `registered` 狀態。
- **教訓**：前端按鈕若允許用 `participants` / `waitlistNames` 做 fallback 顯示，後續動作不能只信任本地快取；至少要有一次 server-side / Firestore fallback 查證，否則 UI 和實際資料容易脫鉤。

---

### 2026-03-09 — 修復報名成功通知在模板缺失時整段不送
- **問題**：一般用戶報名成功後，偶發完全收不到站內信與 LINE 推播。
- **原因**：`signup_success` 依賴 `notifTemplates`；當模板尚未 seed、快取未載入、或讀取失敗時，`_sendNotifFromTemplate()` 直接 return，導致通知整段跳過。
- **修復**：在 `js/modules/message-inbox.js` 補齊所有內建通知模板 fallback，缺模板時先照常送出通知，再背景呼叫 `functions/index.js` 的 `ensureNotificationTemplates` 自動補齊 Firestore 模板資料。
- **教訓**：通知不能把成功路徑綁死在可選設定資料；像模板、配置、後台 seed 資料都要有 fallback 與自我修復路徑，避免一般用戶第一個踩到的是靜默失敗。

---

### 2026-03-09 — 補齊站內信與 LINE 推播接線缺口
- **問題**：多個一般用戶操作雖然會收到站內信，但沒有同步收到 LINE 推播，容易誤以為是一般用戶權限被擋。
- **原因**：推播權限本身不是主因；真正缺口是多條流程只呼叫 `_deliverMessageToInbox()`，沒有同步排入 LINE 推播，例如取消報名、入隊申請/審核、賽事申請/審核、球隊職位指派。
- **修復**：在 `js/modules/message-inbox.js` 新增 `_deliverMessageWithLinePush()` 共用 helper，並補上 `event-detail-signup.js`、`team-form.js`、`team.js`、`tournament-render.js`、`message-inbox.js` 的關鍵通知事件，改為「站內信 + LINE 推播」同步送出。
- **教訓**：通知功能不能只看 Firestore inbox 是否有寫入；若產品要求站內信與 LINE 同步，必須把兩條路徑收斂到同一個 helper，否則很容易局部漏接。

---

### 2026-03-09 — 修復 claude-memory 歷史亂碼並改為新到舊排序
- **問題**：`docs/claude-memory.md` 留有歷史亂碼，且部分 2026-03-09 條目被追加在檔案中段，閱讀順序不一致。
- **原因**：先前混合編碼與後續補記條目沒有統一遵守置頂規則，導致同日期紀錄分散、部分中文失真成 `?`。
- **修復**：清理已知亂碼區塊、恢復檔頭說明與歷史條目中文、將 2026-03-09 audit log 相關紀錄移回檔案前段，並同步更新 `AGENTS.md` 明定 `docs/claude-memory.md` 新紀錄一律置頂。
- **教訓**：修復日誌本身也需要嚴格的排序與編碼規範；一旦發現歷史紀錄污染，要先整理再繼續追加。

---

### 2026-03-09 — 圖片裁切功能（Image Cropper）
- **問題**：用戶上傳圖片時無法控制可見區域，`object-fit: cover` 自動裁切結果不可預期。
- **原因**：上傳流程僅壓縮圖片，未提供裁切 UI。
- **修復**：
  - 新增 `js/modules/image-cropper.js`：全螢幕裁切 Modal，支援拖拽定位、縮放（滑桿 + 雙指捏合）、Canvas 輸出。
  - 新增 `css/image-cropper.css`：裁切 Modal 樣式。
  - 修改 `js/modules/image-upload.js`：`bindImageUpload()` 新增 `aspectRatio` 參數，壓縮後呼叫裁切器。
  - 修改 `app.js`：`_bindPageElements()` 為每個上傳點傳入對應的寬高比（16:9 / 4:3 / 3:1 / 1:1 / 0=跳過）。
  - 修改 `js/modules/achievement.js`：`_bindAchBadgeUpload()` 整合裁切器（1:1）。
  - 更新 `index.html`：新增 CSS/JS 引用，版本號更新至 `20260309g`。
- **教訓**：Canvas pre-crop 方式不需改 Firestore schema 或顯示端程式碼，整合點最少。`aspectRatio=0` 可跳過裁切（如主題背景）。

---

### 2026-03-09 — 解鎖本機 Firestore rules 驗證
- **問題**：本機無法直接跑 Firestore emulator 規則測試，先後卡在 Java 缺失、Firebase emulator cache 目錄權限，以及既有 rules 對 `request.auth.token.role` 的未定義存取。
- **原因**：這台 Windows 環境缺少可用 Java，`firebase-tools` 預設 emulator 快取路徑不可寫，且 `authRole()` 對缺少 `role` claim 的測試 token 沒有做存在性檢查。
- **修復**：改用 per-user Microsoft OpenJDK 21，將 emulator jar 下載到工作區 `.cache/firebase/emulators`，以本機 wrapper 方式跑 emulator 測試；同時修正 `firestore.rules` 的 `authRole()`、收緊 `messages.read`、放寬 `messages.delete` 給發送者，並更新 `tests/firestore.rules.test.js` 讓 `teams`、`shopItems`、`messages` 的期望值與現行規則一致。
- **教訓**：本機驗證環境也屬於專案可用性的一部分；當規則依賴 auth claim 時，rules 本身必須先對缺少欄位的 token 做防禦式檢查，否則 emulator 與正式環境都會留下難追的權限分歧。

---

### 2026-03-09 — 新增 audit log rules 測試覆蓋
- **問題**：audit log 已新增 `super_admin` 限讀規則，但原本的 Firestore rules 測試沒有覆蓋 `auditLogsByDay/{dayKey}/auditEntries/{logId}`，上線前缺少自動驗證。
- **原因**：第一波實作先完成功能與文件，測試矩陣尚未補上新 collection group 的讀寫限制。
- **修復**：`tests/firestore.rules.test.js` 新增 `auditEntries` seed 與 rules 測試，覆蓋 read 只允許 `super_admin`、client create/update/delete 全拒；本地也補安裝 root 測試依賴。
- **教訓**：新增受保護 collection 後，要立刻補對應的 rules 測試；否則規則回歸時很難第一時間發現權限鬆動。

---

### 2026-03-09 — audit log collection group 改名避免 TTL 衝突
- **問題**：audit log 子集合原本使用通用名稱 `entries`，未來若其他功能也新增 `*/entries/*`，同一條 Firestore TTL policy 可能誤套用到非 audit 資料。
- **原因**：Firestore TTL policy 是套用在 collection group 名稱層級，不能限制單一父路徑；使用過於通用的集合名稱會放大跨功能衝突風險。
- **修復**：`functions/index.js`、`js/api-service.js`、`firestore.rules` 將 audit log 路徑改為 `auditLogsByDay/{dayKey}/auditEntries/{logId}`；`docs/audit-log-implementation-plan-20260309.md` 補上 implemented status、`auditEntries` TTL 說明與 `logout` 成本估算；`docs/architecture.md` 同步更新資料流路徑。
- **教訓**：會被 TTL、索引或跨功能查詢共用的 collection group 名稱，一開始就要使用專用命名，避免用 `entries` 這類過度通用的名稱。

---

### 2026-03-09 — audit log 審查後續修正
- **問題**：第一版 audit log 上線後，計劃文件對 `login_failure` 覆蓋範圍、TTL 部署說明、索引需求與成本估算描述不夠完整，且 `logout` 寫 log 使用 `await` 會拖慢登出。
- **原因**：第一版優先把可信寫入路徑與事件接線做出來，後續 review 才補出文件精度與主流程非阻塞的一致性問題。
- **修復**：`js/modules/profile-data.js` 改為 `void ApiService.writeAuditLog(...)`，避免登出被 log 寫入阻塞；`docs/audit-log-implementation-plan-20260309.md` 重寫並補上 `login_failure` 覆蓋限制、TTL collection group 與典型刪除時效、索引策略、成本估算。
- **教訓**：audit log 這類功能除了資料模型與權限，還要明確區分「可信範圍」與「觀測範圍」，並且所有次要紀錄都不應阻塞主流程。

---

### 2026-03-09 — 建立高可信 audit logs（日分桶）
- **問題**：專案已有 operation logs 與 error logs，但缺少針對登入、報名、取消報名、入隊審批與後台角色變更等高價值操作的嚴格 audit log。
- **原因**：既有 `operationLogs` 由前端直接寫入且讀取權限過寬，不適合 super_admin 稽核，也不適合擴大後的查詢成本。
- **修復**：
  - `functions/index.js`：新增 `writeAuditLog` callable、audit payload 清理、日分桶寫入 `auditLogsByDay/{dayKey}/auditEntries`，以及 180 天保留的 `expiresAt`。
  - `firestore.rules`：新增 `auditLogsByDay/{dayKey}/auditEntries/{logId}` 規則，只允許 `super_admin` 讀取且禁止 client 直接寫入。
  - `js/api-service.js`：新增 `writeAuditLog()` 與 `getAuditLogsByDay()` helper。
  - `pages/admin-system.html`、`js/modules/audit-log.js`、`js/core/navigation.js`、`js/core/page-loader.js`、`js/core/script-loader.js`、`js/config.js`、`js/i18n.js`：新增 super_admin 專用 audit log 頁面，支援單日查詢、時間區間、暱稱/UID 搜尋、行為篩選與載入更多。
  - `js/firebase-service.js`、`js/modules/profile-data.js`、`js/modules/event-detail-signup.js`、`js/modules/team-form.js`、`js/modules/message-inbox.js`、`js/modules/user-admin-list.js`：接上 login success、login failure、logout、報名、取消報名、入隊申請/同意/拒絕、角色變更與管理員編輯使用者等 audit 事件。
  - `docs/audit-log-implementation-plan-20260309.md`、`docs/architecture.md`：補上實作計劃與架構變更說明。
- **教訓**：Audit log 應視為獨立系統，不該混在一般操作日誌裡；應走可信後端寫入、按日分桶控制讀取範圍，且排除於前端全域快取與 realtime listener 之外。

---

### 2026-03-05 — 射門遊戲嵌入主站（Phase 2）
- **問題**：射門遊戲只存在於獨立的 `game-lab.html`（需要 token + 私測），無法讓一般登入用戶玩。
- **原因**：架構設計為私測入口，未整合至主站 SPA。
- **修復**：新增以下檔案：
  - `pages/game.html` — 主站頁面片段（無 token gate，直接使用主站 auth）
  - `js/modules/shot-game-page.js` — 遊戲 App 模組（Object.assign 模式），含 Three.js 懶載入、引擎 lifecycle 管理、排行榜、intro modal
  - `css/game.css` — 遊戲頁樣式（所有 selector 以 `#page-game` 為前綴防衝突）
  - 修改 `js/config.js` — 新增 DRAWER_MENUS 射門遊戲入口 + CACHE_VERSION 20260305j
  - 修改 `js/core/page-loader.js` — 加入 `page-game: 'game'` 映射
  - 修改 `js/core/navigation.js` — `_renderPageContent` 加入 page-game；showPage 離開時呼叫 destroyShotGamePage
  - 修改 `pages/home.html` — 新增「小遊戲」區塊含 home-game-card 快捷按鈕
  - 修改 `css/home.css` — 新增 `.home-game-card` 樣式
- **關鍵設計**：Three.js (CDN, ~580KB) 在用戶首次進入 `page-game` 時才懶載入；shot-game-engine.js 透過 ScriptLoader 懶載；離開頁面時 engine.destroy() 釋放 WebGL context。
- **教訓**：`pages/*.html` 片段中的 `position:fixed` modal 在父元素 `display:none` 時不會渲染，無需額外關閉邏輯（但仍在 destroyShotGamePage 中主動關閉以避免狀態殘留）。

---

### 2026-03-05 — Shot Game Phase 1 雲端排行榜接入

- **問題**：Phase 0 射門遊戲排行榜為假資料（mock），需接入正式 Firestore + Cloud Function
- **原因**：Phase 0 設計為純本地 localStorage，故意不接 Firebase
- **修復**：
  1. `firestore.rules`：新增 `shotGameScores`（owner 可讀）與 `shotGameRankings`（登入可讀）規則；前端不可寫
  2. `functions/index.js`：新增 `submitShotGameScore` onCall（驗證 score/shots/durationMs/節流；寫入稽核紀錄 + 更新日榜最高分）
  3. `js/api-service.js`：新增 `submitShotGameScore()`（呼叫 Cloud Function）與 `getShotGameLeaderboard()`（讀 Firestore，5 分鐘 cache）
  4. `js/modules/shot-game-lab-page.js`：新增 `getTaipeiDateBucket()`；`renderLeaderboard` 改 async 讀 Firestore；`onGameOver` 加非同步提交
- **教訓**：
  - `firebase-functions-compat.js` 雖在 index.html `<link preload>`，實際是 `app.js _loadCDNScripts()` 載入，可用 `firebase.app().functions('asia-east1')`
  - Cloud Function Admin SDK 寫入直接繞過 Firestore rules；rules 只需控制前端讀取權限
  - `renderLeaderboard` 改為 async 不需要 caller await（fire-and-forget 對 UI 更新安全）
  - 節流用 `lastSubmitAt` Firestore field（伺服器端），避免 client bypass

---

### 2026-03-04 — 冷啟動加速：分層啟動 + Edge Cache + TTL 分層（Phase A）

- **問題**：冷啟動 5-15 秒，因 Auth 阻塞公開資料載入 + 7 個 listeners 全部等待首次 snapshot
- **原因**：
  1. `init()` 先等 Auth（最長 15 秒），再啟動所有資料載入
  2. 7 個 onSnapshot listeners 包含需 Auth 的集合（messages/registrations/attendanceRecords/users），全部阻塞 init
  3. Worker 每次轉發 Cloud Function 無 cache
  4. localStorage TTL 統一 30 分鐘，一般用戶頻繁重新載入
- **修復**：
  1. **A1 分層啟動**：boot collections + events + teams 不等 Auth 直接啟動；Auth 並行進行；Auth 完成後背景啟動 messages/users/rolePermissions
  2. **A2 Listener 縮減**：registrations/attendanceRecords 延遲到進入對應頁面時才啟動 listener；terminal events 背景啟動
  3. **A3 TTL 分層**：一般用戶 120 分鐘，admin/super_admin 30 分鐘
  4. **A4 Worker Edge Cache**：`_worker.js` 加 Cache API，team-share 頁面 300 秒 edge cache
- **教訓**：
  - Firestore rules 決定哪些集合可以不等 Auth 載入（`allow read: if true` vs `isAuth()`）
  - 啟動流程應以「首頁可渲染」為目標，Auth 和 auth-required 資料在背景並行
  - localStorage cache 對回訪用戶是最佳加速手段，TTL 可以按角色分層
- **版本**: `20260304a`
- **Files**: `firebase-service.js`, `_worker.js`, `config.js`, `index.html`

### 2026-03-04 — 自我驗證：分層啟動引入的寫入競態問題修復

- **問題**：分層啟動讓 `_initialized = true` 早於 Auth 完成，使用者可在 Auth 未就緒時觸發 Firestore 寫入操作導致 `permission-denied`
- **原因**：
  1. 原本 `init()` 阻塞等待 Auth 後才設 `_initialized = true`，寫入時 `auth.currentUser` 一定已就緒
  2. 新的分層啟動在公開資料就緒後即設 `_initialized = true`，Auth 仍在背景並行
  3. `firebase-crud.js` 約 50 個寫入方法中，僅 3 個（`registerForEvent`、`cancelRegistration`、`createOrUpdateUser`）有 `_ensureAuth()` 守衛
  4. `api-service.js` 的 `_create`/`_update`/`_delete` 通用方法及數個直接 `db.collection()` 寫入均無 Auth 檢查
  5. `_startRegistrationsListener` / `_startAttendanceRecordsListener` 在 Auth 未完成時被多次呼叫會重複排隊 `.then()` 回調
- **修復**：
  1. `firebase-service.js` 新增 `ensureAuthReadyForWrite()` — 等待 `_authPromise` 完成（最長 10 秒），供所有寫入操作統一使用
  2. `firebase-crud.js`：`batchRegisterForEvent()` + `cancelCompanionRegistrations()` 加入 `ensureAuthReadyForWrite()` 守衛（高風險用戶操作）
  3. `api-service.js`：`_create()`、`_update()`、`_delete()` 通用方法中的 Firebase 呼叫改為先 `ensureAuthReadyForWrite().then(...)` 再執行
  4. `api-service.js`：`deleteTournament()`、`adjustUserExp()`、`adjustTeamExp()` 等直接 `db.collection()` 寫入加入 auth 守衛
  5. `_startRegistrationsListener` / `_startAttendanceRecordsListener` 加入 `_pendingRegistrations` / `_pendingAttendance` flag 防止 `.then()` 重複排隊
- **自我驗證結果**：
  - 全部 JS 語法檢查（`node -c`）：通過
  - Demo 模式不受影響：`app.js` line 450 有 `!ModeManager.isDemo()` 守衛，`init()` 不會在 Demo 模式執行
  - `_loadEndedEvents` 無外部呼叫者：確認已被 terminal events listener 取代
  - `_persistCache` / `_restoreCache` 集合完整性：`registrations`、`messages` 已加入 `_deferredCollections`
  - `destroy()` 正確清理 `_realtimeListenerStarted` 和 `_authPromise`
  - `index.html` 版本號全部更新，無殘留舊版號
- **教訓**：
  - 將阻塞操作改為並行時，必須檢查所有下游消費者是否假設了「前置條件已滿足」
  - 寫入操作的 Auth 守衛應在統一入口（`ensureAuthReadyForWrite`）而非散落各處
  - 延遲 listener 的 `.then()` 重試模式需加 pending flag 防止多次排隊
- **版本**: `20260304a`
- **Files**: `firebase-service.js`, `firebase-crud.js`, `api-service.js`

---

### 2026-02-28 - Firestore rules盤點與高風險修補（重點補記）
- **Problem**: Firestore rules 與前端/後端存取路徑長期累積，存在「登入即可跨人讀寫/刪除」與 queue 濫用風險，且缺少可持續回歸測試。
- **Scope**:
  - 先盤點 `firestore.rules` + code usage（collections/path + CRUD + 角色假設）
  - 建立 rules 自動化測試框架（Emulator + `@firebase/rules-unit-testing`）
  - 先修最低風險且不破壞既有流程的漏洞（cross-user damage、queue abuse）
- **Key Fixes (Rules)**:
  - `/registrations/{regId}`: 僅 owner 或 admin/superAdmin 可讀寫刪；禁止 member 操作他人 registration。
  - `/messages/{msgId}`: 僅 sender（`fromUid`）或 admin/superAdmin 可 update/delete/read（依現規則）；禁止跨人破壞。
  - `/linePushQueue/{docId}`: create 從 member 可寫改為至少 admin/superAdmin 才可寫；guest 明確拒絕。
  - 保留 admin/superAdmin 管理能力，不擴大破壞既有功能範圍。
- **Key Fixes (Tests)**:
  - 將原本標記 `[SECURITY_GAP]` 的重點案例（registrations/messages/linePushQueue）改為修補後預期，並用 `[SECURITY_GAP_FIXED]` 保留追蹤語意。
  - 強化 A/B 使用者互斥測試：memberA 不能讀/改/刪 memberB；member 不可批量刪他人資料。
- **Lesson**: rules 修補要以「最小破壞」為優先，先封鎖跨人破壞與濫用入口，再逐步收斂其他灰區權限。
- **Files**: `firestore.rules`, `tests/firestore.rules.test.js`

### 2026-02-28 - Firestore Security Rules 測試框架落地（repo root）
- **Requirement**: rules 測試依賴不得綁在 `functions/`；需在 repo root 建立可持續執行流程。
- **Implementation**:
  - root 安裝並使用：`@firebase/rules-unit-testing`、`firebase-tools`、`jest`、`cross-env`。
  - `firebase.json` 補齊 Firestore emulator 設定，並確保載入當前 `firestore.rules`。
  - `package.json` scripts:
    - `test:rules:unit`
    - `test:rules`（`firebase emulators:exec --only firestore`）
    - `test:rules:watch`
  - 測試 helper contexts 固定化：`guest/memberA/memberB/admin/superAdmin`，並集中 seed 入口（`withSecurityRulesDisabled`）。
- **Outcome**: rules regression 可在本機 emulator 內穩定重現與驗證。
- **Files**: `package.json`, `firebase.json`, `tests/firestore.rules.test.js`

### 2026-02-28 - Role usability smoke tests（角色可用性冒煙）
- **Goal**: 不追求全覆蓋，先驗證各角色核心操作是否可用。
- **Added contexts**:
  - `user(uidUser)`, `coach(uidCoach)`, `captain(uidCaptain)`, `manager(uidManager)`, `leader(uidLeader)`, `venue_owner(uidVenue)`, `admin`, `superAdmin`
  - 同步 seed `claims/token.role` 與 `/users/{uid}.role`，對齊目前 fallback 邏輯。
- **Coverage focus**:
  - user 對 own registration/message 的 CRUD 可用性。
  - coach+ 對 event、manager/leader 對 teams 的可用性驗證。
  - admin/superAdmin 可 create `linePushQueue`；一般 user 必須 fail。
  - 用 `[USABILITY_BLOCKED]` / `[SECURITY_GAP_USABILITY]` 標註「規格應允許但被擋」或「不該允許卻放行」。
- **Files**: `tests/firestore.rules.test.js`

### 2026-02-28 - UID 不一致登入修補與舊 users 文件相容
- **Problem**: LINE/Firebase UID 與 users docId 不一致時，前端容易出現 permission-denied 與 WebChannel 400/404 後續錯誤。
- **Fix Direction**:
  - 偵測 UID mismatch 時強制重新登入/刷新 token（避免 stale auth session）。
  - 避免前端去改寫 uid 主鍵型欄位。
  - 相容舊資料：允許 legacy users docId 轉移到 canonical uid doc（migrate once）。
- **Result**: 登入後 profile 同步流程更穩定，跨舊資料時不再直接卡死在 permission-denied。
- **Files**: `js/firebase-crud.js`, `js/modules/profile-core.js`, `js/firebase-service.js`（相關流程）

### 2026-02-28 - 活動建立「球隊限定」多選體驗重設計
- **Problem**: 原 team-only UI 不易讀、不好選，且無法自然支援 10+ 球隊多選。
- **UX Redesign**:
  - 改為「已選標籤 + 搜尋欄 + 勾選清單」的多選器。
  - `ce-team-select` 改為隱藏狀態源，新的 picker 負責互動與同步。
  - 文案改為全中文，移除英文狀態文字。
  - 列表可滾動、可搜尋、可快速取消單一已選球隊。
- **Files**: `pages/activity.html`, `css/base.css`, `js/modules/event-create.js`


### 2026-03-04 — 低成本加速規劃文件（只動前端方案）
- **問題**：首頁冷啟動偏慢，但需要一份不改後端、只靠前端分階段落地的低成本加速計劃，方便後續施工。
- **原因**：現況首頁首載混合了 eager scripts、Firebase/Auth 啟動與多個 listeners，缺少按風險與成本排序的落地規格。
- **修復**：新增 `docs/low-cost-acceleration-plan.md`，整理只動前端的加速方案，分成 Phase A / Phase B，並補上風險、工作量與驗收項目。
- **教訓**：性能優化若要持續推進，先把「不碰後端 / 可分階段」的低風險方案文件化，會比直接試改更穩。

### 2026-03-04 - Fix Firestore users/messages permission mismatch
- **問題**：[deliverMsg] 和 [updateCurrentUser] 觸發 Firestore Missing or insufficient permissions，且一般用戶清空訊息會走全域 delete。
- **原因**：Firestore.rules 與前端資料模型不一致；messages 仍偏舊欄位權限邏輯，users self-update 白名單不足。
- **修復**：更新 Firestore.rules 的 users/messages 規則；message-admin.js 寫入補上 fromUid/toUid/hiddenBy；message-inbox.js 清空改為 hiddenBy 個人隱藏。
- **教訓**：規則變更要與前端資料結構同步，訊息刪除需優先使用 per-user soft hide。

### 2026-03-04 — 新增亂碼檢查與即時修復規則
- **問題**：實作過程偶爾會出現無法判讀的亂碼，若未即時處理會擴散到更多檔案。
- **原因**：跨工具與編碼處理時，文字內容可能被錯誤轉碼（mojibake）。
- **修復**：在 AGENTS.md 與 CLAUDE.md 新增「實作亂碼檢查規則」，要求每次實作後檢查亂碼，能修即修，不能修需明確回報風險與方案。
- **教訓**：編碼檢查要納入每次實作的收尾檢查清單，避免小範圍亂碼演變成全域資料污染。

### 2026-03-04 — 修復收藏頁活動狀態誤顯示為報名中
- **問題**：用戶已取消活動報名，但個人頁收藏清單仍顯示「報名中」。
- **原因**：收藏清單狀態來源使用 event.status（活動整體狀態），未優先採用當前用戶在該活動的報名狀態。
- **修復**：在 js/modules/favorites.js 新增 _getFavoriteEventBadge()，優先依當前用戶 registrations 顯示「已報名/候補中/已取消報名」；無個人報名資料時才回退活動狀態。
- **教訓**：個人頁面中的狀態標籤必須以「用戶關聯狀態」為優先，避免與活動全域狀態混用。
### 2026-03-04 — 3D Charged Shot Phase 0 private lab launch
- **問題**：需要先驗證射門小遊戲耐玩度，但不能直接暴露給一般用戶，也不能污染正式排行榜資料。
- **原因**：正式站內 modal 與雲端排行榜尚未完成，若直接接入會提高風險（資料污染、權限與防作弊策略未就緒）。
- **修復**：新增 `docs/Phase 0~2 完成.md` 完整規格；新增私測頁 `game-lab.html`（Token gate）；新增 `js/modules/shot-game-engine.js` 與 `js/modules/shot-game-lab-page.js`；本地統計寫入 `sporthub_shot_game_lab_metrics_v1`，提供 JSON 匯出/重置；更新 `_headers` 對私測頁加上 `X-Robots-Tag: noindex`。
- **教訓**：遊戲功能應先做隔離式私測與本地指標驗證，再接正式雲端榜單；避免在驗證階段引入難回滾的資料與權限風險。

### 2026-03-05 — game-lab.html 一片藍（showGame 未實際顯示遊戲區塊）
- **問題**：開啟 `/game-lab.html?t=<token>` 後畫面一片藍，遊戲完全沒出現。
- **原因**：`shot-game-lab-page.js` 的 `showGame()` 使用 `gameSection.style.display = ''`（清空 inline style），導致元素退回 CSS 規則 `#game-section { display: none; }`，遊戲區塊永遠隱藏；gate 也因 `gate.style.display = 'none'` 被隱藏，頁面只剩 body 深藍漸層背景，即「一片藍」現象。
- **修復**：`showGame()` 改為 `gameSection.style.display = 'block'` 以確實覆蓋 CSS 規則；更新 `game-lab.html` 及 `js/config.js` 快取版本號至 `20260305`；index.html 全部 64 處 `?v=` 一併更新。
- **教訓**：用 `element.style.display = ''` 只會移除 inline style，若 stylesheet 仍有 `display: none` 則元素不會顯示。需顯示元素時必須設定具體值（如 `'block'`），不可依賴清空 inline style。

### 2026-03-05 — 蓄力時游標離開球體範圍導致蓄力斷開

- **問題**：按住蓄力後移動游標，一旦游標離開球體（或容器範圍），蓄力立即中斷。
- **原因**：
  1. `pointermove` / `pointerup` listeners 掛在 `container` 上，依賴 `setPointerCapture` 將事件路由到容器；在某些瀏覽器或觸控裝置上 `setPointerCapture` 表現不一致。
  2. `#shot-game-container` 缺少 `touch-action: none`，在行動端瀏覽器偵測到拖曳後觸發滾動意圖，發送 `pointercancel` 事件。
  3. `pointercancel` 被掛到 `onPointerUp`，會呼叫 `kick()` 意外踢球而非靜默中止蓄力。
- **修復**：
  1. `shot-game-engine.js`：改用 **window-level listeners 策略**：`pointerdown` 命中球後動態向 `window` 加掛 `pointermove`、`pointerup`、`pointercancel` 三個監聽；放開或取消後透過 `cleanupWindowListeners()` 一次移除。移除原本 `container.setPointerCapture` 呼叫。
  2. 新增獨立 `onPointerCancel`：靜默中止（`charging = false`、清除 UI）而不踢球。
  3. `game-lab.html`：`#shot-game-container` CSS 加入 `touch-action: none`。
  4. 快取版本號 `20260305b` → `20260305c`，同步更新 `index.html`（64 處）及 `game-lab.html`（2 處）。
- **教訓**：跨元素邊界的拖曳行為應改用 window-level listeners（動態掛載/卸載），比 `setPointerCapture` 更可靠且不受容器邊界限制；行動端務必加 `touch-action: none` 防止滾動劫持 pointer 事件。

### 2026-03-05 — 射門遊戲強化：門框反彈、連進特效、足球貼圖

- **問題**：私測版射門遊戲缺少「打中門框的物理回饋」、連進里程碑的情緒反饋，以及足球本體視覺辨識度。
- **原因**：
  1. 既有物理僅處理地面反彈與門線判定，沒有門柱/橫樑碰撞解算。
  2. `#sg-message` 只有一般得分文案，沒有連進里程碑視覺事件。
  3. 球材質為純色 `MeshStandardMaterial`，缺少足球紋理語意。
- **修復**：
  1. `js/modules/shot-game-engine.js`：新增門框碰撞解算（左右門柱垂直 capsule + 橫樑水平 capsule），在 `step()` 先處理碰撞再做門線進球判定，並加入反射、切向阻尼、旋轉衰減。
  2. `js/modules/shot-game-engine.js`：新增連進 `5/10/20/30` 里程碑判定，命中時顯示 `🔥 ×N 連進！`。
  3. `game-lab.html` + `js/modules/shot-game-engine.js`：新增 `flash-hit` 亮度閃白（`brightness(2)`）與 JS 觸發/清理機制。
  4. `js/modules/shot-game-engine.js`：用 `CanvasTexture` 動態生成經典黑白五邊形足球貼圖並套用到球材質。
  5. `game-lab.html`：`shot-game-engine.js` 快取版號 `20260305d` → `20260305e`。
- **教訓**：射門遊戲的手感與可理解性需要「物理回饋 + 視覺回饋」同時存在；碰撞、訊息、材質三者一起升級，才能讓玩家即時理解球路與成就節點。

### 2026-03-05 — 改用現成球貼圖素材並統一「當前最佳」文案

- **問題**：先前自繪球面貼圖方案在球體上出現變形與半球覆蓋感；底部歷史文案需由「開啟後最佳」改名為「當前最佳」。
- **原因**：自繪圖樣與球體 UV 映射不一致；UI 文案仍沿用舊字串。
- **修復**：
  1. `js/modules/shot-game-engine.js`：改用 `THREE.TextureLoader` 載入 `assets/ball/club-world-cup-2025/textures` 的 `Al_Rihla_baseColor / normal / metallicRoughness`，直接套到既有 `SphereGeometry` 材質。
  2. 同步設定貼圖 `flipY=false`、色彩貼圖 `sRGBEncoding`、`anisotropy`（上限 8）以改善方向與清晰度。
  3. `js/modules/shot-game-lab-page.js` 與 `game-lab.html`：將「開啟後最佳」全面改為「當前最佳」。
  4. `game-lab.html`：更新版本參數為 `shot-game-engine.js?v=20260305g`、`shot-game-lab-page.js?v=20260305e`。
- **教訓**：球體外觀優先採完整 PBR 貼圖流程（BaseColor/Normal/MetalRough）比臨時平面圖樣更穩定；文案命名需與產品語彙一致，避免同義詞造成認知落差。
### 2026-03-05 — 首頁 Firestore Listen/channel 400/404 連續報錯修復

- **起因**：
  1. `FirebaseService.init()` 在未完成登入時仍會啟動 auth-dependent 監聽（`messages/users/rolePermissions`）。
  2. 受保護監聽在未登入或登入切換中觸發 WebChannel 重試，首頁持續出現 `Listen/channel` 400/404。
  3. 登入完成後缺少穩定補啟動時機，初始化與 Auth 狀態容易失步。
- **修復**：
  1. `js/firebase-service.js`
     - `_watchRolePermissionsRealtime`、`_startMessagesListener`、`_startUsersListener` 加上 `auth.currentUser` 守門。
     - `_startAuthDependentWork()` 在未登入時直接 return，不再啟動受保護監聽。
     - `init()` 新增 `auth.onAuthStateChanged`，Auth 就緒後自動補啟動 auth-dependent 流程。
     - `destroy()` 補齊 `_authDependentWorkPromise`、`_authDependentWorkUid` 清理。
  2. `js/firebase-crud.js`
     - `createOrUpdateUser()` 三條成功路徑（新建/遷移/更新）都補呼叫 `_startAuthDependentWork()`。
- **驗收**：
  1. `node --check js/firebase-service.js` 通過。
  2. `node --check js/firebase-crud.js` 通過。
  3. 程式路徑確認：未登入不啟動受保護監聽，登入後會自動補啟動。

### 2026-03-05 — PK 射手榜刷新後紀錄消失（落庫與登入態修正）
- **問題**：PK 大賽頁面當下可看到「你」的成績，但刷新後常消失，懷疑未正確寫入資料庫。
- **原因**：
  1. `game-lab` 只檢查「有 Firebase user」就放行，匿名登入也可進入遊戲；但 `submitShotGameScore` 會拒絕 anonymous，造成提交失敗。
  2. 前端提交失敗被靜默吞掉（`catch(() => {})`），玩家看不到失敗原因。
  3. 後端僅更新 daily bucket，週榜/月榜不會落庫，切到週/月榜時刷新後更容易誤判為資料遺失。
- **修復**：
  1. `js/modules/shot-game-lab-page.js`：新增匿名登入擋板（需非匿名登入才可進入遊戲與寫榜）。
  2. `js/modules/shot-game-lab-page.js`：提交流程改為 `async/await`，失敗寫入 `console.warn`，遇 `permission-denied` 直接顯示「請回主站重新登入 LINE」。
  3. `functions/index.js`：`submitShotGameScore` 改為同步更新 `daily/weekly/monthly` 三個 bucket，回傳 `isNewBestByPeriod` 供除錯。
  4. 依快取規則更新版本：`js/config.js` `CACHE_VERSION` → `20260305n`，`index.html` 與 `game-lab.html` 全部 `?v=` 同步升版。
- **教訓**：排行榜功能必須把「可遊玩資格」與「可寫榜資格」對齊，且提交失敗不可靜默；UI 有多周期榜單時，後端 bucket 寫入也必須同步覆蓋，避免出現「當下看得到、刷新就消失」的假象。

### 2026-03-05 — 射門遊戲廣告偶發「被刪除」根因修復（seed 覆蓋）
- **問題**：射門遊戲廣告（`banners/sga1`）偶發突然變空白，表現像被隨機刪除；首頁 Banner 曾有類似偶發清空體感。
- **原因**：
  1. `FirebaseService._seedAdSlots()` 在 `cache` 為空時，使用 `set(..., { merge: true })` 直接把預設空值（`status: 'empty'`, `image: null`）寫回既有廣告文件，會覆蓋真實廣告資料。
  2. `_startAuthDependentWork()` 可能在公開 boot collections 尚未完成前就觸發，形成 seed 初始化競態，放大第 1 點發生機率。
  3. `_autoExpireAds()` 全站每分鐘執行，非管理員會話也會進入自動下架流程（雖多數會被 rules 擋寫），增加狀態抖動與誤判。
- **修復**：
  1. `js/firebase-service.js`：`_seedAdSlots()` 改為「先讀 doc，僅建立不存在的欄位」，不再覆蓋既有廣告內容。
  2. `js/firebase-service.js`：`_startAuthDependentWork()` 新增 `_initialized` 守門與 promise 去重，避免初始化競態導致重複 seed。
  3. `js/modules/ad-manage-core.js`：`_autoExpireAds()` 僅允許 admin+ 會話執行（Production），移除一般用戶端的無效自動寫入流程。
  4. 依快取規則更新版本：`js/config.js` `CACHE_VERSION` → `20260305o`，`index.html` 全部 `?v=` 同步升版。
- **教訓**：seed 類初始化必須是「只補缺」而非「覆蓋預設」，且需避開啟動競態；排程型寫入（如自動下架）應限制在可寫角色或後端任務，避免前端多端競態改寫正式資料。

### 2026-03-05 — 射手榜同玩家重複列（「你」+「玩家XXXX」）修復
- **問題**：射手榜會出現同一個玩家兩列，分數完全相同，一列是本地「你」，另一列是 `玩家XXXX`，看起來像重複寫入。
- **原因**：
  1. 後端排行榜以 `shotGameRankings/{bucket}/entries/{uid}` 寫入，實際上同 bucket 不會有同 uid 的重複文件。
  2. 前端渲染時先讀 Firestore 排名，再無條件把本地最佳分數（`player-self`）再 push 一列，造成同一人雙列。
  3. 當 Firebase Auth displayName 為空時，Firestore 那列會顯示 fallback 名稱 `玩家${uid尾碼}`，更像「另一個玩家」。
- **修復**：
  1. `js/modules/shot-game-lab-page.js`：榜單組裝改為以當前 `auth.currentUser.uid` 合併本地與遠端資料；若遠端已有本人列只更新更佳成績，不再新增第二列。
  2. `js/modules/shot-game-page.js`：主站嵌入版套用同一合併邏輯，避免雙列。
  3. 兩個模組提交分數時，`displayName` 改為優先採用 `LineAuth.getProfile().displayName`（auth displayName 為空時避免落成 `玩家XXXX`）。
  4. 依快取規則更新版本：`js/config.js` `CACHE_VERSION` → `20260305p`，`index.html` 與 `game-lab.html` 全部 `?v=` 同步升版。
- **教訓**：榜單渲染若同時混用「本地暫存分數」與「遠端排名」，必須先做 uid 去重與合併；否則即使資料庫無重複，UI 仍會誤導成重複寫入。
### 2026-03-05 — PK 射門 UI 可讀性與主題切換修正
- **問題**：淺色模式中央訊息過亮、左上 HUD 字太小、深色模式主題切換月亮圖示會被滑塊或邊界遮擋。
- **原因**：setMessage() 固定使用亮色字，HUD 字級偏小，主題切換按鈕的滑塊位移與圖示留白配置不足。
- **修復**：js/modules/shot-game-engine.js 新增淺色模式訊息顏色映射；game-lab.html 調整 HUD 字級（含手機版）並修正主題切換的 track overflow、icon z-index、moon 位置與 thumb 位移；快取版號更新為 20260305q（js/config.js、index.html、game-lab.html）。
- **教訓**：UI 在雙主題下都要檢查對比與可視範圍，切換元件要同時驗證層級、位移與邊界裁切。
### 2026-03-05 — 射手榜即時「幽靈玩家」重複列修復
- **問題**：同一局剛結算時，榜單會同時出現「你」與一筆 玩家XXX 同分資料；重新整理後重複列消失。
- **原因**：前端會先插入本地最佳成績列，雲端資料回來後若以 doc.id 比對不到自己（例如歷史資料鍵值不一致），就會在當下畫面形成雙列。
- **修復**：shot-game-lab-page.js 與 shot-game-page.js 新增排行榜 uid/id 身分去重、提交中暫存列機制（僅提交中才顯示本地列），並改為優先以 row.uid 對齊當前使用者；提交完成後強制重刷榜單以移除暫存列。
- **教訓**：排行榜合併本地暫存與遠端資料時，必須有穩定 identity key（uid）與「暫存列生命週期」控制，否則容易出現短暫幽靈重複列。
### 2026-03-05 - game-lab remove light cloud pattern and add opening loader
- **Issue**: Light theme background still had cloud icons, and game-lab lacked the same opening loading transition used on the main site.
- **Cause**: Light theme bg-pattern pointed to a cloud SVG, and game-lab did not include the loading-overlay / boot-loading UI and progress animation flow.
- **Fix**: Updated game-lab light theme bg-pattern to none (keep gradient only), added main-site style loading overlay (brand image, pixel progress bar, scan animation, percentage), and completed/hid overlay in bootShotGameLab() after initialization.
- **Lesson**: Standalone entry pages must explicitly include boot UX and completion timing when they bypass the main App init pipeline.
### 2026-03-05 - shot leaderboard name prefer LINE nickname
- **Issue**: Some leaderboard rows still showed placeholder names like player_xxxx instead of full LINE nicknames.
- **Cause**: Client-side submit name selection prioritized Firebase Auth displayName; when that value was placeholder-like, it was written into rankings.
- **Fix**: Updated js/modules/shot-game-lab-page.js and js/modules/shot-game-page.js to prefer LineAuth.getProfile().displayName first, and only fallback when unavailable; updated functions/index.js to avoid persisting placeholder-like names when better auth token name exists.
- **Lesson**: For social-login identity fields, establish a strict source priority and filter placeholder values before persistence.
### 2026-03-05 — 首頁空資料區塊隱藏與小遊戲卡片視覺升級
- **問題**：首頁在沒有近期活動/賽事時仍顯示空區塊，小遊戲卡文案與視覺不符合需求。
- **原因**：`renderHotEvents()` 與 `renderOngoingTournaments()` 在空資料時只顯示提示文案，沒有隱藏整個區塊；小遊戲卡沿用一般卡片樣式與舊標題副標。
- **修復**：`js/modules/event-list.js` 新增首頁區塊顯示控制與小遊戲捷徑渲染；`js/modules/tournament-render.js` 在無賽事時隱藏區塊；`pages/home.html` 更新小遊戲卡標題/副標；`css/home.css` 改為金色漸層底並加入規律反光動畫。
- **教訓**：首頁摘要區塊應採「有資料才顯示」策略，避免空區塊噪音；重點入口卡片要用專屬視覺語言凸顯優先級。
### 2026-03-05 — 小遊戲 HUD 位置調整與首頁顯示開關管理
- **問題**：射門遊戲「當前最佳」顯示在左下角不易對齊 HUD；後台缺少首頁小遊戲顯示開關，無法控管首頁是否顯示小遊戲卡。
- **原因**：`session-badge` 放在底部列；抽屜後台只有佈景主題入口，沒有遊戲配置頁與對應資料模型。
- **修復**：將 `session-badge` 移到左上 HUD（分數/連進上方，主站與 game-lab 同步）；新增 `gameConfigs` 資料流（DemoData / FirebaseService / ApiService / firebase-crud upsert）；新增 `js/modules/game-manage.js` 與 `page-admin-games`，並在抽屜加入「小遊戲管理」入口；首頁小遊戲顯示改為讀取 `gameConfigs.homeVisible`（預留 `HOME_GAME_PRESETS` 多遊戲結構）。
- **教訓**：首頁入口是否顯示屬於全站配置，應獨立成可擴充的設定集合，不應綁死在單一頁面固定文案或硬編碼顯示邏輯。
### 2026-03-05 — 射門 HUD 改為整合資訊卡（當前最佳 + 即時分數）
- **問題**：玩家希望左上角資訊改為單一欄位，顯示「當前最佳記錄」與「分數/連進」，並與右側九宮格得分說明卡等高。
- **原因**：原本 UI 將 `session-badge` 與 `分數/連進` 拆成三個 chip，資訊分散且高度與右側說明卡不一致。
- **修復**：`pages/game.html` 與 `game-lab.html` 改成單一卡片版型（標題/最佳紀錄/分隔線/即時分數列）；`css/game.css` 與 `game-lab.html` 內嵌樣式改為固定資訊卡高度、與九宮格說明卡同高；`js/modules/shot-game-page.js`、`js/modules/shot-game-lab-page.js` 新增 `onScoreChange` 即時同步與 session badge 模板更新邏輯。
- **教訓**：HUD 需以「資訊聚合與掃讀效率」為優先，並在視覺層建立一致對齊基準（同高卡片）來降低玩家辨識成本。
### 2026-03-05 — 球門左右移動範圍擴大 20%
- **問題**：球門左右移動範圍偏窄，希望邊界再往外增加 20%。
- **原因**：射門引擎內 `GOAL_MIN_X / GOAL_MAX_X` 為固定 ±6.6，導致可移動水平區間受限。
- **修復**：`js/modules/shot-game-engine.js` 改為 `GOAL_BASE_SWING_BOUNDARY * GOAL_SWING_RANGE_SCALE`，並將 `GOAL_SWING_RANGE_SCALE` 設為 `1.2`，使邊界由 ±6.6 擴至 ±7.92；同步更新快取版本 `20260305x`（`js/config.js`、`index.html`、`game-lab.html`）。
- **教訓**：遊戲可調參數應避免硬編碼，抽成「基準值 + 倍率」可降低後續平衡調校成本。
### 2026-03-05 — HUD 記分板重構與九宮格等高對齊
- **問題**：九宮格得分欄位需完整包覆分數格內容，當前最佳欄位需與九宮格等高，且分數/連進需要更醒目的多層記分板風格。
- **原因**：前版 HUD 為單層文字卡，字級偏小且視覺層級不足；高度使用固定值，無法保證以九宮格卡片實際高度為基準對齊。
- **修復**：`pages/game.html`、`game-lab.html` 改為「標題 + 分數/連進雙獨立框 + 最佳紀錄 + 底部即時列」堆疊結構；`css/game.css` 與 `game-lab.html` 內嵌樣式放大字級兩級並加入記分板視覺；`js/modules/shot-game-page.js`、`js/modules/shot-game-lab-page.js` 新增動態高度同步（以九宮格卡片高度套用至當前最佳卡）與焦點數值即時更新。
- **教訓**：HUD 需要同時處理資訊層級與版面對齊；當兩個卡片要求等高時，應由主卡實測高度驅動，不要依賴固定常數。
### 2026-03-05 — HUD 記分板資訊重排與欄位縮窄
- **問題**：希望分數/連進上層欄位縮窄，`當前最佳記錄` 移到中段，移除重複的分隔線與下層分數列，並在最上方改為 `本局記錄`。
- **原因**：上一版同時保留上層記分框與下層即時列，資訊重複；`當前最佳記錄` 放置層級也不符合使用者掃讀順序。
- **修復**：`pages/game.html`、`game-lab.html`、`shot-game-page.js`、`shot-game-lab-page.js` 將結構改為 `本局記錄 → 分數/連進雙欄 → 當前最佳記錄 → 分|射門|秒`；移除 `sg-session-divider` 與 `sg-session-live`；`css/game.css` 與 `game-lab.html` 內嵌樣式將上層雙欄寬度改為約 37.5%（較原先縮窄 25%），並調整數字字體為不換行、等寬數字風格，避免四/五位數換行。
- **教訓**：高頻資訊（本局分數）與歷史資訊（當前最佳）應分層排列且避免重複輸出，才能維持記分板可讀性。
### 2026-03-05 — 手機版 HUD 防換行與寬度保護
- **問題**：需兼顧主流手機尺寸，避免 HUD 過窄導致 `分|射門|秒` 在小螢幕換行或擠壓可讀性。
- **原因**：先前手機斷點下欄位寬度與字級配置偏緊，且右上九宮格與左上 HUD 可能互搶水平空間。
- **修復**：`css/game.css` 與 `game-lab.html` 手機斷點調整為更寬的記分板（`min(80vw, 252px)`）、最佳紀錄字級改 `clamp`、數字欄位最小寬度保護（`min-width: 78px`），並在 `<=390px` 時將九宮格得分卡下移避免壓縮 HUD。
- **教訓**：手機版 HUD 應以「不換行優先」設計，透過欄位寬度下限 + 響應式字級 + 元件錯位策略，兼顧可讀性與排版穩定。
### 2026-03-05 — HUD 左右欄位邊線重疊修正
- **問題**：左上本局記錄欄與右上九宮格得分欄在部分尺寸下邊線有輕微重疊。
- **原因**：兩側元件使用固定 left/right 與固定寬度，HUD 寬度缺少「扣除右側九宮格佔位」的最大寬度保護。
- **修復**：`css/game.css` 與 `game-lab.html` 為遊戲容器加入 `--sg-hud-left / --sg-guide-right / --sg-guide-width / --sg-hud-gap` 變數；左側 HUD 改為依 `--sg-hud-left` 靠左，右側九宮格改為依 `--sg-guide-right` 靠右；本局記錄卡新增 `max-width: calc(100% - (...))`，確保不會侵入九宮格區域；手機斷點同步套用變數。
- **教訓**：左右雙錨點 UI 需要「佔位計算式」而非單純固定寬度，才能避免邊線交疊。
### 2026-03-05 — 修復記分板下層母版容器被裁切
- **問題**：左上記分板下方母版區塊在部分尺寸下會被切掉，看起來像「下半截消失」。
- **原因**：HUD 同步高度邏輯將記分板 `height` 硬設為九宮格高度；當記分板內容高度大於九宮格時，底部內容會被裁切。
- **修復**：`shot-game-page.js`、`shot-game-lab-page.js` 的高度同步改為：先 `height='auto'` 取內容高度，再設 `height=max(九宮格高度, 內容高度)`，確保不裁切。
- **教訓**：等高策略不能只依外部參考高度，必須同時保護內容最小需求高度。
### 2026-03-05 — 射門遊戲第二廣告位未生效（改為 3D 球門後看板）
- **問題**：頁面下方廣告可正常顯示，但球門後方的第二廣告位沒有任何畫面。
- **原因**：原本程式只把 `banners/sga1` 寫入 DOM 的 `#sg-ad-container`，3D 引擎內沒有建立第二廣告看板，也沒有把廣告圖同步到引擎層。
- **修復**：
  - `js/modules/shot-game-engine.js`：新增球門後方 3D 廣告看板（frame + ad plane），提供 `setBillboardAdImage()` 動態更新貼圖。
  - `js/modules/shot-game-engine.js`：新增中央訊息半透明橫向底帶（隨主題切換），在訊息顯示時同步淡入淡出，提升廣告高彩度下文字可讀性。
  - `js/modules/shot-game-page.js`：`_loadAd()` 讀取 `sga1` 後同步更新底部廣告與 3D 看板貼圖；無廣告時會清空看板。
  - `js/modules/shot-game-lab-page.js` + `game-lab.html`：加入 `window.__shotGameAdImageUrl` 與 `shotgame-ad-updated` 事件，確保 lab 也同步更新第二廣告位。
- **教訓**：多廣告位需求不能只做 DOM 呈現，必須定義「同一資料源到多渲染層（DOM + 3D）」的同步機制與更新事件。
### 2026-03-05 — 移除右上九宮格面板並改為球門內嵌得分
- **問題**：右上角九宮格得分說明佔畫面空間，且與實際球門得分視覺分離。
- **原因**：得分值只在右上 UI 面板顯示，3D 球門格子本身沒有分數標籤。
- **修復**：
  - `pages/game.html`、`game-lab.html`：移除右上九宮格得分面板 DOM。
  - `js/modules/shot-game-engine.js`：在球門九宮格上新增 CanvasTexture + Sprite 分數標籤（100/50/20/40/10），分數會隨球門一起移動。
  - `css/game.css`、`game-lab.html` 內嵌樣式：將左上 HUD（本局記錄）改為水平置中，並強化 `sg-session-top-title` 置中樣式。
  - `js/modules/shot-game-page.js`、`js/modules/shot-game-lab-page.js`：`syncHudPanelHeight` 不再依賴已移除的 goal-guide 元素。
- **教訓**：分數資訊應盡量與可互動目標同層呈現，避免額外說明面板造成視線分散與版面擁擠。
### 2026-03-05 - shot-game billboard ad source fallback + 8x billboard space
- **Issue**: The behind-goal 3D billboard sometimes did not show the uploaded shot-game ad image.
- **Cause**: Frontend loading only read `banners/sga1`; when ad data existed under another doc id (but still `slot=sga1` or `type=shotgame`), the image was missed.
- **Fix**:
  - `js/modules/shot-game-page.js`: `_loadAd()` now resolves ad by layered fallback (ApiService cache -> `doc('sga1')` -> `where(slot=='sga1')` -> `where(type=='shotgame')`) and picks the latest active row by timestamp.
  - `game-lab.html`: Applied the same fallback strategy for lab entry.
  - `js/modules/shot-game-engine.js`: Added `BILLBOARD_SPACE_SCALE = sqrt(8)` and scaled billboard/frame/posts proportionally.
  - `js/config.js`, `index.html`, `game-lab.html`: bumped cache version to `20260305af`.
- **Lesson**: Do not hard-depend on one ad doc id; always provide slot/type fallback for rendering paths.
### 2026-03-05 - goal 3x3 score labels add translucent theme-aware backdrop
- **Issue**: Score numbers on the goal 3x3 grid were not clear enough in some scenes/themes.
- **Cause**: Label sprites only rendered text (stroke/fill) without a dedicated translucent backdrop behind the score.
- **Fix**:
  - `js/modules/shot-game-engine.js`: upgraded zone score sprite drawing to include rounded translucent backdrop panel.
  - Added dark/light theme palettes for score badge panel + text colors.
  - Added `syncZoneLabelTheme()` so label backdrop/text colors update immediately when theme changes.
  - Updated cache version to `20260305ag` in `js/config.js`, `index.html`, and `game-lab.html`.
- **Lesson**: Dynamic in-scene text should include an explicit contrast layer (panel/badge), not rely on background scene colors alone.
### 2026-03-05 - remove behind-goal 3D billboard ad board
- **Issue**: The behind-goal billboard ad still had intermittent image display problems and affected release stability.
- **Cause**: Billboard path depended on async texture mapping and multiple ad-source conditions, making runtime behavior harder to guarantee.
- **Fix**:
  - `js/modules/shot-game-engine.js`: disabled behind-goal billboard rendering with `ENABLE_GOAL_BILLBOARD = false`.
  - Kept `setBillboardAdImage()` API as a safe no-op to preserve page/lab compatibility.
  - Updated cache version to `20260305ah` in `js/config.js`, `index.html`, and `game-lab.html`.
- **Lesson**: If a non-core visual feature is unstable in production, disable it cleanly first, then reintroduce with observability.
### 2026-03-05 - enlarge goal 3x3 score badge backdrop to near-cell size
- **Issue**: The score badge backdrop on each goal grid cell was still visually too small.
- **Cause**: Both sprite scale and inner rounded panel size were conservative.
- **Fix**:
  - `js/modules/shot-game-engine.js`: increased score badge sprite scale from `0.72x0.48` to `0.94x0.88` of each cell.
  - Expanded inner rounded panel to `96% x 90%` of label canvas and reduced radius to keep corners natural.
  - Updated cache version to `20260305ai` in `js/config.js`, `index.html`, and `game-lab.html`.
- **Lesson**: For in-scene readability, adjust both texture content and world-space sprite scale together.
### 2026-03-05 - theme toggle switched to mask-slider reveal style
- **Issue**: The top-right theme switch still showed icons above the knob; desired behavior was reveal-by-occlusion.
- **Cause**: Previous design used icon+thumb overlap with active icon emphasis, not true cover/reveal interaction.
- **Fix**:
  - `game-lab.html`: refactored `.theme-toggle-*` styles so thumb acts as an opaque cover panel.
  - Dark mode (`.is-dark`): thumb moves left to cover sun and reveal moon.
  - Light mode: thumb moves right to cover moon and reveal sun.
  - Updated cache version to `20260305aj` in `js/config.js`, `index.html`, and `game-lab.html`.
- **Lesson**: For toggle semantics based on reveal, use layer order + overflow clipping, not icon opacity alone.
### 2026-03-06 - shot-game full-charge crosshair shake x5 (power>=100)
- **Issue**: At full charge, crosshair shake was not strong enough to create the intended high-risk feel.
- **Cause**: Existing shake formula only increased linearly in overcharge (`40 + (power-100)*1.8`), so full-charge impact was limited.
- **Fix**:
  - `js/modules/shot-game-engine.js`: added `FULL_CHARGE_SHAKE_MULTIPLIER = 5`.
  - `js/modules/shot-game-engine.js`: kept `power<100` shake unchanged, and applied 5x multiplier when `power>=100`.
  - `js/config.js`, `index.html`, `game-lab.html`: bumped cache version to `20260306`.
- **Lesson**: Lock the trigger window first (`power>=100`) before scaling intensity, so lower-charge handling remains stable.
### 2026-03-06 - overcharge shot curve boosted 5x (power>100)
- **Issue**: User wanted stronger ball flight curve when charge exceeds 100.
- **Cause**: Overcharge path only had moderate curve increase from side spin and curve boost.
- **Fix**:
  - `js/modules/shot-game-engine.js`: added `OVERCHARGE_CURVE_MULTIPLIER = 5`.
  - `js/modules/shot-game-engine.js`: in `kick()`, applied 5x multiplier to overcharge side spin and overcharge curveBoost bonus when `power>100`.
  - `js/config.js`, `index.html`, `game-lab.html`: bumped cache version to `20260306a`.
- **Lesson**: For gameplay feel tuning, isolate multiplier to overcharge window so normal-charge control remains stable.
### 2026-03-06 - crosshair drift tuned and release-shot aim aligned with reticle
- **Issue**: Crosshair drift felt too strong, and shot direction did not always match the reticle position at release.
- **Cause**: Drift only affected DOM transform, while shot target still used non-drift `aim` coordinates; drift amplitude was also too aggressive.
- **Fix**:
  - `js/modules/shot-game-engine.js`: added `CROSSHAIR_SHAKE_SCALE = 0.5` to reduce drift by 50%.
  - `js/modules/shot-game-engine.js`: tracked per-frame crosshair shake pixels and used release-time reticle position to solve world-space shot target on `GOAL_Z` plane.
  - `js/modules/shot-game-engine.js`: reset shake offsets on shot reset/cancel/new charge to avoid stale offsets.
  - `js/modules/shot-game-engine.js`: updated ball texture setup to force full UV coverage (`wrapS/T = RepeatWrapping`, `repeat(1,1)`, zero offset).
  - `js/config.js`, `index.html`, `game-lab.html`: bumped cache version to `20260306b`.
- **Lesson**: If UI jitter is part of gameplay, release-time physics must consume the same jittered coordinates; visual-only jitter causes perceived input mismatch.
### 2026-03-06 - switch shot ball to glTF source mesh for full texture coverage
- **Issue**: Ball texture looked like it was not fully covered on the gameplay ball.
- **Cause**: The game used `SphereGeometry` with atlas textures authored for the original glTF mesh UV layout, causing visible unmapped/dark regions.
- **Fix**:
  - `js/modules/shot-game-engine.js`: replaced runtime ball visual from procedural sphere to `assets/ball/club-world-cup-2025/scene.gltf` mesh.
  - `js/modules/shot-game-engine.js`: preserved a fallback sphere if `GLTFLoader` or glTF loading fails.
  - `js/modules/shot-game-engine.js`: centered/scaled loaded ball model to `BALL_RADIUS`, and applied shadow/material texture settings.
  - `js/modules/shot-game-page.js`: updated Three.js loader flow to also load `GLTFLoader` from r128 examples CDN.
  - `game-lab.html`: included `GLTFLoader.js` before shot-game engine script.
  - `js/config.js`, `index.html`, `game-lab.html`: bumped cache version to `20260306c`.
- **Lesson**: Atlas textures must match the mesh UV layout; if not, always render with the asset's native mesh or re-bake textures for the target UVs.
### 2026-03-06 - shot game theme now follows site theme in page mode
- **Issue**: Entering the shot mini-game page often showed dark theme even when the main site was in light theme.
- **Cause**: `shot-game-engine` only read `data-shot-theme` (lab mode) and otherwise fell back to `prefers-color-scheme`, skipping main-site `data-theme` / `sporthub_theme`.
- **Fix**:
  - `js/modules/shot-game-engine.js`: theme snapshot now resolves in this order: `data-shot-theme` -> `data-theme` -> `localStorage('sporthub_theme')` -> system prefers-color-scheme.
  - `js/modules/shot-game-engine.js`: removed extra matchMedia override path so page mode respects site theme consistently.
  - `js/config.js`, `index.html`, `game-lab.html`: bumped cache version to `20260306d`.
- **Lesson**: Shared components used by page and lab modes must support both theme sources, and should not bypass site-level theme state.
### 2026-03-06 - prevent page-game hard fail when GLTFLoader CDN is unavailable
- **Issue**: Entering the mini-game from main page could show "game load failed" even though engine fallback was available.
- **Cause**: `shot-game-page` treated `GLTFLoader` as required in `_loadThreeJs()`, so loader CDN failure rejected initialization before engine start.
- **Fix**:
  - `js/modules/shot-game-page.js`: added best-effort loader path (`_ensureGltfLoaderBestEffort`), and only keep Three.js core as hard requirement.
  - `js/modules/shot-game-page.js`: if `GLTFLoader` fails, log warning and continue so engine fallback sphere can run.
  - `js/config.js`, `index.html`, `game-lab.html`: bumped cache version to `20260306e`.
- **Lesson**: Optional visual enhancements (model loaders) should never block game boot path when a functional fallback exists.
### 2026-03-06 - fix shot click not starting charge after glTF ball migration
- **Issue**: Clicking/tapping the ball no longer started charging, so users could not shoot.
- **Cause**: Ball became an `Object3D` wrapper with child meshes; click detection still used non-recursive raycast (`intersectObject(ball)`), which misses child geometry.
- **Fix**:
  - `js/modules/shot-game-engine.js`: changed hit test to recursive raycast (`raycaster.intersectObject(ball, true)`).
  - `js/config.js`, `index.html`, `game-lab.html`: bumped cache version to `20260306f`.
- **Lesson**: When converting visuals from direct `Mesh` to grouped/nested objects, all raycast paths must use recursive intersection.
### 2026-03-06 - fix white fallback ball when glTF loader/model is unavailable
- **Issue**: The ball sometimes rendered as plain white with no visible pattern.
- **Cause**: When GLTFLoader/model load failed, engine fell back to a plain white sphere material.
- **Fix**:
  - `js/modules/shot-game-engine.js`: fallback sphere now loads baseColor/normal/metallicRoughness textures.
  - `js/modules/shot-game-page.js`: GLTFLoader best-effort now tries two CDNs (cdnjs, jsDelivr) before fallback.
  - `game-lab.html`: added secondary GLTFLoader CDN script include.
  - `js/config.js`, `index.html`, `game-lab.html`: bumped cache version to `20260306g`.
- **Lesson**: Fallback visuals should preserve key art identity, and external loader dependencies should have multi-source redundancy.
### 2026-03-06 — add homepage slimming implementation spec document
- **Issue**: Needed a decision-complete implementation spec for homepage slimming priorities.
- **Cause**: Team needed a handoff-ready document before coding P0/P1/P2 optimization tasks.
- **Fix**:
  - Added `docs/home-performance-slimming-spec.md` with prioritized plan, implementation steps, risks, tests, and delivery checklist.
- **Lesson**: For multi-step performance refactors, finalize executable spec first to reduce implementation ambiguity and rework.
### 2026-03-06 — 修復 claude-memory 混合編碼並統一記錄規範
- **問題**：`docs/claude-memory.md` 混入非 UTF-8 位元組，導致標準編輯工具無法安全讀寫，也阻斷後續修復紀錄追加。
- **原因**：同一檔案前段為 UTF-8、尾段誤混入 Big5/CP950 內容，形成混合編碼檔案。
- **修復**：
  - 備份原始混合編碼檔到 `C:\Users\kere\.codex\memories\FC-github-claude-memory-20260306-mixed-backup.md`。
  - 以前段 UTF-8、尾段 Big5 的方式無損重建全文，重新輸出為純 UTF-8。
  - 更新 `AGENTS.md` 與 `CLAUDE.md`，明定所有修復/功能記錄統一寫入 `docs/claude-memory.md`，不得另建或分散到其他日誌檔。
- **教訓**：知識庫檔案必須維持單一 UTF-8 規格；一旦發現混合編碼，應先做無損標準化，再繼續追加內容。

### 2026-03-06 — 首頁性能瘦身 V2 Step 1 基線凍結與施工矩陣
- **問題**：V2 規格已建立方向，但真正施工前仍缺少「目前首頁直接依賴什麼、哪些 page/group/data 映射其實不完整」的基線凍結，直接進 Step 2 會把推測當事實。
- **原因**：現況是 loader 架構與 eager scripts 並存，許多映射缺口被 `index.html` 全量載入掩蓋；同時 V2 白名單仍漏了部分首頁實際依賴。
- **修復**：
  - 新增 `docs/home-performance-slimming-step1-baseline.md`，凍結當前啟動鏈、首頁 bootstrap 依賴、route entry 面、loader/data 映射缺口與 Step 2 前置條件。
  - 確認 `shop.js` 的 `bindShopSearch()`、`event-create.js` 的 `bindTeamOnlyToggle()`、`ad-manage-core.js` 的 `trackAdClick()` 目前都不能在 Step 2 前直接移出首頁。
  - 確認 `page-game`、`page-admin-error-logs`、`page-admin-repair`、`page-qrcode`、`page-leaderboard` 是 Step 2 必須先補契約的高風險頁面。
- **教訓**：在無 build、全域 `Object.assign(App, ...)` 的專案中，先凍結真實依賴與缺口，比先動手移 script 更重要；若沒有基線矩陣，後續每一步都會退化成碰運氣施工。

### 2026-03-06 — 首頁性能瘦身 V2 Step 2 導航 gateway 與 loader 契約
- **問題**：`showPage()` 目前沒有形成 `page -> script -> data -> render` 的等待鏈；`PageLoader` 也無法對 boot fragments 提供可等待契約，導致頁面首訪行為仍依賴 eager scripts 與載入時機碰運氣。
- **原因**：現況的 `PageLoader` 只支援部分 deferred page 的即時補載，`ScriptLoader` 也尚未具備「辨識已由 `index.html` eager 載入 script」的能力，因此一旦直接接上 loader 契約就會重複載 script 或首訪缺頁。
- **修復**：
  - `js/core/page-loader.js`：新增全頁面 `pageId -> fragment` 映射、boot pages 可等待契約、單檔載入去重與 `loadAll()` Promise 化。
  - `js/core/script-loader.js`：新增 DOM eager script 掃描、順序穩定載入、補齊 `page-game` / `page-admin-error-logs` / `page-admin-repair` / `page-qrcode` / `page-leaderboard` 等映射。
  - `js/core/navigation.js`：`showPage()` 改為先 `await` page/script/data ready，再切頁並 render；同時加入頁面切換序號，避免快速連點造成過時 render 覆蓋。
  - `js/config.js`、`index.html`：同步 bump `CACHE_VERSION` 至 `20260306h`。
- **教訓**：在腳本尚未真正抽離首頁前，必須先讓 loader 具備「識別既有 eager 資產」的能力，否則一接上 await gateway 就會先產生雙載與順序風險。
### 2026-03-06 - homepage slimming V2 Step 3 detail gateway and deep link guard
- **Issue**: Event/team detail pages could be rendered before their page shells were ready, and boot deep links (?event= / ?team=) retried by polling without waiting for a real detail-open completion.
- **Cause**: showEventDetail() and showTeamDetail() still used the old eager pattern of writing detail DOM first and navigating afterward. _tryOpenPendingDeepLink() also fired detail opens fire-and-forget, so cold start had duplicate opens and race conditions.
- **Fix**:
  - js/modules/event-detail.js: added event detail request sequencing, page-shell DOM checks, and async showEventDetail() that waits for showPage('page-activity-detail') before rendering.
  - js/modules/team-detail.js: added team detail request sequencing, page-shell DOM checks, async showTeamDetail(), and updated member-edit refresh paths to await detail rerender before reopening the members section.
  - `app.js`: added in-flight deep link open guard so one pending deep link only opens once at a time, and _tryOpenPendingDeepLink() now awaits detail open completion before deciding success/fallback.
  - js/config.js, index.html: bumped cache version to 20260306i.
- **Lesson**: In this no-build Object.assign(App, ...) architecture, detail pages must follow the same load shell -> ensure script -> render detail contract as route pages, or cold-start deep links will fail intermittently.
### 2026-03-06 - homepage slimming V2 Step 4 remove non-home eager route modules
- **Issue**: `index.html` still eagerly loaded many page-owned modules that are not required for homepage boot, so Step 2/3's loaders were not yet reducing homepage parse cost.
- **Cause**: Several route modules were still left in the eager block, and direct homepage/profile entry points (`App.showEventDetail()` / `App.showTeamDetail()`) would have broken if those modules were simply removed without a gateway fallback.
- **Fix**:
  - `js/core/navigation.js`: added lazy route gateways for `showEventDetail()` and `showTeamDetail()` so direct card clicks can first ensure the target page/script/data pipeline, then hand off to the real module implementation after it is loaded.
  - `index.html`: removed eager loading for non-home route modules now covered by `ScriptLoader`, including event detail, team detail/form/list, tournament manage, message admin, dashboard/personal dashboard, admin user/system pages, scan, shot game page, and ad-manage leaf pages.
  - `index.html`: deliberately kept `shop.js`, `event-create.js`, `ad-manage-core.js`, `profile-card.js`, and `leaderboard.js` eager because they still have cross-module bootstrap/runtime dependencies outside pure route entry.
  - `js/config.js`, `index.html`: bumped cache version to `20260306j`.
- **Lesson**: In this architecture, script slimming must be gated by actual call-entry analysis, not page ownership alone. If an eager module directly calls a function defined in another module, that callee cannot be removed from eager load until a gateway or dependency split exists.
### 2026-03-06 - fix Step 4 login regression from applyRole eager admin rerender
- **Issue**: Homepage login could throw `this.renderAdminUsers is not a function` immediately after user data synced.
- **Cause**: `js/modules/role.js` still assumed `renderAdminUsers()` was eagerly loaded and called it inside `applyRole()`. After Step 4, `user-admin-list.js` is lazy-loaded by route, so that eager-time call became invalid.
- **Fix**:
  - `js/modules/role.js`: changed `applyRole()` to rerender admin users only when `renderAdminUsers` is already present.
  - `js/config.js`, `index.html`: bumped cache version to `20260306k`.
- **Lesson**: After moving route modules out of `index.html`, every eager lifecycle hook must be audited for direct method calls into those modules. Route-owned renderers can no longer be treated as globally present at login time.
### 2026-03-06 - fix Step 4 team join regression from shared runtime helpers moved out of eager load
- **Issue**: Applying to join a team could silently fail on production/mobile, with no pending record shown in "我的球隊申請".
- **Cause**: `js/modules/team-form.js` still directly called `_deliverMessageToInbox()` and `_grantAutoExp()`, but those helpers live in `message-admin.js` and `auto-exp.js`. Step 4 moved both modules out of eager load even though they are still shared by user-facing pages, so clicking join could throw before any message record was created.
- **Fix**:
  - Restored `js/modules/message-admin.js` and `js/modules/auto-exp.js` to the eager script block in `index.html`.
  - `js/config.js`, `index.html`: bumped cache version to `20260306l`.
- **Lesson**: Before slimming eager scripts, distinguish true route-only modules from modules that currently hide shared runtime utilities. Shared helpers must either stay eager or be extracted into a dedicated bootstrap/runtime module first.
### 2026-03-06 - implement Step 5A deferred cloud boot for homepage slimming
- **Issue**: Production home boot still downloaded Firebase/LIFF eagerly because `DOMContentLoaded` always started Phase 4 immediately and `index.html` preloaded the CDN SDKs, so homepage render still competed with cloud initialization.
- **Cause**: Cloud startup logic lived inline inside `app.js` boot flow instead of a reusable gateway, and route/deep-link entry points had no shared way to demand cloud readiness only when needed.
- **Fix**:
  - `app.js`: extracted cloud startup into `App.ensureCloudReady()`, made script loading idempotent, and deferred normal home boot until after first paint while still forcing immediate init for deep links.
  - `js/core/navigation.js`: added cloud gating before protected route checks and page entry readiness so first route/detail entry can safely trigger initialization on demand.
  - `js/core/mode.js`: switched production mode boot to use the same `ensureCloudReady()` path.
  - `index.html`: removed Firebase/LIFF preload tags and bumped cache version to `20260306m`.
- **Lesson**: For this no-build script architecture, homepage slimming is only safe when cloud init has exactly one gateway. Deep link, guarded route, and mode-switch flows must all share the same once-only initialization path.

### 2026-03-06 - implement Step 5B staged home render for homepage slimming
- **Issue**: Homepage boot still executed banner autoplay, popup-ad startup, sponsors/floating ads/tournament rendering, and other non-critical home work inside the first render pass, so Step 5A alone could not materially lighten first paint.
- **Cause**: `App.renderAll()` still behaved like a monolithic homepage renderer, `renderBannerCarousel()` always started autoplay immediately, and popup ads were still modeled as a boot-time effect instead of a deferred home-only effect.
- **Fix**:
  - `app.js`: split homepage rendering into `renderGlobalShell()`, `renderHomeCritical()`, and `renderHomeDeferred()`, added deferred scheduling/cancelation helpers, and removed the old global popup timeout from boot.
  - `js/core/navigation.js`: when leaving home, now cancels pending deferred work and stops banner autoplay; returning to home reruns the staged `renderAll()` path instead of a direct home content render.
  - `js/modules/banner.js`: separated control binding from autoplay startup, added `stopBannerCarousel()`, and let `renderBannerCarousel({ autoplay: false })` render the first frame without starting the timer.
  - `js/modules/popup-ad.js`: added a per-session active-key guard so moving popup startup into deferred home render does not re-open the same popup stack every time the user revisits home.
  - `js/config.js`, `index.html`: bumped cache version to `20260306n`.
- **Lesson**: In this architecture, homepage slimming requires splitting "render DOM" from "start behavior". Anything that creates timers, overlays, or secondary sections must have an explicit deferred entry point and a cleanup path when the user leaves home.

### 2026-03-06 - add route loading overlay for cold page transitions and cloud pending
- **Issue**: After homepage slimming Step 5A/5B, first navigation from a cold `?clear=1` boot could spend noticeable time waiting for cloud/page/script/data readiness, but the UI often looked unresponsive during that delay.
- **Cause**: `showPage()` had no explicit loading feedback while awaiting `ensureCloudReady()` and `_ensurePageEntryReady()`. The project only had a heavy boot overlay and a deep-link overlay, so normal first route transitions had no clear waiting state.
- **Fix**:
  - `app.js`: added route-loading copy mapping plus delayed show / slow-network escalation / minimum-visible-time helpers for a shared route-loading overlay.
  - `js/core/navigation.js`: wrapped normal page transitions with `_beginRouteLoading()` / `_endRouteLoading()` and switched to an immediate cloud/login copy when the target page still requires cloud initialization.
  - `index.html`: added a lightweight route-loading overlay that reuses the existing deep-link loading card visual language.
  - `js/config.js`, `index.html`: bumped cache version to `20260306o`.
- **Lesson**: Once homepage boot is intentionally decoupled from cloud/page readiness, route-level waiting feedback becomes mandatory. Users should see a lightweight loading state whenever the app is waiting on initialization, not just during full boot or deep-link entry.

### 2026-03-06 - refine route loading into non-blocking status hint and reduce auth wording noise
- **Issue**: The first route-loading implementation was too visually heavy because it still used a centered overlay card, and the `正在確認 LINE 登入` copy appeared too often even when LIFF was already effectively ready.
- **Cause**: The loading feedback reused an overlay pattern that blocked the screen, while the phase selection treated most cloud-init waits as auth waits instead of distinguishing real auth-pending from generic data sync.
- **Fix**:
  - `index.html`, `css/base.css`: replaced the route-loading overlay with a small non-blocking status hint positioned below the toast.
  - `app.js`: changed route-loading copy to concise single-line hint text and updated the loading helpers to drive the new `#status-hint` element instead of a full-screen overlay.
  - `js/core/navigation.js`: split loading phases into `auth / cloud / page`, and only uses LINE wording when `LineAuth.isPendingLogin()` or LIFF session restoration is actually still pending.
  - `js/config.js`, `index.html`: bumped cache version to `20260306p`.
- **Lesson**: Route feedback should match the weight of the wait. For short transitional waits, a small anchored status hint is easier to tolerate than a blocking overlay, and auth wording must be reserved for true auth-pending states or it quickly becomes noise.

### 2026-03-06 - align status hint height with existing toast position
- **Issue**: After switching route feedback to the non-blocking `status-hint`, its vertical position still sat lower than the existing toast used by messages like `功能準備中`.
- **Cause**: `status-hint` used a different `bottom` offset than `.toast`, so the two patterns looked visually inconsistent.
- **Fix**:
  - `css/base.css`: changed `.status-hint` bottom offset to match `.toast` at `calc(var(--bottombar-h) + 16px)`.
  - `js/config.js`, `index.html`: bumped cache version to `20260306q`.
- **Lesson**: When introducing a new feedback component intended to match an existing interaction pattern, align anchor position as well as shape and motion; otherwise the UI still feels inconsistent.

### 2026-03-06 - Step 6 validation fixed cold-first-visit gaps for shop/tournament detail
- **Issue**: Step 6 structural validation found that `page-shop-detail` and `page-tournament-detail` were top-level pages but not fully covered by the lazy page/data contract, so cold first visits depended on their parent fragment already being loaded.
- **Cause**: `PageLoader` had no fragment mapping for those detail pages, `FirebaseService.ensureCollectionsForPage()` had no detail-page collection map, and both `showShopDetail()` / `showTournamentDetail()` wrote DOM before ensuring the target page fragment existed.
- **Fix**:
  - `js/core/page-loader.js`: mapped `page-shop-detail` to `shop` and `page-tournament-detail` to `tournament`.
  - `js/firebase-service.js`: added `page-shop-detail` and `page-tournament-detail` collection mappings.
  - `js/modules/shop.js`: `showShopDetail()` now awaits `showPage('page-shop-detail')` before writing detail DOM.
  - `js/modules/tournament-render.js`: `showTournamentDetail()` now awaits `showPage('page-tournament-detail')` before writing detail DOM.
  - `docs/home-performance-step6-validation.md`: added the final Step 6 validation report.
  - `js/config.js`, `index.html`: bumped cache version to `20260306r`.
- **Lesson**: Any page that can be entered directly from homepage cards must satisfy the full `page -> data -> DOM write` contract. Parent-fragment assumptions are not acceptable once route loading is intentionally made lazy.

### 2026-03-06 - finalize V2 document set and remove temporary baseline doc
- **Issue**: After V2 delivery, the document set still contained a Step 1 temporary baseline file that had served its purpose during construction but was no longer the best long-term reference.
- **Cause**: The Step 1 baseline was useful during implementation sequencing, but its role was superseded by the final V2 spec and Step 6 validation report once rollout completed.
- **Fix**:
  - Added `docs/home-performance-v2-final-summary.md` as the final outcome summary for the full V2 effort.
  - Removed `docs/home-performance-slimming-step1-baseline.md` as a temporary construction artifact.
- **Lesson**: Once a multi-step upgrade is complete, keep the long-term document set small: final spec, final validation, and final summary are enough; transient execution scaffolding should be removed.

### 2026-03-06 - move PK game power bar above the ball on mobile
- **Issue**: In the PK mini-game, charging on mobile could hide the power bar behind the user's finger because the bar was anchored below the ball.
- **Cause**: `#sg-power` used a fixed bottom offset in CSS, so the bar stayed near the bottom HUD instead of following the ball's on-screen position.
- **Fix**:
  - `js/modules/shot-game-engine.js`: projected the ball's top/bottom world coordinates into screen space, preserved the current visual gap, and moved the power bar to the ball's upper side while charging.
  - `js/config.js`, `index.html`: bumped cache version to `20260306s`.
- **Lesson**: HUD that is part of a direct touch gesture should anchor to the interacted object, not to a fixed screen edge, or mobile touch occlusion will eventually appear.

### 2026-03-06 - remove drawer shot-game entry without hiding home game card
- **Issue**: The user wanted the drawer menu to stop showing the `射門遊戲` entry, but homepage game visibility still depended on the drawer config containing `page-game`.
- **Cause**: `event-list.js` used `DRAWER_MENUS.find(...page-game...)` as a proxy for whether the homepage shortcut should exist, so deleting the drawer item would also suppress the homepage card.
- **Fix**:
  - `js/config.js`: removed the `射門遊戲` item from `DRAWER_MENUS`.
  - `js/modules/event-list.js`: changed homepage game availability to read `HOME_GAME_PRESETS` plus `ApiService.isHomeGameVisible('shot-game')` instead of relying on drawer menu presence.
  - `js/config.js`, `index.html`: bumped cache version to `20260306t`.
- **Lesson**: Navigation configuration and feature availability must not share the same source of truth unless they are intentionally coupled; otherwise deleting one entry causes unrelated UI regressions.

### 2026-03-06 - add activity data scaling assessment document
- **Issue**: The project needed a written decision aid for when growing historical activities should trigger pagination, split-flow, or archival work.
- **Cause**: Current event loading keeps homepage startup lean, but historical activity growth still accumulates into the front-end cache and can eventually pressure activity-focused pages first.
- **Fix**:
  - Added docs/activity-data-scaling-assessment.md with architecture analysis, scaling thresholds, likely bottlenecks, and recommended trigger points for historical-activity strategy changes.
  - No JS/HTML/runtime files were changed.
- **Lesson**: For data-growth decisions, document the actual trigger thresholds before the system becomes slow; otherwise teams wait until performance pain appears and lose the chance to make a controlled change.
### 2026-03-06 - prevent duplicate event creation submits
- **Issue**: Repeated taps on the create-event submit button could create multiple near-identical Firestore event documents.
- **Cause**: App.handleCreateEvent() had no in-flight guard, and ApiService.createEvent() returned before the Firestore write completed, so the UI could be submitted again while the first write was still pending.
- **Fix**:
  - js/modules/event-create.js: added an in-flight submit guard plus submit-button disabled/loading state for create mode.
  - js/modules/event-manage.js: reset the shared create/edit modal submit state when opening edit mode.
  - js/api-service.js: changed createEvent() to await the Firestore write and roll back the optimistic cache item if the write fails.
  - js/config.js, index.html: bumped cache version to 20260306u.
- **Lesson**: For create flows, button locking is not enough unless the lock lasts through the real persistence boundary; otherwise slow writes still allow duplicate submissions.

### 2026-03-06 - make event deletion wait for Firestore success
- **Issue**: Deleting an activity from activity management could appear to succeed locally but the cancelled event would come back after refresh.
- **Cause**: deleteMyActivity() did not await the Firestore delete, and ApiService.deleteEvent() removed only the local cache immediately while the real backend delete ran in the background.
- **Fix**:
  - js/api-service.js: added an awaited delete path so event deletion only updates local cache after Firestore confirms deletion.
  - js/modules/event-manage.js: changed activity deletion to await backend success and show a failure toast if the Firestore delete does not complete.
  - js/config.js, index.html: bumped cache version to 20260306v.
- **Lesson**: Destructive actions must not optimistic-update the UI unless rollback is implemented; otherwise refresh will resurrect data that was never actually deleted.

### 2026-03-06 — 手動簽到勾選簽退自動完成簽到
- **問題**：活動詳情頁的手動簽到表格中，若只勾選「簽退」，UI 不會同步勾選「簽到」，儲存時也可能被擋下。
- **原因**：報名名單與未報名單的手動簽到表格沒有建立 checkbox 連動，送出前也沒有把 `checkout => checkin` 這個規則正規化。
- **修復**：修改 `js/modules/event-manage.js`，新增手動簽到 checkbox 連動 helper；勾選簽退時自動補勾簽到，取消簽到時若仍勾著簽退會一併取消；送出報名名單與未報名名單前都會先正規化狀態，確保勾簽退時會寫入完整的簽到與簽退紀錄。
- **教訓**：這類有前後依賴的布林欄位不能只靠送出時驗證，UI 互動與資料寫入規則都要同步維持同一套狀態約束。

---

### 2026-02-27 — 修復錯誤日誌寫入/讀取失敗（zw）

- **問題**：錯誤日誌頁面始終無資料，用戶觸發的錯誤未被記錄
- **原因**：
  1. `_writeErrorLog` 的 `.catch(() => {})` 靜默吞掉所有 Firestore 寫入失敗，無法看到是否成功
  2. `errorLogs` 讀取規則使用 `isSuperAdmin()` → `authRole()` → `roleFromUserDoc()` 路徑，而 `roleFromUserDoc` 的 null ternary 有編譯警告 `[W] 29:56 - Invalid type. Received one of [null]`，可能導致 super_admin 也無法讀取
  3. 寫入規則使用 `isRestrictedAccount()` 額外 get() 呼叫，增加不必要的複雜性
- **修復**：
  1. `.catch(() => {})` → `.then(() => console.log(...)).catch(e => console.warn(...))`：寫入成敗均有 console 輸出
  2. Firestore rules 改用 `request.auth.token.role == 'super_admin'` 直接檢查 custom claims，繞過 `roleFromUserDoc()` null 問題
  3. 寫入規則簡化為 `isAuth()`（移除 `isRestrictedAccount()` 依賴）
- **教訓**：Firestore rules 中 `get()` 返回 null 的 ternary 可能導致規則評估失敗；對非關鍵寫入，也不應完全吞掉錯誤
- **版本**: `20260227zw`
- **Files**: `api-service.js`, `firestore.rules`, `config.js`, `index.html`

---

### 2026-02-27 — 前端錯誤日誌系統（zs）

- **功能**：當 catch 區塊捕獲系統異常時，自動寫入 Firestore `errorLogs` 集合，總管可在後台查閱
- **架構**：
  - `ApiService._writeErrorLog(context, err)` — 防禦性設計，session-level dedup（err.code），整體 try/catch 不拋錯
  - `FirebaseService.addErrorLog/deleteErrorLog` — CRUD
  - `errorLogs` 集合：read/delete=`isSuperAdmin()`，create=`isAuth() && !isRestrictedAccount()`
  - `js/modules/error-log.js` — 渲染/過濾/分頁/清除（複製操作日誌模式）
  - `pages/admin-system.html` — `page-admin-error-logs` section（`data-min-role="super_admin"`）
  - `app.js` — `_errorLogReady` flag + `unhandledrejection` handler（過濾 LIFF/Firebase/Firestore 雜訊）
- **catch 區塊**：10 處加入 `_writeErrorLog`（message-inbox, team-form, event-detail-signup, event-manage, shop）
- **版本**: `20260227zs`
- **Files**: `api-service.js`, `firebase-crud.js`, `firebase-service.js`, `data.js`, `firestore.rules`, `error-log.js`(new), `admin-system.html`, `navigation.js`, `config.js`, `index.html`, `admin.css`, `message-inbox.js`, `team-form.js`, `event-detail-signup.js`, `event-manage.js`, `shop.js`, `app.js`

---

### 2026-02-27 — 補齊操作日誌（zr）

- **功能**：補上 6 類先前未記錄的操作項目，確保操作日誌完整
- **新增記錄**：
  1. `handleJoinTeam`（team-form.js）— 申請入隊：`申請入隊` / `${applicantName} 申請加入「${t.name}」`
  2. `handleLeaveTeam`（team-form.js）— 退出球隊：`退出球隊` / `${userName} 退出「${t.name}」`
  3. `handleTeamJoinAction` ignore 分支（message-inbox.js）— 忽略審批：`球隊審批` / `${reviewerName} 忽略...`
  4. `handleSaveShopItem`（shop.js）— 商品編輯/上架：`商品編輯` / `商品上架`
  5. `delistShopItem` / `relistShopItem` / `removeShopItem`（shop.js）— 下架/重新上架/刪除
  6. `handleCancelSignup`（event-detail-signup.js，Demo 與 Prod 兩個路徑）— 取消報名/候補
  7. `_confirmAllAttendance`（event-manage.js）— 手動簽到批次更新
- **版本**: `20260227zr`
- **Files**: `team-form.js`, `message-inbox.js`, `shop.js`, `event-detail-signup.js`, `event-manage.js`

---

### 2026-02-27 — 審批入隊 ensureAuth + isTeamStaff leaderUids + linePushQueue

- **問題**：球隊隊長/領隊按「同意」入隊申請時持續出現「寫入失敗」
- **原因**（複數）：
  1. `updateUser` 在跨用戶寫入前未呼叫 `_ensureAuth()`，若 Firebase Auth token 過期則 permission-denied
  2. `isTeamStaff` 只檢查舊版 `leaderUid` 欄位，未包含新版 `leaderUids[]` 陣列，導致新版領隊被擋在外
  3. `Object.assign(applicant, ...)` 在寫入前就修改 in-memory 快取，若寫入失敗快取狀態會損壞
  4. `linePushQueue` Firestore 規則為 `allow create: if false`，推播佇列寫入一律靜默失敗
- **修復**：
  - `handleTeamJoinAction`：寫入前加 `await FirebaseService._ensureAuth()`；`Object.assign` 移至成功後；isTeamStaff 加 `teamLeaderUids.includes(curUid)`；錯誤 toast 顯示實際 error code
  - `firestore.rules`：`linePushQueue` allow create 改為 `if isAuth()`
- **版本**: `20260227zo`
- **Files**: `js/modules/message-inbox.js`, `firestore.rules`

---

### 2026-02-27 — 球隊領隊複數化 + 角色升降 + 經理轉移限制

- **功能**：
  1. 領隊改為複數（`leaderUids[]` + `leaders[]`），表單支援多選 Tags UI
  2. 指派領隊自動升至 coach 等級；移除領隊後自動降級（`_recalcUserRole` + `_applyRoleChange`）
  3. 建立球隊時創立者自動成為球隊經理（鎖定，不可更改）
  4. 編輯球隊時只有當前球隊經理或 admin 可以轉移經理職位，其他人看到鎖定提示
  5. 欄位順序對調：球隊經理在上、球隊領隊在下
- **相容**：舊資料 `leader`/`leaderUid` 單一欄位仍可讀取；新存同時寫 `leaders`/`leaderUids` + 舊欄位
- **Files**: `js/modules/team-form.js`, `js/modules/team-detail.js`, `js/api-service.js`, `pages/team.html`
- **版本**: `20260227zm`

---

### 2026-02-27 — 球隊入隊審批 Firestore 規則再修（領隊角色）

- **問題**：領隊（team.leader）同意入隊後仍顯示「寫入失敗」
- **原因**：原規則用 `isCoachPlus()` 檢查角色，但領隊的 Firebase role 是 `'user'`，不在 coach+ 清單 → permission-denied。Coach/captain 若 token 未更新也可能同樣失敗
- **修復**：`firestore.rules` users.update 條件改為 `isAuthNotRestricted()`（任何登入非受限用戶），`hasOnly(['teamId','teamName','updatedAt'])` 欄位限制確保安全性不降低
- **已部署**：`firebase deploy --only firestore:rules`

### 2026-02-27 — 球隊加入審批同意後申請人未入隊修復

- **問題**：隊長/教練按「同意」後申請人沒有成功加入球隊
- **原因**：`message-inbox.js` `handleTeamJoinAction` approve 時呼叫 `FirebaseService.updateUser(applicant._docId, { teamId, teamName })`，但 Firestore rules `users.update` 只允許 `isOwner || isAdmin`，隊長/教練不是 admin → permission-denied，錯誤僅 `console.error` 不顯示 toast，UI 假裝成功
- **修復**：
  1. `firestore.rules`：`users.update` 新增條件：`isCoachPlus() && !isRestrictedAccount()` 且 `affectedKeys().hasOnly(['teamId','teamName','updatedAt'])`（限制只能改這三個欄位）
  2. `message-inbox.js`：approve 區塊改為 `await updateUser()`，失敗時立即 toast 並 return，找不到申請人也提示
- **版本**：`20260227zd` → `20260227ze`
- **教訓**：非 owner 的跨用戶寫入必須在 Firestore 規則層開放，`.catch(console.error)` 會吞掉錯誤使 UI 假裝成功

### 2026-02-27 — 球隊人數統計未含一般隊員修復

- **問題**：球隊詳情頁「人數」數字偏低，和實際成員列表不符
- **原因**：`team-form.js` 儲存時 `members` 只算 `(captain ? 1 : 0) + coaches.length`，完全漏計所有 `user.teamId === team.id` 的一般隊員
- **修復**：`team-form.js` line 532 改為額外計算 `regularMembersCount`（在已有的 `users` 中過濾 `teamId` 符合且不在 captainCoachNames 中的用戶），加入總計
- **版本**：`20260227zc` → `20260227zd`

### 2026-02-27 — 入隊申請系統升級（廣播、冷卻、衝突保護）

- **問題**：入隊申請只通知隊長、無多職員衝突處理、無冷卻機制、拒絕後可立即重送
- **修復**：
  - `team-form.js` `handleJoinTeam()`：收集 captainUid + leaderUid + coaches 所有 UID，一次廣播給全員，並生成 `groupId` 串聯同一申請的所有訊息
  - 加入 24h 冷卻：被拒絕後訊息帶 `rejectedAt` (top-level)，再次申請時計算剩餘小時數提示
  - `message-inbox.js` `handleTeamJoinAction()`：加入職員身份驗證（captain/leader/coach/admin）、first-action-wins（先查 groupId 是否已有非 pending 訊息）、groupId 群組同步（同組全部更新 + 通知其他職員）
  - 狀態顯示加上審核者姓名 `reviewerName` (top-level)
- **教訓**：新欄位需存 top-level（非 meta 內），因 `_update()` 用 `Object.assign` 無法處理 dot notation nested 更新；groupId 串聯是 tournament 現成模式，可直接重用

### 2026-02-27 — 首頁活動卡左上角自動加上日期標籤

- **需求**：首頁近期活動卡左上角自動顯示月/日，黃底粗體標籤樣式
- **修復**：`js/modules/event-list.js` 的 `visible.map()` 改為 block body，解析 `e.date`（格式 `YYYY/MM/DD HH:MM~HH:MM`）取月/日，在 `.h-card-img` 左上角插入 `<span>` 標籤，並為 `.h-card-img` 加上 `position:relative`
- **版本**：`20260227x`

### 2026-02-27 — 成就評估引擎缺失導致成就永不觸發

- **問題**：在成就/徽章後台設定條件（如「參與教學活動 1 場」），即使已完成對應活動，成就 `current` 永遠維持 0 不觸發
- **原因**：`achievement.current` 是 Firestore 靜態欄位，條件選單（action/filter/threshold）僅用於 UI 描述生成（`_generateConditionDesc`），從未有任何程式碼讀取 `activityRecords` 來計算並更新 `current`——評估引擎根本不存在
- **修復**：在 `js/modules/achievement.js` 新增 `_evaluateAchievements()` 方法，遍歷所有 active achievement，根據 `condition.action` 計算：
  - `attend_play/friendly/camp/watch`：計算 activityRecords 中 status='registered' 且對應事件 type 符合的筆數
  - `register_event`：計算指定類型的報名紀錄數
  - `complete_event`：計算對應活動已 ended 的報名紀錄數
  - 若 `current` 變動則呼叫 `ApiService.updateAchievement()`，達到 threshold 自動設 `completedAt`
  - 從 `renderAchievements()`、`renderAdminAchievements()`、`handleSignup` 成功後、`handleCancelSignup` 成功後呼叫
- **教訓**：條件配置 UI 與評估引擎必須同步實作；`activityRecords` 不儲存事件類型，須 JOIN `events` 集合取得 `type` 欄位

### 2026-02-27 — 候補名單正取功能（繞過人數上限）

- **功能**：候補名單 header 右側新增「編輯」按鈕（canManage 權限），進入編輯模式後每列顯示紫色「正取」按鈕，按下即強制將該用戶（含同行者）從候補移入報名名單，即使超過活動人數上限（顯示為 12/11）
- **實作**：
  - `event-manage.js`：`_buildWaitlistTable` 改為 `_renderWaitlistSection(eventId, containerId)`（re-renderable），支援 `_waitlistEditingEventId` 狀態；新增 `_startWaitlistEdit`、`_stopWaitlistEdit`、`async _forcePromoteWaitlist`
  - `event-detail.js`：`_buildGroupedWaitlist` + `_expandWaitlistGrid` 改為 `_renderGroupedWaitlistSection(eventId, containerId)`（網格正常模式 + 表格編輯模式），另有 `_startWaitlistDetailEdit`、`_stopWaitlistDetailEdit`
  - `showMyActivityDetail`：`${waitlistHtml}` → `<div id="waitlist-table-container"></div>` + `_renderWaitlistSection` call
  - detail page：`${_buildGroupedWaitlist(e)}` → `<div id="detail-waitlist-container"></div>` + `_renderGroupedWaitlistSection` call
- **`_forcePromoteWaitlist`**：調用現有 `_promoteSingleCandidate(e, reg)`（每次 `event.current++`，無容量檢查），對 userId 的所有候補報名一次性處理，再更新 Firebase，最後 re-render 所有相關容器
- **超量顯示**：現有 `_renderAttendanceTable` 中 `nameThContent` 用 `${people.length}/${e.max}` 呈現，超量自動顯示如 12/11

---

### 2026-02-27 — 手動簽到閃爍 + 重複標題修復

- **問題 1**：按「完成簽到」後，最後一個勾選位置短暫消失再出現（閃爍）
- **問題 2**：報名名單標題重複出現（獨立 div 一個 + 表頭 th 一個）
- **原因 1**：`_confirmAllAttendance` 有多個 `await` 呼叫，期間 Firestore onSnapshot 可能觸發 `_renderAttendanceTable(eventId, 'detail-attendance-table')`，該呼叫會覆寫 `this._manualEditingContainerId`，導致最後 render 到錯誤的 container（detail page 而非 modal），同時 pending onSnapshot 尚未 settle 導致 cache 狀態不穩定
- **原因 2**：`showMyActivityDetail` 有獨立的 `<div>報名名單（x/y）</div>`，而 `_renderAttendanceTable` 的 `<th>` 也顯示「報名名單」
- **修復**：
  - `_confirmAllAttendance`：在 loop 前擷取 `containerId = this._manualEditingContainerId`，最後用 captured value render（不再用 `this._manualEditingContainerId`）
  - `_confirmAllAttendance`：最後 render 前加 `await new Promise(r => setTimeout(r, 0))` 讓所有 pending onSnapshot/microtask 先 settle
  - `showMyActivityDetail`：移除獨立的「報名名單（x/y）」div
  - `_renderAttendanceTable`：`nameThContent` 改為 `報名名單（${people.length}/${e.max}）` 含動態人數
- **教訓**：async 函式中若有多個 await，任何 this.xxxId 的 mutable state 都可能被 side effects 覆寫，需在函式開頭 capture snapshot

---

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

### 2026-02-26 — 首次登入地區擴充臺灣 22 縣市並加入搜尋功能
- **問題**：首次登入的地區選項過少，只保留少數區域與 `其他`，不利於臺灣使用者快速選擇，選項一多後也不易搜尋。
- **原因**：`pages/profile.html` 的 `#fl-region` 只有少量手寫選項，沒有提供搜尋輔助。
- **修復**：在首次登入 modal 新增 `#fl-region-search` 搜尋框；選項擴充為臺灣 22 縣市 + `其他`；`profile-data.js` 新增 `includes` 搜尋過濾與 `臺/台` 正規化，並在開啟 modal 時重設搜尋狀態；同步更新 `CACHE_VERSION` 與 `index.html` 版本參數。
- **教訓**：固定選單一旦擴大到完整地區清單，就應同時補搜尋與在地化正規化，不要把找選項的成本留給使用者。

### 2026-02-26 — users 後台新增限制帳號（停權 / 限制）MVP
- **問題**：需要在用戶後台將 `user` 帳號設為停權 / 限制，避免異常或被檢舉帳號持續登入與操作，並在前台明確提示帳號受限制。
- **原因**：既有系統只有角色管理與登入檢查，缺少帳號狀態欄位、後台入口與前台守門機制。
- **修復**：`user-admin-list.js` 新增 `停權 / 限制` 按鈕與 `toggleUserRestriction()`；`navigation.js` 新增受限制帳號守門，涵蓋 `showPage()`、底部 tab 與 `goBack`；`profile-core.js` 在 currentUser 異動時強制跳回首頁並顯示提示；`api-service.js` 新增限制欄位讀寫；`firestore.rules` 新增 `isRestrictedAccount()` 並保護 `users.isRestricted*` 欄位僅 `super_admin` 可改。
- **教訓**：帳號限制功能不能只做後台按鈕，還要同步補前台守門與 rules 欄位保護，才不會變成只有 UI 標示的假限制。

### 2026-02-26 — 移除球隊頁的「功能準備中」誤封鎖
- **問題**：球隊頁被誤套用「功能準備中」封鎖，導致使用者無法正常進入已上線的球隊頁面。
- **原因**：`bindNavigation()` 將 `page-teams` 與 `page-tournaments` 一起套進同一個未開放頁面判斷。
- **修復**：僅保留 `page-tournaments` 的 `功能準備中` 封鎖，移除 `page-teams` 的錯誤阻擋；同步更新 `CACHE_VERSION` 與 `index.html` 版本參數。
- **教訓**：導航層的功能封鎖必須逐頁驗證，不要用共用條件一次攔多個頁面，否則很容易誤傷已上線功能。
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

### 2026-02-26 - Strengthen attendance write auth retry
- **Problem**: Production attendance writes in manual edit and QR scan could fail with auth/permission errors and no self-recovery path.
- **Cause**: The write path only checked whether `auth.currentUser` existed, without token freshness validation or forced re-auth retry on permission-denied/unauthenticated errors.
- **Fix**: Updated `js/api-service.js` to validate token freshness before attendance writes, add one forced re-auth + retry path for permission/auth errors, add lightweight auth-state diagnostics logging, and validate required payload fields (`eventId`/`uid`) before write.
- **Lesson**: For critical production writes, auth existence checks are not enough; validate usable tokens and provide a controlled retry strategy for transient auth drift.

### 2026-02-26 — 修復簽到簽退權限與錯誤訊息中文化
- **問題**：活動頁面用編輯按鈕或掃碼方式簽到簽退時顯示「更新失敗：Firebase 登入已失效或權限不足，請重新登入 LINE 後再試」。
- **原因**：(1) Firestore rules 中 `attendanceRecords` 的 `allow update` 設為 `isAdmin()`，教練(coach+)在取消勾選簽到/簽退時觸發的 soft delete（update 操作）被規則拒絕；(2) `_mapAttendanceWriteError()` 返回英文錯誤訊息，中文 app 顯示不當；(3) event-manage.js 的 catch 區塊有額外的正規表達式覆蓋邏輯，導致錯誤訊息不一致。
- **修復**：(1) `firestore.rules` 中 attendanceRecords update 規則從 `isAdmin()` 改為 `isCoachPlus()`；(2) `js/api-service.js` 中 `_mapAttendanceWriteError` 所有錯誤訊息改為中文；(3) 簡化 `js/modules/event-manage.js` 的 catch 區塊，直接使用 `_mapAttendanceWriteError` 返回的中文訊息；(4) 更新快取版本至 `20260226zf`。
- **教訓**：Firestore rules 必須與 UI 層允許的操作角色對齊；面向用戶的錯誤訊息需與 app 語言一致，避免在 error mapper 和 catch 區塊中做雙重轉譯。

### 2026-02-26 — 簽到簽退 update 規則放寬，確保活動主辦/委託人皆可操作
- **問題**：attendanceRecords 的 update 規則為 `isCoachPlus()`，但活動委託人可能不是 coach+ 角色（如一般用戶被指派為委託人），導致無法取消勾選（soft delete = update）。
- **原因**：Firestore 規則無法用 `eventId`（邏輯 ID）反查 events 文件的 `creatorUid`/`delegates`（因 events 使用自動產生的 document ID），無法在規則層做活動歸屬檢查。
- **修復**：將 attendanceRecords update 規則從 `isCoachPlus()` 放寬為 `isAuth() && !isRestrictedAccount()`；安全性由前端存取控制（`_canManageEvent`：admin / owner / delegate）+ 審計軌跡（`removedByUid`）+ `delete: false` 共同保障。
- **教訓**：當 Firestore 規則無法做跨集合歸屬驗證時，採用「寬鬆規則 + 前端存取控制 + 審計軌跡」的分層安全策略。

### 2026-02-26 — 修復 Firebase Auth 狀態恢復競態導致簽到寫入失敗
- **問題**：Firestore rules 和用戶資料都正確，但簽到寫入仍顯示「更新失敗：Firebase 登入已失效或權限不足」。
- **原因**：Firebase Auth 從 persistence（indexedDB/localStorage）恢復登入狀態是非同步的，但 `_hasFreshFirebaseUser()` 直接同步檢查 `auth.currentUser`，在恢復完成前會得到 null；`_signInWithAppropriateMethod()` 也沒有先等 persistence 恢復，即使先前已成功登入也會嘗試重新走 LINE Token → Cloud Function 流程。
- **修復**：(1) `js/firebase-config.js` 新增 `onAuthStateChanged` 監聽器與 `_firebaseAuthReadyPromise`，首次觸發即代表 persistence 恢復完成；(2) `js/api-service.js` 的 `_hasFreshFirebaseUser()` 先等待 `_firebaseAuthReadyPromise`（最多 5 秒）再檢查 `auth.currentUser`；(3) `js/firebase-service.js` 的 `_signInWithAppropriateMethod()` 先等 persistence 恢復，若已有有效 currentUser 則直接返回，避免不必要的 Cloud Function 呼叫；(4) 強化錯誤訊息：區分「Firebase 未登入」與「權限不足」兩種情境。
- **教訓**：Firebase Auth 的 `auth.currentUser` 在頁面載入後是非同步填入的，必須透過 `onAuthStateChanged` 或 `authStateReady()` 等待首次回呼後才可信賴；直接同步讀取會造成競態條件。

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

### 2026-03-11 — 賽事重構 Step 4：友誼賽詳情頁接管球隊申請與主辦審核
- **問題**：賽事詳細頁仍沿用舊的 `registeredTeams + message` 報名流程，無法呈現友誼賽要求的球隊申請、主辦審核與候審灰色佔位，且詳細頁缺少「聯繫主辦人 / 分享賽事」固定按鈕。
- **原因**：前一階段只完成資料骨架與建立/編輯表單，公開詳情頁仍由 `js/modules/tournament-render.js` 的 legacy 分支控制，沒有讀取 `teamApplications` 與 `teamEntries` 子資料。
- **修復**：新增 `js/modules/tournament/tournament-friendly-detail.js`，以後載入的模組方式接管友誼賽詳細頁；詳情頁現在會讀取 `球隊申請（teamApplications）` 與 `參賽隊伍（teamEntries）` 狀態，提供球隊層級的參加賽事申請、主辦確認/拒絕、灰色候審列、聯繫主辦人、分享賽事，並把相應樣式補進 `css/tournament.css`；同時更新 `docs/architecture.md`、`js/config.js` 與 `index.html` 到 `20260311k`。
- **教訓**：當舊 renderer 與新流程共存時，先用獨立模組接管單一模式頁面，比直接在 legacy 大檔上疊更多 if/else 安全，也更符合後續模組化拆分方向。
