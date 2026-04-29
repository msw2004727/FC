/* ================================================
   SportHub — Config & Constants
   ================================================ */

// ─── Cache Version（更新此值以清除瀏覽器快取）───
// 變更日誌已移除，請用 git log 查閱歷史部署記錄。
const CACHE_VERSION = '0.20260429ze';

// ─── 即時監聽 limit 預設值（可在儀表板動態調整，存於 siteConfig/realtimeConfig）───
const REALTIME_LIMIT_DEFAULTS = {
  attendanceLimit: 1500,
  registrationLimit: 3000,
  eventLimit: 100,
  teamLimit: 50,
  tournamentLimit: 100,
};

// ─── 網路 / 設備偵測（用於 UI 降級）───
const NetDevice = {
  /** 偵測慢速網路（4G 以下或 saveData） */
  isSlowNetwork() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!conn) return false;
    if (conn.saveData) return true;
    const ect = conn.effectiveType;          // '4g' | '3g' | '2g' | 'slow-2g'
    return ect === '2g' || ect === 'slow-2g' || ect === '3g';
  },
  /** 偵測低端設備（記憶體 ≤ 4GB 或 CPU 核心 ≤ 2） */
  isLowDevice() {
    const mem = navigator.deviceMemory;      // Chrome 63+, 未支援回傳 undefined
    const cores = navigator.hardwareConcurrency || 4;
    if (mem && mem <= 4) return true;
    if (cores <= 2) return true;
    return false;
  },
  /** 便捷：慢網路或低端設備（任一成立） */
  shouldDegrade() { return this.isSlowNetwork() || this.isLowDevice(); },
};

// ─── CF Migration Feature Flag ───
// 判斷是否走 Cloud Functions 報名流程（Wave 1）
function shouldUseServerRegistration() {
  // 僅 Production 模式才走 CF
  // 讀取 Firestore featureFlags（在 boot collections 時已快取）
  const flags = (typeof FirebaseService !== 'undefined' && typeof FirebaseService.getCachedDoc === 'function')
    ? FirebaseService.getCachedDoc('siteConfig', 'featureFlags')
    : null;
  if (!flags || !flags.useServerRegistration) return false;
  const uid = (typeof App !== 'undefined' && App.currentUser) ? App.currentUser.uid : '';
  if (!uid) return false;
  // 白名單：testUids 內的用戶直接走 CF（不受 rolloutPercent 限制）
  if (Array.isArray(flags.testUids) && flags.testUids.includes(uid)) return true;
  // 灰度：根據用戶 UID 的 djb2 hash 百分比決定
  const percent = flags.serverRegistrationRolloutPercent || 0;
  if (percent >= 100) return true;
  if (percent <= 0) return false;
  let h = 5381;
  for (let i = 0; i < uid.length; i++) {
    h = ((h << 5) + h) + uid.charCodeAt(i);
  }
  return (Math.abs(h) % 100) < percent;
}

// ─── Page Strategy Registry ───
// 唯一策略來源，未列出的頁面預設 fresh-first
const PAGE_STRATEGY = {
  // 主要頁面
  'page-home':               'stale-first',
  'page-activities':         'stale-first',
  'page-teams':              'stale-first',
  'page-tournaments':        'stale-first',
  'page-personal-dashboard': 'stale-first',
  'page-leaderboard':        'stale-first',
  'page-activity-detail':    'stale-first',
  'page-my-activities':      'stale-first',
  'page-shop':               'stale-first',

  // 詳情頁（需確認資料新鮮度）
  'page-profile':            'stale-confirm',
  'page-team-detail':        'stale-confirm',
  'page-tournament-detail':  'stale-confirm',
  'page-shop-detail':        'stale-confirm',

  // 後台管理頁（抽屜入口 — 快取優先 + 背景刷新）
  'page-admin-dashboard':    'stale-first',
  'page-admin-teams':        'stale-first',
  'page-admin-tournaments':  'stale-first',
  'page-admin-games':        'stale-first',
  'page-admin-users':        'stale-first',
  'page-admin-banners':      'stale-first',
  'page-admin-shop':         'stale-first',
  'page-admin-messages':     'stale-first',
  'page-admin-themes':       'stale-first',
  'page-admin-exp':          'stale-first',
  'page-admin-auto-exp':     'stale-first',
  'page-admin-notif':        'fresh-first',
  'page-admin-announcements':'stale-first',
  'page-admin-achievements': 'stale-first',
  'page-admin-roles':        'stale-first',
  'page-admin-logs':         'stale-first',
  'page-admin-repair':       'stale-first',
  'page-admin-inactive':     'stale-first',

  // 教育俱樂部（SWR 補齊）
  'page-edu-groups':              'stale-first',
  'page-edu-students':            'stale-first',
  'page-edu-checkin':             'stale-first',
  'page-edu-calendar':            'stale-first',
  'page-edu-course-plan':         'stale-first',
  'page-edu-course-enrollment':   'stale-first',

  // 遊戲
  'page-game':               'stale-first',
  'page-kick-game':          'stale-first',

  // 成就 / 稱號
  'page-achievements':       'stale-first',
  'page-titles':             'stale-first',
};

