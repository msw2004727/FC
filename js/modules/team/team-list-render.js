/* ================================================
   SportHub — Team: Card Rendering & List Display
   依賴：config.js, api-service.js, team-list.js
   ================================================ */

Object.assign(App, {

  _teamCardHTML(t, options = {}) {
    const pinnedClass = t.pinned ? ' tc-pinned' : '';
    const color = t.color || '#6b7280';
    const rank = this._getTeamRank(t.teamExp);
    const isTeaching = typeof this._isTeamTeachingTagged === 'function'
      ? this._isTeamTeachingTagged(t)
      : t.type === 'education';
    const eduRibbon = isTeaching ? '<span class="tc-edu-ribbon">教學</span>' : '';
    const sportIcon = t.sportTag && typeof getSportIconSvg === 'function' ? getSportIconSvg(t.sportTag) : '';
    const sportBadge = sportIcon ? `<span class="tc-sport-badge">${sportIcon}</span>` : '';
    const attentionEnabled = t.attentionEffectEnabled === true;
    const attentionClass = attentionEnabled ? ' tc-attention-effect' : '';
    const attentionColor = this._normalizeTeamAttentionColor?.(t.attentionEffectColor) || '#fbbf24';
    const attentionStyle = attentionEnabled ? ` style="--tc-attention-color:${escapeHTML(attentionColor)}"` : '';
    const cardImage = this._getTeamCoverImageUrl?.(t, 'card') || this._getTeamImageUrl?.(t, 'card') || t.image || '';
    const memberLabel = I18N.t('team.memberLabel');
    const memberCountKey = String(t.id || '');
    const memberCountMap = options.memberCountByTeam;
    const memberCount = memberCountMap && memberCountMap.has(memberCountKey)
      ? memberCountMap.get(memberCountKey)
      : this._calcTeamMemberCount(t.id);
    return `
      <div class="tc-card${pinnedClass}${attentionClass}"${attentionStyle} data-team-id="${escapeHTML(t.id)}" onclick="App.openTeamDetailFromCard(this, this.dataset.teamId)">
        ${t.pinned ? '<div class="tc-pin-badge">置頂</div>' : ''}
        ${cardImage
          ? `<div style="position:relative;width:100%;aspect-ratio:1;overflow:hidden;border-radius:var(--radius) var(--radius) 0 0">${sportBadge}<img src="${escapeHTML(cardImage)}" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block"><span class="tc-rank-badge" style="color:${rank.color}"><span class="tc-rank-score">${(t.teamExp || 0).toLocaleString()}</span>${rank.rank}</span>${eduRibbon}</div>`
          : `<div class="tc-img-placeholder" style="position:relative">${sportBadge}俱樂部圖片<span class="tc-rank-badge" style="color:${rank.color}"><span class="tc-rank-score">${(t.teamExp || 0).toLocaleString()}</span>${rank.rank}</span>${eduRibbon}</div>`}
        <div class="tc-body">
          <div class="tc-name">${escapeHTML(t.name)}</div>
          <div class="tc-info-row"><span class="tc-label">${memberLabel}</span><span>${memberCount} ${I18N.t('team.personUnit')}</span></div>
          <div class="tc-info-row"><span class="tc-label">${I18N.t('team.regionLabel')}</span><span>${escapeHTML(t.region || '')}</span></div>
        </div>
      </div>`;
  },

  async openTeamDetailFromCard(cardEl, teamId, options = {}) {
    const safeTeamId = teamId || cardEl?.dataset?.teamId || '';
    if (!safeTeamId) return { ok: false, reason: 'missing-id' };
    this._markTeamCardPending?.(cardEl, safeTeamId);
    try {
      return await this.showTeamDetail(safeTeamId, options);
    } catch (err) {
      throw err;
    } finally {
      this._clearTeamCardPending?.(cardEl, 650);
    }
  },

  _teamListLastFp: '',

  renderTeamList() {
    const container = document.getElementById('team-list');
    if (!container) return;
    this._initTeamListSportFilter?.();
    this._refreshTeamCreateButtons();
    let teams = ApiService.getActiveTeams();
    const typeTab = this._currentTeamTypeTab || '';
    if (typeTab) {
      teams = teams.filter(t => {
        const isTeaching = typeof this._isTeamTeachingTagged === 'function'
          ? this._isTeamTeachingTagged(t)
          : (t.type || 'general') === 'education';
        return typeTab === 'education' ? isTeaching : !isTeaching;
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
      const teachingTag = typeof this._isTeamTeachingTagged === 'function' && this._isTeamTeachingTagged(t) ? 1 : 0;
      return t.id + '|' + (t.name || '') + '|' + (t.sportTag || '') + '|' + (t.image || '') + '|' + (t.imageVariants?.card || '') + '|' + (t.active ? 1 : 0) + '|' + (t.pinned ? 1 : 0) + '|' + teachingTag + '|' + (t.attentionEffectEnabled ? 1 : 0) + '|' + (t.attentionEffectColor || '') + '|' + (t.teamExp || 0) + '|' + memberCount;
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
      teams = ApiService.getTeams().filter(t => this._isTeamOwner(t));
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
      const canEdit = isAdmin || this._isTeamOwner(t);
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
          <div class="event-meta">
            <span class="event-meta-item">領隊 ${escapeHTML(t.leader || '未設定')}</span>
            <span class="event-meta-item">俱樂部經理 ${escapeHTML(t.captain || '未設定')}</span>
            <span class="event-meta-item">${this._calcTeamMemberCount(t.id)}人</span>
            <span class="event-meta-item">${escapeHTML(t.region)}</span>
          </div>
          ${this._renderTeamAttentionEffectControls(t, isAdmin)}
          <div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.5rem" onclick="event.stopPropagation()">
            ${canEdit ? `<button class="primary-btn small" onclick="App.showTeamForm('${t.id}')">編輯</button>` : ''}
            ${isAdmin ? `<button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem" onclick="App.toggleTeamPin('${t.id}')">${t.pinned ? '取消置頂' : '置頂'}</button>` : ''}
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
            ${t.pinned ? '<span style="font-size:.72rem;color:var(--warning);font-weight:600">置頂</span>' : ''}
          </div>
          <div class="event-meta">
            <span class="event-meta-item">領隊 ${escapeHTML(t.leader || '未設定')}</span>
            <span class="event-meta-item">俱樂部經理 ${escapeHTML(t.captain || '未設定')}</span>
            <span class="event-meta-item">${this._calcTeamMemberCount(t.id)}人</span>
            <span class="event-meta-item">${escapeHTML(t.region)}</span>
            <span class="event-meta-item" style="color:${t.active ? 'var(--success)' : 'var(--danger)'}">${t.active ? '上架中' : '已下架'}</span>
          </div>
          ${this._renderTeamAttentionEffectControls(t, true)}
          <div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.5rem" onclick="event.stopPropagation()">
            <button class="primary-btn small" onclick="App.showTeamForm('${t.id}')">編輯</button>
            <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem" onclick="App.toggleTeamPin('${t.id}')">${t.pinned ? '取消置頂' : '置頂'}</button>
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
  _teamCardLoadingState: null,

  _markTeamCardPending(cardEl, teamId) {
    if (!cardEl || !cardEl.classList) return;
    cardEl.classList.add('is-pending');
    cardEl.setAttribute('aria-busy', 'true');
    // Inject bar into first child (image area)
    var imgArea = cardEl.querySelector('[style*="aspect-ratio"]') || cardEl.querySelector('.tc-img-placeholder');
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
      panel.innerHTML = '<span class="tc-loading-spinner" aria-hidden="true"></span>' +
        '<span class="tc-loading-copy"><strong>資料更新中</strong><span>正在整理俱樂部最新內容</span></span>';
      cardEl.appendChild(panel);
    }
    // Start simulated progress
    var loadingTeamId = teamId || cardEl.dataset?.teamId || '';
    if (!this._teamCardLoadingState || this._teamCardLoadingState.teamId !== loadingTeamId) {
      clearInterval(this._teamCardLoadingState?.interval);
      var state = { teamId: loadingTeamId, cardEl: cardEl, progress: 0, startedAt: Date.now(), interval: null };
      state.interval = setInterval(function () {
        var p = state.progress;
        var inc = p < 30 ? 4 : p < 60 ? 2 : p < 80 ? 0.5 : 0.15;
        state.progress = Math.min(p + inc, 85);
        if (cardEl) {
          var f = cardEl.querySelector('.tc-loading-fill');
          if (f) f.style.width = state.progress + '%';
        }
      }, 100);
      this._teamCardLoadingState = state;
    }
  },

  _clearTeamCardPending(cardEl, minVisibleMs) {
    var state = this._teamCardLoadingState;
    var ownsState = !!state && (!state.cardEl || state.cardEl === cardEl);
    if (ownsState) {
      clearInterval(state.interval);
      state.interval = null;
    }
    var elapsed = ownsState ? Date.now() - state.startedAt : 0;
    var waitMs = Math.max(0, (minVisibleMs || 0) - elapsed);
    var self = this;
    setTimeout(function () {
      if (!cardEl) {
        if (ownsState && self._teamCardLoadingState === state) self._teamCardLoadingState = null;
        return;
      }
      var fill = cardEl.querySelector('.tc-loading-fill');
      if (fill) fill.style.width = '100%';
      setTimeout(function () {
        if (cardEl) cardEl.classList.add('is-loaded');
        setTimeout(function () {
          if (cardEl) {
            cardEl.classList.remove('is-pending', 'is-loaded');
            cardEl.removeAttribute('aria-busy');
            var bar = cardEl.querySelector('.tc-loading-bar');
            if (bar) bar.remove();
            var panel = cardEl.querySelector('.tc-loading-panel');
            if (panel) panel.remove();
          }
          if (ownsState && self._teamCardLoadingState === state) self._teamCardLoadingState = null;
        }, 400);
      }, 350);
    }, waitMs);
  },

});
