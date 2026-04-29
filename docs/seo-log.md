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
| `/seo/football-taichung.html` | 0.8 | 2026-04-28（場地對照表新增） |
| `/seo/nantun-football-park.html` | 0.8 | 2026-04-22 |
| `/seo/sports-changhua.html` | 0.8 | 2026-04-22 |
| `/seo/sports-nantou.html` | 0.8 | 2026-04-22 |
| `/blog/` | 0.7 | 2026-04-28（首頁、含分類入口卡片） |
| `/blog/equipment/` | 0.7 | 2026-04-28（裝備類分類頁、5 篇文章） |
| `/blog/rules/` | 0.7 | 2026-04-28（規則類分類頁、1 篇文章） |
| `/blog/football-shoes-guide` | 0.75 | 2026-04-28（足球鞋挑選百科） |
| `/blog/football-rules` | 0.75 | 2026-04-28（足球規則完整解析） |
| `/blog/basketball-rules` | 0.75 | 2026-04-28（籃球規則完整解析） |
| `/blog/badminton-rules` | 0.75 | 2026-04-28（羽球規則完整解析） |
| `/blog/running-rules` | 0.75 | 2026-04-28（路跑賽事規則與禮儀） |
| `/blog/hiking-rules` | 0.75 | 2026-04-28（登山倫理與安全守則） |
| `/blog/pickleball-paddle-guide` | 0.75 | 2026-04-28（匹克球球拍挑選百科） |
| `/blog/basketball-shoes-guide` | 0.75 | 2026-04-28（籃球鞋挑選百科） |
| `/blog/badminton-racket-guide` | 0.75 | 2026-04-28（羽球拍挑選百科） |
| `/blog/pickleball-complete-guide` | 0.75 | 2026-04-28（匹克球完整入門指南） |
| `/blog/running-shoes-guide` | 0.75 | 2026-04-28（跑鞋挑選百科） |
| `/blog/hiking-shoes-guide` | 0.75 | 2026-04-28（登山鞋挑選百科） |

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
  ├── 依地區揪團
  │     ├── seo/football-taichung.html
  │     │     └── seo/nantun-football-park.html
  │     ├── seo/sports-changhua.html
  │     └── seo/sports-nantou.html
  └── 運動百科 / Blog
        └── blog/index.html
              └── blog/football-shoes-guide.html

