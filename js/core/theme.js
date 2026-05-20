/* ================================================
   SportHub - Theme, Filters, Tabs, Scan, SportPicker
   ================================================ */

Object.assign(App, {

  bindTheme() {
    const saved = localStorage.getItem('sporthub_theme');
    const theme = saved
      || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = theme;
    const initToggle = document.querySelector('#theme-toggle .toggle-switch');
    if (theme === 'dark' && initToggle) initToggle.classList.add('active');

    document.getElementById('theme-toggle').addEventListener('click', () => {
      const html = document.documentElement;
      const isDark = html.dataset.theme === 'dark';
      html.dataset.theme = isDark ? 'light' : 'dark';
      localStorage.setItem('sporthub_theme', html.dataset.theme);
      const toggle = document.querySelector('#theme-toggle .toggle-switch');
      if (toggle) toggle.classList.toggle('active', !isDark);
    });
  },

  _fontSizes: [15, 16.5, 18],
  _fontLabels: ['', 'font-m', 'font-l'],

  cycleFontSize() {
    const sizes = this._fontSizes;
    const cur = parseFloat(localStorage.getItem('sporthub_font_size')) || sizes[0];
    const idx = sizes.indexOf(cur);
    const next = (idx + 1) % sizes.length;
    const val = sizes[next];
    document.documentElement.style.fontSize = val + 'px';
    if (val === sizes[0]) {
      localStorage.removeItem('sporthub_font_size');
    } else {
      localStorage.setItem('sporthub_font_size', '' + val);
    }
    this._updateFontBtn(next);
  },

  _updateFontBtn(idx) {
    const btn = document.getElementById('drawer-font-btn');
    if (!btn) return;
    btn.classList.remove('font-m', 'font-l');
    if (this._fontLabels[idx]) btn.classList.add(this._fontLabels[idx]);
    btn.dataset.fontLevel = String(idx);
    var label = (typeof t === 'function') ? t('字型大小') : '字型大小';
    btn.title = label;
    btn.setAttribute('aria-label', label);
  },

  initFontSize() {
    var sizes = this._fontSizes;
    var cur = parseFloat(localStorage.getItem('sporthub_font_size')) || sizes[0];
    var idx = sizes.indexOf(cur);
    if (idx === -1) idx = 0;
    this._updateFontBtn(idx);
  },

  bindFilterToggle() {
    const toggle = document.getElementById('filter-toggle');
    if (!toggle || toggle.dataset.bound) return;
    toggle.dataset.bound = '1';
    const panel = document.getElementById('filter-bar');
    const typeSelect = document.getElementById('activity-filter-type');
    const keywordInput = document.getElementById('activity-filter-keyword');
    const syncFilterState = () => {
      const isOpen = !!panel && panel.hidden !== true;
      const hasFilters = !!(
        (typeSelect?.value || '') ||
        (keywordInput?.value || '').trim()
      );
      toggle.classList.toggle('active', isOpen || hasFilters);
      toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      if (panel) panel.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    };
    toggle.addEventListener('click', () => {
      if (!panel) return;
      const nextOpen = panel.hidden === true;
      panel.hidden = !nextOpen;
      panel.classList.toggle('visible', nextOpen);
      syncFilterState();
      if (nextOpen) {
        const focusKeyword = () => keywordInput?.focus?.({ preventScroll: true });
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(focusKeyword);
        else setTimeout(focusKeyword, 0);
      }
    });
    // filter 變化時 timeline + 月曆都要同步重 render（見 calendar-view-plan §12.O）
    const _rerenderBoth = (options = {}) => {
      syncFilterState();
      if (options.syncUrl) this._syncActivityUrlFilters?.({ replace: true });
      this.renderActivityList();
      if (this._activityActiveTab === 'calendar') this._renderActivityCalendar?.();
    };
    typeSelect?.addEventListener('change', () => _rerenderBoth({ syncUrl: true }));
    document.getElementById('activity-filter-search-btn')?.addEventListener('click', _rerenderBoth);
    keywordInput?.addEventListener('input', _rerenderBoth);
    keywordInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') _rerenderBoth();
    });
    syncFilterState();
  },

  bindTabBars() {
    document.querySelectorAll('.tab-bar').forEach(bar => {
      if (bar.dataset.bound) return;
      bar.dataset.bound = '1';
      bar.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
          bar.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
        });
      });
    });
  },

  bindTournamentTabs() {},

  bindScanModes() {
    // moved to js/modules/scan.js
  },

  bindSportPicker() {
    const wrapper = document.getElementById('sport-picker-wrapper');
    if (!wrapper || wrapper.dataset.bound === '1') return;
    wrapper.dataset.bound = '1';

    const btn = wrapper.querySelector('.sport-picker-btn');
    const dropdown = wrapper.querySelector('.sport-picker-dropdown');
    const iconEl = btn?.querySelector('.sport-picker-icon');
    const listHost = dropdown?.querySelector('#sport-picker-list');
    if (!btn || !dropdown || !iconEl || !listHost) return;

    const sportOptions = Array.isArray(EVENT_SPORT_OPTIONS) && EVENT_SPORT_OPTIONS.length > 0
      ? EVENT_SPORT_OPTIONS
      : [{ key: 'football', label: '足球' }];

    // 頂部選單專用：prepend「全部運動」（不動 EVENT_SPORT_OPTIONS，避免汙染建立活動表單）
    const pickerOptions = [{ key: 'all', label: '全部運動' }, ...sportOptions];

    // 從 localStorage 還原上次選擇（預設 all）
    const savedSport = localStorage.getItem('sporthub_active_sport');
    let initialSport = savedSport !== null ? savedSport : 'all';
    try {
      const activityUrlSport = new URLSearchParams(
        window.location.search || App._bootActivityFilterSearch || ''
      ).get('sport');
      if (activityUrlSport) {
        initialSport = activityUrlSport === 'all'
          ? 'all'
          : (getSportKeySafe(activityUrlSport) || initialSport);
      }
    } catch (_) {}
    App._activeSport = initialSport;

    const _allSportLabel = '<span class="sp-all-label" aria-hidden="true">All</span>';
    const _sportIcon = (key) => key === 'all'
      ? _allSportLabel
      : getSportIconSvg(key);

    listHost.innerHTML = pickerOptions.map(item => {
      return `<button class="sport-picker-item${item.key === initialSport ? ' active' : ''}" data-sport="${escapeHTML(item.key)}" role="option" aria-selected="${item.key === initialSport ? 'true' : 'false'}">
        <span class="sp-icon">${_sportIcon(item.key)}</span>
        <span>${escapeHTML(item.label)}</span>
        <span class="sp-pulse"></span>
      </button>`;
    }).join('');

    const setActiveSport = (sportKey, options = {}) => {
      if (typeof App.setActiveSportFilter === 'function') {
        return App.setActiveSportFilter(sportKey, { render: false, syncUrl: options.syncUrl !== false });
      }
      const safeKey = sportKey === 'all' ? 'all' : (getSportKeySafe(sportKey) || 'football');
      App._activeSport = safeKey;
      try { localStorage.setItem('sporthub_active_sport', safeKey); } catch (_) {}
      listHost.querySelectorAll('.sport-picker-item').forEach(item => {
        const active = item.dataset.sport === safeKey;
        item.classList.toggle('active', active);
        item.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      iconEl.innerHTML = _sportIcon(safeKey);
      document.querySelectorAll('.cat-item[data-sport]').forEach(item => {
        item.classList.toggle('active', item.dataset.sport === safeKey);
      });
      try { App._syncTeamSportFilterWithGlobal?.({ force: true }); } catch (_) {}
    };

    setActiveSport(initialSport, { syncUrl: false });

    const setPickerOpen = (open) => {
      btn.classList.toggle('open', open);
      dropdown.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    };

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      document.querySelectorAll('.role-dropdown.open').forEach(d => d.classList.remove('open'));
      document.querySelectorAll('.role-avatar-btn.open').forEach(b => b.classList.remove('open'));
      const isOpen = dropdown.classList.contains('open');
      setPickerOpen(!isOpen);
    });

    listHost.addEventListener('click', (e) => {
      const item = e.target.closest('.sport-picker-item[data-sport]');
      if (!item) return;
      e.stopPropagation();

      const sportKey = item.dataset.sport;

      // 詳情頁切分類時退回對應列表頁（活動/賽事/俱樂部）
      const DETAIL_TO_LIST_MAP = {
        'page-activity-detail': 'page-activities',
        'page-tournament-detail': 'page-tournaments',
        'page-team-detail': 'page-teams',
      };
      const backTo = DETAIL_TO_LIST_MAP[this.currentPage];
      if (backTo) {
        try { this.showPage(backTo); } catch (_) {}
      }

      const _perfSportLog = typeof window !== 'undefined' && (window._sportDebug || (typeof localStorage !== 'undefined' && localStorage.getItem('_sportDebug')));
      const _prevSport = App._activeSport;
      setActiveSport(sportKey);
      setPickerOpen(false);
      const label = item.querySelector('span:nth-child(2)')?.textContent || '全部運動';
      this.showToast(`已切換為 ${label}`);

      // 觸發列表重繪（各頁面內部會讀取 App._activeSport 進行篩選）
      try { this.renderHotEvents(); } catch (_) {}
      try { this.renderActivityList(); } catch (_) {}
      // 月曆 tab 下也要同步重 render（見 calendar-view-plan §12.D）
      try { if (this._activityActiveTab === 'calendar') this._renderActivityCalendar?.(); } catch (_) {}
      try { this.renderTeamList?.(); } catch (_) {}
      try { this.renderTournamentTimeline?.(); } catch (_) {}
      // 2026-04-25：管理頁也要同步重繪（用全域 sport 過濾、與普通俱樂部頁一致）
      try {
        if (this.currentPage === 'page-admin-teams') {
          const q = (document.getElementById('team-search-input')?.value || '').trim().toLowerCase();
          this.renderAdminTeams?.(q);
        }
      } catch (_) {}
      try { if (this.currentPage === 'page-team-manage') this.renderTeamManage?.(); } catch (_) {}
      if (_perfSportLog) {
        const _selVal = document.getElementById('team-sport-filter')?.value;
        const _teamCount = document.getElementById('team-list')?.children?.length;
        console.log('[sport-switch]', { from: _prevSport, to: sportKey, activeSport: App._activeSport, selValue: _selVal, teamDomCount: _teamCount, currentPage: this.currentPage });
      }
    });

    document.addEventListener('click', (e) => {
      if (!wrapper.contains(e.target)) {
        setPickerOpen(false);
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') setPickerOpen(false);
    });

    // 初次嘗試刷新光暈（資料可能尚未載入，_cloudReady 後會再呼叫一次）
    try { this._refreshSportPickerGlow(); } catch (_) {}
  },

  _refreshSportPickerGlow() {
    const listHost = document.getElementById('sport-picker-list');
    if (!listHost) return;
    const events = (typeof ApiService !== 'undefined' && ApiService.getEvents?.()) || [];
    const activeBySport = new Set();
    events.forEach(e => {
      if (e.status === 'ended' || e.status === 'cancelled') return;
      if (e.privateEvent) return;
      const tag = e.sportTag || 'football';
      activeBySport.add(tag);
    });
    const hasAny = activeBySport.size > 0;
    listHost.querySelectorAll('.sport-picker-item[data-sport]').forEach(item => {
      const key = item.dataset.sport;
      const glow = key === 'all' ? hasAny : activeBySport.has(key);
      item.classList.toggle('has-events', glow);
    });
  },

});
