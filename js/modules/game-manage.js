/* ================================================
   SportHub — Home Game Visibility Management
   ================================================ */

Object.assign(App, {

  _getHomeGamePresetList() {
    const fallback = [{
      id: 'home_game_shot',
      gameKey: 'shot-game',
      name: '蓄力射門 誰與爭鋒',
      page: 'page-game',
      sortOrder: 10,
      enabled: true,
      homeVisible: true,
    }];
    const source = Array.isArray(HOME_GAME_PRESETS) && HOME_GAME_PRESETS.length > 0
      ? HOME_GAME_PRESETS
      : fallback;
    return source.map(item => ({ ...item }));
  },

  _getHomeGameManageItems() {
    const presets = this._getHomeGamePresetList();
    const savedConfigs = (typeof ApiService !== 'undefined' && typeof ApiService.getGameConfigs === 'function')
      ? (ApiService.getGameConfigs() || [])
      : [];
    const byId = new Map();
    const byKey = new Map();

    savedConfigs.forEach(cfg => {
      const cfgId = String(cfg.id || cfg._docId || '').trim();
      const key = String(cfg.gameKey || '').trim();
      if (cfgId) byId.set(cfgId, cfg);
      if (key) byKey.set(key, cfg);
    });

    return presets
      .map(preset => {
        const presetId = String(preset.id || '').trim();
        const presetKey = String(preset.gameKey || '').trim();
        const saved = byId.get(presetId) || byKey.get(presetKey) || null;
        const sortOrderRaw = saved && Number.isFinite(Number(saved.sortOrder))
          ? Number(saved.sortOrder)
          : (Number.isFinite(Number(preset.sortOrder)) ? Number(preset.sortOrder) : 999);
        return {
          ...preset,
          ...(saved || {}),
          id: presetId,
          gameKey: presetKey,
          page: String((saved && saved.page) || preset.page || '').trim(),
          sortOrder: sortOrderRaw,
          enabled: (saved && saved.enabled === false) ? false : preset.enabled !== false,
          homeVisible: (saved && saved.homeVisible === false) ? false : preset.homeVisible !== false,
        };
      })
      .sort((a, b) => a.sortOrder - b.sortOrder);
  },

  renderGameManage() {
    const container = document.getElementById('game-manage-list');
    if (!container) return;

    const items = this._getHomeGameManageItems();
    if (!items.length) {
      container.innerHTML = '<div class="banner-manage-card" style="font-size:.82rem;color:var(--text-muted)">目前沒有可管理的小遊戲</div>';
      return;
    }

    container.innerHTML = items.map(item => {
      const gameId = String(item.id || '').trim();
      const gameName = escapeHTML(item.name || item.gameKey || gameId);
      const gameKey = escapeHTML(item.gameKey || '');
      const checked = item.homeVisible !== false;
      const disabled = item.enabled === false;
      const statusText = disabled
        ? '<span style="font-size:.7rem;color:#ef4444">未啟用</span>'
        : (checked
          ? '<span style="font-size:.7rem;color:#10b981">首頁顯示中</span>'
          : '<span style="font-size:.7rem;color:var(--text-muted)">首頁已隱藏</span>');
      return `
        <div class="banner-manage-card" style="flex-direction:column;align-items:stretch;gap:.55rem">
          <div style="display:flex;align-items:center;gap:.5rem">
            <div style="font-weight:700;font-size:.86rem;flex:1">${gameName}</div>
            ${statusText}
          </div>
          <div style="display:flex;align-items:center;gap:.7rem;justify-content:space-between;flex-wrap:wrap">
            <div style="font-size:.74rem;color:var(--text-muted)">
              <div>Game Key：<span style="font-family:monospace">${gameKey || '-'}</span></div>
              <div>頁面：<span style="font-family:monospace">${escapeHTML(item.page || '-')}</span></div>
            </div>
            <label class="toggle-switch" style="margin-left:0;${disabled ? 'opacity:.45;cursor:not-allowed' : ''}">
              <input type="checkbox" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} onchange="App.toggleHomeGameVisibility('${escapeHTML(gameId)}', this.checked)">
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
      `;
    }).join('');
  },

  toggleHomeGameVisibility(configId, visible) {
    const id = String(configId || '').trim();
    if (!id) return;

    const items = this._getHomeGameManageItems();
    const target = items.find(item => item.id === id);
    if (!target) {
      this.showToast('找不到小遊戲設定');
      return;
    }

    const nextVisible = !!visible;
    ApiService.upsertGameConfig(id, {
      gameKey: target.gameKey,
      name: target.name,
      page: target.page || 'page-game',
      sortOrder: target.sortOrder,
      enabled: target.enabled !== false,
      homeVisible: nextVisible,
    });

    this.renderGameManage();
    if (typeof this.renderHomeGameShortcut === 'function') this.renderHomeGameShortcut();
    this.showToast(`首頁小遊戲已${nextVisible ? '開啟' : '關閉'}顯示`);

    if (typeof ApiService !== 'undefined' && typeof ApiService._writeOpLog === 'function') {
      ApiService._writeOpLog('game_config', '小遊戲管理', `${target.name} 首頁顯示：${nextVisible ? '開啟' : '關閉'}`);
    }
  },

});
