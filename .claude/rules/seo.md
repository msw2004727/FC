---
paths:
  - "seo/**"
  - "sitemap*.xml"
  - "robots.txt"
  - "_headers"
  - "_worker.js"
  - "blog/**"
  - "index.html"
  - "*.html"
  - "permissions/**"
  - "roles/**"
  - "functions/index.js"
  - "scripts/build-sitemap.js"
  - "scripts/submit-sitemap.js"
  - "scripts/gsc-snapshot.js"
  - "scripts/verify-gsc-read.js"
  - "scripts/inject-hot-events.js"
  - ".github/workflows/**"
---

# SEO log

> 本檔是 `CLAUDE.md` 的領域規則檔，以下 Rule ID 的 canonical 定義在此。條文中的「本檔」除非明確指特定檔案，一律指整個生效規則集（`CLAUDE.md` 加全部規則檔），標記的權威層級不因所在檔案而異。標記、權威順序與授權模式見 `CLAUDE.md` §0；修改本檔後必須跑 `node scripts/check-rules-integrity.js`。

### 15.2 SEO log

- **R-SEO-001 [B/HARD]**：改 `seo/*.html`、`sitemap.xml`、`robots.txt`、`_headers`、meta／OG／hreflang／canonical、JSON-LD、Cloudflare SEO 或 automation 後更新唯一 `docs/seo-log.md`。
- **R-SEO-002 [B/HARD]**：每筆 `### YYYY-MM-DD — 標題`，含「問題／目標、執行項目、關鍵決策」；架構變更同步頂部「SEO 架構總覽」。
- **R-SEO-003 [B/HARD]**：受控 marker 純機器 refresh 仍更新單一 canonical machine-status row，可免重複長篇；generator／template／schema／route 變更寫完整紀錄。generator 失敗停止，不 commit 部分輸出。
- **R-SEO-004 [A/HARD]**：禁平行 SEO log；不記 secret、UID、未遮罩營運資料。

---

