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
          <p>目前還沒有可顯示的 SEO 快照。系統每天台北時間 11:00 會自動抓一次 Google Search Console 資料。</p>
          <p style="margin-top:1rem;font-size:.85rem;color:var(--text-muted)">如果想立刻更新，可以到 <a href="https://github.com/msw2004727/FC/actions/workflows/gsc-snapshot.yml" target="_blank" rel="noopener">GitHub Actions</a> 手動執行「GSC Daily Snapshot」。</p>
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

      ${this._seoActionItemsHTML(s, history, genAt, info)}

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
        <h3>🏅 GSC 近 90 天平均前 20 名查詢詞${info('firstTwoPageQueries')}</h3>
        ${this._seoFirstTwoPageQueriesHTML(s.firstTwoPageQueries || this._seoBuildFirstTwoPageQueries(s.queries))}
      </div>

      <div class="seo-grid-2">
        <div class="seo-section">
          <h3>🎯 SEO 頁面機會${info('pageOpportunities')}</h3>
          ${this._seoPageOpportunitiesHTML(s.pages)}
        </div>
        <div class="seo-section">
          <h3>🔎 品牌 / 非品牌查詢${info('querySegments')}</h3>
          ${this._seoQuerySegmentsHTML(s.queries)}
        </div>
      </div>

      <div class="seo-section">
        <h3>🔎 熱門搜尋詞（90 天）${info('queries')}</h3>
        ${this._seoQueriesHTML(s.queries)}
      </div>

      <div class="seo-section">
        <h3>✨ Search Appearance${info('searchAppearance')}</h3>
        ${this._seoSearchAppearanceHTML(s.searchAppearance)}
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

  _seoActionItemsHTML(s, history, genAt, info) {
    const items = this._seoBuildActionItems(s, history, genAt);
    const btn = info ? info('actionItems') : '';
    if (!items.length) {
      return `
        <div class="seo-section">
          <h3>✅ 今日 SEO 狀態${btn}</h3>
          <div class="seo-alert seo-alert-ok">目前沒有需要立刻處理的 SEO 警示。下一步可先看低 CTR 頁面與第二頁候選詞，當作優化清單。</div>
        </div>
      `;
    }
    return `
      <div class="seo-section">
        <h3>🧭 SEO 待辦 / 警示${btn}</h3>
        <div class="seo-alert-list">
          ${items.map(item => `
            <div class="seo-alert seo-alert-${item.level}">
              <strong>${this._esc(item.title)}</strong>
              <span>${this._esc(item.body)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  },

  _seoBuildActionItems(s, history, genAt) {
    const items = [];
    if (genAt && (Date.now() - genAt.getTime()) > 36 * 60 * 60 * 1000) {
      items.push({
        level: 'warn',
        title: '資料可能過舊',
        body: '後台資料已經超過 36 小時沒更新，建議確認 GitHub Actions 的 GSC Daily Snapshot 是否有成功執行。',
      });
    }
    const urlStatus = Array.isArray(s?.urlStatus) ? s.urlStatus : [];
    const failedUrls = urlStatus.filter(u => u.error || (u.verdict && u.verdict !== 'PASS'));
    if (failedUrls.length) {
      items.push({
        level: 'danger',
        title: `URL 收錄檢查有 ${failedUrls.length} 筆需確認`,
        body: `請先看下方「URL 收錄狀態」細節：${failedUrls.slice(0, 3).map(u => (u.url || '').replace('https://toosterx.com', '') || '/').join('、')}`,
      });
    }
    const sitemapProblems = (Array.isArray(s?.sitemaps) ? s.sitemaps : [])
      .filter(m => Number(m.errors || 0) > 0 || Number(m.warnings || 0) > 0);
    if (sitemapProblems.length) {
      items.push({
        level: 'danger',
        title: 'Sitemap 有錯誤或警告',
        body: `Google 讀取 sitemap 時回報問題：${sitemapProblems.map(m => `${m.errors || 0} errors / ${m.warnings || 0} warnings`).join('；')}`,
      });
    }
    const lowCtrPages = (Array.isArray(s?.pages) ? s.pages : [])
      .filter(p => Number(p.impressions || 0) >= 10 && Number(p.ctr || 0) < 0.02);
    if (lowCtrPages.length) {
      items.push({
        level: 'warn',
        title: `高曝光低 CTR 頁面 ${lowCtrPages.length} 筆`,
        body: '很多人看到但點擊偏低，優先檢查標題、描述是否夠吸引人，或是否符合搜尋者想找的內容。',
      });
    }
    const secondPageQueries = (Array.isArray(s?.queries) ? s.queries : [])
      .filter(q => Number(q.impressions || 0) >= 3 && Number(q.position || 0) > 10 && Number(q.position || 0) <= 20);
    if (secondPageQueries.length) {
      items.push({
        level: 'info',
        title: `第二頁候選詞 ${secondPageQueries.length} 個`,
        body: '這些詞離第一頁最近，最適合補內文段落、FAQ、內部連結與頁面標題。',
      });
    }
    if (Array.isArray(history) && history.length < 3) {
      items.push({
        level: 'info',
        title: '歷史快照偏少',
        body: '資料天數還少，可以先看單日狀態；等累積 7 天以上後，趨勢判斷會更準。',
      });
    }
    return items.slice(0, 6);
  },

  _seoPagesTableHTML(pages) {
    if (!Array.isArray(pages) || !pages.length) return '<p class="seo-empty-note">目前還沒有頁面表現資料。</p>';
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
    if (!Array.isArray(devices) || !devices.length) return '<p class="seo-empty-note">目前還沒有裝置分布資料。</p>';
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
    if (!Array.isArray(countries) || !countries.length) return '<p class="seo-empty-note">目前還沒有國家分布資料。</p>';
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
    if (!tb) return '<p class="seo-empty-note">目前還沒有搜尋類型資料。</p>';
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

  _seoPageOpportunitiesHTML(pages) {
    if (!Array.isArray(pages) || !pages.length) return '<p class="seo-empty-note">目前還沒有頁面資料，等 GSC 累積後會顯示。</p>';
    const opportunities = pages
      .filter(p => Number(p.impressions || 0) >= 3)
      .map(p => {
        const position = Number(p.position || 0);
        const ctr = Number(p.ctr || 0);
        let reason = '';
        if (Number(p.impressions || 0) >= 10 && ctr < 0.02) reason = '高曝光低 CTR';
        else if (position > 10 && position <= 20) reason = '第二頁候選';
        else if (position > 0 && position <= 10 && Number(p.clicks || 0) === 0) reason = '有排名但未點擊';
        if (!reason) return null;
        return { ...p, reason };
      })
      .filter(Boolean)
      .slice(0, 8);
    if (!opportunities.length) return '<p class="seo-empty-note">目前沒有特別需要優先處理的頁面。</p>';
    return `
      <table class="seo-table seo-table-compact">
        <thead><tr><th>頁面</th><th>機會</th><th>曝光</th><th>CTR</th><th>排名</th></tr></thead>
        <tbody>
          ${opportunities.map(p => `
            <tr>
              <td class="seo-url-cell" title="${this._esc(p.page)}">${this._esc((p.page || '').replace('https://toosterx.com', '') || '/')}</td>
              <td><span class="seo-pill seo-pill-info">${this._esc(p.reason)}</span></td>
              <td>${this._fmtNum(p.impressions)}</td>
              <td>${this._fmtPct(p.ctr)}</td>
              <td>${this._fmtPos(p.position)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  },

  _seoQuerySegmentsHTML(queries) {
    if (!Array.isArray(queries) || !queries.length) return '<p class="seo-empty-note">目前還沒有查詢詞資料，通常是曝光量還沒達到 GSC 顯示門檻。</p>';
    const sum = (rows) => rows.reduce((acc, q) => {
      acc.impressions += Number(q.impressions || 0);
      acc.clicks += Number(q.clicks || 0);
      return acc;
    }, { impressions: 0, clicks: 0 });
    const brand = queries.filter(q => this._seoIsBrandQuery(q.query));
    const nonBrand = queries.filter(q => !this._seoIsBrandQuery(q.query));
    const rows = [
      { label: '品牌詞', ...sum(brand) },
      { label: '非品牌詞', ...sum(nonBrand) },
    ].map(r => ({
      ...r,
      ctr: r.impressions > 0 ? r.clicks / r.impressions : 0,
    }));
    return `
      <table class="seo-table seo-table-compact">
        <thead><tr><th>類型</th><th>曝光</th><th>點擊</th><th>CTR</th></tr></thead>
        <tbody>
          ${rows.map(r => `<tr><td>${r.label}</td><td>${this._fmtNum(r.impressions)}</td><td>${this._fmtNum(r.clicks)}</td><td>${this._fmtPct(r.ctr)}</td></tr>`).join('')}
        </tbody>
      </table>
      <p class="seo-empty-note" style="margin-top:.45rem">非品牌詞代表陌生用戶用需求找到你；品牌詞通常是已經知道 ToosterX 的人。</p>
    `;
  },

  _seoSearchAppearanceHTML(searchAppearance) {
    if (!Array.isArray(searchAppearance) || !searchAppearance.length) {
      return '<p class="seo-empty-note">目前還沒有特殊搜尋外觀資料；這很常見，不代表錯誤。</p>';
    }
    return `
      <table class="seo-table seo-table-compact">
        <thead><tr><th>外觀</th><th>曝光</th><th>點擊</th><th>CTR</th><th>排名</th></tr></thead>
        <tbody>
          ${searchAppearance.map(r => `
            <tr>
              <td>${this._esc(r.searchAppearance || 'N/A')}</td>
              <td>${this._fmtNum(r.impressions)}</td>
              <td>${this._fmtNum(r.clicks)}</td>
              <td>${this._fmtPct(r.ctr)}</td>
              <td>${this._fmtPos(r.position)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  },

  _seoQueriesHTML(queries) {
    if (!Array.isArray(queries) || !queries.length) {
      return '<p class="seo-empty-note">目前 GSC 還沒有提供查詢詞資料；低曝光查詢會被隱藏，需要累積更多搜尋量。</p>';
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

  _seoBuildFirstTwoPageQueries(queries) {
    if (!Array.isArray(queries)) return [];
    return queries
      .filter(q => q && q.query && Number(q.position) > 0 && Number(q.position) <= 20)
      .sort((a, b) => {
        const posDiff = Number(a.position || 0) - Number(b.position || 0);
        if (Math.abs(posDiff) > 0.01) return posDiff;
        return Number(b.impressions || 0) - Number(a.impressions || 0);
      })
      .slice(0, 30)
      .map(q => ({
        ...q,
        pageBucket: Number(q.position || 0) <= 10 ? 'page1' : 'page2',
        sampleConfidence: this._seoQuerySampleConfidence(q.impressions || 0),
      }));
  },

  _seoQuerySampleConfidence(impressions) {
    const n = Number(impressions || 0);
    if (n >= 10) return { level: 'high', label: '較可信' };
    if (n >= 3) return { level: 'medium', label: '樣本不足' };
    return { level: 'low', label: '樣本極少' };
  },

  _seoConfidencePill(confidence) {
    const item = confidence || { level: 'low', label: '樣本極少' };
    return `<span class="seo-pill seo-pill-${this._esc(item.level || 'low')}">${this._esc(item.label || '樣本極少')}</span>`;
  },

  _seoIsBrandQuery(query) {
    const q = String(query || '').toLowerCase();
    return q.includes('tooster') || q.includes('toosterx') || q.includes('吐司') || q.includes('土司');
  },

  _seoFirstTwoPageQueriesHTML(queries) {
    if (!Array.isArray(queries) || !queries.length) {
      return '<p class="seo-empty-note">目前還沒有平均排名 20 名內的查詢詞；也可能是曝光太少，被 GSC 隱私門檻隱藏。</p>';
    }
    return `
      <table class="seo-table">
        <thead><tr><th>查詢</th><th>頁次</th><th>曝光</th><th>點擊</th><th>CTR</th><th>平均排名</th><th>可信度</th></tr></thead>
        <tbody>
          ${queries.map(q => {
            const bucket = q.pageBucket || (Number(q.position || 0) <= 10 ? 'page1' : 'page2');
            const bucketLabel = bucket === 'page1' ? '第 1 頁' : '第 2 頁';
            const confidence = q.sampleConfidence || this._seoQuerySampleConfidence(q.impressions || 0);
            return `<tr><td>${this._esc(q.query)}</td><td>${bucketLabel}</td><td>${this._fmtNum(q.impressions)}</td><td>${this._fmtNum(q.clicks)}</td><td>${this._fmtPct(q.ctr)}</td><td>${this._fmtPos(q.position)}</td><td>${this._seoConfidencePill(confidence)}</td></tr>`;
          }).join('')}
        </tbody>
      </table>
      <p class="seo-empty-note" style="margin-top:.5rem">判定方式：採用 Google Search Console 近 90 天平均排名，≤ 20 視為前兩頁附近。手動即時搜尋會受地區、裝置、個人化影響，所以不一定完全相同。</p>
    `;
  },

  _seoSitemapHTML(sitemaps) {
    if (!Array.isArray(sitemaps) || !sitemaps.length) return '<p class="seo-empty-note">目前還沒有 Sitemap 資料。</p>';
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
    if (!Array.isArray(urlStatus) || !urlStatus.length) return '<p class="seo-empty-note">目前還沒有 URL 收錄檢查資料。</p>';
    const verdictIcon = (v, cov) => {
      if (v === 'PASS') return '✅';
      if (cov === 'URL is unknown to Google') return '⏳';
      if (cov && cov.includes('Redirect')) return '⚠️';
      if (cov === 'Discovered - currently not indexed') return '🔍';
      return '❓';
    };
    return `
      <table class="seo-table">
        <thead><tr><th></th><th>URL</th><th>判定</th><th>收錄說明</th><th>Rich 結果</th><th>最後爬取</th></tr></thead>
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
      actionItems: {
        title: 'SEO 待辦 / 警示怎麼看',
        body: '<p>這一區是後台幫你把資料翻成「現在最值得注意的事情」。不用逐格看表格，先看這裡就好。</p>'
          + '<ul>'
          + '<li><b>紅色</b>：建議優先確認，通常跟收錄、Sitemap 或資料異常有關。</li>'
          + '<li><b>黃色</b>：不是壞掉，但可能有優化空間，例如曝光多、點擊少。</li>'
          + '<li><b>藍色</b>：機會提示，例如快進第一頁的關鍵詞。</li>'
          + '</ul>'
          + '<p>看到警示不用先緊張，它只是提醒你「這裡值得打開下面的表格看細節」。</p>',
      },
      meta: {
        title: '資料日期與來源',
        body: '<p>這列是在告訴你：現在看的 SEO 資料是哪一天抓的、什麼時候產生的。</p>'
          + '<ul>'
          + '<li><b>資料日期</b>：這份快照代表哪一天的資料。</li>'
          + '<li><b>產出時間</b>：GitHub Actions 實際抓完資料的時間。</li>'
          + '<li><b>站點</b>：目前看的網站來源，這裡就是 ToosterX 的 GSC 資源。</li>'
          + '</ul>'
          + '<p style="color:var(--text-muted);font-size:.78rem;margin-top:.5rem">右上角重新整理只會重讀資料庫裡的最新快照，不會立刻叫 Google 重新爬網站。</p>',
      },
      overview: {
        title: '總覽數字怎麼看',
        body: '<p>這裡是網站在 Google 搜尋的整體成績單。先看它，就能知道最近 SEO 是變好還是變差。</p>'
          + '<ul>'
          + '<li><b>曝光</b>：你的網站出現在 Google 搜尋結果中的次數。</li>'
          + '<li><b>點擊</b>：使用者真的從 Google 點進網站的次數。</li>'
          + '<li><b>CTR</b>：曝光後有多少比例的人願意點進來，越高代表標題與描述越吸引人。</li>'
          + '<li><b>排名</b>：平均出現位置，數字越小越好，1 代表最前面。</li>'
          + '</ul>'
          + '<p style="margin-top:.5rem;font-size:.82rem"><b>簡單判斷：</b>曝光增加是被看見，點擊增加才是真的帶流量；排名進步但 CTR 很低時，通常要先改標題或描述。</p>',
      },
      daily: {
        title: '每日趨勢怎麼看',
        body: '<p>這張圖看的是最近 30 天每天的 SEO 熱度，主要用來看「趨勢」。</p>'
          + '<ul>'
          + '<li><b>柱子越高</b>：那天在 Google 被看到越多次。</li>'
          + '<li><b>柱子上的數字</b>：那天有多少點擊。</li>'
          + '<li><b>連續上升</b>：通常代表 SEO 正在累積效果。</li>'
          + '</ul>'
          + '<p style="margin-top:.4rem">偶爾一天高低不用太緊張，SEO 通常看 7 天或 28 天趨勢比較準。</p>',
      },
      pages: {
        title: '頁面表現怎麼看',
        body: '<p>這裡是在看「哪一個頁面」幫網站拿到 Google 曝光與點擊。</p>'
          + '<ul>'
          + '<li><b>曝光高、點擊低</b>：代表 Google 有把你秀出來，但標題或描述不夠想點。</li>'
          + '<li><b>排名 10-20</b>：代表快到第一頁，很適合補內容、FAQ、內部連結。</li>'
          + '<li><b>曝光 0</b>：代表目前幾乎沒被看見，要看是不是沒收錄或內容太弱。</li>'
          + '</ul>'
          + '<p style="margin-top:.5rem">最簡單的做法：先挑「曝光高但 CTR 低」和「排名 10-20」的頁面優化，通常最有效率。</p>',
      },
      devices: {
        title: '裝置分布怎麼看',
        body: '<p>這裡是在看使用者是用手機、電腦還是平板搜尋到你。</p>'
          + '<ul>'
          + '<li><b>MOBILE</b>：手機流量。ToosterX 以手機使用為主，手機高是正常的。</li>'
          + '<li><b>DESKTOP</b>：電腦流量。適合看 SEO 著陸頁在桌面版是否吸引人。</li>'
          + '<li><b>TABLET</b>：平板流量，通常不會太多。</li>'
          + '</ul>'
          + '<p style="margin-top:.4rem">若某個裝置曝光很多但 CTR 特別低，就代表那個版面的標題、排版或摘要可能要檢查。</p>',
      },
      countries: {
        title: '國家分布怎麼看',
        body: '<p>這裡是在看搜尋曝光來自哪些國家。</p>'
          + '<p>ToosterX 目前主要做台灣市場，所以 TWN 越高越合理。</p>'
          + '<p style="color:var(--text-muted);font-size:.78rem;margin-top:.4rem">如果突然出現很多非台灣流量，不一定是壞事，可能是 VPN、海外搜尋、或某些詞被其他地區搜到；真的暴增時再檢查是否有異常爬蟲。</p>',
      },
      typeBreakdown: {
        title: '搜尋類型怎麼看',
        body: '<p>Google 不只有一般網頁搜尋，這裡是在看曝光來自哪一種搜尋入口。</p>'
          + '<ul>'
          + '<li><b>WEB</b>：一般 Google 搜尋，現在最重要。</li>'
          + '<li><b>IMAGE</b>：Google 圖片搜尋，跟圖片 alt、檔名、頁面內容有關。</li>'
          + '<li><b>VIDEO</b>：影片搜尋，目前沒有主打影片時可先忽略。</li>'
          + '<li><b>NEWS / DISCOVER</b>：新聞或推薦流量，通常要內容量和權威累積後才會明顯。</li>'
          + '</ul>'
          + '<p style="margin-top:.4rem">現階段先把 WEB 做好最重要；圖片搜尋可以之後慢慢補圖文內容。</p>',
      },
      firstTwoPageQueries: {
        title: '平均前 20 名查詢詞怎麼看',
        body: '<p>這裡列的是 GSC 裡「平均排名在 20 名內」的搜尋詞。白話說，就是 Google 曾經把你的網站排在第一頁或第二頁附近。</p>'
          + '<ul>'
          + '<li><b>第 1 頁</b>：平均排名 1-10。</li>'
          + '<li><b>第 2 頁</b>：平均排名 10.1-20，通常是最值得努力推上去的詞。</li>'
          + '<li><b>可信度</b>：曝光太少時只是參考，不代表你每次手動搜尋都會看到同樣排名。</li>'
          + '</ul>'
          + '<p style="margin-top:.4rem">例如某個詞只有 1 次曝光但排名第 6，這只能說「Google 曾經顯示過」，不能說它已經穩定第一頁。</p>',
      },
      pageOpportunities: {
        title: 'SEO 頁面機會怎麼看',
        body: '<p>這區是後台幫你挑「最值得先優化的頁面」。不用從整張頁面表慢慢找。</p>'
          + '<ul>'
          + '<li><b>高曝光低 CTR</b>：很多人看到，但很少人點。先改標題與描述通常最有效。</li>'
          + '<li><b>第二頁候選</b>：平均排名 10-20。補內容、FAQ、內部連結，有機會往第一頁推。</li>'
          + '<li><b>有排名但未點擊</b>：Google 有給位置，但搜尋結果看起來可能不夠吸引人。</li>'
          + '</ul>'
          + '<p>這裡列出的不是錯誤，而是「可以用最少力氣換最多 SEO 成效」的清單。</p>',
      },
      querySegments: {
        title: '品牌詞 / 非品牌詞怎麼看',
        body: '<p>這區把搜尋詞分成兩種，幫你看 SEO 成長是不是靠自然搜尋帶來的。</p>'
          + '<ul>'
          + '<li><b>品牌詞</b>：像 tooster、toosterx。通常是已經知道你的人在找你。</li>'
          + '<li><b>非品牌詞</b>：像台中足球場、室內足球場。這類才比較代表 SEO 拓新客的能力。</li>'
          + '</ul>'
          + '<p>品牌詞表現好是基本盤；非品牌詞慢慢增加，才代表內容開始替你帶陌生流量。</p>',
      },
      searchAppearance: {
        title: 'Search Appearance 怎麼看',
        body: '<p>這是 Google 顯示搜尋結果時的特殊外觀資料，例如更豐富的搜尋結果樣式。</p>'
          + '<p>如果這裡目前沒有資料，不代表壞掉，只是 Google 尚未回傳特殊外觀。</p>'
          + '<p style="margin-top:.4rem">未來如果 FAQ、麵包屑、圖片或其他 rich result 有被 Google 採用，這裡就比較可能看到資料。</p>',
      },
      queries: {
        title: '熱門搜尋詞怎麼看',
        body: '<p>這裡是在看使用者搜尋哪些字，最後看到或點進 ToosterX。</p>'
          + '<p>它可以幫你知道：Google 現在覺得你的網站跟哪些主題有關。</p>'
          + '<p style="margin-top:.3rem"><b>小提醒：</b>GSC 會隱藏一部分低曝光查詢詞，所以這裡不是 100% 全部搜尋字，只是 Google 願意提供的部分。</p>'
          + '<p style="margin-top:.5rem;font-size:.82rem">這份資料很有商業價值，不建議公開截圖，因為別人可以用它推測你的 SEO 策略。</p>',
      },
      sitemap: {
        title: 'Sitemap 狀態怎麼看',
        body: '<p>Sitemap 就像你交給 Google 的網站地圖，告訴 Google：「這些頁面請來看看」。</p>'
          + '<ul>'
          + '<li><b>最後下載</b>：Google 最近一次讀取 sitemap 的時間。</li>'
          + '<li><b>錯誤 / 警告</b>：Google 讀地圖時有沒有遇到問題。</li>'
          + '<li><b>已提交 / 已索引</b>：地圖裡有幾頁，以及其中幾頁已經進 Google 索引。</li>'
          + '</ul>'
          + '<p style="margin-top:.4rem">新頁面剛上線時，「已索引」少於「已提交」很正常。Google 通常需要時間判斷要不要收錄。</p>',
      },
      urlStatus: {
        title: 'URL 收錄狀態怎麼看',
        body: '<p>這裡是逐頁檢查 Google 對重要 URL 的看法。它比總覽更細，可以看到哪一頁需要處理。</p>'
          + '<p style="margin-top:.4rem"><b>常見狀態：</b></p>'
          + '<ul>'
          + '<li><b>PASS / Submitted and indexed</b>：已收錄，狀態健康。</li>'
          + '<li><b>URL is unknown to Google</b>：Google 可能還沒看過這頁，通常新頁會遇到。</li>'
          + '<li><b>Discovered - currently not indexed</b>：Google 發現了，但暫時還沒收錄。</li>'
          + '<li><b>Redirect / canonical 相關狀態</b>：要確認網址是否跳轉或 canonical 設定是否符合預期。</li>'
          + '</ul>'
          + '<p style="margin-top:.4rem">不是 PASS 不一定代表網站壞掉；它只是提醒你要打開這列看 Coverage 細節，再決定要不要修。</p>',
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
