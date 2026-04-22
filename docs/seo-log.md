# ToosterX SEO 優化日誌

> 記錄所有 SEO 相關的設定、優化、變更與決策。未來做 SEO 調整時必須先查閱本日誌，避免重複作業或推翻過去的決策。

---

## 目前 SEO 架構總覽

### 網域與託管
| 項目 | 設定 |
|------|------|
| 主網域 | `toosterx.com`（不帶 www） |
| 託管平台 | Cloudflare Pages |
| SSL | Cloudflare 自動 HTTPS |
| www 重導向 | Cloudflare 網頁規則：`www.toosterx.com/*` → 301 → `https://toosterx.com/$1` |
| Crawler Hints | 已開啟（Cloudflare Caching → Configuration → Crawler Hints） |

### Google Search Console
| 項目 | 設定 |
|------|------|
| 資源類型 | URL 前置字元 `https://toosterx.com/` |
| Sitemap | 已提交 `https://toosterx.com/sitemap.xml` |
| 自動提交機制 | GitHub Actions + GCP Service Account（見下方自動化段落） |

### 結構化資料（JSON-LD）
| 頁面 | Schema 類型 |
|------|-------------|
| index.html | `WebApplication` + `Organization` + `FAQPage`（8 組 Q&A） |
| privacy.html | `BreadcrumbList`（2 層） |
| terms.html | `BreadcrumbList`（2 層） |
| seo/football.html | `BreadcrumbList`（2 層）+ `WebPage` + `FAQPage` |
| seo/basketball.html | `BreadcrumbList`（2 層）+ `WebPage` + `FAQPage`（6 組） |
| seo/pickleball.html | `BreadcrumbList`（2 層）+ `WebPage` + `FAQPage` |
| seo/dodgeball.html | `BreadcrumbList`（2 層）+ `WebPage` + `FAQPage`（6 組） |
| seo/running.html | `BreadcrumbList`（2 層）+ `WebPage` + `FAQPage` |
| seo/hiking.html | `BreadcrumbList`（2 層）+ `WebPage` + `FAQPage` |
| seo/football-taichung.html | `BreadcrumbList`（3 層）+ `WebPage` + `FAQPage` |
| seo/nantun-football-park.html | `BreadcrumbList`（4 層）+ `Article` + `SportsActivityLocation` + `FAQPage` |
| seo/sports-changhua.html | `BreadcrumbList`（2 層）+ `WebPage` + `FAQPage`（6 組） |
| seo/sports-nantou.html | `BreadcrumbList`（2 層）+ `WebPage` + `FAQPage`（6 組） |

### Meta 標籤配置
| 標籤 | 首頁 | SEO 著陸頁 | privacy/terms |
|------|------|-----------|---------------|
| title | 完整含關鍵字 | 完整含關鍵字 | 簡單品牌標題 |
| meta description | 有 | 有 | 有 |
| meta keywords | 有 | 有（40+ 長尾詞） | 無（不需要） |
| canonical | 有 | 有 | 有 |
| hreflang zh-TW | 有 | 有 | 無 |
| hreflang x-default | 有 | 有 | 無 |
| og:title/description/image/url/type/locale/site_name | 完整 | 完整 | 完整 |
| twitter:card | summary_large_image | 無（用 OG fallback） | 無 |

### 快取策略（_headers）
| 路徑 | Cache-Control |
|------|--------------|
| `/css/*`、`/js/*`、`/pages/*` | `public, max-age=31536000, immutable` |
| `/images/*` | `public, max-age=86400` |
| `/seo/*` | `public, max-age=86400` |
| `/privacy.html`、`/terms.html` | `public, max-age=86400` |
| `/index.html`、`/` | `public, max-age=0, must-revalidate` |
| `/sw.js` | `public, max-age=0, must-revalidate` |
| `/game-lab.html` | `noindex, nofollow, noarchive` |
| `/changelog/*` | `noindex, nofollow, noarchive` |
| `/valuation/*` | `noindex, nofollow, noarchive` |

### robots.txt
```
User-agent: *
Allow: /
Disallow: /pages/
Disallow: /inventory/
Disallow: /permissions/
Disallow: /changelog/
Disallow: /valuation/
Disallow: /functions/
Disallow: /test-
Disallow: /GrowthGames.html
Disallow: /game-lab.html
Disallow: /docs/
Sitemap: https://toosterx.com/sitemap.xml
```

