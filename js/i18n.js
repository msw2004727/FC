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
  _label: '🇹🇼 繁中',
  // Navigation
  'nav.home': '首頁',
  'nav.activities': '活動',
  'nav.teams': '俱樂部',
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
  'profile.team': '所屬俱樂部',
  'profile.phone': '聯繫方式',
  'profile.joinDate': '加入時間',
  'profile.totalGames': '參加場次',
  'profile.completed': '完成',
  'profile.attendanceRate': '出席率',
  'profile.badges': '徽章',
  'profile.qrCode': '我的 QR Code',
  'profile.inventory': '道具欄',
  'profile.lineNotify': 'LINE 推播通知',
  'profile.applications': '我的俱樂部申請',
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
  'activity.noActive': '目前沒有進行中的活動',
  'activity.noMatch': '請確認「右上角」活動類別，當前沒有活動',
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
  'team.leave': '退出俱樂部',
  'team.members': '成員',
  'team.captain': '領隊',
  'team.coach': '教練',
  'team.create': '建立俱樂部',
  'team.info': '俱樂部資訊',
  'team.record': '戰績',
  'team.rank': '積分排名',
  'team.memberLabel': '隊員',
  'team.regionLabel': '地區',
  'team.personUnit': '人',
  'team.noMatch': '找不到符合的俱樂部',
  // Tournament
  'tournament.register': '報名比賽',
  'tournament.regClosed': '報名已截止',
  'tournament.regFull': '報名已滿',
  'tournament.schedule': '賽程表',
  'tournament.detail': '賽事詳情',
  'tournament.teams': '參賽隊伍',
  'tournament.teamUnit': '隊',
  'tournament.matchDay': '比賽日',
  'tournament.regPeriod': '報名',
  'tournament.registered': '已報',
  'tournament.noActive': '目前沒有近期賽事',
  'tournament.noEnded': '沒有已結束的賽事',
  'tournament.status.preparing': '即將開始',
  'tournament.status.regOpen': '報名中',
  'tournament.status.regClosed': '已截止報名',
  'tournament.status.ended': '已結束',
  'tournament.createTitle': '新增賽事',
  'tournament.editTitle': '編輯賽事',
  'tournament.searchPlaceholder': '搜尋賽事名稱...',
  'tournament.allRegions': '全部地區',
  'tournament.tabOngoing': '進行中',
  'tournament.tabEnded': '已結束',
  'tournament.tabInfo': '說明',
  'tournament.tabTeams': '俱樂部',
  'tournament.tabSchedule': '賽程',
  'tournament.tabStats': '統計',
  'tournament.comingSoon': '即將推出',
  'tournament.noDescription': '暫無說明',
  'tournament.noTeams': '尚無俱樂部報名',
  'tournament.contactHost': '聯繫主辦人',
  'tournament.waitingReview': '等待審核中',
  'tournament.notYetOpen': '尚未開放報名',
  'tournament.noSchedule': '尚無賽程安排',
  'tournament.matchDays': '比賽日程',
  'tournament.matchResults': '比賽結果',
  'tournament.noStats': '尚無統計資料',
  'tournament.statsSummary': '賽事概覽',
  'tournament.approvedTeams': '參賽俱樂部',
  'tournament.pendingTeams': '待審核',
  'tournament.totalPlayers': '總球員數',
  // Favorites
  'fav.sortTime': '按時間',
  'fav.sortStatus': '按狀態',
  'fav.sortName': '按名稱',
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
  'drawer.manual': '使用手冊',
  'drawer.share': '分享網頁',
  'drawer.applyRole': '申請（俱樂部/場主/教練）',
  'drawer.activityManage': '活動管理',
  'drawer.tournamentManage': '賽事管理',
  'drawer.scan': '掃碼簽到/簽退',
  'admin.dashboard': '數據儀表板',
  'admin.seo': 'SEO 儀表板',
  'admin.userManage': '用戶管理',
  'admin.adManage': '首頁管理',
  'admin.shopManage': '二手商品管理',
  'admin.messageManage': '站內信管理',
  'admin.teamManage': '俱樂部管理',
  'admin.themes': '佈景主題',
  'admin.expManage': '手動 EXP 管理',
  'admin.announcements': '系統公告管理',
  'admin.achievements': '成就/徽章管理',
  'admin.roles': '權限管理',
  'admin.inactive': '無效資料查詢',
  'admin.logs': '日誌中心',
  'admin.auditLogs': '稽核日誌',
  'admin.errorLogs': '錯誤日誌',
  'admin.repair': '用戶補正管理',
  // Dashboard
  'dash.totalUsers': '註冊用戶',
  'dash.totalEvents': '活動總數',
  'dash.activeTeams': '活躍俱樂部',
  'dash.ongoingTourn': '進行中賽事',
  'dash.openEvents': '報名中活動',
  'dash.endedEvents': '已結束活動',
  'dash.totalRecords': '報名紀錄',
  'dash.attendRate': '出席率',
  'dash.typeDistribution': '活動類型分布',
  'dash.regionDistribution': '地區分布',
  'dash.monthlyTrend': '參與趨勢（月份）',
  'dash.teamRanking': '俱樂部積分 Top 5',
  // Team Detail
  'teamDetail.info': '俱樂部資訊',
  'teamDetail.captain': '領隊',
  'teamDetail.coach': '教練',
  'teamDetail.memberCount': '隊員數',
  'teamDetail.region': '地區',
  'teamDetail.nationality': '國籍',
  'teamDetail.founded': '創立時間',
  'teamDetail.contact': '聯繫方式',
  'teamDetail.bio': '簡介',
  'teamDetail.record': '俱樂部戰績',
  'teamDetail.wins': '勝',
  'teamDetail.draws': '平',
  'teamDetail.losses': '負',
  'teamDetail.winRate': '勝率',
  'teamDetail.goalsFor': '進球',
  'teamDetail.goalsAgainst': '失球',
  'teamDetail.goalDiff': '淨勝球',
  'teamDetail.totalGames': '總場次',
  'teamDetail.matchHistory': '賽事紀錄',
  'teamDetail.noHistory': '尚無賽事紀錄',
  'teamDetail.memberList': '成員列表',
  'teamDetail.feed': '俱樂部動態',
  'teamDetail.noFeed': '尚無動態',
  'teamDetail.publish': '發佈',
  'teamDetail.publishing': '發布中',
  'teamDetail.public': '公開',
  'teamDetail.privateOnly': '僅隊內',
  'teamDetail.pinPost': '置頂',
  'teamDetail.unpinPost': '取消置頂',
  'teamDetail.pinned': '置頂',
  'teamDetail.leaveTeam': '退出俱樂部',
  'teamDetail.contactCaptain': '聯繫領隊',
  'teamDetail.applyJoin': '申請加入',
  'teamDetail.inviteQR': '邀請 QR Code',
  'teamDetail.memberCanInvite': '隊員可邀請',
  'teamDetail.notSet': '未設定',
  'teamDetail.none': '無',
  'teamDetail.personUnit': '人',
  'teamDetail.delete': '刪除',
  'teamDetail.prevPage': '上一頁',
  'teamDetail.nextPage': '下一頁',
  'teamDetail.postPlaceholder': '分享動態給隊友...（最多 200 字）',
  'teamDetail.commentPlaceholder': '留言...',
  'teamDetail.commentSubmit': '送出',
  // Team Page
  'teamPage.searchPlaceholder': '搜尋俱樂部名稱...',
  'teamPage.allRegions': '全部地區',
  'teamPage.manage': '管理',
  'teamPage.myTeams': '我的俱樂部',
  'teamPage.allTeams': '全部俱樂部',
  // Activity Page
  'activityPage.searchPlaceholder': '搜尋活動...',
  'activityPage.allTypes': '全部類型',
  'activityPage.manage': '管理',
  'activityPage.tabNormal': '報名中',
  'activityPage.tabEnded': '已結束',
  'activityPage.newEvent': '我要開團',
  // Profile Page
  'profilePage.notLoggedIn': '尚未登入',
  'profilePage.loginHint': '請先登入以查看個人資料',
  'profilePage.myInfo': '個人資訊',
  'profilePage.recordAll': '全部',
  'profilePage.recordRegistered': '已報名',
  'profilePage.recordCompleted': '已完成',
  'profilePage.recordCancelled': '已取消',
  // Drawer extras
  'drawer.personalData': '個人數據',
  'drawer.autoExpManage': '自動 EXP 管理',
  'drawer.backendManage': '後台管理',
  // Team Split
  'common.person': '人',
  'teamSplit.select.title': '選擇你的隊伍',
  'teamSplit.select.required': '請先選擇隊伍',
  'teamSplit.batch.random': '隨機',
  'teamSplit.batch.fill': '補齊',
  'teamSplit.batch.reset': '重置',
  'teamSplit.batch.confirmRandom': '重新分隊不會通知參加者，確認繼續？',
  'teamSplit.batch.confirmReset': '確定清除所有隊伍分配？',
});

// ─── English ───
I18N.register('en', {
  _label: '🇺🇸 EN',
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
  'activity.noActive': 'No active activities',
  'activity.noMatch': 'No matching activities',
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
  'team.leave': 'Leave Team',
  'team.members': 'Members',
  'team.captain': 'Captain',
  'team.coach': 'Coach',
  'team.create': 'Create Team',
  'team.info': 'Team Info',
  'team.record': 'Record',
  'team.rank': 'Ranking',
  'team.memberLabel': 'Member',
  'team.regionLabel': 'Region',
  'team.personUnit': '',
  'team.noMatch': 'No teams found',
  // Tournament
  'tournament.register': 'Register',
  'tournament.regClosed': 'Registration Closed',
  'tournament.regFull': 'Registration Full',
  'tournament.schedule': 'Schedule',
  'tournament.detail': 'Details',
  'tournament.teams': 'Teams',
  'tournament.teamUnit': 'teams',
  'tournament.matchDay': 'Match Day',
  'tournament.regPeriod': 'Registration',
  'tournament.registered': 'Registered',
  'tournament.noActive': 'No recent tournaments',
  'tournament.noEnded': 'No ended tournaments',
  'tournament.status.preparing': 'Coming Soon',
  'tournament.status.regOpen': 'Registration Open',
  'tournament.status.regClosed': 'Registration Closed',
  'tournament.status.ended': 'Ended',
  'tournament.createTitle': 'Create Tournament',
  'tournament.editTitle': 'Edit Tournament',
  'tournament.searchPlaceholder': 'Search tournament name...',
  'tournament.allRegions': 'All Regions',
  'tournament.tabOngoing': 'Ongoing',
  'tournament.tabEnded': 'Ended',
  'tournament.tabInfo': 'Info',
  'tournament.tabTeams': 'Teams',
  'tournament.tabSchedule': 'Schedule',
  'tournament.tabStats': 'Stats',
  'tournament.comingSoon': 'Coming Soon',
  'tournament.noDescription': 'No description',
  'tournament.noTeams': 'No teams registered',
  'tournament.contactHost': 'Contact Host',
  'tournament.waitingReview': 'Awaiting Review',
  'tournament.notYetOpen': 'Not Yet Open',
  'tournament.noSchedule': 'No schedule yet',
  'tournament.matchDays': 'Match Days',
  'tournament.matchResults': 'Match Results',
  'tournament.noStats': 'No statistics yet',
  'tournament.statsSummary': 'Tournament Overview',
  'tournament.approvedTeams': 'Approved Teams',
  'tournament.pendingTeams': 'Pending',
  'tournament.totalPlayers': 'Total Players',
  // Favorites
  'fav.sortTime': 'By Time',
  'fav.sortStatus': 'By Status',
  'fav.sortName': 'By Name',
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
  'drawer.manual': 'User Manual',
  'drawer.share': 'Share',
  'drawer.activityManage': 'Activity Mgmt',
  'drawer.tournamentManage': 'Tournament Mgmt',
  'drawer.scan': 'Scan Check-in',
  'admin.dashboard': 'Dashboard',
  'admin.seo': 'SEO Dashboard',
  'admin.userManage': 'Users',
  'admin.adManage': 'Ad Management',
  'admin.shopManage': 'Shop Mgmt',
  'admin.messageManage': 'Messages',
  'admin.teamManage': 'Team Mgmt',
  'admin.themes': 'Themes',
  'admin.expManage': 'EXP Mgmt',
  'admin.announcements': 'Announcements',
  'admin.achievements': 'Achievements',
  'admin.roles': 'Permission Mgmt',
  'admin.inactive': 'Inactive Data',
  'admin.logs': 'Log Center',
  'admin.auditLogs': 'Audit Logs',
  'admin.errorLogs': 'Error Logs',
  'admin.repair': 'User Corrections',
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
  // Team Detail
  'teamDetail.info': 'Team Info',
  'teamDetail.captain': 'Captain',
  'teamDetail.coach': 'Coach',
  'teamDetail.memberCount': 'Members',
  'teamDetail.region': 'Region',
  'teamDetail.nationality': 'Nationality',
  'teamDetail.founded': 'Founded',
  'teamDetail.contact': 'Contact',
  'teamDetail.bio': 'About',
  'teamDetail.record': 'Team Record',
  'teamDetail.wins': 'W',
  'teamDetail.draws': 'D',
  'teamDetail.losses': 'L',
  'teamDetail.winRate': 'Win%',
  'teamDetail.goalsFor': 'GF',
  'teamDetail.goalsAgainst': 'GA',
  'teamDetail.goalDiff': 'GD',
  'teamDetail.totalGames': 'GP',
  'teamDetail.matchHistory': 'Match History',
  'teamDetail.noHistory': 'No match history',
  'teamDetail.memberList': 'Members',
  'teamDetail.feed': 'Team Feed',
  'teamDetail.noFeed': 'No posts yet',
  'teamDetail.publish': 'Post',
  'teamDetail.publishing': 'Posting...',
  'teamDetail.public': 'Public',
  'teamDetail.privateOnly': 'Team Only',
  'teamDetail.pinPost': 'Pin',
  'teamDetail.unpinPost': 'Unpin',
  'teamDetail.pinned': 'Pinned',
  'teamDetail.leaveTeam': 'Leave Team',
  'teamDetail.contactCaptain': 'Contact Captain',
  'teamDetail.applyJoin': 'Apply to Join',
  'teamDetail.inviteQR': 'Invite QR Code',
  'teamDetail.memberCanInvite': 'Members can invite',
  'teamDetail.notSet': 'Not set',
  'teamDetail.none': 'None',
  'teamDetail.personUnit': '',
  'teamDetail.delete': 'Delete',
  'teamDetail.prevPage': 'Prev',
  'teamDetail.nextPage': 'Next',
  'teamDetail.postPlaceholder': 'Share with teammates... (max 200 chars)',
  'teamDetail.commentPlaceholder': 'Comment...',
  'teamDetail.commentSubmit': 'Send',
  // Team Page
  'teamPage.searchPlaceholder': 'Search teams...',
  'teamPage.allRegions': 'All Regions',
  'teamPage.manage': 'Manage',
  'teamPage.myTeams': 'My Teams',
  'teamPage.allTeams': 'All Teams',
  // Activity Page
  'activityPage.searchPlaceholder': 'Search activities...',
  'activityPage.allTypes': 'All Types',
  'activityPage.manage': 'Manage',
  'activityPage.tabNormal': 'Active',
  'activityPage.tabEnded': 'Ended',
  'activityPage.newEvent': 'New Event',
  // Profile Page
  'profilePage.notLoggedIn': 'Not logged in',
  'profilePage.loginHint': 'Please log in to view your profile',
  'profilePage.myInfo': 'My Info',
  'profilePage.recordAll': 'All',
  'profilePage.recordRegistered': 'Registered',
  'profilePage.recordCompleted': 'Completed',
  'profilePage.recordCancelled': 'Cancelled',
  // Drawer extras
  'drawer.personalData': 'Personal Stats',
  'drawer.autoExpManage': 'Auto EXP Mgmt',
  'drawer.backendManage': 'Admin Panel',
  // Team Split
  'common.person': '',
  'teamSplit.select.title': 'Choose your team',
  'teamSplit.select.required': 'Please select a team first',
  'teamSplit.batch.random': 'Shuffle',
  'teamSplit.batch.fill': 'Fill',
  'teamSplit.batch.reset': 'Reset',
  'teamSplit.batch.confirmRandom': 'Reshuffle won\'t notify participants. Continue?',
  'teamSplit.batch.confirmReset': 'Clear all team assignments?',
});

