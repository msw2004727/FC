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
  python -I apply-edits.py <回應檔> <repo 根目錄> [--dry-run] [--only 路徑] [--allow-overwrite]

規則：
- SEARCH 先逐字比對；找不到時退一步「忽略每行行尾空白」比對；仍找不到或出現多次就失敗並列出，不會猜。
- 任一區塊失敗時整批都不寫（所有檔案），列出失敗區塊；結束碼 1（照 SKILL.md 2026-10-22 T-004 說明）。
- `===== END EDIT =====` 可省略：區塊延伸到下一個 EDIT／FILE 標記或檔尾（模型常漏結束標記）。
- 寫檔一律 UTF-8 無 BOM；既有檔保留原本換行（CRLF 檔不轉成 LF，避免整檔 diff），新檔用 LF。
- `===== FILE: path =====` 區塊（新檔完整內容，到 `===== END FILE =====` 或下一個標記為止，去掉 Markdown 圍欄）一併寫入；已存在的檔案不會被 FILE 覆蓋，會列為失敗。
  加 `--allow-overwrite` 才允許 FILE 覆寫既有檔（印出行數變化與「原有註解行消失幾行」供審 diff；同一檔同時有 FILE 與 EDIT 仍失敗）。
  （2026-10-23 T-019 新增：模型常把既有檔整檔重寫，原本要手動 split-loose＋抽 EDIT 再分兩次套，一張卡要多 3～4 次工具呼叫。）
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
    allow_overwrite = '--allow-overwrite' in sys.argv
    only = None
    if '--only' in sys.argv:
        only = sys.argv[sys.argv.index('--only') + 1]
        args = [a for a in args if a != only]
    resp, root = pathlib.Path(args[0]), pathlib.Path(args[1])
    text = resp.read_text(encoding='utf-8')
    failed = False
    edits = {}
    new_files = {}
    heads = list(HEAD_RE.finditer(text))
    for i, m in enumerate(heads):
        body = text[m.end():heads[i + 1].start() if i + 1 < len(heads) else len(text)]
        if m.group(1) == 'FILE':
            cut = body.find('===== END FILE =====')
            lines = (body[:cut] if cut >= 0 else body).replace('\r\n', '\n').strip('\n').split('\n')
            if lines and lines[0].startswith('```'):
                lines = lines[1:]
            if lines and lines[-1].strip() == '```':
                lines = lines[:-1]
            new_files[m.group(2).strip().replace('\\', '/')] = '\n'.join(lines) + '\n'
            continue
        end = END_RE.search(body)
        if end:
            body = body[:end.start()]
        found = BLOCK_RE.findall(body)
        opened = len(re.findall(r'^<<<<<<< SEARCH[ \t]*$', body, re.M))
        if opened != len(found):
            # 2026-10-23 T-019：輸出被截斷時最後一個區塊只有 SEARCH，原本會被靜默略過。
            print(f'FAIL {m.group(2).strip()}: 有 {opened - len(found)} 個 SEARCH 區塊不完整（輸出截斷或缺 REPLACE）')
            failed = True
        edits.setdefault(m.group(2).strip().replace('\\', '/'), []).extend(found)
    if not edits and not new_files:
        print('[apply-edits] 回應中沒有 EDIT／FILE 區塊')
    pending = []
    for rel, content in new_files.items():
        if only and rel != only:
            continue
        if '..' in rel or rel.startswith('/'):
            print(f'skip {rel}')
            continue
        path = root / rel
        if path.exists():
            if not allow_overwrite:
                print(f'FAIL {rel}: FILE 區塊不能覆蓋既有檔，請改用 EDIT（確認是刻意整檔改寫再加 --allow-overwrite）')
                failed = True
                continue
            if rel in edits:
                print(f'FAIL {rel}: 同一檔同時有 FILE 與 EDIT，無法判斷基準')
                failed = True
                continue
            old = path.read_bytes().decode('utf-8').replace('\r\n', '\n').split('\n')
            new = content.split('\n')
            gone = [l for l in old if l.strip().startswith(('//', '/*', '*')) and l not in new]
            print(f'  {rel}: 整檔覆寫 {len(old)} → {len(new)} 行，原有註解行消失 {len(gone)} 行'
                  + ('（請逐行看 diff，可能被刪註解）' if gone else ''))
            pending.append((rel, path, content, 'overwrite'))
            continue
        pending.append((rel, path, content, 'new'))
    for rel, blocks in edits.items():
        if only and rel != only:
            continue
        if '..' in rel or rel.startswith('/'):
            print(f'skip {rel}')
            continue
        path = root / rel
        if not blocks:
            # 2026-10-23 T-019：模型把結尾寫成「======= END EDIT =====」時原本會靜默套用 0 區塊。
            print(f'FAIL {rel}: EDIT 內解析不到任何 SEARCH/REPLACE（多半缺 >>>>>>> REPLACE）')
            failed = True
            continue
        if not path.is_file():
            print(f'FAIL {rel}: 檔案不存在')
            failed = True
            continue
        raw = path.read_bytes().decode('utf-8')  # read_text 會把 \r\n 轉成 \n，無法判斷原換行
        nl = '\r\n' if '\r\n' in raw else '\n'
        src = raw.replace('\r\n', '\n')
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
        pending.append((rel, path, src.replace('\n', nl), len(blocks)))
    if failed:
        print('[apply-edits] 有區塊失敗，整批未寫入任何檔案')
        return 1
    for rel, path, src, n in pending:
        if not dry:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(src.encode('utf-8'))
        what = {'new': '新檔', 'overwrite': '整檔覆寫'}.get(n, f'{n} 個區塊')
        print(f'{"(dry) " if dry else ""}applied {rel}: {what}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