### sitemap.xml 收錄頁面
| URL | priority | lastmod |
|-----|----------|---------|
| `/` | 1.0 | 2026-04-22 |
| `/roles/` | 0.7 | 2026-04-22 |
| `/privacy.html` | 0.3 | 2026-04-22 |
| `/terms.html` | 0.3 | 2026-04-22 |
| `/seo/football.html` | 0.8 | 2026-04-22 |
| `/seo/basketball.html` | 0.8 | 2026-04-22 |
| `/seo/pickleball.html` | 0.8 | 2026-04-22 |
| `/seo/dodgeball.html` | 0.8 | 2026-04-22 |
| `/seo/running.html` | 0.8 | 2026-04-22 |
| `/seo/hiking.html` | 0.8 | 2026-04-22 |
| `/seo/football-taichung.html` | 0.8 | 2026-04-22 |
| `/seo/nantun-football-park.html` | 0.8 | 2026-04-22 |
| `/seo/sports-changhua.html` | 0.8 | 2026-04-22 |
| `/seo/sports-nantou.html` | 0.8 | 2026-04-22 |

sitemap.xml 首頁條目新增 `<image:image>` 標記 og.png。

### 內部連結架構
```
index.html (noscript)
  ├── 依運動項目揪團
  │     ├── seo/football.html
  │     ├── seo/basketball.html
  │     ├── seo/pickleball.html
  │     ├── seo/dodgeball.html
  │     ├── seo/running.html
  │     └── seo/hiking.html
  └── 依地區揪團
        ├── seo/football-taichung.html
        │     └── seo/nantun-football-park.html
        ├── seo/sports-changhua.html
        └── seo/sports-nantou.html

各 SEO 頁面互相交叉連結（每頁連到其他頁面，不連自己）
```

### 自動化機制
| 機制 | 說明 | 狀態 |
|------|------|------|
| Cloudflare Crawler Hints | 自動通知 Bing/Yandex 內容變更（IndexNow） | 已開啟 |
| GitHub Actions sitemap 提交 | push 含 SEO 檔案變更時自動提交 sitemap 給 Google | 已建立，待設定 GCP Service Account |
| 觸發條件 | `sitemap.xml`、`seo/**`、`index.html` 變更時觸發 | 已設定 |
| 腳本位置 | `scripts/submit-sitemap.js` | 已部署 |
| 設定指南 | `scripts/SETUP-GSC-API.md` | 已建立 |

---

## SEO 優化歷史紀錄

### 2026-04-22 — 階段 3.1：/admin/seo Dashboard UI 改版 + 4 項問題修復

**問題 / 目標**：
階段 3 完成後用戶實測發現 4 個 UI 問題需修復。

**執行項目**：

1. **i18n 缺 admin.seo 翻譯（drawer 顯示 "admin.seo" 字串）**
   - 根因：`DRAWER_MENUS` 設 `i18nKey: 'admin.seo'` 但 `js/i18n.js` 未新增對應翻譯
   - UI 行為：未翻譯 key 直接顯示 key 本身
   - 修復：6 語言（zh-TW/en/ja/ko/th/vi）同步新增 `admin.seo` 翻譯

2. **Drawer 選單「SEO 儀表板」與「數據儀表板」被分成不同區（粉紅色不同組）**
   - 根因：`role.js` L252 的 divider 邏輯
     ```js
     if (lastMinRole !== role && minLevel >= 4) {
       var bothRed = bgClass === 'drawer-role-super' && lastBgClass === 'drawer-role-super';
       if (lastMinRole && !bothRed) html += '<div class="drawer-divider"></div>';
     }
     ```
   - 數據儀表板 `super_admin` → `drawer-role-super`（粉紅）vs SEO `admin` → `drawer-role-admin`（藍）→ `bothRed=false` → 插 divider
   - 修復：給 SEO 儀表板加 `highlight: 'red'` 強制 `drawer-role-super` → `bothRed=true` → 跳過 divider
   - 權限不變：minRole 仍 `'admin'`、super_admin INHERENT 鎖定

