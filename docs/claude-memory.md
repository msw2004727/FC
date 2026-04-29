# ToosterX — Claude 修復日誌（濃縮版）

此檔案隨 git 版本控制，記錄歷次 bug 修復與重要技術決策，供跨設備、跨會話參考。

### 2026-04-29 — 俱樂部卡片運動標籤改淺白 [小型]
- **需求**: 俱樂部卡片左上角運動標籤改為透明淺白色，取代上一版半透明深灰。
- **修復**: `.tc-sport-badge` 改用半透明白底，保留 blur、位置與尺寸；深色模式同樣維持透明白底但略降透明度，並同步 bump cache 版本。
- **驗證**: `git diff --check` 與版本號一致性檢查通過；僅 CSS 視覺與 cache bust 調整。

### 2026-04-29 — 俱樂部卡片運動標籤改深灰 [小型]
- **需求**: 俱樂部卡片左上角的運動標籤原本是金色半透明底，視覺上容易和置頂/等級金色語意混淆，改成透明深灰色。
- **修復**: `css/team.css` 的 `.tc-sport-badge` 改為半透明深灰背景，深色模式使用更深灰階，保留原本位置、尺寸與 pointer-events 行為；同步部署快取版本。
- **驗證**: `git diff --check` 通過；僅 CSS 視覺調整，未改動資料或互動流程。

### 2026-04-29 — 活動置頂鎖定與加值預留開關 [小型]
- **需求**: 暫時關閉活動管理中的置頂操作，點擊只提示「功能未開放」；新增活動表單的加值功能區先預留放鴿子偵測、候補名單、委託人、取消報名限制、GPS功能五個開關位置。
- **修復**: `toggleMyActivityPin()` 改為純 Toast，不再寫入 `pinned/pinOrder` 或重繪列表；管理卡片上的置頂按鈕改成鎖定視覺。加值區新增五個 disabled 預留 switch，沿用既有「預留 — 尚未啟用」文案，不寫入任何活動資料欄位。
- **驗證**: `node --check js/modules/event/event-manage.js` 通過；保留既有 dirty worktree，未把其他未提交修改混入本次判定。

### 2026-04-29 — 管理員賽事代表俱樂部與空主辦建立 [中型]
- **問題**: admin / super_admin 的賽事報名下拉只看 `users.teamIds/teamId`，漏掉自己實際擔任 captain / leader / owner / creator 的俱樂部；建立賽事時管理員若沒有可代表的主辦俱樂部，仍被前端主辦俱樂部必填與後端 callable 擋住。
- **原因**: 前端把管理員的全域管理權與「可代表哪個俱樂部」混在一起：報名端只取 joined clubs，建立端曾取所有 clubs，兩者都沒有一致合併 joined + officer scope；Cloud Function `createFriendlyTournament` 也硬性要求 `hostTeamId`。
- **修復**: 報名代表俱樂部改為 joined + officer union，並在 admin 詳情冷啟動時確保 teams collection 已載入；賽事建立主辦候選改為 joined/officer，不再讓 admin 任意代表所有俱樂部。若 admin 沒有可代表主辦俱樂部，可留空主辦建立賽事，主辦俱樂部是否參賽固定關閉；若 admin 選到非 officer 的 joined club，也由前後端強制 `hostParticipates=false`。新增 `tournament-manage-host-selection.js` 拆出主辦候選與鎖定判斷，避免原模組超過 300 行。
- **驗證**: `node --check` 通過 `tournament-friendly-apply-state.js`、`tournament-manage-host-selection.js`、`tournament-manage-host.js`、`tournament-manage.js`、`tournament-manage-edit.js`、`functions/index.js`；`npm run test:unit -- --runInBand --runTestsByPath tests/unit/tournament-friendly-detail-view.test.js tests/unit/tournament-permissions.test.js tests/unit/tournament-loading-performance.test.js tests/unit/cloud-functions.test.js tests/unit/script-loader.test.js` 通過。

### 2026-04-29 — 賽事表單報名開始提示位置 [小型]
- **問題**: 新增賽事表單的「未設定則立即開放」提示被掛在整個報名日期列後方，視覺上會跑到「報名截止」旁邊；主辦俱樂部參賽提示也保留了多餘的「開啟時會沿用現狀」前綴。
- **修復**: 將提示改為「報名開始」label 右側的 inline note，並移除舊的 row-level 提示；主辦參賽開啟文案精簡為「建立後主辦俱樂部直接參賽並佔用1個名額。」。
- **驗證**: `node --check js/modules/tournament/tournament-manage-host.js`、`git diff --check`、`npm test -- --runInBand --runTestsByPath tests/unit/tournament-loading-performance.test.js tests/unit/tournament-regression.test.js` 通過。

### 2026-04-29 — 賽事主辦是否參賽與裁判欄位 [中型]
- **問題**: 建立友誼賽時主辦俱樂部一律自動成為參賽隊伍並佔用 1 個名額，無法只作為主辦單位顯示；賽事也沒有可記錄多位裁判的欄位。
- **原因**: 建賽 callable 固定建立 `entryStatus: host` 的 entries 文件，並把 `registeredTeams/approvedTeamCount` 預設設為 `[hostTeamId]/1`；前端名額顯示也把 host entry 當成核准隊伍。表單人員 picker 只有委託人狀態。
- **修復**: 新增「主辦俱樂部是否參賽？」滑動開關，新增時預設關閉；後端建立賽事時依 `hostParticipates` 決定 host entry 是否 `countsTowardLimit`，主辦仍會顯示但不一定佔名額。新增 `referees/refereeUids` 欄位，抽出 `tournament-manage-people.js` 共用委託人/裁判最多 10 人複選搜尋。前後端名額計算、審核容量檢查與詳情隊伍頁同步改讀 countable entries。
- **教訓**: 「顯示主辦」與「佔用參賽名額」是兩個不同概念，資料模型要用明確旗標拆開，不能再只靠 `entryStatus: host` 同時承擔兩種語意。

### 2026-04-29 — 俱樂部卡片詳情開啟加載條 [小型]
- **問題**: 公開俱樂部頁點俱樂部卡片時，若詳情頁 HTML/script 或資料還在 lazy load，畫面短時間沒有即時回饋，使用者容易以為點擊無效。
- **原因**: 俱樂部卡片已有 `.tc-loading-bar` 與 `_markTeamCardPending()` 輔助函式，但卡片 `onclick` 仍直接呼叫 `App.showTeamDetail()`，沒有先掛上 pending UI。
- **修復**: 卡片改走 `App.openTeamDetailFromCard(this, this.dataset.teamId)`，先啟動 pending overlay/藍色進度條，再等待 `showTeamDetail()`；無論詳情成功開啟、auth/stale/missing 擋下或例外，都會在 `finally` 清掉 pending 狀態，避免返回列表時卡片殘留 loading。進度條顏色改為 primary blue + light blue，尺寸與活動行事曆 loading bar 對齊。
- **驗收**: 新增 team loading performance 合約測試，覆蓋卡片 click 入口、pending 啟動、失敗清除與藍色 loading 樣式。

### 2026-04-29 — 活動重複報名防護與候補按鈕辨識 [大型]
- **問題**: `2026/05/01 19:00~21:00 週五晚7-9朝馬踢球團` 中，同一位報名者可在短時間內產生兩筆 active `confirmed` registration，原始正取文件數達到 27 但唯一正取人數只有 26，導致活動看似 `26/27` 卻已被判定額滿並把後續使用者送進候補；同時「報名候補」與「取消候補」按鈕同為紫色，容易誤判目前狀態。
- **原因**: 報名文件使用隨機 doc id，沒有交易內的 active 唯一鎖；容量判斷曾以 raw confirmed doc 數計算，但 occupancy/display 會依 `(userId, participantType, companionId)` 去重，造成判斷與顯示不一致。UI 端則共用候補紫色按鈕樣式。
- **修復**: 新增 `events/{eventDoc}/registrationLocks/{lockId}` 作為 active registration 唯一鎖，單人與批次報名都在 transaction 內先讀鎖再寫入；正取容量、rebuild occupancy、取消後候補遞補、管理端移除與名額調整都改用唯一 confirmed count；取消報名同步刪除 lock；Firestore Rules 新增 registrationLocks owner/admin 權限；「取消候補」按鈕改為琥珀橘，保留「報名候補」紫色。
- **資料修復**: 已取消該活動中重複的 active registration，依候補順序遞補最早候補者，活動恢復為 `27/27`、候補 `2`；全資料庫掃描當下沒有其他 active 重複報名群組。
- **驗收**: Cloud Functions 與 Firestore Rules 已部署；`npm test -- --runInBand` 通過 `70 suites / 2541 tests`；`tests/firestore.rules.test.js` 通過 `143 tests`；production source 已 push 至 `a75521eb`。
- **教訓**: 任何「同一使用者同一活動只能 active 一筆」的業務規則，不能只靠查詢或前端狀態判斷，必須有 transaction 內 deterministic lock 或等價唯一鍵；顯示用去重與容量判斷必須共用同一套 identity 規則，否則會再次出現「畫面人數」與「名額判斷」分裂。

### 2026-04-29 — 測試與 CI 保護網校準 [中型]
- **問題**: 本機 `npm run test:unit:coverage` 會掃到 `.claude/worktrees` 內的歷史測試，造成測試數量被放大；`test:rules` 只跑 2 個 Rules 測試檔，另有可用 Rules 測試未納入；`tests/subcollection-rules.test.js` 是 pre-migration proposed-rules 測試且已不穩定；E2E smoke 未進 CI 且有過時 deep-link 期待值。
- **原因**: Jest 預設 root 為 repo 根目錄但只忽略 `node_modules`；Rules 腳本清單未隨新增測試更新；歷史遷移測試仍保留 `.test.js` 後綴；E2E 文件與 workflow 未同步。
- **修復**: `package.json` 新增 `.claude` test ignore、擴充 `test:rules:unit` 清單並修正 watch；將 subcollection pre-migration 測試移至 `tests/archive/subcollection-rules.pre-migration.js`；修正 E2E deep-link 期待值與賽事頁等待條件；CI 新增 E2E smoke job，並同步 `docs/test-coverage.md` 與 `tests/e2e/README.md`。
- **教訓**: 測試綠燈必須先確保「跑的是目前 repo 的測試」且「CI 清單涵蓋有效測試」；歷史遷移驗證若已不代表正式規則，應降級為 archive，避免形成假保護網。

### 2026-04-29 — 賽事俱樂部審核按鈕 loading 與防連點 [中型]
- **問題**: 賽事詳情頁「俱樂部」頁籤審核報名隊伍時，點「確認」後按鈕沒有即時動作提示，使用者可能以為沒有反應而連點。
- **原因**: 審核按鈕沒有把 clicked button 傳入 handler，`reviewFriendlyTournamentApplication()` 只能靠背景 busy flag，無法同步更新 UI；busy key 也把 approve/reject 分開，快速交錯點擊仍可能進入第二個決策入口。
- **修復**: 審核按鈕改傳 `this`，確認顯示「確認中...」、拒絕顯示「拒絕中...」，按鈕同步 disabled 與 spinner；busy key 改為 tournament + application 級別，避免同一申請被重複決策。
- **驗收**: 補 `tournament-friendly-detail-view.test.js` 覆蓋 clicked button 傳入、loading 狀態與同申請連點防護。

### 2026-04-29 — 友誼賽通知「查看賽事」找不到賽事 [中型]
- **問題**: 收到「有新俱樂部申請參賽」通知後，點「查看賽事」會顯示「找不到對應的賽事」。
- **原因**: 友誼賽通知 payload 把 `tournamentId` 放在訊息最外層，但訊息詳情按鈕只讀 `msg.meta.tournamentId`；透過 per-user inbox Cloud Function 持久化時只保留 `meta`，導致既有通知可能沒有可讀的賽事 id。
- **修復**: 新通知改為同時寫入 top-level 與 `meta`；「查看賽事」解析補上 top-level/link id fallback，並可從舊通知文字中的賽事名稱回查本地 tournaments cache。
- **驗收**: 補 `message-system.test.js` 覆蓋 top-level group id、top-level tournament id、link id、文字賽事名稱回查。

### 2026-04-29 — 賽事報名按鈕依選取俱樂部更新 [中型]
- **問題**: 多俱樂部使用者在友誼賽詳情頁送出「參加賽事」後，報名區按鈕仍可能用整體狀態判斷，無法依下拉選到的俱樂部顯示「審核中 / 已通過審核 / 可報名」；admin/super_admin 使用者若不是隊伍幹部，也看不到自己已加入俱樂部的報名下拉選單。
- **原因**: `renderRegisterButton()` 先看所有 `pendingTeams` / `approvedTeams` 的聚合結果，沒有保留使用者目前選取的 club id；報名成功或撤回後重新渲染時也沒有把剛操作的俱樂部設為目前狀態目標。前端 apply context 只吃 `_getFriendlyResponsibleTeams()`，導致 admin/super_admin 的一般所屬俱樂部被排除；後端 callable 也需要同步區分「隊伍幹部」與「管理員自己的所屬俱樂部」。
- **修復**: 新增賽事報名區選取俱樂部記憶與狀態正規化；下拉選單同時列出審核中、已通過、可報名與未通過俱樂部，按鈕依目前選取俱樂部顯示「參加賽事 / 俱樂部審核中 / 俱樂部已通過審核」，已通過且有權限時提供「取消報名」。admin/super_admin 的下拉來源改為 `user.teamIds/teamId` 所屬俱樂部，不可代表全平台任意俱樂部；Cloud Function apply/withdraw 同步限制為「隊伍幹部」或「admin/super_admin 且使用者資料內包含該 teamId」。
- **驗收**: `tests/unit/tournament-friendly-detail-view.test.js` 新增多俱樂部 pending / approved / available 與 admin 所屬俱樂部 selector 測試；`tests/unit/cloud-functions.test.js` 補 admin/super_admin 只能代表自己所屬俱樂部的 apply permission 測試；`npm test -- --runInBand` 198 suites / 7500 tests passed。

### 2026-04-29 — 首頁 boot data 注入降頻與可追蹤性 [中型]
- **問題**: GitHub Actions 每 3 小時更新首頁 inline boot data，能加速首頁首屏，但頻率偏高，容易造成 index.html 自動 commit 與協作 rebase 干擾。
- **原因**: `.github/workflows/inject-hot-events.yml` 固定 3 小時排程，且 `scripts/inject-hot-events.js` 活動只抓前 40 筆再本地挑近期活動，活動量增加時覆蓋率不足。
- **修正**: 將排程改為每 6 小時，保留手動觸發；活動抓取 `pageSize` 提高到 120；每次注入時在 workflow log 列出 picked events/banners/tournaments 的 id 與日期/slot。
- **驗收**: `node --check scripts/inject-hot-events.js`、`git diff --check`、`npm test` 通過；未進行實體瀏覽器測試。

### 2026-04-28 — 找出歷史 silent fail 的真正根因:this 指錯物件 [永久]
- **問題**:用戶按下「編輯賽事」按鈕後跳 toast「找不到此賽事(快取不一致, …17955_jn6d66)」。Console: `tournament not found {id: 'ct_1777349317955_jn6d66', cacheSize: 2, fetchedFromServer: false, fetchError: null}` — `fetchedFromServer: false` 證明根本沒進 fallback fetch
- **真正根因**:`tournament-manage-edit.js:25` `const editRecord = this.getFriendlyTournamentRecord?.(rawRecord)` — 這函式定義在 **`ApiService`** 不是 **`App`** 上!`App.getFriendlyTournamentRecord` 永遠是 undefined → optional chaining `?.()` 直接回 undefined → `editRecord` falsy → silent fail(舊版)/ 跳 toast(我前面加的版本)
- **歷史教訓**:這 bug 一直存在(line 89 `handleSaveEditTournament` 也有同 pattern),只是過去 silent return 不會被用戶看到。前面 5-6 筆修復都圍繞權限守衛/Rules/cache fallback 在繞圈,**真正根因從第一筆就在,只是被 silent fail + toast 文案誤導**
- **對照組**:其他正確用法(`tournament-render.js:77`、`tournament-detail.js:253` 等)都用 `this.getFriendlyTournamentRecord?.(t) || t` — `|| t` fallback 即使 undefined 還能繼續 → 不會炸。`tournament-friendly-detail.js:81` 直接 `ApiService.getFriendlyTournamentRecord?.(...)` → 正確
- **修復**:兩處都改:
  - `showEditTournament` line 25:`this.xxx` → `ApiService.xxx + || rawRecord` fallback
  - `handleSaveEditTournament` line 89:同上,且把 silent return 改 toast「找不到此賽事,請重新整理後再試」
- **教訓**:
  - **`?.()` optional chaining 對 undefined function 不會報錯,但會回 undefined 導致 silent failure** — debug 時最容易忽略的陷阱
  - 跨檔呼叫 helper 時必須確認**定義在哪個物件**(`App` vs `ApiService`),不能假設都掛在 `App`
  - 加 console trace 找根因的方法是對的,但問題隱藏在「沒有進 fallback 路徑」這個事實裡 — `fetchedFromServer: false` 才是真正關鍵 signal
  - 過去多次「修了又沒解決」就是因為**繞著 toast 文案打轉,沒看 stack trace 找真實 fail 點**

### 2026-04-28 — 修復後台「賽事管理」卡片「編輯賽事」按鈕 silent fail [永久]
- **問題**:後台 `page-admin-tournaments` 列表卡片上「編輯賽事」綠色按鈕點下去完全沒反應(無 toast、無 console error、無 modal),即使前面 4 筆 fix 已修權限、Rules、entry 通行證等問題
- **根因**:`tournament-manage-edit.js:7` `if (!editRecord) return;` **靜默 return 完全沒 toast**。當 `ApiService.getTournament(id)` cache miss 時(深層連結直接進入、SW 過期、limit 截斷未涵蓋這筆、首次進入該頁時 _tournamentSlices 仍未填入)→ `editRecord = null` → silent return → 用戶看到「點了沒反應」
- **修復**:`showEditTournament(id)` 改為:
  1. async 函式
  2. cache miss 時用 `await ApiService.getTournamentAsync(safeId)` fallback 從 Firestore 拉單筆(同詳情頁的 `showTournamentDetail` 既有 pattern)
  3. 仍找不到 → showToast「找不到此賽事(可能已被刪除或仍在載入)」(替代 silent return)
  4. ID 為空字串 → showToast「賽事 ID 無效」
- **教訓**:
  - **任何 `if (!x) return;` 在面向用戶的入口函式都是 UX 災難**。必須 toast/alert/console.warn 至少一個訊息,讓用戶或 debug 端有跡可循
  - **cache lookup 必須 fallback async fetch**(已成 pattern:`showTournamentDetail`、`showEventDetail` 都這樣做),`showEditTournament` 漏寫了
  - 「按鈕沒反應」的可能原因樹:① onclick 函式名拼錯 → 字串 handler 找不到函式無錯誤 ② 函式 silent return ③ 拋例外被吃掉 ④ 權限守衛擋掉 toast 一閃就消失。修這類 bug 必須把所有可能的 silent failure 點清掉

### 2026-04-28 — 補修 reviewFriendlyTournamentApplication 殘留閘 [永久]
- **背景**：上一筆 commit `ff9d6725` 補修兩條漏洞後,Codex review(另一邊獨立審計)又發現 `tournament-friendly-detail.js` `reviewFriendlyTournamentApplication()` 仍有殘留閘
- **漏洞**：函式開頭 `if (!hasPermission('admin.tournaments.review') && !hasPermission('admin.tournaments.entry')) { showToast('權限不足'); return; }` 在載入 tournament 前就擋掉。Creator-only 用戶在 teams tab 看得到「確認 / 拒絕」按鈕(因 `_canManageTournamentRecord` 通過),點擊後卻被 entry/review 前置閘擋。Firestore Rules 已允許 creator 操作 applications/entries → 前後端再次不對齊
- **修復**：
  1. 移除函式開頭 entry/review 前置閘
  2. 先 `_loadFriendlyTournamentDetailState` 載入 tournament
  3. 守衛統一改為 `manage_all OR _canManageTournamentRecord(tournament)`
  4. 新增 toast「找不到此賽事」處理 tournament 為 null 情境
- **測試**:
  - `tests/unit/tournament-permissions.test.js`: 抽出 `_canManageTournamentRecord` 同步加 creator 分支(對齊 production code 後),補 4 條 creator 測試 + 新增 `_canReviewFriendlyApplication` describe(8 條測試,涵蓋 creator-only 通過、admin 通過、entry-only 不能繞 record-scope、null 情境)
  - `tests/firestore-rules-extended.test.js`: 新增 `creator-only persona` describe(4 條 — update tournament/application/entry 都應通過)+ `entry-only persona` describe(3 條 — coach 角色拿 admin.tournaments.entry 仍被 Rules 擋)
- **驗證**:
  - `node --check js/modules/tournament/tournament-friendly-detail.js` ✅
  - `npm run test:unit`: 2468 通過(+12 新增)
  - `npm run test:rules`: 444 通過(+7 新增)
- **教訓**:
  - **多入口的權限守衛要逐一掃過,不能修了一處就交差**:這次第三輪審計又抓到 `reviewFriendlyTournamentApplication` 殘留 — 證明「修一個、找全部」是必要紀律
  - **`xxx.entry` 權限碼絕對不該出現在 record-scope action 守衛內**(三次了)。應建立 lint 規則或專案級 grep 預防(grep `hasPermission.*\.entry.*&&.*hasPermission` 揪出可疑模式)
  - 抽出測試版本必須隨 production code 演進同步,否則測試保護網會鬆動

### 2026-04-28 — 補修兩條前端/後端權限不對齊漏洞(P1+P2) [永久]
- **背景**：上一筆 commit `36af3b98` 修「編輯按鈕點了跳權限不足」時引入兩個漏洞,經 Codex review(另一邊獨立審計)發現
- **P1 漏洞 — 前端放行 creator 但 Rules 仍拒**：前端 `_canManageTournamentRecord` 已視 creatorUid 為可管理者(前次 fix),但 `firestore.rules` 的 `canManageTournamentScope()` 仍只認 admin/delegate/hostManager。建立者本人(若不是 host team 幹部)能看見 + 進入編輯彈窗,**最後 `updateTournamentAwait` 寫入時被 Rules permission-denied** → 用戶以為編輯失敗
- **P2 漏洞 — `admin.tournaments.entry` 變記錄級編輯通行證**：上一筆把 `entry` 設為獨立通行條件,但 `js/config.js:725-727` coach/captain/venue_owner 預設都有 `admin.tournaments.entry`(它原意是「進入賽事管理頁」入口權)。**直接 console 呼叫 `App.showEditTournament(任意賽事ID)` 可繞過列表過濾打開編輯 modal**(雖然 Rules 最終會擋,但 UX 已洩漏 + 違反最小權限原則)
- **修復**：
  1. **firestore.rules**: 新增 helper `isTournamentCreator()`,加進 `canManageTournamentScope()` ANY-OF:`isAdmin || isTournamentCreator || isTournamentDelegate || isTournamentHostManager`
  2. **tournament-manage-edit.js**: 兩處 `showEditTournament` / `handleSaveEditTournament` 第一道守衛**移除 `entry` 獨立通行**,改為 `manage_all OR _canManageTournamentRecord(record)`(entry 本來就被列表過濾擋,不該當記錄級編輯權)
- **測試**:`npm run test:unit`(2456 通過)+ `npm run test:rules`(437 通過)
- **教訓**:
  - **前端權限改動必須同步檢查 firestore.rules 對應 helper**,否則前端放行但後端拒絕 → 「能進但存不了」的 UX 災難。CR 時必查
  - **權限碼語意不能擴張**:`xxx.entry` 是「進入頁面」入口,不是「能對任意記錄做操作」。新增守衛時禁止把 `xxx.entry` 當記錄級通行證,改用對應的 record-scope helper(`_canManageXxxRecord(r)`)
  - **修權限 bug 要把所有閘一次掃過**(顯示 + 點擊 + 提交 + Rules 共 4 道閘),這次 Codex 審計幫我捕捉到漏掉的兩道
  - 「Codex review 在 push 前」這個 SOP **真的有效**(剛建立的 SOP,第一次套用就攔到 P1+P2)

### 2026-04-28 — 修復編輯賽事按鈕「點了跳權限不足」最後一道閘 [永久]
- **問題**：前面修了 `_canManageTournamentRecord` 補 creator UID 判定後,toolbar「編輯賽事」按鈕**會顯示**,但點下去仍然進不了編輯彈窗。實際上會跳 toast「權限不足」(用戶以為「沒反應」是因 toast 易被忽略)
- **原因**：`tournament-manage-edit.js` 內 `showEditTournament` (line 6) 與 `handleSaveEditTournament` (line 62) 第一道守衛 `if (!hasPermission('admin.tournaments.manage_all') && !hasPermission('admin.tournaments.entry')) { showToast('權限不足'); return; }` **只放行 admin 權限,沒給 `_canManageTournamentRecord` fallback**。違反 CLAUDE.md §「hasPermission 守衛新增規則」明文要求的 fallback 模式
- **修復**：兩個函式的第一道守衛改為 ANY-OF:`hasPermission(admin.X.manage_all) || hasPermission(admin.X.entry) || _canManageTournamentRecord(record)`,並合併原本第二道的 toast 文案「你目前只能編輯主辦或受委託的賽事」(更精準描述,而非籠統的「權限不足」)
- **教訓**：
  - **權限守衛 bug 通常是「多道閘」之間不對齊** — 這次 toolbar 顯示用 A 規則 (`_canManageTournamentRecord`),按鈕點擊用 B 規則 (`hasPermission only`),兩條規則不一致就出現「按鈕看得到但點不動」
  - 修權限類問題時,**必須把所有相關守衛(顯示 + 點擊 + 提交 + Rules)一次掃過**,只修一處往往只是把 bug 推到下一道閘
  - **toast「權限不足」會被誤判成「按鈕沒反應」**(toast 顯示在頁面底部很短時間),debug 時應該優先查 console / 嘗試在守衛內加 alert 確認哪一道閘擋住

### 2026-04-28 — 修復歷史賽事閃現 + 建立者編輯按鈕從未顯示 [永久]
- **問題**（兩個彼此相關但不同）：
  1. **閃現**：進入賽事中心時舊賽事先顯示一下,然後 onSnapshot 觸發後從列表洗掉(看起來像「閃一下消失」)。前次修復(`addTournament` 補 `updatedAt`)只解決新建賽事,**所有歷史賽事**仍會閃現
  2. **編輯按鈕「失效」**：實際是「按鈕從未顯示」(toolbar 被權限判定隱藏)。即使遠端 `c65c99ba` 加了 `openEditTournamentSafe` lazy-load wrapper,只解決「按鈕顯示但點了沒反應」這層,沒解決「按鈕根本沒出現」這層
- **原因**：
  1. `_startTournamentsRealtimeListener`(firebase-service.js:3139)用 `orderBy('updatedAt', 'desc')`,但 `_loadStaticCollections`(同檔 :569)用 `orderBy('createdAt', 'desc')`。**兩段查詢條件不一致** + Firestore `orderBy` 排除欄位不存在的文件 → 歷史資料(無 updatedAt)被 onSnapshot 排除 → cache 洗掉 → 閃現
  2. `_canManageTournamentRecord`(tournament-helpers.js:117-125)只判 `admin / 委託人 / host team captain/leader`,**漏掉「建立者本人」(`creatorUid === currentUser.uid`)**。建立者若不在 host team 任職(例如 admin 代建、或建立後從俱樂部離隊)→ toolbar 完全不顯示
- **修復**：
  1. listener 排序欄位改回 `createdAt`(與 static load 一致),歷史資料天然有 createdAt → 不會被排除。`renderTournamentTimeline` 自己會按名稱重排,listener 順序不影響 UI
  2. `_canManageTournamentRecord` 在 admin 判定後、委託人判定前,補一條 `if (currentUid === creatorUid) return true;`
- **教訓**：
  - **同一 collection 的 static load 與 onSnapshot listener 必須使用相同的 orderBy 欄位**,否則歷史資料會在 listener 啟動瞬間被洗掉(=閃現)。CR 時必查
  - **權限判定函式必須包含「建立者本人」這條最基本的規則**,否則「我建的東西自己不能管」是 UX 災難。新增 CRUD 時的權限 helper checklist:`admin → creator → delegate → team officer → 一般用戶`
  - 用戶說「按鈕失效」時,先區分「按鈕沒顯示」vs「按鈕點了沒反應」—— 兩者根因完全不同(權限 vs script loading)

