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
    var labels = ['字', '中', '大'];
    var btnSizes = ['0.85rem', '1rem', '1.15rem'];
    btn.textContent = labels[idx];
    btn.style.fontSize = btnSizes[idx];
    btn.title = '字型大小：' + labels[idx];
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
    toggle.addEventListener('click', () => {
      document.getElementById('filter-bar').classList.toggle('visible');
    });
    // filter 變化時 timeline + 月曆都要同步重 render（見 calendar-view-plan §12.O）
    const _rerenderBoth = () => {
      this.renderActivityList();
      if (this._activityActiveTab === 'calendar') this._renderActivityCalendar?.();
    };
    document.getElementById('activity-filter-type')?.addEventListener('change', _rerenderBoth);
    document.getElementById('activity-filter-search-btn')?.addEventListener('click', _rerenderBoth);
    document.getElementById('activity-filter-keyword')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') _rerenderBoth();
    });
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
    const initialSport = savedSport !== null ? savedSport : 'all';
    App._activeSport = initialSport;

    const _allSportLabel = '<span class="sp-all-label" aria-hidden="true">All</span>';
    const _sportIcon = (key) => key === 'all'
      ? _allSportLabel
      : getSportIconSvg(key);

    listHost.innerHTML = pickerOptions.map(item => {
      return `<button class="sport-picker-item${item.key === initialSport ? ' active' : ''}" data-sport="${escapeHTML(item.key)}">
        <span class="sp-icon">${_sportIcon(item.key)}</span>
        <span>${escapeHTML(item.label)}</span>
        <span class="sp-pulse"></span>
      </button>`;
    }).join('');

    const setActiveSport = (sportKey) => {
      const safeKey = sportKey === 'all' ? 'all' : (getSportKeySafe(sportKey) || 'football');
      App._activeSport = safeKey;
      try { localStorage.setItem('sporthub_active_sport', safeKey); } catch (_) {}
      listHost.querySelectorAll('.sport-picker-item').forEach(item => {
        item.classList.toggle('active', item.dataset.sport === safeKey);
      });
      iconEl.innerHTML = _sportIcon(safeKey);
      document.querySelectorAll('.cat-item[data-sport]').forEach(item => {
        item.classList.toggle('active', item.dataset.sport === safeKey);
      });
      try { App._syncTeamSportFilterWithGlobal?.({ force: true }); } catch (_) {}
    };

    setActiveSport(initialSport);

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      document.querySelectorAll('.role-dropdown.open').forEach(d => d.classList.remove('open'));
      document.querySelectorAll('.role-avatar-btn.open').forEach(b => b.classList.remove('open'));
      const isOpen = dropdown.classList.contains('open');
      btn.classList.toggle('open', !isOpen);
      dropdown.classList.toggle('open', !isOpen);
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

      setActiveSport(sportKey);
      btn.classList.remove('open');
      dropdown.classList.remove('open');
      const label = item.querySelector('span:nth-child(2)')?.textContent || '全部運動';
      this.showToast(`已切換為 ${label}`);

      // 觸發列表重繪（各頁面內部會讀取 App._activeSport 進行篩選）
      try { this.renderHotEvents(); } catch (_) {}
      try { this.renderActivityList(); } catch (_) {}
      // 月曆 tab 下也要同步重 render（見 calendar-view-plan §12.D）
      try { if (this._activityActiveTab === 'calendar') this._renderActivityCalendar?.(); } catch (_) {}
      try { this.renderTeamList?.(); } catch (_) {}
      try { this.renderTournamentTimeline?.(); } catch (_) {}
    });

    document.addEventListener('click', (e) => {
      if (!wrapper.contains(e.target)) {
        btn.classList.remove('open');
        dropdown.classList.remove('open');
      }
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
