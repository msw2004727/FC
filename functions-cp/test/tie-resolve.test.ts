/**
 * §3.272 F3：同分逐項比較、裁定順序、成員不變才套用。
 * T07 數字對齊 test/ranking.test.ts。
 */
import { explainTie, matchesPendingTie, pendingTieGroups, rankRows } from '../src/engine/ranking.js';
import { buildStanding, computeRows, tieDecisionView } from '../src/engine/standing.js';
import { RANKING_RULES } from '../src/engine/formats.js';
import { mkAll, order } from './_helpers.js';
import type { StandingRow } from '../src/engine/types.js';

const RULE = RANKING_RULES.RR_FEDA_DEFAULT;

const T07 = mkAll([
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
const T07_IDS = ['A', 'B', 'C', 'D', 'E'];

const vals = (step: { values: Array<{ teamId: string; value: number | null }> }) =>
  Object.fromEntries(step.values.map(v => [v.teamId, v.value]));

describe('explainTie：飛達盃 T07 三隊同分重比', () => {
  const rows = computeRows(T07_IDS, T07, RULE);

  test('三隊逐項：先用直接對戰積分拆出 A，B 與 C 重比後由全組淨勝分出高下', () => {
    const exp = explainTie(rows, T07, RULE, ['A', 'B', 'C']);
    expect(exp.naturalOrder).toEqual(['A', 'B', 'C']);
    expect(exp.pending).toBe(false);
    expect(exp.decidedCriterion).toBe('goalDiff');
    expect(exp.pendingCriterion).toBeNull();

    const points = exp.steps.find(s => s.criterion === 'points' && s.teamIds.length === 3);
    expect(vals(points!)).toEqual({ A: 7, B: 7, C: 7 });
    expect(points!.split).toBe(false);

    const h2h = exp.steps.find(s => s.criterion === 'headToHeadPoints' && s.teamIds.length === 3);
    expect(vals(h2h!)).toEqual({ A: 6, B: 1, C: 1 });
    expect(h2h!.split).toBe(true);

    // 沿用三隊迷你表的淨勝會得到 B −5、C −1，名次會反。這裡不能出現那一步。
    expect(exp.steps.some(s => s.criterion === 'headToHeadGoalDiff' && s.teamIds.length === 3)).toBe(false);
    const mini = computeRows(['A', 'B', 'C'], T07, RULE, { onlyBetweenTeams: true });
    const miniBy = Object.fromEntries(mini.map(r => [r.teamId, r.goalDiff]));
    expect(miniBy).toEqual({ A: 6, B: -5, C: -1 });

    const gd = exp.steps.find(s => s.criterion === 'goalDiff' && s.teamIds.length === 2);
    expect(gd!.teamIds).toEqual(['B', 'C']);
    expect(vals(gd!)).toEqual({ B: 7, C: 1 });
    expect(gd!.split).toBe(true);
    expect(exp.splits).toEqual([
      { criterion: 'headToHeadPoints', aboveTeamIds: ['A'], belowTeamIds: ['B', 'C'] },
      { criterion: 'goalDiff', aboveTeamIds: ['B'], belowTeamIds: ['C'] }
    ]);
    expect(exp.matchIds).toEqual(['m1', 'm2', 'm3']);
  });

  test('只問 B、C：分出高下的是全組淨勝，直接對戰那幾項打平', () => {
    const exp = explainTie(rows, T07, RULE, ['B', 'C']);
    expect(exp.naturalOrder).toEqual(['B', 'C']);
    expect(exp.decidedCriterion).toBe('goalDiff');
    expect(exp.steps.map(s => s.criterion)).toEqual([
      'points', 'headToHeadPoints', 'headToHeadGoalDiff', 'headToHeadGoalsFor', 'goalDiff'
    ]);
    expect(exp.steps.filter(s => s.criterion !== 'goalDiff').every(s => s.split === false)).toBe(true);
    expect(vals(exp.steps.find(s => s.criterion === 'headToHeadPoints')!)).toEqual({ B: 1, C: 1 });
    expect(vals(exp.steps.find(s => s.criterion === 'goalDiff')!)).toEqual({ B: 7, C: 1 });
    expect(exp.matchIds).toEqual(['m3']);

    const ranked = rankRows(rows.filter(r => r.teamId === 'B' || r.teamId === 'C'), T07, RULE);
    const b = ranked.rows.find(r => r.teamId === 'B')!;
    expect(b.tieBreakTrace).toContain('decided@goalDiff');
    expect(b.tieBreakTrace.some(t => t.startsWith('gd=7'))).toBe(true);
  });
});

describe('explainTie：條件用盡仍同分', () => {
  test('沒有 manual／drawLots 時停在 exhausted，每一項數值都相同', () => {
    const rule = { rankingRuleId: 'X', points: RULE.points, criteria: ['points', 'goalDiff', 'goalsFor'] };
    const matches = mkAll([['m1', 'A', 'B', 1, 1]]);
    const exp = explainTie(computeRows(['A', 'B'], matches, rule), matches, rule, ['A', 'B']);
    expect(exp.pending).toBe(true);
    expect(exp.pendingCriterion).toBe('exhausted');
    expect(exp.decidedCriterion).toBeNull();
    expect(exp.steps.map(s => s.criterion)).toEqual(['points', 'goalDiff', 'goalsFor', 'exhausted']);
    for (const step of exp.steps) {
      if (step.criterion === 'exhausted') expect(step.values.every(v => v.value === null)).toBe(true);
      else expect(new Set(step.values.map(v => v.value)).size).toBe(1);
      expect(step.split).toBe(false);
    }
  });

  test('飛達預設停在 manual', () => {
    const matches = mkAll([
      ['m1', 'A', 'B', 1, 1],
      ['m2', 'A', 'C', 2, 0],
      ['m3', 'B', 'C', 2, 0],
      ['m4', 'D', 'A', 1, 0],
      ['m5', 'D', 'B', 1, 0],
      ['m6', 'D', 'C', 1, 0]
    ]);
    const exp = explainTie(computeRows(['A', 'B', 'C', 'D'], matches, RULE), matches, RULE, ['A', 'B']);
    expect(exp.pending).toBe(true);
    expect(exp.pendingCriterion).toBe('manual');
    expect(exp.decidedCriterion).toBeNull();
    expect(exp.steps.at(-1)!.criterion).toBe('manual');
  });
});

const build = (teamIds: string[], matches: ReturnType<typeof mkAll>, over: Record<string, unknown> = {}) => buildStanding({
  competitionId: 'ev', divisionId: 'div', stageId: 'group', groupId: 'A',
  teamIds, matches, rule: RULE, ...over
});

describe('裁定順序與失效', () => {
  const ids = ['A', 'B', 'C', 'D'];
  const tied = mkAll([
    ['m1', 'A', 'B', 1, 1],
    ['m2', 'A', 'C', 2, 0],
    ['m3', 'B', 'C', 2, 0],
    ['m4', 'D', 'A', 1, 0],
    ['m5', 'D', 'B', 1, 0],
    ['m6', 'D', 'C', 1, 0]
  ]);

  test('待裁定群是 A、B；裁定後名次照 order，其他人不動', () => {
    const v1 = build(ids, tied);
    expect(matchesPendingTie(v1.rows, ['B', 'A'])).toBe(true);
    expect(matchesPendingTie(v1.rows, ['A', 'B', 'C'])).toBe(false);
    expect(pendingTieGroups(v1.rows)).toEqual([['A', 'B']]);

    const v2 = build(ids, tied, { prev: { version: v1.version, manualOverride: decision(['B', 'A'], 'host') } });
    expect(order(v2.rows)).toEqual(['D', 'B', 'A', 'C']);
    expect(v2.rows.filter(r => r.teamId === 'A' || r.teamId === 'B').every(r => r.decidedBy === 'host' && r.locked === true)).toBe(true);
    expect(v2.rows.filter(r => r.teamId === 'C' || r.teamId === 'D').every(r => r.decidedBy == null && r.locked === false)).toBe(true);
    expect(v2.hasUnresolvedTie).toBe(false);
    expect(v2.manualOverride.enabled).toBe(true);
    expect(tieDecisionView(v2.manualOverride, v2.rows)?.active).toBe(true);
  });

  test('成員完全相同時重算仍保留；不再同分時不套用、標記清掉，紀錄還在', () => {
    const v1 = build(ids, tied);
    const decided = build(ids, tied, { prev: { version: v1.version, manualOverride: decision(['B', 'A'], 'drawLots') } });
    const again = build(ids, tied, { prev: decided });
    expect(order(again.rows)).toEqual(['D', 'B', 'A', 'C']);
    expect(again.rows.find(r => r.teamId === 'B')!.decidedBy).toBe('drawLots');
    expect(again.manualOverride.order).toEqual(['B', 'A']);

    const split = tied.map(m => m.matchId === 'm1' ? { ...m, score: { home: 2, away: 0 } } : m);
    const dropped = build(ids, split, { prev: decided });
    expect(order(dropped.rows)).toEqual(['D', 'A', 'B', 'C']);
    expect(dropped.rows.every(r => r.decidedBy == null)).toBe(true);
    expect(dropped.hasUnresolvedTie).toBe(false);
    expect(dropped.manualOverride.enabled).toBe(true);
    expect(dropped.manualOverride.order).toEqual(['B', 'A']);
    expect(tieDecisionView(dropped.manualOverride, dropped.rows)).toMatchObject({ active: false, method: 'drawLots', order: ['B', 'A'] });
  });

  test('成員改變時不套用；同一群又同分時裁定回來', () => {
    const three = ['A', 'B', 'C'];
    const draw = mkAll([
      ['m1', 'A', 'B', 0, 0],
      ['m2', 'A', 'C', 0, 0],
      ['m3', 'B', 'C', 0, 0]
    ]);
    const v1 = build(three, draw);
    expect(pendingTieGroups(v1.rows).map(g => [...g].sort())).toEqual([['A', 'B', 'C']]);
    const decided = build(three, draw, { prev: { version: v1.version, manualOverride: decision(['C', 'A', 'B'], 'host') } });
    expect(order(decided.rows)).toEqual(['C', 'A', 'B']);

    const changed = mkAll([
      ['m1', 'A', 'B', 0, 0],
      ['m2', 'A', 'C', 1, 0],
      ['m3', 'B', 'C', 1, 0]
    ]);
    const shifted = build(three, changed, { prev: decided });
    expect(order(shifted.rows)).toEqual(['A', 'B', 'C']);
    expect(shifted.rows.every(r => r.decidedBy == null)).toBe(true);
    expect(shifted.hasUnresolvedTie).toBe(true);
    expect(pendingTieGroups(shifted.rows)).toEqual([['A', 'B']]);
    expect(shifted.manualOverride.order).toEqual(['C', 'A', 'B']);

    const back = build(three, draw, { prev: shifted });
    expect(order(back.rows)).toEqual(['C', 'A', 'B']);
    expect(back.rows.every(r => r.decidedBy === 'host')).toBe(true);
    expect(tieDecisionView(back.manualOverride, back.rows)?.active).toBe(true);
  });
});

describe('待裁定群的邊界', () => {
  const bare = (teamId: string, rank: number, tiedWith: string[], trace: string[], flag = true): StandingRow => ({
    teamId, rank, tiedWith, tieBreakTrace: trace, hasUnresolvedTie: flag,
    played: 1, win: 0, draw: 1, loss: 0, goalsFor: 1, goalsAgainst: 1, goalDiff: 0, points: 1
  });

  test('兩群分開；名次不連續或只給一半都不算', () => {
    const rows = [
      bare('A', 1, ['B'], ['unresolved@manual']),
      bare('B', 2, ['A'], ['unresolved@manual']),
      bare('C', 3, ['D'], ['unresolved@exhausted']),
      bare('D', 4, ['C'], ['unresolved@exhausted'])
    ];
    expect(pendingTieGroups(rows)).toEqual([['A', 'B'], ['C', 'D']]);
    expect(matchesPendingTie(rows, ['D', 'C'])).toBe(true);
    expect(matchesPendingTie(rows, ['A', 'B', 'C', 'D'])).toBe(false);
    expect(matchesPendingTie(rows, ['A', 'C'])).toBe(false);

    const gap = [
      bare('A', 1, ['B'], ['unresolved@manual']),
      bare('B', 3, ['A'], ['unresolved@manual'])
    ];
    expect(matchesPendingTie(gap, ['A', 'B'])).toBe(false);
  });

  test('沒有旗標但追蹤是 drawLots 仍算待裁定', () => {
    const rows = [
      bare('A', 1, ['B'], ['unresolved@drawLots'], false),
      bare('B', 2, ['A'], ['unresolved@drawLots'], false)
    ];
    expect(matchesPendingTie(rows, ['B', 'A'])).toBe(true);
  });
});

function decision(order: string[], method: 'host' | 'drawLots') {
  return { enabled: true, by: 'hashhashhashhash', at: 't', reason: '主辦裁定', method, order, decidedAt: 't' };
}