// ─── Japanese ───
I18N.register('ja', {
  _label: '🇯🇵 日本語',
  // Navigation
  'nav.home': 'ホーム',
  'nav.activities': 'イベント',
  'nav.teams': 'チーム',
  'nav.tournaments': '大会',
  'nav.profile': 'マイページ',
  // Common
  'common.save': '保存',
  'common.cancel': 'キャンセル',
  'common.edit': '編集',
  'common.delete': '削除',
  'common.confirm': '確認',
  'common.back': '戻る',
  'common.search': '検索',
  'common.loading': '読み込み中...',
  'common.noData': 'データなし',
  'common.close': '閉じる',
  'common.submit': '送信',
  'common.create': '作成',
  'common.all': 'すべて',
  // Profile
  'profile.myProfile': 'プロフィール',
  'profile.achievements': '実績',
  'profile.titles': '称号',
  'profile.favorites': 'お気に入り',
  'profile.activityRecords': '参加履歴',
  'profile.level': 'Lv.{level}',
  'profile.gender': '性別',
  'profile.birthday': '生年月日',
  'profile.region': '地域',
  'profile.sports': 'スポーツ',
  'profile.team': '所属チーム',
  'profile.phone': '連絡先',
  'profile.joinDate': '参加日',
  'profile.totalGames': '参加回数',
  'profile.completed': '完了',
  'profile.attendanceRate': '出席率',
  'profile.badges': 'バッジ',
  'profile.qrCode': 'QRコード',
  'profile.inventory': 'アイテム',
  'profile.lineNotify': 'LINE通知',
  'profile.applications': 'チーム申請',
  // Activity
  'activity.register': '申込む',
  'activity.cancel': '申込取消',
  'activity.full': '満員',
  'activity.ended': '終了',
  'activity.upcoming': '近日開始',
  'activity.waitlist': 'キャンセル待ち',
  'activity.participants': '人',
  'activity.fee': '参加費',
  'activity.location': '場所',
  'activity.time': '時間',
  'activity.organizer': '主催者',
  'activity.free': '無料',
  'activity.noActive': '開催中のイベントはありません',
  'activity.noMatch': '条件に一致するイベントはありません',
  // Status
  'status.open': '募集中',
  'status.full': '満員',
  'status.ended': '終了',
  'status.upcoming': '近日開始',
  'status.cancelled': 'キャンセル',
  'status.registered': '申込済',
  'status.completed': '完了',
  // Team
  'team.join': '参加申請',
  'team.leave': 'チーム退会',
  'team.members': 'メンバー',
  'team.captain': 'キャプテン',
  'team.coach': 'コーチ',
  'team.create': 'チーム作成',
  'team.info': 'チーム情報',
  'team.record': '戦績',
  'team.rank': 'ランキング',
  'team.memberLabel': 'メンバー',
  'team.regionLabel': '地域',
  'team.personUnit': '人',
  'team.noMatch': 'チームが見つかりません',
  // Tournament
  'tournament.register': '大会に申込む',
  'tournament.regClosed': '受付終了',
  'tournament.regFull': '定員到達',
  'tournament.schedule': '日程',
  'tournament.detail': '大会詳細',
  'tournament.teams': '参加チーム',
  'tournament.teamUnit': 'チーム',
  'tournament.matchDay': '試合日',
  'tournament.regPeriod': '受付期間',
  'tournament.registered': '参加済',
  'tournament.noActive': '最近の大会はありません',
  'tournament.noEnded': '終了した大会はありません',
  'tournament.status.preparing': '近日開催',
  'tournament.status.regOpen': '募集中',
  'tournament.status.regClosed': '受付終了',
  'tournament.status.ended': '終了',
  'tournament.createTitle': '大会作成',
  'tournament.editTitle': '大会編集',
  'tournament.searchPlaceholder': '大会名を検索...',
  'tournament.allRegions': 'すべての地域',
  'tournament.tabOngoing': '進行中',
  'tournament.tabEnded': '終了',
  'tournament.tabInfo': '説明',
  'tournament.tabTeams': 'チーム',
  'tournament.tabSchedule': '日程',
  'tournament.tabStats': '統計',
  'tournament.comingSoon': '近日公開',
  'tournament.noDescription': '説明なし',
  'tournament.noTeams': '参加チームなし',
  'tournament.contactHost': '主催者に連絡',
  'tournament.waitingReview': '審査待ち',
  'tournament.notYetOpen': '受付前',
  'tournament.noSchedule': '日程未定',
  'tournament.matchDays': '試合日程',
  'tournament.matchResults': '試合結果',
  'tournament.noStats': '統計データなし',
  'tournament.statsSummary': '大会概要',
  'tournament.approvedTeams': '承認チーム',
  'tournament.pendingTeams': '審査中',
  'tournament.totalPlayers': '総選手数',
  // Favorites
  'fav.sortTime': '日時順',
  'fav.sortStatus': 'ステータス順',
  'fav.sortName': '名前順',
  // Toast messages
  'toast.saved': '保存しました',
  'toast.deleted': '削除しました',
  'toast.copied': 'コピーしました',
  'toast.favoriteAdded': 'お気に入りに追加',
  'toast.favoriteRemoved': 'お気に入り解除',
  'toast.langChanged': '言語を変更しました',
  // Drawer / Admin
  'drawer.darkMode': 'ダークモード',
  'drawer.language': '言語',
  'drawer.shop': 'ショップ',
  'drawer.leaderboard': 'ランキング',
  'drawer.manual': '使い方ガイド',
  'drawer.share': '共有',
  'drawer.activityManage': 'イベント管理',
  'drawer.tournamentManage': '大会管理',
  'drawer.scan': 'QRスキャン',
  'admin.dashboard': 'ダッシュボード',
  'admin.seo': 'SEO ダッシュボード',
  'admin.userManage': 'ユーザー管理',
  'admin.adManage': '広告管理',
  'admin.shopManage': 'ショップ管理',
  'admin.messageManage': 'メッセージ管理',
  'admin.teamManage': 'チーム管理',
  'admin.themes': 'テーマ',
  'admin.expManage': 'EXP管理',
  'admin.announcements': 'お知らせ管理',
  'admin.achievements': '実績管理',
  'admin.roles': '権限管理',
  'admin.inactive': '無効データ',
  'admin.logs': 'ログセンター',
  'admin.auditLogs': '監査ログ',
  'admin.errorLogs': 'エラーログ',
  'admin.repair': 'ユーザー補正管理',
  // Dashboard
  'dash.totalUsers': 'ユーザー数',
  'dash.totalEvents': 'イベント数',
  'dash.activeTeams': 'チーム数',
  'dash.ongoingTourn': '開催中大会',
  'dash.openEvents': '募集中',
  'dash.endedEvents': '終了済',
  'dash.totalRecords': '申込件数',
  'dash.attendRate': '出席率',
  'dash.typeDistribution': 'イベント種別分布',
  'dash.regionDistribution': '地域分布',
  'dash.monthlyTrend': '月別トレンド',
  'dash.teamRanking': 'チームランキング Top 5',
  // Team Detail
  'teamDetail.info': 'チーム情報',
  'teamDetail.captain': 'キャプテン',
  'teamDetail.coach': 'コーチ',
  'teamDetail.memberCount': 'メンバー数',
  'teamDetail.region': '地域',
  'teamDetail.nationality': '国籍',
  'teamDetail.founded': '設立日',
  'teamDetail.contact': '連絡先',
  'teamDetail.bio': '紹介',
  'teamDetail.record': 'チーム戦績',
  'teamDetail.wins': '勝',
  'teamDetail.draws': '分',
  'teamDetail.losses': '負',
  'teamDetail.winRate': '勝率',
  'teamDetail.goalsFor': '得点',
  'teamDetail.goalsAgainst': '失点',
  'teamDetail.goalDiff': '得失点差',
  'teamDetail.totalGames': '試合数',
  'teamDetail.matchHistory': '試合記録',
  'teamDetail.noHistory': '試合記録なし',
  'teamDetail.memberList': 'メンバー一覧',
  'teamDetail.feed': 'チーム投稿',
  'teamDetail.noFeed': '投稿はまだありません',
  'teamDetail.publish': '投稿',
  'teamDetail.publishing': '投稿中...',
  'teamDetail.public': '公開',
  'teamDetail.privateOnly': 'チーム内のみ',
  'teamDetail.pinPost': 'ピン留め',
  'teamDetail.unpinPost': 'ピン解除',
  'teamDetail.pinned': 'ピン留め',
  'teamDetail.leaveTeam': 'チーム退会',
  'teamDetail.contactCaptain': 'キャプテンに連絡',
  'teamDetail.applyJoin': '参加申請',
  'teamDetail.inviteQR': '招待QRコード',
  'teamDetail.memberCanInvite': 'メンバー招待可',
  'teamDetail.notSet': '未設定',
  'teamDetail.none': 'なし',
  'teamDetail.personUnit': '人',
  'teamDetail.delete': '削除',
  'teamDetail.prevPage': '前へ',
  'teamDetail.nextPage': '次へ',
  'teamDetail.postPlaceholder': 'チームメイトに共有...（最大200文字）',
  'teamDetail.commentPlaceholder': 'コメント...',
  'teamDetail.commentSubmit': '送信',
  // Team Page
  'teamPage.searchPlaceholder': 'チームを検索...',
  'teamPage.allRegions': '全地域',
  'teamPage.manage': '管理',
  'teamPage.myTeams': 'マイチーム',
  'teamPage.allTeams': '全チーム',
  // Activity Page
  'activityPage.searchPlaceholder': 'イベントを検索...',
  'activityPage.allTypes': '全種別',
  'activityPage.manage': '管理',
  'activityPage.tabNormal': '開催中',
  'activityPage.tabEnded': '終了',
  'activityPage.newEvent': '新規作成',
  // Profile Page
  'profilePage.notLoggedIn': '未ログイン',
  'profilePage.loginHint': 'ログインしてプロフィールを表示',
  'profilePage.myInfo': '個人情報',
  'profilePage.recordAll': 'すべて',
  'profilePage.recordRegistered': '申込済',
  'profilePage.recordCompleted': '完了',
  'profilePage.recordCancelled': 'キャンセル',
  // Drawer extras
  'drawer.personalData': '個人データ',
  'drawer.autoExpManage': '自動EXP管理',
  'drawer.backendManage': '管理パネル',
  // Team Split
  'common.person': '人',
  'teamSplit.select.title': 'チームを選択',
  'teamSplit.select.required': '先にチームを選んでください',
  'teamSplit.batch.random': 'シャッフル',
  'teamSplit.batch.fill': '補充',
  'teamSplit.batch.reset': 'リセット',
  'teamSplit.batch.confirmRandom': 'チームを再分配します。参加者には通知されません。続行しますか？',
  'teamSplit.batch.confirmReset': 'すべてのチーム分配をクリアしますか？',
});

// Auto-generated locale pack (ko)
I18N.register('ko', {
  _label: "\uD83C\uDDF0\uD83C\uDDF7 \uD55C\uAD6D\uC5B4",
  "nav.home": "집",
  "nav.activities": "활동",
  "nav.teams": "팀",
  "nav.tournaments": "토너먼트",
  "nav.profile": "프로필",
  "common.save": "저장",
  "common.cancel": "취소",
  "common.edit": "수정",
  "common.delete": "삭제",
  "common.confirm": "확인",
  "common.back": "뒤로",
  "common.search": "검색",
  "common.loading": "로드 중...",
  "common.noData": "데이터 없음",
  "common.close": "닫기",
  "common.submit": "제출",
  "common.create": "생성",
  "common.all": "모두",
  "profile.myProfile": "내 프로필",
  "profile.achievements": "업적",
  "profile.titles": "제목",
  "profile.favorites": "즐겨찾기",
  "profile.activityRecords": "활동 기록",
  "profile.level": "Lv.{level}",
  "profile.gender": "성별",
  "profile.birthday": "생일",
  "profile.region": "지역",
  "profile.sports": "스포츠",
  "profile.team": "팀",
  "profile.phone": "핸드폰",
  "profile.joinDate": "가입됨",
  "profile.totalGames": "계략",
  "profile.completed": "완료",
  "profile.attendanceRate": "비율",
  "profile.badges": "배지",
  "profile.qrCode": "내 QR 코드",
  "profile.inventory": "목록",
  "profile.lineNotify": "LINE 알림",
  "profile.applications": "내 애플리케이션",
  "activity.register": "등록하다",
  "activity.cancel": "등록 취소",
  "activity.full": "가득한",
  "activity.ended": "종료됨",
  "activity.upcoming": "출시 예정",
  "activity.waitlist": "대기자 명단",
  "activity.participants": "사람들",
  "activity.fee": "요금",
  "activity.location": "위치",
  "activity.time": "시간",
  "activity.organizer": "조직자",
  "activity.free": "무료",
  "activity.noActive": "활동적인 활동 없음",
  "activity.noMatch": "일치하는 활동 없음",
  "status.open": "열려 있는",
  "status.full": "가득한",
  "status.ended": "종료됨",
  "status.upcoming": "출시 예정",
  "status.cancelled": "취소",
  "status.registered": "등기",
  "status.completed": "완전한",
  "team.join": "적용하다",
  "team.leave": "팀 탈퇴",
  "team.members": "회원",
  "team.captain": "선장",
  "team.coach": "코치",
  "team.create": "팀 만들기",
  "team.info": "팀 정보",
  "team.record": "기록",
  "team.rank": "순위",
  "team.memberLabel": "회원",
  "team.regionLabel": "지역",
  "team.personUnit": "",
  "team.noMatch": "팀을 찾을 수 없습니다.",
  "tournament.register": "등록하다",
  "tournament.regClosed": "등록이 마감되었습니다",
  "tournament.regFull": "등록이 가득 찼습니다",
  "tournament.schedule": "일정",
  "tournament.detail": "세부",
  "tournament.teams": "팀",
  "tournament.teamUnit": "팀",
  "tournament.matchDay": "경기일",
  "tournament.regPeriod": "등록",
  "tournament.registered": "등기",
  "tournament.noActive": "최근 토너먼트 없음",
  "tournament.noEnded": "종료된 토너먼트 없음",
  "tournament.status.preparing": "곧 시작",
  "tournament.status.regOpen": "접수 중",
  "tournament.status.regClosed": "접수 마감",
  "tournament.status.ended": "종료",
  "tournament.createTitle": "대회 만들기",
  "tournament.editTitle": "대회 편집",
  "tournament.searchPlaceholder": "대회 이름 검색...",
  "tournament.allRegions": "모든 지역",
  "tournament.tabOngoing": "진행 중",
  "tournament.tabEnded": "종료",
  "tournament.tabInfo": "정보",
  "tournament.tabTeams": "팀",
  "tournament.tabSchedule": "일정",
  "tournament.tabStats": "통계",
  "tournament.comingSoon": "곧 출시",
  "tournament.noDescription": "설명 없음",
  "tournament.noTeams": "등록된 팀 없음",
  "tournament.contactHost": "주최자 연락",
  "tournament.waitingReview": "심사 대기 중",
  "tournament.notYetOpen": "아직 열리지 않음",
  "tournament.noSchedule": "일정 미정",
  "tournament.matchDays": "경기 일정",
  "tournament.matchResults": "경기 결과",
  "tournament.noStats": "통계 없음",
  "tournament.statsSummary": "대회 개요",
  "tournament.approvedTeams": "승인된 팀",
  "tournament.pendingTeams": "심사 중",
  "tournament.totalPlayers": "총 선수",
  "fav.sortTime": "시간별",
  "fav.sortStatus": "상태별",
  "fav.sortName": "이름별",
  "toast.saved": "저장됨",
  "toast.deleted": "삭제됨",
  "toast.copied": "복사됨",
  "toast.favoriteAdded": "즐겨찾기에 추가됨",
  "toast.favoriteRemoved": "즐겨찾기에서 삭제됨",
  "toast.langChanged": "언어가 변경됨",
  "drawer.darkMode": "다크 모드",
  "drawer.language": "언어",
  "drawer.shop": "가게",
  "drawer.leaderboard": "리더보드",
  "drawer.manual": "사용 설명서",
  "drawer.share": "공유하다",
  "drawer.activityManage": "활동 관리",
  "drawer.tournamentManage": "토너먼트 관리",
  "drawer.scan": "스캔 체크인",
  "admin.dashboard": "대시보드",
  "admin.seo": "SEO 대시보드",
  "admin.userManage": "사용자",
  "admin.adManage": "광고 관리",
  "admin.shopManage": "쇼핑 관리",
  "admin.messageManage": "메시지",
  "admin.teamManage": "팀 관리",
  "admin.themes": "테마",
  "admin.expManage": "EXP 관리",
  "admin.announcements": "공지사항",
  "admin.achievements": "업적",
  "admin.roles": "권한 관리",
  "admin.inactive": "비활성 데이터",
  "admin.logs": "로그 센터",
  "admin.auditLogs": "감사 로그",
  "admin.errorLogs": "오류 로그",
  "admin.repair": "사용자 보정 관리",
  "dash.totalUsers": "사용자",
  "dash.totalEvents": "이벤트",
  "dash.activeTeams": "활성 팀",
  "dash.ongoingTourn": "토너먼트",
  "dash.openEvents": "공개 이벤트",
  "dash.endedEvents": "종료된 이벤트",
  "dash.totalRecords": "기록",
  "dash.attendRate": "출석",
  "dash.typeDistribution": "이벤트 유형 분포",
  "dash.regionDistribution": "지역 분포",
  "dash.monthlyTrend": "월별 추세",
  "dash.teamRanking": "팀 순위 상위 5위",
  "teamDetail.info": "팀 정보",
  "teamDetail.captain": "주장",
  "teamDetail.coach": "코치",
  "teamDetail.memberCount": "멤버",
  "teamDetail.region": "지역",
  "teamDetail.nationality": "국적",
  "teamDetail.founded": "창립",
  "teamDetail.contact": "연락처",
  "teamDetail.bio": "정보",
  "teamDetail.record": "팀 기록",
  "teamDetail.wins": "W",
  "teamDetail.draws": "D",
  "teamDetail.losses": "L",
  "teamDetail.winRate": "승%",
  "teamDetail.goalsFor": "GF",
  "teamDetail.goalsAgainst": "GA",
  "teamDetail.goalDiff": "GD",
  "teamDetail.totalGames": "GP",
  "teamDetail.matchHistory": "경기 기록",
  "teamDetail.noHistory": "경기 없음 기록",
  "teamDetail.memberList": "멤버",
  "teamDetail.feed": "팀 피드",
  "teamDetail.noFeed": "아직 게시물 없음",
  "teamDetail.publish": "게시물",
  "teamDetail.publishing": "게시 중...",
  "teamDetail.public": "공개",
  "teamDetail.privateOnly": "팀 만",
  "teamDetail.pinPost": "고정",
  "teamDetail.unpinPost": "고정 해제",
  "teamDetail.pinned": "고정됨",
  "teamDetail.leaveTeam": "팀 탈퇴",
  "teamDetail.contactCaptain": "캡틴에게 문의",
  "teamDetail.applyJoin": "가입 신청",
  "teamDetail.inviteQR": "QR 코드 초대",
  "teamDetail.memberCanInvite": "회원은 다음을 수행할 수 있습니다. 초대",
  "teamDetail.notSet": "설정되지 않음",
  "teamDetail.none": "없음",
  "teamDetail.personUnit": "",
  "teamDetail.delete": "삭제",
  "teamDetail.prevPage": "이전",
  "teamDetail.nextPage": "다음",
  "teamDetail.postPlaceholder": "팀원과 공유... (최대 200개) chars)",
  "teamDetail.commentPlaceholder": "댓글...",
  "teamDetail.commentSubmit": "보내기",
  "teamPage.searchPlaceholder": "팀 검색...",
  "teamPage.allRegions": "모든 지역",
  "teamPage.manage": "관리",
  "teamPage.myTeams": "내 팀",
  "teamPage.allTeams": "모든 팀",
  "activityPage.searchPlaceholder": "검색 활동...",
  "activityPage.allTypes": "모두 유형",
  "activityPage.manage": "관리",
  "activityPage.tabNormal": "활성",
  "activityPage.tabEnded": "종료됨",
  "activityPage.newEvent": "새 이벤트",
  "profilePage.notLoggedIn": "로그인되지 않음",
  "profilePage.loginHint": "프로필을 보려면 로그인하세요.",
  "profilePage.myInfo": "내 정보",
  "profilePage.recordAll": "모두",
  "profilePage.recordRegistered": "등록됨",
  "profilePage.recordCompleted": "완료됨",
  "profilePage.recordCancelled": "취소됨",
  "drawer.personalData": "개인 통계",
  "drawer.autoExpManage": "자동 EXP 관리",
  "drawer.backendManage": "관리자 패널",
  "common.person": "명",
  "teamSplit.select.title": "팀을 선택하세요 👕",
  "teamSplit.select.required": "먼저 팀을 선택해주세요",
  "teamSplit.batch.random": "셔플",
  "teamSplit.batch.fill": "채우기",
  "teamSplit.batch.reset": "초기화",
  "teamSplit.batch.confirmRandom": "팀을 다시 배정합니다. 참가자에게 알림이 가지 않습니다. 계속하시겠습니까?",
  "teamSplit.batch.confirmReset": "모든 팀 배정을 초기화하시겠습니까?"
});

