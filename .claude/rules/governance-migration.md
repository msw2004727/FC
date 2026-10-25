---
paths:
  - "CLAUDE.md"
  - "AGENTS.md"
  - "GEMINI.md"
  - "NAVIGATION.md"
  - ".claude/rules/**"
---

# 舊版衝突／過期政策遷移表

> 本檔是 `CLAUDE.md` 的領域規則檔，但只記錄舊版衝突／過期政策的遷移索引，不定義任何 Rule ID；實際契約見各 canonical 規則檔。標記、權威順序與授權模式見 `CLAUDE.md` §0；修改本檔後必須跑 `node scripts/check-rules-integrity.js`。

## 17. 舊版衝突／過期政策遷移表

本表只記錄遷移類型與 canonical IDs；實際行為只讀 Rule ID。

| 舊衝突／舊政策 | Canonical IDs | 處理類型 |
|-----------------|---------------|----------|
| `docs/` 不進 Git vs memory「隨 Git」 | R-DOC-001、R-LOG-002 | STALE_FACT_CORRECTED |
| Production-only vs Demo／Prod | R-CTX-001～002、R-REG-016 | STALE_FACT_CORRECTED |
| 每次修改即 bump vs release batch／獨立內容頁 | R-REL-006～009 | POLICY_CLARIFIED |
| UI 禁硬編色碼 vs modal 固定值 | R-UI-005、R-UI-010～011 | CONFLICT_RESOLVED |
| 必須用 `ui-*` vs 尚未實作 | R-UI-012～014 | STALE_FACT_CORRECTED |
| event-share 真人去 Mini App vs網站 | R-SHARE-004～006 | FINAL_BEHAVIOR |
| 所有 QR 都用分享 URL | R-SHARE-004 | SCOPE_CORRECTED |
| skip 規則衝突 | R-QA-004～007 | CONFLICT_RESOLVED |
| review 與 tests 順序 | R-REVIEW-001～006、R-SHIP-014～015 | ORDER_CANONICALIZED |
| 新程式禁 `.then()` vs legacy | R-CODE-001、R-NAV-005 | POLICY_CLARIFIED |
| 300 行 vs legacy 大檔 | R-ARCH-001～003 | LEGACY_EXCEPTION |
| docs-only／完成後自動 stage、commit、push | R-MODE-001～004、R-SHIP-002～004、R-SHIP-016～018 | SAFETY_UPGRADE_SUPERSEDES |
| 根因後確認 | R-MODE-003 | SEMANTIC_PRESERVED_WITH_PREAUTH |
| 不存在 `docs/structure-guide.md` | R-ARCH-004～005 | BROKEN_REFERENCE_REMOVED |
| 委託人僅簽到／掃碼 vs action-specific edit／cancel／close／reopen scope | R-IAM-004、R-IAM-010～013、R-CAP-002 | STALE_CONTRACT_CORRECTED |
| staff rolePermissions 可完整撤權 vs Rules `isCoachPlus()`／Functions 跨活動 fallback | R-IAM-004、R-IAM-008 | RUNTIME_DRIFT_DISCLOSED |
| 三種活動紀錄子集合契約被縮成 registrations | R-REG-014 | SEMANTIC_RESTORED |
| collectionGroup 必須排除 legacy root vs home next registrations 漏 filter（T-034 已修，2026-10-26） | R-REG-014 | RUNTIME_DRIFT_RESOLVED |
| 統計只准 UID vs achievement batch 歷史姓名補查 | R-STAT-003 | LEGACY_EXCEPTION_DISCLOSED |
| history 全路徑 non-null vs preserve-state null fallback | R-NAV-011 | RUNTIME_DRIFT_DISCLOSED |
| R-SHIP authority 區間與逐條標記不一致 | R-MODE-004、R-SHIP-010～019 | CONFLICT_RESOLVED |
| 一般 user 活動黑名單「絕對無」vs UID 個別授權 | R-EVT-018～019 | AUTH_SCOPE_CORRECTED |
| 自動部署 vs外部狀態 | R-SAFE-015、R-SHIP-001、R-CF-008～010 | SAFETY_UPGRADE_SUPERSEDES |
| `ta_` 一律 `generateId()` vs 決定性申請文件鍵 | R-ID-006 | CONTRACT_CORRECTED |

---

