---
name: delegate
description: 當要把機械性或大量產文工作派給外部 AI 時使用。依布達第 51 號崗位選 Grok、DeepSeek Flash、MiMo、Gemini 或 Claude 子代理，產出先進 staging 再驗收。
disable-model-invocation: false
allowed-tools: Bash(python -I ${CLAUDE_SKILL_DIR}/scripts/llm-run.py *), Bash(python -I ${CLAUDE_SKILL_DIR}/scripts/pack-prompt.py *)
---

# delegate

把工作派給外部 AI，自己保留規格與驗收。

## 選模型

2026-11-06 依總司令布達第 51 號（站長定，常設）定案崗位，取代第 43 號派工分配與 2026-10-23「專長 × 任務」表；施工方不自審（第 35 號）照舊。全文 `D:/Users/msw74/Documents/總司令交接/布達/2026-11-06-第51號-外部AI崗位定案.md`。每份回報第 1 行註明每項任務派給誰、為什麼；每張卡（含 Claude 子代理）登記進 `docs/specs/lite-convergence/ai-dispatch-log.md`。

| 任務 | Provider／Model | 用法 |
| --- | --- | --- |
| 高風險卡（錢、存檔、權限、Rules、Functions 授權、個資）先寫死設計與驗收；最終把關短審；Codex 停用期間兼主審 | Claude Opus 子代理 | 短審附接線點逐點表與新舊對照；不做一般施工 |
| 一般與中等施工**第一順位**、退修輪、**第一輪審查**、測試與突變工具 | Grok `grok-4.7`（**Grok Build CLI**） | 見下方「Grok 走 CLI」。小改卡寫死可改範圍；**不碰金鑰、個資、正式設定；不當終審**；被權限分類器擋就改派，不繞過 |
| 規格寫死的大量施工**第二順位**（畫面以外）、文件卡 | DeepSeek `deepseek-flash` | 派前先查餘額；規格長的產碼任務加 `--effort low`；**退修到第 4 輪還沒 GO 就停派，由 Opus 重寫卡** |
| 定點唯讀查證、第一輪唯讀審查、反例測試、Gemini 線索抽樣查證 | MiMo `mimo-v2.6-pro`（**只走 Claude Code**，見 skill `mimo-audit`） | 每卡 ≤8 題；複雜任務加 `--no-think`；不施工、不給可寫卡 |
| 健檢線索、第二審、看圖對照 | Gemini `gemini-4-argon` | 分小批；**不單獨放行、不施工**；產出一律另行實測（檔名行號常虛構） |
| UI 畫面實作與巡查、看板、紀錄等機械工作 | Claude Sonnet（PM 或子工作者） | 畫面照站長六點：多語、深淺色、360／375／1280、不拆字、對比、無英文代號 |
| 主審查、回合核心疑難 | Codex | **停用中**（帳號到期）；若續訂，先讓 Grok 盲審 5～10 張已有 Codex 結論的舊卡比對。下方「Codex 純文字派工」僅留作歷史參考 |

- **淘汰**：DeepSeek V4 Pro（禁用）、Kimi K3.1 Pro、MiMo 經 Codex 的接法。
- **提早抓 BUG**：高風險卡驗收要有「跑完後檢查存檔欄位真的改變」的測試，外加「拿掉接線那一行」的突變；派卡時用 `git grep` 列出改到的函式名、DOM id、舊字串的定向測試；審查員各給不同清單（接線、測試涵蓋、反例）；報告寫「改動前就壞」要附 main 上的對照結果。
- **時限**：「15 分鐘無提交就停」只適用 Codex 類；其他施工 60 分鐘仍零提交，先存 WIP，不要砍掉重來。

### Grok 走 CLI（2026-10-23 起為主；取代「`llm-run.py --provider xai` 直連為主」）

