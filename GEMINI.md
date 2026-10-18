# ToosterX — AI 指引入口（Gemini）

本檔不維護平行規則，只做導入口。

1. 開始任何分析、規劃、實作、修改、提交或回覆前，**先完整閱讀 `CLAUDE.md`**；它是核心規則，每次都讀。
2. 分析、規劃、審查、修改或操作特定領域前，**再讀對應的領域規則檔**（Codex／Gemini 不會自動載入，必須手動讀）；涉及多列時全部都讀（取聯集）；規則檔缺失時回報，不得視為無規則：

| 要處理的範圍 | 先讀 |
|------------|------|
| 模組新增／搬移、timeout／limit 等 tunables | `.claude/rules/architecture-tunables.md` |
| `sw.js`、cache 版號、release、獨立內容頁 | `.claude/rules/release-sw.md` |
| 任何 JS／CSS／HTML／Functions／Rules 變更的測試與 review 要求；任何 review／驗證回報（不論是否改程式） | `.claude/rules/testing-review.md` |
| entity ID、後台權限、user capabilities | `.claude/rules/id-permissions.md` |
| 活動列表、黑名單、報名、候補、課程、出席、統計 | `.claude/rules/events-registration-stats.md` |
| `firestore.rules`、`functions/**`、Functions／Rules 部署、`deploy-functions.yml`、`firebase.json`、前端 `httpsCallable()` | `.claude/rules/firestore-functions.md` |
| async `show*`、route、popstate、history | `.claude/rules/navigation-history.md` |
| LINE 分享、Mini App、OG、QR | `.claude/rules/share.md` |
| UI、modal、動畫、展示名單 | `.claude/rules/ui.md` |
| SEO、sitemap、robots、`_headers` | `.claude/rules/seo.md` |
| `CLAUDE.md`、規則檔、`AGENTS.md`、`GEMINI.md`、`NAVIGATION.md` 本身 | `.claude/rules/governance-migration.md` |

3. 專案結構與檔案責任見 `NAVIGATION.md`。
4. `.claude/skills/*/SKILL.md` 是 Claude Code 的固定流程 skill；非 Claude 工具不會自動載入，但可把 SKILL.md 當作該流程的步驟說明直接照做（例如 release bump、測試矩陣、編碼檢查、commit 流程）。
5. 規則有重複、差異或不同步時，一律以 `CLAUDE.md` 與規則檔為準；本檔與 `AGENTS.md` 只是入口。
6. 改了 `CLAUDE.md`、規則檔、`AGENTS.md`、`GEMINI.md` 或 `NAVIGATION.md`，commit 前跑 `node scripts/check-rules-integrity.js`。