### 2026-04-28 — 修復賽事詳情頁「編輯賽事」按鈕點了沒反應 [永久]
- **問題**：在賽事詳情頁（`page-tournament-detail`）按下右上「編輯賽事」按鈕完全沒反應；但從後台「賽事管理」（`page-admin-tournaments`）點則正常
- **原因**：`App.showEditTournament` 定義於 `tournament-manage-edit.js`，屬於 `script-loader.js` 的 `tournamentAdmin` 群組。詳情頁只配置了 `tournament` 群組（`page-tournament-detail: ['tournament']`），**從未載入 `tournamentAdmin`**，所以 `App.showEditTournament` 是 undefined，按鈕點了沒反應（也沒 toast）
- **修復**（採遠端 commit `c65c99ba`）：在 `tournament-core.js`（eager 模組，所有頁面必載）新增公開 wrapper `App.openEditTournamentSafe(id)`：
  1. 函式不存在 → `ScriptLoader.ensureForPage('page-admin-tournaments')`（fallback `loadGroup(_groups.tournamentAdmin)`）
  2. 載入後仍不存在 → showToast「編輯功能載入失敗，請重新整理後再試」（避免靜默失敗）
  3. 載入成功 → 呼叫 `showEditTournament(safeId)`
  4. 同步更新 `tournament-detail.js`、`tournament-manage.js` 兩處按鈕 onclick → `App.openEditTournamentSafe(...)`，後台列表 t.id 補 `escapeHTML`
- **教訓**：
  - 凡是按鈕 onclick 呼叫的函式定義在「非當前頁面 script 群組」內，必須加 lazy-load wrapper（已知 pattern：`_openTournamentDetail`、`_refreshTournamentCenterCreateButton`、`openEditTournamentSafe`），否則靜默失敗
  - **wrapper 應放 eager 模組**（如 `tournament-core.js`）而非 lazy 群組內，避免循環依賴
  - **wrapper 必須提供 fallback toast**，否則載入失敗時用戶仍以為按鈕壞了
  - script-loader 群組分割是優化載入速度的設計，但會造成「按鈕跨頁失效」的隱形 bug。新增按鈕時必查：onclick 函式所在檔案 → 屬於哪個群組 → 當前頁面是否載入該群組
  - 此類 bug 無 console error（onclick 字串型 handler 找不到函式只會靜默），更不易發現

### 2026-04-28 — 修復賽事建立/編輯彈窗封面圖片無法上傳（手機點了沒反應） [永久]
- **問題**：手機版（也包含桌面）建立賽事時，點「上傳賽事封面圖片」會開啟檔案選擇器，但選完照片後 preview 沒變化，建立後封面圖也是空的；內容圖片同樣狀況
- **原因**：`pages/tournament.html` 的 `<input type="file" id="tf-image">` 與 `#tf-content-image` 從來沒有 `change` 事件監聽器。整個 tournament 模組沒有任何 FileReader / readAsDataURL 處理選到的檔案。`_resetTournamentImagePreview()` 只重置 placeholder UI，沒做事件綁定
- **修復**：對齊「創立活動」做法（`event-create.js:125`），呼叫共用函式 `App.bindImageUpload(inputId, previewId)`：
  - `tournament-manage.js` `openCreateTournamentModal()` 結尾呼叫兩次 bindImageUpload（封面 + 內容）+ 清空 file input value
  - `tournament-manage-edit.js` `showEditTournament()` 同樣加兩行
  - `bindImageUpload` 已內建：格式檢查（jpg/png/webp/heic）、5MB 上限、Canvas 壓縮為 webp/jpeg、自動塞 `<img>` 進 preview、`dataset.bound` 防重複綁
- **教訓**：
  - 任何 `<input type="file">` 必須有對應的 `change` 監聽，否則點了「沒反應」是必然結果（且手機上更明顯，因為桌面用戶可能會以為是檔案選擇器自身行為）
  - 既有可重用工具函式（`bindImageUpload` 已被 ad-manage / boot-brand / event-create / event-create-external / event-manage-lifecycle 廣泛使用）優先沿用，禁止為單一模組自寫一份相同邏輯
  - 新增表單時，**file input 綁定的優先級與「必填欄位驗證」同等重要**，CR 時必查

### 2026-04-28 — 修復新建賽事立刻從列表消失 [永久]
- **問題**：用戶建立新賽事後 toast 顯示成功，但賽事中心、首頁、管理列表都看不到剛建立的賽事；重新整理頁面有時會出現、有時又消失
- **原因**：`firebase-crud.js` 的 `addTournament()` 寫入時只設定 `createdAt` 沒設定 `updatedAt`，但 `firebase-service.js` 的 `_startTournamentsRealtimeListener()` 用 `db.collection('tournaments').orderBy('updatedAt', 'desc')` 監聽。Firestore 的 `orderBy` 會**排除該欄位不存在的文件**，所以新建賽事不會出現在 onSnapshot 結果 → `_tournamentSlices.active` 不包含 → `_mergeTournamentSlices` 後 cache 不包含 → 列表渲染看不到
- **修復**：`addTournament()` 加上 `updatedAt: firebase.firestore.FieldValue.serverTimestamp()`（與 `addTeam()` 一致的寫法）
- **教訓**：
  - 凡是 onSnapshot 用 `orderBy(X)`，對應 CRUD 寫入時**必須**確保 X 欄位存在，否則文件會「隱形」
  - `addTeam()` 寫了 `createdAt` + `updatedAt` 兩者，`addTournament()` 只寫 `createdAt`——這種「同類函式不對齊」就是地雷源頭
  - 未來新增任何 collection 的 CRUD 時，先檢查對應 onSnapshot 的 `orderBy` 欄位有無在寫入路徑出現

### 2026-04-27 — 安裝 tommyboy326/line-dev Claude Code skill bundle(全域,5 個 LINE 專業 skill)
- **背景**:同類專案調查中發現 `tommyboy326/line-dev` 是台灣 dev 寫的 Claude Code skill bundle,提供 LINE Messaging API / LINE Login / LIFF / Mini App / Notification Messages 5 個專業 skill,雙語(英 + 繁中)
- **安裝路徑**:`C:\Users\msw74\.claude\skills\`(全域,所有 Claude Code 專案可用)
  - line-liff/SKILL.md(LIFF SDK 開發)
  - line-login/SKILL.md(OAuth 2.1 + PKCE)
  - line-mini-app/SKILL.md(Mini App 平台)
  - line-notification-message/SKILL.md(通知訊息 API)
  - messaging-api/SKILL.md(Messaging API + Flex Message + webhook)
- **總大小**:88 KB(5 檔)
- **安裝方法決策**:repo 含 `.claude-plugin/plugin.json` 是正式 Claude Code plugin,但走 `/plugin` GUI 流程需要 marketplace 註冊較複雜。直接 cp 5 個 SKILL.md 到 `~/.claude/skills/` 是更乾淨的「standalone skills」用法,Claude Code 啟動會自動偵測
- **觸發方式**:每個 SKILL.md 有 frontmatter 定義 trigger keywords(英文 + 繁中),Claude 偵測對話內出現相關關鍵字時自動讀取 skill 內容
- **生效條件**:**新對話才生效**(現有對話 context 不會 retro-load)。`/clear` 開新對話後,問 LINE 平台問題 Claude 會引用 LINE 官方 API 文件回答
- **教訓**:Claude Code 的 plugin / skill 雙系統,plugin 走 marketplace 走複雜註冊流程,skill 是 standalone SKILL.md 直接放進 `~/.claude/skills/<name>/SKILL.md` 就生效,對開發者使用情境後者更簡單

### 2026-04-27 — 整合 LIFF Inspector(LINE 內建瀏覽器遠端 DevTools,dev 模式 only)
- **背景**：LINE 內建瀏覽器(WebView)沒有 F12,以前用戶在 LINE 內回報 bug 只能瞎猜。LINE 官方出品的 `@line/liff-inspector`(72★, MIT)可讓電腦端開 https://liff-inspector.line.me 與手機 LINE 內 ToosterX 配對,即時看 console / network / DOM,等同 Chrome DevTools
- **設計**：
  - `index.html`：插入 dev 模式自動載入器(L252 後),piggyback 既有 `__SPORTHUB_CONSOLE_POLICY__` 的 `isProdHost / isLocal / debugEnabled` 判斷,僅在 **非 PROD_HOSTS / localhost / `?debug=1`** 時載入 UMD bundle
  - 設 `window.__LIFF_INSPECTOR_ENABLED__` global flag 給 `line-auth.js` 讀
  - UMD CDN:`https://cdn.jsdelivr.net/npm/@line/liff-inspector@1.0.3/dist/umd/liff-inspector.js`(曝露 `window.LIFFInspectorPlugin`)
  - `s.async = false` 確保在 `liff.use()` 前已載入
- **`js/line-auth.js`**：在 `initSDK()`(L266 前)+ `init()`(L323 前)兩個 `liff.init()` 路徑前加 plugin 註冊。double try/catch 確保 plugin 載入失敗不影響 production
  ```javascript
  if (window.__LIFF_INSPECTOR_ENABLED__ && typeof window.LIFFInspectorPlugin === 'function') {
    try { liff.use(new window.LIFFInspectorPlugin()); } catch(e) { ... }
  }
  ```
- **觸發條件**:
  - ✅ localhost / 127.0.0.1 / 192.168.* (本機開發)
  - ✅ Cloudflare branch preview (非 `fc-3g8.pages.dev` 主域)
  - ✅ 任何 URL 帶 `?debug=1` (production 也可一次性 enable 抓 bug)
  - ❌ toosterx.com / www.toosterx.com / msw2004727.github.io / fc-3g8.pages.dev (production 完全靜默)
- **使用方式**:
  1. 手機:LINE 內開 ToosterX (dev 環境) → 右下角會出現 floating debug 按鈕
  2. 按按鈕 → 顯示短碼 (例:`xj3p9k`)
  3. 電腦:開 https://liff-inspector.line.me → 輸入短碼配對
  4. 手機操作 → 電腦即時看 console / network / DOM
- **教訓**:
  - LIFF plugin 必須在 `liff.init()` **前**註冊,順序錯就 silent fail。`s.async = false` 是關鍵
  - `__SPORTHUB_CONSOLE_POLICY__` 既有 prod / dev 判斷可重用,不必另寫一套邏輯,DRY 設計勝出
  - 第一輪 agent 報「scanCodeV2 deprecated」是錯的(實測屬 V1 / V2 混淆 + ToosterX 自己用 html5-qrcode 沒 LIFF 內建),警告涉及 production 修改前必驗證

### 2026-04-27 — Hash navigation 延後安全 timeout 5000 → 7000ms（消除「先閃首頁→才跳目標頁」殘留瑕疵）
- **問題**：用戶反映即使 4/27 加了 hash navigation 守衛（commit 121a6c52），實測仍出現「reload `#page-activities` → 先閃真首頁 → 過幾秒才跳活動列表」
- **根因**：`_dismissBootOverlay` 的 hash nav 守衛雖然會延後隱藏，但設了 **5 秒安全 timeout** 避免 navigation 卡住永遠遮罩。Mobile / 慢網路下 `showPage('page-activities')` 經常需要 5+ 秒（`ensureCloudReady` + `ensureCollectionsForPage` + `_renderPageContent`），5 秒到達時 navigation 還沒完成 → timeout fire → 強制 dismiss overlay → 用戶看到首頁渲染 → 1-2 秒後 nav 完成才跳目標頁
- **修復**：`app.js` `_dismissBootOverlay` 的 hash/deep link 守衛 timeout 從 `5000` ms → `7000` ms
- **設計約束**：必須 < 開機看門狗 `8000` ms（避免看門狗先 reload），7 秒給 1 秒緩衝
- **依規 §每次新增功能時的規範第 8 條**：
  - `docs/tunables.md` 同步更新「Navigation 延後安全 timeout」條目（5000 → 7000）+ 名稱從「Deep link」擴充為「Navigation」（涵蓋 hash nav）
- **預期效果**：mobile reload `#page-xxx` → 7 秒內 navigation 完成 → 直接跳目標頁、無首頁 flash
- **若仍 flash**：表示 navigation 真的需要 7+ 秒，需要優化 cloud init / ensureCollectionsForPage 速度，而不是繼續拉 timeout（看門狗 8 秒上限）
- **教訓**：「機制設計沒問題、實際運行時間不夠」是常見的 timing race。修復前要實測「目標流程實際耗時」對比「timeout 上限」，避免設計時樂觀估計

### 2026-04-27 — Navigation 低風險加速方案調查(規劃中,未實作)
- **背景**:用戶 reload `#page-activities` 等 hash nav 場景需 5-7 秒(手機/慢網路),即使「跳過首頁渲染」修法後仍能再優化
- **Navigation 9 步驟瓶頸排序**:
  1. 🥇 Firestore 載入 events(100+ 筆)~1-3s(40%)
  2. 🥈 Firebase Auth + Firestore 連線 ~1-4s(30%)
  3. 🥉 動態載入 page-activities.html ~300ms-1s(15%)
- **既有優化盤點**:
  - ✅ Preconnect: Firebase + LINE CDN(`index.html:175-180`)
  - ✅ Preload: Firebase SDK 4 個 modules(L183-186)
  - ✅ Inline events:F 方案 commit `0273ad05` 已實作(events 6 筆 inline 到 `<script id="boot-events-data">`)
  - ✅ Skeleton CSS:`css/base.css:1023` `.skeleton` + `activity.css:1293` `.reg-loading-skeleton` 已有定義
  - ✅ Stale-first:`_staleWhileRevalidate*` + `_canUseStaleNavigation` 已實作
  - ✅ 動態載入分組:`script-loader.js` 按 page 群組載入
- **低風險加速方案 ranking**(僅討論,未動手):
  - 🥇 **擴大 F 方案 inline 範圍**(banners + announcements + sponsors)
    - 工時 4-6 hrs / 預期砍 1-1.5 秒 / 風險 🟢 極低(已驗證模式擴展)
  - 🥈 **Skeleton screen for page-activities**(用既有 .skeleton CSS)
    - 工時 2-4 hrs / **體感**砍 50%(實際時間不變)/ 風險 🟢 低
  - 🥉 **Critical CSS inline**
    - 工時 6-8 hrs / 砍 100-300ms / 風險 🟡 低-中(可能漏 critical 導致 FOUC)
  - 4️⃣ **events 分頁載入**(首屏 20 筆,scroll 載更多)
    - 工時 8-12 hrs / 砍 500ms-1s / 風險 🟡 中(動 stale-first 邏輯)
- **不推薦的高風險方案**:
  - SW 進階預快取(SW 機制複雜)
  - Listener 預啟動(浪費頻寬,用戶可能不去那頁)
  - Cloudflare Workers SSR(架構級重構,40-80 hrs)
  - WASM(技術棧轉換)
- **建議組合**(最低風險 + 最高 ROI):
  - 擴大 F 方案 + Skeleton screen
  - 預估 navigation 從 5-7 秒 → 2-3 秒(實際)/ 體感更快
  - 總工時 6-10 hrs
- **狀態**:待用戶決策是否動手。如要做應**先寫計劃書 + 多輪 QA 審計**(同 boot-skip-home-downgrade-plan 流程)

### 2026-04-27 — Boot 階段 hash nav / deep link 跳過首頁渲染(降階方案,8 輪自審 + 2 輪 QA 後執行)
- **問題**:用戶 reload `#page-activities` 等帶 hash 場景時,boot overlay 隱藏後**先看到完整首頁(banner+熱門活動)→ 過幾秒才跳目標頁**。前次 5→7 秒 timeout 修法只是「用 overlay 蓋更久」,沒治本
- **根因**:`app.js renderAll()` **無條件**呼叫 `renderHomeCritical()`,不管 URL hash 是什麼一律渲染首頁。boot overlay 隱藏後用戶必然看到首頁
- **方案取捨**(8 輪自審 + 2 輪 QA 後決策):
  - 完整方案(動 currentPage 預設 + HTML class swap + 重設計階段 2):4 小時、🟠 中風險,QA 抓到 2 BLOCKER(PageLoader 未完成 DOM 不存在、_activatePage 不變式破壞)
  - **降階方案(僅動 renderAll 加守衛)**:30-45 分鐘、🟢 極低風險,**最終採用**
- **修復**:`app.js renderAll()` 新增 19 行守衛:
  - 偵測 URL hash 為有效 page-xxx(非 page-home)→ `isHashNav = true`
  - 偵測 sessionStorage 有 `_pendingDeepXxx` → `isDeepLink = true`
  - 任一為 true → `console.log` + `ScriptLoader.preloadCorePages()` 保留全域副作用 + early return
  - 不影響:無 hash / `#page-home` / 非 boot 場景的 renderAll 呼叫
- **審計覆蓋**:
  - 8 輪自審(語法/邊界/race/非 boot 場景/跨瀏覽器/hash 變動/異常路徑/回歸測試)
  - 2 輪 QA agent(原計劃抓 2 BLOCKER + 最終批准 review 條件批准)
  - 涵蓋 9 種 URL 邊界、4 處 non-boot caller、3 端瀏覽器、popstate / unicode / iOS Private Mode 等
- **可接受 trade-off**(計劃書 §三):
  - B1:`_markPageSnapshotReady('page-home')` 不 mark → 首次返首頁稍慢(走 fresh-first)
  - B2:`showPopupAdsOnLoad` 不觸發(設計上 popup 就是「進首頁時彈」,reload 進其他頁等於沒進首頁)
  - B3:極端 PageLoader 10s timeout 時退化為「全空畫面」(看門狗 8s reload 兜底)
- **保留**:`ScriptLoader.preloadCorePages()` 保留全域必要副作用(避免後續 page 切換變慢)
- **依規 §每次新增功能時的規範第 8 條**:`docs/tunables.md` 同步更新 Last Updated
- **完整計劃書**:`docs/boot-skip-home-downgrade-plan.md`(243 行,含 11 個測試 checkpoint)
- **教訓**:
  - **動手前先審計救了 2 個 BLOCKER**:原計劃 4 階段方案的階段 2(手動 swap class)會踩到「PageLoader 未完成 DOM 不存在」+「破壞 _activatePage 不變式」雙雷
  - **跟 F 方案(用戶推的 inline events)互補**:用戶修法加速首頁渲染,我修法跳過 hash nav 場景的渲染,結合效果比單做更好
  - **計劃書反覆審計的價值**:第 6+ 輪審計仍找到 W3(deep link 守衛漏)、preloadCorePages 全域必要等實質問題

### 2026-04-27 — 重新加回匹克球 V4 SVG 圖示(被 dcb2c0ea 意外移除)[永久]
- **問題**：用戶反映匹克球圖示又變回 🏓 桌球 emoji,**先前明明改成 V4 SVG 過**
- **根因追查**：
  - `git log -S "SPORT_ICON_SVG_HTML"` 查全 history → 找到只有 2 個 commit 動過此字串：`e8c03442`(引入)和 `dcb2c0ea`(移除)
  - `git show dcb2c0ea` 看 diff → **整個 `SPORT_ICON_SVG_HTML` 對照表 + helper SVG 邏輯被刪除**
  - 但 `dcb2c0ea` 的 commit message 是「feat(auth): 手機外部瀏覽器 LINE 登入加 UX 提示」,跟匹克球完全無關
  - 推測:該 commit 作者基於更早版本(force push 之前的 e8c03442 之前狀態)工作,推上來時把更新覆蓋掉
- **修復**：
  - `js/config.js`：重新加入 `SPORT_ICON_SVG_HTML` 對照表 + 修改 `getSportIconSvg` 加 SVG 優先邏輯
  - `js/config.js` 的 SVG 區塊上方加**警告註解**:「修改 config.js 時請務必檢查 SPORT_ICON_SVG_HTML 是否仍存在,避免再次被合併衝突覆蓋」
  - `tests/unit/config-utils.test.js`:既有測試保留,跑測 2456 PASS(test 檔在 dcb2c0ea 沒被覆蓋)
  - `docs/tunables.md`:`#sport-icon-svg` 條目本來就在(dcb2c0ea 沒覆蓋),不需動
- **教訓（永久）**：
  - **合併衝突沒處理好可能讓修改靜默消失**:dcb2c0ea 的 author 工作在更早版本(force push 之前),推上來時應該先 rebase 到最新 main,而不是直接 push 蓋掉
  - **重要區塊加警告註解**:像 `SPORT_ICON_SVG_HTML` 這種容易被誤刪的對照表,加註解標明「曾被誤刪,修改時請檢查」
  - **未來修改 `js/config.js` 流程**:
    1. 修改前 grep `SPORT_ICON_SVG_HTML` 確認還在
    2. 修改後 git diff 檢查是否誤刪此區塊
    3. 推 push 前 fetch + rebase origin/main 避免覆蓋他人修改
  - **防禦工具建議**:可以加個 unit test 確保 `SPORT_ICON_SVG_HTML.pickleball` 含 'svg' 字串,任何刪除會被測試擋下(目前測試已有 `expect(result).toContain('<svg')`)

### 2026-04-27 — 補完 CLAUDE.md 同類型模組聚集規則（3 檔搬入子資料夾）
- **問題**：CLAUDE.md 規則「同類型模組必須放在同一資料夾」明文違規 3 件
- **修復**：
  - `js/modules/achievement-batch.js` → `js/modules/achievement/batch.js`
  - `js/modules/auto-exp.js` → `js/modules/auto-exp/index.js`（新建子資料夾）
  - `js/modules/auto-exp-rules.js` → `js/modules/auto-exp/rules.js`
  - 同步更新 `js/core/script-loader.js`（12 處）、`tests/unit/migration-path-coverage.test.js` 的 KNOWN_REFERENCES key、`docs/architecture.md`
- **驗收**：2406 unit tests 全綠、migration-path-coverage 7/7 通過（含 "actual scanned total matches allowlist total"）、grep 確認舊路徑零殘留
- **教訓**：用 `git mv` 搬移可保 100% history；migration-path-coverage 是這類重構的最佳保險（會自動偵測檔案路徑漂移 + 引用計數不一致）

### 2026-04-27 — 抽屜「下載 APP」按鈕重新啟用
- **改動**：`js/modules/pwa-install.js` `initPwaInstall()` 移除「功能準備中」反灰狀態 + toast，接回原 `_handlePwaInstallClick`（Android Chrome 原生 prompt 或跨平台 Android/iOS 引導 picker）
- **新增**：`beforeinstallprompt` listener 捕捉 Android Chrome 原生安裝提示
- **行為**：已 standalone 模式運行的用戶按鈕仍自動隱藏

### 2026-04-27 — 數據儀表板 3 件深色主題視覺修補
- **問題**：
  1. `dash-query-details` 綠色漸層在深色主題太暗看不出
  2. 雲端用量 Blaze 卡片在深色主題下白底白格、淺灰文字看不到
  3. 儀表板第一欄「重新整理列」沒有獨立色系與下方視覺區隔
- **真兇（#2 是大魚）**：`.dash-usage-card` / `.dash-cost-row.dash-cost-detail` 用錯變數名 `--card-bg` / `--border-color`（專案沒這變數）→ fallback 到 `#fff`/`#e2e8f0` 硬色
- **修復**：
  - `dash-query-details` 加 `[data-theme="dark"]` override（更亮的 `#34d399` + 提高不透明度）
  - `.dash-usage-card` / 相關元素改用專案標準變數 `--bg-card` / `--border` / `--text-primary` / `--bg-elevated` / `--text-muted`
  - `dash-usage-alert` 新增 class（半透明紅、雙主題可讀，取代硬編 `#fef2f2`/`#991b1b`）
  - `dash-refresh-bar` 加 amber 漸層 + border（與 teal 「活動參與查詢」做色系區隔）
- **教訓**：CSS 變數名拼錯時 fallback 機制會「靜默生效」、深色主題才會曝光問題；以後修 dark mode bug 第一步檢查變數名是否與專案命名一致（`--bg-card` 不是 `--card-bg`）

### 2026-04-27 — 首頁贊助商整區隱藏（沒有贊助商時不再顯示 6 個空格）[永久]
- **問題**：原本 `renderSponsors()` 永遠渲染 6 格、沒贊助商時顯示 6 個寫著「贊助商」的空格框
- **修復**：`js/modules/banner.js` 改為 filter `status === 'active' && image`，0 筆時整區（含上方 `<hr>` 分隔線）隱藏；N 筆時只渲染 N 格、不再補佔位
- **附加**：`pages/home.html` 上方 `<hr>` 加 `id="sponsor-divider"` 以便同步隱藏

### 2026-04-27 — 活動參與查詢 UI 4 件修補
- **問題**：
  1. 點「產生臨時網址」會被自動跳到新分頁（用戶不要主動跳轉）
  2. 開始/結束日期欄位在 iOS Safari 撐爆 grid 1fr 邊界
  3. 開始日期預設硬編 `2026-02-01`、應改當月 1 號
  4. 「儀表板詳情功能需先撈取完整資料」Toast 重複提示煩人
- **修復**：
  - `dashboard-participant-share.js` 移除 `window.open`/`popup.location.replace`、純建連結讓用戶手動點「開新頁查看」
  - CSS `.dash-query-field` 加 `overflow: hidden` + input 加 `-webkit-appearance: none / appearance: none / font-size: 16px / padding/border/radius/background/color`（沿用 `.ce-row-half` 成功模式）
  - `dashboard-participant-query.js` `_getDashboardParticipantSearchDefaultState` 改用 `new Date(y, m, 1)` 動態取當月 1 號
  - `dashboard-snapshot.js` `_maybePromptDashRefresh` 移除無資料時的 Toast 提示

### 2026-04-27 — 臨時參與報表 `?rid=` 殘留導致 refresh 被拉回 [永久]
- **問題**：建立臨時報表後 URL 帶 `?rid=xxx`，用戶導航到其他頁面後 hash 變了但 `?rid=` 仍殘留；按 F5 → boot 邏輯（`app.js:2471`）看到 `?rid=` 就強制路由到 `page-temp-participant-report` → 用戶被「強制拉回」
- **修復（雙重防禦）**：
  - **app.js boot 邏輯**：改為「`?rid=` + (`hash` 為空 or 是 `page-temp-participant-report`)」才強制路由（不再單看 `?rid=` 就動）
  - **navigation.js `_activatePage`**：離開 `page-temp-participant-report` 時自動清掉 `?rid=`（放在所有 showPage 路徑共用入口、stale + fresh 都涵蓋）
  - 第一版只放在 `_showPageFreshFirst`，stale path 沒蓋到，用戶從首頁返回時仍殘留 — 第二版才搬到 `_activatePage`
  - `_clearDeepLinkQueryParams` 陣列也補上 `'rid'`
- **教訓**：showPage 有 stale 與 fresh 兩條路徑，hook 要放在共用入口（`_activatePage`）才完整；分散在各路徑會漏

### 2026-04-27 — iOS PWA 進「用戶管理」自動重整（DOM 過大、WKWebView memory pressure 觸發 OS kill）[永久]
- **症狀**：iOS Safari/Chrome/Edge（任何瀏覽器）以管理員身份進入 page-admin-users → 1-2 秒後**被 OS 強制重整**（真實 reload、JS hooks 全沒機會跑），伴隨：
  - 登入後**被強制深色主題**
  - 明明只開一個分頁、卻提示「多分頁」警告
  - 反覆 reload 後 iOS Safari 顯示「重複發生問題」OS 級錯誤頁
- **桌機 Chrome / Edge / Safari、Android Chrome 全部正常**
- **真兇**：iOS PWA standalone mode + 用戶管理頁渲染所有用戶卡片
  - manifest.json `display: standalone` + apple meta tags 啟用 PWA 模式
  - iOS PWA WKWebView 記憶體限制嚴格（~40-100MB、比一般 Safari tab 小很多）
  - `renderAdminUsers` 一次渲染全部用戶（100+ 卡片、每卡含 1 個 avatar img + 5 行 meta + 多按鈕）
  - 每個 avatar img 還會 fetch 真實圖片、image buffer 累積 5-20MB
  - 加上 DOM tree、layout、Firebase SDK state、總記憶體用量接近 / 超過 iOS 上限
  - **OS 強制 kill webview process** → 重新載入 → 看起來像 reload
  - 關鍵：**OS 層 kill、JS 完全沒機會跑任何 lifecycle handler**（解釋為何 9 輪 hooks 都抓不到）
  - 強制深色 = webview kill 後重啟、localStorage 讀失敗、fallback prefers-color-scheme
  - 假多分頁 = WKWebView pool 殘留 BroadcastChannel 訊號
- **9 輪診斷歷程**（記錄供後人警示）：
  1. onSnapshot 推送觸發 applyRole 跳 home — hooks 沒抓到
  2. _canAccessPage 失敗 — hooks 沒抓到
  3. user doc role 不一致 — currentRole 一直對
  4. **Boot watchdog 8 秒 reload — 修了仍重現**（修復本身有效、保留）
  5. **SW controllerchange — revert（跨平台不該 iOS-only）**
  6. SPA showPage(home) — hooks 沒抓到
  7. **synchronizeTabs iOS-only false — 用戶實測無效（agent 誤判）**
  8. iOS PWA 排除 / 其他 admin 頁 A/B 測試 — **用戶實測「有 PWA + 唯獨用戶管理頁」**
  9. **真兇定位：DOM 渲染量過大 + iOS PWA memory limit**