站長的 Grok 訂閱走 Grok Build CLI（OAuth 登入），**不含 API 額度**，所以 `XAI_API_KEY` 回 400 不是故障、是沒儲值（2026-10-23 指揮官實測 CLI `modelCalls 1` 成功）。接法與坑以使用者層級 skill `C:\Users\msw74\.claude\skills\pmkit-runners\SKILL.md`「Grok 4.7」節為準，重點：
- 無人值守：`grok -p "<提示>" --cwd <工作樹> -m grok-4.7 --effort xhigh --disable-web-search --no-subagents --always-approve --allow Bash --deny <清單>… --output-format json --max-turns N`，stdin 接 `/dev/null`。純文字快測：`grok -p "…" -m grok-4.7 --output-format json --max-turns 1 --disable-web-search`。
- 子程序 `USERPROFILE`／`HOME` 指到空資料夾、`GROK_HOME` 指回 `~/.grok`、`GIT_CONFIG_GLOBAL` 指回真的 `.gitconfig`（否則會合併 Claude Code 的 allow 權限）；deny 至少含 `Bash(curl*)`、`Bash(*https://*)`、`Bash(git push*)`、`Bash(git checkout*)`、`Bash(git reset*)`、`Bash(git stash*)`、`Bash(rm -rf*)`、`Bash(gh *)`、`Bash(gcloud*)`、`Bash(firebase*)`、`Bash(ssh*)`。
- 不支援 `--add-dir`：卡片與要讀的檔複製進工作樹 `.grok-input/`（加進 `git info/exclude`），卡上寫相對路徑；派工卡存 UTF-8 **加 BOM**（PowerShell 5.1 讀無 BOM 會亂碼）。
- 收件看 diff 與 `grok export <sessionId>` 的 Execute 紀錄；輸出的成本欄位不回報金額。
- **PowerShell 5.1 啟動範例（2026-10-23 T-024 實測一次過，約 10 分鐘出一個 35KB 單檔 HTML）**：`<` 在 PowerShell 是保留字不能接 stdin，改用 `Start-Process -FilePath grok.exe -ArgumentList $a -NoNewWindow -Wait -PassThru -RedirectStandardInput <空檔> -RedirectStandardOutput out.json -RedirectStandardError err.txt`；`-p` 的提示用純 ASCII（例如 `Read .grok-input/<卡>.md (UTF-8 with BOM) and do exactly what it says. Write only out/x.html`），中文規格放卡裡；參數含空白或萬用字元的 `--cwd`、`--deny` 值要各自包 `"…"`；整段寫成 `run-grok.ps1` 再用 `Start-Process powershell -File … -WindowStyle Hidden` 丟背景，結束時寫 `grok-exit.txt` 供 Monitor 等待。範例 `docs/specs/lite-convergence/tasks/T-024/ui-work/run-grok.ps1`（工作樹要 `git init`，`.grok-input/`、`out/` 加進 `.git/info/exclude`）。收件除看 `out/` 外，用 `grok export <sessionId>` 確認 Execute 只有預期指令。

#### 一鍵腳本 grok-worktree.ps1

PowerShell 5.1。把建 worktree、junction、卡片 BOM、`info/exclude`、啟動與收尾收成一支腳本。FC 版：`.claude/skills/delegate/scripts/grok-worktree.ps1`（`-Repo` 預設為腳本所在專案根）。跨專案版 `delegate-shared/grok-worktree.ps1`：`-Repo` 可寫路徑或別名；從目前目錄往上找第一個 `.claude/agent-dispatch.json`，用其中的 `primaryRepo`（預設 repo）與 `repos`（別名），相對路徑以 `.claude` 的上一層為準；找不到設定檔就只接受路徑。

```
powershell -NoProfile -File .claude/skills/delegate/scripts/grok-worktree.ps1 up -Card <主卡.md> [-Input <檔>...] [-Repo <路徑或別名>] [-Name <名>] [-Root <夾>] [-MaxTurns 70] [-Effort xhigh] [-Prompt "<ASCII>"] [-NoRun]
powershell -NoProfile -File .claude/skills/delegate/scripts/grok-worktree.ps1 down -Name <名> [-Root <夾>] [-Repo <路徑或別名>] [-Save <夾>] [-Force]
```

