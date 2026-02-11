# SportHub — Claude Code 專案指引

## 快取版本號規則（每次修改必做）

當你修改了任何 JS 或 HTML 檔案後，**必須**同步更新快取版本號：

1. 更新 `js/config.js` 中的 `CACHE_VERSION` 常數
2. 更新 `index.html` 中所有 `?v=` 參數（CSS + JS，共約 40 處）
3. 版本號格式：`YYYYMMDD`，同天多次部署加後綴 `a`, `b`, `c`...

範例：`20260211` → `20260211a` → `20260211b` → `20260212`

> `page-loader.js` 的 fetch 會自動讀取 `CACHE_VERSION`，不需額外改。