I18N.register('th', {
  _label: "\uD83C\uDDF9\uD83C\uDDED \u0E44\u0E17\u0E22",
  "nav.home": "บ้าน",
  "nav.activities": "กิจกรรม",
  "nav.teams": "ทีม",
  "nav.tournaments": "ทัวร์นาเมนต์",
  "nav.profile": "ประวัติโดยย่อ",
  "common.save": "บันทึก",
  "common.cancel": "ยกเลิก",
  "common.edit": "แก้ไข",
  "common.delete": "ลบ",
  "common.confirm": "ยืนยัน",
  "common.back": "กลับ",
  "common.search": "ค้นหา",
  "common.loading": "กำลังโหลด...",
  "common.noData": "ไม่มีข้อมูล",
  "common.close": "ปิด",
  "common.submit": "ส่ง",
  "common.create": "สร้าง",
  "common.all": "ทั้งหมด",
  "profile.myProfile": "โปรไฟล์ของฉัน",
  "profile.achievements": "ความสำเร็จ",
  "profile.titles": "ชื่อเรื่อง",
  "profile.favorites": "รายการโปรด",
  "profile.activityRecords": "บันทึกกิจกรรม",
  "profile.level": "เลเวล{level}",
  "profile.gender": "เพศ",
  "profile.birthday": "วันเกิด",
  "profile.region": "ภูมิภาค",
  "profile.sports": "กีฬา",
  "profile.team": "ทีม",
  "profile.phone": "โทรศัพท์",
  "profile.joinDate": "เข้าร่วม",
  "profile.totalGames": "เกมส์",
  "profile.completed": "เสร็จแล้ว",
  "profile.attendanceRate": "ประเมิน",
  "profile.badges": "ป้าย",
  "profile.qrCode": "รหัส QR ของฉัน",
  "profile.inventory": "รายการสิ่งของ",
  "profile.lineNotify": "การแจ้งเตือนของไลน์",
  "profile.applications": "แอปพลิเคชันของฉัน",
  "activity.register": "ลงทะเบียน",
  "activity.cancel": "ยกเลิกการลงทะเบียน",
  "activity.full": "เต็ม",
  "activity.ended": "สิ้นสุดแล้ว",
  "activity.upcoming": "เร็วๆ นี้",
  "activity.waitlist": "รายชื่อผู้รอ",
  "activity.participants": "คน",
  "activity.fee": "ค่าธรรมเนียม",
  "activity.location": "ที่ตั้ง",
  "activity.time": "เวลา",
  "activity.organizer": "ออแกไนเซอร์",
  "activity.free": "ฟรี",
  "activity.noActive": "ไม่มีกิจกรรมที่ใช้งานอยู่",
  "activity.noMatch": "ไม่มีกิจกรรมที่ตรงกัน",
  "status.open": "เปิด",
  "status.full": "เต็ม",
  "status.ended": "สิ้นสุดแล้ว",
  "status.upcoming": "เร็วๆ นี้",
  "status.cancelled": "ยกเลิก",
  "status.registered": "ลงทะเบียนแล้ว",
  "status.completed": "สมบูรณ์",
  "team.join": "นำมาใช้",
  "team.leave": "ออกจากทีม",
  "team.members": "สมาชิก",
  "team.captain": "กัปตัน",
  "team.coach": "โค้ช",
  "team.create": "สร้างทีม",
  "team.info": "ข้อมูลทีม",
  "team.record": "บันทึก",
  "team.rank": "การจัดอันดับ",
  "team.memberLabel": "สมาชิก",
  "team.regionLabel": "ภูมิภาค",
  "team.personUnit": "",
  "team.noMatch": "ไม่พบทีม",
  "tournament.register": "ลงทะเบียน",
  "tournament.regClosed": "ปิดรับสมัครแล้ว",
  "tournament.regFull": "ทะเบียนเต็ม",
  "tournament.schedule": "กำหนดการ",
  "tournament.detail": "รายละเอียด",
  "tournament.teams": "ทีม",
  "tournament.teamUnit": "ทีม",
  "tournament.matchDay": "วันแข่งขัน",
  "tournament.regPeriod": "การลงทะเบียน",
  "tournament.registered": "ลงทะเบียนแล้ว",
  "tournament.noActive": "ไม่มีการแข่งขันล่าสุด",
  "tournament.noEnded": "ไม่มีการแข่งขันที่สิ้นสุด",
  "tournament.status.preparing": "เร็วๆ นี้",
  "tournament.status.regOpen": "เปิดรับสมัคร",
  "tournament.status.regClosed": "ปิดรับสมัครแล้ว",
  "tournament.status.ended": "สิ้นสุดแล้ว",
  "tournament.createTitle": "สร้างทัวร์นาเมนต์",
  "tournament.editTitle": "แก้ไขทัวร์นาเมนต์",
  "tournament.searchPlaceholder": "ค้นหาชื่อทัวร์นาเมนต์...",
  "tournament.allRegions": "ทุกภูมิภาค",
  "tournament.tabOngoing": "กำลังดำเนินการ",
  "tournament.tabEnded": "สิ้นสุด",
  "tournament.tabInfo": "ข้อมูล",
  "tournament.tabTeams": "ทีม",
  "tournament.tabSchedule": "กำหนดการ",
  "tournament.tabStats": "สถิติ",
  "tournament.comingSoon": "เร็วๆ นี้",
  "tournament.noDescription": "ไม่มีคำอธิบาย",
  "tournament.noTeams": "ไม่มีทีมลงทะเบียน",
  "tournament.contactHost": "ติดต่อผู้จัด",
  "tournament.waitingReview": "รอการตรวจสอบ",
  "tournament.notYetOpen": "ยังไม่เปิด",
  "tournament.noSchedule": "ยังไม่มีกำหนดการ",
  "tournament.matchDays": "วันแข่งขัน",
  "tournament.matchResults": "ผลการแข่งขัน",
  "tournament.noStats": "ยังไม่มีสถิติ",
  "tournament.statsSummary": "ภาพรวมการแข่งขัน",
  "tournament.approvedTeams": "ทีมที่อนุมัติ",
  "tournament.pendingTeams": "รอดำเนินการ",
  "tournament.totalPlayers": "ผู้เล่นทั้งหมด",
  "fav.sortTime": "ตามเวลา",
  "fav.sortStatus": "ตามสถานะ",
  "fav.sortName": "โดยชื่อ",
  "toast.saved": "บันทึกแล้ว",
  "toast.deleted": "ลบแล้ว",
  "toast.copied": "คัดลอกแล้ว",
  "toast.favoriteAdded": "เพิ่มในรายการโปรดแล้ว",
  "toast.favoriteRemoved": "ลบออกจากรายการโปรดแล้ว",
  "toast.langChanged": "ภาษามีการเปลี่ยนแปลง",
  "drawer.darkMode": "โหมดมืด",
  "drawer.language": "ภาษา",
  "drawer.shop": "ร้านค้า",
  "drawer.leaderboard": "ลีดเดอร์บอร์ด",
  "drawer.manual": "คู่มือการใช้งาน",
  "drawer.share": "แบ่งปัน",
  "drawer.activityManage": "การบริหารจัดการกิจกรรม",
  "drawer.tournamentManage": "การจัดการทัวร์นาเมนต์",
  "drawer.scan": "สแกนการเช็คอิน",
  "admin.dashboard": "แดชบอร์ด",
  "admin.seo": "SEO แดชบอร์ด",
  "admin.userManage": "ผู้ใช้",
  "admin.adManage": "การจัดการโฆษณา",
  "admin.shopManage": "การจัดการร้านค้า",
  "admin.messageManage": "ข้อความ",
  "admin.teamManage": "การจัดการทีม",
  "admin.themes": "ธีม",
  "admin.expManage": "EXP การจัดการ",
  "admin.announcements": "ประกาศ",
  "admin.achievements": "ความสำเร็จ",
  "admin.roles": "การจัดการสิทธิ์",
  "admin.inactive": "ข้อมูลที่ไม่ใช้งาน",
  "admin.logs": "ศูนย์บันทึก",
  "admin.auditLogs": "บันทึกการตรวจสอบ",
  "admin.errorLogs": "บันทึกข้อผิดพลาด",
  "admin.repair": "การจัดการแก้ไขผู้ใช้",
  "dash.totalUsers": "ผู้ใช้",
  "dash.totalEvents": "กิจกรรม",
  "dash.activeTeams": "ทีมที่ใช้งานอยู่",
  "dash.ongoingTourn": "ทัวร์นาเมนต์",
  "dash.openEvents": "กิจกรรมที่เปิด",
  "dash.endedEvents": "กิจกรรมที่สิ้นสุด",
  "dash.totalRecords": "บันทึก",
  "dash.attendRate": "การเข้าร่วม",
  "dash.typeDistribution": "กิจกรรม ประเภทการกระจาย",
  "dash.regionDistribution": "การกระจายภูมิภาค",
  "dash.monthlyTrend": "แนวโน้มรายเดือน",
  "dash.teamRanking": "อันดับทีม 5 อันดับแรก",
  "teamDetail.info": "ทีม ข้อมูล",
  "teamDetail.captain": "กัปตัน",
  "teamDetail.coach": "โค้ช",
  "teamDetail.memberCount": "สมาชิก",
  "teamDetail.region": "ภูมิภาค",
  "teamDetail.nationality": "สัญชาติ",
  "teamDetail.founded": "ก่อตั้ง",
  "teamDetail.contact": "ติดต่อ",
  "teamDetail.bio": "เกี่ยวกับ",
  "teamDetail.record": "ทีม บันทึก",
  "teamDetail.wins": "W",
  "teamDetail.draws": "D",
  "teamDetail.losses": "L",
  "teamDetail.winRate": "ชนะ%",
  "teamDetail.goalsFor": "GF",
  "teamDetail.goalsAgainst": "GA",
  "teamDetail.goalDiff": "GD",
  "teamDetail.totalGames": "GP",
  "teamDetail.matchHistory": "ประวัติการแข่งขัน",
  "teamDetail.noHistory": "ไม่มีการแข่งขัน ประวัติ",
  "teamDetail.memberList": "สมาชิก",
  "teamDetail.feed": "ฟีดของทีม",
  "teamDetail.noFeed": "ยังไม่มีโพสต์",
  "teamDetail.publish": "โพสต์",
  "teamDetail.publishing": "กำลังโพสต์...",
  "teamDetail.public": "สาธารณะ",
  "teamDetail.privateOnly": "ทีม เท่านั้น",
  "teamDetail.pinPost": "ปักหมุด",
  "teamDetail.unpinPost": "เลิกปักหมุด",
  "teamDetail.pinned": "ปักหมุดแล้ว",
  "teamDetail.leaveTeam": "ออกจากทีม",
  "teamDetail.contactCaptain": "ติดต่อกัปตัน",
  "teamDetail.applyJoin": "สมัครเพื่อเข้าร่วม",
  "teamDetail.inviteQR": "เชิญรหัส QR",
  "teamDetail.memberCanInvite": "สมาชิกสามารถเชิญได้",
  "teamDetail.notSet": "ไม่ใช่ set",
  "teamDetail.none": "ไม่มี",
  "teamDetail.personUnit": "",
  "teamDetail.delete": "ลบ",
  "teamDetail.prevPage": "ก่อนหน้า",
  "teamDetail.nextPage": "ถัดไป",
  "teamDetail.postPlaceholder": "แชร์กับเพื่อนร่วมทีม... (สูงสุด 200 ตัวอักษร)",
  "teamDetail.commentPlaceholder": "ความคิดเห็น...",
  "teamDetail.commentSubmit": "ส่ง",
  "teamPage.searchPlaceholder": "ค้นหาทีม...",
  "teamPage.allRegions": "ทุกภูมิภาค",
  "teamPage.manage": "จัดการ",
  "teamPage.myTeams": "ทีมของฉัน",
  "teamPage.allTeams": "ทุกทีม",
  "activityPage.searchPlaceholder": "ค้นหากิจกรรม...",
  "activityPage.allTypes": "ทั้งหมด ประเภท",
  "activityPage.manage": "จัดการ",
  "activityPage.tabNormal": "ใช้งานอยู่",
  "activityPage.tabEnded": "สิ้นสุด",
  "activityPage.newEvent": "กิจกรรมใหม่",
  "profilePage.notLoggedIn": "ไม่ได้เข้าสู่ระบบ",
  "profilePage.loginHint": "โปรดเข้าสู่ระบบเพื่อดูโปรไฟล์ของคุณ",
  "profilePage.myInfo": "ของฉัน ข้อมูล",
  "profilePage.recordAll": "ทั้งหมด",
  "profilePage.recordRegistered": "ลงทะเบียนแล้ว",
  "profilePage.recordCompleted": "เสร็จสมบูรณ์",
  "profilePage.recordCancelled": "ยกเลิกแล้ว",
  "drawer.personalData": "สถิติส่วนตัว",
  "drawer.autoExpManage": "การจัดการ EXP อัตโนมัติ",
  "drawer.backendManage": "แผงผู้ดูแลระบบ",
  "common.person": "คน",
  "teamSplit.select.title": "เลือกทีมของคุณ 👕",
  "teamSplit.select.required": "กรุณาเลือกทีมก่อน",
  "teamSplit.batch.random": "สุ่ม",
  "teamSplit.batch.fill": "เติม",
  "teamSplit.batch.reset": "รีเซ็ต",
  "teamSplit.batch.confirmRandom": "สลับทีมใหม่ ผู้เข้าร่วมจะไม่ได้รับการแจ้งเตือน ดำเนินการต่อ?",
  "teamSplit.batch.confirmReset": "ล้างการจัดทีมทั้งหมด?"
});