// ─── Page Data Contract ───
// 每頁的資料依賴定義：required = 必要集合，optional = 可背景補的，realtime = 需即時監聽的
const PAGE_DATA_CONTRACT = {
  'page-home':               { required: ['events', 'banners', 'announcements'], optional: ['teams', 'tournaments', 'leaderboard'], realtime: [] },
  'page-activities':         { required: ['events'], optional: ['registrations'], realtime: ['registrations', 'attendanceRecords'] },
  'page-teams':              { required: ['teams'], optional: [], realtime: ['teams'] },
  'page-tournaments':        { required: ['tournaments'], optional: ['standings', 'matches'], realtime: ['tournaments'] },
  'page-personal-dashboard': { required: ['events', 'registrations'], optional: ['attendanceRecords'], realtime: [] },
  'page-leaderboard':        { required: ['leaderboard'], optional: [], realtime: [] },
  'page-profile':            { required: [], optional: ['attendanceRecords', 'activityRecords'], realtime: [] },
  'page-team-detail':        { required: [], optional: ['teams', 'events'], realtime: [] },
  'page-tournament-detail':  { required: [], optional: ['tournaments', 'standings', 'matches'], realtime: [] },
  'page-shop':               { required: ['shopItems'], optional: ['trades'], realtime: [] },
  'page-shop-detail':        { required: ['shopItems'], optional: ['trades'], realtime: [] },
  'page-activity-detail':    { required: ['events'], optional: ['registrations', 'attendanceRecords', 'activityRecords', 'userCorrections'], realtime: ['registrations', 'attendanceRecords'] },
  'page-my-activities':      { required: ['events', 'registrations'], optional: ['attendanceRecords'], realtime: ['registrations', 'attendanceRecords'] },
  'page-scan':               { required: ['events', 'attendanceRecords'], optional: [], realtime: ['attendanceRecords'] },
  // 後台管理頁（required: [] 允許首次載入後即走 stale-first）
  'page-admin-dashboard':    { required: [], optional: ['expLogs', 'teamExpLogs', 'operationLogs', 'attendanceRecords', 'activityRecords'], realtime: [] },
  'page-admin-teams':        { required: [], optional: ['teams', 'tournaments', 'standings', 'matches'], realtime: [] },
  'page-admin-tournaments':  { required: [], optional: ['tournaments', 'standings', 'matches'], realtime: [] },
  'page-admin-games':        { required: [], optional: ['gameConfigs'], realtime: [] },
  'page-admin-users':        { required: [], optional: ['permissions', 'customRoles'], realtime: [] },
  'page-admin-banners':      { required: [], optional: ['banners', 'floatingAds', 'popupAds', 'sponsors'], realtime: [] },
  'page-admin-shop':         { required: [], optional: ['shopItems', 'trades'], realtime: [] },
  'page-admin-messages':     { required: [], optional: ['adminMessages', 'notifTemplates'], realtime: [] },
  'page-admin-themes':       { required: [], optional: ['siteThemes'], realtime: [] },
  'page-admin-exp':          { required: [], optional: ['expLogs', 'teamExpLogs'], realtime: [] },
  'page-admin-auto-exp':     { required: [], optional: ['expLogs'], realtime: [] },
  'page-admin-notif':        { required: [], optional: [], realtime: [] },
  'page-admin-announcements':{ required: [], optional: ['announcements'], realtime: [] },
  'page-admin-achievements': { required: [], optional: ['achievements', 'badges'], realtime: [] },
  'page-admin-roles':        { required: [], optional: ['permissions', 'customRoles'], realtime: [] },
  'page-admin-logs':         { required: [], optional: ['operationLogs', 'errorLogs'], realtime: [] },
  'page-admin-repair':       { required: [], optional: ['events', 'attendanceRecords', 'activityRecords', 'userCorrections', 'teams'], realtime: [] },
  'page-admin-inactive':     { required: [], optional: ['attendanceRecords', 'activityRecords', 'operationLogs'], realtime: [] },

  // 教育俱樂部（SWR 補齊）
  'page-edu-groups':              { required: [], optional: ['teams'], realtime: [] },
  'page-edu-students':            { required: [], optional: ['teams'], realtime: [] },
  'page-edu-checkin':             { required: [], optional: ['events', 'attendanceRecords'], realtime: [] },
  'page-edu-calendar':            { required: [], optional: ['events'], realtime: [] },
  'page-edu-course-plan':         { required: [], optional: ['teams'], realtime: [] },
  'page-edu-course-enrollment':   { required: [], optional: ['teams'], realtime: [] },

  // 遊戲 + 成就
  'page-game':               { required: [], optional: [], realtime: [] },
  'page-kick-game':          { required: [], optional: [], realtime: [] },
  'page-achievements':       { required: [], optional: ['achievements'], realtime: [] },
  'page-titles':             { required: [], optional: [], realtime: [] },
};

