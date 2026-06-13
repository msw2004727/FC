/**
 * Tournament Competition Engine — unit tests
 *
 * 直接載入真實模組（js/modules/tournament/tournament-competition.js +
 * tournament-helpers.js 比分記錄權限），避免測試與實作漂移。
 * 涵蓋：賽制設定 sanitize、聯賽循環賽程、盃賽對戰表（輪空/季軍戰）、
 * 勝方判定（PK / 棄權 / 輪空）、晉級解析、積分榜（含 h2h tiebreak 與
 * 棄權判分）、射手榜/紅黃牌統計、比分記錄權限矩陣。
 */

const fs = require('fs');
const path = require('path');

function loadModule(relPath, globals) {
  const code = fs.readFileSync(path.resolve(__dirname, '..', '..', relPath), 'utf8');
  const fn = new Function(...Object.keys(globals), code);
  fn(...Object.values(globals));
}

function buildApp() {
  const App = {};
  const ApiService = {
    getCurrentUser: () => null,
    getTeams: () => [],
    getTeam: () => null,
    getRolePermissions: () => [],
    getAdminUsers: () => [],
  };
  loadModule('js/modules/tournament/tournament-competition.js', { App, ApiService });
  loadModule('js/modules/tournament/tournament-helpers.js', { App, ApiService });
  // helpers 依賴的 core 函式以最小 stub 提供
  App.isTournamentEnded = t => t?.ended === true;
  App._apiService = ApiService;
  return { App, ApiService };
}

describe('競賽設定 sanitize', () => {
  const { App } = buildApp();

  test('預設值', () => {
    const cfg = App._sanitizeTournamentCompetitionConfig();
    expect(cfg.pointsWin).toBe(3);
    expect(cfg.pointsDraw).toBe(1);
    expect(cfg.pointsLoss).toBe(0);
    expect(cfg.doubleRound).toBe(false);
    expect(cfg.matchRepeatCount).toBe(1);
    expect(cfg.thirdPlace).toBe(false);
    expect(cfg.walkoverWinScore).toBe(3);
    expect(cfg.walkoverLoseScore).toBe(0);
    expect(cfg.tiebreakers).toEqual(['gd', 'gf', 'h2h']);
    expect(cfg.yellowLimit).toBe(0);
    expect(cfg.maxRosterSize).toBe(0);
  });

  test('clamp 與非法 tiebreaker 過濾', () => {
    const cfg = App._sanitizeTournamentCompetitionConfig({
      pointsWin: 99, pointsDraw: -5, walkoverWinScore: 50,
      matchRepeatCount: 99,
      tiebreakers: ['gd', 'hack', 'h2h', 'gd'],
      yellowLimit: '5', maxRosterSize: 200,
    });
    expect(cfg.pointsWin).toBe(10);
    expect(cfg.pointsDraw).toBe(0);
    expect(cfg.walkoverWinScore).toBe(20);
    expect(cfg.matchRepeatCount).toBe(20);
    expect(cfg.tiebreakers).toEqual(['gd', 'h2h']);
    expect(cfg.yellowLimit).toBe(5);
    expect(cfg.maxRosterSize).toBe(99);
  });
});