3. **Dashboard 內視覺不統一（獨立卡片風）**
   - 根因：原實作每個 `.seo-section` 各有 `background: var(--bg-card)` + border + margin → 獨立卡片堆疊
   - 修復：整個 `#seo-dashboard-content` 改為單一 `bg-card` 大容器，內部 section 完全透明、無 border、無分隔線
   - 結果：整個 dashboard 視覺一體

4. **Refresh 按鈕用 emoji 而非 SVG**
   - 修復：複用活動詳情頁 `.event-detail-refresh-btn` class + 相同 SVG icon（雙箭頭 refresh）

5. **Meta bar 三項資訊（資料日期/產出時間/站點）同行**
   - 修復：CSS `flex-direction: column`，垂直堆疊；說明按鈕 `position: absolute` 到右上角

6. **欄位說明彈窗新增（參考教學俱樂部 _showEduInfoPopup）**
   - 10 個 `seo-info-btn`（? 圖示）對應 10 個 section
   - `_showSeoInfoPopup(type)` 函式含 10 種說明文案
   - 樣式：`edu-info-overlay` + `edu-info-dialog`（獨立複製到 admin-seo.css，不依賴 education.css）

**關鍵決策**：
- **highlight 欄位的意外用途**：原本 `highlight: 'red'` 是給「用戶補正管理」(repair) 做警告紅色，現用來讓 SEO 儀表板與數據儀表板在 drawer 合併顯示同區，**不是視覺警告而是群組歸類工具**
- **單一 bg-card 容器 vs 多張卡片**：數據儀表板的 `.dash-card` 其實也是獨立卡片，但尺寸小密集所以不感覺分離。SEO 儀表板 section 較大所以分離感強烈。改為單一容器是設計上最符合用戶直覺的選擇

**改動統計**：6 檔、136/-96 行（commit `103292e3`）

---

### 2026-04-22 — 階段 3：/admin/seo Dashboard 建置完成（自動化 GSC 資料）

**目標**：super_admin + admin 可見的內部 SEO 儀表板，每日自動從 GSC 抓資料。

**執行項目**：

1. **權限系統擴充**
   - 新增權限碼 `admin.seo.entry`（js/config.js DRAWER_MENUS）
   - INHERENT 鎖定到 super_admin（config.js + functions/index.js 兩地同步）
   - 補 _PERM_INFO 說明（標註「商業敏感資訊，勿對外分享」）
   - config-utils.test.js 同步更新

2. **Firestore Rules + 測試**
   - 新增 `seoSnapshots` collection rules
     - read: admin/super_admin/hasPerm('admin.seo.entry')
     - write: false（僅 Admin SDK 透過 Service Account 寫）
   - 新增 6 個 rules 測試（admin/super_admin/coach+perm/coach-perm/user/write-blocked）
   - 437 個 rules 測試全過

3. **自動化 Workflow**
   - `scripts/gsc-snapshot.js`（389 行）抓 GSC 資料寫 Firestore
     - 總覽（7/28/90 天）
     - 每日時序（30 天）
     - 按頁面 / 裝置 / 國家 / 查詢 / 搜尋外觀分布
     - 搜尋類型分布（web/image/video/news/discover）
     - Sitemap 狀態
     - 14 個 URL Inspection（含 Rich Results）
   - `.github/workflows/gsc-snapshot.yml` 每日 03:00 UTC 自動跑
   - 使用 Firestore REST API（零外部套件依賴）
   - Service Account 跨 project 授權：`sitemap-submitter@toosterx-seo` 加 `roles/datastore.user` @ fc-football-6c8dc

4. **前端 Dashboard**
   - `pages/admin-seo.html` — noindex 靜態頁
   - `js/modules/admin-seo/seo-data-loader.js` — Firestore 讀取 + 30 秒快取
   - `js/modules/admin-seo/seo-dashboard.js` — 主渲染
   - `css/admin-seo.css` — 樣式
   - 功能：總覽卡片 / 30 天柱狀圖 / 頁面表 / 裝置/國家分布 / 類型分布 / 查詢詞 / Sitemap / URL 索引狀態 / Rich Results

5. **路由與載入**
   - page-loader / script-loader / navigation 全部註冊
   - Lazy load（非 admin 用戶不下載 dashboard 程式碼）

