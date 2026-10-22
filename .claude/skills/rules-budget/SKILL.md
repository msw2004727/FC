---
name: rules-budget
description: FC firestore.rules 新增或修改 allow／helper 後，Rules 測試出現「maximum of 1000 expressions」、或既有案例改完才開始失敗時使用：量測運算式預算、找出吃預算的 helper、用 HEAD Rules 做差分、決定新規則擺法。改 events update 前也先看。
---

# rules-budget

Firestore Rules 每個請求最多評估 1000 個運算式，超過就拒絕（錯誤訊息 `Unable to evaluate the expression as the maximum of 1000 expressions…`）。FC 的 `events/{eventId}` update 已貼近上限，加任何東西都可能讓**既有**允許案例誤拒。（2026-10-22 T-006 首建）

## 已知事實（T-006 實測）

- 預算是整個請求共用：把新規則寫成獨立一條 `allow update` 也一樣吃同一份預算；排在既有那條**之後**，既有那條先耗盡預算，新規則永遠輪不到。
- emulator 每筆寫入會評估多回合，其中有「resource 未定」的回合，`&&`／`||` 無法短路，所以新 helper 的**整個本體**都算進預算，不只是會走到的分支。
- 直接讀不存在的欄位（`eventData.ownerUid`、`{}.permissions`）產生錯誤值，錯誤值無法短路，後面整串都會被評估。改用 `.get('欄位', null)` 是最有效的降耗手段；在只出現於 `&&`／`||` 正向語境（無 `!`、無三元式條件）的 helper 上，錯誤→false 不改變允許／拒絕結果。
- `authRole()` 每次呼叫都重算（users 文件 exists＋get）；同一 helper 內多次 `hasEffectivePerm` 很貴，改成角色算一次、當參數傳下去。
- Rules list 不支援 `+` 串接（會變成錯誤值，表現為整串超限）；用三元式直接給完整清單。
- **events create 也貼著上限**（T-016 實測）：用 `setDoc` 建立時 emulator 也會評估 update 規則的回合，預算有一大塊是固定成本，所以輕 payload 與全加值 payload 的餘裕幾乎一樣。HEAD 時一般 user 的既有建立案例只剩不到 5 個 pad（見流程第 5 步）的餘裕；帶委託人直接超限。
- `hasActivityCap` 每次呼叫都重算 `authRole()` 並 exists／get capability 文件兩次。T-016 拆成 `userActivityCapData()`（回傳文件 data，缺文件給預設清單）＋`capListHas(capData, cap)`，create 路徑讀一次 capData 傳參；只合併同一 helper 內的兩次呼叫**不夠**。
- 用 `let x = get(...).data.欄位` 預先取欄位要小心：欄位缺時錯誤值會在 let 處就產生，可能波及原本不會讀到它的分支。改傳整個 data map，欄位存取留在判斷式裡（Codex 在 T-016 指出，原型因此改寫）。
- 2026-10-22 時「admin 改非自己私密活動的標題」（`tests/firestore.rules.test.js` 的 admin-below 案例）在 HEAD 幾乎正好 1000：只加一條 `isAuth() && hasOnly(...) && false` 就失敗。T-006 把 `eventDataHasDelegateUid`／`isEventOwnerOrDelegateForData`／`isEventOwnerForData` 改成 `.get()` 後才有餘裕。

## 流程

1. **先分辨真拒絕與超限**：失敗訊息含 `maximum of 1000 expressions` 就是預算問題，不是條件寫錯；拒絕案例在 events update 普遍以超限收場（HEAD 也是），不能用訊息判斷拒絕原因。
2. **HEAD 差分**（每次改 Rules 都做）：
   ```bash
   git show HEAD:firestore.rules > <scratch>/head.rules
   sed -e "s#^const RULES_PATH = .*#const RULES_PATH = \"<scratch>/head.rules\";#" \
       -e 's/<原 projectId>/<新 projectId>/' <測試檔> > tests/<同目錄>/zz-tmp-head.test.js
   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx jest --runInBand --testMatch "<rootDir>/tests/<同目錄>/zz-tmp-head.test.js"
   rm tests/<同目錄>/zz-tmp-head.test.js
   ```
   期望：HEAD 下失敗的**正好是**本次新增的允許案例，其餘結果相同。暫存測試檔一定要刪、projectId 要換（避免和正式跑的同一 emulator 互清資料）。