- **修復**（commit `f5563cc4`）：
  - 預設只渲染前 30 個用戶（`_adminUserPageSize = 30`）
  - avatar 加 `loading="lazy" decoding="async"`、image fetch 延遲到滑入 viewport
  - 底部加「載入更多（已顯示 X / Y）」按鈕、點擊 += 30
  - filterAdminUsers 篩選/搜尋時 reset pageSize（避免「載入到 90 後篩選仍 90」誤判）
  - _loadMoreAdminUsers 不走 filterAdminUsers（避免 reset 衝突）
- **副作用**：桌機 / Android 也預設 30、要點「載入更多」（UX 微小變化、實際上 100+ 用戶時桌機渲染也卡頓、分頁是 net positive）
- **教訓**：
  - **症狀組合是線索**：3 個現象（reload + 強制深色 + 假多分頁）都源自「webview 被 kill 重啟」這同一機制、不要分頭追
  - **JS hooks 抓不到 = 觸發點在 OS / SDK native 層**：不要再加 hook、要從外部現象（哪些頁面才中、平台特性）反推
  - **iOS PWA 記憶體限制比一般 Safari 嚴格**：開發 admin 後台類「列出大量資料」頁面時必須分頁 / 虛擬滾動
  - **A/B 測試是定位 iOS-only bug 的關鍵**：「PWA 移除是否消失」+「其他類似頁面是否中」兩問題快速縮小範圍
  - 不要被 agent 引用過時 memory log 誤導（agent 看到我寫的 synchronizeTabs 假設、直接複述）— 需要明確告訴 agent 哪些已驗證無效
- **原本以為的「synchronizeTabs」假設已驗證為假兇**：iOS-only false 用戶實測仍重現、改回 true 不影響 bug 也不影響 fix

### 2026-04-26 — 手機外部瀏覽器 LINE 登入加 UX 提示（OS 跨 app 攔截 token 流失問題）
- **問題**：手機 Safari / Chrome 點 LINE 登入 → OS 提示「是否在 LINE 中打開」→ 用戶點「打開」→ LINE app 接管 OAuth 完成 → redirect 回 Safari/Chrome 但 token 沒帶回 → **登入失敗**
- **根因**：手機 OS（iOS / Android）的 universal link / intent 機制把 `access.line.me` URL 攔截到 LINE app；LINE app 完成 OAuth 後 token 留在 LINE 內、跨 app redirect 不會帶 `code` & `state` 回外部瀏覽器。桌面 / LINE 內無此問題（沒跨 app 跳轉）
- **解決方案 A**（UX 引導、本次採用）：
  - 偵測：`LineAuth._isMobileExternalBrowser()` 用 `liff.isInClient()` + UA 判斷
  - 提示 modal（`mobile-line-login-hint-modal`）：明確告知「跳出『是否在 LINE 中打開』時請選『取消』或『在瀏覽器中繼續』」+ 提供「複製連結用 LINE 開啟」備案
  - 用戶點「繼續登入」→ 設 `_mobileHintAcknowledged` 旗標、再次呼叫 `login()` 跳過 hint
  - modal 加 `data-no-backdrop-close="1"` 避免誤觸關閉
- **限制**：方案 A 是 UX 引導、無法 100% 解決（用戶仍可能誤點「在 LINE 打開」）；但解決率 70-80%、LINE 平台限制下最佳折衷
- **影響檔案**：`js/line-auth.js`（加 _isMobileExternalBrowser / _mobileHintContinue / _copyAppUrlForLine）+ `pages/modals.html`（加 hint modal）


### 2026-04-25 — 匹克球改用自製 V4 SVG 圖示（圓角方形拍 + 飛球 + 速度線）
- **動機**：用戶反映 `SPORT_ICON_EMOJI.pickleball = '🏓'` 跟桌球視覺易混淆。Unicode 無匹克球專屬 emoji，建議用自製 SVG。經設計 4 個版本後用戶選 V4（動感斜放紅色圓角方形拍 + 黃球飛 + 速度線）
- **實作**：
  - `js/config.js`：新增 `SPORT_ICON_SVG_HTML` 對照表（目前僅匹克球一項），修改 `getSportIconSvg(key, className)` helper：優先查 `SPORT_ICON_SVG_HTML`，命中則回傳 SVG span，否則 fallback 到 `SPORT_ICON_EMOJI`
  - `SPORT_ICON_EMOJI.pickleball = '🏓'` 保留不動（作為 LINE Flex Message / textContent 等不支援 HTML 場景的 fallback）
  - SVG 用 `width="1em" height="1em" style="vertical-align:-0.1em"` 適配 `.sport-emoji` 既有 font-size styling，所有消費點（picker / theme / list card）零改動
  - `tests/unit/config-utils.test.js`：同步 SPORT_ICON_SVG_HTML 定義 + 加 2 個新測試（pickleball 走 SVG path、className 處理）
- **架構優勢**：透過修改 helper 一次到位，不動任何消費點（`event-create-sport-picker.js` / `theme.js` / 月曆 / 卡片 等所有 `getSportIconSvg(...)` 呼叫者自動切換）
- **未涵蓋場景**（仍使用 emoji `🏓`）：
  - `js/modules/news.js:136` 直接讀 `SPORT_ICON_EMOJI[sportTag]` — LINE 推播訊息 / Flex Message 必須用 emoji 字符
  - `js/modules/event/event-calendar-constants.js:42` `getSportDef` 回傳的 `emoji` 欄位 — 月曆顯示位置目前無 SVG 支援
- **遵循規則**：依 §每次新增功能時的規範第 8 條（可調設定 / Timing 同步維護），同步更新 `docs/tunables.md` 新增 #sport-icon-svg 條目 + 變更歷史
- **教訓**：原 helper 名稱 `getSportIconSvg` 暗示原本就有 SVG 化的設計意圖，順勢實作；架構良好的 helper（單一入口、消費點走 helper 而非直接讀常數）讓擴充零成本

### 2026-04-25 — Boot overlay MIN_VISIBLE_MS 調整 1500 → 2500
- **原因**：用戶反映 1.5 秒仍偏短，未能完整看到進度條動畫流程（0% → ~92% 動畫約需 2.7 秒，1500ms 只能看到 ~50% 進度）
- **調整**：`app.js` `MIN_VISIBLE_MS = 1500 → 2500`（同步更新註解 + `docs/tunables.md` 對應條目 + Last Updated）
- **影響**：cache 命中場景會多等 1 秒（總共 2.5 秒），看到 ~83% 進度條，視覺感受更完整。第一次進入無快取場景仍不受影響（Cloud ready 約 2-3 秒，剛好覆蓋）
- **依規 §每次新增功能時的規範 第 8 條**：tunables.md 已同步更新

### 2026-04-25 — Boot overlay 一閃即逝修復（最短顯示 1500ms）+ 建立 docs/tunables.md
- **問題**：用戶反映 reload 後開機進度條「一閃就消失」，沒有完整流程。診斷後發現 `_dismissBootOverlay` 有 4 個觸發點，其中 `Phase 3 快取命中`（[app.js:2351](app.js:2351)）會在 cache 命中時 ~200ms 內觸發，進度條才從 0% 動畫到 ~10% 就被強制跳 100% → 150ms 後 fade out → **總顯示時間 < 500ms**
- **根因**：boot overlay 的「準備就緒」訊號（Phase 3 快取命中 / Cloud ready / 骨架模式）來得太快，沒有最短顯示時間保護。前次 deep link 修復路徑只覆蓋「reload 帶 query」，沒涵蓋此既有 UX 瑕疵
- **修復**：
  - `app.js` `_dismissBootOverlay()`：在 pending deep link 守衛之前加入 `MIN_VISIBLE_MS = 1500ms` 守衛 — 若距離顯示時間不足 1500ms，setTimeout 補足差額再隱藏
  - `index.html` L815：boot overlay `display=''` 之後立即記錄 `window._bootOverlayShownAt = Date.now()`
  - 用 `_bootOverlayMinVisibleTimer` 確保多次呼叫不會堆疊 setTimeout（race-safe）
- **設計要點**：
  - **守衛串聯順序**：minVisible → pending deep link → 正常隱藏。確保 cache 命中 + reload deep link 的場景都被正確處理
  - **第一次進入無快取場景不受影響**：Cloud ready 本來就要 2-3 秒，已超過 1500ms
  - **可調**：`MIN_VISIBLE_MS` 常數可調，建議 1200~2000ms 範圍（已登錄到 docs/tunables.md）

### 2026-04-25 — 建立 docs/tunables.md 設定總覽 + CLAUDE.md 維護規則 [永久]
- **動機**：專案內可調設定（timing / debounce / interval / limit / threshold）+ 加載順序 + 流程順序效果分散在多個檔案，沒有統一參考。修復或調參時容易遺漏依賴關係（如「A timeout 必須 < B timeout」）
- **新增檔案**：`docs/tunables.md`（11 大類初始登錄）
  - ⏱️ Timing：boot overlay (5 項) / route loading (2 項) / visibility (3 項) / LIFF (6 項) / instant save (5 項) / SW (1 項) / Firebase Auth (2 項)
  - 📦 Limit：image cache 150、realtime listener 500、blocklist log
  - 🚦 Threshold：profile 完整度 / 候補排序 / 統計判定 / claude-memory 清理閾值
  - 📚 Load Order：App.init Phase 0-3、script defer 順序、各 page 預載清單
  - 🔀 Sequence Effects：boot overlay 隱藏、visibility change、_confirmAllAttendance、registerForEvent、deep link 解析
  - 🏷️ Versioning：0.YYYYMMDD{suffix} 格式、4 處同步、獨立頁面例外
- **CLAUDE.md 同步更新**：
  - §架構文件：新增 docs/tunables.md 引用
  - §每次新增功能時的規範 第 8 條：新增「可調設定 / Timing / 順序變更同步維護」強制規則（修改 timing 常數、limit、threshold、加載順序、sequence effect 都必須同步更新 tunables.md）
  - 原第 8 條「權限系統同步維護」順延為第 9 條
- **維護規則**（寫在 tunables.md 末尾）：
  - 何時必須更新：新增/修改/刪除 timing 常數、改變流程順序、新增 page 載入清單、變更 timing 互相依賴
  - 何時不需要：純 bug 修復（不動 timing/順序）、文件拼字、模組搬移（檔案位置變更要同步「檔案位置」欄）
  - 同步義務：程式碼註解引用 tunables.md anchor 時必須確認 anchor 存在
- **教訓**：
  - 用戶這次抓到的「一閃即逝」其實是長期既有 UX 瑕疵，前次 deep link 修復後用戶才注意到。**修復不能孤立思考**，相關 timing 應該一起檢查
  - 散落的可調常數（如 `MIN_VISIBLE_MS = 1500`、`IDLE_EXIT_MS = 3000`、`5000` deep link timeout、`8000` 看門狗）有隱性依賴，集中文件化才能避免互相破壞

### 2026-04-25 — Reload 時 boot overlay 延後隱藏，消除「閃首頁→跳回」瑕疵
- **問題**：用戶在「活動詳情」「俱樂部詳情」「賽事詳情」「個人名片」等帶 `?event=` / `?team=` / `?tournament=` / `?profile=` query 的頁面按 F5 reload 時，APP 會先閃一下首頁再跳回原頁面，視覺感受不順
- **根因**：reload 時 boot overlay 隱藏的時機是「內容渲染完成」（`_contentReady = true` 時），但此時 deep link guard 還在解析 URL 並準備跳轉。順序：
  1. boot overlay 顯示（含開機品牌圖 + 進度條）
  2. 預設 `currentPage = 'page-home'` → 首頁渲染完成
  3. `_contentReady = true` → boot overlay 隱藏 ← **此時 deep link 還在處理**
  4. 用戶看到首頁 0.5 秒
  5. Deep link guard 完成解析 → 跳轉到原頁面
  6. 用戶看到「跳回」動作
- **方案取捨**：
  - 方案 A（清掉 deep link query）：1 行修復，但會破壞所有 LINE 分享連結，**致命副作用，否決**
  - 方案 B（路由提前到「跳過首頁直接 render 原頁面」）：要動 `App.init()` 流程，動到全域狀態初始化來源，風險中
  - **方案 C（重用既有 boot overlay，延後隱藏時機）**：純利用既有資產，視覺效果跟「第一次進入 APP」完全一致，最終採用
- **修復**：3 處改動，全在 `app.js`：
  1. `_dismissBootOverlay()`（[L80-99](app.js:80)）：偵測到 `_hasPendingDeepLink()` 且未強制觸發時，延後隱藏 + 啟動 5 秒安全超時（避免 deep link 卡住永遠遮罩）
  2. 新增 `_hasPendingDeepLink()` helper：判斷 sessionStorage 4 個 `_pendingDeepXxx` key 任一存在
  3. 新增 `_dismissBootOverlayAfterDeepLink()`：清 timeout + 設 force flag + 觸發隱藏
  4. `_clearPendingDeepLink()`（[L898](app.js:898)）：sessionStorage 清完後若 boot overlay 處於延後狀態，立即強制隱藏（涵蓋成功跳轉、fallback、主動清除三種路徑）
- **關鍵設計**：
  - **時間戳/flag 雙保險**：`_bootOverlayDeferredHide`（避免重複設 timeout）+ `_bootOverlayForceDismiss`（避免無限遞迴）+ `_bootOverlayDeferredTimeout`（5 秒兜底）
  - **5 秒超時**：比看門狗 8 秒短（[index.html:931](index.html:931)），確保 deep link 失敗時還是會顯示首頁，看門狗才不會誤觸發
  - **集中於 `_clearPendingDeepLink`**：所有清 sessionStorage 的路徑（`_completeDeepLinkSuccess` / `_completeDeepLinkFallback` / 主動 clear）都會經過它，hook 一處 cover 全部
- **教訓**：
  - 用戶的「重新整理閃首頁」瑕疵感本質是「boot overlay 隱藏太早」+「deep link 解析延遲」的時序不同步，不是路由邏輯本身有錯
  - 重用既有 UI 元件（boot overlay 進度條、開機品牌圖）比新做一個成本更低、UX 更一致

### 2026-04-25 — 全站「地區」picker 統一資料源 + UI 邏輯（4 表單共用 fuzzy match + 23 項含「其他」）
- **變更**：個人資料初次登入 / 個人資料編輯 / 俱樂部新增 / 賽事新增 4 個地區 picker 統一使用同一套資料 + 模糊搜尋
- **動機**：用戶要求「都統一個人資料那一套」、4 個地方各自實作不同（清單長度、排序、匹配演算法、UI 不一）
- **實作**：
  - `config.js`：
    - `TW_REGIONS` 順序改為 6 都優先（與 first-login 一致）
    - 新增 `TW_REGIONS_WITH_OTHER = [...TW_REGIONS, '其他']`（給 4 個表單使用）
    - 新增 `filterTwRegions(keyword, includeOther)` 共用函式（fuzzy match + 臺/台互通）
  - `profile-form.js`：移除 `_FL_REGIONS` / `_flNormalize` / `_flFuzzy`（消除重複定義），`flRenderList` 改呼叫 `filterTwRegions(keyword, true)`
  - `profile-data-render.js`：`_filterProfileRegion` 改呼叫 `filterTwRegions(keyword, true)`、改回包含「其他」（之前不含、現在統一）
  - `team-form-init.js`：`_renderTeamRegionSuggest` 改呼叫 `filterTwRegions`、含「其他」
  - `team-form-validate.js`：驗證改用 `TW_REGIONS_WITH_OTHER`
  - `tournament-manage.js`：新增 `_onTournamentRegionFocus/Input/Blur` + `_renderTournamentRegionSuggest` + `_selectTournamentRegion`、加驗證
  - `tournament-manage-edit.js`：加同樣驗證
  - `pages/tournament.html`：`tf-region` 從 native datalist 改為 typeahead（仿俱樂部 pattern）
  - `pages/team.html` / `pages/tournament.html`：篩選器排序統一為 6 都優先（不含「其他」、22 項）
- **副作用**：俱樂部、賽事的「地區」也能填「其他」（用戶要求彈性）— 業務語意可能怪、但用戶決策
- **遺留**：`profile-data-render.js:189` 的 `var q = String(...).replace(/臺/g, '台')` dead code 因 Edit tool 對「臺」字編碼處理 bug 未清除、待獨立 PR 處理（無功能影響、每次呼叫多 < 1ms）

### 2026-04-25 — 建立流程的 modal 禁用「點外圍空白關閉」（避免誤觸丟失資料）
- **變更**：活動 / 外部活動 / 俱樂部 / 賽事 4 個建立 modal 加 `data-no-backdrop-close="1"`，點外圍空白處不會關閉、必須按表單內的「取消」/「儲存」按鈕
- **影響的 modal**：`create-event-modal` / `create-external-event-modal` / `create-team-modal` / `tournament-form-modal`
- **實作**：
  - `pages/modals.html` 的 `#modal-overlay` onclick 改為呼叫 `App._handleModalBackdropClick(event)` helper
  - `js/core/navigation.js` 新增 helper：檢查當前開啟的 modal 是否有 `data-no-backdrop-close="1"`、有就跳過 closeModal
  - 4 個 modal 元素加屬性
- **設計考量**：
  - 不影響現有「按 X / 取消 / 儲存」按鈕的關閉路徑（這些直接呼叫 closeModal、不走 backdrop click）
  - 不影響其他 modal（如分享面板、確認彈窗）的「點外圍關閉」UX 慣例
  - 沒動鎖定機制（first-login-modal 的 `dataset.locked` 仍獨立運作）

### 2026-04-25 — 俱樂部表單地區改為 typeahead 下拉（強制 22 縣市格式）
- **變更**：`ct-team-region` input 改為「點擊展開 / 輸入模糊查找」的 combobox、必須從 TW_REGIONS 22 縣市選擇
- **實作**：
  - `pages/team.html`：region input 加 `position:relative` wrapper + `#ct-team-region-suggest` dropdown；同步擴充 `team-region-filter` 篩選器為 22 縣市
  - `team-form-init.js`：加 5 個 handler（`_onTeamRegionFocus/Input/Blur` + `_renderTeamRegionSuggest` + `_selectTeamRegion`）；`_resetTeamForm` 重置 suggest
  - `team-form-validate.js`：region 必填 + 必須在 TW_REGIONS 內（防止舊版自由文字格式不一致）
- **設計細節**：
  - 用 `onmousedown="event.preventDefault();App._selectTeamRegion(...)"` 而非 `onclick`，避免 input blur 在 click 之前關閉 dropdown
  - blur 後 setTimeout 200ms 才隱藏（fallback 雙保險）
  - `escapeHTML` 處理選項顯示文字（雖然 TW_REGIONS 是常數、防禦性習慣）
- **副作用**：歷史資料 region 若不在 22 縣市內（例：「台中」缺「市」），編輯模式儲存時會被驗證擋住、提示用戶重選 — 視為資料規範化的合理代價

### 2026-04-25 — 俱樂部 / 賽事 sport filter 切換不生效修復（3 個 bug 一併處理）[永久]
- **問題**：用戶切頂部全域 sport picker 後、列表沒過濾、仍顯示其他運動的俱樂部
- **實測證據**（用戶開 `localStorage._sportDebug='1'` 後切換 picker）：
  ```
  all → football:    teamDomCount 6 → 5 ✅
  football → pickleball: teamDomCount 5 → 5 ❌（應該 0、資料只有 5 football + 1 dodgeball）
  ```
- **3 個 bug**：
  1. **Promise.all closure stale value**（主因）— `team-list-render.js` 的 `renderTeamList` 在背景載入教育俱樂部學員數的 `Promise.all().then()` 內、用閉包過時的 `activeTeamSport` / `typeTab` 重繪 DOM。race 流程：切 football → 啟動 Promise → 切 pickleball → render 寫 0 個 → football 那輪 Promise resolve 用閉包 'football' 覆寫成 5 個足球 → 看起來像「沒過濾」
  2. **`renderAdminTeams` / `renderTeamManage` 缺 sport filter**（次要）— 管理頁不尊重全域 picker
  3. **`tournament-render.js` 的 sport filter 依賴 `hostTeam` 反查**（次要）— 若 hostTeam 快取未載入會誤隱藏（不是「顯示錯」、是「該顯示沒顯示」）
- **修復**（commit TBD、版號 TBD）：
  1. `Promise.all().then()` 內**重新讀取「當下」的 sport / typeTab**（用 `_getActiveTeamGlobalSport()` 直接取，不呼叫會改 DOM 的 `_syncTeamSportFilterWithGlobal`、避免背景 callback 副作用 — QA agent 建議）
  2. `renderAdminTeams` / `renderTeamManage` 加 `_getActiveTeamGlobalSport()` filter；`theme.js` 切 sport 時觸發這兩頁的重繪
  3. `tournament-render.js` 加 `t.sportTag` 優先讀（為未來資料結構升級鋪路）+ `hostTeam` 不存在時**保留賽事**（保守、寧可誤顯示也不誤隱藏；補註解說明）
- **教訓**：
  - **背景 Promise 的 `.then()` callback 不能用閉包擷取的「外部狀態」做關鍵決策**（render filter / 寫 DOM），必須在 callback 內重新讀取「當下狀態」
  - 用戶實測 log（`_sportDebug` localStorage flag）是定位 race condition 的關鍵 — 否則純讀程式碼推論不出來
  - QA agent 對「Promise.then 內 DOM 副作用」的指正是必要的（雖然當前情境風險低、但代碼意圖更清晰）
- **3 輪審計流程**：自我審計 → Explore agent 找 3 個 bug 候選 → 用戶實測 picker 確認真因 → 修 → QA agent CONDITIONAL GO + 2 項採納

### 2026-04-25 — fetchIfMissing short-circuit 缺陷修復（活動名單載入 500-4000ms → < 50ms）[永久]
- **問題**：用戶透過 `localStorage._perfAttLog='1'` 實測活動詳情頁報名名單、15 次進頁數據顯示 `fetch_ms` 佔總延遲 99%（500-4000ms 不等），其他段（summary/noshow/rows/html_bind）全部 < 3ms
- **根因**：`fetchAttendanceIfMissing` / `fetchRegistrationsIfMissing` 的 short-circuit 條件寫錯
  - 原邏輯：`if (cached.length > 0) return;` 只有「該活動有紀錄」才短路
  - Bug：對「未開始活動」（必無簽到）或「熱門活動不在 onSnapshot limit 前 500 筆」的情境，cached 永遠是 0 → **每次進頁都觸發真 Firestore query**（即使是同一活動連續 3 次）
- **修復（方案 D）**（commit `c4a62dc3`、版號 `0.20260425b`）：
  - `fetchAttendanceIfMissing`：加 `_fetchedAttendanceIds` Set 去重 + 未結束活動（`status !== 'ended' && status !== 'cancelled'`）**直接信任快取空值不 fetch**（因簽到記錄必然少於 500 limit）
  - `fetchRegistrationsIfMissing`：**只用 Set 去重**（不看 status，因 registrations 熱門活動可能超 limit）
  - 兩者 `_docId` 缺失加 warn log（P13 審計建議）
  - `catch` 分支：`err.code === 'permission-denied' / 'unauthenticated'` 時**標記 Set 避免無限重試**（QA BLOCKER 修正；網路錯誤保留不標記、允許重試）
  - 新增 19 個單元測試（`tests/unit/api-fetch-if-missing.test.js`）涵蓋 `decideAttendanceFetch` / `decideRegistrationsFetch` 決策樹 + `mergeDedupByDocId` 邏輯
- **審計流程**（3 輪）：
  1. 計畫書草稿（`docs/fetch-if-missing-fix-plan.md` v1）列出 10 項自我瑕疵
  2. 第三方 agent 審計找出 5 項新瑕疵（P11-P15），經驗證 4 項為誤判（Firestore docId 固定機制、CF schedule 5 分鐘實測誤讀），僅 P13 採納
  3. 實作後 QA agent 給 CONDITIONAL GO，2 項必修採納後 commit：catch 錯誤處理 + status 判斷邊界註解
- **更新 2026-04-23 教訓**：當時標記「fetchIfMissing 有短路、通常不慢」的結論是基於「活動已有紀錄」的假設，不適用於未開始活動（cached 永遠 0）。本次透過實測 log 打破假設 → **「先實測再優化」的教訓再次驗證，但也要注意實測條件要完整涵蓋各 status 的活動**
- **預期效果**：未結束活動（絕大多數情境）載入從 500-4000ms → < 50ms；已結束活動第一次進頁仍需 fetch、但後續進頁 Set 去重後 < 50ms
- **驗證方式**：`localStorage.setItem('_perfAttLog','1')` 啟用效能 log、進活動頁看 Console `[att-perf]` 輸出 `fetch_ms`
- **回退**：git revert 秒回退（單檔 2 函式、無 Rules / CF 變更、無持久化狀態殘留）

### 2026-04-25 — LINE WebView 編輯模式「勾選消失」bug + 離開瀏覽器自動退出編輯
- **問題**：管理員在活動詳情按「編輯」勾選部分成員簽到後，切離 LINE 瀏覽器一段時間再回來按「完成」，**原本勾選的狀態全部消失**
- **根因（深度審計後確認）**：並非寫入失敗而是「UI 重繪時機 + 快取同步空窗」
  1. Instant-save 於勾選後 300ms debounce 寫 Firestore，但 `visibilitychange=hidden` 時 `_suspendListeners` 停掉 attendanceRecords listener
  2. 若 300ms 內切走、WebView 凍結 setTimeout → debounce 永遠不 fire → Firestore 根本沒紀錄
  3. 即便寫入成功，回前景時 `_handleVisibilityResume` 只刷新 events + registrations、**沒刷新 attendanceRecords**
  4. `_debouncedSnapshotRender('registrations')` 的 `else` 分支會連帶重繪 attendance table、**且該分支無編輯模式守衛**（`source='attendance'` 才有守衛）→ 用過時快取重繪 → checkbox 全部變 unchecked → 用戶看到「勾選消失」
- **方案取捨**：
  - 方案 A（改 `_debouncedSnapshotRender` 加編輯守衛）：1 行修復，但要動核心渲染邏輯
  - 方案 B（離開 ≥ 3 秒自動退編輯 + flush）：新增獨立模組，不動核心邏輯、附帶解決「主辦人忘記關編輯」與「多人編輯衝突」
  - 最終採用 B，因為 instant-save 已保證寫入，退出編輯對用戶體驗無實質損失，且方案邊界更清晰
- **修復**：
  - 新增 `js/modules/event/event-manage-visibility.js`：
    - `visibilitychange=hidden` → flush pending debounce + 記時間戳
    - `visibilitychange=visible` 且離開 ≥ 3 秒 → 呼叫 `_autoExitDetailEdits()`（重用 2026-04-23 切頁 helper）+ 重繪表格 + toast 提示
    - `pagehide` 兜底（iOS / LINE WebView 有時跳過 hidden 直接 pagehide）
  - `js/core/script-loader.js`：event-manage-waitlist 後註冊新模組
  - `docs/architecture.md`：event/ 模組清單更新
- **關鍵設計決策（審計結果）**：
  1. **禁用 setTimeout(3000)**：Chrome/Safari/LINE WebView 背景時行為不一致（凍結 / throttle / suspend），回前景可能瞬間補 fire 造成瞬退。改用 hidden 記時間戳、visible 判斷差值
  2. **提交中不退出**：`_attendanceSubmittingEventId` 不為 null 時 skip，避免打亂 `_confirmAllAttendance` 原子寫入
  3. **3 種編輯狀態一起處理**：正取 + 未報名 + 候補（重用 `_autoExitDetailEdits`）
  4. **退出後必須重繪**：只清 `_attendanceEditingEventId` 不會重繪，會造成 UI 停留在編輯樣式但內部狀態已清
  5. **3 秒閾值**：擋掉 iOS Face ID / 下拉通知中心等誤觸發（< 3 秒），接電話 / 回 LINE 訊息超過 3 秒會退出（可接受，因資料已 instant-save 無損失）
- **教訓**：
  - 用戶報修 bug 時「勾選消失」這個詞是精準線索，不要套用自己的推論（我第一輪審計誤判為「寫入失敗」浪費分析時間）
  - `setTimeout` 跨越 hidden/visible 邊界在不同瀏覽器不一致，儘量改用時間戳比較
  - 既有 `_autoExitDetailEdits`（2026-04-23 切頁情境）的設計可直接重用，不要重複實作