- `up`：確認 git repo、工作樹路徑不存在 → `git worktree add --detach <wt> HEAD` → `node_modules` 與 `functions\node_modules`（目標存在才建，否則警告略過）→ `.grok-input` 文字檔重寫成 UTF-8 BOM（png/jpg/jpeg/gif/webp/pdf/ico 原樣）→ 共用 `info/exclude` 只補尚缺的 `.grok-input/` 與 `/out/` → 空 HOME 與 `nul.txt` → 寫 `<Root>\<Name>-run.ps1`。沒有 `-NoRun` 才隱藏背景啟動。最後一定印出工作樹、run／out／err／exit 路徑、手動啟動命令、輪詢 exit 檔的一行、以及 `down` 範例。
- 預設：`-Name` 為 `grok-yyyyMMdd-HHmmss`；`-Root` 為 `$env:CLAUDE_SCRATCHPAD`，否則 `%TEMP%\grok-wt`；`-MaxTurns` 70、`-Effort` xhigh。預設提示為純 ASCII：`Read .grok-input/<主卡檔名> (UTF-8 with BOM) and do exactly what it says. Keep .grok-input/REPORT.md updated after each finished item.`
- `down` 只靠 `-Name` 與 `-Root` 讀狀態檔；沒有狀態檔才用 `-Repo`＋`-Name` 推算。有 `-Save` 先複製未 ignore 的修改與未追蹤檔（相對路徑），並另存 `git diff`、`git status --short`。排除 `.grok-input/` 與 `out/` 後若仍有 porcelain 輸出，且沒給 `-Save` 或 `-Force`，印警告並停止。然後只對記錄的 junction 確認 ReparsePoint 後 `[IO.Directory]::Delete`（禁止 `Remove-Item -Recurse`、`rmdir /s`），確認目標仍在，才 `worktree remove --force` 與 `prune`，刪名稱以 `-home` 結尾且位於 Root 下的 HOME，刪狀態檔與 `run.ps1`。保留 `-out.json`、`-err.txt`、`-exit.txt`。任一步失敗就 `exit 1`。
- 注意：路徑可含空白；不印 token／金鑰；`-NoRun` 不啟動 grok。多個附加檔在 PowerShell 寫 `-Input a.md,b.md`。

API 路線改為備用（需 `xai-` 開頭且有儲值的金鑰）：`llm-run.py --provider xai`，或 `CODEX_HOME=~/.codex-grok codex exec --skip-git-repo-check -s read-only --output-last-message resp.md - < prompt.md`（`~/.codex-grok/config.toml` 已關掉帶 namespace 型工具的功能，因為 xAI 會回 422 拒收；讀 `XAI_API_KEY`，永不印出）。

## 金鑰

- `DEEPSEEK_API_KEY`、`GEMINI_API_KEY` 從環境變數讀取。
- `MIMO_API_KEY` 只在 Windows User 層級；bash 先執行：
  `powershell.exe -NoProfile -Command "[Environment]::GetEnvironmentVariable('MIMO_API_KEY','User')"`
  讀入後 export。
- 金鑰永不印出。

## 派工流程

1. 把 prompt 寫成檔案。
2. 用 `--context` 附上必要檔案。
3. 需要多檔輸出時用 `--split-dir`；格式為 `===== FILE: name =====` 與 `===== END FILE =====`。
4. 產出先放 staging，例如 `docs/specs/.../out/`。
5. 用腳本驗證編碼、路徑存在、行數後，才複製到正式位置。

## 打包附件（pack-prompt.py）

只能讀純文字的模型（Codex、或不想整檔附上時）用它把「規格＋檔案節錄＋頁尾」打包成一個 UTF-8 檔，不必每次手寫組裝腳本（2026-10-22 T-001 新增；取代各任務自寫 build_prompt.py）：

```
python -I ${CLAUDE_SKILL_DIR}/scripts/pack-prompt.py --spec spec.md --out prompt.md \
  --root D:/Users/msw74/Documents/github/FC-B \
  --footer D:/Users/msw74/Documents/github/FC/docs/specs/lite-convergence/codex-footer.md \
  src/data/op-log.ts \
  "src/features/events/data/attendance-roster-model.ts#107-133" \
  "src/data/callables.ts#|// ── CallableError|" \
  "src/features/events/data/event-lifecycle.ts#|export function parseEventStartDate|  return new Date(y, m, d);|" \
  .claude/rules/review-lessons.md
```

- 混附兩個 repo：`--alias A=D:/…/FC --alias B=D:/…/FC-B-xxx`，附件寫 `A:js/x.js#10-20`、`B:src/y.ts`（只有登記過的別名才當別名，不會誤判磁碟代號）。（2026-10-22 T-005a 新增）
- 選擇器：`#起-迄` 行號；`#|起始字串|結束字串|` 字串區段（含頭尾、各取第一次出現；用 `|` 分隔，因程式碼常含 `/`）；`#|起始字串|` 到檔尾。找不到檔案、字串或行號越界會直接失敗，不會靜默少附。
- 附常數清單一律用字串區段從宣告抓到結尾括號，不用固定行數（曾因截斷漏欄位）。
- 直接以 UTF-8 bytes 寫檔，避開 cp950 讓 Codex 拒收。

## Codex 純文字派工

```
codex exec --skip-git-repo-check -s read-only -m gpt-6-astra --output-last-message resp.md - < prompt.md > codex.out 2> codex.err
python -I ${CLAUDE_SKILL_DIR}/scripts/split-loose.py resp.md stage
```

