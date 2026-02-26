/* ================================================
   SportHub — Config & Constants
   ================================================ */

// ─── Cache Version（更新此值以清除瀏覽器快取）───
// 20260223u: Firestore 強制長輪詢模式，修復 WebChannel 400 錯誤
// 20260224q: 效能優化（seed 並行、localStorage debounce、O(n²) 修正）+ UX 改善
// 20260224r: 修正掃碼相機錯誤偵測（html5-qrcode reject 純字串處理）
// 20260224s: 修復 Android 開前鏡頭（exact:environment）+ videoConstraints 衝突移除 + overconstrained 自動降級
// 20260224w: opening loading overlay redesign (pixel bar + brand image)
// 20260224x: bottom tabs (teams/tournaments) show "功能準備中" during testing
// 20260224za: 頁籤順序調整（賽事→球隊→首頁→活動→我的）+ 首頁卡片地點去除自動加「市」
// 20260224zb: Tab bar 中央半圓凸起 + QR Code 快捷按鈕
// 20260224zi: Firestore WebSocket fallback（預設 WS，被擋自動降級長輪詢）
// 20260224zj: loading overlay 在框架就緒（Phase 3）即隱藏，不等 Phase 4
// 20260224zk: loading 動畫延長 1 秒再跳 100%
// 20260224zl: 未報名單欄位 + 已結束活動反向排序 + 收費公式含未報名人數
// 20260224zm: QR Code 圖片放大 50% + 白邊加寬
// 20260224zn: QR Code 頁面響應式 90vw 寬度
// 20260225c: QR Code 白邊減少 25%
// 20260225d: LINE Custom Token Auth（Firebase UID = LINE userId）
// 20260225e: 補載 firebase-functions-compat SDK
// 20260225f: 改用 Access Token 驗證（ID Token 過期問題）
// 20260225g: 修復 LIFF/Firebase 初始化競態條件（LIFF 先完成再啟動 Firebase Auth）
// 20260225h: Prod 模式移除匿名登入 fallback，避免產生無用匿名用戶
// 20260225i: lastLogin 節流（10 分鐘內不重寫），避免觸發跨裝置 onSnapshot 閃爍
// 20260226f: 修復新用戶卡在「登入確認中」—liff.init()/Auth timeout + isPendingLogin 自動降級
const CACHE_VERSION = '20260226f';

// ─── Achievement Condition Config ───
const ACHIEVEMENT_CONDITIONS = {
  timeRanges: [
    { key: 'none',   label: '累計' },
    { key: '7d',     label: '7 天內' },
    { key: '30d',    label: '30 天內' },
    { key: '90d',    label: '90 天內' },
    { key: 'streak', label: '連續 N 天' },
  ],
  actions: [
    { key: 'register_event',  label: '報名活動',             unit: '場', needsFilter: true },
    { key: 'complete_event',  label: '完成活動（簽到+簽退）', unit: '場', needsFilter: true },
    { key: 'organize_event',  label: '主辦活動',             unit: '場', needsFilter: true },
    { key: 'attend_play',     label: '參與 PLAY 活動',       unit: '場', needsFilter: false },
    { key: 'attend_friendly', label: '參與友誼活動',         unit: '場', needsFilter: false },
    { key: 'attend_camp',     label: '參與教學活動',         unit: '場', needsFilter: false },
    { key: 'attend_watch',    label: '參與觀賽',             unit: '場', needsFilter: false },
    { key: 'attendance_rate', label: '達到出席率',           unit: '%', needsFilter: false },
    { key: 'reach_level',     label: '達到等級',             unit: '',  needsFilter: false },
    { key: 'reach_exp',       label: '累計 EXP',             unit: '',  needsFilter: false },
    { key: 'join_team',       label: '加入球隊',             unit: '',  needsFilter: false },
    { key: 'list_shop_item',  label: '刊登二手商品',         unit: '件', needsFilter: false },
    { key: 'sell_shop_item',  label: '售出二手商品',         unit: '件', needsFilter: false },
    { key: 'complete_profile',label: '完成個人檔案',         unit: '',  needsFilter: false },
    { key: 'bind_line_notify',label: '綁定 LINE 推播',       unit: '',  needsFilter: false },
    { key: 'earn_badges',     label: '獲得徽章',             unit: '個', needsFilter: false },
    { key: 'days_registered', label: '註冊天數',             unit: '天', needsFilter: false },
  ],
  filters: [
    { key: 'all',      label: '所有類型' },
    { key: 'play',     label: 'PLAY' },
    { key: 'friendly', label: '友誼' },
    { key: 'camp',     label: '教學' },
    { key: 'watch',    label: '觀賽' },
  ],
};

