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

  const INFO = {
    homepageToggle: { title: '首頁比分區顯示', body: '開著時，首頁會保留比分與賽程區。關掉後，首頁直接隱藏這一區。' },
    sourceToggle: { title: '來源開關', body: '這個來源是否要出現在首頁的比分區。之後接 API 時也會照這裡的開關判斷。' },
    sourceLabel: { title: '首頁名稱', body: '顯示給一般使用者看的名稱，建議短一點，例如英超、NBA、奧運。' },
    sourceOrder: { title: '排序', body: '數字越小越前面。未來來源變多時，首頁會照這個順序先顯示。' },
    apiSlot: { title: 'API 位置預留', body: '這裡只放來源代號，不放金鑰。正式 API 金鑰會放後端，避免暴露在前台。' },
    sourcePanel: { title: '來源 API 開關', body: '先把可控制的來源儀表做好，資料 API 後續再接，不影響目前首頁速度。' },
    strategyPanel: { title: '排序與載入策略', body: '首頁以快速載入為主，只讀公開設定；真正比分資料後續可再分批或延遲載入。' },
    sortHome: { title: '首頁排序', body: '用每個來源的排序數字決定排列，數字越小越優先。' },
    dataLoad: { title: '資料載入', body: '首頁先讀公開設定，不在第一時間載入大量比分資料。' },
    homeLimit: { title: '首頁筆數', body: '目前預設最多放 3 場，避免首頁變慢或畫面太長。' },
    cacheStrategy: { title: '快取策略', body: '優先使用快取與公開設定，減少讀取量，提升首頁開啟速度。' },
    enabledCount: { title: '已開來源', body: '目前有多少來源被打開，方便快速檢查設定狀態。' },
  };

  function infoButton(key) {
    return `<button class="scoreboard-info-btn" type="button" onclick="event.stopPropagation();App.showScoreboardInfo('${esc(key)}')" title="說明" aria-label="說明">?</button>`;
  }

  function fieldTitle(text, key) {
    return `<span class="scoreboard-field-title">${esc(text)}${infoButton(key)}</span>`;
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
              <span>首頁顯示${infoButton('sourceToggle')}</span>
            </label>
          </div>
          <div class="scoreboard-source-fields">
            <label>
              ${fieldTitle('首頁名稱', 'sourceLabel')}
              <input class="scoreboard-source-label" type="text" maxlength="24" value="${esc(src.label || item.label)}">
            </label>
            <label>
              ${fieldTitle('排序', 'sourceOrder')}
              <input class="scoreboard-source-order" type="number" min="1" max="999" step="1" value="${esc(order)}">
            </label>
          </div>
          <div class="scoreboard-api-slot">
            ${fieldTitle('API 位置預留', 'apiSlot')}
            <code>${esc(src.sourceKey || item.sourceKey)}</code>
            <small>正式端點與金鑰後續接後端，前端不保存密鑰。</small>
          </div>
        </section>
      `;
    }).join('');
  }

  function sortSummary(config) {
    const enabledCount = Object.values(config.sources || {}).filter(src => src?.enabled !== false).length;
    const pill = (title, value, key) => `<div class="scoreboard-sort-pill">${fieldTitle(title, key)} <span>${esc(value)}</span></div>`;
    return `
      <div class="scoreboard-sort-list">
        ${pill('首頁排序', '依排序數字由小到大', 'sortHome')}
        ${pill('資料載入', '首頁只讀公開設定', 'dataLoad')}
        ${pill('首頁筆數', '目前最多 3 場', 'homeLimit')}
        ${pill('快取策略', '優先速度與低讀取', 'cacheStrategy')}
        ${pill('已開來源', `${enabledCount} 個`, 'enabledCount')}
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
          <span>首頁比分區顯示${infoButton('homepageToggle')}</span>
        </label>
      </section>
      <section class="scoreboard-admin-panel">
        <div class="scoreboard-admin-title-row">
          <h3>來源 API 開關${infoButton('sourcePanel')}</h3>
          <span>足球、NBA、羽球、奧運先預留；未來可再新增其他運動。</span>
        </div>
        <div id="scoreboard-source-list" class="scoreboard-source-list">${sourceRows(config)}</div>
      </section>
      <section class="scoreboard-admin-panel">
        <div class="scoreboard-admin-title-row">
          <h3>排序與載入策略${infoButton('strategyPanel')}</h3>
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

    showScoreboardInfo(key) {
      const info = INFO[key] || { title: '欄位說明', body: '這個欄位用來控制首頁比分區的顯示方式。' };
      const overlay = document.createElement('div');
      overlay.className = 'edu-info-overlay';
      overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
      overlay.innerHTML = `
        <div class="edu-info-dialog">
          <button class="edu-info-close" type="button" onclick="this.closest('.edu-info-overlay').remove()">×</button>
          <div class="edu-info-dialog-title">${esc(info.title)}</div>
          <div style="font-size:.82rem;line-height:1.65;color:var(--text-secondary)">${esc(info.body)}</div>
        </div>
      `;
      document.body.appendChild(overlay);
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
