"""套用 LLM 回應中的 SEARCH/REPLACE 修改區塊到目標 repo（大檔多人同時改時用，避免整檔輸出刪註解、截斷）。

格式（派工單要求模型這樣輸出）：
  ===== EDIT: src/x.tsx =====
  <<<<<<< SEARCH
  （原文，需逐字相同且在檔內唯一）
  =======
  （新內容）
  >>>>>>> REPLACE
  ===== END EDIT =====

用法：
  python -I apply-edits.py <回應檔> <repo 根目錄> [--dry-run] [--only 路徑]

規則：
- SEARCH 先逐字比對；找不到時退一步「忽略每行行尾空白」比對；仍找不到或出現多次就失敗並列出，不會猜。
- 任一區塊失敗時整批都不寫（所有檔案），列出失敗區塊；結束碼 1（照 SKILL.md 2026-10-22 T-004 說明）。
- `===== END EDIT =====` 可省略：區塊延伸到下一個 EDIT／FILE 標記或檔尾（模型常漏結束標記）。
- 寫檔一律 UTF-8 無 BOM、LF。
（2026-10-22 T-004 首建、T-005a 改寫時誤覆蓋後補回相同行為。）
"""
import pathlib
import re
import sys

HEAD_RE = re.compile(r'^===== (EDIT|FILE): (.+?) =====[ \t]*$', re.M)
END_RE = re.compile(r'^===== END EDIT =====[ \t]*$', re.M)
BLOCK_RE = re.compile(r'^<<<<<<< SEARCH[ \t]*\n(.*?)^=======[ \t]*\n(.*?)^>>>>>>> REPLACE[ \t]*$', re.M | re.S)


def find_loose(text: str, search: str):
    """忽略行尾空白比對；回傳 (start, end) 或 None／'multi'。"""
    t_lines = text.split('\n')
    s_lines = search.split('\n')
    norm = [l.rstrip() for l in t_lines]
    s_norm = [l.rstrip() for l in s_lines]
    hits = [i for i in range(len(norm) - len(s_norm) + 1) if norm[i:i + len(s_norm)] == s_norm]
    if not hits:
        return None
    if len(hits) > 1:
        return 'multi'
    i = hits[0]
    start = sum(len(l) + 1 for l in t_lines[:i])
    end = start + sum(len(l) + 1 for l in t_lines[i:i + len(s_norm)]) - 1
    return start, end


def main() -> int:
    sys.stdout.reconfigure(encoding='utf-8')
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    dry = '--dry-run' in sys.argv
    only = None
    if '--only' in sys.argv:
        only = sys.argv[sys.argv.index('--only') + 1]
        args = [a for a in args if a != only]
    resp, root = pathlib.Path(args[0]), pathlib.Path(args[1])
    text = resp.read_text(encoding='utf-8')
    failed = False
    edits = {}
    heads = list(HEAD_RE.finditer(text))
    for i, m in enumerate(heads):
        if m.group(1) != 'EDIT':
            continue
        body = text[m.end():heads[i + 1].start() if i + 1 < len(heads) else len(text)]
        end = END_RE.search(body)
        if end:
            body = body[:end.start()]
        edits.setdefault(m.group(2).strip().replace('\\', '/'), []).extend(BLOCK_RE.findall(body))
    if not edits:
        print('[apply-edits] 回應中沒有 EDIT 區塊')
    pending = []
    for rel, blocks in edits.items():
        if only and rel != only:
            continue
        if '..' in rel or rel.startswith('/'):
            print(f'skip {rel}')
            continue
        path = root / rel
        if not path.is_file():
            print(f'FAIL {rel}: 檔案不存在')
            failed = True
            continue
        src = path.read_text(encoding='utf-8').replace('\r\n', '\n')
        ok = True
        for n, (search, replace) in enumerate(blocks, 1):
            search = search.rstrip('\n')
            replace = replace.rstrip('\n')
            count = src.count(search)
            if count == 1:
                src = src.replace(search, replace, 1)
                continue
            if count > 1:
                print(f'FAIL {rel} 區塊 {n}: SEARCH 出現 {count} 次')
                ok = False
                continue
            span = find_loose(src, search)
            if span is None or span == 'multi':
                first = search.split('\n')[0][:80]
                print(f'FAIL {rel} 區塊 {n}: 找不到（{"多處" if span else "0 處"}）首行：{first}')
                ok = False
                continue
            src = src[:span[0]] + replace + src[span[1]:]
            print(f'  {rel} 區塊 {n}: 行尾空白不同，已用寬鬆比對套用')
        if not ok:
            failed = True
            continue
        pending.append((rel, path, src, len(blocks)))
    if failed:
        print('[apply-edits] 有區塊失敗，整批未寫入任何檔案')
        return 1
    for rel, path, src, n in pending:
        if not dry:
            path.write_bytes(src.encode('utf-8'))
        print(f'{"(dry) " if dry else ""}applied {rel}: {n} 個區塊')
    return 0


if __name__ == '__main__':
    sys.exit(main())
