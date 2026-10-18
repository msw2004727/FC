#!/usr/bin/env python3
"""Minimal OpenAI-compatible chat driver for DeepSeek / MiMo.

Usage:
  python -I llm-run.py --provider deepseek|mimo --prompt P.md [--context F ...]
         --out OUT.md [--split-dir DIR] [--max-tokens N] [--effort low|high|max]

- Context files are appended to the user message as fenced sections.
- The raw assistant text is written to --out.
- With --split-dir, sections delimited by lines `===== FILE: <name> =====` ...
  `===== END FILE =====` are written to DIR/<name>.
- Only usage stats are printed; the response body never hits stdout.
"""
import argparse, json, os, re, sys, time, urllib.request

PROVIDERS = {
    "deepseek": dict(url="https://api.deepseek.com/chat/completions",
                     model="deepseek-flash", key_env="DEEPSEEK_API_KEY"),
    "mimo": dict(url="https://api.xiaomimimo.com/v1/chat/completions",
                 model="mimo-v2.6-pro", key_env="MIMO_API_KEY"),
    "gemini": dict(url="https://generativelanguage.googleapis.com/v1beta/models/gemini-4-argon:streamGenerateContent?alt=sse",
                   model="gemini-4-argon", key_env="GEMINI_API_KEY"),
}


def run_gemini(p, key, user, a):
    """Gemini REST (SSE). Returns (text, usage, finish, model)."""
    payload = {"contents": [{"role": "user", "parts": [{"text": user}]}],
               "generationConfig": {"maxOutputTokens": a.max_tokens}}
    req = urllib.request.Request(p["url"], data=json.dumps(payload).encode("utf-8"),
                                 headers={"Content-Type": "application/json", "x-goog-api-key": key})
    parts, usage, finish = [], {}, None
    with urllib.request.urlopen(req, timeout=a.timeout) as r:
        for raw in r:
            line = raw.decode("utf-8", errors="replace").strip()
            if not line.startswith("data:"):
                continue
            try:
                ev = json.loads(line[5:].strip())
            except ValueError:
                continue
            if "error" in ev:
                raise RuntimeError(json.dumps(ev["error"])[:300])
            um = ev.get("usageMetadata")
            if um:
                usage = {"prompt_tokens": um.get("promptTokenCount"),
                         "completion_tokens": um.get("candidatesTokenCount"),
                         "completion_tokens_details": {"reasoning_tokens": um.get("thoughtsTokenCount")}}
            for c in ev.get("candidates") or []:
                for part in (c.get("content") or {}).get("parts") or []:
                    if part.get("text") and not part.get("thought"):
                        parts.append(part["text"])
                if c.get("finishReason"):
                    finish = c["finishReason"]
    return "".join(parts), usage, finish, p["model"]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--provider", required=True, choices=PROVIDERS)
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--context", nargs="*", default=[])
    ap.add_argument("--out", required=True)
    ap.add_argument("--split-dir")
    ap.add_argument("--max-tokens", type=int, default=65536)
    ap.add_argument("--effort")
    ap.add_argument("--no-think", action="store_true", help="mimo: disable thinking")
    ap.add_argument("--timeout", type=int, default=1800)
    a = ap.parse_args()

    p = PROVIDERS[a.provider]
    key = os.environ.get(p["key_env"])
    if not key:
        print("missing env", p["key_env"]); sys.exit(2)

    user = open(a.prompt, encoding="utf-8").read()
    for c in a.context:
        body = open(c, encoding="utf-8", errors="replace").read()
        user += f"\n\n----- CONTEXT FILE: {c} -----\n```\n{body}\n```\n----- END CONTEXT FILE -----\n"

    payload = {"model": p["model"], "max_tokens": a.max_tokens, "stream": True,
               "stream_options": {"include_usage": True},
               "messages": [{"role": "user", "content": user}]}
    if a.effort and a.provider == "deepseek":
        payload["reasoning_effort"] = a.effort
    if a.no_think and a.provider == "mimo":
        payload["thinking"] = {"type": "disabled"}
    req = urllib.request.Request(p["url"], data=json.dumps(payload).encode("utf-8"),
                                 headers={"Content-Type": "application/json",
                                          "Accept": "text/event-stream",
                                          "Authorization": f"Bearer {key}"})
    t0 = time.time()
    text_parts, usage, finish, model, last_err = [], {}, None, None, None
    try:
      if a.provider == "gemini":
        gt, usage, finish, model = run_gemini(p, key, user, a)
        text_parts.append(gt)
      else:
        with urllib.request.urlopen(req, timeout=a.timeout) as r:
            if r.headers.get("Content-Type", "").startswith("application/json"):
                data = json.load(r)
                if "choices" not in data:
                    print("API ERROR:", json.dumps(data)[:500]); sys.exit(1)
                ch = data["choices"][0]
                text_parts.append(ch["message"].get("content") or "")
                finish, usage, model = ch.get("finish_reason"), data.get("usage", {}), data.get("model")
            else:
                for raw in r:
                    line = raw.decode("utf-8", errors="replace").strip()
                    if not line.startswith("data:"):
                        continue
                    body = line[5:].strip()
                    if body == "[DONE]":
                        break
                    try:
                        ev = json.loads(body)
                    except ValueError:
                        continue
                    if "error" in ev:
                        last_err = ev["error"]; break
                    model = ev.get("model") or model
                    if ev.get("usage"):
                        usage = ev["usage"]
                    for ch in ev.get("choices") or []:
                        d = ch.get("delta") or {}
                        if d.get("content"):
                            text_parts.append(d["content"])
                        if ch.get("finish_reason"):
                            finish = ch["finish_reason"]
    except Exception as e:  # noqa
        print("REQUEST FAILED:", type(e).__name__, str(e)[:300],
              f"(partial chars={sum(map(len, text_parts))})"); sys.exit(1)
    if last_err:
        print("API ERROR:", json.dumps(last_err)[:500]); sys.exit(1)
    dt = time.time() - t0
    data = {"usage": usage, "model": model}
    ch = {"finish_reason": finish}
    text = "".join(text_parts)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    written = []
    if a.split_dir:
        os.makedirs(a.split_dir, exist_ok=True)
        for m in re.finditer(r"===== FILE: (.+?) =====\n(.*?)\n===== END FILE =====", text, re.S):
            name = m.group(1).strip().replace("\\", "/")
            if ".." in name or name.startswith("/"):
                continue
            path = os.path.join(a.split_dir, name)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            body = m.group(2)
            if not body.endswith("\n"):
                body += "\n"
            with open(path, "w", encoding="utf-8", newline="\n") as f:
                f.write(body)
            written.append((name, body.count("\n")))
    u = data.get("usage", {})
    print(f"provider={a.provider} model={data.get('model')} finish={ch.get('finish_reason')} "
          f"prompt_tokens={u.get('prompt_tokens')} completion_tokens={u.get('completion_tokens')} "
          f"reasoning={(u.get('completion_tokens_details') or {}).get('reasoning_tokens')} "
          f"elapsed={dt:.0f}s out_chars={len(text)}")
    for n, l in written:
        print(f"  wrote {n} ({l} lines)")
    if ch.get("finish_reason") == "length":
        print("WARNING: output truncated (finish_reason=length)")

if __name__ == "__main__":
    main()
