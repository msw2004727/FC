/**
 * 積分榜｜T09、T10、T12、T13、T16
 * 對應 docs/02 §5 與 §11
 */
import {
  computeRows, buildStanding, isStaleWrite, diffRanking,
  standingIdOf, effectiveScore, applyManualRanking
} from '../src/engine/standing.js';
import { RANKING_RULES } from '../src/engine/formats.js';
import { mk, mkAll, card, shuffle, order } from './_helpers.js';

const RULE = RANKING_RULES.RR_FEDA_DEFAULT;
const build = (teamIds, matches, over = {}) => buildStanding({
  // ported: eventId 改名 competitionId（多賽事；standing id 格式不變）
    competitionId: 'ev', divisionId: 'div', stageId: 'group', groupId: 'A',
  teamIds, matches, rule: RULE, ...over
});

describe('T09 棄賽判 0:2（競賽規章第十八條第 6 款）', () => {
  const matches = [
    mk('m1', 'A', 'B', 0, 0, { status: 'walkover', walkoverSide: 'away', result: { winner: 'home', method: 'walkover' } }),
    mk('m2', 'A', 'C', 1, 1),
    mk('m3', 'B', 'C', 2, 0)
  ];

  test('⭐ 棄賽方記 0:2，對手記 2:0 並得 3 分', () => {
    // 規章原文：「球隊逾時 5 分鐘不出場以棄權論 0:2」。
    // 足球界常見的是 3:0，一開始就是照那個寫的——同分時比正負球數
    // 會差一球，足以換掉一個名次。
    const rows = computeRows(['A', 'B', 'C'], matches, RULE);
    const by = Object.fromEntries(rows.map(r => [r.teamId, r]));
    expect(by.A.win).toBe(1);
    expect(by.A.points).toBe(4);                 // 棄賽勝 3 ＋ 對 C 和局 1
    expect(by.B.loss).toBe(1);
    expect(by.A.goalsFor).toBe(2 + 1);
    expect(by.B.goalsAgainst).toBe(2 + 0);
  });

  test('countInGoalStats=false 時不計入得失球，但仍計積分', () => {
    const rows = computeRows(['A', 'B', 'C'], matches, RULE, {
      walkover: { countInGoalStats: false }
    });
    const by = Object.fromEntries(rows.map(r => [r.teamId, r]));
    expect(by.A.points).toBe(4);
    expect(by.A.goalsFor).toBe(1);               // 只剩對 C 的那 1 球
    expect(by.A.played).toBe(2);
  });

  test('walkoverSide 沒填時整場不計（寧可不計，也不要判錯）', () => {
    const bad = [mk('m1', 'A', 'B', 0, 0, { status: 'walkover', walkoverSide: null })];
    expect(effectiveScore(bad[0])).toBeNull();
    const rows = computeRows(['A', 'B'], bad, RULE);
    expect(rows.every(r => r.played === 0)).toBe(true);
  });

  test('未完賽與延期場次一律不計', () => {
    for (const s of ['scheduled', 'live', 'halftime', 'postponed', 'cancelled']) {
      expect(effectiveScore(mk('x', 'A', 'B', 3, 1, { status: s }))).toBeNull();
    }
  });

  test('⭐ 比分不是數字時整場不計，絕不當成 0:0 平手', () => {
    // Number(null) 與 Number('') 都是 0，用 Number() 判斷會把「沒填」判成平手。
    // firestore.rules 的 validScore 只掛在賽務分支，Admin 改分不經過它。
    for (const bad of [
      { home: null, away: null }, { home: null, away: 2 }, { home: '', away: '' },
      { home: [], away: [] }, { home: true, away: false }, { home: '3', away: '1' },
      { home: NaN, away: 0 }, {}, null
    ]) {
      expect(effectiveScore(mk('x', 'A', 'B', 0, 0, { score: bad }))).toBeNull();
    }
    const rows = computeRows(['A', 'B'], [mk('x', 'A', 'B', 0, 0, { score: { home: null, away: null } })], RULE);
    expect(rows.every(r => r.played === 0 && r.points === 0)).toBe(true);
  });

  test('awardPoints / penaltyPoints 設定真的生效（不是從比分推）', () => {
    const wo = [mk('m1', 'A', 'B', 0, 0, { status: 'walkover', walkoverSide: 'away' })];
    const custom = computeRows(['A', 'B'], wo, RULE, {
      walkover: { scoreFor: 3, scoreAgainst: 0, awardPoints: 1, penaltyPoints: -3 }
    });
    const by = Object.fromEntries(custom.map(r => [r.teamId, r]));
    expect(by.A.points).toBe(1);
    expect(by.B.points).toBe(-3);
  });

  test('判定比分 0:0 時仍是勝負，不會變成「平手各得 1 分」', () => {
    const wo = [mk('m1', 'A', 'B', 0, 0, { status: 'walkover', walkoverSide: 'away' })];
    const rows = computeRows(['A', 'B'], wo, RULE, {
      walkover: { scoreFor: 0, scoreAgainst: 0, awardPoints: 3, penaltyPoints: 0 }
    });
    const by = Object.fromEntries(rows.map(r => [r.teamId, r]));
    expect(by.A.points).toBe(3);
    expect(by.B.points).toBe(0);
    expect(by.B.draw).toBe(0);
  });
});

