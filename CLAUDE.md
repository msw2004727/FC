# ToosterX — AI 專案指引

> **Last Reviewed / Verified: 2026-10-18**
> 每 2 個月審閱一次；重大架構、權限、資料模型或部署流程改變時立即審閱。

本檔與 `.claude/rules/` 下的領域規則檔共同構成本專案唯一生效的 AI 規則集。本檔是入口與核心，每次 session 必讀；領域規則檔依「變更觸發矩陣」在觸及對應檔案時載入（Claude Code 透過 `paths` frontmatter 自動載入；其他 AI 依 `AGENTS.md`／`GEMINI.md` 手動讀取）。所有 AI 在分析、規劃、修改或回覆前必須完整閱讀本檔；分析、規劃、審查、修改或操作特定領域前，必須先讀該領域的規則檔，涉及多個領域時取聯集，規則檔缺失時回報而不是視為無規則。專案結構導覽見 `NAVIGATION.md`。

規則條文中的「本檔」除非上下文明確指特定檔案，一律指整個生效規則集（本檔加全部規則檔）；A/HARD、B/HARD 等標記的權威層級不因條文所在檔案而異。任何 review、驗證回報或測試取捨，不論是否觸及程式路徑，一律適用 `.claude/rules/testing-review.md` 的 R-QA-004、R-QA-007 與 R-REVIEW-014，執行前先讀該檔。
## 0. 規則使用方式

### 0.1 標記、權威與衝突

| 標記 | 意義 |
|------|------|
| **A/HARD** | 安全、授權、秘密、資料完整性或 Production 邊界；不得被較低層規則覆寫 |
| **B/HARD** | 正確性、測試、release 與回歸保護；除明列例外外必須遵守 |
| **C/DEFAULT** | 維護性、架構與風格預設；可因已驗證限制偏離，但必須說明 |
| **GATED** | 只有使用者針對該動作明確授權後才能執行 |
| **INFO** | 背景或現況定位，不是可獨立授權的命令 |

- **R-GOV-001 [A/HARD]**：權威順序：系統／開發者／工具安全限制 → 使用者目前明確指示 → 本檔 A/HARD → 較窄的領域規則 → 一般預設 → 範例、歷史與計畫書。
- **R-GOV-002 [A/HARD]**：計畫書、註解、memory 或 workflow 即使寫「自動 commit／push／deploy」，也不構成當前授權。
- **R-GOV-003 [B/HARD]**：Runtime 現況以實際 code／config／rules／tests 為準；本檔定義應遵守的行為。若不一致，指出 drift，不得靜默把任一方當正確。
- **R-GOV-004 [B/HARD]**：交叉引用只用穩定 Rule ID、檔案路徑與 symbol；禁止「第 N 條」、固定行號、固定測試數或其他會漂移的快照。
- **R-GOV-005 [A/HARD]**：規則無法同時滿足時，秘密、權限、正式資料、外部寫入或不可逆行為一律停止詢問；低風險且可回退的操作也只能在本次已授權模式、檔案與動作範圍內採保守解讀，不能產生新權限。
- **R-GOV-007 [B/HARD]**：本檔、規則檔、memory、skill 與失誤檢討都只是「目前已知最好的做法」，不是守則；發現更好的做法可直接改寫，並在改動處寫一行「取代了什麼、為什麼」，不必先問站長。唯一例外、只認站長本人授權的三類：推送上線（push／deploy）、刪資料或改正式設定、放寬安全規則。（2026-10-18 站長指示新增；取代先前「所有修改與 commit 皆需逐次授權」的默契，因為逐次詢問拖慢工作並浪費用量。）三類的授權取得方式（2026-10-22 站長親口定案，取代原「只認親口說才算」）：由指揮官 session 附「建議＋原因」詢問站長，**站長未回應即視為授權照建議執行**；站長明說「等我確認／先不要」時仍依 R-SHIP-002 暫緩。PM 分支不得自行執行三類動作，一律上報指揮官。UI/UX 介面改動派工前須站長預覽並同意，此項沒有「未回應視為同意」。流程見 local-only `docs/specs/lite-convergence/commander-dispatch.md`。
- **R-GOV-006 [A/HARD]**：R-ID-001～011、R-IAM-001～013、R-CAP-001～010、R-EVT-001～005、R-EVT-010～019、R-REG-001～016、R-STAT-000～006、R-DATA-001～005、R-CF-001～012、R-NAV-001～008、R-NAV-011～020、R-SHARE-001～013、R-UI-001～006、R-UI-010～014、R-UI-020～025 是不可摘要化的 Exact Contract Registry。權限碼、欄位、集合路徑、function／symbol、predicate、排序與 option 必須精確保留，不得用「等價概念」取代。