### 2026-04-24 — 俱樂部列表切換運動仍顯示足球俱樂部
- **問題**：頂部 sport picker 已切到其他運動時，俱樂部列表仍可能被頁內 `team-sport-filter` 的舊值（常見為 `football`）拉回足球俱樂部。
- **原因**：`renderTeamList()` 使用 `App._activeSport`，但搜尋/類型 tab 會走 `_doFilterTeams()`，後者優先讀頁內 select；全域切換時沒有同步這個 select，造成兩套 sport state 分裂。
- **修復**：新增 `_syncTeamSportFilterWithGlobal()` / `_resolveTeamSportFilterSync()`，全域切換時強制同步頁內 sport filter；`renderTeamList()` 與 `_doFilterTeams()` 改用同一套 effective sport，並把 `sportTag` 納入列表指紋。
- **教訓**：同一頁若同時有全域 filter 與頁內 filter，必須明確定義同步/覆寫規則，否則任一 debounced filter 或 realtime re-render 都會把 UI 拉回舊狀態。

### 2026-04-23 — 活動分享「複製連結」改走 toosterx.com OG URL [永久]
- **變更**：活動分享底部選單的「複製連結」選項改為複製 `https://toosterx.com/event-share/{id}`（OG 中繼頁），`LINE 好友` / `LINE 群組` 仍維持 Mini App URL
- **理由**：用戶 UX 決議 — 貼到 FB / IG / Twitter / Telegram 時顯示活動封面 OG 卡片；Mini App URL 被社群平台爬蟲視為 redirect 無法解析 OG tags
- **實作**：
  - `js/modules/event/event-share.js`：`_doShareEvent` / `_doShareExternalEvent` 的 `choice === 'copy'` 分支用 `_buildEventShareOgUrl(eventId)` + `_buildEventShareAltText(e, copyUrl)` 組新 altText
  - `js/modules/event/event-share-builders.js`：`_buildExternalEventShareAltText` 新增 optional `urlOverride` 參數（backward compat）
  - `_buildEventShareOgUrl` 早已存在、直接重用
- **CLAUDE.md 規範更新**：§分享功能設計規範第 1 條鬆綁「複製連結」例外、其他實體若要同例外需各自新增 OG URL 建構器 + CF OG 路由
- **教訓**：實作前先搜既有 helper（`_buildEventShareOgUrl` 已存在、原本白走一圈多寫 `_buildEventCopyUrl`）

### 2026-04-23 — 活動詳細頁：離開時自動退出編輯模式
- **問題**：管理員在活動詳細頁按「編輯」後切分頁（或 browser back）再回來，仍停在編輯模式，需手動按「完成」才能退出
- **修復**：
  - `js/modules/event/event-manage.js` 新增 `_autoExitDetailEdits()` — 清三種編輯狀態 + flush 剩餘 debounce：
    - 正取名單（`_attendanceEditingEventId`）：`_flushInstantSaves` fire-and-forget + 清狀態 + `_cleanupInstantSave`
    - 未報名掃碼（`_unregEditingEventId`）：同上 with unreg 變體
    - 候補名單（`_waitlistEditingEventId`）：僅清狀態（候補編輯無待存資料、升級/下放都是 immediate write）
  - `js/core/navigation.js` `_cleanupBeforePageSwitch` 離開 `page-activity-detail` 分支呼叫此 helper
- **設計要點**：
  - Fire-and-forget：`_flushInstantSaves` 內的 DOM 讀取發生在第一個 await 前（同步），`_activatePage` 只 toggle `.active` class 不移除節點，DOM 在 cleanup 當下仍可讀
  - 不動 CLAUDE.md 鎖定檔 `event-manage-confirm.js`（`_confirmAllAttendance` 是鎖定函式）
  - 靜默儲存、不顯示 toast（切頁中跳 toast 體驗怪）
  - `goBack()` 也走 `_cleanupBeforePageSwitch`，browser back 同樣覆蓋
- **教訓**：instant save（每次勾選 300ms debounce 自動寫入）已讓「完成」變成幾乎沒東西要存的收尾動作、天然適合做 auto-exit

### 2026-04-23 — 正取名單兩段式 render 回滾（效益誤判）[永久]
- **背景**：d07e43d3 將 `_doRenderAttendanceTable` 改為兩段式 render，預期把 330-990ms 首見時間壓到 < 50ms
- **回滾原因（實際效益遠小於原分析）**：
  - `_buildRawNoShowCountByUid` **不是**即時跨活動 scan、而是讀 `users.noShowCount` 欄位（排程 CF `calcNoShowCounts` 預先計算並寫入）— 零 I/O
  - `fetchAttendanceIfMissing` / `fetchRegistrationsIfMissing` 有 `if (cached.length > 0) return` 短路、只有超過 listener 限制（500 筆外的老活動）才真的 fetch
  - 正取與候補實際差距只有 ~100-200ms、主要來自 100ms 防抖 + HTML 複雜度（打勾 / 未到圖示），不是當初宣稱的 330-990ms
- **取捨**：
  - 99% 情境（現役活動快取命中）→ 兩段 render 幾乎零收益、多一次 DOM 替換的微小成本
  - 1% 情境（超過 listener 限制的老活動）→ 有收益、但使用頻率低
  - 複雜度代價：`_doRenderAttendanceTable` 變 dispatcher + `_renderAttendanceTableSync` 兩層、QA 已抓到 `_lockContainerHeight` 過期的 race（已修但代表這種改法容易出錯）
- **教訓（最重要）**：
  - **優化前必須先實測 bottleneck 位置、不能只靠程式碼閱讀推論**。我把「await Promise.all 看起來很慢」直接當成慢因，沒注意 `fetchIfMissing` 的短路、也沒注意 `calcNoShowCounts` 是排程 CF
  - **預計算欄位的存在**：`users.noShowCount`、`users.*Count` 都是 CF 預計算、不要當作即時查詢
  - **cache-first 的 API 層通常不慢**：`ApiService.fetch*IfMissing` 系列都有快取短路、await 它們不會真的 I/O
  - 下次類似觀察（「A 比 B 快」）時、先加 `performance.mark` 實測、再動手優化
- **回滾動作**：`git revert d07e43d3` + 版號 0.20260423b → 0.20260423c（舊版號已發佈、回滾必須換新版號以觸發 SW 更新）

### 2026-04-22 — 活動月曆視圖實作（3 新模組 + 5 既有檔 8 處 rerender 分支）[永久]
- **實作**：活動頁新增第 3 種 tab「月曆」，按運動色區分、上下滑切月、置頂高光
- **新檔（3 個）**：
  - `js/modules/event/event-calendar-constants.js`（110 行）— SPORT_COLORS × 16、WEEK_DAY_NAMES、MONTH_FORMATTER、`toDateKey()`、`dateObjToKey()`、`getMonthGridShape()`
  - `js/modules/event/event-list-calendar.js`（105 行）— 主入口 `_renderActivityCalendar` + shell + 月份視窗管理
  - `js/modules/event/event-list-calendar-build.js`（195 行）— DOM 建構：月份 section / 日期格 / 活動格 / group by date
  - `js/modules/event/event-list-calendar-nav.js`（139 行）— 月份切換、IntersectionObserver、鍵盤導航、+N 跳 timeline
  - `css/calendar.css`（316 行）— `.evt-cal-*` 命名空間（非 `.calendar-*` 避免全域污染）
- **既有檔改動（5 檔 8 處 rerender 分支）**：
  - `js/firebase-service.js` L201 — onSnapshot 補月曆 render（calendar-view-plan §12.C）⚠️ 鎖定檔例外：本次是分支新增、不動鎖定函式邏輯、見下方「鎖定檔例外」
  - `js/core/theme.js` L73 + L190 — setActiveSport 與 filter-bar 3 handler 補月曆 rerender（§12.D + §12.O）
  - `js/modules/event/event-list-helpers.js` L310 — switchRegionTab 補（§12.D）
  - `js/modules/event/event-manage.js` L448 — toggleMyActivityPin 補（§12.E）
  - `js/core/navigation.js` L704-706 — `_renderPageContent('page-activities')` 返回頁時補（§12.M）
  - `js/modules/event/event-list.js` — `_setActivityTab` 擴充 3rd tab 'calendar' + `_loadAndRenderCalendar` lazy-load
  - `js/modules/event/event-list-timeline.js` L217 — 加 `data-date-anchor` padded `YYYY-MM-DD`（月曆 +N 跳轉用）
- **關鍵實作決議**：
  1. **Lazy-load 方案 A**：`script-loader.js` 新增獨立群組 `activityCalendar`（不進 `_pageGroups['page-activities']`），`_setActivityTab('calendar')` 首次觸發時動態載入
  2. **CSS 命名空間 `.evt-cal-*`**：避免與既有 `.timeline-calendar`、未來 `.calendar-*` 衝突
  3. **日期 key padded**：`toDateKey('2026/5/1 19:30~21:00')` → `'2026-05-01'`（與 `data-date-anchor` 一致）
  4. **pinned 沿用 truthy**：`e?.pinned` 不用 `=== true`（與全站一致 `event-list.js` L87、`event-list-timeline.js` L223 等）
  5. **可見性過濾用 `_getVisibleEvents()`**：已內建 `_isEventVisibleToUser` + `privateEvent` + `_canViewEventByTeamScope`，月曆**不需**再呼叫 `_isEventVisibleToUser`
  6. **資料庫 / Rules / CF 零改動**：events read 本為 `allow read: if true`、月曆純讀
- **鎖定檔例外記錄**：本次修改 `firebase-service.js` L201（CLAUDE.md 外科手術鎖定範圍內）僅新增 1 行 render 分支，不動 `ensureUserStatsLoaded` 等鎖定函式本體。**合理例外**理由：onSnapshot render dispatch 必須涵蓋月曆 tab、否則 realtime 更新失效（calendar-view-plan §12.C 已預先記錄）
- **教訓**：
  - 計畫書充分審計（v1-v9 共 9 輪）+ 對照既有程式碼的 v6/v7 是最有效的瑕疵攔截手段
  - 既有模組的 rerender 分支散佈點比想像中多（5 檔 8 處、全靠對照 `renderActivityList` 的呼叫點抓出）
  - 單檔 300 行上限：初版一檔 466 行、Phase 2 拆 build/nav 後全在 300 以內

### 2026-04-22 — 版號格式升級為 0.YYYYMMDD{suffix} + app.js 硬編碼 v0. bug [永久]
- **變更**：版號格式從 `YYYYMMDD{suffix}` 升級為 `0.YYYYMMDD{suffix}`（用戶要求）
- **bump-version.js 改動**：
  - regex `/^(\d{8})(.*)$/` → `/^0\.(\d{8})([a-z]*)$/`
  - 不符新格式時自動升級（舊版號視為需重置為今天）
  - 跨日重置邏輯保留：`today > date` → `0.今天無後綴`
- **關聯 bug**：`app.js` L378 硬編碼 `'v0.' + ver` 用於首頁底部版號顯示
  - 舊版號 `20260422a` 加 `'v0.'` 剛好是 `v0.20260422a`（合理）
  - 新版號 `0.20260422a` 加 `'v0.'` 變 `v0.0.20260422a`（多一個 `0.`）
  - 修復：`'v' + ver`（`kickball-game-page.js` L248 早就這樣寫是對的）
- **教訓**：任何硬編碼的版號前綴 / 格式字串都是未來 bug 源。若需顯示格式，讓版號自己包含完整形式，顯示端只加最簡單的 `v`

### 2026-04-22 — Drawer 分區機制：super_admin vs admin 項目會被自動 divider 分開 [永久]
- **機制**（`js/modules/role.js` L249-256 `renderDrawerMenu`）：
  - `drawer-role-super`（super_admin，level ≥ 5 **或** `highlight='red'`）→ 粉紅底
  - `drawer-role-admin`（admin，level 4）→ 藍底
  - 相鄰項目 role 不同且兩者都 ≥ admin → 自動插 `<div class="drawer-divider">`
  - 例外：兩者 bgClass 都是 `drawer-role-super`（bothRed）跳過 divider
- **應用**：若希望 admin 項目與 super_admin 項目在 drawer 中同區顯示（無分隔），給 admin 項目加 `highlight: 'red'`
- **首案例**：SEO 儀表板（minRole: 'admin'）加 `highlight: 'red'` 與數據儀表板（minRole: 'super_admin'）合併同區
- **不影響權限**：highlight 只影響視覺，minRole / permissionCode 仍是真正的權限控制

### 2026-04-22 — DRAWER_MENUS i18nKey 未翻譯會直接顯示 key 字串
- **現象**：新增 DRAWER_MENUS 項目時若 `i18nKey` 指向不存在的 key（例：`'admin.seo'`），UI 會顯示 `admin.seo` 字面字串
- **教訓**：新增 drawer 項目時必須在 `js/i18n.js` **6 個語言**（zh-TW/en/ja/ko/th/vi）全部新增對應翻譯
- **驗證指令**：`grep -nE "'i18nKey值':" js/i18n.js | wc -l` 應 = 6

---

> **維護規則**：
> - 新紀錄一律寫在檔案前方，採新到舊排序
> - `[永久]` 標記的條目為系統性教訓，永不過期
> - 一般條目超過 30 天且無持續參考價值時可清除
> - 同主題多次迭代合併為一筆（保留最終結果）
> - 純功能新增（可從 git log 得知）不記錄
> - 總行數超過 500 行時觸發清理

### 2026-04-21 — Firestore `synchronizeTabs` 回滾：false → true（費用優化） [永久]
- **時間軸**：
  - 4/17 改為 `false`（commit 6e0daede）— 消除「多 tab 權限加載卡住」bug
  - 4/18 Firestore 讀取量爆增至 **468 萬/天**（+50%）→ 全月最高峰
  - 4/21 回滾為 `true`（本條目）— 搭配既有 multi-tab-guard 警告承擔原 bug 防護
- **根因**：`synchronizeTabs: false` 時第 2+ tab 無 IndexedDB 快取，每次 onSnapshot 重連（切 tab / 背景喚醒 / 網路波動）都從 Firestore 全量重抓（events+registrations+attendanceRecords ≈ 4,600 reads/reconnect/user）
- **費用影響**：4 月 21 天 Firestore Read Ops **4,029 萬次 / NT$753**（含所有其他 Firestore SKU 共 ~NT$790）
- **回滾決策**：
  - 回到 `synchronizeTabs: true`（多 tab 共享 IndexedDB，省 reads）
  - 保留 `multi-tab-guard.js`（警告彈窗 + 關閉分頁按鈕）擔任原 bug 防護
  - 不強化 guard（BroadcastChannel 在 PWA + LIFF 多 context 有偵測盲區，強化也擋不住）
- **禁止再改回 `false`**：
  - 除非找到完整替代方案（例如全量遷移 modular SDK + `persistentMultipleTabManager`）
  - 但全量遷移違反 CLAUDE.md 鎖定函式保護規則（會動到 `firebase-crud.js` 的報名/候補/簽到核心），不值得
- **監控**：
  - 部署後第 1/3/7 天跑 BigQuery 查 Firestore Read Ops 趨勢
  - 預期每日讀取量降至 **< 100 萬/天**（原 ~192 萬/天）
- **回退條件（若原 bug 復發）**：
  - 🔴 立刻回退：console 出現「權限加載卡住」相關錯誤、或用戶回報 LIFF session 錯亂
  - 🟡 一週內評估：讀取量仍 > 150 萬/天（表示還有其他元凶，需進一步調查）
- **不動範圍**：multi-tab-guard.js / base.css / 鎖定函式 / 報名邏輯 / 統計系統 / LIFF / Service Worker 全部不動

### 2026-04-20 — GCP 帳單「App Engine」分類實為 Firestore Read Ops（認知陷阱，勿再誤判） [永久]
- **現象**：GCP Billing Console / Firebase 儀表板（dashboard-usage.js）顯示專案有「**App Engine**」費用
  - 3 月 NT$245.99，4 月 21 天即 NT$789.88（佔總費用 54%）
  - 會讓人以為有 App Engine 實例、Gen 1 舊函式殘留、或神秘扣款
- **事實**：專案**完全沒有 App Engine 應用實例**，所有 34 個 Firebase Functions **全部都是 Gen 2**
  - `gcloud app describe --project=fc-football-6c8dc` 回 `Apps instance not found`
  - `gcloud app services list` 同樣 not found
  - `firebase functions:list` 輸出全部標記 `v2`
- **真兇**：GCP Billing Export 的 `service.description = "App Engine"` **包含所有 Firestore SKU**（歷史分類殘留——Firestore 原名 Cloud Datastore，是 App Engine 的一部分，升級為獨立產品後帳單分類名稱未更新）
- **驗證方法**（以後遇到此類疑問必用）：
  ```sql
  bq query --project_id=fc-football-6c8dc --use_legacy_sql=false --nouse_cache <<'EOF'
  SELECT invoice.month AS month, sku.description AS sku_name,
    ROUND(SUM(cost), 2) AS cost_twd,
    ROUND(SUM(usage.amount_in_pricing_units), 0) AS usage_amount, usage.unit AS unit
  FROM `fc-football-6c8dc.billing_export.gcp_billing_export_v1_017F3E_4F4035_320E24`
  WHERE project.id = 'fc-football-6c8dc' AND service.description = 'App Engine'
  GROUP BY month, sku_name, unit HAVING cost_twd > 0
  ORDER BY month DESC, cost_twd DESC
  EOF
  ```
  結果全部 SKU 都叫 `Cloud Firestore Read Ops` / `Cloud Firestore Internet Data Transfer` / `Cloud Firestore Zonal Backup Storage` / `Cloud Firestore Point-in-time Recovery Storage`
- **其他相關事實（調查時順便確認）**：
  - Firestore 資料庫位於 **`us-central1`**（美國愛荷華；建立時預設，無法遷移；所有讀取跨洋 150-200ms 延遲）
  - Firebase Functions / Storage 在 `asia-east1`（台灣）
  - Cloud Scheduler 4 個排程全是 HTTP target（不經 App Engine）
  - BigQuery Billing Export 是 2026-03 才啟用，2 月以前只能在 Billing Console 網頁查
- **費用成長趨勢（至 2026-04-20）**：
  - 3 月全月：Firestore Read Ops 796 萬次 → NT$141
  - 4 月 21 天：**4,029 萬次 → NT$753（月增 5 倍）**
  - 爆量月實為 4 月，不是 3 月（3 月只是從 2 月低點起漲的過渡）
- **教訓與規則**：
  - **禁止直接信任** GCP / Firebase 儀表板的 `service.description` 分類（歷史名稱會誤導）
  - 看到「App Engine 費用異常」先假設是 **Firestore 讀取爆量**，不要先懷疑 App Engine / Gen 1 殘留
  - 要精準分析費用**只能**查 SKU 層級（BigQuery Billing Export 或 GCP Billing Console 的 Group by SKU）
  - dashboard-usage.js 的 `costByService` 欄位同樣是 GCP 原始 `service.description`，不要直接當成功能分類（例如「App Engine」那格就是 Firestore）

### 2026-04-20 — Firebase Callable Function 呼叫雙陷阱（一天內犯兩次） [永久]
- **陷阱 1：前端呼叫 CF 漏指定 region 導致 CORS 失敗**
  - 錯誤訊息：`Access to fetch at 'https://us-central1-.../recordUserLoginIp' ... blocked by CORS policy`
  - 根因：`firebase.functions().httpsCallable(...)` 預設連 `us-central1`，但本專案所有 CF 部署在 `asia-east1`
  - 修正：必須用 `firebase.app().functions('asia-east1').httpsCallable(...)`（與專案既有所有 CF 呼叫一致）
- **陷阱 2：CF 內用 `admin.firestore()` 但專案實際是 modular `db = getFirestore()`**
  - 錯誤訊息：`ReferenceError: admin is not defined at /workspace/index.js:XXXX`
  - 根因：`functions/index.js` 頂部已有 `const { getFirestore } = require("firebase-admin/firestore")` + `const db = getFirestore()`（modular v10+ 寫法）；套用標準 `admin.firestore()` 會找不到 `admin` 變數
  - 修正：CF 內 Firestore 操作一律用 `db.collection(...)`，禁用 `admin.firestore()`
- **共通教訓**：
  - 寫新 CF 前**必須**先看 `functions/index.js` 現有一個 onCall 函式的寫法當範本（命名空間、region、Firestore API）
  - 寫前端呼叫 CF 前**必須**先搜 `httpsCallable` 看既有怎麼寫（`firebase.app().functions('asia-east1')`）
  - 不要套用 Firebase 官方文件的「標準寫法」—— 本專案有自己的 convention
- **預防規則**：新增/修改 CF 時必檢查：①`region: "asia-east1"`設定 ②CF 內用 `db`（不是 `admin.firestore()`）③前端呼叫用 `firebase.app().functions('asia-east1').httpsCallable(...)`

### 2026-04-20 — Super_admin 隱身從「本地開關」升級為「目標用戶屬性」 [永久]
- **問題**：`super_admin` 的「隱身模式」只有「自己看自己的 3 個路徑」有效；其他用戶看你、你自己的「我的名片」頁、分享 Flex 卡片都仍顯示「總管」紅色膠囊
- **根因**：`_stealthRole(name, role)` 原邏輯讀「當前登入用戶自己的」`user.stealth`，別人的 stealth 永遠是 undefined → 別人看你時不套用
- **修復（架構升級）**：
  - `_stealthRole` 改為接受 `userOrUid` 參數，讀「**目標用戶**的 stealth」
  - `_userTag` L78 改為傳 `options?.uid` 讓 `_stealthRole` 優先 O(1) 查找
  - 短路優化：`role !== 'admin' && role !== 'super_admin'` 直接返回，避免 100 人名單中 99 次無謂查找
  - 補 2 個洩漏洞：`profile-card.js renderUserCard`、`profile-share.js _buildProfileFlexMessage`
- **連帶修復 Firestore Rules 持久化 bug**：`isSafeSelfProfileUpdate()` 白名單漏了 `stealth` 欄位 → 切換隱身時 Firestore 寫入被 Rules 靜默拒絕（`.catch(err => console.error)` 吞掉），只存 localStorage → 清快取/換裝置狀態丟失
  - 解法：白名單補 `stealth` + `bool` 型別檢查
- **drawer 身分膠囊刻意保留真實身分**：同時是開關（點擊切換），讓自己知道隱身狀態
- **教訓**：
  - 「隱身/偽裝」類功能的本質是「讓別人看你顯示為另一身分」，所以判斷依據必須是**目標用戶**屬性而非當前用戶屬性
  - 任何用戶屬性寫入路徑都要同步檢查 Rules 白名單是否允許（否則會靜默失敗）
  - `.catch(err => console.error)` 容易掩蓋 Rules 拒絕的 bug，必要時應改為 `console.warn` 並給出更明確訊息

### 2026-04-20 — 活動詳情頁「加載後跳回頂部」經典 async stale closure 陷阱（6 輪修復） [永久]
- **問題**：用戶進活動詳情頁幾秒後、滑到中間瀏覽名單時，畫面會被突然打回頂部；連續修 5 輪都沒根治，第 6 輪靠診斷 log 精準抓到真兇
- **真兇（Round 6 發現）**：`_doRenderAttendanceTable` 是 async 函式，流程：
  1. 函式入口記錄 `_savedScrollY = _scrollEl.scrollTop`（用戶剛進頁 = 0）
  2. `await Promise.all([fetchAttendanceIfMissing, fetchRegistrationsIfMissing])` 期間用戶滑到 490px
  3. render 完成後 `_scrollEl.scrollTop = _savedScrollY` = 0 → 把用戶從 490 打回 0
  - **這是經典 stale closure 陷阱**：async 函式入口記錄的 state，在 await 後已過時但被用來覆寫當前狀態
- **修復歷程（6 輪，每一輪都看似命中但都不徹底）**：
  - Round 1 (`20260420f`, commit c367d17b)：retry/safety net 改走局部 patch（不整頁重繪）
  - Round 2 (`20260420g`, commit 26031601)：`_activatePage` 同頁 activate 時不 reset scroll
  - Round 3-4 (`20260420j/k`, commit 5e6f8a51 / 29e6ec52)：加診斷 log（`_runPageScrollReset` stack trace + window.scrollTo / Element.scrollTop setter monkey-patch，僅 `?debug=1` 啟用）
  - Round 5 (`20260420l`, commit 4449a138)：
    - **Height Lock**：新增 `App._lockContainerHeight(container)` helper，3 個 render 函式入口加 1 行防 DOM 替換造成 scrollHeight 縮短 clamp
    - **Page Lock**：進 detail 類頁設 10s 鎖，非用戶近期（800ms）touch/click 的 showPage 擋下（保留 `bypassPageLock` 逃生口；goBack 不走 showPage 不受影響）
  - Round 6 (`20260420m`, commit a4eedeb9)：**移除 `_doRenderAttendanceTable` 的 scrollTop 還原陷阱**（L152 + L297），信任 Height Lock 防 clamp
- **最終四層防護網**：
  1. Height Lock — 防瀏覽器 DOM 替換 clamp scrollTop
  2. **移除 scrollTop 還原**（Round 6，真正根治）— 防 async stale closure
  3. Page Lock — 防自動機制拉走用戶（deep link poller / pending route 等）
  4. `_activatePage` 同頁不 reset — 防同頁 showPage 觸發 reset
- **同步函式 vs async 函式**：
  - `_renderUnregTable` / `_renderGroupedWaitlistSection` 是**同步**（無 await）→ 無 stale closure 問題 → scroll 還原保留作為 Height Lock 失效時的 fallback
  - `_doRenderAttendanceTable` 是 async（有 `await Promise.all([...])`）→ 有 stale closure 問題 → 還原必須移除
- **關鍵教訓**：
  - **async 函式中記錄 state 再於 await 後覆寫，必定是 bug**（stale closure）。若真需要還原，要在 await 後**重新讀取當前值**或加條件判斷（例如「只在縮小時還原」）
  - **診斷 log 的戰略價值**：5 輪盲修無效，Round 3-4 加 scroll monkey-patch（`?debug=1`）後 Round 6 一擊即中。**複雜的 scroll / 導航 bug 第一步就該加診斷工具**
  - **為什麼反覆修不乾淨**：每輪都只看到「症狀」（整頁重繪、Background reload、同頁 reset 等），沒看到真正的「async state 污染」源頭。每修一層都讓 bug 表象減少但殘餘
  - **Height Lock 的戰略地位**：Round 6 敢移除 scrollTop 還原，是因為 Round 5 的 Height Lock 先做好了 clamp 保護。**兩個修法必須成對存在**（移除還原 depends on Height Lock）
  - **防禦性設計模式**：Height Lock（DOM 層）+ Page Lock（導航層）+ Scroll-trace 診斷（debug 層）+ 主動 touch 感知（UX 層）= 完整保護
- **反覆提到的「被拉回」老 bug**：
  - 多次修復紀錄分別見 commits ce987791 / 96458bb6 / aca6a444（showPage 守衛）
  - Page Lock 是最新的統一防線（10 秒鎖 + 用戶主動感知）
- **部署狀態**：
  - 前端：Cloudflare Pages 自動（main branch push）
  - 診斷 log 保留在生產（Round 3-4），供未來偶發問題再診斷；`?debug=1` 才啟用 monkey-patch，一般用戶零影響
- **回退安全性**：
  - Round 6 可獨立 revert（只回到 async bug 狀態）
  - Round 5 Height Lock 不可單獨 revert（會讓 Round 6 失去保護）
  - 其餘修法皆可獨立 revert

### 2026-04-20 — 活動黑名單功能（Phase 1-6 + 二次審計 + 選項 B 完成） [永久]
- **需求**：管理員可將特定用戶加入活動黑名單，使其看不到該活動（僅擋尚未報名的，已報名的保留可見以尊重歷史）
- **核心設計決策**：
  - 黑名單只擋「尚未報名」的活動，曾有任一 registration 紀錄（含 cancelled/removed）→ 保留可見
  - 被擋用戶看到活動的偽裝訊息：「找不到此活動」（不透露被擋事實，避免人際摩擦）
  - UI 僅位於「用戶補正管理 > 活動黑名單」（不在活動管理面板）
  - super_admin INHERENT 鎖定權限，user 絕對無權限
- **資料結構**（events 文件新增 2 欄位）：
  - `blockedUids: string[]` — 被擋用戶 UID 列表
  - `blockedUidsLog: [{uid, by, action, at, reason}]` — 審計軌跡（永久保留）
- **實作 Phase**：
  - Phase 1（0.5 天）：Firestore Rules + 權限碼 + INHERENT 兩端同步
  - Phase 2（0.5 天）：共用 helper `_isEventVisibleToUser` + 23 個單元測試
  - Phase 3（1 天）：後台 UI（模糊搜尋活動/用戶、新增/移除、列表依活動分組）
  - Phase 4（0.5 天）：全站過濾入口 — 利用既有 `_getVisibleEvents` 單一 choke-point
  - Phase 5（無程式碼變更）：CF 稽核結論 = 不需改（通知僅發給已報名用戶）
  - Phase 6（0.5 天）：CLAUDE.md 永久條目 + 修復日誌
