/* ================================================
   SportHub — Config & Constants
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
  friendly: { icon: '🤝', label: '友誼賽', color: 'friendly' },
  training: { icon: '🏋️', label: '訓練', color: 'training' },
  league:   { icon: '🏆', label: '聯賽', color: 'league' },
  cup:      { icon: '🥊', label: '盃賽', color: 'cup' },
  test:     { icon: '📋', label: '測試', color: 'test' },
  camp:     { icon: '🎓', label: '學習營', color: 'camp' },
  watch:    { icon: '📺', label: '觀賽', color: 'watch' },
};

const STATUS_CONFIG = {
  open:      { label: '報名中', css: 'open' },
  full:      { label: '已額滿', css: 'full' },
  ended:     { label: '已結束', css: 'ended' },
  upcoming:  { label: '即將開放', css: 'upcoming' },
  cancelled: { label: '已取消', css: 'cancelled' },
};

const DAY_NAMES = ['日','一','二','三','四','五','六'];

// ─── Gradient Map (for event creation) ───
const GRADIENT_MAP = {
  friendly: 'linear-gradient(135deg,#0d9488,#065f46)',
  training: 'linear-gradient(135deg,#7c3aed,#4338ca)',
  league:   'linear-gradient(135deg,#dc2626,#991b1b)',
  cup:      'linear-gradient(135deg,#d97706,#92400e)',
  test:     'linear-gradient(135deg,#2563eb,#1e40af)',
  camp:     'linear-gradient(135deg,#ec4899,#be185d)',
  watch:    'linear-gradient(135deg,#f59e0b,#d97706)',
};

const TOURNAMENT_GRADIENT_MAP = {
  '聯賽（雙循環）': 'linear-gradient(135deg,#dc2626,#991b1b)',
  '盃賽（單敗淘汰）': 'linear-gradient(135deg,#7c3aed,#4338ca)',
  '盃賽（分組+淘汰）': 'linear-gradient(135deg,#0d9488,#065f46)',
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
  { icon: '⚽', label: '球隊管理', page: 'page-admin-teams', minRole: 'admin' },
  { icon: '🏟', label: '賽事管理', page: 'page-admin-tournaments', minRole: 'admin' },
  { icon: '🏅', label: '成就/徽章管理', page: 'page-admin-achievements', minRole: 'super_admin' },
  { icon: '⚙', label: '自訂層級管理', page: 'page-admin-roles', minRole: 'super_admin' },
  { icon: '📂', label: '無效資料查詢', page: 'page-admin-inactive', minRole: 'super_admin' },
  { icon: '📝', label: '操作日誌', page: 'page-admin-logs', minRole: 'super_admin' },
];