describe('T10 整隊退賽 voidAll：其他隊之間的成績不受影響', () => {
  // C 退賽。A、B、D 之間的成績必須跟「C 從沒存在過」完全一樣。
  const withC = mkAll([
    ['m1', 'A', 'B', 1, 0],
    ['m2', 'A', 'C', 5, 0],
    ['m3', 'B', 'C', 4, 0],
    ['m4', 'C', 'D', 0, 1],
    ['m5', 'A', 'D', 2, 1],
    ['m6', 'B', 'D', 0, 0]
  ]);
  const withoutC = withC.filter(m => !m.teamIds.includes('C'));

  test('退賽隊不出現在積分榜', () => {
    const rows = computeRows(['A', 'B', 'C', 'D'], withC, RULE, { withdrawnTeamIds: ['C'] });
    expect(rows.map(r => r.teamId).sort()).toEqual(['A', 'B', 'D']);
  });

  test('其餘三隊的數據與「C 不存在」完全一致', () => {
    const voided = computeRows(['A', 'B', 'C', 'D'], withC, RULE, { withdrawnTeamIds: ['C'] });
    const clean = computeRows(['A', 'B', 'D'], withoutC, RULE);
    const strip = rs => rs.map(({ teamId, played, win, draw, loss, goalsFor, goalsAgainst, points }) =>
      ({ teamId, played, win, draw, loss, goalsFor, goalsAgainst, points }));
    expect(strip(voided).sort(byId)).toEqual(strip(clean).sort(byId));
  });

  test('keepAsWalkover 保留已賽成績', () => {
    const rows = computeRows(['A', 'B', 'C', 'D'], withC, RULE, {
      withdrawnTeamIds: ['C'], withdrawalPolicy: 'keepAsWalkover'
    });
    const by = Object.fromEntries(rows.map(r => [r.teamId, r]));
    expect(by.C).toBeDefined();
    expect(by.A.goalsFor).toBe(1 + 5 + 2);
  });

  test('⭐ keepAsWalkover 的未賽場次判 0:2 給對手（§5.2 對這個選項的實質定義）', () => {
    // B 對 C 還沒打，C 退賽 → B 應該拿到 3 分與 2:0（規章的棄權比分）
    const partial = [
      mk('m1', 'A', 'B', 1, 0),
      mk('m2', 'A', 'C', 5, 0),
      mk('m3', 'B', 'C', 0, 0, { status: 'scheduled' })
    ];
    const rows = computeRows(['A', 'B', 'C'], partial, RULE, {
      withdrawnTeamIds: ['C'], withdrawalPolicy: 'keepAsWalkover'
    });
    const by = Object.fromEntries(rows.map(r => [r.teamId, r]));
    expect(by.B.played).toBe(2);
    expect(by.B.points).toBe(3);
    expect(by.B.goalsFor).toBe(0 + 2);
    expect(by.C.loss).toBe(2);
  });

  test('voidAll 時未賽場次不會被判 0:2（整場作廢才是預設）', () => {
    const partial = [
      mk('m1', 'A', 'B', 1, 0),
      mk('m3', 'B', 'C', 0, 0, { status: 'scheduled' })
    ];
    const rows = computeRows(['A', 'B', 'C'], partial, RULE, { withdrawnTeamIds: ['C'] });
    expect(rows.find(r => r.teamId === 'B').played).toBe(1);
  });

  test('退賽隊在場上吃到的牌不影響其他隊的行為分', () => {
    const rows = computeRows(['A', 'B', 'C', 'D'], withC, RULE, {
      withdrawnTeamIds: ['C'],
      cardEvents: [card('m2', 'A', 'p1', 'red', 1), card('m5', 'A', 'p2', 'yellow', 1)]
    });
    const a = rows.find(r => r.teamId === 'A');
    expect(a.fairPlayPoints).toBe(-1);           // m2 整場作廢，只剩 m5 的黃牌
  });

  test('沒有納入統計的場次、以及來源不明的牌，都不影響行為分', () => {
    const matches = [
      mk('m1', 'A', 'B', 1, 0),
      mk('m2', 'A', 'B', 9, 0, { status: 'live' }),                       // 未完賽
      mk('m3', 'A', 'B', 0, 0, { status: 'walkover', walkoverSide: null })// 資料不全
    ];
    const rows = computeRows(['A', 'B'], matches, RULE, {
      cardEvents: [
        card('m1', 'A', 'p1', 'yellow', 1),
        card('m2', 'A', 'p2', 'red', 1),          // 未完賽場次
        card('m3', 'A', 'p3', 'red', 1),          // 沒被計入的棄賽場次
        card('m9', 'A', 'p4', 'red', 1),          // 不屬於本組的場次
        { type: 'card', teamId: 'A', playerId: 'p5', cardType: 'red', seq: 1 }  // 沒有 matchId
      ]
    });
    expect(rows.find(r => r.teamId === 'A').fairPlayPoints).toBe(-1);
  });
});