- **關鍵 helper（禁止重寫）**：
  - `_isEventVisibleToUser(e, uid)` 於 `js/modules/event/event-blocklist.js`
  - 四狀態邏輯：訪客→可見、未擋→可見、擋+有歷史→可見、擋+無歷史→不可見
- **過濾入口清單**：
  - 首頁輪播 / 行事曆 / 搜尋 → 經 `_getVisibleEvents` 統一處理
  - 俱樂部內嵌活動 → `_renderTeamEvents` 明確 filter
  - 活動詳情直接 URL（QR/分享/訊息連結）→ `showEventDetail` 守衛
  - 豁免：Favorites（用戶資料）、Scan/Dashboard（admin 用途）、Tournament（無內嵌列表）
- **5 層防禦架構**（commit 順序）：
  1. **列表層** — `_getVisibleEvents` / `_renderTeamEvents` 過濾（commit 491379de）
  2. **詳情入口** — `showEventDetail` 第一檢查點（commit 491379de）
  3. **詳情重取後** — `showEventDetail` 第二檢查點（第一次審計發現，commit e8d9a9b7）
  4. **寫入守衛** — `handleSignup` / `_confirmCompanionRegister`（第二次審計 + 選項 B，commit 965ebcbe）
  5. **Firestore Rules** — `canManageEventBlocklist()` 寫入規則（已手動部署至 fc-football-6c8dc）
- **Companion 守衛範圍**：只擋主報名人（operator）被擋，不擋同行者中的被擋用戶
- **部署狀態**：
  - 前端：Cloudflare Pages 自動（main branch push）
  - Firestore Rules：**已手動 `firebase deploy --only firestore:rules` 部署**
  - Cloud Functions：**無需部署**（CF 本次未實質引用新權限碼，INHERENT 同步是為未來一致性）
- **Commit 歷程**（共 7 個）：
  - `e4fbc08e` Phase 1、`dec72e86` Phase 2、`c3eab11f` Phase 3
  - `491379de` Phase 4、`df5cd9e6` Phase 5+6
  - `e8d9a9b7` 審計修復 #1（第二檢查點）
  - `965ebcbe` 選項 B（寫入守衛）
- **二次審計發現（全部已處理）**：
  - 🔴 Rules 手動部署疏忽 → 已提醒並部署
  - 🔴 第二檢查點漏守衛 → 已補（commit e8d9a9b7）
  - 🔴 未登入先進頁 → 登入後報名繞過 → 已補（commit 965ebcbe）
- **接受的已知限制（未處理）**：
  - event owner rules 允許改 blockedUids（UI 不給入口）
  - admin 預設無此權限（與 admin.repair.* 家族一致）
  - `_renderExistingEventBlocklist` 排序用字串比較（僅顯示順序，不影響功能）
  - 加黑名單後當下頁面不自動刷新（Firestore 單向推播常態）
  - event-blocklist.js 載入失敗時 fail-open（UX 優先）
- **教訓**：
  - **單一 choke-point 設計省力氣**：既有 `_getVisibleEvents` 已整合 teamOnly + privateEvent，黑名單只需 +1 行就覆蓋首頁+行事曆+搜尋三個關鍵入口
  - **「尊重歷史」解決強制退報的複雜性**：保留曾報名用戶可見 = 避免資料狀態機、自動退費、通知誤發等棘手邊界
  - **CF 端自然不需過濾**：因通知只發給已報名用戶，我們的豁免規則自動對齊
  - **永久條目強制共用 helper**：防止日後新入口漏過濾（已在 CLAUDE.md 建立「活動可見性規則」章節）
  - **一次性規劃 ≠ 一次做對**：Phase 1-6 完成後仍經 2 次審計才補齊漏洞（第二檢查點、bypass 繞過）。中大型功能上線前必須至少做一次獨立審計
  - **Firestore Rules 部署不在 git push 範圍內**：必須明確紀錄手動部署步驟到 commit message / 日誌，避免「程式碼上了、功能沒上」的狀態

### 2026-04-19 — 首次登入 UX 改為「可瀏覽、寫入才擋」
- **問題/目標**：原設計強制首次登入用戶填完基本資料才能操作任何功能，包括瀏覽。
  對新用戶造成 onboarding 摩擦，無法先看看內容再決定是否加入
- **改動**：
  - **移除**三處「_pendingFirstLogin 攔截導航」守衛：
    1. `navigation.js showPage`（L449-453 舊守衛）
    2. `navigation.js goBack`（L702-706 舊守衛）
    3. `app.js hashchange`（L2282-2286 舊守衛）
  - **移除** `profile-form.js` 登入後自動彈 modal 的邏輯（L140-162）
  - **新增** `_requireProfileComplete()` helper（`navigation.js`）
    - `_pendingFirstLogin` 為 true 時彈 modal + return true（呼叫者中止動作）
    - false 時直接放行
  - **7 個寫入入口加守衛**：
    - `handleSignup`（活動報名）
    - `_confirmCompanionRegister`（同行者報名，附帶關閉 companion modal）
    - `handleJoinTeam`（加入俱樂部）
    - `handleSaveTeam`（建立/編輯俱樂部）
    - `handleCreateEvent`（建立活動）
    - `registerTournament` × 2（賽事報名 + 友誼賽報名）
  - **Modal 內容更新**（`index.html`）：
    - 加紅字提醒「※ 下列資料將作為地區歸屬及活動參與資格的判定依據,請務必如實填寫」
    - 加「稍後填寫」按鈕（`App.dismissFirstLoginModal`），允許用戶先關閉繼續瀏覽
    - `_pendingFirstLogin` 保留，下次寫入類動作仍會彈出
- **保留的行為**：
  - `_pendingFirstLogin` 仍在 3 處設置（登入時、CF PROFILE_INCOMPLETE 錯誤時）
  - Modal 的 `overlay.dataset.locked = '1'` 保留，避免用戶點外層意外關閉
  - 用戶必須透過「稍後填寫」或「確認送出」才能離開 modal
- **教訓**：
  - 「守衛一律擋」的 UX 容易讓新用戶流失；改用「可瀏覽 + 寫入才擋」的層次化守衛
    對 onboarding 友善很多
  - Helper function（`_requireProfileComplete`）比每個入口手寫判斷更易維護
  - 寫入守衛需覆蓋所有可能的入口（7 處），漏一個就會讓用戶繞過

### 2026-04-19 — 活動詳情頁 attendance-table「名單 → 空白 → 名單」生硬閃爍修復
- **問題**：進入活動詳情頁時，先顯示快取名單，然後快取名單閃消失變空白，幾秒後才補上最新資料，轉場生硬
- **根因**：`showEventDetail()` 被多個路徑重複呼叫（`_regsLoadingRetryTimer` 3 秒重試 /
  Phase 3 安全網 / onSnapshot 觸發 / 第二次 showPage），每次都執行
  `nodes.body.innerHTML = ...` 重寫整個外框，連帶把內部 `<div id="detail-attendance-table">`
  清成空 div。然後 `_renderAttendanceTable` 有 **100ms debounce + fetch 等待**，
  這段時間內 DOM 就是空白。等到 `_doRenderAttendanceTable` 寫入新名單才原子替換
- **修復（commit pending）**：`js/modules/event/event-detail.js`
  - 在 try 塊入口（line 232 前）捕獲 `_isSameEventRerender = (currentPage === 'page-activity-detail' && _currentDetailEventId === id)`
  - 外框 innerHTML 改寫前，若 `_isSameEventRerender` 為 true，捕獲舊 attendance-table innerHTML
  - 外框改寫後，若 preservation 有值：還原舊內容（稍後由 `_renderAttendanceTable` 原子替換）
  - 若無 preservation（首次進入 / 切換到不同活動）：顯示 loading skeleton
  - **注意**：只處理 attendance-table，waitlist/unreg 在 `nodes.body.innerHTML` 改寫後
    立即同步重渲染（line 535-536），沒有 debounce 空窗，不需 preservation
- **教訓**：
  - 原子性 innerHTML 替換看似瞬間（舊 DOM 持續顯示直到新 DOM 組好），但**中間插入的
    空白狀態**（如 `innerHTML = ''` 或外框改寫把子容器清空）會破壞原子性
  - `_renderAttendanceTable` 的 100ms debounce 對連續多次呼叫是好的（coalesce），
    但在 `nodes.body.innerHTML = ...` 改寫後會造成 debounce 期間空白可見
  - 多個 re-render 觸發路徑（retry / safety net / snapshot）下游都走 `showEventDetail`
    而不是 `_patchDetailTables`，長期來看該把 retry / safety net 改走局部更新

### 2026-04-19 — 活動詳情頁「幾秒後被拉回行事曆」連續修復 [永久]
- **問題**：用戶回報「首頁／行事曆點活動卡進詳情頁，幾秒後被拉回行事曆」，
  剛刷新/剛開啟網站時最常發生
- **追查過程**：
  - 用 `?debug=1` 內建 debug console 收集完整 log
  - `_activatePage` 加 stack trace log 定位出真兇：`_showPageFreshFirst`
  - 真實時序：
    1. URL hash 是 `#page-activities`（殘留）
    2. Boot 解析 hash → `App.showPage('page-activities')` 走 `_showPageFreshFirst`
    3. 卡在 `await ensureCloudReady`（Firebase init）數秒
    4. 用戶在首頁點活動卡 → `showPage('page-activity-detail')` 走 `_showPageStale`（cache 有）→ 快速進詳情頁
    5. cloud ready → boot 的 `_showPageFreshFirst` 復活 → `_activatePage('page-activities')` 把用戶拉走
  - 既有 `transitionSeq` 守衛（L539）沒擋住這個 race
- **修復（commit 96458bb6 + 調整版 [pending]）**：
  `_showPageFreshFirst` / `_showPagePrepareFirst` 在 `_activatePage` 前新增 `_startingPage` 比對守衛：
  - 記錄函式進入時的 `this.currentPage`（_startingPage）
  - await 完成後檢查 `this.currentPage !== _startingPage && !== pageId` → 放棄本次切頁
  - **關鍵**：比對變化量（不能只用 `!== 'page-home'`），否則會誤擋正常頁面切換
    （例如用戶從 page-activities 切到 page-teams 且無 cache 時）
- **連鎖副作用修復**：
  - **commit f03a42ed**：拉回問題修好後，更早走到 `_startEventsRealtimeListener`，
    暴露 `db undefined` TypeError（setTimeout 350ms 延遲啟動 listener 時 Firebase 可能還沒 init）。
    `_startPageScopedRealtimeForPage` 加 `typeof db === 'undefined'` 守衛。
    Listener 會在 `ensureCollectionsForPage` 路徑重新觸發，不會永久中斷
  - **commit 6a13cbab**：切換活動時 `detail-attendance-table` 殘留前一活動名單，
    顯示「B 標題 + A 名單」造成「被拉回 A」錯覺。showEventDetail 切換時立即清空
    attendance-table 並顯示 loading skeleton；await `_renderAttendanceTable` 後補 stale check
  - **commits 56f31c55 / 5d0909d0 / 9f4a214b**：同模式守衛套用到
    `_flushPendingProtectedBootRoute` / `_completeDeepLinkFallback` / `_tryOpenPendingDeepLink`
    （但這些都在 boot / deep-link 流程，不影響正常切頁）
- **Debug 工具加強（commit 11073947）**：`?debug=1` 浮動 console 加 📋 複製 / 🗑️ 清 / ✕ 隱藏
  按鈕，手機 LIFF 也能匯出 log
- **教訓**：
  - `showPage` 的 async await 內，一切「等 cloud / 等 auth」都可能數秒，
    await 後若不以**起始 currentPage** 比對，會在用戶已主動導航後強制拉走
  - **守衛不能用 `currentPage !== 'page-home'`**（會誤擋正常切頁）；
    必須用 `_startingPage` 變化量比對
  - Boot 期間的自動 navigate（`_flushPendingProtectedBootRoute` / deep-link poller /
    fallback）必須全部加「尊重用戶主動導航」守衛
  - 修好一個層級可能暴露下一層級的潛伏 bug（例如 db undefined），要持續監控
- **診斷基礎設施**（永久保留）：
  - `index.html` 的 `?debug=1` 浮動 console（手機可用）
  - `app.js` DOMContentLoaded 印 CACHE_VERSION
  - `navigation.js _activatePage` 印 stack trace（切頁來源）
  - `app.js _flushPendingProtectedBootRoute` 多處診斷 log

### 2026-04-19 — events.participantsWithUid 導入（Phase 0-4 完成） [永久]
- **問題**：14 組同暱稱用戶（含「勝」「Ivan」各 1 次放鴿子被隱身），根因是
  `_buildConfirmedParticipantSummary` / `_buildGuestEventPeople` 等 fallback 路徑
  用 `_userByName.set(name, user)` 反查 UID，同名被後者覆蓋
- **修復**：events 新增 `participantsWithUid: [{uid, name, teamKey}]` / `waitlistWithUid` /
  `schemaVersion: 2`。由 `_rebuildOccupancy`（前端 + CF 雙端同步）統一產出。
  讀取端（6 處 fallback）優先使用新欄位，fallback 回舊 participants[] 保持相容
- **分 Phase 實施**（單日全部完成）：
  - Phase 0：pure-functions.test.js 補 8 個測試（同暱稱/排序/去重）鎖定既有行為
  - Phase 1a：firestore.rules whitelist 加 3 欄位，已 deploy
  - Phase 1：`_rebuildOccupancy` + `_applyRebuildOccupancy` + 13 處 `db.update()` 擴充
    CF registerForEvent + cancelRegistration 已 deploy
  - Phase 2：data-sync ⑩ 遷移工具（從 registrations 子集合重算，double-check 避 race）
  - Phase 3：6 處讀取端優先 participantsWithUid（_buildConfirmedParticipantSummary /
    _confirmAllAttendance 鎖定函式 fallback / _initInstantSave / _buildGuestEventPeople /
    guest view count / event-create.js uid 反查）
  - Phase 4：data-sync ⑪ 一致性檢查（唯讀）+ ⑫ 強制重算（寫入 + 權限守衛 + double-check）
  - **Phase 3 補強**（事後修復）：用戶回報「兩個同暱稱 Ivan 點名字都跳同一位」。
    根因是 Phase 3 只改了**資料層** 6 處，但**渲染層** 8 處 `_userTag(name)` 沒傳 uid
    → HTML onclick 變成 `showUserProfile('Ivan')` 沒 uid
    → fallback 到 `_findUserByName` 挑第一個。
    補修 event-detail.js (4 處) / event-manage-attendance.js / event-manage-waitlist.js /
    user-admin-list.js / leaderboard.js 共 8 處 `_userTag` 呼叫傳入 uid
- **Commits**：78e81034 / e93e7fab / 5bb799d0 / ea6894a1 / 237ace45 / 7ddbbbd2 / 521602fd
- **教訓**：
  - **禁止用 name 反查 uid 做身分識別**。公開副本欄位必須帶 UID 結構
  - **修復資料層不夠，必須同時檢查渲染層**：`_userTag(name)` 類 HTML 產生器若 onclick
    沒帶 uid，即使底層 people 物件有 uid 也會在 UI 點擊時遺失。未來類似 bug
    必須 grep 所有 `_userTag`、`onclick`、`showUserProfile` 呼叫點
  - 舊資料 fallback 必須偵測同名衝突並警告（console.warn('[pwu] ...')）
  - Firestore transaction **不支援 collection query**，race 緩解依賴 double-check + 自我修復
  - CF / 前端純函式雙端同步規則：註解交叉引用 + 手動 review + grep 腳本
  - additive 欄位策略零風險：舊 client 不認識新欄位但不 break
- **後續（Phase 5，2-4 週後評估）**：廢除舊 `participants[]` / 移除 `scan-process.js:59`
  `event-manage-attendance.js:51` userName fallback / 擴充 CHANGE_WATCH / 隱私方案 B
- **使用操作**：用戶登入後台 → 用戶補正管理 → 系統資料同步 →
  先跑 ⑩ 遷移（首次）→ ⑪ 檢查是否一致 → ⑫ 強制重算（若有不一致）

### 2026-04-19 — 活動詳情頁跳頂老問題修復（visibilitychange + RC1 revalidate 全頁重繪）
- **問題**：用戶回報「活動詳細報名頁面因為加載渲染畫面常常跑回頂部」，是長期老問題
- **根因**：`js/firebase-service.js` 兩處違反 CLAUDE.md「活動詳情頁局部更新規則」：
  - L2764 `_staleWhileRevalidateRegistrations`（Auth ready 後 RC1 背景刷新）→ 直接呼叫 `App.showEventDetail` 全頁重繪
  - L2871 `_handleVisibilityResume`（visibilitychange 切回前景 1s 後觸發）→ 同樣 `showEventDetail`
  - `showEventDetail` 是 async 含 `await _renderAttendanceTable`（100ms debounce + Firestore fetch），子流程替換 DOM 時文件高度塌縮，外層的單次 `requestAnimationFrame(scrollTo)` 趕不上 → scroll 被 clamp 跳頂
- **為什麼「老問題一直無法修正」**：2026-04-13 已建立活動詳情頁局部更新規則（`_refreshSignupButton` / `_patchDetailCount` / `_patchDetailTables`），但只覆蓋「報名/取消/候補操作後」路徑，漏掉 revalidate + visibility resume 兩條高頻刷新路徑
- **修復**：兩處改走 `this._debouncedSnapshotRender('registrations')`（已驗證的標準局部更新路徑，內建 scroll 保護）。保留 activities / my-activities 的 render + scroll restore（這些頁面沒有局部更新路徑，維持原邏輯）
- **版號**：20260419（config.js + index.html var V + sw.js CACHE_NAME + 68 處 ?v=）
- **審計通過**：
  - `npm run test:unit` 全過（51 suites / 2169 tests）
  - 局部更新分支（firebase-service.js:144-161）原本就處理 `_flipAnimating` 鎖、null eventId gracefully 退出、5 項局部更新（按鈕 + 人數 + 正取/未報名/候補名單）
  - 不動鎖定函式（firebase-service.js 鎖定的是 `ensureUserStatsLoaded` 等統計系統，兩處修改位於 RC1 / RC3 UI 刷新路徑，不觸及統計）
- **[永久] 教訓**：
  - 建立局部更新規則時，必須全檔掃描所有 `showEventDetail` 呼叫，區分「用戶操作」與「自動刷新」，兩類都要規範
  - `showEventDetail` async 流程內的 scroll 保護（setTimeout 50/150ms 恢復）對外層非 await 的呼叫者而言**不可靠**，因為 `await _renderAttendanceTable` 會延遲到 150ms 之後才完成 DOM 替換
  - 已知限制：局部更新不覆蓋標題/圖片/地點/時間等「活動主體資訊」欄位變更（events listener 本來就不更新這些），若用戶在背景時活動被編輯，切回後需重新導航才能看到新值——這是 events 路徑設計缺口，不屬於本次修復範圍

### 2026-04-17 — 多分頁權限加載衝突修復（Firestore 單 tab + BroadcastChannel 警告）
- **問題**：PWA / 多瀏覽器分頁場景下權限加載卡住、LIFF session 錯亂。根因是 Firestore `enablePersistence({ synchronizeTabs: true })` 的多 tab IndexedDB leader election 競爭
- **修復（commit 6e0daede，版號 20260417e）**：
  - **Level 2（核心）**：`firebase-config.js` `synchronizeTabs: true → false`。第一個 tab 拿 IndexedDB 快取，後續 tab 自動走 memory cache（SDK 降級，catch handle `failed-precondition`）。消除 leader 競爭
  - **Level 1（UX）**：新增 `js/modules/multi-tab-guard.js`。BroadcastChannel 偵測同站其他分頁，顯示毛玻璃警告 modal + 關閉提示
  - CSS：`base.css` 新增 `.multi-tab-overlay` 樣式（CLAUDE.md 毛玻璃規範 + `@supports` fallback for 舊 Android WebView）
  - 模組自動 init（DOMContentLoaded 後），不動 `app.js init()` 順序
- **審計通過**：
  - `npm run test:unit` 全過（51 suites / 2169 tests）
  - `node --check` multi-tab-guard.js + firebase-config.js OK
  - 符合 CLAUDE.md 毛玻璃規範（blur + webkit + rgba + radius + shadow + fallback）
  - 跨瀏覽器 fallback：BroadcastChannel `typeof` 檢查，舊環境靜默降級
  - 不動鎖定函式、不影響 LIFF（LIFF 靠 localStorage 跨 tab 同步，不受影響）、不影響 SW cache
- **已知限制**：
  - BroadcastChannel 跨 context 不通（iOS Safari PWA vs Safari 是獨立 WebKit，偵測不到）
  - 後續 tab 無離線快取，切頁稍慢（比「卡住」好）
- **Smoke test 待用戶驗證**：同站開兩分頁 → 應看到警告 modal + console.warn `failed-precondition`
- **教訓**：
  - Firestore multi-tab 持久化的 leader election 機制在正常情況 OK，但搭配 LIFF / PWA 多 tab 複雜情境會暴露競爭問題
  - 單 tab 模式（`synchronizeTabs: false`）是小而有效的解法，第二 tab 犧牲離線快取換穩定
  - BroadcastChannel 是標準 API，但 Safari 15.4+ 才全面支援，需 typeof 檢查

### 2026-04-17 — 用戶資料卡片頁加毛玻璃遮蔽（節省 Firestore 自動讀取）
- **目標**：看別人名片預設自動拉 activityRecords + achievement subcollection（100-400 reads/次），成本隨用戶數線性成長；改為點擊才載入
- **設計決策**：
  - 自己/別人都遮，文字不同（isSelf 提示「本次進入需重新載入」）
  - 徽章與活動紀錄都遮（但 isSelf 徽章例外，本地 cache 同步計算即可）
  - 無中央按鈕，文字提示「點擊任一處載入」
  - 只有需額外讀取才遮（用 `FirebaseService.getUserStatsCache().uid` 與 `_userAchievementProgressUid` 判斷，不建額外 set）
- **實作（commit 6ba99723，版號 20260417b）**：
  - `profile-core.js showUserProfile`：加 cache 命中判斷 + 動態遮蔽 HTML，移除自動 await ensureUserStatsLoaded
  - `profile-core.js` 新增 `_loadUserCardUncovered(uid)`：遮蔽點擊觸發，並行載入 stats + badges，完成後移除遮蔽
  - `profile.css` 新增 `.uc-blur-overlay` 樣式（CLAUDE.md 毛玻璃規範：blur(10px) + webkit 前綴 + rgba(0,0,0,.35) + radius + shadow；含 `@supports not (backdrop-filter)` fallback 用 rgba(0,0,0,.72) 為舊 Android WebView 降級）
- **保護機制**：
  - `_userCardLoading` flag 防連點
  - `currentPage === 'page-user-card'` guard 防跨頁 DOM 競態
  - 錯誤時遮蔽文字改「載入失敗，點擊重試」
  - `targetUid` null guard（資料未同步時不遮直接走原流程）
- **審計通過**：
  - `npm run test:unit` 全過（51 suites / 2169 tests）— **吸取 B' 階段漏跑測試的教訓**
  - `node --check` profile-core.js 語法 OK
  - 不動鎖定函式（`_calcScanStats` / `ensureUserStatsLoaded`）
  - 不動自己的 `#page-profile`（原本 `_userStatsCache` 機制保留）
  - 不衝突 B' smoke test（B' 用 Admin SDK 直查 Firestore，不依賴 UI）
- **未來潛在擴展**：
  - 可延伸到 `#page-profile`（自己的 profile）
  - 可加「顯示為 DNS 預拉」（hover 就 prefetch，點擊時瞬間顯示）
  - 若用戶反映太煩人，可加「記住偏好」選項 persist 到 localStorage

### [永久] 2026-04-17 — B' 階段治本：修 cancelRegistration / cancelCompanionRegistrations 遞補漏同步 activityRecord（部署完成、smoke test 待驗）
- **問題**：A' 階段 backfill 了 93 位用戶 110 筆異常資料，但寫入路徑未修，未來新的取消+遞補會持續產生新異常
- **根因**：`cancelRegistration` 與 `cancelCompanionRegistrations` 在候補遞補時，只改 `registrations.status=confirmed`，漏改對應 `activityRecord.status`（保持 waitlisted）
- **修復（commit 76336d57，版號 20260417a）**：
  - 兩個鎖定函式各加三處：
    1. Firestore 查詢該活動所有 activityRecords（避免本地 onSnapshot limit 漏資料）
    2. batch 加 `activityRecord.status=registered`
    3. commit 成功後同步本地快取
  - 同行者 `participantType='companion'` 排除處理（不產生 activityRecord）
  - 找不到對應 activityRecord 時 `console.warn`（不靜默漏修）
  - 處理歷史重複資料（filter 全部 matched 而非 find 第一筆）
- **審計通過**：
  - 符合 CLAUDE.md 報名系統保護規則 13 條全部
  - 與既有 `_adjustWaitlistOnCapacityChange` 模式一致
  - Firestore rules L1488-1499 `isSubActivityStatusOnly()` 允許此寫入
  - 12 個劇本自我模擬測試全過（正常遞補、取消候補不遞補、取消正取無候補、candidate 是同行者、activityRecord 找不到、並發取消、cross-event 取消、companion 取消不遞補、退化測試、Firestore 查詢失敗、活動已 ended、空 activityRecords）
  - 5+ 輪審計找到 14 個瑕疵全部修訂
- **未完成待辦（T+24h 之後執行，約 2026-04-18 10:00 後）**：
  - [ ] Smoke test：建測試活動容量 2 → 3 人報名（2 正 1 補）→ 取消 1 正取 → Admin SDK 查候補者 `activityRecord.status` 是否變 `registered`
  - [ ] 重跑稽核腳本 `scripts/_audit-bug-ab.js`（仍在主 repo，已寫好），預期 0 筆異常
  - [ ] 若有殘餘異常（A'→修 bug 之間累積，預期 < 10）→ 用 Admin SDK patch
  - [ ] 清理 `scripts/_audit-bug-ab.js` 和 `scripts/_audit-bug-ab-result.json`
  - [ ] 若稽核通過，在此條目末尾加「驗證完成」註記
- **失敗處理策略**：不使用 `git revert`（會搞亂版號一致性），改用 forward-fix 寫新 commit 撤銷錯誤行為
- **未修範圍（非本次任務）**：
  - Bug #C（取消自己的 activityRecord，目前 UI 層已處理）
  - Bug #D（現場補位未建 registration/activityRecord，需業務決策）
  - A' 中 7 筆 `cancelled → registered` + 1 筆 `removed → registered`（成因不同）
  - 21 筆 `reg=confirmed 缺 act`（UI 層 addActivityRecord 某時漏跑，另案調查）
- **長期改善建議**：把 activityRecord 寫入統一收進 CRUD 層（目前由 UI 層寫），避免未來再出現寫入不對稱的 bug。需大範圍重構，留待專門任務
- **教訓**：
  - 寫入路徑不對稱是資料完整性的最大敵人——`registrations` 和 `activityRecords` 成對寫入必須在同一 batch
  - 架構上 activityRecord 由 UI 層寫、CRUD 層不寫，讓 CRUD 的遞補路徑容易漏寫衍生資料
  - 遞補路徑有多處（取消觸發、容量變更觸發、管理員手動）需逐一檢查，不能假設「修了 cancelRegistration 就 OK」
  - **自我審計必須包含 `npm run test:unit`**——B' 階段做了 50+ 視角審計卻漏掉這個最基本的關卡，造成 commit 76336d57 後才被用戶發現 `migration-path-coverage.test.js` 失敗（新增 4 處 `.collection('activityRecords')` 未更新 KNOWN_REFERENCES 白名單）。後續以 commit 修復測試並補 `docs/stateful-imagining-dahl.md` 的 migration plan 備註。未來鎖定函式修改必跑 unit tests 作為審計的必要步驟
- **監測指標**（觀察 24 小時內）：
  - `console.warn` 含 `[cancelRegistration] no waitlisted activityRecord found` → 歷史特殊資料，可追蹤但非新 bug
  - `console.error` 含 `activityRecords query failed` → Firestore 問題，需立刻處理
  - 取消報名功能的 error rate

### [永久] 2026-04-17 — 全站簽到資料修復：候補遞補 status 未同步 + activityRecord 衍生資料漏寫
- **問題**：93 位用戶有 checkin+checkout 紀錄但個人頁應到/完成顯示 0；資料不完整率 10.9%（1006 個 checkin 組合中 110 筆異常）
- **調查**：以 Admin SDK 全站稽核 `collectionGroup('attendanceRecords').where('type','==','checkin')` 交叉比對 `registrations` + `activityRecords`
- **兩種資料不一致模式**：
  - Bug 1（63 筆）：有 activityRecord 但 status 未同步 — 55 筆 waitlisted（候補遞補路徑漏改）、7 筆 cancelled、1 筆 removed
  - Bug 2（47 筆）：有 checkin 但完全缺 activityRecord — 21 筆 `reg=confirmed` 衍生資料漏寫、26 筆 `reg=(缺)` 多為 Phase 4b 前老資料或手動掃碼簽到流程
