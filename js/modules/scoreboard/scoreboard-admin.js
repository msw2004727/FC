/* ================================================
   ToosterX - Scoreboard Admin
   Homepage score/schedule source switches and ordering.
   ================================================ */

(function(root) {
  const app = (typeof App !== 'undefined') ? App : root.App;
  if (!app) return;
  root.App = app;

  function esc(value) {
    if (typeof root.escapeHTML === 'function') return root.escapeHTML(value);
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  function apiService() {
    return (typeof ApiService !== 'undefined') ? ApiService : root.ApiService;
  }

  function firebaseService() {
    return (typeof FirebaseService !== 'undefined') ? FirebaseService : root.FirebaseService;
  }

  function canConfigure() {
    const currentUser = apiService()?.getCurrentUser?.() || firebaseService()?._cache?.currentUser || null;
    const roleKey = app._getEffectiveRoleKey?.(currentUser?.role);
    return app.hasPermission?.('admin.scoreboard.configure') || roleKey === 'super_admin';
  }

  function sourceRows(config) {
    const catalog = root.ScoreboardConfigUtils?.SOURCE_CATALOG || [];
    const sources = config.sources || {};
    const orderIndex = new Map((config.homepageOrder || []).map((id, index) => [id, index + 1]));

    return catalog.map(item => {
      const src = sources[item.id] || {};
      const enabled = src.enabled !== false;
      const order = orderIndex.get(item.id) || src.sortOrder || 99;
      const provider = item.provider || 'API Source';
      return `
        <section class="scoreboard-source-row" data-source-id="${esc(item.id)}">
          <div class="scoreboard-source-main">
            <div>
              <div class="scoreboard-source-name">${esc(src.label || item.label)}</div>
              <div class="scoreboard-source-meta">${esc(provider)} · ${esc(item.sport)} · ${esc(src.sourceKey || item.sourceKey)}</div>
            </div>
            <label class="scoreboard-source-toggle">
              <input type="checkbox" class="scoreboard-source-enabled" ${enabled ? 'checked' : ''}>
              <span>首頁顯示</span>
            </label>
          </div>
          <div class="scoreboard-source-fields">
            <label>
              <span>首頁名稱</span>
              <input class="scoreboard-source-label" type="text" maxlength="24" value="${esc(src.label || item.label)}">
            </label>
            <label>
              <span>排序</span>
              <input class="scoreboard-source-order" type="number" min="1" max="999" step="1" value="${esc(order)}">
            </label>
          </div>
          <div class="scoreboard-api-slot">
            <span>API 位置預留</span>
            <code>${esc(src.sourceKey || item.sourceKey)}</code>
            <small>正式端點與金鑰後續接後端，前端不保存密鑰。</small>
          </div>
        </section>
      `;
    }).join('');
  }

  function sortSummary(config) {
    const enabledCount = Object.values(config.sources || {}).filter(src => src?.enabled !== false).length;
    return `
      <div class="scoreboard-sort-list">
        <div class="scoreboard-sort-pill">首頁排序 <span>依排序數字由小到大</span></div>
        <div class="scoreboard-sort-pill">資料載入 <span>首頁只讀公開設定</span></div>
        <div class="scoreboard-sort-pill">首頁筆數 <span>目前最多 3 場</span></div>
        <div class="scoreboard-sort-pill">快取策略 <span>優先速度與低讀取</span></div>
        <div class="scoreboard-sort-pill">已開來源 <span>${enabledCount} 個</span></div>
      </div>
    `;
  }

  function renderAdmin(config) {
    const page = document.getElementById('page-admin-scoreboard');
    if (!page) return;
    const locked = !canConfigure();
    page.innerHTML = `
      <div class="page-header">
        <button class="back-btn" onclick="App.goBack()">‹</button>
        <h2>賽事比分控制</h2>
      </div>
      <section class="scoreboard-admin-intro">
        <div>
          <h3>首頁比分與賽程預留控制</h3>
          <p>先決定首頁要顯示哪些賽事來源與排序。API 串接位置先預留，後續正式接資料時只需替換後端來源。</p>
        </div>
        <label class="scoreboard-home-toggle">
          <input type="checkbox" id="scoreboard-homepage-enabled" ${config.homepageEnabled !== false ? 'checked' : ''}>
          <span>首頁比分區顯示</span>
        </label>
      </section>
      <section class="scoreboard-admin-panel">
        <div class="scoreboard-admin-title-row">
          <h3>來源 API 開關</h3>
          <span>足球、NBA、羽球、奧運先預留；未來可再新增其他運動。</span>
        </div>
        <div id="scoreboard-source-list" class="scoreboard-source-list">${sourceRows(config)}</div>
      </section>
      <section class="scoreboard-admin-panel">
        <div class="scoreboard-admin-title-row">
          <h3>排序與載入策略</h3>
          <span>首頁以速度優先，正式資料後續再接入。</span>
        </div>
        ${sortSummary(config)}
      </section>
      <button class="primary-btn full-width" id="scoreboard-save-btn" onclick="App.saveScoreboardAdminConfig()" ${locked ? 'disabled' : ''}>儲存設定</button>
      ${locked ? '<div class="scoreboard-locked-note">目前帳號只能查看，沒有調整賽事比分控制的權限。</div>' : ''}
    `;
  }

  function collectAdminConfig() {
    const base = root.ScoreboardConfigUtils?.defaultConfig?.() || {};
    const sources = {};
    document.querySelectorAll('.scoreboard-source-row[data-source-id]').forEach(row => {
      const id = row.dataset.sourceId;
      const fallback = base.sources?.[id] || {};
      const enabled = row.querySelector('.scoreboard-source-enabled')?.checked === true;
      const label = row.querySelector('.scoreboard-source-label')?.value?.trim() || fallback.label || id;
      const sortOrder = Number(row.querySelector('.scoreboard-source-order')?.value || fallback.sortOrder || 99);
      sources[id] = { ...fallback, enabled, label, sortOrder };
    });
    const homepageOrder = Object.entries(sources)
      .filter(([, src]) => src.enabled)
      .sort((a, b) => Number(a[1].sortOrder || 99) - Number(b[1].sortOrder || 99))
      .map(([id]) => id);
    return {
      schemaVersion: 1,
      homepageEnabled: document.getElementById('scoreboard-homepage-enabled')?.checked !== false,
      homepageOrder,
      sources,
    };
  }

  Object.assign(app, {
    async renderScoreboardAdmin() {
      const page = document.getElementById('page-admin-scoreboard');
      if (!page) return;
      page.innerHTML = '<div class="page-header"><button class="back-btn" onclick="App.goBack()">‹</button><h2>賽事比分控制</h2></div><div style="padding:.8rem;color:var(--text-muted)">載入中...</div>';
      try {
        const config = await this.loadScoreboardConfig();
        renderAdmin(config);
        this._markPageSnapshotReady?.('page-admin-scoreboard');
      } catch (err) {
        page.innerHTML = '<div class="page-header"><button class="back-btn" onclick="App.goBack()">‹</button><h2>賽事比分控制</h2></div><div style="padding:.8rem;color:var(--danger)">載入失敗：' + esc(err.message || err) + '</div>';
      }
    },

    async saveScoreboardAdminConfig() {
      if (!canConfigure()) {
        this.showToast?.('目前帳號沒有調整賽事比分控制的權限');
        return;
      }
      const btn = document.getElementById('scoreboard-save-btn');
      btn && (btn.disabled = true);
      try {
        const saved = await this.saveScoreboardConfig(collectAdminConfig());
        this.showToast?.('賽事比分設定已儲存');
        renderAdmin(saved);
        this.renderHomeScoreboardPreview?.();
      } catch (err) {
        console.error('[ScoreboardAdmin] save failed:', err);
        this.showToast?.('儲存失敗，請稍後再試');
      } finally {
        const currentBtn = document.getElementById('scoreboard-save-btn');
        currentBtn && (currentBtn.disabled = false);
      }
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