### 0.2 任務模式與授權

| 使用者需求 | 可執行 | 不得自行擴張 |
|------------|--------|--------------|
| 資訊查詢／唯讀調查 | 讀檔、搜尋、唯讀命令、分析與回報 | 修改檔案、log、版本、Git 或外部狀態 |
| 診斷 | 找根因、蒐證、說明影響 | 未獲修復確認前不修改 |
| 規劃 | 計畫、風險、工作量、驗收方式 | 實作、建檔、commit、push、deploy |
| 實作／修復 | 已授權範圍內的本機修改與驗證 | commit、push、deploy、正式資料寫入 |
| Review | 唯讀檢查 diff、檔案、tests、呼叫鏈並提出 findings | 直接修檔或改外部狀態 |
| Commit | 驗證完成後精確 stage 本次範圍檔案並 commit，不需逐次授權 | push 或 deploy |
| Push／Deploy | 僅執行明確指定 repo、branch、服務與環境 | 其他 lane、IAM、secret 或資料遷移 |

- **R-MODE-001 [A/HARD]**：`push`、靜態站 deploy、Functions deploy、Rules deploy、IAM／secret 變更、Git history rewrite 與 Production 資料寫入，是彼此獨立的 GATED 動作。本機 `commit` 不再 GATED，可在驗證完成後直接執行（2026-10-18 依 R-GOV-007 取代原「commit 也是 GATED」：commit 可回退、不碰外部狀態，逐次授權只增加往返）。GATED 動作的授權取得方式依 R-GOV-007（2026-10-22 起含「指揮官附建議詢問、站長未回應即照建議執行」）。
- **R-MODE-002 [A/HARD]**：「完成、處理好、不要停」只要求持續完成已授權範圍，不擴張外部寫入權限。
- **R-MODE-003 [A/HARD]**：bug／異常確認根因後，先回報根因、修改範圍與風險，取得確認後才修改。只有使用者同一需求明確預授權「根因確認後直接修復、不需二次確認」時可免再問；高風險歧義仍須停止確認。
- **R-MODE-004 [A/HARD]**：本節矩陣、R-SHIP-010、R-SHIP-016～018 屬 A/HARD；R-SHIP-011～015、R-SHIP-019 依各自標示為 B/HARD。同步文件／日誌、清理、保守解讀或 release preparation 都不得越過當前模式；READ_ONLY、DIAGNOSE、PLAN、REVIEW 未獲修改授權時永不寫檔。

### 0.3 永久地雷

| 地雷 | 典型後果 | Canonical Rule |
|------|----------|----------------|
| 新舊活動 ID 橋接 | 統計歸零、跨集合 join 失敗 | R-ID-007～R-ID-011 |
| UID 欄位差異 | 身分誤判、出席統計歸零 | R-ID-002～R-ID-003、R-STAT-002～R-STAT-003 |
| `INHERENT_ROLE_PERMISSIONS` 雙端同步 | 前後端授權靜默分歧 | R-IAM-008 |
| 報名／候補原子操作 | 超收、current 覆蓋、漏遞補 | R-REG-001～R-REG-016 |
| Firestore 初始化參數 | 費用暴增、多分頁衝突 | 搜尋 memory 的 `synchronizeTabs` |
| Callable region | 偽裝成 CORS 的呼叫失敗 | R-CF-001 |
| 泛用 owner／delegate fallback | 委託人被錯誤擴權 | R-IAM-010～R-IAM-013 |
| `attendanceRecords.uid` 誤用 | 出席率、放鴿子統計錯誤 | R-STAT-002～R-STAT-003 |
| cache 版號不同步 | 新舊 JS／HTML 混載 | R-REL-001～R-REL-009 |
| popstate／sentinel state 不完整 | 返回循環、退出 LIFF、詳情 ID 遺失 | R-NAV-011～R-NAV-020 |

---

## 1. 專案邊界與真相來源

### 1.1 穩定背景

ToosterX 是運動活動報名與管理系統，包含活動、俱樂部、錦標賽、教育課程、QR 簽到、個人統計與管理後台。

