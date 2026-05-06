/* ================================================
   ToosterX - Home Dashboard
   Compact first-screen summary, sport quick entry, scoreboard placeholder.
   ================================================ */

(function(root) {
  const app = (typeof App !== 'undefined') ? App : root.App;
  if (!app) return; root.App = app;

  const SCOREBOARD_FALLBACK = [
    ['premier_league', '英超'], ['laliga', '西甲'], ['serie_a', '義甲'], ['bundesliga', '德甲'],
    ['ligue_1', '法甲'], ['champions_league', '歐冠'], ['europa_league', '歐聯'], ['world_cup', '世界盃'],
  ].map(([id, label]) => ({ id, label }));

  function numberText(value) {
    const num = Number(value || 0);
    if (!Number.isFinite(num) || num <= 0) return '0';
    return Math.floor(num).toLocaleString('zh-TW');
  }

  function readBootSummary() {
    const el = document.getElementById('boot-home-summary-data');
    if (!el) return null;
    try {
      const data = JSON.parse(el.textContent || '{}');
      return normalizeSummary(data);
    } catch (err) {
      console.warn('[HomeDashboard] boot summary parse failed:', err);
      return null;
    }
  }

  function normalizeSummary(data) {
    const counts = data && typeof data.counts === 'object' ? data.counts : {};
    const activityViews = data && typeof data.activityViews === 'object' ? data.activityViews : {};
    return {
      schemaVersion: Number(data?.schemaVersion || 1),
      generatedAt: data?.generatedAt || '',
      complete: data?.complete === true,
      counts: {
        activities: Number(counts.activities || 0),
        teams: Number(counts.teams || 0),
        tournaments: Number(counts.tournaments || 0),
      },
      activityViews: {
        total: Number(activityViews.total || 0),
        label: activityViews.label || '已記錄瀏覽',
      },
      sportCounts: Array.isArray(data?.sportCounts) ? data.sportCounts : [],
    };
  }

  function currentSummary() {
    if (app._homeSummary) return app._homeSummary;
    const boot = readBootSummary();
    if (boot) app._homeSummary = boot;
    return boot || normalizeSummary({});
  }

  function configuredSports() {
    if (Array.isArray(root.EVENT_SPORT_OPTIONS)) return root.EVENT_SPORT_OPTIONS;
    return (typeof EVENT_SPORT_OPTIONS !== 'undefined' && Array.isArray(EVENT_SPORT_OPTIONS))
      ? EVENT_SPORT_OPTIONS
      : [];
  }

  function sportRows(summary) {
    const configured = configuredSports();
    const order = new Map(configured.map((item, index) => [item.key, index]));
    const counts = new Map((summary.sportCounts || []).map(item => [
      String(item.sportTag || '').trim(),
      Number(item.count || 0),
    ]));

    return configured
      .map(item => ({ key: item.key, label: item.label, count: counts.get(item.key) || 0 }))
      .filter(item => item.count > 0)
      .sort((a, b) => {
        if (a.count !== b.count) return b.count - a.count;
        return (order.get(a.key) || 0) - (order.get(b.key) || 0);
      });
  }

  function eyeSvg() {
    return '<svg class="home-view-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
  }

  function sportIcon(key) {
    if (typeof getSportIconSvg === 'function') return getSportIconSvg(key);
    if (typeof root.getSportIconSvg === 'function') return root.getSportIconSvg(key);
    return '<span class="sport-emoji" aria-hidden="true">•</span>';
  }

  function safeSportKey(key) {
    if (key === 'all') return 'all';
    if (typeof getSportKeySafe === 'function') return getSportKeySafe(key) || 'football';
    return root.getSportKeySafe?.(key) || 'football';
  }

  function sportLabel(key) {
    if (typeof getSportLabelByKey === 'function') return getSportLabelByKey(key) || '此運動';
    return root.getSportLabelByKey?.(key) || '此運動';
  }

  function renderSportEntry(summary) {
    const host = document.getElementById('home-sport-entry');
    if (!host) return;
    const active = app._activeSport || localStorage.getItem('sporthub_active_sport') || 'all';
    const rows = sportRows(summary);
    const more = `<button class="home-sport-chip home-sport-chip-more" type="button" onclick="App.selectHomeSport('all')" aria-label="查看更多活動分類"><span class="home-sport-chip-more-text">查看更多</span></button>`;
    host.innerHTML = rows.map(item => `
      <button class="home-sport-chip${item.key === active ? ' active' : ''}" type="button" data-home-sport="${escapeHTML(item.key)}" onclick="App.selectHomeSport('${escapeHTML(item.key)}')" aria-label="${escapeHTML(item.label)} ${numberText(item.count)} 個活動" title="${escapeHTML(item.label)}">
        <span class="home-sport-chip-mark home-sport-chip-mark-${escapeHTML(item.key)}" aria-hidden="true">${sportIcon(item.key)}</span>
        <span class="home-sport-chip-count">${numberText(item.count)} 活動</span>
      </button>
    `).join('') + more;
  }

  function statCard({ key, label, count, page, views }) {
    const viewHtml = Number(views || 0) > 0 ? `
      <span class="home-stat-views" title="瀏覽統計">
        ${eyeSvg()}
        <span>${numberText(views)}</span>
      </span>` : '';
    return `
      <button class="home-stat-card" type="button" data-stat="${escapeHTML(key)}" onclick="App.showPage('${escapeHTML(page)}')">
        <span class="home-stat-label-row">
          <span class="home-stat-label">${escapeHTML(label)}</span>
        </span>
        <span class="home-stat-value-row">
          <strong class="home-stat-number">${numberText(count)}</strong>
        </span>
        ${viewHtml}
      </button>
    `;
  }

  function renderInfoMeter(summary) {
    const host = document.getElementById('home-info-meter');
    if (!host) return;
    const counts = summary.counts || {};
    host.innerHTML = [
      statCard({
        key: 'activities',
        label: '已開放活動',
        count: counts.activities,
        page: 'page-activities',
        views: Number(summary.activityViews?.total || 0) + 500,
      }),
      statCard({
        key: 'teams',
        label: '已成立俱樂部',
        count: counts.teams,
        page: 'page-teams',
      }),
      statCard({
        key: 'tournaments',
        label: '正舉辦賽事',
        count: counts.tournaments,
        page: 'page-tournaments',
      }),
    ].join('');
  }

  function scoreboardMatches(config, snapshot) {
    const rows = Array.isArray(snapshot?.homepageMatches) && snapshot.homepageMatches.length
      ? snapshot.homepageMatches
      : (Array.isArray(config?.homepageMatches) ? config.homepageMatches : config?.matches);
    return (Array.isArray(rows) ? rows : []).filter(Boolean).slice(0, 3);
  }

  function scoreboardRows(config) {
    const order = Array.isArray(config?.homepageOrder) && config.homepageOrder.length
      ? config.homepageOrder
      : SCOREBOARD_FALLBACK.map(item => item.id);
    const sourceMap = config?.featuredSources && typeof config.featuredSources === 'object'
      ? config.featuredSources
      : (config?.sources && typeof config.sources === 'object' ? config.sources : {});
    return order.map(id => {
      const fallback = SCOREBOARD_FALLBACK.find(item => item.id === id) || { id, label: id };
      const src = sourceMap[id] || {};
      return { id, label: src.label || fallback.label, enabled: src.enabled !== false };
    }).filter(item => item.enabled).slice(0, 8);
  }

  function renderScoreboard(config, snapshot) {
    const host = document.getElementById('home-scoreboard-preview');
    if (!host) return;
    const matches = scoreboardMatches(config, snapshot);
    if (!config || config.homepageEnabled === false || matches.length === 0) {
      host.style.display = 'none';
      host.innerHTML = '';
      return;
    }
    host.style.display = '';
    const leagues = scoreboardRows(config);
    host.innerHTML = `
      <div class="home-scoreboard-title-row">
        <h3 id="home-scoreboard-title">賽事比分</h3>
      </div>
      <div class="home-scoreboard-panel">
        <div class="home-league-rail" aria-label="賽事分類">
          ${leagues.map((item, index) => `<button class="home-league-chip${index === 0 ? ' active' : ''}" type="button">${escapeHTML(item.label)}</button>`).join('')}
        </div>
        <div class="home-score-list">
        ${matches.map(item => `
          <a class="home-score-row" href="#page-match-calendar" aria-label="前往賽事比分與行事曆">
            <div class="home-score-time">${escapeHTML(item.timeLabel || item.time || '預留')}<br>${escapeHTML(item.dateLabel || item.date || 'API')}</div>
            <div class="home-score-main">
              <div class="home-score-title">${escapeHTML(item.title || item.match || '比分與行事曆資料槽')}</div>
              <div class="home-score-sub">${escapeHTML(item.subtitle || item.league || '賽程資料')}</div>
            </div>
            <div class="home-score-badge${item.reserved ? ' reserve' : ''}">${escapeHTML(item.status || '未開賽')}</div>
          </a>
        `).join('')}
        </div>
      </div>
    `;
    host.querySelectorAll('.home-score-row').forEach((row, index) => {
      const item = matches[index];
      row.addEventListener('click', (event) => {
        event.preventDefault();
        app.openHomeScoreboardMatch?.(item?.sport || '', item?.id || '');
      });
    });
  }

  Object.assign(app, {
    _homeSummary: null,

    setActiveSportFilter(sportKey, options = {}) {
      const safeKey = safeSportKey(sportKey);
      this._activeSport = safeKey;
      try { localStorage.setItem('sporthub_active_sport', safeKey); } catch (_) {}
      document.querySelectorAll('.sport-picker-item[data-sport]').forEach(item => {
        item.classList.toggle('active', item.dataset.sport === safeKey);
      });
      const iconEl = document.querySelector('#sport-picker-wrapper .sport-picker-icon');
      if (iconEl) iconEl.innerHTML = safeKey === 'all'
        ? '<span class="sp-all-label" aria-hidden="true">All</span>'
        : sportIcon(safeKey);
      document.querySelectorAll('.home-sport-chip[data-home-sport]').forEach(item => {
        item.classList.toggle('active', item.dataset.homeSport === safeKey);
      });
      document.querySelectorAll('.cat-item[data-sport]').forEach(item => {
        item.classList.toggle('active', item.dataset.sport === safeKey);
      });
      try { this._syncTeamSportFilterWithGlobal?.({ force: true }); } catch (_) {}
      if (options.render !== false) {
        try { this.renderActivityList?.(); } catch (_) {}
        try { this.renderTeamList?.(); } catch (_) {}
        try { this.renderTournamentTimeline?.(); } catch (_) {}
      }
      return safeKey;
    },

    selectHomeSport(sportKey) {
      const safeKey = this.setActiveSportFilter(sportKey, { render: false });
      this.showPage?.('page-activities');
      if (safeKey && safeKey !== 'all') {
        this.showToast?.(`已切換到${sportLabel(safeKey)}`);
      }
    },

    async openHomeCreateEvent() {
      const lineAuth = (typeof LineAuth !== 'undefined') ? LineAuth : root.LineAuth;
      const apiService = (typeof ApiService !== 'undefined') ? ApiService : root.ApiService;
      const firebaseService = (typeof FirebaseService !== 'undefined') ? FirebaseService : root.FirebaseService;
      const scriptLoader = (typeof ScriptLoader !== 'undefined') ? ScriptLoader : root.ScriptLoader;
      const isLoggedIn = typeof lineAuth !== 'undefined' && lineAuth.isLoggedIn?.();
      const currentUser = apiService?.getCurrentUser?.() || firebaseService?._cache?.currentUser || null;
      if (this._requestLoginForAction && !isLoggedIn && !currentUser) {
        this._requestLoginForAction({ type: 'createEvent' });
        return;
      }
      await this.showPage?.('page-activities');
      await scriptLoader?.ensureForPage?.('page-activities');
      if (typeof this.openCreateEventModal === 'function') {
        this.openCreateEventModal();
      } else {
        this.showToast?.('請從活動頁右上角「我要開團」進入');
      }
    },

    renderHomeDashboard() {
      const summary = currentSummary();
      renderSportEntry(summary);
      renderInfoMeter(summary);
      this._markPageSnapshotReady?.('page-home');
    },

    async renderHomeScoreboardPreview() {
      renderScoreboard(this._scoreboardConfig || null, this._scoreboardSnapshot || null);
      try {
        const firebaseService = (typeof FirebaseService !== 'undefined') ? FirebaseService : root.FirebaseService;
        const [config, snapshot] = await Promise.all([
          firebaseService?.ensureSingleDocLoaded?.('siteConfig', 'scoreboardConfig'),
          firebaseService?.ensureSingleDocLoaded?.('scoreboardSnapshots', 'home'),
        ]);
        this._scoreboardConfig = config || this._scoreboardConfig || { homepageEnabled: true, homepageOrder: SCOREBOARD_FALLBACK.map(item => item.id) };
        this._scoreboardSnapshot = snapshot || this._scoreboardSnapshot || null;
        this._scoreboardConfig = root.ScoreboardConfigUtils?.normalizeConfig?.(this._scoreboardConfig) || this._scoreboardConfig;
        renderScoreboard(this._scoreboardConfig, this._scoreboardSnapshot);
      } catch (err) {
        console.warn('[HomeDashboard] scoreboard config load skipped:', err);
      }
    },

    async openHomeScoreboardMatch(sport, matchId) {
      this._scoreboardPendingContext = { sport, matchId };
      await this.showPage?.('page-match-calendar');
    },
  });

  root.HomeDashboardUtils = {
    normalizeSummary,
    sportRows,
    numberText,
  };
})(typeof window !== 'undefined' ? window : globalThis);
