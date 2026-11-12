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

### 14.3 畫面文字通用原則

- **R-UI-026 [C/DEFAULT]**：站長 2026-10-31 定：「Avoid unnecessary secondary labels and descriptions. Let the layout do the explaining.」（不要多餘的副標與說明文字，讓版面自己說明）。適用於新站 FC-B 的新畫面與新增元件：先問「版面能不能自己說明」，能就不加字；每張畫面派工卡與預覽包必須帶這條並列出可刪的副標／說明句。既有照舊版 A 搬的畫面文案仍照 A（R-CTX-007），要刪 A 既有文字屬 UI 改動，須站長預覽同意；舊站 A 不回頭改。canonical 在此，FC-B `CLAUDE.md` 只鏡射一行並指回本條。判準是「拿掉一行還看得懂就拿掉」；錯誤訊息、法規／安全說明、可及性名稱（`aria-label`、`alt`）不在刪減之列。（2026-11-12 依站長第 62 號 U1 補判準與例外，原條文未列例外，補上以免誤刪必要文字；出處 `總司令交接/站長UIUX要求與標準.md`。）
- **R-UI-027 [B/HARD]**：站長 2026-11-09 定：「我不要文字斷行，要就換行或是簡化文字」。適用新站 FC-B 的介面文字（標題、標籤、提示列、按鈕、toast、表格欄名）；使用者輸入內容與多行段落文案不在此限，照常折行。介面文字在 360px（最窄底線）、375px、390px 與桌機 1280px 寬度下，不得被瀏覽器自動折行；一個詞不可拆成兩行、不留一兩個字的短尾巴到下一行、標點不跑到行首；放不下時優先簡化成一行，真的需要兩行時用明確換行（`<br>` 或拆元素）在語意斷點換行；按鈕、標籤、提示列加 `white-space:nowrap` 並確認不溢出。每張畫面派工卡、預覽包與驗收截圖（含 en 等外語）都要逐句檢查。（2026-11-09 新增。2026-11-12 依站長第 62 號 Q1／Q3 修改：寬度由原「375px 與 390px」改為加測 360px 最窄底線與桌機 1280px，並併入「不拆詞、不甩短尾巴、標點不行首」細則，因站長統一三專案的預覽寬度與斷行寫法；出處 `總司令交接/站長UIUX要求與標準.md` U3、Q1、Q3。）

### 14.4 站長 UI/UX 統一標準（第 62 號）

> 出處：站長 2026-11-12 拍板的第 62 號布達（`D:\Users\msw74\Documents\總司令交接\布達\2026-11-12-第62號-UIUX統一標準.md`）與其附件標準檔 `D:\Users\msw74\Documents\總司令交接\站長UIUX要求與標準.md`（下稱「標準檔」）第 1～3 節與第 5 節統一決定；各條括號內的 U／P／Q 是標準檔條目編號。適用新站 FC-B 的 UI 改動、預覽與驗收；舊站 A 凍結，只在 R-CTX-007 ① 兩站同修時照本節驗證，不以本節為由回頭改 A。標準檔 U1 即 R-UI-026、U3 即 R-UI-027、P2「派工前先給站長預覽、沒有未回應視為同意」即 `CLAUDE.md` R-GOV-007，本節不重複定義。站長日後新增 UI/UX 要求，由 FC PM 回報總司令補進標準檔，再同步本節，保持單一出處。

