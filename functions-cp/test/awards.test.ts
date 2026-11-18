/**
 * 個人獎項｜T15
 * 對應 docs/02 §8.2
 */
import { computeScorers, computeGoalkeepers, computeFairPlayBoard, countedMatchIdsOf } from '../src/engine/awards.js';
import { goal, mkAll } from './_helpers.js';

describe('T15 射手榜', () => {
  const events = [
    goal('m1', 'A', 'p1'),                          // 一般進球
    goal('m1', 'A', 'p1'),
    goal('m1', 'A', 'p2', 'penalty_scored'),        // PK 進球：計入
    goal('m1', 'B', 'p9', 'own_goal'),              // 烏龍球：不計入
    goal('m2', 'A', 'p2'),
    goal('m2', 'B', 'p3', 'penalty_missed'),        // PK 失手：不計入
    goal('m2', 'A', 'p1', 'goal', { voided: true }) // 作廢：不計入
  ];

  test('⭐ 烏龍球不計入射手（type 與 goalType 兩種寫法都要擋）', () => {
    const rows = computeScorers(events);
    expect(rows.find(r => r.playerId === 'p9')).toBeUndefined();

    // 01b §1.8 的 goalType 列舉裡也有 'own'，schema 允許這種寫法
    const alt = computeScorers([
      { matchId: 'm1', type: 'goal', goalType: 'own', playerId: 'p9', teamId: 'B' }
    ]);
    expect(alt).toEqual([]);
  });

  test('⭐ PK 大戰的罰球不計入個人進球（docs/03 §9.2）', () => {
    // 這跟上面那條不衝突，是兩件事：
    //   比賽進行中的罰球（periodId h1/h2/et）→ 計入
    //   PK 大戰（periodId 'pk'）→ 不計入，國際慣例
    // 兩者在 timeline 上是同一個 type，只差期別。少了這道判斷，
    // 一場 5:4 的 PK 大戰會讓九個人的射手榜各憑空多一球。
    const rows = computeScorers([
      goal('m1', 'A', 'p1', 'goal', { periodId: 'h2' }),
      goal('m1', 'A', 'p1', 'penalty_scored', { periodId: 'h2' }),   // 場中罰球：計入
      goal('m1', 'A', 'p1', 'penalty_scored', { periodId: 'pk' }),   // PK 大戰：不計入
      goal('m1', 'B', 'p2', 'penalty_scored', { periodId: 'pk' })
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].playerId).toBe('p1');
    expect(rows[0].goals).toBe(2);
    expect(rows[0].penalties).toBe(1);
  });

  test('⭐ PK 進球計入射手，PK 失手不計入', () => {
    const rows = computeScorers(events);
    const p2 = rows.find(r => r.playerId === 'p2');
    expect(p2.goals).toBe(2);
    expect(p2.penalties).toBe(1);
    expect(p2.openPlay).toBe(1);
    expect(rows.find(r => r.playerId === 'p3')).toBeUndefined();
  });

  test('作廢的進球不計入', () => {
    expect(computeScorers(events).find(r => r.playerId === 'p1').goals).toBe(2);
  });

  test('同分時出賽場次少者優先', () => {
    const rows = computeScorers(
      [goal('m1', 'A', 'px'), goal('m2', 'A', 'px'), goal('m1', 'A', 'py'), goal('m1', 'A', 'py')],
      { appearances: { px: { matches: 4 }, py: { matches: 2 } } }
    );
    expect(rows.map(r => r.playerId)).toEqual(['py', 'px']);
    expect(rows.map(r => r.rank)).toEqual([1, 2]);
  });

  test('完全同分時並列同名次', () => {
    const rows = computeScorers(
      [goal('m1', 'A', 'px'), goal('m1', 'A', 'py'), goal('m1', 'A', 'pz')],
      { appearances: { px: { matches: 1 }, py: { matches: 1 }, pz: { matches: 1 } } }
    );
    expect(rows.map(r => r.rank)).toEqual([1, 1, 1]);
  });

  test('只統計已完賽的場次', () => {
    const matches = mkAll([['m1', 'A', 'B', 1, 0]])
      .concat([{ matchId: 'm2', status: 'live' }]);
    const counted = countedMatchIdsOf(matches);
    expect([...counted]).toEqual(['m1']);
    const rows = computeScorers(events, { countedMatchIds: counted });
    expect(rows.find(r => r.playerId === 'p2').goals).toBe(1);   // m2 那顆不算
  });

  test('帶入球員資料供公開端顯示', () => {
    const rows = computeScorers(events, {
      playerMeta: { p1: { name: '王小明', teamName: '臺中野狼', jerseyNo: 7 } }
    });
    const p1 = rows.find(r => r.playerId === 'p1');
    expect(p1.name).toBe('王小明');
    expect(p1.jerseyNo).toBe(7);
  });
});

