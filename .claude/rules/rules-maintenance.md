---
paths:
  - "CLAUDE.md"
  - "AGENTS.md"
  - "GEMINI.md"
  - "NAVIGATION.md"
  - ".claude/rules/**"
  - "scripts/check-rules-integrity.js"
  - "scripts/check-rules-integrity.lib.js"
---

# 規則集維護

> 本檔是 `CLAUDE.md` 的領域規則檔，以下 Rule ID 的 canonical 定義在此。條文中的「本檔」除非明確指特定檔案，一律指整個生效規則集（`CLAUDE.md` 加全部規則檔），標記的權威層級不因所在檔案而異。標記、權威順序與授權模式見 `CLAUDE.md` §0；修改本檔後必須跑 `node scripts/check-rules-integrity.js`。

> 2026-11-15 自 `CLAUDE.md` §0.1、§1.1、§18 移入（原文照搬，取代原「常駐在 CLAUDE.md」，因只在改規則集時才用得到）。

## 18. 規則集維護

- **R-GOV-004 [B/HARD]**：交叉引用只用穩定 Rule ID、檔案路徑與 symbol；禁止「第 N 條」、固定行號、固定測試數或其他會漂移的快照。
- **R-CTX-004 [C/DEFAULT]**：不在本檔硬編檔案數、行數、export 數、cache 版號、CI run ID、ACTIVE Functions 數或工具版本；需要時即時查。
- **R-GOV-010 [B/HARD]**：新規則用 `R-{DOMAIN}-{NNN}`；ID 不含章節／日期，搬章不重編，退休不重用。
- **R-GOV-011 [B/HARD]**：每規則一個 canonical 定義；其他處只引用 ID，不複製不同版本。
- **R-GOV-012 [B/HARD]**：區分 RULE、RATIONALE、SNAPSHOT、EXAMPLE；穩定規則留主體，可變快照改「去哪即時查」。
- **R-GOV-013 [A/HARD]**：精簡不得刪有效語意、條件、例外、授權、驗證、精確 shape 或鎖定 symbol；可合併重複、移除過期 snapshot。
- **R-GOV-014 [B/HARD]**：重大重構前保存原文 backup + hash；完成後以舊章／規則 → 新 Rule ID 做獨立審核。
- **R-GOV-015 [B/HARD]**：領域規則檔放 `.claude/rules/*.md`，frontmatter 只用 `paths`（YAML list），每檔對應本檔「變更觸發矩陣」一列以上；Rule ID 的 canonical 定義只能存在於 CLAUDE.md 或其中一個規則檔。修改 CLAUDE.md、任何規則檔、`AGENTS.md`、`GEMINI.md` 或 `NAVIGATION.md` 後，commit 前必須跑 `node scripts/check-rules-integrity.js` 且通過；frontmatter YAML 解析失敗、格式不符或驗證腳本失敗，一律視為驗收失敗（依 Claude Code 官方文件，解析失敗的規則會改為無條件載入，實際行為以官方文件即時查證為準）。
