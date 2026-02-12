/* ================================================
   SportHub — Demo Data
   ※ 實裝時此檔案將被移除，改由 API 取得真實資料
   ================================================ */

const DemoData = {
  currentUser: {
    uid: 'demo-user',
    lineUserId: 'demo',
    displayName: '小麥',
    pictureUrl: null,
    role: 'user',
    exp: 33300,
    level: 25,
    titleBig: '冠軍',
    titleNormal: '全勤',
    gender: '男',
    birthday: '1995/03/15',
    region: '台北市',
    sports: '足球、籃球',
    teamId: 'tm1',
    teamName: '雷霆隊',
    phone: '0912-345-678',
    totalGames: 42,
    completedGames: 38,
    attendanceRate: 90,
    badgeCount: 4,
    favorites: { events: ['eh3', 'eh5'], tournaments: ['t2'] },
    socialLinks: { fb: 'xiaomai.football', ig: 'xiaomai_fc', threads: '', yt: '', twitter: '' },
    joinDate: '2025/09/01',
    lineNotify: {
      bound: true,
      boundAt: '2025/09/15',
      settings: { activity: true, system: true, tournament: false }
    },
  },

  events: [
    // ── 2月（近期熱門 — 本週~兩週內） ──
    { id: 'eh1', title: '週三足球基礎練習', type: 'play', status: 'open', location: '台北市大安運動中心', date: '2026/02/11 19:00~21:00', fee: 200, max: 20, current: 14, waitlist: 0, waitlistMax: 5, creator: '教練小陳', contact: '0912-345-678', gradient: 'linear-gradient(135deg,#7c3aed,#4338ca)', icon: '', countdown: '2天 10時', participants: ['王小明','李大華','張三','陳美玲','林志偉','周杰倫','黃小琳','吳宗翰','鄭家豪','許志安','蔡依林','劉德華','A','B'], waitlistNames: [] },
    { id: 'eh2', title: '歐冠觀賽之夜', type: 'watch', status: 'open', location: '台北市Goal Sports Bar', date: '2026/02/12 20:30~23:00', fee: 350, max: 40, current: 37, waitlist: 0, waitlistMax: 10, creator: '場主老王', contact: '02-2771-5566', gradient: 'linear-gradient(135deg,#f59e0b,#d97706)', icon: '', countdown: '3天 11時', participants: [], waitlistNames: [] },
    { id: 'eh3', title: '週六足球友誼賽', type: 'friendly', status: 'open', location: '台北市信義運動中心', date: '2026/02/14 14:00~16:00', fee: 300, max: 22, current: 16, waitlist: 0, waitlistMax: 5, creator: '教練小陳', contact: '0912-345-678', gradient: 'linear-gradient(135deg,#0d9488,#065f46)', icon: '', countdown: '5天 5時', participants: [], waitlistNames: [], regOpenTime: '2026-02-01T08:00' },
    { id: 'eh3t', title: '雷霆隊內練習', type: 'play', status: 'open', location: '台北市大安運動中心', date: '2026/02/15 18:00~20:00', fee: 0, max: 18, current: 10, waitlist: 0, waitlistMax: 3, creator: '小麥', creatorUid: 'demo-user', contact: '', gradient: 'linear-gradient(135deg,#7c3aed,#4338ca)', icon: '', countdown: '6天 9時', participants: ['王小明','李大華','張三','陳美玲','林志偉','周杰倫','黃小琳','吳宗翰','鄭家豪','許志安'], waitlistNames: [], teamOnly: true, creatorTeamId: 'tm1', creatorTeamName: '雷霆隊', delegates: [{uid:'U4d5e6f', name:'李大華'}] },
    { id: 'eh4', title: '五人制室內足球', type: 'friendly', status: 'open', location: '高雄市三民體育館', date: '2026/02/18 18:00~20:00', fee: 200, max: 12, current: 11, waitlist: 0, waitlistMax: 5, creator: '場主老王', contact: '', gradient: 'linear-gradient(135deg,#0d9488,#065f46)', icon: '', countdown: '9天 9時', participants: ['王小明','李大華','張三','陳美玲','林志偉','周杰倫','黃小琳','吳宗翰','鄭家豪','許志安','蔡依林'], waitlistNames: [] },
    { id: 'eh5', title: '英超直播派對', type: 'watch', status: 'open', location: '台中市Kick-Off 運動餐廳', date: '2026/02/21 22:00~00:30', fee: 280, max: 50, current: 18, waitlist: 0, waitlistMax: 0, creator: '場主大衛', contact: '04-2225-8888', gradient: 'linear-gradient(135deg,#f59e0b,#d97706)', icon: '', countdown: '12天 13時', participants: [], waitlistNames: [] },
    // ── 2月（已結束） ──
    { id: 'e0a', title: '冬季足球體能活動', type: 'play', status: 'ended', location: '台北市大安運動中心', date: '2026/02/22 08:00~12:00', fee: 0, max: 30, current: 28, waitlist: 0, waitlistMax: 0, creator: '教練阿豪', contact: '0922-111-222', gradient: 'linear-gradient(135deg,#7c3aed,#4338ca)', icon: '', countdown: '已結束', participants: ['王小明','李大華','張三','陳美玲','林志偉','黃小琳','吳宗翰','鄭家豪'], waitlistNames: [], reviews: [{uid:'U1a2b3c',name:'王小明',rating:5,text:'很棒的體能訓練，教練很專業！',time:'2026/02/22 13:00'},{uid:'U4d5e6f',name:'李大華',rating:4,text:'場地不錯，下次還會再參加。',time:'2026/02/22 14:30'},{uid:'Us1t2u3',name:'黃小琳',rating:5,text:'強度適中，適合各程度球員，推薦！',time:'2026/02/22 15:10'},{uid:'Uv4w5x6',name:'吳宗翰',rating:3,text:'希望可以多一些拉伸環節。',time:'2026/02/22 16:00'}] },
    { id: 'e0b', title: '週六足球友誼賽', type: 'friendly', status: 'ended', location: '台北市大安運動中心', date: '2026/02/22 14:00~16:00', fee: 300, max: 20, current: 20, waitlist: 2, waitlistMax: 5, creator: '教練小陳', contact: '0912-345-678', gradient: 'linear-gradient(135deg,#0d9488,#065f46)', icon: '', countdown: '已結束', participants: ['王小明','李大華','張三','陳美玲','林志偉','周杰倫','黃小琳','吳宗翰','鄭家豪','許志安','蔡依林','劉德華','A','B','C','D','E','F','G','H'], waitlistNames: ['候補A','候補B'], reviews: [{uid:'U7g8h9i',name:'張美玲',rating:5,text:'比賽很精彩，氣氛超好！',time:'2026/02/22 17:00'},{uid:'Up7q8r9',name:'林志偉',rating:3,text:'人數太多有點擁擠。',time:'2026/02/22 18:00'},{uid:'Us1t2u3',name:'黃小琳',rating:4,text:'整體不錯，希望下次可以早點開始。',time:'2026/02/22 19:00'},{uid:'U1a2b3c',name:'王小明',rating:5,text:'對手實力很強，打得很過癮！',time:'2026/02/22 19:30'},{uid:'Ub2c3d4',name:'許志安',rating:4,text:'場地設施很好，裁判也很公正。',time:'2026/02/22 20:00'}] },
    { id: 'e0c', title: '足球新手教學（第一梯）', type: 'camp', status: 'ended', location: '台中市豐原體育場', date: '2026/02/25 09:00~12:00', fee: 500, max: 20, current: 20, waitlist: 8, waitlistMax: 5, creator: '教練阿豪', contact: '0922-111-222', gradient: 'linear-gradient(135deg,#7c3aed,#4338ca)', icon: '', countdown: '已結束', participants: [], waitlistNames: [] },
    // ── 3月 ──
    { id: 'e1', title: '春季PLAY第三輪', type: 'play', status: 'ended', location: '台北市大安運動中心', date: '2026/03/01 14:00~18:00', fee: 0, max: 22, current: 22, waitlist: 0, waitlistMax: 0, creator: '管理員', contact: '', gradient: 'linear-gradient(135deg,#7c3aed,#4338ca)', icon: '', countdown: '已結束', participants: [], waitlistNames: [] },
    { id: 'e2', title: '守門員專項教學', type: 'camp', status: 'ended', location: '台北市信義運動中心', date: '2026/03/05 09:00~11:00', fee: 250, max: 10, current: 10, waitlist: 3, waitlistMax: 3, creator: '教練小陳', contact: '0912-345-678', gradient: 'linear-gradient(135deg,#ec4899,#be185d)', icon: '', countdown: '已結束', participants: [], waitlistNames: [] },
    { id: 'e3', title: '五人制室內足球', type: 'friendly', status: 'ended', location: '高雄市三民體育館', date: '2026/03/08 18:00~20:00', fee: 200, max: 12, current: 12, waitlist: 0, waitlistMax: 3, creator: '場主老王', contact: '', gradient: 'linear-gradient(135deg,#0d9488,#065f46)', icon: '', countdown: '已結束', participants: ['P1','P2','P3','P4','P5','P6','P7','P8','P9','P10','P11','P12'], waitlistNames: [] },
    { id: 'e4', title: '週六足球友誼賽', type: 'friendly', status: 'open', location: '台北市大安運動中心', date: '2026/03/15 14:00~16:00', fee: 300, max: 20, current: 12, waitlist: 3, waitlistMax: 5, creator: '教練小陳', contact: '0912-345-678', gradient: 'linear-gradient(135deg,#0d9488,#065f46)', icon: '', countdown: '2天 5時', participants: ['王小明','李大華','張三','陳美玲','林志偉','周杰倫','黃小琳','吳宗翰','鄭家豪','許志安','蔡依林','劉德華'], waitlistNames: ['候補A','候補B','候補C'], regOpenTime: '2026-02-10T10:00' },
    { id: 'e5', title: '足球戰術教學班', type: 'camp', status: 'full', location: '台中市豐原體育場', date: '2026/03/18 09:00~12:00', fee: 400, max: 15, current: 15, waitlist: 5, waitlistMax: 5, creator: '教練阿豪', contact: '0922-111-222', gradient: 'linear-gradient(135deg,#7c3aed,#4338ca)', icon: '', countdown: '5天 2時', participants: ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O'], waitlistNames: ['W1','W2','W3','W4','W5'] },
    { id: 'e6', title: '足球體能PLAY', type: 'play', status: 'open', location: '高雄市三民體育館', date: '2026/03/20 07:00~09:00', fee: 150, max: 25, current: 8, waitlist: 0, waitlistMax: 3, creator: '教練阿豪', contact: '0922-111-222', gradient: 'linear-gradient(135deg,#7c3aed,#4338ca)', icon: '', countdown: '7天 14時', participants: ['P1','P2','P3','P4','P5','P6','P7','P8'], waitlistNames: [] },
    { id: 'e7', title: '週六11人制友誼賽', type: 'friendly', status: 'open', location: '台北市信義運動中心', date: '2026/03/22 14:00~16:30', fee: 350, max: 24, current: 18, waitlist: 0, waitlistMax: 5, creator: '教練小陳', contact: '0912-345-678', gradient: 'linear-gradient(135deg,#0d9488,#065f46)', icon: '', countdown: '9天 6時', participants: [], waitlistNames: [] },
    { id: 'e8', title: '春季PLAY第四輪', type: 'play', status: 'open', location: '台北市大安運動中心', date: '2026/03/29 14:00~18:00', fee: 0, max: 22, current: 22, waitlist: 0, waitlistMax: 0, creator: '管理員', contact: '', gradient: 'linear-gradient(135deg,#7c3aed,#4338ca)', icon: '', countdown: '16天 5時', participants: [], waitlistNames: [] },
    { id: 'e9', title: '足球裁判教學班', type: 'camp', status: 'open', location: '台北市大安運動中心', date: '2026/03/29 09:00~12:00', fee: 600, max: 12, current: 5, waitlist: 0, waitlistMax: 0, creator: '管理員', contact: '', gradient: 'linear-gradient(135deg,#7c3aed,#4338ca)', icon: '', countdown: '16天 0時', participants: [], waitlistNames: [] },
    // ── 4月 ──
    { id: 'e10', title: '守門員撲救教學', type: 'camp', status: 'open', location: '台北市信義運動中心', date: '2026/04/02 09:00~11:00', fee: 250, max: 10, current: 4, waitlist: 0, waitlistMax: 3, creator: '教練小陳', contact: '0912-345-678', gradient: 'linear-gradient(135deg,#ec4899,#be185d)', icon: '', countdown: '20天 0時', participants: [], waitlistNames: [] },
    { id: 'e11', title: '新春PLAY淘汰賽', type: 'play', status: 'full', location: '台中市豐原體育場', date: '2026/04/05 13:00~17:00', fee: 0, max: 32, current: 32, waitlist: 0, waitlistMax: 0, creator: '管理員', contact: '', gradient: 'linear-gradient(135deg,#7c3aed,#4338ca)', icon: '', countdown: '23天 4時', participants: [], waitlistNames: [] },
    { id: 'e12', title: '足球新手教學（第二梯）', type: 'camp', status: 'open', location: '台中市豐原體育場', date: '2026/04/06 09:00~12:00', fee: 500, max: 20, current: 7, waitlist: 0, waitlistMax: 5, creator: '教練阿豪', contact: '0922-111-222', gradient: 'linear-gradient(135deg,#7c3aed,#4338ca)', icon: '', countdown: '24天 0時', participants: [], waitlistNames: [] },
    { id: 'e13', title: '週六足球友誼賽', type: 'friendly', status: 'upcoming', location: '台北市大安運動中心', date: '2026/04/12 14:00~16:00', fee: 300, max: 20, current: 0, waitlist: 0, waitlistMax: 5, creator: '教練小陳', contact: '0912-345-678', gradient: 'linear-gradient(135deg,#0d9488,#065f46)', icon: '', countdown: '30天 5時', participants: [], waitlistNames: [], regOpenTime: '2026-03-15T08:00' },
    { id: 'e14', title: '春季足球體能活動', type: 'play', status: 'upcoming', location: '高雄市三民體育館', date: '2026/04/15 08:00~12:00', fee: 200, max: 30, current: 0, waitlist: 0, waitlistMax: 0, creator: '教練阿豪', contact: '0922-111-222', gradient: 'linear-gradient(135deg,#7c3aed,#4338ca)', icon: '', countdown: '33天 0時', participants: [], waitlistNames: [], regOpenTime: '2026-03-20T08:00' },
    { id: 'e15', title: '新春PLAY八強賽', type: 'play', status: 'upcoming', location: '台中市豐原體育場', date: '2026/04/19 13:00~17:00', fee: 150, max: 16, current: 0, waitlist: 0, waitlistMax: 0, creator: '管理員', contact: '', gradient: 'linear-gradient(135deg,#7c3aed,#4338ca)', icon: '', countdown: '37天 4時', participants: [], waitlistNames: [], regOpenTime: '2026-03-25T08:00' },
    { id: 'e16', title: '五人制足球友誼賽', type: 'friendly', status: 'cancelled', location: '高雄市三民體育館', date: '2026/04/20 18:00~20:00', fee: 200, max: 12, current: 4, waitlist: 0, waitlistMax: 3, creator: '場主老王', contact: '', gradient: 'linear-gradient(135deg,#0d9488,#065f46)', icon: '', countdown: '已取消', participants: [], waitlistNames: [] },
    { id: 'e17', title: '春季PLAY第五輪', type: 'play', status: 'upcoming', location: '台北市大安運動中心', date: '2026/04/26 14:00~18:00', fee: 250, max: 22, current: 0, waitlist: 0, waitlistMax: 0, creator: '管理員', contact: '', gradient: 'linear-gradient(135deg,#7c3aed,#4338ca)', icon: '', countdown: '44天 5時', participants: [], waitlistNames: [], regOpenTime: '2026-04-01T08:00' },
  ],

  tournaments: [
    { id: 't1', name: '2026 春季盃足球賽', type: '盃賽', teams: 8, matches: 7, region: '台北市', regStart: '2026-01-15T08:00', regEnd: '2026-02-01T23:59', matchDates: ['2026-03-01','2026-03-08','2026-03-15','2026-03-22'], description: '2026 春季盃足球賽，採單敗淘汰制，共 8 隊參賽。每週六於大安運動中心進行比賽，歡迎各隊球迷到場觀賽加油！\n\n賽事規則：\n- 單敗淘汰制，每場 80 分鐘（上下半場各 40 分鐘）\n- 平手進行 PK 賽決定晉級\n- 累計 2 張黃牌停賽 1 場，直接紅牌停賽 2 場', organizer: '管理員', creatorUid: 'admin', maxTeams: 8, registeredTeams: ['tm1','tm2','tm3','tm4','tm5','tm6'], venues: ['大安運動中心','信義運動中心'], fee: 3000, delegates: [{uid:'U4d5e6f',name:'李大華'}], ended: false, status: '截止報名', gradient: 'linear-gradient(135deg,#dc2626,#991b1b)' },
    { id: 't2', name: '新春盃足球淘汰賽', type: '盃賽', teams: 16, matches: 15, region: '台中市', regStart: '2026-02-10T08:00', regEnd: '2026-03-10T23:59', matchDates: ['2026-03-22','2026-03-29','2026-04-05'], description: '新春盃淘汰賽，16 隊角逐冠軍！本屆賽事規模擴大，歡迎全台各地球隊報名挑戰。\n\n比賽地點：台中市豐原體育場\n賽事規則：單敗淘汰制\n\n冠軍獎金 NT$30,000、亞軍 NT$15,000、季軍 NT$8,000', organizer: '教練阿豪', creatorUid: 'U4d5e6f', maxTeams: 16, registeredTeams: ['tm1','tm2','tm3','tm4'], venues: ['豐原體育場'], fee: 5000, delegates: [{uid:'U7g8h9i',name:'張美玲'},{uid:'Uv4w5x6',name:'吳宗翰'}], ended: false, status: '報名中', gradient: 'linear-gradient(135deg,#7c3aed,#4338ca)' },
    { id: 't3', name: '2025 秋季足球聯賽', type: '盃賽', teams: 8, matches: 7, region: '台北市', regStart: '2025-08-01T08:00', regEnd: '2025-08-31T23:59', matchDates: ['2025-09-06','2025-09-13','2025-09-20','2025-09-27','2025-10-04'], description: '2025 秋季聯賽已圓滿結束。恭喜雷霆隊奪得冠軍！\n\n最終排名：\n1. 雷霆隊\n2. 火焰隊\n3. 閃電隊\n4. 旋風隊', organizer: '管理員', creatorUid: 'admin', maxTeams: 8, registeredTeams: ['tm1','tm2','tm3','tm4','tm5','tm6'], venues: ['大安運動中心'], fee: 2000, delegates: [], ended: true, status: '截止報名', gradient: 'linear-gradient(135deg,#6b7280,#374151)' },
    { id: 't4', name: '市長盃五人制足球賽', type: '盃賽', teams: 12, matches: 11, region: '高雄市', regStart: '2026-02-01T08:00', regEnd: '2026-03-15T23:59', matchDates: ['2026-04-12','2026-04-13'], description: '市長盃五人制足球賽，歡迎各隊報名參加！本賽事由高雄市政府主辦，採五人制規則進行。\n\n比賽地點：高雄市三民體育館\n報名費：每隊 NT$2,000\n\n前三名頒發獎盃及獎金，所有參賽隊伍獲得紀念球衣一件。', organizer: '場主老王', creatorUid: 'Uj1k2l3', maxTeams: 12, registeredTeams: ['tm1','tm3','tm5','tm6','tm2','tm4'], venues: ['三民體育館','鳳山體育場'], fee: 2000, delegates: [{uid:'Up7q8r9',name:'林志偉'}], ended: false, status: '報名中', gradient: 'linear-gradient(135deg,#0d9488,#065f46)' },
  ],

  teams: [
    { id: 'tm1', name: '雷霆隊', nameEn: 'Thunder FC', emblem: '雷', captain: '隊長A', coaches: ['教練B','教練C'], members: 18, color: '#3b82f6', region: '台北市', active: true, pinned: true, pinOrder: 1, wins: 12, draws: 3, losses: 2, gf: 35, ga: 15, teamExp: 4500, bio: '雷霆隊成立於 2024 年，以快速反擊與團隊默契著稱。\n球隊宗旨：享受足球、追求卓越。\n\n歡迎對足球有熱忱的夥伴加入，一起在場上揮灑汗水！', history: [{name:'2026春季聯賽',result:'進行中 — 第1名'},{name:'2025秋季聯賽',result:'冠軍'},{name:'新春盃淘汰賽',result:'四強'}], feed: [{id:'f1',uid:'demo-captain-a',name:'隊長A',content:'本週六練球改到下午 3 點，大家記得準時到！',time:'2026/02/10 09:00',pinned:true,reactions:{like:['demo-user','U1a2b3c','U4d5e6f'],heart:['demo-user'],cheer:['U1a2b3c']},comments:[{id:'c0',uid:'demo-user',name:'小麥',text:'收到隊長！',time:'2026/02/10 09:15'},{id:'c0b',uid:'U1a2b3c',name:'王小明',text:'OK 我會準時',time:'2026/02/10 09:20'}]},{id:'f2',uid:'demo-user',name:'小麥',content:'昨天的友誼賽打得很好，大家辛苦了！希望下次可以更注意防守的站位。',time:'2026/02/09 20:30',pinned:false,reactions:{like:['demo-user','U1a2b3c','Up7q8r9'],heart:['U4d5e6f','Us1t2u3'],cheer:['demo-captain-a','Uv4w5x6']},comments:[{id:'c1',uid:'U1a2b3c',name:'王小明',text:'好的收到！',time:'2026/02/09 21:00'},{id:'c1b',uid:'U4d5e6f',name:'李大華',text:'防守確實要加強，下次可以練一下戰術配合',time:'2026/02/09 21:15'}]},{id:'f3',uid:'U1a2b3c',name:'王小明',content:'新球鞋到了，週六要穿來踢球！',time:'2026/02/08 15:00',pinned:false,reactions:{like:['demo-user','Uv4w5x6'],heart:[],cheer:['demo-captain-a']},comments:[{id:'c2',uid:'demo-user',name:'小麥',text:'什麼牌子的？',time:'2026/02/08 15:30'},{id:'c2b',uid:'U1a2b3c',name:'王小明',text:'Nike Phantom，超好穿！',time:'2026/02/08 15:45'}]},{id:'f4x',uid:'U4d5e6f',name:'李大華',content:'分享一個很棒的訓練影片，大家可以參考一下控球技巧，對比賽很有幫助。',time:'2026/02/07 18:00',pinned:false,isPublic:true,reactions:{like:['demo-user','U1a2b3c','demo-captain-a'],heart:['Us1t2u3'],cheer:[]},comments:[{id:'c3',uid:'demo-captain-a',name:'隊長A',text:'感謝分享！',time:'2026/02/07 18:30'}]}] },
    { id: 'tm2', name: '閃電隊', nameEn: 'Lightning FC', emblem: '電', captain: '隊長D', coaches: ['教練E'], members: 15, color: '#eab308', region: '台中市', active: true, pinned: true, pinOrder: 2, wins: 9, draws: 4, losses: 4, gf: 28, ga: 20, teamExp: 3200, bio: '閃電隊來自台中，擅長控球與中場組織。\n我們重視紀律與團隊合作，定期舉辦隊內訓練與友誼賽。', history: [{name:'2026春季聯賽',result:'進行中 — 第2名'},{name:'2025秋季聯賽',result:'季軍'}], feed: [{id:'f4',uid:'demo-captain-d',name:'隊長D',content:'春季聯賽第二輪我們對上旋風隊，大家加油！',time:'2026/02/11 10:00',pinned:true}] },
    { id: 'tm3', name: '旋風隊', nameEn: 'Cyclone FC', emblem: '旋', captain: '隊長F', coaches: [], members: 12, color: '#10b981', region: '高雄市', active: true, pinned: true, pinOrder: 3, wins: 7, draws: 5, losses: 5, gf: 22, ga: 21, teamExp: 1800, bio: '南部最具活力的業餘球隊！\n每週六固定練球，歡迎高雄地區球友加入。', history: [{name:'2026春季聯賽',result:'進行中 — 第3名'},{name:'新春盃淘汰賽',result:'八強'}], feed: [{id:'f5',uid:'demo-captain-f',name:'隊長F',content:'歡迎新隊員加入！下週開始每週三也會有加練。',time:'2026/02/07 18:00',pinned:false}] },
    { id: 'tm4', name: '火焰隊', nameEn: 'Blaze FC', emblem: '火', captain: '隊長G', coaches: ['教練H'], members: 20, color: '#ef4444', region: '台北市', active: true, pinned: true, pinOrder: 4, wins: 6, draws: 3, losses: 8, gf: 20, ga: 28, teamExp: 2500, bio: '火焰隊以熱血聞名，永不放棄是我們的精神。\n2025 秋季聯賽亞軍，目標挑戰冠軍寶座！', history: [{name:'2026春季聯賽',result:'進行中 — 第4名'},{name:'2025秋季聯賽',result:'亞軍'}] },
    { id: 'tm5', name: '獵鷹隊', nameEn: 'Falcon FC', emblem: '鷹', captain: '隊長I', coaches: ['教練J'], members: 16, color: '#8b5cf6', region: '新北市', active: true, pinned: false, pinOrder: 0, wins: 4, draws: 2, losses: 3, gf: 14, ga: 12, teamExp: 800, history: [{name:'市長盃五人制',result:'報名中'}] },
    { id: 'tm6', name: '黑熊隊', nameEn: 'Bears FC', emblem: '熊', captain: '隊長K', coaches: ['教練L','教練M'], members: 22, color: '#1e293b', region: '桃園市', active: true, pinned: false, pinOrder: 0, wins: 8, draws: 1, losses: 6, gf: 25, ga: 23, teamExp: 5100, history: [{name:'2025秋季聯賽',result:'第5名'},{name:'新春盃淘汰賽',result:'十六強'}] },
    { id: 'tm7', name: '飛龍隊', nameEn: 'Dragon FC', emblem: '龍', captain: '暱稱A', coaches: ['教練B'], members: 14, color: '#ef4444', region: '台北市', active: true, pinned: false, pinOrder: 0, wins: 15, draws: 2, losses: 1, gf: 42, ga: 10, teamExp: 6500, history: [{name:'2026春季聯賽',result:'觀望中'}] },
    { id: 'tm8', name: '銀河隊', nameEn: 'Galaxy FC', emblem: '星', captain: '暱稱B', coaches: ['教練C'], members: 19, color: '#ec4899', region: '新北市', active: true, pinned: false, pinOrder: 0, wins: 18, draws: 3, losses: 2, gf: 50, ga: 18, teamExp: 7200, history: [{name:'2025全國盃',result:'冠軍'},{name:'2025秋季聯賽',result:'季軍'}] },
    { id: 'tm9', name: '鳳凰隊', nameEn: 'Phoenix FC', emblem: '鳳', captain: '暱稱C', coaches: ['教練E','教練H'], members: 24, color: '#14b8a6', region: '台中市', active: true, pinned: false, pinOrder: 0, wins: 22, draws: 4, losses: 1, gf: 65, ga: 15, teamExp: 8500, history: [{name:'2025全國盃',result:'亞軍'},{name:'2026春季聯賽',result:'報名中'}] },
    { id: 'tm10', name: '王者隊', nameEn: 'Kings FC', emblem: '王', captain: '暱稱D', coaches: ['教練J','教練L'], members: 25, color: '#dc2626', region: '台北市', active: true, pinned: false, pinOrder: 0, wins: 28, draws: 2, losses: 0, gf: 80, ga: 8, teamExp: 9500, history: [{name:'2025全國盃',result:'冠軍'},{name:'2025秋季聯賽',result:'冠軍'},{name:'2026春季聯賽',result:'報名中'}] },
    { id: 'tm11', name: '海豚隊', nameEn: 'Dolphin FC', emblem: '豚', captain: '王小明', coaches: [], members: 10, color: '#60a5fa', region: '高雄市', active: true, pinned: false, pinOrder: 0, wins: 1, draws: 0, losses: 5, gf: 4, ga: 15, teamExp: 350, history: [] },
    { id: 'tm12', name: '獅王隊', nameEn: 'Lion FC', emblem: '獅', captain: '李大華', coaches: ['教練M'], members: 16, color: '#f59e0b', region: '台南市', active: true, pinned: false, pinOrder: 0, wins: 5, draws: 2, losses: 4, gf: 16, ga: 14, teamExp: 1200, history: [{name:'市長盃五人制',result:'八強'}] },
    { id: 'tm13', name: '野狼隊', nameEn: 'Wolf FC', emblem: '狼', captain: '張美玲', coaches: [], members: 13, color: '#64748b', region: '桃園市', active: true, pinned: false, pinOrder: 0, wins: 8, draws: 3, losses: 5, gf: 22, ga: 20, teamExp: 2800, history: [{name:'2025秋季聯賽',result:'第6名'}] },
    { id: 'tm14', name: '猛虎隊', nameEn: 'Tiger FC', emblem: '虎', captain: '林志偉', coaches: ['教練H'], members: 17, color: '#f97316', region: '台中市', active: true, pinned: false, pinOrder: 0, wins: 10, draws: 4, losses: 3, gf: 30, ga: 18, teamExp: 3800, history: [{name:'2025秋季聯賽',result:'第4名'},{name:'新春盃淘汰賽',result:'八強'}] },
    { id: 'tm15', name: '鐵衛隊', nameEn: 'Shield FC', emblem: '盾', captain: '陳志偉', coaches: [], members: 11, color: '#0d9488', region: '新北市', active: true, pinned: false, pinOrder: 0, wins: 12, draws: 1, losses: 4, gf: 28, ga: 16, teamExp: 4800, history: [{name:'2026春季聯賽',result:'報名中'}] },
  ],

  messages: [
    // ── 系統類 ──
    { id: 'm1', type: 'system', typeName: '系統', title: '春季聯賽報名開始！', preview: '2026 春季足球聯賽現已開放報名...', body: '2026 春季足球聯賽現已開放報名，本季共 8 隊參賽，採用雙循環賽制。\n\n報名截止日期：2026/03/15\n參賽資格：已註冊球隊，隊員 12 人以上\n\n請各隊領隊於截止前完成報名手續，逾期不候。', time: '2026/03/01 10:00', unread: true, senderName: '系統', adminMsgId: 'mg1' },
    { id: 'm5', type: 'system', typeName: '系統', title: '系統維護通知', preview: '本週六凌晨將進行系統更新...', body: '親愛的用戶您好，\n\n本系統將於 2026/02/22（六）凌晨 02:00 ~ 04:00 進行例行維護更新，届時將暫停所有服務。\n\n更新內容：\n1. 修復報名系統已知問題\n2. 優化頁面載入速度\n3. 新增候補自動遞補功能\n\n造成不便敬請見諒。', time: '2026/02/18 11:00', unread: false, senderName: '系統', adminMsgId: 'mg2' },
    { id: 'm10', type: 'system', typeName: '系統', title: '帳號安全提醒', preview: '您的帳號近期在新裝置上登入...', body: '您的帳號於 2026/02/15 21:34 在一台新裝置上登入（iOS 18.2，台北市）。\n\n如果這是您本人的操作，請忽略此訊息。\n如非本人操作，建議您立即更改密碼並聯繫管理員。', time: '2026/02/15 21:35', unread: false, senderName: '系統' },
    { id: 'm16', type: 'system', typeName: '系統', title: '歡迎加入 SportHub！', preview: '感謝您註冊 SportHub 平台...', body: '感謝您註冊 SportHub 平台！\n\n您可以在這裡：\n- 瀏覽並報名各類足球活動\n- 加入喜歡的球隊\n- 參與聯賽與盃賽\n- 在二手商城買賣裝備\n\n如有任何問題，歡迎透過收件箱聯繫管理員。\n祝您使用愉快！', time: '2026/01/10 09:00', unread: false, senderName: '系統' },
    // ── 活動類 ──
    { id: 'm2', type: 'activity', typeName: '活動', title: '候補遞補通知', preview: '您已成功遞補「週六足球友誼賽」...', body: '恭喜！由於有人取消報名，您已從候補名單自動遞補為正式參加者。\n\n活動名稱：週六足球友誼賽\n活動時間：2026/03/08 14:00~16:00\n活動地點：台北市大安運動中心\n\n請準時出席，如需取消請提前至活動頁面操作。', time: '2026/02/28 15:30', unread: true, senderName: '系統' },
    { id: 'm6', type: 'activity', typeName: '活動', title: '活動即將開始提醒', preview: '您報名的「足球新手教學」將於明天...', body: '您報名的活動即將開始，請做好準備！\n\n活動名稱：足球新手教學\n活動時間：2026/03/02 09:00~12:00\n活動地點：台北市大安運動中心\n\n溫馨提醒：\n- 請攜帶運動鞋、飲用水\n- 遲到 15 分鐘以上視為缺席\n- 如需取消請提前 24 小時操作', time: '2026/03/01 18:00', unread: true, senderName: '系統' },
    { id: 'm11', type: 'activity', typeName: '活動', title: '活動已取消通知', preview: '很抱歉，「五人制足球友誼賽」已取消...', body: '很抱歉通知您，以下活動因故取消：\n\n活動名稱：五人制足球友誼賽\n原定時間：2026/04/20 18:00~20:00\n原定地點：高雄市三民體育館\n\n取消原因：場地維修無法使用\n\n如您已繳費，費用將於 3 個工作天內退還。造成不便深感抱歉。', time: '2026/02/14 10:00', unread: false, senderName: '場主老王' },
    { id: 'm13', type: 'activity', typeName: '活動', title: '報名成功通知', preview: '您已成功報名「守門員撲救教學」...', body: '報名成功！以下為您的報名資訊：\n\n活動名稱：守門員撲救教學\n活動時間：2026/04/02 09:00~11:00\n活動地點：台北市信義運動中心\n費用：NT$250\n\n請於活動當日攜帶手套及護膝。期待您的參加！', time: '2026/02/10 14:22', unread: false, senderName: '系統' },
    { id: 'm17', type: 'activity', typeName: '活動', title: '活動變更通知', preview: '「週六11人制友誼賽」地點已變更...', body: '您報名的活動資訊有所變更，請留意：\n\n活動名稱：週六11人制友誼賽\n\n變更項目：\n- 地點：台北市信義運動中心 → 台北市大安運動中心\n- 時間不變：2026/03/22 14:00~16:30\n\n如因變更需要取消報名，請至活動頁面操作。', time: '2026/02/08 09:15', unread: false, senderName: '教練小陳' },
    // ── 交易類 ──
    { id: 'm3', type: 'trade', typeName: '交易', title: '商品詢問通知', preview: '有人對您的「Nike Phantom GT2」有興趣...', body: '有買家對您刊登的商品感興趣！\n\n商品名稱：Nike Phantom GT2\n刊登價格：NT$1,800\n\n買家留言：「請問鞋底磨損程度如何？可以面交看實物嗎？我在大安區。」\n\n請至商城頁面回覆買家。', time: '2026/02/25 09:00', unread: true, senderName: '系統' },
    { id: 'm7', type: 'trade', typeName: '交易', title: '商品已售出', preview: '恭喜！您的「Adidas 訓練球衣」已成交...', body: '恭喜！您的商品已成功售出。\n\n商品名稱：Adidas 訓練球衣\n成交價格：NT$500\n買家：陳大明\n\n請與買家約定交貨時間及方式。交易完成後請至商城確認收款。', time: '2026/02/22 16:40', unread: false, senderName: '系統' },
    { id: 'm14', type: 'trade', typeName: '交易', title: '商品降價通知', preview: '您關注的「Puma 護脛板」已降價...', body: '您關注的商品價格已更新！\n\n商品名稱：Puma 護脛板\n原價：NT$400\n新價：NT$280（降價 30%）\n\n賣家備註：「搬家出清，先搶先贏！」\n\n前往商城查看詳情。', time: '2026/02/05 11:30', unread: false, senderName: '系統' },
    // ── 私訊類 ──
    { id: 'm4', type: 'private', typeName: '私訊', title: '身份升級通知', preview: '您的身份已升級為教練...', body: '恭喜！經管理員審核，您的身份已從「一般用戶」升級為「教練」。\n\n新增權限：\n- 建立與管理活動\n- 委託他人協助管理活動\n- 進入「我的活動管理」頁面\n\n感謝您對社群的貢獻！', time: '2026/02/20 14:00', unread: false, senderName: '管理員' },
    { id: 'm8', type: 'private', typeName: '私訊', title: '來自教練小陳的訊息', preview: '週六的友誼賽需要你幫忙守門...', body: '嗨！\n\n週六的友誼賽我們少一個守門員，聽說你之前有守門經驗，能不能來幫忙？\n\n時間：2026/03/08 14:00\n地點：大安運動中心\n\n如果可以的話回覆我一下，感謝！', time: '2026/02/19 20:15', unread: true, senderName: '教練小陳' },
    { id: 'm15', type: 'private', typeName: '私訊', title: '來自隊長A的訊息', preview: '歡迎加入雷霆隊！本週六有練球...', body: '歡迎加入雷霆隊！很高興有你加入我們。\n\n本週六下午 2 點在大安運動中心有固定練球，記得帶：\n- 白色球衣（隊服之後會統一訂）\n- 黑色短褲\n- 運動鞋和水\n\n有問題隨時問我，期待一起踢球！', time: '2026/02/01 10:30', unread: false, senderName: '隊長A' },
    // ── 球隊申請（含互動按鈕） ──
    { id: 'm9', type: 'system', typeName: '系統', title: '球隊加入申請', preview: '用戶「陳大明」申請加入「雷霆隊」...', body: '收到一筆新的球隊加入申請：\n\n申請人：陳大明（UID: user_chen）\n申請球隊：雷霆隊\n申請時間：2026/03/01 08:45\n\n申請留言：「我有 3 年踢球經驗，主要踢中場，希望能加入貴隊一起訓練！」\n\n請審核此申請。', time: '2026/03/01 08:45', unread: true, senderName: '系統', actionType: 'team_join_request', actionStatus: 'pending', meta: { teamId: 'tm1', teamName: '雷霆隊', applicantUid: 'user_chen', applicantName: '陳大明' } },
    { id: 'm12', type: 'system', typeName: '系統', title: '球隊申請通過', preview: '恭喜！您已成功加入「雷霆隊」...', body: '恭喜！您的球隊加入申請已通過。\n\n球隊名稱：雷霆隊\n審核結果：已同意\n\n歡迎成為團隊的一員！請聯繫隊長了解練球時間與注意事項。', time: '2026/02/12 17:20', unread: false, senderName: '系統' },
    // ── 用戶自己的球隊申請紀錄（用於「我的球隊申請」追蹤） ──
    { id: 'm18', type: 'system', typeName: '系統', title: '球隊加入申請', preview: '您申請加入「閃電隊」...', body: '您的球隊加入申請已送出。\n\n申請球隊：閃電隊\n申請時間：2026/02/08 10:30\n\n請等待隊長審核。', time: '2026/02/08 10:30', unread: false, senderName: '系統', actionType: 'team_join_request', actionStatus: 'approved', meta: { teamId: 'tm2', teamName: '閃電隊', applicantUid: 'demo-user', applicantName: '小麥' } },
    { id: 'm19', type: 'system', typeName: '系統', title: '球隊加入申請', preview: '您申請加入「火焰隊」...', body: '您的球隊加入申請已送出。\n\n申請球隊：火焰隊\n申請時間：2026/02/10 14:00\n\n請等待隊長審核。', time: '2026/02/10 14:00', unread: false, senderName: '系統', actionType: 'team_join_request', actionStatus: 'pending', meta: { teamId: 'tm4', teamName: '火焰隊', applicantUid: 'demo-user', applicantName: '小麥' } },
    { id: 'm20', type: 'system', typeName: '系統', title: '球隊加入申請', preview: '您申請加入「旋風隊」...', body: '您的球隊加入申請已送出。\n\n申請球隊：旋風隊\n申請時間：2026/01/20 09:00\n\n請等待隊長審核。', time: '2026/01/20 09:00', unread: false, senderName: '系統', actionType: 'team_join_request', actionStatus: 'rejected', meta: { teamId: 'tm3', teamName: '旋風隊', applicantUid: 'demo-user', applicantName: '小麥' } },
  ],

  achievements: [
    { id: 'a8', name: '冠軍', category: 'gold', badgeId: 'b8', completedAt: '2025/10/04', current: 1, status: 'active', condition: { timeRange: 'none', action: 'complete_event', filter: 'all', threshold: 1 } },
    { id: 'a7', name: '百場達人', category: 'gold', badgeId: 'b7', completedAt: null, current: 42, status: 'active', condition: { timeRange: 'none', action: 'complete_event', filter: 'all', threshold: 100 } },
    { id: 'a6', name: '活動策劃師', category: 'gold', badgeId: 'b6', completedAt: null, current: 2, status: 'active', condition: { timeRange: 'none', action: 'organize_event', filter: 'all', threshold: 10 } },
    { id: 'a5', name: '月活躍玩家', category: 'gold', badgeId: 'b5', completedAt: null, current: 3, status: 'active', condition: { timeRange: 'none', action: 'complete_event', filter: 'all', threshold: 5 } },
    { id: 'a2', name: '全勤之星', category: 'silver', badgeId: 'b2', completedAt: '2026/01/20', current: 90, status: 'active', condition: { timeRange: 'none', action: 'attendance_rate', filter: 'all', threshold: 90 } },
    { id: 'a3', name: '鐵人精神', category: 'silver', badgeId: 'b3', completedAt: '2026/02/05', current: 30, status: 'active', condition: { timeRange: 'none', action: 'complete_event', filter: 'all', threshold: 30 } },
    { id: 'a4', name: '社群達人', category: 'silver', badgeId: 'b4', completedAt: '2026/01/15', current: 1, status: 'active', condition: { timeRange: 'none', action: 'bind_line_notify', filter: 'all', threshold: 1 } },
    { id: 'a1', name: '初心者', category: 'bronze', badgeId: 'b1', completedAt: '2025/09/10', current: 1, status: 'active', condition: { timeRange: 'none', action: 'register_event', filter: 'all', threshold: 1 } },
  ],

  badges: [
    { id: 'b8', name: '冠軍徽章', achId: 'a8', category: 'gold', image: null },
    { id: 'b7', name: '百場徽章', achId: 'a7', category: 'gold', image: null },
    { id: 'b6', name: '策劃師徽章', achId: 'a6', category: 'gold', image: null },
    { id: 'b5', name: '月活躍徽章', achId: 'a5', category: 'gold', image: null },
    { id: 'b2', name: '全勤徽章', achId: 'a2', category: 'silver', image: null },
    { id: 'b3', name: '鐵人徽章', achId: 'a3', category: 'silver', image: null },
    { id: 'b4', name: '社群徽章', achId: 'a4', category: 'silver', image: null },
    { id: 'b1', name: '新手徽章', achId: 'a1', category: 'bronze', image: null },
  ],

  shopItems: [
    { id:'sh1', name:'Nike Phantom GT2', price:1800, condition:'9成新', year:2025, size:'US10', desc:'穿過約10次，鞋底磨損極少，適合草地場。附原廠鞋盒。', status:'on_sale', images:[] },
    { id:'sh2', name:'Adidas 訓練球衣', price:500, condition:'8成新', year:2024, size:'L', desc:'白色訓練球衣，透氣排汗材質，領口有輕微使用痕跡。', status:'on_sale', images:[] },
    { id:'sh3', name:'Puma 護脛', price:300, condition:'全新', year:2026, size:'M', desc:'全新未拆封，輕量化設計，附收納袋。', status:'on_sale', images:[] },
    { id:'sh4', name:'手套 (守門員)', price:600, condition:'7成新', year:2024, size:'L', desc:'Reusch 守門員手套，掌面乳膠仍有良好抓力，適合練習使用。', status:'on_sale', images:[] },
    { id:'sh5', name:'Joma 球褲', price:350, condition:'9成新', year:2025, size:'M', desc:'黑色短褲，彈性腰帶，側邊口袋。只穿過幾次比賽。', status:'on_sale', images:[] },
    { id:'sh6', name:'運動水壺 1L', price:150, condition:'全新', year:2026, size:'—', desc:'不鏽鋼保溫水壺，雙層真空，可保冷12小時。全新未使用。', status:'on_sale', images:[] },
  ],

  leaderboard: [
    { name: '王大明', avatar: '王', exp: 54000 },
    { name: '李小華', avatar: '李', exp: 47500 },
    { name: '張美玲', avatar: '張', exp: 41500 },
    { name: '陳志偉', avatar: '陳', exp: 35800 },
    { name: '小麥', avatar: '麥', exp: 33300 },
    { name: '林大豪', avatar: '林', exp: 25900 },
    { name: '黃小琳', avatar: '黃', exp: 21500 },
    { name: '周書翰', avatar: '周', exp: 17500 },
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
    { time: '03/01 14:32', target: '暱稱A', amount: '+500', reason: '活動獎勵', operator: '總管' },
    { time: '02/28 10:15', target: '暱稱B', amount: '-100', reason: '違規扣除', operator: '管理員B' },
    { time: '02/25 09:00', target: '暱稱C', amount: '+200', reason: '賽事MVP', operator: '總管' },
  ],

  teamExpLogs: [
    { time: '03/02 10:00', target: '雷霆隊', targetId: 'tm1', amount: '+500', reason: '春季聯賽冠軍獎勵', operator: '總管' },
    { time: '02/27 15:30', target: '閃電隊', targetId: 'tm2', amount: '+300', reason: '友誼賽表現優異', operator: '總管' },
    { time: '02/20 09:45', target: '火焰隊', targetId: 'tm4', amount: '-200', reason: '違規處罰', operator: '管理員B' },
  ],

  operationLogs: [
    { time: '03/15 14:32', operator: '總管', type: 'exp', typeName: '手動EXP', content: '暱稱A +500「活動獎勵」' },
    { time: '03/15 10:15', operator: '管理員B', type: 'role', typeName: '角色變更', content: '暱稱C → 教練' },
    { time: '03/14 18:00', operator: '教練小陳', type: 'event_create', typeName: '建立活動', content: '建立「週六足球友誼賽」' },
    { time: '03/14 16:30', operator: '教練小陳', type: 'event_edit', typeName: '編輯活動', content: '編輯「週三足球基礎練習」' },
    { time: '03/14 12:00', operator: '總管', type: 'tourn_create', typeName: '建立賽事', content: '建立「春季盃」' },
    { time: '03/13 20:00', operator: '總管', type: 'tourn_approve', typeName: '賽事審批', content: '同意「雷霆隊」報名「春季盃」' },
    { time: '03/13 17:30', operator: '總管', type: 'team_position', typeName: '球隊職位變更', content: '「黑熊隊」領隊由「暱稱A」轉移至「隊長K」' },
    { time: '03/13 17:00', operator: '總管', type: 'team_position', typeName: '球隊職位變更', content: '新增「教練L」為「黑熊隊」教練' },
    { time: '03/13 15:00', operator: '總管', type: 'team_create', typeName: '建立球隊', content: '建立「黑熊隊」' },
    { time: '03/13 15:00', operator: '總管', type: 'team_position', typeName: '球隊職位變更', content: '設定「暱稱A」為「黑熊隊」領隊' },
    { time: '03/13 09:30', operator: '總管', type: 'role', typeName: '角色變更', content: '暱稱B → 管理員' },
    { time: '03/12 14:00', operator: '總管', type: 'exp', typeName: '手動EXP', content: '暱稱D +1000「賽事冠軍」' },
    { time: '03/12 11:00', operator: '總管', type: 'team_exp', typeName: '球隊積分', content: '雷霆隊 +200「聯賽獎勵」' },
    { time: '03/12 09:00', operator: '總管', type: 'team_position', typeName: '球隊職位變更', content: '移除「教練M」的「閃電隊」教練職位' },
    { time: '03/11 16:45', operator: '場主老王', type: 'event_end', typeName: '結束活動', content: '結束「五人制室內足球」' },
    { time: '03/11 10:00', operator: '總管', type: 'ach_create', typeName: '建立成就', content: '建立「全勤獎」' },
    { time: '03/10 14:30', operator: '總管', type: 'ann_create', typeName: '建立公告', content: '發布「系統維護通知」' },
    { time: '03/10 09:00', operator: '總管', type: 'team_edit', typeName: '編輯球隊', content: '編輯「閃電隊」' },
    { time: '03/09 17:00', operator: '教練小陳', type: 'event_cancel', typeName: '取消活動', content: '取消「雨天備案練習」' },
    { time: '03/09 11:30', operator: '總管', type: 'tourn_edit', typeName: '編輯賽事', content: '編輯「春季盃」' },
    { time: '03/08 15:00', operator: '總管', type: 'ann_toggle', typeName: '公告上下架', content: '下架「舊公告」' },
    { time: '03/08 10:00', operator: '總管', type: 'ach_toggle', typeName: '成就上下架', content: '下架「測試成就」' },
    { time: '03/07 14:00', operator: '隊長A', type: 'team_position', typeName: '球隊職位變更', content: '新增「教練B」為「雷霆隊」教練' },
    { time: '03/07 14:00', operator: '隊長A', type: 'team_position', typeName: '球隊職位變更', content: '新增「教練C」為「雷霆隊」教練' },
    { time: '03/06 09:00', operator: '總管', type: 'event_create', typeName: '建立活動', content: '建立「冬季足球體能活動」' },
    { time: '03/05 16:00', operator: '總管', type: 'team_exp', typeName: '球隊積分', content: '火焰隊 -200「違規處罰」' },
    { time: '03/04 10:00', operator: '總管', type: 'role', typeName: '角色變更', content: '李大華 自動晉升為「教練」（原：一般用戶）' },
    { time: '03/03 09:00', operator: '總管', type: 'ach_edit', typeName: '編輯成就', content: '編輯「百場達人」門檻改為100場' },
  ],

  adminUsers: [
    { name: '王小明', uid: 'U1a2b3c', role: 'user', region: '台北', exp: 5800, gender: '男', birthday: '2000/05/20', sports: '足球', teamId: 'tm1', teamName: '雷霆隊', pictureUrl: null, phone: '0911-111-111', lastActive: '2026/02/10', joinDate: '2025/08/15' },
    { name: '李大華', uid: 'U4d5e6f', role: 'coach', region: '台中', exp: 25900, gender: '男', birthday: '1988/11/03', sports: '足球、籃球', teamId: 'tm2', teamName: '閃電隊', pictureUrl: null, phone: '0922-222-222', lastActive: '2026/02/09', joinDate: '2025/06/20' },
    { name: '張美玲', uid: 'U7g8h9i', role: 'captain', region: '台北', exp: 41500, gender: '女', birthday: '1992/07/14', sports: '排球、羽球', teamId: 'tm3', teamName: '旋風隊', pictureUrl: null, phone: '0933-333-333', lastActive: '2026/02/08', joinDate: '2025/05/10' },
    { name: '陳志偉', uid: 'Uj1k2l3', role: 'venue_owner', region: '高雄', exp: 12400, gender: '男', birthday: '1985/01/28', sports: '足球', teamId: null, teamName: null, pictureUrl: null, phone: '0944-444-444', lastActive: '2026/01/15', joinDate: '2025/07/01' },
    { name: '周書翰', uid: 'Um4n5o6', role: 'user', region: '台北', exp: 1700, gender: '男', birthday: '2001/09/10', sports: '籃球', teamId: 'tm1', teamName: '雷霆隊', pictureUrl: null, phone: '0955-555-555', lastActive: '2026/02/07', joinDate: '2025/10/05' },
    { name: '林志偉', uid: 'Up7q8r9', role: 'user', region: '新北', exp: 17500, gender: '男', birthday: '1997/04/22', sports: '足球', teamId: 'tm4', teamName: '火焰隊', pictureUrl: null, phone: '0966-666-666', lastActive: '2026/02/06', joinDate: '2025/09/12' },
    { name: '黃小琳', uid: 'Us1t2u3', role: 'user', region: '高雄', exp: 21500, gender: '女', birthday: '1999/08/15', sports: '足球、排球', teamId: 'tm3', teamName: '旋風隊', pictureUrl: null, phone: '0977-777-777', lastActive: '2026/02/05', joinDate: '2025/08/20' },
    { name: '吳宗翰', uid: 'Uv4w5x6', role: 'coach', region: '桃園', exp: 33100, gender: '男', birthday: '1990/12/01', sports: '足球', teamId: 'tm6', teamName: '黑熊隊', pictureUrl: null, phone: '0988-888-888', lastActive: '2026/02/04', joinDate: '2025/04/15' },
    { name: '鄭家豪', uid: 'Uy7z8a1', role: 'user', region: '台中', exp: 700, gender: '男', birthday: '2003/06/30', sports: '籃球、網球', teamId: null, teamName: null, pictureUrl: null, phone: '0999-999-999', lastActive: '2025/11/20', joinDate: '2025/11/01' },
    { name: '許志安', uid: 'Ub2c3d4', role: 'user', region: '新北', exp: 3800, gender: '男', birthday: '1998/02/14', sports: '足球', teamId: 'tm5', teamName: '獵鷹隊', pictureUrl: null, phone: '0911-222-333', lastActive: '2025/12/10', joinDate: '2025/12/01' },
  ],

  customRoles: [],

  rolePermissions: {
    user: ['event.create', 'event.edit_own', 'event.delete_own', 'event.view_participants'],
    coach: ['event.create', 'event.edit_own', 'event.delete_own', 'event.edit_all', 'event.publish', 'event.scan_qr', 'event.manual_checkin', 'event.view_participants', 'team.manage_own', 'team.approve_join', 'team.create_team_event', 'team.toggle_event_public', 'tournament.input_score', 'tournament.input_cards'],
    captain: ['event.create', 'event.edit_own', 'event.delete_own', 'event.publish', 'event.scan_qr', 'event.manual_checkin', 'event.view_participants', 'team.create', 'team.manage_own', 'team.approve_join', 'team.assign_coach', 'team.create_team_event', 'team.toggle_event_public', 'tournament.create', 'tournament.edit_own', 'tournament.approve_team', 'message.send_private'],
    venue_owner: ['event.create', 'event.edit_own', 'event.delete_own', 'event.edit_all', 'event.publish', 'event.scan_qr', 'event.manual_checkin', 'event.view_participants', 'team.create', 'team.manage_own', 'tournament.create', 'tournament.edit_own', 'message.send_private'],
    admin: ['event.create', 'event.edit_own', 'event.delete_own', 'event.edit_all', 'event.delete_all', 'event.publish', 'event.scan_qr', 'event.manual_checkin', 'event.view_participants', 'team.create', 'team.manage_own', 'team.manage_all', 'team.approve_join', 'team.assign_coach', 'team.create_team_event', 'team.toggle_event_public', 'tournament.create', 'tournament.edit_own', 'tournament.edit_all', 'tournament.input_score', 'tournament.input_cards', 'tournament.manage_schedule', 'tournament.approve_team', 'tournament.manage_trade', 'user.view_all', 'user.edit_role', 'user.edit_profile', 'user.add_exp', 'user.promote_coach', 'user.promote_captain', 'user.promote_venue_owner', 'message.send_private', 'message.broadcast', 'message.recall', 'message.view_read_stats', 'system.manage_categories', 'system.manage_achievements'],
    super_admin: ['event.create', 'event.edit_own', 'event.delete_own', 'event.edit_all', 'event.delete_all', 'event.publish', 'event.scan_qr', 'event.manual_checkin', 'event.view_participants', 'team.create', 'team.manage_own', 'team.manage_all', 'team.approve_join', 'team.assign_coach', 'team.create_team_event', 'team.toggle_event_public', 'tournament.create', 'tournament.edit_own', 'tournament.edit_all', 'tournament.input_score', 'tournament.input_cards', 'tournament.manage_schedule', 'tournament.approve_team', 'tournament.manage_trade', 'tournament.set_scoring_rules', 'tournament.set_card_rules', 'user.view_all', 'user.edit_role', 'user.edit_profile', 'user.view_hidden', 'user.add_exp', 'user.promote_coach', 'user.promote_captain', 'user.promote_venue_owner', 'user.promote_admin', 'message.send_private', 'message.broadcast', 'message.schedule', 'message.recall', 'message.view_read_stats', 'system.manage_categories', 'system.manage_roles', 'system.manage_achievements', 'system.manage_exp_formula', 'system.manage_level_formula', 'system.assign_admin', 'system.override_trade_freeze', 'system.view_inactive_data'],
  },

  banners: [
    { id: 'ban1', slot: 1, title: '', image: null, status: 'empty', publishAt: null, unpublishAt: null, clicks: 0, gradient: '' },
    { id: 'ban2', slot: 2, title: '', image: null, status: 'empty', publishAt: null, unpublishAt: null, clicks: 0, gradient: '' },
    { id: 'ban3', slot: 3, title: '', image: null, status: 'empty', publishAt: null, unpublishAt: null, clicks: 0, gradient: '' },
  ],

  siteThemes: [
    { id:'sth1', slot:'theme_topbar', label:'上方橫條背景', spec:'750 × 56 px', image:null, status:'empty' },
    { id:'sth2', slot:'theme_bottombar', label:'下方橫條背景', spec:'750 × 64 px', image:null, status:'empty' },
    { id:'sth3', slot:'theme_bg', label:'網站背景', spec:'750 × 1334 px', image:null, status:'empty' },
  ],

  announcements: [
    { id: 'ann1', title: '春季聯賽報名', content: '春季聯賽報名已開始，請至賽事中心查看詳情並完成報名手續。', status: 'active', sortOrder: 1, publishAt: '2026/03/01 10:00', unpublishAt: null, createdAt: '2026/03/01 09:00', createdBy: '總管', operatorName: '總管' },
    { id: 'ann2', title: '系統維護通知', content: '本週六凌晨 02:00~04:00 將進行系統維護，届時暫停服務。', status: 'active', sortOrder: 2, publishAt: '2026/03/10 08:00', unpublishAt: '2026/03/22 08:00', createdAt: '2026/03/08 14:00', createdBy: '總管', operatorName: '總管' },
    { id: 'ann3', title: '二手商城上線', content: '二手商品區已正式上線，歡迎上架閒置球具！', status: 'expired', sortOrder: 3, publishAt: '2026/02/01 10:00', unpublishAt: '2026/02/28 23:59', createdAt: '2026/01/30 10:00', createdBy: '管理員', operatorName: '管理員B' },
  ],

  floatingAds: [
    { id: 'fad1', slot: 'AD1', title: '', image: null, status: 'empty', publishAt: null, unpublishAt: null, clicks: 0 },
    { id: 'fad2', slot: 'AD2', title: '', image: null, status: 'empty', publishAt: null, unpublishAt: null, clicks: 0 },
  ],

  popupAds: [
    { id: 'pad1', layer: 1, title: '', image: null, status: 'empty', publishAt: null, unpublishAt: null, clicks: 0, linkUrl: '' },
    { id: 'pad2', layer: 2, title: '', image: null, status: 'empty', publishAt: null, unpublishAt: null, clicks: 0, linkUrl: '' },
    { id: 'pad3', layer: 3, title: '', image: null, status: 'empty', publishAt: null, unpublishAt: null, clicks: 0, linkUrl: '' },
  ],

  sponsors: [
    { id: 'sp1', slot: 1, title: '', image: null, status: 'empty', linkUrl: '', publishAt: null, unpublishAt: null, clicks: 0 },
    { id: 'sp2', slot: 2, title: '', image: null, status: 'empty', linkUrl: '', publishAt: null, unpublishAt: null, clicks: 0 },
    { id: 'sp3', slot: 3, title: '', image: null, status: 'empty', linkUrl: '', publishAt: null, unpublishAt: null, clicks: 0 },
    { id: 'sp4', slot: 4, title: '', image: null, status: 'empty', linkUrl: '', publishAt: null, unpublishAt: null, clicks: 0 },
    { id: 'sp5', slot: 5, title: '', image: null, status: 'empty', linkUrl: '', publishAt: null, unpublishAt: null, clicks: 0 },
    { id: 'sp6', slot: 6, title: '', image: null, status: 'empty', linkUrl: '', publishAt: null, unpublishAt: null, clicks: 0 },
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

  adminMessages: [
    { id:'mg1', title:'春季聯賽報名開始', target:'全體用戶', targetUid:null, targetName:null, senderName:'系統', readRate:'72%', time:'2026/03/01 10:00', status:'sent', body:'2026 春季足球聯賽現已開放報名，請至賽事中心查看詳情。' },
    { id:'mg2', title:'系統維護通知', target:'全體用戶', targetUid:null, targetName:null, senderName:'系統', readRate:'85%', time:'2026/02/18 11:00', status:'sent', body:'本週六凌晨將進行系統更新，預計停機2小時。' },
    { id:'mg3', title:'球隊集訓通知', target:'指定球隊', targetUid:null, targetName:null, senderName:'張美玲', readRate:'90%', time:'2026/02/15 09:00', status:'sent', body:'本週六下午2點集合於大安運動中心進行球隊集訓。' },
    { id:'mg4', title:'新春盃報名提醒', target:'全體用戶', targetUid:null, targetName:null, senderName:'系統', readRate:'-', time:'2026/03/20 08:00', status:'scheduled', scheduledAt:'2026-03-20T08:00', body:'新春盃淘汰賽即將截止報名，請把握機會。' },
    { id:'mg5', title:'教練升級通知', target:'李大華', targetUid:'U4d5e6f', targetName:'李大華', senderName:'系統', readRate:'-', time:'2026/01/10 14:00', status:'recalled', body:'您的角色已升級為教練，請確認新權限。' },
  ],

  notifTemplates: [
    { key: 'welcome', title: '歡迎加入 SportHub！', body: '嗨 {userName}，歡迎加入 SportHub 平台！\n\n您可以在這裡瀏覽並報名各類足球活動、加入球隊、參與聯賽。\n祝您使用愉快！' },
    { key: 'signup_success', title: '報名成功通知', body: '您已成功報名以下活動：\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n報名狀態：{status}\n\n請準時出席，如需取消請提前至活動頁面操作。' },
    { key: 'waitlist_promoted', title: '候補遞補通知', body: '恭喜！由於有人取消報名，您已從候補名單自動遞補為正式參加者。\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n\n請準時出席！' },
    { key: 'event_cancelled', title: '活動取消通知', body: '很抱歉通知您，以下活動因故取消：\n\n活動名稱：{eventName}\n原定時間：{date}\n原定地點：{location}\n\n如您已繳費，費用將於 3 個工作天內退還。造成不便深感抱歉。' },
    { key: 'role_upgrade', title: '身份變更通知', body: '恭喜 {userName}！您的身份已變更為「{roleName}」。\n\n新身份可能帶來新的權限與功能，請至個人資料頁面查看詳情。\n感謝您對社群的貢獻！' },
    { key: 'event_changed', title: '活動變更通知', body: '您報名的活動資訊有所變更，請留意：\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n\n如因變更需要取消報名，請至活動頁面操作。' },
  ],

  attendanceRecords: [
    { id:'att_d1', eventId:'e0b', uid:'U1a2b3c', userName:'王小明', type:'checkin', time:'2026/02/22 13:55' },
    { id:'att_d2', eventId:'e0b', uid:'U1a2b3c', userName:'王小明', type:'checkout', time:'2026/02/22 16:05' },
    { id:'att_d3', eventId:'e0b', uid:'U4d5e6f', userName:'李大華', type:'checkin', time:'2026/02/22 14:02' },
  ],

  activityRecords: [
    // 報名中（未結束活動）
    { eventId: 'e4', name: '週六足球友誼賽', date: '03/15', status: 'registered', uid: 'demo-user' },
    { eventId: 'e6', name: '足球體能PLAY', date: '03/20', status: 'registered', uid: 'demo-user' },
    { eventId: 'e7', name: '週六11人制友誼賽', date: '03/22', status: 'registered', uid: 'demo-user' },
    { eventId: 'eh1', name: '週三足球基礎練習', date: '02/11', status: 'registered', uid: 'demo-user' },
    { eventId: 'eh3', name: '週六足球友誼賽', date: '02/14', status: 'registered', uid: 'demo-user' },
    // 已完成
    { eventId: 'e3', name: '五人制室內足球', date: '03/08', status: 'completed', uid: 'demo-user' },
    { eventId: 'e2', name: '守門員專項教學', date: '03/05', status: 'completed', uid: 'demo-user' },
    { eventId: 'e1', name: '春季PLAY第三輪', date: '03/01', status: 'completed', uid: 'demo-user' },
    { eventId: 'e0b', name: '週六足球友誼賽', date: '02/22', status: 'completed', uid: 'demo-user' },
    { eventId: 'e0a', name: '冬季足球體能活動', date: '02/22', status: 'completed', uid: 'demo-user' },
    // 更早的完成紀錄（用於分頁展示）
    { eventId: 'hist01', name: '年度足球嘉年華', date: '01/28', status: 'completed', uid: 'demo-user' },
    { eventId: 'hist02', name: '五人制室內足球', date: '01/18', status: 'completed', uid: 'demo-user' },
    { eventId: 'hist03', name: '守門員基礎訓練', date: '01/12', status: 'completed', uid: 'demo-user' },
    { eventId: 'hist04', name: '週六足球友誼賽', date: '01/04', status: 'completed', uid: 'demo-user' },
    { eventId: 'hist05', name: '秋季PLAY決賽', date: '12/21', status: 'completed', uid: 'demo-user' },
    { eventId: 'hist06', name: '足球戰術研習', date: '12/14', status: 'completed', uid: 'demo-user' },
    { eventId: 'hist07', name: '守門員撲救教學', date: '12/07', status: 'completed', uid: 'demo-user' },
    { eventId: 'hist08', name: '週六足球友誼賽', date: '11/30', status: 'completed', uid: 'demo-user' },
    { eventId: 'hist09', name: '秋季PLAY第六輪', date: '11/22', status: 'completed', uid: 'demo-user' },
    { eventId: 'hist10', name: '五人制足球聯誼', date: '11/15', status: 'completed', uid: 'demo-user' },
    { eventId: 'hist11', name: '新手足球教學', date: '11/08', status: 'completed', uid: 'demo-user' },
    { eventId: 'hist12', name: '秋季PLAY第五輪', date: '11/01', status: 'completed', uid: 'demo-user' },
    { eventId: 'hist13', name: '週六足球友誼賽', date: '10/25', status: 'completed', uid: 'demo-user' },
    { eventId: 'hist14', name: '足球體能訓練', date: '10/18', status: 'completed', uid: 'demo-user' },
    { eventId: 'hist15', name: '秋季PLAY第四輪', date: '10/11', status: 'completed', uid: 'demo-user' },
    { eventId: 'hist16', name: '守門員專項教學', date: '10/04', status: 'completed', uid: 'demo-user' },
    { eventId: 'hist17', name: '秋季PLAY第三輪', date: '09/27', status: 'completed', uid: 'demo-user' },
    { eventId: 'hist18', name: '週六足球友誼賽', date: '09/20', status: 'completed', uid: 'demo-user' },
    { eventId: 'hist19', name: '秋季PLAY第二輪', date: '09/13', status: 'completed', uid: 'demo-user' },
    { eventId: 'hist20', name: '秋季PLAY第一輪', date: '09/06', status: 'completed', uid: 'demo-user' },
    // 取消紀錄
    { eventId: 'e0c', name: '足球新手教學', date: '02/25', status: 'cancelled', uid: 'demo-user' },
    { eventId: 'e16', name: '五人制足球友誼賽', date: '04/20', status: 'cancelled', uid: 'demo-user' },
    { eventId: 'histc1', name: '歲末足球派對', date: '12/28', status: 'cancelled', uid: 'demo-user' },
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

// ── Pre-populate Auto EXP demo data（mode-aware keys）──
(function() {
  const mode = ModeManager.getMode();
  const rulesKey = 'sporthub_auto_exp_rules_' + mode;
  const logsKey  = 'sporthub_auto_exp_logs_' + mode;
  // 清除舊版無前綴 key（避免幽靈紀錄）
  localStorage.removeItem('sporthub_auto_exp_rules');
  localStorage.removeItem('sporthub_auto_exp_logs');
  if (localStorage.getItem(rulesKey)) return; // 已有設定則不覆蓋
  const rules = {
    complete_activity: 100,
    register_activity: 20,
    cancel_registration: -10,
    host_activity: 50,
    submit_review: 15,
    join_team: 30,
    post_team_feed: 5,
  };
  localStorage.setItem(rulesKey, JSON.stringify(rules));
  const logs = [
    { time:'2026/02/12 09:30', target:'小麥', key:'post_team_feed', amount:5, context:'昨天的友誼賽打得' },
    { time:'2026/02/11 20:15', target:'王小明', key:'submit_review', amount:15, context:'冬季足球體能活動' },
    { time:'2026/02/11 19:45', target:'黃小琳', key:'submit_review', amount:15, context:'冬季足球體能活動' },
    { time:'2026/02/11 14:02', target:'李大華', key:'complete_activity', amount:100, context:'週六足球友誼賽' },
    { time:'2026/02/11 14:00', target:'王小明', key:'complete_activity', amount:100, context:'週六足球友誼賽' },
    { time:'2026/02/10 10:30', target:'小麥', key:'register_activity', amount:20, context:'週三足球基礎練習' },
    { time:'2026/02/10 10:15', target:'張美玲', key:'register_activity', amount:20, context:'週六足球友誼賽' },
    { time:'2026/02/09 09:00', target:'教練小陳', key:'host_activity', amount:50, context:'週六足球友誼賽' },
    { time:'2026/02/08 15:00', target:'小麥', key:'join_team', amount:30, context:'雷霆隊' },
    { time:'2026/02/07 11:20', target:'鄭家豪', key:'cancel_registration', amount:-10, context:'守門員專項教學' },
  ];
  localStorage.setItem(logsKey, JSON.stringify(logs));
})();
