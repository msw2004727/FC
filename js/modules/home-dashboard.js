/* ================================================
   ToosterX - Home Dashboard
   Compact first-screen summary and sport quick entry.
   ================================================ */

(function(root) {
  const app = (typeof App !== 'undefined') ? App : root.App;
  if (!app) return; root.App = app;

  const HOME_SUMMARY_CLIENT_REFRESH_MIN_AGE_MS = 5 * 60 * 1000;
  const HOME_SUMMARY_CLIENT_REFRESH_THROTTLE_MS = 5 * 60 * 1000;
  const HOME_ACTIVITY_REGION_KEY = 'toosterx_home_activity_region';
  const HOME_INFO_DEFAULT_LABELS = {
    activities: '\u5df2\u958b\u653e\u6d3b\u52d5',
    teams: '\u4ff1\u6a02\u90e8\u6578',
    tournaments: '\u6b63\u8209\u8fa6\u8cfd\u4e8b',
  };
  const HOME_LAYOUT_SECTIONS = Object.freeze([
    { key: 'banner', label: '\u9996\u9801 Banner' },
    { key: 'heroActions', label: '\u5feb\u6377\u64cd\u4f5c' },
    { key: 'announcement', label: '\u516c\u544a\u8dd1\u99ac\u71c8' },
    { key: 'nextActivity', label: '\u6211\u7684\u4e0b\u4e00\u5834\u6d3b\u52d5' },
    { key: 'sportEntry', label: '\u6d3b\u52d5\u985e\u5225\u5165\u53e3' },
    { key: 'infoMeter', label: '\u5373\u6642\u8cc7\u8a0a' },
    { key: 'gameShortcut', label: '\u5c0f\u904a\u6232\u5165\u53e3' },
    { key: 'sponsors', label: '\u8d0a\u52a9\u5546' },
    { key: 'news', label: '\u9996\u9801\u65b0\u805e' },
    { key: 'floatingAds', label: '\u6d6e\u52d5\u5ee3\u544a' },
  ]);
  const HOME_LAYOUT_DEFAULT_ORDER = Object.freeze(HOME_LAYOUT_SECTIONS.map(item => item.key));
  const HOME_ACTIVITY_REGIONS = ['全部', '北部', '中部', '南部', '東部&外島'];
  const HOME_ACTIVITY_TYPES = [
    { value: '', label: '全部類型' },
    { value: 'play', label: 'PLAY' },
    { value: 'camp', label: '訓練營' },
    { value: 'watch', label: '觀賽' },
    { value: 'external', label: '外部活動' },
  ];

  function numberText(value) {
    const num = Number(value || 0);
    if (!Number.isFinite(num) || num <= 0) return '0';
    return Math.floor(num).toLocaleString('zh-TW');
  }

  function cssImageUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return 'url("' + raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '")';
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

  function summaryGeneratedMs(summary) {
    const raw = summary?.generatedAt;
    const parsed = raw ? Date.parse(raw) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function parseEventDateMs(dateValue) {
    if (!dateValue) return 0;
    if (typeof dateValue === 'number') return dateValue;
    if (dateValue && typeof dateValue.toDate === 'function') return dateValue.toDate().getTime();
    const raw = String(dateValue).trim();
    const slash = raw.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (slash) {
      return new Date(
        Number(slash[1]),
        Number(slash[2]) - 1,
        Number(slash[3]),
        Number(slash[4] || 0),
        Number(slash[5] || 0)
      ).getTime();
    }
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function normalizeEventSportKey(event) {
    const raw = String(event?.sportTag || event?.sport || 'football').trim();
    const safe = typeof getSportKeySafe === 'function'
      ? getSportKeySafe(raw)
      : root.getSportKeySafe?.(raw);
    return safe || raw || 'football';
  }

  function isPublicActiveHomeEvent(event, nowMs) {
    if (!event || !(event.id || event._docId)) return false;
    const status = String(event.status || '').toLowerCase();
    if (['ended', 'cancelled', 'canceled', 'archived'].includes(status)) return false;
    if (event.privateEvent === true || event.teamOnly === true) return false;
    const startMs = parseEventDateMs(event.date || event.startAt || event.startTime);
    return startMs === 0 || startMs > nowMs;
  }

  function buildSummaryFromEvents(events, baseSummary) {
    const base = normalizeSummary(baseSummary || {});
    const nowMs = Date.now();
    const activeEvents = (Array.isArray(events) ? events : [])
      .filter(event => isPublicActiveHomeEvent(event, nowMs));
    const sportMap = new Map();
    let viewTotal = 0;

    activeEvents.forEach(event => {
      const sport = normalizeEventSportKey(event);
      sportMap.set(sport, (sportMap.get(sport) || 0) + 1);
      const views = Number(event.viewCount || event.views || 0);
      if (Number.isFinite(views) && views > 0) viewTotal += Math.floor(views);
    });

    return {
      ...base,
      generatedAt: new Date(nowMs).toISOString(),
      counts: {
        ...base.counts,
        activities: activeEvents.length,
      },
      activityViews: {
        ...base.activityViews,
        total: viewTotal,
      },
      sportCounts: Array.from(sportMap.entries())
        .map(([sportTag, count]) => ({ sportTag, count }))
        .sort((a, b) => b.count - a.count || a.sportTag.localeCompare(b.sportTag)),
    };
  }

  function homeSummaryChanged(prev, next) {
    const a = normalizeSummary(prev || {});
    const b = normalizeSummary(next || {});
    return a.counts.activities !== b.counts.activities
      || a.activityViews.total !== b.activityViews.total
      || JSON.stringify(a.sportCounts || []) !== JSON.stringify(b.sportCounts || []);
  }

  async function refreshHomeSummaryFromEvents() {
    const firebaseService = (typeof FirebaseService !== 'undefined') ? FirebaseService : root.FirebaseService;
    if (!firebaseService?._cache || app._homeSummaryRefreshing) return null;
    app._homeSummaryRefreshing = true;
    let refreshStarted = false;
    try {
      const shouldReloadEvents = typeof firebaseService._shouldReloadCollection === 'function'
        ? firebaseService._shouldReloadCollection('events')
        : (!Array.isArray(firebaseService._cache.events) || !firebaseService._cache.events.length);
      if (shouldReloadEvents && typeof firebaseService._loadEventsStatic === 'function') {
        const firestoreReady = typeof db !== 'undefined' && !!db;
        if (!firestoreReady) return null;
        refreshStarted = true;
        await firebaseService._loadEventsStatic();
      } else {
        refreshStarted = true;
      }
      const events = Array.isArray(firebaseService._cache.events) ? firebaseService._cache.events : [];
      if (!events.length) return null;

      const prev = currentSummary();
      const next = buildSummaryFromEvents(events, prev);
      if (!homeSummaryChanged(prev, next)) return null;

      app._homeSummary = next;
      firebaseService._cache.homeSummary = next;
      renderSportEntry(next);
      renderInfoMeter(next);
      return next;
    } catch (err) {
      console.warn('[HomeDashboard] home summary refresh skipped:', err);
      return null;
    } finally {
      app._homeSummaryRefreshing = false;
      if (refreshStarted) app._homeSummaryRefreshedAt = Date.now();
    }
  }

  function scheduleHomeSummaryRefresh(summary) {
    const firebaseService = (typeof FirebaseService !== 'undefined') ? FirebaseService : root.FirebaseService;
    if (!firebaseService?._cache) return;
    if (app._homeSummaryRefreshScheduled || app._homeSummaryRefreshing) return;

    const nowMs = Date.now();
    const generatedMs = summaryGeneratedMs(summary);
    if (generatedMs && nowMs - generatedMs < HOME_SUMMARY_CLIENT_REFRESH_MIN_AGE_MS) return;
    if (app._homeSummaryRefreshedAt
      && nowMs - app._homeSummaryRefreshedAt < HOME_SUMMARY_CLIENT_REFRESH_THROTTLE_MS) return;

    app._homeSummaryRefreshScheduled = true;
    const run = () => {
      app._homeSummaryRefreshScheduled = false;
      refreshHomeSummaryFromEvents();
    };
    if (typeof root.requestIdleCallback === 'function') {
      root.requestIdleCallback(run, { timeout: 2500 });
    } else {
      setTimeout(run, 1200);
    }
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

  function safeHomeRegion(region) {
    const raw = String(region || '').replace(/&amp;/g, '&').trim();
    return HOME_ACTIVITY_REGIONS.includes(raw) ? raw : '全部';
  }

  function homeSportOptions() {
    return [{ key: 'all', label: '全部運動' }].concat(
      configuredSports().map(item => ({
        key: item.key,
        label: item.label || sportLabel(item.key),
      }))
    );
  }

  function optionHtml(items, selectedValue) {
    return items.map(item => {
      const value = String(item.value ?? item.key ?? '');
      const label = String(item.label ?? value);
      return `<option value="${escapeHTML(value)}"${value === selectedValue ? ' selected' : ''}>${escapeHTML(label)}</option>`;
    }).join('');
  }

  function safeHexColor(value) {
    const raw = String(value || '').trim();
    return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : '';
  }

  function normalizeHomeInfoFontSize(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 10 || num > 20) return '';
    return `${num}px`;
  }

  function homeInfoSettings() {
    const raw = (typeof ApiService !== 'undefined' && typeof ApiService.getHomeInfoSettings === 'function')
      ? (ApiService.getHomeInfoSettings() || {})
      : {};
    const hasManagedConfig = Object.keys(raw).length > 0;
    const labels = raw.labels && typeof raw.labels === 'object' ? raw.labels : {};
    return {
      status: hasManagedConfig ? String(raw.status || 'active') : 'pending',
      labels: {
        activities: String(labels.activities || raw.activityLabel || HOME_INFO_DEFAULT_LABELS.activities).trim() || HOME_INFO_DEFAULT_LABELS.activities,
        teams: String(labels.teams || raw.teamLabel || HOME_INFO_DEFAULT_LABELS.teams).trim() || HOME_INFO_DEFAULT_LABELS.teams,
        tournaments: String(labels.tournaments || raw.tournamentLabel || HOME_INFO_DEFAULT_LABELS.tournaments).trim() || HOME_INFO_DEFAULT_LABELS.tournaments,
      },
      fontSize: normalizeHomeInfoFontSize(raw.fontSize),
      labelColor: safeHexColor(raw.labelColor || raw.fontColor),
      numberColor: safeHexColor(raw.numberColor),
    };
  }

  function normalizeHomeLayoutOrder(value) {
    const source = Array.isArray(value) ? value : (Array.isArray(value?.order) ? value.order : []);
    const known = new Set(HOME_LAYOUT_DEFAULT_ORDER);
    const seen = new Set();
    const result = [];
    source.forEach(key => {
      const safeKey = String(key || '').trim();
      if (!known.has(safeKey) || seen.has(safeKey)) return;
      seen.add(safeKey);
      result.push(safeKey);
    });
    HOME_LAYOUT_DEFAULT_ORDER.forEach(key => {
      if (!seen.has(key)) result.push(key);
    });
    return result;
  }

  function homeLayoutSettings() {
    const raw = (typeof ApiService !== 'undefined' && typeof ApiService.getHomeLayoutSettings === 'function')
      ? (ApiService.getHomeLayoutSettings() || {})
      : {};
    return { order: normalizeHomeLayoutOrder(raw.order) };
  }

  function applyHomeInfoStyles(section, settings) {
    if (!section) return;
    section.classList.toggle('has-custom-info-font', !!settings.fontSize);
    section.classList.toggle('has-custom-info-label-color', !!settings.labelColor);
    section.classList.toggle('has-custom-info-number-color', !!settings.numberColor);
    if (settings.fontSize) section.style.setProperty('--home-info-font-size', settings.fontSize);
    else section.style.removeProperty('--home-info-font-size');
    if (settings.labelColor) section.style.setProperty('--home-info-label-color', settings.labelColor);
    else section.style.removeProperty('--home-info-label-color');
    if (settings.numberColor) section.style.setProperty('--home-info-number-color', settings.numberColor);
    else section.style.removeProperty('--home-info-number-color');
  }

  function renderSportViews(summary) {
    const host = document.getElementById('home-sport-views');
    if (!host) return;
    const activityViews = Number(summary?.activityViews?.total || 0) + 500;
    host.innerHTML = activityViews > 0
      ? `${eyeSvg()}<span>${numberText(activityViews)}</span>`
      : '';
  }

  function renderSportEntry(summary) {
    const host = document.getElementById('home-sport-entry');
    if (!host) return;
    renderSportViews(summary);
    const active = app._activeSport || localStorage.getItem('sporthub_active_sport') || 'all';
    const rows = sportRows(summary);
    const more = `<button class="home-sport-chip home-sport-chip-more" type="button" onclick="App.selectHomeSport('all')" aria-label="查看更多活動分類"><span class="home-sport-chip-more-text">查看更多</span></button>`;
    host.innerHTML = rows.map(item => `
      <button class="home-sport-chip${item.key === active ? ' active' : ''}" type="button" data-home-sport="${escapeHTML(item.key)}" onclick="App.selectHomeSport('${escapeHTML(item.key)}')" aria-label="${escapeHTML(item.label)} ${numberText(item.count)} 個活動" title="${escapeHTML(item.label)}">
        <span class="home-sport-chip-mark home-sport-chip-mark-${escapeHTML(item.key)}" aria-hidden="true">${sportIcon(item.key)}</span>
        <span class="home-sport-chip-text">
          <span class="home-sport-chip-label">${escapeHTML(item.label)}</span>
          <span class="home-sport-chip-count">${numberText(item.count)} 活動</span>
        </span>
      </button>
    `).join('') + more;
  }

  function statCard({ key, label, count, page }) {
    const countText = numberText(count);
    return `
      <button class="home-stat-card" type="button" data-stat="${escapeHTML(key)}" onclick="App.showPage('${escapeHTML(page)}')" aria-label="${escapeHTML(label)} ${escapeHTML(countText)}">
        <span class="home-stat-label-row">
          <span class="home-stat-label">${escapeHTML(label)}：</span>
        </span>
        <span class="home-stat-value-row">
          <strong class="home-stat-number">${countText}</strong>
        </span>
      </button>
    `;
  }

  function renderInfoMeter(summary) {
    const host = document.getElementById('home-info-meter');
    if (!host) return;
    const section = host.closest('.home-info-dashboard-section');
    const settings = homeInfoSettings();
    if (settings.status !== 'active') {
      host.innerHTML = '';
      section?.classList.add('is-hidden');
      return;
    }
    section?.classList.remove('is-hidden');
    applyHomeInfoStyles(section, settings);
    const counts = summary.counts || {};
    host.innerHTML = '<span class="home-info-lead">即時資訊：</span>' + [
      statCard({
        key: 'activities',
        label: settings.labels.activities,
        count: counts.activities,
        page: 'page-activities',
      }),
      statCard({
        key: 'teams',
        label: settings.labels.teams,
        count: counts.teams,
        page: 'page-teams',
      }),
      statCard({
        key: 'tournaments',
        label: settings.labels.tournaments,
        count: counts.tournaments,
        page: 'page-tournaments',
      }),
    ].join('');
  }

  function homeLayoutNodes(key) {
    if (key === 'banner') return [document.querySelector('#page-home .banner-carousel')];
    if (key === 'heroActions') return [document.querySelector('#page-home .home-hero-actions')];
    if (key === 'announcement') return [
      document.getElementById('announce-marquee-wrap'),
      document.getElementById('announce-detail-modal'),
    ];
    if (key === 'nextActivity') return [document.getElementById('home-next-activity')];
    if (key === 'sportEntry') return [document.getElementById('home-sport-entry')?.closest('.home-dashboard-section')];
    if (key === 'infoMeter') return [document.getElementById('home-info-meter')?.closest('.home-dashboard-section')];
    if (key === 'gameShortcut') return [
      document.getElementById('home-game-divider'),
      document.getElementById('home-game-heading'),
      document.getElementById('home-game-card-shot'),
      document.getElementById('home-game-card-kick'),
    ];
    if (key === 'sponsors') return [
      document.getElementById('sponsor-divider'),
      document.getElementById('sponsor-grid'),
    ];
    if (key === 'news') return [
      document.getElementById('news-divider'),
      document.getElementById('news-section-title'),
      document.getElementById('news-tabs'),
      document.getElementById('news-card-list'),
    ];
    if (key === 'floatingAds') return [document.getElementById('floating-ads')];
    return [];
  }

  function applyHomeLayoutOrder() {
    const home = document.getElementById('page-home');
    if (!home) return;
    homeLayoutSettings().order.forEach(key => {
      homeLayoutNodes(key)
        .filter(node => node && node.parentElement === home)
        .forEach(node => home.appendChild(node));
    });
  }

  Object.assign(app, {
    _homeSummary: null,

    setActiveSportFilter(sportKey, options = {}) {
      const safeKey = safeSportKey(sportKey);
      this._activeSport = safeKey;
      try { localStorage.setItem('sporthub_active_sport', safeKey); } catch (_) {}
      document.querySelectorAll('.sport-picker-item[data-sport]').forEach(item => {
        const active = item.dataset.sport === safeKey;
        item.classList.toggle('active', active);
        item.setAttribute('aria-selected', active ? 'true' : 'false');
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
      if (options.syncUrl !== false && this.currentPage === 'page-activities' && !this._applyingActivityUrlFilters) {
        this._syncActivityUrlFilters?.({ replace: true });
      }
      if (options.render !== false) {
        try { this.renderActivityList?.(); } catch (_) {}
        try { this.renderTeamList?.(); } catch (_) {}
        try { this.renderTournamentTimeline?.(); } catch (_) {}
      }
      return safeKey;
    },

    selectHomeSport(sportKey) {
      const safeKey = this.setActiveSportFilter(sportKey, { render: false });
      this.openActivitiesWithHomeFilters?.({ region: this.getHomeBannerRegion?.(), sport: safeKey });
      if (safeKey && safeKey !== 'all') {
        this.showToast?.(`已切換到${sportLabel(safeKey)}`);
      }
    },

    getHomeBannerRegion() {
      if (this._homeBannerRegion) return safeHomeRegion(this._homeBannerRegion);
      let stored = '';
      try { stored = localStorage.getItem(HOME_ACTIVITY_REGION_KEY) || ''; } catch (_) {}
      this._homeBannerRegion = safeHomeRegion(stored);
      return this._homeBannerRegion;
    },

    setHomeBannerRegion(region, options = {}) {
      const safeRegion = safeHomeRegion(region);
      this._homeBannerRegion = safeRegion;
      if (options.persist !== false) {
        try { localStorage.setItem(HOME_ACTIVITY_REGION_KEY, safeRegion); } catch (_) {}
      }
      const modalRegion = document.getElementById('home-search-region');
      if (modalRegion) modalRegion.value = safeRegion;
      if (options.syncActivities !== false && this.currentPage === 'page-activities' && typeof this.switchRegionTab === 'function') {
        this.switchRegionTab(safeRegion);
      }
      return safeRegion;
    },

    resetHomeEntryFilters() {
      this.setHomeBannerRegion?.('全部', { persist: true, syncActivities: false });
      this.setActiveSportFilter?.('all', { render: false });
      document.querySelectorAll('.home-sport-chip[data-home-sport]').forEach(item => {
        item.classList.toggle('active', item.dataset.homeSport === 'all');
      });
    },

    _ensureHomeActivitySearchModal() {
      let overlay = document.getElementById('home-activity-search-overlay');
      if (overlay) return overlay;
      const selectedRegion = this.getHomeBannerRegion();
      const selectedSport = this._activeSport || localStorage.getItem('sporthub_active_sport') || 'all';
      const regionOptions = optionHtml(HOME_ACTIVITY_REGIONS.map(region => ({ value: region, label: region })), selectedRegion);
      const sportOptions = optionHtml(homeSportOptions(), selectedSport);
      const typeOptions = optionHtml(HOME_ACTIVITY_TYPES, '');
      document.body.insertAdjacentHTML('beforeend', `
        <div class="home-activity-search-overlay" id="home-activity-search-overlay" onclick="if(event.target===this)App.closeHomeActivitySearchModal()">
          <div class="home-activity-search-dialog" role="dialog" aria-modal="true" aria-labelledby="home-activity-search-title">
            <button class="home-activity-search-close" type="button" onclick="App.closeHomeActivitySearchModal()" aria-label="關閉">&times;</button>
            <div class="home-activity-search-head">
              <h3 id="home-activity-search-title">找活動</h3>
              <p>選好條件後，我會直接帶你到活動頁並套用篩選。</p>
            </div>
            <div class="home-activity-search-fields">
              <label>
                <span>地區</span>
                <select id="home-search-region">${regionOptions}</select>
              </label>
              <label>
                <span>運動類別</span>
                <select id="home-search-sport">${sportOptions}</select>
              </label>
              <label>
                <span>活動類型</span>
                <select id="home-search-type">${typeOptions}</select>
              </label>
            </div>
            <button class="home-activity-search-submit" type="button" onclick="App.submitHomeActivitySearch()">找活動</button>
          </div>
        </div>
      `);
      return document.getElementById('home-activity-search-overlay');
    },

    openHomeActivitySearchModal() {
      const overlay = this._ensureHomeActivitySearchModal();
      const selectedRegion = this.getHomeBannerRegion();
      const selectedSport = this._activeSport || localStorage.getItem('sporthub_active_sport') || 'all';
      const regionSelect = document.getElementById('home-search-region');
      const sportSelect = document.getElementById('home-search-sport');
      const typeSelect = document.getElementById('home-search-type');
      if (regionSelect) regionSelect.value = selectedRegion;
      if (sportSelect) sportSelect.value = selectedSport;
      if (typeSelect) typeSelect.value = '';
      overlay?.classList.add('open');
      document.body.classList.add('home-activity-search-open');
    },

    closeHomeActivitySearchModal() {
      const overlay = document.getElementById('home-activity-search-overlay');
      if (overlay) overlay.classList.remove('open');
      document.body.classList.remove('home-activity-search-open');
    },

    async submitHomeActivitySearch() {
      const region = document.getElementById('home-search-region')?.value || this.getHomeBannerRegion();
      const sport = document.getElementById('home-search-sport')?.value || 'all';
      const type = document.getElementById('home-search-type')?.value || '';
      await this.openActivitiesWithHomeFilters({ region, sport, type });
      this.closeHomeActivitySearchModal();
    },

    async openActivitiesWithHomeFilters(filters = {}) {
      const scriptLoader = (typeof ScriptLoader !== 'undefined') ? ScriptLoader : root.ScriptLoader;
      const region = this.setHomeBannerRegion(filters.region || this.getHomeBannerRegion(), { persist: true });
      const sport = this.setActiveSportFilter(filters.sport || 'all', { render: false });
      const type = String(filters.type || '');

      await this.showPage?.('page-activities');
      await scriptLoader?.ensureForPage?.('page-activities');
      this.resetActivityTab?.({ render: false, syncUrl: false });

      const typeFilter = document.getElementById('activity-filter-type');
      const keywordFilter = document.getElementById('activity-filter-keyword');
      if (typeFilter) typeFilter.value = type;
      if (keywordFilter) keywordFilter.value = '';
      if (typeof this.switchRegionTab === 'function') {
        this.switchRegionTab(region);
      } else {
        this._syncActivityUrlFilters?.({ replace: true });
        try { this.renderActivityList?.(); } catch (_) {}
      }
      return { region, sport, type };
    },

    async openHomeWatchParty() {
      const scriptLoader = (typeof ScriptLoader !== 'undefined') ? ScriptLoader : root.ScriptLoader;
      const apiService = (typeof ApiService !== 'undefined') ? ApiService : root.ApiService;
      const item = apiService?.getWatchPartyBg?.();
      if (!item || item.status !== 'active') return;
      this.trackAdClick?.('watchparty', item.id || item._docId || 'watch-party-bg');

      const linkType = String(item.linkType || item.target || item.targetPage || 'activities').trim();
      if (linkType === 'url') {
        const url = String(item.linkUrl || '').trim();
        if (/^https?:\/\//i.test(url)) {
          window.open(url, '_blank', 'noopener');
          return;
        }
        this.showToast?.('\u9023\u7d50\u7db2\u5740\u5c1a\u672a\u8a2d\u5b9a');
        return;
      }
      if (linkType === 'tournaments') {
        await this.showPage?.('page-tournaments');
        await scriptLoader?.ensureForPage?.('page-tournaments');
        return;
      }
      if (linkType === 'teams') {
        await this.showPage?.('page-teams');
        await scriptLoader?.ensureForPage?.('page-teams');
        return;
      }
      await this.showPage?.('page-activities');
      await scriptLoader?.ensureForPage?.('page-activities');
      this.resetActivityTab?.({ render: false, syncUrl: false });

      const typeFilter = document.getElementById('activity-filter-type');
      const keywordFilter = document.getElementById('activity-filter-keyword');
      if (typeFilter) typeFilter.value = '';
      if (keywordFilter) keywordFilter.value = '';

      const safeKey = this.setActiveSportFilter('restaurant', { render: true });
      if (safeKey) this.showToast?.(`已切換到${sportLabel(safeKey)}`);
    },

    renderHomeWatchPartyCard() {
      const card = document.querySelector('.home-watch-party-card');
      if (!card) return;
      const wrap = card.closest('.home-hero-actions');
      const apiService = (typeof ApiService !== 'undefined') ? ApiService : root.ApiService;
      const item = apiService?.getWatchPartyBg?.();
      if (!item || item.status !== 'active') {
        card.classList.add('is-hidden');
        wrap?.classList.add('is-empty');
        card.classList.remove('has-bg');
        card.style.removeProperty('--home-watch-party-bg');
        return;
      }
      const label = String(item.title || '').trim() || '\u4e00\u8d77\u627e\u4eba\u770b\u6bd4\u8cfd';
      const textEl = card.querySelector('.home-watch-party-copy');
      if (textEl) textEl.textContent = label;
      card.setAttribute('aria-label', label);
      card.classList.remove('is-hidden');
      wrap?.classList.remove('is-empty');
      const image = String(item.image || '').trim();
      const bg = cssImageUrl(image);
      if (!bg) {
        card.classList.remove('has-bg');
        card.style.removeProperty('--home-watch-party-bg');
        return;
      }
      card.classList.add('has-bg');
      card.style.setProperty('--home-watch-party-bg', bg);
    },

    _homeCreateEventRequestSeq: 0,

    async _waitForHomeCreateEventReady(requestSeq, options = {}) {
      const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 8000;
      const startTime = Date.now();
      while (Date.now() - startTime < timeoutMs) {
        if (requestSeq !== this._homeCreateEventRequestSeq) return false;
        if (this.currentPage && this.currentPage !== 'page-activities') return false;
        if (typeof this.openCreateEventModal === 'function'
          && document.getElementById('create-event-modal')) {
          return true;
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      return false;
    },

    async openHomeCreateEvent(options = {}) {
      const requestSeq = ++this._homeCreateEventRequestSeq;
      const lineAuth = (typeof LineAuth !== 'undefined') ? LineAuth : root.LineAuth;
      const apiService = (typeof ApiService !== 'undefined') ? ApiService : root.ApiService;
      const firebaseService = (typeof FirebaseService !== 'undefined') ? FirebaseService : root.FirebaseService;
      const scriptLoader = (typeof ScriptLoader !== 'undefined') ? ScriptLoader : root.ScriptLoader;
      const isLoggedIn = typeof lineAuth !== 'undefined' && lineAuth.isLoggedIn?.();
      const currentUser = apiService?.getCurrentUser?.() || firebaseService?._cache?.currentUser || null;
      if (!options.skipLoginRequest && this._requestLoginForAction && !isLoggedIn && !currentUser) {
        this._requestLoginForAction({ type: 'createEvent' });
        return;
      }
      if (this._requireActivityCreateProfileComplete?.()) return;
      try {
        const showOptions = { disableShellFirst: true };
        if (options.resetHistory) showOptions.resetHistory = true;
        const showResult = await this.showPage?.('page-activities', showOptions);
        if (requestSeq !== this._homeCreateEventRequestSeq) return false;
        if (showResult && showResult.ok === false) {
          throw new Error(`showPage failed: ${showResult.reason || 'unknown'}`);
        }
        if (typeof scriptLoader?.ensureGroup !== 'function') {
          throw new Error('activity create script group is unavailable');
        }
        await Promise.all([
          scriptLoader.ensureForPage?.('page-activities'),
          scriptLoader.ensureGroup('activityCreate'),
        ]);
        if (requestSeq !== this._homeCreateEventRequestSeq) return false;

        const ready = await this._waitForHomeCreateEventReady(requestSeq);
        if (!ready) {
          this.showToast?.('\u6d3b\u52d5\u5efa\u7acb\u529f\u80fd\u8f09\u5165\u5931\u6557\uff0c\u8acb\u518d\u9ede\u4e00\u6b21\u300c\u6211\u8981\u958b\u5718\u300d');
          return false;
        }
        await this.openCreateEventModal();
        return true;
      } catch (err) {
        console.warn('[HomeCreateEvent] failed to open:', err);
        this.showToast?.('\u6d3b\u52d5\u5efa\u7acb\u529f\u80fd\u8f09\u5165\u5931\u6557\uff0c\u8acb\u518d\u9ede\u4e00\u6b21\u300c\u6211\u8981\u958b\u5718\u300d');
        return false;
      }
    },

    renderHomeDashboard() {
      const summary = currentSummary();
      this.renderHomeWatchPartyCard?.();
      renderSportEntry(summary);
      renderInfoMeter(summary);
      applyHomeLayoutOrder();
      scheduleHomeSummaryRefresh(summary);
      this._markPageSnapshotReady?.('page-home');
    },

    _refreshHomeSummaryFromEvents: refreshHomeSummaryFromEvents,

  });

  root.HomeDashboardUtils = {
    normalizeSummary,
    sportRows,
    numberText,
    buildSummaryFromEvents,
    isPublicActiveHomeEvent,
    homeLayoutSections: HOME_LAYOUT_SECTIONS,
    homeLayoutDefaultOrder: HOME_LAYOUT_DEFAULT_ORDER,
    normalizeHomeLayoutOrder,
    applyHomeLayoutOrder,
  };
})(typeof window !== 'undefined' ? window : globalThis);