// ─── Achievement Condition Config ───
const ACHIEVEMENT_CONDITIONS = {
  timeRanges: [
    { key: 'none',   label: '累計' },
  ],
  actions: [
    { key: 'register_event',  label: '報名活動',             unit: '場', needsFilter: true },
    { key: 'complete_event',  label: '完成活動（簽到+簽退）', unit: '場', needsFilter: true },
    { key: 'attend_play',     label: '出席 PLAY 活動',       unit: '場', needsFilter: false },
    { key: 'attend_friendly', label: '出席友誼活動',         unit: '場', needsFilter: false },
    { key: 'attend_camp',     label: '出席教學活動',         unit: '場', needsFilter: false },
    { key: 'attend_watch',    label: '出席觀賽',             unit: '場', needsFilter: false },
    { key: 'attendance_rate', label: '達到出席率',           unit: '%', needsFilter: false },
    { key: 'reach_level',     label: '達到等級',             unit: '級',  needsFilter: false },
    { key: 'reach_exp',       label: '累計 EXP',             unit: '點',  needsFilter: false },
    { key: 'join_team',       label: '加入俱樂部',             unit: '',  needsFilter: false },
    { key: 'complete_profile',label: '完成個人檔案',         unit: '',  needsFilter: false },
    { key: 'bind_line_notify',label: '綁定 LINE 推播',       unit: '',  needsFilter: false },
    { key: 'days_registered', label: '註冊天數',             unit: '天', needsFilter: false },
    { key: 'organize_event', label: '主辦活動',             unit: '場', needsFilter: true },
    { key: 'diverse_sports', label: '參與不同運動類型',     unit: '種', needsFilter: false },
    { key: 'no_show_free',   label: '連續無放鴿子',         unit: '場', needsFilter: false },
    { key: 'create_team',    label: '建立俱樂部',             unit: '隊', needsFilter: false },
    { key: 'bring_companion',label: '帶同行者報名',         unit: '人次', needsFilter: false },
    { key: 'team_member_count', label: '俱樂部成員數',        unit: '人', needsFilter: false },
    { key: 'early_event',    label: '參加早場活動',         unit: '場', needsFilter: false },
    { key: 'night_event',    label: '參加夜場活動',         unit: '場', needsFilter: false },
    { key: 'shop_trade',     label: '完成商城兌換',         unit: '次', needsFilter: false },
    { key: 'game_play',      label: '完成小遊戲',           unit: '場', needsFilter: false },
    { key: 'game_high_score',label: '小遊戲最高分',         unit: '分', needsFilter: false },
    { key: 'role_coach',     label: '教練身份',             unit: '',  needsFilter: false },
    { key: 'role_captain',   label: '領隊/經理身份',        unit: '',  needsFilter: false },
    { key: 'role_venue_owner',label: '場主身份',            unit: '',  needsFilter: false },
    { key: 'role_admin',     label: '管理員身份',           unit: '',  needsFilter: false },
    { key: 'role_super_admin',label: '總管身份',            unit: '',  needsFilter: false },
    { key: 'manual_award',   label: '手動授予',             unit: '',  needsFilter: false },
  ],
  filters: [
    { key: 'all',      label: '所有類型' },
    { key: 'play',     label: 'PLAY' },
    { key: 'friendly', label: '友誼' },
    { key: 'camp',     label: '教學' },
    { key: 'watch',    label: '觀賽' },
  ],
};

// ─── Mode Manager ───
const ModeManager = { getMode() { return 'production'; } };

const PROD_HOSTS = Array.isArray(window.__SPORTHUB_PROD_HOSTS__)
  ? [...window.__SPORTHUB_PROD_HOSTS__]
  : ['toosterx.com', 'www.toosterx.com', 'msw2004727.github.io', 'fc-3g8.pages.dev'];

// ─── LINE Login Config ───
const LINE_CONFIG = {
  LIFF_ID: '2009525300-AuPGQ0sh',          // Mini App LIFF ID（用於 liff.init）
  LIFF_ID_LEGACY: '2009084941-zgn7tQOp',   // [備用] 舊 LIFF App ID
  MINI_APP_ID: '2009525300-AuPGQ0sh',
  CHANNEL_ID: '2009525300',
  BOT_BASIC_ID: '@830utvza',
};

// ─── Share URL Base ───
// 所有新分享連結統一使用 LINE Mini App URL
// 舊 LIFF URL (liff.line.me/2009084941-zgn7tQOp) 仍透過 index.html 中繼跳轉支援
const MINI_APP_BASE_URL = 'https://miniapp.line.me/' + LINE_CONFIG.MINI_APP_ID;

// ─── Role Hierarchy & Config ───
const BUILTIN_ROLE_KEYS = ['user', 'coach', 'captain', 'venue_owner', 'admin', 'super_admin'];

const _BASE_ROLES = {
  user:        { level: 0, label: '一般用戶', color: '#6b7280' },
  coach:       { level: 1, label: '教練',     color: '#0d9488' },
  captain:     { level: 2, label: '領隊',     color: '#7c3aed' },
  venue_owner: { level: 3, label: '場主',     color: '#d97706' },
  admin:       { level: 4, label: '管理員',   color: '#2563eb' },
  super_admin: { level: 5, label: '總管',     color: '#dc2626' }
};

const _BASE_ROLE_LEVEL_MAP = { user:0, coach:1, captain:2, venue_owner:3, admin:4, super_admin:5 };

function _getRuntimeCustomRolesSource() {
  try {
    if (typeof App !== 'undefined' && App && typeof App._getCustomRoles === 'function') {
      const roles = App._getCustomRoles();
      if (Array.isArray(roles)) return roles;
    }
  } catch (_) {}

  try {
    if (typeof FirebaseService !== 'undefined'
      && FirebaseService
      && FirebaseService._cache
      && Array.isArray(FirebaseService._cache.customRoles)) {
      return FirebaseService._cache.customRoles;
    }
  } catch (_) {}

  return [];
}

function _normalizeRuntimeCustomRoles(customRoles) {
  return (customRoles || [])
    .filter(role => role && typeof role.key === 'string' && role.key.trim())
    .map(role => ({
      key: role.key,
      label: role.label || role.key,
      color: role.color || '#6366f1',
      afterRole: role.afterRole || 'captain',
    }));
}

