#!/bin/bash
# 平行執行 MiMo 唯讀稽核卡：每張 <卡片目錄>/card-*.md 產生同目錄 out-*.json 與 err-*.txt。
# 用法：bash run-cards.sh <卡片目錄> <工作目錄> [額外可讀目錄 ...]
set -u
CARDS="$1"; WORK="$2"; shift 2
ADD=(--add-dir "$CARDS")
for d in "$@"; do ADD+=(--add-dir "$d"); done
cd "$WORK" || exit 1
for card in "$CARDS"/card-*.md; do
  g="$(basename "$card" .md)"; g="${g#card-}"
  ( env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_BASE_URL CLAUDE_CONFIG_DIR=C:/t/mimo-claude-home \
      claude -p "請讀 $card 並完全照卡片指示做，最後只輸出 JSON 陣列。" --output-format json --max-turns 40 \
      --allowedTools "Read,Grep,Glob" "${ADD[@]}" \
      > "$CARDS/out-$g.json" 2> "$CARDS/err-$g.txt" ) &
done
wait
echo "done: $(ls "$CARDS"/out-*.json | wc -l) cards"
