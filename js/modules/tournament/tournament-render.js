/* ================================================
   SportHub — Tournament: List & Home Carousel
   Detail view → tournament-detail.js
   ================================================ */

Object.assign(App, {

  /** 動態載入 tournament 群組後開啟賽事詳情（供首頁 / 收藏等尚未載入 tournament-detail.js 時使用） */
  async _openTournamentDetail(id) {
    return await this.showTournamentDetail(id);
  },

  _getTournamentHomeSortTime(tournament) {
    if (!tournament) return 0;
    const values = [
      tournament.regStart,
      tournament.createdAt,
      tournament.updatedAt,
    ];
    return values.reduce((best, value) => {
      let time = 0;
      if (value && typeof value.toMillis === 'function') time = value.toMillis();
      else if (value && typeof value.seconds === 'number') time = value.seconds * 1000;
      else if (value) {
        const parsed = Date.parse(String(value));
        time = Number.isFinite(parsed) ? parsed : 0;
      }
      return Math.max(best, time || 0);
    }, 0);
  },

  renderOngoingTournaments(options = {}) {
    const container = document.getElementById('ongoing-tournaments');
    if (!container) return;
    const priorityLimit = Math.max(0, Number(options?.priorityLimit || 0));
    const allOngoing = ApiService.getTournaments()
      .map(t => this.getFriendlyTournamentRecord?.(t) || t)
      .filter(t => !this.isTournamentEnded(t))
      .sort((a, b) => {
        const ad = this._getTournamentHomeSortTime(a);
        const bd = this._getTournamentHomeSortTime(b);
        if (ad !== bd) return bd - ad;
        return (a.name || '').localeCompare(b.name || '');
      });
    const ongoing = priorityLimit > 0 ? allOngoing.slice(0, priorityLimit) : allOngoing;
    const fingerprint = ongoing.map(t => [
      t.id || t._docId || '',
      t.name || '',
      t.image || '',
      t.type || '',
      t.sportTag || '',
      t.teams || '',
      t.status || '',
      t.ended ? '1' : '0',
    ].join('|')).join(',') + '|limit:' + (priorityLimit || 'all');

    // ── 已渲染且 ID 完全相同 → 跳過，避免封面圖重載 ──
    if (this._ongoingTournamentsHomeFp === fingerprint && container.querySelector('.h-card:not(.skeleton)')) return;
    this._ongoingTournamentsHomeFp = fingerprint;

    this._setHomeSectionVisibility?.(container, ongoing.length > 0);
    if (ongoing.length === 0) {
      container.innerHTML = '';
      return;
    }
    container.innerHTML = ongoing.map((t, index) => {
      const imagePriorityAttrs = index < 3
        ? 'loading="eager" fetchpriority="auto" decoding="async"'
        : 'loading="lazy" decoding="async"';
      const sportIcon = this._renderTournamentSportIcon?.(t, 'h-card-sport-chip') || '';
      const cornerBadges = sportIcon ? `<div class="h-card-corner-badges">${sportIcon}</div>` : '';
      return `
      <div class="h-card" onclick="App._openTournamentDetail('${t.id}')">
        ${t.image
          ? `<div class="h-card-img">${cornerBadges}<img src="${escapeHTML(t.image)}" alt="${escapeHTML(t.name)}" width="1200" height="450" ${imagePriorityAttrs}></div>`
          : `<div class="h-card-img h-card-placeholder">${cornerBadges}220 × 90</div>`}
        <div class="h-card-body">
          <div class="h-card-title">${escapeHTML(t.name)}</div>
          <div class="h-card-meta">
            <span>${escapeHTML(t.type)}</span>
            <span>${t.teams} ${I18N.t('tournament.teamUnit')}</span>
          </div>
        </div>
      </div>
    `;
    }).join('');
    this._scheduleVisibleDetailPrefetch?.('tournaments', ongoing.map(t => t.id || t._docId).filter(Boolean));
  },

  _tcActiveTab: 'active',

  switchTournamentCenterTab(tab) {
    this._tcActiveTab = tab;
    document.querySelectorAll('#tc-tabs .tab').forEach(el => {
      el.classList.toggle('active', el.dataset.tctab === tab);
    });
    this.renderTournamentTimeline();
  },

  _tcFilterTimer: null,
  _tcFilterExpanded: false,

  _hasActiveTournamentCenterFilters() {
    return !!(
      (document.getElementById('tc-search')?.value || '').trim() ||
      (document.getElementById('tc-region-filter')?.value || '')
    );
  },

  _syncTournamentCenterFilterPanelState() {
    const panel = document.getElementById('tc-filter-panel');
    const btn = document.getElementById('tc-filter-toggle-btn');
    const isOpen = !!panel && panel.hidden !== true;
    const isActive = isOpen || this._hasActiveTournamentCenterFilters();
    this._tcFilterExpanded = isOpen;
    if (panel) panel.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    if (btn) {
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }
  },

  toggleTournamentCenterFilterPanel(force) {
    const panel = document.getElementById('tc-filter-panel');
    if (!panel) return;
    const nextOpen = typeof force === 'boolean' ? force : panel.hidden === true;
    panel.hidden = !nextOpen;
    this._tcFilterExpanded = nextOpen;
    this._syncTournamentCenterFilterPanelState();
    if (nextOpen) {
      const focusSearch = () => document.getElementById('tc-search')?.focus?.({ preventScroll: true });
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(focusSearch);
      else setTimeout(focusSearch, 0);
    }
  },

  filterTournamentCenter() {
    this._syncTournamentCenterFilterPanelState?.();
    clearTimeout(this._tcFilterTimer);
    this._tcFilterTimer = setTimeout(() => this.renderTournamentTimeline(), 300);
  },

  _tournamentsRenderSeq: 0,
  _tournamentListLastFp: '',

  _getTournamentListTimestampMs(value) {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.seconds === 'number') return value.seconds * 1000;
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
  },

  _formatTournamentListAge(ageMs) {
    const safeAge = Math.max(0, Number(ageMs) || 0);
    if (safeAge < 60 * 1000) return '剛剛';
    if (safeAge < 60 * 60 * 1000) return Math.floor(safeAge / (60 * 1000)) + ' 分鐘前';
    if (safeAge < 24 * 60 * 60 * 1000) return Math.floor(safeAge / (60 * 60 * 1000)) + ' 小時前';
    return Math.floor(safeAge / (24 * 60 * 60 * 1000)) + ' 天前';
  },

  _getTournamentListFreshnessState(sourceTournaments = []) {
    const rows = Array.isArray(sourceTournaments) ? sourceTournaments : [];
    const service = typeof FirebaseService !== 'undefined' ? FirebaseService : null;
    if (!service) {
      return { visible: false, fingerprint: 'no-service', hasRows: rows.length > 0 };
    }

    const freshAt = Number(service._tournamentFreshAt || 0);
    const cacheAt = Number(service._collectionLoadedAt?.tournaments || 0);
    const source = service._tournamentCacheSource || (freshAt ? 'server' : (service._cacheRestored ? 'local' : ''));
    const hasServerSnapshot = !!service._tournamentSnapshotReady || !!freshAt || source === 'server';
    const hasRows = rows.length > 0;
    const failed = !!service._bootCollectionLoadFailed?.tournaments;
    const isLocalCache = hasRows && source === 'local' && !hasServerSnapshot;
    const isSyncing = !failed && (!hasServerSnapshot || isLocalCache);
    const ageBase = freshAt || cacheAt || 0;
    const ageMs = ageBase ? Math.max(0, Date.now() - ageBase) : 0;
    const ageText = ageBase ? this._formatTournamentListAge(ageMs) : '';
    const isServerFresh = hasServerSnapshot && !isLocalCache;

    let label = '';
    let ageLabel = '';
    let state = 'syncing';
    if (failed) {
      state = 'warn';
      label = hasRows ? '顯示快取資料，連線恢復後會自動更新' : '暫時無法同步賽事資料';
      ageLabel = ageText ? '快取 ' + ageText : '';
    } else if (isLocalCache) {
      state = 'syncing';
      label = '先顯示上次賽事，正在同步最新資料';
      ageLabel = ageText ? '快取 ' + ageText : '';
    } else if (isServerFresh) {
      state = 'fresh';
      label = '賽事資料已同步';
      ageLabel = ageText ? ageText + '更新' : '剛剛更新';
    } else {
      state = 'syncing';
      label = '正在同步最新賽事';
      ageLabel = '';
    }

    return {
      visible: hasRows || isSyncing || failed,
      state,
      label,
      ageLabel,
      ageMs,
      hasRows,
      isSyncing,
      isServerFresh,
      isLocalCache,
      hasServerSnapshot,
      failed,
      fingerprint: [state, source || 'none', hasServerSnapshot ? 'server' : 'pending', Math.floor(ageMs / 60000), failed ? 'err' : 'ok'].join('|'),
    };
  },

  _renderTournamentListFreshnessBadge(state) {
    if (!state || !state.visible) return '';
    const safeState = escapeHTML(state.state || 'syncing');
    const label = escapeHTML(state.label || '');
    const age = state.ageLabel ? `<span class="tc-freshness-age">${escapeHTML(state.ageLabel)}</span>` : '';
    return `
      <div class="tc-freshness-strip" data-state="${safeState}" role="status" aria-live="polite">
        <span class="tc-freshness-dot" aria-hidden="true"></span>
        <span class="tc-freshness-label">${label}</span>
        ${age}
      </div>`;
  },

  _shouldShowTournamentInitialLoading(state, sourceTournaments = []) {
    if ((sourceTournaments || []).length > 0) return false;
    if (!state) return false;
    if (state.failed || state.hasServerSnapshot || state.isServerFresh) return false;
    return true;
  },

  _renderTournamentListLoading() {
    return `
      <div class="tc-list-loading" aria-busy="true">
        <div class="tc-list-loading-title">載入賽事資料中</div>
        <div class="tc-list-loading-sub">正在同步最新賽事，若有快取會立即顯示。</div>
        <div class="tc-list-skeleton"><span></span><span></span><span></span></div>
      </div>`;
  },

  renderTournamentTimeline() {
    const container = document.getElementById('tournament-timeline');
    if (!container) return;
    this._refreshTournamentCenterCreateButton?.();
    this._syncTournamentCenterFilterPanelState?.();

    const tab = this._tcActiveTab || 'active';
    const query = (document.getElementById('tc-search')?.value || '').trim().toLowerCase();
    const regionFilter = document.getElementById('tc-region-filter')?.value || '';

    const sourceTournaments = ApiService.getTournaments() || [];
    const freshnessState = this._getTournamentListFreshnessState(sourceTournaments);
    const freshnessHtml = this._renderTournamentListFreshnessBadge(freshnessState);
    let tournaments = sourceTournaments.map(t => this.getFriendlyTournamentRecord?.(t) || t);

    // Tab filter
    tournaments = tournaments.filter(t => {
      const ended = this.isTournamentEnded(t);
      return tab === 'ended' ? ended : !ended;
    });

    // Text search
    if (query) {
      tournaments = tournaments.filter(t =>
        t.name.toLowerCase().includes(query) ||
        (this._getTournamentOrganizerDisplayText?.(t) || '').toLowerCase().includes(query) ||
        (t.organizer || '').toLowerCase().includes(query) ||
        (t.venues || []).some(v => v.toLowerCase().includes(query))
      );
    }

    // Region filter
    if (regionFilter) {
      tournaments = tournaments.filter(t => t.region === regionFilter);
    }

    // Sport filter（優先讀賽事自己的 sportTag、退而求其次讀 hostTeam.sportTag）
    // 2026-04-25：hostTeam 找不到時保留賽事（避免快取未載入時誤隱藏）
    const activeSport = (typeof App !== 'undefined' && App._activeSport && App._activeSport !== 'all') ? App._activeSport : '';
    if (activeSport) {
      tournaments = tournaments.filter(t => {
        if (t.sportTag) return t.sportTag === activeSport;
        const hostTeam = ApiService.getTeam?.(t.hostTeamId);
        // hostTeam 資料未載入時保留賽事，避免快取延遲期誤隱藏已發佈的賽事
        // 寧可短暫誤顯示、也不誤隱藏（onSnapshot 載入後下次切換會正確過濾）
        if (!hostTeam) return true;
        return hostTeam.sportTag === activeSport;
      });
    }

    tournaments.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    if (tournaments.length === 0) {
      if (this._shouldShowTournamentInitialLoading?.(freshnessState, sourceTournaments)) {
        container.innerHTML = freshnessHtml + this._renderTournamentListLoading();
        this._tournamentListLastFp = '';
        return;
      }
      container.innerHTML = freshnessHtml + `<div style="text-align:center;padding:2rem;color:var(--text-muted);font-size:.85rem">${tab === 'ended' ? t('tournament.noEnded') : t('tournament.noActive')}</div>`;
      // Search deeper when the local tournament slice is not fully loaded.
      if (query && typeof FirebaseService !== 'undefined' && !FirebaseService._tournamentAllLoaded) {
        container.insertAdjacentHTML('beforeend',
          '<div style="text-align:center;padding:1rem">' +
          '<button class="outline-btn" style="font-size:.8rem;padding:.4rem 1rem" ' +
          'onclick="App.searchTournamentsFromServer()">搜尋更多賽事</button></div>');
      }
      this._tournamentListLastFp = '';
      if (freshnessState?.hasServerSnapshot || freshnessState?.isServerFresh) this._markPageSnapshotReady?.('page-tournaments');
      return;
    }

    // Phase 2B §8.2B：指紋跳過重繪
    var fp = (freshnessState?.fingerprint || 'no-freshness') + '::' + tournaments.map(function(t) {
      const registered = Array.isArray(t.registeredTeams) ? t.registeredTeams : [];
      const registeredFp = registered.map(function(team) {
        return String(team?.teamId || team?.id || team?.name || team || '').trim();
      }).join('.');
      return [
        t.id || t._docId || '',
        t.name || '',
        t.status || '',
        t.sportTag || '',
        t.image || '',
        t.type || '',
        t.mode || '',
        t.region || '',
        t.organizer || '',
        t.hostTeamId || '',
        t.teams || '',
        t.maxTeams || '',
        registered.length + ':' + registeredFp,
        this._getTournamentListTimestampMs(t.regStart),
        this._getTournamentListTimestampMs(t.regEnd),
        this._getTournamentListTimestampMs(t.createdAt),
        this._getTournamentListTimestampMs(t.updatedAt),
        this.isTournamentEnded(t) ? 'ended' : 'active',
      ].join('|');
    }, this).join(',');
    if (this._tournamentListLastFp === fp && container.children.length > 0) return;
    this._tournamentListLastFp = fp;

    const fmtDate = d => {
      if (!d) return '';
      const dt = new Date(d);
      return `${dt.getMonth() + 1}/${dt.getDate()}`;
    };
    const fmtDatetime = d => {
      if (!d) return '';
      const dt = new Date(d);
      return `${dt.getFullYear()}/${(dt.getMonth() + 1).toString().padStart(2, '0')}/${dt.getDate().toString().padStart(2, '0')}`;
    };

    const statusBgMap = {
      [TOURNAMENT_STATUS.REG_OPEN]:  { bg: 'rgba(52,211,153,.07)', border: '#10b981', darkBg: 'rgba(52,211,153,.15)' },
      [TOURNAMENT_STATUS.REG_CLOSED_ALT]: { bg: 'rgba(251,191,36,.07)', border: '#f59e0b', darkBg: 'rgba(251,191,36,.15)' },
      [TOURNAMENT_STATUS.REG_CLOSED]: { bg: 'rgba(251,191,36,.07)', border: '#f59e0b', darkBg: 'rgba(251,191,36,.15)' },
      [TOURNAMENT_STATUS.PREPARING]:  { bg: 'rgba(96,165,250,.07)', border: '#60a5fa', darkBg: 'rgba(96,165,250,.15)' },
      [TOURNAMENT_STATUS.ENDED]:  { bg: 'rgba(107,114,128,.07)', border: '#6b7280', darkBg: 'rgba(107,114,128,.15)' },
    };
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

    // Phase 2B §8.2C：捲動保存
    var scrollEl = document.scrollingElement || document.documentElement;
    var savedScroll = scrollEl.scrollTop;

    // 狀態緞帶顏色(右下角斜緞帶,參考活動 detail-cover-ribbon 風格)
    const ribbonColorMap = {
      [TOURNAMENT_STATUS.REG_OPEN]:        'linear-gradient(135deg,#10b981,#059669)',
      [TOURNAMENT_STATUS.REG_CLOSED]:      'linear-gradient(135deg,#f59e0b,#d97706)',
      [TOURNAMENT_STATUS.REG_CLOSED_ALT]:  'linear-gradient(135deg,#f59e0b,#d97706)',
      [TOURNAMENT_STATUS.PREPARING]:       'linear-gradient(135deg,#60a5fa,#3b82f6)',
      [TOURNAMENT_STATUS.ENDED]:           'linear-gradient(135deg,#6b7280,#4b5563)',
    };
    container.innerHTML = freshnessHtml + tournaments.map(t => {
      const isEnded = this.isTournamentEnded(t);
      const status = isEnded ? TOURNAMENT_STATUS.ENDED : this.getTournamentStatus(t);
      const ribbonBg = ribbonColorMap[status] || ribbonColorMap[TOURNAMENT_STATUS.ENDED];

      const registered = t.registeredTeams || [];
      const maxTeams = t.maxTeams || '?';
      const regPeriod = (t.regStart && t.regEnd) ? `${fmtDatetime(t.regStart)} ~ ${fmtDatetime(t.regEnd)}` : '未定';
      const organizerDisplay = this._getTournamentOrganizerDisplayText?.(t) || t.organizer || '主辦俱樂部';
      const typeLabel = this._getTournamentModeLabel?.(t) || t.type || '友誼賽';
      const region = t.region || '';
      const sportIcon = this._renderTournamentSportIcon?.(t, 'tl-event-sport-corner') || '';

      // 右側斜切封面圖 + 右下角狀態緞帶(無圖時 fallback 純 chip)
      const slantedThumb = t.image ? `
        <div style="position:relative;width:120px;align-self:stretch;flex-shrink:0;overflow:hidden;clip-path:polygon(28px 0,100% 0,100% 100%,0 100%);background-image:url('${t.image}');background-size:cover;background-position:center">
          <span style="position:absolute;bottom:8px;right:-30px;width:110px;padding:.12rem 0;background:${ribbonBg};color:#fff;font-size:.58rem;font-weight:800;letter-spacing:.04em;text-align:center;text-shadow:0 1px 1px rgba(0,0,0,.18);box-shadow:0 2px 6px rgba(0,0,0,.22);transform:rotate(-45deg);pointer-events:none">${status}</span>
        </div>` : `
        <span style="font-size:.65rem;padding:.18rem .5rem;border-radius:20px;background:${ribbonBg};color:#fff;font-weight:700;white-space:nowrap;align-self:flex-start;margin-right:.4rem">${status}</span>`;

      return `
        <div class="tl-event-row" onclick="App._openTournamentDetail('${t.id}')" style="display:flex;align-items:stretch;gap:0;padding:0;overflow:hidden;${isEnded ? 'opacity:.6;filter:grayscale(.3);' : ''}">
          <div style="flex:1;min-width:0;padding:.5rem .65rem">
            <div class="tl-event-title-row" style="margin-bottom:.18rem">${sportIcon}<div class="tl-event-title">${escapeHTML(t.name)}</div></div>
            <div style="font-size:.62rem;color:var(--text-muted);line-height:1.5">
              ${escapeHTML(typeLabel)}${region ? ' · ' + escapeHTML(region) : ''} · ${registered.length}/${maxTeams} ${I18N.t('tournament.teamUnit')} · 主辦 ${escapeHTML(organizerDisplay)}
            </div>
            <div style="font-size:.6rem;color:var(--text-muted);margin-top:.15rem">
              ${I18N.t('tournament.regPeriod')} ${regPeriod}
            </div>
          </div>
          ${slantedThumb}
        </div>`;
    }).join('');
    scrollEl.scrollTop = savedScroll;
    this._markPageSnapshotReady?.('page-tournaments');
    this._scheduleVisibleDetailPrefetch?.('tournaments', tournaments.map(t => t.id || t._docId).filter(Boolean));
  },

  /** Server-side search for the remaining tournament pages. */
  async searchTournamentsFromServer() {
    var query = (document.getElementById('tc-search')?.value || '').trim();
    if (!query) return;
    this.showToast('搜尋中...');
    while (!FirebaseService._tournamentAllLoaded) {
      var loaded = await FirebaseService.loadMoreTournaments();
      if (loaded <= 0) break;
    }
    this.renderTournamentTimeline();
  },

});