**安全保障**：
- Hash route 天然對 Google 隱形
- `<meta robots="noindex, nofollow">` 雙重保險
- Firestore Rules 保護讀取
- super_admin INHERENT 鎖定入口權限
- Service Account 的 datastore.user 角色 + Rules write:false 雙重阻擋寫入其他 collection

**首次觸發結果（2026-04-22 04:55 UTC）**：
- SA 認證成功
- 14 個 URL 全部 inspect 完成（2 indexed / 12 discovered）
- Firestore 寫入 seoSnapshots/2026-04-22 成功
- 28 天曝光 63 / 點擊 23 / CTR 36.5% / 排名 4.3

**版號**：20260420ak → 20260420al

---

### 2026-04-22 — 階段 2 延伸：GSC API 接入 + 修復 Redirect error（重大 SEO 根因修復）

**問題 / 目標**：
用戶給了 GSC 授權後（加 `webmasters.readonly` scope 到 ADC），透過 GSC API 做即時審計，發現**重大未知問題**：Cloudflare Pages 的自動 308 redirect 與 sitemap / canonical 不一致，造成 Google 實際上無法正確索引。

**GSC API 審計結果（2026-04-22 截取）**：

基本數據（90 天）：
- 總曝光 64、點擊 22、CTR 34.38%、平均排名 3.7
- 手機佔 40 曝光（62.5%）、桌機 24 曝光（37.5%）
- 國家：台灣 63、泰國 1
- 表現最好：首頁（曝 47、點 21、CTR 44.7%、排名 2.3）
- 次優：football-taichung（曝 12-14、點 1）

**重大發現**：
- `seo/football.html` 在 URL Inspection API 顯示 **Coverage: Redirect error**
- 實測：所有 10 個 `seo/*.html` 被 Cloudflare 308 redirect 到 `seo/*`（clean URL）
- 但 sitemap.xml / canonical / hreflang / og:url / JSON-LD 全指向 `.html` 版本
- Google 抓 sitemap 拿 `.html` URL → 被 308 → 到 clean URL → canonical 卻回指 `.html` → 判定 Redirect error

**執行項目**：

1. **GSC API 接入**（在本機 ADC）
   - `gcloud auth application-default login --scopes=...webmasters.readonly,...`
   - `gcloud auth application-default set-quota-project toosterx-seo`
   - 驗證：列出 11 個 sites，`sc-domain:toosterx.com` siteOwner 權限