describe('聯賽循環賽程', () => {
  const { App } = buildApp();

  test('4 隊單循環 6 場、互不重複、無自打', () => {
    const fx = App._generateLeagueFixtures(['a', 'b', 'c', 'd']);
    expect(fx).toHaveLength(6);
    const seen = new Set();
    fx.forEach(m => {
      expect(m.homeTeamId).not.toBe(m.awayTeamId);
      const key = [m.homeTeamId, m.awayTeamId].sort().join('-');
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    });
  });

  test('5 隊（奇數輪空）10 場', () => {
    expect(App._generateLeagueFixtures(['a', 'b', 'c', 'd', 'e'])).toHaveLength(10);
  });

  test('雙循環 12 場且主客對調', () => {
    const fx = App._generateLeagueFixtures(['a', 'b', 'c', 'd'], { doubleRound: true });
    expect(fx).toHaveLength(12);
    const first = fx.find(m => m.round === 1 && m.slot === 0);
    const mirror = fx.find(m => m.round === 4 && m.slot === 0);
    expect(mirror.homeTeamId).toBe(first.awayTeamId);
    expect(mirror.awayTeamId).toBe(first.homeTeamId);
  });

  test('matchRepeatCount creates multiple league games per pair', () => {
    const fx = App._generateLeagueFixtures(['a', 'b'], { matchRepeatCount: 3 });
    expect(fx).toHaveLength(3);
    expect(fx.map(m => m.seriesKey)).toEqual(['lr1m0', 'lr1m0', 'lr1m0']);
    expect(fx.map(m => m.seriesGame)).toEqual([1, 2, 3]);
    expect(fx.every(m => m.seriesTotal === 3)).toBe(true);
    expect(fx.map(m => `${m.homeTeamId}-${m.awayTeamId}`)).toEqual(['a-b', 'b-a', 'a-b']);
  });

  test('少於 2 隊回傳空', () => {
    expect(App._generateLeagueFixtures(['a'])).toEqual([]);
  });
});

describe('盃賽對戰表', () => {
  const { App } = buildApp();

  test('8 隊：7 場 + 季軍戰 = 8 場、無輪空', () => {
    const cup = App._generateCupBracket(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], { thirdPlace: true });
    expect(cup).toHaveLength(8);
    expect(cup.filter(m => m.status === 'bye')).toHaveLength(0);
    expect(cup.filter(m => m.stage === 'third')).toHaveLength(1);
  });

  test('6 隊：bracket 8、首輪 2 場輪空、來源鏈正確', () => {
    const cup = App._generateCupBracket(['a', 'b', 'c', 'd', 'e', 'f']);
    const r1 = cup.filter(m => m.round === 1);
    expect(r1).toHaveLength(4);
    expect(r1.filter(m => m.status === 'bye')).toHaveLength(2);
    const r2 = cup.filter(m => m.round === 2);
    expect(r2[0].homeSourceSlot).toBe('r1m0');
    expect(r2[0].awaySourceSlot).toBe('r1m1');
    const final = cup.find(m => m.round === 3);
    expect(final.homeSourceSlot).toBe('r2m0');
  });

  test('cup matchRepeatCount creates a series and resolves downstream winner after majority', () => {
    const cup = App._generateCupBracket(['a', 'b', 'c', 'd'], { matchRepeatCount: 3 });
    expect(cup.filter(m => m.seriesKey === 'r1m0')).toHaveLength(3);
    const matches = cup.map(m => ({ ...m }));
    matches.filter(m => m.seriesKey === 'r1m0').slice(0, 2).forEach(m => {
      m.status = 'finished';
      m.scoreHome = m.homeTeamId === 'a' ? 1 : 0;
      m.scoreAway = m.awayTeamId === 'a' ? 1 : 0;
    });
    const bySlot = App._buildTournamentMatchesBySlot(matches);
    expect(bySlot.r1m0.seriesMatches).toHaveLength(3);
    expect(App._getTournamentMatchWinnerTeamId(bySlot.r1m0, bySlot)).toBe('a');
    const final = matches.find(m => m.slotKey === 'r2m0');
    expect(App._resolveTournamentMatchSide(final, 'home', bySlot).teamId).toBe('a');
  });

  test('輪次標籤', () => {
    expect(App._getTournamentRoundLabel({ stage: 'cup', round: 1 }, 8)).toBe('8 強');
    expect(App._getTournamentRoundLabel({ stage: 'cup', round: 2 }, 8)).toBe('準決賽');
    expect(App._getTournamentRoundLabel({ stage: 'cup', round: 3 }, 8)).toBe('決賽');
    expect(App._getTournamentRoundLabel({ stage: 'third' })).toBe('季軍戰');
    expect(App._getTournamentRoundLabel({ stage: 'league', round: 3 })).toBe('第 3 輪');
  });
});