- **修復**：全站 patch activityRecord 子集合，Bug 1 統一改 status=registered，Bug 2 補建 activityRecord（schema: eventId / name / date / status / uid / eventType / createdAt）
- **驗證**：patch 後重跑稽核 0 筆異常；目標 UID `Ud822a6c5a...` 從 應到0/完成0 → 應到2/完成2、出席率 100%
- **教訓**：
  - `registrations` 是權威但 `activityRecords` 是前端統計依賴的衍生資料，寫入路徑有多處不對稱 → 必須在寫入路徑統一兩者狀態轉換（candidate 遞補、取消重報、removed 等 edge case）
  - 全站稽核腳本用 `collectionGroup + parent.parent !== null` 過濾子集合是 Phase 4b 後的必備模式
  - 邊界案例（cancelled/removed 有 checkin）反映業務流程（現場補位、取消後反悔）在資料模型沒有對應狀態 → B′ 階段需考慮新增中間狀態或明確業務規則
- **B′ 待辦（未完成，下次觸碰報名系統時一起做）**：
  - code review `js/firebase-crud.js` 的 `cancelRegistration` 遞補路徑、`batchRegisterForEvent` 衍生寫入、`registerForEvent` status 轉換
  - code review `js/modules/event/event-create-waitlist.js` 的 `_adjustWaitlistOnCapacityChange` / `_promoteSingleCandidateLocal` / `_getPromotedArDocIds` 候補遞補是否正確同步 activityRecord
  - 評估是否需要定期稽核 Cloud Function 當防線（類似 `calcNoShowCounts` 的做法）

### 2026-04-17 — 個人頁統計與報名紀錄首次進場顯示 0
- **問題**：用戶有報名、簽到、簽退紀錄，但個人頁四格統計（應到/完成/出席率）與報名紀錄 tab 首次進場顯示為 0 或空白；反覆切頁或手動刷新才會正確
- **原因**：`renderActivityRecords` / `renderProfileData` 在 `_userStatsCache` 未 ready 時直接把 `_calcScanStats(uid)` 的結果（0）寫入 DOM。`ensureUserStatsLoaded` 是 async collectionGroup 查詢，頁面先渲染、cache 後到位；fallback 讀 `_src('activityRecords')` 的根集合快取（Phase 4b 遷移後已凍結、無 onSnapshot 維護）回傳空陣列。完成後亦無 re-render 觸發機制
- **修復**：
  - `profile-data-render.js` `renderProfileData`：4 格統計加 `statsReady` 檢查，未 ready 顯示 `--`
  - `leaderboard.js` `renderActivityRecords`：cache 未 ready 時顯示「載入紀錄中...」+ stats `--`，並背景觸發 `ensureUserStatsLoaded(uid).then` 完成後於 `page-profile` 自動重繪
  - 未動任何鎖定函式（`_calcScanStats / _categorizeRecords / getParticipantAttendanceStats / ensureUserStatsLoaded` 保持原狀）
- **教訓**：
  - `renderUserCardRecords`（看別人名片）早已有 `statsReady` 檢查顯示 `--`，自己的 profile 路徑缺失，造成不對稱 bug
  - Async 資料載入後若缺 re-render 觸發，用戶會卡在初始值；fire-and-forget + `then(() => currentPage === X && re-render)` 是可重用修法
  - 架構級根治方案為後端預算寫入 user doc（比照 `calcNoShowCounts`），已規劃為下一階段任務（含 UI 毛玻璃遮蔽 + 手動刷新按鈕設計）

### 2026-04-15 — 俱樂部加入申請審核「找不到此俱樂部」
- **問題**：職員從訊息頁審核俱樂部加入申請時顯示「找不到此俱樂部」，但從俱樂部頁進入則正常
- **原因**：兩個 bug 疊加 — (1) `message-actions-team.js` 的 fallback `ensureCollectionsForPage('page-teams', {skipRealtimeStart:true})` 是死路（teams 在 `_pageScopedRealtimeMap` 中被排除靜態載入，同時 skipRealtimeStart 又不啟動即時監聽） (2) `firebase-service.js` init 中 `_teamSlices`/`_tournamentSlices` 的 `injected` 仍為 `new Set()`（Phase 2B 文件記載要改 Array 但 init 遺漏），導致 `fetchTeamIfMissing` 呼叫 `.findIndex()` 時 TypeError 靜默回傳 null
- **修復**：`message-actions-team.js` 改用 `getTeamAsync(teamId)`（cache-first + Firestore 單筆補查）；`firebase-service.js` init 中 `injected: new Set()` → `injected: []`
- **教訓**：Phase 2B 重構改了消費端但遺漏 init 初始化，Set/Array 不匹配被 try/catch 靜默吞掉不報錯

### [永久] 2026-04-14 — 首次登入個人資料強制填寫修復（Plan B + Plan C）
- **問題**：18.7% 用戶（127/678）資料不完整。根因：首登表單依賴 ScriptLoader 載入 48 個不相關 script，網路差時 3 次重試全失敗後靜默放棄
- **修復**：
  - Plan B：首登表單 HTML 內聯到 index.html，完全移除 ScriptLoader 依賴。表單從 modals.html 移除避免重複 DOM
  - Plan B：`saveFirstLoginProfile` 改用 `updateCurrentUserAwait`（async await），存檔失敗不關 modal 讓用戶重試
  - Plan B：`navigation.js _tryShowFirstLoginModal` 同步簡化（移除 ScriptLoader）
  - Plan C：`functions/index.js registerForEvent` 加入 `PROFILE_INCOMPLETE` 前置檢查（gender + birthday + region 三欄一致）
  - Plan C：`firebase-crud.js registerForEvent / batchRegisterForEvent` 前端 pre-check（鎖定函式，僅 pre-check 不觸碰 transaction）
  - Plan C：`event-detail-signup.js / event-detail-companion.js` 攔截 PROFILE_INCOMPLETE 錯誤 → 自動彈出首登表單
- **教訓**：
  - `updateCurrentUser` 是 fire-and-forget，關鍵資料存檔必須用 `updateCurrentUserAwait`
  - 首登表單只需 ~160 行 JS + ~30 行 HTML，不應該依賴 48 script 的 ScriptLoader 鏈
  - CF 路徑目前 0% 流量（feature flag 關閉），前端 pre-check 才是實際有效的防線

### [永久] 2026-04-14 — 俱樂部×賽事重構完成總結（Phase 0-3 + Phase 4）— 全計畫結案
- **範圍**：6 個 Phase、9 個 commit、14 個新建檔案、30+ 個修改檔案
- **架構成果**：
  - per-entity 專看專讀（fetchIfMissing + injected 桶 + onSnapshot 合併保護）
  - ID 統一（新建俱樂部/賽事 doc.id === data.id，events 維持雙軌）
  - 教練 UID 化（coaches[]名字 → coachUids[] UID + coachNames[] 顯示快取）
  - 內嵌陣列移除（賽事 teamApplications/teamEntries → 純子集合，registeredTeams 保留）
  - 權限強化（feed 雙層守衛 + delegateUids 擴權防護 + 賽事操作拆分 + feed create 收緊）
  - 效能優化（分頁 + 防抖 + 指紋跳過 + 即時監聯 + 捲動保存）
  - CF 級聯更新（onTeamUpdate：俱樂部改名/圖自動同步賽事 hostTeamName/hostTeamImage）
- **部署狀態**（2026-04-14 全部完成）：
  - ✅ 遷移腳本已執行：5 俱樂部全部 coachUids 已就位，0 未匹配
  - ✅ Firestore Rules 已部署：`isCurrentUserTeamStaff` + feed create 收緊
  - ✅ Cloud Functions 已部署：`onTeamUpdate`（新建）+ `eduCheckin`（更新）
  - ✅ 前端已部署（版號 `20260414f`）
- **待補（非 blocking，UX 增強）**：8.2D 載入進度條、§7.10 深連結 pre-auth REST
- **定時清理提醒**：
  - 2026-05-14 後可移除賽事內嵌陣列 fallback 讀取路徑（tournament-friendly-state.js L70-71, tournament-friendly-roster.js L81, tournament-detail.js L340-341, tournament-friendly-detail-view.js L144, tournament-friendly-roster.js L318）
  - 2026-05-14 後可移除 Firestore 中舊賽事文件的 `teamApplications`/`teamEntries` 欄位
- **計畫書**：`docs/specs/team-tournament-refactor-plan.md` v3.0（所有 Phase checklist 已打勾）

### [永久] 2026-04-14 — coachUids 欄位遷移（教練 UID 化）
- **問題**：教練以名字（`coaches[]`）儲存，同名用戶會碰撞，且 Firestore Rules 無法驗證教練身分
- **修復**：
  - 新增 `coachUids[]` 欄位（UID 陣列），`coachNames[]` 做顯示快取，舊 `coaches[]` 保留不刪
  - 遷移腳本 `scripts/migrate-team-uids.js`（名字→UID，冪等，同名標記模糊不自動分配，支援 `--dry-run`）
  - Firestore Rules 新增 `isCurrentUserTeamStaff` 函式（隊長+領隊+教練超集），**不改名** `isCurrentUserTeamCaptainOrLeader`（11 處引用不動，避免教練靜默獲得賽事建立等權限）
  - 前端 17 個函式移除名字 fallback，改用純 UID 比對
  - CF `eduCheckin` / `registerForEvent` 改用 `coachUids` 比對
  - Team form 儲存時同步寫入 `coachUids`/`coachNames`/`captainName`/`leaderNames`
- **Firestore Rules 函式使用對照表**（新增教練權限後的最終狀態）：
  - `isCurrentUserTeamCaptainOrLeader`：groups CRUD、tournaments create、tournaments/applications create（**不含教練**）
  - `isCurrentUserTeamStaff`：feed update/delete、coursePlans CRUD + enrollments、students create/update/delete（**含教練**）
  - `isCurrentUserInTeam`：feed create（成員即可發文）
- **教訓**：
  - `isCurrentUserTeamStaff` 只用在明確需要教練權限的地方（feed 管理、課程、學員）
  - 教育分組（groups）、賽事建立（tournaments create）、賽事申請仍用 `isCurrentUserTeamCaptainOrLeader`（不含教練）
  - 未匹配教練 = 0 才可部署前端（否則教練永久失去權限）
  - `coachUids` 在 Rules 中使用前必須加 `is list` 型別檢查（未遷移的 team 可能沒有此欄位）
  - 退隊時只需移除 `coachUids` 中的 uid，`coachNames` 為顯示快取不需嚴格同步

### 2026-04-14 — 俱樂部×賽事重構 Phase 3：資料架構遷移（已部署）
- **目標**：賽事內嵌陣列移除 + Cloud Function 級聯更新 + 教練 UID 化 + feed 規則收緊
- **執行內容**：
  - §9.1 賽事內嵌陣列移除：`_syncFriendlyTournamentCacheRecord` / `_persistFriendlyTournamentCompatState` / `_buildFriendlyTournamentRecord` 不再產生/寫入 `teamApplications`/`teamEntries`，只保留 `registeredTeams`。賽事建立/編輯改寫 entries 子集合
  - §9.2 `onTeamUpdate` CF（已部署 asia-east1）：v2 API，team.name/image 變更時級聯更新 hostTeamName/hostTeamImage。僅處理 `hostTeamId` 引用，entries 子集合的 teamName/teamImage 不在此 CF 範圍（需另行手動或前端同步）
  - §11.4-11.6 教練 UID 化（已部署）：見上方 [永久] 條目。遷移腳本已執行完畢，5 俱樂部全部匹配成功
  - §5.2 feed create 收緊為 `isCurrentUserInTeam(teamId)`（Firestore Rules 已部署）
  - feed update/delete 改用 `isCurrentUserTeamStaff`（含教練，已部署）
  - coursePlans / students 子集合規則改用 `isCurrentUserTeamStaff`（教練可管理課程/學員，已部署）
- **實際修改超出計畫的部分**：計畫列 9 個前端函式，實際修改 17 個（額外 8 個在 api-service.js、message-actions-team.js、event-list-helpers.js、team-detail.js、team-form-roles.js、team-form-join.js、team-form.js、team-form-validate.js 中也有名字比對邏輯需同步遷移）
- **影響範圍**：tournament-friendly-state.js、tournament-core.js、tournament-friendly-roster.js、tournament-manage.js、tournament-manage-edit.js、team-list-helpers.js、team-detail.js、team-form.js、team-form-validate.js、team-form-roles.js、team-form-join.js、tournament-helpers.js、tournament-friendly-notify.js、event-list-helpers.js、message-actions-team.js、api-service.js、firestore.rules、functions/index.js
- **注意事項**：
  - `registeredTeams[]` 仍保留在賽事文件中（輕量 ID 陣列，快速判斷參賽狀態）
  - 舊賽事 Firestore 文件中的 `teamApplications`/`teamEntries` 欄位未刪除（僅停止寫入），2026-05-14 後可清理
  - 前端 fallback 讀取路徑（`base.teamApplications`/`base.teamEntries`）保留 30 天，2026-05-14 後可移除
  - `onTeamUpdate` CF 只監聽 `teams/{teamId}` 文件的 name/image 變更，不處理 entries 子集合內的 teamName/teamImage

### 2026-04-14 — 俱樂部×賽事重構 Phase 2B：列表效能優化
- **目標**：俱樂部/賽事列表頁效能優化 + 動態牆走 ApiService + 前端權限守衛
- **執行內容**：
  - §8.1 分頁機制：`firebase-service.js` 擴充 `_teamSlices: { active:[], injected:[] }`（原 Phase 2A 的 `{ injected: new Set() }`），`_buildCollectionQuery` teams/tournaments 改 `orderBy('createdAt','desc').limit(50/100)`，新增 `loadMoreTeams()` / `loadMoreTournaments()` cursor-based 分頁，`_loadStaticCollections` 新增 cursor 捕捉
  - §8.2 渲染優化：`team-list.js` 搜尋防抖 300ms + `searchTeamsFromServer()` 全集合搜尋按鈕，`team-list-render.js` 指紋跳過重繪（`_teamListLastFp`），`tournament-render.js` 搜尋防抖 + 指紋跳過（`_tournamentListLastFp`）+ 捲動保存 + `searchTournamentsFromServer()`
  - §8.3 即時監聽：`config.js` 新增 `teamLimit:50` / `tournamentLimit:100`，`PAGE_DATA_CONTRACT` page-teams/page-tournaments 加入 `realtime`，`firebase-service.js` 新增 `_startTeamsRealtimeListener` / `_startTournamentsRealtimeListener` + stop/reconnect，`_mergeTeamSlices` / `_mergeTournamentSlices` 合併 active + injected（防 onSnapshot 洗掉冷門俱樂部），`fetchTeamIfMissing` 改為 push 完整 team 物件到 `injected[]`（原 Set.add(id)），整合 `_startPageScopedRealtimeForPage` / `finalizePageScopedRealtimeForPage` / `destroy`
  - §8.4 team-feed.js 走 ApiService：`firebase-crud.js` 新增 8 個 Team Feed CRUD 函式，`api-service.js` 新增對應封裝 + audit log，`team-feed.js` 全面改用 ApiService
  - §12.4B Feed 前端權限守衛：`team-feed.js` 新增 `_canDeleteTeamFeedPost` / `_canPinTeamFeedPost` / `_canPostTeamFeed` / `_canDeleteTeamFeedComment`，per-team 角色 + `team.manage_all` 管理員 override 雙層模式
- **教訓**：`_teamSlices.injected` 從 `Set<id>` 改為 `Array<object>` 是必要的，因為 onSnapshot 替換 active 後需要完整物件才能合併回 `_cache.teams`。loadMore 結果也放入 injected 桶保護，避免下次 onSnapshot 洗掉。

### 2026-04-14 — 俱樂部×賽事重構 Phase 4：表單拆分 + 教育解耦
- **目標**：降低 team-form.js / tournament-friendly-detail.js 的單檔複雜度，解耦教育型俱樂部的 if 散落
- **執行內容**：
  - §10.1 `team-form.js`（393→155 行）拆分為 `team-form-validate.js`（表單驗證 + 值提取）+ `team-form-roles.js`（降級預覽 + 自動升降級/通知）+ 瘦身後的 `team-form.js`（資料組裝 + 儲存 + 日誌）
  - §10.2 教育解耦：`team-list-helpers.js` 新增 `_getTeamTypeHandler(type)` + `_getEduStudentCount(teamId)`，4 處 `if (type === 'education')` 改為呼叫 handler（team-detail.js / team-form-join.js / team-list-render.js / team-form-init.js）
  - §10.3 `tournament-friendly-detail.js`（368→216 行）拆出 `tournament-friendly-state.js`（5 個狀態管理函式 + _isTournamentViewerInTeam），detail 只留 3 個渲染/操作函式
  - `script-loader.js` 新增 3 個檔案載入（validate/roles 在 form 之前、state 在 detail 之前）
  - `docs/architecture.md` 更新模組數（team 14→16、tournament 14→15）
- **教訓**：Object.assign 載入順序很重要 — validate/roles 必須在 form 之前載入，否則 handleSaveTeam 呼叫時函式尚未掛載

### [永久] 2026-04-14 — 俱樂部×賽事重構 Phase 2A：專看專讀 per-entity 架構 + ID 統一建立流程
- **目標**：深連結看 1 個俱樂部/賽事從 200-600 reads 降至 1 read；消除俱樂部/賽事的雙軌 ID
- **執行內容**：
  - `firebase-service.js` 新增 `fetchTeamIfMissing()` / `fetchTournamentIfMissing()`（cache-first → `.doc().get()` → `.where('id','==').limit(1)` 三層 fallback），注入快取時寫 `_teamSlices.injected` / `_tournamentSlices.injected`（Phase 2B onSnapshot 保護用）
  - `api-service.js` 新增 `getTeamAsync()` / `getTournamentAsync()`（同步快取 + Firestore fallback）
  - `team-detail.js` / `tournament-detail.js` / `tournament-friendly-detail.js` 詳情頁接入 async fallback
  - `app.js` 深連結 team/tournament 區塊改為 cache miss 時直接查 1 筆，不等全集合
  - `config.js` `PAGE_DATA_CONTRACT` 詳情頁 required → optional（不阻塞等全集合）
  - `firebase-crud.js` `_getTournamentDocRefById` fallback 成功時注入快取
  - `firebase-crud.js` `addTeam` / `addTournament` 改用 `.doc(customId).set()`（`data.id === data._docId`，消除雙軌 ID）
  - `tournament-manage.js` 賽事操作拆分：`handleEndTournament` 用 `admin.tournaments.end` + `_canManageTournamentRecord` fallback，`handleReopenTournament` / `handleDeleteTournament` 各用獨立權限碼（僅管理員）
- **教訓**：
  - 俱樂部/賽事新建後 `data.id === data._docId`（單軌），但既有歷史資料仍可能 `id ≠ _docId`，所以 `fetchIfMissing` 必須保留 `.where('id','==')` fallback
  - `_teamSlices.injected` 在 init 時需重設為空 Set，避免跨會話殘留
  - 活動（events）的 `addEvent` 不動（歷史資料量大 + 子集合遷移剛完成）

### 2026-04-14 — 俱樂部×賽事重構 Phase 1a：俱樂部結構整理
- **目標**：拆分過大的 team-list.js（305→179 行）與 team-share.js（190→84 行），建立唯一真相來源
- **執行內容**：
  - 新建 `team-list-helpers.js`（178 行）— 12 個身分解析/權限函式 + `_canManageTeamMembers`（從 team-detail.js）+ `_applyRoleChange`（從 team-form-join.js）
  - 新建 `team-list-stats.js`（50 行）— `_calcTeamMemberCountByTeam` / `_calcTeamMemberCount` / `_getTeamRank` / `_sortTeams`
  - 新建 `team-share-builders.js`（102 行）— `_buildTeamLiffUrl` / `_buildTeamShareAltText` / `_buildTeamFlexMessage`
  - 改名 `team-detail-members.js` → `team-detail-invite.js`
  - 搬移錯放函式：`removeTeam` → team-list.js / `_applyRoleChange` → team-list-helpers.js / `_initTeamListSportFilter` → team-list-render.js
  - 刪除 2 處 inline fallback（team-detail.js / team-form-join.js），改為呼叫 `_calcTeamMemberCount`
  - 更新 script-loader.js 載入順序：helpers → stats → list → render
  - 更新測試引用 + source-drift 註解
- **教訓**：§6.0C 的 ≤80 行目標未考慮 `removeTeam`（46 行）搬入 team-list.js，實際結果 179 行但已達到結構分離目的

### [永久] 2026-04-14 — 俱樂部×賽事重構 Phase 0：安全性修復（Firestore Rules + 索引）
- **問題**：三處安全漏洞 — (1) 賽事 entries/members 公開讀取（未登入可讀取所有參賽者 UID/姓名）(2) 動態牆任何登入用戶可刪改他人貼文 (3) 賽事委託人可自我擴權（修改 delegateUids 新增其他委託人）
- **修復**：
  - `firestore.rules` entries/members `allow read: if true` → `if isAuth()`
  - `firestore.rules` feed update/delete 加 `uid == auth.uid || isCurrentUserTeamCaptainOrLeader`（create 暫不收緊，等 Phase 3 ID 統一後再處理）
  - 新增 `delegateUidsUnchangedOrCreator()` 函式 — 只有建立者（`creatorUid`）和管理員可修改 `delegateUids`
  - `firestore.indexes.json` 新增 teams + tournaments 的 `creatorUid + createdAt` 複合索引
- **教訓**：
  - feed create 不能用 `isCurrentUserInTeam(teamId)` 收緊 — `teamId` 來自 Firestore 路徑是 doc.id，但 `users.teamIds` 存的是自訂 ID，對舊俱樂部（doc.id ≠ data.id）會擋住合法成員
  - `delegateUids` 不能設為完全不可變（immutable），因為賽事建立者通常是隊長而非管理員，需要能管理自己的委託人

### 2026-04-13 — 舊活動簽到/報名紀錄不顯示 — 全站監聯器 limit 截斷 + 極簡補查
- **問題**：全站監聽器 `collectionGroup.limit(1500)` + dedup 後實際只有 ~750 筆快取，舊活動的簽到/報名紀錄被截斷，詳情頁顯示空白
- **調查過程**：經四輪專家審計（13 個 MUST FIX）設計出 per-event listener + Feature Flag 完整方案（v5），但第五輪極簡挑戰 + 7 位專家 7-0 投票後決定採用極簡方案
- **修復**：`fetchAttendanceIfMissing` + `fetchRegistrationsIfMissing` — 快取有資料直接 return（零成本），沒有就從子集合查一次 merge 進快取。15 行 / 2 檔案
- **教訓**：舊活動資料是凍結的靜態資料，不需要即時監聽。用 80 行 + Feature Flag 解決 15 行能解決的問題是過度工程。完整方案保留在 `docs/attendance-listener-optimization.md` 作為決策參考

### 2026-04-13 — 圖片載入優化（淡入 + 預解碼 + 品牌圖壓縮 + Banner 預載）
- **問題**：圖片從「無」到「有」的閃現衝擊
- **修復**：`img { opacity:0 }` + `img.decode()` 預解碼後才淡入 + 開機品牌圖壓縮 96%（1198KB→49KB WebP）+ 輪播 Banner `new Image().decode()` 預載
- **教訓**：`img.decode()` 在 load 事件後呼叫確保完全解碼；`.img-loaded` 不可加 `transition:none`（會取消淡入）；開機 LOGO 需覆寫全局 `opacity:0`

### 2026-04-13 — CF 報名成功後按鈕閃爍 — 樂觀補入 registration
- **問題**：CF 路徑報名成功後，翻牌動畫結束時 `_refreshSignupButton` 讀到空快取，按鈕短暫閃回「報名」
- **修復**：CF 成功後立即 push 一筆樂觀 registration 到 `_cache.registrations`，snapshot 到達後整批覆蓋
- **教訓**：CF 路徑的樂觀更新只更新 event 欄位，必須同時更新 registration 快取

### 2026-04-13 — 活動詳情頁局部更新機制 + 跳頂修復 + 回歸修正
- **問題 1（跳頂）**：報名/取消後頁面跳回頂部。經 6 次嘗試，前 5 次（scroll 保護、showPage 跳過、高度鎖定等）全部無效
- **根因**：`showEventDetail` 的 `innerHTML` 全頁替換無論如何都會丟失 scroll
- **修復**：改為局部 DOM 更新——`_refreshSignupButton`（按鈕）+ `_patchDetailCount`（人數）+ `_patchDetailTables`（名單），不做全頁重繪
- **問題 2（被拉回）**：刷新後切頁會被拉回原頁。根因是 `showEventDetail` async 函式在 await 期間用戶已離開，但 `showPage` 仍執行。修復：在 `showPage` 前加 `requestSeq` stale 檢查
- **問題 3（回歸）**：局部更新遺漏性別限定按鈕 + 人數不更新。修復：`_refreshSignupButton` 涵蓋全部 8 種按鈕狀態；`_patchDetailCount` 修正 DOM 選取（text node 非 span）
- **教訓**：全頁 innerHTML 替換在 SPA 中必然丟失 scroll，局部 DOM patch 是唯一可靠解法。局部更新函式必須覆蓋原始全頁渲染的所有分支，否則產生回歸

### 2026-04-13 — 活動詳情頁報名狀態偶發性錯誤 — collectionGroup 監聽器首次 snapshot 競態
- **問題**：用戶已報名成功但開啟活動頁面偶爾顯示「報名/候補」按鈕。原因是 Phase 3 切換到 collectionGroup 監聽器後，首次 snapshot 到達前快取為空，頁面依空快取渲染為未報名
- **修復**：`event-detail.js showEventDetail()` 新增安全網——當快取判定「未報名」時，直接對子集合做 `get({source:'server'})` 查詢確認，若已報名則補入快取並重新渲染
- **教訓**：從根集合切到 collectionGroup 後，首次 snapshot 延遲可能更長，讀取路徑切換時必須為「快取未就緒」狀態加 fallback 查詢

### 2026-04-12 — Phase 4a+4b 完成：CF 觸發器遷移 + 寫入路徑翻轉
- **問題**：Phase 3 完成後，讀取已切到子集合，但寫入仍雙寫（根+子集合），CF 觸發器仍監聽根集合
- **修復**：
  - Phase 4a：`watchRegistrationsChanges` / `watchAttendanceChanges` document path 改為子集合路徑
  - Phase 4b 步驟 1：LOCKED 函式（`_doRegisterForEvent`、`batchRegisterForEvent`、`cancelRegistration`、`cancelCompanionRegistrations`）+ CF `registerForEvent` / `cancelRegistration` 的根集合 ref 改為子集合 ref
  - Phase 4b 步驟 2：所有一般寫入（`addAttendanceRecord`、`removeAttendanceRecord`、`batchWriteAttendance`、`displayBadges` 等 15 個檔案）根集合 ref 改為子集合 ref
  - Phase 4b 步驟 3：移除所有 `[dual-write]` 區塊（38 個雙寫區塊）；`_getEventDocIdAsync` 從 try-catch 提升為主路徑必要呼叫，null 時 throw
  - 測試：`KNOWN_REFERENCES` / `KNOWN_CF_REFERENCES` / `KNOWN_CF_TRIGGERS` 全部更新；4330 tests passed
- **教訓**：regex `.collection('registrations')` 會同時匹配根集合和子集合鏈中的引用，更新 allowlist 時需用實際計數

### 2026-04-12 — Phase 3 完成：子集合讀取路徑切換
- **問題**：Phase 0-2 完成後，讀取仍走根集合。需切換全部讀取路徑到子集合/collectionGroup
- **修復**：
  - Phase 3a（16 處）：per-event 查詢改子集合直接查詢（firebase-crud.js 4 處、6 個 event modules、api-service.js、CF 3 處）
  - Phase 3b（12+ 處）：監聽器改 collectionGroup + 去重過濾、跨活動查詢改 collectionGroup（firebase-service.js 7 處、achievement-batch/attendance-notify/event-host-list/app.js、CF calcNoShowCountsBatch+backfillAutoExp 7 處）
  - Phase 3c：移除 per-event cache workaround（_eventAttendanceMap/fetchAttendanceRecordsForEvent）
- **教訓**：collectionGroup 去重（`doc.ref.parent.parent !== null`）是 Phase 3b 最關鍵步驟，漏加會導致資料 2x。CF 用 Admin SDK 需改用 `d.ref.path.split('/').length > 2`
- **下一步**：觀察期 3-7 天，確認無異常後進 Phase 4（移除雙寫 + 遷移觸發器）

