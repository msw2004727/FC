/* ================================================
   SportHub — i18n (Internationalization Infrastructure)
   用法：t('key') 或 t('key', { var: 'value' })
   ================================================ */

const I18N = {
  _locale: 'zh-TW',
  _packs: {},

  init() {
    this._locale = localStorage.getItem('sporthub_lang') || 'zh-TW';
  },

  getLocale() { return this._locale; },

  setLocale(locale) {
    if (!this._packs[locale]) return;
    this._locale = locale;
    localStorage.setItem('sporthub_lang', locale);
  },

  getAvailableLocales() {
    return Object.keys(this._packs).map(k => ({ code: k, label: this._packs[k]._label || k }));
  },

  register(locale, pack) {
    this._packs[locale] = pack;
  },

  t(key, vars) {
    const pack = this._packs[this._locale] || this._packs['zh-TW'] || {};
    let text = pack[key];
    if (text === undefined) {
      // Fallback to zh-TW
      const fallback = this._packs['zh-TW'] || {};
      text = fallback[key];
    }
    if (text === undefined) return key; // Return key if not found
    if (vars) {
      Object.keys(vars).forEach(k => {
        text = text.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]);
      });
    }
    return text;
  },
};

// ─── Chinese (Traditional) — Default ───
I18N.register('zh-TW', {
  _label: '繁體中文',
  // Navigation
  'nav.home': '首頁',
  'nav.activities': '活動',
  'nav.teams': '球隊',
  'nav.tournaments': '賽事',
  'nav.profile': '我的',
  // Common
  'common.save': '儲存',
  'common.cancel': '取消',
  'common.edit': '編輯',
  'common.delete': '刪除',
  'common.confirm': '確認',
  'common.back': '返回',
  'common.search': '搜尋',
  'common.loading': '載入中...',
  'common.noData': '暫無資料',
  'common.close': '關閉',
  'common.submit': '送出',
  'common.create': '新增',
  'common.all': '全部',
  // Profile
  'profile.myProfile': '我的資料',
  'profile.achievements': '成就/徽章',
  'profile.titles': '稱號',
  'profile.favorites': '我的收藏',
  'profile.activityRecords': '報名紀錄',
  'profile.level': 'Lv.{level}',
  'profile.gender': '性別',
  'profile.birthday': '生日',
  'profile.region': '地區',
  'profile.sports': '運動類別',
  'profile.team': '所屬球隊',
  'profile.phone': '聯繫方式',
  'profile.joinDate': '加入時間',
  'profile.totalGames': '參加場次',
  'profile.completed': '完成',
  'profile.attendanceRate': '出席率',
  'profile.badges': '徽章',
  'profile.qrCode': '我的 QR Code',
  'profile.inventory': '道具欄',
  'profile.lineNotify': 'LINE 推播通知',
  'profile.applications': '我的球隊申請',
  // Activity
  'activity.register': '我要報名',
  'activity.cancel': '取消報名',
  'activity.full': '已額滿',
  'activity.ended': '已結束',
  'activity.upcoming': '即將開放',
  'activity.waitlist': '候補',
  'activity.participants': '人',
  'activity.fee': '費用',
  'activity.location': '地點',
  'activity.time': '時間',
  'activity.organizer': '主辦',
  'activity.free': '免費',
  // Status
  'status.open': '報名中',
  'status.full': '已額滿',
  'status.ended': '已結束',
  'status.upcoming': '即將開放',
  'status.cancelled': '已取消',
  'status.registered': '已報名',
  'status.completed': '已完成',
  // Team
  'team.join': '申請加入',
  'team.members': '成員',
  'team.captain': '領隊',
  'team.coach': '教練',
  'team.create': '建立球隊',
  'team.info': '球隊資訊',
  'team.record': '戰績',
  'team.rank': '積分排名',
  // Tournament
  'tournament.register': '報名比賽',
  'tournament.regClosed': '報名已截止',
  'tournament.regFull': '報名已滿',
  'tournament.schedule': '賽程表',
  'tournament.detail': '賽事詳情',
  'tournament.teams': '參賽隊伍',
  // Toast messages
  'toast.saved': '已儲存',
  'toast.deleted': '已刪除',
  'toast.copied': '已複製',
  'toast.favoriteAdded': '已加入收藏',
  'toast.favoriteRemoved': '已取消收藏',
  'toast.langChanged': '語言已切換',
  // Drawer / Admin
  'drawer.darkMode': '深色模式',
  'drawer.language': '語言',
  'drawer.shop': '二手商品區',
  'drawer.leaderboard': '排行榜',
  'drawer.share': '分享網頁',
  'drawer.activityManage': '活動管理',
  'drawer.tournamentManage': '賽事管理',
  'drawer.scan': '掃碼簽到/簽退',
  'admin.dashboard': '數據儀表板',
  'admin.userManage': '用戶管理',
  'admin.adManage': '廣告管理',
  'admin.shopManage': '二手商品管理',
  'admin.messageManage': '站內信管理',
  'admin.teamManage': '球隊管理',
  'admin.themes': '佈景主題',
  'admin.expManage': '手動 EXP 管理',
  'admin.announcements': '系統公告管理',
  'admin.achievements': '成就/徽章管理',
  'admin.roles': '自訂層級管理',
  'admin.inactive': '無效資料查詢',
  'admin.logs': '操作日誌',
  // Dashboard
  'dash.totalUsers': '註冊用戶',
  'dash.totalEvents': '活動總數',
  'dash.activeTeams': '活躍球隊',
  'dash.ongoingTourn': '進行中賽事',
  'dash.openEvents': '報名中活動',
  'dash.endedEvents': '已結束活動',
  'dash.totalRecords': '報名紀錄',
  'dash.attendRate': '出席率',
  'dash.typeDistribution': '活動類型分布',
  'dash.regionDistribution': '地區分布',
  'dash.monthlyTrend': '參與趨勢（月份）',
  'dash.teamRanking': '球隊積分 Top 5',
});

