"""把「規格＋附件節錄＋固定頁尾」打包成一個 UTF-8 prompt 檔，給只能讀純文字的 Codex／Gemini／DeepSeek。

用法：
  python -I pack-prompt.py --spec spec.md --out prompt.md [--root REPO] [--footer footer.md] ATTACH...

ATTACH 格式（路徑相對 --root，可混用）：
  path                       整檔
  path#120-180               第 120～180 行（含頭尾）
  path#|起始字串|結束字串|      從起始字串到結束字串（含），各取第一次出現（用 | 分隔，因程式碼常含 /）
  path#|起始字串|              從起始字串到檔尾
附件標題就是 ATTACH 原字串。找不到檔案或字串會直接失敗，不會靜默少附。
"""
import argparse
import pathlib
import sys


def extract(root: pathlib.Path, spec: str) -> str:
    path, _, sel = spec.partition("#")
    p = root / path
    if not p.is_file():
        sys.exit(f"[pack-prompt] 找不到檔案：{p}")
    text = p.read_text(encoding="utf-8")
    if not sel:
        return text
    if sel.startswith("|"):
        parts = sel[1:].split("|")
        start = parts[0]
        end = parts[1] if len(parts) > 1 and parts[1] else None
        i = text.find(start)
        if i < 0:
            sys.exit(f"[pack-prompt] {path} 找不到起始字串：{start}")
        if end is None:
            return text[i:]
        j = text.find(end, i)
        if j < 0:
            sys.exit(f"[pack-prompt] {path} 找不到結束字串：{end}")
        return text[i:j + len(end)]
    a, _, b = sel.partition("-")
    lines = text.split("\n")
    lo, hi = int(a), int(b or a)
    if lo < 1 or hi > len(lines) or lo > hi:
        sys.exit(f"[pack-prompt] {path} 行號超出範圍：{sel}（共 {len(lines)} 行）")
    return "\n".join(lines[lo - 1:hi])


def main() -> None:
    # Windows 主控台預設 cp950，訊息改用 UTF-8 輸出（Git Bash 才不會亂碼）。
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--root", default=".")
    ap.add_argument("--footer")
    ap.add_argument("attach", nargs="*")
    args = ap.parse_args()

    root = pathlib.Path(args.root)
    out = [pathlib.Path(args.spec).read_text(encoding="utf-8"), "\n\n# 附件\n"]
    for spec in args.attach:
        out.append(f"\n===== ATTACHMENT: {spec} =====\n{extract(root, spec)}\n===== END ATTACHMENT =====\n")
    if args.footer:
        out.append("\n" + pathlib.Path(args.footer).read_text(encoding="utf-8"))
    body = "".join(out)
    # 直接以 UTF-8 bytes 寫檔，避免 Windows 主控台 cp950 把中文弄成非法 UTF-8（Codex 會拒收）。
    pathlib.Path(args.out).write_bytes(body.encode("utf-8"))
    print(f"[pack-prompt] {args.out}：{len(body)} 字元、{len(args.attach)} 個附件")


if __name__ == "__main__":
    main()