I18N.register('vi', {
  _label: "\uD83C\uDDFB\uD83C\uDDF3 Ti\u1EBFng Vi\u1EC7t",
  "nav.home": "Trang chủ",
  "nav.activities": "Hoạt động",
  "nav.teams": "Đội",
  "nav.tournaments": "Giải đấu",
  "nav.profile": "Hồ sơ",
  "common.save": "Lưu",
  "common.cancel": "Hủy",
  "common.edit": "Chỉnh sửa",
  "common.delete": "Xóa",
  "common.confirm": "Xác nhận",
  "common.back": "Quay lại",
  "common.search": "Tìm kiếm",
  "common.loading": "Đang tải...",
  "common.noData": "Không có dữ liệu",
  "common.close": "Đóng",
  "common.submit": "Gửi",
  "common.create": "Tạo",
  "common.all": "Tất cả",
  "profile.myProfile": "Hồ sơ của tôi",
  "profile.achievements": "Thành tựu",
  "profile.titles": "Tiêu đề",
  "profile.favorites": "Yêu thích",
  "profile.activityRecords": "Bản ghi hoạt động",
  "profile.level": "Lv.{level}",
  "profile.gender": "Giới tính",
  "profile.birthday": "Sinh nhật",
  "profile.region": "Vùng đất",
  "profile.sports": "Thể thao",
  "profile.team": "Đội",
  "profile.phone": "Điện thoại",
  "profile.joinDate": "Đã tham gia",
  "profile.totalGames": "Trò chơi",
  "profile.completed": "Xong",
  "profile.attendanceRate": "Tỷ lệ",
  "profile.badges": "Huy hiệu",
  "profile.qrCode": "Mã QR của tôi",
  "profile.inventory": "Hàng tồn kho",
  "profile.lineNotify": "Thông báo ĐƯỜNG DÂY",
  "profile.applications": "Ứng dụng của tôi",
  "activity.register": "Đăng ký",
  "activity.cancel": "Hủy đăng ký",
  "activity.full": "Đầy",
  "activity.ended": "Đã kết thúc",
  "activity.upcoming": "Sắp ra mắt",
  "activity.waitlist": "Danh sách chờ",
  "activity.participants": "người",
  "activity.fee": "Phí",
  "activity.location": "Vị trí",
  "activity.time": "Thời gian",
  "activity.organizer": "Người tổ chức",
  "activity.free": "Miễn phí",
  "activity.noActive": "Không có hoạt động tích cực",
  "activity.noMatch": "Không có hoạt động phù hợp",
  "status.open": "Mở",
  "status.full": "Đầy",
  "status.ended": "Đã kết thúc",
  "status.upcoming": "Sắp ra mắt",
  "status.cancelled": "Đã hủy",
  "status.registered": "Đăng ký",
  "status.completed": "Hoàn thành",
  "team.join": "Áp dụng",
  "team.leave": "Rời khỏi đội",
  "team.members": "Thành viên",
  "team.captain": "Đội trưởng",
  "team.coach": "Huấn luyện viên",
  "team.create": "Tạo nhóm",
  "team.info": "Thông tin đội",
  "team.record": "Ghi",
  "team.rank": "Xếp hạng",
  "team.memberLabel": "Thành viên",
  "team.regionLabel": "Vùng đất",
  "team.personUnit": "",
  "team.noMatch": "Không tìm thấy đội nào",
  "tournament.register": "Đăng ký",
  "tournament.regClosed": "Đã đóng đăng ký",
  "tournament.regFull": "Đăng ký đầy đủ",
  "tournament.schedule": "Lịch trình",
  "tournament.detail": "Chi tiết",
  "tournament.teams": "Đội",
  "tournament.teamUnit": "đội",
  "tournament.matchDay": "Ngày thi đấu",
  "tournament.regPeriod": "Sự đăng ký",
  "tournament.registered": "Đăng ký",
  "tournament.noActive": "Không có giải đấu gần đây",
  "tournament.noEnded": "Không có giải đấu nào kết thúc",
  "tournament.status.preparing": "Sắp bắt đầu",
  "tournament.status.regOpen": "Đang mở đăng ký",
  "tournament.status.regClosed": "Đã đóng đăng ký",
  "tournament.status.ended": "Đã kết thúc",
  "tournament.createTitle": "Tạo giải đấu",
  "tournament.editTitle": "Sửa giải đấu",
  "tournament.searchPlaceholder": "Tìm kiếm tên giải đấu...",
  "tournament.allRegions": "Tất cả khu vực",
  "tournament.tabOngoing": "Đang diễn ra",
  "tournament.tabEnded": "Đã kết thúc",
  "tournament.tabInfo": "Thông tin",
  "tournament.tabTeams": "Đội",
  "tournament.tabSchedule": "Lịch trình",
  "tournament.tabStats": "Thống kê",
  "tournament.comingSoon": "Sắp ra mắt",
  "tournament.noDescription": "Không có mô tả",
  "tournament.noTeams": "Chưa có đội đăng ký",
  "tournament.contactHost": "Liên hệ chủ nhà",
  "tournament.waitingReview": "Đang chờ xét duyệt",
  "tournament.notYetOpen": "Chưa mở",
  "tournament.noSchedule": "Chưa có lịch trình",
  "tournament.matchDays": "Ngày thi đấu",
  "tournament.matchResults": "Kết quả thi đấu",
  "tournament.noStats": "Chưa có thống kê",
  "tournament.statsSummary": "Tổng quan giải đấu",
  "tournament.approvedTeams": "Đội đã duyệt",
  "tournament.pendingTeams": "Đang chờ",
  "tournament.totalPlayers": "Tổng cầu thủ",
  "fav.sortTime": "Theo thời gian",
  "fav.sortStatus": "Theo trạng thái",
  "fav.sortName": "theo tên",
  "toast.saved": "Đã lưu",
  "toast.deleted": "Đã xóa",
  "toast.copied": "Đã sao chép",
  "toast.favoriteAdded": "Đã thêm vào mục yêu thích",
  "toast.favoriteRemoved": "Đã xóa khỏi mục yêu thích",
  "toast.langChanged": "Ngôn ngữ đã thay đổi",
  "drawer.darkMode": "Chế độ tối",
  "drawer.language": "Ngôn ngữ",
  "drawer.shop": "Cửa hàng",
  "drawer.leaderboard": "Bảng xếp hạng",
  "drawer.manual": "Hướng dẫn sử dụng",
  "drawer.share": "Chia sẻ",
  "drawer.activityManage": "Quản lý hoạt động",
  "drawer.tournamentManage": "Quản lý giải đấu",
  "drawer.scan": "Quét Đăng ký",
  "admin.dashboard": "Trang tổng quan",
  "admin.seo": "Bảng điều khiển SEO",
  "admin.userManage": "Người dùng",
  "admin.adManage": "Quản lý quảng cáo",
  "admin.shopManage": "Quản lý cửa hàng",
  "admin.messageManage": "Tin nhắn",
  "admin.teamManage": "Quản lý nhóm",
  "admin.themes": "Chủ đề",
  "admin.expManage": "EXP Mgmt",
  "admin.announcements": "Thông báo",
  "admin.achievements": "Thành tích",
  "admin.roles": "Quyền hạn Mgmt",
  "admin.inactive": "Dữ liệu không hoạt động",
  "admin.logs": "Trung tâm nhật ký",
  "admin.auditLogs": "Nhật ký kiểm tra",
  "admin.errorLogs": "Nhật ký lỗi",
  "admin.repair": "Quản lý điều chỉnh người dùng",
  "dash.totalUsers": "Người dùng",
  "dash.totalEvents": "Sự kiện",
  "dash.activeTeams": "Nhóm hoạt động",
  "dash.ongoingTourn": "Giải đấu",
  "dash.openEvents": "Sự kiện mở",
  "dash.endedEvents": "Sự kiện đã kết thúc",
  "dash.totalRecords": "Bản ghi",
  "dash.attendRate": "Tham dự",
  "dash.typeDistribution": "Sự kiện Phân bổ loại",
  "dash.regionDistribution": "Phân bổ theo khu vực",
  "dash.monthlyTrend": "Xu hướng hàng tháng",
  "dash.teamRanking": "Xếp hạng nhóm Top 5",
  "teamDetail.info": "Đội Thông tin",
  "teamDetail.captain": "Đội trưởng",
  "teamDetail.coach": "Huấn luyện viên",
  "teamDetail.memberCount": "Thành viên",
  "teamDetail.region": "Khu vực",
  "teamDetail.nationality": "Quốc tịch",
  "teamDetail.founded": "Founded",
  "teamDetail.contact": "Liên hệ",
  "teamDetail.bio": "Giới thiệu",
  "teamDetail.record": "Đội Kỷ lục",
  "teamDetail.wins": "W",
  "teamDetail.draws": "D",
  "teamDetail.losses": "L",
  "teamDetail.winRate": "Win%",
  "teamDetail.goalsFor": "GF",
  "teamDetail.goalsAgainst": "GA",
  "teamDetail.goalDiff": "GD",
  "teamDetail.totalGames": "GP",
  "teamDetail.matchHistory": "Lịch sử trận đấu",
  "teamDetail.noHistory": "Không khớp lịch sử",
  "teamDetail.memberList": "Thành viên",
  "teamDetail.feed": "Nguồn cấp dữ liệu nhóm",
  "teamDetail.noFeed": "Chưa có bài đăng nào",
  "teamDetail.publish": "Bài đăng",
  "teamDetail.publishing": "Đang đăng...",
  "teamDetail.public": "Công khai",
  "teamDetail.privateOnly": "Nhóm Chỉ",
  "teamDetail.pinPost": "Ghim",
  "teamDetail.unpinPost": "Bỏ ghim",
  "teamDetail.pinned": "Đã ghim",
  "teamDetail.leaveTeam": "Rời khỏi nhóm",
  "teamDetail.contactCaptain": "Liên hệ với đội trưởng",
  "teamDetail.applyJoin": "Đăng ký tham gia",
  "teamDetail.inviteQR": "Mời mã QR",
  "teamDetail.memberCanInvite": "Thành viên có thể mời",
  "teamDetail.notSet": "Không set",
  "teamDetail.none": "None",
  "teamDetail.personUnit": "",
  "teamDetail.delete": "Delete",
  "teamDetail.prevPage": "Prev",
  "teamDetail.nextPage": "Next",
  "teamDetail.postPlaceholder": "Chia sẻ với đồng đội... (tối đa 200 ký tự)",
  "teamDetail.commentPlaceholder": "Comment...",
  "teamDetail.commentSubmit": "Gửi",
  "teamPage.searchPlaceholder": "Tìm kiếm các đội...",
  "teamPage.allRegions": "Tất cả các khu vực",
  "teamPage.manage": "Quản lý",
  "teamPage.myTeams": "Nhóm của tôi",
  "teamPage.allTeams": "Tất cả các nhóm",
  "activityPage.searchPlaceholder": "Hoạt động tìm kiếm...",
  "activityPage.allTypes": "Tất cả Loại",
  "activityPage.manage": "Quản lý",
  "activityPage.tabNormal": "Hoạt động",
  "activityPage.tabEnded": "Ended",
  "activityPage.newEvent": "Sự kiện mới",
  "profilePage.notLoggedIn": "Chưa đăng nhập",
  "profilePage.loginHint": "Vui lòng đăng nhập để xem hồ sơ của bạn",
  "profilePage.myInfo": "Của tôi Thông tin",
  "profilePage.recordAll": "Tất cả",
  "profilePage.recordRegistered": "Đã đăng ký",
  "profilePage.recordCompleted": "Đã hoàn thành",
  "profilePage.recordCancelled": "Đã hủy",
  "drawer.personalData": "Chỉ số cá nhân",
  "drawer.autoExpManage": "Auto EXP Mgmt",
  "drawer.backendManage": "Bảng quản trị",
  "common.person": "",
  "teamSplit.select.title": "Chọn đội của bạn 👕",
  "teamSplit.select.required": "Vui lòng chọn đội trước",
  "teamSplit.batch.random": "Xáo trộn",
  "teamSplit.batch.fill": "Bổ sung",
  "teamSplit.batch.reset": "Đặt lại",
  "teamSplit.batch.confirmRandom": "Xáo trộn lại đội. Người tham gia sẽ không được thông báo. Tiếp tục?",
  "teamSplit.batch.confirmReset": "Xóa tất cả phân đội?"
});

