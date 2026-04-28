/* ================================================
   SportHub — Tournament: List & Home Carousel
   Detail view → tournament-detail.js
   ================================================ */

Object.assign(App, {

  /** 動態載入 tournament 群組後開啟賽事詳情（供首頁 / 收藏等尚未載入 tournament-detail.js 時使用） */
  async _openTournamentDetail(id) {
    await ScriptLoader.ensureForPage('page-tournament-detail');
    await this.showTournamentDetail(id);
  },

  renderOngoingTournaments() {
    const container = document.getElementById('ongoing-tournaments');
    if (!container) return;
    const ongoing = ApiService.getTournaments().filter(t => !this.isTournamentEnded(t))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    // ── 已渲染且 ID 完全相同 → 跳過，避免封面圖重載 ──
    const existingCards = container.querySelectorAll('.h-card:not(.skeleton)');
    if (existingCards.length > 0 && existingCards.length === ongoing.length) {
      const renderedIds = [...existingCards].map(c => (c.getAttribute('onclick') || '').match(/'([^']+)'/)?.[1]).filter(Boolean);
      const currentIds = ongoing.map(t => t.id);
      if (renderedIds.length === currentIds.length && renderedIds.every((id, i) => id === currentIds[i])) return;
    }
    this._setHomeSectionVisibility?.(container, ongoing.length > 0);
    if (ongoing.length === 0) {
      container.innerHTML = '';
      return;
    }
    container.innerHTML = ongoing.map(t => `
      <div class="h-card" onclick="App._openTournamentDetail('${t.id}')">
        ${t.image
          ? `<div class="h-card-img"><img src="${t.image}" alt="${escapeHTML(t.name)}" loading="lazy" decoding="async"></div>`
          : `<div class="h-card-img h-card-placeholder">220 × 90</div>`}
        <div class="h-card-body">
          <div class="h-card-title">${escapeHTML(t.name)}</div>
          <div class="h-card-meta">
            <span>${escapeHTML(t.type)}</span>
            <span>${t.teams} ${I18N.t('tournament.teamUnit')}</span>
          </div>
        </div>
      </div>
    `).join('');
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

  filterTournamentCenter() {
    clearTimeout(this._tcFilterTimer);
    this._tcFilterTimer = setTimeout(() => this.renderTournamentTimeline(), 300);
  },

  _tournamentsRenderSeq: 0,
  _tournamentListLastFp: '',

  renderTournamentTimeline() {
    const container = document.getElementById('tournament-timeline');
    if (!container) return;
    this._refreshTournamentCenterCreateButton?.();

    const tab = this._tcActiveTab || 'active';
    const query = (document.getElementById('tc-search')?.value || '').trim().toLowerCase();
    const regionFilter = document.getElementById('tc-region-filter')?.value || '';

    let tournaments = (ApiService.getTournaments() || []).map(t => this.getFriendlyTournamentRecord?.(t) || t);

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
      container.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-muted);font-size:.85rem">${tab === 'ended' ? t('tournament.noEnded') : t('tournament.noActive')}</div>`;
      // Phase 2B §8.2A：快取不完整且搜尋無結果 → 搜尋所有賽事
      if (query && !FirebaseService._tournamentAllLoaded) {
        container.insertAdjacentHTML('beforeend',
          '<div style="text-align:center;padding:1rem">' +
          '<button class="outline-btn" style="font-size:.8rem;padding:.4rem 1rem" ' +
          'onclick="App.searchTournamentsFromServer()">找不到？搜尋所有賽事</button></div>');
      }
      this._tournamentListLastFp = '';
      return;
    }

    // Phase 2B §8.2B：指紋跳過重繪
    var fp = tournaments.map(function(t) { return t.id + '|' + (t.name || '') + '|' + (t.status || ''); }).join(',');
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
    container.innerHTML = tournaments.map(t => {
      const isEnded = this.isTournamentEnded(t);
      const status = isEnded ? TOURNAMENT_STATUS.ENDED : this.getTournamentStatus(t);
      const ribbonBg = ribbonColorMap[status] || ribbonColorMap[TOURNAMENT_STATUS.ENDED];

      const registered = t.registeredTeams || [];
      const maxTeams = t.maxTeams || '?';
      const regPeriod = (t.regStart && t.regEnd) ? `${fmtDatetime(t.regStart)} ~ ${fmtDatetime(t.regEnd)}` : '未定';
      const organizerDisplay = this._getTournamentOrganizerDisplayText?.(t) || t.organizer || '主辦俱樂部';
      const typeLabel = this._getTournamentModeLabel?.(t) || t.type || '友誼賽';
      const region = t.region || '';

      // 右側斜切封面圖 + 右下角狀態緞帶(無圖時 fallback 純 chip)
      const slantedThumb = t.image ? `
        <div style="position:relative;width:120px;align-self:stretch;flex-shrink:0;overflow:hidden;clip-path:polygon(28px 0,100% 0,100% 100%,0 100%);background-image:url('${t.image}');background-size:cover;background-position:center">
          <span style="position:absolute;bottom:8px;right:-30px;width:110px;padding:.12rem 0;background:${ribbonBg};color:#fff;font-size:.58rem;font-weight:800;letter-spacing:.04em;text-align:center;text-shadow:0 1px 1px rgba(0,0,0,.18);box-shadow:0 2px 6px rgba(0,0,0,.22);transform:rotate(-45deg);pointer-events:none">${status}</span>
        </div>` : `
        <span style="font-size:.65rem;padding:.18rem .5rem;border-radius:20px;background:${ribbonBg};color:#fff;font-weight:700;white-space:nowrap;align-self:flex-start;margin-right:.4rem">${status}</span>`;

      return `
        <div class="tl-event-row" onclick="App._openTournamentDetail('${t.id}')" style="display:flex;align-items:stretch;gap:0;padding:0;overflow:hidden;${isEnded ? 'opacity:.6;filter:grayscale(.3);' : ''}">
          <div style="flex:1;min-width:0;padding:.5rem .65rem">
            <div class="tl-event-title" style="margin-bottom:.18rem">${escapeHTML(t.name)}</div>
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
  },

  /** Phase 2B §8.2A：server-side 全集合搜尋 */
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
