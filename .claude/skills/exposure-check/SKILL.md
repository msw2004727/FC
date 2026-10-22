---
name: exposure-check
description: FC 推送到 main（正式站 Cloudflare Pages 自動部署）之後，或改了 _worker.js／_routes.json 的封鎖清單之後使用：對 toosterx.com 實測 repo 內部檔（CLAUDE.md、firestore.rules、.claude/、.github/ 等）是否 404、公開頁是否仍 200。
allowed-tools: Bash(python -I ${CLAUDE_SKILL_DIR}/scripts/check-exposure.py *)
---

# exposure-check

正式站 `toosterx.com` 是 Cloudflare **Pages** 專案 `toosterx`（輸出目錄＝repo 根目錄，Git 追蹤檔全部會被上傳）。Pages 不吃 `.assetsignore`，所以 repo 內部檔是靠 `_worker.js#isPrivateRepoPath`＋`_routes.json` include 擋成 404（T-008，2026-10-22）。

## 用法

```
python -I ${CLAUDE_SKILL_DIR}/scripts/check-exposure.py --repo D:/Users/msw74/Documents/github/FC --host https://toosterx.com
```

- 封鎖清單自動從 `_worker.js` 的 `PRIVATE_REPO_FILES`／`PRIVATE_REPO_PATH_PREFIXES` 抽，目錄前綴用 `git ls-files` 第一個檔當樣本；公開樣本寫在腳本 `PUBLIC_SAMPLES`。
- exit 0＝全部符合；exit 1 會列出 `BAD` 行。推送後 Pages 部署約 1～2 分鐘，太早跑會看到舊結果。
- 也可對 `https://fc-3g8.pages.dev` 跑（同一個 Pages 專案）。
- 腳本最後列「已知殘留」：`/CLAUDE%2Emd`、`//CLAUDE.md` 這類編碼／連續斜線變體不會進 worker（`_routes.json` 用原始路徑比對，靜態檔服務卻會解碼），所以仍是 200。FC repo 在 GitHub 本來就公開，這是整潔問題不是機密外洩；根治要把 Pages 建置輸出目錄改成只含公開檔（Cloudflare 正式設定，需站長授權）。

## 推送前本機模擬（不碰 Cloudflare）

```
git archive HEAD | tar -x -C <空的暫存資料夾>   # 只放 Git 追蹤檔，跟 Pages 上傳內容一致
cd <暫存資料夾> && npx --yes wrangler@4 pages dev . --port 8799 --compatibility-date 2026-01-01
python -I ${CLAUDE_SKILL_DIR}/scripts/check-exposure.py --repo D:/Users/msw74/Documents/github/FC --host http://127.0.0.1:8799
```

- `wrangler pages dev` 會照 `_routes.json` 決定進不進 `_worker.js`，最接近正式站行為；Windows 檔案系統不分大小寫，所以本機 `/claude.md` 會是 200，正式站是 404（正常）。
- 還沒 commit 的檔案記得複製進暫存資料夾。

## 新增根目錄檔時

`tests/unit/private-repo-paths-worker.test.js` 會要求每個新的根層檔／目錄分類：要公開就加進測試的公開清單；不公開就同時加進 `_worker.js` 常數與 `_routes.json` include（`_routes.json` 合計上限 100 條）。
