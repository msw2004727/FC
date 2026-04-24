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
