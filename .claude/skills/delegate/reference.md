# delegate 參考

## Provider

| provider | endpoint | model | key env | 專用參數 |
| --- | --- | --- | --- | --- |
| `deepseek` | `https://api.deepseek.com/chat/completions` | `deepseek-flash` | `DEEPSEEK_API_KEY` | `--effort low／high／max` |
| `mimo` | `https://api.xiaomimimo.com/v1/chat/completions` | `mimo-v2.6-pro` | `MIMO_API_KEY` | `--no-think` |
| `gemini` | `https://generativelanguage.googleapis.com/v1beta/models/gemini-4-argon:streamGenerateContent?alt=sse` | `gemini-4-argon` | `GEMINI_API_KEY` | — |

## 共同參數

- `--provider deepseek／mimo／gemini`
- `--prompt <file>`
- `--context <file...>`
- `--out <file>`
- `--split-dir <dir>`
- `--max-tokens <n>`
- `--timeout <sec>`

## 限制

- `--effort` 僅 DeepSeek。
- `--no-think` 僅 MiMo。
- DeepSeek 禁用 `deepseek-v4-pro`。
- Codex 只用純文字：`codex exec --skip-git-repo-check -s read-only < prompt.md`。
- 多檔輸出標記：`===== FILE: name =====`、`===== END FILE =====`。
