# 延遲登入（Lazy Auth）實作計畫書

**狀態**：2026-04-23 v3 — v2 再自審：發現 Phase 2 「detail 呼叫端補 allowGuest」其實是 **nice-to-have、非必要**；Phase 3 也可合併進 MVP
**預估工期**：**MVP 0.5-1 天**（僅 Phase 1）、完整版 2-2.5 天
**版號影響**：會 bump 1 次即可（MVP）
**預計動到檔案**：MVP 只需 3 個核心檔 + 1 個常數檔；完整版 8-10 個

---

## 0. TL;DR（3 行讀懂）

1. **做什麼**：把「開 APP 強制登入」改成「瀏覽不用登、按寫入動作才登入」
2. **怎麼做**：把 `guardedPages` 陣列從「活動 / 俱樂部 / 賽事 / 訊息 / 個人」**精簡**為「訊息 / 個人」即可（共 4 處、提到 config.js 統一）
3. **風險極低**：既有架構**實際已支援 90%**——連 `event-detail.js` 的訪客模式（`isGuestView`、`_buildGuestEventSignupButton`）都完整實作，只是呼叫端沒觸發；`_resumePendingAuthAction` 7 種 action type 已支援；Firestore Rules `events` read 公開；`_signInWithAppropriateMethod` LIFF 未登入自動跳過

### v3 自審精簡重點

- **MVP 只要做 Phase 1（改 guardedPages、約 0.5-1 天）**就能達 80% 效果
- **Phase 2「detail 呼叫端補 allowGuest」不是必要**——event-detail 容錯（非 teamOnly events 未登入也能看）、只是沒進入完整訪客模式（UI 有小瑕疵：仍顯示收藏愛心、嘗試 viewCount++）
- teamOnly / 私人 events、俱樂部限定等 **本來就期待用戶登入**，MVP 不處理合理
- **Phase 3 favorites UI**：實際 `_favHeartHtml` 若已容錯就不用動、需實機驗證

---

## 1. 功能概述

### 現況（強制登入）

- 進 app、bot-tab 點「活動/俱樂部/賽事/個人」→ 若未登入、觸發 `_requireProtectedActionLogin` → 彈 toast「請先登入」 + 自動跳 LIFF 登入
- 用戶必須完成 LINE 登入才能看到任何內容（除首頁）

### 目標（延遲登入）

- 進 app、自由瀏覽首頁 / 活動列表 / 月曆 / 俱樂部列表 / 賽事列表 / 活動詳情 / 俱樂部詳情等**純讀取頁面**
- 只有以下「寫入類動作」才觸發登入：
  - 報名活動 / 取消報名 / 同行者報名
  - 收藏活動 / 收藏賽事
  - 建立活動 / 建立俱樂部
  - 加入俱樂部（入隊申請）
  - 發動態牆貼文 / 留言 / 按讚
  - 查看「我的」個人資料頁（`page-profile`）／訊息（`page-messages`）
- 登入完成後、自動續跑原本的動作（既有機制）

---

## 2. 既有架構現況（自審重新整理）

### 🟢 已實作（無需動）

| 機制 | 位置 | 說明 |
|------|------|------|
| `_requestLoginForAction(action, options)` | `app.js:1101-1157` | 未登入時保存 action 到 sessionStorage、觸發 `LineAuth.login()` |
| `_resumePendingAuthAction()` | `app.js:1159-1250` | 登入 redirect 回來後自動執行 pending action（**7 種 type** 已支援：showPage / showEventDetail / eventSignup / eventCancelSignup / toggleFavoriteEvent / toggleFavoriteTournament / goToScanForEvent）|
| `_pendingAuthAction` sessionStorage | `app.js:178-180` + L1046-1094 | 保存/取回/清除 pending action 的完整 API |
| `_requireProtectedActionLogin` | `navigation.js:292-299` | 寫入動作前的共用 guard、未登入自動觸發上述流程 |
| `LineAuth.initSDK()` vs `init()` | `line-auth.js:261-277` | `initSDK` 只做 SDK init、不取 profile；既有 boot 已用 |
| `LineAuth._scheduleProfileRefresh` | `line-auth.js:79-98` | Tier 2 登入（LIFF 過期但 Firebase Auth 活）自動補取 profile |
| Firestore Rules `events: allow read: if true` | `firestore.rules:457` | 未登入可讀 events（月曆、活動列表、詳情皆可） |
| `FirebaseService._signInWithAppropriateMethod` | `firebase-service.js:1291-1294` | LIFF 未登入時跳過 Firebase Auth、不 throw，純讀快取/公開資料 |
| `_pageNeedsCloud('page-home') === false` | `navigation.js:218-221` | 首頁不強制 cloud init |
| Detail 頁 `allowGuest` 選項 | `team-detail.js:104`、`profile-core.js:139`、`tournament-detail.js:7`、`tournament-friendly-detail.js:36`、`event-detail.js:243`（用 `isGuestView`） | 已設計「訪客模式」選項、只需呼叫端傳入 |

