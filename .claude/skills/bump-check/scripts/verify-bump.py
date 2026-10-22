"""檢查 bump-version.js 的工作樹變更是否只換了主站版號。

用法：python -I verify-bump.py <舊版號> <新版號> [repo 根目錄]
比對 HEAD 與工作樹的 index.html、js/config.js、sw.js：每一行把舊版號換成新版號後
必須與工作樹相同；不同就列出行號與附近內容，exit 1。
--restore 會把「不只換版號」的行還原成 HEAD 原文（例如 boot-public-lists-data 快照
JSON 裡的圖片 ?v=），還原後重新檢查。
"""
import subprocess, sys

FILES = ["index.html", "js/config.js", "sw.js"]


def check(root, old, new, restore):
    bad = 0
    for f in FILES:
        head = subprocess.run(["git", "-C", root, "show", f"HEAD:{f}"],
                              capture_output=True, check=True).stdout.decode("utf-8").split("\n")
        path = f"{root}/{f}"
        with open(path, encoding="utf-8", newline="") as fh:
            work = fh.read().split("\n")
        if len(head) != len(work):
            print(f"{f}: 行數不同 {len(head)} → {len(work)}")
            bad += 1
            continue
        changed = 0
        for i, (a, b) in enumerate(zip(head, work)):
            if a == b:
                continue
            changed += 1
            if a.replace(old, new) == b:
                continue
            j = next((k for k in range(min(len(a), len(b))) if a[k] != b[k]), 0)
            print(f"{f}:{i + 1} 不只換版號：\n  舊 {a[max(0, j - 60):j + 60]}\n  新 {b[max(0, j - 60):j + 60]}")
            bad += 1
            if restore:
                work[i] = a.replace(old, new)
        if restore:
            with open(path, "w", encoding="utf-8", newline="") as fh:
                fh.write("\n".join(work))
        print(f"{f}: {changed} 行變更")
    return bad


def main():
    args = [a for a in sys.argv[1:] if a != "--restore"]
    restore = "--restore" in sys.argv
    if len(args) < 2:
        print(__doc__)
        sys.exit(2)
    old, new = args[0], args[1]
    root = args[2] if len(args) > 2 else "."
    bad = check(root, old, new, restore)
    if restore and bad:
        print("已還原，重新檢查：")
        bad = check(root, old, new, False)
    print("OK：只換了版號" if not bad else f"有 {bad} 處不只換版號")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