| 項目 | 穩定事實／真相來源 |
|------|--------------------|
| 前端 | Vanilla ES6、HTML、CSS 直接載入；沒有前端 bundler/build。npm 仍用於 tests、工具與 Functions |
| 資料 | Firebase Firestore；活動報名等採 `events/{docId}/...` 子集合 |
| 驗證 | LINE LIFF + Firebase Auth |
| 後端 | Firebase Cloud Functions v2；runtime 查 `functions/package.json`、`firebase.json` |
| 離線 | `sw.js` Service Worker |
| 部署 | main push 保守視為可能觸發外部 Cloudflare／GitHub Pages integration；repo 不能證明平台當前設定，執行前即時查。Functions／Rules 是不同 lane |

- **R-CTX-001 [A/HARD]**：產品程式碼是 Production-only。`ModeManager.getMode()` 固定回傳 `production`；禁止重新引入 `DemoData`、`ModeManager.isDemo()` 或模組層 Demo／Prod 分支。
- **R-CTX-002 [B/HARD]**：`ModeManager.getMode()` 可作既有 localStorage key namespace；不表示存在第二環境。
- **R-CTX-003 [B/HARD]**：Firebase browser config／公開 client identifier 與 server secret 分類處理；`js/firebase-config.js`、`js/config.js` 的公開 client 設定不能證明 server secret 可硬編。
- **R-CTX-004 [C/DEFAULT]**：不在本檔硬編檔案數、行數、export 數、cache 版號、CI run ID、ACTIVE Functions 數或工具版本；需要時即時查。

### 1.2 目錄責任

| 路徑 | 責任 |
|------|------|
| `index.html`、`app.js` | 主入口與 App 核心 |
| `js/core/` | navigation、loader、history、theme 等基礎設施 |
| `js/modules/` | 功能模組；同功能放對應子資料夾 |
| `pages/` | 動態載入 HTML fragments |
| `css/` | 主題與元件樣式 |
| `functions/` | Cloud Functions |
| `firestore.rules` | Firestore 存取邊界 |
| `tests/` | unit、Rules、E2E、contract tests |
| `scripts/` | 可追蹤維護／驗證腳本 |
| `.github/` | CI 與 automation |
| `docs/`、`tools/` | local-only 知識與受控診斷工具 |

- **R-CTX-005 [B/HARD]**：`tests/`、`.github/`、`functions/`、`scripts/`、`LOGO/`、`PWA/`、`permissions/`、`roles/`、`inventory/`、`valuation/`、`blog/`、`seo/` 有 CI、runtime 或公開頁用途，必須留在 Git。
- **R-CTX-006 [C/DEFAULT]**：結構用 `rg --files` 即時探索，不以歷史計數判斷漏檔。

---

## 2. 變更前安全邊界

### 2.1 工作樹與所有權

- **R-SAFE-001 [A/HARD]**：修改前讀 `git status --short --branch`，記錄既有 modified／untracked 基線；既有變更視為使用者所有。
- **R-SAFE-002 [A/HARD]**：禁止擅自 `reset`、`clean`、`checkout --`、stash、rebase、force-push、重寫歷史、覆蓋或刪除無關檔案。
- **R-SAFE-003 [A/HARD]**：只改需求必要檔；只 stage 精確檔案，commit 前檢查 staged diff，不帶入他人變更。
- **R-SAFE-004 [A/HARD]**：目標檔有無法安全分離的既有變更時停止並回報重疊位置；不得用還原舊版解決。
- **R-SAFE-005 [A/HARD]**：修改後再次比對工作樹與起始基線；途中出現的非本任務新變更視為他人所有。與目標重疊時立即停止，不覆蓋、不吸收。

### 2.2 Secrets、個資與正式資料

- **R-SAFE-010 [A/HARD]**：server secret、shared password、token、private key 不得寫死於 code、fallback、文件、fixture 或 log；使用 Secret Manager／`defineSecret` 等受控機制，缺值 fail-closed。
- **R-SAFE-011 [A/HARD]**：不得在回覆、command output 或文件重述秘密真值。發現洩漏只報檔案、symbol／行號與類型；先建議撤銷／輪替，再處理 code 與 Git 歷史。
- **R-SAFE-012 [A/HARD]**：UID、email、token、真實 event/team ID 等進入診斷、memory 或分享內容前遮罩，只留重現所需最小資訊。
- **R-SAFE-013 [A/HARD/GATED]**：Production bulk repair／migration／回填預設先唯讀或 dry-run；正式執行前需明確授權、範圍上限、冪等性、backup／rollback、審計與失敗停止條件。
- **R-SAFE-014 [A/HARD]**：不得以 Production 寫入作一般測試。代表性正式驗證需另授權、最小受控資料與清理方案。
- **R-SAFE-015 [A/HARD/GATED]**：IAM、repo variables、LINE Console、secret、Git history rewrite 與部署平台設定需獨立授權；repo 文字不能證明外部當前狀態。

