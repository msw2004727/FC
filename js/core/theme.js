/* ================================================
   SportHub — Theme, Filters, Tabs, Scan, SportPicker
   ================================================ */

Object.assign(App, {

  bindTheme() {
    document.getElementById('theme-toggle').addEventListener('click', () => {
      const html = document.documentElement;
      const isDark = html.dataset.theme === 'dark';
      html.dataset.theme = isDark ? 'light' : 'dark';
      const toggle = document.querySelector('.toggle-switch');
      const icon = document.querySelector('.theme-icon');
      const label = document.querySelector('#theme-toggle span:nth-child(2)');
      if (isDark) {
        toggle.classList.remove('active');
        icon.textContent = '';
        label.textContent = '淺色模式';
      } else {
        toggle.classList.add('active');
        icon.textContent = '';
        label.textContent = '深色模式';
      }
    });
  },

  bindFilterToggle() {
    document.getElementById('filter-toggle')?.addEventListener('click', () => {
      document.getElementById('filter-bar').classList.toggle('visible');
    });
    // 類別下拉篩選
    document.getElementById('activity-filter-type')?.addEventListener('change', () => {
      this.renderActivityList();
    });
    // 關鍵字搜尋：按鈕 + Enter
    document.getElementById('activity-filter-search-btn')?.addEventListener('click', () => {
      this.renderActivityList();
    });
    document.getElementById('activity-filter-keyword')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.renderActivityList();
    });
  },

  bindTabBars() {
    document.querySelectorAll('.tab-bar').forEach(bar => {
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
    document.querySelectorAll('.scan-mode').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.scan-mode').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  },

  bindSportPicker() {
    const wrapper = document.getElementById('sport-picker-wrapper');
    if (!wrapper) return;
    const btn = wrapper.querySelector('.sport-picker-btn');
    const dropdown = wrapper.querySelector('.sport-picker-dropdown');
    const items = wrapper.querySelectorAll('.sport-picker-item');

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      document.querySelectorAll('.role-dropdown.open').forEach(d => d.classList.remove('open'));
      document.querySelectorAll('.role-avatar-btn.open').forEach(b => b.classList.remove('open'));
      const isOpen = dropdown.classList.contains('open');
      btn.classList.toggle('open', !isOpen);
      dropdown.classList.toggle('open', !isOpen);
    });

    items.forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        if (item.classList.contains('locked')) return;
        const icon = item.querySelector('.sp-icon').textContent;
        items.forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        btn.querySelector('.sport-picker-icon').textContent = icon;
        const catItems = document.querySelectorAll('.cat-item:not(.add-cat)');
        catItems.forEach(c => {
          const catIcon = c.querySelector('span')?.textContent;
          c.classList.toggle('active', catIcon === icon);
        });
        btn.classList.remove('open');
        dropdown.classList.remove('open');
        this.showToast(`已選擇「${item.querySelector('span:nth-child(2)').textContent}」`);
      });
    });

    document.addEventListener('click', (e) => {
      if (!wrapper.contains(e.target)) {
        btn.classList.remove('open');
        dropdown.classList.remove('open');
      }
    });
  },

});
