---
paths:
  - "css/**"
  - "pages/**"
  - "js/modules/**"
  - "js/core/**"
  - "app.js"
  - "index.html"
  - "*.html"
  - "permissions/**"
  - "roles/**"
  - "blog/**"
  - "seo/**"
  - "inventory/**"
---

# UI／UX 契約

> 本檔是 `CLAUDE.md` 的領域規則檔，以下 Rule ID 的 canonical 定義在此。條文中的「本檔」除非明確指特定檔案，一律指整個生效規則集（`CLAUDE.md` 加全部規則檔），標記的權威層級不因所在檔案而異。標記、權威順序與授權模式見 `CLAUDE.md` §0；修改本檔後必須跑 `node scripts/check-rules-integrity.js`。

## 14. Exact Contract Registry：UI／UX

- **R-UI-001 [C/DEFAULT]**：新頁／改版單一 emerald 主色 + slate 中性色；badge 低飽和淺底深字，dark 深底亮字。
- **R-UI-002 [C/DEFAULT]**：列表 1px hairline；功能 icon 16–18px 線性 SVG + hover，禁 emoji 功能按鈕。
- **R-UI-003 [C/DEFAULT]**：間距 4／8／12／16／20；列表／chip 圓角 8–9px，卡片／panel 14–22px；數字 `tabular-nums`。
- **R-UI-004 [C/DEFAULT]**：空狀態用「未設背號／未分組」，不用 `-`／`#-`；頭像優先 `pictureUrl`／`avatarUrl`，無才首字色塊。
- **R-UI-005 [B/HARD]**：新元件只用 `css/base.css` 已有 token，不自創不存在變數、不在模組硬編 theme hex；至少查 `--bg-card`、`--bg-elevated`、`--text-primary`、`--text-secondary`、`--text-muted`、`--border`、`--accent`。
- **R-UI-006 [C/DEFAULT]**：dark 不純黑、保留三階文字；badge 深底亮字、selected 亮底深字、accent 由 token。角色色只是設計方向，未有 shared token 時不得硬編；user-capsule 精確 palette 只以 R-UI-021／`css/profile.css` 為準。

### 14.1 Modal 與動畫

- **R-UI-010 [B/HARD]**：modal 契約：overlay `rgba(0,0,0,.35)`、`backdrop-filter:blur(10px)` + `-webkit-backdrop-filter:blur(10px)`，本體 `border-radius:16px`、`box-shadow:0 8px 32px rgba(0,0,0,.15)`。使用前先查 shared class/token；存在則複用。若目前尚無完整 shared 契約，單一 modal 任務仍須遵守上述精確值，但不得假裝引用不存在的 class/token；只有使用者授權設計系統／共用層調整時才中央化，避免擴張外科式修改範圍。
- **R-UI-011 [A/HARD]**：overlay 阻背景 touch 穿透但允 modal 內滾；target 在 modal 內放行，否則 `preventDefault + stopPropagation`；modal 禁 `touch-action:none`。
- **R-UI-012 [B/HARD]**：shared loading／skeleton／spinner／進場動畫集中 `css/base.css`，用 `ui-` keyframe／utility、統一 duration/easing、支援 reduced motion。
- **R-UI-013 [B/HARD]**：用 `ui-*` 前查是否存在。若缺且 scope 允許，canonical default：`--ui-dur-fast:150ms`、`--ui-dur:220ms`、`--ui-dur-slow:400ms`、`--ui-ease:cubic-bezier(.2,.8,.2,1)`、`--ui-spin-dur:.9s`、`--ui-shimmer-dur:1.2s`；集合 `ui-spin`、`ui-pulse`、`ui-shimmer`、`ui-fade-in`、`ui-slide-up`、`ui-skeleton`。
- **R-UI-014 [C/DEFAULT]**：legacy keyframes 只在重構該模組收斂；動畫 token 變更同步 R-TUNE-001。

### 14.2 展示型名單

- **R-UI-020 [B/HARD]**：新增／改展示名單用 `App._userTag(name, forceRole, options)` 輸出 `.user-capsule`；禁手寫或寫死 `uc-user`。
- **R-UI-021 [B/HARD]**：底色表示角色，Lv 獨立。`css/profile.css` mapping：`uc-user` 中性、`uc-coach` 琥珀、`uc-captain` 紫、`uc-team-leader` 藍、`uc-venue_owner` 橘、`uc-admin` 藍、`uc-super_admin` 紅。
- **R-UI-022 [B/HARD]**：Lv、`uc-att-warn`、`uc-recent-noshow`、`uc-team-jersey` 由 generator options。
- **R-UI-023 [A/HARD]**：身份傳 `options.uid`；名稱只顯示；點擊 `App.showUserProfile(name,{ uid })`。
- **R-UI-024 [C/DEFAULT]**：文字輸入、inline editable cell 不適用；legacy 名單不一次回溯，重構時收斂。
- **R-UI-025 [B/HARD]**：驗 desktop／mobile／light／dark、角色底色、Lv、附掛資訊、點擊名片。

---

