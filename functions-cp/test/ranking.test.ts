/**
 * 同分排序｜T05–T08、T14
 * 對應 docs/02 §6 與 §11
 */
import { rankRows, fairPlayPoints, fairPlayByTeam, applyManualRanking, FAIR_PLAY } from '../src/engine/ranking.js';
import { computeRows } from '../src/engine/standing.js';
import { RANKING_RULES } from '../src/engine/formats.js';
import { mkAll, card, order } from './_helpers.js';

const RULE = RANKING_RULES.RR_FEDA_DEFAULT;
const rank = (teamIds, matches, rule = RULE, opts = {}) =>
  rankRows(computeRows(teamIds, matches, rule, opts), matches, rule, opts);

describe('T05 兩隊同分 → 用直接對戰判定', () => {
  // A 與 B 同積 6 分，但 B 的總得失球差(+4) 遠優於 A(0)。
  // 因為 A 直接對戰贏過 B，RR_FEDA_DEFAULT 必須讓 A 在前。
  const matches = mkAll([
    ['m1', 'A', 'B', 1, 0],
    ['m2', 'C', 'A', 2, 0],
    ['m3', 'A', 'D', 1, 0],
    ['m4', 'B', 'C', 2, 0],
    ['m5', 'B', 'D', 3, 0],
    ['m6', 'D', 'C', 1, 0]
  ]);

  test('A、B 確實同分，且 B 的得失球差較優', () => {
    const rows = computeRows(['A', 'B', 'C', 'D'], matches, RULE);
    const by = Object.fromEntries(rows.map(r => [r.teamId, r]));
    expect(by.A.points).toBe(6);
    expect(by.B.points).toBe(6);
    expect(by.A.goalDiff).toBe(0);
    expect(by.B.goalDiff).toBe(4);
  });

  test('對戰關係優先 → A 在 B 之前', () => {
    const { rows, hasUnresolvedTie } = rank(['A', 'B', 'C', 'D'], matches);
    expect(order(rows)).toEqual(['A', 'B', 'D', 'C']);
    expect(hasUnresolvedTie).toBe(false);
  });

  test('改用「不看對戰、只看得失球差」的規則 → B 反超，證明差異來自對戰關係', () => {
    const gdFirst = { rankingRuleId: 'X', points: RULE.points, criteria: ['points', 'goalDiff', 'goalsFor', 'manual'] };
    const { rows } = rank(['A', 'B', 'C', 'D'], matches, gdFirst);
    expect(order(rows).slice(0, 2)).toEqual(['B', 'A']);
  });

  test('tieBreakTrace 記錄實際判定依據', () => {
    const { rows } = rank(['A', 'B', 'C', 'D'], matches);
    const a = rows.find(r => r.teamId === 'A');
    expect(a.tieBreakTrace).toContain('pts=6');
    expect(a.tieBreakTrace.some(t => t.startsWith('h2h-pts=3(vs B)'))).toBe(true);
    expect(a.tieBreakTrace).toContain('decided@headToHeadPoints');
  });
});

describe('T06 三隊同分 → 迷你循環表', () => {
  // A、B、C 互有勝負各 6 分（石頭剪刀布），D 全敗。
  // 迷你表三隊都是 3 分，改由迷你表的得失球差決定：A(+2) > C(0) > B(-2)。
  // 注意 B 的「全組」得失球差其實跟 A 一樣好，但對戰關係優先，B 只能排第三。
  const matches = mkAll([
    ['m1', 'A', 'B', 3, 0],
    ['m2', 'B', 'C', 1, 0],
    ['m3', 'C', 'A', 1, 0],
    ['m4', 'A', 'D', 1, 0],
    ['m5', 'B', 'D', 5, 0],
    ['m6', 'C', 'D', 1, 0]
  ]);

  test('四隊積分：A=B=C=6、D=0', () => {
    const rows = computeRows(['A', 'B', 'C', 'D'], matches, RULE);
    const by = Object.fromEntries(rows.map(r => [r.teamId, r.points]));
    expect(by).toEqual({ A: 6, B: 6, C: 6, D: 0 });
  });

  test('迷你表得失球差決定 A > C > B', () => {
    const { rows, hasUnresolvedTie } = rank(['A', 'B', 'C', 'D'], matches);
    expect(order(rows)).toEqual(['A', 'C', 'B', 'D']);
    expect(hasUnresolvedTie).toBe(false);
  });

  test('B 的全組得失球差不比 A 差，仍排第三（證明迷你表優先）', () => {
    const rows = computeRows(['A', 'B', 'C', 'D'], matches, RULE);
    const by = Object.fromEntries(rows.map(r => [r.teamId, r.goalDiff]));
    expect(by.B).toBeGreaterThanOrEqual(by.A);
  });
});

