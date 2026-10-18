---
name: delegate
description: 當要把機械性或大量產文工作派給外部 AI 時使用。依任務選 DeepSeek、MiMo、Gemini 或 Codex，產出先進 staging 再驗收。
disable-model-invocation: false
allowed-tools: Bash(python -I ${CLAUDE_SKILL_DIR}/scripts/llm-run.py *)
---

# delegate

把工作派給外部 AI，自己保留規格與驗收。

## 選模型

| 任務 | Provider／Model | 用法 |
| --- | --- | --- |
| 寫腳本、拆分、整理 | DeepSeek `deepseek-flash` | 主力；禁用 `deepseek-v4-pro`；規格長的產碼任務一律加 `--effort low`（2026-10-18 實測：`high` 與預設都可能把 64k 額度全花在推理、正文 0 字；`low` 仍用約 41k 推理但能完整產出。取代原本未指定 effort 的做法） |
| 格式化、整理 | MiMo `mimo-v2.6-pro` | 複雜任務必加 `--no-think` |
| 審查、長 context | Gemini `gemini-4-argon` | 長文與審查 |
| 審查 | Codex GPT-6 Astra | 本機無法執行子程序，只能純文字：`codex exec --skip-git-repo-check -s read-only < prompt.md` |

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

## 審查派工

- 使用 R-REVIEW-011～013 規定的開頭句與欄位。

## 已知限制

- 非串流會 `IncompleteRead`；一律使用腳本內建 SSE。
- Windows 命令列 32K 上限；prompt 一律走檔案。
- Bash 工具會還原 `\\`；含反斜線的補丁先用 Write 寫成 `.py` 再執行。