- 背景執行（約數分鐘）；`resp.md` 是最後一則回覆，`codex.err` 先看有無 usage limit／UTF-8 錯誤。
- **改大檔（數百行以上）不要叫模型整檔輸出**，改要求 SEARCH/REPLACE 區塊（`===== EDIT: path =====` 內含 `<<<<<<< SEARCH`／`=======`／`>>>>>>> REPLACE`，格式見腳本檔頭），新檔才用 `===== FILE`。套用：`python -I ${CLAUDE_SKILL_DIR}/scripts/apply-edits.py resp.md <repo> --dry-run` 確認後去掉 `--dry-run`；任何 SEARCH 不唯一就整批不寫、列出失敗區塊。（2026-10-22 T-004 新增；取代「一律整檔輸出再 split-loose」，因多個大檔整檔輸出易截斷且浪費輸出額度。）
- prompt 結尾附 `codex-footer.md`（footer 是 FC-B 前端專用；審 FC `functions/**` 時在 spec 開頭註明「footer 中 FC-B／Preact／tokens／locales 條目不適用」，T-020 這樣寫 Codex 照常審）、附件附 FC-B `.claude/rules/review-lessons.md`；附「所有會被改的檔案＋測試＋引用它們的檔案」。
- 規格裡把「要 export 的 API 簽章」與「逐條規則」寫死，Codex 會照名稱產出，驗收時才好對。
- 交件測試的假回應常比伺服器真實形狀精簡（例如 `adjustExp` 少了 `results`）：驗收時拿 `functions/` 的 return 對照 mock。

## FC-B Callable 契約人工補登

`src/data/contract/callables.ts` 標 AUTO-GENERATED，但產生器在 FC local docs、新 Callable 不會自動進來。補登照 `adjustEventCapacity` 先例，四處一起改：檔頭「人工補登：…」那一行加名稱、`<Pascal>Request/Response` 介面（欄位逐條對 `functions/` 的 `request.data` 與 return，註解寫伺服器出處）、`CALLABLES` 表（照字母序、region 照 `functions/index.js`）、`src/data/callables.ts` 的 import 與 `CallableMap`。改完 `npx tsc --noEmit`。不到百行的補登 PM 自己用 Python 精確替換即可，派工說明會比改動還長。

## 審查派工

- 使用 R-REVIEW-011～013 規定的開頭句與欄位。
- 單一小改動的 Gemini 審查（2026-10-22 T-011，約 45 秒、3k token 輸出）：先 `git diff > diff.patch`，審查 prompt 寫明背景、逐項檢查點與「情境 × 改前 × 改後」表格要求，再
  `pack-prompt.py --spec review-prompt.md --out review-packed.md --alias A=… --alias B=… A:…/diff.patch B:<改後全文> <呼叫鏈片段>`，
  `llm-run.py --provider gemini --prompt review-packed.md --out out/gemini-review.md --timeout 600`。
  附「改後全文＋diff＋上下游片段」比只附 diff 好：T-011 的 Gemini 因看得到 `parseEventStartDate` 全文才抓到 Invalid Date 的 NaN 漏洞。

## 已知限制

- **2026-10-23 T-022：要以 `vm.runInNewContext` 測的 Functions 程式，規格要寫明「判斷 plain object 用 `Object.prototype.toString.call(v) === "[object Object]"`，不要比對 `Object.getPrototypeOf(v) === Object.prototype`」**：測試的 request.data 來自外層 realm，比對 prototype 會把合法物件判成非物件（Codex 第 1 輪就這樣寫，PM 派第 2 輪修）。
- **Grok CLI 寫 Functions 測試（T-022 實測）**：在乾淨 worktree 跑（node_modules 用 junction），卡放 `.grok-input/`（UTF-8 加 BOM），一張卡 23 項約 18 回合交 35 案、整檔全綠；核心碼之後若再改，要把新版 `functions/index.js` 複製進 worktree 重跑，再派小卡補案。收件先 `cmp` 確認它沒動 `functions/`。