function getRuntimeRoleSequence() {
  const customRoles = _normalizeRuntimeCustomRoles(_getRuntimeCustomRolesSource());
  const children = new Map();

  customRoles.forEach(role => {
    const parent = role.afterRole || 'captain';
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(role);
  });

  const result = [];
  const visited = new Set();

  const appendRole = (roleKey) => {
    result.push(roleKey);
    const childRoles = children.get(roleKey) || [];
    childRoles.forEach(child => {
      if (visited.has(child.key)) return;
      visited.add(child.key);
      appendRole(child.key);
    });
  };

  BUILTIN_ROLE_KEYS.forEach(appendRole);

  customRoles.forEach(role => {
    if (visited.has(role.key)) return;
    visited.add(role.key);
    result.push(role.key);
  });

  return result;
}

function _buildRuntimeRoleLevelMap() {
  const levels = { ..._BASE_ROLE_LEVEL_MAP };
  const sequence = getRuntimeRoleSequence();

  for (let i = 0; i < BUILTIN_ROLE_KEYS.length - 1; i += 1) {
    const startKey = BUILTIN_ROLE_KEYS[i];
    const endKey = BUILTIN_ROLE_KEYS[i + 1];
    const startIndex = sequence.indexOf(startKey);
    const endIndex = sequence.indexOf(endKey);
    if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex + 1) continue;

    const between = sequence.slice(startIndex + 1, endIndex);
    const step = (_BASE_ROLE_LEVEL_MAP[endKey] - _BASE_ROLE_LEVEL_MAP[startKey]) / (between.length + 1);
    between.forEach((roleKey, index) => {
      levels[roleKey] = _BASE_ROLE_LEVEL_MAP[startKey] + step * (index + 1);
    });
  }

  const superAdminIndex = sequence.indexOf('super_admin');
  if (superAdminIndex >= 0 && superAdminIndex < sequence.length - 1) {
    const deferredRoles = sequence.slice(superAdminIndex + 1);
    const step = (_BASE_ROLE_LEVEL_MAP.super_admin - _BASE_ROLE_LEVEL_MAP.admin) / (deferredRoles.length + 1);
    deferredRoles.forEach((roleKey, index) => {
      levels[roleKey] = _BASE_ROLE_LEVEL_MAP.admin + (step * (index + 1));
    });
  }

  return levels;
}

function getRuntimeRoleLevel(roleKey) {
  if (!roleKey) return 0;
  const levels = _buildRuntimeRoleLevelMap();
  return levels[roleKey] ?? 0;
}

function getRuntimeRoleInfo(roleKey) {
  if (!roleKey) return null;
  if (Object.prototype.hasOwnProperty.call(_BASE_ROLES, roleKey)) {
    return _BASE_ROLES[roleKey];
  }
  const customRole = _normalizeRuntimeCustomRoles(_getRuntimeCustomRolesSource())
    .find(role => role.key === roleKey);
  if (!customRole) return null;
  return {
    level: getRuntimeRoleLevel(roleKey),
    label: customRole.label,
    color: customRole.color,
    custom: true,
  };
}

/**
 * 延遲登入（Lazy Auth）— 點擊 bot-tab / drawer 時需要登入的頁面白名單。
 * 2026-04-23 v8 導入：從「活動/俱樂部/賽事/訊息/個人」精簡為「訊息/個人」。
 * 活動/俱樂部/賽事改為訪客可瀏覽、只有寫入動作（報名/建立/加入）才彈登入。
 * 詳見 docs/lazy-auth-plan.md。
 */
const AUTH_REQUIRED_PAGES = Object.freeze([
  'page-profile',
  'page-messages',
]);

const ROLES = new Proxy(_BASE_ROLES, {
  get(target, prop) {
    if (typeof prop !== 'string') return target[prop];
    if (Object.prototype.hasOwnProperty.call(target, prop)) return target[prop];
    return getRuntimeRoleInfo(prop);
  },
  has(target, prop) {
    if (typeof prop !== 'string') return prop in target;
    return Object.prototype.hasOwnProperty.call(target, prop) || !!getRuntimeRoleInfo(prop);
  },
});

const ROLE_LEVEL_MAP = new Proxy(_BASE_ROLE_LEVEL_MAP, {
  get(target, prop) {
    if (typeof prop !== 'string') return target[prop];
    if (Object.prototype.hasOwnProperty.call(target, prop)) return target[prop];
    return getRuntimeRoleLevel(prop);
  },
  has(target, prop) {
    if (typeof prop !== 'string') return prop in target;
    return Object.prototype.hasOwnProperty.call(target, prop) || getRuntimeRoleLevel(prop) > 0;
  },
});


// ─── Type & Status Config ───
const TYPE_CONFIG = {
  friendly: { icon: '', label: '友誼', color: 'friendly' },
  camp:     { icon: '', label: '教學', color: 'camp' },
  play:     { icon: '', label: 'PLAY', color: 'play' },
  watch:    { icon: '', label: '觀賽', color: 'watch' },
  external: { icon: '', label: '外部', color: 'external' },
};