2. **修復所有 `.html` URL 引用為 clean URL**（129 處替換，用 Node.js inline 批次處理）
   - sitemap.xml：10 個 URL 去 .html
   - index.html：noscript 10 個連結去 .html
   - 10 個 seo/*.html 的 canonical / hreflang / og:url / JSON-LD / 互連連結

3. **驗證**
   - grep 無殘留 `.html` 引用
   - UTF-8 驗證：全無 FFFD 亂碼
   - canonical 與 sitemap 一致

**關鍵決策**：
- **Clean URL vs .html URL**：Cloudflare Pages 預設走 clean URL，這是業界標準且 SEO 友好。既然 Cloudflare 會強制 redirect，乾脆把所有引用統一成 clean URL，避免 canonical 混亂
- **為什麼用 Node.js 批次而非逐個 Edit**：129 處替換逐個 Edit 太繁瑣；Node.js `fs.writeFileSync(f, content, 'utf8')` 明確指定編碼，符合 CLAUDE.md 的 UTF-8 規範
- **ADC 授權方案（非 Service Account）**：用戶本機 gcloud 登入的 Google 帳號本來就是 toosterx.com 的 GSC owner，加 scope 最便捷。webmasters.readonly 純唯讀，安全

**GSC 狀態數據（修復前）**：
- sitemap.xml 最後下載 2026-04-22T03:48:29Z
- Contents: web=14 提交 / 0 已索引
- 首頁 indexed（Verdict PASS）、football-taichung.html indexed
- football.html **Redirect error**（今天才爬到）
- 其他 SEO 頁 "Discovered - currently not indexed"（排程中）

**預期效果（修復後）**：
- GitHub Actions submit-sitemap 自動觸發重送 sitemap
- Google 重新爬取 clean URL 版本的 sitemap
- 1-7 天內新 URL 進入索引
- football.html 的 Redirect error 消失
- 所有 SEO 頁面能正確累積排名

**改動統計**：
- 12 檔修改、129 處 URL 替換
- Commit: cdb97587

---

### 2026-04-22 — 階段 2：audit 執行 + meta description 縮短 + Lighthouse CI 建設

**問題 / 目標**：
階段 1 新增 4 個 SEO 著陸頁後，執行 audit 確認品質並建立長期監控機制。

**執行項目**：

1. **靜態 SEO audit（通過項目）**
   - 新 4 頁部署驗證：HTTP 200 全過（toosterx.com/seo/basketball|dodgeball|sports-changhua|sports-nantou）
   - 圖片 `alt`：全過（SEO 頁不依賴圖片素材）
   - H1 單一性：全過
   - `lang="zh-Hant"`：全過
   - sitemap.xml 可訪問性：200 OK

2. **靜態 SEO audit（發現並修正）**
   - meta description 全部過長（新 4 頁 240-275 字元，建議 160 以下）
   - 縮短新 4 頁 meta description 到 95-110 字元
   - 既有 SEO 頁（football/running/hiking/pickleball 等）亦有類似問題，本次不主動修改以避免干擾既有排名

3. **新增 Lighthouse CI workflow**（`.github/workflows/lighthouse.yml`）
   - 觸發：手動（workflow_dispatch）+ 每週一 02:00 UTC（台北 10:00）
   - 涵蓋 10 個代表頁面：首頁 + 6 運動頁 + 3 地區頁
   - 使用 treosh/lighthouse-ci-action@v12
   - 報告上傳 temporaryPublicStorage（公開暫存、有效期數月）
   - 初期不設 assertions 閾值，先收集基準再訂規則

4. **PSI API 備援策略**
   - Google PageSpeed Insights API 無 key 時共享配額容易被鎖（本次實測遇到）
   - 改走：(a) 本地靜態分析立即可修的問題 (b) GitHub Actions 的 Lighthouse CI 做長期監控
   - 若未來需精確 Core Web Vitals 數據，可申請個人 PSI API Key

**關鍵決策**：
- **為什麼不設 Lighthouse CI 閾值 assertions**：首次執行還沒有基準，過嚴會一直 fail workflow，過鬆失去意義。先收集 4-8 週報告，訂出合理閾值再加
- **為什麼每週跑而非每次 push**：push 觸發會讓本專案高頻的 commit 節奏被 Lighthouse CI queueing 塞滿；每週定期 + 手動即可滿足監控需求
- **為什麼不動既有 SEO 頁 meta description**：既有頁面已在 Google SERP 有排名，meta description 重寫會觸發重新評估，短期有排名波動風險。按 CLAUDE.md「外科手術式修改規則」只動新頁
- **為什麼暫緩擴充著陸頁（階段 1 D 選項）**：先確認階段 1 的 4 頁效果（Google 索引狀態、排名趨勢）再決定是否擴充，避免內容稀釋

**改動統計**：修改 4 檔（meta description）、新增 1 檔（lighthouse.yml workflow）

---

### 2026-04-22 — 階段 1：內容覆蓋擴充（4 新著陸頁 + 全面 SEO 補強）

**問題 / 目標**：
SEO 基礎架構完善但內容覆蓋度不足。專案支援 10+ 種運動僅 4 種有著陸頁、地區只涵蓋台中。sitemap lastmod 停在 4/2 已近 3 週未更新，Google 判斷內容不新鮮。privacy/terms 缺 BreadcrumbList、robots.txt 未明確對 AI 爬蟲聲明、首頁 noscript 未涵蓋新運動。

**執行項目**：

1. **新增 4 個 SEO 著陸頁**（約 2000 字 / 頁）
   - `seo/basketball.html`（橘色主色系）：籃球揪團、5v5/3x3/半場、新手入門、場地推薦、裝備指南、40+ 關鍵詞
   - `seo/dodgeball.html`（靛藍主色系）：美式躲避球、泡棉球、6v6 社交運動、公司團建、新手常見擔心對照表
   - `seo/sports-changhua.html`（青藍主色系）：彰化縣各鄉鎮運動分區、八卦山自行車、員林/鹿港/和美/溪湖/北斗
   - `seo/sports-nantou.html`（綠色主色系）：南投山城運動、合歡武嶺、日月潭環湖、百岳/自行車/路跑路線表

2. **sitemap.xml 全面更新**
   - 新增 4 個著陸頁 URL
   - 所有 lastmod 更新為 2026-04-22（Google 判斷內容新鮮）
   - 首頁條目新增 `<image:image>` 圖片標記（讓 og.png 被 Google Images 收錄）
   - 加入 `xmlns:image` 命名空間宣告

3. **robots.txt 加 AI 爬蟲規則**
   - 新增 `GPTBot`、`ClaudeBot`、`PerplexityBot`、`Google-Extended` 的明確聲明
   - 允許公開內容供 AI 訓練，排除 `/pages/`、`/inventory/`、`/permissions/`
   - 解讀：主動參與 AI 生態有助於品牌曝光，且本平台的內容非敏感商業機密

4. **privacy.html / terms.html 補 BreadcrumbList**
   - 2 層 BreadcrumbList：ToosterX → 隱私權政策 / 服務條款
   - 讓 Google SERP 正確顯示麵包屑

5. **index.html noscript 區塊重構**
   - 分成「依運動項目揪團」與「依地區揪團」兩個 H2 區塊
   - 新增 basketball/dodgeball/sports-changhua/sports-nantou 四個連結
   - 每個連結帶語義化描述文字

**關鍵決策**：
- **為什麼沒做地區獨立下拉、而是整體新增著陸頁**：著陸頁 SEO 效益大於 UI 功能，先把內容量鋪滿才有後續的篩選必要
- **為什麼地區選彰化/南投先於台北/高雄**：用戶明確指定優先順序；另 seo-log.md 4/2 紀錄顯示「地區專頁 >> 通用頁」的 SEO 效益（台中足球專頁 1800 字效果優於通用足球頁）
- **為什麼每頁獨立主色系**：Google 會爬視覺重點，每頁識別度高；用戶從 SERP 點進不同運動頁體驗鮮明
- **賽事著陸頁暫緩**：賽事 document 無獨立 sportTag 欄位、內容量也不足以支撐獨立著陸頁，先由運動/地區頁覆蓋

**改動統計**：新增 4 檔、修改 5 檔（sitemap/robots/index/privacy/terms）、共約 +1200 行

---

### 2026-04-02 — SEO 全面審計與優化（初始建設）

**執行項目：**

1. **Twitter Card 升級**
   - `index.html`：`summary` → `summary_large_image`
   - 效果：社群分享時顯示大圖卡片

2. **hreflang 標籤**
   - 在 `index.html` + 所有 `seo/*.html` 加入 `zh-TW` + `x-default`
   - 目的：幫助 Google 識別語言/地區定向

3. **BreadcrumbList JSON-LD**
   - 所有 SEO 著陸頁加入麵包屑結構化資料
   - 效果：Google SERP 顯示麵包屑導航

4. **SEO 著陸頁互相內部連結**
   - 每頁底部加「其他運動揪團」nav 區塊
   - 各頁連到其他頁面，不連自己
   - 連結色系配合各頁主色

5. **sitemap.xml 加 lastmod**
   - 所有 URL 加上 ISO 日期格式的 lastmod
   - 幫助 Google 判斷內容新鮮度

6. **_headers 快取規則**
   - 新增 `/seo/*`、`/privacy.html`、`/terms.html` 的 24 小時快取

7. **manifest.json 品牌統一**
   - `SportHub` → `ToosterX`

8. **privacy.html / terms.html**
   - 加入完整 OG 標籤
   - 內文品牌名統一 `SportHub` → `ToosterX`

9. **index.html noscript 連結**
   - 舊的 hidden div（`position:absolute;left:-9999px`）替換為語義正確的 `<noscript>` 區塊
   - 內含所有 SEO 著陸頁連結，讓 Google 從首頁發現這些頁面

### 2026-04-02 — 足球關鍵字強化

**問題：** 搜尋「台中踢球」「中部踢球」「新手踢球」等詞找不到網站

**根因分析：**
- 首頁無連結到 SEO 頁（Google 爬不到）
- 「新手踢球」完全未出現在頁面中
- 台中專屬內容只有約 100 字，被多城市內容稀釋
- 無 Google Search Console 驗證

**執行項目：**

1. **football.html 內容擴充**
   - 台中專區從 ~100 字擴充到 ~300 字
   - 新增「新手踢球完全指南」專區
   - keywords meta 從 38 個擴充到 50+ 個長尾關鍵詞
   - 新增關鍵詞：新手踢球、足球社團、足球隊招人、下班踢球、踢球散客、LINE足球揪團等

2. **新建 football-taichung.html（台中足球專頁）**
   - ~1800 字，全部聚焦台中
   - 9 個場地卡片（朝馬、台體大、都會公園、西屯五人制、北屯、太平、西屯足球場、南屯足球園區、彰化三村）
   - 5 種活動類型介紹（平日晚上、週末、新手、友誼賽、教學）
   - 台中足球同好社群介紹
   - 中部踢球地圖（彰化、南投、苗栗、大里、豐原、太平）
   - 40+ 地區關鍵詞
   - BreadcrumbList 3 層

3. **新建 nantun-football-park.html（南屯足球園區專題）**
   - 全台首座 AFC 認證國際足球場館完整報導
   - 數據看板（4.7 公頃 / 15.2 億 / 6,000 席 / 4 座球場）
   - 4 座球場規格詳解（主場天然草皮、副場 FIFA 認證人工草皮、2 座五人制）
   - 設施規格表（停車 407+404、球員休息室、商業空間）
   - 工程時程線（2021-2027）
   - 交通指南（自駕、大眾運輸、周邊地標）
   - 啟用影響分析（國際賽事、職業聯賽、訓練基地、中部足球廊帶）
   - 遮棚爭議如實報導
   - 6 則官方新聞來源引用
   - BreadcrumbList 4 層、SportsActivityLocation schema
   - 30+ 目標關鍵詞

### 2026-04-02 — 結構化資料修正

**問題：** Google Search Console 報錯：SportsEvent 缺 `startDate`（1 個重大問題 + 8 個非重大問題）

**根因：** SEO 著陸頁是「介紹頁」不是特定賽事，錯誤使用了 `SportsEvent` 類型

**修正：** 5 個頁面的 `about` 從 `SportsEvent` 改為 `Thing`
- football.html、running.html、hiking.html、pickleball.html、football-taichung.html

### 2026-04-02 — Cloudflare www 重導向

**問題：** GSC 顯示「替代頁面（有適當的標準標記）」— `www.toosterx.com` 被視為替代版本

**修正：** Cloudflare 網頁規則新增 301 重導向
- `www.toosterx.com/*` → `https://toosterx.com/$1`

### 2026-04-02 — SEO 自動化建設

1. **Cloudflare Crawler Hints 開啟**
   - 位置：Caching → Configuration → Crawler Hints
   - 效果：Cloudflare 自動透過 IndexNow 通知 Bing/Yandex 內容變更

2. **Google Search Console API 自動提交 sitemap**
   - 腳本：`scripts/submit-sitemap.js`（純 Node.js 內建模組，零依賴）
   - Workflow：`.github/workflows/submit-sitemap.yml`
   - 觸發條件：push 到 main 且變更 `sitemap.xml`、`seo/**`、`index.html`
   - 設定指南：`scripts/SETUP-GSC-API.md`
   - 狀態：待使用者設定 GCP Service Account

3. **Google Indexing API 評估結果：不可用**
   - 原因：僅支援 `JobPosting` 和 `BroadcastEvent` 類型
   - 風險：用於不支援的內容可能導致流量永久下降
   - 決策：放棄此方案

---

## 待辦 / 未來優化方向

- [ ] GCP Service Account 設定完成，啟動 sitemap 自動提交
- [ ] GSC 手動提交新 URL 索引（football-taichung、nantun-football-park）
- [ ] 觀察 GSC 數據，確認「台中踢球」等關鍵字開始有曝光
- [ ] 為 SEO 著陸頁製作專屬 OG 分享圖（目前都用 app icon）
- [ ] 考慮擴增更多運動著陸頁（籃球、羽球、排球）
- [ ] 考慮更多城市專頁（台北足球、高雄足球）
- [ ] 建立外部反向連結（足球社群、場地方網站）
- [ ] 評估是否需要 Dynamic Rendering 讓 SPA 內容可被爬取
- [ ] 建立 404.html 友善錯誤頁面
