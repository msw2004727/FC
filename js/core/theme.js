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
    document.getElementById('activity-filter-type')?.addEventListener('change', () => {
      this.renderActivityList();
    });
    document.getElementById('activity-filter-search-btn')?.addEventListener('click', () => {
      this.renderActivityList();
    });
    document.getElementById('activity-filter-keyword')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.renderActivityList();
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

    const _allSportSvg = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" style="vertical-align:middle">'
      + '<circle cx="12" cy="12" r="10" fill="none" stroke="#ef4444" stroke-width="2"/>'
      + '<circle cx="12" cy="12" r="5" fill="#ef4444"/>'
      + '</svg>';
    const _sportIcon = (key) => key === 'all'
      ? _allSportSvg
      : getSportIconSvg(key);

    listHost.innerHTML = pickerOptions.map(item => {
      return `<button class="sport-picker-item${item.key === initialSport ? ' active' : ''}" data-sport="${escapeHTML(item.key)}">
        <span class="sp-icon">${_sportIcon(item.key)}</span>
        <span>${escapeHTML(item.label)}</span>
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
      setActiveSport(sportKey);
      btn.classList.remove('open');
      dropdown.classList.remove('open');
      const label = item.querySelector('span:nth-child(2)')?.textContent || '全部運動';
      this.showToast(`已切換為 ${label}`);

      // 觸發列表重繪
      try { this.renderHotEvents(); } catch (_) {}
      try { this.renderActivityList(); } catch (_) {}
      try { this.renderTeamList?.(); } catch (_) {}
      // 同步俱樂部頁的運動下拉選單
      try {
        const tSel = document.getElementById('team-sport-filter');
        if (tSel) tSel.value = safeKey === 'all' ? '' : safeKey;
      } catch (_) {}
    });

    document.addEventListener('click', (e) => {
      if (!wrapper.contains(e.target)) {
        btn.classList.remove('open');
        dropdown.classList.remove('open');
      }
    });
  },

});