describe('門將榜（半自動）', () => {
  const apps = [
    { playerId: 'gk1', teamId: 'A', matchId: 'm1', minutes: 30 },
    { playerId: 'gk1', teamId: 'A', matchId: 'm2', minutes: 30 },
    { playerId: 'gk2', teamId: 'B', matchId: 'm1', minutes: 30 },
    { playerId: 'gk2', teamId: 'B', matchId: 'm2', minutes: 30 },
    { playerId: 'gk3', teamId: 'C', matchId: 'm1', minutes: 30 }   // 只上 1 場
  ];
  const conceded = {
    m1__A: { goalsAgainst: 0 }, m2__A: { goalsAgainst: 2 },
    m1__B: { goalsAgainst: 1 }, m2__B: { goalsAgainst: 0 },
    m1__C: { goalsAgainst: 0 }
  };

  test('依場均失球排序，並列時比零失球場次', () => {
    const rows = computeGoalkeepers(apps, conceded);
    expect(rows.map(r => r.playerId)).toEqual(['gk2', 'gk1']);
    expect(rows[0].goalsAgainstPerMatch).toBe(0.5);
    expect(rows[0].cleanSheets).toBe(1);
  });

  test('出賽未達門檻者不列入（避免只守一場就奪獎）', () => {
    expect(computeGoalkeepers(apps, conceded).find(r => r.playerId === 'gk3')).toBeUndefined();
    expect(computeGoalkeepers(apps, conceded, { minMatches: 1 }).length).toBe(3);
  });
});

describe('紅黃牌統計（運動精神獎參考）', () => {
  const teams = { A: { name: '甲隊' }, B: { name: '乙隊' }, C: { name: '未出賽' } };
  const match = (matchId, status = 'finished', stageId = 'group') => ({ matchId, status, stageId, divisionId: 'd', home: { teamId: 'A' }, away: { teamId: 'B' }, score: { home: 1, away: 0 } });
  const card = (matchId, cardType, extra = {}) => ({ matchId, type: 'card', cardType, playerId: 'p1', teamId: 'A', ...extra });
  test('從完賽場次計算，淘汰賽納入、跨階段同隊只有一列、未出賽不進榜', () => {
    const rows = computeFairPlayBoard({ teams, matches: [match('m1'), match('m2', 'confirmed', 'final')], cardEvents: [card('m1', 'yellow'), card('m2', 'red')] });
    expect(rows.map(r => r.teamId)).toEqual(['B', 'A']);
    expect(rows.find(r => r.teamId === 'A')).toMatchObject({ name: '甲隊', fairPlayPoints: -5, yellow: 1, red: 1, played: 2 });
  });
  test('兩黃換紅顯示兩張黃與一張紅，扣分仍只計 −3', () => {
    const rows = computeFairPlayBoard({ teams, matches: [match('m1')], cardEvents: [card('m1', 'yellow'), card('m1', 'second_yellow')] });
    expect(rows.find(r => r.teamId === 'A')).toMatchObject({ fairPlayPoints: -3, yellow: 2, red: 1, secondYellow: 1 });
  });
  test('排除刪除、重開、取消場次與不存在球隊；零場不能變成零扣分榜首', () => {
    expect(computeFairPlayBoard({ teams, matches: [match('live', 'live'), match('cancel', 'cancelled')], cardEvents: [card('deleted', 'red')] })).toEqual([]);
    expect(computeFairPlayBoard({ teams: { A: teams.A }, matches: [match('m1')], cardEvents: [card('m1', 'red')] })).toEqual([]);
  });
  test('作廢卡、其他隊伍及來源不明的牌不計入', () => {
    const rows = computeFairPlayBoard({ teams, matches: [match('m1')], cardEvents: [card('m1', 'red', { voided: true }), card('missing', 'red'), card('m1', 'red', { teamId: 'C' }), card(null, 'red')] });
    expect(rows.every(r => r.fairPlayPoints === 0 && r.yellow === 0 && r.red === 0)).toBe(true);
  });
  test('重複讀入同一場不重複計場數', () => {
    const rows = computeFairPlayBoard({ teams, matches: [match('m1'), match('m1')] });
    expect(rows.every(r => r.played === 1)).toBe(true);
  });
  test('整隊退賽依規則作廢；保留已賽政策不會把未賽場次算成紀律紀錄', () => {
    const withdrawn = { ...teams, A: { ...teams.A, withdrawn: true } };
    const input = { teams: withdrawn, matches: [match('m1'), match('pending', 'scheduled')], cardEvents: [card('m1', 'red')] };
    expect(computeFairPlayBoard(input)).toEqual([]);
    const rows = computeFairPlayBoard({ ...input, withdrawalPolicy: 'keepAsWalkover' });
    expect(rows.find(r => r.teamId === 'A')).toMatchObject({ played: 1, fairPlayPoints: -4 });
  });
  test('比分不完整或型別錯誤的完賽不列入', () => {
    for (const score of [null, { home: null, away: 0 }, { home: '1', away: 0 }]) {
      expect(computeFairPlayBoard({ teams, matches: [{ ...match('m1'), score }] })).toEqual([]);
    }
  });
});
