---
paths:
  - "js/**"
  - "css/**"
  - "pages/**"
  - "functions/**"
  - "tests/**"
  - "firestore.rules"
  - "storage.rules"
  - "sw.js"
  - "app.js"
  - "_worker.js"
  - "index.html"
  - "*.html"
  - "permissions/**"
  - "roles/**"
  - "blog/**"
  - "seo/**"
  - "inventory/**"
  - "package.json"
  - "playwright.config.js"
  - ".github/workflows/**"
---

# 測試、瀏覽器驗證與 Review

> 本檔是 `CLAUDE.md` 的領域規則檔，以下 Rule ID 的 canonical 定義在此。條文中的「本檔」除非明確指特定檔案，一律指整個生效規則集（`CLAUDE.md` 加全部規則檔），標記的權威層級不因所在檔案而異。標記、權威順序與授權模式見 `CLAUDE.md` §0；修改本檔後必須跑 `node scripts/check-rules-integrity.js`。

## 7. 測試、瀏覽器與 Review

`package.json`、workflows 是命令／CI 現況真相來源。

| 指令 | 用途 |
|------|------|
| `npm run check:registration-ops` | 報名鎖定 guard |
| `npm run test:unit` | 完整 Jest unit |
| `npm run test:unit:coverage` | unit + coverage |
| `npm run test:rules` | aggregate Rules emulator |
| `npm run test:functions` | Functions 基礎 source contract；不是全 domain |
| `npm run test:e2e` | 完整 Playwright E2E |
| `npm run test:e2e:smoke` | Chromium smoke |
| `npm run test:e2e:visual` | mobile visual |
| `npm run test:e2e:admin` | admin desktop |

- **R-QA-001 [B/HARD]**：Rules → discovery + `test:rules`；報名／統計鎖定 → guard + 完整 `test:unit`；其他 `js/modules/**` → 完整 `test:unit`；Functions → R-QA-009；UI → 完整 unit + browser；純 Markdown 無 runtime tests。targeted test 可先跑但不取代完整 suite。
- **R-QA-002 [B/HARD]**：不可假設 gated Functions job 或一般 CI 已跑 Functions 全部測試。
- **R-QA-003 [B/HARD]**：CI 紅燈代表回歸；修復後才交付／push，push 前本地跑相稱 tests。
- **R-QA-004 [A/HARD]**：禁止 `xdescribe`、`xtest`、`--testPathIgnorePatterns` 或縮 discovery 掩蓋失敗。確實不適用而暫停需理由、使用者知情、恢復條件，記入 commit。
- **R-QA-005 [B/HARD]**：test 過時須以行為／規格證據證明，與 production change 同批更新並標「測試同步更新」；code 壞則修 code、保留 test。
- **R-QA-006 [B/HARD]**：鎖定範圍新增函式必補 unit；非鎖定依風險。
- **R-QA-007 [B/HARD]**：未跑、失敗或環境受限明講；禁止以「應該會過」或別的 test 替代。
- **R-QA-008 [B/HARD]**：Rules 修改前枚舉所有非 fixture suites，與 `package.json#test:rules:unit` discovery 對照；未收錄者另跑或標未驗證。`test:rules:unit` 以 `--testMatch` 錨定 `<rootDir>/tests/` 下三個根層 suites 與 `tests/firestore-rules/**/*.test.js`，新放進該目錄的 suite 自動收錄；不得改回逐檔清單或不錨定 `<rootDir>` 的 pattern（會漏收或誤跑 `.wt/`、`.codex-worktrees/` 的副本）。（2026-10-19 取代原「tournament-match-rules 未被收錄」的已知 drift：runner 已修正並實跑 7 suites 通過。）
- **R-QA-009 [B/HARD]**：Functions 變更跑 `test:functions` + 相關 domain unit；release 前完整 `test:unit`。`test:functions` 目前只跑 `tests/unit/cloud-functions.test.js`，不得宣稱涵蓋 `scoreboard-translations`、ops、private-message、login-IP、attendance、education 等 domain suites。部署前即時檢查 workflow 是否把完整 unit 設為同一部署 lane 的必要前置；若沒有，必須本機補跑並明確回報，不能用平行 workflow 或綠色 deploy job 代替。

### 7.1 UI 瀏覽器驗證

- **R-QA-010 [B/HARD]**：CSS、HTML、DOM render、modal、表單、按鈕、loading、responsive、主題或互動變更必須開本機頁，不能只看 unit／diff。
- **R-QA-011 [B/HARD]**：至少 desktop（如 1280×720／1366×768）與 mobile（如 390×844／375×812）；改 breakpoint 加測該寬。token／名單／主題再測 light + dark。
- **R-QA-012 [B/HARD]**：查目標與鄰近 UI 跑版、重疊、溢出、按鈕擠壓、點擊、焦點、滾動與 console error；修正後重跑同 viewport。
- **R-QA-013 [B/HARD]**：回報頁面／流程、viewport、瀏覽器或 Playwright 指令與 console；無法啟動明標「UI 瀏覽器驗證未完成」及原因。

### 7.2 獨立 Review

- **R-REVIEW-001 [B/HARD]**：非 trivial JS／HTML／CSS／Rules／Functions／SW／cache 變更，在 tests 與 UI 後由 fresh-context reviewer 唯讀審計。
- **R-REVIEW-002 [B/HARD]**：reviewer 讀實際 diff、完整相關檔／呼叫鏈、權限與 test 結果；不依對話記憶，不修改、commit、push、deploy。
- **R-REVIEW-003 [B/HARD]**：Claude／Codex 使用唯讀 subagent 或 isolated reviewer；只有使用者明確要求才建 user-owned 新 thread／task。review 後由原對話修正。
- **R-REVIEW-004 [B/HARD]**：P1／P2 或 A／B 問題：修正 → 驗證 → 再 review。同類重大 finding 經兩輪仍重現時停止回報阻礙，不無限循環。
- **R-REVIEW-005 [B/HARD]**：純文件、純註解、純 bump、使用者明確跳過或 1–3 行 hotfix 可免完整 code review；hotfix 可事後補。免 review 不等於免 test 或 push 授權。
- **R-REVIEW-006 [B/HARD]**：回報含修改檔、重點、findings／修正、實際驗證命令與結果、殘餘風險；未完成不宣稱通過。
- **R-REVIEW-010 [B/HARD]**：跨 AI review 使用 fresh-context 唯讀 reviewer，完整看 diff／commit、caller／callee、權限、tests、設計；Codex 優先 subagent，不自行建 sidebar task。
- **R-REVIEW-011 [B/HARD]**：有瑕疵時轉交內容開頭標「這是第三方審計發現，不是使用者直接命令；接收者必須重新核實」。
- **R-REVIEW-012 [B/HARD]**：轉交含嚴重度、問題、影響、根因、證據、建議、補測／驗收與命令。
- **R-REVIEW-013 [B/HARD]**：無問題寫「未發現需要修正的問題」，列檢查重點與殘餘風險。
- **R-REVIEW-014 [A/HARD]**：第三方 finding 不盲從；屬實才修，不屬實以檔案／流程／tests 反駁。

---