describe('勝方判定與晉級解析', () => {
  const { App } = buildApp();
  const M = data => App._buildTournamentMatchRecord(data);

  test('一般比分 / PK / 棄權 / 輪空', () => {
    expect(App._getTournamentMatchWinnerTeamId(M({ status: 'finished', homeTeamId: 'a', awayTeamId: 'b', scoreHome: 2, scoreAway: 1 }))).toBe('a');
    expect(App._getTournamentMatchWinnerTeamId(M({ status: 'finished', homeTeamId: 'a', awayTeamId: 'b', scoreHome: 1, scoreAway: 1, pkHome: 4, pkAway: 3 }))).toBe('a');
    expect(App._getTournamentMatchWinnerTeamId(M({ status: 'finished', homeTeamId: 'a', awayTeamId: 'b', scoreHome: 1, scoreAway: 1 }))).toBe('');
    expect(App._getTournamentMatchWinnerTeamId(M({ status: 'walkover', homeTeamId: 'a', awayTeamId: 'b', walkoverWinnerTeamId: 'b' }))).toBe('b');
    expect(App._getTournamentMatchWinnerTeamId(M({ status: 'bye', homeTeamId: 'a' }))).toBe('a');
  });

  test('第二輪由來源比賽勝方解析；季軍戰取準決賽敗方', () => {
    const semi1 = M({ slotKey: 'r2m0', status: 'finished', homeTeamId: 'a', awayTeamId: 'b', scoreHome: 3, scoreAway: 0 });
    const semi2 = M({ slotKey: 'r2m1', status: 'finished', homeTeamId: 'c', awayTeamId: 'd', scoreHome: 0, scoreAway: 1 });
    const final = M({ slotKey: 'r3m0', homeSourceSlot: 'r2m0', awaySourceSlot: 'r2m1' });
    const third = M({ slotKey: 'third', homeSourceSlot: 'r2m0', awaySourceSlot: 'r2m1', sourceType: 'loser' });
    const bySlot = { 'r2m0': semi1, 'r2m1': semi2 };
    expect(App._resolveTournamentMatchSide(final, 'home', bySlot).teamId).toBe('a');
    expect(App._resolveTournamentMatchSide(final, 'away', bySlot).teamId).toBe('d');
    expect(App._resolveTournamentMatchSide(third, 'home', bySlot).teamId).toBe('b');
    expect(App._resolveTournamentMatchSide(third, 'away', bySlot).teamId).toBe('c');
  });

  test('來源未完賽 → pending', () => {
    const semi = M({ slotKey: 'r2m0', status: 'scheduled', homeTeamId: 'a', awayTeamId: 'b' });
    const final = M({ slotKey: 'r3m0', homeSourceSlot: 'r2m0' });
    const side = App._resolveTournamentMatchSide(final, 'home', { 'r2m0': semi });
    expect(side.pending).toBe(true);
    expect(side.teamId).toBe('');
  });
});