describe('T13 冪等性：同一批場次重放結果一致', () => {
  const teamIds = ['A', 'B', 'C', 'D'];
  const matches = mkAll([
    ['m1', 'A', 'B', 1, 0], ['m2', 'C', 'A', 2, 0], ['m3', 'A', 'D', 1, 0],
    ['m4', 'B', 'C', 2, 0], ['m5', 'B', 'D', 3, 0], ['m6', 'D', 'C', 1, 0]
  ]);

  test('連續執行 3 次，輸出完全相同', () => {
    const a = build(teamIds, matches);
    const b = build(teamIds, matches);
    const c = build(teamIds, matches);
    expect(b.rows).toEqual(a.rows);
    expect(c.rows).toEqual(a.rows);
    expect(a.hasUnresolvedTie).toBe(c.hasUnresolvedTie);
  });

  test('場次順序被打亂也得到相同名次', () => {
    const base = build(teamIds, matches).rows;
    for (const seed of [1, 7, 42, 999]) {
      expect(order(build(teamIds, shuffle(matches, seed)).rows)).toEqual(order(base));
    }
  });

  test('球隊清單順序不影響結果', () => {
    const base = order(build(teamIds, matches).rows);
    expect(order(build(['D', 'C', 'B', 'A'], matches).rows)).toEqual(base);
  });

  test('不呼叫 Date.now()，computedAt 由呼叫端補（保持純函式）', () => {
    expect(build(teamIds, matches).computedAt).toBeUndefined();
  });
});