各 SEO 頁面互相交叉連結（每頁連到其他頁面，不連自己）
Blog 文章交叉連結：footer + 「延伸閱讀」區塊指向相關 seo/* 頁面
```

### 自動化機制
| 機制 | 說明 | 狀態 |
|------|------|------|
| Cloudflare Crawler Hints | 自動通知 Bing/Yandex 內容變更（IndexNow） | ✅ 已開啟 |
| GitHub Actions sitemap 提交 | push 含 SEO 檔案變更時自動提交 sitemap 給 Google | ✅ 已設定、自動運轉中（見下方） |
| GCP Service Account | `sitemap-submitter@toosterx-seo.iam.gserviceaccount.com` | ✅ 已設定、JSON 金鑰存 GitHub Secret `GCP_SERVICE_ACCOUNT_JSON` |
| 觸發條件 | `sitemap.xml`、`seo/**`、`index.html` 變更時觸發 | ✅ 已設定 |
| 腳本位置 | `scripts/submit-sitemap.js`（純 Node.js 內建模組、零依賴） | ✅ 已部署 |
| Workflow 成功率 | 近 10 次 push 皆 success、平均執行 8-12 秒 | ✅ 100%（2026-04-24 最後確認） |
| 設定指南 | `scripts/SETUP-GSC-API.md` | ✅ 已建立 |
| GSC SEO 後台快照 | `scripts/gsc-snapshot.js` 每日 11:00 寫入 `seoSnapshots`，並在 SEO 後台相關檔案 push 時自動刷新 | ✅ 已部署 |
| 前兩頁關鍵詞整理 | `firstTwoPageQueries` 由 90 天 GSC 查詢詞自動篩出平均排名 ≤ 20 的詞 | ✅ 已加入 SEO 後台 |

---

## SEO 優化歷史紀錄

### 2026-04-29 — SEO 後台新增「前兩頁可見關鍵詞」與 push 後自動刷新

**問題 / 目標**：
需要快速確認哪些查詢詞已在 Google Search Console 中產生曝光，且平均排名落在搜尋結果前兩頁（1-20 名），並讓 SEO 後台直接呈現，避免每次都人工翻 GSC 原始表格。

**執行項目**：

1. **`scripts/gsc-snapshot.js` 新增 `firstTwoPageQueries`**
   - 從 90 天 `query` 維度資料中篩選 `position > 0 && position <= 20`
   - 依平均排名升冪、曝光降冪排序
   - 加上 `pageBucket`：`page1` 代表 1-10 名、`page2` 代表 10.1-20 名

2. **`/admin/seo` 新增「前兩頁可見關鍵詞（90 天）」區塊**
   - 優先讀取 snapshot 內的 `firstTwoPageQueries`
   - 若舊 snapshot 尚未有新欄位，前端會從既有 `queries` 即時計算 fallback
   - 表格顯示查詢詞、頁次、曝光、點擊、CTR、平均排名
   - 補充說明：這是 GSC 平均排名，不等於每次手動搜尋固定位置

3. **`gsc-snapshot.yml` 增加 path-limited push trigger**
   - 當 SEO 後台或 snapshot 腳本變更並 push 到 `main`，會自動跑一次 GSC snapshot
   - 仍保留原本每日 11:00 排程與手動 workflow_dispatch
   - 不在本機輸出 OAuth token，改由 GitHub Secret `GCP_SERVICE_ACCOUNT_JSON` 安全執行

**查核限制**：
- 本機沒有 `GCP_SERVICE_ACCOUNT_JSON`，GitHub CLI 也未登入，因此不直接從本機刷新 Firestore。
- 公開搜尋結果會受搜尋引擎、地區、個人化影響，不適合直接寫進後台；後台仍以 GSC API 為準。
- 這次 push 後 GitHub Actions 會用既有 Secret 自動寫入最新 `seoSnapshots`。

### 2026-04-28 — football-taichung.html 強化：新增「9 大場地快速對照表」+ 強化長尾關鍵字密度

**問題 / 目標**：
「台中足球」是高競爭關鍵字、5 年老 SEO 對手已穩坐前 10 名。正面對決短期難勝出。需用「長尾包圍」戰術——強化既有 `football-taichung.html` 在「街區級長尾詞」（西屯/南屯/北屯/太平/沙鹿）、「等級分類長尾」（新手/業餘/進階）、「收費分類長尾」（免費/$100-$200/$200-$400）的關鍵字密度與資訊結構。

同時、Google 對結構化資料（特別是表格）有偏好——可觸發 Featured Snippet（即「精選摘要」、出現在 SERP 第 0 位、CTR 比第 1 名還高）。

**執行項目**：

1. **新增 H3「9 大場地快速對照表」段落**（位於 H2「台中足球場地完整推薦」之內、既有 venue-grid 卡片之前）
   - 6 欄結構：場地名稱 / 區域 / 類型 / 收費／人 / 適合等級 / 核心特色
   - 9 個場地完整覆蓋（朝馬、台體大、台中都會公園、西屯室內五人制、北屯運動公園、太平運動公園、西屯足球場、南屯足球場園區、彰化三村）
   - 等級 tag 採視覺色塊（新手/業餘/進階/休閒/2027 啟用/免費）
   - 末段附「※ 收費為每人均攤估算」+ 內鏈到首頁「台中地區」篩選

2. **新增 H3「場地詳細介紹」**（既有 venue-grid 改作子標）
   - 階層：H2 → H3 對照表 → H3 詳細介紹
   - 結構更清楚、Google 易理解 hierarchy

3. **新增專屬 CSS 樣式**（避免破壞既有 venue-card 樣式）
   - `.venue-table-wrap`：橫向滾動 + iOS 觸控滑順
   - `.venue-table`：1px 細邊框 + 12px 圓角 + 雙色行底色（zebra striping）
   - `.vt-tag` 三色 tag（一般 teal / 新功能 amber / 免費 green）
   - 響應式 `min-width: 640px` 確保手機可滑動瀏覽

4. **sitemap.xml lastmod 更新**：`2026-04-22` → `2026-04-28`
   - 觸發 Google 重新爬取此頁
   - GitHub Actions 會在下次 push 後自動 ping Google Search Console（既有 `submit-sitemap.yml`）

**關鍵 SEO 設計決策**：

- **為什麼用 HTML table 而不是 div grid**：Google 爬蟲對 `<table>` 結構解析最深入、有機會觸發 Featured Snippet（精選摘要、SERP 第 0 位）。div + grid 是 visual approach、SEO 弱
- **為什麼放在 venue-grid 之前**：用戶滑入 H2 後先看到「快速對照」、想看細節再往下看 cards。SEO 上 Google 也會優先抓「上方資訊」當摘要
- **為什麼 H3 而非 H2**：對照表是「台中足球場地完整推薦」H2 的子內容、應為 H3。多個 H2 會稀釋主題權重
- **為什麼 9 行不是 10 行**：保持載入快速 + 不過度膨脹頁面。9 個場地已涵蓋 5 個區（西屯/南屯/北屯/太平/沙鹿）+ 1 個跨縣（彰化）+ 一個未來地標（南屯園區 2027）
- **為什麼 vt-tag 用顏色區分**：視覺辨識增加用戶停留時間（Google 看 dwell time 判斷頁面品質）。3 色設計：teal 為主、amber 強調未來、green 強調免費

**長尾關鍵字密度提升**（grep 計數）：
- 街區關鍵字（西屯/南屯/北屯/太平/沙鹿/豐原）：頁內提及從 ~25 → **36 次**（+44%）
- 等級分類詞（新手/業餘/進階/休閒）：表內每一行都帶 tag、自然分布
- 價格區間（免費/$100-$200/$200-$400）：明確列出、命中「台中免費足球」「台中便宜踢球」等長尾

**預期 SEO 效益**：

- **3-7 天內**：Google 重新爬取（sitemap lastmod 更新觸發）
- **2-4 週內**：街區級長尾（西屯足球、南屯足球等）排名提升 5-10 位
- **2-3 個月內**：可能出現 Featured Snippet（針對「台中足球場推薦」「台中各區足球場」等對照型查詢）
- **長期**：「台中足球揪團」整體權重提升、為衝刺主關鍵字「台中足球」鋪路

**驗收方式**：
- HTML tag 配對檢查：`<table>` `<tr>` `<td>` 完整、`<div>` 平衡 ✅
- 表格內容語意正確：6 欄 × 9 行 × 54 個 td、無漏列 ✅
- 響應式測試：min-width 640px、手機可橫向滑動 ✅
- 既有 venue-grid 卡片保留：階層調整為 H3、不刪內容 ✅
- 與 nantun-football-park.html 子頁交叉連結保留 ✅

**下次優化點（待後續執行）**：
1. 強化「台中各區足球場」對應的個別頁面（`football-xitun.html` / `football-nantun.html` / `football-beitun.html` 等街區獨立頁）
2. 新增動態活動聚合頁（`/events/taichung-football-this-weekend.html`）配合 Event schema markup
3. 申請 Google Business Profile + Google Maps 標記（本地 SEO）
4. 反向連結建設（PTT Soccer 板、Dcard 台中版、巴哈姆特運動板）

---

### 2026-04-28 — 建立 /blog/ 運動百科區 + 第一篇「足球鞋挑選完整百科」

**問題 / 目標**：
既有 `/seo/*` 著陸頁主打「揪團報名 × 地區 × 運動類別」服務型 SEO，但欠缺「知識型內容」（運動規則、裝備推薦、新手指南）。知識型內容對應的搜尋意圖（informational query）流量大、競爭較小，且能補強品牌實體權威（E-E-A-T 中的 Expertise）。建立獨立 `/blog/` 區，第一篇從高搜尋量的「足球鞋挑選」切入。

**執行項目**：

1. **建立 `/blog/` 區與第一篇文章**
   - `blog/index.html`：部落格首頁（Blog schema、文章列表、卡片式 hover 互動、全 responsive）
   - `blog/football-shoes-guide.html`：第一篇足球鞋挑選百科（約 4,000 字、5 個 SVG 鞋底示意圖、3 個對照表、5 張品牌卡、6 組 FAQ）
   - 沿用既有 `seo/*` 樣式語彙（teal 主色、相同 hero / cta-box / en-section 結構）保持品牌一致性

2. **第一篇文章 SEO 設計**
   - title 含主關鍵字 + 全部 5 個鞋種縮寫（FG/AG/SG/TF/IC）
   - meta keywords 涵蓋 30+ 長尾詞（人工草足球鞋、室內足球鞋、五人制足球鞋、寬腳足球鞋、兒童足球鞋、Nike/Adidas/Puma/Mizuno/Asics）
   - 三層 JSON-LD：BreadcrumbList（3 層）+ Article（含 datePublished、author、publisher）+ FAQPage（6 組 Q&A）
   - 文章結構：10 個 H2 + 多個 H3（含 anchor id），符合 Featured Snippet 抓取格式
   - 5 個 inline SVG 鞋底圖示（FG / AG / SG / TF / IC）— 視覺化、無外部圖片依賴、檔案大小極小
   - 3 個資料對照表（5 鞋種快速對照、3 個預算分級卡、5 大品牌特色卡）
   - 內部連結：footer + 「延伸閱讀」指向 `/seo/football`、`/seo/football-taichung`、`/seo/nantun-football-park`
   - 英文 SEO 段落（Football Boots Buying Guide for Taiwan）

3. **手機窄屏排版（兩層 breakpoint）**
   - `@media(max-width:640px)`：標準手機調整（hero 字體、表格水平捲動、品牌卡改單欄、價格分級單欄、內距縮小）
   - `@media(max-width:400px)`：極窄屏特別處理（鞋底圖改垂直堆疊、SVG 縮小至 130px、字體再縮）
   - 表格水平捲動：`overflow-x:auto` + `-webkit-overflow-scrolling:touch`（iOS 觸控滑順）
   - 全頁面 viewport meta 正確設定

4. **路由與快取設定**
   - `_headers`：新增 `/blog/* → max-age=86400`（與 `/seo/*` 一致）
   - `sitemap.xml`：新增 `/blog/`（priority 0.7）+ `/blog/football-shoes-guide`（priority 0.75）
   - `index.html` noscript：新增「運動百科」區塊與兩個連結（首頁 + 足球鞋文）

**關鍵 SEO 設計決策**：

- **為什麼開 `/blog/` 而非 `/seo/` 內部新增**：兩者搜尋意圖不同。`/seo/` 是「找服務」（Buy 階段），`/blog/` 是「找知識」（Discover 階段）。分開 URL 結構幫助 Google 理解站台內容類型，也便於未來區分監控
- **為什麼足球鞋第一篇**：「足球鞋」單詞月搜尋量高（萬級）、長尾豐富（FG/AG/室內/寬腳/兒童 等），且與既有 football 系列頁形成 hub-and-spoke 內部連結
- **為什麼用 inline SVG 而非外部圖片**：(1) 不依賴圖片資源，無 broken image 風險；(2) 載入速度極快（< 1KB / 圖）；(3) 視覺一致（用 teal 主色），(4) 隨頁面被 Google 抓取為內容一部分
- **為什麼 article schema 而非 blogPosting**：兩者都可，Article 較通用且 Google 偏好。日後可視 SEO 數據再切換
- **為什麼不放廣告或 affiliate 連結**：第一階段純內容主導、累積信任度。日後如要加 affiliate 連結（迪卡儂、Nike 官網），須維持 NPOV 描述、且在頁面標註

**預期 SEO 效益**：

- **3-7 天內**：Google 重新爬取、`/blog/` 與 `/blog/football-shoes-guide` 進入索引（sitemap lastmod 更新 + GitHub Actions 自動提交）
- **2-4 週內**：「足球鞋 推薦」「FG AG 差別」「人工草 足球鞋」「室內足球鞋」等長尾關鍵字累積曝光
- **2-3 個月內**：FAQ schema 有機會觸發 SERP FAQ rich result（折疊 6 組問答）
- **長期**：建立內容權威，搜尋「足球」相關關鍵字時 ToosterX 同時佔據服務頁（/seo/football）+ 知識頁（/blog/football-shoes-guide）兩個位置

**驗收方式**：
- HTML 結構：JSON-LD 三段、Infobox-style 表格、SVG 5 個鞋底全部可顯示 ✅
- 手機窄屏（375px / 390px / 412px / 360px）：表格水平捲動、卡片單欄、SVG 不溢出 ✅
- 內部連結密度：4 個 outbound 內鏈到 /seo/* ✅
- robots / canonical / hreflang 配置 ✅
- 字數：4,000+ 字、足夠的內容深度 ✅

**下次優化點（待後續執行）**：
1. 第二篇文章主題候選：「籃球鞋挑選指南」或「羽球拍挑選完整指南」（同樣裝備類、覆蓋既有 /seo/* 涵蓋運動）
2. 規則類文章：「足球規則完整解析」「五人制足球規則 vs 11 人制差異」（informational 流量大）
3. 場地類文章：「全台足球場推薦地圖」「室內五人制場地大全」（與既有地區頁互補）
4. 評估是否啟用 affiliate 連結（迪卡儂、Nike 等）— 須先建立內容信任度
5. 待 1-2 週後檢視 GSC 數據（曝光、點擊、平均排名）決定下一篇主題

---

### 2026-04-28（續）— /blog/ 5 篇科普文章批次完成（籃球鞋 / 羽球拍 / 匹克球 / 跑鞋 / 登山鞋）

**問題 / 目標**：
延續上午建立的 `/blog/football-shoes-guide` 模板、批次擴充至 6 篇科普百科。覆蓋既有 `/seo/*` 已建立的所有運動類別（足球 + 籃球 + 羽球 + 匹克球 + 路跑 + 登山）、形成「服務頁（/seo/*） × 知識頁（/blog/*）」的雙層 SEO 網絡。每個運動同時佔據兩個 SERP 位置（揪團報名 + 裝備指南）。

**執行項目**：

1. **5 篇新文章建立**（每篇 4,000-5,000 字、沿用足球鞋 SEO 模板）
   - `blog/basketball-shoes-guide.html`：籃球鞋（高筒/中筒/低筒 + 5 大緩震技術 + 位置別 + 6 大品牌）
   - `blog/badminton-racket-guide.html`：羽球拍（拍框 + 平衡點 + 中桿硬度 + U 標 + 磅數 + 6 大品牌）
   - `blog/pickleball-complete-guide.html`：匹克球（規則 + Kitchen + 計分 + 場地 SVG + 戰術 + 6 大球拍品牌）
   - `blog/running-shoes-guide.html`：跑鞋（5 類跑鞋 + Drop + PEBA 碳板 + 距離適配 + 體重別 + 9 大品牌）
   - `blog/hiking-shoes-guide.html`：登山鞋（鞋筒高度 + GORE-TEX + Vibram + ABCD 級山 + 9 大品牌）

2. **每篇文章 SEO 設計（一致模板）**
   - title 含主關鍵字 + 鞋種 / 類型縮寫 + 「2026」+ 「ToosterX」
   - meta keywords 涵蓋 30-50 個長尾詞（含品牌名、技術名、規格詞）
   - 三層 JSON-LD：BreadcrumbList（3 層）+ Article（含 publisher / datePublished）+ FAQPage（6 組 Q&A、可觸發 SERP rich result）
   - 10-12 個 H2 + 多個 H3 anchor、TOC 目錄
   - 對照表 / 場地俯視圖的 inline SVG
   - 預算分級卡 + 主流品牌卡 + 試穿 / 保養章節
   - 兩層 mobile breakpoint（640px / 400px）：表格水平捲動、品牌卡單欄、SVG 垂直堆疊
   - en-section 英文 SEO 段落、針對國際 / 外國人查詢
   - 各篇互相 cross-link（footer + 「延伸閱讀」）

3. **內容差異化（避免機械複製）**
   - 籃球鞋：5 大緩震技術獨立解析（Air / Boost / Flow / NITROEDGE / 䨻）
   - 羽球拍：U 標重量分級表 + 磅數警告（業餘不要跟風職業選手 30+ 磅）
   - 匹克球：場地俯視 SVG（含 Kitchen 區黃色標示）+ 兩跳規則 + 雙打戰術
   - 跑鞋：步態 3 種類型解析 + Drop 落差表 + PEBA 碳板原理（Kipchoge 故事）
   - 登山鞋：台灣 ABCD 級山分級表 + 百岳路線推薦清單

4. **路由與索引更新**
   - 5 個新 URL 加入 `sitemap.xml`（priority 0.75）
   - `index.html` noscript：新增 5 個內鏈到「運動百科」區塊（共 7 個）
   - `blog/index.html`：placeholder 改為 6 個 post-card 文章卡片

**關鍵 SEO 設計決策**：

- **為什麼一次寫 5 篇而非分批**：(1) 共用同一 CSS 模板、開發效率高；(2) 同日推出形成「ToosterX 大型運動內容更新」事件、利於 GSC 索引優先；(3) 互相 cross-link 形成內部連結密集的「Hub-and-Spoke」結構
- **為什麼選裝備類為主軸**：(1) 裝備類關鍵字搜尋量大且持續、不像比賽時程性內容；(2) 與既有 `/seo/*` 揪團報名服務形成互補；(3) 內容門檻適中（需要專業但不需實證資料）
- **為什麼匹克球做完整入門指南而非純球拍**：(1) 匹克球在台灣仍屬新興運動、規則類搜尋量比裝備類大；(2) 涵蓋規則 + 場地 + 戰術可以同時擊中多種搜尋意圖
- **為什麼登山鞋包含 ABCD 級山分級表**：台灣登山界特有的分級系統、是山友交流的共通語言、可命中「百岳新手」「合歡北峰健行」「玉山裝備」等大量長尾詞
- **為什麼每篇都有 en-section**：台灣有大量外籍人士搜尋裝備（特別是登山與越野跑）、英文段落能擊中 expat 流量、且不影響中文 SEO

**預期 SEO 效益**：

- **3-7 天內**：6 個新 URL 全部進入 Google 索引（sitemap 自動提交、Crawler Hints 觸發）
- **2-4 週內**：「籃球鞋推薦」「羽球拍 Yonex Victor」「匹克球規則」「跑鞋 Drop」「登山鞋 Vibram」等 100+ 個長尾關鍵字累積曝光
- **1-3 個月內**：6 個 FAQ schema 各自有機會觸發 SERP FAQ rich result
- **長期**：每個運動同時佔據 SERP 服務頁 + 知識頁兩個位置、品牌實體權威度大幅提升

**統計**：
- 5 個新 HTML 檔、總計約 135 KB
- sitemap.xml 從 9 條 URL → 14 條
- index.html noscript 從 2 個 blog 連結 → 7 個
- blog/index.html 從 1 篇 placeholder → 6 篇 post-card
- 6 篇文章合計約 27,000 字

**下次優化點（待後續執行）**：
1. 評估第 7-12 篇主題：規則類（足球規則 / 籃球規則 / 羽球規則）、新手入門類（百岳新手 / 馬拉松訓練）、場地類（全台跑步路線地圖、室內五人制大全）
2. 評估啟用 affiliate 連結（迪卡儂、Nike、Yonex 等品牌）— 須先累積 2-4 週流量數據
3. 待 2 週後 GSC 看新增關鍵字曝光分布、決定下批內容主題
4. 考慮針對最有流量的 1-2 篇做更深入的子文章（例如「人工草足球鞋深度評測」「碳板跑鞋 PB 攻略」）

---

### 2026-04-28（再續）— /blog/ 新增「裝備類」與「規則類」二級分類頁

**問題 / 目標**：
6 篇文章已建立、但缺乏分類結構。Google 對分類頁（CollectionPage）的 SEO 評分高、且分類頁本身也是長尾關鍵字（「運動裝備推薦」「運動規則大全」）的入口。同時用戶體驗上、未來文章累積到 10+ 篇後若無分類、首頁會變成滾動式長列表、難以瀏覽。

**執行項目**：

1. **新建 2 個分類頁**
   - `blog/equipment/index.html`：裝備類（5 篇 — 足球鞋 / 籃球鞋 / 羽球拍 / 跑鞋 / 登山鞋）
   - `blog/rules/index.html`：規則類（1 篇 — 匹克球完整入門指南）
   - 兩頁皆含 `BreadcrumbList`（3 層）+ `CollectionPage`（含 hasPart 列出文章）JSON-LD
   - 視覺一致：沿用既有 hero / breadcrumbs / post-card 樣式

2. **主 `/blog/` 首頁加分類入口卡片**
   - 在 intro 與「最新文章」區塊間插入新區塊「分類瀏覽」
   - 2 個 category-card：齒輪 SVG（裝備類）+ 書本 SVG（規則類）
   - 含分類描述與「N 篇文章」徽章
   - hover 動畫（translateY + box-shadow）

3. **路由與索引更新**
   - `sitemap.xml`：新增 `/blog/equipment/` + `/blog/rules/`（priority 0.7）
   - `index.html` noscript：新增 2 個分類入口連結（運動百科區塊共 9 個）

4. **手機窄屏設計**
   - 分類卡片在 640px 以下改單欄、icon 縮至 48×48
   - 既有 post-card 兩層 breakpoint 不變

**關鍵 SEO 設計決策**：

- **為什麼用 CollectionPage 而非 ItemList**：CollectionPage 是 Google 對「文章合集型頁面」的標準 schema、與 BreadcrumbList 搭配時 SERP 顯示效果最佳
- **為什麼分類頁用獨立 URL（而非 hash 過濾）**：(1) 獨立 URL 才能被 Google 索引、累積 PageRank；(2) 分類本身也是長尾關鍵字、URL 含 `equipment` / `rules` 直接命中；(3) 未來分類擴充時不用重構
- **為什麼匹克球放規則類而非裝備類**：用戶決策。匹克球文章確實涵蓋「規則 + 場地 + 球拍 + 戰術」、但**規則內容的搜尋意圖最強**（pickleball 規則的搜尋量比 pickleball 球拍大）、放規則類能精準命中
- **為什麼用 SVG icon 而非 emoji**：(1) 符合 CLAUDE.md 「不在檔案中用 emoji」規範；(2) SVG 顏色與品牌 teal 一致；(3) SVG 解析度無限縮放、不依賴字體

**預期 SEO 效益**：

- **3-7 天**：2 個分類頁進入 Google 索引
- **2-4 週**：「運動裝備推薦」「運動鞋挑選」「運動規則大全」等分類層長尾關鍵字累積曝光
- **長期**：未來新增文章時、分類頁形成「Hub」結構、新文章一發布就有分類權重支援、加速索引與排名

**下次優化點（待後續執行）**：
1. 規則類目前僅 1 篇、待補足球 / 籃球 / 羽球規則文章後分類權重才會明顯提升
2. 考慮新增第 3 個分類「新手入門類」（百岳新手、馬拉松訓練、籃球新手等）
3. 考慮新增第 4 個分類「場地類」（全台場地地圖、場館推薦等）
4. 文章累積到 10+ 篇後、評估是否在分類頁內加篩選 / 排序功能

---

### 2026-04-28（第四批）— 規則類首篇：足球規則完整解析

**問題 / 目標**：
規則類分類僅 1 篇匹克球、需擴充。用戶決議從足球（既有裝備文章對應運動）開始。「足球規則」是高搜尋量主題、且台灣業餘玩家對越位、紅黃牌、5 人制 vs 11 人制差異常有疑問。本篇針對「業餘玩家視角」、把 17 條 FIFA 規則轉譯成實戰可用的指南。

**執行項目**：

1. **新建 `blog/football-rules.html`**（約 5,000 字）
   - 10 章節：5 分鐘秒懂版 / 場地器具 / 基本規則 / 越位詳解 / 犯規判罰 / VAR / 5 人制 vs 11 人制差異 / 業餘特殊規則 / 裁判手勢 / FAQ
   - 自製足球場俯視 SVG（含中圈、禁區、罰球點、角球弧、罰球弧）
   - 4 個 penalty-card（黃牌 / 紅牌 / 自由球 / 點球）含色彩 badge
   - 4 個對照表（5 分鐘秒懂、5 人制 vs 11 人制差異、越位定義等）
   - 三層 JSON-LD：BreadcrumbList（4 層、含「規則類」）+ Article + FAQPage（6 組）
   - 兩層 mobile breakpoint（640px / 400px）

2. **內容差異化**（避免機械抄 FIFA 規則書）
   - 開頭 2022 卡達世界盃 Mbappé / Messi 故事帶入
   - 越位章節用「業餘 80% 不吹越位」實用視角
   - 業餘特殊規則章節（撲球進門、滾球規定、女性加分等）
   - 裁判手勢與旗號逐一解讀（含 VAR 流程）
   - 中華民國足球協會、FIFA 官方規則書連結

3. **路由與索引更新**
   - `blog/rules/index.html`：placeholder 換成 2 篇 post-card（足球規則 + 匹克球）+ 更新 CollectionPage hasPart 為 2 篇 + 「本分類文章（2 篇）」
   - `blog/index.html`：分類卡片規則類數量「1 篇文章」→「2 篇文章」+ 文章列表新增 football-rules（位於 football-shoes-guide 之後、保持同運動聚集）
   - `sitemap.xml`：新增 `/blog/football-rules`（priority 0.75）
   - `index.html` noscript：新增 football-rules 連結（運動百科區塊共 10 個）

**關鍵 SEO 設計決策**：

- **為什麼放 football-shoes-guide 之後**：同運動聚集、形成「足球」專屬 cluster、Google 看到頁面間關聯性強（裝備 → 規則 → 揪團服務頁、3 層深度）
- **為什麼麵包屑 4 層（含規則類）**：強化規則類分類頁的內部連結權重、讓 Google 理解 hierarchy
- **為什麼開頭用世界盃故事**：規則類文章本身偏教科書、開頭故事性能降低 bounce rate（停留時間是 Google 重要排名訊號）
- **為什麼加業餘特殊規則章節**：FIFA 官方規則書沒有的本土資訊、是這篇的差異化價值、命中「業餘足球規則」「揪團規則」等台灣特有長尾詞

**預期 SEO 效益**：

- **3-7 天**：進入 Google 索引
- **2-4 週**：「越位規則」「足球規則」「五人制規則」「Futsal 規則」「VAR 規則」等 50+ 長尾關鍵字累積曝光
- **1-3 個月**：FAQ schema 觸發 SERP rich result 機率高（規則類問題明確、答案具體）
- **長期**：與 `football-shoes-guide` + `/seo/football` + `/seo/football-taichung` 形成「足球」主題 4 篇內容矩陣、品牌實體權威度集中

**下次優化點（待後續執行）**：
1. 籃球規則完整解析（接下來的規則類文章）
2. 羽球規則 + 雙打 / 單打差異
3. 跑步禮儀、馬拉松賽事規則
4. 登山倫理、無痕山林（LNT）原則

---

### 2026-04-28（第五批）— 規則類大批次完成 + 匹克球裝備補完（5 篇新文章）

**問題 / 目標**：
延續 2026-04-28（第四批）的足球規則策略、批次完成所有「有裝備類文章的運動」對應的規則類文章；同時補完匹克球裝備（先前匹克球只有規則類入門指南、缺裝備類深度球拍指南）。一次性完成所有運動的「裝備 × 規則」雙覆蓋、形成完整內容矩陣。

**執行項目**：

1. **新建 4 篇規則類文章**（每篇 4,500-5,500 字）
   - `blog/basketball-rules.html`：籃球規則（NBA / FIBA / 3x3 差異、24 秒、5/6 犯、4 種犯規類型、業餘鬥牛規則、含籃球場 SVG）
   - `blog/badminton-rules.html`：羽球規則（單打 / 雙打場地差異、BWF 2018 新發球規則 1.15m、Rally Scoring 21 分制、雙打輪換邏輯、含羽球場 SVG）
   - `blog/running-rules.html`：路跑賽事規則（賽事 8 階段流程、5K/10K/半馬/全馬差異、Wave 起跑分區、晶片計時、補給站禮儀、配速團、關門時間、業餘揪團夜跑禮儀）
   - `blog/hiking-rules.html`：登山倫理（LNT 七大原則、國家公園入山入園申請、山徑 ABCD 級分級、山屋規則、高山症預防處置、山難應變 5 步驟、新手友善百岳推薦）

2. **新建 1 篇裝備類文章**
   - `blog/pickleball-paddle-guide.html`：匹克球球拍（4 大材質 Wood / Composite / Graphite / Carbon Fiber、3 種形狀標準 / 加長 / 寬身、重量 Light / Medium / Heavy、3 種蜂巢芯 Polymer / Nomex / Aluminum、握把粗細、Edgeguard vs Edgeless、9 大品牌特色）

3. **每篇文章 SEO 設計（一致模板）**
   - 三層 JSON-LD：BreadcrumbList（4 層含分類）+ Article + FAQPage（6 組）
   - 兩層 mobile breakpoint（640px / 400px）
   - 5-10 個 H2 + TOC + 對照表 + 卡片式設計
   - en-section 英文 SEO 段落
   - 互相 cross-link（每篇連到對應運動的裝備文章 + 分類頁 + 揪團頁）

4. **內容深度差異化**
   - 籃球規則：4 種犯規卡（個人/技術/惡意/嚴重惡意）+ NBA vs FIBA 7 項差異對照表 + 3x3 規則完整 + 業餘鬥牛 vs 全場揪團規則
   - 羽球規則：BWF 2018 改革（1.15m 替代腰部判定）+ 雙打輪換邏輯（業餘最易搞錯）+ Fault vs Let 完整列表 + 場地俯視圖含發球區
   - 路跑規則：賽事 8 階段流程卡片 + 4 距離規則對照表（補給密度、關門時間）+ 補給站禮儀「該做 / 不該做」+ 配速團跟跑指南
   - 登山倫理：LNT 七大原則卡片化 + 國家公園入山申請流程 + ABCD 級山分級 + 高山症預防 + 山難 5 步驟應變
   - 匹克球球拍：4 種材質 SVG 視覺化 + 3 種形狀解析 + 3 種重量分級對照 + 蜂巢芯科普 + 9 大品牌特色

5. **路由與索引更新**
   - 6 個新 URL 加入 `sitemap.xml`（priority 0.75）
   - `index.html` noscript：新增 5 個內鏈到「運動百科」區塊（共 14 個）
   - `blog/index.html`：分類卡片裝備 5→6、規則 2→6、文章列表新增 5 篇（按運動聚集排序）
   - `blog/equipment/index.html`：5 篇 → 6 篇、CollectionPage hasPart 同步更新
   - `blog/rules/index.html`：2 篇 → 6 篇、CollectionPage hasPart 同步更新

**關鍵 SEO 設計決策**：

- **為什麼一次寫 5 篇而非分批**：(1) 形成「ToosterX 完整運動百科」事件、利於 GSC 索引優先；(2) 5 個運動同時擁有裝備 + 規則文章、形成完整內容矩陣（共 12 篇文章）；(3) 互相 cross-link 形成密集內部連結、提升 PageRank 分布
- **為什麼登山「規則」用倫理 + 安全守則包裝**：登山沒有競技規則、傳統「登山規則」搜尋意圖不強。改用「LNT 七大原則」「入山申請」「山難應變」「高山症」等實用搜尋意圖、命中「登山倫理」「無痕山林」「百岳新手」「LNT 七大原則」等大量長尾關鍵字
- **為什麼路跑「規則」用賽事禮儀包裝**：跑步本身無規則、但賽事流程、補給站禮儀、配速團使用、關門時間等是業餘跑者真實需求、命中「馬拉松規則」「補給站禮儀」「Wave 起跑」「配速團」等長尾
- **為什麼匹克球補球拍指南而非簡化既有文章**：既有匹克球完整入門指南篇幅長、分割出獨立球拍指南可命中「匹克球球拍」「Pickleball paddle」等裝備類長尾、且能放在裝備類分類加強分類權重
- **為什麼籃球規則含 3x3**：3x3 是 2020 起的奧運項目、與業餘半場鬥牛常被搞混、解析兩者差異是台灣讀者強需求

**預期 SEO 效益**：

- **3-7 天**：6 個新 URL 全部進入 Google 索引
- **2-4 週**：「籃球規則」「NBA FIBA 差異」「24 秒進攻時限」「羽球規則」「Rally Scoring」「馬拉松補給站」「LNT 七大原則」「高山症」「匹克球球拍」等 200+ 長尾累積曝光
- **1-3 個月**：6 個 FAQ schema 各自有機會觸發 SERP rich result
- **長期**：5 個運動形成完整「裝備 × 規則」矩陣（12 篇文章）、品牌實體權威度大幅提升、為 Google 建立「ToosterX = 運動完整百科」的權威認知

**統計**：
- 5 個新 HTML 檔、約 130 KB
- sitemap.xml 從 14 條 URL → 20 條
- index.html noscript 從 9 個 blog 連結 → 14 個
- blog/index.html 從 7 篇 post-card → 12 篇
- 5 篇文章合計約 25,000 字、總計 12 篇文章合計約 55,000 字

**下次優化點（待後續執行）**：
1. 第 13 篇起的主題候選：足球教學（基本動作 / 戰術）、籃球教學、羽球教學、馬拉松訓練計畫、百岳新手挑戰指南
2. 場地類文章（全台跑步路線地圖、室內五人制大全、台中籃球場推薦等）
3. 評估啟用 affiliate 連結（迪卡儂、Nike、Yonex、Selkirk 等）— 已累積 12 篇基礎
4. 待 2 週後 GSC 看新增關鍵字曝光、決定下批內容主題
5. 考慮針對最有流量的 1-2 篇做更深入的子文章（例如「FG 足球鞋深度評測」「Asics Kayano 跑鞋實測」）

---

### 2026-04-24 — 追認：GCP Service Account 已設定完成、sitemap 自動提交全自動運轉中

**問題 / 背景**：
2026-04-02 的「自動化建設」紀錄中 sitemap 自動提交狀態寫「待使用者設定 GCP Service Account」、歷次 SEO log 更新也延續此記載。2026-04-24 階段 B push 後、檢查 GitHub Actions `submit-sitemap.yml` workflow 發現：

**實際狀況**：✅ **早就設好了、而且每次 push 都自動提交成功**

**佐證**：
- GitHub Actions 執行紀錄近 10 次（2026-04-23 起）全部 `success`、平均執行 8-12 秒
- 最新一次執行（2026-04-24 05:58:48 UTC、對應 commit `e93b167c` 階段 B SEO 優化）log 顯示：
  ```
  ✓ 從環境變數讀取 Service Account
    Email: sitemap-submitter@toosterx-seo.iam.gserviceaccount.com
    Site:  sc-domain:toosterx.com
    Map:   https://toosterx.com/sitemap.xml
  → 取得 OAuth Access Token...
  ✓ Token 取得成功
  → 提交 sitemap 給 Google Search Console...
  ✓ Sitemap 提交成功！Google 將重新爬取 sitemap.xml
  ```

**完整自動化流程（已運作）**：
```
push commit（含 seo/** 或 sitemap.xml 變更）
  ↓
GitHub Actions: .github/workflows/submit-sitemap.yml 觸發
  ↓
env: GCP_SERVICE_ACCOUNT_JSON ← GitHub Secret 注入
  ↓
node scripts/submit-sitemap.js
  ↓
Service Account JWT → OAuth 2.0 Token（scope: webmasters）
  ↓
PUT https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Atoosterx.com/sitemaps/...
  ↓
Google Search Console 收到更新通知、排隊重爬 sitemap.xml ✅
```

**更新項目**：
- §目前 SEO 架構總覽「自動化機制」表格：狀態改 ✅ + 新增 Service Account email 列 + 新增成功率列
- §2026-04-02 SEO 自動化建設段落：狀態「待使用者設定」→「✅ 已設定完成並運作中」
- §待辦 / 未來優化方向：勾選掉「GCP Service Account 設定完成」與「GSC 手動提交新 URL 索引」兩項（後者於 2026-04-24 由用戶手動戳完）

**意義**：
- 不用再跟用戶說「需要手動去 GSC 按要求索引」——sitemap 提交已自動化
- 之後每次 SEO 變更 push 出去、Google 會被自動通知
- 唯一還需要「手動戳」的場景是：某頁內容有重大變更、想跳過 sitemap 隊列直接要求索引優先處理（URL Inspection → Request Indexing）

**教訓**：
- 舊紀錄狀態若非最新、不會自己更新——定期審閱時應交叉驗證實際運作狀況（GitHub Actions run list、CF dashboard）
- 「待辦事項」可能實際早已完成、但因未主動追認而停留在「待辦」狀態

### 2026-04-23 — 階段 B：「南屯足球場」口語詞密度強化（對應既有 nantun-football-park.html）

**問題 / 目標**：
既有 `nantun-football-park.html`（2026-04-02 建）主要用正式名「南屯足球園區」（22 次）、口語變體「南屯足球場」只在 meta keywords 出現 1 次。Google 搜索「南屯足球場」時命中力不足。階段 B 目標：將口語詞均勻分布到 title / meta / H1 / H2 / H3 / body / JSON-LD、做到「完美 SEO 對稱覆蓋」。

**執行項目**：

1. **title 重構**（原把正式名放前面、改把口語搜尋詞放前面）
   - 原：`南屯足球園區｜台中國際足球運動休閒園區 2027 啟用、場地規格、交通指南 — ToosterX`
   - 新：`南屯足球場｜南屯足球園區完整指南・AFC 認證國際場館・2027 啟用 — ToosterX`

2. **meta description 擴充**（把「南屯足球場」放前半）

3. **meta keywords 擴充**：新增 `台中足球場預約`、`台中足球場租借`、`南屯足球場收費`、`南屯足球場啟用`、`南屯足球場在哪`、`Nantun football stadium`（共 6 個新長尾詞）

4. **og:title / og:description 同步更新**

5. **H1 加入雙標**：`南屯足球場（南屯足球園區）<br>台中國際足球運動休閒園區完整指南`

6. **新增 H2「「南屯足球場」vs「南屯足球園區」：同一座場地、不同叫法」**
   - 做 semantic clustering：明確告訴 Google「南屯足球場、南屯足球園區、台中國際足球園區、台中足球場、龍富九路足球場、益豐路足球場、單元五足球場」都是同義詞
   - 加入 tip-box 做快速記憶提示

7. **新增 H2「南屯足球場常見問題（Q&A）」** — 8 題全使用口語詞
   - 南屯足球場在哪裡？
   - 南屯足球場什麼時候啟用？
   - 南屯足球場可以租嗎？收費多少？
   - 南屯足球場有停車場嗎？
   - 南屯足球場適合小朋友踢球嗎？
   - 南屯足球場有哪些球場？
   - 南屯足球場跟朝馬足球場差在哪？
   - 南屯足球場有遮棚嗎？下雨怎麼辦？
   - 原有「常見問題」區塊改為 `延伸閱讀（進階資訊）`、內文保留用「南屯足球園區」、避免同詞互搶

8. **FAQPage JSON-LD 擴充**：新增上述 8 題到 mainEntity.FAQPage、Google Rich Results 會顯示這些 FAQ

9. **SportsActivityLocation.alternateName 擴充**：加入「南屯足球場」、「台中足球場」、「台中足球園區」、「龍富九路足球場」、「益豐路足球場」、「單元五足球場」、「Nantun Football Stadium」共 7 個變體

10. **football-taichung.html 錨文本更新**：卡片標題從「南屯足球園區」→「南屯足球場 / 南屯足球園區」；連結 anchor text 改為「南屯足球場完整介紹（南屯足球園區）」

11. **sitemap.xml** lastmod 2026-04-22 → 2026-04-23（觸發 Google 重爬）、priority 0.75 → 0.85（重要性提升）

**關鍵決策**：
- **為什麼不新開獨立頁 `nantun-football-stadium.html`**：會稀釋主頁權重（同站兩頁競爭同關鍵字 = Google 分不清哪個才是主頁）。改用「單頁多詞」策略、一頁涵蓋所有變體
- **既有「常見問題」 → 「延伸閱讀」**：讓新 H2「南屯足球場常見問題」獨占標準問答結構、新 FAQ 全走口語詞。既有問題保留原正式名、維持語意完整
- **meta keywords 保留擴充**：Google 對 keywords 已降權但非零、且 Bing / 其他爬蟲仍讀取、低成本高報酬
- **sitemap priority 提升**：頁面內容深度大幅擴充後、值得提升重要性讓爬蟲優先
- **H1 保留括號雙標而非斜線**：「南屯足球場（南屯足球園區）」比「南屯足球場 / 南屯足球園區」語意更清楚、H1 裡語意 > 視覺對稱

**預期效益**：
- 「南屯足球場」關鍵字在頁面出現次數：1 → 30+（含 H1/H2/H3/body/FAQ/alternateName）
- FAQ Rich Result：原 5 題 → 新增 8 題（雙倍顯示機會）
- 搜尋意圖覆蓋：正式名查詢 + 口語查詢 + 地標式查詢（龍富九路 / 益豐路 / 單元五）

**改動統計**：
- 修改 3 檔（seo/nantun-football-park.html、seo/football-taichung.html、sitemap.xml）
- nantun-football-park.html: 364 → 479 行
- 獨立 SEO 頁不走主站版號系統

---

### 2026-04-22 — 階段 5：P1 優化 #7-10（sitemap + llms.txt + Lighthouse 基準）

**目標**：執行 P1 清單第 7-10 項，取得 Lighthouse 基準數據。

**執行項目**：

1. **#10 sitemap priority 精細化**
   - 原：所有 URL 統一 priority 0.8
   - 新：按流量潛力分層（1.0 → 0.9 → 0.8 → 0.75 → 0.7 → 0.6 → 0.3）
   - 幫助 Google 判斷優先爬取順序

2. **#9 llms.txt 擴充**（34 → 143 行）
   - 新增「主要內容頁」13 個 URL 給 AI 爬蟲導航
   - 擴充運動項目（10 → 20+ 種，含匹克球、美式躲避球、自行車等）
   - 新增地區覆蓋清單（北中南東 + 具體鄉鎮）
   - 新增中英文關鍵字列表
   - 新增「AI 爬蟲備註」鼓勵 ChatGPT/Claude/Perplexity 引用
   - 補 GitHub repo、LINE Mini App 完整 URL

3. **#8 image sitemap 擴充**
   - 首頁新增第二個 image:image（icon-512x512.png ToosterX Logo）
   - og.png 加 image:caption 增強語意
   - 其他 SEO 頁無獨特圖片素材（純 CSS hero），暫不加

4. **#7 Lighthouse CI 基準數據（首次跑）**

   **SEO 著陸頁成績（頂尖）**：
   | 頁面 | Performance | A11y | BP | SEO |
   | --- | --- | --- | --- | --- |
   | basketball | 100 | 82 | 96 | 100 |
   | pickleball | 100 | 82 | 96 | 100 |
   | dodgeball | 100 | 89 | 96 | 100 |
   | running | 100 | 80 | 96 | 100 |
   | hiking | 100 | 80 | 96 | 100 |
   | football-taichung | 100 | 80 | 96 | 100 |
   | sports-changhua | 100 | 82 | 96 | 100 |
   | sports-nantou | 100 | 82 | 96 | 100 |
   | football | 99 | 80 | 96 | 100 |

   **首頁異常**：測得 53/85/75/54 分數 — 實際是 LINE login 頁分數
   - 根因：Lighthouse 的 headless Chrome 進首頁後，LIFF SDK 判定非 LINE 環境、強制 OAuth
   - 實際 URL：`https://access.line.me/oauth2/v2.1/login?...`
   - 不是首頁本身的 SEO 問題（GSC 顯示首頁 indexed 排名 2.3 CTR 44.7%）
   - Googlebot 有機制繞過（檢測到 bot UA 會跳過 OAuth）
   - 若要精確測首頁 Lighthouse，需修 workflow（加 UA 或 skip LIFF redirect）

**關鍵決策**：
- **sitemap priority 分層原則**：熱門運動 > 次熱門 > 地區 × 運動 > 地區綜合 > 政策頁
- **llms.txt 定位**：不只是 AI 爬蟲指引，也是「網站核心內容索引」— 讓 ChatGPT/Claude 能正確引用
- **首頁 Lighthouse 問題不修 code**：LIFF OAuth 是 LINE Mini App 正常設計；要修應修 workflow 不是首頁

**改進方向（未來可做）**：
- Accessibility 80 → 95：補 aria-label、色彩對比度、h2/h3 階層修正
- 首頁 Lighthouse：workflow 加 chromeFlags UA 模擬 Googlebot

**改動統計**：
- 修改 2 檔（sitemap.xml 重寫分層、llms.txt 重寫擴充）
- 產出 10 份 Lighthouse 基準報告（temporary storage 可查）
- Commit `58cc0c56`

---

### 2026-04-22 — 階段 4：P0 優化 5 項完成

**目標**：執行 18 項 SEO 優化清單中的 P0 部分（立即可做、低風險、高回報）。

**執行項目**：

1. **既有 6 個 SEO 頁 meta description 縮短**（解決階段 2 遺留問題）
   - football.html: 120 → 66 chars
   - running.html: 96 → 65 chars
   - hiking.html: 102 → 68 chars
   - pickleball.html: 113 → 69 chars
   - football-taichung.html: 86 → 69 chars
   - nantun-football-park.html: 154 → 86 chars
   - 目標：Google SERP 不被截斷（建議 50-160 chars，中文密度高所以 60-80 最佳）
   - 執行：Node.js 批次替換（明確 UTF-8 編碼，符合 CLAUDE.md 規範）

2. **football-taichung Events schema FAIL**（GSC 回報）
   - 檢查結果：實際檔案已無 SportsEvent / Event schema 殘留
   - GSC 顯示的 Events schema FAIL 是舊快取（Google Last crawled: 2026-04-04）
   - 無需修改 code，等 Google 重新爬取新 clean URL（已改 canonical）後會自動通過

3. **Organization sameAs 從空陣列填入官方連結**
   - 原：`"sameAs": []`
   - 新：`["https://miniapp.line.me/2009525300-AuPGQ0sh", "https://github.com/msw2004727/FC"]`
   - 效果：Google Knowledge Graph 可關聯 ToosterX 到 LINE Mini App 和 GitHub repo
   - 後續可補：FB 專頁、IG、LINE OA、YouTube 等（待用戶提供）

4. **首頁新增 WebSite schema**（取代原本規劃的首頁 BreadcrumbList — 首頁無 breadcrumb 意義）
   - 加入 @graph 陣列第 3 個 entity
   - 含 name / alternateName / url / inLanguage / publisher
   - 無 SearchAction（ToosterX 搜尋是 SPA hash route，非 URL param 格式）
   - 效果：幫助 Google 正確識別網站實體、改善 Knowledge Graph

5. **404.html 自訂錯誤頁**
   - Cloudflare Pages 自動偵測 repo root 的 404.html 作為錯誤頁
   - 設計：毛玻璃風格、ToosterX 主色系（#0d9488）、noindex meta
   - 包含「回到首頁」+「瀏覽所有活動」兩個行動按鈕
   - 避免用戶遇到 404 時離開網站（SEO bounce rate 降低）

**關鍵決策**：
- **為什麼首頁不加 BreadcrumbList**：首頁是 root，breadcrumb 從 root 到當前頁，首頁自己沒 path。Google Rich Results 規範也不建議首頁使用 BreadcrumbList。改用 WebSite schema 更有意義
- **Events schema 不改 code**：實際內容已正確，等 Google 重爬即可。若手動改會打斷正在進行的 clean URL 索引流程
- **sameAs 只填兩個已知連結**：不強塞、不捏造。缺的社群連結等用戶提供再補
- **404 頁用 Cloudflare 約定**：Cloudflare Pages 慣例是 repo root 的 404.html 自動成為錯誤頁，不需 `_redirects` 設定

**改動統計**：
- 修改 7 檔（6 個 seo/*.html + index.html）
- 新增 1 檔（404.html）
- 版號：0.20260422b → 0.20260422c

---

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
   - 狀態：✅ 已設定完成並運作中（2026-04-24 追認）
     · Service Account: `sitemap-submitter@toosterx-seo.iam.gserviceaccount.com`
     · GitHub Secret `GCP_SERVICE_ACCOUNT_JSON` 已注入
     · 每次符合條件的 push 自動觸發、近 10 次全 success、執行時間 8-12 秒
     · 詳見 2026-04-24 紀錄

3. **Google Indexing API 評估結果：不可用**
   - 原因：僅支援 `JobPosting` 和 `BroadcastEvent` 類型
   - 風險：用於不支援的內容可能導致流量永久下降
   - 決策：放棄此方案

---

## 待辦 / 未來優化方向

- [x] ✅ GCP Service Account 設定完成、sitemap 自動提交運作中（2026-04-24 追認、每次 push 全 success）
- [x] ✅ GSC 手動提交新 URL 索引（football-taichung、nantun-football-park — 2026-04-24 完成）
- [x] ✅ 建立 404.html 友善錯誤頁面（已完成）
- [ ] 觀察 GSC 數據，確認「台中踢球」、「南屯足球場」等關鍵字開始有曝光（1-2 週後檢視）
- [ ] 為 SEO 著陸頁製作專屬 OG 分享圖（目前都用 app icon）
- [ ] 考慮擴增更多運動著陸頁（籃球、羽球、排球）
- [ ] 考慮更多城市專頁（台北足球、高雄足球）
- [ ] 建立外部反向連結（足球社群、場地方網站）— 階段 B 後排名關鍵
- [ ] 評估是否需要 Dynamic Rendering 讓 SPA 內容可被爬取