const EVENT_SPORT_OPTIONS = [
  { key: 'football', label: '足球' },
  { key: 'basketball', label: '籃球' },
  { key: 'pickleball', label: '匹克球' },
  { key: 'dodgeball', label: '美式躲避球' },
  { key: 'restaurant', label: '餐廳(觀賽)' },
  { key: 'baseball_softball', label: '棒壘球' },
  { key: 'volleyball', label: '排球' },
  { key: 'table_tennis', label: '桌球' },
  { key: 'tennis', label: '網球' },
  { key: 'badminton', label: '羽球' },
  { key: 'hiking', label: '登山' },
  { key: 'running', label: '慢跑' },
  { key: 'cycling', label: '單車' },
  { key: 'motorcycle', label: '重機' },
  { key: 'skateboard', label: '滑板' },
  { key: 'dance', label: '舞蹈' },
  { key: 'yoga', label: '瑜伽' },
  { key: 'martial_arts', label: '武術' },
];

const SPORT_ICON_EMOJI = {
  football: '⚽',
  basketball: '🏀',
  baseball_softball: '⚾',
  volleyball: '🏐',
  table_tennis: '🏓',
  tennis: '🎾',
  badminton: '🏸',
  hiking: '🥾',
  running: '🏃',
  cycling: '🚴',
  motorcycle: '🏍️',
  skateboard: '🛹',
  dance: '💃',
  yoga: '🧘',
  martial_arts: '🥋',
  restaurant: '🍽️',
  pickleball: '🏓',  // Fallback only：用於不支援 HTML 的場景（LINE Flex Message、textContent）。網頁 UI 走 SPORT_ICON_SVG_HTML
  dodgeball: '🤾',
};

// 2026-04-25：自製 SVG 圖示對照表（優先於 SPORT_ICON_EMOJI 在網頁 UI 使用）
// Unicode 沒有匹克球專屬 emoji，🏓（桌球橢圓拍）會誤導視覺，改用圓角方形 paddle + 飛球
// 詳見 docs/tunables.md #sport-icon-svg
// ⚠️ 2026-04-27：此區塊曾被 commit dcb2c0ea (LINE 登入 hint) 意外移除（基於更早版本工作未保留）。
//                修改 config.js 時請務必檢查 SPORT_ICON_SVG_HTML 是否仍存在,避免再次被合併衝突覆蓋
const SPORT_ICON_SVG_HTML = {
  // 匹克球：V4 動感版（紅色圓角方形拍斜放 + 黃色飛球 + 速度線）
  pickleball: '<svg viewBox="0 0 100 100" width="1em" height="1em" style="vertical-align:-0.1em" xmlns="http://www.w3.org/2000/svg"><g transform="rotate(-30 50 50)"><rect x="32" y="62" width="14" height="30" rx="3" fill="#0f172a"/><rect x="34" y="64" width="10" height="26" rx="2" fill="#334155"/><rect x="14" y="6" width="52" height="58" rx="13" fill="#dc2626" stroke="#7f1d1d" stroke-width="2.5"/></g><circle cx="78" cy="22" r="11" fill="#fde047" stroke="#713f12" stroke-width="2"/><g fill="#713f12"><circle cx="74" cy="18" r="1.3"/><circle cx="82" cy="18" r="1.3"/><circle cx="78" cy="22" r="1.3"/><circle cx="74" cy="26" r="1.3"/><circle cx="82" cy="26" r="1.3"/></g><path d="M 60 24 L 67 22 M 58 30 L 65 30 M 60 36 L 67 36" stroke="#94a3b8" stroke-width="2.5" stroke-linecap="round" fill="none"/></svg>',
};

const EVENT_SPORT_MAP = EVENT_SPORT_OPTIONS.reduce((acc, item) => {
  acc[item.key] = item;
  return acc;
}, Object.create(null));

function getSportKeySafe(key) {
  const raw = String(key || '').trim();
  return EVENT_SPORT_MAP[raw] ? raw : '';
}

function getSportLabelByKey(key) {
  const safeKey = getSportKeySafe(key) || 'football';
  return EVENT_SPORT_MAP[safeKey]?.label || '足球';
}

function getSportIconSvg(key, className = '') {
  const safeKey = getSportKeySafe(key) || 'football';
  const klass = className ? ` ${className}` : '';
  // 優先使用自製 SVG（如匹克球，因 Unicode 無專屬 emoji）
  if (SPORT_ICON_SVG_HTML[safeKey]) {
    return `<span class="sport-emoji${klass}" aria-hidden="true">${SPORT_ICON_SVG_HTML[safeKey]}</span>`;
  }
  // Fallback：emoji 字符
  const emoji = SPORT_ICON_EMOJI[safeKey] || SPORT_ICON_EMOJI.football;
  return `<span class="sport-emoji${klass}" aria-hidden="true">${emoji}</span>`;
}

function getLockIconSvg(className = '') {
  const klass = className ? ` class="${className}"` : '';
  return `<svg${klass} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path></svg>`;
}

const STATUS_CONFIG = {
  open:      { label: '報名中', css: 'open' },
  full:      { label: '已額滿', css: 'full' },
  ended:     { label: '已結束', css: 'ended' },
  upcoming:  { label: '即將開放', css: 'upcoming' },
  cancelled: { label: '已取消', css: 'cancelled' },
};

const DAY_NAMES = ['日','一','二','三','四','五','六'];