describe('T07 三隊同分拆出一隊後，剩下兩隊必須重比直接對戰', () => {
  // ⭐ 這是 §6.4 明確點名的陷阱。
  //
  // A、B、C 同積 7 分。三隊迷你表：A 6 分獨走，B 與 C 各 1 分（2:2 平手）。
  // A 拆出去之後，B 與 C 必須「只用他們那一場 2:2」重新比 —— 平手，分不出，
  // 於是落到全組得失球差：B(+7) > C(+1)。
  //
  // 若錯誤地沿用三隊迷你表的數字，B 是 −5、C 是 −1，會得到相反的 C > B。
  const matches = mkAll([
    ['m1', 'A', 'B', 5, 0],
    ['m2', 'A', 'C', 1, 0],
    ['m3', 'B', 'C', 2, 2],
    ['m4', 'A', 'D', 0, 0],
    ['m5', 'E', 'A', 1, 0],
    ['m6', 'B', 'D', 6, 0],
    ['m7', 'B', 'E', 6, 0],
    ['m8', 'C', 'D', 1, 0],
    ['m9', 'C', 'E', 1, 0],
    ['m10', 'D', 'E', 1, 0]
  ]);
  const ids = ['A', 'B', 'C', 'D', 'E'];

  test('前置：A、B、C 同積 7 分', () => {
    const rows = computeRows(ids, matches, RULE);
    const by = Object.fromEntries(rows.map(r => [r.teamId, r.points]));
    expect(by.A).toBe(7);
    expect(by.B).toBe(7);
    expect(by.C).toBe(7);
  });

  test('前置：三隊迷你表會把 B 排在 C 之後（沿用就會錯）', () => {
    const mini = computeRows(['A', 'B', 'C'], matches, RULE, { onlyBetweenTeams: true });
    const by = Object.fromEntries(mini.map(r => [r.teamId, r]));
    expect(by.A.points).toBe(6);
    expect(by.B.points).toBe(1);
    expect(by.C.points).toBe(1);
    expect(by.B.goalDiff).toBe(-5);
    expect(by.C.goalDiff).toBe(-1);   // 沿用這組數字 → C > B（錯誤答案）
  });

  test('正確結果：B 在 C 之前（重比直接對戰後落到全組得失球差）', () => {
    const { rows } = rank(ids, matches);
    expect(order(rows).slice(0, 3)).toEqual(['A', 'B', 'C']);
  });

  test('B 的 trace 顯示「兩隊重比」而非沿用三隊表', () => {
    const { rows } = rank(ids, matches);
    const b = rows.find(r => r.teamId === 'B');
    // 第一次 h2h 是三隊群（A/B/C），A 被拆走後才出現只有兩隊的 (vs C)
    expect(b.tieBreakTrace.some(t => t.includes('(群 A/B/C)'))).toBe(true);
    expect(b.tieBreakTrace.some(t => t.includes('(vs C)'))).toBe(true);
    expect(b.tieBreakTrace).toContain('decided@goalDiff');
  });
});

describe('T08 條件用盡仍同分 → 標記待裁定，不隨機', () => {
  const matches = mkAll([
    ['m1', 'A', 'B', 1, 1],
    ['m2', 'A', 'C', 2, 0],
    ['m3', 'B', 'C', 2, 0],
    ['m4', 'D', 'A', 1, 0],
    ['m5', 'D', 'B', 1, 0],
    ['m6', 'D', 'C', 1, 0]
  ]);
  const ids = ['A', 'B', 'C', 'D'];

  test('A 與 B 各項數據完全相同', () => {
    const rows = computeRows(ids, matches, RULE);
    const by = Object.fromEntries(rows.map(r => [r.teamId, r]));
    for (const k of ['points', 'goalsFor', 'goalsAgainst', 'goalDiff', 'fairPlayPoints']) {
      expect(by.A[k]).toBe(by.B[k]);
    }
  });

  test('hasUnresolvedTie=true，且該兩隊被標記', () => {
    const { rows, hasUnresolvedTie } = rank(ids, matches);
    expect(hasUnresolvedTie).toBe(true);
    const a = rows.find(r => r.teamId === 'A');
    expect(a.hasUnresolvedTie).toBe(true);
    expect(a.tiedWith).toEqual(['B']);
    expect(a.tieBreakTrace).toContain('unresolved@manual');
  });

  test('重跑 5 次順序完全一致（不隨機）', () => {
    const first = order(rank(ids, matches).rows);
    for (let i = 0; i < 5; i++) expect(order(rank(ids, matches).rows)).toEqual(first);
  });

  test('Admin 手動指定名次後，被釘住的列 locked=true', () => {
    const { rows } = rank(ids, matches);
    const fixed = applyManualRanking(rows, [{ teamId: 'B', rank: 1 }]);
    expect(fixed[0].teamId).toBe('B');
    expect(fixed[0].locked).toBe(true);
    expect(fixed.map(r => r.rank)).toEqual([1, 2, 3, 4]);
    expect(new Set(fixed.map(r => r.teamId)).size).toBe(4);
  });
});

