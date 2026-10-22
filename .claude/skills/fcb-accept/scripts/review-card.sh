#!/usr/bin/env bash
# 把一張外包卡的 FC-B commit 送 Gemini 4 審查（2026-10-22 T-005b 新增）。
# 用法：bash review-card.sh <工作資料夾> <卡號> <FC-B commit> <原派工 prompt 檔> [補充說明檔]
#   工作資料夾內需有 review-common.md（審查清單，可複製 FC docs/specs/lite-convergence/p79-batch3b/review-common.md）。
#   產出：<工作資料夾>/out/review-<卡號>.prompt.md 與 review-<卡號>.gemini.md；最後印出 Gemini 的總結行。
# 第二審（權限／寫入）改送 Codex 時，在 prompt 尾端加「本次第二審只看…」段落，再用 delegate skill 的 codex exec。
set -euo pipefail
DIR=$1; CARD=$2; COMMIT=$3; PROMPT=$4; EXTRA=${5:-}
FCB=${FCB_DIR:-/d/Users/msw74/Documents/github/FC-B}
SKILLS="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$DIR"
mkdir -p out
{
  cat review-common.md
  if [ -n "$EXTRA" ]; then echo; cat "$EXTRA"; fi
  echo; echo "## 交件 diff（FC-B commit $COMMIT，fixture 檔省略）"
  git -C "$FCB" show "$COMMIT" -- . ':!src/features/events/data/__fixtures__'
  echo; echo "## 原派工單"
  cat "$PROMPT"
} > "out/review-$CARD.prompt.md"
python -I "$SKILLS/delegate/scripts/llm-run.py" --provider gemini \
  --prompt "out/review-$CARD.prompt.md" --out "out/review-$CARD.gemini.md" --max-tokens 32000 > "out/review-$CARD.gemini.log" 2>&1
head -1 "out/review-$CARD.gemini.log"
tail -1 "out/review-$CARD.gemini.md"
