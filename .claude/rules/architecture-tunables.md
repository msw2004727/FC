---
paths:
  - "js/**"
  - "css/**"
  - "pages/**"
  - "index.html"
  - "app.js"
  - "sw.js"
  - "functions/**"
---

# 架構決策與 Tunables

> 本檔是 `CLAUDE.md` 的領域規則檔，以下 Rule ID 的 canonical 定義在此。條文中的「本檔」除非明確指特定檔案，一律指整個生效規則集（`CLAUDE.md` 加全部規則檔），標記的權威層級不因所在檔案而異。標記、權威順序與授權模式見 `CLAUDE.md` §0；修改本檔後必須跑 `node scripts/check-rules-integrity.js`。

### 4.1 模組決策

| 情境 | 做法 |
|------|------|
| bug、小調整、同責任擴充 | 修改既有檔 |
| 新責任或獨立業務邏輯 | 在 `js/modules/` 對應功能目錄建模組 |
| 已有功能子資料夾 | 同類模組放該資料夾，不堆根層 |
| 新領域且預期至少 2 個相關檔 | 優先建功能子資料夾 |
| 既有大檔演進 | 保留舊入口作 facade／compatibility layer，逐步抽離 |

- **R-ARCH-001 [B/HARD]**：新模組／新責任檔不得超過 300 行。既有超標檔是 legacy baseline；小修不強迫大重構，但不得無理由新增新責任或持續淨增長。
- **R-ARCH-002 [B/HARD]**：跨頁、跨責任或跨資料源邏輯不持續堆單檔；責任清楚且不混鎖定邏輯時逐步拆。
- **R-ARCH-003 [B/HARD]**：結構整理與業務改寫分開；預設先保行為再改邏輯，除非使用者明確要求，不做一次性大搬家。
- **R-ARCH-004 [B/HARD]**：新增、搬移、刪除模組或改依賴時，同步 local-only `docs/architecture.md` 模組說明與 Mermaid；只有穩定責任受影響才更新本檔。
- **R-ARCH-005 [C/DEFAULT]**：`docs/structure-guide.md` 目前不存在，不得當強制來源；日後恢復需先登錄責任。

### 4.2 Tunables

- **R-TUNE-001 [B/HARD]**：下列變更同步 local-only `docs/tunables.md`：timeout／debounce／interval／`setTimeout`／`setInterval` 數值；limit／capacity／threshold；`script-loader.js` page 清單、`index.html` script、init Phase 順序；boot overlay、visibility、報名／簽到、deep link 等 sequence effect；timing 依賴；共用動畫 duration／easing。
- **R-TUNE-002 [B/HARD]**：code 註解引用 tunables anchor 時確認存在；不得引用行號。

