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

    container.innerHTML = tournaments.map(t => {
      const isEnded = this.isTournamentEnded(t);
      const status = isEnded ? TOURNAMENT_STATUS.ENDED : this.getTournamentStatus(t);
      const statusMap = {
        [TOURNAMENT_STATUS.REG_OPEN]: 'open',
        [TOURNAMENT_STATUS.REG_CLOSED_ALT]: 'full',
        [TOURNAMENT_STATUS.REG_CLOSED]: 'full',
        [TOURNAMENT_STATUS.PREPARING]: 'upcoming',
        [TOURNAMENT_STATUS.ENDED]: 'ended',
      };
      const css = statusMap[status] || 'open';
      const sBg = statusBgMap[status] || statusBgMap[TOURNAMENT_STATUS.ENDED];

      const registered = t.registeredTeams || [];
      const maxTeams = t.maxTeams || '?';
      const matchDates = t.matchDates || [];
      const matchDatesText = matchDates.length ? matchDates.map(d => fmtDate(d)).join('、') : '未定';
      const regPeriod = (t.regStart && t.regEnd) ? `${fmtDatetime(t.regStart)} ~ ${fmtDatetime(t.regEnd)}` : '未定';
      const organizer = t.organizer || '管理員';
      const role = ApiService.getUserRole(organizer);
      const region = t.region || '';

      return `
        <div class="tl-event-row" onclick="App._openTournamentDetail('${t.id}')" style="margin-bottom:.4rem;flex-wrap:wrap;padding:.45rem .6rem .35rem;background:${isDark ? sBg.darkBg : sBg.bg};border-left:3px solid ${sBg.border}">
          <div style="width:100%;display:flex;align-items:center;gap:.35rem">
            <div class="tl-event-title" style="flex:1">${escapeHTML(t.name)}</div>
            <span style="font-size:.58rem;color:var(--text-muted);opacity:.7">待定義</span>
            <span class="user-capsule uc-${role}" style="pointer-events:none;cursor:default;font-size:.6rem;padding:.1rem .35rem">${escapeHTML(organizer)}</span>
            <span class="tl-event-status ${css}">${status}</span>
            <span class="tl-event-arrow">›</span>
          </div>
          <div style="width:100%;font-size:.62rem;color:var(--text-muted);margin-top:.2rem;line-height:1.5">
            ${region ? region + ' · ' : ''}${I18N.t('tournament.matchDay')} ${matchDatesText} · ${I18N.t('tournament.regPeriod')} ${regPeriod} · ${I18N.t('tournament.registered')} ${registered.length}/${maxTeams} ${I18N.t('tournament.teamUnit')}
          </div>
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
