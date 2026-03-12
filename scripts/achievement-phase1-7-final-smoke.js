const fs = require('fs');

function escapeHTML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function makeSelect(value = '') {
  return {
    value,
    innerHTML: '',
    options: [],
    dataset: {},
    style: {},
    addEventListener() {},
    prepend(option) { this.options.unshift(option); },
  };
}

function makeEl(value = '') {
  return {
    value,
    innerHTML: '',
    textContent: '',
    dataset: {},
    style: {},
    addEventListener() {},
    scrollIntoView() {},
  };
}

function createDom() {
  const elements = {
    'achievement-grid': makeEl(),
    'admin-ach-list': makeEl(),
    'ach-cond-timerange': makeSelect('none'),
    'ach-cond-action': makeSelect('complete_event'),
    'ach-cond-filter': makeSelect('all'),
    'ach-cond-threshold': makeEl('1'),
    'ach-cond-preview': makeEl(),
    'ach-cond-streakdays': makeEl('7'),
    'ach-cond-streakdays-row': makeEl(),
    'ach-cond-filter-row': makeEl(),
    'ach-cond-threshold-row': makeEl(),
    'ach-form-card': makeEl(),
    'ach-form-title': makeEl(),
    'ach-input-name': makeEl('Smoke Test Achievement'),
    'ach-input-category': makeEl('bronze'),
    'ach-badge-image': { dataset: {}, files: [], value: '', addEventListener() {} },
    'ach-badge-preview': makeEl(),
    'title-big': makeSelect(''),
    'title-normal': makeSelect(''),
    'title-line-name': makeEl('Applicant'),
    'title-preview': makeEl(),
  };

  global.document = {
    getElementById(id) { return elements[id] || null; },
    createElement(tag) {
      return { tagName: tag, value: '', textContent: '', dataset: {}, style: {}, addEventListener() {} };
    },
    querySelectorAll() { return []; },
  };

  return elements;
}

