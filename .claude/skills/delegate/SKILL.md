---
name: delegate
description: 當要把機械性或大量產文工作派給外部 AI 時使用。依任務選 DeepSeek、MiMo、Gemini 或 Codex，產出先進 staging 再驗收。
disable-model-invocation: false
allowed-tools: Bash(python -I ${CLAUDE_SKILL_DIR}/scripts/llm-run.py *), Bash(python -I ${CLAUDE_SKILL_DIR}/scripts/pack-prompt.py *)
---

# delegate

把工作派給外部 AI，自己保留規格與驗收。

## 選模型

| 任務 | Provider／Model | 用法 |
| --- | --- | --- |
| 寫腳本、拆分、整理 | DeepSeek `deepseek-flash` | 主力；禁用 `deepseek-v4-pro`；規格長的產碼任務一律加 `--effort low`（2026-10-18 實測：`high` 與預設都可能把 64k 額度全花在推理、正文 0 字；`low` 仍用約 41k 推理但能完整產出。取代原本未指定 effort 的做法） |
| 格式化、整理 | MiMo `mimo-v2.6-pro` | 複雜任務必加 `--no-think` |
| 審查、長 context | Gemini `gemini-4-argon` | 長文與審查 |
| 審查、較細的產碼 | Codex GPT-6 Astra | 本機無法執行子程序，只能純文字，見下方「Codex 純文字派工」 |

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
- prompt 結尾附 `codex-footer.md`、附件附 FC-B `.claude/rules/review-lessons.md`；附「所有會被改的檔案＋測試＋引用它們的檔案」。
- 規格裡把「要 export 的 API 簽章」與「逐條規則」寫死，Codex 會照名稱產出，驗收時才好對。
- 交件測試的假回應常比伺服器真實形狀精簡（例如 `adjustExp` 少了 `results`）：驗收時拿 `functions/` 的 return 對照 mock。

## FC-B Callable 契約人工補登

`src/data/contract/callables.ts` 標 AUTO-GENERATED，但產生器在 FC local docs、新 Callable 不會自動進來。補登照 `adjustEventCapacity` 先例，四處一起改：檔頭「人工補登：…」那一行加名稱、`<Pascal>Request/Response` 介面（欄位逐條對 `functions/` 的 `request.data` 與 return，註解寫伺服器出處）、`CALLABLES` 表（照字母序、region 照 `functions/index.js`）、`src/data/callables.ts` 的 import 與 `CallableMap`。改完 `npx tsc --noEmit`。不到百行的補登 PM 自己用 Python 精確替換即可，派工說明會比改動還長。

## 審查派工

- 使用 R-REVIEW-011～013 規定的開頭句與欄位。

## 已知限制

- 非串流會 `IncompleteRead`；一律使用腳本內建 SSE。
- Windows 命令列 32K 上限；prompt 一律走檔案。
- Bash 工具會還原 `\\`；含反斜線的補丁先用 Write 寫成 `.py` 再執行。
- 模型常省略 `===== END FILE =====`、在檔案外包 Markdown 圍欄、或在結束標記後附說明文字；此時 llm-run.py 的 `--split-dir` 會切不出檔案或切錯（log 沒有「wrote …」行）。改用 `python -I ${CLAUDE_SKILL_DIR}/scripts/split-loose.py <回應檔> <輸出目錄>`：以 FILE 標記為界、在第一個 END 標記截斷、去掉圍欄。Codex 的輸出一律用它切。（2026-10-19 新增）
- 多張卡平行改同一個大檔（例如 `ActivitiesPage.tsx`）：每張卡在 spec 寫死「只能動哪些區塊」，要求 EDIT 區塊；後套的卡 SEARCH 常因前一張改過而對不上（import 列、加了 ref 的元素），用小 Python 腳本把該區塊的 SEARCH 改錨到新內容再套，不要退回整檔輸出。spec 也要明講「含 JSX 的測試副檔名用 `.tsx`」（DeepSeek 三張卡都寫成 `.ts`，tsc 全紅）。（2026-10-22 T-005a）
- 背景平行派工前先 `mkdir -p out`（不要和第一個背景命令寫在同一行），否則其他背景命令的 `> out/x.log` 會因資料夾還不存在而直接失敗。（2026-10-22 T-005a）