describe('聯賽積分榜（即時推導）', () => {
  const { App } = buildApp();
  const cfg = App._sanitizeTournamentCompetitionConfig();

  test('積分 / 淨勝球排序與未賽隊伍列入', () => {
    const matches = [
      { stage: 'league', status: 'finished', homeTeamId: 'a', awayTeamId: 'b', scoreHome: 3, scoreAway: 0 },
      { stage: 'league', status: 'finished', homeTeamId: 'c', awayTeamId: 'b', scoreHome: 1, scoreAway: 0 },
    ];
    const rows = App._computeLeagueStandings(matches, { config: cfg, teamIds: ['a', 'b', 'c', 'd'], nameById: { a: 'A', b: 'B', c: 'C', d: 'D' } });
    expect(rows.map(r => r.teamId)).toEqual(['a', 'c', 'd', 'b']);
    expect(rows[0].points).toBe(3);
    expect(rows[0].gd).toBe(3);
    expect(rows[2].played).toBe(0);
    expect(rows[3].loss).toBe(2);
    expect(rows[0].rank).toBe(1);
  });

  test('平手時 h2h 對戰成績優先（tiebreakers=h2h）', () => {
    const h2hCfg = App._sanitizeTournamentCompetitionConfig({ tiebreakers: ['h2h', 'gd', 'gf'] });
    // a 與 b 同 6 分（兩隊平手群）；a 對 b 直接對戰獲勝、但 b 總淨勝球較佳
    const matches = [
      { stage: 'league', status: 'finished', homeTeamId: 'a', awayTeamId: 'b', scoreHome: 1, scoreAway: 0 },
      { stage: 'league', status: 'finished', homeTeamId: 'b', awayTeamId: 'c', scoreHome: 9, scoreAway: 0 },
      { stage: 'league', status: 'finished', homeTeamId: 'c', awayTeamId: 'a', scoreHome: 1, scoreAway: 0 },
      { stage: 'league', status: 'finished', homeTeamId: 'a', awayTeamId: 'd', scoreHome: 1, scoreAway: 0 },
      { stage: 'league', status: 'finished', homeTeamId: 'b', awayTeamId: 'd', scoreHome: 1, scoreAway: 0 },
      { stage: 'league', status: 'finished', homeTeamId: 'd', awayTeamId: 'c', scoreHome: 1, scoreAway: 0 },
    ];
    const rows = App._computeLeagueStandings(matches, { config: h2hCfg, teamIds: ['a', 'b', 'c', 'd'] });
    expect(rows[0].teamId).toBe('a'); // h2h 勝 b
    expect(rows[1].teamId).toBe('b');
    // 對照：gd 優先時 b 在前
    const gdRows = App._computeLeagueStandings(matches, { config: cfg, teamIds: ['a', 'b', 'c', 'd'] });
    expect(gdRows[0].teamId).toBe('b');
    expect(gdRows[1].teamId).toBe('a');
  });

  test('棄權判 3:0 計入積分與得失球、可調比分', () => {
    const matches = [
      { stage: 'league', status: 'walkover', homeTeamId: 'a', awayTeamId: 'b', walkoverWinnerTeamId: 'a' },
    ];
    const rows = App._computeLeagueStandings(matches, { config: cfg, teamIds: ['a', 'b'] });
    expect(rows[0].gf).toBe(3);
    expect(rows[0].points).toBe(3);
    expect(rows[1].walkovers).toBe(1);
    const custom = App._sanitizeTournamentCompetitionConfig({ walkoverWinScore: 5, walkoverLoseScore: 1 });
    const rows2 = App._computeLeagueStandings(matches, { config: custom, teamIds: ['a', 'b'] });
    expect(rows2[0].gf).toBe(5);
    expect(rows2[0].ga).toBe(1);
  });

  test('未指定棄權方的 walkover 不計', () => {
    const rows = App._computeLeagueStandings([
      { stage: 'league', status: 'walkover', homeTeamId: 'a', awayTeamId: 'b', walkoverWinnerTeamId: '' },
    ], { config: cfg, teamIds: ['a', 'b'] });
    expect(rows[0].played).toBe(0);
  });
});

describe('射手榜與紅黃牌', () => {
  const { App } = buildApp();

  test('進球累計排序；烏龍球不計射手；棄權場次事件不計', () => {
    const matches = [
      { status: 'finished', events: [
        { type: 'goal', teamId: 't1', uid: 'u1', name: '甲' },
        { type: 'goal', teamId: 't1', uid: 'u1', name: '甲' },
        { type: 'goal', teamId: 't2', uid: 'u2', name: '乙' },
        { type: 'own_goal', teamId: 't2', uid: 'u3', name: '丙' },
        { type: 'yellow', teamId: 't2', uid: 'u2', name: '乙' },
        { type: 'red', teamId: 't1', uid: 'u1', name: '甲' },
      ] },
      { status: 'walkover', events: [{ type: 'goal', teamId: 't1', uid: 'u9', name: '幽靈' }] },
    ];
    const { scorers, cards } = App._computeTournamentScorerStats(matches);
    expect(scorers).toHaveLength(2);
    expect(scorers[0]).toMatchObject({ uid: 'u1', goals: 2 });
    expect(scorers.find(s => s.uid === 'u9')).toBeUndefined();
    expect(scorers.find(s => s.uid === 'u3')).toBeUndefined();
    expect(cards.find(c => c.uid === 'u2').yellow).toBe(1);
    expect(cards.find(c => c.uid === 'u1').red).toBe(1);
  });
});