### 🔴 需要改（v2 修正：實際 8-10 處）

#### A. guardedPages 4 處分散定義 — 必須同步改

| # | 位置 | 用途 |
|---|------|------|
| A1 | `navigation.js:327` | `bindNavigation()` bot-tab click guard |
| A2 | `navigation.js:461` | `showPage()` 中段：決定是否要等 cloud init |
| A3 | `navigation.js:525` | `showPage()` 結尾：攔截 login required |
| A4 | `role.js:274` | `openDrawerPage()`：drawer menu 點擊導航 |

**v2 新決議**：重構為 `js/config.js` 的共用常數 `AUTH_REQUIRED_PAGES`，4 處 import、未來不會漏改。

#### B. Detail 頁呼叫端傳 `allowGuest: true` — 多處

| # | 位置 | 呼叫者（誰呼叫這個 detail）|
|---|------|-------------------------|
| B1 | `event-detail.js` `showEventDetail` | 活動列表 / 月曆 / 首頁熱門 / 分享連結等 |
| B2 | `team-detail.js` `showTeamDetail` | 俱樂部列表 / 首頁熱門俱樂部 / 分享連結 |
| B3 | `tournament-detail.js` `showTournamentDetail` | 賽事列表 / 分享連結 |
| B4 | `tournament-friendly-detail.js` `showFriendlyDetail` | 俱樂部頁的友誼賽入口 |
| B5 | `profile-core.js` `showUserProfile` | 活動報名名單點用戶 / 分享名片 |

**v2 決議**：
- **事件詳情（B1）**：已有 `isGuestView` 參數、但呼叫端沒傳。需在純瀏覽呼叫點加 `{ allowGuest: true }`
- **俱樂部、賽事、友誼賽詳情（B2-B4）**：呼叫端補傳
- **他人名片（B5）**：視為純瀏覽、補傳 `allowGuest`
- **從 `showPage('page-activity-detail')` 進入的路徑**：要看 showPage 本身是否因 guardedPages 精簡而自動放行（大部分情況會）

#### C. 個別 UX 調整

| # | 位置 | 改動 |
|---|------|------|
| C1 | `favorites.js:89/103` | 未登入點愛心不隱藏、顯示並彈登入提示（既有 `_requireProtectedActionLogin` 已做、但 UI 可能在未登入時不顯示按鈕、需審視） |
| C2 | 頂部 / drawer 「登入」按鈕 | 確保未登入時有明顯入口（既有 `renderLoginUI` 已做、需驗證） |

---

## 3. 核心設計決策

| # | 題目 | 採用方案 | 理由 |
|---|------|---------|------|
| Q1 | Bot-tab 哪些 tab 未登入可進入？ | 活動 / 俱樂部 / 賽事 ✅；個人 / 訊息 ❌ 仍需登入 | 個人 / 訊息本質需要 uid |
| Q2 | 未登入點「個人」tab 怎麼處理？ | 維持既有行為（彈登入 + `_requestLoginForAction({ type: 'showPage', pageId: 'page-profile' })`）| 既有 UX、登入後會自動跳回個人頁 |
| Q3 | 深連結 `?event=XXX` 未登入可否看活動詳情？ | ✅ 可 | Rules 允許 events read、活動詳情頁本身不寫入 |
| Q4 | 收藏（愛心）需不需要登入？ | ✅ 需要、點擊彈登入 | 收藏寫入 users 集合、需 uid |
| Q5 | 「我報名了哪些」狀態章戳未登入怎顯示？ | 不顯示（`_isUserSignedUp` 回傳 false 自然 fallback） | 零改動 |
| Q6 | 首次登入 modal（個人資料填寫）在什麼時機彈？ | 維持既有：寫入時 `_requireProfileComplete()` 觸發 | 不動 |
| Q7 | 「訪客模式」UI 區分？ | 本期不做（後續擴充）| 保持 UI 簡潔 |
| Q8 | 登入後 redirect 目標？ | 用 `_pendingAuthAction` 自動續跑（既有）| 不動 |
| Q9 | 收藏按鈕 UI 表現？ | 未登入顯示愛心（灰色）、點擊觸發登入；登入後可點 | 需改 favorites UI |
| Q10 | 活動詳情頁「報名」按鈕文字？ | 維持「我要報名」；點擊未登入觸發登入（既有）| 不動 |
| Q11 | guardedPages 要如何管理？ | 重構為 `js/config.js` `AUTH_REQUIRED_PAGES` 共用常數 | 避免 4 處同步失誤 |

