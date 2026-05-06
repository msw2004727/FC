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
  const HOME_SCOREBOARD_LIMIT = 3;
  const HOME_SCOREBOARD_SECTION_KEYS = ['featured', 'live', 'schedule'];
  const HOME_SCOREBOARD_NOTICE = '更新頻率仍在測試，比分賽程僅供參考，實際結果以官方公告為準。';
  const HOME_SCOREBOARD_SECTIONS = {
    featured: {
      label: '焦點賽事',
      empty: '目前沒有可顯示的焦點賽事。',
    },
    live: {
      label: '即時比分',
      empty: '目前沒有進行中的比分。',
    },
    schedule: {
      label: '今日賽程',
      empty: '目前沒有 24 小時內即將開賽的賽程。',
    },
  };

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

  function matchKey(match) {
    return match?.detailCacheKey || `${match?.sport || 'sport'}_${match?.id || match?.title || ''}`;
  }

  function allScoreboardMatches(config, snapshot) {
    const sources = [
      snapshot?.homepageSections?.featured?.matches,
      snapshot?.homepageSections?.live?.matches,
      snapshot?.homepageSections?.schedule?.matches,
      snapshot?.homepageSections?.upcoming24h?.matches,
      snapshot?.homepageSections?.scores?.matches,
      snapshot?.homepageMatches,
      snapshot?.liveMatches,
      snapshot?.recentSchedule,
      config?.homepageMatches,
      config?.matches,
    ];
    const map = new Map();
    sources.forEach(rows => {
      (Array.isArray(rows) ? rows : []).forEach(match => {
        if (!match) return;
        const key = matchKey(match);
        if (key && !map.has(key)) map.set(key, match);
      });
    });
    return Array.from(map.values());
  }

  function timestampMillis(value) {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return Number(value.toMillis()) || 0;
    if (typeof value.toDate === 'function') {
      const date = value.toDate();
      return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
    }
    if (typeof value.seconds === 'number') return value.seconds * 1000;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric > 9999999999 ? numeric : numeric * 1000;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatScoreboardUpdatedAt(value) {
    const ms = timestampMillis(value);
    if (!ms) return '尚未更新';
    try {
      const text = new Date(ms).toLocaleString('zh-TW', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      return `更新 ${text}`;
    } catch (_) {
      return '尚未更新';
    }
  }

  function scoreboardSectionUpdatedAt(config, snapshot, sectionKey) {
    const snapshotSection = snapshot?.homepageSections?.[sectionKey]
      || (sectionKey === 'schedule' ? snapshot?.homepageSections?.upcoming24h : null);
    const configSection = config?.homepageSections?.[sectionKey]
      || (sectionKey === 'schedule' ? config?.homepageSections?.upcoming24h : null);
    return snapshotSection?.updatedAt
      || snapshot?.generatedAt
      || snapshot?.updatedAt
      || configSection?.updatedAt
      || config?.updatedAt
      || null;
  }

  function isUpcomingScoreboardMatch(match) {
    if (!match || match.isLive || match.isFinished || !match.startsAt) return false;
    const startsAtMs = Date.parse(match.startsAt);
    if (!Number.isFinite(startsAtMs)) return false;
    const nowMs = Date.now();
    return startsAtMs >= nowMs && startsAtMs <= nowMs + 24 * 60 * 60 * 1000;
  }

  function isFeaturedScoreboardMatch(match, config) {
    const sourceId = String(match?.sourceId || '').trim();
    const sport = String(match?.sport || '').trim();
    if (!sourceId || !sport || sourceId === sport) return false;
    return config?.featuredSources?.[sourceId]?.enabled !== false;
  }

  function isLiveScoreboardMatch(match) {
    if (match?.isLive) return true;
    const lower = String(match?.status || '').trim().toLowerCase();
    return ['live', 'in progress', 'ongoing', 'playing'].includes(lower);
  }

  function scoreboardSectionMatches(config, snapshot, sectionKey) {
    const snapshotSection = snapshot?.homepageSections?.[sectionKey]
      || (sectionKey === 'schedule' ? snapshot?.homepageSections?.upcoming24h : null);
    const configSection = config?.homepageSections?.[sectionKey]
      || (sectionKey === 'schedule' ? config?.homepageSections?.upcoming24h : null);
    const sectionRows = snapshotSection?.matches || configSection?.matches;
    if (Array.isArray(sectionRows)) return sectionRows.filter(Boolean);
    const rows = allScoreboardMatches(config, snapshot);
    if (sectionKey === 'featured') return rows.filter(match => isFeaturedScoreboardMatch(match, config));
    if (sectionKey === 'live') return rows.filter(isLiveScoreboardMatch);
    if (sectionKey === 'schedule') return rows.filter(isUpcomingScoreboardMatch);
    return rows;
  }

  function sportSummaryMap(snapshot) {
    const map = new Map();
    (Array.isArray(snapshot?.sports) ? snapshot.sports : []).forEach(item => {
      if (item?.sport) map.set(item.sport, item);
    });
    return map;
  }

  function sportLabelForScoreboard(config, snapshot, sport) {
    if (!sport) return '賽事';
    const summary = sportSummaryMap(snapshot).get(sport);
    return config?.sports?.[sport]?.label
      || summary?.label
      || root.ScoreboardConfigUtils?.SPORT_CATALOG?.find(item => item.key === sport)?.label
      || sport;
  }

  function scoreboardSports(config, snapshot, matches) {
    const counts = new Map();
    matches.forEach(match => {
      if (!match?.sport) return;
      counts.set(match.sport, (counts.get(match.sport) || 0) + 1);
    });
    const summary = sportSummaryMap(snapshot);
    const orderedKeys = [];
    const addKeys = rows => (Array.isArray(rows) ? rows : []).forEach(key => {
      const safeKey = String(key || '').trim();
      if (safeKey && !orderedKeys.includes(safeKey)) orderedKeys.push(safeKey);
    });
    addKeys(config?.homepageSports);
    addKeys(config?.defaultSportTabs);
    addKeys(config?.enabledSports);
    addKeys(config?.sportsOrder);
    addKeys((Array.isArray(snapshot?.sports) ? snapshot.sports : []).map(item => item?.sport));
    addKeys(matches.map(match => match?.sport));

    return orderedKeys
      .filter(sport => {
        const summaryCount = Number(summary.get(sport)?.liveCount || 0) + Number(summary.get(sport)?.scheduleCount || 0);
        return (counts.get(sport) || 0) > 0 || summaryCount > 0;
      })
      .map(sport => ({
        key: sport,
        label: sportLabelForScoreboard(config, snapshot, sport),
        count: counts.get(sport) || Number(summary.get(sport)?.liveCount || 0) + Number(summary.get(sport)?.scheduleCount || 0),
      }));
  }

  function scoreboardMatches(config, snapshot, sectionKey, sport) {
    const rows = scoreboardSectionMatches(config, snapshot, sectionKey);
    return rows
      .filter(match => !sport || match.sport === sport)
      .slice(0, HOME_SCOREBOARD_LIMIT);
  }

  function scoreboardStatusText(match) {
    const home = match?.homeScore;
    const away = match?.awayScore;
    if (home != null || away != null) return `${home ?? '-'} : ${away ?? '-'}`;
    const raw = String(match?.status || '').trim();
    const lower = raw.toLowerCase();
    const setMatch = lower.match(/^(\d+)(st|nd|rd|th)\s+set$/);
    if (setMatch) return `第 ${setMatch[1]} 盤`;
    if (match?.isFinished || ['ended', 'finished', 'full time', 'ft'].includes(lower)) return '已結束';
    if (match?.isLive || ['live', 'in progress'].includes(lower)) return '進行中';
    if (!raw || ['scheduled', 'not started'].includes(lower)) return '未開賽';
    return raw;
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
    renderScoreboardTabbed(config, snapshot, host);
  }

  function renderScoreboardTabbed(config, snapshot, host) {
    if (config && config.homepageEnabled === false) {
      host.style.display = 'none';
      host.innerHTML = '';
      return;
    }
    if (!config) {
      host.style.display = '';
      host.innerHTML = `
        <div class="home-scoreboard-title-row">
          <h3 id="home-scoreboard-title">賽事資訊</h3>
        </div>
        <div class="home-scoreboard-panel">
          <div class="scoreboard-empty compact">比分與賽程載入中...</div>
        </div>
      `;
      return;
    }

    const sections = HOME_SCOREBOARD_SECTION_KEYS.map(key => ({
      key,
      ...HOME_SCOREBOARD_SECTIONS[key],
      matches: scoreboardSectionMatches(config, snapshot, key),
      updatedText: formatScoreboardUpdatedAt(scoreboardSectionUpdatedAt(config, snapshot, key)),
    }));
    if (!sections.some(section => section.matches.length)) {
      host.style.display = 'none';
      host.innerHTML = '';
      return;
    }

    const activeSectionKey = HOME_SCOREBOARD_SECTION_KEYS.includes(app._homeScoreboardActiveSection)
      ? app._homeScoreboardActiveSection
      : (sections.find(section => section.matches.length)?.key || 'featured');
    app._homeScoreboardActiveSection = activeSectionKey;
    const activeSection = sections.find(section => section.key === activeSectionKey) || sections[0];
    const sports = scoreboardSports(config, snapshot, activeSection.matches);
    const activeSport = sports.some(item => item.key === app._homeScoreboardActiveSport)
      ? app._homeScoreboardActiveSport
      : (sports[0]?.key || '');
    app._homeScoreboardActiveSport = activeSport;
    const matches = activeSport ? scoreboardMatches(config, snapshot, activeSectionKey, activeSport) : [];
    const sportTabs = sports.length ? `
      <div class="home-league-rail" aria-label="賽事運動分類">
        ${sports.map(item => `<button class="home-league-chip${item.key === activeSport ? ' active' : ''}" type="button" onclick="App.selectHomeScoreboardSport('${escapeHTML(item.key)}')" aria-pressed="${item.key === activeSport ? 'true' : 'false'}">${escapeHTML(item.label)}<span>${numberText(item.count)}</span></button>`).join('')}
      </div>` : '';
    const notice = `
      <div class="home-scoreboard-note">
        <span>${escapeHTML(HOME_SCOREBOARD_NOTICE)}</span>
      </div>`;
    const rows = matches.length ? `
      <div class="home-score-list">
        ${matches.map(item => `
          <a class="home-score-row" href="#page-match-calendar" aria-label="查看賽事比分詳情">
            <div class="home-score-time">${escapeHTML(item.timeLabel || item.time || '--:--')}<br>${escapeHTML(item.dateLabel || item.date || 'API')}</div>
            <div class="home-score-main">
              <div class="home-score-title">${escapeHTML(item.title || item.match || '尚未取得賽事名稱')}</div>
              <div class="home-score-sub">${escapeHTML(item.subtitle || item.league || sportLabelForScoreboard(config, snapshot, item.sport))}</div>
            </div>
            <div class="home-score-badge${item.reserved ? ' reserve' : ''}">${escapeHTML(scoreboardStatusText(item))}</div>
          </a>
        `).join('')}
      </div>` : `<div class="scoreboard-empty compact">${escapeHTML(activeSection.empty)}</div>`;

    host.style.display = '';
    host.innerHTML = `
      <div class="home-scoreboard-title-row">
        <h3 id="home-scoreboard-title">賽事資訊</h3>
      </div>
      <div class="home-scoreboard-panel">
        <div class="home-scoreboard-section-tabs" aria-label="賽事資訊分類">
          ${sections.map(section => `<button class="home-scoreboard-section-tab${section.key === activeSectionKey ? ' active' : ''}" type="button" onclick="App.selectHomeScoreboardSection('${escapeHTML(section.key)}')" aria-pressed="${section.key === activeSectionKey ? 'true' : 'false'}"><span>${escapeHTML(section.label)}</span><small>${escapeHTML(section.updatedText)}</small></button>`).join('')}
        </div>
        ${notice}
        ${sportTabs}
        ${rows}
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
    _homeScoreboardActiveSport: '',
    _homeScoreboardActiveSection: '',

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

    selectHomeScoreboardSport(sportKey) {
      this._homeScoreboardActiveSport = String(sportKey || '').trim();
      renderScoreboard(this._scoreboardConfig || null, this._scoreboardSnapshot || null);
    },

    selectHomeScoreboardSection(sectionKey) {
      const safeKey = String(sectionKey || '').trim();
      if (!HOME_SCOREBOARD_SECTION_KEYS.includes(safeKey)) return;
      this._homeScoreboardActiveSection = safeKey;
      this._homeScoreboardActiveSport = '';
      renderScoreboard(this._scoreboardConfig || null, this._scoreboardSnapshot || null);
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
