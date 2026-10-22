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
5. **瀏覽器**（UI 變更必做，R-QA-010～013）：dev server 5181（emulator 模式）＋ `npm run seed:emulator`，然後
   `node ${CLAUDE_SKILL_DIR}/scripts/shots.mjs <輸出目錄> <uid|guest> <路徑...>`
   種子 UID：user1 `U…0001`、coach `U…0002`（俱樂部 A 隊長，角色 coach）、admin `U…0003`（俱樂部 B 隊長）、blocked `U…0004`。看 report 與至少手機亮色、桌機暗色各一張圖。
   - 要測 Callable 流程：另起 `VITE_FIREBASE_EMULATOR=1 VITE_CALLABLE_MODE=mock` 的 dev server（FC `.claude/launch.json` 的 `fc-b-emulator-mock`，port 5183），`FCB_BASE=http://localhost:5183`；mock 定義在 FC-B `src/dev/callable-mocks.ts`，失敗情境用 `SHOTS_LOCALSTORAGE="fcb:mock:settleFail=1"` 切換。`SHOTS_MOBILE_ONLY=1` 只拍 390、`SHOTS_TAG` 區分情境檔名。
   - 要等 toast：截圖前等文字出現後再等約 700ms（淡入動畫中途截圖會看不到）。shots.mjs 不等 toast，互動流程複雜時另寫小 Playwright 腳本。（2026-10-22 T-004 新增）
6. **commit**（本機，不推送）：精確 `git add` 本次檔案；commit 訊息用中文列出「照 A 修正了什麼、未採用什麼與理由、驗證結果、已知限制」，結尾附 attribution。
7. **更新看板**：見 memory `reference_fcb_progress_board.md`（只更新變動的 items 與 `meta/board`，帶 `if_version`；看板公開，**不寫授權事項**）。

## 不要做
- 不要因為外包的測試全過就收。
- 不要推送或部署（需站長逐次授權）。
- 不要把秘密、真實 UID、未遮罩個資寫進 commit、看板或文件。
