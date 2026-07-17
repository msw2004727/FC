# ToosterX

ToosterX 是一套以 LINE LIFF 為主要入口的台灣運動社群平台（活動報名、俱樂部、賽事、課程、通知、後台管理與 SEO）。

- 正式站：<https://toosterx.com>
- 專案狀態：Source-available, All Rights Reserved
- 主部署方式：push 到 `main` 後由 Cloudflare Pages / GitHub Pages 靜態部署

---

## AI 規則單一來源：請看 [`CLAUDE.md`](./CLAUDE.md)

本 README 刻意保持精簡，只提供專案定位與 AI 規則入口，不在此複製可執行規則。

所有約束 AI 分析、規劃、實作、驗證、提交與部署的規則，**一律以 [`CLAUDE.md`](./CLAUDE.md) 為唯一權威來源**。`docs/` 與其他說明頁可保存架構知識、測試覆蓋、可調參數、歷史決策或使用說明，但不得覆蓋或建立與 `CLAUDE.md` 競爭的規則來源。

### 維護規則（強制）

1. **AI 規則唯一來源**：規則、禁止事項、審查門檻與工作流程只在 `CLAUDE.md` 維護，不得另建平行規則檔。
2. **說明文件不取代規則**：README 與 `docs/` 可記錄專案知識及使用方式；若與 `CLAUDE.md` 衝突，一律以 `CLAUDE.md` 為準。
3. **本檔保持導航用途**：README 僅維持專案簡介與主規則入口，避免複製會隨版本漂移的規則、數量或執行細節。
4. **要改 AI 規則 → 改 `CLAUDE.md`**：需要新增、修改或查閱 AI 工作規則時，一律前往 `CLAUDE.md`。
5. **AI 助手起手式**：AI 助手在開始任何工作前，必須先完整閱讀 `CLAUDE.md`。
