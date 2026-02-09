/* ================================================
   SportHub — App Controller (Core)
   依賴：config.js, data.js, api-service.js
   擴充：js/renders.js, js/admin.js (Object.assign)
   ================================================ */

const App = {
  currentRole: 'user',
  currentPage: 'page-home',
  currentTournament: 't1',
  _userTeam: 'tm1',
  pageHistory: [],
  bannerIndex: 0,
  bannerTimer: null,

  init() {
    this.bindRoleSwitcher();
    this.bindSportPicker();
    this.bindNavigation();
    this.bindDrawer();
    this.bindTheme();
    this.bindFilterToggle();
    this.bindTabBars();
    this.bindTournamentTabs();
    this.bindScanModes();
    this.bindFloatingAds();
    this.bindNotifBtn();
    this.bindModeSwitch();
    this.bindLineLogin();
    this.bindImageUpload('ce-image', 'ce-upload-preview');
    this.bindImageUpload('ct-image', 'ct-upload-preview');
    this.bindImageUpload('cs-img1', 'cs-preview1');
    this.bindImageUpload('cs-img2', 'cs-preview2');
    this.bindImageUpload('cs-img3', 'cs-preview3');
    this.bindImageUpload('banner-image', 'banner-preview');
    this.bindImageUpload('floatad-image', 'floatad-preview');
    this.renderBannerCarousel();
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
    let lastMinRole = null;

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
        const role = item.minRole || 'user';
        const roleInfo = ROLES[role];
        const bgClass = minLevel >= 5 ? 'drawer-role-super' : minLevel >= 4 ? 'drawer-role-admin' : '';
        if (lastMinRole !== role && minLevel >= 4) {
          if (lastMinRole && ROLE_LEVEL_MAP[lastMinRole] >= 4) html += '<div class="drawer-divider"></div>';
          lastMinRole = role;
        }
        html += `<div class="drawer-item ${bgClass}" onclick="${onClick}">
          ${item.label}
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
    // 正式版未登入不能進「我的」
    if (pageId === 'page-profile' && !ModeManager.isDemo()) {
      if (typeof LineAuth === 'undefined' || !LineAuth.isLoggedIn()) {
        this.showToast('請先登入 LINE 帳號');
        return;
      }
    }
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
        icon.textContent = '';
        label.textContent = '淺色模式';
      } else {
        toggle.classList.add('active');
        icon.textContent = '';
        label.textContent = '深色模式';
      }
    });
  },

  renderAnnouncement() {
    const container = document.getElementById('announce-body');
    const card = document.getElementById('announce-card');
    if (!container || !card) return;
    const ann = ApiService.getActiveAnnouncement();
    if (ann) {
      container.innerHTML = `<p>${ann.content}</p>`;
      card.style.display = '';
    } else {
      card.style.display = 'none';
    }
  },

  renderFloatingAds() {
    const container = document.getElementById('floating-ads');
    if (!container) return;
    const ads = ApiService.getFloatingAds();
    container.innerHTML = ads.map(ad => {
      const active = ad.status === 'active';
      const hasImg = active && ad.image;
      return `
      <div class="float-ad" title="${active ? ad.title : '贊助廣告'}">
        <div class="float-ad-img">${hasImg ? `<img src="${ad.image}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : ad.slot}</div>
        <small>贊助廣告</small>
      </div>`;
    }).join('');
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

  renderBannerCarousel() {
    const track = document.getElementById('banner-track');
    if (!track) return;
    const banners = ApiService.getBanners().filter(b => b.status === 'active');
    if (banners.length === 0) {
      track.innerHTML = `<div class="banner-slide banner-placeholder">
        <div class="banner-img-placeholder">1200 × 400</div>
        <div class="banner-content"><div class="banner-tag">廣告</div><h2>暫無廣告</h2><p>敬請期待</p></div>
      </div>`;
    } else {
      track.innerHTML = banners.map(b => {
        if (b.image) {
          return `<div class="banner-slide" style="background-image:url('${b.image}');background-size:cover;background-position:center">
            <div class="banner-content"><div class="banner-tag">廣告位 ${b.slot}</div><h2>${b.title || ''}</h2></div>
          </div>`;
        }
        return `<div class="banner-slide banner-placeholder" style="background:${b.gradient || 'var(--bg-elevated)'}">
          <div class="banner-img-placeholder">1200 × 400</div>
          <div class="banner-content"><div class="banner-tag">廣告位 ${b.slot}</div><h2>${b.title || ''}</h2></div>
        </div>`;
      }).join('');
    }
    this.bannerIndex = 0;
    this.bannerCount = track.querySelectorAll('.banner-slide').length;
    const dots = document.getElementById('banner-dots');
    if (dots) {
      dots.innerHTML = '';
      for (let i = 0; i < this.bannerCount; i++) {
        const dot = document.createElement('div');
        dot.className = 'banner-dot' + (i === 0 ? ' active' : '');
        dot.addEventListener('click', () => this.goToBanner(i));
        dots.appendChild(dot);
      }
    }
    track.style.transform = 'translateX(0)';
  },

  startBannerCarousel() {
    document.getElementById('banner-prev')?.addEventListener('click', () => {
      const cnt = this.bannerCount || 1;
      this.goToBanner((this.bannerIndex - 1 + cnt) % cnt);
    });
    document.getElementById('banner-next')?.addEventListener('click', () => {
      const cnt = this.bannerCount || 1;
      this.goToBanner((this.bannerIndex + 1) % cnt);
    });
    this.bannerTimer = setInterval(() => {
      const cnt = this.bannerCount || 1;
      this.bannerIndex = (this.bannerIndex + 1) % cnt;
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
    this.renderAnnouncement();
    this.renderFloatingAds();
    this.renderBannerCarousel();
    this.renderBannerManage();
    this.renderFloatingAdManage();
    this.renderAnnouncementManage();
    this.renderShopManage();
    this.renderMsgManage();
    this.renderTournamentManage();
    this.renderAdminTeams();
    this.renderAdminAchievements();
    this.renderRoleHierarchy();
    this.renderInactiveData();
    this.renderMyActivities();
    this.renderUserCard();
    this.renderProfileData();
    this.updateNotifBadge();
    this.updateStorageBar();
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
    const badges = ApiService.getBadges();
    const achievements = ApiService.getAchievements();
    const earned = badges.filter(b => {
      const ach = achievements.find(a => a.id === b.achId);
      return ach && ach.current >= ach.target;
    });
    const catColors = { gold: '#d4a017', silver: '#9ca3af', bronze: '#b87333' };
    document.querySelector('#page-user-card .page-header h2').textContent = '用戶資料卡片';
    document.getElementById('user-card-full').innerHTML = `
      <div class="uc-header">
        <div class="uc-visual-row">
          <div class="uc-avatar-circle">${name.charAt(0)}</div>
          <div class="uc-doll-frame">紙娃娃預留</div>
        </div>
        <div class="profile-title">${name}</div>
        <div style="margin-top:.2rem;font-size:.75rem;color:${roleInfo.color};font-weight:600">${roleInfo.label}</div>
        <div class="profile-level">
          <span>Lv.${Math.floor(Math.random()*30)+1}</span>
          <div class="exp-bar"><div class="exp-fill" style="width:${Math.floor(Math.random()*100)}%"></div></div>
        </div>
      </div>
      <div class="info-card">
        <div class="info-title">基本資料</div>
        <div class="info-row"><span>性別</span><span>${Math.random()>.5?'男':'女'}</span></div>
        <div class="info-row"><span>地區</span><span>台北市</span></div>
        <div class="info-row"><span>所屬球隊</span><span>雷霆隊</span></div>
      </div>
      <div class="info-card">
        <div class="info-title">已獲得徽章</div>
        ${earned.length ? `<div class="uc-badge-list">${earned.map(b => {
          const color = catColors[b.category] || catColors.bronze;
          return `<div class="uc-badge-item">
            <div class="badge-img-placeholder" style="border-color:${color}">${b.image ? `<img src="${b.image}">` : ''}</div>
            <span class="uc-badge-name">${b.name}</span>
          </div>`;
        }).join('')}</div>` : '<div style="font-size:.82rem;color:var(--text-muted)">尚未獲得徽章</div>'}
      </div>
    `;
    this.showPage('page-user-card');
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
  //  Mode Switch (Demo / Production)
  // ══════════════════════════════════

  bindModeSwitch() {
    // 方式 1：連續點擊 Logo 5 次（3 秒內）
    let clickCount = 0;
    let clickTimer = null;
    const logo = document.querySelector('.logo');
    if (logo) {
      logo.style.userSelect = 'none';
      logo.addEventListener('click', () => {
        clickCount++;
        if (clickCount === 1) {
          clickTimer = setTimeout(() => { clickCount = 0; }, 3000);
        }
        if (clickCount >= 5) {
          clickCount = 0;
          clearTimeout(clickTimer);
          this._switchMode();
        }
      });
    }

    // 方式 2：Shift + Alt + D
    document.addEventListener('keydown', (e) => {
      if (e.shiftKey && e.altKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        this._switchMode();
      }
    });

    // 方式 3：Console 指令（密碼保護）
    window.switchMode = (pwd) => {
      if (pwd !== 'fc2026') {
        console.warn('[SportHub] 密碼錯誤');
        return;
      }
      this._switchMode();
    };

    // 初始化 badge
    this._updateModeBadge();
  },

  // ══════════════════════════════════
  //  LINE Login
  // ══════════════════════════════════

  _pendingFirstLogin: false,

  async bindLineLogin() {
    if (!ModeManager.isDemo() && typeof LineAuth !== 'undefined') {
      await LineAuth.init();
      if (LineAuth.isLoggedIn()) {
        try {
          const user = await ApiService.loginUser(LineAuth.getProfile());
          if (user && (!user.gender || !user.birthday || !user.region)) {
            this._pendingFirstLogin = true;
          }
        } catch (err) {
          console.error('[App] 用戶資料同步失敗:', err);
        }
      }
    }
    this.renderLoginUI();
    if (this._pendingFirstLogin) {
      this.showModal('first-login-modal');
    }
  },

  renderLoginUI() {
    const roleSwitcher = document.getElementById('role-switcher-wrapper');
    const lineWrapper = document.getElementById('line-login-wrapper');
    const profileAvatar = document.getElementById('profile-avatar');
    const profileContent = document.getElementById('profile-content');
    const loginPrompt = document.getElementById('profile-login-prompt');
    const drawerAvatar = document.getElementById('drawer-avatar');
    const drawerName = document.getElementById('drawer-name');

    if (!roleSwitcher || !lineWrapper) return;

    // ── Demo 模式：顯示角色切換器，隱藏 LINE ──
    if (ModeManager.isDemo()) {
      roleSwitcher.style.display = '';
      lineWrapper.style.display = 'none';
      if (drawerAvatar) { drawerAvatar.className = 'drawer-avatar'; drawerAvatar.innerHTML = '麥'; }
      if (drawerName) drawerName.textContent = '冠軍.全勤.小麥';
      if (profileAvatar) { profileAvatar.className = 'profile-avatar'; profileAvatar.innerHTML = '麥'; }
      if (profileContent) profileContent.style.display = '';
      if (loginPrompt) loginPrompt.style.display = 'none';
      return;
    }

    // ── 正式版：隱藏角色切換器，顯示 LINE ──
    roleSwitcher.style.display = 'none';
    lineWrapper.style.display = '';

    const isLoggedIn = typeof LineAuth !== 'undefined' && LineAuth.isLoggedIn();
    const loginBtn = document.getElementById('line-login-btn');
    const userTopbar = document.getElementById('line-user-topbar');
    const avatarImg = document.getElementById('line-avatar-topbar');

    if (!isLoggedIn) {
      // 未登入
      if (loginBtn) loginBtn.style.display = '';
      if (userTopbar) userTopbar.style.display = 'none';
      if (profileContent) profileContent.style.display = 'none';
      if (loginPrompt) loginPrompt.style.display = '';
      if (drawerAvatar) { drawerAvatar.className = 'drawer-avatar'; drawerAvatar.innerHTML = '?'; }
      if (drawerName) drawerName.textContent = '未登入';
      return;
    }

    // 已登入
    const profile = LineAuth.getProfile();
    if (loginBtn) loginBtn.style.display = 'none';
    if (userTopbar) userTopbar.style.display = '';
    if (profile.pictureUrl && avatarImg) {
      avatarImg.src = profile.pictureUrl;
    } else if (userTopbar) {
      userTopbar.innerHTML = `<div class="line-avatar-topbar line-avatar-fallback">${profile.displayName.charAt(0)}</div>`;
    }

    // 更新 profile 頁面
    if (profileContent) profileContent.style.display = '';
    if (loginPrompt) loginPrompt.style.display = 'none';
    if (profileAvatar) {
      if (profile.pictureUrl) {
        profileAvatar.className = 'profile-avatar profile-avatar-img';
        profileAvatar.innerHTML = `<img src="${profile.pictureUrl}" alt="">`;
      } else {
        profileAvatar.className = 'profile-avatar';
        profileAvatar.innerHTML = profile.displayName.charAt(0);
      }
    }

    // 更新 drawer
    if (drawerName) drawerName.textContent = profile.displayName;
    if (drawerAvatar) {
      if (profile.pictureUrl) {
        drawerAvatar.className = 'drawer-avatar drawer-avatar-img';
        drawerAvatar.innerHTML = `<img src="${profile.pictureUrl}" alt="">`;
      } else {
        drawerAvatar.className = 'drawer-avatar';
        drawerAvatar.innerHTML = profile.displayName.charAt(0);
      }
    }
  },

  renderProfileData() {
    if (ModeManager.isDemo()) return;
    const user = ApiService.getCurrentUser();
    if (!user) return;
    const el = (id) => document.getElementById(id);
    if (el('profile-title')) el('profile-title').textContent = user.displayName || '';
    if (el('profile-lv')) el('profile-lv').textContent = `Lv.${user.level || 1}`;
    if (el('profile-exp-text')) el('profile-exp-text').textContent = `${user.exp || 0} / ${((user.level || 1) + 1) * 200}`;
    if (el('profile-exp-fill')) {
      const next = ((user.level || 1) + 1) * 200;
      el('profile-exp-fill').style.width = `${Math.min(100, Math.round(((user.exp || 0) / next) * 100))}%`;
    }
    if (el('profile-gender')) el('profile-gender').textContent = user.gender || '—';
    if (el('profile-birthday')) el('profile-birthday').textContent = user.birthday || '—';
    if (el('profile-region')) el('profile-region').textContent = user.region || '—';
  },

  saveFirstLoginProfile() {
    const gender = document.getElementById('fl-gender').value;
    const birthday = document.getElementById('fl-birthday').value;
    const region = document.getElementById('fl-region').value;
    if (!gender || !birthday || !region) {
      this.showToast('請填寫所有必填欄位');
      return;
    }
    ApiService.updateCurrentUser({ gender, birthday, region });
    this._pendingFirstLogin = false;
    this.closeModal();
    this.renderProfileData();
    this.showToast('個人資料已儲存');
  },

  async _switchMode() {
    ModeManager.toggle();
    await this._onModeChanged();
  },

  async _onModeChanged() {
    const isDemo = ModeManager.isDemo();

    // 切換到正式版：嘗試初始化 Firebase
    if (!isDemo && typeof FirebaseService !== 'undefined') {
      const overlay = document.getElementById('loading-overlay');
      if (overlay) overlay.style.display = '';
      try {
        await FirebaseService.init();
        console.log('[App] Firebase 已初始化');
      } catch (err) {
        console.error('[App] Firebase 初始化失敗，退回 Demo:', err);
        ModeManager.setMode('demo');
      } finally {
        if (overlay) overlay.style.display = 'none';
      }
    }

    this._updateModeBadge();
    this.renderLoginUI();
    this.renderAll();
    const modeLabel = ModeManager.isDemo() ? 'DEMO 演示' : 'PRODUCTION 正式';
    this.showToast(`已切換至「${modeLabel}」模式`);
  },

  _updateModeBadge() {
    const badge = document.getElementById('mode-badge');
    if (badge) {
      badge.style.display = ModeManager.isDemo() ? '' : 'none';
    }
  },

  // ══════════════════════════════════
  // ══════════════════════════════════
  //  Notification Badge & Storage Bar
  // ══════════════════════════════════

  updateNotifBadge() {
    const messages = ApiService.getMessages();
    const unreadCount = messages.filter(m => m.unread).length;
    const badge = document.getElementById('notif-badge');
    if (!badge) return;
    badge.textContent = unreadCount;
    badge.style.display = unreadCount > 0 ? '' : 'none';
  },

  updateStorageBar() {
    const bar = document.getElementById('storage-bar');
    if (!bar) return;
    const total = 50;
    const used = ApiService.getMessages().length;
    const remaining = Math.max(0, total - used);
    bar.innerHTML = `剩餘容量：<strong>${remaining}</strong>/${total}`;
  },

  markAllRead() {
    const messages = ApiService.getMessages();
    let changed = 0;
    messages.forEach(m => {
      if (m.unread) { m.unread = false; changed++; }
    });
    if (changed === 0) {
      this.showToast('沒有未讀訊息');
      return;
    }
    this.renderMessageList();
    this.updateNotifBadge();
    this.showToast(`已將 ${changed} 則訊息標為已讀`);
  },

  readMessage(el, id) {
    const messages = ApiService.getMessages();
    const msg = messages.find(m => m.id === id);
    if (msg && msg.unread) {
      msg.unread = false;
      el.classList.remove('msg-unread');
      el.querySelector('.msg-dot').classList.remove('unread');
      el.querySelector('.msg-dot').classList.add('read');
      this.updateNotifBadge();
    }
  },

  showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
  },
};

// ── Init on DOM Ready ──
document.addEventListener('DOMContentLoaded', async () => {
  // 正式版模式：先初始化 Firebase 快取，再啟動 App
  if (!ModeManager.isDemo()) {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.style.display = '';
    try {
      await FirebaseService.init();
      console.log('[App] Firebase 模式啟動');
    } catch (err) {
      console.error('[App] Firebase 初始化失敗，退回 Demo 模式:', err);
      ModeManager.setMode('demo');
    } finally {
      if (overlay) overlay.style.display = 'none';
    }
  }
  App.init();
  // 移除早期模式偵測的 CSS class，讓 JS 接手控制
  document.documentElement.classList.remove('prod-early');
});
