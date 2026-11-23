/**
 * explainRanking 與 rankRows 同一順序，另外給結構化的分開理由。
 */
import { describe, expect, test } from 'vitest';
import { explainRanking, rankRows, TIEBREAK_MESSAGE_KEYS } from '../src/engine/ranking.js';
import { computeRows } from '../src/engine/standing.js';
import { RANKING_RULES } from '../src/engine/formats.js';
import { mkAll, order } from './_helpers.js';

const RULE = RANKING_RULES.RR_FEDA_DEFAULT;
const CJK = /[\u3400-\u9fff]/;

function both(teamIds, matches, rule = RULE) {
  const rows = computeRows(teamIds, matches, rule);
  return {
    plain: rankRows(rows, matches, rule),
    explained: explainRanking(rows.map(r => ({ ...r })), matches, rule)
  };
}

describe('explainRanking', () => {
  const t05 = mkAll([
    ['m1', 'A', 'B', 1, 0],
    ['m2', 'C', 'A', 2, 0],
    ['m3', 'A', 'D', 1, 0],
    ['m4', 'B', 'C', 2, 0],
    ['m5', 'B', 'D', 3, 0],
    ['m6', 'D', 'C', 1, 0]
  ]);

  test('順序與 tieBreakTrace 跟 rankRows 一樣', () => {
    const { plain, explained } = both(['A', 'B', 'C', 'D'], t05);
    expect(order(explained.rows)).toEqual(order(plain.rows));
    expect(explained.hasUnresolvedTie).toBe(plain.hasUnresolvedTie);
    expect(explained.rows.map(r => r.tieBreakTrace)).toEqual(plain.rows.map(r => r.tieBreakTrace));
    expect(order(explained.rows)).toEqual(['A', 'B', 'D', 'C']);
  });

  test('A 與 B 靠直接對戰積分分開', () => {
    const { explained } = both(['A', 'B', 'C', 'D'], t05);
    const hit = explained.separations.find(s =>
      s.messageKey === 'cp.tiebreak.separated' && s.params.criterion === 'headToHeadPoints');
    expect(hit.params.aboveTeamIds).toContain('A');
    expect(hit.params.belowTeamIds).toContain('B');
    expect(hit.params.aboveRanks[hit.params.aboveTeamIds.indexOf('A')])
      .toBeLessThan(hit.params.belowRanks[hit.params.belowTeamIds.indexOf('B')]);
  });

  test('條件用盡是 unresolved，criterion 為 manual', () => {
    const matches = mkAll([
      ['m1', 'A', 'B', 1, 1],
      ['m2', 'A', 'C', 2, 0],
      ['m3', 'B', 'C', 2, 0],
      ['m4', 'D', 'A', 1, 0],
      ['m5', 'D', 'B', 1, 0],
      ['m6', 'D', 'C', 1, 0]
    ]);
    const { plain, explained } = both(['A', 'B', 'C', 'D'], matches);
    expect(plain.hasUnresolvedTie).toBe(true);
    expect(plain.rows.find(r => r.teamId === 'A').tieBreakTrace).toContain('unresolved@manual');
    const hit = explained.separations.find(s => s.messageKey === 'cp.tiebreak.unresolved');
    expect(hit.params.criterion).toBe('manual');
    expect(hit.params.teamIds).toEqual(expect.arrayContaining(['A', 'B']));
  });

  test('自訂條件會改順序：勝場、行為分、種子、抽籤', () => {
    const rows = [
      {
        teamId: 'A', played: 1, win: 0, draw: 1, loss: 0,
        goalsFor: 1, goalsAgainst: 1, goalDiff: 5, points: 3,
        fairPlayPoints: -1, seed: 2, tieBreakTrace: []
      },
      {
        teamId: 'B', played: 1, win: 2, draw: 0, loss: 0,
        goalsFor: 1, goalsAgainst: 1, goalDiff: 0, points: 3,
        fairPlayPoints: -4, seed: 1, tieBreakTrace: []
      }
    ];
    const ruleOf = (criteria) => ({ rankingRuleId: 'X', points: RULE.points, criteria });
    const ids = (criteria) => order(explainRanking(rows.map(r => ({ ...r })), [], ruleOf(criteria)).rows);
    expect(ids(['wins'])).toEqual(['B', 'A']);
    expect(ids(['goalDiff'])).toEqual(['A', 'B']);
    expect(ids(['fairPlay'])).toEqual(['A', 'B']);
    expect(ids(['seed'])).toEqual(['B', 'A']);
    const drawn = explainRanking(rows.map(r => ({ ...r })), [], ruleOf(['points', 'drawLots']));
    expect(order(drawn.rows)).toEqual(order(rankRows(rows.map(r => ({ ...r })), [], ruleOf(['points', 'drawLots'])).rows));
    expect(drawn.separations.some(s => s.params.criterion === 'drawLots')).toBe(true);
    expect(drawn.hasUnresolvedTie).toBe(true);
  });

  test('messageKey 在清單裡，而且沒有中文', () => {
    const { explained } = both(['A', 'B', 'C', 'D'], t05);
    for (const s of explained.separations) {
      expect(TIEBREAK_MESSAGE_KEYS).toContain(s.messageKey);
    }
    expect(CJK.test(JSON.stringify(explained.separations))).toBe(false);
  });
});