// ─── Security Utilities ───
function escapeHTML(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function generateId(prefix) {
  return (prefix || '') + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

// ─── Gradient Map (for event creation) ───
const GRADIENT_MAP = {
  friendly: 'linear-gradient(135deg,#0d9488,#065f46)',
  camp:     'linear-gradient(135deg,#ec4899,#be185d)',
  play:     'linear-gradient(135deg,#7c3aed,#4338ca)',
  watch:    'linear-gradient(135deg,#f59e0b,#d97706)',
  external: 'linear-gradient(135deg,#6b7280,#4b5563)',
};

const TOURNAMENT_GRADIENT_MAP = {
  '盃賽': 'linear-gradient(135deg,#7c3aed,#4338ca)',
};

// ─── Home Game Settings（可擴充多款小遊戲） ───
const HOME_GAME_PRESETS = [
  {
    id: 'home_game_shot',
    gameKey: 'shot-game',
    name: '蓄力射門 誰與爭鋒',
    pageTitle: 'ToosterX Hub 射門大賽',
    page: 'page-game',
    sortOrder: 10,
    enabled: true,
    homeVisible: true,
  },
  {
    id: 'home_game_kick',
    gameKey: 'kick-game',
    name: '誰才是開球王',
    pageTitle: 'ToosterX Hub 開球大賽',
    page: 'page-kick-game',
    sortOrder: 20,
    enabled: true,
    homeVisible: false,
  },
];

// ─── 台灣 22 縣市（地區鎖 + 個人資料地區選擇）───
// 2026-04-25：順序改為 6 都優先（與 first-login picker 一致）
const TW_REGIONS = [
  '台北市','新北市','桃園市','台中市','台南市','高雄市',  // 6 都
  '基隆市','新竹市','嘉義市',                              // 縣轄市
  '新竹縣','苗栗縣','彰化縣','南投縣','雲林縣','嘉義縣',
  '屏東縣','宜蘭縣','花蓮縣','台東縣',
  '澎湖縣','金門縣','連江縣',
];

// 表單填寫用（含「其他」、給彈性使用）
const TW_REGIONS_WITH_OTHER = TW_REGIONS.concat(['其他']);

// 共用地區模糊搜尋（fuzzy match：字符依序出現、不需連續；臺/台互通）
function filterTwRegions(keyword, includeOther) {
  const list = (includeOther === false) ? TW_REGIONS : TW_REGIONS_WITH_OTHER;
  const q = String(keyword || '').trim().replace(/臺/g, '台').toLowerCase();
  if (!q) return list.slice();
  return list.filter(function(name) {
    const text = name.replace(/臺/g, '台').toLowerCase();
    let ti = 0;
    for (let qi = 0; qi < q.length; qi++) {
      let found = false;
      while (ti < text.length) {
        if (text[ti] === q[qi]) { ti++; found = true; break; }
        ti++;
      }
      if (!found) return false;
    }
    return true;
  });
}

// ─── 活動地區分區定義 ───
const REGION_MAP = {
  '中部': ['台中市', '苗栗縣', '彰化縣', '南投縣', '雲林縣'],
  '北部': ['台北市', '新北市', '基隆市', '桃園市', '新竹市', '新竹縣', '宜蘭縣'],
  '南部': ['高雄市', '台南市', '嘉義市', '嘉義縣', '屏東縣'],
  '東部&外島': ['花蓮縣', '台東縣', '澎湖縣', '金門縣', '連江縣'],
};
const REGION_TABS = ['中部', '北部', '南部', '東部&外島', '全部'];

const TEAM_RANK_CONFIG = [
  { min: 0,    max: 999,   rank: 'E',   color: '#6b7280' },
  { min: 1000, max: 1999,  rank: 'D',   color: '#22c55e' },
  { min: 2000, max: 2999,  rank: 'C',   color: '#3b82f6' },
  { min: 3000, max: 3999,  rank: 'B',   color: '#8b5cf6' },
  { min: 4000, max: 4999,  rank: 'A',   color: '#f59e0b' },
  { min: 5000, max: 5999,  rank: 'A+',  color: '#f97316' },
  { min: 6000, max: 6999,  rank: 'A++', color: '#ef4444' },
  { min: 7000, max: 7999,  rank: 'S',   color: '#ec4899' },
  { min: 8000, max: 8999,  rank: 'SS',  color: '#14b8a6' },
  { min: 9000, max: 10000, rank: 'SSS', color: '#dc2626' },
];

// ─── Drawer Menu Config ───
const DRAWER_MENUS = [
  { icon: '', label: '個人數據', i18nKey: 'drawer.personalData', page: 'page-personal-dashboard', minRole: 'user', locked: true },
  { icon: '', label: '二手商品區', i18nKey: 'drawer.shop', page: 'page-shop', minRole: 'user', locked: true },
  { icon: '', label: '排行榜', i18nKey: 'drawer.leaderboard', action: 'coming-soon', minRole: 'user', locked: true },
  { icon: '', label: '使用手冊', i18nKey: 'drawer.manual', action: 'manual', minRole: 'user' },
  { icon: '', label: '分享網頁', i18nKey: 'drawer.share', action: 'share', minRole: 'user' },
  { icon: '', label: '申請（俱樂部/場主/教練）', i18nKey: 'drawer.applyRole', action: 'apply-role', minRole: 'user' },
  { divider: true },
  { icon: '', label: '活動管理', i18nKey: 'drawer.activityManage', page: 'page-my-activities', minRole: 'coach', permissionCode: 'activity.manage.entry' },
  { icon: '', label: '賽事管理', i18nKey: 'drawer.tournamentManage', page: 'page-admin-tournaments', minRole: 'coach', permissionCode: 'admin.tournaments.entry' },
  { icon: '', label: '俱樂部管理', page: 'page-team-manage', minRole: 'captain', permissionCode: 'team.manage.entry' },
  { divider: true, minRole: 'admin' },
  { sectionLabel: '後台管理', i18nKey: 'drawer.backendManage', minRole: 'admin' },
  { icon: '', label: '小遊戲管理', page: 'page-admin-games', minRole: 'admin', permissionCode: 'admin.games.entry' },
  { icon: '', label: '用戶管理', i18nKey: 'admin.userManage', page: 'page-admin-users', minRole: 'admin', permissionCode: 'admin.users.entry' },
  { icon: '', label: '廣告管理', i18nKey: 'admin.adManage', page: 'page-admin-banners', minRole: 'admin', permissionCode: 'admin.banners.entry' },
  { icon: '', label: '二手商品管理', i18nKey: 'admin.shopManage', page: 'page-admin-shop', minRole: 'admin', permissionCode: 'admin.shop.entry' },
  { icon: '', label: '站內信管理', i18nKey: 'admin.messageManage', page: 'page-admin-messages', minRole: 'admin', permissionCode: 'admin.messages.entry' },
  { icon: '', label: '數據儀表板', i18nKey: 'admin.dashboard', page: 'page-admin-dashboard', minRole: 'super_admin', permissionCode: 'admin.dashboard.entry' },
  { icon: '', label: 'SEO 儀表板', i18nKey: 'admin.seo', page: 'page-admin-seo', minRole: 'admin', permissionCode: 'admin.seo.entry', highlight: 'red' },
  { icon: '', label: '佈景主題', i18nKey: 'admin.themes', page: 'page-admin-themes', minRole: 'super_admin', permissionCode: 'admin.themes.entry' },
  { icon: '', label: '手動 EXP 管理', i18nKey: 'admin.expManage', page: 'page-admin-exp', minRole: 'super_admin', permissionCode: 'admin.exp.entry' },
  { icon: '', label: '自動 EXP 管理', i18nKey: 'drawer.autoExpManage', page: 'page-admin-auto-exp', minRole: 'super_admin', permissionCode: 'admin.auto_exp.entry' },
  { icon: '', label: '推播通知設定', page: 'page-admin-notif', minRole: 'super_admin', permissionCode: 'admin.notif.entry' },
  { icon: '', label: '系統公告管理', i18nKey: 'admin.announcements', page: 'page-admin-announcements', minRole: 'super_admin', permissionCode: 'admin.announcements.entry' },
  { icon: '', label: '成就/徽章管理', i18nKey: 'admin.achievements', page: 'page-admin-achievements', minRole: 'super_admin', permissionCode: 'admin.achievements.entry' },
  { icon: '', label: '權限管理', i18nKey: 'admin.roles', page: 'page-admin-roles', minRole: 'super_admin' },
  { icon: '', label: '日誌中心', i18nKey: 'admin.logs', page: 'page-admin-logs', minRole: 'super_admin', permissionCode: 'admin.logs.entry' },
  { icon: '', label: '用戶補正管理', i18nKey: 'admin.repair', page: 'page-admin-repair', minRole: 'admin', permissionCode: 'admin.repair.entry', highlight: 'red' },
  { icon: '', label: '無效資料查詢', i18nKey: 'admin.inactive', page: 'page-admin-inactive', minRole: 'super_admin', permissionCode: 'admin.inactive.entry' },
];

const ROLE_PERMISSION_CATALOG_VERSION = '20260422a';
const DISABLED_PERMISSION_CODES = new Set(['admin.roles.entry']);

function isPermissionCodeEnabled(code) {
  return typeof code === 'string'
    && !!code
    && !DISABLED_PERMISSION_CODES.has(code);
}

function sanitizePermissionCodeList(codes) {
  return Array.from(new Set(
    (Array.isArray(codes) ? codes : []).filter(code => isPermissionCodeEnabled(code))
  ));
}

const ADMIN_PAGE_EXTRA_PERMISSION_ITEMS = {
  'page-my-activities': [
    { code: 'event.create', name: '建立活動' },
    { code: 'event.edit_self', name: '編輯自己的活動' },
    { code: 'event.edit_all', name: '編輯所有活動' },
    { code: 'event.delete_self', name: '刪除自己的活動' },
    { code: 'event.delete', name: '刪除所有活動' },
    { code: 'event.publish', name: '上架 / 下架活動' },
    { code: 'event.scan', name: '掃碼簽到 / 簽退' },
    { code: 'event.manual_checkin', name: '編輯簽到 / 簽退' },
    { code: 'event.view_registrations', name: '查看報名名單' },
  ],
  'page-admin-tournaments': [
    { code: 'admin.tournaments.create', name: '建立賽事' },
    { code: 'admin.tournaments.manage_all', name: '管理所有賽事' },
    { code: 'admin.tournaments.review', name: '審核參賽申請' },
    { code: 'admin.tournaments.end', name: '結束賽事' },
    { code: 'admin.tournaments.reopen', name: '重開賽事' },
    { code: 'admin.tournaments.delete', name: '刪除賽事' },
  ],
  'page-team-manage': [
    { code: 'team.create', name: '建立俱樂部' },
    { code: 'team.manage_all', name: '管理所有俱樂部' },
    { code: 'team.manage_self', name: '管理自己的俱樂部' },
    { code: 'team.review_join', name: '審核入隊申請' },
    { code: 'team.assign_coach', name: '指派俱樂部教練' },
    { code: 'team.create_event', name: '建立俱樂部專屬活動' },
    { code: 'team.toggle_event_visibility', name: '切換活動公開性' },
  ],
  'page-admin-users': [
    { code: 'admin.users.edit_profile', name: '編輯基本資料' },
    { code: 'admin.users.change_role', name: '修改用戶身分' },
    { code: 'admin.users.restrict', name: '限制 / 解除限制' },
  ],
  'page-admin-messages': [
    { code: 'admin.messages.compose', name: '撰寫廣播' },
    { code: 'admin.messages.delete', name: '刪除站內信' },
  ],
  'page-admin-repair': [
    { code: 'admin.repair.team_join_repair', name: '歷史入隊補正' },
    { code: 'admin.repair.no_show_adjust', name: '放鴿子修改' },
    { code: 'admin.repair.data_sync', name: '系統資料同步' },
    { code: 'admin.repair.event_blocklist', name: '活動黑名單' },
    { code: 'activity.view_noshow', name: '查看放鴿子次數' },
  ],
  'page-admin-logs': [
    { code: 'admin.logs.error_read', name: '錯誤日誌讀取' },
    { code: 'admin.logs.error_delete', name: '錯誤日誌清除' },
    { code: 'admin.logs.audit_read', name: '稽核日誌讀取' },
  ],
  'page-admin-notif': [
    { code: 'admin.notif.toggle', name: '修改推播開關' },
  ],
};

// ─── 身分不可剝奪權限（取得身分即自動擁有，不受 rolePermissions 覆蓋）───
// coach/captain/venue_owner 的活動管理與賽事為身分核心功能，不可拔除
// admin 以上的所有權限由 super_admin 在權限管理 UI 自由啟閉
// ⚠️ 同步規則：修改此常數時必須同步更新 functions/index.js 中的同名常數 INHERENT_ROLE_PERMISSIONS
const INHERENT_ROLE_PERMISSIONS = Object.freeze({
  coach:       ['activity.manage.entry', 'admin.tournaments.entry'],
  captain:     ['activity.manage.entry', 'admin.tournaments.entry', 'team.manage.entry'],
  venue_owner: ['activity.manage.entry', 'admin.tournaments.entry', 'team.manage.entry'],
  super_admin: ['admin.repair.event_blocklist', 'admin.seo.entry'],
});

function getInherentRolePermissions(roleKey) {
  return INHERENT_ROLE_PERMISSIONS[roleKey] || [];
}

function getAdminDrawerPermissionDefinitions() {
  return DRAWER_MENUS
    .filter(item => item && item.page && isPermissionCodeEnabled(item.permissionCode))
    .map(item => ({
      page: item.page,
      label: item.label,
      minRole: item.minRole || 'user',
      entryCode: item.permissionCode,
      items: [
        { code: item.permissionCode, name: '顯示入口' },
        ...(ADMIN_PAGE_EXTRA_PERMISSION_ITEMS[item.page] || []),
      ],
    }));
}

function getAdminDrawerPermissionCodes() {
  return getAdminDrawerPermissionDefinitions().map(item => item.entryCode);
}

function getAdminPagePermissionCode(pageId) {
  const def = getAdminDrawerPermissionDefinitions().find(item => item.page === pageId);
  return def ? def.entryCode : '';
}

function getMergedPermissionCatalog(remoteCategories = []) {
  const result = [];
  const assignedCodes = new Set();
  const builtInCategories = getAdminDrawerPermissionDefinitions().map(def => ({
    cat: def.label,
    items: def.items.map(item => ({ ...item })),
  }));

  builtInCategories.forEach(category => {
    category.items.forEach(item => assignedCodes.add(item.code));
    result.push(category);
  });

  (remoteCategories || []).forEach(category => {
    const items = Array.isArray(category?.items)
      ? category.items.filter(item =>
        item
        && isPermissionCodeEnabled(item.code)
        && !assignedCodes.has(item.code)
      )
      : [];
    if (!items.length) return;
    items.forEach(item => assignedCodes.add(item.code));
    const existingCategory = result.find(entry => entry.cat === category.cat);
    if (existingCategory) {
      existingCategory.items.push(...items.map(item => ({ ...item })));
      return;
    }
    result.push({
      ...category,
      items: items.map(item => ({ ...item })),
    });
  });

  return result;
}

function getAllPermissionCodes(remoteCategories = []) {
  return getMergedPermissionCatalog(remoteCategories)
    .flatMap(category => Array.isArray(category?.items) ? category.items : [])
    .map(item => item.code)
    .filter(code => isPermissionCodeEnabled(code));
}

function getDefaultRolePermissions(roleKey) {
  if (!BUILTIN_ROLE_KEYS.includes(roleKey)) return null;
  if (roleKey === 'user') return [];

  const roleLevel = getRuntimeRoleLevel(roleKey);
  const defaults = [];
  getAdminDrawerPermissionDefinitions().forEach(def => {
    if (roleLevel >= getRuntimeRoleLevel(def.minRole)) {
      defaults.push(def.entryCode);
    }
  });

  if (roleLevel >= getRuntimeRoleLevel('coach')) {
    defaults.push('activity.view_noshow');
  }

  if (roleLevel >= getRuntimeRoleLevel('admin')) {
    defaults.push('team.create', 'team.manage_all', 'event.edit_all',
      'admin.tournaments.end', 'admin.tournaments.reopen', 'admin.tournaments.delete');
  }

  if (roleLevel >= getRuntimeRoleLevel('super_admin')) {
    defaults.push('admin.notif.toggle');
  }

  return Array.from(new Set(defaults));
}
