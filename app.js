/* ================================================
   SportHub — App Controller
   依賴：config.js, data.js, api-service.js
   ================================================ */

const App = {
  currentRole: 'user',
  currentPage: 'page-home',
  currentTournament: 't1',
  pageHistory: [],
  bannerIndex: 0,
  bannerTimer: null,

  init() {
    this.bindRoleSwitcher();
    this.bindSportPicker();
    this.bindNavigation();
    this.bindDrawer();
    this.bindTheme();
    this.bindAnnouncement();
    this.bindFilterToggle();
    this.bindTabBars();
    this.bindTournamentTabs();
    this.bindScanModes();
    this.bindFloatingAds();
    this.bindNotifBtn();
    this.bindImageUpload('ce-image', 'ce-upload-preview');
    this.bindImageUpload('ct-image', 'ct-upload-preview');
    this.bindImageUpload('cs-img1', 'cs-preview1');
    this.bindImageUpload('cs-img2', 'cs-preview2');
    this.bindImageUpload('cs-img3', 'cs-preview3');
    this.startBannerCarousel();
    this.renderAll();
    this.applyRole('user');
  },

  // ══════════════════════════════════
  //  Role System
  // ══════════════════════════════════

  bindRoleSwitcher() {
    const wrapper = document.getElementById('role-switcher-wrapper');
    if (!wrapper) return;
    const avatarBtn = wrapper.querySelector('.role-avatar-btn');
    const dropdown = wrapper.querySelector('.role-dropdown');
    const dropdownItems = wrapper.querySelectorAll('.role-dropdown-item');
    if (!avatarBtn || !dropdown) return;

    avatarBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isOpen = dropdown.classList.contains('open');
      avatarBtn.classList.toggle('open', !isOpen);
      dropdown.classList.toggle('open', !isOpen);
    });

    dropdownItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const role = item.dataset.role;
        const roleLabel = item.querySelector('span:last-child')?.textContent || '';
        dropdownItems.forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        const labelEl = wrapper.querySelector('.role-current-label');
        if (labelEl) labelEl.textContent = roleLabel;
        this.applyRole(role);
        avatarBtn.classList.remove('open');
        dropdown.classList.remove('open');
      });
    });

    document.addEventListener('click', (e) => {
      if (!wrapper.contains(e.target)) {
        avatarBtn.classList.remove('open');
        dropdown.classList.remove('open');
      }
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

  applyRole(role) {
    this.currentRole = role;
    const roleInfo = ROLES[role];
    const level = ROLE_LEVEL_MAP[role];

    document.getElementById('drawer-role-tag').textContent = roleInfo.label;
    document.getElementById('drawer-role-tag').style.background = roleInfo.color + '22';
    document.getElementById('drawer-role-tag').style.color = roleInfo.color;

    document.querySelectorAll('[data-min-role]').forEach(el => {
      const minLevel = ROLE_LEVEL_MAP[el.dataset.minRole] || 0;
      el.style.display = level >= minLevel ? '' : 'none';
    });

    document.querySelectorAll('.contact-row').forEach(el => {
      el.style.display = level >= 1 ? 'flex' : 'none';
    });

    this.renderDrawerMenu();
    this.renderAdminUsers();

    const currentPageEl = document.getElementById(this.currentPage);
    if (currentPageEl && currentPageEl.dataset.minRole) {
      const minLevel = ROLE_LEVEL_MAP[currentPageEl.dataset.minRole] || 0;
      if (level < minLevel) this.showPage('page-home');
    }

    this.showToast(`已切換為「${roleInfo.label}」身份`);
  },

  // ══════════════════════════════════
  //  Drawer Menu
  // ══════════════════════════════════

  renderDrawerMenu() {
    const container = document.getElementById('drawer-menu');
    const level = ROLE_LEVEL_MAP[this.currentRole];
    let html = '';

    DRAWER_MENUS.forEach(item => {
      const minLevel = ROLE_LEVEL_MAP[item.minRole] || 0;
      if (level < minLevel) return;
      if (item.divider) {
        html += '<div class="drawer-divider"></div>';
      } else if (item.sectionLabel) {
        html += `<div class="drawer-section-label">${item.sectionLabel}</div>`;
      } else {
        const onClick = item.action === 'share'
          ? `App.showToast('已複製分享連結！')`
          : `App.showPage('${item.page}'); App.closeDrawer()`;
        html += `<div class="drawer-item" onclick="${onClick}">
          <span class="di-icon">${item.icon}</span>${item.label}
        </div>`;
      }
    });

    container.innerHTML = html;
  },

  // ══════════════════════════════════
  //  Navigation
  // ══════════════════════════════════

  bindNavigation() {
    document.querySelectorAll('.bot-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const page = tab.dataset.page;
        this.pageHistory = [];
        this.showPage(page);
        document.querySelectorAll('.bot-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
      });
    });
  },

  showPage(pageId) {
    if (this.currentPage !== pageId) {
      this.pageHistory.push(this.currentPage);
    }
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById(pageId);
    if (target) {
      target.classList.add('active');
      this.currentPage = pageId;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  },

  goBack() {
    if (this.pageHistory.length > 0) {
      const prev = this.pageHistory.pop();
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.getElementById(prev).classList.add('active');
      this.currentPage = prev;
      const mainPages = ['page-home','page-activities','page-teams','page-messages','page-profile'];
      document.querySelectorAll('.bot-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.page === prev && mainPages.includes(prev));
      });
    }
  },

  // ══════════════════════════════════
  //  Drawer / Theme / UI Bindings
  // ══════════════════════════════════

  bindDrawer() {
    document.getElementById('menu-toggle').addEventListener('click', () => this.openDrawer());
    document.getElementById('drawer-overlay').addEventListener('click', () => this.closeDrawer());
  },

  openDrawer() {
    document.getElementById('side-drawer').classList.add('open');
    document.getElementById('drawer-overlay').classList.add('open');
  },

  closeDrawer() {
    document.getElementById('side-drawer').classList.remove('open');
    document.getElementById('drawer-overlay').classList.remove('open');
  },

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
        icon.textContent = '☀️';
        label.textContent = '淺色模式';
      } else {
        toggle.classList.add('active');
        icon.textContent = '🌙';
        label.textContent = '深色模式';
      }
    });
  },

  bindAnnouncement() {
    document.querySelector('.announce-header')?.addEventListener('click', () => {
      document.getElementById('announce-card').classList.toggle('collapsed');
    });
  },

  bindFilterToggle() {
    document.getElementById('filter-toggle')?.addEventListener('click', () => {
      document.getElementById('filter-bar').classList.toggle('visible');
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

  bindNotifBtn() {
    document.getElementById('notif-btn')?.addEventListener('click', () => {
      this.showPage('page-messages');
      document.querySelectorAll('.bot-tab').forEach(t => t.classList.remove('active'));
    });
  },

  // ══════════════════════════════════
  //  Banner Carousel
  // ══════════════════════════════════

  startBannerCarousel() {
    const track = document.getElementById('banner-track');
    const dots = document.getElementById('banner-dots');
    const slides = track.querySelectorAll('.banner-slide');
    const count = slides.length;
    this.bannerCount = count;

    dots.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const dot = document.createElement('div');
      dot.className = 'banner-dot' + (i === 0 ? ' active' : '');
      dot.addEventListener('click', () => this.goToBanner(i));
      dots.appendChild(dot);
    }

    document.getElementById('banner-prev')?.addEventListener('click', () => {
      this.goToBanner((this.bannerIndex - 1 + count) % count);
    });
    document.getElementById('banner-next')?.addEventListener('click', () => {
      this.goToBanner((this.bannerIndex + 1) % count);
    });

    this.bannerTimer = setInterval(() => {
      this.bannerIndex = (this.bannerIndex + 1) % count;
      this.goToBanner(this.bannerIndex);
    }, 8000);
  },

  goToBanner(idx) {
    this.bannerIndex = idx;
    const track = document.getElementById('banner-track');
    track.style.transform = `translateX(-${idx * 100}%)`;
    document.querySelectorAll('.banner-dot').forEach((d, i) => d.classList.toggle('active', i === idx));
  },

  // ══════════════════════════════════
  //  Render All
  // ══════════════════════════════════

  renderAll() {
    this.renderHotEvents();
    this.renderOngoingTournaments();
    this.renderActivityList();
    this.renderTeamList();
    this.renderMessageList();
    this.renderAchievements();
    this.renderBadges();
    this.renderShop();
    this.renderLeaderboard();
    this.renderTournamentTimeline();
    this.renderActivityRecords();
    this.renderAdminUsers();
    this.renderExpLogs();
    this.renderOperationLogs();
    this.renderBannerManage();
    this.renderShopManage();
    this.renderMsgManage();
    this.renderTournamentManage();
    this.renderAdminTeams();
    this.renderPermissions();
    this.renderInactiveData();
    this.renderMyActivities();
    this.renderUserCard();
  },

  // ══════════════════════════════════
  //  Universal User Capsule Tag
  // ══════════════════════════════════

  _userTag(name, forceRole) {
    const role = forceRole || ApiService.getUserRole(name);
    return `<span class="user-capsule uc-${role}" onclick="App.showUserProfile('${name}')" title="${ROLES[role]?.label || '一般用戶'}">${name}</span>`;
  },

  showUserProfile(name) {
    const role = ApiService.getUserRole(name);
    const roleInfo = ROLES[role];
    document.querySelector('#page-user-card .page-header h2').textContent = '用戶資料卡片';
    document.getElementById('user-card-full').innerHTML = `
      <div class="uc-header">
        <div class="uc-doll-frame">👤</div>
        <div class="profile-title">${name}</div>
        <div style="margin-top:.3rem">${this._userTag(name)}</div>
        <div class="profile-level">
          <span>Lv.${Math.floor(Math.random()*25+5)}</span>
          <div class="exp-bar"><div class="exp-fill" style="width:${Math.floor(Math.random()*80+10)}%"></div></div>
        </div>
      </div>
      <div class="info-card">
        <div class="info-title">基本資料</div>
        <div class="info-row"><span>身份</span><span style="color:${roleInfo.color};font-weight:600">${roleInfo.label}</span></div>
        <div class="info-row"><span>地區</span><span>台北市</span></div>
        <div class="info-row"><span>運動類別</span><span>⚽</span></div>
      </div>
      <div class="info-card">
        <div class="info-title">成就 & 徽章</div>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap">
          <span style="font-size:1.5rem">🌱</span>
          <span style="font-size:1.5rem">⭐</span>
        </div>
      </div>
      <p style="text-align:center;font-size:.78rem;color:var(--text-muted);margin-top:1rem">此為用戶公開資訊頁面預留位置</p>
    `;
    this.showPage('page-user-card');
  },

  // ══════════════════════════════════
  //  Render: Hot Events
  // ══════════════════════════════════

  renderHotEvents() {
    const container = document.getElementById('hot-events');
    const upcoming = ApiService.getHotEvents(14);

    container.innerHTML = upcoming.length > 0
      ? upcoming.map(e => `
        <div class="h-card" onclick="App.showEventDetail('${e.id}')">
          <div class="h-card-img" style="background:${e.gradient}">${e.icon}</div>
          <div class="h-card-body">
            <div class="h-card-title">${e.title}</div>
            <div class="h-card-meta">
              <span>📍 ${e.location.split('市')[0]}市</span>
              <span>👥 ${e.current}/${e.max}</span>
            </div>
          </div>
        </div>
      `).join('')
      : '<div style="padding:1rem;font-size:.82rem;color:var(--text-muted)">近兩週內無活動</div>';

  },

  // ══════════════════════════════════
  //  Render: Ongoing Tournaments
  // ══════════════════════════════════

  renderOngoingTournaments() {
    const container = document.getElementById('ongoing-tournaments');
    container.innerHTML = ApiService.getTournaments().map(t => `
      <div class="h-card" onclick="App.showTournamentDetail('${t.id}')">
        <div class="h-card-img" style="background:${t.gradient}">🏆</div>
        <div class="h-card-body">
          <div class="h-card-title">${t.name}</div>
          <div class="h-card-meta">
            <span>${t.type}</span>
            <span>${t.teams} 隊</span>
          </div>
        </div>
      </div>
    `).join('');

  },

  // ══════════════════════════════════
  //  Render: Activity Timeline
  // ══════════════════════════════════

  renderActivityList() {
    const container = document.getElementById('activity-list');
    if (!container) return;

    const monthGroups = {};
    ApiService.getEvents().forEach(e => {
      const parts = e.date.split(' ')[0].split('/');
      const monthKey = `${parts[0]}/${parts[1]}`;
      const day = parseInt(parts[2], 10);
      const dateObj = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, day);
      const dayName = DAY_NAMES[dateObj.getDay()];

      if (!monthGroups[monthKey]) monthGroups[monthKey] = {};
      if (!monthGroups[monthKey][day]) {
        monthGroups[monthKey][day] = { day, dayName, dateObj, events: [] };
      }
      monthGroups[monthKey][day].events.push(e);
    });

    const today = new Date();
    const todayStr = `${today.getFullYear()}/${today.getMonth()+1}/${today.getDate()}`;

    let html = '';
    Object.keys(monthGroups).sort().forEach(monthKey => {
      const [y, m] = monthKey.split('/');
      const monthLabel = `${y} 年 ${parseInt(m)} 月`;
      html += `<div class="tl-month-group">`;
      html += `<div class="tl-month-header">${monthLabel}</div>`;

      const days = Object.values(monthGroups[monthKey]).sort((a, b) => a.day - b.day);
      days.forEach(dayInfo => {
        const isToday = todayStr === `${y}/${parseInt(m)}/${dayInfo.day}`;
        html += `<div class="tl-day-group">`;
        html += `<div class="tl-date-col${isToday ? ' today' : ''}">
          <div class="tl-day-num">${dayInfo.day}</div>
          <div class="tl-day-name">週${dayInfo.dayName}</div>
        </div>`;
        html += `<div class="tl-events-col">`;

        dayInfo.events.forEach(e => {
          const typeConf = TYPE_CONFIG[e.type] || TYPE_CONFIG.friendly;
          const statusConf = STATUS_CONFIG[e.status] || STATUS_CONFIG.open;
          const time = e.date.split(' ')[1] || '';
          const isEnded = e.status === 'ended' || e.status === 'cancelled';

          html += `
            <div class="tl-event-row${isEnded ? ' tl-past' : ''}" onclick="App.showEventDetail('${e.id}')">
              <div class="tl-type-icon ${typeConf.color}">${typeConf.icon}</div>
              <div class="tl-event-info">
                <div class="tl-event-title">${e.title}</div>
                <div class="tl-event-meta">${time} · ${e.location.split('市')[1] || e.location} · ${e.current}/${e.max}人</div>
              </div>
              <span class="tl-event-status ${statusConf.css}">${statusConf.label}</span>
              <span class="tl-event-arrow">›</span>
            </div>`;
        });

        html += `</div></div>`;
      });

      html += `</div>`;
    });

    container.innerHTML = html;
  },

  // ══════════════════════════════════
  //  Show Event Detail
  // ══════════════════════════════════

  showEventDetail(id) {
    const e = ApiService.getEvent(id);
    if (!e) return;
    document.getElementById('detail-title').textContent = e.title;
    document.getElementById('detail-body').innerHTML = `
      <div class="detail-row"><span class="icon">📍</span>${e.location}</div>
      <div class="detail-row"><span class="icon">🕐</span>${e.date}</div>
      <div class="detail-row"><span class="icon">💰</span>${e.fee > 0 ? '$'+e.fee : '免費'}</div>
      <div class="detail-row"><span class="icon">👥</span>已報 ${e.current}/${e.max}　候補 ${e.waitlist}/${e.waitlistMax}</div>
      <div class="detail-row"><span class="icon">🔞</span>年齡限制：${e.minAge > 0 ? e.minAge + ' 歲以上' : '無限制'}</div>
      <div class="detail-row"><span class="icon">👤</span>${e.creator}</div>
      ${e.contact ? `<div class="detail-row"><span class="icon">📞</span>${e.contact}</div>` : ''}
      <div class="detail-row"><span class="icon">⏰</span>活動倒數：${e.countdown}</div>
      ${e.notes ? `
      <div class="detail-section">
        <div class="detail-section-title">注意事項</div>
        <p style="font-size:.85rem;color:var(--text-secondary);line-height:1.7;white-space:pre-wrap">${e.notes}</p>
      </div>` : ''}
      <div style="display:flex;gap:.5rem;margin:1rem 0">
        <button class="primary-btn" onclick="App.handleSignup('${e.id}')">${e.current >= e.max ? '候補報名' : '立即報名'}</button>
        <button class="outline-btn" onclick="App.showToast('已發送站內信')">透過站內信聯繫</button>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">報名名單 (${e.current})</div>
        <div class="participant-list">${e.participants.map(p => this._userTag(p)).join('')}</div>
      </div>
      ${e.waitlistNames.length > 0 ? `
      <div class="detail-section">
        <div class="detail-section-title">候補名單 (${e.waitlist})</div>
        <div class="participant-list">${e.waitlistNames.map(p => this._userTag(p)).join('')}</div>
      </div>` : ''}
    `;
    this.showPage('page-activity-detail');
  },

  handleSignup(id) {
    const e = ApiService.getEvent(id);
    if (!e) return;
    if (e.current >= e.max) {
      this.showToast('⚠️ 已額滿，已加入候補名單');
    } else {
      this.showToast('✅ 報名成功！');
    }
  },

  // ══════════════════════════════════
  //  Render: Teams
  // ══════════════════════════════════

  _sortTeams(teams) {
    return [...teams].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      if (a.pinned && b.pinned) return (a.pinOrder || 0) - (b.pinOrder || 0);
      return 0;
    });
  },

  _teamCardHTML(t) {
    const pinnedClass = t.pinned ? ' tc-pinned' : '';
    return `
      <div class="tc-card${pinnedClass}" onclick="App.showTeamDetail('${t.id}')">
        ${t.pinned ? '<div class="tc-pin-badge">📌 至頂</div>' : ''}
        <div class="tc-img-placeholder">隊徽 120 × 120</div>
        <div class="tc-body">
          <div class="tc-name">${t.name}</div>
          <div class="tc-name-en">${t.nameEn || ''}</div>
          <div class="tc-info-row"><span class="tc-label">👑 領隊</span><span>${this._userTag(t.captain, 'captain')}</span></div>
          <div class="tc-info-row"><span class="tc-label">🏋️ 教練</span><span>${t.coaches.length > 0 ? t.coaches.map(c => this._userTag(c, 'coach')).join(' ') : '—'}</span></div>
          <div class="tc-info-row"><span class="tc-label">👥 隊員</span><span>${t.members} 人</span></div>
          <div class="tc-info-row"><span class="tc-label">📍 地區</span><span>${t.region}</span></div>
        </div>
      </div>`;
  },

  renderTeamList() {
    const container = document.getElementById('team-list');
    if (!container) return;
    const sorted = this._sortTeams(ApiService.getActiveTeams());
    container.innerHTML = sorted.map(t => this._teamCardHTML(t)).join('');
  },

  filterTeams() {
    const query = (document.getElementById('team-search')?.value || '').trim().toLowerCase();
    const region = document.getElementById('team-region-filter')?.value || '';
    const container = document.getElementById('team-list');

    let filtered = ApiService.getActiveTeams();
    if (query) {
      filtered = filtered.filter(t =>
        t.name.toLowerCase().includes(query) ||
        (t.nameEn || '').toLowerCase().includes(query) ||
        t.captain.toLowerCase().includes(query)
      );
    }
    if (region) {
      filtered = filtered.filter(t => t.region === region);
    }

    const sorted = this._sortTeams(filtered);
    container.innerHTML = sorted.length > 0
      ? sorted.map(t => this._teamCardHTML(t)).join('')
      : '<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--text-muted);font-size:.85rem">找不到符合的球隊</div>';
  },

  showTeamDetail(id) {
    const t = ApiService.getTeam(id);
    if (!t) return;
    document.getElementById('team-detail-title').textContent = t.name;
    document.getElementById('team-detail-name-en').textContent = t.nameEn || '';

    const totalGames = t.wins + t.draws + t.losses;
    const winRate = totalGames > 0 ? Math.round(t.wins / totalGames * 100) : 0;

    document.getElementById('team-detail-body').innerHTML = `
      <div class="td-card">
        <div class="td-card-title">球隊資訊</div>
        <div class="td-card-grid">
          <div class="td-card-item"><span class="td-card-label">👑 領隊</span><span class="td-card-value">${this._userTag(t.captain, 'captain')}</span></div>
          <div class="td-card-item"><span class="td-card-label">🏋️ 教練</span><span class="td-card-value">${t.coaches.length > 0 ? t.coaches.map(c => this._userTag(c, 'coach')).join(' ') : '無'}</span></div>
          <div class="td-card-item"><span class="td-card-label">👥 隊員數</span><span class="td-card-value">${t.members} 人</span></div>
          <div class="td-card-item"><span class="td-card-label">📍 地區</span><span class="td-card-value">${t.region}</span></div>
        </div>
      </div>
      <div class="td-card">
        <div class="td-card-title">球隊戰績</div>
        <div class="td-stats-row">
          <div class="td-stat"><span class="td-stat-num" style="color:var(--success)">${t.wins}</span><span class="td-stat-label">勝</span></div>
          <div class="td-stat"><span class="td-stat-num" style="color:var(--warning)">${t.draws}</span><span class="td-stat-label">平</span></div>
          <div class="td-stat"><span class="td-stat-num" style="color:var(--danger)">${t.losses}</span><span class="td-stat-label">負</span></div>
          <div class="td-stat"><span class="td-stat-num">${winRate}%</span><span class="td-stat-label">勝率</span></div>
        </div>
        <div class="td-card-grid" style="margin-top:.5rem">
          <div class="td-card-item"><span class="td-card-label">進球</span><span class="td-card-value">${t.gf}</span></div>
          <div class="td-card-item"><span class="td-card-label">失球</span><span class="td-card-value">${t.ga}</span></div>
          <div class="td-card-item"><span class="td-card-label">淨勝球</span><span class="td-card-value">${t.gf - t.ga > 0 ? '+' : ''}${t.gf - t.ga}</span></div>
          <div class="td-card-item"><span class="td-card-label">總場次</span><span class="td-card-value">${totalGames}</span></div>
        </div>
      </div>
      <div class="td-card">
        <div class="td-card-title">賽事紀錄</div>
        ${(t.history || []).map(h => `
          <div class="td-history-row">
            <span class="td-history-name">${h.name}</span>
            <span class="td-history-result">${h.result}</span>
          </div>
        `).join('') || '<div style="font-size:.82rem;color:var(--text-muted);padding:.3rem">尚無賽事紀錄</div>'}
      </div>
      <div class="td-card">
        <div class="td-card-title">成員列表</div>
        <div class="td-member-list">
          ${Array.from({length: Math.min(t.members, 8)}, (_, i) => {
            const role = i === 0 ? 'captain' : i <= t.coaches.length ? 'coach' : 'user';
            const roleLabel = i === 0 ? '領隊' : i <= t.coaches.length ? '教練' : '球員';
            const roleClass = i === 0 ? 'captain' : i <= t.coaches.length ? 'coach' : 'player';
            const memberName = i === 0 ? t.captain : i <= t.coaches.length ? t.coaches[i - 1] : '球員' + String.fromCharCode(65 + i);
            return `
            <div class="td-member-card">
              <div class="td-member-avatar" style="background:${t.color}22;color:${t.color}">${i === 0 ? t.captain.charAt(t.captain.length - 1) : String.fromCharCode(65 + i)}</div>
              <div class="td-member-info">
                <div class="td-member-name">${this._userTag(memberName, role)}</div>
                <span class="td-member-role ${roleClass}">${roleLabel}</span>
              </div>
            </div>`;
          }).join('')}
          ${t.members > 8 ? `<div class="td-member-more">... 共 ${t.members} 人</div>` : ''}
        </div>
      </div>
      <div class="td-actions">
        <button class="primary-btn" onclick="App.showToast('已送出加入申請！')">申請加入</button>
        <button class="outline-btn" onclick="App.showToast('透過站內信聯繫')">聯繫領隊</button>
      </div>
    `;
    this.showPage('page-team-detail');
  },

  // ══════════════════════════════════
  //  Render: Messages
  // ══════════════════════════════════

  renderMessageList() {
    const container = document.getElementById('message-list');
    container.innerHTML = ApiService.getMessages().map(m => `
      <div class="msg-card">
        <div class="msg-card-header">
          <span class="msg-dot ${m.unread ? 'unread' : 'read'}"></span>
          <span class="msg-type">${m.typeName}</span>
          <span class="msg-title">${m.title}</span>
        </div>
        <div class="msg-preview">${m.preview}</div>
        <div class="msg-time">${m.time}</div>
      </div>
    `).join('');
  },

  // ══════════════════════════════════
  //  Render: Achievements & Badges
  // ══════════════════════════════════

  renderAchievements() {
    const container = document.getElementById('achievement-grid');
    container.innerHTML = ApiService.getAchievements().map(a => `
      <div class="ach-item ${a.unlocked ? '' : 'locked'}">
        <div class="ach-icon">${a.unlocked ? a.icon : '🔒'}</div>
        <div class="ach-name">${a.name}</div>
      </div>
    `).join('');
  },

  renderBadges() {
    const container = document.getElementById('badge-grid');
    container.innerHTML = ApiService.getBadges().map(b => `
      <div class="badge-item">
        <div class="ach-icon">${b.icon}</div>
        <div class="ach-name">${b.name}</div>
      </div>
    `).join('');
  },

  // ══════════════════════════════════
  //  Render: Shop
  // ══════════════════════════════════

  renderShop() {
    const container = document.getElementById('shop-grid');
    container.innerHTML = ApiService.getShopItems().map(s => `
      <div class="shop-card" onclick="App.showShopDetail('${s.id}')">
        <div class="shop-img-placeholder">商品圖 150 × 150</div>
        <div class="shop-body">
          <div class="shop-name">${s.name}</div>
          <div class="shop-price">$${s.price.toLocaleString()}</div>
          <div class="shop-meta">${s.condition} ・ ${s.size}</div>
        </div>
      </div>
    `).join('');
  },

  showShopDetail(id) {
    const s = ApiService.getShopItem(id);
    if (!s) return;
    document.getElementById('shop-detail-title').textContent = s.name;
    document.getElementById('shop-detail-body').innerHTML = `
      <div class="sd-images">
        <div class="sd-img-item" onclick="App.openLightbox(this)"><div class="td-img-placeholder">商品圖 1<br>400 × 300</div></div>
        <div class="sd-img-item" onclick="App.openLightbox(this)"><div class="td-img-placeholder">商品圖 2<br>400 × 300</div></div>
        <div class="sd-img-item" onclick="App.openLightbox(this)"><div class="td-img-placeholder">商品圖 3<br>400 × 300</div></div>
      </div>
      <div class="td-card">
        <div class="td-card-title">商品資訊</div>
        <div class="td-card-grid">
          <div class="td-card-item"><span class="td-card-label">品名</span><span class="td-card-value">${s.name}</span></div>
          <div class="td-card-item"><span class="td-card-label">新舊程度</span><span class="td-card-value">${s.condition}</span></div>
          <div class="td-card-item"><span class="td-card-label">價格</span><span class="td-card-value" style="color:var(--accent)">$${s.price.toLocaleString()}</span></div>
          <div class="td-card-item"><span class="td-card-label">尺寸</span><span class="td-card-value">${s.size}</span></div>
        </div>
      </div>
      <div class="td-card">
        <div class="td-card-title">商品描述</div>
        <p style="font-size:.85rem;color:var(--text-secondary);line-height:1.7">${s.desc || '賣家未提供描述。'}</p>
      </div>
      <div class="td-actions">
        <button class="primary-btn" onclick="App.showToast('已發送購買意願！')">我想購買</button>
        <button class="outline-btn" onclick="App.showToast('已透過站內信聯繫賣家')">聯繫賣家</button>
      </div>
    `;
    this.showPage('page-shop-detail');
  },

  openLightbox(el) {
    const img = el.querySelector('img');
    const lb = document.getElementById('lightbox');
    if (img && lb) {
      document.getElementById('lightbox-img').src = img.src;
      lb.classList.add('open');
    } else {
      this.showToast('Demo 模式：尚未上傳實際圖片');
    }
  },

  closeLightbox() {
    document.getElementById('lightbox')?.classList.remove('open');
  },

  // ══════════════════════════════════
  //  Render: Leaderboard
  // ══════════════════════════════════

  renderLeaderboard() {
    const container = document.getElementById('leaderboard-list');
    container.innerHTML = ApiService.getLeaderboard().map((p, i) => {
      const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : 'normal';
      return `
        <div class="lb-item">
          <div class="lb-rank ${rankClass}">${i + 1}</div>
          <div class="lb-avatar">${p.avatar}</div>
          <div class="lb-info">
            <div class="lb-name">${this._userTag(p.name)}</div>
            <div class="lb-sub">Lv.${p.level}</div>
          </div>
          <div class="lb-exp">${p.exp.toLocaleString()}</div>
        </div>
      `;
    }).join('');
  },

  // ══════════════════════════════════
  //  Render: Tournament Timeline & Detail
  // ══════════════════════════════════

  renderTournamentTimeline() {
    const container = document.getElementById('tournament-timeline');
    if (!container) return;

    const tournaments = ApiService.getTournaments();
    const leagues = tournaments.filter(t => t.type.includes('聯賽'));
    const cups = tournaments.filter(t => !t.type.includes('聯賽'));

    const renderSection = (title, icon, items) => {
      let html = `<div class="tl-month-header">${icon} ${title}</div>`;
      items.forEach(t => {
        const statusMap = { '進行中': 'open', '即將開始': 'upcoming', '報名中': 'open', '已結束': 'ended' };
        const css = statusMap[t.status] || 'open';
        html += `
          <div class="tl-event-row" onclick="App.showTournamentDetail('${t.id}')" style="margin-bottom:.4rem">
            <div class="tl-type-icon league">🏆</div>
            <div class="tl-event-info">
              <div class="tl-event-title">${t.name}</div>
              <div class="tl-event-meta">${t.type} · ${t.teams}隊 · ${t.matches}場</div>
            </div>
            <span class="tl-event-status ${css}">${t.status}</span>
            <span class="tl-event-arrow">›</span>
          </div>`;
      });
      return html;
    };

    container.innerHTML =
      renderSection('聯賽', '🏆', leagues) +
      '<div style="height:.5rem"></div>' +
      renderSection('盃賽', '🥊', cups);
  },

  showTournamentDetail(id) {
    this.currentTournament = id;
    const t = ApiService.getTournament(id);
    if (!t) return;
    document.getElementById('td-title').textContent = t.name;
    this.showPage('page-tournament-detail');

    document.querySelectorAll('#td-tabs .tab').forEach(tab => {
      tab.onclick = () => {
        document.querySelectorAll('#td-tabs .tab').forEach(x => x.classList.remove('active'));
        tab.classList.add('active');
        this.renderTournamentTab(tab.dataset.ttab);
      };
    });
    document.querySelectorAll('#td-tabs .tab').forEach(x => x.classList.toggle('active', x.dataset.ttab === 'schedule'));
    this.renderTournamentTab('schedule');
  },

  renderTournamentTab(tab) {
    const container = document.getElementById('tournament-content');
    if (!container) return;
    const t = ApiService.getTournament(this.currentTournament);
    const isCup = t && !t.type.includes('聯賽');

    if (tab === 'schedule') {
      container.innerHTML = isCup ? this.renderBracket() : this.renderLeagueSchedule();
    } else if (tab === 'standings') {
      container.innerHTML = `<table class="standings-table">
        <tr><th>#</th><th>隊名</th><th>勝</th><th>平</th><th>負</th><th>積分</th></tr>
        ${ApiService.getStandings().map(s => `<tr><td>${s.rank}</td><td>${s.name}</td><td>${s.w}</td><td>${s.d}</td><td>${s.l}</td><td><strong>${s.pts}</strong></td></tr>`).join('')}
      </table>`;
    } else if (tab === 'trades') {
      container.innerHTML = `
        <div style="padding:.5rem;margin-bottom:.5rem;font-size:.82rem;color:var(--text-secondary)">
          交易窗口：03/01~03/20　狀態：<span style="color:var(--success);font-weight:600">🟢 開放中</span>
        </div>
        ${ApiService.getTrades().map(tr => `
          <div class="trade-card">
            <div style="font-weight:600;margin-bottom:.25rem">${tr.from} → ${tr.to}</div>
            <div>球員：${tr.player}　價值：${tr.value} 積分</div>
            <div style="margin-top:.3rem"><span class="trade-status ${tr.status}">${tr.status === 'success' ? '✅ 成交' : '⏳ 待確認'}</span> <span style="font-size:.72rem;color:var(--text-muted)">${tr.date}</span></div>
          </div>
        `).join('')}`;
    }
  },

  renderLeagueSchedule() {
    const teams = ApiService.getTeams();
    const matches = ApiService.getMatches();

    let html = '<div style="font-size:.78rem;font-weight:700;color:var(--text-muted);margin-bottom:.4rem">賽程</div>';
    matches.forEach(m => {
      const homeTeam = teams.find(t => t.name === m.home);
      const awayTeam = teams.find(t => t.name === m.away);
      html += `
        <div class="match-card-compact">
          <div class="mc-team">
            <div class="mc-emblem" style="background:${homeTeam?.color || '#666'}22;color:${homeTeam?.color || '#666'}">${homeTeam?.emblem || '?'}</div>
            <span>${m.home}</span>
          </div>
          <div class="mc-score">${m.scoreH !== null ? `${m.scoreH} : ${m.scoreA}` : 'vs'}</div>
          <div class="mc-team away">
            <span>${m.away}</span>
            <div class="mc-emblem" style="background:${awayTeam?.color || '#666'}22;color:${awayTeam?.color || '#666'}">${awayTeam?.emblem || '?'}</div>
          </div>
        </div>
        <div class="mc-meta"><span>📍 ${m.venue}</span><span>🕐 ${m.time}</span></div>`;
    });

    html += '<div style="font-size:.78rem;font-weight:700;color:var(--text-muted);margin:.8rem 0 .4rem">循環對戰表</div>';
    html += '<div class="rr-table-wrap"><table class="rr-table"><tr><th></th>';
    teams.forEach(t => { html += `<th>${t.emblem}</th>`; });
    html += '</tr>';
    teams.forEach((home, hi) => {
      html += `<tr><td class="rr-team-cell">${home.emblem} ${home.name}</td>`;
      teams.forEach((away, ai) => {
        if (hi === ai) {
          html += '<td class="rr-self">—</td>';
        } else {
          const m = matches.find(x => (x.home === home.name && x.away === away.name));
          if (m && m.scoreH !== null) {
            const cls = m.scoreH > m.scoreA ? 'rr-win' : m.scoreH < m.scoreA ? 'rr-loss' : 'rr-draw';
            html += `<td class="${cls}">${m.scoreH}:${m.scoreA}</td>`;
          } else {
            html += '<td style="color:var(--text-muted)">-</td>';
          }
        }
      });
      html += '</tr>';
    });
    html += '</table></div>';
    return html;
  },

  renderBracket() {
    const bracketData = [
      { round: '八強', matches: [
        { t1: '雷霆隊', s1: 3, t2: '旋風B隊', s2: 0, e1: '⚡', e2: '🌀' },
        { t1: '閃電隊', s1: 2, t2: '火焰B隊', s2: 1, e1: '🌩', e2: '🔥' },
        { t1: '旋風隊', s1: 1, t2: '獵鷹隊', s2: 1, e1: '🌀', e2: '🦅' },
        { t1: '火焰隊', s1: 4, t2: '鐵衛隊', s2: 2, e1: '🔥', e2: '🛡' },
      ]},
      { round: '四強', matches: [
        { t1: '雷霆隊', s1: null, t2: '閃電隊', s2: null, e1: '⚡', e2: '🌩' },
        { t1: '?', s1: null, t2: '火焰隊', s2: null, e1: '?', e2: '🔥' },
      ]},
      { round: '決賽', matches: [
        { t1: '?', s1: null, t2: '?', s2: null, e1: '?', e2: '?' },
      ]},
    ];

    let html = '<div class="bracket-container"><div class="bracket">';
    bracketData.forEach((round, ri) => {
      html += `<div class="bracket-round">
        <div class="bracket-round-title">${round.round}</div>`;
      round.matches.forEach(m => {
        const w1 = m.s1 !== null && m.s2 !== null && m.s1 > m.s2;
        const w2 = m.s1 !== null && m.s2 !== null && m.s2 > m.s1;
        html += `<div class="bracket-match">
          <div class="bracket-team${w1 ? ' winner' : ''}">
            <span>${m.e1}</span> ${m.t1}
            <span class="bt-score">${m.s1 !== null ? m.s1 : ''}</span>
          </div>
          <div class="bracket-team${w2 ? ' winner' : ''}">
            <span>${m.e2}</span> ${m.t2}
            <span class="bt-score">${m.s2 !== null ? m.s2 : ''}</span>
          </div>
        </div>`;
      });
      html += '</div>';
      if (ri < bracketData.length - 1) {
        html += '<div class="bracket-connector"></div>';
      }
    });
    html += '</div></div>';
    return html;
  },

  // ══════════════════════════════════
  //  Render: Activity Records & Admin
  // ══════════════════════════════════

  renderActivityRecords() {
    const container = document.getElementById('my-activity-records');
    container.innerHTML = ApiService.getActivityRecords().map(r => `
      <div class="mini-activity">
        <span class="mini-activity-status ${r.status}"></span>
        <span class="mini-activity-name">${r.name}</span>
        <span class="mini-activity-date">${r.date}</span>
      </div>
    `).join('');
  },

  renderAdminUsers() {
    const container = document.getElementById('admin-user-list');
    if (!container) return;
    const myLevel = ROLE_LEVEL_MAP[this.currentRole];

    container.innerHTML = ApiService.getAdminUsers().map(u => {
      let promoteOptions = '';
      if (myLevel >= 5) {
        promoteOptions = '<option value="">晉升▼</option><option>管理員</option><option>教練</option><option>領隊</option><option>場主</option>';
      } else if (myLevel >= 4) {
        promoteOptions = '<option value="">晉升▼</option><option>教練</option><option>領隊</option><option>場主</option>';
      }

      return `
        <div class="admin-user-card">
          <div class="profile-avatar small">${u.name[0]}</div>
          <div class="admin-user-info">
            <div class="admin-user-name">${this._userTag(u.name, u.role)}</div>
            <div class="admin-user-meta">${u.uid} ・ ${ROLES[u.role]?.label || u.role} ・ Lv.${u.level} ・ ${u.region}</div>
          </div>
          <div class="admin-user-actions">
            ${promoteOptions ? `<select class="promote-select" onchange="App.handlePromote(this, '${u.name}')">${promoteOptions}</select>` : ''}
            <button class="text-btn" onclick="App.showUserProfile('${u.name}')">查看</button>
          </div>
        </div>
      `;
    }).join('');
  },

  handlePromote(select, name) {
    if (select.value) {
      this.showToast(`✅ 已將「${name}」晉升為「${select.value}」`);
      select.value = '';
    }
  },

  renderExpLogs() {
    const container = document.getElementById('exp-log-list');
    if (!container) return;
    container.innerHTML = ApiService.getExpLogs().map(l => `
      <div class="log-item">
        <span class="log-time">${l.time}</span>
        <span class="log-content">${this._userTag(l.target)} <strong>${l.amount}</strong>「${l.reason}」</span>
      </div>
    `).join('');
  },

  demoExpSearch() {
    this.showToast('已搜尋到用戶「暱稱A」');
  },

  renderOperationLogs() {
    const container = document.getElementById('operation-log-list');
    if (!container) return;
    container.innerHTML = ApiService.getOperationLogs().map(l => `
      <div class="log-item">
        <span class="log-time">${l.time}</span>
        <span class="log-content">
          <span class="log-type ${l.type}">${l.typeName}</span>
          ${l.operator}：${l.content}
        </span>
      </div>
    `).join('');
  },

  renderBannerManage() {
    const container = document.getElementById('banner-manage-list');
    if (!container) return;
    container.innerHTML = ApiService.getBanners().map(b => `
      <div class="banner-manage-card">
        <div class="banner-thumb" style="background:${b.gradient}">${b.title.slice(0,2)}</div>
        <div class="banner-manage-info">
          <div class="banner-manage-title">${b.title}</div>
          <div class="banner-manage-meta">${b.position} ・ ${b.publishAt}~${b.unpublishAt} ・ 點擊 ${b.clicks}</div>
          <span class="banner-manage-status status-${b.status}">${b.status === 'active' ? '🟢 啟用中' : b.status === 'scheduled' ? '🔵 已排程' : '🔴 已到期'}</span>
        </div>
      </div>
    `).join('');
  },

  renderShopManage() {
    const container = document.getElementById('shop-manage-list');
    if (!container) return;
    container.innerHTML = ApiService.getShopItems().map(s => `
      <div class="sm-card">
        <div class="sm-thumb">商品縮圖<br>60 × 60</div>
        <div class="sm-info">
          <div class="sm-title">${s.name}</div>
          <div class="sm-meta">${s.condition} ・ ${s.size} ・ <strong style="color:var(--accent)">$${s.price}</strong></div>
          <div style="display:flex;gap:.3rem;margin-top:.3rem">
            <button class="outline-btn" style="font-size:.72rem;padding:.2rem .5rem" onclick="App.showShopDetail('${s.id}')">查看</button>
            <button class="outline-btn" style="font-size:.72rem;padding:.2rem .5rem;color:var(--danger)">下架</button>
          </div>
        </div>
      </div>
    `).join('');
  },

  renderMsgManage() {
    const container = document.getElementById('msg-manage-list');
    if (!container) return;
    container.innerHTML = [
      { title: '春季聯賽報名開始', target: '全體', readRate: '72%', time: '03/01' },
      { title: '系統維護通知', target: '全體', readRate: '85%', time: '02/18' },
      { title: '球隊集訓通知', target: '雷霆隊', readRate: '90%', time: '02/15' },
    ].map(m => `
      <div class="msg-manage-card">
        <div class="msg-manage-header">
          <span class="msg-manage-title">${m.title}</span>
          <span class="msg-read-rate">已讀率 ${m.readRate}</span>
        </div>
        <div style="font-size:.75rem;color:var(--text-muted)">對象：${m.target} ・ ${m.time}</div>
        <div style="margin-top:.4rem;display:flex;gap:.3rem">
          <button class="text-btn" style="font-size:.75rem">查看</button>
          <button class="text-btn" style="font-size:.75rem;color:var(--danger)">回收</button>
        </div>
      </div>
    `).join('');
  },

  renderTournamentManage() {
    const container = document.getElementById('tournament-manage-list');
    if (!container) return;
    container.innerHTML = ApiService.getTournaments().map(t => `
      <div class="event-card">
        <div class="event-card-body">
          <div class="event-card-title">${t.name}</div>
          <div class="event-meta">
            <span class="event-meta-item">${t.type}</span>
            <span class="event-meta-item">${t.teams} 隊</span>
            <span class="event-meta-item">${t.status}</span>
          </div>
          <div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.5rem">
            <button class="primary-btn small">管理賽程</button>
            <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem">輸入比分</button>
            <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem">交易設定</button>
            <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem">紅黃牌</button>
          </div>
        </div>
      </div>
    `).join('');
  },

  // ══════════════════════════════════
  //  Render: Admin Team Management
  // ══════════════════════════════════

  renderAdminTeams() {
    const container = document.getElementById('admin-team-list');
    if (!container) return;
    container.innerHTML = ApiService.getTeams().map(t => `
      <div class="event-card">
        <div class="event-card-body">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div class="event-card-title">${t.emblem} ${t.name} <span style="font-size:.72rem;color:var(--text-muted)">${t.nameEn}</span></div>
            ${t.pinned ? '<span style="font-size:.72rem;color:var(--warning);font-weight:600">📌 至頂</span>' : ''}
          </div>
          <div class="event-meta">
            <span class="event-meta-item">👑 ${t.captain}</span>
            <span class="event-meta-item">👥 ${t.members}人</span>
            <span class="event-meta-item">📍 ${t.region}</span>
            <span class="event-meta-item" style="color:${t.active ? 'var(--success)' : 'var(--danger)'}">${t.active ? '上架中' : '已下架'}</span>
          </div>
          <div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.5rem">
            <button class="primary-btn small" onclick="App.toggleTeamPin('${t.id}')">${t.pinned ? '📌 取消至頂' : '📌 至頂'}</button>
            <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem" onclick="App.toggleTeamActive('${t.id}')">${t.active ? '下架' : '上架'}</button>
            <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem" onclick="App.showTeamDetail('${t.id}')">查看</button>
          </div>
        </div>
      </div>
    `).join('');
  },

  _pinCounter: 100,
  toggleTeamPin(id) {
    const t = ApiService.getTeam(id);
    if (!t) return;
    t.pinned = !t.pinned;
    if (t.pinned) {
      this._pinCounter++;
      t.pinOrder = this._pinCounter;
    } else {
      t.pinOrder = 0;
    }
    ApiService.updateTeam(id, { pinned: t.pinned, pinOrder: t.pinOrder });
    this.renderAdminTeams();
    this.renderTeamList();
    this.showToast(t.pinned ? `已至頂「${t.name}」` : `已取消至頂「${t.name}」`);
  },

  toggleTeamActive(id) {
    const t = ApiService.getTeam(id);
    if (!t) return;
    t.active = !t.active;
    ApiService.updateTeam(id, { active: t.active });
    this.renderAdminTeams();
    this.renderTeamList();
    this.showToast(t.active ? `已上架「${t.name}」` : `已下架「${t.name}」`);
  },

  // ══════════════════════════════════
  //  Render: Permissions & Inactive
  // ══════════════════════════════════

  renderPermissions() {
    const container = document.getElementById('permissions-list');
    if (!container) return;
    container.innerHTML = ApiService.getPermissions().map((cat, ci) => `
      <div class="perm-category">
        <div class="perm-category-title" onclick="this.parentElement.classList.toggle('collapsed')">
          ${cat.cat}
        </div>
        <div class="perm-items">
          ${cat.items.map((p, pi) => `
            <label class="perm-item">
              <input type="checkbox" ${Math.random() > 0.5 ? 'checked' : ''}>
              <span>${p.name}</span>
            </label>
          `).join('')}
        </div>
      </div>
    `).join('');
  },

  renderInactiveData() {
    const container = document.getElementById('inactive-list');
    if (!container) return;
    container.innerHTML = `
      <div class="inactive-card">
        <div style="font-weight:700">🛡 鳳凰隊</div>
        <div style="font-size:.78rem;color:var(--text-muted);margin-top:.3rem">解散日期：2025/12/15</div>
        <div style="font-size:.78rem;color:var(--text-muted)">原領隊：暱稱Z ・ 原成員：14 人</div>
        <button class="text-btn" style="margin-top:.4rem">查看完整歷史資料</button>
      </div>
      <div class="inactive-card">
        <div style="font-weight:700">🛡 颱風隊</div>
        <div style="font-size:.78rem;color:var(--text-muted);margin-top:.3rem">解散日期：2025/08/20</div>
        <div style="font-size:.78rem;color:var(--text-muted)">原領隊：暱稱W ・ 原成員：10 人</div>
        <button class="text-btn" style="margin-top:.4rem">查看完整歷史資料</button>
      </div>
    `;
  },

  // ══════════════════════════════════
  //  Render: My Activities
  // ══════════════════════════════════

  renderMyActivities() {
    const container = document.getElementById('my-activity-list');
    if (!container) return;
    const myEvents = ApiService.getActiveEvents().slice(0, 6);
    container.innerHTML = myEvents.length > 0
      ? myEvents.map(e => {
        const statusConf = STATUS_CONFIG[e.status] || STATUS_CONFIG.open;
        return `
      <div class="event-card">
        <div class="event-card-body">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div class="event-card-title">${e.title}</div>
            <span class="tl-event-status ${statusConf.css}" style="font-size:.68rem">${statusConf.label}</span>
          </div>
          <div class="event-meta">
            <span class="event-meta-item">📍 ${e.location}</span>
            <span class="event-meta-item">🕐 ${e.date}</span>
            <span class="event-meta-item">👥 ${e.current}/${e.max}</span>
          </div>
          <div style="display:flex;gap:.3rem;margin-top:.5rem">
            <button class="primary-btn small">編輯</button>
            <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem">查看名單</button>
            <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem;color:var(--danger)">關閉</button>
          </div>
        </div>
      </div>`;
      }).join('')
      : '<div style="padding:1rem;font-size:.82rem;color:var(--text-muted)">尚無管理中的活動</div>';
  },

  // ══════════════════════════════════
  //  Render: User Card
  // ══════════════════════════════════

  renderUserCard() {
    const container = document.getElementById('user-card-full');
    if (!container) return;
    container.innerHTML = `
      <div class="uc-header">
        <div class="uc-doll-frame">👤</div>
        <div class="profile-title">全勤.王小明</div>
        <div style="margin-top:.3rem">${this._userTag('王小明')}</div>
        <div class="profile-level">
          <span>Lv.10</span>
          <div class="exp-bar"><div class="exp-fill" style="width:40%"></div></div>
          <span class="exp-text">800/2000</span>
        </div>
      </div>
      <div class="info-card">
        <div class="info-title">基本資料</div>
        <div class="info-row"><span>性別</span><span>男</span></div>
        <div class="info-row"><span>生日</span><span>2000/05/20</span></div>
        <div class="info-row"><span>地區</span><span>台北市</span></div>
        <div class="info-row"><span>運動類別</span><span>⚽</span></div>
        <div class="info-row"><span>所屬球隊</span><span>雷霆隊</span></div>
      </div>
      <div class="info-card">
        <div class="info-title">成就 & 徽章</div>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap">
          <span style="font-size:1.5rem">🌱</span>
          <span style="font-size:1.5rem">⭐</span>
        </div>
      </div>
      <div class="info-card">
        <div class="info-title">交易價值紀錄</div>
        <div style="font-size:.82rem;color:var(--text-muted)">目前無交易紀錄</div>
      </div>
    `;
  },

  // ══════════════════════════════════
  //  Modal
  // ══════════════════════════════════

  showModal(id) { this.toggleModal(id); },

  toggleModal(id) {
    const modal = document.getElementById(id);
    const overlay = document.getElementById('modal-overlay');
    if (!modal) return;
    const isOpen = modal.classList.contains('open');
    if (isOpen) {
      modal.classList.remove('open');
      overlay.classList.remove('open');
    } else {
      document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open'));
      modal.classList.add('open');
      overlay.classList.add('open');
    }
  },

  closeModal() {
    document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open'));
    document.getElementById('modal-overlay').classList.remove('open');
  },

  // ══════════════════════════════════
  //  Floating Ads
  // ══════════════════════════════════

  bindFloatingAds() {
    const floatingAds = document.getElementById('floating-ads');
    if (!floatingAds) return;

    let targetOffset = 0;
    let currentOffset = 0;
    let rafId = null;

    const lerp = (start, end, factor) => start + (end - start) * factor;

    const animate = () => {
      currentOffset = lerp(currentOffset, targetOffset, 0.06);
      if (Math.abs(currentOffset - targetOffset) < 0.5) {
        currentOffset = targetOffset;
      }
      floatingAds.style.transform = `translateY(calc(-50% + ${currentOffset}px))`;
      if (Math.abs(currentOffset - targetOffset) > 0.5) {
        rafId = requestAnimationFrame(animate);
      } else {
        rafId = null;
      }
    };

    const startAnimation = () => {
      if (!rafId) {
        rafId = requestAnimationFrame(animate);
      }
    };

    window.addEventListener('scroll', () => {
      const scrollY = window.scrollY || 0;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const progress = docHeight > 0 ? (scrollY / docHeight) : 0;
      targetOffset = (progress - 0.5) * 120;
      startAnimation();
    }, { passive: true });

    floatingAds.style.top = '50vh';
    floatingAds.style.transform = 'translateY(-50%)';
  },

  // ══════════════════════════════════
  //  Create Event
  // ══════════════════════════════════

  _eventCounter: 100,
  handleCreateEvent() {
    const title = document.getElementById('ce-title').value.trim();
    const type = document.getElementById('ce-type').value;
    const location = document.getElementById('ce-location').value.trim();
    const dateVal = document.getElementById('ce-date').value;
    const timeVal = document.getElementById('ce-time').value.trim();
    const fee = parseInt(document.getElementById('ce-fee').value) || 0;
    const max = parseInt(document.getElementById('ce-max').value) || 20;
    const waitlistMax = parseInt(document.getElementById('ce-waitlist').value) || 0;
    const minAge = parseInt(document.getElementById('ce-min-age').value) || 0;
    const notes = document.getElementById('ce-notes').value.trim();

    if (!title) { this.showToast('請輸入活動名稱'); return; }
    if (!location) { this.showToast('請輸入地點'); return; }
    if (!dateVal) { this.showToast('請選擇日期'); return; }
    if (notes.length > 500) { this.showToast('注意事項不可超過 500 字'); return; }

    const dateParts = dateVal.split('-');
    const dateStr = `${dateParts[0]}/${parseInt(dateParts[1])}/${parseInt(dateParts[2])}`;
    const fullDate = timeVal ? `${dateParts[0]}/${parseInt(dateParts[1]).toString().padStart(2,'0')}/${parseInt(dateParts[2]).toString().padStart(2,'0')} ${timeVal}` : dateStr;

    this._eventCounter++;
    const newEvent = {
      id: 'ce' + this._eventCounter,
      title, type, status: 'open', location, date: fullDate,
      fee, max, current: 0, waitlist: 0, waitlistMax, minAge, notes,
      creator: ROLES[this.currentRole]?.label || '一般用戶',
      contact: '',
      gradient: GRADIENT_MAP[type] || GRADIENT_MAP.friendly,
      icon: '⚽',
      countdown: '即將開始',
      participants: [],
      waitlistNames: [],
    };

    ApiService.createEvent(newEvent);
    this.renderActivityList();
    this.renderHotEvents();
    this.renderMyActivities();
    this.closeModal();
    this.showToast(`活動「${title}」已建立！`);

    // Reset form
    document.getElementById('ce-title').value = '';
    document.getElementById('ce-location').value = '';
    document.getElementById('ce-fee').value = '300';
    document.getElementById('ce-max').value = '20';
    document.getElementById('ce-waitlist').value = '5';
    document.getElementById('ce-min-age').value = '0';
    document.getElementById('ce-notes').value = '';
    document.getElementById('ce-image').value = '';
    const cePreview = document.getElementById('ce-upload-preview');
    if (cePreview) {
      cePreview.classList.remove('has-image');
      cePreview.innerHTML = '<span class="ce-upload-icon">📷</span><span class="ce-upload-text">點擊上傳圖片</span><span class="ce-upload-hint">建議尺寸 800 × 300 px｜JPG / PNG｜最大 2MB</span>';
    }
  },

  // ══════════════════════════════════
  //  Image Upload Preview
  // ══════════════════════════════════

  bindImageUpload(inputId, previewId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) return;
      const validTypes = ['image/jpeg', 'image/png'];
      if (!validTypes.includes(file.type)) {
        this.showToast('僅支援 JPG / PNG 格式');
        input.value = '';
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        this.showToast('檔案大小不可超過 2MB');
        input.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        const preview = document.getElementById(previewId);
        if (preview) {
          preview.innerHTML = `<img src="${ev.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm)">`;
          preview.classList.add('has-image');
        }
      };
      reader.readAsDataURL(file);
    });
  },

  // ══════════════════════════════════
  //  Create Tournament
  // ══════════════════════════════════

  _tournamentCounter: 100,
  handleCreateTournament() {
    const name = document.getElementById('ct-name').value.trim();
    const type = document.getElementById('ct-type').value;
    const teams = parseInt(document.getElementById('ct-teams').value) || 8;
    const status = document.getElementById('ct-status').value;

    if (!name) { this.showToast('請輸入賽事名稱'); return; }

    this._tournamentCounter++;
    ApiService.createTournament({
      id: 'ct' + this._tournamentCounter,
      name, type, teams,
      matches: type.includes('聯賽') ? teams * (teams - 1) : teams - 1,
      status,
      gradient: TOURNAMENT_GRADIENT_MAP[type] || TOURNAMENT_GRADIENT_MAP['聯賽（雙循環）'],
    });

    this.renderTournamentTimeline();
    this.renderOngoingTournaments();
    this.renderTournamentManage();
    this.closeModal();
    this.showToast(`賽事「${name}」已建立！`);

    document.getElementById('ct-name').value = '';
    const preview = document.getElementById('ct-upload-preview');
    if (preview) {
      preview.classList.remove('has-image');
      preview.innerHTML = '<span class="ce-upload-icon">📷</span><span class="ce-upload-text">點擊上傳圖片</span><span class="ce-upload-hint">建議尺寸 800 × 300 px｜JPG / PNG｜最大 2MB</span>';
    }
  },

  // ══════════════════════════════════
  //  Create Shop Item
  // ══════════════════════════════════

  _shopCounter: 100,
  handleCreateShopItem() {
    const name = document.getElementById('cs-name').value.trim();
    const condition = document.getElementById('cs-condition').value;
    const price = parseInt(document.getElementById('cs-price').value) || 0;
    const size = document.getElementById('cs-size').value.trim() || '—';
    const desc = document.getElementById('cs-desc').value.trim();

    if (!name) { this.showToast('請輸入商品名稱'); return; }
    if (price <= 0) { this.showToast('請輸入價格'); return; }
    if (desc.length > 500) { this.showToast('描述不可超過 500 字'); return; }

    this._shopCounter++;
    ApiService.createShopItem({
      id: 'cs' + this._shopCounter,
      name, price, condition, year: 2026, size,
      desc: desc || '賣家未提供描述。',
    });

    this.renderShop();
    this.renderShopManage();
    this.closeModal();
    this.showToast(`商品「${name}」已上架！`);

    document.getElementById('cs-name').value = '';
    document.getElementById('cs-price').value = '';
    document.getElementById('cs-size').value = '';
    document.getElementById('cs-desc').value = '';
    ['cs-img1','cs-img2','cs-img3'].forEach(id => {
      const input = document.getElementById(id);
      if (input) input.value = '';
    });
    ['cs-preview1','cs-preview2','cs-preview3'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.classList.remove('has-image'); el.innerHTML = '<span class="ce-upload-icon">📷</span><span class="ce-upload-hint">JPG/PNG 2MB</span>'; }
    });
  },

  // ══════════════════════════════════
  //  Toast
  // ══════════════════════════════════

  showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
  },
};

// ── Init on DOM Ready ──
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});

// Close modal on overlay click
document.getElementById('modal-overlay')?.addEventListener('click', () => App.closeModal());