- **2026-10-23 T-024 第二輪 a（Functions 授權核心）實戰**：
  - Codex 核心產碼用「規格檔＋pack-prompt」一次出 3 檔（2 個新檔 FILE＋index.js 4 處 EDIT），`apply-edits.py` 一次套完；新檔過 1000 行前先拆成「純函式 core」與「handler 工廠」兩個檔，Codex 才不會寫出難審的長檔。Codex 偶爾回 `Selected model is at capacity`（暫時性，非額度）：背景迴圈重試最多 4 次、間隔 60 秒即可。
  - 授權核心走「Codex 產碼 → fresh-context Codex 主審 → 退修（只給差異規格＋審查報告＋現行檔）」；本任務 3 輪審查逐輪找到真問題（並行節流空窗、成功清零、IPv4-mapped 正規化、鎖定到期語意），第 3 輪才 GO。審查報告的個別 finding 仍要自己驗證（第 3 輪 P3「regex `$` 接受尾端換行」用 node 實測反駁：JS 無 m 旗標的 `$` 不匹配 `
`）。
  - Grok CLI 同時跑兩張卡（測試、腳本）各約 20～40 分鐘、30～45 輪；核心之後又改版時，不必重派整張，改寫「差異卡」（列出新版行為摘要＋要更新的舊斷言＋新增案例），22 個過時斷言一輪就改完。記憶體 Firestore 替身要支援 `set(..., {merge:true})` 與用 promise 互斥鎖串行化 `runTransaction`（模擬 Firestore 樂觀衝突重試），並行節流測試才有意義。
  - emulator 實測：`firebase emulators:exec --config <自訂 json 避開 8080/4000/9099 被別人佔用的 port> --only auth,firestore --project demo-xxx "node chain.js"`；Auth emulator 的 `revokeRefreshTokens` 不強制撤銷 refresh（`refreshFailsAfterRevoke` 恆為 false），正式行為只能部署後觀察。

- **2026-10-23 T-019 補強（取代「FILE 覆寫既有檔一律失敗、要手動 split-loose＋抽 EDIT 分兩次套」）**：
  - 模型常把既有檔整檔用 FILE 輸出：確認是刻意整檔改寫後加 `apply-edits.py ... --allow-overwrite`，腳本會印「原有註解行消失幾行」，>0 就逐行看 diff。同一檔同時有 FILE 與 EDIT 仍會失敗。
  - apply-edits 現在會擋兩種以前會**靜默略過**的壞格式：EDIT 內一個 SEARCH/REPLACE 都解析不到（模型把結尾寫成 `======= END EDIT =====`）、以及輸出被截斷只剩 SEARCH 的最後一塊。截斷時用 `head -n <最後完整區塊行號>` 切出完整部分先套，剩下的改小卡重派或 PM 手補。
  - DeepSeek 偶發 `finish=stop`、只有推理、正文 0 字（同一 prompt 重送就正常，T-019 遇到 2 次）：llm-run.py 會自動重送一次（`LLM_RUN_RETRIED` 防無限重送）。
  - 多張卡平行改同一個測試大檔（`profile.test.tsx`）一定衝突：只讓一張卡擁有它，其他卡的測試寫在自己的新測試檔；功能卡全部套完後再派一張「只改測試」的卡，附 `vitest` 失敗摘要（`grep -E "^ FAIL |^(AssertionError|TestingLibraryElementError|Error|TypeError)"`）。
  - 一段同時派 5 張以上 DeepSeek 卡時，回應會明顯變慢（各卡 3～5 分鐘），但不會失敗；不必分批。

