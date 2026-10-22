---
name: fcb-accept
description: 驗收外部 AI（DeepSeek、MiMo、Gemini、Codex）交給 FC-B 的程式碼時使用：切檔、機械檢查、逐項對照舊站 A、型別與測試、瀏覽器截圖、commit 與更新看板。凡是「外包交件 → 放進 FC-B」都走這份。
disable-model-invocation: false
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/*), Bash(python -I *split-loose.py *)
---

# fcb-accept

FC-B（B 收斂版）與舊站 A 共用 Firestore／Rules／Functions，**資料格式與行為必須和 A 完全相同**。外包的測試是照它自己的假設寫的，測試全過不代表正確；本 skill 的重點是「逐項對照 A」。

## 步驟

1. **切檔**：`python -I .claude/skills/delegate/scripts/split-loose.py <回應檔> <stage 目錄>`。log 沒有 `wrote …` 就是格式壞了，看原始回應。
2. **機械檢查**：`node ${CLAUDE_SKILL_DIR}/scripts/check.mjs <stage 目錄> D:/Users/msw74/Documents/github/FC-B`
   - 改到既有檔：逐一看 diff。曾發生整檔重寫、刪掉註解、把 `getDoc(doc(db,…))` 改壞。只接受最小改動，必要時自己手寫最小版本。
   - 語系既有 key 被改：要有理由（例如對齊繁中原文），否則退回。
3. **對照 A（最重要）**：對每個 ASSUMPTION、每個新增的列舉值／分支、每個寫入 payload、每個 Callable request，用 grep 找 A 的原始碼核對。本專案實際踩過的坑：
   - 編造常數（等級表門檻、上限）→ 去 `js/config.js` 找真值。
   - 語意反轉（`active !== false` vs A 的 `!!active`、無法解析的日期 A 視為未來、`teamOnly` 條件漏掉）。
   - 多加 A 沒有的狀態或動作（隊長看不到退出鈕、核准時多呼叫角色重算）。
   - Callable 欄位用猜的（空 request interface）→ 對 `functions/index.js` 的 `request.data` 解析；契約型別空的就補上（`src/data/contract/callables.ts`）。
   - 直寫 Rules 會拒絕的欄位（例如收件匣本人只能改 `read`／`readAt`）→ 查 `firestore.rules`。
   - 用名字當身分（R-ID-002）、public eventId 與 docId 混用（R-ID-009／010）、讀 root 子集合（R-REG-014）。
   - ID 自己拼字串 → 一律 `generateId(prefix)`（R-ID-006），保留 A 依賴的前綴（例如 `comp_`）。
   - 共用流程（站內信投遞）要用既有共用模組（`src/data/inbox-delivery.ts`），不要各功能自己組。
4. **放進 FC-B 並驗證**：複製 stage 的 `src/` 進 FC-B（只複製本次要的檔），然後
   - `npx tsc --noEmit`
   - `npm run check`（型別＋完整 vitest＋i18n）
   - 測試常見修正：mock 的 `mock.calls[0]` 用 `(x.mock.calls[0] as unknown[])[n]`；i18n 只替換 `useT`（`vi.mock('@/i18n/i18n', async (o) => ({ ...(await o()), useT: … }))`）；select／checkbox 派送原生 change（review-lessons L-42）。
   - 元件裡同一個模組被並行 `await import()` 多次時，vitest 的 `vi.mock` 可能只套到第一次；把動態載入包成模組層快取函式（`let p; const load = () => (p ??= import(...))`）就穩。（2026-10-22 T-013）
   - 受控 checkbox 被守門擋下（例如無加值權限）時，Preact 不會把 DOM 勾選狀態改回來，畫面會停在已勾；handler 擋下後要把 `e.currentTarget.checked` 設回 state 值。只有瀏覽器實測抓得到，單元測試看不出。（2026-10-22 T-013）
5. **瀏覽器**（UI 變更必做，R-QA-010～013）：dev server 5181（emulator 模式）＋ `npm run seed:emulator`，然後
   `node ${CLAUDE_SKILL_DIR}/scripts/shots.mjs <輸出目錄> <uid|guest> <路徑...>`
   種子 UID：user1 `U…0001`、coach `U…0002`（俱樂部 A 隊長，角色 coach）、admin `U…0003`（俱樂部 B 隊長）、blocked `U…0004`。看 report 與至少手機亮色、桌機暗色各一張圖。
   - 要測 Callable 流程：另起 `VITE_FIREBASE_EMULATOR=1 VITE_CALLABLE_MODE=mock` 的 dev server（FC `.claude/launch.json` 的 `fc-b-emulator-mock`，port 5183），`FCB_BASE=http://localhost:5183`；mock 定義在 FC-B `src/dev/callable-mocks.ts`，失敗情境用 `SHOTS_LOCALSTORAGE="fcb:mock:settleFail=1"` 切換。`SHOTS_MOBILE_ONLY=1` 只拍 390、`SHOTS_TAG` 區分情境檔名。
   - 要等 toast：截圖前等文字出現後再等約 700ms（淡入動畫中途截圖會看不到）。shots.mjs 不等 toast，互動流程複雜時另寫小 Playwright 腳本。（2026-10-22 T-004 新增）
   - Playwright 小坑（2026-10-22 T-013）：`aria-disabled` 的按鈕要 `click({ force: true })`；A 樣式的開關（`.toggle-switch` 內隱藏 checkbox）點父層 `locator('#id').locator('xpath=..')`；Git Bash 跑 shots.mjs 要 `MSYS_NO_PATHCONV=1` 並用 Windows 絕對路徑，否則 `/activities` 之類的參數會被改成 `C:/Program Files/Git/...`。驗「每次開表單都重置」時不要用 `page.goto` 重開（整頁重載等於重新掛載），要在同一頁關掉再按入口。
   - **建立／寫入的重送冪等**（2026-10-22 T-013）：Playwright `page.route('**/*')` 攔 URL 含 `:commit` 的請求，`await route.fetch()` 後 `route.abort('failed')`，就能在 emulator 重現「寫入已成功但回應遺失」。只丟 1 次時 SDK 會自動重試 transaction（驗讀回內容比對）；全丟時 UI 會收到失敗（驗重送、改內容、切模式的處理）。最後用 emulator REST 數文件，確認沒有重複建立。範例 FC local `docs/specs/lite-convergence/p81-batch5/s3/flow-s3c.mjs`。
   - **相機／掃碼流程**（2026-10-22 T-010 新增）：不必真機也能測。`node ${CLAUDE_SKILL_DIR}/scripts/make-qr-y4m.mjs <QR 內容（例如種子 UID）> <out.y4m>` 產生畫面裡一直有該 QR 的影片，Playwright `chromium.launch({ args: ['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--use-file-for-fake-video-capture=<out.y4m 絕對路徑>'] })`＋`newContext({ permissions: ['camera'] })`，頁面上按開相機就會真的解碼並寫進 emulator；可驗連續掃碼、去重秒數（用 emulator REST 數 `attendanceRecords` 筆數）、關相機後 `video.srcObject.getVideoTracks()` 是否釋放。範例流程見 FC local `docs/specs/lite-convergence/p80-batch4/flow-t010.mjs`。補種子用 emulator REST（`Bearer owner`，只打 127.0.0.1）；**種子 UID 是 `U`＋31 位數**，自己拼時位數錯了會變成別人，掃碼會走「同名視為已報名」分支而看不出錯。