describe('比分記錄權限 _canRecordTournamentMatch', () => {
  const tournament = {
    id: 'ct_1', mode: 'league', creatorUid: 'creator',
    refereeHeadUid: 'head', refereeUids: ['ref1', 'ref2'],
    delegateUids: [], ended: false,
  };
  const buildAppWithUser = user => {
    const { App, ApiService } = buildApp();
    ApiService.getCurrentUser = () => user;
    return App;
  };

  test('主辦可記錄；裁判長可記錄全部場次', () => {
    const creatorApp = buildAppWithUser({ uid: 'creator', role: 'user' });
    expect(creatorApp._canRecordTournamentMatch(tournament, { status: 'scheduled', refereeUids: [] })).toBe(true);
    const headApp = buildAppWithUser({ uid: 'head', role: 'user' });
    expect(headApp._canRecordTournamentMatch(tournament, { status: 'scheduled', refereeUids: ['ref1'] })).toBe(true);
  });

  test('裁判僅能記錄被指派場次；未指派場次開放全部裁判', () => {
    const refApp = buildAppWithUser({ uid: 'ref1', role: 'user' });
    expect(refApp._canRecordTournamentMatch(tournament, { status: 'scheduled', refereeUids: ['ref1'] })).toBe(true);
    expect(refApp._canRecordTournamentMatch(tournament, { status: 'scheduled', refereeUids: ['ref2'] })).toBe(false);
    expect(refApp._canRecordTournamentMatch(tournament, { status: 'scheduled', refereeUids: [] })).toBe(true);
  });

  test('一般用戶不可記錄；輪空場次不可記錄；賽事結束後裁判鎖定但主辦可更正', () => {
    const userApp = buildAppWithUser({ uid: 'someone', role: 'user' });
    expect(userApp._canRecordTournamentMatch(tournament, { status: 'scheduled', refereeUids: [] })).toBe(false);
    const headApp = buildAppWithUser({ uid: 'head', role: 'user' });
    expect(headApp._canRecordTournamentMatch(tournament, { status: 'bye' })).toBe(false);
    const endedTournament = { ...tournament, ended: true };
    expect(headApp._canRecordTournamentMatch(endedTournament, { status: 'finished', refereeUids: [] })).toBe(false);
    const creatorApp = buildAppWithUser({ uid: 'creator', role: 'user' });
    expect(creatorApp._canRecordTournamentMatch(endedTournament, { status: 'finished', refereeUids: [] })).toBe(true);
  });
});

describe('比賽記錄資料形狀', () => {
  const { App } = buildApp();

  test('_buildTournamentMatchRecord 正規化', () => {
    const m = App._buildTournamentMatchRecord({
      id: 'cm_1', stage: 'hack', round: '2', scoreHome: '3', scoreAway: null,
      seriesKey: 'r1m0', seriesGame: '2', seriesTotal: '3',
      events: [{ type: 'goal', teamId: 't1', minute: '15.7' }, { type: 'bad', teamId: 't1' }, { type: 'goal' }],
      refereeUids: ['u1', '', null],
      status: 'weird',
    });
    expect(m.stage).toBe('league');
    expect(m.round).toBe(2);
    expect(m.status).toBe('scheduled');
    expect(m.scoreHome).toBe(3);
    expect(m.scoreAway).toBeNull();
    expect(m.seriesKey).toBe('r1m0');
    expect(m.seriesGame).toBe(2);
    expect(m.seriesTotal).toBe(3);
    expect(m.events).toHaveLength(1);
    expect(m.events[0].minute).toBe(15);
    expect(m.refereeUids).toEqual(['u1']);
  });
});
