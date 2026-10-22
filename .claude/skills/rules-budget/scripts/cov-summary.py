"""彙總 Firestore emulator 的 rule coverage，找出哪些 Rules 函式／行吃掉最多運算式（1000 上限診斷用）。

用法：
  curl -s "http://127.0.0.1:8080/emulator/v1/projects/<projectId>:ruleCoverage" -o cov.json
  python -I cov-summary.py cov.json [--top 25] [--lines 起-迄]

- 計數是「自 rules 載入後」所有請求、所有評估回合的累加（emulator 每筆寫入常評估 4 回合，
  其中 2 回合 resource 未定、無法短路），只能做相對比較；同一案例 HEAD 與新版各量一次再比。
- --lines 列出指定行號區間每行的累計次數，用來確認某個 helper 到底被評估到哪一層。
（2026-10-22 T-006 首建）
"""
import argparse
import collections
import json
import re
import sys

ap = argparse.ArgumentParser()
ap.add_argument('cov')
ap.add_argument('--top', type=int, default=25)
ap.add_argument('--lines')
a = ap.parse_args()

d = json.load(open(a.cov, encoding='utf-8'))
src = d['rules']['files'][0]['content'].split('\n')
func_at, cur = {}, '(top)'
for i, line in enumerate(src, 1):
    m = re.match(r'\s*function (\w+)\(', line)
    if m:
        cur = m.group(1)
    elif re.match(r'\s*allow ', line):
        cur = 'allow@%d' % i
    func_at[i] = cur

by_line, by_func, total = collections.Counter(), collections.Counter(), 0


def walk(n):
    global total
    c = sum(v.get('count', 0) for v in n.get('values', []))
    ln = n['sourcePosition']['line']
    by_line[ln] += c
    by_func[func_at.get(ln, '?')] += c
    total += c
    for ch in n.get('children', []):
        walk(ch)


for n in d['report']:
    walk(n)

out = sys.stdout
out.reconfigure(encoding='utf-8')
print('TOTAL expression evaluations', total)
for f, c in by_func.most_common(a.top):
    print(f'{c:7d}  {f}')
if a.lines:
    lo, hi = (int(x) for x in a.lines.split('-'))
    for ln in range(lo, hi + 1):
        print(f'{by_line[ln]:6d} {ln:5d} {src[ln - 1].rstrip()[:110]}')