---

## 4. 檔案變更清單

### 新增（0 個）

無

### 修改（10 個）

| # | 檔案 | 改動範圍 | 鎖定狀態 |
|---|------|---------|---------|
| 1 | `js/config.js` | 新增 `AUTH_REQUIRED_PAGES = ['page-profile', 'page-messages']` 常數 | 一般 |
| 2 | `js/core/navigation.js` | L327 / L461 / L525 三處 `guardedPages` 改用 `AUTH_REQUIRED_PAGES` | 一般 |
| 3 | `js/modules/role.js` | L274 `guardedPages` 改用 `AUTH_REQUIRED_PAGES` | 一般 |
| 4 | `js/modules/event/event-detail.js` | `showEventDetail` 確認 `isGuestView` 傳遞正確（從 options 取） | 一般 |
| 5 | `js/modules/team/team-detail.js` | `showTeamDetail` 呼叫端需傳 `allowGuest: true`（查出所有呼叫點） | 一般 |
| 6 | `js/modules/tournament/tournament-detail.js` + `tournament-friendly-detail.js` | 同上 | 一般 |
| 7 | `js/modules/profile/profile-core.js` | `showUserProfile` 呼叫端補 `allowGuest: true` | 一般 |
| 8 | `js/modules/favorites.js` | 確認未登入仍顯示愛心（UI 不隱藏） | 一般 |
| 9 | `docs/architecture.md` | 標註「延遲登入」架構決策 | 一般 |
| 10 | `docs/claude-memory.md` | 記錄「延遲登入」架構決策 | 一般 |

### 不改動

- **Firestore Rules** — `events` read 本就 `if true`
- **Cloud Functions** — 所有 endpoint 本就有 `if (!request.auth)` 守衛
- `js/firebase-crud.js` — 報名 transaction 本就需要 `auth.currentUser`
- `js/firebase-service.js` — `_signInWithAppropriateMethod` 本就跳過未登入
- `js/line-auth.js` — `initSDK` vs `init` 分離已存在
- `app.js` `_requestLoginForAction` / `_resumePendingAuthAction` / `ensureCloudReady` — 既有、不動
- `pages/*.html` — DOM 結構不動
- 所有 `_requireProtectedActionLogin` 的呼叫點 — 寫入類守衛、本就是延遲登入的基石

---

## 5. 工作分解（WBS）

### Phase 1：共用常數重構（0.5 天）

- [ ] 1.1 `js/config.js` 新增：
  ```js
  const AUTH_REQUIRED_PAGES = Object.freeze(['page-profile', 'page-messages']);
  ```
- [ ] 1.2 `navigation.js:327` 改 `const guardedPages = AUTH_REQUIRED_PAGES;`
- [ ] 1.3 `navigation.js:461` 同上
- [ ] 1.4 `navigation.js:525` 同上（注意：L461 和 L525 在同一函式 `showPage` 內，可能可以提 function 級常數）
- [ ] 1.5 `role.js:274` 同上
- [ ] 1.6 grep 驗證：`grep -rn "guardedPages\s*=\s*\[" js/` 應無結果（確認全部改完）

### Phase 2：Detail 頁 allowGuest 呼叫端補齊（1 天）

- [ ] 2.1 列出 `showEventDetail` 的所有呼叫點（grep），找出「純瀏覽情境」
- [ ] 2.2 列出 `showTeamDetail` 所有呼叫點
- [ ] 2.3 列出 `showTournamentDetail` / `showFriendlyDetail` 所有呼叫點
- [ ] 2.4 列出 `showUserProfile` 所有呼叫點
- [ ] 2.5 逐一判定是否要傳 `allowGuest: true`（從列表 / 月曆點擊 = YES；從管理後台點擊 = 視情況）
- [ ] 2.6 修改、測試

