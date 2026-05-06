/* ================================================
   ToosterX - Scoreboard Admin
   Controls homepage score/schedule placeholder sources and ordering.
   ================================================ */

(function(root) {
  function esc(value) {
    return typeof root.escapeHTML === 'function' ? root.escapeHTML(value) : String(value ?? '');
  }

  function canConfigure() {
    const currentUser = root.ApiService?.getCurrentUser?.() || root.FirebaseService?._cache?.currentUser || null;
    const roleKey = root.App?._getEffectiveRoleKey?.(currentUser?.role);
    return root.App?.hasPermission?.('admin.scoreboard.configure')
      || roleKey === 'admin'
      || roleKey === 'super_admin';
  }

  function sourceRows(config) {
    const catalog = root.ScoreboardConfigUtils?.SOURCE_CATALOG || [];
    const sources = config.sources || {};
    const orderIndex = new Map((config.homepageOrder || []).map((id, index) => [id, index + 1]));

    return catalog.map(item => {
      const src = sources[item.id] || {};
      const enabled = src.enabled !== false;
      const order = orderIndex.get(item.id) || src.sortOrder || 99;
      return `
        <div class="form-card scoreboard-source-row" data-source-id="${esc(item.id)}" style="margin-bottom:.55rem">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:.6rem">
            <div style="min-width:0;flex:1">
              <div style="font-weight:800;font-size:.9rem">${esc(src.label || item.label)}</div>
              <div style="font-size:.72rem;color:var(--text-muted);margin-top:.1rem">
                ${esc(item.sport)} · ${esc(src.sourceKey || item.sourceKey)}
              </div>
            </div>
            <label style="display:flex;align-items:center;gap:.35rem;font-size:.75rem;flex-shrink:0">
              <input type="checkbox" class="scoreboard-source-enabled" ${enabled ? 'checked' : ''}>
              顯示
            </label>
          </div>
          <div style="display:grid;grid-template-columns:1fr 86px;gap:.5rem;margin-top:.55rem">
            <label style="display:flex;flex-direction:column;gap:.25rem;font-size:.72rem;color:var(--text-muted)">
              顯示名稱
              <input class="scoreboard-source-label" type="text" maxlength="24" value="${esc(src.label || item.label)}">
            </label>
            <label style="display:flex;flex-direction:column;gap:.25rem;font-size:.72rem;color:var(--text-muted)">
              排序
              <input class="scoreboard-source-order" type="number" min="1" max="999" step="1" value="${esc(order)}">
            </label>
          </div>
        </div>
      `;
    }).join('');
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
      <div class="form-card" style="margin-bottom:.7rem">
        <div style="font-weight:800;font-size:.9rem;margin-bottom:.25rem">首頁比分與行事曆預留區</div>
        <div style="font-size:.78rem;color:var(--text-muted);line-height:1.6">
          這裡只控制首頁預留欄位的顯示來源與順序，目前不呼叫外部 API，也不存放 API 密鑰。
        </div>
        <label style="display:flex;align-items:center;gap:.45rem;margin-top:.7rem;font-size:.82rem;font-weight:700">
          <input type="checkbox" id="scoreboard-homepage-enabled" ${config.homepageEnabled !== false ? 'checked' : ''}>
          首頁顯示比分預留區
        </label>
      </div>
      <div id="scoreboard-source-list">${sourceRows(config)}</div>
      <button class="primary-btn full-width" id="scoreboard-save-btn" onclick="App.saveScoreboardAdminConfig()" ${locked ? 'disabled' : ''}>
        儲存設定
      </button>
      ${locked ? '<div style="font-size:.75rem;color:var(--danger);margin-top:.45rem">目前帳號沒有修改權限。</div>' : ''}
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
      sources[id] = {
        ...fallback,
        enabled,
        label,
        sortOrder,
      };
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

  Object.assign(root.App, {
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
        this.showToast?.('目前帳號沒有修改權限');
        return;
      }
      const btn = document.getElementById('scoreboard-save-btn');
      btn && (btn.disabled = true);
      try {
        const saved = await this.saveScoreboardConfig(collectAdminConfig());
        this.showToast?.('比分預留設定已儲存');
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
