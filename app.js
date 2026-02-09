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
    // ── 2月（近期熱門 — 本週~兩週內） ──
    { id: 'eh1', title: '週三足球基礎訓練', type: 'training', status: 'open', location: '台北市大安運動中心', date: '2026/02/11 19:00~21:00', fee: 200, max: 20, current: 14, waitlist: 0, waitlistMax: 5, creator: '教練小陳', contact: '0912-345-678', gradient: 'linear-gradient(135deg,#0d9488,#065f46)', icon: '⚽', countdown: '2天 10時', participants: ['王小明','李大華','張三','陳美玲','林志偉','周杰倫','黃小琳','吳宗翰','鄭家豪','許志安','蔡依林','劉德華','A','B'], waitlistNames: [] },
    { id: 'eh2', title: '歐冠觀賽之夜', type: 'watch', status: 'open', location: '台北市Goal Sports Bar', date: '2026/02/12 20:30~23:00', fee: 350, max: 40, current: 28, waitlist: 0, waitlistMax: 10, creator: '場主老王', contact: '02-2771-5566', gradient: 'linear-gradient(135deg,#f59e0b,#d97706)', icon: '⚽', countdown: '3天 11時', participants: [], waitlistNames: [] },
    { id: 'eh3', title: '週六足球友誼賽', type: 'friendly', status: 'open', location: '台北市信義運動中心', date: '2026/02/14 14:00~16:00', fee: 300, max: 22, current: 16, waitlist: 0, waitlistMax: 5, creator: '教練小陳', contact: '0912-345-678', gradient: 'linear-gradient(135deg,#0d9488,#065f46)', icon: '⚽', countdown: '5天 5時', participants: [], waitlistNames: [] },
    { id: 'eh4', title: '五人制室內足球', type: 'friendly', status: 'full', location: '高雄市三民體育館', date: '2026/02/18 18:00~20:00', fee: 200, max: 12, current: 12, waitlist: 3, waitlistMax: 5, creator: '場主老王', contact: '', gradient: 'linear-gradient(135deg,#0d9488,#065f46)', icon: '⚽', countdown: '9天 9時', participants: [], waitlistNames: ['候補X','候補Y','候補Z'] },
    { id: 'eh5', title: '英超直播派對', type: 'watch', status: 'open', location: '台中市Kick-Off 運動餐廳', date: '2026/02/21 22:00~00:30', fee: 280, max: 50, current: 18, waitlist: 0, waitlistMax: 0, creator: '場主大衛', contact: '04-2225-8888', gradient: 'linear-gradient(135deg,#f59e0b,#d97706)', icon: '⚽', countdown: '12天 13時', participants: [], waitlistNames: [] },
    // ── 2月（已結束） ──
    { id: 'e0a', title: '冬季足球體能測試', type: 'test', status: 'ended', location: '台北市大安運動中心', date: '2026/02/22 08:00~12:00', fee: 0, max: 30, current: 28, waitlist: 0, waitlistMax: 0, creator: '教練阿豪', contact: '0922-111-222', gradient: 'linear-gradient(135deg,#d97706,#92400e)', icon: '⚽', countdown: '已結束', participants: ['王小明','李大華','張三','陳美玲','林志偉','黃小琳','吳宗翰','鄭家豪'], waitlistNames: [] },
    { id: 'e0b', title: '週六足球友誼賽', type: 'friendly', status: 'ended', location: '台北市大安運動中心', date: '2026/02/22 14:00~16:00', fee: 300, max: 20, current: 20, waitlist: 2, waitlistMax: 5, creator: '教練小陳', contact: '0912-345-678', gradient: 'linear-gradient(135deg,#0d9488,#065f46)', icon: '⚽', countdown: '已結束', participants: ['王小明','李大華','張三','陳美玲','林志偉','周杰倫','黃小琳','吳宗翰','鄭家豪','許志安','蔡依林','劉德華','A','B','C','D','E','F','G','H'], waitlistNames: ['候補A','候補B'] },
    { id: 'e0c', title: '足球新手學習營（第一梯）', type: 'camp', status: 'ended', location: '台中市豐原體育場', date: '2026/02/25 09:00~12:00', fee: 500, max: 20, current: 20, waitlist: 8, waitlistMax: 5, creator: '教練阿豪', contact: '0922-111-222', gradient: 'linear-gradient(135deg,#7c3aed,#4338ca)', icon: '⚽', countdown: '已結束', participants: [], waitlistNames: [] },
    // ── 3月 ──
    { id: 'e1', title: '春季聯賽第三輪', type: 'league', status: 'ended', location: '台北市大安運動中心', date: '2026/03/01 14:00~18:00', fee: 0, max: 22, current: 22, waitlist: 0, waitlistMax: 0, creator: '管理員', contact: '', gradient: 'linear-gradient(135deg,#dc2626,#991b1b)', icon: '⚽', countdown: '已結束', participants: [], waitlistNames: [] },
    { id: 'e2', title: '守門員專項訓練班', type: 'training', status: 'ended', location: '台北市信義運動中心', date: '2026/03/05 09:00~11:00', fee: 250, max: 10, current: 10, waitlist: 3, waitlistMax: 3, creator: '教練小陳', contact: '0912-345-678', gradient: 'linear-gradient(135deg,#0d9488,#065f46)', icon: '⚽', countdown: '已結束', participants: [], waitlistNames: [] },
    { id: 'e3', title: '五人制室內足球', type: 'friendly', status: 'ended', location: '高雄市三民體育館', date: '2026/03/08 18:00~20:00', fee: 200, max: 12, current: 12, waitlist: 0, waitlistMax: 3, creator: '場主老王', contact: '', gradient: 'linear-gradient(135deg,#0d9488,#065f46)', icon: '⚽', countdown: '已結束', participants: ['P1','P2','P3','P4','P5','P6','P7','P8','P9','P10','P11','P12'], waitlistNames: [] },
    { id: 'e4', title: '週六足球友誼賽', type: 'friendly', status: 'open', location: '台北市大安運動中心', date: '2026/03/15 14:00~16:00', fee: 300, max: 20, current: 12, waitlist: 3, waitlistMax: 5, creator: '教練小陳', contact: '0912-345-678', gradient: 'linear-gradient(135deg,#0d9488,#065f46)', icon: '⚽', countdown: '2天 5時', participants: ['王小明','李大華','張三','陳美玲','林志偉','周杰倫','黃小琳','吳宗翰','鄭家豪','許志安','蔡依林','劉德華'], waitlistNames: ['候補A','候補B','候補C'] },
    { id: 'e5', title: '足球戰術研習營', type: 'camp', status: 'full', location: '台中市豐原體育場', date: '2026/03/18 09:00~12:00', fee: 400, max: 15, current: 15, waitlist: 5, waitlistMax: 5, creator: '教練阿豪', contact: '0922-111-222', gradient: 'linear-gradient(135deg,#7c3aed,#4338ca)', icon: '⚽', countdown: '5天 2時', participants: ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O'], waitlistNames: ['W1','W2','W3','W4','W5'] },
    { id: 'e6', title: '足球體能訓練', type: 'training', status: 'open', location: '高雄市三民體育館', date: '2026/03/20 07:00~09:00', fee: 150, max: 25, current: 8, waitlist: 0, waitlistMax: 3, creator: '教練阿豪', contact: '0922-111-222', gradient: 'linear-gradient(135deg,#0d9488,#065f46)', icon: '⚽', countdown: '7天 14時', participants: ['P1','P2','P3','P4','P5','P6','P7','P8'], waitlistNames: [] },
    { id: 'e7', title: '週六11人制友誼賽', type: 'friendly', status: 'open', location: '台北市信義運動中心', date: '2026/03/22 14:00~16:30', fee: 350, max: 24, current: 18, waitlist: 0, waitlistMax: 5, creator: '教練小陳', contact: '0912-345-678', gradient: 'linear-gradient(135deg,#0d9488,#065f46)', icon: '⚽', countdown: '9天 6時', participants: [], waitlistNames: [] },
    { id: 'e8', title: '春季聯賽第四輪', type: 'league', status: 'open', location: '台北市大安運動中心', date: '2026/03/29 14:00~18:00', fee: 0, max: 22, current: 22, waitlist: 0, waitlistMax: 0, creator: '管理員', contact: '', gradient: 'linear-gradient(135deg,#dc2626,#991b1b)', icon: '⚽', countdown: '16天 5時', participants: [], waitlistNames: [] },
    { id: 'e9', title: '足球裁判培訓班', type: 'camp', status: 'open', location: '台北市大安運動中心', date: '2026/03/29 09:00~12:00', fee: 600, max: 12, current: 5, waitlist: 0, waitlistMax: 0, creator: '管理員', contact: '', gradient: 'linear-gradient(135deg,#7c3aed,#4338ca)', icon: '⚽', countdown: '16天 0時', participants: [], waitlistNames: [] },
    // ── 4月 ──
    { id: 'e10', title: '守門員撲救專訓', type: 'training', status: 'open', location: '台北市信義運動中心', date: '2026/04/02 09:00~11:00', fee: 250, max: 10, current: 4, waitlist: 0, waitlistMax: 3, creator: '教練小陳', contact: '0912-345-678', gradient: 'linear-gradient(135deg,#0d9488,#065f46)', icon: '⚽', countdown: '20天 0時', participants: [], waitlistNames: [] },
    { id: 'e11', title: '新春盃淘汰賽首輪', type: 'cup', status: 'full', location: '台中市豐原體育場', date: '2026/04/05 13:00~17:00', fee: 0, max: 32, current: 32, waitlist: 0, waitlistMax: 0, creator: '管理員', contact: '', gradient: 'linear-gradient(135deg,#d97706,#92400e)', icon: '⚽', countdown: '23天 4時', participants: [], waitlistNames: [] },
    { id: 'e12', title: '足球新手學習營（第二梯）', type: 'camp', status: 'open', location: '台中市豐原體育場', date: '2026/04/06 09:00~12:00', fee: 500, max: 20, current: 7, waitlist: 0, waitlistMax: 5, creator: '教練阿豪', contact: '0922-111-222', gradient: 'linear-gradient(135deg,#7c3aed,#4338ca)', icon: '⚽', countdown: '24天 0時', participants: [], waitlistNames: [] },
    { id: 'e13', title: '週六足球友誼賽', type: 'friendly', status: 'upcoming', location: '台北市大安運動中心', date: '2026/04/12 14:00~16:00', fee: 300, max: 20, current: 0, waitlist: 0, waitlistMax: 5, creator: '教練小陳', contact: '0912-345-678', gradient: 'linear-gradient(135deg,#0d9488,#065f46)', icon: '⚽', countdown: '30天 5時', participants: [], waitlistNames: [] },
    { id: 'e14', title: '春季足球體能測試', type: 'test', status: 'upcoming', location: '高雄市三民體育館', date: '2026/04/15 08:00~12:00', fee: 0, max: 30, current: 0, waitlist: 0, waitlistMax: 0, creator: '教練阿豪', contact: '0922-111-222', gradient: 'linear-gradient(135deg,#d97706,#92400e)', icon: '⚽', countdown: '33天 0時', participants: [], waitlistNames: [] },
    { id: 'e15', title: '新春盃淘汰賽八強', type: 'cup', status: 'upcoming', location: '台中市豐原體育場', date: '2026/04/19 13:00~17:00', fee: 0, max: 16, current: 0, waitlist: 0, waitlistMax: 0, creator: '管理員', contact: '', gradient: 'linear-gradient(135deg,#d97706,#92400e)', icon: '⚽', countdown: '37天 4時', participants: [], waitlistNames: [] },
    { id: 'e16', title: '五人制足球友誼賽', type: 'friendly', status: 'cancelled', location: '高雄市三民體育館', date: '2026/04/20 18:00~20:00', fee: 200, max: 12, current: 4, waitlist: 0, waitlistMax: 3, creator: '場主老王', contact: '', gradient: 'linear-gradient(135deg,#0d9488,#065f46)', icon: '⚽', countdown: '已取消', participants: [], waitlistNames: [] },
    { id: 'e17', title: '春季聯賽第五輪', type: 'league', status: 'upcoming', location: '台北市大安運動中心', date: '2026/04/26 14:00~18:00', fee: 0, max: 22, current: 0, waitlist: 0, waitlistMax: 0, creator: '管理員', contact: '', gradient: 'linear-gradient(135deg,#dc2626,#991b1b)', icon: '⚽', countdown: '44天 5時', participants: [], waitlistNames: [] },
  ],

  tournaments: [
    { id: 't1', name: '2026 春季足球聯賽', type: '聯賽（雙循環）', teams: 8, matches: 56, status: '進行中', gradient: 'linear-gradient(135deg,#dc2626,#991b1b)' },
    { id: 't2', name: '新春盃足球淘汰賽', type: '盃賽（單敗淘汰）', teams: 16, matches: 15, status: '即將開始', gradient: 'linear-gradient(135deg,#7c3aed,#4338ca)' },
    { id: 't3', name: '2025 秋季足球聯賽', type: '聯賽（雙循環）', teams: 8, matches: 56, status: '已結束', gradient: 'linear-gradient(135deg,#6b7280,#374151)' },
    { id: 't4', name: '市長盃五人制足球賽', type: '盃賽（分組+淘汰）', teams: 12, matches: 20, status: '報名中', gradient: 'linear-gradient(135deg,#0d9488,#065f46)' },
  ],

  teams: [
    { id: 'tm1', name: '雷霆隊', nameEn: 'Thunder FC', emblem: '⚡', captain: '隊長A', coaches: ['教練B','教練C'], members: 18, color: '#3b82f6', region: '台北市', active: true },
    { id: 'tm2', name: '閃電隊', nameEn: 'Lightning FC', emblem: '🌩', captain: '隊長D', coaches: ['教練E'], members: 15, color: '#eab308', region: '台中市', active: true },
    { id: 'tm3', name: '旋風隊', nameEn: 'Cyclone FC', emblem: '🌀', captain: '隊長F', coaches: [], members: 12, color: '#10b981', region: '高雄市', active: true },
    { id: 'tm4', name: '火焰隊', nameEn: 'Blaze FC', emblem: '🔥', captain: '隊長G', coaches: ['教練H'], members: 20, color: '#ef4444', region: '台北市', active: true },
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
    { name: '足球達人', icon: '⚽' }, { name: '守門員', icon: '🧤' },
    { name: '前鋒王', icon: '🎯' }, { name: '助攻王', icon: '🤝' },
    { name: '最佳隊友', icon: '🌟' }, { name: '鐵腿王', icon: '🦵' },
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
    { name: '五人制室內足球', date: '03/08', status: 'completed' },
    { name: '守門員專項訓練班', date: '03/05', status: 'completed' },
    { name: '春季聯賽第三輪', date: '03/01', status: 'completed' },
    { name: '週六足球友誼賽', date: '02/22', status: 'completed' },
    { name: '冬季足球體能測試', date: '02/22', status: 'early-left' },
    { name: '足球新手學習營', date: '02/25', status: 'cancelled' },
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
    this.startBannerCarousel();
    this.renderAll();
    this.applyRole('user');
  },

  // ── Role System ──
  bindRoleSwitcher() {
    const wrapper = document.getElementById('role-switcher-wrapper');
    if (!wrapper) return;

    const avatarBtn = wrapper.querySelector('.role-avatar-btn');
    const dropdown = wrapper.querySelector('.role-dropdown');
    const dropdownItems = wrapper.querySelectorAll('.role-dropdown-item');

    if (!avatarBtn || !dropdown) return;

    // 點擊頭像按鈕展開/收合選單
    avatarBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isOpen = dropdown.classList.contains('open');
      avatarBtn.classList.toggle('open', !isOpen);
      dropdown.classList.toggle('open', !isOpen);
    });

    // 點擊選單項目切換身份
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

    // 點擊下拉選單外的地方關閉選單
    document.addEventListener('click', (e) => {
      if (!wrapper.contains(e.target)) {
        avatarBtn.classList.remove('open');
        dropdown.classList.remove('open');
      }
    });
  },

  // ── Sport Picker ──
  bindSportPicker() {
    const wrapper = document.getElementById('sport-picker-wrapper');
    if (!wrapper) return;

    const btn = wrapper.querySelector('.sport-picker-btn');
    const dropdown = wrapper.querySelector('.sport-picker-dropdown');
    const items = wrapper.querySelectorAll('.sport-picker-item');

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // 關閉其他可能開啟的下拉選單
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

        // 更新按鈕圖示
        btn.querySelector('.sport-picker-icon').textContent = icon;

        // 同步首頁運動類別列的 active 狀態
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

    // 點擊外部關閉
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

  // ── Tournament Tabs (bound dynamically in showTournamentDetail) ──
  bindTournamentTabs() {},

  // ── Scan Mode ──
  bindScanModes() {
    document.querySelectorAll('.scan-mode').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.scan-mode').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  },

  // ── Notif Button → Messages Page ──
  bindNotifBtn() {
    document.getElementById('notif-btn')?.addEventListener('click', () => {
      this.showPage('page-messages');
      // deactivate bottom tabs since messages is no longer a bottom tab
      document.querySelectorAll('.bot-tab').forEach(t => t.classList.remove('active'));
    });
  },

  // ── Banner Carousel ──
  startBannerCarousel() {
    const track = document.getElementById('banner-track');
    const dots = document.getElementById('banner-dots');
    const slides = track.querySelectorAll('.banner-slide');
    const count = slides.length;
    this.bannerCount = count;

    // Create dots
    dots.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const dot = document.createElement('div');
      dot.className = 'banner-dot' + (i === 0 ? ' active' : '');
      dot.addEventListener('click', () => this.goToBanner(i));
      dots.appendChild(dot);
    }

    // Arrow buttons
    document.getElementById('banner-prev')?.addEventListener('click', () => {
      this.goToBanner((this.bannerIndex - 1 + count) % count);
    });
    document.getElementById('banner-next')?.addEventListener('click', () => {
      this.goToBanner((this.bannerIndex + 1) % count);
    });

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
    this.renderTournamentTimeline();
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

  // ── Render: Hot Events (next 2 weeks only) ──
  renderHotEvents() {
    const container = document.getElementById('hot-events');
    const now = new Date();
    const twoWeeksLater = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    const upcoming = DemoData.events.filter(e => {
      if (e.status === 'ended' || e.status === 'cancelled') return false;
      const parts = e.date.split(' ')[0].split('/');
      const eventDate = new Date(+parts[0], +parts[1] - 1, +parts[2]);
      return eventDate >= now && eventDate <= twoWeeksLater;
    });

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

  // ── Render: Ongoing Tournaments ──
  renderOngoingTournaments() {
    const container = document.getElementById('ongoing-tournaments');
    container.innerHTML = DemoData.tournaments.map(t => `
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

  // ── Type icons & labels ──
  TYPE_CONFIG: {
    friendly: { icon: '🤝', label: '友誼賽', color: 'friendly' },
    training: { icon: '🏋️', label: '訓練', color: 'training' },
    league:   { icon: '🏆', label: '聯賽', color: 'league' },
    cup:      { icon: '🥊', label: '盃賽', color: 'cup' },
    test:     { icon: '📋', label: '測試', color: 'test' },
    camp:     { icon: '🎓', label: '學習營', color: 'camp' },
    watch:    { icon: '📺', label: '觀賽', color: 'watch' },
  },

  STATUS_CONFIG: {
    open:      { label: '報名中', css: 'open' },
    full:      { label: '已額滿', css: 'full' },
    ended:     { label: '已結束', css: 'ended' },
    upcoming:  { label: '即將開放', css: 'upcoming' },
    cancelled: { label: '已取消', css: 'cancelled' },
  },

  DAY_NAMES: ['日','一','二','三','四','五','六'],

  // ── Render: Activity Timeline ──
  renderActivityList() {
    const container = document.getElementById('activity-list');
    if (!container) return;

    // 將事件依月份 → 日期分組
    const monthGroups = {};
    DemoData.events.forEach(e => {
      const parts = e.date.split(' ')[0].split('/');
      const monthKey = `${parts[0]}/${parts[1]}`;
      const day = parseInt(parts[2], 10);
      const dateObj = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, day);
      const dayName = this.DAY_NAMES[dateObj.getDay()];

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
          const typeConf = this.TYPE_CONFIG[e.type] || this.TYPE_CONFIG.friendly;
          const statusConf = this.STATUS_CONFIG[e.status] || this.STATUS_CONFIG.open;
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

  // ── Show Event Detail ──
  showEventDetail(id) {
    const e = DemoData.events.find(ev => ev.id === id);
    if (!e) return;
    document.getElementById('detail-title').textContent = e.title;
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
      <div class="tc-card" onclick="App.showTeamDetail('${t.id}')">
        <div class="tc-img-placeholder">隊徽 120 × 120</div>
        <div class="tc-body">
          <div class="tc-name">${t.name}</div>
          <div class="tc-name-en">${t.nameEn || ''}</div>
          <div class="tc-info-row"><span class="tc-label">👑 領隊</span><span>${t.captain}</span></div>
          <div class="tc-info-row"><span class="tc-label">🏋️ 教練</span><span>${t.coaches.length > 0 ? t.coaches.join('、') : '—'}</span></div>
          <div class="tc-info-row"><span class="tc-label">👥 隊員</span><span>${t.members} 人</span></div>
          <div class="tc-info-row"><span class="tc-label">📍 地區</span><span>${t.region}</span></div>
        </div>
      </div>
    `).join('');
  },

  showTeamDetail(id) {
    const t = DemoData.teams.find(tm => tm.id === id);
    if (!t) return;
    document.getElementById('team-detail-title').textContent = t.name;
    document.getElementById('team-detail-name-en').textContent = t.nameEn || '';
    document.getElementById('team-detail-body').innerHTML = `
      <!-- 基本資訊卡片 -->
      <div class="td-card">
        <div class="td-card-title">球隊資訊</div>
        <div class="td-card-grid">
          <div class="td-card-item">
            <span class="td-card-label">👑 領隊</span>
            <span class="td-card-value">${t.captain}</span>
          </div>
          <div class="td-card-item">
            <span class="td-card-label">🏋️ 教練</span>
            <span class="td-card-value">${t.coaches.length > 0 ? t.coaches.join('、') : '無'}</span>
          </div>
          <div class="td-card-item">
            <span class="td-card-label">👥 隊員數</span>
            <span class="td-card-value">${t.members} 人</span>
          </div>
          <div class="td-card-item">
            <span class="td-card-label">📍 地區</span>
            <span class="td-card-value">${t.region}</span>
          </div>
        </div>
      </div>

      <!-- 分頁 -->
      <div class="tab-bar compact">
        <button class="tab active">成員</button>
        <button class="tab">戰績</button>
        <button class="tab">賽事</button>
      </div>

      <!-- 成員列表卡片 -->
      <div class="td-card">
        <div class="td-card-title">成員列表</div>
        <div class="td-member-list">
          ${Array.from({length: Math.min(t.members, 8)}, (_, i) => {
            const role = i === 0 ? '領隊' : i <= t.coaches.length ? '教練' : '球員';
            const roleClass = i === 0 ? 'captain' : i <= t.coaches.length ? 'coach' : 'player';
            return `
            <div class="td-member-card">
              <div class="td-member-avatar" style="background:${t.color}22;color:${t.color}">${i === 0 ? t.captain.charAt(t.captain.length - 1) : String.fromCharCode(65 + i)}</div>
              <div class="td-member-info">
                <div class="td-member-name">${i === 0 ? t.captain : i <= t.coaches.length ? t.coaches[i - 1] : '球員' + String.fromCharCode(65 + i)}</div>
                <span class="td-member-role ${roleClass}">${role}</span>
              </div>
            </div>`;
          }).join('')}
          ${t.members > 8 ? `<div class="td-member-more">... 共 ${t.members} 人</div>` : ''}
        </div>
      </div>

      <!-- 操作按鈕 -->
      <div class="td-actions">
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
  // ── Render: Tournament Timeline (bottom tab page) ──
  renderTournamentTimeline() {
    const container = document.getElementById('tournament-timeline');
    if (!container) return;

    const leagues = DemoData.tournaments.filter(t => t.type.includes('聯賽'));
    const cups = DemoData.tournaments.filter(t => !t.type.includes('聯賽'));

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

  // ── Show Tournament Detail ──
  showTournamentDetail(id) {
    this.currentTournament = id;
    const t = DemoData.tournaments.find(x => x.id === id);
    if (!t) return;
    document.getElementById('td-title').textContent = t.name;
    this.showPage('page-tournament-detail');

    // Rebind detail tabs
    document.querySelectorAll('#td-tabs .tab').forEach(tab => {
      tab.onclick = () => {
        document.querySelectorAll('#td-tabs .tab').forEach(x => x.classList.remove('active'));
        tab.classList.add('active');
        this.renderTournamentTab(tab.dataset.ttab);
      };
    });
    // Reset to schedule tab
    document.querySelectorAll('#td-tabs .tab').forEach(x => x.classList.toggle('active', x.dataset.ttab === 'schedule'));
    this.renderTournamentTab('schedule');
  },

  // ── Render: Tournament Tab Content ──
  renderTournamentTab(tab) {
    const container = document.getElementById('tournament-content');
    if (!container) return;
    const t = DemoData.tournaments.find(x => x.id === this.currentTournament);
    const isCup = t && !t.type.includes('聯賽');

    if (tab === 'schedule') {
      if (isCup) {
        // Bracket diagram for cups
        container.innerHTML = this.renderBracket();
      } else {
        // Compact match cards + round-robin
        container.innerHTML = this.renderLeagueSchedule();
      }
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
        ${DemoData.trades.map(tr => `
          <div class="trade-card">
            <div style="font-weight:600;margin-bottom:.25rem">${tr.from} → ${tr.to}</div>
            <div>球員：${tr.player}　價值：${tr.value} 積分</div>
            <div style="margin-top:.3rem"><span class="trade-status ${tr.status}">${tr.status === 'success' ? '✅ 成交' : '⏳ 待確認'}</span> <span style="font-size:.72rem;color:var(--text-muted)">${tr.date}</span></div>
          </div>
        `).join('')}`;
    }
  },

  // ── League: Compact Schedule + Round Robin ──
  renderLeagueSchedule() {
    const teams = DemoData.teams;
    const matches = DemoData.matches;

    // Compact match cards
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

    // Round-robin cross table
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

  // ── Cup: Bracket Diagram ──
  renderBracket() {
    const bracketData = [
      // Quarter-finals
      { round: '八強', matches: [
        { t1: '雷霆隊', s1: 3, t2: '旋風B隊', s2: 0, e1: '⚡', e2: '🌀' },
        { t1: '閃電隊', s1: 2, t2: '火焰B隊', s2: 1, e1: '🌩', e2: '🔥' },
        { t1: '旋風隊', s1: 1, t2: '獵鷹隊', s2: 1, e1: '🌀', e2: '🦅' },
        { t1: '火焰隊', s1: 4, t2: '鐵衛隊', s2: 2, e1: '🔥', e2: '🛡' },
      ]},
      // Semi-finals
      { round: '四強', matches: [
        { t1: '雷霆隊', s1: null, t2: '閃電隊', s2: null, e1: '⚡', e2: '🌩' },
        { t1: '?', s1: null, t2: '火焰隊', s2: null, e1: '?', e2: '🔥' },
      ]},
      // Final
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
    // Show events not ended/cancelled (up to 6), prioritizing recent
    const myEvents = DemoData.events
      .filter(e => e.status !== 'ended' && e.status !== 'cancelled')
      .slice(0, 6);
    container.innerHTML = myEvents.length > 0
      ? myEvents.map(e => {
        const statusConf = this.STATUS_CONFIG[e.status] || this.STATUS_CONFIG.open;
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

  // ── Floating Ads Smooth Scroll ──
  bindFloatingAds() {
    const floatingAds = document.getElementById('floating-ads');
    if (!floatingAds) return;

    let targetOffset = 0;
    let currentOffset = 0;
    let rafId = null;

    // 使用 lerp 插值讓移動絲滑
    const lerp = (start, end, factor) => start + (end - start) * factor;

    const animate = () => {
      currentOffset = lerp(currentOffset, targetOffset, 0.06);

      // 當幾乎到達目標時停止動畫
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

    // 滾動時計算目標偏移：以頁面中心為基準，輕微跟隨滾動
    window.addEventListener('scroll', () => {
      const scrollY = window.scrollY || 0;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      // 將滾動進度映射到 ±60px 的小範圍偏移，產生微妙的浮動感
      const progress = docHeight > 0 ? (scrollY / docHeight) : 0;
      targetOffset = (progress - 0.5) * 120;
      startAnimation();
    }, { passive: true });

    // 初始化位置
    floatingAds.style.top = '50vh';
    floatingAds.style.transform = 'translateY(-50%)';
  },

  // ── Create Event ──
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

    if (!title) { this.showToast('請輸入活動名稱'); return; }
    if (!location) { this.showToast('請輸入地點'); return; }
    if (!dateVal) { this.showToast('請選擇日期'); return; }

    const dateParts = dateVal.split('-');
    const dateStr = `${dateParts[0]}/${parseInt(dateParts[1])}/${parseInt(dateParts[2])}`;
    const fullDate = timeVal ? `${dateParts[0]}/${parseInt(dateParts[1]).toString().padStart(2,'0')}/${parseInt(dateParts[2]).toString().padStart(2,'0')} ${timeVal}` : dateStr;

    const typeConf = this.TYPE_CONFIG[type] || this.TYPE_CONFIG.friendly;
    const gradients = {
      friendly: 'linear-gradient(135deg,#0d9488,#065f46)',
      training: 'linear-gradient(135deg,#7c3aed,#4338ca)',
      league:   'linear-gradient(135deg,#dc2626,#991b1b)',
      cup:      'linear-gradient(135deg,#d97706,#92400e)',
      test:     'linear-gradient(135deg,#2563eb,#1e40af)',
      camp:     'linear-gradient(135deg,#ec4899,#be185d)',
      watch:    'linear-gradient(135deg,#f59e0b,#d97706)',
    };

    this._eventCounter++;
    const newEvent = {
      id: 'ce' + this._eventCounter,
      title,
      type,
      status: 'open',
      location,
      date: fullDate,
      fee,
      max,
      current: 0,
      waitlist: 0,
      waitlistMax,
      creator: ROLES[this.currentRole]?.label || '一般用戶',
      contact: '',
      gradient: gradients[type] || gradients.friendly,
      icon: '⚽',
      countdown: '即將開始',
      participants: [],
      waitlistNames: [],
    };

    DemoData.events.unshift(newEvent);

    // Re-render relevant sections
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
    document.getElementById('ce-image').value = '';
    const cePreview = document.getElementById('ce-upload-preview');
    if (cePreview) {
      cePreview.classList.remove('has-image');
      cePreview.innerHTML = '<span class="ce-upload-icon">📷</span><span class="ce-upload-text">點擊上傳圖片</span><span class="ce-upload-hint">建議尺寸 800 × 300 px｜JPG / PNG｜最大 2MB</span>';
    }
  },

  // ── Image Upload Preview ──
  bindImageUpload(inputId, previewId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) return;
      // Validate format
      const validTypes = ['image/jpeg', 'image/png'];
      if (!validTypes.includes(file.type)) {
        this.showToast('僅支援 JPG / PNG 格式');
        input.value = '';
        return;
      }
      // Validate size (2MB)
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

  // ── Create Tournament ──
  _tournamentCounter: 100,
  handleCreateTournament() {
    const name = document.getElementById('ct-name').value.trim();
    const type = document.getElementById('ct-type').value;
    const teams = parseInt(document.getElementById('ct-teams').value) || 8;
    const status = document.getElementById('ct-status').value;

    if (!name) { this.showToast('請輸入賽事名稱'); return; }

    const gradients = {
      '聯賽（雙循環）': 'linear-gradient(135deg,#dc2626,#991b1b)',
      '盃賽（單敗淘汰）': 'linear-gradient(135deg,#7c3aed,#4338ca)',
      '盃賽（分組+淘汰）': 'linear-gradient(135deg,#0d9488,#065f46)',
    };

    this._tournamentCounter++;
    DemoData.tournaments.unshift({
      id: 'ct' + this._tournamentCounter,
      name,
      type,
      teams,
      matches: type.includes('聯賽') ? teams * (teams - 1) : teams - 1,
      status,
      gradient: gradients[type] || gradients['聯賽（雙循環）'],
    });

    this.renderTournamentTimeline();
    this.renderOngoingTournaments();
    this.renderTournamentManage();
    this.closeModal();
    this.showToast(`賽事「${name}」已建立！`);

    document.getElementById('ct-name').value = '';
    // Reset upload preview
    const preview = document.getElementById('ct-upload-preview');
    if (preview) {
      preview.classList.remove('has-image');
      preview.innerHTML = '<span class="ce-upload-icon">📷</span><span class="ce-upload-text">點擊上傳圖片</span><span class="ce-upload-hint">建議尺寸 800 × 300 px｜JPG / PNG｜最大 2MB</span>';
    }
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
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});

// Close modal on overlay click
document.getElementById('modal-overlay')?.addEventListener('click', () => App.closeModal());