### 2026-04-12 — Phase 1 完成：子集合雙寫層（49 個寫入點）
- **問題**：Phase 0 基礎設施已部署，需實作雙寫層讓所有寫入同時寫全域集合 + 子集合
- **修復**：16 個檔案新增雙寫邏輯（firebase-crud.js 11 點、8 個 event modules 30 點、achievement-batch+app 2 點、CF registerForEvent+cancelRegistration 6 點）
- **關鍵修正**：計劃書原稱 KNOWN_REFERENCES 不需更新，但 migration-path-coverage 的 regex 會匹配子集合鏈中的 `.collection('registrations')`，所有計數必須同步更新
- **教訓**：CF 行號因 Phase 0 新增 migrateToSubcollections 而偏移 ~300 行，實作時需以程式碼搜尋為準而非計劃書行號

### 2026-04-12 — 子集合遷移計劃書 v5 + 自動化測試安全網
- **問題**：Firestore 全域集合遷移到子集合的計劃書經 5 輪審計（33 處修正），需在實作前建立測試安全網
- **修復**：新增 4 個測試檔 + 1 個驗證腳本（migration-path-coverage 6 tests、subcollection-utils 22 tests、subcollection-rules 16 tests、migration-verify.js 4 階段驗證）
- **教訓**：遷移路徑覆蓋率測試可自動偵測新增的 db.collection() 引用是否在遷移計劃涵蓋範圍內；Emulator 測試必須顯示 skip 而非靜默 pass

### 2026-04-11 — [永久] calcNoShowCounts doc.id vs data.id 錯配 — 全站放鴿子算出 0
- **問題**：Cloud Function `calcNoShowCounts` 部署後計算出全站 0 次放鴿子，users 文件的 `noShowCount` 始終為 undefined
- **原因**：events 集合的 Firestore 文件 ID（`doc.id`，如 `ga0CqtaPpjRwimUGEZfU`）與活動自訂 ID（`data.id`，如 `ce_1774920121549_j63p`）**不同**。CF 用 `doc.id` 建 `endedEventIds`，但 `registrations.eventId` 存的是 `data.id`，`endedEventIds.has(reg.eventId)` 永遠 false → 所有報名都被 skip → 0 次放鴿子
- **修復**：`endedEventIds.add(data.id || doc.id)` + `.select()` 加入 `"id"` 欄位
- **教訓**：見下方 [永久] events 雙 ID 地雷

### 2026-04-10 — [永久] 放鴿子統計改為後端預算（Cloud Function calcNoShowCounts）
- **問題**：放鴿子次數在前端即時計算，依賴全域 attendanceRecords 快取（有 onSnapshot limit），超出 limit 的舊活動 checkin 紀錄被截斷，導致有簽到的用戶仍被誤判為放鴿子
- **原因**：`_buildRawNoShowCountByUid()` 呼叫 `getAttendanceRecords()` 無 eventId，走全域快取，受 limit 截斷
- **修復**：
  - Cloud Function `calcNoShowCounts`（排程每小時正點）+ `calcNoShowCountsManual`（callable 手動觸發）
  - 後端直接查 Firestore（無 limit）：已結束活動 + confirmed 報名 + 無 checkin → 計為放鴿子
  - 結果寫入 users 文件的 `noShowCount` 欄位
  - 前端 `_buildRawNoShowCountByUid` 改為從 users 快取讀取，不再跨集合即時算
  - 管理後台「系統資料同步」新增「⑧ 放鴿子次數重算」按鈕
- **教訓**：
  - 跨集合的全域統計不適合在前端即時計算，資料量增長後必然撞到 limit 天花板
  - 正確架構：後端定時算 → 結果掛在實體文件上 → 前端只讀
  - 補正系統（correction）與原始計數分離，改了計數來源不影響補正邏輯

### 2026-04-10 — 簽到紀錄因 onSnapshot limit 部分遺漏 — 改用 per-event 直接查詢
- **問題**：部分活動的簽到簽退紀錄在管理頁面看不到，有些有、有些沒有，不分新舊
- **原因**：同日稍早的費用優化加上 `attendanceRecords` onSnapshot `.limit(1500)`，全站簽到紀錄超過此上限時，部分活動的紀錄被排除在前端快取外。調到 3000 仍有遺漏
- **修復**：
  - `FirebaseService.fetchEventAttendanceRecords(eventId)` — 按 eventId 直接 `.where().get()`，繞過全域 limit
  - `ApiService.fetchAttendanceRecordsForEvent(eventId)` — per-event cache + 並發去重 + Demo fallback
  - `getAttendanceRecords(eventId)` — 優先讀 per-event cache，無則 fallback 全域快取
  - `_renderAttendanceTable` 改為 async，渲染前先 `await fetchAttendanceRecordsForEvent`
  - 寫入路徑（add/remove/batch）成功後同步更新 per-event cache
  - onSnapshot 觸發時清除 per-event cache，確保遠端寫入可見
- **教訓**：
  - 全域 onSnapshot limit 適合即時列表，但特定資源的完整查詢必須走獨立 `.get()`
  - 快取分層：全域快取（有 limit，供列表）+ per-event cache（無 limit，供詳情頁）
  - 寫入後必須同步更新 per-event cache，否則同步讀取會落回不完整的全域快取

### 2026-04-10 — Firestore 費用優化：onSnapshot limit + Functions 降頻 + 儀表板可調
- **問題**：10 天費用 ~500 TWD。Firestore 每日 177 萬次讀取（onSnapshot 無 limit 監聽全集合）、Cloud Run 92,973 秒/天（autoEndStartedEvents 每分鐘 + createCustomToken minInstances:1）
- **原因**：attendanceRecords / registrations / events 的 onSnapshot 無 .limit()，每次資料變動重讀全集合；autoEndStartedEvents 每分鐘跑但幾乎 0 更新；fetchUsageMetrics 每小時跑
- **修復**：
  - 第一刀（前端）：三個監聽器加 .limit()，值可在儀表板動態調整（存 siteConfig/realtimeConfig）
    - attendanceRecords: .orderBy('createdAt','desc').limit(1500)
    - registrations admin: .orderBy('registeredAt','desc').limit(3000)
    - events: .where(...).limit(100)
  - 第二刀（後端）：autoEndStartedEvents `*/5` + 128MiB；fetchUsageMetrics 每 6 小時
  - 儀表板設定卡片：admin 以上可即時調整三個 limit 值（100~10000），用戶切頁/重開生效
- **教訓**：
  - onSnapshot 無 limit = 費用隨歷史資料永遠增長，必須加上限封頂
  - 統計查詢用獨立 .get()（不走監聽器），limit 不影響統計正確性
  - 排程函式只能預熱自己，不能幫其他函式預熱
  - createCustomToken 是登入關鍵路徑，不應降記憶體

### 2026-04-10 — 庫存系統頁籤管理功能（顯示名稱映射）
- **需求**：讓用戶自訂庫存頁面群組頁籤的顯示名稱（商品/活動/器材/其他）
- **設計決策**：採用「顯示名稱映射」方案，而非「重新命名 group 欄位」。內部 group 值永不改變，僅在 Firestore `inv_stores/{storeId}.groupTabNames` 存映射表。此設計消滅了 8/15 個潛在 Bug（含批次更新失敗、資料一致性、快取同步等致命問題），且單筆 Firestore 文件寫入天然原子。
- **修改範圍**：`inv-products.js`（新增 `_groupTabNames`、`loadGroupTabs()`、`_groupLabel()` + 15 處顯示點套用）、`inv-store.js`（切換倉庫重置映射）、`inv-auth.js`（登入後載入映射）、`inv-permissions.js`（新增 `settings.group_tabs` 權限碼）、`inv-settings.js`（頁籤管理卡片 + 改名彈窗 + 還原功能）、`inv-sale.js`（購物車拆分品名稱映射）、`inv-utils.js`（log label）、`index.html`（切換庫存按鈕 + 版號 82）
- **教訓**：當需要「重新命名」一個被多處引用的值時，優先考慮「映射/別名」方案而非「批量替換原始值」，可大幅降低資料一致性風險

### [永久] 2026-04-09 — _isUserSignedUp displayName fallback 同名碰撞 bug
- **問題**：兩個不同用戶同名 "Lucas"，`_isUserSignedUp` 的 displayName fallback 用名字比對 `event.participants`，導致未報名的用戶被誤判為已報名，看到「取消報名」按鈕但無法取消（`getMyRegistrationsByEvent` 正確用 UID 查不到報名紀錄）
- **原因**：`event.participants` 存的是 displayName（非 UID），fallback 用 `p === name` 比對，同名即中招
- **修復**：移除 `_isUserSignedUp` 和 `_isUserOnWaitlist` 中的 displayName fallback，僅保留 UID 比對 registrations 快取。經驗證全部 49 個活動都有 registration 文件，fallback 無存在必要
- **教訓**：`event.participants` 是顯示用快取，不可用於身份判斷。所有身份相關判斷必須基於 UID，displayName 是用戶可任意修改的欄位

### 2026-04-09 — 球隊限定活動報名：後端未檢查職員身分
- **問題**：前端 `_getVisibleTeamIdsForLimitedEvents()` 會掃描 teams 集合，將 captain/leader/coach 也納入可報名範圍；但後端 Cloud Function `getUserTeamIds()` 只查用戶文件的 `teamIds`/`teamId`，不查 teams 集合的職員欄位。導致職員看到報名按鈕但實際報名被 `TEAM_RESTRICTED` 擋回。
- **修復**：`functions/index.js` 的 `submitShotGameScore` 旁的 `submitRegistration` Transaction 內，當 `teamIds` 比對失敗後補查 teams 集合的 `captainUid`/`leaderUid`/`captain`/`leader`/`coaches` 欄位，與前端邏輯對齊。
- **教訓**：前後端的權限/資格判定邏輯必須同步維護，前端新增判定路徑時要檢查後端是否也需要對應更新。

### [永久] 2026-04-07 — 寫入安全重構 Phase 1-5 + 同步指示器
- **問題**：8 項高風險 + 9 項中風險 Firestore 寫入用 fire-and-forget（`_update()`），失敗時 cache 汙染。鎖定函式在 `batch.commit()` 前改 live cache，違反 Rule #10
- **修復**：
  - Phase 1-3：新增 `updateEventAwait/TeamAwait/CurrentUserAwait`（snapshot + await + 失敗回滾）+ 全域同步指示器
  - Phase 4：_cleanupCancelledRecords batch 化；deleteTournamentAwait 分批 + 子集合獨立容錯
  - Phase 5（鎖定函式）：H6 遞補/H7 降級/H4 移除 → clone → simulate → commit → apply（模擬先行）
- **教訓**：
  1. `_update()` fire-and-forget 是系統性債務，關鍵寫入應改 `_updateAwaitWrite` 模式
  2. Rule #10 適用於所有 batch/transaction 路徑
  3. post-commit 寫回必須重新查詢 `ApiService._src()` live array（防 onSnapshot 替換 stale reference）

### [永久] 2026-04-06 — 角色卡在 user（兩輪修復，5 層防護完成）
- **問題**：總管角色偶爾卡在 user，LINE 放背景 → LIFF token 過期但 Firebase Auth 存活 → 退化路徑
- **根因**：`_startAuthDependentWork` 的 `BUILTIN_ROLE_KEYS.includes()` 條件跳過內建角色的 `applyRole`（三位專家一致認定）
- **修復（5 層）**：(1) init 讀 cache 不硬編碼 user (2) catch 也 applyRole (3) 移除 renderLoginUI 直接賦值 (4) 移除 BUILTIN_ROLE_KEYS 條件 (5) snapshot 新增 `App.currentRole !== next.role` 比對
- **教訓**：角色設定必須走 `applyRole()` 統一入口；權威解析完成後必須無條件套用；snapshot 的 roleChanged 無法偵測 UI 層損壞

### [永久] 2026-04-06 — 全站捲動跳頂問題修復（含簽到跳頂）
- **問題**：活動詳情、候補名單、訊息列表、俱樂部列表等，onSnapshot/SWR re-render 時捲動重置
- **根因**：`innerHTML` 全清式渲染 + attendance onSnapshot 觸發整頁重渲染 + early-return 漏掉 scrollTop 還原
- **修復**：8 處加 scrollTop save/restore；attendance source 只更新表格不重繪整頁；showEventDetail 同活動時 `{ resetScroll: false }`
- **教訓**：onSnapshot 資料刷新 ≠ 頁面導航；每次加 scrollTop 保護時必須檢查所有 early-return 路徑

### [永久] 2026-04-06 — Log 彈窗操作日誌排序修復（跨 7 次迭代）
- **根因鏈**：本地快取載入時機不確定 → Firestore orderBy 需複合索引靜默失敗 → `self._method()` this 綁定問題
- **最終修復**：直接查 Firestore（不加 orderBy 不需索引）+ 閉包 `_toMs` 函式 + `entries.sort(b.ms - a.ms)`
- **教訓**：async modal 需資料時直接查 Firestore；Firestore 複合查詢缺索引靜默回傳空；深層回調用閉包函式避免 this 問題

### 2026-04-06 — 運動項目切換 + 空結果指紋修復
- **修復**：解鎖運動選單、`'all'` 字串不用空字串；空結果時重置指紋（`_hotEventsLastFp = ''`）防跳過 re-render
- **教訓**：建立表單的 picker 與頂部 picker 完全隔離

### 2026-04-06 — 備註即時儲存 + 操作日誌 eventId 精確查詢
- note input 加 1s debounce 即時儲存；`_writeOpLog` 加 optional `eventId`，彈窗先精確查再 fallback 舊方式

### 2026-04-05 — 放鴿子 race condition + opLog 欄位名修正
- `_buildNoShowCountByUid` 加 `_attendanceSnapshotReady` 旗標，未就緒回傳 null
- opLog 欄位名 `log.action`→`log.type`、`log.detail`→`log.content`

### [永久] 2026-04-04 — 重複報名導致假額滿（三層防線修復）
- **問題**：同一用戶兩筆 confirmed registration，三道防線同時失效
- **原因**：(1) CF `doc(eventId)` 把邏輯 ID 當 doc ID（上線以來從未成功）(2) 前端 `.get()` 回傳離線快取 (3) `_rebuildOccupancy` 不去重
- **修復**：CF 改 `.where("id","==",eventId)`；前端 `.get({ source: 'server' })`；`_rebuildOccupancy` 加三元組去重
- **教訓**：event.id ≠ Firestore doc ID；enablePersistence 下 `.get()` 必須加 `{ source: 'server' }`；計數核心必須內建去重

### [永久] 2026-04-04 — 候補遞補排序失效（Timestamp 未轉換）
- **問題**：cancelRegistration 從 Firestore 讀取 registrations 時未轉換 Timestamp → `new Date(Timestamp)` = NaN → 排序隨機
- **修復**：加入 `data.registeredAt?.toDate?.()?.toISOString?.() || data.registeredAt`
- **教訓**：Firestore Timestamp 轉換必須在每個 `.docs.map()` 中執行，此類 bug 不報錯只靜默產生錯誤排序

### 2026-04-04 — 手動簽到即時儲存（Instant Save）
- checkbox 300ms debounce 自動寫 Firestore，per-UID sequential queue，失敗自動還原 + 閃紅
- **教訓**：eventId 不可用 closure 綁死，必須讀 `_attendanceEditingEventId`

### 2026-04-03 — 庫存系統 inv_transactions 權限修復
- **教訓**：Firestore Rules 欄位名必須與程式碼寫入的欄位完全一致

### 2026-04-02 — 首次登入 modal 繞過漏洞修復
- navigation.js showPage()/goBack()/hashchange 全加首次登入守衛；toggleModal 雙向 locked 檢查
- **教訓**：導航守衛必須覆蓋所有路徑，遺漏任一都是繞過漏洞

### 2026-04-02 — 編輯活動地區未預選 + HTML `&amp;` 教訓
- region 有值但 cities 為空 → 自動填入 `REGION_MAP[region]`
- **教訓**：新增欄位要考慮舊資料 fallback；onclick 屬性中 `&` 被編碼為 `&amp;`

### [永久] 2026-04-02 — LINE Mini App 首次登入彈窗不顯示（嚴重用戶流失）
- **原因**：`PageLoader.loadAll()` 非同步，LIFF 瞬間登入 → `showModal()` 時 HTML 還沒載完 → null → 靜默失敗
- **修復**：`_showFirstLoginWhenReady()` 每 300ms 重試（最多 10 次）
- **教訓**：依賴動態載入 HTML 的 showModal 必須加重試機制

### 2026-04-02 — Tournament P0-P2 production fixes
- **教訓**：`color-mix()` LINE WebView 不支援，用 rgba；涉及配額寫入應即時重讀最新狀態

### 2026-04-01 — 分隊功能多項修補
- 編輯時開關不顯示、均分無反應、jersey picker onclick 單引號避免 JSON.stringify 破壞
- **教訓**：checkbox `display:none` + `<label for>` 在 LINE WebView 不可靠

### [永久] 2026-04-01 — Cloud Function .catch() 靜默吞錯
- **起因**：開球王成績提交 `.catch(function () {})` 靜默吃掉所有錯誤
- **教訓**：CF 呼叫的 `.catch()` 絕不可用空函式靜默吞錯

### [永久] 2026-04-01 — 權限守衛新增規則 + 委託人權限
- **起因**：`event.view_registrations` 守衛讓所有 user 看不到報名名單；委託人按鈕可見但 hasPermission 擋住
- **規則**：(1) 查看類功能預設開放 (2) 守衛必須有 `_canManageEvent` fallback (3) 按鈕可見性與功能一致 (4) delegate 只需簽到+掃碼 (5) 每一層都需一致的 delegate 例外

### 2026-03-31 — 翻譯功能 + 推播通知開關
- 翻譯排除用 `data-no-translate` 源頭標記（16 檔 34 處），不靠啟發式規則
- 推播通知 Firestore Rules 以「文件 + 欄位」雙層收斂

### [永久] 2026-03-31 — Demo 死代碼全面移除（方案 C）
- 移除所有 isDemo/DemoData 引用（247 處 / 61 檔案）
- **教訓**：`if (!isDemo()) { prod }` 和 `if (isDemo()) { demo } else { prod }` 是兩種不同的刪除模式

### [永久] 2026-03-31 — 權限架構安全審查結論
- users 欄位白名單無漏洞；hasPerm() 讀取成本在免費額度內；INHERENT_ROLE_PERMISSIONS 兩地同步

### [永久] 2026-03-30 — 權限系統統一重構（Phase 1-4）
- 移除 17 頁 data-min-role、替換 22 處為 hasPermission()
- **教訓**：新頁面必須先加入 DRAWER_MENUS permissionCode

### [永久] 2026-03-30 — 手機日期選擇器 auto-fill 陷阱
- iOS/Android 開空 `input[type=date]` 自動填今天觸發 change → focus/change/blur 三段式 picker session
- **教訓**：`input[type=date]` 的 change 在手機上可能觸發多次，必須用 blur 確認最終值

### [永久] 2026-03-30 — 報名按鈕「載入中」卡住
- `_registrationsFirstSnapshotReceived` flag + 3 次重試後強制解除
- **教訓**：cache-first 架構必須區分「尚未載入」和「載入完成但為空」

### [永久] 2026-03-27 — Per-User Inbox 遷移 + 教育頁面即時渲染
- Inbox：465 用戶 2744 訊息遷移；Rules 限 CF 寫入。**教訓**：遷移歷史必須在切讀取之前
- 教育：eduSubPages 缺頁 → listener 被停。**教訓**：新增子頁面必須同步更新 eduSubPages + _renderPageContent

### [永久] 2026-03-26 — 教育簽到安全強化 + 彈窗定位 + 裁切比例
- 簽到走 CF + Rules 封鎖前端寫入。**教訓**：可審計資料必須由後端寫入
- `.page` 的 transform 建立新 containing block 使 fixed 失效 → JS 動態掛載 body
- **全站裁切比例**：封面 8/3、商品圖 4/3、banner 2.2、浮動廣告 1、彈窗 16/9
- teams `doc.id` ≠ `data.id`，CF/Map key 都需雙 key

### [永久] 2026-03-20 — 候補邏輯修復 + 快取清除角色降級 + 首次登入按鈕無反應
- 候補：降級時 activityRecord 必須同步更新；cancelCompanionRegistrations 改 5 階段模式
- 快取清除：必須先 auth.signOut() + liff.logout() 再清 localStorage
- 首次登入：懶載入模組方法不能綁 UI 事件；inline handler 執行時才解析 App

### [永久] 2026-03-19 — CDN 快取排查 + cancelRegistration 快取提前寫入
- **快取排查順序**：Cloudflare CDN → LINE WebView → Service Worker → 瀏覽器快取
- LINE WebView 快取需數小時～24 小時過期
- **教訓**：所有 Firestore 寫入，本地快取必須在 `await commit()` 之後才修改

### [永久] 2026-03-18 — 啟動 / 通知 / 鎖定 / 同步 / EXP / 建立活動（6 項系統性修復）
- 首次造訪卡空框架：loading overlay 移除須以「用戶可見內容就緒」為依據
- LIFF bounce 無限迴圈：改用 UA 偵測，不依賴 storage（LINE webview 隔離環境）
- 站內信失效：「任何頁面都可能觸發」的功能，依賴鏈必須在主載入階段就緒
- _flipAnimating 卡死：全域 boolean 鎖需 finally 保底 + 超時解鎖 + 頁面切換清理
- 跨裝置不同步：visibilitychange 刷新 + onSnapshot 重連 + localStorage UID 隔離
- EXP 全面修復：所有發放路徑（報名/取消/掃碼/確認/遞補）必須同時檢查
- 建立活動無反應：`finally` 不應用於重置 UI 鎖；關鍵收尾必須放在非關鍵操作之前

### [永久] 2026-03-17 — UID 一致性 + 統計汙染 + status 不匹配 + 孤兒誤刪 + 權限 seed
- UID：寫入 uid 必須是 LINE userId；歷史修正用 CF Admin SDK
- _userStatsCache：全域統計函式不能依賴單一用戶快取
- registrations 用 `confirmed` / activityRecords 用 `registered`：修改 status 過濾時追蹤所有來源
- 成就 status 必須與 CRUD 層一致
- event 有兩個 ID（doc.id ≠ data().id）；批量刪除必須先 dry-run
- _showPageStale：所有進入 _renderPageContent 的路徑必須有 ensureForPage 前置
- 新增入口權限後必須 bump catalog version 觸發 seed

### [永久] 2026-03-21 — 面板碰撞彈飛失效
- **教訓**：物理碰撞判定必須在同一個更新階段完成

### [永久] 2026-03-16 — 成就系統遷移 + 鎖定/解鎖
- 進度存 `users/{uid}/achievements/{achId}` 子集合；三道防火牆
- `locked` 預設 true，解鎖時 current < threshold 會撤銷

---

## [永久] UID / 資料完整性地雷

- 歷史 attendanceRecords uid 已透過 CF migrateUidFields 修正，寫入路徑已修復
- `event.participants` 存的是顯示名稱，絕不能直接作為 uid
- save loop 必須有「使用者有意操作」的證據，不能用 fallback 預設值推導刪除意圖
- 欄位對照：`users`→`uid`/`lineUserId`、`registrations`→`userId`、`attendanceRecords`→`uid`、`activityRecords`→`uid`、`events`→`creatorUid`
- UID mismatch 時強制重新登入/刷新 token

---

## [永久] 報名系統核心架構

- 所有 current/waitlist 變更必須透過 `_rebuildOccupancy()` 統一重建，禁止手動 current++
- registrations 查詢必須在 transaction callback 內
- cancelRegistration：commit 成功後才寫入本地快取（模擬模式）

---

## [永久] 資料來源與同步規則

- **registrations 是唯一權威資料來源**（activityRecords 是衍生資料）
- 統計關鍵集合不可設 limit
- 完成判定必須交叉比對 attendanceRecords（checkin + checkout）

---

## [永久] 權限 / Auth 模式

- 權限敏感欄位（exp/role）寫入走 CF + Admin SDK
- 權限治理三層同步：UI 按鈕、Firestore Rules、Cloud Functions
- `INHERENT_ROLE_PERMISSIONS` 兩地同步（config.js + functions/index.js）
- admin 入口權限由 super_admin 在 UI 啟閉

---

## [永久] Firestore Rules 模式

- 規則不是查詢後過濾器，前端必須先縮成規則可證明合法的查詢
- 候補遞補是跨用戶操作，batch 中每筆寫入都必須符合 rules

---

## [永久] 啟動 / 快取 / 性能架構

- 冷啟動分層：boot collections 不等 Auth；Auth 完成後背景啟動 listeners
- PAGE_STRATEGY：stale-first / stale-confirm / prepare-first / fresh-first
- seed 類初始化必須是「只補缺」而非「覆蓋預設」

---

## [永久] Deep Link / 登入 / 外部瀏覽器

- deep link + auth redirect + SPA 三者交會需注意資料就緒時序
- LIFF redirect 不保留 URL query params，跨 redirect 狀態存 sessionStorage
- `liff.getProfile()` 在外部瀏覽器不 100% 可靠，需 API fallback

---

## [永久] 通用開發模式

- Firestore 操作不應靜默回傳 false，應統一用 throw
- SPA 中 innerHTML 重建會摧毀注入的 DOM，載入狀態必須獨立於 DOM 追蹤
- iOS Safari 需 `-webkit-` 前綴；`100dvh` 需 `100vh` fallback；`replaceAll` 不可用
- 表單預設值：需同時檢查初始化、回填、toggle 補值與 reset

*最後清理日期：2026-04-07*
*原始檔案：449 行 → 清理後約 195 行*

### 2026-04-14 — 俱樂部×賽事重構 Phase 1b — 賽事結構整理 + 全域任務
- **問題**：賽事模組結構需要與俱樂部模組同步整理（Phase 1a 已完成俱樂部部分）
- **修復**：
  - 新建 `tournament-helpers.js`（9 個純工具函式從 tournament-core.js 抽出）
  - 新建 `tournament-share-builders.js`（3 個 Builder 從 tournament-share.js 抽出）
  - 刪除 `tournament-detail.js` 死代碼（renderLeagueSchedule / renderBracket）
  - 全域狀態收進 `_tournamentFormState` / `_teamFormState` 物件
  - 更新 `script-loader.js` — tournament group 新增 helpers / core / render / share-builders
  - 統一 6 處 ID 生成為 `generateId(prefix)`（fp_ / fc_ / ct_ / ce_ / reg_ / ta_）
  - 新增 3 個賽事權限碼：end / reopen / delete（config.js + user-admin-perm-info.js）
- **教訓**：Phase 1 結構整理不改邏輯，舊入口保留為 facade，降低回歸風險

### 2026-04-28 — 賽事建立與審核改為後端原子流程 [永久]
- **問題**：友誼賽建立與審核曾由前端分多筆寫入 root / applications / entries / registeredTeams，可能被 Rules 擋住或留下半成功資料；同時 `admin.tournaments.entry/manage_all` 與 record-scope 權限語意容易混淆。
- **原因**：client batch 無法可靠證明同批 root+entry 已存在；Web client 直接 update application status 會繞過 entry 建立與 root summary 更新；前端部分守衛把入口權限當成全域管理權。
- **修復**：新增 `createFriendlyTournament` / `reviewFriendlyTournamentApplication` callable，以 Admin SDK 原子建立 root+host entry、審核時同步 application/entry/root summary；`tournaments/{id}` root create 與 applications update/delete 改 callable-only；前端改走 atomic wrappers，權限 helper 對齊 admin role + creator/delegate/host officer。
- **教訓**：跨文件生命週期不可讓 Web client 分段寫入；入口權限只代表能進頁面，record-scope 操作必須由 role 或資料關係重新驗證，且 Rules / callable / UI 三層要同時對齊。

### 2026-04-28 — 活動月曆改為運動場次彙總
- **問題**：月曆日期格原本列出單筆活動卡，手機窄版資訊密度高，跨運動日程不易快速判斷各運動有幾場。
- **原因**：月曆渲染沿用 timeline 的單活動思維，沒有把同日活動依 `EVENT_SPORT_OPTIONS` 順序彙總。
- **修復**：日期格改為先套用既有地區/運動/類型/關鍵字篩選，再依 sportTag 彙總成 `<運動圖示>x<數量>`；All 模式按足球、籃球、匹克球、美式躲避球等設定順序顯示，單一運動篩選只顯示該運動數量。
- **教訓**：月曆視圖應優先回答「哪天有哪些運動、各幾場」，詳情導覽交給時間軸；新增月曆樣式時拆小 CSS 檔，避免繼續膨脹既有大型樣式檔。