---

## 3. 執行、精簡與編碼

### 3.1 調查與除錯

- **R-EXEC-001 [B/HARD]**：修 bug 前讀完整鏈：入口、import、caller、callee、資料來源、權限、tests 與設計；用 `rg` 搜同類及所有呼叫端。
- **R-EXEC-002 [B/HARD]**：根因需 code、重現、log 或 test 證據；不得猜。證據不足可提最小觀測 log，但新增 runtime log 仍需修改授權。
- **R-EXEC-003 [B/HARD]**：實作前表述核心假設；可由 repo 查證者先查。任何假設無法從既有 code／config／tests 確認時，先向使用者釐清，禁止靜默猜測。
- **R-EXEC-004 [B/HARD]**：需求有多種合理解讀時，列出各解讀及造成的差異讓使用者選擇，禁止自行挑一個就實作。
- **R-EXEC-005 [B/HARD]**：有更簡單、低風險或符合既有模式的方案時主動提出；會破壞鎖定規則、ID、編碼、相容性或安全時具體反駁。
- **R-EXEC-006 [B/HARD]**：修復後搜尋其他同模式；未授權的無關問題只回報。

### 3.2 外科手術式修改

- **R-EXEC-010 [C/DEFAULT]**：以正確解題的最少程式碼為目標，不加未要求功能、選項、參數、抽象或預留設計。
- **R-EXEC-011 [C/DEFAULT]**：同一信任邊界已證明的不變量不加無效防禦；網路、Auth、storage、外部輸入與 server boundary 不可省略驗證／錯誤處理。
- **R-EXEC-012 [B/HARD]**：只改必要部分；禁止順手格式化、重排註解、改無關命名、統一偏好或清除既有 dead code。
- **R-EXEC-013 [C/DEFAULT]**：沿用目標檔風格。風格統一或大規模整理須獨立任務／commit。
- **R-EXEC-014 [B/HARD]**：本次造成的孤兒 import／variable／function／CSS 必須清；既有孤兒保留並回報。
- **R-EXEC-015 [B/HARD]**：diff 每一行須直接對應需求、必要驗證或本次造成的清理。
- **R-EXEC-016 [A/HARD]**：修改 `js/firebase-crud.js`、`js/modules/event/event-detail-signup.js`、`event-detail-companion.js`、`event-create-waitlist.js`、`event-manage-noshow.js`、`event-manage-confirm.js`、`js/modules/achievement/stats.js`、`js/modules/leaderboard.js`、`js/firebase-service.js` 時，連相鄰非鎖定函式也避免變動。

### 3.3 程式風格與信任邊界

- **R-CODE-001 [B/HARD]**：新增或實質改寫的業務流程統一使用 `async/await`，不得新增 `.then()` chain；未觸及的 legacy chain 可保留。若修改既有 Promise DOM callback，仍須遵守 R-NAV-005。
- **R-CODE-002 [A/HARD]**：不可信動態內容寫 HTML 用 `escapeHTML()` 或 `textContent`；URL、attribute、JSON、CSS 依各自 context 驗證，不能只做通用 HTML escape。
- **R-CODE-003 [B/HARD]**：模組資料操作走 `ApiService`，不得任意操作 `FirebaseService._cache`。R-REG-008／010 所要求且已有測試的既有 registration／optimistic cache 同步可保留；新路徑優先封裝既有 service／core helper，禁止擴散 direct mutation。
- **R-CODE-004 [B/HARD]**：新模組必須用 `Object.assign(App, { ... })` 掛載，不建立新全域變數。
- **R-CODE-005 [B/HARD]**：改 CSS／JS／HTML 前確認 LINE WebView、Chrome、Safari 相容；必要時保留 `-webkit-backdrop-filter`、`dvh` 的 `vh` fallback、以 `replace(/…/g)` 取代不相容 `replaceAll`、clipboard 降級。

