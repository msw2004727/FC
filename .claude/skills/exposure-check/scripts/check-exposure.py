"""檢查正式站是否把 repo 內部檔當靜態檔公開（T-008 新增）。

用法：python -I check-exposure.py [--repo D:/.../FC] [--host https://toosterx.com]

- 封鎖清單從 `_worker.js` 的 PRIVATE_REPO_FILES／PRIVATE_REPO_PATH_PREFIXES 抽出；
  每個目錄前綴取 `git ls-files` 中第一個追蹤檔當樣本。
- 公開清單是固定樣本（首頁、內容頁、PWA、LOGO 等），必須 200。
- 只發 GET，不帶任何憑證；任一項不符就 exit 1。
"""
import argparse
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

PUBLIC_SAMPLES = [
    "/", "/index.html", "/manifest.json", "/sw.js", "/manual.html", "/privacy.html",
    "/terms.html", "/llms.txt", "/robots.txt", "/sitemap.xml", "/og.png",
    "/permissions/", "/roles/", "/blog/", "/inventory/", "/blog/badminton-rules.html", "/seo/basketball.html",
    "/js/config.js", "/activities",
]


def status_of(url):
    req = urllib.request.Request(url, headers={"User-Agent": "toosterx-exposure-check"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.status
    except urllib.error.HTTPError as err:
        return err.code
    except Exception as err:  # 網路錯誤要讓人看見，不當成通過
        return "ERR " + type(err).__name__


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=".")
    ap.add_argument("--host", default="https://toosterx.com")
    args = ap.parse_args()

    with open(f"{args.repo}/_worker.js", encoding="utf-8") as fh:
        src = fh.read()
    files_m = re.search(r"PRIVATE_REPO_FILES\s*=\s*new Set\(\[([\s\S]*?)\]\)", src)
    prefixes_m = re.search(r"PRIVATE_REPO_PATH_PREFIXES\s*=\s*\[([\s\S]*?)\]", src)
    if not files_m or not prefixes_m:
        print("找不到 _worker.js 的封鎖常數（PRIVATE_REPO_FILES／PRIVATE_REPO_PATH_PREFIXES）")
        return 2
    files = re.findall(r'"([^"]+)"', files_m.group(1))
    prefixes = re.findall(r'"([^"]+)"', prefixes_m.group(1))

    tracked = subprocess.run(
        ["git", "-c", "core.quotepath=false", "ls-files"], cwd=args.repo,
        capture_output=True, text=True, encoding="utf-8", check=True,
    ).stdout.splitlines()
    blocked = list(files)
    for prefix in prefixes:
        sample = next((t for t in tracked if ("/" + t).startswith(prefix)), None)
        blocked.append("/" + sample if sample else prefix + "x")

    bad = 0
    print(f"主機：{args.host}")
    for path, want in [(p, 404) for p in blocked] + [(p, 200) for p in PUBLIC_SAMPLES]:
        got = status_of(args.host + urllib.parse.quote(path))
        ok = got == want
        bad += 0 if ok else 1
        print(f"{'OK ' if ok else 'BAD'} 應 {want} 實 {got}  {path}")
    print(f"結果：{len(blocked)} 項應封鎖、{len(PUBLIC_SAMPLES)} 項應公開，不符 {bad} 項")
    # 已知殘留（T-008）：_routes.json 以原始路徑比對、靜態檔服務會解碼，編碼變體不會進 worker。
    # 只列出現況、不算失敗；要根治得把 Pages 建置輸出目錄改成只含公開檔（正式設定）。
    print("已知殘留（不計入失敗）：")
    for path in ["/CLAUDE%2Emd", "/%43LAUDE.md", "//CLAUDE.md", "/%2Egithub/workflows/test.yml"]:
        print(f"    實 {status_of(args.host + path)}  {path}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