describe('T14 行為分', () => {
  test('單黃 −1、兩黃 −2', () => {
    expect(fairPlayPoints([{ cardType: 'yellow', seq: 1 }])).toBe(-1);
    expect(fairPlayPoints([
      { cardType: 'yellow', seq: 1, playerId: 'p1' }
    ])).toBe(FAIR_PLAY.yellow);
  });

  test('⭐ 兩黃換紅計 −3，而不是 −1 −3 或 −1 −1 −4', () => {
    const cards = [
      { cardType: 'yellow', seq: 5 },
      { cardType: 'second_yellow', seq: 40 }
    ];
    expect(fairPlayPoints(cards)).toBe(-3);
    expect(fairPlayPoints(cards)).not.toBe(-4);
  });

  test('直接紅 −4；黃牌後直接紅 −5', () => {
    expect(fairPlayPoints([{ cardType: 'red', seq: 10 }])).toBe(-4);
    expect(fairPlayPoints([
      { cardType: 'yellow', seq: 3 },
      { cardType: 'red', seq: 60 }
    ])).toBe(-5);
  });

  test('作廢的卡片不計入', () => {
    expect(fairPlayPoints([
      { cardType: 'red', seq: 10, voided: true },
      { cardType: 'yellow', seq: 20 }
    ])).toBe(-1);
  });

  test('沒有卡片時為 0', () => {
    expect(fairPlayPoints([])).toBe(0);
    expect(fairPlayPoints(undefined)).toBe(0);
  });

  test('依球員分開判定：同隊兩人各一黃 = −2，同一人兩黃換紅 = −3', () => {
    const two = fairPlayByTeam([
      card('m1', 'A', 'p1', 'yellow', 1),
      card('m1', 'A', 'p2', 'yellow', 2)
    ]);
    expect(two.get('A').fairPlayPoints).toBe(-2);

    const one = fairPlayByTeam([
      card('m1', 'A', 'p1', 'yellow', 1),
      card('m1', 'A', 'p1', 'second_yellow', 2)
    ]);
    expect(one.get('A').fairPlayPoints).toBe(-3);
    expect(one.get('A').red).toBe(1);
  });

  test('⭐ −3／−5 是「同一場」的判定，不可跨場合併', () => {
    // 同一名球員：第一場一張黃(−1)、第二場兩黃換紅(−3) → 合計 −4
    expect(fairPlayByTeam([
      card('m1', 'A', 'p1', 'yellow', 1),
      card('m2', 'A', 'p1', 'yellow', 1),
      card('m2', 'A', 'p1', 'second_yellow', 2)
    ]).get('A').fairPlayPoints).toBe(-4);

    // 第一場黃(−1)、第二場黃(−1)、第三場直接紅(−4) → 合計 −6
    expect(fairPlayByTeam([
      card('m1', 'A', 'p1', 'yellow', 1),
      card('m2', 'A', 'p1', 'yellow', 1),
      card('m3', 'A', 'p1', 'red', 1)
    ]).get('A').fairPlayPoints).toBe(-6);

    // 跨場的 seq 不可以拿來比大小：m1 的黃(seq 80) 不該讓 m2 的紅變成「黃後紅」
    expect(fairPlayByTeam([
      card('m1', 'A', 'p1', 'yellow', 80),
      card('m2', 'A', 'p1', 'red', 90)
    ]).get('A').fairPlayPoints).toBe(-5);       // −1 ＋ −4
  });

  test('seq 缺漏時用陣列順序，黃在紅之前仍判 −5', () => {
    expect(fairPlayPoints([{ cardType: 'yellow' }, { cardType: 'red' }])).toBe(-5);
    expect(fairPlayPoints([{ cardType: 'red' }, { cardType: 'yellow' }])).toBe(-4);
  });

  test('clockSec 優先於 seq（01b §1.8 以 clockSec 為權威）', () => {
    // seq 說紅牌在前，但 clockSec 說黃牌在前 → 以 clockSec 為準，判 −5
    expect(fairPlayPoints([
      { cardType: 'red', seq: 1, clockSec: 3000 },
      { cardType: 'yellow', seq: 2, clockSec: 600 }
    ])).toBe(-5);
  });

  test('⭐ 跨場合併的錯誤會改名次（回歸案例）', () => {
    // A：m1 一張黃、m2 兩黃換紅 → 正解 −4；錯誤合併會算成 −3，與 B 打平
    const matches = mkAll([
      ['m1', 'A', 'B', 1, 1], ['m2', 'A', 'C', 2, 0], ['m3', 'B', 'C', 2, 0],
      ['m4', 'D', 'A', 1, 0], ['m5', 'D', 'B', 1, 0], ['m6', 'D', 'C', 1, 0]
    ]);
    const { rows, hasUnresolvedTie } = rank(['A', 'B', 'C', 'D'], matches, RULE, {
      cardEvents: [
        card('m1', 'A', 'p1', 'yellow', 10),
        card('m2', 'A', 'p1', 'yellow', 10),
        card('m2', 'A', 'p1', 'second_yellow', 20),
        card('m1', 'B', 'p9', 'second_yellow', 30)
      ]
    });
    const by = Object.fromEntries(rows.map(r => [r.teamId, r]));
    expect(by.A.fairPlayPoints).toBe(-4);
    expect(by.B.fairPlayPoints).toBe(-3);
    expect(order(rows)).toEqual(['D', 'B', 'A', 'C']);
    expect(hasUnresolvedTie).toBe(false);        // 錯誤實作會在這裡憑空產生待裁定
  });

  test('行為分可以決定名次（fairPlay 條件生效）', () => {
    const matches = mkAll([
      ['m1', 'A', 'B', 1, 1],
      ['m2', 'A', 'C', 2, 0],
      ['m3', 'B', 'C', 2, 0],
      ['m4', 'D', 'A', 1, 0],
      ['m5', 'D', 'B', 1, 0],
      ['m6', 'D', 'C', 1, 0]
    ]);
    // A 吃一張黃牌 → 行為分 −1，B 為 0 → B 應排在 A 之前
    const { rows, hasUnresolvedTie } = rank(['A', 'B', 'C', 'D'], matches, RULE, {
      cardEvents: [card('m1', 'A', 'p1', 'yellow', 1)]
    });
    expect(order(rows).slice(0, 2)).toEqual(['D', 'B']);
    expect(order(rows)[2]).toBe('A');
    expect(hasUnresolvedTie).toBe(false);
  });
});

