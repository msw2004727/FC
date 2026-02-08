/* ================================================
   SportHub Demo — Application Logic
   ================================================ */

// ─── Role Hierarchy & Config ───
const ROLES = {
  user:        { level: 0, label: '一般用戶', color: '#6b7280' },
  coach:       { level: 1, label: '教練',     color: '#0d9488' },
  captain:     { level: 2, label: '領隊',     color: '#7c3aed' },
  venue_owner: { level: 3, label: '場主',     color: '#d97706' },
  admin:       { level: 4, label: '管理員',   color: '#2563eb' },
  super_admin: { level: 5, label: '總管',     color: '#dc2626' }
};

const ROLE_LEVEL_MAP = { user:0, coach:1, captain:2, venue_owner:3, admin:4, super_admin:5 };

// ─── Demo Data ───
const DemoData = {
  events: [
    { id: 'e1', title: '週六足球友誼賽', location: '台北市大安運動中心', date: '2026/03/15 14:00~16:00', fee: 300, max: 20, current: 12, waitlist: 3, waitlistMax: 5, creator: '教練小陳', contact: '0912-345-678', gradient: 'linear-gradient(135deg,#0d9488,#065f46)', icon: '⚽', countdown: '2天 5時', participants: ['王小明','李大華','張三','陳美玲','林志偉','周杰倫','黃小琳','吳宗翰','鄭家豪','許志安','蔡依林','劉德華'], waitlistNames: ['候補A','候補B','候補C'] },
    { id: 'e2', title: '新手足球訓練營', location: '台中市豐原體育場', date: '2026/03/18 09:00~11:00', fee: 200, max: 15, current: 15, waitlist: 5, waitlistMax: 5, creator: '教練阿豪', contact: '0922-111-222', gradient: 'linear-gradient(135deg,#7c3aed,#4338ca)', icon: '🏃', countdown: '5天 2時', participants: ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O'], waitlistNames: ['W1','W2','W3','W4','W5'] },
    { id: 'e3', title: '籃球三對三鬥牛', location: '高雄市三民體育館', date: '2026/03/20 18:00~20:00', fee: 0, max: 12, current: 8, waitlist: 0, waitlistMax: 3, creator: '場主老王', contact: '', gradient: 'linear-gradient(135deg,#dc2626,#991b1b)', icon: '🏀', countdown: '7天 14時', participants: ['P1','P2','P3','P4','P5','P6','P7','P8'], waitlistNames: [] },
    { id: 'e4', title: '週日排球輕鬆打', location: '台北市信義運動中心', date: '2026/03/22 10:00~12:00', fee: 150, max: 18, current: 6, waitlist: 0, waitlistMax: 4, creator: '教練小美', contact: '0933-444-555', gradient: 'linear-gradient(135deg,#d97706,#92400e)', icon: '🏐', countdown: '9天 6時', participants: ['V1','V2','V3','V4','V5','V6'], waitlistNames: [] },
  ],

  tournaments: [
    { id: 't1', name: '2026 春季足球聯賽', type: '聯賽（雙循環）', teams: 8, matches: 56, status: '進行中', gradient: 'linear-gradient(135deg,#dc2626,#991b1b)' },
    { id: 't2', name: '新春盃足球淘汰賽', type: '盃賽（單敗淘汰）', teams: 16, matches: 15, status: '即將開始', gradient: 'linear-gradient(135deg,#7c3aed,#4338ca)' },
  ],

  teams: [
    { id: 'tm1', name: '雷霆隊', emblem: '⚡', captain: '隊長A', coaches: ['教練B','教練C'], members: 18, color: '#3b82f6', active: true },
    { id: 'tm2', name: '閃電隊', emblem: '🌩', captain: '隊長D', coaches: ['教練E'], members: 15, color: '#eab308', active: true },
    { id: 'tm3', name: '旋風隊', emblem: '🌀', captain: '隊長F', coaches: [], members: 12, color: '#10b981', active: true },
    { id: 'tm4', name: '火焰隊', emblem: '🔥', captain: '隊長G', coaches: ['教練H'], members: 20, color: '#ef4444', active: true },
  ],

  messages: [
    { id: 'm1', type: 'system', typeName: '系統', title: '春季聯賽報名開始！', preview: '2026 春季足球聯賽現已開放報名...', time: '2026/03/01 10:00', unread: true },
    { id: 'm2', type: 'activity', typeName: '活動', title: '候補遞補通知', preview: '您已成功遞補「週六足球友誼賽」...', time: '2026/02/28 15:30', unread: true },
    { id: 'm3', type: 'trade', typeName: '交易', title: '球員交易確認', preview: '雷霆隊向閃電隊提出交易申請...', time: '2026/02/25 09:00', unread: true },
    { id: 'm4', type: 'private', typeName: '私訊', title: '管理員通知', preview: '您的身份已升級為教練...', time: '2026/02/20 14:00', unread: false },
    { id: 'm5', type: 'system', typeName: '系統', title: '系統維護通知', preview: '本週六凌晨將進行系統更新...', time: '2026/02/18 11:00', unread: false },
  ],

  achievements: [
    { name: '初心者', icon: '🌱', unlocked: true },
    { name: '全勤之星', icon: '⭐', unlocked: true },
    { name: '鐵人精神', icon: '💪', unlocked: true },
    { name: '社交蝴蝶', icon: '🦋', unlocked: true },
    { name: '冠軍', icon: '🏆', unlocked: false },
    { name: 'MVP', icon: '🥇', unlocked: false },
    { name: '百場達人', icon: '💯', unlocked: false },
    { name: '傳奇球員', icon: '👑', unlocked: false },
  ],

  badges: [
    { name: '足球達人', icon: '⚽' }, { name: '籃球新手', icon: '🏀' },
    { name: '守門員', icon: '🧤' }, { name: '前鋒王', icon: '🎯' },
    { name: '助攻王', icon: '🤝' }, { name: '最佳隊友', icon: '🌟' },
  ],

  shopItems: [
    { name: 'Nike Phantom GT2', price: 1800, condition: '9成新', year: 2025, size: 'US10', icon: '👟' },
    { name: 'Adidas 訓練球衣', price: 500, condition: '8成新', year: 2024, size: 'L', icon: '👕' },
    { name: 'Puma 護脛', price: 300, condition: '全新', year: 2026, size: 'M', icon: '🛡' },
    { name: '手套 (守門員)', price: 600, condition: '7成新', year: 2024, size: 'L', icon: '🧤' },
    { name: 'Joma 球褲', price: 350, condition: '9成新', year: 2025, size: 'M', icon: '🩳' },
    { name: '運動水壺 1L', price: 150, condition: '全新', year: 2026, size: '—', icon: '🥤' },
  ],

  leaderboard: [
    { name: '王大明', avatar: '王', exp: 5200, level: 32 },
    { name: '李小華', avatar: '李', exp: 4850, level: 30 },
    { name: '張美玲', avatar: '張', exp: 4300, level: 28 },
    { name: '陳志偉', avatar: '陳', exp: 3900, level: 26 },
    { name: '小麥', avatar: '麥', exp: 2350, level: 25 },
    { name: '林大豪', avatar: '林', exp: 2100, level: 22 },
    { name: '黃小琳', avatar: '黃', exp: 1800, level: 20 },
    { name: '周書翰', avatar: '周', exp: 1500, level: 18 },
  ],

  standings: [
    { rank: 1, name: '雷霆隊', w: 5, d: 1, l: 0, pts: 16 },
    { rank: 2, name: '閃電隊', w: 3, d: 2, l: 1, pts: 11 },
    { rank: 3, name: '旋風隊', w: 2, d: 3, l: 1, pts: 9 },
    { rank: 4, name: '火焰隊', w: 2, d: 1, l: 3, pts: 7 },
  ],

  matches: [
    { home: '雷霆隊', away: '閃電隊', scoreH: 2, scoreA: 1, venue: '大安運動中心', time: '03/15 14:00', yellowH: 2, yellowA: 1, redH: 0, redA: 0 },
    { home: '旋風隊', away: '火焰隊', scoreH: 0, scoreA: 0, venue: '信義運動中心', time: '03/15 16:00', yellowH: 1, yellowA: 0, redH: 0, redA: 0 },
    { home: '雷霆隊', away: '旋風隊', scoreH: null, scoreA: null, venue: '豐原體育場', time: '03/22 14:00', yellowH: 0, yellowA: 0, redH: 0, redA: 0 },
  ],

  trades: [
    { from: '雷霆隊', to: '閃電隊', player: '球員X', value: 150, status: 'success', date: '03/10' },
    { from: '火焰隊', to: '旋風隊', player: '球員Y', value: 200, status: 'pending', date: '03/12' },
  ],

  expLogs: [
    { time: '03/01 14:32', target: '暱稱A', amount: '+500', reason: '活動獎勵' },
    { time: '02/28 10:15', target: '暱稱B', amount: '-100', reason: '違規扣除' },
    { time: '02/25 09:00', target: '暱稱C', amount: '+200', reason: '賽事MVP' },
  ],

  operationLogs: [
    { time: '03/15 14:32', operator: '總管', type: 'exp', typeName: '手動EXP', content: '暱稱A +500「活動獎勵」' },
    { time: '03/15 10:15', operator: '管理員B', type: 'role', typeName: '晉升用戶', content: '暱稱C → 教練' },
    { time: '03/14 18:00', operator: '管理員B', type: 'event', typeName: '活動管理', content: '建立「週六足球友誼賽」' },
    { time: '03/13 09:30', operator: '總管', type: 'role', typeName: '晉升用戶', content: '暱稱B → 管理員' },
    { time: '03/12 14:00', operator: '總管', type: 'exp', typeName: '手動EXP', content: '暱稱D +1000「賽事冠軍」' },
  ],

  adminUsers: [
    { name: '王小明', uid: 'U1a2b3c', role: 'user', level: 10, region: '台北', exp: 800 },
    { name: '李大華', uid: 'U4d5e6f', role: 'coach', level: 22, region: '台中', exp: 2100 },
    { name: '張美玲', uid: 'U7g8h9i', role: 'captain', level: 28, region: '台北', exp: 4300 },
    { name: '陳志偉', uid: 'Uj1k2l3', role: 'venue_owner', level: 15, region: '高雄', exp: 1200 },
    { name: '周書翰', uid: 'Um4n5o6', role: 'user', level: 5, region: '台北', exp: 300 },
  ],

  banners: [
    { title: '春季聯賽 Banner', status: 'active', position: '主輪播', publishAt: '03/01', unpublishAt: '03/31', clicks: 1234, gradient: 'linear-gradient(135deg,#0d9488,#065f46)' },
    { title: '友誼賽推廣', status: 'scheduled', position: '側邊浮動', publishAt: '03/20', unpublishAt: '04/15', clicks: 0, gradient: 'linear-gradient(135deg,#7c3aed,#4338ca)' },
    { title: '二手球具展', status: 'expired', position: '主輪播', publishAt: '02/01', unpublishAt: '02/28', clicks: 567, gradient: 'linear-gradient(135deg,#dc2626,#991b1b)' },
  ],

  permissions: [
    { cat: '活動相關', items: [
      { code: 'event.create', name: '建立活動' }, { code: 'event.edit_own', name: '編輯自己的活動' },
      { code: 'event.delete_own', name: '刪除自己的活動' }, { code: 'event.edit_all', name: '編輯所有活動' },
      { code: 'event.delete_all', name: '刪除所有活動' }, { code: 'event.publish', name: '上架/下架活動' },
      { code: 'event.scan_qr', name: '掃碼簽到/簽退' }, { code: 'event.manual_checkin', name: '手動簽到/簽退' },
      { code: 'event.view_participants', name: '查看報名名單' },
    ]},
    { cat: '球隊相關', items: [
      { code: 'team.create', name: '建立球隊' }, { code: 'team.manage_own', name: '管理自己的球隊' },
      { code: 'team.manage_all', name: '管理所有球隊' }, { code: 'team.approve_join', name: '審核入隊申請' },
      { code: 'team.assign_coach', name: '指派球隊教練' }, { code: 'team.create_team_event', name: '建立球隊專屬活動' },
      { code: 'team.toggle_event_public', name: '切換活動公開性' },
    ]},
    { cat: '賽事相關', items: [
      { code: 'tournament.create', name: '建立賽事' }, { code: 'tournament.edit_own', name: '編輯自己的賽事' },
      { code: 'tournament.edit_all', name: '編輯所有賽事' }, { code: 'tournament.input_score', name: '輸入比分' },
      { code: 'tournament.input_cards', name: '輸入紅黃牌' }, { code: 'tournament.manage_schedule', name: '管理賽程' },
      { code: 'tournament.approve_team', name: '審核參賽' }, { code: 'tournament.manage_trade', name: '管理交易' },
      { code: 'tournament.set_scoring_rules', name: '設定積分規則' }, { code: 'tournament.set_card_rules', name: '設定紅黃牌規則' },
    ]},
    { cat: '用戶管理', items: [
      { code: 'user.view_all', name: '查看所有用戶' }, { code: 'user.edit_role', name: '修改用戶身份' },
      { code: 'user.edit_profile', name: '修改用戶資料' }, { code: 'user.view_hidden', name: '查看隱藏欄位' },
      { code: 'user.add_exp', name: '手動添加 EXP' }, { code: 'user.promote_coach', name: '晉升為教練' },
      { code: 'user.promote_captain', name: '晉升為領隊' }, { code: 'user.promote_venue_owner', name: '晉升為場主' },
      { code: 'user.promote_admin', name: '晉升為管理員（僅總管）' },
    ]},
    { cat: '站內信', items: [
      { code: 'message.send_private', name: '發送私訊' }, { code: 'message.broadcast', name: '群發信件' },
      { code: 'message.schedule', name: '預定群發' }, { code: 'message.recall', name: '回收信件' },
      { code: 'message.view_read_stats', name: '查看已讀統計' },
    ]},
    { cat: '系統設定', items: [
      { code: 'system.manage_categories', name: '管理運動類別' }, { code: 'system.manage_roles', name: '管理自訂層級' },
      { code: 'system.manage_achievements', name: '管理成就' }, { code: 'system.manage_exp_formula', name: '管理EXP公式' },
      { code: 'system.manage_level_formula', name: '管理等級公式' }, { code: 'system.assign_admin', name: '指定管理員（僅總管）' },
      { code: 'system.override_trade_freeze', name: '覆寫交易凍結' }, { code: 'system.view_inactive_data', name: '查看無效資料' },
    ]},
  ],

  activityRecords: [
    { name: '週六足球友誼賽', date: '03/08', status: 'completed' },
    { name: '週三訓練', date: '03/05', status: 'completed' },
    { name: '新手教學', date: '03/01', status: 'cancelled' },
    { name: '週六足球友誼賽', date: '02/22', status: 'completed' },
    { name: '室內五人制', date: '02/15', status: 'early-left' },
  ],
};

// ─── Drawer Menu Config ───
const DRAWER_MENUS = [
  { icon: '🏆', label: '賽事中心', page: 'page-tournaments', minRole: 'user' },
  { icon: '🛒', label: '二手商品區', page: 'page-shop', minRole: 'user' },
  { icon: '📊', label: '排行榜', page: 'page-leaderboard', minRole: 'user' },
  { icon: '🔗', label: '分享網頁', action: 'share', minRole: 'user' },
  { divider: true },
  { icon: '📋', label: '我的活動管理', page: 'page-my-activities', minRole: 'coach' },
  { icon: '📷', label: '掃碼簽到/簽退', page: 'page-scan', minRole: 'coach' },
  { divider: true, minRole: 'admin' },
  { sectionLabel: '後台管理', minRole: 'admin' },
  { icon: '👥', label: '用戶管理', page: 'page-admin-users', minRole: 'admin' },
  { icon: '✨', label: '手動 EXP 管理', page: 'page-admin-exp', minRole: 'super_admin' },
  { icon: '🖼', label: 'Banner 管理', page: 'page-admin-banners', minRole: 'admin' },
  { icon: '🏷', label: '二手商品管理', page: 'page-admin-shop', minRole: 'admin' },
  { icon: '📬', label: '站內信管理', page: 'page-admin-messages', minRole: 'admin' },
  { icon: '🏟', label: '賽事管理', page: 'page-admin-tournaments', minRole: 'admin' },
  { icon: '🏅', label: '成就/徽章管理', page: 'page-admin-achievements', minRole: 'super_admin' },
  { icon: '⚙', label: '自訂層級管理', page: 'page-admin-roles', minRole: 'super_admin' },
  { icon: '📂', label: '無效資料查詢', page: 'page-admin-inactive', minRole: 'super_admin' },
  { icon: '📝', label: '操作日誌', page: 'page-admin-logs', minRole: 'super_admin' },
];

// ─── App State & Controller ───
const App = {
  currentRole: 'user',
  currentPage: 'page-home',
  pageHistory: [],
  bannerIndex: 0,
  bannerTimer: null,

  init() {
    this.bindRoleSwitcher();
    this.bindNavigation();
    this.bindDrawer();
    this.bindTheme();
    this.bindAnnouncement();
    this.bindFilterToggle();
    this.bindTabBars();
    this.bindTournamentTabs();
    this.bindScanModes();
    this.startBannerCarousel();
    this.renderAll();
    this.applyRole('user');
  },

  // ── Role System ──
  bindRoleSwitcher() {
    document.querySelectorAll('.role-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.role-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.applyRole(btn.dataset.role);
      });
    });
  },

  applyRole(role) {
    this.currentRole = role;
    const roleInfo = ROLES[role];
    const level = ROLE_LEVEL_MAP[role];

    // Update drawer tag
    document.getElementById('drawer-role-tag').textContent = roleInfo.label;
    document.getElementById('drawer-role-tag').style.background = roleInfo.color + '22';
    document.getElementById('drawer-role-tag').style.color = roleInfo.color;

    // Show/hide role-gated elements
    document.querySelectorAll('[data-min-role]').forEach(el => {
      const minLevel = ROLE_LEVEL_MAP[el.dataset.minRole] || 0;
      el.style.display = level >= minLevel ? '' : 'none';
    });

    // Contact row in profile
    document.querySelectorAll('.contact-row').forEach(el => {
      el.style.display = level >= 1 ? 'flex' : 'none';
    });

    // Rebuild drawer menu
    this.renderDrawerMenu();

    // Rebuild admin user list with correct promote options
    this.renderAdminUsers();

    // If currently on a page that requires higher role, go home
    const currentPageEl = document.getElementById(this.currentPage);
    if (currentPageEl && currentPageEl.dataset.minRole) {
      const minLevel = ROLE_LEVEL_MAP[currentPageEl.dataset.minRole] || 0;
      if (level < minLevel) {
        this.showPage('page-home');
      }
    }

    this.showToast(`已切換為「${roleInfo.label}」身份`);
  },

  // ── Drawer Menu ──
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

  // ── Navigation ──
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
      // update bottom tabs
      const mainPages = ['page-home','page-activities','page-teams','page-messages','page-profile'];
      document.querySelectorAll('.bot-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.page === prev && mainPages.includes(prev));
      });
    }
  },

  // ── Drawer ──
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

  // ── Theme ──
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

  // ── Announcement ──
  bindAnnouncement() {
    document.querySelector('.announce-header')?.addEventListener('click', () => {
      document.getElementById('announce-card').classList.toggle('collapsed');
    });
  },

  // ── Filter Toggle ──
  bindFilterToggle() {
    document.getElementById('filter-toggle')?.addEventListener('click', () => {
      document.getElementById('filter-bar').classList.toggle('visible');
    });
  },

  // ── Tab Bars ──
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

  // ── Tournament Tabs ──
  bindTournamentTabs() {
    document.querySelectorAll('[data-ttab]').forEach(tab => {
      tab.addEventListener('click', () => {
        this.renderTournamentTab(tab.dataset.ttab);
      });
    });
  },

  // ── Scan Mode ──
  bindScanModes() {
    document.querySelectorAll('.scan-mode').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.scan-mode').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  },

  // ── Banner Carousel ──
  startBannerCarousel() {
    const track = document.getElementById('banner-track');
    const dots = document.getElementById('banner-dots');
    const slides = track.querySelectorAll('.banner-slide');
    const count = slides.length;

    // Create dots
    dots.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const dot = document.createElement('div');
      dot.className = 'banner-dot' + (i === 0 ? ' active' : '');
      dot.addEventListener('click', () => this.goToBanner(i));
      dots.appendChild(dot);
    }

    this.bannerTimer = setInterval(() => {
      this.bannerIndex = (this.bannerIndex + 1) % count;
      this.goToBanner(this.bannerIndex);
    }, 4000);
  },

  goToBanner(idx) {
    this.bannerIndex = idx;
    const track = document.getElementById('banner-track');
    track.style.transform = `translateX(-${idx * 100}%)`;
    document.querySelectorAll('.banner-dot').forEach((d, i) => d.classList.toggle('active', i === idx));
  },

  // ── Render All ──
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
    this.renderTournamentList();
    this.renderTournamentTab('schedule');
    this.renderActivityRecords();
    this.renderAdminUsers();
    this.renderExpLogs();
    this.renderOperationLogs();
    this.renderBannerManage();
    this.renderShopManage();
    this.renderMsgManage();
    this.renderTournamentManage();
    this.renderPermissions();
    this.renderInactiveData();
    this.renderMyActivities();
    this.renderUserCard();
  },

  // ── Render: Hot Events ──
  renderHotEvents() {
    const container = document.getElementById('hot-events');
    container.innerHTML = DemoData.events.map(e => `
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
    `).join('');
  },

  // ── Render: Ongoing Tournaments ──
  renderOngoingTournaments() {
    const container = document.getElementById('ongoing-tournaments');
    container.innerHTML = DemoData.tournaments.map(t => `
      <div class="h-card" onclick="App.showPage('page-tournament-detail')">
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

  // ── Render: Activity List ──
  renderActivityList() {
    const container = document.getElementById('activity-list');
    container.innerHTML = DemoData.events.map(e => `
      <div class="event-card" onclick="App.showEventDetail('${e.id}')">
        <div class="event-card-top" style="background:${e.gradient}">
          ${e.icon}
          <div class="event-countdown">⏰ ${e.countdown}</div>
        </div>
        <div class="event-card-body">
          <div class="event-card-title">${e.title}</div>
          <div class="event-meta">
            <span class="event-meta-item"><span class="event-meta-icon">📍</span>${e.location}</span>
            <span class="event-meta-item"><span class="event-meta-icon">🕐</span>${e.date}</span>
            <span class="event-meta-item"><span class="event-meta-icon">💰</span>${e.fee > 0 ? '$'+e.fee : '免費'}</span>
            <span class="event-meta-item"><span class="event-meta-icon">👥</span>${e.current}/${e.max} (候${e.waitlist})</span>
          </div>
          <div class="event-card-footer">
            <button class="primary-btn small" onclick="event.stopPropagation(); App.handleSignup('${e.id}')">${e.current >= e.max ? '候補報名' : '立即報名'}</button>
            <button class="outline-btn small" onclick="event.stopPropagation(); App.showToast('已發送站內信')">站內信聯繫</button>
          </div>
        </div>
      </div>
    `).join('');
  },

  // ── Show Event Detail ──
  showEventDetail(id) {
    const e = DemoData.events.find(ev => ev.id === id);
    if (!e) return;
    document.getElementById('detail-title').textContent = e.title;
    document.querySelector('#page-activity-detail .detail-banner').style.background = e.gradient;
    document.getElementById('detail-body').innerHTML = `
      <div class="detail-row"><span class="icon">📍</span>${e.location}</div>
      <div class="detail-row"><span class="icon">🕐</span>${e.date}</div>
      <div class="detail-row"><span class="icon">💰</span>${e.fee > 0 ? '$'+e.fee : '免費'}</div>
      <div class="detail-row"><span class="icon">👥</span>已報 ${e.current}/${e.max}　候補 ${e.waitlist}/${e.waitlistMax}</div>
      <div class="detail-row"><span class="icon">👤</span>${e.creator}</div>
      ${e.contact ? `<div class="detail-row"><span class="icon">📞</span>${e.contact}</div>` : ''}
      <div class="detail-row"><span class="icon">⏰</span>活動倒數：${e.countdown}</div>
      <div style="display:flex;gap:.5rem;margin:1rem 0">
        <button class="primary-btn" onclick="App.handleSignup('${e.id}')">${e.current >= e.max ? '候補報名' : '立即報名'}</button>
        <button class="outline-btn" onclick="App.showToast('已發送站內信')">透過站內信聯繫</button>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">報名名單 (${e.current})</div>
        <div class="participant-list">${e.participants.map(p => `<span class="participant-tag">${p}</span>`).join('')}</div>
      </div>
      ${e.waitlistNames.length > 0 ? `
      <div class="detail-section">
        <div class="detail-section-title">候補名單 (${e.waitlist})</div>
        <div class="participant-list">${e.waitlistNames.map(p => `<span class="participant-tag">${p}</span>`).join('')}</div>
      </div>` : ''}
    `;
    this.showPage('page-activity-detail');
  },

  handleSignup(id) {
    const e = DemoData.events.find(ev => ev.id === id);
    if (!e) return;
    if (e.current >= e.max) {
      this.showToast('⚠️ 已額滿，已加入候補名單');
    } else {
      this.showToast('✅ 報名成功！');
    }
  },

  // ── Render: Teams ──
  renderTeamList() {
    const container = document.getElementById('team-list');
    container.innerHTML = DemoData.teams.map(t => `
      <div class="team-card" onclick="App.showTeamDetail('${t.id}')">
        <div class="team-emblem" style="background:${t.color}22;color:${t.color}">${t.emblem}</div>
        <div class="team-info">
          <div class="team-name">${t.name}</div>
          <div class="team-meta">👑 ${t.captain} ・ 👥 ${t.members}人</div>
        </div>
      </div>
    `).join('');
  },

  showTeamDetail(id) {
    const t = DemoData.teams.find(tm => tm.id === id);
    if (!t) return;
    document.getElementById('team-detail-title').textContent = t.name;
    document.getElementById('team-detail-body').innerHTML = `
      <div class="info-card">
        <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:.75rem">
          <div class="team-emblem" style="background:${t.color}22;color:${t.color};font-size:2rem">${t.emblem}</div>
          <div>
            <div style="font-weight:700;font-size:1.1rem">${t.name}</div>
            <div style="font-size:.8rem;color:var(--text-secondary)">👑 領隊：${t.captain}</div>
            <div style="font-size:.8rem;color:var(--text-secondary)">🏋 教練：${t.coaches.length > 0 ? t.coaches.join('、') : '無'}</div>
            <div style="font-size:.8rem;color:var(--text-secondary)">👥 成員：${t.members} 人</div>
          </div>
        </div>
      </div>
      <div class="tab-bar compact">
        <button class="tab active">成員</button>
        <button class="tab">戰績</button>
        <button class="tab">賽事</button>
      </div>
      <div class="info-card">
        <div class="info-title">成員列表</div>
        ${Array.from({length: Math.min(t.members, 8)}, (_, i) => `
          <div class="info-row"><span>球員${i+1}</span><span style="font-size:.72rem;color:var(--text-muted)">${i === 0 ? '領隊' : i <= t.coaches.length ? '教練' : '球員'}</span></div>
        `).join('')}
        ${t.members > 8 ? `<div style="text-align:center;font-size:.78rem;color:var(--text-muted);padding:.3rem">... 共 ${t.members} 人</div>` : ''}
      </div>
      <div style="display:flex;gap:.5rem;padding:.5rem 0">
        <button class="primary-btn" onclick="App.showToast('已送出加入申請！')">申請加入</button>
        <button class="outline-btn" onclick="App.showToast('透過站內信聯繫')">聯繫領隊</button>
      </div>
    `;
    this.showPage('page-team-detail');
  },

  // ── Render: Messages ──
  renderMessageList() {
    const container = document.getElementById('message-list');
    container.innerHTML = DemoData.messages.map(m => `
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

  // ── Render: Achievements ──
  renderAchievements() {
    const container = document.getElementById('achievement-grid');
    container.innerHTML = DemoData.achievements.map(a => `
      <div class="ach-item ${a.unlocked ? '' : 'locked'}">
        <div class="ach-icon">${a.unlocked ? a.icon : '🔒'}</div>
        <div class="ach-name">${a.name}</div>
      </div>
    `).join('');
  },

  // ── Render: Badges ──
  renderBadges() {
    const container = document.getElementById('badge-grid');
    container.innerHTML = DemoData.badges.map(b => `
      <div class="badge-item">
        <div class="ach-icon">${b.icon}</div>
        <div class="ach-name">${b.name}</div>
      </div>
    `).join('');
  },

  // ── Render: Shop ──
  renderShop() {
    const container = document.getElementById('shop-grid');
    container.innerHTML = DemoData.shopItems.map(s => `
      <div class="shop-card">
        <div class="shop-img">${s.icon}</div>
        <div class="shop-body">
          <div class="shop-name">${s.name}</div>
          <div class="shop-price">$${s.price.toLocaleString()}</div>
          <div class="shop-meta">${s.condition} ・ ${s.size}</div>
        </div>
      </div>
    `).join('');
  },

  // ── Render: Leaderboard ──
  renderLeaderboard() {
    const container = document.getElementById('leaderboard-list');
    container.innerHTML = DemoData.leaderboard.map((p, i) => {
      const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : 'normal';
      return `
        <div class="lb-item">
          <div class="lb-rank ${rankClass}">${i + 1}</div>
          <div class="lb-avatar">${p.avatar}</div>
          <div class="lb-info">
            <div class="lb-name">${p.name}</div>
            <div class="lb-sub">Lv.${p.level}</div>
          </div>
          <div class="lb-exp">${p.exp.toLocaleString()}</div>
        </div>
      `;
    }).join('');
  },

  // ── Render: Tournament List ──
  renderTournamentList() {
    const container = document.getElementById('tournament-list');
    container.innerHTML = DemoData.tournaments.map(t => `
      <div class="event-card" onclick="App.showPage('page-tournament-detail')">
        <div class="event-card-top" style="background:${t.gradient}">🏆</div>
        <div class="event-card-body">
          <div class="event-card-title">${t.name}</div>
          <div class="event-meta">
            <span class="event-meta-item">${t.type}</span>
            <span class="event-meta-item">👥 ${t.teams} 隊</span>
            <span class="event-meta-item">⚔ ${t.matches} 場</span>
            <span class="event-meta-item">📌 ${t.status}</span>
          </div>
        </div>
      </div>
    `).join('');
  },

  // ── Render: Tournament Tab Content ──
  renderTournamentTab(tab) {
    const container = document.getElementById('tournament-content');
    if (tab === 'schedule') {
      container.innerHTML = '<div style="font-size:.78rem;color:var(--text-muted);margin-bottom:.5rem">第 3 輪</div>' +
        DemoData.matches.map(m => `
          <div class="match-card">
            <div class="match-teams">
              <span>${m.home}</span>
              <span class="match-score">${m.scoreH !== null ? `${m.scoreH} : ${m.scoreA}` : 'vs'}</span>
              <span>${m.away}</span>
            </div>
            <div class="match-meta"><span>📍 ${m.venue}</span><span>🕐 ${m.time}</span></div>
            ${m.scoreH !== null ? `<div class="match-cards-display">
              <span class="yellow-card">🟨×${m.yellowH}</span> <span class="red-card">🟥×${m.redH}</span>
              　
              <span class="yellow-card">🟨×${m.yellowA}</span> <span class="red-card">🟥×${m.redA}</span>
            </div>` : ''}
          </div>
        `).join('');
    } else if (tab === 'standings') {
      container.innerHTML = `<table class="standings-table">
        <tr><th>#</th><th>隊名</th><th>勝</th><th>平</th><th>負</th><th>積分</th></tr>
        ${DemoData.standings.map(s => `<tr><td>${s.rank}</td><td>${s.name}</td><td>${s.w}</td><td>${s.d}</td><td>${s.l}</td><td><strong>${s.pts}</strong></td></tr>`).join('')}
      </table>`;
    } else if (tab === 'trades') {
      container.innerHTML = `
        <div style="padding:.5rem;margin-bottom:.5rem;font-size:.82rem;color:var(--text-secondary)">
          交易窗口：03/01~03/20　狀態：<span style="color:var(--success);font-weight:600">🟢 開放中</span>
        </div>
        ${DemoData.trades.map(t => `
          <div class="trade-card">
            <div style="font-weight:600;margin-bottom:.25rem">${t.from} → ${t.to}</div>
            <div>球員：${t.player}　價值：${t.value} 積分</div>
            <div style="margin-top:.3rem"><span class="trade-status ${t.status}">${t.status === 'success' ? '✅ 成交' : '⏳ 待確認'}</span> <span style="font-size:.72rem;color:var(--text-muted)">${t.date}</span></div>
          </div>
        `).join('')}`;
    } else {
      container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted)">紀錄資料載入中...</div>';
    }
  },

  // ── Render: Activity Records ──
  renderActivityRecords() {
    const container = document.getElementById('my-activity-records');
    container.innerHTML = DemoData.activityRecords.map(r => `
      <div class="mini-activity">
        <span class="mini-activity-status ${r.status}"></span>
        <span class="mini-activity-name">${r.name}</span>
        <span class="mini-activity-date">${r.date}</span>
      </div>
    `).join('');
  },

  // ── Render: Admin Users ──
  renderAdminUsers() {
    const container = document.getElementById('admin-user-list');
    if (!container) return;
    const myLevel = ROLE_LEVEL_MAP[this.currentRole];

    container.innerHTML = DemoData.adminUsers.map(u => {
      let promoteOptions = '';
      if (myLevel >= 5) { // 總管
        promoteOptions = '<option value="">晉升▼</option><option>管理員</option><option>教練</option><option>領隊</option><option>場主</option>';
      } else if (myLevel >= 4) { // 管理員
        promoteOptions = '<option value="">晉升▼</option><option>教練</option><option>領隊</option><option>場主</option>';
      }

      return `
        <div class="admin-user-card">
          <div class="profile-avatar small">${u.name[0]}</div>
          <div class="admin-user-info">
            <div class="admin-user-name">${u.name}</div>
            <div class="admin-user-meta">${u.uid} ・ ${ROLES[u.role]?.label || u.role} ・ Lv.${u.level} ・ ${u.region}</div>
          </div>
          <div class="admin-user-actions">
            ${promoteOptions ? `<select class="promote-select" onchange="App.handlePromote(this, '${u.name}')">${promoteOptions}</select>` : ''}
            <button class="text-btn" onclick="App.showPage('page-user-card')">查看</button>
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

  // ── Render: EXP Logs ──
  renderExpLogs() {
    const container = document.getElementById('exp-log-list');
    if (!container) return;
    container.innerHTML = DemoData.expLogs.map(l => `
      <div class="log-item">
        <span class="log-time">${l.time}</span>
        <span class="log-content">${l.target} <strong>${l.amount}</strong>「${l.reason}」</span>
      </div>
    `).join('');
  },

  demoExpSearch() {
    this.showToast('已搜尋到用戶「暱稱A」');
  },

  // ── Render: Operation Logs ──
  renderOperationLogs() {
    const container = document.getElementById('operation-log-list');
    if (!container) return;
    container.innerHTML = DemoData.operationLogs.map(l => `
      <div class="log-item">
        <span class="log-time">${l.time}</span>
        <span class="log-content">
          <span class="log-type ${l.type}">${l.typeName}</span>
          ${l.operator}：${l.content}
        </span>
      </div>
    `).join('');
  },

  // ── Render: Banner Manage ──
  renderBannerManage() {
    const container = document.getElementById('banner-manage-list');
    if (!container) return;
    container.innerHTML = DemoData.banners.map(b => `
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

  // ── Render: Shop Manage ──
  renderShopManage() {
    const container = document.getElementById('shop-manage-list');
    if (!container) return;
    container.innerHTML = DemoData.shopItems.map(s => `
      <div class="banner-manage-card">
        <div class="banner-thumb" style="background:var(--bg-elevated);font-size:1.5rem">${s.icon}</div>
        <div class="banner-manage-info">
          <div class="banner-manage-title">${s.name}</div>
          <div class="banner-manage-meta">${s.condition} ・ ${s.size} ・ $${s.price}</div>
          <span class="banner-manage-status status-active">🟢 上架中</span>
        </div>
      </div>
    `).join('');
  },

  // ── Render: Message Manage ──
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

  // ── Render: Tournament Manage ──
  renderTournamentManage() {
    const container = document.getElementById('tournament-manage-list');
    if (!container) return;
    container.innerHTML = DemoData.tournaments.map(t => `
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

  // ── Render: Permissions ──
  renderPermissions() {
    const container = document.getElementById('permissions-list');
    if (!container) return;
    container.innerHTML = DemoData.permissions.map((cat, ci) => `
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

  // ── Render: Inactive Data ──
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

  // ── Render: My Activities ──
  renderMyActivities() {
    const container = document.getElementById('my-activity-list');
    if (!container) return;
    container.innerHTML = DemoData.events.slice(0, 2).map(e => `
      <div class="event-card">
        <div class="event-card-body">
          <div class="event-card-title">${e.title}</div>
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
      </div>
    `).join('');
  },

  // ── Render: User Card ──
  renderUserCard() {
    const container = document.getElementById('user-card-full');
    if (!container) return;
    container.innerHTML = `
      <div class="uc-header">
        <div class="uc-doll-frame">👤</div>
        <div class="profile-title">全勤.王小明</div>
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

  // ── Modal ──
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
      // Close any open modal first
      document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open'));
      modal.classList.add('open');
      overlay.classList.add('open');
    }
  },

  closeModal() {
    document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open'));
    document.getElementById('modal-overlay').classList.remove('open');
  },

  // ── Toast ──
  showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
  },
};

// ── Init on DOM Ready ──
document.addEventListener('DOMContentLoaded', () => App.init());

// Close modal on overlay click
document.getElementById('modal-overlay')?.addEventListener('click', () => App.closeModal());
