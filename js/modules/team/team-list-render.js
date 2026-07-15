/* ================================================
   SportHub — Team: Card Rendering & List Display
   依賴：config.js, api-service.js, team-list.js
   ================================================ */

Object.assign(App, {

  _teamCardHTML(t, options = {}) {
    const pinnedClass = t.pinned ? ' tc-pinned' : '';
    const color = t.color || '#6b7280';
    const rank = this._getTeamRank(t.teamExp);
    const categoryMeta = typeof this._getTeamCategoryMeta === 'function'
      ? this._getTeamCategoryMeta(t)
      : (t.type === 'none'
        ? { key: 'none', label: '', ribbonClass: '' }
        : { key: t.type === 'education' ? 'education' : 'competitive', label: t.type === 'education' ? '教學' : '競技', ribbonClass: t.type === 'education' ? 'tc-type-ribbon-education' : 'tc-type-ribbon-competitive' });
    const hasCategoryRibbon = !!(categoryMeta && categoryMeta.ribbonClass && categoryMeta.label);
    const categoryRibbonClass = hasCategoryRibbon && categoryMeta.key === 'education'
      ? 'tc-type-ribbon tc-edu-ribbon ' + categoryMeta.ribbonClass
      : (hasCategoryRibbon ? 'tc-type-ribbon ' + categoryMeta.ribbonClass : '');
    const typeRibbon = hasCategoryRibbon
      ? '<span class="' + categoryRibbonClass + '">' + escapeHTML(categoryMeta.label) + '</span>'
      : '';
    const sportIcon = t.sportTag && typeof getSportIconSvg === 'function' ? getSportIconSvg(t.sportTag) : '';
    const sportBadge = sportIcon ? `<span class="tc-sport-badge">${sportIcon}</span>` : '';
    const attentionEnabled = t.attentionEffectEnabled === true;
    const attentionClass = attentionEnabled ? ' tc-attention-effect' : '';
    const attentionColor = this._normalizeTeamAttentionColor?.(t.attentionEffectColor) || '#fbbf24';
    const themeColor = this._getTeamThemeColor?.(t) || '';
    const themeOverlayEnabled = !themeColor || this._isTeamThemeOverlayEnabled?.(t) !== false;
    const themeClass = themeColor ? ' tc-themed' + (themeOverlayEnabled ? '' : ' tc-theme-no-overlay') : '';
    const styleVars = [];
    if (attentionEnabled) styleVars.push(`--tc-attention-color:${escapeHTML(attentionColor)}`);
    if (themeColor) styleVars.push(`--team-theme-color:${escapeHTML(themeColor)}`);
    const cardStyle = styleVars.length ? ` style="${styleVars.join(';')}"` : '';
    const cardImage = this._getTeamCoverImageUrl?.(t, 'card') || this._getTeamImageUrl?.(t, 'card') || t.image || '';
    const memberLabel = I18N.t('team.memberLabel');
    const memberCountKey = String(t.id || '');
    const memberCountMap = options.memberCountByTeam;
    const memberCount = memberCountMap && memberCountMap.has(memberCountKey)
      ? memberCountMap.get(memberCountKey)
      : this._calcTeamMemberCount(t.id);
    const pinRail = t.pinned
      ? '<div class="tc-pin-rail" aria-label="置頂俱樂部"><span class="tc-pin-mark" aria-hidden="true"></span><span>置頂</span></div>'
      : '';
    return `
      <div class="tc-card${pinnedClass}${attentionClass}${themeClass}"${cardStyle} data-team-id="${escapeHTML(t.id)}" onclick="App.openTeamDetailFromCard(this, this.dataset.teamId)">
        ${pinRail}
        ${cardImage
          ? `<div class="tc-card-media">${sportBadge}<img src="${escapeHTML(cardImage)}" width="1000" height="1000" loading="lazy" decoding="async"><span class="tc-rank-badge" style="color:${rank.color}"><span class="tc-rank-score">${(t.teamExp || 0).toLocaleString()}</span>${rank.rank}</span>${typeRibbon}</div>`
          : `<div class="tc-card-media tc-img-placeholder">${sportBadge}俱樂部圖片<span class="tc-rank-badge" style="color:${rank.color}"><span class="tc-rank-score">${(t.teamExp || 0).toLocaleString()}</span>${rank.rank}</span>${typeRibbon}</div>`}
        <div class="tc-body">
          <div class="tc-name">${escapeHTML(t.name)}</div>
          <div class="tc-info-row"><span class="tc-label">${memberLabel}</span><span>${memberCount} ${I18N.t('team.personUnit')}</span></div>
          <div class="tc-info-row"><span class="tc-label">${I18N.t('team.regionLabel')}</span><span>${escapeHTML(t.region || '')}</span></div>
        </div>
      </div>`;
  },

  _isTeamCardOpenFlightReusable(flight, teamId) {
    if (!flight?.promise || flight.invalidated || flight.teamId !== teamId) return false;

    const currentTransitionSeq = Number(this._pageTransitionSeq);
    const navigationTransitionSeq = Number(flight.navigationTransitionSeq);
    if (Number.isSafeInteger(navigationTransitionSeq) && navigationTransitionSeq > 0
      && Number.isSafeInteger(currentTransitionSeq)) {
      return navigationTransitionSeq === currentTransitionSeq;
    }

    if (flight.originPageId && this.currentPage !== flight.originPageId) return false;
    const originTransitionSeq = Number(flight.originTransitionSeq);
    if (Number.isSafeInteger(originTransitionSeq) && originTransitionSeq > 0
      && Number.isSafeInteger(currentTransitionSeq)) {
      return originTransitionSeq === currentTransitionSeq;
    }
    return true;
  },

  _invalidateTeamCardOpenFlight(reason = 'page-context-changed') {
    const flight = this._teamCardOpenFlight;
    if (!flight) return false;
    flight.invalidated = true;
    flight.invalidatedReason = reason;
    this._teamCardOpenFlight = null;
    this._clearTeamCardPending?.(flight.cardEl, flight.token);
    return true;
  },

  async openTeamDetailFromCard(cardEl, teamId, options = {}) {
    const safeTeamId = String(teamId || cardEl?.dataset?.teamId || '').trim();
    if (!safeTeamId) return { ok: false, reason: 'missing-id' };

    const activeFlight = this._teamCardOpenFlight;
    if (this._isTeamCardOpenFlightReusable(activeFlight, safeTeamId)) {
      if (activeFlight.cardEl !== cardEl) {
        this._clearTeamCardPending?.(activeFlight.cardEl, activeFlight.token);
        activeFlight.cardEl = cardEl;
      }
      this._markTeamCardPending?.(cardEl, safeTeamId, {
        token: activeFlight.token,
        immediate: true,
      });
      return await activeFlight.promise;
    }

    if (activeFlight?.cardEl) {
      this._clearTeamCardPending?.(activeFlight.cardEl, activeFlight.token);
    }

    const token = ++this._teamCardOpenSeq;
    const flight = {
      token,
      teamId: safeTeamId,
      cardEl,
      originPageId: this.currentPage || '',
      originTransitionSeq: Number(this._pageTransitionSeq),
      navigationTransitionSeq: 0,
      invalidated: false,
      promise: null,
    };
    this._teamCardOpenFlight = flight;
    this._markTeamCardPending?.(cardEl, safeTeamId, { token });

    const openPromise = Promise.resolve()
      .then(() => {
        const routePromise = this.showTeamDetail(safeTeamId, options);
        const claimedTransitionSeq = Number(this._pageTransitionSeq);
        if (!flight.invalidated
          && Number.isSafeInteger(claimedTransitionSeq)
          && claimedTransitionSeq > 0) {
          flight.navigationTransitionSeq = claimedTransitionSeq;
        }
        return routePromise;
      });
    flight.promise = openPromise;
    try {
      return await openPromise;
    } catch (err) {
      if (this._teamCardOpenFlight === flight) {
        console.error('[TeamCard] detail navigation failed:', err);
        this.showToast?.('俱樂部頁面載入失敗，請稍後再試');
      }
      return { ok: false, reason: 'route-error', error: err };
    } finally {
      this._clearTeamCardPending?.(flight.cardEl, token);
      if (this._teamCardOpenFlight === flight) {
        this._teamCardOpenFlight = null;
      }
    }
  },

  _teamListLastFp: '',

  renderTeamList() {
    const container = document.getElementById('team-list');
    if (!container) return;
    // 列表重建代表舊 card/page context 已失效；底層 promise 可收尾，但不可攔住新點擊。
    this._invalidateTeamCardOpenFlight?.('team-list-render');
    // bfcache / fingerprint fast path 會沿用既有 DOM，先同步清掉上次導航殘留狀態。
    this._clearTeamCardPendings?.(container);
    this._initTeamListSportFilter?.();
    this._syncTeamFilterPanelState?.();
    this._refreshTeamCreateButtons();
    let teams = ApiService.getActiveTeams();
    const typeTab = this._currentTeamTypeTab || '';
    if (typeTab) {
      const targetType = typeof this._normalizeTeamCategory === 'function'
        ? this._normalizeTeamCategory(typeTab)
        : typeTab;
      teams = teams.filter(t => {
        const meta = typeof this._getTeamCategoryMeta === 'function'
          ? this._getTeamCategoryMeta(t)
          : { key: t.type === 'none' ? 'none' : (t.type === 'education' ? 'education' : (t.type === 'leisure' ? 'leisure' : 'competitive')) };
        return meta.key === targetType;
      });
    }
    const activeTeamSport = this._syncTeamSportFilterWithGlobal?.() || this._getActiveTeamGlobalSport?.() || '';
    if (activeTeamSport) {
      teams = teams.filter(t => t.sportTag === activeTeamSport);
    }
    const sorted = this._sortTeams(teams);
    const memberCountByTeam = this._buildTeamMemberCountMap?.(sorted, ApiService.getAdminUsers() || []) || null;

    // Phase 2B §8.2B：指紋跳過重繪
    var fp = sorted.map(t => {
      const memberCount = memberCountByTeam && memberCountByTeam.has(String(t.id || ''))
        ? memberCountByTeam.get(String(t.id || ''))
        : '';
      const categoryKey = typeof this._getTeamCategoryMeta === 'function' ? (this._getTeamCategoryMeta(t)?.key || '') : (t.type || '');
      return t.id + '|' + (t.name || '') + '|' + (t.sportTag || '') + '|' + (t.image || '') + '|' + (t.imageVariants?.card || '') + '|' + (t.active ? 1 : 0) + '|' + (t.pinned ? 1 : 0) + '|' + categoryKey + '|' + (t.attentionEffectEnabled ? 1 : 0) + '|' + (t.attentionEffectColor || '') + '|' + (t.themeColor || '') + '|' + (t.themeOverlayEnabled === false ? 0 : 1) + '|' + (t.teamExp || 0) + '|' + memberCount;
    }).join(',');
    if (this._teamListLastFp === fp && container.children.length > 0) return;
    this._teamListLastFp = fp;

    var _tlScrollEl = document.scrollingElement || document.documentElement;
    var _tlSavedScroll = _tlScrollEl.scrollTop;
    container.innerHTML = sorted.length > 0
      ? sorted.map(t => this._teamCardHTML(t, { memberCountByTeam })).join('')
      : '<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--text-muted);font-size:.85rem">此類型尚無俱樂部</div>';
    _tlScrollEl.scrollTop = _tlSavedScroll;
    this._markPageSnapshotReady?.('page-teams');
    this._scheduleVisibleDetailPrefetch?.('teams', sorted.map(t => t.id || t._docId).filter(Boolean));

  },

  // ══════════════════════════════════
  //  Team Manage Page (Captain+)
  // ══════════════════════════════════

  _buildTeamManageTitleHtml(t, sportIcon) {
    const nameEn = String(t?.nameEn || '').trim();
    return '<div class="event-card-title team-manage-title">' +
      '<span class="team-manage-title-main">' + (sportIcon ? sportIcon + ' ' : '') + escapeHTML(t?.name || '') + '</span>' +
      (nameEn ? '<span class="team-manage-title-en">' + escapeHTML(nameEn) + '</span>' : '') +
      '</div>';
  },

  _renderTeamAttentionEffectControls(t, isAdmin) {
    if (!isAdmin || !t) return '';
    const checked = t.attentionEffectEnabled === true ? ' checked' : '';
    const color = this._normalizeTeamAttentionColor?.(t.attentionEffectColor) || '#fbbf24';
    return '<div class="team-attention-controls" onclick="event.stopPropagation()">' +
      '<div class="team-attention-label-wrap">' +
        '<span class="team-attention-label">\u5149\u8de1\u6548\u679c</span>' +
        '<span class="team-attention-hint">\u958b\u555f\u5f8c\u4ff1\u6a02\u90e8\u5361\u7247\u6703\u986f\u793a\u6d41\u52d5\u5149\u8de1</span>' +
      '</div>' +
      '<label class="td-settings-switch team-attention-switch" aria-label="\u5149\u8de1\u6548\u679c">' +
        '<input type="checkbox"' + checked + ' onchange="App.toggleTeamAttentionEffect(\'' + escapeHTML(t.id) + '\', this.checked, this)">' +
        '<span class="td-settings-switch-track"><span class="td-settings-switch-thumb"></span></span>' +
      '</label>' +
      '<label class="team-attention-color" aria-label="\u5149\u8de1\u984f\u8272">' +
        '<span>\u984f\u8272</span>' +
        '<input type="color" value="' + escapeHTML(color) + '" onchange="App.changeTeamAttentionEffectColor(\'' + escapeHTML(t.id) + '\', this.value, this)">' +
      '</label>' +
    '</div>';
  },

  renderTeamManage() {
    const container = document.getElementById('team-manage-list');
    if (!container) return;
    this._refreshTeamCreateButtons();

    const isAdmin = this.hasPermission('team.manage_all');

    let teams;
    if (isAdmin) {
      teams = ApiService.getTeams();
    } else {
      teams = ApiService.getTeams().filter(t => this._canAccessTeamManageRecord?.(t));
    }

    // 2026-04-25：管理頁尊重全域 sport picker（與 renderTeamList 一致）
    const manageSport = this._getActiveTeamGlobalSport?.() || '';
    if (manageSport) teams = teams.filter(t => t.sportTag === manageSport);

    if (!teams.length) {
      container.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted);font-size:.85rem">尚無俱樂部資料</div>';
      return;
    }

    const activeTeams = this._sortTeams(teams.filter(t => t.active));
    const inactiveTeams = this._sortTeams(teams.filter(t => !t.active));
    const renderCard = (t) => {
      const canEdit = this._canEditTeamByRoleOrCaptain?.(t);
      const dim = !t.active ? ' team-inactive' : '';
      const mSportIcon = t.sportTag && typeof getSportIconSvg === 'function' ? (getSportIconSvg(t.sportTag, 'team-title-sport-icon') || '') : '';
      return `
      <div class="event-card${dim}" onclick="App.showTeamDetail('${t.id}')" style="cursor:pointer">
        <div class="event-card-body">
          <div style="display:flex;justify-content:space-between;align-items:center">
            ${this._buildTeamManageTitleHtml(t, mSportIcon)}
            <div style="display:flex;gap:.4rem;align-items:center">
              ${isAdmin && t.pinned ? '<span style="font-size:.72rem;color:var(--warning);font-weight:600">置頂</span>' : ''}
              <span style="font-size:.72rem;color:${t.active ? 'var(--success)' : 'var(--danger)'}">${t.active ? '上架中' : '已下架'}</span>
            </div>
          </div>
          ${this._renderTeamAttentionEffectControls(t, isAdmin)}
          <div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.5rem" onclick="event.stopPropagation()">
            ${canEdit ? `<button class="primary-btn small" onclick="App.showTeamForm('${t.id}')">編輯</button>` : ''}
            ${isAdmin ? `<button class="outline-btn team-pin-btn${t.pinned ? ' is-pinned' : ''}" type="button" onclick="App.toggleTeamPin('${t.id}')">${t.pinned ? '已置頂' : '置頂'}</button>` : ''}
            ${isAdmin ? `<button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem" onclick="App.toggleTeamActive('${t.id}')">${t.active ? '下架' : '上架'}</button>` : ''}
            ${canEdit ? `<button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem;color:var(--danger)" onclick="App.removeTeam(this, '${t.id}')">刪除</button>` : ''}
          </div>
        </div>
      </div>`;
    };
    let html = activeTeams.map(renderCard).join('');
    if (inactiveTeams.length) {
      html += '<hr class="team-section-divider"><div class="team-section-label">已下架俱樂部</div>';
      html += inactiveTeams.map(renderCard).join('');
    }
    container.innerHTML = html;
  },

  // ══════════════════════════════════
  //  Admin Team Management
  // ══════════════════════════════════

  renderAdminTeams(searchQuery) {
    const container = document.getElementById('admin-team-list');
    if (!container) return;
    const q = searchQuery || '';
    let teams = ApiService.getTeams();
    if (q) teams = teams.filter(t =>
      t.name.toLowerCase().includes(q) ||
      (t.nameEn || '').toLowerCase().includes(q) ||
      (t.captain || '').toLowerCase().includes(q) ||
      (t.leader || '').toLowerCase().includes(q) ||
      (t.region || '').toLowerCase().includes(q)
    );
    // 2026-04-25：管理頁尊重全域 sport picker（與 renderTeamList 一致）
    const adminSport = this._getActiveTeamGlobalSport?.() || '';
    if (adminSport) teams = teams.filter(t => t.sportTag === adminSport);
    if (!teams.length) {
      container.innerHTML = '<div style="padding:1rem;font-size:.82rem;color:var(--text-muted);text-align:center">未找到符合條件的俱樂部</div>';
      return;
    }
    const activeT = this._sortTeams(teams.filter(t => t.active));
    const inactiveT = this._sortTeams(teams.filter(t => !t.active));
    const adminCard = (t) => {
      const dim = !t.active ? ' team-inactive' : '';
      const aSportIcon = t.sportTag && typeof getSportIconSvg === 'function' ? (getSportIconSvg(t.sportTag, 'team-title-sport-icon') || '') : '';
      return `
      <div class="event-card${dim}" onclick="App.showTeamDetail('${t.id}')" style="cursor:pointer">
        <div class="event-card-body">
          <div style="display:flex;justify-content:space-between;align-items:center">
            ${this._buildTeamManageTitleHtml(t, aSportIcon)}
            <div style="display:flex;gap:.4rem;align-items:center">
              ${t.pinned ? '<span style="font-size:.72rem;color:var(--warning);font-weight:600">置頂</span>' : ''}
              <span style="font-size:.72rem;color:${t.active ? 'var(--success)' : 'var(--danger)'}">${t.active ? '上架中' : '已下架'}</span>
            </div>
          </div>
          ${this._renderTeamAttentionEffectControls(t, true)}
          <div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.5rem" onclick="event.stopPropagation()">
            <button class="primary-btn small" onclick="App.showTeamForm('${t.id}')">編輯</button>
            <button class="outline-btn team-pin-btn${t.pinned ? ' is-pinned' : ''}" type="button" onclick="App.toggleTeamPin('${t.id}')">${t.pinned ? '已置頂' : '置頂'}</button>
            <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem" onclick="App.toggleTeamActive('${t.id}')">${t.active ? '下架' : '上架'}</button>
            <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem" onclick="App.showTeamDetail('${t.id}')">查看</button>
            <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem;color:var(--danger)" onclick="App.removeTeam(this, '${t.id}')">刪除</button>
          </div>
        </div>
      </div>`;
    };
    let html = activeT.map(adminCard).join('');
    if (inactiveT.length) {
      html += '<hr class="team-section-divider"><div class="team-section-label">已下架俱樂部</div>';
      html += inactiveT.map(adminCard).join('');
    }
    container.innerHTML = html;
    this._markPageSnapshotReady?.('page-admin-teams');
  },

  // ── 從 team-form-init.js 搬入（渲染時初始化篩選器）──

  _initTeamListSportFilter() {
    const sel = document.getElementById('team-sport-filter');
    if (!sel || sel.dataset.inited) return;
    sel.dataset.inited = '1';
    (Array.isArray(EVENT_SPORT_OPTIONS) ? EVENT_SPORT_OPTIONS : []).forEach(item => {
      const emoji = (typeof SPORT_ICON_EMOJI !== 'undefined' ? SPORT_ICON_EMOJI[item.key] : '') || '';
      const opt = document.createElement('option');
      opt.value = item.key;
      opt.textContent = emoji ? emoji + ' ' + item.label : item.label;
      sel.appendChild(opt);
    });
  },

  // ══════════════════════════════════
  //  §8.2D Loading Progress Bar
  // ══════════════════════════════════
  _teamCardOpenSeq: 0,
  _teamCardOpenFlight: null,
  _teamCardLoadingState: null,
  _teamCardPendingDelayMs: 150,

  _showTeamCardPending(state) {
    if (!state || this._teamCardLoadingState !== state) return;
    var cardEl = state.cardEl;
    if (!cardEl || !cardEl.classList || cardEl.isConnected === false) {
      this._clearTeamCardPending?.(cardEl, state.token);
      return;
    }

    clearTimeout(state.delayTimer);
    state.delayTimer = null;
    if (state.visible) return;

    state.visible = true;
    state.startedAt = Date.now();
    cardEl.classList.add('is-pending');
    cardEl.setAttribute('aria-busy', 'true');

    var imgArea = cardEl.querySelector('.tc-card-media')
      || cardEl.querySelector('[style*="aspect-ratio"]')
      || cardEl.querySelector('.tc-img-placeholder');
    if (imgArea && !imgArea.querySelector('.tc-loading-bar')) {
      var bar = document.createElement('div');
      bar.className = 'tc-loading-bar';
      var fill = document.createElement('div');
      fill.className = 'tc-loading-fill';
      bar.appendChild(fill);
      imgArea.appendChild(bar);
    }

    if (!cardEl.querySelector('.tc-loading-panel')) {
      var panel = document.createElement('div');
      panel.className = 'tc-loading-panel';
      panel.innerHTML = '<span class="tc-loading-spinner" aria-hidden="true"></span>'
        + '<span class="tc-loading-copy"><strong>資料更新中</strong>'
        + '<span>正在整理俱樂部最新內容</span></span>';
      cardEl.appendChild(panel);
    }

    state.interval = setInterval(function () {
      var p = state.progress;
      var inc = p < 30 ? 4 : p < 60 ? 2 : p < 80 ? 0.5 : 0.15;
      state.progress = Math.min(p + inc, 85);
      var fill = cardEl.querySelector('.tc-loading-fill');
      if (fill) fill.style.width = state.progress + '%';
    }, 100);
  },

  _markTeamCardPending(cardEl, teamId, options = {}) {
    if (!cardEl || !cardEl.classList) return;

    var token = Number(options.token) || ++this._teamCardOpenSeq;
    var existing = this._teamCardLoadingState;
    if (existing && existing.cardEl === cardEl && existing.token === token) {
      if (options.immediate) this._showTeamCardPending(existing);
      return;
    }
    if (existing) {
      this._clearTeamCardPending(existing.cardEl, existing.token);
    }

    var state = {
      token,
      teamId: teamId || cardEl.dataset?.teamId || '',
      cardEl,
      progress: 0,
      startedAt: 0,
      delayTimer: null,
      interval: null,
      visible: false,
    };
    cardEl.dataset.teamLoadingToken = String(token);
    this._teamCardLoadingState = state;

    if (options.immediate) {
      this._showTeamCardPending(state);
      return;
    }
    var self = this;
    state.delayTimer = setTimeout(function () {
      self._showTeamCardPending(state);
    }, Math.max(0, Number(this._teamCardPendingDelayMs) || 150));
  },

  _clearTeamCardPending(cardEl, token) {
    var state = this._teamCardLoadingState;
    var safeToken = Number(token) || 0;
    var cardToken = Number(cardEl?.dataset?.teamLoadingToken) || 0;
    if (safeToken && cardToken && safeToken !== cardToken) return false;

    var ownsState = !!state
      && state.cardEl === cardEl
      && (!safeToken || state.token === safeToken);
    if (ownsState) {
      clearTimeout(state.delayTimer);
      clearInterval(state.interval);
      state.delayTimer = null;
      state.interval = null;
      this._teamCardLoadingState = null;
    }
    if (!cardEl || !cardEl.classList) return ownsState;

    cardEl.classList.remove('is-pending', 'is-loaded');
    cardEl.removeAttribute('aria-busy');
    delete cardEl.dataset.teamLoadingToken;
    cardEl.querySelector('.tc-loading-bar')?.remove();
    cardEl.querySelector('.tc-loading-panel')?.remove();
    return true;
  },

  _clearTeamCardPendings(container) {
    var scope = container && typeof container.querySelectorAll === 'function'
      ? container
      : document;
    var cards = Array.from(scope.querySelectorAll(
      '.tc-card.is-pending, .tc-card[aria-busy="true"], .tc-card[data-team-loading-token]'
    ));
    var activeCard = this._teamCardLoadingState?.cardEl;
    if (activeCard && !cards.includes(activeCard)) cards.push(activeCard);
    cards.forEach(card => this._clearTeamCardPending(card));
  },

});