5b. **審查**：每張卡 commit 後 `bash ${CLAUDE_SKILL_DIR}/scripts/review-card.sh <工作資料夾> <卡號> <commit> <原 prompt>` 送 Gemini 4；權限（R-IAM-010／011）與寫入卡另送 Codex 第二審。Gemini 常抓到「真瀏覽器」問題（Safari／LINE WebView 點擊後經多層 `await import()` 才 `window.open`／`navigator.share`／`clipboard`，手勢權限過期被擋），這類以審查為準修掉。（2026-10-22 T-005b）
5c. **FC Rules 測試**（B 直寫或新寫入路徑必做，檔放 FC `tests/firestore-rules/b-contract/`）：
   - 角色一定放 custom claim：`testEnv.authenticatedContext(uid, { role })`（admin 再加 `admin: true`），並 seed `rolePermissions/{role}`（含 `permissions` 陣列）、`roleActivityCapabilities/user`（含 `catalogVersion`）、完整 `users/{uid}`；照 FC `tests/firestore.rules.test.js` 的 seed helper。少了任何一項，Rules 會出現「maximum of 1000 expressions」「Property permissions is undefined」而全拒，看起來像 Rules 擋掉其實是測試資料不對。
   - 測試資料都齊了仍出現「maximum of 1000 expressions」，或改 Rules 後**既有**案例開始失敗：是運算式預算問題，照 `rules-budget` skill 量測與差分（events update 已貼近上限）。（2026-10-22 T-006）
   - 本機已有 emulator 在 8080 時（`firebase emulators:exec` 會因 port 被占失敗），直接 `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx jest --runInBand <測試檔>`；測試用自己的 projectId，不會動到開發資料。
   - **其他分支同時在改 `firestore.rules`**（8080 的 emulator 會被它們的未 commit Rules 熱載入，跑全套 `test:rules:unit` 出現大量與你無關的失敗）：開乾淨 worktree（`git worktree add --detach <scratchpad>/fc-head HEAD`，`node_modules` 用 junction 指回 FC），在 worktree 起自己的 Firestore emulator（另一個 port，例如 8095，hub／logging port 也換掉），**用 FC 本地 `node_modules/.bin/firebase`**（全域新版在這台機器啟動 jar 會 EPERM），再 `FIRESTORE_EMULATOR_HOST=127.0.0.1:8095 npm run test:rules:unit`。收尾先刪 junction 再 `git worktree remove`，避免把 FC 的 node_modules 一起刪掉。（2026-10-22 T-013）
   - 測試要記錄「現行 Rules」實況；若 A 前端顯示按鈕但 Rules 會拒（例：活動公開開關 `isPublic` 不在 owner／scoped 白名單），照實寫成 assertFails 並註明是 A 落差，不改 Rules、不改 payload，回報待站長決定。
