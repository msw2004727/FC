---
paths:
  - "firestore.rules"
  - "storage.rules"
  - "firebase.json"
  - "firestore.indexes.json"
  - "functions/**"
  - "js/**"
  - "package.json"
  - "tests/firestore-rules/**"
  - "tests/unit/cloud-functions.test.js"
  - ".github/workflows/**"
---

# Firestore Rules 與 Cloud Functions

> 本檔是 `CLAUDE.md` 的領域規則檔，以下 Rule ID 的 canonical 定義在此。條文中的「本檔」除非明確指特定檔案，一律指整個生效規則集（`CLAUDE.md` 加全部規則檔），標記的權威層級不因所在檔案而異。標記、權威順序與授權模式見 `CLAUDE.md` §0；修改本檔後必須跑 `node scripts/check-rules-integrity.js`。

## 11. Exact Contract Registry：Rules 與 Functions

### 11.1 Firestore Rules

- **R-DATA-001 [A/HARD]**：改 Rules helper 前搜尋所有 caller／allow path。
- **R-DATA-002 [A/HARD]**：禁隨意刪 helper（如 `isSuperAdmin`、`hasPerm`、`isBlocklistFieldsOnly`）；確認零 caller 後仍需獨立明確授權 commit，message 標已查證。
- **R-DATA-003 [A/HARD]**：新增／擴充 `isSafeSelfProfileUpdate` 等欄位 whitelist，同步 Rules tests。
- **R-DATA-004 [B/HARD]**：R-QA-008 全部 Rules 驗證通過才 release；禁 skip。修改前查 memory `stealth`、`Rules`。
- **R-DATA-005 [A/HARD/GATED]**：Rules deploy 獨立授權；部署後代表性 Prod 寫入也另授權，用最小受控資料驗活動、報名、取消。

### 11.2 Cloud Functions

- **R-CF-001 [A/HARD]**：callable 指定 canonical region `asia-east1`，前端 `httpsCallable()` region 一致；mismatch 優先視偽 CORS。
- **R-CF-002 [A/HARD]**：主操作／安全邊界失敗需 function 名、具體上下文 structured log，並重拋或回 sanitized `HttpsError`；禁止空 catch 或只 `console.log(err)`。
- **R-CF-003 [A/HARD]**：明確 best-effort／post-commit side effect 不得把已成功 transaction 偽裝成整體失敗；可不改主結果，但必須檢查 `Promise.allSettled` outcomes、結構化記錄 error／metric，必要時回 degraded 狀態，禁靜默吞錯。
- **R-CF-004 [A/HARD]**：Firestore transaction 保留 SDK retry 或明確處理 `ABORTED` contention。
- **R-CF-005 [A/HARD]**：Functions 權限、capability allowlist、legacy normalization 與前端／Rules parity。
- **R-CF-006 [B/HARD]**：Functions 變更依 R-QA-009，不依 gated deploy job。
- **R-CF-007 [A/HARD/GATED]**：Functions deploy 獨立授權；部署後 `firebase functions:log` 至少 5 分鐘，無 unhandled exception 才宣稱正常。
- **R-CF-008 [A/HARD]**：`deploy-functions.yml` gate／steps 以 workflow 為準；skipped 先查 `workflow_dispatch`、`ENABLE_FUNCTIONS_AUTO_DEPLOY`。
- **R-CF-009 [A/HARD/GATED]**：未授權不得開／關／改 auto-deploy gate；實際 repo variable 即時查，不假設 off。立即上線只部署獲授權 targets。
- **R-CF-010 [A/HARD/GATED]**：開自動部署前即時驗 repo variable、GCP IAM。部署 service account 需最小 service usage、functions developer、scheduler admin；`iam.serviceAccountUser` 只綁實際 runtime account，不 project-wide。
- **R-CF-011 [B/HARD]**：`GenerateUploadUrl`、`iam.serviceAccounts.actAs`、scheduler update 失敗先查 IAM boundary，不直接怪 code。
- **R-CF-012 [B/HARD]**：修改前查 memory `Callable`、`靜默`、region／CORS、variable declaration 教訓。

---

