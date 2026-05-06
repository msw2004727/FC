/* ================================================
   ToosterX - Home Dashboard
   Compact first-screen summary, sport quick entry, scoreboard placeholder.
   ================================================ */

(function(root) {
  const SCOREBOARD_FALLBACK = [
    { id: 'premier_league', label: '英超' },
    { id: 'laliga', label: '西甲' },
    { id: 'serie_a', label: '義甲' },
    { id: 'bundesliga', label: '德甲' },
    { id: 'ligue_1', label: '法甲' },
    { id: 'champions_league', label: '歐冠' },
    { id: 'europa_league', label: '歐聯' },
    { id: 'world_cup', label: '世界盃' },
  ];

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
    if (root.App?._homeSummary) return root.App._homeSummary;
    const boot = readBootSummary();
    if (boot) root.App._homeSummary = boot;
    return boot || normalizeSummary({});
  }

  function sportRows(summary) {
    const configured = Array.isArray(root.EVENT_SPORT_OPTIONS) ? root.EVENT_SPORT_OPTIONS : [];
    const order = new Map(configured.map((item, index) => [item.key, index]));
    const counts = new Map((summary.sportCounts || []).map(item => [
      String(item.sportTag || '').trim(),
      Number(item.count || 0),
    ]));

    return configured
      .map(item => ({ key: item.key, label: item.label, count: counts.get(item.key) || 0 }))
      .sort((a, b) => {
        if (a.count !== b.count) return b.count - a.count;
        return (order.get(a.key) || 0) - (order.get(b.key) || 0);
      });
  }

  function eyeSvg() {
    return '<svg class="home-view-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
  }

  function sportIcon(key) {
    if (typeof root.getSportIconSvg === 'function') return root.getSportIconSvg(key);
    return '<span class="sport-emoji" aria-hidden="true">•</span>';
  }

  function renderSportEntry(summary) {
    const host = document.getElementById('home-sport-entry');
    if (!host) return;
    const active = root.App?._activeSport || localStorage.getItem('sporthub_active_sport') || 'all';
    const rows = sportRows(summary);
    host.innerHTML = rows.map(item => `
      <button class="home-sport-chip${item.key === active ? ' active' : ''}" type="button" data-home-sport="${escapeHTML(item.key)}" onclick="App.selectHomeSport('${escapeHTML(item.key)}')">
        <span class="home-sport-chip-icon">${sportIcon(item.key)}</span>
        <span class="home-sport-chip-label">${escapeHTML(item.label)}</span>
        <span class="home-sport-chip-count">${numberText(item.count)} 活動</span>
      </button>
    `).join('');
  }

  function statCard({ key, label, count, page, meta, reserved }) {
    return `
      <button class="home-stat-card" type="button" data-stat="${escapeHTML(key)}" onclick="App.showPage('${escapeHTML(page)}')">
        <span class="home-stat-label-row">
          <span>${escapeHTML(label)}</span>
          ${eyeSvg()}
        </span>
        <strong class="home-stat-number">${numberText(count)}</strong>
        <span class="home-stat-meta">
          ${reserved ? '<span class="home-stat-reserved">預留</span>' : ''}
          <span>${meta}</span>
        </span>
      </button>
    `;
  }

  function renderInfoMeter(summary) {
    const host = document.getElementById('home-info-meter');
    if (!host) return;
    const counts = summary.counts || {};
    const views = numberText(summary.activityViews?.total || 0);
    host.innerHTML = [
      statCard({
        key: 'activities',
        label: '活動數',
        count: counts.activities,
        page: 'page-activities',
        meta: `活動詳情 ${views} 次`,
      }),
      statCard({
        key: 'teams',
        label: '俱樂部數',
        count: counts.teams,
        page: 'page-teams',
        meta: '列表入口',
        reserved: true,
      }),
      statCard({
        key: 'tournaments',
        label: '賽事數',
        count: counts.tournaments,
        page: 'page-tournaments',
        meta: '列表入口',
        reserved: true,
      }),
    ].join('');
  }

  function scoreboardRows(config) {
    const order = Array.isArray(config?.homepageOrder) && config.homepageOrder.length
      ? config.homepageOrder
      : SCOREBOARD_FALLBACK.map(item => item.id);
    const sourceMap = config?.sources && typeof config.sources === 'object' ? config.sources : {};
    return order.map(id => {
      const fallback = SCOREBOARD_FALLBACK.find(item => item.id === id) || { id, label: id };
      const src = sourceMap[id] || {};
      return { id, label: src.label || fallback.label, enabled: src.enabled !== false };
    }).filter(item => item.enabled).slice(0, 8);
  }

  function renderScoreboard(config) {
    const host = document.getElementById('home-scoreboard-preview');
    if (!host) return;
    const rows = scoreboardRows(config);
    if (config && config.homepageEnabled === false) {
      host.style.display = 'none';
      return;
    }
    host.style.display = '';
    host.innerHTML = `
      <div class="home-scoreboard-title-row">
        <h3 id="home-scoreboard-title">賽事比分與行事曆</h3>
        <span class="home-scoreboard-badge">預留</span>
      </div>
      <div class="home-scoreboard-grid">
        ${rows.map(item => `
          <div class="home-scoreboard-item">
            <div class="home-scoreboard-league">${escapeHTML(item.label)}</div>
            <div class="home-scoreboard-line">比分 / 賽程 API 待啟用</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  Object.assign(root.App, {
    _homeSummary: null,

    setActiveSportFilter(sportKey, options = {}) {
      const safeKey = sportKey === 'all' ? 'all' : (root.getSportKeySafe?.(sportKey) || 'football');
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
        this.showToast?.(`已切換到${root.getSportLabelByKey?.(safeKey) || '此運動'}`);
      }
    },

    async openHomeCreateEvent() {
      const isLoggedIn = typeof root.LineAuth !== 'undefined' && root.LineAuth.isLoggedIn?.();
      const currentUser = root.ApiService?.getCurrentUser?.() || root.FirebaseService?._cache?.currentUser || null;
      if (this._requestLoginForAction && !isLoggedIn && !currentUser) {
        this._requestLoginForAction({ type: 'createEvent' });
        return;
      }
      await this.showPage?.('page-activities');
      await root.ScriptLoader?.ensureForPage?.('page-activities');
      if (typeof this.openCreateEventModal === 'function') {
        this.openCreateEventModal();
      } else {
        this.showToast?.('請從活動頁右上角新增活動');
      }
    },

    renderHomeDashboard() {
      const summary = currentSummary();
      renderSportEntry(summary);
      renderInfoMeter(summary);
      this._markPageSnapshotReady?.('page-home');
    },

    async renderHomeScoreboardPreview() {
      renderScoreboard(this._scoreboardConfig || null);
      try {
        const config = await root.FirebaseService?.ensureSingleDocLoaded?.('siteConfig', 'scoreboardConfig');
        this._scoreboardConfig = config || this._scoreboardConfig || null;
        renderScoreboard(this._scoreboardConfig);
      } catch (err) {
        console.warn('[HomeDashboard] scoreboard config load skipped:', err);
      }
    },
  });

  root.HomeDashboardUtils = {
    normalizeSummary,
    sportRows,
    numberText,
  };
})(typeof window !== 'undefined' ? window : globalThis);