function load(files) {
  files.forEach((file) => {
    Function(fs.readFileSync(file, 'utf8'))();
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  global.window = global;
  global.escapeHTML = escapeHTML;
  global.ModeManager = { isDemo: () => false, getMode: () => 'production' };
  global.LineAuth = { isLoggedIn: () => false, getProfile: () => null };
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  global.ACHIEVEMENT_CONDITIONS = {
    timeRanges: [{ key: 'none', label: '累計' }],
    actions: [
      { key: 'register_event', label: '報名活動', unit: '場', needsFilter: true },
      { key: 'complete_event', label: '完成活動（簽到+簽退）', unit: '場', needsFilter: true },
      { key: 'attend_play', label: '出席 PLAY 活動', unit: '場', needsFilter: false },
      { key: 'attend_friendly', label: '出席友誼活動', unit: '場', needsFilter: false },
      { key: 'attend_camp', label: '出席教學活動', unit: '場', needsFilter: false },
      { key: 'attend_watch', label: '出席觀賽', unit: '場', needsFilter: false },
      { key: 'attendance_rate', label: '達到出席率', unit: '%', needsFilter: false },
      { key: 'reach_level', label: '達到等級', unit: '', needsFilter: false },
      { key: 'reach_exp', label: '累計 EXP', unit: '', needsFilter: false },
      { key: 'join_team', label: '加入球隊', unit: '', needsFilter: false },
      { key: 'complete_profile', label: '完成個人檔案', unit: '', needsFilter: false },
      { key: 'bind_line_notify', label: '綁定 LINE 推播', unit: '', needsFilter: false },
      { key: 'days_registered', label: '註冊天數', unit: '天', needsFilter: false },
    ],
    filters: [
      { key: 'all', label: '所有類型' },
      { key: 'play', label: 'PLAY' },
      { key: 'friendly', label: '友誼' },
      { key: 'camp', label: '教學' },
      { key: 'watch', label: '觀賽' },
    ],
  };
  global.generateId = (prefix) => `${prefix}_1`;

  const elements = createDom();

  const achievements = [
    { id: 'a-register', name: '初心者', category: 'bronze', badgeId: 'b-register', current: 0, completedAt: null, status: 'active', condition: { timeRange: 'none', action: 'register_event', filter: 'all', threshold: 1 } },
    { id: 'a-complete', name: '鐵人精神', category: 'silver', badgeId: 'b-complete', current: 0, completedAt: null, status: 'active', condition: { timeRange: 'none', action: 'complete_event', filter: 'all', threshold: 1 } },
    { id: 'a-rate', name: '全勤之星', category: 'silver', badgeId: 'b-rate', current: 0, completedAt: null, status: 'active', condition: { timeRange: 'none', action: 'attendance_rate', filter: 'all', threshold: 100 } },
    { id: 'a-join', name: '球隊新人', category: 'gold', badgeId: 'b-join', current: 0, completedAt: null, status: 'active', condition: { timeRange: 'none', action: 'join_team', filter: 'all', threshold: 1 } },
    { id: 'a-profile', name: '個人門面', category: 'gold', badgeId: 'b-profile', current: 0, completedAt: null, status: 'active', condition: { timeRange: 'none', action: 'complete_profile', filter: 'all', threshold: 1 } },
    { id: 'a-legacy-time', name: '月活躍玩家', category: 'gold', badgeId: 'b-legacy-time', current: 0, completedAt: null, status: 'active', condition: { timeRange: '30d', action: 'complete_event', filter: 'all', threshold: 5 } },
    { id: 'a-legacy-action', name: '活動策劃師', category: 'gold', badgeId: 'b-legacy-action', current: 0, completedAt: null, status: 'active', condition: { timeRange: 'none', action: 'organize_event', filter: 'all', threshold: 1 } },
  ];
  const badges = [
    { id: 'b-register', name: '新手徽章', achId: 'a-register', category: 'bronze', image: null },
    { id: 'b-complete', name: '鐵人徽章', achId: 'a-complete', category: 'silver', image: null },
    { id: 'b-rate', name: '全勤徽章', achId: 'a-rate', category: 'silver', image: null },
    { id: 'b-join', name: '球隊新人徽章', achId: 'a-join', category: 'gold', image: null },
    { id: 'b-profile', name: '個人門面徽章', achId: 'a-profile', category: 'gold', image: null },
    { id: 'b-legacy-time', name: '月活躍徽章', achId: 'a-legacy-time', category: 'gold', image: null },
    { id: 'b-legacy-action', name: '策劃師徽章', achId: 'a-legacy-action', category: 'gold', image: null },
    { id: 'b-orphan', name: '孤兒徽章', achId: 'a-missing', category: 'silver', image: null },
  ];
  const users = [
    { uid: 'reviewer', displayName: 'Reviewer', role: 'super_admin', exp: 0, level: 1, lineNotify: { bound: false } },
    { uid: 'applicant', displayName: 'Applicant', role: 'user', exp: 120, level: 3, teamId: 'team-1', teamIds: ['team-1'], lineNotify: { bound: true }, gender: 'M', birthday: '2000/01/01', region: 'Taipei', phone: '0900000000', titleBig: '活動策劃師', titleNormal: '鐵人精神', createdAt: { seconds: 1704067200 } },
  ];
  const events = [{ id: 'event-1', type: 'play', status: 'ended' }];
  const activityRecords = [{ uid: 'applicant', eventId: 'event-1', status: 'registered' }];
  const attendanceRecords = [
    { uid: 'applicant', eventId: 'event-1', type: 'checkin' },
    { uid: 'applicant', eventId: 'event-1', type: 'checkout' },
  ];

  const deletedAchievements = [];
  const deletedBadges = [];
  const achievementUpdates = [];
  let currentUser = users[0];

  global.ApiService = {
    getAchievements: () => achievements,
    getBadges: () => badges,
    getEvents: () => events,
    getEvent: (id) => events.find((event) => event.id === id) || null,
    getActivityRecords: (uid) => (uid ? activityRecords.filter((record) => record.uid === uid) : activityRecords),
    getAttendanceRecords: () => attendanceRecords,
    getRegistrationsByUser: () => [],
    getTeams: () => [{ id: 'team-1', captainUid: 'captain-x', leaderUid: '', coaches: [] }],
    getCurrentUser: () => currentUser,
    getAdminUsers: () => users,
    updateAchievement(id, updates) {
      achievementUpdates.push({ id, updates });
      const target = achievements.find((achievement) => achievement.id === id);
      if (target) Object.assign(target, updates);
    },
    async deleteAchievement(id) {
      deletedAchievements.push(id);
      const index = achievements.findIndex((achievement) => achievement.id === id);
      if (index >= 0) achievements.splice(index, 1);
      return true;
    },
    async deleteBadge(id) {
      deletedBadges.push(id);
      const index = badges.findIndex((badge) => badge.id === id);
      if (index >= 0) badges.splice(index, 1);
      return true;
    },
    updateCurrentUser(payload) {
      this.lastUserUpdate = payload;
    },
  };

  global.App = {
    _achievementModule: { registry: null, shared: null, stats: null, evaluator: null, badges: null, titles: null, profile: null, view: null, admin: null },
    _getAchievementPart(key) { return this._achievementModule[key] || null; },
    _registerAchievementPart(key, value) { this._achievementModule[key] = value; return value; },
    _ensureAchievementModule() { return this._achievementModule; },
    _catOrder: { gold: 0, silver: 1, bronze: 2 },
    _catColors: { gold: '#d4a017', silver: '#9ca3af', bronze: '#b87333' },
    _catLabels: { gold: '金', silver: '銀', bronze: '銅' },
    showToast(message) { this.lastToast = message; },
    appConfirm: async () => false,
    showPage(pageId) { this.lastPage = pageId; },
    renderProfileData() { this.profileRendered = true; },
    _compressImage: async () => 'data:image/png;base64,x',
  };

  load([
    'js/modules/achievement/index.js',
    'js/modules/achievement/registry.js',
    'js/modules/achievement/shared.js',
    'js/modules/achievement/stats.js',
    'js/modules/achievement/titles.js',
    'js/modules/achievement/view.js',
    'js/modules/achievement/evaluator.js',
    'js/modules/achievement/admin.js',
    'js/modules/achievement.js',
    'js/modules/profile-data.js',
    'js/modules/leaderboard.js',
  ]);

  App.renderProfileData = () => {
    App.profileRendered = true;
  };

  assert(typeof App._getAchievementView === 'function', 'Phase 1: achievement view getter missing');
  assert(App._getAchievementRegistry()?.isSupportedAction('complete_event') === true, 'Phase 1/3: registry support not registered');

  const registry = App._getAchievementRegistry();
  assert(registry.getSupportedActions().length === ACHIEVEMENT_CONDITIONS.actions.length, 'Phase 3/6: registry supported action count mismatch');
  assert(registry.getTimeRanges().length === 1 && registry.getTimeRanges()[0].key === 'none', 'Phase 6: supported time ranges not reduced');
  assert(registry.isSupportedCondition({ timeRange: 'none', action: 'complete_event', filter: 'all', threshold: 1 }) === true, 'Phase 6: valid condition unexpectedly unsupported');
  assert(registry.isSupportedCondition({ timeRange: '30d', action: 'complete_event', filter: 'all', threshold: 1 }) === false, 'Phase 6: legacy timeRange still supported');

  const statsBeforeCleanup = App._getAchievementStats().getParticipantAttendanceStats({
    uid: 'applicant',
    registrations: activityRecords,
    attendanceRecords,
    eventMap: new Map(events.map((event) => [event.id, event])),
    now: new Date(),
    isEventEnded: (event) => event.status === 'ended',
  });
  assert(statsBeforeCleanup.expectedCount === 1 && statsBeforeCleanup.completedCount === 1 && statsBeforeCleanup.attendRate === 100, 'Phase 2/6: attendance stats helper mismatch');

  await App.renderAdminAchievements();
  assert(deletedAchievements.sort().join(',') === 'a-legacy-action,a-legacy-time', 'Phase 5/6: admin cleanup did not remove invalid achievements');
  assert(deletedBadges.includes('b-orphan') && deletedBadges.includes('b-legacy-action') && deletedBadges.includes('b-legacy-time'), 'Phase 5/6: admin cleanup did not remove orphan badges');
  assert(elements['ach-cond-action'].innerHTML.includes('complete_event'), 'Phase 5/6: admin action select missing valid action');
  assert(!elements['ach-cond-action'].innerHTML.includes('organize_event'), 'Phase 5/6: admin action select still exposes unsupported action');
  assert(achievementUpdates.length === 0, 'Phase 7: admin render should not persist achievement progress');

  achievementUpdates.length = 0;
  App._evaluateAchievements(null, { targetUid: 'applicant' });
  const joinUpdate = achievementUpdates.find((item) => item.id === 'a-join');
  const rateUpdate = achievementUpdates.find((item) => item.id === 'a-rate');
  assert(joinUpdate && joinUpdate.updates.current >= 1, 'Phase 6: join_team evaluator did not use target uid');
  assert(rateUpdate && rateUpdate.updates.current === 100, 'Phase 6: attendance_rate evaluator did not align with stats');

  currentUser = users[1];
  achievementUpdates.length = 0;
  App.renderAchievements();
  assert(elements['achievement-grid'].innerHTML.includes('初心者'), 'Phase 7: achievement view did not render active cards');
  assert(!elements['achievement-grid'].innerHTML.includes('活動策劃師'), 'Phase 7: achievement view still renders removed legacy achievement');
  assert(achievementUpdates.length === 0, 'Phase 7: public achievement render should not persist achievement progress');

  const titleHtml = App._buildTitleDisplayHtml(users[1], 'Applicant');
  assert(titleHtml.includes('鐵人精神'), 'Phase 4/6: earned title missing');
  assert(!titleHtml.includes('活動策劃師'), 'Phase 4/6: removed title still displayed');

  App.renderTitlePage();
  App._updateTitlePreview();
  App.saveTitles();
  assert(ApiService.lastUserUpdate && Object.prototype.hasOwnProperty.call(ApiService.lastUserUpdate, 'titleBig'), 'Phase 4: title save facade failed');

  const scanStats = App._calcScanStats('applicant');
  assert(scanStats.expectedCount === 1 && scanStats.completedCount === 1 && scanStats.attendRate === 100, 'Phase 2/6: leaderboard stats diverged');

  const scriptLoaderText = fs.readFileSync('js/core/script-loader.js', 'utf8');
  assert(scriptLoaderText.includes('js/modules/achievement/view.js'), 'Phase 7: script loader missing achievement view helper');

  console.log('achievement-phase1-7-final-smoke: OK');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
