"""切分只有 `===== FILE: x =====` 開頭、缺少 END 標記的 LLM 回應；每個區塊延伸到下一個 FILE 標記或檔尾。"""
import os
import re
import sys

src, out_dir = sys.argv[1], sys.argv[2]
text = open(src, encoding='utf-8').read()
marks = list(re.finditer(r'^===== FILE: (.+?) =====[ \t]*$', text, re.M))
for i, m in enumerate(marks):
    name = m.group(1).strip().replace('\\', '/')
    if '..' in name or name.startswith('/'):
        print('skip', name)
        continue
    end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
    body = text[m.end():end]
    # 在第一個 END 標記處截斷（標記之後可能是模型附加的說明文字，不屬於檔案）
    end_mark = re.search(r'^===== END FILE =====[ \t]*$', body, re.M)
    if end_mark:
        body = body[:end_mark.start()]
    body = body.lstrip('\n').rstrip()
    # 去掉 LLM 多包的 Markdown 程式碼圍欄（```lang … ```）
    fence = re.match(r'^```[\w.+-]*\n([\s\S]*?)\n```$', body)
    if fence:
        body = fence.group(1)
    body = body + '\n'
    path = os.path.join(out_dir, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, 'w', encoding='utf-8', newline='\n').write(body)
    print('wrote', name, body.count('\n'))