// First-wave static UI translations. Source-text keys keep zh-TW fallback stable during rollout.
const STATIC_UI_SOURCE_TEXT_EN = {
  "（無）": "(None)",
  "（僅俱樂部經理或管理員可轉移經理職位）": "(Only club managers or admins can transfer the manager role)",
  "* 必選，未選擇運動 / 場景標籤將無法儲存": "* Required. Select sport / scene tags to save.",
  "* 必選，未選擇運動 / 場景標籤將無法儲存活動": "* Required. Select sport / scene tags to save the activity.",
  "*必填": "*Required",
  "*必選": "*Required",
  "＋ 新增": "+ Add",
  "+ 新增同行者": "+ Add companion",
  "＋ 新增俱樂部": "+ Add club",
  "+ 新增連結": "+ Add link",
  "＋我要開團": "+ Host activity",
  "⭐ 長按「使用 LINE 應用程式登入」": "⭐ Long-press \"Log in with LINE app\"",
  "🎲 隨機": "🎲 Random",
  "👆 自選": "👆 Pick manually",
  "📋 主辦": "📋 Host",
  "📱 LINE 登入步驟": "📱 LINE login steps",
  "0 為免費": "0 means free",
  "6成新以下": "Below 60% new",
  "7成新": "70% new",
  "8成新": "80% new",
  "9成新": "90% new",
  "一張原圖裁切封面 800 x 300 與卡片 800 x 800": "Crop one original image into an 800 x 300 cover and 800 x 800 card",
  "二手商品區": "Secondhand Market",
  "人數上限": "Participant limit",
  "上架商品": "List item",
  "上傳俱樂部圖片": "Upload club image",
  "上傳頭像": "Upload avatar",
  "上課時間": "Class time",
  "下載APP": "Download App",
  "大成就稱號": "Major achievement title",
  "女": "Female",
  "女生專屬": "Women only",
  "小時鎖定": "hours before lock",
  "已取消": "Canceled",
  "已結束": "Ended",
  "已選時間：14:00 ～ 16:00": "Selected time: 14:00 - 16:00",
  "已額滿": "Full",
  "不限": "No limit",
  "不填": "Prefer not to say",
  "中部": "Central Taiwan",
  "分": "Min",
  "分享當前活動分類網址": "Share current activity category URL",
  "分組（可多選）": "Groups (multiple allowed)",
  "分組管理": "Group Management",
  "分隊功能": "Team split",
  "切換運動項目": "Switch sport",
  "尺寸 / 規格": "Size / Spec",
  "手指按住不放、約 1 秒": "Press and hold for about 1 second",
  "手動簽到": "Manual check-in",
  "方案名單": "Plan roster",
  "日": "Day",
  "月": "Month",
  "月曆": "Calendar",
  "比賽日期（可複選）": "Match dates (multiple allowed)",
  "主辦方排行": "Host ranking",
  "代理（為他人報名）": "Proxy (register for others)",
  "出席紀錄": "Attendance records",
  "出席率": "Attendance rate",
  "功能未開放": "Feature unavailable",
  "功能建構中": "Feature under construction",
  "加入時間": "Joined",
  "包含個人資料蒐集、處理與利用告知；勾選後按下下方按鈕，即表示同意平台依上述條款處理資料。": "Includes notice for personal data collection, processing, and use. Checking this and pressing the button below means you agree to the platform processing your data under these terms.",
  "北部": "Northern Taiwan",
  "台中市": "Taichung City",
  "台北市": "Taipei City",
  "台東縣": "Taitung County",
  "台南市": "Tainan City",
  "外部": "External",
  "未指定": "Unspecified",
  "本人": "Self",
  "正在為您跳轉頁面": "Redirecting you",
  "正在載入資料中..": "Loading data..",
  "正式開放報名前可提前報名。扣點只套用在本人正取報名；活動取消會退回，用戶自行取消不退回。": "Allows early registration before general opening. Points are charged only for confirmed self registrations. Event cancellation refunds points; user cancellation does not.",
  "生日": "Birthday",
  "用戶資料卡片": "User profile card",
  "申請加入": "Apply to join",
  "立即開放報名": "Open registration immediately",
  "交易窗口": "Contact for transaction",
  "全部": "All",
  "全部分類": "All categories",
  "全部地區": "All regions",
  "全部運動": "All sports",
  "全部價格": "All prices",
  "全部類別": "All categories",
  "全新": "Brand new",
  "全選": "Select all",
  "同意並送出": "Agree and submit",
  "在 LINE 中打開": "Open in LINE",
  "地區": "Region",
  "地點": "Location",
  "如需在正式開放前提供早鳥報名，請到「進階功能」開啟早鳥報名並設定消耗積分。": "To offer early-bird registration before general opening, enable it in Advanced Features and set the points cost.",
  "如需轉移，請搜尋新任俱樂部經理（暱稱或 UID）並點選；未選擇新用戶則維持目前經理。": "To transfer, search for the new club manager by nickname or UID and select them. If no new user is selected, the current manager stays unchanged.",
  "字": "Text",
  "字型大小": "Font size",
  "年": "Year",
  "年齡限制": "Age limit",
  "成就/徽章": "Achievements / Badges",
  "成就與徽章": "Achievements and Badges",
  "早鳥報名": "Early-bird registration",
  "次身份暱稱": "Secondary identity nickname",
  "行前提醒": "Pre-event reminder",
  "你的帳號 ID": "Your account ID",
  "即將開放": "Coming soon",
  "均分上限": "Even split limit",
  "完成": "Complete",
  "完成基本資料後，即可報名活動、加入俱樂部與使用互動功能。": "Complete your basic profile to register for activities, join clubs, and use interactive features.",
  "完成場次": "Completed sessions",
  "完善個人資料": "Complete profile",
  "我已閱讀並同意": "I have read and agree to",
  "我的": "My",
  "我的 EXP": "My EXP",
  "我的 QR Code": "My QR Code",
  "我的收藏": "My Favorites",
  "我的資料": "My Profile",
  "我的運動夥伴": "My sports partners",
  "我要開團": "Host activity",
  "男": "Male",
  "私密活動": "Private activity",
  "使用主身份": "Use primary identity",
  "例：0912-345-678": "Ex: 0912-345-678",
  "例：2024": "Ex: 2024",
  "例：2026 春季盃足球賽": "Ex: 2026 Spring Cup Football Tournament",
  "例：6": "Ex: 6",
  "例：8": "Ex: 8",
  "例：大安運動中心": "Ex: Daan Sports Center",
  "例：台北市大安運動中心": "Ex: Taipei Daan Sports Center",
  "例：台灣": "Ex: Taiwan",
  "例：每週六 09:00-10:30": "Ex: Saturdays 09:00-10:30",
  "例：家人、朋友（最多50字）": "Ex: Family, friend (max 50 chars)",
  "例：週六足球友誼賽": "Ex: Saturday football friendly",
  "例：雷霆隊": "Ex: Thunder FC",
  "例：LINE ID、電話、Email": "Ex: LINE ID, phone, Email",
  "例：Nike Phantom GT2": "Ex: Nike Phantom GT2",
  "例：Thunder FC": "Ex: Thunder FC",
  "例：U8、競技班": "Ex: U8, competitive class",
  "例：US10、L、M": "Ex: US10, L, M",
  "例：XX 平台足球活動": "Ex: XX platform football activity",
  "例如：請自備球鞋、飲用水，遲到15分鐘以上視為缺席...": "Example: Bring your own shoes and water. Arrivals over 15 minutes late count as absent...",
  "其他": "Other",
  "取消": "Cancel",
  "取消報名": "Cancel registration",
  "取消報名限制": "Cancellation restriction",
  "委託人": "Proxy registrant",
  "委託人（最多 10 人）": "Proxy registrants (max 10)",
  "季": "Quarter",
  "宜蘭縣": "Yilan County",
  "尚未設定地圖座標": "Map coordinates not set",
  "尚未登入": "Not logged in",
  "性別": "Gender",
  "性別限制": "Gender limit",
  "性別限定": "Gender restriction",
  "所屬俱樂部": "Club",
  "放鴿子偵測": "No-show detection",
  "服務條款": "Terms of Service",
  "東部&外島": "Eastern Taiwan & Islands",
  "注意事項": "Notes",
  "社群連結": "Social links",
  "社群聯繫按鈕": "Social contact buttons",
  "花蓮縣": "Hualien County",
  "返回": "Back",
  "金門縣": "Kinmen County",
  "長按": "Long press",
  "非必填": "Optional",
  "非必選；開啟後僅限所選性別報名，性別空白或其他不可報名": "Optional. When enabled, only the selected gender may register; blank or other gender cannot register.",
  "南投縣": "Nantou County",
  "南部": "Southern Taiwan",
  "屏東縣": "Pingtung County",
  "建立分組": "Create group",
  "建立活動": "Create activity",
  "建立活動連結": "Create activity link",
  "建立俱樂部": "Create club",
  "建立賽事": "Create tournament",
  "建議尺寸 400 × 300 px｜JPG / PNG｜每張最大 2MB": "Recommended size 400 x 300 px | JPG / PNG | Max 2MB each",
  "建議尺寸 800 × 300 px｜JPG / PNG｜最大 2MB": "Recommended size 800 x 300 px | JPG / PNG | Max 2MB",
  "建議尺寸 800 × 600 px｜JPG / PNG｜最大 2MB": "Recommended size 800 x 600 px | JPG / PNG | Max 2MB",
  "指派學員到分組": "Assign students to groups",
  "活動": "Activity",
  "活動日期": "Activity date",
  "活動名稱": "Activity name",
  "活動地區": "Activity region",
  "活動行事曆": "Activity Calendar",
  "活動封面圖片": "Activity cover image",
  "活動後評分": "Post-activity rating",
  "活動時間": "Activity time",
  "活動統計": "Activity stats",
  "活動開始前": "Before activity starts",
  "活動資料載入中...": "Loading activity data...",
  "活動圖片 800 × 300": "Activity image 800 x 300",
  "活動管理": "Activity Management",
  "活動說明（上限 500 字）": "Activity description (max 500 chars)",
  "活動類型": "Activity type",
  "盃賽": "Cup",
  "紅黃牌規則（預設英超）": "Red/yellow card rules (default EPL)",
  "苗栗縣": "Miaoli County",
  "英文名稱": "English name",
  "重新整理": "Refresh",
  "重試": "Retry",
  "限女生": "Women only",
  "限男生": "Men only",
  "首頁": "Home",
  "俱樂部": "Clubs",
  "俱樂部名稱": "Club name",
  "俱樂部封面": "Club cover",
  "俱樂部封面 800 × 300": "Club cover 800 x 300",
  "俱樂部限定": "Club only",
  "俱樂部設定": "Club settings",
  "俱樂部管理": "Club Management",
  "俱樂部簡介": "Club intro",
  "俱樂部類型": "Club type",
  "個人檔案": "Profile",
  "時": "Hour",
  "桃園市": "Taoyuan City",
  "消耗積分": "Points cost",
  "送出申請": "Submit application",
  "高強度": "High intensity",
  "高雄市": "Kaohsiung City",
  "偵測網路環境中..": "Checking network environment..",
  "區間前＝準備中，區間內＝報名中，區間後＝截止報名": "Before window = preparing; during window = registration open; after window = registration closed",
  "參賽隊伍數": "Number of teams",
  "商品名稱": "Product name",
  "商品描述（上限 500 字）": "Product description (max 500 chars)",
  "商品圖片（最多 3 張）": "Product images (up to 3)",
  "國籍": "Nationality",
  "基隆市": "Keelung City",
  "從範本建立": "Create from template",
  "掃碼查看個人資料卡片": "Scan to view profile card",
  "排行榜": "Leaderboard",
  "接受新學員報名": "Accept new student applications",
  "啟用": "Enable",
  "啟用後會直接以第二身份顯示": "When enabled, it will display directly as the secondary identity",
  "教練（可多位）": "Coaches (multiple allowed)",
  "教學": "Training",
  "教學俱樂部": "Training club",
  "深色模式": "Dark mode",
  "清除": "Clear",
  "清除快取": "Clear cache",
  "清除定位": "Clear location",
  "清除頭像": "Clear avatar",
  "現場簽到": "On-site check-in",
  "球衣": "Jersey",
  "球鞋": "Shoes",
  "第二身份": "Secondary identity",
  "組建競技團隊，管理成員、賽事與戰績": "Build a competitive team and manage members, matches, and records",
  "設定地圖座標": "Set map coordinates",
  "通知": "Notifications",
  "通知設定": "Notification settings",
  "連江縣": "Lienchiang County",
  "部分活動可能會依性別、年齡或地區設定參與條件，請協助填寫相關資料以利系統判定。": "Some activities may set eligibility by gender, age, or region. Please provide the relevant details so the system can check eligibility.",
  "備註": "Notes",
  "最大年齡": "Maximum age",
  "最小年齡": "Minimum age",
  "最多 5 個。系統會依網址自動判斷 LINE、Facebook、Instagram、YouTube 等常見社群圖示。": "Up to 5. The system detects common social icons such as LINE, Facebook, Instagram, and YouTube from the URL.",
  "最新上架": "Newest first",
  "最舊上架": "Oldest first",
  "創立年份": "Founded year",
  "勝利：3分 ・ 平手：1分 ・ 落敗：0分": "Win: 3 pts ・ Draw: 1 pt ・ Loss: 0 pts",
  "報名": "Register",
  "報名中": "Open",
  "報名前問卷": "Pre-registration questionnaire",
  "報名紀錄": "Registration records",
  "報名時用戶可以": "During registration, users can",
  "報名費（每隊）": "Registration fee (per team)",
  "報名開放：建立後立即開放報名": "Registration opens immediately after creation",
  "報名開放日期": "Registration open date",
  "報名開放時間": "Registration open time",
  "場地（可新增多個）": "Venue (multiple allowed)",
  "尋找附近活動": "Find nearby activities",
  "描述商品狀況、使用次數、附贈配件等...": "Describe condition, usage count, included accessories, etc...",
  "普通稱號": "Regular title",
  "登出": "Log out",
  "稍後填寫": "Fill in later",
  "結束": "End",
  "結束時間": "End time",
  "統計": "Stats",
  "裁判（最多 10 人）": "Referees (max 10)",
  "費用 ($)": "Fee ($)",
  "貼上 LINE、Facebook、Instagram、YouTube 等網址，系統會自動辨識並顯示為聯繫按鈕。最多 5 個。": "Paste LINE, Facebook, Instagram, YouTube, or similar URLs. The system will detect them and display contact buttons. Up to 5.",
  "週": "Week",
  "進行中": "In progress",
  "進階功能": "Advanced features",
  "開始": "Start",
  "開始前": "Before start",
  "開始時間": "Start time",
  "開放日期": "Open date",
  "開放時間": "Open time",
  "開放報名時間": "Registration opening time",
  "開啟 — 指定活動地區": "On - specify activity region",
  "開啟後活動不會顯示在列表中，僅能透過分享連結查看": "When enabled, the activity will not appear in lists and can only be viewed via shared link.",
  "開啟後新學員可透過俱樂部頁面申請加入，關閉後將暫停招收新學員，已報名學員不受影響。": "When enabled, new students can apply from the club page. When disabled, new applications are paused; existing enrolled students are unaffected.",
  "開設課程教學，管理學員報名與課程排程": "Run classes and manage student registration and schedules",
  "隊": "Teams",
  "集點卡": "Stamp card",
  "雲林縣": "Yunlin County",
  "僅限 https:// 開頭的連結": "Only links starting with https:// are allowed",
  "填寫 Email 後，未來可收到第一手運動活動通知、早鳥名額提醒、候補釋出與平台重要訊息；不填也可以完成資料。": "Add an email to receive activity alerts, early-bird reminders, waitlist releases, and important platform updates. You can still complete your profile without it.",
  "搜尋用戶...": "Search users...",
  "搜尋俱樂部名稱": "Search club name",
  "搜尋俱樂部名稱...": "Search club name...",
  "搜尋俱樂部領隊：輸入暱稱後點選加入（可複數）": "Search club captains: enter a nickname and click to add (multiple allowed)",
  "搜尋運動 / 場景標籤": "Search sport / scene tags",
  "搜尋與篩選活動": "Search and filter activities",
  "搜尋與篩選俱樂部": "Search and filter clubs",
  "搜尋與篩選賽事": "Search and filter tournaments",
  "搜尋賽事名稱...": "Search tournament name...",
  "新手友善": "Beginner friendly",
  "新北市": "New Taipei City",
  "新竹市": "Hsinchu City",
  "新竹縣": "Hsinchu County",
  "新增": "Add",
  "新增二手商品": "Add secondhand item",
  "新增同行者": "Add companion",
  "新增活動": "Add activity",
  "新增活動連結": "Add activity link",
  "新增俱樂部": "Add club",
  "新增賽事": "Add tournament",
  "新舊程度": "Condition",
  "綁定時間": "Binding time",
  "解除綁定": "Unbind",
  "運動 / 場景標籤": "Sport / scene tags",
  "運動俱樂部": "Sports club",
  "運動類別": "Sport type",
  "道具欄": "Inventory",
  "預留 — 尚未啟用": "Reserved - not enabled",
  "嘉義市": "Chiayi City",
  "嘉義縣": "Chiayi County",
  "彰化縣": "Changhua County",
  "稱號": "Title",
  "稱號設定": "Title settings",
  "語言": "Language",
  "說明": "Help",
  "模糊搜尋名稱 / 地點 / 主辦 / 日期...": "Search name / location / host / date...",
  "澎湖縣": "Penghu County",
  "確定": "OK",
  "確認": "Confirm",
  "確認刪除": "Confirm delete",
  "確認刪除層級": "Confirm hierarchy deletion",
  "確認取消": "Confirm cancellation",
  "確認報名": "Confirm registration",
  "確認操作": "Confirm action",
  "範本名稱（例：週六友誼賽）": "Template name (ex: Saturday friendly)",
  "範本名稱（例：XX 平台足球活動）": "Template name (ex: XX platform football activity)",
  "編輯": "Edit",
  "編輯社群連結": "Edit social links",
  "編輯俱樂部": "Edit club",
  "編輯學員": "Edit student",
  "複製連結用 LINE 開啟（最快）": "Copy link and open with LINE (fastest)",
  "課程方案": "Course plans",
  "課程簽到": "Course check-in",
  "請先使用 LINE 帳號登入以查看個人資料": "Log in with your LINE account to view your profile",
  "請稍候，正在載入相關資料..": "Please wait, loading related data..",
  "請選擇": "Please select",
  "請選擇要取消的報名：": "Select the registration to cancel:",
  "請選擇運動 / 場景標籤": "Select sport / scene tags",
  "學員列表": "Student list",
  "學員姓名": "Student name",
  "學員招募狀態": "Student recruitment status",
  "學員的姓名": "Student name",
  "積分規則": "Points rules",
  "篩選主辦人...": "Filter hosts...",
  "輸入姓名": "Enter name",
  "輸入或選擇縣市": "Enter or select city/county",
  "輸入或選擇縣市...": "Enter or select city/county...",
  "輸入搜尋縣市...": "Search city/county...",
  "輸入縣市名稱": "Enter city/county name",
  "選單": "Menu",
  "選填，例：台北市大安運動中心": "Optional, ex: Taipei Daan Sports Center",
  "選填說明": "Optional description",
  "選擇日期": "Select date",
  "選擇俱樂部類型": "Select club type",
  "選擇參與者": "Select participants",
  "儲存": "Save",
  "儲存為範本": "Save as template",
  "儲存稱號": "Save title",
  "徽章": "Badges",
  "應到場次": "Expected sessions",
  "聯繫方式": "Contact",
  "賽事": "Tournament",
  "賽事中心": "Tournament Center",
  "賽事內容圖片": "Tournament content image",
  "賽事名稱": "Tournament name",
  "賽事封面圖片": "Tournament cover image",
  "賽事規則": "Tournament rules",
  "賽事規則、注意事項...": "Tournament rules, notes...",
  "賽事圖片 800 × 300": "Tournament image 800 x 300",
  "賽事類型": "Tournament type",
  "賽程": "Schedule",
  "隱私權政策": "Privacy Policy",
  "點擊上傳圖片": "Click to upload image",
  "點擊今日不再顯示": "Do not show again today",
  "點擊月曆勾選所有比賽日": "Click the calendar to select all match days",
  "點擊換色": "Click to change color",
  "瀏覽次數": "Views",
  "簡短介紹俱樂部（最多 500 字）": "Briefly introduce the club (max 500 chars)",
  "轉移俱樂部經理前請確認：俱樂部經理只能有一位，不是可複選的領隊欄位。儲存後管理權限會轉給新經理，原經理可能失去此俱樂部管理權限。": "Before transferring the club manager role, confirm that there can only be one club manager; this is not a multi-select captain field. After saving, management permissions transfer to the new manager and the original manager may lose access.",
  "雙週": "Biweekly",
  "簽到 QR Code": "Check-in QR Code",
  "簽到資訊": "Check-in info",
  "關閉": "Close",
  "關閉 — 不收費": "Off - no charge",
  "關閉 — 不限制性別": "Off - no gender restriction",
  "關閉 — 所有人可見": "Off - visible to everyone",
  "關閉時建立後立即開放報名；開啟後可指定開放日期與時間。": "When off, registration opens immediately after creation. When on, you can set the opening date and time.",
  "繼續登入": "Continue login",
  "護具": "Protective gear",
  "顯示於說明頁文字下方，用於圖片補充說明": "Displayed below the help text as image supplementary notes",
  "觀賽": "Spectating",
  "GPS功能": "GPS feature",
  "LINE 帳號": "LINE account",
  "LINE 推播通知": "LINE push notifications",
  "LINE 暱稱": "LINE nickname"
};
function _parseStaticUiLocaleRows(rows) {
  const packs = { ja: {}, ko: {}, th: {}, vi: {} };
  rows.trim().split('\n').forEach(line => {
    const parts = line.split('\t');
    if (parts.length !== 5) return;
    const [key, ja, ko, th, vi] = parts;
    packs.ja[key] = ja;
    packs.ko[key] = ko;
    packs.th[key] = th;
    packs.vi[key] = vi;
  });
  return packs;
}
const STATIC_UI_SOURCE_TEXT_LOCALES = _parseStaticUiLocaleRows(`
（無）	（なし）	(없음)	(ไม่มี)	(Không có)
（僅俱樂部經理或管理員可轉移經理職位）	（クラブマネージャーまたは管理者のみ移譲できます）	(클럽 매니저 또는 관리자만 이전할 수 있습니다)	(เฉพาะผู้จัดการคลับหรือผู้ดูแลระบบเท่านั้นที่โอนได้)	(Chỉ quản lý CLB hoặc quản trị viên mới có thể chuyển quyền)
* 必選，未選擇運動 / 場景標籤將無法儲存	* 必須。スポーツ／シーンタグを選択してください	* 필수. 스포츠/장면 태그를 선택해야 저장됩니다	* จำเป็น ต้องเลือกกีฬา / แท็กสถานการณ์ก่อนบันทึก	* Bắt buộc. Chọn thẻ môn thể thao / bối cảnh để lưu
* 必選，未選擇運動 / 場景標籤將無法儲存活動	* 必須。スポーツ／シーンタグを選択してください	* 필수. 스포츠/장면 태그를 선택해야 활동을 저장할 수 있습니다	* จำเป็น ต้องเลือกกีฬา / แท็กสถานการณ์ก่อนบันทึกกิจกรรม	* Bắt buộc. Chọn thẻ môn thể thao / bối cảnh để lưu hoạt động
*必填	*必須	*필수	*จำเป็น	*Bắt buộc
*必選	*必須	*필수	*จำเป็น	*Bắt buộc
＋ 新增	+ 追加	+ 추가	+ เพิ่ม	+ Thêm
+ 新增同行者	+ 同行者を追加	+ 동행자 추가	+ เพิ่มผู้ร่วมเดินทาง	+ Thêm người đi cùng
＋ 新增俱樂部	+ クラブを追加	+ 클럽 추가	+ เพิ่มคลับ	+ Thêm CLB
+ 新增連結	+ リンクを追加	+ 링크 추가	+ เพิ่มลิงก์	+ Thêm liên kết
＋我要開團	+ イベントを主催	+ 활동 열기	+ เปิดกิจกรรม	+ Tạo hoạt động
⭐ 長按「使用 LINE 應用程式登入」	⭐ 「LINEアプリでログイン」を長押し	⭐ "LINE 앱으로 로그인"을 길게 누르세요	⭐ กดค้าง "เข้าสู่ระบบด้วยแอป LINE"	⭐ Nhấn giữ "Đăng nhập bằng ứng dụng LINE"
🎲 隨機	🎲 ランダム	🎲 무작위	🎲 สุ่ม	🎲 Ngẫu nhiên
👆 自選	👆 自分で選択	👆 직접 선택	👆 เลือกเอง	👆 Tự chọn
📋 主辦	📋 主催	📋 주최	📋 ผู้จัด	📋 Chủ trì
📱 LINE 登入步驟	📱 LINEログイン手順	📱 LINE 로그인 단계	📱 ขั้นตอนเข้าสู่ระบบ LINE	📱 Các bước đăng nhập LINE
0 為免費	0 は無料	0은 무료	0 คือฟรี	0 là miễn phí
6成新以下	6割未満	60% 이하	สภาพต่ำกว่า 60%	Độ mới dưới 60%
7成新	7割程度	70% 새것	สภาพ 70%	Độ mới 70%
8成新	8割程度	80% 새것	สภาพ 80%	Độ mới 80%
9成新	9割程度	90% 새것	สภาพ 90%	Độ mới 90%
一張原圖裁切封面 800 x 300 與卡片 800 x 800	1枚の画像からカバー 800 x 300 とカード 800 x 800 を切り出します	원본 이미지 1장으로 커버 800 x 300 및 카드 800 x 800 자르기	ใช้รูปต้นฉบับ 1 รูป ครอบเป็นปก 800 x 300 และการ์ด 800 x 800	Cắt 1 ảnh gốc thành ảnh bìa 800 x 300 và thẻ 800 x 800
二手商品區	中古マーケット	중고 마켓	ตลาดมือสอง	Khu đồ cũ
人數上限	人数上限	인원 제한	จำนวนสูงสุด	Giới hạn người
上架商品	商品を出品	상품 등록	ลงขายสินค้า	Đăng bán sản phẩm
上傳俱樂部圖片	クラブ画像をアップロード	클럽 이미지 업로드	อัปโหลดรูปคลับ	Tải ảnh CLB lên
上傳頭像	アバターをアップロード	아바타 업로드	อัปโหลดรูปโปรไฟล์	Tải ảnh đại diện lên
上課時間	レッスン時間	수업 시간	เวลาเรียน	Thời gian học
下載APP	アプリをダウンロード	앱 다운로드	ดาวน์โหลดแอป	Tải ứng dụng
大成就稱號	大型実績称号	큰 업적 칭호	ฉายาความสำเร็จใหญ่	Danh hiệu thành tựu lớn
女	女性	여성	หญิง	Nữ
女生專屬	女性限定	여성 전용	เฉพาะผู้หญิง	Chỉ dành cho nữ
小時鎖定	時間前にロック	시간 전 잠금	ชั่วโมงก่อนล็อก	giờ trước khi khóa
已取消	キャンセル済み	취소됨	ยกเลิกแล้ว	Đã hủy
已結束	終了	종료됨	สิ้นสุดแล้ว	Đã kết thúc
已選時間：14:00 ～ 16:00	選択時間：14:00 ～ 16:00	선택 시간: 14:00 ～ 16:00	เวลาที่เลือก: 14:00 ～ 16:00	Thời gian đã chọn: 14:00 ～ 16:00
已額滿	満員	정원 마감	เต็มแล้ว	Đã đầy
不限	制限なし	제한 없음	ไม่จำกัด	Không giới hạn
不填	回答しない	응답 안 함	ไม่ระบุ	Không muốn trả lời
中部	台湾中部	대만 중부	ภาคกลางไต้หวัน	Miền Trung Đài Loan
分	分	분	นาที	Phút
分享當前活動分類網址	現在の活動カテゴリURLを共有	현재 활동 분류 URL 공유	แชร์ URL หมวดกิจกรรมปัจจุบัน	Chia sẻ URL danh mục hoạt động hiện tại
分組（可多選）	グループ（複数選択可）	그룹(복수 선택 가능)	กลุ่ม (เลือกได้หลายรายการ)	Nhóm (có thể chọn nhiều)
分組管理	グループ管理	그룹 관리	จัดการกลุ่ม	Quản lý nhóm
分隊功能	チーム分け機能	팀 나누기 기능	ฟังก์ชันแบ่งทีม	Tính năng chia đội
切換運動項目	スポーツを切り替え	스포츠 전환	เปลี่ยนกีฬา	Đổi môn thể thao
尺寸 / 規格	サイズ / 規格	사이즈 / 규격	ขนาด / สเปก	Kích thước / Quy cách
手指按住不放、約 1 秒	指で約1秒長押し	손가락으로 약 1초 길게 누르기	ใช้นิ้วกดค้างประมาณ 1 วินาที	Nhấn giữ khoảng 1 giây
手動簽到	手動チェックイン	수동 체크인	เช็กอินด้วยตนเอง	Điểm danh thủ công
方案名單	プラン名簿	플랜 명단	รายชื่อแพ็กเกจ	Danh sách gói
日	日	일	วัน	Ngày
月	月	월	เดือน	Tháng
月曆	カレンダー	달력	ปฏิทิน	Lịch
比賽日期（可複選）	試合日（複数選択可）	경기일(복수 선택 가능)	วันที่แข่งขัน (เลือกได้หลายวัน)	Ngày thi đấu (có thể chọn nhiều)
主辦方排行	主催者ランキング	주최자 순위	อันดับผู้จัด	Xếp hạng chủ trì
代理（為他人報名）	代理（他の人のために登録）	대리(타인 대신 등록)	ตัวแทน (สมัครแทนผู้อื่น)	Đại diện (đăng ký cho người khác)
出席紀錄	出席記録	출석 기록	บันทึกการเข้าร่วม	Lịch sử tham dự
出席率	出席率	출석률	อัตราเข้าร่วม	Tỷ lệ tham dự
功能未開放	機能は未公開	기능 미개방	ฟีเจอร์ยังไม่เปิด	Tính năng chưa mở
功能建構中	機能を構築中	기능 구축 중	กำลังสร้างฟีเจอร์	Tính năng đang phát triển
加入時間	参加日時	가입 시간	เวลาเข้าร่วม	Thời gian tham gia
包含個人資料蒐集、處理與利用告知；勾選後按下下方按鈕，即表示同意平台依上述條款處理資料。	個人情報の収集、処理、利用に関する通知を含みます。チェックして下のボタンを押すと、上記条件に基づくデータ処理に同意したことになります。	개인정보 수집, 처리 및 이용 고지를 포함합니다. 체크 후 아래 버튼을 누르면 위 약관에 따라 플랫폼이 데이터를 처리하는 데 동의한 것으로 간주됩니다.	รวมประกาศการเก็บ ใช้ และประมวลผลข้อมูลส่วนบุคคล เมื่อเลือกและกดปุ่มด้านล่าง หมายถึงยินยอมให้แพลตฟอร์มประมวลผลข้อมูลตามเงื่อนไขดังกล่าว	Bao gồm thông báo thu thập, xử lý và sử dụng dữ liệu cá nhân. Khi tích chọn và nhấn nút bên dưới, bạn đồng ý để nền tảng xử lý dữ liệu theo các điều khoản trên.
北部	台湾北部	대만 북부	ภาคเหนือไต้หวัน	Miền Bắc Đài Loan
台中市	台中市	타이중시	เมืองไถจง	Đài Trung
台北市	台北市	타이베이시	เมืองไทเป	Đài Bắc
台東縣	台東県	타이둥현	เทศมณฑลไถตง	Đài Đông
台南市	台南市	타이난시	เมืองไถหนาน	Đài Nam
外部	外部	외부	ภายนอก	Bên ngoài
未指定	未指定	미지정	ยังไม่ระบุ	Chưa chỉ định
本人	本人	본인	ตนเอง	Bản thân
正在為您跳轉頁面	ページへ移動しています	페이지로 이동 중	กำลังพาคุณไปยังหน้า	Đang chuyển trang cho bạn
正在載入資料中..	データを読み込み中..	데이터 로딩 중..	กำลังโหลดข้อมูล..	Đang tải dữ liệu..
正式開放報名前可提前報名。扣點只套用在本人正取報名；活動取消會退回，用戶自行取消不退回。	一般受付開始前に早期登録できます。ポイント消費は本人の確定登録にのみ適用されます。イベント中止時は返還され、自己キャンセルでは返還されません。	정식 등록 오픈 전 조기 등록할 수 있습니다. 포인트 차감은 본인 확정 등록에만 적용됩니다. 활동이 취소되면 반환되며, 사용자가 직접 취소하면 반환되지 않습니다.	สมัครล่วงหน้าได้ก่อนเปิดรับสมัครจริง การหักแต้มใช้เฉพาะการสมัครตัวจริงของตนเองเท่านั้น หากกิจกรรมถูกยกเลิกจะคืนแต้ม แต่ผู้ใช้ยกเลิกเองจะไม่คืนแต้ม	Có thể đăng ký sớm trước khi mở chính thức. Chỉ trừ điểm khi chính bạn đăng ký được xác nhận. Nếu hoạt động bị hủy sẽ hoàn điểm; tự hủy sẽ không hoàn.
生日	誕生日	생일	วันเกิด	Ngày sinh
用戶資料卡片	ユーザープロフィールカード	사용자 프로필 카드	การ์ดข้อมูลผู้ใช้	Thẻ hồ sơ người dùng
申請加入	参加申請	가입 신청	สมัครเข้าร่วม	Yêu cầu tham gia
立即開放報名	すぐに登録を開始	즉시 등록 오픈	เปิดรับสมัครทันที	Mở đăng ký ngay
交易窗口	取引連絡先	거래 연락처	ช่องทางติดต่อซื้อขาย	Đầu mối giao dịch
全部	すべて	전체	ทั้งหมด	Tất cả
全部分類	すべてのカテゴリ	전체 분류	ทุกหมวดหมู่	Tất cả danh mục
全部地區	すべての地域	전체 지역	ทุกพื้นที่	Tất cả khu vực
全部運動	すべてのスポーツ	전체 스포츠	กีฬาทั้งหมด	Tất cả môn thể thao
全部價格	すべての価格	전체 가격	ทุกราคา	Tất cả mức giá
全部類別	すべての種類	전체 유형	ทุกประเภท	Tất cả loại
全新	新品	새 상품	ใหม่เอี่ยม	Mới hoàn toàn
全選	すべて選択	전체 선택	เลือกทั้งหมด	Chọn tất cả
同意並送出	同意して送信	동의하고 제출	ยอมรับและส่ง	Đồng ý và gửi
在 LINE 中打開	LINEで開く	LINE에서 열기	เปิดใน LINE	Mở trong LINE
地區	地域	지역	พื้นที่	Khu vực
地點	場所	장소	สถานที่	Địa điểm
如需在正式開放前提供早鳥報名，請到「進階功能」開啟早鳥報名並設定消耗積分。	一般受付前に早割登録を提供する場合は、「詳細機能」で早割登録を有効にし、消費ポイントを設定してください。	정식 오픈 전 얼리버드 등록을 제공하려면 "고급 기능"에서 얼리버드 등록을 켜고 소모 포인트를 설정하세요.	หากต้องการเปิดสมัคร Early-bird ก่อนเปิดจริง ให้ไปที่ "ฟังก์ชันขั้นสูง" เพื่อเปิดและตั้งค่าแต้มที่ใช้	Nếu muốn mở đăng ký sớm trước thời gian chính thức, hãy bật trong "Tính năng nâng cao" và đặt số điểm tiêu hao.
如需轉移，請搜尋新任俱樂部經理（暱稱或 UID）並點選；未選擇新用戶則維持目前經理。	移譲する場合は、新しいクラブマネージャーをニックネームまたはUIDで検索して選択してください。新しいユーザーを選ばない場合は現マネージャーを維持します。	이전하려면 새 클럽 매니저를 닉네임 또는 UID로 검색해 선택하세요. 새 사용자를 선택하지 않으면 현재 매니저가 유지됩니다.	หากต้องการโอน ให้ค้นหาผู้จัดการคลับคนใหม่ด้วยชื่อเล่นหรือ UID แล้วเลือก หากไม่เลือกผู้ใช้ใหม่ จะคงผู้จัดการเดิมไว้	Để chuyển quyền, tìm quản lý CLB mới bằng biệt danh hoặc UID rồi chọn. Nếu không chọn người mới, quản lý hiện tại sẽ được giữ nguyên.
字	文字	글자	ตัวอักษร	Chữ
字型大小	文字サイズ	글꼴 크기	ขนาดตัวอักษร	Cỡ chữ
年	年	년	ปี	Năm
年齡限制	年齢制限	연령 제한	จำกัดอายุ	Giới hạn tuổi
成就/徽章	実績 / バッジ	업적 / 배지	ความสำเร็จ / เหรียญตรา	Thành tựu / Huy hiệu
成就與徽章	実績とバッジ	업적과 배지	ความสำเร็จและเหรียญตรา	Thành tựu và huy hiệu
早鳥報名	早割登録	얼리버드 등록	สมัคร Early-bird	Đăng ký sớm
次身份暱稱	サブIDのニックネーム	보조 신원 닉네임	ชื่อเล่นตัวตนรอง	Biệt danh danh tính phụ
行前提醒	事前リマインダー	사전 안내	แจ้งเตือนก่อนกิจกรรม	Nhắc trước sự kiện
你的帳號 ID	あなたのアカウントID	내 계정 ID	ID บัญชีของคุณ	ID tài khoản của bạn
即將開放	近日公開	곧 오픈	ใกล้เปิดให้ใช้	Sắp mở
均分上限	均等割り上限	균등 분배 상한	เพดานแบ่งเท่ากัน	Giới hạn chia đều
完成	完了	완료	เสร็จสิ้น	Hoàn tất
完成基本資料後，即可報名活動、加入俱樂部與使用互動功能。	基本プロフィールを完成すると、活動登録、クラブ参加、インタラクティブ機能を利用できます。	기본 프로필을 완료하면 활동 등록, 클럽 가입, 인터랙티브 기능을 사용할 수 있습니다.	กรอกข้อมูลพื้นฐานให้ครบแล้วจึงสมัครกิจกรรม เข้าร่วมคลับ และใช้ฟีเจอร์โต้ตอบได้	Hoàn tất hồ sơ cơ bản để đăng ký hoạt động, tham gia CLB và dùng tính năng tương tác.
完成場次	完了セッション	완료 세션	รอบที่เสร็จสิ้น	Số buổi hoàn tất
完善個人資料	プロフィールを完成	프로필 완성	กรอกโปรไฟล์ให้ครบ	Hoàn thiện hồ sơ
我已閱讀並同意	読み、同意します	읽고 동의합니다	ฉันได้อ่านและยอมรับ	Tôi đã đọc và đồng ý
我的	マイ	내	ของฉัน	Của tôi
我的 EXP	マイEXP	내 EXP	EXP ของฉัน	EXP của tôi
我的 QR Code	マイQRコード	내 QR Code	QR Code ของฉัน	QR Code của tôi
我的收藏	お気に入り	내 즐겨찾기	รายการโปรดของฉัน	Yêu thích của tôi
我的資料	マイプロフィール	내 프로필	ข้อมูลของฉัน	Hồ sơ của tôi
我的運動夥伴	マイスポーツ仲間	내 스포츠 파트너	เพื่อนกีฬาของฉัน	Bạn thể thao của tôi
我要開團	イベントを主催	활동 열기	เปิดกิจกรรม	Tạo hoạt động
男	男性	남성	ชาย	Nam
私密活動	非公開活動	비공개 활동	กิจกรรมส่วนตัว	Hoạt động riêng tư
使用主身份	メインIDを使用	주 신원 사용	ใช้ตัวตนหลัก	Dùng danh tính chính
例：0912-345-678	例：0912-345-678	예: 0912-345-678	เช่น 0912-345-678	Ví dụ: 0912-345-678
例：2024	例：2024	예: 2024	เช่น 2024	Ví dụ: 2024
例：2026 春季盃足球賽	例：2026 春季カップサッカー大会	예: 2026 봄컵 축구 대회	เช่น ฟุตบอล Spring Cup 2026	Ví dụ: Giải bóng đá Cúp mùa xuân 2026
例：6	例：6	예: 6	เช่น 6	Ví dụ: 6
例：8	例：8	예: 8	เช่น 8	Ví dụ: 8
例：大安運動中心	例：大安スポーツセンター	예: 다안 스포츠센터	เช่น ศูนย์กีฬา Daan	Ví dụ: Trung tâm thể thao Daan
例：台北市大安運動中心	例：台北市大安スポーツセンター	예: 타이베이 다안 스포츠센터	เช่น ศูนย์กีฬา Daan เมืองไทเป	Ví dụ: Trung tâm thể thao Daan, Đài Bắc
例：台灣	例：台湾	예: 대만	เช่น ไต้หวัน	Ví dụ: Đài Loan
例：每週六 09:00-10:30	例：毎週土曜 09:00-10:30	예: 매주 토요일 09:00-10:30	เช่น ทุกวันเสาร์ 09:00-10:30	Ví dụ: Thứ Bảy hằng tuần 09:00-10:30
例：家人、朋友（最多50字）	例：家族、友人（最大50文字）	예: 가족, 친구(최대 50자)	เช่น ครอบครัว เพื่อน (สูงสุด 50 ตัวอักษร)	Ví dụ: Gia đình, bạn bè (tối đa 50 ký tự)
例：週六足球友誼賽	例：土曜サッカー親善試合	예: 토요일 축구 친선전	เช่น ฟุตบอลกระชับมิตรวันเสาร์	Ví dụ: Giao hữu bóng đá thứ Bảy
例：雷霆隊	例：サンダーFC	예: 썬더팀	เช่น Thunder FC	Ví dụ: Thunder FC
例：LINE ID、電話、Email	例：LINE ID、電話、Email	예: LINE ID, 전화, Email	เช่น LINE ID, โทรศัพท์, Email	Ví dụ: LINE ID, điện thoại, Email
例：Nike Phantom GT2	例：Nike Phantom GT2	예: Nike Phantom GT2	เช่น Nike Phantom GT2	Ví dụ: Nike Phantom GT2
例：Thunder FC	例：Thunder FC	예: Thunder FC	เช่น Thunder FC	Ví dụ: Thunder FC
例：U8、競技班	例：U8、競技クラス	예: U8, 경쟁반	เช่น U8, คลาสแข่งขัน	Ví dụ: U8, lớp thi đấu
例：US10、L、M	例：US10、L、M	예: US10, L, M	เช่น US10, L, M	Ví dụ: US10, L, M
例：XX 平台足球活動	例：XXプラットフォームのサッカー活動	예: XX 플랫폼 축구 활동	เช่น กิจกรรมฟุตบอลแพลตฟอร์ม XX	Ví dụ: Hoạt động bóng đá nền tảng XX
例如：請自備球鞋、飲用水，遲到15分鐘以上視為缺席...	例：シューズと飲み物をご持参ください。15分以上遅刻すると欠席扱い...	예: 축구화와 물을 준비하세요. 15분 이상 지각 시 결석 처리...	เช่น กรุณาเตรียมรองเท้าและน้ำดื่ม มาสายเกิน 15 นาทีถือว่าขาด...	Ví dụ: Vui lòng tự chuẩn bị giày và nước uống; đến muộn quá 15 phút sẽ tính vắng...
其他	その他	기타	อื่นๆ	Khác
取消	キャンセル	취소	ยกเลิก	Hủy
取消報名	登録をキャンセル	등록 취소	ยกเลิกการสมัคร	Hủy đăng ký
取消報名限制	キャンセル制限	등록 취소 제한	ข้อจำกัดการยกเลิก	Giới hạn hủy đăng ký
委託人	代理人	대리인	ผู้สมัครแทน	Người đại diện
委託人（最多 10 人）	代理人（最大10人）	대리인(최대 10명)	ผู้สมัครแทน (สูงสุด 10 คน)	Người đại diện (tối đa 10 người)
季	四半期	분기	ไตรมาส	Quý
宜蘭縣	宜蘭県	이란현	เทศมณฑลอี๋หลาน	Nghi Lan
尚未設定地圖座標	地図座標が未設定	지도 좌표 미설정	ยังไม่ได้ตั้งค่าพิกัดแผนที่	Chưa đặt tọa độ bản đồ
尚未登入	未ログイン	로그인하지 않음	ยังไม่ได้เข้าสู่ระบบ	Chưa đăng nhập
性別	性別	성별	เพศ	Giới tính
性別限制	性別制限	성별 제한	จำกัดเพศ	Giới hạn giới tính
性別限定	性別限定	성별 한정	จำกัดเฉพาะเพศ	Giới hạn theo giới tính
所屬俱樂部	所属クラブ	소속 클럽	คลับที่สังกัด	CLB trực thuộc
放鴿子偵測	無断欠席検出	노쇼 감지	ตรวจจับไม่มาเข้าร่วม	Phát hiện vắng mặt
服務條款	利用規約	서비스 약관	ข้อกำหนดบริการ	Điều khoản dịch vụ
東部&外島	台湾東部・離島	대만 동부 및 외딴섬	ภาคตะวันออกและเกาะนอกไต้หวัน	Miền Đông & đảo ngoài
注意事項	注意事項	주의사항	หมายเหตุ	Lưu ý
社群連結	SNSリンク	소셜 링크	ลิงก์โซเชียล	Liên kết mạng xã hội
社群聯繫按鈕	SNS連絡ボタン	소셜 연락 버튼	ปุ่มติดต่อโซเชียล	Nút liên hệ mạng xã hội
花蓮縣	花蓮県	화롄현	เทศมณฑลฮวาเหลียน	Hoa Liên
返回	戻る	뒤로	กลับ	Quay lại
金門縣	金門県	진먼현	เทศมณฑลจินเหมิน	Kim Môn
長按	長押し	길게 누르기	กดค้าง	Nhấn giữ
非必填	任意	선택 사항	ไม่บังคับ	Không bắt buộc
非必選；開啟後僅限所選性別報名，性別空白或其他不可報名	任意。有効にすると選択した性別のみ登録できます。性別未入力またはその他は登録できません。	선택 사항. 켜면 선택한 성별만 등록할 수 있으며 성별 공란 또는 기타는 등록할 수 없습니다.	ไม่บังคับ เมื่อเปิดแล้วจะรับสมัครเฉพาะเพศที่เลือก เพศว่างหรืออื่นๆ จะสมัครไม่ได้	Không bắt buộc. Khi bật, chỉ giới tính đã chọn được đăng ký; để trống hoặc khác sẽ không đăng ký được.
南投縣	南投県	난터우현	เทศมณฑลหนานโถว	Nam Đầu
南部	台湾南部	대만 남부	ภาคใต้ไต้หวัน	Miền Nam Đài Loan
屏東縣	屏東県	핑둥현	เทศมณฑลผิงตง	Bình Đông
建立分組	グループを作成	그룹 만들기	สร้างกลุ่ม	Tạo nhóm
建立活動	活動を作成	활동 만들기	สร้างกิจกรรม	Tạo hoạt động
建立活動連結	活動リンクを作成	활동 링크 만들기	สร้างลิงก์กิจกรรม	Tạo liên kết hoạt động
建立俱樂部	クラブを作成	클럽 만들기	สร้างคลับ	Tạo CLB
建立賽事	大会を作成	대회 만들기	สร้างการแข่งขัน	Tạo giải đấu
建議尺寸 400 × 300 px｜JPG / PNG｜每張最大 2MB	推奨サイズ 400 × 300 px｜JPG / PNG｜各最大2MB	권장 크기 400 × 300 px｜JPG / PNG｜각 최대 2MB	ขนาดแนะนำ 400 × 300 px｜JPG / PNG｜สูงสุดรูปละ 2MB	Kích thước đề xuất 400 × 300 px｜JPG / PNG｜Tối đa 2MB mỗi ảnh
建議尺寸 800 × 300 px｜JPG / PNG｜最大 2MB	推奨サイズ 800 × 300 px｜JPG / PNG｜最大2MB	권장 크기 800 × 300 px｜JPG / PNG｜최대 2MB	ขนาดแนะนำ 800 × 300 px｜JPG / PNG｜สูงสุด 2MB	Kích thước đề xuất 800 × 300 px｜JPG / PNG｜Tối đa 2MB
建議尺寸 800 × 600 px｜JPG / PNG｜最大 2MB	推奨サイズ 800 × 600 px｜JPG / PNG｜最大2MB	권장 크기 800 × 600 px｜JPG / PNG｜최대 2MB	ขนาดแนะนำ 800 × 600 px｜JPG / PNG｜สูงสุด 2MB	Kích thước đề xuất 800 × 600 px｜JPG / PNG｜Tối đa 2MB
指派學員到分組	生徒をグループに割り当て	학생을 그룹에 배정	มอบหมายนักเรียนเข้ากลุ่ม	Gán học viên vào nhóm
活動	活動	활동	กิจกรรม	Hoạt động
活動日期	活動日	활동 날짜	วันที่กิจกรรม	Ngày hoạt động
活動名稱	活動名	활동 이름	ชื่อกิจกรรม	Tên hoạt động
活動地區	活動地域	활동 지역	พื้นที่กิจกรรม	Khu vực hoạt động
活動行事曆	活動カレンダー	활동 캘린더	ปฏิทินกิจกรรม	Lịch hoạt động
活動封面圖片	活動カバー画像	활동 커버 이미지	รูปปกกิจกรรม	Ảnh bìa hoạt động
活動後評分	活動後評価	활동 후 평가	ให้คะแนนหลังกิจกรรม	Đánh giá sau hoạt động
活動時間	活動時間	활동 시간	เวลากิจกรรม	Thời gian hoạt động
活動統計	活動統計	활동 통계	สถิติกิจกรรม	Thống kê hoạt động
活動開始前	活動開始前	활동 시작 전	ก่อนกิจกรรมเริ่ม	Trước khi hoạt động bắt đầu
活動資料載入中...	活動データを読み込み中...	활동 데이터 로딩 중...	กำลังโหลดข้อมูลกิจกรรม...	Đang tải dữ liệu hoạt động...
活動圖片 800 × 300	活動画像 800 × 300	활동 이미지 800 × 300	รูปกิจกรรม 800 × 300	Ảnh hoạt động 800 × 300
活動管理	活動管理	활동 관리	จัดการกิจกรรม	Quản lý hoạt động
活動說明（上限 500 字）	活動説明（最大500文字）	활동 설명(최대 500자)	คำอธิบายกิจกรรม (สูงสุด 500 ตัวอักษร)	Mô tả hoạt động (tối đa 500 ký tự)
活動類型	活動タイプ	활동 유형	ประเภทกิจกรรม	Loại hoạt động
盃賽	カップ戦	컵 대회	การแข่งขันถ้วย	Giải cúp
紅黃牌規則（預設英超）	レッド／イエローカード規則（初期値：EPL）	레드/옐로카드 규칙(기본 EPL)	กฎใบแดง/ใบเหลือง (ค่าเริ่มต้น EPL)	Quy tắc thẻ đỏ/vàng (mặc định EPL)
苗栗縣	苗栗県	먀오리현	เทศมณฑลเหมียวลี่	Miêu Lật
英文名稱	英語名	영문 이름	ชื่อภาษาอังกฤษ	Tên tiếng Anh
重新整理	更新	새로고침	รีเฟรช	Làm mới
重試	再試行	다시 시도	ลองอีกครั้ง	Thử lại
限女生	女性限定	여성 한정	จำกัดผู้หญิง	Chỉ nữ
限男生	男性限定	남성 한정	จำกัดผู้ชาย	Chỉ nam
首頁	ホーム	홈	หน้าแรก	Trang chủ
俱樂部	クラブ	클럽	คลับ	CLB
俱樂部名稱	クラブ名	클럽 이름	ชื่อคลับ	Tên CLB
俱樂部封面	クラブカバー	클럽 커버	ปกคลับ	Bìa CLB
俱樂部封面 800 × 300	クラブカバー 800 × 300	클럽 커버 800 × 300	ปกคลับ 800 × 300	Bìa CLB 800 × 300
俱樂部限定	クラブ限定	클럽 전용	เฉพาะคลับ	Chỉ CLB
俱樂部設定	クラブ設定	클럽 설정	ตั้งค่าคลับ	Cài đặt CLB
俱樂部管理	クラブ管理	클럽 관리	จัดการคลับ	Quản lý CLB
俱樂部簡介	クラブ紹介	클럽 소개	แนะนำคลับ	Giới thiệu CLB
俱樂部類型	クラブタイプ	클럽 유형	ประเภทคลับ	Loại CLB
個人檔案	プロフィール	프로필	โปรไฟล์	Hồ sơ
時	時	시	ชั่วโมง	Giờ
桃園市	桃園市	타오위안시	เมืองเถาหยวน	Đào Viên
消耗積分	消費ポイント	소모 포인트	แต้มที่ใช้	Điểm tiêu hao
送出申請	申請を送信	신청 제출	ส่งคำขอ	Gửi yêu cầu
高強度	高強度	고강도	ความเข้มข้นสูง	Cường độ cao
高雄市	高雄市	가오슝시	เมืองเกาสง	Cao Hùng
偵測網路環境中..	ネットワーク環境を確認中..	네트워크 환경 확인 중..	กำลังตรวจสอบเครือข่าย..	Đang kiểm tra mạng..
區間前＝準備中，區間內＝報名中，區間後＝截止報名	期間前＝準備中、期間中＝受付中、期間後＝受付終了	기간 전=준비 중, 기간 중=등록 중, 기간 후=등록 마감	ก่อนช่วง=เตรียมพร้อม ในช่วง=เปิดรับสมัคร หลังช่วง=ปิดรับสมัคร	Trước thời gian = chuẩn bị, trong thời gian = đang đăng ký, sau thời gian = hết hạn đăng ký
參賽隊伍數	参加チーム数	참가 팀 수	จำนวนทีมที่เข้าร่วม	Số đội tham gia
商品名稱	商品名	상품명	ชื่อสินค้า	Tên sản phẩm
商品描述（上限 500 字）	商品説明（最大500文字）	상품 설명(최대 500자)	คำอธิบายสินค้า (สูงสุด 500 ตัวอักษร)	Mô tả sản phẩm (tối đa 500 ký tự)
商品圖片（最多 3 張）	商品画像（最大3枚）	상품 이미지(최대 3장)	รูปสินค้า (สูงสุด 3 รูป)	Ảnh sản phẩm (tối đa 3)
國籍	国籍	국적	สัญชาติ	Quốc tịch
基隆市	基隆市	지룽시	เมืองจีหลง	Cơ Long
從範本建立	テンプレートから作成	템플릿으로 만들기	สร้างจากเทมเพลต	Tạo từ mẫu
掃碼查看個人資料卡片	スキャンしてプロフィールカードを表示	스캔하여 프로필 카드 보기	สแกนเพื่อดูการ์ดข้อมูล	Quét để xem thẻ hồ sơ
排行榜	ランキング	순위표	กระดานอันดับ	Bảng xếp hạng
接受新學員報名	新規生徒の申込を受け付け	신규 학생 신청 받기	รับสมัครนักเรียนใหม่	Nhận đăng ký học viên mới
啟用	有効化	사용	เปิดใช้	Bật
啟用後會直接以第二身份顯示	有効化するとサブIDとして表示されます	사용하면 보조 신원으로 바로 표시됩니다	เมื่อเปิดใช้จะแสดงเป็นตัวตนรองทันที	Khi bật sẽ hiển thị trực tiếp bằng danh tính phụ
教練（可多位）	コーチ（複数可）	코치(여러 명 가능)	โค้ช (ได้หลายคน)	Huấn luyện viên (có thể nhiều)
教學	レッスン	강습	สอน	Lớp học
教學俱樂部	レッスンクラブ	교육 클럽	คลับสอน	CLB đào tạo
深色模式	ダークモード	다크 모드	โหมดมืด	Chế độ tối
清除	クリア	지우기	ล้าง	Xóa
清除快取	キャッシュをクリア	캐시 지우기	ล้างแคช	Xóa bộ nhớ đệm
清除定位	位置情報をクリア	위치 지우기	ล้างตำแหน่ง	Xóa vị trí
清除頭像	アバターを削除	아바타 지우기	ล้างรูปโปรไฟล์	Xóa ảnh đại diện
現場簽到	現地チェックイン	현장 체크인	เช็กอินหน้างาน	Điểm danh tại chỗ
球衣	ユニフォーム	유니폼	เสื้อทีม	Áo đấu
球鞋	シューズ	축구화	รองเท้า	Giày
第二身份	サブID	보조 신원	ตัวตนรอง	Danh tính phụ
組建競技團隊，管理成員、賽事與戰績	競技チームを作り、メンバー、大会、成績を管理します	경쟁 팀을 만들고 멤버, 경기, 전적을 관리합니다	สร้างทีมแข่งขัน จัดการสมาชิก การแข่งขัน และผลงาน	Xây dựng đội thi đấu, quản lý thành viên, giải đấu và thành tích
設定地圖座標	地図座標を設定	지도 좌표 설정	ตั้งค่าพิกัดแผนที่	Đặt tọa độ bản đồ
通知	通知	알림	การแจ้งเตือน	Thông báo
通知設定	通知設定	알림 설정	ตั้งค่าการแจ้งเตือน	Cài đặt thông báo
連江縣	連江県	롄장현	เทศมณฑลเหลียนเจียง	Liên Giang
部分活動可能會依性別、年齡或地區設定參與條件，請協助填寫相關資料以利系統判定。	一部の活動は性別、年齢、地域で参加条件を設定する場合があります。判定のため関連情報を入力してください。	일부 활동은 성별, 나이 또는 지역에 따라 참가 조건이 설정될 수 있습니다. 시스템 판단을 위해 관련 정보를 입력해 주세요.	บางกิจกรรมอาจกำหนดเงื่อนไขตามเพศ อายุ หรือพื้นที่ กรุณากรอกข้อมูลที่เกี่ยวข้องเพื่อให้ระบบตรวจสอบ	Các hoạt động có thể đặt điều kiện theo giới tính, tuổi hoặc khu vực. Vui lòng điền thông tin liên quan để hệ thống kiểm tra.
備註	備考	비고	หมายเหตุ	Ghi chú
最大年齡	最高年齢	최대 연령	อายุสูงสุด	Tuổi tối đa
最小年齡	最低年齢	최소 연령	อายุต่ำสุด	Tuổi tối thiểu
最多 5 個。系統會依網址自動判斷 LINE、Facebook、Instagram、YouTube 等常見社群圖示。	最大5個。URLからLINE、Facebook、Instagram、YouTubeなどの一般的なSNSアイコンを自動判定します。	최대 5개. 시스템이 URL로 LINE, Facebook, Instagram, YouTube 등 일반 소셜 아이콘을 자동 판별합니다.	สูงสุด 5 รายการ ระบบจะดู URL แล้วระบุไอคอนโซเชียลทั่วไป เช่น LINE, Facebook, Instagram, YouTube อัตโนมัติ	Tối đa 5. Hệ thống tự nhận diện biểu tượng xã hội phổ biến như LINE, Facebook, Instagram, YouTube theo URL.
最新上架	新着順	최신 등록순	ล่าสุดก่อน	Mới nhất trước
最舊上架	古い順	오래된순	เก่าสุดก่อน	Cũ nhất trước
創立年份	設立年	창립 연도	ปีที่ก่อตั้ง	Năm thành lập
勝利：3分 ・ 平手：1分 ・ 落敗：0分	勝利：3点 ・ 引き分け：1点 ・ 敗北：0点	승리: 3점 ・ 무승부: 1점 ・ 패배: 0점	ชนะ: 3 แต้ม ・ เสมอ: 1 แต้ม ・ แพ้: 0 แต้ม	Thắng: 3 điểm ・ Hòa: 1 điểm ・ Thua: 0 điểm
報名	登録	등록	สมัคร	Đăng ký
報名中	受付中	등록 중	เปิดรับสมัคร	Đang mở
報名前問卷	登録前アンケート	등록 전 설문	แบบสอบถามก่อนสมัคร	Bảng hỏi trước đăng ký
報名紀錄	登録記録	등록 기록	ประวัติการสมัคร	Lịch sử đăng ký
報名時用戶可以	登録時にユーザーは	등록 시 사용자는	เมื่อสมัคร ผู้ใช้สามารถ	Khi đăng ký, người dùng có thể
報名費（每隊）	参加費（1チーム）	등록비(팀당)	ค่าสมัคร (ต่อทีม)	Lệ phí đăng ký (mỗi đội)
報名開放：建立後立即開放報名	登録開始：作成後すぐに受付開始	등록 오픈: 생성 후 즉시 등록 오픈	เปิดรับสมัคร: เปิดทันทีหลังสร้าง	Mở đăng ký: mở ngay sau khi tạo
報名開放日期	登録開始日	등록 오픈 날짜	วันที่เปิดรับสมัคร	Ngày mở đăng ký
報名開放時間	登録開始時間	등록 오픈 시간	เวลาเปิดรับสมัคร	Giờ mở đăng ký
場地（可新增多個）	会場（複数追加可）	장소(여러 개 추가 가능)	สถานที่ (เพิ่มได้หลายแห่ง)	Sân/địa điểm (có thể thêm nhiều)
尋找附近活動	近くの活動を探す	근처 활동 찾기	ค้นหากิจกรรมใกล้เคียง	Tìm hoạt động gần đây
描述商品狀況、使用次數、附贈配件等...	商品の状態、使用回数、付属品などを説明...	상품 상태, 사용 횟수, 포함 액세서리 등을 설명...	อธิบายสภาพสินค้า จำนวนครั้งที่ใช้ อุปกรณ์ที่แถม ฯลฯ...	Mô tả tình trạng, số lần sử dụng, phụ kiện kèm theo...
普通稱號	通常称号	일반 칭호	ฉายาทั่วไป	Danh hiệu thường
登出	ログアウト	로그아웃	ออกจากระบบ	Đăng xuất
稍後填寫	後で入力	나중에 입력	กรอกภายหลัง	Điền sau
結束	終了	종료	จบ	Kết thúc
結束時間	終了時間	종료 시간	เวลาสิ้นสุด	Thời gian kết thúc
統計	統計	통계	สถิติ	Thống kê
裁判（最多 10 人）	審判（最大10人）	심판(최대 10명)	กรรมการ (สูงสุด 10 คน)	Trọng tài (tối đa 10 người)
費用 ($)	費用 ($)	비용 ($)	ค่าใช้จ่าย ($)	Phí ($)
貼上 LINE、Facebook、Instagram、YouTube 等網址，系統會自動辨識並顯示為聯繫按鈕。最多 5 個。	LINE、Facebook、Instagram、YouTubeなどのURLを貼り付けると、システムが自動判別して連絡ボタンとして表示します。最大5個。	LINE, Facebook, Instagram, YouTube 등 URL을 붙여넣으면 시스템이 자동 인식해 연락 버튼으로 표시합니다. 최대 5개.	วาง URL เช่น LINE, Facebook, Instagram, YouTube ระบบจะรู้จักและแสดงเป็นปุ่มติดต่ออัตโนมัติ สูงสุด 5 รายการ	Dán URL LINE, Facebook, Instagram, YouTube... Hệ thống sẽ tự nhận diện và hiển thị thành nút liên hệ. Tối đa 5.
週	週	주	สัปดาห์	Tuần
進行中	進行中	진행 중	กำลังดำเนินการ	Đang diễn ra
進階功能	詳細機能	고급 기능	ฟังก์ชันขั้นสูง	Tính năng nâng cao
開始	開始	시작	เริ่ม	Bắt đầu
開始前	開始前	시작 전	ก่อนเริ่ม	Trước khi bắt đầu
開始時間	開始時間	시작 시간	เวลาเริ่ม	Thời gian bắt đầu
開放日期	公開日	오픈 날짜	วันที่เปิด	Ngày mở
開放時間	公開時間	오픈 시간	เวลาเปิด	Giờ mở
開放報名時間	登録開始時間	등록 오픈 시간	เวลาเปิดรับสมัคร	Thời gian mở đăng ký
開啟 — 指定活動地區	オン — 活動地域を指定	켜기 - 활동 지역 지정	เปิด — ระบุพื้นที่กิจกรรม	Bật - chỉ định khu vực hoạt động
開啟後活動不會顯示在列表中，僅能透過分享連結查看	有効にすると活動は一覧に表示されず、共有リンクからのみ閲覧できます	켜면 활동이 목록에 표시되지 않고 공유 링크로만 볼 수 있습니다	เมื่อเปิดแล้ว กิจกรรมจะไม่แสดงในรายการ ดูได้ผ่านลิงก์แชร์เท่านั้น	Khi bật, hoạt động sẽ không hiển thị trong danh sách, chỉ xem qua liên kết chia sẻ.
開啟後新學員可透過俱樂部頁面申請加入，關閉後將暫停招收新學員，已報名學員不受影響。	有効にすると新規生徒がクラブページから参加申請できます。無効にすると新規募集を停止し、既存の登録生徒には影響しません。	켜면 새 학생이 클럽 페이지에서 가입 신청할 수 있습니다. 끄면 신규 모집이 중단되며 기존 등록 학생은 영향을 받지 않습니다.	เมื่อเปิด นักเรียนใหม่จะสมัครเข้าร่วมจากหน้าคลับได้ เมื่อปิดจะหยุดรับสมัครใหม่ นักเรียนที่สมัครแล้วจะไม่ได้รับผลกระทบ	Khi bật, học viên mới có thể đăng ký từ trang CLB. Khi tắt sẽ tạm dừng tuyển học viên mới; học viên đã đăng ký không bị ảnh hưởng.
開設課程教學，管理學員報名與課程排程	レッスンを開設し、生徒登録とスケジュールを管理します	수업을 개설하고 학생 등록과 수업 일정을 관리합니다	เปิดคอร์สสอน จัดการสมัครนักเรียนและตารางเรียน	Mở lớp học, quản lý đăng ký học viên và lịch học
隊	チーム	팀	ทีม	Đội
集點卡	ポイントカード	스탬프 카드	บัตรสะสมแต้ม	Thẻ tích điểm
雲林縣	雲林県	윈린현	เทศมณฑลหยุนหลิน	Vân Lâm
僅限 https:// 開頭的連結	https:// で始まるリンクのみ	https://로 시작하는 링크만 허용	อนุญาตเฉพาะลิงก์ที่ขึ้นต้นด้วย https://	Chỉ cho phép liên kết bắt đầu bằng https://
填寫 Email 後，未來可收到第一手運動活動通知、早鳥名額提醒、候補釋出與平台重要訊息；不填也可以完成資料。	Emailを入力すると、今後スポーツ活動のお知らせ、早割枠、キャンセル待ち解放、重要なお知らせを受け取れます。未入力でもプロフィールは完了できます。	Email을 입력하면 향후 활동 알림, 얼리버드 자리 안내, 대기자 해제 및 플랫폼 중요 소식을 받을 수 있습니다. 입력하지 않아도 완료할 수 있습니다.	กรอก Email เพื่อรับข่าวกิจกรรมกีฬา แจ้งเตือน Early-bird การปล่อยที่ว่าง และข่าวสำคัญของแพลตฟอร์ม ไม่กรอกก็ทำข้อมูลให้ครบได้	Thêm Email để nhận thông báo hoạt động, nhắc suất sớm, mở danh sách chờ và tin quan trọng. Không điền vẫn hoàn tất hồ sơ được.
搜尋用戶...	ユーザーを検索...	사용자 검색...	ค้นหาผู้ใช้...	Tìm người dùng...
搜尋俱樂部名稱	クラブ名を検索	클럽 이름 검색	ค้นหาชื่อคลับ	Tìm tên CLB
搜尋俱樂部名稱...	クラブ名を検索...	클럽 이름 검색...	ค้นหาชื่อคลับ...	Tìm tên CLB...
搜尋俱樂部領隊：輸入暱稱後點選加入（可複數）	クラブリーダーを検索：ニックネームを入力して追加（複数可）	클럽 리더 검색: 닉네임을 입력한 후 클릭해 추가(복수 가능)	ค้นหาหัวหน้าคลับ: ใส่ชื่อเล่นแล้วกดเพิ่ม (ได้หลายคน)	Tìm đội trưởng CLB: nhập biệt danh rồi chọn để thêm (có thể nhiều)
搜尋運動 / 場景標籤	スポーツ／シーンタグを検索	스포츠/장면 태그 검색	ค้นหากีฬา / แท็กสถานการณ์	Tìm thẻ môn thể thao / bối cảnh
搜尋與篩選活動	活動を検索・絞り込み	활동 검색 및 필터	ค้นหาและกรองกิจกรรม	Tìm kiếm và lọc hoạt động
搜尋與篩選俱樂部	クラブを検索・絞り込み	클럽 검색 및 필터	ค้นหาและกรองคลับ	Tìm kiếm và lọc CLB
搜尋與篩選賽事	大会を検索・絞り込み	대회 검색 및 필터	ค้นหาและกรองการแข่งขัน	Tìm kiếm và lọc giải đấu
搜尋賽事名稱...	大会名を検索...	대회 이름 검색...	ค้นหาชื่อการแข่งขัน...	Tìm tên giải đấu...
新手友善	初心者歓迎	초보자 친화	เหมาะกับมือใหม่	Thân thiện với người mới
新北市	新北市	신베이시	เมืองนิวไทเป	Tân Bắc
新竹市	新竹市	신주시	เมืองซินจู๋	Tân Trúc
新竹縣	新竹県	신주현	เทศมณฑลซินจู๋	Tân Trúc
新增	追加	추가	เพิ่ม	Thêm
新增二手商品	中古商品を追加	중고 상품 추가	เพิ่มสินค้ามือสอง	Thêm đồ cũ
新增同行者	同行者を追加	동행자 추가	เพิ่มผู้ร่วมเดินทาง	Thêm người đi cùng
新增活動	活動を追加	활동 추가	เพิ่มกิจกรรม	Thêm hoạt động
新增活動連結	活動リンクを追加	활동 링크 추가	เพิ่มลิงก์กิจกรรม	Thêm liên kết hoạt động
新增俱樂部	クラブを追加	클럽 추가	เพิ่มคลับ	Thêm CLB
新增賽事	大会を追加	대회 추가	เพิ่มการแข่งขัน	Thêm giải đấu
新舊程度	状態	상태	สภาพสินค้า	Tình trạng
綁定時間	連携時間	연동 시간	เวลาผูกบัญชี	Thời gian liên kết
解除綁定	連携解除	연동 해제	ยกเลิกการผูก	Hủy liên kết
運動 / 場景標籤	スポーツ／シーンタグ	스포츠/장면 태그	กีฬา / แท็กสถานการณ์	Thẻ môn thể thao / bối cảnh
運動俱樂部	スポーツクラブ	스포츠 클럽	คลับกีฬา	CLB thể thao
運動類別	スポーツ種別	스포츠 유형	ประเภทกีฬา	Loại môn thể thao
道具欄	インベントリ	인벤토리	คลังไอเท็ม	Túi đồ
預留 — 尚未啟用	予約 — 未有効	예약됨 - 아직 사용 안 함	สำรอง — ยังไม่เปิดใช้	Dự phòng - chưa bật
嘉義市	嘉義市	자이시	เมืองเจียอี้	Gia Nghĩa
嘉義縣	嘉義県	자이현	เทศมณฑลเจียอี้	Gia Nghĩa
彰化縣	彰化県	장화현	เทศมณฑลจางฮว่า	Chương Hóa
稱號	称号	칭호	ฉายา	Danh hiệu
稱號設定	称号設定	칭호 설정	ตั้งค่าฉายา	Cài đặt danh hiệu
語言	言語	언어	ภาษา	Ngôn ngữ
說明	ヘルプ	도움말	คำอธิบาย	Trợ giúp
模糊搜尋名稱 / 地點 / 主辦 / 日期...	名前 / 場所 / 主催 / 日付を検索...	이름 / 장소 / 주최 / 날짜 검색...	ค้นหาชื่อ / สถานที่ / ผู้จัด / วันที่...	Tìm tên / địa điểm / chủ trì / ngày...
澎湖縣	澎湖県	펑후현	เทศมณฑลเผิงหู	Bành Hồ
確定	OK	확인	ตกลง	OK
確認	確認	확인	ยืนยัน	Xác nhận
確認刪除	削除を確認	삭제 확인	ยืนยันการลบ	Xác nhận xóa
確認刪除層級	階層削除を確認	계층 삭제 확인	ยืนยันลบระดับ	Xác nhận xóa cấp
確認取消	キャンセルを確認	취소 확인	ยืนยันการยกเลิก	Xác nhận hủy
確認報名	登録を確認	등록 확인	ยืนยันการสมัคร	Xác nhận đăng ký
確認操作	操作を確認	작업 확인	ยืนยันการดำเนินการ	Xác nhận thao tác
範本名稱（例：週六友誼賽）	テンプレート名（例：土曜親善試合）	템플릿 이름(예: 토요일 친선전)	ชื่อเทมเพลต (เช่น เกมกระชับมิตรวันเสาร์)	Tên mẫu (VD: giao hữu thứ Bảy)
範本名稱（例：XX 平台足球活動）	テンプレート名（例：XXプラットフォームのサッカー活動）	템플릿 이름(예: XX 플랫폼 축구 활동)	ชื่อเทมเพลต (เช่น กิจกรรมฟุตบอลแพลตฟอร์ม XX)	Tên mẫu (VD: hoạt động bóng đá nền tảng XX)
編輯	編集	편집	แก้ไข	Chỉnh sửa
編輯社群連結	SNSリンクを編集	소셜 링크 편집	แก้ไขลิงก์โซเชียล	Chỉnh sửa liên kết mạng xã hội
編輯俱樂部	クラブを編集	클럽 편집	แก้ไขคลับ	Chỉnh sửa CLB
編輯學員	生徒を編集	학생 편집	แก้ไขนักเรียน	Chỉnh sửa học viên
複製連結用 LINE 開啟（最快）	リンクをコピーしてLINEで開く（最速）	링크를 복사해 LINE에서 열기(가장 빠름)	คัดลอกลิงก์แล้วเปิดด้วย LINE (เร็วที่สุด)	Sao chép liên kết và mở bằng LINE (nhanh nhất)
課程方案	コースプラン	수업 플랜	แพ็กเกจคอร์ส	Gói khóa học
課程簽到	レッスンチェックイン	수업 체크인	เช็กอินคอร์ส	Điểm danh khóa học
請先使用 LINE 帳號登入以查看個人資料	プロフィールを見るにはLINEアカウントでログインしてください	프로필을 보려면 LINE 계정으로 로그인하세요	กรุณาเข้าสู่ระบบด้วยบัญชี LINE เพื่อดูข้อมูลส่วนตัว	Vui lòng đăng nhập bằng tài khoản LINE để xem hồ sơ
請稍候，正在載入相關資料..	しばらくお待ちください。関連データを読み込み中..	잠시만 기다려 주세요. 관련 데이터를 불러오는 중..	กรุณารอสักครู่ กำลังโหลดข้อมูลที่เกี่ยวข้อง..	Vui lòng chờ, đang tải dữ liệu liên quan..
請選擇	選択してください	선택하세요	กรุณาเลือก	Vui lòng chọn
請選擇要取消的報名：	キャンセルする登録を選択：	취소할 등록을 선택하세요:	เลือกการสมัครที่จะยกเลิก:	Chọn đăng ký muốn hủy:
請選擇運動 / 場景標籤	スポーツ／シーンタグを選択	스포츠/장면 태그 선택	เลือกกีฬา / แท็กสถานการณ์	Chọn thẻ môn thể thao / bối cảnh
學員列表	生徒リスト	학생 목록	รายชื่อนักเรียน	Danh sách học viên
學員姓名	生徒名	학생 이름	ชื่อนักเรียน	Tên học viên
學員招募狀態	生徒募集状態	학생 모집 상태	สถานะรับสมัครนักเรียน	Trạng thái tuyển học viên
學員的姓名	生徒の名前	학생 이름	ชื่อนักเรียน	Tên học viên
積分規則	ポイントルール	포인트 규칙	กฎคะแนน	Quy tắc điểm
篩選主辦人...	主催者を絞り込み...	주최자 필터...	กรองผู้จัด...	Lọc chủ trì...
輸入姓名	名前を入力	이름 입력	ใส่ชื่อ	Nhập tên
輸入或選擇縣市	市／県を入力または選択	시/군 입력 또는 선택	พิมพ์หรือเลือกเมือง/จังหวัด	Nhập hoặc chọn thành phố/tỉnh
輸入或選擇縣市...	市／県を入力または選択...	시/군 입력 또는 선택...	พิมพ์หรือเลือกเมือง/จังหวัด...	Nhập hoặc chọn thành phố/tỉnh...
輸入搜尋縣市...	市／県を検索...	시/군 검색...	ค้นหาเมือง/จังหวัด...	Tìm thành phố/tỉnh...
輸入縣市名稱	市／県名を入力	시/군 이름 입력	ใส่ชื่อเมือง/จังหวัด	Nhập tên thành phố/tỉnh
選單	メニュー	메뉴	เมนู	Menu
選填，例：台北市大安運動中心	任意、例：台北市大安スポーツセンター	선택, 예: 타이베이 다안 스포츠센터	ไม่บังคับ เช่น ศูนย์กีฬา Daan เมืองไทเป	Tùy chọn, VD: Trung tâm thể thao Daan, Đài Bắc
選填說明	任意の説明	선택 설명	คำอธิบายเพิ่มเติม	Mô tả tùy chọn
選擇日期	日付を選択	날짜 선택	เลือกวันที่	Chọn ngày
選擇俱樂部類型	クラブタイプを選択	클럽 유형 선택	เลือกประเภทคลับ	Chọn loại CLB
選擇參與者	参加者を選択	참가자 선택	เลือกผู้เข้าร่วม	Chọn người tham gia
儲存	保存	저장	บันทึก	Lưu
儲存為範本	テンプレートとして保存	템플릿으로 저장	บันทึกเป็นเทมเพลต	Lưu làm mẫu
儲存稱號	称号を保存	칭호 저장	บันทึกฉายา	Lưu danh hiệu
徽章	バッジ	배지	เหรียญตรา	Huy hiệu
應到場次	予定セッション	예정 세션	รอบที่ควรเข้าร่วม	Số buổi cần tham dự
聯繫方式	連絡方法	연락처	ช่องทางติดต่อ	Liên hệ
賽事	大会	대회	การแข่งขัน	Giải đấu
賽事中心	大会センター	대회 센터	ศูนย์การแข่งขัน	Trung tâm giải đấu
賽事內容圖片	大会内容画像	대회 내용 이미지	รูปเนื้อหาการแข่งขัน	Ảnh nội dung giải đấu
賽事名稱	大会名	대회 이름	ชื่อการแข่งขัน	Tên giải đấu
賽事封面圖片	大会カバー画像	대회 커버 이미지	รูปปกการแข่งขัน	Ảnh bìa giải đấu
賽事規則	大会ルール	대회 규칙	กติกาการแข่งขัน	Quy tắc giải đấu
賽事規則、注意事項...	大会ルール、注意事項...	대회 규칙, 주의사항...	กติกาและข้อควรทราบ...	Quy tắc giải đấu, lưu ý...
賽事圖片 800 × 300	大会画像 800 × 300	대회 이미지 800 × 300	รูปการแข่งขัน 800 × 300	Ảnh giải đấu 800 × 300
賽事類型	大会タイプ	대회 유형	ประเภทการแข่งขัน	Loại giải đấu
賽程	日程	일정	ตารางแข่ง	Lịch thi đấu
隱私權政策	プライバシーポリシー	개인정보 처리방침	นโยบายความเป็นส่วนตัว	Chính sách quyền riêng tư
點擊上傳圖片	クリックして画像をアップロード	클릭하여 이미지 업로드	คลิกเพื่ออัปโหลดรูปภาพ	Nhấn để tải ảnh lên
點擊今日不再顯示	クリックして今日は表示しない	클릭하면 오늘 다시 보지 않음	คลิกเพื่อไม่แสดงอีกวันนี้	Nhấn để hôm nay không hiện nữa
點擊月曆勾選所有比賽日	カレンダーをクリックして全試合日を選択	달력을 클릭해 모든 경기일 선택	คลิกปฏิทินเพื่อเลือกวันแข่งขันทั้งหมด	Nhấn lịch để chọn tất cả ngày thi đấu
點擊換色	クリックして色を変更	클릭해 색상 변경	คลิกเพื่อเปลี่ยนสี	Nhấn để đổi màu
瀏覽次數	閲覧数	조회수	จำนวนการดู	Lượt xem
簡短介紹俱樂部（最多 500 字）	クラブを簡単に紹介（最大500文字）	클럽을 간단히 소개(최대 500자)	แนะนำคลับสั้นๆ (สูงสุด 500 ตัวอักษร)	Giới thiệu ngắn về CLB (tối đa 500 ký tự)
轉移俱樂部經理前請確認：俱樂部經理只能有一位，不是可複選的領隊欄位。儲存後管理權限會轉給新經理，原經理可能失去此俱樂部管理權限。	クラブマネージャーを移譲する前に確認してください：クラブマネージャーは1名のみで、複数選択できるリーダー欄ではありません。保存後、管理権限は新しいマネージャーに移り、元マネージャーはこのクラブの管理権限を失う可能性があります。	클럽 매니저 이전 전 확인하세요: 클럽 매니저는 한 명만 가능하며, 복수 선택 가능한 리더 필드가 아닙니다. 저장 후 관리 권한이 새 매니저에게 이전되며 기존 매니저는 이 클럽 관리 권한을 잃을 수 있습니다.	ก่อนโอนผู้จัดการคลับ โปรดยืนยัน: ผู้จัดการคลับมีได้เพียงหนึ่งคน ไม่ใช่ช่องหัวหน้าที่เลือกได้หลายคน หลังบันทึก สิทธิ์จัดการจะโอนไปยังผู้จัดการใหม่ และผู้จัดการเดิมอาจเสียสิทธิ์จัดการคลับนี้	Trước khi chuyển quản lý CLB, hãy xác nhận: mỗi CLB chỉ có một quản lý, không phải trường đội trưởng chọn nhiều. Sau khi lưu, quyền quản lý sẽ chuyển cho quản lý mới và quản lý cũ có thể mất quyền quản lý CLB này.
雙週	隔週	격주	สองสัปดาห์ครั้ง	Hai tuần một lần
簽到 QR Code	チェックインQRコード	체크인 QR Code	QR Code เช็กอิน	QR Code điểm danh
簽到資訊	チェックイン情報	체크인 정보	ข้อมูลเช็กอิน	Thông tin điểm danh
關閉	閉じる	닫기	ปิด	Đóng
關閉 — 不收費	オフ — 無料	끄기 - 무료	ปิด — ไม่เก็บค่าใช้จ่าย	Tắt - không thu phí
關閉 — 不限制性別	オフ — 性別制限なし	끄기 - 성별 제한 없음	ปิด — ไม่จำกัดเพศ	Tắt - không giới hạn giới tính
關閉 — 所有人可見	オフ — 全員に表示	끄기 - 모두에게 표시	ปิด — ทุกคนมองเห็น	Tắt - mọi người đều thấy
關閉時建立後立即開放報名；開啟後可指定開放日期與時間。	オフの場合は作成後すぐ受付開始。オンの場合は開始日と時間を指定できます。	끄면 생성 후 즉시 등록이 열립니다. 켜면 오픈 날짜와 시간을 지정할 수 있습니다.	เมื่อปิด จะเปิดรับสมัครทันทีหลังสร้าง เมื่อเปิด จะกำหนดวันที่และเวลาเปิดได้	Khi tắt, đăng ký mở ngay sau khi tạo; khi bật, có thể chỉ định ngày và giờ mở.
繼續登入	ログインを続行	로그인 계속	เข้าสู่ระบบต่อ	Tiếp tục đăng nhập
護具	プロテクター	보호 장비	อุปกรณ์ป้องกัน	Đồ bảo hộ
顯示於說明頁文字下方，用於圖片補充說明	説明ページのテキスト下に表示され、画像の補足説明に使用されます	설명 페이지 텍스트 아래에 표시되며 이미지 보충 설명에 사용됩니다	แสดงใต้ข้อความคำอธิบาย ใช้เป็นคำอธิบายเพิ่มเติมของรูปภาพ	Hiển thị dưới phần chữ hướng dẫn, dùng để bổ sung chú thích ảnh
觀賽	観戦	관전	ชมการแข่งขัน	Xem thi đấu
GPS功能	GPS機能	GPS 기능	ฟังก์ชัน GPS	Tính năng GPS
LINE 帳號	LINEアカウント	LINE 계정	บัญชี LINE	Tài khoản LINE
LINE 推播通知	LINEプッシュ通知	LINE 푸시 알림	การแจ้งเตือน LINE	Thông báo đẩy LINE
LINE 暱稱	LINEニックネーム	LINE 닉네임	ชื่อเล่น LINE	Biệt danh LINE
`);
const STATIC_UI_SEMANTIC_ZH_TW = {
  "drawer.teamManage": "俱樂部管理",
  "admin.gameManage": "小遊戲管理",
  "admin.notifSettings": "推播通知設定"
};
const STATIC_UI_SEMANTIC_EN = {
  "drawer.teamManage": "Club Management",
  "admin.gameManage": "Mini Game Management",
  "admin.notifSettings": "Push Notification Settings",
  "drawer.applyRole": "Apply for Club / Venue Owner / Coach"
};
const STATIC_UI_SEMANTIC_JA = {
  "drawer.teamManage": "クラブ管理",
  "admin.gameManage": "ミニゲーム管理",
  "admin.notifSettings": "プッシュ通知設定",
  "drawer.applyRole": "クラブ / 会場オーナー / コーチ申請"
};
const STATIC_UI_SEMANTIC_KO = {
  "drawer.teamManage": "클럽 관리",
  "admin.gameManage": "미니게임 관리",
  "admin.notifSettings": "푸시 알림 설정",
  "drawer.applyRole": "클럽 / 장소 소유자 / 코치 신청"
};
const STATIC_UI_SEMANTIC_TH = {
  "drawer.teamManage": "จัดการคลับ",
  "admin.gameManage": "จัดการมินิเกม",
  "admin.notifSettings": "ตั้งค่าการแจ้งเตือน",
  "drawer.applyRole": "สมัครเป็นคลับ / เจ้าของสนาม / โค้ช"
};
const STATIC_UI_SEMANTIC_VI = {
  "drawer.teamManage": "Quản lý CLB",
  "admin.gameManage": "Quản lý mini game",
  "admin.notifSettings": "Cài đặt thông báo đẩy",
  "drawer.applyRole": "Đăng ký CLB / Chủ sân / Huấn luyện viên"
};
Object.assign(I18N._packs['zh-TW'], STATIC_UI_SEMANTIC_ZH_TW);
Object.assign(I18N._packs.en, STATIC_UI_SOURCE_TEXT_EN, STATIC_UI_SEMANTIC_EN);
Object.assign(I18N._packs.ja, STATIC_UI_SOURCE_TEXT_LOCALES.ja, STATIC_UI_SEMANTIC_JA);
Object.assign(I18N._packs.ko, STATIC_UI_SOURCE_TEXT_LOCALES.ko, STATIC_UI_SEMANTIC_KO);
Object.assign(I18N._packs.th, STATIC_UI_SOURCE_TEXT_LOCALES.th, STATIC_UI_SEMANTIC_TH);
Object.assign(I18N._packs.vi, STATIC_UI_SOURCE_TEXT_LOCALES.vi, STATIC_UI_SEMANTIC_VI);

I18N.init();

// Global shortcut
function t(key, vars) { return I18N.t(key, vars); }
