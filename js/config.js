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
// 20260226g: LINE 首次登入速度優化（ensureProfile + Firebase 並行化 + profile 快取）
// 20260226k: 解除首頁底部隊伍按鈕「功能準備中」擋板（保留賽事按鈕）
// 20260226l: 球隊頁右上角新增球隊按鈕（依後台 rolePermissions 的 team.create 顯示）
// 20260226m: 球隊建立領隊必填 + 詳情頁編輯入口 + 修復入隊申請站內信收件人解析
// 20260226n: rolePermissions 改為 onSnapshot 即時同步（權限變更可即時反映前台功能）
// 20260226w: 修復球隊隊員在活動行事曆看不到球隊限定活動（補 adminUsers teamId fallback）
// 20260226x: 活動行事曆球隊限定標籤改為固定「球隊限定」
// 20260226y: 活動頁熱區卡片球隊限定標籤與行事曆統一為「球隊限定」
// 20260226z: 修復活動開始即 ended 與 ended/cancelled 活動狀態切換後前端短暫消失
// 20260226za: 活動行事曆卡片球隊限定標籤文案改為「限定」
// 20260226zb: 修復手動/掃碼簽到寫入錯誤被吞、備註讀取抓到舊紀錄問題
// 20260226zc: 簽到編輯改為軟刪除（status=removed），保留審計軌跡並避開 attendanceRecords delete 規則
// 20260226ze: 簽到寫入前補 Firebase Auth 自動重試，權限錯誤改為明確中文提示
// 20260226zf: 修復簽到簽退權限：Firestore rules 改 isCoachPlus()、錯誤訊息全中文化
// 20260226zg: 簽到簽退 update 規則放寬為 isAuth()，確保活動主辦/委託人（含非教練）皆可操作
// 20260226zh: 圖片上傳改為 WebP 格式（不支援時自動降級 JPEG）
// 20260226zi: 修復 Auth 狀態恢復競態：等待 onAuthStateChanged + persistence 恢復後再檢查登入
// 20260226zj: 登入/報名/取消報名前強制確認 Auth 已登入，避免未認證寫入
// 20260226zk: 修復站內信頁籤分類失效（bindTabBars 搶先綁定導致過濾邏輯未掛載）
// 20260227e: 移除重複「報名名單」標題（改為顯示在表頭含人數）+ 修復手動簽到閃爍（containerId race + setTimeout settle）
// 20260227f: 移除活動詳情頁「報名名單」section title 與分隔線
// 20260227g: 未報名單改為整表手動簽到模式，按鈕移至表頭右側
// 20260227h: 未報名單編輯模式補回踢掉功能 + _removeUnregUser
// 20260227i: 候補名單新增正取功能（編輯按鈕 + 紫色正取按鈕 + _forcePromoteWaitlist）
// 20260227j: 候補名單編輯按鈕改為紫底白字
// 20260227k: 正取後重整仍出現候補名單問題修正（await registration 寫入）
// 20260227l: 正取 activityRecords 更新也改為 await
// 20260227m: 取消報名誤觸同行者 modal 修正（重複本人報名不跳 companion modal）
// 20260227x: 首頁活動卡左上角自動加上黃底粗體月/日標籤
// 20260227y: 修正 event-list.js map block body 缺少 } 的語法錯誤
// 20260227z: 入隊申請升級：廣播全體職員、冷卻機制、第一操作勝出、教練可審核
// 20260227za: 入隊申請 pending 逾 24h 自動解鎖可重新申請
// 20260227zb: 個人頁面球隊申請記錄依 groupId 去重，修正廣播後顯示重複筆數
// 20260227zc: banner 初始 skeleton + V 版本號同步修正 SW 快取清除失效
// 20260227zo: 站內信審批 — ensureAuth + 修正 in-memory rollback + leaderUids isTeamStaff
// 20260227zp: 歷史入隊補正 — 去重改為每人取最新一筆 + 目標球隊存在性驗證
// 20260227zq: 操作日誌排序修正 — 最新在最上面（依 time 字串降序）
// 20260227zr: 補齊操作日誌 — 申請入隊、退出球隊、忽略審批、商品 CRUD、取消報名、手動簽到
// 20260227zs: 前端錯誤日誌系統 — 自動記錄系統異常到 Firestore errorLogs，總管可查閱/清除
// 20260227zt: 補上 admin.errorLogs i18n 翻譯（錯誤日誌按鈕顯示正確）
// 20260227zu: 修復 _writeErrorLog 靜默失敗（FirebaseService._db → db）+ 入隊審批 permission-denied（rules 改用 sameFieldValue）
// 20260227zv: 入隊審批 permission-denied 終極修復 — users.update 改 isAuth() + _ensureAuth 檢查回傳值
// 20260227zw: 修復錯誤日誌寫入/讀取 — .catch 改為 console.warn 可見 + rules 改 token.role 直接判斷避免 roleFromUserDoc null 問題
// 20260227zx: 球隊介紹頁 — 成員膠囊全部顯示（移除 slice/...xx人）+ 新增球隊限定活動欄位
// 20260227zy: 隊員數改為即時從 users.teamId 動態計算（team-detail + team-list 共 4 處）
// 20260227zz: 個人資料頁球隊申請欄位只顯示最新一筆
// 20260227zza: 球隊動態實裝 DB 寫入（發文/刪文/置頂/表情/留言/刪留言 共 6 處）
// 20260228a: force global cache refresh for i18n locale rollout
// 20260228b: team invite share text + dynamic team OG + team-share redirects
// 20260228c: Cloudflare Worker route for team-share dynamic OG (main domain)
// 20260228d: team detail member list edit mode + staff-only member removal with full sync
// 20260228e: multi-team membership compatibility (teamIds/teamNames) + join flow unblock
// 20260228h: firestore rules security hardening + team-only multi-select redesign + memory sync
// 20260228i: event sport-tag single-select + required validation + SVG sport icons
// 20260228j: switch sport category icons from SVG to Emoji
// 20260228k: team-only selector display fallback (avoid raw tm_* IDs in UI)
// 20260228l: deep-link boot guard + full-screen transition overlay (avoid home flash before target page)
// 20260228m: deep-link unauth flow auto-redirects to LINE login instead of timing out on overlay
const CACHE_VERSION = '20260228m';

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

const EVENT_SPORT_OPTIONS = [
  { key: 'football', label: '足球' },
  { key: 'basketball', label: '籃球' },
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
  { key: 'restaurant', label: '餐廳' },
  { key: 'pickleball', label: '匹克球' },
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
  pickleball: '🏓',
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
  const emoji = SPORT_ICON_EMOJI[safeKey] || SPORT_ICON_EMOJI.football;
  const klass = className ? ` ${className}` : '';
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
  { icon: '', label: '錯誤日誌', i18nKey: 'admin.errorLogs', page: 'page-admin-error-logs', minRole: 'super_admin' },
  { icon: '', label: '歷史入隊補正', i18nKey: 'admin.repair', page: 'page-admin-repair', minRole: 'super_admin' },
];