### 3.4 UTF-8 與亂碼

- **R-ENC-001 [A/HARD]**：新增／修改 repo 檔案用 UTF-8 無 BOM；禁止 ANSI、Big5、CP950、混合編碼。
- **R-ENC-002 [A/HARD]**：含中文檔優先 diff-based patch；無明確必要禁止整檔 shell 讀出後覆寫。
- **R-ENC-003 [A/HARD]**：禁止未明確 UTF-8 的 `Out-File`、`Set-Content`、`Add-Content`、`WriteAllText`、`WriteAllLines`；不得不用 shell 寫回時指定 UTF-8 無 BOM並立即重讀。
- **R-ENC-004 [B/HARD]**：檢查每個修改檔 mojibake。改 `index.html`、`docs/claude-memory.md` 或中文 UI `js/modules/*.js` 時檢查 `�`、`Ã`、`å`、`æ`、連續 `???`、PUA、殘缺標籤與引號。
- **R-ENC-005 [A/HARD]**：終端亂碼先區分顯示解碼與檔案損壞，禁止拿終端亂碼直接 replace／patch。
- **R-ENC-006 [A/HARD]**：發現 mojibake、混合編碼、殘缺 HTML 或未閉合字串時，必須先完整修復編碼與結構，再繼續功能修改；禁止在受損區塊疊加新需求。可安全修復且在授權範圍內者先修；超出範圍或無法安全修復時停止並回報檔案、區段、風險與方案。
- **R-ENC-007 [B/HARD]**：歷史紀錄編碼修復只處理 `docs/claude-memory.md`，沿用同一檔，不另建替代 memory。

---

## 4. 架構、Tunables 與文件

### 4.3 Local-only 治理

- **R-DOC-001 [A/HARD]**：`docs/`、`tools/` 是 local-only，不得追蹤到 Git、公開 GitHub 或靜態部署；browser-console tools 只在受控環境手動載入。
- **R-DOC-002 [A/HARD/GATED]**：若被追蹤，先回報；取得 Git 修改授權後才 `git rm --cached -r docs tools`，只移追蹤、不刪本機，保留 `.gitignore`。
- **R-DOC-003 [C/DEFAULT]**：`docs/` 根只放活躍文件／workflow／執行中計畫；歷史／暫停進 `archive/`，完成脈絡進 `completed/`，規格進 `specs/`，預覽進 `previews/`。
- **R-DOC-004 [B/HARD]**：`docs/previews/` HTML 只供預覽，不作產品入口。
- **R-DOC-005 [B/HARD]**：`.gcloud/`、`debug.log`、`test-results/`、`coverage/` 等 generated/local output 應忽略，不納交付；ignore 缺漏只回報，除非授權改 `.gitignore`。
- **R-DOC-006 [B/HARD]**：tracked runtime／CI 不得依賴 local-only docs 才能正確執行；必要契約須 self-contained 或移至 tracked canonical spec。已知 `functions/scoreboard-translations.js` 參照不存在的 `docs/scoreboard-translation-workflow-plan.md`，在專門任務修正前列為 drift，不假裝可讀。

---

## 5. 變更觸發矩陣

表內範圍表示區間中已定義的 Rule IDs。「規則檔」欄是該列 Rule ID 的 canonical 定義所在，標「補充參考」者只是相關索引；Claude Code 會在觸及對應路徑時自動載入，其他 AI 必須在分析、規劃、審查、修改或操作該領域前手動讀取，涉及多列時取聯集。