3. **找出是哪一筆寫入超限**：大型測試的一個 test 有幾十筆寫入，jest 不給行號。複製測試檔，把 `await assertSucceeds(`／`await assertFails(` 換成帶行號的包裝（拋出 `assertSucceeds@<行號>`），`-t` 只跑該 test，看完刪掉。
4. **量預算**：跑完單一 test 後 `curl -s "http://127.0.0.1:8080/emulator/v1/projects/<projectId>:ruleCoverage" -o cov.json`，再 `python -I ${CLAUDE_SKILL_DIR}/scripts/cov-summary.py cov.json --top 20 [--lines 起-迄]`。HEAD 與新版各量一次比較；計數是累加值，只看相對大小。
5. **門檻實驗**：在 scratch 複製一份 Rules，把新規則換成最小版本（例如 `isAuth() && hasOnly([...]) && false`）跑第 3 步那筆寫入；最小版本也失敗＝既有路徑沒有餘裕，必須先替既有 helper 降耗（見上方 `.get()` 做法），不是再縮新規則。
   **量餘裕（pad 法，T-016 起）**：在目標 helper 的 `return` 後插入 N 個恆真比較 `request.resource.data.get('padK', K) == K && `（每個約 3 個運算式），找出開始失敗的 N。改前／改後各量一次寫進回報，比 ruleCoverage 的累加計數直觀（coverage 在請求被拒時無法比較）。
6. **擺法**：新的窄規則寫成獨立 `allow update` 排在既有那條**之前**、外層先放最便宜的 `hasOnly`；若有既有分支（例如 owner＋`event.edit_self`）會因此被排擠，把該分支已允許的同一子集併入新規則判斷（要能說明是子集、不擴權）。
7. **驗證**：完整 `test:rules:unit`（8080 被占時接既有 emulator：`FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run test:rules:unit`），全綠才算；改共用 helper 必須送審查並附所有呼叫端（`grep -n -B3 -A3 "<helper>(" firestore.rules`），請審查者逐一確認沒有否定或三元式用法。

## 注意

- 位置參數 `npx jest <路徑>` 會連 `docs/` 下的 local-only 舊副本一起跑；一律用 `--testMatch "<rootDir>/tests/..."`。
- **暫存測試的 projectId 只能小寫**：含大寫（如 `t016-vA`）時 emulator 回 `{"error":{"code":500,"status":"UNKNOWN"}}`，所有案例一起失敗，看起來像 Rules 壞掉（emulator log：`Not a project id`）。（T-016）
- **8080 emulator 是多個 session 共用的**：別的 session 同時跑 `test:rules:unit` 時，同一組 projectId 會互相 `clearFirestore`，與改動無關的 suite（announcements、inv_*、eduAttendance…）隨機 `PERMISSION_DENIED`。查有沒有別的 jest：`powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { \$_.CommandLine -match 'jest' } | Select-Object ProcessId,CommandLine"`。T-016 等別人跑完再重跑，又被第三個 session 撞上，所以**完整套件與 HEAD 差分一律在自己的 emulator 跑**（背景執行、用完關掉）：
  ```bash
  java -Duser.language=en -jar ~/.cache/firebase/emulators/cloud-firestore-emulator-v1.19.8.jar --host 127.0.0.1 --port 8181 --websocket_port 9181   # run_in_background
  FIRESTORE_EMULATOR_HOST=127.0.0.1:8181 npm run test:rules:unit
  ```
  HEAD 完整套件：`git archive HEAD | tar -x -C <scratch>/fc-head`，再 `cmd //c mklink //J <scratch>\fc-head\node_modules <repo>\node_modules`，在該目錄跑同一命令。干擾造成的 `PERMISSION_DENIED` 可能讓 `assertFails` 假通過，所以被干擾過的「全綠」也不能採信。（T-016）
- `git checkout-index --temp` 會在 repo 根目錄留下 `.merge_file_*`，改用 `git show HEAD:檔案 > scratch`。