### 2026-04-28 活動月曆今日框只標本月日期 [輕型]
- **問題**：月曆為了補滿週列會顯示前後月日期；若補位格日期剛好等於今天，補位格與實際本月日期都會出現綠色 today 框。
- **原因**：`isToday` 只比對 `dateKey === todayKey`，沒有排除 `isOutside` 補位格。
- **修復**：新增 `_isCalendarCellToday(dateKey, isOutside, todayKey)`，只讓非補位格且日期等於今天的格子輸出 `data-today="1"`。
- **教訓**：月曆跨月補位格只負責排版連續性，不應承接「今天」這類本月狀態樣式。

### 2026-04-28 賽事頁切換卡頓修正 [中型]
- **問題**：清除快取或版本更新後切到賽事頁會頓，主因是 `page-tournaments` 被綁到完整賽事詳情群組，冷啟動還會在 idle 階段執行活動、隊伍、賽事、個人頁大量 JS。
- **根因**：賽事列表只需要 helper/core/render，卻載入 detail、roster、notify、share 等詳情模組；列表進頁還等待 standings/matches 靜態集合，與 realtime tournaments 重複拉扯。
- **修正**：新增 `tournamentList` / `tournamentDetail` 群組，列表只載列表模組，詳情才載完整模組；核心頁預熱改成 network preload hint，不再自動執行所有核心頁 JS；賽事 HTML 納入 boot pages 讓 stale-first 可立即啟用；賽事列表改成 shell-first，可先啟用頁面再背景等 cloud；賽事列表資料依賴縮成 tournaments，realtime 啟動改立即，onSnapshot 渲染延後 80ms。
- **提醒**：若未來賽事列表新增需要詳情專用能力，先放到 detail 群組，列表群組只保留首屏渲染必需檔案。


### 2026-04-28 Profile page navigation performance [Medium]
- Problem: page-profile loaded the full achievement page bundle and the color-cat profile scene during first navigation, so cache clears or new cache versions could make the bottom nav feel briefly unresponsive.
- Cause: ScriptLoader tied achievement/profile extras to page-profile, and navigation immediately rendered the hidden user card plus _initProfileScene().
- Fix: split profile into base, achievementProfile, profileCard, profileShare, and profileScene groups. page-profile renders visible data first, then idle-loads achievement stats, records, and the color-cat scene.
- Guard: leaving page-profile increments _profileDeferredSeq and destroys the scene so deferred tasks do not write DOM after page switches.

### 2026-04-28 賽事報名與球員名單改為 callable 原子流程 [瘞訾?]
- **問題**: 友誼賽參賽申請與球員名單仍可由 Web client 直寫 Firestore；主辦方也缺少在賽事詳情「俱樂部」頁籤直接剔除已核准隊伍的完整流程。
- **風險**: 惡意或舊版前端可能繞過前端檢查，造成 application / entries / root registeredTeams / members 不一致；冷啟賽事詳情若未載入 team-list helper，也可能誤判使用者隊伍狀態。
- **修補**: 新增 `applyFriendlyTournament`、`joinFriendlyTournamentRoster`、`leaveFriendlyTournamentRoster`、`removeFriendlyTournamentEntry` callable，統一由後端驗證賽事狀態、隊伍幹部、隊伍資格、名單解鎖與 root summary；前端改呼叫 callable，俱樂部頁籤加入非主辦隊伍「剔除」操作。
- **權限**: `applications` create/update/delete 改 callable-only；`entries` / `members` 僅保留 admin 直寫作 legacy cleanup，一般主辦/建立者/隊員改走 callable。
- **測試**: `npm test` 67 suites / 2500 tests passed；`npm run test:rules` 2 suites / 448 tests passed。

### 2026-04-28 賽事俱樂部頁籤剔除按鈕固定右側 [輕型]
- **問題**: 主辦方剔除報名隊伍的 callable 流程已存在，但俱樂部頁籤沒有穩定呈現右側操作入口，管理者容易看不到剔除按鈕。
- **原因**: 剔除按鈕直接接在 roster 欄後方，缺少固定 action slot 與渲染測試保護。
- **修補**: 非主辦、已核准隊伍改用 `tfd-team-action` 右側操作欄與 `tfd-entry-remove-btn`；按鈕仍走既有 `removeFriendlyTournamentEntry`，會先彈出二次確認才呼叫 callable。
- **驗收**: 新增 `tests/unit/tournament-friendly-detail-view.test.js`，確認管理者只會在非主辦已核准隊伍看到剔除按鈕。

### 2026-04-28 近期首頁與導覽效能修正補登 [中型]
- **問題**: 清快取或新版號後，首頁 banner、近期賽事與 hash reload 導覽容易出現載入慢、先回首頁再跳頁或底部導覽短暫不靈敏。
- **原因**: boot 階段仍會先處理首頁資料與圖片；hash 目標頁沒有足夠早地標記 priority；banner/tournament 首屏資料沒有穩定 boot seed，頁面切換時需要等待 cloud/cache 回填。
- **修補**: `app.js` / `page-loader.js` / `navigation.js` 讓 hash 目標頁提早啟用 shell 與 priority；首頁 banner 與近期賽事加入 boot preload/seed；`firebase-service.js` 降低 tournament 首次導覽的 blocking 成本。
- **驗收**: `tests/unit/boot-hash-navigation.test.js`、`tests/unit/navigation.test.js`、`tests/unit/tournament-loading-performance.test.js` 覆蓋 hash reload、priority preload 與賽事冷啟動路徑。

### 2026-04-28 首頁 banner 空白輪播修正補登 [中型]
- **問題**: banner 輪播只顯示第一張，其餘 slide 可能是空白，且 boot cache stale 時會把舊資料帶回首頁。
- **原因**: banner render 對無效圖片/空 URL 沒有足夠過濾，boot seed 與快取修復順序也可能讓 stale banner 覆蓋新資料。
- **修補**: `banner.js` 過濾可顯示的 active banner 並避免空 slide；`app.js` 的 banner boot cache 路徑補 stale repair；更新首頁 inline version 避免 Service Worker 留住舊輪播。
- **驗收**: `tests/unit/banner-carousel.test.js` 新增/更新 banner 輪播資料檢查，確認不會渲染空白 slide。

### 2026-04-28 俱樂部頁開啟速度修正補登 [中型]
- **問題**: 俱樂部頁在新版號或清快取後首次開啟偏慢，使用者會感覺頁面被 script 載入與統計計算卡住。
- **原因**: `ScriptLoader` 原本把列表、詳情、表單模組綁成同一個 team group；列表首屏需等不必要的 detail/form/education 模組載入後才較完整。
- **修補**: 將 team script group 拆成 `teamList` / `teamDetail` / `teamForm`，`page-teams` 只載列表必要模組；列表統計與圖片資料改用 shell-first / deferred path，降低首次導覽主執行緒成本。
- **驗收**: `tests/unit/script-loader.test.js` 與 `tests/unit/tournament-loading-performance.test.js` 確認 page group 拆分與非首屏模組不阻塞列表頁。

### 2026-04-28 賽事封面裁切與上傳體驗補登 [輕型]
- **問題**: 新增/編輯賽事封面只有基本上傳，沒有活動封面同等的圖片裁切調整體驗。
- **原因**: 賽事表單只接舊上傳 helper，未接入全站 image cropper 的封面比例與 preview 流程。
- **修補**: `tournament-manage-form.js`、`tournament-manage.js`、`tournament-manage-edit.js` 接入封面 cropper，讓賽事封面與活動封面一致支援裁切/預覽/儲存。
- **驗收**: `tests/unit/tournament-image-upload.test.js` 覆蓋 create/edit 表單的 image cropper 綁定與上傳 helper 路徑。

### 2026-04-28 賽事詳情頁重新整理路由補登 [中型]
- **問題**: 在賽事詳細頁重新整理後，畫面可能先顯示預設骨架或首頁狀態，之後才回到正確賽事，造成「賽事名稱/圖片 placeholder」殘留感。
- **原因**: deep link / hash route 與 tournament detail state 載入順序不同步，friendly detail 的 state promise 與 `currentPage` 檢查沒有完整保留 refresh 前路由意圖。
- **修補**: `app.js` / `navigation.js` / `tournament-detail.js` / `tournament-friendly-detail.js` 保留 tournament detail route，讓 refresh 直接走 detail shell 並在資料到位後再渲染內容。
- **驗收**: `tests/unit/boot-hash-navigation.test.js` 與 `tests/unit/navigation.test.js` 補 detail route refresh guard，避免 stale route 覆蓋目前頁面。

### 2026-04-28 首頁活動 inline 資料補登 [輕型]
- **問題**: 首頁近期活動雖已優化，但新版部署後仍需要穩定把熱門/近期活動 seed 到 HTML，降低清快取後第一屏等待。
- **原因**: 首頁活動依賴 Firebase/cache 回填時，慢網路或新版 SW 交替會讓第一屏短暫缺資料。
- **修補**: `scripts/inject-hot-events.js` 於部署前更新 `index.html` boot events data，讓首頁可以先用 inline 資料渲染，再由 cloud freshness 補正。
- **驗收**: 兩次 `chore(perf): 自動 inline 首頁活動` commit 已更新 HTML seed；後續若活動資料大幅變動，部署前需再次執行同一流程。

### 2026-04-29 — 新建賽事主辦俱樂部懶載入修正
- **問題**：使用者直接進賽事頁按「建立賽事」時，可能顯示「目前沒有可代表建立賽事的主辦俱樂部」；切到俱樂部頁再回來後卻正常。
- **原因**：賽事列表頁為了冷啟速度只載入 `tournaments`，未載入 `teams`；建立表單卻立即用 `ApiService.getTeams()` 判斷可代表的主辦俱樂部，導致 teams 快取尚未載入時誤判。另 `_getTournamentSelectableHostTeams()` 與建立權限的 admin 判斷不一致。
- **修復**：`openCreateTournamentModal()` 改為先懶載入 `teams` 與使用者 teamIds 對應俱樂部，再重新判斷建立資格；建立按鈕加入「載入中...」狀態；主辦俱樂部選單改用 `_isTournamentGlobalAdmin()` 對齊既有權限 helper；補 `tournament-permissions` 與 `tournament-loading-performance` 測試。
- **教訓**：效能優化拆掉頁面初始資料依賴後，所有按需功能都要在入口補自己的資料契約，避免被其他頁面載入過快取的副作用掩蓋。

### 2026-04-29 — 參加賽事 loading 與隊伍退出流程 [永久]
- **問題**：友誼賽「參加賽事」按下後缺少明確作動提示；隊伍申請審核中或已核准後，申請方俱樂部職員沒有自行撤回/退出賽事的入口。
- **修復**：`registerTournament` 改用 `_withButtonLoading(..., '報名中...')`；新增 `tournament-friendly-withdraw.js`，在報名區與俱樂部頁籤顯示「撤回申請 / 退出賽事」，並以 `withdrawFriendlyTournamentTeam` callable 原子更新 application、entries、members 與 root summary。
- **守衛**：後端只允許 pending 申請撤回、approved/entry 退出；已拒絕、已剔除、已取消狀態不能被轉成可重新報名的取消狀態。賽事主辦隊伍不可退出自己的賽事。
- **驗收**：補 `tournament-friendly-detail-view.test.js` 與 `tournament-crud.test.js`，覆蓋 loading onclick、申請方退出按鈕、pending 撤回、rejected 不可轉狀態、cancelled/withdrawn 可重新報名。

### 2026-04-29 — 賽事詳情冷刷新載入殼與可報名俱樂部補載 [中型]
- **問題**：使用者直接刷新進入賽事詳情時，完整 applications/entries/team state 回來前會短暫看到預設「賽事名稱」空殼；非 admin 的隊長/領隊也可能因 `teams` 快取尚未載入，看不到可代表報名的俱樂部下拉選單。
- **原因**：friendly `showTournamentDetail()` 先切到 detail page 再等待 state promise；`_ensureFriendlyTournamentApplyTeamsLoaded()` 只替全域管理員補載 joined teams，普通隊職員冷啟動時仍仰賴尚未載入的 `ApiService.getTeams()`。
- **修正**：新增 friendly detail loading shell，先顯示賽事名稱、載入提示與既有進度條；補強 apply team hydration，所有使用者都會先用 `teamIds` 單筆補抓隊伍，非 admin 再合併「全量 teams 掃描」與「已補抓 joined officer teams」作為可報名來源。
- **驗證**：`node --check js/modules/tournament/tournament-friendly-detail.js`、`node --check js/modules/tournament/tournament-friendly-state.js`、`npm test -- --runTestsByPath tests/unit/tournament-friendly-detail-view.test.js --runInBand`、`npm test -- --runInBand` passed。

### 2026-04-29 — 賽事報名狀態冷刷新仍顯示可報名 [中型]
- **問題**：上一版只補載可代表俱樂部，但冷刷新時若 `currentUser.teamIds` 尚未同步，已 approved 的 entries 不會被歸入目前使用者，報名區仍顯示「參加賽事」且沒有紅框處的俱樂部狀態下拉。
- **原因**：`_getFriendlyTournamentApplyContext()`、roster approved entry 判斷只看 `_getUserTeamIds(user)`；隊職員身分雖可從 teams cache 推得，但 status scope 沒有共用同一批可操作隊伍 ID。
- **修正**：新增 `_getFriendlyTournamentUserActionTeamIds()`，把 user teamIds、joined teams、responsible officer teams 合併成同一個狀態 scope；冷 cache 無 eligible teams 時強制 refresh `page-teams` 一次；報名區即使只有一個可操作俱樂部也顯示 selector，讓狀態列穩定存在。
- **驗證**：補 `tournament-friendly-detail-view.test.js`，覆蓋 user.teamIds 空、entries 已 approved、冷 cache 強制 refresh、單一 approved club 仍顯示 selector 與退出按鈕。

### 2026-04-29 — 活動行事曆滿額標籤與人數一致
- **問題**：少數使用者在活動行事曆看到人數/進度條已低於上限，但右上角仍顯示「已額滿」。
- **原因**：行事曆卡片的狀態標籤直接讀 `event.status`，人數與進度條則走 `_getEventParticipantStats()`；取消報名後若 registrations 或 current 較早更新、status 快取仍停在 `full`，同一張卡片會出現矛盾。
- **修復**：`event-list-timeline.js` 改用既有 `_getEventEffectiveStatus()` 決定標籤，讓標籤與人數統計共用實際滿額判斷；報名、取消與遞補寫入流程不變。
- **驗證**：新增 `event-timeline-status.test.js`，覆蓋 `event.status = full` 但 `19/21` 未滿時標籤應顯示「報名中」；`npm test -- --runInBand` 69 suites / 2538 tests passed。
- **教訓**：顯示層若同時呈現狀態與人數，狀態標籤不能只信任快取欄位，應以同一份統計結果做防呆。

### 2026-04-29 — 賽事詳情審核中與分享按鈕回饋 [中型]
- **問題**：友誼賽詳情中，俱樂部審核中按鈕是 disabled，使用者點擊沒有回饋；分享賽事在詳情頁可能因分享 helper 未載入或資料尚未補齊而看似無反應；桌機版有取消報名時，聯繫、分享、取消三顆按鈕未明確並排。
- **原因**：`tournamentDetail` / `tournament` ScriptLoader 群組缺少 `event-share` 通用 action sheet/helper；`shareTournament()` 沒有按鈕 loading、缺資料 toast 與 fallback；審核中狀態只靠 disabled button 表示。
- **修復**：將審核中改為反灰可點狀態按鈕並 toast「審核中請耐心等待」；分享按鈕改走 `_withButtonLoading(..., '分享中...')` 並補缺資料/重複點擊提示；賽事詳情載入 event share helpers；有取消/撤回動作時桌機版 action grid 改為三欄。
- **驗證**：`node --check` 檢查修改 JS；`npm run test:unit -- tests/unit/tournament-friendly-detail-view.test.js tests/unit/tournament-share.test.js tests/unit/script-loader.test.js --runInBand` 通過 70 suites / 2541 tests。
- **教訓**：詳情頁的分享功能不能只載入 tournament builder，還要保證 action sheet/copy/LINE fallback helper 一起進入 page group；所有非立即完成的按鈕都要有 visible feedback。

### 2026-04-29 — 賽事報名俱樂部別名去重與重新報名修正 [中型]
- **問題**：同一個俱樂部可能在賽事詳情報名下拉中同時出現一般選項與「未通過」選項；選到不同項目時，一邊顯示可重新報名，一邊又顯示「俱樂部審核未通過」或被球員名單提示覆蓋。
- **原因**：application/entry 使用的 `teamId` 可能與目前 teams cache 的 `id/_docId/docId` 不同，狀態比對只用 raw id；detail view 又把 rejected application 當成獨立 action option；roster 模組只排除 pending/approved/rejected，沒有排除 available 報名狀態。
- **修復**：新增 `tournament-friendly-apply-state.js`，集中友誼賽隊伍別名 canonical key 與可報名狀態判斷，合併 `id/teamId/_docId/docId`；terminal rejected/removed application 會回歸到唯一可重新報名的 available option，並保留既有 application teamId 供 callable 覆寫舊申請；detail view 不再把 rejected history 獨立塞進下拉；roster 模組不再覆蓋 available 報名區。
- **驗證**：`node --check js/modules/tournament/tournament-friendly-state.js`、`node --check js/modules/tournament/tournament-friendly-detail-view.js`、`node --check js/modules/tournament/tournament-friendly-roster.js`、`npm run test:unit -- tests/unit/tournament-friendly-detail-view.test.js --runInBand` 通過 70 suites / 2553 tests。
- **教訓**：賽事系統同時碰到 teams、applications、entries 時，不可只用單一 raw id 比對；任何狀態下拉都要先做身份合併，再決定 UI 狀態，避免同一俱樂部被拆成兩個選項。

### 2026-04-29 — SEO 後台決策化與 GSC 快照覆蓋補強 [中型]
- **問題**：SEO 後台原本偏資料展示，「前兩頁可見關鍵詞」容易讓 1 次曝光這類低樣本 GSC 資料被誤解成穩定排名；URL Inspection 也主要看首頁與 SEO 著陸頁，沒有完整承接 blog 內容頁。
- **原因**：dashboard 只列出 overview/pages/queries/urlStatus，缺少樣本可信度、品牌/非品牌拆分與可執行待辦；`scripts/gsc-snapshot.js` 的 query rowLimit 只有 50，且 URL 檢查清單為固定陣列。
- **修復**：SEO 後台新增「SEO 待辦 / 警示」、「SEO 頁面機會」、「品牌 / 非品牌查詢」、「Search Appearance」與查詢詞樣本可信度；將前 20 名查詢詞命名改成 GSC 平均排名語意；GSC snapshot query rowLimit 提升到 250，URL Inspection 改為固定清單合併 `sitemap.xml`，並補入 `/blog/` 相關頁。
- **驗證**：`node --check js/modules/admin-seo/seo-dashboard.js`、`node --check scripts/gsc-snapshot.js`、`git diff --check`、`npm test` 通過 70 suites / 2567 tests；另以 Node smoke test 驗證 dashboard HTML 會包含 SEO 待辦、前 20 名查詢詞、頁面機會、品牌/非品牌、Search Appearance 與樣本提示。
- **教訓**：SEO 後台不能只展示 GSC 原始數字，必須把低樣本、平均排名與手動搜尋浮動講清楚；內容型 SEO 頁面增加後，URL Inspection 應從 sitemap 擴展，避免後台只監控舊頁面。

### 2026-04-29 — 活動俱樂部團隊席位報名上線 [大型]
- **問題**：俱樂部職員需要用俱樂部身份替現有活動保留一組團隊名額，但名額統計、候補遞補、簽到簽退、放鴿子與後台紀錄仍必須維持真人資料正確，不能讓團隊席位把活動人數或統計算壞。
- **原因**：既有活動報名模型只有個人與候補，`current` 直接代表真人報名數；若直接用虛擬 registration 代表俱樂部席位，會污染 no-show、attendance、activityRecords 與候補遞補邏輯。
- **修復**：新增 `adjustTeamReservation(asia-east1)` callable 與前端團隊/個人報名入口；團隊席位改用 team reservation summary 計入容量，真人仍各自保留 registration/activityRecord；同俱樂部成員報名會優先消耗剩餘席位，超過席位才依活動容量與候補規則處理。管理列表改成同俱樂部席位集中顯示，保留真人簽到、簽退、放鴿子欄位，並補齊操作 log。
- **驗證**：`node --check` 覆蓋 functions 與活動相關 JS；`npm test -- --runInBand` 通過 72 suites / 2572 tests；`npm run test:rules` 通過 5 suites / 490 tests；團隊席位 targeted tests 通過。已部署 functions、firestore.rules，並 push 前端版本 `0.20260429zk`。
- **教訓**：容量顯示要分清 `realCurrent` 與「尚未被真人使用的團隊席位」；所有後台統計只應吃真人 registration / attendance，團隊席位只影響容量與視覺群組，避免未來再出現佔位與真人統計互相污染。

### 2026-04-29 — 活動詳情團隊報名按鈕冷啟補載
- **問題**：俱樂部職員進入活動詳情時，原本應並排顯示「個人報名 / 團隊報名」或「取消報名 / 調整名額」，但某些冷啟或刷新路徑只看到舊的單一報名按鈕。
- **原因**：活動詳情頁沒有保證先載入 `teams`，團隊報名按鈕又依賴 `ApiService.getTeams()` 判斷目前使用者是否為俱樂部職員；此外舊資料可能有 `team.id` 與 Firestore `_docId` 雙軌，單用 `id` 會誤判。
- **修復**：活動詳情渲染報名區前先補載目前使用者可能代表的俱樂部，必要時 fallback 載入 `teams`；職員判斷改支援 `id/_docId/docId`；活動詳情資料契約補上 `teams`，避免不同進入路徑靠其他頁快取碰運氣。
- **教訓**：任何「依身分顯示的按鈕」都不能只仰賴其他頁面曾經載過的快取；詳情頁要自帶自己的資料前置條件，尤其是俱樂部與賽事這類有 ID 雙軌歷史的資料。

### 2026-04-29 — 團隊席位調整按鈕語意與顏色區分
- **問題**：活動詳情上方「調整名額」與個人報名綠色太接近，且報名名單內每個俱樂部群組旁的「調整」與主操作按鈕語意過於相似。
- **原因**：團隊席位建立後沿用綠色 active 樣式，名單內群組快捷入口也使用同樣的簡短「調整」字樣，沒有清楚區分主操作與指定俱樂部快捷操作。
- **修復**：上方團隊操作按鈕維持原本「團隊報名」藍色系；名單內每個俱樂部群組旁的按鈕改名為「快速調整」，並避免按鈕文字換行。
- **教訓**：同一頁若有主操作與列表內快捷操作，文案與顏色要明確分層，避免使用者誤以為是同一種入口。

### 2026-04-29 — 賽事球員參賽名單與換隊限制修正 [中型]
- **問題**：俱樂部已通過賽事審核後，普通球員仍可能看不到「參賽」入口；同一使用者若有多個俱樂部，也缺少清楚的換隊限制提示。
- **原因**：前端與 callable 仍有「負責人先加入」的舊門檻，且隊伍職員判斷分散在多處，coachUids 也可能被誤當成賽事職員。
- **修復**：取消負責人先加入限制，已通過/主辦俱樂部成員可直接參賽；同一賽事只允許代表一隊，其他隊保留反灰「參賽」按鈕並提示需先取消原隊；前後端職員規則統一為 captain/leader/owner/creator，不含 coach。
- **驗證**：補 roster UI 與權限 unit tests；`node --check` 覆蓋賽事相關 JS/functions，`npm test -- --runInBand` 通過 72 suites / 2578 tests。

### 2026-04-29 — 活動團隊席位納入俱樂部職員身份
- **問題**：職員可用俱樂部身份建立團隊席位，但如果職員本人不是一般成員、使用者資料沒有該俱樂部 `teamId/teamIds`，之後個人報名可能被歸到一般名單，而不是俱樂部團隊席位。
- **原因**：團隊席位匹配只看使用者成員 teamId，沒有同步採用團隊報名按鈕所使用的職員身份來源。
- **修復**：前端與 `registerForEvent` callable 的席位判定都加入 captain/creator/owner/leader/coach 身份匹配；職員本人個人報名後會寫入 `teamReservationTeamId`，名單分組、簽到簽退與放鴿子統計沿用真人 registration。
- **驗證**：補 `team-reservation-occupancy.test.js` 覆蓋職員非成員仍消耗團隊保留席位；`node --check` 前後端通過，`npm test -- --runInBand` 通過 72 suites / 2578 tests。

### 2026-04-29 — 團隊報名彈窗取消空白處關閉
- **問題**：團隊報名彈窗需要手動輸入名額，點到毛玻璃空白處會直接關閉，容易誤觸遺失輸入狀態。
- **原因**：`team-reservation-overlay` 開啟時寫入 inline `onclick`，只要點擊目標是 overlay 本身就呼叫關閉。
- **修復**：移除 overlay 空白處關閉行為，只保留右上角 X 與「取消」按鈕可關閉；補測試鎖定不再出現 backdrop close inline handler。
- **教訓**：含手動輸入的彈窗應避免點外圍關閉，尤其是調整名額這類容易被手指誤觸的 mobile 流程。

### 2026-04-29 — 賽事參賽按鈕移至俱樂部卡與審核通過自動入隊 [中型]
- **問題**：職員送出俱樂部報名並通過審核後，自己仍需再手動加入參賽名單；參賽按鈕也在上方報名區，普通球員主要看俱樂部頁籤時不容易發現。
- **原因**：審核 callable 只建立 application/entry/root summary，沒有同步建立申請者 member roster；detail view 把 approved 狀態的 roster action 放在主 action card，而不是每個已通過俱樂部列。
- **修復**：`reviewFriendlyTournamentApplication` 審核通過時會把送出申請的職員自動加入該俱樂部 members，若已代表其他隊參賽則跳過；上方報名區只顯示俱樂部狀態與取消報名，下方俱樂部卡右側依每隊狀態顯示「參賽 / 取消參賽 / 反灰參賽」。
- **驗證**：`node --check` 覆蓋 functions 與賽事相關 JS；targeted tournament tests 通過 3 suites / 108 tests；`npm test -- --runInBand` 通過 72 suites / 2580 tests。
- **教訓**：使用者會在「俱樂部頁籤」理解自己要代表哪一隊參賽，因此 roster action 應跟隊伍列綁在一起；後端審核流程若已知道申請者，應同步補齊名單，避免通過審核後還要重複操作。
### 2026-04-29 — 多俱樂部個人報名需選擇席位
- **問題**：同一用戶同時屬於多個俱樂部且活動存在多個團隊席位時，個人報名會自動吃到第一個匹配席位，使用者無法指定要用哪個俱樂部報名。
- **原因**：團隊席位匹配只用 `teamIds` / 職員身份找第一個 reservation，前端沒有在多個可用俱樂部時先取得使用者意圖。
- **修復**：前端在多個可用俱樂部席位時顯示選擇彈窗，單一席位直接報名；CF 與舊交易流程都新增 `preferredTeamReservationTeamId` 驗證，只允許使用者所屬或職員俱樂部。
- **教訓**：只要席位歸屬會影響名單與統計，就不能靠陣列順序自動決定，必須讓使用者明確選擇並在後端再次驗證。

### 2026-04-29 — 賽事報名時間時區一致化 [中型]
- **問題**：使用者建立賽事時選「立即開放」或填入台灣時間，但點「參賽」仍可能出現 `TOURNAMENT_REGISTRATION_NOT_OPEN`。
- **原因**：前端 `datetime-local` 送出的是 `YYYY-MM-DDTHH:mm` 無時區字串，瀏覽器以台灣時間判斷為已開放；Cloud Functions 可能以 UTC 解析同一字串，導致後端覺得報名尚未開始。
- **修復**：前端建立/編輯賽事時把報名開始與截止轉成 ISO UTC；編輯既有賽事時再轉回本地 `datetime-local` 顯示。後端 `getTimestampMillis()` 補 legacy 相容，無時區賽事時間一律當台灣時間解析，並在 callable 建立賽事時存成 ISO。
- **驗證**：新增 `tournament-datetime.test.js` 與 `tournament-function-timezone-source.test.js`；targeted tournament tests 通過 6 suites / 133 tests。
### 2026-04-29 — 多俱樂部報名選擇彈窗卡片化
- **問題**：多俱樂部個人報名彈窗使用 radio 欄位，選項視覺過重且不像可點整張卡片，深色主題下也不夠清楚。
- **原因**：選項 HTML 直接用 inline `label + input[type=radio]`，缺少專屬選取狀態樣式與主題分層。
- **修復**：改為整張俱樂部卡片點選，使用 `aria-checked` 與 `is-selected` 管理狀態；被選卡片改成藍綠漸層、邊框與小型勾選標記，並補上深色主題色階；卡片文字改短且固定單行省略，避免手機亂斷行。
- **教訓**：高頻操作彈窗要讓「可點擊區域」與「選取狀態」一眼可懂，避免表單控件搶走視覺焦點。
