// A 正式站「真實程式碼＋示意資料」工具：在 A 訪客頁用 A 自己的 render 函式畫出需登入的畫面。
// 只改瀏覽器記憶體：略過登入檢查、換成示意俱樂部資料與示意使用者；訪客沒有 Firebase 寫入權限，且不點任何寫入按鈕。
export const DEMO = {
  captain: 'Udemo000000000000000000000000cap',
  leader: 'Udemo00000000000000000000000lead',
  coach: 'Udemo0000000000000000000000coach',
  member: 'Udemo000000000000000000000member',
  applicant: 'Udemo00000000000000000000applic',
};

// role: 'guest' | 'member' | 'captain' | 'outsider'
export async function setupA(p, { role = 'member', pickType = 'competitive', perms = [], joinState = null } = {}) {
  // A 的「有新版本可用」浮層（#sw-reload-deferred-prompt）會蓋住畫面下半部，整個藏起來（只影響本機瀏覽器顯示）
  await p.addStyleTag({ content: '#sw-reload-deferred-prompt{display:none!important}' });
  await p.evaluate(async ({ role, DEMO, pickType, perms, joinState }) => {
    await ScriptLoader.ensureForPage('page-team-detail');
    App._requireProtectedActionLogin = () => false;
    const teams = ApiService.getTeams();
    const t = teams.find((x) => x.active && (x.type === pickType)) || teams[0];
    const demoUsers = [
      { uid: DEMO.captain, _docId: DEMO.captain, name: '示意隊長', displayName: '示意隊長', role: 'captain', teamIds: [t.id], exp: 3200 },
      { uid: DEMO.leader, _docId: DEMO.leader, name: '示意領隊', displayName: '示意領隊', role: 'user', teamIds: [t.id], exp: 1500 },
      { uid: DEMO.coach, _docId: DEMO.coach, name: '示意教練', displayName: '示意教練', role: 'coach', teamIds: [t.id], exp: 2100 },
      { uid: DEMO.member, _docId: DEMO.member, name: '示意隊員甲', displayName: '示意隊員甲', role: 'user', teamIds: [t.id], exp: 800 },
      { uid: 'Udemo0000000000000000000000mem2', _docId: 'Udemo0000000000000000000000mem2', name: '示意隊員乙', displayName: '示意隊員乙', role: 'user', teamIds: [t.id], exp: 450 },
      { uid: 'Udemo0000000000000000000000mem3', _docId: 'Udemo0000000000000000000000mem3', name: '示意隊員丙', displayName: '示意隊員丙', role: 'user', teamIds: [t.id], exp: 120 },
    ];
    Object.assign(t, {
      name: '示意足球俱樂部', nameEn: 'Demo FC', region: '台北市', bio: '這是示意用的俱樂部簡介，每週六早上在河濱球場練習，歡迎新朋友加入。',
      captainUid: DEMO.captain, captain: '示意隊長', captainName: '示意隊長', creatorUid: DEMO.captain, ownerUid: DEMO.captain,
      leaderUids: [DEMO.leader], leaders: ['示意領隊'], leaderNames: ['示意領隊'],
      coachUids: [DEMO.coach], coaches: ['示意教練'], coachNames: ['示意教練'],
      members: demoUsers.length, teamExp: 3200, wins: 12, losses: 4, draws: 2, gamesPlayed: 18,
      image: '', contact: '', active: true,
    });
    window.__demoTeam = t;
    const me = role === 'guest' ? null
      : role === 'captain' ? demoUsers[0]
      : role === 'outsider' ? { uid: 'Udemo000000000000000000000outsd', _docId: 'Udemo000000000000000000000outsd', name: '示意訪客', displayName: '示意訪客', role: 'user', teamIds: [] }
      : demoUsers[3];
    ApiService.getAdminUsers = () => demoUsers;
    ApiService.getCurrentUser = () => me;
    App.hasPermission = (c) => perms.includes(c);
    App._hasRolePermission = (c) => perms.includes(c);
    if (joinState) App._getTeamJoinRequestState = () => joinState;
    window.__demoMe = me;
  }, { role, DEMO, pickType, perms, joinState });
}

export async function openDetailA(p, opts = {}) {
  await setupA(p, opts);
  await p.evaluate(async () => { await App.showTeamDetail(window.__demoTeam.id); });
  await p.waitForTimeout(2500);
}