// ─── English ───
I18N.register('en', {
  _label: 'English',
  // Navigation
  'nav.home': 'Home',
  'nav.activities': 'Activities',
  'nav.teams': 'Teams',
  'nav.tournaments': 'Tournaments',
  'nav.profile': 'Profile',
  // Common
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.edit': 'Edit',
  'common.delete': 'Delete',
  'common.confirm': 'Confirm',
  'common.back': 'Back',
  'common.search': 'Search',
  'common.loading': 'Loading...',
  'common.noData': 'No data',
  'common.close': 'Close',
  'common.submit': 'Submit',
  'common.create': 'Create',
  'common.all': 'All',
  // Profile
  'profile.myProfile': 'My Profile',
  'profile.achievements': 'Achievements',
  'profile.titles': 'Titles',
  'profile.favorites': 'Favorites',
  'profile.activityRecords': 'Activity Records',
  'profile.level': 'Lv.{level}',
  'profile.gender': 'Gender',
  'profile.birthday': 'Birthday',
  'profile.region': 'Region',
  'profile.sports': 'Sports',
  'profile.team': 'Team',
  'profile.phone': 'Phone',
  'profile.joinDate': 'Joined',
  'profile.totalGames': 'Games',
  'profile.completed': 'Done',
  'profile.attendanceRate': 'Rate',
  'profile.badges': 'Badges',
  'profile.qrCode': 'My QR Code',
  'profile.inventory': 'Inventory',
  'profile.lineNotify': 'LINE Notifications',
  'profile.applications': 'My Applications',
  // Activity
  'activity.register': 'Register',
  'activity.cancel': 'Cancel Registration',
  'activity.full': 'Full',
  'activity.ended': 'Ended',
  'activity.upcoming': 'Coming Soon',
  'activity.waitlist': 'Waitlist',
  'activity.participants': 'ppl',
  'activity.fee': 'Fee',
  'activity.location': 'Location',
  'activity.time': 'Time',
  'activity.organizer': 'Organizer',
  'activity.free': 'Free',
  // Status
  'status.open': 'Open',
  'status.full': 'Full',
  'status.ended': 'Ended',
  'status.upcoming': 'Coming Soon',
  'status.cancelled': 'Cancelled',
  'status.registered': 'Registered',
  'status.completed': 'Completed',
  // Team
  'team.join': 'Apply',
  'team.members': 'Members',
  'team.captain': 'Captain',
  'team.coach': 'Coach',
  'team.create': 'Create Team',
  'team.info': 'Team Info',
  'team.record': 'Record',
  'team.rank': 'Ranking',
  // Tournament
  'tournament.register': 'Register',
  'tournament.regClosed': 'Registration Closed',
  'tournament.regFull': 'Registration Full',
  'tournament.schedule': 'Schedule',
  'tournament.detail': 'Details',
  'tournament.teams': 'Teams',
  // Toast messages
  'toast.saved': 'Saved',
  'toast.deleted': 'Deleted',
  'toast.copied': 'Copied',
  'toast.favoriteAdded': 'Added to favorites',
  'toast.favoriteRemoved': 'Removed from favorites',
  'toast.langChanged': 'Language changed',
  // Drawer / Admin
  'drawer.darkMode': 'Dark Mode',
  'drawer.language': 'Language',
  'drawer.shop': 'Shop',
  'drawer.leaderboard': 'Leaderboard',
  'drawer.share': 'Share',
  'drawer.activityManage': 'Activity Mgmt',
  'drawer.tournamentManage': 'Tournament Mgmt',
  'drawer.scan': 'Scan Check-in',
  'admin.dashboard': 'Dashboard',
  'admin.userManage': 'Users',
  'admin.adManage': 'Ad Management',
  'admin.shopManage': 'Shop Mgmt',
  'admin.messageManage': 'Messages',
  'admin.teamManage': 'Team Mgmt',
  'admin.themes': 'Themes',
  'admin.expManage': 'EXP Mgmt',
  'admin.announcements': 'Announcements',
  'admin.achievements': 'Achievements',
  'admin.roles': 'Role Mgmt',
  'admin.inactive': 'Inactive Data',
  'admin.logs': 'Logs',
  // Dashboard
  'dash.totalUsers': 'Users',
  'dash.totalEvents': 'Events',
  'dash.activeTeams': 'Active Teams',
  'dash.ongoingTourn': 'Tournaments',
  'dash.openEvents': 'Open Events',
  'dash.endedEvents': 'Ended Events',
  'dash.totalRecords': 'Records',
  'dash.attendRate': 'Attendance',
  'dash.typeDistribution': 'Event Type Distribution',
  'dash.regionDistribution': 'Region Distribution',
  'dash.monthlyTrend': 'Monthly Trend',
  'dash.teamRanking': 'Team Ranking Top 5',
});

I18N.init();

// Global shortcut
function t(key, vars) { return I18N.t(key, vars); }