### Phase 3：Favorites UI（0.3 天）

- [ ] 3.1 確認 `favorites.js` 的 `_favHeartHtml` 在未登入時是否仍渲染愛心（可能已經是）
- [ ] 3.2 點擊未登入愛心 → 應彈「登入才能收藏」toast + 自動觸發 LIFF login（既有 `_requireProtectedActionLogin` 應該已做）
- [ ] 3.3 若 UI 不符合、補強

### Phase 4：QA + 跨瀏覽器測試（1 天）

- [ ] 4.1 未登入流程完整走一遍（見 §9 測試場景）
- [ ] 4.2 跨瀏覽器測試（LINE WebView / Chrome / Safari）
- [ ] 4.3 深連結 `?event=XXX` 測試
- [ ] 4.4 登入後 `_resumePendingAuthAction` 驗證所有 action type
- [ ] 4.5 驗證 Tier 2 登入路徑（LIFF 過期但 Firebase Auth 活）

### Phase 5：文件與收尾（0.3 天）

- [ ] 5.1 更新 `docs/architecture.md`
- [ ] 5.2 `docs/claude-memory.md` 記錄
- [ ] 5.3 bump version + commit + push

---

## 6. 驗收標準

### 功能驗收

- [ ] 未登入可進入 bot-tab 的「活動」「俱樂部」「賽事」
- [ ] 未登入可從 drawer menu 進入同樣的頁面
- [ ] 未登入可看活動詳情、月曆、俱樂部詳情、賽事詳情、友誼賽詳情、他人名片
- [ ] 未登入點「個人」bot-tab / drawer → 彈登入 + 觸發 LIFF login
- [ ] 未登入點「訊息」bot-tab / drawer → 同上
- [ ] 未登入點報名 → LIFF 登入 → 自動續跑報名
- [ ] 未登入點收藏 → 彈登入提示 → 登入後收藏生效
- [ ] 未登入點「＋ 新增活動」→ 彈登入 → 登入後進 create modal
- [ ] 未登入點「加入俱樂部」→ 彈登入 → 登入後進申請流程
- [ ] 登入用戶既有功能不變（所有 tab 照舊可用）
- [ ] grep `guardedPages\s*=\s*\[` 無結果（全部用 `AUTH_REQUIRED_PAGES`）

### 非功能驗收

- [ ] `test:unit` 全過（2362+ 不 regression）
- [ ] Lighthouse Performance 不降（應該會**提升**、因為首頁不跑 LIFF init 完整流程）
- [ ] LINE WebView 實測全流程
- [ ] Safari / Chrome 從 `toosterx.com` 深連結實測
- [ ] 4 處 guard 重構後、grep 確認只改 4 處、不誤動其他位置

---

## 7. 風險評估（CLAUDE.md 規範）

| 評估項目 | 內容 |
|----------|------|
| **做了會怎樣（好處）** | ① 新用戶跳出率降低（不會被登入牆擋）② 首屏更快（延遲 LIFF init）③ SEO 爬蟲能看到真實內容 ④ LINE 外（Safari）用戶體驗改善 |
| **不做會怎樣** | 繼續維持「開 APP 就登入」，部分新用戶跳出、但現況可用無 bug |
| **最壞情況** | ① detail 頁漏補 `allowGuest` → 未登入點擊仍彈登入（「未改徹底」、非 break bug）② guardedPages 4 處漏改其中一處 → 某個路徑仍擋（可用 grep 驗證） |
| **影響範圍** | 前端 8-10 個檔案；Rules / CF / 資料庫零改動 |
| **回退難度** | **單 commit revert、5 分鐘** |
| **歷史教訓** | ① 2026-04-19 「移除 `_pendingFirstLogin` 攔截導航」精神一致 ② `INHERENT_ROLE_PERMISSIONS` 兩地同步的地雷 — `guardedPages` 四地同步的同類型、本次改共用常數根本解決 |

---

## 8. 回退策略

### 層級 1：單 commit revert（5 分鐘）

```bash
git revert <commit-hash>
node scripts/bump-version.js
git push origin HEAD:main
```

### 層級 2：restore guardedPages（1 分鐘）

若發現某個 tab 未登入有問題、單獨改 `AUTH_REQUIRED_PAGES` 加回某頁即可、不用完整 revert。

---

## 9. 測試計畫

### 手動測試場景