| 變更範圍 | 規則檔 | 必讀 | 最低驗證／同步 |
| ---------- | ------ | ------ | ---------------- |
| 主站 JS／HTML／CSS／pages | `release-sw.md`、`testing-review.md`（R-ENC 在 CLAUDE.md） | R-REL-001～017、R-QA-001～013、R-ENC-001～007 | 完整 unit；UI 做 browser；上線批次 bump |
| 獨立內容型 HTML（只改文案／連結／metadata／JSON-LD 事實） | `CLAUDE.md`（R-ENC）、`release-sw.md`、`testing-review.md` | R-REL-009、R-QA-010～013、R-ENC-001～007 | 不 bump；跑相關 static／SEO tests，必要時 browser |
| `sw.js`／cache boot | `release-sw.md` | R-REL-010～017 | unit + smoke／離線；上線批次 bump |
| 模組新增／搬移 | `architecture-tunables.md` | R-ARCH-001～005、R-TUNE-001～002 | 完整 unit；architecture／Mermaid |
| 後台入口／權限 | `id-permissions.md` | R-IAM-001～013、R-CAP-001～010 | permission audit、四身分、前後端 parity |
| entity ID | `id-permissions.md` | R-ID-001～011 | caller／callee、bridge、shape tests |
| 活動列表／黑名單 | `events-registration-stats.md` | R-EVT-001～005、R-EVT-010～019 | visibility allow／deny、寫入守衛 |
| 報名／取消／候補／課程 | `events-registration-stats.md` | R-REG-001～016 | guard、完整 unit、integrity |
| 出席／放鴿子／統計 | `events-registration-stats.md` | R-STAT-000～006 | 明確授權、完整 unit、歷史影響 |
| `firestore.rules` | `firestore-functions.md`、`testing-review.md` | R-DATA-001～005、R-QA-008 | Rules discovery + tests |
| `functions/**` | `firestore-functions.md`、`testing-review.md` | R-CF-001～012、R-QA-009 | `test:functions` + domain unit；release 前完整 unit |
| async／route／history | `navigation-history.md` | R-NAV-001～020 | route／popstate／race tests |
| 分享／Mini App／OG | `share.md` | R-SHARE-001～013 | builder、worker、Functions、deep-link |
| UI／modal／名單 | `ui.md` | R-UI-001～025 | desktop／mobile／light／dark、console |
| SEO | `seo.md` | R-SEO-001～004 | SEO log、generator／route |
| `CLAUDE.md`／docs only | `CLAUDE.md`、`governance-migration.md`（補充參考） | R-DOC-001～006、R-ENC-001～007、R-COM-001～005 | diff、引用、編碼；無 runtime test／bump |

---

## 8. 單一交付狀態機

- **R-SHIP-010 [A/HARD] — S0 分類／授權**：判定 INFO／READ_ONLY／DIAGNOSE／CHANGE／RELEASE；無 release 授權最多本機驗證。
- **R-SHIP-011 [B/HARD] — S1 基線**：讀本檔、`git status`、相關 code／tests／history，識別鎖定域與同步觸發。
- **R-SHIP-012 [B/HARD] — S2 證據**：確認根因、假設、影響；依 R-MODE-003 決定是否等修改確認。
- **R-SHIP-013 [B/HARD] — S3 最小修改**：只改已授權必要範圍，保留入口與相容性。
- **R-SHIP-014 [B/HARD] — S4 驗證**：跑 targeted 與要求的完整 tests、UI／encoding／diff。只有本次範圍涵蓋時才同步 architecture／tunables／memory／SEO；範圍外列待辦。只有準備上線批次才 bump。
- **R-SHIP-015 [B/HARD] — S5 Review**：reviewer 讀 S4 證據；修正回 S4 再審。
- **R-SHIP-016 [A/HARD] — S6 Commit**：S4／S5 完成後直接精確 stage 本次範圍檔案、查 staged diff，以中文 message 列關鍵變更後 commit，不需逐次授權；使用者說「先不要 commit／等我確認」時仍暫緩（R-SHIP-002）。push、deploy 或泛稱 release 仍是獨立 GATED 動作。（2026-10-18 依 R-GOV-007 取代原「只有 commit 的獨立明確授權才 commit」。）
- **R-SHIP-017 [A/HARD] — S7 閘門**：提供 commit／diff、tests、review、影響、風險、目標，等待 lane-specific push／deploy 授權。
- **R-SHIP-018 [A/HARD/GATED] — S8 Push／Deploy**：只執行獲授權 lane；禁先 push 後 review、邊改邊 push。
- **R-SHIP-019 [B/HARD] — S9 觀察**：查 CI／部署；Functions 依 R-CF-007 看 logs，回報實際完成／未完成。