- **R-UI-028 [C/DEFAULT]**：畫面要簡單，能收折就收折；較長的操作說明收進「？」說明鈕，點開才顯示，不常駐在版面上；說明鈕尺寸與點擊範圍沿用專案既有元件，不另創。（站長 2026-11-12 第 62 號 U2；`總司令交接/站長UIUX要求與標準.md`）
- **R-UI-029 [C/DEFAULT]**：不留過多空白、同類區塊風格一致：沒有資料的段落不畫空表頭；同一列並排的輸入框等高（誤差 ≤2px）；資料清單採「左標籤、右內容」；抽屜與所屬列表同寬。（站長 2026-11-12 第 62 號 U4；`總司令交接/站長UIUX要求與標準.md`）
- **R-UI-030 [B/HARD]**：第一次就做到位：新功能的介面要和現有最好的同類區塊同水準，不接受「先能用、版面之後再補」；版面未達標的畫面不得送預覽或驗收。（站長 2026-11-12 第 62 號 U5；`總司令交接/站長UIUX要求與標準.md`）
- **R-UI-031 [B/HARD]**：按鈕的文字要顯示出來、看得見，不得因對比不足、被截斷或與背景同色而看不見；純圖示鈕只用於 R-UI-033 的全站統一圖示動作，且必須有 `aria-label`。畫面文案用白話，不得出現內部用語、程式代號或英文代號（例如欄位名、權限碼、卡號）。（站長 2026-11-12 第 62 號 U6；`總司令交接/站長UIUX要求與標準.md`）
- **R-UI-032 [B/HARD]**：字級、粗細、字型照全站統一規則，沿用既有 token／共用 class（R-UI-005），不在單一元件自訂一套字級階層；缺少所需層級時先提出，不硬編。手機上的輸入框（`input`、`textarea`、`select`）字級不得小於 16px，避免 iPhone Safari 聚焦時自動放大。（站長 2026-11-12 第 62 號 U7；`總司令交接/站長UIUX要求與標準.md`）
- **R-UI-033 [C/DEFAULT]**：圖示一律用 SVG，不用 emoji（功能按鈕另見 R-UI-002）；同一種動作全站用同一種按鈕形式（例如邀請、刪除都用同一款圖示鈕），不在不同頁面各做一種。（站長 2026-11-12 第 62 號 U9；`總司令交接/站長UIUX要求與標準.md`）
- **R-UI-034 [B/HARD]**：新站決定不做的功能，介面直接拿掉（入口、按鈕、選單項、欄位），不以反灰或停用狀態保留。（站長 2026-11-12 第 62 號 U10，原決定 2026-11-02；`總司令交接/站長UIUX要求與標準.md`）
- **R-UI-035 [B/HARD]**：讀取中只用簡單 CSS 動畫（轉圈、跳動，走 R-UI-012～013 的共用 `ui-*`），不用插畫場景；讀取結果確定前不得先顯示錯誤訊息或否定結論（例如「權限不足」）。（站長 2026-11-12 第 62 號 U11；`總司令交接/站長UIUX要求與標準.md`）
- **R-UI-036 [C/DEFAULT]**：要使用者操作的東西直接放在畫面上，不多加一層「先點開才能操作」；收折（R-UI-028）只用於說明文字與次要資訊，不拿來藏主要操作。（站長 2026-11-12 第 62 號 U12；`總司令交接/站長UIUX要求與標準.md`）
- **R-UI-037 [B/HARD]**：語系維持專案現狀，以 FC-B 實際語系清單為準，不為統一而增減；管理／後台工具只做繁體中文：新增或改版的後台畫面不需要其他語系翻譯，驗收也只驗繁中。（站長 2026-11-12 第 62 號 Q2；`總司令交接/站長UIUX要求與標準.md`）
- **R-UI-038 [A/HARD]**：UI/UX 選案只認站長本人：PM、顧問、外部 AI 不得替站長選定版面或樣式；實作結果與站長核可的預覽有任何不同，都要列出讓站長挑，不得自行定案。派工前預覽與「沒有未回應視為同意」照 `CLAUDE.md` R-GOV-007；唯一例外是 R-UI-042 的代同意範圍。（站長 2026-11-12 第 62 號 P1、P2；`總司令交接/站長UIUX要求與標準.md`）
- **R-UI-039 [B/HARD]**：畫面送站長前，先由兩家 AI 審過截圖（現行為 Grok＋Opus，人選依現行派工布達即時查），兩家都無誤才送站長定案；審查意見與修正結果附在預覽包。（站長 2026-11-12 第 62 號 P3；`總司令交接/站長UIUX要求與標準.md`）
- **R-UI-040 [B/HARD]**：PM 送站長前要親眼看過截圖幫站長把關，不能只採信施工 AI 或審查 AI 的自報。（站長 2026-11-12 第 62 號 P4；`總司令交接/站長UIUX要求與標準.md`）
- **R-UI-041 [B/HARD]**：預覽一律用新站 FC-B 真元件、真樣式實際截圖，不用手刻假圖，也不拿舊站 A 或新站已關閉的功能入畫；設計類需求先跟站長確認要哪一類再做；送出前逐條對照站長到當下的所有 UI/UX 要求（本節、R-UI-026、R-UI-027）。（站長 2026-11-12 第 62 號 P5；`總司令交接/站長UIUX要求與標準.md`）
- **R-UI-042 [B/HARD]**：代同意只限以下兩種，範圍外一律回到 R-UI-038：①夜間自主（00:00～07:30）與站長啟動的暫離模式期間，顧問可代站長同意畫面，截圖留檔、早上給站長看，落檔標明「由顧問代站長同意」；白天選案仍只認站長（第 45、47、53 號）。②站長個別授權的範圍：俱樂部 C 系列與課程 K 系列（2026-11-09）、沿用已核可樣式的載入動畫（2026-11-12）；營運儀表板與新視覺仍須站長本人看。這是站長明示授權的代同意，不是「未回應視為同意」。（站長 2026-11-12 第 62 號 P6、P7；`總司令交接/站長UIUX要求與標準.md`）
- **R-UI-043 [B/HARD]**：需要站長選擇時做成選擇題，每個選項附建議與原因（第 38 號）；站長選的方案有大坑（重工、違規、必出 bug）先攔下，說明問題、後果與建議，站長堅持才照做並記錄風險（第 39 號）；要站長動手（例如真機驗證）時，用白話一步一步說明。（站長 2026-11-12 第 62 號 P8、P10；`總司令交接/站長UIUX要求與標準.md`）
- **R-UI-044 [B/HARD]**：看畫面一律先用 Claude App 內建瀏覽器；腳本自動化截圖（無頭瀏覽器等）改在副機跑。（站長 2026-11-12 第 62 號 P9，第 52 號補充；`總司令交接/站長UIUX要求與標準.md`）
- **R-UI-045 [B/HARD]**：送站長預覽或驗收前，截圖逐項打勾以下八項，任一項不過不得送出；本條補充 R-UI-025 的寬度與檢查項、不改其原文，展示型名單畫面兩條都要過。①寬度：390px（FC 原預覽寬度）、360px（最窄底線）與桌機 1280px 各一組，R-UI-027 的 375px 斷行檢查照該條。②淺色、深色各一套。③語系：R-UI-037 要求的全部語系，管理／後台工具只驗繁中。④斷行符合 R-UI-027。⑤無英文代號與內部用語（R-UI-031）、無大塊空白（R-UI-029）、無多餘副標與說明（R-UI-026）。⑥按鈕文字看得見、同類按鈕同尺寸同位置（R-UI-033）、文字與背景對比足夠。⑦和站長核可的預覽一致，不同處已列出讓站長挑（R-UI-038）。⑧已經兩家 AI 審過（R-UI-039）、PM 親眼看過（R-UI-040）。（2026-11-12 依站長第 62 號 Q1 新增：取代 R-UI-025 與 `CLAUDE.md` §5 觸發矩陣只寫「desktop／mobile」的模糊寬度，明定 360／390／1280，因站長統一以 360 為最窄底線並加測桌機；R-UI-025 屬 Exact Contract Registry，原文不動、由本條補充。出處：標準檔 §3 清單、U8 六點檢查、Q1；`總司令交接/站長UIUX要求與標準.md`。）
