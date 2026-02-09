/* ================================================
   SportHub — Demo Data
   ※ 實裝時此檔案將被移除，改由 API 取得真實資料
   ================================================ */

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
    { id: 'tm1', name: '雷霆隊', nameEn: 'Thunder FC', emblem: '⚡', captain: '隊長A', coaches: ['教練B','教練C'], members: 18, color: '#3b82f6', region: '台北市', active: true, pinned: true, pinOrder: 1, wins: 12, draws: 3, losses: 2, gf: 35, ga: 15, history: [{name:'2026春季聯賽',result:'進行中 — 第1名'},{name:'2025秋季聯賽',result:'冠軍🏆'},{name:'新春盃淘汰賽',result:'四強'}] },
    { id: 'tm2', name: '閃電隊', nameEn: 'Lightning FC', emblem: '🌩', captain: '隊長D', coaches: ['教練E'], members: 15, color: '#eab308', region: '台中市', active: true, pinned: true, pinOrder: 2, wins: 9, draws: 4, losses: 4, gf: 28, ga: 20, history: [{name:'2026春季聯賽',result:'進行中 — 第2名'},{name:'2025秋季聯賽',result:'季軍'}] },
    { id: 'tm3', name: '旋風隊', nameEn: 'Cyclone FC', emblem: '🌀', captain: '隊長F', coaches: [], members: 12, color: '#10b981', region: '高雄市', active: true, pinned: true, pinOrder: 3, wins: 7, draws: 5, losses: 5, gf: 22, ga: 21, history: [{name:'2026春季聯賽',result:'進行中 — 第3名'},{name:'新春盃淘汰賽',result:'八強'}] },
    { id: 'tm4', name: '火焰隊', nameEn: 'Blaze FC', emblem: '🔥', captain: '隊長G', coaches: ['教練H'], members: 20, color: '#ef4444', region: '台北市', active: true, pinned: true, pinOrder: 4, wins: 6, draws: 3, losses: 8, gf: 20, ga: 28, history: [{name:'2026春季聯賽',result:'進行中 — 第4名'},{name:'2025秋季聯賽',result:'亞軍'}] },
    { id: 'tm5', name: '獵鷹隊', nameEn: 'Falcon FC', emblem: '🦅', captain: '隊長I', coaches: ['教練J'], members: 16, color: '#8b5cf6', region: '新北市', active: true, pinned: false, pinOrder: 0, wins: 4, draws: 2, losses: 3, gf: 14, ga: 12, history: [{name:'市長盃五人制',result:'報名中'}] },
    { id: 'tm6', name: '黑熊隊', nameEn: 'Bears FC', emblem: '🐻', captain: '隊長K', coaches: ['教練L','教練M'], members: 22, color: '#1e293b', region: '桃園市', active: true, pinned: false, pinOrder: 0, wins: 8, draws: 1, losses: 6, gf: 25, ga: 23, history: [{name:'2025秋季聯賽',result:'第5名'},{name:'新春盃淘汰賽',result:'十六強'}] },
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
    { id:'sh1', name:'Nike Phantom GT2', price:1800, condition:'9成新', year:2025, size:'US10', desc:'穿過約10次，鞋底磨損極少，適合草地場。附原廠鞋盒。' },
    { id:'sh2', name:'Adidas 訓練球衣', price:500, condition:'8成新', year:2024, size:'L', desc:'白色訓練球衣，透氣排汗材質，領口有輕微使用痕跡。' },
    { id:'sh3', name:'Puma 護脛', price:300, condition:'全新', year:2026, size:'M', desc:'全新未拆封，輕量化設計，附收納袋。' },
    { id:'sh4', name:'手套 (守門員)', price:600, condition:'7成新', year:2024, size:'L', desc:'Reusch 守門員手套，掌面乳膠仍有良好抓力，適合練習使用。' },
    { id:'sh5', name:'Joma 球褲', price:350, condition:'9成新', year:2025, size:'M', desc:'黑色短褲，彈性腰帶，側邊口袋。只穿過幾次比賽。' },
    { id:'sh6', name:'運動水壺 1L', price:150, condition:'全新', year:2026, size:'—', desc:'不鏽鋼保溫水壺，雙層真空，可保冷12小時。全新未使用。' },
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
    { rank: 5, name: '獵鷹隊', w: 1, d: 2, l: 3, pts: 5 },
    { rank: 6, name: '黑熊隊', w: 1, d: 1, l: 4, pts: 4 },
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

// ── Enhance Events with Age Restriction & Notes ──
(function() {
  const ageMap = { eh1:16, eh2:18, eh3:0, eh4:16, eh5:18, e0a:0, e0b:0, e0c:12, e1:0, e2:16, e3:16, e4:0, e5:16, e6:0, e7:18, e8:0, e9:20, e10:16, e11:0, e12:12, e13:0, e14:0, e15:0, e16:16, e17:0 };
  const notesMap = {
    eh1: '請自備球鞋及飲用水，訓練場地為室內人工草皮。遲到15分鐘以上視為缺席。',
    eh2: '現場提供飲料一杯，需年滿18歲入場。座位有限，請提早報名。',
    eh3: '歡迎新手參加，會依程度分組。請穿著合適運動服裝與球鞋。',
    eh4: '室內場地禁止穿著釘鞋，請穿平底室內足球鞋。比賽規則依五人制國際規則。',
    eh5: '本次轉播英超焦點賽事，現場大螢幕觀賽，附設餐飲可另外點餐。',
    e0c: '適合初學者，教練團全程指導。請攜帶水壺及毛巾，穿著運動服裝。',
    e2: '專項守門員訓練，需具備基本足球經驗。請自備守門員手套。',
    e5: '本營著重戰術分析與陣型演練，建議有基礎足球經驗者報名。',
    e9: '培訓內容含規則講解、實際執法演練，完成者可獲裁判資格證明。',
    e12: '第二梯次開放報名，歡迎零基礎新手，無需自備裝備。',
  };
  DemoData.events.forEach(e => {
    e.minAge = ageMap[e.id] || 0;
    e.notes = notesMap[e.id] || '';
  });
})();