describe('T16 亂序寫入：舊版本不覆寫新版本', () => {
  test('version 每次重算 +1', () => {
    const v1 = build(['A', 'B'], mkAll([['m1', 'A', 'B', 1, 0]]));
    expect(v1.version).toBe(1);
    const v2 = build(['A', 'B'], mkAll([['m1', 'A', 'B', 2, 0]]), { prev: v1 });
    expect(v2.version).toBe(2);
  });

  test('後到的舊版本被判定為過時', () => {
    const current = { version: 5 };
    expect(isStaleWrite(current, { version: 4 })).toBe(true);
    expect(isStaleWrite(current, { version: 5 })).toBe(true);   // 同版本也不重寫
    expect(isStaleWrite(current, { version: 6 })).toBe(false);
  });

  test('第一次寫入（尚無現存文件）永遠允許', () => {
    expect(isStaleWrite(null, { version: 1 })).toBe(false);
  });

  test('manualOverride 在重算時被保留，不會被沖掉', () => {
    const v1 = build(['A', 'B'], mkAll([['m1', 'A', 'B', 1, 0]]));
    v1.manualOverride = { enabled: true, by: 'u-admin', at: null, reason: '主辦裁定' };
    const v2 = build(['A', 'B'], mkAll([['m1', 'A', 'B', 1, 0]]), { prev: v1 });
    expect(v2.manualOverride.enabled).toBe(true);
    expect(v2.manualOverride.by).toBe('u-admin');
  });
});

describe('⭐ 人工裁定必須撐過重算（§10）', () => {
  // A 與 B 各項數據完全相同，條件用盡仍同分
  const teamIds = ['A', 'B', 'C', 'D'];
  const matches = mkAll([
    ['m1', 'A', 'B', 1, 1], ['m2', 'A', 'C', 2, 0], ['m3', 'B', 'C', 2, 0],
    ['m4', 'D', 'A', 1, 0], ['m5', 'D', 'B', 1, 0], ['m6', 'D', 'C', 1, 0]
  ]);

  test('裁定後重算，順序與 locked 都還在，而且不再是待裁定', () => {
    const v1 = build(teamIds, matches);
    expect(v1.hasUnresolvedTie).toBe(true);

    // 主辦裁定 B 在 A 之前
    v1.rows = applyManualRanking(v1.rows, [{ teamId: 'B', rank: 2 }]);
    v1.manualOverride = { enabled: true, by: 'u-admin', at: null, reason: '主辦裁定' };
    v1.hasUnresolvedTie = false;

    const v2 = build(teamIds, matches, { prev: v1 });
    expect(order(v2.rows)).toEqual(order(v1.rows));
    expect(v2.rows.find(r => r.teamId === 'B').rank).toBe(2);
    expect(v2.rows.find(r => r.teamId === 'B').locked).toBe(true);
    // 若這裡又跳回 true，晉級解算會被永久卡住
    expect(v2.hasUnresolvedTie).toBe(false);
  });

  test('applyManualRanking 會清掉同群隊伍的待裁定旗標', () => {
    const { rows } = { rows: build(teamIds, matches).rows };
    const fixed = applyManualRanking(rows, [{ teamId: 'B', rank: 2 }]);
    expect(fixed.every(r => r.hasUnresolvedTie === false)).toBe(true);
    expect(fixed.find(r => r.teamId === 'A').tiedWith).toEqual([]);
  });

  test('沒有人工裁定時不會誤套（一般重算照常自動排序）', () => {
    const v1 = build(teamIds, matches);
    const v2 = build(teamIds, matches, { prev: v1 });
    expect(v2.hasUnresolvedTie).toBe(true);
    expect(v2.rows.every(r => r.locked === false)).toBe(true);
  });
});