describe('兒童組規則（RR_FEDA_YOUTH）', () => {
  test('沒有 fairPlay 條件，同分時更早落到主辦裁定', () => {
    expect(RANKING_RULES.RR_FEDA_YOUTH.criteria).not.toContain('fairPlay');
    expect(RANKING_RULES.RR_FEDA_YOUTH.criteria.at(-1)).toBe('manual');
  });

  test('仁慈規則把得失球差壓到 7，但進球數照實記（§6.2 只說得失球差）', () => {
    const matches = mkAll([['m1', 'A', 'B', 15, 0]]);
    const capped = computeRows(['A', 'B'], matches, RANKING_RULES.RR_FEDA_YOUTH, {
      mercyRule: { enabled: true, cap: 7 }
    });
    const by = Object.fromEntries(capped.map(r => [r.teamId, r]));
    expect(by.A.goalDiff).toBe(7);          // 壓到 cap
    expect(by.B.goalDiff).toBe(-7);
    expect(by.A.goalsFor).toBe(15);         // 進球數照實
    expect(by.B.goalsAgainst).toBe(15);
    expect(by.A.points).toBe(3);
  });

  test('多場累加時每一場各自封頂，不是總和封頂', () => {
    const matches = mkAll([['m1', 'A', 'B', 15, 0], ['m2', 'A', 'C', 9, 0]]);
    const rows = computeRows(['A', 'B', 'C'], matches, RANKING_RULES.RR_FEDA_YOUTH, {
      mercyRule: { enabled: true, cap: 7 }
    });
    expect(rows.find(r => r.teamId === 'A').goalDiff).toBe(14);   // 7 + 7
  });

  test('cap 設成 0 或負數時強制拉回 1，勝隊不會被改判成平手', () => {
    for (const cap of [0, -1, null, undefined]) {
      const rows = computeRows(['A', 'B'], mkAll([['m1', 'A', 'B', 5, 0]]),
        RANKING_RULES.RR_FEDA_YOUTH, { mercyRule: { enabled: true, cap } });
      const by = Object.fromEntries(rows.map(r => [r.teamId, r]));
      expect(by.A.win).toBe(1);
      expect(by.A.points).toBe(3);
      expect(by.A.goalDiff).toBeGreaterThan(0);
      expect(by.B.goalDiff).toBeLessThan(0);
    }
  });
});