5d. **看圖改派 Gemini，PM 不親自看截圖**（2026-10-23 T-019）：`llm-run.py --provider gemini --image <A 參考圖…> <B 截圖…>`，prompt 寫明圖片順序、逐項要查什麼、最後一行「需修正：N 項」。Gemini 的結論**一律對 A 原始碼核實再修**：T-019 它 4 次提的缺陷有一半不成立（A 參考圖是依原始碼重現的示意圖，可能畫了 A 沒有的按鈕；A 本來就隱藏的元素被當成缺漏）。它對「整頁空白」「浮層沒開」這類大問題很可靠。
   - **整頁空白先查 `.page.active`**：A 的 CSS 是 `.page{display:none}`，新頁面 `<section class="page">` 少了 `active` 就整頁不見，單元測試全過也看不出（T-019 收件匣）。新頁面驗收必查。
   - 抓 DOM／console 用 Playwright 小腳本（`devSignIn(uid)` 後 `page.evaluate` 讀 DOM、訂閱 store、`new Error().stack` 找誰關掉了浮層），比看截圖快又準。
   - **種子帳號 UID 是 `U`＋31 位數，私訊功能（A 與 B 都要求 `U`＋32 位十六進位）在種子之間一定打不開**；測私訊改用 `devSignIn('U'+'a'.repeat(32))` 並直接 `openPmDialog({ uid: 'U'+'b'.repeat(32) })`。
6. **commit**（本機，不推送）：**一律 `git commit -F - -- <路徑…>` 只提交指定檔**（T-019 兩次因先前 `git rm` 已 stage 的刪除被帶進不相干的 commit，造成中間 commit 單獨建置失敗）；精確 `git add` 本次檔案；commit 訊息用中文列出「照 A 修正了什麼、未採用什麼與理由、驗證結果、已知限制」，結尾附 attribution。
7. **更新看板**：見 memory `reference_fcb_progress_board.md`（只更新變動的 items 與 `meta/board`，帶 `if_version`；看板公開，**不寫授權事項**）。

## 不要做
- 不要因為外包的測試全過就收。
- 不要推送或部署（需站長逐次授權）。
- 不要把秘密、真實 UID、未遮罩個資寫進 commit、看板或文件。