describe('T12 比分修正後重算', () => {
  const teamIds = ['A', 'B', 'C', 'D'];
  const before = mkAll([
    ['m1', 'A', 'B', 1, 0], ['m2', 'A', 'C', 1, 0], ['m3', 'A', 'D', 1, 0],
    ['m4', 'B', 'C', 1, 0], ['m5', 'B', 'D', 1, 0], ['m6', 'C', 'D', 1, 0]
  ]);
  // 把 m1 改判成 B 贏，A 與 B 的名次互換
  const after = before.map(m => m.matchId === 'm1' ? mk('m1', 'A', 'B', 0, 1) : m);

  test('名次確實改變，且能列出受影響的隊伍', () => {
    const s1 = build(teamIds, before);
    const s2 = build(teamIds, after, { prev: s1 });
    expect(order(s1.rows)).toEqual(['A', 'B', 'C', 'D']);
    expect(order(s2.rows)).toEqual(['B', 'A', 'C', 'D']);

    const d = diffRanking(s1, s2);
    expect(d.changed).toBe(true);
    expect(d.movedTeamIds).toEqual(['A', 'B']);
    expect(s2.version).toBe(2);
  });

  test('比分沒動時 diffRanking 不報警', () => {
    const s1 = build(teamIds, before);
    const s2 = build(teamIds, before, { prev: s1 });
    expect(diffRanking(s1, s2).changed).toBe(false);
  });

  test('整隊退賽讓球隊從積分榜消失時也要報警', () => {
    const s1 = build(teamIds, before);
    const s2 = build(teamIds, before, { prev: s1, opts: { withdrawnTeamIds: ['B'] } });
    const d = diffRanking(s1, s2);
    expect(d.changed).toBe(true);
    expect(d.removedTeamIds).toEqual(['B']);
  });

  test('最後一名消失、其餘名次都沒動時，仍必須報警', () => {
    // 這種情況 movedTeamIds 是空的，只看「名次有沒有變」會漏報，
    // 但下游的「A組第3名」已經指不到人了，非報不可。
    const d = diffRanking(
      { rows: [{ teamId: 'A', rank: 1 }, { teamId: 'B', rank: 2 }, { teamId: 'C', rank: 3 }] },
      { rows: [{ teamId: 'A', rank: 1 }, { teamId: 'B', rank: 2 }] }
    );
    expect(d.movedTeamIds).toEqual([]);
    expect(d.removedTeamIds).toEqual(['C']);
    expect(d.changed).toBe(true);
  });
});

describe('積分榜文件形狀（docs/01b §1.9）', () => {
  test('standingId 格式為 division__stage__group', () => {
    expect(standingIdOf('adult-open', 'group', 'A')).toBe('adult-open__group__A');
  });

  test('每一列都有規格要求的欄位', () => {
    const s = build(['A', 'B'], mkAll([['m1', 'A', 'B', 2, 1]]), {
      opts: { teamMeta: { A: { name: '臺中野狼', abbr: 'WLF' } } }
    });
    const row = s.rows[0];
    for (const k of ['rank', 'teamId', 'name', 'played', 'win', 'draw', 'loss',
                     'goalsFor', 'goalsAgainst', 'goalDiff', 'points',
                     'yellow', 'red', 'fairPlayPoints', 'form', 'tieBreakTrace', 'locked']) {
      expect(row).toHaveProperty(k);
    }
    expect(row.name).toBe('臺中野狼');
    expect(row.form).toEqual(['W']);
  });

  test('PK 決勝的場次積分榜視為平手', () => {
    const pk = mk('m1', 'A', 'B', 1, 1, {
      penaltyScore: { home: 4, away: 3 },
      result: { winner: 'home', method: 'penalty' }
    });
    const rows = computeRows(['A', 'B'], [pk], RULE);
    expect(rows.every(r => r.draw === 1 && r.points === 1)).toBe(true);
  });
});

const byId = (a, b) => a.teamId.localeCompare(b.teamId);
