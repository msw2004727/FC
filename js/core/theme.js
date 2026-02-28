/* ================================================
   SportHub - Theme, Filters, Tabs, Scan, SportPicker
   ================================================ */

Object.assign(App, {

  bindTheme() {
    const saved = localStorage.getItem('sporthub_theme');
    if (saved) {
      document.documentElement.dataset.theme = saved;
      const toggle = document.querySelector('#theme-toggle .toggle-switch');
      if (saved === 'dark' && toggle) toggle.classList.add('active');
    }

    document.getElementById('theme-toggle').addEventListener('click', () => {
      const html = document.documentElement;
      const isDark = html.dataset.theme === 'dark';
      html.dataset.theme = isDark ? 'light' : 'dark';
      localStorage.setItem('sporthub_theme', html.dataset.theme);
      const toggle = document.querySelector('#theme-toggle .toggle-switch');
      if (toggle) toggle.classList.toggle('active', !isDark);
    });
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

    const isUnlocked = (sportKey) => sportKey === 'football';
    listHost.innerHTML = sportOptions.map(item => {
      const locked = !isUnlocked(item.key);
      const lockPart = locked ? `<span class="sp-lock">${getLockIconSvg()}</span>` : '';
      return `<button class="sport-picker-item${item.key === 'football' ? ' active' : ''}${locked ? ' locked' : ''}" data-sport="${escapeHTML(item.key)}"${locked ? ' disabled' : ''}>
        <span class="sp-icon">${getSportIconSvg(item.key)}</span>
        <span>${escapeHTML(item.label)}</span>
        ${lockPart}
      </button>`;
    }).join('');

    const setActiveSport = (sportKey) => {
      const safeKey = getSportKeySafe(sportKey) || 'football';
      listHost.querySelectorAll('.sport-picker-item').forEach(item => {
        item.classList.toggle('active', item.dataset.sport === safeKey);
      });
      iconEl.innerHTML = getSportIconSvg(safeKey);

      // Keep category pills in sync if those modules are enabled in future pages.
      document.querySelectorAll('.cat-item[data-sport]').forEach(item => {
        item.classList.toggle('active', item.dataset.sport === safeKey);
      });
    };

    setActiveSport('football');

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

      if (item.classList.contains('locked')) {
        this.showToast('目前僅開放足球');
        return;
      }

      const sportKey = item.dataset.sport;
      setActiveSport(sportKey);
      btn.classList.remove('open');
      dropdown.classList.remove('open');
      const label = item.querySelector('span:nth-child(2)')?.textContent || '足球';
      this.showToast(`已切換為 ${label}`);
    });

    document.addEventListener('click', (e) => {
      if (!wrapper.contains(e.target)) {
        btn.classList.remove('open');
        dropdown.classList.remove('open');
      }
    });
  },

});