- 非串流會 `IncompleteRead`；一律使用腳本內建 SSE。
- Windows 命令列 32K 上限；prompt 一律走檔案。
- 金鑰換新後，已開著的 session 其程序環境變數仍是舊金鑰（DeepSeek 回 401）；登錄 `HKCU\Environment` 才是新值。同一個 bash 指令內先取新值再呼叫：`export DEEPSEEK_API_KEY="$(powershell.exe -NoProfile -Command "(Get-ItemProperty 'HKCU:\Environment' -Name DEEPSEEK_API_KEY).DEEPSEEK_API_KEY" | tr -d '')" && python -I …/llm-run.py …`（shell 狀態不跨指令保留；不要印出值）。（2026-10-28 DeepSeek 換金鑰後實測）
- Codex `-s read-only` 在這台 Windows 機器無法建立任何命令程序（回 `helper_unknown_error: setup refresh had errors`），所以讓它自己讀檔會整場落空。唯讀審查／寫草稿要把需要的檔案內容（用 `cat -n` 標行號）內嵌進 prompt 檔，並在開頭寫「你無法執行命令，下面已貼出全部內容」；單次約 25 KB 實測可行（約 1.6 萬 token）。審查結論須註明「僅看到貼出的片段」。（2026-10-28 T-062 閾值審查取代：原以為可直接讓 Codex 讀 worktree）
- Bash 工具會還原 `\\`；含反斜線的補丁先用 Write 寫成 `.py` 再執行。
- 模型常省略 `===== END FILE =====`、在檔案外包 Markdown 圍欄、或在結束標記後附說明文字；此時 llm-run.py 的 `--split-dir` 會切不出檔案或切錯（log 沒有「wrote …」行）。改用 `python -I ${CLAUDE_SKILL_DIR}/scripts/split-loose.py <回應檔> <輸出目錄>`：以 FILE 標記為界、在第一個 END 標記截斷、去掉圍欄。Codex 的輸出一律用它切。（2026-10-19 新增）
- 多張卡平行改同一個大檔（例如 `ActivitiesPage.tsx`）：每張卡在 spec 寫死「只能動哪些區塊」，要求 EDIT 區塊；後套的卡 SEARCH 常因前一張改過而對不上（import 列、加了 ref 的元素），用小 Python 腳本把該區塊的 SEARCH 改錨到新內容再套，不要退回整檔輸出。spec 也要明講「含 JSX 的測試副檔名用 `.tsx`」（DeepSeek 三張卡都寫成 `.ts`，tsc 全紅）。（2026-10-22 T-005a）
- **DeepSeek 一張卡的 prompt 超過約 50k token（約 18 萬字元以上）就會把 64k 輸出額度吃在推理、交件被截斷**（2026-10-22 T-005b：兩張 20～32 個附件的卡 `finish=length`，只交出 1～5 個檔）。一張卡只做「純函式＋元件＋測試」、附件控制在 10～17 個（約 3～9 萬字元），頁面接線另開一張給 Codex；截斷時先用 split-loose 切出已完整的檔留用，剩下的拆小卡重派。
- **Codex 遇到「附件只附了函式片段、看不到它依賴的介面」會拒做**（T-005b 接線卡回報「缺少寫入 context 契約」，10 項只做 1 項）。要呼叫的模組整檔附上；若 PM 已查證是既有缺陷，在第 2 輪 spec 明寫「PM 已核實、照此設計做，不要再以缺契約為由停下」並給出介面設計。
- **apply-edits.py 拒絕用 FILE 覆蓋既有檔**（整批不寫）。Codex 常在同一回覆混用「既有檔整檔 FILE」與「EDIT」：先 `split-loose.py` 切出 FILE 檔、人工確認後複製；再把回應中的 EDIT 區段單獨存檔餵 `apply-edits.py`。（2026-10-22 T-010）
- Codex 會照附件標頭把路徑寫成 `B:src/...`（pack-prompt 的 `--alias` 前綴），apply-edits／split-loose 會找不到檔；套用前先 `sed -i 's/===== \(EDIT\|FILE\): B:/===== \1: /'` 去掉前綴。（2026-10-22 T-013）
- **大檔先由 PM 純搬移拆檔再平行派工**：同一頁兩張卡要改同一個大檔時，先把元件拆成兩個檔（純搬移、單獨 commit、測試全過），兩張卡各擁有一個檔並在 spec 寫死兩檔之間的 props 介面；語系檔另開 MiMo 小卡（`--no-think`），避免 DeepSeek 輸出被 7 語 JSON 撐爆。MiMo 有時第一個檔的 FILE 標記不合格式而漏切，驗收時數檔案數。（2026-10-22 T-010）
- 背景平行派工前先 `mkdir -p out`（不要和第一個背景命令寫在同一行），否則其他背景命令的 `> out/x.log` 會因資料夾還不存在而直接失敗。（2026-10-22 T-005a）
- **2026-10-23 T-024 第二輪 b（必守）派工要跑 Functions emulator 的卡（例如端到端驗證），卡上必須寫明憑證隔離**：Functions emulator 沒有本機 secret 檔時會用本機 ADC 讀**正式** Secret Manager（日誌 `Trying to access secret ...@latest`）。卡上要求：臨時 worktree 放 `functions/.secret.local`（不 commit、用完刪）、啟動 shell 設 `CLOUDSDK_CONFIG` 指到空資料夾與 `GOOGLE_APPLICATION_CREDENTIALS` 指到不存在的檔案，並在交件報告列出每次啟動 emulator 的時間與是否隔離。Grok／MiMo 卡一律不跑 firebase／gcloud（deny 清單已含），端到端由 PM 親自跑。完整做法見 test-matrix skill 與 `scripts/qa-test-mode/README.md`。
