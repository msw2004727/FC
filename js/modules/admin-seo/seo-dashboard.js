/* ================================================
   SEO Dashboard — Main Renderer
   ================================================
   渲染 /admin/seo 頁面的各區塊：總覽、趨勢圖、頁面表、索引狀態等
   ================================================ */

Object.assign(App, {

  async renderSeoDashboard() {
    const container = document.getElementById('seo-dashboard-content');
    if (!container) return;

    // 權限守衛
    if (!this.hasPermission?.('admin.seo.entry') && !this.hasPermission?.('admin.dashboard.entry')) {
      const role = this.currentUser?.role;
      const isOwnerRole = (role === 'admin' || role === 'super_admin');
      if (!isOwnerRole) {
        container.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted)">權限不足，請聯絡 super_admin</div>';
        return;
      }
    }

    container.innerHTML = '<div class="seo-loading">載入中…</div>';

    this._seoInvalidateCache();
    const snapshot = await this._loadLatestSeoSnapshot();
    if (!snapshot) {
      container.innerHTML = `
        <div class="seo-empty">
          <h3>尚無 SEO 資料</h3>
          <p>GitHub Actions 每日 11:00（台北）自動抓取。首次建立後請稍後再試。</p>
          <p style="margin-top:1rem;font-size:.85rem;color:var(--text-muted)">若要立即抓取，請到 <a href="https://github.com/msw2004727/FC/actions/workflows/gsc-snapshot.yml" target="_blank" rel="noopener">GitHub Actions</a> 手動觸發「GSC Daily Snapshot」。</p>
        </div>`;
      return;
    }

    const history = await this._loadSeoHistory(30);
    container.innerHTML = this._seoDashboardHTML(snapshot, history);
  },

  _seoDashboardHTML(s, history) {
    const genAt = s.generatedAt?.toDate ? s.generatedAt.toDate() : (s.generatedAt ? new Date(s.generatedAt) : null);
    const genStr = genAt ? `${genAt.toLocaleString('zh-TW', { hour12: false })}` : '';
    const info = (type) => `<button class="seo-info-btn" type="button" onclick="App._showSeoInfoPopup?.('${type}')" title="說明" aria-label="說明">?</button>`;

    return `
      <div class="seo-meta-bar">
        <span>📅 資料日期：<strong>${this._esc(s.id || 'N/A')}</strong></span>
        <span>🕒 產出時間：<strong>${this._esc(genStr)}</strong></span>
        <span>📊 站點：<strong>${this._esc(s.siteUrl || 'toosterx.com')}</strong></span>
        ${info('meta')}
      </div>

      ${this._seoOverviewHTML(s.overview, info)}

      ${this._seoDailyTrendHTML(s.daily, info)}

      <div class="seo-section">
        <h3>📄 頁面表現（過去 28 天）${info('pages')}</h3>
        ${this._seoPagesTableHTML(s.pages)}
      </div>

      <div class="seo-grid-2">
        <div class="seo-section">
          <h3>📱 裝置分布 ${info('devices')}</h3>
          ${this._seoDevicesHTML(s.devices)}
        </div>
        <div class="seo-section">
          <h3>🌏 國家分布（Top 10）${info('countries')}</h3>
          ${this._seoCountriesHTML(s.countries)}
        </div>
      </div>

      <div class="seo-section">
        <h3>🔍 搜尋類型分布（90 天）${info('typeBreakdown')}</h3>
        ${this._seoTypeBreakdownHTML(s.typeBreakdown)}
      </div>

      <div class="seo-section">
        <h3>🔎 熱門搜尋詞（90 天）${info('queries')}</h3>
        ${this._seoQueriesHTML(s.queries)}
      </div>

      <div class="seo-section">
        <h3>📋 Sitemap 狀態 ${info('sitemap')}</h3>
        ${this._seoSitemapHTML(s.sitemaps)}
      </div>

      <div class="seo-section">
        <h3>🔗 URL 索引狀態（${s.indexedCount || 0}/${s.totalInspected || 0} 已索引）${info('urlStatus')}</h3>
        ${this._seoUrlStatusHTML(s.urlStatus)}
      </div>

      <div class="seo-footer-note">
        <p>💡 資料來源：Google Search Console API，每日自動更新。</p>
        <p>⚠️ 此頁資料為商業敏感資訊，請勿對外截圖或分享。</p>
      </div>
    `;
  },

  _seoOverviewHTML(overview, info) {
    if (!overview) return '';
    const ranges = [
      { label: '7 天', d: overview.last7 },
      { label: '28 天', d: overview.last28 },
      { label: '90 天', d: overview.last90 },
    ];
    const btn = info ? info('overview') : '';
    return `
      <div class="seo-section">
        <h3>📊 總覽 ${btn}</h3>
        <div class="seo-overview-grid">
          ${ranges.map(r => `
            <div class="seo-overview-card">
              <div class="seo-overview-label">${r.label}</div>
              <div class="seo-overview-metrics">
                <div><span>曝光</span><strong>${this._fmtNum(r.d?.impressions)}</strong></div>
                <div><span>點擊</span><strong>${this._fmtNum(r.d?.clicks)}</strong></div>
                <div><span>CTR</span><strong>${this._fmtPct(r.d?.ctr)}</strong></div>
                <div><span>排名</span><strong>${this._fmtPos(r.d?.position)}</strong></div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  },

  _seoDailyTrendHTML(daily, info) {
    if (!Array.isArray(daily) || !daily.length) return '';
    const btn = info ? info('daily') : '';
    // daily 是當日 snapshot 中的 30 天每日序列
    const max = Math.max(...daily.map(d => d.impressions || 0), 1);
    const bars = daily.map(d => {
      const h = Math.round((d.impressions || 0) / max * 100);
      const clicks = d.clicks || 0;
      return `
        <div class="seo-bar-col" title="${d.date}: 曝 ${d.impressions} / 點 ${clicks}">
          <div class="seo-bar" style="height:${h}%">${clicks > 0 ? `<span class="seo-bar-click">${clicks}</span>` : ''}</div>
          <div class="seo-bar-label">${d.date.slice(5)}</div>
        </div>
      `;
    }).join('');
    return `
      <div class="seo-section">
        <h3>📈 每日曝光時序（30 天）${btn}</h3>
        <div class="seo-bar-chart">${bars}</div>
      </div>
    `;
  },

  _seoPagesTableHTML(pages) {
    if (!Array.isArray(pages) || !pages.length) return '<p class="seo-empty-note">無資料</p>';
    return `
      <table class="seo-table">
        <thead><tr><th>URL</th><th>曝光</th><th>點擊</th><th>CTR</th><th>排名</th></tr></thead>
        <tbody>
          ${pages.slice(0, 30).map(p => `
            <tr>
              <td class="seo-url-cell" title="${this._esc(p.page)}">${this._esc((p.page || '').replace('https://toosterx.com', '') || '/')}</td>
              <td>${this._fmtNum(p.impressions)}</td>
              <td>${this._fmtNum(p.clicks)}</td>
              <td>${this._fmtPct(p.ctr)}</td>
              <td>${this._fmtPos(p.position)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  },

  _seoDevicesHTML(devices) {
    if (!Array.isArray(devices) || !devices.length) return '<p class="seo-empty-note">無資料</p>';
    return `
      <table class="seo-table">
        <thead><tr><th>裝置</th><th>曝光</th><th>點擊</th><th>CTR</th></tr></thead>
        <tbody>
          ${devices.map(d => `
            <tr><td>${this._esc(d.device)}</td><td>${this._fmtNum(d.impressions)}</td><td>${this._fmtNum(d.clicks)}</td><td>${this._fmtPct(d.ctr)}</td></tr>
          `).join('')}
        </tbody>
      </table>
    `;
  },

  _seoCountriesHTML(countries) {
    if (!Array.isArray(countries) || !countries.length) return '<p class="seo-empty-note">無資料</p>';
    return `
      <table class="seo-table">
        <thead><tr><th>國家</th><th>曝光</th><th>點擊</th></tr></thead>
        <tbody>
          ${countries.slice(0, 10).map(c => `
            <tr><td>${this._esc(c.country.toUpperCase())}</td><td>${this._fmtNum(c.impressions)}</td><td>${this._fmtNum(c.clicks)}</td></tr>
          `).join('')}
        </tbody>
      </table>
    `;
  },

  _seoTypeBreakdownHTML(tb) {
    if (!tb) return '<p class="seo-empty-note">無資料</p>';
    const keys = ['web', 'image', 'video', 'news', 'discover'];
    return `
      <table class="seo-table">
        <thead><tr><th>類型</th><th>曝光</th><th>點擊</th><th>CTR</th></tr></thead>
        <tbody>
          ${keys.map(k => {
            const r = tb[k] || {};
            return `<tr><td>${k.toUpperCase()}</td><td>${this._fmtNum(r.impressions)}</td><td>${this._fmtNum(r.clicks)}</td><td>${this._fmtPct(r.ctr)}</td></tr>`;
          }).join('')}
        </tbody>
      </table>
    `;
  },

  _seoQueriesHTML(queries) {
    if (!Array.isArray(queries) || !queries.length) {
      return '<p class="seo-empty-note">無資料（GSC 對低曝光查詢詞有隱私門檻，需累積更多流量才會顯示）</p>';
    }
    return `
      <table class="seo-table">
        <thead><tr><th>查詢</th><th>曝光</th><th>點擊</th><th>CTR</th><th>排名</th></tr></thead>
        <tbody>
          ${queries.slice(0, 30).map(q => `
            <tr><td>${this._esc(q.query)}</td><td>${this._fmtNum(q.impressions)}</td><td>${this._fmtNum(q.clicks)}</td><td>${this._fmtPct(q.ctr)}</td><td>${this._fmtPos(q.position)}</td></tr>
          `).join('')}
        </tbody>
      </table>
    `;
  },

  _seoSitemapHTML(sitemaps) {
    if (!Array.isArray(sitemaps) || !sitemaps.length) return '<p class="seo-empty-note">無資料</p>';
    return sitemaps.map(s => {
      const contents = (s.contents || []).map(c => `${c.type}: ${c.submitted} 已提交 / ${c.indexed} 已索引`).join(' · ');
      const lastDown = s.lastDownloaded ? new Date(s.lastDownloaded).toLocaleString('zh-TW') : '未下載';
      return `
        <div class="seo-sitemap-item">
          <div class="seo-sitemap-path">${this._esc(s.path)}</div>
          <div class="seo-sitemap-info">
            <span>Google 最後下載：${lastDown}</span>
            <span>錯誤：${s.errors || 0}</span>
            <span>警告：${s.warnings || 0}</span>
          </div>
          <div class="seo-sitemap-contents">${contents}</div>
        </div>
      `;
    }).join('');
  },

  _seoUrlStatusHTML(urlStatus) {
    if (!Array.isArray(urlStatus) || !urlStatus.length) return '<p class="seo-empty-note">無資料</p>';
    const verdictIcon = (v, cov) => {
      if (v === 'PASS') return '✅';
      if (cov === 'URL is unknown to Google') return '⏳';
      if (cov && cov.includes('Redirect')) return '⚠️';
      if (cov === 'Discovered - currently not indexed') return '🔍';
      return '❓';
    };
    return `
      <table class="seo-table">
        <thead><tr><th></th><th>URL</th><th>Verdict</th><th>Coverage</th><th>Rich</th><th>Last crawled</th></tr></thead>
        <tbody>
          ${urlStatus.map(u => {
            const path = (u.url || '').replace('https://toosterx.com', '') || '/';
            const crawled = u.lastCrawlTime ? new Date(u.lastCrawlTime).toLocaleDateString('zh-TW') : '—';
            return `
              <tr>
                <td>${verdictIcon(u.verdict, u.coverage)}</td>
                <td class="seo-url-cell">${this._esc(path)}</td>
                <td>${this._esc(u.verdict)}</td>
                <td title="${this._esc(u.coverage)}">${this._esc((u.coverage || '').slice(0, 30))}</td>
                <td>${this._esc(u.richVerdict || '—')}</td>
                <td>${crawled}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    `;
  },

  /** 說明彈窗（參考教學俱樂部 _showEduInfoPopup，共用 edu-info-overlay 樣式） */
  _showSeoInfoPopup(type) {
    const info = {
      meta: {
        title: '資料日期與來源',
        body: '<p>此列顯示本次快照的三項基本資訊：</p>'
          + '<ul>'
          + '<li><b>資料日期</b> — 本次快照對應的日期。每日台北時間 11:00 自動重新抓取。</li>'
          + '<li><b>產出時間</b> — GitHub Actions 實際跑完此快照的時間。</li>'
          + '<li><b>站點</b> — Google Search Console 資源 ID（sc-domain 格式，涵蓋 toosterx.com 所有子網域）。</li>'
          + '</ul>'
          + '<p style="color:var(--text-muted);font-size:.78rem;margin-top:.5rem">右上角 🔄 按鈕可清除快取、重讀最新 Firestore 資料（不會觸發新爬取）。</p>',
      },
      overview: {
        title: '總覽數字說明',
        body: '<p>三個時間區間的搜尋表現總覽：</p>'
          + '<ul>'
          + '<li><b>曝光</b> — 網站在 Google 搜尋結果中被顯示的次數</li>'
          + '<li><b>點擊</b> — 用戶從搜尋結果點進網站的次數</li>'
          + '<li><b>CTR（點擊率）</b> — 點擊 ÷ 曝光，衡量搜尋結果吸引力</li>'
          + '<li><b>排名</b> — 網站在搜尋結果的平均排序位置（1 = 第一個）</li>'
          + '</ul>'
          + '<p style="margin-top:.5rem;font-size:.82rem"><b>參考值：</b></p>'
          + '<p style="font-size:.78rem;color:var(--text-muted)">• CTR 3-8% 為一般、10-30% 為優秀、超過 30% 通常是品牌詞<br>• 平均排名 1-3 頂尖、4-10 第一頁、超過 10 第二頁之後</p>',
      },
      daily: {
        title: '每日時序圖說明',
        body: '<p>顯示過去 30 天每日曝光趨勢：</p>'
          + '<ul>'
          + '<li><b>柱高</b> — 當日總曝光數（相對值）</li>'
          + '<li><b>柱頂數字</b> — 當日點擊數（0 時不顯示）</li>'
          + '<li><b>日期標籤</b> — MM-DD 格式</li>'
          + '</ul>'
          + '<p style="margin-top:.4rem">滑鼠懸停柱子可看完整日期與具體數字。</p>'
          + '<p style="color:var(--text-muted);font-size:.78rem;margin-top:.3rem">趨勢觀察：(1) 逐日遞增代表 SEO 健康成長、(2) 突然高峰可能是外部曝光（如 PTT 討論）、(3) 連續 0 需檢查是否被 Google 降權。</p>',
      },
      pages: {
        title: '頁面表現說明',
        body: '<p>過去 28 天中，每個頁面在搜尋結果被曝光、點擊的狀況。</p>'
          + '<ul>'
          + '<li><b>URL</b> — 相對路徑（已去除 https://toosterx.com 前綴）</li>'
          + '<li><b>曝光/點擊/CTR/排名</b> — 定義同「總覽」</li>'
          + '</ul>'
          + '<p style="margin-top:.5rem">優化策略：</p>'
          + '<ol style="font-size:.82rem">'
          + '<li>排名 1-3 但 CTR 低 → 優化 meta title/description 吸引點擊</li>'
          + '<li>排名 10-20 → 內容優化（加字數、改關鍵字密度）</li>'
          + '<li>曝光 0 → Google 沒收錄，檢查 sitemap 與索引狀態</li>'
          + '</ol>',
      },
      devices: {
        title: '裝置分布說明',
        body: '<p>過去 28 天搜尋流量按裝置類型分布：</p>'
          + '<ul>'
          + '<li><b>MOBILE</b> — 手機</li>'
          + '<li><b>DESKTOP</b> — 桌上型電腦 / 筆電</li>'
          + '<li><b>TABLET</b> — 平板（通常極少）</li>'
          + '</ul>'
          + '<p style="margin-top:.4rem;font-size:.82rem">ToosterX 以 LINE Mini App 為主，手機佔比 60%+ 屬正常。若桌面 CTR 遠低於手機，可能是桌面 RWD 顯示有問題。</p>',
      },
      countries: {
        title: '國家分布說明',
        body: '<p>過去 28 天搜尋流量按國家分布（ISO 3166-1 alpha-3 代碼）。</p>'
          + '<p style="margin-top:.3rem">ToosterX 定位台灣市場，TWN 應佔 95%+。</p>'
          + '<p style="color:var(--text-muted);font-size:.78rem;margin-top:.4rem">若突然出現大量非台灣流量（如 CHN、IND），可能是：(a) VPN 影響、(b) 詞彙被國際搜尋到、(c) 被 bot 大量爬取需檢查。</p>',
      },
      typeBreakdown: {
        title: '搜尋類型分布說明',
        body: '<p>Google 搜尋產品線分布（過去 90 天）：</p>'
          + '<ul>'
          + '<li><b>WEB</b> — 一般 Google 搜尋（主戰場）</li>'
          + '<li><b>IMAGE</b> — Google 圖片搜尋（需 image sitemap + alt 標籤）</li>'
          + '<li><b>VIDEO</b> — Google 影片搜尋（需 VideoObject schema）</li>'
          + '<li><b>NEWS</b> — Google News（需申請 Publisher Center）</li>'
          + '<li><b>DISCOVER</b> — Android Google App 主頁推薦（需高流量）</li>'
          + '</ul>'
          + '<p style="margin-top:.4rem;font-size:.82rem">目前以 WEB 為主。IMAGE 剛起步（sitemap 新增了 og.png）。</p>',
      },
      queries: {
        title: '熱門搜尋詞說明',
        body: '<p>用戶在 Google 搜尋什麼詞找到你的網站（過去 90 天）。</p>'
          + '<p style="margin-top:.3rem"><b>⚠️ GSC 隱私門檻：</b>Google 會隱藏低曝光的個別查詢詞以保護用戶隱私，所以此處看到的通常是曝光 ≥ 10 的詞。</p>'
          + '<p style="margin-top:.5rem;font-size:.82rem">這是最機密的資料 — <b>請勿對外截圖分享</b>，競品會據此逆推你的 SEO 策略。</p>',
      },
      sitemap: {
        title: 'Sitemap 狀態說明',
        body: '<p>Google 對 sitemap.xml 的處理狀態：</p>'
          + '<ul>'
          + '<li><b>最後下載</b> — Google 最近一次抓取 sitemap 的時間（非索引時間）</li>'
          + '<li><b>錯誤 / 警告</b> — Google 解析 sitemap 時的問題數</li>'
          + '<li><b>已提交 / 已索引</b> — Sitemap 中的 URL 數 vs 實際進入 Google 索引的數</li>'
          + '</ul>'
          + '<p style="margin-top:.4rem;font-size:.82rem">新站通常「已索引 &lt; 已提交」很常見，Google 需時間評估。超過 2 週仍 0 索引需檢查 robots、canonical 或內容品質。</p>',
      },
      urlStatus: {
        title: 'URL 索引狀態說明',
        body: '<p>每個重要 URL 在 Google 索引中的詳細狀態。</p>'
          + '<p style="margin-top:.4rem"><b>圖示含義：</b></p>'
          + '<ul>'
          + '<li>✅ <b>PASS / Submitted and indexed</b> — 已成功索引，會在搜尋結果出現</li>'
          + '<li>⏳ <b>URL is unknown to Google</b> — Google 還沒看過此 URL，等待中</li>'
          + '<li>🔍 <b>Discovered - currently not indexed</b> — Google 已發現但還沒決定是否收錄</li>'
          + '<li>⚠️ <b>Redirect error</b> — 有重定向問題（如 canonical 不一致）</li>'
          + '<li>❓ 其他 — 點進 URL inspection 連結看詳情</li>'
          + '</ul>'
          + '<p style="margin-top:.4rem;font-size:.82rem"><b>Rich 欄位：</b>PASS 表示結構化資料（FAQ/麵包屑）驗證通過，可在 SERP 顯示豐富片段。</p>',
      },
    };
    const item = info[type];
    if (!item) return;
    const overlay = document.createElement('div');
    overlay.className = 'edu-info-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = '<div class="edu-info-dialog">'
      + '<div class="edu-info-dialog-title">' + this._esc(item.title) + '</div>'
      + '<div class="edu-info-dialog-body">' + item.body + '</div>'
      + '<button class="primary-btn" style="width:100%;margin-top:.8rem" onclick="this.closest(\'.edu-info-overlay\').remove()">了解</button>'
      + '</div>';
    document.body.appendChild(overlay);
  },

  _fmtNum(n) { return typeof n === 'number' ? n.toLocaleString('zh-TW') : (n || 0); },
  _fmtPct(n) { return (typeof n === 'number' && !isNaN(n)) ? (n * 100).toFixed(1) + '%' : '—'; },
  _fmtPos(n) { return (typeof n === 'number' && n > 0) ? n.toFixed(1) : '—'; },
  _esc(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },

});