1. **未登入 happy path**：開 APP → 首頁 → 切活動 tab → 看月曆 → 切籃球分類 → 點活動 → 看詳情 → 點報名 → LIFF 登入 → 回來自動報名 → 看到通知
2. **未登入 blocked path**：開 APP → 點「個人」bot-tab → 彈登入 → 登入後自動跳個人頁
3. **未登入 drawer menu**：開 APP → 開 menu drawer → 點各項目 → 活動 / 俱樂部 / 賽事可進、個人 / 訊息彈登入
4. **登入後換帳號**：登入 A → 登出 → 頁面 reload、仍未登入 → 切月曆看活動 → 點報名 → LIFF 登入 B → 確認登入的是 B
5. **深連結**：Safari 開 `toosterx.com/?event=XXX` → 未登入看活動詳情 → 點報名 → 登入 → 自動報名
6. **LIFF session 過期（Tier 2）**：已登入用戶 LIFF 30 天過期 → 切活動 tab 能看 → 點報名時 Tier 2 走 Firebase Auth
7. **收藏**：未登入點愛心 → 彈登入 → 登入後自動收藏
8. **建立活動**：未登入點「＋ 新增活動」→ 彈登入 → 登入後開啟 create modal
9. **俱樂部 detail**：未登入從列表點俱樂部 → 能看；未登入點「加入」→ 彈登入
10. **賽事 detail**：未登入從列表點賽事 → 能看；未登入點「報名」→ 彈登入
11. **他人名片**：未登入點用戶大頭照 → 能看公開檔案

### 單元測試

- **不新增**（改動小、無新純函式需要測）
- 跑既有 2362 個測試確認無 regression

---

## 10. 後續擴充（不在本期）

- [ ] 未登入用戶行為分析（GA event）
- [ ] 未登入用戶看活動列表時的 CTA（「登入看個人化推薦」）
- [ ] 「訪客模式」UI 區分（頂部有「訪客瀏覽中」提示）
- [ ] Rate limiting（防爬蟲過度讀取 events 集合）
- [ ] 深連結 `?event=XXX` 的 server-side rendering（SEO 進階）
- [ ] 登入按鈕在活動詳情頁的顯眼 CTA

---

## 11. 回歸風險與對接驗證（v2 新增）

### 11.A 🔴 `_flushPendingProtectedBootRoute` 耦合檢查

**現況**：boot 時若 `_pendingProtectedBootRoute.pageId` 存在、會調 `showPage(pageId)`。

**風險**：若 pageId = 'page-activities'（之前在 guardedPages 裡、現在不是），flush 行為會變——從「等 cloud init + 登入」變成「直接 render」。

**驗證**：`_pendingProtectedBootRoute` 是何時被設定的？若只在「用戶登入前嘗試進 protected page」時設定、精簡 guardedPages 後自然不會進到這個 state。

### 11.B 🟡 `_isLoginRequired` 仍會觸發 `_requireLogin` toast

**現況**：`showPage()` L525 若 pageId 在 guardedPages 且未登入、`_requireLogin()` 會 `showToast('請先登入LINE帳號')`。

**精簡後**：只有 `page-profile` / `page-messages` 會走這個路徑、toast 合理。

**驗證**：確認沒有意外路徑觸發 toast。

### 11.C 🟡 `_canUseStaleNavigation` 依賴 guardedPages

**現況**：`navigation.js:470` 依 `guardedPages.includes(pageId)` 決定是否允許 stale。

**精簡後**：`page-activities` 不在陣列內 → `staleAuthPending = false` → `canUseStale` 可能變為 true → 用戶更快看到 stale 頁（體驗更好）。

**驗證**：無負面影響。

### 11.D 🟢 `suppressToast` / `suppressLoginToast` 選項

**現況**：多處呼叫傳 `suppressToast: true`、避免重複 toast。

**精簡後**：不受影響。

### 11.E 🟢 `_requestLoginForAction` action type 覆蓋

**現況**：7 種 type 支援 `showPage` / `showEventDetail` / `eventSignup` / `eventCancelSignup` / `toggleFavoriteEvent` / `toggleFavoriteTournament` / `goToScanForEvent`。

**精簡後**：若 lazy auth 觸發點會新增新 action type（例如 createEvent、joinTeam），需補 switch case。**本期不新增任何 type**（因為 createEvent/joinTeam 都是用「先彈 modal → modal 內含登入檢查」的模式、不走 pending action）。

---