// ─── Mode Manager（Demo / Production 切換）───
const ModeManager = {
  _STORAGE_KEY: 'sporthub_mode',
  // 預設正式版模式
  _DEFAULT: 'production',
  _mode: null,

  init() {
    this._mode = localStorage.getItem(this._STORAGE_KEY) || this._DEFAULT;
    // 正式版 hostname 安全檢查：防止被舊版 bug 殘留的 demo 模式影響
    if (['toosterx.com','www.toosterx.com','msw2004727.github.io','fc-3g8.pages.dev'].includes(location.hostname) && this._mode === 'demo') {
      this._mode = 'production';
      localStorage.setItem(this._STORAGE_KEY, 'production');
    }
    console.log(
      `%c[SportHub] 模式: ${this._mode.toUpperCase()} (${location.hostname})`,
      'color:#0d9488;font-weight:bold;font-size:14px'
    );
    console.log('%c[SportHub] 隱藏切換方式:', 'color:#6b7280');
    console.log('  1. 連續點擊 Logo 5 次（3 秒內）');
    console.log('  2. 按鍵組合 Shift + Alt + D');
    console.log("  3. Console 指令: switchMode('<密碼>')");
  },

  getMode()  { return this._mode; },
  isDemo()   { return this._mode === 'demo'; },

  setMode(mode) {
    if (mode !== 'demo' && mode !== 'production') return;
    this._mode = mode;
    localStorage.setItem(this._STORAGE_KEY, mode);
    console.log(
      `%c[SportHub] 已切換至: ${mode.toUpperCase()}`,
      'color:#d97706;font-weight:bold;font-size:14px'
    );
  },

  toggle() {
    this.setMode(this._mode === 'demo' ? 'production' : 'demo');
    return this._mode;
  },
};
ModeManager.init();

// ─── LINE Login Config ───
const LINE_CONFIG = {
  LIFF_ID: '2009084941-zgn7tQOp',
  CHANNEL_ID: '2009084941',
  BOT_BASIC_ID: '@830utvza',
};

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

// ─── Demo User → Role Mapping (for capsule tags) ───
const DEMO_USERS = {
  '王小明': 'user', '李大華': 'coach', '張三': 'user', '陳美玲': 'user',
  '林志偉': 'user', '周杰倫': 'user', '黃小琳': 'user', '吳宗翰': 'user',
  '鄭家豪': 'user', '許志安': 'user', '蔡依林': 'user', '劉德華': 'user',
  '王大明': 'captain', '李小華': 'coach', '張美玲': 'captain', '陳志偉': 'venue_owner',
  '小麥': 'user', '林大豪': 'user', '周書翰': 'user',
  '教練小陳': 'coach', '場主老王': 'venue_owner', '教練阿豪': 'coach',
  '管理員': 'admin', '場主大衛': 'venue_owner',
  '隊長A': 'captain', '隊長D': 'captain', '隊長F': 'captain',
  '隊長G': 'captain', '隊長I': 'captain', '隊長K': 'captain',
  '教練B': 'coach', '教練C': 'coach', '教練E': 'coach',
  '教練H': 'coach', '教練J': 'coach', '教練L': 'coach', '教練M': 'coach',
  '暱稱A': 'user', '暱稱B': 'user', '暱稱C': 'coach', '暱稱D': 'user',
};

// ─── Type & Status Config ───
const TYPE_CONFIG = {
  friendly: { icon: '', label: '友誼', color: 'friendly' },
  camp:     { icon: '', label: '教學', color: 'camp' },
  play:     { icon: '', label: 'PLAY', color: 'play' },
  watch:    { icon: '', label: '觀賽', color: 'watch' },
};

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
};

const TOURNAMENT_GRADIENT_MAP = {
  '盃賽': 'linear-gradient(135deg,#7c3aed,#4338ca)',
};

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
  { icon: '', label: '分享網頁', i18nKey: 'drawer.share', action: 'share', minRole: 'user' },
  { divider: true },
  { icon: '', label: '活動管理', i18nKey: 'drawer.activityManage', page: 'page-my-activities', minRole: 'coach' },
  { icon: '', label: '賽事管理', i18nKey: 'drawer.tournamentManage', page: 'page-admin-tournaments', minRole: 'coach' },
  { divider: true, minRole: 'admin' },
  { sectionLabel: '後台管理', i18nKey: 'drawer.backendManage', minRole: 'admin' },
  { icon: '', label: '數據儀表板', i18nKey: 'admin.dashboard', page: 'page-admin-dashboard', minRole: 'admin' },
  { icon: '', label: '用戶管理', i18nKey: 'admin.userManage', page: 'page-admin-users', minRole: 'admin' },
  { icon: '', label: '廣告管理', i18nKey: 'admin.adManage', page: 'page-admin-banners', minRole: 'admin' },
  { icon: '', label: '二手商品管理', i18nKey: 'admin.shopManage', page: 'page-admin-shop', minRole: 'admin' },
  { icon: '', label: '站內信管理', i18nKey: 'admin.messageManage', page: 'page-admin-messages', minRole: 'admin' },
  { icon: '', label: '球隊管理', i18nKey: 'admin.teamManage', page: 'page-admin-teams', minRole: 'admin' },
  { icon: '', label: '佈景主題', i18nKey: 'admin.themes', page: 'page-admin-themes', minRole: 'super_admin' },
  { icon: '', label: '手動 EXP 管理', i18nKey: 'admin.expManage', page: 'page-admin-exp', minRole: 'super_admin' },
  { icon: '', label: '自動 EXP 管理', i18nKey: 'drawer.autoExpManage', page: 'page-admin-auto-exp', minRole: 'super_admin' },
  { icon: '', label: '系統公告管理', i18nKey: 'admin.announcements', page: 'page-admin-announcements', minRole: 'super_admin' },
  { icon: '', label: '成就/徽章管理', i18nKey: 'admin.achievements', page: 'page-admin-achievements', minRole: 'super_admin' },
  { icon: '', label: '自訂層級管理', i18nKey: 'admin.roles', page: 'page-admin-roles', minRole: 'super_admin' },
  { icon: '', label: '無效資料查詢', i18nKey: 'admin.inactive', page: 'page-admin-inactive', minRole: 'super_admin' },
  { icon: '', label: '操作日誌', i18nKey: 'admin.logs', page: 'page-admin-logs', minRole: 'super_admin' },
];
