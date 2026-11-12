---
paths:
  - "js/modules/**/*share*.js"
  - "js/modules/education/edu-course-plan-render.js"
  - "js/modules/profile/**"
  - "js/modules/scan/**"
  - "js/modules/dashboard/**"
  - "js/config.js"
  - "functions/index.js"
  - "_worker.js"
  - "index.html"
  - "tests/unit/*share*.test.js"
---

# 分享、Mini App 與 QR

> 本檔是 `CLAUDE.md` 的領域規則檔，以下 Rule ID 的 canonical 定義在此。條文中的「本檔」除非明確指特定檔案，一律指整個生效規則集（`CLAUDE.md` 加全部規則檔），標記的權威層級不因所在檔案而異。標記、權威順序與授權模式見 `CLAUDE.md` §0；修改本檔後必須跑 `node scripts/check-rules-integrity.js`。

## 13. Exact Contract Registry：分享

- **R-SHARE-001 [A/HARD]**：LINE 分享 builder 統一 `MINI_APP_BASE_URL`（Functions 端統一 `SHARE_MINI_APP_BASE_URL`，2026-11-12 補，原 `teamShareOg` 區域 `MINI_APP_ID` 已併入），禁散落 base URL。query：`?event=`、`?team=`、`?tournament=`、`?profile=`。
- **R-SHARE-002 [B/HARD]**：根網址 `toosterx.com/?event|team|tournament|profile=...` 保留中繼至 Mini App。
- **R-SHARE-003 [B/HARD]**：舊 `liff.line.me` 相容，新分享禁生成；分享模組 `[備用]` 舊 URL 註解保留。
- **R-SHARE-004 [A/HARD]**：LINE 好友／群組、`shareTargetPicker`、Flex、分享／邀請 QR 用 Mini App URL。`page-qrcode`／身份簽到 QR 必須 raw LINE UID，禁套分享 URL。新站的 LINE 純文字分享與系統分享可改用活動 OG 中繼 `/event-share/{id}`（真人在 LINE 內由 R-SHARE-005 導向 Mini App）；`shareTargetPicker` 的 Flex 按鈕與 altText 仍用 Mini App URL。（2026-11-12 補：取代原「LINE 分享只能直接帶 Mini App URL」的隱含限制，為了讓社群純文字分享也有活動預覽圖；站長 11-11 選①②都做，顧問 §3.117。）
- **R-SHARE-005 [A/HARD]**：活動複製連結 `_buildEventShareOgUrl(eventId)` → `/event-share/{id}`；crawler 留預覽、不跳轉，輸出不含跳轉腳本。活動存在時真人頁對所有 UA 回同一份 HTML，由 `<head>` 內腳本以 `EVENT_SHARE_LINE_USER_AGENT_RE`（`/\bLine\//i`）判斷：LINE App 內 → Mini App `SHARE_MINI_APP_BASE_URL` + `?event=`；其他瀏覽器、腳本例外或 `<noscript>` → 網站 `/events/{id}`；一律 `location.replace`，不顯手動開啟。查無活動或讀取失敗 → `/`，不給 Mini App。腳本內嵌值一律經 `toInlineScriptJson`。（2026-11-12 取代原「真人到網站 `/events/{id}`、不 Mini App」：站長 11-11 選①②都做、顧問 §3.117 裁定乙案頁面內判斷，讓 LINE 內點分享連結直接開 Mini App、爬蟲輸出不變；這是導向調整，不是放寬安全規則。）
- **R-SHARE-006 [B/HARD]**：`/team-share/{id}` 真人目前到 Mini App。其他實體啟用 OG copy-link 時同批 builder、worker route、CF handler、tests。
- **R-SHARE-007 [B/HARD]**：優先序：`liff.shareTargetPicker()` Flex → copy-link → `navigator.share()`／`_copyToClipboard()` fallback。
- **R-SHARE-008 [B/HARD]**：新增分享比照 `event-share.js`：Action Sheet、Flex、防連點、altText 最長 400 字、逐級 fallback。
- **R-SHARE-009 [A/HARD/GATED]**：用 picker 前確認 LINE Console 開關；外部狀態人工即時驗。
- **R-SHARE-010 [B/HARD]**：Mini App public identifier 更換交叉查 `js/config.js`、`index.html`、`functions/index.js`，跑分享／deep-link tests；本檔不複製 ID。
- **R-SHARE-011 [C/DEFAULT]**：Dashboard 報表維持既有分享，除非明確要求。
- **R-SHARE-012 [B/HARD]**：education course plan／lesson 分享使用既有 canonical Mini App clean path（查 `edu-course-lesson-share.js`、`edu-course-plan-render.js`），不強改四種 query；route 變更遵守 R-REL-017。
- **R-SHARE-013 [A/HARD]**：身份／簽到 QR 的 raw LINE UID 只能在本機產生 QR；禁止把 UID 放入 `api.qrserver.com` 或任何第三方 QR／圖片服務的 URL、request 或 log。local generator 不可用或失敗時 fail-closed，顯示錯誤／替代本機流程，不外傳 UID。現有 `js/modules/profile/profile-card.js` 第三方 fallback 是待修 security drift，不得複製。

---