## 12. How to start coding（新進工程師指引）

### 12.1 從哪裡看起

1. 先讀 §0 TL;DR 了解目標
2. 讀 §2 「既有架構現況」知道「不用動什麼」
3. 讀 §4 檔案清單 + §5 WBS 開始動手

### 12.2 Phase 1 具體步驟

```javascript
// js/config.js 新增（放在 ROLES 附近）
const AUTH_REQUIRED_PAGES = Object.freeze([
  'page-profile',
  'page-messages',
  // 註：'page-activities', 'page-teams', 'page-tournaments' 已移除、
  // 改為延遲登入（see docs/lazy-auth-plan.md）
]);
```

接著在 navigation.js L327、L461、L525、role.js L274 四處 `const guardedPages = [...]` 改為：
```javascript
const guardedPages = AUTH_REQUIRED_PAGES;
```

### 12.3 常見踩坑

| 情境 | 注意 |
|------|------|
| 改 `guardedPages` 後漏改其他 3 處 | 用 grep 驗證 `guardedPages\s*=\s*\[` 無結果 |
| Detail 頁呼叫端沒傳 `allowGuest: true` | 未登入仍會彈登入（不是 break bug、只是沒改徹底）|
| 收藏愛心未登入時不顯示 | 改 `favorites.js` 的 `_favHeartHtml` 讓它 always render |
| 登入後 `_resumePendingAuthAction` 漏 case | 本期不新增 action type、若未來要補、在 app.js L1184 switch 加 case |

---

## 13. CLAUDE.md 規則檢查清單

- [x] **外科手術式修改**：僅動必要檔案、不動鎖定函式區
- [x] **程式碼精簡**：4 個 guardedPages 合併為 1 個常數、反而比既有更精簡
- [x] **跨瀏覽器相容性**：LINE WebView / Chrome / Safari 測試
- [x] **實體 ID 統一**：不涉及
- [x] **測試與 CI**：跑 `npm run test:unit`
- [x] **版號更新**：改 JS 必 `bump-version.js`
- [x] **文件同步**：更新 architecture.md + claude-memory.md
- [x] **報名系統保護規則**：不動 transaction / rebuild logic
- [x] **統計系統保護規則**：不動 stats 函式
- [x] **Firestore Rules 修改規則**：不改 Rules
- [x] **Cloud Functions 修改規則**：不改 CF
- [x] **活動可見性規則**：不改 `_isEventVisibleToUser`（既有不動）
- [x] **兩地同步地雷**：本次把 4 處 guardedPages 合併為 1 個常數、**根本解決**這類地雷

---

## 14. 確認事項

若用戶確認：
- **只做 MVP（推薦）** → **Phase 1**（0.5-1 天、改 4 處 guardedPages + 1 個常數）、實機驗證、常見情境已覆蓋 80%+
- **MVP + 打磨** → Phase 1 + Phase 2（補 detail 呼叫端 allowGuest、1.5-2 天）、體驗更完整
- **全盤（含 P2 項目）** → Phase 1-5（2-2.5 天）
- **部分調整** → 請用 Q 編號告知

### MVP 預期效果（只做 Phase 1）

✅ **能做到**：
- 未登入可進入「活動」「俱樂部」「賽事」bot-tab
- 未登入可看月曆 / 活動列表 / 活動詳情（非 teamOnly）
- 未登入點報名 → LIFF 登入 → 自動續跑報名（既有機制）
- 未登入點愛心 → 彈登入 → 登入後收藏（既有機制）

⚠️ **小瑕疵（Phase 2 解決）**：
- 未登入看活動詳情、收藏愛心仍顯示（點擊會彈登入、但介面不夠「訪客感」）
- teamOnly / 俱樂部限定活動、未登入點擊可能彈「沒有權限」toast（而非「請登入」）
- 未登入看活動詳情時、系統嘗試寫 viewCount++ 會被 Rules 擋（有 warn log、不 crash）

這些瑕疵**不影響核心功能**、可本期後再處理。

---

**計畫書版本**：2026-04-23 v3（最終版）
**維護者**：Claude
**審計歷程**：
- v1（2026-04-23 初版）— 宣稱「只改 1 行」、低估範圍
- v2（2026-04-23 自審修正）— 發現 4 處 guardedPages + 5 處 detail 呼叫端
- v3（2026-04-23 再自審）— 確認 detail 呼叫端非必要、MVP 精簡為 0.5-1 天
