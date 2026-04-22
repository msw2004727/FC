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

    return `
      <div class="seo-meta-bar">
        <span>📅 資料日期：<strong>${this._esc(s.id || 'N/A')}</strong></span>
        <span>🕒 產出時間：<strong>${this._esc(genStr)}</strong></span>
        <span>📊 站點：<strong>${this._esc(s.siteUrl || 'toosterx.com')}</strong></span>
      </div>

      ${this._seoOverviewHTML(s.overview)}

      ${this._seoDailyTrendHTML(s.daily, history)}

      <div class="seo-section">
        <h3>📄 頁面表現（過去 28 天）</h3>
        ${this._seoPagesTableHTML(s.pages)}
      </div>

      <div class="seo-grid-2">
        <div class="seo-section">
          <h3>📱 裝置分布</h3>
          ${this._seoDevicesHTML(s.devices)}
        </div>
        <div class="seo-section">
          <h3>🌏 國家分布（Top 10）</h3>
          ${this._seoCountriesHTML(s.countries)}
        </div>
      </div>

      <div class="seo-section">
        <h3>🔍 搜尋類型分布（90 天）</h3>
        ${this._seoTypeBreakdownHTML(s.typeBreakdown)}
      </div>

      <div class="seo-section">
        <h3>🔎 熱門搜尋詞（90 天，GSC 隱私門檻後剩餘）</h3>
        ${this._seoQueriesHTML(s.queries)}
      </div>

      <div class="seo-section">
        <h3>📋 Sitemap 狀態</h3>
        ${this._seoSitemapHTML(s.sitemaps)}
      </div>

      <div class="seo-section">
        <h3>🔗 URL 索引狀態（共 ${s.totalInspected || 0}，已索引 ${s.indexedCount || 0}）</h3>
        ${this._seoUrlStatusHTML(s.urlStatus)}
      </div>

      <div class="seo-footer-note">
        <p>💡 資料來源：Google Search Console API，每日自動更新。</p>
        <p>⚠️ 此頁資料為商業敏感資訊，請勿對外截圖或分享。</p>
      </div>
    `;
  },

  _seoOverviewHTML(overview) {
    if (!overview) return '';
    const ranges = [
      { label: '7 天', d: overview.last7 },
      { label: '28 天', d: overview.last28 },
      { label: '90 天', d: overview.last90 },
    ];
    return `
      <div class="seo-section">
        <h3>📊 總覽</h3>
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

  _seoDailyTrendHTML(daily, history) {
    if (!Array.isArray(daily) || !daily.length) return '';
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
        <h3>📈 每日曝光時序（30 天）— 柱高=曝光，標籤=點擊</h3>
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

  _fmtNum(n) { return typeof n === 'number' ? n.toLocaleString('zh-TW') : (n || 0); },
  _fmtPct(n) { return (typeof n === 'number' && !isNaN(n)) ? (n * 100).toFixed(1) + '%' : '—'; },
  _fmtPos(n) { return (typeof n === 'number' && n > 0) ? n.toFixed(1) : '—'; },
  _esc(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },

});