- **R-SHIP-001 [A/HARD]**：`git push origin main` 保守視為可能觸發外部靜態部署；Cloudflare／GitHub Pages integration 執行前即時查。它不代表 Functions／Rules 已部署。
- **R-SHIP-002 [A/HARD]**：使用者說「先不要 push／deploy」或「等我確認」時，commit 也暫緩，除非另行明確要求。
- **R-SHIP-003 [B/HARD]**：純 Markdown／local-only docs，以及符合 R-REL-009 的內容型 HTML，可免主站 bump 與完整 code review；HTML 仍需相稱 static／SEO／browser 驗證。所有文件仍需 diff／encoding 與 commit／push 授權。
- **R-SHIP-004 [B/HARD]**：純 bump 可免完整 code review，但需四處一致性與 push 授權。
- **R-SHIP-005 [A/HARD]**：1–3 行緊急 hotfix 可縮 review，不省根因、最低 targeted test、必要版號、push 授權。
- **R-SHIP-006 [C/DEFAULT]**：任務後評估上線需要哪個 lane／步驟，只回報，不當授權。

---

## 15. 日誌與記憶

### 15.1 修復／功能 memory

- **R-LOG-001 [B/HARD]**：完成 bug 或功能後在唯一 `docs/claude-memory.md` 追加：

  ```markdown
  ### YYYY-MM-DD — 標題
  - **問題**：
  - **原因**：
  - **修復**：
  - **教訓**：
  ```

  日期只用 `YYYY-MM-DD`；同日後寫在下。只有符合永久條件才在標題末加 `[永久]`，既有格式不追改。
- **R-LOG-002 [A/HARD]**：memory local-only、不隨 Git；禁另建 `memory.md`、`fix-log.md`、`handoff-log.md`。清理／大改前建可驗證 private backup。
- **R-LOG-003 [B/HARD]**：一般 30 天；永久保存資料完整性地雷、UID、架構決策或重複 2 次以上 bug；新條目預設一般。
- **R-LOG-004 [A/HARD/GATED]**：超過 500 行只表示 maintenance due，不自動授權刪／合併；一般任務只追加並回報。清理需獨立授權，先提供候選、backup hash、保留／刪除理由、回退。核准後才刪 >30 天無價值一般項、合併迭代、刪 Git 可知流水、升級永久項。
- **R-LOG-005 [A/HARD]**：清理不丟唯一歷史；memory 不記未遮罩 UID、secret、可識別個資。

## 16. 規劃、建議與回覆

- **R-COM-001 [B/HARD]**：「先計畫、不實作」含主要風險、影響／後果、拆步驟工作量／複雜度。
- **R-COM-002 [B/HARD]**：非 trivial 優化、架構或提案答：做了會怎樣、不做代價、最壞情況、影響範圍、回退難度、memory 歷史教訓；無資料明說。
- **R-COM-003 [C/DEFAULT]**：已確認根因的直接修復、精確操作、機械 bump 不強制完整表，但揭露實際風險。
- **R-COM-004 [B/HARD]**：技術回覆最後加 `## 白話總結`，1–5 行說 APP 使用者會看到／感受什麼；前後用「原本 → 改後」。
- **R-COM-005 [C/DEFAULT]**：純資訊或單行指令可不加。

---

## 18. 本檔維護

- **R-GOV-010 [B/HARD]**：新規則用 `R-{DOMAIN}-{NNN}`；ID 不含章節／日期，搬章不重編，退休不重用。
- **R-GOV-011 [B/HARD]**：每規則一個 canonical 定義；其他處只引用 ID，不複製不同版本。
- **R-GOV-012 [B/HARD]**：區分 RULE、RATIONALE、SNAPSHOT、EXAMPLE；穩定規則留主體，可變快照改「去哪即時查」。
- **R-GOV-013 [A/HARD]**：精簡不得刪有效語意、條件、例外、授權、驗證、精確 shape 或鎖定 symbol；可合併重複、移除過期 snapshot。
- **R-GOV-014 [B/HARD]**：重大重構前保存原文 backup + hash；完成後以舊章／規則 → 新 Rule ID 做獨立審核。
- **R-GOV-015 [B/HARD]**：領域規則檔放 `.claude/rules/*.md`，frontmatter 只用 `paths`（YAML list），每檔對應本檔「變更觸發矩陣」一列以上；Rule ID 的 canonical 定義只能存在於 CLAUDE.md 或其中一個規則檔。修改 CLAUDE.md、任何規則檔、`AGENTS.md`、`GEMINI.md` 或 `NAVIGATION.md` 後，commit 前必須跑 `node scripts/check-rules-integrity.js` 且通過；frontmatter YAML 解析失敗、格式不符或驗證腳本失敗，一律視為驗收失敗（依 Claude Code 官方文件，解析失敗的規則會改為無條件載入，實際行為以官方文件即時查證為準）。
