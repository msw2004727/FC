# 剝開 `claude -p --output-format json` 的輸出：JSON 陣列在 result 字串裡（可能包 Markdown 圍欄），
# 不在最外層；直接 json.load 後取 [0] 會 KeyError。
# 用法：python -I parse-results.py <輸出 JSON 路徑> <out-*.json ...>
# 合併成 {檔名: [卡片條目...]}；失敗的檔案印出原因（空檔＝還在跑或被中斷；error_max_turns＝卡太寬）。
import json, re, sys, os
sys.stdout.reconfigure(encoding='utf-8'); sys.stderr.reconfigure(encoding='utf-8')

def extract(path):
    raw = open(path, encoding='utf-8').read().strip()
    if not raw:
        raise ValueError('空檔（仍在執行或被中斷）')
    o = json.loads(raw)
    if isinstance(o, list):  # 部分版本輸出事件陣列，取最後一個帶 result 的
        o = [x for x in o if isinstance(x, dict) and 'result' in x][-1]
    if o.get('subtype') and o['subtype'] != 'success':
        raise ValueError(f"subtype={o['subtype']}")
    m = re.search(r'\[.*\]', o.get('result') or '', re.S)
    if not m:
        raise ValueError('result 內沒有 JSON 陣列')
    return json.loads(m.group(0))

out, files = sys.argv[1], sys.argv[2:]
res, bad = {}, 0
for f in files:
    try:
        res[os.path.basename(f)] = extract(f)
    except Exception as e:
        bad += 1
        print(f'{f}: FAIL {e}', file=sys.stderr)
with open(out, 'w', encoding='utf-8', newline='\n') as w:
    json.dump(res, w, ensure_ascii=False, indent=1)
print({k: len(v) for k, v in res.items()}, f'fail={bad}')
sys.exit(1 if bad else 0)
